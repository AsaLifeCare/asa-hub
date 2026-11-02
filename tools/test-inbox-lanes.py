"""asa-hub-app's bell and My Inbox (app/inbox_lanes.py, app/web_notices.py, app/inbox_family.py) run in-process with
the app's own modules: the four doors' happy paths and refusals. The relay's own tables (asa_hub_notices,
asa_hub_notice_reads, asa_hub_inbox_reads, asa_hub_inbox_seen) are pg_temp copies of the live rows, on a connection
whose role cannot write app.*; two notices are added to the copy only. The readers, roster names and house directory
are read live off asa-hub-db; the session verdicts, App Control's rows, Python's doors (myInboxView, myInboxRead,
myFamily), the accounts list and test mode are stood in for. Nothing is written to a live table.

Run inside asa-hub-db-sync by the in-process runner (run.sh, which loads the test from beside its drv.py):

    cp tools/test-inbox-lanes.py "$RUNNER/test_inbox_lanes.py"
    E=$(python3 -c 'import json;print(json.dumps({"HUB_IST_CONFIG_DECLARATION_JSON":
        open("app/ist_config_defaults.json").read()}))')
    sh "$RUNNER/run.sh" "$PWD/app" "$RUNNER/test_inbox_lanes.py" "$E"
"""
import logging

logging.disable(logging.CRITICAL)
import asyncio  # noqa: E402
import json  # noqa: E402
import os  # noqa: E402
import sys  # noqa: E402
import time  # noqa: E402
import types  # noqa: E402
from dataclasses import dataclass  # noqa: E402

import psycopg  # noqa: E402


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
_fa.Request, _fa.FastAPI = object, object
_fr = types.ModuleType("fastapi.responses")
_fr.JSONResponse = _fr.Response = _Resp
_sc = types.ModuleType("starlette.concurrency")
_sc.run_in_threadpool = _threadpool
sys.modules.update({"fastapi": _fa, "fastapi.responses": _fr, "starlette": types.ModuleType("starlette"),
                    "starlette.concurrency": _sc})

OWNER = (f"host={os.environ['HUB_DB_HOST']} dbname={os.environ['POSTGRES_DB']} user={os.environ['POSTGRES_USER']} "
         f"password={os.environ['POSTGRES_PASSWORD']}")
os.environ["HUB_DB_DSN"] = OWNER
os.environ["HUB_SERVICE_SECRET"] = "inbox-test-secret"


@dataclass(frozen=True)
class Session:
    ok: bool
    role: str = ""
    uid: str = ""
    is_master: bool = False
    acting: bool = False

    @property
    def master(self) -> bool:
        return self.ok and self.role == "admin" and not self.acting and self.is_master


SESSIONS = {"t-staff": Session(ok=True, role="staff", uid="u-staff"),
            "t-dir": Session(ok=True, role="director", uid="u-dir"),
            "t-dir2": Session(ok=True, role="director", uid="u-dir2"),
            "t-master": Session(ok=True, role="admin", uid="u-master", is_master=True),
            "t-client": Session(ok=True, role="client", uid="u-client"),
            "t-switched": Session(ok=True, role="staff", uid="u-staff", acting=True),
            "t-onb": Session(ok=True, role="onboarding", uid="u-onb"),
            "t-noid": Session(ok=True, role="staff", uid=""),
            "t-out": Session(ok=False)}
calls: list = []
ANSWERS: dict = {}
voided: list = []
_fd = types.ModuleType("front_door")
_fd.Session, _fd.M = Session, None


async def _session(token):
    return SESSIONS.get(token) if token != "t-unread" else None


def _said(s, env, action):
    user = {"uid": s.uid, "role": s.role.strip().lower(), "is_master": s.master, "place": {}, "asked": action}
    if s.acting:
        user = {**user, "acting": True, "unlogged": True, "is_master": False}
    return user


async def _call_app(app_id, action, user, payload, write_id="", at=0.0):
    calls.append({"app": app_id, "action": action, "user": dict(user), "payload": dict(payload), "write": write_id})
    got = ANSWERS.get(action)
    env = got(user, payload) if callable(got) else got
    if env is None:
        return None
    return json.dumps(env).encode(), time.time(), env, None, 0.0


_fd.session, _fd.said, _fd.call_app = _session, _said, _call_app
_fd.people_at = lambda: 0.0
_fd.settle_void_soon = lambda app_id, wid: voided.append((app_id, wid))
_fd.header = lambda resp, name: None
sys.modules["front_door"] = _fd

# the relay's own tables as this session's pg_temp copies of the live rows, on a connection that cannot write app.*
LIVE = psycopg.connect(OWNER, autocommit=True)
LIVE.execute("set session characteristics as transaction read only")
TEST = psycopg.connect(OWNER, autocommit=True)
TEST.execute("set role asa_hub_app_ro")
TEST.execute("create temp table asa_hub_notices (id bigint primary key, key text not null unique, kind text not null,"
             " at timestamptz not null default now(), location text not null default '', col_iso text not null"
             " default '', ref text not null default '', value text not null default '', facts jsonb not null"
             " default '{}'::jsonb, created_at timestamptz not null default now(), held_test boolean not null"
             " default false)")
TEST.execute("create temp table asa_hub_notice_reads (user_id text not null, notice_id bigint not null, read_at"
             " timestamptz not null default now(), dismissed_at timestamptz, primary key (user_id, notice_id))")
TEST.execute("create temp table asa_hub_inbox_reads (user_id text not null, alert_key text not null, read_at"
             " timestamptz not null default now(), dismissed_at timestamptz, primary key (user_id, alert_key))")
TEST.execute("create temp table asa_hub_inbox_seen (kind text not null, key text not null, first_seen timestamptz"
             " not null default now(), primary key (kind, key))")
COPIED = {}
for table, cols in (("asa_hub_notices", "id, key, kind, at, location, col_iso, ref, value, facts, created_at, held_test"),
                    ("asa_hub_notice_reads", "user_id, notice_id, read_at, dismissed_at"),
                    ("asa_hub_inbox_reads", "user_id, alert_key, read_at, dismissed_at"),
                    ("asa_hub_inbox_seen", "kind, key, first_seen")):
    rows = LIVE.execute(f"select {cols} from app.{table}").fetchall()
    COPIED[table] = len(rows)
    if rows:
        marks = ",".join(["%s"] * len(cols.split(",")))
        with TEST.cursor() as cur:
            cur.executemany(f"insert into pg_temp.{table} ({cols}) values ({marks})",
                            [tuple(psycopg.types.json.Jsonb(v) if isinstance(v, (dict, list)) else v for v in r)
                             for r in rows])
LIVE.close()
TOP = TEST.execute("select coalesce(max(id), 0) from pg_temp.asa_hub_notices").fetchone()[0]
NO_SHOW, DECIDED = TOP + 1, TOP + 2
TEST.execute("insert into pg_temp.asa_hub_notices (id, key, kind, location, col_iso, facts) values "
             "(%s, 'test:no_show', 'no_call_no_show', 'TST9999', '2026-10-25', '{\"person\": \"Pat Q\"}'),"
             "(%s, 'test:decided', 'decided', 'TST9999', '2026-10-26', "
             "'{\"person\": \"Pat Q\", \"house\": \"Test House\"}')", (NO_SHOW, DECIDED))
TOP = DECIDED

import lanes_pg  # noqa: E402

lanes_pg.SCHEMA = "pg_temp"
lanes_pg.CONNECT["own"] = lanes_pg.CONNECT["spare"] = lambda: TEST
_close = lanes_pg._close
lanes_pg._close = lambda c: None if c is TEST else _close(c)

import live_notify  # noqa: E402

dirty: list = []
live_notify.dirty = lambda names: dirty.append(sorted(names)) or sorted(names)

import inbox_family as IF  # noqa: E402
import inbox_lanes as IL  # noqa: E402
import lane_gate as LG  # noqa: E402
import my_inbox as MI  # noqa: E402
import sched_lanes as SL  # noqa: E402
import web_notices as WN  # noqa: E402

# the tables are the copies above: nothing is made, and no invitation is judged (one connection, no spare)
WN._READY.add(SL.PG_DSN)
IF._READY.add(SL.PG_DSN)
WN._Ctx._eligible = lambda self, n, person: False
SWITCH = {"on": False, "readable": True, "word": "off", "why": ""}
SL._test_switch = lambda: dict(SWITCH)
OFF_MAP = {"u-dir": ["no_call"]}
IL._OFF.update(at=time.time() + 3600, map=OFF_MAP)
ACCOUNTS = [{"uid": "u-chosen", "role": "staff", "types": "STAFF", "label": "Chosen One", "unlisted": ""}]
IL._accounts = lambda: list(ACCOUNTS)


class Ref:
    def __init__(self, name):
        self.name, self.headers, self.table = name, [name], "t"


class Res:
    def __init__(self, ref):
        self.ref, self.book_known = ref, True


USERS = [{"userid": "u-staff", "role": "staff", "types": "STAFF", "active": True},
         {"userid": "u-dir", "role": "director", "types": "DIRECTOR"},
         {"userid": "u-dir2", "role": "director", "types": "DIRECTOR"},
         {"userid": "u-master", "role": "admin", "types": ""},
         {"userid": "u-client", "role": "client", "types": "CLIENT"},
         {"userid": "u-onb", "role": "onboarding", "types": "ONBOARDING"}]
RULES = [{"appid": "my-inbox", "badges": "STAFF, DIRECTOR, CLIENT"}, {"appid": "staff-profiles", "badges": "CLIENT"}]


class DB:
    def resolve(self, tab):
        return Res(Ref(tab) if tab in ("app_badge_access", "app_tenant_access") else None)

    def normalized_rows(self, ref):
        return list(RULES) if ref.name == "app_badge_access" else []


class Reads:
    db = DB()

    def users(self):
        return list(USERS)

    def config(self):
        return {}


LG.in_reads = lambda fn: fn(Reads())

out: dict = {}
fails: list = []


def check(name, cond, got=None):
    out[name] = "ok" if cond else {"FAILED": got}
    if not cond:
        fails.append(name)


class Req:
    def __init__(self, token="", query=None, body=b""):
        self.headers = {"authorization": "Bearer " + token} if token else {}
        self.query_params = dict(query or {})
        self._raw = body if isinstance(body, bytes) else json.dumps(body).encode()

    async def body(self):
        return self._raw


def ask(handler, req, **kw):
    r = asyncio.run(handler(req, **kw))
    return (json.loads(r.body) if r.body else None), r


def rows(sql, args=()):
    return TEST.execute(sql, args).fetchall()


try:
    # ---- install ---------------------------------------------------------------------------------------------------
    class RecApp:
        def __init__(self):
            self.paths = []

        def __getattr__(self, method):
            def deco(path):
                self.paths.append((method.upper(), path))
                return lambda f: f
            return deco

    rec = RecApp()
    IL.install(rec)
    check("install: the four doors", sorted(rec.paths) == [("GET", "/hub-lanes/my-inbox"), ("GET", "/hub-lanes/notices"),
                                                           ("POST", "/hub-lanes/my-inbox/read"),
                                                           ("POST", "/hub-lanes/notices/read")], rec.paths)

    # ---- the bell --------------------------------------------------------------------------------------------------
    got, _r = ask(IL.notices, Req(), since=0, limit=60)
    check("bell: no session is the relay's 401", got == {"status": 401, "message": "sign in first"}, got)
    got, _r = ask(IL.notices, Req("t-dir2"), since=0, limit=200)
    data = got.get("data") or {}
    ids = [n.get("id") for n in data.get("notices") or []]
    held_ids = {r[0] for r in rows("select id from pg_temp.asa_hub_notices where held_test")}
    check("bell: a director's bell, its envelope and keys", got.get("status") == 200 and set(data) ==
          {"notices", "unread", "seq", "since", "me", "held", "truncated"} and data["held"] == "" and
          data["seq"] == TOP, got)
    check("bell: no held row and no facts leave", ids and not set(ids) & held_ids and
          not any("facts" in n for n in data["notices"]), ids)
    check("bell: the no-show at a house reaches a director who decides everywhere", NO_SHOW in ids, ids)
    check("bell: unread counts every notice heard", data["unread"] == sum(1 for n in data["notices"]
                                                                          if not n["read"]), data["unread"])
    got, _r = ask(IL.notices, Req("t-dir"), since=0, limit=200)
    cut = [n.get("id") for n in (got.get("data") or {}).get("notices") or []]
    check("bell: the alert a director turned off is never heard", NO_SHOW not in cut and DECIDED in cut, cut)
    got, _r = ask(IL.notices, Req("t-dir2"), since=TOP - 1, limit=60)
    check("bell: since returns only newer ids", [n["id"] for n in got["data"]["notices"]] == [TOP], got)
    got, _r = ask(IL.notices, Req("t-dir2"), since=0, limit=1)
    check("bell: limit caps the list", len(got["data"]["notices"]) == 1, got)
    SWITCH.update(on=True, word="on")
    got, _r = ask(IL.notices, Req("t-dir2"), since=0, limit=60)
    check("bell: test mode holds it whole", got.get("data") == {"notices": [], "unread": 0, "seq": TOP, "since": 0,
                                                                "me": "", "held": "test mode"}, got)
    SWITCH.update(readable=False, word="unreadable")
    got, _r = ask(IL.notices, Req("t-dir2"), since=0, limit=60)
    check("bell: an unreadable switch holds it, said", got["data"]["held"] == "test mode (unreadable, so treated as "
                                                                              "on)", got)
    SWITCH.update(on=False, readable=True, word="off")

    # ---- the bell's marks ------------------------------------------------------------------------------------------
    got, _r = ask(IL.notices_read, Req(body={"ids": [1]}))
    check("bell read: no session is 401", got == {"status": 401, "message": "sign in first"}, got)
    got, _r = ask(IL.notices_read, Req("t-noid", body={"ids": [1]}))
    check("bell read: a session without an account", got == {"status": 403, "message": "this session carries no "
                                                                                       "account to keep the reads for"},
          got)
    got, _r = ask(IL.notices_read, Req("t-dir2", body=b"not json"))
    check("bell read: a body that is not JSON", got == {"status": 400, "message": "invalid body"}, got)
    got, _r = ask(IL.notices_read, Req("t-dir2", body={"ids": []}))
    check("bell read: no ids", got == {"status": 400, "message": "ids is required"}, got)
    got, r = ask(IL.notices_read, Req("t-switched", body={"ids": [DECIDED]}))
    check("bell read: a switched session is the write guard's 409", r.status_code == 409 and got ==
          {"status": 409, "code": "be_another_refused", "message": "Not in a switched session: this door cannot "
                                                                   "take the write. Press Be Back to do this as "
                                                                   "yourself."}, (r.status_code, got))
    dirty.clear()
    got, _r = ask(IL.notices_read, Req("t-dir2", body={"ids": [NO_SHOW, DECIDED]}))
    kept = rows("select notice_id, dismissed_at is null from pg_temp.asa_hub_notice_reads where user_id = 'u-dir2' "
                "order by 1")
    check("bell read: marked, kept in the copy, and my-inbox rung",
          got == {"status": 200, "data": {"marked": 2}} and kept == [(NO_SHOW, True), (DECIDED, True)]
          and dirty == [["my-inbox"]], (got, kept, dirty))
    ask(IL.notices_read, Req("t-dir2", body={"ids": [DECIDED], "dismiss": True}))
    got, _r = ask(IL.notices, Req("t-dir2"), since=0, limit=200)
    mine = {n["id"]: n for n in got["data"]["notices"]}
    check("bell read: a read one says so, a dismissed one is gone", mine.get(NO_SHOW, {}).get("read") is True
          and DECIDED not in mine, sorted(mine)[-3:])

    # ---- My Inbox: the gate ------------------------------------------------------------------------------------------
    got, r = ask(IL.my_inbox, Req("t-staff", query={"member": "m-1"}))
    check("inbox: a visit is refused first", got == {"status": 403, "reason": "visit", "message": IL.VISIT}, got)
    got, r = ask(IL.my_inbox, Req())
    check("inbox: no session", got.get("status") == 401 and got.get("reason") == "session", got)
    got, r = ask(IL.my_inbox, Req("t-unread"))
    check("inbox: a verdict nobody could read", got == IL.UNSIGNED, got)
    got, r = ask(IL.my_inbox, Req("t-onb"))
    check("inbox: a refused role", got.get("status") == 403 and got.get("reason") == "restricted", got)

    # ---- My Inbox: Python's read, with what the relay handed it ---------------------------------------------------------
    def view(user, payload):
        person = payload.get("person") or ""
        mass = payload.get("mode") == "mass"
        return {"status": 200, "data": {"subject": {"name": ""}, "heads": [], "items": [], "unread": 0, "capped": "",
                                        "marks": {}, "read_at": "2026-10-25T00:00:00Z",
                                        "display": {"hidden": {"inbox_sources": False}},
                                        "scope": {"mode": payload.get("mode"), "why": payload.get("why"),
                                                  "person": person if mass else "",
                                                  "readonly": bool(person) or user.get("acting") is True}}}

    ANSWERS["myInboxView"] = view
    calls.clear()
    got, r = ask(IL.my_inbox, Req("t-staff"))
    p = calls[-1]["payload"] if calls else {}
    marks = p.get("inbox_marks") or {}
    check("inbox: a staff member's own, Python's answer served whole, kept from caches",
          got.get("status") == 200 and got["data"]["scope"] == {"mode": "own", "why": "", "person": "",
                                                                "readonly": False}
          and r.headers.get("Cache-Control") == "no-store", (got, r.headers))
    check("inbox: handed — the session's marks, every first sighting, test mode and the punch board",
          marks.get("user_id") == "u-staff" and len(marks.get("seen") or []) == COPIED["asa_hub_inbox_seen"]
          and p.get("test_mode", {}).get("on") is False
          and ("punch_board" in p or p.get("punch_board_error") == "missing"), {k: p.get(k) for k in
                                                                                ("test_mode", "punch_board_error")})
    check("inbox: handed — the bell's notices for the subject", isinstance(p.get("notices"), dict)
          and p["notices"].get("seq") == TOP and calls[-1]["user"]["uid"] == "u-staff", p.get("notices"))
    SWITCH.update(on=True, word="on")
    calls.clear()
    ask(IL.my_inbox, Req("t-staff"))
    check("inbox: test mode on, no notice is handed", calls and "notices" not in calls[-1]["payload"]
          and calls[-1]["payload"]["test_mode"]["on"] is True, calls[-1]["payload"].keys() if calls else None)
    SWITCH.update(on=False, word="off")
    calls.clear()
    got, r = ask(IL.my_inbox, Req("t-master", query={"person": "u-chosen"}))
    p = calls[-1]["payload"] if calls else {}
    check("inbox: the master chooses a person, read-only, that person's marks handed",
          got.get("status") == 200 and got["data"]["scope"]["readonly"] is True and p.get("mode") == "mass"
          and p.get("person") == "u-chosen" and (p.get("inbox_marks") or {}).get("user_id") == "u-chosen"
          and calls[-1]["user"]["is_master"] is True, (got, {k: p.get(k) for k in ("mode", "person")}))
    got, r = ask(IL.my_inbox, Req("t-staff", query={"person": "bad person!"}))
    check("inbox: a person that cannot be read", got == {"status": 400, "reason": "person",
                                                         "message": "That person cannot be read."}, got)
    ANSWERS["myInboxView"] = {"status": 403, "reason": "scope", "message": "My Inbox shows only your own alerts."}
    got, r = ask(IL.my_inbox, Req("t-staff", query={"person": "u-chosen"}))
    check("inbox: an edition's ask is Python's own refusal", got == ANSWERS["myInboxView"], got)
    ANSWERS["myInboxView"] = None
    got, r = ask(IL.my_inbox, Req("t-staff", query={"person": "u-chosen"}))
    check("inbox: an edition's ask Python did not answer", got == IL.UNCHECKED, got)
    got, r = ask(IL.my_inbox, Req("t-staff"))
    check("inbox: Python did not answer", got == IL.DOWN, got)
    ANSWERS["myInboxView"] = lambda u, p: {**view(u, p), "data": {**view(u, p)["data"], "scope": {
        "mode": "mass", "why": "", "person": "", "readonly": False}}}
    got, r = ask(IL.my_inbox, Req("t-staff"))
    check("inbox: an answer that widened the scope unasked is never served", got == IL.DOWN, got)
    ANSWERS["myInboxView"] = view
    calls.clear()
    got, r = ask(IL.my_inbox, Req("t-switched"))
    check("inbox: a switched session reads its own, read-only", got.get("status") == 200
          and got["data"]["scope"]["readonly"] is True and calls[-1]["user"].get("acting") is True, got)
    got, r = ask(IL.my_inbox, Req("t-switched", query={"person": "u-chosen"}))
    check("inbox: a switched session never opens another's", got == {"status": 403, "reason": "scope",
                                                                       "message": IL.OWN_ONLY}, got)
    saved = MI.holder
    MI.holder = lambda eid, user, cfg: True
    widened = MI.scope_of({"role": "staff"}, {"mode": "own"}, {})
    kept_own = MI.scope_of({"role": "staff", "acting": True}, {"mode": "own"}, {})
    MI.holder = saved
    check("inbox: Python widens an edition's holder, never a switched session", widened.get("mode") == "mass"
          and kept_own.get("mode") == "own", (widened, kept_own))

    # ---- My Inbox: a client-role account -------------------------------------------------------------------------------
    FAMILY = {"family": True, "part": "inbox", "linked": True, "viewer": "guardian", "ward": {"name": "Ward W"},
              "house_codes": ["TST9999"], "read_at": "2026-10-25T12:00:00Z",
              "heads": [{"key": "new_staff", "state": "ok"}],
              "items": [{"type": "new_staff", "id": "fam:staff:abc123", "staff": "abc123", "title": "Ann joined",
                         "at": "2026-10-24T12:00:00Z"}]}
    ANSWERS["myFamily"] = {"status": 200, "data": FAMILY}
    IL._FAMILY_HELD.clear()
    got, r = ask(IL.my_inbox, Req("t-client"))
    d = got.get("data") or {}
    items = {i["id"]: i for i in d.get("items") or []}
    heads = {h["key"]: h for h in d.get("heads") or []}
    check("family: the board in board()'s shape", got.get("status") == 200 and d.get("family") is True
          and d.get("viewer") == "guardian" and d.get("linked") is True and d.get("ward") == {"name": "Ward W"}
          and d.get("scope") == {"mode": "own", "why": "", "person": "", "readonly": False}
          and isinstance(d.get("display"), dict), got)
    check("family: new staff, linked to Staff while it is open to the account",
          (items.get("fam:staff:abc123") or {}).get("link") == {"href": "/app/staff-profiles/profile?staff=abc123",
                                                               "label": "Open in Staff"}
          and heads.get("new_staff", {}).get("state") == "ready", (items, heads))
    check("family: who takes a shift at the house, from the bell",
          (items.get(f"srv-{DECIDED}") or {}).get("title") == "Pat Q takes the shift at Test House"
          and heads.get("notices", {}).get("state") == "ready" and f"srv-{NO_SHOW}" not in items, items)
    dirty.clear()
    got, r = ask(IL.my_inbox_read, Req("t-client", body={"keys": ["fam:staff:abc123", f"srv-{DECIDED}", 7]}))
    fam = rows("select alert_key from pg_temp.asa_hub_inbox_reads where user_id = 'u-client'")
    bell = rows("select notice_id from pg_temp.asa_hub_notice_reads where user_id = 'u-client'")
    check("family read: the alert in the relay's marks, the notice in the bell's, my-inbox rung",
          got == {"status": 200, "data": {"marked": 2, "ignored": 1}} and fam == [("fam:staff:abc123",)]
          and bell == [(DECIDED,)] and dirty == [["my-inbox"]], (got, fam, bell, dirty))
    got, r = ask(IL.my_inbox, Req("t-client"))
    items = {i["id"]: i for i in got["data"]["items"]}
    check("family: the marks read back", items["fam:staff:abc123"]["read"] is True
          and items[f"srv-{DECIDED}"]["read"] is True and got["data"]["unread"] == 0, items)
    SWITCH.update(on=True, word="on")
    got, r = ask(IL.my_inbox, Req("t-client"))
    check("family: test mode holds the notices", {h["key"]: h for h in got["data"]["heads"]}["notices"]["state"]
          == "held", got["data"]["heads"])
    SWITCH.update(on=False, word="off")
    IL._FAMILY_HELD.clear()
    ANSWERS["myFamily"] = {"status": 403, "reason": "restricted", "message": "Not yours."}
    got, r = ask(IL.my_inbox, Req("t-client"))
    check("family: the family view's refusal is answered", got == {"status": 403, "reason": "restricted",
                                                                   "message": "Not yours."}, got)

    # ---- My Inbox: the marks -------------------------------------------------------------------------------------------
    ANSWERS["myInboxRead"] = lambda u, p: {"status": 200, "data": {"marked": len(p["keys"]), "ignored": 0},
                                           "_write": {"final": True}}
    calls.clear()
    dirty.clear()
    got, r = ask(IL.my_inbox_read, Req("t-staff", body={"keys": ["punch:a:2026-10-24", f"srv-{NO_SHOW}"]}))
    kept = rows("select notice_id from pg_temp.asa_hub_notice_reads where user_id = 'u-staff'")
    check("inbox read: the alert kept by Python, the notice by the bell, my-inbox rung",
          got == {"status": 200, "data": {"marked": 2, "ignored": 0}} and calls[-1]["action"] == "myInboxRead"
          and calls[-1]["payload"] == {"keys": ["punch:a:2026-10-24"], "dismiss": False}
          and calls[-1]["write"].startswith("W") and kept == [(NO_SHOW,)] and dirty == [["my-inbox"]],
          (got, calls[-1:], kept, dirty))
    ANSWERS["myInboxRead"] = None
    voided.clear()
    got, r = ask(IL.my_inbox_read, Req("t-staff", body={"keys": ["punch:a:2026-10-24"], "dismiss": True}))
    check("inbox read: Python did not keep it — 503, its write let go", got == IL.UNMARKED and len(voided) == 1, got)
    got, r = ask(IL.my_inbox_read, Req("t-switched", body={"keys": ["punch:a:2026-10-24"]}))
    check("inbox read: a switched session is the write guard's 409", r.status_code == 409, (r.status_code, got))
    got, r = ask(IL.my_inbox_read, Req("t-staff", body={"keys": ["x"] * 501}))
    check("inbox read: too many keys", got == {"status": 400, "reason": "keys", "message": "At most 500 keys at once."},
          got)
    got, r = ask(IL.my_inbox_read, Req("t-staff", body={"keys": ["NOT A KEY"]}))
    check("inbox read: none is an alert", got == {"status": 400, "reason": "keys",
                                                  "message": "None of those keys is an alert."}, got)
    got, r = ask(IL.my_inbox_read, Req("t-staff", body={"keys": ["punch:a:b"], "member": "m-1"}))
    check("inbox read: a visit in the body", got == {"status": 403, "reason": "visit", "message": IL.VISIT}, got)
    got, r = ask(IL.my_inbox_read, Req("t-staff", body=b""))
    check("inbox read: no body", got == {"status": 400, "reason": "body", "message": "The body could not be read."},
          got)
    live_left = psycopg.connect(OWNER, autocommit=True).execute(
        "select (select count(*) from app.asa_hub_notice_reads), (select count(*) from app.asa_hub_inbox_reads), "
        "(select count(*) from app.asa_hub_notices)").fetchone()
    check("nothing reached the live tables", live_left == (COPIED["asa_hub_notice_reads"],
                                                           COPIED["asa_hub_inbox_reads"], COPIED["asa_hub_notices"]),
          live_left)
except Exception as exc:  # noqa: BLE001
    import traceback
    out["CRASH"] = traceback.format_exc()[-3000:]
    fails.append("crash")

print(json.dumps(out, indent=1, default=str))
print(f"{sum(1 for v in out.values() if v == 'ok')} ok, {len(fails)} failed" + (f": {fails}" if fails else ""))
