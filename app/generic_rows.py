"""The last of Main.gs route()'s own resources on Python: the generic list and get, each answered by the app whose rows
they are, from where that app keeps them — app.resource_rows for the tabs kept in Postgres (sheet_resources.SPECS),
the sheet's copy with Python's kept edits laid for the tabs their apps' writers keep there (sheet_resources.COPY);
the certification tracker's door that lists nothing (Certs.gs certsRoute_), the performance board (StaffPerformance.gs
staffPerfBoardRoute_) and the estate's House Inventory List (Estate.gs estateRoute_). route()'s own gates and words;
the writes are app/generic_rows_writes.py."""
from __future__ import annotations

from typing import Any, Callable

import call_offs as CO
import gsjs
import locations as L
import ops_stragglers as OS
import row_ops as RO
import sheet_resources as SR
from scope import Defer

# route()'s name → (the app that answers it, its doors' prefix, how its rows are kept, the resource they are kept as)
ROUTES: dict[str, tuple[str, str, str, str]] = {
    "commCalls": ("comm-calls", "commCallsRows", "rows", "commCalls"),
    "commWorkItems": ("comm-calls", "commWorkItemsRows", "rows", "commWorkItems"),
    "commWhen": ("comm-when", "commWhen", "rows", "commWhenHouse"),
    "psiPunches": ("hiring", "psiPunchesRows", "rows", "psiPunches"),
    "travelTrips": ("travel", "travelTrips", "rows", "travelTrips"),
    "mealLog": ("meals", "mealLog", "rows", "mealLog"),
    "mealProfile": ("meals", "mealProfile", "rows", "mealProfile"),
    "mealPlans": ("meals", "mealPlans", "rows", "mealPlans"),
    "shopperItems": ("shopper", "shopperItems", "rows", "shopperItems"),
    "shopperPrices": ("shopper", "shopperPrices", "rows", "shopperPrices"),
    "time_punches": ("time-recon", "timePunches", "rows", "timePunches"),
    "recon_runs": ("time-recon", "reconRuns", "rows", "reconRuns"),
    "recon_errors": ("time-recon", "reconErrors", "rows", "reconErrors"),
    "truelinkRuns": ("finance", "truelinkRuns", "rows", "truelinkRuns"),
    "financeBalances": ("finance", "financeBalances", "rows", "financeBalances"),
    "financeConfig": ("finance", "financeConfig", "rows", "financeConfig"),
    "learnSkills": ("learning", "learnSkills", "rows", "learnSkills"),
    "learnAttempts": ("learning", "learnAttempts", "rows", "learnAttempts"),
    "forms": ("forms", "formsRows", "rows", "forms"),
    "formSubmissions": ("forms", "formSubmissions", "rows", "formSubmissions"),
    "formAnswers": ("forms", "formAnswers", "rows", "formAnswers"),
    "formFiles": ("forms", "formFilesRows", "rows", "formFiles"),
    "quoTranscripts": ("quo", "quoTranscripts", "rows", "quoTranscripts"),
    "quoMessages": ("quo", "quoMessages", "rows", "quoMessages"),
    "quoSummaries": ("quo", "quoSummaries", "rows", "quoSummaries"),
    "smartCommsDesk": ("smart-comms", "smartCommsDesk", "rows", "smartCommsDesk"),
    "smartCommsActivity": ("smart-comms", "smartCommsActivity", "rows", "smartCommsActivity"),
    "clientNotes": ("client-care", "clientNotes", "rows", "clientNotes"),
    "marErrors": ("client-care", "marErrors", "rows", "marErrors"),
    "missingMedications": ("client-care", "missingMedications", "rows", "missingMedications"),
    "incidents": ("client-care", "incidents", "rows", "incidents"),
    "clientFiles": ("client-care", "clientFiles", "rows", "clientFiles"),
    "shifts": ("shiftboard", "shifts", "rows", "shifts"),
    "shiftCards": ("shiftboard", "shiftCards", "rows", "shiftCards"),
    "shiftMatrix": ("shiftboard", "shiftMatrix", "rows", "shiftMatrix"),
    "shiftTimeline": ("shiftboard", "shiftTimeline", "rows", "shiftTimeline"),
    "teamProjects": ("teamboard", "teamProjects", "rows", "teamProjects"),
    "inventoryItems": ("inventory", "inventoryItems", "rows", "inventoryItems"),
    "fleetVehicles": ("transportation", "fleetVehicles", "rows", "fleetVehicles"),
    "mileageLogs": ("transportation", "mileageLogs", "rows", "mileageLogs"),
    "routes": ("transportation", "routes", "rows", "routes"),
    "diseases": ("render-sheet", "diseases", "rows", "diseases"),
    "projects": ("render-sheet", "projects", "rows", "projects"),
    "leads": ("potential-clients", "leads", "rows", "leads"),
    "certMatrix": ("opsdash", "certMatrix", "certs", ""),
    "staffCerts": ("opsdash", "staffCerts", "certs", ""),
    "staffPerfBoard": ("opsdash", "staffPerfBoard", "perf", ""),
    "houseInventory": ("house-repair", "houseInventory", "estate", "houseInventory"),
}
# the books people typed into, kept in Postgres on 10-27 and worked in the Hub's pages (server/snapshot_service.py's
# GENERIC_ROUTES names the same): each kept as itself, its App Control control gating it (sheet_resources.gate)
ROUTES.update({
    **{r: ("comm-recruit", r, "rows", r) for r in (
        "recruitPipeline", "recruitOnboarding", "rbArchiveOfOnboardingChecklist", "rbResumeAnalysis",
        "rbPhoneScreenAnalysis", "rbPhoneInterviewScript", "rbTextMessages", "rbDashboard", "rbDocumentsUploaded")},
    **{r: ("staffissues", r, "rows", r) for r in (
        "dtBritt", "dtCassy", "dtNat", "dtRegina", "dtTammy", "dtTieara", "dtMonthlyDocReview", "dtNotes",
        "hrTracker")},
    **{r: ("house-repair", r, "rows", r) for r in ("repairRequests", "repairInventory")},
    "screeningNotes": ("hiring", "screeningNotes", "rows", "screeningNotes"),
    "credentials": ("staffissues", "credentials", "rows", "credentials"),
    **{r: ("hotline", r, "rows", r) for r in (
        "vbCategoryKnowledge", "vbPolicies", "vbGeneralRules", "vbSubProcess", "vbCategoryMap", "vbFollowUpsMain",
        "vbFollowUpsIncidents", "vbHomes", "vbClientNames", "vbStaffNames", "vbSchedule")},
    **{r: ("client-care", r, "rows", r) for r in (
        "mmFormResponses4", "mmFormResponses1", "mmLowRefills", "mmMedicationControl", "mmDrsMeds", "mmDrContacts",
        "mmAbnormalDeliveries")}})
VERBS = ("list", "get", "create", "update", "delete")
# the adapters that write nothing: every verb is answered as a read
READ_ONLY_KINDS = ("certs", "perf")
UNKNOWN_RESOURCE = 'Unknown resource: "{}".'
# Certs.gs certsRoute_ (FAIL-CLOSED: the generic door lists nothing)
CERTS_LIST = {"status": 403, "message": "The certification tracker is read through certTrackerList, which answers "
                                        "each person their own certifications — this door cannot tell who is asking."}
CERTS_GET = {"status": 404, "message": "Certification rows are derived — read the list."}
CERTS_WRITE = {"status": 405, "message": "Certifications are derived from the estate tracker (read-only here)."}
PERF_UNKNOWN = {"status": 400, "message": "Unknown action."}
ESTATE_INVENTORY = "houseInventory"

s_ = gsjs.str_


def door_of(resource: str, verb: str) -> str:
    return ROUTES[resource][1] + verb.title()


def _here(user: dict | None) -> str:
    """hubTenantId_: the place the session stands in, '' at headquarters."""
    return s_(((user or {}).get("place") or {}).get("tenant_id"))


# ---- the tabs kept on their copy (sheet_resources.COPY) -----------------------------------------------------------

def copy_rows(reads: L.Reads, resource: str) -> list[dict]:
    """listRows_' rows of the tab: readAll_ of the copy with Python's kept edits laid, the removals on their way taken
    out; a cell the copy withholds is never shown."""
    got = OS.rows(reads, SR.COPY[resource]["tab"])
    if CO.withheld(got):
        raise Defer("the copy withholds a cell this answer shows")
    return got


def copy_find(reads: L.Reads, resource: str, want: str) -> dict | None:
    """findRowIndex_: the first row whose id is this one."""
    return next((dict(r) for r in copy_rows(reads, resource) if gsjs.or_blank(r.get("id")) == want), None)


def copy_list(sess: L.Session, resource: str, payload: dict) -> dict[str, Any]:
    """route(resource, 'list'): listRows_ (its q, offset and limit), a personal resource's rows its owner's alone, then
    a client's narrowing."""
    refused = SR.gate(sess, resource, "list")
    if refused:
        return refused
    p = payload if isinstance(payload, dict) else {}
    got = SR.paged(copy_rows(sess.reads, resource), p)
    if SR.COPY[resource].get("owned"):
        me = SR.me_of(sess.user or {})
        got = [r for r in got if me and SR.owner_of(resource, r) == me]
    if SR._client(sess.user or {}):
        got = SR._client_rows(sess, resource, got)
    return {"status": 200, "data": got}


def copy_get(sess: L.Session, resource: str, payload: dict) -> dict[str, Any]:
    """route(resource, 'get'): requireRow_, then "not yours" reads as "not here" for a client."""
    refused = SR.gate(sess, resource, "get")
    if refused:
        return refused
    p = payload if isinstance(payload, dict) else {}
    reads = sess.reads
    owned = SR._owned(sess, resource, "get", dict(p), find=lambda rid: copy_find(reads, resource, rid))
    if owned:
        return owned
    rid = p.get("id")
    if rid is None or rid == "":
        return {"status": 400, "message": SR.NO_ID}
    want = gsjs.js_str(rid)
    hit = copy_find(reads, resource, want)
    if hit is None:
        return {"status": 404, "message": f'No "{resource}" record with id "{want}".'}
    if SR._client(sess.user or {}) and SR._client_row_refused(sess, resource, hit):
        return {"status": 404, "message": f'No row "{want}" in {resource}.'}
    return {"status": 200, "data": hit}


# ---- the adapters --------------------------------------------------------------------------------------------------

def certs_door(resource: str, verb: str) -> Callable[[L.Session, dict], dict[str, Any]]:
    """certsRoute_ behind hubAdapterPlaceGate_: away from headquarters the resource does not exist; at home the list
    is refused (it cannot tell who is asking), a row is never looked up, and nothing is written."""
    def door(sess: L.Session, payload: dict) -> dict[str, Any]:
        if _here(sess.user):
            return {"status": 404, "message": UNKNOWN_RESOURCE.format(resource)}
        return dict(CERTS_LIST if verb == "list" else CERTS_GET if verb == "get" else CERTS_WRITE)
    door.__doc__ = f"route('{resource}', '{verb}'): certsRoute_."
    return door


def perf_board_door(verb: str) -> Callable[[L.Session, dict], dict[str, Any]]:
    """staffPerfBoardRoute_: the list alone, for the relay's own identity and the admins and managers — the board
    built off the copy (staff_perf.perf_board_build), as Staff Performance builds it at every read."""
    def door(sess: L.Session, payload: dict) -> dict[str, Any]:
        import staff_perf as SPF  # noqa: PLC0415 - the board's one computation, read only here
        if verb != "list":
            return dict(PERF_UNKNOWN)
        user = sess.user or {}
        if not (user.get("is_service") or SPF.perf_is_manager(user)):
            return SPF.hub_denied()
        return {"status": 200, "data": {"rows": SPF.perf_board_build(sess.reads) or []}}
    door.__doc__ = f"route('staffPerfBoard', '{verb}'): staffPerfBoardRoute_."
    return door


def inventory_rows(reads: L.Reads) -> list[dict]:
    """estateRows_('houseInventory') as the sheet will hold it once each delete on its way is carried."""
    prop, tab = L.ESTATE_SOURCES[ESTATE_INVENTORY]
    got = RO.unremoved_estate(reads, gsjs.or_blank(reads.db.prop(prop)), tab,
                              [dict(r) for r in reads.estate(ESTATE_INVENTORY)])
    if CO.withheld(got):
        raise Defer("the copy withholds a cell this answer shows")
    return got


def _is_client(user: dict | None) -> bool:
    """A client, or an SSA or a FAMILY whatever its role says (sheet_resources._client)."""
    return SR._client(user or {})


def inventory_list(sess: L.Session, payload: dict) -> dict[str, Any]:
    """route('houseInventory', 'list'): estateRoute_'s rows narrowed by `q` across every cell; a client reads none (the
    resource declares no client — hubClientNarrowList_)."""
    if _here(sess.user):
        return {"status": 404, "message": UNKNOWN_RESOURCE.format(ESTATE_INVENTORY)}
    p = payload if isinstance(payload, dict) else {}
    rows = inventory_rows(sess.reads)
    q = gsjs.js_str(p.get("q")).lower() if not gsjs.falsy(p.get("q")) else ""
    if q:
        rows = [r for r in rows if any(q in gsjs.js_str(v).lower() for v in r.values())]
    if _is_client(sess.user) and rows:
        rows = []
    return {"status": 200, "data": rows}


def inventory_get(sess: L.Session, payload: dict) -> dict[str, Any]:
    """route('houseInventory', 'get'): one row by its id (r<sheet row>); a client is told it is not here."""
    if _here(sess.user):
        return {"status": 404, "message": UNKNOWN_RESOURCE.format(ESTATE_INVENTORY)}
    p = payload if isinstance(payload, dict) else {}
    rid = p.get("id")
    hit = next((r for r in inventory_rows(sess.reads) if r.get("id") == rid), None)
    if hit is None:
        said = gsjs.js_str(rid) if "id" in p else "undefined"
        return {"status": 404, "message": f'No row "{said}" in {ESTATE_INVENTORY}.'}
    if _is_client(sess.user):
        return {"status": 404, "message": f'No row "{ESTATE_INVENTORY}" here.'}
    return {"status": 200, "data": hit}


# ---- each app's doors ----------------------------------------------------------------------------------------------

def _rows_door(resource: str, verb: str) -> Callable[[L.Session, dict], dict[str, Any]]:
    kept = ROUTES[resource][3]
    run = SR.list_rows if verb == "list" else SR.get_row

    def door(sess: L.Session, payload: dict) -> dict[str, Any]:
        return run(sess, kept, payload)
    door.__doc__ = f"route('{resource}', '{verb}') off Postgres (sheet_resources)."
    return door


def _copy_door(resource: str, verb: str) -> Callable[[L.Session, dict], dict[str, Any]]:
    run = copy_list if verb == "list" else copy_get

    def door(sess: L.Session, payload: dict) -> dict[str, Any]:
        return run(sess, resource, payload)
    door.__doc__ = f"route('{resource}', '{verb}') off the copy, Python's kept edits laid."
    return door


def _reads_of(resource: str) -> dict[str, Callable[[L.Session, dict], dict[str, Any]]]:
    kind = ROUTES[resource][2]
    if kind == "certs":
        return {door_of(resource, v): certs_door(resource, v) for v in VERBS}
    if kind == "perf":
        return {door_of(resource, v): perf_board_door(v) for v in VERBS}
    if kind == "estate":
        return {door_of(resource, "list"): inventory_list, door_of(resource, "get"): inventory_get}
    make = _rows_door if kind == "rows" else _copy_door
    return {door_of(resource, v): make(resource, v) for v in ("list", "get")}


READS_OF: dict[str, dict[str, Callable[[L.Session, dict], dict[str, Any]]]] = {}
for _res, (_app, _pre, _kind, _kept) in ROUTES.items():
    READS_OF.setdefault(_app, {}).update(_reads_of(_res))
# the generic verbs declare no roles; each door's own gate decides
POLICY_OF: dict[str, dict[str, dict[str, Any]]] = {a: {d: {} for d in doors} for a, doors in READS_OF.items()}
# the doors that answer away from headquarters as route() does (the adapters' place gate is their own)
PLACE_SAFE_OF: dict[str, frozenset[str]] = {
    "opsdash": frozenset(door_of(r, v) for r in ("certMatrix", "staffCerts", "staffPerfBoard") for v in VERBS),
    "house-repair": frozenset(door_of(ESTATE_INVENTORY, v) for v in VERBS)}
