"""Client Finances on Python (Finance.gs, TrueLink.gs): the money held on each client's behalf — the ledger
(financeTransactions), the month balances (financeBalances) and the TrueLink runs, in Postgres (app.resource_rows,
uploaded from their tabs as the app is given to Python) and read and written there alone; the vocabularies stay the
shared finance_config tab's (Recon, Learning and Med Delegation read it too), written through app.edits. A receipt is
kept on the server (documents/finance/receipts/), read by Drive's own OCR through a copy deleted at once, and judged
against the amount typed (a pattern first, the platform's model only when no total is found). The company's finance
papers are brought onto the server (documents/finance/docs/, app.finance_docs) on the relay's clock. Admins and
managers only."""
from __future__ import annotations

import base64
import binascii
import json
import math
import os
import re
import time
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Callable
from zoneinfo import ZoneInfo

import clients as C
import drive as dr
import gsjs
import hotline as HL
import location_docs as LD
import locations as L
import resource_rows as RR
from scope import Defer

APP_ID = "finance"
TXNS, BALANCES, RUNS = "financeTransactions", "financeMonthBalances", "truelinkRuns"
CONFIG_TAB = "finance_config"
DOCS = "app.finance_docs"
FUND_TYPES = ("Debit Card", "Cash", "Food Stamps")
TXN_TYPES = ("Spending", "Deposit", "Withdraw")
CATEGORIES = ("Food", "Entertainment", "Medical", "Supplies & Personal Care", "Transportation",
              "Clothing & Accessories", "Bank Fees", "Other")
EXEMPT_REASONS = ("Lost", "Not Provided", "Recurring/Subscription", "Online Purchase", "Other")
CFG_KEYS = ("fundTypes", "categories", "exemptReasons")
FLOOR = {"fundTypes": FUND_TYPES, "categories": CATEGORIES, "exemptReasons": EXEMPT_REASONS}
NY = ZoneInfo("America/New_York")
RECEIPT_MAX = 15 * 1024 * 1024
DOC_MAX = 25 * 1024 * 1024
DOCS_FOLDER_PROP = "FIN_DRIVE_ROOT_ID"
TRUELINK_BOOK_PROP = "FIN_TRUELINK_SHEET_ID"
FETCH_BUDGET_S = float(os.getenv("HUB_FIN_DOCS_FETCH_BUDGET_S", "25"))
DENIED = {"status": 403, "message": "Requires an admin or manager account"}
_UNSAFE = re.compile(r"[\\/?<>:*|\"]")
_SAFE_FILE = re.compile(r"[^A-Za-z0-9 ._()\-]+")

s_ = gsjs.str_


def base() -> Path:
    return LD.ROOT / "finance"


def num(v: Any) -> float:
    """finNum_."""
    try:
        n = float(re.sub(r"[,$\s]", "", s_(v)) or 0)
    except ValueError:
        return 0.0
    return n if n == n and abs(n) != float("inf") else 0.0


def month_of(day: Any) -> str:
    m = re.match(r"^(\d{4})-(\d{2})", s_(day).strip())
    return f"{m.group(1)}-{m.group(2)}" if m else ""


def prev_month(month: str) -> str:
    y, m = (int(x) for x in month.split("-"))
    return f"{y - 1}-12" if m == 1 else f"{y}-{m - 1:02d}"


def next_month(month: str) -> str:
    y, m = (int(x) for x in month.split("-"))
    return f"{y + 1}-01" if m == 12 else f"{y}-{m + 1:02d}"


def this_month() -> str:
    return datetime.now(NY).strftime("%Y-%m")


def may_use(user: dict | None) -> bool:
    """finMayUse_: admins and managers, never a service."""
    u = user or {}
    return bool(u) and not u.get("is_service") and s_(u.get("role")) in ("admin", "manager")


def admin(user: dict | None) -> bool:
    u = user or {}
    return bool(u) and not u.get("is_service") and s_(u.get("role")) == "admin"


def config_rows(reads: L.Reads) -> list[dict]:
    return C._hub(reads, CONFIG_TAB)


def vocabulary(reads: L.Reads) -> dict[str, list[str]]:
    """finVocabulary_: the built-in floor, then what Settings added."""
    rows = {s_(r.get("key")): r for r in config_rows(reads)}
    out: dict[str, list[str]] = {}
    for k in CFG_KEYS:
        got = list(FLOOR[k])
        for v in s_((rows.get(k) or {}).get("value")).split("|"):
            t = v.strip()
            if t and t not in got:
                got.append(t)
        out[k] = got
    out["txnTypes"] = list(TXN_TYPES)
    return out


def fin_clients(reads: L.Reads) -> list[dict[str, str]]:
    """finClients_."""
    out = [{"id": s_(c.get("id")), "name": s_(c.get("name")), "house": s_(c.get("house") or c.get("house_name")),
            "status": s_(c.get("status"))} for c in (C.derived(reads) or [])]
    return sorted(out, key=lambda c: c["name"].lower())


def txn_rows(reads: L.Reads) -> list[dict]:
    return RR.read_all(reads, TXNS)


def txns_for(reads: L.Reads, client: str, month: str = "") -> list[dict[str, Any]]:
    """finTxnsFor_: one client's rows (of a month), newest first."""
    want = s_(client).lower()
    out = []
    for r in txn_rows(reads):
        if s_(r.get("client")).lower() != want or (month and s_(r.get("month")) != month):
            continue
        amount = num(r.get("amount"))
        out.append({"id": s_(r.get("id")), "client": s_(r.get("client")), "date": s_(r.get("date")),
                    "month": s_(r.get("month")), "type": s_(r.get("type")), "fundType": s_(r.get("fundType")),
                    "amount": amount, "vendor": s_(r.get("vendor")), "category": s_(r.get("category")),
                    "description": s_(r.get("description")), "staffMember": s_(r.get("staffMember")),
                    "receiptName": s_(r.get("receiptName")), "receiptVerdict": s_(r.get("receiptVerdict")),
                    "receiptNote": s_(r.get("receiptNote")), "needsReceipt": amount < 0 and not s_(r.get("receiptName"))})
    return sorted(out, key=lambda t: t["date"], reverse=True)


def balances_for(reads: L.Reads, client: str) -> list[dict]:
    want = s_(client).lower()
    return [r for r in RR.read_all(reads, BALANCES) if s_(r.get("client")).lower() == want]


def ledger(reads: L.Reads, client: str, month: str) -> dict[str, Any]:
    """finLedger_: computed from the transactions; the opening only from the previous CLOSED month."""
    txns = txns_for(reads, client, month)
    prev = prev_month(month)
    by: dict[str, dict] = {}

    def bucket(ft: str) -> dict:
        return by.setdefault(ft, {"fundType": ft, "opening": 0, "deposits": 0, "spending": 0, "closing": 0, "count": 0,
                                  "openingKnown": False})
    bals = balances_for(reads, client)
    for b in bals:
        if s_(b.get("month")) == prev and s_(b.get("status")) == "Closed":
            k = bucket(s_(b.get("fundType")))
            k["opening"] = num(b.get("closing"))
            k["openingKnown"] = True
    for t in txns:
        k = bucket(t["fundType"] or "Debit Card")
        k["count"] += 1
        if t["amount"] >= 0:
            k["deposits"] += t["amount"]
        else:
            k["spending"] += t["amount"]
    funds = []
    for k in by.values():
        k["closing"] = k["opening"] + k["deposits"] + k["spending"]
        funds.append(k)
    closed = any(s_(b.get("month")) == month and s_(b.get("status")) == "Closed" for b in bals)
    return {"client": client, "month": month, "funds": funds, "transactions": txns, "closed": closed,
            "missingReceipts": sum(1 for t in txns if t["needsReceipt"])}


def _gate(sess: L.Session) -> dict | None:
    return None if may_use(sess.user) else dict(DENIED)


def clients_door(sess: L.Session, payload: dict) -> dict[str, Any]:
    """finClients: the client list and the vocabularies the screen boots with."""
    if _gate(sess):
        return dict(DENIED)
    v = vocabulary(sess.reads)
    return {"status": 200, "data": {"clients": fin_clients(sess.reads), "fundTypes": v["fundTypes"],
                                    "categories": v["categories"], "txnTypes": v["txnTypes"],
                                    "exemptReasons": v["exemptReasons"]}}


def ledger_door(sess: L.Session, payload: dict) -> dict[str, Any]:
    """finLedger."""
    if _gate(sess):
        return dict(DENIED)
    p = payload if isinstance(payload, dict) else {}
    client = s_(p.get("client"))
    if not client:
        return {"status": 400, "message": "Which client?"}
    return {"status": 200, "data": ledger(sess.reads, client, s_(p.get("month")) or this_month())}


def counts_door(sess: L.Session, payload: dict) -> dict[str, Any]:
    """finClientCounts: who needs attention this month."""
    if _gate(sess):
        return dict(DENIED)
    month = s_((payload or {}).get("month")) if isinstance(payload, dict) else ""
    month = month or this_month()
    missing: dict[str, int] = {}
    spend: dict[str, float] = {}
    for r in txn_rows(sess.reads):
        if s_(r.get("month")) != month:
            continue
        k = s_(r.get("client")).lower()
        amt = num(r.get("amount"))
        if amt < 0:
            spend[k] = spend.get(k, 0) + amt
            if not s_(r.get("receiptName")) and s_(r.get("receiptVerdict")) != "EXEMPT":
                missing[k] = missing.get(k, 0) + 1
    return {"status": 200, "data": {"month": month, "clients": [
        {"id": c["id"], "name": c["name"], "house": c["house"], "missingReceipts": missing.get(c["name"].lower(), 0),
         "spending": spend.get(c["name"].lower(), 0)} for c in fin_clients(sess.reads)]}}


def balances_door(sess: L.Session, payload: dict) -> dict[str, Any]:
    """finBalances: every month this client has."""
    if _gate(sess):
        return dict(DENIED)
    client = s_((payload or {}).get("client")) if isinstance(payload, dict) else ""
    if not client:
        return {"status": 400, "message": "Which client?"}
    rows = [{"id": s_(b.get("id")), "fundType": s_(b.get("fundType")), "month": s_(b.get("month")),
             "opening": num(b.get("opening")), "deposits": num(b.get("deposits")), "spending": num(b.get("spending")),
             "closing": num(b.get("closing")), "status": s_(b.get("status")), "closedBy": s_(b.get("closedBy")),
             "closedAt": s_(b.get("closedAt"))} for b in balances_for(sess.reads, client)]
    return {"status": 200, "data": {"balances": sorted(rows, key=lambda b: b["month"], reverse=True)}}


def preview_door(sess: L.Session, payload: dict) -> dict[str, Any]:
    """finCloseOutPreview: what closing would do, before it is done."""
    if _gate(sess):
        return dict(DENIED)
    p = payload if isinstance(payload, dict) else {}
    client, month = s_(p.get("client")), s_(p.get("month"))
    if not client or not month:
        return {"status": 400, "message": "Client and month are both required."}
    led = ledger(sess.reads, client, month)
    warnings = [month + " is already closed."] if led["closed"] else []
    for f in led["funds"]:
        if not f["openingKnown"]:
            warnings.append(f"{f['fundType']} opens at 0.00 because {prev_month(month)} was never closed.")
        if f["closing"] < 0:
            warnings.append(f"{f['fundType']} would close NEGATIVE at {f['closing']:.2f}.")
    if led["missingReceipts"]:
        warnings.append(f"{led['missingReceipts']} spend(s) still have no receipt — closing does not clear them.")
    return {"status": 200, "data": {"client": client, "month": month, "funds": led["funds"],
                                    "missingReceipts": led["missingReceipts"], "closed": led["closed"],
                                    "warnings": warnings}}


# ---- the analysis over the card book and the ledger ----------------------------------------------------------

def src_day(v: Any) -> str:
    """finSrcDay_."""
    t = s_(v).strip()
    iso = re.match(r"^(\d{4})-(\d{2})-(\d{2})", t)
    if iso:
        return "-".join(iso.groups())
    us = re.match(r"^(\d{1,2})[/\-](\d{1,2})[/\-](\d{2,4})", t)
    if not us:
        return ""
    y = "20" + us.group(3) if len(us.group(3)) == 2 else us.group(3)
    return f"{y}-{int(us.group(1)):02d}-{int(us.group(2)):02d}"


def _norm(row: dict) -> dict:
    return {re.sub(r"[^a-z0-9]", "", str(k).lower()): v for k, v in row.items()}


def source_rows(reads: L.Reads) -> list[dict[str, Any]]:
    """finSourceRows_: the TrueLink book's Transactions, then the ledger's rows it does not already hold (RowKey)."""
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    sid = s_(reads.db.prop(TRUELINK_BOOK_PROP))
    ref = reads.db.tab(sid, "Transactions") if sid else None
    if ref is not None:
        for _rn, raw in reads.db.rows(ref):
            r = _norm(raw)
            if s_(r.get("rowkey")):
                seen.add(s_(r.get("rowkey")))
            out.append({"client": s_(r.get("cardholdername")), "date": src_day(r.get("transactiondate")),
                        "posted": s_(r.get("posteddate")), "vendor": s_(r.get("vendor")),
                        "location": s_(r.get("location")), "last4": s_(r.get("accountlast4")), "type": s_(r.get("type")),
                        "amount": num(r.get("amount")), "fund": s_(r.get("fundtype")) or "Debit Card",
                        "category": s_(r.get("category")), "description": s_(r.get("description"))[:200],
                        "staff": s_(r.get("staffmember")), "source": s_(r.get("source")) or "TrueLink",
                        "receipt": s_(r.get("receipt")), "receipt_ai": s_(r.get("receiptai"))})
    for r in txn_rows(reads):
        if s_(r.get("legacyRowKey")) and s_(r.get("legacyRowKey")) in seen:
            continue
        out.append({"client": s_(r.get("client")), "date": src_day(r.get("date")), "posted": s_(r.get("postedDate")),
                    "vendor": s_(r.get("vendor")), "location": s_(r.get("location")),
                    "last4": s_(r.get("accountLast4")), "type": s_(r.get("type")), "amount": num(r.get("amount")),
                    "fund": s_(r.get("fundType")) or "Debit Card", "category": s_(r.get("category")),
                    "description": s_(r.get("description"))[:200], "staff": s_(r.get("staffMember")),
                    "source": "Manual" if s_(r.get("type")) == "Manual" else (s_(r.get("source")) or "Hub"),
                    "receipt": s_(r.get("receiptName")), "receipt_ai": s_(r.get("receiptVerdict"))})
    return out


def _r2(x: float) -> float:
    """Math.round(x * 100) / 100."""
    return math.floor(x * 100 + 0.5) / 100


def analytics_door(sess: L.Session, payload: dict) -> dict[str, Any]:
    """finAnalytics: the money across the card book and the ledger, and what needs looking at."""
    if _gate(sess):
        return dict(DENIED)
    want = s_((payload or {}).get("client")).lower() if isinstance(payload, dict) else ""
    rows = [r for r in source_rows(sess.reads) if not want or r["client"].lower() == want]
    spent = deposits = 0.0
    spend_cnt = 0
    seen_clients: set[str] = set()
    by_fund: dict[str, dict] = {}
    by_cat: dict[str, dict] = {}
    by_month: dict[str, dict] = {}
    by_client: dict[str, dict] = {}
    by_vendor: dict[str, dict] = {}
    for r in rows:
        if r["client"]:
            seen_clients.add(r["client"])
        a = r["amount"]
        if a < 0:
            spent += -a
            spend_cnt += 1
        else:
            deposits += a
        f = by_fund.setdefault(r["fund"], {"fund": r["fund"], "count": 0, "spent": 0, "deposits": 0})
        f["count"] += 1
        f["spent" if a < 0 else "deposits"] += -a if a < 0 else a
        if r["category"]:
            c = by_cat.setdefault(r["category"], {"category": r["category"], "count": 0, "spent": 0})
            c["count"] += 1
            if a < 0:
                c["spent"] += -a
        if r["date"]:
            m = by_month.setdefault(r["date"][:7], {"month": r["date"][:7], "count": 0, "spent": 0, "deposits": 0})
            m["count"] += 1
            m["spent" if a < 0 else "deposits"] += -a if a < 0 else a
        if r["client"]:
            cl = by_client.setdefault(r["client"], {"client": r["client"], "count": 0, "spent": 0, "deposits": 0,
                                                    "net": 0})
            cl["count"] += 1
            cl["net"] += a
            cl["spent" if a < 0 else "deposits"] += -a if a < 0 else a
        vk = re.sub(r"[^a-z0-9]", "", r["vendor"].lower())
        if vk:
            v = by_vendor.setdefault(vk, {"vendor": r["vendor"].upper(), "count": 0, "spent": 0, "top": 0})
            v["count"] += 1
            if a < 0:
                v["spent"] += -a
            if v["count"] > v["top"]:
                v["top"], v["vendor"] = v["count"], r["vendor"].upper()
    monthly = sorted(by_month.values(), key=lambda m: m["month"])[-12:]
    top_vendors = [{"vendor": v["vendor"], "count": v["count"], "spent": _r2(v["spent"])}
                   for v in sorted(by_vendor.values(), key=lambda v: -v["spent"])[:12]]
    cats = sorted(by_cat.values(), key=lambda c: -c["spent"])
    by_client_list = sorted(by_client.values(), key=lambda c: -c["spent"])[:20]
    tl = [r for r in rows if r["source"] == "TrueLink" and r["amount"] < 0]
    with_receipt = sum(1 for r in tl if r["receipt"])
    exempt = sum(1 for r in tl if not r["receipt"] and r["receipt_ai"] == "EXEMPT")
    compliance = {"total": len(tl), "withReceipt": with_receipt, "exempt": exempt,
                  "missing": len(tl) - with_receipt - exempt}
    flags = []
    other = next((c for c in cats if c["category"] == "Other"), None)
    if other and spent and other["spent"] > 0.2 * spent:
        flags.append({"label": f"'Other' is {round(100 * other['spent'] / spent)}% of spend",
                      "detail": "Large uncategorized spend — recategorize for real visibility."})
    drains = [c for c in by_client_list if c["spent"] > c["deposits"] and c["spent"] > 0]
    if drains:
        flags.append({"label": f"{len(drains)} client(s) spending more than deposited",
                      "detail": ", ".join(c["client"] for c in drains[:6])})
    if compliance["missing"] > 0:
        flags.append({"label": f"{compliance['missing']} TrueLink spend(s) missing receipts",
                      "detail": "Resolve them on the ledger."})
    return {"status": 200, "data": {
        "kpis": {"txns": len(rows), "clients": len(seen_clients), "spent": _r2(spent), "deposits": _r2(deposits),
                 "net": _r2(deposits - spent), "avgTxn": _r2(spent / spend_cnt) if spend_cnt else 0},
        "byFund": sorted(by_fund.values(), key=lambda f: -f["spent"]), "byCategory": cats, "monthly": monthly,
        "byClient": by_client_list, "topVendors": top_vendors, "compliance": compliance, "flags": flags}}


def history_door(sess: L.Session, payload: dict) -> dict[str, Any]:
    """finLedgerHistory: the newest rows across the card book and the ledger."""
    if _gate(sess):
        return dict(DENIED)
    p = payload if isinstance(payload, dict) else {}
    want = s_(p.get("client")).lower()
    try:
        limit = min(max(int(float(p.get("limit") or 200)), 1), 500)
    except (TypeError, ValueError):
        limit = 200
    rows = [r for r in source_rows(sess.reads) if not want or r["client"].lower() == want]
    return {"status": 200, "data": {"rows": sorted(rows, key=lambda r: r["date"], reverse=True)[:limit]}}


def missing_receipts(reads: L.Reads) -> list[dict[str, Any]]:
    """finSmartSubjects_: this month's spends with no receipt and no exemption, by client — the subjects Smart Comms'
    finance_receipts_missing situation speaks of."""
    month = this_month()
    by: dict[str, dict] = {}
    for r in txn_rows(reads):
        if s_(r.get("month")) != month:
            continue
        amt = num(r.get("amount"))
        if amt >= 0 or s_(r.get("receiptName")) or s_(r.get("receiptVerdict")) == "EXEMPT" or not s_(r.get("client")):
            continue
        b = by.setdefault(s_(r.get("client")), {"name": s_(r.get("client")), "month": month, "missing": 0, "total": 0.0,
                                                "oldest": ""})
        b["missing"] += 1
        b["total"] += abs(amt)
        d = s_(r.get("date"))
        if not b["oldest"] or d < b["oldest"]:
            b["oldest"] = d
    return [{**b, "total": f"${b['total']:.2f}"} for b in by.values()]


def week_before(today_iso: str) -> tuple[str, str]:
    """The last whole week before today's: its Monday and its Sunday."""
    from datetime import date, timedelta  # noqa: PLC0415 - only the weekly summary counts weeks
    t = date.fromisoformat(s_(today_iso)[:10])
    start = t - timedelta(days=t.weekday() + 7)
    return start.isoformat(), (start + timedelta(days=6)).isoformat()


def house_week(reads: L.Reads, today_iso: str) -> dict[str, Any]:
    """Each house's spending last week, off the ledger alone: its current clients' spends (a negative amount) from
    Monday to Sunday — what they came to, by category, and how many still wait for a receipt. A house nothing was
    spent at is in the answer too, with nothing in it."""
    start, end = week_before(today_iso)
    house_of: dict[str, str] = {}
    for c in fin_clients(reads):
        code = L.house_code(c["house"]) or L.code_of(c["house"])
        if c["name"] and code and s_(c.get("status")).lower() not in ("inactive", "discharged", "deceased"):
            house_of[c["name"].lower()] = code
    by: dict[str, dict[str, Any]] = {}
    for r in txn_rows(reads):
        day, amt = s_(r.get("date"))[:10], num(r.get("amount"))
        code = house_of.get(s_(r.get("client")).lower())
        if amt >= 0 or not code or not start <= day <= end:
            continue
        h = by.setdefault(code, {"count": 0, "total": 0.0, "missing": 0, "categories": {}})
        h["count"] += 1
        h["total"] += abs(amt)
        cat = s_(r.get("category")) or "Other"
        h["categories"][cat] = h["categories"].get(cat, 0.0) + abs(amt)
        if not s_(r.get("receiptName")) and s_(r.get("receiptVerdict")) != "EXEMPT":
            h["missing"] += 1
    return {"start": start, "end": end, "houses": by}


# ---- a receipt: kept on the server, read, judged --------------------------------------------------------------

def verdict(text: str, amount: float, vendor: str) -> dict[str, str]:
    """finReceiptVerdict_: a pattern first; the model reads the text only when no number is found, and never guesses."""
    want = abs(num(amount))
    body = text or ""
    if not body.strip():
        return {"verdict": "UNREADABLE", "note": "Nothing could be read from the image."}
    found = [num(m) for m in re.findall(r"(?:\$\s*)?(\d{1,3}(?:,\d{3})*(?:\.\d{2})|\d+\.\d{2})", body)]
    if found:
        if any(abs(f - want) < 0.005 for f in found):
            seen = bool(vendor) and vendor.lower()[:6] in body.lower()
            return {"verdict": "MATCH", "note": f"The receipt shows {want:.2f}" + (" and names the vendor." if seen
                                                                                   else ".")}
        near = sorted(found, key=lambda f: abs(f - want))[0]
        return {"verdict": "MISMATCH", "note": f"Typed {want:.2f}; the closest total on the receipt is {near:.2f}."}
    ask = ('This is OCR text from a shop receipt. Reply with JSON only: {"total": <number or null>, "vendor": '
           '"<name or empty>"}. The total is what the customer paid. If you cannot tell, use null.\n\n' + body[:4000])
    content, via = HL.answer(ask)
    if not content:
        return {"verdict": "UNREADABLE", "note": "No total could be read."}
    try:
        parsed = json.loads(re.sub(r"^```(?:json)?|```$", "", content.strip()).strip())
    except ValueError:
        parsed = None
    total = num(parsed.get("total")) if isinstance(parsed, dict) and parsed.get("total") is not None else None
    if total is None:
        return {"verdict": "UNREADABLE", "note": f"No total could be read ({via})."}
    if abs(total - want) < 0.005:
        return {"verdict": "MATCH", "note": f"Read as {total:.2f} via {via}."}
    return {"verdict": "POSSIBLE_MATCH", "note": f"Typed {want:.2f}; read {total:.2f} via {via} — please check."}


def receipt_name(client: str, day: str, vendor: str, amount: float, filename: str) -> str:
    ext = ".jpg"
    if "." in filename:
        ext = filename[filename.rfind("."):].lower()

    def clean(v: str) -> str:
        return _UNSAFE.sub(" ", s_(v))
    return f"{clean(client)} - {day} - {clean(vendor) or 'Manual'} - {abs(amount):.2f}{ext}"


def receipt_read(sess: L.Session, payload: dict) -> dict[str, Any]:
    """finReceiptRead (asked by the relay before finSubmitTransaction / finAttachReceipt): the receipt kept on the server
    and judged against the amount; the write then records it."""
    if _gate(sess):
        return dict(DENIED)
    p = payload if isinstance(payload, dict) else {}
    b64, mime = s_(p.get("receiptBase64")), s_(p.get("receiptMime"))
    if not b64 or not mime:
        return {"status": 400, "message": "No file was sent."}
    try:
        data = base64.b64decode(b64, validate=False)
    except (binascii.Error, ValueError):
        return {"status": 400, "message": "The file could not be read."}
    if not data or len(data) > RECEIPT_MAX:
        return {"status": 400, "message": "The file is empty or over 15MB."}
    reads = sess.reads
    if s_(p.get("id")):
        row = next((r for r in txn_rows(reads) if s_(r.get("id")) == s_(p.get("id"))), None)
        if row is None:
            return {"status": 404, "message": f'No "{TXNS}" record with id "{s_(p.get("id"))}".'}
        client, day, vendor, amount = s_(row.get("client")), s_(row.get("date")), s_(row.get("vendor")), num(row.get("amount"))
    else:
        client, day, vendor = s_(p.get("client")), s_(p.get("date")), s_(p.get("vendor"))
        amount = num(p.get("amount"))
        amount = -abs(amount) if s_(p.get("type")) in ("Spending", "Withdraw") else amount
    name = receipt_name(client, day, vendor, amount, s_(p.get("receiptFileName")))
    rel = f"receipts/{uuid.uuid4().hex}/{_SAFE_FILE.sub('_', name)[:150]}"
    target = base() / rel
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.with_name(target.name + ".part")
    tmp.write_bytes(data)
    os.replace(tmp, target)
    try:
        text = reads.need_drive().ocr_text(data, mime)
    except (Defer, dr.Gone, OSError, ValueError) as exc:
        text = ""
        why = f"the receipt could not be read just now ({type(exc).__name__})"
        return {"status": 200, "data": {"path": rel, "name": name, "mime": mime, "size": len(data),
                                        "verdict": "UNREADABLE", "note": why[0].upper() + why[1:] + "."}}
    return {"status": 200, "data": {"path": rel, "name": name, "mime": mime, "size": len(data),
                                    **verdict(text, amount, vendor)}}


# ---- the company's finance papers, kept on the server ----------------------------------------------------------

def docs_door(sess: L.Session, payload: dict) -> dict[str, Any]:
    """finDocs: up to 12 subfolders of the finance folder, 120 papers each, out of Postgres."""
    if _gate(sess):
        return dict(DENIED)
    if not (base() / "docs" / ".fetched").exists():
        raise Defer("the finance folder has not been brought onto the server yet")
    cols = ("drive_id", "subfolder", "name", "mime", "link", "path")
    got = RR._q(sess.reads, f"select {', '.join(cols)} from {DOCS} order by subfolder, name")
    folders: dict[str, dict] = {}
    for r in (dict(zip(cols, x)) for x in got):
        f = folders.setdefault(r["subfolder"], {"subfolder": r["subfolder"], "count": 0, "docs": []})
        f["count"] += 1
        if len(f["docs"]) >= 120:
            continue
        name = s_(r["name"])
        amt = re.search(r"\$?\s?([0-9][0-9,]*\.[0-9]{2})", name)
        dt = re.search(r"(\d{4}[._-]\d{1,2}[._-]\d{1,2})|(\d{1,2}[._/]\d{1,2}[._/]\d{2,4})", name)
        f["docs"].append({"name": name, "vendor": "", "doc_date": dt.group(0) if dt else "",
                          "amount": float(amt.group(1).replace(",", "")) if amt else None,
                          "currency": "USD" if amt else "", "category": "", "link": s_(r["link"]),
                          "mime": s_(r["mime"]), "id": s_(r["drive_id"]), "kept": bool(r["path"])})
    return {"status": 200, "data": {"folders": sorted(folders.values(), key=lambda f: f["subfolder"])[:12]}}


def doc_file(sess: L.Session, payload: dict) -> dict[str, Any]:
    """finDocFile: one finance paper off the server's copy."""
    if _gate(sess):
        return dict(DENIED)
    fid = s_((payload or {}).get("id")) if isinstance(payload, dict) else ""
    got = RR._q(sess.reads, f"select name, mime, path from {DOCS} where drive_id = %s", (fid,))
    if not got or not got[0][2]:
        return {"status": 404, "message": "This paper is not kept on the server — open it in Drive."}
    try:
        data = (base() / "docs" / s_(got[0][2])).read_bytes()
    except OSError:
        return {"status": 503, "message": "The kept copy could not be read from the server's disk just now."}
    return {"status": 200, "data": {"name": s_(got[0][0]), "mime": s_(got[0][1]) or "application/octet-stream",
                                    "size": len(data), "b64": base64.b64encode(data).decode("ascii")}}


def docs_fetch(sess: L.Session, payload: dict) -> dict[str, Any]:
    """finDocsFetch (the relay's own): the finance folder's papers new or changed brought onto the disk, a few a pass."""
    if (sess.user or {}).get("is_service") is not True:
        return {"status": 403, "message": "This is the relay's own read."}
    reads = sess.reads
    root = s_(reads.db.prop(DOCS_FOLDER_PROP))
    if not root:
        return {"status": 200, "data": {"items": [], "more": False, "reason": f"{DOCS_FOLDER_PROP} is not set"}}
    drv = reads.need_drive()
    have = {s_(r[0]): s_(r[1]) for r in RR._q(reads, f"select drive_id, google_modified from {DOCS}")}
    started = time.monotonic()
    items, more = [], False
    for sub in sorted(drv.children(root, True, "id,name"), key=lambda f: s_(f.get("name")))[:12]:
        for f in drv.children(s_(sub.get("id")), False, "id,name,mimeType,modifiedTime,webViewLink,size"):
            fid = s_(f.get("id"))
            if have.get(fid) == s_(f.get("modifiedTime")):
                continue
            if time.monotonic() - started > FETCH_BUDGET_S:
                more = True
                break
            item = {"drive_id": fid, "subfolder": s_(sub.get("name")), "name": s_(f.get("name")),
                    "mime": s_(f.get("mimeType")), "size_bytes": int(f.get("size") or 0),
                    "google_modified": s_(f.get("modifiedTime")), "link": s_(f.get("webViewLink")), "path": "",
                    "why": ""}
            try:
                if item["mime"].startswith(dr.GOOGLE_NATIVE):
                    data = drv.export(fid, "application/pdf", DOC_MAX)
                    item["mime"], name = "application/pdf", item["name"] + ".pdf"
                elif item["size_bytes"] > DOC_MAX:
                    raise ValueError("past the size the server keeps")
                else:
                    data, name = drv.media(fid, DOC_MAX), item["name"]
                rel = f"{fid}/{_SAFE_FILE.sub('_', name)[:150]}"
                target = base() / "docs" / rel
                target.parent.mkdir(parents=True, exist_ok=True)
                tmp = target.with_name(target.name + ".part")
                tmp.write_bytes(data)
                os.replace(tmp, target)
                item.update(path=rel, size_bytes=len(data))
            except (Defer, dr.Gone, ValueError) as exc:
                item["why"] = str(exc)[:200] or type(exc).__name__
            except Exception:  # noqa: BLE001 - a paper Drive did not hand over this time is asked again next pass
                continue
            items.append(item)
        if more:
            break
    if not more:
        (base() / "docs").mkdir(parents=True, exist_ok=True)
        (base() / "docs" / ".fetched").write_text(datetime.now(NY).isoformat(), encoding="utf-8")
    return {"status": 200, "data": {"items": items, "more": more}}


def truelink_sync(sess: L.Session, payload: dict) -> dict[str, Any]:
    """truelinkSync's call (TrueLink.gs): the browser automation asked to run the TrueLink task; its run is recorded by
    truelinkRunKeep (the relay chains the two, then brings the ledger's new rows in)."""
    if not admin(sess.user):
        return dict(DENIED)
    url = os.getenv("BROWSER_AUTOMATION_URL", "").strip() or s_(sess.reads.db.prop("BROWSER_AUTOMATION_URL"))
    secret = os.getenv("BROWSER_AUTOMATION_BOT_SECRET", "").strip()
    if not url:
        return {"status": 503, "message": "Set BROWSER_AUTOMATION_URL — the address the browser automation answers on."}
    if not secret:
        return {"status": 503, "message": "Set BROWSER_AUTOMATION_BOT_SECRET in the app's environment. The service "
                                          "refuses unauthenticated callers."}
    import urllib.error  # noqa: PLC0415
    import urllib.request  # noqa: PLC0415
    dry = not (isinstance(payload, dict) and payload.get("dry_run") is False)
    creds = {k: v for k, v in (("email", os.getenv("TRUELINK_EMAIL", "").strip()),
                               ("password", os.getenv("TRUELINK_PASSWORD", ""))) if v}
    if len(creds) == 1:
        return {"status": 503, "message": "Only one of TRUELINK_EMAIL / TRUELINK_PASSWORD is set. Set both, or "
                                          "neither and let the server hold them."}
    req = urllib.request.Request(url, data=json.dumps({"task": "truelink", "params": {"dry_run": dry, **creds}}).encode(),
                                 headers={"Content-Type": "application/json", "Authorization": f"Bearer {secret}"},
                                 method="POST")
    try:
        with urllib.request.urlopen(req, timeout=240) as res:  # noqa: S310 - the platform's own automation
            code, text = res.status, res.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as exc:
        code, text = exc.code, exc.read(4000).decode("utf-8", "replace")
    except Exception as exc:  # noqa: BLE001
        return {"status": 502, "message": f"The automation service could not be reached ({type(exc).__name__})."}
    if code != 200:
        try:
            detail = s_(json.loads(text).get("err")) or text
        except ValueError:
            detail = text
        return {"status": 502, "message": f"The service answered {code}: {detail[:300]}"}
    try:
        body = json.loads(text)
    except ValueError:
        body = None
    if not isinstance(body, dict) or body.get("ok") is False:
        err = s_((body or {}).get("err")) or "unreadable answer"
        shot = " · screenshot: " + s_(body.get("screenshot")) if isinstance(body, dict) and body.get("screenshot") else ""
        return {"status": 502, "message": "The sync failed: " + err + shot}
    r = body.get("result") if isinstance(body.get("result"), dict) else {}
    un = r.get("unmatched") if isinstance(r.get("unmatched"), list) else []
    return {"status": 200, "data": {"dryRun": bool(r.get("dry_run")), "imported": int(r.get("imported") or 0),
                                    "wouldImport": int(r.get("would_import") or 0), "skipped": int(r.get("skipped") or 0),
                                    "unreadable": int(r.get("unreadable") or 0), "unmatched": un,
                                    "message": s_(r.get("message")), "run_row_refused": ""}}


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {
    "finClients": clients_door, "finLedger": ledger_door, "finClientCounts": counts_door,
    "finBalances": balances_door, "finCloseOutPreview": preview_door, "finAnalytics": analytics_door,
    "finLedgerHistory": history_door, "finDocs": docs_door, "finDocFile": doc_file, "finDocsFetch": docs_fetch,
    "finReceiptRead": receipt_read, "truelinkSync": truelink_sync}
_ROLES = ("admin", "manager")
POLICY: dict[str, dict[str, Any]] = {a: {"roles": _ROLES} for a in ACTIONS}
POLICY["finDocsFetch"] = {}
POLICY["truelinkSync"] = {"roles": ("admin",)}
