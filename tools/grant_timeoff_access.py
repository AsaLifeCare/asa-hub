#!/usr/bin/env python3
"""Write the `timeoff` App Control row (additive: a live row only gains badges), as asatech.
With no row the app is the master's alone; client and guardian are never named.

    python3 tools/grant_timeoff_access.py            # the plan: reads, writes nothing
    python3 tools/grant_timeoff_access.py --apply    # writes the row, then reads it back
"""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ENV_PATH = Path("/opt/docker/asa-hub/server/.tools.env")
SHEETS = "https://sheets.googleapis.com/v4/spreadsheets/"
CORE_BOOK = os.getenv("HUB_DB_SHEET_ID", "1ia6i0SFiVNhn4wi6bt6EDcGwReS0P7-L4Up2hRfIVPg")
TAB = "app_badge_access"
APP = "timeoff"
# a badge that follows DIRECTOR reaches the row through the fold, so it is not written here
BADGES = ["STAFF", "HM", "MANAGER", "ENTITY", "DIRECTOR", "ADMINISTRATOR", "ADMIN"]
NEVER = frozenset({"CLIENT", "GUARDIAN"})
BY = "asa-hub:tools/grant_timeoff_access"


def _words(cell: str) -> list[str]:
    return [w.strip().upper() for w in str(cell or "").replace(";", ",").split(",") if w.strip()]


def plan(values: list[list[str]]) -> dict:
    """The grant's plan, pure; the LAST row for an app is the one the platform reads, so it is the one written."""
    if not values:
        return {"ok": False, "why": f"the {TAB} tab is empty or unreadable"}
    head = [str(h).strip().lower() for h in values[0]]
    if "app_id" not in head or "badges" not in head:
        return {"ok": False, "why": f"the {TAB} tab has no app_id or badges column"}
    i_app, i_badges = head.index("app_id"), head.index("badges")
    found = None
    for n, row in enumerate(values[1:], start=2):
        if str(row[i_app] if i_app < len(row) else "").strip() == APP:
            found = (n, row)
    cols = {"app_id": i_app, "badges": i_badges,
            "updated_at": head.index("updated_at") if "updated_at" in head else None,
            "updated_by": head.index("updated_by") if "updated_by" in head else None,
            "width": len(head)}
    if found is None:
        return {"ok": True, "why": "", "row": 0, "append": True, "before": [], "after": list(BADGES),
                "change": True, "columns": cols}
    n, row = found
    before = _words(row[i_badges] if i_badges < len(row) else "")
    after = [b for b in before if b not in NEVER] + [b for b in BADGES if b not in before]
    return {"ok": True, "why": "", "row": n, "append": False, "before": before, "after": after,
            "change": after != before, "columns": cols,
            "dropped": [b for b in before if b in NEVER]}


def _env(key: str) -> str:
    for line in ENV_PATH.read_text().splitlines():
        line = line.strip()
        if line.startswith(f"{key}="):
            return line.split("=", 1)[1].strip().strip("'\"")
    sys.exit(f"{key} not found in {ENV_PATH}")


def _bearer() -> str:
    body = urllib.parse.urlencode({
        "client_id": _env("GS_GOOGLE_CLIENT_ID"),
        "client_secret": _env("GS_GOOGLE_CLIENT_SECRET"),
        "refresh_token": _env("GS_GOOGLE_REFRESH_TOKEN"),
        "grant_type": "refresh_token"}).encode()
    req = urllib.request.Request("https://oauth2.googleapis.com/token", data=body, method="POST")
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)["access_token"]


def _api(token: str, url: str, payload: dict | None = None, method: str = "GET") -> dict:
    req = urllib.request.Request(url, method=method)
    req.add_header("Authorization", "Bearer " + token)
    if payload is not None:
        req.add_header("Content-Type", "application/json")
        req.data = json.dumps(payload).encode()
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        sys.exit(f"{method} {url.split('/v4/')[-1][:80]} -> {e.code}: {e.read().decode()[:300]}")


def _col(i: int) -> str:
    out, n = "", i + 1
    while n:
        n, r = divmod(n - 1, 26)
        out = chr(65 + r) + out
    return out


def _read(token: str) -> list[list[str]]:
    return _api(token, SHEETS + CORE_BOOK + "/values/" + urllib.parse.quote(f"'{TAB}'!A1:Z500")
                ).get("values") or []


def main(argv: list[str]) -> int:
    apply = "--apply" in argv
    token = _bearer()
    got = plan(_read(token))
    print(json.dumps({k: v for k, v in got.items() if k != "columns"}, indent=2))
    if not got.get("ok"):
        print(f"nothing written — {got.get('why')}")
        return 1
    if not got["change"]:
        print(f"nothing to do — the {APP} row already names every badge")
        return 0
    if not apply:
        print(f"the plan only — run again with --apply to {'append' if got['append'] else 'write row'} "
              f"{'' if got['append'] else got['row']} in {TAB}")
        return 0
    cols = got["columns"]
    now = datetime.now(timezone.utc).isoformat()
    if got["append"]:
        line = [""] * cols["width"]
        line[cols["app_id"]] = APP
        line[cols["badges"]] = ", ".join(got["after"])
        if cols.get("updated_at") is not None:
            line[cols["updated_at"]] = now
        if cols.get("updated_by") is not None:
            line[cols["updated_by"]] = BY
        _api(token, SHEETS + CORE_BOOK + "/values/" + urllib.parse.quote(f"'{TAB}'!A1") +
             ":append?valueInputOption=RAW&insertDataOption=INSERT_ROWS", {"values": [line]}, method="POST")
    else:
        data = [{"range": f"'{TAB}'!{_col(cols['badges'])}{got['row']}", "values": [[", ".join(got["after"])]]}]
        if cols.get("updated_at") is not None:
            data.append({"range": f"'{TAB}'!{_col(cols['updated_at'])}{got['row']}", "values": [[now]]})
        if cols.get("updated_by") is not None:
            data.append({"range": f"'{TAB}'!{_col(cols['updated_by'])}{got['row']}", "values": [[BY]]})
        _api(token, SHEETS + CORE_BOOK + "/values:batchUpdate",
             {"valueInputOption": "RAW", "data": data}, method="POST")
    back = plan(_read(token))
    landed = back.get("ok") and not back.get("append") and all(b in (back.get("before") or []) for b in got["after"])
    print(f"written — the {APP} row now reads {', '.join(back.get('before') or [])}" if landed
          else f"the write was sent but the row does not read {', '.join(got['after'])} back — look at the tab")
    return 0 if landed else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
