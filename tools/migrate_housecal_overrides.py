#!/usr/bin/env python3
"""Carry the old House Calendar overrides into the workbook through the Builder's writer — once, by hand."""
import argparse
import base64
import json
import os
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve()
SERVER = HERE.parent.parent / "server"
CONTAINER = os.getenv("HUB_RELAY_CONTAINER", "asa-hub-snapshot")
MODULES = ("house_cal_live", "calendar_builder_houses", "calendar_builder_write",
           "calendar_builder_slices", "shift_requests", "shift_handoff", "shift_slices",
           "house_directory", "psi_reminders", "badge_follows", "effective_roster", "web_gate")

BODY = r'''
import json, os, sys, time, urllib.error, urllib.request
from datetime import datetime
sys.path.insert(0, "/tmp/migrate-housecal-overrides")
import psycopg2
import house_cal_live as hcl
import calendar_builder_houses as cbh
import effective_roster as er
import web_gate


def read_switch():
    """Test mode as the relay reads it: Apps Script's configLane through web_gate; anything else holds."""
    url, secret = os.environ.get("HUB_EXEC_URL", ""), os.environ.get("HUB_SERVICE_SECRET", "")
    if not url or not secret:
        return web_gate.switch_from(None)

    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *a, **k):
            return None

    body = json.dumps({"service_secret": secret, "action": "configLane"}).encode()
    opener = urllib.request.build_opener(NoRedirect)
    for attempt in range(3):
        req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"})
        try:
            try:
                resp = opener.open(req, timeout=120)
            except urllib.error.HTTPError as e:
                if e.code not in (301, 302, 303, 307):
                    raise
                resp = urllib.request.urlopen(e.headers["Location"], timeout=120)
            env = json.loads(resp.read())
        except Exception:  # noqa: BLE001
            time.sleep(3 * (attempt + 1))
            continue
        return web_gate.switch_from(env.get("data") if env.get("status") == 200 else None)
    return web_gate.switch_from(None)


DSN = os.environ["HUB_SNAPSHOT_PG_DSN"]
if ARGS["apply"]:
    SWITCH = read_switch()
    er.use_switch(lambda: SWITCH)
    if SWITCH.get("on") is not False or not SWITCH.get("readable"):
        print(f"REFUSED --apply: test mode reads {SWITCH.get('word')} "
              f"({SWITCH.get('why') or 'on'}) and holds roster writes; nothing was written")
        sys.exit(2)
today = datetime.now(hcl.OHIO).date().isoformat()
hcl.ensure_tables(DSN)
with psycopg2.connect(DSN) as c, c.cursor() as cur:
    cur.execute("SELECT location, employee, col_iso, value, updated_at "
                "FROM asa_house_calendar_overrides ORDER BY location, col_iso, employee")
    rows = cur.fetchall()
    cur.execute("SELECT location, grid FROM asa_house_calendar_live")
    grids = {loc: hcl._as_dict(g) for loc, g in cur.fetchall()}
    pending = hcl.pending_publishes(cur)

plan = []
for loc, emp, iso, val, at in rows:
    grid = grids.get(loc)
    wb = ""
    if grid is None:
        act, why = "drop", "the house has no calendar any more"
    else:
        isos = hcl.col_isos(grid)
        wb = hcl.workbook_text(grid, isos, pending.get(loc, {}), emp, iso)
        if iso not in isos:
            act, why = "drop", "the grid no longer draws that day"
        elif str(val).strip() == wb.strip():
            act, why = "drop", "a mask: it says what the workbook already says"
        elif iso < today and not ARGS["publish_past"]:
            act, why = "drop", "the day has passed (--publish-past publishes it instead)"
        else:
            act, why = "publish", f"{wb or 'nothing'} -> {val or 'nothing'}"
    plan.append({"location": loc, "employee": emp, "col_iso": iso, "value": val,
                 "workbook": wb, "act": act, "why": why, "at": str(at)})

print(f"{len(plan)} override(s): {sum(p['act'] == 'publish' for p in plan)} to publish, "
      f"{sum(p['act'] == 'drop' for p in plan)} to drop")
for p in plan:
    print(f"  {p['act']:<8} {p['location']} | {p['employee']} | {p['col_iso']} | "
          f"override {p['value']!r} | workbook {p['workbook']!r} — {p['why']}")

by_house = {}
for p in plan:
    if p["act"] == "publish":
        by_house.setdefault(p["location"], []).append(
            {"employee": p["employee"], "col_iso": p["col_iso"], "value": p["value"],
             "base": p["workbook"], "note": "an old House Calendars override, carried over"})

if ARGS["rehearse"] or ARGS["apply"]:
    real = cbh.workbook(DSN)
    for loc, cells in sorted(by_house.items()):
        if ARGS["rehearse"]:
            got = real.spreadsheets().values().get(
                spreadsheetId=cbh.LIVE_HOUSES_SHEET_ID, range=f"'{loc}'",
                valueRenderOption="FORMATTED_VALUE").execute()
            copy = cbh.MemoryWorkbook({loc: got.get("values") or []})
            cbh.use_workbook(copy)
        try:
            out = cbh.publish_cells(DSN, loc, cells, actor="migrate_housecal_overrides",
                                    via="migration", record=not ARGS["rehearse"])
            verb = "WOULD WRITE" if ARGS["rehearse"] else "WROTE"
            print(f"{verb} {loc}: {out['written']} cell(s), {out['already']} already there, "
                  f"rows added {out['rows_added']}")
        except hcl.WorkbookRefused as exc:
            print(f"REFUSED {loc}: {exc.why}")
            for b in exc.blocked:
                print(f"    {b.get('employee')} {b.get('col_iso')}: {b.get('reason')}")
        finally:
            cbh.use_workbook(None)
    if ARGS["apply"]:
        dropped = 0
        with psycopg2.connect(DSN) as c, c.cursor() as cur:
            for p in plan:
                if p["act"] != "drop":
                    continue
                # no history record, no delete: a past override may be the only record of a correction
                cur.execute(
                    "INSERT INTO asa_house_calendar_edits (location, employee, col_iso, "
                    "old_value, new_value, via, actor, stage, note) "
                    "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                    (p["location"], p["employee"], p["col_iso"], p["value"], p["workbook"],
                     "migration", "migrate_housecal_overrides", "migration_drop", p["why"]))
                cur.execute("DELETE FROM asa_house_calendar_overrides "
                            "WHERE location=%s AND employee=%s AND col_iso=%s",
                            (p["location"], p["employee"], p["col_iso"]))
                dropped += cur.rowcount
            c.commit()
        print(f"DROPPED {dropped} override(s), each written into its cell's history first")
else:
    print("(a plan only — nothing was read from Google and nothing was written)")
'''


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--apply", action="store_true", help="publish and drop for real")
    ap.add_argument("--rehearse", action="store_true",
                    help="run the writer against an in-memory copy of each tab")
    ap.add_argument("--publish-past", action="store_true",
                    help="publish overrides on days that have passed instead of dropping them")
    args = ap.parse_args()
    if args.apply and args.rehearse:
        sys.exit("choose --rehearse or --apply, not both")
    sources = {name: (SERVER / f"{name}.py").read_text(encoding="utf-8") for name in MODULES}
    script = (
        "import base64, json, pathlib\n"
        f"SRC = json.loads(base64.b64decode({base64.b64encode(json.dumps(sources).encode())!r}))\n"
        "d = pathlib.Path('/tmp/migrate-housecal-overrides'); d.mkdir(exist_ok=True)\n"
        "for k, v in SRC.items(): (d / (k + '.py')).write_text(v)\n"
        "ARGS = json.loads(" + repr(json.dumps({"apply": args.apply, "rehearse": args.rehearse,
                                                "publish_past": args.publish_past})) + ")\n"
        + BODY)
    proc = subprocess.run(["docker", "exec", "-i", CONTAINER, "python3", "-"],
                          input=script, capture_output=True, text=True, timeout=600)
    sys.stdout.write(proc.stdout)
    sys.stderr.write(proc.stderr)
    return proc.returncode


if __name__ == "__main__":
    sys.exit(main())
