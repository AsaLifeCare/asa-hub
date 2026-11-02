"""App Studio's App Builder, Playground and imports written (AppBuilder.gs appBuilderUpsert, Studio.gs appDelete,
appUpsert and sheetImport, Main.gs route() create, update and delete on `apps`, on the imports and on the tabs
app_builder names): every change to a tab queued as one book op per tab (book_ops `rows`), in this write's transaction
and in Apps Script's order. asa-hub-sheet-sync carries them in that order — a stub removed right after its import
never comes back — and every read here lays them over the copy until the copy holds them. A read's first touch of a
missing tab is queued through the same store (ensure_tabs)."""
from __future__ import annotations

import re
import secrets
import threading
import time
from typing import Any, Callable

import app_builder as AB
import app_builder_calls as ABC
import app_control as AC
import book_ops as BO
import candidate_papers as CP
import client_rename as CR
import gsjs
import house_tables as HT
import hubdb
import locations as L
import resource_rows as RR
import scope as sc
import smart_comms as SC
import staff_views
import studio as ST
import writes as W
from writes import Decision

PUBLISH_BUSY = "Another publish is writing app_builder right now — try again in a few seconds."
MASTER_ONLY = "This app is the master's alone — only the master may change it."

s_ = gsjs.str_


def _get(obj: Any, key: str) -> Any:
    """obj[key] of a parsed payload value; an array has no named member."""
    return obj.get(key) if isinstance(obj, dict) else None


def _typeof(v: Any) -> str:
    """hubPolicyGate_'s kind: Array.isArray, then typeof."""
    if isinstance(v, list):
        return "array"
    if isinstance(v, bool):
        return "boolean"
    if isinstance(v, (int, float)):
        return "number"
    return "string" if isinstance(v, str) else "object"


def _cell(v: Any) -> Any:
    """serialize_: a value as setValues and appendRow wrote it — an object as its JSON, anything else as it is (the
    op writes it raw)."""
    if v is None:
        return ""
    return CR.js_json(v) if isinstance(v, (dict, list)) else v


def _queue(ops: list[dict], subject: str, user: dict, action: str) -> None:
    """Each op queued for its sheet; a tab kept in its own table takes it there at once instead, in this write: the
    op laid on the table's rows as the sheet would take it (book_ops.rows_lay), the table rewritten so."""
    by = gsjs.or_blank(user.get("email"))
    sheet = []
    for op in ops:
        resource = _table_of(gsjs.or_blank(op.get("sheet_id")), gsjs.or_blank(op.get("tab")))
        if resource is None:
            sheet.append(op)
            continue
        cols, rows = HT.raw(None, op["tab"], resource)  # type: ignore[arg-type]
        _exists, header, laid = BO.rows_lay(True, cols, [r for _p, r in rows], op.get("spec") or {})
        # a column the op grows is the table's too, written or not (ensureHeader_)
        RR._widen(None, resource, list(header))  # type: ignore[arg-type]
        HT.rewrite(None, op["tab"], laid, by)  # type: ignore[arg-type]
    if sheet:
        BO.queue(sheet, "appbuilder:" + subject, by, action)


def _table_of(sid: str, tab: str) -> str | None:
    """The table a book's tab is kept in, as this write sees it; None while its copy is the record."""
    resource = HT.resource_of(tab)
    if resource is None or not sid:
        return None
    got = RR._q(None, f"select sheet_id from {RR.COLUMNS} where resource = %s"  # type: ignore[arg-type]
                      " and uploaded_at is not null", (resource,))
    return resource if got and got[0][0] == sid else None


def _kept(answer: dict[str, Any]) -> Decision:
    """Answered final: the ops are kept in this write's transaction."""
    return Decision(answer, own=True, subject="")


def _gone(reads: L.Reads, sid: str, tab: str) -> None:
    """hubTabEnsure_'s refusal to re-create a tab declared elsewhere, thrown as Apps Script threw it."""
    if AB.declared_gone(reads, tab) and not AB.born_here(reads, sid, tab):
        raise AB.Held({"status": 500, "message": AB.gone_words(tab)})


def _funnel(reads: L.Reads) -> None:
    """sheetDbGateHolds_: while the book-write funnel holds, a generic write is refused with its 409."""
    held = CP.book_gate(reads)
    if held:
        raise AB.Held(held)


# ---- the generic verbs' writers (SheetDb.gs) ----------------------------------------------------------------------

def _create(reads: L.Reads, v: AB.View, record: dict, resource: str = AB.APPS_TAB) -> tuple[dict, dict]:
    """createRow_: an id, createdAt and updatedAt, the header widened by the record's keys, the row appended."""
    _funnel(reads)
    if not v.exists:
        _gone(reads, v.sid, resource)
    rec = dict(record)
    now = W.now_iso(reads)
    if gsjs.falsy(rec.get("id")):
        rec["id"] = W.mint()
    if gsjs.falsy(rec.get("createdAt")):
        rec["createdAt"] = now
    rec["updatedAt"] = now
    return rec, AB.op_of(v, {"header": list(AB.SHEETDB_HEADER), "grow": list(rec),
                             "append": [{k: _cell(x) for k, x in rec.items()}], "unique": "id"})


def _sheet_for(reads: L.Reads, v: AB.View, resource: str) -> list[dict]:
    """sheetFor_: the tab made with id, createdAt and updatedAt when the sheet lacks it."""
    if v.exists:
        return []
    _gone(reads, v.sid, resource)
    return [AB.op_of(v, {"header": list(AB.SHEETDB_HEADER)})]


def _update(reads: L.Reads, v: AB.View, patch: dict, resource: str = AB.APPS_TAB) -> tuple[dict[str, Any], list]:
    """updateRowById_: the first row of the id merged with the patch (createdAt immutable, updatedAt refreshed);
    (the answer, the ops)."""
    _funnel(reads)
    if "id" not in patch or patch["id"] == "":
        return {"status": 400, "message": 'Missing required "id" in payload.'}, []
    made = _sheet_for(reads, v, resource)
    row = AB.require_row(v, patch["id"], resource)
    if "error" in row:
        return row["error"], made
    merged = dict(row)
    for k, x in patch.items():
        if k != "createdAt":
            merged[k] = x
    merged["updatedAt"] = W.now_iso(reads)
    cells = {k: _cell(merged[k]) for k in list(patch) + ["updatedAt"] if k != "createdAt"}
    return {"status": 200, "data": merged}, made + [AB.op_of(v, {"grow": list(merged), "update": {
        "key": gsjs.trim(gsjs.js_str(patch["id"])), "cells": cells}})]


def _answered(answer: dict[str, Any], ops: list[dict], subject: str, user: dict, action: str) -> Decision:
    """The answer, with its ops queued (final) when there are any."""
    if not ops:
        return Decision(answer)
    _queue(ops, subject, user, action)
    return _kept(answer)


def _place_gate(v: AB.View, action: str, payload: dict, where: str,
                resource: str = AB.APPS_TAB) -> dict[str, Any] | None:
    """hubPlaceGate_: the place column is never the payload's; away, another place's row is not here and a write is
    stamped with the place."""
    if action in ("create", "update"):
        payload.pop("tenant", None)
    if not where:
        return None
    if action == "create":
        payload["tenant"] = where
        return None
    if action in ("update", "delete"):
        rid = s_(payload.get("id"))
        if not rid:
            return None
        row = AB.require_row(v, rid, resource)
        if "error" not in row and not AB.visible(where, row.get("tenant")):
            return {"status": 404, "message": f'No "{resource}" record with id "{rid}".'}
        if action == "update":
            payload["tenant"] = where
    return None


# ---- Studio.gs ----------------------------------------------------------------------------------------------------

def app_upsert(sess: L.Session, payload: dict) -> Decision:
    """appUpsert: an app renamed, restyled or hidden — its row merged, else an override row made for it; an id
    another place holds is refused, and a master-only app is the master's alone."""
    reads, user = sess.reads, sess.user or {}
    refused = AB.admin_refused(reads, user, "appUpsert")
    if refused:
        return Decision(refused)
    p = payload if isinstance(payload, dict) else {}
    rid = s_(p.get("id"))
    if not rid:
        return W.refuse(400, "app id required")
    if AC.master_only(rid) and not sc.is_real_master(user):
        return W.refuse(403, MASTER_ONLY)
    fields: dict[str, Any] = {}
    for k in ("name", "tagline", "icon", "accent", "category"):
        if k in p:
            fields[k] = s_(p[k])
    for k in ("enabled", "drag_focus"):
        if k in p:
            fields[k] = p[k] is True or p[k] == "true"
    v = AB.view(reads, user, AB.APPS_TAB)
    where = AB.here(reads, user)
    mine, elsewhere = None, False
    for r in AB.read_all(v):
        if AB.row_id(r) != rid:
            continue
        if AB.visible(where, r.get("tenant")):
            mine = r
        else:
            elsewhere = True
    if mine is None and elsewhere:
        return W.refuse(409, f'The app id "{rid}" is already registered elsewhere on this platform — choose another'
                             " id.")
    if mine is not None:
        patch = {"id": rid, **fields}
        gate = _place_gate(v, "update", patch, where)
        if gate:
            return Decision(gate)
        answer, ops = _update(reads, v, patch)
        return _answered(answer, ops, rid, user, "appUpsert")
    fresh = {"id": rid, "override": True, **fields}
    _place_gate(v, "create", fresh, where)
    created, op = _create(reads, v, fresh)
    _queue([op], rid, user, "appUpsert")
    return _kept({"status": 200, "data": created})


def app_delete(sess: L.Session, payload: dict) -> Decision:
    """appDelete: an app unregistered from apps, hub_resources and app_builder where the caller stands; its data tabs
    are never touched, and the answer says what they hold."""
    reads, user = sess.reads, sess.user or {}
    refused = AB.admin_refused(reads, user, "appDelete")
    if refused:
        return Decision(refused)
    p = payload if isinstance(payload, dict) else {}
    rid = s_(p.get("id"))
    if not rid:
        return W.refuse(400, "app id required")
    where = AB.here(reads, user)
    v_apps = AB.view(reads, user, AB.APPS_TAB)
    v_res = AB.view(reads, user, AB.RESOURCES_TAB)
    v_ab = AB.view(reads, user, AB.TAB)
    found = {"apps": 0, "hub_resources": 0, "app_builder": 0}
    resource_tabs: list[str] = []
    data_tabs: list[str] = []
    for r in AB.read_all(v_apps):
        if AB.row_id(r) == rid and AB.visible(where, r.get("tenant")):
            found["apps"] += 1
    for r in AB.normalized(v_res):
        if s_(r.get("resourceid")) == rid and AB.visible(where, r.get("tenant")):
            found["hub_resources"] += 1
            resource_tabs.append(s_(r.get("tabname")))
    for r in AB.normalized(v_ab):
        if s_(r.get("appid")) == rid and AB.visible(where, r.get("tenant")):
            found["app_builder"] += 1
            res = s_(r.get("resource"))
            if res and res not in data_tabs:
                data_tabs.append(res)
    if not any(found.values()):
        return W.refuse(404, f'No app "{rid}" is registered. Nothing was deleted.')
    removed: dict[str, int] = {}
    ops: list[dict] = []
    for key, v, column in (("apps", v_apps, "id"), ("hub_resources", v_res, "resource_id"),
                           ("app_builder", v_ab, "app_id")):
        drop = {"column": column, "value": rid, "here": where}
        if not v.exists or not v.rows or BO.rows_column(v.header, column) is None:
            removed[key] = 0
            continue
        removed[key] = sum(1 for r in v.rows if BO.rows_drops(v.header, r, drop))
        ops.append(AB.op_of(v, {"drop": drop}))
    kept: list[dict] = []
    for t in dict.fromkeys(t for t in data_tabs + resource_tabs if t):
        try:
            tv = AB.view(reads, user, t)
        except AB.Facts:
            continue
        if tv.exists:
            kept.append({"tab": t, "rows": len(tv.rows)})
    _queue(ops, rid, user, "appDelete")
    staff_views.record(user, "appDelete", rid)
    note = ("The app is gone from the platform. Its data is untouched — "
            + ", ".join(f"{k['tab']} ({k['rows']} rows)" for k in kept)
            + ". Nothing here deletes a tab; that is done in the spreadsheet, by someone who can see it."
            if kept else "The app is gone from the platform. It had no data tab of its own.")
    return _kept({"status": 200, "data": {"id": rid, "removed": removed, "data_kept": kept, "note": note}})


def sheet_import(sess: L.Session, payload: dict) -> Decision:
    """sheetImport: a spreadsheet's tab registered as a read-only resource (hub_resources) and a one-page app over it
    (apps). The tab is found in asa-hub-db's copy of the book; a book the copy does not hold cannot be opened."""
    reads, user = sess.reads, sess.user or {}
    refused = AB.admin_refused(reads, user, "sheetImport")
    if refused:
        return Decision(refused)
    p = payload if isinstance(payload, dict) else {}
    sid = AB.sheet_id_from_url(p.get("url") if gsjs.falsy(p.get("spreadsheet_id")) else p.get("spreadsheet_id"))
    tab = s_(p.get("tab"))
    name = s_(p.get("name")) or tab or "Imported sheet"
    if not sid or not tab:
        return W.refuse(400, "spreadsheet_id and tab are required.")
    if reads.db.book(sid) is None:
        return W.refuse(403, AB.COULD_NOT_OPEN)
    reads.db.note_book(sid)
    if reads.db.tab(sid, tab) is None:
        return W.refuse(404, f'Tab "{tab}" not found.')
    resource_id = "x_" + hubdb.norm_key(name)[:24] + "_" + secrets.token_hex(2)
    v_res = AB.view(reads, user, AB.RESOURCES_TAB)
    if not v_res.exists:
        _gone(reads, v_res.sid, AB.RESOURCES_TAB)
    res_op = AB.op_of(v_res, {"header": list(AB.RESOURCES_HEADER), "unique": "resource_id", "append": [
        {"resource_id": resource_id, "spreadsheet_id": sid, "tab_name": tab, "label": name,
         "created_at": W.now_iso(reads), "created_by": "asa-hub:" + gsjs.or_blank(user.get("email")),
         "tenant": AB.here(reads, user)}]})
    app = {"id": "app_" + secrets.token_hex(3), "name": name,
           "tagline": s_(p.get("tagline")) or "Imported from Google Sheets", "icon": s_(p.get("icon")) or "table",
           "accent": s_(p.get("accent")) or "blue", "category": "Imported", "version": "1.0.0", "isNew": True,
           "enabled": True, "source": "studio",
           "pages": [{"id": "main", "type": "sheet", "title": name, "dataSource": {"resource": resource_id},
                      "config": {}}]}
    _created, apps_op = _create(reads, AB.view(reads, user, AB.APPS_TAB), app)
    _queue([res_op, apps_op], resource_id, user, "sheetImport")
    return _kept({"status": 200, "data": {"resource_id": resource_id, "app": app}})


# ---- AppBuilder.gs ------------------------------------------------------------------------------------------------

def _bad_page(page: Any, index: int) -> str:
    """appBuilderValidPage_: '' when the page is publishable, else why not."""
    n = str(index + 1)
    if gsjs.falsy(page) or not isinstance(page, (dict, list)):
        return f"page {n} is not an object"
    kind = gsjs.or_text(_get(page, "type")) or "sheet"
    if kind not in ST.APP_BUILDER_TYPES:
        return f'page {n}: type "{kind}" is not one the engine mounts ({", ".join(ST.APP_BUILDER_TYPES)})'
    res = gsjs.trim(gsjs.or_text(_get(page, "resource")))
    if not AB.RESOURCE_RE.fullmatch(res):
        return f'page {n}: resource "{res}" is not a usable tab name (letters, digits, underscore)'
    pid = gsjs.trim(gsjs.or_text(_get(page, "id")))
    if pid and not AB.PAGE_ID_RE.fullmatch(pid):
        return f'page {n}: id "{pid}" is not a usable page id (kebab-case)'
    return ""


def _sanitize(options: Any, warnings: list[str], label: str) -> None:
    """appBuilderSanitizeActions_: a button of a kind the runner does not execute, or calling an action nobody
    declared, removed and said."""
    footer = _get(options, "footer")
    slots = list(AB.ACTION_SLOTS) + (["footer"] if not gsjs.falsy(footer) and isinstance(footer, (dict, list)) else [])
    for slot in slots:
        found = (footer if isinstance(footer, list) else _get(footer, "buttons")) if slot == "footer" \
            else _get(options, slot)
        if not isinstance(found, list):
            continue
        for i in range(len(found) - 1, -1, -1):
            a = found[i]
            if gsjs.falsy(a) or not isinstance(a, (dict, list)) or gsjs.falsy(_get(a, "kind")):
                continue
            kind = a["kind"]
            said = gsjs.or_text(a.get("label")) or gsjs.or_text(a.get("id")) or "?"
            if not (isinstance(kind, str) and kind in AB.ACTION_KINDS):
                warnings.append(f'page {label}: action "{said}" has unknown kind "{gsjs.js_str(kind)}" — removed')
                del found[i]
                continue
            call = a.get("call")
            if kind == "call" and not gsjs.falsy(call) and gsjs.js_str(call) not in ABC.DECLARED:
                warnings.append(f'page {label}: action "{said}" calls "{gsjs.js_str(call)}", which is not a declared'
                                " action — removed")
                del found[i]


def _columns_dsl(columns: list) -> str:
    """appBuilderColumnsDsl_: [{key,label,kind}] as "key:Label:kind|…"."""
    parts = []
    for c in columns:
        if gsjs.falsy(c) or not isinstance(c, (dict, list)):
            continue
        key = gsjs.trim(gsjs.or_text(_get(c, "key")))
        if not key or "|" in key or ":" in key:
            continue
        label = gsjs.trim(re.sub(r"\s+", " ", re.sub(r"[|:]", " ", gsjs.or_text(_get(c, "label")) or key)))
        kind = gsjs.trim(re.sub(r"[|:]", "", gsjs.or_text(_get(c, "kind")) or "text")) or "text"
        parts.append(f"{key}:{label}:{kind}")
    return "|".join(parts)


def _home_has(reads: L.Reads, user: dict, resource: str) -> bool:
    """appBuilderHomeHas_: declared elsewhere, homed, or a tab the router already answers for."""
    return AB.declared_gone(reads, resource) or _home_tab(reads, user, resource)


def _state(reads: L.Reads, user: dict, book: str, resource: str, owned: set[str]) -> str:
    """appBuilderResourceState_: 'builder', 'coded', 'create', or why this page may not touch the tab."""
    if resource in owned:
        return "builder"
    if resource in AB.CODED:
        return "coded"
    for key, sheet in AB.CODED.items():
        if sheet == resource:
            return (f'page resource "{resource}" is the sheet behind the coded resource "{key}" — bind the resource'
                    " by its name instead")
    if AB.view_at(reads, book, resource, reads.db.tab(book, resource)).exists or _home_has(reads, user, resource):
        return (f'page resource "{resource}" names a tab this platform already uses for something else — the builder'
                " only writes tabs it created")
    return "create"


def _data_tab(reads: L.Reads, user: dict, resource: str, cols: list[dict], rows: Any,
              made: set[tuple[str, str]], ops: list[dict]) -> tuple[str, int]:
    """appBuilderEnsureTab_ and the seed: the page's tab made with its columns and its sample rows (seeded only on
    birth), else its header widened; an estate resource has no tab."""
    if resource in AB.ESTATE:
        return "estate", 0
    keys = ["id"] + [c["key"] for c in cols if c["key"] != "id"]
    try:
        sid, name, ref = AB.where(reads, user, resource)
    except AB.Facts:
        # the runtime's own tab: there already, its header the depot's
        return "exists", 0
    v = AB.view_at(reads, sid, name, ref)
    if (sid, name) in made or v.exists:
        ops.append(AB.op_of(v, {"grow": keys}))
        return "exists", 0
    _gone(reads, sid, resource)
    seed: list[dict] = []
    for rec in rows[:AB.MAX_SEED_ROWS] if isinstance(rows, list) else ():
        if not isinstance(rec, dict):
            continue
        if not isinstance(rec.get("id"), str) or not rec.get("id"):
            rec["id"] = "row-" + str(len(seed) + 1)
        seed.append({k: _cell(rec.get(k)) for k in keys})
    ops.append(AB.op_of(v, {"header": keys, "seed": seed}))
    made.add((sid, name))
    return "created", len(seed)


def builder_upsert(sess: L.Session, payload: dict) -> Decision:
    """appBuilderUpsert: every app_builder row of one app id replaced — each refusal decided before anything is
    written; each page's own tab made (seeded only on birth) or widened, a coded resource bound, never touched."""
    reads, user = sess.reads, sess.user or {}
    away = AB.away_refused(reads, user, "appBuilderUpsert")
    if away:
        return Decision(away)
    if not user.get("is_service") and s_(user.get("role")) != "admin":
        return W.refuse(403, AB.ADMIN_ONLY)
    p = payload if isinstance(payload, dict) else {}
    app = p.get("app")
    if app is None or app == "":
        return W.refuse(400, "Missing required parameter: app.")
    if _typeof(app) != "object":
        return W.refuse(400, f"app must be object, got {_typeof(app)}.")
    if s_(user.get("role")) != "admin":
        return Decision(dict(ST.DENIED))
    aid = gsjs.trim(gsjs.or_text(app.get("id")))
    if not AB.ID_RE.fullmatch(aid):
        return W.refuse(400, f'app.id "{aid}" is not a usable app id (kebab-case, e.g. custom-fleet-tracker).')
    name = gsjs.trim(gsjs.or_text(app.get("name")))
    if not name:
        return W.refuse(400, "app.name is required — the hub listing starts there.")
    pages = app.get("pages")
    if not isinstance(pages, list) or not pages:
        return W.refuse(400, "app.pages must hold at least one page.")
    if len(pages) > AB.MAX_PAGES:
        return W.refuse(400, f"app.pages holds {len(pages)} pages; the most an app may have is {AB.MAX_PAGES}.")
    for i, pg in enumerate(pages):
        bad = _bad_page(pg, i)
        if bad:
            return W.refuse(400, bad)
    audience: list[str] = []
    for a in app.get("audience") if isinstance(app.get("audience"), list) else ():
        a = gsjs.trim(gsjs.or_blank(a) if a is not None else "null")
        if a in AB.AUDIENCE and a not in audience:
            audience.append(a)
    warnings: list[str] = []
    v_ab = AB.view(reads, user, AB.TAB)
    owned = {s_(r.get("resource")) for r in AB.normalized(v_ab)} - {""}
    prepared = []
    for i, pg in enumerate(pages):
        label = gsjs.or_text(_get(pg, "id")) or str(i + 1)
        res = gsjs.trim(gsjs.js_str(_get(pg, "resource")))
        state = _state(reads, user, v_ab.sid, res, owned)
        if state not in ("builder", "coded", "create"):
            return W.refuse(400, f"page {label}: {state}.")
        if state == "builder" and AB.declared_gone(reads, res) and not _home_tab(reads, user, res):
            return W.refuse(400, f'page {label}: resource "{res}" moved to a book that did not answer — publish again'
                                 " once it does.")
        options = (pg["options"] if not gsjs.falsy(pg["options"]) else {}) if isinstance(pg, dict) and \
            "options" in pg else None
        if isinstance(options, str):
            parsed, options = ST._parse(options)
            if not parsed:
                return W.refuse(400, f"page {label}: options is a string that is not JSON.")
        if isinstance(options, (dict, list)):
            _sanitize(options, warnings, label)
        text = CR.js_json(options) if options is not None else gsjs.or_text(_get(pg, "optionsText"))
        if ST._js_len(text) > AB.MAX_OPTIONS_CHARS:
            return W.refuse(400, f'page "{label}": options is {ST._js_len(text)} characters; the most a cell holds'
                                 f" safely here is {AB.MAX_OPTIONS_CHARS}.")
        cols = _get(pg, "columns")
        prepared.append({"page": pg, "resource": res, "state": state, "options": text,
                         "columns": _columns_dsl(cols) if isinstance(cols, list) else gsjs.or_text(cols)})
    where = AB.here(reads, user)
    if any(s_(r.get("appid")) == aid and not AB.visible(where, r.get("tenant")) for r in AB.normalized(v_ab)):
        return W.refuse(409, f'The app id "{aid}" is already published elsewhere on this platform — choose another'
                             " id.")
    if not v_ab.exists:
        _gone(reads, v_ab.sid, AB.TAB)
    now = W.now_iso(reads)
    by = "asa-hub:" + (gsjs.or_text(user.get("email")) or "unknown")
    enabled = "FALSE" if app.get("enabled") is False or app.get("enabled") == "FALSE" else "TRUE"
    rows: list[dict] = []
    tabs: list[dict] = []
    ops: list[dict] = []
    made: set[tuple[str, str]] = set()
    for i, prep in enumerate(prepared):
        pg, res = prep["page"], prep["resource"]
        rows.append(dict(zip(AB.COLUMNS, (
            aid, name, gsjs.or_text(app.get("tagline")), gsjs.or_text(app.get("icon")) or "layout-grid",
            gsjs.or_text(app.get("accent")) or "blue", gsjs.or_text(app.get("category")) or "Workspace",
            ",".join(audience), gsjs.or_text(_get(pg, "id")) or ("main" if i == 0 else f"page-{i + 1}"),
            gsjs.or_text(_get(pg, "title")) or name, gsjs.or_text(_get(pg, "type")) or "sheet", res,
            prep["columns"], prep["options"], enabled, gsjs.or_text(_get(pg, "notes")), now, by, where))))
        if prep["state"] == "coded":
            tabs.append({"resource": res, "state": "coded", "seeded": 0})
            continue
        state, seeded = _data_tab(reads, user, res, AB.columns_of(prep["columns"]), _get(pg, "rows"), made, ops)
        tabs.append({"resource": res, "state": state, "seeded": seeded})
    ops.append(AB.op_of(v_ab, {"header": list(AB.COLUMNS), "seed": list(AB.EXAMPLE), "grow": list(AB.COLUMNS),
                               "drop": {"column": "app_id", "value": aid, "here": where}, "append": rows}))
    _queue(ops, aid, user, "appBuilderUpsert")
    staff_views.record(user, "appBuilderUpsert", aid)
    return _kept({"status": 200, "data": {"id": aid, "pages": len(rows), "tabs": tabs, "warnings": warnings}})


def _home_tab(reads: L.Reads, user: dict, resource: str) -> bool:
    """hubTabSheet_(resource): a tab the router answers for (a dissolved one through the runtime)."""
    try:
        return AB.view(reads, user, resource).exists
    except AB.Facts:
        return True


# ---- Main.gs route('apps', …): readOnly, clientOpen ---------------------------------------------------------------

def _not_allowed(verb: str) -> Decision:
    return W.refuse(405, f'Action "{verb}" is not allowed on resource "{AB.APPS_TAB}" (read/update-only).')


def apps_create(sess: L.Session, payload: dict) -> Decision:
    """route('apps', 'create'): refused — the resource is read/update-only (hubPlaceGate_ refuses no create)."""
    return _not_allowed("create")


def apps_update(sess: L.Session, payload: dict) -> Decision:
    """route('apps', 'update'): the place settled (another place's row is not here), then an admin's change merged by
    updateRowById_."""
    reads, user = sess.reads, sess.user or {}
    _r, p = AB.resource_of(payload)
    v = AB.view(reads, user, AB.APPS_TAB)
    gate = _place_gate(v, "update", p, AB.here(reads, user))
    if gate:
        return Decision(gate)
    if user.get("role") != "admin":
        return Decision(dict(ST.DENIED))
    answer, ops = _update(reads, v, p)
    return _answered(answer, ops, s_(p.get("id")), user, "update")


def apps_delete(sess: L.Session, payload: dict) -> Decision:
    """route('apps', 'delete'): the place settled, then refused — the resource is read/update-only."""
    reads, user = sess.reads, sess.user or {}
    _r, p = AB.resource_of(payload)
    where = AB.here(reads, user)
    if where:
        gate = _place_gate(AB.view(reads, user, AB.APPS_TAB), "delete", p, where)
        if gate:
            return Decision(gate)
    return _not_allowed("delete")


# ---- route()'s other names: the imports and the tabs app_builder names --------------------------------------------

def _client_gate(v: AB.View, resource: str, user: dict, p: dict) -> dict[str, Any] | None:
    """A client may not write somebody else's row (route's update and delete): such a resource is open to none."""
    if s_(user.get("role")) != "client" or user.get("is_service"):
        return None
    mine = AB.require_row(v, s_(p.get("id")), resource)
    if "error" in mine:
        return mine["error"]
    return {"status": 404, "message": f'No "{resource}" record here.'}


def _generic_write(verb: str) -> Callable[[L.Session, dict], Decision]:
    def door(sess: L.Session, payload: dict) -> Decision:
        reads, user = sess.reads, sess.user or {}
        resource, p = AB.resource_of(payload)
        if resource in AB.CODED:
            return W.refuse(500, f'Internal error: "{resource}" is a coded resource.')
        kind, got = AB.target(reads, user, resource)
        if kind == "dyn":
            return Decision(AB.dyn_answer(sess, resource, got, verb, p))
        if kind == "unknown":
            return Decision(AB.unknown(resource, got))
        v = AB.view(reads, user, resource)
        gate = _place_gate(v, verb, p, AB.here(reads, user), resource)
        if gate:
            return Decision(gate)
        if verb in ("update", "delete"):
            refused = _client_gate(v, resource, user, p)
            if refused:
                return Decision(refused)
        if verb == "create":
            created, op = _create(reads, v, p, resource)
            _queue([op], resource, user, verb)
            return _kept({"status": 200, "data": created})
        if verb == "update":
            answer, ops = _update(reads, v, p, resource)
            return _answered(answer, ops, resource, user, verb)
        # deleteRowById_: the first row of the id removed
        _funnel(reads)
        rid = p.get("id")
        if rid is None or rid == "":
            return W.refuse(400, 'Missing required "id" in payload.')
        made = _sheet_for(reads, v, resource)
        found = AB.require_row(v, rid, resource)
        if "error" in found:
            return _answered(found["error"], made, resource, user, verb)
        return _answered({"status": 200, "data": {"id": rid, "deleted": True}}, made + [AB.op_of(v, {"drop": {
            "column": "id", "value": gsjs.trim(gsjs.js_str(rid)), "first": True}})], resource, user, verb)
    door.__doc__ = f"route(resource, '{verb}') for an import (read-only) or a tab app_builder names."
    return door


# ---- first touch: the tabs a read found the sheet lacks, queued through App Studio's store ------------------------

_BOUND: dict[str, Any] = {}
# a tab this process asked for is not asked again before this long (a refusal is not hammered)
TOUCH_HOLD_S = 600.0
_TOUCHED: dict[tuple[str, str], float] = {}
_TOUCH_LOCK = threading.Lock()


def bind(store: Any) -> None:
    """The write store a read's first touch queues its tabs through (main.py's App Studio store)."""
    _BOUND["store"] = store
    AB.ENSURE[:] = [ensure_tabs]


def ensure_tabs(ops: list[dict], action: str) -> None:
    """hubTabEnsure_ and ensureHeader_ as Apps Script ran them while it read: each tab's op queued once, in a write of
    its own under the platform's lock. Repeats are held three ways: a read lays every op not yet read back, so a queued
    tab is never found missing again; under the lock an op still open on the tab, or refused lately, holds it; and this
    process asks for a tab at most once per TOUCH_HOLD_S."""
    store = _BOUND.get("store")
    if store is None or not store.ready():
        return
    now = time.monotonic()
    with _TOUCH_LOCK:
        fresh = [o for o in ops if now - _TOUCHED.get((o["sheet_id"], o["tab"]), -TOUCH_HOLD_S) >= TOUCH_HOLD_S]
        for o in fresh:
            _TOUCHED[(o["sheet_id"], o["tab"])] = now
    if not fresh:
        return
    try:
        with store.locked() as tx:
            with SC.deciding(tx, "touch-" + W.mint(), action):
                queue_touch(fresh, action)
    except W.Busy:
        with _TOUCH_LOCK:
            for o in fresh:
                _TOUCHED.pop((o["sheet_id"], o["tab"]), None)


def queue_touch(ops: list[dict], action: str) -> list[dict]:
    """Under the write lock: the ops no open or lately refused op on their tab holds, queued; those queued."""
    cur = W.HELD.get()
    keep = []
    for o in ops:
        cur.execute(f"select 1 from {BO.table()} where op = %s and sheet_id = %s and tab_name = %s and (state in"
                    " ('pending', 'applying') or state in ('refused', 'failed') and done_at > now() -"
                    " make_interval(secs => %s)) limit 1", (AB.OP, o["sheet_id"], o["tab"], AB.LAY_DONE_S))
        if not cur.fetchall():
            keep.append(o)
    if keep:
        BO.queue(keep, "appbuilder:touch", "asa-hub:" + action, action)
    return keep


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {a: AB.answering(door, Decision) for a, door in {
    "appBuilderUpsert": builder_upsert, "appDelete": app_delete, "appUpsert": app_upsert, "sheetImport": sheet_import,
    "appsCreate": apps_create, "appsUpdate": apps_update, "appsDelete": apps_delete,
    "builderCreate": _generic_write("create"), "builderUpdate": _generic_write("update"),
    "builderDelete": _generic_write("delete")}.items()}
# the declared roles and params answer in the doors, after the place law
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
BUSY_OF: dict[str, dict[str, Any]] = {a: {"status": 409, "message": PUBLISH_BUSY if a == "appBuilderUpsert"
                                          else W.BUSY} for a in ACTIONS}
