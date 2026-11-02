#!/usr/bin/env python3
"""
MINT THE PUNCH HOUSE — the hours PsiAnywhere, the official time clock, kept.

`asa_psi_time_entries` in the cortex is the stored copy of PsiAnywhere's
clock-ins and clock-outs: 4,289 rows for 79 people over roughly ten weeks of
service dates, and it stopped when its scraper lost port 8443 — nothing adds
to it any more. The relay's attendance lane reads the live service and feeds
the same house with every entry it reads (server/psi_punches_feed.py). The
stored copy lives only in Postgres, where nobody in the business can open it
and no platform screen can read it.

A copy of this into a file is refused: the platform needs the SOURCE, taken
from the cortex. A file dump is a loose copy
nobody governs. A DECLARED HOUSE is the platform's own record — its protocol,
its Registry, its access rules, rendered by its own app. This mints that house
and stops.

  1. mint `ASA Data — PsiPunches`, one tab, header on row 1;
  2. three depot facts in the Essencial Facts tab —
       switchboard:props.HUB_HOUSE_PSI_PUNCHES_ID → the house id
       switchboard:moved.psi_punches              → on
       schema:psi_punches.header                  → the header JSON
  3. one Registry row (Context `data.psi_punches`);
  4. share with the SERVICE ACCOUNT as Editor — and here the share is NOT
     ceremonial: the only writer that can ever fill this house is the relay's
     Python feeder (the stored copy and the live reads). A missing share is a
     silent death on the day that feeder runs.

Re-runnable: an existing pointer reuses the house.

THE TAB NAME. `time_punches` is taken — it is the Recon lane's live tab, fed
by the "Cleaned Location" upload and read by Recon.gs and StaffAlerts.gs. Two
sources of punches in one tab would be one truth destroying another, so
PsiAnywhere's record gets its own house, named after where it came from.

WHAT THIS HOUSE REFUSES TO CARRY. The cortex table holds columns that are not
about the worker at all, and a reading about people never carries a client
name or a document:

  address, latitude, longitude  where a CLIENT lives, to the doorstep
  consumers, num_consumers      WHICH CLIENTS were present
  comments                      free text a supervisor typed (229 rows)
  house                         the site code — 17 codes standing 1:1 with 17
                                street addresses, so it IS `address`, spelled
                                shorter
  raw                           the whole PsiAnywhere payload as JSON, which contains
                                every one of the above; the back door

If managers later need site attribution, the answer is a declared column
carrying a code with no address behind it — not this one, and not `raw`.

    python3 tools/mint_psi_punches_house.py --dry-run
    python3 tools/mint_psi_punches_house.py

The script MINTS AND STOPS. It does not feed. The feeder is separate work, run
separately.
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
RECORDED_BY = "mint-psi-punches"

# The house is born large enough for everything that exists: 4,289 rows plus
# the header, plus room for the re-feed that corrects a row rather than the
# sync that will never resume.
ROW_COUNT = 6000

# ---------------------------------------------------------------------------
# THE HOUSE
# ---------------------------------------------------------------------------

# THE QUESTION THE HOUSE ANSWERS: when did this person work, and was it
# documented? Every column earns its place against that sentence.
#
# THE KEY. The row engine addresses a row by the column literally named `id`
# (SheetDb.gs, findRowIndex_), so `id` carries PsiAnywhere's Single_Entry_ID
# VERBATIM — 4,289 rows, 4,289 distinct values, zero collisions, all numeric
# and in one narrow band. A re-feed of the same entry therefore updates that
# row instead of growing a second one. `single_entry_id` repeats the same
# value under PsiAnywhere's own name, so a row printed from this house can still
# be matched against a PsiAnywhere screenshot by somebody who never heard the word
# `id`; the duplication costs one short number per row and buys the evidence
# its original label.
#
# THE TIMES ARE VERBATIM. start_time and end_time are PsiAnywhere's own strings
# ('02:20:00 PM'), and `hours` is PsiAnywhere's own check_hours — the number whose
# sum was verified against PsiAnywhere's "Total Hours" to the cent (1064.36 over
# 174 rows). The stored copy's rows cannot be fetched again the way they were:
# a parser that is subtly wrong would destroy evidence that cannot be re-fetched,
# and it would be wrong silently. A reader that wants minutes derives them
# downstream, where a bad parse is a display bug and not a lost record.
#
# The one exception is `date_iso`, and it is a measured one: 4,289 of 4,289
# `date_service` values match MM/DD/YYYY exactly, zero deviations, so the
# conversion is total and loses nothing — and without a sortable date the tab
# orders June after August. The verbatim `date_service` stays beside it.
PUNCHES = {
    "tab": "psi_punches",
    "title": "ASA Data — PsiPunches",
    "prop": "HUB_HOUSE_PSI_PUNCHES_ID",
    "note": "data: psi_punches (PsiAnywhere's clock-in/out record — the official time clock; the stored "
            "copy plus the relay's live reads — staff hours only, no client data)",
    "header": [
        "id", "createdAt", "updatedAt",
        # PSIANYWHERE'S OWN IDENTITY. `status` is its code kept as written: A is
        # awaiting and P is pending in PsiAnywhere's approval grid; I is the third
        # state and the largest (3,373 of 4,289). Nothing here has settled what
        # I means, so the code travels untranslated rather than carrying a
        # guess forward as a fact.
        "single_entry_id", "status",
        # WHO WORKED. `people_id` is PsiAnywhere's key and the join that already
        # exists — import_psi_staff.py lands it on perf_staff as psi_people_id,
        # so a punch reaches a staff row without matching names. It is kept
        # because names do not survive: 79 people_ids carry 80 spellings, and
        # one person appears as both "Jayleen Peterson" and "Jaylen Peterson".
        # The name rides along anyway, because a manager reads names.
        "employee", "people_id",
        # WHEN. Verbatim, plus the one derived date that makes the tab sort.
        # 27 rows carry no end_time — a punch nobody closed — and they are
        # kept as they are: an empty clock-out is the finding, not a defect.
        "date_service", "date_iso", "start_time", "end_time", "hours",
        # WHAT KIND OF WORK. Four codes across the whole record (HPC, ADMIN,
        # TRAIN, OSOC) — the difference between a shift and a training day.
        "work_code",
        # WHO FILED IT, which is not always who worked it: 38 submitting
        # logins for 79 workers, so many entries were typed by a supervisor.
        # That gap is exactly what "was it documented" means here.
        "submitted_user", "supervisor_id",
        # WAS IT DOCUMENTED. The compliance half of the question. Both flags
        # are false in every row that carries them (3,203 of 4,289; the rest
        # are blank), and `evv_reasons` holds a single code, 99, on 2,906
        # rows. That is a finding about PsiAnywhere, not a reason to drop
        # the columns: a house that keeps only the interesting columns cannot
        # prove the uninteresting ones were empty.
        "has_signature", "is_documented", "evv_reasons",
        # WHERE IT CAME FROM. The provenance a retired system needs most —
        # which table this row was lifted from, and when PsiAnywhere last spoke.
        "source", "source_synced_at", "tenant",
    ],
}

HOUSES = [PUNCHES]


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
        # and in a house that is the last copy of a retired system, a relabel
        # is an unrecoverable lie. The declaration follows the sheet.
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
            print(f"  WARNING: share failed ({str(exc)[:100]}) — the ONLY "
                  f"writer this house can have is a Python feeder holding that account. "
                  f"Share by hand before the feed, or the feed writes nowhere")
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
    print("\nNext, in order:")
    print("  1. the feeder, which does not exist yet: it reads asa_psi_time_entries,")
    print("     resolves this house through its pointer (never by tab name, never by a")
    print("     typed id), and lands the rows in passes of 2,000 — 4,289 rows is more")
    print("     than one comfortable pass and far less than the tab can hold. It carries")
    print("     the declared columns and NOTHING ELSE: address, latitude, longitude,")
    print("     consumers, num_consumers, comments, house and raw stay in the cortex.")
    print("  2. the app book over the live header (tools/mint_app_book.py), so the")
    print("     hours have a screen; the book reads the header from the declared house")
    print("     and refuses to document a guess.")


if __name__ == "__main__":
    main()
