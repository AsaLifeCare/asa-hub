#!/usr/bin/env python3
"""
Mint the two recruiting houses (RecruitPipeline, RecruitOnboarding) as asatech and declare them and the source book.
Headers come from the book's row 1 through recruit_book.house_header. Mints and stops; recruitBookIngest fills them.
Re-runnable; a live header is never re-stamped. Import reaches no network.

    python3 tools/mint_recruit_houses.py --dry-run
    python3 tools/mint_recruit_houses.py
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
import recruit_book  # noqa: E402 — the relay's own declarations, one authority

ENV_PATH = Path("/opt/docker/asa-hub/server/.tools.env")
ESSENCIAL_ID = "1Y6UMJlCS5gHur52f0YrPsLSqwYlCA792I8gAiZsxsug"
SA_JSON_PATHS = [Path("/opt/docker/asa-hub/server/.service-account.json")]
RECORDED_BY = "mint-recruit-houses"

ROW_COUNT = 4000

SOURCE_ID = recruit_book.SOURCE_BOOK_ID
SOURCE_PROP = "RECRUIT_BOOK_ID"

HOUSES = [
    {
        "tab": tab,
        "title": spec["title"],
        "prop": spec["prop"],
        "source_tab": spec["source_tab"],
        "note": (f"data: {tab} (our copy of the recruiters' book, tab \"{spec['source_tab']}\" — "
                 "synced by the relay from the platform's copy of the sheets, JSON first, written by "
                 "recruitBookIngest; never edited here)"),
    }
    for tab, spec in recruit_book.TABS.items()
]

S = "https://sheets.googleapis.com/v4/spreadsheets/"
D = "https://www.googleapis.com/drive/v3/files/"
TOK = ""


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


def book_header(source_tab: str) -> list[str]:
    """Row 1 of the source tab, read-only, each cell stripped as the sheet keeper does."""
    got = api(S + SOURCE_ID + "/values/" + urllib.parse.quote(f"'{source_tab}'!1:1")).get("values") or []
    names = [str(h).strip() for h in (got[0] if got else [])]
    names = [n for n in names if n]
    if not names:
        sys.exit(f"\"{source_tab}\" has no header row in the recruiters' book — nothing minted")
    return names


def declare_source(have: dict[str, str], now: str, dry: bool) -> None:
    ptr = f"switchboard:props.{SOURCE_PROP}"
    if have.get(ptr) == SOURCE_ID:
        print(f"· the source is already declared ({SOURCE_PROP} → {SOURCE_ID[:14]}…)")
        return
    if dry:
        print(f"  --dry-run: would declare {SOURCE_PROP} → {SOURCE_ID[:14]}… (where the foreign book lives)")
        return
    api(S + ESSENCIAL_ID + "/values/" + urllib.parse.quote("'Facts'!A1") +
        ":append?valueInputOption=RAW&insertDataOption=INSERT_ROWS",
        {"values": [["config.props." + SOURCE_PROP.lower().replace("_", ""), SOURCE_PROP, SOURCE_ID, "",
                     ptr, "", now, RECORDED_BY, ""]]}, "POST")
    print(f"  declared the source: {SOURCE_PROP} → {SOURCE_ID[:14]}…")


def mint(house: dict, have: dict[str, str], now: str, sa: str, dry: bool) -> str:
    tab, title, prop = house["tab"], house["title"], house["prop"]
    src_ptr = f"switchboard:props.{prop}"
    sid = have.get(src_ptr, "")
    header = recruit_book.house_header(tab, book_header(house["source_tab"]))
    if sid:
        print(f"· {tab}: pointer already in the depot ({sid[:14]}…) — reusing the house")
    if dry:
        print(f"  --dry-run: would {'reuse' if sid else 'create'} \"{title}\" with {len(header)} column(s): "
              f"{', '.join(h.replace(chr(10), ' ') for h in header[:8])}…")
        return sid or "(would create)"

    live_header = None
    if sid:
        # a header PUT over a filled tab would relabel columns without moving values
        got =api(S + sid + "/values/" + urllib.parse.quote(f"'{tab}'!1:1")).get("values") or []
        live_header = [str(h) for h in (got[0] if got else []) if str(h).strip()]
        if live_header:
            header = live_header
            print(f"  live header kept ({len(header)} cols); the declaration follows it")
    if not sid:
        sid = api(S, {"properties": {"title": title},
                      "sheets": [{"properties": {
                          "title": tab,
                          "gridProperties": {"rowCount": ROW_COUNT,
                                             "columnCount": len(header) + 5,
                                             "frozenRowCount": 1}}}]}, "POST")["spreadsheetId"]
        print(f"  house created as asatech: {title} = {sid}")
    if live_header is None:
        api(S + sid + "/values/" + urllib.parse.quote(f"'{tab}'!A1") + "?valueInputOption=RAW",
            {"values": [header]}, "PUT")
        print(f"  header stamped from \"{house['source_tab']}\" ({len(header)} cols)")

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
            print(f"  WARNING: share failed ({str(exc)[:100]}) — Apps Script is the only writer, "
                  f"so this is not fatal")
    return sid


def main() -> None:
    global TOK
    dry = "--dry-run" in sys.argv
    TOK = token()
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    have = depot_state()
    sa = sa_email()
    print(f"service account for the share: {sa or 'NOT FOUND — the shares will be skipped'}")
    print(f"the recruiters' book: {SOURCE_ID[:14]}… (read-only here — only its header row is read)")
    declare_source(have, now, dry)
    minted = {}
    for house in HOUSES:
        print(f"\n{house['title']}")
        minted[house["tab"]] = mint(house, have, now, sa, dry)
    if dry:
        print("\n--dry-run: nothing was written.")
        return
    print("\nTHE HOUSES ARE DECLARED inside the 300s switchboard cache, and EMPTY.")
    for tab, sid in minted.items():
        print(f"  data.{tab} → {sid}")
    print("\nThe writer is apps-script/CommRecruit.gs (recruitBookIngest), fed by the relay")
    print("(server/recruit_book.py) after the publish and the relay restart. Nothing else to run.")


if __name__ == "__main__":
    main()
