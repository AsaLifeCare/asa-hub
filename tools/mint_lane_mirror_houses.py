#!/usr/bin/env python3
"""
MINT THE TWO MISSING LANE HOUSES — Support Queue and Daily Notes.

THE RULE: whatever is ours has to live in our own database — the data of those
sheets is copied across and our own internalized houses are created for it.
Three of the Hotline screen's books are somebody else's
workbooks — an estate form's tracker, the Emp360 work queue, the daily notes —
and the platform reads them straight. The pattern this estate already uses for
that is a HOUSE OF OURS fed by a sync, never a screen pointed at a stranger's
tab: `uiIncidents` was already declared that way (the pointer is on and the
house is an empty stub), and these two have no house at all.

So this mints them, with the header READ FROM THE BOOK ITSELF rather than typed
here — the lane maps its columns by the estate's own names, and a header
invented in this file would be a mirror nothing could read.

  1. mint `ASA Data — SupportQueue` (tab `supportQueue`) and
     `ASA Data — DailyNotes` (tab `dailyNotes`), header from the source book;
  2. three depot facts each —
       switchboard:props.HUB_HOUSE_<NAME>_ID → the house id
       switchboard:moved.<tab>               → on
       schema:<tab>.header                   → the header JSON
  3. one Registry row each;
  4. share with the service account.

IT MINTS AND STOPS. Nothing is copied here: the writer is LaneMirror.gs, which
feeds each house as the hotline files and again on a catch-up clock, so the
house is never a photograph.

    python3 tools/mint_lane_mirror_houses.py --dry-run
    python3 tools/mint_lane_mirror_houses.py
"""
from __future__ import annotations

import base64
import json
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

ENV_PATH = Path("/opt/docker/asa-hub/server/.tools.env")
ESSENCIAL_ID = "1Y6UMJlCS5gHur52f0YrPsLSqwYlCA792I8gAiZsxsug"
SA_JSON_PATHS = [Path("/opt/docker/asa-hub/server/.service-account.json")]
RECORDED_BY = "mint-lane-mirrors"
ROW_COUNT = 5000

# The one tab a house serves its rows from — the relay reads this name and
# nothing else (server/hotline_lanes.py, HOUSE_DATA_TAB), and Apps Script falls
# back to it (HouseFlip.gs). The resource's own name stays in the DECLARATIONS,
# where a reader looks for it; the tab is `Data` in every house.
HOUSE_DATA_TAB = "Data"

# Each house, and the book its header is read from — the same pair Estate.gs
# names in ESTATE_SOURCES, so the two cannot drift apart without somebody
# noticing here first.
HOUSES = [
    {
        "tab": "supportQueue",
        "title": "ASA Data — SupportQueue",
        "prop": "HUB_HOUSE_SUPPORTQUEUE_ID",
        "source_prop": "EMP360_WORK_QUEUE_ID",
        "source_tab": "Requests",
        "note": "data: supportQueue (our copy of the Employee Support Queue, fed by LaneMirror.gs)",
    },
    {
        # THE CALL-OFF FORM, CLONED DAILY (package 2: "Daily clone 'ASA Data —
        # CloneCallOffs'"). The estate's own form writes call-offs into a
        # tracker nobody here owns; the platform's call-off house holds what
        # the HOTLINE heard. Crossing them starts with having both, and the
        # clone is our copy of theirs — read-only, one direction, never the
        # record.
        "tab": "cloneCallOffs",
        "title": "ASA Data — CloneCallOffs",
        "prop": "HUB_HOUSE_CLONECALLOFFS_ID",
        "source_prop": "ESTATE_CALLOFFS_ID",
        "source_tab": "Master",
        "note": "data: cloneCallOffs (our daily copy of the estate call-off form, fed by LaneMirror.gs)",
    },
    {
        "tab": "dailyNotes",
        "title": "ASA Data — DailyNotes",
        "prop": "HUB_HOUSE_DAILYNOTES_ID",
        "source_prop": "ESTATE_NOTES_ID",
        "source_tab": "Notes",
        "note": "data: dailyNotes (our copy of the Staff Daily Notes, fed by LaneMirror.gs)",
    },
]


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


TOK = token()
S = "https://sheets.googleapis.com/v4/spreadsheets/"
D = "https://www.googleapis.com/drive/v3/files/"


def api(url: str, payload: dict | None = None, method: str = "GET", tries: int = 6) -> dict:
    for a in range(tries):
        req = urllib.request.Request(url, method=method)
        req.add_header("Authorization", "Bearer " + TOK)
        body = json.dumps(payload).encode() if payload is not None else None
        if body:
            req.add_header("Content-Type", "application/json")
        try:
            with urllib.request.urlopen(req, body, timeout=120) as resp:
                raw = resp.read()
                return json.loads(raw) if raw else {}
        except Exception as err:
            if getattr(err, "code", 0) in (400, 403, 404):
                raise
            if a < tries - 1:
                time.sleep(5 * (a + 1))
                continue
            raise
    return {}


def depot_state() -> dict[str, str]:
    rows = api(S + ESSENCIAL_ID + "/values/" + urllib.parse.quote("'Facts'!A2:I999999")).get("values") or []
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
        except Exception:
            continue
    return ""


def source_header(have: dict[str, str], house: dict) -> list[str]:
    """The estate book's own first row — the names the lane maps its columns by."""
    book = have.get(f"switchboard:props.{house['source_prop']}", "")
    if not book:
        sys.exit(f"{house['tab']}: {house['source_prop']} is not in the depot — nothing minted")
    got = api(S + book + "/values/" + urllib.parse.quote(f"'{house['source_tab']}'!1:1")).get("values") or []
    header = [str(h).strip() for h in (got[0] if got else []) if str(h).strip()]
    if not header:
        sys.exit(f"{house['tab']}: {house['source_tab']} has no header row — nothing minted")
    return header


def mint(house: dict, have: dict[str, str], now: str, sa: str, dry: bool) -> str:
    tab, title, prop = house["tab"], house["title"], house["prop"]
    src_ptr = f"switchboard:props.{prop}"
    sid = have.get(src_ptr, "")
    header = source_header(have, house)
    if sid:
        print(f"· {tab}: pointer already in the depot ({sid[:14]}…) — reusing the house")
    if dry:
        print(f"  --dry-run: would {'reuse' if sid else 'create'} \"{title}\" with the "
              f"{len(header)} column(s) of {house['source_tab']}: {', '.join(header[:6])}…")
        return sid or "(would create)"

    # A HOUSE KEEPS ITS ROWS IN A TAB CALLED `Data`, and that is not a
    # preference: the relay's lanes door reads exactly that tab (HOUSE_DATA_TAB,
    # server/hotline_lanes.py) and Apps Script falls back to it when a tab of
    # the resource's own name is absent. The first run of this tool named the
    # tab after the resource — readable, and invisible to the door that has to
    # read it. Renamed here rather than left for somebody to find as an empty
    # lane.
    if sid:
        for sh in (api(S + sid + "?fields=sheets.properties").get("sheets") or []):
            props = sh.get("properties") or {}
            if str(props.get("title") or "") == tab:
                api(S + sid + ":batchUpdate",
                    {"requests": [{"updateSheetProperties": {
                        "properties": {"sheetId": props.get("sheetId"), "title": HOUSE_DATA_TAB},
                        "fields": "title"}}]}, "POST")
                print(f"  tab renamed {tab} → {HOUSE_DATA_TAB} (what the lanes door reads)")

    live_header = None
    if sid:
        got = api(S + sid + "/values/" + urllib.parse.quote(f"'{HOUSE_DATA_TAB}'!1:1")).get("values") or []
        live_header = [str(h) for h in (got[0] if got else []) if str(h).strip()]
        if live_header:
            header = live_header
            print(f"  live header kept ({len(header)} cols)")
    if not sid:
        sid = api(S, {"properties": {"title": title},
                      "sheets": [{"properties": {
                          "title": HOUSE_DATA_TAB,
                          "gridProperties": {"rowCount": ROW_COUNT,
                                             "columnCount": len(header) + 3,
                                             "frozenRowCount": 1}}}]}, "POST")["spreadsheetId"]
        print(f"  house created as asatech: {title} = {sid}")
    if live_header is None:
        api(S + sid + "/values/" + urllib.parse.quote(f"'{HOUSE_DATA_TAB}'!A1") + "?valueInputOption=RAW",
            {"values": [header]}, "PUT")
        print(f"  header stamped from {house['source_tab']} ({len(header)} cols)")

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
        api(S + ESSENCIAL_ID + "/values/" + urllib.parse.quote("'Facts'!A1") +
            ":append?valueInputOption=RAW&insertDataOption=INSERT_ROWS",
            {"values": facts}, "POST")
    fresh = depot_state()
    assert fresh.get(src_ptr) == sid, f"{tab}: pointer did not land"
    print(f"  declared: {prop} → {sid[:14]}… · moved.{tab}=on · schema ({len(header)} cols)")

    reg = api(S + ESSENCIAL_ID + "/values/" + urllib.parse.quote("'Registry'!A2:D9999")).get("values") or []
    if any(len(r) > 0 and str(r[0]).strip().lower() == f"data.{tab}".lower() for r in reg):
        print("  Registry row already present (context)")
    elif any(len(r) > 1 and str(r[1]).strip() == sid for r in reg):
        print("  Registry row already present (spreadsheet)")
    else:
        api(S + ESSENCIAL_ID + "/values/" + urllib.parse.quote("'Registry'!A1") +
            ":append?valueInputOption=RAW&insertDataOption=INSERT_ROWS",
            {"values": [[f"data.{tab}", sid, "on", house["note"]]]}, "POST")
        print("  Registry row appended")

    if sa:
        try:
            api(D + sid + "/permissions?sendNotificationEmail=false&supportsAllDrives=true",
                {"role": "writer", "type": "user", "emailAddress": sa}, "POST")
            print(f"  shared with {sa} (writer)")
        except Exception as exc:
            print(f"  WARNING: share failed ({str(exc)[:90]}) — Apps Script is the writer, not fatal")
    return sid


def main() -> None:
    dry = "--dry-run" in sys.argv
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    have = depot_state()
    sa = sa_email()
    print(f"service account for the share: {sa or 'NOT FOUND — shares will be skipped'}")
    for house in HOUSES:
        print(f"\n{house['title']}")
        mint(house, have, now, sa, dry)
    if dry:
        print("\n--dry-run: nothing was written.")
        return
    print("\nBoth houses stand, EMPTY. LaneMirror.gs fills them — as the hotline files,")
    print("and again on its catch-up clock. Until it runs, the estate books answer,")
    print("which is what the lanes door's own guard is for.")


if __name__ == "__main__":
    main()
