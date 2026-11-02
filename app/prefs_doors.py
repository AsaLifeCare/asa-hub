"""Prefs.gs's preference blob, workspace shelf, company menu and hubBoot on Python behind the `prefs` switch, off
asa-hub-db: the person's own user_prefs row (prefsGet: the last row with their id, in the preferences workbook), the
sidebar's sections and placement (appShelfGet) and the company menu (userMenuLinksList) — each tab read with what
app/prefs_doors_writes.py queued for it laid over the copy until the copy holds it (a whole-tab rewrite, or the cells
of a person's last row) — and hubBoot, its four parts asked of the Python doors that answer them."""
from __future__ import annotations

import json
import logging
import math
from typing import Any, Callable

import app_control as AC
import book_ops as BO
import door_gate as DG
import gsjs
import house_tables as HT
import hubdb
import locations as L
import members as MEM
import prefs as P
import resource_rows as RR
import scope as sc
import studio as ST
import writes as W
from scope import Defer

log = logging.getLogger("asa-hub-app")

APP_ID = "prefs"
# prefsSheet_: the preferences workbook's own tab, never routed
PREFS_BOOK, PREFS_TAB = "HUB_PREFS_ID", "user_prefs"
PREFS_HEADER = ("user_id", "prefs", "updated_at")
PREFS_MAX_BYTES = 20000
# PREFS_RELEASED_KEY: the stamp a release writes into the blob (ReleaseUsers.gs), owned by the server
RELEASED_KEY = "asa-released-at"
MENU_TAB = "user_menu_links"
MENU_HEADER = ("id", "label", "icon", "href", "external", "badges", "sort", "updated_at", "updated_by")
SECTIONS_TAB = "app_sections"
SECTIONS_HEADER = ("section_id", "label", "tint", "icon", "position", "updated_at", "updated_by")
PLACEMENT_TAB = "app_placement"
PLACEMENT_HEADER = ("app_id", "section_id", "position", "updated_at", "updated_by")
# the book ops these saves ride (app/book_ops.py): a whole-tab rewrite, one subject per tab; the cells of a person's
# last row, one subject per person
OP = "mirror"
CELLS_OP = "cells"
WITHHELD = "[withheld"
# Tenant.gs HUB_TENANT_SAFE_ACTIONS: of these doors, the ones that answer away from headquarters as at home
TENANT_SAFE = frozenset({"prefsGet", "prefsSet", "appShelfGet", "appShelfSet", "userMenuLinksList", "hubBoot"})
# HUB_POLICY as Prefs.gs declares it
GS_POLICY: dict[str, dict[str, Any]] = {"prefsGet": {}, "prefsSet": {}, "userMenuLinksList": {},
                                        "userMenuLinksSet": {"roles": ("admin",)}, "appShelfGet": {},
                                        "appShelfSet": {"roles": ("admin",)}, "hubBoot": {}}

s_ = gsjs.str_


def refusal(sess: L.Session, action: str, payload: dict) -> dict[str, Any] | None:
    """doPost's gates before these doors: away from headquarters only userMenuLinksSet is the unknown action (the rest
    are declared safe there), then hubPolicyGate_'s roles."""
    if action not in TENANT_SAFE:
        return DG.refusal(sess, action, payload, GS_POLICY)
    user = sess.user or {}
    roles = tuple((GS_POLICY.get(action) or {}).get("roles") or ())
    if roles and not user.get("is_service") and gsjs.js_str(user.get("role")) not in roles:
        return {"status": 403, "message": "This action is for " + " or ".join(roles) + "."}
    return None


# ---- JSON as Apps Script's JavaScript reads and writes it -------------------------------------------------------

def finite(v: Any) -> Any:
    """A parsed value with each number past the double's range as JSON.stringify writes it (null)."""
    if isinstance(v, float) and not math.isfinite(v):
        return None
    if isinstance(v, dict):
        return {k: finite(x) for k, x in v.items()}
    if isinstance(v, list):
        return [finite(x) for x in v]
    return v


def parse(text: str) -> Any:
    """JSON.parse: NaN and Infinity refused (ValueError)."""
    return finite(AC.json_parse(text))


def _index_key(k: str) -> bool:
    return k.isascii() and k.isdigit() and (k == "0" or k[0] != "0") and int(k) < 2 ** 32 - 1


def js_keys(d: dict) -> list[str]:
    """An object's own keys in JavaScript's order: the array-index ones ascending, then the rest as inserted."""
    keys = [str(k) for k in d]
    idx = sorted((k for k in keys if _index_key(k)), key=int)
    return idx + [k for k in keys if not _index_key(k)]


def _js_string(s: str) -> str:
    out = json.dumps(s, ensure_ascii=False)
    # a lone surrogate is escaped, as a well-formed JSON.stringify escapes it
    return "".join("\\u%04x" % ord(c) if 0xD800 <= ord(c) <= 0xDFFF else c for c in out)


def js_stringify(v: Any) -> str:
    """JSON.stringify of a parsed payload."""
    if v is None or (isinstance(v, float) and not math.isfinite(v)):
        return "null"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return gsjs.num_str(v)
    if isinstance(v, str):
        return _js_string(v)
    if isinstance(v, list):
        return "[" + ",".join(js_stringify(x) for x in v) + "]"
    if isinstance(v, dict):
        by = {str(k): x for k, x in v.items()}
        return "{" + ",".join(_js_string(k) + ":" + js_stringify(by[k]) for k in js_keys(by)) + "}"
    return _js_string(gsjs.js_str(v))


def js_len(s: str) -> int:
    """String.prototype.length: UTF-16 code units."""
    return len(s.encode("utf-16-le", "surrogatepass")) // 2


def js_slice(s: str, n: int) -> str:
    """s.slice(0, n) by UTF-16 code units; a pair cut in two keeps neither half."""
    return s.encode("utf-16-le", "surrogatepass")[:2 * n].decode("utf-16-le", "ignore")


def js_after(a: str, b: str) -> bool:
    """a > b as JavaScript compares strings: by UTF-16 code units."""
    return a.encode("utf-16-be", "surrogatepass") > b.encode("utf-16-be", "surrogatepass")


def or_number(v: Any, fallback: Any) -> Any:
    """Number(v) || fallback."""
    return P.or_number(v, fallback)


def json_number(n: Any) -> Any:
    """JSON.stringify writes an infinite number as null."""
    return None if isinstance(n, float) and not math.isfinite(n) else n


# ---- the preferences (prefsSheet_) ----------------------------------------------------------------------------

def heads_of(headers: Any) -> dict[str, str]:
    """normKey_ of each header, to the header as the rows key their cells (the first of a name)."""
    out: dict[str, str] = {}
    for h in headers or ():
        k = hubdb.norm_key(h)
        if k and k not in out:
            out[k] = h
    return out


def cell(raw: dict, h: str | None) -> str:
    """str_ of the cell getValues() hands back under header h ('' for no such header)."""
    return s_(hubdb.typed(raw.get(h), "hub")) if h else ""


def prefs_where(reads: L.Reads) -> tuple[str, hubdb.TabRef | None]:
    """prefsSheet_: the preferences workbook's own tab; a workbook the copy does not hold is unreadable, a tab it does
    not hold is none (prefsSheet_ makes it, header only)."""
    db = reads.db
    sid = gsjs.or_text(db.prop(PREFS_BOOK))
    if not sid or db.book(sid) is None:
        raise hubdb.Unreadable("asa-hub-db holds no copy of the preferences book")
    db.note_book(sid)
    return sid, db.tab(sid, PREFS_TAB)


def held_rows(reads: L.Reads, uid: str) -> dict[str, Any]:
    """The preference tab as it stands — the copy with the kept edits laid, or the rewrite that makes it while the copy
    holds no such tab — and the rows that carry this id, in sheet order (the last is the person's), with the cells
    queued for that last row laid over it. Once kept in its own table, its rows there."""
    if HT.tabled(PREFS_TAB):
        kept = HT.kept_ref(reads, PREFS_TAB)
        rows, heads = HT.tab_rows(reads, kept), heads_of(kept.headers)
        iu = heads.get("userid")
        mine = [i for i, (_rn, raw) in enumerate(rows) if uid and iu and cell(raw, iu) == uid]
        return {"sid": "", "ref": kept, "tab": PREFS_TAB, "rows": rows, "heads": heads, "mine": mine}
    sid, ref = prefs_where(reads)
    tab = ref.tab if ref is not None else PREFS_TAB
    if ref is not None:
        rows, heads = reads.db.rows(ref), heads_of(ref.headers)
    else:
        header, lines = rewrite_of(reads, PREFS_TAB, sid, tab) or ([], [])
        rows, heads = [(i + 2, dict(zip(header, line))) for i, line in enumerate(lines)], heads_of(header)
    iu = heads.get("userid")
    mine = [i for i, (_rn, raw) in enumerate(rows) if uid and iu and cell(raw, iu) == uid]
    if len(mine) > 1:
        spec = unsettled(reads, cells_subject(uid), CELLS_OP, sid, tab)
        if spec is not None:
            sent = spec.get("cells") or {}
            rn, raw = rows[mine[-1]]
            rows = list(rows)
            rows[mine[-1]] = (rn, {**raw, **{h: sent[gsjs.trim(h)] for h in raw if gsjs.trim(h) in sent}})
    return {"sid": sid, "ref": ref, "tab": tab, "rows": rows, "heads": heads, "mine": mine}


def prefs_of(reads: L.Reads, user: dict[str, Any]) -> dict[str, Any]:
    """prefsGet's data: the person's last row, parsed; null for none, a blank cell or one that does not parse."""
    got = held_rows(reads, s_(user.get("id")))
    if not got["mine"]:
        return {"prefs": None}
    raw = cell(got["rows"][got["mine"][-1]][1], got["heads"].get("prefs"))
    if raw.startswith(WITHHELD):
        raise Defer("the copy withholds this person's preference row")
    if not raw:
        return {"prefs": None}
    try:
        return {"prefs": parse(raw)}
    except (ValueError, RecursionError):
        return {"prefs": None}


def prefs_get(sess: L.Session, payload: dict) -> dict[str, Any]:
    """prefsGet: the signed-in person's own preferences, never anybody else's."""
    refused = refusal(sess, "prefsGet", payload)
    if refused:
        return refused
    return {"status": 200, "data": prefs_of(sess.reads, sess.user or {})}


# ---- what a save queued that the copy may not hold yet ------------------------------------------------------------

def subject(tab: str) -> str:
    """A whole-tab rewrite's subject: one tab's rewrite at a time."""
    return "prefs:" + tab


def cells_subject(uid: str) -> str:
    """The subject of the cells written on a person's last preference row."""
    return "prefs:" + PREFS_TAB + ":" + uid


def unsettled(reads: L.Reads, subj: str, op: str, sid: str, tab: str) -> dict[str, Any] | None:
    """The spec of the newest op of this subject on this tab while the copy may not hold it (waiting, being written,
    or written but not read back); None when the copy is the tab as it stands."""
    got = RR._q(reads, f"select spec, state, extract(epoch from done_at) from {BO.table()} where subject = %s"
                       " and op = %s and sheet_id = %s and tab_name = %s order by id desc limit 1",
                (subj, op, sid, tab))
    if not got:
        return None
    spec, state, done = got[0]
    if state == "done":
        book = reads.db.book(sid)
        if book is not None and hubdb._epoch(book.synced_at) > float(done or 0):
            return None
    elif state not in ("pending", "applying"):
        return None
    return spec if isinstance(spec, dict) else json.loads(spec or "{}")


def rewrite_of(reads: L.Reads, name: str, sid: str, tab: str) -> tuple[list[str], list[list[str]]] | None:
    """The tab `name` (the sheet's `tab` in book `sid`) as the newest rewrite queued for it leaves it, while the copy
    may not hold it: (header, rows)."""
    spec = unsettled(reads, subject(name), OP, sid, tab)
    if spec is None:
        return None
    return ([gsjs.or_blank(h) for h in spec.get("header") or []],
            [[gsjs.or_blank(v) for v in r] for r in spec.get("rows") or []])


def tab_rows(reads: L.Reads, tab: str) -> list[dict]:
    """readTabNormalized_ through the router (the house's Data tab once moved), a rewrite on its way laid — the one
    that makes the tab too, while the copy holds none; a house kept in its own table read there."""
    if HT.tabled(tab):
        return AC.tab_rows(reads, tab)
    res = reads.db.resolve(tab)
    if not res.runtime and res.sheet_id and (res.ref is not None or res.book_known):
        got = rewrite_of(reads, tab, *W.where_of(res))
        if got is not None:
            keys = [hubdb.norm_key(h) for h in got[0]]
            out = []
            for r in got[1]:
                if all(not v for v in r):
                    continue
                o: dict[str, Any] = {}
                for k, v in zip(keys, r):
                    if k and k not in o:
                        o[k] = v
                out.append(o)
            return out
    return AC.tab_rows(reads, tab)


def menu_links(reads: L.Reads) -> list[dict[str, Any]]:
    """userMenuLinksList's list: each row with an id, sorted by its sort (99 when none)."""
    out = []
    for r in tab_rows(reads, MENU_TAB):
        rid = s_(r.get("id"))
        if not rid:
            continue
        out.append({"id": rid, "label": s_(r.get("label")), "icon": s_(r.get("icon")) or "link",
                    "href": s_(r.get("href")), "external": s_(r.get("external")).lower() == "true",
                    "badges": sc.types_from_raw(r.get("badges")), "sort": or_number(r.get("sort"), 99),
                    "updated_at": s_(r.get("updatedat")), "updated_by": s_(r.get("updatedby"))})
    out.sort(key=lambda x: x["sort"])
    for x in out:
        x["sort"] = json_number(x["sort"])
    return out


def menu_list(sess: L.Session, payload: dict) -> dict[str, Any]:
    """userMenuLinksList: the company menu, everyone's to read; each link carries the badges it shows to."""
    refused = refusal(sess, "userMenuLinksList", payload)
    if refused:
        return refused
    if not sess.user:
        return dict(DG.DENIED)
    return {"status": 200, "data": {"links": menu_links(sess.reads)}}


def shelf(reads: L.Reads, user: dict[str, Any]) -> dict[str, Any]:
    """appShelfGet's data: the sections in their order, each app's section (the last row wins) and each section's
    apps in order — the apps Settings › My Work keeps to the master's own session cut from the placement."""
    sections = []
    for i, r in enumerate(tab_rows(reads, SECTIONS_TAB)):
        sid = s_(r.get("sectionid"))
        if not sid:
            continue
        sections.append({"id": sid, "label": s_(r.get("label")) or sid, "tint": s_(r.get("tint")) or "blue",
                         "icon": s_(r.get("icon")), "position": or_number(r.get("position"), i + 1)})
    sections.sort(key=lambda x: x["position"])
    for x in sections:
        x["position"] = json_number(x["position"])
    rows = tab_rows(reads, PLACEMENT_TAB)
    # an unreadable config is no answer here, never an uncut one
    cut = sc.my_work_apps_cut_for(user, reads.config())
    placement: dict[str, str] = {}
    ranked: dict[str, list[dict[str, Any]]] = {}
    for p, r in enumerate(rows):
        app_id, sec_id = s_(r.get("appid")), s_(r.get("sectionid"))
        if not app_id or not sec_id or app_id in cut:
            continue
        placement[app_id] = sec_id
        ranked.setdefault(sec_id, []).append({"id": app_id, "at": or_number(r.get("position"), p + 1)})
    order = {k: [x["id"] for x in sorted(v, key=lambda x: x["at"])] for k, v in ranked.items()}
    return {"sections": sections, "placement": placement, "order": order}


def shelf_get(sess: L.Session, payload: dict) -> dict[str, Any]:
    """appShelfGet: the sidebar's own shape, the two tabs asked separately."""
    refused = refusal(sess, "appShelfGet", payload)
    if refused:
        return refused
    if not sess.user:
        return dict(DG.DENIED)
    return {"status": 200, "data": shelf(sess.reads, sess.user)}


# ---- hubBoot ----------------------------------------------------------------------------------------------------

def hub_boot(sess: L.Session, payload: dict) -> dict[str, Any]:
    """hubBoot: the SPA's first word — the person's preferences, the access matrices, the places and the members
    roster, each part asked of its own door and left out when it does not answer 200."""
    refused = refusal(sess, "hubBoot", payload)
    if refused:
        return refused
    user = sess.user
    if not user or user.get("is_service"):
        return dict(DG.DENIED)
    out: dict[str, Any] = {}

    def part(name: str, fn: Callable[[], dict[str, Any]]) -> None:
        try:
            r = fn()
            if r and r.get("status") == 200:
                out[name] = r.get("data")
        except Exception as exc:  # noqa: BLE001 - one part's refusal is not the boot's failure
            log.info("hubBoot: its %s part left out (%s)", name, type(exc).__name__)

    part("prefs", lambda: {"status": 200, "data": prefs_of(sess.reads, user)})
    part("access", lambda: AC.badge_access_get(sess, {}))
    part("tenants", lambda: ST.tenants_list(sess, {}))
    part("members", lambda: MEM.members_list(sess, {}))
    return {"status": 200, "data": out}


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {
    "prefsGet": prefs_get, "appShelfGet": shelf_get, "userMenuLinksList": menu_list, "hubBoot": hub_boot}
# main.policy_gate asks nothing: each door asks its gates first, as doPost asks them
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
