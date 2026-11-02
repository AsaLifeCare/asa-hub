"""The audited Staff reads' lines (HR Admin, Performance): who opened whose record, as Apps Script's hubSysLog_ wrote
them to the logs book, kept in asa-hub-db's own table and read back beside the events trail."""
from __future__ import annotations

import logging
import threading
from typing import Any, Callable

import envelope as EV
import gsjs

log = logging.getLogger("asa-hub-app")

TABLE = "app.staff_views"
SHOWN = 60
_BOUND: dict[str, Any] = {}
_MADE = threading.Event()
# the lines' other keepers (main.py: the platform's action log, app/sys_log.py), each told every line kept here
TAPS: list[Callable[[dict, str, str, int], None]] = []


def ddl() -> tuple[str, ...]:
    return (
        f"create table if not exists {TABLE} (id bigserial primary key, at timestamptz not null default now(),"
        " actor text not null default '', actor_name text not null default '', action text not null,"
        " target text not null default '', ok boolean not null default true, area text not null default 'Other',"
        " outcome text not null default 'ok', summary text not null default '', tenant text not null default '')",
        f"create index if not exists staff_views_target on {TABLE} (target, action, id)",
    )


def bind(store: Any) -> None:
    """The write store whose connection keeps the lines (main.py's Staff store)."""
    _BOUND["store"] = store


def _conn() -> Any:
    store = _BOUND.get("store")
    if store is None or not store.available:
        return None
    c = store.conn()
    if not _MADE.is_set():
        for stmt in ddl():
            c.execute(stmt)
        _MADE.set()
    return c


def record(user: dict | None, action: str, target: str, status: int = 200) -> None:
    """hubSysLog_ for an audited read that answered: never for a service, nor for a session the relay says leaves no
    line; a line that cannot be kept never fails the read. `status` is the answer the line was written with (its
    env.status), ok unless the door says otherwise; every tap is told the line too."""
    u = user or {}
    if u.get("is_service") or u.get("unlogged"):
        return
    for tap in TAPS:
        try:
            tap(u, action, target, status)
        except Exception as exc:  # noqa: BLE001 - a tap never breaks the read
            log.warning("%s %s: a tap did not take the line (%s)", action, target, type(exc).__name__)
    # during a visit the account at the keyboard, "caller (visiting X)", as hubSysLog_ names it (envelope.log_actor)
    actor = EV.log_actor(u)
    who = (gsjs.str_(u.get("display_name")) if actor == gsjs.str_(u.get("email")) else actor) or actor or "Someone"
    ok = status < 400
    outcome = "ok" if ok else ("denied" if status in (401, 403) else "failed")
    try:
        c = _conn()
        if c is None:
            log.warning("%s %s: no write store, the view's line was not kept", action, target)
            return
        c.execute(f"insert into {TABLE} (actor, actor_name, action, target, summary, ok, outcome)"
                  " values (%s, %s, %s, %s, %s, %s, %s)",
                  (actor, who, action, target, f"{who} {action} {target}".strip(), ok, outcome))
    except Exception as exc:  # noqa: BLE001 - logging never breaks the read
        log.warning("%s %s: the view's line was not kept (%s)", action, target, type(exc).__name__)


def rows_for(target: str, action: str) -> list[dict[str, Any]]:
    """The newest lines of one action on one record, shaped as the events trail's rows: type, actor, at."""
    c = _conn()
    if c is None:
        return []
    got = c.execute(f"select action, actor, to_char(at at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')"
                    f" from {TABLE} where target = %s and action = %s order by id desc limit %s",
                    (target, action, SHOWN)).fetchall()
    return [{"type": r[0], "actor": r[1], "at": r[2], "payload": {}} for r in got]
