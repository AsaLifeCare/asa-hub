#!/usr/bin/env python3
"""
Mint `ASA Data — ProductionActions` and `ASA Data — ProductionActionRuns` as asatech and declare them.
Re-runnable: a live header is never re-stamped; only seed ids with no row yet are written. Mints and stops.

    python3 tools/mint_production_actions_houses.py --dry-run
    python3 tools/mint_production_actions_houses.py [--share]

--share asks the sheet keeper for read and touches each book, so the master JSON carries them.
"""
from __future__ import annotations

import base64
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

ENV_PATH = Path("/opt/docker/asa-hub/server/.tools.env")
ESSENCIAL_ID = "1Y6UMJlCS5gHur52f0YrPsLSqwYlCA792I8gAiZsxsug"
SA_JSON_PATHS = [Path("/opt/docker/asa-hub/server/.service-account.json")]
RECORDED_BY = "mint-production-actions"
SEED_PATH = Path(__file__).resolve().parent / "production-actions-seed.json"
KEEPER_ACCOUNT = (os.getenv("GOOGLE_IMPERSONATE_USER") or "").strip()
DRIVE_SCOPELESS = "insufficient authentication scopes"

ACTIONS = {
    "tab": "production_actions",
    "title": "ASA Data — ProductionActions",
    "prop": "HUB_HOUSE_PRODUCTION_ACTIONS_ID",
    "note": "data: production_actions (the go-live runbook — one row per action, editable; master only)",
    "rows": 500,
    # same order as PA_ACTIONS_HEADER (ProductionActions.gs)
    "header": [
        "id", "createdAt", "updatedAt", "updated_by",
        "number", "phase", "title", "system", "kind", "handler", "params",
        "how", "link", "requires", "effect", "enabled",
    ],
}
RUNS = {
    "tab": "production_action_runs",
    "title": "ASA Data — ProductionActionRuns",
    "prop": "HUB_HOUSE_PRODUCTION_ACTION_RUNS_ID",
    "note": "data: production_action_runs (every rehearsal, run, mark, undo and refusal of the runbook; master only)",
    "rows": 5000,
    # same order as PA_RUNS_HEADER (ProductionActions.gs)
    "header": [
        "id", "createdAt", "updatedAt",
        "action_id", "number", "title",
        "act", "result", "expect", "test_mode", "dial",
        "by_email", "by_name", "client_id",
        "def_sha", "preview_sha", "target", "detail",
        "before", "after", "undoes", "mock_row_id", "tenant",
    ],
}
HOUSES = [ACTIONS, RUNS]

S = "https://sheets.googleapis.com/v4/spreadsheets/"
D = "https://www.googleapis.com/drive/v3/files/"
TOK = ""


def seed_rows(now: str) -> list[dict[str, str]]:
    """The seed as cell text, in the header's columns; params as compact JSON."""
    doc = json.loads(SEED_PATH.read_text(encoding="utf-8"))
    out = []
    for row in doc["rows"]:
        cells = {}
        for h in ACTIONS["header"]:
            v = row.get(h)
            if h == "params":
                cells[h] = json.dumps(v, ensure_ascii=False, separators=(",", ":")) if v else ""
            else:
                cells[h] = "" if v is None else str(v)
        cells["createdAt"] = cells["updatedAt"] = now
        cells["updated_by"] = RECORDED_BY
        out.append(cells)
    return out


def missing_seed(rows: list[dict[str, str]], present: set[str]) -> list[dict[str, str]]:
    return [r for r in rows if r["id"] not in present]


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


def cell_safe(v: str) -> str:
    s = str(v)
    return "'" + s if s[:1] in ("=", "+", "-", "@") else s


def text_format(sid: str, tab: str) -> None:
    """Every cell of the runbook tab is text, so a number or a date stays what was typed."""
    meta = api(S + sid + "?fields=sheets.properties")
    gid = next((s["properties"]["sheetId"] for s in meta.get("sheets") or []
                if s["properties"].get("title") == tab), None)
    if gid is None:
        print(f"  WARNING: no tab '{tab}' to format")
        return
    api(S + sid + ":batchUpdate", {"requests": [{"repeatCell": {
        "range": {"sheetId": gid},
        "cell": {"userEnteredFormat": {"numberFormat": {"type": "TEXT"}}},
        "fields": "userEnteredFormat.numberFormat"}}]}, "POST")
    print("  every cell formatted as text")


def touch(sid: str) -> None:
    """A write moves modifiedTime, which is the only thing the keeper lists a book by."""
    try:
        got = api(S + sid + "/values/A1?valueRenderOption=FORMULA").get("values") or []
        value = got[0][0] if got and got[0] else ""
        api(S + sid + "/values/A1?valueInputOption=RAW",
            {"range": "A1", "majorDimension": "ROWS", "values": [[value]]}, "PUT")
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
                      f"    Open the book in Drive → Share → add {who} as Viewer, then re-run with --share.")
            else:
                print(f"  the read grant was not added ({said[:110]}) — it may already be there")
    touch(sid)


def mint(house: dict, have: dict[str, str], now: str, sa: str, dry: bool, share: bool) -> str:
    tab, title, prop = house["tab"], house["title"], house["prop"]
    header = list(house["header"])
    src_ptr = f"switchboard:props.{prop}"
    sid = have.get(src_ptr, "").strip()
    print(f"\n{title}")
    if sid:
        print(f"· {tab}: pointer already in the depot ({sid[:14]}…) — reusing the house")
    if dry:
        print(f"  --dry-run: would {'reuse' if sid else 'create'} \"{title}\" ({len(header)} cols, "
              f"{house['rows']} rows), append the three facts and the Registry row"
              + (", ask the keeper for read and touch the book" if share else "") + ".")
        return sid or "(would create)"

    live_header = None
    if sid:
        got = api(S + sid + "/values/" + urllib.parse.quote(f"'{tab}'!1:1")).get("values") or []
        live_header = [str(h) for h in (got[0] if got else []) if str(h).strip()]
        if live_header:
            header = live_header
            print(f"  live header kept ({len(header)} cols); the declaration follows it")
    if not sid:
        sid = api(S, {"properties": {"title": title},
                      "sheets": [{"properties": {
                          "title": tab,
                          "gridProperties": {"rowCount": house["rows"], "columnCount": len(header) + 3,
                                             "frozenRowCount": 1}}}]}, "POST")["spreadsheetId"]
        print(f"  house created as asatech: {title} = {sid}")
        text_format(sid, tab)
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


def seed(sid: str, now: str, dry: bool) -> None:
    rows = seed_rows(now)
    tab = ACTIONS["tab"]
    if dry:
        for r in rows:
            print(f"      #{r['number']} {r['id']} ({r['phase']}, {r['kind']}{' · ' + r['handler'] if r['handler'] else ''})")
        print(f"  --dry-run: would seed the ids above that have no row yet ({len(rows)} in the seed)")
        return
    live = api(S + sid + "/values/" + urllib.parse.quote(f"'{tab}'!1:1")).get("values") or []
    header = [str(h) for h in (live[0] if live else ACTIONS["header"])]
    got = api(S + sid + "/values/" + urllib.parse.quote(f"'{tab}'!A2:A9999")).get("values") or []
    present = {str(r[0]).strip() for r in got if r and str(r[0]).strip()}
    todo = missing_seed(rows, present)
    if not todo:
        print(f"  all {len(rows)} seed row(s) already have a row — nothing seeded")
        return
    api(S + sid + "/values/" + urllib.parse.quote(f"'{tab}'!A1") +
        ":append?valueInputOption=RAW&insertDataOption=INSERT_ROWS",
        {"values": [[cell_safe(r.get(h, "")) for h in header] for r in todo]}, "POST")
    print(f"  seeded {len(todo)} row(s): {', '.join(r['id'] for r in todo)}")
    if len(todo) < len(rows):
        print(f"  left untouched: {len(rows) - len(todo)} row(s) already there")


def main() -> None:
    global TOK
    dry = "--dry-run" in sys.argv
    share = "--share" in sys.argv
    TOK = token()
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    have = depot_state()
    sa = sa_email()
    print(f"service account for the share: {sa or 'NOT FOUND — the share will be skipped'}")
    sid = mint(ACTIONS, have, now, sa, dry, share)
    seed(sid, now, dry)
    runs = mint(RUNS, have, now, sa, dry, share)
    if dry:
        print("\n--dry-run: nothing was written.")
        return
    print(f"\ndata.{ACTIONS['tab']} → {sid}\ndata.{RUNS['tab']} → {runs}")
    print("THE HOUSES ARE LIVE inside the 300s switchboard cache. The page reads them from the master JSON,")
    print("so they show once the keeper lists them (--share); until then it says they are not in it yet.")


if __name__ == "__main__":
    main()
