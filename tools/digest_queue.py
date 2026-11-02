#!/usr/bin/env python3
"""The decoder's queue, in one command — what is waiting, what it decided.

Volume is the question this answers — ten submissions on one form, and many
forms like it. Nobody waits on a decode:
the mask answers the moment the bytes land, the row is filed `pending`, and
the sweep takes a bite every few minutes. So the only thing that matters at
volume is being able to SEE the queue — how deep it is, how old the oldest
is, and what the last verdicts actually said.

    python3 tools/digest_queue.py            # both ledgers, last 12 verdicts
    python3 tools/digest_queue.py --all      # every row of the form ledger
"""
from __future__ import annotations

import json
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ENV_PATH = Path("/opt/docker/asa-hub/server/.tools.env")
LEDGERS = [
    ("form_files", "19OvLdtyF0iENHcesFFm_6DyGjnqTfrjStAQJjiyh6Ww"),
    ("client_files", "1o7opeC1GR3J5Oj7iGEgYo0EKLPmkW_paGBtE8uMx3LY"),
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


def rows(sid: str) -> list[dict]:
    req = urllib.request.Request(
        f"https://sheets.googleapis.com/v4/spreadsheets/{sid}/values/A1:BZ100000")
    req.add_header("Authorization", "Bearer " + TOK)
    with urllib.request.urlopen(req, timeout=180) as r:
        grid = json.load(r).get("values", [])
    if not grid:
        return []
    head = grid[0]
    return [dict(zip(head, row + [""] * (len(head) - len(row)))) for row in grid[1:]]


def when(s: str):
    try:
        return datetime.fromisoformat(str(s).replace("Z", "+00:00"))
    except Exception:
        return None


def age(s: str) -> str:
    t = when(s)
    if not t:
        return "—"
    secs = (datetime.now(timezone.utc) - t).total_seconds()
    if secs < 90:
        return f"{secs:.0f}s"
    if secs < 5400:
        return f"{secs / 60:.0f}m"
    return f"{secs / 3600:.1f}h"


def main() -> None:
    want_all = "--all" in sys.argv
    for tab, sid in LEDGERS:
        data = rows(sid)
        states: dict[str, int] = {}
        for r in data:
            states[str(r.get("digest_state") or "pending")] = \
                states.get(str(r.get("digest_state") or "pending"), 0) + 1
        pending = [r for r in data if str(r.get("digest_state")) == "pending"]
        oldest = min((when(r.get("createdAt", "")) or datetime.now(timezone.utc)
                      for r in pending), default=None)
        print(f"\n{tab}: {len(data)} row(s) — " +
              " · ".join(f"{k} {v}" for k, v in sorted(states.items())))
        if pending:
            print(f"   waiting: {len(pending)}, oldest {age(oldest.isoformat())} old")

        done = [r for r in data if r.get("digested_at")]
        done.sort(key=lambda r: str(r.get("digested_at")), reverse=True)
        show = done if want_all else done[:12]
        if not show:
            continue
        print(f"   last {len(show)} verdict(s):")
        for r in show:
            meta = {}
            try:
                meta = json.loads(r.get("digest_json") or "{}")
            except Exception:
                pass
            name = str(r.get("file_name") or r.get("title") or "?")[:40]
            print(f"     {name:<42} {str(r.get('doc_kind') or '—'):<20}"
                  f" {str(r.get('digest_category') or '—'):<22}"
                  f" conf {str(r.get('confidence') or '—'):>4}"
                  f"  {str(r.get('subject_type') or '—')}"
                  f" {str(r.get('person') or '')[:24]}")
            if r.get("digest_error"):
                print(f"        error: {str(r.get('digest_error'))[:120]}")
            elif meta.get("kind_alt"):
                print(f"        runner-up {meta['kind_alt']}"
                      f"   expires {meta.get('expires_on') or '—'}"
                      f"   from {meta.get('person_source') or '—'}"
                      f"   v{meta.get('v') or '?'}")


if __name__ == "__main__":
    main()
