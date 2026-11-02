#!/usr/bin/env python3
"""
MINT THE FULL PUNCH HOUSE — `ASA Data — PsiPunchesFull`, one tab, `psi_punches_full`.

A sheet with ALL the punches is MANDATORY, with the maximum information
possible — EVERYTHING, INCLUDING THE CLIENT. The relay builds that
record (server/psi_punches_full.py: every field of the stored copy and of every
live read, the clients present, the place, the GPS point and the comments
included) and hands it to `psiPunchesFullIngest` (apps-script/PsiPunches.gs).
This mints the house that door writes, and stops.

WHY ITS OWN HOUSE, AND NOT A TAB BESIDE `psi_punches`. Measured before this was
written: the `ASA Data — PsiPunches` house tools/mint_psi_punches_house.py
describes was never minted — the depot holds no HUB_HOUSE_PSI_PUNCHES_ID, no
moved.psi_punches and no data.psi_punches — and the `psi_punches` tab the
staff-hours feed fills sits in `ASA Hub — Core`, beside the accounts and the
sessions (the relay's sheet-sync index says so). A tab "in the same house"
would put clients' addresses and coordinates into the platform's core book.
And widening `psi_punches` would put them on the `psiPunches` sheet route,
which the deposit serves to the screen. So the full record gets a declared
house of its own, in ASA Data, the way every house here is made:

  1. mint `ASA Data — PsiPunchesFull` as the platform account, one tab,
     header on row 1 (server/psi_punches_full.HEADER — the list the door
     declares too), frozen, 6,000 rows;
  2. three depot facts in the Facts tab —
       switchboard:props.HUB_HOUSE_PSI_PUNCHES_FULL_ID → the house id
       switchboard:moved.psi_punches_full            → on
       schema:psi_punches_full.header                → the header JSON

AND TWO THINGS THE STAFF-HOURS MINT DOES THAT THIS ONE DOES NOT, ON PURPOSE.
No Registry row: a `data.*` context is a book the runtime engine walks every
hour, and a punch record has no conditions to judge — a quarter of a million
cells read for nothing. No share with the service account: the only writer is
Apps Script as the platform account (the owner), and the relay never reads the
sheet back (its rows are the relay's own JSON first). `--share` adds the share
for whoever decides otherwise.

WHAT KEEPS IT OUT OF THE POSTGRES MIRROR IS NOT THE MISSING SHARE. The sheet
sync lists as jarvis@, and the gather (runGatherDatabaseMove) moves every
declared house — this one included — into the folder whose ASA Data houses
are all mirrored. The keeper itself refuses it (server/hub_sheet_sync.py,
KEEP_OUT_TITLES and KEEP_OUT_POINTERS): by the title minted here and by the
pointer written here, before a request is spent on it — so clients' addresses
are never copied into the tables the chat context and the session gate read,
nor onto the Sheets quota the relay already runs short of. Keep the title and
the pointer name in step with that list (tools/test-psi-punches-sheet.py holds
the two).

Re-runnable: an existing pointer reuses the house and never re-stamps a live
header. The door reads the declaration through a 300-second switchboard cache,
so the first pass lands within minutes of this; until then it answers 409
`missing_tab` and the relay holds the feed (server/psi_punches_full.HOLD_S).

    python3 tools/mint_psi_punches_full_house.py --dry-run
    python3 tools/mint_psi_punches_full_house.py            [--share]

It MINTS AND STOPS. The relay fills the house.
"""
from __future__ import annotations

import base64
import json
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve()
sys.path.insert(0, str(HERE.parent.parent / "server"))
import psi_punches_full  # noqa: E402

ENV_PATH = Path("/opt/docker/asa-hub/server/.tools.env")
ESSENCIAL_ID = "1Y6UMJlCS5gHur52f0YrPsLSqwYlCA792I8gAiZsxsug"
SA_JSON_PATHS = [Path("/opt/docker/asa-hub/server/.service-account.json")]
RECORDED_BY = "mint-psi-punches-full"
ROW_COUNT = 6000

HOUSE = {
    "tab": psi_punches_full.TAB,
    "title": "ASA Data — PsiPunchesFull",
    "prop": "HUB_HOUSE_PSI_PUNCHES_FULL_ID",
    "header": list(psi_punches_full.HEADER),
}

S = "https://sheets.googleapis.com/v4/spreadsheets/"
D = "https://www.googleapis.com/drive/v3/files/"


def env(k: str) -> str:
    for line in ENV_PATH.read_text().splitlines():
        line = line.strip()
        if line.startswith(f"{k}="):
            return line.split("=", 1)[1].strip().strip("'\"")
    sys.exit(f"{k} not found in {ENV_PATH}")


def token() -> str:
    body = urllib.parse.urlencode({
        "client_id": env("GS_GOOGLE_CLIENT_ID"),
        "client_secret": env("GS_GOOGLE_CLIENT_SECRET"),
        "refresh_token": env("GS_GOOGLE_REFRESH_TOKEN"),
        "grant_type": "refresh_token"}).encode()
    req = urllib.request.Request("https://oauth2.googleapis.com/token", data=body, method="POST")
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)["access_token"]


def api(tok: str, url: str, payload: dict | None = None, method: str = "GET", tries: int = 6) -> dict:
    for a in range(tries):
        req = urllib.request.Request(url, method=method)
        req.add_header("Authorization", "Bearer " + tok)
        body = json.dumps(payload).encode() if payload is not None else None
        if body:
            req.add_header("Content-Type", "application/json")
        try:
            with urllib.request.urlopen(req, body, timeout=120) as resp:
                raw = resp.read()
                return json.loads(raw) if raw else {}
        except Exception as err:  # noqa: BLE001
            if getattr(err, "code", 0) in (400, 403, 404):
                raise
            if a < tries - 1:
                time.sleep(5 * (a + 1))
                continue
            raise
    return {}


def depot_state(tok: str) -> dict[str, str]:
    """Facts, last row wins per Source — the depot's own reading law."""
    rows = api(tok, S + ESSENCIAL_ID + "/values/"
               + urllib.parse.quote("'Facts'!A2:I999999")).get("values") or []
    state: dict[str, str] = {}
    for row in rows:
        if len(row) > 4 and row[4]:
            state[str(row[4])] = str(row[2]) if len(row) > 2 else ""
    return state


def sa_email() -> str:
    for p in SA_JSON_PATHS:
        try:
            raw = p.read_text().strip()
            info = json.loads(base64.b64decode(raw)) if not raw.startswith("{") else json.loads(raw)
            if info.get("client_email"):
                return str(info["client_email"])
        except Exception:  # noqa: BLE001
            continue
    return ""


def main() -> None:  # noqa: C901 — one flat recipe reads best
    dry = "--dry-run" in sys.argv
    share = "--share" in sys.argv
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    tok = token()
    have = depot_state(tok)
    tab, title, prop, header = HOUSE["tab"], HOUSE["title"], HOUSE["prop"], HOUSE["header"]
    src_ptr = f"switchboard:props.{prop}"
    sid = have.get(src_ptr, "")
    sa = sa_email() if share else ""
    print(f"{title}: pointer {'in the depot (' + sid[:14] + '…) — reusing the house' if sid else 'absent'}")
    if dry:
        print(f"--dry-run: would {'reuse' if sid else 'create'} \"{title}\" ({len(header)} columns, "
              f"{ROW_COUNT} rows) and append the three depot facts"
              f"{' and share it with ' + (sa or 'the service account (not found)') if share else ''}. "
              "Nothing was written.")
        return

    live_header = None
    if sid:
        # NEVER RE-STAMP A LIVE HOUSE: the door appends columns as the record
        # grows, and a header PUT over it would relabel columns without moving
        # a value.
        got = api(tok, S + sid + "/values/" + urllib.parse.quote(f"'{tab}'!1:1")).get("values") or []
        live_header = [str(h) for h in (got[0] if got else []) if str(h).strip()]
        if live_header:
            header = live_header
            print(f"  live header kept ({len(header)} columns); the declaration follows it")
    if not sid:
        sid = api(tok, S, {"properties": {"title": title},
                           "sheets": [{"properties": {
                               "title": tab,
                               "gridProperties": {"rowCount": ROW_COUNT,
                                                  "columnCount": len(header) + 3,
                                                  "frozenRowCount": 1}}}]}, "POST")["spreadsheetId"]
        print(f"  house created as the platform account: {title} = {sid}")
    if not live_header:
        api(tok, S + sid + "/values/" + urllib.parse.quote(f"'{tab}'!A1") + "?valueInputOption=RAW",
            {"values": [header]}, "PUT")
        print(f"  header stamped ({len(header)} columns)")

    facts = []
    if have.get(src_ptr) != sid:
        facts.append(["config.props." + prop.lower().replace("_", ""), prop, sid, "",
                      src_ptr, "", now, RECORDED_BY, ""])
    if have.get(f"switchboard:moved.{tab}") != "on":
        facts.append([f"config.moved.{tab}", f"moved.{tab}", "on", "",
                      f"switchboard:moved.{tab}", "", now, RECORDED_BY, ""])
    schema_val = json.dumps(header, separators=(",", ":"))
    if have.get(f"schema:{tab}.header") != schema_val:
        facts.append([f"schema.{tab}.header", "__schema", schema_val, "",
                      f"schema:{tab}.header", "", now, RECORDED_BY, ""])
    if facts:
        api(tok, S + ESSENCIAL_ID + "/values/" + urllib.parse.quote("'Facts'!A1") +
            ":append?valueInputOption=RAW&insertDataOption=INSERT_ROWS", {"values": facts}, "POST")
    fresh = depot_state(tok)
    assert fresh.get(src_ptr) == sid, f"{tab}: pointer did not land"
    assert fresh.get(f"switchboard:moved.{tab}") == "on", f"{tab}: moved switch did not land"
    print(f"  declared: {prop} → {sid[:14]}… · moved.{tab}=on · schema ({len(header)} columns)")

    if share and sa:
        try:
            api(tok, D + sid + "/permissions?sendNotificationEmail=false&supportsAllDrives=true",
                {"role": "writer", "type": "user", "emailAddress": sa}, "POST")
            print(f"  shared with {sa} (writer) — the relay's sheet-sync still keeps it out of the "
                  "mirror (hub_sheet_sync.KEEP_OUT_TITLES / KEEP_OUT_POINTERS)")
        except Exception as exc:  # noqa: BLE001
            print(f"  WARNING: share failed ({str(exc)[:100]})")
    else:
        print("  not shared with the service account and not in the Registry (see the header of "
              "this tool for why); the relay's sheet-sync keeps it out of the mirror by its title "
              "and its pointer, wherever the gather moves it")
    print(f"\nTHE HOUSE IS DECLARED inside the 300 s switchboard cache, and EMPTY: {tab} → {sid}.")
    print("The relay fills it — the live rows one pass after the next collection, the stored copy in "
          f"hourly batches of {psi_punches_full.BACKFILL_BATCH}.")


if __name__ == "__main__":
    main()
