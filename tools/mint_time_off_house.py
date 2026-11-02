#!/usr/bin/env python3
"""
Mint `ASA Data — TimeOff` as asatech and declare it (pointer, moved switch, schema, Registry row), share it
with the relay's service account as writer, and seed the `settings` tab while it is empty.
Re-runnable; a live header is never re-stamped and a live setting is never overwritten.
The header is read from server/time_off.py, the one declaration. Import reaches no network.

    python3 tools/mint_time_off_house.py --dry-run
    python3 tools/mint_time_off_house.py
"""
from __future__ import annotations

import ast
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
RECORDED_BY = "mint-time-off"
MODULE = Path(__file__).resolve().parent.parent / "server" / "time_off.py"
ROW_COUNT = 5000

S = "https://sheets.googleapis.com/v4/spreadsheets/"
D = "https://www.googleapis.com/drive/v3/files/"
TOK = ""


def declared(name: str) -> tuple[str, ...]:
    """A tuple of strings assigned at the top of server/time_off.py."""
    tree = ast.parse(MODULE.read_text(encoding="utf-8"))
    for node in tree.body:
        if isinstance(node, ast.Assign) and any(getattr(t, "id", "") == name for t in node.targets):
            return tuple(ast.literal_eval(node.value))
    raise SystemExit(f"{name} is not declared in {MODULE}")


def settings_seed() -> list[list[str]]:
    # No name in code: the board is typed on Settings → Time Off; until it is, a request is filed and its
    # director half waits, and a swap opens with its director's approval waiting.
    return [["directors", "", "the director half of every time off request — typed on Settings → Time Off", ""],
            ["form_sync", "on", "new Google Form rows are added while on", ""],
            ["form_cutover_at", "", "set by tools/migrate_time_off.py --apply", ""],
            ["form_watermark", "", "the newest form row added", ""]]


HOUSE = {
    "title": "ASA Data — TimeOff",
    "prop": "HUB_HOUSE_TIME_OFF_ID",
    "tab": "time_off",
    "settings_tab": "settings",
    "note": "data: time_off (every time off request, its two approvals and what scheduling it staged; "
            "the relay is its only writer)",
}


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


def values(sid: str, rng: str) -> list[list[str]]:
    return api(S + sid + "/values/" + urllib.parse.quote(rng)).get("values") or []


def mint(have: dict[str, str], now: str, sa: str, dry: bool) -> str:
    header = list(declared("HEADER"))
    settings_header = list(declared("SETTINGS_HEADER"))
    tab, stab, prop = HOUSE["tab"], HOUSE["settings_tab"], HOUSE["prop"]
    src_ptr = f"switchboard:props.{prop}"
    sid = have.get(src_ptr, "")
    if sid:
        print(f"· {tab}: pointer already in the depot ({sid[:14]}…) — reusing the house")
    if dry:
        print(f"  --dry-run: would {'reuse' if sid else 'create'} \"{HOUSE['title']}\" "
              f"({tab}: {len(header)} cols; {stab}: {len(settings_header)} cols, seeded while empty), "
              f"append the three facts and the Registry row, and share it with {sa or 'nobody'} as writer.")
        return sid or "(would create)"

    if not sid:
        sid = api(S, {"properties": {"title": HOUSE["title"]},
                      "sheets": [{"properties": {"title": tab, "gridProperties": {
                          "rowCount": ROW_COUNT, "columnCount": len(header) + 3, "frozenRowCount": 1}}},
                                 {"properties": {"title": stab, "gridProperties": {
                                     "rowCount": 200, "columnCount": len(settings_header) + 2,
                                     "frozenRowCount": 1}}}]}, "POST")["spreadsheetId"]
        print(f"  house created as asatech: {HOUSE['title']} = {sid}")
    live = values(sid, f"'{tab}'!1:1")
    live_header = [str(h) for h in (live[0] if live else []) if str(h).strip()]
    if live_header:
        missing = [h for h in header if h not in live_header]
        print(f"  live header kept ({len(live_header)} cols)" +
              (f" — MISSING {missing}: the relay refuses to write until they are added" if missing else ""))
        header = live_header
    else:
        api(S + sid + "/values/" + urllib.parse.quote(f"'{tab}'!A1") + "?valueInputOption=RAW",
            {"values": [header]}, "PUT")
        print(f"  header stamped ({len(header)} cols)")
    have_settings = values(sid, f"'{stab}'!A1:D200")
    if not have_settings:
        api(S + sid + "/values/" + urllib.parse.quote(f"'{stab}'!A1") + "?valueInputOption=RAW",
            {"values": [settings_header] + [r[:3] + [now] for r in settings_seed()]}, "PUT")
        print(f"  settings seeded ({len(settings_seed())} keys)")
    else:
        print(f"  settings kept ({max(0, len(have_settings) - 1)} rows)")

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
    print(f"  declared: {prop} → {sid[:14]}… · moved.{tab}=on · schema ({len(header)} cols)")

    reg = values(ESSENCIAL_ID, "'Registry'!A2:D9999")
    if any(len(r) > 0 and str(r[0]).strip().lower() == f"data.{tab}" for r in reg):
        print("  Registry row already present (context)")
    elif any(len(r) > 1 and str(r[1]).strip() == sid for r in reg):
        print("  Registry row already present (spreadsheet)")
    else:
        api(S + ESSENCIAL_ID + "/values/" + urllib.parse.quote("'Registry'!A1") +
            ":append?valueInputOption=RAW&insertDataOption=INSERT_ROWS",
            {"values": [[f"data.{tab}", sid, "on", HOUSE["note"]]]}, "POST")
        print("  Registry row appended")

    if not sa:
        print("  WARNING: no service account found — the relay cannot write this house until it is shared")
        return sid
    try:
        api(D + sid + "/permissions?sendNotificationEmail=false&supportsAllDrives=true",
            {"role": "writer", "type": "user", "emailAddress": sa}, "POST")
        print(f"  shared with {sa} (writer)")
    except Exception as exc:
        print(f"  WARNING: share failed ({str(exc)[:100]}) — the relay is this house's only writer, so every "
              f"Time Off write door answers 503 until it is shared")
    return sid


def main() -> None:
    global TOK
    dry = "--dry-run" in sys.argv
    TOK = token()
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    have = depot_state()
    sa = sa_email()
    print(f"service account for the share: {sa or 'NOT FOUND — the share will be skipped'}")
    print(f"\n{HOUSE['title']}")
    sid = mint(have, now, sa, dry)
    if dry:
        print("\n--dry-run: nothing was written.")
        return
    print("\nTHE HOUSE IS DECLARED and EMPTY. Restart the relay (announced) so it reads the pointer,")
    print("then plan the migration: tools/migrate_time_off.py (a dry run), and --apply after reading it.")
    print(f"  data.{HOUSE['tab']} → {sid}")


if __name__ == "__main__":
    main()
