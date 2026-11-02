#!/usr/bin/env python3
"""
Mint the Behavior Support houses — TWO houses, the standard model, born empty.

WHY TWO. A robust ASA Hub with the full capabilities, beside an ASA Data whose
inputs are generic — anything at all may enter it. That is the cortex as an
architecture:

  behavior_signals   THE GENERIC INPUT. One row per (subject, signal, window),
                     upserted by a deterministic id. Anything may enter it —
                     the relay's measured usage, a fact the cortex volunteers,
                     a note somebody files by hand — because the shape is
                     (who · what · how much · when · who says so) and nothing
                     narrower. That is the cortex's own architecture written
                     in the Hub's sheets.

  behavior_readings  THE COMPOSED READING. One row per person: the arithmetic
                     the platform can defend, the verdicts, and the paragraph
                     the model wrote over them — stored, hash-gated, never
                     re-bought on a page view (the staffPerfEvaluate law).

Two houses because one house is one tab is one functionality: raw observation
and composed judgement age differently, and a reading must never be mistaken
for a measurement.

The ritual is mint_form_files_house.py's, verbatim in shape:
  1. create each house AS ASATECH (the platform-file owner law), ONE tab named
     after the tab itself, the full header stamped and frozen;
  2. append THREE facts to the Essencial (append, never edit):
       switchboard:props.HUB_HOUSE_<TAB>_ID → the house id
       switchboard:moved.<tab>              → on
       schema:<tab>.header                  → the header JSON
  3. one Registry row per house (Context `data.<tab>`) so the census and the
     runtime engine see it;
  4. share with the SERVICE ACCOUNT as Editor — reserved for the day a Python
     worker writes here; today Apps Script is the only writer, and a share
     that is never used costs nothing while a missing one is a silent death.

Re-runnable: an existing pointer reuses the house; facts, Registry rows and
the share are only appended/applied when missing.

    python3 tools/mint_behavior_houses.py --dry-run
    python3 tools/mint_behavior_houses.py
"""
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
RECORDED_BY = "mint-behavior"

# ---------------------------------------------------------------------------
# THE TWO HOUSES
# ---------------------------------------------------------------------------

# THE GENERIC INPUT. `signal` is free text (app.opens, forms.submitted,
# shift.hours, site.minutes, cortex.fact …), `value` is the number when there
# is one and the text when there is not, `payload` carries whatever else the
# writer wants to say. A row is addressed by `id`, so a writer that upserts
# keeps the house bounded and a writer that appends is still welcome.
SIGNALS = {
    "tab": "behavior_signals",
    "title": "ASA Data — BehaviorSignals",
    "prop": "HUB_HOUSE_BEHAVIOR_SIGNALS_ID",
    "note": "data: behavior_signals (the generic observation sink — anything may enter)",
    "header": [
        "id", "createdAt", "updatedAt",
        # WHO the observation is about
        "subject_kind", "subject_key", "subject_name",
        # WHAT was observed
        "signal", "value", "unit", "detail",
        # WHEN, over what stretch
        "at", "window",
        # WHO says so, and where they stand
        "source", "tenant",
        # anything the shape above cannot hold
        "payload",
    ],
}

# THE COMPOSED READING. One row per person; `metrics` and `highlights` are
# JSON so a new measurement never needs a new column, and the paragraph is
# stored beside the hash that bought it.
READINGS = {
    "tab": "behavior_readings",
    "title": "ASA Data — BehaviorReadings",
    "prop": "HUB_HOUSE_BEHAVIOR_READINGS_ID",
    "note": "data: behavior_readings (one composed reading per person)",
    "header": [
        "id", "createdAt", "updatedAt",
        # the person
        "subject_kind", "subject_key", "subject_name", "role",
        # what was read, over what stretch
        "window_days", "computed_at", "signals_hash",
        # the arithmetic the platform can defend
        "metrics", "top_apps", "franchises",
        # the verdicts, each with its own reason
        "site_verdict", "site_why", "shift_verdict", "shift_why", "reach_verdict",
        # the model's voice, and where it came from
        "reading", "highlights", "tags", "ai_model", "ai_via", "ai_at",
        # what the cortex added, WHEN it was asked, and what was looked at.
        # Both answers are kept and repainted on every open — only the button
        # replaces one: the information is held and shown every time until
        # somebody clicks again.
        "cortex_note", "cortex_at", "sources",
    ],
}

# THE ASSET TRAIL. The platform's own event grammar (Events.gs EVENTS_HEADER)
# plus one column: asset_id. It borrows the grammar and refuses the address —
# `events` takes 4,000-5,800 rows a day and eventList_ reads only the newest
# 500, so an asset event written this morning would be unreadable by lunch.
# Not a RESOURCES entry either: every routed resource is re-read whole by the
# bundle on every cycle, in the one execution slot this account has.
ASSET_EVENTS = {
    "tab": "asset_events",
    "title": "ASA Data — AssetEvents",
    "prop": "HUB_HOUSE_ASSET_EVENTS_ID",
    "note": "data: asset_events (what happened to each asset, by asset)",
    "header": [
        "event_id", "type", "actor",
        "subject_type", "subject_key", "subject_name",
        "asset_id",
        "payload", "source", "at", "tenant",
    ],
}

# WHAT A PERSON SAID, ONE ROW PER QUESTION. The free text, the dates typed by
# hand and the form dropdowns each need a place of their own inside the
# protocol.
#
# The answers existed — buried in a JSON cell on the submission, and their
# cross-check buried in a JSON cell inside another JSON cell on the file row.
# Neither is a question anybody can ask. "Whose typed expiry disagrees with
# their card" was a parse of every row in two houses.
#
# THE SHAPE IS TYPED PER SHAPE, not one text column doing four jobs: a date
# lands in answer_date as ISO, a dropdown in answer_choice, free text in
# answer_text, a number in answer_number. What the question FEEDS is `fact`,
# so two forms asking the same thing in different words are one query.
#
# A row exists whether or not a file came with it — a form with no upload
# still recorded what somebody said. `found`, `agree` and `note` stay empty
# until a document is read that this answer can be checked against.
FORM_ANSWERS = {
    "tab": "form_answers",
    "title": "ASA Data — FormAnswers",
    "prop": "HUB_HOUSE_FORM_ANSWERS_ID",
    "note": "data: form_answers (one row per question a person answered)",
    "header": [
        "id", "createdAt", "updatedAt",
        # which question, on which form, in which submission
        "form_slug", "submission_id", "field_key", "field_label", "field_kind",
        # what it feeds — person | doc_kind | expires_on | issued_on | date | ...
        "fact",
        # the answer, typed per shape
        "answer_text", "answer_date", "answer_choice", "answer_number",
        # who answered, and who the answer is ABOUT
        "answered_by", "subject_kind", "subject_key", "subject_name",
        # the paper it was checked against, when there was one
        "file_id", "asset_id", "doc_kind",
        # the cross-check
        "found", "agree", "note", "checked_at", "decoder_v",
    ],
}

HOUSES = [FORM_ANSWERS]


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


def mint(house: dict, have: dict[str, str], now: str, sa: str, dry: bool) -> str:
    tab, title, prop, header = house["tab"], house["title"], house["prop"], house["header"]
    src_ptr = f"switchboard:props.{prop}"
    sid = have.get(src_ptr, "")
    if sid:
        print(f"· {tab}: pointer already in the depot ({sid[:14]}…) — reusing the house")
    if dry:
        print(f"  --dry-run: would {'reuse' if sid else 'create'} \"{title}\" "
              f"({len(header)} cols), append the three facts and the Registry row.")
        return sid or "(would create)"

    if not sid:
        sid = api(S, {"properties": {"title": title},
                      "sheets": [{"properties": {
                          "title": tab,
                          "gridProperties": {"rowCount": 5000,
                                             "columnCount": len(header) + 3,
                                             "frozenRowCount": 1}}}]}, "POST")["spreadsheetId"]
        print(f"  house created as asatech: {title} = {sid}")
    # THE HEADER GOES DOWN BEFORE ANYTHING READS: a headerless tab feeds no
    # schema and no pointer, and the first writer resurrects it at headquarters.
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

    # THE REGISTRY ROW — the census's eye and the runtime engine's door. Deduped
    # by SPREADSHEET ID like the reference tool; the Registry is first-row-wins
    # per Context, so a second row for the same context would never speak.
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
            print(f"  WARNING: share failed ({str(exc)[:100]}) — only Apps Script writes today, "
                  f"so this is not fatal; share by hand before any Python writer is added")
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
    print("\nBOTH HOUSES ARE LIVE inside the 300s switchboard cache.")
    for tab, sid in made.items():
        print(f"  data.{tab} → {sid}")
    print("\nNext, in order:")
    print("  1. mint the app book (tools/mint_app_book.py behavior) — it reads the")
    print("     header LIVE from the declared house and refuses to document a guess;")
    print("  2. IN THE APPS SCRIPT EDITOR, by hand: runGatherDatabase() then")
    print("     runGatherDatabaseMove() — the two files are born in the asatech Drive")
    print("     root and only the editor can move them into ASA Hub - Source/Database.")


if __name__ == "__main__":
    main()
