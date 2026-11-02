"""Settings › Platform users' row changes on Python behind the `members` switch (Members.gs), wherever the caller
stands: an invitation asked (its letter raised through Smart Comms as `platform_member_ask`), an answer recorded by
hand or by the reply sweep, a link ended from either side, and the member's own word about their world — decided off
asa-hub-db under the platform's write lock and kept in app.edits, each row named by its member_id, else by the cells
beside it; rows nothing tells apart are written on the sheet's first by a `cells` book op, as the .gs writes the
first. A tab or a column the book lacks is made by a `mirror` book op (hubTabEnsure_, ensureHeader_), the rows kept
here meanwhile."""
from __future__ import annotations

import secrets
import time
from typing import Any, Callable

import book_ops as BO
import comms_rpc as CR
import gsjs
import hubdb
import locations as L
import members as M
import scope as sc
import smart_comms as SC
import staff_views
import writes as W
from writes import Decision

# Members.gs's own words for its lock
BUSY = "Another change is in progress — try again."
FULL = "This platform is full — " + str(M.LIMIT) + " people is the limit."
ALREADY = "They are already here, or already asked."
SELF = "You are the owner of this platform — you are already here."
NO_ID = {"status": 400, "message": "member_id is required."}
BAD_SCOPE = {"status": 400, "message": "scope must be work or work_world."}
SHUT = {"status": 403, "message": "They closed their own world. Only they can open it again."}
# the cells that name a row when its member_id does not, in turn
KEY_SETS = (("member_id",), ("member_id", "added_at"), ("member_id", "owner_user_id", "member_user_id", "added_at"),
            ("owner_user_id", "member_user_id", "added_at"), M.HEADER)

s_ = gsjs.str_
norm = hubdb.norm_key


def log_line(user: dict, action: str, target: str) -> None:
    """hubSysLog_."""
    staff_views.record(user, action, target)


def _raw(ref: hubdb.TabRef | None, raw: dict) -> dict[str, str]:
    """A row's cells as the copy keeps their text: what an edit names as the sheet's value before it."""
    return {h: gsjs.trim(gsjs.or_blank(hubdb.typed(raw.get(h), "raw"))) for h in (ref.headers if ref else ()) if h}


class _Rows:
    """The members tab under the write lock: where app.edits keeps it, its header by normKey_, its rows in sheet
    order (the copy's, Python's kept edits laid)."""

    def __init__(self, reads: L.Reads) -> None:
        res = M.members_tab(reads)
        self.sid, self.tab = W.where_of(res)
        self.ref = res.ref
        self.copy = reads.db.rows(res.ref) if res.ref is not None else []
        self.rows = [_raw(self.ref, raw) for _rn, raw in self.copy]

    def head(self, key: str) -> str | None:
        return W.header_of(self.ref, key, norm=True)

    def cell(self, row: dict, key: str) -> str:
        h = self.head(key)
        return gsjs.trim(row.get(h, "")) if h is not None else ""

    def first(self, mid: str) -> int | None:
        """The .gs's loop: the first row whose member_id is the id."""
        return next((i for i, r in enumerate(self.rows) if self.cell(r, "memberid") == mid), None)

    def missing(self) -> list[str]:
        """The columns ensureHeader_ would add."""
        return [h for h in M.HEADER if self.head(norm(h)) is None]

    def widen(self) -> None:
        """The header as the mirror leaves it: the columns it adds named after the tab's own."""
        if self.ref is not None:
            self.ref = self.ref._replace(headers=tuple(self.ref.headers) + tuple(self.missing()))

    def mirror(self, appended: list[dict] | None = None, patch: tuple[int, dict] | None = None) -> dict[str, Any]:
        """hubTabEnsure_ and ensureHeader_ as one `mirror` op: the whole tab as Python holds it, the columns it lacks
        after its own, the rows appended and the cells set by this write in it."""
        heads = list(self.ref.headers) if self.ref is not None else []
        extra = self.missing()
        header = [hubdb.twin_base(gsjs.js_str(h)) for h in heads] + extra
        keys = [norm(h) for h in header]
        by: dict[int, dict] = {}
        last = 1
        for i, (rn, raw) in enumerate(self.copy):
            cells = {norm(h): W.sheet_text(hubdb.typed(raw.get(h), "raw")) for h in heads}
            if patch is not None and patch[0] == i:
                cells.update({norm(h): W.sheet_text(v) for h, v in patch[1].items()})
            by[rn] = cells
            if rn > last and any(v != "" for v in cells.values()):
                last = rn
        rows = [[(by.get(rn) or {}).get(k, "") for k in keys] for rn in range(2, last + 1)]
        for rec in appended or ():
            got = {norm(h): W.sheet_text(v) for h, v in rec.items()}
            rows.append([got.get(k, "") for k in keys])
        return {"op": "mirror", "sheet_id": self.sid, "tab": self.tab,
                "spec": {"resource": M.TAB, "header": header, "rows": rows, "create": self.ref is None}}

    def edit(self, at: int, mid: str, sets: dict[str, Any]) -> tuple[list[dict], list[dict]] | None:
        """set(key, val) on rows[at] for each key the header has (a column it lacks is skipped, as the .gs skips it):
        (kept edits, book ops); None when nothing on the sheet tells the row apart."""
        cells = {}
        for key, val in sets.items():
            h = self.head(key)
            if h is not None:
                cells[h] = val
        if not cells:
            return [], []
        before = {h: self.rows[at].get(h, "") for h in cells}
        sets_of = [[self.head(norm(h)) for h in s] for s in KEY_SETS]
        named = W.row_key_of(self.copy, at, [s for s in sets_of if all(h is not None for h in s)])
        if named is not None:
            return [W.kept_record(self.sid, self.tab, "edit", named[0], named[1], mid or named[1], cells,
                                  before=before)], []
        if not mid:
            return None
        head = self.head("memberid")
        # rows identical cell for cell: laid on the first here, written on the sheet's first by the sync
        return ([W.kept_record(self.sid, self.tab, "edit", W.COLS + head, mid, mid, cells, before=before)],
                [{"op": "cells", "sheet_id": self.sid, "tab": self.tab,
                  "spec": {"match": head, "key": mid, "cells": {h: W.sheet_text(v) for h, v in cells.items()},
                           "which": "first"}}])


def _kept(sess: L.Session, actor: dict, action: str, answer: dict, edits: list[dict], ops: list[dict],
          subject: str) -> Decision:
    """The answer final, its cells kept in app.edits and its book ops queued in the same write."""
    BO.queue(ops, "members:" + M.TAB, W.who(actor), action)
    if ops and not edits:
        return Decision(answer, subject=subject, own=True)
    return W.final(answer, edits, subject)


def _now(reads: L.Reads) -> str:
    return gsjs.iso(reads.now)


# ---- platformMemberAsk ---------------------------------------------------------------------------------------------

def ask(sess: L.Session, payload: dict) -> Decision:
    """platformMemberAsk: the row added pending, then the letter asking for authorization raised through Smart Comms;
    a letter the quiet window held was not asked, and the screen says why."""
    refused, ctx = M.stand(sess, "platformMemberAsk")
    if refused:
        return Decision(refused)
    user = ctx["actor"]
    refused = M.owner_gate(user)
    if refused:
        return Decision(refused)
    reads = sess.reads
    email = M.asked_email(payload)
    if not email:
        return Decision(dict(M.NO_EMAIL))
    # no visit ever reaches the master's account: its address is nobody's to invite
    if sc.is_master_email(email):
        return W.refuse(409, M.NO_ACCOUNT)
    if email == s_(user.get("email")).lower():
        return W.refuse(400, SELF)
    row = M.visible_by_email(reads, ctx["here"], email)
    ok, why = M.eligible(row)
    if not ok:
        return W.refuse(409, why)
    me = s_(user.get("id"))
    mine = M.members_of(reads, me)
    if len(mine) >= M.LIMIT:
        return W.refuse(409, FULL)
    if any(s_(m.get("memberuserid")) == s_(row.get("userid")) for m in mine):
        return W.refuse(409, ALREADY)
    t = _Rows(reads)
    rec = {"member_id": "mem_" + secrets.token_hex(5), "owner_user_id": me, "member_user_id": s_(row.get("userid")),
           "member_email": s_(row.get("email")), "status": "pending", "added_at": _now(reads),
           "added_by": s_(user.get("email")), "removed_at": "", "scope": "", "authorized_at": "", "authorized_by": "",
           "scope_by": ""}
    mid = rec["member_id"]
    ops = [t.mirror(appended=[rec])] if t.ref is None or t.missing() else []
    edit = W.kept_record(t.sid, t.tab, "append", W.COLS + (t.head("memberid") or "member_id"), mid, mid,
                         {(t.head(norm(h)) or h): v for h, v in rec.items()})
    letter = M.auth_email({"name": s_(row.get("displayname")),
                           "ownerName": s_(gsjs.or_text(user.get("display_name")) or gsjs.or_text(user.get("name"))
                                           or gsjs.or_text(user.get("email")))})
    got = SC.raise_situation(None, situation=M.SITUATION, to=email, key="member_ask|" + mid,
                             vars={"greeting": letter["greeting"], "owner_name": letter["owner"],
                                   "name": s_(row.get("displayname"))},
                             person=s_(row.get("displayname")) or email, lane=M.REASON, channel="email",
                             html=letter["html"], at_ms=int(time.time() * 1000), prune=False,
                             occasion="platform member authorization: " + mid)
    res = CR.envelope("emailSend", {"to": email, "subject": letter["subject"], "body": letter["text"],
                                    "reason": M.REASON}, got)
    log_line(user, "platformMemberAsk", email)
    answer = {"status": 200, "data": {"member_id": mid, "asked": bool(res.get("ok") and not res.get("quiet")),
                                      "why": s_(res.get("error") or res.get("detail"))}}
    return _kept(sess, user, "platformMemberAsk", answer, [edit], ops, mid)


# ---- the owner's answer, the link ended from either side, the member's own word -----------------------------------

def _set(sess: L.Session, actor: dict, action: str, t: _Rows, at: int, mid: str, sets: dict[str, Any],
         answer: dict, target: str, ensure: bool = False) -> Decision:
    """The row's cells kept (the tab made whole first when ensureHeader_ comes before them), the line logged."""
    ops = []
    if ensure and t.missing():
        cells = {}
        for k, v in sets.items():
            h = t.head(k) or next((x for x in M.HEADER if norm(x) == k), None)
            if h is not None:
                cells[h] = v
        ops.append(t.mirror(patch=(at, cells)))
        t.widen()
    named = t.edit(at, mid, sets)
    if named is None:
        return W.refuse(409, W.NOT_TOLD_APART)
    log_line(actor, action, target)
    return _kept(sess, actor, action, answer, named[0], ops + named[1], mid)


def authorize(sess: L.Session, payload: dict) -> Decision:
    """platformMemberAuthorize: the answer recorded on a row the caller owns; a world the person shut stays shut."""
    refused, ctx = M.stand(sess, "platformMemberAuthorize")
    if refused:
        return Decision(refused)
    user = ctx["actor"]
    refused = M.owner_gate(user)
    if refused:
        return Decision(refused)
    p = payload if isinstance(payload, dict) else {}
    mid = s_(p.get("member_id"))
    scope = s_(p.get("scope")).lower()
    if scope not in M.SCOPES:
        return Decision(dict(BAD_SCOPE))
    t = _Rows(sess.reads)
    at = t.first(mid)
    if at is None:
        return Decision(dict(M.NOT_FOUND))
    row = t.rows[at]
    if t.cell(row, "owneruserid") != s_(user.get("id")) or _the_master(sess.reads, t.cell(row, "memberuserid")):
        return Decision(dict(M.NOT_FOUND))
    if scope == "work_world" and M.world_locked_by_owner({"scope": t.cell(row, "scope"),
                                                          "scopeby": t.cell(row, "scopeby")}):
        return Decision(dict(SHUT))
    return _set(sess, user, "platformMemberAuthorize", t, at, mid,
                {"scope": scope, "scopeby": "owner", "status": "active", "authorizedat": _now(sess.reads),
                 "authorizedby": s_(p.get("by")) or "recorded by the owner"},
                {"status": 200, "data": {"ok": True, "scope": scope}}, mid + " → " + scope)


def _the_master(reads: L.Reads, uid: str) -> bool:
    """The account a row brings in is the master's: no visit ever reaches it."""
    return bool(uid) and M.master_row(M.users_by_id(reads).get(uid))


def _retire(sess: L.Session, actor: dict, payload: dict, action: str, side: str) -> Decision:
    """The row marked removed, now — found by its id and refused with a 404 unless `side` names the caller."""
    mid = s_((payload or {}).get("member_id"))
    if not mid:
        return Decision(dict(NO_ID))
    t = _Rows(sess.reads)
    at = t.first(mid)
    if at is None or t.cell(t.rows[at], side) != s_(actor.get("id")):
        return Decision(dict(M.NOT_FOUND))
    return _set(sess, actor, action, t, at, mid, {"status": "removed", "removedat": _now(sess.reads)},
                {"status": 200, "data": {"ok": True}}, mid)


def remove(sess: L.Session, payload: dict) -> Decision:
    """platformMemberRemove: only the owner of the row may retire it."""
    refused, ctx = M.stand(sess, "platformMemberRemove")
    if refused:
        return Decision(refused)
    refused = M.owner_gate(ctx["actor"])
    if refused:
        return Decision(refused)
    return _retire(sess, ctx["actor"], payload, "platformMemberRemove", "owneruserid")


def leave(sess: L.Session, payload: dict) -> Decision:
    """platformMemberLeave: the other side of the door — only your own link."""
    refused, ctx = M.stand(sess, "platformMemberLeave")
    if refused:
        return Decision(refused)
    user = ctx["actor"]
    if not user or user.get("is_service"):
        return Decision(dict(M.DENIED))
    return _retire(sess, user, payload, "platformMemberLeave", "memberuserid")


def world_access_set(sess: L.Session, payload: dict) -> Decision:
    """myWorldAccessSet: my answer, and only about my own world — the row must be mine to BE."""
    refused, ctx = M.stand(sess, "myWorldAccessSet")
    if refused:
        return Decision(refused)
    user = ctx["actor"]
    if not user or user.get("is_service"):
        return Decision(dict(M.DENIED))
    reads = sess.reads
    if M.world_withheld(reads, user):
        return Decision(dict(M.NOT_FOUND))
    p = payload if isinstance(payload, dict) else {}
    mid = s_(p.get("member_id"))
    if not mid:
        return Decision(dict(NO_ID))
    is_open = p.get("open") is True
    t = _Rows(reads)
    at = t.first(mid)
    if at is None or t.cell(t.rows[at], "memberuserid") != s_(user.get("id")):
        return Decision(dict(M.NOT_FOUND))
    return _set(sess, user, "myWorldAccessSet", t, at, mid,
                {"scope": "work_world" if is_open else "work", "scopeby": "member", "authorizedat": _now(reads),
                 "authorizedby": "their own choice"},
                {"status": 200, "data": {"ok": True, "world_open": is_open}},
                mid + " → " + ("open" if is_open else "closed"), ensure=True)


# ---- the reply sweep -----------------------------------------------------------------------------------------------

def sweep(sess: L.Session, payload: dict) -> Decision:
    """platformMemberSweep: each reply its prepare read for a word patched onto its row — declined, or active at the
    scope they chose; the person sweeps what they asked for."""
    refused, ctx = M.sweep_gate(sess)
    if refused:
        return Decision(refused)
    prep = (payload or {}).get("prepared")
    if not isinstance(prep, dict) or not isinstance(prep.get("verdicts"), list):
        # the mailbox is read by platformMemberSweepPrepare first (BACKEND_WRITE_PREPARE); unread, nothing is swept
        return Decision({"status": 200, "data": {"read": 0, "authorized": 0, "declined": 0,
                                                 "why": "the mailbox could not be read"}})
    if prep.get("why"):
        return Decision({"status": 200, "data": {"read": 0, "authorized": 0, "declined": 0, "why": s_(prep["why"])}})
    t = _Rows(sess.reads)
    now = _now(sess.reads)
    edits: list[dict] = []
    ops: list[dict] = []
    authorized = declined = 0
    for v in prep["verdicts"]:
        mid, verdict = s_((v or {}).get("member_id")), s_((v or {}).get("verdict"))
        if verdict not in ("no",) + M.SCOPES:
            continue
        at = t.first(mid)
        if at is not None and not _the_master(sess.reads, t.cell(t.rows[at], "memberuserid")):
            sets = {"status": "declined", "authorizedat": now, "authorizedby": "their reply"} if verdict == "no" \
                else {"status": "active", "scope": verdict, "authorizedat": now, "authorizedby": "their reply"}
            named = t.edit(at, mid, sets)
            if named is not None:
                edits += named[0]
                ops += named[1]
        if verdict == "no":
            declined += 1
        else:
            authorized += 1
    answer = {"status": 200, "data": {"read": int(prep.get("read") or 0), "authorized": authorized,
                                      "declined": declined}}
    return _kept(sess, ctx["actor"], "platformMemberSweep", answer, edits, ops, "")


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {
    "platformMemberAsk": ask, "platformMemberAuthorize": authorize, "platformMemberRemove": remove,
    "platformMemberLeave": leave, "myWorldAccessSet": world_access_set, "platformMemberSweep": sweep}
# main.policy_gate asks nothing: each door settles the place first and asks its declared roles then (members.stand)
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
# the ask's LockService refusal, in its words, for every door the platform's write lock holds back
BUSY_OF: dict[str, dict[str, Any]] = {a: {"status": 409, "message": BUSY} for a in ACTIONS}


class Store(W.Store):
    """app.members_writes and app.members_receipts, beside the other apps' own; the rows app.edits'."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="members", label="Platform users")
