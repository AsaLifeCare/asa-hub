#!/usr/bin/env python3
"""
Bring each ACTIVE staff's PsiAnywhere presence onto their perf_staff row.

The PsiAnywhere data belongs on the active staff rows; the login and password
are already in the props.

IT NEVER SIGNS IN TO PSIANYWHERE. It reads the platform's stored copy
(asa_psi_time_entries) only. The sign-in this file once carried used the
PSI_USER / PSI_PASS pair in the old platform's .env — the old director's
account, which PsiAnywhere answers "Not active" — on port 8443, and every
further try is one more failed attempt against a real account. PsiAnywhere
has one reader on this platform: the relay (server/psi_anywhere.py and
server/psi_attendance.py), on its own account and one shared login clock.
A tool that needs live entries reads the relay's own (server/psi_entries.py),
never a second login.

WHAT LANDS: three columns appended at the RIGHT of the perf_staff house
(guide §5 — safe, the 6h schema sweep records them, readers that don't ask
ignore them): psi_people_id · psi_last_service · psi_hours_14d, plus
psi_synced_at. Matching is by normalized name; names that match nothing
are NAMED in the output, never guessed. The house resolves through its
switchboard pointer — no id typed here.

    python3 tools/import_psi_staff.py --dry-run
    python3 tools/import_psi_staff.py
"""
from __future__ import annotations

import json
import re
import sys
import urllib.parse
import urllib.request
from pathlib import Path

ENV_PATH = Path("/opt/docker/asa-hub/server/.tools.env")
ESSENCIAL_ID = "1Y6UMJlCS5gHur52f0YrPsLSqwYlCA792I8gAiZsxsug"
TAB = "perf_staff"
WINDOW_DAYS = 14


def env(k: str) -> str:
    for line in ENV_PATH.read_text().splitlines():
        line = line.strip()
        if line.startswith(f"{k}="):
            return line.split("=", 1)[1].strip().strip("'\"")
    sys.exit(f"{k} not found in {ENV_PATH}")


def key(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", str(name or "").lower()).strip("_")


def fl_key(name: str) -> str:
    """First+last-token key, apostrophes and middle initials blind —
    'Kashyia T. Williams' and 'Kashyia Williams' meet here, and so do
    "Na'tajiah" and "Natajiah". Only a FALLBACK: the full key matches first."""
    toks = re.sub(r"[^a-z ]+", "", str(name or "").lower()).split()
    return f"{toks[0]}_{toks[-1]}" if len(toks) >= 2 else (toks[0] if toks else "")


# ── sheets, depot-resolved ──────────────────────────────────────────────
def gtoken() -> str:
    body = urllib.parse.urlencode({
        "client_id": env("GS_GOOGLE_CLIENT_ID"),
        "client_secret": env("GS_GOOGLE_CLIENT_SECRET"),
        "refresh_token": env("GS_GOOGLE_REFRESH_TOKEN"),
        "grant_type": "refresh_token"}).encode()
    req = urllib.request.Request("https://oauth2.googleapis.com/token", data=body, method="POST")
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)["access_token"]


def sheet_api(tok: str, sid: str, path: str, method: str = "GET", payload: dict | None = None) -> dict:
    req = urllib.request.Request(f"https://sheets.googleapis.com/v4/spreadsheets/{sid}{path}",
                                 data=json.dumps(payload).encode() if payload is not None else None,
                                 method=method)
    req.add_header("Authorization", f"Bearer {tok}")
    req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, timeout=120) as r:
        raw = r.read()
        return json.loads(raw) if raw else {}


def main() -> None:
    dry = "--dry-run" in sys.argv
    tok = gtoken()

    depot = {}
    for r in (sheet_api(tok, ESSENCIAL_ID,
                        "/values/" + urllib.parse.quote("'Facts'!A2:I999999")).get("values") or []):
        if len(r) > 4 and r[4]:
            depot[str(r[4])] = str(r[2]) if len(r) > 2 else ""
    house = depot.get("switchboard:props.HUB_HOUSE_PERF_STAFF_ID", "").strip()
    if not house:
        sys.exit("no HUB_HOUSE_PERF_STAFF_ID pointer in the depot — declare it first.")

    # ── the Psi side: the platform's OWN mirror (asa_psi_time_entries) ──
    # The live WCF is unreachable from this host (port 8443 times out — the
    # same block that likely killed the 4h sync job), and
    # unnecessary: the ingest job fed the table until it stopped. The window
    # anchors on the mirror's REAL last day, and psi_synced_at carries the
    # mirror's own stamp so staleness is visible on every row, never hidden.
    import subprocess

    def psql(sql: str) -> list[list[str]]:
        out = subprocess.run(["docker", "exec", "asa-hub-db", "psql", "-U", "asa_hub",
                              "-d", "asa_hub", "-tAF", "\x1f", "-c", sql],
                             capture_output=True, text=True, timeout=120)
        if out.returncode != 0:
            sys.exit(f"postgres refused: {out.stderr.strip()[:200]}")
        return [ln.split("\x1f") for ln in out.stdout.splitlines() if ln.strip()]

    anchor_row = psql("select max(to_date(date_service,'MM/DD/YYYY'))::text, "
                      "max(synced_at)::text from app.asa_psi_time_entries")[0]
    anchor, mirror_synced = anchor_row[0], anchor_row[1][:19] + "Z"
    rows_pg = psql(
        "select employee, coalesce(raw->>'peopleId',''), "
        "to_date(date_service,'MM/DD/YYYY')::text, coalesce(hours,0) "
        "from app.asa_psi_time_entries "
        f"where to_date(date_service,'MM/DD/YYYY') >= (date '{anchor}' - interval '{WINDOW_DAYS} days')")
    per: dict[str, dict] = {}
    for nm, pid, dos, hrs in rows_pg:
        k = key(nm)
        if not k:
            continue
        d = per.setdefault(k, {"name": nm.strip(), "people_id": pid, "hours": 0.0, "last": ""})
        try:
            d["hours"] += float(hrs or 0)
        except Exception:
            pass
        if dos > d["last"]:
            d["last"] = dos
        if not d["people_id"]:
            d["people_id"] = pid
    print(f"psi mirror: {len(rows_pg)} entries in the {WINDOW_DAYS}d window ending {anchor} "
          f"(mirror last synced {mirror_synced}) · {len(per)} distinct staff")
    per_fl = {}
    for d in per.values():
        per_fl.setdefault(fl_key(d["name"]), d)

    # ── the staff side: the perf_staff house, ACTIVE rows ───────────────
    # the router's naming law: the original tab name first, then Data —
    # and a missing tab answers HTTP 400, not an empty grid
    vals, tabname = [], "Data"
    try:
        got = sheet_api(tok, house, "/values/" + urllib.parse.quote(f"'{TAB}'!A1:BZ5000"))
        if got.get("values"):
            vals, tabname = got["values"], TAB
    except Exception:
        pass
    if not vals:
        vals = sheet_api(tok, house,
                         "/values/" + urllib.parse.quote("'Data'!A1:BZ5000")).get("values") or []
    if not vals:
        sys.exit("the perf_staff house answered empty — refusing (broken read, not empty staff).")
    hdr = [str(h).strip() for h in vals[0]]
    rows = [{hdr[i]: (r[i] if i < len(r) else "") for i in range(len(hdr))} for r in vals[1:]]

    # ensure the four columns exist AT THE RIGHT (never reorder existing)
    NEW_COLS = ["psi_people_id", "psi_last_service", "psi_hours_14d", "psi_synced_at"]
    added = [c for c in NEW_COLS if c not in hdr]
    full_hdr = hdr + added

    now = mirror_synced   # the mirror's own stamp: staleness stays visible
    matched, updates = 0, []
    unmatched_staff: list[str] = []
    for n, r in enumerate(rows, start=2):
        status = str(r.get("status", "")).strip().lower()
        nm = str(r.get("name", "")).strip()
        if not nm or status not in ("active", ""):
            continue
        hit = per.get(key(nm))
        if not hit:
            hit = per_fl.get(fl_key(nm))
        if not hit:
            unmatched_staff.append(nm)
            continue
        matched += 1
        vals4 = [hit["people_id"], hit["last"], f"{hit['hours']:.2f}", now]
        c0 = full_hdr.index(NEW_COLS[0])
        colA1 = ""
        i = c0
        while i >= 0:
            colA1 = chr(ord("A") + i % 26) + colA1
            i = i // 26 - 1
        updates.append({"range": f"'{tabname}'!{colA1}{n}", "values": [vals4]})

    psi_only = sorted(d["name"] for k2, d in per.items()
                      if k2 not in {key(str(r.get('name', ''))) for r in rows})
    print(f"active staff matched      : {matched}")
    print(f"active staff NOT in psi   : {len(unmatched_staff)}")
    for nm in sorted(unmatched_staff):
        print(f"   {nm}")
    if psi_only:
        print(f"psi staff NOT on perf_staff ({len(psi_only)}):")
        for nm in psi_only:
            print(f"   {nm}")

    if dry:
        print("\n--dry-run: nothing written.")
        return
    if added:
        # the grid must GROW first — a values write past columnCount is a
        # bare HTTP 400, not an auto-expand (found live: 11-column grid)
        meta = sheet_api(tok, house, "?fields=sheets.properties(title,sheetId,gridProperties)")
        for sh in meta.get("sheets", []):
            p = sh["properties"]
            if p["title"] == tabname:
                need = len(full_hdr) - int(p["gridProperties"].get("columnCount", 0))
                if need > 0:
                    sheet_api(tok, house, ":batchUpdate", "POST", {"requests": [{
                        "appendDimension": {"sheetId": p["sheetId"],
                                            "dimension": "COLUMNS", "length": need}}]})
                break
        c0 = len(hdr)
        colA1 = ""
        i = c0
        while i >= 0:
            colA1 = chr(ord("A") + i % 26) + colA1
            i = i // 26 - 1
        sheet_api(tok, house, "/values/" + urllib.parse.quote(f"'{tabname}'!{colA1}1") +
                  "?valueInputOption=RAW", "PUT", {"values": [added]})
        print(f"appended column(s): {', '.join(added)}")
    if updates:
        sheet_api(tok, house, "/values:batchUpdate", "POST",
                  {"valueInputOption": "RAW", "data": updates})
    print(f"\nwrote psi presence onto {matched} active staff row(s).")


if __name__ == "__main__":
    main()
