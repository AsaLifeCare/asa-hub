#!/usr/bin/env python3
"""Mint the MedDelCatalog house and seed the lane's live settings; an existing row is never rewritten."""
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
RECORDED_BY = "mint-meddel-catalog"

ROW_COUNT = 500

# Mirrors MEDDEL_CATALOG_HEADER in apps-script/MedDelCatalog.gs; tools/test-meddel-catalog.py asserts it.
HEADER = [
    "id", "createdAt", "updatedAt",
    # setting | level | active_status
    "kind",
    "name",
    # for a level, the Master column holding its expiration date
    "value",
    # a level's Master header label, where the renewed date is written back
    "label",
    # blank means yes; deleting a row never switches anything off
    "enabled",
    "note",
]

HOUSE = {
    "tab": "meddel_catalog",
    "title": "ASA Data — MedDelCatalog",
    "prop": "HUB_HOUSE_MEDDEL_CATALOG_ID",
    "note": "data: meddel_catalog (the Med Del renewal lane's settings — levels, employment "
            "statuses and phase timings; the messages stay Smart Comms situations)",
    "header": HEADER,
}

# MEDDEL_DEFAULTS; transcriptsSpreadsheetId stays blank because the id is resolved where it is read.
SETTINGS = [
    ("skillsCheckEmail", "reedh@starkdd.org",
     "Where the skills-check scheduling e-mail goes: the county board trainer. This is the ONE "
     "message in this lane that is sent directly rather than through Smart Comms."),
    ("skillsCheckAddress", "2950 Whipple Avenue NW, Canton, OH",
     "The address the skills check happens at. It is quoted in the scheduling e-mail and in the "
     "day-before reminder the employee gets."),
    ("employer", "Asa LifeCare",
     "The employer name sent on the StarkDD renewal application and signed at the bottom of the "
     "scheduling e-mail."),
    ("transcriptsSpreadsheetId", "",
     "The workbook of employee message transcripts. LEAVE BLANK to use the platform's own "
     "employee-master workbook, which is what it does today. Only fill this in to read replies "
     "from a different book."),
    ("transcriptsTab", "Other - Transcripts",
     "The tab inside that workbook where the replies are. Replies are matched to a person by the "
     "last 10 digits of their phone number."),
    ("windowDays", "60",
     "How many days before OR after a certification expires the lane picks it up (a whole number "
     "of days). A renewal is detected inside this window and nowhere else."),
    ("phase2ResendDays", "3",
     "Phase 2: how many days pass before the employee is asked again to sign and confirm the "
     "application. The ask repeats until they reply."),
    ("phase3WindowStart", "2",
     "Phase 3: the first day after the application on which a Relias course reminder may go out."),
    ("phase3WindowEnd", "12",
     "Phase 3: the last day after the application on which a Relias course reminder may go out. "
     "Relias access expires 14 days after its invitation, so this sits inside that."),
    ("phase3EveryDays", "2",
     "Phase 3: the smallest number of days between two Relias reminders to the same person."),
    ("scrapeAfterDays", "7",
     "Phase 5: how many days after the skills check the MAIS/DODD record is checked for the "
     "renewed certification. Finding it there is what updates the employee Master."),
    ("cancelAfterDays", "60",
     "How many days past the expiration date a renewal is abandoned while still waiting on the "
     "employee's confirmation. The flow is cancelled, never deleted."),
]

# MEDDEL_LEVELS x MEDDEL_LEVEL_COLUMNS x MEDDEL_LEVEL_HEADERS
LEVELS = [
    ("Med 1", "med_1_exp_date", "Med 1 Exp Date"),
    ("Med 2", "med_2_exp_date", "Med 2 Exp Date"),
    ("Med 3", "med_3_exp_date", "Med 3 Exp Date"),
]
LEVEL_NOTE = ("A certification this lane renews. `value` is the employee-Master column its "
              "expiration date is read from and `label` is that column's header, which is where "
              "the renewed date is written back. Set enabled to no to stop renewing this one; "
              "do not delete the row.")

# MEDDEL_ACTIVE_STATUSES.
STATUSES = ["yes", "other", "active"]
STATUS_NOTE = ("A value in the employee Master's Status column that still means EMPLOYED. Any "
               "other value cancels that person's open renewals. Compared in lower case. "
               "Switching every one of these off would cancel every open renewal, so the lane "
               "refuses an empty list and keeps the shipped three.")


def seed_rows(settings: dict[str, str], now: str) -> list[list[str]]:
    rows: list[list[str]] = []

    def row(kind: str, name: str, value: str, label: str, note: str) -> None:
        rows.append([f"mdc_{kind}_{name}".replace(" ", "_").lower(), now, now,
                     kind, name, value, label, "", note])

    for key, shipped, note in SETTINGS:
        row("setting", key, str(settings.get(key, shipped)), "", note)
    for name, column, label in LEVELS:
        row("level", name, column, label, LEVEL_NOTE)
    for word in STATUSES:
        row("active_status", word, "", "", STATUS_NOTE)
    return rows


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


TOK = token() if __name__ == "__main__" else ""
S = "https://sheets.googleapis.com/v4/spreadsheets/"
D = "https://www.googleapis.com/drive/v3/files/"

# The keeper lists Drive as the plain service account: GOOGLE_IMPERSONATE_USER is EMPTY on the relay,
# and with_subject("") adds no sub claim (google-auth only does `if self._subject:`).
KEEPER_ACCOUNT = (os.getenv("GOOGLE_IMPERSONATE_USER") or "").strip()
SHARE = "--share" in sys.argv


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


# This credential has no Drive scope, so a permission grant answers 403 with this text.
DRIVE_SCOPELESS = "insufficient authentication scopes"


def keeper_account() -> str:
    """The keeper lists Drive as the plain service account: GOOGLE_IMPERSONATE_USER is empty on the relay."""
    return KEEPER_ACCOUNT or sa_email()


def share_with_keeper(sid: str) -> None:
    """Grant the keeper read (never write) if this credential can, and touch the book either way."""
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
    """Rewrite A1 (or the title, over a formula) unchanged: only a write moves the modifiedTime the keeper lists by."""
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
    rows = got.get("values") or []
    return rows[0][0] if rows and rows[0] else ""


def live_overrides(have: dict[str, str]) -> tuple[dict[str, str], str]:
    """The legacy medDelConfig override, merged so seeding never changes what the lane runs on."""
    book = have.get("switchboard:props.HUB_APPS_BOOK_ID", "")
    if not book:
        return {}, ("the depot has no switchboard:props.HUB_APPS_BOOK_ID, so the legacy "
                    "medDelConfig override row could NOT be read")
    try:
        got = api(S + book + "/values/" + urllib.parse.quote("'finance_config'!A1:Z9999"))
    except Exception as exc:
        return {}, f"the finance_config tab could not be read ({str(exc)[:120]})"
    values = got.get("values") or []
    if not values:
        return {}, "the finance_config tab is empty"
    hdr = [str(h).strip() for h in values[0]]
    try:
        kcol, vcol = hdr.index("key"), hdr.index("value")
    except ValueError:
        return {}, "the finance_config tab has no key/value columns"
    raw = ""
    for line in values[1:]:
        if len(line) > kcol and str(line[kcol]).strip() == "medDelConfig":
            raw = str(line[vcol]).strip() if len(line) > vcol else ""
    if not raw:
        return {}, "no medDelConfig override row — the shipped values ARE the live values"
    try:
        saved = json.loads(raw)
    except Exception:
        return {}, "the medDelConfig row is not valid JSON — it was overriding NOTHING, so the shipped values stand"
    if not isinstance(saved, dict):
        return {}, "the medDelConfig row is not a JSON object — the shipped values stand"
    known = {k for k, _s, _n in SETTINGS}
    out = {k: str(v).strip() for k, v in saved.items() if k in known and str(v).strip()}
    unknown = sorted(set(saved) - known)
    why = f"medDelConfig carried {len(out)} live override(s)"
    if unknown:
        why += f"; ignored key(s) the lane does not read: {', '.join(unknown)}"
    return out, why


def mint(have: dict[str, str], now: str, sa: str, settings: dict[str, str], dry: bool) -> str:
    tab, title, prop = HOUSE["tab"], HOUSE["title"], HOUSE["prop"]
    header = list(HOUSE["header"])
    src_ptr = f"switchboard:props.{prop}"
    sid = have.get(src_ptr, "")
    if sid:
        print(f"· {tab}: pointer already in the depot ({sid[:14]}…) — reusing the house")
    if dry:
        print(f"  --dry-run: would {'reuse' if sid else 'create'} \"{title}\" "
              f"({len(header)} cols, {ROW_COUNT} rows), append the three facts, the Registry row "
              f"and up to {len(SETTINGS) + len(LEVELS) + len(STATUSES)} catalogue rows.")
        return sid or "(would create)"

    live_header = None
    if sid:
        # Never re-stamp a live header: a PUT relabels columns without moving values.
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
    # [] means row 1 was cleared: repair it, or seed() would put a data row in row 1.
    if not live_header:
        api(S + sid + "/values/" + urllib.parse.quote(f"'{tab}'!A1") + "?valueInputOption=RAW",
            {"values": [header]}, "PUT")
        print(f"  header stamped ({len(header)} cols)"
              + ("" if live_header is None else " — row 1 was blank and has been repaired"))

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
            {"values": [[f"data.{tab}", sid, "on", HOUSE["note"]]]}, "POST")
        print("  Registry row appended")

    if sa:
        try:
            api(D + sid + "/permissions?sendNotificationEmail=false&supportsAllDrives=true",
                {"role": "writer", "type": "user", "emailAddress": sa}, "POST")
            print(f"  shared with {sa} (writer)")
        except Exception as exc:
            print(f"  WARNING: share failed ({str(exc)[:100]})")

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

    seed(sid, tab, settings, now)
    return sid


def seed(sid: str, tab: str, settings: dict[str, str], now: str) -> None:
    """Append missing (kind, name) rows only; an existing row, edited or switched off, is never touched."""
    got = api(S + sid + "/values/" + urllib.parse.quote(f"'{tab}'!A1:Z{ROW_COUNT}")).get("values") or []
    # Seed only under a real header: a data row in row 1 is the one shape the reader refuses.
    if not got or not [h for h in got[0] if str(h).strip()]:
        print("  WARNING: the live tab has no header row — NOTHING was seeded. Re-run this tool; "
              "if it keeps saying this, the header write is failing and the catalogue is not live.")
        return
    hdr = [str(h).strip() for h in got[0]]
    try:
        kcol, ncol = hdr.index("kind"), hdr.index("name")
    except ValueError:
        print("  WARNING: the live tab has no kind/name columns — nothing was seeded")
        return
    have = set()
    for line in got[1:]:
        k = str(line[kcol]).strip().lower() if len(line) > kcol else ""
        n = str(line[ncol]).strip() if len(line) > ncol else ""
        if k or n:
            have.add((k, n))

    wanted = seed_rows(settings, now)
    # Re-project onto the live header, in case its columns were reordered.
    index = {name: i for i, name in enumerate(HEADER)}
    missing = []
    for row in wanted:
        key = (row[index["kind"]].lower(), row[index["name"]])
        if key in have:
            continue
        missing.append([row[index[h]] if h in index else "" for h in hdr])
    if not missing:
        print(f"  seed: all {len(wanted)} catalogue row(s) already present — nothing written")
        return
    api(S + sid + "/values/" + urllib.parse.quote(f"'{tab}'!A1") +
        ":append?valueInputOption=RAW&insertDataOption=INSERT_ROWS",
        {"values": missing}, "POST")
    kinds: dict[str, int] = {}
    for row in missing:
        k = str(row[hdr.index("kind")])
        kinds[k] = kinds.get(k, 0) + 1
    print(f"  seed: {len(missing)} row(s) appended (" +
          ", ".join(f"{v} {k}" for k, v in sorted(kinds.items())) + f"); "
          f"{len(wanted) - len(missing)} already there and left untouched")


def main() -> None:
    dry = "--dry-run" in sys.argv
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    have = depot_state()
    sa = sa_email()
    print(f"service account for the share: {sa or 'NOT FOUND — the share will be skipped'}")

    overrides, why = live_overrides(have)
    print(f"the live override row: {why}")
    for k, v in sorted(overrides.items()):
        shipped = dict((a, b) for a, b, _c in SETTINGS)[k]
        if str(v) != str(shipped):
            print(f"  carried over: {k} = {v}   (shipped: {shipped})")
    if not overrides and "could NOT be read" in why:
        print("  the catalogue will be seeded with the SHIPPED values. If that book carries an "
              "override, check it before trusting the seeded numbers — every one of them is "
              "editable in the new sheet afterwards.")
    settings = dict((k, s) for k, s, _n in SETTINGS)
    settings.update(overrides)

    print(f"\n{HOUSE['title']}")
    sid = mint(have, now, sa, settings, dry)
    if dry:
        print("\n--dry-run: nothing was written.")
        return
    print(f"\nTHE CATALOGUE IS LIVE inside the 300s switchboard cache: data.{HOUSE['tab']} → {sid}")
    print("\nWhat happens next, without anybody pushing or publishing:")
    print("  · the lane reads this house on its next pass and caches it for 60 seconds, so an")
    print("    edit in the sheet reaches the sweep, the board and the Master write-back within")
    print("    a minute;")
    print("  · until it can be read, MedDel.gs keeps running on the identical copy it ships")
    print("    with — no level disappears, nobody is marked as not delegated, and no renewal")
    print("    is skipped or fired twice — and says so in the log and on the screen;")
    print("  · the message wording is NOT here: those are Smart Comms situations and are")
    print("    edited from the Desk.")


if __name__ == "__main__":
    main()
