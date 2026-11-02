"""The Employee Database step's write (EmployeeDb.gs empdbStepSweep_), rung by the relay's clock after its look
(employee_db.step_due): each card due is filled as employeeDbFill decides off asa-hub-db — a new person's row appended
to the Master by asa-hub-sheet-sync (book_ops `append`, the formulas of the row above pasted into it), a row a person
has left alone — and the card stamped (internal_docs_at, internal_docs_note) in app.edits."""
from __future__ import annotations

import logging
import time
from typing import Any, Callable

import book_ops as BO
import employee_db as ED
import gsjs
import hiring_hired as HH
import house_tables as HT
import locations as L
import recon as R
import writes as W
from writes import Decision

log = logging.getLogger("asa-hub-app")
s_ = ED.s_
# a sweep stops here and leaves the rest for the next ring (the write decides within WRITE_BUDGET_S)
SWEEP_BUDGET_S = 4.0
# EmployeeDb.gs: the formulas copied from the nearest row above, within this many rows
FORMULAS_FROM_ABOVE = 40
STALE = "The look this sweep was rung with is not this service's, or it is too old — nothing was written."


def note_of(out: dict[str, Any]) -> str:
    """The card's internal_docs_note, in empdbStepSweep_'s words."""
    if out.get("status") != 200:
        return "Not filled — " + s_(out.get("message"))
    data = out.get("data") or {}
    if data.get("touched") is False:
        return "Left alone — " + s_(data.get("message"))
    return "Employee Database filled: " + ("; ".join(data.get("filled") or []) or "nothing was missing")


def step_sweep(sess: L.Session, payload: dict) -> Decision:
    """empdbStepSweep_ on the relay's clock: never moves a card backwards; a card with nothing to fill still stops here
    so the step stays visible."""
    if not HH.service(sess):
        return Decision(dict(HH.SERVICE_ONLY))
    p = payload if isinstance(payload, dict) else {}
    prep = R.unsealed(ED.SWEEP, "service", p.get("prepared"))
    if prep is None:
        return W.refuse(409, STALE)
    reads = sess.reads
    due = {s_(c.get("candidateid")): c for c in ED.due(reads)}
    texts = prep.get("texts") if isinstance(prep.get("texts"), dict) else {}
    started = time.time()
    recs: list[dict] = []
    ops: list[tuple[str, dict]] = []
    said = {"filled": 0, "left_alone": 0, "not_filled": 0, "waiting": 0}
    for cid in prep.get("cids") or []:
        c = due.get(s_(cid))
        if c is None:
            continue
        if time.time() - started > SWEEP_BUDGET_S:
            break
        try:
            out = ED.fill(reads, cid, ED.Texts(reads, texts.get(cid) if isinstance(texts.get(cid), dict) else {}))
        except ED.Unprepared:
            said["waiting"] += 1
            log.info("%s: %s — a paper its look did not read; filled on the next ring", ED.SWEEP, cid)
            continue
        except Exception as exc:  # noqa: BLE001 - said on the card, as the catch around employeeDbFill
            out = {"status": 500, "message": str(exc)[:300] or type(exc).__name__}
        ok = out.get("status") == 200
        if ok and out.get("append"):
            m = ED.master(reads)
            if HT.resource_in(reads, m["sid"], m["tab"]) is not None:
                # the Master kept in Postgres: the new row is a kept record writes.into_tables makes on its table
                recs.append(_kept_append(m, out["append"], cid))
            else:
                ops.append((cid, {"op": "append", "sheet_id": m["sid"], "tab": m["tab"],
                                  "spec": {"cells": out["append"], "formulas_from_above": FORMULAS_FROM_ABOVE}}))
            said["filled"] += 1
        elif ok:
            said["left_alone"] += 1
        else:
            said["not_filled"] += 1
        now = W.now_iso(reads)
        recs += HH.card_facts(reads, cid, {"internal_docs_at": now, "internal_docs_note": note_of(out)}, ED.BY, now)
        name = s_(c.get("candidatename"))
        log.info("%s: internal_docs_step — %s — %s: %s", ED.BY, cid, name,
                 "filled" if ok else "FAILED: " + s_(out.get("message"))[:200])
        if ok and out.get("append"):
            log.info("%s: employee_db_fill — %s — %s: filled %d blank cell(s) [%s] on a new row", ED.BY, cid, name,
                     len(out["data"]["filled"]), ", ".join(f.split(" → ")[0] for f in out["data"]["filled"]))
    for cid, op in ops:
        BO.queue([op], cid, ED.BY, ED.SWEEP)
    kept = [e for e in recs if e and e.get("cells")]
    answer = {"status": 200, "data": said}
    return Decision(answer, edits=kept, subject="") if kept else Decision(answer)


def _kept_append(m: dict[str, Any], cells: dict[str, str], cid: str) -> dict[str, Any]:
    """The new Master row as one kept record, named by the e-mail the fill wrote, else the first and last name, else
    its first cell (the fill never appends for a person a row already names)."""
    idx = ED.column_index(m["hdr"])
    tries = [[m["keys"][idx[label]] for label in labels if label in idx]
             for labels in (("Email",), ("First Name", "Last Name"), ("Employee Name",))]
    for heads in tries + [[h] for h in cells][:1]:
        if heads and all(gsjs.trim(gsjs.or_blank(cells.get(h))) for h in heads):
            return W.kept_record(m["sid"], m["tab"], "append", W.COLS + W.COLS_SEP.join(heads),
                                 "\x1f".join(gsjs.trim(cells[h]) for h in heads), cid, cells)
    raise ValueError("a Master row with no cell to name it by")


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {ED.SWEEP: step_sweep}
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
BUSY_OF: dict[str, dict[str, Any]] = {a: {"status": 409, "message": W.BUSY} for a in ACTIONS}
