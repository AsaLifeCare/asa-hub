"""The relay's record doors (/inventory/meds, /inventory/supplies, /clients/meds, /shopper/purchases, /finance/analytics,
/finance/history, /finance/docs) answered here in its words: the records the old platform kept (the pharmacy's
dispensing reports, the purchase catalog, the ISP texts, the medication pictures and MARS readings, the card ledger,
the finance papers' index), the Hub's own in asa-hub-db since 2026-10-27 (db/lane_tables.sql, read through
mw_relay_state.query), and the eMAR's medication list from asa-hub-db."""
from __future__ import annotations

import json
import logging
import re
from typing import Any, Callable

from fastapi import Request
from fastapi.responses import Response
from starlette.concurrency import run_in_threadpool

import mw_relay_state as RS
import service_doors as SD

log = logging.getLogger("asa-hub-app.service-records")

NO_MIRROR = {"status": 503, "message": "no PG mirror configured"}
# the eMAR book's medication list
EMAR_BOOK, EMAR_TAB = "1epBvwaEn-m-JRG9NCMw0QIQdq3zUwJf4L4QgE027jxI", "EmarData"
EMAR_COLUMNS = ("client", "prescriptionname", "dosage", "administrationtimes", "medtype", "prn", "med_pictures")


TABLES = ("asa_med_deliveries", "asa_invoice_catalog", "asa_isp_chat", "asa_med_pictures", "asa_client_meds",
          "asa_client_financial_txns", "asa_finance_doc")


def configured() -> bool:
    """Whether the records are readable here at all: asa-hub-db holds them since 2026-10-27 (db/lane_tables.sql)."""
    return True


def ready() -> bool:
    """Blocking, once at install: the read-only role holds SELECT on every table these doors read; anything else, a
    table missing or the database not answering included, leaves the doors unregistered."""
    schema = "app." if RS.CONNECT[0] is None else "public."
    try:
        for table in TABLES:
            got = rows("select has_table_privilege(%s, 'SELECT') as ok", [schema + table])
            if not got or got[0].get("ok") is not True:
                return False
        return True
    except Exception:  # noqa: BLE001 - fail closed
        return False
    finally:
        # the install thread holds no connection past its check
        RS._drop()


def rows(sql: str, args: Any = None) -> list[dict[str, Any]]:
    """Blocking: one read-only query written for the old platform's database, read on asa-hub-db (mw_relay_state)."""
    return RS.query(sql, args)


async def _door(request: Request, read: Callable[[dict[str, Any]], dict[str, Any]]) -> Response:
    """The relay's write guard, the body, the service secret, the database; then the read, off the event loop."""
    refused = await SD.write_refusal(request)
    if refused is not None:
        return refused
    body = await SD.body_of(request)
    if body is None:
        return SD.said({"status": 400, "message": "invalid body"})
    if not SD.secret_ok(body):
        return SD.said({"status": 401, "message": "service identity required"})
    if not configured():
        return SD.said(dict(NO_MIRROR))
    return SD.said(await run_in_threadpool(read, body))


# ---- the pharmacy's stock record and the purchases (Inventory, Smart Shopper) -----------------------------------------

def inventory_meds_env() -> dict[str, Any]:
    """Blocking: the pharmacy's stock record as /inventory/meds answers it (the Inventory's own door is handed it)."""
    if not configured():
        return dict(NO_MIRROR)
    try:
        got = rows("SELECT DISTINCT ON (house) house, file_date, period_start, period_end, meds_json"
                   " FROM asa_med_deliveries ORDER BY house, file_date DESC")
    except Exception as exc:  # noqa: BLE001
        log.warning("inventory/meds: pg failed (%s)", type(exc).__name__)
        return {"status": 502, "message": f"pharmacy record unreadable ({type(exc).__name__})"}
    houses = []
    for r in got:
        meds = r.get("meds_json") or []
        if isinstance(meds, str):
            try:
                meds = json.loads(meds)
            except Exception:  # noqa: BLE001
                meds = []
        houses.append({
            "house": str(r.get("house") or ""),
            "file_date": str(r.get("file_date") or ""),
            "period_start": str(r.get("period_start") or ""),
            "period_end": str(r.get("period_end") or ""),
            "meds": [{"client": str(m.get("client") or ""), "drug": str(m.get("drug") or ""), "qty": m.get("qty"),
                      "remaining": m.get("remaining"), "sig": str(m.get("sig") or "")[:160]}
                     for m in meds if isinstance(m, dict)],
        })
    return {"status": 200, "data": {"houses": houses}}


def shopper_purchases_env() -> dict[str, Any]:
    """Blocking: the priced purchases as /shopper/purchases answers them (Smart Shopper's own door is handed them)."""
    if not configured():
        return dict(NO_MIRROR)
    try:
        got = rows("SELECT name, vendor, category, kind, amount, doc_date, web_view_link FROM asa_invoice_catalog"
                   " WHERE record_type = 'purchase' AND amount IS NOT NULL"
                   " ORDER BY (category = 'supplies_retail') DESC, updated_at DESC LIMIT 100")
    except Exception as exc:  # noqa: BLE001
        log.warning("shopper/purchases: pg failed (%s)", type(exc).__name__)
        return {"status": 502, "message": f"purchase record unreadable ({type(exc).__name__})"}
    purchases = [{
        "name": str(r.get("name") or ""),
        "vendor": str(r.get("vendor") or ""),
        "category": str(r.get("category") or ""),
        "kind": str(r.get("kind") or ""),
        "amount": float(r["amount"]) if r.get("amount") is not None else None,
        "doc_date": str(r.get("doc_date") or ""),
        "link": str(r.get("web_view_link") or ""),
    } for r in got]
    return {"status": 200, "data": {"purchases": purchases}}


def inventory_supplies(_body: dict[str, Any]) -> dict[str, Any]:
    """The company's purchased goods, by category and vendor."""
    try:
        got = rows("SELECT file_uid, name, vendor, category, kind, invoice_no, amount, doc_date, web_view_link,"
                   " updated_at FROM asa_invoice_catalog WHERE record_type = 'purchase' ORDER BY updated_at DESC")
    except Exception as exc:  # noqa: BLE001
        log.warning("inventory/supplies: pg failed (%s)", type(exc).__name__)
        return {"status": 502, "message": f"procurement catalog unreadable ({type(exc).__name__})"}
    items = []
    by_cat: dict[str, dict[str, Any]] = {}
    by_vendor: dict[str, dict[str, Any]] = {}
    total_spend = 0.0
    for r in got:
        amount = float(r["amount"]) if r.get("amount") is not None else None
        cat = str(r.get("category") or "uncategorized")
        vendor = str(r.get("vendor") or "")
        updated = str(r.get("updated_at") or "")
        if amount:
            total_spend += amount
        c = by_cat.setdefault(cat, {"category": cat, "count": 0, "spend": 0.0, "last": ""})
        c["count"] += 1
        if amount:
            c["spend"] += amount
        if updated > c["last"]:
            c["last"] = updated
        if vendor:
            v = by_vendor.setdefault(vendor, {"vendor": vendor, "count": 0, "spend": 0.0})
            v["count"] += 1
            if amount:
                v["spend"] += amount
        if len(items) < 300:
            items.append({"id": str(r.get("file_uid") or ""), "name": str(r.get("name") or ""), "vendor": vendor,
                          "category": cat, "kind": str(r.get("kind") or ""),
                          "invoice_no": str(r.get("invoice_no") or ""), "amount": amount,
                          "doc_date": str(r.get("doc_date") or ""), "link": str(r.get("web_view_link") or ""),
                          "updated_at": updated})
    cats = sorted(by_cat.values(), key=lambda c: -c["count"])
    vendors = sorted(by_vendor.values(), key=lambda v: -v["count"])[:15]
    return {"status": 200, "data": {"items": items, "categories": cats, "vendors": vendors,
                                    "purchase_count": len(got), "total_spend": round(total_spend, 2)}}


# ---- every client's medications (the Medications app): the ISP first, the eMAR, then MARS ----------------------------

def _norm_head(h: Any) -> str:
    return re.sub(r"[^a-z0-9]+", "_", str(h).strip().lower()).strip("_")


def emar_rows(reads: Any) -> list[dict[str, Any]]:
    """The eMAR's medications not discontinued, by the columns the relay's copy of the sheet names."""
    import hubdb  # noqa: PLC0415

    ref = reads.db.tab(EMAR_BOOK, EMAR_TAB)
    if ref is None:
        raise hubdb.Unreadable("asa-hub-db holds no copy of the eMAR's medication list")
    cols = {_norm_head(h): h for h in ref.headers}
    stop = cols.get("discountinued")
    out = []
    for _rn, raw in reads.db.rows(ref):
        if stop is not None and str(raw.get(stop) or "") != "":
            continue
        out.append({k: raw.get(cols[k]) if k in cols else None for k in EMAR_COLUMNS})
    return out


def clients_meds(_body: dict[str, Any]) -> dict[str, Any]:
    try:
        isp = rows("SELECT client_name, isp_year, medications FROM asa_isp_chat ORDER BY client_name")
        emar = SD.with_reads(emar_rows)
        pics = rows("SELECT client, med_name, dosage, picture_url FROM asa_med_pictures")
        mars = rows("SELECT client_name, med_name, dose, freq, source_doc FROM asa_client_meds")
    except Exception as exc:  # noqa: BLE001
        log.warning("clients/meds: pg failed (%s)", type(exc).__name__)
        return {"status": 502, "message": f"medication record unreadable ({type(exc).__name__})"}

    def _k(name: Any) -> str:
        return re.sub(r"\s+", " ", str(name or "").strip()).lower()

    def _first_url(v: Any) -> str:
        m = re.search(r"https://\S+", str(v or ""))
        return m.group(0).rstrip("]") if m else ""

    # photos by (client, drug): the catalog fills the gaps the eMAR column leaves
    pic_by = {(_k(p["client"]), _k(p["med_name"])): str(p.get("picture_url") or "") for p in pics}
    clients: dict[str, dict[str, Any]] = {}
    for r in isp:
        key = _k(r["client_name"])
        if not key:
            continue
        clients[key] = {"client": str(r["client_name"]).strip(), "isp_year": str(r.get("isp_year") or ""),
                        "isp_text": str(r.get("medications") or "")[:4000], "meds": []}
    for r in emar:
        key = _k(r["client"])
        if not key:
            continue
        c = clients.setdefault(key, {"client": str(r["client"]).strip(), "isp_year": "", "isp_text": "", "meds": []})
        name = str(r.get("prescriptionname") or "").strip()
        if not name:
            continue
        times = re.findall(r"\d{3,4}", str(r.get("administrationtimes") or ""))
        prn_txt = str(r.get("prn") or "")
        c["meds"].append({
            "name": name,
            "dose": str(r.get("dosage") or "").strip(),
            "route": str(r.get("medtype") or "").strip(),
            "times": [t.zfill(4)[:2] + ":" + t.zfill(4)[2:] for t in times],
            "prn": bool(re.search(r"prn|as needed", prn_txt, re.I)),
            "freq": prn_txt.strip(),
            "image": _first_url(r.get("med_pictures")) or pic_by.get((key, _k(name)), ""),
            "source": "emar",
        })
    # MARS fills the clients the eMAR does not cover
    for r in mars:
        key = _k(r["client_name"])
        if not key:
            continue
        c = clients.setdefault(key, {"client": str(r["client_name"]).strip(), "isp_year": "", "isp_text": "",
                                     "meds": []})
        if any(m["source"] == "emar" for m in c["meds"]):
            continue
        name = str(r.get("med_name") or "").strip()
        if not name or any(_k(m["name"]) == _k(name) for m in c["meds"]):
            continue
        c["meds"].append({"name": name, "dose": str(r.get("dose") or "").strip(), "route": "", "times": [],
                          "prn": False, "freq": str(r.get("freq") or "").strip(),
                          "image": pic_by.get((key, _k(name)), ""), "source": "mars"})
    out = sorted(clients.values(), key=lambda c: c["client"].lower())
    return {"status": 200, "data": {"clients": out}}


# ---- Client Finances: the old platform's rollups of the card ledger, its history and the papers' index ---------------

def _fin_norm_vendor(v: Any) -> str:
    return re.sub(r"[^a-z0-9]", "", str(v or "").lower())


def finance_analytics(body: dict[str, Any]) -> dict[str, Any]:
    client = str(body.get("client") or "").strip()
    months = int(body.get("months") or 0)
    conds = ["TRUE"]
    args: list[Any] = []
    if client:
        conds.append("lower(client_name) = lower(%s)")
        args.append(client)
    if months > 0:
        conds.append("txn_dt >= (CURRENT_DATE - INTERVAL '%d months')" % months)
    where = "WHERE " + " AND ".join(conds)
    try:
        k = (rows(f"""SELECT count(*) txns, count(DISTINCT client_name) clients,
            COALESCE(abs(sum(amount) FILTER (WHERE amount<0)),0) spent,
            COALESCE(sum(amount) FILTER (WHERE amount>0),0) deposits,
            COALESCE(sum(amount),0) net, count(*) FILTER (WHERE amount<0) spend_cnt
            FROM asa_client_financial_txns {where}""", args) or [{}])[0]
        spent = float(k.get("spent") or 0)
        sc_ = int(k.get("spend_cnt") or 0)
        kpis = {"txns": int(k.get("txns") or 0), "clients": int(k.get("clients") or 0), "spent": spent,
                "deposits": float(k.get("deposits") or 0), "net": float(k.get("net") or 0),
                "avgTxn": round(spent / sc_, 2) if sc_ else 0}
        by_fund = [{"fund": r["fund_type"] or "Debit Card", "count": r["c"], "spent": float(r["spent"]),
                    "deposits": float(r["deposits"])}
                   for r in rows(f"""SELECT fund_type, count(*) c,
            COALESCE(abs(sum(amount) FILTER (WHERE amount<0)),0) spent,
            COALESCE(sum(amount) FILTER (WHERE amount>0),0) deposits
            FROM asa_client_financial_txns {where} GROUP BY 1 ORDER BY spent DESC""", args)]
        by_cat = [{"category": r["category"], "count": r["c"], "spent": float(r["spent"])}
                  for r in rows(f"""SELECT category, count(*) c,
            COALESCE(abs(sum(amount) FILTER (WHERE amount<0)),0) spent
            FROM asa_client_financial_txns {where} AND COALESCE(category,'')<>''
            GROUP BY 1 ORDER BY spent DESC""", args)]
        monthly = [{"month": r["mo"], "count": r["c"], "spent": float(r["spent"]), "deposits": float(r["deposits"])}
                   for r in rows(f"""SELECT to_char(txn_dt,'YYYY-MM') mo, count(*) c,
            COALESCE(abs(sum(amount) FILTER (WHERE amount<0)),0) spent,
            COALESCE(sum(amount) FILTER (WHERE amount>0),0) deposits
            FROM asa_client_financial_txns {where} AND txn_dt IS NOT NULL
            GROUP BY 1 ORDER BY 1 DESC LIMIT 12""", args)]
        monthly.reverse()
        by_client = [{"client": r["client_name"], "count": r["c"], "spent": float(r["spent"]),
                      "deposits": float(r["deposits"]), "net": float(r["net"])}
                     for r in rows(f"""SELECT client_name, count(*) c,
            COALESCE(abs(sum(amount) FILTER (WHERE amount<0)),0) spent,
            COALESCE(sum(amount) FILTER (WHERE amount>0),0) deposits,
            COALESCE(sum(amount),0) net
            FROM asa_client_financial_txns {where} GROUP BY 1 ORDER BY spent DESC""", args)]
        vmerge: dict[str, dict[str, Any]] = {}
        for r in rows(f"""SELECT vendor, count(*) c,
            COALESCE(abs(sum(amount) FILTER (WHERE amount<0)),0) spent
            FROM asa_client_financial_txns {where} AND COALESCE(vendor,'')<>'' GROUP BY 1""", args):
            key = _fin_norm_vendor(r["vendor"])
            if not key:
                continue
            m = vmerge.setdefault(key, {"vendor": str(r["vendor"]).upper(), "count": 0, "spent": 0.0, "_top": 0})
            m["count"] += r["c"]
            m["spent"] += float(r["spent"])
            if r["c"] > m["_top"]:
                m["_top"] = r["c"]
                m["vendor"] = str(r["vendor"]).upper()
        top_vendors = sorted(vmerge.values(), key=lambda x: -x["spent"])[:12]
        for v in top_vendors:
            v.pop("_top", None)
        c = (rows(f"""SELECT count(*) total,
            count(*) FILTER (WHERE COALESCE(receipt,'')<>'') with_receipt,
            count(*) FILTER (WHERE COALESCE(receipt,'')='' AND receipt_ai='EXEMPT') exempt,
            count(*) FILTER (WHERE COALESCE(receipt,'')='' AND COALESCE(receipt_ai,'')<>'EXEMPT') missing
            FROM asa_client_financial_txns {where} AND source='TrueLink' AND amount<0""", args) or [{}])[0]
        compliance = {"total": int(c.get("total") or 0), "withReceipt": int(c.get("with_receipt") or 0),
                      "exempt": int(c.get("exempt") or 0), "missing": int(c.get("missing") or 0)}
    except Exception as exc:  # noqa: BLE001
        log.warning("finance/analytics: pg failed (%s)", type(exc).__name__)
        return {"status": 502, "message": f"analytics unreadable ({type(exc).__name__})"}
    flags = []
    other = next((x for x in by_cat if x["category"] == "Other"), None)
    if other and spent and other["spent"] > 0.2 * spent:
        flags.append({"label": f"'Other' is {round(100 * other['spent'] / spent)}% of spend (${other['spent']:,.0f})",
                      "detail": "Large uncategorized spend — recategorize for real visibility."})
    drains = [x for x in by_client if x["spent"] > x["deposits"] and x["spent"] > 0]
    if drains:
        flags.append({"label": f"{len(drains)} client(s) spending more than deposited",
                      "detail": ", ".join(x["client"] for x in drains[:6])})
    if compliance["missing"]:
        flags.append({"label": f"{compliance['missing']} TrueLink spend(s) missing receipts",
                      "detail": "Resolve them on the ledger."})
    return {"status": 200, "data": {"kpis": kpis, "byFund": by_fund, "byCategory": by_cat, "monthly": monthly,
                                    "byClient": by_client[:20], "topVendors": top_vendors,
                                    "compliance": compliance, "flags": flags}}


def finance_history(body: dict[str, Any]) -> dict[str, Any]:
    client = str(body.get("client") or "").strip()
    limit = min(max(int(body.get("limit") or 200), 1), 500)
    conds = ["TRUE"]
    args: list[Any] = []
    if client:
        conds.append("lower(client_name) = lower(%s)")
        args.append(client)
    args.append(limit)
    try:
        got = rows(f"""SELECT client_name, txn_dt, posted_date, vendor, location,
                   last_four, txn_type, amount, fund_type, category, description,
                   staff_member, source, receipt, receipt_ai, exempt_reason
              FROM asa_client_financial_txns
             WHERE {' AND '.join(conds)}
             ORDER BY txn_dt DESC NULLS LAST
             LIMIT %s""", args)
    except Exception as exc:  # noqa: BLE001
        log.warning("finance/history: pg failed (%s)", type(exc).__name__)
        return {"status": 502, "message": f"history unreadable ({type(exc).__name__})"}
    out = [{
        "client": str(r.get("client_name") or ""),
        "date": str(r.get("txn_dt") or ""),
        "posted": str(r.get("posted_date") or ""),
        "vendor": str(r.get("vendor") or ""),
        "location": str(r.get("location") or ""),
        "last4": str(r.get("last_four") or ""),
        "type": str(r.get("txn_type") or ""),
        "amount": float(r["amount"]) if r.get("amount") is not None else None,
        "fund": str(r.get("fund_type") or ""),
        "category": str(r.get("category") or ""),
        "description": str(r.get("description") or "")[:200],
        "staff": str(r.get("staff_member") or ""),
        "source": str(r.get("source") or ""),
        "receipt": str(r.get("receipt") or ""),
        "receipt_ai": str(r.get("receipt_ai") or ""),
        "exempt": str(r.get("exempt_reason") or ""),
    } for r in got]
    return {"status": 200, "data": {"rows": out}}


def finance_docs(_body: dict[str, Any]) -> dict[str, Any]:
    try:
        got = rows("SELECT subfolder, name, mime, size_bytes, web_view_link, vendor, doc_date, amount, currency,"
                   " category, method FROM asa_finance_doc ORDER BY subfolder, doc_date DESC NULLS LAST, name")
    except Exception as exc:  # noqa: BLE001
        log.warning("finance/docs: pg failed (%s)", type(exc).__name__)
        return {"status": 502, "message": f"document index unreadable ({type(exc).__name__})"}
    folders: dict[str, dict[str, Any]] = {}
    for r in got:
        sub = str(r.get("subfolder") or "General")
        f = folders.setdefault(sub, {"subfolder": sub, "count": 0, "docs": []})
        f["count"] += 1
        if len(f["docs"]) < 120:
            f["docs"].append({
                "name": str(r.get("name") or ""),
                "vendor": str(r.get("vendor") or ""),
                "doc_date": str(r.get("doc_date") or ""),
                "amount": float(r["amount"]) if r.get("amount") is not None else None,
                "currency": str(r.get("currency") or ""),
                "category": str(r.get("category") or ""),
                "link": str(r.get("web_view_link") or ""),
                "mime": str(r.get("mime") or ""),
            })
    return {"status": 200, "data": {"folders": sorted(folders.values(), key=lambda f: f["subfolder"])}}


# ---- the routes ---------------------------------------------------------------------------------------------------------

async def inventory_meds_door(request: Request) -> Response:
    return await _door(request, lambda _b: inventory_meds_env())


async def shopper_purchases_door(request: Request) -> Response:
    return await _door(request, lambda _b: shopper_purchases_env())


async def inventory_supplies_door(request: Request) -> Response:
    return await _door(request, inventory_supplies)


async def clients_meds_door(request: Request) -> Response:
    return await _door(request, clients_meds)


async def finance_analytics_door(request: Request) -> Response:
    return await _door(request, finance_analytics)


async def finance_history_door(request: Request) -> Response:
    return await _door(request, finance_history)


async def finance_docs_door(request: Request) -> Response:
    return await _door(request, finance_docs)


ROUTES = (("/inventory/meds", inventory_meds_door), ("/inventory/supplies", inventory_supplies_door),
          ("/clients/meds", clients_meds_door), ("/shopper/purchases", shopper_purchases_door),
          ("/finance/analytics", finance_analytics_door), ("/finance/history", finance_history_door),
          ("/finance/docs", finance_docs_door))
