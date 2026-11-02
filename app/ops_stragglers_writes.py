"""The last generic writes of their apps, decided off asa-hub-db and kept in Postgres (Main.gs route → Estate.gs
estateRoute_ for the estate's incidents; SheetDb.gs createRow_, updateRowById_ and deleteRowById_ for the Hub's tabs):
a UI report corrected or removed; a call-off, a library document and a helpful contact removed; a helpful contact
added; a roster row changed (Image Bank's Assign to… Staff). Cells are kept in app.edits; a row deleted, a tab made, a
column added and a row its id cannot name ride app.book_ops (app/row_ops.py). Nothing is asked of Apps Script: what
the copy cannot answer is a 503 to try again."""
from __future__ import annotations

import logging
import types
from typing import Any, Callable

import call_offs_writes as COW
import client_care_records as CCR
import client_writes as CW
import docs_writes as DW
import gsjs
import house_tables as HT
import hubdb
import locations as L
import ops_stragglers as OS
import resource_rows as RR
import row_ops as RO
import staff_views
import suggestions_writes as SW
import writes as W
from scope import Defer
from writes import Decision

log = logging.getLogger("asa-hub-app")

TRY_AGAIN = "This change could not be saved just now, and nothing was written. Try again in a moment."
NO_ID = 'Missing required "id" in payload.'
BUSY = {"status": 409, "message": W.BUSY}
# estateRoute_'s own answer while another writer holds the sheet
SHEET_BUSY = {"status": 503, "message": "The sheet is busy — try again in a moment."}
INCIDENTS = "uiIncidents"
# ESTATE_WITNESS: the column an edit checks before touching a row
INCIDENT_WITNESS = "client_name"
INCIDENT_WORDS = ("the incident's row on the UIs and MUIs sheet.", "The incidents sheet's kept copy, read again.")
CALL_OFFS, DOCUMENTS, HELPFUL, PEOPLE = "callOffs", "documents", "helpfulContacts", "people"
# RESOURCES (Main.gs): the tab each resource lives in
TABS = {CALL_OFFS: "callOffs", DOCUMENTS: "documents", HELPFUL: "helpful_contacts", PEOPLE: "people"}
# hubRosterWriteGate_
ROSTER_DENIED = ("The staff roster is written by an administrator or a manager — its names and e-mails decide whose "
                 "records an account reads. Nothing was changed.")

s_ = gsjs.str_


def _door(resource: str, verb: str, decide: Callable[[L.Session, dict], Decision]) -> Callable[[L.Session, dict],
                                                                                                 Decision]:
    """route(resource, verb), and the line doPost writes for every generic write; what the copy cannot answer is a 503
    to try again, never another engine's to decide."""
    def door(sess: L.Session, payload: dict) -> Decision:
        p = dict(payload) if isinstance(payload, dict) else {}
        try:
            out = decide(sess, p)
        except (Defer, hubdb.Unreadable) as why:
            log.info("%s.%s not decided: %s", resource, verb, why)
            return W.refuse(503, TRY_AGAIN)
        # doPost logs the payload's id as the gates left it
        staff_views.record(sess.user, f"{resource}.{verb}", s_(p.get("id")))
        return out
    door.__doc__ = decide.__doc__
    return door


def _held(reads: L.Reads) -> Decision | None:
    """sheetDbGateHolds_: the book-write funnel's own 409 while it holds."""
    import candidate_papers as CP  # noqa: PLC0415 - SmartGate.gs hubGateHolds_, as the papers' doors read it
    why = CP.gate_holds(reads, CP.BOOK_GATE)
    return W.refuse(409, why) if why else None


def _missing(want: str, resource: str, fresh: tuple) -> Decision:
    return W.refuse(404, f'No "{resource}" record with id "{want}".', fresh=fresh)


# ---- the estate's incidents (estateRoute_) -------------------------------------------------------------------------

def _incident_sheet(reads: L.Reads, resource: str = INCIDENTS) -> tuple[str, hubdb.TabRef | None]:
    """estateSheet_: the estate tab (the UIs and MUIs one unless named) as the copy holds it."""
    prop, tab = L.ESTATE_SOURCES[resource]
    sid = reads.db.prop(prop)
    if not sid:
        return "", None
    ref = reads.tab_of(sid, tab, f"the estate's {tab}")
    return sid, (ref if ref is not None and ref.headers else None)


def _filled(raw: dict) -> bool:
    return any(gsjs.trim(gsjs.or_blank(hubdb.typed(v, "raw"))) for v in raw.values())


def _incident_row(reads: L.Reads, p: dict, resource: str = INCIDENTS, witness_key: str = INCIDENT_WITNESS
                  ) -> dict[str, Any]:
    """estateRoute_'s checks before it touches a row: the sheet opened, an r<row> id, the row there (estateReadRow_),
    its witness (estateRowMatches_) — { refused } or the row as the copy holds it, Python's own kept edits laid."""
    sid, ref = _incident_sheet(reads, resource)
    if ref is None:
        return {"refused": W.refuse(500, f'The "{resource}" sheet could not be opened.',
                                    fresh=(sid,) if sid else False)}
    row_num = W.estate_row_num(p.get("id"))
    if not row_num:
        return {"refused": W.refuse(400, 'A row id like "r42" is required.')}
    rows = reads.db.rows(ref)
    # estateReadRow_: a row past the sheet's last one is not there
    if row_num > max((rn for rn, raw in rows if _filled(raw)), default=1):
        return {"refused": W.refuse(404, f'No row "{gsjs.js_str(p.get("id"))}" in {resource}.', fresh=(sid,))}
    at = next((i for i, (rn, _raw) in enumerate(rows) if rn == row_num), None)
    raw = rows[at][1] if at is not None else {}
    current: dict[str, Any] = {"id": f"r{row_num}"}
    for h in ref.headers:
        k = hubdb.estate_key(h)
        if k:
            current[k] = hubdb.estate_cell(hubdb.typed(raw.get(h), "estate"))
    witness = p.get("witness")
    shown = gsjs.trim(gsjs.or_text(current.get(witness_key)))
    if witness is not None and shown != gsjs.trim(gsjs.js_str(witness)):
        CW.marked(current.get(witness_key))
        return {"refused": W.refuse(409, f'That row has moved in the "{resource}" sheet since you opened it — reload '
                                         "the screen so you are editing the right one.", fresh=(sid,))}
    return {"sid": sid, "ref": ref, "rows": rows, "at": at, "row_num": row_num, "raw": raw, "current": current}


def incident_update(sess: L.Session, p: dict) -> Decision:
    """estateRoute_ update: a writer's correction on the row its r<row> id names, checked against its witness (the
    client's name), header-bound — only the columns the sheet has and the caller sent; answered with the row as it
    reads after."""
    reads = sess.reads
    if not CW.writer(sess.user):
        return Decision(CW.denied())
    got = _incident_row(reads, p)
    if got.get("refused"):
        return got["refused"]
    sid, ref, at, row_num, raw, current = (got[k] for k in ("sid", "ref", "at", "row_num", "raw", "current"))
    heads = CCR._estate_heads(ref)
    sent = {k: p[k] for k in heads if k in p}
    if not sent:
        return W.refuse(400, "Nothing to update — no known column was sent.", fresh=(sid,))
    after = dict(current)
    written: list[dict] = []
    for k, v in sent.items():
        text = W.sheet_text(v)
        after[k] = hubdb.estate_cell(hubdb.typed(text, "estate"))
        was = gsjs.or_blank(hubdb.typed(raw.get(heads[k][0]), "raw"))
        # a cell set to what it holds changes nothing on the sheet
        if gsjs.trim(text) != gsjs.trim(was):
            written.append({"field": k, "before": was, "after": text})
    answer = {"status": 200, "data": after}
    if not written:
        return Decision(answer, fresh=(sid,))
    if at is None:
        return W.refuse(409, W.NOT_TOLD_APART, fresh=(sid,))
    CW.marked(*[current.get(k) for k in W.INCIDENT_KEYS_ALSO[-1]])
    # the row is found by cells no edit writes: when it was filed, else who filed it for whom, then its short cells
    wrote = {w["field"] for w in written}
    keys_by = () if wrote & set(W.INCIDENT_KEYS) else W.INCIDENT_KEYS
    d = W.estate_kept(reads, ref, row_num, INCIDENTS, written, [], {}, INCIDENT_WORDS, "", "", keys_by,
                      W.INCIDENT_KEYS_ALSO)
    if d.edits:
        d.answer = answer
    return d


def _cols(match: str) -> list[str]:
    return match[len(W.COLS):].split(W.COLS_SEP) if match.startswith(W.COLS) else []


def incident_delete(sess: L.Session, p: dict) -> Decision:
    """estateRoute_ delete: a writer's removal of the row its r<row> id names, checked against its witness. The UIs
    and MUIs tab has no column to mark it cancelled, so the row leaves the sheet (deleteRow), by the `delete` op naming
    it by cells no other row holds and expecting the client the screen showed."""
    reads, user = sess.reads, sess.user or {}
    if not CW.writer(user):
        return Decision(CW.denied())
    got = _incident_row(reads, p)
    if got.get("refused"):
        return got["refused"]
    sid, ref, rows, at, row_num, raw = (got[k] for k in ("sid", "ref", "rows", "at", "row_num", "raw"))
    if at is None:
        return W.refuse(409, W.NOT_TOLD_APART, fresh=(sid,))
    heads = CCR._estate_heads(ref)
    sets = [[heads[k][0] for k in ks if k in heads] for ks in (W.INCIDENT_KEYS,) + W.INCIDENT_KEYS_ALSO]
    named = W.row_key_of(rows, at, sets)
    if named is None:
        return W.refuse(409, W.NOT_TOLD_APART, fresh=(sid,))
    CW.marked(*raw.values())
    where = dict(zip(_cols(named[0]), named[1].split("\x1f")))
    witness = gsjs.trim(gsjs.js_str(heads[INCIDENT_WITNESS][0])) if INCIDENT_WITNESS in heads else ""
    expect = {witness: gsjs.trim(gsjs.or_blank(hubdb.typed(raw.get(heads[INCIDENT_WITNESS][0]), "raw")))} \
        if witness else {}
    copied = max((rn for rn, r in reads.db._copy_rows(ref) if _filled(r)), default=1)
    # a report Python filed that the sheet does not hold yet: its kept append withdrawn, the delete still queued
    withdrew = [] if row_num <= copied else RO.withdraw(
        sid, ref.tab, lambda g: bool(_cols(g["match"])) and W.cols_key(raw, _cols(g["match"])) == g["row_key"])
    RO.queue_delete(INCIDENTS, sid, ref.tab, {"where": where, "which": "only", "expect": expect}, f"r{row_num}",
                    W.who(user), "uiIncidentsDelete", withdrew)
    return Decision({"status": 200, "data": {"id": p.get("id"), "deleted": True}}, subject="", own=True,
                    fresh=(sid,))


# ---- a row removed from a Hub tab (deleteRowById_) -------------------------------------------------------------------

def _client(user: dict) -> bool:
    return s_(user.get("role")) == "client" and not user.get("is_service")


def remove(sess: L.Session, resource: str, p: dict, action: str) -> Decision:
    """route(resource, 'delete'): a client may remove no row of a resource that names no client; deleteRowById_ —
    the first row with this id taken out of its tab by the `delete` op, a row of the place's own alone."""
    reads, user = sess.reads, sess.user or {}
    p.pop("tenant", None)
    name = TABS[resource]
    sid, tab, ref = OS.tab(reads, name)
    fresh = (sid,)
    rid = p.get("id")
    if _client(user):
        # route(): a client may not remove somebody else's row — and no row of a resource that names no client is theirs
        want = s_(rid)
        if not want:
            return W.refuse(400, NO_ID)
        if next((r for r in OS.rows(reads, name) if gsjs.or_blank(r.get("id")) == want), None) is None:
            return _missing(want, resource, fresh)
        return W.refuse(404, f'No "{resource}" record here.', fresh=fresh)
    held = _held(reads)
    if held is not None:
        return held
    if rid is None or rid == "":
        return W.refuse(400, NO_ID)
    want = gsjs.js_str(rid)
    row = next((r for r in OS.rows(reads, name) if gsjs.or_blank(r.get("id")) == want), None)
    if row is None or not OS.visible(OS.here(reads, user), row.get("tenant")):
        return _missing(want, resource, fresh)
    kept = HT.resource_of(name) if HT.tabled(name) else None
    if kept is not None:
        # its own table: the first row with this id taken out there
        hit = RR.find(reads, kept, want)
        if hit is None:
            return _missing(want, resource, ())
        RR.remove(reads, kept, hit[0], hit[1], W.who(user))
        return Decision({"status": 200, "data": {"id": rid, "deleted": True}}, subject=want, own=True)
    # a row Python appended that the sheet does not hold yet: its kept append withdrawn, the delete still queued
    withdrew = [] if RO.in_copy(reads, ref, want) else RO.withdraw(
        sid, tab, lambda g: g["match"] == "id" and g["row_key"] == want)
    RO.queue_delete(resource, sid, tab, {"match": "id", "key": want, "which": "first", "expect": {}}, want,
                    W.who(user), action, withdrew)
    return Decision({"status": 200, "data": {"id": rid, "deleted": True}}, subject=want, own=True, fresh=fresh)


def call_off_delete(sess: L.Session, p: dict) -> Decision:
    """route('callOffs', 'delete'): a call-off taken out of the Call Offs house."""
    return remove(sess, CALL_OFFS, p, "callOffsDelete")


def doc_delete(sess: L.Session, p: dict) -> Decision:
    """route('documents', 'delete'): a document taken out of the library's own table (docs_writes)."""
    return DW.docs_delete(sess, p)


def helpful_delete(sess: L.Session, p: dict) -> Decision:
    """route('helpfulContacts', 'delete'): a helpful contact taken out of the list."""
    return remove(sess, HELPFUL, p, "helpfulContactsDelete")


# ---- a row added to a Hub tab, or changed (createRow_, updateRowById_) -------------------------------------------

def helpful_create(sess: L.Session, p: dict) -> Decision:
    """route('helpfulContacts', 'create'): createRow_ — the payload's fields, an id, createdAt and updatedAt, appended;
    the place is the context's, never the payload's."""
    reads, user = sess.reads, sess.user or {}
    record = dict(p)
    record.pop("tenant", None)
    place = OS.here(reads, user)
    if place:
        record["tenant"] = place
    held = _held(reads)
    if held is not None:
        return held
    now = W.now_iso(reads)
    if gsjs.falsy(record.get("id")):
        record["id"] = W.mint()
    if gsjs.falsy(record.get("createdAt")):
        record["createdAt"] = now
    record["updatedAt"] = now
    name = TABS[HELPFUL]
    rid = gsjs.js_str(record["id"])
    kept = HT.resource_of(name) if HT.tabled(name) else None
    if kept is not None:
        # its own table: the row made there, the place's stamp with it
        RR.create(reads, kept, {h: v for h, v in ((h, COW.serialize(record.get(h))) for h in record) if v != ""},
                  W.who(user))
        return Decision({"status": 200, "data": record}, subject=rid, own=True)
    sid, tab, ref = OS.tab(reads, name)
    header = RO.queue_columns(HELPFUL, sid, tab, ref, list(record), W.who(user), "helpfulContactsCreate")
    cells = {h: COW.serialize(record.get(h)) for h in header}
    if any(gsjs.or_blank(r.get("id")) == rid for r in OS.all_rows(reads, name)):
        # a kept append is found by its id, and this id names a row already: appended to the sheet as it is
        RO.queue_append(HELPFUL, sid, tab, cells, rid, W.who(user), "helpfulContactsCreate")
        return Decision({"status": 200, "data": record}, subject=rid, own=True, fresh=(sid,))
    d = W.final({"status": 200, "data": record}, [W.kept_record(sid, tab, "append", "id", rid, rid, cells)], rid)
    d.fresh = (sid,)
    return d


def people_update(sess: L.Session, p: dict) -> Decision:
    """route('people', 'update'): the roster gate (hubRosterWriteGate_ — an admin's or a manager's own session), then
    updateRowById_ — the row merged with the patch, createdAt immutable, updatedAt refreshed; the cells the patch names
    kept, a column the People house lacks added."""
    reads, user = sess.reads, sess.user or {}
    if user.get("is_service") or not CW.writer(user):
        return W.refuse(403, ROSTER_DENIED)
    p.pop("tenant", None)
    held = _held(reads)
    if held is not None:
        return held
    if "id" not in p or p["id"] == "":
        return W.refuse(400, NO_ID)
    import staff as SP  # noqa: PLC0415 - listRows_('people') as the roster's readers read it
    want = gsjs.js_str(p["id"])
    sid, tab, ref = OS.tab(reads, TABS[PEOPLE])
    row = next((r for r in SP._people(reads) if "id" in r and gsjs.js_str(r["id"]) == want), None)
    if ref is None or row is None or not OS.visible(OS.here(reads, user), row.get("tenant")):
        return _missing(want, PEOPLE, (sid,))
    now = W.now_iso(reads)
    merged = dict(row)
    changed: dict[str, Any] = {}
    for k, v in p.items():
        # createdAt is immutable
        if k == "createdAt":
            continue
        merged[k] = v
        if k != "id":
            changed[k] = v
    merged["updatedAt"] = changed["updatedAt"] = now
    if HT.tabled(TABS[PEOPLE]):
        # its own table takes any column the patch names (writes.into_tables); the row's cells there before it
        held = HT.tab_rows(reads, HT.kept_ref(reads, TABS[PEOPLE]))
    else:
        RO.queue_columns(PEOPLE, sid, tab, ref, list(changed), W.who(user), "peopleUpdate")
        held = reads.db.rows(ref)
    raw = next((r for _rn, r in held if gsjs.or_blank(hubdb.typed(r.get("id"), "raw")) == want), {})
    cells = {k: COW.serialize(v) for k, v in changed.items()}
    before = {k: gsjs.or_blank(hubdb.typed(raw.get(k), "raw")) for k in cells}
    d = W.final({"status": 200, "data": merged}, [W.kept_record(sid, tab, "edit", "id", want, want, cells, before)],
                want)
    d.fresh = (sid,)
    return d


# ---- each app's doors, and its store -----------------------------------------------------------------------------

def _set(actions: dict[str, Callable[[L.Session, dict], Decision]], busy: dict[str, Any]) -> types.SimpleNamespace:
    # the generic verbs declare no roles; each door's own gate decides
    return types.SimpleNamespace(ACTIONS=actions, POLICY={a: {} for a in actions},
                                 BUSY_OF={a: dict(busy) for a in actions})


UI_INCIDENTS = _set({"uiIncidentsUpdate": _door(INCIDENTS, "update", incident_update),
                     "uiIncidentsDelete": _door(INCIDENTS, "delete", incident_delete)}, SHEET_BUSY)
CALL_OFFS_DOORS = _set({"callOffsDelete": _door(CALL_OFFS, "delete", call_off_delete)}, COW.BUSY_OF["callOffsCreate"])
DOCS_DOORS = _set({"docsDelete": _door(DOCUMENTS, "delete", doc_delete)}, DW.BUSY_OF["docsCreate"])
SUGGESTIONS_DOORS = _set({"helpfulContactsCreate": _door(HELPFUL, "create", helpful_create),
                          "helpfulContactsDelete": _door(HELPFUL, "delete", helpful_delete)}, BUSY)
PEOPLE_DOORS = _set({"peopleUpdate": _door(PEOPLE, "update", people_update)}, BUSY)


class _CancelsOps:
    """A void takes the write's book ops not carried yet back with its cells, and keeps again the append it
    withdrew."""

    def settle(self, write_id: str, state: str, why: str = "", fields: list[str] | None = None) -> bool:
        done = super().settle(write_id, state, why, fields)  # type: ignore[misc]
        if state == "void" and done:
            try:
                with self.conn().transaction():  # type: ignore[attr-defined]
                    RO.cancel(self.conn(), write_id)  # type: ignore[attr-defined]
            except Exception as exc:  # noqa: BLE001 - said, never raised into the relay's settle
                log.warning("row ops: the void of %s left its book ops queued (%s)", write_id[:40], type(exc).__name__)
        return done


class UiIncidentsStore(_CancelsOps, W.Store):
    """app.ui_incidents_writes and _receipts; the cells app.edits', a row deleted app.book_ops'."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="ui_incidents", label="UI Reports")


class PeopleRosterStore(_CancelsOps, W.Store):
    """app.people_roster_writes and _receipts; the cells app.edits', a column added app.book_ops'."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="people_roster", label="People roster")


class CallOffsStore(_CancelsOps, COW.Store):
    """Call Offs' own store, a removal's book op taken back with its write."""


class DocsStore(_CancelsOps, DW.Store):
    """Docs' own store, a removal's book op taken back with its write."""


class SuggestionsStore(_CancelsOps, SW.Store):
    """Suggestions' own store, a helpful contact's book ops taken back with its write."""
