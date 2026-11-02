"""Time Off's writes in Postgres (time_off_rows): the relay's time off rules (server/time_off.py) decide a request
filed, decided, withdrawn, cancelled or reviewed and a setting saved, and keep the row here through timeOffKeep — an
append refused for an id or a source row already in, an update a compare-and-set on its updatedAt, each reason kept as
the request filed it. timeOffUpload brings in the house's rows as the relay read them live, reasons and all."""
from __future__ import annotations

from typing import Any, Callable

import locations as L
import resource_rows as RR
import time_off_rows as TO
from writes import Decision

BUSY = "Another update is in progress — try again."
BY = "time off"


def _text(v: Any) -> str:
    return "" if v is None else str(v)


def _clean(row: dict) -> dict[str, str]:
    return {str(k): _text(v) for k, v in row.items() if not str(k).startswith("_")}


def _service(sess: L.Session) -> bool:
    return (sess.user or {}).get("is_service") is True


def _refused(code: str, why: str) -> Decision:
    return Decision({"status": 409, "reason": code, "message": why}, subject="", own=True)


def keep(sess: L.Session, payload: dict) -> Decision:
    """The relay's rows kept: `append` (rows) or `update` (a row, `expected` the updatedAt it was read at)."""
    if not _service(sess):
        return Decision({"status": 403, "message": "Time off is kept by the relay alone."})
    reads, payload = sess.reads, payload or {}
    tab = _text(payload.get("tab"))
    if tab not in TO.RESOURCE_OF:
        return Decision({"status": 400, "message": "tab: time_off or settings."})
    if not all(RR.uploaded(reads.db, r) for r in (TO.RECORDS, TO.SETTINGS)):
        return _refused("not_kept", "time off is not held in Postgres")
    resource, key = TO.RESOURCE_OF[tab], TO.ID_COL[tab]
    by = _text(payload.get("by")).strip()[:120] or BY
    live = RR.table_rows(reads, resource)
    if isinstance(payload.get("append"), list):
        new = [_clean(r) for r in payload["append"] if isinstance(r, dict)]
        if not new:
            return Decision({"status": 400, "message": "append: the rows to keep."})
        ids = {_text(c.get(key)).strip().upper() for _k, c in live}
        sources = {_text(c.get("source_key")).strip() for _k, c in live} - {""}
        for r in new:
            rid, sk = r.get(key, "").strip(), r.get("source_key", "").strip()
            if not rid or rid.upper() in ids:
                return _refused("duplicate", f"{rid or 'a row with no id'} is already in the house — nothing was written")
            if sk and sk in sources:
                return _refused("duplicate", f"the source row {sk} is already in the house — nothing was written")
            ids.add(rid.upper())
            if sk:
                sources.add(sk)
        RR.create_many(reads, resource, new, by)
        first = len(live) + 2
        return Decision({"status": 200, "data": {"row_numbers": [first + i for i in range(len(new))]}},
                        subject="", own=True)
    if not isinstance(payload.get("update"), dict):
        return Decision({"status": 400, "message": "append or update."})
    out = _clean(payload["update"])
    rid = out.get(key, "").strip()
    at = next((n for n, (_k, c) in enumerate(live, start=2)
               if rid and _text(c.get(key)).strip().upper() == rid.upper()), 0)
    if not at:
        return _refused("missing", f"{rid} is not in the house any more — nothing was written; reload")
    row_key, before = live[at - 2]
    if _text(before.get("updatedAt")) != _text(payload.get("expected")):
        return _refused("changed", "the row changed in the house since it was read — nothing was written; reload")
    if tab == TO.TAB:
        # the reason travels withheld: the one the request was filed with stays
        out.pop(TO.REASON_COL, None)
    changed = {h: v for h, v in out.items() if _text(before.get(h)) != v}
    if changed:
        RR.update(reads, resource, row_key, before, changed, by)
    return Decision({"status": 200, "data": {"row_number": at}}, subject="", own=True)


_RELEASE = RR.upload_door({TO.RECORDS: {"tab": TO.TAB}, TO.SETTINGS: {"tab": TO.SETTINGS_TAB}})


def upload(sess: L.Session, payload: dict) -> Decision:
    """The relay's upload as Time Off is given to Python — both tabs as it read them live off the house, header first,
    reasons and all — or the release back to the house."""
    payload = payload or {}
    if not _service(sess) or payload.get("release") is True:
        return _RELEASE(sess, payload)
    tabs, sid = payload.get("tabs"), _text(payload.get("sheet_id")).strip()
    if not sid or not isinstance(tabs, dict) or any(not isinstance(tabs.get(t), list) or not tabs[t]
                                                    or not isinstance(tabs[t][0], list) for t in TO.RESOURCE_OF):
        return Decision({"status": 400, "message": "The relay hands both tabs of the house, header first."})
    done = {}
    for tab, resource in TO.RESOURCE_OF.items():
        heads = [_text(h).strip() for h in tabs[tab][0]]
        if TO.ID_COL[tab] not in heads:
            return Decision({"status": 400, "message": f"The {tab} tab has no {TO.ID_COL[tab]} column."})
        rows = [(n, {h: _text(v) for h, v in zip(heads, r) if h})
                for n, r in enumerate(tabs[tab][1:], start=2) if isinstance(r, list)]
        rows = [(n, c) for n, c in rows if c.get(TO.ID_COL[tab], "").strip()]
        done[resource] = RR.upload_rows(resource, sid, tab, [h for h in heads if h], rows)
    return Decision({"status": 200, "data": done}, subject="", own=True)


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {"timeOffKeep": keep, "timeOffUpload": upload}
POLICY: dict[str, dict[str, Any]] = {"timeOffKeep": {}, "timeOffUpload": {}}
BUSY_OF: dict[str, dict[str, Any]] = {a: {"status": 409, "message": BUSY} for a in ACTIONS}


class Store(RR.Store):
    """app.time_off_writes and _receipts; the records and the settings app.resource_rows'."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="time_off", label="Time Off")
