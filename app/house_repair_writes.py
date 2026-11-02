"""House Repair's writes (the generic create, update and delete on `workOrders`, Main.gs route → Estate.gs estateRoute_)
decided off asa-hub-db and kept in app.edits under the write lock — the bridge the estate's forms and every reader of
the Repairs book share; nothing is asked of Google here, and nothing is handed to Apps Script. A request filed is
appended after the sheet's last row (estateFileGate_ for a non-writer: the form's columns alone, a client's at their own
street); a request edited or cancelled (its status Cancelled, the soft delete) is kept on the row its r<row> id names,
counted as the sheet counts it once every request filed here is on it. A kept row is named by cells: its time and
street, as the house's own repair edits name it, else wider sets of its cells — first the cells no write changes, then
the cells it held before; rows identical cell for cell take the cells on the sheet's first of them (a `cells` book op).
Estate.gs makes no tab and no column, so no tab is rewritten here: the estate's forms append to it meanwhile. A blank
row and a removal the sheet cannot mark are refused 409; what the copy cannot answer (a cell it withholds, a book changed
since) is a 503 to try again. Nobody is told anything: estateRoute_ raises no message for a repair."""
from __future__ import annotations

from typing import Any, Callable

import book_ops as BO
import call_offs as CO
import client_care_records as CCR
import client_writes as CW
import gsjs
import hubdb
import house_repair as HR
import locations as L
import my_family as MF
import staff_views
import writes as W
from scope import Defer
from writes import Decision

RESOURCE = HR.RESOURCE
# ESTATE_FILE_ROLES and ESTATE_FILE_COLUMNS: who files without being a writer, and the form's columns they keep
FILE_ROLES = ("admin", "manager", "staff", "client")
FILE_COLUMNS = W.FILE_COLUMNS[RESOURCE]
# ESTATE_WITNESS and ESTATE_STATUS_COL
WITNESS = "select_address_vehicle"
STATUS = "status"
CANCELLED = "Cancelled"
DENIED = {"status": 403, "message": "Requires an admin or manager account"}
SHEET_BUSY = {"status": 503, "message": "The sheet is busy — try again in a moment."}
# the cells a row is named by, narrowest first: its time and street (the house's own repair edits name it so), then
# wider sets of the form's cells; every column after them
KEY_SETS = (W.REPAIR_KEYS, W.REPAIR_KEYS + ("please_describe_the_issue",),
            W.REPAIR_KEYS + ("repair_type", "please_describe_the_issue", "urgency_level"))
NOT_MARKED = (f'The "{RESOURCE}" sheet has no {STATUS} column to mark the request {CANCELLED}, and a row is never '
              "taken out of it here — nothing was written.")
TWINS_OP = "cells"


def _sheet(reads: L.Reads) -> tuple[str, hubdb.TabRef | None]:
    """estateSheet_: the Repairs tab as the copy holds it."""
    prop, tab = L.ESTATE_SOURCES[RESOURCE]
    sid = reads.db.prop(prop)
    if not sid:
        raise hubdb.Unreadable(f"no {prop} is declared in the depot")
    ref = reads.tab_of(sid, tab, f"the estate's {tab}")
    return sid, (ref if ref is not None and ref.headers else None)


def _unopened(sid: str) -> Decision:
    return W.refuse(500, f'The "{RESOURCE}" sheet could not be opened.', fresh=(sid,))


def _moved(sid: str) -> Decision:
    """estateMoved_."""
    return W.refuse(409, f'That row has moved in the "{RESOURCE}" sheet since you opened it — reload the screen so '
                         "you are editing the right one.", fresh=(sid,))


def _door(verb: str, decide: Callable[[L.Session, dict], Decision]) -> Callable[[L.Session, dict], Decision]:
    """route('workOrders', verb), and the line doPost writes for every generic write; what the copy cannot answer is
    raised, and the relay says it was not saved."""
    def door(sess: L.Session, payload: dict) -> Decision:
        p = dict(payload) if isinstance(payload, dict) else {}
        out = decide(sess, p)
        # doPost logs the payload's id as the gate left it
        staff_views.record(sess.user, f"{RESOURCE}.{verb}", gsjs.str_(p.get("id")))
        return out
    return door


def _name(h: Any) -> str:
    return gsjs.trim(gsjs.js_str(h))


def _text(raw: dict, h: str) -> str:
    """A cell's text as the copy holds it (a linked cell's text alone)."""
    return gsjs.or_blank(hubdb.typed(raw.get(h), "raw"))


# ---- the tab as the sheet counts it ----------------------------------------------------------------------------------

def _numbered(reads: L.Reads, ref: hubdb.TabRef) -> dict[str, Any]:
    """The tab as Apps Script's live sheet holds it: the copy's rows up to its last filled one (getLastRow), a row the
    copy lacks blank, then each request kept here that the sheet does not hold yet, after it, as appendRow puts it —
    with each such request's number in Python's reads (laid past the copy's last row) and the copy's own cells."""
    copy = dict(reads.db._copy_rows(ref))
    top = max(copy, default=1)
    laid = reads.db.rows(ref)
    by = {rn: raw for rn, raw in laid if rn <= top}
    last = max((rn for rn, raw in by.items() if CCR._filled(raw)), default=1)
    rows = [(rn, by.get(rn) or {}) for rn in range(2, last + 1)]
    alias: dict[int, int] = {}
    for rn, raw in laid:
        if rn > top:
            alias[rn] = len(rows) + 2
            rows.append((alias[rn], raw))
    return {"rows": rows, "alias": alias, "copy": copy, "last": len(rows) + 1}


def _read(ref: hubdb.TabRef, rows: list[tuple[int, dict]], n: int) -> dict[str, Any]:
    """estateReadRow_ of row n: its cells as the sheet reads them back (row 1 is the header itself)."""
    raw = {h: hubdb.twin_base(gsjs.js_str(h)) for h in ref.headers} if n < 2 else rows[n - 2][1]
    row: dict[str, Any] = {"id": f"r{n}"}
    for h in ref.headers:
        k = hubdb.estate_key(h)
        if k:
            row[k] = hubdb.estate_cell(hubdb.typed(raw.get(h), "estate"))
    return row


def _sets(ref: hubdb.TabRef, leave: set[str] | frozenset[str] = frozenset()) -> list[list[str]]:
    """The header sets a row is named by, in the sheet's order, narrowest first, each less the headers in `leave`."""
    out: list[list[str]] = []
    for keys in KEY_SETS + (None,):
        hs = [h for h in ref.headers if h not in leave and _name(h) and W.COLS_SEP not in _name(h)
              and (hubdb.estate_key(h) in keys if keys is not None else True)]
        if hs and hs not in out:
            out.append(hs)
    return out


# ---- a request filed (route('workOrders', 'create')) ----------------------------------------------------------------

def file_gate(reads: L.Reads, rec: dict, user: dict) -> Decision | None:
    """estateFileGate_: a non-writer's request keeps the form's columns alone; a client's is filed at their own street,
    or refused 404 (never 403: a refusal must not say whether the client is on file)."""
    if not user or user.get("is_service") or gsjs.str_(user.get("role")) not in FILE_ROLES:
        return Decision({"status": 403, "message": "Filing is for clients, staff, managers and admins."})
    for k in list(rec):
        if k not in FILE_COLUMNS:
            rec.pop(k)
    if gsjs.str_(user.get("role")) != "client":
        return None
    key = gsjs.str_(user.get("client_key"))
    none = Decision({"status": 404, "message": f'No "{RESOURCE}" record here.'}, fresh=True)
    # estateClientOf_: the client's name and street as the platform's merge spells them
    me = next((c for c in reads.clients_derived() if gsjs.str_(c.get("client_key")) == key), None) if key else None
    if me is None:
        return none
    home = gsjs.str_(me.get("home_address"))
    CW.marked(home)
    if L.addr_key(rec.get(WITNESS)) != L.addr_key(home):
        rec[WITNESS] = home
    # hubClientRowGate_: the request names this client's house
    return None if HR.theirs(rec, MF.identity(reads, key)) else none


def _new_key(ref: hubdb.TabRef, rows: list[tuple[int, dict]], cells: dict[str, str]) -> tuple[str, str] | None:
    """The first set whose cells name the new row alone: no row of the sheet, nor any row kept here, holds them."""
    own = hubdb.OWN.get()
    groups = (getattr(own, "edits", None) or {}).get((ref.sheet_id, ref.tab)) or ()
    for hs in _sets(ref):
        mine = {h: cells.get(_name(h), "") for h in hs}
        key = W.cols_key(mine, hs)
        if not key:
            continue
        match = W.COLS + W.COLS_SEP.join(_name(h) for h in hs)
        if any(W.cols_key(raw, hs) == key for _rn, raw in rows) or \
                any(g["match"] == match and g["row_key"] == key for g in groups):
            continue
        return match, key
    return None


def file_repair(reads: L.Reads, rec: dict) -> Decision:
    """estateRoute_ create: the request's columns laid on the sheet's headers by estateKey_ and appended after the
    sheet's last row, answered as estateReadRow_ reads it back; kept under the first set of its cells no other row
    holds. Its time is kept as the sheet shows it once the bridge enters it, so the row is found by the same cells
    before the sheet holds it and after — or as the request sent it, when only that tells it from one filed that
    second."""
    sid, ref = _sheet(reads)
    if ref is None:
        return _unopened(sid)
    got = _numbered(reads, ref)
    rows, last = got["rows"], got["last"]
    cells: dict[str, str] = {}
    sent: dict[str, str] = {}
    for h in ref.headers:
        k = hubdb.estate_key(h)
        if not k or k not in rec:
            continue
        text = W.sheet_text(rec[k])
        if k == W.REPAIR_KEYS[0]:
            sent[_name(h)] = text
            text = CCR.sheet_shows(text)
        cells[_name(h)] = text
    if not any(cells.values()):
        # appendRow of blanks adds no row: the sheet's last row is what estateReadRow_ reads back
        return Decision({"status": 200, "data": _read(ref, rows, last)}, fresh=(sid,))
    named = _new_key(ref, rows, cells)
    if named is None and any(cells.get(h) != t for h, t in sent.items()):
        cells.update(sent)
        named = _new_key(ref, rows, cells)
    if named is None:
        return W.refuse(409, W.NOT_TOLD_APART, fresh=(sid,))
    rid = f"r{last + 1}"
    row = _read(ref, rows + [(last + 1, {h: cells.get(_name(h), "") for h in ref.headers})], last + 1)
    kept = W.kept_record(sid, ref.tab, "append", named[0], named[1], rid, cells)
    return W.final({"status": 200, "data": row}, [kept], rid)


def _create(sess: L.Session, rec: dict) -> Decision:
    reads, user = sess.reads, sess.user or {}
    if not CW.writer(user):
        refused = file_gate(reads, rec, user)
        if refused is not None:
            return refused
    return file_repair(reads, rec)


# ---- a request edited or cancelled (route('workOrders', 'update' | 'delete')) ---------------------------------------

def _row(reads: L.Reads, payload: dict) -> dict[str, Any]:
    """estateRoute_'s checks before it touches a row: the sheet opened, an r<row> id, the row there (Python's own number
    for a request the sheet does not hold yet names it too), its witness."""
    sid, ref = _sheet(reads)
    if ref is None:
        return {"refused": _unopened(sid)}
    row_num = W.estate_row_num(payload.get("id"))
    if not row_num:
        return {"refused": W.refuse(400, 'A row id like "r42" is required.')}
    got = _numbered(reads, ref)
    rn = got["alias"].get(row_num, row_num)
    if rn > got["last"]:
        return {"refused": W.refuse(404, f'No row "{HR.said(payload, "id")}" in {RESOURCE}.', fresh=(sid,))}
    raw = got["rows"][rn - 2][1]
    current = _read(ref, got["rows"], rn)
    current["id"] = f"r{row_num}"
    # estateRowMatches_
    witness = payload.get("witness")
    if witness is not None and gsjs.trim(gsjs.or_text(current.get(WITNESS))) != gsjs.trim(gsjs.js_str(witness)):
        CW.marked(current.get(WITNESS))
        return {"refused": _moved(sid)}
    held = None if rn in got["alias"].values() else got["copy"].get(rn)
    return {"sid": sid, "ref": ref, "rows": got["rows"], "at": rn - 2, "current": current, "raw": raw, "held": held}


def _twins(reads: L.Reads, got: dict, written: dict[str, str], answer: dict, user: dict, action: str) -> Decision:
    """Rows identical cell for cell read alike whichever holds a change, so the cells go on the sheet's first of them
    (or its last), found by a column whose first (or last) holder is one of them; a blank row is named by nothing."""
    sid, ref, rows, me = got["sid"], got["ref"], got["rows"], got["rows"][got["at"]][1]
    texts = {h: gsjs.trim(_text(me, h)) for h in ref.headers}
    if not any(texts.values()):
        return W.refuse(409, W.NOT_TOLD_APART, fresh=(sid,))
    for which, order in (("first", rows), ("last", rows[::-1])):
        for h in ref.headers:
            v = texts[h]
            if not v or not _name(h) or CO.withheld(v):
                continue
            hit = next(raw for _rn, raw in order if gsjs.trim(_text(raw, h)) == v)
            if any(gsjs.trim(_text(hit, x)) != texts[x] for x in ref.headers):
                continue
            subject = f"{RESOURCE}:{ref.tab}"
            if BO.settling(reads, subject):
                raise Defer("the cells last written on rows nothing tells apart are not in the copy yet")
            BO.queue([{"op": TWINS_OP, "sheet_id": sid, "tab": ref.tab,
                       "spec": {"match": _name(h), "key": v, "which": which,
                                "cells": {_name(x): t for x, t in written.items()}}}], subject, W.who(user), action)
            return Decision(answer, subject=got["current"]["id"], own=True, fresh=(sid,))
    return W.refuse(409, W.NOT_TOLD_APART, fresh=(sid,))


def _keep(reads: L.Reads, got: dict, written: dict[str, str], answer: dict, user: dict, action: str) -> Decision:
    """The cells written (header → text) kept on the row: named by the first set of its cells that no write changes and
    no other row holds, else by the cells it holds before this write; a key carried by two columns is kept by each."""
    ref, rows, at, raw, held = got["ref"], got["rows"], got["at"], got["raw"], got["held"]
    moving = set(written) | {h for h in ref.headers
                             if held is None or not W.same_cell(_text(raw, h), _text(held, h), "estate")}
    named = W.row_key_of(rows, at, _sets(ref, moving)) or W.row_key_of(rows, at, _sets(ref))
    if named is None:
        return _twins(reads, got, written, answer, user, action)
    heads = CCR._estate_heads(ref)
    by_key: dict[str, str] = {}
    by_head: dict[str, str] = {}
    for h, v in written.items():
        k = hubdb.estate_key(h)
        if len(heads[k]) == 1:
            by_key[k] = v
        else:
            by_head[_name(h)] = v
    subject = got["current"]["id"]
    recs = []
    if by_key:
        rec = W.kept_record(ref.sheet_id, ref.tab, "edit", named[0], named[1], subject, by_key,
                            {k: _text(raw, heads[k][0]) for k in by_key})
        rec["keyed"] = "estate"
        recs.append(rec)
    if by_head:
        recs.append(W.kept_record(ref.sheet_id, ref.tab, "edit", named[0], named[1], subject, by_head,
                                  {_name(h): _text(raw, h) for h in written if _name(h) in by_head}))
    out = W.final(answer, recs, subject)
    # the estate's forms and its people write this sheet too: a witness off a copy the sheet has moved past waits
    out.fresh = (ref.sheet_id,)
    return out


def _update(sess: L.Session, payload: dict) -> Decision:
    """estateRoute_'s header-bound update — writers alone, the row checked against its witness, only the columns the
    sheet has and the caller sent (each column of a key two carry); answered with the row as it reads after."""
    reads = sess.reads
    if not CW.writer(sess.user):
        return Decision(dict(DENIED))
    got = _row(reads, payload)
    if got.get("refused"):
        return got["refused"]
    ref, raw = got["ref"], got["raw"]
    heads = CCR._estate_heads(ref)
    sent = {k: payload[k] for k in heads if k in payload}
    if not sent:
        return W.refuse(400, "Nothing to update — no known column was sent.", fresh=(got["sid"],))
    after = dict(got["current"])
    written: dict[str, str] = {}
    for k, v in sent.items():
        text = W.sheet_text(v)
        after[k] = hubdb.estate_cell(hubdb.typed(text, "estate"))
        for h in heads[k]:
            # a cell set to what it holds changes nothing on the sheet
            if not W.same_cell(text, _text(raw, h), "estate"):
                written[h] = text
    CW.marked(*after.values())
    CW.marked(*(raw.get(h) for h in written))
    answer = {"status": 200, "data": after}
    if not written:
        return Decision(answer, fresh=(got["sid"],))
    return _keep(reads, got, written, answer, sess.user or {}, "workOrdersUpdate")


def _delete(sess: L.Session, payload: dict) -> Decision:
    """estateRoute_'s soft delete — writers alone, the row checked against its witness, its first status column set to
    Cancelled; a sheet with no status column would lose the row, which is never done here."""
    if not CW.writer(sess.user):
        return Decision(dict(DENIED))
    got = _row(sess.reads, payload)
    if got.get("refused"):
        return got["refused"]
    heads = CCR._estate_heads(got["ref"])
    if STATUS not in heads:
        return W.refuse(409, NOT_MARKED, fresh=(got["sid"],))
    h = heads[STATUS][0]
    answer = {"status": 200, "data": {"id": payload.get("id"), "cancelled": True}}
    if W.same_cell(CANCELLED, _text(got["raw"], h), "estate"):
        return Decision(answer, fresh=(got["sid"],))
    CW.marked(got["raw"].get(h))
    return _keep(sess.reads, got, {h: CANCELLED}, answer, sess.user or {}, "workOrdersDelete")


create = _door("create", _create)
update = _door("update", _update)
delete = _door("delete", _delete)

ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {"workOrdersCreate": create, "workOrdersUpdate": update,
                                                             "workOrdersDelete": delete}
# the generic verbs declare no roles; each door's own gate decides
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
# estateRoute_'s own answer while another writer holds the sheet
BUSY_OF: dict[str, dict[str, Any]] = {a: SHEET_BUSY for a in ACTIONS}


class Store(W.Store):
    """app.house_repair_writes and app.house_repair_receipts, beside the other apps' own; the rows app.edits'."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="house_repair", label="House Repair")
