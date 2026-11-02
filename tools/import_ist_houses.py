#!/usr/bin/env python3
"""Fill ist_houses by matching roster house codes to client addresses on the street number."""
from __future__ import annotations

import json
import re
import subprocess
import sys
import urllib.parse
import urllib.request
from pathlib import Path

ENV_PATH = Path("/opt/docker/asa-hub/server/.tools.env")
ESSENCIAL_ID = "1Y6UMJlCS5gHur52f0YrPsLSqwYlCA792I8gAiZsxsug"
HUB_DB_ID = ""  # resolved in main() from the switchboard pointer
TAB = "Data"
HEADER = ["id", "createdAt", "updatedAt", "house", "houseName", "clientName", "active", "source"]

CLIENT_SQL = (
    "select client_name, address from mylife_os_client_entities.entity_clients "
    "where coalesce(status,'') ilike 'active'"
)
HOUSE_SQL = "select distinct location from app.asa_house_calendar_live"


def env(key: str) -> str:
    for line in ENV_PATH.read_text().splitlines():
        line = line.strip()
        if line.startswith(f"{key}="):
            return line.split("=", 1)[1].strip().strip("'\"")
    sys.exit(f"{key} not found in {ENV_PATH}")


def psql(sql: str) -> list[list[str]]:
    out = subprocess.run(
        ["docker", "exec", "asa-hub-db", "psql", "-U", "asa_hub", "-d", "asa_hub", "-tAF", "\x1f", "-c", sql],
        capture_output=True, text=True, timeout=60,
    )
    if out.returncode != 0:
        sys.exit(f"postgres refused: {out.stderr.strip()[:300]}")
    return [ln.split("\x1f") for ln in out.stdout.splitlines() if ln.strip()]


def street_number(text: str) -> str:
    """First 3–5 digit run: an address's street number, or a house code's (ABD1547 → 1547)."""
    m = re.search(r"(\d{3,5})", str(text or ""))
    return m.group(1) if m else ""


def token():
    body = urllib.parse.urlencode({
        "client_id": env("GS_GOOGLE_CLIENT_ID"),
        "client_secret": env("GS_GOOGLE_CLIENT_SECRET"),
        "refresh_token": env("GS_GOOGLE_REFRESH_TOKEN"),
        "grant_type": "refresh_token",
    }).encode()
    req = urllib.request.Request("https://oauth2.googleapis.com/token", data=body, method="POST")
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)["access_token"]


def sheets(tok: str, path: str, method: str = "GET", payload: dict | None = None) -> dict:
    url = f"https://sheets.googleapis.com/v4/spreadsheets/{HUB_DB_ID}{path}"
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", f"Bearer {tok}")
    req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, timeout=90) as r:
        raw = r.read()
        return json.loads(raw) if raw else {}


def resolve_house(tok: str) -> str:
    url = (f"https://sheets.googleapis.com/v4/spreadsheets/{ESSENCIAL_ID}/values/"
           + urllib.parse.quote("'Facts'!A2:I999999"))
    req = urllib.request.Request(url)
    req.add_header("Authorization", f"Bearer {tok}")
    with urllib.request.urlopen(req, timeout=120) as r:
        rows = json.loads(r.read()).get("values", []) or []
    sid = ""
    for row in rows:
        if len(row) > 4 and row[4] == "switchboard:props.HUB_HOUSE_IST_HOUSES_ID":
            sid = str(row[2]) if len(row) > 2 else ""
    if not sid.strip():
        sys.exit("the depot carries no HUB_HOUSE_IST_HOUSES_ID pointer — declare it first.")
    return sid.strip()


def main() -> None:
    global HUB_DB_ID
    dry = "--dry-run" in sys.argv
    HUB_DB_ID = resolve_house(token())

    houses: dict[str, tuple[str, str]] = {}          # number -> (code, short name)
    for (location,) in [tuple(r) for r in psql(HOUSE_SQL)]:
        parts = [p.strip() for p in str(location).split(" - ")]
        code = parts[-1] if parts else ""
        name = parts[-2] if len(parts) > 1 else code
        n = street_number(code)
        if n:
            houses[n] = (code, name)

    pairs, orphans = [], []
    for row in psql(CLIENT_SQL):
        name, address = (row + ["", ""])[:2]
        n = street_number(address)
        if n and n in houses:
            code, short = houses[n]
            pairs.append({"house": code, "houseName": short, "clientName": name.strip()})
        else:
            orphans.append(f"{name.strip()} — {address.strip() or '(no address)'}")

    print(f"houses on the roster : {len(houses)}")
    print(f"clients placed       : {len(pairs)}")
    for p in pairs:
        print(f"   {p['house']:<10} {p['houseName']:<12} {p['clientName']}")
    if orphans:
        # Named, never counted away: an unplaced client silently drops out of IST.
        print(f"\nclients WITHOUT a house ({len(orphans)}) — add them by hand if they have one:")
        for o in orphans:
            print(f"   {o}")

    if dry:
        print("\n--dry-run: nothing written.")
        return
    if not pairs:
        sys.exit("\nNothing matched — refusing to write an empty map.")

    tok = token()

    meta = sheets(tok, "?fields=sheets.properties.title")
    titles = [s["properties"]["title"] for s in meta.get("sheets", [])]
    if TAB not in titles:
        sheets(tok, ":batchUpdate", "POST",
               {"requests": [{"addSheet": {"properties": {"title": TAB}}}]})
        sheets(tok, f"/values/{urllib.parse.quote(TAB + '!A1')}?valueInputOption=RAW", "PUT",
               {"values": [HEADER]})
        existing = set()
    else:
        got = sheets(tok, f"/values/{urllib.parse.quote(TAB + '!A1:Z2000')}")
        rows = got.get("values", [])
        # listRows_ maps by header name: a column the header does not name is invisible.
        if not rows or rows[0][: len(HEADER)] != HEADER:
            sheets(tok, f"/values/{urllib.parse.quote(TAB + '!A1:H1')}?valueInputOption=RAW", "PUT",
                   {"values": [HEADER]})
            rows = sheets(tok, f"/values/{urllib.parse.quote(TAB + '!A1:Z2000')}").get("values", [])
        if not rows:
            existing = set()
        else:
            head = rows[0]
            ih = head.index("house") if "house" in head else -1
            ic = head.index("clientName") if "clientName" in head else -1
            existing = {
                (r[ih].strip().lower(), r[ic].strip().lower())
                for r in rows[1:]
                if ih >= 0 and ic >= 0 and len(r) > max(ih, ic)
            }

    # Append only: a hand-edited row is a correction a re-run must not undo.
    now = __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat()
    fresh = [p for p in pairs if (p["house"].lower(), p["clientName"].lower()) not in existing]
    if not fresh:
        print("\nEvery pair is already in the tab — nothing to add.")
        return

    values = [[
        f"IH_{p['house']}_{re.sub(r'[^a-z0-9]+', '_', p['clientName'].lower())}",
        now, now, p["house"], p["houseName"], p["clientName"], "yes", "roster+client entities",
    ] for p in fresh]

    sheets(tok, f"/values/{urllib.parse.quote(TAB + '!A:H')}:append"
                "?valueInputOption=RAW&insertDataOption=INSERT_ROWS", "POST",
           {"values": values})
    print(f"\nwrote {len(fresh)} pair(s) into {TAB}; {len(pairs) - len(fresh)} already there.")


if __name__ == "__main__":
    main()
