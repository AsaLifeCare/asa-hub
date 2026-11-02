"""My Work's writes. A Time off approval row tells its person the outcome (Send Message Approved / Send Message Not
Approved): the row raises the situation and Smart Comms words it, holds it or sends it, and keeps the receipt; nothing
is decided in Time Off. A Client training (IST) row is booked in My Work's panel and approved by a director or above
in My Work (ist_bookings)."""
from __future__ import annotations

import re
import time
from datetime import date
from typing import Any, Callable

import editions
import gsjs
import hubdb
import ist as IST
import ist_bookings as IB
import ist_writes as IW
import locations as L
import my_work as MW
import mw_time_off as time_off
import resource_rows as RR
import scope as sc
import smart_comms as SC
import support_desk_writes as SD
import writes as W
from scope import Defer

APP_ID = "my-work"
APP_NAME = "My Work"
ACTION = "myWorkTimeOffMessage"
# App Control's row for the two buttons (src/lib/featureAccess.ts): with no row, the master's alone
FEATURE = "my-work.timeOffMessages"
LANE = "my-work"
ROLES = ("admin", "director", "manager", "staff")
# the outcome said -> the Smart Comms situation that says it (smart_comms.SEEDS)
SITUATIONS = {"approved": "time_off_told_approved", "not_approved": "time_off_told_not_approved"}
OUTCOME_WORDS = {"approved": "approved", "not_approved": "not approved"}

VISIT = "My Work tells from the signed-in account's own session; not inside a visit."
SHUT = "These messages are not open to you here."
NO_OUTCOME = "Say approved or not_approved."
NO_REF = "That time off request cannot be read."
GONE = "That time off request is not on record."
DECIDED = "This request was already decided in Time Off, and its person was told there."
NOT_YOURS = "Only a person this request waits on tells its outcome."


def refused(status: int, reason: str, message: str) -> W.Decision:
    return W.Decision({"status": status, "reason": reason, "message": message})


def told_words(told: dict[str, Any], person: str, outcome: str) -> str:
    """What Smart Comms did with the message, in one sentence for the row."""
    state, held, why = told.get("state"), told.get("held"), gsjs.str_(told.get("why"))
    what = f"The {OUTCOME_WORDS[outcome]} message"
    if state == "sent":
        return f"{what} is on its way to {person}."
    if held == "test_mode":
        return f"Test mode is on: {what.lower()} was written to the rehearsal book, and {person} was not texted."
    if held == "quiet":
        return f"It is quiet hours: {what.lower()} goes out to {person} at 08:00."
    if state == "held":
        return f"Smart Comms is holding {what.lower()}: {why or held}."
    if state == "already":
        return f"{what} was already sent to {person}."
    if state == "no_phone":
        return f"{person} has no number this platform may text, so nothing was sent."
    if state == "refused":
        return f"{person} could not be texted ({why}), so nothing was sent."
    # off and failed: Smart Comms' own sentence, which says nothing was sent
    return (why[:1].upper() + why[1:] + ".") if why else "Smart Comms did not take the message, so nothing was sent."


def tell(sess: L.Session, payload: dict) -> W.Decision:
    """myWorkTimeOffMessage: the outcome of one waiting time off request, told to its person through Smart Comms."""
    user = sess.user or {}
    if user.get("is_service"):
        raise Defer("a message is told from a person's session, never the service's")
    if user.get("visiting_member") or gsjs.trim(gsjs.or_blank(payload.get("member"))):
        return refused(403, "visit", VISIT)
    # Settings › My Work keeps the two buttons to the master's own session unless its switch shows them
    if editions.hides_for(sess).get("time_off_messages"):
        return refused(403, "hidden", SHUT)
    # a control, not an app: with no row in App Control it is open to the seat checked below; a row narrows it
    if ((sess.reads.app_rules().get("rules") or {}).get(FEATURE)
            and sc.profile_app_gate(FEATURE, user, sess.reads.scope_sources()).get("open") is not True):
        return refused(403, "feature", SHUT)
    outcome = gsjs.trim(gsjs.or_blank(payload.get("outcome")))
    situation = SITUATIONS.get(outcome)
    if not situation:
        return refused(400, "outcome", NO_OUTCOME)
    ref = gsjs.trim(gsjs.or_blank(payload.get("ref")))
    if not time_off.REF_RE.fullmatch(ref):
        return refused(400, "ref", NO_REF)
    v = time_off.view(sess.reads)
    row = next((r for r in v["rows"] if gsjs.str_(r.get("id")) == ref), None)
    if row is None:
        return refused(404, "ref", GONE)
    if row.get("status") != time_off.PENDING:
        return refused(409, "decided", DECIDED)
    if not sc.is_real_master(user):
        # FAIL-CLOSED: the half this reader holds, as My Work's own row decides it
        brd = time_off.board(v)
        if not brd["readable"]:
            raise hubdb.Unreadable(brd["why"])
        try:
            who = MW.who_of(MW.HubBooks(sess.reads), user)
        except MW.Refused as exc:
            # whose seat this is could not be told: My Work's own words, and nothing raised
            return W.Decision(dict(exc.env))
        leg, _why, _code = time_off.leg_for(who, row, brd["names"], MW.sr.house_managers(sess.reads))
        if not leg:
            return refused(403, "seat", NOT_YOURS)
    person = gsjs.str_(row.get("person"))
    account = SD.account_by_name(sess.reads, person)
    told = SC.raise_situation(
        None, situation=situation, to=SD.phone_of(account), key=f"mw|{situation}|{ref}", person=person, lane=LANE,
        vars={"first_name": person.split(" ")[0] if person else "",
              "dates": time_off.dates_words(row.get("start_date"), row.get("end_date"))},
        at_ms=int(time.time() * 1000), prune=True)
    return W.Decision({"status": 200, "data": {
        "ref": ref, "outcome": outcome, "person": person, "state": told.get("state") or "",
        "held": told.get("held") or "", "said": told_words(told, person or "The person", outcome)}})


# ── Client training (IST): booked in My Work's panel, approved by a director or above in My Work ──

IST_BOOK = "myWorkIstBook"
IST_APPROVE = MW.IST_APPROVE
DAY_RE = re.compile(r"\d{4}-\d{2}-\d{2}")
IST_SHUT = "Booking a client training here is not open to you yet."
IST_GONE = "That IST record is not owed on your My Work."
IST_SENT = "This training is already waiting for a director's approval."
IST_SEAT = "Only a director or above approves a client training."
IST_OWN = "Your own booking: another director approves it."
IST_NO_BOOKING = "That booking is not on record."


def _ist_shut(sess: L.Session, payload: dict) -> W.Decision | None:
    user = sess.user or {}
    if user.get("is_service"):
        raise Defer("a client training is booked from a person's session, never the service's")
    if user.get("visiting_member") or gsjs.trim(gsjs.or_blank(payload.get("member"))):
        return refused(403, "visit", VISIT)
    # Settings › My Work keeps the panel and its approvals to the master's own session unless its switch shows them
    if editions.hides_for(sess).get(IB.PART):
        return refused(403, "hidden", IST_SHUT)
    return None


def ist_book(sess: L.Session, payload: dict) -> W.Decision:
    """myWorkIstBook: an owed IST record of this reader's My Work booked — its date, confirmed or declined — and sent
    to the directors; kept in the IST house's ist_bookings tab."""
    shut = _ist_shut(sess, payload)
    if shut:
        return shut
    iid, day = IB.text(payload.get("ist_id"), 120), IB.text(payload.get("date"), 10)
    answer, note = IB.text(payload.get("answer"), 20).lower(), IB.text(payload.get("note"), IB.NOTE_MAX)
    if not iid:
        return refused(400, "ist_id", "Which IST record.")
    try:
        ok_day = bool(DAY_RE.fullmatch(day)) and date.fromisoformat(day) is not None
    except ValueError:
        ok_day = False
    if not ok_day:
        return refused(400, "date", "The training's date, as a day.")
    if answer not in IB.ANSWERS:
        return refused(400, "answer", "Confirmed or declined.")
    try:
        owed, _unclaimed = MW.ist_owed(MW.ist_ctx(sess))
    except MW.Refused as exc:
        return W.Decision(dict(exc.env))
    except MW.NotAttributable as exc:
        return refused(403, "who", str(exc))
    except MW.Unreadable as exc:
        raise hubdb.Unreadable(str(exc)) from exc
    rec = next((r for r in owed if IB.text(r.get("id"), 120) == iid), None)
    if rec is None:
        return refused(404, "ist_id", IST_GONE)
    cur = W.HELD.get()
    if cur is None:
        raise Defer("a booking is kept only under the platform's write lock")
    if IB.held(cur, "ist_id = %s and state = %s", (iid, IB.WAITING), lock=True):
        return refused(409, "waiting", IST_SENT)
    user = sess.user or {}
    at = W.now_iso(sess.reads)
    bid = IB.new_id(iid, at)
    house = IB.text(rec.get("house"), 40)
    cur.execute(f"insert into {IB.TABLE} (id, ist_id, house, client_name, staff_name, staff_email, training_date,"
                " answer, note, state, booked_by_uid, booked_by_name, write_id)"
                " values (%s, %s, %s, %s, %s, %s, %s::date, %s, %s, %s, %s, %s, %s)",
                (bid, iid, house, IB.text(rec.get("clientName"), 120), IB.text(rec.get("staffName"), 120),
                 IB.text(rec.get("staffEmail")).lower(), day, answer, note, IB.WAITING, IB.text(user.get("id"), 80),
                 W.who(user), SC.write_id()))
    return W.Decision({"status": 200, "data": {"id": bid, "ist_id": iid, "state": IB.WAITING,
                                               "said": "Sent to the directors for approval."}}, subject=house, own=True)


def ist_approve(sess: L.Session, payload: dict) -> W.Decision:
    """myWorkIstApprove: a director or above approves a waiting booking in My Work; an approved confirmation marks
    the IST record done on the training's date. Answered before, it changes nothing."""
    shut = _ist_shut(sess, payload)
    if shut:
        return shut
    user = sess.user or {}
    if not sc.wears_from(user, "DIRECTOR"):
        return refused(403, "seat", IST_SEAT)
    if IB.text(payload.get("word")).lower() != "approve":
        return refused(400, "word", "Approve.")
    bid = IB.text(payload.get("item_id"), 80)
    if not bid:
        return refused(400, "item_id", "Which booking.")
    reads = sess.reads
    cur = W.HELD.get()
    if cur is None:
        raise Defer("an approval is kept only under the platform's write lock")
    b = next(iter(IB.held(cur, "id = %s", (bid,), lock=True)), None)
    if b is None:
        return refused(404, "item_id", IST_NO_BOOKING)
    state = IB.text(b.get("state")).lower()
    if state != IB.WAITING:
        return W.Decision({"status": 200, "data": {
            "ok": True, "changed": False, "state": state,
            "said": f"Already approved by {IB.text(b.get('approved_by_name')) or 'a director'}."}})
    uid = IB.text(user.get("id"), 80)
    if not sc.is_real_master(user) and (
            (uid and IB.text(b.get("booked_by_uid"), 80) == uid)
            or (IB.text(user.get("email")).lower() and IB.text(user.get("email")).lower() == IB.text(b.get("staff_email")).lower())):
        return refused(403, "own", IST_OWN)
    at, name = W.now_iso(reads), W.who(user)
    iid, house, staff = IB.text(b.get("ist_id"), 120), IB.text(b.get("house"), 40), IB.text(b.get("staff_name"), 120)
    cur.execute(f"update {IB.TABLE} set state = %s, approved_by_uid = %s, approved_by_name = %s, approved_at = now(),"
                " approve_write_id = %s where id = %s and state = %s",
                (IB.APPROVED, uid, name, SC.write_id(), bid, IB.WAITING))
    edits: list[dict] = []
    said = f"Approved. {staff or 'The person'} reads it in My Work."
    if IB.text(b.get("answer")).lower() == "confirmed" and iid:
        W.gate(reads)
        if IST.owned(reads.db):
            rec = W.row_by_id(IST.records(reads), iid)
        else:
            res = W.tab_of(reads, IB.IST_TAB)
            rec = W.row_by_id(reads.db.locations_rows(res.ref) if res.ref is not None else [], iid)
        if rec is not None and IB.text(rec.get("status")).lower() == MW.ist_config.IST_STATUS_OWED:
            day = IB.text(b.get("training_date"), 10)
            kept = IW.keep_cells(reads, iid,
                                 {"status": MW.ist_config.IST_STATUS_DONE, "trainedAt": day, "updatedAt": at},
                                 {k: gsjs.or_blank(rec.get(k)) for k in ("status", "trainedAt", "updatedAt")}, house,
                                 IB.text(user.get("email")))
            if kept is not None:
                edits.append(kept)
            said = f"Approved; the IST record is marked done on {day}. {staff or 'The person'} reads it in My Work."
    answer = {"status": 200, "data": {"ok": True, "changed": True, "state": IB.APPROVED, "said": said}}
    # the approval is the booking table's own; only the IST record's status is an edit of a book
    return W.final(answer, edits, house) if edits else W.Decision(answer, subject=house, own=True)


ACTIONS: dict[str, Callable[[L.Session, dict], W.Decision]] = {ACTION: tell, IST_BOOK: ist_book,
                                                                IST_APPROVE: ist_approve}
# HUB_POLICY: the roles alone; the body is read by the door
POLICY: dict[str, dict[str, Any]] = {
    ACTION: {"roles": ROLES},
    IST_BOOK: {"roles": ROLES, "params": {"ist_id": "string", "date": "string", "answer": "string",
                                          "note": "string", "member": "string"}},
    IST_APPROVE: {"roles": ROLES, "params": {"item_id": "string", "word": "string", "note": "string",
                                             "member": "string"}}}
# the platform's write lock held by another write: Python's own sentence, never a hand-off
BUSY_OF: dict[str, dict[str, Any]] = {a: {"status": 409, "message": W.BUSY} for a in ACTIONS}


class Store(W.Store):
    """app.my_work_writes and app.my_work_receipts beside the other apps' own; the message is Smart Comms', a client
    training booking app.ist_bookings'."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="my_work", label=APP_NAME)

    def settle(self, write_id: str, state: str, why: str = "", fields: list[str] | None = None) -> bool:
        """The relay's word on a write; a void also takes back the booking or the approval kept under it."""
        done = super().settle(write_id, state, why, fields)
        if state == "void" and done:
            IB.void(self.conn(), write_id)
            # an IST record marked done in Postgres (IST Records on Python) goes back with it
            try:
                with self.conn().transaction():
                    RR.void(self.conn(), write_id)
            except Exception as exc:  # noqa: BLE001 - said, never raised into the relay's settle
                W.log.warning("my work: the void of %s was not applied to its rows (%s)", write_id[:40],
                              type(exc).__name__)
        return done
