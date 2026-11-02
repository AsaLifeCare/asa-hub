#!/usr/bin/env python3
"""Sync people into the Hub people tab from the sources enabled in its roster_sources tab."""
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

PEOPLE_TAB = "people"
SOURCES_TAB = "roster_sources"

PEOPLE_HEADER = [
    "id", "name", "first_name", "last_name", "role", "status",
    "email", "phone", "city", "state", "employee_id", "start_date", "end_date",
    "avatar", "source", "source_coverage", "external_id", "updated_at",
]

DEFAULT_SOURCES: list[dict[str, Any]] = [
    {
        "key": "ops_employees",
        "label": "Merged roster (ops.employees)",
        "system": "the old platform",
        "detail": "425 people, rebuilt every 6h from six lanes with per-field provenance",
        "enabled": "yes",
        "authoritative": "yes",
    },
    {
        "key": "employee_master_sheet",
        "label": "Asa Employee Database › Master",
        "system": "Google Sheets",
        "detail": "152 active employees — the HR finish line, maintained by hand",
        "enabled": "no",
        "authoritative": "yes",
    },
    {
        "key": "hub_candidates",
        "label": "Hub candidates (entity_candidates)",
        "system": "ASA Hub",
        "detail": "people already in our own hiring pipeline",
        "enabled": "no",
        "authoritative": "no",
    },
    {
        "key": "openphone_contacts",
        "label": "OpenPhone contacts",
        "system": "the old platform",
        "detail": "2,914 contacts — noisy, useful only for phone matching",
        "enabled": "no",
        "authoritative": "no",
    },
]


def sheets():
    creds = service_account.Credentials.from_service_account_file(
        SERVICE_ACCOUNT, scopes=["https://www.googleapis.com/auth/spreadsheets"]
    )
    return build("sheets", "v4", credentials=creds, cache_discovery=False).spreadsheets()


def pg_query(sql: str) -> list[list[str]]:
    env = {}
    with open(ENV_FILE) as fh:
        for line in fh:
            if "=" in line and not line.startswith("#"):
                k, v = line.strip().split("=", 1)
                env[k] = v.strip().strip('"')
    m = re.match(r"postgres(?:ql)?(?:\+\w+)?://([^:]+):([^@]+)@([^:/]+):?(\d+)?/(\w+)", env.get("DATABASE_URL", ""))
    if not m:
        raise SystemExit("DATABASE_URL not parseable — cannot reach Postgres")
    user, password, db = m.group(1), m.group(2), m.group(5)
    out = subprocess.run(
        ["docker", "exec", PG_CONTAINER, "psql", "-U", user, "-d", db, "-tAF", "\t", "-c", sql],
        capture_output=True, text=True, env={**os.environ, "PGPASSWORD": password},
    )
    if out.returncode != 0:
        raise SystemExit(f"psql failed: {out.stderr[:300]}")
    return [line.split("\t") for line in out.stdout.strip().split("\n") if line.strip()]


def ensure_tab(api, tab: str, header: list[str], seed_rows: list[list[Any]] | None = None) -> list[str]:
    # a missing tab is a 400 from values().get, not an empty result
    meta = api.get(spreadsheetId=HUB_DB_ID, fields="sheets.properties.title").execute()
    if tab not in [s["properties"]["title"] for s in meta["sheets"]]:
        api.batchUpdate(
            spreadsheetId=HUB_DB_ID,
            body={"requests": [{"addSheet": {"properties": {"title": tab}}}]},
        ).execute()
    values = api.values().get(spreadsheetId=HUB_DB_ID, range=f"{tab}!A1:AZ").execute().get("values", [])
    if not values:
        api.values().update(
            spreadsheetId=HUB_DB_ID, range=f"{tab}!A1",
            valueInputOption="RAW", body={"values": [header]},
        ).execute()
        if seed_rows:
            api.values().append(
                spreadsheetId=HUB_DB_ID, range=f"{tab}!A1", valueInputOption="RAW",
                insertDataOption="INSERT_ROWS", body={"values": seed_rows},
            ).execute()
        return header
    return values[0]


def enabled_sources(api) -> list[str]:
    seed = [[s.get(h, "") for h in ["key", "label", "system", "detail", "enabled", "authoritative"]]
            for s in DEFAULT_SOURCES]
    ensure_tab(api, SOURCES_TAB, ["key", "label", "system", "detail", "enabled", "authoritative"], seed)
    rows = api.values().get(spreadsheetId=HUB_DB_ID, range=f"{SOURCES_TAB}!A1:F").execute().get("values", [])
    hdr = rows[0]
    ik, ie = hdr.index("key"), hdr.index("enabled")
    out = []
    for r in rows[1:]:
        r = r + [""] * (len(hdr) - len(r))
        if r[ik] and str(r[ie]).strip().lower() in ("yes", "true", "1"):
            out.append(r[ik])
    return out


def from_ops_employees() -> list[dict[str, Any]]:
    rows = pg_query(
        "select name_key, display_name, coalesce(status,''), coalesce(profile::text,'{}'), "
        "array_to_string(source_coverage, ','), coalesce(updated_at::text,'') "
        "from app.ops_employees order by display_name;"
    )
    people = []
    for name_key, display, status, profile_json, coverage, updated in rows:
        try:
            p = json.loads(profile_json)
        except json.JSONDecodeError:
            p = {}
        people.append({
            "id": f"PPL_{name_key[:28]}",
            "name": display or p.get("full_name") or name_key,
            "first_name": p.get("first_name", ""),
            "last_name": p.get("last_name", ""),
            "role": p.get("role", ""),
            "status": status or p.get("status", ""),
            "email": p.get("email", ""),
            "phone": p.get("phone", ""),
            "city": p.get("city", ""),
            "state": p.get("state", ""),
            "employee_id": p.get("employee_id", ""),
            "start_date": p.get("start_date", ""),
            "end_date": p.get("end_date", ""),
            "avatar": "",
            "source": "ops.employees",
            "source_coverage": coverage,
            "external_id": name_key,
            "updated_at": updated,
        })
    return people


LOADERS = {"ops_employees": from_ops_employees}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    api = sheets()
    chosen = enabled_sources(api)
    print(f"enabled sources: {chosen or '(none)'}")
    if not chosen:
        print("nothing to do — enable a source in the roster_sources tab")
        return 0

    people: dict[str, dict[str, Any]] = {}
    for key in chosen:
        loader = LOADERS.get(key)
        if not loader:
            print(f"  ! {key}: no loader yet — skipped")
            continue
        rows = loader()
        print(f"  · {key}: {len(rows)} people")
        for r in rows:
            # first enabled source wins a person; later ones only fill blanks
            cur = people.get(r["id"])
            if cur is None:
                people[r["id"]] = r
            else:
                for k, v in r.items():
                    if v and not cur.get(k):
                        cur[k] = v

    ensure_tab(api, PEOPLE_TAB, PEOPLE_HEADER)
    body = [[p.get(h, "") for h in PEOPLE_HEADER] for p in people.values()]
    print(f"→ {len(body)} rows to write into `{PEOPLE_TAB}`")
    if args.dry_run:
        for row in body[:5]:
            print("   ", row[:6])
        return 0

    api.values().update(
        spreadsheetId=HUB_DB_ID, range=f"{PEOPLE_TAB}!A1",
        valueInputOption="RAW", body={"values": [PEOPLE_HEADER]},
    ).execute()
    api.values().clear(spreadsheetId=HUB_DB_ID, range=f"{PEOPLE_TAB}!A2:AZ").execute()
    for i in range(0, len(body), 500):
        api.values().append(
            spreadsheetId=HUB_DB_ID, range=f"{PEOPLE_TAB}!A1", valueInputOption="RAW",
            insertDataOption="INSERT_ROWS", body={"values": body[i:i + 500]},
        ).execute()
    print("done")
    return 0


if __name__ == "__main__":
    sys.exit(main())
