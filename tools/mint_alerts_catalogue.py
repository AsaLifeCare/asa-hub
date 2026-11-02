#!/usr/bin/env python3
"""
MINT THE CONFIG CATALOGUE — the platform's own vocabulary, in a sheet.

THE RULE: what is hardcoded moves into a sheet — far too much of this was
hardcoded. Forty-five configuration keys lived in AlertsConfig.gs as a
three-hundred-line array — each with the group that decides WHICH SCREEN
draws it, the value it ships as, and a long note that is the only sentence a
human ever reads about what the cell does. None of that is code. All of it
needed a publish to change.

So it becomes rows. This house is the catalogue; `hiring_alerts_config` stays
exactly where it is and goes on holding the LIVE VALUES. Two sheets, two
questions:

    hiring_alerts_catalog   which keys exist, and what each one means
    hiring_alerts_config    what this company has decided for them

WHY A HOUSE AND NOT A TAB BESIDE THE VALUES. HUB_DB is being drained one tab
at a time, so a new tab there would be born owing a migration. A declared
house is read through the lane every other moved tab already uses
(houseSheetFor_ → moved.<tab> + HUB_HOUSE_<TAB>_ID), it can be shared with
somebody who edits notes without handing them the identity tables, and a place
that splits off keeps reading the same vocabulary instead of forking it.

  1. mint `ASA Data — AlertsCatalog`, one tab, header on row 1;
  2. three depot facts in the Essencial Facts tab —
       switchboard:props.HUB_HOUSE_HIRING_ALERTS_CATALOG_ID → the house id
       switchboard:moved.hiring_alerts_catalog              → on
       schema:hiring_alerts_catalog.header                  → the header JSON
  3. one Registry row (Context `data.hiring_alerts_catalog`);
  4. share with the SERVICE ACCOUNT as Editor;
  5. write the 45 rows from tools/hiring-alerts-catalogue.json.

THE ROWS ARE NOT TYPED HERE. They are read from that file, which is the same
file `tools/check-alerts-catalogue.mjs` compares against the last-resort copy
in apps-script/AlertsCatalog.gs — so what this writes and what the code falls
back to cannot drift apart without a check going red.

RE-RUNNABLE, AND IT NEVER OVERWRITES. An existing pointer reuses the house; a
live header is never re-stamped; a key already in the tab keeps whatever it
holds, because the sheet is the truth once it exists and an edit made there
outranks the value it came from. A row whose cells DISAGREE with the file is
printed and left alone — that disagreement is somebody's decision, and this
tool is not entitled to reverse it.

    python3 tools/mint_alerts_catalogue.py --print     # the rows, no Google
    python3 tools/mint_alerts_catalogue.py --dry-run
    python3 tools/mint_alerts_catalogue.py [--share]

`--share` asks for the SHEET KEEPER's own account to have READ on the house
and TOUCHES the book, because the keeper lists a book only when its
modifiedTime moves and a permission never moves it. Without `--share` the
house is real, declared and readable by Apps Script, and invisible to the
Postgres mirror — so it is in no master JSON either. It is safe to re-run on a
house that already exists.

THE GRANT ITSELF CANNOT BE MADE FROM HERE. This tool's credential carries the
Sheets and Apps Script scopes and no Drive scope, so every permissions call it
makes answers 403; the tool says so and names the account to add by hand. The
touch it CAN do, and does.

`--print` emits the ROWS AS THEY WOULD BE WRITTEN — laid out against the header
this tool declares, not the dicts re-echoed out of the JSON file. A print that
only reads back its own input is a third witness that can never disagree with
the second, and it would leave the column mapping, the width and the header
order — the part that decides what actually lands in a cell — covered by
nothing at all.

The script MINTS AND STOPS. The reader is apps-script/AlertsCatalog.gs.
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

ROOT = Path(__file__).resolve().parent.parent
ROWS_PATH = ROOT / "tools" / "hiring-alerts-catalogue.json"
SHIPPED_PATH = ROOT / "apps-script" / "AlertsCatalog.gs"

ENV_PATH = Path("/opt/docker/asa-hub/server/.tools.env")
ESSENCIAL_ID = "1Y6UMJlCS5gHur52f0YrPsLSqwYlCA792I8gAiZsxsug"
SA_JSON_PATHS = [Path("/opt/docker/asa-hub/server/.service-account.json")]
RECORDED_BY = "mint-alerts-catalogue"

HOUSE = {
    "tab": "hiring_alerts_catalog",
    "title": "ASA Data — AlertsCatalog",
    "prop": "HUB_HOUSE_HIRING_ALERTS_CATALOG_ID",
    "note": "data: hiring_alerts_catalog (the configuration catalogue — which keys exist, "
            "which Settings screen draws each one, what it ships as and what it means; "
            "the live values stay in hiring_alerts_config; admin-only)",
    # The reader finds these by NAME in the header row, so the order here is
    # only what a person sees when they open the tab.
    "header": ["key", "group", "default_value", "note"],
}

# Born with room for several times the catalogue, so adding keys never needs a
# grid resize — and narrow enough that the tab still opens instantly.
ROW_COUNT = 500

# THE NAME EVERY DATA HOUSE'S TAB IS BEING RENAMED TO. HouseFlip.gs is giving
# the houses the matrix shape one at a time, and in that shape the one tab is
# called `Data`; houseSheetFor_ already reads either name, old one first, so
# the Apps Script side goes on working the moment a house is renamed and
# NOTHING LOOKS WRONG. A tool that kept asking for `hiring_alerts_catalog`
# would then die on an unhandled "Unable to parse range" the next time the lead
# re-ran it to add keys — and the new keys would quietly never reach the sheet.
# So this asks the house which of the two it has, exactly as the reader does.
HOUSE_DATA_TAB = "Data"


def rows_from_file() -> list[dict]:
    rows = json.loads(ROWS_PATH.read_text())
    seen: set[str] = set()
    for r in rows:
        key = str(r.get("key", "")).strip()
        if not key:
            sys.exit(f"{ROWS_PATH}: a row with no key")
        if key in seen:
            sys.exit(f"{ROWS_PATH}: {key} appears twice")
        seen.add(key)
        if not str(r.get("group", "")).strip():
            sys.exit(f"{ROWS_PATH}: {key} has no group — no screen would draw it")
    return rows


def assert_no_drift(rows: list[dict]) -> None:
    """The file and the last-resort copy in the code must agree, key for key.

    The same comparison tools/check-alerts-catalogue.mjs makes, repeated here
    because this tool is the one that WRITES — and writing a catalogue that
    disagrees with what the platform falls back to would install the very
    split this whole move is meant to prevent.
    """
    src = SHIPPED_PATH.read_text()
    start = src.find("var HIRING_ALERTS_CATALOG_SHIPPED = [")
    if start == -1:
        sys.exit(f"{SHIPPED_PATH}: HIRING_ALERTS_CATALOG_SHIPPED not found")
    end = src.find("\n];", start)
    if end == -1:
        sys.exit(f"{SHIPPED_PATH}: HIRING_ALERTS_CATALOG_SHIPPED is not closed")
    shipped = json.loads(src[src.index("[", start):end + 2])
    mine = [{"key": r["key"], "group": r["group"], "value": r["default_value"]} for r in rows]
    if shipped != mine:
        bad = [
            f"  row {i}: code={json.dumps(shipped[i] if i < len(shipped) else None)} "
            f"file={json.dumps(mine[i] if i < len(mine) else None)}"
            for i in range(max(len(shipped), len(mine)))
            if (shipped[i] if i < len(shipped) else None) != (mine[i] if i < len(mine) else None)
        ]
        sys.exit("REFUSING TO MINT: the rows and the last-resort copy disagree:\n"
                 + "\n".join(bad[:10]))
    # On stderr, so `--print` puts nothing but JSON on stdout for the check.
    print(f"the file and apps-script/AlertsCatalog.gs agree: {len(rows)} keys, key for key",
          file=sys.stderr)


def columns(head: list[str]) -> tuple[dict[str, int], int]:
    """Where each declared column sits in `head`, and how wide a row must be."""
    cols = {name: head.index(name) for name in HOUSE["header"]}
    return cols, max(len(head), max(cols.values()) + 1)


def lay_out(r: dict, cols: dict[str, int], width: int) -> list:
    """EACH VALUE UNDER ITS OWN NAME.

    The row is laid out against the header as it really is, not against the
    order this file lists the fields in, so a tab whose columns somebody
    rearranged still receives the note as a note. This is the step `--print`
    exercises, because it is the one that decides what lands in a cell.
    """
    row = [""] * width
    for name in HOUSE["header"]:
        row[cols[name]] = r[name]
    return row


def env(k: str) -> str:
    for line in ENV_PATH.read_text().splitlines():
        line = line.strip()
        if line.startswith(f"{k}="):
            return line.split("=", 1)[1].strip().strip("'\"")
    sys.exit(f"{k} not found in {ENV_PATH}")


_TOKEN = ""


def token() -> str:
    """Fetched on the first call, never at import — so --print needs nothing."""
    global _TOKEN
    if _TOKEN:
        return _TOKEN
    body = urllib.parse.urlencode({
        "client_id": env("GS_GOOGLE_CLIENT_ID"),
        "client_secret": env("GS_GOOGLE_CLIENT_SECRET"),
        "refresh_token": env("GS_GOOGLE_REFRESH_TOKEN"),
        "grant_type": "refresh_token"}).encode()
    req = urllib.request.Request("https://oauth2.googleapis.com/token", data=body, method="POST")
    with urllib.request.urlopen(req, timeout=30) as r:
        _TOKEN = json.load(r)["access_token"]
    return _TOKEN


S = "https://sheets.googleapis.com/v4/spreadsheets/"
D = "https://www.googleapis.com/drive/v3/files/"

KEEPER_ACCOUNT = (os.getenv("GOOGLE_IMPERSONATE_USER") or "").strip()
SHARE = "--share" in sys.argv


def api(url: str, payload: dict | None = None, method: str = "GET", tries: int = 6) -> dict:
    for a in range(tries):
        req = urllib.request.Request(url, method=method)
        req.add_header("Authorization", "Bearer " + token())
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


# ── THE SHEET KEEPER'S OWN ACCOUNT (--share) ───────────────────────────────
# A BOOK THE KEEPER CANNOT SEE IS IN NO MIRROR, AND SO IN NO MASTER JSON.
#
# WHO THE KEEPER IS, ASKED RATHER THAN ASSUMED. It is the SERVICE ACCOUNT —
# the same client_email sa_email() reads for the writer share. The note that
# used to stand here said the keeper lists Drive as GOOGLE_IMPERSONATE_USER
# through domain-wide delegation. On the relay that variable is present and
# EMPTY, and `with_subject("")` builds a credential with no `sub` claim at all
# (google-auth adds one only `if self._subject:`), so the refresh SUCCEEDS, no
# "DWD refused" warning is ever logged, and the identity that lists Drive is
# the plain service account. Asked outright, Drive answers with the service
# account's own address. Granting read to a human address instead would report
# success and leave the house in no mirror — which is the state all four
# houses are in.
#
# READER, never writer: the keeper's scopes are read-only, and a house whose
# only writer is the one that mints and fills it stays that way.
#
# AND A PERMISSION IS NOT A MODIFICATION. The keeper discovers a book ONLY
# through `modifiedTime > watermark`; granting a permission never moves that
# stamp, and these tools are additive, so re-running one on a house that is
# already complete writes nothing and moves nothing either. A share alone
# would leave the house exactly as invisible as before. So the share TOUCHES
# the book too — see `touch`, which is a write and therefore the thing that
# moves the stamp.
#
# AND THIS TOOL'S OWN CREDENTIAL CANNOT GRANT THE PERMISSION. The token
# `token()` mints carries `spreadsheets`, `script.projects` and
# `script.deployments` and NO DRIVE SCOPE AT ALL: every Drive call from here
# answers 403 "Request had insufficient authentication scopes", which is why
# the writer share below has been failing into a WARNING since it was written
# and why these houses are in no mirror. The grant is attempted anyway — a
# credential re-consented with Drive would make it work — and when it refuses
# for that reason the tool says so plainly and names the two ways forward,
# instead of printing a warning that reads like a detail.
DRIVE_SCOPELESS = "insufficient authentication scopes"


def keeper_account() -> str:
    """The identity the sheet keeper really lists Drive as."""
    return KEEPER_ACCOUNT or sa_email()


def share_with_keeper(sid: str) -> None:
    """Grant the sheet keeper READ if this credential can, touch the book
    either way, and say exactly what is still owed."""
    who = keeper_account()
    if not who:
        print("  the keeper's account could not be read (no service-account JSON here and"
              " GOOGLE_IMPERSONATE_USER is empty) — nobody to share with.")
    else:
        granted = False
        said = ""
        try:
            api(D + sid + "/permissions?sendNotificationEmail=false&supportsAllDrives=true",
                {"role": "reader", "type": "user", "emailAddress": who}, "POST")
            granted = True
        except Exception as exc:  # noqa: BLE001 — every refusal is reported, none is swallowed
            said = str(exc)
        if granted:
            print(f"  shared with {who} (reader)")
        elif DRIVE_SCOPELESS in said or "403" in said:
            print(f"  THE READ GRANT COULD NOT BE MADE FROM HERE. This tool's credential has"
                  f" no Drive scope, so it cannot change a permission on any file.\n"
                  f"    The house is in NO mirror and in NO master JSON until"
                  f" {who}\n"
                  f"    can open it. Either:\n"
                  f"      · open the book in Drive → Share → add that address as Viewer; or\n"
                  f"      · re-consent GS_GOOGLE_REFRESH_TOKEN with a Drive scope and run"
                  f" this again.\n"
                  f"    Then re-run with --share, or edit any cell, so the stamp moves.")
        else:
            print(f"  the read grant was not added ({said[:110]}) — it may already have"
                  " access; the touch below still moves the stamp")
    touch(sid)


def touch(sid: str) -> None:
    """THE SMALLEST REAL EDIT: cell A1 of the first tab, read and written
    straight back. A write is what moves modifiedTime, and the keeper lists a
    book by nothing else.

    It is written back with RAW, and only when the cell is not a formula —
    read twice, once as its formula and once as its value, and the two agree
    only when there is no formula there. RAW cannot turn text into a formula
    and cannot turn a formula into its result, so the cell ends the call
    holding exactly what it held. Anything else falls back to rewriting the
    book's own title with the title it already has, which cannot reach a cell.

    THIS CANNOT READ THE STAMP BACK: modifiedTime is a Drive field and this
    credential has no Drive scope. What it can say is that the write landed."""
    try:
        formula = _a1(api(S + sid + "/values/A1?valueRenderOption=FORMULA"))
        value = _a1(api(S + sid + "/values/A1?valueRenderOption=UNFORMATTED_VALUE"))
        if formula == value:
            api(S + sid + "/values/A1?valueInputOption=RAW",
                {"range": "A1", "majorDimension": "ROWS", "values": [[value]]}, "PUT")
            print("  touched: A1 of the first tab written back with what it already held")
        else:
            title = str((api(S + sid + "?fields=properties.title")
                         .get("properties") or {}).get("title") or "")
            api(S + sid + ":batchUpdate",
                {"requests": [{"updateSpreadsheetProperties": {
                    "properties": {"title": title}, "fields": "title"}}]}, "POST")
            print("  touched: A1 holds a formula, so the book's own title was rewritten"
                  " with the title it already had — no cell was reached")
    except Exception as exc:  # noqa: BLE001 — the house stands either way
        print(f"  WARNING: the touch failed ({str(exc)[:110]}). The keeper lists a book"
              " only when its modifiedTime moves, and a permission never moves it —"
              " EDIT ONE CELL by hand or the house stays out of the mirror.")
        return
    print("    modifiedTime cannot be read back from here (it is a Drive field and this"
          " credential has no Drive scope), but a write is what moves it: the next"
          " sheet-sync pass lists the book, IF the keeper can open it.")


def _a1(got: dict):
    """The one cell a values read came back with, or an empty string."""
    rows = got.get("values") or []
    return rows[0][0] if rows and rows[0] else ""


def resolve_tab(sid: str) -> str:
    """The tab this house really keeps its rows in — the reader's own rule.

    houseSheetFor_ tries `hiring_alerts_catalog` and falls back to `Data`, so
    those are the two names a live house can be wearing. Asked once, from the
    spreadsheet's own list of sheets, rather than guessed at by poking a range
    and reading the error.
    """
    tab = HOUSE["tab"]
    try:
        meta = api(S + sid + "?fields=sheets.properties.title")
    except Exception as exc:
        sys.exit(f"{tab}: could not list the sheets of {sid} ({str(exc)[:160]})")
    titles = [str((s.get("properties") or {}).get("title", "")) for s in (meta.get("sheets") or [])]
    if tab in titles:
        return tab
    if HOUSE_DATA_TAB in titles:
        print(f"  the house wears the matrix shape: its tab is \"{HOUSE_DATA_TAB}\", not \"{tab}\"")
        return HOUSE_DATA_TAB
    sys.exit(f"{tab}: the house {sid} has neither a \"{tab}\" tab nor a \"{HOUSE_DATA_TAB}\" one "
             f"(it has: {', '.join(titles) or 'no sheets at all'}). Nothing was written.")


def mint(have: dict[str, str], now: str, sa: str, dry: bool) -> tuple[str, str]:
    tab, title, prop = HOUSE["tab"], HOUSE["title"], HOUSE["prop"]
    header = HOUSE["header"]
    src_ptr = f"switchboard:props.{prop}"
    sid = have.get(src_ptr, "")
    if sid:
        print(f"· {tab}: pointer already in the depot ({sid[:14]}…) — reusing the house")
    if dry:
        print(f"  --dry-run: would {'reuse' if sid else 'create'} \"{title}\" "
              f"({len(header)} cols, {ROW_COUNT} rows), append the three facts and the "
              f"Registry row.")
        return sid or "(would create)", tab

    # THE LOGICAL NAME AND THE PHYSICAL ONE ARE NOT THE SAME THING ANY MORE.
    # `tab` is what the platform DECLARES — moved.hiring_alerts_catalog,
    # schema:hiring_alerts_catalog.header, the Registry context — and it never
    # changes. `sheet_tab` is the tab inside the workbook, which the matrix
    # rename may have turned into `Data`. Ranges use the second; every
    # declaration uses the first, or the reader would stop finding its pointer.
    sheet_tab = tab
    live_header = None
    if sid:
        # WHICH TAB, BEFORE ANY RANGE IS NAMED — the house may have been
        # renamed to `Data` since it was minted.
        sheet_tab = resolve_tab(sid)
        # NEVER RE-STAMP A LIVE HOUSE: a header PUT over a grown tab relabels
        # columns without moving one value, and here that would put one key's
        # note under another key's default.
        try:
            got = api(S + sid + "/values/" +
                      urllib.parse.quote(f"'{sheet_tab}'!1:1")).get("values") or []
        except Exception as exc:
            sys.exit(f"{sheet_tab}: could not read the header row of {sid} ({str(exc)[:160]}). "
                     f"Nothing was written.")
        live_header = [str(h) for h in (got[0] if got else []) if str(h).strip()]
        if live_header:
            header = live_header
            print(f"  live header kept ({len(header)} cols); the declaration follows it")
    if not sid:
        sid = api(S, {"properties": {"title": title},
                      "sheets": [{"properties": {
                          "title": sheet_tab,
                          "gridProperties": {"rowCount": ROW_COUNT,
                                             "columnCount": len(header) + 2,
                                             "frozenRowCount": 1}}}]}, "POST")["spreadsheetId"]
        print(f"  house created as asatech: {title} = {sid}")
    if live_header is None:
        api(S + sid + "/values/" + urllib.parse.quote(f"'{sheet_tab}'!A1") + "?valueInputOption=RAW",
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

    reg = api(S + ESSENCIAL_ID + "/values/" + urllib.parse.quote("'Registry'!A2:D9999")).get("values") or []
    if any(len(r) > 0 and str(r[0]).strip().lower() == f"data.{tab}" for r in reg):
        print("  Registry row already present (context)")
    elif any(len(r) > 1 and str(r[1]).strip() == sid for r in reg):
        print("  Registry row already present (spreadsheet)")
    else:
        api(S + ESSENCIAL_ID + "/values/" + urllib.parse.quote("'Registry'!A1") +
            ":append?valueInputOption=RAW&insertDataOption=INSERT_ROWS",
            {"values": [[f"data.{tab}", sid, "on", HOUSE["note"]]]}, "POST")
        print("  Registry row appended")

    if sa:
        try:
            api(D + sid + "/permissions?sendNotificationEmail=false&supportsAllDrives=true",
                {"role": "writer", "type": "user", "emailAddress": sa}, "POST")
            print(f"  shared with {sa} (writer)")
        except Exception as exc:
            print(f"  WARNING: share failed ({str(exc)[:100]}) — only Apps Script reads today, "
                  f"so this is not fatal")

    if SHARE:
        try:
            share_with_keeper(sid)
        except Exception as exc:  # noqa: BLE001 — the house is minted either way
            print(f"  WARNING: the keeper share failed ({str(exc)[:120]}) — the house stands,"
                  " but it is in no mirror until this is run again with --share")
    else:
        print(f"  NOT shared with the sheet keeper ({keeper_account() or 'unknown'}): this"
              " house is in no Postgres mirror and in no master JSON. Re-run with --share"
              " to change that.")
    return sid, sheet_tab


def fill(sid: str, tab: str, rows: list[dict]) -> None:
    """Write the missing keys. Never touch a key that is already there."""
    try:
        got = api(S + sid + "/values/" +
                  urllib.parse.quote(f"'{tab}'!A1:Z100000")).get("values") or []
    except Exception as exc:
        sys.exit(f"{tab}: could not read the tab of {sid} ({str(exc)[:160]}). Nothing was written.")
    if not got:
        sys.exit(f"{tab}: the tab answered with no header at all — refusing to append blind")
    head = [str(h).strip().lower() for h in got[0]]
    try:
        cols, width = columns(head)
    except ValueError:
        sys.exit(f"{tab}: the live header is {head} — it does not carry the four columns")

    def cell(row: list, at: int) -> str:
        return str(row[at]) if len(row) > at else ""

    live = {}
    for row in got[1:]:
        key = cell(row, cols["key"]).strip()
        if key:
            live[key] = row

    missing, names, same, differ = [], [], 0, []
    for r in rows:
        key = r["key"]
        if key not in live:
            missing.append(lay_out(r, cols, width))
            names.append(key)
            continue
        row = live[key]
        if (cell(row, cols["group"]) == r["group"]
                and cell(row, cols["default_value"]) == r["default_value"]
                and cell(row, cols["note"]) == r["note"]):
            same += 1
        else:
            differ.append(key)

    print(f"  {len(live)} key(s) already in the sheet · {same} identical · "
          f"{len(differ)} edited here · {len(missing)} to write")
    if differ:
        print("  LEFT ALONE (the sheet is the truth once it exists): " + ", ".join(differ))
    if not missing:
        print("  nothing to append — the catalogue is complete")
        return
    api(S + sid + "/values/" + urllib.parse.quote(f"'{tab}'!A1") +
        ":append?valueInputOption=RAW&insertDataOption=INSERT_ROWS",
        {"values": missing}, "POST")
    print(f"  appended {len(missing)} key(s): " + ", ".join(names))


def main() -> None:
    rows = rows_from_file()
    assert_no_drift(rows)
    if "--print" in sys.argv:
        # WHAT WOULD LAND IN THE CELLS, not the file read back to itself. The
        # header this tool declares, and every row laid out against it by the
        # same function fill() uses — so the check that compares this against
        # tools/hiring-alerts-catalogue.json really is a third witness.
        head = [h.strip().lower() for h in HOUSE["header"]]
        cols, width = columns(head)
        print(json.dumps({"header": HOUSE["header"],
                          "rows": [lay_out(r, cols, width) for r in rows]},
                         ensure_ascii=False))
        return
    dry = "--dry-run" in sys.argv
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    have = depot_state()
    sa = sa_email()
    print(f"service account for the share: {sa or 'NOT FOUND — the share will be skipped'}")
    print(f"\n{HOUSE['title']}")
    sid, sheet_tab = mint(have, now, sa, dry)
    if dry:
        print(f"\n--dry-run: nothing was written. {len(rows)} row(s) would be checked and "
              f"the missing ones appended.")
        return
    fill(sid, sheet_tab, rows)
    print(f"\ndata.{HOUSE['tab']} → {sid}")
    print("THE CATALOGUE IS LIVE inside the 300s switchboard cache and the reader's own")
    print("300s entry, so Settings shows it within about five minutes. No publish is needed")
    print("for a key edited in the sheet from now on — only for a key added to the")
    print("last-resort copy in apps-script/AlertsCatalog.gs.")


if __name__ == "__main__":
    main()
