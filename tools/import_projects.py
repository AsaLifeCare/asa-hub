#!/usr/bin/env python3
"""Import the project portfolio and the Agent Projects work items into Hub tabs, appending only new ids."""
from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Any

from google.oauth2 import service_account
from googleapiclient.discovery import build

HUB_DB_ID = "1SGC3fDFJsraqLXzHgUGRARe5n_IkguyBsTD4bze36ts"
AGENT_PROJECTS_ID = "1-EjtOE4SjFA2GP5HvD_a-hwwvDn9BUlU8XDceS2kisQ"
SERVICE_ACCOUNT = "/opt/docker/asa-hub/server/.service-account.json"

PROJECTS_TAB = "projects"
WORK_ITEMS_TAB = "project_work_items"

PROJECTS_HEADER = [
    "id", "name", "category", "status", "blurb", "strengths", "gaps",
    "file_count", "size_bytes", "recent_files", "platform", "assessed",
    "origin", "updated_at",
]
WORK_HEADER = [
    "id", "project", "phase", "workstream", "title", "outcome",
    "definition_of_done", "priority", "status", "owner", "risks",
    "decisions", "evidence", "notes",
]


def sheets():
    creds = service_account.Credentials.from_service_account_file(
        SERVICE_ACCOUNT,
        scopes=["https://www.googleapis.com/auth/spreadsheets"],
    )
    return build("sheets", "v4", credentials=creds, cache_discovery=False).spreadsheets()


def ensure_tab(api, book: str, tab: str, header: list[str]) -> None:
    meta = api.get(spreadsheetId=book, fields="sheets.properties.title").execute()
    if tab not in [s["properties"]["title"] for s in meta["sheets"]]:
        api.batchUpdate(
            spreadsheetId=book,
            body={"requests": [{"addSheet": {"properties": {"title": tab}}}]},
        ).execute()
    vals = api.values().get(spreadsheetId=book, range=f"{tab}!A1:AZ").execute().get("values", [])
    if not vals:
        api.values().update(
            spreadsheetId=book, range=f"{tab}!A1",
            valueInputOption="RAW", body={"values": [header]},
        ).execute()


def slug(name: str) -> str:
    return "PRJ_" + "".join(c if c.isalnum() else "_" for c in name.lower()).strip("_")[:32]


def project_rows(data: dict[str, Any]) -> list[list[Any]]:
    rows = []
    for p in data.get("projects", []):
        rows.append([
            slug(p.get("name", "")),
            p.get("name", ""),
            p.get("category", ""),
            p.get("status", ""),
            p.get("blurb", ""),
            " · ".join(p.get("strengths", []) or []),
            " · ".join(p.get("gaps", []) or []),
            p.get("file_count", ""),
            p.get("size_bytes", ""),
            ", ".join((p.get("recent", []) or [])[:5]),
            "yes" if p.get("platform") else "",
            "yes" if p.get("assessed") else "",
            "imported:tech_assessment",
            data.get("extracted_at", ""),
        ])
    return rows


def work_item_rows(api) -> list[list[Any]]:
    try:
        vals = api.values().get(spreadsheetId=AGENT_PROJECTS_ID, range="Work Items!A1:Z").execute().get("values", [])
    except Exception as exc:  # noqa: BLE001
        print(f"  ! Agent Projects unreadable: {str(exc)[:120]}")
        return []
    if len(vals) < 2:
        return []
    hdr = [h.strip().lower().replace(" ", "_") for h in vals[0]]

    def cell(row: list[str], key: str) -> str:
        if key not in hdr:
            return ""
        i = hdr.index(key)
        return row[i] if i < len(row) else ""

    rows = []
    for r in vals[1:]:
        if not any(str(c).strip() for c in r):
            continue
        wid = cell(r, "work_item_id")
        if not wid:
            continue
        rows.append([
            wid,
            cell(r, "workstream") or "Agent Projects",
            cell(r, "phase_id"),
            cell(r, "workstream"),
            cell(r, "title"),
            cell(r, "outcome"),
            cell(r, "definition_of_done"),
            cell(r, "priority"),
            cell(r, "status"),
            cell(r, "owner"),
            cell(r, "risk_ids"),
            cell(r, "decision_ids"),
            cell(r, "evidence_link"),
            cell(r, "notes"),
        ])
    return rows


def write(api, tab: str, header: list[str], rows: list[list[Any]]) -> int:
    ensure_tab(api, HUB_DB_ID, tab, header)
    existing = api.values().get(spreadsheetId=HUB_DB_ID, range=f"{tab}!A1:AZ").execute().get("values", [])
    have = {r[0] for r in existing[1:] if r} if len(existing) > 1 else set()
    fresh = [r for r in rows if str(r[0]) not in have]
    for i in range(0, len(fresh), 500):
        api.values().append(
            spreadsheetId=HUB_DB_ID, range=f"{tab}!A1", valueInputOption="RAW",
            insertDataOption="INSERT_ROWS", body={"values": fresh[i:i + 500]},
        ).execute()
    return len(fresh)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--recon", required=True, help="the recon's lane_projects.json")
    args = ap.parse_args()

    if not os.path.exists(args.recon):
        raise SystemExit(f"recon file missing: {args.recon}")
    with open(args.recon) as fh:
        data = json.load(fh)

    api = sheets()
    projects = project_rows(data)
    items = work_item_rows(api)
    print(f"projects:   {len(projects)}")
    print(f"work items: {len(items)}")
    if args.dry_run:
        for p in projects[:3]:
            print("   ", p[1], "|", p[3], "|", p[2])
        return 0

    n1 = write(api, PROJECTS_TAB, PROJECTS_HEADER, projects)
    n2 = write(api, WORK_ITEMS_TAB, WORK_HEADER, items)
    print(f"wrote {n1} projects, {n2} work items")
    return 0


if __name__ == "__main__":
    sys.exit(main())
