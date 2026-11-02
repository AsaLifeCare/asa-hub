"""Prefs.gs's saves on Python behind the `prefs` switch. prefsSet: the person's own user_prefs row upserted by their id
and kept in app.edits — the cells Apps Script's save writes (prefs and updated_at; the whole row when there is none),
the release stamp a release wrote into the blob (ReleaseUsers.gs) put back, so neither writer undoes the other's; the
last of two rows with their id is written by a `cells` book op (no kept edit names it alone), and a tab the copy does
not hold is made by a `mirror` one, as prefsSheet_ makes it. userMenuLinksSet and appShelfSet: the master's whole-tab
rewrites (the company menu; the sidebar's sections and placement), each one `mirror` book op that makes the tab when
the copy holds none. Every op is queued in this write's transaction, carried by asa-hub-sheet-sync in one request and
laid over the copy (app/prefs_doors.py) until the keeper reads it back."""
from __future__ import annotations

import re
import secrets
from typing import Any, Callable

import book_ops as BO
import door_gate as DG
import gsjs
import house_tables as HT
import hubdb
import lane_mirror as LM
import locations as L
import prefs_doors as PD
import resource_rows as RR
import scope as sc
import staff_views
import writes as W
from scope import Defer
from writes import Decision

# LockService's own sentence, for the two doors that take the script lock
BUSY = "Another update is in progress — try again."
MENU_MAX = 40
SECTIONS_MAX = 60
PLACEMENT_MAX = 400
# a bare object's inherited names answer as present when looked up on it (`seen[sid]`)
_JS_INHERITED = frozenset({"constructor", "hasOwnProperty", "isPrototypeOf", "propertyIsEnumerable", "toString",
                           "valueOf", "toLocaleString", "__proto__", "__defineGetter__", "__defineSetter__",
                           "__lookupGetter__", "__lookupSetter__"})

s_ = gsjs.str_


# ---- prefsSet -------------------------------------------------------------------------------------------------

def keep_released(pushed: Any, stored: str) -> str:
    """prefsKeepReleased_: the pushed blob as it is stored, with the release stamp the server owns put back when the
    stored one is newer or the blob carries none."""
    out = {str(k): v for k, v in pushed.items()} if isinstance(pushed, dict) else \
        {str(i): v for i, v in enumerate(pushed)}
    try:
        held = PD.parse(stored or "{}")
        had = s_(held.get(PD.RELEASED_KEY)) if isinstance(held, dict) else ""
    except (ValueError, RecursionError):
        had = ""
    mine = s_(out.get(PD.RELEASED_KEY))
    if had and (not mine or PD.js_after(had, mine)):
        out[PD.RELEASED_KEY] = had
    return PD.js_stringify(out)


def prefs_set(sess: L.Session, payload: dict) -> Decision:
    """prefsSet: the signed-in person's own preferences, capped at 20KB; the last row with their id is theirs."""
    refused = PD.refusal(sess, "prefsSet", payload)
    if refused:
        return Decision(refused)
    reads, user = sess.reads, sess.user or {}
    p = payload if isinstance(payload, dict) else {}
    prefs = p.get("prefs")
    if not isinstance(prefs, (dict, list)):
        return W.refuse(400, "prefs object required")
    raw = PD.js_stringify(prefs)
    if PD.js_len(raw) > PD.PREFS_MAX_BYTES:
        return W.refuse(413, "prefs blob over 20KB — preferences only, never data.")
    uid = s_(user.get("id"))
    if user.get("is_service") or not uid:
        raise Defer("a session with no account of its own keeps no preference row here")
    got = PD.held_rows(reads, uid)
    sid, ref, tab, rows, heads, mine = got["sid"], got["ref"], got["tab"], got["rows"], got["heads"], got["mine"]
    now = W.now_iso(reads)
    answer = {"status": 200, "data": {"ok": True}}
    stored = PD.cell(rows[mine[-1]][1], heads.get("prefs")) if mine else ""
    if stored.startswith(PD.WITHHELD):
        raise Defer("the copy withholds this person's preference row")
    if isinstance(ref, HT.KeptRef):
        # its own table: the person's last row given the save, else their row made
        resource = HT.resource_of(PD.PREFS_TAB) or ""
        name = {k: heads.get(hubdb.norm_key(k)) or k for k in PD.PREFS_HEADER}
        if mine:
            key, cells = RR.table_rows(reads, resource)[mine[-1]]
            RR.update(reads, resource, key, cells, {name["prefs"]: keep_released(prefs, stored),
                                                    name["updated_at"]: now}, s_(user.get("email")))
        else:
            RR.create(reads, resource, {name["user_id"]: uid, name["prefs"]: raw, name["updated_at"]: now},
                      s_(user.get("email")))
        return Decision(answer, subject=PD.APP_ID, own=True)
    if ref is None:
        # prefsSheet_ makes the tab, header only, before the row is written: the tab as this save leaves it
        lines = [{h: PD.cell(raw, heads.get(hubdb.norm_key(h))) for h in PD.PREFS_HEADER} for _rn, raw in rows]
        if mine:
            lines[mine[-1]].update({"prefs": keep_released(prefs, stored), "updated_at": now})
        else:
            lines.append({"user_id": uid, "prefs": raw, "updated_at": now})
        res = hubdb.Resolved(sid, (PD.PREFS_TAB,), None, False, True)
        queue_rewrite(rewrite_op(res, PD.PREFS_HEADER, lines, PD.PREFS_TAB), PD.PREFS_TAB, s_(user.get("email")),
                      "prefsSet")
        return Decision(answer, subject=PD.APP_ID, own=True)
    iu, ip, it = heads.get("userid"), heads.get("prefs"), heads.get("updatedat")
    lacking = next((n for n, h in zip(PD.PREFS_HEADER, (iu, ip, it)) if h is None), "")
    if lacking:
        return W.refuse(500, 'the preferences tab has no "' + lacking + '" column')
    field = {h: gsjs.trim(gsjs.js_str(h)) for h in (iu, ip, it)}
    if not mine:
        rec = W.kept_record(sid, tab, "append", W.COLS + field[iu], gsjs.trim(uid), PD.APP_ID,
                            {field[iu]: uid, field[ip]: raw, field[it]: now})
        return W.final(answer, [rec], PD.APP_ID)
    at = mine[-1]
    line = rows[at][1]
    cells = {field[ip]: keep_released(prefs, stored), field[it]: now}
    before = {field[ip]: stored, field[it]: PD.cell(line, it)}
    key = W.row_key_of(rows, at, [[iu]])
    if key is None:
        # THE LAST ROW IS THE PERSON'S, and no kept edit names it alone among the rows with their id: its cells
        # written on the last such row, as the sheet holds it when the op is carried
        cur = W.HELD.get()
        if cur is None:
            raise W.NotKept("a book change is queued only under the platform's write lock")
        subj = PD.cells_subject(uid)
        cur.execute(f"update {BO.table()} set state = 'cancelled', done_at = now(), why = 'a newer save carries it'"
                    " where subject = %s and op = %s and state = 'pending'", (subj, PD.CELLS_OP))
        BO.queue([{"op": PD.CELLS_OP, "sheet_id": sid, "tab": tab,
                   "spec": {"match": field[iu], "key": uid, "cells": cells, "before": before}}],
                 subj, s_(user.get("email")), "prefsSet")
        return Decision(answer, subject=PD.APP_ID, own=True)
    rec = W.kept_record(sid, tab, "edit", key[0], key[1], PD.APP_ID, cells, before)
    return W.final(answer, [rec], PD.APP_ID)


# ---- the whole-tab rewrites ---------------------------------------------------------------------------------------

def rewrite_op(res: hubdb.Resolved, header: tuple, lines: list[dict[str, str]], tab_name: str) -> dict[str, Any]:
    """The tab as clearContent() under the header and setValues() leave it: every column the copy holds kept under its
    own name (its cells emptied where the save names none), the save's columns matched by normKey_; a tab the copy
    holds none of is made with the save's header (`create`), as hubTabEnsure_ and prefsSheet_ make it."""
    sid, tab = W.where_of(res)
    held: dict[str, str] = {}
    extra: list[str] = []
    for h in res.ref.headers if res.ref is not None else ():
        name = gsjs.trim(hubdb.twin_base(gsjs.js_str(h)))
        k = hubdb.norm_key(name)
        if k and k not in held:
            held[k] = name
        elif name and name not in extra:
            extra.append(name)
    names = [held.pop(hubdb.norm_key(h), h) for h in header]
    extra = [n for n in list(held.values()) + extra if n and n not in names]
    spec_header = names + extra
    spec_rows = [[W.sheet_text(line.get(h, "")) for h in header] + [""] * len(extra) for line in lines]
    spec = {"resource": tab_name, "fingerprint": LM.fingerprint(spec_header, spec_rows), "header": spec_header,
            "rows": spec_rows}
    if res.ref is None:
        spec["create"] = True
    return {"op": PD.OP, "sheet_id": sid, "tab": tab, "spec": spec}


def queue_rewrite(op: dict[str, Any], tab_name: str, author: str, action: str) -> None:
    """The rewrite kept in this write's transaction: a rewrite of the same tab still waiting is dropped (this one
    carries every row), and the rows of the ones already carried are let go."""
    cur = W.HELD.get()
    if cur is None:
        raise W.NotKept("a book change is queued only under the platform's write lock")
    subj = PD.subject(tab_name)
    cur.execute(f"update {BO.table()} set state = 'cancelled', done_at = now(), why = 'a newer rewrite carries it'"
                " where subject = %s and op = %s and state = 'pending'", (subj, PD.OP))
    cur.execute(f"update {BO.table()} set spec = spec - 'rows' where subject = %s and op = %s"
                " and state in ('done', 'refused', 'failed', 'cancelled') and spec ? 'rows'", (subj, PD.OP))
    BO.queue([op], subj, author, action)


def rewrite(reads: L.Reads, tab: str, header: tuple, lines: list[dict[str, str]], author: str, action: str) -> None:
    """The whole tab replaced by the lines: on its own table once the house is kept there (the save's columns matched
    by normKey_), else by the book op that rewrites the sheet."""
    if HT.tabled(tab):
        cols = {hubdb.norm_key(c): c for c in reversed(HT.kept_ref(reads, tab).headers)}
        HT.rewrite(reads, tab, [{cols.get(hubdb.norm_key(h), h): W.sheet_text(line.get(h, "")) for h in header}
                                for line in lines], author)
        return
    queue_rewrite(rewrite_op(held_tab(reads, tab), header, lines, tab), tab, author, action)


def held_tab(reads: L.Reads, tab: str) -> hubdb.Resolved:
    """The tab a rewrite lands on, as the router opens it: the copy's, else the one hubTabEnsure_ makes (a house's Data
    tab); a book the copy does not hold is unreadable."""
    return W.tab_of(reads, tab)


def master_door(user: dict[str, Any] | None) -> Decision | None:
    """The master's pen alone, 404-shaped for everyone else — the master in its own session."""
    if not user or not sc.is_real_master(user):
        return Decision(dict(DG.UNKNOWN))
    return None


def menu_set(sess: L.Session, payload: dict) -> Decision:
    """userMenuLinksSet: what arrives replaces the whole company menu."""
    refused = PD.refusal(sess, "userMenuLinksSet", payload)
    if refused:
        return Decision(refused)
    door = master_door(sess.user)
    if door:
        return door
    reads, user = sess.reads, sess.user or {}
    p = payload if isinstance(payload, dict) else {}
    links = p.get("links") if isinstance(p.get("links"), list) else None
    if links is None:
        return W.refuse(400, "links: the whole list, in order.")
    if len(links) > MENU_MAX:
        return W.refuse(400, "A menu longer than 40 links is a page, not a menu.")
    now, email = W.now_iso(reads), s_(user.get("email"))
    lines: list[dict[str, str]] = []
    for i, item in enumerate(links):
        lk = item if isinstance(item, dict) else {}
        label = PD.js_slice(s_(lk.get("label")), 80)
        href = PD.js_slice(s_(lk.get("href")), 500)
        external = lk.get("external") is True or s_(lk.get("external")).lower() == "true"
        if not label or not href:
            return W.refuse(400, "Every link needs a label and a destination.")
        if external and not re.match(r"https?://", href, re.I):
            return W.refuse(400, '"' + label + '": an external link must start with http(s)://.')
        if not external and not href.startswith("/"):
            return W.refuse(400, '"' + label + '": an in-app destination must start with /.')
        lines.append({"id": s_(lk.get("id")) or "um_" + secrets.token_hex(4), "label": label,
                      "icon": PD.js_slice(s_(lk.get("icon")), 40) or "link", "href": href,
                      "external": "true" if external else "false",
                      # empty = every badge
                      "badges": ", ".join(sc.types_from_raw(lk.get("badges"))), "sort": str(i + 1),
                      "updated_at": now, "updated_by": email})
    rewrite(reads, PD.MENU_TAB, PD.MENU_HEADER, lines, email, "userMenuLinksSet")
    staff_views.record(user, "user_menu_links_set",
                       f"{len(lines)} link(s) — the whole company menu, stamped {now}")
    return Decision({"status": 200, "data": {"saved": len(lines), "updated_at": now}}, subject=PD.APP_ID, own=True)


def shelf_set(sess: L.Session, payload: dict) -> Decision:
    """appShelfSet: the whole shelf, in order — both halves or neither."""
    refused = PD.refusal(sess, "appShelfSet", payload)
    if refused:
        return Decision(refused)
    door = master_door(sess.user)
    if door:
        return door
    reads, user = sess.reads, sess.user or {}
    p = payload if isinstance(payload, dict) else {}
    sections = p.get("sections") if isinstance(p.get("sections"), list) else None
    placement = p.get("placement") if isinstance(p.get("placement"), list) else None
    if sections is None or placement is None:
        return W.refuse(400, "sections and placement: the whole shelf, in order.")
    if len(sections) > SECTIONS_MAX:
        return W.refuse(400, "A sidebar of 60 sections is not a sidebar.")
    if len(placement) > PLACEMENT_MAX:
        return W.refuse(400, "More placements than the registry can hold.")
    now, email = W.now_iso(reads), s_(user.get("email"))
    sec_lines: list[dict[str, str]] = []
    seen: set[str] = set()
    for i, item in enumerate(sections):
        s = item if isinstance(item, dict) else {}
        sid = PD.js_slice(s_(s.get("id")), 80)
        label = PD.js_slice(s_(s.get("label")), 60)
        if not sid or not label:
            return W.refuse(400, "Every section needs an id and a name.")
        if sid in seen or sid in _JS_INHERITED:
            return W.refuse(400, 'Two sections share the id "' + sid + '".')
        seen.add(sid)
        sec_lines.append({"section_id": sid, "label": label, "tint": PD.js_slice(s_(s.get("tint")), 20) or "blue",
                          "icon": PD.js_slice(s_(s.get("icon")), 40), "position": str(i + 1), "updated_at": now,
                          "updated_by": email})
    counters: dict[str, int] = {}
    pl_lines: list[dict[str, str]] = []
    for item in placement:
        pl = item if isinstance(item, dict) else {}
        app_id = PD.js_slice(s_(pl.get("appId") if gsjs.falsy(pl.get("app_id")) else pl.get("app_id")), 80)
        sec_id = PD.js_slice(s_(pl.get("sectionId") if gsjs.falsy(pl.get("section_id")) else pl.get("section_id")),
                             80)
        if not app_id or not sec_id:
            # a half-written row is not a placement
            continue
        counters[sec_id] = counters.get(sec_id, 0) + 1
        pl_lines.append({"app_id": app_id, "section_id": sec_id, "position": str(counters[sec_id]),
                         "updated_at": now, "updated_by": email})
    rewrite(reads, PD.SECTIONS_TAB, PD.SECTIONS_HEADER, sec_lines, email, "appShelfSet")
    rewrite(reads, PD.PLACEMENT_TAB, PD.PLACEMENT_HEADER, pl_lines, email, "appShelfSet")
    staff_views.record(user, "app_shelf_set", f"{len(sec_lines)} section(s), {len(pl_lines)} app(s) placed")
    return Decision({"status": 200, "data": {"sections": len(sec_lines), "placement": len(pl_lines),
                                             "updated_at": now}}, subject=PD.APP_ID, own=True)


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {
    "prefsSet": prefs_set, "userMenuLinksSet": menu_set, "appShelfSet": shelf_set}
# main.policy_gate asks nothing: each door asks its gates first, with Prefs.gs's declaration
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
# the script lock's sentence for the two doors that take it; prefsSet takes none (busy, the relay says 503)
BUSY_OF: dict[str, dict[str, Any]] = {"userMenuLinksSet": {"status": 503, "message": BUSY},
                                      "appShelfSet": {"status": 503, "message": BUSY}}
