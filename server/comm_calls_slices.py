"""commCalls / commWorkItems slices, read from asa-hub-db's copy of their houses; they carry no words."""
from __future__ import annotations

import json
import os
from typing import Any

import hub_rows

RESOURCES = ("commCalls", "commWorkItems")

# named in full, never discovered; the env override is for a rehearsal estate only
COMM_CALLS_SHEET = (os.getenv("HUB_COMM_CALLS_SHEET_ID")
                    or "1ZMOjT2PokimmEraIWZE1k-XtQWZFpVGHPUaWZsEEcko")
COMM_WORK_ITEMS_SHEET = (os.getenv("HUB_COMM_WORK_ITEMS_SHEET_ID")
                         or "1kD83SUdMzK5uZAt0dNs4HGYx7v9MECNrJBroSenXpQY")

_TABS = {"commCalls": (COMM_CALLS_SHEET, "comm_calls", "call_at"),
         "commWorkItems": (COMM_WORK_ITEMS_SHEET, "comm_work_items", "source_call_at")}

SA_PATH = os.getenv("GOOGLE_SERVICE_ACCOUNT_JSON", "/app/service-account.json")
IMPERSONATE = os.getenv("GOOGLE_IMPERSONATE_USER", "jarvis@asalifecare.com")
SCOPES = ["https://www.googleapis.com/auth/spreadsheets.readonly"]


def _sheets_client():
    import base64
    from google.oauth2 import service_account
    from googleapiclient.discovery import build as gbuild
    raw = (SA_PATH or "").strip()
    info = None
    if raw.startswith("{"):
        info = json.loads(raw)
    elif not raw.startswith("/") and len(raw) > 512:
        try:
            info = json.loads(base64.b64decode(raw))
        except Exception:  # noqa: BLE001
            info = None
    if info is not None:
        base = service_account.Credentials.from_service_account_info(info, scopes=SCOPES)
    else:
        base = service_account.Credentials.from_service_account_file(raw, scopes=SCOPES)
    creds = base
    try:
        import google.auth.transport.requests as gtr
        probe = base.with_subject(IMPERSONATE)
        probe.refresh(gtr.Request())
        creds = probe
    except Exception:  # noqa: BLE001 — plain SA still sees shared books
        pass
    return gbuild("sheets", "v4", credentials=creds, cache_discovery=False)


def _from_house(sheet_id: str, tab: str) -> list[dict]:
    got = _sheets_client().spreadsheets().values().get(
        spreadsheetId=sheet_id, range=f"'{tab}'").execute()
    values = got.get("values") or []
    if len(values) < 2:
        return []
    header = [str(h).strip() for h in values[0]]
    rows = []
    for row in values[1:]:
        data = {h: (str(row[i]) if i < len(row) else "")
                for i, h in enumerate(header) if h}
        if any(v.strip() for v in data.values()):
            rows.append(data)
    return rows


def _from_mirror(dsn: str, sheet_id: str, tab: str) -> list[dict]:
    """The tab's rows in the sheet's order from asa-hub-db's copy, the blank ones left out as a read of the house
    leaves them."""
    return [dict(d) for d in hub_rows.rows(sheet_id, tab) if any(str(v or "").strip() for v in d.values())]


def build(resource: str, dsn: str) -> tuple[list[dict], str | None]:
    if resource not in RESOURCES:
        raise ValueError(f"Unknown resource {resource!r}")
    sheet_id, tab, order_field = _TABS[resource]
    # Python reads the sheets from asa-hub-db alone
    rows = _from_mirror(dsn, sheet_id, tab)
    rows.sort(key=lambda r: str(r.get(order_field) or ""), reverse=True)
    stamps = [str(r.get("source_at") or "") for r in rows if r.get("source_at")]
    return rows, (max(stamps) if stamps else None)


if __name__ == "__main__":
    import sys

    _dsn = os.getenv("HUB_SNAPSHOT_PG_DSN") or os.getenv("DATABASE_URL") or ""
    if not _dsn:
        sys.exit("HUB_SNAPSHOT_PG_DSN is not set")
    out: dict[str, Any] = {}
    for res in RESOURCES:
        got, at = build(res, _dsn)
        out[res] = {"rows": len(got), "source_at": at}
    print(json.dumps(out, indent=2, sort_keys=True))
