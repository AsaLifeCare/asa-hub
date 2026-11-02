"""The hiring team's alerts' sweep (app/team_alerts.py) for the relay's clock: its first pass fixes the moment from which
the alerts are Python's; every pass raises each alert owed since then to the team list through Smart Comms, keeps it
told by its key, and takes back what the outbox still owes for a card that moved on before the morning."""
from __future__ import annotations

import time
from datetime import datetime, timezone
from typing import Any, Callable

import gsjs
import locations as L
import resource_rows as RR
import smart_comms as SC
import team_alerts as TA
import writes as W
from writes import Decision

# inside the write's own budget, with room left for the reads
BUDGET_S = 5.0

s_ = gsjs.str_


def _told(alert: dict[str, Any], state: str, why: str) -> None:
    RR._cur().execute(f"insert into {TA.TOLD} (key, kind, ref, state, why) values (%s, %s, %s, %s, %s) on conflict (key)"
                      " do update set state = excluded.state, why = excluded.why, told_at = now()",
                      (alert["key"], alert["kind"], alert["ref"], state, why[:400]))


def sweep(sess: L.Session, payload: dict) -> Decision:
    """teamAlertsSweep: the relay's own write, once the Apps Script build that no longer raises these alerts serves."""
    started = time.monotonic()
    if (sess.user or {}).get("is_service") is not True:
        return W.refuse(403, "The team alerts' sweep is the relay's alone.")
    reads = sess.reads
    p = payload if isinstance(payload, dict) else {}
    out: dict[str, Any] = {"told": 0, "off": 0, "failed": 0, "waiting": 0, "withdrawn": 0, "left": 0,
                           "started": False}
    since = TA.since_ms(reads)
    if since is None:
        given = SC._number(p.get("since"))
        at = given if given and given > 0 else time.time()
        RR._cur().execute(f"insert into {TA.STATE} (id, since, build) values (1, to_timestamp(%s), %s)"
                          " on conflict (id) do nothing", (at, s_(p.get("build"))))
        since, out["started"] = at * 1000.0, True
    out["since"] = gsjs.iso(datetime.fromtimestamp(since / 1000.0, tz=timezone.utc))
    tx = (SC._WRITE.get() or {}).get("tx")
    for key, kind, ref in TA.owed(reads):
        why = TA.still(reads, kind, ref)
        if why and tx is not None:
            SC.cancel_owed(tx, key + "|", why)
            RR._cur().execute(f"update {TA.TOLD} set state = 'withdrawn', why = %s where key = %s", (why[:400], key))
            out["withdrawn"] += 1
    for alert in TA.due(reads, since, TA.told_keys(reads)):
        if time.monotonic() - started > BUDGET_S:
            out["left"] += 1
            continue
        if alert.get("wait"):
            # what the alert would say cannot be read yet: not told, so the next pass asks again
            out["waiting"] += 1
            continue
        if alert.get("off"):
            _told(alert, "off", alert["off"])
            out["off"] += 1
            continue
        got = TA.tell_team(reads, alert)
        if got["state"] == "failed":
            out["failed"] += 1
            continue
        _told(alert, got["state"], s_(got.get("why")))
        out["told"] += 1
    return Decision({"status": 200, "data": out}, subject="", own=True)


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {"teamAlertsSweep": sweep}
POLICY: dict[str, dict[str, Any]] = {"teamAlertsSweep": {}}
BUSY_OF: dict[str, dict[str, Any]] = {"teamAlertsSweep": {"status": 409, "message": "Another write holds the lock."}}


class Store(W.Store):
    """app.team_alerts_writes and app.team_alerts_receipts, beside the other apps' own."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="team_alerts", label="Team alerts")
