#!/usr/bin/env python3
"""
Bring the DONE half into the IST table — who has already been trained.

Every row `rebuild_ist.py` ever wrote says `owed`, because nothing carried
the trainings that actually happened. They exist: 341 submissions of the
estate's "Individual Specific Training (IST)" Google Form, mirrored into
Postgres by the sheet-backup lane
(`asa_sheet_individual_specific_trai__form_responses_1_f1a7fa`). This is a
ONE-TIME COPY of that history — the old platform and its generator are being
discontinued, so the facts move here and the Hub's own "Mark trained" row
action is the intake from now on.

THE RULES
---------
  · MERGE, never replace, never delete — `rebuild_ist.py`'s own law;
  · an existing owed pair that the form proves trained flips to done IN
    PLACE (trainedAt / trainedBy filled, updatedAt stamped);
  · a trained pair with no row is APPENDED as done — the debt never
    existed on file, the proof does;
  · trainedAt is written by THIS tool directly to the tab: the CRUD lane's
    `stampWhen` would wipe a client-sent value (Main.gs, stamp is
    server-owned there);
  · names that do not key-match are NAMED IN THE OUTPUT, never dropped
    silently — the form spells people three ways;
  · per pair, the LATEST training date stands.

    python3 tools/import_ist_done.py --dry-run
    python3 tools/import_ist_done.py
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ENV_PATH = Path("/opt/docker/asa-hub/server/.tools.env")
# PARAMETRIZED BY THE DEPOT: both tabs resolve through their
# switchboard pointers in the Essencial — the same facts the live router
# reads. The Essencial id is the one bootstrap anchor (feed-depot's law).
ESSENCIAL_ID = "1Y6UMJlCS5gHur52f0YrPsLSqwYlCA792I8gAiZsxsug"
PEOPLE_SLICE = Path("/opt/docker/asa-hub/web/"
                    "snapshot/people.json")
CLIENTS_SLICE = Path("/opt/docker/asa-hub/web/"
                     "snapshot/clients.json")
TAB = "ist_records"
HEADER = ["id", "createdAt", "updatedAt", "staffName", "staffEmail", "staffPhone", "avatar",
          "clientName", "house", "dueDate", "status", "certNote",
          "trainedAt", "trainedBy", "notifiedAt", "notifyCount", "remindRequested", "houseStatus"]

FORM_SQL = """
select staff_receiving_ist_first_and_last_name,
       client_trained_on,
       coalesce(date_of_training, ''),
       coalesce(manager_giving_ist_first_and_last_name, '')
  from asa_sheet_individual_specific_trai__form_responses_1_f1a7fa
"""

# The form's spellings that differ from the platform's canonical names —
# found by eye on the real 341 rows; anything NOT here that fails to match
# is printed, never guessed.
ALIASES = {
    "kristen_hedrick": "kristin_hedrick",
    "barb_mayle": "barbara_mayle",
}


def key(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", str(name or "").lower()).strip("_")


def akey(name: str) -> str:
    k = key(name)
    return ALIASES.get(k, k)


def env(k: str) -> str:
    for line in ENV_PATH.read_text().splitlines():
        line = line.strip()
        if line.startswith(f"{k}="):
            return line.split("=", 1)[1].strip().strip("'\"")
    sys.exit(f"{k} not found in {ENV_PATH}")


def psql(sql: str) -> list[list[str]]:
    out = subprocess.run(
        ["docker", "exec", "asa-hub-db", "psql", "-U", "asa_hub", "-d", "asa_hub",
         "-tAF", "\x1f", "-c", sql],
        capture_output=True, text=True, timeout=120,
    )
    if out.returncode != 0:
        sys.exit(f"postgres refused: {out.stderr.strip()[:300]}")
    return [ln.split("\x1f") for ln in out.stdout.splitlines() if ln.strip()]


def token() -> str:
    body = urllib.parse.urlencode({
        "client_id": env("GS_GOOGLE_CLIENT_ID"),
        "client_secret": env("GS_GOOGLE_CLIENT_SECRET"),
        "refresh_token": env("GS_GOOGLE_REFRESH_TOKEN"),
        "grant_type": "refresh_token",
    }).encode()
    req = urllib.request.Request("https://oauth2.googleapis.com/token", data=body, method="POST")
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)["access_token"]


def sheet_api(tok: str, sheet_id: str, path: str, method: str = "GET", payload: dict | None = None) -> dict:
    url = f"https://sheets.googleapis.com/v4/spreadsheets/{sheet_id}{path}"
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", f"Bearer {tok}")
    req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, timeout=120) as r:
        raw = r.read()
        return json.loads(raw) if raw else {}


def depot_state(tok: str) -> dict[str, str]:
    got = sheet_api(tok, ESSENCIAL_ID,
                    f"/values/{urllib.parse.quote(chr(39) + 'Facts' + chr(39) + '!A2:I999999')}")
    state: dict[str, str] = {}
    for row in got.get("values", []) or []:
        if len(row) > 4 and row[4]:
            state[str(row[4])] = str(row[2]) if len(row) > 2 else ""
    return state


def house_id(tok: str, tab: str, depot: dict[str, str]) -> str:
    sid = depot.get(f"switchboard:props.HUB_HOUSE_{tab.upper()}_ID", "").strip()
    if not sid:
        sys.exit(f"the depot carries no house pointer for '{tab}' — declare it first.")
    return sid


def read_house(tok: str, sid: str, tab: str) -> tuple[list[str], list[dict]]:
    """The router's naming law: the original tab name first, then Data."""
    try:
        head, rows = read_tab(tok, sid, tab)
        if head:
            return head, rows
    except Exception:
        pass
    return read_tab(tok, sid, "Data")


def read_tab(tok: str, sheet_id: str, tab: str) -> tuple[list[str], list[dict]]:
    got = sheet_api(tok, sheet_id, f"/values/{urllib.parse.quote(tab + '!A1:AZ5000')}")
    rows = got.get("values", [])
    if not rows:
        return [], []
    head = [str(h).strip() for h in rows[0]]
    return head, [{head[i]: (r[i] if i < len(r) else "") for i in range(len(head))} for r in rows[1:]]


def norm_date(raw: str) -> str:
    """The form writes M/D/YYYY (and the mirror sometimes ISO). → YYYY-MM-DD."""
    s = str(raw or "").strip()
    if not s:
        return ""
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})", s)
    if m:
        return f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
    m = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{2,4})", s)
    if m:
        y = m.group(3)
        y = f"20{y}" if len(y) == 2 else y
        return f"{y}-{int(m.group(1)):02d}-{int(m.group(2)):02d}"
    return s[:10]


def main() -> None:
    dry = "--dry-run" in sys.argv
    tok = token()
    now = datetime.now(timezone.utc).isoformat()
    depot = depot_state(tok)
    records_house = house_id(tok, TAB, depot)
    houses_house = house_id(tok, "ist_houses", depot)

    # ── the canon: clients and houses the platform knows ────────────────
    _, house_rows = read_house(tok, houses_house, "ist_houses")
    house_of: dict[str, str] = {}
    client_name_by_key: dict[str, str] = {}
    for r in house_rows:
        c = str(r.get("clientName", "")).strip()
        if c:
            house_of[key(c)] = str(r.get("house", "")).strip()
            client_name_by_key[key(c)] = c

    try:
        people_rows = json.loads(PEOPLE_SLICE.read_text())
        if isinstance(people_rows, dict):
            people_rows = people_rows.get("rows", [])
    except Exception:
        people_rows = []
    people = {key(p.get("name", "")): p for p in people_rows if p.get("name")}

    # a client can be real and OUTSIDE the 20 mapped houses (Lawson Davidson
    # was) — the client list itself is canon too, houseless
    try:
        client_rows = json.loads(CLIENTS_SLICE.read_text())
        if isinstance(client_rows, dict):
            client_rows = client_rows.get("rows", [])
        for c in client_rows:
            nm = str(c.get("name", "")).strip()
            if nm:
                client_name_by_key.setdefault(key(nm), nm)
    except Exception:
        pass

    # ── what the table holds today ──────────────────────────────────────
    head, existing_rows = read_house(tok, records_house, TAB)
    if head[: len(HEADER)] != HEADER:
        sys.exit(f"unexpected {TAB} header — refusing to write blind: {head[:6]}…")
    by_pair: dict[tuple[str, str], tuple[int, dict]] = {}
    for idx, r in enumerate(existing_rows):
        by_pair[(akey(r.get("staffName", "")), key(r.get("clientName", "")))] = (idx + 2, r)
    canonical_staff = {akey(r.get("staffName", "")): str(r.get("staffName", "")).strip()
                       for r in existing_rows}
    for k, p in people.items():
        canonical_staff.setdefault(k, str(p.get("name", "")).strip())

    # ── the 341 facts, deduped to the latest date per pair ──────────────
    trained: dict[tuple[str, str], tuple[str, str, str, str]] = {}
    unmatched_staff: dict[str, int] = {}
    unmatched_client: dict[str, int] = {}
    for staff_raw, client_raw, date_raw, manager_raw in psql(FORM_SQL):
        # the aliases cover clients too: the form spells Kristin/Barbara wrong
        sk, ck = akey(staff_raw), akey(client_raw)
        if not sk or not ck:
            continue
        staff_known = sk in canonical_staff
        client_known = ck in client_name_by_key or any(pk[1] == ck for pk in by_pair)
        if not staff_known:
            unmatched_staff[staff_raw.strip()] = unmatched_staff.get(staff_raw.strip(), 0) + 1
        if not client_known:
            unmatched_client[client_raw.strip()] = unmatched_client.get(client_raw.strip(), 0) + 1
        if not staff_known or not client_known:
            continue
        date = norm_date(date_raw)
        prev = trained.get((sk, ck))
        if prev is None or date > prev[2]:
            trained[(sk, ck)] = (staff_raw.strip(), client_raw.strip(), date, manager_raw.strip())

    # ── the merge ───────────────────────────────────────────────────────
    flips: list[tuple[int, str, str]] = []          # (rownum, trainedAt, trainedBy)
    appends: list[list[str]] = []
    already_done = 0
    for (sk, ck), (_, client_raw, date, manager) in sorted(trained.items()):
        hit = by_pair.get((sk, ck))
        if hit:
            rownum, row = hit
            if str(row.get("status", "")).strip().lower() == "done":
                already_done += 1
                continue
            flips.append((rownum, date, manager))
        else:
            staff_name = canonical_staff[sk]
            client_name = client_name_by_key.get(ck, client_raw)
            person = people.get(sk, {})
            house = house_of.get(ck, "")
            appends.append([
                f"IST_{house or 'X'}_{sk}_{ck}", now, now,
                staff_name,
                str(person.get("email", "")), str(person.get("phone", "")),
                str(person.get("avatar", "")),
                client_name, house, date, "done", "",
                date, manager, "", "0", "",
                "" if house else "house no longer mapped",
            ])

    print(f"form facts (deduped pairs) : {len(trained)}")
    print(f"owed rows flipping to done : {len(flips)}")
    print(f"new done rows appended     : {len(appends)}")
    print(f"already done, untouched    : {already_done}")
    if unmatched_staff:
        print(f"\nform staff with NO platform match ({len(unmatched_staff)}) — rows NOT imported for them:")
        for n, c in sorted(unmatched_staff.items()):
            print(f"   {n}  (×{c})")
    if unmatched_client:
        print(f"\nform clients with NO platform match ({len(unmatched_client)}):")
        for n, c in sorted(unmatched_client.items()):
            print(f"   {n}  (×{c})")

    if dry:
        print("\n--dry-run: nothing written.")
        return

    # flips: one batchUpdate — updatedAt(C), status(K), trainedAt(M), trainedBy(N)
    if flips:
        data = []
        for rownum, date, manager in flips:
            data.append({"range": f"{TAB}!C{rownum}", "values": [[now]]})
            data.append({"range": f"{TAB}!K{rownum}:N{rownum}",
                         "values": [["done", "", date, manager]]})
        # K:N writes status, certNote, trainedAt, trainedBy — certNote must
        # NOT be blanked, so write K alone and M:N alone instead
        data = []
        for rownum, date, manager in flips:
            data.append({"range": f"{TAB}!C{rownum}", "values": [[now]]})
            data.append({"range": f"{TAB}!K{rownum}", "values": [["done"]]})
            data.append({"range": f"{TAB}!M{rownum}:N{rownum}", "values": [[date, manager]]})
        sheet_api(tok, records_house, "/values:batchUpdate", "POST",
                  {"valueInputOption": "RAW", "data": data})
        print(f"flipped {len(flips)} row(s) to done.")

    for i in range(0, len(appends), 500):
        chunk = appends[i:i + 500]
        sheet_api(tok, records_house,
                  f"/values/{urllib.parse.quote(TAB + '!A:R')}:append"
                  "?valueInputOption=RAW&insertDataOption=INSERT_ROWS",
                  "POST", {"values": chunk})
        print(f"   appended {i + len(chunk)}/{len(appends)}")

    print("\ndone — the table now says who owes AND who does not.")


if __name__ == "__main__":
    main()
