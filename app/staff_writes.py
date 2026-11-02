"""Staff's writes (apps-script/StaffProfiles.gs) decided off asa-hub-db: the edits and notes kept in app.edits as…"""
from __future__ import annotations

import re
from datetime import date
from typing import Any, Callable

import book_ops as BO
import client_writes as CW
import gsjs
import house_tables as HT
import hubdb
import ist as IST
import ist_writes as IW
import locations as L
import photos as P
import resource_rows as RR
import scope as sc
import staff as SP
import staff_views
import writes as W
from gsjs import NY, name_key
from scope import Defer
from writes import Decision

APP_ID = SP.APP_ID
NOTE_CATEGORIES = ("general", "performance", "training", "scheduling", "hr")
NOTE_PRIORITIES = ("low", "normal", "high", "urgent")
NOTE_STATES = ("open", "resolved")
NOTE_MAX = 4000
NOTE_EDIT_FIELDS = ("category", "priority", "details")
NOTE_FOLDED = {"category": "general", "priority": "normal"}
IST_TAB = "ist_records"
IST_EDIT = {"status": "status", "due": "dueDate", "trained_at": "trainedAt"}
IST_STATUSES = ("owed", "done")
RENAME_FIELDS = ("first_name", "last_name")
DRIVING_EDIT = {"driver": (SP.DRIVER_TAB, "driver"), "points": (SP.DRIVER_TAB, "points"),
                "license_exp": (SP.DRIVER_TAB, "license_exp"),
                "abstract_original": (SP.DRIVER_TAB, "abstract_original"),
                "abstract_latest": (SP.DRIVER_TAB, "abstract_latest"),
                "insurance_exp": (SP.DRIVER_TAB, "insurance_exp"), "standing": (SP.DRIVER_COMPLIANCE_TAB, "driver")}
MAIS_EDIT = ("status", "effective", "expires")
HR_SEVERITIES = ("Coaching", "Verbal warning", "Written warning", "Final warning")
HR_CATEGORIES = ("Conflict", "Dress code", "Attendance", "Conduct", "Documentation", "Other compliance")
# StaffIssues.gs STAFF_ISSUE_SOURCE (not the Employee Database's Master) and SP_HR_UNDER_REVIEW
HR_SOURCE = ("ESTATE_HR_ID", "Master")
HR_UNDER_REVIEW = "Under review"
ADDRESS_WORDS = {
    **SP.ADDRESS_WORDS,
    "only": "Only the street address, city, state and zip are changed here.",
    "blank": "A blank value is not saved here — HR clears it.",
    "address": "A street address: up to 120 characters, with a letter in it.",
    "city": "A city name: letters, spaces, periods, apostrophes and hyphens.",
    "state": "A two-letter US state, such as OH.",
    "zip": "A 5-digit zip, or ZIP+4 (12345-6789)."}
STALE_ALL = CW.STALE_ALL
PREFS_STALE = "Changed since the section was opened — reloaded, nothing was written."
NOTES_HEADER = ("id", "staff_key", "staff_name", "category", "priority", "details", "state", "by", "at", "state_by",
                "state_at")
PREFS_FIELDS = ("shifts", "unavailable_days", "unavailable_locations", "other_locations", "allergies")
LOGIN_ELSEWHERE = ("The sign-in e-mail is changed in Settings › Users: signing in reads the accounts sheet, which an "
                   "edit kept in the Hub's database does not reach.")
NOT_TOLD_APART = "cannot be told apart from another row, so nothing is written there."
RENAME_SETTLING = ("The last rename of this person is still being written into the books; try again in a few minutes "
                   "— nothing was renamed.")
CACHES = "Staff reads it from Postgres at once; the relay read this staff member again."
IST_HEADER_STAMP = "updatedAt"
UNKNOWN = "Unknown action."
_KEY = re.compile(r"[a-z0-9]{3,80}")
_DAY = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}")
_CITY = re.compile("[A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ .'’-]{0,59}")
# the refusals spEditRefusal_ and spEditionShut_ give from the field alone, never from a record
_STATIC = (frozenset(SP.EDIT_LOCKED.values()) | {"Not a field this app edits.", SP.EDITION_NOT_HELD, LOGIN_ELSEWHERE,
                                                   "A photo is an https:// link."}
           | frozenset(SP.EDIT_MASTER_ONLY.values()))


# ---- what JavaScript does to a value ---------------------------------------------------------------------------------

def sp_text(v: Any, n: int = 0) -> str:
    """spText_: JavaScript's whitespace runs as one space, trimmed, cut to n UTF-16 units."""
    s = gsjs.trim(CW.fold_ws(gsjs.or_blank(v)))
    return CW.js_cut(s, n) if n else s


def trimmed(v: Any) -> str:
    """String(v || '').trim()."""
    return gsjs.trim(gsjs.or_text(v))


def u16(s: str) -> int:
    return CW.utf16_len(s)


# ---- the doors' shared answers ---------------------------------------------------------------------------------------

def refused(env: dict[str, Any]) -> Decision:
    """A door's refusal: what this side could not read is Apps Script's to answer; one resting on a record is fresh."""
    if env.get("status") == 503:
        raise Defer(str(env.get("message") or "the staff sources could not be read")[:160])
    static = env.get("status") == 400 or env.get("message") == UNKNOWN
    return Decision(env, fresh=not static)


def master_shut(sess: L.Session) -> Decision | None:
    """staffProfilesMaster_: the writes are the master's in its own session."""
    return None if sc.is_real_master(sess.user) else Decision(SP.unknown())


def edit_door(sess: L.Session, ids: tuple | list) -> Decision | None:
    """spEditDoor_: the master; else a holder of one of `ids` who reads every staff member whole."""
    if sc.is_real_master(sess.user):
        return None
    if not SP.editions_held(sess.reads, sess.user, ids):
        return Decision(SP.unknown())
    return None if SP.whole_gate(sess) else Decision(SP.unknown())


def edit_answer(refused_: list[dict], stale: dict[str, str]) -> dict[str, Any]:
    """spEditAnswer_ with nothing written: a 409 carrying what a stale field holds now."""
    data: dict[str, Any] = {"written": [], "refused": refused_}
    if stale:
        data["current"] = dict(stale)
        return {"status": 409, "data": data, "message": STALE_ALL}
    return {"status": 200, "data": data}


def kept_answer(written: list[dict], refused_: list[dict], stale: dict[str, str], words: str) -> dict[str, Any]:
    """spEditAnswer_ for an edit kept in app.edits: the Apply strip's steps once a field stood."""
    return W.edit_answer(written, refused_, stale, W.pg_steps(words, CACHES, APP_ID))


def edition_of(sess: L.Session, ids: tuple | list) -> str:
    """The edition that let a holder in ('' for the master): the first of `ids` it holds."""
    if sc.is_real_master(sess.user):
        return ""
    held = SP.editions_held(sess.reads, sess.user, ids)
    return held[0] if held else ""


def field_edition(sess: L.Session, field: str) -> str:
    """The record edition whose fields open `field` to a holder; '' for the master."""
    return edition_of(sess, tuple(e for e, fields in SP.EDITION_FIELDS.items() if field in fields))


def settled(answer: dict[str, Any], edits: list[dict], key: str, book: tuple) -> Decision:
    """A door's answer: kept final when a cell stood, else as it stands, resting on the book's rows."""
    if any(e.get("cells") for e in edits):
        return W.final(answer, edits, key)
    return Decision(answer, fresh=book)


def person_of(sess: L.Session, raw: Any) -> dict[str, Any]:
    return SP.person_for(sess, raw)


def unread(why: str, ctx: dict) -> bool:
    """A refusal naming a source this side failed to read: its words are Apps Script's."""
    return bool(why) and why in (ctx.get("master_why"), ctx.get("account_why")) and "could not be read" in why


def marked(*vals: Any) -> None:
    if any(SP._marker(v) for v in vals):
        raise Defer("the copy withholds a cell this decision rests on")


# ---- notes (staffProfileNoteAdd, staffProfileNoteState) --------------------------------------------------------------

def note_fields(payload: dict, default_category: str | None) -> Decision | dict[str, str]:
    """The note's details, category and priority, or the door's 400."""
    details = trimmed(payload.get("details"))
    if not details:
        return W.refuse(400, "details: what the note says." if default_category else
                        "details: the training and its instructions.")
    if u16(details) > NOTE_MAX:
        return W.refuse(400, "details: up to 4000 characters.")
    out = {"details": details}
    if default_category:
        category = sp_text(payload.get("category")).lower() or default_category
        if category not in NOTE_CATEGORIES:
            return W.refuse(400, "category: one of " + ", ".join(NOTE_CATEGORIES) + ".")
        out["category"] = category
    priority = sp_text(payload.get("priority")).lower() or "normal"
    if priority not in NOTE_PRIORITIES:
        return W.refuse(400, "priority: one of " + ", ".join(NOTE_PRIORITIES) + ".")
    out["priority"] = priority
    return out


def note_add(sess: L.Session, payload: dict) -> Decision:
    """staffProfileNoteAdd: refused here, or the note (its id and time minted here) kept in app.edits."""
    shut = edit_door(sess, (SP.EDITION_NOTES,))
    if shut:
        return shut
    reads = sess.reads
    ctx = person_of(sess, payload.get("staff"))
    if ctx.get("refused"):
        return refused(ctx["refused"])
    got = note_fields(payload, "general")
    if isinstance(got, Decision):
        return got
    W.gate(reads)
    res = W.tab_of(reads, SP.NOTES_TAB)
    note = {"id": W.mint("SN_"), "staff_key": ctx["key"], "staff_name": ctx["name"], "category": got["category"],
            "priority": got["priority"], "details": got["details"], "state": "open", "by": W.who(sess.user),
            "at": W.now_iso(reads), "state_by": "", "state_at": ""}
    rec = W.append_record(res, NOTES_HEADER, note, ctx["key"])
    rec["edition"] = edition_of(sess, (SP.EDITION_NOTES,))
    return W.final({"status": 200, "data": {"note": note}}, [rec], ctx["key"])


def note_state(sess: L.Session, payload: dict) -> Decision:
    """staffProfileNoteState: refused here, or the three cells kept in app.edits."""
    shut = edit_door(sess, (SP.EDITION_NOTES,))
    if shut:
        return shut
    reads = sess.reads
    nid = sp_text(payload.get("id"), 80)
    state = sp_text(payload.get("state")).lower()
    witness = trimmed(payload.get("staff"))
    if not nid:
        return W.refuse(400, "id: which note.")
    if state not in NOTE_STATES:
        return W.refuse(400, "state: open or resolved.")
    if not _KEY.fullmatch(witness):
        return W.refuse(400, "staff: a staff key.")
    # Staff's own-profile rule (own_only): the witness is held to the note's own key below
    own = SP.own_only(sess)
    if own is not None and witness != own:
        return refused({"status": 403, "message": SP.OWN_ONLY_WORDS})
    W.gate(reads)
    res = W.tab_of(reads, SP.NOTES_TAB)
    book = (res.sheet_id,)
    row = W.row_by_id(reads.db.locations_rows(res.ref), nid) if res.ref is not None else None
    if row is None:
        return W.refuse(404, f'No staff note "{nid}".', fresh=book)
    key = trimmed(row.get("staff_key"))
    marked(key)
    if key != witness:
        return W.refuse(409, "That note belongs to another staff member — reload the profile.", fresh=book)
    sid, tab = W.where_of(res)
    cells = {"state": state, "state_by": W.who(sess.user), "state_at": W.now_iso(reads)}
    before = {"state": trimmed(row.get("state")), "state_by": trimmed(row.get("state_by")),
              "state_at": trimmed(row.get("state_at"))}
    rec = W.kept_record(sid, tab, "edit", "id", nid, key, cells, before, edition_of(sess, (SP.EDITION_NOTES,)))
    return W.final({"status": 200, "data": {"note": {"id": nid, "staff_key": key, **cells}}}, [rec], key)


def note_edit(sess: L.Session, payload: dict) -> Decision:
    """staffProfileNoteEdit (Python's own): a note's category, priority or text kept in app.edits; who and when stay."""
    shut = edit_door(sess, (SP.EDITION_NOTES_EDIT,))
    if shut:
        return shut
    reads = sess.reads
    nid = sp_text(payload.get("id"), 80)
    witness = trimmed(payload.get("staff"))
    if not nid:
        return W.refuse(400, "id: which note.")
    if not _KEY.fullmatch(witness):
        return W.refuse(400, "staff: a staff key.")
    # Staff's own-profile rule (own_only): the witness is held to the note's own key below
    own = SP.own_only(sess)
    if own is not None and witness != own:
        return refused({"status": 403, "message": SP.OWN_ONLY_WORDS})
    changes, bad = W.edit_changes(payload)
    if bad:
        return Decision(bad)
    W.gate(reads)
    res = W.tab_of(reads, SP.NOTES_TAB)
    book = (res.sheet_id,)
    row = W.row_by_id(reads.db.locations_rows(res.ref), nid) if res.ref is not None else None
    if row is None:
        return W.refuse(404, f'No staff note "{nid}".', fresh=book)
    key = trimmed(row.get("staff_key"))
    marked(key)
    if key != witness:
        return W.refuse(409, "That note belongs to another staff member — reload the profile.", fresh=book)

    def live(f: str) -> str:
        v = trimmed(row.get(f))
        return (v.lower() or NOTE_FOLDED[f]) if f in NOTE_FOLDED else v

    written: list[dict] = []
    out: list[dict] = []
    stale: dict[str, str] = {}
    cells: dict[str, str] = {}
    before: dict[str, str] = {}
    for c in changes:
        f = c["field"]
        if f not in NOTE_EDIT_FIELDS:
            out.append({"field": f, "why": "Not a field of a staff note."})
            continue
        marked(row.get(f))
        was = live(f)
        folded = f in NOTE_FOLDED
        expected = trimmed(c["expected"])
        if (expected.lower() if folded else expected) != was:
            stale[f] = was
            continue
        value = c["value"].lower() if folded else c["value"]
        if f == "details" and not value:
            out.append({"field": f, "why": "A note says something; resolve it instead."})
            continue
        if f == "details" and u16(value) > NOTE_MAX:
            out.append({"field": f, "why": "Up to 4000 characters."})
            continue
        if f == "category" and value not in NOTE_CATEGORIES:
            out.append({"field": f, "why": "One of " + ", ".join(NOTE_CATEGORIES) + "."})
            continue
        if f == "priority" and value not in NOTE_PRIORITIES:
            out.append({"field": f, "why": "One of " + ", ".join(NOTE_PRIORITIES) + "."})
            continue
        cells[f], before[f] = value, gsjs.or_text(row.get(f))
        written.append({"field": f, "before": was, "after": value})
    answer = kept_answer(written, out, stale, "The staff note's cells, kept in the Hub's database.")
    if not cells:
        return Decision(answer, fresh=book if stale else False)
    sid, tab = W.where_of(res)
    rec = W.kept_record(sid, tab, "edit", "id", nid, key, cells, before, edition_of(sess, (SP.EDITION_NOTES_EDIT,)))
    return W.final(answer, [rec], key)


# ---- training (staffProfileAssignTraining) ---------------------------------------------------------------------------

def ist_house_map(reads: L.Reads) -> dict[str, list[str]]:
    """istHouseMap_: house → the client names the map puts there (IST Records' own, app/ist.py)."""
    return IST.house_map(reads)


def assign_training(sess: L.Session, payload: dict) -> Decision:
    """staffProfileAssignTraining: refused here; or a training request, a note kept in app.edits; or an IST record for
    every client of the house, written where the IST records live."""
    reads, user = sess.reads, sess.user
    if not SP.training_assigner(reads, user, payload.get("staff")):
        return Decision(SP.unknown())
    ctx = person_of(sess, payload.get("staff"))
    if ctx.get("refused"):
        return refused(ctx["refused"])
    if not sp_text(payload.get("house")):
        return training_request(sess, ctx, payload)
    if SP.training_assigner(reads, user, ctx["key"]) == "self":
        return W.refuse(403, "An IST at a house is assigned by a manager.")
    due = sp_text(payload.get("due_date"), 20)
    if due and not _DAY.fullmatch(due):
        return W.refuse(400, "due_date: a day as yyyy-MM-dd.")
    hx = L.house(reads, payload.get("house"))
    if hx.get("refused"):
        return refused(hx["refused"])
    mapped = ist_house_map(reads).get(hx["code"]) or []
    clients, unplaced = [], []
    if mapped:
        for nm in mapped:
            hit = next((c for c in hx["all_clients"] if name_key(c.get("name")) == name_key(nm)), None)
            if hit is not None:
                clients.append(hit)
            else:
                unplaced.append(sp_text(nm))
    else:
        clients = hx["clients"]
    if not clients:
        if hx.get("clients_why"):
            raise Defer("the clients could not be read here")
        tail = f" ({len(unplaced)} mapped name(s) match no client record.)" if unplaced else ""
        return W.refuse(409, hx["code"] + " has no clients mapped — set them in Settings → IST first." + tail,
                        fresh=True)
    return assign_ist(sess, ctx, hx, clients, unplaced, due)


def training_request(sess: L.Session, ctx: dict, payload: dict) -> Decision:
    """spTrainingRequest_: a 'training' note on the person, open until it is resolved, kept in app.edits."""
    got = note_fields(payload, None)
    if isinstance(got, Decision):
        return got
    reads = sess.reads
    W.gate(reads)
    res = W.tab_of(reads, SP.NOTES_TAB)
    note = {"id": W.mint("SN_"), "staff_key": ctx["key"], "staff_name": ctx["name"], "category": "training",
            "priority": got["priority"], "details": got["details"], "state": "open", "by": W.who(sess.user),
            "at": W.now_iso(reads), "state_by": "", "state_at": ""}
    staff_views.record(sess.user, "staffProfileAssignTraining", ctx["key"])
    return W.final({"status": 200, "data": {"note": note}}, [W.append_record(res, NOTES_HEADER, note, ctx["key"])],
                   ctx["key"])


def assign_ist(sess: L.Session, ctx: dict, hx: dict, clients: list[dict], unplaced: list[str], due: str) -> Decision:
    """staffProfileAssignTraining at a house: a record for every client there the person does not hold one for yet — in
    Postgres once the IST records live there, else appended in app.edits over the ist_records tab."""
    reads = sess.reads
    owned = IST.owned(reads.db)
    if not owned:
        W.gate(reads)
        sid, tab = W.where_of(W.tab_of(reads, IST.RECORDS_TAB))
    by = gsjs.str_((sess.user or {}).get("email"))
    edits: list[dict] = []
    have = {IST.pair_key(r.get("staffName"), r.get("clientName")): r for r in IST.records(reads)}
    note = IST.cert_note(reads, IST.cfg(reads), ctx["key"], reads.now.timestamp() * 1000.0)
    p, a, m = ctx.get("people") or {}, ctx.get("account") or {}, ctx.get("master") or {}
    today = reads.today()
    created: list[dict] = []
    already: list[dict] = []
    for c in clients:
        was = have.get(IST.pair_key(ctx["name"], c.get("name")))
        if was is not None:
            already.append({"client_name": sp_text(c.get("name")),
                            "status": L.cell(was.get("status")).lower() or IST.STATUS_OWED,
                            "house": L.house_code(was.get("house")) or sp_text(was.get("house"))})
            continue
        fields = {
            "staffName": ctx["name"], "staffEmail": gsjs.or_text(p.get("email") or a.get("email") or m.get("email")),
            "staffPhone": gsjs.or_text(p.get("phone") or a.get("phone") or m.get("phone")),
            "avatar": gsjs.or_text(a.get("avatar") or p.get("avatar")), "clientName": sp_text(c.get("name")),
            "house": hx["code"], "dueDate": due or IST.latest_date([today, gsjs.or_text(c.get("start_date"))]),
            "status": IST.STATUS_OWED, "certNote": note, "trainedAt": "", "trainedBy": "", "notifiedAt": "",
            "notifyCount": "0", "remindRequested": ""}
        if owned:
            rec = IST.create(reads, IST.RECORDS, fields, by)
        else:
            # createRow_'s row: its id minted and stamped here
            rec = IST._record(fields, W.now_iso(reads))
            edits.append(W.kept_record(sid, tab, "append", "id", rec["id"], ctx["key"], rec))
        created.append({"id": rec["id"], "client_name": rec["clientName"], "due": rec["dueDate"]})
    staff_views.record(sess.user, "staffProfileAssignTraining", ctx["key"])
    answer = {"status": 200, "data": {"house": hx["code"], "created": created, "already": already,
                                      "unplaced": unplaced}}
    if owned:
        return Decision(answer, subject=ctx["key"], own=True)
    return W.final(answer, edits, ctx["key"])


# ---- an HR issue (staffProfileHrIssueAdd, then staffIssueAdd) ---------------------------------------------------------

def issue_day_ok(day: str) -> bool:
    """staffIssueDay_ on a yyyy-MM-dd day: a calendar day JavaScript's Date keeps (a two-digit year it does not)."""
    y, m, d = (int(x) for x in day.split("-"))
    if y < 100:
        return False
    try:
        date(y, m, d)
    except ValueError:
        return False
    return True


def hr_tracker(reads: L.Reads) -> tuple[str, hubdb.TabRef, dict[str, str]]:
    """staffIssueSheet_: the HR tracker's tab and the header each of its fields is written under (estateKey_)."""
    prop, tab = HR_SOURCE
    sid = reads.db.prop(prop)
    if not sid:
        raise hubdb.Unreadable(f"no {prop} is declared in the depot, so the HR tracker is not read here")
    ref = HT.tab_of(reads, sid, tab, "the HR tracker")
    if ref is None or not ref.headers:
        raise hubdb.Unreadable(f'the HR tracker has no "{tab}" tab with a header row in asa-hub-db')
    heads: dict[str, str] = {}
    for h in ref.headers:
        k = hubdb.estate_key(h)
        if k and k not in heads:
            heads[k] = gsjs.trim(gsjs.js_str(h))
    return sid, ref, heads


def hr_issue_add(sess: L.Session, payload: dict) -> Decision:
    """staffProfileHrIssueAdd, then staffIssueAdd: refused here, or the tracker's row kept in app.edits, final."""
    shut = edit_door(sess, (SP.EDITION_HR_ISSUES,))
    if shut:
        return shut
    ctx = person_of(sess, payload.get("staff"))
    if ctx.get("refused"):
        return refused(ctx["refused"])
    day = sp_text(payload.get("date"), 20)
    if not _DAY.fullmatch(day):
        return W.refuse(400, "date: the incident day as yyyy-MM-dd.")
    if day > sess.reads.today():
        return W.refuse(400, "date: the day it happened, never a later one.")

    def pick(options: tuple, raw: Any) -> str:
        want = sp_text(raw).lower()
        return next((x for x in options if x.lower() == want), "")

    if not pick(HR_SEVERITIES, payload.get("severity")):
        return W.refuse(400, "severity: one of " + ", ".join(HR_SEVERITIES) + ".")
    if not pick(HR_CATEGORIES, payload.get("category")):
        return W.refuse(400, "category: one of " + ", ".join(HR_CATEGORIES) + ".")
    summary = sp_text(payload.get("summary"))
    if not summary:
        return W.refuse(400, "summary: one line naming the concern.")
    if u16(summary) > 200:
        return W.refuse(400, "summary: up to 200 characters.")
    details = trimmed(payload.get("details"))
    if not details:
        return W.refuse(400, "details: what was reported.")
    if u16(details) > 4000:
        return W.refuse(400, "details: up to 4000 characters.")
    if u16(trimmed(payload.get("action"))) > 2000:
        return W.refuse(400, "action: up to 2000 characters.")
    review = sp_text(payload.get("next_review"), 20)
    if review and not _DAY.fullmatch(review):
        return W.refuse(400, "next_review: a day as yyyy-MM-dd.")
    if not issue_day_ok(day):
        return W.refuse(400, "The date must be a calendar day (yyyy-mm-dd) — the tracker keeps them as M/D/YYYY and "
                             "sorts on that shape.")
    reads = sess.reads
    W.gate(reads)
    sid, ref, heads = hr_tracker(reads)
    y, m, d = (int(x) for x in day.split("-"))
    category = pick(HR_CATEGORIES, payload.get("category"))
    severity = pick(HR_SEVERITIES, payload.get("severity"))
    action = trimmed(payload.get("action"))
    values = {"date": f"{m}/{d}/{y}", "employees_involved": ctx["name"][:500],
              "situation": "\n".join([summary, details, "Category: " + category, "Severity: " + severity])[:4000],
              "follow_up": "\n".join(x for x in (action, "Next review: " + review if review else "") if x)[:4000],
              "result": HR_UNDER_REVIEW}
    # a value whose column is gone is refused, never dropped
    missing = [k for k, v in values.items() if v and k not in heads]
    if missing:
        return W.refuse(409, "The HR tracker no longer has a column for: " + ", ".join(missing) + ". Nothing was "
                             "written — the sheet's headers moved and the Hub will not guess where these belong.")
    cells = {heads[k]: v for k, v in values.items() if v}
    match_heads = (heads["employees_involved"], heads["situation"])
    row_key = "\x1f".join(gsjs.trim(cells[h]) for h in match_heads)
    rec = W.kept_record(sid, ref.tab, "append", W.COLS + W.COLS_SEP.join(match_heads), row_key, ctx["key"], cells,
                        edition=edition_of(sess, (SP.EDITION_HR_ISSUES,)))
    answer = {"status": 200, "data": W.with_steps(
        {"ok": True, "written": values, "book": "Employee HR Tracker", "tab": ref.tab},
        W.pg_steps("The HR tracker's row, kept in the Hub's database.", CACHES, APP_ID))}
    return W.final(answer, [rec], ctx["key"])


# ---- preferences (staffProfilePreferencesSave) -----------------------------------------------------------------------

def preferences_save(sess: L.Session, payload: dict) -> Decision:
    """staffProfilePreferencesSave: refused or found stale here, or the row (stamped here) kept in app.edits."""
    shut = edit_door(sess, (SP.EDITION_PREFERENCES,))
    if shut:
        return shut
    reads = sess.reads
    ctx = person_of(sess, payload.get("staff"))
    if ctx.get("refused"):
        return refused(ctx["refused"])
    if not isinstance(payload.get("prefs"), dict):
        return W.refuse(400, "prefs: the preferences.")
    expected = trimmed(payload.get("expected"))
    nxt = SP.prefs_clean(payload.get("prefs"))
    W.gate(reads)
    found = SP.prefs_find(reads, ctx["key"])
    if not found["sheet"]:
        return W.refuse(503, SP.PREFS_UNSET)
    res = reads.db.resolve(SP.PREFS_TAB)
    rec = found["rec"]
    was = SP.sp_instant(rec.get("updated_at")) if rec else ""
    marked(was)
    if was != expected:
        current = {"prefs": SP.prefs_of(rec), "updated_at": was,
                   "updated_by": gsjs.or_text(rec.get("updated_by")) if rec else ""}
        return Decision({"status": 409, "message": PREFS_STALE, "data": {"current": current}},
                        fresh=(res.sheet_id,))
    before = SP.prefs_of(rec)
    # shifts_note is the imported text: the stored cell stands
    nxt["shifts_note"] = before["shifts_note"]
    who, stamp = W.who(sess.user), W.now_iso(reads)
    people, master = ctx.get("people") or {}, ctx.get("master") or {}
    cells = {"staff_key": ctx["key"], "staff_name": ctx["name"], "person_id": gsjs.or_text(people.get("id")),
             "employee_id": gsjs.or_text(master.get("employee_id")),
             **{f: W.json_text(nxt[f]) for f in PREFS_FIELDS},
             "allergy_other": nxt["allergy_other"], "pickup": nxt["pickup"], "weekend_work": nxt["weekend_work"],
             "note": nxt["note"], "updated_at": stamp, "updated_by": who}
    if W.header_of(res.ref, "staff_key") is None and res.ref is not None:
        raise Defer(f"the {SP.PREFS_TAB} tab carries no staff_key column")
    sid, tab = W.where_of(res)
    kept = W.kept_record(sid, tab, "edit" if rec else "append", W.COLS + "staff_key", ctx["key"], ctx["key"], cells,
                         edition=edition_of(sess, (SP.EDITION_PREFERENCES,)))
    return W.final({"status": 200, "data": {"prefs": nxt, "updated_at": stamp, "updated_by": who}}, [kept],
                   ctx["key"])


# ---- the record edit (staffProfileEdit, staffProfileAddressEdit) -----------------------------------------------------

def master_target(reads: L.Reads, ctx: dict) -> dict[str, Any]:
    """The Employee Database Master row this person's edits land on, as spMasterIndexFrom_ picks it: {sid, tab…"""
    sid = SP.emp_db_id(reads)
    tab = SP.cert_source_tab(reads, "master")
    ref = HT.tab_of(reads, sid, tab, f"the Employee Database's {tab}")
    if ref is None:
        return {"why": "The Employee Database has no " + tab + " tab."}
    headers = list(ref.headers)
    col = SP.master_columns(headers, {"missing": [], "unsure": set()})
    rows = reads.db.rows(ref)
    hits = []
    for i, (_rn, raw) in enumerate(rows):
        f = {fid: SP.master_cell(hubdb.typed(raw.get(col[fid]), "estate"), NY)
             for fid in ("employee", "status", "first_name", "last_name") if fid in col}
        name = SP.text(gsjs.or_text(f.get("first_name")) + " " + gsjs.or_text(f.get("last_name")))
        if not name_key(name):
            name = f.get("employee") or ""
        if name_key(name) == ctx["key"]:
            hits.append((i, f))
    if len(hits) > 1:
        hits = [h for h in hits if SP._status_active(h[1])]
    names = [col.get("first_name"), col.get("last_name"), col.get("employee")]
    got = W.row_key_of(rows, hits[0][0], [[col.get("employee_id")], names, names + [col.get("dob")]]) \
        if len(hits) == 1 else None
    if got is None:
        return {"why": "This person's Employee Database row " + NOT_TOLD_APART}
    return {"sid": sid, "tab": ref.tab, "match": got[0], "key": got[1]}


def users_target(reads: L.Reads, user_id: str) -> dict[str, Any]:
    """The account's row on the users tab: {sid, tab, ref, match, key}, or why not."""
    res = W.tab_of(reads, "users")
    head = W.header_of(res.ref, "userid", norm=True)
    if res.ref is None or head is None:
        return {"why": "The accounts sheet is not read here."}
    rows = reads.db.rows(res.ref)
    raw_head = next(h for h in res.ref.headers if gsjs.trim(gsjs.js_str(h)) == head)
    at = next((i for i, (_rn, raw) in enumerate(rows) if gsjs.str_(raw.get(raw_head)) == user_id), None)
    got = W.row_key_of(rows, at, [[raw_head]]) if at is not None and user_id else None
    if got is None:
        return {"why": "The account's row " + NOT_TOLD_APART}
    sid, tab = W.where_of(res)
    return {"sid": sid, "tab": tab, "ref": res.ref, "match": got[0], "key": got[1]}


def account_cells(ref: hubdb.TabRef, field: str, value: str) -> tuple[dict[str, str], str]:
    """hubUserFieldsWrite_'s cells for one account field: {header: cell}, or why it is not written."""
    if field == "account_phones":
        phones = SP._clean_phones(SP._parse_phones(value))
        want = {"phones": W.json_text(phones), "phone": phones[0]["number"] if phones else ""}
    elif field == "account_emails":
        want = {"emails": W.json_text(SP._clean_emails(value))}
    else:
        want = {"avatar": gsjs.str_(value)[:500]}
    out: dict[str, str] = {}
    for name, cell in want.items():
        head = W.header_of(ref, name, norm=True)
        if head is None:
            return {}, "The accounts sheet has no " + name + " column."
        out[head] = cell
    return out, ""


def edit(sess: L.Session, payload: dict) -> Decision:
    """staffProfileEdit: every field refused or stale here, or the Master's cells, the account's and the People…"""
    shut = edit_door(sess, tuple(SP.EDITION_FIELDS))
    if shut:
        return shut
    reads = sess.reads
    open_ = SP.edit_open(reads, sess.user)
    ctx = person_of(sess, payload.get("key"))
    if ctx.get("refused"):
        return refused(ctx["refused"])
    changes, bad = W.edit_changes(payload)
    if bad:
        return Decision(bad)
    out: list[dict] = []
    stale: dict[str, str] = {}
    written: list[dict] = []
    edits: list[dict] = []
    master: list[dict] = []
    account: list[dict] = []
    for c in changes:
        why = SP.edition_shut(open_, c["field"]) or SP.edit_refusal(ctx, c["field"])
        if not why and c["field"] == "login_email":
            why = LOGIN_ELSEWHERE
        if why:
            if unread(why, ctx):
                raise Defer("a source this refusal names could not be read here")
            out.append({"field": c["field"], "why": why})
            continue
        (account if c["field"] in SP.EDIT_ACCOUNT else master).append(c)
    if master:
        tgt = master_target(reads, ctx)
        live_all = ctx.get("master_edit") or {}
        holder = not sc.is_real_master(sess.user)
        for c in master:
            f = c["field"]
            if tgt.get("why"):
                out.append({"field": f, "why": tgt["why"]})
                continue
            if f in (ctx.get("_unsure") or ()):
                raise Defer("the copy folds this Employee Database Master column with its scorecard twin")
            live = live_all.get(f, "")
            marked(live)
            now = CW.witness(c["expected"], live)
            if now is not None and holder and f in SP.EDIT_SECTIONS["hr"]:
                # a holder's HR panel opens on what the audited HR read shows, never on the raw cell
                shown = SP.hr_shown(ctx, f)
                marked(shown)
                now = None if CW.witness(c["expected"], shown) is None else shown
            if now is not None:
                stale[f] = now
                continue
            head = gsjs.trim(gsjs.js_str(ctx["master_cols"][f]["head"]))
            edits.append(W.kept_record(tgt["sid"], tgt["tab"], "edit", tgt["match"], tgt["key"], ctx["key"],
                                       {head: c["value"]}, {head: live}, field_edition(sess, f)))
            written.append({"field": f, "before": c["expected"], "after": c["value"]})
    photo_done = False
    if account and ctx.get("account"):
        tgt = users_target(reads, gsjs.str_(ctx["account"].get("user_id")))
        live_all = SP.account_edit_raw(ctx["account"])
        for c in account:
            f = c["field"]
            if tgt.get("why"):
                out.append({"field": f, "why": tgt["why"]})
                continue
            live = live_all.get(f, "")
            marked(live)
            now = CW.witness(c["expected"], live)
            if now is not None:
                stale[f] = now
                continue
            if f == "avatar" and c["value"] and not re.match(r"https://", c["value"], re.I):
                out.append({"field": f, "why": "A photo is an https:// link."})
                continue
            cells, why = account_cells(tgt["ref"], f, c["value"])
            if why:
                out.append({"field": f, "why": why})
                continue
            edits.append(W.kept_record(tgt["sid"], tgt["tab"], "edit", tgt["match"], tgt["key"], ctx["key"], cells,
                                       edition=field_edition(sess, f)))
            written.append({"field": f, "before": c["expected"], "after": c["value"]})
            photo_done = photo_done or f == "avatar"
    photo = next((c for c in account if c["field"] == "avatar"), None)
    people = ctx.get("people") or {}
    if photo and not gsjs.falsy(people.get("id")) and (photo_done or not ctx.get("account")):
        # the photo is the Hub's own People column too: the contacts sync never rewrites it
        held = None if ctx.get("account") else CW.witness(photo["expected"], gsjs.or_text(people.get("avatar")))
        if held is not None:
            stale["avatar"] = held
        elif photo["value"] and not re.match(r"https://", photo["value"], re.I):
            out.append({"field": "avatar", "why": "A photo is an https:// link."})
        else:
            res = W.tab_of(reads, "people")
            sid, tab = W.where_of(res)
            edits.append(W.kept_record(sid, tab, "edit", "id", gsjs.js_str(people.get("id")), ctx["key"],
                                       {"avatar": photo["value"]}, {"avatar": gsjs.or_text(people.get("avatar"))},
                                       field_edition(sess, "avatar")))
            if not photo_done:
                written.append({"field": "avatar", "before": photo["expected"], "after": photo["value"]})
    answer = kept_answer(written, out, stale, "The staff record's fields, kept in the Hub's database.")
    if edits:
        return W.final(answer, edits, ctx["key"])
    return Decision(answer, fresh=bool(stale) or any(r["why"] not in _STATIC for r in out))


def address_bad(field: str, value: str) -> str:
    """spAddressBad_."""
    if not gsjs.trim(value):
        return ADDRESS_WORDS["blank"]
    if field == "address":
        ok = u16(value) <= 120 and re.search(r"[A-Za-z]", value) and not re.search(r"[\r\n\t]", value)
        return "" if ok else ADDRESS_WORDS["address"]
    if field == "city":
        return "" if _CITY.fullmatch(value) else ADDRESS_WORDS["city"]
    if field == "state":
        return "" if re.fullmatch(r"[A-Z]{2}", value) and value in SP.US_STATES else ADDRESS_WORDS["state"]
    if field == "zip":
        return "" if re.fullmatch(r"[0-9]{5}(-[0-9]{4})?", value) else ADDRESS_WORDS["zip"]
    return ADDRESS_WORDS["only"]


def address_edit(sess: L.Session, payload: dict) -> Decision:
    """staffProfileAddressEdit: every field refused or stale here, or the Employee Database Master's street, city,
    state and zip kept in app.edits, each witnessed by the cell the panel opened on (emp360WriteCell_)."""
    who = SP.address_subject(sess, payload)
    if who.get("refused"):
        return refused(who["refused"])
    ctx = who["ctx"]
    changes, bad = W.edit_changes(payload)
    if bad:
        return Decision(bad)
    out: list[dict] = []
    stale: dict[str, str] = {}
    written: list[dict] = []
    edits: list[dict] = []
    tgt: dict[str, Any] | None = None
    live_all = ctx.get("master_edit") or {}
    for c in changes:
        f = c["field"]
        if f not in SP.ADDRESS_FIELDS:
            out.append({"field": f, "why": ADDRESS_WORDS["only"]})
            continue
        value = c["value"].upper() if f == "state" else c["value"]
        why = address_bad(f, value) or SP.edit_refusal(ctx, f)
        if why:
            if unread(why, ctx):
                raise Defer("a source this refusal names could not be read here")
            out.append({"field": f, "why": why})
            continue
        if tgt is None:
            tgt = master_target(sess.reads, ctx)
        if tgt.get("why"):
            out.append({"field": f, "why": tgt["why"]})
            continue
        if f in (ctx.get("_unsure") or ()):
            raise Defer("the copy folds this Employee Database Master column with its scorecard twin")
        live = live_all.get(f, "")
        marked(live)
        now = CW.witness(c["expected"], live)
        if now is not None:
            stale[f] = now
            continue
        head = gsjs.trim(gsjs.js_str(ctx["master_cols"][f]["head"]))
        edits.append(W.kept_record(tgt["sid"], tgt["tab"], "edit", tgt["match"], tgt["key"], ctx["key"],
                                   {head: value}, {head: live}))
        written.append({"field": f, "before": c["expected"], "after": value})
    if edits:
        staff_views.record(sess.user, "staffProfileAddressEdit", f"{ctx['key']}: " + ", ".join(w["field"] for w in written))
        answer = kept_answer(written, out, stale, "The address, kept in the Hub's database.")
        answer["data"]["staff_key"] = ctx["key"]
        return W.final(answer, edits, ctx["key"])
    static = set(ADDRESS_WORDS.values()) | _STATIC
    answer = edit_answer(out, stale)
    answer["data"]["staff_key"] = ctx["key"]
    return Decision(answer, fresh=bool(stale) or any(r["why"] not in static for r in out))


# ---- the rename (staffProfileRename) ---------------------------------------------------------------------------------

def rename_taken(reads: L.Reads, ctx: dict, new_key: str) -> str:
    """spRenameTaken_: a People row, a Master row or another account already carrying the new key."""
    try:
        roster, mi = SP.roster_index(reads), SP.master_index(reads)
    except RuntimeError as e:
        raise Defer(f"whether the new name is free could not be read here ({L._why(e)})") from e
    if roster["by_key"].get(new_key) or new_key in mi["rows"]:
        return "Another staff record already carries that name — nothing was renamed."
    mine = (ctx.get("account") or {}).get("user_id") or ""
    for u in reads.users():
        if gsjs.str_(u.get("mergedinto")) or gsjs.str_(u.get("clientkey")) or gsjs.str_(u.get("userid")) == mine:
            continue
        if name_key(gsjs.str_(u.get("displayname"))) == new_key:
            return "Another account already carries that name — nothing was renamed."
    return ""


def rename_target(reads: L.Reads, eid: str) -> dict[str, Any]:
    """emp360Resolve_ by the Employee ID: the one Master row carrying it, named by that id — {sid, tab, match, key},
    or why not in emp360WriteCell_'s words."""
    sid = SP.emp_db_id(reads)
    tab = SP.cert_source_tab(reads, "master")
    ref = HT.tab_of(reads, sid, tab, f"the Employee Database's {tab}")
    if ref is None:
        return {"why": "The Master tab could not be opened."}
    head = SP.master_columns(list(ref.headers), {"missing": [], "unsure": set()}).get("employee_id")
    rows = reads.db.rows(ref)
    hits = [i for i, (_rn, raw) in enumerate(rows) if head is not None
            and gsjs.trim(SP.master_cell(hubdb.typed(raw.get(head), "estate"), NY)) == eid]
    if len(hits) > 1:
        return {"why": f'{len(hits)} rows in the Employee Database match employee id "{eid}". Merging people is not '
                       "something to do automatically — sort the duplicate out first."}
    if not hits:
        return {"why": "No row in the Employee Database matches this person — nothing to write to."}
    got = W.row_key_of(rows, hits[0], [[head]])
    if got is None:
        return {"why": "This person's Employee Database row " + NOT_TOLD_APART}
    return {"sid": sid, "tab": ref.tab, "match": got[0], "key": got[1]}


def account_renamed(reads: L.Reads, ctx: dict, name: str) -> bool:
    """spRenameAccount_ would change the account's users row: its display name, or the mark of a name chosen there."""
    a = ctx.get("account")
    if not a:
        if ctx.get("account_why"):
            raise Defer("the accounts could not be read here")
        return False
    u = next((u for u in reads.users() if gsjs.str_(u.get("userid")) == a["user_id"]), None)
    return u is not None and (gsjs.str_(u.get("displayname")) != name or gsjs.str_(u.get("nameby")) != "")


def account_rename(reads: L.Reads, ctx: dict, name: str, subject: str) -> dict[str, Any]:
    """spRenameAccount_ kept in app.edits: the account's display name as the new name and the mark of a name chosen
    there cleared (hubUserFieldsWrite_), each where the users tab has the column — {edit} or {why}."""
    uid = gsjs.str_(ctx["account"].get("user_id"))
    tgt = users_target(reads, uid)
    if tgt.get("why"):
        return {"why": tgt["why"]}
    u = next((u for u in reads.users() if gsjs.str_(u.get("userid")) == uid), None) or {}
    cells: dict[str, str] = {}
    before: dict[str, str] = {}
    for field, cell in (("displayname", name), ("nameby", "")):
        head = W.header_of(tgt["ref"], field, norm=True)
        if head is None:
            continue
        cells[head], before[head] = cell, gsjs.or_blank(u.get(field))
    if not cells:
        return {"why": "The accounts sheet has no displayname column."}
    return {"edit": W.kept_record(tgt["sid"], tgt["tab"], "edit", tgt["match"], tgt["key"], subject, cells, before)}


def rekey_rows(reads: L.Reads, tab: str, old: str, new: str, name: str,
               named_only: bool = False) -> list[dict] | None:
    """spRekeyRows_ kept in app.edits: each row of a tab of ours carrying the old key takes the new key and name, the
    row named by cells the edit leaves; None when a row cannot be named so (`named_only`: that row left out)."""
    import client_rename as CR  # noqa: PLC0415 - its row naming, as the client rename keeps its Hub tabs
    res = reads.db.resolve(tab)
    if res.runtime:
        raise Defer(f"{tab} lives in the depot's facts")
    if res.ref is None:
        if not res.book_known:
            raise hubdb.Unreadable(f"asa-hub-db holds no copy of the book behind {tab}")
        return []
    ref = res.ref
    key_h = W.header_of(ref, "staff_key")
    if key_h is None:
        return []
    name_h = W.header_of(ref, "staff_name") or "staff_name"
    raw_of = {gsjs.trim(gsjs.js_str(h)): h for h in ref.headers}
    rows = reads.db.rows(ref)
    ids = CR.id_counts(ref, rows)
    out: list[dict] = []
    for i, (_rn, raw) in enumerate(rows):
        was = gsjs.trim(gsjs.or_blank(raw.get(raw_of[key_h])))
        if was != old:
            continue
        got = CR.row_match(ref, rows, i, {raw_of[key_h], raw_of.get(name_h)}, ids)
        if got is None:
            if named_only:
                continue
            return None
        out.append(W.kept_record(ref.sheet_id, ref.tab, "edit", got[0], got[1], new, {key_h: new, name_h: name},
                                 {key_h: was, name_h: gsjs.or_blank(raw.get(raw_of.get(name_h)))}))
    return out


def rekey_table(reads: L.Reads, tab: str, old: str, new: str, name: str, by: str) -> int:
    """spRekeyRows_ on a tab kept in its own table: every row carrying the old key given the new key and name there, in
    this write; how many."""
    resource = HT.resource_of(tab) or ""
    cols = [c for c in RR.columns(reads, resource) if c]
    key_c = next((c for c in cols if gsjs.trim(c) == "staff_key"), None)
    if key_c is None:
        return 0
    name_c = next((c for c in cols if gsjs.trim(c) == "staff_name"), "staff_name")
    hits = [(k, c) for k, c in RR.table_rows(reads, resource) if gsjs.trim(gsjs.or_blank(c.get(key_c))) == old]
    RR.update_many(reads, resource, [(k, c, {key_c: new, name_c: name}) for k, c in hits], by)
    return len(hits)


def rekey_op(reads: L.Reads, tab: str, old: str, new: str, name: str) -> tuple[dict, list[dict], int]:
    """spRekeyRows_ where a row cannot be named by a kept edit: every row of the tab carrying the old key given the new
    key and name on the sheet itself (app/book_ops.py `cells`, every row the key names), the rows a kept edit can name
    kept in app.edits as well (read at once, and a row still on its way to the sheet renamed) — the op, those edits,
    and how many rows the copy holds under the old key."""
    ref = reads.db.resolve(tab).ref
    key_h = W.header_of(ref, "staff_key")
    name_h = W.header_of(ref, "staff_name")
    raw_of = {gsjs.trim(gsjs.js_str(h)): h for h in ref.headers}
    rows = sum(1 for _rn, raw in reads.db.rows(ref) if gsjs.trim(gsjs.or_blank(raw.get(raw_of[key_h]))) == old)
    cells = {key_h: new, **({name_h: name} if name_h else {})}
    return ({"op": "cells", "sheet_id": ref.sheet_id, "tab": ref.tab,
             "spec": {"match": key_h, "key": old, "which": "all", "cells": cells}},
            rekey_rows(reads, tab, old, new, name, named_only=True) or [], rows)


def rename(sess: L.Session, payload: dict) -> Decision:
    """staffProfileRename: refused or stale here; or the Master's First and Last Name (both, or neither), the account's
    display name and every row of our staff tabs carrying the old key, kept in app.edits. A staff tab with a row no
    kept edit can name is rewritten on the sheet itself (book_ops), and the next rename waits until the copy holds
    it."""
    shut = master_shut(sess)
    if shut:
        return shut
    reads = sess.reads
    ctx = person_of(sess, payload.get("key"))
    if ctx.get("refused"):
        return refused(ctx["refused"])
    changes, bad = W.edit_changes(payload)
    if bad:
        return Decision(bad)
    out = [{"field": c["field"], "why": "Not a field the rename edits."} for c in changes
           if c["field"] not in RENAME_FIELDS]
    names = {c["field"]: c for c in changes if c["field"] in RENAME_FIELDS}
    order = [c["field"] for c in changes if c["field"] in RENAME_FIELDS]
    if not names:
        return W.refuse(400, "changes: first_name or last_name.")
    if not ctx.get("master"):
        why = ctx.get("master_why") or "No Employee Database row is read for this person — the name is kept there."
        if unread(why, ctx):
            raise Defer("the Employee Database Master could not be read here")
        return W.refuse(409, why, fresh=True)
    eid = ctx["master"].get("employee_id")
    marked(eid)
    if not eid:
        return W.refuse(409, "The Employee Database row carries no Employee ID — a rename is written only to a row its "
                             "id points at.", fresh=True)
    cols = ctx.get("master_cols") or {}
    if not cols.get("first_name") or not cols.get("last_name"):
        return W.refuse(409, "The Employee Database has no First Name or Last Name column.", fresh=True)
    raw = ctx.get("master_edit") or {}

    def part(f: str) -> str:
        if f in names:
            return sp_text(names[f]["value"], 80)
        marked(raw.get(f))
        return sp_text(raw.get(f), 80)

    first, last = part("first_name"), part("last_name")
    new_name = sp_text(first + " " + last)
    new_key = name_key(new_name)
    if not first or not last or not _KEY.fullmatch(new_key):
        return W.refuse(400, "A first and a last name are required.")
    W.gate(reads)
    if new_key != ctx["key"]:
        if BO.settling(reads, "staff:" + ctx["key"]):
            return W.refuse(409, RENAME_SETTLING)
        try:
            taken = rename_taken(reads, ctx, new_key)
        except (Defer, hubdb.Unreadable):
            return W.refuse(503, "Whether the new name is free could not be read just now — nothing was renamed.")
        if taken:
            return W.refuse(409, taken, fresh=True)
    stale: dict[str, str] = {}
    cells: dict[str, str] = {}
    before: dict[str, str] = {}
    tgt = rename_target(reads, gsjs.trim(gsjs.or_blank(eid)))
    for f in order:
        if tgt.get("why"):
            out.append({"field": f, "why": tgt["why"]})
            break
        if f in (ctx.get("_unsure") or ()):
            raise Defer("the copy folds this Employee Database Master column with its scorecard twin")
        live = raw.get(f, "")
        marked(live)
        now = CW.witness(names[f]["expected"], live)
        if now is not None:
            stale[f] = now
            break
        head = gsjs.trim(gsjs.js_str(cols[f]["head"]))
        cells[head], before[head] = names[f]["value"], live
    if stale or len(cells) < len(order):
        # half a name is never left behind
        return Decision(edit_answer(out, stale), fresh=True)
    edits = [W.kept_record(tgt["sid"], tgt["tab"], "edit", tgt["match"], tgt["key"], new_key, cells, before)]
    if account_renamed(reads, ctx, new_name):
        acct = account_rename(reads, ctx, new_name, new_key)
        if acct.get("why"):
            return W.refuse(409, acct["why"], fresh=True)
        edits.append(acct["edit"])
    moved: dict[str, int] = {"notes": 0, "visits": 0}
    if new_key != ctx["key"]:
        tabs = [("notes", SP.NOTES_TAB), ("visits", SP.VISITS_TAB)]
        if reads.db.house_moved(SP.PREFS_TAB):
            tabs.append(("preferences", SP.PREFS_TAB))
        else:
            moved["preferences"] = 0
        ops: list[dict] = []
        for label, tab in tabs:
            if HT.tabled(tab):
                moved[label] = rekey_table(reads, tab, ctx["key"], new_key, new_name, W.who(sess.user))
                continue
            got = rekey_rows(reads, tab, ctx["key"], new_key, new_name)
            if got is None:
                # rows no kept edit can name are rewritten where they stand on the sheet, as Apps Script rewrote them
                op, named, moved[label] = rekey_op(reads, tab, ctx["key"], new_key, new_name)
                ops.append(op)
                edits.extend(named)
                continue
            edits.extend(got)
            moved[label] = len(got)
        BO.queue(ops, "staff:" + new_key, W.who(sess.user), "staffProfileRename")
    staff_views.record(sess.user, "staffProfileRename", f"{ctx['key']} → {new_key}: " + ", ".join(order))
    answer = kept_answer([{"field": f} for f in order], out, {}, "The new name, kept in the Hub's database.")
    answer["data"].update({"key": new_key, "name": new_name, "moved": moved})
    return W.final(answer, edits, new_key)


# ---- the driving record and the MAIS line (staffProfileDrivingEdit, staffProfileMaisEdit) ----------------------------

def driving_shown(fields: dict, fid: str) -> str:
    """spDrivingShown_: the witness the panel sends back."""
    if fid == "points":
        n = fields.get("points")
        return gsjs.js_str(n) if n is not None else gsjs.or_text(fields.get("points_note"))
    return gsjs.or_blank(fields.get(fid))


def driving_edit(sess: L.Session, payload: dict) -> Decision:
    """staffProfileDrivingEdit: every field refused or stale here, or the driving tabs' cells kept in app.edits."""
    shut = edit_door(sess, (SP.EDITION_DRIVING,))
    if shut:
        return shut
    reads = sess.reads
    ctx = person_of(sess, payload.get("key"))
    if ctx.get("refused"):
        return refused(ctx["refused"])
    changes, bad = W.edit_changes(payload)
    if bad:
        return Decision(bad)
    out: list[dict] = []
    stale: dict[str, str] = {}
    written: list[dict] = []
    edits: list[dict] = []
    edition = edition_of(sess, (SP.EDITION_DRIVING,))
    by_tab: dict[str, list[dict]] = {}
    for c in changes:
        if c["field"] == "dl":
            out.append({"field": c["field"], "why": SP.EDIT_PROTECTED})
        elif c["field"] not in DRIVING_EDIT:
            out.append({"field": c["field"], "why": "Not a field the driving record edits."})
        else:
            by_tab.setdefault(DRIVING_EDIT[c["field"]][0], []).append(c)
    if not by_tab:
        return Decision(edit_answer(out, stale))
    sid = SP.emp_db_id(reads)
    for tab, items in by_tab.items():
        def refuse_all(why: str, items: list = items) -> None:
            out.extend({"field": c["field"], "why": why} for c in items)

        ref = HT.tab_of(reads, sid, tab, f"the Employee Database's {tab}")
        if ref is None:
            refuse_all("The Employee Database has no " + tab + " tab.")
            continue
        headers, rows = SP._emp_tab(reads, tab)
        idx = SP.driver_index_from(headers, rows, NY)
        if ctx["key"] in idx["unsure"]:
            raise Defer("the copy withholds the licence number that decides this person's driving row")
        hit = idx["rows"].get(ctx["key"])
        if not hit:
            refuse_all("No row of the " + tab + " tab names this person.")
            continue
        if hit["ambiguous"]:
            refuse_all("Two rows of the " + tab + " tab carry this name, so neither is written.")
            continue
        cols = idx["cols"]
        names = [cols.get("first_name"), cols.get("last_name")]
        got = W.row_key_of(reads.db.rows(ref), hit["row"] - 1,
                           [[cols.get("employee")], names, names + [cols.get("employee")],
                            names + [cols.get("employee"), cols.get("dl")]])
        if got is None:
            refuse_all("This person's row of the " + tab + " tab " + NOT_TOLD_APART)
            continue
        for c in items:
            fid = DRIVING_EDIT[c["field"]][1]
            if fid not in cols:
                out.append({"field": c["field"], "why": "The " + tab + " tab has no column for this field."})
                continue
            shown = driving_shown(hit["fields"], fid)
            marked(shown)
            now = CW.witness(c["expected"], shown)
            if now is not None:
                stale[c["field"]] = now
                continue
            head = gsjs.trim(gsjs.js_str(cols[fid]))
            edits.append(W.kept_record(sid, ref.tab, "edit", got[0], got[1], ctx["key"], {head: c["value"]},
                                       {head: shown}, edition))
            written.append({"field": c["field"], "before": c["expected"], "after": c["value"]})
    return settled(kept_answer(written, out, stale, "The driving record's cells, kept in the Hub's database."), edits,
                   ctx["key"], (sid,))


def mais_column(keys: list[str], cells: list[str], spec: str) -> int | None:
    """spMaisColumn_: the one column a spec reads on this row; None when it joins columns or names none."""
    first = None
    for alt in gsjs.or_blank(spec).split("|"):
        parts = [gsjs.trim(p) for p in alt.split("+")]
        cols = [keys.index(p) if p in keys else -1 for p in parts]
        if any(c != -1 and gsjs.trim(cells[c]) for c in cols):
            return None if len(parts) > 1 else cols[0]
        if first is None and len(parts) == 1 and cols[0] != -1:
            first = cols[0]
    return first


def mais_edit(sess: L.Session, payload: dict) -> Decision:
    """staffProfileMaisEdit: every field refused or stale here, or the MAIS line's cells kept in app.edits."""
    shut = edit_door(sess, (SP.EDITION_MAIS,))
    if shut:
        return shut
    reads = sess.reads
    ctx = person_of(sess, payload.get("key"))
    if ctx.get("refused"):
        return refused(ctx["refused"])
    changes, bad = W.edit_changes(payload)
    if bad:
        return Decision(bad)
    level = sp_text(payload.get("level"), 40)
    if not level:
        return W.refuse(400, "level: which Cat level.")
    out: list[dict] = []
    stale: dict[str, str] = {}
    items = []
    for c in changes:
        if c["field"] in MAIS_EDIT:
            items.append(c)
        else:
            out.append({"field": c["field"], "why": "Not a field the MAIS line edits."})
    if not items:
        return Decision(edit_answer(out, stale))
    sid = reads.db.prop(SP.CERT_SOURCE_PROP)
    if not sid:
        raise hubdb.Unreadable("no CERT_SOURCE_ID is declared in the depot")
    tab = SP.cert_source_tab(reads, "mais")
    ref = HT.tab_of(reads, sid, tab, f"the book's {tab}")
    if ref is None:
        out.extend({"field": c["field"], "why": "The book has no " + tab + " tab."} for c in items)
        return Decision(edit_answer(out, stale), fresh=(sid,))
    keys = [hubdb.estate_key(h) for h in ref.headers]
    rows: list[dict] = []
    lines: dict[int, list[str]] = {}
    copy = reads.db.rows(ref)
    written: list[dict] = []
    edits: list[dict] = []
    for rn, raw in copy:
        cells = [hubdb.estate_cell(hubdb.typed(raw.get(h), "estate")) for h in ref.headers]
        row: dict[str, Any] = {"_row": rn - 1}
        empty = True
        for k, v in zip(keys, cells):
            if not k:
                continue
            if v:
                empty = False
            row[k] = v
        if not empty:
            rows.append(row)
            lines[rn - 1] = cells
    mais = SP.mais_from(reads, rows, ctx["key"], reads.today(), 0)
    cert = None if mais["ambiguous"] else next((x for x in mais["certs"] if x["level"] == level), None)
    if mais["ambiguous"]:
        why = mais["why"] or "The MAIS record is ambiguous, so nothing is written."
        out.extend({"field": c["field"], "why": why} for c in items)
    elif not cert or cert.get("row") is None:
        out.extend({"field": c["field"], "why": "No MAIS line of that Cat level names this person."} for c in items)
    else:
        specs = SP.mais_specs(reads)
        spec = {"status": specs["status"], "effective": SP.MAIS_EFFECTIVE, "expires": specs["expires"]}
        shown = {"status": cert["word"], "effective": cert["effective"], "expires": cert["expires"]}
        line = lines[cert["row"]]
        got = mais_line_key(ref, keys, copy, cert["row"], specs, spec)
        for c in items:
            col = mais_column(keys, line, spec[c["field"]])
            if col is None:
                out.append({"field": c["field"], "why": "The MAIS tab has no single column for this field."})
                continue
            marked(line[col], shown[c["field"]])
            now = CW.witness(c["expected"], shown[c["field"]])
            if now is not None:
                stale[c["field"]] = now
                continue
            if got is None:
                out.append({"field": c["field"], "why": "This MAIS line " + NOT_TOLD_APART})
                continue
            head = gsjs.trim(gsjs.js_str(ref.headers[col]))
            edits.append(W.kept_record(sid, ref.tab, "edit", got[0], got[1], ctx["key"], {head: c["value"]},
                                       {head: line[col]}, edition_of(sess, (SP.EDITION_MAIS,))))
            written.append({"field": c["field"], "before": c["expected"], "after": c["value"]})
    return settled(kept_answer(written, out, stale, "The MAIS line's cells, kept in the Hub's database."), edits,
                   ctx["key"], (sid,))


def mais_line_key(ref: hubdb.TabRef, keys: list[str], copy: list[tuple[int, dict]], row: int, specs: dict,
                  edited: dict) -> tuple[str, str] | None:
    """The MAIS line's key: its stamp, the names it is matched by and its level, never a column the door edits."""
    def heads(*specs_: str) -> list[str]:
        out = []
        for s in specs_:
            for alt in gsjs.or_blank(s).split("|"):
                for p in alt.split("+"):
                    k = gsjs.trim(p)
                    if k in keys:
                        out.append(ref.headers[keys.index(k)])
        return out

    never = set(heads(*edited.values()))
    base = [h for h in heads(SP.MAIS_STAMP, specs["name"], SP.MAIS_SEARCH, specs["level"]) if h not in never]
    at = next((i for i, (rn, _raw) in enumerate(copy) if rn - 1 == row), None)
    if at is None:
        return None
    return W.row_key_of(copy, at, [base, base + [h for h in heads(SP.MAIS_ID) if h not in never]])


# ---- an IST record (staffProfileIstEdit) -----------------------------------------------------------------------------

def ist_edit(sess: L.Session, payload: dict) -> Decision:
    """staffProfileIstEdit: refused or stale here, or the record's cells (updatedAt stamped) kept in app.edits."""
    shut = edit_door(sess, (SP.EDITION_IST,))
    if shut:
        return shut
    reads = sess.reads
    ctx = person_of(sess, payload.get("key"))
    if ctx.get("refused"):
        return refused(ctx["refused"])
    changes, bad = W.edit_changes(payload)
    if bad:
        return Decision(bad)
    iid = sp_text(payload.get("id"), 120)
    if not iid:
        return W.refuse(400, "id: which IST record.")
    out: list[dict] = []
    items = []
    for c in changes:
        f, v = c["field"], c["value"]
        if f not in IST_EDIT:
            out.append({"field": f, "why": "Not a field the IST record edits."})
        elif f == "status" and v not in IST_STATUSES:
            out.append({"field": f, "why": "Owed or done."})
        elif f != "status" and v and not SP.sp_day(v):
            out.append({"field": f, "why": "A date."})
        else:
            items.append(c)
    if not items:
        return Decision(edit_answer(out, {}))
    W.gate(reads)
    res = W.tab_of(reads, IST_TAB)
    book = (res.sheet_id,)
    rec = next((r for r in SP.ist_rows(reads) if gsjs.or_blank(r.get("id")) == iid), None)
    if rec is None:
        return W.refuse(404, f'No IST record "{iid}".', fresh=book)
    marked(rec.get("staffName"))
    if name_key(rec.get("staffName")) != ctx["key"]:
        return W.refuse(409, "That IST record names another staff member — reload the profile.", fresh=book)
    marked(*(rec.get(IST_EDIT[c["field"]]) for c in items))
    shown = SP.ist_cell(rec, {})
    stale: dict[str, str] = {}
    cells: dict[str, str] = {}
    before: dict[str, str] = {}
    written: list[dict] = []
    for c in items:
        now = CW.witness(c["expected"], shown[c["field"]])
        if now is not None:
            stale[c["field"]] = now
            continue
        cells[IST_EDIT[c["field"]]] = c["value"]
        before[IST_EDIT[c["field"]]] = gsjs.or_blank(rec.get(IST_EDIT[c["field"]]))
        written.append({"field": c["field"], "before": c["expected"], "after": c["value"]})
    answer = kept_answer(written, out, stale, "The IST record's cells, kept in the Hub's database.")
    if not cells:
        return Decision(answer, fresh=book)
    cells[IST_HEADER_STAMP] = W.now_iso(reads)
    rec_ = IW.keep_cells(reads, iid, cells, before, ctx["key"], gsjs.str_((sess.user or {}).get("email")),
                         edition_of(sess, (SP.EDITION_IST,)))
    if rec_ is None:
        # the record lives in Postgres (IST Records on Python): written there, final
        return Decision(answer, subject=ctx["key"], own=True)
    return W.final(answer, [rec_], ctx["key"])


def ist_add(sess: L.Session, payload: dict) -> Decision:
    """staffProfileIstAdd (Python's own): an IST record for a client the person holds none for yet, at the client's
    house — trained on the day, or owed by it — written where the IST records live, as Assign Training writes one. A
    pair that already holds a record is edited instead (staffProfileIstEdit), never doubled."""
    shut = edit_door(sess, (SP.EDITION_IST,))
    if shut:
        return shut
    reads = sess.reads
    ctx = person_of(sess, payload.get("key"))
    if ctx.get("refused"):
        return refused(ctx["refused"])
    status = sp_text(payload.get("status"), 10)
    if status not in IST_STATUSES:
        return W.refuse(400, "status: owed or done.")
    day = sp_text(payload.get("day"), 20)
    if not _DAY.fullmatch(day) or not SP.sp_day(day):
        return W.refuse(400, "day: a day as yyyy-MM-dd.")
    if status == IST.STATUS_DONE and day > reads.today():
        return W.refuse(400, "A trained day is today or before.")
    ck = sp_text(payload.get("client"), 120)
    client = next((c for c in SP.client_rows(reads) if ck and c["client_key"] == ck), None)
    if client is None:
        return W.refuse(404, f'No client "{ck}".', fresh=True)
    house = L.house_code(client["house"]) or L.code_of(client["house"])
    if not house:
        return W.refuse(409, f"{client['name']} has no house on their record — an IST pairs a client at a house.",
                        fresh=True)
    owned = IST.owned(reads.db)
    if not owned:
        W.gate(reads)
        sid, tab = W.where_of(W.tab_of(reads, IST.RECORDS_TAB))
    if any(IST.pair_key(r.get("staffName"), r.get("clientName")) == IST.pair_key(ctx["name"], client["name"])
           for r in IST.records(reads)):
        return W.refuse(409, f"{ctx['name']} already has an IST record for {client['name']} — reload the profile and "
                             "edit it.", fresh=True)
    p, a, m = ctx.get("people") or {}, ctx.get("account") or {}, ctx.get("master") or {}
    done = status == IST.STATUS_DONE
    fields = {
        "staffName": ctx["name"], "staffEmail": gsjs.or_text(p.get("email") or a.get("email") or m.get("email")),
        "staffPhone": gsjs.or_text(p.get("phone") or a.get("phone") or m.get("phone")),
        "avatar": gsjs.or_text(a.get("avatar") or p.get("avatar")), "clientName": client["name"], "house": house,
        "dueDate": day, "status": status,
        "certNote": IST.cert_note(reads, IST.cfg(reads), ctx["key"], reads.now.timestamp() * 1000.0),
        "trainedAt": day if done else "", "trainedBy": "", "notifiedAt": "", "notifyCount": "0", "remindRequested": ""}
    staff_views.record(sess.user, "staffProfileIstAdd", ctx["key"])
    # createRow_'s row: in Postgres once the records live there, else minted here and appended in app.edits
    rec = IST.create(reads, IST.RECORDS, fields, gsjs.str_((sess.user or {}).get("email"))) if owned \
        else IST._record(fields, W.now_iso(reads))
    answer = {"status": 200, "data": {"id": rec["id"], "client_name": client["name"], "house": house, "status": status,
                                      "day": day}}
    if owned:
        return Decision(answer, subject=ctx["key"], own=True)
    return W.final(answer, [W.kept_record(sid, tab, "append", "id", rec["id"], ctx["key"], rec)], ctx["key"])


DOC_MARK_MAX = 500


def doc_conclude(sess: L.Session, payload: dict) -> Decision:
    """staffProfileDocConclude (Python's own): a missing daily note or punch in Performance › Documentation marked
    concluded, with why — its row kept in app.edits, final; the record then counts as complete."""
    shut = edit_door(sess, (SP.EDITION_DOCUMENTATION,))
    if shut:
        return shut
    ctx = person_of(sess, payload.get("staff"))
    if ctx.get("refused"):
        return refused(ctx["refused"])
    day = sp_text(payload.get("date"), 20)
    if not _DAY.fullmatch(day) or not issue_day_ok(day):
        return W.refuse(400, "date: the record's day as yyyy-MM-dd.")
    if day > sess.reads.today():
        return W.refuse(400, "date: a day that has passed.")
    area = sp_text(payload.get("area"))
    if area not in SP.DOC_MARK_AREAS:
        return W.refuse(400, "area: " + " or ".join(SP.DOC_MARK_AREAS) + ".")
    why = trimmed(payload.get("why"))
    if not why:
        return W.refuse(400, "why: what concludes this record.")
    if u16(why) > DOC_MARK_MAX:
        return W.refuse(400, f"why: up to {DOC_MARK_MAX} characters.")
    reads = sess.reads
    W.gate(reads)
    import staff_perf as SF  # noqa: PLC0415 - the Performance module loads beside this one
    held = SF.doc_marks(reads, ctx["key"]).get((day, area))
    if held:
        return W.refuse(409, "This record is already marked concluded — " + SF.concluded_words(held), fresh=True)
    res = W.tab_of(reads, SP.DOC_MARKS_TAB)
    mark = {"id": W.mint("SDM_"), "staff_key": ctx["key"], "staff_name": ctx["name"], "date": day, "area": area,
            "state": "concluded", "why": why, "by": W.who(sess.user), "at": W.now_iso(reads)}
    rec = W.append_record(res, SP.DOC_MARKS_HEADER, mark, ctx["key"])
    rec["edition"] = edition_of(sess, (SP.EDITION_DOCUMENTATION,))
    answer = {"status": 200, "data": W.with_steps({"mark": mark}, W.pg_steps(
        "The concluded mark, kept in the Hub's database.", CACHES, APP_ID))}
    return W.final(answer, [rec], ctx["key"])


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {
    "staffProfilePhoto": P.door("staff"),
    "staffProfileDocConclude": doc_conclude,
    "staffProfileNoteAdd": note_add, "staffProfileNoteState": note_state, "staffProfileNoteEdit": note_edit,
    "staffProfileAssignTraining": assign_training, "staffProfileHrIssueAdd": hr_issue_add,
    "staffProfilePreferencesSave": preferences_save, "staffProfileEdit": edit,
    "staffProfileAddressEdit": address_edit, "staffProfileRename": rename,
    "staffProfileDrivingEdit": driving_edit, "staffProfileMaisEdit": mais_edit, "staffProfileIstEdit": ist_edit,
    "staffProfileIstAdd": ist_add,
}
# the doors the relay hands Python under the Staff switch; the address is My Profile's, like its read
ROUTED = frozenset(ACTIONS) - {"staffProfileAddressEdit"}
_MASTER = ("admin", "manager")
# the doors an edition opens: its holders are employees (Editions.gs EDITION_ROLES)
_EDITORS = ("admin", "manager", "staff")
_WHOLE = ("admin", "director", "manager", "staff", "client", "onboarding", "interviewer")
# HUB_POLICY: the roles each write is declared for, and its typed params
POLICY: dict[str, dict[str, Any]] = {
    "staffProfilePhoto": P.policy("staff"),
    "staffProfileDocConclude": {"roles": _EDITORS, "params": {"staff": "string", "date": "string", "area": "string",
                                                              "why": "string"}},
    "staffProfileNoteAdd": {"roles": _EDITORS, "params": {"staff": "string", "category": "string",
                                                          "priority": "string", "details": "string"}},
    "staffProfileNoteState": {"roles": _EDITORS, "params": {"id": "string", "state": "string", "staff": "string"}},
    "staffProfileNoteEdit": {"roles": _EDITORS, "params": {"id": "string", "staff": "string", "changes": "array"}},
    "staffProfileAssignTraining": {"roles": ("admin", "director", "manager", "staff", "onboarding", "interviewer"),
                                   "params": {"staff": "string", "house": "string", "due_date": "string",
                                              "priority": "string", "details": "string"}},
    "staffProfileHrIssueAdd": {"roles": _WHOLE, "params": {k: "string" for k in (
        "staff", "date", "severity", "category", "summary", "details", "action", "next_review")}},
    "staffProfilePreferencesSave": {"roles": _EDITORS, "params": {"staff": "string", "prefs": "object",
                                                                  "expected": "string"}},
    "staffProfileEdit": {"roles": _EDITORS, "params": {"key": "string", "changes": "array",
                                                       "confirm_login_email": "boolean"}},
    "staffProfileAddressEdit": {"roles": ("admin", "director", "manager", "staff"),
                                "params": {"key": "string", "changes": "array"}},
    "staffProfileRename": {"roles": _MASTER, "params": {"key": "string", "changes": "array"}},
    "staffProfileDrivingEdit": {"roles": _EDITORS, "params": {"key": "string", "changes": "array"}},
    "staffProfileMaisEdit": {"roles": _EDITORS, "params": {"key": "string", "level": "string", "changes": "array"}},
    "staffProfileIstEdit": {"roles": _EDITORS, "params": {"key": "string", "id": "string", "changes": "array"}},
    "staffProfileIstAdd": {"roles": _EDITORS, "params": {"key": "string", "client": "string", "status": "string",
                                                         "day": "string"}},
}
# a write that finds the lock held is Apps Script's, but a door only Python has answers it with its own 409
BUSY_OF: dict[str, dict[str, Any]] = {"staffProfileNoteEdit": {"status": 409, "message": W.BUSY},
                                      "staffProfileDocConclude": {"status": 409, "message": W.BUSY},
                                      "staffProfileHrIssueAdd": {"status": 409, "message": W.BUSY},
                                      "staffProfileAssignTraining": {"status": 409, "message": W.BUSY},
                                      "staffProfileIstAdd": {"status": 409, "message": W.BUSY},
                                      "staffProfileRename": {"status": 503,
                                                             "message": "Another update is in progress — try again."}}


class Store(W.Store):
    """app.staff_writes and app.staff_receipts, beside Locations' and Clients' own; an IST record written in Postgres
    (app.resource_rows) is taken back with a void."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="staff", label="Staff")

    def settle(self, write_id: str, state: str, why: str = "", fields: list[str] | None = None) -> bool:
        done = super().settle(write_id, state, why, fields)
        if state == "void" and done:
            try:
                with self.conn().transaction():
                    RR.void(self.conn(), write_id)
            except Exception as exc:  # noqa: BLE001 - said, never raised into the relay's settle
                W.log.warning("staff: the void of %s was not applied to its rows (%s)", write_id[:40],
                              type(exc).__name__)
        return done
