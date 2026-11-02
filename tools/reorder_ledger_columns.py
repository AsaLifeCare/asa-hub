#!/usr/bin/env python3
"""Put the answers at the front of a file ledger, and the blobs at the back.

WHY THIS IS SAFE, AND WHY IT WAS FORBIDDEN UNTIL NOW
----------------------------------------------------
Appending was the rule because a moved column is a silent wrong answer to any
reader that counts positions. Every reader of these two houses addresses cells
BY NAME — the engine builds a header map (headerOf_/ensureHeader_), the mirror
stores each row as JSON keyed by header, the slices read data->>'name', and
every tool here does the same. So the order is presentation, not contract.

It became worth changing because the presentation stopped serving anybody
— the ids belong at the top: the columns that answer a
question — what is this, whose is it, when does it expire, how sure are we —
were appended after two blobs of OCR and JSON, so reading a row meant
scrolling past twenty thousand characters.

HOW IT REFUSES TO LOSE ANYTHING
-------------------------------
  * the whole tab is read first and every row is keyed by its id;
  * the new grid is built BY NAME, so a column this file does not know about
    keeps its value and lands at the end rather than being dropped;
  * after the write the tab is read back and compared cell by cell against
    what was read - same rows, same values, or it says so and stops;
  * the depot's schema fact is rewritten in the same run, because a sheet and
    its declaration are one thing.

A row the engine writes DURING the rewrite would lose that one verdict and go
back to pending, which the sweep redoes on its own. That is the only exposure,
it is seconds wide, and it is self-healing.

    python3 tools/reorder_ledger_columns.py form_files --dry-run
    python3 tools/reorder_ledger_columns.py form_files
    python3 tools/reorder_ledger_columns.py client_files
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

HOUSES = {
    "form_files": ("ASA Data - FormFiles", "19OvLdtyF0iENHcesFFm_6DyGjnqTfrjStAQJjiyh6Ww"),
    "client_files": ("ASA Data - ClientFiles", "1o7opeC1GR3J5Oj7iGEgYo0EKLPmkW_paGBtE8uMx3LY"),
}

# The order a person reads in: who and what first, the machinery after, the
# two blobs last. Anything not named here keeps its place at the end.
FRONT = [
    "id", "createdAt", "updatedAt",
    "doc_kind", "person", "person_id", "subject_type", "subject", "mentions",
    "issued_on", "expires_on", "confidence",
    "digest_state", "digest_category", "person_seen", "person_agree",
    "file_name", "file_id", "file_url", "mime_type", "size_bytes",
    "client_key", "client_name", "title", "kind", "folder", "file_date",
    "drive_id", "url", "source_book", "modified_time",
    "form_slug", "submission_id", "field_key",
    "uploaded_by_name", "uploaded_by_email",
    "digest_kind", "digest_dates", "digest_names", "digest_text_chars",
    "text_file", "ai_summary", "ai_summary_at", "ai_source",
    "digest_error", "digested_at",
]
BACK = ["digest_text", "digest_json"]


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
            with urllib.request.urlopen(req, timeout=300) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 503) and attempt < 4:
                time.sleep(2 ** attempt)
                continue
            sys.exit(f"{e.code} {e.reason} - {e.read()[:300]!r}")
    return {}


def main() -> None:
    if len(sys.argv) < 2 or sys.argv[1] not in HOUSES:
        sys.exit(f"which ledger? {' | '.join(HOUSES)}")
    tab = sys.argv[1]
    dry = "--dry-run" in sys.argv
    title, sid = HOUSES[tab]

    grid = api(S + sid + "/values/" +
               urllib.parse.quote(f"'{tab}'!A1:BZ100000")).get("values") or []
    if not grid:
        sys.exit(f"{title}: the tab answered nothing - refusing to write blind.")
    header = [str(h) for h in grid[0]]
    rows = [dict(zip(header, r + [""] * (len(header) - len(r)))) for r in grid[1:]]
    print(f"{title}: {len(rows)} row(s), {len(header)} column(s)")

    fresh = ([c for c in FRONT if c in header] +
             [c for c in header if c not in FRONT and c not in BACK] +
             [c for c in BACK if c in header])
    if fresh == header:
        print("   already in this order - nothing to do.")
        return
    moved = [c for i, c in enumerate(fresh) if header.index(c) != i]
    print(f"   {len(moved)} column(s) change position; "
          f"first eight become: {', '.join(fresh[:8])}")
    if dry:
        print("\n--dry-run: nothing written.")
        return

    body = [fresh] + [[row.get(c, "") for c in fresh] for row in rows]
    api(S + sid + "/values/" + urllib.parse.quote(f"'{tab}'!A1:BZ100000") + ":clear",
        {}, "POST")
    for i in range(0, len(body), 2000):
        api(S + sid + "/values/" + urllib.parse.quote(f"'{tab}'!A{i + 1}") +
            "?valueInputOption=RAW", {"values": body[i:i + 2000]}, "PUT")

    back = api(S + sid + "/values/" +
               urllib.parse.quote(f"'{tab}'!A1:BZ100000")).get("values") or []
    if not back or [str(h) for h in back[0]] != fresh:
        sys.exit("VERIFY FAILED: the header does not read back as written.")
    got = [dict(zip(fresh, r + [""] * (len(fresh) - len(r)))) for r in back[1:]]
    if len(got) != len(rows):
        sys.exit(f"VERIFY FAILED: wrote {len(rows)} rows, read back {len(got)}.")
    was = {str(r.get("id")): r for r in rows}
    for row in got:
        before = was.get(str(row.get("id")))
        if before is None:
            sys.exit(f"VERIFY FAILED: row {row.get('id')} was not there before.")
        for col in header:
            if str(before.get(col, "")) != str(row.get(col, "")):
                sys.exit(f"VERIFY FAILED: {row.get('id')} column {col} changed.")
    print(f"   read back and compared cell by cell: {len(got)} rows identical")

    facts_rows = api(S + ESSENCIAL_ID + "/values/" +
                     urllib.parse.quote("'Facts'!A2:I999999")).get("values") or []
    have = {}
    for r in facts_rows:
        src = str(r[4]) if len(r) > 4 else ""
        if src:
            have[src] = str(r[2]) if len(r) > 2 else ""
    schema_val = json.dumps(fresh, separators=(",", ":"))
    if have.get(f"schema:{tab}.header") != schema_val:
        now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        api(S + ESSENCIAL_ID + "/values/" + urllib.parse.quote("'Facts'!A1") +
            ":append?valueInputOption=RAW&insertDataOption=INSERT_ROWS",
            {"values": [[f"schema.{tab}.header", "__schema", schema_val, "",
                         f"schema:{tab}.header", "", now, "reorder-ledger", ""]]},
            "POST")
        print("   the depot re-declared to match")


if __name__ == "__main__":
    main()
