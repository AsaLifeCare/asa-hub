#!/usr/bin/env python3
"""
Roster review — every new person gets looked at, in a sheet of our own.

WHY THIS EXISTS
---------------
The `people` tab is a MIRROR of `ops.employees`: roster_sync rewrites it, so
anything written there is erased on the next run, and writing there at all
would push our judgement back into a source we do not own. The rule
is one-way: the roster falls into the Hub, never the other way.

So the analysis lives in `people_review` — a sheet nobody else writes — and
this script keeps it current. Each run looks only at people it has not judged
yet (or whose row changed since it did), so the list stays a to-do rather than
a 425-line wall that gets ignored.

WHAT IT LOOKS FOR
-----------------
Rules first, because they are certain and free:
  · role is form text     — a PDF parse dropped an entire job application into
                            the `role` column (32 of them today)
  · duplicate person      — the same human under two or three records
  · director in the roster— Ty Bond and Lisa B Bright are not staff rows
  · unusable name         — a record whose name is not a name

The model only sees what the rules could not settle, with the row as its only
context, and must answer in JSON. When there is no key, or the call fails, the
finding is still written — flagged `needs a human` rather than dropped. A
review queue that silently loses items is worse than no queue.

NOTHING IS DECIDED HERE. Every row lands with an empty `decision` column; a
human says merge, delete or leave, and that is the record of the call.

USAGE
-----
    python3 tools/roster_review.py --dry-run
    python3 tools/roster_review.py
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.request
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

from google.oauth2 import service_account
from googleapiclient.discovery import build

HUB_DB_ID = "1SGC3fDFJsraqLXzHgUGRARe5n_IkguyBsTD4bze36ts"
SERVICE_ACCOUNT = "/opt/docker/asa-hub/server/.service-account.json"
ENV_PATH = Path("/opt/docker/asa-hub/server/.tools.env")
PEOPLE_TAB = "people"
REVIEW_TAB = "people_review"

REVIEW_HEADER = [
    "finding", "verdict_needed", "person", "person_id", "status",
    "source_coverage", "email", "evidence", "suggested_action",
    "decision", "decided_by", "decided_at", "seen_at", "row_fingerprint",
]

JUNK_ROLE = re.compile(r"job application|po box|ssn#|last first mi", re.I)
DIRECTORS = {"ty bond", "lisa b bright"}

# An organisation announces itself: "Inc", "LLC", "Agency". These are decisive.
STRONG_ORG = re.compile(r"\b(inc|llc|ltd|corp|corporation|company|agency|dept|department|university|college)\b", re.I)
# These are also surnames — House, Home, Church, Park. They only mean
# "organisation" when they are not sitting where a surname sits.
WEAK_ORG = re.compile(r"\b(house|home|center|centre|clinic|hospital|group|team|services?|solutions?|systems?|platform)\b", re.I)
PLACEHOLDER = re.compile(r"\b(test|demo|sample|unknown|n/?a|none|tbd|proof)\b", re.I)


def env(key: str) -> str:
    if not ENV_PATH.exists():
        return ""
    for line in ENV_PATH.read_text().splitlines():
        if line.strip().startswith(f"{key}="):
            return line.split("=", 1)[1].strip().strip("'\"")
    return ""


def sheets():
    creds = service_account.Credentials.from_service_account_file(
        SERVICE_ACCOUNT, scopes=["https://www.googleapis.com/auth/spreadsheets"]
    )
    return build("sheets", "v4", credentials=creds).spreadsheets()


def name_core(value: str) -> str:
    """"Ty Bond (L4P)" and "Ty Bond - CPR Test" are both Ty."""
    return re.sub(r"\s*[-–(].*$", "", str(value or "")).strip().lower()


def looks_like_name(value: str) -> bool:
    """
    Two to four capitalised words, no digits.

    The org test is split on purpose: "Inc" or "Agency" settles it, but
    "House", "Home" and "Park" are surnames — Damir House is a person, and a
    reviewer who sees him flagged learns to ignore the queue. A weak word only
    counts against a name when it leads it ("House of Hope") or when the value
    is long enough to be a title rather than a person.
    """
    raw = str(value or "").strip()
    if not raw or len(raw) > 60 or re.search(r"\d", raw):
        return False
    if STRONG_ORG.search(raw) or PLACEHOLDER.search(raw):
        return False
    words = re.sub(r"\s*[-–(].*$", "", raw).split()
    # Only the FIRST word must be capitalised: "Kamyiah martin" is a person
    # typed carelessly, not a non-person, and flagging it teaches people to
    # ignore the queue. Casing is a separate finding, not this one.
    if not (2 <= len(words) <= 4 and words[0][:1].isupper()):
        return False
    if WEAK_ORG.match(words[0]) or (len(words) > 2 and WEAK_ORG.search(raw)):
        return False
    return True


def fingerprint(row: dict) -> str:
    """What we judged. A changed name/role/status is worth a fresh look;
    a changed `updated_at` alone is not — the sync stamps every row."""
    return "|".join(str(row.get(k, "")).strip() for k in ("name", "role", "status", "email", "source_coverage"))


def ask_model(findings: list[dict]) -> dict[str, dict]:
    """
    Judge the ambiguous ones. Returns {person_id: {verdict, why}}; an empty
    dict on any failure — callers keep the rule-based text either way.
    """
    key = env("OPENAI_API_KEY") or os.environ.get("OPENAI_API_KEY", "")
    if not key or not findings:
        return {}
    prompt = (
        "You are auditing a care agency's staff roster. For each record decide whether it is a "
        "REAL person worth keeping, a TEST/JUNK record, or a DUPLICATE of another record.\n"
        "Return ONLY a JSON array: "
        '[{"person_id": "...", "verdict": "keep|junk|duplicate|unsure", "why": "one short sentence"}]\n\n'
        + json.dumps(findings, ensure_ascii=False)
    )
    body = json.dumps({
        "model": env("LEAD_SCORE_MODEL") or "gpt-5.1",
        "messages": [
            {"role": "system", "content": "You audit data. Answer only with JSON."},
            {"role": "user", "content": prompt},
        ],
        "max_completion_tokens": 1200,
    }).encode()
    req = urllib.request.Request("https://api.openai.com/v1/chat/completions", data=body, method="POST")
    req.add_header("Authorization", f"Bearer {key}")
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            content = json.load(r)["choices"][0]["message"]["content"]
        start, end = content.find("["), content.rfind("]") + 1
        parsed = json.loads(content[start:end]) if start >= 0 and end > start else []
        return {str(p.get("person_id")): p for p in parsed if isinstance(p, dict)}
    except Exception as exc:  # noqa: BLE001 — a failed audit must not lose the queue
        print(f"[roster-review] model call failed ({exc}); findings stay flagged for a human")
        return {}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--all", action="store_true", help="re-judge everyone, not just what changed")
    args = ap.parse_args()

    api = sheets()
    values = api.values().get(spreadsheetId=HUB_DB_ID, range=f"{PEOPLE_TAB}!A1:Z2000").execute().get("values", [])
    if not values:
        sys.exit("people tab is empty")
    hdr = values[0]
    people = [dict(zip(hdr, r)) for r in values[1:] if any(c.strip() for c in r)]

    # what has already been judged
    try:
        rv = api.values().get(spreadsheetId=HUB_DB_ID, range=f"{REVIEW_TAB}!A1:Z5000").execute().get("values", [])
    except Exception:
        rv = []
    seen: dict[str, str] = {}
    if rv and len(rv) > 1:
        rhdr = rv[0]
        i_id = rhdr.index("person_id") if "person_id" in rhdr else -1
        i_fp = rhdr.index("row_fingerprint") if "row_fingerprint" in rhdr else -1
        for r in rv[1:]:
            if i_id >= 0 and i_id < len(r):
                seen[r[i_id]] = r[i_fp] if 0 <= i_fp < len(r) else ""

    groups: dict[str, list[dict]] = defaultdict(list)
    for p in people:
        core = name_core(p.get("name", ""))
        if core:
            groups[core].append(p)

    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    new_rows: list[list[str]] = []
    ambiguous: list[dict] = []

    for p in people:
        pid = p.get("id", "")
        fp = fingerprint(p)
        if not args.all and seen.get(pid) == fp:
            continue  # judged already, and nothing about them changed

        name = p.get("name", "")
        role = p.get("role", "")
        core = name_core(name)
        found: list[tuple[str, str, str, str]] = []  # finding, verdict_needed, evidence, action

        if role and (JUNK_ROLE.search(role) or len(role) > 60):
            found.append(("role is form text", "garbage or real?", role[:300],
                          "clear `role` at the SOURCE (ops.employees) — a PDF parse put a whole application in it"))
        if core in DIRECTORS:
            found.append(("director sitting in the roster", "confirm", f"role={role or '(blank)'}",
                          "mark as director so Focus Mode and the Directors app treat them as one"))
        if not looks_like_name(name):
            found.append(("name is not a name", "garbage?", name,
                          "check the source record — this may be a placeholder or a parse artefact"))
        elif name != name.strip() or re.search(r"\s[a-z]", re.sub(r"\s*[-–(].*$", "", name)):
            found.append(("name casing looks wrong", "cosmetic",
                          name, "fix at the SOURCE if it is worth it — it is a real person either way"))
        peers = groups.get(core, [])
        if len(peers) > 1:
            primary = max(peers, key=lambda x: (len(x.get("source_coverage", "")), x.get("status") == "active"))
            if primary.get("id") != pid:
                found.append((
                    "duplicate person", "garbage or merge?",
                    f"same person as {primary.get('name')} ({primary.get('id')}, coverage={primary.get('source_coverage')})",
                    "merge into the primary, or delete if it is a test record",
                ))
                ambiguous.append({
                    "person_id": pid, "name": name, "status": p.get("status", ""),
                    "email": p.get("email", ""), "coverage": p.get("source_coverage", ""),
                    "primary": f"{primary.get('name')} ({primary.get('id')})",
                })

        for finding, verdict, evidence, action in found:
            new_rows.append([
                finding, verdict, name, pid, p.get("status", ""), p.get("source_coverage", ""),
                p.get("email", ""), evidence, action, "", "", "", now, fp,
            ])

    if not new_rows:
        print("[roster-review] nothing new to judge")
        return

    opinions = ask_model(ambiguous)
    for row in new_rows:
        o = opinions.get(row[3])
        if o:
            row[8] = f"{row[8]} · audit says {o.get('verdict')}: {o.get('why')}"
        elif row[0] == "duplicate person":
            row[1] = "needs a human"

    if args.dry_run:
        print(f"[roster-review] would append {len(new_rows)} finding(s):")
        for r in new_rows[:12]:
            print(f"   {r[0]:<28} {r[2]:<28} {r[7][:60]}")
        return

    ss = api.get(spreadsheetId=HUB_DB_ID).execute()
    if REVIEW_TAB not in [s["properties"]["title"] for s in ss["sheets"]]:
        api.batchUpdate(spreadsheetId=HUB_DB_ID,
                        body={"requests": [{"addSheet": {"properties": {"title": REVIEW_TAB}}}]}).execute()
    if not rv:
        api.values().update(spreadsheetId=HUB_DB_ID, range=f"{REVIEW_TAB}!A1",
                            valueInputOption="RAW", body={"values": [REVIEW_HEADER]}).execute()
    api.values().append(spreadsheetId=HUB_DB_ID, range=f"{REVIEW_TAB}!A1", valueInputOption="RAW",
                        insertDataOption="INSERT_ROWS", body={"values": new_rows}).execute()
    print(f"[roster-review] appended {len(new_rows)} finding(s) to `{REVIEW_TAB}`")


if __name__ == "__main__":
    main()
