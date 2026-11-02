#!/usr/bin/env python3
"""Live chat's relay half (server/chat_live.py and its doors in snapshot_service.py).

The ticket door refuses no session (401), a visit (400), an acting or unreadable acting session (409) and a
session App Control has not given live chat (403); a ticket lives a minute and opens three times; redeem never
hands out the token; exec carries the six chat actions only, in the ref's own tenant, with a write id no other
account can land on, and never re-sends an append-class write that may still be running. The fold of accounts
onto one person is Chat.gs's own, run side by side in node. Pure: no database, no network."""
import __future__
import ast
import asyncio
import hashlib
import json
import re
import subprocess
import sys
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


IDENT = {"account_id": "acc-2", "person_id": "per-1", "fold_ids": ["per-1", "acc-2"], "name": "Ann Roe",
         "is_master": True}

print("TICKETS AND REFS")
clock = Clock()
reg = cl.Registry(clock=clock)
t1 = reg.mint("tok-ann", "", IDENT)
got = [reg.redeem(t1) for _ in range(4)]
check("a ticket opens three times, and not a fourth", all(got[:3]) and got[3] is None, got)
check("…each time the same ref, the account, the person, the folds and the tenant",
      got[0]["ref"] == got[2]["ref"] and got[0]["account_id"] == "acc-2" and got[0]["person_id"] == "per-1"
      and got[0]["fold_ids"] == ["per-1", "acc-2"] and got[0]["tenant"] == "" and got[0]["is_master"] is True,
      got[0])
check("a redeem never carries the session token", "tok-ann" not in json.dumps(got[0]))
t2 = reg.mint("tok-ann", "", IDENT)
check("a second ticket for the same session and place opens the same ref", reg.redeem(t2)["ref"] == got[0]["ref"])
t3 = reg.mint("tok-ann", "akron", IDENT)
away = reg.redeem(t3)
check("another place is another ref, with its own tenant", away["ref"] != got[0]["ref"] and away["tenant"] == "akron")
t4 = reg.mint("tok-ann", "", IDENT)
clock.t += 61
check("a ticket is dead after sixty seconds", reg.redeem(t4) is None)
check("a malformed or unknown ticket opens nothing", reg.redeem("short") is None and reg.redeem("x" * 40) is None
      and reg.redeem(None) is None)  # type: ignore[arg-type]
check("the ref is found by its value, with the token kept for the relay alone",
      (reg.lookup(got[0]["ref"]) or {}).get("token") == "tok-ann")
t5 = reg.mint("tok-ann", "", IDENT)
gone = reg.revoke_token("tok-ann")
check("a revoked session forgets every ref it held", sorted(gone) == sorted({got[0]["ref"], away["ref"]})
      and reg.lookup(got[0]["ref"]) is None and reg.lookup(away["ref"]) is None, gone)
check("…and a ticket minted before the revocation opens nothing", reg.redeem(t5) is None)
t6 = reg.mint("tok-bob", "", {**IDENT, "account_id": "acc-bob"})
ref6 = reg.redeem(t6)["ref"]
clock.t += cl.REF_IDLE_S + 1
check("a ref idle past its life is forgotten", reg.lookup(ref6) is None)
check("the counts say how many, never whose", set(reg.counts()) == {"refs", "tickets", "sessions"})

flood = cl.Registry(clock=Clock())
bob_ticket = flood.mint("tok-bob", "", {**IDENT, "account_id": "acc-bob"})
ann_tickets = [flood.mint("tok-ann", "", IDENT) for _ in range(cl.TICKETS_PER_REF + 3)]
check("one session minting in a loop keeps only its newest tickets alive",
      [flood.redeem(t) is not None for t in ann_tickets] == [False] * 3 + [True] * cl.TICKETS_PER_REF)
check("…and never displaces anybody else's", flood.redeem(bob_ticket) is not None)
place_clock = Clock()
places = cl.Registry(clock=place_clock)
bob_place = places.redeem(places.mint("tok-bob", "", {**IDENT, "account_id": "acc-bob"}))["ref"]
invented = []
for i in range(cl.REFS_PER_TOKEN + 5):
    place_clock.t += 1
    invented.append(places.mint("tok-ann", f"place-{i}", IDENT))
opened = [places.redeem(t) is not None for t in invented]
check("one session inventing places holds its share of refs, its least recently used giving way (with their tickets)",
      places.counts()["refs"] == cl.REFS_PER_TOKEN + 1 and opened == [False] * 5 + [True] * cl.REFS_PER_TOKEN,
      (places.counts(), opened))
check("…and never displaces anybody else's", places.peek(bob_place) is not None)
again = places.redeem(places.mint("tok-ann", f"place-{cl.REFS_PER_TOKEN + 4}", IDENT))
check("…while a place it already holds keeps its ref", again is not None and places.counts()["refs"] == cl.REFS_PER_TOKEN + 1)
real_max = cl.MAX_TICKETS
cl.MAX_TICKETS = 4
crowd = cl.Registry(clock=Clock())
early = crowd.mint("tok-0", "", IDENT)
many = [crowd.mint(f"tok-{i}", "", IDENT) for i in range(1, 8)]
cl.MAX_TICKETS = real_max
check("past the ceiling the oldest tickets go, not every ticket at once",
      crowd.redeem(early) is None and crowd.redeem(many[-1]) is not None, crowd.counts())
rail_reg = cl.Registry(clock=Clock())
client_seen = rail_reg.redeem(rail_reg.mint("tok-cli", "", {**IDENT, "narrowed": True}))
staff_seen = rail_reg.redeem(rail_reg.mint("tok-stf", "", IDENT))
check("a redeem says whether the ref is narrowed (a client or a guardian), and a staff ref is not",
      client_seen["narrowed"] is True and staff_seen["narrowed"] is False, (client_seen, staff_seen))
check("a narrowed ref names nobody until a marked rail is kept for it",
      rail_reg.listed(client_seen["ref"]) is None)
rail_reg.set_listed(client_seen["ref"], ["per-ada", "per-ann"])
rail_reg.redeem(rail_reg.mint("tok-cli", "", {**IDENT, "narrowed": True}))
check("…a renewed ticket for the same ref keeps what its rail named",
      rail_reg.listed(client_seen["ref"]) == frozenset({"per-ada", "per-ann"}))
rail_reg.set_listed(client_seen["ref"], None)
check("…and a rail that lost its mark names nobody again", rail_reg.listed(client_seen["ref"]) is None)

print("THE HUB ASKS WHICH REFS ARE STILL SESSIONS")
peek_clock = Clock()
held_reg = cl.Registry(clock=peek_clock)
live_ref = held_reg.redeem(held_reg.mint("tok-live", "", IDENT))["ref"]
acting_ref = held_reg.redeem(held_reg.mint("tok-acting", "", IDENT))["ref"]
acting_other = held_reg.redeem(held_reg.mint("tok-acting", "akron", IDENT))["ref"]
out_ref = held_reg.redeem(held_reg.mint("tok-out", "", IDENT))["ref"]
ended_tokens = {"tok-acting", "tok-out"}
verdict = cl.check_refs(held_reg, [live_ref, acting_ref, "u" * 43, live_ref, 7, out_ref, acting_other],
                        lambda token: token in ended_tokens)
check("a ref this process never minted is unknown; an ended session's refs are revoked; the rest stand",
      verdict == {"unknown": ["u" * 43], "revoked": [acting_ref, out_ref, acting_other]}, verdict)
check("…and a revoked session's refs are forgotten here with it",
      held_reg.peek(acting_ref) is None and held_reg.peek(acting_other) is None and held_reg.peek(out_ref) is None
      and held_reg.peek(live_ref) is not None)
peek_clock.t += cl.REF_IDLE_S - 10
cl.check_refs(held_reg, [live_ref], lambda token: False)
peek_clock.t += 20
check("asking is not a use: a ref only listened on idles out, and its tab must re-ticket through the door",
      cl.check_refs(held_reg, [live_ref], lambda token: False) == {"unknown": [live_ref], "revoked": []})
judge_reg = cl.Registry(clock=Clock())
judged = judge_reg.redeem(judge_reg.mint("tok-x", "", IDENT))["ref"]
check("a session that cannot be judged is revoked, never kept open on trust",
      cl.check_refs(judge_reg, [judged], lambda token: 1 / 0)["revoked"] == [judged])
check("a body that is not a list asks about nothing", cl.check_refs(judge_reg, "refs", lambda t: False)
      == {"unknown": [], "revoked": []})

print("ONE PERSON, MANY ACCOUNTS — Chat.gs's own fold, run beside the Python one")
ROWS = [
    {"user_id": "a1", "same_as": "p1"},
    {"user_id": "a2", "merged_into": "a1"},
    {"user_id": "p1"},
    {"user_id": "c1", "same_as": "c2"},
    {"user_id": "c2", "same_as": "c1"},
    {"user_id": "10", "person_id": "2"},
    {"user_id": "2", "same_as": "x9"},
    {"user_id": "z", "same_as": "z"},
    {"User ID": " q1 ", "Same As": "q2"},
    {"user_id": "", "same_as": "p1"},
    {"user_id": "m1", "same_as": "", "merged_into": "", "person_id": "p1"},
    "not a row",
]
UNIVERSE = ["a1", "a2", "p1", "c1", "c2", "10", "2", "x9", "z", "q1", "q2", "m1", "nobody"]


def normalized(rows: list[Any]) -> list[dict[str, str]]:
    out = []
    for r in rows:
        if isinstance(r, dict):
            out.append({re.sub(r"[^a-z0-9]", "", k.lower()): v for k, v in r.items()})
    return out


chat_gs = (ROOT / "apps-script" / "Chat.gs").read_text(encoding="utf-8")
start = chat_gs.index("var CHAT_PEOPLE_INDEX = null;")
end = chat_gs.index("function chatThreadKey_")
js = ("function str_(v){ if (v === null || v === undefined) return ''; return String(v).trim(); }\n"
      "var ROWS = JSON.parse(require('fs').readFileSync(0, 'utf8'));\n"
      "function usersAll_(){ return ROWS.rows; }\n" + chat_gs[start:end] +
      "\nvar idx = chatPeopleIndex_();\nvar out = {index: idx, people: {}, routes: {}};\n"
      "ROWS.universe.forEach(function (u) { var p = chatPersonId_(u); out.people[u] = p;\n"
      "  out.routes[u] = ROWS.universe.filter(function (x) { return chatPersonId_(x) === p; }); });\n"
      "process.stdout.write(JSON.stringify(out));\n")
try:
    ran = subprocess.run(["node", "-e", js], input=json.dumps({"rows": normalized(ROWS), "universe": UNIVERSE}),
                         capture_output=True, text=True, timeout=60)
    ref_js = json.loads(ran.stdout) if ran.returncode == 0 else None
except Exception as exc:  # noqa: BLE001
    ref_js, ran = None, exc
check("Chat.gs's fold ran in node", ref_js is not None, getattr(ran, "stderr", ran))
index = cl.fold_index(ROWS)
if ref_js:
    check("the Python index is Chat.gs's index — the same accounts, the same person, in the same order",
          list(index.items()) == list(ref_js["index"].items()), (index, ref_js["index"]))
    check("every id folds onto the person Chat.gs names", all(cl.person_of(index, u) == ref_js["people"][u]
                                                              for u in UNIVERSE),
          {u: (cl.person_of(index, u), ref_js["people"][u]) for u in UNIVERSE})
    check("a frame for the person reaches every account Chat.gs folds onto it, and no other",
          all(set(cl.fold_ids(index, u)) == set(ref_js["routes"][u]) | {ref_js["people"][u]} for u in UNIVERSE),
          {u: (cl.fold_ids(index, u), ref_js["routes"][u]) for u in UNIVERSE})
check("the folded account lists its person first", cl.fold_ids(index, "a2")[0] == "p1"
      and set(cl.fold_ids(index, "a2")) == {"p1", "a1", "a2", "m1"}, cl.fold_ids(index, "a2"))
check("an account nobody folds is itself alone", cl.fold_ids(index, "nobody") == ["nobody"])
fc = cl.FoldCache(lambda: (_ for _ in ()).throw(RuntimeError("down")))
fc_log = Log()
real_log, cl.log = cl.log, fc_log
check("an unreadable copy folds nobody — never a wrong fold", fc.identity("a2") == ("a2", ["a2"])
      and fc.unreadable == "RuntimeError")
cl.log = real_log
check("…and says why by the error's name alone", fc_log.lines == ["live chat: the account folds could not be read "
                                                                  "(RuntimeError)"], fc_log.lines)
check("…and names nobody", fc.name_of("a2") == "")
named = cl.FoldCache(lambda: [{"user_id": "a1", "same_as": "p1", "Display Name": " Ann Roe "},
                              {"user_id": "p1", "name": "Ann (person)"}, {"user_id": "a2", "same_as": "p1"},
                              {"user_id": "b1"}, "not a row"])
check("a name comes from the account's own users row, else from its person's, else there is none",
      named.name_of("a1") == "Ann Roe" and named.name_of("a2") == "Ann (person)" and named.name_of("b1") == ""
      and named.name_of("nobody") == "" and named.name_of("") == "",
      [named.name_of(u) for u in ("a1", "a2", "b1", "nobody", "")])

print("THE EXEC REQUEST")
REF = "r" * 43
check("a non-chat action is refused", cl.exec_request({"ref": REF, "action": "list"})["reason"] == "action")
check("a member, a person or a target anywhere is refused",
      all(cl.exec_request(b)["reason"] == "member" for b in (
          {"ref": REF, "action": "chatOverview", "member": "u-x"},
          {"ref": REF, "action": "chatOverview", "payload": {"person": "u-x"}},
          {"ref": REF, "action": "chatSend", "client_id": "c" * 12,
           "payload": {"to_user": "p2", "body": "hi", "target": "u-x"}})))
send = cl.exec_request({"ref": REF, "action": "chatSend", "client_id": "c" * 12, "tenant": "elsewhere",
                        "payload": {"to_user": " p2 ", "body": " hi ", "world": "w", "token": "t", "tenant": "t"}})
check("only the fields the action reads travel, trimmed where they are ids and whole where they are words",
      send.get("payload") == {"to_user": "p2", "body": " hi "}, send)
check("a write carries its own client id", cl.exec_request(
    {"ref": REF, "action": "chatSend", "payload": {"to_user": "p2", "body": "hi"}})["reason"] == "client_id")
check("a read's client id is not kept", cl.exec_request(
    {"ref": REF, "action": "chatMessages", "client_id": "c" * 12, "payload": {"with_user": "p2"}})["client_id"] == "")
check("a message over 4000 characters is refused, not cut", cl.exec_request(
    {"ref": REF, "action": "chatSend", "client_id": "c" * 12,
     "payload": {"to_user": "p2", "body": "x" * 4001}})["reason"] == "payload")
check("a person id cannot carry a thread's separator", cl.exec_request(
    {"ref": REF, "action": "chatMarkRead", "client_id": "c" * 12, "payload": {"with_user": "a|b"}})["reason"] == "payload")
check("a required field missing is refused", cl.exec_request(
    {"ref": REF, "action": "chatMessages", "payload": {}})["reason"] == "payload")
check("a malformed ref is unknown", cl.exec_request({"ref": "x", "action": "chatPing"})["reason"] == "ref_unknown")
w1, w2 = cl.write_id_for("acc-2", "client-0001"), cl.write_id_for("acc-2", "client-0001")
check("a retry is the same write", w1 == w2 and re.fullmatch(r"L[0-9a-f]{30}", w1), w1)
check("the same client id from another account is another write", cl.write_id_for("acc-3", "client-0001") != w1)
env = cl.envelope("tok", "akron", "chatSend", {"to_user": "p2", "body": "hi"}, w1)
check("the envelope is the SPA's own shape, with the tenant and never a member or a world",
      env == {"token": "tok", "action": "chatSend", "payload": {"to_user": "p2", "body": "hi"}, "tenant": "akron",
              "write_id": w1})
check("…form-encoded as body=<json>, the one shape the relay's observers read",
      json.loads(urllib.parse.parse_qs(cl.form(env).decode())["body"][0]) == env)

print("ONE EXEC, RETRIED ONLY WHERE NOTHING CAN RUN TWICE")


def fake_sender(script: list[tuple[str, bytes]], clk: Clock, spend: float = 1.0):
    calls: list[bytes] = []

    async def sender(raw: bytes, timeout: float) -> tuple[str, bytes]:
        calls.append(raw)
        clk.t += spend
        return script.pop(0) if script else ("timeout", b"")

    return sender, calls


async def nosleep(_s: float) -> None:
    return None


OK = json.dumps({"status": 200, "data": {"id": "msg_1"}}).encode()


def run(script, action, *, write_id="", unsettled=None, clk=None, spend=1.0):
    clk = clk or Clock()
    sender, calls = fake_sender(list(script), clk, spend)
    uns = unsettled or cl.Unsettled(clock=clk)
    out = asyncio.run(cl.run_exec(sender, b"raw", action, write_id=write_id, unsettled=uns, clock=clk,
                                  sleep=nosleep))
    return out, calls, uns


out, calls, _ = run([("json", OK)], "chatOverview")
check("an answer is the envelope", out["status"] == 200 and len(calls) == 1)
out, calls, _ = run([("timeout", b""), ("json", OK)], "chatMessages")
check("a read that timed out is asked again", out["status"] == 200 and len(calls) == 2)
out, calls, _ = run([("timeout", b""), ("timeout", b""), ("json", OK)], "chatPing")
check("…twice at most, then it says so", out["reason"] == "unreachable" and len(calls) == 2, (out, len(calls)))
out, calls, _ = run([("timeout", b""), ("timeout", b""), ("json", OK)], "chatMarkRead", write_id="Lw")
check("an idempotent write is tried three times", out["status"] == 200 and len(calls) == 3)
out, calls, _ = run([("connect", b""), ("json", OK)], "chatSend", write_id="Lsend")
check("a send that never left the machine is sent again", out["status"] == 200 and len(calls) == 2)
out, calls, _ = run([("echo", b""), ("json", OK)], "chatSend", write_id="Lsend")
check("a send whose receipt was lost to the echo asks for the receipt with the same body",
      out["status"] == 200 and calls == [b"raw", b"raw"])
clk = Clock()
out, calls, uns = run([("timeout", b"")], "chatSend", write_id="Lamb", clk=clk)
check("a send that left and did not answer is not re-sent: it is unconfirmed, with a wait",
      out["reason"] == "unconfirmed" and out["status"] == 504 and len(calls) == 1
      and 140 <= out["retry_after_s"] <= 151, out)
sender, calls2 = fake_sender([("json", OK)], clk)
held = asyncio.run(cl.run_exec(sender, b"raw", "chatSend", write_id="Lamb", unsettled=uns, clock=clk, sleep=nosleep))
check("…a retry inside the wait sends nothing at all", held["reason"] == "unconfirmed" and not calls2, held)
clk.t += cl.SETTLE_S + 1
again = asyncio.run(cl.run_exec(sender, b"raw", "chatSend", write_id="Lamb", unsettled=uns, clock=clk, sleep=nosleep))
check("…and after it, the same write is sent once more (its receipt answers if it landed)",
      again["status"] == 200 and calls2 == [b"raw"] and uns.wait_left("Lamb") == 0 and len(uns) == 0)

# timeout, the wait, timeout again: the second attempt may still be running when the third is asked for
clk = Clock()
out, calls, uns = run([("timeout", b"")], "chatSend", write_id="Ltwice", clk=clk)
clk.t += cl.SETTLE_S + 1
sender_b, calls_b = fake_sender([("timeout", b"")], clk, spend=45.0)
second_try = asyncio.run(cl.run_exec(sender_b, b"raw", "chatSend", write_id="Ltwice", unsettled=uns, clock=clk,
                                     sleep=nosleep))
check("a second attempt that also goes unanswered starts the wait again",
      second_try["reason"] == "unconfirmed" and len(calls_b) == 1
      and cl.SETTLE_S - 1 <= second_try["retry_after_s"] <= cl.SETTLE_S + 1, second_try)
clk.t += 5
sender_c, calls_c = fake_sender([("json", OK)], clk)
third_try = asyncio.run(cl.run_exec(sender_c, b"raw", "chatSend", write_id="Ltwice", unsettled=uns, clock=clk,
                                    sleep=nosleep))
check("…so the third, asked for seconds later, sends nothing and says how long is left",
      third_try["reason"] == "unconfirmed" and not calls_c
      and cl.SETTLE_S - 6 <= third_try["retry_after_s"] <= cl.SETTLE_S - 4, third_try)
clk.t += cl.SETTLE_S
fourth_try = asyncio.run(cl.run_exec(sender_c, b"raw", "chatSend", write_id="Ltwice", unsettled=uns, clock=clk,
                                     sleep=nosleep))
check("…and once the second has settled too, it goes (its receipt answers if either landed)",
      fourth_try["status"] == 200 and calls_c == [b"raw"])


async def twin_sends() -> tuple[dict[str, Any], dict[str, Any], int]:
    gate_open = asyncio.Event()
    count = [0]
    uns = cl.Unsettled()

    async def slow(raw: bytes, timeout: float) -> tuple[str, bytes]:
        count[0] += 1
        await gate_open.wait()
        return "json", OK

    first = asyncio.ensure_future(cl.run_exec(slow, b"raw", "chatSend", write_id="Ltwin", unsettled=uns))
    await asyncio.sleep(0)
    second = await cl.run_exec(slow, b"raw", "chatSend", write_id="Ltwin", unsettled=uns)
    gate_open.set()
    return await first, second, count[0]


first_a, second_a, twin_count = asyncio.run(twin_sends())
check("the same write asked for again while the first is on its way is not sent a second time",
      first_a["status"] == 200 and second_a["reason"] == "unconfirmed" and twin_count == 1, (first_a, second_a))
out, calls, _ = run([("pre", b"")], "chatReact", write_id="Lreact")
check("a reaction behind Google's interstitial is unconfirmed too — a second run undoes it",
      out["reason"] == "unconfirmed" and len(calls) == 1)
out, calls, _ = run([("timeout", b"")] * 5, "chatOverview", spend=30.0)
check("the budget is the whole exec, not each try", len(calls) == 2 and out["reason"] == "unreachable")

print("WHAT THE HUB IS TOLD")


def form(action: str, token: str, payload: dict[str, Any]) -> bytes:
    return urllib.parse.urlencode({"body": json.dumps({"token": token, "action": action,
                                                       "payload": payload})}).encode()


users = {"tok-ann": "acc-2"}
ev = cl.observed_event(form("chatSend", "tok-ann", {"to_user": "p9", "body": "secret words"}),
                       json.dumps({"status": 200, "data": {"thread_key": "p1|p9", "id": "m1"}}).encode(),
                       token_user=lambda t: users.get(t, ""), held=True, source="gas")
check("a send is a nudge: which thread, from whom, to whom, whether the frame is held",
      ev == {"kind": "nudge", "action": "chatSend", "thread_key": "p1|p9", "from": "acc-2", "to": ["p9"],
             "held": True, "source": "gas"}, ev)
check("…never the words", "secret" not in json.dumps(ev))
ev = cl.observed_event(form("chatReact", "tok-ann", {"message_id": "m1", "emoji": "x"}),
                       json.dumps({"status": 200, "data": {"to_user": "p9", "thread_key": ""}}).encode(),
                       token_user=lambda t: users.get(t, ""), held=False, source="ledger")
check("a reaction names the other end the server handed back", ev and ev["to"] == ["p9"])
ev = cl.observed_event(form("chatMarkRead", "tok-ann", {"with_user": "p9"}),
                       json.dumps({"status": 200, "data": {"marked": 2}}).encode(),
                       token_user=lambda t: users.get(t, ""), held=False, source="gas")
check("a read mark tells the reader's own tabs", ev == {"kind": "read", "by": "acc-2", "with_user": "p9",
                                                        "source": "gas"}, ev)
check("a refusal, another action or an unreadable answer tells nothing",
      cl.observed_event(form("chatSend", "tok-ann", {"to_user": "p9", "body": "x"}), b'{"status":409}',
                        token_user=lambda t: "", held=False, source="gas") is None
      and cl.observed_event(form("chatPing", "tok-ann", {}), b'{"status":200}', token_user=lambda t: "",
                            held=False, source="gas") is None
      and cl.observed_event(form("chatSend", "tok-ann", {"to_user": "p9"}), b"<html>", token_user=lambda t: "",
                            held=False, source="gas") is None)
ev = cl.unanswered_event(form("chatSend", "tok-ann", {"to_user": "p9", "body": "secret words"}),
                         token_user=lambda t: users.get(t, ""), source="gas")
check("a send answered without its receipt is a nudge that names no thread: from whom, to whom, held until told",
      ev == {"kind": "nudge", "action": "chatSend", "thread_key": "", "from": "acc-2", "to": ["p9"], "held": True,
             "source": "gas"}, ev)
check("…never the words", "secret" not in json.dumps(ev))
check("…and a reaction, another action, an unreadable body or nobody at either end is none",
      cl.unanswered_event(form("chatReact", "tok-ann", {"message_id": "m1", "emoji": "x"}), token_user=lambda t: "a",
                          source="gas") is None
      and cl.unanswered_event(form("moveStage", "tok-ann", {}), token_user=lambda t: "a", source="gas") is None
      and cl.unanswered_event(b"body=chatSend%7Bnot+json", token_user=lambda t: "a", source="gas") is None
      and cl.unanswered_event(form("chatSend", "tok-x", {"body": "x"}), token_user=lambda t: "", source="gas") is None)
check("the last of those nudges waits the settle: by then the row has landed or never will",
      cl.UNANSWERED_NUDGE_S[-1] == cl.SETTLE_S and list(cl.UNANSWERED_NUDGE_S) == sorted(cl.UNANSWERED_NUDGE_S)
      and all(0 < s <= cl.SETTLE_S for s in cl.RAN_NUDGE_S))

posted: list[tuple[str, dict[str, str], bytes]] = []


async def poster_ok(url: str, headers: dict[str, str], body: bytes, timeout: float) -> int:
    posted.append((url, headers, body))
    return 200


async def poster_down(url: str, headers: dict[str, str], body: bytes, timeout: float) -> int:
    raise ConnectionError("no hub")


feed = cl.Feed("k" * 64, url="http://hub.invalid", poster=poster_ok)
asyncio.run(feed.send({"kind": "hello"}))
check("an event goes to the hub's internal door with the shared key",
      posted and posted[0][0] == "http://hub.invalid/internal/event" and posted[0][1]["X-Hub-Chat-Key"] == "k" * 64
      and json.loads(posted[0][2]) == {"kind": "hello"} and feed.sent == 1)
feed_log = Log()
cl.log = feed_log
down = cl.Feed("k" * 64, url="http://hub.invalid", poster=poster_down)
for _ in range(5):
    asyncio.run(down.send({"kind": "hello"}))
cl.log = real_log
check("a hub that is not there is counted, and said once, not once per event",
      down.failed == 5 and down.last_failed == "ConnectionError" and len(feed_log.lines) == 1, feed_log.lines)
flaky_calls: list[int] = []
waits: list[float] = []


async def poster_flaky(url: str, headers: dict[str, str], body: bytes, timeout: float) -> int:
    flaky_calls.append(1)
    return 503 if len(flaky_calls) < 3 else 200


async def record_wait(s: float) -> None:
    waits.append(s)


flaky = cl.Feed("k" * 64, url="http://hub.invalid", poster=poster_flaky)
took = asyncio.run(flaky.send({"kind": "revoke", "refs": ["r"]}, tries=cl.REVOKE_TRIES, sleep=record_wait))
check("a revocation the hub did not take is tried again, after a growing wait",
      took and len(flaky_calls) == 3 and waits == list(cl.REVOKE_BACKOFF_S[:2]) and flaky.sent == 1
      and flaky.failed == 0, (flaky_calls, waits))
waits.clear()
cl.log = Log()
lost = cl.Feed("k" * 64, url="http://hub.invalid", poster=poster_down)
asyncio.run(lost.send({"kind": "revoke", "refs": ["r"]}, tries=cl.REVOKE_TRIES, sleep=record_wait))
cl.log = real_log
check("…and counted lost once, after its last try", lost.failed == 1 and len(waits) == cl.REVOKE_TRIES - 1)
check("no key, no feed", asyncio.run(cl.Feed("").send({"kind": "hello"})) is False and not cl.Feed("").enabled)
check("the key is HMAC(HUB_SERVICE_SECRET, 'asa-hub-chat'); no secret, no key",
      cl.derive_key("s3cret") == __import__("hmac").new(b"s3cret", b"asa-hub-chat", "sha256").hexdigest()
      and cl.derive_key("") == "")
check("a key is compared in constant time and an empty one opens nothing",
      cl.key_ok("abc", "abc") and not cl.key_ok("abc", "") and not cl.key_ok("", "") and not cl.key_ok("abd", "abc"))

print("THE DOORS, AS THE RELAY DECLARES THEM")


class FakeRequest:
    def __init__(self, body: bytes = b"", query: dict[str, str] | None = None) -> None:
        self._body = body
        self.query_params = query or {}

    async def body(self) -> bytes:
        return self._body


class FakeJSON:
    def __init__(self, content: Any, status_code: int = 200, headers: dict[str, str] | None = None) -> None:
        self.content, self.status_code, self.headers = content, status_code, headers or {}


class Gate:
    held = False

    CHAT_FRAME = "gate_chat_live_frame"

    def holds(self, gate_id: str) -> dict[str, Any]:
        return {"held": self.held and gate_id == self.CHAT_FRAME, "why": "", "unreadable": False}


class FakeFeed:
    enabled = True

    def __init__(self) -> None:
        self.events: list[dict[str, Any]] = []
        self.tries: list[int] = []

    async def send(self, event: dict[str, Any], *, tries: int = 1) -> bool:
        self.events.append(event)
        self.tries.append(tries)
        return True


kept: list[Any] = []
observed: list[tuple[str, bytes, bytes]] = []
sent_raw: list[bytes] = []
answers: list[tuple[str, bytes]] = []
actors: dict[str, tuple[str, str]] = {}
access: dict[str, dict[str, Any]] = {}
authme: dict[str, dict[str, Any]] = {}
gate = Gate()
feed_fake = FakeFeed()
KEY = "k" * 64
FOLD_ROWS = [{"user_id": "acc-2", "same_as": "per-1", "display_name": "Ann From The Copy"}]


async def session_actor(authorization: str):
    return actors.get(authorization[7:])


async def auth_me(token: str) -> dict[str, Any]:
    return authme.get(token, {"status": 401, "message": "Authentication required"})


async def learn_master(_authorization: str) -> str:
    return ""


async def hotline_actor(authorization: str, app_id: str = "", **kw: Any):
    check_calls.append((app_id, kw.get("floor"), tuple(kw.get("refuse_roles") or ())))
    verdict = access.get(authorization[7:])
    return verdict if verdict is not None else {"status": 403, "reason": "badge",
                                                "message": "No badge is written for Live chat in App Access, "
                                                           "so it is the master's alone."}


async def chat_post(raw: bytes, timeout: float) -> tuple[str, bytes]:
    sent_raw.append(raw)
    return answers.pop(0) if answers else ("json", OK)


check_calls: list[tuple[Any, ...]] = []
token_users: dict[str, str] = {}
ns: dict[str, Any] = {
    "json": json, "time": time, "asyncio": asyncio, "Any": Any, "log": Log(),
    "Request": FakeRequest, "Response": FakeJSON, "JSONResponse": FakeJSON,
    "Header": lambda default="", alias=None: default,
    "chat_live": cl, "lane_gate": gate,
    "_chat_refs": cl.Registry(), "_chat_unsettled": cl.Unsettled(), "_chat_fold": cl.FoldCache(lambda: FOLD_ROWS),
    "_chat_feed": feed_fake, "_CHAT_KEY": KEY, "_chat_live_by_action": {},
    "_keep_task": lambda coro: kept.append(asyncio.ensure_future(coro)),
    "_acting": {}, "_auth_master": {},
    "_token_user_get": lambda t: token_users.get(t, ""), "_token_name_get": lambda t: "Ann Roe",
    "_session_actor": session_actor, "_auth_me": auth_me, "_my_work_learn_master": learn_master,
    "_hotline_actor": hotline_actor, "_chat_live_post": chat_post,
    "_note_session_answer": lambda token, env: ns["_acting"].__setitem__(token, (0, "U_BOSS", "U_X"))
    if ((env.get("data") or {}).get("be_another") or {}).get("acting") else None,
    "_auth_cache_put": lambda *a, **k: None, "_token_user_put": lambda *a, **k: None,
    "_relay_observe_chat": lambda raw, content: observed.append(("chat", raw, content)),
    "_relay_observe_chat_read": lambda raw, content: observed.append(("read", raw, content)),
    "load_manifest": lambda: [],
    "_auth_cache": {}, "_auth_unsure": {},
    # the chat push's own hooks (tools/test-chat-push.py runs them)
    "_chat_push_seen": lambda ids: None, "_chat_push_listed": lambda refs, verdict: None,
    "_chat_push_observed": lambda raw, content, ident=None: None,
    # the cache has its own suite (tools/test-chat-cache.py); here every read goes to Apps Script
    "_chat_cache": None,
}
load(ns, "_chat_cache_busy", "_chat_cache_hold", "_chat_live_run", "_chat_cache_wrote", "_chat_cache_observed")
load(ns, "_hotline_token", "_my_work_acting", "_DAILY_REASONS", "_daily_refusal", "_MY_INBOX_ROLES_REFUSED",
     "_CHAT_LIVE_DOWN", "_CHAT_LIVE_ACTING", "_CHAT_LIVE_VISIT", "_CHAT_LIVE_ROLES_REFUSED", "_chat_live_answer", "_chat_live_emit",
     "_CHAT_LIVE_UNNARROWED", "_CHAT_LIVE_NOT_LISTED", "_chat_live_rail_kept", "_chat_live_narrowed_exec",
     "_chat_live_revoke", "_chat_live_ended", "_chat_live_observed", "_chat_live_unanswered",
     "_chat_live_whoami", "_chat_live_body", "chat_ticket", "chat_ticket_redeem", "chat_exec", "chat_refs",
     "chat_gate", "_NON_SLICE_DOORS", "_is_slice_uri", "_role_may_read")
# written behind has its own suite (tools/test-chat-behind.py); here nothing is kept first, as before a proof
ns["_chat_behind"] = cl.Behind()
load(ns, "_chat_frame_held", "_CHAT_BEHIND_READS", "_chat_behind_where", "_chat_behind_keep", "_chat_behind_learn",
     "_chat_behind_answer", "_chat_behind_overlaid", "_chat_cache_place", "_chat_cache_ids")


def ticket(auth: str = "", *, body: bytes = b"", query: dict[str, str] | None = None, member: str = "",
           tenant: str = "") -> FakeJSON:
    return asyncio.run(ns["chat_ticket"](FakeRequest(body, query), member=member, authorization=auth,
                                         x_hub_tenant=tenant))


def redeem(tk: str, key: str = KEY) -> FakeJSON:
    return asyncio.run(ns["chat_ticket_redeem"](FakeRequest(json.dumps({"ticket": tk}).encode()),
                                                x_hub_chat_key=key))


def execute(body: dict[str, Any], key: str = KEY) -> FakeJSON:
    async def go():
        kept.clear()
        got = await ns["chat_exec"](FakeRequest(json.dumps(body).encode()), x_hub_chat_key=key)
        await asyncio.gather(*kept)
        return got

    return asyncio.run(go())


actors["tok-ann"] = ("admin", "acc-2")
token_users["tok-ann"] = "acc-2"
access["tok-ann"] = ("admin", "acc-2")
r = ticket("")
check("the ticket door: no session, 401", r.status_code == 401 and r.content["reason"] == "session")
r = ticket("Bearer tok-ann", member="u-visit")
check("…a visit, 400", r.status_code == 400 and r.content["reason"] == "member")
check("…a person or a target, in the body or the address, 400",
      ticket("Bearer tok-ann", body=b'{"person": "u-x"}').status_code == 400
      and ticket("Bearer tok-ann", query={"target": "u-x"}).status_code == 400
      and ticket("Bearer tok-ann", body=b'{"member": "u-x"}').status_code == 400)
check("…a body that is not an object, 400", ticket("Bearer tok-ann", body=b"[1]").status_code == 400)
ns["_acting"]["tok-act"] = (time.time() + 600, "U_BOSS", "U_CORA")
actors["tok-act"], access["tok-act"] = ("client", "U_CORA"), ("client", "U_CORA")
r = ticket("Bearer tok-act")
check("…acting as someone else, 409", r.status_code == 409 and r.content["reason"] == "acting"
      and r.content["code"] == "be_another_refused")


class Unreadable:
    def known(self, token: str) -> bool:
        raise RuntimeError("registry down")


real_acting = ns["_acting"]
ns["_acting"] = Unreadable()
r = ticket("Bearer tok-ann")
check("…an acting state that cannot be read, 409 (read as acting)", r.status_code == 409)
ns["_acting"] = real_acting
authme["tok-child"] = {"status": 200, "data": {"user": {"id": "U_CORA", "role": "client"},
                                               "be_another": {"acting": {"id": "U_CORA"}}}}
r = ticket("Bearer tok-child")
check("…a session this process never saw, learned as acting by its own sign-in check, 409",
      r.status_code == 409, r.content)
check("…a session the sign-in check refuses, 401", ticket("Bearer tok-ghost").status_code == 401)
actors["tok-staff"], token_users["tok-staff"] = ("staff", "acc-9"), "acc-9"
r = ticket("Bearer tok-staff")
check("…App Control has not given it live chat, 403 with the gate's own sentence",
      r.status_code == 403 and r.content["reason"] == "badge" and "master's alone" in r.content["message"], r.content)
check("…asked for the live chat's own id, with no admin floor, refusing only onboarding and interviewer: a client "
      "and a guardian are the App Control row's to let in",
      check_calls and check_calls[-1] == (cl.APP_ID, False, ("onboarding", "interviewer")), check_calls[-1:])
check("…a place that cannot be read, 400", ticket("Bearer tok-ann", tenant="a b").status_code == 400)
r = ticket("Bearer tok-ann", tenant="akron")
check("…and the session that may: a ticket for a minute", r.status_code == 200 and r.content["data"]["expires_in"] == 60
      and cl.TICKET_RE.fullmatch(r.content["data"]["ticket"]), r.content)
check("…never the token", "tok-ann" not in json.dumps(r.content))
tk = r.content["data"]["ticket"]
check("redeem: a wrong key or none, 401", redeem(tk, key="x" * 64).status_code == 401 and redeem(tk, key="").status_code == 401)
got_r = redeem(tk)
data = got_r.content.get("data") or {}
check("redeem: the ref, the account, the person it folds onto, the folds, the tab's tenant",
      got_r.status_code == 200 and data["account_id"] == "acc-2" and data["person_id"] == "per-1"
      and data["fold_ids"] == ["per-1", "acc-2"] and data["tenant"] == "akron" and data["is_master"] is False,
      got_r.content)
check("redeem: never the token", "tok-ann" not in json.dumps(got_r.content))
check("redeem: the name the session's own sign-in gave", data.get("name") == "Ann Roe", data)
actors["tok-noname"], token_users["tok-noname"], access["tok-noname"] = ("admin", "acc-2"), "acc-2", ("admin", "acc-2")
real_name_get = ns["_token_name_get"]
ns["_token_name_get"] = lambda t: ""
nameless = redeem(ticket("Bearer tok-noname").content["data"]["ticket"]).content.get("data") or {}
ns["_token_name_get"] = real_name_get
check("…and a session vouched with no name (the mirror, after a restart) takes the users copy's, never none",
      nameless.get("name") == "Ann From The Copy", nameless)
check("redeem: a wrong key spends no use of the ticket", redeem(tk).status_code == 200 and redeem(tk).status_code == 200)
check("redeem: the fourth use of a three-use ticket, 401", redeem(tk).status_code == 401)
check("redeem: an unknown ticket, 401", redeem("t" * 43).content["reason"] == "ticket")
saved_key = ns["_CHAT_KEY"]
ns["_CHAT_KEY"] = ""
check("with no key configured every internal door is shut", redeem(tk).status_code == 401
      and execute({"ref": data["ref"], "action": "chatPing"}).status_code == 401)
ns["_CHAT_KEY"] = saved_key

ref = data["ref"]
check("exec: a wrong key, 401", execute({"ref": ref, "action": "chatPing"}, key="").status_code == 401)
r = execute({"ref": "u" * 43, "action": "chatPing"})
check("exec: an unknown ref is said as such, for the hub to re-ticket", r.content["reason"] == "ref_unknown"
      and r.content["status"] == 401)
check("exec: a non-chat action is refused before anything leaves",
      execute({"ref": ref, "action": "usersList"}).content["reason"] == "action" and not sent_raw)
gate.held = True
r = execute({"ref": ref, "action": "chatSend", "client_id": "client-0001", "tenant": "elsewhere",
             "payload": {"to_user": "p9", "body": "hello there"}})
sent = json.loads(urllib.parse.parse_qs(sent_raw[-1].decode())["body"][0])
check("exec: the send goes out as the ref's session, in the ref's tenant, with the account's write id",
      sent == {"token": "tok-ann", "action": "chatSend", "payload": {"to_user": "p9", "body": "hello there"},
               "tenant": "akron", "write_id": cl.write_id_for("acc-2", "client-0001")}, sent)
check("exec: the answer is the envelope and the frame gate, and never the token",
      r.content["status"] == 200 and r.content["frame_held"] is True and "tok-ann" not in json.dumps(r.content),
      r.content)
check("exec: the SSE tabs on the old chat still hear of it", observed and observed[-2][0] == "chat"
      and observed[-2][1] == sent_raw[-1])
gate.held = False
check("exec: the frame gate open, frame_held is false",
      execute({"ref": ref, "action": "chatOverview"}).content["frame_held"] is False)


def gate_door(key: str = KEY) -> FakeJSON:
    return asyncio.run(ns["chat_gate"](x_hub_chat_key=key))


sent_before = len(sent_raw)
check("gate: a wrong key or none, 401 and no word of the gate",
      all(gate_door(k).status_code == 401 and "frame_held" not in gate_door(k).content for k in ("", "x" * 64)))
check("gate: open, frame_held is false", gate_door().content == {"status": 200, "frame_held": False})
gate.held = True
check("gate: the switch on, frame_held is true, asked at that moment",
      gate_door().content == {"status": 200, "frame_held": True})
gate.held = False


class BrokenGate(Gate):
    def holds(self, gate_id: str) -> dict[str, Any]:
        raise RuntimeError("lane unreadable")


ns["lane_gate"] = BrokenGate()
check("gate: a gate that cannot answer holds", gate_door().content["frame_held"] is True)
ns["lane_gate"] = gate
check("gate: nothing is sent to Apps Script", len(sent_raw) == sent_before)
answers.append(("json", json.dumps({"status": 401, "message": "Authentication required."}).encode()))
feed_fake.events.clear()
r = execute({"ref": ref, "action": "chatOverview"})
check("exec: Apps Script refusing the session revokes it here and on the hub",
      r.content["reason"] == "revoked" and ns["_chat_refs"].lookup(ref) is None
      and feed_fake.events and feed_fake.events[-1] == {"kind": "revoke", "refs": [ref]}, (r.content, feed_fake.events))
check("…and that revocation is tried again if the hub does not take it", feed_fake.tries[-1] == cl.REVOKE_TRIES)
tk2 = ticket("Bearer tok-ann").content["data"]["ticket"]
ref2 = redeem(tk2).content["data"]["ref"]
ns["_acting"]["tok-ann"] = (time.time() + 600, "U_BOSS", "U_X")
r = execute({"ref": ref2, "action": "chatPing"})
check("exec: a session that is acting now is refused and its refs closed", r.content["reason"] == "acting"
      and ns["_chat_refs"].lookup(ref2) is None)
ns["_acting"].pop("tok-ann")


def refs_door(refs: Any, key: str = KEY) -> FakeJSON:
    return asyncio.run(ns["chat_refs"](FakeRequest(json.dumps({"refs": refs}).encode()), x_hub_chat_key=key))


ref_ok = redeem(ticket("Bearer tok-ann").content["data"]["ticket"]).content["data"]["ref"]
actors["tok-gone"], token_users["tok-gone"], access["tok-gone"] = ("admin", "acc-2"), "acc-2", ("admin", "acc-2")
ref_gone = redeem(ticket("Bearer tok-gone").content["data"]["ticket"]).content["data"]["ref"]
actors["tok-now-acting"], access["tok-now-acting"] = ("admin", "acc-2"), ("admin", "acc-2")
token_users["tok-now-acting"] = "acc-2"
ref_acting = redeem(ticket("Bearer tok-now-acting").content["data"]["ticket"]).content["data"]["ref"]
actors["tok-unsure"], token_users["tok-unsure"], access["tok-unsure"] = ("admin", "acc-2"), "acc-2", ("admin", "acc-2")
ref_unsure = redeem(ticket("Bearer tok-unsure").content["data"]["ticket"]).content["data"]["ref"]
ns["_auth_cache"]["tok-gone"] = (time.time(), False, "", "")
# a refusal written over an older placeholder is a verdict: the marker names a stamp that is no longer the entry
ns["_auth_unsure"]["tok-gone"] = time.time() - 280.0
# the sign-in check could not be made: _validate's brief refusal, still the entry
unsure_at = time.time() - 280.0
ns["_auth_cache"]["tok-unsure"] = (unsure_at, False, "", "")
ns["_auth_unsure"]["tok-unsure"] = unsure_at
ns["_acting"]["tok-now-acting"] = (time.time() + 600, "U_BOSS", "U_X")
check("refs: a wrong key, 401", refs_door([ref_ok], key="").status_code == 401)
r = refs_door([ref_ok, ref_gone, ref_acting, ref_unsure, "v" * 43])
check("refs: the hub hears which refs to close (signed out here, acting now) and which must re-ticket",
      r.status_code == 200 and r.content["data"] == {"unknown": ["v" * 43], "revoked": [ref_gone, ref_acting]},
      r.content)
check("refs: …the closed ones are forgotten here, the live one stands, and no token is in the answer",
      ns["_chat_refs"].peek(ref_gone) is None and ns["_chat_refs"].peek(ref_acting) is None
      and ns["_chat_refs"].peek(ref_ok) is not None and "tok-" not in json.dumps(r.content))
check("refs: a session whose sign-in check Apps Script could not answer is not closed on that",
      ns["_chat_refs"].peek(ref_unsure) is not None and ref_unsure not in r.content["data"]["revoked"])
ns["_acting"].pop("tok-now-acting")
ns["_auth_cache"].clear()
ns["_auth_unsure"].clear()

print("A CLIENT OR A GUARDIAN IS LET IN BY THE ROW, AND NARROWED")
check("the narrowed roles are a client and a guardian, never staff",
      cl.narrowed("client") and cl.narrowed("", "Guardian") and not cl.narrowed("staff", "admin", ""))
RAIL = {"me": "per-cli", "unread": 1, "circle": {"why": ""},
        "people": [{"user_id": "per-ada", "online": True, "seen_at": "t1"}, {"user_id": "per-ann", "online": False},
                   "not a person"],
        "threads": [{"with_user": "per-ann", "online": True, "unread": 0},
                    {"with_user": "per-out", "online": True, "seen_at": "t2", "unread": 1}, {"with_user": ""}]}
kept_rail, named = cl.narrow_overview(RAIL)
check("a marked rail keeps its people, and presence only for them: one who only wrote first is never online",
      [p["user_id"] for p in kept_rail["people"]] == ["per-ada", "per-ann"]
      and kept_rail["threads"] == [{"with_user": "per-ann", "online": True, "unread": 0},
                                   {"with_user": "per-out", "online": False, "unread": 1}], kept_rail)
check("…and names exactly the people and the conversations it shows", named == {"per-ada", "per-ann", "per-out"})
check("a rail without Chat.gs's mark is no rail for a narrowed caller",
      cl.narrow_overview({k: v for k, v in RAIL.items() if k != "circle"}) is None
      and cl.narrow_overview({**RAIL, "circle": True}) is None and cl.narrow_overview(None) is None)
check("the person an action is about is the one it writes to or reads with, and a ping names nobody",
      cl.person_in("chatSend", {"to_user": " per-x "}) == "per-x" and cl.person_in("chatMessages", {"with_user": "per-y"})
      == "per-y" and cl.person_in("chatPing", {}) == "" and cl.person_in("chatReact", {"message_id": "m1"}) == "")


def sent_actions(since: int) -> list[str]:
    return [json.loads(urllib.parse.parse_qs(raw.decode())["body"][0])["action"] for raw in sent_raw[since:]]


def rail_answer(data: dict[str, Any]) -> tuple[str, bytes]:
    return "json", json.dumps({"status": 200, "data": data}).encode()


actors["tok-cli"], token_users["tok-cli"] = ("client", "U_CLI"), "U_CLI"
r = ticket("Bearer tok-cli")
check("a client App Control has not given live chat: 403 from the row, not from a list in the code",
      r.status_code == 403 and r.content["reason"] == "badge", r.content)
access["tok-cli"] = ("client", "U_CLI")
cli_ref = redeem(ticket("Bearer tok-cli").content["data"]["ticket"]).content["data"]
check("a client the row names gets a ticket, and its ref is narrowed", cli_ref.get("narrowed") is True, cli_ref)
cli_ref = cli_ref["ref"]
actors["tok-grd"], token_users["tok-grd"], access["tok-grd"] = ("guardian", "U_GRD"), "U_GRD", ("guardian", "U_GRD")
grd_ref = redeem(ticket("Bearer tok-grd").content["data"]["ticket"]).content["data"]
check("…and so does a guardian", grd_ref.get("narrowed") is True, grd_ref)
grd_ref = grd_ref["ref"]
staff_ref_data = redeem(ticket("Bearer tok-ann").content["data"]["ticket"]).content["data"]
check("…while a staff session's is not", staff_ref_data.get("narrowed") is False, staff_ref_data)

UNMARKED = {"me": "per-cli", "threads": [], "people": [{"user_id": "per-everyone", "online": True}], "unread": 0}
mark = len(sent_raw)
answers.append(rail_answer(UNMARKED))
r = execute({"ref": cli_ref, "action": "chatOverview"})
check("a narrowed ref: a rail Chat.gs did not mark (an Apps Script not yet published) is refused, whole",
      r.content["status"] == 503 and r.content["reason"] == "narrowing" and "per-everyone" not in json.dumps(r.content),
      r.content)
answers.append(rail_answer(UNMARKED))
r = execute({"ref": cli_ref, "action": "chatSend", "client_id": "client-0901",
             "payload": {"to_user": "per-everyone", "body": "hi"}})
check("…and before its first marked rail no action leaves: the rail is read first, and the send never goes",
      r.content["reason"] == "narrowing" and sent_actions(mark) == ["chatOverview", "chatOverview"], sent_actions(mark))
mark = len(sent_raw)
answers.append(rail_answer(RAIL))
r = execute({"ref": cli_ref, "action": "chatOverview"})
check("a marked rail is carried, presence cut to the people it lists",
      r.content["status"] == 200 and r.content["data"]["threads"][1] == {"with_user": "per-out", "online": False,
                                                                         "unread": 1}, r.content)
r = execute({"ref": cli_ref, "action": "chatSend", "client_id": "client-0902",
             "payload": {"to_user": "per-oth", "body": "to another client"}})
r2 = execute({"ref": cli_ref, "action": "chatMessages", "payload": {"with_user": "per-far"}})
check("a narrowed ref writes to and reads with nobody its rail did not name — refused here, nothing leaves",
      r.content["status"] == 404 and r.content["reason"] == "circle" and r2.content["reason"] == "circle"
      and sent_actions(mark) == ["chatOverview"], (r.content, r2.content, sent_actions(mark)))
r = execute({"ref": cli_ref, "action": "chatSend", "client_id": "client-0903",
             "payload": {"to_user": "per-out", "body": "an answer"}})
r2 = execute({"ref": cli_ref, "action": "chatMarkRead", "client_id": "client-0904", "payload": {"with_user": "per-ada"}})
r3 = execute({"ref": cli_ref, "action": "chatPing"})
check("…and to whoever it did: a reply to one who wrote first, a read mark, the ping",
      [x.content["status"] for x in (r, r2, r3)] == [200, 200, 200]
      and sent_actions(mark) == ["chatOverview", "chatSend", "chatMarkRead", "chatPing"], sent_actions(mark))
mark = len(sent_raw)
answers.append(rail_answer({**RAIL, "me": "per-grd"}))
r = execute({"ref": grd_ref, "action": "chatMessages", "payload": {"with_user": "per-ann"}})
check("a guardian's first action reads its rail first, then goes to a person it names",
      r.content["status"] == 200 and sent_actions(mark) == ["chatOverview", "chatMessages"], sent_actions(mark))
answers.append(rail_answer(UNMARKED))
r = execute({"ref": staff_ref_data["ref"], "action": "chatOverview"})
check("a staff ref's rail is carried as Apps Script drew it, mark or none",
      r.content["status"] == 200 and r.content["data"]["people"] == UNMARKED["people"], r.content)
answers.append(("json", json.dumps({"status": 401, "message": "Authentication required."}).encode()))
fresh_cli = cl.Registry()
ns["_chat_refs"], real_refs = fresh_cli, ns["_chat_refs"]
lone = redeem(ticket("Bearer tok-cli").content["data"]["ticket"]).content["data"]["ref"]
r = execute({"ref": lone, "action": "chatPing"})
check("a session Apps Script refuses while its rail is read first is revoked, as any refused session is",
      r.content["reason"] == "revoked" and fresh_cli.lookup(lone) is None, r.content)
ns["_chat_refs"] = real_refs

print("A SIGN-IN CHECK THAT COULD NOT BE MADE ENDS NO SESSION")


async def authme_down(token: str) -> dict[str, Any]:
    raise ConnectionError("the sign-in is busy")


async def authme_refused(token: str) -> dict[str, Any]:
    return {"status": 401, "message": "Authentication required"}


async def authme_good(token: str) -> dict[str, Any]:
    return {"status": 200, "data": {"user": {"id": "acc-2", "role": "admin"}}}


v_ns: dict[str, Any] = {
    "time": time, "asyncio": asyncio, "hashlib": hashlib, "log": Log(), "AUTH_TTL_SECONDS": 300.0,
    "_auth_cache": {}, "_auth_master": {}, "_auth_unsure": {}, "_acting": {}, "_auth_pending": set(),
    "_auth_tasks": {}, "_note_session_answer": lambda token, env: None, "_vouch_put": lambda *a: None,
    "_auth_me": authme_down,
}
load(v_ns, "_auth_cache_put", "_validate", "_my_work_acting", "_chat_live_ended")
asyncio.run(v_ns["_validate"]("tok-busy"))
busy = v_ns["_auth_cache"].get("tok-busy")
check("a sign-in check the sign-in could not answer leaves its brief refusal, marked as no verdict",
      busy is not None and busy[1] is False and v_ns["_auth_unsure"].get("tok-busy") == busy[0], (busy, v_ns["_auth_unsure"]))
check("…and the ref check does not read it as signed out", v_ns["_chat_live_ended"]("tok-busy") is False)
v_ns["_auth_me"] = authme_refused
asyncio.run(v_ns["_validate"]("tok-busy"))
check("a real refusal after it ends the session", v_ns["_chat_live_ended"]("tok-busy") is True)
v_ns["_auth_me"] = authme_good
asyncio.run(v_ns["_validate"]("tok-fine"))
check("a session checked good, or never checked, is not ended",
      v_ns["_chat_live_ended"]("tok-fine") is False and v_ns["_chat_live_ended"]("tok-never") is False)

print("ONE ASK OF PYTHON: THE WAIT FOR A SLOT COMES OUT OF ITS TIME")


class FakeAsk:
    posted: list[float] = []

    @staticmethod
    async def ask(env: dict[str, Any], payload: dict[str, Any], timeout: float) -> tuple[dict[str, Any], str]:
        FakeAsk.posted.append(timeout)
        return json.loads(OK), ""


post_ns: dict[str, Any] = {"asyncio": asyncio, "time": time, "json": json, "chat_live": cl,
                           "_relay_envelope": lambda raw: {}, "_chat_python_ask": FakeAsk.ask}
load(post_ns, "_chat_live_post")


async def post_after_wait(hold_s: float, timeout: float) -> tuple[tuple[str, bytes], int]:
    post_ns["_chat_live_slots"] = slots = asyncio.Semaphore(1)
    await slots.acquire()
    asyncio.get_running_loop().call_later(hold_s, slots.release)
    got_post = await post_ns["_chat_live_post"](b"raw", timeout)
    return got_post, slots._value  # noqa: SLF001 - every slot handed back


FakeAsk.posted.clear()
got_post, free_slots = asyncio.run(post_after_wait(0.4, 3.0))
check("an ask that waited for its slot is given only what is left of its time",
      got_post[0] == "json" and len(FakeAsk.posted) == 1 and 2.4 <= FakeAsk.posted[0] <= 2.65 and free_slots == 1,
      (got_post, FakeAsk.posted))
FakeAsk.posted.clear()
got_post, free_slots = asyncio.run(post_after_wait(0.6, 2.4))
check("…and one whose wait left too little is not sent at all (it never left), its slot handed back",
      got_post == ("connect", b"") and not FakeAsk.posted and free_slots == 1, (got_post, FakeAsk.posted))

print("THE SYNC PATH TELLS THE HUB")
feed_fake.events.clear()
observed.clear()
token_users["tok-legacy"] = "acc-7"
gas = segment("gas_relay")
check("the /gas answer tells the hub right after the SSE frame",
      -1 < gas.find("_relay_observe_chat(raw, res.content)") < gas.find('_chat_live_observed(raw, res.content, "gas")'))
python_gas = segment("_chat_python_gas")
check("a /gas chat write Python left without its answer tells the hub first, after the settle after silence",
      -1 < python_gas.find("_chat_live_unanswered(raw, chat_live.UNANSWERED_NUDGE_S")
      < python_gas.find('"data": {"accepted": True, "confirmed": False}'))
check("…and one Python answered tells the hub as any /gas answer does",
      '_chat_live_observed(raw, content, "gas")' in python_gas)


async def unanswered() -> None:
    kept.clear()
    later = ns["_chat_live_unanswered"]
    later(form("chatSend", "tok-legacy", {"to_user": "per-1", "body": "from the old chat"}), (0.0, 0.02))
    later(form("chatReact", "tok-legacy", {"message_id": "m1", "emoji": "x"}), (0.0,))
    later(form("moveStage", "tok-legacy", {}), (0.0,))
    later(form("chatSend", "tok-legacy", {"to_user": "per-1", "body": "no delays"}), ())
    await asyncio.gather(*kept)


feed_fake.events.clear()
gate.held = False
asyncio.run(unanswered())
nudge = {"kind": "nudge", "action": "chatSend", "thread_key": "", "from": "acc-7", "to": ["per-1"], "held": False,
         "source": "gas"}
check("a send /gas answered without its receipt nudges both ends after each delay, and nothing else does",
      feed_fake.events == [nudge, nudge], feed_fake.events)
feed_fake.events.clear()
gate.held = True
asyncio.run(unanswered())
check("…with the frame gate as it stands when the nudge leaves", feed_fake.events == [{**nudge, "held": True}] * 2,
      feed_fake.events)
gate.held = False
feed_fake.events.clear()
check("a sign-out and a Be Back close the session's live connections",
      "_chat_live_revoke(token)" in segment("_relay_observe_auth") and "_chat_live_revoke(token)" in segment(
          "_be_another_revoke"))
check("a relay start says hello, and /health counts", "_chat_live_hello()" in segment("_start")
      and '"chat_live": _chat_live_health()' in segment("health"))
check("the exec door and the observer both ask the frame gate",
      "lane_gate.holds(lane_gate.CHAT_FRAME)" in segment("chat_exec")
      and "lane_gate.holds(lane_gate.CHAT_FRAME)" in segment("_chat_live_observed"))

print("THE GATE LETS A SIGNED-IN PERSON KNOCK")
check("/snapshot/chat-ticket is a named door for every role", all(ns["_role_may_read"](role, "/snapshot/chat-ticket")
                                                                  for role in ("staff", "admin", "client", "")))
check("…and is not counted as a slice read", "/snapshot/chat-ticket" in ns["_NON_SLICE_DOORS"]
      and not ns["_is_slice_uri"]("/snapshot/chat-ticket"))
check("the internal doors are not behind the gate", not ns["_role_may_read"]("admin", "/chat/exec")
      and not ns["_role_may_read"]("admin", "/chat/ticket/redeem") and not ns["_role_may_read"]("admin", "/chat/refs")
      and not ns["_role_may_read"]("admin", "/chat/gate"))

print("NOTHING WHOSE IS LOGGED")
log_calls = re.findall(r"log\.(?:warning|info|debug|error)\((.*?)\)\n", LIVE_SOURCE, flags=re.S)
check("chat_live.py logs two sentences, by an error's name alone",
      len(log_calls) == 2 and all("type(exc).__name__" in c or c.rstrip().endswith("why") for c in log_calls),
      log_calls)
start = SOURCE.index("LIVE CHAT (server/chat_live.py)")
body_at = SOURCE.index("_CHAT_KEY = ", start)
following = re.search(r"^# -{20,}", SOURCE[body_at:], flags=re.M)
section = SOURCE[start: body_at + following.start()] if following else SOURCE[start:]
check("the relay's live chat section is found whole", "async def chat_exec(" in section and "TIME OFF" not in section)
check("the relay's live chat section logs nothing", not re.search(r"\blog\.(warning|info|debug|error)\(", section))
check("…and sits before Time Off, whose suite runs every statement after its own section with a few stubs",
      start < SOURCE.index("TIME OFF (server/time_off.py)"))
check("chat_live.py imports no web framework and no database driver at the top",
      not re.search(r"^(import|from) (fastapi|psycopg2|httpx)", LIVE_SOURCE, flags=re.M))

print(f"\nchat live relay: {results['ok']} ok, {len(results['failed'])} failed")
sys.exit(1 if results["failed"] else 0)
