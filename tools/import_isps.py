#!/usr/bin/env python3
"""Copy the structured Individual Service Plans from asa_isp_chat into the Hub; raw_text is never copied."""
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
ISP_TAB = "isps"

FIELDS = [
    "client_key", "client_name", "isp_year",
    "allergies", "medications", "diet_nutrition", "safety_risks", "supervision_level",
    "behaviors", "mobility", "personal_care", "communication",
    "diagnoses", "medical_summary", "goals_outcomes",
    "important_to", "important_for", "contacts",
    "source_file", "page_count", "loaded_at",
    "contact_block",
]
HEADER = ["id"] + FIELDS


def pg_rows(sql: str) -> list[dict[str, Any]]:
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
    # JSON, not delimited text: clinical sections carry newlines, tabs, pipes and commas
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


def clean(v: str, limit: int = 8000) -> str:
    s = (v or "").replace("\\n", "\n").strip()
    if len(s) > limit:
        return s[: limit - 20] + " …[truncated]"
    return s


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    # strpos+substr, not a regex: Postgres' POSIX engine caps {n,m} repetition
    exprs = {"contact_block": (
        "case when strpos(raw_text,'Contact Information') > 0 "
        "then substr(raw_text, strpos(raw_text,'Contact Information'), 3000) "
        "else '' end")}
    cols = ", ".join(f"{exprs.get(c, f'coalesce({c}::text,\'\')')} as {c}" for c in FIELDS)
    rows = pg_rows(
        f"select coalesce(json_agg(t)::text, '[]') from "
        f"(select {cols} from app.asa_isp_chat order by client_name) t;"
    )
    print(f"asa_isp_chat: {len(rows)} clients")

    out = []
    for rec in rows:
        out.append([f"ISP_{rec.get('client_key', '')}"] + [clean(str(rec.get(f, ""))) for f in FIELDS])

    if args.dry_run:
        for row in out[:3]:
            print("   ", row[0], "|", row[2], "| allergies:", (row[4] or "—")[:60])
        return 0

    api = sheets()
    ensure_tab(api, ISP_TAB, HEADER)
    api.values().update(spreadsheetId=HUB_DB_ID, range=f"{ISP_TAB}!A1",
                        valueInputOption="RAW", body={"values": [HEADER]}).execute()
    api.values().clear(spreadsheetId=HUB_DB_ID, range=f"{ISP_TAB}!A2:AZ").execute()
    api.values().append(spreadsheetId=HUB_DB_ID, range=f"{ISP_TAB}!A1", valueInputOption="RAW",
                        insertDataOption="INSERT_ROWS", body={"values": out}).execute()
    print(f"wrote {len(out)} ISPs into `{ISP_TAB}`")
    print("NOTE: clinical data — the isps resource is gated to admin/manager/staff in the app registry.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
