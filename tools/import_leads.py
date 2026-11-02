#!/usr/bin/env python3
"""
Potential clients — the referral leads, into the Hub.

THE SOURCE, AND WHY IT STAYS WHERE IT IS
----------------------------------------
`lead_scraper.py` logs into the Stark County DD provider portal (Brittco),
reads the open referrals out of a Laravel/Vue page, scores each 1–10 and
texts the good ones. It runs every 4 hours on the platform.

That scraper is NOT being ported into Apps Script. It needs a session login
and HTML parsing of a JS-rendered page; rewriting it in GAS would be fragile
and would leave two copies of the same scraper to maintain. It keeps running
where it runs, and this script brings its OUTPUT over — the Hub owns the
funnel, the notes and the decisions.

PHI HANDLING
------------
`raw_json` carries Medicaid numbers and the full referral packet. It is
deliberately NOT copied. Diagnosis and age come across because they are what
an intake decision is actually made on, and the app gates the audience.

USAGE
-----
    python3 tools/import_leads.py --dry-run
    python3 tools/import_leads.py
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from typing import Any

from google.oauth2 import service_account
from googleapiclient.discovery import build

HUB_DB_ID = "1SGC3fDFJsraqLXzHgUGRARe5n_IkguyBsTD4bze36ts"
SERVICE_ACCOUNT = "/opt/docker/asa-hub/server/.service-account.json"
ENV_FILE = "/opt/docker/asa-hub/server/.tools.env"
PG_CONTAINER = "asa-hub-db"  # the records taken from the old platform live here (db/lane_tables.sql)
TAB = "potentialClients"

FIELDS = [
    "referral_id", "client_name", "client_age", "client_gender", "diagnosis",
    "frequency", "description", "postal_code", "funding_source", "expiration_date",
    "ai_rating", "ai_notes", "sms_sent", "scraped_at",
]
HEADER = ["id"] + FIELDS + ["stage", "owner", "next_step", "notes"]

# The funnel the Hub adds on top of the scrape. A lead arrives as `new`; the
# rest is ours to run, which is the whole reason for bringing it over.
DEFAULT_STAGE = "new"


def pg_json(sql: str) -> list[dict[str, Any]]:
    env: dict[str, str] = {}
    with open(ENV_FILE) as fh:
        for line in fh:
            if "=" in line and not line.startswith("#"):
                k, v = line.strip().split("=", 1)
                env[k] = v.strip().strip('"')
    m = re.match(r"postgres(?:ql)?(?:\+\w+)?://([^:]+):([^@]+)@([^:/]+):?(\d+)?/(\w+)", env.get("DATABASE_URL", ""))
    if not m:
        raise SystemExit("DATABASE_URL not parseable")
    out = subprocess.run(
        ["docker", "exec", PG_CONTAINER, "psql", "-U", m.group(1), "-d", m.group(5), "-tAc", sql],
        capture_output=True, text=True, env={**os.environ, "PGPASSWORD": m.group(2)},
    )
    if out.returncode != 0:
        raise SystemExit(f"psql failed: {out.stderr[:300]}")
    return json.loads(out.stdout.strip() or "[]")


def sheets():
    creds = service_account.Credentials.from_service_account_file(
        SERVICE_ACCOUNT, scopes=["https://www.googleapis.com/auth/spreadsheets"]
    )
    return build("sheets", "v4", credentials=creds, cache_discovery=False).spreadsheets()


def ensure_tab(api, tab: str, header: list[str]) -> None:
    meta = api.get(spreadsheetId=HUB_DB_ID, fields="sheets.properties.title").execute()
    if tab not in [s["properties"]["title"] for s in meta["sheets"]]:
        api.batchUpdate(spreadsheetId=HUB_DB_ID,
                        body={"requests": [{"addSheet": {"properties": {"title": tab}}}]}).execute()
    vals = api.values().get(spreadsheetId=HUB_DB_ID, range=f"{tab}!A1:AZ").execute().get("values", [])
    if not vals:
        api.values().update(spreadsheetId=HUB_DB_ID, range=f"{tab}!A1",
                            valueInputOption="RAW", body={"values": [header]}).execute()


def clean(v: Any, limit: int = 4000) -> str:
    s = str(v if v is not None else "").strip()
    return s[: limit - 20] + " …[truncated]" if len(s) > limit else s


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    cols = ", ".join(f"coalesce({c}::text,'') as {c}" for c in FIELDS)
    rows = pg_json(
        f"select coalesce(json_agg(t)::text,'[]') from "
        f"(select {cols} from public.asa_lead_referrals order by ai_rating desc nulls last, scraped_at desc) t;"
    )
    print(f"asa_lead_referrals: {len(rows)} leads")
    rated = [r for r in rows if str(r.get("ai_rating") or "").strip()]
    print(f"  scored: {len(rated)} · texted: {sum(1 for r in rows if str(r.get('sms_sent')).lower() in ('t', 'true'))}")

    api = sheets()
    ensure_tab(api, TAB, HEADER)
    existing = api.values().get(spreadsheetId=HUB_DB_ID, range=f"{TAB}!A1:AZ").execute().get("values", [])
    hdr = existing[0] if existing else HEADER
    have = {r[0] for r in existing[1:] if r} if len(existing) > 1 else set()

    fresh = []
    for r in rows:
        rid = f"LEAD_{r.get('referral_id', '')}"
        if rid in have:
            continue  # never overwrite: the stage/notes on an existing row are ours
        fresh.append([rid] + [clean(r.get(f, "")) for f in FIELDS] + [DEFAULT_STAGE, "", "", ""])

    print(f"→ {len(fresh)} new leads (existing rows keep their stage and notes)")
    if args.dry_run:
        for row in fresh[:5]:
            print("   ", row[2], "| score", row[11], "|", (row[5] or "")[:40])
        return 0

    for i in range(0, len(fresh), 500):
        api.values().append(spreadsheetId=HUB_DB_ID, range=f"{TAB}!A1", valueInputOption="RAW",
                            insertDataOption="INSERT_ROWS", body={"values": fresh[i:i + 500]}).execute()
    print(f"wrote {len(fresh)} rows into `{TAB}` (raw_json with Medicaid numbers deliberately left behind)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
