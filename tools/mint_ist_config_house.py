#!/usr/bin/env python3
"""
MINT THE IST CONFIG HOUSE — the training lane's vocabulary, out of the code.

THE RULE: the IST lane still held hardcoded stretches of its own — the same
complaint that moved the hiring recipients and timings onto their own tab. The
course names, the certification an IST row reports on, the window that counts
as "expiring", the roster cells that are a coverage label and not a person, the
columns the IST table and the Compliance Matrix draw, and the words written on
a row: every one of them was a literal in a .gs or a .ts file, and every one of
them is a thing somebody who does not write code needs to change.

WHAT THIS SCRIPT DOES

  1. mint `ASA Data — IST Config`, one tab `ist_config`, header on row 1;
  2. three depot facts in the Essencial Facts tab —
       switchboard:props.HUB_HOUSE_IST_CONFIG_ID → the house id
       switchboard:moved.ist_config              → on
       schema:ist_config.header                  → the header JSON
  3. one Registry row (Context `data.ist_config`);
  4. share with the SERVICE ACCOUNT as Editor;
  5. seed one row per key of server/ist_config_defaults.json — key, value,
     note — the one declaration every copy is built from.

IDEMPOTENT, AND IN THE ONE DIRECTION THAT MATTERS. Re-running reuses an
existing house, never re-stamps a live header, and seeds ONLY the keys that
have no row yet. A value an admin edited is never written back: this tool adds
what is missing and touches nothing else, so it is safe to run after every
deploy that ships a new key.

    python3 tools/mint_ist_config_house.py --dry-run
    python3 tools/mint_ist_config_house.py [--share]

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

The script MINTS AND STOPS. The readers are apps-script/IstConfig.gs (and
Certs.gs / IST.gs / RequirementStates.gs through it), src/lib/istConfig.ts on
the browser side, server/ist_config.py on the relay (behavior_slices,
shift_requests, calendar_builder_houses, the /bundle), and tools/rebuild_ist.py.
Until it runs, all of them answer from the declared values — the same
behaviour the platform had before any of this — and each of them says so.
Apps Script also seeds any key missing from a live tab on its next read, never
touching a row that is already there.
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
RECORDED_BY = "mint-ist-config"

TAB = "ist_config"
TITLE = "ASA Data — IST Config"
PROP = "HUB_HOUSE_IST_CONFIG_ID"
NOTE = ("config: ist_config (the IST lane's vocabulary — courses, the roster labels that are not "
        "people, the columns the screens draw, the words on a row; admin and manager)")
HEADER = ["key", "value", "note"]
# A settings tab is tens of rows, not thousands. Born with room several times
# over so a key added next year never hits the ceiling.
ROW_COUNT = 500

# THE ROWS COME FROM THE ONE DECLARATION, server/ist_config_defaults.json —
# the file the SPA imports, the relay and the rebuild read, and IstConfig.gs
# carries generated. Nothing is typed here, so nothing here can drift.
DECLARATION = json.loads((Path(__file__).resolve().parent.parent / "server" /
                          "ist_config_defaults.json").read_text(encoding="utf-8"))
ROWS: list[tuple[str, str, str]] = [(d["key"], str(d["value"]), d["note"])
                                    for d in DECLARATION["keys"]]


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


S = "https://sheets.googleapis.com/v4/spreadsheets/"
D = "https://www.googleapis.com/drive/v3/files/"

KEEPER_ACCOUNT = (os.getenv("GOOGLE_IMPERSONATE_USER") or "").strip()
SHARE = "--share" in sys.argv
TOK = ""


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
    rows = api(S + ESSENCIAL_ID + "/values/" +
               urllib.parse.quote("'Facts'!A2:I999999")).get("values") or []
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


def cell_safe(v: str) -> str:
    """A leading '=' or '+' is read by Sheets as a formula and the cell becomes
    the literal text #ERROR!. Not one of the values here starts with either
    today, and the day one does is not the day to discover this."""
    s = str(v)
    return "'" + s if s[:1] in ("=", "+", "-", "@") else s


def main() -> None:
    global TOK
    dry = "--dry-run" in sys.argv
    TOK = token()
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    have = depot_state()
    sa = sa_email()
    print(f"service account for the share: {sa or 'NOT FOUND — the share will be skipped'}")

    src_ptr = f"switchboard:props.{PROP}"
    sid = have.get(src_ptr, "").strip()
    if sid:
        print(f"· {TAB}: pointer already in the depot ({sid[:14]}…) — reusing the house")
    else:
        # THE TAB MAY ALREADY EXIST IN THE HUB DB. IstConfig.gs creates and
        # seeds it on first touch wherever the router points, and until this
        # runs the router points at headquarters' own book. That copy holds the
        # shipped values, so nothing is lost by leaving it — but an edit made
        # in it before today is stranded the moment the declaration below
        # lands, and silence about that is how somebody's afternoon disappears.
        print(f"· {TAB}: no house declared yet. If anybody has already edited an `{TAB}` tab")
        print(f"  inside the Hub DB, carry those cells into the new house by hand — the")
        print(f"  declaration made below sends every reader to the house from then on.")

    if dry:
        print(f"  --dry-run: the keeper share "
              + ("WOULD be asked for, for "
                 + (keeper_account() or "nobody — none could be read")
                 + " — and refused, because this credential has no Drive scope; the book"
                   " WOULD be touched, which is the half that works"
                 if SHARE else "is NOT asked for")
              + " (--share)")
        print(f"  --dry-run: would {'reuse' if sid else 'create'} \"{TITLE}\" "
              f"({len(HEADER)} cols, {ROW_COUNT} rows), append the three facts and the Registry "
              f"row, and seed the keys that have no row yet.")
        for key, value, _note in ROWS:
            print(f"      {key} = {value[:70]}{'…' if len(value) > 70 else ''}")
        print("\n--dry-run: nothing was written.")
        return

    header = list(HEADER)
    live_header = None
    if sid:
        # NEVER RE-STAMP A LIVE HOUSE: a header PUT over a grown tab relabels
        # columns without moving one value.
        got = api(S + sid + "/values/" + urllib.parse.quote(f"'{TAB}'!1:1")).get("values") or []
        live_header = [str(h) for h in (got[0] if got else []) if str(h).strip()]
        if live_header:
            header = live_header
            print(f"  live header kept ({len(header)} cols); the declaration follows it")
    if not sid:
        sid = api(S, {"properties": {"title": TITLE},
                      "sheets": [{"properties": {
                          "title": TAB,
                          "gridProperties": {"rowCount": ROW_COUNT,
                                             "columnCount": len(header) + 3,
                                             "frozenRowCount": 1}}}]}, "POST")["spreadsheetId"]
        print(f"  house created as asatech: {TITLE} = {sid}")
    if live_header is None:
        api(S + sid + "/values/" + urllib.parse.quote(f"'{TAB}'!A1") + "?valueInputOption=RAW",
            {"values": [header]}, "PUT")
        print(f"  header stamped ({len(header)} cols)")

    facts = []
    if have.get(src_ptr) != sid:
        facts.append(["config.props." + PROP.lower().replace("_", ""), PROP, sid, "",
                      src_ptr, "", now, RECORDED_BY, ""])
    if have.get(f"switchboard:moved.{TAB}") != "on":
        facts.append([f"config.moved.{TAB}", f"moved.{TAB}", "on", "",
                      f"switchboard:moved.{TAB}", "", now, RECORDED_BY, ""])
    schema_val = json.dumps(header, separators=(",", ":"))
    if have.get(f"schema:{TAB}.header") != schema_val:
        facts.append([f"schema.{TAB}.header", "__schema", schema_val, "",
                      f"schema:{TAB}.header", "", now, RECORDED_BY, ""])
    if facts:
        api(S + ESSENCIAL_ID + "/values/" + urllib.parse.quote("'Facts'!A1") +
            ":append?valueInputOption=RAW&insertDataOption=INSERT_ROWS",
            {"values": facts}, "POST")
    fresh = depot_state()
    assert fresh.get(src_ptr) == sid, f"{TAB}: pointer did not land"
    assert fresh.get(f"switchboard:moved.{TAB}") == "on", f"{TAB}: moved switch did not land"
    print(f"  declared: {PROP} → {sid[:14]}… · moved.{TAB}=on · schema ({len(header)} cols)")

    reg = api(S + ESSENCIAL_ID + "/values/" +
              urllib.parse.quote("'Registry'!A2:D9999")).get("values") or []
    if any(len(r) > 0 and str(r[0]).strip().lower() == f"data.{TAB}" for r in reg):
        print("  Registry row already present (context)")
    elif any(len(r) > 1 and str(r[1]).strip() == sid for r in reg):
        print("  Registry row already present (spreadsheet)")
    else:
        api(S + ESSENCIAL_ID + "/values/" + urllib.parse.quote("'Registry'!A1") +
            ":append?valueInputOption=RAW&insertDataOption=INSERT_ROWS",
            {"values": [[f"data.{TAB}", sid, "on", NOTE]]}, "POST")
        print("  Registry row appended")

    if sa:
        try:
            api(D + sid + "/permissions?sendNotificationEmail=false&supportsAllDrives=true",
                {"role": "writer", "type": "user", "emailAddress": sa}, "POST")
            print(f"  shared with {sa} (writer)")
        except Exception as exc:
            print(f"  WARNING: share failed ({str(exc)[:100]}) — only Apps Script writes today, "
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

    # ---- THE ROWS, ADDITIVELY ------------------------------------------
    #
    # A key that already has a row is LEFT ALONE, whatever it holds. This tool
    # is run again after every deploy that ships a key, and a run that reset a
    # deliberate edit would be the last time anybody trusted it.
    got = api(S + sid + "/values/" + urllib.parse.quote(f"'{TAB}'!A2:A9999")).get("values") or []
    present = {str(r[0]).strip() for r in got if r and str(r[0]).strip()}
    missing = [r for r in ROWS if r[0] not in present]
    if not missing:
        print(f"  all {len(ROWS)} key(s) already have a row — nothing seeded")
    else:
        api(S + sid + "/values/" + urllib.parse.quote(f"'{TAB}'!A1") +
            ":append?valueInputOption=RAW&insertDataOption=INSERT_ROWS",
            {"values": [[k, cell_safe(v), n] for k, v, n in missing]}, "POST")
        print(f"  seeded {len(missing)} key(s):")
        for k, v, _n in missing:
            print(f"      {k} = {v[:70]}{'…' if len(v) > 70 else ''}")
    kept = len(ROWS) - len(missing)
    if kept:
        print(f"  left untouched: {kept} key(s) that already had a row")

    print(f"\ndata.{TAB} → {sid}")
    print("THE HOUSE IS LIVE inside the 300s switchboard cache.")
    print("Nothing to publish for it to take effect: IstConfig.gs reads the tab at run time,")
    print("the browser reads it through istConfigGet, and both fall back to the shipped")
    print("values — the ones the code always held — for as long as a read fails.")


if __name__ == "__main__":
    main()
