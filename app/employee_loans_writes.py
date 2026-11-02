"""Employee Loans' writes (EmployeeLoans.gs), kept in Postgres alone (app/resource_rows.py): a loan request filed for
a staff member, an item waiting on each Scheduling director in My Work and a text to each through Smart Comms — held
in its outbox through the quiet window and said in the morning only while the request still waits, since the first
answer withdraws the rest (employeeLoanRequest, employeeLoanAnswer); a payment on an approved loan
(employeeLoanPayment). employeeLoansUpload brings the house into Postgres for the relay as the app is given to Python,
and hands it back as it returns to Apps Script."""
from __future__ import annotations

import hashlib
import re
from datetime import date
from typing import Any, Callable

import gsjs
import locations as L
import resource_rows as RR
import smart_comms as SC
import staff_perf as SPF
import writes as W
from scope import Defer
from writes import Decision

RESOURCE = SPF.EL_RESOURCE
SITUATION = "staff_loan_request"
LANE = "employee loans"
MAX_CENTS = 10000000
ITEM_ID = re.compile(r"^EI[0-9A-F]{10}$")
LOAN_ID = re.compile(r"^loan-\d{4}-\d{2,4}$")
VISITING = "Do this from your own account — not while visiting someone else."
PLATFORM_URL = "https://asamylife.asalifecare.com"
MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")

s_ = SPF.el_str


def _text(v: Any, most: int = 240) -> str:
    """elText_."""
    return re.sub(r"\s+", " ", s_(v))[:most]


def _money(c: int) -> str:
    """elMoney_."""
    whole, cents = SPF.el_dollars(c).split(".")
    return "$" + re.sub(r"\B(?=(\d{3})+(?!\d))", ",", whole) + "." + cents


def _day(v: Any) -> str:
    """elDay_: a real YYYY-MM-DD, else ''."""
    s = s_(v)
    m = re.fullmatch(r"(\d{4})-(\d{2})-(\d{2})", s)
    if not m:
        return ""
    try:
        date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    except ValueError:
        return ""
    return s


def _day_words(iso: str) -> str:
    """elDayWords_."""
    m = re.fullmatch(r"(\d{4})-(\d{2})-(\d{2})", s_(iso))
    return f"{MONTHS[int(m.group(2)) - 1]} {m.group(3)}, {m.group(1)}" if m else s_(iso)


def _sha10(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:10].upper()


def _test_word(reads: L.Reads) -> str:
    """elTestWord_: 'no' only when test mode reads as off."""
    import smart_comms_desk as SCD  # noqa: PLC0415
    try:
        st = SCD.test_mode_state(reads.config())
        return "no" if st.get("on") is False and not st.get("unrecognized") else "yes"
    except Exception:  # noqa: BLE001 - an unreadable switch reads as on
        return "yes"


def _phone_of(reads: L.Reads, uid: str) -> str:
    """elPhoneOf_: the live account's own phone a text may go to."""
    import support_desk_writes as SDW  # noqa: PLC0415 - the same account phone rule
    for u in reads.users():
        if s_(u.get("userid")) != uid or s_(u.get("mergedinto")):
            continue
        if s_(u.get("active")).upper() in ("FALSE", "0", "NO"):
            return ""
        return SDW.phone_of(u)
    return ""


def _who(sess: L.Session) -> tuple[dict[str, Any], str]:
    """elGate_ and the session's own name."""
    user = sess.user or {}
    g = SPF.el_gate(sess.reads, user)
    name = s_(user.get("display_name")) or s_(user.get("email"))
    return g, name


def _pay_open(sess: L.Session) -> bool:
    """Staff's Employee Pay as App Control opens it: anyone else's loan is paid from there."""
    import staff as SP  # noqa: PLC0415 - the Staff core loads beside this module
    return SP.tab_open(sess, SP.PAY_FEATURE)


def _rows(reads: L.Reads) -> list[dict[str, str]]:
    """Every loan, item and payment row Postgres holds; Defer while the house is not uploaded yet."""
    if not RR.uploaded(reads.db, RESOURCE):
        raise Defer("the employee loans are not in Postgres yet: the app is uploaded as it is given to Python")
    return [row for row in ({h: s_(c.get(h)) for h in SPF.EL_HEADER} for _k, c in RR.table_rows(reads, RESOURCE))
            if row["id"] and row["kind"]]


def _put(reads: L.Reads, row: dict[str, str], by: str) -> None:
    """elPut_: a row written whole — added when it is new, changed in place when Postgres holds it."""
    cells = {h: s_(row.get(h)) for h in SPF.EL_HEADER}
    hit = RR.find(reads, RESOURCE, cells["id"])
    if hit is None:
        RR.create(reads, RESOURCE, cells, by)
    else:
        RR.update(reads, RESOURCE, hit[0], hit[1], cells, by)


def _tell(reads: L.Reads, loan: dict[str, str], item: dict[str, str]) -> dict[str, Any]:
    """elTell_: the text to one director through Smart Comms (held through the quiet window and said in the morning)."""
    vars_ = {"employee": loan["staff_name"], "amount": _money(SPF.el_cents(loan["amount"]) or 0),
             "date": _day_words(loan["date"]), "requester": loan["created_by"], "link": PLATFORM_URL + "/#/app/my-work"}
    key = "el|" + SITUATION + "|" + loan["id"] + "|" + item["to_uid"]
    return SC.raise_situation(None, situation=SITUATION, to=_phone_of(reads, item["to_uid"]), vars=vars_, key=key,
                              person=item["to_name"], lane=LANE, at_ms=int(reads.now.timestamp() * 1000), prune=True)


def _text_words(results: list[dict[str, Any]]) -> str:
    """elTextWords_."""
    sent, held, other = 0, [], []
    for r in results:
        st = s_(r.get("state"))
        if st in ("sent", "already"):
            sent += 1
        elif st == "held":
            h = s_(r.get("held"))
            held.append("test mode" if h == "test_mode" else "quiet hours, said at 08:00" if h == "quiet" else h)
        else:
            other.append(s_(r.get("why")) or st)
    parts = []
    if sent:
        parts.append(f"{sent} text{'' if sent == 1 else 's'} sent")
    if held:
        parts.append("texts held (" + ", ".join(dict.fromkeys(held)) + ")")
    if other:
        parts.append("not texted: " + "; ".join(other[:2]))
    return " · ".join(parts) + "." if parts else ""


def request(sess: L.Session, payload: dict) -> Decision:
    """employeeLoanRequest: filed as requested, a My Work item and a text to each director; the first answer decides."""
    reads = sess.reads
    g, name = _who(sess)
    # filed from Staff's Employee Pay: a director the tab's App Control row shuts out files none
    if not (g["master"] or (g["director"] and _pay_open(sess))):
        return Decision(SPF.el_unknown())
    if g["visiting"]:
        return W.refuse(403, VISITING)
    p = payload if isinstance(payload, dict) else {}
    ctx = SPF._staff().person_for(sess, p.get("staff"))
    if ctx.get("refused"):
        return Decision(ctx["refused"])
    cents = SPF.el_cents(p.get("amount"))
    if cents is None or cents <= 0 or cents > MAX_CENTS:
        return W.refuse(400, "amount: a loan amount above $0.00.")
    day = _day(p.get("date"))
    if not day:
        return W.refuse(400, "date: the disbursement date.")
    purpose = gsjs.trim(gsjs.or_blank(p.get("purpose")))
    if len(purpose) > 300:
        return W.refuse(400, "purpose: at most 300 characters.")
    dirs = SPF.sched_directors(reads)
    if not dirs["readable"]:
        return W.refuse(503, "Nobody is set to approve loan requests: " + dirs["why"] + ".")
    askable = [d for d in dirs["list"] if d["uid"] != g["uid"]]
    if not askable:
        return W.refuse(409, "Nobody else can approve this request.")
    rows = _rows(reads)
    year = reads.today()[:4]
    n = max([int(m.group(2)) for m in (re.fullmatch(r"loan-(\d{4})-(\d+)", r["id"]) for r in rows if r["kind"] == "loan")
             if m and m.group(1) == year] or [0])
    seq = str(n + 1)
    lid = f"loan-{year}-" + ("0" + seq)[-max(2, len(seq)):]
    now, test = W.now_iso(reads), _test_word(reads)
    acct = ctx.get("account") or {}
    loan = {"id": lid, "kind": "loan", "loan_id": lid, "staff_key": ctx["key"], "staff_name": ctx["name"],
            "staff_uid": s_(acct.get("user_id")), "label": _text(purpose, 60) or "Employee Loan", "purpose": purpose,
            "amount": SPF.el_dollars(cents), "date": day, "method": "", "state": "requested", "test_mode": test,
            "created_at": now, "created_by": name, "created_by_uid": g["uid"], "updated_at": now}
    facts = [{"label": k, "value": _text(v, 240)} for k, v in (
        ("Employee", ctx["name"]), ("Loan", lid), ("Amount", _money(cents)), ("Disbursement date", _day_words(day)),
        ("Purpose", purpose), ("Requested by", name)) if v]
    import json  # noqa: PLC0415
    items = [{"id": "EI" + _sha10(lid + "|" + d["uid"]), "kind": "ask", "loan_id": lid, "staff_key": ctx["key"],
              "staff_name": ctx["name"], "box": "work", "seat": "director", "to_uid": d["uid"],
              "to_email": s_(d.get("email")), "to_name": s_(d.get("name")),
              "title": "Employee loan request — " + ctx["name"], "body": _money(cents) + " · " + loan["label"],
              "facts": json.dumps(facts, separators=(",", ":"), ensure_ascii=False), "date": day, "state": "waiting",
              "link": "/app/my-work", "test_mode": test, "created_at": now, "created_by": name,
              "created_by_uid": g["uid"], "updated_at": now} for d in askable]
    by = s_((sess.user or {}).get("email"))
    for row in [loan] + items:
        _put(reads, row, by)
    results = [_tell(reads, loan, it) for it in items]
    names = [s_(d.get("name")) for d in askable]
    said = "Requested. " + " and ".join(names) + (" has it." if len(names) == 1 else " have it — the first answer decides.")
    words = _text_words(results)
    return Decision({"status": 200, "data": {"loan_id": lid, "said": said + (" " + words if words else "")}},
                    subject=ctx["key"], own=True)


def answer(sess: L.Session, payload: dict) -> Decision:
    """employeeLoanAnswer: a director's approve or decline from My Work; the first answer decides, and the texts still
    owed to the other directors are withdrawn."""
    reads = sess.reads
    g, name = _who(sess)
    if g["visiting"] or not g["uid"]:
        return W.refuse(403, VISITING)
    p = payload if isinstance(payload, dict) else {}
    iid = _text(p.get("item_id"), 20)
    if not ITEM_ID.match(iid):
        return W.refuse(400, "Unknown item.")
    word = s_(p.get("word")).lower()
    if word not in ("approve", "decline"):
        return W.refuse(400, "Answer with approve or decline.")
    note = gsjs.trim(gsjs.or_blank(p.get("note")))
    if len(note) > 500:
        return W.refuse(400, "A note can be at most 500 characters.")
    rows = _rows(reads)
    item = next((r for r in rows if r["kind"] == "ask" and r["id"] == iid), None)
    if item is None or item["box"] != "work":
        return W.refuse(404, "This loan request is not waiting any more.")
    if item["to_uid"] != g["uid"] and not (g["master"] and item["seat"] == "director"):
        return W.refuse(403, "This one is waiting on " + (item["to_name"] or "someone else") + ".")
    loan = next((r for r in rows if r["kind"] == "loan" and r["id"] == item["loan_id"]), None)
    if loan is None:
        return W.refuse(404, "The loan request behind this item is gone.")
    if loan["created_by_uid"] == g["uid"] and not g["master"]:
        return W.refuse(403, "Nobody answers their own request.")
    by, now = s_((sess.user or {}).get("email")), W.now_iso(reads)
    if item["state"] != "waiting" or loan["state"] != "requested":
        if item["state"] == "waiting":
            _put(reads, {**item, "state": "superseded", "answered_by": loan["answered_by"], "answered_at": now}, by)
        out = {"changed": False, "state": "superseded" if item["state"] == "waiting" else item["state"],
               "said": "Already answered by " + (loan["answered_by"] or "someone") + "."}
    else:
        approved = word == "approve"
        state = "approved" if approved else "declined"
        _put(reads, {**loan, "state": state, "answered_by": name, "answered_at": now, "note": note, "updated_at": now},
             by)
        _put(reads, {**item, "state": state, "answered_by": name, "answered_at": now, "note": note}, by)
        for r in rows:
            if r["kind"] == "ask" and r["id"] != item["id"] and r["loan_id"] == loan["id"] and r["state"] == "waiting":
                _put(reads, {**r, "state": "superseded", "answered_by": name, "answered_at": now}, by)
        # said only while it still waits: the texts the quiet window holds for the other directors are taken back
        held = SC._WRITE.get() or {}
        if held.get("tx") is not None:
            SC.cancel_owed(held["tx"], "el|" + SITUATION + "|" + loan["id"] + "|", "the loan request was answered")
        out = {"changed": True, "state": state,
               "said": ("Approved. " + loan["staff_name"] + "'s loan of " + _money(SPF.el_cents(loan["amount"]) or 0)
                        + " is outstanding in full.") if approved
               else "Declined. The request stays on " + loan["staff_name"] + "'s record as declined."}
    return Decision({"status": 200, "data": {"ok": True, "changed": out["changed"], "said": out["said"],
                                             "state": out["state"]}}, subject=loan["staff_key"], own=True)


def payment(sess: L.Session, payload: dict) -> Decision:
    """employeeLoanPayment: a payment on an approved loan, at most what is outstanding."""
    reads = sess.reads
    g, name = _who(sess)
    if not g["uid"] and not g["master"]:
        return Decision(SPF.el_unknown())
    if g["visiting"]:
        return W.refuse(403, VISITING)
    p = payload if isinstance(payload, dict) else {}
    lid = _text(p.get("loan_id"), 20)
    if not LOAN_ID.match(lid):
        return W.refuse(400, "loan_id: the loan.")
    cents = SPF.el_cents(p.get("amount"))
    if cents is None or cents <= 0:
        return W.refuse(400, "amount: a payment above $0.00.")
    day = _day(p.get("date"))
    if not day:
        return W.refuse(400, "date: the payment date.")
    method = s_(p.get("method")).lower()
    if method not in SPF.EL_METHODS:
        return W.refuse(400, "method: " + " or ".join(SPF.EL_METHODS) + ".")
    staff = s_(p.get("staff"))
    rows = _rows(reads)
    loan = next((r for r in rows if r["kind"] == "loan" and r["id"] == lid), None)
    own = bool(loan) and bool(loan["staff_uid"]) and loan["staff_uid"] == g["uid"]
    # the person's own loan stays theirs to pay (My Profile); anyone else's, a director's or a manager's in Employee Pay
    if loan is None or not (g["master"] or own or ((g["director"] or g["manager"]) and _pay_open(sess))):
        return Decision(SPF.el_unknown())
    if staff and staff != loan["staff_key"]:
        return W.refuse(409, "This loan is not this staff member's.")
    if loan["state"] != "approved":
        return W.refuse(409, "Only an approved loan takes payments.")
    paid = sum(SPF.el_cents(r["amount"]) or 0 for r in rows if r["kind"] == "payment" and r["loan_id"] == lid)
    owed = max(0, (SPF.el_cents(loan["amount"]) or 0) - paid)
    if not owed:
        return W.refuse(409, "This loan is paid off.")
    if cents > owed:
        return W.refuse(400, "The payment is more than the " + _money(owed) + " outstanding.")
    now = W.now_iso(reads)
    pid = "EP" + W.mint().replace("-", "")[:10].upper()
    _put(reads, {"id": pid, "kind": "payment", "loan_id": lid, "staff_key": loan["staff_key"],
                 "staff_name": loan["staff_name"], "staff_uid": loan["staff_uid"], "label": loan["label"],
                 "amount": SPF.el_dollars(cents), "date": day, "method": method, "state": "recorded", "created_at": now,
                 "created_by": name, "created_by_uid": g["uid"], "updated_at": now}, s_((sess.user or {}).get("email")))
    left = owed - cents
    return Decision({"status": 200, "data": {
        "loan_id": lid, "outstanding": SPF.el_dollars(left), "paid_off": left == 0,
        "said": ("Payment recorded. " + loan["label"] + " is paid off.") if left == 0
        else "Payment recorded. " + _money(left) + " outstanding."}}, subject=loan["staff_key"], own=True)


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {
    "employeeLoanRequest": request, "employeeLoanAnswer": answer, "employeeLoanPayment": payment,
    "employeeLoansUpload": RR.upload_door({RESOURCE: {"tab": SPF.EL_TAB}})}
_ROLES = ("admin", "director", "manager", "staff")
POLICY: dict[str, dict[str, Any]] = {
    "employeeLoanRequest": {"roles": _ROLES, "params": {"staff": "string", "amount": "string", "date": "string",
                                                         "purpose": "string"}},
    "employeeLoanAnswer": {"roles": _ROLES, "params": {"item_id": "string", "word": "string", "note": "string"}},
    "employeeLoanPayment": {"roles": _ROLES, "params": {"loan_id": "string", "amount": "string", "date": "string",
                                                         "method": "string", "staff": "string"}},
    "employeeLoansUpload": {}}
BUSY_OF: dict[str, dict[str, Any]] = {a: {"status": 409, "message": "Another write is in progress — try again in a "
                                                                    "moment."} for a in ACTIONS}


class Store(RR.Store):
    """app.employee_loans_writes and app.employee_loans_receipts, beside the other apps' own; the rows
    app.resource_rows'."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="employee_loans", label="Employee Loans")
