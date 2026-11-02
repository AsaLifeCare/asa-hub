#!/usr/bin/env python3
"""Live chat's cache (chat_live.ChatCache and its wiring in snapshot_service.py).

A read the relay holds is answered at once, only to one of the thread's two people (a rail only to its own person, a
client's or a guardian's only to that account), and read again behind the answer one read per slot at a time. Every
confirmed send, reaction and read mark patches it; a read that began before a change never fills it; a write that may
still land holds what it touches off until it has settled; a failure drops what it names. It is kept as 0600 files
under hashed names, never in the served tree or the bundle deposit. A fake Chat.gs answers beside it, and the cached
answer is checked against the sheet's after every write. Pure: no database, no network."""
import __future__
import ast
import asyncio
import copy
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


def msg(mid: str, frm: str, mine: bool, body: str = "hi", at: str = "", read: str = "") -> dict[str, Any]:
    return {"id": mid, "from_user": frm, "from_name": frm.upper(), "body": body, "created_at": at, "read_at": read,
            "mine": mine}


print("THE CACHE, ALONE")
KEY = cl.pair_key("per-bob", "per-ann")
check("a thread's key is Chat.gs's: the two people sorted and joined; nobody with themself, nobody missing",
      KEY == "per-ann|per-bob" and cl.pair_key("a", "a") == "" and cl.pair_key("", "b") == ""
      and cl.pair_key("a|b", "c") == "")
ANN, BOB, CY = frozenset({"per-ann", "acc-ann2"}), frozenset({"per-bob"}), frozenset({"per-cy"})
check("a viewer is one end of a thread, or none of it",
      cl.side_of(KEY, ANN) == 0 and cl.side_of(KEY, BOB) == 1 and cl.side_of(KEY, CY) is None
      and cl.side_of(KEY, ANN | BOB) is None and cl.side_of("nokey", ANN) is None)
check("an instant is written as toISOString writes it", cl.iso_at(1759147200.25) == "2025-09-29T12:00:00.250Z",
      cl.iso_at(1759147200.25))

clk, wall = Clock(1000.0), Clock(1_800_000_000.0)
c = cl.ChatCache(clock=clk, wall=wall, fresh_s=15, ceiling_s=3600)
T1, T2, T3 = "2026-09-29T12:00:01.000Z", "2026-09-29T12:00:02.000Z", "2026-09-29T12:00:03.000Z"
THREAD = {"messages": [msg("m1", "per-ann", True, "hello", T1), msg("m2", "per-bob", False, "hey", T2)],
          "reset": False, "reactions": {"m1": {"+1": ["per-bob"]}}}
began = clk()
clk.t += 1
check("a whole thread fills", c.fill_thread("", KEY, ANN, THREAD, began) == "")
check("…and is served to that end as Apps Script answered it", c.thread("", KEY, ANN) == THREAD, c.thread("", KEY, ANN))
got = c.thread("", KEY, BOB)
check("…to the other end with its own `mine`",
      [(m["id"], m["mine"]) for m in got["messages"]] == [("m1", False), ("m2", True)]
      and got["reactions"] == THREAD["reactions"], got)
check("…never to a third person, never in another place",
      c.thread("", KEY, CY) is None and c.thread("akron", KEY, ANN) is None and c.thread(None, KEY, ANN) is None)
check("…never to a viewer who is both ends", c.thread("", KEY, ANN | BOB) is None)
check("after a cursor: what follows it",
      [m["id"] for m in c.thread("", KEY, ANN, after="m1")["messages"]] == ["m2"]
      and c.thread("", KEY, ANN, after="m2")["messages"] == [])
check("a cursor it does not hold is not answered from it", c.thread("", KEY, ANN, after="m0") is None)
served = c.thread("", KEY, ANN)
served["messages"][0]["body"] = "changed by a caller"
served["reactions"]["m1"]["+1"].append("x")
check("what it serves is a copy", c.thread("", KEY, ANN) == THREAD)
check("`mine` marks that disagree with the viewer's ids fill nothing (the folds differ)",
      c.fill_thread("", KEY, ANN, {"messages": [msg("m1", "per-ann", False)], "reactions": {}}, clk()) == "wrong"
      and c.fill_thread("", KEY, ANN, {"messages": [msg("m1", "acc-other", True)], "reactions": {}}, clk()) == "wrong")
check("an answer that is not a thread fills nothing",
      c.fill_thread("", KEY, ANN, {"messages": "no"}, clk()) == "wrong"
      and c.fill_thread("", KEY, ANN, None, clk()) == "wrong"
      and c.fill_thread("", KEY, CY, THREAD, clk()) == "wrong")
check("a read older than the window fills nothing",
      c.fill_thread("", KEY, ANN, THREAD, clk() - cl.CACHE_READ_WINDOW_S - 1) == "late")

print("A CONFIRMED SEND")
RAIL_ANN = {"me": "per-ann", "unread": 0, "people": [{"user_id": "per-bob", "online": True}],
            "threads": [{"thread_key": "per-ann|per-cy", "with_user": "per-cy", "last": "old", "last_at": T1,
                         "last_from": "per-cy", "unread": 0},
                        {"thread_key": KEY, "with_user": "per-bob", "last": "hey", "last_at": T1, "last_from": "per-bob",
                         "unread": 0}]}
RAIL_BOB = {"me": "per-bob", "unread": 2, "people": [],
            "threads": [{"thread_key": KEY, "with_user": "per-ann", "last": "hello", "last_at": T1,
                         "last_from": "per-ann", "unread": 2}]}
began = clk()
clk.t += 1
check("a rail fills for its own person",
      c.fill_rail("", "per-ann", "", RAIL_ANN, began, False) == "" and c.fill_rail("", "per-bob", "", RAIL_BOB, began,
                                                                                    False) == "")
check("…is served to that person only, never under another person's name or variant",
      c.rail("", "per-ann", "") == RAIL_ANN and c.rail("", "per-cy", "") is None
      and c.rail("", "per-ann", "acc-ann2") is None and c.rail("akron", "per-ann", "") is None)
check("a rail whose `me` is somebody else fills nothing",
      c.fill_rail("", "per-cy", "", RAIL_ANN, clk(), False) == "wrong")
check("a narrowed rail fills only with Chat.gs's circle mark, only under its account, and a staff rail never carries one",
      c.fill_rail("", "per-cli", "per-cli", {**RAIL_ANN, "me": "per-cli"}, clk(), True) == "wrong"
      and c.fill_rail("", "per-cli", "", {**RAIL_ANN, "me": "per-cli", "circle": {}}, clk(), True) == "wrong"
      and c.fill_rail("", "per-ann", "", {**RAIL_ANN, "circle": {}}, clk(), False) == "wrong")
began_before = clk()
clk.t += 1
c.fill_thread("akron", KEY, ANN, THREAD, clk() - 0.5)
ok = c.sent("", KEY, ANN, {"id": "m3", "created_at": T3, "from_name": "Ann", "body": "  new line  "},
            expected_key=KEY, sender_person="per-ann", to_person="per-bob")
got = c.thread("", KEY, BOB)
check("the message joins the thread's copy, as the sheet stores it (trimmed, unread, the sender's person)",
      ok and got["messages"][-1] == {"id": "m3", "from_user": "per-ann", "from_name": "Ann", "body": "new line",
                                     "created_at": T3, "read_at": "", "mine": False}, got)
check("…and the thread's copy in another place is dropped", c.thread("akron", KEY, ANN) is None)
rail_b, rail_a = c.rail("", "per-bob", ""), c.rail("", "per-ann", "")
check("the recipient's rail: the new last line, one more unread in the thread and in all",
      rail_b["unread"] == 3 and rail_b["threads"][0]["unread"] == 3 and rail_b["threads"][0]["last"] == "new line"
      and rail_b["threads"][0]["last_at"] == T3 and rail_b["threads"][0]["last_from"] == "per-ann", rail_b)
check("the sender's rail: the thread moves to the top, nothing unread added",
      [t["thread_key"] for t in rail_a["threads"]] == [KEY, "per-ann|per-cy"] and rail_a["unread"] == 0
      and rail_a["threads"][0]["unread"] == 0, rail_a)
check("a read that began before the send fills nothing over it",
      c.fill_thread("", KEY, ANN, THREAD, began_before) == "late"
      and c.fill_rail("", "per-bob", "", RAIL_BOB, began_before, False) == "late"
      and c.thread("", KEY, ANN)["messages"][-1]["id"] == "m3")
c.sent("", KEY, ANN, {"id": "m3", "created_at": T3, "body": "new line"}, expected_key=KEY)
check("the same receipt twice is one message and one unread",
      [m["id"] for m in c.thread("", KEY, ANN)["messages"]].count("m3") == 1 and c.rail("", "per-bob", "")["unread"] == 3)
c.fill_thread("", "per-ann|per-cy", ANN, {"messages": [], "reactions": {}}, clk())
c.sent("", "per-ann|per-cy", ANN, {"id": "m9", "created_at": T3, "body": "x"}, expected_key="per-ann|per-zed",
       sender_person="per-ann", to_person="per-zed")
check("a thread key Apps Script answered that the relay's folds do not make: both copies and both rails dropped",
      c.thread("", "per-ann|per-cy", ANN) is None and c.rail("", "per-ann", "") is None)
c.fill_rail("", "per-ann", "", RAIL_ANN, clk(), False)
c.sent("", "per-ann|per-dee", frozenset({"per-ann"}), {"id": "m10", "created_at": T3, "body": "first"},
       expected_key="per-ann|per-dee")
check("a first message to somebody the rail has no thread with: the rail is dropped, not guessed",
      c.rail("", "per-ann", "") is None)

print("REACTIONS AND READ MARKS")
c.reacted("", KEY, BOB, "m3", {"heart": ["per-bob"]})
check("a reaction lands on the thread's copy, whole", c.thread("", KEY, ANN)["reactions"]["m3"] == {"heart": ["per-bob"]})
c.reacted("", KEY, BOB, "m3", {})
check("…and a reaction taken back leaves no entry", "m3" not in c.thread("", KEY, ANN)["reactions"])
c.reacted("", KEY, BOB, "m-old", {"x": ["per-bob"]})
check("a reaction on a message the copy cannot place drops the copy", c.thread("", KEY, ANN) is None)
clk.t += 1
c.fill_thread("", KEY, ANN, {"messages": [msg("m1", "per-ann", True, at=T1), msg("m2", "per-bob", False, at=T2),
                                          msg("m3", "per-ann", True, at=T3)], "reactions": {}}, clk())
c.fill_rail("", "per-bob", "", RAIL_BOB, clk(), False)
c.read("", KEY, BOB, "2026-09-29T12:01:00.000Z", reader_person="per-bob")
got = c.thread("", KEY, ANN)
check("a read mark: every message to the reader read, none of the reader's own",
      [(m["id"], bool(m["read_at"])) for m in got["messages"]] == [("m1", True), ("m2", False), ("m3", True)], got)
rail_b = c.rail("", "per-bob", "")
check("…and the reader's rail counts none in the thread, and that many fewer in all",
      rail_b["threads"][0]["unread"] == 0 and rail_b["unread"] == 0, rail_b)

print("A FAILURE, AND A WRITE THAT MAY STILL LAND")
c.forget(keys=(KEY,), people=("per-ann",), settle_s=30)
check("dropped: the thread and the rail are gone", c.thread("", KEY, BOB) is None and c.rail("", "per-ann", "") is None)
check("…held off: a read that ends inside the settle fills nothing",
      c.fill_thread("", KEY, ANN, THREAD, clk()) == "late" and c.fill_rail("", "per-ann", "", RAIL_ANN, clk(),
                                                                           False) == "late")
clk.t += 31
check("…a read that began after it has settled fills again", c.fill_thread("", KEY, ANN, THREAD, clk()) == "")
c.forget_person("per-bob")
check("a write whose writer is not known drops every thread of the person it names",
      c.thread("", KEY, ANN) is None)
c.fill_thread("", KEY, ANN, THREAD, clk())
c.forget_message("m1", 5)
check("a reaction whose thread is not known drops every copy holding its message", c.thread("", KEY, ANN) is None)
clk.t += 6
c.fill_thread("", KEY, ANN, THREAD, clk())
began = clk()
clk.t += 1
c.forget_all()
check("everything dropped at once, and no read that began before fills", c.thread("", KEY, ANN) is None
      and c.fill_thread("", KEY, ANN, THREAD, began) == "late" and c.fill_thread("", KEY, ANN, THREAD, clk() + 0) == "late")
clk.t += 1
check("…one that began after does", c.fill_thread("", KEY, ANN, THREAD, clk()) == "")

print("FRESH, STALE, PAST THE CEILING, AND FULL")
check("a copy just confirmed needs no read behind it", not c.needs_refresh(("t", "", KEY)))
wall.t += 16
check("…one confirmed longer ago than the fresh window does", c.needs_refresh(("t", "", KEY)))
wall.t += 3600
check("past the ceiling: not served, and dropped", c.thread("", KEY, ANN) is None and not c.holds(("t", "", KEY)))
small = cl.ChatCache(clock=clk, wall=wall, max_entries=2)
for other in ("per-b1", "per-b2", "per-b3"):
    clk.t += 1
    small.fill_thread("", cl.pair_key("per-ann", other), ANN, {"messages": [], "reactions": {}}, clk())
    if other == "per-b2":
        clk.t += 1
        small.thread("", cl.pair_key("per-ann", "per-b1"), ANN)
check("full: the least recently used copy goes",
      small.holds(("t", "", "per-ann|per-b1")) and not small.holds(("t", "", "per-ann|per-b2"))
      and small.holds(("t", "", "per-ann|per-b3")) and small.stats["evicted"] == 1)
tiny = cl.ChatCache(clock=clk, wall=wall, max_bytes=400)
tiny.fill_thread("", KEY, ANN, {"messages": [msg(f"m{i}", "per-ann", True, "x" * 50) for i in range(10)],
                                "reactions": {}}, clk())
check("…and past its bytes, too", not tiny.holds(("t", "", KEY)) and tiny.counts()["bytes"] == 0)
long_thread = {"messages": [msg(f"m{i:03d}", "per-ann", True, at=f"2026-09-29T12:{i // 60:02d}:{i % 60:02d}.000Z")
                            for i in range(250)], "reactions": {f"m{i:03d}": {"x": ["per-bob"]} for i in range(600)}}
clk.t += 1
c.fill_thread("", KEY, ANN, long_thread, clk())
got = c.thread("", KEY, ANN)
check("a copy keeps the last hundred messages, and the last five hundred reaction marks",
      len(got["messages"]) == 100 and got["messages"][0]["id"] == "m150" and len(got["reactions"]) == 500)

print("KEPT ON DISK")
jobs = dict(c.take_dirty())
name = cl.ChatCache.file_name(("t", "", KEY))
check("every changed slot has a job: its file under a hash of the slot, never an id",
      name in jobs and cl.CACHE_FILE_RE.fullmatch(name) and all(cl.CACHE_FILE_RE.fullmatch(n) for n in jobs)
      and not any(i in n for n in jobs for i in ("per-", "acc-", "m1")), sorted(jobs)[:3])
check("…a dropped slot's job removes its file", any(text is None for text in jobs.values()))
check("…and nothing is left to do after", c.take_dirty() == [])
fresh = cl.ChatCache(clock=Clock(5.0), wall=wall)
body = json.loads(jobs[name])
check("a kept file is taken up after a start, read again the first time it is served",
      fresh.adopt(name, body) and fresh.thread("", KEY, ANN) == got and fresh.needs_refresh(("t", "", KEY))
      and fresh.take_dirty() == [])
check("…never under another slot's name, past the ceiling, or in another shape",
      not cl.ChatCache(wall=wall).adopt(cl.ChatCache.file_name(("t", "", "per-ann|per-cy")), body)
      and not cl.ChatCache(wall=wall).adopt(name, {**body, "filled_at": wall.t - 99999})
      and not cl.ChatCache(wall=wall).adopt(name, {**body, "value": {"messages": [{"id": "m1"}], "reactions": {}}})
      and not cl.ChatCache(wall=wall).adopt(name, {**body, "v": 2}))
changed = cl.ChatCache(wall=wall)
changed.forget(keys=(KEY,))
check("…never over a thread changed since the start", not changed.adopt(name, body))
rail_name = cl.ChatCache.file_name(("o", "", "per-bob", ""))
rail_body = {"v": 1, "slot": ["o", "", "per-bob", ""], "filled_at": wall.t, "value": RAIL_BOB}
check("a rail is taken up only as its own person's",
      cl.ChatCache(wall=wall).adopt(rail_name, rail_body)
      and not cl.ChatCache(wall=wall).adopt(rail_name, {**rail_body, "value": {**RAIL_BOB, "me": "per-ann"}}))

print("THE EXEC DOOR ANSWERS FROM IT")


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

    def holds(self, gate_id: str) -> dict[str, Any]:
        return {"held": False, "why": "", "unreadable": False}


class OffFeed:
    enabled = False


USERS = [{"user_id": "per-ann", "display_name": "Ann"}, {"user_id": "acc-ann2", "same_as": "per-ann"},
         {"user_id": "per-bob", "display_name": "Bob"}, {"user_id": "per-cy", "display_name": "Cy"},
         {"user_id": "per-cli", "display_name": "Cli", "role": "client"},
         {"user_id": "per-far", "display_name": "Far", "home_tenant": "akron"}]


class Sheet:
    """Chat.gs, as far as the cache can see it."""

    def __init__(self) -> None:
        self.rows: list[dict[str, Any]] = []
        self.n = 0
        self.fold = {"acc-ann2": "per-ann"}
        self.tokens: dict[str, tuple[str, str]] = {}
        self.names = {"per-ann": "Ann", "per-bob": "Bob", "per-cy": "Cy", "per-cli": "Cli", "per-far": "Far"}
        self.circle = {"per-cli": {"per-ann"}}

    def person(self, uid: str) -> str:
        return self.fold.get(uid, uid)

    def key(self, a: str, b: str) -> str:
        return cl.pair_key(self.person(a), self.person(b))

    def now(self) -> str:
        self.n += 1
        return "2026-09-29T13:%02d:%02d.000Z" % divmod(self.n, 60)

    def shown(self, r: dict[str, Any], me: str) -> dict[str, Any]:
        return {"id": r["id"], "from_user": r["from"], "from_name": r["name"], "body": r["body"], "created_at": r["at"],
                "read_at": r["read"], "mine": self.person(r["from"]) == me}

    def answer(self, env: dict[str, Any]) -> dict[str, Any]:
        account, role = self.tokens.get(env.get("token"), ("", ""))
        if not account:
            return {"status": 401, "message": "Authentication required."}
        me, action, p = self.person(account), env["action"], env.get("payload") or {}
        narrowed = role in ("client", "guardian")
        mine = self.circle.get(me, set())
        if action == "chatMessages":
            key = self.key(me, p["with_user"])
            if narrowed and self.person(p["with_user"]) not in mine:
                return {"status": 404, "message": "Not found."}
            rows = [r for r in self.rows if self.key(r["from"], r["to"]) == key]
            after, out, seen = p.get("after") or "", [], not p.get("after")
            for r in rows:
                if not seen:
                    seen = r["id"] == after
                    continue
                out.append(self.shown(r, me))
            reset = bool(after) and not seen
            if reset:
                out = [self.shown(r, me) for r in rows]
            return {"status": 200, "data": {"messages": out[-300:], "reset": reset, "reactions": {
                r["id"]: copy.deepcopy(r["reactions"]) for r in rows if r["reactions"]}}}
        if action == "chatOverview":
            threads: dict[str, dict[str, Any]] = {}
            for r in self.rows:
                key = self.key(r["from"], r["to"])
                pair = key.split("|")
                if me not in pair:
                    continue
                other = pair[1] if pair[0] == me else pair[0]
                t = threads.setdefault(key, {"thread_key": key, "with_user": other, "with_name": "", "last": "",
                                             "last_at": "", "unread": 0})
                if r["at"] >= t["last_at"]:
                    t.update(last_at=r["at"], last=r["body"][:140], last_from=r["from"])
                if self.person(r["to"]) == me and not r["read"]:
                    t["unread"] += 1
                if r["from"] == other and not t["with_name"]:
                    t["with_name"] = r["name"]
            people = [{"user_id": u, "name": n, "online": False, "seen_at": ""} for u, n in sorted(self.names.items())
                      if u != me and (not narrowed or u in mine)]
            listed = [t for t in threads.values() if not narrowed or t["with_user"] in mine]
            for t in listed:
                t["with_name"] = t["with_name"] or self.names.get(t["with_user"], "")
                t["online"] = False
            listed.sort(key=lambda t: t["last_at"], reverse=True)
            data = {"me": me, "threads": listed, "people": people, "unread": sum(t["unread"] for t in listed)}
            if narrowed:
                data["circle"] = {"why": ""}
            return {"status": 200, "data": data}
        if action == "chatSend":
            key, at = self.key(me, p["to_user"]), self.now()
            rid = "msg_%03d" % (len(self.rows) + 1)
            self.rows.append({"id": rid, "from": me, "name": self.names.get(me, ""), "to": p["to_user"],
                              "body": p["body"].strip()[:4000], "at": at, "read": "", "reactions": {}})
            return {"status": 200, "data": {"id": rid, "created_at": at, "thread_key": key, "emailed": False}}
        if action == "chatReact":
            r = next(r for r in self.rows if r["id"] == p["message_id"])
            ids = r["reactions"].setdefault(p["emoji"], [])
            on = me not in ids
            if on:
                ids.append(me)
            else:
                ids.remove(me)
            if not ids:
                del r["reactions"][p["emoji"]]
            other = r["to"] if self.person(r["from"]) == me else r["from"]
            return {"status": 200, "data": {"message_id": r["id"], "reactions": copy.deepcopy(r["reactions"]),
                                            "on": on, "to_user": other}}
        if action == "chatMarkRead":
            key, marked = self.key(me, p["with_user"]), 0
            for r in self.rows:
                if self.key(r["from"], r["to"]) == key and self.person(r["to"]) == me and not r["read"]:
                    r["read"], marked = self.now(), marked + 1
            return {"status": 200, "data": {"marked": marked}}
        return {"status": 200, "data": {"unread": 0, "latest": None, "me": me}}


sheet = Sheet()
posted: list[dict[str, Any]] = []
script: list[str] = []
observed: list[str] = []
kept: list[Any] = []


def envelope_of(raw: bytes) -> dict[str, Any]:
    return json.loads(urllib.parse.parse_qs(raw.decode())["body"][0])


async def chat_post(raw: bytes, timeout: float) -> tuple[str, bytes]:
    env = envelope_of(raw)
    posted.append(env)
    if script:
        how = script.pop(0)
        if how == "lands-unanswered":
            sheet.answer(env)
            return "timeout", b""
        return how, b""
    return "json", json.dumps(sheet.answer(env)).encode()


fold = cl.FoldCache(lambda: USERS)
registry = cl.Registry()
KEY_HUB = "k" * 64
token_users: dict[str, str] = {}
ns: dict[str, Any] = {
    "json": json, "time": time, "asyncio": asyncio, "Any": Any, "os": os, "tempfile": tempfile, "Path": Path,
    "Request": FakeRequest, "Response": FakeJSON, "JSONResponse": FakeJSON,
    "Header": lambda default="", alias=None: default,
    "chat_live": cl, "lane_gate": Gate(), "_chat_feed": OffFeed(), "_CHAT_KEY": KEY_HUB,
    "_chat_refs": registry, "_chat_unsettled": cl.Unsettled(settle_s=0.3), "_chat_fold": fold,
    "_chat_live_by_action": {}, "_acting": {}, "_auth_master": {}, "EXEC_URL": "https://example.invalid/exec",
    "_keep_task": lambda coro: kept.append(asyncio.ensure_future(coro)),
    "_token_user_get": lambda t: token_users.get(t, ""), "_token_name_get": lambda t: "",
    "_chat_live_post": chat_post,
    "_relay_observe_chat": lambda raw, content: observed.append("chat"),
    "_relay_observe_chat_read": lambda raw, content: observed.append("read:" + envelope_of(raw)["action"]),
    "_chat_push_observed": lambda raw, content, ident=None: None, "_chat_push_seen": lambda ids: None,
}
load(ns, "_my_work_acting", "_CHAT_LIVE_DOWN", "_CHAT_LIVE_ACTING", "_CHAT_LIVE_UNNARROWED", "_CHAT_LIVE_NOT_LISTED",
     "_chat_live_answer", "_chat_live_emit", "_chat_live_revoke", "_chat_live_rail_kept", "_chat_live_narrowed_exec",
     "_chat_live_body", "chat_exec", "_chat_live_observed", "_chat_live_unanswered",
     "_chat_cache_busy", "_chat_cache_said", "_chat_cache_health", "_chat_cache_hold", "_chat_cache_ids",
     "_chat_cache_place", "_chat_cache_view", "_chat_cache_took", "_chat_live_run", "_chat_cache_reread",
     "_chat_cache_read_again", "_chat_cache_forget_write", "_chat_cache_write", "_chat_cache_wrote",
     "_chat_cache_blind", "_chat_cache_observed", "_chat_cache_dir_state", "_chat_cache_disk_read",
     "_chat_cache_disk_write", "_chat_cache_start", "CHAT_CACHE_EXPIRE_EVERY")
# written behind has its own suite (tools/test-chat-behind.py); here nothing is kept first, as before a proof
ns["_chat_behind"] = cl.Behind()
load(ns, "_chat_frame_held", "_CHAT_BEHIND_READS", "_chat_behind_where", "_chat_behind_keep", "_chat_behind_learn",
     "_chat_behind_answer", "_chat_behind_overlaid")
ns["_chat_cache"] = cache = cl.ChatCache(fresh_s=60)
fold.index()


def session(token: str, account: str, role: str = "staff", tenant: str = "", master: bool = False) -> str:
    sheet.tokens[token] = (account, role)
    token_users[token] = account
    person, folds = fold.identity(account)
    ident = {"account_id": account, "person_id": person, "fold_ids": folds, "name": sheet.names.get(person, ""),
             "is_master": master, "narrowed": cl.narrowed(role)}
    return registry.redeem(registry.mint(token, tenant, ident))["ref"]


ids_used = [0]


def execute(ref: str, action: str, payload: dict[str, Any] | None = None, *, between=None) -> dict[str, Any]:
    body: dict[str, Any] = {"ref": ref, "action": action, "payload": payload or {}}
    if action in cl.WRITES:
        ids_used[0] += 1
        body["client_id"] = "client-%04d" % ids_used[0]

    async def go():
        kept.clear()
        ns["_chat_cache_refresh_slots"] = asyncio.Semaphore(2)
        got = await ns["chat_exec"](FakeRequest(json.dumps(body).encode()), x_hub_chat_key=KEY_HUB)
        if between is not None:
            between()
        while kept:
            await kept.pop(0)
        return got.content

    return asyncio.run(go())


def many(*calls: tuple[str, str, dict[str, Any]]) -> list[dict[str, Any]]:
    """Several exec calls at once, on one loop."""
    async def go():
        kept.clear()
        ns["_chat_cache_refresh_slots"] = asyncio.Semaphore(2)
        got = await asyncio.gather(*(ns["chat_exec"](FakeRequest(json.dumps(
            {"ref": r, "action": a, "payload": p}).encode()), x_hub_chat_key=KEY_HUB) for r, a, p in calls))
        while kept:
            await kept.pop(0)
        return [g.content for g in got]

    return asyncio.run(go())


def plain(answer: dict[str, Any]) -> dict[str, Any]:
    """An answer without what moves on its own (presence) or is the relay's own (the frame gate, the cache mark)."""
    data = copy.deepcopy(answer.get("data"))
    if isinstance(data, dict):
        if "messages" in data:
            data["messages"] = [{**m, "read_at": bool(m["read_at"])} for m in data["messages"]]
        for t in data.get("threads") or []:
            t.pop("online", None)
            t.pop("seen_at", None)
        for p in data.get("people") or []:
            p.pop("online", None)
            p.pop("seen_at", None)
    return {"status": answer.get("status"), "data": data}


def sheet_says(token: str, action: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    return plain(sheet.answer({"token": token, "action": action, "payload": payload or {}}))


ann, ann2, bob, cy = (session("tok-ann", "per-ann"), session("tok-ann2", "acc-ann2"), session("tok-bob", "per-bob"),
                      session("tok-cy", "per-cy"))
sheet.rows.append({"id": "msg_000", "from": "per-bob", "name": "Bob", "to": "per-ann", "body": "morning", "at": sheet.now(),
                   "read": "", "reactions": {}})
n = len(posted)
first = execute(ann, "chatMessages", {"with_user": "per-bob"})
check("a thread the cache does not hold goes to Apps Script, as today", len(posted) == n + 1 and "cached" not in first
      and first["status"] == 200)
second = execute(ann, "chatMessages", {"with_user": "per-bob"})
check("…and the next read of it is answered at once, from the cache, with nothing sent",
      len(posted) == n + 1 and second.get("cached") is True and plain(second) == plain(first)
      and second["frame_held"] is False, second)
check("…and a copy that fresh is not read again behind it", not kept and ns["_chat_cache_busy"] == {})
b_view = execute(bob, "chatMessages", {"with_user": "per-ann"})
check("the other end of the thread is answered from the same copy, with its own `mine`",
      b_view.get("cached") is True and plain(b_view) == sheet_says("tok-bob", "chatMessages", {"with_user": "per-ann"}),
      b_view)
a2 = execute(ann2, "chatMessages", {"with_user": "per-bob"})
check("an account folded onto the person is that end too",
      a2.get("cached") is True and plain(a2) == sheet_says("tok-ann2", "chatMessages", {"with_user": "per-bob"}), a2)
n = len(posted)
c_view = execute(cy, "chatMessages", {"with_user": "per-ann"})
check("a third person asking with one end is never given the thread: its own, from Apps Script",
      len(posted) == n + 1 and "cached" not in c_view and c_view["data"]["messages"] == [], c_view)
c_view2 = execute(cy, "chatMessages", {"with_user": "per-bob"})
check("…with either end", "cached" not in c_view2 and c_view2["data"]["messages"] == [])
n = len(posted)
self_view = execute(ann, "chatMessages", {"with_user": "acc-ann2"})
check("a thread with oneself is never cached", len(posted) == n + 1 and "cached" not in self_view)
count_before = dict(ns["_chat_live_by_action"])
execute(ann, "chatMessages", {"with_user": "per-bob"})
check("an answer from the cache spends no execution in the count",
      ns["_chat_live_by_action"] == count_before, (count_before, ns["_chat_live_by_action"]))

print("A SEND, A READ MARK, A REACTION — AND THE CACHE STILL SAYS WHAT THE SHEET SAYS")
execute(bob, "chatOverview")
execute(ann, "chatOverview")
n = len(posted)
rail = execute(bob, "chatOverview")
check("a rail is answered from the cache too", rail.get("cached") is True and len(posted) == n
      and plain(rail) == sheet_says("tok-bob", "chatOverview"), rail)
observed.clear()
execute(bob, "chatOverview")
check("…and a rail from the cache moves no clock (it stamped no presence)", observed == [], observed)
sent = execute(ann, "chatSend", {"to_user": "per-bob", "body": "on my way"})
check("a send goes to Apps Script and is confirmed", sent["status"] == 200 and "cached" not in sent)
n = len(posted)
for token, ref, action, payload in (("tok-bob", bob, "chatMessages", {"with_user": "per-ann"}),
                                    ("tok-ann", ann, "chatMessages", {"with_user": "per-bob"}),
                                    ("tok-bob", bob, "chatOverview", {}), ("tok-ann", ann, "chatOverview", {})):
    got = execute(ref, action, payload)
    check(f"…after it, {token}'s {action} comes from the cache and says what the sheet says",
          got.get("cached") is True and plain(got) == sheet_says(token, action, payload), (plain(got),
                                                                                         sheet_says(token, action, payload)))
check("…with nothing sent to Apps Script", len(posted) == n)
last_id = sent["data"]["id"]
after = execute(bob, "chatMessages", {"with_user": "per-ann", "after": "msg_000"})
check("a read after a cursor it holds: only what follows",
      after.get("cached") is True and [m["id"] for m in after["data"]["messages"]] == [last_id], after)
execute(bob, "chatMarkRead", {"with_user": "per-ann"})
for token, ref, action, payload in (("tok-ann", ann, "chatMessages", {"with_user": "per-bob"}),
                                    ("tok-bob", bob, "chatOverview", {})):
    got = execute(ref, action, payload)
    check(f"a read mark: {token}'s {action} from the cache says what the sheet says",
          got.get("cached") is True and plain(got) == sheet_says(token, action, payload), (plain(got),
                                                                                         sheet_says(token, action, payload)))
execute(bob, "chatReact", {"message_id": last_id, "emoji": "heart"})
got = execute(ann, "chatMessages", {"with_user": "per-bob"})
check("a reaction: the thread from the cache carries it as the sheet does",
      got.get("cached") is True and plain(got) == sheet_says("tok-ann", "chatMessages", {"with_user": "per-bob"}), got)
execute(bob, "chatSend", {"to_user": "acc-ann2", "body": "to the other account"})
got = execute(ann, "chatOverview")
check("a send to a folded account lands on the person's thread and rail",
      got.get("cached") is True and plain(got) == sheet_says("tok-ann", "chatOverview"), (plain(got),
                                                                                        sheet_says("tok-ann", "chatOverview")))

print("A SEND THAT MAY STILL LAND")
real_settle = cl.SETTLE_S
cl.SETTLE_S = 0.3
script.append("lands-unanswered")
unsure = execute(ann, "chatSend", {"to_user": "per-bob", "body": "did this land?"})
check("Apps Script took the send and did not answer: unconfirmed", unsure.get("reason") == "unconfirmed", unsure)
n = len(posted)
got = execute(bob, "chatMessages", {"with_user": "per-ann"})
got_rail = execute(ann, "chatOverview")
check("…the thread and both rails are not answered from the cache while it may still land: Apps Script is asked",
      "cached" not in got and "cached" not in got_rail and len(posted) == n + 2)
again = execute(bob, "chatMessages", {"with_user": "per-ann"})
check("…and what it answers inside the settle fills nothing", "cached" not in again)
time.sleep(0.35)
execute(bob, "chatMessages", {"with_user": "per-ann"})
got = execute(bob, "chatMessages", {"with_user": "per-ann"})
check("…after the settle a read fills again, and it holds the send that landed",
      got.get("cached") is True and "did this land?" in [m["body"] for m in got["data"]["messages"]]
      and plain(got) == sheet_says("tok-bob", "chatMessages", {"with_user": "per-ann"}), got)
execute(bob, "chatOverview")
bob_ident = registry.peek(bob)["ident"]
check("the rail is held again", execute(bob, "chatOverview").get("cached") is True)
ns["_chat_cache_wrote"]("chatMarkRead", bob_ident, "", {"with_user": "per-ann"},
                        {"status": 404, "reason": "circle", "message": "Not found."})
check("a write the relay refused before it left changes nothing", execute(bob, "chatOverview").get("cached") is True)
ns["_chat_cache_wrote"]("chatMarkRead", bob_ident, "", {"with_user": "per-ann"},
                        {"status": 502, "reason": "unreachable", "message": "The server did not answer in time."})
n = len(posted)
check("a read mark Apps Script did not answer: the thread and the reader's rail held off while it may still land",
      "cached" not in execute(bob, "chatOverview") and "cached" not in execute(ann, "chatMessages", {"with_user": "per-bob"})
      and len(posted) == n + 2)
time.sleep(0.35)
cl.SETTLE_S = real_settle
execute(bob, "chatOverview")
before_fail = execute(bob, "chatOverview")
original = sheet.answer


def refuse_send(env: dict[str, Any]) -> dict[str, Any]:
    if env["action"] == "chatSend":
        return {"status": 400, "message": "An empty message is not sent."}
    return original(env)


sheet.answer = refuse_send
execute(bob, "chatSend", {"to_user": "per-ann", "body": "x"})
sheet.answer = original
n = len(posted)
after_fail = execute(bob, "chatOverview")
check("a send Apps Script refused drops the rails it names (read again, not guessed)",
      before_fail.get("cached") is True and "cached" not in after_fail and len(posted) == n + 1)

print("READ AGAIN BEHIND THE ANSWER")
ns["_chat_cache"] = cache = cl.ChatCache(fresh_s=0)
execute(ann, "chatMessages", {"with_user": "per-bob"})
sheet.rows.append({"id": "msg_x", "from": "per-bob", "name": "Bob", "to": "per-ann", "body": "written elsewhere",
                   "at": sheet.now(), "read": "", "reactions": {}})
n = len(posted)
got = many((ann, "chatMessages", {"with_user": "per-bob"}), (ann, "chatMessages", {"with_user": "per-bob"}),
           (bob, "chatMessages", {"with_user": "per-ann"}))
check("three reads of one copy at once: all from the cache, and one read behind them, never two",
      all(g.get("cached") is True for g in got) and len(posted) == n + 1
      and posted[-1]["action"] == "chatMessages" and "after" not in posted[-1]["payload"], (len(posted) - n, got[0]))
check("…as one of the sessions it was served to, in its own place", posted[-1]["token"] in ("tok-ann", "tok-bob")
      and "tenant" not in posted[-1])
got = execute(ann, "chatMessages", {"with_user": "per-bob"})
check("…and what that read brought is what the next answer holds",
      "written elsewhere" in [m["body"] for m in got["data"]["messages"]])
check("…its execution counted, and its clocks moved as any answer's",
      ns["_chat_cache_said"]["refreshes"] >= 1 and "read:chatMessages" in observed)
n = len(posted)
execute(ann, "chatMessages", {"with_user": "per-bob"}, between=lambda: registry.revoke_token("tok-ann"))
check("a read behind an answer for a session that ended meanwhile never leaves", len(posted) == n, posted[n:])
ann = session("tok-ann", "per-ann")
n = len(posted)
execute(ann, "chatMessages", {"with_user": "per-bob"},
        between=lambda: ns["_acting"].__setitem__("tok-ann", (time.time() + 60, "per-ann", "per-cy")))
check("…nor for one acting as someone else now", len(posted) == n, posted[n:])
ns["_acting"].clear()
ns["_chat_cache"] = cache = cl.ChatCache(fresh_s=60)
n = len(posted)
got = execute(ann, "chatMessages", {"with_user": "per-bob", "after": "msg_x"})
check("a cursor read the cache cannot answer goes to Apps Script, and the whole thread is read behind it",
      "cached" not in got and len(posted) == n + 2 and "after" in posted[n]["payload"]
      and "after" not in posted[n + 1]["payload"])
check("…so the next read is instant", execute(ann, "chatMessages", {"with_user": "per-bob"}).get("cached") is True)

print("A CLIENT OR A GUARDIAN")
cli = session("tok-cli", "per-cli", role="client")
n = len(posted)
far_read = execute(cli, "chatMessages", {"with_user": "per-bob"})
check("a narrowed ref reads with nobody its rail does not name: refused here, and the cache is not asked",
      far_read.get("reason") == "circle" and [p["action"] for p in posted[n:]] == ["chatOverview"], far_read)
execute(ann, "chatSend", {"to_user": "per-cli", "body": "hello client"})
execute(ann, "chatMessages", {"with_user": "per-cli"})
got = execute(cli, "chatMessages", {"with_user": "per-ann"})
check("…with one it does: the thread from the cache, as the sheet shows it",
      got.get("cached") is True and plain(got) == sheet_says("tok-cli", "chatMessages", {"with_user": "per-ann"}), got)
n = len(posted)
execute(cli, "chatOverview")
check("a first message from somebody its rail had no thread with: its rail is read again, not guessed",
      len(posted) == n + 1)
cli_rail = execute(cli, "chatOverview")
check("its rail is its own, carried with the circle mark and cut as Chat.gs cut it",
      cli_rail.get("cached") is True and cli_rail["data"]["circle"] == {"why": ""}
      and [p["user_id"] for p in cli_rail["data"]["people"]] == ["per-ann"], cli_rail)
check("…held under its account alone, never where a staff rail of that person would be",
      cache.rail("", "per-cli", "per-cli") is not None and cache.rail("", "per-cli", "") is None)
cli2 = session("tok-cli2", "per-cli", role="staff")
n = len(posted)
staff_rail = execute(cli2, "chatOverview")
check("…so a staff session of the same person never gets it: its own read, from Apps Script",
      "cached" not in staff_rail and len(posted) == n + 1)

print("THE PLACE A SESSION READS")
place = ns["_chat_cache_place"]
check("the tenant named, else the account's home, else headquarters; the master's is headquarters",
      place("akron", "nobody", False) == "akron" and place("", "per-far", False) == "akron"
      and place("", "per-ann", False) == "" and place("", "per-far", True) == "")
check("an account the users copy does not list, or a copy not read, has no place: nothing is cached",
      place("", "nobody", False) is None and cl.FoldCache(lambda: USERS).home_of("per-ann") is None)
broken = cl.FoldCache(lambda: (_ for _ in ()).throw(RuntimeError("down")))
cl.log.disabled = True
broken.index()
cl.log.disabled = False
check("…nor one that could not be read", broken.home_of("per-ann") is None)
far = session("tok-far", "per-far")
execute(far, "chatMessages", {"with_user": "per-ann"})
check("a thread read in the home place is held under it, never under headquarters",
      cache.holds(("t", "akron", "per-ann|per-far")) and not cache.holds(("t", "", "per-ann|per-far")))

print("/gas AND THE LEDGER")
ns["_chat_cache"] = cache = cl.ChatCache(fresh_s=60)


def form(action: str, token: str, payload: dict[str, Any], **extra: Any) -> bytes:
    return urllib.parse.urlencode({"body": json.dumps({"token": token, "action": action, "payload": payload,
                                                       **extra})}).encode()


def via_gas(action: str, token: str, payload: dict[str, Any], **extra: Any) -> None:
    env = {"token": token, "action": action, "payload": payload, **extra}
    ns["_chat_live_observed"](form(action, token, payload, **extra), json.dumps(sheet.answer(env)).encode(), "gas")


via_gas("chatOverview", "tok-bob", {}, member="per-cy")
via_gas("chatMessages", "tok-bob", {"with_user": "per-ann"}, world="wld_1")
ns["_acting"]["tok-bob"] = (time.time() + 60, "per-bob", "per-cy")
via_gas("chatOverview", "tok-bob", {})
ns["_acting"].clear()
via_gas("chatOverview", "tok-unknown", {})
check("a /gas read inside a visit, a world, an act or for a token the relay does not know fills nothing",
      cache.counts()["threads"] == 0 and cache.counts()["rails"] == 0, cache.counts())
via_gas("chatOverview", "tok-bob", {})
via_gas("chatMessages", "tok-bob", {"with_user": "per-ann"})
n = len(posted)
got = execute(bob, "chatOverview")
got_t = execute(ann, "chatMessages", {"with_user": "per-bob"})
check("a /gas read of the session's own fills the cache, and the hub's next read is instant",
      got.get("cached") is True and got_t.get("cached") is True and len(posted) == n
      and plain(got_t) == sheet_says("tok-ann", "chatMessages", {"with_user": "per-bob"}), (got, got_t))
env = {"token": "tok-ann", "action": "chatSend", "payload": {"to_user": "per-bob", "body": "from the old chat"}}
ns["_chat_live_observed"](form("chatSend", "tok-ann", env["payload"]), json.dumps(sheet.answer(env)).encode(), "gas")
got = execute(bob, "chatMessages", {"with_user": "per-ann"})
check("a send /gas answered is patched in as the hub's are",
      got.get("cached") is True and plain(got) == sheet_says("tok-bob", "chatMessages", {"with_user": "per-ann"}), got)
env = {"token": "tok-stranger", "action": "chatSend", "payload": {"to_user": "per-bob", "body": "who am I"}}
sheet.tokens["tok-stranger"] = ("per-cy", "staff")
ns["_chat_live_observed"](form("chatSend", "tok-stranger", env["payload"]), json.dumps(sheet.answer(env)).encode(), "gas")
check("a send by a session the relay cannot place drops every thread and rail of the person it names",
      not cache.holds(("t", "", KEY)) and cache.rail("", "per-bob", "") is None)
execute(bob, "chatMessages", {"with_user": "per-ann"})
cl.SETTLE_S = 0.3
ns["_chat_live_unanswered"](form("chatMarkRead", "tok-bob", {"with_user": "per-ann"}), ())
check("a /gas write that left without an answer: dropped, and held off while it may still land",
      cache.rail("", "per-bob", "") is None and cache.counts()["held_off"] >= 1)
cl.SETTLE_S = real_settle

print("KEPT ON THIS RELAY'S OWN DISK")
tmp = Path(tempfile.mkdtemp(prefix="chat-cache-"))
(tmp / "snapshot").mkdir()
(tmp / "bundles").mkdir()
(tmp / "packs").mkdir()
ns["OUT_DIR"], ns["BUNDLE_DIR"] = tmp / "snapshot", tmp / "bundles"
os.environ["HUB_APP_PACK_DIR"] = str(tmp / "packs")
state = ns["_chat_cache_dir_state"]
for where, why, said in ((tmp / "snapshot" / "chat", "inside the served snapshot tree", "in the served snapshot tree"),
                         (tmp / "bundles" / "chat", "inside the bundle deposit", "in the bundle deposit"),
                         (tmp / "packs", "the app packs' own folder", "among the app packs' own files"),
                         (tmp / "nowhere" / "chat", "missing", "where no volume is mounted")):
    ns["CHAT_CACHE_DIR"] = str(where)
    check(f"never kept {said}", state() == (None, why), state())
ns["CHAT_CACHE_DIR"] = ""
check("…and not at all when turned off", state() == (None, "unset"))
ns["CHAT_CACHE_DIR"] = str(tmp / "packs" / "chat")
folder, why = state()
check("its own folder inside the packs' volume, made 0700",
      why == "" and folder == (tmp / "packs" / "chat").resolve() and stat.S_IMODE(folder.stat().st_mode) == 0o700)
check("the default folder sits in the packs' volume, outside the served tree and the bundle deposit",
      'os.getenv("HUB_CHAT_CACHE_DIR", "/srv/app-packs/chat")' in segment("CHAT_CACHE_DIR"))
time.sleep(0.35)
execute(ann, "chatMessages", {"with_user": "per-bob"})
execute(ann, "chatOverview")
(folder / ("." + "0" * 64 + ".chat.json.abc_12.tmp")).write_text("torn")
jobs = cache.take_dirty()
ns["_chat_cache_disk_write"](folder, jobs)
files = sorted(p.name for p in folder.iterdir())
kept_files = [f for f in files if cl.CACHE_FILE_RE.fullmatch(f)]
check("each copy is a 0600 file under a hashed name, and no name says whose",
      len(kept_files) >= 2 and all(stat.S_IMODE((folder / f).stat().st_mode) == 0o600 for f in kept_files)
      and not any(s in f for f in files for s in ("per-", "acc-", "tok-", "msg_")), files)
found, drop = ns["_chat_cache_disk_read"](folder)
check("a start finds the copies and the torn write", len(found) == len(kept_files)
      and drop == ["." + "0" * 64 + ".chat.json.abc_12.tmp"], (len(found), drop))


async def start_briefly(target: cl.ChatCache) -> None:
    ns["_chat_cache"] = target
    ns["CHAT_CACHE_FLUSH_S"] = 0.02
    task = asyncio.ensure_future(ns["_chat_cache_start"]())
    await asyncio.sleep(0.15)
    target.forget(keys=(KEY,))
    await asyncio.sleep(0.15)
    task.cancel()


restarted = cl.ChatCache(fresh_s=60)
asyncio.run(start_briefly(restarted))
check("after a start the kept copies are taken up, stale, and the torn write is gone",
      restarted.stats["adopted"] == len(kept_files) and restarted.needs_refresh(("o", "", "per-ann", ""))
      and not any(f.endswith(".tmp") for f in os.listdir(folder)) and ns["_chat_cache_said"]["disk"] == "kept",
      (restarted.stats, os.listdir(folder)))
check("…and a copy dropped since is removed from the disk within a beat",
      cl.ChatCache.file_name(("t", "", KEY)) not in os.listdir(folder))
ns["_chat_cache"] = cache

print("THE WIRING, AND NOTHING LOGGED")
check("the exec door answers through the cache, patches it on every write, and moves no clock on a cached answer",
      "_chat_live_run(req[\"ref\"], entry, action, req[\"payload\"], raw, write_id)" in segment("chat_exec")
      and "_chat_cache_wrote(action, ident, entry[\"tenant\"], req[\"payload\"], answer)" in segment("chat_exec")
      and 'if "reason" not in answer and not answer.get("cached"):' in segment("chat_exec"))
check("a narrowed ref's reads go through the cache after its rail's check",
      segment("_chat_live_narrowed_exec").count("_chat_live_run(") == 2
      and "chat_live.run_exec(" not in segment("_chat_live_narrowed_exec"))
check("every /gas and ledger chat answer, and every /gas write that did not answer, reaches the cache",
      "_chat_cache_observed(raw, content)" in segment("_chat_live_observed")
      and "_chat_cache_observed(raw, None)" in segment("_chat_live_unanswered"))
check("a relay start takes up the kept copies, and /health counts the cache",
      "_chat_cache_start()" in segment("_start") and '"cache": _chat_cache_health()' in segment("_chat_live_health"))
health = ns["_chat_cache_health"]()
check("…counts only: no id, no token, no word", not re.search(r"per-|acc-|tok-|msg_|hello", json.dumps(health)),
      health)
glue = "\n".join(segment(n) for n in ("_chat_live_run", "_chat_cache_reread", "_chat_cache_read_again",
                                      "_chat_cache_write", "_chat_cache_wrote", "_chat_cache_blind",
                                      "_chat_cache_observed", "_chat_cache_took", "_chat_cache_dir_state",
                                      "_chat_cache_disk_read", "_chat_cache_disk_write", "_chat_cache_start"))
check("the relay's cache logs nothing", "log." not in glue)
cache_src = LIVE_SOURCE[LIVE_SOURCE.index("class ChatCache"):]
check("the cache itself logs nothing and touches no disk", "log." not in cache_src and "open(" not in cache_src)
check("the cache's section sits inside live chat's, before the push's and Time Off's",
      SOURCE.index("LIVE CHAT (server/chat_live.py)") < SOURCE.index("THE CACHE (chat_live.ChatCache)")
      < SOURCE.index("CHAT PUSH (server/chat_push.py)") < SOURCE.index("TIME OFF (server/time_off.py)"))

shutil.rmtree(tmp, ignore_errors=True)
print(f"\nchat cache: {results['ok']} ok, {len(results['failed'])} failed")
sys.exit(1 if results["failed"] else 0)
