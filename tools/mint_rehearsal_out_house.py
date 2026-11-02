#!/usr/bin/env python3
"""
MINT THE REHEARSAL HOUSE — where a rehearsal's messages go instead of to people.

WHAT HAPPENED. The platform runs in test mode: every SMS is redirected to one
number and every e-mail to 4 addresses (`hubTestRedirect_`, Rpc.gs). That one
number is a GROUP on a shared phone, and everybody in it receives every
message. So one rehearsal of the
obligations lane, 64 threads at one message each, does not produce one test
message. It produces 64 identical texts into a group chat that real colleagues
read, each one addressed to a different person by first name.

That is not a flaw in the redirect. It is a thing nobody wrote: WHEN EVERY
DESTINATION COLLAPSES ONTO ONE, THE SENDING SHOULD COLLAPSE TOO, or stop being
a send at all. The rule is to arm it in a test sheet — in
rehearsal the destination becomes a SHEET, 64 messages become 64 rows anybody
can read, and nothing reaches a phone or an inbox.

This mints that sheet, declares it the way the protocol requires, and stops.
No writer exists yet; the dial's `record` position plans and writes but never
renders the words, so today nothing can show what would have been
said. This house is the place that gap gets filled into.

  1. mint `ASA Data — CommRehearsal`, one tab, header on row 1;
  2. three depot facts in the Essencial Facts tab —
       switchboard:props.HUB_HOUSE_COMM_REHEARSAL_ID → the house id
       switchboard:moved.comm_rehearsal              → on
       schema:comm_rehearsal.header                  → the header JSON
  3. one Registry row (Context `data.comm_rehearsal`);
  4. share with the SERVICE ACCOUNT as Editor — unused today, because Apps
     Script is the only writer, and a share that is never used costs nothing
     while a missing one is a silent death.

Re-runnable: an existing pointer reuses the house.

THE TAB NAME. `comm_rehearsal`, beside `comm_intents`, `comm_attempts` and the
rest — one lane, one prefix. It is NOT a second evidence house: the evidence
house records what really left, and this one records what deliberately did not.

    python3 tools/mint_rehearsal_out_house.py --dry-run
    python3 tools/mint_rehearsal_out_house.py

The script MINTS AND STOPS. It writes no rows. The writer — the rehearsal
position on the dial, which hands the message to this house instead of to
`rpcCall_` — is separate work.
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
RECORDED_BY = "mint-rehearsal-out"

# HOW MANY PASSES THE HOUSE KEEPS. A rehearsal run is one pass of about 64
# rows. Kept forever, a daily rehearsal reaches some 1,900 rows in a month and
# 23,000 in a year — a house nobody opens, which is the same as a house that
# does not exist. The writer retires whole passes beyond the newest 10, oldest
# first, so the tab holds roughly 640 rows and this week's words can still be
# compared against last week's. Retirement is by PASS and never by
# row: half a pass is a rehearsal that cannot be read as one thing.
PASSES_KEPT = 10

# Born with room for 10 passes several times over, so a wider sweep or a lagging
# trim never hits the ceiling mid-pass.
ROW_COUNT = 5000

# ---------------------------------------------------------------------------
# THE HOUSE
# ---------------------------------------------------------------------------

# THE QUESTION THE HOUSE ANSWERS, in one sentence: WHO would have been told,
# THROUGH WHICH CHANNEL, WHAT EXACTLY WOULD HAVE BEEN SAID, on whose behalf,
# under which situation, why it was allowed, and when. Every column earns its
# place against that sentence, and the ones that do not are named at the bottom
# of this comment so the next reader does not have to wonder whether they were
# forgotten.
#
# ── THE KEY, AND WHY THE HOUSE DOES NOT DOUBLE ───────────────────────────────
# A row is ONE MESSAGE IN ONE PASS. `pass_id` is minted once at the top of a
# rehearsal run and every row of that run carries it; `id` is derived from
# (pass_id · intent_key · channel), which is exactly what "the same message"
# means, and the row engine addresses a row by the column literally named `id`
# (SheetDb.gs, findRowIndex_). So re-entering the same pass — a sweep resumed
# after the six-minute ceiling, an execution retried — REWRITES its own rows
# instead of growing a second set.
#
# The NEXT rehearsal is a NEW pass, and it APPENDS. It does not replace, and
# that is the deliberate half: what the lane says today is compared against
# what it said yesterday, and a house that keeps only the last
# run cannot answer that question at all. Growth is bounded by retirement
# (PASSES_KEPT above), which is declared here rather than left to happen
# quietly — a pass that ages out is gone, and nobody should discover that from
# an empty screen.
#
# Keyed per message and not per person: one person can be owed an SMS and an
# e-mail in the same breath, and two channels are two different sets of words.
# Keyed per message and not per pass: a pass is 64 messages, and the whole
# point is reading them one at a time.
#
# ── THE BODY, AND WHY IT IS SAFE HERE ────────────────────────────────────────
# `comm_attempts` refuses to carry the body and keeps `words_sha` instead,
# because the evidence house is the record of what a named person was really
# told, and a second copy of a delivered message in a spreadsheet is the
# message stored twice. THIS HOUSE CARRIES THE BODY, and the difference is not
# a relaxation — it is a different fact:
#
#   · THE WORDS WERE NEVER DELIVERED. Nothing here is a record of what somebody
#     was told; it is a draft of what somebody would have been told. No person
#     holds a copy to reconcile against, and there is nothing to correct.
#   · READING THE ACTUAL WORDS IS THE ENTIRE PURPOSE. A digest answers "did the
#     wording move"; it cannot answer "is this sentence right to send to this
#     person", which is the only question a rehearsal exists for. `words_sha`
#     rides along anyway, so a pass can be grouped and a drift seen at a glance.
#   · THE HOUSE IS ADMIN-ONLY, like every reading about people. The app book
#     over this header must declare it that way (mint_app_book.py's
#     `behavior.read.badged` is the precedent) — a screen showing 64 people's
#     messages is not a screen anybody with a badge opens.
#   · IT DOES NOT ACCUMULATE. Passes age out; the body ages out with them.
#
# THE LAW THAT KEEPS THAT TRUE: the writer refuses to write here when the dial
# is anything but rehearsal. The moment a real send filled these rows, `body`
# would be a second copy of delivered words keyed to a named person, and every
# reason above would be false at once.
#
# ── THE REAL DESTINATION ─────────────────────────────────────────────────────
# In a rehearsal the true recipient is masked by the redirect, and who the
# message WAS FOR is the whole question. So the row says it twice over:
# `person_name` and `person_key` in the clear (this is an admin reading about
# people, and `comm_intents` already carries the name), and `to_masked` — the
# contact itself, under the platform's own recipe, `•••` plus the last four
# characters (`commMask_`, CommInbound.gs; `rpcMaskTo_`, Rpc.gs). The same
# recipe for both channels, not a second one invented for e-mail: on an address
# it degrades to the domain tail and says nothing, which is the right failure.
# The mask is not what protects anybody here — the admin-only door is; the mask
# keeps a contact out of a tab that gets copied and screenshotted.
#
# And beside it, `redirect_to_masked`: where test mode WOULD have thrown this
# message — the group number, or the tester list. That column is the incident
# in one cell. Sixty-four rows with 64 different `to_masked` values and ONE
# `redirect_to_masked` is the picture of 64 texts landing in one group chat,
# and it is visible without opening anything else.
#
# ── WHAT THIS HOUSE DOES NOT CARRY ───────────────────────────────────────────
#   the rendered HTML   the designed letter is a page of markup in a cell; the
#                       WORDS are the point, and the layout is rehearsed by
#                       looking at the letter, not by reading its source
#   the receipt         there is none, and an empty receipt column would invite
#                       a reader to think a send was attempted and failed
#   the rpcCall_ reason 'comms: <situation> · <intent_key>', which is two
#                       columns this row already carries, spelled as a sentence
REHEARSAL = {
    "tab": "comm_rehearsal",
    "title": "ASA Data — CommRehearsal",
    "prop": "HUB_HOUSE_COMM_REHEARSAL_ID",
    "note": "data: comm_rehearsal (what a rehearsal WOULD have said — rendered words, delivered to nobody; admin-only)",
    "header": [
        "id", "createdAt", "updatedAt",
        # THE PASS. One rehearsal run, named once and carried by every row of
        # it, so a run reads as a run. `seq` keeps the sweep's own
        # order — a sheet sorted by id is 64 rows in no order anybody chose.
        "pass_id", "pass_at", "pass_by", "seq",
        # WHO IT WAS FOR. The thread, the person's key, and the name — because
        # a manager reads names, and because the redirect hides everything else
        # about who this was aimed at.
        "intent_key", "person_key", "person_name",
        # THROUGH WHICH CHANNEL, AND TO WHERE. `to_masked` is the real
        # recipient's contact; `redirect_to_masked` is where test mode would
        # have sent it instead, and `redirected` says whether it would have
        # been diverted at all.
        "channel", "to_masked", "redirected", "redirect_to_masked",
        # UNDER WHICH SITUATION, AND ON WHOSE BEHALF. `words_sha` is the
        # identity of the TEMPLATES before substitution (commRepairWordsSha_),
        # so a pass groups by it and a wording that moved is one sorted column.
        # `sender_used` is the sender as actually substituted into the message,
        # and `from_account` the mailbox the e-mail leg would have left from —
        # the signature and the address are two different answers to "on whose
        # behalf", and both have to be answerable.
        "situation", "purpose", "words_sha", "sender_used", "from_account",
        # WHAT EXACTLY WOULD HAVE BEEN SAID. `subject` is blank on the SMS leg.
        # `body_chars` earns its cell twice: it says how many texts one message
        # really is, which is the volume question this whole house came from,
        # and a 0 beside a named situation is a template that rendered to
        # nothing — an empty cell and a cell that failed to write look
        # identical in a spreadsheet, and the count tells them apart.
        "subject", "body", "body_chars",
        # WHY IT WAS ALLOWED. `would_have_sent` is the plain yes/no a reader
        # scans first; `verdict` is the policy's own word for it and `reasons`
        # every reason it reached. `consent` and `window` are the two gates a
        # person would ask about by name — what they agreed to, and whether the
        # hour was theirs. `attempt` says which attempt this would have been,
        # so a first contact is not read as a fourth.
        "would_have_sent", "verdict", "reasons", "consent", "window", "attempt",
        # WHICH POSITION THE DIAL WAS IN when this was decided. A row from a
        # dial nobody can name is a row nobody can trust.
        "dial",
        # WHEN the decision was made, and the standing proof that this was a
        # rehearsal and not something that escaped.
        "at", "test_mode", "tenant",
    ],
}

HOUSES = [REHEARSAL]


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
              f"({len(header)} cols, {ROW_COUNT} rows), append the three facts and the Registry row.")
        return sid or "(would create)"

    live_header = None
    if sid:
        # NEVER RE-STAMP A LIVE HOUSE. ensureHeader_ appends columns as the
        # writer grows, so the physical order is not the declared order; a
        # header PUT over it would relabel columns without moving one value —
        # and in a house whose whole content is words attributed to named
        # people, a relabel puts one person's message under another's name.
        # The declaration follows the sheet.
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
                  f"so this is not fatal; share by hand before any Python reader or trimmer is added")
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
    print("\nTHE HOUSE IS LIVE inside the 300s switchboard cache, and EMPTY.")
    for tab, sid in made.items():
        print(f"  data.{tab} → {sid}")
    print("\nNothing writes here yet. Next, in order:")
    print("  1. THE REHEARSAL POSITION ON THE DIAL — the writer this house exists for.")
    print("     It renders the message the way commRecordSend_ does, and then hands the")
    print("     row to this house INSTEAD of to rpcCall_. Not after it, not beside it:")
    print("     a rehearsal that still calls the door is the 64 texts in the group chat.")
    print("     It resolves the house through its pointer, never by tab name.")
    print(f"  2. THE TRIM, in the same writer: whole passes beyond the newest {PASSES_KEPT},")
    print("     oldest first, so the tab stays a thing somebody opens. By pass, never by")
    print("     row — half a rehearsal cannot be read as a rehearsal.")
    print("  3. THE APP BOOK over the live header (tools/mint_app_book.py), declared")
    print("     ADMIN-ONLY: it is 64 people's messages on one screen. The book reads the")
    print("     header from the declared house and refuses to document a guess.")


if __name__ == "__main__":
    main()
