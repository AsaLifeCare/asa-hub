#!/usr/bin/env python3
"""Merge the legacy Employee Support Queue into staff_requests; a row already imported is never overwritten."""
from __future__ import annotations

import json
import re
import sys
import urllib.parse
import urllib.request
import uuid
from pathlib import Path

ENV_PATH = Path("/opt/docker/asa-hub/server/.tools.env")
HUB_DB_ID = "1SGC3fDFJsraqLXzHgUGRARe5n_IkguyBsTD4bze36ts"
QUEUE_ID = "1nALj7QPqBYuEw-2RKrY2oEFcE73RKfvVaa4YoESgJw0"
QUEUE_TAB = "Requests"
TARGET_TAB = "staff_requests"

# must match REQUESTS_HEADER in apps-script/Requests.gs, in order
HEADER = [
    "id", "createdAt", "updatedAt",
    "type", "urgency", "personId", "personName", "phone", "email",
    "details", "datesText",
    "dateFrom", "dateTo", "dateDays", "calendarName", "parseNote",
    "status", "verdict", "resolvedAt", "resolvedBy", "resolutionNote",
    "notifiedAt", "notifyCount",
]

STATUS_MAP = {"new": "open", "pending": "open", "resolved": "resolved"}
URGENCY_MAP = {"low": "low", "mid": "mid", "high": "high"}


def env(key: str) -> str:
    for line in ENV_PATH.read_text().splitlines():
        line = line.strip()
        if line.startswith(f"{key}="):
            return line.split("=", 1)[1].strip().strip("'\"")
    sys.exit(f"{key} not found in {ENV_PATH}")


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


def sheets(tok: str, sid: str, path: str, method: str = "GET", payload: dict | None = None) -> dict:
    url = f"https://sheets.googleapis.com/v4/spreadsheets/{sid}{path}"
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", f"Bearer {tok}")
    req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, timeout=120) as r:
        raw = r.read()
        return json.loads(raw) if raw else {}


def values(tok: str, sid: str, rng: str, *, missing_ok: bool = False) -> list[list[str]]:
    """Never pass missing_ok for the source: a queue that answers nothing is a failed read, not an empty one."""
    try:
        got = sheets(tok, sid, f"/values/{urllib.parse.quote(rng)}")
    except urllib.error.HTTPError as e:
        if missing_ok and e.code == 400:
            return []
        raise
    return got.get("values", [])


def ensure_tab(tok: str, sid: str, title: str) -> None:
    meta = sheets(tok, sid, "")
    if any(sh["properties"]["title"] == title for sh in meta.get("sheets", [])):
        return
    sheets(tok, sid, ":batchUpdate", "POST",
           {"requests": [{"addSheet": {"properties": {"title": title}}}]})
    print(f"created tab {title}")


def norm_date(raw: str) -> tuple[str, str]:
    """No timezone is ever applied: it would shift a request's day."""
    s = str(raw or "").strip()
    if not s:
        return "", ""
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})", s)
    if m:
        return f"{m.group(1)}-{m.group(2)}-{m.group(3)}", ""
    m = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{4})", s)
    if m:
        mm, dd, yy = int(m.group(1)), int(m.group(2)), int(m.group(3))
        iso = f"{yy:04d}-{mm:02d}-{dd:02d}"
        note = f"source date read as {iso} from '{s}'" if yy < 2015 else ""
        return iso, note
    return "", f"unreadable date: '{s}'"


def key_of(person: str, rtype: str, details: str, received: str) -> str:
    parts = [person.strip().lower(), rtype.strip().lower(), details.strip().lower()[:120], received.strip()]
    return "|".join(parts)


def main() -> None:
    dry = "--dry-run" in sys.argv
    tok = token()

    src = values(tok, QUEUE_ID, QUEUE_TAB)
    if not src:
        sys.exit("The legacy queue answered nothing — refusing to write. It is NOT empty by proof.")
    shdr = src[0]
    six = {h: i for i, h in enumerate(shdr)}

    def cell(row: list[str], name: str) -> str:
        i = six.get(name, -1)
        return str(row[i]).strip() if 0 <= i < len(row) else ""

    existing = values(tok, HUB_DB_ID, TARGET_TAB, missing_ok=True)
    seen: set[str] = set()
    have_rows = 0
    if existing:
        thdr = existing[0]
        tix = {h: i for i, h in enumerate(thdr)}

        def tcell(row: list[str], name: str) -> str:
            i = tix.get(name, -1)
            return str(row[i]).strip() if 0 <= i < len(row) else ""

        for row in existing[1:]:
            if not tcell(row, "id"):
                continue
            have_rows += 1
            seen.add(key_of(tcell(row, "personName"), tcell(row, "type"),
                            tcell(row, "details"), tcell(row, "createdAt")))

    fresh, skipped_dupes, unreadable_dates = [], 0, []
    for row in src[1:]:
        person = cell(row, "Requestor")
        rtype = cell(row, "Type of Request")
        details = cell(row, "Description of Request")
        received_raw = cell(row, "Date Received")
        if not person and not rtype and not details:
            continue
        created, note = norm_date(received_raw)
        if note:
            unreadable_dates.append(f"{person or '(no name)'} — {note}")
        k = key_of(person, rtype, details, created)
        if k in seen:
            skipped_dupes += 1
            continue
        seen.add(k)
        status = STATUS_MAP.get(cell(row, "Status").lower(), "open")
        rec = {
            "id": "REQ_" + uuid.uuid4().hex[:16].upper(),
            "createdAt": created, "updatedAt": "",
            "type": rtype, "urgency": URGENCY_MAP.get(cell(row, "Urgency").lower(), "low"),
            "personId": "", "personName": person,
            "phone": cell(row, "Requestor Phone"), "email": "",
            "details": details, "datesText": "",
            "dateFrom": "", "dateTo": "", "dateDays": "", "calendarName": "",
            "parseNote": " · ".join(x for x in [note, cell(row, "Notes")] if x),
            "status": status,
            "verdict": "resolved" if status == "resolved" else "",
            "resolvedAt": "", "resolvedBy": "legacy portal" if status == "resolved" else "",
            "resolutionNote": "", "notifiedAt": "", "notifyCount": "0",
        }
        fresh.append([rec.get(h, "") for h in HEADER])

    print(f"legacy queue rows   : {len(src) - 1}")
    print(f"already in the Hub  : {have_rows}")
    print(f"to import           : {len(fresh)}")
    print(f"skipped as duplicate: {skipped_dupes}")
    if unreadable_dates:
        print(f"\ndates carried as-written ({len(unreadable_dates)}):")
        for u in unreadable_dates[:15]:
            print(f"   {u}")
        if len(unreadable_dates) > 15:
            print(f"   … and {len(unreadable_dates) - 15} more")

    if dry:
        print("\n--dry-run: nothing written.")
        return
    if not fresh:
        print("\nNothing new to write.")
        return

    ensure_tab(tok, HUB_DB_ID, TARGET_TAB)
    if not existing:
        sheets(tok, HUB_DB_ID, f"/values/{urllib.parse.quote(TARGET_TAB + '!A1')}?valueInputOption=RAW",
               "PUT", {"values": [HEADER]})
        print("header written")

    sheets(tok, HUB_DB_ID,
           f"/values/{urllib.parse.quote(TARGET_TAB + '!A1')}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS",
           "POST", {"values": fresh})
    print(f"\nwrote {len(fresh)} row(s) into {TARGET_TAB}")


if __name__ == "__main__":
    main()
