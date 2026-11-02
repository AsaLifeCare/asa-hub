"""Client Care's people doors (Clients.gs guardiansToRoster and clientViewsPolicy; the directory's quick edit, Main.gs
route('clients', 'update')) decided off asa-hub-db: the guardians the plans name filed onto the general roster
(`people`), a client's Hub row (`clients`) patched, each cell kept in app.edits as the truth; the Clients views and
toolbar items the master allows, read from the config."""
from __future__ import annotations

import logging
import re
from typing import Any, Callable

import call_offs_writes as COW
import client_writes as CW
import clients as C
import gsjs
import house_tables as HT
import hubdb
import locations as L
import scope as sc
import sheet_resources as SR
import staff_views
import writes as W
from gsjs import name_key
from scope import Defer
from writes import Decision

log = logging.getLogger("asa-hub-app")

PEOPLE_TAB = "people"
CLIENTS_TAB = "clients"
# guardianRosterWrite_'s ensureHeader_ columns; a tab sheetFor_ makes opens with hubTabEnsure_'s
ROSTER_HEADER = ("id", "name", "role", "status", "email", "phone", "guardian_for")
NEW_TAB_HEADER = ("id", "createdAt", "updatedAt")
ROSTER_CAP = 200
VIEWS = ("directory", "record", "unique")
TOOLS = ("share", "export", "add")
VIEW_ROLES = ("admin", "director", "manager", "staff", "client", "onboarding", "interviewer")
NO_ID = 'Missing required "id" in payload.'
# /[,;\s]+/, JavaScript's \s
_SEP = re.compile("[,;\t\n\x0b\x0c\r \xa0  -     　﻿]+")

s_ = gsjs.str_


# ---- the guardians the plans name ----------------------------------------------------------------------------------

def guardians_from(rows: list[dict]) -> dict[str, Any]:
    """guardiansFromClients_: one guardian a name key, the plans' order, the clients each stands for."""
    by_key: dict[str, dict[str, Any]] = {}
    order: list[dict[str, Any]] = []
    skipped = 0
    for rec in rows or []:
        rec = rec or {}
        raw = gsjs.trim(gsjs.js_str(C._or(rec.get("guardianName"), rec.get("guardian_name"), "")))
        if not C.guardian_is_person(raw):
            skipped += 1
            continue
        name = C.guardian_display_name(raw)
        if not C.guardian_is_person(name):
            skipped += 1
            continue
        key = name_key(name)
        if not key:
            skipped += 1
            continue
        hit = by_key.get(key)
        if hit is None:
            hit = by_key[key] = {"key": key, "id": "PPL_guardian_" + key, "name": name, "email": "", "phone": "",
                                 "for_names": [], "for_keys": set()}
            order.append(hit)
        if not hit["email"]:
            hit["email"] = gsjs.trim(gsjs.or_text(rec.get("guardian_email")))
        if not hit["phone"]:
            hit["phone"] = gsjs.trim(gsjs.or_text(rec.get("guardian_phone")))
        who = gsjs.trim(gsjs.or_text(rec.get("name")))
        wk = name_key(who)
        if wk and wk not in hit["for_keys"]:
            hit["for_keys"].add(wk)
            hit["for_names"].append(who)
    return {"guardians": [{"key": h["key"], "id": h["id"], "name": h["name"], "email": h["email"], "phone": h["phone"],
                           "guardian_for": ", ".join(h["for_names"])} for h in order],
            "skipped": skipped}


def for_merge(existing: Any, addition: Any) -> str:
    """guardianForMerge_: the names already listed, then the new ones, each name key once."""
    seen: set[str] = set()
    out: list[str] = []
    for text_ in (existing, addition):
        for part in gsjs.or_text(text_).split(","):
            name = gsjs.trim(part)
            k = name_key(name)
            if not k or k in seen:
                continue
            seen.add(k)
            out.append(name)
    return ", ".join(out)


def roster_write(reads: L.Reads, guardians: list[dict], cap: int = ROSTER_CAP) -> dict[str, Any]:
    """guardianRosterWrite_ kept in app.edits: a new guardian one appended row, a listed one's blank cells filled and
    their clients merged into guardian_for — a typed cell is never overwritten."""
    res = W.tab_of(reads, PEOPLE_TAB)
    sid, tab = W.where_of(res)
    # the house's rows as they stand: its own table once kept there
    held = HT.where(reads, PEOPLE_TAB).ref
    have = [h for h in (gsjs.js_str(x) for x in (held.headers if held is not None else NEW_TAB_HEADER)) if h]
    header = have + [k for k in ROSTER_HEADER if k not in have]
    rows = HT.tab_rows(reads, held)

    def val(raw: dict, col: str) -> str:
        """String(values[r][c] || '').trim(), the cell as getValues hands it."""
        return gsjs.trim(gsjs.or_text(hubdb.typed(raw.get(col), "hub")))

    row_at: dict[str, dict] = {}
    for _rn, raw in rows:
        rid = val(raw, "id")
        if rid and rid not in row_at:
            row_at[rid] = raw

    created = filled = writes = 0
    edits: list[dict] = []
    now = W.now_iso(reads)
    g = 0
    while g < len(guardians) and writes < cap:
        w = guardians[g]
        g += 1
        at = row_at.get(w["id"])
        if at is None:
            # one appended row carrying every cell
            line: dict[str, Any] = {}
            for col, v in (("id", w["id"]), ("name", w["name"]), ("role", "guardian"), ("status", "active"),
                           ("email", w["email"]), ("phone", w["phone"]), ("guardian_for", w["guardian_for"]),
                           ("createdAt", now), ("updatedAt", now)):
                if col in header and gsjs.or_text(v) != "":
                    line[col] = v
            edits.append(W.kept_record(sid, tab, "append", "id", w["id"], "", {h: line[h] for h in header if h in line}))
            created += 1
            writes += 1
            continue
        cells: dict[str, Any] = {}
        before: dict[str, Any] = {}
        fields = (("name", w["name"]), ("role", "guardian"), ("status", "active"), ("email", w["email"]),
                  ("phone", w["phone"]))
        f = 0
        while f < len(fields) and writes < cap:
            col, v = fields[f]
            f += 1
            if col not in header or gsjs.or_text(v) == "":
                continue
            if val(at, col) != "":
                continue
            cells[col] = v
            before[col] = at.get(col)
            writes += 1
        if "guardian_for" in header and writes < cap:
            was = val(at, "guardian_for")
            CW.marked(was)
            merged = for_merge(was, w["guardian_for"])
            if merged != was:
                cells["guardian_for"] = merged
                before["guardian_for"] = at.get("guardian_for")
                writes += 1
        if cells:
            filled += 1
            edits.append(W.kept_record(sid, tab, "edit", "id", w["id"], "", cells, before))
    # capped: work was left, not that the budget was spent
    return {"created": created, "filled": filled, "writes": writes, "capped": g < len(guardians), "edits": edits}


def guardians_to_roster(sess: L.Session, payload: dict) -> Decision:
    """guardiansToRoster: every guardian the clients' plans name onto `people`, an admin's alone."""
    user, reads = sess.user, sess.reads
    if not user or user.get("is_service") or s_(user.get("role")) != "admin":
        return Decision(CW.denied())
    rows, why = L._soft(lambda: C.derived(reads))
    if rows is None:
        return W.refuse(503, f"The clients could not be read ({why}) — no roster row was written.")
    found = guardians_from(rows)
    for g in found["guardians"]:
        CW.marked(g["name"], g["email"], g["phone"], g["guardian_for"])
    wrote = roster_write(reads, found["guardians"], ROSTER_CAP)
    counts = {"examined": len(rows), "guardians": len(found["guardians"]), "created": wrote["created"],
              "filled": wrote["filled"], "skipped": found["skipped"], "capped": wrote["capped"]}
    staff_views.record(user, "guardians_to_roster",
                       f"{counts['created']} guardian(s) added to the roster and {counts['filled']} filled in, from "
                       f"{counts['examined']} client plan(s)")
    return W.final({"status": 200, "data": counts}, wrote["edits"], "")


# ---- the views and toolbar the master allows -------------------------------------------------------------------------

def toolbar_items(raw: Any) -> list[str]:
    """clientToolbarItems_: blank or 'yes' everything, 'no' nothing, else the items named."""
    v = gsjs.trim("" if raw is None else gsjs.js_str(raw)).lower()
    if not v or v == "yes":
        return list(TOOLS)
    if v == "no":
        return []
    picked = [p for p in _SEP.split(v) if p]
    return [t for t in TOOLS if t in picked]


def views_policy(sess: L.Session, payload: dict) -> dict[str, Any]:
    """clientViewsPolicy: the views clients_views_master names (blank, all) and clients_toolbar_master's items; a
    config that cannot be read fails open."""
    views, tools = list(VIEWS), list(TOOLS)
    try:
        cfg = sess.reads.config()
        raw = gsjs.or_text(cfg.get("clients_views_master")).lower()
        if gsjs.trim(raw):
            allowed = [p for p in _SEP.split(raw) if p]
            views = [v for v in views if v in allowed]
        tools = toolbar_items(cfg.get("clients_toolbar_master"))
    except Exception as exc:  # noqa: BLE001 - as the port: unreadable config fails open
        log.warning("clientViewsPolicy: the config could not be read, every view open (%s)", type(exc).__name__)
    return {"status": 200, "data": {"views": views, "tools": tools}}


# ---- the directory's quick edit: the generic update of a client's Hub row --------------------------------------------

def client_row(reads: L.Reads, want: str) -> tuple[dict, dict] | None:
    """requireRow_ on `clients`: the first row whose id is `want` — as readAll_ shows it, and its cells as the copy
    holds them."""
    res = W.tab_of(reads, CLIENTS_TAB)
    if res.ref is None:
        return None
    heads = [h for h in res.ref.headers if gsjs.js_str(h) != ""]
    if "id" not in heads:
        return None
    for _rn, raw in reads.db.rows(res.ref):
        if gsjs.js_str(hubdb.typed(raw.get("id"), "raw")) == want:
            return {h: hubdb.cell_text(hubdb.typed(raw.get(h), "raw")) for h in heads}, raw
    return None


def clients_update(sess: L.Session, payload: dict) -> Decision:
    """route('clients', 'update'), with the line doPost logs for it."""
    got = update_decided(sess, payload)
    staff_views.record(sess.user, "clients.update", s_((payload if isinstance(payload, dict) else {}).get("id")))
    return got


def update_decided(sess: L.Session, payload: dict) -> Decision:
    """hubPlaceGate_ (the place stripped), a client only on their own row (hubClientRowGate_), then updateRowById_:
    the row merged with the patch, createdAt immutable, updatedAt refreshed — the patched cells kept in app.edits."""
    user, reads = sess.user or {}, sess.reads
    patch = dict(payload) if isinstance(payload, dict) else {}
    patch.pop("tenant", None)
    if not user.get("is_service") and not sc.is_real_master(user) and s_(user.get("home_tenant")):
        raise Defer("an account homed away from headquarters writes its place's rows")
    CW.no_proto(*(str(k) for k in patch))
    if SR._client(user):
        cid = s_(patch.get("id"))
        if not cid:
            return W.refuse(400, NO_ID)
        mine = client_row(reads, cid)
        if mine is None:
            return W.refuse(404, f'No "{CLIENTS_TAB}" record with id "{cid}".', fresh=True)
        key = SR._client_key(user)
        if not key or not SR._theirs(reads, mine[0], key):
            return W.refuse(404, f'No "{CLIENTS_TAB}" record here.', fresh=True)
    W.gate(reads)
    if "id" not in patch or patch["id"] == "":
        return W.refuse(400, NO_ID)
    want = gsjs.js_str(patch["id"])
    hit = client_row(reads, want)
    if hit is None:
        return W.refuse(404, f'No "{CLIENTS_TAB}" record with id "{want}".', fresh=True)
    row, raw = hit
    CW.marked(*(v for k, v in patch.items() if k != "createdAt"))
    now = W.now_iso(reads)
    merged = dict(row)
    cells: dict[str, Any] = {}
    for k, v in patch.items():
        if k == "createdAt":
            continue
        merged[k] = v
        if k != "id":
            cells[k] = COW.serialize(v)
    merged["updatedAt"] = cells["updatedAt"] = now
    sid, tab = W.where_of(W.tab_of(reads, CLIENTS_TAB))
    subject = gsjs.trim(gsjs.or_text(row.get("client_key"))) or name_key(row.get("name"))
    rec = W.kept_record(sid, tab, "edit", "id", want, subject, cells, {k: raw.get(k) for k in cells})
    # a cell the copy withholds is no value to hand back
    shown = {k: v for k, v in merged.items() if not C._marked(v)}
    return W.final({"status": 200, "data": shown}, [rec], subject)


READ_ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {"clientViewsPolicy": views_policy}
WRITE_ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {"guardiansToRoster": guardians_to_roster,
                                                                  "clientsUpdate": clients_update}
# HUB_POLICY: the roles each action is declared for; the generic update declares none, route()'s own gates decide
POLICY: dict[str, dict[str, Any]] = {"clientViewsPolicy": {"roles": VIEW_ROLES, "params": {}},
                                     "guardiansToRoster": {"roles": ("admin",), "params": {}},
                                     "clientsUpdate": {}}
# the answer while the write lock is held: guardiansToRoster waits on the script lock; the generic update takes none
BUSY_OF: dict[str, dict[str, Any]] = {
    "guardiansToRoster": {"status": 503, "message": "The roster is being written right now — try again in a moment."}}
