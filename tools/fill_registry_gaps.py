#!/usr/bin/env python3
"""Append a Registry row for every switched-on tab missing from it; never edits an existing row."""
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
            sys.exit(f"{e.code} {e.reason} — {e.read()[:200]!r}")
    return {}


def main() -> None:
    dry = "--dry-run" in sys.argv
    facts = api(S + ESSENCIAL_ID + "/values/" +
                urllib.parse.quote("'Facts'!A2:I999999")).get("values") or []
    props: dict[str, str] = {}
    moved: set[str] = set()
    for row in facts:
        src = str(row[4]) if len(row) > 4 else ""
        val = str(row[2]) if len(row) > 2 else ""
        if src.startswith("switchboard:props."):
            props[src.split(".", 1)[1]] = val
        elif src.startswith("switchboard:moved."):
            tab = src.split(".", 1)[1]
            moved.add(tab) if val == "on" else moved.discard(tab)

    reg = api(S + ESSENCIAL_ID + "/values/" +
              urllib.parse.quote("'Registry'!A1:E5000")).get("values") or []
    have = {str(r[0]).strip() for r in reg[1:] if r}

    rows = []
    for tab in sorted(moved):
        if f"data.{tab}" in have:
            continue
        sid = props.get("HUB_HOUSE_" + tab.upper().replace("-", "_") + "_ID", "")
        if not sid:
            print(f"   skipped {tab}: switched on but no house pointer")
            continue
        rows.append([f"data.{tab}", sid, "on", f"data: {tab}", ""])

    print(f"{len(moved)} switched on · {len(have)} in the census · "
          f"{len(rows)} missing")
    for r in rows:
        print(f"   {'would add' if dry else 'adding'} {r[0]}")
    if dry or not rows:
        if not rows:
            print("the census already names every switched-on tab.")
        return
    api(S + ESSENCIAL_ID + "/values/" + urllib.parse.quote("'Registry'!A1") +
        ":append?valueInputOption=RAW&insertDataOption=INSERT_ROWS",
        {"values": rows}, "POST")
    back = api(S + ESSENCIAL_ID + "/values/" +
               urllib.parse.quote("'Registry'!A1:E5000")).get("values") or []
    now = {str(r[0]).strip() for r in back[1:] if r}
    missing = [r[0] for r in rows if r[0] not in now]
    if missing:
        sys.exit(f"VERIFY FAILED — not in the census: {', '.join(missing)}")
    print(f"\n{len(rows)} row(s) added; the census reads them back.")


if __name__ == "__main__":
    main()
