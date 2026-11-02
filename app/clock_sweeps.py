"""The throttles of the hiring sweep's clock riders (CommCallOffForm.gs calloff_form_ran, DuplicateScan.gs
dup_scan_ran, LaneMirror.gs lane_mirror_ran — Apps Script's script cache) for the Python passes that took them
(app/lane_mirror*.py, app/dup_scan*.py, app/call_off_form_sweep*.py): each key held in app.clock_sweeps_state
(db/clock_sweeps.sql) until it expires, set inside the pass's own write, and put back as it stood when the relay voids
that write."""
from __future__ import annotations

from typing import Any, Callable

import locations as L
import resource_rows as RR
import smart_comms as SC
import writes as W

STATE = "app.clock_sweeps_state"
DENIED = {"status": 403, "message": "This is the relay's own door."}


def held(reads: L.Reads, key: str) -> bool:
    """cache.get(key): the key is set and has not expired."""
    got = RR._q(reads, f"select expires_at is not null and expires_at > now() from {STATE} where key = %s", (key,))
    return bool(got and got[0][0])


def hold(key: str, ttl_s: int) -> None:
    """cache.put(key, '1', ttl_s), inside the write being decided; what it replaced is kept for a void."""
    RR._cur().execute(
        f"insert into {STATE} as s (key, value, expires_at, prev, prev_expires_at, write_id) values (%s, '1',"
        " now() + make_interval(secs => %s::integer), '', null, %s)"
        " on conflict (key) do update set prev = s.value, prev_expires_at = s.expires_at, value = excluded.value,"
        " expires_at = excluded.expires_at, write_id = excluded.write_id, updated_at = now()",
        (key, ttl_s, SC.write_id()))


def service(sess: L.Session) -> bool:
    return (sess.user or {}).get("is_service") is True


class Store(RR.Store):
    """A clock rider's write store: a void takes its kept edits and messages back, and its throttle as it stood."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None, kind: str = "clock_sweeps",
                 label: str = "The clock riders") -> None:
        super().__init__(dsn, connect, kind=kind, label=label)

    def settle(self, write_id: str, state: str, why: str = "", fields: list[str] | None = None) -> bool:
        done = super().settle(write_id, state, why, fields)
        if state == "void" and done:
            try:
                with self.conn().transaction():
                    self.conn().execute(f"update {STATE} set value = prev, expires_at = prev_expires_at,"
                                        " write_id = '', updated_at = now() where write_id = %s", (write_id,))
            except Exception as exc:  # noqa: BLE001 - said, never raised into the relay's settle
                W.log.warning("clock sweeps: the void of %s left the throttle (%s)", write_id[:40],
                              type(exc).__name__)
        return done
