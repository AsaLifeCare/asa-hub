#!/usr/bin/env python3
"""A chat message's Web Push (server/chat_push.py, its section in snapshot_service.py, web_push's chat half).

Pushed only when none of the accounts folded onto the recipient holds a chat stream or a live chat connection;
never the words; held by test mode or the chat gate with the mock row the notices' pushes leave; nothing in the
quiet window; once per thread in RATE_S; decided off the request, both from the hub's exec and from /gas and the
ledger; a send with no receipt only once a read as its sender finds its row, and never a client's, a guardian's or
another place's. Pure: no database, no network, no push service."""
import __future__
import ast
import asyncio
import json
import re
import subprocess
import sys
import time
import types
import urllib.parse
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parent.parent
SERVER = ROOT / "server"
SOURCE = (SERVER / "snapshot_service.py").read_text(encoding="utf-8")
TREE = ast.parse(SOURCE)
PUSH_SOURCE = (SERVER / "chat_push.py").read_text(encoding="utf-8")

if "psycopg2" not in sys.modules:  # pragma: no cover
    fake = types.ModuleType("psycopg2")
    fake.connect = lambda *a, **k: (_ for _ in ()).throw(RuntimeError("no database in this test"))
    fake.Error = Exception
    extras = types.ModuleType("psycopg2.extras")
    extras.RealDictCursor = object
    errors = types.ModuleType("psycopg2.errors")
    errors.UniqueViolation = type("UniqueViolation", (Exception,), {})
    fake.extras, fake.errors = extras, errors
    sys.modules["psycopg2"] = fake
    sys.modules["psycopg2.extras"] = extras
    sys.modules["psycopg2.errors"] = errors

sys.path.insert(0, str(SERVER))
import chat_live as cl  # noqa: E402
import chat_push as cp  # noqa: E402
import web_gate as wg  # noqa: E402
import web_push as wp  # noqa: E402

results = {"ok": 0, "failed": []}


def check(name: str, ok: bool, detail=None) -> None:
    if ok:
        results["ok"] += 1
        print(f"  ok   {name}")
    else:
        results["failed"].append(name)
        print(f"  FAIL {name}")
        if detail is not None:
            print(f"       {str(detail)[:1500]}")


def segment(name: str) -> str:
    for node in TREE.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)) and node.name == name:
            return ast.get_source_segment(SOURCE, node) or ""
        if isinstance(node, ast.Assign) and any(getattr(t, "id", "") == name for t in node.targets):
            return ast.get_source_segment(SOURCE, node) or ""
        if isinstance(node, ast.AnnAssign) and getattr(node.target, "id", "") == name:
            return ast.get_source_segment(SOURCE, node) or ""
    return ""


def load(ns: dict[str, Any], *names: str) -> None:
    for name in names:
        code = segment(name)
        check(f"the relay declares {name}", bool(code))
        exec(compile(code, f"relay:{name}", "exec",  # noqa: S102 - the relay's own source
                     flags=__future__.annotations.compiler_flag, dont_inherit=True), ns)


class Clock:
    def __init__(self, t: float = 1000.0) -> None:
        self.t = t

    def __call__(self) -> float:
        return self.t


class Log:
    def __init__(self) -> None:
        self.lines: list[str] = []

    def warning(self, msg: str, *args: Any) -> None:
        self.lines.append(msg % args if args else msg)

    info = debug = warning


WORDS = "the words stay home 7731"
MSG_ID = "msg_0a1b2c3d4e5f60718293"
TAG_RE = re.compile(r"^chat-[0-9a-f]{20}$")


def form(action: str, token: str, payload: dict[str, Any], tenant: str = "") -> bytes:
    env: dict[str, Any] = {"token": token, "action": action, "payload": payload}
    if tenant:
        env["tenant"] = tenant
    return urllib.parse.urlencode({"body": json.dumps(env)}).encode()


def answer(data: dict[str, Any], status: int = 200) -> bytes:
    return json.dumps({"status": status, "data": data}).encode()


print("WHAT LANDED, AND NEVER THE WORDS")
raw = form("chatSend", "tok-ann", {"to_user": "per-9", "body": WORDS})
got = cp.landed_send(raw, answer({"id": MSG_ID, "created_at": "x", "thread_key": "per-1|per-9", "emailed": False}))
check("a send Apps Script answered 200: whom, the thread, the message id, the place and the token (dropped by the "
      "relay)", got == {"token": "tok-ann", "to_user": "per-9", "thread_key": "per-1|per-9", "message_id": MSG_ID,
                        "tenant": ""}, got)
check("…and not one of its words", WORDS not in json.dumps(got))
check("a refused send, a reaction, a mark, another action or an unreadable body lands nothing",
      cp.landed_send(raw, answer({}, status=400)) is None
      and cp.landed_send(form("chatReact", "t", {"message_id": "m", "emoji": "x"}), answer({})) is None
      and cp.landed_send(form("chatMarkRead", "t", {"with_user": "p"}), answer({})) is None
      and cp.landed_send(form("moveStage", "t", {}), answer({})) is None
      and cp.landed_send(b"body=%7Bnot", answer({})) is None
      and cp.landed_send(raw, b"<html>") is None)
check("a send that names nobody lands nothing", cp.landed_send(form("chatSend", "t", {"body": "x"}), answer({})) is None)
check("a ledger delivery with no receipt still names whom it was for, and no message id",
      cp.landed_send(raw, b'{"status":200,"data":{}}') == {"token": "tok-ann", "to_user": "per-9", "thread_key": "",
                                                           "message_id": "", "tenant": ""})
un = cp.unanswered_send(raw)
check("a send that left without its receipt: whom and the token, no thread, no id, no words",
      un == {"token": "tok-ann", "to_user": "per-9", "thread_key": "", "message_id": "", "tenant": ""}
      and WORDS not in json.dumps(un))
check("…and only a send", cp.unanswered_send(form("chatReact", "t", {"message_id": "m"})) is None)
away = form("chatSend", "tok-ann", {"to_user": "per-9", "body": WORDS}, tenant="akron")
check("the place a send was made in rides with it, answered or not",
      cp.unanswered_send(away)["tenant"] == "akron" and cp.landed_send(away, answer({"id": MSG_ID}))["tenant"] == "akron")


def thread_answer(*rows: tuple[str, bool], status: int = 200) -> dict[str, Any]:
    """A chatMessages envelope as Chat.gs answers it: (created_at, mine) per row, the words in every one."""
    if status != 200:
        return {"status": status, "message": "Not found."}
    return {"status": 200, "data": {"reset": False, "reactions": {}, "messages": [
        {"id": f"msg_{i:02d}", "from_user": "per-1" if mine else "per-9", "from_name": "Ann Roe" if mine else "Bob Poe",
         "body": WORDS, "created_at": at, "read_at": "", "mine": mine} for i, (at, mine) in enumerate(rows)]}}


print("A SEND WITH NO RECEIPT, FOUND OR NOT")
since = cp.row_since(datetime(2026, 9, 22, 16, 0, tzinfo=timezone.utc))
check("a row may be the send it was two minutes before the relay heard of it, and not before",
      since == "2026-09-22T15:58:00+00:00" and cp.ROW_WINDOW_S == 120.0, since)
check("the sender's newest row since then is the one found, by its id",
      cp.row_filed(thread_answer(("2026-09-22T15:50:00.000Z", True), ("2026-09-22T15:59:10.000Z", True),
                                 ("2026-09-22T15:59:40.000Z", False)), since) == "msg_01")
check("…an older row of theirs is not this send; the other side's rows are not theirs",
      cp.row_filed(thread_answer(("2026-09-22T15:50:00.000Z", True), ("2026-09-22T15:59:40.000Z", False)), since)
      is None)
check("…a refusal (outside the circle, another place's person), an unreadable answer or a relay refusal finds nothing",
      cp.row_filed(thread_answer(status=404), since) is None and cp.row_filed(None, since) is None
      and cp.row_filed({"status": 502, "reason": "unreachable"}, since) is None
      and cp.row_filed(thread_answer(("not a time", True)), since) is None
      and cp.row_filed(thread_answer(("2026-09-22T15:59:10.000Z", True)), "") is None)
oclock = Clock()
orl = cp.RateLimit(clock=oclock)
check("the rate can be asked without spending it", orl.open("k") and orl.open("k") and orl.claim("k")
      and not orl.open("k"))

print("THE WORDS, THE TAG, THE LINK")
p = cp.plan(to_user="per-9", to_person="per-9", to_ids=["per-9", "acc-9b"], to_name="Bob Poe", from_person="per-1",
            from_name="Ann Roe", thread_key="per-1|per-9", message_id=MSG_ID)
pay = cp.payload(p, datetime(2026, 9, 22, 16, 0, tzinfo=timezone.utc))
check("the title names the sender, the body says where to read it — nothing of the message",
      pay["title"] == "New message from Ann Roe" and pay["body"] == "Open My Inbox to read it.", pay)
check("a click opens My Inbox's chat on that conversation", pay["href"] == "/app/my-inbox/chat?with=per-1", pay)
check("one tag per thread, whoever writes, and no id in it",
      TAG_RE.fullmatch(pay["tag"]) and pay["tag"] == cp.tag_of("per-1|per-9") == cp.tag_of(cp.thread_of("per-9", "per-1"))
      and pay["tag"] != cp.tag_of("per-5|per-9") and "per-" not in pay["tag"], pay["tag"])
check("never urgent, no notice id, the shape the service worker reads",
      pay["urgent"] is False and pay["id"] == 0 and set(pay) == {"v", "id", "tag", "title", "body", "href", "urgent",
                                                                  "kind", "at"})
check("a sender with no name is still a message", cp.title_of("") == "New message" and cp.title_of("  Ann \n Roe ")
      == "New message from Ann Roe")
check("an unknown sender opens the chat itself; an odd id is quoted",
      cp.href_of("") == "/app/my-inbox/chat" and cp.href_of("a&b c") == "/app/my-inbox/chat?with=a%26b%20c")
check("a message to oneself (an account folded onto the sender) is no push",
      cp.plan(to_user="acc-2", to_person="per-1", to_ids=["per-1", "acc-2"], to_name="", from_person="per-1",
              from_name="", thread_key="", message_id="") is None)
check("the sender, when only the thread says it, is its other side",
      cp.plan(to_user="per-9", to_person="per-9", to_ids=["per-9"], to_name="", from_person="", from_name="",
              thread_key="per-5|per-9", message_id="")["from_person"] == "per-5")
check("the recipient's every account is asked, the person and the one written to included",
      cp.plan(to_user="acc-9b", to_person="per-9", to_ids=["per-9", "acc-9b", "acc-9c"], to_name="",
              from_person="per-1", from_name="", thread_key="", message_id="m")["to_ids"] == ["per-9", "acc-9b", "acc-9c"])
copy = cp.copy_of(p)
check("web_push.wants_push owes it to someone with nothing open, and to nobody live",
      wp.wants_push(copy, live=False) and not wp.wants_push(copy, live=True))
check("…and a staff member is owed one as much as anybody (chat is everyone's)",
      copy["role"] != "staff")

print("WHAT BECOMES OF ONE PUSH")
rl = cp.RateLimit(clock=Clock())
order = [cp.judge(devices=0, rate=rl, key="a", held=True, quiet=True, keys_ok=False),
         cp.judge(devices=1, rate=rl, key="b", held=True, quiet=True, keys_ok=False),
         cp.judge(devices=1, rate=rl, key="c", held=False, quiet=True, keys_ok=False),
         cp.judge(devices=1, rate=rl, key="d", held=False, quiet=False, keys_ok=False),
         cp.judge(devices=1, rate=rl, key="e", held=False, quiet=False, keys_ok=True),
         cp.judge(devices=1, rate=rl, key="e", held=False, quiet=False, keys_ok=True)]
check("no device first, then the rate, test mode, the night, the keys, then the push",
      order == [cp.NO_DEVICE, cp.HELD_TEST, cp.QUIET, cp.NO_KEY, cp.SEND, cp.RATE], order)
check("…and the rate is not spent with no device to reach", rl.claim("a"))
rclock = Clock()
rl = cp.RateLimit(clock=rclock)
first, second = rl.claim("x"), rl.claim("x")
rclock.t += cp.RATE_S
check("one per thread every two minutes", first and not second and rl.claim("x") and cp.RATE_S == 120.0)

print("WHO HOLDS A LIVE CHAT CONNECTION")
hclock = Clock()
hub = cp.HubLive(clock=hclock)
check("nobody before the hub says anything", not hub.live(["per-9"]))
hub.listed([["per-9", "acc-9b"], ["per-1"]])
check("the hub's list is its word for each ref it names, as any of that person's ids",
      hub.live(["acc-9b"]) and hub.live(["per-9", "x"]) and hub.live(["per-1"]) and not hub.live(["per-5"]))
hclock.t += 130
hub.listed([["per-1"]])
check("the next list without them: closed", not hub.live(["per-9"]) and hub.live(["per-1"]))
hub.touched(["per-5"])
check("a ticket redeemed or an exec after the list: live until the next one", hub.live(["per-5"]))
hclock.t += 130
hub.listed([["per-1"]])
check("…and the next list without it closes it", not hub.live(["per-5"]))
hclock.t += 1
hub.touched(["per-6"])
hclock.t += 2
hub.listed([["per-1"]])
check("a connection opened while the hub was writing its list is not read as closed by it", hub.live(["per-6"]))
hclock.t += cp.LIVE_S + 1
check("a list older than five minutes says nothing (a hub with no connection sends none)",
      not hub.live(["per-1"]) and not hub.live(["per-6"]))
check("the counts say how many, never whose", set(hub.counts()) == {"listed", "touched", "list_age_s"})

print("WEB PUSH'S CHAT HALF")


class DB:
    def __init__(self) -> None:
        self.devices: list[dict[str, Any]] = []
        self.sql: list[tuple[str, Any]] = []
        self.commits = 0
        self.connects = 0


class FakeCursor:
    def __init__(self, db: DB) -> None:
        self.db, self.rows, self.rowcount = db, [], 0

    def execute(self, sql: str, params: Any = None) -> None:
        self.db.sql.append((sql, params))
        self.rows = []
        if sql.startswith("SELECT endpoint, user_id, p256dh, auth FROM asa_hub_push_subs WHERE user_id = ANY"):
            self.rows = [dict(d) for d in self.db.devices if d["user_id"] in params[0]]
        elif sql.startswith("DELETE FROM asa_hub_push_subs WHERE endpoint=%s"):
            self.db.devices = [d for d in self.db.devices if d["endpoint"] != params[0]]

    def fetchall(self) -> list[Any]:
        return self.rows

    def fetchone(self) -> Any:
        return self.rows[0] if self.rows else None

    def __enter__(self) -> "FakeCursor":
        return self

    def __exit__(self, *exc: Any) -> bool:
        return False


class FakeConn:
    def __init__(self, db: DB) -> None:
        self.db = db
        db.connects += 1

    def cursor(self, cursor_factory: Any = None) -> FakeCursor:
        return FakeCursor(self.db)

    def commit(self) -> None:
        self.db.commits += 1

    def __enter__(self) -> "FakeConn":
        return self

    def __exit__(self, *exc: Any) -> bool:
        return False


db = DB()
wp._connect = lambda dsn: FakeConn(db)


def dev(uid: str, name: str) -> dict[str, Any]:
    return {"endpoint": f"https://fcm.googleapis.com/fcm/send/{name}", "user_id": uid, "p256dh": "k", "auth": "a"}


db.devices = [dev("acc-9b", "b1"), dev("per-9", "b2"), dev("per-5", "c1")]
found = wp.devices_for("dsn", ["per-9", "acc-9b", "per-9", ""])
check("devices_for: every device kept for any of the accounts, asked once by account",
      sorted(d["endpoint"][-2:] for d in found) == ["b1", "b2"]
      and db.sql[-1][1] == (["acc-9b", "per-9"],), (found, db.sql[-1]))
before = db.connects
check("…and nobody asked, no connection", wp.devices_for("dsn", ["", None]) == [] and db.connects == before)
calls: list[tuple[str, dict[str, Any], int, bool]] = []
answers: dict[str, tuple[str, int | None, str]] = {}


def fake_send(device: dict[str, Any], payload: dict[str, Any], *, vapid: dict[str, Any], ttl: int,
              urgent: bool) -> tuple[str, int | None, str]:
    calls.append((device["endpoint"], payload, ttl, urgent))
    return answers.get(device["endpoint"][-2:], ("ok", 201, ""))


KEYS = {"ok": True, "public_key": "p", "private_key": "q", "subject": "mailto:x@example.invalid", "why": ""}
answers["b2"] = ("gone", 410, "the push service says this device is gone")
state = wp.push_chat("dsn", [dev("acc-9b", "b1"), dev("per-9", "b2")], pay, vapid=KEYS, ttl=900, sender=fake_send)
check("push_chat: one payload to each device, not urgent, the TTL it is given",
      [c[0][-2:] for c in calls] == ["b1", "b2"] and all(c[1] == pay and c[2] == 900 and c[3] is False for c in calls))
check("…sent when any device took it; a device the service calls gone is forgotten",
      state == (wp.S_SENT, 1, "") and not any(d["endpoint"].endswith("b2") for d in db.devices)
      and any(s.startswith("DELETE FROM asa_hub_push_subs") for s, _ in db.sql), state)
calls.clear()
answers["b1"] = ("failed", 500, "the push service answered 500")
state = wp.push_chat("dsn", [dev("acc-9b", "b1")], pay, vapid=KEYS, ttl=900, sender=fake_send)
check("…failed when none did, with the service's own answer", state == (wp.S_FAILED, 0, "the push service answered 500"))
check("…and nothing to send to is no device, with no connection",
      wp.push_chat("dsn", [], pay, vapid=KEYS, ttl=900, sender=fake_send)[0] == wp.S_NO_DEVICE)
answers.clear()
ny = wg.OHIO
check("chat_ttl: an hour by day, and never into the quiet window",
      wp.chat_ttl(datetime(2026, 9, 22, 12, 0, tzinfo=ny)) == 3600
      and wp.chat_ttl(datetime(2026, 9, 22, 21, 0, tzinfo=ny)) == 31 * 60
      and wp.chat_ttl(datetime(2026, 9, 22, 21, 30, 30, tzinfo=ny)) == 30)

print("THE RELAY: ONE MESSAGE, ITS PUSH")


class Gate:
    held = False
    why = "gate_chat_live_frame is armed and the send switch is on"
    CHAT_FRAME = "gate_chat_live_frame"

    def holds(self, gate_id: str) -> dict[str, Any]:
        return {"held": self.held and gate_id == self.CHAT_FRAME, "why": self.why if self.held else "",
                "unreadable": False}


class Q:
    def __init__(self, acting: bool = False) -> None:
        self.acting = acting


FOLD_ROWS = [
    {"user_id": "acc-2", "same_as": "per-1", "display_name": "Ann Roe"},
    {"user_id": "per-1", "display_name": "Ann Roe"},
    {"user_id": "per-9", "display_name": "Bob Poe"},
    {"user_id": "acc-9b", "same_as": "per-9", "display_name": "Bob Poe"},
    {"user_id": "per-5", "display_name": "Cy Moe"},
    {"user_id": "per-6", "display_name": "Dee Lee"},
]
OFF = {"on": False, "readable": True, "word": "off", "why": ""}
ON = {"on": True, "readable": True, "word": "on", "why": ""}
NOON = datetime(2026, 9, 22, 16, 0, tzinfo=timezone.utc)
NIGHT = datetime(2026, 9, 23, 3, 0, tzinfo=timezone.utc)
kept: list[Any] = []
recorded: list[dict[str, Any]] = []
token_users: dict[str, str] = {}
token_names: dict[str, str] = {}
gate = Gate()
switch_now = {"v": OFF}
relay_log = Log()
real_record, real_keys, real_send, real_now = wg.record, wp.keys, wp.send_one, cp.now
wg.record = lambda rows, **k: (recorded.extend(rows), {"added": len(rows), "duplicate": 0})[1]
keys_now = {"v": KEYS}
wp.keys = lambda path=None: keys_now["v"]
wp.send_one = fake_send
clock_now = {"v": NOON}
cp.now = lambda: clock_now["v"]
# what the relay reads as a sender to find a send with no receipt, and what Apps Script answers it
reads: list[dict[str, Any]] = []
read_answer: dict[str, Any] = {"v": None}


async def fake_post(raw: bytes, timeout: float) -> tuple[str, bytes]:
    reads.append(json.loads(urllib.parse.parse_qs(raw.decode())["body"][0]))
    return "json", json.dumps(read_answer["v"]).encode()


ns: dict[str, Any] = {
    "asyncio": asyncio, "time": time, "Any": Any, "log": relay_log, "PG_DSN": "dsn",
    "chat_push": cp, "chat_live": cl, "web_push": wp, "web_gate": wg, "lane_gate": gate,
    "_web_switch": lambda: switch_now["v"], "_chat_subs": {}, "_chat_fold": cl.FoldCache(lambda: FOLD_ROWS),
    "_chat_refs": cl.Registry(), "_token_user_get": lambda t: token_users.get(t, ""),
    "_token_name_get": lambda t: token_names.get(t, ""),
    "_keep_task": lambda coro: kept.append(asyncio.ensure_future(coro)),
    "_auth_cache": {}, "_chat_live_post": fake_post, "_chat_unsettled": cl.Unsettled(),
}
load(ns, "_chat_push_hub", "_chat_push_rate", "_CHAT_PUSH_SAID", "_chat_push_seen", "_chat_push_listed",
     "_chat_push_live", "_chat_push_observed", "_chat_push_unanswered", "_chat_push_unconfirmed", "_chat_push_start",
     "_chat_push_confirm", "_chat_push_run", "_chat_push_plan", "_chat_push_deliver", "_chat_push_rows")
check("the relay keeps one hub view and one rate for the process",
      isinstance(ns["_chat_push_hub"], cp.HubLive) and isinstance(ns["_chat_push_rate"], cp.RateLimit))
ANN = {"account_id": "acc-2", "person_id": "per-1", "fold_ids": ["per-1", "acc-2"], "name": "Ann Roe"}


def fresh() -> None:
    ns["_chat_push_hub"] = cp.HubLive(clock=hclock)
    ns["_chat_push_rate"] = cp.RateLimit(clock=rclock)
    ns["_chat_subs"] = {}
    ns["_CHAT_PUSH_SAID"]["no_key"] = 0.0
    calls.clear()
    recorded.clear()
    relay_log.lines.clear()
    db.devices = [dev("acc-9b", "b1"), dev("per-9", "b2"), dev("per-5", "c1")]
    gate.held = False
    switch_now["v"] = OFF
    keys_now["v"] = KEYS
    clock_now["v"] = NOON
    reads.clear()
    read_answer["v"] = thread_answer(("2026-09-22T15:59:58.000Z", True))
    ns["_auth_cache"] = {"tok-ann": (time.time(), True, "staff", "acc-2")}


def send(to_user: str = "per-9", *, token: str = "tok-ann", ident: dict[str, Any] | None = ANN,
         data: dict[str, Any] | None = None, status: int = 200, action: str = "chatSend",
         tenant: str = "") -> dict[str, Any]:
    """One landed message through the relay's observer; how many devices were reached before and after its task."""
    body = form(action, token, {"to_user": to_user, "body": WORDS}, tenant)
    content = answer(data if data is not None else {"id": MSG_ID, "created_at": "x",
                                                    "thread_key": cp.thread_of("per-1", "per-9")}, status)

    async def go() -> dict[str, Any]:
        kept.clear()
        n = len(calls)
        ns["_chat_push_observed"](body, content, ident)
        at_answer = len(calls) - n
        tasks = len(kept)
        await asyncio.gather(*kept)
        return {"at_answer": at_answer, "tasks": tasks, "sent": calls[n:]}

    return asyncio.run(go())


fresh()
r = send()
endpoints = sorted(c[0][-2:] for c in r["sent"])
check("the hub's send to someone with nothing open: one push to every device of every account folded onto them",
      endpoints == ["b1", "b2"], r)
check("…decided off the request: nothing had left when the observer returned, one task was kept",
      r["at_answer"] == 0 and r["tasks"] == 1, r)
got_pay = r["sent"][0][1] if r["sent"] else {}
check("…titled by the sender's name, the body saying where to read it, opening that conversation",
      got_pay.get("title") == "New message from Ann Roe" and got_pay.get("body") == "Open My Inbox to read it."
      and got_pay.get("href") == "/app/my-inbox/chat?with=per-1" and got_pay.get("tag") == cp.tag_of("per-1|per-9"),
      got_pay)
check("…an hour's TTL by day, not urgent", r["sent"] and r["sent"][0][2] == 3600 and r["sent"][0][3] is False)
check("…with the mock row the notices' pushes leave: sent, on the push channel, who wrote and to whom",
      len(recorded) == 1 and recorded[0]["channel"] == "web_push" and recorded[0]["result"] == "sent"
      and recorded[0]["person_name"] == "Ann Roe" and recorded[0]["to_masked"] == "Bob Poe"
      and recorded[0]["subject"] == "New message from Ann Roe" and recorded[0]["body"] == "Open My Inbox to read it."
      and recorded[0]["situation"] == "chat_message" and recorded[0]["test_mode"] == "off", recorded)
everything = json.dumps([r, recorded, relay_log.lines], default=str)
check("not one word of the message reaches a device, a row or the log", WORDS not in everything)
check("the log names no account, person or token", not re.search(r"(per|acc|tok)-", " ".join(relay_log.lines)),
      relay_log.lines)
r = send()
check("the next message of that thread within two minutes: no second push", r["sent"] == [] and len(recorded) == 1)
rclock.t += cp.RATE_S
check("…and after them, one again", len(send()["sent"]) == 2)

fresh()
ns["_chat_subs"] = {"acc-9b": {Q()}}
check("a chat stream open on any of the recipient's accounts: no push, no row",
      send()["sent"] == [] and recorded == [])
ns["_chat_subs"] = {"acc-9b": {Q(acting=True)}}
check("…but a Be Another tab on their account is not them: pushed", len(send()["sent"]) == 2)

fresh()
reg = ns["_chat_refs"]
bob_ref = reg.redeem(reg.mint("tok-bob", "", {"account_id": "acc-9b", "person_id": "per-9",
                                              "fold_ids": ["per-9", "acc-9b"], "name": "Bob Poe"}))["ref"]
cy_ref = reg.redeem(reg.mint("tok-cy", "", {"account_id": "per-5", "person_id": "per-5", "fold_ids": ["per-5"],
                                            "name": "Cy Moe"}))["ref"]
ns["_chat_push_listed"]([bob_ref, cy_ref], {"unknown": [], "revoked": []})
check("a live chat connection the hub listed for them: no push", send()["sent"] == [])
hclock.t += 130
ns["_chat_push_listed"]([cy_ref], {"unknown": [], "revoked": []})
check("…the hub's next list without it: pushed", len(send()["sent"]) == 2)
fresh()
ns["_chat_push_listed"]([bob_ref, "u" * 43], {"unknown": ["u" * 43], "revoked": [bob_ref]})
check("a ref the check just closed is not a live connection", len(send()["sent"]) == 2)
fresh()
ns["_chat_push_listed"]([bob_ref], {"unknown": [], "revoked": []})
hclock.t += cp.LIVE_S + 1
check("a list older than five minutes is nobody's word: pushed", len(send()["sent"]) == 2)
fresh()
ns["_chat_push_listed"]([cy_ref], {"unknown": [], "revoked": []})
ns["_chat_push_seen"](["per-9", "acc-9b"])
check("a ticket redeemed or an exec for them since the list: no push", send()["sent"] == [])

fresh()
switch_now["v"] = ON
r = send()
check("test mode on: nothing leaves", r["sent"] == [], r)
check("…the mock row is its only delivery, held by test mode as the notices' pushes are",
      len(recorded) == 1 and recorded[0]["result"] == "held" and recorded[0]["held_by"] == "held: test mode"
      and "only delivery" in recorded[0]["reason"] and recorded[0]["test_mode"] == "on", recorded)
fresh()
switch_now["v"] = {"on": True, "readable": False, "word": "unreadable", "why": "the lane is old"}
send()
check("an unreadable switch holds too, and says so",
      not calls and recorded and "unreadable, so treated as on" in recorded[0]["held_by"], recorded)
fresh()
gate.held = True
r = send()
check("the chat gate armed: nothing leaves, the gate named on the row",
      r["sent"] == [] and recorded and recorded[0]["held_by"] == Gate.why, recorded)
fresh()


class Broken:
    CHAT_FRAME = "gate_chat_live_frame"

    def holds(self, gate_id: str) -> dict[str, Any]:
        raise RuntimeError("no lane")


ns["lane_gate"] = Broken()
check("a chat gate that cannot answer holds", send()["sent"] == [] and recorded and recorded[0]["result"] == "held")
ns["lane_gate"] = gate

fresh()
clock_now["v"] = NIGHT
r = send()
check("the quiet window: nothing leaves, and nothing is kept to send later",
      r["sent"] == [] and len(recorded) == 1 and recorded[0]["result"] == "quiet"
      and "quiet window" in recorded[0]["held_by"] and "not afterwards" in recorded[0]["reason"], recorded)

fresh()
r = send("per-6", data={"id": MSG_ID, "thread_key": "per-1|per-6"})
check("nobody's device kept: nothing sent, no row", r["sent"] == [] and recorded == [])
db.devices.append(dev("per-6", "d1"))
check("…and the rate was not spent on it", len(send("per-6", data={"id": MSG_ID, "thread_key": "per-1|per-6"})["sent"]) == 1)

fresh()
keys_now["v"] = {"ok": False, "why": "no VAPID keys at /srv/secrets/webpush-vapid.json"}
send()
rclock.t += cp.RATE_S
send()
check("no VAPID keys: nothing sent, said once an hour, no row",
      not calls and not recorded and len(relay_log.lines) == 1 and "nothing is pushed" in relay_log.lines[0],
      relay_log.lines)

fresh()
answers["b1"] = answers["b2"] = ("failed", 503, "the push service answered 503")
send()
answers.clear()
check("a push no device took: a failed row, and the service's answer in the log",
      recorded and recorded[0]["result"] == "failed" and "503" in recorded[0]["reason"]
      and any("failed" in line for line in relay_log.lines), (recorded, relay_log.lines))

print("THE LEGACY PATH: /gas AND THE LEDGER")
fresh()
token_users["tok-ann"] = "acc-2"
token_names["tok-ann"] = ""
r = send(ident=None)
check("a /gas send: the sender is the session the relay knows the token as, its person, the users copy's name",
      len(r["sent"]) == 2 and r["sent"][0][1]["title"] == "New message from Ann Roe"
      and r["sent"][0][1]["href"] == "/app/my-inbox/chat?with=per-1", r)
fresh()
token_names["tok-ann"] = "Ann R."
r = send(ident=None)
check("…the name the session signed in with first", r["sent"] and r["sent"][0][1]["title"] == "New message from Ann R.")
fresh()
r = send(token="tok-nobody", ident=None, data={"id": MSG_ID, "thread_key": "per-5|per-9"})
check("…a token the relay does not know: the sender is the thread's other side",
      r["sent"] and r["sent"][0][1]["title"] == "New message from Cy Moe"
      and r["sent"][0][1]["tag"] == cp.tag_of("per-5|per-9"), r)
fresh()
check("a refused send, a reaction, or a message to oneself: nothing is pushed",
      send(status=400)["tasks"] == 0 and send(action="chatReact")["tasks"] == 0
      and send("acc-2", data={"id": MSG_ID})["sent"] == [] and not recorded)

print("A SEND WITH NO RECEIPT: FOUND BEFORE IT IS PUSHED")
real_delays = cp.AFTER_ECHO_S, cp.AFTER_SILENCE_S
cp.AFTER_ECHO_S, cp.AFTER_SILENCE_S = 0.05, 0.2
LOOKED_FOR = {"token": "tok-ann", "action": "chatMessages", "payload": {"with_user": "per-9"}}
fresh()
r = send(ident=None, data={})
check("a ledger delivery with no receipt: pushed once a read as its sender finds the row, on the thread the two "
      "people make, under that row's id",
      len(r["sent"]) == 2 and r["sent"][0][1]["tag"] == cp.tag_of("per-1|per-9") and reads == [LOOKED_FOR]
      and len(recorded) == 1 and "chat_message:msg_00" in recorded[0]["purpose"], (r, reads, recorded))
check("…the read names the conversation as the session that sent it, and nothing of the words reaches a device, a "
      "row or the log", WORDS not in json.dumps([r["sent"], recorded, relay_log.lines]))
fresh()
read_answer["v"] = thread_answer(status=404)
r = send(ident=None, data={})
check("…Chat.gs refused it (outside a circle, or a person another place does not show): no push, no row",
      len(reads) == 1 and r["sent"] == [] and recorded == [], (r, reads, recorded))
fresh()
read_answer["v"] = thread_answer(("2026-09-22T15:40:00.000Z", True), ("2026-09-22T15:59:59.000Z", False))
check("…only an older row of theirs, or the other side's: not this send, no push",
      send(ident=None, data={})["sent"] == [] and len(reads) == 1 and recorded == [])
fresh()
read_answer["v"] = {"status": 502, "reason": "unreachable", "message": "The server did not answer in time."}
check("…a read Apps Script did not answer: no push", send(ident=None, data={})["sent"] == [] and recorded == [])
for role in ("client", "guardian", "Client"):
    fresh()
    ns["_auth_cache"]["tok-ann"] = (time.time(), True, role, "acc-2")
    r = send(ident=None, data={})
    check(f"a {role.lower()}'s send with no receipt: never pushed, nothing read, nothing started",
          r["tasks"] == 0 and r["sent"] == [] and not reads, (r, reads))
fresh()
r = send(token="tok-nobody", ident=None, data={})
ns["_auth_cache"]["tok-gone"] = (time.time(), False, "", "")
r2 = send(token="tok-gone", ident=None, data={})
check("…nor one from a session the relay cannot name, or one it knows as signed out",
      r["tasks"] == 0 and r2["tasks"] == 0 and not reads and r["sent"] == r2["sent"] == [])
fresh()
r = send(ident=None, data={}, tenant="akron")
check("…nor one made in another place", r["tasks"] == 0 and r["sent"] == [] and not reads, r)
fresh()
r = send("per-6", ident=None, data={})
check("…nobody's device kept: nothing read, nothing sent", r["sent"] == [] and not reads, (r, reads))
fresh()
ns["_chat_subs"] = {"acc-9b": {Q()}}
check("…the recipient has a chat open: nothing read", send(ident=None, data={})["sent"] == [] and not reads)
fresh()
send()
calls.clear()
r = send(ident=None, data={})
check("…the thread's rate already spent: nothing read", r["sent"] == [] and not reads, (r, reads))
fresh()
check("a landed send with its receipt is pushed as it is: nothing read", len(send(ident=None)["sent"]) == 2 and not reads)
fresh()
ns["_auth_cache"]["tok-cli"] = (time.time(), True, "client", "acc-7")
check("…a client's included: Chat.gs answered 200 inside its circle",
      len(send(token="tok-cli", ident=None, data={"id": MSG_ID, "thread_key": "per-5|per-9"})["sent"]) == 2)


async def unanswered(echo: bool, token: str = "tok-ann", tenant: str = "") -> dict[str, Any]:
    kept.clear()
    n = len(calls)
    began = time.monotonic()
    ns["_chat_push_unanswered"](form("chatSend", token, {"to_user": "per-9", "body": WORDS}, tenant), echo=echo)
    at_answer = len(calls) - n
    tasks = len(kept)
    await asyncio.gather(*kept)
    return {"at_answer": at_answer, "tasks": tasks, "took": time.monotonic() - began, "sent": calls[n:]}


fresh()
r = asyncio.run(unanswered(True))
check("a /gas send answered without its receipt after the echo: looked for a moment later, off the request, and "
      "pushed when found", r["at_answer"] == 0 and len(r["sent"]) == 2 and r["took"] >= 0.05 and reads == [LOOKED_FOR], r)
fresh()
r = asyncio.run(unanswered(False))
check("…after silence: once Apps Script has surely filed it",
      len(r["sent"]) == 2 and r["took"] >= 0.2 and len(reads) == 1, r)
fresh()
read_answer["v"] = thread_answer(status=404)
r = asyncio.run(unanswered(False))
check("…a send Chat.gs refused after the relay stopped waiting: never pushed, no row",
      r["sent"] == [] and recorded == [] and len(reads) == 1, r)
fresh()
ns["_auth_cache"]["tok-ann"] = (time.time(), True, "client", "acc-2")
r = asyncio.run(unanswered(False))
check("…a client's: nothing started, nothing read", r["tasks"] == 0 and r["sent"] == [] and not reads, r)
fresh()
r = asyncio.run(unanswered(True, tenant="akron"))
check("…one made in another place: nothing started", r["tasks"] == 0 and r["sent"] == [] and not reads, r)
cp.AFTER_ECHO_S, cp.AFTER_SILENCE_S = real_delays
check("…which is two seconds after an echo and thirty-five after silence, the hub's own first nudges",
      cp.AFTER_ECHO_S == cl.RAN_NUDGE_S[0] and cp.AFTER_SILENCE_S == cl.UNANSWERED_NUDGE_S[0])
fresh()
kept.clear()
check("nothing is started without a loop to run it on, and nothing raises",
      ns["_chat_push_observed"](form("chatSend", "tok-ann", {"to_user": "per-9"}), answer({"id": MSG_ID})) is None
      and ns["_chat_push_observed"](form("chatSend", "tok-ann", {"to_user": "per-9"}), answer({})) is None
      and ns["_chat_push_unanswered"](form("chatSend", "tok-ann", {"to_user": "per-9"}), echo=True) is None
      and not kept)

wg.record, wp.keys, wp.send_one, cp.now = real_record, real_keys, real_send, real_now

print("THE WIRING")
gas = segment("gas_relay")
check("the /gas answer pushes right after it tells the hub",
      -1 < gas.find('_chat_live_observed(raw, res.content, "gas")') < gas.find("_chat_push_observed(raw, res.content)"))
python_gas = segment("_chat_python_gas")
check("a /gas send Python left without its answer is said accepted and looks for its row after the silence",
      -1 < python_gas.find("_chat_push_unanswered(raw, echo=False)")
      < python_gas.find('"data": {"accepted": True, "confirmed": False}'))
check("…and one Python answered is heard as any /gas answer is",
      "_chat_push_observed(raw, content)" in python_gas)
exec_src = segment("chat_exec")
landed = exec_src.find('if answer.get("status") == 200:')
check("the hub's exec pushes a send that answered 200, as its caller",
      -1 < landed < exec_src.find("_chat_push_observed(raw, content, ident)") < exec_src.find("elif answer.get(\"status\") == 401"))
check("…and its caller holds a live connection", "_chat_push_seen(ident.get(\"fold_ids\"))" in exec_src)
redeem_src = segment("chat_ticket_redeem")
check("a ticket redeemed is a connection opening",
      -1 < redeem_src.find("_chat_push_seen(got.get(\"fold_ids\"))") < redeem_src.rfind('{"status": 200, "data": got}'))
check("the hub's ref check is its list of live connections",
      "_chat_push_listed(body.get(\"refs\"), verdict)" in segment("chat_refs"))
check("a broken chat_push import stops nothing else",
      re.search(r"try:\n    import chat_push\nexcept Exception", SOURCE) is not None)
start = SOURCE.index("CHAT PUSH (server/chat_push.py)")
check("the push's section sits after live chat's and before Time Off's (whose suite runs what follows it)",
      SOURCE.index("LIVE CHAT (server/chat_live.py)") < start < SOURCE.index("TIME OFF (server/time_off.py)"))
section = SOURCE[start: SOURCE.index("TIME OFF (server/time_off.py)")]
log_calls = re.findall(r"log\.(?:warning|info|debug|error)\((.*?)\)\n", section, flags=re.S)
check("the section logs by state, count, the service's or the keys' answer and error names only",
      len(log_calls) == 4 and all(c.rstrip().endswith(("type(exc).__name__", ", why")) or "state, took, " in c
                                  for c in log_calls), log_calls)
check("chat_push.py imports no web framework and no database driver, and logs nothing",
      not re.search(r"^(import|from) (fastapi|psycopg2|httpx)", PUSH_SOURCE, flags=re.M)
      and "log." not in PUSH_SOURCE)
pkg = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
check("npm run check runs this file, next to the live chat relay's",
      pkg["scripts"].get("test:chat-push") == "python3 tools/test-chat-push.py"
      and "npm run test:chat-live-relay && npm run test:chat-push" in pkg["scripts"]["check"])

print("THE SERVICE WORKER")
SW = r"""
const fs = require('fs'); const vm = require('vm')
const handlers = {}; const shown = []; const opened = []
const self = {
  addEventListener: (k, f) => { handlers[k] = f }, skipWaiting: () => {},
  registration: { scope: 'https://hub.invalid/', showNotification: async (t, o) => { shown.push({ t, o }) } },
  clients: { matchAll: async () => [], claim: async () => {}, openWindow: async (u) => { opened.push(u) } },
}
vm.runInNewContext(fs.readFileSync(process.argv[1], 'utf8'), { self, console })
const fire = async (kind, ev) => { let p; handlers[kind]({ ...ev, waitUntil: (x) => { p = x } }); await p }
;(async () => {
  const pay = JSON.parse(process.argv[2])
  await fire('push', { data: { json: () => pay } })
  await fire('push', { data: { json: () => ({ ...pay, tag: 'chat-<b>' }) } })
  await fire('push', { data: { json: () => ({ title: 'n', tag: 'srv-12', id: 12 }) } })
  await fire('notificationclick', { notification: { close: () => {}, data: shown[0].o.data } })
  console.log(JSON.stringify({ shown: shown.map((s) => ({ title: s.t, body: s.o.body, tag: s.o.tag || '',
    href: s.o.data.href, id: s.o.data.id })), opened }))
})()
"""
try:
    out = subprocess.run(["node", "-e", SW, str(ROOT / "public" / "sw.js"), json.dumps(pay)],
                         capture_output=True, text=True, timeout=60)
    seen = json.loads(out.stdout.strip().splitlines()[-1]) if out.returncode == 0 and out.stdout.strip() else None
except (OSError, ValueError, subprocess.TimeoutExpired) as exc:
    seen, out = None, exc
check("the service worker shows a chat push with its thread's tag, its words and its link",
      seen is not None and seen["shown"][0] == {"title": "New message from Ann Roe", "body": "Open My Inbox to read it.",
                                                "tag": pay["tag"], "href": "/app/my-inbox/chat?with=per-1", "id": 0},
      getattr(out, "stderr", out) if seen is None else seen)
check("…drops a tag of any other shape, keeps a notice's",
      seen is not None and seen["shown"][1]["tag"] == "" and seen["shown"][2]["tag"] == "srv-12")
check("…and a click with nothing open opens My Inbox's chat on that conversation, naming no notice",
      seen is not None and seen["opened"] == ["https://hub.invalid/#/app/my-inbox/chat?with=per-1"],
      seen and seen["opened"])

print(f"\nchat push: {results['ok']} ok, {len(results['failed'])} failed")
sys.exit(1 if results["failed"] else 0)
