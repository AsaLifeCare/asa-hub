"""The letters' sweep (app/letters.py) for the relay's clock: its first pass fixes the moment from which the letters are
Python's; every pass raises each letter owed since then through Smart Comms — one the quiet window holds waits in the
outbox for the morning — keeps it told by its key, and takes back an owed one whose answer or file stopped being what
it says (hubLetterQuietCarry_'s reading again, done before the morning)."""
from __future__ import annotations

import time
from datetime import datetime, timezone
from typing import Any, Callable

import gsjs
import letters as LT
import locations as L
import resource_rows as RR
import smart_comms as SC
import writes as W
from writes import Decision

# inside the write's own budget, with room left for the reads
BUDGET_S = 5.0

s_ = gsjs.str_


def _cur() -> Any:
    return RR._cur()


def _told(letter: dict[str, Any], state: str, why: str) -> None:
    _cur().execute(f"insert into {LT.TOLD} (key, lane, ref, situation, state, why) values (%s, %s, %s, %s, %s, %s)"
                   " on conflict (key) do update set state = excluded.state, why = excluded.why, told_at = now()",
                   (letter["key"], letter["lane"], letter["ref"], letter["situation"], state, why[:400]))


def sweep(sess: L.Session, payload: dict) -> Decision:
    """lettersSweep: the relay's own write, once the Apps Script build that no longer writes these letters serves."""
    started = time.monotonic()
    if (sess.user or {}).get("is_service") is not True:
        return W.refuse(403, "The letters' sweep is the relay's alone.")
    reads = sess.reads
    p = payload if isinstance(payload, dict) else {}
    out: dict[str, Any] = {"told": 0, "none": 0, "failed": 0, "withdrawn": 0, "left": 0, "started": False}
    since = LT.since_ms(reads)
    if since is None:
        # GAS's own first pass: where the history ends; nothing filed before it is told
        given = SC._number(p.get("since"))
        at = given if given and given > 0 else time.time()
        _cur().execute(f"insert into {LT.STATE} (id, since, build) values (1, to_timestamp(%s), %s)"
                       " on conflict (id) do nothing", (at, s_(p.get("build"))))
        since, out["started"] = at * 1000.0, True
    out["since"] = gsjs.iso(datetime.fromtimestamp(since / 1000.0, tz=timezone.utc))
    tx = (SC._WRITE.get() or {}).get("tx")
    for key, lane, ref in LT.owed(reads):
        why = LT.still(reads, lane, ref) if lane != LT.CALLOFF else ""
        if why and tx is not None:
            SC.cancel_owed(tx, key, why)
            _cur().execute(f"update {LT.TOLD} set state = 'withdrawn', why = %s where key = %s", (why[:400], key))
            out["withdrawn"] += 1
    stopped = set()
    waiting = LT.due(reads, since, LT.told_keys(reads))
    for letter in waiting:
        if time.monotonic() - started > BUDGET_S or letter["lane"] in stopped:
            out["left"] += 1
            continue
        if letter.get("none"):
            _told(letter, "none", letter["none"])
            out["none"] += 1
            continue
        got = SC.raise_situation(None, situation=letter["situation"], to=letter["to"], vars={}, key=letter["key"],
                                 lane="smart comms", at_ms=int(time.time() * 1000), prune=False, channel="email",
                                 body=letter["body"], subject=letter["subject"])
        state = s_(got.get("state"))
        if state == "failed":
            # asked again on the next pass; a call-off stays in its order (the cursor waits on it)
            out["failed"] += 1
            if letter["lane"] == LT.CALLOFF:
                stopped.add(LT.CALLOFF)
            continue
        _told(letter, state + (":" + s_(got.get("held")) if s_(got.get("held")) else ""), s_(got.get("why")))
        out["told"] += 1
    return Decision({"status": 200, "data": out}, subject="", own=True)


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {"lettersSweep": sweep}
POLICY: dict[str, dict[str, Any]] = {"lettersSweep": {}}
BUSY_OF: dict[str, dict[str, Any]] = {"lettersSweep": {"status": 409, "message": "Another write holds the lock."}}


class Store(W.Store):
    """app.letters_writes and app.letters_receipts, beside the other apps' own."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="letters", label="Letters")
