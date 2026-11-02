"""Which books people edit most in Google: every book asa-hub-db copies (catalog.books, ok or direct), its Drive
revisions over the last 30 and 7 days by anybody but the platform's own account (asatech), and who made them. Read
from Drive's revision list only — never a cell. A book whose revisions come on the clock from one account (a script,
not a person) shows as a steady count with one editor: read the times before calling it people.

From the repo root:

    RUNNER=<scratchpad> [TOP=40] python3 tools/rank-people-edits.py
"""
import json
import os
import subprocess
import sys

if not os.environ.get("RANK_EDITS_INPROC"):
    runner = os.environ["RUNNER"]
    here = os.path.join(runner, "rank_people_edits.py")
    with open(here, "w", encoding="utf-8") as fh, open(__file__, encoding="utf-8") as me:
        fh.write(me.read())
    out = subprocess.run(["sh", os.path.join(runner, "run.sh"), os.path.abspath("app"), here,
                          json.dumps({"RANK_EDITS_INPROC": "1", "TOP": os.environ.get("TOP", "40")})],
                         capture_output=True, text=True, timeout=600)
    sys.stdout.write(out.stdout[-20000:])
    sys.stderr.write(out.stderr[-2000:])
    sys.exit(out.returncode)

import time  # noqa: E402
import urllib.error  # noqa: E402
import urllib.parse  # noqa: E402
import urllib.request  # noqa: E402
from concurrent.futures import ThreadPoolExecutor  # noqa: E402
from datetime import datetime, timedelta, timezone  # noqa: E402

import hubdb  # noqa: E402

db = hubdb.HubDb()
books = db.query("select sheet_id, name, status, tab_count from catalog.books"
                 " where gone_at is null and status in ('ok', 'direct')")
moved = {r[0] for r in db.query("select distinct sheet_id from app.resource_columns where uploaded_at is not null")}
token = json.loads(urllib.request.urlopen(urllib.request.Request(
    "https://oauth2.googleapis.com/token", data=urllib.parse.urlencode({
        "client_id": CREDS["client_id"], "client_secret": CREDS["client_secret"],  # noqa: F821 - the runner's
        "refresh_token": CREDS["refresh_token"], "grant_type": "refresh_token"}).encode()),  # noqa: F821
    timeout=20).read())["access_token"]
now = datetime.now(timezone.utc)
d30, d7 = now - timedelta(days=30), now - timedelta(days=7)


def revisions(sid: str) -> list[dict] | str:
    out, page = [], None
    for _ in range(10):
        q = {"pageSize": 1000, "fields": "nextPageToken,revisions(modifiedTime,lastModifyingUser(displayName,me))"}
        if page:
            q["pageToken"] = page
        req = urllib.request.Request(f"https://www.googleapis.com/drive/v3/files/{sid}/revisions?"
                                     + urllib.parse.urlencode(q), headers={"Authorization": "Bearer " + token})
        for attempt in range(3):
            try:
                body = json.loads(urllib.request.urlopen(req, timeout=30).read())
                break
            except urllib.error.HTTPError as e:
                if e.code in (429, 500, 503) and attempt < 2:
                    time.sleep(2 + attempt * 3)
                    continue
                return f"HTTP {e.code}"
        out += body.get("revisions") or []
        page = body.get("nextPageToken")
        if not page:
            break
    return out


def one(b: tuple) -> dict:
    sid, name, status, tabs = b
    got = revisions(sid)
    if isinstance(got, str):
        return {"name": name, "sheet_id": sid, "error": got}
    p30 = p7 = 0
    who: set[str] = set()
    for r in got:
        u = r.get("lastModifyingUser") or {}
        if u.get("me"):
            continue
        at = datetime.fromisoformat(r["modifiedTime"].replace("Z", "+00:00"))
        if at >= d30:
            p30 += 1
            who.add(u.get("displayName") or "?")
            p7 += at >= d7
    return {"name": name, "sheet_id": sid, "status": status, "tabs": tabs, "moved": sid in moved,
            "people_30d": p30, "people_7d": p7, "editors": sorted(who)}


with ThreadPoolExecutor(max_workers=8) as pool:
    res = list(pool.map(one, books))
ranked = sorted((r for r in res if "error" not in r and r["people_30d"]), key=lambda r: -r["people_30d"])
print(json.dumps({"books": len(res), "unreadable": len([r for r in res if "error" in r]),
                  "edited_by_people_30d": len(ranked), "top": ranked[:int(os.environ.get("TOP") or 40)]},
                 indent=1, default=str))
