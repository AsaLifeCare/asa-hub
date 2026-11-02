"""App Studio's App Builder and Playground on Python (AppBuilder.gs appsBuilt, Studio.gs resourcesList and
sheetInspect, Main.gs route() list and get on `apps`, on the imports hub_resources registers and on the tabs app_builder
names), off asa-hub-db: each tab as the copy holds it with the book ops still on their way laid over it (book_ops
`rows`, queued by app/app_builder_writes.py), an import's rows read off the copy of its book, and a spreadsheet
inspected as the copy holds it — never read from Google. The place is the envelope's (user['place']) or the account's
home. A tab Apps Script made or widened while it read is queued once by the read that finds it missing (Touch)."""
from __future__ import annotations

import json
import logging
import re
import uuid
from typing import Any, Callable, NamedTuple

import book_ops as BO
import candidates as CND
import client_rename as CR
import gsjs
import house_tables as HT
import hubdb
import locations as L
import resource_rows as RR
import scope as sc
import studio as ST

APP_ID = "studio"
TAB = "app_builder"
COLUMNS = ("app_id", "app_name", "tagline", "icon", "accent", "category", "audience", "page_id", "page_title",
           "page_type", "resource", "columns", "options", "enabled", "notes", "updated_at", "updated_by", "tenant")
# APP_BUILDER_EXAMPLE: the seed row of a tab made empty
EXAMPLE = (dict(zip(COLUMNS, (
    "house-supplies", "House Supplies", "What each house needs this week", "package", "amber", "Operations",
    "admin,manager,staff", "list", "Supply requests", "sheet", "houseSupplies",
    "house:House:text|item:Item:text|qty:Qty:number|needed_by:Needed by:date|status:Status:status",
    '{"searchable":true,"exportable":true,"primaryKey":"item"}', "TRUE",
    "Example row — edit or delete it. The tab houseSupplies was created from the columns above.", "", "", ""))),)
ID_RE = re.compile(r"[a-z][a-z0-9-]{1,48}")
RESOURCE_RE = re.compile(r"[A-Za-z][A-Za-z0-9_]{1,48}")
PAGE_ID_RE = re.compile(r"[a-z][a-z0-9-]{0,40}")
MAX_PAGES = 12
MAX_SEED_ROWS = 200
MAX_OPTIONS_CHARS = 8000
AUDIENCE = ("admin", "manager", "staff", "client", "all")
ACTION_KINDS = ("patch", "call", "link")
ACTION_SLOTS = ("rowActions", "headerActions", "secondaryActions")
RESOURCES_TAB = "hub_resources"
RESOURCES_HEADER = ("resource_id", "spreadsheet_id", "tab_name", "label", "created_at", "created_by", "tenant")
APPS_TAB = "apps"
# sheetFor_: a generic resource's tab, made with these
SHEETDB_HEADER = ("id", "createdAt", "updatedAt")
# SheetDb.gs HUB_CENTRAL_TABS: never re-pointed to a place's workbook
CENTRAL = ("users", "hub_sessions", "user_prefs", "user_place_profiles", "tenants", "user_worlds", "platform_members",
           "platform_invites", "app_badge_access", "app_tenant_access", "config_badge_access", "apps", "app_builder",
           "hub_resources")
# SheetDb.gs HUB_TAB_BORN_HOME: tabs hubTabEnsure_ may make only in their declared book
BORN_HOME = ("house_notes", "isp_sections", "incident_reviews", "staff_notes", "staff_profile_visits", "ssa_notes",
             "family_notes", "client_overrides")
# Estate.gs ESTATE_SOURCES: a resource with no tab to ensure
ESTATE = frozenset({"drAppointments", "drVisits", "workOrders", "houseInventory", "uiIncidents", "supportQueue",
                    "dailyNotes"})
# Main.gs RESOURCES: each coded resource and the tab it names
CODED: dict[str, str] = {
    "people": "people", "smartCommsDesk": "smart_comms", "commWhen": "comm_when", "smartCommsActivity":
    "smart_comms_sent", "medDelFlows": "meddel_flows", "psiPunches": "psi_punches", "commCalls": "comm_calls",
    "commWorkItems": "comm_work_items", "candidates": "candidates", "talentPool": "talentPool", "recruitment":
    "recruitment_contracts", "hiringCadences": "hiringCadences", "documents": "documents", "policies": "policies",
    "contactLists": "contactLists", "videos": "videos", "helpfulContacts": "helpful_contacts", "events": "events",
    "notifications": "notifications", "apps": "apps", "activity": "activity", "questionnaireResponses":
    "questionnaireResponses", "potentialClients": "potentialClients", "photos": "photos", "projects": "projects",
    "projectWorkItems": "project_work_items", "isps": "isps", "audits": "audits", "callOffs": "callOffs",
    "certMatrix": "certMatrix", "clients": "clients", "diseases": "diseases", "drAppointments": "drAppointments",
    "equipment": "equipment", "expenseReports": "expenseReports", "fleetVehicles": "fleetVehicles",
    "hydrationProfiles": "hydrationProfiles", "inventoryItems": "inventoryItems", "leads": "leads", "mealIdeals":
    "mealIdeals", "mealPlans": "mealPlans", "mileageLogs": "mileageLogs", "policyAcks": "policyAcks",
    "questionnaires": "questionnaires", "routes": "routes", "shiftCards": "shiftCards", "shiftMatrix":
    "shiftMatrix", "shiftTimeline": "shiftTimeline", "shifts": "shifts", "sleepProfiles": "sleepProfiles",
    "staffCerts": "staffCerts", "sheetTasks": "sheet_tasks", "tasks": "tasks", "financeTransactions":
    "finance_transactions", "financeBalances": "finance_balances", "financeConfig": "finance_config",
    "shopperItems": "shopper_items", "shopperPrices": "shopper_prices", "mealProfile": "meal_profile", "mealLog":
    "meal_log", "weekItems": "week_items", "learnSkills": "learn_skills", "learnAttempts": "learn_attempts",
    "travelTrips": "travel_trips", "truelinkRuns": "truelink_runs", "istRecords": "ist_records", "istHouses":
    "ist_houses", "time_punches": "time_punches", "recon_runs": "recon_runs", "recon_errors": "recon_errors",
    "uiIncidents": "uiIncidents", "visits": "visits", "workOrders": "workOrders", "workoutPlans": "workoutPlans",
    "incidents": "incidents", "marEntries": "mar_entries", "medications": "medications", "medCatalog":
    "med_catalog", "forms": "forms", "formSubmissions": "form_submissions", "formAnswers": "form_answers",
    "formFiles": "form_files", "quoTranscripts": "quo_transcripts", "quoMessages": "quo_messages", "quoSummaries":
    "quo_summaries", "clientNotes": "client_notes", "marErrors": "mar_errors", "missingMedications":
    "missing_medications", "clientFiles": "client_files", "medDeliveries": "med_deliveries", "careDocs":
    "care_docs", "billingClaims": "billing_claims", "teamTasks": "team_tasks", "reminders": "reminders",
    "teamProjects": "team_projects", "books": "books", "widgets": "widgets"}
# Tenant.gs HUB_TENANT_SAFE_ACTIONS, of these doors: the ones that answer away from headquarters
TENANT_SAFE = ("appsBuilt", "appBuilderUpsert", "appUpsert", "appDelete")
ADMIN_ONLY = "This action is for admin."
COULD_NOT_OPEN = "Could not open that spreadsheet — make sure this Google account has access to it."
NOT_FOUND = {"status": 404, "message": "Not found."}
READ_ONLY_IMPORT = "Imported resources are read-only in this build."
# an import's list never answers more than this (rows, bytes of JSON); a server-side cursor fetches it in batches
DYN_MAX_ROWS = 20000
DYN_MAX_BYTES = 8 << 20
DYN_FETCH = 1000
# the import whose rows carry every actor's email: admins and managers alone
SYSTEM_LOGS = "x_system_logs"
OP = "rows"  # book_ops.ROWS
# a carried op is laid until the copy of its tab was loaded after it, for at most this long
LAY_DONE_S = 6 * 3600.0
_SHEET_URL = re.compile(r"/d/([A-Za-z0-9_-]{20,})")
_SHEET_ID = re.compile(r"[A-Za-z0-9_-]{20,}")

log = logging.getLogger("asa-hub-app")
s_ = gsjs.str_


class Held(Exception):
    """A door's answer decided below it (a refusal Apps Script threw or returned)."""

    def __init__(self, env: dict[str, Any]) -> None:
        super().__init__(env.get("message"))
        self.env = env


class Facts(Exception):
    """The tab is a dissolved one the depot's facts hold (runtimeSheetFor_): there, never on a sheet."""


def answering(door: Callable[[L.Session, dict], Any], wrap: Callable[[dict], Any]) -> Callable[[L.Session, dict], Any]:
    """The door, a Held answered as its envelope."""
    def run(sess: L.Session, payload: dict) -> Any:
        try:
            return door(sess, payload)
        except Held as h:
            return wrap(h.env)
    run.__doc__ = door.__doc__
    return run


def gone_words(tab: str) -> str:
    """hubTabEnsure_'s throw, as doPost answers a thrown error."""
    return (f'Internal error: hubTabEnsure_: "{tab}" is declared moved or dissolved and its new address did not answer'
            " — refusing to re-create it.")


# ---- the place (Tenant.gs) ----------------------------------------------------------------------------------------

def here(reads: L.Reads, user: dict | None) -> str:
    """hubTenantId_: the place the session stands in — the envelope's (user['place']), else the account's home;
    '' at headquarters. A place the caller may not stand in is tenantContext_'s 404."""
    u = user or {}
    place = u.get("place") if isinstance(u.get("place"), dict) else {}
    wanted = s_(place.get("tenant"))
    if not wanted or u.get("is_service"):
        return ST.tenant_id(reads, u)
    rows = ST.tenants_rows(reads)
    home = ST.tenant_home_from(rows)
    master = sc.is_real_master(u)
    allowed = [s_(t.get("tenantid")) for t in rows if s_(t.get("status")) != "archived" and s_(t.get("tenantid"))] \
        if master else ST.tenant_ids_for_user(u.get("home_tenant"), ",".join(ST.user_tenants(reads, u)))
    if home and wanted == home:
        if master or not allowed or home in allowed:
            return ""
        raise Held(dict(NOT_FOUND))
    if wanted not in allowed:
        raise Held(dict(NOT_FOUND))
    return wanted


def visible(where: str, owner: Any) -> bool:
    """tenantRowVisible_: a blank cell is headquarters'."""
    return not where or s_(owner) == where


def away_refused(reads: L.Reads, user: dict | None, action: str) -> dict[str, Any] | None:
    """doPost's place law: away from headquarters an action runs only if Tenant.gs declares it safe there."""
    if here(reads, user) and action not in TENANT_SAFE:
        return dict(ST.UNKNOWN)
    return None


def admin_refused(reads: L.Reads, user: dict | None, action: str) -> dict[str, Any] | None:
    """The place law, the declared role (admin) and the handler's own hubDenied_, in doPost's order."""
    u = user or {}
    away = away_refused(reads, u, action)
    if away:
        return away
    if not u.get("is_service") and s_(u.get("role")) != "admin":
        return {"status": 403, "message": ADMIN_ONLY}
    if s_(u.get("role")) != "admin":
        return dict(ST.DENIED)
    return None


def place_book(reads: L.Reads, user: dict | None) -> str:
    """tenantSpreadsheetId_: the place's own workbook, '' at headquarters or before tenantEnsure gives it one."""
    where = here(reads, user)
    if not where:
        return ""
    row = next((r for r in ST.tenants_rows(reads) if s_(r.get("tenantid")) == where), {})
    return s_(row.get("spreadsheetid"))


def declared_gone(reads: L.Reads, tab: str) -> bool:
    """hubTabDeclaredGone_: dissolvable, homed in a book of its own, given a house, moved or dissolved."""
    return (tab in hubdb.HIRING_DISSOLVABLE or tab in hubdb.HUB_TAB_HOME or bool(reads.db.house_id(tab))
            or reads.db.house_moved(tab) or reads.db.dissolved(tab))


def born_here(reads: L.Reads, sid: str, tab: str) -> bool:
    """hubTabBornHere_: a born-home tab, in the book its HUB_TAB_HOME names."""
    home = hubdb.HUB_TAB_HOME.get(tab)
    return tab in BORN_HOME and bool(home) and sid == reads.db.prop(home)


# ---- a tab: the copy, the ops on their way laid -------------------------------------------------------------------

class View(NamedTuple):
    """A tab as the sheet will stand: its book, its name there, whether it exists, its header, each row after it
    (a blank row {}), and the copy's tab."""
    sid: str
    tab: str
    exists: bool
    header: tuple
    rows: tuple
    ref: hubdb.TabRef | None


def _raw_text(v: Any) -> str:
    """A cell's text as the sheet shows it, trimmed."""
    return gsjs.trim(gsjs.or_blank(hubdb.typed(v, "raw")))


def _filled(row: dict) -> bool:
    return any(_raw_text(v) for v in row.values())


def where(reads: L.Reads, user: dict | None, tab: str) -> tuple[str, str, hubdb.TabRef | None]:
    """hubTabWorkbook_ then hubHouseTabIn_: (the book, the tab's name in it, the copy's tab)."""
    if tab not in CENTRAL:
        book = place_book(reads, user)
        if book:
            return book, tab, reads.tab_of(book, tab, tab)
    # headquarters' tab as it stands: its own table once kept there
    res = HT.where(reads, tab)
    if res.runtime:
        raise Facts(tab)
    if not res.book_known:
        raise hubdb.Unreadable(f"asa-hub-db holds no copy of the book behind {tab}")
    return res.sheet_id, (res.ref.tab if res.ref is not None else res.names[0]), res.ref


def _ops(reads: L.Reads) -> dict[tuple[str, str], list[dict]]:
    """The `rows` ops not refused: waiting, being written, or written lately; by tab, oldest first."""
    def read() -> dict[tuple[str, str], list[dict]]:
        got = RR._q(reads, f"select sheet_id, tab_name, spec, state, extract(epoch from done_at) from {BO.table()}"
                           " where op = %s and (state in ('pending', 'applying') or state = 'done'"
                           " and done_at > now() - make_interval(secs => %s)) order by id", (OP, LAY_DONE_S))
        out: dict[tuple[str, str], list[dict]] = {}
        for sid, tab, spec, state, done in got:
            out.setdefault((sid, tab), []).append({"spec": spec if isinstance(spec, dict) else json.loads(spec or "{}"),
                                                   "state": state, "done": float(done or 0)})
        return out
    return reads.once("appbuilder:ops", read)


def _copy_rows(reads: L.Reads, ref: hubdb.TabRef) -> list[dict]:
    """getDataRange's rows after the header: every sheet row up to the last that holds anything."""
    by: dict[int, dict] = {}
    last = 1
    for rn, raw in reads.db.rows(ref):
        by[rn] = raw
        if rn > last and _filled(raw):
            last = rn
    return [by.get(rn) or {} for rn in range(2, last + 1)]


def view_at(reads: L.Reads, sid: str, tab: str, ref: hubdb.TabRef | None) -> View:
    v = View(sid, tab, ref is not None, tuple(ref.headers) if ref is not None else (),
             tuple(_copy_rows(reads, ref)) if ref is not None else (), ref)
    if isinstance(ref, HT.KeptRef):
        # its own table holds every write already: no op is on its way to it
        return v
    loaded = hubdb._epoch(ref.loaded_at) if ref is not None else 0.0
    for op in _ops(reads).get((sid, tab), ()):
        if op["state"] == "done" and ref is not None and loaded > op["done"]:
            continue
        v = lay(v, op["spec"])
    return v


def view(reads: L.Reads, user: dict | None, tab: str) -> View:
    """hubTabSheet_(tab), as the sheet will stand once every op queued for it is carried."""
    sid, name, ref = where(reads, user, tab)
    return view_at(reads, sid, name, ref)


def lay(v: View, spec: dict) -> View:
    """One `rows` op as book_ops.rows_apply leaves the tab (book_ops.rows_lay)."""
    exists, header, rows = BO.rows_lay(v.exists, list(v.header), list(v.rows), spec)
    return v if not exists else v._replace(exists=True, header=tuple(header), rows=tuple(rows))


def op_of(v: View, spec: dict) -> dict[str, Any]:
    """The `rows` op for this tab (book_ops.rows)."""
    return BO.rows(v.sid, v.tab, **spec)


# ---- a tab's rows as each Apps Script reader hands them -----------------------------------------------------------

def value(raw: Any) -> Any:
    """getValues()' value for a cell."""
    return hubdb.typed(raw, "hub")


def cell(v: View, row: dict, name: str) -> str:
    """appsBuilt's col(): the first header that trims to the name, its value String()'d and trimmed."""
    h = next((h for h in v.header if gsjs.trim(gsjs.or_blank(h)) == name), None)
    return "" if h is None else gsjs.trim(gsjs.or_blank(value(row.get(h))))


def normalized(v: View) -> list[dict]:
    """readTabNormalized_: headers normKey_'d, Dates as cellText_, blank rows dropped."""
    keys = [hubdb.norm_key(h) for h in v.header]
    out = []
    for raw in v.rows:
        vals = [value(raw.get(h)) for h in v.header]
        if all(x == "" or x is None for x in vals):
            continue
        o: dict[str, Any] = {}
        for k, x in zip(keys, vals):
            if k:
                o[k] = hubdb.cell_text(x) if isinstance(x, (gsjs.SheetDate, hubdb.SheetTime)) else x
        out.append(o)
    return out


def read_all(v: View) -> list[dict]:
    """readAll_: header-keyed, deserialize_d, rows of nothing but blanks dropped."""
    out = []
    for raw in v.rows:
        vals = [value(raw.get(h)) for h in v.header]
        if all(x == "" or x is None for x in vals):
            continue
        out.append({h: hubdb.cell_text(x) for h, x in zip(v.header, vals) if h != ""})
    return out


def require_row(v: View, rid: Any, resource: str = APPS_TAB) -> dict[str, Any]:
    """requireRow_: the first row whose id cell is the id, every header's cell deserialize_d; { error } else."""
    if rid is None or rid == "":
        return {"error": {"status": 400, "message": 'Missing required "id" in payload.'}}
    want = gsjs.js_str(rid)
    if "id" in v.header:
        for raw in v.rows:
            if gsjs.or_blank(value(raw.get("id"))) == want:
                return {h: hubdb.cell_text(value(raw.get(h))) for h in v.header if h != ""}
    return {"error": {"status": 404, "message": f'No "{resource}" record with id "{want}".'}}


def row_id(row: dict) -> str:
    """String(row.id) of a readAll_ row."""
    return gsjs.js_str(row["id"]) if "id" in row else "undefined"


# ---- the builder's grammar (AppBuilder.gs) ------------------------------------------------------------------------

def columns_of(spec: Any) -> list[dict[str, str]]:
    """appBuilderColumns_: "house:House:text|item:Item:text" as column objects."""
    out = []
    for part in gsjs.or_text(spec).split("|"):
        bits = part.split(":")
        key = gsjs.trim(bits[0] if bits else "")
        if not key:
            continue
        out.append({"key": key, "label": gsjs.trim(bits[1] if len(bits) > 1 and bits[1] else key),
                    "kind": gsjs.trim(bits[2] if len(bits) > 2 and bits[2] else "text")})
    return out


def json_cell(raw: str, fallback: Any) -> Any:
    """appBuilderJson_: a JSON cell; a typo is the fallback."""
    text = gsjs.trim(raw)
    if not text:
        return fallback
    parsed, got = ST._parse(text)
    return got if parsed else fallback


def _keys_of(x: Any) -> int:
    """Object.keys(x).length; null throws, and doPost answers the throw."""
    if x is None:
        raise Held({"status": 500, "message": "Internal error: Cannot convert undefined or null to object"})
    if isinstance(x, (dict, list, str)):
        return len(x)
    return 0


# ---- first touch: the tabs Apps Script made or widened while it read (hubTabEnsure_, ensureHeader_) ---------------

# what queues a read's first touch (app_builder_writes.ensure_tabs, bound by main.py); unbound, nothing is queued
ENSURE: list[Callable[[list[dict], str], None]] = []


class Touch:
    """The tabs one read finds the sheet lacks, or whose header lacks a name: one op per tab, in the read's order."""

    def __init__(self) -> None:
        self.tabs: dict[tuple[str, str], list] = {}

    def want(self, v: View, header: list[str] | None, keys: list[str], seed: list[dict] | None = None) -> View:
        """hubTabEnsure_(tab, header) then ensureHeader_(keys): the tab as the read sees it after them."""
        key = (v.sid, v.tab)
        held = self.tabs.get(key)
        if held is None:
            held = self.tabs[key] = [v, list(header or keys) if not v.exists else None, list(seed or ()), []]
        for k in keys:
            if k not in held[3]:
                held[3].append(k)
        laid = v if v.exists else lay(v, {"header": held[1], "seed": held[2]})
        return lay(laid, {"grow": list(keys)})

    def ops(self) -> list[dict]:
        out = []
        for v, header, seed, keys in self.tabs.values():
            if v.exists:
                grow = [k for k in keys if k not in v.header]
                if grow:
                    out.append(op_of(v, {"grow": grow}))
                continue
            spec: dict[str, Any] = {"header": header}
            if seed:
                spec["seed"] = seed
            grow = [k for k in keys if k not in header]
            if grow:
                spec["grow"] = grow
            out.append(op_of(v, spec))
        return out

    def queue(self, action: str) -> None:
        ops = self.ops()
        if ops and ENSURE:
            try:
                ENSURE[0](ops, action)
            except Exception as exc:  # noqa: BLE001 - the read answers; the next one asks again
                log.warning("%s: the first touch was not queued (%s)", action, type(exc).__name__)


def ensure_tab(reads: L.Reads, user: dict | None, resource: str, keys: list[str], touch: Touch) -> str:
    """appBuilderEnsureTab_: '' when the tab is there or made (an estate resource has none), else the words of the
    throw the row's problem says."""
    if not resource or resource in ESTATE:
        return ""
    try:
        sid, name, ref = where(reads, user, resource)
    except Facts:
        return ""
    except hubdb.Unreadable as exc:
        return str(exc)
    held = touch.tabs.get((sid, name))
    v = held[0] if held else view_at(reads, sid, name, ref)
    if not v.exists and not held and declared_gone(reads, resource) and not born_here(reads, sid, resource):
        return gone_words(resource)[len("Internal error: "):]
    touch.want(v, keys, keys)
    return ""


def apps_built(sess: L.Session, payload: dict) -> dict[str, Any]:
    """appsBuilt: every app the app_builder tab defines here, shaped like a coded manifest, and what each refused
    row lacks; the tabs it would have made or widened as it read queued once (Touch)."""
    reads, user = sess.reads, sess.user or {}
    touch = Touch()
    v = view(reads, user, TAB)
    if not v.exists and declared_gone(reads, TAB) and not born_here(reads, v.sid, TAB):
        return {"status": 500, "message": gone_words(TAB)}
    v = touch.want(v, list(COLUMNS), list(COLUMNS), list(EXAMPLE))
    where_id = here(reads, user)
    by_app: dict[str, dict] = {}
    order: list[str] = []
    problems: list[dict] = []
    for i, row in enumerate(v.rows):
        rn = i + 2
        app_id = cell(v, row, "app_id")
        if not app_id:
            continue
        if not visible(where_id, cell(v, row, "tenant")):
            continue
        if not _truthy(cell(v, row, "enabled") or "TRUE"):
            continue
        kind = cell(v, row, "page_type") or "sheet"
        if kind not in ST.APP_BUILDER_TYPES:
            problems.append({"row": rn, "app": app_id, "message": f'page_type "{kind}" is not one the engine mounts '
                                                                  f'({", ".join(ST.APP_BUILDER_TYPES)})'})
            continue
        resource = cell(v, row, "resource")
        if not resource:
            problems.append({"row": rn, "app": app_id, "message": "resource is required — it is where the rows live"})
            continue
        cols = columns_of(cell(v, row, "columns"))
        options = json_cell(cell(v, row, "options"), {})
        if cell(v, row, "options") and not _keys_of(options):
            problems.append({"row": rn, "app": app_id,
                             "message": "options is not valid JSON — the page kept its defaults"})
        if cols and isinstance(options, dict):
            options["columns"] = options.get("columns") if not gsjs.falsy(options.get("columns")) else cols
        page = {"id": cell(v, row, "page_id") or "list", "type": kind,
                "title": cell(v, row, "page_title") or cell(v, row, "app_name") or app_id,
                "dataSource": {"resource": resource}, "config": options}
        if app_id not in by_app:
            audience = cell(v, row, "audience")
            by_app[app_id] = {"id": app_id, "name": cell(v, row, "app_name") or app_id,
                              "tagline": cell(v, row, "tagline"), "icon": cell(v, row, "icon") or "layout-grid",
                              "accent": cell(v, row, "accent") or "blue",
                              "category": cell(v, row, "category") or "Operations", "version": "sheet",
                              "enabled": True,
                              "audience": [a for a in (gsjs.trim(x) for x in audience.split(",")) if a] if audience
                              else ["admin", "manager", "staff"],
                              "pages": [], "source": "sheet"}
            order.append(app_id)
        by_app[app_id]["pages"].append(page)
        keys = ["id"] + [c["key"] for c in cols if c["key"] != "id"]
        refused = ensure_tab(reads, user, resource, keys, touch)
        if refused:
            problems.append({"row": rn, "app": app_id, "message": refused})
    touch.queue("appsBuilt")
    return {"status": 200, "data": {"apps": [by_app[a] for a in order], "problems": problems, "tab": TAB}}


def _truthy(v: str) -> bool:
    """packetTruthy_."""
    return gsjs.trim(v).lower() in ("true", "yes", "y", "1")


# ---- the imported sheets (Studio.gs) ------------------------------------------------------------------------------

def resources_list(sess: L.Session, payload: dict) -> dict[str, Any]:
    """resourcesList: the imported sheets the hub_resources tab registers."""
    refused = admin_refused(sess.reads, sess.user, "resourcesList")
    if refused:
        return refused
    v = view(sess.reads, sess.user, RESOURCES_TAB)
    if not v.exists:
        return {"status": 200, "data": []}
    return {"status": 200, "data": [{"resource_id": s_(r.get("resourceid")),
                                     "spreadsheet_id": s_(r.get("spreadsheetid")), "tab": s_(r.get("tabname")),
                                     "label": s_(r.get("label")), "created_at": s_(r.get("createdat"))}
                                    for r in normalized(v)]}


def sheet_id_from_url(given: Any) -> str:
    """sheetIdFromUrl_."""
    s = s_(given)
    m = _SHEET_URL.search(s)
    if m:
        return m.group(1)
    return s if _SHEET_ID.fullmatch(s) else ""


def book_tabs(reads: L.Reads, sid: str) -> list[hubdb.TabRef]:
    """The tabs asa-hub-db holds of a spreadsheet, as its catalog lists them."""
    return [ref for (s, _t), ref in reads.db.catalog()["tabs"].items() if s == sid]


def _last_row(reads: L.Reads, ref: hubdb.TabRef) -> int:
    """getLastRow(): the last sheet row the copy holds."""
    if not re.fullmatch(r"[a-z0-9_]{1,63}", ref.table):
        raise hubdb.Unreadable(f"the catalog names an unusable table for {ref.tab}")
    got = reads.db.query(f'select coalesce(max(row_number), 0) from {reads.db.from_sql(ref)}')  # noqa: S608
    return max(int(got[0][0] or 0), 1 if ref.headers else 0)


def sheet_inspect(sess: L.Session, payload: dict) -> dict[str, Any]:
    """sheetInspect: a spreadsheet's title and, per tab, its first row's headers and how many rows follow — as
    asa-hub-db's copy holds it; a book the copy does not hold is one this account cannot open."""
    reads = sess.reads
    refused = admin_refused(reads, sess.user, "sheetInspect")
    if refused:
        return refused
    p = payload if isinstance(payload, dict) else {}
    sid = sheet_id_from_url(p.get("url"))
    if not sid:
        return {"status": 400, "message": "Paste a Google Sheets URL (or its id)."}
    book = reads.db.book(sid)
    if book is None:
        return {"status": 403, "message": COULD_NOT_OPEN}
    reads.db.note_book(sid)
    tabs = [{"name": ref.tab, "headers": [h for h in (gsjs.trim(hubdb.twin_base(gsjs.js_str(x))) for x in ref.headers)
                                          if h],
             "rows": max(0, _last_row(reads, ref) - 1)} for ref in book_tabs(reads, sid)]
    return {"status": 200, "data": {"spreadsheet_id": sid, "title": book.name, "tabs": tabs}}


# ---- the generic resource `apps` (Main.gs route: readOnly, clientOpen) --------------------------------------------

def _q_matches(row: dict, q: str) -> bool:
    for v in row.values():
        if v is None:
            continue
        s = CR.js_json(v) if isinstance(v, (dict, list)) else gsjs.js_str(v)
        if q in s.lower():
            return True
    return False


def _int(v: Any) -> int | None:
    """parseInt(v, 10); None for NaN."""
    n = CND.js_parse_int(v)
    return None if n != n else int(n)


def list_rows(rows: list[dict], p: dict) -> list[dict]:
    """listRows_: a full-text q, then offset and limit."""
    q = "" if p.get("q") is None else gsjs.trim(gsjs.js_str(p.get("q"))).lower()
    if q:
        rows = [r for r in rows if _q_matches(r, q)]
    offset = _int(p.get("offset"))
    offset = 0 if offset is None or offset < 0 else offset
    limit = _int(p.get("limit"))
    return rows[offset:] if limit is None or limit < 0 else rows[offset:offset + limit]


def _client(user: dict) -> bool:
    """A client, or an SSA or a FAMILY whatever its role says (scope.role_counts)."""
    return not user.get("is_service") and (s_(user.get("role")) == "client"
                                           or not sc.role_counts(user.get("types"), user.get("role")))


def _arg(p: dict, key: str) -> str:
    """payload[key] as a string concatenation spells it."""
    return gsjs.js_str(p[key]) if key in p else "undefined"


def sheetdb_view(reads: L.Reads, user: dict | None, resource: str, touch: Touch) -> View:
    """sheetFor_(resource): the tab, made with id, createdAt and updatedAt on first touch."""
    v = view(reads, user, resource)
    if not v.exists and declared_gone(reads, resource) and not born_here(reads, v.sid, resource):
        raise Held({"status": 500, "message": gone_words(resource)})
    return touch.want(v, list(SHEETDB_HEADER), [])


def generic_list(sess: L.Session, resource: str, p: dict, client_open: bool) -> dict[str, Any]:
    """route(resource, 'list'): listRows_; a client reads it whole only where it is open; away, the place's rows."""
    reads, user = sess.reads, sess.user or {}
    touch = Touch()
    rows = list_rows(read_all(sheetdb_view(reads, user, resource, touch)), p)
    touch.queue("list")
    if _client(user) and not client_open:
        rows = []
    where_id = here(reads, user)
    if where_id:
        rows = [r for r in rows if visible(where_id, r.get("tenant"))]
    return {"status": 200, "data": rows}


def generic_get(sess: L.Session, resource: str, p: dict, client_open: bool) -> dict[str, Any]:
    """route(resource, 'get'): requireRow_; another place's row, or a client's not their own, is not here."""
    reads, user = sess.reads, sess.user or {}
    touch = Touch()
    got = require_row(sheetdb_view(reads, user, resource, touch), p.get("id"), resource)
    touch.queue("get")
    if "error" in got:
        return got["error"]
    missing = {"status": 404, "message": f'No row "{_arg(p, "id")}" in {resource}.'}
    if not visible(here(reads, user), got.get("tenant")) or (_client(user) and not client_open):
        return missing
    return {"status": 200, "data": got}


def apps_list(sess: L.Session, payload: dict) -> dict[str, Any]:
    """route('apps', 'list'): the resource is open to a client; an app Settings › My Work keeps to the master is not
    listed to anyone else."""
    import sheet_resources as SR  # noqa: PLC0415 - its catalogue names the apps it hides
    got = generic_list(sess, APPS_TAB, payload if isinstance(payload, dict) else {}, True)
    if got.get("status") == 200 and isinstance(got.get("data"), list):
        got = {**got, "data": [r for r in got["data"] if not SR.hidden_app(sess, s_((r or {}).get("id")))]}
    return got


def apps_get(sess: L.Session, payload: dict) -> dict[str, Any]:
    """route('apps', 'get'); an app kept to the master is not here for anyone else."""
    import sheet_resources as SR  # noqa: PLC0415 - its catalogue names the apps it hides
    got = generic_get(sess, APPS_TAB, payload if isinstance(payload, dict) else {}, True)
    if got.get("status") == 200 and SR.hidden_app(sess, s_((got.get("data") or {}).get("id"))):
        return {"status": 404, "message": f'No row "{_arg(payload if isinstance(payload, dict) else {}, "id")}" in {APPS_TAB}.'}
    return got


# ---- route()'s other names: the imports (hub_resources) and the tabs app_builder names (Main.gs) -------------------

def resource_of(payload: Any) -> tuple[str, dict]:
    """The resource the relay's envelope names, and the screen's own payload."""
    p = dict(payload) if isinstance(payload, dict) else {}
    env = p.pop("_envelope", None)
    return (s_(env.get("resource")) if isinstance(env, dict) else ""), p


def dynamic(reads: L.Reads, user: dict | None) -> dict[str, dict]:
    """hubDynamicResources_: each import by its resource id, off the copy with the ops on their way (an import answers
    at once)."""
    out: dict[str, dict] = {}
    for r in normalized(view(reads, user, RESOURCES_TAB)):
        rid = s_(r.get("resourceid"))
        if rid:
            out[rid] = {"sid": s_(r.get("spreadsheetid")), "tab": s_(r.get("tabname")),
                        "row_limit": ST.int0(s_(r.get("rowlimit"))), "tenant": s_(r.get("tenant"))}
    return out


def registered(reads: L.Reads, user: dict | None) -> list[str]:
    """appBuilderRegisterResources_: each enabled app_builder row's resource, once, that no coded resource names."""
    v = view(reads, user, TAB)
    res_h = next((h for h in v.header if gsjs.trim(gsjs.or_blank(h)) == "resource"), None)
    on_h = next((h for h in v.header if gsjs.trim(gsjs.or_blank(h)) == "enabled"), None)
    if res_h is None:
        return []
    names: list[str] = []
    for row in v.rows:
        if on_h is not None and not _truthy(gsjs.or_text(value(row.get(on_h))) or "TRUE"):
            continue
        name = gsjs.trim(gsjs.or_text(value(row.get(res_h))))
        if name and name not in names:
            names.append(name)
    return [n for n in names if n not in CODED]


def target(reads: L.Reads, user: dict | None, resource: str) -> tuple[str, Any]:
    """route() past its adapters for a name Main.gs does not code: an import first, then a tab app_builder names."""
    dyn = dynamic(reads, user).get(resource)
    if dyn is not None:
        return "dyn", dyn
    names = registered(reads, user)
    return ("builder", None) if resource in names else ("unknown", names)


def unknown(resource: str, names: list[str]) -> dict[str, Any]:
    return {"status": 404, "message": f'Unknown resource: "{resource}". Valid resources: '
                                      + ", ".join(list(CODED) + names) + "."}


def _dyn_ref(reads: L.Reads, user: dict | None, dyn: dict) -> tuple[hubdb.TabRef, bool]:
    """readTabRawKeys_'s tab: the platform's own book through its router, any other by name (or its house's Data)."""
    sid, tab = dyn["sid"], dyn["tab"]
    hub_book = bool(sid) and sid == reads.db.prop("HUB_DB_ID")
    ref = None
    if hub_book:
        try:
            ref = where(reads, user, tab)[2]
        except (Facts, hubdb.Unreadable):
            ref = None
    if ref is None and sid:
        ref = reads.db.tab(sid, tab)
        if ref is None and reads.db.house_id(tab) == sid:
            ref = reads.db.tab(sid, hubdb.HOUSE_DATA_TAB)
    if ref is None:
        raise Held({"status": 500, "message": f"Internal error: Tab missing: {tab}"})
    reads.db.note_book(ref.sheet_id)
    return ref, hub_book


def _dyn_obj(ref: hubdb.TabRef, raw: Any, hub_book: bool) -> dict[str, Any]:
    """One row keyed by the header as written (a repeated name, its last column); a Date as the book's time reads it."""
    raw = json.loads(raw) if isinstance(raw, str) else (raw if isinstance(raw, dict) else {})
    obj: dict[str, Any] = {}
    for h in ref.headers:
        name = gsjs.trim(gsjs.js_str(h))
        if not name or hubdb.TWIN_KEY.fullmatch(name):
            continue
        t = value(raw.get(h))
        if isinstance(t, (gsjs.SheetDate, hubdb.SheetTime)):
            t = hubdb.cell_text(t) if hub_book else hubdb.estate_cell(t)
        obj[name] = t
    return obj




def _streamed(reads: L.Reads, sql: str, params: tuple, keep: Callable[[Any], bool]) -> None:
    """The rows of a query through a server-side cursor, each handed to `keep` until it says stop: never more of a
    big copy in this process than `keep` holds."""
    conn = reads.db.conn()
    try:
        with conn.transaction():
            with conn.cursor(name="ab_" + uuid.uuid4().hex[:12]) as c:
                c.itersize = DYN_FETCH
                c.execute(sql, params)
                for row in c:
                    if not keep(row):
                        break
    except Exception as exc:  # noqa: BLE001 - the database not answering is said, never an empty answer
        raise hubdb.Unreadable(f"asa-hub-db did not answer ({type(exc).__name__})") from exc


def dyn_rows(reads: L.Reads, ref: hubdb.TabRef, hub_book: bool, want: int) -> tuple[list[dict], int, bool]:
    """dynRoute_'s rows (an id of their own, else _r<n>), the newest `want` when asked — at most DYN_MAX_ROWS rows or
    DYN_MAX_BYTES of JSON, the limits Apps Script's own answer could never pass: (the rows in sheet order, how many
    the copy holds, whether the ceiling cut them)."""
    t = reads.db.from_sql(ref)
    total = int(reads.db.query(f"select count(*) from {t}")[0][0] or 0)  # noqa: S608
    asked = 0 < want <= DYN_MAX_ROWS
    cap = want if asked else DYN_MAX_ROWS
    got: list[dict] = []
    # bytes kept, rows read, cut at the ceiling
    seen = [0, 0, False]

    def keep(row: tuple) -> bool:
        if len(got) >= cap:
            seen[2] = not asked
            return False
        obj = _dyn_obj(ref, row[1], hub_book)
        seen[1] += 1
        if all(x == "" or x is None for x in obj.values()):
            return True
        if "id" not in obj:
            obj["id"] = "_r" + str(total - seen[1] + 2)
        size = len(json.dumps(obj, ensure_ascii=False, default=str)) + 1
        if got and seen[0] + size > DYN_MAX_BYTES:
            seen[2] = True
            return False
        seen[0] += size
        got.append(obj)
        return True

    _streamed(reads, f"select row_number, _raw from {t} order by row_number desc", (), keep)  # noqa: S608
    return list(reversed(got)), total, seen[2]


def dyn_row(reads: L.Reads, ref: hubdb.TabRef, hub_book: bool, want: str) -> dict | None:
    """dynRoute_'s get: the first row whose id (or _r<n>) is the id asked, its column streamed until found."""
    t = reads.db.from_sql(ref)
    key = next((h for h in ref.headers if gsjs.trim(gsjs.js_str(h)) == "id"), None)
    if key is None:
        m = re.fullmatch(r"_r(\d+)", want)
        if not m or int(m.group(1)) < 2:
            return None
        got = reads.db.query(f"select row_number, _raw from {t} order by row_number offset %s limit 1",  # noqa: S608
                             (int(m.group(1)) - 2,))
        if not got:
            return None
        return {**_dyn_obj(ref, got[0][1], hub_book), "id": want}
    hit: list[int] = []

    def keep(row: tuple) -> bool:
        if gsjs.or_blank(value(row[1])) == want:
            hit.append(row[0])
            return False
        return True

    _streamed(reads, f"select row_number, _raw ->> %s from {t} order by row_number", (key,), keep)  # noqa: S608
    if not hit:
        return None
    got = reads.db.query(f"select _raw from {t} where row_number = %s", (hit[0],))  # noqa: S608
    return _dyn_obj(ref, got[0][0], hub_book) if got else None


def dyn_answer(sess: L.Session, resource: str, dyn: dict, verb: str, p: dict) -> dict[str, Any]:
    """route() for an import: another place's is unknown here, the system log is a writer's; dynRoute_ answers list
    and get (read-only), then a client's narrowing (an import is open to no client)."""
    reads, user = sess.reads, sess.user or {}
    if not visible(here(reads, user), dyn["tenant"]):
        return {"status": 404, "message": f'Unknown resource: "{resource}".'}
    if resource == SYSTEM_LOGS and s_(user.get("role")) not in ("admin", "manager"):
        return {"status": 403, "message": "System logs are for admins and managers."}
    if verb not in ("list", "get"):
        return {"status": 405, "message": READ_ONLY_IMPORT}
    ref, hub_book = _dyn_ref(reads, user, dyn)
    if verb == "list":
        want = _int(p.get("limit")) or dyn["row_limit"] or 0
        rows, total, cut = dyn_rows(reads, ref, hub_book, want)
        if _client(user) and rows:
            return {"status": 200, "data": []}
        # cut at the ceiling: the newest rows that fit, and how many there are, for the screen to page
        return {"status": 200, "data": rows, "truncated": True, "total": total} if cut else \
            {"status": 200, "data": rows}
    row = dyn_row(reads, ref, hub_book, _arg(p, "id"))
    if row is None:
        return {"status": 404, "message": f'No record "{_arg(p, "id")}".'}
    if _client(user):
        return {"status": 404, "message": f'No row "{resource}" here.'}
    return {"status": 200, "data": row}


def _generic_read(verb: str) -> Callable[[L.Session, dict], dict[str, Any]]:
    def door(sess: L.Session, payload: dict) -> dict[str, Any]:
        resource, p = resource_of(payload)
        if resource in CODED:
            return {"status": 500, "message": f'Internal error: "{resource}" is a coded resource.'}
        kind, got = target(sess.reads, sess.user, resource)
        if kind == "dyn":
            return dyn_answer(sess, resource, got, verb, p)
        if kind == "unknown":
            return unknown(resource, got)
        return (generic_list if verb == "list" else generic_get)(sess, resource, p, False)
    door.__doc__ = f"route(resource, '{verb}') for an import or a tab app_builder names."
    return door


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {a: answering(door, lambda env: env) for a, door in {
    "appsBuilt": apps_built, "resourcesList": resources_list, "sheetInspect": sheet_inspect, "appsList": apps_list,
    "appsGet": apps_get, "builderList": _generic_read("list"), "builderGet": _generic_read("get")}.items()}
# the declared roles answer in the doors, after the place law
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
