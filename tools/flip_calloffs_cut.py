#!/usr/bin/env python3
"""Copy the call-off tracker into the callOffs house in order; the mail sweep's cursor is positional."""
from __future__ import annotations

import hashlib
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

ENV_PATH = Path("/opt/docker/asa-hub/server/.tools.env")
ESSENCIAL_ID = "1Y6UMJlCS5gHur52f0YrPsLSqwYlCA792I8gAiZsxsug"
TAB = "callOffs"
SRC_TAB = "Master"
HEADER = ["id", "createdAt", "updatedAt",
          "timestamp", "employee_name", "date", "type", "how_late", "notes", "your_name"]


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


def api(url: str, payload: dict | None = None, method: str = "GET", tries: int = 8) -> dict:
    for a in range(tries):
        req = urllib.request.Request(url, method=method)
        req.add_header("Authorization", "Bearer " + TOK)
        body = json.dumps(payload).encode() if payload is not None else None
        if body:
            req.add_header("Content-Type", "application/json")
        try:
            with urllib.request.urlopen(req, body, timeout=300) as resp:
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
    st: dict[str, str] = {}
    for r in rows:
        if len(r) > 4 and r[4]:
            st[str(r[4])] = str(r[2]) if len(r) > 2 else ""
    return st


def estate_key(h: str) -> str:
    h = re.sub(r"\([^)]*\)", " ", str(h or ""))
    return re.sub(r"[^a-z0-9]+", "_", h.lower()).strip("_")


def main() -> None:
    dry = "--dry-run" in sys.argv
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    depot = depot_state()
    est = depot.get("switchboard:props.ESTATE_CALLOFFS_ID", "").strip()
    house = depot.get("switchboard:props.HUB_HOUSE_CALLOFFS_ID", "").strip()
    if not est or not house:
        sys.exit("estate or house pointer missing from the depot — nothing to cut.")

    src = api(S + est + "/values/" + urllib.parse.quote(f"'{SRC_TAB}'!A1:Z99999")).get("values") or []
    if len(src) < 2:
        sys.exit("the estate tracker answered (nearly) empty — refusing: broken read, not empty history.")
    src_hdr = [estate_key(h) for h in src[0]]
    want = ["timestamp", "employee_name", "date", "type", "how_late", "notes", "your_name"]
    missing = [w for w in want if w not in src_hdr]
    if missing:
        sys.exit(f"the tracker header no longer carries {missing} — decide the mapping before cutting.")
    idx = {w: src_hdr.index(w) for w in want}

    # deterministic ids so a re-run reconciles instead of duplicating
    seen_ids: dict[str, int] = {}
    out_rows = []
    for r in src[1:]:
        cells = {w: (str(r[idx[w]]) if idx[w] < len(r) else "") for w in want}
        if not any(v.strip() for v in cells.values()):
            continue
        basis = "|".join(cells[w] for w in ("timestamp", "employee_name", "date", "type"))
        rid = "CO_" + hashlib.sha1(basis.encode()).hexdigest()[:12]
        n = seen_ids.get(rid, 0) + 1
        seen_ids[rid] = n
        if n > 1:
            rid = f"{rid}-{n}"
        out_rows.append([rid, now, now] + [cells[w] for w in want])

    have_vals = api(S + house + "/values/" + urllib.parse.quote("'Data'!A1:B99999")).get("values") or []
    have_ids = {str(r[0]).strip() for r in have_vals[1:] if r and str(r[0]).strip()}
    fresh = [r for r in out_rows if r[0] not in have_ids]

    print(f"estate rows           : {len(src) - 1}")
    print(f"copyable (non-blank)  : {len(out_rows)}")
    print(f"already in the house  : {len(have_ids)}")
    print(f"NEW rows to land      : {len(fresh)}")

    if dry:
        print("\n--dry-run: nothing written.")
        return

    meta = api(S + house + "?fields=sheets.properties(title,sheetId,gridProperties)")
    for sh in meta.get("sheets", []):
        p = sh["properties"]
        if p["title"] == "Data":
            need = len(HEADER) - int(p["gridProperties"].get("columnCount", 0))
            if need > 0:
                api(S + house + ":batchUpdate", {"requests": [{
                    "appendDimension": {"sheetId": p["sheetId"],
                                        "dimension": "COLUMNS", "length": need}}]}, "POST")
            break
    api(S + house + "/values/" + urllib.parse.quote("'Data'!A1:J1") + "?valueInputOption=RAW",
        {"values": [HEADER]}, "PUT")

    for i in range(0, len(fresh), 1000):
        api(S + house + "/values/" + urllib.parse.quote("'Data'!A:J") +
            ":append?valueInputOption=RAW&insertDataOption=INSERT_ROWS",
            {"values": fresh[i:i + 1000]}, "POST")
        print(f"   landed {i + len(fresh[i:i + 1000])}/{len(fresh)}")

    back = api(S + house + "/values/" + urllib.parse.quote("'Data'!A1:A99999")).get("values") or []
    total = len(back) - 1
    if total != len(have_ids) + len(fresh):
        sys.exit(f"count MISMATCH after landing: house {total} vs expected {len(have_ids) + len(fresh)}")
    print(f"house verified at {total} row(s)")

    schema_val = json.dumps(HEADER, separators=(",", ":"))
    if depot.get(f"schema:{TAB}.header") != schema_val:
        api(S + ESSENCIAL_ID + "/values/" + urllib.parse.quote("'Facts'!A1") +
            ":append?valueInputOption=RAW&insertDataOption=INSERT_ROWS",
            {"values": [[f"schema.{TAB}.header", "__schema", schema_val, "",
                         f"schema:{TAB}.header", "", now, "flip-calloffs-cut", ""]]}, "POST")
        print("schema fact updated (the stub is history)")


if __name__ == "__main__":
    main()
