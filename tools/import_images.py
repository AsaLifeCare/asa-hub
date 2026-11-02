#!/usr/bin/env python3
"""Copy the intranet's portraits, house photos and brand images into the Image Bank; identity documents never."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import sys
from typing import Any

from google.oauth2 import service_account
from googleapiclient.discovery import build

HUB_REPO = "/opt/docker/asa-hub"
DEST_ROOT = os.path.join(HUB_REPO, "public", "assets", "library")
HUB_DB_ID = "1SGC3fDFJsraqLXzHgUGRARe5n_IkguyBsTD4bze36ts"
SERVICE_ACCOUNT = "/opt/docker/asa-hub/server/.service-account.json"
PHOTOS_TAB = "photos"

PHOTOS_HEADER = ["id", "title", "src", "kind", "assignedTo", "personId", "tags",
                 "origin", "bytes", "createdAt"]

BRING = {
    "photo-person": ("avatar", "people"),
    "photo-house": ("scene", "houses"),
    "branding": ("cover", "brand"),
}
NEVER = {"id-document-phi", "ui-chrome", "med-image", "med-image-remote"}

TITLE_CLEAN = re.compile(r"[_\-]+")


def nice_title(path: str) -> str:
    base = os.path.basename(path)
    base = os.path.splitext(base)[0]
    base = TITLE_CLEAN.sub(" ", base).strip()
    return base[:1].upper() + base[1:] if base else "Untitled"


def sheets():
    creds = service_account.Credentials.from_service_account_file(
        SERVICE_ACCOUNT, scopes=["https://www.googleapis.com/auth/spreadsheets"]
    )
    return build("sheets", "v4", credentials=creds, cache_discovery=False).spreadsheets()


def ensure_tab(api, tab: str, header: list[str]) -> None:
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


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--inventory", required=True, help="the intranet recon's intranet_images.json")
    args = ap.parse_args()

    with open(args.inventory) as fh:
        raw = json.load(fh)
    items: list[dict[str, Any]] = raw if isinstance(raw, list) else raw.get("items", [])

    picked, skipped_phi, seen_hash = [], 0, set()
    for it in items:
        kind = it.get("kind", "")
        if kind in NEVER:
            if kind == "id-document-phi":
                skipped_phi += 1
            continue
        if kind not in BRING:
            continue
        path = it.get("path") or ""
        if not path or not os.path.isfile(path):
            continue
        digest = it.get("sha256_16") or hashlib.sha256(open(path, "rb").read()).hexdigest()[:16]
        if digest in seen_hash:
            continue  # the pool is full of byte-identical copies
        seen_hash.add(digest)
        picked.append({**it, "path": path, "digest": digest})

    print(f"inventory: {len(items)} records")
    print(f"bringing:  {len(picked)} unique images")
    print(f"refused:   {skipped_phi} identity documents (PHI — never into a gallery)")
    for kind, (bank_kind, folder) in BRING.items():
        n = len([p for p in picked if p["kind"] == kind])
        print(f"   · {kind:14} → assets/library/{folder:8} ({bank_kind}) — {n}")

    if args.dry_run:
        return 0

    rows = []
    for p in picked:
        bank_kind, folder = BRING[p["kind"]]
        ext = os.path.splitext(p["path"])[1].lower() or f".{p.get('format', 'jpg')}"
        if ext in (".", ""):
            ext = ".jpg"
        dest_dir = os.path.join(DEST_ROOT, folder)
        os.makedirs(dest_dir, exist_ok=True)
        name = f"{p['digest']}{ext}"
        dest = os.path.join(dest_dir, name)
        if not os.path.exists(dest):
            shutil.copy2(p["path"], dest)
        rows.append([
            f"IMG_{p['digest'].upper()}",
            nice_title(p["path"]),
            f"/assets/library/{folder}/{name}",
            bank_kind,
            "", "",
            p.get("suggested_category", ""),
            f"intranet:{p.get('source', 'file')}",
            p.get("bytes", ""),
            "",
        ])

    api = sheets()
    ensure_tab(api, PHOTOS_TAB, PHOTOS_HEADER)
    existing = api.values().get(spreadsheetId=HUB_DB_ID, range=f"{PHOTOS_TAB}!A1:J").execute().get("values", [])
    have = {r[0] for r in existing[1:] if r} if len(existing) > 1 else set()
    fresh = [r for r in rows if r[0] not in have]
    if fresh:
        api.values().append(
            spreadsheetId=HUB_DB_ID, range=f"{PHOTOS_TAB}!A1", valueInputOption="RAW",
            insertDataOption="INSERT_ROWS", body={"values": fresh},
        ).execute()
    print(f"copied {len(rows)} files · {len(fresh)} new rows in `{PHOTOS_TAB}`")
    return 0


if __name__ == "__main__":
    sys.exit(main())
