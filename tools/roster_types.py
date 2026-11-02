#!/usr/bin/env python3
"""Classify people into people_types (never the people mirror) and propose duplicates for a human to sign."""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import unicodedata
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
TYPES_TAB = "people_types"

TYPES_HEADER = [
    "person", "person_id", "person_type", "job_title", "confidence", "basis",
    "raw_role", "duplicate_of", "duplicate_score", "email", "status",
    "decision", "decided_by", "decided_at", "seen_at", "row_fingerprint",
]

DIRECTORS = {"ty bond", "lisa b bright"}

JUNK_ROLE = re.compile(r"job application|po box|ssn#|last first mi|\[role\]", re.I)

STRONG_ORG = re.compile(
    r"\b(inc|llc|ltd|corp|corporation|company|agency|dept|department|university|college)\b", re.I)

TITLE_CANON = [
    (re.compile(r"\bdsp\b|direct support (professional|prof)", re.I), "Direct Support Professional"),
    (re.compile(r"\bcna\b|certified nursing assistant", re.I), "Certified Nursing Assistant"),
    (re.compile(r"\blpn\b|licensed practical nurse", re.I), "Licensed Practical Nurse"),
    (re.compile(r"\brn\b|registered nurse", re.I), "Registered Nurse"),
    (re.compile(r"house manager|home manager", re.I), "House Manager"),
    (re.compile(r"software engineer|developer|programmer", re.I), "Software Engineer"),
    (re.compile(r"recruiter|talent", re.I), "Recruiter"),
    (re.compile(r"\bhr\b|human resources", re.I), "Human Resources"),
    (re.compile(r"administrator|\badmin\b", re.I), "Administrator"),
    (re.compile(r"\bstaff\b", re.I), "Staff"),
    (re.compile(r"billing|accounts|finance", re.I), "Billing"),
    (re.compile(r"scheduler|scheduling", re.I), "Scheduler"),
]

NAME_SUFFIXES = {"jr", "sr", "ii", "iii", "iv", "md", "rn", "lpn", "stna", "dsp",
                 "phd", "esq", "mr", "mrs", "ms", "miss", "dr"}
NICKNAMES = {
    "mike": "michael", "bob": "robert", "rob": "robert", "bill": "william",
    "jim": "james", "joe": "joseph", "tom": "thomas", "dave": "david",
    "dan": "daniel", "chris": "christopher", "matt": "matthew", "nick": "nicholas",
    "tony": "anthony", "steve": "steven", "rick": "richard", "jen": "jennifer",
    "liz": "elizabeth", "katie": "katherine", "sue": "susan", "ken": "kenneth",
    "ron": "ronald", "don": "donald", "charlie": "charles", "jon": "john",
    "greg": "gregory", "andy": "andrew", "ben": "benjamin", "sam": "samuel",
    "alex": "alexander", "zach": "zachary", "josh": "joshua",
}

MATCH_MIN = 0.86
MATCH_GAP = 0.05


def phone_key(value: str) -> str:
    """Last ten digits, so 937-716-6410 and +19377166410 match."""
    digits = re.sub(r"\D", "", str(value or ""))
    return digits[-10:] if len(digits) > 10 else digits


def contact_keys(row: dict) -> set[str]:
    """Names are how people differ; contact details are how they repeat."""
    out = set()
    email = str(row.get("email", "")).strip().lower()
    if email and "@" in email:
        out.add("e:" + email)
    phone = phone_key(row.get("phone", ""))
    if len(phone) >= 10:
        out.add("p:" + phone)
    return out


def env(key: str) -> str:
    if not ENV_PATH.exists():
        return ""
    for line in ENV_PATH.read_text().splitlines():
        if line.strip().startswith(f"{key}="):
            return line.split("=", 1)[1].strip().strip("'\"")
    return ""


def sheets():
    creds = service_account.Credentials.from_service_account_file(
        SERVICE_ACCOUNT, scopes=["https://www.googleapis.com/auth/spreadsheets"])
    return build("sheets", "v4", credentials=creds).spreadsheets()


# names: the same rules as apps-script/Names.gs, so a match here is a match there
def norm(value: str) -> str:
    s = unicodedata.normalize("NFD", str(value or ""))
    s = "".join(c for c in s if unicodedata.category(c) != "Mn").lower()
    s = re.sub(r"['’`]", "", s)
    s = re.sub(r"[^a-z0-9\s]", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def tokens(value: str) -> list[str]:
    # A trailing "- label" or "(label)" goes, or it would become the surname.
    value = re.sub(r"\s*[-–(].*$", "", str(value or ""))
    parts = [t for t in norm(value).split(" ") if t and t not in NAME_SUFFIXES]
    core = [t for t in parts if len(t) > 1] or parts
    if len(core) > 1 and core[0] in NICKNAMES:
        core = [NICKNAMES[core[0]]] + core[1:]
    return core


def lev(a: str, b: str) -> int:
    if a == b:
        return 0
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[len(b)]


def sim(a: str, b: str) -> float:
    if a == b:
        return 1.0
    m = max(len(a), len(b))
    if not m:
        return 0.0
    s = 1 - lev(a, b) / m
    if a[:1] != b[:1] and s < 0.85:
        s *= 0.75
    return max(s, 0.0)


def name_score(a: str, b: str) -> float:
    A, B = tokens(a), tokens(b)
    if not A or not B:
        return 0.0
    an, bn = " ".join(A), " ".join(B)
    if an == bn:
        return 1.0
    if len(A) == 1 or len(B) == 1:
        return sim(an, bn)
    direct = (sim(A[0], B[0]) + sim(A[-1], B[-1])) / 2
    swapped = (sim(A[0], B[-1]) + sim(A[-1], B[0])) / 2 * 0.98
    score = max(direct, swapped)
    # Each half must hold up alone, or a shared surname makes different first names match.
    holds = (min(sim(A[0], B[0]), sim(A[-1], B[-1])) >= 0.7
             or min(sim(A[0], B[-1]), sim(A[-1], B[0])) >= 0.7)
    return max(score, sim(an, bn)) if holds else score


def classify(row: dict) -> tuple[str, str, str, str]:
    """(person_type, job_title, confidence, basis) — rules only, no guessing."""
    name = str(row.get("name", "")).strip()
    raw = str(row.get("role", "")).strip()
    core = norm(re.sub(r"\s*[-–(].*$", "", name))

    if core in DIRECTORS:
        return "director", "", "certain", "named in the directors list"
    if STRONG_ORG.search(name):
        return "entity", "", "certain", "the name announces an organisation"
    if str(row.get("role", "")).strip().lower() == "entity":
        return "entity", "", "certain", "the source already says entity"

    if raw and JUNK_ROLE.search(raw):
        return "staff", "", "low", "role column holds a job application, not a title"

    for pattern, canonical in TITLE_CANON:
        if raw and pattern.search(raw):
            exact = canonical.lower() == raw.lower()
            return ("staff", canonical, "certain" if exact else "high",
                    "title recognised" if exact else f"normalised from {raw[:60]!r}")

    if not raw:
        # a blank role stays unknown: a hole is recoverable, an invented answer is not
        return "unknown", "", "none", "no role on the record"
    return "unknown", "", "none", f"title not recognised: {raw[:60]!r}"


def ask_model(items: list[dict]) -> dict[str, dict]:
    """Leftovers only, as a suggestion; with no key or a failed call the rows are still written."""
    key = env("OPENAI_API_KEY") or os.getenv("OPENAI_API_KEY", "")
    if not key or not items:
        return {}
    prompt = (
        "Each record comes from a home-care agency's employee roster. For each, say what the "
        "record IS. Answer ONLY with JSON: {\"<person_id>\": {\"type\": \"staff|client|director|entity|unknown\", "
        "\"job_title\": \"<one canonical title, or empty>\", \"why\": \"<12 words>\"}}. "
        "Use \"unknown\" whenever the record does not say — do not infer a job from a name. "
        "\"entity\" is for organisations, not people.\n\n"
        + json.dumps(items[:60], ensure_ascii=False)
    )
    body = json.dumps({
        "model": "gpt-4o-mini",
        "messages": [{"role": "user", "content": prompt}],
        "response_format": {"type": "json_object"},
        "temperature": 0,
    }).encode()
    req = urllib.request.Request(
        "https://api.openai.com/v1/chat/completions", data=body,
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=90) as res:
            out = json.load(res)
        return json.loads(out["choices"][0]["message"]["content"])
    except Exception as exc:  # noqa: BLE001
        print(f"[roster-types] model unavailable ({exc}) — leftovers flagged for a human")
        return {}


def fingerprint(row: dict) -> str:
    return "|".join(str(row.get(k, "")).strip()
                    for k in ("name", "role", "status", "email", "source_coverage"))


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--all", action="store_true", help="re-judge everyone, not just what changed")
    args = ap.parse_args()

    api = sheets()
    values = api.values().get(spreadsheetId=HUB_DB_ID,
                              range=f"{PEOPLE_TAB}!A1:Z2000").execute().get("values", [])
    if not values:
        sys.exit("people tab is empty")
    hdr = values[0]
    people = [dict(zip(hdr, r)) for r in values[1:] if any(c.strip() for c in r)]

    try:
        prev = api.values().get(spreadsheetId=HUB_DB_ID,
                                range=f"{TYPES_TAB}!A1:Z5000").execute().get("values", [])
    except Exception:
        prev = []
    seen: dict[str, str] = {}
    if prev and len(prev) > 1:
        phdr = prev[0]
        i_id = phdr.index("person_id") if "person_id" in phdr else -1
        i_fp = phdr.index("row_fingerprint") if "row_fingerprint" in phdr else -1
        for r in prev[1:]:
            if 0 <= i_id < len(r):
                seen[r[i_id]] = r[i_fp] if 0 <= i_fp < len(r) else ""

    # Duplicates by contact first, then by name for the rest.
    dup_of: dict[str, tuple[str, float]] = {}
    by_contact: dict[str, list[dict]] = defaultdict(list)
    for p in people:
        for k in contact_keys(p):
            by_contact[k].append(p)
    for k, sharing in by_contact.items():
        if len(sharing) < 2:
            continue
        # Three or more records on one detail is a switchboard, not a person.
        if len(sharing) > 2:
            continue
        keep = max(sharing, key=lambda x: (len(str(x.get("source_coverage", ""))),
                                           x.get("status") == "active"))
        for p in sharing:
            pid = str(p.get("id", ""))
            if p.get("id") == keep.get("id") or pid in dup_of:
                continue
            # The name must still say same person, at a far lower bar than name-only.
            a, b = tokens(p.get("name", "")), tokens(keep.get("name", ""))
            same_family = bool(a and b and a[-1] == b[-1])
            if same_family or name_score(p.get("name", ""), keep.get("name", "")) >= 0.6:
                dup_of[pid] = (f"{keep.get('name')} ({keep.get('id')})", 1.0)

    for i, p in enumerate(people):
        if str(p.get("id", "")) in dup_of:
            continue
        best: tuple[float, dict] | None = None
        runner = 0.0
        for j, q in enumerate(people):
            if i == j:
                continue
            s = name_score(p.get("name", ""), q.get("name", ""))
            if best is None or s > best[0]:
                if best is not None and name_score(best[1].get("name", ""), q.get("name", "")) < MATCH_MIN:
                    runner = best[0]
                best = (s, q)
            elif s > runner and name_score(best[1].get("name", ""), q.get("name", "")) < MATCH_MIN:
                runner = s
        if best and best[0] >= MATCH_MIN and (best[0] - runner) >= MATCH_GAP:
            keep = max((p, best[1]),
                       key=lambda x: (len(str(x.get("source_coverage", ""))), x.get("status") == "active"))
            if keep.get("id") != p.get("id"):
                dup_of[str(p.get("id", ""))] = (f"{keep.get('name')} ({keep.get('id')})", best[0])

    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    rows: list[list[str]] = []
    leftovers: list[dict] = []
    counts: dict[str, int] = defaultdict(int)

    for p in people:
        pid = str(p.get("id", ""))
        fp = fingerprint(p)
        if not args.all and seen.get(pid) == fp:
            continue

        ptype, title, confidence, basis = classify(p)
        counts[ptype] += 1
        dup, score = dup_of.get(pid, ("", 0.0))
        if ptype == "unknown":
            leftovers.append({"person_id": pid, "name": p.get("name", ""),
                              "role": str(p.get("role", ""))[:120], "email": p.get("email", ""),
                              "status": p.get("status", "")})
        rows.append([
            p.get("name", ""), pid, ptype, title, confidence, basis,
            str(p.get("role", ""))[:300], dup, f"{score:.2f}" if dup else "",
            p.get("email", ""), p.get("status", ""), "", "", "", now, fp,
        ])

    if not rows:
        print("[roster-types] nothing new to judge")
        return

    opinions = ask_model(leftovers)
    for row in rows:
        o = opinions.get(row[1])
        if o and row[2] == "unknown":
            row[5] = f"{row[5]} · suggestion: {o.get('type')} {o.get('job_title','')} — {o.get('why','')}".strip()

    print(f"[roster-types] {len(rows)} record(s) judged: " +
          ", ".join(f"{k}={v}" for k, v in sorted(counts.items(), key=lambda kv: -kv[1])))
    print(f"[roster-types] {len(dup_of)} duplicate(s) proposed")
    if args.dry_run:
        for r in rows[:15]:
            print(f"   {r[0][:26]:<28} {r[2]:<9} {r[3][:26]:<28} {r[5][:52]}")
        for pid, (primary, s) in list(dup_of.items())[:8]:
            print(f"   duplicate  {pid:<26} → {primary}  ({s:.2f})")
        return

    # --all replaces, or the review sheet becomes two of itself; anything else appends.
    if args.all and prev:
        api.values().clear(spreadsheetId=HUB_DB_ID, range=f"{TYPES_TAB}!A2:Z10000",
                           body={}).execute()

    ss = api.get(spreadsheetId=HUB_DB_ID).execute()
    if TYPES_TAB not in [s["properties"]["title"] for s in ss["sheets"]]:
        api.batchUpdate(spreadsheetId=HUB_DB_ID,
                        body={"requests": [{"addSheet": {"properties": {"title": TYPES_TAB}}}]}).execute()
    if not prev:
        api.values().update(spreadsheetId=HUB_DB_ID, range=f"{TYPES_TAB}!A1",
                            valueInputOption="RAW", body={"values": [TYPES_HEADER]}).execute()
    api.values().append(spreadsheetId=HUB_DB_ID, range=f"{TYPES_TAB}!A1", valueInputOption="RAW",
                        insertDataOption="INSERT_ROWS", body={"values": rows}).execute()
    print(f"[roster-types] wrote {len(rows)} row(s) to `{TYPES_TAB}` — nothing was written to `people`")


if __name__ == "__main__":
    main()
