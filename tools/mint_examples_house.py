#!/usr/bin/env python3
"""Mint the ASA Data — Examples book and seed it by EX_ id; from then on the sheet owns the rows."""
from __future__ import annotations

import base64
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve()
SEED_PATH = HERE.parent / "examples-seed.json"

ENV_PATH = Path("/opt/docker/asa-hub/server/.tools.env")
SA_JSON_PATHS = [Path("/opt/docker/asa-hub/server/.service-account.json")]
ESSENCIAL_ID = "1Y6UMJlCS5gHur52f0YrPsLSqwYlCA792I8gAiZsxsug"
RECORDED_BY = "mint-examples"

# cellText_ reads a cell's UTC components, which is right only on Etc/GMT
BOOK_TIMEZONE = "Etc/GMT"

# the height a tab is born with, never a ceiling when reading one back
ROW_COUNT = 500

S = "https://sheets.googleapis.com/v4/spreadsheets/"
D = "https://www.googleapis.com/drive/v3/files/"

# The keeper lists Drive as the plain service account: GOOGLE_IMPERSONATE_USER is EMPTY on the relay,
# and with_subject("") adds no sub claim (google-auth only does `if self._subject:`).
KEEPER_ACCOUNT = (os.getenv("GOOGLE_IMPERSONATE_USER") or "").strip()
SHARE = "--share" in sys.argv
DRIVE_SCOPELESS = "insufficient authentication scopes"


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


def keeper_account() -> str:
    return KEEPER_ACCOUNT or sa_email()


def share_with_keeper(tok: str, sid: str) -> None:
    """A permission never moves modifiedTime, so the book is touched either way."""
    who = keeper_account()
    if not who:
        print("  the keeper's account could not be read (no service-account JSON here and"
              " GOOGLE_IMPERSONATE_USER is empty) — nobody to share with.")
    else:
        granted = False
        said = ""
        try:
            api(tok, D + sid + "/permissions?sendNotificationEmail=false&supportsAllDrives=true",
                {"role": "reader", "type": "user", "emailAddress": who}, "POST")
            granted = True
        except Exception as exc:  # noqa: BLE001
            said = str(exc)
        if granted:
            print(f"  shared with {who} (reader)")
        elif DRIVE_SCOPELESS in said or "403" in said:
            print(f"  THE READ GRANT COULD NOT BE MADE FROM HERE. This tool's credential has"
                  f" no Drive scope, so it cannot change a permission on any file.\n"
                  f"    The book is in NO mirror and in NO master JSON until"
                  f" {who}\n"
                  f"    can open it. Either:\n"
                  f"      · open the book in Drive → Share → add that address as Viewer; or\n"
                  f"      · re-consent GS_GOOGLE_REFRESH_TOKEN with a Drive scope and run"
                  f" this again.\n"
                  f"    Then re-run with --share, or edit any cell, so the stamp moves.")
        else:
            print(f"  the read grant was not added ({said[:110]}) — it may already have"
                  " access; the touch below still moves the stamp")
    touch(tok, sid)


def touch(tok: str, sid: str) -> None:
    """A1 is written back RAW only when it holds no formula, else the title is; a write moves modifiedTime."""
    try:
        formula = _a1(api(tok, S + sid + "/values/A1?valueRenderOption=FORMULA"))
        value = _a1(api(tok, S + sid + "/values/A1?valueRenderOption=UNFORMATTED_VALUE"))
        if formula == value:
            api(tok, S + sid + "/values/A1?valueInputOption=RAW",
                {"range": "A1", "majorDimension": "ROWS", "values": [[value]]}, "PUT")
            print("  touched: A1 of the first tab written back with what it already held")
        else:
            title = str((api(tok, S + sid + "?fields=properties.title")
                         .get("properties") or {}).get("title") or "")
            api(tok, S + sid + ":batchUpdate",
                {"requests": [{"updateSpreadsheetProperties": {
                    "properties": {"title": title}, "fields": "title"}}]}, "POST")
            print("  touched: A1 holds a formula, so the book's own title was rewritten"
                  " with the title it already had — no cell was reached")
    except Exception as exc:  # noqa: BLE001
        print(f"  WARNING: the touch failed ({str(exc)[:110]}). The keeper lists a book"
              " only when its modifiedTime moves, and a permission never moves it —"
              " EDIT ONE CELL by hand or the book stays out of the mirror.")
        return
    print("    modifiedTime cannot be read back from here (it is a Drive field and this"
          " credential has no Drive scope), but a write is what moves it: the next"
          " sheet-sync pass lists the book, IF the keeper can open it.")


def _a1(got: dict):
    rows = got.get("values") or []
    return rows[0][0] if rows and rows[0] else ""


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


def api(tok: str, url: str, payload: dict | None = None, method: str = "GET",
        tries: int = 6) -> dict:
    for attempt in range(tries):
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
            if attempt < tries - 1:
                time.sleep(5 * (attempt + 1))
                continue
            raise
    return {}


def depot_state(tok: str) -> dict[str, str]:
    rows = api(tok, S + ESSENCIAL_ID + "/values/"
               + urllib.parse.quote("'Facts'!A2:I999999")).get("values") or []
    state: dict[str, str] = {}
    for row in rows:
        if len(row) > 4 and row[4]:
            state[str(row[4])] = str(row[2]) if len(row) > 2 else ""
    return state


def prop_for(tab: str) -> str:
    return "HUB_HOUSE_" + tab.upper() + "_ID"


def a1_col(index: int) -> str:
    letters = ""
    n = index + 1
    while n:
        n, rest = divmod(n - 1, 26)
        letters = chr(65 + rest) + letters
    return letters


def trim_trailing(cells: list[str]) -> list[str]:
    """Inner blanks are real grid columns; only trailing ones are dropped."""
    out = list(cells)
    while out and not str(out[-1]).strip():
        out.pop()
    return out


def seed() -> dict:
    data = json.loads(SEED_PATH.read_text())
    for spec in data["tabs"]:
        width = len(spec["header"])
        ids = set()
        for row in spec["rows"]:
            if len(row) != width:
                sys.exit(f"{spec['tab']}: a seed row has {len(row)} cells against a "
                         f"{width}-column header — refusing to mint a catalogue the reader "
                         f"would refuse.")
            rid = str(row[0])
            if not rid.startswith("EX_"):
                sys.exit(f"{spec['tab']}: seed id {rid!r} does not start with EX_, which is the "
                         f"only thing runRemoveExamples finds the rows by.")
            if rid in ids:
                sys.exit(f"{spec['tab']}: seed id {rid!r} is used twice.")
            ids.add(rid)
    return data


def book_id(have: dict[str, str], tabs: list[dict]) -> str:
    for spec in tabs:
        sid = have.get(f"switchboard:props.{prop_for(spec['tab'])}", "")
        if sid:
            return sid
    return ""


def main() -> None:  # noqa: C901
    dry = "--dry-run" in sys.argv
    data = seed()
    tabs = data["tabs"]
    title = data["book_title"]
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

    tok = token()
    have = depot_state(tok)
    sid = book_id(have, tabs)
    print(f"{title}: "
          + (f"pointer already in the depot ({sid[:14]}…) — reusing the book"
             if sid else "no pointer in the depot — a new book"))

    if dry:
        for spec in tabs:
            print(f"  --dry-run: {spec['tab']} — {len(spec['header'])} columns, "
                  f"{len(spec['rows'])} seed rows, three depot facts")
        print("  --dry-run: the keeper share "
              + ("WOULD be asked for, for "
                 + (keeper_account() or "nobody — none could be read")
                 + " — and refused, because this credential has no Drive scope; the book"
                   " WOULD be touched, which is the half that works"
                 if SHARE else "is NOT asked for")
              + " (--share)")
        print("--dry-run: nothing was written.")
        return

    if not sid:
        sid = api(tok, S, {
            "properties": {"title": title, "timeZone": BOOK_TIMEZONE},
            "sheets": [{"properties": {
                "title": spec["tab"],
                "gridProperties": {"rowCount": ROW_COUNT,
                                   "columnCount": len(spec["header"]) + 3,
                                   "frozenRowCount": 1}}} for spec in tabs],
        }, "POST")["spreadsheetId"]
        print(f"  book created as the platform account, on {BOOK_TIMEZONE}: {title} = {sid}")

    live = api(tok, S + sid)
    present = {str(s["properties"]["title"]) for s in live.get("sheets", [])}
    height = {str(s["properties"]["title"]):
              int(s["properties"].get("gridProperties", {}).get("rowCount") or ROW_COUNT)
              for s in live.get("sheets", [])}
    facts: list[list[str]] = []

    zone_now = str((live.get("properties") or {}).get("timeZone") or "")
    if zone_now != BOOK_TIMEZONE:
        api(tok, S + sid + ":batchUpdate", {"requests": [{"updateSpreadsheetProperties": {
            "properties": {"timeZone": BOOK_TIMEZONE}, "fields": "timeZone"}}]}, "POST")
        print(f"  book moved from {zone_now or 'the account default'} to {BOOK_TIMEZONE} — "
              f"the clock cellText_ is valid for")
    else:
        print(f"  book already on {BOOK_TIMEZONE}")

    for spec in tabs:
        tab, header, rows = spec["tab"], spec["header"], spec["rows"]

        if tab not in present:
            api(tok, S + sid + ":batchUpdate", {"requests": [{"addSheet": {"properties": {
                "title": tab,
                "gridProperties": {"rowCount": ROW_COUNT,
                                   "columnCount": len(header) + 3,
                                   "frozenRowCount": 1}}}}]}, "POST")
            height[tab] = ROW_COUNT
            print(f"  {tab}: tab added")

        # never re-stamp a live header: a PUT over a grown tab relabels columns without moving values
        got = api(tok, S + sid + "/values/"
                  + urllib.parse.quote(f"'{tab}'!1:1")).get("values") or []
        live_header = trim_trailing([str(h) for h in (got[0] if got else [])])
        if any(h.strip() for h in live_header):
            missing = [h for h in header if h not in live_header]
            if missing:
                print(f"  {tab}: WARNING — the live header is missing {', '.join(missing)}; "
                      f"the loader will refuse this tab until somebody adds the columns")
            else:
                print(f"  {tab}: live header kept ({len(live_header)} columns)")
            header_now = live_header
        else:
            api(tok, S + sid + "/values/" + urllib.parse.quote(f"'{tab}'!A1")
                + "?valueInputOption=RAW", {"values": [header]}, "PUT")
            print(f"  {tab}: header stamped ({len(header)} columns)")
            header_now = header

        # ids come from the live header's id column, never a fixed column A: people rearrange tabs
        if "id" not in header_now:
            sys.exit(f"{tab}: the live header carries no `id` column, so this tool cannot tell "
                     f"which seed rows are already there — and appending them blind would double "
                     f"every id. Put the column back (the loader needs it too) and run again.")
        letter = a1_col(header_now.index("id"))
        last = max(int(height.get(tab, ROW_COUNT)), 2)
        body = api(tok, S + sid + "/values/"
                   + urllib.parse.quote(f"'{tab}'!{letter}2:{letter}{last}")).get("values") or []
        already = {str(r[0]).strip() for r in body if r and str(r[0]).strip()}
        fresh = [row for row in rows if str(row[0]) not in already]
        if fresh:
            index = {name: i for i, name in enumerate(header)}
            lines = []
            for row in rows:
                if str(row[0]) in already:
                    continue
                lines.append([row[index[name]] if name in index else "" for name in header_now])
            api(tok, S + sid + "/values/" + urllib.parse.quote(f"'{tab}'!A1")
                + ":append?valueInputOption=RAW&insertDataOption=INSERT_ROWS",
                {"values": lines}, "POST")
        print(f"  {tab}: {len(fresh)} seed rows written"
              + (f", {len(rows) - len(fresh)} already there" if len(fresh) != len(rows) else ""))

        prop = prop_for(tab)
        src_ptr = f"switchboard:props.{prop}"
        if have.get(src_ptr) != sid:
            facts.append(["config.props." + prop.lower().replace("_", ""), prop, sid, "",
                          src_ptr, "", now, RECORDED_BY, ""])
        if have.get(f"switchboard:moved.{tab}") != "on":
            facts.append([f"config.moved.{tab}", f"moved.{tab}", "on", "",
                          f"switchboard:moved.{tab}", "", now, RECORDED_BY, ""])
        # headerOf_ drops empty cells, so the declared schema does too
        schema_val = json.dumps([h for h in header_now if str(h).strip()],
                                separators=(",", ":"))
        if have.get(f"schema:{tab}.header") != schema_val:
            facts.append([f"schema.{tab}.header", "__schema", schema_val, "",
                          f"schema:{tab}.header", "", now, RECORDED_BY, ""])

    if facts:
        api(tok, S + ESSENCIAL_ID + "/values/" + urllib.parse.quote("'Facts'!A1")
            + ":append?valueInputOption=RAW&insertDataOption=INSERT_ROWS",
            {"values": facts}, "POST")
        print(f"  {len(facts)} depot facts appended")
    else:
        print("  the depot already said all of it — no fact appended")

    fresh_state = depot_state(tok)
    for spec in tabs:
        tab = spec["tab"]
        assert fresh_state.get(f"switchboard:props.{prop_for(tab)}") == sid, \
            f"{tab}: pointer did not land"
        assert fresh_state.get(f"switchboard:moved.{tab}") == "on", \
            f"{tab}: moved switch did not land"
    print(f"  declared: {len(tabs)} tabs → {sid[:14]}… · moved.<tab>=on · schema per tab")

    if SHARE:
        try:
            share_with_keeper(tok, sid)
        except Exception as exc:  # noqa: BLE001
            print(f"  WARNING: the keeper share failed ({str(exc)[:120]}) — the book stands,"
                  " but it is in no mirror until this is run again with --share")
    else:
        print(f"  NOT shared with the sheet keeper ({keeper_account() or 'unknown'}): this"
              " book is in no Postgres mirror and in no master JSON. Re-run with --share"
              " to change that.")

    print(f"\nTHE CATALOGUE IS LIVE: {title} = {sid}")
    print("Edit a cell there and the NEXT runLoadExamples writes what it says — a row that is")
    print("not in the destination yet is written, a row whose cells no longer match is UPDATED")
    print("to the sheet's words, and a row already right costs nothing. Nothing to publish.")
    print("The pointers sit behind a 300 s cache; the job asks the depot again before it ever")
    print("says a catalogue does not exist, so running it right now is fine.")
    print("runRemoveExamples never reads this book: it takes away the EX_ rows that are in the")
    print("destinations, so deleting the catalogue can never strand them.")
    print("\nONE TAB IS WRITE-ONLY TODAY: travelTrips_ (Travel.gs) drops every EX_ id before the")
    print("Business Travel screen sees it — a standing instruction, not a bug. example_trips is")
    print("still written and still removed, and it still shows in raw sheet mode, but editing it")
    print("does not change that screen until the filter is lifted.")


if __name__ == "__main__":
    main()
