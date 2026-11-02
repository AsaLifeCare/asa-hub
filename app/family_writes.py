"""Families' writes (apps-script/FamilyProfiles.gs) decided off asa-hub-db and kept in app.edits as the truth."""
from __future__ import annotations

import re
from typing import Any, Callable

import client_writes as CW
import clients as C
import family as F
import family_registry as FR
import gsjs
import house_tables as HT
import locations as L
import photos as P
import resource_rows as RR
import scope as sc
import staff_comms as SC
import writes as W
from scope import Defer
from writes import Decision

APP_ID = F.APP_ID
_TS = re.compile(r"\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}", re.A)
NOTES_HEADER = ("id", "family_key", "family_name", "body", "by", "at", "kind", "client_key", "incident_ts")
CALL_LABEL = "Family call"
CALL_WEEK_DAYS = 7
CALL_KEPT = "The call is kept in the Hub's database: the family member's Activity lists it at once, and the Task " \
            "Board, which reads its sheet, shows it once the sync carries it there (within about 10 minutes)."
NOTE_FIELDS = ("body", "state")
CALL_FIELDS = ("due", "priority", "state", "details")
NOTE_CACHES = "Families reads it from Postgres at once; the relay read the family member and the index again."
CALL_CACHES = "Families reads it from Postgres at once; the relay read the family member again; the Task Board, " \
              "which reads its sheet, shows it once the sync carries it there (within about 10 minutes)."
# FAM_EDIT_COLUMNS, FAM_EDIT_TIE and FAM_EDIT_PERSON
EDIT_COLUMNS = {"name": "guardianName", "phone": "guardian_phone", "email": "guardian_email",
                "address": "guardian_address"}
EDIT_TIE = {"rel_": "guardian_relationship", "papers_": "guardianship_papers"}
EDIT_PERSON = ("name", "phone", "email", "avatar")
CACHES = "Families reads it from Postgres at once; the relay read the family member, the switcher and the index again."


def edition_shut(sess: L.Session, edition: str) -> Decision | None:
    """famEditionDoor_: the master, or a listed holder of the write's edition who reads every family member."""
    env = F.edition_door(sess, edition)
    return Decision(env) if env else None


def notes_shut(sess: L.Session) -> Decision | None:
    """The notes edition, for whom the notes are open (family.notes_seen)."""
    shut = edition_shut(sess, F.EDITION["notes"])
    if shut:
        return shut
    view = F.view_of(sess)
    return None if view and F.notes_seen(view) else Decision(F.unknown())


def edition_of(sess: L.Session, edition: str) -> str:
    return "" if sc.is_real_master(sess.user) else edition


def refused(env: dict[str, Any]) -> Decision:
    """familyProfilesFamily_'s refusal: an unread source is Apps Script's; one resting on the records is fresh."""
    if env.get("status") == 503:
        raise Defer(str(env.get("message") or "the family records could not be read")[:160])
    return Decision(env, fresh=True)


def family_of(sess: L.Session, payload: dict) -> dict[str, Any]:
    return F.family_ctx(sess.reads, payload.get("family"))


def client_of(ctx: dict, payload: dict) -> dict | None:
    """One of this family member's clients, by the key the payload names."""
    ck = F._lt(payload.get("client_key"), 120)
    return next((c for c in ctx["family"]["clients"] if c["client_key"] == ck), None)


def note_row(ctx: dict, sess: L.Session, prefix: str, **cells: str) -> dict[str, str]:
    """A row of the notes tab, its id and time minted here."""
    row = {"id": W.mint(prefix), "family_key": ctx["key"], "family_name": ctx["name"], "body": "",
           "by": W.who(sess.user), "at": W.now_iso(sess.reads), "kind": "note", "client_key": "", "incident_ts": ""}
    row.update(cells)
    return row


def note_add(sess: L.Session, payload: dict) -> Decision:
    """familyProfileNoteAdd: refused here, or the note kept in app.edits."""
    shut = notes_shut(sess)
    if shut:
        return shut
    reads = sess.reads
    ctx = family_of(sess, payload)
    if ctx.get("refused"):
        return refused(ctx["refused"])
    body = gsjs.trim(gsjs.or_text(payload.get("body")))
    if not body:
        return W.refuse(400, "body: what the note says.")
    if CW.utf16_len(body) > F.NOTE_MAX:
        return W.refuse(400, f"body: up to {F.NOTE_MAX} characters.")
    W.gate(reads)
    res = W.tab_of(reads, F.NOTES_TAB)
    note = note_row(ctx, sess, "FAMN_", body=body)
    rec = W.append_record(res, NOTES_HEADER, note, ctx["key"])
    rec["edition"] = edition_of(sess, F.EDITION["notes"])
    answer = {"status": 200, "data": F.scrub({"note": {k: note[k] for k in ("id", "at", "by", "body")}})}
    return W.final(answer, [rec], ctx["key"])


def incident_tie(sess: L.Session, payload: dict) -> Decision:
    """familyProfileIncidentTie: refused here, or the tie kept in app.edits (none when it is already there)."""
    shut = edition_shut(sess, F.EDITION["incidents"])
    if shut:
        return shut
    reads = sess.reads
    ctx = family_of(sess, payload)
    if ctx.get("refused"):
        return refused(ctx["refused"])
    client = client_of(ctx, payload)
    if not client:
        return W.refuse(400, "client_key: one of this family member's clients.", fresh=True)
    ts = F._lt(payload.get("incident_ts"), 80)
    tie = F.incident_key(client["client_key"], ts) if _TS.match(ts) else ""
    if not tie:
        return W.refuse(400, "incident_ts: the report's timestamp, as it was filed.")
    W.gate(reads)
    res = W.tab_of(reads, F.NOTES_TAB)
    had = bool(F.incident_ties_of(F.own_rows(reads, ctx["key"])).get(tie))
    answer = {"status": 200, "data": {"tie": {"family": ctx["key"], "client_key": client["client_key"],
                                              "incident_ts": ts, "already": had}}}
    if had:
        return Decision(answer, fresh=(res.sheet_id,))
    row = note_row(ctx, sess, "FAMI_", kind="incident", client_key=client["client_key"], incident_ts=ts)
    rec = W.append_record(res, NOTES_HEADER, row, ctx["key"])
    rec["edition"] = edition_of(sess, F.EDITION["incidents"])
    return W.final(answer, [rec], ctx["key"])


def call_schedule(sess: L.Session, payload: dict) -> Decision:
    """familyProfileCallSchedule: refused here, or the card (and a holder's tie row) kept in app.edits."""
    shut = edition_shut(sess, F.EDITION["calls"])
    if shut:
        return shut
    reads = sess.reads
    ctx = family_of(sess, payload)
    if ctx.get("refused"):
        return refused(ctx["refused"])
    f = ctx["family"]
    client = client_of(ctx, payload)
    if not client:
        return W.refuse(400, "client_key: one of this family member's clients.", fresh=True)
    day = F._lt(payload.get("date"), 20)
    today = reads.today()
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", day, re.A) or gsjs.day_shift(gsjs.day_shift(day, 1), -1) != day:
        return W.refuse(400, "date: a day, yyyy-mm-dd.")
    if day < today:
        return W.refuse(400, "date: today or later.")
    priority = F._lt(payload.get("priority"), 20).lower() or "normal"
    if priority not in F.CALL_PRIORITIES:
        return W.refuse(400, "priority: one of " + ", ".join(F.CALL_PRIORITIES) + ".")
    details = gsjs.trim(gsjs.or_text(payload.get("details")))
    if CW.utf16_len(details) > F.NOTE_MAX:
        return W.refuse(400, f"details: up to {F.NOTE_MAX} characters.")
    me = gsjs.str_((sess.user or {}).get("id"))
    if not me:
        return W.refuse(404, 'No "tasks" record with id "".')
    rel = gsjs.or_text(client.get("relationship"))
    lines = [x for x in (details, "For: " + f["name"] + (" (" + rel + ")" if rel else ""), "Client: " + client["name"],
                         "Phone: " + f["phone"] if f.get("phone") else "") if x]
    now = W.now_iso(reads)
    column = "this-week" if day <= gsjs.day_shift(today, CALL_WEEK_DAYS) else "backlog"
    card = {"title": "Call " + f["name"] + " — " + client["name"], "description": "\n".join(lines), "column": column,
            "priority": priority, "due": day, "tint": "peach", "labels": W.json_text([CALL_LABEL]),
            "family_key": ctx["key"], "client_key": client["client_key"], "source": F.CALL_SOURCE, "ownerId": me,
            "id": W.mint(), "createdAt": now, "updatedAt": now}
    W.gate(reads)
    edition = edition_of(sess, F.EDITION["calls"])
    # the Task Board's cards live in Postgres once it is Python's (task_board): the card is made there
    kept = RR.uploaded(reads.db, "tasks")
    if kept:
        RR.create(reads, "tasks", card, W.who(sess.user))
        edits = []
    else:
        tasks = W.tab_of(reads, "tasks")
        sid, tab = W.where_of(tasks)
        edits = [W.kept_record(sid, tab, "append", "id", card["id"], ctx["key"], card, edition=edition)]
    if not sc.is_real_master(sess.user):
        # a holder's card is not the master's: a tie row lets the family member's activity find it
        notes = W.tab_of(reads, F.NOTES_TAB)
        tie = note_row(ctx, sess, "FAMC_", body=card["id"], kind="call", client_key=client["client_key"])
        rec = W.append_record(notes, NOTES_HEADER, tie, ctx["key"])
        rec["edition"] = edition
        edits.append(rec)
    answer = {"status": 200, "data": {"call": {
        "id": card["id"], "at": now, "due": day, "priority": priority, "client_key": client["client_key"],
        "client_name": client["name"], "details": details, "state": F.task_state(column), "board": "Task Board"},
        "notes": [CALL_KEPT]}}
    if kept:
        return Decision(answer, edits=[e for e in edits if e and e.get("cells")] or None, subject=ctx["key"], own=True)
    return W.final(answer, edits, ctx["key"])


def save(sess: L.Session, payload: dict) -> Decision:
    """familyProfileSave: every field refused or stale here, or the client records, the people-directory row and…"""
    shut = edition_shut(sess, F.EDITION["profile"])
    if shut:
        return shut
    reads = sess.reads
    ctx = family_of(sess, payload)
    if ctx.get("refused"):
        return refused(ctx["refused"])
    changes, bad = W.edit_changes(payload)
    if bad:
        return Decision(bad)
    if ctx["degraded"]:
        raise Defer("not every client record could be read here")
    edit = F.edit_of(reads, ctx, not sc.is_real_master(sess.user))
    edition = edition_of(sess, F.EDITION["profile"])
    out: list[dict] = []
    stale: dict[str, str] = {}
    written: list[dict] = []
    by_client: dict[str, dict[str, str]] = {}
    person: dict[str, str] = {}
    rename = ""
    for c in changes:
        f = c["field"]
        if f not in edit["raw"]:
            out.append({"field": f, "why": "Not a field this app edits."})
            continue
        if f in edit["locked"]:
            out.append({"field": f, "why": edit["locked"][f]["why"]})
            continue
        if C._marked(edit["raw"][f]):
            raise Defer("the copy withholds a cell this field's witness rests on")
        now = CW.witness(c["expected"], edit["raw"][f])
        if now is not None:
            stale[f] = now
            continue
        value = SC._js_slice(CW.fold_ws(c["value"]), 500)
        why = F.edit_check(f, value, ctx)
        if why:
            out.append({"field": f, "why": why})
            continue
        col = EDIT_COLUMNS.get(f)
        if col:
            for ck in edit["records"]:
                by_client.setdefault(ck, {})[col] = value
        else:
            for pre, column in EDIT_TIE.items():
                if f.startswith(pre) and f[len(pre):] in edit["records"]:
                    by_client.setdefault(f[len(pre):], {})[column] = value
        if edit["person_id"] and f in EDIT_PERSON:
            person[f] = value
        if f == "name":
            rename = value
        written.append({"field": f, "before": c["expected"], "after": value})

    failed: dict[str, str] = {}
    client_keys: list[str] = []
    edits: list[dict] = []
    names = {c["client_key"]: c["name"] for c in ctx["family"]["clients"]}

    def field_of(ck: str, column: str) -> str:
        hit = next((f for f, col in EDIT_COLUMNS.items() if col == column), "")
        return next((pre + ck for pre, col in EDIT_TIE.items() if col == column), hit)

    for ck, fields in by_client.items():
        def fail(cols: list[str], why: str, ck: str = ck) -> None:
            for column in cols:
                f = field_of(ck, column)
                if f and f not in failed:
                    failed[f] = "Not saved on " + (names.get(ck) or ck) + "'s record: " + why

        cols = list(fields)
        checked = CW.save_fields(dict(fields))
        if checked.get("refused"):
            fail(cols, gsjs.or_text(checked["refused"].get("message")))
            continue
        cctx = CW.client_of(reads, ck)
        if cctx.get("refused") or cctx.get("archived"):
            fail(cols, gsjs.or_text(cctx["refused"].get("message")) if cctx.get("refused")
                 else "the client is in the archive of old clients.")
            continue
        got = CW.profile_write(sess, cctx, checked["fields"])
        if got.get("refused"):
            fail(cols, gsjs.or_text((got["refused"].answer or {}).get("message")))
            continue
        rec = dict(got["record"])
        rec["edition"] = edition
        edits.append(rec)
        client_keys.append(ck)
    person_done = False
    if person:
        people = W.tab_of(reads, "people")
        sid, tab = W.where_of(people)
        cells = dict(person)
        if W.header_of(HT.where(reads, "people").ref, "updatedAt") is not None:
            cells["updatedAt"] = W.now_iso(reads)
        edits.append(W.kept_record(sid, tab, "edit", "id", gsjs.js_str(edit["person_id"]), ctx["key"], cells,
                                   edition=edition))
        person_done = True
    for w in [w for w in written if w["field"] in failed]:
        written.remove(w)
        out.append({"field": w["field"], "why": failed[w["field"]]})
    family = ctx["key"]
    if rename and any(w["field"] == "name" for w in written):
        to = F.key_of(F.fam_name(rename))
        if to and to != ctx["key"]:
            notes = W.tab_of(reads, F.NOTES_TAB)
            sid, tab = W.where_of(notes)
            for r in F.own_rows(reads, ctx["key"]):
                rid = gsjs.trim(gsjs.or_text(r.get("id")))
                if rid:
                    edits.append(W.kept_record(sid, tab, "edit", "id", rid, ctx["key"],
                                               {"family_key": to, "family_name": F.fam_name(rename)},
                                               {"family_key": ctx["key"], "family_name": gsjs.or_text(r.get("family_name"))},
                                               edition))
            family = to
    if not written:
        edits, client_keys, person_done = [], [], False
    data: dict[str, Any] = {"written": [w["field"] for w in written], "refused": out, "family": family,
                            "client_keys": client_keys,
                            "readonly": [{"client_key": t["client_key"], "name": t["name"], "why": t["why"]}
                                         for t in edit["ties"] if t["why"]]}
    if written:
        n = len(client_keys)
        where = f"The guardian columns on {n} client record{'' if n == 1 else 's'}" if n else ""
        if person_done:
            where = (where + " and " if where else "") + "the people-directory row"
        data = W.with_steps(data, W.pg_steps((where or "Nothing") + ", kept in the Hub's database.", CACHES, APP_ID))
    if stale:
        data["current"] = stale
        answer = {"status": 409, "data": data, "message": CW.STALE_SOME if written else CW.STALE_ALL}
    else:
        answer = {"status": 200, "data": data}
    if edits:
        return W.final(answer, edits, ctx["key"])
    return Decision(answer, fresh=True)


def note_edit(sess: L.Session, payload: dict) -> Decision:
    """familyProfileNoteEdit: a note's text or its removal, each field refused or stale here, or kept in app.edits."""
    shut = notes_shut(sess)
    if shut:
        return shut
    reads = sess.reads
    ctx = family_of(sess, payload)
    if ctx.get("refused"):
        return refused(ctx["refused"])
    nid = F._lt(payload.get("id"), 80)
    if not nid:
        return W.refuse(400, "id: which note.")
    changes, bad = W.edit_changes(payload)
    if bad:
        return Decision(bad)
    W.gate(reads)
    res = W.tab_of(reads, F.NOTES_TAB)
    row = W.row_by_id(F.notes_rows(reads), nid)
    if row is None or (gsjs.or_text(row.get("kind")) or "note") not in ("note", F.NOTE_REMOVED):
        return W.refuse(404, f'No admin note "{nid}".')
    if gsjs.or_text(row.get("family_key")) != ctx["key"]:
        return W.refuse(409, "That note has moved since it was opened — reload the family member.")
    if C._marked(row):
        raise Defer("the copy withholds a cell of this note")
    live = {"body": gsjs.or_text(row.get("body")), "state": F.note_state(row)}
    written: list[dict] = []
    out: list[dict] = []
    stale: dict[str, str] = {}
    cells: dict[str, str] = {}
    prior: dict[str, str] = {}
    for c in changes:
        f = c["field"]
        if f not in NOTE_FIELDS:
            out.append({"field": f, "why": "Not a field of an admin note."})
            continue
        if f == "body" and F.scrub(live["body"]) != live["body"]:
            out.append({"field": f, "why": F.NOTE_WITHHELD["why"]})
            continue
        now = CW.witness(c["expected"].lower() if f == "state" else c["expected"], live[f])
        if now is not None:
            stale[f] = now
            continue
        value = c["value"]
        if f == "body":
            if not value:
                out.append({"field": f, "why": "A note says something; remove the note instead."})
                continue
            if CW.utf16_len(value) > F.NOTE_MAX:
                out.append({"field": f, "why": f"Up to {F.NOTE_MAX} characters."})
                continue
            cells["body"], prior["body"] = value, live["body"]
        else:
            value = value.lower()
            if value not in F.NOTE_STATES:
                out.append({"field": f, "why": "One of " + ", ".join(F.NOTE_STATES) + "."})
                continue
            cells["kind"] = F.NOTE_REMOVED if value == "removed" else "note"
            prior["kind"] = gsjs.or_text(row.get("kind"))
        written.append({"field": f, "before": live[f], "after": value})
    answer = W.edit_answer(written, out, stale, W.pg_steps(
        f"{len(cells)} cell(s) of the note's row on {F.NOTES_TAB}, kept in the Hub's database.", NOTE_CACHES, APP_ID))
    if not written:
        return Decision(answer)
    sid, tab = W.where_of(res)
    rec = W.kept_record(sid, tab, "edit", "id", nid, ctx["key"], cells, prior, edition_of(sess, F.EDITION["notes"]))
    return W.final(answer, [rec], ctx["key"])


def call_day_why(day: str, today: str) -> str:
    """familyProfileCallSchedule's day rule: a real day, today or later; '' when it holds."""
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", day, re.A) or gsjs.day_shift(gsjs.day_shift(day, 1), -1) != day:
        return "A day, yyyy-mm-dd."
    return "Today or later." if day < today else ""


def call_edit(sess: L.Session, payload: dict) -> Decision:
    """familyProfileCallEdit: a call filed here (day, priority, state, details), refused or stale here, or kept…"""
    shut = edition_shut(sess, F.EDITION["calls"])
    if shut:
        return shut
    reads = sess.reads
    ctx = family_of(sess, payload)
    if ctx.get("refused"):
        return refused(ctx["refused"])
    cid = F._lt(payload.get("id"), 80)
    if not cid:
        return W.refuse(400, "id: which call.")
    changes, bad = W.edit_changes(payload)
    if bad:
        return Decision(bad)
    W.gate(reads)
    kept = RR.uploaded(reads.db, "tasks")
    tasks = None if kept else W.tab_of(reads, "tasks")
    ok, cards, err = F._try(lambda: F.calls_for(reads, ctx["key"], F.call_ties_of(F.own_rows(reads, ctx["key"]))))
    if not ok:
        return W.refuse(503, f"The scheduled calls could not be read just now ({err}).")
    card = next((r for r in cards if gsjs.str_(r.get("id")) == cid), None)
    if card is None:
        return W.refuse(404, f'No call "{cid}" scheduled from Families for this family member.')
    if C._marked(card):
        raise Defer("the copy withholds a cell of this call")
    live = F.call_raw(card)
    today = reads.today()
    written: list[dict] = []
    out: list[dict] = []
    stale: dict[str, str] = {}
    cells: dict[str, str] = {}
    state_to = ""
    for c in changes:
        f = c["field"]
        if f not in CALL_FIELDS:
            out.append({"field": f, "why": "Not a field of a scheduled call."})
            continue
        if f == "details" and F.scrub(live[f]) != live[f]:
            out.append({"field": f, "why": F.CALL_WITHHELD["why"]})
            continue
        now = CW.witness(c["expected"].lower() if f in ("priority", "state") else c["expected"], live[f])
        if now is not None:
            stale[f] = now
            continue
        value = c["value"]
        if f == "due":
            why = call_day_why(value, today)
            if why:
                out.append({"field": f, "why": why})
                continue
            cells["due"] = value
        elif f == "priority":
            value = value.lower() or "normal"
            if value not in F.CALL_PRIORITIES:
                out.append({"field": f, "why": "One of " + ", ".join(F.CALL_PRIORITIES) + "."})
                continue
            cells["priority"] = value
        elif f == "state":
            value = value.lower()
            if value not in F.CALL_STATES:
                out.append({"field": f, "why": "One of " + ", ".join(F.CALL_STATES) + "."})
                continue
            state_to = value
        else:
            if CW.utf16_len(value) > F.CALL_DETAILS_MAX:
                out.append({"field": f, "why": f"Up to {F.CALL_DETAILS_MAX} characters."})
                continue
            cells["description"] = value
        written.append({"field": f, "before": live[f], "after": value})
    column = gsjs.str_(card.get("column"))
    labels = F.labels_of(card.get("labels"))
    to = column
    if state_to:
        to = "done" if state_to == "cancelled" else state_to
        want = [w for w in labels if w != F.CALL_CANCELLED] + ([F.CALL_CANCELLED] if state_to == "cancelled" else [])
        if want != labels:
            cells["labels"] = W.json_text(want)
    elif "due" in cells and column in ("backlog", "this-week"):
        # the column follows the new day, as scheduling sets it
        to = "this-week" if cells["due"] <= gsjs.day_shift(today, CALL_WEEK_DAYS) else "backlog"
    if to != column:
        cells["column"] = to
    # RESOURCES.tasks stampWhen: completedAt set on entering Done, cleared on leaving it
    if kept:
        # the stamp is the resource's own, whatever columns the rows carry so far
        done_at = "completedAt"
        has_updated = True
    else:
        done_at = W.header_of(tasks.ref, "completedAt")
        has_updated = W.header_of(tasks.ref, "updatedAt") is not None
    if done_at and to != column and "done" in (to, column):
        cells[done_at] = W.now_iso(reads) if to == "done" else ""
    if written and has_updated:
        cells["updatedAt"] = W.now_iso(reads)
    answer = W.edit_answer(written, out, stale, W.pg_steps(
        f"{len(cells)} cell(s) of the call's card on tasks, kept in the Hub's database.", CALL_CACHES, APP_ID))
    if not written:
        return Decision(answer)
    had = card.get("labels")
    prior = {"due": live["due"], "priority": gsjs.or_text(card.get("priority")), "column": column,
             "labels": W.json_text(had) if isinstance(had, (list, dict)) else gsjs.or_text(had),
             "description": live["details"], "updatedAt": gsjs.or_text(card.get("updatedAt"))}
    if done_at:
        prior[done_at] = gsjs.or_text(card.get(done_at))
    if kept:
        hit = RR.find(reads, "tasks", cid)
        if hit is None:
            raise Defer(f"the call's card {cid} is not in Postgres")
        RR.update(reads, "tasks", hit[0], hit[1], cells, W.who(sess.user))
        return Decision(answer, subject=ctx["key"], own=True)
    sid, tab = W.where_of(tasks)
    rec = W.kept_record(sid, tab, "edit", "id", cid, ctx["key"], cells, prior, edition_of(sess, F.EDITION["calls"]))
    return W.final(answer, [rec], ctx["key"])


# ---- the registry (db/families.sql): a family member registered, and a paper kept on one ------------------------

PREFERRED = ("", "phone", "text", "email")
CLIENTS_MAX = 20
REGISTRY_CACHES = "Families reads it from Postgres at once; the relay read the family index and the family member again."
_PHONE_DIGITS = re.compile(r"1?\d{10}", re.A)
# a Drive file id, as Drive writes one
_FILE_ID = re.compile(r"[A-Za-z0-9_-]{10,200}", re.A)


def _by(sess: L.Session) -> tuple[str, str]:
    """(account, name): who the registry says made the change."""
    user = sess.user or {}
    return gsjs.str_(user.get("id")) or W.who(user), W.who(user)


def create(sess: L.Session, payload: dict) -> Decision:
    """familyCreate: a family member registered in Families' own tables, with the clients they are family of — by the
    master or a director (the family.create edition); final, and the first step of their Activity."""
    shut = edition_shut(sess, F.EDITION["create"])
    if shut:
        return shut
    reads = sess.reads
    name = F.fam_name(payload.get("name"))
    key = F.key_of(name)
    if not name or not key:
        return W.refuse(400, "name: the family member's full name — a person, not an agency.")
    relationship = F._lt(payload.get("relationship"), 80)
    if not relationship:
        return W.refuse(400, "relationship: how they are family — Mother, Brother, Aunt…")
    phone_raw = F._lt(payload.get("phone"), 40)
    if phone_raw and not _PHONE_DIGITS.fullmatch(re.sub(r"\D", "", phone_raw)):
        return W.refuse(400, "phone: a 10-digit US phone number.")
    mail_raw = F._lt(payload.get("email"), 200)
    mail = F.email(mail_raw)
    if mail_raw and not mail:
        return W.refuse(400, "email: an e-mail address.")
    preferred = F._lt(payload.get("preferred_contact"), 20).lower()
    if preferred not in PREFERRED:
        return W.refuse(400, "preferred_contact: phone, text or email.")
    notes = F._lt(payload.get("notes"), 0)
    if CW.utf16_len(notes) > F.NOTE_MAX:
        return W.refuse(400, f"notes: up to {F.NOTE_MAX} characters.")
    asked = payload.get("clients")
    if not isinstance(asked, list) or not asked:
        return W.refuse(400, "clients: at least one client they are family of.")
    if len(asked) > CLIENTS_MAX:
        return W.refuse(400, f"clients: up to {CLIENTS_MAX}.")
    known = {r["client_key"]: r for r in (C.roster_row(c, None) for c in C.derived(reads)) if r["client_key"]}
    clients: list[dict[str, Any]] = []
    for item in asked:
        one = item if isinstance(item, dict) else {"client_key": item}
        ck = F._lt(one.get("client_key"), 120)
        if ck not in known:
            return W.refuse(400, f'clients: "{SC._js_slice(ck, 60)}" is not a client on file.', fresh=True)
        if any(c["client_key"] == ck for c in clients):
            continue
        clients.append({"client_key": ck, "name": known[ck]["name"],
                        "relationship": F._lt(one.get("relationship"), 80) or relationship,
                        "guardian": one.get("guardian") is True})
    if FR.exists(key):
        return W.refuse(409, f"{name} is already registered in Families.", data={"family_key": key})
    by, by_name = _by(sess)
    FR.add_family({"key": key, "name": name, "relationship": relationship, "phone": phone_raw, "email": mail,
                   "address": F._lt(payload.get("address"), 300), "preferred_contact": preferred, "notes": notes},
                  clients, by, by_name)
    FR.add_event(key, "created", "Family member registered",
                 {"text": f"{relationship} of " + ", ".join(c["name"] for c in clients) + ".",
                  "clients": [c["client_key"] for c in clients]}, by, by_name)
    for c in clients:
        FR.add_event(key, "client_tied", f"Tied to {c['name']}",
                     {"text": c["relationship"] + (" · guardian" if c["guardian"] else ""), "client_key": c["client_key"]},
                     by, by_name)
    answer = {"status": 200, "data": {"family_key": key, "name": name,
                                      **W.pg_steps(f"{name} registered", REGISTRY_CACHES, APP_ID)}}
    return Decision(answer, subject=key, own=True, edition=edition_of(sess, F.EDITION["create"]))


def _ensure_registered(ctx: dict, by: str, by_name: str) -> None:
    """A family member Families reads off the client records joins the registry the first time a paper is kept on
    them: their details and clients as read now, and that step on their Activity."""
    if FR.exists(ctx["key"]):
        return
    f = ctx["family"]
    clients = [{"client_key": c["client_key"], "relationship": c.get("relationship") or "", "guardian": False}
               for c in f.get("clients") or []]
    rels = f.get("relationships") or []
    FR.add_family({"key": ctx["key"], "name": f.get("name") or ctx["name"], "relationship": rels[0] if rels else "",
                   "phone": f.get("phone") or "", "email": f.get("email") or "", "address": f.get("address") or "",
                   "preferred_contact": "", "notes": ""}, clients, by, by_name)
    FR.add_event(ctx["key"], "created", "Family member registered",
                 {"text": "Registered from the client records when a paper was first kept on them."}, by, by_name)


def doc_add(sess: L.Session, payload: dict) -> Decision:
    """familyProfileDocAdd: a paper kept on a family member in Families' own tables — one the relay just filed in Drive
    as asatech (`filed`), or a Drive file already there (`drive`) — by the master or a director (family.documents)."""
    shut = edition_shut(sess, F.EDITION["documents"])
    if shut:
        return shut
    ctx = family_of(sess, payload)
    if ctx.get("refused"):
        return refused(ctx["refused"])
    title = F._lt(payload.get("title"), 120)
    doc_type = F._lt(payload.get("doc_type"), 80)
    filed = payload.get("filed") if isinstance(payload.get("filed"), dict) else None
    if filed is not None:
        fid = gsjs.trim(gsjs.or_text(filed.get("file_id")))
        name = title or F._lt(filed.get("name"), 200)
        kind = F._lt(filed.get("mime"), 120)
        size = filed.get("size") if isinstance(filed.get("size"), int) else 0
        source = "upload"
    else:
        fid = L.drive_id(payload.get("drive")) or gsjs.trim(gsjs.or_text(payload.get("drive")))
        name, kind, size, source = title, "", 0, "drive"
    if not _FILE_ID.fullmatch(fid or ""):
        return W.refuse(400, "drive: a Drive link or file id." if filed is None else "filed: the file Drive took.")
    if filed is None:
        drive = sess.reads.drive
        if drive is None or not getattr(drive, "available", False):
            return W.refuse(503, "Drive cannot be asked about the file just now. Nothing was kept.")
        try:
            meta = drive.file_meta(fid)
        except Exception:  # noqa: BLE001 - said in words, nothing kept
            return W.refuse(400, "That Drive file could not be opened with the platform's account. Nothing was kept.")
        name = name or F._lt(meta.get("name"), 200)
        kind = F._lt(meta.get("mimeType"), 120)
    by, by_name = _by(sess)
    _ensure_registered(ctx, by, by_name)
    doc_id = FR.add_document(ctx["key"], {"drive_id": fid, "name": name or "Family document", "doc_type": doc_type,
                                          "mime": kind, "size": size, "source": source}, by, by_name)
    FR.add_event(ctx["key"], "document_added", f"Document added — {name or 'Family document'}",
                 {"text": doc_type or ("Filed in Drive" if source == "upload" else "Linked from Drive"),
                  "doc_id": doc_id}, by, by_name)
    answer = {"status": 200, "data": {"family_key": ctx["key"],
                                      "document": {"id": "fd_" + doc_id, "file_id": fid, "title": name, "mime": kind},
                                      **W.pg_steps("The paper kept on " + ctx["name"], REGISTRY_CACHES, APP_ID)}}
    return Decision(answer, subject=ctx["key"], own=True, edition=edition_of(sess, F.EDITION["documents"]))


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {
    "familyProfilePhoto": P.door("family"), "familyProfileNoteAdd": note_add,"familyProfileIncidentTie": incident_tie,
    "familyProfileCallSchedule": call_schedule, "familyProfileSave": save,
    "familyProfileNoteEdit": note_edit, "familyProfileCallEdit": call_edit,
    "familyCreate": create, "familyProfileDocAdd": doc_add,
}
_WRITERS = sc.EDITION_ROLES
# HUB_POLICY: the roles each write is declared for (every employee an edition can list), and its typed params
POLICY: dict[str, dict[str, Any]] = {
    "familyProfilePhoto": P.policy("family"),
    "familyProfileNoteAdd":{"roles": _WRITERS, "params": {"family": "string", "body": "string"}},
    "familyProfileIncidentTie": {"roles": _WRITERS, "params": {"family": "string", "client_key": "string",
                                                               "incident_ts": "string"}},
    "familyProfileCallSchedule": {"roles": _WRITERS, "params": {"family": "string", "client_key": "string",
                                                                "date": "string", "priority": "string",
                                                                "details": "string"}},
    "familyProfileSave": {"roles": _WRITERS, "params": {"family": "string", "changes": "array"}},
    "familyProfileNoteEdit": {"roles": _WRITERS, "params": {"family": "string", "id": "string", "changes": "array"}},
    "familyProfileCallEdit": {"roles": _WRITERS, "params": {"family": "string", "id": "string", "changes": "array"}},
    "familyCreate": {"roles": _WRITERS, "params": {"name": "string", "relationship": "string", "phone": "string",
                                                   "email": "string", "address": "string",
                                                   "preferred_contact": "string", "notes": "string",
                                                   "clients": "array"}},
    "familyProfileDocAdd": {"roles": _WRITERS, "params": {"family": "string", "title": "string", "doc_type": "string",
                                                          "drive": "string", "filed": "object"}},
}
# a write that finds the lock held: the registry's own doors say so (the others lock after refusals this side cannot
# order)
BUSY_OF: dict[str, dict[str, Any]] = {"familyCreate": {"status": 409, "message": W.BUSY},
                                      "familyProfileDocAdd": {"status": 409, "message": W.BUSY}}


class Store(W.Store):
    """app.family_writes and app.family_receipts, beside the other apps' own."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="family", label="Families & Guardians")
