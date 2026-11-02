#!/usr/bin/env python3
"""Add HM and the `shiftboard` row's badges to the `calendarbuilder` App Control row (additive), as asatech.
The same write as Settings → App Control; run with the SPA deploy that moves the Shift Board screens.

    python3 tools/grant_calendarbuilder_hm.py            # the plan: reads, writes nothing
    python3 tools/grant_calendarbuilder_hm.py --apply    # writes the row, then reads it back
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
APP = "calendarbuilder"
BADGE = "HM"
BY = "asa-hub:tools/grant_calendarbuilder_hm"
# The app whose screens moved into Calendar Builder: its readers are carried over.
REQUESTS_APP = "shiftboard"


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
    found = requests_row = None
    for n, row in enumerate(values[1:], start=2):
        app = str(row[i_app] if i_app < len(row) else "").strip()
        if app == APP:
            found = (n, row)
        elif app == REQUESTS_APP:
            requests_row = row
    board = _words(requests_row[i_badges] if requests_row and i_badges < len(requests_row) else "")
    requests_has = BADGE in board
    if found is None:
        return {"ok": False, "why": (f"the tab has no {APP} row — with no row the app is the master's "
                                     f"alone, and a row naming only {BADGE} would take it from the "
                                     f"directors; write it in App Control instead"),
                "requests_has_hm": requests_has}
    n, row = found
    before = _words(row[i_badges] if i_badges < len(row) else "")
    after = before if BADGE in before else before + [BADGE]
    carried = [b for b in board if b not in after]
    after = after + carried
    return {"ok": True, "why": "", "row": n, "before": before, "after": after,
            "change": after != before, "requests_has_hm": requests_has,
            "from_shiftboard": carried,
            "columns": {"badges": i_badges, "updated_at": head.index("updated_at") if "updated_at" in head
                        else None, "updated_by": head.index("updated_by") if "updated_by" in head else None}}


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
    if not got["requests_has_hm"]:
        print(f"note: the {REQUESTS_APP} row does not name {BADGE} — {BADGE} is added to the {APP} "
              f"row all the same, because the Builder is a house manager's")
    if not got["change"]:
        print(f"nothing to do — the {APP} row already names {BADGE} and every {REQUESTS_APP} badge")
        return 0
    if not apply:
        print(f"the plan only — run again with --apply to write row {got['row']} of {TAB}")
        return 0
    cols = got["columns"]
    data = [{"range": f"'{TAB}'!{_col(cols['badges'])}{got['row']}", "values": [[", ".join(got["after"])]]}]
    if cols.get("updated_at") is not None:
        data.append({"range": f"'{TAB}'!{_col(cols['updated_at'])}{got['row']}",
                     "values": [[datetime.now(timezone.utc).isoformat()]]})
    if cols.get("updated_by") is not None:
        data.append({"range": f"'{TAB}'!{_col(cols['updated_by'])}{got['row']}", "values": [[BY]]})
    _api(token, SHEETS + CORE_BOOK + "/values:batchUpdate",
         {"valueInputOption": "RAW", "data": data}, method="POST")
    back = plan(_read(token))
    landed = back.get("ok") and all(b in (back.get("before") or []) for b in got["after"])
    print(f"written — row {got['row']} now reads {', '.join(back.get('before') or [])}" if landed
          else f"the write was sent but the row does not read {', '.join(got['after'])} back — look at the tab")
    return 0 if landed else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
