#!/usr/bin/env python3
"""
THE TEXT INBOX, asserted against the real functions, offline.

WHAT IT PROVES. A text the messages webhook or the Quo pull delivers is kept
on the relay's disk once — whichever door saw it first, however often Quo
redelivers — before anybody else hears of it; it survives a restart, a line
torn by a crash is dropped instead of glued onto, and the hand-off drains an
event only on that event's own `filed` or `already`. A batch that fails whole
stands the hand-off down and shrinks the next one until the failing event is
alone; a finished, drained day is zipped and still counts for duplicates. The
pull wraps what the API lists into the event a webhook delivers, field for
field as Quo.gs reads it, and a 429 ends a round without moving a cursor it
did not earn. The relay's own signature check (lifted out of
snapshot_service.py unimported) verifies a real HMAC under the relay-held
messages key.

THE CALLS TOO. The pull owes a call's transcript from the moment it lists
the call (still going, or ended) and asks for it by id until it is kept or
its wait is over. An event an Apps Script key signed lands in the same inbox
and never waits on Apps Script, whose keys are refreshed behind the answer;
and the transcript door of the calls lane runs every blocking call off the
relay's one event loop and obeys the lane's switch. The relay's functions are
run for real over stand-ins, lifted out of snapshot_service.py.

AND WHAT THE REVIEW FOUND, each pinned where it broke: a relay restarted
mid-batch waits the orphaned execution out and re-offers its events as
`recheck`; one thread that never reads is owed on its own and holds neither
its line nor the lines after it; a sent text delivered after the overlap is
asked for by id until it is; the API key never reaches a log line, however
its file is written; every inbox file is 0600 in a 0700 directory; and the
Apps Script half — two executions over the same texts, a re-offered text
older than the batch's window, a tab that could not be read — is run for real
in node against a stand-in tab (the .gs files loaded in project order, as
tools/run-selftest.mjs loads them).

HOW IT STAYS OFFLINE. It runs on the host against the checkout's server/.
`urlopen` is replaced by a function that fails the test, the pull's one door
(`quo_pull._get`) is replaced wherever a check needs answers, the API base
resolves nowhere, and every file — inbox, state, both keys — lives in a
temporary directory. Every key is a random one made here.

    python3 tools/test-quo-inbox.py
"""
import ast
import base64
import gzip
import hashlib
import hmac
import http.client
import json
import logging
import os
import re
import secrets
import shutil
import stat
import subprocess
import sys
import tempfile
import time
import urllib.parse
import urllib.request
from datetime import datetime
from pathlib import Path

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve()
ROOT = HERE.parent.parent
SERVER = ROOT / "server"
TMP = Path(tempfile.mkdtemp(prefix="quo-inbox-"))
os.environ.update({
    "HUB_QUO_INBOX_DIR": str(TMP / "inbox"),
    "HUB_QUO_MESSAGES_KEY_FILE": str(TMP / "messages-webhook.key"),
    "HUB_QUO_API_KEY_FILE": str(TMP / "quo-api.key"),
    "HUB_QUO_API_BASE": "https://quo.invalid/v1",
    "HUB_QUO_PULL_GAP_S": "0",
    "HUB_SNAPSHOT_OUT": str(TMP),
})
sys.path.insert(0, str(SERVER))


def _no_network(*_a, **_k):
    raise AssertionError("the test tried to reach the network")


urllib.request.urlopen = _no_network

import quo_inbox as qi  # noqa: E402
import quo_pull as qp  # noqa: E402

REAL_GET = qp._get
qp._get = _no_network

results = {"ok": 0, "failed": []}


def check(name, cond, detail=""):
    if cond:
        results["ok"] += 1
        print(f"ok   {name}")
    else:
        results["failed"].append(name)
        print(f"FAIL {name}{(' — ' + str(detail)[:400]) if detail else ''}")


said = []


class Keep(logging.Handler):
    def emit(self, record):
        said.append((record.levelno, record.getMessage()))


for _name in ("hub.quo_inbox", "hub.quo_pull"):
    _lg = logging.getLogger(_name)
    _lg.addHandler(Keep())
    _lg.setLevel(logging.INFO)
    _lg.propagate = False


def relay_function(name):
    """One function of the relay, compiled alone: the relay's imports (FastAPI,
    httpx, psycopg2) live in its container, and these need none of them."""
    tree = ast.parse((SERVER / "snapshot_service.py").read_text(encoding="utf-8"))
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == name:
            ns = {"base64": base64, "hashlib": hashlib, "hmac": hmac}
            exec(compile(ast.Module(body=[node], type_ignores=[]), f"snapshot_service.py:{name}", "exec"), ns)
            return ns[name]
    raise AssertionError(f"{name} is not in snapshot_service.py")


def relay_live(name, ns):
    """One relay function run for real over stand-ins `ns`: decorators dropped, annotations left unevaluated
    (the relay's own `from __future__`), so nothing of FastAPI is needed."""
    import __future__  # noqa: PLC0415
    tree = ast.parse((SERVER / "snapshot_service.py").read_text(encoding="utf-8"))
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == name:
            node.decorator_list = []
            exec(compile(ast.Module(body=[node], type_ignores=[]), f"snapshot_service.py:{name}", "exec",
                         flags=__future__.annotations.compiler_flag, dont_inherit=True), ns)
            return ns[name]
    raise AssertionError(f"{name} is not in snapshot_service.py")


def relay_source(name):
    src = (SERVER / "snapshot_service.py").read_text(encoding="utf-8")
    for node in ast.parse(src).body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == name:
            return ast.get_source_segment(src, node) or ""
    return ""


signature_ok = relay_function("_quo_signature_ok")
stamp_age = relay_function("_quo_stamp_age_s")


def sign(raw, key, stamp_ms):
    mac = hmac.new(base64.b64decode(key), str(stamp_ms).encode() + b"." + raw, hashlib.sha256).digest()
    return f"hmac;1;{stamp_ms};{base64.b64encode(mac).decode()}"


def fresh_inbox(name):
    qi.INBOX_DIR = TMP / name
    qi.STATE_FILE = qi.INBOX_DIR / ".state.json"
    qi.forget()


def ohio(y, m, d, h=12, mi=0):
    return datetime(y, m, d, h, mi, tzinfo=qi.OHIO).timestamp()


def lines_on_disk(day):
    path = qi.INBOX_DIR / f"{day}.jsonl"
    return [json.loads(x) for x in path.read_bytes().split(b"\n") if x.strip()] if path.exists() else []


# ── the shapes: a webhook event as the live Webhook Log holds one, and the
# same message as the API lists it (numbers and ids made up here) ──────────
PN, CONV = "PNtest00001", "CNtest0000000000000000000000000001"


def webhook_received(mid="ACtest0000000000000000000000000001", text="Reply DONE"):
    return {"id": "EVtest000000000000000000000000001", "object": "event", "apiVersion": "v4",
            "createdAt": "2026-03-02T12:00:27.635Z", "type": "message.received",
            "data": {"object": {"id": mid, "object": "message", "from": "+15550000001",
                                "to": "+15550000002", "direction": "incoming", "text": text,
                                "status": "received", "createdAt": "2026-03-02T12:00:27.281Z",
                                "userId": "UStest0001", "phoneNumberId": PN, "contactIds": []},
                     "deepLink": f"https://my.quo.com/inbox/{PN}/c/{CONV}?at={mid}"}}


def api_message(mid="ACtest0000000000000000000000000001", text="Reply DONE", direction="incoming",
                status="received", to=("+15550000002",), created="2026-03-02T12:00:27.281Z",
                updated="2026-03-02T12:00:27.300Z", media=()):
    return {"id": mid, "to": list(to), "from": "+15550000001", "text": text, "phoneNumberId": PN,
            "conversationId": CONV, "direction": direction, "userId": "UStest0001", "status": status,
            "createdAt": created, "updatedAt": updated, "media": list(media)}


# ── Quo.gs, read as Apps Script reads it ───────────────────────────────────
QUO_GS = (ROOT / "apps-script" / "Quo.gs").read_text(encoding="utf-8")
handler_src = QUO_GS[QUO_GS.index("function quoHandleMessage_("):]
handler_src = handler_src[:handler_src.index("\n}\n")]
OBJ_READS = set(re.findall(r"(?<![\w.])obj\.(\w+)", handler_src))
BODY_READS = set(re.findall(r"(?<![\w.])body\.(\w+)", handler_src))


def js_truthy(v):
    return not (v is None or v is False or v == "" or (isinstance(v, (int, float)) and not isinstance(v, bool) and v == 0))


def js_str(v):
    """str_ (Talent.gs): null → '', else String(v).trim()."""
    if v is None:
        return ""
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, list):
        return ",".join(js_str(x) for x in v)
    return str(v).strip()


def quo_names(v):
    if not js_truthy(v):
        return ""
    if not isinstance(v, list):
        return js_str(v)
    out = []
    for x in v:
        one = js_str(next((x[k] for k in ("name", "number", "phoneNumber", "email", "id")
                           if js_truthy(x.get(k))), None)) if isinstance(x, dict) else js_str(x)
        if one:
            out.append(one)
    return ", ".join(out)


def handler_record(body):
    """quoHandleMessage_'s record, field for field — the reads the regex above found."""
    d = body.get("data") if js_truthy(body.get("data")) else {}
    obj = d.get("object") if js_truthy(d.get("object")) else d
    to = obj.get("to")
    media = obj.get("media")
    return {
        "message_id": js_str(obj.get("id")), "event_id": js_str(body.get("id")),
        "event_type": js_str(body.get("type")), "message_created": js_str(obj.get("createdAt")),
        "event_at": js_str(body.get("createdAt") if js_truthy(body.get("createdAt")) else obj.get("createdAt")),
        "status": js_str(obj.get("status")), "quo_number": js_str(obj.get("phoneNumberId")),
        "direction": js_str(obj.get("direction")), "from_number": js_str(obj.get("from")),
        "to_number": ", ".join(to) if isinstance(to, list) else js_str(to),
        "user_id": js_str(obj.get("userId")), "conversation_id": js_str(obj.get("conversationId")),
        "body": js_str(obj.get("text") if js_truthy(obj.get("text")) else obj.get("body"))[:20000],
        "attachments": " ".join(js_str(m.get("url")) for m in media) if isinstance(media, list) and media else "",
        "participants": quo_names(to) or js_str(obj.get("from")),
        "team_members": js_str(obj.get("userId")), "contact_ids": quo_names(obj.get("contactIds")),
        "message_type": js_str(obj.get("type") if js_truthy(obj.get("type")) else body.get("type")),
    }


# ═══ the relay's messages key and its signature ═══════════════════════════
check("the inbox lives where the env says, and its state file can never be a slice's name",
      str(qi.INBOX_DIR) == os.environ["HUB_QUO_INBOX_DIR"] and qi.STATE_FILE.parent == qi.INBOX_DIR
      and qi.STATE_FILE.name.startswith(".") and qi.STATE_FILE.name.endswith(".json"))
check("the handler's reads are the ones this test mirrors (a new read means a new look at the wrap)",
      OBJ_READS == {"id", "createdAt", "status", "phoneNumberId", "direction", "from", "to", "userId",
                    "conversationId", "text", "body", "media", "contactIds", "type"}
      and BODY_READS == {"data", "id", "type", "createdAt"}, (sorted(OBJ_READS), sorted(BODY_READS)))
key_file = Path(os.environ["HUB_QUO_MESSAGES_KEY_FILE"])
check("no key file, no key: the inbox door is off", qi.webhook_keys() == [])
key = base64.b64encode(secrets.token_bytes(32)).decode()
key_file.write_text(key + "\nnot-a-key\n", encoding="utf-8")
keys = qi.webhook_keys()
check("the key file is read, an unusable entry passed over", keys == [key], len(keys))
raw = json.dumps(webhook_received(), separators=(",", ":")).encode()
now_ms = int(time.time() * 1000)
header = sign(raw, key, now_ms)
check("signature: a real HMAC under the messages key verifies with the relay's own check",
      signature_ok(raw, header, keys) is True)
check("signature: another key does not verify",
      signature_ok(raw, header, [base64.b64encode(secrets.token_bytes(32)).decode()]) is False)
check("signature: a changed body does not verify", signature_ok(raw + b" ", header, keys) is False)
check("signature: bytes past ASCII are refused, never raised",
      signature_ok(raw, "hmac;1;1;\xe9\xe9", keys) is False)
check("a key never reaches the log", not any(key in m for _l, m in said))
key2 = base64.b64encode(secrets.token_bytes(48)).decode()
key_file.write_text(key2, encoding="utf-8")
check("a rewritten key file is read again (stamp), and the old key stops verifying",
      qi.webhook_keys() == [key2] and signature_ok(raw, header, qi.webhook_keys()) is False)
key_file.unlink()
check("a removed key file disarms the door", qi.webhook_keys() == [])
age = stamp_age(header, time.time())
check("the stamp's age is read off the signature", age is not None and abs(age) < 5, age)

# ═══ the webhook door ═════════════════════════════════════════════════════
fresh_inbox("webhook")
T0 = ohio(2026, 9, 22, 9)
DAY0 = qi.day_of(T0)
check("stale by 301 s is refused", qi.accept_webhook(raw, 301.0, T0)[0] == 401)
check("no stamp at all is refused", qi.accept_webhook(raw, None, T0)[0] == 401)
check("a body that is not JSON is a 400", qi.accept_webhook(b"{nope", 1.0, T0)[0] == 400)
status, fields = qi.accept_webhook(json.dumps({"type": "message.received", "data": {}}).encode(), 1.0, T0)
check("JSON that names no message is answered 200 and not kept (a retry could never fix it)",
      status == 200 and fields == {"ignored": "shape"} and not lines_on_disk(DAY0), fields)
status, fields = qi.accept_webhook(raw, 1.0, T0)
disk = lines_on_disk(DAY0)
check("a signed event is kept and answered 200 at once",
      status == 200 and fields == {"kept": "added"} and len(disk) == 1, (status, fields))
check("the line is the whole event, keyed (message id, type), undrained",
      disk and disk[0]["id"] == "ACtest0000000000000000000000000001" and disk[0]["type"] == "message.received"
      and disk[0]["source"] == "webhook" and disk[0]["event"] == json.loads(raw)
      and disk[0]["drained_at"] is None and disk[0]["tries"] == 0 and disk[0]["last_error"] is None
      and disk[0]["received_at"].endswith("Z"), disk)
status, fields = qi.accept_webhook(raw, 1.0, T0 + 5)
check("Quo redelivering it is a duplicate, still one line",
      fields == {"kept": "duplicate"} and len(lines_on_disk(DAY0)) == 1, fields)

# ═══ idempotency across the two doors ═════════════════════════════════════
pulled = qp.wrap(api_message(), PN)
check("the pull of the same message is a duplicate of the webhook's line",
      qi.append(pulled, "pull", T0 + 10) == "duplicate" and len(lines_on_disk(DAY0)) == 1)
other = api_message(mid="ACtest0000000000000000000000000002")
check("pull first, then the webhook: still one line, and it is the pull's",
      qi.append(qp.wrap(other, PN), "pull", T0 + 20) == "added"
      and qi.append(webhook_received(mid="ACtest0000000000000000000000000002"), "webhook", T0 + 21) == "duplicate"
      and [x["source"] for x in lines_on_disk(DAY0)] == ["webhook", "pull"])
same_id_other_type = webhook_received(mid="ACtest0000000000000000000000000002")
same_id_other_type["type"] = "message.delivered"
check("the key is (id, type): the same id under another type is its own line",
      qi.append(same_id_other_type, "webhook", T0 + 22) == "added" and len(lines_on_disk(DAY0)) == 3)
twice = qi.append_many([webhook_received(mid="ACtwice"), webhook_received(mid="ACtwice")], "webhook", T0 + 23)
check("one message twice inside one call is one line", twice == {"added": 1, "duplicate": 1, "invalid": 0}, twice)
check("a call event is keyed by its call", qi.event_key({"type": "call.transcript.completed",
                                                          "data": {"object": {"id": "TR1", "callId": "AC9"}}})
      == ("AC9", "call.transcript.completed"))
check("nothing to key is invalid", qi.event_key({"type": "message.received"}) is None
      and qi.event_key("text") is None and qi.event_key({"data": {"object": {"id": "AC1"}}}) is None)

# ═══ a restart, and a crash mid-append ════════════════════════════════════
before = [(o["id"], o["type"]) for o in qi.pending(T0 + 30, 25)]
qi.forget()
after = [(o["id"], o["type"]) for o in qi.pending(T0 + 30, 25)]
check("a restart finds the same undrained lines, in the same order", before == after and len(after) == 4, after)
check("and still knows every key", qi.append(webhook_received(), "webhook", T0 + 31) == "duplicate")
with open(qi.INBOX_DIR / f"{DAY0}.jsonl", "ab") as fh:
    fh.write(b'{"id":"ACtorn","type":"message.rec')
qi.forget()
check("a torn last line is dropped at load, never glued onto",
      qi.append(webhook_received(mid="ACafter"), "webhook", T0 + 32) == "added"
      and [x["id"] for x in lines_on_disk(DAY0)][-1] == "ACafter"
      and "ACtorn" not in [x["id"] for x in lines_on_disk(DAY0)]
      and (qi.INBOX_DIR / f"{DAY0}.jsonl").read_bytes().endswith(b"\n"))
check("the torn line was said", any("unreadable line" in m for _l, m in said))
check("no temporary file is left behind", not list(qi.INBOX_DIR.glob("*.tmp")))
qi.pull_done({PN: "2026-09-22T13:00:00.000Z"}, {"state": "ok"}, T0 + 33)
qi.forget()
check("the pull's cursor outlives a restart", qi.cursor(PN) == "2026-09-22T13:00:00.000Z")

# ═══ the hand-off drains per event ════════════════════════════════════════
fresh_inbox("drain")
T1 = ohio(2026, 9, 22, 10)
DAY1 = qi.day_of(T1)
for mid in ("ACa", "ACb", "ACc", "ACd"):
    qi.append(webhook_received(mid=mid), "webhook", T1)
offer = qi.pending(T1, 25)
env = {"status": 200, "data": {"results": [
    {"id": "ACa", "type": "message.received", "result": "filed", "why": ""},
    {"id": "ACb", "type": "message.received", "result": "already", "why": "this message id is already filed"},
    {"id": "ACc", "type": "message.received", "result": "error", "why": "boom"}],
    "reached": 3, "left": 1, "stopped_early": True}}
got = qi.after_batch(offer, env, None, T1 + 5)
check("the batch's own answer is counted per event",
      (got["verdict"], got["filed"], got["already"], got["failed"], got["unreached"], got["left"])
      == ("answered", 1, 1, 1, 1, 2), got)
disk = {x["id"]: x for x in lines_on_disk(DAY1)}
check("filed and already drain, and say which",
      disk["ACa"]["drained_at"] and disk["ACa"]["outcome"] == "filed"
      and disk["ACb"]["drained_at"] and disk["ACb"]["outcome"] == "already", disk)
check("an event's own error keeps it, one try heavier, with the reason",
      disk["ACc"]["drained_at"] is None and disk["ACc"]["tries"] == 1 and "boom" in disk["ACc"]["last_error"]
      and disk["ACc"]["retry_at"], disk["ACc"])
check("an event the batch never reached is not charged",
      disk["ACd"]["drained_at"] is None and disk["ACd"]["tries"] == 0 and disk["ACd"]["retry_at"] is None)
check("the refused one waits its turn, then rides behind every event not yet tried",
      [o["id"] for o in qi.pending(T1 + 10, 25)] == ["ACd"]
      and [o["id"] for o in qi.pending(T1 + 5 + qi.RETRY_BASE_S + 1, 25)] == ["ACd", "ACc"])
qi.after_batch([o for o in offer if o["id"] == "ACc"],
               {"status": 200, "data": {"results": [{"id": "ACc", "type": "message.received",
                                                     "result": "refused", "why": "no"}]}}, None, T1 + 200)
c = {x["id"]: x for x in lines_on_disk(DAY1)}["ACc"]
check("each refusal doubles the wait", c["tries"] == 2
      and abs(qi._ts(c["retry_at"]) - (T1 + 200 + 2 * qi.RETRY_BASE_S)) < 1, c)
check("the wait is capped", qi._backoff_s(30) == qi.RETRY_CAP_S)
qi.forget()
check("drained stays drained across a restart",
      {o["id"] for o in qi.pending(T1 + 99999, 25)} == {"ACc", "ACd"})
said.clear()
line, _day = qi._find("ACc|message.received")
for _ in range(qi.LOUD_AFTER_TRIES):
    qi._charge(line, "refused: still no", T1 + 300)
check("past twenty refusals it is said loudly, and kept",
      any(lvl >= logging.WARNING and "ACc" in m and "KEPT" in m for lvl, m in said)
      and line["drained_at"] is None and line["tries"] >= qi.LOUD_AFTER_TRIES)

# ═══ a batch that fails whole ═════════════════════════════════════════════
fresh_inbox("backoff")
T2 = ohio(2026, 9, 22, 11)
DAY2 = qi.day_of(T2)
for i in range(6):
    qi.append(webhook_received(mid=f"ACf{i}"), "webhook", T2)
offer = qi.pending(T2, 4)
got = qi.after_batch(offer, None, TimeoutError("read timeout"), T2 + 1)
check("a timeout of the whole batch stands the hand-off down ten minutes",
      got["verdict"] == "failed" and not qi.ready(T2 + 2) and qi.ready(T2 + 1 + qi.PAUSE_S), got)
check("and charges no event, and halves the next batch",
      all(x["tries"] == 0 for x in lines_on_disk(DAY2)) and qi.batch_size() == 2 and got["next_size"] == 2)
qi.after_batch(qi.pending(T2 + 700, 2), {"status": 502, "message": "Bad gateway"}, None, T2 + 700)
check("a 5xx is a failure too, and halves again", qi.batch_size() == 1)
one = qi.pending(T2 + 1400)
qi.after_batch(one, {"status": 503}, None, T2 + 1400)
lone = {x["id"]: x for x in lines_on_disk(DAY2)}[one[0]["id"]]
check("alone, the failing event is the one charged, and waits behind the rest",
      len(one) == 1 and lone["tries"] == 1 and "the batch failed" in lone["last_error"]
      and qi.pending(T2 + 2001, 1)[0]["id"] != one[0]["id"], lone)
got = qi.after_batch(qi.pending(T2 + 2001, 1), {"status": 404, "message": "Unknown action."}, None, T2 + 2001)
check("a door that refuses the whole batch (not published) pauses and charges nobody",
      got["verdict"] == "refused" and "Unknown action" in got["why"] and got["failed"] == 0
      and not qi.ready(T2 + 2002) and qi.batch_size() == 1, got)
got = qi.after_batch(qi.pending(T2 + 2700, 1), {"status": 200, "data": {"filed": True}}, None, T2 + 2700)
check("an answer without per-event results drains nothing", got["verdict"] == "refused"
      and got["filed"] == 0, got)
nxt = qi.pending(T2 + 3400, 1)
qi.after_batch(nxt, {"status": 200, "data": {"results": [
    {"id": nxt[0]["id"], "type": nxt[0]["type"], "result": "filed"}]}}, None, T2 + 3400)
check("an answered batch grows the next one back", qi.batch_size() == 2)
qi.after_batch(qi.pending(T2 + 4100, 1), None, TimeoutError("x"), time.time())
health = qi.health()
check("/health says armed and stood down, and nothing that moves when somebody texts",
      set(health) == {"armed", "stood_down_s"} and health["armed"] is False and health["stood_down_s"] > 0
      and "quo_inbox.health()" in relay_source("health"), health)
check("classify: an exception, no envelope, a 5xx fail; a 4xx refuses; results answer",
      qi.classify(None, OSError("x"))["kind"] == "failed" and qi.classify("html")["kind"] == "failed"
      and qi.classify({"status": 500})["kind"] == "failed" and qi.classify({"status": 403})["kind"] == "refused"
      and qi.classify({"status": 200, "data": {"results": []}})["kind"] == "answered")

# ═══ zip the round ════════════════════════════════════════════════════════
fresh_inbox("rotate")
D1, D2, D3 = ohio(2026, 9, 18, 23, 50), ohio(2026, 9, 19, 8), ohio(2026, 9, 20, 9)
day1, day2 = qi.day_of(D1), qi.day_of(D2)
qi.append(webhook_received(mid="ACz1"), "webhook", D1)
qi.append(webhook_received(mid="ACz2"), "pull", D1)
qi.append(webhook_received(mid="ACz3"), "webhook", D2)
check("a line lands on the Ohio day it arrived (23:50 is still that day)", day1 == "2026-09-18"
      and len(lines_on_disk(day1)) == 2 and len(lines_on_disk(day2)) == 1)
drain_all = qi.pending(D1 + 60, 25)
qi.after_batch([o for o in drain_all if o["id"] != "ACz3"], {"status": 200, "data": {"results": [
    {"id": "ACz1", "type": "message.received", "result": "filed"},
    {"id": "ACz2", "type": "message.received", "result": "already"}]}}, None, D1 + 60)
check("today is never zipped, even drained", qi.rotate(D1 + 120)["zipped"] == 0
      and (qi.INBOX_DIR / f"{day1}.jsonl").exists())
got = qi.rotate(D3)
gz = qi.INBOX_DIR / f"{day1}.jsonl.gz"
check("a finished, drained day is zipped and its open file is gone",
      got["zipped"] == 1 and gz.exists() and not (qi.INBOX_DIR / f"{day1}.jsonl").exists(), got)
zipped_lines = [json.loads(x) for x in gzip.decompress(gz.read_bytes()).split(b"\n") if x.strip()]
check("the archive holds every line, drained, as it was",
      [x["id"] for x in zipped_lines] == ["ACz1", "ACz2"] and all(x["drained_at"] for x in zipped_lines))
check("a day still holding an undrained line stays open", (qi.INBOX_DIR / f"{day2}.jsonl").exists())
qi.forget()
check("a zipped day's keys still count after a restart",
      qi.append(webhook_received(mid="ACz1"), "pull", D3) == "duplicate")
qi.append(webhook_received(mid="ACback"), "webhook", D1 + 300)
back = qi.pending(D3, 25)
qi.after_batch([o for o in back if o["id"] == "ACback"], {"status": 200, "data": {"results": [
    {"id": "ACback", "type": "message.received", "result": "filed"}]}}, None, D3)
qi.rotate(D3 + 60)
merged = [json.loads(x)["id"] for x in gzip.decompress(gz.read_bytes()).split(b"\n") if x.strip()]
check("a clock that stepped back into a zipped day is merged into its archive, never over it",
      merged == ["ACz1", "ACz2", "ACback"] and not (qi.INBOX_DIR / f"{day1}.jsonl").exists(), merged)
old = qi.INBOX_DIR / "2026-07-01.jsonl.gz"
old.write_bytes(gzip.compress(b"".join(qi._encode(dict(x, id="ACancient")) for x in zipped_lines[:1]), mtime=0))
qi.forget()
check("an archive's key counts while it is kept", qi.append(webhook_received(mid="ACancient"), "pull", D3)
      == "duplicate")
got = qi.rotate(ohio(2026, 9, 20, 10))
check("an archive past sixty days is pruned, and forgotten", got["pruned"] == 1 and not old.exists()
      and gz.exists() and "ACancient|message.received" not in qi._INDEX, got)

# ═══ the pull's wrap is the webhook's shape ═══════════════════════════════
hook = webhook_received()
wrapped = qp.wrap(api_message(), PN)
rec_hook, rec_pull = handler_record(hook), handler_record(wrapped)
differs = {k for k in rec_hook if rec_hook[k] != rec_pull[k]}
check("quoHandleMessage_ writes the same row from both, but for the event's own id and time "
      "and the thread the webhook only names in its link",
      differs == {"event_id", "event_at", "conversation_id"}, {k: (rec_hook[k], rec_pull[k]) for k in differs})
check("the thread the pull names is the one the webhook's deepLink opens",
      rec_pull["conversation_id"] == CONV and f"/c/{CONV}?" in hook["data"]["deepLink"]
      and wrapped["data"]["deepLink"] == hook["data"]["deepLink"])
check("a received text's event time is when it arrived", rec_pull["event_at"] == "2026-03-02T12:00:27.281Z")
hook_obj, pull_obj = hook["data"]["object"], wrapped["data"]["object"]
check("every field the handler reads that a real webhook carries, the pull carries too",
      {f for f in OBJ_READS if f in hook_obj} <= {f for f in OBJ_READS if f in pull_obj}
      and {f for f in BODY_READS if f in hook} <= {f for f in BODY_READS if f in wrapped},
      sorted({f for f in OBJ_READS if f in hook_obj} - set(pull_obj)))
check("one recipient is the webhook's string, not the API's list", pull_obj["to"] == "+15550000002")
check("the event says where it came from; nothing Quo minted is imitated",
      wrapped["id"].startswith("pull:") and "apiVersion" not in wrapped and wrapped["object"] == "event")
check("the pull's key is the webhook's key", qi.event_key(wrapped) == qi.event_key(hook))
out = qp.wrap(api_message(mid="ACout", direction="outgoing", status="delivered",
                          created="2026-09-20T12:27:21.929Z", updated="2026-09-20T12:27:24.499Z"), PN)
check("a delivered text is message.delivered, stamped when it was delivered",
      out["type"] == "message.delivered" and out["createdAt"] == "2026-09-20T12:27:24.499Z"
      and handler_record(out)["message_created"] == "2026-09-20T12:27:21.929Z")
check("a sent text not delivered yet, or failed, is nothing a webhook ever sent",
      qp.wrap(api_message(direction="outgoing", status="sent"), PN) is None
      and qp.wrap(api_message(direction="outgoing", status="failed"), PN) is None
      and qp.wrap({"direction": "incoming"}, PN) is None)
group = qp.wrap(api_message(mid="ACgroup", to=("+15550000002", "+15550000003")), PN)
check("a group text keeps every recipient, joined as the handler joins them",
      handler_record(group)["to_number"] == "+15550000002, +15550000003"
      and handler_record(group)["participants"] == "+15550000002, +15550000003")
mms = qp.wrap(api_message(mid="ACmms", media=({"url": "https://m.invalid/1.jpg", "type": "image/jpeg"},)), PN)
check("a picture's link reaches the attachments column; no picture, no media field",
      handler_record(mms)["attachments"] == "https://m.invalid/1.jpg" and "media" not in pull_obj)

# ═══ a pull round, against answers made here ══════════════════════════════
fresh_inbox("pull")
Path(os.environ["HUB_QUO_API_KEY_FILE"]).write_text("test-api-key-not-real\n", encoding="utf-8")
T3 = ohio(2026, 9, 22, 12)
asked = []
script = {"fail_conversations_for": None}
LINES = [{"id": "PNone", "number": "+15550001111"}, {"id": "PNtwo", "number": "+15550002222"}]
THREADS = {"PNone": [{"id": "CN1", "participants": ["+15550000009"]},
                     {"id": "CN2", "participants": []}],
           "PNtwo": [{"id": "CN3", "participants": ["+15550000008", "+15550000007"]}]}
MESSAGES = {
    ("PNone", ("+15550000009",)): [
        dict(api_message(mid="ACp3", created="2026-09-17T10:00:00.000Z"), phoneNumberId="PNone"),
        dict(api_message(mid="ACp1", created="2026-09-16T10:00:00.000Z"), phoneNumberId="PNone")],
    ("PNtwo", ("+15550000008", "+15550000007")): [
        dict(api_message(mid="ACp2", direction="outgoing", status="delivered",
                         created="2026-09-16T12:00:00.000Z"), phoneNumberId="PNtwo"),
        dict(api_message(mid="ACp4", direction="outgoing", status="undelivered"), phoneNumberId="PNtwo")],
}


def fake_get(path, params):
    asked.append((path, params))
    p = dict(params)
    if path == "/phone-numbers":
        return {"data": LINES}
    if path == "/conversations":
        if script["fail_conversations_for"] == p["phoneNumbers[]"]:
            raise qp.RateLimited("429 on /conversations")
        return {"data": THREADS[p["phoneNumbers[]"]], "nextPageToken": None}
    if path == "/messages":
        parts = tuple(v for k, v in params if k == "participants[]")
        got = MESSAGES.get((p["phoneNumberId"], parts), [])
        # page one message at a time, so the paging is exercised
        at = int(p.get("pageToken") or 0)
        return {"data": got[at:at + 1], "nextPageToken": str(at + 1) if at + 1 < len(got) else None}
    if path == "/calls":
        return {"data": CALLS.get((p["phoneNumberId"], p["participants[]"]), []), "nextPageToken": None}
    if path.startswith("/call-transcripts/"):
        cid = urllib.parse.unquote(path[len("/call-transcripts/"):])
        if cid not in TRANSCRIPTS:
            raise qp.PullError("HTTP 404 on /call-transcripts/<id>", 404)
        if TRANSCRIPTS[cid] == "fail":
            raise qp.PullError("HTTP 500 on /call-transcripts/<id>", 500)
        return {"data": TRANSCRIPTS[cid]}
    raise AssertionError(f"unexpected path {path}")


CALLS: dict = {}
TRANSCRIPTS: dict = {}
qp._get = fake_get
said.clear()
r1 = qp.run_round(T3)
kept = lines_on_disk(qi.day_of(T3))
check("a round keeps what a webhook would have delivered, and nothing else",
      r1["state"] == "ok" and r1["added"] == 3 and r1["not_delivered"] == 1 and len(kept) == 3, r1)
check("oldest first into the inbox, whatever order Quo listed them in",
      [x["id"] for x in kept] == ["ACp1", "ACp2", "ACp3"] and all(x["source"] == "pull" for x in kept),
      [x["id"] for x in kept])
first_after = [dict(q).get("createdAfter") for path, q in asked if path == "/messages"]
check("the first round starts at the gap's start, less the overlap",
      first_after and all(a == qi._iso(qi._ts(qp.SINCE) - qp.OVERLAP_S) for a in first_after), first_after)
check("every line's cursor moved to when its reading began",
      qi.cursor("PNone") and qi.cursor("PNtwo") and qi._ts(qi.cursor("PNone")) <= time.time())
check("a thread with no participants is not asked about",
      not any(path == "/messages" and not [v for k, v in q if k == "participants[]"] for path, q in asked))
check("the paging was followed", sum(1 for path, q in asked if path == "/messages" and dict(q).get("pageToken")) == 2)
asked.clear()
r2 = qp.run_round(T3 + 600)
check("the next round re-reads the overlap and keeps nothing twice",
      r2["added"] == 0 and r2["duplicate"] == 3 and len(lines_on_disk(qi.day_of(T3))) == 3, r2)
after2 = {dict(q).get("createdAfter") for path, q in asked if path == "/messages"}
check("and asks from its cursor less the overlap, not from the start",
      all(qi._ts(a) > qi._ts(qp.SINCE) for a in after2), after2)
fresh_inbox("pull429")
script["fail_conversations_for"] = "PNtwo"
r3 = qp.run_round(T3)
check("a 429 ends the round and says so", r3["state"] == "rate_limited" and "429" in r3["why"], r3)
check("the line it finished is kept and moves on; the one it did not keeps its cursor",
      qi.cursor("PNone") and qi.cursor("PNtwo") is None
      and [x["id"] for x in lines_on_disk(qi.day_of(T3))] == ["ACp1", "ACp3"])
script["fail_conversations_for"] = None
Path(os.environ["HUB_QUO_API_KEY_FILE"]).unlink()
asked.clear()
r4 = qp.run_round(T3)
check("no API key, no round, no request", r4["state"] == "off" and not asked, r4)
check("the API key never reaches the log", not any("test-api-key-not-real" in m for _l, m in said))

# ═══ the pull keeps call transcripts too ══════════════════════════════════
fresh_inbox("pull-calls")
Path(os.environ["HUB_QUO_API_KEY_FILE"]).write_text("test-api-key-not-real\n", encoding="utf-8")
qp._key()


def api_call(cid, status, ago, duration):
    return {"id": cid, "status": status, "duration": duration, "createdAt": qi._iso(T3 - ago),
            "direction": "incoming", "participants": ["+15550000009"], "phoneNumberId": "PNone"}


def api_transcript(cid):
    return {"callId": cid, "status": "completed", "createdAt": qi._iso(T3 - 30), "duration": 42,
            "dialogue": [{"content": "hello", "identifier": "+15550000009", "start": 0}]}


CALLS[("PNone", "+15550000009")] = [api_call("ACc1", "completed", 3600, 42),
                                     api_call("ACc2", "completed", 1200, 30),
                                     api_call("ACc3", "in-progress", 60, 0),
                                     api_call("ACc4", "missed", 300, 0),
                                     api_call("ACc5", "completed", 900, 0)]
TRANSCRIPTS["ACc1"] = api_transcript("ACc1")
asked.clear()
r5 = qp.run_round(T3)
tr5 = [x for x in lines_on_disk(qi.day_of(T3)) if x["type"] == qp.TRANSCRIPT]
check("a round keeps a completed call's transcript in the webhook's shape, keyed by its call",
      [x["id"] for x in tr5] == ["ACc1"] and r5["transcripts"] == 1 and tr5[0]["source"] == "pull"
      and qi.event_key(tr5[0]["event"]) == ("ACc1", qp.TRANSCRIPT)
      and tr5[0]["event"]["data"]["object"]["phoneNumberId"] == "PNone", r5)
owed5 = qi.pull_line("PNone")["calls"]
check("a transcript not ready yet is owed by its call, and so is a call still going: its thread may never "
      "be listed again once it ends",
      set(owed5) == {"ACc2", "ACc3"} and r5["transcripts_owed"] == 2
      and qi._ts(owed5["ACc2"]["until"]) == T3 - 1200 + 30 + qp.TRANSCRIPT_WAIT_S
      and qi._ts(owed5["ACc3"]["until"]) == T3 - 60 + qp.CALL_LOOKBACK_S + qp.TRANSCRIPT_WAIT_S, owed5)
check("a missed call, or one with no length, is never asked about",
      not any(path in ("/call-transcripts/ACc4", "/call-transcripts/ACc5") for path, _q in asked), asked)
check("the round's note says how many transcripts the pull still owes",
      json.loads(qi.STATE_FILE.read_text(encoding="utf-8"))["pull"]["owed_transcripts"] == 2)
check("calls are listed for a one-person thread only, behind the window by the lookback",
      all(dict(q)["participants[]"] == "+15550000009" for path, q in asked if path == "/calls")
      and all(qi._ts(dict(q)["createdAfter"]) < qi._ts(qi._iso(qi._ts(qp.SINCE) - qp.OVERLAP_S))
              for path, q in asked if path == "/calls"),
      [q for path, q in asked if path == "/calls"])
CALLS[("PNone", "+15550000009")] = []
TRANSCRIPTS["ACc2"] = api_transcript("ACc2")
TRANSCRIPTS["ACc3"] = api_transcript("ACc3")
asked.clear()
r6 = qp.run_round(T3 + 600)
tr6 = [x["id"] for x in lines_on_disk(qi.day_of(T3)) if x["type"] == qp.TRANSCRIPT]
check("an owed transcript is asked by id the next round, even unlisted, and kept once",
      tr6 == ["ACc1", "ACc2", "ACc3"] and qi.pull_line("PNone")["calls"] == {}
      and ("/call-transcripts/ACc2", []) in asked and ("/call-transcripts/ACc3", []) in asked
      and ("/call-transcripts/ACc1", []) not in asked, (tr6, r6))
CALLS[("PNone", "+15550000009")] = [api_call("ACc1", "completed", 3600, 42)]
asked.clear()
qp.run_round(T3 + 1200)
check("a transcript the inbox keeps is never asked for again", not any(
    path.startswith("/call-transcripts/") for path, _q in asked), asked)
CALLS[("PNone", "+15550000009")] = [api_call("ACc6", "completed", 5 * 3600, 60)]
asked.clear()
qp.run_round(T3 + 1800)
check("a call whose wait is over is still asked once, then let go when nothing came",
      [p for p, _q in asked if p.startswith("/call-transcripts/")] == ["/call-transcripts/ACc6"]
      and qi.pull_line("PNone")["calls"] == {}, asked)
CALLS[("PNone", "+15550000009")] = [api_call("ACc7", "completed", 600, 60)]
TRANSCRIPTS["ACc7"] = "fail"
r7 = qp.run_round(T3 + 2400)
check("a transcript that could not be read stays owed and the round says it was partial",
      "ACc7" in qi.pull_line("PNone")["calls"] and r7["state"] == "partial", r7)
CALLS[("PNone", "+15550000009")] = []
asked.clear()
qp.run_round(T3 + 600 + qp.TRANSCRIPT_WAIT_S + qp.WATCH_S + 60)
check("... but not for ever: a day past its wait it is let go without another ask",
      qi.pull_line("PNone")["calls"] == {} and not any(p.startswith("/call-transcripts/") for p, _q in asked),
      asked)
CALLS.clear()
TRANSCRIPTS.clear()

# ═══ REVIEW 1 · a relay restarted mid-batch never starts a second execution ═
fresh_inbox("inflight")
T4 = ohio(2026, 9, 22, 13)
for i in range(30):
    qi.append(webhook_received(mid=f"ACi{i:02d}"), "webhook", T4)
batch1 = qi.pending(T4, 25)
qi.begin_batch(batch1, 780, T4 + 1)
state = json.loads(qi.STATE_FILE.read_text(encoding="utf-8"))
check("review 1: the batch is written down as in flight BEFORE it is posted",
      state.get("in_flight") and len(state["in_flight"]["keys"]) == 25
      and abs(qi._ts(state["in_flight"]["until"]) - (T4 + 781)) < 1, state.get("in_flight"))
said.clear()
qi.forget()   # the relay restarts; Apps Script is still running batch 1
check("review 1: a restarted relay stands down until the orphaned execution must be over",
      not qi.ready(T4 + 45) and not qi.ready(T4 + 780) and qi.ready(T4 + 782))
again = qi.pending(T4 + 782, 25)
check("review 1: and then offers those events as possibly filed (recheck), the rest as new",
      [o["id"] for o in again] == [o["id"] for o in batch1] and all(o["recheck"] for o in again)
      and not any(o["recheck"] for o in qi.pending(T4 + 782, 30)[25:]), [o["recheck"] for o in again][:3])
check("review 1: the stand-down is said, once, as a warning",
      sum(1 for lvl, m in said if lvl >= logging.WARNING and "in flight" in m) == 1, said)
check("review 1: the recheck mark reached the disk, so a second restart keeps it",
      all(x["recheck"] for x in lines_on_disk(qi.day_of(T4)) if x["id"] in {o["id"] for o in batch1}))
qi.after_batch(again, {"status": 200, "data": {"results": [
    {"id": o["id"], "type": o["type"], "result": "already"} for o in again]}}, None, T4 + 900)
qi.forget()
check("review 1: an answer clears the mark — the next restart does not wait",
      json.loads(qi.STATE_FILE.read_text(encoding="utf-8")).get("in_flight") is None and qi.ready(T4 + 901))
real_write = qi._write_atomic


def refuse_state(path, data):
    if path == qi.STATE_FILE:
        raise OSError("disk full")
    return real_write(path, data)


qi._write_atomic = refuse_state
try:
    qi.begin_batch(qi.pending(T4 + 901, 5), 780, T4 + 901)
    refused = False
except OSError:
    refused = True
finally:
    qi._write_atomic = real_write
check("review 1: a mark that cannot reach the disk refuses the post and leaves no mark in memory",
      refused and qi._STATE.get("in_flight") is None)
handoff = relay_source("_quo_handoff_once")
check("review 1: the relay marks the batch before Python's quoIngestBatch is asked, and every event carries its "
      "recheck",
      0 < handoff.index("quo_inbox.begin_batch") < handoff.index("_quo_ingest_python(")
      and '"recheck": bool(o.get("recheck"))' in handoff)

# ═══ REVIEW 4 · what the relay cannot know, it says (recheck) ═════════════
fresh_inbox("recheck")
T5 = ohio(2026, 9, 22, 14)
for mid in ("ACr1", "ACr2", "ACr3", "ACr4"):
    qi.append(webhook_received(mid=mid), "webhook", T5)
qi.after_batch(qi.pending(T5, 1), None, RuntimeError("Expecting value: line 1 column 1"), T5 + 1)
lone = {x["id"]: x for x in lines_on_disk(qi.day_of(T5))}["ACr1"]
check("review 4: a lone event whose batch failed whole is charged AND marked recheck",
      lone["tries"] == 1 and lone["recheck"] is True, lone)
qi.after_batch(qi.pending(T5 + 700, 25), {"status": 200, "data": {"results": [
    {"id": "ACr2", "type": "message.received", "result": "error", "why": "Service timed out"},
    {"id": "ACr3", "type": "message.received", "result": "refused", "why": "no event"}]}}, None, T5 + 700)
disk = {x["id"]: x for x in lines_on_disk(qi.day_of(T5))}
check("review 4: an error of its own may have come after the row — recheck; a refusal wrote nothing — none; "
      "an event not reached — none",
      disk["ACr2"]["recheck"] is True and disk["ACr3"]["recheck"] is False and disk["ACr4"]["recheck"] is False,
      {k: v["recheck"] for k, v in disk.items()})
qi.after_batch([o for o in qi.pending(T5 + 99999, 25) if o["id"] == "ACr4"],
               {"status": 403, "message": "Denied."}, None, T5 + 99999)
check("review 4: a 4xx is the door refusing before any handler ran — no recheck",
      {x["id"]: x for x in lines_on_disk(qi.day_of(T5))}["ACr4"]["recheck"] is False)
fresh_inbox("recheck-sink")
T6 = ohio(2026, 9, 22, 15)
qi.append(webhook_received(mid="ACsink"), "webhook", T6)
qi.after_batch(qi.pending(T6, 1), None, RuntimeError("Expecting value"), T6 + 1)
qi.append_many([webhook_received(mid=f"ACbulk{i:04d}") for i in range(2400)], "pull", T6 + 2)
filed_ahead = 0
t = T6 + 700
while True:
    # batches of 500 rather than 25 only to keep the test quick; the order is the same
    offer = qi.pending(t, 500)
    if any(o["id"] == "ACsink" for o in offer):
        at = next(i for i, o in enumerate(offer) if o["id"] == "ACsink")
        sink, filed_ahead = offer[at], filed_ahead + at
        break
    qi.after_batch(offer, {"status": 200, "data": {"results": [
        {"id": o["id"], "type": o["type"], "result": "filed"} for o in offer]}}, None, t)
    filed_ahead += len(offer)
    t += 61
check("review 4: an event that sank behind a backlog of 2,400 comes back flagged recheck, "
      "so Apps Script looks in every row, not the newest 2,000",
      filed_ahead > 2000 and sink["recheck"] is True, (filed_ahead, sink.get("recheck")))

# ═══ REVIEW 6 · the inbox is nobody else's to read ════════════════════════
fresh_inbox("modes")
os.umask(0o022)
T7 = ohio(2026, 9, 20, 9)
(TMP / "modes").mkdir(mode=0o755, exist_ok=True)
os.chmod(TMP / "modes", 0o755)
(TMP / "modes" / "stray.jsonl.tmp").write_bytes(b"")
os.chmod(TMP / "modes" / "stray.jsonl.tmp", 0o644)
qi.append(webhook_received(mid="ACm1"), "webhook", T7)
day7 = qi.INBOX_DIR / f"{qi.day_of(T7)}.jsonl"


def mode(p):
    return stat.S_IMODE(p.stat().st_mode)


after_append = mode(day7)
qi.after_batch(qi.pending(T7, 25), {"status": 200, "data": {"results": [
    {"id": "ACm1", "type": "message.received", "result": "filed"}]}}, None, T7 + 5)
after_rewrite = mode(day7)
qi.rotate(T7 + 2 * 86400)
gz7 = qi.INBOX_DIR / f"{qi.day_of(T7)}.jsonl.gz"
check("review 6: the directory is 0700 and a looser file already in it is tightened at load",
      mode(qi.INBOX_DIR) == 0o700 and mode(TMP / "modes" / "stray.jsonl.tmp") == 0o600,
      oct(mode(qi.INBOX_DIR)))
check("review 6: a day file stays 0600 after the rewrite, and the state file and the archive are 0600",
      after_append == 0o600 and after_rewrite == 0o600 and mode(qi.STATE_FILE) == 0o600
      and gz7.exists() and mode(gz7) == 0o600,
      (oct(after_append), oct(after_rewrite), oct(mode(qi.STATE_FILE)), gz7.exists() and oct(mode(gz7))))

# ═══ REVIEW 5 · the API key never reaches a log line ══════════════════════
api_key_file = Path(os.environ["HUB_QUO_API_KEY_FILE"])
said.clear()
api_key_file.write_text("SECRETAPIKEY1234567890abcdefXYZ\nOLDKEY-rotated-out\n", encoding="utf-8")
two = qp._key()
check("review 5: a file holding two keys is unusable — the pull is off, not armed with both",
      two == "" and qp.read_key("A\nB") == ("", "2 entries where one key is expected"))
api_key_file.write_text("# Quo API key, asatech workspace\r\nSECRETAPIKEY1234567890abcdefXYZ\r\n", encoding="utf-8")
check("review 5: a comment line is passed over and the one key is read (CRLF or not)",
      qp._key() == "SECRETAPIKEY1234567890abcdefXYZ")
api_key_file.write_text("SECRET KEYé", encoding="utf-8")
check("review 5: a key a header cannot carry is unusable", qp._key() == ""
      and qp.read_key("keyé")[0] == "" and qp.read_key("  \n# only a comment\n") == ("", "empty"))
check("review 5: the unusable file is said, and no word of it is",
      any(lvl >= logging.WARNING and "unusable" in m for lvl, m in said)
      and not any(w in m for _l, m in said for w in ("SECRETAPIKEY", "OLDKEY", "SECRET KEY", "asatech")),
      [m for _l, m in said])
api_key_file.write_text("SECRETAPIKEY1234567890abcdefXYZ\n", encoding="utf-8")
qp._key()
saved_open = urllib.request.urlopen


def header_refused(req, timeout=None):
    value = req.get_header("Authorization")
    raise ValueError("Invalid header value %r" % value.encode("latin-1"))


def torn_body(req, timeout=None):
    raise http.client.IncompleteRead(b"SECRETAPIKEY1234567890abcdefXYZ")


leaks = []
for opener in (header_refused, torn_body):
    urllib.request.urlopen = opener
    try:
        REAL_GET("/phone-numbers", [])
        leaks.append("no error")
    except qp.PullError as exc:
        leaks.append(str(exc))
    except Exception as exc:  # noqa: BLE001 - the thing under test
        leaks.append(f"escaped: {type(exc).__name__}: {exc}")
    finally:
        urllib.request.urlopen = saved_open
check("review 5: a request that fails carrying the key leaves as a PullError naming only its kind",
      leaks == ["ValueError on /phone-numbers", "IncompleteRead on /phone-numbers"], leaks)
pull_loop = relay_source("_quo_pull_loop")
check("review 5: the relay's catch-all logs the kind of a failed round, never its words",
      "type(exc).__name__" in pull_loop and "str(exc)" not in pull_loop)
check("review 5: /health's pull_armed asks the same _key() that refuses an unusable file",
      'quo_pull._key()' in relay_source("health"))
api_key_file.write_text("test-api-key-not-real\n", encoding="utf-8")
qp._key()


# ═══ REVIEWS 2 and 3 · against a Quo made here ════════════════════════════
class FakeQuo:
    """A Quo that honours updatedAfter / createdAfter and pages, with failures
    injected per thread, per line and per message id."""

    def __init__(self):
        self.lines, self.threads, self.msgs = [], {}, []
        self.fail_thread, self.fail_list, self.limit_thread = {}, set(), set()
        self.asked = []

    def line(self, pid):
        self.lines.append({"id": pid, "number": "+1555000" + str(len(self.lines)).zfill(4)})

    def thread(self, pid, cid, parts, updated):
        self.threads[cid] = {"id": cid, "phoneNumber": pid, "participants": parts, "updatedAt": updated}

    def msg(self, mid, cid, created, direction="incoming", status="received"):
        th = self.threads[cid]
        m = dict(api_message(mid=mid, direction=direction, status=status, created=created, updated=created),
                 conversationId=cid, phoneNumberId=th["phoneNumber"])
        self.msgs.append(m)
        return m

    def __call__(self, path, params):
        self.asked.append((path, params))
        p = dict(params)
        if path == "/phone-numbers":
            return {"data": self.lines}
        if path == "/conversations":
            pid = p["phoneNumbers[]"]
            if pid in self.fail_list:
                raise qp.PullError("HTTP 403 on /conversations", 403)
            after = qi._ts(p["updatedAfter"])
            return {"data": [t for t in self.threads.values()
                             if t["phoneNumber"] == pid and qi._ts(t["updatedAt"]) > after]}
        if path == "/messages":
            parts = tuple(v for k, v in params if k == "participants[]")
            cid = next((c for c, t in self.threads.items()
                        if t["phoneNumber"] == p["phoneNumberId"] and tuple(t["participants"]) == parts), None)
            if cid in self.limit_thread:
                raise qp.RateLimited("429 on /messages")
            if cid in self.fail_thread:
                raise qp.PullError(self.fail_thread[cid], 400)
            after = qi._ts(p["createdAfter"])
            return {"data": [m for m in self.msgs if m["conversationId"] == cid
                             and qi._ts(m["createdAt"]) > after], "nextPageToken": None}
        if path.startswith("/messages/"):
            mid = urllib.parse.unquote(path[len("/messages/"):])
            got = next((m for m in self.msgs if m["id"] == mid), None)
            if got is None:
                raise qp.PullError("HTTP 404 on /messages/<id>", 404)
            return {"data": got}
        if path == "/calls":
            return {"data": []}
        raise AssertionError(f"unexpected path {path}")


def iso_ago(s):
    return qi._iso(time.time() - s)


fresh_inbox("pull-starve")
fq = FakeQuo()
qp._get = fq
fq.line("PNmain")
fq.line("PNhot")
fq.thread("PNmain", "CNbad", ["+15550000101"], iso_ago(3600))
fq.thread("PNmain", "CNgood", ["+15550000102"], iso_ago(3600))
fq.thread("PNhot", "CNhot", ["+15550000103"], iso_ago(3600))
fq.msg("ACbad1", "CNbad", iso_ago(3600))
fq.msg("ACgood1", "CNgood", iso_ago(3500))
fq.msg("AChot1", "CNhot", iso_ago(3400))
fq.fail_thread["CNbad"] = "HTTP 400 on /messages"
said.clear()
rounds = [qp.run_round(time.time()) for _ in range(3)]
kept = {x["id"] for x in lines_on_disk(qi.day_of(time.time()))}
memo = qi.pull_line("PNmain")
check("review 2: one thread that never reads holds neither its line nor the line after it",
      kept == {"ACgood1", "AChot1"} and qi.cursor("PNmain") and qi.cursor("PNhot")
      and all(r["state"] == "partial" and r["lines_done"] == 2 for r in rounds), (kept, rounds[-1]))
check("review 2: the thread is OWED, with its own start and a count of the rounds it failed",
      set(memo["owed"]) == {"CNbad"} and memo["owed"]["CNbad"]["tries"] == 3
      and qi._ts(memo["owed"]["CNbad"]["after"]) <= qi._ts(qp.SINCE), memo["owed"])
check("review 2: an owed thread is asked again every round, even when it did not move",
      sum(1 for path, q in fq.asked if path == "/messages"
          and ("participants[]", "+15550000101") in q) == 3)
fq.fail_thread.clear()
fq.asked.clear()
healed = qp.run_round(time.time())
check("review 2: once it reads, its texts are kept from where it was owed, and the debt is cleared",
      healed["state"] == "ok" and "ACbad1" in {x["id"] for x in lines_on_disk(qi.day_of(time.time()))}
      and qi.pull_line("PNmain")["owed"] == {}, healed)
fresh_inbox("pull-line")
fq.fail_list.add("PNmain")
fq.fail_thread.clear()
listed = qp.run_round(time.time())
check("review 2: a line whose threads cannot be listed keeps its cursor; the next line is still read",
      listed["state"] == "partial" and listed["lines_failed"] == 1 and qi.cursor("PNmain") is None
      and qi.cursor("PNhot") and "AChot1" in {x["id"] for x in lines_on_disk(qi.day_of(time.time()))}, listed)
fresh_inbox("pull-rotate")
fq = FakeQuo()
qp._get = fq
for pid in ("PNa", "PNb", "PNc"):
    fq.line(pid)
fq.thread("PNa", "CNa", ["+15550000201"], iso_ago(3000))
fq.thread("PNb", "CNb1", ["+15550000202"], iso_ago(3000))
fq.thread("PNb", "CNb2", ["+15550000203"], iso_ago(3000))
fq.thread("PNc", "CNc", ["+15550000204"], iso_ago(3000))
for cid in ("CNa", "CNb1", "CNb2", "CNc"):
    fq.msg("AC" + cid, cid, iso_ago(2900))
fq.limit_thread.add("CNb2")
r1 = qp.run_round(time.time())
check("review 2: a 429 keeps what was read before it — the thread before the 429 on that line too",
      r1["state"] == "rate_limited"
      and {x["id"] for x in lines_on_disk(qi.day_of(time.time()))} == {"ACCNa", "ACCNb1"}
      and qi.cursor("PNa") and qi.cursor("PNb") is None and qi.cursor("PNc") is None, r1)
fq.limit_thread.clear()
fq.asked.clear()
time.sleep(0.01)
r2 = qp.run_round(time.time())
order = [dict(q)["phoneNumbers[]"] for path, q in fq.asked if path == "/conversations"]
check("review 2: the next round starts with the line tried longest ago; the one the 429 cut goes last",
      order == ["PNc", "PNa", "PNb"] and r2["state"] == "ok"
      and {x["id"] for x in lines_on_disk(qi.day_of(time.time()))} == {"ACCNa", "ACCNb1", "ACCNb2", "ACCNc"},
      order)

fresh_inbox("pull-late")
fq = FakeQuo()
qp._get = fq
fq.line("PNblast")
fq.thread("PNblast", "CNblast", ["+15550000301"], iso_ago(1000))
late = fq.msg("AClate", "CNblast", iso_ago(1000), direction="outgoing", status="queued")
gone = fq.msg("ACgone", "CNblast", iso_ago(999), direction="outgoing", status="sent")
refused_msg = fq.msg("ACrefused", "CNblast", iso_ago(998), direction="outgoing", status="sent")
q1 = qp.run_round(time.time())
check("review 3: a sent text still queued is watched on its line, not dropped",
      q1["added"] == 0 and set(qi.pull_line("PNblast")["watch"]) == {"AClate", "ACgone", "ACrefused"}, q1)
late["status"] = "delivered"
late["updatedAt"] = iso_ago(0)
fq.msgs.remove(gone)
refused_msg["status"] = "undelivered"
fq.asked.clear()
q2 = qp.run_round(time.time())
keptl = {x["id"]: x for x in lines_on_disk(qi.day_of(time.time()))}
check("review 3: delivered after the overlap, it is asked for by id and kept as message.delivered",
      "AClate" in keptl and keptl["AClate"]["type"] == "message.delivered"
      and ("/messages/AClate", []) in fq.asked
      and not any(path == "/messages" for path, q in fq.asked), (q2, fq.asked))
check("review 3: a text refused by the carrier or gone from Quo is let go; nothing is watched for ever",
      qi.pull_line("PNblast")["watch"] == {} and "ACrefused" not in keptl and q2["watch_let_go"] == 2, q2)
old_sent = fq.msg("ACancientsent", "CNblast", iso_ago(qp.WATCH_S + 60), direction="outgoing", status="sent")
memo = qi.pull_line("PNblast")
memo["watch"]["ACancientsent"] = {"created": old_sent["createdAt"], "conversation": "CNblast"}
qi.pull_done({}, {"state": "ok"}, time.time(), lines={"PNblast": memo})
fq.asked.clear()
qp.run_round(time.time())
check("review 3: past a day it is no longer asked about (the webhook would never have said delivered)",
      qi.pull_line("PNblast")["watch"] == {} and ("/messages/ACancientsent", []) not in fq.asked)
qp._get = _no_network

# ═══ REVIEWS 1, 4, 7, 8 · the Apps Script half, run in node ═══════════════
GAS_HARNESS = r"""
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import vm from 'node:vm'
const root = process.argv[2]
const gsDir = resolve(root, 'apps-script')
const reject = (w) => () => { throw new Error(w + ' is not available here') }
const sandbox = { console, JSON, Math, Date, String, Number, Boolean, Array, Object, RegExp, isNaN,
  parseInt, parseFloat, Error, TypeError, Logger: { log: () => {} }, Utilities: { getUuid: () => 'u' },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty: () => {},
                                                     deleteProperty: () => {} }) },
  CacheService: { getScriptCache: () => ({ get: () => null, put: () => {}, remove: () => {} }) },
  SpreadsheetApp: { openById: reject('SpreadsheetApp'), flush: () => {} }, DriveApp: {},
  FormApp: { ItemType: {} }, UrlFetchApp: { fetch: reject('UrlFetchApp') }, MailApp: {}, GmailApp: {},
  HtmlService: {}, ContentService: {},
  LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
  ScriptApp: { getService: () => ({ getUrl: () => '' }) },
  Session: { getActiveUser: () => ({ getEmail: () => 'test' }) } }
sandbox.globalThis = sandbox
vm.createContext(sandbox)
let order = []
try { order = JSON.parse(readFileSync(resolve(root, 'tools/project-order.json'), 'utf8')).order } catch {}
const onDisk = readdirSync(gsDir).filter((f) => f.endsWith('.gs'))
const files = [...order.map((n) => n + '.gs').filter((f) => onDisk.includes(f)),
               ...onDisk.filter((f) => !order.includes(f.replace(/\.gs$/, '')))]
for (const f of files) { try { vm.runInContext(readFileSync(resolve(gsDir, f), 'utf8'), sandbox, { filename: f }) } catch {} }
vm.runInContext(`
var TAB = { header: ['id', 'message_id'], rows: [], ear: [], hook: null, closedOnce: false };
function tabSheet_() { return {
  getLastRow: function () { return 1 + TAB.rows.length; },
  getLastColumn: function () { return TAB.header.length; },
  getRange: function (r, c, n, m) { return { getValues: function () {
    var out = []; for (var i = 0; i < n; i++) { var row = []; for (var j = 0; j < m; j++) {
      row.push(r + i === 1 ? TAB.header[c + j - 1] : ((TAB.rows[r + i - 2] || {})[TAB.header[c + j - 1]] || '')); }
      out.push(row); } return out; } }; } }; }
hubTabSheet_ = function (t) {
  if (t !== 'quo_messages') return null;
  if (TAB.closedOnce) { TAB.closedOnce = false; return null; }
  return tabSheet_();
};
createRow_ = function (res, rec) {
  TAB.rows.push({ id: 'r' + TAB.rows.length, message_id: rec.message_id });
  if (TAB.hook) { var h = TAB.hook; TAB.hook = null; h(); }
  return rec;
};
commInboundCapture_ = function (m) { TAB.ear.push(m.message_id); };
hubSysLog_ = function () {};
`, sandbox)
const run = (code) => vm.runInContext(code, sandbox)
sandbox.svc = run('serviceUser_()')
const ev = (mid) => ({ id: 'EV' + mid, type: 'message.received', createdAt: '2026-09-20T00:00:00Z',
  data: { object: { id: mid, from: '+15550000001', to: '+15550000002', direction: 'incoming', text: 'hi',
                    status: 'received', createdAt: '2026-09-20T00:00:00Z', phoneNumberId: 'PN1' } } })
const item = (mid, recheck) => ({ id: mid, type: 'message.received', source: 'pull', event: ev(mid),
                                  recheck: !!recheck })
const batch = (items) => { sandbox.P = { events: items }; return run('HUB_ACTIONS.quoIngestBatch(P, svc)') }
const out = {}
const results = (r) => r.data.results.map((x) => x.id + '=' + x.result).join(' ')
const rows = () => run('TAB.rows.map(function (r) { return r.message_id; })').join(',')
// 1/7: the relay restarted mid-batch; execution A files X2 and X3 after B's one read
run("TAB.rows = []; TAB.ear = [];")
sandbox.A = { events: [item('X2'), item('X3')] }
run("TAB.hook = function () { HUB_ACTIONS.quoIngestBatch(A, svc); };")
out.overlap = results(batch([item('X1'), item('X2'), item('X3')]))
out.overlap_rows = rows()
out.overlap_ear = run('TAB.ear').join(',')
// 4: a re-offered text filed before 2,400 others
run("TAB.rows = [{ id: 'r0', message_id: 'XOLD' }]; for (var i = 0; i < 2400; i++) TAB.rows.push({ id: 'f' + i, message_id: 'F' + i }); TAB.ear = [];")
out.window_only = results(batch([item('XOLD', false)]))
run("TAB.rows.pop();")
out.recheck = results(batch([item('XOLD', true)]))
out.recheck_rows = run('TAB.rows.length')
// 8: the tab could not be opened for the batch's one read
run("TAB.rows = [{ id: 'a', message_id: 'X1' }, { id: 'b', message_id: 'X2' }, { id: 'c', message_id: 'X3' }]; TAB.ear = []; TAB.closedOnce = true;")
out.snap_when_closed = run("(function () { TAB.closedOnce = true; return quoSeenMessageIds_(2000) === null; })()")
run("TAB.closedOnce = true;")
out.unreadable = results(batch([item('X1'), item('X2'), item('X3')]))
out.unreadable_rows = rows()
out.unreadable_ear = run('TAB.ear').join(',')
// 4 again: a re-offered text while the tab cannot be read is kept, never filed blind
run("TAB.closedOnce = true;")
out.blind = results(batch([item('XNEW', true)]))
out.blind_rows = run('TAB.rows.length')
console.log(JSON.stringify(out))
"""
harness = TMP / "gas-harness.mjs"
harness.write_text(GAS_HARNESS, encoding="utf-8")
proc = subprocess.run(["node", str(harness), str(ROOT)], capture_output=True, text=True, timeout=120)
try:
    gas = json.loads(proc.stdout.strip().splitlines()[-1])
except (ValueError, IndexError):
    gas = {"harness": proc.stdout[-400:] + proc.stderr[-400:]}
check("review 7: two executions over the same texts make one row each, and the ear hears each reply once",
      gas.get("overlap") == "X1=filed X2=already X3=already" and gas.get("overlap_rows") == "X1,X2,X3"
      and sorted(str(gas.get("overlap_ear")).split(",")) == ["X1", "X2", "X3"], gas)
check("review 4: the batch's window alone misses a text older than 2,000 rows (the hole) ...",
      gas.get("window_only") == "XOLD=filed", gas)
check("review 4: ... and a re-offered one is looked up in every row and answered already",
      gas.get("recheck") == "XOLD=already" and gas.get("recheck_rows") == 2401, gas)
check("review 8: a tab that could not be opened is unknown (null), never an empty set",
      gas.get("snap_when_closed") is True, gas)
check("review 8: so a batch re-sent over three filed texts asks per event and files none of them again",
      gas.get("unreadable") == "X1=already X2=already X3=already" and gas.get("unreadable_rows") == "X1,X2,X3"
      and gas.get("unreadable_ear") == "", gas)
check("review 4: a re-offered text the tab cannot be read for is kept (error), never filed blind",
      gas.get("blind") == "XNEW=error" and gas.get("blind_rows") == 3, gas)

# ═══ the relay's glue, read where it cannot be imported ═══════════════════
door = relay_source("quo_webhook")
check("the hotline's branch stays first, the inbox second, and no key is asked of Apps Script",
      0 < door.index("_quo_hotline_keys()") < door.index("quo_inbox.webhook_keys()")
      and "_quo_keys" not in door and "_post_exec" not in door, door[:200])
event_door = relay_source("_quo_messages_event")
check("the inbox door never waits on Apps Script, and a disk that refused is a 503",
      "_post_exec" not in event_door and "quo_inbox.accept_webhook" in event_door
      and "503" in event_door and "asyncio.to_thread" in event_door)
handoff = relay_source("_quo_handoff_once")
check("the hand-off asks Python's quoIngestBatch, its answer back into the inbox, and needs no exec URL",
      "env = await _quo_ingest_python(batch)" in handoff and "quo_inbox.after_batch" in handoff
      and "EXEC_URL" not in handoff and '_backend_pass(QUO_APP, "quoIngestBatch"' in relay_source("_quo_ingest_python"))
start = relay_source("_start")
check("both loops are started with the relay, the inbox read first",
      start.index("quo_inbox.prepare()") < start.index("_quo_handoff_loop()")
      and "_quo_pull_loop()" in start)

# ═══ the keys on disk alone verify an event, and nothing waits on Apps Script ═══
import asyncio  # noqa: E402
import threading  # noqa: E402
import types  # noqa: E402


class Answer:
    def __init__(self, content="", status_code=200, media_type=None):
        self.status_code, self.body = status_code, json.loads(content or "{}")


class Asked:
    def __init__(self, raw, header):
        self.raw, self.headers = raw, {"openphone-signature": header}

    async def body(self):
        return self.raw


door_said = {"kept": [], "posts": [], "keys": []}
file_key = base64.b64encode(secrets.token_bytes(32)).decode()


async def kept_event(raw, header):
    door_said["kept"].append(raw)
    return "KEPT"


async def no_post(*_a, **_k):
    door_said["posts"].append(_a)
    raise AssertionError("the webhook door waited on Apps Script")


webhook = relay_live("quo_webhook", {
    "_quo_hotline_keys": lambda: [],
    "quo_inbox": types.SimpleNamespace(webhook_keys=lambda: list(door_said["keys"])),
    "_quo_signature_ok": signature_ok, "_quo_messages_event": kept_event,
    "_quo_hotline_event": kept_event, "_post_exec": no_post, "Response": Answer, "json": json,
    "log": logging.getLogger("hub.test")})
body = json.dumps({"type": "call.transcript.completed", "data": {"object": {"callId": "ACold1"}}}).encode()
stamp_ms = int(time.time() * 1000)
door_said["keys"] = [file_key]
got = asyncio.run(webhook(Asked(body, sign(body, file_key, stamp_ms))))
check("an event the messages key file signed is kept in the inbox, never posted to Apps Script",
      got == "KEPT" and door_said["kept"] == [body] and not door_said["posts"], (got, door_said))
door_said["kept"].clear()
got = asyncio.run(webhook(Asked(body, sign(body, base64.b64encode(secrets.token_bytes(32)).decode(), stamp_ms))))
check("... one no key on disk signed is a 401, kept nowhere, and no key is asked of Apps Script",
      isinstance(got, Answer) and got.status_code == 401 and not door_said["kept"] and not door_said["posts"],
      getattr(got, "body", got))
door_said["keys"] = []
got = asyncio.run(webhook(Asked(body, sign(body, file_key, stamp_ms))))
check("... and with no key file readable it is a 503, so Quo delivers it again", isinstance(got, Answer)
      and got.status_code == 503 and not door_said["kept"] and not door_said["posts"], getattr(got, "body", got))
check("the old door's synchronous filing is gone, and with it the rows sourced 'yes'",
      "_post_exec" not in relay_source("quo_webhook") and '"verified"' not in relay_source("quo_webhook"))

# ═══ the calls door never blocks the relay's one loop ═════════════════════
MAIN = threading.main_thread()
door_log = []


def blocking(name, value=None):
    def fn(*a, **k):
        door_log.append((name, threading.current_thread() is MAIN))
        return value(*a, **k) if callable(value) else value
    return fn


feed = types.SimpleNamespace(
    ready=blocking("ready", {"key": True, "enabled": True, "why": []}),
    door=lambda: "POST", deliver=blocking("deliver", {"landed": 1}),
    reading=blocking("reading", types.SimpleNamespace(fits=lambda n: True, caller_digits=lambda v: "3305550101")),
    who=blocking("who", {}), read_one=blocking("read_one", {"state": "read", "items": []}))


class Later:
    def __init__(self):
        self.tasks = []

    def add_task(self, fn, *a):
        self.tasks.append((fn, a))


class Posted:
    def __init__(self, data):
        self.data = data

    async def json(self):
        return self.data


async def build_all(**_k):
    door_log.append(("build_all", threading.current_thread() is MAIN))


async def comm_calls_python(body):
    """The lane's post on Python, as the relay's door hands it to the feed (the feed below never posts)."""
    door_log.append(("python", threading.current_thread() is MAIN))
    return {"status": 200, "data": {}}


ledger = {"row": None}
calls_ns = {"comm_calls_feed": feed, "SERVICE_SECRET": "svc", "hmac": hmac, "PG_DSN": "dsn",
            "_comm_calls_python": comm_calls_python, "COMM_CALLS_APP": "comm-calls",
            "log": logging.getLogger("hub.test"), "asyncio": asyncio, "time": time, "build_all": build_all,
            "_comm_calls_row": blocking("row", lambda r: {"call_id": r["call_id"], "full_transcript": "words"}),
            "_comm_calls_ledger_row": blocking("ledger", lambda cid: ledger["row"])}
calls_door = relay_live("comm_calls_transcript", calls_ns)
calls_ns["_comm_calls_read_and_serve"] = relay_live("_comm_calls_read_and_serve", calls_ns)
record = {"service_secret": "svc", "record": {"call_id": "ACdoor", "full_transcript": "words"}}


async def door_story():
    out = {}
    later = Later()
    out["accepted"] = await calls_door(Posted(record), later)
    for fn, a in later.tasks:
        await fn(*a)
    out["log"] = list(door_log)
    door_log.clear()
    ledger["row"] = {"call_id": "ACdoor", "state": "read", "facts": None, "landed_at": "2026-09-30T00:00:00Z"}
    out["landed"] = await calls_door(Posted(record), Later())
    out["landed_log"] = list(door_log)
    door_log.clear()
    feed.ready = blocking("ready", {"key": True, "enabled": False, "why": ["off"]})
    out["off"] = await calls_door(Posted(record), Later())
    out["off_log"] = list(door_log)
    return out


told = asyncio.run(door_story())
on_loop = [n for n, main in told["log"] + told["landed_log"] + told["off_log"] if main and n != "build_all"]
check("the calls door: every database read, model read and delivery runs off the event loop",
      on_loop == [] and [n for n, _m in told["log"]] == ["ready", "row", "ledger", "reading", "who", "read_one",
                                                          "deliver", "build_all"], told)
check("... a landed call is recognised as done by its landing stamp and only delivered, never read again",
      told["landed"]["data"].get("already") == "read" and [n for n, _m in told["landed_log"]]
      == ["ready", "row", "ledger", "deliver"], told)
check("... and with the lane's switch off the door reads nothing",
      told["off"]["data"].get("why") == "the switch is off" and [n for n, _m in told["off_log"]] == ["ready"], told)
check("the ledger's row carries the landing stamp the door asks for",
      "landed_at from comm_call_reads" in relay_source("_comm_calls_ledger_row"))

# ═══ a texted temporary password is never kept ═════════════════════════════
fresh_inbox("temp-password")
TEMP_PW = "Ab3dEfGh2jKm"
RESET_TEXT = (f"ASA MyLife: your temporary password is {TEMP_PW}. "
              "Sign in at https://asamylife.asalifecare.com and choose a new one.")
out_hook = webhook_received(mid="ACtest0000000000000000000000000077", text=RESET_TEXT)
out_hook["type"] = "message.delivered"
out_hook["data"]["object"]["direction"] = "outgoing"
before_hook = json.dumps(out_hook, sort_keys=True)
at = ohio(2026, 3, 2)
said_hook = qi.append(out_hook, "webhook", at)
out_pull = qp.wrap(api_message(mid="ACtest0000000000000000000000000078", text=RESET_TEXT,
                               direction="outgoing", status="delivered"), PN)
said_pull = qi.append(out_pull, "pull", at)
kept = {line["id"]: line for line in lines_on_disk(qi.day_of(at))}
hook_words = kept.get("ACtest0000000000000000000000000077", {}).get("event", {}).get("data", {}).get("object", {}).get("text", "")
pull_words = kept.get("ACtest0000000000000000000000000078", {}).get("event", {}).get("data", {}).get("object", {}).get("text", "")
check("temporary password: a webhook's copy keeps the words and withholds the password",
      said_hook == "added" and TEMP_PW not in hook_words
      and "your temporary password is {withheld}. Sign in at" in hook_words, hook_words)
check("temporary password: the pull's copy of the same kind of text withholds it too",
      said_pull == "added" and TEMP_PW not in pull_words and "{withheld}" in pull_words, pull_words)
check("temporary password: nothing on the disk names it, and the caller's own event is left as it was",
      TEMP_PW.encode() not in (qi.INBOX_DIR / f"{qi.day_of(at)}.jsonl").read_bytes()
      and json.dumps(out_hook, sort_keys=True) == before_hook)
check("temporary password: the key is unchanged, so the same text delivered again is a duplicate",
      qi.append(out_hook, "webhook", at) == "duplicate")
plain = webhook_received(mid="ACtest0000000000000000000000000079", text="Your password is safe with us, see you at 9")
check("temporary password: a text without the sentence is kept word for word",
      qi.withhold_secrets(plain) is plain)
check("temporary password: the relay's pattern is the sentence the reset text must keep (PasswordReset.gs)",
      "temporary password is \\{password\\}" in (ROOT / "apps-script" / "PasswordReset.gs").read_text(encoding="utf-8")
      and qi.TEMP_PASSWORD_TEXT.search(RESET_TEXT) is not None)

print(f"\n{results['ok']} ok, {len(results['failed'])} failed")
for name in results["failed"]:
    print("  FAILED:", name)
# the inboxes, keys and state this run made are its own; a failure keeps them to look at
if not results["failed"]:
    shutil.rmtree(TMP, ignore_errors=True)
sys.exit(1 if results["failed"] else 0)
