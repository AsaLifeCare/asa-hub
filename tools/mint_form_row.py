#!/usr/bin/env python3
"""Mint a form the platform owns — definition, slug, token, live link.

WHY A TOOL AND NOT A CLICK. A form here is a ROW: its questions are a cell,
its link is a slug plus a 24-character token, and the mask (public/form.html
and the EmbeddedForm component) draws whatever that row says. Import copies
a Google canvas into such a row, but a form does not NEED a canvas — the
Document Drop that was tested first never had one, and neither
does this: the FILE question is a kind Google cannot even author.

So this mints the row directly into `ASA Data — Forms`, in the standard
model, with the same shapes createRow_ uses (uuid id, ISO stamps, the token
alphabet of formMintToken_). Re-runnable: a live row already carrying the
slug is reported and nothing is written — one source, one row.

What comes back is the public link and the two halves the
component takes:

    <EmbeddedForm slug="…" token="…" />

    python3 tools/mint_form_row.py --dry-run
    python3 tools/mint_form_row.py
"""
from __future__ import annotations

import json
import secrets
import sys
import time
import urllib.parse
import urllib.request
import uuid
from pathlib import Path

ENV_PATH = Path("/opt/docker/asa-hub/server/.tools.env")
FORMS_HOUSE = "1yMFlXYlcS-bBImucBfULgMv3XSFzqeNPvkefG-j7IdQ"   # ASA Data — Forms
TAB = "Data"
S = "https://sheets.googleapis.com/v4/spreadsheets/"
PUBLIC_BASE = "https://asamylife.asalifecare.com"

# formMintToken_'s alphabet, character for character: no look-alikes.
TOKEN_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"

# ---------------------------------------------------------------- the form
#
# The anatomy of the 09-08 Document Drop — a heading, who is sending, THE
# FILE, a free line — with the facts that give the decoder something to
# check itself against: which document this is, and the dates the person
# believes. digest_json then carries dates_typed beside the dates found in
# the file, and says whether they agree.
SLUG = "asa-staff-documents"
TITLE = "ASA Staff Documents"
INTRO = ("Send a document the office needs on file — a CPR or First Aid card, "
         "a licence, an insurance card, a TB test, a certificate. It reaches "
         "the team the moment you press Send.")
THANK_YOU = "Received — the document is with the team and being read."
STATUS = "testing"      # the blue badge; the flask is pressed when it is real
FIELDS = [
    {"key": "heading_intro", "kind": "heading",
     "label": "Send us a document",
     "help": "Attach the file below — nothing else is needed."},
    {"key": "full_name", "kind": "text", "label": "Full name", "required": "true"},
    {"key": "role", "kind": "choice", "label": "Role", "required": "true",
     "options": ["Direct Support Professional", "House Manager",
                 "Nurse (RN / LPN)", "Administration / Office", "Other"]},
    {"key": "document_type", "kind": "choice", "label": "Document type",
     "required": "true",
     "options": ["CPR / First Aid card", "Driver's licence",
                 "Auto insurance card", "TB test result",
                 "Background check (BCI / FBI)", "Diploma or certificate",
                 "Other"]},
    {"key": "issued_on", "kind": "date", "label": "Issued on"},
    {"key": "expires_on", "kind": "date", "label": "Expires on",
     "help": "Leave empty if this document does not expire."},
    {"key": "document", "kind": "file", "label": "The document",
     "required": "true",
     "help": "PDF, photo or Office file — up to 20MB each, up to 5 files",
     "max_files": 5,
     "accept": ["pdf", "png", "jpg", "jpeg", "webp", "docx", "xlsx"]},
    {"key": "notes", "kind": "long", "label": "Anything we should know?"},
]


def env(k: str) -> str:
    for line in ENV_PATH.read_text().splitlines():
        line = line.strip()
        if line.startswith(f"{k}="):
            return line.split("=", 1)[1].strip().strip("'\"")
    sys.exit(f"{k} not found in {ENV_PATH}")


def token_bearer() -> str:
    body = urllib.parse.urlencode({
        "client_id": env("GS_GOOGLE_CLIENT_ID"),
        "client_secret": env("GS_GOOGLE_CLIENT_SECRET"),
        "refresh_token": env("GS_GOOGLE_REFRESH_TOKEN"),
        "grant_type": "refresh_token"}).encode()
    req = urllib.request.Request("https://oauth2.googleapis.com/token",
                                 data=body, method="POST")
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)["access_token"]


TOK = token_bearer()


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


def mint_token() -> str:
    return "".join(secrets.choice(TOKEN_ALPHABET) for _ in range(24))


def main() -> None:
    dry = "--dry-run" in sys.argv
    grid = api(S + FORMS_HOUSE + "/values/" +
               urllib.parse.quote(f"'{TAB}'!A1:Z999")).get("values") or []
    if not grid:
        sys.exit("the Forms house answered with nothing — refusing to write blind.")
    header = [str(h) for h in grid[0]]
    at = {h: i for i, h in enumerate(header)}
    for need in ("id", "slug", "token", "fields", "status"):
        if need not in at:
            sys.exit(f"the house header has no '{need}' column — model changed, stop.")

    def cell(row: list, name: str) -> str:
        i = at.get(name, -1)
        return str(row[i]) if 0 <= i < len(row) else ""

    for row in grid[1:]:
        if cell(row, "slug").strip().lower() == SLUG and \
           cell(row, "archived").strip().lower() != "true":
            print(f"ALREADY THERE: {SLUG} — nothing written.")
            print(f"  {PUBLIC_BASE}/form.html?f={SLUG}&t={cell(row, 'token')}")
            print(f'  <EmbeddedForm slug="{SLUG}" token="{cell(row, "token")}" />')
            return

    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    values = {
        "id": str(uuid.uuid4()),
        "createdAt": now, "updatedAt": now,
        "slug": SLUG, "token": mint_token(),
        "title": TITLE, "intro": INTRO,
        "fields": json.dumps(FIELDS, ensure_ascii=False, separators=(",", ":")),
        "status": STATUS, "notify_to": "",
        "thank_you": THANK_YOU, "closed_message": "",
        # opt-in, never a default: this form asks its own "Full name"
        "asks_contact": "no",
        "created_by": "asatech@asalifecare.com",
        "source_url": "", "archived": "",
        "archived_at": "", "archived_by": "", "archived_reason": "",
    }
    line = [values.get(h, "") for h in header]
    print(("would append" if dry else "appending") +
          f": {TITLE} ({SLUG}) — {len(FIELDS)} questions, status {STATUS}")
    if dry:
        return
    api(S + FORMS_HOUSE + "/values/" + urllib.parse.quote(f"'{TAB}'!A1") +
        ":append?valueInputOption=RAW&insertDataOption=INSERT_ROWS",
        {"values": [line]}, "POST")

    back = api(S + FORMS_HOUSE + "/values/" +
               urllib.parse.quote(f"'{TAB}'!A1:Z999")).get("values") or []
    landed = [r for r in back[1:] if cell(r, "slug").strip().lower() == SLUG]
    if len(landed) != 1:
        sys.exit(f"VERIFY FAILED: {len(landed)} rows now carry the slug — look before writing again.")
    tok = cell(landed[0], "token")
    print("\nlive now (the house is read on every request):")
    print(f"  link   {PUBLIC_BASE}/form.html?f={SLUG}&t={tok}")
    print(f'  embed  <EmbeddedForm slug="{SLUG}" token="{tok}" />')
    print(f"  files  Asa Hub - Form/{SLUG}/  (born on the first upload)")


if __name__ == "__main__":
    main()
