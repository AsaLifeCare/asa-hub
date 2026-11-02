#!/usr/bin/env python3
"""A chat send written behind (chat_live.Behind and its wiring in snapshot_service.py).

Between two people neither of whom is narrowed, at headquarters, a send is kept here first — a 0600 file — and
answered at once with the id and the moment Apps Script files it under; both ends hear it at once (the words on the
chat stream, the hub, the push); Apps Script gets it behind, one sender's sends in order, with the same write id, so a
re-delivery is its receipt and never a second row. Until it lands every read Apps Script answers carries it, and the
cache is never filled without it. Nothing is kept first until Apps Script has shown it names a row by its write id; a
refusal after the answer takes the line back and tells the sender. A fake Chat.gs answers behind the relay, as the
new Chat.gs does (chatSendId_, chatSendAt_). Pure: no database, no network."""
import __future__
import ast
import asyncio
import copy
import hashlib
import json
import os
import re
import shutil
import stat
import sys
import tempfile
import time
import urllib.parse
from pathlib import Path
from typing import Any

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parent.parent
SERVER = ROOT / "server"
SOURCE = (SERVER / "snapshot_service.py").read_text(encoding="utf-8")
TREE = ast.parse(SOURCE)
LIVE_SOURCE = (SERVER / "chat_live.py").read_text(encoding="utf-8")
CHAT_GS = (ROOT / "apps-script" / "Chat.gs").read_text(encoding="utf-8")
sys.path.insert(0, str(SERVER))
import chat_live as cl  # noqa: E402

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
    def __init__(self, t: float) -> None:
        self.t = t

    def __call__(self) -> float:
        return self.t


def entry_for(write_id: str = "Lw1", frm: str = "per-ann", to: str = "per-bob", body: str = "hi",
              at: str = "2026-09-30T13:00:00.000Z", account: str = "") -> dict[str, Any]:
    return cl.behind_entry(write_id=write_id, account_id=account or frm, person_id=frm, ids=[frm], name=frm.upper(),
                           to_user=to, to_person=to, to_ids=[to], body=body, client_id="c-" + write_id, source="hub",
                           raw=b"body=x", created_at=at, wall=1000.0)


print("THE ID APPS SCRIPT FILES A KEPT SEND UNDER")
check("the relay names a row as Chat.gs chatSendId_ does (the SelfTest asserts the same vector)",
      cl.message_id_for("Lwid-0001", "acc-1") == "msg_2a0e2e494be84e2b1e1b973f")
check("…the same write id run as another account is another row",
      cl.message_id_for("Lwid-0001", "acc-2") != cl.message_id_for("Lwid-0001", "acc-1"))
check("Chat.gs derives it from the write id and the account, and takes the relay's moment",
      "chatSendId_(HUB_WRITE_ID, user.user_id || user.id)" in CHAT_GS and "chatSendAt_(payload && payload.at)" in CHAT_GS
      and "sha256Hex_(wid + '\\n' + acct).slice(0, 24)" in CHAT_GS)

print("WHICH SENDS ARE KEPT HERE FIRST")
base = {"on": True, "acting": False, "place": "", "sender_narrowed": False, "to_narrowed": False,
        "sender_person": "per-ann", "to_person": "per-bob", "room": True}
check("two people neither narrowed, at headquarters, once proven: kept", cl.behind_refusal(**base) == "")
for change, why in (({"on": False}, "off"), ({"acting": True}, "acting"), ({"place": "akron"}, "place"),
                    ({"place": None}, "place"), ({"sender_narrowed": None}, "unknown"),
                    ({"to_narrowed": None}, "unknown"), ({"sender_narrowed": True}, "sender"),
                    ({"to_narrowed": True}, "recipient"), ({"to_person": "per-ann"}, "self"),
                    ({"to_person": ""}, "self"), ({"room": False}, "full")):
    check(f"…not kept: {why} {change}", cl.behind_refusal(**{**base, **change}) == why)

print("THE KEPT SENDS, ALONE")
clk = Clock(1000.0)
behind = cl.Behind(clock=clk, keep_s=60, max_pending=2)
check("nothing is kept until Apps Script has shown it names rows so", behind.on is False and not behind.any())
check("a proof switches it on, and says it changed", behind.learn(True, "proven") is True and behind.on)
check("…the same proof again changes nothing", behind.learn(True, "proven") is False)
e1, e2 = entry_for("Lw1", body="one", at="2026-09-30T13:00:01.000Z"), entry_for("Lw2", body="two",
                                                                                 at="2026-09-30T13:00:02.000Z")
e3 = entry_for("Lw3", frm="per-cy", to="per-ann", body="three", at="2026-09-30T13:00:00.500Z")
behind.add(e1)
behind.add(e3)
check("one sender's sends leave in the order they were kept", behind.next_for("per-ann") is e1
      and behind.senders() == ["per-ann", "per-cy"])
check("a full book keeps no more", behind.room() is False)
behind.landed("Lw1")
behind.add(e2)
check("a landed send leaves the lane, and the next one is at its head", behind.next_for("per-ann") is e2
      and behind.held("Lw1") is e1 and not behind.waiting("Lw1"))
check("…a read still carries a landed send for a while", [e["id"] for e in behind.touching_thread(e1["thread_key"])]
      == [e1["id"], e2["id"]] and len(behind.touching(("per-ann",))) == 3)
clk.t += 61
check("…and then it is the sheet's alone", behind.held("Lw1") is None
      and [e["id"] for e in behind.touching_thread(e1["thread_key"])] == [e2["id"]])
behind.drop("Lw2")
check("a refused send is gone at once", behind.held("Lw2") is None and behind.stats["refused"] == 1)
check("a file read back is taken only whole and under the id its write id names",
      cl.behind_valid(e3) and not cl.behind_valid({**e3, "id": "msg_" + "0" * 24})
      and not cl.behind_valid({**e3, "thread_key": "x|y"}) and not cl.behind_valid({**e3, "v": 2})
      and not cl.behind_valid({k: v for k, v in e3.items() if k != "raw"}))
check("counts only: no id, no word, no account", not re.search(r"per-|msg_|three|Lw", json.dumps(
    {k: v for k, v in behind.counts().items() if k != "why"})), behind.counts())
check("a send filed under another id switches it off, and says so",
      behind.learn(False, "moved") is True and behind.on is False and behind.stats["switched_off"] == 1)

print("WHAT ONE DELIVERY CAME TO")
e = entry_for("Lw9")
check("the row under the id both ends were given: landed",
      cl.behind_outcome(e, {"status": 200, "data": {"id": e["id"]}}) == ("landed", ""))
check("a row under another id, or none said: moved",
      cl.behind_outcome(e, {"status": 200, "data": {"id": "msg_other"}}) == ("moved", "msg_other")
      and cl.behind_outcome(e, {"status": 200, "data": {}})[0] == "moved")
check("nothing known yet, or nothing ran: tried again",
      all(cl.behind_outcome(e, a)[0] == "retry" for a in (
          {"status": 504, "reason": "unconfirmed"}, {"status": 502, "reason": "unreachable"},
          {"status": 500, "message": "Internal error"}, {"status": 409, "message": "busy"},
          {"status": 429}, None, {"status": "200"})))
check("a verdict: refused, with Apps Script's own words",
      cl.behind_outcome(e, {"status": 404, "message": "Not found."}) == ("refused", "Not found.")
      and cl.behind_outcome(e, {"status": 401})[0] == "refused")

print("A READ APPS SCRIPT ANSWERED, WITH THE SENDS IT DOES NOT CARRY YET")
k = e1["thread_key"]
sheet_msgs = {"messages": [{"id": "msg_a", "from_user": "per-bob", "from_name": "Bob", "body": "earlier",
                            "created_at": "2026-09-30T12:00:00.000Z", "read_at": "", "mine": False}],
              "reset": False, "reactions": {}}
got = cl.overlay_messages(sheet_msgs, k, {"per-ann"}, [e2, e1])
check("the thread's kept sends follow the sheet's rows, in time order, with the reader's own `mine`",
      [m["id"] for m in got["messages"]] == ["msg_a", e1["id"], e2["id"]] and got["messages"][1]["mine"] is True
      and got["messages"][1]["read_at"] == "" and got["messages"][1]["from_user"] == "per-ann"
      and sheet_msgs["messages"][0]["id"] == "msg_a" and len(sheet_msgs["messages"]) == 1, got)
bob_view = cl.overlay_messages(sheet_msgs, k, {"per-bob"}, [e1])
check("…the other end reads it as not its own", bob_view["messages"][-1]["mine"] is False)
check("…a row the sheet already carries is not added twice, nor another thread's send",
      cl.overlay_messages({**sheet_msgs, "messages": [*sheet_msgs["messages"], cl.behind_row(e1, {"per-ann"})]}, k,
                          {"per-ann"}, [e1, e3])["messages"].count(cl.behind_row(e1, {"per-ann"})) == 1
      and cl.overlay_messages(sheet_msgs, k, {"per-ann"}, [e3]) is sheet_msgs)
rail = {"me": "per-bob", "threads": [{"thread_key": k, "with_user": "per-ann", "with_name": "Ann", "last": "old",
                                      "last_at": "2026-09-30T12:00:00.000Z", "unread": 1}],
        "people": [{"user_id": "per-cy", "name": "Cy", "online": True}], "unread": 1}
got = cl.overlay_rail(rail, "per-bob", [e1, e2])
check("the person written to: the thread's last line moves, one more unread for each",
      got["threads"][0]["last"] == "two" and got["threads"][0]["unread"] == 3 and got["unread"] == 3
      and rail["threads"][0]["unread"] == 1, got)
got = cl.overlay_rail(rail, "per-cy", [e1, e2])
check("…the rail of a person who is neither end is not moved", got is rail)
ann_rail = {"me": "per-ann", "threads": [], "people": [{"user_id": "per-bob", "name": "Bob", "online": True}],
            "unread": 0}
got = cl.overlay_rail(ann_rail, "per-ann", [e1])
check("the sender: a first conversation appears, named from the people, with nothing unread",
      got["threads"] == [{"thread_key": k, "with_user": "per-bob", "with_name": "Bob", "last": "one",
                          "last_at": e1["created_at"], "unread": 0, "online": True, "last_from": "per-ann"}]
      and got["unread"] == 0, got)
check("…a rail that already shows a line as late carries it",
      cl.overlay_rail({**rail, "threads": [{**rail["threads"][0], "last_at": e2["created_at"]}]}, "per-bob", [e1, e2])
      ["threads"][0]["unread"] == 1)
check("…a narrowed rail is never moved", cl.overlay_rail({**rail, "circle": {"why": ""}}, "per-bob", [e1]) is not None
      and cl.overlay_rail({**rail, "circle": {"why": ""}}, "per-bob", [e1])["threads"][0]["unread"] == 1)
ping = {"unread": 1, "latest": {"id": "msg_a", "at": "2026-09-30T12:00:00.000Z", "from_user": "per-ann",
                                "from_name": "Ann", "body": "earlier"}, "me": "per-bob"}
got = cl.overlay_ping(ping, "per-bob", [e1, e2, e3])
check("the beat: every kept send to this person newer than its newest line, and the newest said",
      got["unread"] == 3 and got["latest"]["id"] == e2["id"] and got["latest"]["body"] == "two", got)
check("…and none to the sender", cl.overlay_ping({**ping, "me": "per-ann"}, "per-ann", [e1, e2]) ==
      {**ping, "me": "per-ann"})

print("THE LINES")
words = json.loads(cl.behind_line(e1, mine=False))
mine = json.loads(cl.behind_line(e1, mine=True))
check("the recipient's line carries the words and the conversation it belongs to",
      words["kind"] == "chatSend" and words["message"]["body"] == "one" and words["message"]["with_user"] == "per-ann"
      and words["message"]["mine"] is False and words["from_user"] == e1["from_account"])
check("…the sender's other tabs file it under the person written to", mine["message"]["with_user"] == "per-bob"
      and mine["message"]["mine"] is True)
check("a refused send's line names only the row that goes, never the words",
      json.loads(cl.behind_gone_line(e1)) == {"kind": "chatSend", "thread_key": k, "from_user": "per-ann",
                                              "at": e1["created_at"], "gone": e1["id"]})
check("the hub is told a send from outside it with the words its own confirm carries",
      cl.behind_event(e1, held=False)["kind"] == "sent" and cl.behind_event(e1, held=False)["body"] == "one"
      and cl.behind_refused_event(e1, "no")["kind"] == "refused" and "body" not in cl.behind_refused_event(e1, "no"))

print("THE CACHE HOLDS A KEPT SEND UNTIL IT LANDS")
cclk = Clock(5000.0)
cache = cl.ChatCache(clock=cclk, wall=lambda: 1_800_000_000.0, fresh_s=60)
slot = ("t", "", k)
cache.fill_thread("", k, {"per-ann"}, {"messages": [], "reactions": {}}, cclk.t - 1)
cclk.t += 1
cache.sent("", k, {"per-ann"}, {"id": e1["id"], "created_at": e1["created_at"], "from_name": "Ann", "body": "one"})
cache.pin(keys=(k,), people=("per-ann", "per-bob"))
cclk.t += 1
check("a pinned thread is served as patched", [m["id"] for m in cache.thread("", k, {"per-bob"})["messages"]]
      == [e1["id"]])
check("…and a read from Apps Script that lacks the send fills nothing, however late it began",
      cache.fill_thread("", k, {"per-ann"}, {"messages": [], "reactions": {}}, cclk.t) == "late"
      and cache.counts()["pinned"] == 3)
began = cclk.t
cclk.t += 1
cache.unpin(keys=(k,), people=("per-ann", "per-bob"))
check("once it lands a read that began before still fills nothing",
      cache.fill_thread("", k, {"per-ann"}, {"messages": [], "reactions": {}}, began) == "late")
cclk.t += 1
check("…and one that began after fills again", cache.fill_thread(
    "", k, {"per-ann"}, {"messages": [cl.behind_row(e1, {"per-ann"})], "reactions": {}}, cclk.t) == ""
      and cache.counts()["pinned"] == 0)
check("a copy kept on disk is not taken up over a pinned thread",
      cache.pin(keys=("x|y",)) is None and not cache.adopt(cl.ChatCache.file_name(("t", "", "x|y")), {
          "v": 1, "slot": ["t", "", "x|y"], "filled_at": 1_800_000_000.0, "value": {"messages": [], "reactions": {}}}))

print("THE RELAY: A FAKE CHAT.GS BEHIND IT")


class FakeRequest:
    def __init__(self, body: bytes = b"") -> None:
        self._body = body
        self.query_params: dict[str, str] = {}

    async def body(self) -> bytes:
        return self._body


class FakeJSON:
    def __init__(self, content: Any, status_code: int = 200, headers: dict[str, str] | None = None) -> None:
        self.content, self.status_code, self.headers = content, status_code, headers or {}


class Gate:
    CHAT_FRAME = "gate_chat_live_frame"
    held = False

    def holds(self, gate_id: str) -> dict[str, Any]:
        return {"held": self.held and gate_id == self.CHAT_FRAME, "why": "", "unreadable": False}


class FakeFeed:
    enabled = True

    def __init__(self) -> None:
        self.events: list[dict[str, Any]] = []

    async def send(self, event: dict[str, Any], *, tries: int = 1) -> bool:
        self.events.append(event)
        return True


class Log:
    def __init__(self) -> None:
        self.lines: list[str] = []

    def warning(self, msg: str, *args: Any) -> None:
        self.lines.append(msg % args if args else msg)

    info = debug = error = warning


USERS = [{"user_id": "per-ann", "display_name": "Ann"}, {"user_id": "acc-ann2", "same_as": "per-ann"},
         {"user_id": "per-bob", "display_name": "Bob"}, {"user_id": "per-cy", "display_name": "Cy"},
         {"user_id": "per-cli", "display_name": "Cli", "role": "client"},
         {"user_id": "per-far", "display_name": "Far", "home_tenant": "akron"}]


class Sheet:
    """Chat.gs and doPost, as far as a kept send can see them."""

    def __init__(self) -> None:
        self.rows: list[dict[str, Any]] = []
        self.fold = {"acc-ann2": "per-ann"}
        self.tokens: dict[str, tuple[str, str]] = {}
        self.names = {"per-ann": "Ann", "per-bob": "Bob", "per-cy": "Cy", "per-cli": "Cli", "per-far": "Far"}
        self.receipts: dict[str, dict[str, Any]] = {}
        self.names_rows = True      # the new Chat.gs: a row is named by its write id
        self.refuse: str = ""
        self.n = 0

    def person(self, uid: str) -> str:
        return self.fold.get(uid, uid)

    def key(self, a: str, b: str) -> str:
        return cl.pair_key(self.person(a), self.person(b))

    def answer(self, env: dict[str, Any]) -> dict[str, Any]:
        wid = str(env.get("write_id") or "")
        if wid and wid in self.receipts:
            return copy.deepcopy(self.receipts[wid])
        got = self.run(env)
        if wid and got.get("status", 500) < 500:
            self.receipts[wid] = copy.deepcopy(got)
        return got

    def run(self, env: dict[str, Any]) -> dict[str, Any]:
        account, role = self.tokens.get(env.get("token"), ("", ""))
        if not account:
            return {"status": 401, "message": "Authentication required."}
        me, action, p = self.person(account), env["action"], env.get("payload") or {}
        if action == "chatSend":
            if self.refuse:
                return {"status": 404, "message": self.refuse}
            key = self.key(me, p["to_user"])
            self.n += 1
            rid = (cl.message_id_for(env["write_id"], account) if self.names_rows and env.get("write_id")
                   else "msg_%012d" % self.n)
            at = p.get("at") or "2026-09-30T14:%02d:00.000Z" % self.n
            self.rows.append({"id": rid, "from": me, "name": self.names.get(me, ""), "to": p["to_user"],
                              "body": str(p["body"]).strip(), "at": at, "read": ""})
            return {"status": 200, "data": {"id": rid, "created_at": at, "thread_key": key, "emailed": False}}
        if action == "chatMessages":
            key = self.key(me, p["with_user"])
            rows = [r for r in self.rows if self.key(r["from"], r["to"]) == key]
            return {"status": 200, "data": {"messages": [
                {"id": r["id"], "from_user": r["from"], "from_name": r["name"], "body": r["body"],
                 "created_at": r["at"], "read_at": r["read"], "mine": self.person(r["from"]) == me} for r in rows],
                "reset": False, "reactions": {}}}
        if action == "chatOverview":
            threads: dict[str, dict[str, Any]] = {}
            for r in self.rows:
                key = self.key(r["from"], r["to"])
                pair = key.split("|")
                if me not in pair:
                    continue
                other = pair[1] if pair[0] == me else pair[0]
                t = threads.setdefault(key, {"thread_key": key, "with_user": other, "with_name": self.names[other],
                                             "last": "", "last_at": "", "unread": 0})
                if r["at"] >= t["last_at"]:
                    t.update(last_at=r["at"], last=r["body"][:140], last_from=r["from"])
                if self.person(r["to"]) == me and not r["read"]:
                    t["unread"] += 1
            listed = sorted(threads.values(), key=lambda t: t["last_at"], reverse=True)
            return {"status": 200, "data": {"me": me, "threads": listed, "people": [
                {"user_id": u, "name": nm, "online": False} for u, nm in sorted(self.names.items()) if u != me],
                "unread": sum(t["unread"] for t in listed)}}
        if action == "chatPing":
            mine = [r for r in self.rows if self.person(r["to"]) == me and not r["read"]]
            top = max(mine, key=lambda r: r["at"]) if mine else None
            return {"status": 200, "data": {"unread": len(mine), "me": me, "latest": None if top is None else {
                "id": top["id"], "at": top["at"], "from_user": top["from"], "from_name": top["name"],
                "body": top["body"]}}}
        return {"status": 404, "message": "Unknown action."}


sheet = Sheet()
posted: list[dict[str, Any]] = []
# how the next POSTs of a send go (the reads always answer)
script: list[str] = []
kept: list[Any] = []
pushes: list[tuple[str, Any]] = []
subs: dict[str, set[Any]] = {}
feed = FakeFeed()
gate = Gate()
logged = Log()


def envelope_of(raw: bytes) -> dict[str, Any]:
    return json.loads(urllib.parse.parse_qs(raw.decode())["body"][0])


async def chat_post(raw: bytes, timeout: float) -> tuple[str, bytes]:
    env = envelope_of(raw)
    posted.append(env)
    if script and env["action"] == "chatSend":
        how = script.pop(0)
        if how == "lands-unanswered":
            sheet.answer(env)
            return "timeout", b""
        return how, b""
    return "json", json.dumps(sheet.answer(env)).encode()


class Queue:
    def __init__(self, acting: bool = False) -> None:
        self.lines: list[str] = []
        self.acting = acting

    def put_nowait(self, line: str) -> None:
        self.lines.append(line)


async def vouched(token: str) -> bool:
    return token in sheet.tokens


fold = cl.FoldCache(lambda: USERS)
registry = cl.Registry()
KEY_HUB = "k" * 64
token_users: dict[str, str] = {}
auth_cache: dict[str, tuple[float, bool, str, str]] = {}
tmp = Path(tempfile.mkdtemp(prefix="chat-behind-"))
(tmp / "snapshot").mkdir()
(tmp / "bundles").mkdir()
(tmp / "packs").mkdir()
os.environ["HUB_APP_PACK_DIR"] = str(tmp / "packs")
ns: dict[str, Any] = {
    "json": json, "time": time, "asyncio": asyncio, "Any": Any, "os": os, "tempfile": tempfile, "Path": Path,
    "hashlib": hashlib, "urllib": urllib, "log": logged,
    "Request": FakeRequest, "Response": FakeJSON, "JSONResponse": FakeJSON,
    "Header": lambda default="", alias=None: default,
    "chat_live": cl, "lane_gate": gate, "_chat_feed": feed, "_CHAT_KEY": KEY_HUB,
    "_chat_refs": registry, "_chat_unsettled": cl.Unsettled(settle_s=0.3), "_chat_fold": fold,
    "_chat_live_by_action": {}, "_acting": {}, "_auth_master": {},
    "_keep_task": lambda coro: kept.append(asyncio.ensure_future(coro)),
    "_token_user_get": lambda t: token_users.get(t, ""), "_token_name_get": lambda t: "",
    "_chat_live_post": chat_post, "_chat_subs": subs, "_chat_dirty": {}, "_auth_cache": auth_cache,
    "_token_vouched": vouched, "_relay_is_service": lambda raw: False,
    "_relay_observe_chat": lambda raw, content: None, "_relay_observe_chat_read": lambda raw, content: None,
    "_chat_push_observed": lambda raw, content, ident=None: pushes.append((envelope_of(raw)["action"], ident)),
    "_chat_push_seen": lambda ids: None,
    "OUT_DIR": tmp / "snapshot", "BUNDLE_DIR": tmp / "bundles", "CHAT_CACHE_DIR": "",
}
load(ns, "_my_work_acting", "_CHAT_LIVE_DOWN", "_CHAT_LIVE_ACTING", "_CHAT_LIVE_UNNARROWED", "_CHAT_LIVE_NOT_LISTED",
     "_chat_live_answer", "_chat_live_emit", "_chat_live_revoke", "_chat_live_rail_kept", "_chat_live_narrowed_exec",
     "_chat_live_body", "chat_exec", "_chat_cache_busy", "_chat_cache_said", "_chat_cache_hold", "_chat_cache_ids",
     "_chat_cache_place", "_chat_cache_view", "_chat_cache_took", "_chat_live_run", "_chat_cache_reread",
     "_chat_cache_read_again", "_chat_cache_forget_write", "_chat_cache_write", "_chat_cache_wrote",
     "_chat_cache_dir_state", "_relay_token")
load(ns, "CHAT_BEHIND_LOGOUT_WAIT_S", "_CHAT_BEHIND_READS", "_chat_behind_where", "_chat_behind_lanes",
     "_chat_behind_said", "_chat_frame_held", "_chat_behind_health", "_chat_behind_disk_write",
     "_chat_behind_disk_remove", "_chat_behind_disk_read", "_chat_behind_state_save", "_chat_behind_answer",
     "_chat_behind_learn", "_chat_behind_publish", "_chat_behind_fact", "_chat_behind_told",
     "_chat_behind_patch", "_chat_behind_unpin", "_chat_behind_keep", "_chat_behind_wake", "_chat_behind_lane",
     "_chat_behind_landed", "_chat_behind_moved", "_chat_behind_refused", "_chat_behind_take_back",
     "_chat_behind_nudge", "_chat_behind_overlaid", "_chat_behind_gas_read",
     "_chat_behind_waiting_for", "_chat_behind_flush_for", "_chat_behind_start")
ns["_chat_cache"] = cache = cl.ChatCache(fresh_s=60)
ns["_chat_behind"] = behind = cl.Behind()
ns["CHAT_BEHIND_DIR"] = str(tmp / "packs" / "chat-behind")
cl.BEHIND_BACKOFF_S = (0.05, 0.05, 0.05, 0.05)
fold.index()


def session(token: str, account: str, role: str = "staff", tenant: str = "", master: bool = False) -> str:
    sheet.tokens[token] = (account, role)
    token_users[token] = account
    auth_cache[token] = (time.time(), True, role, account)
    person, folds = fold.identity(account)
    ident = {"account_id": account, "person_id": person, "fold_ids": folds, "name": sheet.names.get(person, ""),
             "is_master": master, "narrowed": cl.narrowed(role)}
    return registry.redeem(registry.mint(token, tenant, ident))["ref"]


client_ids = [0]


async def settle_all() -> None:
    for _ in range(400):
        waiting = [t for t in [*kept, *ns["_chat_behind_lanes"].values()] if not t.done()]
        if not waiting:
            break
        await asyncio.sleep(0.01)
    kept.clear()


def execute(ref: str, action: str, payload: dict[str, Any] | None = None, *, client_id: str = "",
            wait: bool = True) -> dict[str, Any]:
    body: dict[str, Any] = {"ref": ref, "action": action, "payload": payload or {}}
    if action in cl.WRITES:
        client_ids[0] += 1
        body["client_id"] = client_id or "client-%04d" % client_ids[0]

    async def go():
        got = await ns["chat_exec"](FakeRequest(json.dumps(body).encode()), x_hub_chat_key=KEY_HUB)
        if wait:
            await settle_all()
        return got.content

    return asyncio.run(go())


async def a_exec(ref: str, action: str, payload: dict[str, Any], client_id: str = "") -> dict[str, Any]:
    body: dict[str, Any] = {"ref": ref, "action": action, "payload": payload}
    if action in cl.WRITES:
        client_ids[0] += 1
        body["client_id"] = client_id or "client-%04d" % client_ids[0]
    got = await ns["chat_exec"](FakeRequest(json.dumps(body).encode()), x_hub_chat_key=KEY_HUB)
    return got.content


def gas_form(token: str, action: str, payload: dict[str, Any], write_id: str = "", **extra: Any) -> bytes:
    env = {"token": token, "action": action, "payload": payload, **extra}
    if write_id:
        env["write_id"] = write_id
    return urllib.parse.urlencode({"body": json.dumps(env)}).encode()


ann, bob, cy, cli = (session("tok-ann", "per-ann"), session("tok-bob", "per-bob"), session("tok-cy", "per-cy"),
                     session("tok-cli", "per-cli", role="client"))
far = session("tok-far", "per-far", tenant="akron")
bob_tab, ann_tab, acting_tab = Queue(), Queue(), Queue(acting=True)
subs["per-bob"] = {bob_tab, acting_tab}
subs["per-ann"] = {ann_tab}

# the folder is made on start, inside the packs' volume; nothing is kept yet
asyncio.run(ns["_chat_behind_start"]())
folder = ns["_chat_behind_where"]["folder"]
check("its own folder inside the packs' volume, made 0700, never the served tree",
      folder == (tmp / "packs" / "chat-behind").resolve() and stat.S_IMODE(folder.stat().st_mode) == 0o700
      and 'os.getenv("HUB_CHAT_BEHIND_DIR", "/srv/app-packs/chat-behind")' in segment("CHAT_BEHIND_DIR"))

print("BEFORE APPS SCRIPT HAS SHOWN IT: EVERY SEND IS ITS OWN")
n = len(posted)
first = execute(ann, "chatSend", {"to_user": "per-bob", "body": "before the proof"}, client_id="client-first")
wid_first = cl.write_id_for("per-ann", "client-first")
check("a send before any proof goes to Apps Script and answers its own receipt",
      len(posted) == n + 1 and first["status"] == 200 and "behind" not in first
      and first["data"]["id"] == cl.message_id_for(wid_first, "per-ann"), first)
check("…whose id is the one the relay would have given it: from now on sends are kept here first",
      behind.on is True and json.loads((folder / cl.BEHIND_STATE_FILE).read_text())["on"] is True
      and stat.S_IMODE((folder / cl.BEHIND_STATE_FILE).stat().st_mode) == 0o600)

print("A KEPT SEND")
bob_tab.lines.clear()
acting_tab.lines.clear()
feed.events.clear()
pushes.clear()
n = len(posted)


async def keep_one() -> tuple[dict[str, Any], int, list[str]]:
    answer = await a_exec(ann, "chatSend", {"to_user": "per-bob", "body": "  kept first  "}, "client-kept")
    at_answer = len(posted)
    files = sorted(p.name for p in folder.iterdir() if cl.BEHIND_FILE_RE.fullmatch(p.name))
    await settle_all()
    return answer, at_answer, files


kept_answer, posted_at_answer, files_at_answer = asyncio.run(keep_one())
wid_kept = cl.write_id_for("per-ann", "client-kept")
kept_id = cl.message_id_for(wid_kept, "per-ann")
check("answered at once, before anything left for Apps Script, with the id and moment the row will carry",
      kept_answer["status"] == 200 and kept_answer.get("behind") is True and posted_at_answer == n
      and kept_answer["data"]["id"] == kept_id and kept_answer["data"]["thread_key"] == "per-ann|per-bob"
      and kept_answer["frame_held"] is False, kept_answer)
check("…kept first as one 0600 file under a name that says nobody's",
      len(files_at_answer) == 1 and not any(s in files_at_answer[0] for s in ("per-", "msg_", "Lw", "kept")))
check("…then written behind: the row under that id and moment, the words trimmed as Chat.gs keeps them",
      len(posted) == n + 1 and posted[-1]["write_id"] == wid_kept and posted[-1]["payload"]["at"] ==
      kept_answer["data"]["created_at"] and sheet.rows[-1]["id"] == kept_id and sheet.rows[-1]["body"] == "kept first"
      and sheet.rows[-1]["at"] == kept_answer["data"]["created_at"], posted[-1])
check("…and once it landed its file is gone and nothing is held", not any(cl.BEHIND_FILE_RE.fullmatch(p.name)
                                                                          for p in folder.iterdir())
      and cache.counts()["pinned"] == 0 and behind.counts()["waiting"] == 0)
line = json.loads(bob_tab.lines[0])
check("the recipient's tab heard the words at once; a tab acting as the recipient heard only the fact",
      line["message"]["id"] == kept_id and line["message"]["body"] == "kept first"
      and line["message"]["with_user"] == "per-ann" and json.loads(acting_tab.lines[0]).get("message") is None
      and "kept first" not in acting_tab.lines[0])
check("the sender's other tabs heard it as their own", json.loads(ann_tab.lines[-1])["message"]["mine"] is True)
check("the push decides for the recipient now (the hub's own send needs no hub event)",
      pushes and pushes[-1][0] == "chatSend" and pushes[-1][1]["person_id"] == "per-ann"
      and not [ev for ev in feed.events if ev.get("kind") == "sent"])
check("the beat knows a message waits for the recipient", ns["_chat_dirty"].get("per-bob") ==
      kept_answer["data"]["created_at"])
again = execute(ann, "chatSend", {"to_user": "per-bob", "body": "  kept first  "}, client_id="client-kept")
check("the same client id again is the same receipt, and no second row",
      again["data"]["id"] == kept_id and sum(1 for r in sheet.rows if r["id"] == kept_id) == 1, again)

print("WHILE IT WAITS, EVERY READ CARRIES IT")
script.extend(["timeout"])     # the first delivery leaves and is not answered (and did not land)
n_rows = len(sheet.rows)


async def keep_and_read() -> dict[str, Any]:
    answer = await a_exec(ann, "chatSend", {"to_user": "per-bob", "body": "waiting"}, "client-wait")
    reads = {
        "bob_msgs": await a_exec(bob, "chatMessages", {"with_user": "per-ann"}),
        "bob_rail": await a_exec(bob, "chatOverview", {}),
        "bob_ping": await a_exec(bob, "chatPing", {}),
        "ann_msgs": await a_exec(ann, "chatMessages", {"with_user": "per-bob"}),
    }
    gas = {
        "msgs": ns["_chat_behind_gas_read"](gas_form("tok-bob", "chatMessages", {"with_user": "per-ann"}),
                                            json.dumps(sheet.answer({"token": "tok-bob", "action": "chatMessages",
                                                                     "payload": {"with_user": "per-ann"}})).encode()),
        "cy": ns["_chat_behind_gas_read"](gas_form("tok-cy", "chatMessages", {"with_user": "per-ann"}),
                                          json.dumps(sheet.answer({"token": "tok-cy", "action": "chatMessages",
                                                                   "payload": {"with_user": "per-ann"}})).encode()),
    }
    rows_while = len(sheet.rows)
    await settle_all()
    return {"answer": answer, "reads": reads, "gas": gas, "rows_while": rows_while}


seen = asyncio.run(keep_and_read())
wait_id = seen["answer"]["data"]["id"]
check("…the recipient's read of the thread, from Apps Script or the cache, has it",
      wait_id in [m["id"] for m in seen["reads"]["bob_msgs"]["data"]["messages"]]
      and seen["rows_while"] == n_rows, seen["reads"]["bob_msgs"])
bob_thread = next(t for t in seen["reads"]["bob_rail"]["data"]["threads"] if t["with_user"] == "per-ann")
check("…its rail shows the line", bob_thread["last"] == "waiting", seen["reads"]["bob_rail"])
check("…its beat counts it", seen["reads"]["bob_ping"]["data"]["latest"]["id"] == wait_id,
      seen["reads"]["bob_ping"])
check("…the sender's own read has it as theirs",
      [m for m in seen["reads"]["ann_msgs"]["data"]["messages"] if m["id"] == wait_id][0]["mine"] is True)
check("…a /gas read of the thread has it too", wait_id in seen["gas"]["msgs"].decode())
check("…and a third person's read never does", wait_id not in seen["gas"]["cy"].decode())
check("…an attempt that left unanswered was given time to settle, then landed exactly once",
      sum(1 for r in sheet.rows if r["id"] == wait_id) == 1 and behind.counts()["waiting"] == 0)

print("ONE THAT LANDED WHILE ITS ANSWER WAS LOST")
script.extend(["lands-unanswered"])
lost = execute(ann, "chatSend", {"to_user": "per-bob", "body": "landed, unanswered"}, client_id="client-lost")
check("its receipt answers the next delivery: one row, under its id",
      sum(1 for r in sheet.rows if r["id"] == lost["data"]["id"]) == 1 and behind.counts()["waiting"] == 0
      and lost["data"]["id"] == cl.message_id_for(cl.write_id_for("per-ann", "client-lost"), "per-ann"))

print("NARROWED, AWAY, UNKNOWN: APPS SCRIPT JUDGES FIRST, AS BEFORE")
for ref_, to, label in ((ann, "per-cli", "to a client"), (cli, "per-ann", "from a client"),
                        (far, "per-ann", "away from headquarters"), (ann, "per-nobody", "to an account nobody lists")):
    n = len(posted)
    got = execute(ref_, "chatSend", {"to_user": to, "body": "judged first"})
    check(f"…{label}: not kept, Apps Script answered it", "behind" not in got and len(posted) >= n + 1, got)
check("…and each is counted by why", {"recipient", "unknown", "place"} <= set(behind.not_kept), behind.not_kept)

print("A REFUSAL AFTER THE ANSWER")
bob_tab.lines.clear()
ann_tab.lines.clear()
feed.events.clear()
sheet.refuse = "Not found."
refused = execute(ann, "chatSend", {"to_user": "per-bob", "body": "will be refused"}, client_id="client-refused")
sheet.refuse = ""
rid = refused["data"]["id"]
check("it was answered as kept", refused.get("behind") is True)
check("…its row never appears, its file is gone, nothing is held",
      not any(r["id"] == rid for r in sheet.rows) and behind.counts()["waiting"] == 0
      and cache.counts()["pinned"] == 0 and not any(cl.BEHIND_FILE_RE.fullmatch(p.name) for p in folder.iterdir()))
gone_bob = [json.loads(x) for x in bob_tab.lines if '"gone"' in x]
said_ann = [json.loads(x) for x in ann_tab.lines if "write_refused" in x]
check("…the recipient's tab takes the line back, the sender is told why",
      gone_bob and gone_bob[0]["gone"] == rid and said_ann and said_ann[0]["why"] == "Not found.", (bob_tab.lines,
                                                                                                  ann_tab.lines))
ev = [x for x in feed.events if x.get("kind") == "refused"]
check("…and the hub is told, by the client id its tabs drew the line under",
      ev and ev[0]["client_id"] == "client-refused" and ev[0]["id"] == rid and ev[0]["from"] == "per-ann")
bob_read = execute(bob, "chatMessages", {"with_user": "per-ann"})
check("…and no read carries it any more", rid not in [m["id"] for m in bob_read["data"]["messages"]])

print("A READ FROM TODAY'S CHAT (/gas)")
check("a read /gas carried for somebody the relay cannot name is left as it came",
      ns["_chat_behind_gas_read"](gas_form("tok-ghost", "chatPing", {}), b'{"status":200}') == b'{"status":200}')

print("THE GATE HOLDS THE WORDS")
gate.held = True
bob_tab.lines.clear()
ann_tab.lines.clear()
held_send = execute(ann, "chatSend", {"to_user": "per-bob", "body": "gate held"}, client_id="client-held")
gate.held = False
check("while the chat gate holds, the recipient's tabs hear nothing and the hub is told it is held",
      held_send.get("behind") is True and not bob_tab.lines and held_send["frame_held"] is True
      and ann_tab.lines and "gate held" in ann_tab.lines[0])

print("A SIGN-OUT WAITS FOR ITS SENDS")
script.extend(["timeout"])


async def logout() -> tuple[int, float]:
    await a_exec(ann, "chatSend", {"to_user": "per-bob", "body": "just before signing out"}, "client-out")
    waiting_before = len(ns["_chat_behind_waiting_for"]("tok-ann"))
    t0 = time.monotonic()
    await ns["_chat_behind_flush_for"]("tok-ann")
    await settle_all()
    return waiting_before, time.monotonic() - t0


waiting_before, took = asyncio.run(logout())
check("…until the session's kept sends have landed", waiting_before == 1 and not ns["_chat_behind_waiting_for"](
    "tok-ann") and took < 10, (waiting_before, took))

print("A RESTART")
ns["_chat_behind_where"]["folder"] = folder
restart_entry = cl.behind_entry(write_id="Lrestart00000001", account_id="per-cy", person_id="per-cy", ids=["per-cy"],
                                name="Cy", to_user="per-ann", to_person="per-ann", to_ids=["per-ann"],
                                body="kept across a restart", client_id="c-r", source="gas",
                                raw=gas_form("tok-cy", "chatSend", {"to_user": "per-ann", "body": "kept across a restart",
                                                                    "at": "2026-09-30T13:30:00.000Z"},
                                             write_id="Lrestart00000001"),
                                created_at="2026-09-30T13:30:00.000Z", wall=time.time())
restart_entry["file"] = "%020d.%s.behind.json" % (time.time_ns(), "0" * 16)
ns["_chat_behind_disk_write"](folder, restart_entry["file"], restart_entry)
(folder / ("." + restart_entry["file"] + ".abc_12.tmp")).write_text("torn")
(folder / ("%020d.%s.behind.json" % (1, "1" * 16))).write_text("{not json")
ns["_chat_behind"] = behind = cl.Behind()
ns["_chat_cache"] = cache = cl.ChatCache(fresh_s=60)


async def restart() -> None:
    await ns["_chat_behind_start"]()
    await settle_all()


asyncio.run(restart())
check("the proof is kept across it", behind.on is True)
check("a kept send is taken up and written behind; the torn write is removed; one it cannot read is left and counted",
      any(r["id"] == restart_entry["id"] for r in sheet.rows) and ns["_chat_behind_said"]["restored"] == 1
      and ns["_chat_behind_said"]["unreadable"] == 1 and not any(p.name.endswith(".tmp") for p in folder.iterdir())
      and (folder / ("%020d.%s.behind.json" % (1, "1" * 16))).exists(), sorted(os.listdir(folder)))

print("A ROW FILED UNDER ANOTHER ID")
sheet.names_rows = False
feed.events.clear()
bob_tab.lines.clear()
moved = execute(ann, "chatSend", {"to_user": "per-bob", "body": "an older Chat.gs"}, client_id="client-moved")
sheet.names_rows = True
check("it switches keeping off and says so; both ends drop the line and read the row itself",
      moved.get("behind") is True and behind.on is False and json.loads(
          (folder / cl.BEHIND_STATE_FILE).read_text())["on"] is False
      and any('"gone"' in x for x in bob_tab.lines) and any(x.get("moved") for x in feed.events)
      and any(x.get("kind") == "nudge" for x in feed.events), (behind.counts(), feed.events))
n = len(posted)
after_off = execute(ann, "chatSend", {"to_user": "per-bob", "body": "after"}, client_id="client-after")
check("…the next send goes to Apps Script, and proves it again", "behind" not in after_off and len(posted) == n + 1
      and behind.on is True)

print("NOTHING WHOSE IS LOGGED, OR SAID")
health = ns["_chat_behind_health"]()
check("/health counts only: no id, no token, no word",
      not re.search(r"per-|acc-|tok-|msg_|kept first|waiting\"?: \"", json.dumps(
          {k: v for k, v in health.items() if k != "why"})), health)
check("the relay's lines say what happened, never whose or what",
      logged.lines and not any(re.search(r"per-|tok-|acc-|msg_|Lw|Not found|kept first|signing out", x)
                               for x in logged.lines), logged.lines)
glue = "\n".join(segment(n) for n in ("_chat_behind_keep", "_chat_behind_lane", "_chat_behind_told",
                                      "_chat_behind_landed", "_chat_behind_moved", "_chat_behind_refused",
                                      "_chat_behind_gas_read", "_chat_behind_start"))
check("no log line carries a body, a token or an id", not re.search(r"log\.\w+\([^)]*(body|token|entry\[)", glue))
behind_src = LIVE_SOURCE[LIVE_SOURCE.index("class Behind"):]
check("the kept sends' own code touches no disk and logs nothing", "log." not in behind_src and "open(" not in behind_src)

print("THE WIRING")
check("the hub's send is kept before it could go to Apps Script; a narrowed one never is",
      segment("chat_exec").index("_chat_behind_keep(") < segment("chat_exec").index("_chat_live_narrowed_exec(")
      and 'if action == "chatSend" and not ident.get("narrowed"):' in segment("chat_exec"))
check("every answer a sync send gets teaches whether rows are named so",
      "_chat_behind_learn(write_id" in segment("chat_exec"))
check("/gas's chat reads, answered by Python, carry the kept sends", "_chat_behind_gas_read(raw, content)" in
      segment("_chat_python_gas"))
check("a sign-out waits for the session's kept sends", "_chat_behind_flush_for(_t)" in segment("gas_relay"))
check("the exec door's reads carry kept sends, after the cache took Apps Script's own answer",
      segment("_chat_live_run").index("_chat_cache_took(") < segment("_chat_live_run").index("_chat_behind_overlaid("))
check("a start takes the kept sends up; /health counts them",
      "_chat_behind_start()" in segment("_start") and '"behind": _chat_behind_health()' in segment("_chat_live_health"))
check("the relay's ask of Python keeps to its budget, and never posts to Apps Script",
      "asyncio.wait_for(_chat_python_ask(env, payload, left), timeout=left)" in segment("_chat_live_post")
      and "EXEC_URL" not in segment("_chat_live_post") and "EXEC_URL" not in segment("_chat_python_ask"))
check("the section sits after the cache's and before the push's",
      SOURCE.index("THE CACHE (chat_live.ChatCache)") < SOURCE.index("WRITTEN BEHIND (chat_live.Behind)")
      < SOURCE.index("CHAT PUSH (server/chat_push.py)"))

shutil.rmtree(tmp, ignore_errors=True)
print(f"\nchat behind: {results['ok']} ok, {len(results['failed'])} failed")
sys.exit(1 if results["failed"] else 0)
