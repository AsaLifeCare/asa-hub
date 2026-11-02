"""Client training (IST) bookings, kept in the Hub's database alone (app.ist_bookings, db/ist_bookings.sql): no sheet
holds a booking. A person books an owed IST record from My Work's panel (the training's date, confirmed or declined),
a director or above approves it in My Work, and the person reads the outcome there; an approved confirmation marks the
IST record done on that date."""
from __future__ import annotations

import hashlib
import logging
from typing import Any

import gsjs
import hubdb
import locations as L

log = logging.getLogger("asa-hub-app")

TABLE = "app.ist_bookings"
IST_TAB = "ist_records"
COLUMNS = ("id", "ist_id", "house", "client_name", "staff_name", "staff_email", "training_date", "answer", "note",
           "state", "booked_by_uid", "booked_by_name", "booked_at", "approved_by_uid", "approved_by_name",
           "approved_at")
# every column as text: a day as YYYY-MM-DD, an instant in UTC with its Z
_SELECT = ("select id, ist_id, house, client_name, staff_name, staff_email, to_char(training_date, 'YYYY-MM-DD'),"
           " answer, note, state, booked_by_uid, booked_by_name,"
           " to_char(booked_at at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"'), approved_by_uid, approved_by_name,"
           " coalesce(to_char(approved_at at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"'), '')"
           f" from {TABLE}")
ANSWERS = ("confirmed", "declined")
ANSWER_WORDS = {"confirmed": "Confirmed", "declined": "Declined"}
WAITING, APPROVED = "waiting", "approved"
NOTE_MAX = 500
# Settings › My Work: the booking panel, the directors' approvals and the outcome, the master's alone until shown
PART = "ist_booking"
# the outcome stays in the person's open requests this long after the approval
TOLD_DAYS = 7


def text(v: Any, n: int = 200) -> str:
    return gsjs.trim(gsjs.or_text(v))[:n]


def _row(r: tuple) -> dict[str, Any]:
    return {c: ("" if v is None else str(v)) for c, v in zip(COLUMNS, r)}


def rows(reads: L.Reads) -> list[dict[str, Any]]:
    """Every booking, oldest first, once per request; the table not answering is never "none"."""
    def read() -> list[dict[str, Any]]:
        try:
            got = reads.db.query(_SELECT + " order by booked_at, id")
        except Exception as exc:  # noqa: BLE001 - FAIL-CLOSED: a booking unread is never drawn as none
            raise hubdb.Unreadable(f"the IST bookings could not be read ({type(exc).__name__})") from exc
        return [_row(r) for r in got]
    return reads.once("ist_bookings", read)


def held(cur: Any, where: str, args: tuple, lock: bool = False) -> list[dict[str, Any]]:
    """Bookings read on the write's own cursor, under its lock."""
    cur.execute(_SELECT + f" where {where} order by booked_at, id" + (" for update" if lock else ""), args)
    return [_row(r) for r in cur.fetchall()]


def latest_by_ist(got: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """The newest booking of each IST record."""
    out: dict[str, dict[str, Any]] = {}
    for r in got:
        iid = text(r.get("ist_id"), 120)
        if iid and (iid not in out or text(r.get("booked_at")) >= text(out[iid].get("booked_at"))):
            out[iid] = r
    return out


def new_id(ist_id: str, at: str) -> str:
    return "IB" + hashlib.sha1(f"{ist_id}|{at}".encode()).hexdigest()[:10]


def void(conn: Any, write_id: str) -> None:
    """A write the relay voided: the booking it kept leaves, the approval it kept is waiting again."""
    try:
        with conn.transaction():
            conn.execute(f"delete from {TABLE} where write_id = %s", (write_id,))
            conn.execute(f"update {TABLE} set state = %s, approved_by_uid = '', approved_by_name = '',"
                         " approved_at = null, approve_write_id = '' where approve_write_id = %s", (WAITING, write_id))
    except Exception as exc:  # noqa: BLE001 - said, never raised into the relay's settle
        log.warning("ist bookings: the void of %s was not applied (%s)", write_id[:40], type(exc).__name__)
