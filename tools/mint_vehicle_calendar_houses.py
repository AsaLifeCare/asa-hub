#!/usr/bin/env python3
"""
Mint the five Transportation houses as asatech and declare them (pointer, moved switch, schema, Registry row):
`ASA Data — Transportation Vehicles / Trips / Inbox / Log / Settings`, one `Data` tab each, placed in the ASA Data
folder the relay's mirror walks. The headers are read from apps-script/VehicleCalendar.gs (VC_HEADERS), the one
declaration. Re-runnable: a live header is never re-stamped. Mints and stops; Apps Script is the only writer.

    python3 tools/mint_vehicle_calendar_houses.py              # dry run: reads the depot, writes nothing
    python3 tools/mint_vehicle_calendar_houses.py --apply [--share]

`vc_inbox` is always shared with the sheet keeper on --apply: the relay reads My Work and My Inbox items from its
mirror. --share asks the keeper for read on the other four too.
"""
from __future__ import annotations

import base64
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

ENV_PATH = Path("/opt/docker/asa-hub/server/.tools.env")
ESSENCIAL_ID = "1Y6UMJlCS5gHur52f0YrPsLSqwYlCA792I8gAiZsxsug"
DATA_FOLDER_ID = "1OrV0WThUZo-bo7KPlMt7H6s1HyUflruS"   # ASA Data: the folder the mirror walks
SA_JSON_PATHS = [Path("/opt/docker/asa-hub/server/.service-account.json")]
RECORDED_BY = "mint-vehicle-calendar"
MODULE = Path(__file__).resolve().parent.parent / "apps-script" / "VehicleCalendar.gs"
KEEPER_ACCOUNT = (os.getenv("GOOGLE_IMPERSONATE_USER") or "").strip()
DRIVE_SCOPELESS = "insufficient authentication scopes"
HOUSE_DATA_TAB = "Data"

HOUSES = [
    {"tab": "vc_vehicles", "title": "ASA Data — Transportation Vehicles", "rows": 200, "keeper": False,
     "note": "data: vc_vehicles (the team's vehicles: name, seats, wheelchair access, availability; VehicleCalendar.gs)"},
    {"tab": "vc_trips", "title": "ASA Data — Transportation Trips", "rows": 20000, "keeper": False,
     "note": "data: vc_trips (one row per vehicle request; it becomes the scheduled trip and keeps its own history)"},
    {"tab": "vc_inbox", "title": "ASA Data — Transportation Inbox", "rows": 10000, "keeper": True,
     "note": "data: vc_inbox (one row per recipient: My Work approvals and My Inbox informatives; mirrored for the relay)"},
    {"tab": "vc_log", "title": "ASA Data — Transportation Log", "rows": 20000, "keeper": False,
     "note": "data: vc_log (every act: request, answer, withdraw, assign, cancel, vehicle edits, import, seed)"},
    {"tab": "vc_settings", "title": "ASA Data — Transportation Settings", "rows": 200, "keeper": False,
     "note": "data: vc_settings (directors, trip types, approvers' text numbers, the import's assumed length)"},
]

S = "https://sheets.googleapis.com/v4/spreadsheets/"
D = "https://www.googleapis.com/drive/v3/files/"
TOK = ""


def prop_of(tab: str) -> str:
    return f"HUB_HOUSE_{tab.upper()}_ID"


def declared_headers() -> dict[str, list[str]]:
    """VC_HEADERS from VehicleCalendar.gs: { tab: [column, …] }, refused when a house is missing from it."""
    src = MODULE.read_text(encoding="utf-8")
    block = re.search(r"var VC_HEADERS = \{(.*?)\n\};", src, re.S)
    if not block:
        raise SystemExit(f"VC_HEADERS is not declared in {MODULE}")
    out: dict[str, list[str]] = {}
    for m in re.finditer(r"(\w+):\s*\[(.*?)\]", block.group(1), re.S):
        out[m.group(1)] = re.findall(r"'([^']*)'", m.group(2))
    missing = [h["tab"] for h in HOUSES if not out.get(h["tab"])]
    if missing:
        raise SystemExit(f"VC_HEADERS in {MODULE} has no header for {', '.join(missing)}")
    return out


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
    """Facts, last row wins per Source — the depot's own reading law."""
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


def text_format(sid: str) -> None:
    """Every cell is text, so an ISO instant or an id stays what was written."""
    meta = api(S + sid + "?fields=sheets.properties")
    gid = next((s["properties"]["sheetId"] for s in meta.get("sheets") or []
                if s["properties"].get("title") == HOUSE_DATA_TAB), None)
    if gid is None:
        print(f"  WARNING: no tab '{HOUSE_DATA_TAB}' to format")
        return
    api(S + sid + ":batchUpdate", {"requests": [{"repeatCell": {
        "range": {"sheetId": gid},
        "cell": {"userEnteredFormat": {"numberFormat": {"type": "TEXT"}}},
        "fields": "userEnteredFormat.numberFormat"}}]}, "POST")
    print("  every cell formatted as text")


def into_data_folder(sid: str) -> None:
    """The house moves into the ASA Data folder, the one the mirror walks; a credential without Drive says how."""
    try:
        meta = api(D + sid + "?fields=parents&supportsAllDrives=true")
        parents = [str(p) for p in (meta.get("parents") or [])]
        if DATA_FOLDER_ID in parents:
            print("  already in the ASA Data folder")
            return
        url = (D + sid + "?addParents=" + DATA_FOLDER_ID + "&supportsAllDrives=true" +
               ("&removeParents=" + ",".join(parents) if parents else ""))
        api(url, {}, "PATCH")
        print(f"  moved into the ASA Data folder ({DATA_FOLDER_ID[:12]}…)")
    except Exception as exc:  # noqa: BLE001
        said = str(exc)
        if DRIVE_SCOPELESS in said or "403" in said:
            print(f"  THE MOVE COULD NOT BE MADE FROM HERE (this credential has no Drive scope).\n"
                  f"    Open the book in Drive → Move → ASA Data ({DATA_FOLDER_ID}), or the mirror never sees it.")
        else:
            print(f"  WARNING: the move into ASA Data failed ({said[:110]}) — move it by hand")


def touch(sid: str) -> None:
    """A write moves modifiedTime, which is the only thing the keeper lists a book by."""
    try:
        rng = urllib.parse.quote(f"'{HOUSE_DATA_TAB}'!A1")
        got = api(S + sid + "/values/" + rng + "?valueRenderOption=FORMULA").get("values") or []
        value = got[0][0] if got and got[0] else ""
        api(S + sid + "/values/" + rng + "?valueInputOption=RAW",
            {"range": f"'{HOUSE_DATA_TAB}'!A1", "majorDimension": "ROWS", "values": [[value]]}, "PUT")
        print("  touched: A1 written back with what it already held")
    except Exception as exc:  # noqa: BLE001
        print(f"  WARNING: the touch failed ({str(exc)[:110]}) — edit one cell by hand or the house stays"
              " out of the mirror")


def share_with_keeper(sid: str) -> None:
    who = KEEPER_ACCOUNT or sa_email()
    if not who:
        print("  the keeper's account could not be read — nobody to share with")
    else:
        try:
            api(D + sid + "/permissions?sendNotificationEmail=false&supportsAllDrives=true",
                {"role": "reader", "type": "user", "emailAddress": who}, "POST")
            print(f"  shared with {who} (reader)")
        except Exception as exc:  # noqa: BLE001
            said = str(exc)
            if DRIVE_SCOPELESS in said or "403" in said:
                print(f"  THE READ GRANT COULD NOT BE MADE FROM HERE (this credential has no Drive scope).\n"
                      f"    Open the book in Drive → Share → add {who} as Viewer, then re-run with --apply.")
            else:
                print(f"  the read grant was not added ({said[:110]}) — it may already be there")
    touch(sid)


def mint(house: dict, header: list[str], have: dict[str, str], now: str, sa: str, apply: bool,
         share: bool) -> str:
    tab, title = house["tab"], house["title"]
    prop = prop_of(tab)
    keeper = share or house["keeper"]
    src_ptr = f"switchboard:props.{prop}"
    sid = have.get(src_ptr, "").strip()
    print(f"\n{title}")
    if sid:
        print(f"· {tab}: pointer already in the depot ({sid[:14]}…) — reusing the house")
    if not apply:
        print(f"  dry run: would {'reuse' if sid else 'create'} \"{title}\" (tab {HOUSE_DATA_TAB}, {len(header)} cols, "
              f"{house['rows']} rows) in the ASA Data folder, append the facts {prop} / moved.{tab} / "
              f"schema.{tab}.header and the Registry row" +
              (", ask the keeper for read and touch the book" if keeper else "") + ".")
        return sid or "(would create)"

    live_header = None
    if sid:
        got = api(S + sid + "/values/" + urllib.parse.quote(f"'{HOUSE_DATA_TAB}'!1:1")).get("values") or []
        live_header = [str(h) for h in (got[0] if got else []) if str(h).strip()]
        if live_header:
            header = live_header
            print(f"  live header kept ({len(header)} cols); the declaration follows it")
    if not sid:
        sid = api(S, {"properties": {"title": title},
                      "sheets": [{"properties": {
                          "title": HOUSE_DATA_TAB,
                          "gridProperties": {"rowCount": house["rows"], "columnCount": len(header) + 3,
                                             "frozenRowCount": 1}}}]}, "POST")["spreadsheetId"]
        print(f"  house created as asatech: {title} = {sid}")
        text_format(sid)
    into_data_folder(sid)
    if not live_header:
        api(S + sid + "/values/" + urllib.parse.quote(f"'{HOUSE_DATA_TAB}'!A1") + "?valueInputOption=RAW",
            {"values": [header]}, "PUT")
        print(f"  header stamped ({len(header)} cols)")

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
            ":append?valueInputOption=RAW&insertDataOption=INSERT_ROWS", {"values": facts}, "POST")
    fresh = depot_state()
    assert fresh.get(src_ptr) == sid, f"{tab}: pointer did not land"
    assert fresh.get(f"switchboard:moved.{tab}") == "on", f"{tab}: moved switch did not land"
    print(f"  declared: {prop} → {sid[:14]}… · moved.{tab}=on · schema ({len(header)} cols)")

    reg = api(S + ESSENCIAL_ID + "/values/" + urllib.parse.quote("'Registry'!A2:D9999")).get("values") or []
    if any(len(r) > 0 and str(r[0]).strip().lower() == f"data.{tab}" for r in reg):
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
        except Exception as exc:  # noqa: BLE001
            print(f"  WARNING: share failed ({str(exc)[:100]}) — only Apps Script writes this house")
    if keeper:
        share_with_keeper(sid)
    else:
        print("  NOT shared with the sheet keeper: in no mirror and no master JSON until --share")
    return sid


def main() -> None:
    global TOK
    apply = "--apply" in sys.argv
    share = "--share" in sys.argv
    headers = declared_headers()
    TOK = token()
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    have = depot_state()
    sa = sa_email()
    print(f"service account for the share: {sa or 'NOT FOUND — the share will be skipped'}")
    minted = {h["tab"]: mint(h, list(headers[h["tab"]]), have, now, sa, apply, share) for h in HOUSES}
    if not apply:
        print("\ndry run: nothing was written. Re-run with --apply to mint.")
        return
    print()
    for tab, sid in minted.items():
        print(f"data.{tab} → {sid}")
    print("THE HOUSES ARE LIVE inside the 300s switchboard cache. vc_inbox reaches the relay once the keeper lists it;")
    print("until then My Work and My Inbox say the Transportation items are not in the mirror yet.")
    print("Then the master presses Setup & import → Seed vehicles (dry run, then Apply) and Import Van Calendar.")


if __name__ == "__main__":
    main()
