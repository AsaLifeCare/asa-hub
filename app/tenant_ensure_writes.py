"""A place's own workbook, its pointer (Tenant.gs tenantEnsure): the workbook tenantEnsurePrepare made is pointed at
from the place's row on HQ's tenants tab, the row read again under the platform's write lock so the loser of a race
finds the winner's id — kept in app.edits, where every Python reader of the pointer reads it. While the tab has no
spreadsheet_id column, a `mirror` book op writes the whole tab with it (ensureHeader_) and the sync carries it whole.
A workbook the write does not keep — the loser's, a refusal's, one the lock held out — goes to Drive's bin."""
from __future__ import annotations

from typing import Any, Callable

import book_ops as BO
import gsjs
import hubdb
import locations as L
import staff_views
import studio as ST
import tenant_ensure as TE
import writes as W
from writes import Decision

# Tenant.gs's own words for its lock
BUSY = "Another change is in progress — try again in a few seconds."
NO_TAB = {"status": 500, "message": "The tenants tab is missing."}
# the cells that name a place's row when its id does not, in turn
KEY_SETS = (("tenant_id",), ("tenant_id", "created_at"), ("tenant_id", "name", "created_at"))

s_ = gsjs.str_
norm = hubdb.norm_key


def _raw(ref: hubdb.TabRef, raw: dict) -> dict[str, str]:
    """A row's cells as the copy keeps their text: what an edit names as the sheet's value before it."""
    return {h: gsjs.trim(gsjs.or_blank(hubdb.typed(raw.get(h), "raw"))) for h in ref.headers if h}


def mirror(sid: str, ref: hubdb.TabRef, copy: list[tuple[int, dict]], at: int, made: str) -> dict[str, Any]:
    """ensureHeader_ as one `mirror` op: the whole tenants tab as Python holds it, spreadsheet_id after its own
    columns, the place's pointer in it."""
    heads = list(ref.headers)
    header = [hubdb.twin_base(gsjs.js_str(h)) for h in heads] + [TE.POINTER]
    by: dict[int, list[str]] = {}
    last = 1
    for i, (rn, raw) in enumerate(copy):
        line = [W.sheet_text(hubdb.typed(raw.get(h), "raw")) for h in heads] + [made if i == at else ""]
        by[rn] = line
        if rn > last and any(v != "" for v in line):
            last = rn
    rows = [by.get(rn) or [""] * len(header) for rn in range(2, last + 1)]
    return {"op": "mirror", "sheet_id": sid, "tab": ref.tab,
            "spec": {"resource": ST.TENANTS_TAB, "header": header, "rows": rows}}


def ensure(sess: L.Session, payload: dict) -> Decision:
    """tenantEnsure: idempotent, and never answers with the id itself — {tenant_id, created}."""
    refused, ctx = TE.gate(sess)
    if refused:
        return Decision(refused)
    user = ctx["actor"]
    p = payload if isinstance(payload, dict) else {}
    prep = p.get("prepared") if isinstance(p.get("prepared"), dict) else {}
    reads = sess.reads
    made = s_(prep.get("spreadsheet_id"))

    refused, row, tid = TE.place(reads, ctx["here"], p)
    pointer = s_((row or {}).get("spreadsheetid"))

    def dropped(answer: dict[str, Any]) -> Decision:
        if made != pointer:
            TE.discard(reads, made)
        return Decision(answer)

    if refused:
        return dropped(refused)
    # re-read under the lock, past the memo: the loser of a race finds the winner's id
    if pointer or prep.get("already"):
        return dropped({"status": 200, "data": {"tenant_id": tid, "created": False}})
    if not made:
        return Decision(dict(TE.NOT_MADE))
    sid, ref = TE.tenants_ref(reads)
    if ref is None:
        return dropped(dict(NO_TAB))
    id_head, sid_head = W.header_of(ref, "tenantid", norm=True), TE.pointer_head(ref)
    if id_head is None:
        return dropped(dict(TE.NOT_FOUND))
    copy = reads.db.rows(ref)
    at = next((i for i, (_rn, raw) in enumerate(copy) if _raw(ref, raw).get(id_head) == tid), None)
    if at is None:
        return dropped(dict(TE.NOT_FOUND))
    ops = []
    if sid_head is None:
        ops.append(mirror(sid, ref, copy, at, made))
        sid_head = TE.POINTER
    sets = [[W.header_of(ref, norm(h), norm=True) for h in s] for s in KEY_SETS]
    named = W.row_key_of(copy, at, [s for s in sets if all(h is not None for h in s)])
    before = {sid_head: _raw(ref, copy[at][1]).get(sid_head, "")}
    if named is None:
        # rows identical cell for cell: laid on the first here, written on the sheet's first (the .gs writes the first)
        named = (W.COLS + id_head, tid)
        if not ops:
            ops.append({"op": "cells", "sheet_id": sid, "tab": ref.tab,
                        "spec": {"match": id_head, "key": tid, "cells": {sid_head: made}, "which": "first"}})
    edit = W.kept_record(sid, ref.tab, "edit", named[0], named[1], tid, {sid_head: made}, before=before)
    BO.queue(ops, "tenants:" + tid, W.who(user), TE.ACTION)
    staff_views.record(user, TE.ACTION, tid)
    return W.final({"status": 200, "data": {"tenant_id": tid, "created": True}}, [edit], tid)


def undo(reads: L.Reads, payload: dict) -> None:
    """What the prepare made, put back when this write was not kept: the loser of the lock (409), a write rolled back,
    a replay whose workbook is the first one's."""
    prep = (payload or {}).get("prepared")
    made = s_(prep.get("spreadsheet_id")) if isinstance(prep, dict) else ""
    if not made:
        return
    try:
        _sid, ref = TE.tenants_ref(reads)
        rows = reads.db.normalized_rows(ref)
    except Exception:  # noqa: BLE001 - a pointer that cannot be read is never guessed away: the workbook stays
        return
    # a retry of a write that kept it answers from its receipt: the pointer names this very workbook
    if any(s_(r.get("spreadsheetid")) == made for r in rows):
        return
    TE.discard(reads, made)


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {TE.ACTION: ensure}
# main.policy_gate asks nothing: the door settles the place first and asks its declared role then (members.stand)
POLICY: dict[str, dict[str, Any]] = {TE.ACTION: {}}
BUSY_OF: dict[str, dict[str, Any]] = {TE.ACTION: {"status": 409, "message": BUSY}}
# main._run_write: each door's prepared work undone when its write was not kept
UNKEPT: dict[str, Callable[[L.Reads, dict], None]] = {TE.ACTION: undo}


class Store(W.Store):
    """app.tenant_ensure_writes and app.tenant_ensure_receipts, beside the other apps' own; the pointer app.edits'."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="tenant_ensure", label="A place's workbook")
