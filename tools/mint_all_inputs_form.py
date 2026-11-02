#!/usr/bin/env python3
"""Mint a form the platform owns — definition, slug, token, live link.

WHY A TOOL AND NOT A CLICK. A form here is a ROW: its questions are a cell,
its link is a slug plus a 24-character token, and the mask (public/form.html
and the EmbeddedForm component) draws whatever that row says. Import copies
a Google canvas into such a row, but a form does not NEED a canvas — the
Document Drop never had one, and neither does this: the FILE question is a
kind Google cannot even author.

So this mints the row directly into `ASA Data — Forms`, in the standard
model, with the same shapes createRow_ uses (uuid id, ISO stamps, the token
alphabet of formMintToken_). Re-runnable: a live row already carrying the
slug is reported and nothing is written — one source, one row.

What it prints back is the public link and the two halves the
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
# The anatomy of the Document Drop — a heading, who is sending, THE
# FILE, a free line — with the facts that give the decoder something to
# check itself against: which document this is, and the dates the person
# believes. digest_json then carries dates_typed beside the dates found in
# the file, and says whether they agree.
SLUG = "all-inputs"
TITLE = "Every Input — Decoder Bench"
INTRO = ("Send a document the office needs on file — a CPR or First Aid card, "
         "a licence, an insurance card, a TB test, a certificate. It reaches "
         "the team the moment you press Send.")
THANK_YOU = "Received — the document is with the team and being read."
STATUS = "testing"      # the blue badge; the flask turns it live when it is real
FIELDS = [
    {
        "key": "heading_intro",
        "kind": "heading",
        "label": "Every kind of question, in one form",
        "help": "This form exists to exercise the decoder: every input the platform supports, and the ones that feed a fact say so."
    },
    {
        "key": "document",
        "kind": "file",
        "label": "The document",
        "required": "true",
        "max_files": 5,
        "help": "PDF, photo, short video, Office, text, code or data file — up to 30MB each",
        "accept": [
            "pdf",
            "png",
            "jpg",
            "jpeg",
            "webp",
            "gif",
            "docx",
            "xlsx",
            "csv",
            "txt",
            "md",
            "json",
            "xml",
            "tsv",
            "html",
            "htm",
            "js",
            "mjs",
            "ts",
            "tsx",
            "jsx",
            "css",
            "py",
            "sql",
            "yml",
            "yaml",
            "zip",
            "mp4",
            "mov",
            "m4v",
            "webm",
            "3gp",
            "m4a",
            "mp3",
            "wav"
        ]
    },
    {
        "key": "full_name",
        "kind": "text",
        "label": "Whose document is this?",
        "fact": "person",
        "help": "Only if the file does not say — we read the name from it and tell you when the two disagree."
    },
    {
        "key": "document_type",
        "kind": "choice",
        "label": "What is it?",
        "fact": "doc_kind",
        "help": "Only if you want to tell us — the platform works it out from the file.",
        "options": [
            "CPR / First Aid card",
            "DODD certification",
            "Med Delegation",
            "Ohio ID or driver's licence",
            "Social Security card",
            "Birth certificate",
            "High school diploma",
            "Auto insurance",
            "Background check",
            "Other"
        ]
    },
    {
        "key": "expires_on",
        "kind": "date",
        "label": "Expiry date",
        "fact": "expires_on",
        "help": "Only if you know it — we read it from the document and flag a disagreement."
    },
    {
        "key": "issued_on",
        "kind": "date",
        "label": "Date on the document",
        "fact": "issued_on",
        "help": "The day it was issued, taken or completed."
    },
    {
        "key": "any_date",
        "kind": "date",
        "label": "Any other date that matters",
        "fact": "date",
        "help": "Checked against every date the paper carries, without claiming which one it is."
    },
    {
        "key": "which_house",
        "kind": "choice",
        "label": "Which house is this about?",
        "fact": "house",
        "options": [
            "(none)",
            "ASA — Maple",
            "ASA — Oak",
            "ASA — Willow",
            "ASA — Cedar"
        ]
    },
    {
        "key": "about_client",
        "kind": "text",
        "label": "Which client is this about?",
        "fact": "client",
        "help": "Leave blank when the document is about staff."
    },
    {
        "key": "issuer_name",
        "kind": "text",
        "label": "Who issued it?",
        "help": "The training centre, agency or school — as printed."
    },
    {
        "key": "certificate_number",
        "kind": "number",
        "label": "Certificate or licence number"
    },
    {
        "key": "class_time",
        "kind": "time",
        "label": "What time did the class start?"
    },
    {
        "key": "contact_phone",
        "kind": "phone",
        "label": "Best phone number"
    },
    {
        "key": "contact_email",
        "kind": "email",
        "label": "Best e-mail"
    },
    {
        "key": "is_renewal",
        "kind": "yes_no",
        "label": "Is this a renewal of something you already had?"
    },
    {
        "key": "training_topics",
        "kind": "multi",
        "label": "What did it cover?",
        "options": [
            "CPR",
            "First Aid",
            "AED",
            "Medication administration",
            "Behaviour support",
            "Bloodborne pathogens",
            "Mandt",
            "Other"
        ]
    },
    {
        "key": "readability",
        "kind": "scale",
        "label": "How clear is the copy you are sending?",
        "options": [
            "1",
            "2",
            "3",
            "4",
            "5"
        ]
    },
    {
        "key": "notes",
        "kind": "long",
        "label": "Anything else we should know?",
        "help": "Free text — read, kept, and cross-checked where it names something the paper says."
    }
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
