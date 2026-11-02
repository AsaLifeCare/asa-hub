#!/usr/bin/env python3
"""Index the Clients Drive corpus into client_files by drive_id; never moves, renames or deletes a file."""
from __future__ import annotations

import json
import re
import socket
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

_orig_gai = socket.getaddrinfo
socket.getaddrinfo = lambda h, *a, **k: sorted(   # noqa: E731 — v4 is blackholed here
    _orig_gai(h, *a, **k), key=lambda r: 0 if r[0] == socket.AF_INET6 else 1)

ENV_PATH = Path("/opt/docker/asa-hub/server/.tools.env")
SA_PATH = "/opt/docker/asa-hub/server/.service-account.json"
ESSENCIAL_ID = "1Y6UMJlCS5gHur52f0YrPsLSqwYlCA792I8gAiZsxsug"
CLIENTS_FOLDER = "1sm8RbpmYWlRCD6cVjRCTePZW8F5721xQ"
HOUSE_PTR = "switchboard:props.HUB_HOUSE_CLIENT_FILES_ID"
TAB = "client_files"
SOURCE_BOOK = "Clients (Drive)"
# folders that are not a person
SYSTEM_TOPS = ("0 - ", "Templates", "Leases", "Pictures", "House Documentation",
               "Potential New Clients")


def env(k: str) -> str:
    for line in ENV_PATH.read_text().splitlines():
        line = line.strip()
        if line.startswith(f"{k}="):
            return line.split("=", 1)[1].strip().strip("'\"")
    sys.exit(f"{k} not found in {ENV_PATH}")


def token() -> str:
    body = urllib.parse.urlencode({
        "client_id": env("GS_GOOGLE_CLIENT_ID"), "client_secret": env("GS_GOOGLE_CLIENT_SECRET"),
        "refresh_token": env("GS_GOOGLE_REFRESH_TOKEN"), "grant_type": "refresh_token"}).encode()
    req = urllib.request.Request("https://oauth2.googleapis.com/token", data=body, method="POST")
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)["access_token"]


TOK = token()
S = "https://sheets.googleapis.com/v4/spreadsheets/"


def api(url: str, payload: dict | None = None, method: str = "GET", tries: int = 6) -> dict:
    for a in range(tries):
        req = urllib.request.Request(url, method=method)
        req.add_header("Authorization", "Bearer " + TOK)
        data = json.dumps(payload).encode() if payload is not None else None
        if data:
            req.add_header("Content-Type", "application/json")
        try:
            with urllib.request.urlopen(req, data, timeout=300) as resp:
                raw = resp.read()
                return json.loads(raw) if raw else {}
        except Exception as err:
            if getattr(err, "code", 0) in (400, 403, 404) or a == tries - 1:
                raise
            time.sleep(5 * (a + 1))
    return {}


def drive():
    """The service account is the identity the folder was shared with."""
    from google.oauth2 import service_account
    from googleapiclient.discovery import build
    creds = service_account.Credentials.from_service_account_file(
        SA_PATH, scopes=["https://www.googleapis.com/auth/drive.readonly"])
    return build("drive", "v3", credentials=creds, cache_discovery=False)


def depot(source: str) -> str:
    rows = api(S + ESSENCIAL_ID + "/values/"
               + urllib.parse.quote("'Facts'!A2:I999999")).get("values") or []
    val = ""
    for r in rows:
        if len(r) > 4 and str(r[4]) == source:
            val = str(r[2]) if len(r) > 2 else ""
    return val.strip()


def walk(d, fid: str, path: str = "", depth: int = 0, out: list | None = None) -> list:
    out = [] if out is None else out
    tok = None
    while True:
        r = d.files().list(
            q=f"'{fid}' in parents and trashed=false",
            fields="nextPageToken,files(id,name,mimeType,size,modifiedTime,webViewLink)",
            pageSize=500, pageToken=tok,
            supportsAllDrives=True, includeItemsFromAllDrives=True).execute()
        for f in r.get("files", []):
            if f["mimeType"] == "application/vnd.google-apps.folder":
                if depth < 5:
                    walk(d, f["id"], path + "/" + f["name"], depth + 1, out)
            else:
                out.append((path, f))
        tok = r.get("nextPageToken")
        if not tok:
            break
    return out


def parts(path: str) -> list[str]:
    return [p for p in path.split("/") if p]


def client_and_drawer(path: str) -> tuple[str, str, str]:
    ps = parts(path)
    if not ps:
        return "", "", "root"
    top = ps[0]
    if top.startswith(SYSTEM_TOPS):
        # an inactive client sits one level deeper
        if top == "0 - Client Inactive" and len(ps) > 1:
            return ps[1], "/".join(ps[2:]), "inactive"
        return "", "/".join(ps[1:]) or top, top
    return top, "/".join(ps[1:]), "active"


_MONTHS = {m.lower(): i for i, m in enumerate(
    ["January", "February", "March", "April", "May", "June", "July",
     "August", "September", "October", "November", "December"], start=1)}
for _m in list(_MONTHS):
    _MONTHS[_m[:3]] = _MONTHS[_m]


def file_date(name: str) -> str:
    """The date the filename states, ISO; never invented."""
    def ok(y, mo, d):
        return f"{y:04d}-{mo:02d}-{min(d, 28) if mo == 2 else d:02d}" if 1 <= mo <= 12 and 1 <= d <= 31 and 2000 <= y <= 2100 else ""
    m = re.search(r"\b(\d{1,2})[_\-/.](\d{1,2})[_\-/.](20\d{2})\b", name)
    if m:
        return ok(int(m.group(3)), int(m.group(1)), int(m.group(2)))
    m = re.search(r"\b(\d{1,2})\.(\d{1,2})\.(\d{2})\b", name)
    if m:
        return ok(2000 + int(m.group(3)), int(m.group(1)), int(m.group(2)))
    m = re.search(r"\b(20\d{2})[-_](\d{1,2})[-_](\d{1,2})\b", name)
    if m:
        return ok(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    m = re.search(r"(20\d{2})\s+([A-Za-z]+)", name)
    if m and m.group(2).lower() in _MONTHS:
        return ok(int(m.group(1)), _MONTHS[m.group(2).lower()], 1)
    m = re.search(r"([A-Za-z]+)\s+(20\d{2})", name)
    if m and m.group(1).lower() in _MONTHS:
        return ok(int(m.group(2)), _MONTHS[m.group(1).lower()], 1)
    return ""


def fl_key(name: str) -> str:
    toks = re.sub(r"[^a-z ]+", "", str(name or "").lower()).split()
    return f"{toks[0]}_{toks[-1]}" if len(toks) >= 2 else (toks[0] if toks else "")


def roster(house_isps: str) -> dict[str, str]:
    out: dict[str, str] = {}
    if not house_isps:
        return out
    vals: list = []
    # the tab is named after the resource or 'Data'; a missing tab throws
    for tab in ("isps", "Data"):
        try:
            vals = api(S + house_isps + "/values/"
                       + urllib.parse.quote(f"'{tab}'!A1:Z9999")).get("values") or []
            if vals:
                break
        except Exception:  # noqa: BLE001 — try the other name
            continue
    try:
        hdr = [h.strip() for h in vals[0]]
        ci, ck = hdr.index("client_name"), hdr.index("client_key")
        for r in vals[1:]:
            nm = r[ci] if ci < len(r) else ""
            key = r[ck] if ck < len(r) else ""
            if nm and key:
                out[fl_key(nm)] = key
    except Exception as exc:  # noqa: BLE001 — a blank key is honest
        print(f"  (roster unavailable: {str(exc)[:80]})")
    return out


def col_a1(i: int) -> str:
    out = ""
    while i >= 0:
        out = chr(ord("A") + i % 26) + out
        i = i // 26 - 1
    return out


def main() -> None:
    dry = "--dry-run" in sys.argv
    house = depot(HOUSE_PTR)
    if not house:
        sys.exit("no HUB_HOUSE_CLIENT_FILES_ID pointer in the depot — flip the tab first.")
    isp_house = depot("switchboard:props.HUB_HOUSE_ISPS_ID")
    names = roster(isp_house)
    print(f"house {house[:14]}… · roster {len(names)} client key(s)")

    # The walk is cached: 4,500 files is minutes of Drive calls.
    cache = Path("/tmp/asa-hub-tools/client_docs_walk.json")
    if cache.exists() and "--refresh" not in sys.argv:
        found = [(p, f) for p, f in json.loads(cache.read_text())]
        print(f"corpus: {len(found)} file(s) (cached — --refresh to re-walk)")
    else:
        found = walk(drive(), CLIENTS_FOLDER)
        cache.parent.mkdir(parents=True, exist_ok=True)
        cache.write_text(json.dumps(found))
        print(f"corpus: {len(found)} file(s) (walked)")

    # Narrow reads only: the house holds OCR text and a full-width read times out.
    hdr = [h.strip() for h in api(S + house + "/values/"
           + urllib.parse.quote(f"'{TAB}'!A1:AZ1")).get("values", [[]])[0]]
    idx = {h: i for i, h in enumerate(hdr)}
    dcol = col_a1(idx["drive_id"])
    col = api(S + house + "/values/"
              + urllib.parse.quote(f"'{TAB}'!{dcol}2:{dcol}100000")).get("values") or []
    have: dict[str, int] = {}
    for n, r in enumerate(col, start=2):
        if r and str(r[0]).strip():
            have[str(r[0]).strip()] = n
    print(f"already indexed: {len(have)}")

    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    fresh: list[list[str]] = []
    updates: list[dict] = []
    stats = {"active": 0, "inactive": 0, "other": 0, "keyed": 0}
    for path, f in found:
        client, drawer, area = client_and_drawer(path)
        stats[area if area in ("active", "inactive") else "other"] += 1
        key = names.get(fl_key(client), "") if client else ""
        if key:
            stats["keyed"] += 1
        row = {
            "id": "CDOC_" + f["id"][:20], "createdAt": now, "updatedAt": now,
            "client_key": key, "client_name": client,
            "title": f["name"][:250], "kind": f["mimeType"].split(".")[-1].split("/")[-1],
            "folder": drawer or area, "file_date": file_date(f["name"]),
            "drive_id": f["id"], "url": f.get("webViewLink", ""),
            "source_book": SOURCE_BOOK,
            "size_bytes": str(f.get("size", "") or ""),
            "modified_time": str(f.get("modifiedTime", "") or ""),
            "mime_type": f["mimeType"],
            "digest_state": "pending",
        }
        at = have.get(f["id"])
        if at:
            # refresh the file's facts; never touch a digest verdict
            for c in ("client_key", "client_name", "title", "kind", "folder",
                      "file_date", "url", "source_book", "size_bytes",
                      "modified_time", "mime_type", "updatedAt"):
                if c in idx:
                    updates.append({"range": f"'{TAB}'!{col_a1(idx[c])}{at}",
                                    "values": [[row[c] if c != "updatedAt" else now]]})
        else:
            fresh.append([row.get(h, "") for h in hdr])

    print(f"active {stats['active']} · inactive {stats['inactive']} · other {stats['other']}"
          f" · with a client_key {stats['keyed']}")
    print(f"NEW rows {len(fresh)} · refreshed cells {len(updates)}")
    if dry:
        print("--dry-run: nothing written.")
        return

    for i in range(0, len(fresh), 250):
        api(S + house + "/values/" + urllib.parse.quote(f"'{TAB}'!A:A")
            + ":append?valueInputOption=RAW&insertDataOption=INSERT_ROWS",
            {"values": fresh[i:i + 250]}, "POST")
        print(f"   landed {min(i + 250, len(fresh))}/{len(fresh)}", flush=True)
    for i in range(0, len(updates), 400):
        api(S + house + "/values:batchUpdate",
            {"valueInputOption": "RAW", "data": updates[i:i + 400]}, "POST")

    back = api(S + house + "/values/" + urllib.parse.quote(f"'{TAB}'!A2:A100000")).get("values") or []
    print(f"house now holds {len(back)} row(s)")


if __name__ == "__main__":
    main()
