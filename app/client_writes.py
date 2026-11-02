"""Clients' writes (ClientProfiles.gs, Meds.gs, Clients.gs) decided off asa-hub-db: the profile, a care or family…"""
from __future__ import annotations

import json
import re
import uuid
from typing import Any, Callable

import book_ops as BO
import clients as C
import gsjs
import hubdb
import locations as L
import photos as P
import scope as sc
import staff_views
import writes as W
from gsjs import name_key
from scope import Defer
from writes import Decision

APP_ID = C.APP_ID
# Editions.gs: the profile pencil, the care rows, the family members and the chart rows
EDITION = {"profile": "clients.profile", "care": "clients.care", "family": "clients.family",
           "meds": "clients.medication"}
OVERRIDES_HEADER = ("id", "client_key", "kind", "tab", "target", "record", "text", "name", "relationship", "phone",
                    "email", "state", "by", "at")
REVIEWS_HEADER = ("id", "client_key", "client_name", "incident_ts", "status", "by", "at")
# the Hub tabs a first write makes (hubTabEnsure_): its header, before the copy holds the tab
VIRTUAL = {C.OVERRIDES_TAB: OVERRIDES_HEADER, C.REVIEWS_TAB: REVIEWS_HEADER}
OVERRIDE_FIELDS = {"care": ("record", "text", "removed"),
                   "family": ("name", "relationship", "phone", "email", "removed")}
NEVER_WRITTEN = re.compile(r"ssn|social|tlcard|debitcard|cardnumber|cardlast|^dc|pin|securitycode|cvv|ccv")
EDIT_PROTECTED = "Protected: never written from the Hub."
EDIT_LOCKED = {
    "name": "The name joins the client's Master, plan and Hub rows, so a rename files through its own door.",
    "status": "Moving a client between the Master and the archive of old clients files through its own door."}
EDIT_WORDS = {
    "profile": ("The client's row on the Hub clients tab.", "The client's profile and the roster, read again."),
    "care": ("The care record on the Hub client_overrides tab.", "The client's Care & Support, read again."),
    "meds": ("The medicine's row on the Hub medications tab (the eMAR list).", "The client's Medication, read again."),
}
KEPT_WORDS = {
    "profile": ("The client's row on the Hub clients tab, kept in the Hub's database.",
                "The client's profile and the roster, read again."),
    "care": ("The care record on the Hub client_overrides tab, kept in the Hub's database.",
             "The client's Care & Support, read again."),
    "family": ("The family member on the Hub client_overrides tab, kept in the Hub's database.",
               "The client's profile and its family members, read again."),
    "meds": ("The medicine's row on the Hub medications tab (the eMAR list), kept in the Hub's database.",
             "The client's Medication, read again."),
}
# CP_MASTER_WRITE_THROUGH: the profile columns the Asa Client Database Master row carries too
MASTER_WRITE_THROUGH = ("house",)
ARCHIVED = "This client is in the archive of old clients; the archive is not edited here."
STALE_ALL = "Changed since the panel was opened — reloaded, nothing was written."
STALE_SOME = "Some fields changed since the panel was opened — reloaded; the others were saved."
WITNESS_STALE = "Changed since it was opened — reloaded, nothing was written."
MEDS_TAB = "medications"
MED_ID = re.compile(r"^[A-Za-z0-9_.\-]{1,64}$")
MEDS_FIELDS = tuple(C.MEDS_EDIT_COLUMNS)
# JavaScript's \s (Python's also takes \x1c-\x1f and \x85, and not ﻿)
_JS_WS = re.compile("[\t\n\x0b\x0c\r \xa0  -     　﻿]+")
# names every JavaScript object answers: the door's lookups find them, a port's do not
_PROTO = frozenset({"constructor", "__proto__"})
_NAME_OK = re.compile(r"^[A-Za-zÀ-ɏ][A-Za-zÀ-ɏ .,'\-]*$")


# ---- the cells, as the doors write them ----------------------------------------------------------------------------

def fold_ws(s: str) -> str:
    return _JS_WS.sub(" ", s)


def js_cut(s: str, n: int) -> str:
    """String.prototype.slice(0, n), in UTF-16 units: a cut through a surrogate pair is the door's own."""
    if any(ord(ch) > 0xFFFF for ch in s):
        if len(s.encode("utf-16-le")) // 2 > n:
            raise Defer("a value JavaScript cuts by its own units")
        return s
    return s[:n]


def cleared_next(was: Any, fields: dict[str, Any]) -> str:
    """hubEditClearedNext_."""
    now = C.edit_cleared(was)
    for col, v in fields.items():
        if gsjs.trim(C.edit_text(v)):
            now.pop(col, None)
        elif re.fullmatch(r"[A-Za-z][A-Za-z0-9_]{0,63}", col):
            now[col] = True
    return ",".join(sorted(now))


def witness(expected: Any, current: Any) -> str | None:
    """hubEditWitness_: None while the record holds `expected`, else what it holds now."""
    now = C.edit_text(current)
    return None if C.edit_text(expected) == now else now


def denied() -> dict[str, Any]:
    """hubDenied_."""
    return {"status": 403, "message": "Requires an admin or manager account"}


def writer(user: dict | None) -> bool:
    """hubIsWriter_."""
    return gsjs.js_str((user or {}).get("role")) in ("admin", "manager")


def edit_steps(got: dict[str, Any], kind: str = "") -> dict[str, Any]:
    """cpEditSteps_."""
    d = got.get("data")
    if got.get("status") != 200 or not isinstance(d, dict) or not d.get("written"):
        return got
    words = EDIT_WORDS.get(kind) or EDIT_WORDS["profile"]
    d["steps"] = [{"id": "sheet", "label": "Sheet", "landed": True, "words": words[0]},
                  {"id": "cache", "label": "Kept caches", "landed": True, "words": words[1]}]
    d["slices"] = [] if kind else ["clients"]
    d["mirror"] = ["houses"] if "house" in d["written"] else []
    d["app"] = APP_ID
    return got


def stale_answer(data: dict[str, Any], stale: dict[str, str], written: list, kind: str = "") -> dict[str, Any]:
    if stale:
        data["current"] = stale
        return {"status": 409, "data": data, "message": STALE_SOME if written else STALE_ALL}
    return edit_steps({"status": 200, "data": data}, kind)


def kept_answer(data: dict[str, Any], stale: dict[str, str], written: list, kind: str = "profile") -> dict[str, Any]:
    """stale_answer for a write kept in Postgres: the Apply strip names that store."""
    if stale:
        data["current"] = stale
        return {"status": 409, "data": data, "message": STALE_SOME if written else STALE_ALL}
    if written:
        data.update(W.pg_steps(KEPT_WORDS[kind][0], KEPT_WORDS[kind][1], APP_ID))
    return {"status": 200, "data": data}


def edition_for(sess: L.Session, edition: str) -> str:
    """The edition a person's write came in by; the master's names none."""
    return "" if sc.is_real_master(sess.user) else edition


def door_refused(env: dict[str, Any]) -> Decision:
    if env.get("status") == 503:
        raise Defer(str(env.get("message") or "the client could not be read")[:160])
    return Decision(env, fresh=env.get("status") == 404 and env.get("message") != "Unknown action.")


def marked(*vals: Any) -> None:
    if any(C._marked(v) for v in vals):
        raise Defer("the copy withholds a cell this decision rests on")


def no_proto(*names: str) -> None:
    if any(n in _PROTO for n in names):
        raise Defer("a name JavaScript's own objects answer")


# ---- the doors -----------------------------------------------------------------------------------------------------

def edit_door(sess: L.Session, payload: dict, edition: str) -> dict[str, Any] | None:
    """cpProfileEditDoor_: the master; else a listed holder of the edition, for a client they read (never own)."""
    user = sess.user
    if sc.is_real_master(user):
        return None if writer(user) else denied()
    if not sc.edition_allows(edition, user or {}, sess.reads.config()):
        return C.unknown()
    rdr = C.reader_for(sess, payload.get("client"))
    return None if rdr and not C.own_only(rdr) else C.unknown()


def master_door(sess: L.Session) -> dict[str, Any] | None:
    """clientProfilesGate_, then hubIsWriter_."""
    if not sc.is_real_master(sess.user):
        return C.unknown()
    return None if writer(sess.user) else denied()


def client_of(reads: L.Reads, raw: Any) -> dict[str, Any]:
    """clientProfilesClient_; what this side could not read is Apps Script's to answer."""
    ctx = C.client_ctx(reads, raw)
    if (ctx.get("refused") or {}).get("status") == 503:
        raise Defer(str(ctx["refused"].get("message"))[:160])
    return ctx


def one_change(payload: dict, field: str) -> tuple[dict | None, list[dict], dict | None]:
    """cpOneChange_: (the change, the others refused, None) or (None, [], the refusal)."""
    changes, bad = W.edit_changes(payload)
    if bad:
        return None, [], bad
    change, refused = None, []
    for c in changes:
        if c["field"] == field:
            change = c
        else:
            refused.append({"field": c["field"], "why": "Not a field this door edits."})
    if change is None:
        return None, [], {"status": 400, "message": 'changes: one { field: "' + field + '", value, expected }.'}
    return change, refused, None


def tab_record(res: hubdb.Resolved, kind: str, match: str, key: str, client: str, cells: dict) -> dict[str, Any]:
    """The cells as the sheet holds them once written (hubCellSafe_'s apostrophe is the write's, not the cell's)."""
    sid, tab = W.where_of(res)
    return {"sheet_id": sid, "tab_name": tab, "kind": kind, "match": match, "keyed": "header", "row_key": key,
            "house": client, "cells": {k: W.sheet_text(v) for k, v in cells.items()}}


# ---- the profile pencil (clientProfileSave) ------------------------------------------------------------------------

def edit_refusal(field: str, cols: dict[str, str]) -> str:
    """cpEditRefusal_."""
    if NEVER_WRITTEN.search(C.fold(field)):
        return EDIT_PROTECTED
    if field in EDIT_LOCKED:
        return EDIT_LOCKED[field]
    return "" if field in cols else "Not a field this app edits."


def profile_write(sess: L.Session, ctx: dict, fields: dict[str, str]) -> dict[str, Any]:
    """cpProfileWrite_ without the Master write-through: { record, id } or { refused }."""
    reads = sess.reads
    target = next((r for r in C._hub(reads, "clients")
                   if (gsjs.trim(gsjs.or_text(r.get("client_key"))) or name_key(r.get("name"))) == ctx["key"]), None)
    W.gate(reads)
    res = W.tab_of(reads, "clients")
    was = gsjs.or_text(target.get("cleared_fields")) if target else ""
    nxt = cleared_next(was, fields)
    if target is not None:
        if target.get("id") is None or target.get("id") == "":
            return {"refused": W.refuse(400, 'Missing required "id" in payload.', fresh=True)}
        cells = dict(fields)
        if nxt != was:
            cells["cleared_fields"] = nxt
        return {"id": gsjs.js_str(target.get("id")), "record": tab_record(res, "edit", "client", ctx["key"], ctx["key"],
                                                                          cells)}
    now = W.now_iso(reads)
    rec = {"id": "CLI_" + ctx["key"], "client_key": ctx["key"], "name": ctx["name"], **fields}
    if nxt:
        rec["cleared_fields"] = nxt
    rec["createdAt"] = now
    rec["updatedAt"] = now
    return {"id": rec["id"], "record": tab_record(res, "append", "client", ctx["key"], ctx["key"], rec)}


def master_cells(reads: L.Reads, ctx: dict, col: str, value: str) -> dict[str, Any]:
    """cpMasterWriteHeld_ kept in app.edits: { edit }, { done } (the row holds it), { absent } or { why }."""
    sid = C.client_db_id(reads)
    ref = reads.tab_of(sid, C.MASTER_TAB, "the Asa Client Database")
    if ref is None:
        return {"why": "The Asa Client Database Master could not be written (the book has no Master tab)."}
    names = [h for h in ref.headers if C.BOOK_FIELDS.get(C.fold(h)) == "name"]
    at_col = next((h for h in ref.headers if C.BOOK_FIELDS.get(C.fold(h)) == col), None)
    if at_col is None or not names:
        return {"why": "The Asa Client Database Master has no column for this field."}
    rows = reads.db.rows(ref)
    key = name_key(ctx["name"])

    def who(raw: dict) -> str:
        return next((t for t in (gsjs.text(gsjs.or_blank(raw.get(h))) for h in names) if t), "")

    hits = [i for i, (_rn, raw) in enumerate(rows) if who(raw) and name_key(who(raw)) == key]
    if not hits:
        return {"absent": True}
    if len(hits) > 1:
        return {"why": "Two rows of the Asa Client Database Master carry this name, so neither was moved."}
    now = gsjs.text(gsjs.or_blank(rows[hits[0]][1].get(at_col)))
    if now == value:
        return {"done": True}
    got = W.row_key_of(rows, hits[0], [names] + [[h] for h in names])
    if got is None:
        return {"why": "The client's Master row cannot be told apart from another one, so it was not moved."}
    head = gsjs.trim(gsjs.js_str(at_col))
    return {"edit": W.kept_record(sid, ref.tab, "edit", got[0], got[1], ctx["key"], {head: value}, {head: now})}


def profile_cells(sess: L.Session, ctx: dict, fields: dict[str, str],
                  before: dict[str, str] | None = None) -> dict[str, Any]:
    """cpProfileWrite_ kept in app.edits — the Hub row (made when it has none) and the Master write-through: {…"""
    reads = sess.reads
    fields = dict(fields)
    hub = C._hub(reads, "clients")
    target = next((r for r in hub
                   if (gsjs.trim(gsjs.or_text(r.get("client_key"))) or name_key(r.get("name"))) == ctx["key"]), None)
    W.gate(reads)
    res = W.tab_of(reads, "clients")
    if target is not None and (target.get("id") is None or target.get("id") == ""):
        return {"refused": W.refuse(400, 'Missing required "id" in payload.', fresh=True)}
    tid = gsjs.js_str(target.get("id")) if target is not None else ""
    if tid and sum(1 for r in hub if gsjs.js_str(r.get("id")) == tid) > 1:
        return {"refused": W.refuse(409, "Two rows of the Hub clients tab carry this client's id, so neither was "
                                         "written — reload the client.", fresh=True)}
    edits: list[dict] = []
    failed: list[dict] = []
    notes: list[str] = []
    for col in MASTER_WRITE_THROUGH:
        if col not in fields:
            continue
        m = master_cells(reads, ctx, col, gsjs.or_blank(fields[col]))
        if m.get("why"):
            failed.append({"column": col, "why": m["why"]})
            fields.pop(col)
        elif m.get("absent"):
            notes.append(col + ": the Asa Client Database Master has no row for this client, so only the Hub record "
                               "carries it.")
        elif m.get("edit"):
            edits.append(m["edit"])
    if not fields:
        return {"edits": [], "id": "", "failed": failed, "notes": notes}
    was = gsjs.or_text(target.get("cleared_fields")) if target else ""
    nxt = cleared_next(was, fields)
    now = W.now_iso(reads)
    sid, tab = W.where_of(res)
    if target is not None:
        cells = dict(fields)
        if nxt != was:
            cells["cleared_fields"] = nxt
        cells["updatedAt"] = now
        edits.append(W.kept_record(sid, tab, "edit", "id", tid, ctx["key"], cells, before))
        return {"edits": edits, "id": tid, "failed": failed, "notes": notes}
    rec = {"id": "CLI_" + ctx["key"], "client_key": ctx["key"], "name": ctx["name"], **fields}
    if nxt:
        rec["cleared_fields"] = nxt
    rec["createdAt"] = now
    rec["updatedAt"] = now
    edits.append(W.kept_record(sid, tab, "append", "id", rec["id"], ctx["key"], rec))
    return {"edits": edits, "id": rec["id"], "failed": failed, "notes": notes}


def house_cells(sess: L.Session, key: str, code: str, registry: set[str]) -> dict[str, Any]:
    """locationClientsAdd's cpProfileEdit_ of one client's house: { edits } or { why }."""
    reads = sess.reads
    ctx = C.client_ctx(reads, key)
    if ctx.get("refused"):
        return {"why": gsjs.js_str(ctx["refused"].get("message")) or "The client could not be read."}
    if ctx.get("archived"):
        return {"why": f"{ctx['name']} is in the archive of old clients."}
    if C.sources_of(reads, ctx)["degraded"]:
        return {"why": "Part of the client record could not be read just now, so nothing was written."}
    if code not in registry:
        return {"why": "Not a house on the Locations registry."}
    got = profile_cells(sess, ctx, {"house": code})
    if got.get("refused"):
        return {"why": gsjs.js_str((got["refused"].answer or {}).get("message")) or "The client's record was not written."}
    if got["failed"]:
        return {"why": " ".join(f["why"] for f in got["failed"])}
    return {"edits": got["edits"]}


def profile_edit(sess: L.Session, ctx: dict, payload: dict) -> Decision:
    """cpProfileEdit_."""
    reads = sess.reads
    changes, bad = W.edit_changes(payload)
    if bad:
        return Decision(bad)
    no_proto(*(c["field"] for c in changes))
    if ctx.get("archived"):
        return W.refuse(409, ARCHIVED, fresh=True)
    src = C.sources_of(reads, ctx)
    if src["degraded"]:
        raise Defer("part of the client record could not be read here")
    row = ctx.get("row") or {}
    live = C.scrub(C.edit_raw(C.picker(row, src["mf"], src["tf"])))
    cols = C.edit_columns()
    fields: dict[str, str] = {}
    written: list[dict] = []
    refused: list[dict] = []
    stale: dict[str, str] = {}
    homes: set[str] | None = None
    on_copy = False
    for c in changes:
        f = c["field"]
        why = edit_refusal(f, cols)
        if why:
            refused.append({"field": f, "why": why})
            continue
        fell: list[str] = []
        C.picker(row, src["mf"], src["tf"], fell)(*C.FIELD_NAMES.get(cols[f], (cols[f],)))
        if fell and src["tstale"]:
            raise Defer("Drive changed Master Data after the Hub's copy of it was made, and it witnesses this field")
        marked(live.get(f))
        now = witness(c["expected"], live.get(f))
        if now is not None:
            stale[f] = now
            continue
        value = js_cut(fold_ws(c["value"]), 500)
        if f == "house" and value:
            if homes is None:
                got, why_h = L._soft(reads.homes)
                if got is None:
                    raise Defer(f"the house registry could not be read here ({why_h})")
                homes = {h["code"] for h in got}
            value = value.upper()
            if value not in homes:
                on_copy = True
                refused.append({"field": f, "why": "Not a house on the Locations registry."})
                continue
        fields[cols[f]] = value
        written.append({"field": f, "before": c["expected"], "after": value})
    if not written:
        data: dict[str, Any] = {"written": [], "refused": refused}
        return Decision(stale_answer(data, stale, written), fresh=bool(stale or on_copy))
    got = profile_cells(sess, ctx, fields, {cols[w["field"]]: w["before"] for w in written})
    if got.get("refused"):
        return got["refused"]
    for f in got["failed"]:
        k = next((x for x in cols if cols[x] == f["column"]), f["column"])
        written = [w for w in written if w["field"] != k]
        refused.append({"field": k, "why": f["why"]})
    data = {"written": [w["field"] for w in written], "refused": refused}
    if got["notes"]:
        data["notes"] = got["notes"]
    return W.final(kept_answer(data, stale, written), got["edits"], ctx["key"], edition_for(sess, EDITION["profile"]))


def save_fields(raw: Any) -> dict[str, Any]:
    """clientProfileSaveFields_."""
    if not isinstance(raw, dict):
        return {"refused": {"status": 400, "message": "fields: the profile fields to save, by name."}}
    out: dict[str, str] = {}
    never: list[str] = []
    unknown: list[str] = []
    for k, v in raw.items():
        col = C.SAVE_ALIASES.get(k, k)
        if NEVER_WRITTEN.search(C.fold(k)):
            never.append(k)
            continue
        if col not in C.SAVE_FIELDS or isinstance(v, (dict, list)):
            unknown.append(k)
            continue
        out[col] = js_cut(gsjs.trim(fold_ws(gsjs.or_blank(v))), 500)
    if never:
        return {"refused": {"status": 422,
                            "message": "SSN, card, DC and PIN are never written here (" + ", ".join(never) + ")."}}
    if unknown:
        return {"refused": {"status": 422, "message": "Not a profile field: " + ", ".join(unknown) + "."}}
    if not out:
        return {"refused": {"status": 400, "message": "fields: nothing to save."}}
    return {"fields": out}


def profile_save(sess: L.Session, payload: dict) -> Decision:
    """clientProfileSave: the changes the pencil sends; the older `fields` save is decided here and written there."""
    shut = edit_door(sess, payload, EDITION["profile"])
    if shut:
        return door_refused(shut)
    ctx = client_of(sess.reads, payload.get("client"))
    if ctx.get("refused"):
        return door_refused(ctx["refused"])
    if "changes" in payload:
        return profile_edit(sess, ctx, payload)
    checked = save_fields(payload.get("fields"))
    if checked.get("refused"):
        return Decision(checked["refused"])
    if ctx.get("archived"):
        return W.refuse(409, ARCHIVED, fresh=True)
    fields = dict(checked["fields"])
    got = profile_cells(sess, ctx, fields)
    if got.get("refused"):
        return got["refused"]
    for f in got["failed"]:
        fields.pop(f["column"], None)
    data: dict[str, Any] = {"saved": True, "row": C.scrub({"id": got["id"], "client_key": ctx["key"], **fields})}
    if got["failed"]:
        data["refused"] = [{"field": f["column"], "why": f["why"]} for f in got["failed"]]
    return W.final({"status": 200, "data": data}, got["edits"], ctx["key"], edition_for(sess, EDITION["profile"]))


# ---- a care row or a family member over the plan (clientProfileOverride) -------------------------------------------

def override_live(reads: L.Reads, ctx: dict, kind: str, tab: str, target: str) -> dict[str, Any]:
    """cpOverrideLive_: { edit, target, id }, or { refused }."""
    blank = {f: "" for f in OVERRIDE_FIELDS[kind]}
    if not target:
        return {"edit": blank, "target": "", "id": ""}

    def shown_of() -> dict | None:
        if kind == "family":
            isp = C.isp_row(reads, ctx["key"])
            people, _w = L._soft(lambda: C.people_index(reads))
            return next((m for m in C.family_of(reads, ctx, isp, people) if m.get("key") == target), None)
        return next((r for r in C.care_build(reads, ctx, tab)["rows"]
                     if r.get("id") == target and isinstance(r.get("edit"), dict)), None)

    shown, why = L._soft(shown_of)
    if why:
        raise Defer(f"the record could not be read here ({why})")
    if shown is None:
        return {"refused": {"status": 404, "message": "That record is no longer on this client's profile — reload it."}}
    shown = C.scrub(shown)
    edit = {f: gsjs.or_text(shown.get("text")) if f == "text" else gsjs.or_text((shown.get("edit") or {}).get(f))
            for f in OVERRIDE_FIELDS[kind]}
    marked(*edit.values())
    mine = C.overrides_for(reads, ctx["key"], kind)
    added = next((o for o in mine if gsjs.js_str(o.get("id")) == target and gsjs.falsy(o.get("target"))),
                 None) if target.startswith("CO_") else None
    if added is not None:
        return {"edit": edit, "target": "", "id": gsjs.js_str(added.get("id"))}
    over = next((o for o in mine if gsjs.js_str(o.get("target")) == target and gsjs.or_text(o.get("tab")) == tab), None)
    return {"edit": edit, "target": target, "id": gsjs.js_str(over.get("id")) if over else ""}


def override_id(key: str, kind: str) -> str:
    """cpOverrideWrite_'s id: CO_<client>_<kind>_ and ten hex of a uuid."""
    return f"CO_{key}_{kind}_{uuid.uuid4().hex[:10]}"


def override(sess: L.Session, payload: dict) -> Decision:
    """clientProfileOverride."""
    reads, user = sess.reads, sess.user
    kind = gsjs.text(payload.get("kind")).lower()
    no_proto(kind)
    if kind in OVERRIDE_FIELDS:
        shut = edit_door(sess, payload, EDITION[kind])
    else:
        shut = master_door(sess)
    if shut:
        return door_refused(shut)
    ctx = client_of(reads, payload.get("client"))
    if ctx.get("refused"):
        return door_refused(ctx["refused"])
    if kind not in OVERRIDE_FIELDS:
        return W.refuse(400, "kind: care or family.")
    tab = gsjs.text(payload.get("tab")).lower() if kind == "care" else ""
    if kind == "care" and tab not in C.OVERRIDE_TABS:
        return W.refuse(400, "tab: one of " + ", ".join(C.OVERRIDE_TABS) + ".")
    target = gsjs.text(payload.get("target"), 200)
    changes, bad = W.edit_changes(payload)
    if bad:
        return Decision(bad)
    live = override_live(reads, ctx, kind, tab, target)
    if live.get("refused"):
        return Decision(live["refused"], fresh=True)
    allowed = OVERRIDE_FIELDS[kind]
    nxt = {f: live["edit"].get(f) or "" for f in allowed}
    written: list[dict] = []
    refused: list[dict] = []
    stale: dict[str, str] = {}
    for c in changes:
        f = c["field"]
        if f not in allowed:
            refused.append({"field": f, "why": "Not a field this record edits."})
            continue
        now = witness(c["expected"], live["edit"].get(f))
        if now is not None:
            stale[f] = now
            continue
        if f == "text":
            value = js_cut(c["value"].replace("\r", ""), C.SECTION_MAX)
        else:
            value = js_cut(fold_ws(c["value"]), 500)
        if f == "removed":
            value = "Yes" if re.fullmatch(r"yes|true|1", value, re.I) else ""
        nxt[f] = value
        written.append({"field": f, "before": c["expected"], "after": value})
    title = "record" if kind == "care" else "name"
    if written and not nxt[title] and nxt.get("removed") != "Yes":
        refused = refused + [{"field": w["field"], "why": f"A {kind} record needs its {title}."} for w in written]
        written = []
    data: dict[str, Any] = {"written": [w["field"] for w in written], "refused": refused, "id": ""}
    if not written:
        if stale:
            data["current"] = stale
            return Decision({"status": 409, "data": data, "message": STALE_ALL}, fresh=True)
        return Decision(edit_steps({"status": 200, "data": data}, "care") if kind == "care"
                        else {"status": 200, "data": data})
    W.gate(reads)
    res = W.tab_of(reads, C.OVERRIDES_TAB)
    rec = {"client_key": ctx["key"], "kind": kind, "tab": tab, "target": live["target"],
           "state": "removed" if nxt.get("removed") == "Yes" else "", "by": W.who(user), "at": W.now_iso(reads)}
    for f in allowed:
        if f != "removed":
            rec[f] = nxt[f]
    heads = [gsjs.trim(gsjs.js_str(h)) for h in (res.ref.headers if res.ref is not None else ())]
    line = {h: gsjs.or_blank(rec.get(h)) for h in heads + [h for h in OVERRIDES_HEADER if h not in heads] if h}
    # cpOverrideWrite_: a record without a row yet gets its id here, as Apps Script mints it
    rid = live["id"] or override_id(ctx["key"], kind)
    line["id"] = rid
    data["id"] = rid
    sid, tab_name = W.where_of(res)
    before = {w["field"]: w["before"] for w in written if w["field"] in line} if live["id"] else None
    edits = [W.kept_record(sid, tab_name, "edit" if live["id"] else "append", "id", rid, ctx["key"], line, before,
                           edition_for(sess, EDITION[kind]))]
    if stale:
        data["current"] = stale
        answer = {"status": 409, "data": data, "message": STALE_ALL}
    else:
        answer = kept_answer(data, {}, written, kind)
    return W.final(answer, edits, ctx["key"])


# ---- the client's chart (Meds.gs) ----------------------------------------------------------------------------------

def meds_may_write(user: dict | None) -> bool:
    """medsMayWrite_."""
    return bool(user) and not user.get("is_service") and gsjs.js_str(user.get("role")) in ("admin", "manager")


def chart_of(reads: L.Reads) -> tuple[hubdb.Resolved, list[str], list[tuple[int, dict]]]:
    """hubTabSheet_(MEDS_TAB) and its values: the tab, its header as written, its rows in sheet order."""
    res = W.tab_of(reads, MEDS_TAB)
    if res.ref is None:
        return res, [], []
    return res, [gsjs.js_str(h) for h in res.ref.headers], reads.db.rows(res.ref)


def chart_cell(raw: dict, header: str) -> Any:
    return hubdb.typed(raw.get(header), "raw")


def _meds_kept(sess: L.Session) -> Any:
    """The Medications app's writes once it keeps the chart in Postgres; None while the chart is the sheet's."""
    import medications_writes as MW  # noqa: PLC0415 - it imports this module
    import resource_rows as RR  # noqa: PLC0415
    return MW if RR.uploaded(sess.reads.db, MW.M.MEDS) else None


def med_update(sess: L.Session, payload: dict) -> Decision:
    """emarMedUpdate: the Medications app's door while the chart is in Postgres; else the row's cells kept in
    app.edits over the sheet's chart."""
    kept = _meds_kept(sess)
    if kept is not None:
        return kept.med_update(sess, payload)
    shut = edit_door(sess, payload, EDITION["meds"])
    if shut:
        return door_refused(shut)
    reads = sess.reads
    ctx = client_of(reads, payload.get("client"))
    if ctx.get("refused"):
        return door_refused(ctx["refused"])
    mid = gsjs.trim(gsjs.str_(payload.get("id")))
    if not MED_ID.match(mid):
        return W.refuse(400, "id: the medicine's chart id.")
    changes, bad = W.edit_changes(payload)
    if bad:
        return Decision(bad)
    no_proto(*(c["field"] for c in changes))
    res, hdr, rows = chart_of(reads)
    book = (res.sheet_id,)
    if res.ref is None:
        return W.refuse(503, "The chart tab did not open.", fresh=book)
    id_h = "Id - Auto" if "Id - Auto" in hdr else None
    hits = [raw for _rn, raw in rows if id_h and gsjs.or_blank(chart_cell(raw, id_h)) == mid]
    if len(hits) != 1:
        return W.refuse(409 if hits else 404, "Two chart rows carry this id; neither was edited — reload the chart."
                        if hits else "No medicine with this id is on the chart.", fresh=book)
    raw = hits[0]
    if "Client" not in hdr or name_key(chart_cell(raw, "Client")) != name_key(ctx["name"]):
        return W.refuse(409, "This medicine is not on this client's chart (it has moved) — nothing was written.",
                        fresh=book)
    row = {h: hubdb.cell_text(chart_cell(raw, h)) for h in hdr}
    live = C.scrub(C.meds_edit_raw(row))
    cells: dict[str, str] = {}
    prior: dict[str, str] = {}
    written: list[dict] = []
    refused: list[dict] = []
    stale: dict[str, str] = {}
    for c in changes:
        f = c["field"]
        col = C.MEDS_EDIT_COLUMNS.get(f)
        if not col:
            refused.append({"field": f, "why": "Not a field this panel edits."})
            continue
        if col not in hdr:
            refused.append({"field": f, "why": "The chart has no " + col + " column."})
            continue
        marked(live.get(f))
        now = witness(c["expected"], live.get(f))
        if now is not None:
            stale[f] = now
            continue
        if f == "name" and not c["value"]:
            refused.append({"field": f, "why": "The medicine needs a name."})
            continue
        if f == "times":
            value = " ".join('"' + t.replace(":", "") + '"' for t in C.meds_times(c["value"]))
        else:
            value = js_cut(fold_ws(c["value"]), 500)
        cells[col], prior[col] = value, row.get(col, "")
        written.append({"field": f, "before": c["expected"], "after": value})
    data: dict[str, Any] = {"written": [w["field"] for w in written], "refused": refused}
    answer = kept_answer(data, stale, written, "meds")
    if not written:
        return Decision(answer, fresh=book if stale else False)
    at = next(i for i, (_rn, r) in enumerate(rows) if r is raw)
    got = W.row_key_of(rows, at, [[id_h]])
    if got is None:
        return W.refuse(409, W.NOT_TOLD_APART, fresh=book)
    sid, tab = W.where_of(res)
    return W.final(answer, [W.kept_record(sid, tab, "edit", got[0], got[1], ctx["key"], cells, prior,
                                          edition_for(sess, EDITION["meds"]))], ctx["key"])


def med_delete(sess: L.Session, payload: dict) -> Decision:
    """emarMedDelete, as the Clients page names its client: the Medications app's door while the chart is in Postgres;
    else refused here, or the first row carrying the id taken off the sheet's chart by a book op (app/book_ops.py
    `delete`), as no kept edit removes a row — only while it holds what the copy held."""
    kept = _meds_kept(sess)
    if kept is not None:
        return kept.med_delete(sess, payload)
    reads, user = sess.reads, sess.user
    raw_key = payload.get("client")
    may = meds_may_write(user)
    if not may:
        shut = edit_door(sess, {"client": raw_key}, EDITION["meds"])
        if shut:
            return door_refused(shut)
    if gsjs.falsy(raw_key):
        if not may:
            return W.refuse(400, "client: the client key the roster gives.")
        ctx: dict[str, Any] = {}
    else:
        ctx = client_of(reads, raw_key)
        if ctx.get("refused"):
            return door_refused(ctx["refused"])
    mid = gsjs.str_(payload.get("id"))
    if not mid:
        return W.refuse(400, "Which medicine?")
    res, hdr, rows = chart_of(reads)
    book = (res.sheet_id,)
    if res.ref is None:
        return W.refuse(503, "The chart tab did not open.", fresh=book)
    trimmed = [gsjs.trim(h) for h in hdr]
    if "Id - Auto" not in trimmed or not rows:
        return W.refuse(404, "The chart holds no such row.", fresh=book)
    id_h = hdr[trimmed.index("Id - Auto")]
    client_h = hdr[trimmed.index("Client")] if "Client" in trimmed else None
    raw = next((r for _rn, r in rows if gsjs.or_blank(chart_cell(r, id_h)) == mid), None)
    if raw is None:
        return W.refuse(404, f'No medicine with id "{mid}" on the chart.', fresh=book)
    if ctx.get("key") and (client_h is None or name_key(chart_cell(raw, client_h)) != name_key(ctx["name"])):
        return W.refuse(409, "This medicine is not on this client's chart (it has moved) — nothing was removed.",
                        fresh=book)
    key = gsjs.str_(ctx.get("key"))
    # the row as the copy holds it, but the cells the chart's kept edits write (carried after the book's ops)
    edited = set(C.MEDS_EDIT_COLUMNS.values())
    expect = {gsjs.trim(h): gsjs.or_blank(raw.get(h)) for h in hdr if gsjs.trim(h) and gsjs.trim(h) not in edited}
    by = gsjs.str_((user or {}).get("email"))
    BO.queue([{"op": "delete", "sheet_id": res.ref.sheet_id, "tab": res.ref.tab,
               "spec": {"match": gsjs.trim(id_h), "key": mid, "which": "first", "expect": expect}}],
             key, by, "emarMedDelete")
    name_h = hdr[trimmed.index("PrescriptionName")] if "PrescriptionName" in trimmed else None
    staff_views.record(user, "emarMedDelete", gsjs.or_blank(chart_cell(raw, name_h)) if name_h else mid)
    answer = {"status": 200, "data": {"removed": mid}} if not key else \
        edit_steps({"status": 200, "data": {"removed": mid, "written": ["removed"], "refused": []}}, "meds")
    # laid as taken off over the copy (Own.merge) while the write is fresh
    return Decision(answer, subject=key, own=True,
                    record=tab_record(res, "delete", "medid", mid, key, {"Id - Auto": mid}))


# ---- the name and the status (the master's) ------------------------------------------------------------------------

def clean_name(v: str) -> str:
    """cpCleanName_."""
    s = gsjs.trim(fold_ws(v))
    if len(s) < 3 or len(s) > 120 or len(s.split(" ")) < 2:
        return ""
    return s if _NAME_OK.match(s) else ""


def isp_key(name: Any) -> str:
    """ispIntakeKey_."""
    return re.sub(r"[^a-z0-9_]", "", _JS_WS.sub("_", gsjs.trim(gsjs.or_text(name)).lower()))


def rename_key(old_key: str, old_name: str, new_name: str) -> str:
    """cpRenameKey_."""
    if old_key == isp_key(old_name):
        return isp_key(new_name)
    if old_key == name_key(old_name):
        return name_key(new_name)
    return old_key


def rename_clash(reads: L.Reads, ctx: dict, name: str, new_key: str) -> str:
    """cpRenameClash_."""
    fold, mine = name_key(name), name_key(ctx["name"])
    for c in ctx.get("all") or []:
        k = gsjs.trim(gsjs.or_text(c.get("client_key"))) or name_key(c.get("name"))
        if k != ctx["key"] and (k == new_key or name_key(c.get("name")) == fold):
            return "Another client already carries that name, so nothing was renamed."
    if fold == mine:
        return ""
    books = []
    for read, what in ((C.master_index, "the Asa Client Database"), (C.archive_index, "the archive of old clients")):
        got, why = L._soft(lambda read=read: read(reads))
        if got is None:
            raise Defer(f"{what} could not be read here ({why})")
        books.append(got)
    if any(b["rows"].get(fold) for b in books):
        return "The Asa Client Database already holds a row with that name, so nothing was renamed."
    return ""


def rename(sess: L.Session, payload: dict) -> Decision:
    """clientProfileRename: refused here, or carried into every book and Hub tab that names the client
    (client_rename)."""
    import client_rename as CR  # noqa: PLC0415 - kept beside this door
    shut = master_door(sess)
    if shut:
        return Decision(shut)
    reads = sess.reads
    ctx = client_of(reads, payload.get("client"))
    if ctx.get("refused"):
        return door_refused(ctx["refused"])
    change, others, bad = one_change(payload, "name")
    if bad:
        return Decision(bad)
    name = clean_name(change["value"])
    if not name:
        return W.refuse(400, "name: a full name, first and last, in letters.")
    W.gate(reads)
    if ctx.get("archived"):
        return W.refuse(409, "This client is in the archive of old clients; set them active before renaming.",
                        fresh=True)
    now = witness(change["expected"], gsjs.text(ctx["name"]))
    if now is not None:
        return Decision({"status": 409, "message": WITNESS_STALE,
                         "data": {"written": [], "refused": others, "current": {"name": now}}}, fresh=True)
    if name == gsjs.text(ctx["name"]):
        return Decision({"status": 200, "data": {"written": [], "refused": others, "client_key": ctx["key"]}},
                        fresh=True)
    new_key = rename_key(ctx["key"], ctx["name"], name)
    clash = rename_clash(reads, ctx, name, new_key)
    if clash:
        return W.refuse(409, clash, fresh=True)
    return CR.rename(sess, ctx, name, new_key, others)


def status(sess: L.Session, payload: dict) -> Decision:
    """clientProfileStatus: refused here, or the Hub row kept and the book row moved between the Master and the
    archive (client_rename)."""
    import client_rename as CR  # noqa: PLC0415 - kept beside this door
    shut = master_door(sess)
    if shut:
        return Decision(shut)
    reads = sess.reads
    ctx = client_of(reads, payload.get("client"))
    if ctx.get("refused"):
        return door_refused(ctx["refused"])
    change, others, bad = one_change(payload, "status")
    if bad:
        return Decision(bad)
    v = change["value"]
    want = "Active" if re.fullmatch(r"active", v, re.I) else "Inactive" if re.fullmatch(r"inactive|archived", v, re.I) \
        else ""
    if not want:
        return W.refuse(400, "status: Active or Inactive.")
    W.gate(reads)
    before = C.status_word(ctx)
    now = witness(change["expected"], before)
    if now is not None:
        return Decision({"status": 409, "message": WITNESS_STALE,
                         "data": {"written": [], "refused": others, "current": {"status": now}}}, fresh=True)
    if want == before:
        return Decision({"status": 200, "data": {"written": [], "refused": others, "client_key": ctx["key"]}},
                        fresh=True)
    return CR.status(sess, ctx, want, others)


# ---- a new client, and a client's sign-in (Clients.gs) -------------------------------------------------------------

def utf16_len(s: str) -> int:
    return len(s.encode("utf-16-le")) // 2


def client_create(sess: L.Session, payload: dict) -> Decision:
    """clientCreate: refused here, or the row (CLI_<key>, createRow_'s stamps) kept in app.edits."""
    user, reads = sess.user, sess.reads
    if not writer(user):
        return Decision(denied())
    name = gsjs.str_(payload.get("name"))
    if utf16_len(name) < 3 or " " not in name:
        return W.refuse(400, "A full name (first and last) is required.")
    key = name_key(name)
    # a row keyed the plan's way (first_last) or only by its name: either folding to this name is the same client
    for r in C._hub(reads, "clients"):
        if name_key(r.get("client_key")) == key or name_key(r.get("name")) == key:
            return W.refuse(409, f'"{name}" is already on the directory.', fresh=True)
    W.gate(reads)
    now = W.now_iso(reads)
    s = gsjs.str_
    rec = {"id": "CLI_" + key, "client_key": key, "name": name, "clientNumber": s(payload.get("clientNumber")),
           "client_number": s(payload.get("clientNumber")), "houseName": s(payload.get("houseName")),
           "house": s(payload.get("houseName")), "guardianName": s(payload.get("guardianName")),
           "status": s(payload.get("status")) or "active", "created_by": s((user or {}).get("email")),
           "createdAt": now, "updatedAt": now}
    sid, tab = W.where_of(W.tab_of(reads, "clients"))
    return W.final({"status": 200, "data": dict(rec)}, [W.kept_record(sid, tab, "append", "id", rec["id"], key, rec)],
                   key)


def parse_emails(raw: Any) -> list[Any]:
    """profileParseEmails_."""
    if isinstance(raw, list):
        return raw
    s = gsjs.str_(raw)
    if not s:
        return []
    try:
        got = json.loads(s)
    except ValueError:
        return [x for x in re.split(r"\s*[;,]\s*", s) if x]
    return got if isinstance(got, list) else []


def user_by_email(reads: L.Reads, email: str) -> dict | None:
    """userByEmail_."""
    needle = gsjs.trim(gsjs.or_text(email)).lower()
    if not needle:
        return None
    users = [u for u in reads.users() if not gsjs.str_(u.get("mergedinto"))]
    for u in users:
        if gsjs.str_(u.get("email")).lower() == needle:
            return u
    hits = [u for u in users if needle in [gsjs.str_(e).lower() for e in parse_emails(u.get("emails"))]]
    return hits[0] if len(hits) == 1 else None


# a client's sign-in (clientUserCreate) is made whole by Users' account doors (users_accounts.client_user_create)
ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {
    "clientProfilePhoto": P.door("clients"), "clientProfileSave": profile_save,"clientProfileOverride": override, "clientProfileRename": rename,
    "clientProfileStatus": status, "emarMedUpdate": med_update, "emarMedDelete": med_delete,
    "clientCreate": client_create,
}
_STAFF = ("admin", "manager", "staff")
_WRITERS = ("admin", "manager")
# HUB_POLICY: the roles each write is declared for, and its typed params
POLICY: dict[str, dict[str, Any]] = {
    "clientProfilePhoto": P.policy("clients"),
    "clientProfileSave": {"roles": _STAFF, "params": {"client": "string", "changes": "array"}},
    "clientProfileOverride": {"roles": _STAFF, "params": {"client": "string", "kind": "string", "tab": "string",
                                                          "target": "string", "changes": "array"}},
    "clientProfileRename": {"roles": _WRITERS, "params": {"client": "string", "changes": "array"}},
    "clientProfileStatus": {"roles": _WRITERS, "params": {"client": "string", "changes": "array"}},
    "emarMedUpdate": {"roles": _STAFF, "params": {"client": "string", "id": "string", "changes": "array"}},
    "emarMedDelete": {"roles": _STAFF, "params": {}},
    "clientCreate": {"roles": _WRITERS, "params": {}},
}
# the answer a door gives while the script lock is held; a door that takes no lock is Apps Script's then
BUSY_OF: dict[str, dict[str, Any]] = {
    "clientProfileRename": {"status": 409, "message": W.BUSY},
    "clientProfileStatus": {"status": 409, "message": W.BUSY},
    "clientProfileOverride": {"status": 409, "message": W.BUSY},
    "emarMedUpdate": {"status": 503, "message": "The chart is busy — try again in a moment."},
    "emarMedDelete": {"status": 409, "message": "The chart is busy — try again in a moment."},
}


# ---- the writes Python accepted, laid over the Clients tabs until the copy holds them ------------------------------

# a write's cell and the panel field the relay names it by
FIELD_OF = {"guardianName": "guardian_name", "state": "removed",
            **{col: f for f, col in C.MEDS_EDIT_COLUMNS.items()}}
CHANGE_FIELDS = frozenset(C.edit_columns()) | frozenset(f for k in OVERRIDE_FIELDS.values() for f in k) \
    | frozenset(MEDS_FIELDS)


class Own(W.Own):
    """The own-write layer with the Clients' rows: a client's row by key, a chart row by its id, a row taken off…"""

    def virtual(self, sheet_id: str, tab: str) -> hubdb.TabRef | None:
        kept = super().virtual(sheet_id, tab)
        if tab not in VIRTUAL or not (kept is not None or any(
                w.get("sheet_id") == sheet_id and w.get("tab_name") == tab and w.get("kind") == "append"
                for w in self.items)):
            return kept
        return hubdb.TabRef(sheet_id, tab, "", VIRTUAL[tab], None, -1)

    def _keyer(self, ref: hubdb.TabRef, match: str) -> Callable[[int, dict], str | None]:
        if match not in ("client", "medid", "override"):
            return super()._keyer(ref, match)
        names = {"client": ("client_key", "name"), "medid": ("Id - Auto",),
                 "override": ("client_key", "kind", "tab", "target")}[match]
        heads = [self._header(ref, n, "header") for n in names]

        def cell_of(raw: dict, h: str | None) -> str:
            return gsjs.trim(gsjs.or_blank(raw.get(h))) if h is not None else ""

        if match == "client":
            return lambda _rn, raw: cell_of(raw, heads[0]) or name_key(cell_of(raw, heads[1]))
        if match == "medid":
            return lambda _rn, raw: cell_of(raw, heads[0])
        return lambda _rn, raw: "|".join(cell_of(raw, h) for h in heads)

    def merge(self, ref: hubdb.TabRef, rows: list[tuple[int, dict]]) -> list[tuple[int, dict]]:
        gone = sorted((w for w in self.items if w.get("kind") == "delete" and w.get("sheet_id") == ref.sheet_id
                       and w.get("tab_name") == ref.tab), key=lambda w: float(w.get("accepted_at") or 0))
        if not gone:
            return super().merge(ref, rows)
        held = self.items
        self.items = [w for w in held if w.get("kind") != "delete"]
        try:
            out = super().merge(ref, rows)
        finally:
            self.items = held
        for w in gone:
            at = self._find(out, ref, w)
            if at is None:
                self._shown(w)
                continue
            if self.live(w, ref):
                out.pop(at)
                self.held.add(w["write_id"])
        return out


class Store(W.Store):
    """app.client_writes and app.client_receipts, beside Locations' own."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="client", label="Clients")

    @staticmethod
    def kept(kind: str, cells: dict[str, Any], fields: list[str] | None) -> dict[str, Any]:
        """The cells that stood: a panel field the door did not write leaves; none left, nothing stood."""
        if kind != "edit" or fields is None:
            return cells
        out = {k: v for k, v in cells.items()
               if FIELD_OF.get(k, k) not in CHANGE_FIELDS or FIELD_OF.get(k, k) in fields}
        return out if any(FIELD_OF.get(k, k) in CHANGE_FIELDS for k in out) else {}
