"""The last of Main.gs route()'s own resources answered by Python (app/generic_rows*.py), run in-process with the app's
own modules and asa-hub-db read live, every write in one transaction rolled back at the end (app.edits and the book
ops on stand-ins of this session alone): main.py and the relay's routes name the same door of the same app for every
verb of every resource; each tab kept in Postgres uploaded from its copy row for row and read back as route() reads
it, a client narrowed to their own (a roster tab by the street number of their house); a tab kept on its copy listed
as the copy holds it with route()'s gates; a row made, changed and removed in each model; the certification
tracker's door refusing in its words, the performance board built, the House Inventory List read and written as
estateRoute_ does, the Directors' writes. Nothing reaches a live table.

Run inside asa-hub-db-sync by the in-process runner (run.sh, which loads the test from beside its drv.py):

    cp tools/test-generic-rows.py "$RUNNER/test_generic_rows.py"
    E=$(python3 -c 'import json;print(json.dumps({"FD_ROUTES":open("app/front_door_routes.json").read()}))')
    sh "$RUNNER/run.sh" "$PWD/app" "$RUNNER/test_generic_rows.py" "$E"
"""
import logging

logging.disable(logging.CRITICAL)
import json  # noqa: E402
import os  # noqa: E402
import sys  # noqa: E402
import types  # noqa: E402


class _App:
    def __init__(self, *a, **k):
        pass

    def __getattr__(self, name):
        def deco(*a, **k):
            return lambda f: f
        return deco


class _Resp:
    def __init__(self, content=None, status_code=200, media_type=None, headers=None):
        if isinstance(content, (dict, list)):
            content = json.dumps(content).encode()
        elif isinstance(content, str):
            content = content.encode()
        self.body, self.status_code, self.media_type = content or b"", status_code, media_type
        self.headers = dict(headers or {})


async def _threadpool(fn, *a, **k):
    return fn(*a, **k)


_fa = types.ModuleType("fastapi")
_fa.FastAPI, _fa.Request = _App, object
_fr = types.ModuleType("fastapi.responses")
_fr.JSONResponse = _fr.Response = _Resp
_sc = types.ModuleType("starlette.concurrency")
_sc.run_in_threadpool = _threadpool
sys.modules.update({"fastapi": _fa, "fastapi.responses": _fr, "starlette": types.ModuleType("starlette"),
                    "starlette.concurrency": _sc})
WORK = f"/tmp/gr-test-{os.getpid()}"
os.makedirs(WORK, exist_ok=True)
with open(WORK + "/routes.json", "w") as fh:
    fh.write(os.environ["FD_ROUTES"])
os.environ["HUB_FRONT_DOOR_ROUTES"] = WORK + "/routes.json"

ok = {"n": 0, "bad": []}


def check(name, cond, detail=None):
    if cond:
        ok["n"] += 1
        print("  ok  ", name)
    else:
        ok["bad"].append(name)
        print("  FAIL", name, "" if detail is None else str(detail)[:700])


import psycopg  # noqa: E402

import book_ops as BO  # noqa: E402
import generic_rows as GR  # noqa: E402
import generic_rows_writes as GRW  # noqa: E402
import gsjs  # noqa: E402
import hubdb  # noqa: E402
import locations as L  # noqa: E402
import ops_stragglers as OS  # noqa: E402
import resource_rows as RR  # noqa: E402
import scope as sc  # noqa: E402
import sheet_resources as SR  # noqa: E402
import smart_comms as SC  # noqa: E402
import staff_views  # noqa: E402
import writes as W  # noqa: E402
import main as M  # noqa: E402

ROUTES = json.loads(os.environ["FD_ROUTES"])
s_ = gsjs.str_

# ---- 1. the wiring: the relay's routes and main.py name one door of one app for every verb -------------------------
print("wiring")
doors = {(r, v): d for r, v, d in ROUTES["generic"]["doors"]}
wrong = []
for res, (app, pre, kind, _kept) in GR.ROUTES.items():
    for v in GR.VERBS:
        d = doors.get((res, v))
        if d != GR.door_of(res, v):
            wrong.append((res, v, "routes name", d))
            continue
        reads_here = kind in GR.READ_ONLY_KINDS or v in ("list", "get")
        if reads_here:
            if ROUTES["reads"].get(d) != app or d not in M.APPS[app].ACTIONS:
                wrong.append((res, v, "read", ROUTES["reads"].get(d)))
        elif ROUTES["writes"].get(d) != app or d not in ROUTES["final"] or d not in M.WRITES[app].ACTIONS:
            wrong.append((res, v, "write", ROUTES["writes"].get(d)))
check("every verb of the 48 resources is one door of its app, in the relay's routes and in main.py", not wrong, wrong)
import front_door as FD  # noqa: E402
import urllib.parse  # noqa: E402

routed = []
for res, (app, pre, kind, _kept) in GR.ROUTES.items():
    for v in GR.VERBS:
        env = {"action": v, "resource": res, "token": "py.probe", "payload": {}}
        raw = urllib.parse.urlencode({"body": json.dumps(env)}).encode()
        want = ("read" if kind in GR.READ_ONLY_KINDS or v in ("list", "get") else "write", GR.door_of(res, v), app)
        if FD.route(env, raw) != want:
            routed.append((res, v, FD.route(env, raw)))
check("the site's front door answers every verb of the 48 here, at the app whose rows they are", not routed, routed)
left = sorted(r for r in ROUTES["generic"]["routes"] if (r, "list") not in doors)
check("no route() name is left without a Python list door but the two the relay's own rung answers",
      left == ["directors", "hiringCadences"], left)
check("the Directors' writes are a door of their own app",
      all(a in M.WRITES["directors"].ACTIONS for a in ("directorsCreate", "directorsUpdate", "directorsDelete"))
      and "directors" in M.stores(), sorted(M.WRITES.get("directors").ACTIONS) if M.WRITES.get("directors") else None)
check("each upload door is its app's", all(GRW.UPLOADS[a][0] in M.WRITES[a].ACTIONS for a in GRW.UPLOADS))
check("the stores a generic write lands in take each change back with a void",
      isinstance(M.stores()["transportation"], RR.Store) and all(
          hasattr(M.stores()[a], "settle") and type(M.stores()[a]).__mro__[1].__name__ == "_CancelsOps"
          for a in ("forms", "quo", "smart-comms", "learning", "finance", "client-care", "house-repair")))

# ---- the session: one transaction, rolled back; app.edits and the book ops on stand-ins -------------------------------
db = hubdb.HubDb()
conn = psycopg.connect(hubdb._dsn())
cur = conn.cursor()
cur.execute("set role asa_hub_app_rw")
W.EDITS_TABLE = "pg_temp.gr_edits"
BO.CHANNEL = "gr_test_book_ops"
for stmt in W.edits_ddl() + BO.ddl():
    cur.execute(stmt.replace("create index if not exists ", "create index if not exists gr_"))
W.HELD.set(cur)
SC._WRITE.set({"tx": conn, "write_id": "Wgenericrowstest01", "door": "test"})
staff_views.record = lambda *a, **k: None

reads0 = L.Reads(db)
users = [u for u in reads0.users() if not s_(u.get("mergedinto"))]
boss = sc.user_from_row(next(u for u in users if sc.is_master_email(u.get("email"))
                             and s_(u.get("role")) == "admin"))
staff = sc.user_from_row(next(u for u in users if s_(u.get("role")) == "staff" and not s_(u.get("hometenant"))))
client_row = next((u for u in users if s_(u.get("role")) == "client" and s_(u.get("clientkey"))
                   and not s_(u.get("hometenant"))), None)
client = sc.user_from_row(client_row) if client_row else None
trainee = {"id": "U_probe_t", "role": "onboarding", "email": "t@probe"}
SVC = {"is_service": True}
AWAY = {**boss, "place": {"tenant_id": "T_probe"}}


def sess(user):
    return L.Session(L.Reads(db), user)


def read(user, res, verb, payload=None):
    app = GR.ROUTES[res][0]
    try:
        return M.APPS[app].ACTIONS[GR.door_of(res, verb)](sess(user), payload or {})
    except Exception as e:  # noqa: BLE001
        return {"status": "raised", "message": f"{type(e).__name__}: {str(e)[:200]}"}


def write(user, res, verb, payload):
    app = GR.ROUTES[res][0]
    try:
        d = M.WRITES[app].ACTIONS[GR.door_of(res, verb)](sess(user), payload)
        return d.answer, d
    except Exception as e:  # noqa: BLE001
        return {"status": "raised", "message": f"{type(e).__name__}: {str(e)[:200]}"}, None


try:
    # ---- 2. the tabs kept in Postgres: uploaded from their copy, read back as route() reads them -------------------
    print("uploads")
    for app, (door, resources) in GRW.UPLOADS.items():
        d = M.WRITES[app].ACTIONS[door](sess(SVC), {})
        got = d.answer
        check(f"{door} brings {', '.join(resources)} into Postgres", got.get("status") == 200
              and sorted(got.get("data") or {}) == sorted(resources), got)
        no = M.WRITES[app].ACTIONS[door](sess(boss), {}).answer
        check(f"{door} is the relay's alone", no.get("status") == 403, no)
    print("rows")
    for res in ("diseases", "projects", "clientNotes", "marErrors", "missingMedications", "leads", "inventoryItems"):
        kept = GR.ROUTES[res][3]
        res_ref = db.resolve(SR.SPECS[kept]["tab"])
        copy = [r for r in (RR.shown(list(res_ref.ref.headers), {h: raw.get(h) for h in res_ref.ref.headers
                                                                 if raw.get(h) not in (None, "")})
                            for _rn, raw in db.rows(res_ref.ref)) if r is not None] if res_ref.ref else []
        got = read(boss, res, "list")
        check(f"{res}: the master lists every row the copy holds ({len(copy)})",
              got.get("status") == 200 and len(got.get("data") or []) == len(copy), (got.get("status"), len(
                  got.get("data") or []), len(copy), got.get("message")))
        if copy:
            first = got["data"][0]
            one = read(boss, res, "get", {"id": first.get("id")})
            check(f"{res}: get answers a row by its id", one.get("status") == 200 and one.get("data") == first,
                  one.get("status"))
    miss = read(boss, "diseases", "get", {"id": "nope"})
    check("an unknown id is requireRow_'s 404", miss == {"status": 404, "message": 'No "diseases" record with id '
                                                                                 '"nope".'}, miss)
    q = read(boss, "diseases", "list", {"q": "zzzz-no-such-text"})
    check("listRows_' q narrows across every cell", q == {"status": 200, "data": []}, q)
    lim = read(boss, "marErrors", "list", {"offset": 1, "limit": 2})
    full = read(boss, "marErrors", "list").get("data") or []
    check("listRows_' offset and limit", lim.get("data") == full[1:3], len(lim.get("data") or []))
    if client:
        mine = read(client, "marErrors", "list").get("data")
        theirs = [r for r in full if SR._theirs(sess(client).reads, r, s_(client.get("client_key")), "marErrors")]
        check("a client lists only the medication errors that name them", mine == theirs, (len(mine or []),
                                                                                          len(theirs)))
        tp = read(client, "teamProjects", "list")
        check("the board's projects are for employees", tp == {"status": 403,
                                                               "message": "The team board is for employees."}, tp)
        inc = read(client, "incidents", "list")
        check("a client reads their own incidents (a clinical tab declared theirs)", inc.get("status") == 200, inc)
    tr = read(trainee, "incidents", "list")
    check("a trainee reads no incident", tr == {"status": 403, "message": "These records are for employees on shift."},
          tr)
    print("rows written")
    made, _d = write(staff, "diseases", "create", {"name": "Probe disease", "tenant": "T1"})
    rid = s_((made.get("data") or {}).get("id"))
    check("a row made: an id, createdAt and updatedAt, the place never the caller's", made.get("status") == 200 and rid
          and "tenant" not in made["data"] and made["data"].get("createdAt"), made)
    back = read(staff, "diseases", "get", {"id": rid})
    check("the row reads back", back.get("status") == 200 and back["data"].get("name") == "Probe disease", back)
    up, _d = write(staff, "diseases", "update", {"id": rid, "name": "Probe disease 2", "createdAt": "x"})
    check("a row changed, createdAt immutable", up.get("status") == 200 and up["data"]["name"] == "Probe disease 2"
          and up["data"]["createdAt"] == made["data"]["createdAt"], up)
    gone, _d = write(staff, "diseases", "delete", {"id": rid})
    check("a row removed", gone == {"status": 200, "data": {"id": rid, "deleted": True}}, gone)
    check("and not read again", read(staff, "diseases", "get", {"id": rid}).get("status") == 404)
    tp, _d = write(boss, "time_punches", "update", {"id": "nope"})
    check("route() names the punches by their tab", tp == {"status": 404, "message": 'No "time_punches" record with '
                                                                                     'id "nope".'}, tp)
    tp, _d = write(staff, "time_punches", "update", {"id": "nope"})
    check("Time Reconciliation's tables keep its own gate: a staff member writes none",
          tp == {"status": 403, "message": "This action is for admin or manager."}, tp)
    ro, _d = write(boss, "commCalls", "create", {"x": 1})
    check("a read-only resource makes no row", ro == {"status": 405, "message": 'Action "create" is not allowed on '
                                                                                'resource "commCalls" '
                                                                                '(read/update-only).'}, ro)
    ro2, _d = write(staff, "commWhen", "update", {"id": "x"})
    check("and only an admin changes one", ro2 == {"status": 403, "message": "Requires an admin or manager account"},
          ro2)
    when = read(boss, "commWhen", "list")
    check("commWhen lists the window's own rows (commWhenHouse)", when.get("status") == 200
          and len(when["data"]) == len(SR.rows(sess(boss).reads, "commWhenHouse")), when.get("status"))
    trips = read(staff, "travelTrips", "list")
    check("route() gates no role on the trips", trips.get("status") == 200, trips)
    meal, _d = write(staff, "mealLog", "create", {"kind": "water", "ownerId": "someone-else"})
    check("a personal row is stamped with its maker", meal.get("status") == 200
          and meal["data"]["ownerId"] == staff["id"], meal)
    other = read(boss, "mealLog", "get", {"id": meal["data"]["id"]})
    check("and is nobody else's", other.get("status") == 404, other)
    check("the maker lists it", any(r.get("id") == meal["data"]["id"] for r in read(staff, "mealLog", "list")["data"]))
    shifts = read(boss, "shifts", "list")
    check("the roster's own tab lists (empty, as the Hub tab is)", shifts.get("status") == 200, shifts)
    if client:
        houses = GR.SR._their_house(sess(client).reads, {"houseCode": "XX0000"}, s_(client.get("client_key")),
                                    SR.SPECS["shifts"]["by_house"])
        check("a roster row naming no house of theirs is not a client's", houses is False)

    # ---- 3. the tabs kept on their copy -------------------------------------------------------------------------------
    print("copy")
    for res in ("forms", "formSubmissions", "formAnswers", "formFiles", "quoSummaries", "smartCommsDesk",
                "smartCommsActivity", "financeConfig", "learnSkills"):
        copy = OS.rows(sess(boss).reads, SR.COPY[res]["tab"])
        got = read(boss, res, "list")
        check(f"{res}: the master lists the copy's {len(copy)} rows", got.get("status") == 200
              and got.get("data") == copy, (got.get("status"), len(got.get("data") or []), got.get("message")))
    fb = read(boss, "financeBalances", "list")
    check("the on-file balances wait while their copy withholds the card cell (never shown as a value)",
          fb.get("status") == "raised" and "withholds" in s_(fb.get("message")), fb)
    for res in ("forms", "quoMessages", "formFiles"):
        no = read(staff, res, "list")
        check(f"{res} is for admins and managers", no == {"status": 403, "message": "These are for admins and "
                                                                                    "managers."}, no)
    fa = read(staff, "formAnswers", "list")
    check("formAnswers carries no role gate in route()", fa.get("status") == 200, fa.get("status"))
    att = read(staff, "learnAttempts", "list")
    check("a person lists their own attempts alone", att.get("status") == 200 and all(
        s_(r.get("ownerId")) == staff["id"] for r in att["data"]), att.get("status"))
    cf = read(trainee, "clientFiles", "list")
    check("a trainee reads no client file", cf.get("status") == 403, cf)
    forms = read(boss, "forms", "list")["data"]
    one = read(boss, "forms", "get", {"id": forms[0]["id"]}) if forms else {}
    check("a form read by its id", not forms or one == {"status": 200, "data": forms[0]}, one.get("status"))
    made, dm = write(boss, "financeConfig", "create", {"key": "probe", "value": "1"})
    check("a config row made: appended in app.edits", made.get("status") == 200 and dm is not None and dm.edits
          and dm.edits[0]["kind"] == "append" and dm.edits[0]["row_key"] == made["data"]["id"], made)
    cfg = read(boss, "financeConfig", "list")["data"]
    if cfg:
        up, du = write(boss, "financeConfig", "update", {"id": cfg[0]["id"], "probe_note": "x"})
        check("a config row changed: its cells kept, the new column widened by a book op", up.get("status") == 200
              and du is not None and du.edits and du.edits[0]["kind"] == "edit"
              and "probe_note" in du.edits[0]["cells"], up)
        de, dd = write(boss, "financeConfig", "delete", {"id": cfg[0]["id"]})
        cur.execute(f"select op, spec from {BO.table()} where op = 'delete' order by id desc limit 1")
        op = cur.fetchone()
        check("a config row removed by the delete op", de.get("status") == 200 and op is not None
              and op[1].get("key") == s_(cfg[0]["id"]), (de, op))
    sd, _d = write(boss, "smartCommsDesk", "delete", {"id": "x"})
    check("the desk's tab is read-only to these verbs", sd.get("status") == 405, sd)
    lat, dl = write(staff, "learnAttempts", "create", {"skillId": "probe"})
    check("an attempt is stamped with its maker", lat.get("status") == 200 and lat["data"]["ownerId"] == staff["id"],
          lat)

    # ---- 4. the adapters ----------------------------------------------------------------------------------------------
    print("adapters")
    for res in ("certMatrix", "staffCerts"):
        lst, gt = read(staff, res, "list"), read(staff, res, "get", {"id": "x"})
        cr = read(boss, res, "create", {})
        check(f"{res}: certsRoute_'s refusals", lst == GR.CERTS_LIST and gt == GR.CERTS_GET and cr == GR.CERTS_WRITE,
              (lst, gt, cr))
        away = read(AWAY, res, "list")
        check(f"{res}: away from headquarters the resource does not exist",
              away == {"status": 404, "message": f'Unknown resource: "{res}".'}, away)
    pb = read(boss, "staffPerfBoard", "list")
    check("the performance board: its rows for an admin", pb.get("status") == 200
          and isinstance((pb.get("data") or {}).get("rows"), list), pb.get("status"))
    check("and for the relay's own identity", read(SVC, "staffPerfBoard", "list").get("status") == 200)
    check("and refused to staff", read(staff, "staffPerfBoard", "list") == {
        "status": 403, "message": "Requires an admin or manager account"})
    check("any other verb is unknown", read(boss, "staffPerfBoard", "get", {"id": "x"}) == GR.PERF_UNKNOWN)
    inv = read(boss, "houseInventory", "list")
    est = sess(boss).reads.estate("houseInventory")
    check("the House Inventory List: every row the estate holds", inv.get("status") == 200
          and len(inv["data"]) == len(est), (inv.get("status"), len(inv.get("data") or []), len(est)))
    if inv.get("data"):
        r0 = inv["data"][0]
        check("a row by its id", read(boss, "houseInventory", "get", {"id": r0["id"]}) == {"status": 200, "data": r0})
        if client:
            check("a client reads no inventory", read(client, "houseInventory", "list") == {"status": 200,
                                                                                           "data": []})
            check("nor a row", read(client, "houseInventory", "get", {"id": r0["id"]}) == {
                "status": 404, "message": 'No row "houseInventory" here.'})
        mv, _d = write(boss, "houseInventory", "update", {"id": r0["id"], "witness": "not the item",
                                                          "current_condition": "x"})
        check("a row that moved is refused", mv.get("status") == 409, mv)
        ed, de = write(boss, "houseInventory", "update", {"id": r0["id"], "witness": r0.get("item"),
                                                          "current_condition": "Probe condition"})
        check("a writer's change kept on the row, answered as it reads after", ed.get("status") == 200
              and ed["data"].get("current_condition") == "Probe condition" and de is not None and de.edits, ed)
        dl, _d = write(boss, "houseInventory", "delete", {"id": r0["id"], "witness": r0.get("item")})
        check("a writer's removal queued as the delete op", dl.get("status") == 200, dl)
    aw, _d = write(AWAY, "houseInventory", "create", {"item": "Probe"})
    check("away from headquarters the inventory does not exist",
          aw == {"status": 404, "message": 'Unknown resource: "houseInventory".'}, aw)
    check("the inventory's doors answer away as route() does (PLACE_SAFE)",
          all(GR.door_of("houseInventory", v) in M.WRITES["house-repair"].PLACE_SAFE
              for v in ("create", "update", "delete"))
          and GR.door_of("certMatrix", "list") in M.APPS["opsdash"].PLACE_SAFE)
    st, _d = write(staff, "houseInventory", "create", {"item": "Probe"})
    check("estateRoute_'s writers' line", st == {"status": 403, "message": "Requires an admin or manager account"}, st)
    mk, dk = write(boss, "houseInventory", "create", {"item": "Probe chair", "address": "1 Probe St"})
    check("a writer's new row appended", mk.get("status") == 200 and mk["data"].get("item") == "Probe chair"
          and dk is not None and dk.edits and dk.edits[0]["kind"] == "append", mk)
    print("directors")
    dn = M.WRITES["directors"].ACTIONS["directorsCreate"](sess(staff), {"name": "Probe"}).answer
    check("a director is written by admins and managers", dn == GRW.DIRECTORS_DENIED, dn)
    nm = M.WRITES["directors"].ACTIONS["directorsCreate"](sess(boss), {"title": "x"}).answer
    check("a director has a name", nm == {"status": 400, "message": "Name is required."}, nm)
    dc = M.WRITES["directors"].ACTIONS["directorsCreate"](sess(boss), {"name": "Probe Director", "focusAreas": "a, b"})
    check("a director appended, answered as directorPublic_", dc.answer.get("status") == 200
          and dc.answer["data"]["name"] == "Probe Director" and dc.answer["data"]["focusAreas"] == ["a", "b"]
          and dc.edits and dc.edits[0]["kind"] == "append", dc.answer)
    dirs = M.APPS["directors"].ACTIONS["directorsList"](sess(boss), {}).get("data") or []
    if dirs:
        du = M.WRITES["directors"].ACTIONS["directorsUpdate"](sess(boss), {"id": dirs[0]["id"], "title": "Probe"})
        check("a director's fields kept", du.answer.get("status") == 200 and du.answer["data"]["title"] == "Probe"
              and du.edits and du.edits[0]["kind"] == "edit", du.answer)
    dz = M.WRITES["directors"].ACTIONS["directorsDelete"](sess(boss), {"id": "dir-nope"}).answer
    check("an unknown director is directorsRoute_'s 404", dz == {"status": 404, "message": 'No director "dir-nope".'},
          dz)
finally:
    conn.rollback()
    conn.close()
print(json.dumps({"ok": ok["n"], "failed": ok["bad"]}))
