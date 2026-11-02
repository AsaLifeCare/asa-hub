"""The sign-in's doors off asa-hub-db and the Hub's own tables, called by the relay alone (main.py /v1/auth/{action}):
Auth.gs authStatus, authBootstrap, authLogin, authMe and authLogout; PasswordReset.gs authForgot, authResetContext and
authResetSubmit; Invites.gs inviteContext and inviteRegister (app/auth_invites.py); and the relay's own `_verdict`
(the session behind a token, for its gate) and `_import` (app/auth_import.py). Every refusal in its own words. While
auth.MASTER_SIGN_IN_ON_APPS_SCRIPT holds, the master's row, the master's sessions and any token this store never
minted or carried over are deferred: the relay hands them to Apps Script unchanged."""
from __future__ import annotations

import contextlib
import logging
import re
import time
from datetime import timedelta
from typing import Any, Callable, Iterator

import account_profile as AP
import auth as A
import auth_acting as ACT
import auth_import as AI
import auth_invites as INV
import auth_store as AS
import auth_twin as AT
import book_ops as BO
import envelope as EV
import gsjs
import house_tables as HT
import hubdb
import locations as L
import scope as sc
import smart_comms as SC
import staff as SP
import staff_views
import writes as W
from scope import Defer

log = logging.getLogger("asa-hub-app.auth")

APP_ID = "auth"
SUBJECT = "Sign-in"
USERS_TAB = "users"
# PasswordReset.gs
RESET_TAB = "password_resets"
RESET_SITUATION = "auth_password_reset"
RESET_TEMP_MINUTES = 30
RESET_TEMP_PER_HOUR = 3
RESET_SIGN_IN_URL = "https://asamylife.asalifecare.com"
RESET_SMS_FLOOR = "ASA MyLife: your temporary password is {password}. Sign in at {url} and choose a new one."
RESET_SUBJECT_FLOOR = "ASA MyLife — your temporary password"
RESET_MAIL_FLOOR = ("ASA MyLife: your temporary password is {password}.\n\nSign in at {url} and choose a new one.\n\n"
                    "It works once, within {minutes} minutes. If you did not ask for it, ignore this message — "
                    "your current password still works.")
RESET_SMS_PHRASE = re.compile(r"temporary password is \{password\}", re.I)
RESET_LINK_DEAD = ("This link is not valid any more. Use Forgot password on the sign-in page — it sends a temporary "
                   "password instead.")
GENERIC = {"status": 200, "data": {"sent": True}}
SHORT = {"status": 400, "message": "Your password needs at least 8 characters."}
ONE_MOMENT = {"status": 409, "message": "One moment — try again in a few seconds."}
NOT_SAVED = {"status": 500, "message": "The password could not be saved — try the link again."}
PUBLIC = frozenset({"authStatus", "authBootstrap", "authLogin", "authMe", "authLogout", "authForgot",
                    "authResetContext", "authResetSubmit", "inviteContext", "inviteRegister"})
# the session doors of the master's own switch: the session and the place come in the body, as doPost reads them
SESSION = frozenset({"beAnotherList", "beAnotherStart", "beAnotherStop"})
SERVICE = frozenset({"_verdict", "_import", "_end_account"})
DOORS = PUBLIC | SESSION | SERVICE

s_ = gsjs.str_


class HandBack(Defer):
    """What Apps Script keeps answering (main.py answers it 409): the master's own sign-in, the master's sessions and
    every token this store never minted or carried over, while auth.MASTER_SIGN_IN_ON_APPS_SCRIPT holds. Any other
    Defer is this door not answering, which the relay says as such and never hands to Apps Script."""


class Context:
    """What a door reads and writes with: main.py's reader, Drive, the sign-in's store, and the writes Python keeps
    laid over the copy (`own()`, and `own_locked(tx)` read again under the platform's write lock)."""

    def __init__(self, db: hubdb.HubDb, drive: Any, store: AS.Store, own: Callable[[], Any] | None = None,
                 own_locked: Callable[[Any], Any] | None = None) -> None:
        self.db, self.drive, self.store, self.own, self.own_locked = db, drive, store, own, own_locked


@contextlib.contextmanager
def relaid(ctx: Context, tx: Any) -> Iterator[L.Reads]:
    """Reads decided under the lock: every write kept before this one is in them."""
    token = hubdb.OWN.set(ctx.own_locked(tx) if ctx.own_locked is not None else hubdb.OWN.get())
    try:
        yield L.Reads(ctx.db, ctx.drive)
    finally:
        hubdb.OWN.reset(token)


def run(action: str, body: dict[str, Any], ctx: Context) -> dict[str, Any]:
    """One door, its reads laid with every write Python keeps; Defer hands it to Apps Script."""
    if action not in DOORS:
        raise Defer("not a sign-in door")
    if not ctx.store.ready():
        raise Defer(ctx.store.why or "the sign-in's store is not ready")
    payload = body.get("payload") if isinstance(body.get("payload"), dict) else {}
    books: set[str] = set()
    token = hubdb.READ_BOOKS.set(books)
    own_token = hubdb.OWN.set(ctx.own() if ctx.own is not None else None)
    try:
        reads = L.Reads(ctx.db, ctx.drive)
        return DISPATCH[action](ctx, reads, payload, body)
    finally:
        hubdb.OWN.reset(own_token)
        hubdb.READ_BOOKS.reset(token)


def _wid(action: str) -> str:
    return "W" + A.sha256_hex(f"{action}|{time.time_ns()}|{A.random_hex(16)}")[:24]


def _line(actor: Any, action: str, target: Any, who: str = "") -> None:
    """hubSysLog_ (the line Main.gs writes for every auth action but authMe and authStatus)."""
    staff_views.record({"email": s_(actor), "display_name": who}, action, s_(target))


def _mask(ident: Any) -> str:
    """resetMask_."""
    s = s_(ident)
    at = s.find("@")
    if at > 0:
        return s[0] + "•••" + s[at:]
    return "•••" + s[-4:] if len(s) > 4 else "•••"


def _password(raw: Any) -> str:
    """String(payload.password || '')."""
    return "" if gsjs.falsy(raw) else gsjs.js_str(raw)


def _js_len(s: str) -> int:
    return len(s.encode("utf-16-le", "surrogatepass")) // 2


# ---- the account row's own cells (last_login, must_change), as every Python write to it keeps them ---------------

def row_cells(cur: Any, reads: L.Reads, uid: str, cells: dict[str, str], action: str, author: str,
              write_id: str) -> int:
    """Cells of the account's users row (normKey_ names) kept in app.edits by its user_id and carried to the sheet at
    once by a `cells` book op, under the platform's write lock; a column the tab lacks is left out."""
    # the users tab as it stands: its own table once kept there
    res = HT.where(reads, USERS_TAB) if HT.tabled(USERS_TAB) else W.tab_of(reads, USERS_TAB)
    if res.ref is None:
        return 0
    sid, tab = W.where_of(res)
    heads: dict[str, str] = {}
    for h in res.ref.headers:
        heads.setdefault(hubdb.norm_key(h), h)
    rows = reads.db.rows(res.ref)
    at = next((i for i, (_rn, raw) in enumerate(rows)
               if s_(hubdb.typed(raw.get(heads.get("userid", "")), "hub")) == uid), None)
    id_head = heads.get("userid")
    got = W.row_key_of(rows, at, [[id_head]]) if at is not None and id_head else None
    after = {heads[k]: v for k, v in cells.items() if k in heads}
    if got is None or not after:
        return 0
    before = {h: s_(hubdb.typed(rows[at][1].get(h), "hub")) for h in after}
    rec = W.kept_record(sid, tab, "edit", got[0], got[1], SUBJECT, after, before)
    # a kept users tab takes the cells in its table; only a sheet needs them carried there at once
    if W.keep_rows(cur, write_id, APP_ID, action, W.final({"status": 200}, [rec], SUBJECT), author):
        BO.queue([{"op": "cells", "sheet_id": sid, "tab": tab,
                   "spec": {"match": id_head, "key": uid, "cells": after, "before": before}}], SUBJECT, author, action)
    return len(after)


# ---- authStatus, authBootstrap ------------------------------------------------------------------------------------

def status(ctx: Context, reads: L.Reads, payload: dict, body: dict) -> dict[str, Any]:
    """authStatus."""
    return {"status": 200, "data": {"needsBootstrap": len(reads.users()) == 0}}


def bootstrap(ctx: Context, reads: L.Reads, payload: dict, body: dict) -> dict[str, Any]:
    """authBootstrap: refused once any account exists; the first account is the master's own, Apps Script's to make."""
    if reads.users():
        return dict(A.SETUP_DONE)
    name, email = s_(payload.get("display_name")), s_(payload.get("email")).lower()
    pw = _password(payload.get("password"))
    if not name or "@" not in email or _js_len(pw) < 8:
        return dict(A.SETUP_WANTS)
    raise HandBack("the first account is made where the users tab is born")


# ---- authLogin ----------------------------------------------------------------------------------------------------

def login(ctx: Context, reads: L.Reads, payload: dict, body: dict) -> dict[str, Any]:
    """authLogin: the account an address signs in (userByEmail_), its password or its live temporary one, blocked
    before wrong, the lane, the temporary one spent before anything opens, the stamps, then the session."""
    ident = s_(payload.get("identifier")).lower()
    pw = _password(payload.get("password"))
    u = A.user_by_email(reads.users(), ident) if ident else None
    if A.handed_back(u, ident):
        raise HandBack("the master signs in through Apps Script")
    if not ident or not pw:
        env = dict(A.REQUIRED)
        _line(ident, "authLogin", "", "")
        return env
    fkey = A.ident_hash(ident)
    store = ctx.store
    with store.tx() as cur:
        fails = AS.count(cur, "lf", fkey)
        if fails >= A.LOGIN_FAIL_MAX:
            _line(ident, "authLogin", "")
            return dict(A.TOO_MANY)
        uid = s_(u.get("userid")) if u else ""
        ok, temp = False, None
        if u and uid:
            cred = AS.credential(cur, uid)
            ok = bool(cred and cred["salt"] and cred["hash"]
                      and A.same(A.hash_password(pw, cred["salt"]), cred["hash"]))
            if not ok:
                temp = AS.temp_match(cur, uid, pw)
                ok = temp is not None
        if ok and A.inactive(u):
            _line(ident, "authLogin", "")
            return dict(A.BLOCKED)
        if not ok:
            AS.count_put(cur, "lf", fkey, fails + 1, A.LOGIN_FAIL_TTL_S)
    if not ok:
        _line(ident, "authLogin", "")
        return dict(A.INVALID)
    lane = A.lane_check(s_(u.get("role")), payload.get("lane"))
    if lane:
        _line(ident, "authLogin", "")
        return lane
    stamps = {"lastlogin": gsjs.iso(AS.now())}
    must = s_(u.get("mustchange")).lower() == "true"
    if temp is not None or (not s_(u.get("lastlogin")) and not s_(u.get("mustchange"))):
        # a temporary password, or the first sign-in ever (still the shared default): the person chooses their own
        stamps["mustchange"] = "true"
        must = True
    user = A.session_user(reads, {**u, "mustchange": "true" if must else u.get("mustchange")}, must)
    wid = _wid("authLogin")
    author = W.who(user)
    try:
        with store.locked() as tx, SC.deciding(tx, wid, "authLogin"), relaid(ctx, tx) as now_reads:
            if temp is not None and not AS.temp_spend(tx, temp):
                raise _Spent()
            AS.count_drop(tx, "lf", fkey)
            token = AT.open_session(tx.cur, u)
            row_cells(tx.cur, now_reads, uid, stamps, "authLogin", author, wid)
    except _Spent:
        _line(ident, "authLogin", "")
        return dict(A.INVALID)
    except W.Busy:
        if temp is not None:
            # SPENT BEFORE IT OPENS ANYTHING: a temporary password not marked used signs nobody in
            _line(ident, "authLogin", "")
            return dict(A.INVALID)
        # the sign-in's stamps are kept only under the lock: the relay says try again
        raise Defer("the platform's write lock was held")
    _line(ident, "authLogin", "", s_(user.get("display_name")))
    data: dict[str, Any] = {"token": token, "user": user}
    # the master's controls are drawn only when the server names the hardcoded master
    if sc.is_master_email(s_(u.get("email"))):
        data["be_another"] = {"real": {"id": user["id"], "email": user["email"],
                                       "display_name": user["display_name"]}, "acting": None}
    return {"status": 200, "data": data}


class _Spent(Exception):
    """The temporary password stopped being the live one between the match and the spend."""


# ---- authMe, authLogout, the relay's verdict ----------------------------------------------------------------------

def _session(ctx: Context, reads: L.Reads, token: Any) -> tuple[dict, dict, dict | None] | dict:
    """sessionUser_: (the session, the users row it wears, the acting context of a session minted from the master's
    own, else None), or the refusal; HandBack for what Apps Script keeps."""
    raw = gsjs.or_blank(token)
    if not raw or raw == "null":
        return dict(A.AUTH_REQUIRED)
    th = A.token_hash(raw)
    with ctx.store.tx() as cur:
        s = AS.session_of(cur, th)
        if s is not None and (s["real_user_id"] or s["parent_token_hash"]):
            got = ACT.resolve(cur, reads.users(), s, th, AS.now())
            if got is None:
                return dict(A.AUTH_REQUIRED)
            s["token_hash"] = th
            return s, got[0], got[1]
    if s is None:
        if A.MASTER_SIGN_IN_ON_APPS_SCRIPT and not A.TOKEN_RE.match(raw):
            raise HandBack("a session this store never held")
        return dict(A.AUTH_REQUIRED)
    if not AS.session_live(s):
        return dict(A.AUTH_REQUIRED)
    u = A.user_by_id(reads.users(), s["user_id"])
    if u is not None and A.handed_back(u):
        raise HandBack("the master's session is Apps Script's")
    if u is None or A.inactive(u):
        return dict(A.AUTH_REQUIRED)
    s["token_hash"] = th
    return s, u, None


def _me_user(reads: L.Reads, u: dict, acting: dict | None) -> dict[str, Any]:
    """The session's account as authMe hands it; the account worn keeps the platform mailbox with the real sign-in."""
    user = A.session_user(reads, u, s_(u.get("mustchange")).lower() == "true")
    if acting:
        user["mail_reader"] = False
    return user


def me(ctx: Context, reads: L.Reads, payload: dict, body: dict) -> dict[str, Any]:
    """authMe: the session's account as every boot reads it, and the block the master's own sessions carry; a plain
    session slides at most once a day, one minted from the master's never."""
    got = _session(ctx, reads, body.get("token"))
    if isinstance(got, dict):
        return got
    s, u, acting = got
    user = _me_user(reads, u, acting)
    if acting is None:
        with ctx.store.tx() as cur:
            AS.session_slide(cur, s["token_hash"])
    data: dict[str, Any] = {"user": user}
    block = ACT.auth_block(user, acting, AS.now())
    if block is not None:
        data["be_another"] = block
    return {"status": 200, "data": data}


def logout(ctx: Context, reads: L.Reads, payload: dict, body: dict) -> dict[str, Any]:
    """authLogout: the session ended, Python's verdict alone (a session carried over from the sheet as well); a row's
    op still queued for the Sessions tab taken back."""
    raw = gsjs.or_blank(body.get("token"))
    env: dict[str, Any] = {"status": 200, "data": {"ok": True}}
    if not raw or raw == "null":
        return env
    th = A.token_hash(raw)
    with ctx.store.tx() as cur:
        s = AS.session_of(cur, th)
        if s is None:
            if A.MASTER_SIGN_IN_ON_APPS_SCRIPT and not A.TOKEN_RE.match(raw):
                raise HandBack("a session this store never held")
            return env
        child = bool(s["real_user_id"] or s["parent_token_hash"])
        u = None if child else A.user_by_id(reads.users(), s["user_id"])
        if u is not None and A.handed_back(u):
            raise HandBack("the master's session is Apps Script's")
        AS.session_end(cur, th)
        AT.cancel(cur, s["twin"])
        # the sessions this one started end with it (Apps Script's sign-out ends their rows on the Sessions tab)
        for wid in AS.children_end(cur, th):
            AT.cancel(cur, wid)
    if not child:
        _line("", "authLogout", "")
    return env


def verdict(ctx: Context, reads: L.Reads, payload: dict, body: dict) -> dict[str, Any]:
    """The relay's gate (its _session_actor): {ok, role, uid} for a live session; Defer for Apps Script's."""
    got = _session(ctx, reads, body.get("token"))
    if isinstance(got, dict):
        return {"ok": False, "role": "", "uid": ""}
    _s, u, acting = got
    out = {"ok": True, "role": s_(u.get("role")) or "staff", "uid": s_(u.get("userid")),
           "is_master": acting is None and sc.is_master_email(s_(u.get("email")))}
    if acting is not None:
        # what the relay's acting table learns from an authMe answer, for the doors it guards
        out["be_another"] = ACT.auth_block(_me_user(reads, u, acting), acting, AS.now())
    return out


# ---- beAnotherList, beAnotherStart, beAnotherStop (never logged) ----------------------------------------------------

def _control(ctx: Context, reads: L.Reads, body: dict) -> tuple[dict, dict, dict | None, dict, bool, bool] | dict:
    """doPost up to the handler: the session (401), the place (its 404), the visit; (session, users row, acting, the
    session's account, away from home, visiting)."""
    got = _session(ctx, reads, body.get("token"))
    if isinstance(got, dict):
        return got
    s, u, acting = got
    me_ = ACT.worn(reads, u) if acting else AP.public(reads, u)
    tctx = EV.tenant_context(reads, body.get("tenant"), me_)
    if tctx and tctx.get("error"):
        return dict(tctx["error"])
    mctx = EV.member_context(reads, body.get("member"), me_)
    if mctx and mctx.get("error"):
        return dict(mctx["error"])
    return s, u, acting, me_, bool(tctx and tctx.get("tenantId")), mctx is not None


def control_list(ctx: Context, reads: L.Reads, payload: dict, body: dict) -> dict[str, Any]:
    """beAnotherList: every account the master may act as — the master's own session alone, at home."""
    got = _control(ctx, reads, body)
    if isinstance(got, dict):
        return got
    _s, _u, acting, me_, away, visiting = got
    if away or not ACT.may_start(me_, acting, visiting):
        return dict(ACT.UNKNOWN)
    return {"status": 200, "data": {"accounts": ACT.accounts(reads.users()),
                                    "ttl_minutes": round(ACT.TTL.total_seconds() / 60)}}


def control_start(ctx: Context, reads: L.Reads, payload: dict, body: dict) -> dict[str, Any]:
    """beAnotherStart: a session bound to this master session, wearing the account picked; the earlier ones end."""
    got = _control(ctx, reads, body)
    if isinstance(got, dict):
        return got
    _s, _u, acting, me_, away, visiting = got
    if away or not ACT.may_start(me_, acting, visiting):
        return dict(ACT.UNKNOWN)
    parent_th = A.token_hash(gsjs.or_blank(body.get("token")))
    target_id = s_(payload.get("id")) if isinstance(payload.get("id"), str) else ""
    if not target_id:
        return dict(ACT.PICK)
    target = ACT.user_row(reads.users(), target_id)
    if target is None:
        return dict(ACT.NO_ACCOUNT)
    if s_(target.get("mergedinto")):
        return dict(ACT.MERGED)
    if s_(target.get("active")).lower() == "false":
        return dict(ACT.BLOCKED)
    if sc.is_master_email(s_(target.get("email"))):
        return dict(ACT.OWN)
    wid = _wid("beAnotherStart")
    try:
        with ctx.store.locked() as tx, SC.deciding(tx, wid, "beAnotherStart"), relaid(ctx, tx) as now_reads:
            parent = AS.session_of(tx, parent_th)
            now = AS.now()
            # the parent is this very session: the master's own, live, and never a child
            if (parent is None or parent["user_id"] != s_(me_.get("id")) or parent["real_user_id"]
                    or parent["parent_token_hash"] or not AS.session_live(parent, now)):
                return dict(ACT.UNKNOWN)
            ended = AS.children_end(tx, parent_th)
            for twin_wid in ended:
                AT.cancel(tx.cur, twin_wid)
            if any(ended):
                AT.drop_children(now_reads, parent_th, "beAnotherStart")
            until = min(parent["expires_at"], now + ACT.TTL)
            child = AT.open_child(tx.cur, now_reads, target_id, s_(me_.get("id")), parent_th, until, now, wid,
                                  "beAnotherStart")
    except W.Busy:
        return dict(ACT.BUSY)
    pub = ACT.worn(reads, target)
    try:
        pub["derived_types"] = SP.calendar_badges(reads, pub)
    except Exception:  # noqa: BLE001 - as Apps Script: no badge read, none worn
        pub["derived_types"] = []
    until_iso = gsjs.iso(until)
    real = {"id": s_(me_.get("id")), "email": s_(me_.get("email")), "display_name": s_(me_.get("display_name"))}
    worn = {"id": pub["id"], "display_name": pub["display_name"], "email": pub["email"], "role": pub["role"],
            "types": pub.get("types") or [], "until": until_iso,
            "expires_in_ms": max(0, int((until - AS.now()).total_seconds() * 1000))}
    return {"status": 200, "data": {"token": child, "user": pub, "be_another": {"real": real, "acting": worn}}}


def control_stop(ctx: Context, reads: L.Reads, payload: dict, body: dict) -> dict[str, Any]:
    """beAnotherStop (Be Back): the acting session this call comes from ends; anything else is Unknown. Its row on
    the Sessions tab ends through Apps Script's own sign-out (`_also_apps_script`)."""
    got = _control(ctx, reads, body)
    if isinstance(got, dict):
        return got
    s, _u, acting, _me, _away, _visiting = got
    th = A.token_hash(gsjs.or_blank(body.get("token")))
    if not acting or acting["th"] != th or not sc.is_master_email(s_(acting["real"]["email"])):
        return dict(ACT.UNKNOWN)
    with ctx.store.tx() as cur:
        ended = int(AS.session_end(cur, th))
        AT.cancel(cur, s["twin"])
    env: dict[str, Any] = {"status": 200, "data": {"ok": True, "ended": ended}}
    if s["twin"]:
        env["_also_apps_script"] = True
    return env


def end_account(ctx: Context, reads: L.Reads, payload: dict, body: dict) -> dict[str, Any]:
    """The relay's service door after releaseUser landed (releaseEndSessions_): every session of the account and every
    one minted from them ended here; Apps Script's release ended their rows on the Sessions tab."""
    uid = s_(body.get("user_id"))
    if not uid:
        return {"status": 400, "message": "user_id is required."}
    with ctx.store.tx() as cur:
        ended = AS.account_sessions_end(cur, uid)
        for _th, twin_wid in ended:
            AT.cancel(cur, twin_wid)
    return {"status": 200, "data": {"ended": len(ended)}}


# ---- authForgot ---------------------------------------------------------------------------------------------------

def _situation(reads: L.Reads) -> dict[str, Any]:
    """hubAuthLetterAllowed_('password_reset'): an unreadable tab holds it, no row is on, a row switched off is off."""
    try:
        rows = SC.read_situations(reads.db)
    except Exception as exc:  # noqa: BLE001 - an unreadable switch is never a yes
        return {"on": False, "row": None, "unreadable": True,
                "why": f"the situations tab could not be read ({type(exc).__name__}), so this letter is HELD"}
    row = SC.situation_row(rows, RESET_SITUATION)
    if row is None:
        return {"on": True, "row": None, "unreadable": False, "why": ""}
    on = SC.smart_on(row.get("enabled"))
    return {"on": on, "row": row, "unreadable": False,
            "why": "" if on else (f"the situation {RESET_SITUATION} is switched off on the Desk, so this letter is "
                                  "not sent at all — the switch beats the exemption, the dial does not")}


def reset_words(row: dict | None) -> dict[str, str]:
    """resetWords_: the situation's cells when they name {password}, else the code's."""
    def cell(field: str, floor: str) -> str:
        return gsjs.trim(gsjs.or_blank((row or {}).get(field))) or floor
    mail = cell("email_text", RESET_MAIL_FLOOR)
    own = "{password}" in mail
    sms = cell("sms_text", RESET_SMS_FLOOR)
    return {"subject": cell("email_subject", RESET_SUBJECT_FLOOR) if own else RESET_SUBJECT_FLOOR,
            "mail": mail if own else RESET_MAIL_FLOOR, "sms": sms if RESET_SMS_PHRASE.search(sms) else RESET_SMS_FLOOR}


def phone_on_file(u: dict) -> str:
    """resetPhoneOnFile_: `phone`, then each entry of `phones`; never a shared line."""
    candidates = [s_(u.get("phone"))] + [s_((p or {}).get("number")) if isinstance(p, dict) else ""
                                         for p in SP._parse_phones(u.get("phones"))]
    for raw in candidates:
        num = SC.team_copy(raw) if raw else ""
        if num and SC.sendable(raw):
            return num
    return ""


def _deliver(u: dict, pw: str, allowed: dict) -> dict[str, Any]:
    """resetDeliver_ through Smart Comms alone: the letter first, to the address on file; the text when the letter
    cannot be sent. Both claim the reset's kind (HUB_AUTH_LETTERS) and withhold the password from every record."""
    email, uid = s_(u.get("email")), s_(u.get("userid"))
    words = reset_words(allowed.get("row"))
    vars_ = {"password": pw, "url": RESET_SIGN_IN_URL, "minutes": str(RESET_TEMP_MINUTES), "email": email}
    out: dict[str, Any] = {"channel": "", "why": []}
    if SC.letter_to(email):
        body = A.fill(words["mail"], vars_)
        got = SC.raise_situation(None, situation=RESET_SITUATION, channel="email", to=email,
                                 subject=A.fill(words["subject"], vars_), body=body,
                                 html=A.letter_html(body, RESET_SIGN_IN_URL), transport=True,
                                 auth_letter="password_reset", withhold=[pw], vars={},
                                 key=f"pwreset_mail_{uid}_{A.random_hex(12)}", lane="auth", person=email)
        if got.get("state") == "sent":
            out["channel"] = "email"
            return out
        out["why"].append("email: " + (s_(got.get("why")) or s_(got.get("state")) or "not sent"))
    else:
        out["why"].append("email: no address on the account")
    phone = phone_on_file(u)
    if not phone:
        out["why"].append("sms: no number on the account that may carry a password")
        return out
    got = SC.raise_situation(None, situation=RESET_SITUATION, channel="sms", to=phone, body=A.fill(words["sms"], vars_),
                             transport=True, auth_letter="password_reset", withhold=[pw], vars={},
                             key=f"pwreset_{uid}_{A.random_hex(12)}", lane="auth", person=email)
    if got.get("state") == "sent":
        out["channel"] = "sms"
        return out
    out["why"].append("sms: " + (s_(got.get("why")) or s_(got.get("state")) or "not sent"))
    return out


def forgot(ctx: Context, reads: L.Reads, payload: dict, body: dict) -> dict[str, Any]:
    """authForgot: always the same generic answer; a temporary password is kept only once Smart Comms took the
    message that carries it, in the same transaction."""
    ident = s_(payload.get("identifier")).lower()
    if not ident or len(ident) > 160:
        return dict(GENERIC)
    u = A.user_by_email(reads.users(), ident)
    if A.handed_back(u, ident):
        raise HandBack("the master's reset is Apps Script's")
    store = ctx.store
    with store.tx() as cur:
        key = A.ident_hash(ident)
        asks = AS.count(cur, "pf", key)
        if asks >= RESET_TEMP_PER_HOUR:
            _line(_mask(ident), "password_reset_limited", f"this sign-in already asked {asks} times this hour")
            return dict(GENERIC)
        AS.count_put(cur, "pf", key, asks + 1, 3600)
    if u is None:
        _line(_mask(ident), "password_reset_no_account", "no account signs in with it — nothing was sent")
        return dict(GENERIC)
    email, uid = s_(u.get("email")), s_(u.get("userid"))
    if A.inactive(u):
        _line(email, "password_reset_inactive", "the account is blocked — nothing was sent")
        return dict(GENERIC)
    allowed = _situation(reads)
    if not allowed["on"]:
        _line(email, "password_reset_switch_unreadable" if allowed["unreadable"] else "password_reset_situation_off",
              allowed["why"])
        return dict(GENERIC)
    busy = A.sha256_hex(uid)
    with store.tx() as cur:
        if AS.count(cur, "pfbusy", busy):
            _line(email, "password_reset_busy",
                  "a reset for this account was already on its way — nothing more was sent")
            return dict(GENERIC)
        AS.count_put(cur, "pfbusy", busy, 1, 120)
    try:
        with store.tx() as cur:
            tries = AS.count(cur, "pfa", busy)
            if tries >= RESET_TEMP_PER_HOUR:
                _line(email, "password_reset_limited",
                      f"the account already asked {tries} times this hour — nothing was sent")
                return dict(GENERIC)
            AS.count_put(cur, "pfa", busy, tries + 1, 3600)
            recent = AS.temp_issued_since(cur, uid, AS.now() - timedelta(hours=1))
        if recent >= RESET_TEMP_PER_HOUR:
            _line(email, "password_reset_limited",
                  f"the account was handed {recent} temporary passwords this hour — nothing was sent")
            return dict(GENERIC)
        pw = A.temp_password()
        wid = _wid("authForgot")
        with store.locked() as tx, SC.deciding(tx, wid, "authForgot"):
            sent = _deliver(u, pw, allowed)
            if sent["channel"]:
                AS.temp_keep(tx, uid, pw, sent["channel"], RESET_TEMP_MINUTES, wid)
        SC.kick()
        if not sent["channel"]:
            _line(email, "password_reset_held", "no temporary password reached the person — " + " · ".join(sent["why"]))
            return dict(GENERIC)
        _line(email, "password_reset_sent", "temporary password sent by " +
              ("text" if sent["channel"] == "sms" else "e-mail") +
              (" — " + " · ".join(sent["why"]) if sent["why"] else ""))
    except (W.Busy, hubdb.Unreadable, W.NotKept) as exc:
        _line("asa-hub:auth", "password_reset_failed", type(exc).__name__)
    finally:
        with store.tx() as cur:
            AS.count_drop(cur, "pfbusy", busy)
    return dict(GENERIC)


# ---- the reset link (authResetContext, authResetSubmit) ------------------------------------------------------------

def _reset_row(ctx: Context, reads: L.Reads, token: Any) -> dict[str, Any] | None:
    """resetRowByToken_: the newest row the token's hash names, unused and inside its window."""
    raw = s_(token)
    if len(raw) < 24:
        return None
    want = A.sha256_hex(raw)
    sid, _tab = AI.core(reads)
    ref = reads.db.tab(sid, RESET_TAB)
    if ref is None:
        return None
    rows = reads.db.rows(ref)
    for _rn, r in reversed(rows):
        n = {hubdb.norm_key(k): v for k, v in r.items()}
        if not A.same(s_(n.get("tokenhash")), want):
            continue
        with ctx.store.tx() as cur:
            spent = AS.reset_spent(cur, want)
        if s_(n.get("usedat")) or spent:
            return None
        exp = AI._at(n.get("expiresat"))
        if s_(n.get("expiresat")) and (exp is None or exp < AS.now()):
            return None
        return {"user_id": s_(n.get("userid")), "email": s_(n.get("email")), "hash": want}
    return None


def reset_context(ctx: Context, reads: L.Reads, payload: dict, body: dict) -> dict[str, Any]:
    """authResetContextPub_."""
    hit = _reset_row(ctx, reads, payload.get("t"))
    return {"status": 200, "data": {"email": hit["email"]}} if hit else {"status": 404, "message": RESET_LINK_DEAD}


def reset_submit(ctx: Context, reads: L.Reads, payload: dict, body: dict) -> dict[str, Any]:
    """authResetSubmitPub_: the account's new password, its must-change flag cleared, the link spent."""
    dead = {"status": 404, "message": RESET_LINK_DEAD}
    pw = _password(payload.get("password"))
    if _js_len(pw) < 8:
        return dict(SHORT)
    hit = _reset_row(ctx, reads, payload.get("t"))
    if not hit:
        return dead
    u = A.user_by_id(reads.users(), hit["user_id"])
    if u is None:
        return dead
    if A.handed_back(u):
        raise HandBack("the master's password is Apps Script's")
    wid = _wid("authResetSubmit")
    try:
        with ctx.store.locked() as tx, SC.deciding(tx, wid, "authResetSubmit"), relaid(ctx, tx) as now_reads:
            if not AS.reset_spend(tx, hit["hash"], hit["user_id"]):
                return dead
            AS.password_set(tx, hit["user_id"], pw, wid)
            row_cells(tx.cur, now_reads, hit["user_id"], {"mustchange": ""}, "authResetSubmit", hit["email"], wid)
    except W.Busy:
        return dict(ONE_MOMENT)
    except (W.NotKept, hubdb.Unreadable):
        return dict(NOT_SAVED)
    _line(hit["email"], "password_reset_done", "via reset link")
    return {"status": 200, "data": {"ok": True}}


# ---- the invitation's public doors, the relay's import -------------------------------------------------------------

def invite_context(ctx: Context, reads: L.Reads, payload: dict, body: dict) -> dict[str, Any]:
    """inviteContextPub_."""
    return INV.context(reads, payload)


def invite_register(ctx: Context, reads: L.Reads, payload: dict, body: dict) -> dict[str, Any]:
    """inviteRegisterPub_, under the platform's write lock (its LockService.tryLock)."""
    wid = _wid("inviteRegister")
    try:
        with ctx.store.locked() as tx, SC.deciding(tx, wid, "inviteRegister"), relaid(ctx, tx) as now_reads:
            return INV.register(tx.cur, now_reads, payload, wid)
    except W.Busy:
        return dict(ONE_MOMENT)


def import_(ctx: Context, reads: L.Reads, payload: dict, body: dict) -> dict[str, Any]:
    """The relay's service door: one import in one transaction; its counts."""
    with ctx.store.tx() as cur:
        out = AI.run(cur, reads, ctx.drive)
    return {"status": 200, "data": out}


DISPATCH: dict[str, Callable[[Context, L.Reads, dict, dict], dict[str, Any]]] = {
    "authStatus": status, "authBootstrap": bootstrap, "authLogin": login, "authMe": me, "authLogout": logout,
    "authForgot": forgot, "authResetContext": reset_context, "authResetSubmit": reset_submit,
    "inviteContext": invite_context, "inviteRegister": invite_register, "beAnotherList": control_list,
    "beAnotherStart": control_start, "beAnotherStop": control_stop, "_verdict": verdict,
    "_import": import_, "_end_account": end_account}
