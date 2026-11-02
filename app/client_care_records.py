"""A client's care records written off asa-hub-db (ClientProfiles.gs, Estate.gs): an incident's review status
(clientProfileIncidentStatus — one row of the Hub's incident_reviews tab per client_key|incident_ts, made or moved), a
visit's cells on the Dr Appt Archive (clientProfileApptSave — estateRoute_'s header-bound update of drVisits, the
client's name as the witness) and a new incident report (the generic create of uiIncidents — estateRoute_'s append to
the UIs and MUIs book behind estateFileGate_). Each row is kept in app.edits under the write lock, the bridge the
estate's forms and every reader of these books share; nothing is asked of Google here."""
from __future__ import annotations

import re
from datetime import datetime
from typing import Any, Callable

import client_sources as CS
import client_writes as CW
import clients as C
import dr_appointments as DR
import dr_book as DB
import gsjs
import hubdb
import locations as L
import resource_rows as RR
import scope as sc
import staff_views
import writes as W
from gsjs import NY, name_key
from scope import Defer
from writes import Decision

APP_ID = C.APP_ID
INCIDENTS = "uiIncidents"
VISITS = "drVisits"
INCIDENT_STATUSES = C.INCIDENT_STATUSES
REVIEWS_HEADER = CW.REVIEWS_HEADER
# CP_APPT_FIELDS: the Dr Appt Archive columns the pencil writes, and the ApptRow names that stand for them
APPT_FIELDS = {"dr_name": "dr_name", "appointment_date": "appointment_date", "date": "appointment_date",
               "appointment_start_time": "appointment_start_time", "time": "appointment_start_time",
               "appointment_address": "appointment_address", "dr_address": "appointment_address",
               "wheelchair_van_required": "wheelchair_van_required", "van": "wheelchair_van_required",
               "upcoming": "upcoming"}
APPT_CELL_MAX = 300
NOTES_MAX = 2000
DOCTORS = "drAppointments"
# Settings › Editions: the pencil and a visit booked, a doctor added
EDITION = {"appointments": "clients.appointments", "doctors": "clients.doctors"}
# the fields of a visit booked and of a doctor added, as the forms name them
NEW_VISIT_FIELDS = ("date", "time", "dr_name", "dr_address", "van")
NEW_DOCTOR_FIELDS = ("dr_name", "specialist", "phone", "fax", "address", "standard_freq", "notes")
NOT_KEPT = {"status": 503, "message": "The appointments book is not kept in the Hub yet — try again in a moment."}
# ESTATE_WITNESS: the column an update checks before touching a row
VISIT_WITNESS = "client_name"
# ESTATE_FILE_ROLES and ESTATE_FILE_COLUMNS: who files without being a writer, and the form's columns they keep
FILE_ROLES = ("admin", "manager", "staff", "client")
FILE_COLUMNS = W.FILE_COLUMNS[INCIDENTS]
# the cells that find a filed report's row again on the sheet: when, who filed it, for whom
INCIDENT_KEYS = ("timestamp", "your_name", "client_name")
# the cells that find a visit's row again; none of them is one the pencil writes
VISIT_KEYS = ("timestamp", "client_name")
SHEET_BUSY = {"status": 503, "message": "The sheet is busy — try again in a moment."}
# what Object.prototype answers: a lookup by any of these finds something in JavaScript and nothing here
_PROTO = frozenset({"constructor", "__proto__", "__defineGetter__", "__defineSetter__", "__lookupGetter__",
                    "__lookupSetter__", "hasOwnProperty", "isPrototypeOf", "propertyIsEnumerable", "toString",
                    "toLocaleString", "valueOf"})
_ISO_Z = re.compile(r"^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$")
_ROW_ID = re.compile(r"r[0-9]+")
_VAN_YES = re.compile(r"(y|yes|true|1)", re.I)


def _text(v: Any, max_len: int) -> str:
    """locationsText_(v, max), cut in UTF-16 units."""
    return CW.js_cut(gsjs.text(v), max_len)


def _js_keys(d: dict) -> list[str]:
    """Object.keys order: array-index keys ascending first, then the rest as written."""
    idx = sorted((k for k in d if re.fullmatch(r"0|[1-9][0-9]{0,9}", str(k)) and int(k) < 4294967295), key=int)
    return idx + [k for k in d if k not in idx]


def _head(ref: hubdb.TabRef | None, name: str) -> str | None:
    """The tab's own header whose trimmed text is `name`."""
    if ref is None:
        return None
    return next((h for h in ref.headers if gsjs.trim(gsjs.js_str(h)) == name), None)


def _estate_heads(ref: hubdb.TabRef) -> dict[str, list[str]]:
    """estateKey_ → the tab's headers carrying it, in sheet order."""
    out: dict[str, list[str]] = {}
    for h in ref.headers:
        k = hubdb.estate_key(h)
        if k:
            out.setdefault(k, []).append(h)
    return out


def _filled(raw: dict) -> bool:
    return any(gsjs.trim(gsjs.or_blank(v)) for v in raw.values())


# ---- an incident's review status (clientProfileIncidentStatus) ------------------------------------------------------

def incident_status(sess: L.Session, payload: dict) -> Decision:
    """clientProfileIncidentStatus: Reported, Under review or Closed, kept in incident_reviews by client_key|incident_ts —
    the row appended the first time, its status, by and at moved after."""
    shut = CW.master_door(sess)
    if shut:
        return Decision(shut)
    reads = sess.reads
    ctx = CW.client_of(reads, payload.get("client"))
    if ctx.get("refused"):
        return CW.door_refused(ctx["refused"])
    status = gsjs.text(payload.get("status"))
    hit = next((s for s in INCIDENT_STATUSES if s.lower() == status.lower()), None)
    if hit is None:
        return W.refuse(400, "status: one of " + ", ".join(INCIDENT_STATUSES) + ".")
    ts = _text(payload.get("incident_ts"), 80)
    if not ts:
        return W.refuse(400, "incident_ts: the report's timestamp.")
    witness = _text(payload.get("client_name"), 200)
    if not witness or name_key(witness) != name_key(ctx["name"]):
        return W.refuse(409, "That incident is not this client's any more — reload the incidents.", fresh=True)
    joined, why = L._soft(lambda: L.incidents_for(C.estate(reads, INCIDENTS),
                                                  [{"client_key": ctx["key"], "name": ctx["name"]}]))
    if joined is None:
        raise Defer(f"the incidents could not be read here ({why})")
    stamps = [gsjs.or_text((j.get("row") or {}).get("timestamp")) for j in joined]
    if ts not in stamps:
        CW.marked(*stamps)
        return W.refuse(404, f"No incident of this client was reported at {ts}.", fresh=True)
    # cpTabHomed_: the tab is born in the Care book or nowhere
    if hubdb.HUB_TAB_HOME.get(C.REVIEWS_TAB) != "HUB_CARE_BOOK_ID":
        return W.refuse(503, f"The {C.REVIEWS_TAB} store has no home in the Care book in this deployment, so nothing "
                             "was filed.")
    W.gate(reads)
    res = W.tab_of(reads, C.REVIEWS_TAB)
    rid = ctx["key"] + "|" + ts
    rec = {"id": rid, "client_key": ctx["key"], "client_name": ctx["name"], "incident_ts": ts, "status": hit,
           "by": W.who(sess.user), "at": W.now_iso(reads)}
    sid, tab = W.where_of(res)
    id_h = _head(res.ref, "id")
    rows = reads.db.rows(res.ref) if res.ref is not None else []
    have = next((raw for _rn, raw in rows if id_h is not None and gsjs.trim(gsjs.or_text(raw.get(id_h))) == rid), None)
    if have is None:
        kept = W.kept_record(sid, tab, "append", "id", rid, ctx["key"], {h: rec[h] for h in REVIEWS_HEADER})
    else:
        cells = {"status": hit, "by": rec["by"], "at": rec["at"]}
        before = {f: gsjs.or_blank(have.get(h)) for f in cells for h in (_head(res.ref, f),) if h is not None}
        kept = W.kept_record(sid, tab, "edit", "id", rid, ctx["key"], cells, before)
    staff_views.record(sess.user, "clientProfileIncidentStatus", ctx["key"])
    return W.final({"status": 200, "data": {"saved": True, "row": rec}}, [kept], ctx["key"])


# ---- a visit on the Dr Appt Archive (clientProfileApptSave) ---------------------------------------------------------

def names_of(ctx: dict) -> dict[str, bool]:
    """cpNamesOf_: every name key the client is spelled by — their own, and hubClientIdentity_'s (the key itself and the
    name the clients' merge gives it)."""
    names: dict[str, bool] = {}
    own = name_key(ctx["name"])
    if own:
        names[own] = True
    names[ctx["key"]] = True
    for r in ctx.get("all") or []:
        if gsjs.str_(r.get("client_key")) != ctx["key"]:
            continue
        n = name_key(gsjs.str_(r.get("name")))
        if n:
            names[n] = True
    return names


def appt_row(r: dict, ctx: dict, today: str) -> dict[str, Any]:
    """cpApptRow_: a past day is Past, today onward Upcoming, a day it cannot read follows the Upcoming? cell; the
    witness its own name cell."""
    day = C.cp_day(r.get("appointment_date"))
    up_cell = gsjs.or_text(r.get("upcoming"))
    if day:
        status = "Upcoming" if C._appt_bucket(day, "", today, "") == "upcoming" else "Past"
    else:
        status = "Upcoming" if re.match(r"y", up_cell, re.I) or not up_cell else "Past"
    return {"id": gsjs.or_text(r.get("id")), "witness": gsjs.or_text(r.get("client_name")), "client_key": ctx["key"],
            "client_name": gsjs.text(r.get("client_name")), "date": day or gsjs.text(r.get("appointment_date")),
            "time": gsjs.text(r.get("appointment_start_time")), "dr_name": gsjs.text(r.get("dr_name")),
            "dr_address": gsjs.text(r.get("appointment_address")),
            "van": re.match(r"y", gsjs.or_text(r.get("wheelchair_van_required")), re.I) is not None, "status": status}


def appt_patch(raw: Any, rid: str, witness: str) -> tuple[dict[str, str] | None, Decision | None]:
    """The pencil's fields as Dr Appt Archive columns (the van a Yes or No), or its refusal."""
    if gsjs.falsy(raw) or not isinstance(raw, dict):
        return None, W.refuse(400, "fields: what to change.")
    patch = {"id": rid, "witness": witness}
    unknown: list[str] = []
    n = 0
    for k in _js_keys(raw):
        if k in _PROTO:
            raise Defer("a field name JavaScript's own objects answer")
        col = APPT_FIELDS.get(k)
        if not col:
            unknown.append(k)
            continue
        v = raw[k]
        if col == "wheelchair_van_required":
            v = "Yes" if v is True or _VAN_YES.fullmatch(gsjs.js_str(v)) else "No"
        patch[col] = CW.js_cut(gsjs.trim(gsjs.or_blank(v)), APPT_CELL_MAX)
        n += 1
    if unknown:
        return None, W.refuse(422, "Not an appointment field: " + ", ".join(unknown) + ".")
    if not n:
        return None, W.refuse(400, "fields: nothing to save.")
    return patch, None


def appt_save(sess: L.Session, payload: dict) -> Decision:
    """clientProfileApptSave: the visit's row checked against its witness, the sent columns kept over it; no delete."""
    shut = CW.edit_door(sess, payload, EDITION["appointments"])
    if shut:
        return Decision(shut)
    reads = sess.reads
    ctx = CW.client_of(reads, payload.get("client"))
    if ctx.get("refused"):
        return CW.door_refused(ctx["refused"])
    rid = _text(payload.get("id"), 20)
    if not _ROW_ID.fullmatch(rid):
        return W.refuse(400, "id: the visit's row, such as r42.")
    witness = gsjs.or_text(payload.get("witness"))
    wk = name_key(witness) if gsjs.trim(witness) else ""
    if not wk or names_of(ctx).get(wk) is not True:
        return W.refuse(409, "That visit is not this client's any more — reload the appointments.", fresh=True)
    patch, bad = appt_patch(payload.get("fields"), rid, witness)
    if bad is not None:
        return bad
    if DB.held(reads, VISITS):
        return _appt_save_kept(sess, ctx, rid, witness, patch)
    # estateRoute_('drVisits', 'update')
    prop, tab = CS.ESTATE[VISITS]
    sid = reads.db.prop(prop)
    if not sid:
        raise hubdb.Unreadable(f"no {prop} is declared in the depot")
    ref = CS._tab(reads, sid, tab, "the Dr Appt Archive")
    if ref is None or not ref.headers:
        return W.refuse(500, f'The "{VISITS}" sheet could not be opened.', fresh=(sid,))
    row_num = W.estate_row_num(rid)
    if not row_num:
        return W.refuse(400, 'A row id like "r42" is required.')
    rows = reads.db.rows(ref)
    if row_num > max((rn for rn, raw in rows if _filled(raw)), default=1):
        return W.refuse(404, f'No row "{rid}" in {VISITS}.', fresh=(sid,))
    tz = CS._book_tz(reads, sid, ref)
    at = next((i for i, (rn, _raw) in enumerate(rows) if rn == row_num), None)
    raw_row = rows[at][1] if at is not None else {}
    current: dict[str, Any] = {"id": f"r{row_num}"}
    for h in ref.headers:
        k = hubdb.estate_key(h)
        if k:
            current[k] = CS._estate_cell(CS._zoned(raw_row.get(h), tz), tz)
    CW.marked(current.get(VISIT_WITNESS))
    if at is None or gsjs.trim(gsjs.or_text(current.get(VISIT_WITNESS))) != gsjs.trim(witness):
        return W.refuse(409, f'That row has moved in the "{VISITS}" sheet since you opened it — reload the screen so '
                             "you are editing the right one.", fresh=(sid,))
    heads = _estate_heads(ref)
    cells = {k: patch[k] for k in heads if k in patch}
    if not cells:
        return W.refuse(400, "Nothing to update — no known column was sent.", fresh=(sid,))
    if any(len(heads[k]) > 1 for k in cells):
        raise Defer("two columns of the Dr Appt Archive carry a key the update writes into both")
    before = {k: gsjs.or_blank(raw_row.get(heads[k][0])) for k in cells}
    fixed = [h for h in ref.headers if hubdb.estate_key(h) not in cells]
    got = W.row_key_of(rows, at, [[h for h in fixed if hubdb.estate_key(h) in VISIT_KEYS], fixed])
    if got is None:
        return W.refuse(409, W.NOT_TOLD_APART, fresh=(sid,))
    kept = W.kept_record(sid, ref.tab, "edit", got[0], got[1], ctx["key"], cells, before)
    kept["keyed"] = "estate"
    # estateReadRow_ after the write: each cell as the sheet hands back what it took
    after = dict(current)
    for k, v in cells.items():
        after[k] = CS._estate_cell(CS._zoned(v, tz), tz)
    shown = appt_row(after, ctx, reads.today())
    CW.marked(*shown.values())
    staff_views.record(sess.user, "clientProfileApptSave", ctx["key"])
    out = W.final({"status": 200, "data": {"saved": True, "row": C.scrub(shown)}}, [kept], ctx["key"],
                  CW.edition_for(sess, EDITION["appointments"]))
    # the estate's forms write this sheet too: a witness off a copy the sheet has moved past waits
    out.fresh = (sid,)
    return out


# ---- the Dr Appointments book Postgres keeps (app/dr_book.py): the pencil, a visit booked, a doctor added ------------

def _by(sess: L.Session) -> str:
    user = sess.user or {}
    return gsjs.str_(user.get("email")) or gsjs.str_(user.get("display_name"))


def _heads_of(resource: str, reads: L.Reads) -> dict[str, list[str]]:
    """estateKey_ → the kept tab's headers carrying it, in its order."""
    out: dict[str, list[str]] = {}
    for h in DB.kept(reads, resource).headers:
        k = hubdb.estate_key(h)
        if k:
            out.setdefault(k, []).append(h)
    return out


def _shown_row(reads: L.Reads, rid: str, cells: dict) -> dict[str, Any]:
    """A kept row as estateRows_ hands it: estate keys, each cell by estateCell_ on the book's clock."""
    tz = CS.dr_tz(reads, gsjs.trim(reads.db.prop(DB.PROP)))
    row: dict[str, Any] = {"id": rid}
    for h, v in cells.items():
        k = hubdb.estate_key(h)
        if k:
            row[k] = CS._estate_cell(CS._zoned(v, tz), tz)
    return row


def _placed_id(reads: L.Reads, resource: str, key: str) -> str:
    """The id r<n> a row made here answers to: its place after every other row."""
    got = RR._q(reads, f"select position from {RR.rows_of(resource)} where resource = %s and row_key = %s",
                (resource, key))
    return f"r{int(got[0][0])}" if got else ""


def _appt_save_kept(sess: L.Session, ctx: dict, rid: str, witness: str, patch: dict[str, str]) -> Decision:
    """The pencil on the visits Postgres keeps: the row r<n> checked against its witness, the sent cells changed."""
    reads = sess.reads
    hit = DB.row_at(reads, VISITS, W.estate_row_num(rid))
    if hit is None:
        return W.refuse(404, f'No row "{rid}" in {VISITS}.')
    key, held = hit
    heads = _heads_of(VISITS, reads)
    if gsjs.trim(gsjs.or_blank(held.get((heads.get(VISIT_WITNESS) or [""])[0]))) != gsjs.trim(witness):
        return W.refuse(409, "That visit has changed since you opened it — reload the appointments so you are editing "
                             "the right one.")
    cells = {k: patch[k] for k in heads if k in patch}
    if not cells:
        return W.refuse(400, "Nothing to update — no known column was sent.")
    if any(len(heads[k]) > 1 for k in cells):
        return W.refuse(409, "Two columns of the visits carry a field this change writes; nothing was saved.")
    changed = {heads[k][0]: v for k, v in cells.items() if gsjs.or_blank(held.get(heads[k][0])) != v}
    if changed:
        RR.update(reads, VISITS, key, held, changed, _by(sess))
    shown = appt_row(_shown_row(reads, rid, {**held, **changed}), ctx, reads.today())
    staff_views.record(sess.user, "clientProfileApptSave", ctx["key"])
    return Decision({"status": 200, "data": {"saved": True, "row": C.scrub(shown)}}, subject=ctx["key"], own=True,
                    edition=CW.edition_for(sess, EDITION["appointments"]))


def _fields(raw: Any, known: tuple[str, ...]) -> tuple[dict[str, str] | None, Decision | None]:
    """A new row's fields, each trimmed; a field the form does not have refused."""
    if gsjs.falsy(raw) or not isinstance(raw, dict):
        return None, W.refuse(400, "fields: what to file.")
    out: dict[str, str] = {}
    unknown: list[str] = []
    for k in _js_keys(raw):
        if k in _PROTO:
            return None, W.refuse(422, "Not a field: " + k + ".")
        if k not in known:
            unknown.append(k)
            continue
        out[k] = gsjs.trim(gsjs.or_blank(raw[k] if not isinstance(raw[k], bool) else ("Yes" if raw[k] else "No")))
    if unknown:
        return None, W.refuse(422, "Not a field of this form: " + ", ".join(unknown) + ".")
    return out, None


def _iso_day(v: str) -> str:
    """A real yyyy-MM-dd, else ''."""
    m = re.fullmatch(r"(\d{4})-(\d{2})-(\d{2})", v)
    if not m:
        return ""
    try:
        datetime(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    except ValueError:
        return ""
    return v


def _form_clock(v: str) -> str | None:
    """'14:30' as the form writes a start time ('2:30:00 PM'); '' for none; None for a time it cannot read."""
    if not v:
        return ""
    m = re.fullmatch(r"(\d{1,2}):(\d{2})(?::\d{2})?", v)
    if not m or int(m.group(1)) > 23 or int(m.group(2)) > 59:
        return None
    h, mi = int(m.group(1)), int(m.group(2))
    return f"{h % 12 or 12}:{mi:02d}:00 {'PM' if h >= 12 else 'AM'}"


def _cells_for(heads: dict[str, list[str]], values: dict[str, str]) -> tuple[dict[str, str] | None, str]:
    """The new row's cells under the kept tab's own headers, or the field whose column it lacks."""
    out: dict[str, str] = {}
    for k, v in values.items():
        if not v:
            continue
        if k not in heads:
            return None, k
        out[heads[k][0]] = v
    return out, ""


def appt_add(sess: L.Session, payload: dict) -> Decision:
    """clientProfileApptAdd: a visit booked for the client, a new row of the visits Postgres keeps, as the book's form
    filed one (its time stamp on the book's clock, the person who filed it as the manager)."""
    shut = CW.edit_door(sess, payload, EDITION["appointments"])
    if shut:
        return Decision(shut)
    reads = sess.reads
    if not DB.held(reads, VISITS):
        return Decision(NOT_KEPT)
    ctx = CW.client_of(reads, payload.get("client"))
    if ctx.get("refused"):
        return CW.door_refused(ctx["refused"])
    got, bad = _fields(payload.get("fields"), NEW_VISIT_FIELDS)
    if bad is not None:
        return bad
    day = _iso_day(got.get("date", ""))
    if not day:
        return W.refuse(400, "date: the day of the visit, such as 2026-11-20.")
    dr = CW.js_cut(got.get("dr_name", ""), APPT_CELL_MAX)
    if not dr:
        return W.refuse(400, "dr_name: the doctor the visit is with.")
    clock = _form_clock(got.get("time", ""))
    if clock is None:
        return W.refuse(400, "time: the start time, such as 14:30.")
    van = got.get("van", "")
    if van and van not in ("Yes", "No"):
        return W.refuse(400, "van: Yes or No.")
    names = names_of(ctx)
    for _p, c in DB.kept(reads, VISITS).rows:
        row = _shown_row(reads, "", c)
        if names.get(name_key(gsjs.or_blank(row.get("client_name")))) is True and \
                C.cp_day(row.get("appointment_date")) == day and name_key(row.get("dr_name")) == name_key(dr) and \
                CS.appt_clock(row.get("appointment_start_time"))["label"] == CS.appt_clock(clock)["label"]:
            return W.refuse(409, "This visit is already booked for the client.", data={"duplicate": True})
    tz = CS.dr_tz(reads, gsjs.trim(reads.db.prop(DB.PROP)))
    now = reads.now.astimezone(tz)
    y, m, d = day.split("-")
    user = sess.user or {}
    cells, missing = _cells_for(_heads_of(VISITS, reads), {
        "timestamp": f"{now.month}/{now.day}/{now.year} {now.hour}:{now.minute:02d}:{now.second:02d}",
        "client_name": ctx["name"], "dr_name": dr, "appointment_date": f"{int(m)}/{int(d)}/{y}",
        "appointment_start_time": clock, "appointment_address": CW.js_cut(got.get("dr_address", ""), APPT_CELL_MAX),
        "wheelchair_van_required": van or "No",
        "manager": gsjs.str_(user.get("display_name")) or gsjs.str_(user.get("email"))})
    if cells is None:
        return W.refuse(500, f"The visits have no column for {missing}; nothing was booked.")
    key = RR.create(reads, VISITS, cells, _by(sess))
    rid = _placed_id(reads, VISITS, key)
    shown = appt_row(_shown_row(reads, rid, cells), ctx, reads.today())
    staff_views.record(sess.user, "clientProfileApptAdd", ctx["key"])
    return Decision({"status": 200, "data": {"saved": True, "row": C.scrub(shown)}}, subject=ctx["key"], own=True,
                    edition=CW.edition_for(sess, EDITION["appointments"]))


def doctor_add(sess: L.Session, payload: dict) -> Decision:
    """clientProfileDoctorAdd: a doctor added to the client's doctors on file, a new Active row of the doctors Postgres
    keeps; the same doctor already Active for the client is refused."""
    shut = CW.edit_door(sess, payload, EDITION["doctors"])
    if shut:
        return Decision(shut)
    reads = sess.reads
    if not DB.held(reads, DOCTORS):
        return Decision(NOT_KEPT)
    ctx = CW.client_of(reads, payload.get("client"))
    if ctx.get("refused"):
        return CW.door_refused(ctx["refused"])
    got, bad = _fields(payload.get("fields"), NEW_DOCTOR_FIELDS)
    if bad is not None:
        return bad
    dr = CW.js_cut(got.get("dr_name", ""), APPT_CELL_MAX)
    if not dr:
        return W.refuse(400, "dr_name: the doctor's name.")
    names = names_of(ctx)
    for _p, c in DB.kept(reads, DOCTORS).rows:
        row = _shown_row(reads, "", c)
        if names.get(name_key(gsjs.or_blank(row.get("client")))) is True \
                and name_key(row.get("dr_name")) == name_key(dr) \
                and re.fullmatch(r"active", gsjs.trim(gsjs.or_blank(row.get("status"))), re.I):
            return W.refuse(409, f"{dr} is already on file for the client.", data={"duplicate": True})
    values = {k: CW.js_cut(got.get(k, ""), NOTES_MAX if k == "notes" else APPT_CELL_MAX) for k in NEW_DOCTOR_FIELDS}
    cells, missing = _cells_for(_heads_of(DOCTORS, reads), {**values, "dr_name": dr, "client": ctx["name"],
                                                            "status": "Active"})
    if cells is None:
        return W.refuse(500, f"The doctors on file have no column for {missing}; nothing was added.")
    key = RR.create(reads, DOCTORS, cells, _by(sess))
    doctor = CS._appt_doctor(_shown_row(reads, _placed_id(reads, DOCTORS, key), cells))
    staff_views.record(sess.user, "clientProfileDoctorAdd", ctx["key"])
    return Decision({"status": 200, "data": {"saved": True, "doctor": C.scrub(doctor)}}, subject=ctx["key"], own=True,
                    edition=CW.edition_for(sess, EDITION["doctors"]))


# ---- a new incident report (route('uiIncidents', 'create')) ---------------------------------------------------------

def sheet_shows(v: str) -> str:
    """The text the Timestamp column shows once the bridge enters a cell: an instant as its New York wall clock to the
    second, as the tab's own form rows read; anything else as written."""
    s = gsjs.trim(v)
    if not _ISO_Z.match(s):
        return s
    try:
        at = datetime.fromisoformat(s.replace("Z", "+00:00")).astimezone(NY)
    except ValueError:
        return s
    return f"{at.month}/{at.day}/{at.year} {at.hour}:{at.minute:02d}:{at.second:02d}"


def file_gate(reads: L.Reads, rec: dict, user: dict) -> Decision | None:
    """estateFileGate_: a non-writer's report keeps the form's columns alone, filed under their own name; a client's names
    them, or is refused 404 (never 403: a refusal must not say whether the client is on file)."""
    if not user or user.get("is_service") or gsjs.str_(user.get("role")) not in FILE_ROLES:
        return Decision({"status": 403, "message": "Filing is for clients, staff, managers and admins."})
    for k in list(rec):
        if k not in FILE_COLUMNS:
            rec.pop(k)
    rec["your_name"] = gsjs.str_(user.get("display_name")) or gsjs.str_(user.get("email"))
    counts = sc.role_counts(user.get("types"), user.get("role"))
    if gsjs.str_(user.get("role")) != "client" and counts:
        return None
    none = Decision({"status": 404, "message": f'No "{INCIDENTS}" record here.'}, fresh=True)
    if not counts:
        # an SSA or a FAMILY, whatever its role says: the report names one of the clients its Clients scope holds
        for key in sorted(k for k in ((C.reader(L.Session(reads, user)) or {}).get("keys") or {}) if k):
            if DR._theirs(rec, key, DR._client_names(reads, key)):
                return None
        return none
    key = gsjs.str_(user.get("client_key"))
    me = next((c for c in C.derived(reads) if gsjs.str_(c.get("client_key")) == key), None) if key else None
    if me is None:
        return none
    rec["client_name"] = gsjs.str_(me.get("name"))
    # hubClientRowGate_: the report names this client
    return None if DR._theirs(rec, key, DR._client_names(reads, key)) else none


def file_incident(sess: L.Session, rec: dict) -> Decision:
    """estateRoute_ create: the report's columns laid on the sheet's headers by estateKey_, kept as one new row."""
    reads, user = sess.reads, sess.user or {}
    if not CW.writer(user):
        refused = file_gate(reads, rec, user)
        if refused is not None:
            return refused
    prop, tab = L.ESTATE_SOURCES[INCIDENTS]
    sid = reads.db.prop(prop)
    if not sid:
        raise hubdb.Unreadable(f"no {prop} is declared in the depot")
    ref = reads.tab_of(sid, tab, f"the estate's {tab}")
    if ref is None or not ref.headers:
        return W.refuse(500, f'The "{INCIDENTS}" sheet could not be opened.', fresh=(sid,))
    cells: dict[str, str] = {}
    for h in ref.headers:
        k = hubdb.estate_key(h)
        if not k or k not in rec:
            continue
        v = rec[k]
        if isinstance(v, (dict, list)):
            raise Defer("a cell the report sends as an object")
        cells[gsjs.trim(gsjs.js_str(h))] = W.sheet_text(v)
    if not any(cells.values()):
        raise Defer("a report with no cell of the sheet's")
    heads = _estate_heads(ref)
    if any(k not in heads for k in INCIDENT_KEYS):
        raise Defer(f"the {tab} tab lost a column its rows are found by")
    match_heads = [heads[k][0] for k in INCIDENT_KEYS]
    parts = [gsjs.trim(cells.get(gsjs.trim(gsjs.js_str(h)), "")) for h in match_heads]
    parts[0] = sheet_shows(parts[0])
    # the cell keeps the time as the sheet shows it, so the key the row is found by holds before the sync and after
    ts_head = gsjs.trim(gsjs.js_str(match_heads[0]))
    if ts_head in cells:
        cells[ts_head] = parts[0]
    key = "\x1f".join(parts)
    match = W.COLS + W.COLS_SEP.join(gsjs.trim(gsjs.js_str(h)) for h in match_heads)
    if not any(parts):
        raise Defer("a report with nothing its row is found by")
    rows = reads.db.rows(ref)
    own = hubdb.OWN.get()
    kept_rows = (getattr(own, "edits", None) or {}).get((sid, ref.tab)) or ()
    if any(W.cols_key(raw, match_heads) == key for _rn, raw in rows) or \
            any(g["match"] == match and g["row_key"] == key for g in kept_rows):
        raise Defer("another report already carries this one's time, author and client")
    # estateReadRow_ of the row appended: the next row past the last one the sheet holds
    nxt = max((rn for rn, raw in rows if _filled(raw)), default=1) + 1
    row: dict[str, Any] = {"id": f"r{nxt}"}
    for h in ref.headers:
        k = hubdb.estate_key(h)
        if k:
            row[k] = hubdb.estate_cell(hubdb.typed(cells.get(gsjs.trim(gsjs.js_str(h)), ""), "estate"))
    nk = name_key(rec.get("client_name"))
    rows_c, _why = L._soft(lambda: C.derived(reads))
    subject = next((gsjs.trim(gsjs.or_text(c.get("client_key"))) for c in rows_c or []
                    if nk and name_key(c.get("name")) == nk), "")
    kept = W.kept_record(sid, ref.tab, "append", match, key, subject, cells)
    return W.final({"status": 200, "data": row}, [kept], subject)


def ui_incidents_create(sess: L.Session, payload: dict) -> Decision:
    """route('uiIncidents', 'create'), and the line doPost writes for every generic write."""
    rec = dict(payload) if isinstance(payload, dict) else {}
    out = file_incident(sess, rec)
    if out.edits:
        # estateRoute_'s create raises every incident on Support Requests (supportDeskIncidents_), in this write
        out.edits = out.edits + W.incident_raised(sess.reads, out.answer["data"])
    staff_views.record(sess.user, f"{INCIDENTS}.create", gsjs.str_(rec.get("id")))
    return out


WRITE_ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {
    "clientProfileIncidentStatus": incident_status, "clientProfileApptSave": appt_save,
    "clientProfileApptAdd": appt_add, "clientProfileDoctorAdd": doctor_add, "uiIncidentsCreate": ui_incidents_create,
}
_WRITERS = ("admin", "manager")
# an edition's holders are employees (editions.EDITION_ROLES)
_EMPLOYEES = ("admin", "manager", "staff")
# HUB_POLICY: the roles each write is declared for, and its typed params; the generic verb declares none
POLICY: dict[str, dict[str, Any]] = {
    "clientProfileIncidentStatus": {"roles": _WRITERS, "params": {"client": "string", "incident_ts": "string",
                                                                  "client_name": "string", "status": "string"}},
    "clientProfileApptSave": {"roles": _EMPLOYEES, "params": {"client": "string", "id": "string", "witness": "string"}},
    "clientProfileApptAdd": {"roles": _EMPLOYEES, "params": {"client": "string", "fields": "object"}},
    "clientProfileDoctorAdd": {"roles": _EMPLOYEES, "params": {"client": "string", "fields": "object"}},
    "uiIncidentsCreate": {},
}
# the answer each door gives while the lock is held: locationsLock_'s, and estateRoute_'s own
BUSY_OF: dict[str, dict[str, Any]] = {
    "clientProfileIncidentStatus": {"status": 409, "message": W.BUSY},
    "clientProfileApptSave": SHEET_BUSY, "uiIncidentsCreate": SHEET_BUSY,
    "clientProfileApptAdd": {"status": 409, "message": W.BUSY},
    "clientProfileDoctorAdd": {"status": 409, "message": W.BUSY},
}
