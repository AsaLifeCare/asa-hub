#!/usr/bin/env python3
"""Transportation's writes and editions decided by the streamed modules on real subjects in asa-hub-db-sync: the master,
a person not listed, a listed person (editions and App Control's release simulated), the former hand-offs to Apps Script
(each final now), and the exact app.edits rows each final write keeps. Nothing real is written: the edit store lives in temp tables inside
one transaction rolled back at the end. Prints shapes, counts and masked rows only."""
from __future__ import annotations

import base64
import json
import py_compile
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DB_RUNNER = "asa-hub-db-sync"

# the reads module's parts the writes call, used only while app/transportation.py is not in this tree
STAND_IN = r'''
"""A stand-in for the Transportation reads module: the parts the writes call, off the copy."""
import json
import gsjs, scope as sc
import transportation_writes as TW

APP_ID = "vehicle-calendar"
ROLES = ("admin", "director", "manager", "staff")


def live(u):
    off = gsjs.str_(u.get("active")).upper()
    return off not in ("FALSE", "0", "NO") and not gsjs.str_(u.get("mergedinto"))


def settings(reads):
    def read():
        kv = {r["key"]: r.get("value", "") for r in TW.tab_rows(reads, "vc_settings")}
        types = TW.trip_types_value(kv.get("trip_types") or "")
        directors = []
        users = [u for u in reads.users() if live(u)]
        for e in [x.strip().lower() for x in gsjs.or_blank(kv.get("directors")).replace(";", ",").split(",") if "@" in x]:
            u = next((u for u in users if gsjs.str_(u.get("email")).lower() == e), None)
            if u and not any(d["uid"] == gsjs.str_(u.get("userid")) for d in directors):
                directors.append({"email": e, "uid": gsjs.str_(u.get("userid")), "name": gsjs.str_(u.get("displayname"))})
        return {"readable": True, "directors": directors, "directors_readable": bool(directors),
                "trip_types": json.loads(types["value"]) if types.get("value") else [], "raw": kv}
    return reads.once("standin:settings", read)


def people(reads):
    def read():
        seen = {}
        for u in reads.users():
            if not live(u) or gsjs.str_(u.get("role")).lower() not in ROLES:
                continue
            key, uid = gsjs.name_key(u.get("displayname")), gsjs.str_(u.get("userid"))
            if key and uid:
                seen.setdefault(key, []).append({"key": key, "uid": uid, "name": gsjs.str_(u.get("displayname"))})
        rows = [v[0] for v in seen.values() if len(v) == 1]
        return {"readable": True, "why": "", "rows": rows, "by_key": {p["key"]: p for p in rows},
                "by_uid": {p["uid"]: p for p in rows}}
    return reads.once("standin:people", read)


def clients(reads):
    return {"readable": False, "why": "the stand-in reads no roster", "rows": []}


def drivers(reads, keys):
    return {"readable": False, "why": "the stand-in reads no driving record", "map": {}}


def gate(sess):
    user = sess.user or {}
    got = sc.profile_app_gate(APP_ID, user, sess.reads.scope_sources())
    g = {"open": bool(got.get("open")), "uid": gsjs.str_(user.get("id")), "name": gsjs.str_(user.get("display_name")),
         "email": gsjs.str_(user.get("email")).lower(), "visiting": bool(user.get("visiting_member")),
         "is_master": sc.is_real_master(user), "key": ""}
    if not g["open"]:
        return {"open": False}
    g["is_director"] = any(d["uid"] == g["uid"] for d in settings(sess.reads)["directors"])
    g["can_edit"] = g["is_master"] or g["is_director"]
    me = people(sess.reads)["by_uid"].get(g["uid"])
    g["key"] = me["key"] if me else ""
    return g


def client_gate(sess, g, client):
    return g
'''

DRIVER = r'''
import base64, importlib.abc, importlib.util, json, re, sys, time, types, uuid
blob = json.loads(base64.b64decode(sys.stdin.readline()).decode())
SRC = blob["app"]


class Checkout(importlib.abc.MetaPathFinder, importlib.abc.Loader):
    def find_spec(self, name, path, target=None):
        return importlib.util.spec_from_loader(name, self, origin="checkout:" + name) if name in SRC else None

    def create_module(self, spec):
        return None

    def exec_module(self, module):
        module.__file__ = module.__name__ + ".py"
        exec(compile(SRC[module.__name__], module.__name__ + ".py", "exec"), module.__dict__)


sys.meta_path.insert(0, Checkout())
fake = types.ModuleType("fastapi")


class Resp:
    def __init__(self, content=b"", status_code=200, media_type="", headers=None):
        self.body = content if isinstance(content, (bytes, str)) else json.dumps(content)
        self.status_code, self.headers = status_code, dict(headers or {})


class App:
    def __init__(self, **_kw):
        pass

    def _route(self, *_a, **_kw):
        return lambda fn: fn
    get = post = _route


fake.FastAPI, fake.Request = App, object
responses = types.ModuleType("fastapi.responses")
responses.JSONResponse = lambda content, status_code=200, headers=None: Resp(content, status_code, "", headers)
responses.Response = Resp
conc = types.ModuleType("starlette.concurrency")


async def run_in_threadpool(fn, *a, **kw):
    return fn(*a, **kw)
conc.run_in_threadpool = run_in_threadpool
sys.modules.update({"fastapi": fake, "fastapi.responses": responses, "starlette": types.ModuleType("starlette"),
                    "starlette.concurrency": conc})

import psycopg
import gsjs, hubdb, scope as sc, locations as L, writes as W, client_writes as CW
import transportation_writes as TW
import main as M

out, facts, rows_out = [], {}, []


def check(name, ok, detail=""):
    out.append([name, bool(ok), "" if ok else str(detail)[:400]])


W.EDITS_TABLE = "pg_temp.hub_edits_trw"
W.LOCK_KEY = 0x5452574348


def rw(sql):
    return sql.replace("app.check_", "pg_temp.check_") if isinstance(sql, str) else sql


class Cur:
    def __init__(self, cur):
        self.c = cur

    def execute(self, sql, params=None):
        self.c.execute(rw(sql), params)
        return self

    def executemany(self, sql, rows):
        self.c.executemany(rw(sql), rows)
        return self

    def fetchone(self):
        return self.c.fetchone()

    def fetchall(self):
        return self.c.fetchall()


class Conn:
    def __init__(self, real):
        self.real = real

    @property
    def closed(self):
        return self.real.closed

    @property
    def broken(self):
        return self.real.broken

    def execute(self, sql, params=None):
        return Cur(self.real.cursor()).execute(sql, params)

    def cursor(self):
        return Cur(self.real.cursor())

    def transaction(self):
        return self.real.transaction()

    def close(self):
        pass


db = hubdb.HubDb()
real = psycopg.connect(hubdb._dsn(), autocommit=False, connect_timeout=5, application_name="transportation-writes-check")
proxy = Conn(real)
store = W.Store(connect=lambda: proxy, kind="check", label="Check")
EDITIONS = {"value": "[]"}
NEW = (("transportation.trips", "vehicle-calendar"), ("transportation.vehicles", "vehicle-calendar"),
       ("transportation.settings", "vehicle-calendar"))
sc.EDITIONS = tuple(e for e in sc.EDITIONS if e[1] != "vehicle-calendar") + NEW
base_cfg = db.hiring_config
db.hiring_config = lambda: {**base_cfg(), sc.EDITIONS_KEY: EDITIONS["value"]}
db.stale = lambda books: False
HOLDER = {"id": "", "shut": ""}
base_gate = sc.profile_app_gate


def gate(app_id, user, src):
    uid = gsjs.str_((user or {}).get("id"))
    if uid and HOLDER["shut"] == uid:
        return {"open": False, "scope": sc.scope_of("none", "closed by the check")}
    if user and HOLDER["id"] and uid == HOLDER["id"] and not user.get("is_service"):
        return {"open": True, "scope": sc.scope_of("all")}
    return base_gate(app_id, user, src)


sc.profile_app_gate = gate
M.DB = db
M.STORE = M.CLIENT_STORE = M.STAFF_STORE = M.SSA_STORE = M.FAMILY_STORE = M.SCHEDULING_STORE = W.Store(dsn="")
M.WRITES["transportation"] = TW
M.stores = lambda: {"transportation": store}
M.WRITE_BUDGET_S = 120.0
seq = [0]
PERSONAL = {"by_name", "by_uid", "updated_by", "staff_name", "staff_key", "staff_uid", "driver_name", "driver_key",
            "driver_uid", "client_name", "client_key", "requested_by_uid", "requested_by_name", "decided_by_uid",
            "decided_by_name", "was"}


def listed(*eids):
    EDITIONS["value"] = json.dumps([{"id": e, "on": True, "people": [HOLDER["id"]]} for e in eids])


def write(action, who, payload):
    seq[0] += 1
    wid = f"Wcheck-trw-{seq[0]:04d}-{uuid.uuid4().hex[:8]}"
    res = M._run_write(TW, action, who, payload, wid)
    return res.status_code, json.loads(res.body), wid


def masked(field, value):
    if field in PERSONAL:
        return f"<{len(value)} chars>" if value else ""
    if field == "now" and value.startswith("{"):
        return "<json keys: " + ",".join(json.loads(value)) + ">"
    return value


def rows_of(wid, label):
    with real.cursor() as c:
        c.execute("select tab_name, kind, match_by, row_key, field, value, edition from pg_temp.hub_edits_trw"
                  " where write_id = %s order by id", (wid,))
        got = c.fetchall()
    rows_out.append({"write": label, "rows": [[t, k, m, rk, f, masked(f, v), e] for t, k, m, rk, f, v, e in got]})
    return got


def plan(env):
    return env.get("_write") or {}


def guarded(name, fn):
    try:
        with real.transaction():
            fn()
    except Exception as exc:  # noqa: BLE001 - said as a failed check, never a value
        check(name + ": ran to the end", False, type(exc).__name__ + ": " + str(exc)[:300])


reads0 = L.Reads(db, None)
users = [u for u in reads0.users() if gsjs.str_(u.get("userid")) and not gsjs.str_(u.get("mergedinto"))]
master = next((u for u in users if gsjs.str_(u.get("email")).lower() == sc.MASTER_ACCOUNT), None)
directors = {d["uid"] for d in TW.settings(reads0).get("directors") or []}
holder = next((u for u in users if gsjs.str_(u.get("role")).lower() == "staff" and not gsjs.str_(u.get("clientkey"))
               and gsjs.str_(u.get("active")).lower() != "false" and gsjs.str_(u.get("userid")) not in directors
               and gsjs.str_(u.get("email")).lower() != sc.MASTER_ACCOUNT), None)
MASTER = {"uid": gsjs.str_((master or {}).get("userid")) or "USR_MASTER", "role": "admin", "is_master": True}
HOLD = {"uid": gsjs.str_((holder or {}).get("userid")), "role": "staff", "is_master": False}
facts["reads module"] = blob["reads"]
facts["accounts"] = f"master row {'found' if master else 'absent'}, a staff account not a director {'found' if holder else 'absent'}"
check("an employee who is not a director is read from the users tab", bool(holder))
with real.transaction():
    store.ensure()
    check("the edit store is made in temp tables", store.ready(), store.why)

trips0 = TW.tab_rows(reads0, "vc_trips")
vehicles0 = TW.tab_rows(reads0, "vc_vehicles")
now_ms = TW.now_ms(reads0)
future = [t for t in trips0 if t["state"] == "scheduled" and (TW.ms_of(t["end_at"]) or 0) > now_ms]
anyone = [t for t in trips0 if t["state"] in ("scheduled", "needs_assignment") and not t.get("requested_by_uid")]
A = future[0] if future else (anyone[0] if anyone else None)
B = next((t for t in anyone if t["state"] == "needs_assignment" and (A is None or t["id"] != A["id"])),
         next((t for t in anyone if A is None or t["id"] != A["id"]), None))
V = next((v for v in vehicles0 if any(t.get("vehicle_id") == v["id"] for t in future)), vehicles0[0] if vehicles0 else None)
# a requester's trip: its cancel is final, so it is neither A, B nor one of V's trips the vehicle checks count
C = next((t for t in anyone if t["id"] not in {(A or {}).get("id"), (B or {}).get("id")}
          and (V is None or t.get("vehicle_id") != V["id"])), None)
facts["subjects"] = (f"{len(trips0)} trips ({len(future)} scheduled ahead), {len(vehicles0)} vehicles; trip A "
                     f"{A['state'] if A else '-'}, trip B {B['state'] if B else '-'}, trip C {C['state'] if C else '-'}, "
                     f"vehicle with {sum(1 for t in future if V and t.get('vehicle_id') == V['id'])} trips ahead")
check("three real trips and a vehicle are read from the copy", bool(A and B and C and V))


def trips_master():
    code, env, wid = write("vehicleCalendarTripSave", MASTER, {"trip_id": A["id"], "purpose": "Check — purpose",
                                                                "destination": "Check — destination"})
    got = rows_of(wid, "master · trip A · purpose + destination")
    check("the master changes trip A: answered 200, final, kept in app.edits",
          code == 200 and env.get("status") == 200 and plan(env).get("final") is True, env)
    fields = {r[4] for r in got if r[0] and r[1] == "edit"}
    check("its trip row keeps only the cells it changed and the stamp",
          fields == {"purpose", "destination", "updated_at", "updated_by"}, sorted(fields))
    check("one log line is appended", sum(1 for r in got if r[1] == "append") == len(TW.HEADERS["vc_log"]))
    check("the master's write names no edition", all(r[6] == "" for r in got))
    own = CW.Own([], book=db.book, edits=store.edits(), edits_at=time.time())
    tok = hubdb.OWN.set(own)
    try:
        laid = next(t for t in TW.tab_rows(L.Reads(db, None), "vc_trips") if t["id"] == A["id"])
    finally:
        hubdb.OWN.reset(tok)
    check("the next read lays the kept purpose over the copy", laid["purpose"] == "Check — purpose")
    code, env, _ = write("vehicleCalendarTripSave", MASTER, {"trip_id": A["id"], "purpose": "Check — purpose"})
    check("the same value again is 'Nothing changed.' and keeps nothing",
          env.get("data", {}).get("said") == "Nothing changed." and not plan(env), env)


def trips_people():
    real_open = base_gate("vehicle-calendar", sc.user_from_row(holder), L.Reads(db, None).scope_sources()).get("open")
    facts["App Control opens Transportation to the staff account"] = "yes" if real_open else "no"
    HOLDER["id"], HOLDER["shut"] = "", HOLD["uid"]
    listed("transportation.trips")
    code, env, _ = write("vehicleCalendarTripSave", HOLD, {"trip_id": B["id"], "details": "Check — details"})
    check("a listed employee Transportation is not released to is told 'Unknown action.'",
          env == {"status": 404, "message": "Unknown action."}, env)
    HOLDER["id"], HOLDER["shut"] = HOLD["uid"], ""
    EDITIONS["value"] = "[]"
    code, env, _ = write("vehicleCalendarTripSave", HOLD, {"trip_id": B["id"], "details": "Check — details"})
    check("released but not listed: 'Only the directors assign trips.'",
          env.get("status") == 403 and env.get("message") == "Only the directors assign trips.", env)
    listed("transportation.trips")
    code, env, wid = write("vehicleCalendarTripSave", HOLD, {"trip_id": B["id"], "details": "Check — details",
                                                             "note": "Check — note"})
    got = rows_of(wid, "listed (transportation.trips) · trip B · details + note")
    check("listed on transportation.trips: trip B changed, final", env.get("status") == 200 and plan(env).get("final"), env)
    check("every row it keeps names transportation.trips", got and all(r[6] == "transportation.trips" for r in got))
    code, env, _ = write("vehicleCalendarVehicleSave", HOLD, {"vehicle_id": V["id"], "name": V["name"],
                                                              "description": V["description"], "seats": 5,
                                                              "wheelchair_accessible": True, "availability": "available"})
    check("the trips edition does not open the vehicles", env.get("status") == 403
          and env.get("message") == "Only the directors manage vehicles.", env)


def handoffs():
    listed("transportation.trips")
    real_rows = TW.tab_rows

    def as_requested(reads, tab):
        rows = real_rows(reads, tab)
        if tab == "vc_trips":
            for r in rows:
                if r["id"] == A["id"]:
                    r["state"] = "requested"
                if r["id"] == C["id"]:
                    r["requested_by_uid"], r["requested_by_name"] = "USR_CHECK", "Check Requester"
        return rows
    TW.tab_rows = as_requested
    try:
        code, env, _ = write("vehicleCalendarTripSave", MASTER, {"trip_id": A["id"], "purpose": "x"})
        check("a waiting request's edit is kept by Python, final (nobody is texted)",
              env.get("status") == 200 and plan(env).get("final") is True, env)
        code, env, _ = write("vehicleCalendarTripSave", HOLD, {"trip_id": A["id"], "purpose": "y"})
        check("a listed person edits a waiting request too (the edition adds them)",
              env.get("status") == 200 and plan(env).get("final") is True, env)
        code, env, wid = write("vehicleCalendarTripSave", MASTER, {"trip_id": C["id"], "status": "cancelled"})
        got = rows_of(wid, "master · a requester's trip · cancel")
        check("cancelling a requester's trip: final with the requester's My Inbox item, or Apps Script's when no text "
              "can be kept here", (env.get("status") == 200 and plan(env).get("final") is True
                                   and any(r[0] == "Data" and r[3].startswith("VI") for r in got))
              or (code == 503 and "Smart Comms" in str(env.get("defer"))), env)
    finally:
        TW.tab_rows = real_rows
    code, env, wid = write("vehicleCalendarTripSave", HOLD, {"trip_id": B["id"], "status": "cancelled"})
    got = rows_of(wid, "listed · trip B (nobody asked for it) · cancel")
    check("a trip nobody asked for is cancelled by a listed person, final",
          env.get("status") == 200 and env.get("data", {}).get("said") == "Cancelled." and plan(env).get("final"), env)
    check("its cancel keeps the state and the stamp (a cell that holds its value already is not kept again)",
          {r[4] for r in got if r[1] == "edit"} >= {"state", "updated_at"})


def vehicles():
    listed("transportation.vehicles")
    ahead = sum(1 for t in future if t.get("vehicle_id") == V["id"])
    code, env, wid = write("vehicleCalendarVehicleSave", HOLD, {"vehicle_id": V["id"], "name": V["name"],
                                                                "description": V["description"],
                                                                "seats": int(V["seats"] or 5),
                                                                "wheelchair_accessible": TW.yes(V["wheelchair_accessible"]),
                                                                "availability": "maintenance", "note": "Check — note"})
    got = rows_of(wid, "listed (transportation.vehicles) · vehicle · maintenance + note")
    check("listed on transportation.vehicles: the vehicle into maintenance, final",
          env.get("status") == 200 and plan(env).get("final"), env)
    moved = {r[3] for r in got if r[0] and r[3].startswith("VT") and r[4] == "state"}
    check("every scheduled trip ahead on it goes back to Needs assignment", len(moved) == ahead, f"{len(moved)} of {ahead}")
    facts["trips handed back by the maintenance check"] = str(len(moved))
    check("its rows name transportation.vehicles", all(r[6] == "transportation.vehicles" for r in got))
    code, env, wid = write("vehicleCalendarVehicleSave", HOLD, {"name": "Check Bus", "description": "Check", "seats": 12,
                                                                "wheelchair_accessible": False, "availability": "available"})
    got = rows_of(wid, "listed · a new vehicle")
    check("a new vehicle is appended whole with an id minted here",
          env.get("status") == 200 and re.fullmatch(r"VV[0-9A-F]{10}", env.get("data", {}).get("vehicle_id", "")) is not None
          and {r[4] for r in got if r[1] == "append"} >= set(TW.HEADERS["vc_vehicles"]), env)
    code, env, _ = write("vehicleCalendarVehicleSave", HOLD, {"name": V["name"].upper(), "description": "", "seats": 4,
                                                              "wheelchair_accessible": False, "availability": "available"})
    check("a second vehicle of the same name is refused 409", env.get("status") == 409, env)


def settings_doors():
    listed("transportation.settings")
    code, env, wid = write("vehicleCalendarSettingsSet", HOLD, {"values": {"trip_types": ["Doctor appointment", "Check trip"]}})
    got = rows_of(wid, "listed (transportation.settings) · trip types")
    check("listed on transportation.settings: the trip types kept, final", env.get("status") == 200 and plan(env).get("final"), env)
    check("the settings row is matched by its key", any(r[2] == "cols:key" and r[3] == "trip_types" for r in got))
    code, env, _ = write("vehicleCalendarSettingsSet", HOLD, {"values": {"directors": "x@y.zz"}})
    check("who approves stays the master's", env.get("status") == 403 and "who approves" in env.get("message", ""), env)
    code, env, _ = write("vehicleCalendarSettingsSet", MASTER, {"values": {"directors": "x@y.zz", "trip_types": ["A"]}})
    check("the master names an address no live account answers: refused 400 in Apps Script's words, nothing kept",
          env.get("status") == 400 and env.get("message") == "No live account answers x@y.zz." and not plan(env), env)
    named = [d["email"] for d in TW.settings(reads0).get("directors") or []]
    approvers = ", ".join(named + [gsjs.str_(holder.get("email")).lower()])
    code, env, wid = write("vehicleCalendarSettingsSet", MASTER, {"values": {"directors": approvers}})
    with real.cursor() as c:  # the addresses are never printed: the rows are checked here, not listed
        c.execute("select kind, match_by, row_key, field, value from pg_temp.hub_edits_trw where write_id = %s", (wid,))
        got = c.fetchall()
    check("the master's change of who approves is kept by Python, final, nothing carried to Apps Script",
          env.get("status") == 200 and plan(env).get("final") is True and not plan(env).get("engine"), env)
    check("its settings row is the directors key, holding the addresses lower-cased",
          any(r[1] == "cols:key" and r[2] == "directors" and r[3] == "value" and r[4] == approvers for r in got),
          [r[:4] for r in got if r[0] != "append"])
    code, env, _ = write("vehicleCalendarSettingsSet", MASTER, {"values": {"text_to": {HOLD["uid"]: "123"}}})
    check("a text number this platform may not text is refused 400, nothing kept",
          env.get("status") == 400 and env.get("message", "").startswith("These need a live account and a number")
          and not plan(env), env)
    code, env, wid = write("vehicleCalendarSettingsSet", MASTER, {"values": {"import_minutes": 90}})
    rows_of(wid, "master · import minutes")
    check("the master's import length is kept, final", env.get("status") == 200 and plan(env).get("final"), env)
    code, env, _ = write("vehicleCalendarSettingsSet", MASTER, {"values": {"import_minutes": 5}})
    check("an import length out of range is refused 400", env.get("status") == 400, env)


try:
    with real.transaction():
        for name, fn in (("trips, the master", trips_master), ("trips, the people", trips_people),
                         ("the hand-offs", handoffs), ("vehicles", vehicles), ("settings", settings_doors)):
            if A and B and V and holder:
                guarded(name, fn)
        with real.cursor() as c:
            c.execute("select count(*), count(distinct write_id) from pg_temp.hub_edits_trw")
            n, w = c.fetchone()
        facts["cells kept in the check's app.edits (temp)"] = f"{n} cells from {w} writes"
        raise psycopg.Rollback()
finally:
    try:
        real.close()
    except Exception:
        pass
print(json.dumps({"checks": out, "facts": facts, "rows": rows_out}))
'''


def main() -> int:
    py_compile.compile(str(ROOT / "app" / "transportation_writes.py"), doraise=True)
    print("ok   app/transportation_writes.py compiles")
    app = {p.stem: p.read_text(encoding="utf-8") for p in (ROOT / "app").glob("*.py")}
    reads = "app/transportation.py" if "transportation" in app else "stand-in (app/transportation.py is not in this tree)"
    app.setdefault("transportation", STAND_IN)
    blob = {"app": app, "reads": reads}
    got = subprocess.run(["docker", "exec", "-i", "-e", "MALLOC_ARENA_MAX=2", DB_RUNNER, "python", "-c", DRIVER],
                         input=base64.b64encode(json.dumps(blob).encode()) + b"\n", capture_output=True, timeout=900)
    lines = got.stdout.decode().strip().splitlines()
    if got.returncode != 0 or not lines:
        print("FAIL the driver ran in asa-hub-db-sync")
        print(got.stderr.decode()[-2500:])
        return 1
    res = json.loads(lines[-1])
    failed = 0
    for name, ok, detail in res["checks"]:
        print(("ok   " if ok else "FAIL ") + name + ("" if ok else f"\n       {detail}"))
        failed += 0 if ok else 1
    for k, v in res["facts"].items():
        print(f"fact {k}: {v}")
    for w in res["rows"]:
        print(f"rows {w['write']}:")
        for r in w["rows"]:
            print("     " + " | ".join(str(x) for x in r))
    print(f"{len(res['checks']) - failed} ok, {failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
