#!/usr/bin/env python3
"""The relay's gates (server/lane_gate.py), the digest worker's copy of them, and the drain's held time.

WHAT IT PROVES.
  answers   a gate is armed, not armed, or UNREADABLE — three answers, never folded: a lane never read,
            a lane that throws, a lane built longer ago than the switch's freshness (or never stamped),
            and a lane where Apps Script said it could not read the situations tab are unreadable; a
            backend that carries no gates at all arms nothing
  person    an unreadable lane HOLDS a door that hands a person something for ever (the mailbox) while
            the send switch holds, and keeps a door that writes the Hub's own books acting
  switch    an armed gate holds while the switch holds — readable or not — and never with it off
  envelope  a held door answers 409 with the reason, so a feed falls behind and never loses a row
  worker    the digest worker is a process of its own: the relay publishes the lane to a file, the
            worker reads its gates AND its switch from that file, and a missing or stale file is
            unreadable — proved by running the worker's own pass against a published lane
  drain     the time the drain gate held the line is credited to every waiting write, so a hold longer
            than a day never buries the queue on release
  wiring    every relay door the catalogue names asks its gate

WHERE IT RUNS. Here, on the host: lane_gate, effective_roster and web_gate are the standard library
only; form_digest's database driver is stood in for; the drain's three functions are lifted out of
snapshot_service.py by name and run over a temporary folder. Nothing is written outside a temporary
folder, and nothing reaches Google, Postgres or a mailbox.

    python3 tools/test-lane-gate.py
"""
import ast
import json
import logging
import os
import shutil
import sys
import tempfile
import time
import types
from pathlib import Path

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve()
ROOT = HERE.parent.parent
SERVER = ROOT / "server"

results = {"ok": 0, "failed": []}


def check(name: str, ok: bool, detail=None) -> None:
    if ok:
        results["ok"] += 1
        print(f"  ok   {name}")
    else:
        results["failed"].append(name)
        print(f"  FAIL {name}")
        if detail is not None:
            print(f"       {detail}")


if "psycopg2" not in sys.modules:  # the host has no driver, and nothing here may reach a database
    fake = types.ModuleType("psycopg2")
    fake.connect = lambda *a, **k: (_ for _ in ()).throw(RuntimeError("no database in this test"))
    fake.Error = Exception
    extras = types.ModuleType("psycopg2.extras")
    extras.RealDictCursor = object
    extras.execute_values = lambda *a, **k: None
    fake.extras = extras
    sys.modules["psycopg2"] = fake
    sys.modules["psycopg2.extras"] = extras

TMP = Path(tempfile.mkdtemp(prefix="lane-gate-test-"))
os.environ["HUB_LANE_GATE_FILE"] = str(TMP / "lane-gates.json")
os.environ.setdefault("HUB_SNAPSHOT_OUT", str(TMP))
sys.path.insert(0, str(SERVER))
import effective_roster  # noqa: E402
import lane_gate  # noqa: E402
import web_gate  # noqa: E402

logging.disable(logging.CRITICAL)

ON = {"on": True, "readable": True, "word": "on", "why": ""}
OFF = {"on": False, "readable": True, "word": "off", "why": ""}


def with_switch(sw):
    effective_roster.use_switch(lambda: dict(sw))


def with_lane(lane, stamp=True):
    """A lane the relay read just now — stamped with a fresh built_at unless the check says otherwise."""
    if stamp and isinstance(lane, dict) and "built_at" not in lane:
        lane = dict(lane, built_at=web_gate.datetime.now(web_gate.UTC).isoformat())
    lane_gate.use_lane(lambda: lane)


def boom():
    raise RuntimeError("the lane did not answer")


print("answers")
lane_gate.use_lane(None)
with_switch(ON)
st = lane_gate.state(lane_gate.DIGEST)
check("no lane handed to the process is UNREADABLE, not 'not armed'",
      st["armed"] is False and "no configuration lane" in st["unreadable"], st)
lane_gate.use_lane(boom)
st = lane_gate.state(lane_gate.DIGEST)
check("a lane that throws is unreadable, and says why", "could not be read" in st["unreadable"], st)
with_lane(None)
check("a lane the relay has not read yet is unreadable",
      "has not read" in lane_gate.state(lane_gate.DIGEST)["unreadable"])
with_lane({"smart_gates_unreadable": "the tab did not answer"})
st = lane_gate.state(lane_gate.MAIL_PROVISION)
check("Apps Script saying it could not read the situations tab is unreadable",
      "could not read the situations tab" in st["unreadable"] and st["armed"] is False, st)
with_lane({"test_mode": {"on": True}})
st = lane_gate.state(lane_gate.MAIL_PROVISION)
check("a backend that carries no gates arms nothing — and is not an outage",
      st == {"armed": False, "unreadable": ""}, st)
with_lane({"smart_gates": {lane_gate.DIGEST: True, lane_gate.DRAIN: "yes"}})
check("armed means exactly true: a truthy word is not a switch",
      lane_gate.armed(lane_gate.DIGEST) is True and lane_gate.armed(lane_gate.DRAIN) is False)
with_lane({"smart_gates": ["not", "a", "map"]})
check("a map in a shape nothing reads is unreadable",
      bool(lane_gate.state(lane_gate.DIGEST)["unreadable"]))
old_built = (web_gate.datetime.now(web_gate.UTC) - web_gate.timedelta(hours=3)).isoformat()
with_lane({"built_at": old_built, "smart_gates": {lane_gate.DIGEST: True}})
st = lane_gate.state(lane_gate.DIGEST)
check("a lane built hours ago is STALE and so unreadable — an old map is never read as current",
      st["armed"] is False and "minutes old" in st["unreadable"], st)
with_lane({"smart_gates": {lane_gate.DIGEST: True}}, stamp=False)
st = lane_gate.state(lane_gate.DIGEST)
check("a lane that says nothing of when it was built is unreadable",
      st["armed"] is False and "says nothing of when" in st["unreadable"], st)
check("the gates go stale at the same age the switch does (web_gate.LANE_FRESH_S)",
      lane_gate.LANE_FRESH_S == web_gate.LANE_FRESH_S, (lane_gate.LANE_FRESH_S, web_gate.LANE_FRESH_S))
with_switch(ON)
with_lane({"built_at": old_built, "smart_gates": {lane_gate.MAIL_PROVISION: False}})
held_stale = lane_gate.holds(lane_gate.MAIL_PROVISION)
check("while the switch holds, a stale lane HOLDS the mailbox door even where the old map said off",
      held_stale["held"] is True and held_stale["unreadable"] is True, held_stale)

print("person")
with_switch(ON)
with_lane({"smart_gates_unreadable": "the tab did not answer"})
held_mail = lane_gate.holds(lane_gate.MAIL_PROVISION)
held_digest = lane_gate.holds(lane_gate.DIGEST)
check("while the switch holds, an unreadable lane HOLDS the mailbox door and says why",
      held_mail["held"] is True and held_mail["unreadable"] is True and "could not be read" in held_mail["why"],
      held_mail)
check("…and keeps the digest lane, which writes the Hub's own books, acting",
      held_digest["held"] is False, held_digest)
with_switch(OFF)
check("with the switch plainly off, an unreadable lane holds nothing",
      lane_gate.holds(lane_gate.MAIL_PROVISION)["held"] is False)
check("the mailbox is the relay door that reaches a person", lane_gate.PERSON == {lane_gate.MAIL_PROVISION})

print("switch")
with_lane({"smart_gates": {g: True for g in lane_gate.GATES}})
with_switch(ON)
h = lane_gate.holds(lane_gate.DIGEST)
check("an armed gate holds while the switch is on", h["held"] and "armed and the send switch is on" in h["why"], h)
with_switch({"on": True, "readable": False, "word": "unreadable", "why": "the lane is old"})
h = lane_gate.holds(lane_gate.DRAIN)
check("an armed gate holds while the switch cannot be read, and says so",
      h["held"] and "could not be read (the lane is old)" in h["why"], h)
with_switch(OFF)
check("an armed gate never holds with the switch off", lane_gate.holds(lane_gate.DIGEST)["held"] is False)
effective_roster.use_switch(None)
check("no switch handed to the process holds, like an unreadable one",
      lane_gate.holds(lane_gate.DIGEST)["held"] is True)
with_switch(ON)
check("an ingest action answers to the ingest gate; any other action to none",
      lane_gate.action_gate("psiPunchesIngest")["held"] is True and
      lane_gate.action_gate("usersList")["held"] is False)
check("the call feed, the provider's webhook filing and the line directory push are ingest posts too",
      all(lane_gate.action_gate(a)["held"] is True
          for a in ("commCallsIngest", "quoIngest", "lineDirectorySync")))

print("notices")
lane_gate.use_lane(None)
n_none = lane_gate.notice_state("call_off")
with_lane({"built_at": old_built, "notice_situations": {"web_notice_call_off": True}})
n_stale = lane_gate.notice_state("call_off")
with_lane({"notice_situations_unreadable": "the tab did not answer"})
n_said = lane_gate.notice_state("call_off")
with_lane({"smart_gates": {}})
n_old_engine = lane_gate.notice_state("call_off")
with_lane({"notice_situations": {"web_notice_call_off": True, "web_notice_open_shift": "yes"}})
n_on, n_word, n_absent = (lane_gate.notice_state(k) for k in ("call_off", "open_shift", "late_call"))
check("A NOTICE KIND IS A MESSAGE: no lane, a stale lane and a tab Apps Script could not read are all "
      "unreadable and never armed",
      not any(s["armed"] for s in (n_none, n_stale, n_said))
      and all(s["unreadable"] for s in (n_none, n_stale, n_said)), [n_none, n_stale, n_said])
check("…an engine that carries no notice switches arms none — a new message arrives off — and says so",
      n_old_engine["armed"] is False and not n_old_engine["unreadable"] and "arrives off" in n_old_engine["why"],
      n_old_engine)
check("…and armed means exactly true, per kind: a truthy word or an absent row is off, and says which",
      n_on["armed"] is True and n_word["armed"] is False and n_absent["armed"] is False
      and "switched off" in n_absent["why"], [n_on, n_word, n_absent])

print("envelope")
env = lane_gate.refused("held for a reason")
check("a held door answers 409 with the reason — the caller offers the rows again",
      env == {"status": 409, "message": "held for a reason", "held": True}, env)

print("worker")
built = web_gate.datetime.now(web_gate.UTC).isoformat()
live_lane = {"place": "", "built_at": built, "test_mode": {"on": True, "word": "on"},
             "smart_gates": {lane_gate.DIGEST: True}, "other": "not for the worker"}
target = Path(os.environ["HUB_LANE_GATE_FILE"])
check("the relay publishes the gates' part of the lane, atomically", lane_gate.publish(live_lane) is True)
on_disk = json.loads(target.read_text())
check("…and only that part: nothing else the relay knows is written beside it",
      set(on_disk["lane"]) == {"place", "built_at", "test_mode", "smart_gates"}, on_disk)
reader = lane_gate.file_lane()
check("the worker reads back what was published", reader().get("smart_gates") == {lane_gate.DIGEST: True})
stale = TMP / "stale.json"
stale.write_text(json.dumps({"written_at": time.time() - 3600, "lane": live_lane}))
try:
    lane_gate.file_lane(stale, max_age_s=900)()
    stale_raised = False
except RuntimeError as exc:
    stale_raised = "minutes old" in str(exc)
check("a file the relay stopped refreshing is stale, and the reader refuses it", stale_raised)
try:
    lane_gate.file_lane(TMP / "never-written.json")()
    missing_raised = False
except Exception:  # noqa: BLE001
    missing_raised = True
check("a file that was never written is refused, not read as empty", missing_raised)

lane_gate.use_lane(None)
effective_roster.use_switch(None)
import form_digest  # noqa: E402

check("the worker hands itself the published lane AND the switch read from it",
      form_digest._gates_from_the_relay() is True)
check("armed on the Desk with the switch on, the worker's gate holds — it is no longer blind",
      lane_gate.holds(lane_gate.DIGEST)["held"] is True and effective_roster.test_mode()["readable"] is True)
passed = form_digest._one_pass()
check("the worker's own pass stops before claiming a single row, and says why",
      passed.get("items") == 0 and "armed" in str(passed.get("note")), passed)
scanned = []
# the scan is the Decoder lab's own write on asa-hub-app (digestScan), asked through the keeper's door
form_digest.APP_DOOR = lambda action, payload: scanned.append(action) or {"status": 200, "scan": {"written": 1}}
held_scan = form_digest._proposals_pass()
check("the hourly proposals scan asks the same gate and holds with it — nothing is appended to the words "
      "book while the Desk says the digest lane is held",
      held_scan["held"] is True and "armed" in held_scan["why"] and not scanned, (held_scan, scanned))
lane_gate.publish(dict(live_lane, test_mode={"on": False, "word": "off"}))
check("the switch off in the published lane lets the pass run again",
      lane_gate.holds(lane_gate.DIGEST)["held"] is False)
ran_scan = form_digest._proposals_pass()
form_digest.APP_DOOR = None
check("…and the proposals scan runs again with it", ran_scan["held"] is False and scanned == ["digestScan"],
      (ran_scan, scanned))
target.unlink()
st = lane_gate.state(lane_gate.DIGEST)
check("a published lane that disappears is unreadable in the worker, never 'not armed'",
      bool(st["unreadable"]) and effective_roster.test_mode()["on"] is True, st)
src_fd = (SERVER / "form_digest.py").read_text(encoding="utf-8")
tree_fd = ast.parse(src_fd)
main_src = ast.get_source_segment(src_fd, next(n for n in ast.walk(tree_fd)
                                               if isinstance(n, ast.FunctionDef) and n.name == "main"))
top_calls = [n for n in tree_fd.body if isinstance(n, ast.Expr) and "_gates_from_the_relay" in ast.unparse(n)]
check("the worker wires its gates in main(), never at import — the relay imports this module for its "
      "helpers and must keep its own readers",
      "_gates_from_the_relay()" in main_src and not top_calls)


def fd_segment(name):
    node = next(n for n in tree_fd.body if isinstance(n, ast.FunctionDef) and n.name == name)
    return ast.get_source_segment(src_fd, node)


props_src = fd_segment("_proposals_pass")
one_src = fd_segment("_one_pass")
proposal_users = [n.name for n in tree_fd.body if isinstance(n, ast.FunctionDef)
                  and '"digestScan"' in ast.get_source_segment(src_fd, n)]
check("every write main() can reach asks the digest gate first: the pass and the proposals scan ask it before "
      "they claim or scan, the stalled-claim sweep runs only when the startup read did not hold, and the "
      "proposals book is written through the gated scan alone (the app's digestScan, never Google)",
      "_proposals_pass()" in main_src and "digest_proposals" not in src_fd
      and 0 < props_src.index("lane_gate.holds(lane_gate.DIGEST)") < props_src.index('_app_write("digestScan"')
      and 0 < one_src.index("lane_gate.holds(lane_gate.DIGEST)") < one_src.index("_pass_over(")
      and main_src.index("if _startup_held:") < main_src.index("else:") < main_src.index("_release_stalled(")
      and proposal_users == ["_proposals_pass"], proposal_users)
check("a held scan leaves the hour's clock alone, so it runs on the first pass after release",
      "if not _proposals_pass()[\"held\"]:" in main_src)

print("call feed")
os.environ.pop("HUB_EXEC_URL", None)
os.environ["HUB_APP_URL"] = "http://asa-hub-app.invalid:8080"
os.environ["HUB_APP_TOKEN"] = "lane-gate-test-token"
import comm_calls_feed as ccf  # noqa: E402
import master_json as mj  # noqa: E402

mj.ROOT = TMP / "journal"
left = []


def never_leaves(*a, **k):
    left.append(a)
    raise AssertionError("the post left the relay")


real_urlopen = ccf.urllib.request.urlopen
ccf.urllib.request.urlopen = never_leaves
effective_roster.use_switch(lambda: dict(ON))
with_lane({"smart_gates": {lane_gate.INGEST: True}})
held_hand = ccf.hand_over(ccf.door(), [{"call_id": "C-held-1"}], [], "2026-01-01T00:00:00Z")
check("armed with the switch on, the call lane's terminal door holds commCallsIngest before anything leaves — "
      "no request and no journal — and the hand-over reads it as held, never as an answered refusal",
      held_hand.get("reached") is False and held_hand.get("held") is True and not left
      and not (mj.ROOT / "handoff" / "commCallsIngest").exists(), (held_hand, left))
noted = []
held_funcs = {k: getattr(ccf, k) for k in ("_hand_columns", "parked_count", "pending", "hand_noted", "landed")}
parked_row = {"call_id": "C-held-2", "hand_attempts": ccf.HAND_MAX - 1,
              "call": {"call_id": "C-held-2", "read_state": "read"}, "items": []}
ccf._hand_columns = lambda dsn: True
ccf.parked_count = lambda dsn: 1
ccf.pending = lambda dsn, limit=None: [dict(parked_row)]
ccf.hand_noted = lambda dsn, ids, why, answered: noted.append((list(ids), answered)) or []
ccf.landed = lambda dsn, ids: 0
try:
    held_pass = ccf.deliver("dsn", ccf.door(), say=lambda _m: None)
finally:
    for k, fn in held_funcs.items():
        setattr(ccf, k, fn)
    ccf.urllib.request.urlopen = real_urlopen
check("a held pass is its own outcome and charges nothing: a call one refusal from quarantine stays parked "
      "instead of being moved to 'refused' by a hold",
      held_pass["outcome"] == "held" and noted == [(["C-held-2"], False)]
      and held_pass["quarantined"] == 0 and not left, (held_pass, noted))
svc = (SERVER / "snapshot_service.py").read_text(encoding="utf-8")
tree = ast.parse(svc)


def segment(name):
    node = next(n for n in ast.walk(tree)
                if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name == name)
    return ast.get_source_segment(svc, node)


ccf_src = (SERVER / "comm_calls_feed.py").read_text(encoding="utf-8")
door_src = ast.get_source_segment(ccf_src, next(
    n for n in ast.walk(ast.parse(ccf_src)) if isinstance(n, ast.FunctionDef) and n.name == "post"))
service_src = segment("_service_door")
check("the clocks' door asks the ingest gate BEFORE the hand-off journal, so a held post writes no record and a "
      "long hold cannot rotate out the records of posts that did leave; the call lane's door asks it before it posts",
      0 < service_src.index("lane_gate.action_gate(") < service_src.index("master_json.handoff_first")
      and 0 < door_src.index("lane_gate.action_gate(") < door_src.index("call(action, payload"))
check("the write ledger and its drain are gone: no write waits on the relay's disk for another engine",
      "_ledger_drain" not in svc and "LEDGER_GATE_HELD_FILE" not in svc)

print("wiring")
check("the relay publishes the lane for the worker every time it reads it",
      "lane_gate.publish(env[\"data\"])" in segment("_config_lane_refresh"))
check("the door every clock's ingest leaves through asks the ingest gate",
      "lane_gate.action_gate(" in segment("_service_door") and "lane_gate.action_gate(" in segment("_comm_calls_python"))
for door, gate in (("mail_provision", "MAIL_PROVISION"), ("mail_mark", "MAIL_MARK"), ("mail_file", "MAIL_MARK"),
                   ("digest_proposals_decide", "DIGEST"), ("digest_teach", "DIGEST"),
                   ("_relay_observe_chat", "CHAT_FRAME")):
    check(f"{door} asks {gate}", f"lane_gate.holds(lane_gate.{gate})" in segment(door))
catalogue = (ROOT / "apps-script" / "SmartGate.gs").read_text(encoding="utf-8")
missing = [g for g in lane_gate.GATES if f"id: '{g}'" not in catalogue]
check("every gate the relay asks is in the one catalogue the Desk draws", not missing, missing)
check("the mailbox is a person door in both homes",
      "id: 'gate_mail_provision', relay: true, person: true" in catalogue)

shutil.rmtree(TMP, ignore_errors=True)
print(f"\nlane gate: {results['ok']} ok, {len(results['failed'])} failed")
sys.exit(1 if results["failed"] else 0)
