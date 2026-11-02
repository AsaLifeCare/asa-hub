#!/usr/bin/env python3
"""Flip a Care-book tab into its own ASA Data house; houseMoved_ needs both the pointer and the moved switch."""
from __future__ import annotations

import json
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

ENV_PATH = Path("/opt/docker/asa-hub/server/.tools.env")
ESSENCIAL_ID = "1Y6UMJlCS5gHur52f0YrPsLSqwYlCA792I8gAiZsxsug"
CARE_BOOK_ID = "1oTtiGLOB9gEDqK_pOHHlHlzfJkY3HCnxokFpqBZ4Kog"
ARGS = [a for a in sys.argv[1:] if a != "--dry-run"]
if len(ARGS) < 2:
    sys.exit("usage: flip_tab_to_house.py <tab> <ASA Data — Title> [--dry-run]")
TAB = ARGS[0]
TITLE = ARGS[1]
PROP = "HUB_HOUSE_" + TAB.upper() + "_ID"


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
        "grant_type": "refresh_token",
    }).encode()
    req = urllib.request.Request("https://oauth2.googleapis.com/token", data=body, method="POST")
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)["access_token"]


TOK = token()
S = "https://sheets.googleapis.com/v4/spreadsheets/"


def api(url: str, payload: dict | None = None, method: str = "GET", tries: int = 8) -> dict:
    for a in range(tries):
        req = urllib.request.Request(url, method=method)
        req.add_header("Authorization", "Bearer " + TOK)
        body = json.dumps(payload).encode() if payload is not None else None
        if body:
            req.add_header("Content-Type", "application/json")
        try:
            with urllib.request.urlopen(req, body, timeout=300) as resp:
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


def main() -> None:
    dry = "--dry-run" in sys.argv
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

    vals = api(S + CARE_BOOK_ID + "/values/" + urllib.parse.quote(f"'{TAB}'!A1:CZ")).get("values") or []
    if not vals:
        sys.exit(f"{TAB} is empty in the Care book — nothing to flip.")
    header = [str(h) for h in vals[0] if str(h).strip()]
    rows = len(vals) - 1
    width = max(len(r) for r in vals)
    print(f"source: Care › {TAB} — {rows} rows × {len(header)} named columns")

    have = depot_state()
    src_ptr = f"switchboard:props.{PROP}"
    sid = have.get(src_ptr, "")
    if sid:
        print(f"pointer already in the depot: {PROP} = {sid[:14]}… (reusing the house)")

    if dry:
        print(f"\n--dry-run: would {'reuse' if sid else 'create'} the house, copy {rows} rows, "
              f"append pointer + moved + schema facts. Nothing written.")
        return

    if not sid:
        sid = api(S, {"properties": {"title": TITLE},
                      "sheets": [{"properties": {
                          "title": TAB, "gridProperties": {
                              "rowCount": max(1000, rows + 200),
                              "columnCount": max(26, width + 4),
                              "frozenRowCount": 1}}}]}, "POST")["spreadsheetId"]
        print(f"house created as asatech: {TITLE} = {sid}")

    already =api(S + sid + "/values/" + urllib.parse.quote(f"'{TAB}'!A1:CZ")).get("values") or []
    if len(already) - 1 > rows:
        sys.exit(f"the house already holds {len(already) - 1} rows > source {rows} — "
                 f"writes landed after a flip; reconcile by hand, never overwrite.")

    grid = [list(r) + [""] * (width - len(r)) for r in vals]
    api(S + sid + "/values/" + urllib.parse.quote(f"'{TAB}'!A1:CZ") + ":clear", {}, "POST")
    for i in range(0, len(grid), 2000):
        api(S + sid + "/values/" + urllib.parse.quote(f"'{TAB}'!A{i + 1}") +
            "?valueInputOption=RAW", {"values": grid[i:i + 2000]}, "PUT")
    back = max(0, len(api(S + sid + "/values/" + urllib.parse.quote(f"'{TAB}'!A1:CZ")).get("values") or []) - 1)
    if back != rows:
        sys.exit(f"copy MISMATCH: wrote {back}, source has {rows} — declarations NOT planted.")
    print(f"copied {back}/{rows} rows — verified by grid count")

    facts = []
    if have.get(src_ptr) != sid:
        facts.append(["config.props." + PROP.lower().replace("_", ""), PROP, sid, "",
                      src_ptr, "", now, "flip-ist-records", ""])
    if have.get(f"switchboard:moved.{TAB}") != "on":
        facts.append([f"config.moved.{TAB}", f"moved.{TAB}", "on", "",
                      f"switchboard:moved.{TAB}", "", now, "flip-ist-records", ""])
    schema_val = json.dumps(header, separators=(",", ":"))
    if have.get(f"schema:{TAB}.header") != schema_val:
        facts.append([f"schema.{TAB}.header", "__schema", schema_val, "",
                      f"schema:{TAB}.header", "", now, "flip-ist-records", ""])
    if facts:
        api(S + ESSENCIAL_ID + "/values/" + urllib.parse.quote("'Facts'!A1") +
            ":append?valueInputOption=RAW&insertDataOption=INSERT_ROWS",
            {"values": facts}, "POST")
    fresh = depot_state()
    assert fresh.get(src_ptr) == sid, "pointer did not land"
    assert fresh.get(f"switchboard:moved.{TAB}") == "on", "moved switch did not land"
    print(f"declared: {PROP} → {sid[:14]}… · moved.{TAB}=on · schema ({len(header)} cols)")
    print("\nLIVE within the 300s switchboard cache — reads AND writes re-point together.")
    print("The Care tab stays as the dead-by-declaration copy; recount both in ~6 minutes.")


if __name__ == "__main__":
    main()
