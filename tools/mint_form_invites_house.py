#!/usr/bin/env python3
"""Mint the FormInvites house: one row per recipient a form was sent to; re-runnable."""
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

TAB = "form_invites"
TITLE = "ASA Data — FormInvites"
PROP = "HUB_HOUSE_FORM_INVITES_ID"
HEADER = [
    "id", "createdAt", "updatedAt",
    "form_slug", "invite_token",
    # the anchor is the id, never the name
    "subject_type", "subject_id", "subject_name",
    "situation", "reason",
    "channel", "sent_at", "sent_by", "message_ref",
    "expires_at", "uses_max", "uses_count",
    "opened_at", "submitted_at", "submission_id",
    "state", "notes",
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


def depot() -> dict[str, str]:
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
    have = depot()
    sid = have.get(f"switchboard:props.{PROP}", "")
    if sid:
        print(f"the house already exists: {sid}")
    elif dry:
        print(f"would create {TITLE} with {len(HEADER)} columns")
        return
    else:
        made = api(S, {"properties": {"title": TITLE},
                       "sheets": [{"properties": {"title": TAB,
                                                  "gridProperties": {"frozenRowCount": 1}}}]},
                   "POST")
        sid = made["spreadsheetId"]
        api(S + sid + "/values/" + urllib.parse.quote(f"'{TAB}'!A1") +
            "?valueInputOption=RAW", {"values": [HEADER]}, "PUT")
        print(f"created {TITLE}: {sid}")

    back = api(S + sid + "/values/" + urllib.parse.quote(f"'{TAB}'!1:1"))
    landed = [str(h) for h in (back.get("values") or [[]])[0]]
    if landed != HEADER:
        sys.exit(f"the header does not read back as written ({len(landed)} cols) — stop.")
    print(f"header verified: {len(landed)} columns")

    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    facts = []
    if have.get(f"switchboard:props.{PROP}") != sid:
        facts.append(["config.props." + PROP.lower().replace("_", ""), PROP, sid, "",
                      f"switchboard:props.{PROP}", "", now, "mint-form-invites", ""])
    if have.get(f"switchboard:moved.{TAB}") != "on":
        facts.append([f"config.moved.{TAB}", f"moved.{TAB}", "on", "",
                      f"switchboard:moved.{TAB}", "", now, "mint-form-invites", ""])
    schema_val = json.dumps(HEADER, separators=(",", ":"))
    if have.get(f"schema:{TAB}.header") != schema_val:
        facts.append([f"schema.{TAB}.header", "__schema", schema_val, "",
                      f"schema:{TAB}.header", "", now, "mint-form-invites", ""])
    if dry:
        print(f"would append {len(facts)} depot fact(s) and one census row")
        return
    if facts:
        api(S + ESSENCIAL_ID + "/values/" + urllib.parse.quote("'Facts'!A1") +
            ":append?valueInputOption=RAW&insertDataOption=INSERT_ROWS",
            {"values": facts}, "POST")

    reg = api(S + ESSENCIAL_ID + "/values/" +
              urllib.parse.quote("'Registry'!A1:E5000")).get("values") or []
    if f"data.{TAB}" not in {str(r[0]).strip() for r in reg[1:] if r}:
        api(S + ESSENCIAL_ID + "/values/" + urllib.parse.quote("'Registry'!A1") +
            ":append?valueInputOption=RAW&insertDataOption=INSERT_ROWS",
            {"values": [[f"data.{TAB}", sid, "on",
                         f"data: {TAB} (who a form was sent to, and why)", ""]]}, "POST")
        print("census row added")

    fresh = depot()
    assert fresh.get(f"switchboard:props.{PROP}") == sid, "pointer did not land"
    assert fresh.get(f"switchboard:moved.{TAB}") == "on", "switch did not land"
    assert fresh.get(f"schema:{TAB}.header") == schema_val, "schema did not land"
    print("\ndeclared: pointer · moved · schema · census — live within 300s.")
    print("The house is born in the asatech Drive root; move it into "
          "'ASA Hub - Source / Database' by hand (only an editor may move it).")


if __name__ == "__main__":
    main()
