"""My Inbox's one write (POST /hub-lanes/my-inbox/read, server/snapshot_service.py lane_my_inbox_read): the session's
own alerts marked read or cleared, kept final in app.inbox_reads under the write store's transaction. A company
notice's mark is the bell's (app/web_notices.py); which sessions may keep marks at all is the lane's gate
(app/inbox_lanes.py)."""
from __future__ import annotations

import contextlib
from typing import Any, Callable, Iterator

import gsjs
import inbox_state as IS
import locations as L
import writes as W
from scope import Defer

APP_ID = "my-inbox"
APP_NAME = "My Inbox"
ROLES = ("admin", "director", "manager", "staff")
# lane_my_inbox_read's own words
VISIT = "My Inbox reads the signed-in account's own alerts; it is not drawn inside a visit."
NO_ACCOUNT = "This session carries no account to keep the reads for."
KEYS_REQUIRED = "keys is required."
TOO_MANY = f"At most {IS.READ_MAX} keys at once."
NO_ALERT = "None of those keys is an alert."


class Kept(W.Decision):
    """The door's answer, and the marks its transaction keeps in app.inbox_reads."""

    def __init__(self, answer: dict[str, Any], uid: str, keys: list[str], dismiss: bool) -> None:
        super().__init__(answer)
        self.marks = {"uid": uid, "keys": list(keys), "dismiss": bool(dismiss)}


def refused(status: int, reason: str, message: str) -> W.Decision:
    return W.Decision({"status": status, "reason": reason, "message": message})


def mark_read(sess: L.Session, payload: dict) -> W.Decision:
    """myInboxRead: mark the session's own alerts read, or cleared."""
    user = sess.user or {}
    if user.get("is_service"):
        raise Defer("read marks are a person's own, never the service's")
    if user.get("visiting_member") or gsjs.trim(gsjs.or_blank(payload.get("member"))):
        return refused(403, "visit", VISIT)
    uid = gsjs.trim(gsjs.or_blank(user.get("id")))
    if not uid:
        return refused(403, "session", NO_ACCOUNT)
    keys = payload.get("keys")
    if not isinstance(keys, list) or not keys:
        return refused(400, "keys", KEYS_REQUIRED)
    if len(keys) > IS.READ_MAX:
        return refused(400, "keys", TOO_MANY)
    notice_ids, alert_keys, ignored = IS.split_keys(keys)
    if not notice_ids and not alert_keys:
        return refused(400, "keys", NO_ALERT)
    if notice_ids:
        raise Defer("a company notice's read mark is the bell's, kept by the relay")
    dismiss = payload.get("dismiss") is True
    return Kept({"status": 200, "data": {"marked": len(alert_keys), "ignored": ignored}}, uid, alert_keys, dismiss)


ACTIONS: dict[str, Callable[[L.Session, dict], W.Decision]] = {"myInboxRead": mark_read}
# HUB_POLICY: the roles alone; the body is read by the door, in lane_my_inbox_read's order and words
POLICY: dict[str, dict[str, Any]] = {"myInboxRead": {"roles": ROLES}}
# the platform's write lock held by another write: Python's own sentence, never a hand-off
BUSY_OF: dict[str, dict[str, Any]] = {a: {"status": 409, "message": W.BUSY} for a in ACTIONS}


class Tx(W.Tx):
    """The mark's locked transaction: its receipt, then the marks themselves."""

    def record(self, write_id: str, action: str, env: dict[str, Any], decision: W.Decision, author: str) -> None:
        super().record(write_id, action, env, decision, author)
        marks = getattr(decision, "marks", None)
        if not marks:
            return
        try:
            IS.keep_marks(self.cur, marks["uid"], marks["keys"], marks["dismiss"])
        except Exception as exc:  # noqa: BLE001 - the whole transaction rolls back with it
            raise W.NotKept(f"app.inbox_reads refused the marks ({type(exc).__name__})") from exc
        IS.prune(self.cur, marks["uid"])


class Store(W.Store):
    """app.my_inbox_writes and app.my_inbox_receipts beside the other apps' own, and the marks' two tables."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="my_inbox", label=APP_NAME)
        self._own = False

    def ensure(self) -> str:
        why = super().ensure()
        if why or self._own:
            return why
        with self._lock:
            if self._own:
                return ""
            try:
                c = self.conn()
                for stmt in IS.ddl():
                    c.execute(stmt)
                self._own = True
            except Exception as exc:  # noqa: BLE001 - said on /healthz; the relay keeps the marks meanwhile
                self._drop()
                self._ready = False
                self.why = f"the marks' tables are not ready ({type(exc).__name__}: {str(exc)[:120]})"
        return self.why

    @contextlib.contextmanager
    def locked(self) -> Iterator[W.Tx]:
        with super().locked() as tx:
            yield Tx(tx.cur, self.kind)

    # a void receipt leaves its marks: each is the person's own ask, and a mark kept twice is the same mark
