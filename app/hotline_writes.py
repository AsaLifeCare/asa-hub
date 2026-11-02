"""The Employee Support Hotline's writes, kept in the Hub's own tables (db/hotline.sql): a call the relay's Quo webhook
handed over, kept once (hotlineCallKeep), and Python's own reading of it beside Apps Script's filing
(hotlineShadowKeep), and the call filed from the model's answer (hotlineFile, app/hotline_file.py). The relay's own
identity alone writes here."""
from __future__ import annotations

import json
import re
from typing import Any, Callable

import gsjs
import hotline as H
import hotline_file
import house_tables as HT
import locations as L
import resource_rows as RR
import writes as W
from writes import HELD, Decision

APP_ID = "hotline"
CALLS = "app.hotline_calls"
CALL_ID = re.compile(r"AC[0-9A-Za-z]{32}")
DENIED = {"status": 403, "message": "The hotline's calls are kept by the relay alone."}


def _service(sess: L.Session) -> bool:
    return (sess.user or {}).get("is_service") is True


def _cur() -> Any:
    cur = HELD.get()
    if cur is None:
        raise W.NotKept("a call is kept only under the platform's write lock")
    return cur


def _phones(v: Any) -> list[str]:
    items = v if isinstance(v, list) else str(v or "").split(",")
    return [s for s in (gsjs.trim(gsjs.or_text(x)) for x in items) if s][:20]


def call_keep(sess: L.Session, payload: dict) -> Decision:
    """hotlineCallKeep: one call, its id, times, parties and turns, kept once; a second hand-over keeps nothing."""
    if not _service(sess):
        return Decision(DENIED)
    p = payload if isinstance(payload, dict) else {}
    call_id = gsjs.trim(gsjs.or_text(p.get("call_id")))
    turns = [t for t in (p.get("dialogue") if isinstance(p.get("dialogue"), list) else []) if isinstance(t, dict)]
    if not CALL_ID.fullmatch(call_id) or not turns:
        return W.refuse(400, "A call needs an AC call id and at least one turn.")
    duration = p.get("duration")
    duration = duration if isinstance(duration, (int, float)) and not isinstance(duration, bool) else None
    cur = _cur()
    cur.execute(f"insert into {CALLS} (call_id, event_at, created, duration, caller_phones, team, dialogue)"
                " values (%s, %s, %s, %s, %s, %s, %s::jsonb) on conflict (call_id) do nothing",
                (call_id, gsjs.or_text(p.get("event_at"))[:40], gsjs.or_text(p.get("created"))[:40], duration,
                 _phones(p.get("caller_phones")), _phones(p.get("team")), json.dumps(turns)))
    kept = cur.rowcount == 1
    return Decision({"status": 200, "data": {"call_id": call_id, "kept": "new" if kept else "already"}},
                    subject=call_id, own=True)


def shadow_keep(sess: L.Session, payload: dict) -> Decision:
    """hotlineShadowKeep: Python's reading of a kept call — its items and the rows it would file — beside it."""
    if not _service(sess):
        return Decision(DENIED)
    p = payload if isinstance(payload, dict) else {}
    call_id = gsjs.trim(gsjs.or_text(p.get("call_id")))
    shadow = p.get("shadow") if isinstance(p.get("shadow"), dict) else None
    if not CALL_ID.fullmatch(call_id) or shadow is None:
        return W.refuse(400, "A reading needs the call's id and what was read.")
    cur = _cur()
    cur.execute(f"update {CALLS} set shadow = %s::jsonb, shadow_at = now() where call_id = %s",
                (json.dumps(shadow), call_id))
    if cur.rowcount != 1:
        return W.refuse(404, f"No call {call_id} is kept.")
    return Decision({"status": 200, "data": {"call_id": call_id}}, subject=call_id, own=True)


CONFIG_KEYS = ("enabled", "team_phone", "prompt", "max_per_sweep", "max_age_days")


def config_set(sess: L.Session, payload: dict) -> Decision:
    """hotlineConfigSet: each allowed key the payload names written over its row of hotline_config, a key not there
    appended; the save is the apply, the next pass reads it."""
    user = sess.user or {}
    if user.get("is_service") or gsjs.js_str(user.get("role")) != "admin":
        return Decision(H.HUB_DENIED)
    p = payload if isinstance(payload, dict) else {}
    reads = sess.reads
    W.gate(reads)
    if HT.tabled(H.CONFIG_TAB):
        subject, wrote = W.who(user), []
        for k in CONFIG_KEYS:
            if p.get(k) is not None:
                HT.put(reads, H.CONFIG_TAB, "key", k, {"key": k, "value": gsjs.js_str(p[k])}, subject)
                wrote.append(k)
        return Decision({"status": 200, "data": {"applied": wrote}}, subject=subject, own=True)
    res = W.tab_of(reads, H.CONFIG_TAB)
    sid, tab = W.where_of(res)
    have: dict[str, str] = {}
    if res.ref is not None:
        for r in reads.db.normalized_rows(res.ref):
            k = gsjs.trim(gsjs.or_text(r.get("key")))
            if k and k not in have:
                have[k] = gsjs.or_text(r.get("value"))
    subject = W.who(user)
    edits, wrote = [], []
    for k in CONFIG_KEYS:
        if p.get(k) is None:
            continue
        v = gsjs.js_str(p[k])
        if k in have:
            edits.append(W.kept_record(sid, tab, "edit", W.COLS + "key", k, subject, {"value": v},
                                       before={"value": have[k]}))
        else:
            edits.append(W.kept_record(sid, tab, "append", W.COLS + "key", k, subject, {"key": k, "value": v}))
        wrote.append(k)
    return W.final({"status": 200, "data": {"applied": wrote}}, edits, subject)


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {"hotlineCallKeep": call_keep,
                                                              "hotlineShadowKeep": shadow_keep,
                                                              "hotlineFile": hotline_file.file,
                                                              "hotlineConfigSet": config_set}
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
POLICY["hotlineConfigSet"] = {"roles": ["admin"]}
# what a door answers when the platform's lock is held (main.py lays the generic rows doors' own beside these)
BUSY_OF: dict[str, dict[str, Any]] = {a: {"status": 409, "message": W.BUSY} for a in ACTIONS}


class Store(RR.Store):
    """app.hotline_writes and app.hotline_receipts, beside the other apps' own."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="hotline", label="Hotline")
