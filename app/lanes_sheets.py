"""The sheets the scheduling lanes read, off asa-hub-db (hubdb), in the shape the relay's mirror handed them: each
row's {header: text} in sheet order, the depot's Facts, and whether a book's copy is current. And the one writer's
road to the house calendars workbook: the Sheets API as the relay's service account, over google-auth."""
from __future__ import annotations

import base64
import json
import os
import re
import threading
from datetime import datetime, timezone
from typing import Any
from urllib.parse import quote

import house_tables as HT
import hubdb
import locations as L

ESSENCIAL_ID = hubdb.ESSENCIAL_ID
FACTS_TAB = hubdb.FACTS_TAB


def _db() -> Any:
    return hubdb.shared()


def rows(sheet_id: str, tab: str) -> list[tuple[int, dict[str, Any]]]:
    """(row number, {header: text}) of one tab in sheet order; none when asa-hub-db holds no such tab; a house kept in
    its own table read there."""
    db = _db()
    ref = HT.book_tab(L.Reads(db, None), str(sheet_id), str(tab)) if sheet_id and tab else None
    return [(rn, dict(raw)) for rn, raw in db.rows(ref)] if ref is not None else []


def data(sheet_id: str, tab: str) -> list[dict[str, Any]]:
    return [d for _rn, d in rows(sheet_id, tab)]


def facts_held() -> bool:
    """Whether the depot's Facts are in asa-hub-db at all."""
    return _db().tab(ESSENCIAL_ID, FACTS_TAB) is not None


def fact(subject: str) -> str:
    """The depot's Value for a Subject ID, '' when none is declared."""
    if not facts_held():
        raise hubdb.Unreadable("the depot's Facts are not in asa-hub-db")
    return str(_db().facts()["subjects"].get(str(subject or "").strip()) or "").strip()


def switch_prop(key: str) -> str:
    """The value the switchboard's props declare for a key (Source switchboard:props.<key>), '' when none."""
    if not facts_held():
        raise hubdb.Unreadable("the depot's Facts are not in asa-hub-db")
    return str((_db().facts()["areas"].get("props") or {}).get(str(key or "")) or "").strip()


def house_rows(tab: str) -> tuple[list[dict[str, Any]], str]:
    """behavior_slices._rows_for: the declared house's Data rows, else the freshest book carrying the tab by name."""
    want = "HUB_HOUSE_" + str(tab).upper() + "_ID"
    try:
        house = " ".join(fact(want).split())[:60]
    except Exception:  # noqa: BLE001 - the depot unread declares no house, as the mirror's read did
        house = ""
    if house:
        got = data(house, "Data")
        if got:
            return got, house
    held = [ref for (sid, name), ref in _db().catalog()["tabs"].items() if name == tab and ref.row_count > 0]
    if not held:
        return [], ""
    best = max(held, key=lambda r: hubdb._epoch(r.loaded_at))  # noqa: SLF001
    return data(best.sheet_id, tab), best.sheet_id


def _stamp(epoch: float) -> str:
    return datetime.fromtimestamp(epoch, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def as_of(sheet_id: str) -> str:
    """When asa-hub-db's copy of the book is known to hold what the book held; '' when it holds no such book."""
    db = _db()
    if not sheet_id or db.book(sheet_id) is None:
        return ""
    return _stamp(db.as_of({sheet_id}))


def verified(sheet_id: str) -> bool:
    """The copy holds the book and nothing changed it since."""
    db = _db()
    return bool(sheet_id) and db.book(sheet_id) is not None and not db.stale({sheet_id})


def now_stamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def user_row(sheet_id: str, uid: str) -> dict[str, Any] | None:
    """The users tab's row for an account id, as the mirror's data->>'user_id' = uid found it."""
    want = str(uid or "")
    for d in data(sheet_id, "users"):
        if _text(d.get("user_id")) == want:
            return d
    return None


def _text(v: Any) -> str:
    """What data->>key gave for a cell."""
    if v is None:
        return ""
    if isinstance(v, str):
        return v
    if isinstance(v, bool):
        return "true" if v else "false"
    return json.dumps(v, ensure_ascii=False)


text = _text


# ---- the house calendars workbook, written as the relay writes it ----------------------------------------------------

SA_RAW = os.getenv("GOOGLE_SERVICE_ACCOUNT_JSON", "/app/service-account.json")
IMPERSONATE = os.getenv("GOOGLE_IMPERSONATE_USER", "jarvis@asalifecare.com")
SHEETS = "https://sheets.googleapis.com/v4/spreadsheets"
TIMEOUT_S = float(os.getenv("HUB_LANES_SHEETS_TIMEOUT_S", "60"))


class HttpError(RuntimeError):
    """The Sheets API said no; the status only, never the body (it can quote the request)."""


def _info() -> dict[str, Any] | None:
    raw = (SA_RAW or "").strip()
    if raw.startswith("{"):
        return json.loads(raw)
    if not raw.startswith("/") and len(raw) > 512:
        try:
            return json.loads(base64.b64decode(raw))
        except Exception:  # noqa: BLE001 - not base64 after all; read as a path
            return None
    return None


def credentials(scopes: list[str], *, impersonate: bool = True) -> Any:
    """The service account's credentials; as the impersonated user when the domain lets it, else plain."""
    from google.oauth2 import service_account  # noqa: PLC0415 - only a real write reaches here
    info = _info()
    base = (service_account.Credentials.from_service_account_info(info, scopes=scopes) if info is not None
            else service_account.Credentials.from_service_account_file(SA_RAW.strip(), scopes=scopes))
    if not impersonate:
        return base
    try:
        import google.auth.transport.requests as gtr  # noqa: PLC0415
        probe = base.with_subject(IMPERSONATE)
        probe.refresh(gtr.Request())
        return probe
    except Exception:  # noqa: BLE001 - plain SA still sees shared books
        return base


class _Call:
    def __init__(self, fn: Any) -> None:
        self._fn = fn

    def execute(self) -> Any:
        return self._fn()


class _Values:
    def __init__(self, svc: "Service") -> None:
        self._svc = svc

    def get(self, spreadsheetId: str = "", range: str = "", **params: Any) -> _Call:  # noqa: A002, N803
        return _Call(lambda: self._svc._ask("GET", f"/{spreadsheetId}/values/{quote(range, safe='')}", params))

    def batchUpdate(self, spreadsheetId: str = "", body: dict | None = None, **params: Any) -> _Call:  # noqa: N802
        return _Call(lambda: self._svc._ask("POST", f"/{spreadsheetId}/values:batchUpdate", params, body))

    def append(self, spreadsheetId: str = "", range: str = "", body: dict | None = None,  # noqa: A002, N803
               **params: Any) -> _Call:
        return _Call(lambda: self._svc._ask("POST", f"/{spreadsheetId}/values/{quote(range, safe='')}:append",
                                            params, body))

    def update(self, spreadsheetId: str = "", range: str = "", body: dict | None = None,  # noqa: A002, N803
               **params: Any) -> _Call:
        return _Call(lambda: self._svc._ask("PUT", f"/{spreadsheetId}/values/{quote(range, safe='')}", params, body))


class _Sheets:
    def __init__(self, svc: "Service") -> None:
        self._svc = svc

    def get(self, spreadsheetId: str = "", **params: Any) -> _Call:  # noqa: N803
        return _Call(lambda: self._svc._ask("GET", f"/{spreadsheetId}", params))

    def batchUpdate(self, spreadsheetId: str = "", body: dict | None = None, **params: Any) -> _Call:  # noqa: N802
        return _Call(lambda: self._svc._ask("POST", f"/{spreadsheetId}:batchUpdate", params, body))

    def values(self) -> _Values:
        return _Values(self._svc)


class Service:
    """The part of googleapiclient's Sheets service the lanes call: spreadsheets().get/batchUpdate and its values()'
    get/batchUpdate/append/update, each .execute()d."""

    def __init__(self, creds: Any) -> None:
        self._creds = creds
        self._lock = threading.Lock()
        self._session: Any = None

    def spreadsheets(self) -> _Sheets:
        return _Sheets(self)

    def _ask(self, method: str, path: str, params: dict[str, Any], body: Any = None) -> dict[str, Any]:
        from google.auth.transport.requests import AuthorizedSession  # noqa: PLC0415
        with self._lock:
            if self._session is None:
                self._session = AuthorizedSession(self._creds)
            session = self._session
        query = {k: v for k, v in params.items() if v is not None}
        res = session.request(method, SHEETS + path, params=query, json=body, timeout=TIMEOUT_S)
        if res.status_code // 100 != 2:
            raise HttpError(f"the Sheets API answered {res.status_code}")
        return res.json() if res.content else {}


def sheets_service(scopes: list[str] | None = None, *, impersonate: bool = True) -> Service:
    return Service(credentials(scopes or ["https://www.googleapis.com/auth/spreadsheets"], impersonate=impersonate))


def fold_key(name: Any) -> str:
    """regexp_replace(lower(name), '[^a-z0-9]+', '', 'g')"""
    return re.sub(r"[^a-z0-9]+", "", str(name or "").lower())
