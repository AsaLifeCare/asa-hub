"""Invoice catalog slice, read-only; stamped at read time, since max(updated_at) would look stale forever."""
from __future__ import annotations

import lanes_pg as psycopg2

RESOURCES = ("invoices",)

_TABLE = "asa_invoice_catalog"


def _build(dsn: str) -> tuple[list[dict], str | None]:
    with psycopg2.connect(dsn) as conn, conn.cursor(
        cursor_factory=psycopg2.extras.RealDictCursor
    ) as cur:
        cur.execute(f"""
            SELECT file_uid, source, topic, name, web_view_link,
                   record_type, kind, category, matched_by, invoice_no,
                   amount, amount_raw, doc_date, vendor
              FROM {_TABLE}
             ORDER BY (amount IS NULL), amount DESC, topic, name""")
        rows = cur.fetchall()
    out: list[dict] = []
    for r in rows:
        amount = r.get("amount")
        out.append({
            "id": str(r.get("file_uid") or ""),
            "name": str(r.get("name") or ""),
            "kind": str(r.get("kind") or ""),
            "category": str(r.get("category") or ""),
            "vendor": str(r.get("vendor") or ""),
            "invoice_no": str(r.get("invoice_no") or ""),
            # OCR writes leave float noise; only the cents mean anything.
            "amount": round(float(amount), 2) if amount is not None else None,
            "amount_raw": str(r.get("amount_raw") or ""),
            "doc_date": str(r.get("doc_date") or ""),
            "topic": str(r.get("topic") or ""),
            "record_type": str(r.get("record_type") or ""),
            "web_view_link": str(r.get("web_view_link") or ""),
        })
    return out, None


def build(resource: str, dsn: str) -> tuple[list[dict], str | None]:
    if resource not in RESOURCES:
        raise KeyError(resource)
    return _build(dsn)
