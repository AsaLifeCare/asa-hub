"""The comm-bindings book's seeding carried (comm_bindings plans each binding): under the platform's write lock, the tab
read again (somebody may have filled a binding meanwhile), then each binding kept in app.edits as
commBindingsSeedMaybe_ wrote it — the shipped id into a blank Situation ID, or a row appended with its fallback; a pass
stops in time and hands what is left back to the relay for the next one."""
from __future__ import annotations

import time
from typing import Any, Callable

import comm_bindings as CB
import gsjs
import locations as L
import resource_rows as RR
import writes as W
from writes import Decision

PASS_S = 4.0
BUSY = "Another write holds the platform's lock; the clock rings again."


def seed(sess: L.Session, payload: dict) -> Decision:
    """commBindingsSeed: the plans commBindingsSeedDue made, each a binding COMM_BINDINGS_DEFAULTS names, written in
    with its shipped id unless the tab holds one for it now; a row no key tells apart is left as it is."""
    if (sess.user or {}).get("is_service") is not True:
        return Decision(dict(CB.DENIED))
    plans = [p for p in ((payload or {}).get("plans") or []) if isinstance(p, dict)]
    got = CB.read_tab(sess.reads)
    out: dict[str, Any] = {"filled": 0, "appended": 0, "skipped": 0, "untold": [], "left": []}
    if "have" not in got:
        return Decision({"status": 200, "data": {**out, **got}})
    ref, rows, have = got["ref"], got["rows"], got["have"]
    # the book the bindings live in (a house kept in its own table names none of its own)
    sid, tab = ref.sheet_id or gsjs.trim(sess.reads.db.prop(CB.BOOK_PROP)), ref.tab
    key_h, val_h = gsjs.trim(gsjs.js_str(got["key"])), gsjs.trim(gsjs.js_str(got["val"]))
    fb_h = gsjs.trim(gsjs.js_str(got["fb"])) if got["fb"] is not None else None
    match_sets = [[got["key"]], [got["key"], got["fb"]], list(ref.headers)]
    edits: list[dict] = []
    seen: set[str] = set()
    started = time.time()
    for i, plan in enumerate(plans):
        if time.time() - started > PASS_S:
            out["left"] = plans[i:]
            break
        key = gsjs.trim(gsjs.or_text(plan.get("key")))
        value = CB.default_of(key)
        if value is None or key in seen:
            continue
        seen.add(key)
        h = have.get(key)
        if h is not None and h[1]:
            out["skipped"] += 1
            continue
        if h is not None:
            named = W.row_key_of(rows, h[0], [[x for x in s if x is not None] for s in match_sets])
            if named is None:
                out["untold"].append(key)
                continue
            edits.append(W.kept_record(sid, tab, "edit", named[0], named[1], "", {val_h: value},
                                       before={val_h: rows[h[0]][1].get(got["val"])}))
            out["filled"] += 1
            continue
        cells = {key_h: key, val_h: value}
        if fb_h is not None:
            cells[fb_h] = value
        edits.append(W.kept_record(sid, tab, "append", W.COLS + key_h, key, "", cells))
        out["appended"] += 1
    return W.final({"status": 200, "data": out}, edits, "")


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {"commBindingsSeed": seed}
POLICY: dict[str, dict[str, Any]] = {"commBindingsSeed": {}}
BUSY_OF: dict[str, dict[str, Any]] = {"commBindingsSeed": {"status": 409, "message": BUSY}}


class Store(RR.Store):
    """app.comm_bindings_writes and _receipts; the bindings themselves app.edits'."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="comm_bindings", label="the comm-bindings book")
