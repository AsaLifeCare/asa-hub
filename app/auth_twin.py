"""A session's row on the Sessions tab, where one is still queued: the cells Auth.gs sessionCreate_ writes (token_hash,
user_id, created_at, expires_at, last_seen), laid by a `rows` book op (append unless the hash is already there, written
as given) in the session's own transaction; a session ended before its row lands takes the op back. A sign-in's own
session queues none (open_session): Python judges it everywhere."""
from __future__ import annotations

import logging
from typing import Any

import auth_store as AS
import book_ops as BO
import gsjs
import hubdb
import locations as L
import writes as W

log = logging.getLogger("asa-hub-app.auth")

TAB = "hub_sessions"
CELLS = ("token_hash", "user_id", "created_at", "expires_at", "last_seen")
OP = "rows"
SUBJECT = "Sign-in"

s_ = gsjs.str_


# a session minted from the master's own carries these two as well (BeAnother.gs BE_ANOTHER_REAL_COL / _PARENT_COL)
CHILD_CELLS = CELLS + ("acting_real_user_id", "parent_token_hash")


def target(reads: L.Reads, cells: tuple[str, ...] = CELLS) -> tuple[str, str, dict[str, str]]:
    """The Sessions tab's book and tab (as hubSheet_ opens it) and its header cell for each column named."""
    res = W.tab_of(reads, TAB)
    if res.ref is None:
        raise W.NotKept("the Sessions tab is not in the copy")
    sid, tab = W.where_of(res)
    heads = {hubdb.norm_key(h): h for h in res.ref.headers}
    named = {k: heads.get(hubdb.norm_key(k), "") for k in cells}
    if not all(named.values()):
        raise W.NotKept("the Sessions tab lacks one of sessionCreate_'s columns")
    return sid, tab, named


def _spec(reads: L.Reads, cells: tuple[str, ...]) -> tuple[str, str, dict[str, str]] | None:
    try:
        return target(reads, cells)
    except (W.NotKept, hubdb.Unreadable) as exc:
        log.warning("sign-in: a session's row was not queued for the Sessions tab (%s)", exc)
        return None


def _queue(spec: tuple[str, str, dict[str, str]], row: dict[str, str], cells: tuple[str, ...], author: str,
           action: str) -> None:
    sid, tab, named = spec
    BO.queue([{"op": OP, "sheet_id": sid, "tab": tab,
               "spec": {"append": [{named[k]: row[k] for k in cells}], "unique": named["token_hash"], "raw": True}}],
             SUBJECT, author, action)


def open_session(cur: Any, u: dict) -> str:
    """sessionCreate_ for Python's doors, under the platform's write lock: the session alone. Python judges it
    everywhere, so no row of it goes to the Sessions tab."""
    token, _row = AS.session_open(cur, s_(u.get("userid")))
    return token


def open_child(cur: Any, reads: L.Reads, target_uid: str, real_uid: str, parent_th: str, until: Any, at: Any,
               write_id: str, action: str) -> str:
    """The session minted from the master's own (beAnotherStart), and its row for the Sessions tab with the two
    columns Apps Script resolves it by."""
    spec = _spec(reads, CHILD_CELLS)
    token, row = AS.child_open(cur, target_uid, real_uid, parent_th, until, at, twin=write_id if spec else "")
    if spec:
        _queue(spec, row, CHILD_CELLS, "", action)
    return token


def drop_children(reads: L.Reads, parent_th: str, action: str) -> None:
    """beAnotherEndChildren_ on the Sessions tab: every row minted from this session removed."""
    spec = _spec(reads, CHILD_CELLS)
    if spec:
        sid, tab, named = spec
        BO.queue([{"op": OP, "sheet_id": sid, "tab": tab,
                   "spec": {"drop": {"column": named["parent_token_hash"], "value": parent_th}, "raw": True}}],
                 SUBJECT, "", action)


def cancel(cur: Any, write_id: str) -> int:
    """The op of a session ended before its row landed, taken back."""
    if not write_id:
        return 0
    cur.execute(f"update {BO.table()} set state = 'cancelled', done_at = now(),"
                " why = 'its session ended before its row landed' where write_id = %s and op = %s"
                " and state = 'pending'", (write_id, OP))
    return int(getattr(cur, "rowcount", 0) or 0)
