"""Credentials › Password resets, the master's alone: any account's password set to the workspace default (the one
new accounts are armed with, users_writes.default_password) or to one the master types, flagged to be changed at the
next sign-in exactly as a first sign-in is (the users row's mustchange; MustChangePasswordGate in the SPA). The
person's open sessions end, and the block their wrong tries left is lifted, so the next sign-in with that password is
theirs. The operator, 2026-10-28: people will often ask "reseta a minha senha".

Everyone but the master is told the lane does not exist (route_switches._master_door). The master's own account is
never reset here. A password is never logged, never answered back, and never kept anywhere but the sign-in's
credential store."""
from __future__ import annotations

import logging
from typing import Any, Callable

import auth as A
import auth_doors as AD
import auth_store as AS
import auth_twin as AT
import gsjs
import hubdb
import locations as L
import smart_comms as SC
import users_writes as UW
import writes as W

try:
    from fastapi import Request
except ImportError:  # the checks import the lane without the web framework
    Request = Any  # type: ignore[misc,assignment]

log = logging.getLogger("asa-hub-app.credentials-resets")

LANE = "/hub-lanes/credentials-resets"
ACTION = "credentialsPasswordReset"
NO_ACCOUNT = "No account with that id."
MASTER_OWN = "The master's own password is never reset here."
NO_DEFAULT = "No workspace default password is set, so type the password to give."
SHORT = f"A typed password needs at least {UW.PASSWORD_MIN} characters."
BUSY = "The platform is busy writing — try again in a moment."
NOT_KEPT = "The reset could not be kept, so nothing changed."

s_ = gsjs.str_


def account(u: dict) -> dict[str, Any]:
    """One account as the tab lists it: never a password, a hash or a session."""
    return {"id": s_(u.get("userid")), "name": s_(u.get("displayname")), "email": s_(u.get("email")).lower(),
            "role": s_(u.get("role")) or "staff", "active": not A.inactive(u),
            "mustChange": s_(u.get("mustchange")).lower() == "true", "lastLogin": s_(u.get("lastlogin")),
            "master": A.master_row(u)}


def view(reads: L.Reads) -> dict[str, Any]:
    """Every live account, by name; whether a workspace default is there to give."""
    rows = [account(u) for u in reads.users() if s_(u.get("userid")) and not s_(u.get("mergedinto"))]
    rows.sort(key=lambda r: (r["name"] or r["email"]).lower())
    return {"accounts": rows, "defaultReady": bool(UW.default_password(reads)), "minLength": UW.PASSWORD_MIN}


def reset(ctx: AD.Context, master_uid: str, payload: dict) -> dict[str, Any]:
    """The account's password set, its must-change flag raised, its sessions ended and its sign-in block lifted, in one
    write under the platform's lock; nothing changes when any of it cannot be kept."""
    p = payload if isinstance(payload, dict) else {}
    uid = s_(p.get("userId"))
    reads = L.Reads(ctx.db, ctx.drive)
    users = reads.users()
    me = A.user_by_id(users, master_uid) if master_uid else None
    by = s_((me or {}).get("email")).lower() or "master"
    u = A.user_by_id(users, uid) if uid else None
    if u is None:
        return {"status": 404, "message": NO_ACCOUNT}
    if A.master_row(u):
        return {"status": 409, "message": MASTER_OWN}
    typed = gsjs.or_text(p.get("password")) if p.get("useDefault") is not True else ""
    if typed:
        if UW.js_len(typed) < UW.PASSWORD_MIN:
            return {"status": 400, "message": SHORT}
        pw, how = typed, "typed"
    else:
        pw, how = UW.default_password(reads), "default"
        if not pw:
            return {"status": 409, "message": NO_DEFAULT}
    email = s_(u.get("email")).lower()
    wid = AD._wid(ACTION)  # noqa: SLF001 - the sign-in's own write ids
    try:
        with ctx.store.locked() as tx, SC.deciding(tx, wid, ACTION), AD.relaid(ctx, tx) as now_reads:
            AS.password_set(tx, uid, pw, wid)
            AD.row_cells(tx.cur, now_reads, uid, {"mustchange": "true"}, ACTION, by, wid)
            ended = AS.account_sessions_end(tx.cur, uid)
            for _th, twin in ended:
                AT.cancel(tx.cur, twin)
            if email:
                AS.count_drop(tx, "lf", A.ident_hash(email))
    except W.Busy:
        return {"status": 409, "message": BUSY}
    except (W.NotKept, hubdb.Unreadable):
        return {"status": 503, "message": NOT_KEPT}
    AD._line(by, "password_reset_by_master", email or uid)  # noqa: SLF001 - the sign-in's own log line
    log.info("credentials: %s's password reset to the %s one by the master, %d session(s) ended — the next sign-in "
             "chooses a new one", email or uid, how, len(ended))
    return {"status": 200, "data": {"reset": True, "how": how, "sessionsEnded": len(ended),
                                    "account": account({**u, "mustchange": "true"})}}


async def _the_master(request: Any) -> tuple[Any, dict[str, Any] | None]:
    """The master's own session alone, as Settings' other master lanes ask it (route_switches._master_door)."""
    import route_switches  # noqa: PLC0415
    return await route_switches._master_door(request)  # noqa: SLF001


def install(app: Any, ctx_of: Callable[[], AD.Context]) -> None:
    """GET the accounts, POST a reset: the master's alone (_the_master)."""
    from starlette.concurrency import run_in_threadpool  # noqa: PLC0415

    async def lane(request: Request) -> Any:
        import lane_gate as LG  # noqa: PLC0415
        _s, refused = await _the_master(request)
        if refused is not None:
            return LG.answer(refused, no_store=True)
        ctx = ctx_of()
        got = await run_in_threadpool(lambda: view(L.Reads(ctx.db, ctx.drive)))
        return LG.answer({"status": 200, "data": got}, no_store=True)

    async def reset_now(request: Request) -> Any:
        import lane_gate as LG  # noqa: PLC0415
        s, refused = await _the_master(request)
        if refused is not None:
            return LG.answer(refused, no_store=True)
        try:
            body = await request.json()
        except Exception:  # noqa: BLE001 - an unreadable body asks nothing
            body = {}
        got = await run_in_threadpool(reset, ctx_of(), str(getattr(s, "uid", "") or ""),
                                      body if isinstance(body, dict) else {})
        return LG.answer(got, no_store=True)

    app.get(LANE, include_in_schema=False)(lane)
    app.post(LANE, include_in_schema=False)(reset_now)
