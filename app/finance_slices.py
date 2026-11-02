"""Finance slices, read-only: the old platform owns every write to asa_finance_doc and asa_finance_summary."""
from __future__ import annotations

import lanes_pg as psycopg2

RESOURCES = ("finances", "financeSummary")

_TABLE = "asa_finance_doc"
_SUMMARY_TABLE = "asa_finance_summary"


def _build(dsn: str) -> tuple[list[dict], str | None]:
    """Order must match the old platform's read_tab: priced before unpriced, largest first."""
    with psycopg2.connect(dsn) as conn, conn.cursor(
        cursor_factory=psycopg2.extras.RealDictCursor
    ) as cur:
        cur.execute(f"""
            SELECT drive_file_id, subfolder, name, mime, size_bytes,
                   web_view_link, vendor, doc_date, amount, currency,
                   category, method, modified_time, extracted_at
              FROM {_TABLE}
             ORDER BY subfolder, (amount IS NULL), amount DESC NULLS LAST, name""")
        rows = cur.fetchall()
    out: list[dict] = []
    for r in rows:
        amount = r.get("amount")
        extracted_at = r.get("extracted_at")
        out.append({
            "id": str(r.get("drive_file_id") or ""),
            "folder": str(r.get("subfolder") or ""),
            "name": str(r.get("name") or ""),
            "mime": str(r.get("mime") or ""),
            "size_bytes": int(r.get("size_bytes") or 0),
            "web_view_link": str(r.get("web_view_link") or ""),
            "vendor": str(r.get("vendor") or ""),
            "doc_date": str(r.get("doc_date") or ""),
            # the OCR lane's NUMERIC carries float noise; only the cents mean anything
            "amount": round(float(amount), 2) if amount is not None else None,
            "currency": str(r.get("currency") or "USD"),
            "category": str(r.get("category") or ""),
            "method": str(r.get("method") or ""),
            "modified_time": str(r.get("modified_time") or ""),
            "extracted_at": extracted_at.isoformat() if extracted_at else "",
        })
    return out, None


def _build_summary(dsn: str) -> tuple[list[dict], str | None]:
    with psycopg2.connect(dsn) as conn, conn.cursor(
        cursor_factory=psycopg2.extras.RealDictCursor
    ) as cur:
        cur.execute(
            f"SELECT id, payload, computed_at FROM {_SUMMARY_TABLE} WHERE id = 'company'")
        row = cur.fetchone()
    if not row or not isinstance(row.get("payload"), dict):
        return [], None
    out = dict(row["payload"])
    out["id"] = str(row.get("id") or "company")
    computed_at = row.get("computed_at")
    out["computed_at"] = computed_at.isoformat() if computed_at else ""
    return [out], None


def build(resource: str, dsn: str) -> tuple[list[dict], str | None]:
    if resource not in RESOURCES:
        raise KeyError(resource)
    if resource == "financeSummary":
        return _build_summary(dsn)
    return _build(dsn)
