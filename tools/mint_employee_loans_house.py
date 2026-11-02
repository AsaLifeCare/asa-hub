#!/usr/bin/env python3
"""
Mint `ASA Data — Employee Loans` as asatech and declare it (pointer, moved switch, schema, Registry row): one
`Data` tab, rows told apart by `kind` (loan, ask, payment). The header is read from apps-script/EmployeeLoans.gs
(EL_HEADER), the one declaration. Re-runnable: a live header is never re-stamped. Mints and stops; Apps Script
is the only writer.

    python3 tools/mint_employee_loans_house.py --dry-run     # reads the depot, writes nothing (also the default)
    python3 tools/mint_employee_loans_house.py --apply [--share]

--share asks the sheet keeper for read and touches the book, so the master JSON carries it.
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
SA_JSON_PATHS = [Path("/opt/docker/asa-hub/server/.service-account.json")]
RECORDED_BY = "mint-employee-loans"
MODULE = Path(__file__).resolve().parent.parent / "apps-script" / "EmployeeLoans.gs"
KEEPER_ACCOUNT = (os.getenv("GOOGLE_IMPERSONATE_USER") or "").strip()
DRIVE_SCOPELESS = "insufficient authentication scopes"
HOUSE_DATA_TAB = "Data"

HOUSE = {"tab": "employee_loans", "title": "ASA Data — Employee Loans", "rows": 3000,
         "note": "data: employee_loans (restricted payroll: loan requests, the directors' My Work items and the "
                 "payments, told apart by kind; EmployeeLoans.gs)"}

S = "https://sheets.googleapis.com/v4/spreadsheets/"
D = "https://www.googleapis.com/drive/v3/files/"
TOK = ""


def prop_of(tab: str) -> str:
    return f"HUB_HOUSE_{tab.upper()}_ID"


def declared_header() -> list[str]:
    """EL_HEADER from EmployeeLoans.gs, refused when it is not declared there."""
    src = MODULE.read_text(encoding="utf-8")
    block = re.search(r"var EL_HEADER = \[(.*?)\];", src, re.S)
    cols = re.findall(r"'([^']*)'", block.group(1)) if block else []
    if not cols or cols[:2] != ["id", "kind"]:
        raise SystemExit(f"EL_HEADER is not declared (id, kind first) in {MODULE}")
    return cols


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
    """Every cell is text, so a stamp or a JSON list stays what was written."""
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
                      f"    Open the book in Drive → Share → add {who} as Viewer, then re-run with --apply --share.")
            else:
                print(f"  the read grant was not added ({said[:110]}) — it may already be there")
    touch(sid)


def mint(house: dict, header: list[str], have: dict[str, str], now: str, sa: str, apply: bool,
         share: bool) -> str:
    tab, title = house["tab"], house["title"]
    prop = prop_of(tab)
    src_ptr = f"switchboard:props.{prop}"
    sid = have.get(src_ptr, "").strip()
    print(f"\n{title}")
    if sid:
        print(f"· {tab}: pointer already in the depot ({sid[:14]}…) — reusing the house")
    if not apply:
        print(f"  dry run: would {'reuse' if sid else 'create'} \"{title}\" (tab {HOUSE_DATA_TAB}, {len(header)} cols, "
              f"{house['rows']} rows), append the facts {prop} / moved.{tab} / schema.{tab}.header and the Registry "
              f"row" + (", ask the keeper for read and touch the book" if share else "") + ".")
        print(f"  header: {', '.join(header)}")
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
    if share:
        share_with_keeper(sid)
    else:
        print("  NOT shared with the sheet keeper: in no mirror and no master JSON until --share")
    return sid


def main() -> None:
    global TOK
    apply = "--apply" in sys.argv
    if apply and "--dry-run" in sys.argv:
        raise SystemExit("--apply and --dry-run: one or the other")
    share = "--share" in sys.argv
    header = declared_header()
    TOK = token()
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    have = depot_state()
    sa = sa_email()
    print(f"service account for the share: {sa or 'NOT FOUND — the share will be skipped'}")
    sid = mint(HOUSE, header, have, now, sa, apply, share)
    if not apply:
        print("\ndry run: nothing was written. Re-run with --apply to mint.")
        return
    print(f"\ndata.{HOUSE['tab']} → {sid}")
    print("THE HOUSE IS LIVE inside the 300s switchboard cache: Staff → Employee Pay answers from it from then on.")


if __name__ == "__main__":
    main()
