"""My World (World.gs): each account's own world, read off Postgres (app/world_store.py) — its registry row, its apps
(worldAppsList) and, for an envelope that names the world, its tabs through the generic verbs (worldRoute_). Where the
session stands — the place, the member a visit names, the world — is settled before any door, as doPost settles it
(app/envelope.py)."""
from __future__ import annotations

import re
from typing import Any

import app_builder as AB
import candidates as CND
import envelope as EV
import gsjs
import hubdb
import locations as L
import studio as ST
import world_defaults as WD
import world_store as WS
from client_rename import js_json

APP_ID = "my-world"
REGISTRY_TAB = "user_worlds"
APPS_TAB = "world_apps"
TAB_RE = re.compile(r"[A-Za-z][A-Za-z0-9_]{0,48}")
WORLD_ROLES = ("admin", "manager", "staff", "client")
GENERIC = ("list", "get", "create", "update", "delete")
# the generic verbs on a world's tab, under the names the relay asks them by
DOORS = {"list": "worldRowsList", "get": "worldRowGet", "create": "worldRowCreate", "update": "worldRowUpdate",
         "delete": "worldRowDelete"}
VERB_OF = {d: v for v, d in DOORS.items()}
_ROLES = {"roles": WORLD_ROLES}
# HUB_POLICY as World.gs and WorldDefaults.gs declare it
GS_POLICY: dict[str, dict[str, Any]] = {
    "worldGet": _ROLES, "worldEnsure": _ROLES, "worldAppsList": _ROLES,
    "worldAppUpsert": {**_ROLES, "params": {"app": {"type": "object", "required": True}}},
    "worldAppDelete": {**_ROLES, "params": {"app_id": {"type": "string", "required": True}}},
    "worldAppsSeedDefaults": _ROLES,
    "worldAppInstallDefault": {**_ROLES, "params": {"app_id": {"type": "string", "required": True}}}}
NO_WORLD = "No world yet — worldEnsure creates one."
DENIED = {"status": 403, "message": "Worlds are for employees."}
# AppBuilder.gs APP_BUILDER_COLUMNS: a world's world_apps tab, tenant always blank
APP_BUILDER_COLUMNS = list(AB.COLUMNS)

s_ = gsjs.str_


# ---- where the session stands (Main.gs doPost, settled before any door by app/envelope.py) ----------------------

class Ctx:
    """Who asks and where they stand, as envelope.settle left them: the account signed in (caller, HUB_CALLER), the
    identity the door answers for (user: the visited person during a visit, the caller for its own doors), the place,
    the visit, the world and the tab a generic verb names."""

    def __init__(self, user: dict[str, Any]) -> None:
        place = user.get("place") if isinstance(user.get("place"), dict) else {}
        self.caller = EV.caller_of(user)
        self.user = user
        self.tenant: dict | None = {"tenantId": s_(place.get("tenant_id"))} if s_(place.get("tenant_id")) else None
        self.member: dict | None = {"memberId": s_(place.get("member_id"))} if s_(place.get("member_id")) else None
        self.world: dict | None = {"worldId": s_(place.get("world_id"))} if s_(place.get("world_id")) else None
        self.resource = s_(place.get("resource"))

    def actor(self, action: str) -> dict[str, Any]:
        """The identity a door is asked as: envelope.settle chose it (the caller for HUB_CALLER_OWN_ACTIONS)."""
        return self.user


def _js_type(v: Any) -> str:
    if v is None:
        return "object"
    if isinstance(v, list):
        return "array"
    if isinstance(v, bool):
        return "boolean"
    if isinstance(v, (int, float)):
        return "number"
    if isinstance(v, str):
        return "string"
    return "object"


def policy_gate(action: str, payload: dict, actor: dict[str, Any]) -> dict[str, Any] | None:
    """hubPolicyGate_ with World's own declarations: the roles, then each required and typed parameter."""
    pol = GS_POLICY.get(action) or {}
    roles = pol.get("roles") or ()
    if roles and actor and not actor.get("is_service") and gsjs.js_str(actor.get("role")) not in roles:
        return {"status": 403, "message": "This action is for " + " or ".join(roles) + "."}
    for key, rule in (pol.get("params") or {}).items():
        val = payload.get(key)
        missing = val is None or val == ""
        if rule.get("required") and missing:
            return {"status": 400, "message": f"Missing required parameter: {key}."}
        if not missing and rule.get("type") and _js_type(val) != rule["type"]:
            return {"status": 400, "message": f"{key} must be {rule['type']}, got {_js_type(val)}."}
    return None


def enter(sess: L.Session, action: str, payload: Any) -> tuple[dict[str, Any] | None, Ctx, dict[str, Any]]:
    """doPost before the door: the place, the visit, the world and the place law were settled before it
    (envelope.settle, each refusal its own answer); then, for a named door, the declaration asked of the actor.
    (refusal, ctx, the screen's payload)."""
    p = dict(payload) if isinstance(payload, dict) else {}
    ctx = Ctx(sess.user or {})
    if action in VERB_OF:
        return None, ctx, p
    return policy_gate(action, p, ctx.actor(action)), ctx, p


# ---- who has a world ----------------------------------------------------------------------------------------------

def human(user: dict | None) -> bool:
    """worldHuman_: interviewers and trainees get no world; every other account, clients included, does."""
    return bool(user) and not user.get("is_service") and gsjs.or_blank(user.get("role")) in WORLD_ROLES


def withheld(reads: L.Reads, ctx: Ctx) -> bool:
    """worldWithheld_: hubMyWorldHiddenFor_, asked of the account signed in (app/envelope.py)."""
    return EV.world_withheld(reads, ctx.caller)


def offered(reads: L.Reads, ctx: Ctx, user: dict | None) -> bool:
    """worldOffered_."""
    return human(user) and not withheld(reads, ctx)


def row_for(reads: L.Reads, user: dict | None) -> dict | None:
    """worldRowFor_: the first registry row the account owns."""
    uid = s_((user or {}).get("id"))
    if not uid:
        return None
    return next((r for r in WS.registry_rows(reads) if r["owner_user_id"] == uid), None)


def public(row: dict) -> dict[str, str]:
    """worldPublic_: a world is Postgres rows, so it names no spreadsheet."""
    return {"world_id": s_(row.get("world_id")), "name": s_(row.get("name")), "spreadsheet_id": "",
            "created_at": s_(row.get("created_at"))}


def world_name(user: dict) -> str:
    return "ASA World — " + (s_(user.get("display_name")) or s_(user.get("email")) or s_(user.get("id")))


def owned_ids(v: AB.View) -> dict[str, str]:
    """worldAppsOwnedIds_: each app id the tab holds, with the last row's author."""
    if not v.exists or not any(gsjs.trim(gsjs.or_blank(h)) == "app_id" for h in v.header):
        return {}
    out: dict[str, str] = {}
    for raw in v.rows:
        aid = AB.cell(v, raw, "app_id")
        if aid:
            out[aid] = AB.cell(v, raw, "updated_by")
    return out


def marked(v: AB.View) -> set[str]:
    """worldDefaultsMarked_: the app ids the marker's first column holds."""
    return {AB.cell(v, raw, WD.MARKER_HEADER[0]) for raw in v.rows} if v.exists else set()


# ---- the reads ----------------------------------------------------------------------------------------------------

def world_get(sess: L.Session, payload: dict) -> dict[str, Any]:
    """worldGet: the caller's own world, or null when none has been created yet."""
    refused, ctx, _p = enter(sess, "worldGet", payload)
    if refused:
        return refused
    user = ctx.actor("worldGet")
    if not human(user):
        return dict(DENIED)
    if withheld(sess.reads, ctx):
        return {"status": 200, "data": {"world": None}}
    row = row_for(sess.reads, user)
    return {"status": 200, "data": {"world": public(row) if row else None}}


def apps_list(sess: L.Session, payload: dict) -> dict[str, Any]:
    """worldAppsList: the world's apps in exactly the appsBuilt grammar, read from its world_apps tab."""
    refused, ctx, _p = enter(sess, "worldAppsList", payload)
    if refused:
        return refused
    reads, user = sess.reads, ctx.actor("worldAppsList")
    if not offered(reads, ctx, user):
        return dict(DENIED)
    mine = row_for(reads, user)
    if not mine:
        return {"status": 200, "data": {"apps": [], "problems": [], "tab": APPS_TAB, "world": None,
                                        "defaults": WD.summary({})}}
    wid = s_(mine.get("world_id"))
    v = WS.view(reads, wid, APPS_TAB)
    if not v.exists:
        return {"status": 200, "data": {"apps": [], "problems": [], "tab": APPS_TAB, "world": wid,
                                        "defaults": WD.summary({})}}
    by_app: dict[str, dict] = {}
    order: list[str] = []
    problems: list[dict] = []
    owned: dict[str, bool] = {}
    for i, raw in enumerate(v.rows):
        rn = i + 2

        def col(name: str) -> str:
            return AB.cell(v, raw, name)
        app_id = col("app_id")
        if not app_id:
            continue
        owned[app_id] = True
        if not AB._truthy(col("enabled") or "TRUE"):
            continue
        kind = col("page_type") or "sheet"
        if kind not in ST.APP_BUILDER_TYPES:
            problems.append({"row": rn, "app": app_id, "message": 'page_type "' + kind + '" is not one the engine '
                             "mounts (" + ", ".join(ST.APP_BUILDER_TYPES) + ")"})
            continue
        resource = col("resource")
        if not resource:
            problems.append({"row": rn, "app": app_id, "message": "resource is required — it is where the rows live"})
            continue
        columns = AB.columns_of(col("columns"))
        options = AB.json_cell(col("options"), {})
        if col("options") and not AB._keys_of(options):
            problems.append({"row": rn, "app": app_id,
                             "message": "options is not valid JSON — the page kept its defaults"})
        if columns and isinstance(options, dict) and gsjs.falsy(options.get("columns")):
            options["columns"] = columns
        page = {"id": col("page_id") or "list", "type": kind,
                "title": col("page_title") or col("app_name") or app_id,
                "dataSource": {"resource": resource}, "config": options}
        if app_id not in by_app:
            audience = col("audience")
            by_app[app_id] = {
                "id": app_id, "name": col("app_name") or app_id, "tagline": col("tagline"),
                "icon": col("icon") or "layout-grid", "accent": col("accent") or "blue",
                "category": col("category") or "Workspace", "version": "sheet", "enabled": True,
                "audience": [gsjs.trim(a) for a in audience.split(",") if gsjs.trim(a)] if audience
                else ["admin", "manager", "staff"],
                "pages": [], "source": "sheet"}
            order.append(app_id)
        by_app[app_id]["pages"].append(page)
    return {"status": 200, "data": {"apps": [by_app[a] for a in order], "problems": problems, "tab": APPS_TAB,
                                    "world": wid, "defaults": WD.summary(owned)}}


# ---- the generic verbs inside a world (worldRoute_, SheetDb.gs) ---------------------------------------------------

def find_row(v: AB.View, rid: Any) -> dict | None:
    """findRowIndex_: the first row whose id cell is the id, as String() reads both."""
    if rid is None or rid == "" or "id" not in v.header:
        return None
    want = gsjs.js_str(rid)
    return next((raw for raw in v.rows if gsjs.or_blank(AB.value(raw.get("id"))) == want), None)


def require_row(v: AB.View, resource: str, rid: Any) -> tuple[dict | None, dict | None]:
    """requireRow_: (the record, every header's cell deserialize_d, None) or (None, its refusal)."""
    if rid is None or rid == "":
        return None, {"status": 400, "message": 'Missing required "id" in payload.'}
    raw = find_row(v, rid)
    if raw is None:
        return None, {"status": 404, "message": 'No "' + resource + '" record with id "' + gsjs.js_str(rid) + '".'}
    return {h: hubdb.cell_text(AB.value(raw.get(h))) for h in v.header if h != ""}, None


def list_rows(v: AB.View, params: dict) -> list[dict]:
    """listRows_: readAll_, q a case-insensitive filter over every value, then offset and limit."""
    rows = AB.read_all(v)
    q = gsjs.trim("" if params.get("q") is None else gsjs.js_str(params.get("q"))).lower()
    if q:
        def hit(row: dict) -> bool:
            for x in row.values():
                if x is None:
                    continue
                s = js_json(x) if isinstance(x, (dict, list)) else gsjs.js_str(x)
                if q in s.lower():
                    return True
            return False
        rows = [r for r in rows if hit(r)]
    offset = CND.js_parse_int(params.get("offset"))
    if offset != offset or offset < 0:
        offset = 0
    limit = CND.js_parse_int(params.get("limit"))
    if limit != limit or limit < 0:
        return rows[int(offset):]
    return rows[int(offset):int(offset) + int(limit)]


def route_head(ctx: Ctx, verb: str) -> tuple[dict | None, str]:
    """worldRoute_'s refusals before the tab: the verb, then the tab's name."""
    if verb not in GENERIC:
        return {"status": 400, "message": 'Unknown action: "' + verb + '". Valid actions: list, get, create, update, '
                "delete."}, ""
    tab = s_(ctx.resource)
    if not TAB_RE.fullmatch(tab):
        return {"status": 404, "message": 'Unknown resource: "' + tab + '".'}, ""
    if not ctx.world:
        return {"status": 404, "message": 'No world "".'}, ""
    return None, tab


def missing(tab: str, payload: dict) -> dict[str, Any]:
    return {"status": 404, "message": 'No "' + tab + '" record with id "' + s_(payload.get("id")) + '".'}


def rows_list(sess: L.Session, payload: dict) -> dict[str, Any]:
    """worldRoute_ list: a tab the world does not have yet lists nothing."""
    refused, ctx, p = enter(sess, DOORS["list"], payload)
    if refused:
        return refused
    head, tab = route_head(ctx, "list")
    if head:
        return head
    v = WS.view(sess.reads, ctx.world["worldId"], tab)
    if not v.exists:
        return {"status": 200, "data": []}
    return {"status": 200, "data": list_rows(v, p)}


def row_get(sess: L.Session, payload: dict) -> dict[str, Any]:
    """worldRoute_ get."""
    refused, ctx, p = enter(sess, DOORS["get"], payload)
    if refused:
        return refused
    head, tab = route_head(ctx, "get")
    if head:
        return head
    v = WS.view(sess.reads, ctx.world["worldId"], tab)
    if not v.exists:
        return missing(tab, p)
    row, error = require_row(v, tab, p.get("id"))
    return error if error else {"status": 200, "data": row}


def ensure_prepare(sess: L.Session, payload: dict) -> dict[str, Any]:
    """worldEnsure's preparation as the relay used to ask it: the caller's gates, nothing made — a world is made by its
    write alone."""
    refused, ctx, _p = enter(sess, "worldEnsure", payload)
    if refused:
        return refused
    if not offered(sess.reads, ctx, ctx.actor("worldEnsure")):
        return dict(DENIED)
    return {"status": 200, "data": {}}


ACTIONS = {"worldGet": world_get, "worldAppsList": apps_list, "worldEnsurePrepare": ensure_prepare,
           DOORS["list"]: rows_list, DOORS["get"]: row_get}
# every gate runs in the door, in doPost's order
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
# a person's own world answers wherever the session stands, and the generic verbs inside a world are these doors'
PLACE_SAFE = frozenset(ACTIONS)
WORLD_SAFE = frozenset(DOORS.values())
