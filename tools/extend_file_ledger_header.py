#!/usr/bin/env python3
"""Give the two file ledgers the columns the decoder now has answers for.

ADDITIVE ONLY, and that word is load-bearing: columns are APPENDED, never
reordered and never removed, because every reader of these houses addresses
cells by header name and a moved column is a silent wrong answer.

What the decoder learned to say — which document this is, whose it is, what
it is about, when it was issued and when it expires, how sure it is, and
where the full text went — was living inside digest_json. A blob is not a
column: "whose CPR card expires this month" has to be a lookup, not a parse
of every row. `ASA Data — FormFiles` needs the new slugs, which means new
header columns of its own: person, project, and the rest.

Both ledgers get the same names, because one decoder serves both.

The depot's `schema:<tab>.header` fact is rewritten to match in the same run:
the sheet and the declaration are one thing, or the next reader trusts a lie.

    python3 tools/extend_file_ledger_header.py --dry-run
    python3 tools/extend_file_ledger_header.py
"""
from __future__ import annotations

import json
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

ENV_PATH = Path("/opt/docker/asa-hub/server/.tools.env")
ESSENCIAL_ID = "1Y6UMJlCS5gHur52f0YrPsLSqwYlCA792I8gAiZsxsug"
S = "https://sheets.googleapis.com/v4/spreadsheets/"

LEDGERS = [
    ("ASA Data — FormFiles", "19OvLdtyF0iENHcesFFm_6DyGjnqTfrjStAQJjiyh6Ww", "form_files"),
    ("ASA Data — ClientFiles", "1o7opeC1GR3J5Oj7iGEgYo0EKLPmkW_paGBtE8uMx3LY", "client_files"),
]

# In this order, appended after whatever the house already has.
NEW_COLUMNS = [
    "doc_kind",      # the slug: cpr_first_aid, isp, mar, drivers_licence, …
    "person",        # the full name as the document gives it
    "person_id",     # the anchor: people:<id> or client:<key> — never a name
    "subject_type",  # person | client | staff | house | vehicle | company | …
    "subject",       # what it is ABOUT, when that is not a person
    "issued_on",     # the labelled date, ISO
    "expires_on",    # the labelled date, ISO — what an office chases
    "confidence",    # 0-100; at or above the floor the file is never re-read
    "mentions",      # anchors the file CITES — house:CODE, client:KEY, people:ID
    "person_seen",   # the name the DOCUMENT prints, when it differs
    "person_agree",  # yes | no | corrected — the exception queue
    "answers_agree", # yes | no — the form's own answers against the paper
    "settles",       # which obligation this paper settled, and where the receipt went
    "asset_id",      # AST_<sha256[:32]> — the same paper through two doors is ONE id
    "sha256",        # the content hash, '' when the file was too large to hash
    "ai_summary",    # THE SMART COMMS SEAM, declared before it is opened
    "ai_summary_at",
    "ai_source",
    "text_file",     # Drive id of the Markdown holding the whole text
]


def env(k: str) -> str:
    for line in ENV_PATH.read_text().splitlines():
        line = line.strip()
        if line.startswith(f"{k}="):
            return line.split("=", 1)[1].strip().strip("'\"")
    sys.exit(f"{k} not found in {ENV_PATH}")


def bearer() -> str:
    body = urllib.parse.urlencode({
        "client_id": env("GS_GOOGLE_CLIENT_ID"),
        "client_secret": env("GS_GOOGLE_CLIENT_SECRET"),
        "refresh_token": env("GS_GOOGLE_REFRESH_TOKEN"),
        "grant_type": "refresh_token"}).encode()
    req = urllib.request.Request("https://oauth2.googleapis.com/token",
                                 data=body, method="POST")
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)["access_token"]


TOK = bearer()


def api(url: str, payload: dict | None = None, method: str = "GET") -> dict:
    for attempt in range(5):
        req = urllib.request.Request(url, method=method)
        req.add_header("Authorization", "Bearer " + TOK)
        if payload is not None:
            req.add_header("Content-Type", "application/json")
            req.data = json.dumps(payload).encode()
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 503) and attempt < 4:
                time.sleep(2 ** attempt)
                continue
            sys.exit(f"{e.code} {e.reason} — {e.read()[:300]!r}")
    return {}


def depot_state() -> dict[str, str]:
    rows = api(S + ESSENCIAL_ID + "/values/" +
               urllib.parse.quote("'Facts'!A2:I999999")).get("values") or []
    have: dict[str, str] = {}
    for r in rows:
        src = str(r[4]) if len(r) > 4 else ""
        if src:
            have[src] = str(r[2]) if len(r) > 2 else ""
    return have


def main() -> None:
    dry = "--dry-run" in sys.argv
    have = depot_state()
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    facts = []

    for title, sid, tab in LEDGERS:
        got = api(S + sid + "/values/" + urllib.parse.quote(f"'{tab}'!1:1"))
        header = [str(h) for h in (got.get("values") or [[]])[0]]
        if not header:
            sys.exit(f"{title}: the header row is empty — refusing to write blind.")
        missing = [c for c in NEW_COLUMNS if c not in header]
        print(f"{title} ({tab}): {len(header)} columns, "
              f"{len(missing)} to add{' — ' + ', '.join(missing) if missing else ''}")
        fresh = header + missing
        if missing and not dry:
            api(S + sid + "/values/" + urllib.parse.quote(f"'{tab}'!1:1") +
                "?valueInputOption=RAW", {"values": [fresh]}, "PUT")
            back = api(S + sid + "/values/" + urllib.parse.quote(f"'{tab}'!1:1"))
            landed = [str(h) for h in (back.get("values") or [[]])[0]]
            if landed != fresh:
                sys.exit(f"{title}: the header does not read back as written — stop.")
            print(f"   header now {len(landed)} columns, read back and verified")

        schema_src = f"schema:{tab}.header"
        schema_val = json.dumps(fresh, separators=(",", ":"))
        if have.get(schema_src) != schema_val:
            print(f"   {'would update' if dry else 'updating'} {schema_src}")
            facts.append([f"schema.{tab}.header", "__schema", schema_val, "",
                          schema_src, "", now, "extend-file-ledger-header", ""])

    if dry or not facts:
        if not facts:
            print("\nnothing to declare — the depot already agrees with the sheets.")
        return
    api(S + ESSENCIAL_ID + "/values/" + urllib.parse.quote("'Facts'!A1") +
        ":append?valueInputOption=RAW&insertDataOption=INSERT_ROWS",
        {"values": facts}, "POST")
    fresh_state = depot_state()
    for _title, _sid, tab in LEDGERS:
        assert fresh_state.get(f"schema:{tab}.header"), f"{tab} schema fact did not land"
    print("\nsheets and depot agree — live within the 300s switchboard cache.")


if __name__ == "__main__":
    main()
