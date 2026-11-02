"""My World's writes (World.gs, WorldDefaults.gs, worldRoute_'s generic verbs) decided and kept in Postgres
(app/world_store.py): a world's registry row, and every change inside it — a tab made, a header widened, rows deleted,
an app's rows replaced, a record created, changed or deleted — laid in Apps Script's order and kept in the write's own
transaction, final there."""
from __future__ import annotations

import secrets
from typing import Any, Callable

import app_builder as AB
import app_builder_writes as ABW
import candidate_papers as CP
import gsjs
import locations as L
import staff_views
import studio as ST
import world as WL
import world_defaults as WD
import world_import as WI
import world_ops as WO
import world_store as WS
import writes as W
from client_rename import js_json
from writes import Decision

BUSY_OF: dict[str, dict[str, Any]] = {
    "worldEnsure": {"status": 409, "message": "Another request is creating your world right now — try again in a "
                                              "few seconds."},
    "worldAppUpsert": {"status": 409, "message": "Another publish is writing your world right now — try again in a "
                                                 "few seconds."},
    "worldAppsSeedDefaults": {"status": 409, "message": "Your world is being furnished right now — try again in a "
                                                        "few seconds."},
    "worldAppInstallDefault": {"status": 409, "message": "Your world is being written right now — try again in a "
                                                         "few seconds."},
    **{d: {"status": 409, "message": W.BUSY} for d in ("worldAppDelete", "worldRowCreate", "worldRowUpdate",
                                                       "worldRowDelete", WI.ACTION)}}

s_ = gsjs.str_


class Plan:
    """The changes one door decides in a world, laid in Apps Script's order on the door's own view of each tab, so a
    later change sees what an earlier one made; kept together at the end."""

    def __init__(self, reads: L.Reads, wid: str) -> None:
        self.reads, self.wid = reads, wid
        self.first: dict[str, WS.State] = {}
        self.states: dict[str, WS.State] = {}

    def view(self, tab: str) -> AB.View:
        if tab not in self.states:
            self.first[tab] = self.states[tab] = WS.state(self.reads, self.wid, tab)
        return self.states[tab].view

    def add(self, tab: str, spec: dict[str, Any]) -> AB.View:
        self.view(tab)
        self.states[tab] = WS.lay(self.states[tab], spec)
        return self.states[tab].view

    def keep(self, author: str) -> bool:
        """Every tab kept as the plan left it; whether anything moved."""
        return WS.save(self.wid, self.first, self.states, author)


def who(user: dict) -> str:
    return s_(user.get("email")) or s_(user.get("id"))


def _kept(answer: dict[str, Any], wrote: bool, subject: str) -> Decision:
    """Final in Postgres when anything was kept; else the answer as it stands."""
    return Decision(answer, own=True, subject=subject) if wrote else Decision(answer)


def stamp(row: dict, author: str) -> bool:
    """The registry row's defaults_version set to this version (worldSeedDefaultsMaybe_)."""
    wid, was = s_(row.get("world_id")), s_(row.get("defaults_version"))
    if not wid or was == WD.VERSION:
        return False
    return WS.world_set(wid, {"defaults_version": WD.VERSION}, author)


# ---- the defaults (WorldDefaults.gs) ------------------------------------------------------------------------------

def tab_keys(dsl: Any) -> list[str]:
    """worldEnsureDataTab_'s header: id, then each column's key."""
    return ["id"] + [c["key"] for c in AB.columns_of(dsl) if c["key"] != "id"]


def default_tab(plan: Plan, resource: str, dsl: str, rows: list[dict] | None) -> None:
    """worldDefaultTab_: the tab made, or its header widened; its rows seeded only when it was made."""
    keys = tab_keys(dsl)
    born = not plan.view(resource).exists
    seed = [{k: WO.value(rec.get(k)) for k in keys} for rec in rows] if born and rows else None
    plan.add(resource, WO.make(keys, True, seed))


def seed_one(plan: Plan, app: dict[str, Any], now: str) -> list[dict]:
    """worldSeedOneApp_: the app's world_apps rows (appended by the caller), its tabs made."""
    main = app["main"]
    pages = [{"id": "main", "title": app["name"], "resource": main["resource"], "options": {"entity": main["entity"]}},
             {"id": "data", "title": "All entries", "resource": main["resource"],
              "options": WD.page_options(app, main)}]
    pages += [{"id": ep["page_id"], "title": ep["title"], "resource": ep["resource"],
               "options": WD.page_options(app, ep)} for ep in app.get("extraPages") or []]
    rows = [dict(zip(WL.APP_BUILDER_COLUMNS, (
        app["id"], app["name"], app["tagline"], app["icon"], app["accent"], "Personal", "", pg["id"], pg["title"],
        "sheet", pg["resource"], pg.get("dsl") or main["dsl"], js_json(pg["options"]), "TRUE", WD.NOTE, now,
        WD.AUTHOR, ""))) for pg in pages]
    default_tab(plan, main["resource"], main["dsl"], None)
    for ep in app.get("extraPages") or []:
        default_tab(plan, ep["resource"], ep["dsl"], None)
    for et in app.get("extraTabs") or []:
        default_tab(plan, et["resource"], et["dsl"], et.get("rows"))
    default_tab(plan, WD.SETTINGS_TAB, WD.SETTINGS_DSL, None)
    return rows


def seed_defaults(plan: Plan, user: dict, row: dict, now: str) -> dict[str, list[str]]:
    """worldSeedDefaults_: a default neither present nor marked is seeded; one marked and gone stays gone; ours is
    written again; the owner's is left alone. Then the leftovers of older seeds cleared, the rows appended, the marks
    kept."""
    owned = WL.owned_ids(plan.view(WL.APPS_TAB))
    already = WL.marked(plan.view(WD.MARKER_TAB))
    plan.add(WL.APPS_TAB, WO.make(WL.APP_BUILDER_COLUMNS, True))
    seeded: list[str] = []
    upgraded: list[str] = []
    skipped: list[str] = []
    rows_of: list[tuple[str, list[dict]]] = []
    for app in WD.WORLD_DEFAULT_APPS:
        author = owned.get(app["id"])
        if author is not None and author != WD.AUTHOR:
            skipped.append(app["id"])
            continue
        if author is None and app["id"] in already:
            skipped.append(app["id"])
            continue
        rows_of.append((app["id"], seed_one(plan, app, now)))
        (upgraded if author == WD.AUTHOR else seeded).append(app["id"])
    for tab in WO.JUNK:
        # a tab that holds no row has nothing to clear
        if plan.view(tab).exists and plan.view(tab).rows:
            plan.add(tab, WO.purge(tab))
    for aid, rows in rows_of:
        plan.add(WL.APPS_TAB, WO.swap(WL.APP_BUILDER_COLUMNS, aid, rows))
    plan.add(WD.MARKER_TAB, WO.marks(WD.MARKER_HEADER, [{"app_id": aid, "seeded_at": now} for aid in seeded]))
    if rows_of:
        staff_views.record(user, "worldSeedDefaults", s_(row.get("world_id")))
    return {"seeded": seeded, "upgraded": upgraded, "skipped": skipped}


def seed_maybe(sess: L.Session, user: dict, row: dict, answer: dict[str, Any]) -> Decision:
    """worldSeedDefaultsMaybe_: the defaults seeded when the version moved, then the stamp; never a refusal."""
    if s_(row.get("defaults_version")) == WD.VERSION:
        return Decision(answer)
    reads, wid = sess.reads, s_(row.get("world_id"))
    plan = Plan(reads, wid)
    seed_defaults(plan, user, row, W.now_iso(reads))
    wrote = plan.keep(who(user))
    return _kept(answer, stamp(row, who(user)) or wrote, wid)


# ---- the doors ----------------------------------------------------------------------------------------------------

def ensure(sess: L.Session, payload: dict) -> Decision:
    """worldEnsure: the caller's world made when there is none yet — its row on the registry and its defaults seeded,
    in this write — else the one there, furnished when the defaults moved."""
    refused, ctx, _p = WL.enter(sess, "worldEnsure", payload)
    if refused:
        return Decision(refused)
    reads, user = sess.reads, ctx.actor("worldEnsure")
    if not WL.offered(reads, ctx, user):
        return Decision(dict(WL.DENIED))
    row = WL.row_for(reads, user)
    if row:
        return seed_maybe(sess, user, row, {"status": 200, "data": {"world": WL.public(row), "created": False}})
    now = W.now_iso(reads)
    wid = "wld_" + secrets.token_hex(6)
    rec = {"world_id": wid, "owner_user_id": s_(user.get("id")), "owner_email": s_(user.get("email")),
           "name": WL.world_name(user), "created_at": now, "defaults_version": WD.VERSION}
    WS.world_make(rec, who(user))
    staff_views.record(user, "worldEnsure", wid)
    plan = Plan(reads, wid)
    seed_defaults(plan, user, rec, now)
    plan.keep(who(user))
    return Decision({"status": 200, "data": {"world": WL.public(rec), "created": True}}, own=True, subject=wid)


def app_upsert(sess: L.Session, payload: dict) -> Decision:
    """worldAppUpsert: appBuilderUpsert in the caller's own world — the app's rows swapped in one change, its data tabs
    made inside the world, seeded only on birth, never cleared."""
    refused, ctx, p = WL.enter(sess, "worldAppUpsert", payload)
    if refused:
        return Decision(refused)
    reads, user = sess.reads, ctx.actor("worldAppUpsert")
    if not WL.offered(reads, ctx, user):
        return Decision(dict(WL.DENIED))
    app = p.get("app")
    if not isinstance(app, dict):
        return W.refuse(400, "app is required — the object the studio publishes.")
    aid = gsjs.trim(gsjs.or_text(app.get("id")))
    if not AB.ID_RE.fullmatch(aid):
        return W.refuse(400, f'app.id "{aid}" is not a usable app id (kebab-case, e.g. my-tracker).')
    name = gsjs.trim(gsjs.or_text(app.get("name")))
    if not name:
        return W.refuse(400, "app.name is required — the listing starts there.")
    pages = app.get("pages")
    if not isinstance(pages, list) or not pages:
        return W.refuse(400, "app.pages must hold at least one page.")
    if len(pages) > AB.MAX_PAGES:
        return W.refuse(400, f"app.pages holds {len(pages)} pages; the most an app may have is {AB.MAX_PAGES}.")
    for i, pg in enumerate(pages):
        bad = ABW._bad_page(pg, i)
        if bad:
            return W.refuse(400, bad)
        res_name = gsjs.trim(gsjs.js_str(ABW._get(pg, "resource")))
        if res_name in (WL.APPS_TAB, WL.REGISTRY_TAB):
            return W.refuse(400, f'page resource "{res_name}" is reserved.')
    warnings: list[str] = []
    prepared = []
    for i, pg in enumerate(pages):
        label = gsjs.or_text(ABW._get(pg, "id")) or str(i + 1)
        options = (pg["options"] if not gsjs.falsy(pg["options"]) else {}) if isinstance(pg, dict) and \
            "options" in pg else None
        if isinstance(options, str):
            parsed, options = ST._parse(options)
            if not parsed:
                return W.refuse(400, f"page {label}: options is a string that is not JSON.")
        if isinstance(options, (dict, list)):
            ABW._sanitize(options, warnings, label)
        text = js_json(options) if options is not None else gsjs.or_text(ABW._get(pg, "optionsText"))
        if ST._js_len(text) > AB.MAX_OPTIONS_CHARS:
            return W.refuse(400, f'page "{label}": options is {ST._js_len(text)} characters; the most a cell holds'
                                 f" safely here is {AB.MAX_OPTIONS_CHARS}.")
        cols = ABW._get(pg, "columns")
        prepared.append({"page": pg, "resource": gsjs.trim(gsjs.js_str(ABW._get(pg, "resource"))), "options": text,
                         "columns": ABW._columns_dsl(cols) if isinstance(cols, list) else gsjs.or_text(cols)})
    audience: list[str] = []
    for a in app.get("audience") if isinstance(app.get("audience"), list) else ():
        a = gsjs.trim(gsjs.or_blank(a) if a is not None else "null")
        if a in AB.AUDIENCE and a not in audience:
            audience.append(a)
    mine = WL.row_for(reads, user)
    if not mine:
        return W.refuse(404, WL.NO_WORLD)
    wid = s_(mine.get("world_id"))
    plan = Plan(reads, wid)
    now = W.now_iso(reads)
    by = "world:" + s_(user.get("email"))
    enabled = "FALSE" if app.get("enabled") is False or app.get("enabled") == "FALSE" else "TRUE"
    rows: list[dict] = []
    tabs: list[dict] = []
    for i, prep in enumerate(prepared):
        pg, res = prep["page"], prep["resource"]
        rows.append(dict(zip(WL.APP_BUILDER_COLUMNS, (
            aid, name, gsjs.or_text(app.get("tagline")), gsjs.or_text(app.get("icon")) or "layout-grid",
            gsjs.or_text(app.get("accent")) or "blue", gsjs.or_text(app.get("category")) or "Workspace",
            ",".join(audience), gsjs.or_text(ABW._get(pg, "id")) or ("main" if i == 0 else f"page-{i + 1}"),
            gsjs.or_text(ABW._get(pg, "title")) or name, gsjs.or_text(ABW._get(pg, "type")) or "sheet", res,
            prep["columns"], prep["options"], enabled, gsjs.or_text(ABW._get(pg, "notes")), now, by, ""))))
        keys = tab_keys(prep["columns"])
        born = not plan.view(res).exists
        seed: list[dict] = []
        given = ABW._get(pg, "rows")
        if born and isinstance(given, list):
            for rec in given[:AB.MAX_SEED_ROWS]:
                if not isinstance(rec, dict):
                    continue
                if not isinstance(rec.get("id"), str) or not rec.get("id"):
                    rec["id"] = "row-" + str(len(seed) + 1)
                seed.append({k: WO.value(rec.get(k)) for k in keys})
        plan.add(res, WO.make(keys, True, seed or None))
        tabs.append({"resource": res, "state": "created" if born else "exists", "seeded": len(seed)})
    plan.add(WL.APPS_TAB, WO.swap(WL.APP_BUILDER_COLUMNS, aid, rows))
    plan.keep(who(user))
    return Decision({"status": 200, "data": {"id": aid, "pages": len(rows), "tabs": tabs, "warnings": warnings}},
                    own=True, subject=wid)


def app_delete(sess: L.Session, payload: dict) -> Decision:
    """worldAppDelete: the app's rows taken off world_apps; its data tabs left alone (unregistering is reversible,
    emptying a tab is not)."""
    refused, ctx, p = WL.enter(sess, "worldAppDelete", payload)
    if refused:
        return Decision(refused)
    reads, user = sess.reads, ctx.actor("worldAppDelete")
    if not WL.offered(reads, ctx, user):
        return Decision(dict(WL.DENIED))
    aid = s_(p.get("app_id"))
    if not aid:
        return W.refuse(400, "app_id is required.")
    mine = WL.row_for(reads, user)
    if not mine:
        return W.refuse(404, WL.NO_WORLD)
    wid = s_(mine.get("world_id"))
    plan = Plan(reads, wid)
    v = plan.view(WL.APPS_TAB)
    if not v.exists:
        return Decision({"status": 200, "data": {"id": aid, "removed": 0}})
    gone = len(v.rows) - len(plan.add(WL.APPS_TAB, WO.drop("app_id", aid)).rows)
    plan.keep(who(user))
    return Decision({"status": 200, "data": {"id": aid, "removed": gone}}, own=True, subject=wid)


def seed_door(sess: L.Session, payload: dict) -> Decision:
    """worldAppsSeedDefaults: the caller's world checked for missing defaults on demand, then the stamp."""
    refused, ctx, _p = WL.enter(sess, "worldAppsSeedDefaults", payload)
    if refused:
        return Decision(refused)
    reads, user = sess.reads, ctx.actor("worldAppsSeedDefaults")
    if not WL.offered(reads, ctx, user):
        return Decision(dict(WL.DENIED))
    row = WL.row_for(reads, user)
    if not row:
        return W.refuse(404, WL.NO_WORLD)
    wid = s_(row.get("world_id"))
    plan = Plan(reads, wid)
    got = seed_defaults(plan, user, row, W.now_iso(reads))
    wrote = plan.keep(who(user))
    return _kept({"status": 200, "data": got}, stamp(row, who(user)) or wrote, wid)


def install_default(sess: L.Session, payload: dict) -> Decision:
    """worldAppInstallDefault: one default installed by hand, past the marker (only the automatic seed may not bring
    back what the owner deleted)."""
    refused, ctx, p = WL.enter(sess, "worldAppInstallDefault", payload)
    if refused:
        return Decision(refused)
    reads, user = sess.reads, ctx.actor("worldAppInstallDefault")
    if not WL.offered(reads, ctx, user):
        return Decision(dict(WL.DENIED))
    aid = s_(p.get("app_id"))
    app = WD.find(aid)
    if app is None:
        return W.refuse(404, f'No default app "{aid}".')
    row = WL.row_for(reads, user)
    if not row:
        return W.refuse(404, WL.NO_WORLD)
    wid = s_(row.get("world_id"))
    plan = Plan(reads, wid)
    if aid in WL.owned_ids(plan.view(WL.APPS_TAB)):
        plan.add(WL.APPS_TAB, WO.make(WL.APP_BUILDER_COLUMNS, True))
        plan.keep(who(user))
        return Decision({"status": 200, "data": {"id": aid, "installed": True, "already": True}}, own=True,
                        subject=wid)
    now = W.now_iso(reads)
    rows = seed_one(plan, app, now)
    plan.add(WL.APPS_TAB, WO.swap(WL.APP_BUILDER_COLUMNS, aid, rows))
    fresh = aid not in WL.marked(plan.view(WD.MARKER_TAB))
    plan.add(WD.MARKER_TAB, WO.marks(WD.MARKER_HEADER, [{"app_id": aid, "seeded_at": now}] if fresh else []))
    staff_views.record(user, "worldAppInstallDefault", aid)
    plan.keep(who(user))
    return Decision({"status": 200, "data": {"id": aid, "installed": True, "pages": len(rows)}}, own=True,
                    subject=wid)


# ---- the generic verbs inside a world (worldRoute_ create, update, delete; SheetDb.gs) ----------------------------

def _book_gate(reads: L.Reads) -> dict[str, Any] | None:
    """sheetDbGateHolds_: the book-write funnel's own 409 while it holds."""
    why = CP.gate_holds(reads, CP.BOOK_GATE)
    return {"status": 409, "message": why} if why else None


def _route(sess: L.Session, verb: str, payload: dict) -> tuple[Decision | None, WL.Ctx, dict, str, Plan | None]:
    refused, ctx, p = WL.enter(sess, WL.DOORS[verb], payload)
    if refused:
        return Decision(refused), ctx, p, "", None
    head, tab = WL.route_head(ctx, verb)
    if head:
        return Decision(head), ctx, p, tab, None
    return None, ctx, p, tab, Plan(sess.reads, ctx.world["worldId"])


def row_create(sess: L.Session, payload: dict) -> Decision:
    """worldRoute_ create: a tab the world does not have is made from the record's keys (worldMintTab_), then
    createRow_ — an id and the two stamps where the record has none, the header widened, the row appended."""
    done, ctx, p, tab, plan = _route(sess, "create", payload)
    if done is not None:
        return done
    reads = sess.reads
    header = None
    if not plan.view(tab).exists:
        header = ["id"] + [k for k in dict.fromkeys(p) if k != "id"]
    held = _book_gate(reads)
    if held:
        if header is not None:
            plan.add(tab, WO.make(header, False))
        return _kept(held, plan.keep(who(ctx.user)), plan.wid)
    record = dict(p)
    now = W.now_iso(reads)
    if gsjs.falsy(record.get("id")):
        record["id"] = W.mint()
    if gsjs.falsy(record.get("createdAt")):
        record["createdAt"] = now
    record["updatedAt"] = now
    plan.add(tab, WO.record(header, list(record), {k: WO.value(x) for k, x in record.items()}))
    plan.keep(who(ctx.user))
    return Decision({"status": 200, "data": record}, own=True, subject=plan.wid)


def row_update(sess: L.Session, payload: dict) -> Decision:
    """worldRoute_ update: updateRowById_ — the record's cells merged with the patch, createdAt never, updatedAt
    stamped."""
    done, ctx, p, tab, plan = _route(sess, "update", payload)
    if done is not None:
        return done
    v = plan.view(tab)
    if not v.exists:
        return Decision(WL.missing(tab, p))
    held = _book_gate(sess.reads)
    if held:
        return Decision(held)
    if "id" not in p or p.get("id") == "":
        return W.refuse(400, 'Missing required "id" in payload.')
    if p.get("id") is None:
        return W.refuse(404, f'No "{tab}" record with id "null".')
    existing, error = WL.require_row(v, tab, p["id"])
    if error:
        return Decision(error)
    merged = dict(existing)
    for k, x in p.items():
        if k != "createdAt":
            merged[k] = x
    merged["updatedAt"] = W.now_iso(sess.reads)
    cells = {k: WO.value(merged[k]) for k in list(p) + ["updatedAt"] if k != "createdAt"}
    plan.add(tab, WO.update(list(merged), gsjs.js_str(p["id"]), cells))
    plan.keep(who(ctx.user))
    return Decision({"status": 200, "data": merged}, own=True, subject=plan.wid)


def row_delete(sess: L.Session, payload: dict) -> Decision:
    """worldRoute_ delete: deleteRowById_ — the row the id names."""
    done, ctx, p, tab, plan = _route(sess, "delete", payload)
    if done is not None:
        return done
    v = plan.view(tab)
    if not v.exists:
        return Decision(WL.missing(tab, p))
    held = _book_gate(sess.reads)
    if held:
        return Decision(held)
    rid = p.get("id")
    if rid is None or rid == "":
        return W.refuse(400, 'Missing required "id" in payload.')
    if WL.find_row(v, rid) is None:
        return W.refuse(404, f'No "{tab}" record with id "{gsjs.js_str(rid)}".')
    plan.add(tab, WO.drop("id", gsjs.js_str(rid), first=True))
    plan.keep(who(ctx.user))
    return Decision({"status": 200, "data": {"id": rid, "deleted": True}}, own=True, subject=plan.wid)


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {
    "worldEnsure": ensure, "worldAppUpsert": app_upsert, "worldAppDelete": app_delete,
    "worldAppsSeedDefaults": seed_door, "worldAppInstallDefault": install_default,
    WL.DOORS["create"]: row_create, WL.DOORS["update"]: row_update, WL.DOORS["delete"]: row_delete,
    WI.ACTION: WI.door}
# every gate runs in the door, in doPost's order
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
# a person's own world answers wherever the session stands, and the generic verbs inside a world are these doors'
PLACE_SAFE = frozenset(ACTIONS)
WORLD_SAFE = frozenset(WL.DOORS.values())


class Store(W.Store):
    """app.my_world_writes and app.my_world_receipts; the worlds themselves in app.worlds and beside it, where a void
    takes each change under its write back."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="my_world", label="My World")

    def settle(self, write_id: str, state: str, why: str = "", fields: list[str] | None = None) -> bool:
        done = super().settle(write_id, state, why, fields)
        if state == "void" and done:
            try:
                with self.conn().transaction():
                    WS.void(self.conn(), write_id)
            except Exception as exc:  # noqa: BLE001 - said, never raised into the relay's settle
                W.log.warning("my world: the void of %s was not applied (%s)", write_id[:40], type(exc).__name__)
        return done
