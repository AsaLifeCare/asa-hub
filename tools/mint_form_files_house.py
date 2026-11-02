#!/usr/bin/env python3
"""Mint the form_files house and declare it; without the service-account share the digest worker dies silently."""
from __future__ import annotations

import base64
import json
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

ENV_PATH = Path("/opt/docker/asa-hub/server/.tools.env")
ESSENCIAL_ID = "1Y6UMJlCS5gHur52f0YrPsLSqwYlCA792I8gAiZsxsug"
SA_JSON_PATHS = [Path("/opt/docker/asa-hub/server/.service-account.json")]
TAB = "form_files"
TITLE = "ASA Data — FormFiles"
PROP = "HUB_HOUSE_FORM_FILES_ID"
HEADER = ["id", "createdAt", "updatedAt",
          "form_slug", "submission_id", "field_key",
          "file_id", "file_url", "file_name", "mime_type", "size_bytes",
          "uploaded_by_name", "uploaded_by_email",
          "digest_state", "digest_kind", "digest_category",
          "digest_dates", "digest_names",
          "digest_text_chars", "digest_text", "digest_json",
          "digest_error", "digested_at"]


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
D = "https://www.googleapis.com/drive/v3/files/"


def api(url: str, payload: dict | None = None, method: str = "GET", tries: int = 6) -> dict:
    for a in range(tries):
        req = urllib.request.Request(url, method=method)
        req.add_header("Authorization", "Bearer " + TOK)
        body = json.dumps(payload).encode() if payload is not None else None
        if body:
            req.add_header("Content-Type", "application/json")
        try:
            with urllib.request.urlopen(req, body, timeout=120) as resp:
                raw = resp.read()
                return json.loads(raw) if raw else {}
        except Exception as err:
            if getattr(err, "code", 0) in (400, 403, 404):
                raise
            if a < tries - 1:
                time.sleep(5 * (a + 1))
                continue
            raise
    return {}


def depot_state() -> dict[str, str]:
    rows = api(S + ESSENCIAL_ID + "/values/" + urllib.parse.quote("'Facts'!A2:I999999")).get("values") or []
    state: dict[str, str] = {}
    for row in rows:
        if len(row) > 4 and row[4]:
            state[str(row[4])] = str(row[2]) if len(row) > 2 else ""
    return state


def sa_email() -> str:
    for p in SA_JSON_PATHS:
        try:
            raw = p.read_text().strip()
            info = json.loads(base64.b64decode(raw)) if not raw.startswith("{") else json.loads(raw)
            if info.get("client_email"):
                return str(info["client_email"])
        except Exception:
            continue
    return ""


def main() -> None:
    dry = "--dry-run" in sys.argv
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    have = depot_state()
    src_ptr = f"switchboard:props.{PROP}"
    sid = have.get(src_ptr, "")
    sa = sa_email()
    if sid:
        print(f"pointer already in the depot: {PROP} = {sid[:14]}… (reusing the house)")
    print(f"service account for the share: {sa or 'NOT FOUND — share will be skipped'}")

    if dry:
        print(f"\n--dry-run: would {'reuse' if sid else 'create'} \"{TITLE}\" "
              f"({len(HEADER)} cols), append pointer + moved + schema facts, "
              f"Registry row, and share to the SA. Nothing written.")
        return

    if not sid:
        sid = api(S, {"properties": {"title": TITLE},
                      "sheets": [{"properties": {
                          "title": TAB,
                          "gridProperties": {"rowCount": 2000,
                                             "columnCount": len(HEADER) + 3,
                                             "frozenRowCount": 1}}}]}, "POST")["spreadsheetId"]
        print(f"house created as asatech: {TITLE} = {sid}")
    api(S + sid + "/values/" + urllib.parse.quote(f"'{TAB}'!A1") + "?valueInputOption=RAW",
        {"values": [HEADER]}, "PUT")
    print(f"header stamped ({len(HEADER)} cols)")

    facts = []
    if have.get(src_ptr) != sid:
        facts.append(["config.props." + PROP.lower().replace("_", ""), PROP, sid, "",
                      src_ptr, "", now, "mint-form-files", ""])
    if have.get(f"switchboard:moved.{TAB}") != "on":
        facts.append([f"config.moved.{TAB}", f"moved.{TAB}", "on", "",
                      f"switchboard:moved.{TAB}", "", now, "mint-form-files", ""])
    schema_val = json.dumps(HEADER, separators=(",", ":"))
    if have.get(f"schema:{TAB}.header") != schema_val:
        facts.append([f"schema.{TAB}.header", "__schema", schema_val, "",
                      f"schema:{TAB}.header", "", now, "mint-form-files", ""])
    if facts:
        api(S + ESSENCIAL_ID + "/values/" + urllib.parse.quote("'Facts'!A1") +
            ":append?valueInputOption=RAW&insertDataOption=INSERT_ROWS",
            {"values": facts}, "POST")
    fresh = depot_state()
    assert fresh.get(src_ptr) == sid, "pointer did not land"
    assert fresh.get(f"switchboard:moved.{TAB}") == "on", "moved switch did not land"
    print(f"declared: {PROP} → {sid[:14]}… · moved.{TAB}=on · schema ({len(HEADER)} cols)")

    reg = api(S + ESSENCIAL_ID + "/values/" + urllib.parse.quote("'Registry'!A2:D9999")).get("values") or []
    if not any(len(r) > 1 and str(r[1]).strip() == sid for r in reg):
        api(S + ESSENCIAL_ID + "/values/" + urllib.parse.quote("'Registry'!A1") +
            ":append?valueInputOption=RAW&insertDataOption=INSERT_ROWS",
            {"values": [[f"data.{TAB}", sid, "on", f"data: {TAB} (form upload ledger)"]]}, "POST")
        print("Registry row appended")
    else:
        print("Registry row already present")

    if sa:
        try:
            api(D + sid + "/permissions?sendNotificationEmail=false&supportsAllDrives=true",
                {"role": "writer", "type": "user", "emailAddress": sa}, "POST")
            print(f"house shared with {sa} (writer)")
        except Exception as exc:
            print(f"WARNING: share failed ({str(exc)[:120]}) — the digest worker cannot "
                  f"write until the house is shared with {sa}")
    print("\nLIVE within the 300s switchboard cache. Next: paste the \"Asa Hub - Form\" "
          "folder id into HUB_FORM_UPLOADS_FOLDER_ID and share that folder with the SA (viewer).")


if __name__ == "__main__":
    main()
