"""asa-hub-app's copies of the relay's hotline desk doors that read none of its memory (app/hotline_doors.py:
GET /hub-lanes/hotline/lanes, /hub-lanes/hotline/daily-notes, /hub-lanes/clients/daily) run in-process with the app's
own modules: the gate's refusals in the relay's words on stand-in sessions and access rows, then every door answered
off asa-hub-db, and the old platform's house calendar edits, read live on read-only connections. Google is never
imported. With the relay's kept copies on /srv/snapshot (SNAP) each lane's rows are compared with the relay's last live
read of it; with REF_DAILY (the relay's own daily notes book, built by server/daily_notes.py inside asa-hub-snapshot
with Google refused, so off the same copy) every note is compared, and the shifts' agreement is counted.

Run inside asa-hub-db-sync by the in-process runner (run.sh, which loads the test from beside its drv.py):

    cp tools/test-hotline-doors.py "$RUNNER/test_hotline_doors.py"
    docker exec asa-hub-app tar -C /srv/snapshot -cz clients.json mirror-first/hotline-lanes.private.json \
        mirror-first/daily-notes.private.json | base64 -w0 > "$RUNNER/snap.b64"
    python3 -c 'import json,sys;print(json.dumps({"FD_ROUTES":open("app/front_door_routes.json").read(),
        "SNAP":open(sys.argv[1]).read(),"REF_DAILY":open(sys.argv[2]).read() if sys.argv[2:] else ""}))' \
        "$RUNNER/snap.b64" [ref_daily.json] > "$RUNNER/env.json"
    sh "$RUNNER/run.sh" "$PWD/app" "$RUNNER/test_hotline_doors.py" "@$RUNNER/env.json"

ref_daily.json is the `payload` of `daily_notes.build_book(<a Sheets stand-in that raises>, PG_DSN,
"/srv/snapshot/clients.json")` run in asa-hub-snapshot with `hotline_desk._NEWS["at"] = 0`."""
import logging

logging.disable(logging.CRITICAL)
import asyncio  # noqa: E402
import base64  # noqa: E402
import io  # noqa: E402
import json  # noqa: E402
import os  # noqa: E402
import re  # noqa: E402
import sys  # noqa: E402
import tarfile  # noqa: E402
import tempfile  # noqa: E402
import types  # noqa: E402

import psycopg  # noqa: E402


class _Resp:
    def __init__(self, content=None, status_code=200, media_type=None, headers=None):
        self.body = content if isinstance(content, bytes) else str(content or "").encode()
        self.status_code, self.media_type, self.headers = status_code, media_type, dict(headers or {})


async def _threadpool(fn, *a, **k):
    return fn(*a, **k)


_fa = types.ModuleType("fastapi")
_fa.Request = object
_fr = types.ModuleType("fastapi.responses")
_fr.JSONResponse = _fr.Response = _Resp
_sc = types.ModuleType("starlette.concurrency")
_sc.run_in_threadpool = _threadpool
sys.modules.update({"fastapi": _fa, "fastapi.responses": _fr, "starlette": types.ModuleType("starlette"),
                    "starlette.concurrency": _sc})

WORK = tempfile.mkdtemp(prefix="hotline-doors-")
OUT = os.path.join(WORK, "snapshot")
os.makedirs(OUT)
with tarfile.open(fileobj=io.BytesIO(base64.b64decode(os.environ["SNAP"])), mode="r:gz") as tar:
    tar.extractall(OUT, filter="data")
with open(os.path.join(WORK, "routes.json"), "w") as fh:
    fh.write(os.environ["FD_ROUTES"])
REF_DAILY = json.loads(os.environ.get("REF_DAILY") or "null")
OWNER = (f"host={os.environ['HUB_DB_HOST']} dbname={os.environ['POSTGRES_DB']} user={os.environ['POSTGRES_USER']} "
         f"password={os.environ['POSTGRES_PASSWORD']}")
os.environ.update({"HUB_SNAPSHOT_OUT": OUT, "HUB_MIRROR_FIRST_DIR": os.path.join(OUT, "mirror-first"),
                   "HUB_FRONT_DOOR_ROUTES": os.path.join(WORK, "routes.json"), "HUB_DB_DSN": OWNER})
RO = "-c default_transaction_read_only=on"

import lanes_pg  # noqa: E402

lanes_pg.CONNECT["own"] = lanes_pg.CONNECT["spare"] = lambda: psycopg.connect(OWNER, autocommit=True, options=RO)
lanes_pg.CONNECT["intel"] = lambda: psycopg.connect(os.environ["MIRROR_DSN"], autocommit=True, options=RO)

import front_door as FD  # noqa: E402
import gsjs  # noqa: E402
import hotline_doors as HD  # noqa: E402
import hotline_lanes as HL  # noqa: E402
import lane_gate as LG  # noqa: E402

ok = failed = 0


def check(label, cond, detail=""):
    global ok, failed
    if cond:
        ok += 1
        print("  ok  ", label)
    else:
        failed += 1
        print("  FAIL", label, str(detail)[:1500])


class Req:
    def __init__(self, token="", query=None):
        self.headers = {"authorization": "Bearer " + token} if token else {}
        self.query_params = dict(query or {})


def ask(handler, token="", **query):
    r = asyncio.run(handler(Req(token, query)))
    return json.loads(r.body), r.body


# ---- which doors are taken: the three that read none of the relay's memory --------------------------------------------
class RecApp:
    def __init__(self):
        self.paths = []

    def __getattr__(self, method):
        def deco(path):
            self.paths.append((method.upper(), path))
            return lambda f: f
        return deco


rec = RecApp()
HD.install(rec)
check("install: the call list, a call's words, the lanes and both daily notes doors (the calls are "
      "tools/test-hotline-app.py's)",
      rec.paths == [("GET", "/hub-lanes/hotline/calls"), ("GET", "/hub-lanes/hotline/call/{call_id}"),
                    ("GET", "/hub-lanes/hotline/lanes"), ("GET", "/hub-lanes/hotline/daily-notes"),
                    ("GET", "/hub-lanes/clients/daily")], rec.paths)

# ---- the session verdicts and the access rows the gate judges, stood in for -------------------------------------------
S = FD.Session
SESSIONS = {"t-desk": S(ok=True, role="manager", uid="u-desk"), "t-staff": S(ok=True, role="staff", uid="u-staff"),
            "t-client": S(ok=True, role="client", uid="u-client"), "t-guard": S(ok=True, role="manager", uid="u-guard"),
            "t-master": S(ok=True, role="admin", uid="u-master", is_master=True)}


async def _session(token):
    return SESSIONS.get(token)

FD.session = _session
USERS = [{"userid": "u-desk", "role": "manager", "types": "MANAGER", "active": True},
         {"userid": "u-staff", "role": "staff", "types": "STAFF", "active": True},
         {"userid": "u-client", "role": "client", "types": "CLIENT"},
         {"userid": "u-guard", "role": "manager", "types": "MANAGER, GUARDIAN"},
         {"userid": "u-master", "role": "admin", "types": ""}]
RULES = [{"appid": "smartcomms", "badges": "MANAGER, ADMIN"}, {"appid": "clients", "badges": "MANAGER, CLIENT"}]


class _Ref:
    def __init__(self, name):
        self.name, self.headers = name, [name]


class _Res:
    def __init__(self, ref):
        self.ref, self.book_known = ref, True


class _DB:
    def resolve(self, tab):
        return _Res(_Ref(tab) if tab in ("app_badge_access", "app_tenant_access") else None)

    def normalized_rows(self, ref):
        return list(RULES) if ref.name == "app_badge_access" else []


class _Reads:
    db = _DB()

    def users(self):
        return list(USERS)

    def config(self):
        return {}


LG.in_reads = lambda fn: fn(_Reads())

# ---- the gate, in the relay's words -----------------------------------------------------------------------------------
got, raw = ask(HD.hotline_lanes_door)
check("lanes: no session is told to sign in, byte for byte as the relay renders it",
      raw == b'{"status":401,"reason":"session","message":"sign in first"}', raw)
got, _ = ask(HD.daily_notes_door, "t-staff")
check("daily notes: a badge Smart Comms is not open to is refused, its reason named",
      got == {"status": 403, "reason": "badge", "message": "Smart Comms is not open to this account's badges."}, got)
got, _ = ask(HD.clients_daily_door, "t-client", client="x")
check("client daily: the client role is refused before anything is read",
      got == {"status": 403, "reason": "restricted", "message": "Client Care is not served to the client role here."},
      got)
got, _ = ask(HD.clients_daily_door, "t-guard", client="x")
check("client daily: an account whose badges speak for a client is refused",
      got == {"status": 403, "reason": "restricted",
              "message": "Staff daily notes are not open to an account that is, or speaks for, a client."}, got)
got, _ = ask(HD.clients_daily_door, "t-desk")
check("client daily: no client named is a 400", got == {"status": 400, "message":
                                                         "Say which client: ?client=<the client's name>."}, got)
got, _ = ask(HD.hotline_lanes_door, "t-desk", name="nope")
check("lanes: a lane that is not one of the three is a 400 naming them",
      got == {"status": 400, "message": "Say which lane: ?name=callOffs | supportQueue | uiIncidents."}, got)

# ---- the lanes, off asa-hub-db --------------------------------------------------------------------------------------
LANE_WORDS = ["age_ms", "at", "count", "error", "label", "name", "ok", "read_at", "reason", "rows", "source", "stale",
              "version"]
got, _ = ask(HD.hotline_lanes_door, "t-desk")
data = got.get("data") or {}
lanes = data.get("lanes") or {}
check("lanes: 200 with the answer's four words and the three lanes", got.get("status") == 200
      and sorted(data) == ["built_at", "lanes", "unchanged", "version"] and sorted(lanes) == sorted(HL.LANE_KEYS),
      {k: v for k, v in got.items() if k != "data"})
check("lanes: each lane carries the relay's words, read and current", all(
    sorted(lane) == LANE_WORDS and lane["ok"] and not lane["stale"] and lane["count"] for lane in lanes.values()),
    {k: {w: v for w, v in lane.items() if w != "rows"} for k, lane in lanes.items()})
check("lanes: each lane is read from its data house, as the switchboard places it",
      {k: lane["source"]["pointer"] for k, lane in lanes.items()} == {k: "house" for k in HL.LANE_KEYS},
      {k: lane["source"] for k, lane in lanes.items()})
check("lanes: the caller's number is never among a lane's cells", not any(
    set(lane["source"]["fields"]) & {"caller", "caller_phone", "phone", "phone_number"} for lane in lanes.values()))
again, _ = ask(HD.hotline_lanes_door, "t-desk", since=data.get("version", ""))
check("lanes: asked since its version, the rows are absent (never null) and the answer is unchanged",
      again.get("data", {}).get("unchanged") is True
      and all("rows" not in lane for lane in again["data"]["lanes"].values()), again.get("data", {}).get("unchanged"))
one, _ = ask(HD.hotline_lanes_door, "t-desk", name="SUPPORTQUEUE")
check("lanes: one lane asked by name, case aside", sorted(one.get("data", {}).get("lanes") or {}) == ["supportQueue"])
import hotline_desk  # noqa: E402

kept_dir = hotline_desk.KEPT_DIR
hotline_desk.KEPT_DIR = hotline_desk.Path(WORK) / "no-kept-copies"
hotline_desk._LEARNED["at"] = 0.0
HL.invalidate()
gone, _ = ask(HD.hotline_lanes_door, "t-desk")
declared = dict(hotline_desk.DECLARED_ZONES)
hotline_desk.DECLARED_ZONES.clear()
HL.invalidate()
bare, _ = ask(HD.hotline_lanes_door, "t-desk")
hotline_desk.DECLARED_ZONES.update(declared)
check("lanes: with the relay's kept copies gone, the declared zones read every date cell the same (the bare "
      "default would move them)",
      all(gone["data"]["lanes"][k]["ok"] and gone["data"]["lanes"][k]["rows"] == lanes[k]["rows"]
          for k in HL.LANE_KEYS) and bare["data"]["lanes"]["uiIncidents"]["rows"] != lanes["uiIncidents"]["rows"],
      [k for k in HL.LANE_KEYS if gone["data"]["lanes"][k]["rows"] != lanes[k]["rows"]])
hotline_desk.KEPT_DIR = kept_dir
hotline_desk._LEARNED["at"] = 0.0
HL.invalidate()

KEPT = os.path.join(OUT, "mirror-first", "hotline-lanes.private.json")
if os.path.exists(KEPT):
    copies = json.load(open(KEPT))["copies"]
    for key in HL.LANE_KEYS:
        kept = (copies.get(f"lane:{key}") or {}).get("value") or {}
        lane = lanes.get(key) or {}
        mine = {r["id"]: r for r in lane.get("rows") or []}
        theirs = {r["id"]: r for r in kept.get("rows") or []}
        both = sorted(set(mine) & set(theirs))
        same = [i for i in both if mine[i] == theirs[i]]
        differ = [(i, {k: (theirs[i].get(k), mine[i].get(k)) for k in set(mine[i]) | set(theirs[i])
                       if mine[i].get(k) != theirs[i].get(k)}) for i in both if mine[i] != theirs[i]]
        zone = kept.get("zone") or HL.LANE_DECLARED_ZONE

        def serial_shown(relay, app):
            # an undeclared date cell: the relay's live read gave the bare serial, the copy holds what the book shows
            return (re.fullmatch(r"\d{5}(?:\.\d+)?", str(relay or "")) is not None
                    and gsjs.parse_when(str(relay), zone) == gsjs.parse_when(app, zone) is not None)

        unexplained = [(i, d) for i, d in differ if not all(serial_shown(r, a) for r, a in d.values())]
        print(f"        {key}: relay read {len(theirs)} row(s), app {len(mine)}; {len(both)} in both, "
              f"{len(same)} identical, {len(differ) - len(unexplained)} differing only where the relay gave a bare "
              f"serial; only the relay's {len(set(theirs) - set(mine))}, only the app's {len(set(mine) - set(theirs))}")
        check(f"lanes: {key} reads the book and the cells the relay's live read did",
              (kept.get("book") or {}).get("sheet_id") and lane["source"]["fields"] == kept.get("fields"),
              (lane.get("source"), kept.get("book"), kept.get("fields")))
        check(f"lanes: {key}'s rows the relay read are the app's, cell for cell (a bare serial as the book shows it)",
              both and not unexplained, unexplained[:5])

# ---- the daily notes, off asa-hub-db and the house calendars' grids ---------------------------------------------------
got, _ = ask(HD.daily_notes_door, "t-desk")
book = got.get("data") or {}
check("daily notes: 200 with the relay's words", got.get("status") == 200 and sorted(book) == sorted(
    ["built_at", "source_at", "version", "notes", "unmatched", "sources"]), {k: v for k, v in got.items()
                                                                            if k != "data"} or sorted(book))
check("daily notes: the notes, the clients and the schedule all read",
      all((book.get("sources") or {}).get(k, {}).get("ok") for k in ("notes", "clients", "schedule")),
      book.get("sources"))
check("daily notes: no shift comes from the old platform's parsed archive",
      not any(n["shift"]["source"] == "parsed" for n in book.get("notes") or []))
NOTE_WORDS = ("id", "key", "call_id", "reporting_date", "call_at", "dsp_name", "category", "category_label", "kind",
              "response", "client", "client_match", "written_as")
if REF_DAILY:
    mine = {n["id"]: n for n in book.get("notes") or []}
    theirs = {n["id"]: n for n in REF_DAILY["notes"]}
    check("daily notes: the same notes as the relay's book, in its order",
          [n["id"] for n in book.get("notes") or []] == [n["id"] for n in REF_DAILY["notes"]],
          (len(mine), len(theirs)))
    differ = [i for i in theirs if i in mine and any(mine[i][w] != theirs[i][w] for w in NOTE_WORDS)]
    check("daily notes: every note's words, client and match are the relay's", not differ,
          [(i, {w: (theirs[i][w], mine[i][w]) for w in NOTE_WORDS if mine[i][w] != theirs[i][w]})
           for i in differ[:5]])
    check("daily notes: the unmatched names are the relay's", book.get("unmatched") == REF_DAILY["unmatched"],
          (book.get("unmatched"), REF_DAILY["unmatched"]))
    moved = [i for i in theirs if i in mine and mine[i]["shift"] != theirs[i]["shift"]]
    parsed = [i for i in moved if theirs[i]["shift"]["source"] == "parsed"]
    spelled = [i for i in moved if i not in parsed and theirs[i]["shift"]["staff_match"]
               and not mine[i]["shift"]["staff_match"] and {k for k in mine[i]["shift"]
                                                            if mine[i]["shift"][k] != theirs[i]["shift"][k]}
               == {"staff_match"}]
    print(f"        shifts: {len(theirs) - len(moved)} of {len(theirs)} identical to the relay's; {len(parsed)} the "
          f"relay matched off the old platform's parsed archive, {len(spelled)} whose DSP only the old platform's "
          "calendar copies spell")
    check("daily notes: a shift differs only where the relay read the old platform's calendar copies",
          len(parsed) + len(spelled) == len(moved),
          [(i, {"relay": theirs[i]["shift"], "app": mine[i]["shift"]}) for i in moved
           if i not in parsed and i not in spelled][:3])
    check("daily notes: every shift the relay matched off the live calendar or the archive is matched here",
          all(mine[i]["shift"] == n["shift"] for i, n in theirs.items()
              if n["shift"]["via"] == "schedule" and n["shift"]["source"] in ("live", "archive")))

# ---- one client's notes ---------------------------------------------------------------------------------------------
named = {}
for n in book.get("notes") or []:
    if n["client"]:
        named[n["client"]] = named.get(n["client"], 0) + 1
if named:
    who = max(named, key=lambda c: (named[c], c))
    got, _ = ask(HD.clients_daily_door, "t-desk", client=who)
    data = got.get("data") or {}
    check("client daily: 200 with that client's notes alone, the book's own",
          got.get("status") == 200 and data.get("client") == who
          and data.get("notes") == [n for n in book["notes"] if n["client"] == who]
          and sorted(data) == ["built_at", "client", "notes", "sources", "unmatched", "version"],
          {k: v for k, v in got.items() if k != "data"})
    got, _ = ask(HD.clients_daily_door, "t-master", client=who)
    check("client daily: the master is not narrowed by the badge check", got.get("status") == 200,
          {k: v for k, v in got.items() if k != "data"})
got, _ = ask(HD.clients_daily_door, "t-desk", client="Nobody Of That Name Qz")
check("client daily: a name not in the clients list is a 404",
      got == {"status": 404, "message": "That client is not in the clients list."}, got)

check("Google is never imported", not any(m.startswith(("googleapiclient", "google.oauth2")) for m in sys.modules))
print(json.dumps({"ok": ok, "failed": failed}))
