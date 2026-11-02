"""Settings › IST's two doors (apps-script/IstConfig.gs) off asa-hub-db: the configuration read for Settings and the IST
screens (istConfigGet) and edited cells saved (istConfigSet, kept in app.edits). The declaration — every key, its
group, type, limits, shipped value and note — is server/ist_config_defaults.json, handed in by the relay; the checks
are mw_shifts' translation of the same rules."""
from __future__ import annotations

import logging
import re
from typing import Any, Callable

import candidates as CND
import gsjs
import house_tables as HT
import hubdb
import locations as L
import scope as sc
import staff_views
import writes as W
from scope import Defer
from writes import Decision

log = logging.getLogger("asa-hub-app")

TAB = "ist_config"
# IstConfig.gs IST_CONFIG_ERROR: a cell that reads as one of these holds no value at all
ERROR = re.compile(r"^#(ERROR!|REF!|NAME\?|VALUE!|DIV/0!|N/A|NULL!|NUM!)")
DENIED = {"status": 403, "message": "Requires an admin or manager account"}
BUSY = f"Another change to the {TAB} tab is in progress — try again."
# Prefs.gs CONFIG_BADGE_TAB: the settings badge matrix, one row per section
BADGE_TAB = "config_badge_access"


def _ist() -> Any:
    import mw_shifts as MW  # noqa: PLC0415 - the one reader of ist_config's rules on this side
    return MW.ist


def _declaration(payload: dict) -> dict[str, Any]:
    d = payload.get("declaration") if isinstance(payload, dict) else None
    if not isinstance(d, dict) or not isinstance(d.get("keys"), list):
        raise Defer("the relay handed no IST settings declaration")
    return d


def _falsy(v: Any) -> bool:
    return v is None or v is False or v == "" or (isinstance(v, (int, float)) and not isinstance(v, bool) and v == 0)


def _cell(raw: dict, header: str | None) -> str:
    return gsjs.js_str(hubdb.typed(raw.get(header), "raw")) if header else ""


def _lines(reads: L.Reads) -> tuple[hubdb.Resolved, list[tuple[str, str, str]]]:
    """The tab's rows in sheet order as (key, value, note) cells; raises when the copy cannot be read."""
    res = W.tab_of(reads, TAB)
    if res.ref is None:
        return res, []
    heads = {gsjs.trim(gsjs.or_blank(h)).lower(): h for h in res.ref.headers}
    hk, hv, hn = heads.get("key"), heads.get("value"), heads.get("note")
    out = [(gsjs.trim(_cell(raw, hk)), _cell(raw, hv), _cell(raw, hn)) for _rn, raw in reads.db.rows(res.ref)]
    return res, out


def leveled(lines: list[tuple[str, str, str]], keys: list[dict]) -> dict[str, str]:
    """istConfig_ over the tab as istConfigSheet_ leaves it: every declared key seeded with its shipped value, a
    declared key's #ERROR cell healed to it, one row per key (the first carrying a value, else the first)."""
    shipped = {d["key"]: str(d["value"]) for d in keys}
    first: dict[str, tuple[int, str]] = {}
    for i, (k, v, _n) in enumerate(lines):
        if not k:
            continue
        if k not in first or (not gsjs.trim(first[k][1]) and gsjs.trim(v)):
            first[k] = (i, v)
    cfg: dict[str, str] = {}
    for k, (_i, v) in sorted(first.items(), key=lambda kv: kv[1][0]):
        if ERROR.match(gsjs.trim(v)):
            v = shipped.get(k, "")
        cfg[k] = v
    for d in keys:
        if d["key"] not in cfg:
            cfg[d["key"]] = shipped[d["key"]]
    return cfg


def config(reads: L.Reads, keys: list[dict]) -> tuple[dict[str, str], str]:
    """istConfig_ and istConfigSource_: the tab's cells and 'sheet', else the last cells read, else the shipped
    floor."""
    try:
        _res, lines = _lines(reads)
        return leveled(lines, keys), "sheet"
    except (hubdb.Unreadable, Defer) as exc:
        why = str(exc)
    import mw_shifts as MW  # noqa: PLC0415 - the cells its reader last kept
    with MW._IST_LOCK:
        last = dict(MW._IST_HELD.get("raw") or {})
    log.warning("ist config: the %s tab could not be read (%s) — serving the %s copy", TAB, why,
                "last known" if last else "shipped")
    if last:
        return last, "last known"
    return {d["key"]: str(d["value"]) for d in keys}, "shipped"


def config_get(sess: L.Session, payload: dict) -> dict[str, Any]:
    """istConfigGet: the configuration for Settings → IST and the IST screens."""
    user = sess.user or {}
    if not user or user.get("is_service") or gsjs.str_(user.get("role")) not in ("admin", "manager"):
        return dict(DENIED)
    decl = _declaration(payload)
    keys = decl["keys"]
    tab = gsjs.str_(decl.get("tab")) or TAB
    cfg, source = config(sess.reads, keys)
    values, problems = _ist().resolve(cfg)
    rows = []
    for d in keys:
        k = d["key"]
        rows.append({"key": k, "value": values.get(k, ""), "raw": "" if k not in cfg else str(cfg[k]),
                     "default_value": str(d["value"]), "note": d.get("note"), "group": d.get("group") or "ist",
                     "type": d.get("type") or "text", "min": d.get("min"), "max": d.get("max"),
                     "allowed": None if _falsy(d.get("allowed")) else d["allowed"],
                     "keys": None if _falsy(d.get("keys")) else d["keys"],
                     "values": None if _falsy(d.get("values")) else d["values"],
                     "placeholders": None if _falsy(d.get("placeholders")) else d["placeholders"],
                     "value_pattern": None if _falsy(d.get("value_pattern")) else d["value_pattern"],
                     "problem": problems.get(k, "")})
    known = {d["key"] for d in keys}
    extra = [{"key": k, "value": str(v), "note": "This backend version does not read this key."}
             for k, v in cfg.items() if k not in known]
    return {"status": 200, "data": {
        "rows": rows, "groups": decl.get("groups") or [], "tints": decl.get("tints") or [], "unknown_rows": extra,
        "tab": tab, "source": source, "blind": source != "sheet",
        "blind_reason": "" if source == "sheet" else (
            f"The {tab} tab could not be read. Showing the {source} configuration. Nothing about who owes a training "
            "changed — a failed read is not a person without training.")}}


# ---- the save --------------------------------------------------------------------------------------------------------

def may_edit(reads: L.Reads, user: dict | None) -> bool:
    """istConfigMayEdit_: the master, or an admin wearing a badge the `ist` row of the settings badge matrix names (no
    row: any admin)."""
    u = user or {}
    if not u or u.get("is_service") or gsjs.str_(u.get("role")) != "admin":
        return False
    if sc.is_master_email(u.get("email")):
        return True
    rule: list[str] = []
    try:
        for r in CND.read_tab(reads, BADGE_TAB):
            if gsjs.str_(r.get("sectionid")) != "ist":
                continue
            rule = sc.types_from_raw(r.get("badges"))
            break
    except Exception:  # noqa: BLE001 - an unreadable matrix narrows nothing, as on screen
        rule = []
    if not rule:
        return True
    worn = sc.badges_worn(u.get("types"), u.get("role"))
    return any(b in worn for b in rule)


def save_problems(values: dict[str, Any], stored: dict[str, Any] | None, keys: list[dict]) -> list[str]:
    """istConfigSaveProblems_: every `key: why` a save of `values` over `stored` is refused for; a course-list change
    re-checks the keys it leaves alone."""
    ist = _ist()
    before = dict(stored or {})
    after = {**before, **values}
    cat_before, cat_after = ist.catalogue_of(before), ist.catalogue_of(after)
    out = [f"{k}: {why}" for k in values if (why := ist.check(k, values[k], cat_after))]
    if "ist_cert_labels" in values:
        for d in keys:
            k = d["key"]
            if k in values or not ist.uses_catalogue(k):
                continue
            cell = gsjs.trim("" if before.get(k) is None else str(before.get(k))) or str(d["value"])
            if ist.check(k, cell, cat_after) and not ist.check(k, cell, cat_before):
                out.append(f'{k}: "{cell}" would no longer name a course in the course list this save leaves — '
                           f"change {k} in the same save, or keep the course")
    return out


def people_problems(reads: L.Reads, values: dict[str, Any], keys: list[dict]) -> list[str]:
    """istConfigPeopleProblems_: a coverage label that is somebody's name."""
    guarded = [d for d in keys if d.get("people_guard") and d["key"] in values
               and gsjs.trim("" if values[d["key"]] is None else str(values[d["key"]]))]
    if not guarded:
        return []
    import staff as SP  # noqa: PLC0415 - People as the Staff app reads them
    names: list[str] | None = []
    try:
        for p in SP.without_isp_clients(reads, SP.people_merged(reads, SP._people(reads))):
            n = gsjs.trim(gsjs.or_blank(p.get("name")))
            if n:
                names.append(n)
    except Exception:  # noqa: BLE001 - the people list unread proves nothing
        names = None
    if not names:
        return [f"{d['key']}: the people list could not be read, so nothing proves no real person matches — nothing "
                "was written" for d in guarded]
    out = []
    for d in guarded:
        for entry in _ist().bits(values[d["key"]]):
            up = entry.upper()
            hit = [n for n in names if (up in n.upper() if d["people_guard"] == "contains" else n.upper() == up)]
            if hit:
                more = f" and {len(hit) - 3} more" if len(hit) > 3 else ""
                out.append(f'{d["key"]}: "{entry}" matches {", ".join(hit[:3])}{more} in the people list — a coverage '
                           "label may never be a real person")
    return out


def estate_problems(reads: L.Reads, values: dict[str, Any], stored: dict[str, Any]) -> list[str]:
    """istConfigEstateProblems_: a tab or a column the cells name that is not there in the estate's book."""
    touches = [k for k in ("ist_cert_source_tabs", "ist_cert_source_fields") if k in values]
    if not touches:
        return []
    ist = _ist()
    after = {**stored, **values}
    tabs_of = (ist.pairs_of(ist.resolve_one("ist_cert_source_tabs", after.get("ist_cert_source_tabs"), None)[0])
               or ([], {}))[1]
    shipped_tabs = (ist.pairs_of(ist.SHIPPED["ist_cert_source_tabs"]) or ([], {}))[1]
    fields_of = (ist.pairs_of(ist.resolve_one("ist_cert_source_fields", after.get("ist_cert_source_fields"), None)[0])
                 or ([], {}))[1]
    shipped_fields = (ist.pairs_of(ist.SHIPPED["ist_cert_source_fields"]) or ([], {}))[1]
    master_cols = (ist.pairs_of(ist.resolve_one("ist_cert_master_columns", after.get("ist_cert_master_columns"),
                                                ist.catalogue_of(after))[0]) or ([], {}))[0]
    sid = gsjs.trim(gsjs.or_blank(reads.db.prop("CERT_SOURCE_ID")))
    if not sid or reads.db.book(sid) is None:
        return [f"{t}: the estate's book could not be opened to confirm its tabs and columns — nothing was written"
                for t in touches]
    out: list[str] = []
    headers: dict[str, list[str]] = {}
    for which in ("trainings", "mais", "master"):
        tab = gsjs.trim(str(tabs_of.get(which) or shipped_tabs.get(which) or ""))
        ref = HT.book_tab(reads, sid, tab) if tab else None
        if ref is None:
            out.append(f'ist_cert_source_tabs: the estate\'s book has no tab named "{tab}" ({which})')
            continue
        headers[which] = [hubdb.estate_key(h) for h in ref.headers]

    def has(which: str, spec: str) -> bool:
        head = headers.get(which)
        if head is None:
            return True
        return any(all(c.strip() in head for c in alt.split("+")) for alt in spec.split("|"))

    for fact in ("master.name", "trainings.name", "trainings.course", "trainings.status", "trainings.expires",
                 "mais.name", "mais.status", "mais.expires", "mais.category"):
        spec = str(fields_of.get(fact) or shipped_fields.get(fact) or "")
        which = fact.split(".")[0]
        if not has(which, spec):
            out.append(f"ist_cert_source_fields: no column {' or '.join(spec.split('|'))} in the {which} tab ({fact})")
    if "master" in headers and not any(c in headers["master"] for c in master_cols):
        out.append("ist_cert_source_tabs: the master tab carries none of the course date columns in "
                   "ist_cert_master_columns — it is not the estate's Master")
    return out


def config_set(sess: L.Session, payload: dict) -> Decision:
    """istConfigSet: edited cells saved to the tab, every row carrying the key; a key it lacks appended."""
    p = payload if isinstance(payload, dict) else {}
    reads = sess.reads
    user = sess.user or {}
    if not may_edit(reads, user):
        return Decision(dict(DENIED))
    decl = _declaration(p)
    keys = decl["keys"]
    tab_name = gsjs.str_(decl.get("tab")) or TAB
    spec = {d["key"]: d for d in keys}
    raw_values = p.get("values")
    values: dict[str, Any] = raw_values if isinstance(raw_values, dict) else {}
    unknown = [k for k in values if k not in spec]
    if unknown:
        return W.refuse(400, f"This backend version does not know: {', '.join(unknown)} — it arrives with the next platform "
                             "release; save again then.")
    texts = {k: "" if v is None else gsjs.js_str(v) for k, v in values.items()}
    try:
        res, lines = _lines(reads)
    except (hubdb.Unreadable, Defer):
        res, lines = None, None
    # the cells as last read, then as the tab holds them once istConfigSheet_ has levelled it: the same cells here
    stored = leveled(lines, keys) if lines is not None else config(reads, keys)[0]
    refused = save_problems(texts, stored, keys)
    if refused:
        return W.refuse(400, "Not saved — " + " · ".join(refused))
    if res is None or lines is None:
        return W.refuse(503, f"The {tab_name} tab could not be read, so nothing was written — a save into a tab nobody "
                             "can read would be a change nobody can check.")
    refused = save_problems(texts, stored, keys) + people_problems(reads, texts, keys) + \
        estate_problems(reads, texts, stored)
    if refused:
        return W.refuse(400, "Not saved — " + " · ".join(refused))
    W.gate(reads)
    sid, tab = W.where_of(res)
    edits: list[dict] = []
    changed = 0
    for k, v in texts.items():
        held = [(cv, cn) for ck, cv, cn in lines if ck == k]
        if len(held) > 1:
            raise Defer(f"two {tab_name} rows carry {k}: each is written, and the copy cannot tell them apart")
        if held:
            edits.append(W.kept_record(sid, tab, "edit", "cols:key", k, tab_name, {"value": v},
                                       before={"value": held[0][0]}))
        else:
            edits.append(W.kept_record(sid, tab, "append", "cols:key", k, tab_name,
                                       {"key": k, "value": v, "note": spec[k].get("note") or ""}))
        changed += 1
    staff_views.record(user, "ist_config_set", f"{changed} key(s) updated")
    said = (f"{changed} key(s) saved to the {tab_name} tab. The platform reads the new value from now on — no release "
            "needed.")
    answer = {"status": 200, "data": {"saved": changed, "message": said}}
    d = W.final(answer, edits, tab_name)
    d.fresh = (res.sheet_id,) if res.sheet_id else True
    return d


READS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {"istConfigGet": config_get}
READ_POLICY: dict[str, dict[str, Any]] = {"istConfigGet": {"roles": ("admin", "manager")}}
ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {"istConfigSet": config_set}
POLICY: dict[str, dict[str, Any]] = {"istConfigSet": {"roles": ("admin",)}}
BUSY_OF: dict[str, dict[str, Any]] = {"istConfigSet": {"status": 503, "message": BUSY}}
