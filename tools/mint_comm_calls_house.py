#!/usr/bin/env python3
"""
MINT THE TWO CLEAR HOUSES — what the phone lines carried, as facts.

THE DECISION: every phone call is analysed, all of it is read, the tables
carry the Smart Comms name itself, the words are encrypted, and only the
holder of the private key can open them.

WHAT IS BEING HOUSED. 1,619 calls sit in the live inbox's Postgres mirror,
every one carrying a full transcript, 1,460 of them never read by anything —
162 hours of speech across seven months, on fourteen unnamed phone lines. The
reading lane turns each call into FACTS, which live here, and WORDS, which do
not: the transcripts and every summary the model writes are encrypted to the
recipient's public key and stored as ciphertext in Postgres, where a 50,000
character cell cannot truncate them into something nobody can ever open.

THESE TWO HOUSES ARE THE CLEAR SIDE, AND THEY HOLD NO SPEECH AT ALL.

Each is a standard data house: `ASA Data — <Name>`, one tab, header on row 1,
declared by the THREE depot facts in the "ASA — Essencial" Facts tab plus one
Registry row, resolved by the pointer and NEVER by tab name:
  switchboard:props.HUB_HOUSE_<TAB>_ID  → the house id
  switchboard:moved.<tab>               → on
  schema:<tab>.header                   → the header JSON
  Registry Context: data.<tab>
Shared with the service account as Editor — and the share is not ceremonial:
the only writer either house can have is the relay holding that account
(server/comm_calls_feed.py → `commCallsIngest`, apps-script/CommCalls.gs). A
missing share is a silent death on the day the lane runs.

Re-runnable: an existing pointer reuses the house.

    python3 tools/mint_comm_calls_house.py --dry-run
    python3 tools/mint_comm_calls_house.py

The script MINTS AND STOPS. It does not read a call, does not seal anything,
does not feed, and arms nothing.

────────────────────────────────────────────────────────────────────────────
THE THIRD AND FOURTH TABLES ARE NOT HERE, AND THAT IS MEASURED, NOT STYLISTIC

`comm_call_seals` (the ciphertext) and `comm_call_reads` (the ledger) are
Postgres tables, minted by tools/mint_comm_call_seals_table.py. The seals
CANNOT be a house: a Sheets cell holds 50,000 characters, the largest
transcript in this corpus is 120,027 characters, and sealed and base64'd it is
roughly 161,000 — 3.2x over. A truncated GCM blob is not partially readable, it
is entirely unopenable. If anyone ever proposes chunking ciphertext across
cells, that proposal destroys the words it claims to be storing.

────────────────────────────────────────────────────────────────────────────
WHY THESE HOUSES ARE NEW AND NOT FOUR EXISTING BOOKS

Four books already hold this material and each has exactly ONE writer, which
is not this lane:

  EMPLOYEE SUPPORT QUEUE (349 rows) — the Request item, one for one, read
  under two labels off the same physical tab. Its `description_of_request`
  column is precisely the prose this design seals.
  UIs AND MUIs (694 rows) — the Incident item verbatim: four free-prose
  columns and an `incident_location`, which is a house code, which is an
  address.
  STAFF DAILY NOTES (486 rows from 62 calls, none after March) — call_id,
  caller phone, client name and the note text, all in the clear.
  THE CALLOFFS HOUSE — written by the live processor, answered in the same
  execution by CommCallOff.gs.

The new lane writes none of them. A call-off it finds is a `comm_work_items`
row with category 'Schedule - Call Off' and its reason UNDER SEAL; if a caller
must be answered, that stays CommCallOff.gs's job. `prior_lane` on the call row
records that a call was already handled elsewhere so a reader sees the overlap
WITHOUT this lane ever opening those books.

────────────────────────────────────────────────────────────────────────────
WHAT THESE HOUSES REFUSE TO CARRY, BY ANY ROUTE

THE WORDS, by every name they travel under: full_transcript,
speaker_transcript, summary, quote, description, description_of_request,
response, summary_of_incident, immediate_action_taken,
cause_and_contributing_factors, prevention_plan, notes, note, reason, raw. If a
field could reconstitute a sentence somebody said, it is sealed. There is NO
clear-text "context" column, no first-100-characters preview, no keyword list
lifted out of the words. That preview field is exactly the mistake this split
exists to prevent, and it is the one that will be proposed.

A CLIENT, in a record about a WORKER: client_name, consumers, num_consumers,
house, location_code, incident_location, address, latitude, longitude,
shift_code. The seventeen house codes in the Calendar Archive stand 1:1 with
seventeen client addresses, so the code IS the address wearing a shorter name.

A SECOND CONTACT LIST: phone, email. The People house is the platform's
contact list; a second one is a number an inbound reply can never be attributed
to — the mistake `comm_routes` had to retire. The caller's number resolves at
the door (`commCallsWho`) and does not land.

Three locks on each: absent from the headers below, never sent by the feed, and
refused BY NAME at the door with the refusal written into the platform log.
`ensureHeader_` appends, so a header can be widened by accident; a door that
refuses cannot be.

────────────────────────────────────────────────────────────────────────────
HOW OLD A ROW MAY GET, AND WHAT RETIRES IT

NOTHING RETIRES THESE ROWS, AND THAT IS THE POINT. This is not a rolling
answer about people like `comm_when`; it is the platform's record that a call
happened and what it was about. A row that expired would be a call that stopped
having happened, and its `seal_id` would become a pointer to ciphertext nobody
can find again — which is the same as destroying it.

  THEY GROW WITH EVERY CALL, one row per call and one per matter, and that is
  the honest shape: 1,619 calls today, a few a day after.
  THE KEY IS THE CALL. `id` is CC_<call_id> and CW_<call_id>_<n>, so a replayed
  batch patches its own lines instead of doubling them and a pass over
  unchanged rows performs ZERO writes.
  NOTHING IS EVER DELETED BY THE LANE. There is no sweeper, because a sweeper
  would be a second writer and these rows are evidence.
  A ROW MAY BE CLOSED, NOT REMOVED: `state` on a work item goes open → closed.
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
RECORDED_BY = "mint-comm-calls"

# ---------------------------------------------------------------------------
# THE HOUSES
# ---------------------------------------------------------------------------

# THE QUESTION THE CALL HOUSE ANSWERS: this call happened — when, on which
# line, how long, who the NUMBER established, was it read, and where are its
# words. Every column earns its place against that sentence.
#
# THE KEY. The row engine addresses a row by the column literally named `id`
# (SheetDb.gs, findRowIndex_), minted as CC_<call_id>. `call_id` carries the
# Quo id under its own name because that is the only join key between this
# house, the work items, the seals and the live inbox itself.
COMM_CALLS = {
    "tab": "comm_calls",
    "title": "ASA Data — CommCalls",
    "prop": "HUB_HOUSE_COMM_CALLS_ID",
    # 1,619 calls today and a few a day after. Room to triple before the grid
    # has to grow, and the door grows it when it must.
    "rows": 6000,
    "note": "data: comm_calls (one row per phone call — facts only, the words are sealed)",
    "header": [
        "id", "createdAt", "updatedAt",
        # THE POINTER, and the only join key. It reaches the live inbox, the
        # work items and the sealed words, and it is inside the ciphertext too
        # — so a seal that loses its row can still say which call it is.
        "call_id",
        # WHEN, in the agency's own clock. Empty when the inbox's cell could
        # not be read: a call whose moment is unknown still happened.
        "call_at",
        # WHICH COMPANY LINE, in E.164, AS DIGITS. THE LINES ARE UNNAMED —
        # nothing in this platform says which of the fourteen is the hotline,
        # the busiest is NOT known to be it, and a column captioned 'hotline'
        # would be an assertion nobody measured. 217 calls touched two lines
        # and carry both, comma-joined, because collapsing them would invent a
        # call that touched one.
        "line",
        "direction", "duration_sec", "turns",
        # WHO THE NUMBER ESTABLISHED — never the transcript. `name` is filled
        # ONLY where ContactGuard's resolver answered 'sole'; three of the
        # staff numbers are shared and one is a personal line, and a shared
        # line names NOBODY. `name_from` may read 'phone' or nothing and never
        # 'person': the words are sealed, so no name a transcriber heard can
        # reach this house by any route. `name_why` is the resolver's own
        # sentence, which asserts nothing.
        "person_key", "name", "name_from", "name_why",
        # WHICH SILENCE THIS IS: sole | shared | unknown | unresolved. The
        # fourth is this platform's own — the resolver could not be reached,
        # which is a different fact from "the number is not on the roster".
        "who_state",
        # MISSING IS NOT ZERO. read | unread | unreadable, and an unreadable
        # call's `items` is EMPTY, never 0 — a clear row asserting "this call
        # contained nothing" is a false fact and Calendar Builder ranks on it.
        "read_state", "read_at", "model_via", "items",
        # WHETHER SOMEBODY ELSE ALREADY HANDLED IT: hotline | legacy |
        # phonescreen | ''. Read off the inbox's own marks, so the overlap is
        # visible WITHOUT this lane opening anybody else's book.
        "prior_lane",
        # WHERE THE WORDS ARE. A pointer into comm_call_seals, never the words.
        "seal_id",
        # WHEN THE MIRROR WAS READ — one author, stamped once per hand-over.
        "source_at",
    ],
}

# THE QUESTION THE WORK-ITEM HOUSE ANSWERS: what the call was ABOUT. The
# classifier's three types, given a home — and nothing of what was said.
COMM_WORK_ITEMS = {
    "tab": "comm_work_items",
    "title": "ASA Data — CommWorkItems",
    "prop": "HUB_HOUSE_COMM_WORK_ITEMS_ID",
    # Fan-out per call is the one genuinely uncertain number: two per call is
    # the low estimate, and the legacy run produced 486 notes from 62 calls
    # (7.8/call) at the high end. 20,000 covers the high end for the whole
    # corpus and leaves the grid unchanged for a year of live calls.
    "rows": 20000,
    "note": "data: comm_work_items (one row per matter a call carried — facts only)",
    "header": [
        "id", "createdAt", "updatedAt",
        "call_id", "item_no",
        # THE THREE THE CONTRACT HAS: DailyNote | Incident | Request. There is
        # no fourth — `JobInterview` exists in no prompt and no parser in this
        # repository, and a type nothing downstream understands is a row nobody
        # will ever read.
        "work_type",
        # A CLOSED VOCABULARY, NEVER FREE TEXT, and this is a seal rule rather
        # than a tidiness rule: a category a model wrote while reading a
        # transcript IS the words wearing a category's clothes. The daily-note
        # and request lists are the hotline prompt's own; the incident list is
        # the ten `broad` rows of the platform's incident-category entity
        # table. Its ten `specific_minor` labels are one-line narratives about
        # a client's body and behaviour, so a matter that fits one files under
        # its broad parent and the detail goes under seal.
        "category",
        "urgency",
        # THE DAY THE MATTER IS ABOUT, resolved against the CALL'S own date and
        # never against today — this lane reads calls seven months old.
        "occurred_on",
        # THE SAME NAME LAW AS THE CALL ROW, repeated because a reader of this
        # house must not have to open the other one to know whether to trust a
        # name.
        "concerns_person_key", "concerns_name", "name_from",
        # THE MODEL'S OWN, 0..1, so a person can sort by how sure it was.
        "confidence",
        # open | closed. A matter is closed, never deleted: these rows are the
        # platform's record that somebody asked for something.
        "state",
        # WHERE THIS MATTER'S OWN WORDS ARE — <call_id>:<item_no>.
        "seal_id",
        # WHAT CALENDAR BUILDER RANKS ON.
        "source_call_at",
        "source_at",
    ],
}

HOUSES = [COMM_CALLS, COMM_WORK_ITEMS]


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
    rows = house["rows"]
    src_ptr = f"switchboard:props.{prop}"
    sid = have.get(src_ptr, "")
    if sid:
        print(f"· {tab}: pointer already in the depot ({sid[:14]}…) — reusing the house")
    if dry:
        print(f"  --dry-run: would {'reuse' if sid else 'create'} \"{title}\" "
              f"({len(header)} cols, {rows} rows), append the three facts and the Registry row.")
        return sid or "(would create)"

    live_header = None
    if sid:
        # NEVER RE-STAMP A LIVE HOUSE. `ensureHeader_` appends columns as the
        # writer grows, so the physical order is not the declared order; a
        # header PUT over it would relabel columns without moving one value —
        # and a relabelled column in a house of facts about people's calls is
        # a fact about the wrong call. The declaration follows the sheet.
        got = api(S + sid + "/values/" + urllib.parse.quote(f"'{tab}'!1:1")).get("values") or []
        live_header = [str(h) for h in (got[0] if got else []) if str(h).strip()]
        if live_header:
            header = live_header
            print(f"  live header kept ({len(header)} cols); the declaration follows it")
    if not sid:
        sid = api(S, {"properties": {"title": title},
                      "sheets": [{"properties": {
                          "title": tab,
                          "gridProperties": {"rowCount": rows,
                                             "columnCount": len(header) + 3,
                                             "frozenRowCount": 1}}}]}, "POST")["spreadsheetId"]
        print(f"  house created as asatech: {title} = {sid}")
    # THE HEADER GOES DOWN BEFORE ANYTHING READS: a headerless tab feeds no
    # schema and no pointer, and the first writer resurrects it at headquarters.
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
            ":append?valueInputOption=RAW&insertDataOption=INSERT_ROWS",
            {"values": facts}, "POST")
    fresh = depot_state()
    assert fresh.get(src_ptr) == sid, f"{tab}: pointer did not land"
    assert fresh.get(f"switchboard:moved.{tab}") == "on", f"{tab}: moved switch did not land"
    print(f"  declared: {prop} → {sid[:14]}… · moved.{tab}=on · schema ({len(header)} cols)")

    # THE REGISTRY ROW — the census's eye and the runtime engine's door. Deduped
    # by SPREADSHEET ID as well as by context; the Registry is first-row-wins per
    # Context, so a second row for the same context would never speak.
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
            print(f"  WARNING: share failed ({str(exc)[:100]}) — the ONLY writer this house "
                  f"can have is the relay holding that account. Share by hand before the "
                  f"lane runs, or seven months of reading lands nowhere")
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
    print("\nTHE HOUSES ARE LIVE inside the 300s switchboard cache, and EMPTY.")
    for tab, sid in made.items():
        print(f"  data.{tab} → {sid}")
    print("\nAN EMPTY HOUSE IS THE CORRECT STATE. Nothing has been read, and nothing")
    print("may be read until the keyholder's public key is on this machine: a call")
    print("read before there is a key to seal with leaves the words in the clear,")
    print("which is the one outcome this whole design exists to prevent.")
    print("\nNext, in order:")
    print("  1. tools/mint_comm_call_seals_table.py --apply — the ciphertext store,")
    print("     the ledger and the switch, in Postgres;")
    print("  2. the keyholder generates the keypair OFF this machine and copies ONLY")
    print("     the public certificate to /opt/docker/secrets/asa-seal-public.pem;")
    print("  3. `commCallsIngest` and `commCallsWho` are already named in")
    print("     ServiceIdentity.gs — without those names the hand-over answers 403;")
    print("  4. the relay needs comm_calls.py mounted read-only and the public")
    print("     certificate visible (see server/comm_calls_feed.py);")
    print("  5. then, and only then, a person starts the catch-up — it never")
    print("     starts itself.")


if __name__ == "__main__":
    main()
