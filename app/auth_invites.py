"""The invitations (apps-script/Invites.gs) off asa-hub-db: invitesList for an admin, and the invitee's two public
doors — inviteContext, and inviteRegister, which makes the account (its users row kept in app.edits, its password in
app.auth_credentials) and opens its first session. inviteSend and inviteRevoke are app/auth_invites_writes.py."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Callable
from urllib.parse import quote

import account_profile_writes as APW
import auth as A
import auth_store as AS
import auth_twin as AT
import gsjs
import house_tables as HT
import hubdb
import locations as L
import mail_designs as MD
import staff as SP
import studio as ST
import writes as W
from scope import Defer

APP_ID = "auth"
# Invites.gs INVITES_TAB / INVITES_HEADER / INVITE_LINK_SECRET_PROP / INVITE_TTL_DAYS
INVITES_TAB = "platform_invites"
INVITES_HEADER = ("invite_id", "email", "phone", "name", "status", "invited_by", "invited_at", "registered_at",
                  "user_id", "expires_at", "tenant")
SECRET_PROP = "INTERVIEW_LINK_SECRET"
TTL_DAYS = 14
USERS_TAB = "users"
DENIED = {"status": 403, "message": "Requires an admin or manager account"}
DEAD = {"status": 404, "message": "This invitation is not valid any more. Ask for a new one."}
USED = {"status": 409, "message": "This invitation was already used — sign in with your e-mail instead."}
SHORT = {"status": 400, "message": "Your password needs at least 8 characters."}
SUBJECT = "Invitations"

s_ = gsjs.str_


def secret(reads: L.Reads) -> str:
    """inviteSecret_: INTERVIEW_LINK_SECRET; '' when unset."""
    return gsjs.or_blank(reads.db.prop(SECRET_PROP))


def link(token: str) -> str:
    """inviteLink_: the platform's address (mailPlatformUrl_), then the register page with the token."""
    return MD.mail_platform_url().rstrip("/") + "/#/register?t=" + quote(token, safe="-_.!~*'()")


def ms(v: Any) -> float | None:
    """new Date(cell).getTime(): None where Apps Script reads NaN."""
    t = s_(v)
    if not t:
        return None
    try:
        at = datetime.fromisoformat(t.replace("Z", "+00:00"))
    except ValueError:
        return None
    if at.tzinfo is None:
        at = at.replace(tzinfo=timezone.utc)
    return at.timestamp() * 1000.0


def tab(reads: L.Reads) -> hubdb.Resolved:
    """invitesSheet_: headquarters' tab (platform_invites is a central tab), the rows Python appended included."""
    return W.tab_of(reads, INVITES_TAB)


def rows(reads: L.Reads) -> list[tuple[int, dict]]:
    """The tab's rows as (sheet row, cells by the copy's header), each request's own writes laid."""
    res = tab(reads)
    return [] if res.ref is None else reads.db.rows(res.ref)


def normalized(raw: dict) -> dict:
    """readTabNormalized_'s keys for one row."""
    out: dict[str, Any] = {}
    for h, v in raw.items():
        k = hubdb.norm_key(h)
        if k:
            out[k] = hubdb.cell_text(hubdb.typed(v, "hub"))
    return out


def invites(reads: L.Reads) -> list[dict]:
    """invitesRows_."""
    return reads.once("auth_invites", lambda: [normalized(raw) for _rn, raw in rows(reads)])


def by_token(reads: L.Reads, token: Any) -> dict | None:
    """inviteByToken_: the row of an invitation this platform signed."""
    iid = A.invite_id_of(secret(reads), token)
    if not iid:
        return None
    return next((r for r in invites(reads) if s_(r.get("inviteid")) == iid), None)


def expired(row: dict, now_ms: float) -> bool:
    exp = ms(row.get("expiresat"))
    return exp is not None and exp < now_ms


def now_ms(reads: L.Reads) -> float:
    return reads.now.timestamp() * 1000.0


def js_len(s: str) -> int:
    """String.length: UTF-16 units."""
    return len(s.encode("utf-16-le")) // 2


# ---- the admin's list ----------------------------------------------------------------------------------------------

def invites_list(sess: L.Session, payload: dict) -> dict[str, Any]:
    """invitesList: every invitation this place sees, newest first; the token is never echoed."""
    user = sess.user or {}
    if not sess.user or user.get("is_service") or s_(user.get("role")) != "admin":
        return dict(DENIED)
    reads = sess.reads
    here = ST.tenant_id(reads, user)
    at = now_ms(reads)
    out = []
    for i in invites(reads):
        if here and s_(i.get("tenant")) != here:
            continue
        exp = s_(i.get("expiresat"))
        status = s_(i.get("status"))
        out.append({"invite_id": s_(i.get("inviteid")), "email": s_(i.get("email")), "phone": s_(i.get("phone")),
                    "name": s_(i.get("name")),
                    "status": "registered" if status == "registered" else
                    ("expired" if exp and expired(i, at) else status or "sent"),
                    "invited_at": s_(i.get("invitedat")), "registered_at": s_(i.get("registeredat")),
                    "expires_at": exp})
    out.sort(key=lambda r: r["invited_at"], reverse=True)
    return {"status": 200, "data": {"invites": out, "secret_set": bool(secret(reads))}}


# ---- the invitee's two doors ---------------------------------------------------------------------------------------

def context(reads: L.Reads, payload: dict) -> dict[str, Any]:
    """inviteContextPub_: the name and address an invitation was sent to, while it can still be used."""
    row = by_token(reads, (payload or {}).get("t"))
    if not row or s_(row.get("status")) == "revoked":
        return dict(DEAD)
    if s_(row.get("status")) == "registered":
        return dict(USED)
    if expired(row, now_ms(reads)):
        return dict(DEAD)
    return {"status": 200, "data": {"name": s_(row.get("name")), "email": s_(row.get("email"))}}


def _users_row(reads: L.Reads, cells: dict[str, str]) -> tuple[str, str, dict[str, str]]:
    """(sheet, tab, cells by the copy's header): put()'s cells, each under the column the users tab has (its own
    table's once kept there)."""
    res = HT.where(reads, USERS_TAB) if HT.tabled(USERS_TAB) else W.tab_of(reads, USERS_TAB)
    if res.ref is None:
        raise Defer("the users tab holds no rows in the copy")
    sid, name = W.where_of(res)
    out: dict[str, str] = {}
    for key, value in cells.items():
        head = W.header_of(res.ref, key, norm=True)
        if head is not None:
            out[head] = value
    if not any(hubdb.norm_key(h) == "userid" for h in out):
        raise Defer("the users tab has no user_id column")
    return sid, name, out


def _keep(cur: Any, write_id: str, author: str, edits: list[dict]) -> None:
    """writes.Tx.record's kept edits, with no receipt: the answer carries a session token (a kept users tab takes its
    rows in its table)."""
    try:
        W.keep_rows(cur, write_id, APP_ID, "inviteRegister", W.final({"status": 200}, edits, SUBJECT), author)
    except W.NotKept:
        raise
    except Exception as exc:  # noqa: BLE001 - the whole transaction rolls back with it
        raise W.NotKept(f"app.edits refused the insert ({type(exc).__name__})") from exc


def register(cur: Any, reads: L.Reads, payload: dict, write_id: str) -> dict[str, Any]:
    """inviteRegisterPub_, inside the platform's write lock: the account made from the invitation (role staff, the
    password the invitee chose, no must-change flag), the invitation marked registered, and the first session."""
    p = payload or {}
    row = by_token(reads, p.get("t"))
    if not row or s_(row.get("status")) != "sent" or expired(row, now_ms(reads)):
        return dict(DEAD)
    pw = "" if gsjs.falsy(p.get("password")) else gsjs.js_str(p.get("password"))
    if js_len(pw) < 8:
        return dict(SHORT)
    name = gsjs.trim(s_(p.get("display_name"))) or s_(row.get("name"))
    if SP.fold(name) != SP.fold(row.get("name")):
        refused = APW.self_name_refused(reads, "", name)
        if refused:
            return {"status": 409, "message": refused}
    email = s_(row.get("email")).lower()
    if "@" not in email:
        return dict(DEAD)
    if A.user_by_email(reads.users(), email):
        return dict(USED)
    uid = "USR_" + A.random_hex(12).upper()
    at = gsjs.iso(reads.now)
    sid, name_of_tab, cells = _users_row(reads, {
        "user_id": uid, "email": email, "display_name": name,
        "name_by": "self" if SP.fold(name) != SP.fold(row.get("name")) else "",
        "role": "staff", "active": "true", "created_at": at, "phone": s_(row.get("phone")),
        "home_tenant": s_(row.get("tenant"))})
    uid_head = next(h for h in cells if hubdb.norm_key(h) == "userid")
    edits = [W.kept_record(sid, name_of_tab, "append", W.COLS + uid_head, uid, SUBJECT, cells)]
    inv = tab(reads)
    if inv.ref is None:
        return dict(DEAD)
    isid, itab = W.where_of(inv)
    raw_rows = reads.db.rows(inv.ref)
    at_row = next((n for n, (_rn, raw) in enumerate(raw_rows)
                   if s_(normalized(raw).get("inviteid")) == s_(row.get("inviteid"))), None)
    head = W.header_of(inv.ref, "invite_id", norm=True)
    got = W.row_key_of(raw_rows, at_row, [[head]]) if at_row is not None and head else None
    if got is None:
        return dict(DEAD)
    marks = {}
    for key, value in (("status", "registered"), ("registered_at", at), ("user_id", uid)):
        h = W.header_of(inv.ref, key, norm=True)
        if h is not None:
            marks[h] = value
    edits.append(W.kept_record(isid, itab, "edit", got[0], got[1], SUBJECT, marks,
                               before={h: s_(raw_rows[at_row][1].get(h)) for h in marks}))
    _keep(cur, write_id, W.who({"display_name": name, "email": email}), edits)
    AS.password_set(cur, uid, pw, write_id)
    token = AT.open_session(cur, {"userid": uid, "email": email})
    return {"status": 200, "data": {"token": token,
                                    "user": {"id": uid, "email": email, "display_name": name, "role": "staff"}}}


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {"invitesList": invites_list}
POLICY: dict[str, dict[str, Any]] = {"invitesList": {"roles": ("admin",)}}
