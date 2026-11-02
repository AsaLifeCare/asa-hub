#!/usr/bin/env python3
"""Apply the Forms.gs import rules to masks already stored in the Forms house."""
from __future__ import annotations

import json
import sys
import urllib.parse
import urllib.request
from pathlib import Path

ENV_PATH = Path("/opt/docker/asa-hub/server/.tools.env")
HOUSE = "1yMFlXYlcS-bBImucBfULgMv3XSFzqeNPvkefG-j7IdQ"   # ASA Data — Forms
TAB = "Data"


def env(k: str) -> str:
    for line in ENV_PATH.read_text().splitlines():
        line = line.strip()
        if line.startswith(f"{k}="):
            return line.split("=", 1)[1].strip().strip("'\"")
    sys.exit(f"{k} not found in {ENV_PATH}")


def token() -> str:
    body = urllib.parse.urlencode({
        "client_id": env("GS_GOOGLE_CLIENT_ID"),
        "client_secret": env("GS_GOOGLE_CLIENT_SECRET"),
        "refresh_token": env("GS_GOOGLE_REFRESH_TOKEN"),
        "grant_type": "refresh_token"}).encode()
    req = urllib.request.Request("https://oauth2.googleapis.com/token", data=body, method="POST")
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)["access_token"]


TOK = token()
S = "https://sheets.googleapis.com/v4/spreadsheets/"


def api(url: str, payload: dict | None = None, method: str = "GET") -> dict:
    req = urllib.request.Request(url, method=method)
    req.add_header("Authorization", "Bearer " + TOK)
    body = json.dumps(payload).encode() if payload is not None else None
    if body:
        req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, body, timeout=120) as resp:
        raw = resp.read()
        return json.loads(raw) if raw else {}


def col_a1(i: int) -> str:
    out = ""
    while i >= 0:
        out = chr(ord("A") + i % 26) + out
        i = i // 26 - 1
    return out


def main() -> None:
    dry = "--dry-run" in sys.argv
    vals = api(S + HOUSE + "/values/" + urllib.parse.quote(f"'{TAB}'!A1:AZ2000")).get("values") or []
    if len(vals) < 2:
        sys.exit("the Forms house answered empty — refusing.")
    hdr = [str(h).strip() for h in vals[0]]
    for need in ("slug", "fields", "asks_contact"):
        if need not in hdr:
            sys.exit(f"column '{need}' missing from the house header: {hdr}")
    c_slug, c_fields, c_contact = hdr.index("slug"), hdr.index("fields"), hdr.index("asks_contact")

    updates: list[dict] = []
    report: list[str] = []
    for n, row in enumerate(vals[1:], start=2):
        get = lambda c: str(row[c]) if c < len(row) else ""   # noqa: E731
        slug = get(c_slug).strip()
        if not slug:
            continue
        if get(c_contact).strip().lower() != "no":
            updates.append({"range": f"'{TAB}'!{col_a1(c_contact)}{n}", "values": [["no"]]})
            report.append(f"{slug}: asks_contact -> no")
        try:
            fields = json.loads(get(c_fields) or "[]")
        except Exception:
            continue
        changed = False
        if slug == "applicant-in-person-screen":
            for f in fields:
                if (str(f.get("kind")) == "scale" and "overall" in str(f.get("label", "")).lower()
                        and str(f.get("style", "")) != "star"):
                    f["style"] = "star"
                    changed = True
                    report.append(f"{slug}: '{f.get('label')}' wears stars")
        if slug.startswith("360-evaluation-employee-performance-supervisor"):
            for i in range(len(fields) - 1):
                a, b = fields[i], fields[i + 1]
                if (str(a.get("kind")) == "heading" and not str(a.get("help", "")).strip()
                        and str(b.get("kind")) in ("text", "long")
                        and "dodd" in str(b.get("help", "")).lower()):
                    a["help"] = b["help"]
                    b.pop("help", None)
                    changed = True
                    report.append(f"{slug}: section words back on '{a.get('label')}'")
        if changed:
            updates.append({"range": f"'{TAB}'!{col_a1(c_fields)}{n}",
                            "values": [[json.dumps(fields, separators=(",", ":"))]]})

    print(f"{len(updates)} cell update(s):")
    for r in report:
        print("  " + r)
    if dry:
        print("--dry-run: nothing written.")
        return
    if updates:
        api(S + HOUSE + "/values:batchUpdate",
            {"valueInputOption": "RAW", "data": updates}, "POST")
        print("landed.")


if __name__ == "__main__":
    main()
