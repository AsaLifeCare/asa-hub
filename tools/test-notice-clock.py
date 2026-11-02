"""asa-hub-app's notices clock and strip (app/notice_clock.py, app/hub_strip.py, app/web_gate.py, app/web_push.py,
app/live_notify.py) run in-process with the app's own modules: a notice stored under test mode reaches nobody and is
written for the mockup, its push held; with test mode off a frame reaches the notice-reading stream of the reader it is
for, a switched tab never counts as online, and the push goes only to the offline account it must interrupt; a kind
whose situation is off is not stored; the relay's wake and its stored notices arrive at POST /live/wake; the wakes the
app answers are never carried to the relay; a switch move tells every shift reader; the mock rows are handed to
commMockWebIngest; the config lane is read here and told to no relay; the strip's hub frame carries the phase and the
served build.

The notice and push tables are empty pg_temp tables on a connection whose role cannot write app.*; the accounts list is
read live off asa-hub-db's users copy once, then stood in for. The readers, the sender, the door, the relay and the
quiet window are stood in for, and the ledger is a temp folder. Nothing is written to a live table, no push is sent.

Run inside asa-hub-db-sync by the in-process runner (run.sh, which loads the test from beside its drv.py):

    cp tools/test-notice-clock.py "$RUNNER/test_notice_clock.py"
    E=$(python3 -c 'import json;print(json.dumps({"HUB_IST_CONFIG_DECLARATION_JSON":
        open("app/ist_config_defaults.json").read()}))')
    sh "$RUNNER/run.sh" "$PWD/app" "$RUNNER/test_notice_clock.py" "$E"
"""
import logging

logging.disable(logging.CRITICAL)
import asyncio  # noqa: E402
import json  # noqa: E402
import os  # noqa: E402
import sys  # noqa: E402
import tempfile  # noqa: E402
import time  # noqa: E402
import types  # noqa: E402
from dataclasses import dataclass  # noqa: E402
from datetime import datetime, timedelta, timezone  # noqa: E402
from pathlib import Path  # noqa: E402

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
os.environ["HUB_APP_TOKEN"] = "notice-test-token"
os.environ.pop("HUB_CHAT_RELAY_FRAMES", None)
LEDGER = Path(tempfile.mkdtemp(prefix="notice-ledger-"))
WEB = Path(tempfile.mkdtemp(prefix="notice-web-"))


@dataclass(frozen=True)
class Session:
    ok: bool
    role: str = ""
    uid: str = ""
    is_master: bool = False
    acting: bool = False


_fd = types.ModuleType("front_door")
_fd.Session, _fd.M, _fd.RUNGS, _fd.SESSIONS_FORGOTTEN = Session, None, {}, []


async def _session(token):
    return None


_fd.session = _session
_fd.settle_void_soon = lambda app_id, wid: None
_fd.header = lambda resp, name: None
sys.modules["front_door"] = _fd

# the door and the clocks' identity, stood in for: no mock row reaches the outbox's sheet
door_calls: list = []
_clocks = types.ModuleType("clocks")
_clocks.ON, _clocks.PACK_S = True, 60.0
_clocks.write_id = lambda tag: "Wtest-" + tag
voided: list = []
_clocks.void_soon = lambda app_id, wid: voided.append((app_id, wid))


async def _door(app_id, action, payload, wid="", wait=10.0):
    door_calls.append({"app": app_id, "action": action, "rows": [r["id"] for r in payload.get("rows") or []],
                       "wid": wid})
    return {"status": 200, "data": {"written": [r["id"] for r in payload.get("rows") or []], "refused": []}}, ""


_clocks.call = _door
sys.modules["clocks"] = _clocks

TEST = psycopg.connect(OWNER, autocommit=True)
TEST.execute("set role asa_hub_app_ro")
TEST.execute("create temp table asa_hub_notices (id bigserial primary key, key text not null unique, kind text not"
             " null, at timestamptz not null default now(), location text not null default '', col_iso text not null"
             " default '', ref text not null default '', value text not null default '', facts jsonb not null"
             " default '{}'::jsonb, created_at timestamptz not null default now(), held_test boolean not null"
             " default false)")
TEST.execute("create temp table asa_hub_notice_reads (user_id text not null, notice_id bigint not null, read_at"
             " timestamptz not null default now(), dismissed_at timestamptz, primary key (user_id, notice_id))")
TEST.execute("create temp table asa_hub_push_subs (endpoint text primary key, user_id text not null, p256dh text not"
             " null, auth text not null, role text not null default '', ua text not null default '', created_at"
             " timestamptz not null default now(), seen_at timestamptz not null default now(), last_ok_at timestamptz,"
             " last_status int, fails int not null default 0)")
TEST.execute("create temp table asa_hub_push_outbox (notice_id bigint not null, user_id text not null, state text not"
             " null, held_by text not null default '', words jsonb not null default '{}'::jsonb, devices int not null"
             " default 0, tries int not null default 0, why text not null default '', created_at timestamptz not null"
             " default now(), updated_at timestamptz not null default now(), sent_at timestamptz, primary key"
             " (notice_id, user_id))")
TEST.execute("insert into pg_temp.asa_hub_push_subs (endpoint, user_id, p256dh, auth) values "
             "('https://push.test/a', 'u-a', 'k', 'a'), ('https://push.test/c', 'u-c', 'k', 'a')")

import lanes_pg  # noqa: E402

lanes_pg.SCHEMA = "pg_temp"
lanes_pg.CONNECT["own"] = lanes_pg.CONNECT["spare"] = lambda: TEST
_close = lanes_pg._close
lanes_pg._close = lambda c: None if c is TEST else _close(c)

import chat_doors as CD  # noqa: E402
import hub_strip as HS  # noqa: E402
import live_events  # noqa: E402
import live_notify  # noqa: E402
import live_slices  # noqa: E402
import notice_clock as NC  # noqa: E402
import sched_lanes as SL  # noqa: E402
import shift_requests  # noqa: E402
import web_gate as WG  # noqa: E402
import web_notices as WN  # noqa: E402
import web_push as WP  # noqa: E402

WN._READY.add(SL.PG_DSN)
WP._READY.add(SL.PG_DSN)
WN._Ctx._eligible = lambda self, n, person: False
WG.MOCK_DIR = LEDGER
WG.quiet = lambda at: False
HS.WEB_INDEX = WEB / "index.html"
live_events.TOKEN[0] = "notice-test-token"

dirty: list = []
live_notify.dirty = lambda names: dirty.append(sorted(names)) or sorted(names)
carried: list = []
live_notify.tell_now = lambda **said: carried.append(said)
told_relay: list = []
_urlopen = live_notify.urllib.request.urlopen
live_notify.urllib.request.urlopen = lambda req, *a, **k: (
    told_relay.append(getattr(req, "full_url", req)) if "asa-hub-snapshot" in str(getattr(req, "full_url", req))
    else None) or _urlopen(req, *a, **k)
rostered: list = []
SL._roster_published = lambda event: rostered.append(event)
SL._housecal_rang = lambda: rostered.append("housecal")

NAMES = {"u-a": "Pat Quill", "u-b": "Bo Other", "u-c": "Pat Quill"}
SL._roster_name_of = lambda uid, strict=False: NAMES.get(uid, "")
SL._user_badges = lambda uid: "STAFF"
shift_requests.viewer = lambda dsn, *, name, role="", types=None, is_master=None: {
    "name": name, "role": role, "badges": ["STAFF"], "whole_company": False, "is_master": bool(is_master)}
sent: list = []


def _sender(device, payload, *, vapid, ttl, urgent):
    sent.append({"to": device["user_id"], "title": payload.get("title"), "urgent": urgent})
    return "ok", 201, ""


WP.send_one = _sender
WP.keys = lambda path=None: {"ok": True, "public_key": "p", "private_key": "k", "subject": "mailto:t@test", "why": ""}

out: dict = {}
fails: list = []


def check(name, cond, got=None):
    out[name] = "ok" if cond else {"FAILED": got}
    if not cond:
        fails.append(name)


def lane(test_on: bool, *, situation: bool = True, age_min: float = 0.0) -> dict:
    built = (datetime.now(timezone.utc) - timedelta(minutes=age_min)).isoformat()
    return {"place": "", "built_at": built, "test_mode": {"on": test_on, "word": "on" if test_on else "off"},
            "notice_situations": {"web_notice_not_chosen": situation}, "alert_receive_off": {}}


def set_lane(got: dict | None) -> None:
    live_slices.CONFIG_LANE.update(data=got, at=time.time())


def drain(q) -> list:
    got = []
    while not q.empty():
        got.append(q.get_nowait())
    return got


def rows(sql, args=()):
    return TEST.execute(sql, args).fetchall()


class RecApp:
    def __init__(self):
        self.paths = []
        self.router = types.SimpleNamespace(lifespan_context=None)

    def post(self, path):
        self.paths.append(("POST", path))
        return lambda f: f


class Req:
    def __init__(self, token="", body=b""):
        self.headers = {"x-hub-token": token} if token else {}
        self._raw = body if isinstance(body, bytes) else json.dumps(body).encode()

    async def body(self):
        return self._raw


async def settle() -> None:
    for _ in range(50):
        await asyncio.sleep(0.02)
        if not NC._TASKS:
            return


async def main() -> None:
    app = RecApp()
    NC.install(app)
    HS.install(app)
    check("install: POST /live/wake, the listener, both probes, the local wake and the stream hook",
          ("POST", "/live/wake") in app.paths and NC._fanout in WN._LISTENERS and WN._HOLD_PROBE[0] is not None
          and WN._SITUATION_PROBE[0] is NC.notice_state and live_notify.LOCAL_WAKES.get("notices") is NC.wake
          and NC._stream_opened in CD.ON_OPEN and HS.told in live_slices.ON_PHASE, app.paths)
    check("the app's chat stream opens no relay stream for frames by default", CD.RELAY_FRAMES is False)
    NC._LOOP[0] = asyncio.get_running_loop()
    NC._EVT[0] = asyncio.Event()

    # ---- the config lane, read here and told to no relay -----------------------------------------------------
    async def call_app(app_id, action, user, payload, write_id="", at=0.0):
        env = {"status": 200, "data": lane(True)}
        return json.dumps(env).encode(), time.time(), env, None, 0.0

    live_slices.FD = types.SimpleNamespace(call_app=call_app)
    await live_slices.config_lane_refresh(force=True)
    await asyncio.sleep(0.2)
    check("a lane read here is kept here, and told to no relay",
          not told_relay and live_slices.lane_for("") is not None, told_relay)

    # ---- the accounts, read live once ---------------------------------------------------------------------------
    try:
        accs = await NC._run(NC._notice_accounts)
        check("the accounts come off asa-hub-db's users copy: active, a notice role each, the master's row unlisted",
              len(accs) > 5 and all(a["role"] in NC.NOTICE_ACCOUNT_ROLES and a["uid"] for a in accs)
              and sum(1 for a in accs if a["unlisted"]) <= 1, len(accs))
    except Exception as exc:  # noqa: BLE001
        check("the accounts come off asa-hub-db's users copy", False, repr(exc))
    accounts = [{"uid": u, "role": "staff", "types": "STAFF", "label": NAMES[u], "unlisted": ""}
                for u in ("u-a", "u-b", "u-c")]
    NC._notice_accounts = lambda: list(accounts)

    # ---- the streams ----------------------------------------------------------------------------------------------
    def sub(uid, *, notices=True, strip=False, switched=False):
        q = CD._Sub("t-" + uid, uid, notices=notices, strip=strip, switched=switched)
        CD._subs.setdefault(uid, set()).add(q)
        if not switched:
            for fn in CD.ON_OPEN:
                fn(q, Session(ok=True, role="staff", uid=uid))
        return q

    a_reads, a_plain, b_reads = sub("u-a"), sub("u-a", notices=False), sub("u-b")
    c_switched = sub("u-c", switched=True)
    check("a stream opened is noted for its reader; a switched one is not, and is never online",
          "u-a" in NC._WHO and "u-b" in NC._WHO and "u-c" not in NC._WHO and sorted(NC._online()) == ["u-a", "u-b"],
          (sorted(NC._WHO), NC._online()))

    # ---- the situation and the switch -----------------------------------------------------------------------------
    set_lane(lane(True, situation=False))
    said = await NC._run(WN.publish, "not_chosen", key="t:off", dsn=SL.PG_DSN, facts={"person": "Pat Quill"})
    check("a kind whose Smart Comms situation is off is not stored", said.get("off") is True
          and not rows("select 1 from pg_temp.asa_hub_notices where key='t:off'"), said)
    set_lane(lane(True, age_min=20))
    check("a stale lane holds: the situation is not armed and the switch reads on",
          NC.notice_state("not_chosen")["armed"] is False and NC.switch()["on"] is True)
    set_lane(None)
    check("no lane yet holds as well", NC.switch()["on"] is True and NC.notice_state("not_chosen")["armed"] is False)

    # ---- test mode on: nobody is shown it, the push is held, the mockup is written --------------------------------
    set_lane(lane(True))
    NC._VIEWERS.clear()
    said = await NC._run(WN.publish, "not_chosen", key="t:held", dsn=SL.PG_DSN, facts={"person": "Pat Quill"})
    await settle()
    held_id = said.get("id")
    stored = rows("select held_test from pg_temp.asa_hub_notices where key='t:held'")
    outbox = rows("select user_id, state from pg_temp.asa_hub_push_outbox where notice_id=%s order by user_id",
                  (held_id,))
    ledger = [json.loads(line)["row"] for p in LEDGER.glob("*.jsonl") for line in p.read_text().splitlines()]
    check("test mode on: stored held, and no stream took a frame",
          stored == [(True,)] and not drain(a_reads) and not drain(a_plain) and not drain(b_reads)
          and not drain(c_switched), stored)
    check("test mode on: the push owed to the offline account is held for good, none to the one online",
          outbox == [("u-c", WP.S_HELD_TEST)] and not sent, outbox)
    check("test mode on: the notice and its held push are written for the mockup, the audience named",
          {(r["channel"], r["result"]) for r in ledger} == {("web_notice", "held"), ("web_push", "held")}
          and any("Pat Quill" in r["to_masked"] for r in ledger) and (LEDGER / WG.LEDGER_LOCK).exists(),
          [(r["channel"], r["result"], r["to_masked"]) for r in ledger])
    check("My Inbox is told to read again", ["my-inbox"] in dirty, dirty)

    # ---- a notice stored held stays held when the switch goes off -------------------------------------------------
    set_lane(lane(False))
    notice = (await NC._run(NC._stored, [held_id]))[0]
    await NC.fan(notice)
    check("stored under test mode, it is held whatever the switch says now",
          notice["held"] is True and not drain(a_reads) and not sent)

    # ---- test mode off: the frame to its reader online, the push to the offline account ---------------------------
    said = await NC._run(WN.publish, "not_chosen", key="t:live", dsn=SL.PG_DSN, facts={"person": "Pat Quill"})
    await settle()
    frames = [json.loads(f) for f in drain(a_reads)]
    outbox = rows("select user_id, state from pg_temp.asa_hub_push_outbox where notice_id=%s order by user_id",
                  (said.get("id"),))
    check("test mode off: one frame to the reader's notice-reading tab, none to a tab that reads none, none to a "
          "reader it is not for",
          len(frames) == 1 and frames[0]["kind"] == "notice" and frames[0]["notice"]["role"] == "theirs"
          and not drain(a_plain) and not drain(b_reads) and not drain(c_switched), frames)
    check("test mode off: pushed only to the account whose only tab is switched (offline), never the one online",
          [s["to"] for s in sent] == ["u-c"] and outbox == [("u-c", WP.S_SENT)], (sent, outbox))
    ledger = [json.loads(line)["row"] for p in LEDGER.glob("*.jsonl") for line in p.read_text().splitlines()]
    check("the push sent is written for the mockup as sent",
          any(r["channel"] == "web_push" and r["result"] == "sent" for r in ledger))

    # ---- the relay's wake and the notices it stored ---------------------------------------------------------------
    r = await NC.live_wake(Req(body={"wake": ["notices"]}))
    check("POST /live/wake without the relay's token is 401", r.status_code == 401)
    nid = TEST.execute("insert into pg_temp.asa_hub_notices (key, kind, facts) values ('t:relay', 'not_chosen', "
                       "'{\"person\": \"Pat Quill\"}') returning id").fetchone()[0]
    NC._EVT[0].clear()
    r = await NC.live_wake(Req("notice-test-token", {"wake": ["notices"], "notice_ids": [nid]}))
    await settle()
    await asyncio.sleep(0.05)
    frames = [json.loads(f) for f in drain(a_reads)]
    check("the relay's wake runs the catch-up here, and a notice it stored is carried to its reader",
          r.status_code == 204 and NC._EVT[0].is_set() and len(frames) == 1 and frames[0]["notice"]["id"] == nid
          and "t:relay" in WN._SEEN, (r.status_code, frames))

    # ---- the wakes the app answers stay here ----------------------------------------------------------------------
    NC._EVT[0].clear()
    live_notify.tell(wake=["notices"])
    await asyncio.sleep(0.05)
    live_notify.tell(wake=["attendance", "notices"], events=["housecal"])
    await asyncio.sleep(0.1)
    check("a notices wake runs here, a wake no clock here answers is dropped, and nothing reaches the relay",
          NC._EVT[0].is_set() and carried == [{"events": ["housecal"]}] and not told_relay, (carried, told_relay))

    # ---- the beat: the switch move, the release held, the mock rows handed ----------------------------------------
    NC._SAID.update(roster_on=None, released=time.time(), mock_last=0.0, mock_refused=False)
    await NC.beat()
    first = list(rostered)
    waiting = WG.waiting_count()
    set_lane(lane(True))
    await NC.beat()
    check("the first beat only learns the switch; a move tells every shift reader once",
          first == [] and len(rostered) == 2 and rostered[0]["location"] == "every house"
          and rostered[1] == "housecal", rostered)
    check("the mock rows were handed to commMockWebIngest in-process, and taken",
          door_calls and door_calls[0]["action"] == "commMockWebIngest" and door_calls[0]["app"] == "comm-mock"
          and waiting == 0 and WG.waiting_count() == 0 and not voided, (door_calls, waiting))
    check("with test mode on the release sends nothing", (await NC._run(NC._release, NC.switch()))["why"]
          == "test mode is on")

    # ---- the strip ------------------------------------------------------------------------------------------------
    (WEB / "index.html").write_text('<script type="module" src="/assets/index-AAA111.js"></script>')
    live_slices.PHASE.update(phase="warming")
    s_strip, s_plain = sub("u-s", notices=False, strip=True), sub("u-s", notices=False)
    HS.start()
    first = [json.loads(f) for f in drain(s_strip)]
    check("the strip's frame at once: the phase and the served build, only to a tab that draws it",
          first == [{"kind": "hub", "phase": "warming", "web": "index-AAA111.js"}] and not drain(s_plain)
          and json.loads(CD._HUB["frame"])["web"] == "index-AAA111.js" and CD._HUB["phase"] == "warming", first)
    (WEB / "index.html").write_text('<script type="module" src="/assets/index-BBB222.js"></script>')
    os.utime(WEB / "index.html", (time.time() + 5, time.time() + 5))
    await asyncio.sleep(1.4)
    nxt = [json.loads(f) for f in drain(s_strip)]
    live_slices.set_phase("ready")
    await asyncio.sleep(0.05)
    last = [json.loads(f) for f in drain(s_strip)]
    HS.fan()
    check("a new build is one frame on the web look's clock, a phase change one more, an unchanged frame none",
          nxt == [{"kind": "hub", "phase": "warming", "web": "index-BBB222.js"}]
          and last == [{"kind": "hub", "phase": "ready", "web": "index-BBB222.js"}] and not drain(s_strip)
          and not drain(s_plain) and CD._HUB["phase"] == "ready", (nxt, last))
    await HS.stop()


try:
    asyncio.run(main())
    live = psycopg.connect(OWNER, autocommit=True).execute(
        "select (select count(*) from app.asa_hub_notices where key like 't:%%'), "
        "(select count(*) from app.asa_hub_push_outbox where user_id in ('u-a','u-b','u-c'))").fetchone()
    check("nothing reached the live tables", live == (0, 0), live)
except Exception as exc:  # noqa: BLE001
    import traceback
    out["CRASH"] = traceback.format_exc()[-3000:]
    fails.append("crash")

print(json.dumps(out, indent=1, default=str))
print(f"{sum(1 for v in out.values() if v == 'ok')} ok, {len(fails)} failed" + (f": {fails}" if fails else ""))
