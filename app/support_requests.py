"""Support Requests Queue (Requests.gs) read off asa-hub-db: the 23-type queue in the Hub's `staff_requests` tab —
requestsList for the queue screen, staffRequestsList for its slice, and userSupportRequests for a person's profile.
Nothing here sends: what is owed stays a row Apps Script's Smart Comms sweep reads (requestSmartSubjects_)."""
from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any, Callable

import candidates as CND
import gsjs
import hubdb
import locations as L
import support_desk_writes as SDW
from scope import Defer

APP_ID = "support-requests"
TAB = "staff_requests"
HEADER = ("id", "createdAt", "updatedAt", "type", "urgency", "personId", "personName", "phone", "email", "details",
          "datesText", "dateFrom", "dateTo", "dateDays", "calendarName", "parseNote", "status", "verdict", "resolvedAt",
          "resolvedBy", "resolutionNote", "notifiedAt", "notifyCount")
TYPES = ("Admin - Employee Details", "Admin - Employee Verification Letters", "Admin - Incident Reports",
         "Admin - Policy/Handbook Inquiry", "Admin - Status Updates", "ADP - Direct Deposit", "ADP - Pay Stubs",
         "ADP - Request Access to ADP", "ADP - Tax/W-2", "ADP - Update Information", "Finances - Mileage Reimbursement",
         "Finances - Reimbursement", "Operations - Supplies", "Operations - Technology", "PSI - Reset Password",
         "PSI - Scheduling Help", "Safety - COVID/Illness", "Safety - Injury Reports", "Safety - Workers Comp",
         "Schedule - Call Off", "Schedule - Shift Changes", "Schedule - Time Off Request", "Other - General Requests")
STATUSES = ("open", "needs_dates", "resolved")
STALE_DAYS = 3
PII_EXACT = frozenset({"date_of_birth", "dob", "birth_date", "login", "password", "social_security",
                       "social_security_number"})
DENIED = {"status": 403, "message": "Requires an admin or manager account"}

s_ = gsjs.str_


def pii_blocked(key: Any) -> bool:
    """requestsPiiBlocked_: a column that never leaves the tab."""
    k = re.sub(r"^_+|_+$", "", re.sub(r"[^a-z0-9]+", "_", s_(key).lower()))
    return bool(k) and ("ssn" in k or k in PII_EXACT)


def writer(user: dict | None) -> bool:
    """hubIsWriter_."""
    return bool(user) and s_((user or {}).get("role")) in ("admin", "manager")


def where(reads: L.Reads) -> hubdb.Resolved:
    res = reads.db.resolve(TAB)
    if res.runtime:
        raise Defer(f"{TAB} lives in the depot's facts")
    if res.ref is None and not res.book_known:
        raise hubdb.Unreadable(f"asa-hub-db holds no copy of the book behind {TAB}")
    return res


def _text(v: Any) -> str:
    if v is None:
        return ""
    if isinstance(v, (dict, list)):
        return SDW.json_text(v)
    return gsjs.js_str(v)


def rows(reads: L.Reads) -> list[dict]:
    """requestsReadRows_: every row with an id, header-keyed text, the PII columns left out; Python's own kept edits
    laid."""
    def read() -> list[dict]:
        out = []
        for r in reads.db.sheetdb_rows(where(reads).ref):
            row = {h.strip(): _text(v) for h, v in r.items() if h.strip() and not pii_blocked(h)}
            if row.get("id"):
                out.append(row)
        return out
    return [dict(r) for r in reads.once("support-requests:rows", read)]


def _ms(v: Any) -> float | None:
    s = s_(v).strip()
    if not s:
        return None
    try:
        d = datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None
    return (d if d.tzinfo else d.replace(tzinfo=timezone.utc)).timestamp() * 1000


def _age_days(then_ms: float, now_ms: float) -> int:
    return int((now_ms - then_ms) // 86400000)


def sort_queue(lst: list[dict]) -> list[dict]:
    """Unresolved first, urgent first, then oldest (createdAt is the module's own ISO stamp)."""
    rank = {"high": 0, "mid": 1, "low": 2}
    return sorted(lst, key=lambda r: (0 if r.get("status") != "resolved" else 1, rank.get(s_(r.get("urgency")), 3),
                                      s_(r.get("createdAt"))))


def requests_list(sess: L.Session, payload: dict) -> dict[str, Any]:
    """requestsList: the queue, its counts, the types the screen files with, the stale floor."""
    if not writer(sess.user):
        return DENIED
    status = s_((payload or {}).get("status")).lower()
    if status and status not in STATUSES:
        return {"status": 400, "message": f'Unknown status "{status}". Valid: {", ".join(STATUSES)}.'}
    got = rows(sess.reads)
    now_ms = sess.reads.now.timestamp() * 1000
    counts = {"open": 0, "needs_dates": 0, "resolved": 0, "stale": 0}
    for r in got:
        st = s_(r.get("status"))
        if st in counts:
            counts[st] += 1
        if st != "resolved":
            ms = _ms(r.get("createdAt"))
            if ms is not None and _age_days(ms, now_ms) >= STALE_DAYS:
                counts["stale"] += 1
    lst = sort_queue([r for r in got if not status or s_(r.get("status")) == status])
    return {"status": 200, "data": {"requests": lst[:500], "counts": counts, "types": list(TYPES),
                                    "staleDays": STALE_DAYS}}


def staff_requests_list(sess: L.Session, payload: dict) -> dict[str, Any]:
    """The staffRequests slice: the tab's rows as the screen rebuilds its list from them."""
    if (sess.user or {}).get("is_service") is not True:
        return DENIED
    return {"status": 200, "data": rows(sess.reads)}


def _digits(v: Any) -> str:
    return re.sub(r"\D+", "", s_(v))


def user_support_requests(sess: L.Session, payload: dict) -> dict[str, Any]:
    """userSupportRequests: one account's requests, matched by the roster id, its e-mails, its numbers, and its
    full-name key only as the last resort; never a contains-match on a name."""
    user = sess.user or {}
    if user.get("is_service") is True or s_(user.get("role")) != "admin":
        return DENIED
    uid = s_((payload or {}).get("user_id"))
    if not uid:
        return {"status": 400, "message": "user_id is required"}
    reads = sess.reads
    row = next((u for u in reads.users() if s_(u.get("userid")) == uid), None)
    if row is None:
        return {"status": 404, "message": f'No user "{uid}".'}
    name_key = gsjs.name_key(row.get("displayname"))
    emails: set[str] = set()

    def take_email(e: Any) -> None:
        k = s_(e).strip().lower()
        if k and "@" in k:
            emails.add(k)
    take_email(row.get("email"))
    for e in SDW.parse_emails(row.get("emails")):
        take_email(e)
    digits: set[str] = set()

    def take(p: Any) -> None:
        d = _digits(p)[-10:]
        if len(d) >= 7:
            digits.add(d)
    take(row.get("phone"))
    for p in SDW.parse_phones(row.get("phones")):
        take(p.get("number") if isinstance(p, dict) else p)
    roster_id = ""
    try:
        if name_key:
            matches = [p for p in reads.hub_rows("people") if gsjs.name_key(p.get("name")) == name_key]
            if len(matches) == 1:
                roster_id = s_(matches[0].get("id"))
                take(matches[0].get("phone"))
    except Exception:  # noqa: BLE001 - no roster: the other keys still answer
        pass
    cid = s_(row.get("candidateid"))
    if cid:
        try:
            for c in CND.raw_rows(reads):
                if s_(c.get("candidateid")) == cid:
                    take(c.get("phone"))
                    take_email(c.get("email"))
        except Exception:  # noqa: BLE001 - no candidate row
            pass

    def phone_hit(cell: Any) -> bool:
        s = _digits(cell)
        return bool(s) and any(d in s for d in digits)
    out: dict[str, Any] = {"requests": [], "counts": {"open": 0, "needs_dates": 0, "resolved": 0}, "total": 0}
    for r in rows(reads):
        how = ""
        if roster_id and s_(r.get("personId")) == roster_id:
            how = "roster"
        elif s_(r.get("email")).strip() and s_(r.get("email")).strip().lower() in emails:
            how = "email"
        elif phone_hit(r.get("phone")):
            how = "phone"
        elif name_key and gsjs.name_key(r.get("personName")) == name_key:
            how = "named"
        if not how:
            continue
        if s_(r.get("status")) in out["counts"]:
            out["counts"][s_(r.get("status"))] += 1
        out["requests"].append({
            "id": s_(r.get("id")), "at": s_(r.get("createdAt")), "type": s_(r.get("type")),
            "urgency": s_(r.get("urgency")), "status": s_(r.get("status")), "verdict": s_(r.get("verdict")),
            "resolvedAt": s_(r.get("resolvedAt")), "resolvedBy": s_(r.get("resolvedBy")),
            "note": s_(r.get("resolutionNote"))[:400], "details": s_(r.get("details"))[:400],
            "dates": s_(r.get("datesText")), "from": s_(r.get("dateFrom")), "to": s_(r.get("dateTo")),
            "days": s_(r.get("dateDays")), "as": how})
    out["requests"].sort(key=lambda x: x["at"], reverse=True)
    out["total"] = len(out["requests"])
    out["requests"] = out["requests"][:100]
    return {"status": 200, "data": out}


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {
    "requestsList": requests_list, "staffRequestsList": staff_requests_list,
    "userSupportRequests": user_support_requests}
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
