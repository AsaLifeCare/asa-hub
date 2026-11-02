"""The read paths that answered by session role alone now ask App Control (the operator's access sheet of 2026-10-29),
on the live copy in asa-hub-db with App Control's rows laid in memory, then over the real accounts and rows:
- the slices app/slice_gate.py names (people, candidates, talentPool, potentialClients, clients, isps, drAppointments,
  uiIncidents, houses, workOrders, photos) open whole only to the master, or to a viewer an owning row or a reading
  app's row opens every row to — through /auth (front_door.gate), the bang (/bundle) and a place (/place), the doors
  driven end to end on a stand-in for fastapi; a slice not named still answers its roles alone;
- potentialClientsList / potentialClientsGet answer whom Client Candidates' row opens (client_candidates.viewer);
- Time Reconciliation's reads (reconRuns, reconErrors, reconShiftsForDate, the generic reconErrors*/reconRuns*/
  timePunches* rows and the lanes' recon_gate.may_read) ask Scheduling's Time Reconciliation row or the app's own
  before the admin, manager or Review edition reader — never widened;
- the master (with no row written at all) and Ty Bond (PLATFORMLEAD) lose nothing.
Nothing is written: every door asked here is a read.

From the repo root:

    RUNNER=<scratchpad> python3 tools/test-role-only-reads.py
"""
import json
import os
import subprocess
import sys

if not os.environ.get("ROLE_ONLY_READS_INPROC"):
    runner = os.environ["RUNNER"]
    here = os.path.join(runner, "test_role_only_reads.py")
    with open(here, "w", encoding="utf-8") as fh, open(__file__, encoding="utf-8") as me:
        fh.write(me.read())
    env = {"ROLE_ONLY_READS_INPROC": "1"}
    with open(os.path.join("app", "ist_config_defaults.json"), encoding="utf-8") as fh:
        env["HUB_IST_CONFIG_DECLARATION_JSON"] = fh.read()
    with open(os.path.join("app", "front_door_routes.json"), encoding="utf-8") as fh:
        env["ROUTES_TEXT"] = fh.read()
    with open(os.path.join("public", "snapshot-manifest.json"), encoding="utf-8") as fh:
        env["MANIFEST_TEXT"] = fh.read()
    env_file = os.path.join(runner, "test_role_only_reads.env.json")
    with open(env_file, "w", encoding="utf-8") as fh:
        json.dump(env, fh)
    out = subprocess.run(["sh", os.path.join(runner, "run.sh"), os.path.abspath("app"), here, "@" + env_file],
                         capture_output=True, text=True, timeout=900)
    sys.stdout.write(out.stdout[-6000:])
    sys.stderr.write(out.stderr[-3000:])
    sys.exit(1 if out.returncode or '"failed": []' not in out.stdout else 0)

import asyncio  # noqa: E402
import logging  # noqa: E402
import tempfile  # noqa: E402
import types  # noqa: E402
from pathlib import Path  # noqa: E402

logging.disable(logging.CRITICAL)
WORK = Path(tempfile.mkdtemp(prefix="role-only-reads-"))
(WORK / "front_door_routes.json").write_text(os.environ["ROUTES_TEXT"], encoding="utf-8")
(WORK / "snapshot-manifest.json").write_text(os.environ["MANIFEST_TEXT"], encoding="utf-8")
os.environ.update({"HUB_FRONT_DOOR_ROUTES": str(WORK / "front_door_routes.json"),
                   "HUB_SNAPSHOT_MANIFEST": str(WORK / "snapshot-manifest.json")})


# the runner carries no fastapi: the three names the front door, the lanes and the bang use
class _Response:
    def __init__(self, content=b"", status_code=200, media_type=None, headers=None):
        self.body = content.encode() if isinstance(content, str) else (content or b"")
        self.status_code = status_code


async def _in_thread(fn, *args, **kwargs):
    return fn(*args, **kwargs)


_fa = types.ModuleType("fastapi")
_fa.Request = object
_fr = types.ModuleType("fastapi.responses")
_fr.Response = _Response
_fr.JSONResponse = _Response
_st = types.ModuleType("starlette")
_sc = types.ModuleType("starlette.concurrency")
_sc.run_in_threadpool = _in_thread
sys.modules.update({"fastapi": _fa, "fastapi.responses": _fr, "starlette": _st, "starlette.concurrency": _sc})

import front_door as FD  # noqa: E402
import gsjs  # noqa: E402
import hubdb  # noqa: E402
import live_bundle as LB  # noqa: E402
import locations as L  # noqa: E402
import potential_clients as PC  # noqa: E402
import recon as R  # noqa: E402
import recon_gate as RG  # noqa: E402
import scope as sc  # noqa: E402
import sheet_resources as SR  # noqa: E402
import slice_gate as SG  # noqa: E402

results: dict[str, str] = {}
facts: dict[str, object] = {}


def check(name: str, ok: bool, why: object = "") -> None:
    results[name] = "ok" if ok else f"FAIL {str(why)[:300]}"


MANIFEST = [e for e in json.loads(os.environ["MANIFEST_TEXT"])["resources"] if e.get("mode") != "live"]
APPS = SG.apps_of(MANIFEST)
NAMED = sorted(SG.OWNERS)
LEADS = ["DIRECTOR", "PLATFORMLEAD", "ADMIN", "ADMINISTRATOR", "SUPERVISOR"]
# App Control as the sheet's rows write it (the rows of the apps that read the slices are left unwritten: theirs is
# the master's alone, as My Work keeps them)
SHEET = {"staff-profiles.team": LEADS, "staff-candidates": LEADS + ["INTERVIEWER"],
         "client-candidates": LEADS + ["INTERVIEWER", "MANAGER"],
         "client-profiles": LEADS + ["HM", "TEAMLEAD", "STAFF", "INTERVIEWER", "MANAGER", "ENTITY", "GUARDIAN",
                                     "CLIENT"],
         "locations": LEADS + ["HM", "TEAMLEAD", "STAFF", "INTERVIEWER", "MANAGER", "ENTITY"],
         "scheduling.timeReconciliation": LEADS}
LAID = {"rules": dict(SHEET), "config": {}, "unreadable": False}
_live_rules = L.Reads.app_rules
_live_config = L.Reads.config


def _rules(self):
    if LAID["unreadable"]:
        raise hubdb.Unreadable("App Control's badge rows are not in asa-hub-db")
    return {"rules": dict(LAID["rules"]), "tenants": {}}


L.Reads.app_rules = _rules
L.Reads.config = lambda self: dict(LAID["config"])

db = hubdb.HubDb()


def account(uid: str, types_: str, role: str = "staff", **more) -> dict:
    row = {"userid": uid, "email": f"{uid.lower()}@example.invalid", "displayname": "Test " + uid, "role": role,
           "types": types_, "permoverrides": "{}", **more}
    return sc.user_from_row(row)


def session(user: dict) -> L.Session:
    return L.Session(L.Reads(db, None), user)


DSP = account("T-DSP", "STAFF")
HM = account("T-HM", "HM")
TL = account("T-TL", "TEAMLEAD")
SUP = account("T-SUP", "SUPERVISOR")
DIR = account("T-DIR", "DIRECTOR", "admin")
PL = account("T-PL", "PLATFORMLEAD", "admin")
IV = account("T-IV", "", "interviewer")
MGR = account("T-MGR", "", "manager")
CLI = account("T-CLI", "CLIENT", "client", clientkey="CLIENT_NOBODY")
GRD = account("T-GRD", "GUARDIAN")
raw_master = next((u for u in L.Reads(db, None).users() if sc.is_master_email(u.get("email"))), None)
MASTER = sc.user_from_row(raw_master) if raw_master else None
check("the master's account is on the copy", MASTER is not None and sc.is_real_master(MASTER))
PEOPLE = {u["id"]: u for u in (DSP, HM, TL, SUP, DIR, PL, IV, MGR, CLI, GRD, MASTER) if u}


def opened(user: dict) -> set[str]:
    sess = session(user)
    return {r for r in NAMED if SG.opens(sess, r, APPS.get(r, ()))}


# ---- 1. the slices: who opens which, App Control's rows laid ---------------------------------------------------------

CLIENT_SIDE = {"clients", "isps", "drAppointments", "houses", "photos"}
HIRING = {"people", "candidates", "talentPool", "potentialClients"}
for who, u in (("a DSP", DSP), ("a House Manager", HM), ("a Team Lead", TL)):
    got = opened(u)
    check(f"{who}: the roster, the candidates and the referrals stay shut", not (got & HIRING), sorted(got))
    check(f"{who}: the clients, the plans, the doctor dates, the houses and the roster's faces open (Clients and "
          "Locations name them)", CLIENT_SIDE <= got, sorted(got))
    check(f"{who}: the incident log and the work orders stay shut (no row of theirs names an app reading them)",
          not (got & {"uiIncidents", "workOrders"}), sorted(got))
for who, u in (("a Supervisor (role staff)", SUP), ("a Director", DIR), ("a Platform Lead", PL)):
    got = opened(u)
    check(f"{who}: the roster, the candidates, the referrals and the client side open",
          (HIRING | CLIENT_SIDE) <= got, sorted(got))
got = opened(IV)
check("the interviewer role: the candidates, the pool and the referrals; never the roster",
      {"candidates", "talentPool", "potentialClients"} <= got and "people" not in got, sorted(got))
got = opened(MGR)
check("the manager role with no badge: the referrals (Client Candidates names MANAGER), never the candidates",
      "potentialClients" in got and not (got & {"candidates", "talentPool", "people"}), sorted(got))
check("a client: no slice whole (Clients opens their own client alone)", opened(CLI) == set(), sorted(opened(CLI)))
check("a GUARDIAN worn on a staff account: no slice (a view only the SSA records can settle stays shut)",
      opened(GRD) == set(), sorted(opened(GRD)))
check("a slice not named here still answers its roles alone", SG.opens(session(CLI), "events", ["calendar"]) is True)
denied = account("T-SUP2", "SUPERVISOR", appdenials=json.dumps(["staff-candidates"]))
check("an app removed from the account in App Control shuts its slices",
      "candidates" not in opened(denied) and "potentialClients" in opened(denied), sorted(opened(denied)))
LAID["config"] = {sc.MYWORK_APPS_KEY: "client-profiles, locations"}
got = opened(DSP)
check("an owning app My Work keeps to the master shuts its slices", not (got & CLIENT_SIDE), sorted(got))
LAID["config"] = {}
LAID["rules"] = {}
check("the master: every slice open with no row written at all", MASTER is not None and opened(MASTER) == set(NAMED),
      sorted(opened(MASTER)) if MASTER else "")
check("anyone else: no slice open with no row written", opened(DIR) == set(), sorted(opened(DIR)))
LAID["rules"] = dict(SHEET)


# ---- 2. the doors: /auth, the bang and a place, end to end ----------------------------------------------------------

class Request:
    def __init__(self, token: str, uri: str = "", query: dict | None = None):
        self.headers = {"authorization": "Bearer " + token, "x-original-uri": uri}
        self.query_params = query or {}


SESSIONS = {"tok-dsp": FD.Session(ok=True, role="staff", uid="T-DSP"),
            "tok-sup": FD.Session(ok=True, role="staff", uid="T-SUP"),
            "tok-cli": FD.Session(ok=True, role="client", uid="T-CLI"),
            "tok-mgr": FD.Session(ok=True, role="manager", uid="T-MGR"),
            "tok-master": FD.Session(ok=True, role="admin", uid=(MASTER or {}).get("id", ""), is_master=True)}
CALLER = {"raise": False}


async def _session(token):
    return SESSIONS.get(token)


def _caller(said, reads, action="", module=None):
    if CALLER["raise"]:
        raise sc.Defer("the account's users row is not in asa-hub-db")
    return dict(PEOPLE[said["uid"]])


FD.session = _session
FD.M = types.SimpleNamespace(DB=db, DRIVE=None, _own=lambda: None, caller=_caller)


def gate(token: str, resource: str) -> int:
    SG._HELD.clear()
    return asyncio.run(FD.gate(Request(token, f"/snapshot/{resource}.json"))).status_code


check("/auth, a DSP: people.json 403, candidates.json 403", gate("tok-dsp", "people") == 403
      and gate("tok-dsp", "candidates") == 403, (gate("tok-dsp", "people"), gate("tok-dsp", "candidates")))
check("/auth, a DSP: clients.json and houses.json 200 (Clients and Locations name STAFF)",
      gate("tok-dsp", "clients") == 200 and gate("tok-dsp", "houses") == 200)
check("/auth, a DSP: a slice not named (events.json) still 200 on its role", gate("tok-dsp", "events") == 200)
check("/auth, a Supervisor: people, candidates, talentPool and potentialClients 200",
      all(gate("tok-sup", r) == 200 for r in HIRING), [gate("tok-sup", r) for r in sorted(HIRING)])
check("/auth, a client: people, workOrders and photos 403 (their role reached them before)",
      all(gate("tok-cli", r) == 403 for r in ("people", "workOrders", "photos")),
      [gate("tok-cli", r) for r in ("people", "workOrders", "photos")])
check("/auth, a client: a slice its role never reached is still the role's 403", gate("tok-cli", "candidates") == 403)
check("/auth, the index and the bang's address are never a slice", gate("tok-dsp", "index") == 200)
LAID["rules"] = {}
CALLER["raise"] = True
check("/auth, the master's own session: every slice 200 with no row written and no caller built",
      all(gate("tok-master", r) == 200 for r in NAMED), [gate("tok-master", r) for r in NAMED])
CALLER["raise"] = False
LAID["rules"] = dict(SHEET)
LAID["unreadable"] = True
check("/auth, App Control unreadable: a DSP's clients.json is shut", gate("tok-dsp", "clients") == 403)
check("… and nothing of it is held", not SG._HELD)
LAID["unreadable"] = False
check("… and the next ask, readable, opens it again", gate("tok-dsp", "clients") == 200)
SG._HELD.clear()
held = SG.verdicts(SESSIONS["tok-dsp"], MANIFEST)
SG.forget(frozenset({"T-DSP"}))
check("a verdict is held per session and dropped when its account is forgotten",
      held.get("clients") is True and SESSIONS["tok-dsp"] not in SG._HELD)

# the bang and a place, on slice files and a home deposit of their own
OUT = WORK / "snapshot"
OUT.mkdir()
BUNDLES = WORK / "bundles"
BUNDLES.mkdir()
for e in MANIFEST:
    (OUT / f"{e['resource']}.json").write_text(json.dumps({"rows": [{"id": "r1"}], "built_at": "2026-10-29T00:00:00Z"}))
(BUNDLES / "home.json").write_text(json.dumps({"built_at": "2026-10-29T00:00:00Z", "resources": {
    e["resource"]: [{"id": "d1"}] for e in MANIFEST}}))
LB.SLICES = types.SimpleNamespace(load_manifest=lambda: MANIFEST, OUT_DIR=OUT, lane_list=lambda name: [],
                                  lane_for=lambda place: None, traffic_note=lambda what: None)
LB.FD = FD
LB.M = FD.M
LB.BUNDLE_DIR = BUNDLES
LB.bundle_access = lambda *a, **k: {}
LB.ist_config_block = lambda role: None
LB.user_badges = lambda uid: ""
LB.calendar_badges = lambda uid: set()


def bang(token: str) -> set[str]:
    SG._HELD.clear()
    return set(json.loads(asyncio.run(LB.bundle(Request(token))).body)["slices"])


def place(token: str, tab: str = "") -> tuple[int, set[str]]:
    SG._HELD.clear()
    got = asyncio.run(LB.place(Request(token, query={"tab": tab} if tab else {})))
    body = json.loads(got.body) if got.body else {}
    return got.status_code, set(body.get("slices") or {})


role_roles = {e["resource"]: e.get("roles") or [] for e in MANIFEST}
got = bang("tok-dsp")
check("the bang, a DSP: no roster, candidates or referrals; the clients and the houses still in",
      not (got & HIRING) and {"clients", "houses"} <= got, sorted(got & set(NAMED)))
check("the bang, a DSP: every slice not named that the role reaches is still in",
      {r for r, roles in role_roles.items() if r not in SG.OWNERS and "staff" in roles} <= got)
got = bang("tok-cli")
check("the bang, a client: none of the named slices", not (got & set(NAMED)), sorted(got & set(NAMED)))
got = bang("tok-master")
check("the bang, the master: every named slice", set(NAMED) <= got, sorted(set(NAMED) - got))
code, got = place("tok-dsp")
check("a place, a DSP: neither the deposit nor the slice files hand the roster or the candidates",
      code == 200 and not (got & HIRING) and {"clients", "houses"} <= got, (code, sorted(got & set(NAMED))))
code, got = place("tok-cli")
check("a place, a client: none of the named slices", code == 200 and not (got & set(NAMED)),
      (code, sorted(got & set(NAMED))))
check("a place's one tab, a DSP: people withheld (403)", place("tok-dsp", "people")[0] == 403)
check("a place's one tab, a Supervisor: people answered (200)", place("tok-sup", "people")[0] == 200)
check("a place's one tab, the master: candidates answered (200)", place("tok-master", "candidates")[0] == 200)


# ---- 3. Potential Clients: Client Candidates' row --------------------------------------------------------------------

def status(fn, sess, payload=None):
    try:
        got = fn(sess, payload or {})
    except Exception as exc:  # noqa: BLE001 - said as the result
        return type(exc).__name__
    return got.get("status") if isinstance(got, dict) else got


some = SR.rows(L.Reads(db, None), PC.RESOURCE)
rid = gsjs.str_((some[0] if some else {}).get("id"))
facts["potentialClients rows"] = len(some)
for who, u in (("a DSP", DSP), ("a House Manager", HM), ("a Team Lead", TL), ("a client", CLI),
               ("a GUARDIAN on a staff account", GRD)):
    check(f"potentialClientsList, {who}: refused", PC.leads_list(session(u), {}) == PC.SHUT,
          PC.leads_list(session(u), {}))
    check(f"potentialClientsGet, {who}: refused", PC.leads_get(session(u), {"id": rid}) == PC.SHUT)
for who, u in (("a Supervisor", SUP), ("a Director", DIR), ("the interviewer role", IV),
               ("the manager role (Client Candidates names MANAGER)", MGR)):
    check(f"potentialClientsList, {who}: 200", status(PC.leads_list, session(u)) == 200,
          status(PC.leads_list, session(u)))
check("potentialClientsGet, a Supervisor: the row", not rid or status(PC.leads_get, session(SUP), {"id": rid}) == 200)
check("potentialClientsList, the service: 200", status(PC.leads_list, session({"is_service": True, "role": "admin",
                                                                               "id": "", "email": ""})) == 200)
check("potentialClientsList, Client Candidates removed from a Supervisor: refused",
      PC.leads_list(session(account("T-SUP3", "SUPERVISOR", appdenials=json.dumps(["client-candidates"]))), {})
      == PC.SHUT)
LAID["rules"] = {}
check("potentialClientsList, the master with no row written: 200", MASTER is not None
      and status(PC.leads_list, session(MASTER)) == 200)
check("potentialClientsList, a Director with no row written: refused", PC.leads_list(session(DIR), {}) == PC.SHUT)
LAID["rules"] = dict(SHEET)


# ---- 4. Time Reconciliation: Scheduling's row or the app's own, before the readers --------------------------------

READERS = {"status": 403, "message": RG.READERS_ONLY}
DOORS = (("reconRuns", R.recon_runs, {}), ("reconErrors", R.recon_errors, {}),
         ("reconShiftsForDate", R.shifts_for_date, {"date": "2026-10-15", "location": "ABD2005"}))
GENERIC = ("reconErrors", "reconRuns", "timePunches")


def recon_reads(u: dict) -> dict[str, object]:
    out: dict[str, object] = {name: status(fn, session(u), p) for name, fn, p in DOORS}
    out.update({r + "List": status(lambda s, p, r=r: SR.list_rows(s, r, p), session(u)) for r in GENERIC})
    return out


for who, u in (("a Director (admin)", DIR), ("a Platform Lead (admin)", PL)):
    got = recon_reads(u)
    check(f"recon, {who}: every read 200 (Scheduling's row names them)", set(got.values()) == {200}, got)
for who, u in (("the manager role with no badge the row names", MGR), ("a House Manager", HM), ("a DSP", DSP),
               ("a client", CLI)):
    got = {name: fn(session(u), p) for name, fn, p in DOORS}
    check(f"recon, {who}: reconRuns, reconErrors and reconShiftsForDate refused",
          all(v == READERS for v in got.values()), got)
    got = {r: SR.list_rows(session(u), r, {}) for r in GENERIC}
    check(f"recon, {who}: the generic {', '.join(r + 'List' for r in GENERIC)} refused alike",
          all(v == READERS for v in got.values()), got)
got = recon_reads(SUP)
check("recon, a Supervisor on role staff: reads by the badge the Time Reconciliation row names (the operator, 10-30)",
      set(got.values()) == {200}, got)
LAID["rules"] = {**SHEET, R.APP_ID: LEADS + ["MANAGER"]}
check("recon, the manager role where the app's own row names MANAGER: 200 (either row opens)",
      set(recon_reads(MGR).values()) == {200}, recon_reads(MGR))
LAID["rules"] = {**SHEET, R.APP_ID: LEADS + ["STAFF"]}
LAID["config"] = {"mywork_editions": json.dumps([{"id": "recon.review", "on": True, "people": ["T-DSP"]}])}
check("recon, a DSP the Review edition lists, the app's row naming STAFF: 200", status(R.recon_runs, session(DSP))
      == 200, status(R.recon_runs, session(DSP)))
LAID["rules"] = dict(SHEET)
check("recon, the same DSP where no row names STAFF: refused, the edition alone opens nothing",
      R.recon_runs(session(DSP), {}) == READERS)
LAID["config"] = {}
denied = account("T-DIR2", "DIRECTOR", "admin", appdenials=json.dumps([R.FEATURE]))
check("recon, a Director whom App Control removed Time Reconciliation from: refused",
      R.recon_runs(session(denied), {}) == READERS)
LAID["rules"] = {}
check("recon, the master with no row written: 200", MASTER is not None
      and status(R.recon_runs, session(MASTER)) == 200)
check("recon, the service: 200", status(R.recon_runs, session({"is_service": True, "role": "admin", "id": "",
                                                                  "email": ""})) == 200)
check("recon's lanes (recon_gate.may_read), the master's flag with no row: open",
      RG.may_read(L.Reads(db, None), MASTER, True) is True)
check("recon's lanes, a Director with no row written: shut", RG.may_read(L.Reads(db, None), DIR, False) is False)
LAID["rules"] = dict(SHEET)
check("recon's lanes, a Director under the sheet's row: open", RG.may_read(L.Reads(db, None), DIR, False) is True)
check("recon's lanes, the manager role: shut", RG.may_read(L.Reads(db, None), MGR, False) is False)


# ---- 5. live: the real accounts, App Control's real rows and My Work's real list --------------------------------------

L.Reads.app_rules = _live_rules
L.Reads.config = _live_config
live = L.Reads(db, None)
users = [sc.user_from_row(u) for u in live.users() if gsjs.str_(u.get("active")).upper() not in ("FALSE", "0", "NO")
         and not gsjs.str_(u.get("mergedinto"))]
ty = [u for u in users if "PLATFORMLEAD" in u["types"]]
facts["live accounts"] = len(users)
facts["Platform Leads"] = len(ty)
counts: dict[str, int] = {}
bad: list[str] = []
for u in users:
    sess = L.Session(live, u)
    got = {r for r in NAMED if SG.opens(sess, r, APPS.get(r, ()))}
    lead = bool(set(sc.badges_worn(u["types"], u["role"])) & set(LEADS))
    worn = set(sc.badges_worn(u["types"], u["role"]))
    for r in got:
        counts[r] = counts.get(r, 0) + 1
    if sc.is_real_master(u) or "PLATFORMLEAD" in u["types"]:
        if got != set(NAMED):
            bad.append(f"{u['id']} master/PL missing {sorted(set(NAMED) - got)}")
        if not RG.may_read(live, u, sc.is_real_master(u)):
            bad.append(f"{u['id']} master/PL refused recon")
        if PC.refused(sess) is not None:
            bad.append(f"{u['id']} master/PL refused potential clients")
        continue
    if u["role"] in ("client",) or worn <= {"CLIENT", "GUARDIAN"}:
        if got:
            bad.append(f"{u['id']} {u['role']} opens {sorted(got)}")
    if not lead and worn & {"HM", "TEAMLEAD", "STAFF"} and not worn & {"INTERVIEWER", "MANAGER"}:
        if got & HIRING:
            bad.append(f"{u['id']} {sorted(worn)} opens {sorted(got & HIRING)}")
        if PC.refused(sess) is None:
            bad.append(f"{u['id']} {sorted(worn)} reads potential clients")
        if RG.may_read(live, u, False):
            bad.append(f"{u['id']} {sorted(worn)} reads recon")
facts["live opens per slice"] = counts
check("live: the master and every Platform Lead open every named slice, potential clients and recon",
      ty and not [b for b in bad if "master/PL" in b], [b for b in bad if "master/PL" in b])
check("live: no client or family account opens a named slice", not [b for b in bad if "opens" in b and "client"
                                                                     in b], bad)
check("live: no House Manager, Team Lead or DSP opens the roster, the candidates or the referrals, nor reads "
      "potential clients or recon", not [b for b in bad if "master/PL" not in b], bad[:12])

facts["checks"] = f"{sum(v == 'ok' for v in results.values())} ok of {len(results)}"
print(json.dumps({"results": results, "failed": [k for k, v in results.items() if v != "ok"], "facts": facts},
                 indent=1, default=str))
