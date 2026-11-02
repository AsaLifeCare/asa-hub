"""Who may read Time Reconciliation over its lanes (/hub-lanes/time-recon/…) and its /gas reads: the master; else one
App Control opens it to (Scheduling's Time Reconciliation row or the app's own) who is among the people its writes let
in (app/recon_writes.py _writer_gate) — an admin or a manager, or anyone the Review edition (recon.review) names with
the app open to them. A page of its own (Overtime) also asks its own App Control row, which with no row is the master's
alone. The lane's session is turned into the gates' user off the users tab; anything unreadable stays shut."""
from __future__ import annotations

from typing import Any, Callable

from fastapi import Request

READERS_ONLY = ("Time Reconciliation is for the admins, managers and people its Review edition names whom App Control "
                "opens it to.")


def _user_of(reads: Any, uid: str) -> dict[str, Any] | None:
    import gsjs  # noqa: PLC0415
    import scope as sc  # noqa: PLC0415
    row = next((u for u in reads.users() if gsjs.str_(u.get("userid")) == uid), None)
    return sc.user_from_row(row) if row is not None else None


def may_read(reads: Any, user: dict[str, Any] | None, is_master: bool) -> bool:
    """The master; else App Control first (recon.app_open: Scheduling's Time Reconciliation row or the app's own, the
    operator's access sheet of 2026-10-29), then the writers' gate for a read: an admin or a manager, or one the Review
    edition names."""
    import locations as L  # noqa: PLC0415
    import recon as R  # noqa: PLC0415
    if is_master:
        return True
    if not user:
        return False
    sess = L.Session(reads, user)
    if not R.app_open(sess):
        return False
    if R.writer(user) or R.badge_opens(sess):
        return True
    return R.edition_holds(sess, R.EDITION["review"])


async def reader(request: Request, reads_of: Callable[[], Any], feature: str = "", feature_label: str = ""
                 ) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
    """({uid, master, user}, None) when this session may read Time Reconciliation (and `feature`'s page, when one is
    named); else (None, the refusal envelope)."""
    import sched_lanes  # noqa: PLC0415
    from starlette.concurrency import run_in_threadpool  # noqa: PLC0415
    s = await sched_lanes._session(request)
    if s is None:
        return None, {"status": 401, "reason": "session", "message": "sign in first"}
    master = s.is_master is True

    def decide() -> tuple[dict[str, Any] | None, bool]:
        reads = reads_of()
        user = _user_of(reads, str(s.uid))
        return user, may_read(reads, user, master)

    try:
        user, ok = await run_in_threadpool(decide)
    except Exception as exc:  # noqa: BLE001 - a gate that throws stays shut
        return None, {"status": 403, "reason": "unreadable",
                      "message": f"The access check failed ({type(exc).__name__}), so the door stays closed."}
    if not ok:
        return None, {"status": 403, "reason": "badge", "message": READERS_ONLY}
    if feature:
        got = await sched_lanes._app_gate(request, feature, app_label=feature_label or feature)
        if isinstance(got, dict):
            return None, got
    return {"uid": str(s.uid), "master": master, "user": user}, None
