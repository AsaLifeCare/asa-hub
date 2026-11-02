#!/usr/bin/env python3
"""Mint the CommWhen house the relay pushes into; its only writer is the relay's service account."""
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
RECORDED_BY = "mint-comm-when"

# One row per person, so nothing accumulates; 500 leaves room to double.
ROW_COUNT = 500

# Rows are keyed CW_<person_key>; never house, shift_code, address, phone or e-mail.
COMM_WHEN = {
    "tab": "comm_when",
    "title": "ASA Data — CommWhen",
    "prop": "HUB_HOUSE_COMM_WHEN_ID",
    "note": "data: comm_when (when each person may be asked — one row per person, worker data only)",
    "header": [
        "id", "createdAt", "updatedAt",
        "person_key", "name",
        # only `reachable` lets the lane speak; no shift on file is unknown, never reachable
        "state",
        # opens 30 minutes before the shift, closes 5
        "window_from", "window_to", "moment_at",
        # lets a reader check the window really sits before this shift
        "shift_at",
        # true when the window exists only inside the 21:00-08:00 quiet hours
        "only_by_this_rule",
        # composed from the computation's constants, never typed text or a client's name
        "why",
        # the reader ignores a row older than six hours
        "source_at",
    ],
}

HOUSES = [COMM_WHEN]


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


def mint(house: dict, have: dict[str, str], now: str, sa: str, dry: bool) -> str:
    tab, title, prop, header = house["tab"], house["title"], house["prop"], house["header"]
    src_ptr = f"switchboard:props.{prop}"
    sid = have.get(src_ptr, "")
    if sid:
        print(f"· {tab}: pointer already in the depot ({sid[:14]}…) — reusing the house")
    if dry:
        print(f"  --dry-run: would {'reuse' if sid else 'create'} \"{title}\" "
              f"({len(header)} cols, {ROW_COUNT} rows), append the three facts and the Registry row.")
        return sid or "(would create)"

    live_header = None
    if sid:
        # Never re-stamp a live header: ensureHeader_ appends, so a PUT would relabel columns.
        got = api(S + sid + "/values/" + urllib.parse.quote(f"'{tab}'!1:1")).get("values") or []
        live_header = [str(h) for h in (got[0] if got else []) if str(h).strip()]
        if live_header:
            header = live_header
            print(f"  live header kept ({len(header)} cols); the declaration follows it")
    if not sid:
        sid = api(S, {"properties": {"title": title},
                      "sheets": [{"properties": {
                          "title": tab,
                          "gridProperties": {"rowCount": ROW_COUNT,
                                             "columnCount": len(header) + 3,
                                             "frozenRowCount": 1}}}]}, "POST")["spreadsheetId"]
        print(f"  house created as asatech: {title} = {sid}")
    # The header lands before anything reads the tab.
    if live_header is None:
        api(S + sid + "/values/" + urllib.parse.quote(f"'{tab}'!A1") + "?valueInputOption=RAW",
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
            ":append?valueInputOption=RAW&insertDataOption=INSERT_ROWS",
            {"values": facts}, "POST")
    fresh = depot_state()
    assert fresh.get(src_ptr) == sid, f"{tab}: pointer did not land"
    assert fresh.get(f"switchboard:moved.{tab}") == "on", f"{tab}: moved switch did not land"
    print(f"  declared: {prop} → {sid[:14]}… · moved.{tab}=on · schema ({len(header)} cols)")

    # The Registry is first-row-wins per Context: dedupe by context and by spreadsheet.
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
        except Exception as exc:
            print(f"  WARNING: share failed ({str(exc)[:100]}) — the ONLY writer this house "
                  f"can have is the relay holding that account. Share by hand before the feed, "
                  f"or the feed writes nowhere and nobody is ever asked")
    return sid


def main() -> None:
    dry = "--dry-run" in sys.argv
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    have = depot_state()
    sa = sa_email()
    print(f"service account for the share: {sa or 'NOT FOUND — shares will be skipped'}")
    made = {}
    for house in HOUSES:
        print(f"\n{house['title']}")
        made[house["tab"]] = mint(house, have, now, sa, dry)
    if dry:
        print("\n--dry-run: nothing was written.")
        return
    print("\nTHE HOUSE IS LIVE inside the 300s switchboard cache, and EMPTY.")
    for tab, sid in made.items():
        print(f"  data.{tab} → {sid}")
    print("\nAN EMPTY HOUSE ASKS NOBODY, and that is the correct state until the")
    print("feed runs: `commWhenRows_` answers null for a house with no rows, the")
    print("ask lane logs `comm_window_ask_no_reader`, and it never picks an hour")
    print("of its own.")
    print("\nNext, in order:")
    print("  1. `commWhenIngest` must be named in SERVICE_SWEEP_ACTIONS")
    print("     (apps-script/ServiceIdentity.gs) — a machine write that is not on")
    print("     that list answers 403 and is filed as `service_write_refused`;")
    print("  2. the relay must be able to import the computation: comm_when.py")
    print("     lives in the old platform and is not inside the relay's image, so")
    print("     it needs a read-only bind mount (see server/comm_when_feed.py);")
    print("  3. nothing else. The feed converges on its own — a pass over an")
    print("     unchanged house writes zero cells and says so.")


if __name__ == "__main__":
    main()
