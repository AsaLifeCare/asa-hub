#!/usr/bin/env python3
"""Declare the form Drive folders by id in the depot; a folder found by name drifts on any rename or copy."""
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

FOLDERS = {
    "Asa Hub - Form": ("HUB_FORM_UPLOADS_FOLDER_ID",
                       "1VZ5QOSZ__gmxej2XnK2wsNh5XCP_DbLS"),
    "Asa Hub - Form / Database": ("HUB_FORM_ORIGINALS_FOLDER_ID",
                                  "1Qg2Yv2Lz-1bz_DFu3fbbWqboCmtYoyZ8"),
}


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
    req = urllib.request.Request("https://oauth2.googleapis.com/token",
                                 data=body, method="POST")
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)["access_token"]


TOK = token()


def api(url: str, payload: dict | None = None, method: str = "GET") -> dict:
    for attempt in range(5):
        req = urllib.request.Request(url, method=method)
        req.add_header("Authorization", "Bearer " + TOK)
        body = json.dumps(payload).encode() if payload is not None else None
        if body:
            req.add_header("Content-Type", "application/json")
            req.data = body
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
    for label, (prop, fid) in FOLDERS.items():
        src = f"switchboard:props.{prop}"
        if have.get(src) == fid:
            print(f"already declared: {prop} → {fid}   ({label})")
            continue
        print(f"{'would append' if dry else 'appending'}: {prop} → {fid}   ({label})")
        facts.append(["config.props." + prop.lower().replace("_", ""), prop, fid,
                      "", src, "", now, "declare-form-folders", ""])
    if dry or not facts:
        if not facts:
            print("nothing to do — the depot already answers for both folders.")
        return
    api(S + ESSENCIAL_ID + "/values/" + urllib.parse.quote("'Facts'!A1") +
        ":append?valueInputOption=RAW&insertDataOption=INSERT_ROWS",
        {"values": facts}, "POST")
    fresh = depot_state()
    for label, (prop, fid) in FOLDERS.items():
        got = fresh.get(f"switchboard:props.{prop}")
        assert got == fid, f"{prop} did not land (depot says {got!r})"
    print("\nboth folders declared — live within the 300s switchboard cache.")


if __name__ == "__main__":
    main()
