"""App Studio's places (Studio.gs tenantsList, with Tenant.gs's reach) and the Playground's draft (AppBuilder.gs
playgroundGenerate: a sentence becomes an app draft through screenAiChat_, nothing written), read off asa-hub-db. A
place added or changed is in app/studio_writes.py."""
from __future__ import annotations

import json
import re
import time
from typing import Any, Callable

import candidates as CND
import client_care_sweeps as CCS
import gsjs
import hubdb
import locations as L
import scope as sc
import staff_views

APP_ID = "studio"
# Studio.gs TENANT_HEADERS: the spreadsheet id is never echoed to the SPA
TENANT_HEADERS = ("tenant_id", "name", "type", "city", "state", "status", "staff_count", "client_count", "since",
                  "created_at", "created_by", "spreadsheet_id")
TENANTS_TAB = "tenants"
# Tenant.gs HUB_TENANT_SAFE_ACTIONS: of these doors, the ones that answer away from headquarters
TENANT_SAFE = ("tenantsList", "playgroundGenerate")
UNKNOWN = {"status": 404, "message": "Unknown action."}
DENIED = {"status": 403, "message": "Requires an admin or manager account"}
# AppBuilder.gs
APP_BUILDER_TYPES = ("sheet", "gallery", "board", "documents", "videos", "dashboard", "schedule", "timeline",
                     "checklist", "detail", "pipeline")
GEN_MAX_PROMPT = 2000
GEN_MAX_PAGES = 4
GEN_TINTS = ("mint", "peach", "lavender", "pink", "blue", "amber")
GEN_ICONS = ("rocket", "layout-grid", "table", "list-checks", "calendar", "image", "video", "book-open", "columns-3",
             "square-kanban", "id-card", "megaphone", "package", "users", "clipboard-list", "clipboard-check", "truck",
             "wrench", "heart-pulse", "graduation-cap", "wallet", "map-pin", "bell", "star")
GEN_REQUEST = "ai_playground_page"
GEN_TEMPERATURE = 0.3
# the model's whole turn inside the relay's long read (BACKEND_LONG_READS)
GEN_DEADLINE_S = 100.0
_PAGE_ID = re.compile(r"[a-z][a-z0-9-]{0,40}")

s_ = gsjs.str_


# ---- the places (Tenant.gs) ---------------------------------------------------------------------------------------

def int0(v: Any) -> int:
    """parseInt(v, 10) || 0."""
    n = CND.js_parse_int(v)
    return 0 if n != n else int(n)


def tenant_ids_for_user(home: Any, extra: Any) -> list[str]:
    """tenantIdsForUser_: the home place, then each listed one once."""
    out: list[str] = []
    h = s_(home)
    if h:
        out.append(h)
    for t in s_(extra).split(",") if s_(extra) else ():
        t = gsjs.trim(t)
        if t and t not in out:
            out.append(t)
    return out


def user_tenants(reads: L.Reads, user: dict) -> list[str]:
    """userPublic_'s tenants: the account row's home place and listed places."""
    uid = s_(user.get("id"))
    row = next((u for u in reads.users() if uid and s_(u.get("userid")) == uid), {})
    return tenant_ids_for_user(row.get("hometenant"), row.get("tenants"))


def tenants_rows(reads: L.Reads) -> list[dict]:
    """tenantsRows_: the platform's tenants, in their own table (house_tables.where); FAIL-CLOSED, none when
    unreadable."""
    def read() -> list[dict]:
        try:
            import house_tables as HT  # noqa: PLC0415 - writes imports this module, and house_tables imports writes

            return reads.db.normalized_rows(HT.where(reads, TENANTS_TAB).ref)
        except hubdb.Unreadable:
            return []
    return reads.once("studio:tenants_rows", read)


def tenant_home_from(rows: list[dict]) -> str:
    """tenantHomeFrom_: the row typed hq and not archived, else the first row's."""
    for r in rows:
        if s_(r.get("type")) == "hq" and s_(r.get("status")) != "archived":
            return s_(r.get("tenantid"))
    return s_(rows[0].get("tenantid")) if rows else ""


def tenant_id(reads: L.Reads, user: dict | None) -> str:
    """hubTenantId_ for a session the relay hands here (never a tenant on the envelope): tenantContext_ derives the
    place from the account's home_tenant; '' at headquarters."""
    u = user or {}
    mine = s_(u.get("home_tenant"))
    if u.get("is_service") or not mine or sc.is_master_email(u.get("email")):
        return ""
    # the home place is always among the account's own, so tenantResolve_ never refuses it
    home = tenant_home_from(tenants_rows(reads))
    return "" if home and mine == home else mine


def away_refused(reads: L.Reads, user: dict | None, action: str) -> dict[str, Any] | None:
    """doPost's place law: away from headquarters an action runs only if Tenant.gs declares it safe there."""
    if tenant_id(reads, user) and action not in TENANT_SAFE:
        return dict(UNKNOWN)
    return None


def tenant_reach_ids(reads: L.Reads, user: dict | None) -> list[str] | None:
    """tenantReachIds_: None (everywhere) for the master and an admin; else headquarters and the caller's places."""
    u = user or {}
    if sc.is_master_email(u.get("email")) or s_(u.get("role")) == "admin":
        return None
    out: list[str] = []
    home = tenant_home_from(tenants_rows(reads))
    if home:
        out.append(home)
    for t in tenant_ids_for_user(u.get("home_tenant"), ",".join(user_tenants(reads, u))):
        if t not in out:
            out.append(t)
    return out


def tenants_tab(reads: L.Reads) -> hubdb.Resolved:
    """ensureTab_('tenants'): the router's tab, its own table once kept there; a book the copy does not hold is
    unreadable."""
    import house_tables as HT  # noqa: PLC0415 - writes imports this module, and house_tables imports writes

    res = HT.where(reads, TENANTS_TAB)
    if res.runtime:
        raise hubdb.Unreadable("the tenants tab lives in the depot's facts")
    if res.ref is None and not res.book_known:
        raise hubdb.Unreadable("asa-hub-db holds no copy of the book behind the tenants tab")
    return res


def tenants(reads: L.Reads) -> list[dict]:
    """readTabNormalized_ of the tenants tab, Python's own kept edits laid."""
    return [dict(r) for r in reads.once("studio:tenants", lambda: reads.db.normalized_rows(tenants_tab(reads).ref))]


def tenants_list(sess: L.Session, payload: dict) -> dict[str, Any]:
    """tenantsList: every place not archived the caller may enter (the hq row always stays: a shell with no chip
    cannot be signed into); the spreadsheet id never leaves."""
    reach_list = tenant_reach_ids(sess.reads, sess.user)
    reach = None if reach_list is None else set(reach_list)
    out = []
    for t in tenants(sess.reads):
        if s_(t.get("status")).lower() == "archived":
            continue
        if reach is not None and s_(t.get("tenantid")) not in reach and s_(t.get("type")) != "hq":
            continue
        out.append({"id": s_(t.get("tenantid")), "name": s_(t.get("name")), "type": s_(t.get("type")) or "branch",
                    "city": s_(t.get("city")), "state": s_(t.get("state")), "status": s_(t.get("status")) or "active",
                    "staffCount": int0(s_(t.get("staffcount"))), "clientCount": int0(s_(t.get("clientcount"))),
                    "since": s_(t.get("since"))})
    return {"status": 200, "data": out}


# ---- the Playground's draft (AppBuilder.gs) ---------------------------------------------------------------------

def _js_len(s: str) -> int:
    """String.prototype.length: UTF-16 code units."""
    return len(s.encode("utf-16-le")) // 2


def gen_prompt(brief: str) -> str:
    """playgroundGenPrompt_: JSON only, and only page types and configs the engine mounts."""
    return "\n".join([
        "You design one small internal app for the ASA Hub platform. Answer with ONE JSON object and nothing else — "
        "no prose, no code fence.",
        "",
        "Schema of your answer:",
        '{ "name": string, "tagline": string, "icon": string, "accent": string, "category": string,',
        '  "pages": [ { "id": kebab-case, "type": string, "title": string,',
        '               "config": object, "rows": [object] } ] }',
        "",
        "Rules:",
        '- "icon" is one of: ' + ", ".join(GEN_ICONS) + ".",
        '- "accent" is one of: ' + ", ".join(GEN_TINTS) + ".",
        '- "category" is a short workspace noun (e.g. "Operations", "Workspace", "Intelligence").',
        '- "type" is one of: ' + ", ".join(APP_BUILDER_TYPES) + ". Pick the template that fits the job; 1 to "
        + str(GEN_MAX_PAGES) + " pages.",
        '- Every row has a unique string "id" ("row-1", "row-2", …). 5 to 8 believable sample rows per page.',
        "- Config vocabularies by type:",
        '  sheet: { "entity": ["record","records"], "searchable": true, "selectable": true, "columns": [ { "key", '
        '"label", "kind" } ] } — kinds: text, avatar+text (add "subKey"), chip (add "tintBy" {value: tint}), chips, '
        "date, number, progress, image.",
        '  pipeline / board: { "stageField": "stage", "stages": [ { "id", "label", "tint", "description"? } ], '
        '"cardFields": { "title": rowKey, "subtitle": rowKey, "tags": { "key": rowKey, "tintBy": {} }, "meta": '
        '[rowKey] } }. Rows carry the stage id under stageField (board rows use "column").',
        '  dashboard: { "greeting": { "name", "subtitle" }, "widgets": [ … ] } — widget kinds: stat '
        "{label,value,delta?,tint?}, ring {percent,caption?}, donut {slices:[{label,value,tint?}],centerLabel?}, bars "
        "{bars:[{label,value,tint?}]}, note {text,tint?}, list {items:[…]}.",
        '  detail: { "header": { "title": rowKey, "subtitle": rowKey, "avatar": rowKey, "statusChip": { "field": '
        'rowKey, "tintBy": {} } }, "stats": [ { "label", "value": rowKey, "icon", "tint" } ], "sections": [ { "kind": '
        '"fields", "title", "fields": [ { "label", "value": rowKey } ] } ] }.',
        '  gallery: { "srcKey": "src", "titleKey": "title", "subtitleKey"?, "groupBy"?, "aspect": "photo" }. Rows '
        "carry image paths under srcKey.",
        '  checklist: { "groupKey": "section", "labelKey": "item", "noteKey": "note", "requiredKey": "required" }.',
        '  timeline: { "timeKey": "at", "titleKey": "title", "bodyKey": "detail", "actorKey": "actor", "kindKey": '
        '"kind", "kindTints": {} }.',
        '  documents: { "collections": [ { "id", "label", "icon", "tint" } ] }. Rows: { id, title, excerpt, '
        'collection, updatedAt, readMinutes, body: [ { "kind": "h2"|"p", "text" } ] }.',
        '  videos: { "channels": [ { "id", "label", "tint" } ] }. Rows: { id, title, channel, thumb, durationSec, '
        "views, watched, publishedAt, description }.",
        '  schedule: { "view": "week", "resources": [ { "id", "name", "role"? } ], "eventTypes": { "key": { "label", '
        '"tint" } }, "timeRange": [8, 19], "slotMinutes": 30 }. Rows: { id, personId, date "YYYY-MM-DD", start '
        '"HH:MM", durationMin, type }.',
        '- Column keys and row keys must match exactly. Dates are ISO "YYYY-MM-DD".',
        "- A page may declare BUTTONS in its config — this is what makes the app a tool:",
        '  "rowActions": [ { "id", "label", "icon", "kind", ... } ] on sheet pages, shown in each row\'s menu.',
        "  kinds you may use:",
        '    patch — update this row: { "kind": "patch", "patch": { "status": "Done" } } — values may interpolate '
        '"{row.key}".',
        '    link — open a URL: { "kind": "link", "href": "https://…/{row.id}" }.',
        '  optional on any action: "when": { "field", "eq" } (only show when the row matches), "confirm": "Are you '
        'sure?" , "toast": "Done — {row.name}", "quick": true (a visible button instead of the menu), "danger": true.',
        "  Give every app 1–3 genuinely useful row actions (e.g. mark done, approve, archive). Do NOT invent \"call\" "
        "actions — only patch and link.",
        "",
        "The app the user wants:",
        brief,
    ])


def _no_constant(name: str) -> Any:
    raise ValueError(name)


def _parse(content: str) -> tuple[bool, Any]:
    """JSON.parse: (parsed, value); NaN and Infinity are not JSON."""
    try:
        return True, json.loads(content, parse_constant=_no_constant)
    except (ValueError, RecursionError):
        return False, None


def gen_page(raw: Any, index: int, warnings: list[str]) -> dict[str, Any] | None:
    """playgroundGenPage_: a generated page is a suggestion, coerced into one the engine mounts or dropped, every
    change said."""
    n = str(index + 1)
    if not isinstance(raw, (dict, list)):
        warnings.append("page " + n + " was not an object — dropped")
        return None
    g = raw if isinstance(raw, dict) else {}
    kind = gsjs.trim(gsjs.or_text(g.get("type")))
    if kind not in APP_BUILDER_TYPES:
        warnings.append("page " + n + ': type "' + kind + '" is not mountable — replaced with sheet')
        kind = "sheet"
    cfg = g.get("config")
    config = cfg if isinstance(cfg, dict) else {}
    if not isinstance(cfg, (dict, list)):
        warnings.append("page " + n + " had no config object — using defaults")
    rows: list[dict] = []
    got = g.get("rows")
    if isinstance(got, list):
        if len(got) > 25:
            warnings.append("page " + n + ": the model drew " + str(len(got)) + " rows; kept 25")
        for r in got:
            if len(rows) >= 25:
                break
            if not isinstance(r, dict):
                continue
            if not isinstance(r.get("id"), str) or not r.get("id"):
                r["id"] = "row-" + str(len(rows) + 1)
            rows.append(r)
    if not rows:
        warnings.append("page " + n + " came with no usable rows")
    pid = gsjs.or_text(g.get("id"))
    return {"id": pid if _PAGE_ID.fullmatch(pid) else ("main" if index == 0 else "page-" + n), "type": kind,
            "title": gsjs.trim(gsjs.or_text(g.get("title"))) or "Page " + n, "config": config, "rows": rows}


def playground_generate(sess: L.Session, payload: dict) -> dict[str, Any]:
    """playgroundGenerate: one sentence drafted into an app by the model — admin only, nothing written; the publish
    that follows is appBuilderUpsert's."""
    user = sess.user or {}
    p = payload if isinstance(payload, dict) else {}
    if p.get("prompt") is None or p.get("prompt") == "":
        return {"status": 400, "message": "Missing required parameter: prompt."}
    if s_(user.get("role")) != "admin":
        return dict(DENIED)
    brief = gsjs.trim(gsjs.or_text(p.get("prompt")))
    if not brief:
        return {"status": 400, "message": "Describe the app first — one sentence is enough."}
    if _js_len(brief) > GEN_MAX_PROMPT:
        return {"status": 400, "message": f"Keep the description under {GEN_MAX_PROMPT} characters."}
    res = CCS.ai_chat(sess.reads, gen_prompt(brief), GEN_TEMPERATURE, GEN_REQUEST, time.monotonic() + GEN_DEADLINE_S)
    if not res.get("ok"):
        why = s_(res.get("error")) or ("late" if res.get("late") else "")
        return {"status": 502, "message": "No model answered (" + why + "). Try again in a moment."}
    via = s_(res.get("via"))
    parsed, draft = _parse(gsjs.or_blank(res.get("content")))
    if not parsed:
        staff_views.record(user, "playground_generate_unparseable", via, 502)
        return {"status": 502, "message": "The model answered, but not in JSON — rephrase slightly and try again."}
    if not isinstance(draft, dict):
        return {"status": 502, "message": "The model answered, but not with an app — rephrase slightly and try again."}
    warnings: list[str] = []
    pages: list[dict] = []
    raw_pages = draft.get("pages") if isinstance(draft.get("pages"), list) else []
    if not raw_pages and (not gsjs.falsy(draft.get("type")) or not gsjs.falsy(draft.get("config"))):
        raw_pages = [draft]
    if len(raw_pages) > GEN_MAX_PAGES:
        warnings.append("the model drew " + str(len(raw_pages)) + " pages; kept the first " + str(GEN_MAX_PAGES))
    for i, raw in enumerate(raw_pages):
        if len(pages) >= GEN_MAX_PAGES:
            break
        page = gen_page(raw, i, warnings)
        if page:
            pages.append(page)
    if not pages:
        return {"status": 502, "message": "The model produced no mountable page — rephrase slightly and try again."}
    icon = gsjs.trim(gsjs.or_text(draft.get("icon")))
    if icon not in GEN_ICONS:
        icon = "rocket"
    accent = gsjs.trim(gsjs.or_text(draft.get("accent")))
    if accent not in GEN_TINTS:
        accent = "lavender"
    staff_views.record(user, "playgroundGenerate", via)
    return {"status": 200, "data": {
        "via": via, "warnings": warnings,
        "draft": {"name": gsjs.trim(gsjs.or_text(draft.get("name"))) or "Untitled app",
                  "tagline": gsjs.trim(gsjs.or_text(draft.get("tagline"))), "icon": icon, "accent": accent,
                  "category": gsjs.trim(gsjs.or_text(draft.get("category"))) or "Workspace", "pages": pages}}}


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {"tenantsList": tenants_list,
                                                                   "playgroundGenerate": playground_generate}
POLICY: dict[str, dict[str, Any]] = {"tenantsList": {},
                                     "playgroundGenerate": {"roles": ("admin",), "params": {"prompt": "string"}}}
