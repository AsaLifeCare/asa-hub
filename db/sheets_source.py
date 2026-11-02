"""The sheets read straight from Google (living-brain), shaped row by row as the copy has always held them."""
from __future__ import annotations

import collections
import json
import os
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime
from typing import Any, Optional

DRIVE = "https://www.googleapis.com/drive/v3/files"
SHEETS = "https://sheets.googleapis.com/v4/spreadsheets"
SCOPES = ["https://www.googleapis.com/auth/drive.readonly", "https://www.googleapis.com/auth/spreadsheets.readonly"]
KEY_FILE = os.getenv("HUB_DB_GOOGLE_SA_FILE", "/app/.sa-living-brain.json")
# the account the key acts as (domain-wide delegation), the relay keeper's own; unset, the key's own account
SUBJECT = os.getenv("HUB_DB_GOOGLE_SUBJECT", "").strip()
SHEET_MIME = "application/vnd.google-apps.spreadsheet"
# living-brain's quota is the relay's sheet sync's too: one refusal and the clone waits half an hour
BACKOFF_S = 1800.0


class Refused(Exception):
    """Google said no for now (quota or access); the book is tried again on a later pass."""


class Google:
    def __init__(self, key_file: str = KEY_FILE) -> None:
        self.key_file = key_file
        self.available = os.path.isfile(key_file)
        self._cred: Any = None
        self._lock = threading.Lock()
        self.quiet_until = 0.0

    def _token(self) -> str:
        with self._lock:
            if self._cred is None:
                from google.oauth2 import service_account
                self._cred = service_account.Credentials.from_service_account_file(self.key_file, scopes=SCOPES)
                if SUBJECT:
                    self._cred = self._cred.with_subject(SUBJECT)
            if not self._cred.valid:
                from google.auth.transport.requests import Request
                self._cred.refresh(Request())
            return str(self._cred.token)

    def _get(self, url: str, params: list[tuple[str, str]]) -> dict[str, Any]:
        if time.monotonic() < self.quiet_until:
            raise Refused("backing off after a refusal")
        req = urllib.request.Request(f"{url}?{urllib.parse.urlencode(params)}",
                                     headers={"Authorization": f"Bearer {self._token()}"})
        try:
            with urllib.request.urlopen(req, timeout=120) as res:
                return json.loads(res.read())
        except urllib.error.HTTPError as e:
            if e.code == 429 or e.code >= 500:
                self.quiet_until = time.monotonic() + BACKOFF_S
            if e.code in (403, 404, 429) or e.code >= 500:
                raise Refused(f"Google answered {e.code}") from e
            raise

    def modified(self) -> dict[str, tuple[str, datetime]]:
        """Every spreadsheet the account sees: id -> (name, modifiedTime)."""
        out: dict[str, tuple[str, datetime]] = {}
        page = ""
        while True:
            params = [("q", f"mimeType = '{SHEET_MIME}' and trashed = false"), ("pageSize", "1000"),
                      ("fields", "nextPageToken,files(id,name,modifiedTime)"), ("supportsAllDrives", "true"),
                      ("includeItemsFromAllDrives", "true"), ("corpora", "allDrives")]
            if page:
                params.append(("pageToken", page))
            got = self._get(DRIVE, params)
            for f in got.get("files") or []:
                out[f["id"]] = (f.get("name") or "", _ts(f.get("modifiedTime")))
            page = got.get("nextPageToken") or ""
            if not page:
                return out

    def book(self, sid: str, twins: bool = False) -> list[tuple[str, list[str], list[tuple[int, dict]]]]:
        """Every tab of one book: (tab, headers in sheet order, [(row_number, header -> text)]), owned: with twins."""
        meta = self._get(f"{SHEETS}/{urllib.parse.quote(sid)}", [("fields", "sheets.properties.title")])
        titles = [s["properties"]["title"] for s in meta.get("sheets") or []]
        if not titles:
            return []
        # the text the sheet shows, as the keeper and the mirror store theirs: a Date as its text, never a serial
        params = [("valueRenderOption", "FORMATTED_VALUE"), ("majorDimension", "ROWS")]
        params += [("ranges", "'" + t.replace("'", "''") + "'") for t in titles]
        got = self._get(f"{SHEETS}/{urllib.parse.quote(sid)}/values:batchGet", params)
        out = []
        for title, vr in zip(titles, got.get("valueRanges") or []):
            out.append((title, *shape(vr.get("values") or [], twins)))
        return out


def _ts(v: Any) -> datetime:
    return datetime.fromisoformat(str(v).replace("Z", "+00:00"))


def _looks_like_label(cell: Any) -> bool:
    if cell is None:
        return False
    s = str(cell).strip()
    if not s:
        return False
    if re.fullmatch(r"-?\d+(\.\d+)?", s):
        return False
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}.*)?", s):
        return False
    return bool(re.search(r"[A-Za-z]", s))


def detect_header(values: list[list]) -> tuple[Optional[int], list[str]]:
    """The first of eight rows with two filled cells, one of them a label; else none."""
    for i in range(min(len(values), 8)):
        row = values[i] or []
        filled = [c for c in row if c is not None and str(c).strip() != ""]
        if len(filled) < 2 or not any(_looks_like_label(c) for c in filled):
            continue
        last = max((j for j, c in enumerate(row) if c is not None and str(c).strip() != ""), default=-1)
        return i, [str(c).strip() for c in row[: last + 1]]
    return None, []


def twin_keys(header: list[str]) -> list[str]:
    """The keeper's rule for an owned book (hub_sheet_sync.twin_keys): a repeated name's last column keeps the name,
    each earlier one is "<name> ⟨n⟩"."""
    total = collections.Counter(h for h in header if h)
    seen: collections.Counter = collections.Counter()
    out = []
    for h in header:
        if h and total[h] > 1:
            seen[h] += 1
            out.append(h if seen[h] == total[h] else f"{h} ⟨{seen[h]}⟩")
        else:
            out.append(h)
    return out


def shape(values: list[list], twins: bool = False) -> tuple[list[str], list[tuple[int, dict]]]:
    """A tab's values as the copy keys them: the header row, then one header -> str(cell) map a row; twins keeps a
    repeated header's every column, as the keeper keys an owned book, where otherwise the last one wins."""
    if not values:
        return [], []
    at, header = detect_header(values)
    if at is None or not header:
        at, header = 0, [str(h).strip() for h in values[0]]
    if twins:
        header = twin_keys(header)
    keys = list(dict.fromkeys(h for h in header if h))
    rows = []
    for n, row in enumerate(values[at + 1:], start=at + 2):
        data = {h: (str(row[i]) if i < len(row) else "") for i, h in enumerate(header) if h}
        if data:
            rows.append((n, data))
    return keys, rows
