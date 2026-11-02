"""Client Finances' writes on Python (Finance.gs, TrueLink.gs): a transaction recorded (its receipt already kept and
judged by finance.receipt_read, which the relay asks first), a receipt attached, a spend marked as having none, a
month closed, an opening seeded, a card export imported, the vocabularies saved (app.edits over the shared
finance_config tab) — the ledger, the balances and the TrueLink runs kept in Postgres alone (app.resource_rows)."""
from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any, Callable

import finance as F
import gsjs
import house_tables as HT
import locations as L
import resource_rows as RR
import sheet_resources as SR
import smart_comms as SC
import writes as W
from writes import Decision

BUSY = "Somebody else is changing the client finances right now — try again."
NOT_READ = "The receipt was not read before this write — nothing was saved. Try again."

s_ = gsjs.str_


def _who(user: dict) -> str:
    return s_(user.get("display_name")) or s_(user.get("email"))


def _row(reads: L.Reads, resource: str, rid: str) -> tuple[str, dict] | None:
    return next(((k, c) for k, c in RR.table_rows(reads, resource) if s_(c.get("id")) == rid), None)


def _create(reads: L.Reads, resource: str, cells: dict, by: str) -> dict:
    """createRow_: an id, createdAt and updatedAt stamped, the cells kept as text."""
    now = W.now_iso(reads)
    rec = {"id": W.mint(), "createdAt": now, "updatedAt": now, **cells}
    RR.create(reads, resource, {k: gsjs.js_str(v) for k, v in rec.items() if v not in (None, "")}, by)
    return rec


def _update(reads: L.Reads, resource: str, rid: str, changed: dict, by: str) -> bool:
    hit = _row(reads, resource, rid)
    if hit is None:
        return False
    RR.update(reads, resource, hit[0], hit[1], {**{k: gsjs.js_str(v) for k, v in changed.items()},
                                                "updatedAt": W.now_iso(reads)}, by)
    return True


def _receipt(payload: dict) -> dict | None:
    kept = payload.get("receiptKept")
    return kept if isinstance(kept, dict) and s_(kept.get("path")) else None


def submit(sess: L.Session, payload: dict) -> Decision:
    """finSubmitTransaction: Spending and Withdraw stored negative; the receipt, when one came, already kept."""
    user = sess.user or {}
    if not F.may_use(user):
        return Decision(dict(F.DENIED))
    p = payload if isinstance(payload, dict) else {}
    client, day, ttype, fund = s_(p.get("client")), s_(p.get("date")), s_(p.get("type")), s_(p.get("fundType"))
    if not client:
        return W.refuse(400, "Client is required.")
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", day):
        return W.refuse(400, "Date must be YYYY-MM-DD.")
    if ttype not in F.TXN_TYPES:
        return W.refuse(400, "Type must be one of: " + ", ".join(F.TXN_TYPES) + ".")
    funds = F.vocabulary(sess.reads)["fundTypes"]
    if fund not in funds:
        return W.refuse(400, "Fund must be one of: " + ", ".join(funds) + ".")
    amount = F.num(p.get("amount"))
    if not amount > 0:
        return W.refuse(400, "Amount must be a positive number.")
    if ttype in ("Spending", "Withdraw"):
        amount = -abs(amount)
    if s_(p.get("receiptBase64")) and _receipt(p) is None:
        return W.refuse(503, NOT_READ)
    kept = _receipt(p) or {}
    rec = _create(sess.reads, F.TXNS, {
        "client": client, "date": day, "month": F.month_of(day), "type": ttype, "fundType": fund, "amount": amount,
        "vendor": s_(p.get("vendor")), "category": s_(p.get("category")), "description": s_(p.get("description")),
        "staffMember": s_(p.get("staffMember")) or _who(user), "receiptFileId": "",
        "receiptPath": s_(kept.get("path")), "receiptName": s_(kept.get("name")),
        "receiptVerdict": s_(kept.get("verdict")) or "NONE", "receiptNote": s_(kept.get("note")),
        "source": "hub", "enteredBy": s_(user.get("email"))}, s_(user.get("email")))
    return Decision({"status": 200, "data": {"id": rec["id"], "amount": amount, "receipt": s_(kept.get("name")),
                                             "verdict": s_(kept.get("verdict")) or "NONE",
                                             "note": s_(kept.get("note"))}}, subject="", own=True)


def attach(sess: L.Session, payload: dict) -> Decision:
    """finAttachReceipt: a receipt (already kept and judged) recorded on a row that exists."""
    user = sess.user or {}
    if not F.may_use(user):
        return Decision(dict(F.DENIED))
    p = payload if isinstance(payload, dict) else {}
    rid = s_(p.get("id"))
    if not rid:
        return W.refuse(400, "Which transaction?")
    kept = _receipt(p)
    if kept is None:
        return W.refuse(400 if not s_(p.get("receiptBase64")) else 503,
                        "No file was sent." if not s_(p.get("receiptBase64")) else NOT_READ)
    if not _update(sess.reads, F.TXNS, rid, {"receiptFileId": "", "receiptPath": s_(kept["path"]),
                                             "receiptName": s_(kept.get("name")),
                                             "receiptVerdict": s_(kept.get("verdict")),
                                             "receiptNote": s_(kept.get("note"))}, s_(user.get("email"))):
        return W.refuse(404, f'No "{F.TXNS}" record with id "{rid}".')
    return Decision({"status": 200, "data": {"id": rid, "receipt": s_(kept.get("name")), "verdict": s_(kept.get("verdict")),
                                             "note": s_(kept.get("note"))}}, subject="", own=True)


def no_receipt(sess: L.Session, payload: dict) -> Decision:
    """finMarkNoReceipt: a spend whose receipt is not coming, from the closed list of reasons, attested."""
    user = sess.user or {}
    if not F.may_use(user):
        return Decision(dict(F.DENIED))
    p = payload if isinstance(payload, dict) else {}
    rid, reason = s_(p.get("id")), s_(p.get("reason"))
    if not rid:
        return W.refuse(400, "Which transaction?")
    reasons = F.vocabulary(sess.reads)["exemptReasons"]
    if reason not in reasons:
        return W.refuse(400, "Reason must be one of: " + ", ".join(reasons) + ".")
    hit = _row(sess.reads, F.TXNS, rid)
    if hit is None:
        return W.refuse(404, f'No "{F.TXNS}" record with id "{rid}".')
    if s_(hit[1].get("receiptName")):
        return W.refuse(409, "That transaction already has a receipt on file.")
    note = (f"{reason} — attested by {_who(user)} on {datetime.now(F.NY).strftime('%Y-%m-%d')}"
            + (" · " + s_(p.get("note")) if s_(p.get("note")) else ""))
    _update(sess.reads, F.TXNS, rid, {"receiptVerdict": "EXEMPT", "receiptNote": note}, s_(user.get("email")))
    return Decision({"status": 200, "data": {"id": rid, "verdict": "EXEMPT", "reason": reason}}, subject="", own=True)


def close_month(sess: L.Session, payload: dict) -> Decision:
    """finCloseMonth (admins): this month Closed per fund, the next one Open with the closing carried forward."""
    user = sess.user or {}
    if not F.admin(user):
        return Decision(dict(F.DENIED))
    p = payload if isinstance(payload, dict) else {}
    client, month = s_(p.get("client")), s_(p.get("month"))
    if not client or not month:
        return W.refuse(400, "Client and month are both required.")
    reads = sess.reads
    existing = F.balances_for(reads, client)
    if any(s_(b.get("month")) == month and s_(b.get("status")) == "Closed" for b in existing):
        return W.refuse(409, f"{month} is already closed for {client}.")
    led = F.ledger(reads, client, month)
    when = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.") + "000Z"
    by, email = _who(user), s_(user.get("email"))
    nxt = F.next_month(month)
    for f in led["funds"]:
        values = {"client": client, "fundType": f["fundType"], "month": month, "opening": f["opening"],
                  "deposits": f["deposits"], "spending": f["spending"], "closing": f["closing"], "status": "Closed",
                  "closedBy": by, "closedAt": when}
        row = next((b for b in existing if s_(b.get("month")) == month and s_(b.get("fundType")) == f["fundType"]), None)
        if row is not None:
            _update(reads, F.BALANCES, s_(row.get("id")), values, email)
        else:
            _create(reads, F.BALANCES, values, email)
        nrow = next((b for b in existing if s_(b.get("month")) == nxt and s_(b.get("fundType")) == f["fundType"]), None)
        if nrow is not None:
            _update(reads, F.BALANCES, s_(nrow.get("id")), {"opening": f["closing"]}, email)
        else:
            _create(reads, F.BALANCES, {"client": client, "fundType": f["fundType"], "month": nxt,
                                        "opening": f["closing"], "deposits": 0, "spending": 0, "closing": f["closing"],
                                        "status": "Open", "closedBy": "", "closedAt": ""}, email)
    return Decision({"status": 200, "data": {"closed": True, "month": month, "funds": led["funds"]}}, subject="",
                    own=True)


def seed_balance(sess: L.Session, payload: dict) -> Decision:
    """finSeedBalance (admins): an opening for a month a fund has none for; never an overwrite."""
    user = sess.user or {}
    if not F.admin(user):
        return Decision(dict(F.DENIED))
    p = payload if isinstance(payload, dict) else {}
    client, fund, month = s_(p.get("client")), s_(p.get("fundType")), s_(p.get("month"))
    if not client or not month:
        return W.refuse(400, "Client and month are both required.")
    if fund not in F.FUND_TYPES:
        return W.refuse(400, "Fund must be one of: " + ", ".join(F.FUND_TYPES) + ".")
    amount = F.num(p.get("amount"))
    if any(s_(b.get("month")) == month and s_(b.get("fundType")) == fund for b in F.balances_for(sess.reads, client)):
        return W.refuse(409, f"{fund} already has a {month} balance for {client}. Correct it with a Deposit or a "
                             "Withdraw, so the change is on the record.")
    _create(sess.reads, F.BALANCES, {"client": client, "fundType": fund, "month": month, "opening": amount,
                                     "deposits": 0, "spending": 0, "closing": amount, "status": "Open",
                                     "closedBy": "", "closedAt": ""}, s_(user.get("email")))
    return Decision({"status": 200, "data": {"seeded": True, "opening": amount}}, subject="", own=True)


def fingerprint(client: Any, day: Any, vendor: Any, amount: Any) -> str:
    """finFingerprint_."""
    return (s_(client).lower() + "|" + s_(day) + "|" + " ".join(s_(vendor).lower().split()) + "|"
            + f"{F.num(amount):.2f}")


def import_card(sess: L.Session, payload: dict) -> Decision:
    """finImportCard: a card export appended, deduped on client|date|vendor|amount; unmatched names reported."""
    user = sess.user or {}
    if not F.may_use(user):
        return Decision(dict(F.DENIED))
    rows = (payload or {}).get("rows") if isinstance(payload, dict) else None
    if not isinstance(rows, list) or not rows:
        return W.refuse(400, "No rows were sent.")
    if len(rows) > 2000:
        return W.refuse(400, "That is more than 2000 rows — split the export.")
    reads = sess.reads
    known = {c["name"].lower(): c["name"] for c in F.fin_clients(reads)}
    seen = {fingerprint(r.get("client"), r.get("date"), r.get("vendor"), r.get("amount")) for r in F.txn_rows(reads)}
    imported = skipped = bad = 0
    unmatched: dict[str, int] = {}
    for r in rows:
        r = r if isinstance(r, dict) else {}
        name = s_(r.get("client"))
        real = known.get(name.lower())
        if not real:
            unmatched[name or "(blank)"] = unmatched.get(name or "(blank)", 0) + 1
            continue
        day = s_(r.get("date"))
        amount = F.num(r.get("amount"))
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", day) or not amount:
            bad += 1
            continue
        fund = s_(r.get("fundType")) or "Debit Card"
        fund = fund if fund in F.FUND_TYPES else "Debit Card"
        fp = fingerprint(real, day, r.get("vendor"), amount)
        if fp in seen:
            skipped += 1
            continue
        seen.add(fp)
        _create(reads, F.TXNS, {"client": real, "date": day, "month": F.month_of(day),
                                "type": "Spending" if amount < 0 else "Deposit", "fundType": fund, "amount": amount,
                                "vendor": s_(r.get("vendor")), "category": s_(r.get("category")),
                                "description": s_(r.get("description")), "receiptVerdict": "NONE",
                                "postedDate": s_(r.get("postedDate")), "location": s_(r.get("location")),
                                "accountId": s_(r.get("accountId")), "accountLast4": s_(r.get("accountLast4")),
                                "cardType": s_(r.get("cardType")), "source": "truelink",
                                "enteredBy": s_(user.get("email"))}, s_(user.get("email")))
        imported += 1
    return Decision({"status": 200, "data": {"imported": imported, "skipped": skipped, "unreadable": bad,
                                             "unmatched": [{"name": k, "rows": v} for k, v in unmatched.items()]}},
                    subject="", own=True)


def settings_set(sess: L.Session, payload: dict) -> Decision:
    """finSettingsSet (admins): the vocabularies only add to the floor; a fund in use is never removed. Kept in app.edits
    over the shared finance_config tab."""
    user = sess.user or {}
    if not F.admin(user):
        return Decision(dict(F.DENIED))
    p = payload if isinstance(payload, dict) else {}
    reads = sess.reads
    used: dict[str, int] = {}
    for r in F.txn_rows(reads):
        if s_(r.get("fundType")):
            used[s_(r.get("fundType"))] = used.get(s_(r.get("fundType")), 0) + 1
    res = W.tab_of(reads, F.CONFIG_TAB)
    rows = {s_(r.get("key")): r for r in F.config_rows(reads)}
    saved = F.vocabulary(reads)
    edits = []
    for key in F.CFG_KEYS:
        if not p.get(key):
            continue
        wanted: list[str] = []
        for v in p.get(key) or []:
            t = s_(v).strip()
            if t and t not in wanted:
                wanted.append(t)
        lost = [v for v in F.FLOOR[key] if v not in wanted]
        if lost:
            return W.refuse(400, "These are built in and cannot be removed: " + ", ".join(lost) + ".")
        if key == "fundTypes":
            in_use = [f for f in used if f not in wanted]
            if in_use:
                return W.refuse(409, "Still in use, so it cannot be removed: "
                                + ", ".join(f"{f} ({used[f]} transaction(s))" for f in in_use) + ".")
        extra = "|".join(v for v in wanted if v not in F.FLOOR[key])
        saved[key] = list(F.FLOOR[key]) + [v for v in wanted if v not in F.FLOOR[key]]
        row = rows.get(key)
        if HT.tabled(F.CONFIG_TAB):
            if row is not None and s_(row.get("id")):
                HT.put(reads, F.CONFIG_TAB, "id", s_(row.get("id")), {"value": extra}, s_(user.get("email")))
            else:
                RR.create(reads, HT.resource_of(F.CONFIG_TAB) or "", {"id": W.mint(), "key": key, "value": extra},
                          s_(user.get("email")))
            continue
        if row is not None and s_(row.get("id")):
            edits.append(W.kept_record(res.sheet_id, res.ref.tab if res.ref is not None else F.CONFIG_TAB, "edit",
                                       "id", s_(row.get("id")), "", {"value": extra}, {"value": s_(row.get("value"))}))
        else:
            rid = W.mint()
            edits.append(W.kept_record(res.sheet_id, res.ref.tab if res.ref is not None else F.CONFIG_TAB, "append",
                                       "id", rid, "", {"id": rid, "key": key, "value": extra}))
    if HT.tabled(F.CONFIG_TAB):
        return Decision({"status": 200, "data": saved}, own=True)
    return W.final({"status": 200, "data": saved}, edits, "")


def run_keep(sess: L.Session, payload: dict) -> Decision:
    """truelinkRunKeep (the relay's, after truelinkSync answered): the run recorded in truelinkRuns."""
    user = sess.user or {}
    if not F.admin(user):
        return Decision(dict(F.DENIED))
    r = payload if isinstance(payload, dict) else {}
    un = r.get("unmatched") if isinstance(r.get("unmatched"), list) else []
    dry = bool(r.get("dryRun"))
    _create(sess.reads, F.RUNS, {"at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z"),
                                 "by": s_(user.get("email")), "mode": "REHEARSAL" if dry else "sync complete",
                                 "verb": "would be added" if dry else "added",
                                 "found": int(r.get("wouldImport") if dry else r.get("imported") or 0),
                                 "skipped": int(r.get("skipped") or 0), "unreadable": int(r.get("unreadable") or 0),
                                 "tail": (f"{len(un)} cardholder name(s) did not match a client and were NOT imported: "
                                          + ", ".join(s_((u or {}).get("name")) for u in un)) if un
                                 else ("Nothing was written." if dry else ""), "reported": ""}, s_(user.get("email")))
    return Decision({"status": 200, "data": {"kept": True}}, subject="", own=True)


def docs_keep(sess: L.Session, payload: dict) -> Decision:
    """finDocsKeep (the relay's own): what its pass brought in from the finance folder recorded."""
    if (sess.user or {}).get("is_service") is not True:
        return Decision({"status": 403, "message": "This is the relay's own write."})
    items = (payload or {}).get("items") if isinstance(payload, dict) else None
    if not isinstance(items, list):
        return W.refuse(400, "items is a list.")
    cur = RR._cur()
    for it in items:
        if not isinstance(it, dict) or not s_(it.get("drive_id")):
            continue
        cur.execute(f"insert into {F.DOCS} (drive_id, subfolder, name, mime, size_bytes, google_modified, link, path, why,"
                    " write_id) values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s) on conflict (drive_id) do update set"
                    " subfolder = excluded.subfolder, name = excluded.name, mime = excluded.mime,"
                    " size_bytes = excluded.size_bytes, google_modified = excluded.google_modified,"
                    " link = excluded.link, path = excluded.path, why = excluded.why, kept_at = now(),"
                    " write_id = excluded.write_id",
                    (s_(it["drive_id"]), s_(it.get("subfolder")), s_(it.get("name")), s_(it.get("mime")),
                     int(it.get("size_bytes") or 0), s_(it.get("google_modified")), s_(it.get("link")),
                     s_(it.get("path")), s_(it.get("why")), SC.write_id()))
    return Decision({"status": 200, "data": {"kept": len(items)}}, subject="", own=True)


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {
    "finSubmitTransaction": submit, "finAttachReceipt": attach, "finMarkNoReceipt": no_receipt,
    "finCloseMonth": close_month, "finSeedBalance": seed_balance, "finImportCard": import_card,
    "finSettingsSet": settings_set, "truelinkRunKeep": run_keep, "finDocsKeep": docs_keep,
    "financeTransactionsCreate": lambda s, p: SR.create_row(s, F.TXNS, p),
    "financeTransactionsUpdate": lambda s, p: SR.update_row(s, F.TXNS, p),
    "financeTransactionsDelete": lambda s, p: SR.delete_row(s, F.TXNS, p),
    "financeUpload": RR.upload_door({r: SR.SPECS[r] for r in (F.TXNS, F.BALANCES, F.RUNS)})}
_ROLES = ("admin", "manager")
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
POLICY.update({a: {"roles": _ROLES} for a in ("finSubmitTransaction", "finAttachReceipt", "finMarkNoReceipt",
                                               "finImportCard")})
POLICY.update({a: {"roles": ("admin",)} for a in ("finCloseMonth", "finSeedBalance", "finSettingsSet",
                                                   "truelinkRunKeep")})
BUSY_OF: dict[str, dict[str, Any]] = {a: {"status": 409, "message": BUSY} for a in ACTIONS}


class Store(RR.Store):
    """app.finance_writes and app.finance_receipts, beside the other apps' own; rows app.resource_rows', the
    vocabularies' cells app.edits'."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="finance", label="Client Finances")
