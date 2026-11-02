#!/usr/bin/env python3
"""Open the Houses app to client and guardian accounts in the App Control matrix.

Adds CLIENT and GUARDIAN to the `houses` row of `app_badge_access` in
'ASA Hub — Core', keeping every badge the row already carries. The App
Control screen makes the same change; this is that write from the shell,
as asatech (GS_GOOGLE_* in the old platform/.env), read back after it lands.

    python3 tools/grant_houses_client_access.py            # dry run: prints the change
    python3 tools/grant_houses_client_access.py --apply    # writes it

What a client then sees is decided on the relay (/hub-lanes/houses/mine):
their own house only, and never the houses file itself.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ENV_PATH = Path("/opt/docker/asa-hub/server/.tools.env")
S = "https://sheets.googleapis.com/v4/spreadsheets/"
BOOK = os.getenv("HUB_DB_SHEET_ID", "1ia6i0SFiVNhn4wi6bt6EDcGwReS0P7-L4Up2hRfIVPg")
TAB = "app_badge_access"
APP = "houses"
ADD = ("CLIENT", "GUARDIAN")
BY = "asatech@asalifecare.com"


def parse(argv: list[str]) -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--apply", action="store_true", help="write the change (default: dry run)")
    return p.parse_args(argv)


def _badges(cell: str) -> list[str]:
    return [b.strip().upper() for b in str(cell or "").replace(";", ",").split(",") if b.strip()]


def plan(grid: list[list[str]], now: str) -> dict:
    """What the write would be: {row (1-based, None = append), badges, change, line}."""
    if not grid:
        raise SystemExit(f"{TAB}: no header row — refusing to write into a tab with no names")
    head = [str(h).strip() for h in grid[0]]
    for col in ("app_id", "badges"):
        if col not in head:
            raise SystemExit(f"{TAB}: the live header has no '{col}' column — it carries {head}")
    i_app, i_b = head.index("app_id"), head.index("badges")
    at, was, old = None, [], []
    for n, r in enumerate(grid[1:], start=2):
        if i_app < len(r) and str(r[i_app]).strip() == APP:
            at, was, old = n, _badges(r[i_b] if i_b < len(r) else ""), list(r)
    badges = was + [b for b in ADD if b not in was]
    fields = {"app_id": APP, "badges": ", ".join(badges), "updated_at": now, "updated_by": BY}
    line = [fields[h] if h in fields else (old[i] if i < len(old) else "") for i, h in enumerate(head)]
    return {"row": at, "was": ", ".join(was), "badges": fields["badges"],
            "change": at is None or badges != was, "line": line}


def _env(k: str) -> str:
    for line in ENV_PATH.read_text().splitlines():
        if line.strip().startswith(f"{k}="):
            return line.split("=", 1)[1].strip().strip("'\"")
    raise SystemExit(f"{k} not found in {ENV_PATH}")


def _token() -> str:
    body = urllib.parse.urlencode({
        "client_id": _env("GS_GOOGLE_CLIENT_ID"), "client_secret": _env("GS_GOOGLE_CLIENT_SECRET"),
        "refresh_token": _env("GS_GOOGLE_REFRESH_TOKEN"), "grant_type": "refresh_token"}).encode()
    with urllib.request.urlopen(urllib.request.Request(
            "https://oauth2.googleapis.com/token", data=body, method="POST"), timeout=30) as r:
        return json.load(r)["access_token"]


def _api(tok: str, url: str, payload: dict | None = None, method: str = "GET") -> dict:
    req = urllib.request.Request(url, method=method)
    req.add_header("Authorization", "Bearer " + tok)
    if payload is not None:
        req.add_header("Content-Type", "application/json")
        req.data = json.dumps(payload).encode()
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        raise SystemExit(f"{method} -> {e.code}: {e.read().decode()[:300]}")


def main(argv: list[str]) -> None:
    args = parse(argv)
    tok = _token()
    rng = urllib.parse.quote(f"'{TAB}'!A1:Z1000")
    grid = _api(tok, S + BOOK + "/values/" + rng).get("values") or []
    p = plan(grid, datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z"))
    where = f"row {p['row']}" if p["row"] else "a new row"
    print(f"{TAB}.{APP} ({where}): '{p['was']}'  ->  '{p['badges']}'")
    if not p["change"]:
        print("already granted — nothing to write")
        return
    if not args.apply:
        print("dry run — nothing written (pass --apply to write)")
        return
    if p["row"]:
        cell = urllib.parse.quote(f"'{TAB}'!A{p['row']}")
        _api(tok, S + BOOK + "/values/" + cell + "?valueInputOption=RAW", {"values": [p["line"]]}, "PUT")
    else:
        cell = urllib.parse.quote(f"'{TAB}'!A1")
        _api(tok, S + BOOK + "/values/" + cell + ":append?valueInputOption=RAW", {"values": [p["line"]]}, "POST")
    back = plan(_api(tok, S + BOOK + "/values/" + rng).get("values") or [], "")
    if back["change"]:
        raise SystemExit(f"the book reads back '{back['was']}' — stop.")
    print(f"read back: {back['was']}")


if __name__ == "__main__":
    main(sys.argv[1:])
