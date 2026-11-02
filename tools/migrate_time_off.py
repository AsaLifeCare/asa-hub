#!/usr/bin/env python3
"""Carry the form's time off into the Time Off house, up to the cutover only; a plan unless --apply.

    python3 tools/migrate_time_off.py                  # the plan: counts and samples, nothing written
    python3 tools/migrate_time_off.py --apply          # writes, then reads the house back
    python3 tools/migrate_time_off.py --apply --cutover <ISO instant>
"""
import argparse
import ast
import base64
import json
import os
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve()
SERVER = HERE.parent.parent / "server"
CONTAINER = os.getenv("HUB_RELAY_CONTAINER", "asa-hub-snapshot")
ROOTS = ("time_off", "calendar_builder_houses", "calendar_builder_slices", "redaction")

BODY = r'''
import os, sys
from collections import Counter
import psycopg2
import time_off
import shift_requests as sr

DSN = os.environ["HUB_SNAPSHOT_PG_DSN"]
MASTER = time_off.MASTER_SHEET_ID
with psycopg2.connect(DSN) as c, c.cursor() as cur:
    cur.execute("SELECT row_number, data FROM asa_drive_sheets_rows WHERE sheet_id=%s AND tab_name=%s "
                "ORDER BY row_number", (MASTER, time_off.FORM_TAB))
    form = [(int(rn), d) for rn, d in cur.fetchall()]
    cur.execute("SELECT row_number, data FROM asa_drive_sheets_rows WHERE sheet_id=%s AND tab_name=%s "
                "ORDER BY row_number", (MASTER, time_off.ARCHIVE_TAB))
    archive = [(int(rn), d) for rn, d in cur.fetchall()]
    cur.execute("SELECT coalesce(nullif(entity_name,''), display_name) FROM asa_users "
                "WHERE active IS NOT FALSE AND (merged_into IS NULL OR merged_into::text = '')")
    accounts = sorted({str(r[0]).strip() for r in cur.fetchall() if str(r[0] or "").strip()})
    cur.execute("SELECT last_sync_at, modified_time FROM asa_drive_sheets_meta WHERE sheet_id=%s", (MASTER,))
    meta = cur.fetchone()
est = sr.estate(DSN)
grid = sorted({n for loc in est["locations"] for n in est["people"].get(loc, []) if not sr.not_a_person(n, loc)})
v = time_off.view(DSN, fresh=True)
keys = {str(r.get("source_key") or "") for r in v["rows"]}
live_keys = set()
if v["minted"]:
    house = time_off._house(v["id"])
    values = house.values(time_off.TAB)
    head = [str(h).strip() for h in (values[0] if values else [])]
    if "source_key" in head:
        i = head.index("source_key")
        live_keys = {str(r[i]).strip() for r in values[1:] if len(r) > i and str(r[i]).strip()}
held_cutover = str(v["settings"].get("form_cutover_at") or "").strip()
if held_cutover and ARGS["cutover"] and time_off._at(ARGS["cutover"]) != time_off._at(held_cutover):
    print(f"REFUSED: the cutover is already {held_cutover} and is never moved — rows after it belong to the "
          f"form sync, which asks both approvers")
    sys.exit(2)
newest = max((time_off._form_ts(time_off._field(d, "Timestamp")) for _rn, d in form), default=None,
             key=lambda t: t.timestamp() if t else 0)
cutover = held_cutover or ARGS["cutover"] or (time_off.stamp(newest) if newest else time_off.stamp())
bound = time_off._at(cutover)
if bound is None:
    print(f"REFUSED: the cutover {cutover!r} is not an ISO instant")
    sys.exit(2)
print(f"cutover: {cutover} ({'already set — kept' if held_cutover else 'set by this run'}); form rows after it "
      f"are the form sync's, never migrated")
plan = time_off.plan_migration({"staff_requests": form, "requests_archive": archive}, keys | live_keys,
                               grid_names=grid, accounts=accounts, today=time_off.today(),
                               houses_of=lambda p, a, b: time_off.houses_for(est, p, a, b), until=bound)
rows = plan["rows"]
print(f"sources: {len(form)} Staff Requests rows, {len(archive)} Requests Archive rows "
      f"({sum(1 for _r, d in archive if time_off._field(d, 'Request Type').lower() in ('vacation', 'vacation request'))} vacation)")
print(f"the house: {'minted ' + v['id'][:14] + '…' if v['minted'] else 'NOT MINTED'} — "
      f"{len(v['rows'])} rows, {len(keys | live_keys)} source keys already there")
print("plan counts:", json.dumps(plan["counts"]))
by = Counter(r["status"] for r in rows)
print(f"to append: {len(rows)} — " + ", ".join(f"{n} {k}" for k, n in sorted(by.items())))
for status in ("scheduled", "needs_review", "history"):
    sample = [r for r in rows if r["status"] == status][:10]
    if sample:
        print(f"\n  {status} (first {len(sample)}):")
        for r in sample:
            print(f"    {r['person'][:28]:<28} {r['start_date'] or '?':<10} → {r['end_date'] or '?':<10} "
                  f"{r['source'].split(':')[0]:<6} rows {r['source_rows']:<10} {r['flags']}")
if not ARGS["apply"]:
    print("\n(a plan only — nothing was written)")
    sys.exit(0)
if not v["minted"]:
    print("\nREFUSED --apply: the Time Off house is not minted — run tools/mint_time_off_house.py first")
    sys.exit(2)
if not meta or not meta[0] or not meta[1] or meta[0] < meta[1]:
    print("\nREFUSED --apply: the Master Calendar Creator's mirror is older than the book "
          f"(synced {meta[0] if meta else 'never'}, changed {meta[1] if meta else '?'}) — wait for the keeper")
    sys.exit(2)
relay_rule = os.path.join(RELAY_DIR, "redaction.py")
if not os.path.isfile(relay_rule) or open(relay_rule, encoding="utf-8").read() != SRC["redaction"]:
    print("\nREFUSED --apply: the relay's redaction rule is not this checkout's — restart the relay on this "
          "code first, so a reason can never reach the mirror unwithheld")
    sys.exit(2)
taken = {str(r.get("id") or "") for r in v["rows"]}
for r in rows:
    r["id"] = time_off.new_ref(taken)
    taken.add(r["id"])
wrote = 0
for i in range(0, len(rows), 200):
    try:
        wrote += len(time_off.append_rows(DSN, time_off.TAB, rows[i:i + 200]))
    except time_off.Refused as exc:
        print(f"\nSTOPPED after {wrote} row(s): {exc.why} — run it again with the same cutover; it appends "
              f"only what is missing")
        sys.exit(1)
if not held_cutover:
    time_off.write_setting(DSN, "form_cutover_at", cutover, "set by tools/migrate_time_off.py --apply")
if not rows:
    print("\nnothing to append — every source row up to the cutover is already in the house")
    sys.exit(0)
back = time_off._house(v["id"]).values(time_off.TAB)
head = [str(h).strip() for h in back[0]]
i = head.index("source_key")
landed = {str(r[i]).strip() for r in back[1:] if len(r) > i}
missing = [r["source_key"] for r in rows if r["source_key"] not in landed]
print(f"\nWROTE {wrote} row(s); read back: {len(back) - 1} rows in the house, "
      f"{len(rows) - len(missing)} of {len(rows)} planned keys present"
      + (f", MISSING {missing[:5]}" if missing else ""))
print(f"form_cutover_at = {cutover}: Google Form rows after it are added as pending requests while form_sync is on")
'''


def _with_imports(roots: tuple[str, ...]) -> dict[str, str]:
    local = {p.stem for p in SERVER.glob("*.py")}
    sources: dict[str, str] = {}
    todo = list(roots)
    while todo:
        name = todo.pop()
        if name in sources:
            continue
        sources[name] = (SERVER / f"{name}.py").read_text(encoding="utf-8")
        for node in ast.walk(ast.parse(sources[name])):
            if isinstance(node, ast.Import):
                todo += [a.name.split(".")[0] for a in node.names]
            elif isinstance(node, ast.ImportFrom) and node.module and not node.level:
                todo.append(node.module.split(".")[0])
        todo = [n for n in todo if n in local]
    return sources


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--apply", action="store_true", help="write the planned rows")
    ap.add_argument("--dry-run", action="store_true", help="the plan only (the default)")
    ap.add_argument("--cutover", default="", help="form_cutover_at (ISO); default: the newest form row migrated")
    args = ap.parse_args()
    sources = _with_imports(ROOTS)
    extra = SERVER / "ist_config_defaults.json"
    if extra.is_file():
        sources["ist_config_defaults.json"] = extra.read_text(encoding="utf-8")
    here = f"/tmp/migrate-time-off-{os.getpid()}-{int(time.time() * 1000) % 100000}"
    script = (
        "import base64, json, os, pathlib, shutil, sys\n"
        f"SRC = json.loads(base64.b64decode({base64.b64encode(json.dumps(sources).encode())!r}))\n"
        f"d = pathlib.Path({here!r}); d.mkdir(parents=True, exist_ok=True)\n"
        "for k, v in SRC.items(): (d / (k if k.endswith('.json') else k + '.py')).write_text(v)\n"
        "RELAY_DIR = os.getcwd()\n"
        "sys.path[:] = [p for p in sys.path if p not in ('', os.getcwd())]\n"
        f"sys.path.insert(0, {here!r})\n"
        "ARGS = json.loads(" + repr(json.dumps({"apply": bool(args.apply and not args.dry_run),
                                                "cutover": args.cutover})) + ")\n"
        "try:\n"
        + "".join("    " + line + "\n" for line in BODY.splitlines())
        + "finally:\n"
        f"    shutil.rmtree({here!r}, ignore_errors=True)\n")
    proc = subprocess.run(["docker", "exec", "-i", CONTAINER, "python3", "-"],
                          input=script, capture_output=True, text=True, timeout=900)
    sys.stdout.write(proc.stdout)
    sys.stderr.write(proc.stderr)
    return proc.returncode


if __name__ == "__main__":
    sys.exit(main())
