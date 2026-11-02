#!/usr/bin/env python3
"""
THE BACKFILL, asserted offline against a fake Quo API.

WHAT IT PROVES. tools/quo_backfill.py asks Quo for exactly the window it was
given and keeps nothing outside it; it pages every listing to the end and
waits out a 429; a text any store already holds (the texts house column, a
kept or zipped inbox day, a spool not fed yet) is counted `stored` and never
spooled again, a text listed twice counts once, and a sent text never
delivered is skipped exactly as the live pull skips it. A dry-run writes
nothing anywhere. --apply writes one 0600 spool of webhook-shaped events,
oldest first, and refuses a plan with holes or a second spool. The relay's
feed (quo_inbox.feed_backfill) keeps them a few at a time behind the live
queue, as `backfill` and `recheck`, once each across a crash; and Quo.gs,
run in node, files recovered history without letting the reply ear or the
calls lane hear it.

    python3 tools/test-quo-backfill.py
"""
import ast
import gzip
import hashlib
import importlib.util
import io
import json
import os
import shutil
import stat
import subprocess
import sys
import tempfile
import time
import urllib.request
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve()
ROOT = HERE.parent.parent
SERVER = ROOT / "server"
TMP = Path(tempfile.mkdtemp(prefix="quo-backfill-"))
os.environ.update({
    "HUB_QUO_INBOX_DIR": str(TMP / "inbox"),
    "HUB_QUO_MESSAGES_KEY_FILE": str(TMP / "messages-webhook.key"),
    "HUB_QUO_API_KEY_FILE": str(TMP / "quo-api.key"),
    "HUB_QUO_API_BASE": "https://quo.invalid/v1",
    "HUB_QUO_PULL_GAP_S": "0",
    "HUB_SNAPSHOT_OUT": str(TMP),
    "HUB_BACKFILL_GOOGLE_ENV": str(TMP / "no.env"),
})
sys.path.insert(0, str(SERVER))


def _no_network(*_a, **_k):
    raise AssertionError("the test tried to reach the network")


urllib.request.urlopen = _no_network

import quo_inbox as qi  # noqa: E402
import quo_pull as qp  # noqa: E402

qp._get = _no_network
_spec = importlib.util.spec_from_file_location("quo_backfill", ROOT / "tools" / "quo_backfill.py")
bf = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(bf)

results = {"ok": 0, "failed": []}


def check(name, cond, detail=""):
    if cond:
        results["ok"] += 1
        print(f"ok   {name}")
    else:
        results["failed"].append(name)
        print(f"FAIL {name}{(' — ' + str(detail)[:400]) if detail else ''}")


# ── the fake Quo ───────────────────────────────────────────────────────────
PAGE = 2
LINES = [{"id": "PNA", "number": "+15550000100", "name": "Line A"},
         {"id": "PNB", "number": "+15550000200", "name": "Line B"},
         {"id": "PNC", "number": "+15550000300", "name": "Line C"}]
CONVS = {
    "PNA": [{"id": f"CA{i}", "participants": [f"+1555000{i:04d}"], "updatedAt": "2026-09-01T00:00:00Z"}
            for i in range(5)] + [{"id": "CAgroup", "participants": ["+15550001111", "+15550002222"],
                                   "updatedAt": "2026-06-01T00:00:00Z"},
                                  {"id": "CAempty", "participants": [], "updatedAt": "2026-06-01T00:00:00Z"}],
    "PNB": [{"id": "CB0", "participants": ["+15550009999"], "updatedAt": "2026-07-01T00:00:00Z"}],
    "PNC": [{"id": "CC0", "participants": ["+15550008888"], "updatedAt": "2026-07-01T00:00:00Z"},
            # Quo refuses a thread of more than ten (HTTP 400); this one's last word predates the window
            {"id": "CCbig", "participants": [f"+1555007{i:04d}" for i in range(11)],
             "updatedAt": "2026-07-01T00:00:00Z", "lastActivityAt": "2025-08-06T01:50:29.767Z"}],
}


def msg(mid, at, direction="incoming", status="received", conv="CA0", line="PNA", to="+15550000100"):
    return {"id": mid, "createdAt": at, "updatedAt": at, "direction": direction, "status": status,
            "from": "+15550000000" if direction == "incoming" else to, "to": [to], "text": "t " + mid,
            "phoneNumberId": line, "conversationId": conv, "userId": "US1"}


# per (line, participants) — the API filters by the window; OUTSIDE rides along to prove the tool's own bound
MSGS = {
    ("PNA", ("+15550000000",)): [msg("M-edge-start", "2026-05-01T00:00:00.000Z"),
                                  msg("M-may", "2026-05-15T10:00:00.000Z"),
                                  msg("M-house", "2026-05-20T10:00:00.000Z"),
                                  msg("M-out-ok", "2026-06-02T10:00:00.000Z", "outgoing", "delivered"),
                                  msg("M-out-sent", "2026-06-03T10:00:00.000Z", "outgoing", "sent"),
                                  msg("M-kept", "2026-07-04T10:00:00.000Z"),
                                  msg("M-zipped", "2026-07-05T10:00:00.000Z"),
                                  msg("M-queued", "2026-07-06T10:00:00.000Z"),
                                  msg("M-edge-end", "2026-08-31T23:59:59.999Z")],
    ("PNA", ("+15550000001",)): [msg("M-may", "2026-05-15T10:00:00.000Z", conv="CA1")],   # listed twice
    ("PNA", ("+15550001111", "+15550002222")): [msg("M-group", "2026-06-10T10:00:00.000Z", conv="CAgroup")],
    ("PNB", ("+15550009999",)): [msg("M-b", "2026-08-01T10:00:00.000Z", conv="CB0", line="PNB",
                                     to="+15550000200")],
    ("PNC", ("+15550008888",)): [msg("M-c", "2026-08-02T10:00:00.000Z", conv="CC0", line="PNC",
                                     to="+15550000300")],
}
OUTSIDE = [msg("M-before", "2026-04-30T23:59:59.999Z"), msg("M-after", "2026-09-01T00:00:00.000Z")]
CALLS = {
    ("PNA", "+15550000000"): [
        {"id": "AC-new", "createdAt": "2026-06-05T10:00:00.000Z", "status": "completed", "duration": 60,
         "direction": "incoming", "participants": ["+15550000000"], "phoneNumberId": "PNA"},
        {"id": "AC-house", "createdAt": "2026-06-06T10:00:00.000Z", "status": "completed", "duration": 60,
         "direction": "incoming", "participants": ["+15550000000"], "phoneNumberId": "PNA"},
        {"id": "AC-none", "createdAt": "2026-06-07T10:00:00.000Z", "status": "completed", "duration": 30,
         "direction": "outgoing", "participants": ["+15550000000"], "phoneNumberId": "PNA"},
        {"id": "AC-missed", "createdAt": "2026-06-08T10:00:00.000Z", "status": "missed", "duration": 0,
         "direction": "incoming", "participants": ["+15550000000"], "phoneNumberId": "PNA"},
        {"id": "AC-late", "createdAt": "2026-09-02T10:00:00.000Z", "status": "completed", "duration": 60,
         "direction": "incoming", "participants": ["+15550000000"], "phoneNumberId": "PNA"}],
}
TRANSCRIPTS = {"AC-new": {"callId": "AC-new", "createdAt": "2026-06-05T10:05:00.000Z", "duration": 58.2,
                          "status": "completed",
                          "dialogue": [{"content": "hello", "identifier": "+15550000000", "start": 0, "end": 1}]}}


class FakeQuo:
    def __init__(self, limit_once=("/conversations",)):
        self.asked = []
        self.limit_once = set(limit_once)

    def __call__(self, path, params):
        self.asked.append((path, list(params)))
        if path in self.limit_once:
            self.limit_once.discard(path)
            raise qp.RateLimited(f"429 on {path}")
        get = lambda k: [v for n, v in params if n == k]  # noqa: E731
        token = int((get("pageToken") or ["0"])[0])
        if path == "/phone-numbers":
            items = LINES
        elif path == "/conversations":
            items = [c for c in CONVS.get(get("phoneNumbers[]")[0], [])
                     if c["updatedAt"] >= get("updatedAfter")[0][:10]]
        elif path == "/messages":
            if len(get("participants[]")) > 10:
                raise qp.PullError("HTTP 400 on /messages", 400)
            lo, hi = get("createdAfter")[0], get("createdBefore")[0]
            items = [m for m in MSGS.get((get("phoneNumberId")[0], tuple(get("participants[]"))), [])
                     if lo <= m["createdAt"] < hi]
            if get("participants[]") == ["+15550000000"]:
                items = items + OUTSIDE
        elif path == "/calls":
            lo, hi = get("createdAfter")[0], get("createdBefore")[0]
            items = [c for c in CALLS.get((get("phoneNumberId")[0], get("participants[]")[0]), [])
                     if lo <= c["createdAt"] < hi] + [c for c in CALLS.get(
                         (get("phoneNumberId")[0], get("participants[]")[0]), []) if c["id"] == "AC-late"]
        elif path.startswith("/call-transcripts/"):
            cid = path.rsplit("/", 1)[1]
            if cid not in TRANSCRIPTS:
                raise qp.PullError(f"HTTP 404 on {path}", 404)
            return {"data": TRANSCRIPTS[cid]}
        else:
            raise AssertionError(f"unexpected {path}")
        page = items[token * PAGE:(token + 1) * PAGE]
        more = (token + 1) * PAGE < len(items)
        return {"data": page, "nextPageToken": str(token + 1) if more else None}


class FakeSheets:
    def __init__(self, texts, calls):
        self.cols = {("texts", "message_id"): texts, ("calls", "call_id"): calls}
        self.asked = []

    def column(self, sheet_id, tab, header):
        self.asked.append((sheet_id, tab, header))
        return list(self.cols[(sheet_id, header)])


# ── the stores ─────────────────────────────────────────────────────────────
INBOX = TMP / "inbox"
INBOX.mkdir(mode=0o700)


def inbox_line(ev, source="pull"):
    k = qi.event_key(ev)
    return {"id": k[0], "type": k[1], "received_at": "2026-09-20T00:00:00.000Z", "source": source,
            "event": ev, "drained_at": "2026-09-20T00:01:00.000Z", "tries": 0, "last_error": None,
            "retry_at": None, "outcome": "filed", "recheck": False}


kept_ev = qp.wrap(MSGS[("PNA", ("+15550000000",))][5], "PNA")
zipped_ev = qp.wrap(MSGS[("PNA", ("+15550000000",))][6], "PNA")
queued_ev = qp.wrap(MSGS[("PNA", ("+15550000000",))][7], "PNA")
(INBOX / "2026-09-20.jsonl").write_bytes(qi._encode(inbox_line(kept_ev)))
(INBOX / "2026-09-19.jsonl.gz").write_bytes(gzip.compress(qi._encode(inbox_line(zipped_ev))))
(INBOX / bf.SPOOL).mkdir(mode=0o700)
(INBOX / bf.SPOOL / "20260920T000000Z-queued.jsonl").write_bytes(qi._encode(queued_ev))


def tree(root):
    out = {}
    for p in sorted(root.rglob("*")):
        st = p.lstat()
        out[str(p.relative_to(root))] = (stat.S_IMODE(st.st_mode), st.st_size, st.st_mtime_ns,
                                         hashlib.sha256(p.read_bytes()).hexdigest() if p.is_file() else "")
    return out


def run(argv, fake=None, sheets=None):
    fake = fake or FakeQuo()
    slept = []
    quo = bf.Quo(get=fake, sleep=slept.append)
    sheets = sheets or FakeSheets(["M-house", "SOMETHING-ELSE"], ["AC-house"])
    out, err = io.StringIO(), io.StringIO()
    with redirect_stdout(out), redirect_stderr(err):
        try:
            code = bf.main(argv, quo=quo, sheets=sheets, now=1_790_000_000.0)
        except SystemExit as exc:
            code = f"exit: {exc}"
    return code, out.getvalue(), fake, quo, slept, sheets


BASE = ["--since", "2026-05-01", "--until", "2026-08-31", "--inbox-dir", str(INBOX),
        "--texts-house", "texts", "--calls-house", "calls"]

# ═══ the window ════════════════════════════════════════════════════════════
check("--until is a whole day, included: the window ends at the next midnight UTC",
      qi._iso(bf.bound("2026-08-31", end=True).timestamp()) == "2026-09-01T00:00:00.000Z"
      and qi._iso(bf.bound("2026-05-01").timestamp()) == "2026-05-01T00:00:00.000Z")
check("an ISO instant is taken as given",
      qi._iso(bf.bound("2026-06-01T12:00:00Z", end=True).timestamp()) == "2026-06-01T12:00:00.000Z")

# ═══ the dry-run ═══════════════════════════════════════════════════════════
before = tree(INBOX)
code, out, fake, quo, slept, sheets = run(BASE + ["--calls", "--json", str(TMP / "counts.json")])
after = tree(INBOX)
check("the dry-run writes nothing in the inbox — no day, no state, no spool", before == after,
      set(after) ^ set(before))
check("... and says so", "DRY-RUN: nothing was written" in out and code == 0, out[-400:])
counts = json.loads((TMP / "counts.json").read_text())
T = counts["texts"]
tot = {c: sum(r[c] for r in T.values()) for c in ("quo", "not_delivered", "stored", "add")}

msg_asks = [p for path, p in fake.asked if path == "/messages"]
check("every thread is asked for exactly the window: createdAfter the start, createdBefore the next midnight",
      msg_asks and all(("createdAfter", "2026-05-01T00:00:00.000Z") in p
                       and ("createdBefore", "2026-09-01T00:00:00.000Z") in p for p in msg_asks), msg_asks[:2])
check("threads are listed by activity since the start (a thread quiet since before it holds nothing)",
      all(("updatedAfter", "2026-05-01T00:00:00.000Z") in p for path, p in fake.asked if path == "/conversations"))
check("a message the API hands back outside the window is not counted (both edges)",
      tot["quo"] + tot["not_delivered"] == 12 and "M-before" not in json.dumps(counts)
      and T["PNA|2026-05"]["quo"] == 3 and T["PNA|2026-08"]["quo"] == 1, T)
check("the first instant of the window and the last millisecond of its last day are in it",
      T["PNA|2026-05"]["add"] == 2 and T["PNA|2026-08"]["add"] == 1, T)
check("a text two threads list is counted once", T["PNA|2026-05"]["quo"] == 3, T["PNA|2026-05"])
check("a sent text never delivered is skipped, as the live pull skips it",
      T["PNA|2026-06"]["not_delivered"] == 1 and T["PNA|2026-06"]["quo"] == 2, T["PNA|2026-06"])
check("stored: the texts house column, a kept day, a zipped day and an unfinished spool all count",
      T["PNA|2026-05"]["stored"] == 1 and T["PNA|2026-07"]["stored"] == 3 and T["PNA|2026-07"]["add"] == 0, T)
check("the totals: 11 texts in Quo, 4 stored, 7 to add",
      tot == {"quo": 11, "not_delivered": 1, "stored": 4, "add": 7} and counts["would_add"] == 8, (tot, counts))
asked_threads = {tuple(v for n, v in p if n == "participants[]") for p in msg_asks if ("phoneNumberId", "PNA") in p}
check("a group thread is asked with all its participants, and a thread with none is never asked",
      T["PNA|2026-06"]["add"] == 2 and ("+15550001111", "+15550002222") in asked_threads
      and len(asked_threads) == 6 and () not in asked_threads, asked_threads)

check("a thread quiet since before the window is never asked (Quo refuses one of more than ten), "
      "so it leaves no hole", counts["failures"] == []
      and not any(len([v for n, v in p if n == "participants[]"]) > 10 for p in msg_asks), counts["failures"])

# paging and the 429
conv_asks = [p for path, p in fake.asked if path == "/conversations" and ("phoneNumbers[]", "PNA") in p]
check("the threads of a line are paged to the end (7 threads, pages of 2 → 4 asks, tokens 1..3)",
      [dict(p).get("pageToken") for p in conv_asks[1:]] == [None, "1", "2", "3"], conv_asks)
check("the 429 was waited out and asked again, not taken as the end",
      quo.limited == 1 and 1.0 in slept and T.get("PNB|2026-08", {}).get("add") == 1, (quo.limited, slept[:3]))
check("the messages of a thread are paged too (9 in the window + 2 outside → 6 pages)",
      len([p for p in msg_asks if ("participants[]", "+15550000000") in p]) == 6)

# calls
C = counts["calls"]
check("calls: one transcript to add, one already in the calls house, one Quo has none of (404), "
      "one never asked (missed), one outside the window not counted",
      C == {"PNA|2026-06": {"calls": 4, "stored": 1, "no_transcript": 2, "add": 1}}, C)
tr_asks = [path for path, _ in fake.asked if path.startswith("/call-transcripts/")]
check("a transcript is asked only for a completed call no store holds",
      sorted(tr_asks) == ["/call-transcripts/AC-new", "/call-transcripts/AC-none"], tr_asks)
check("calls are asked only for one-to-one threads",
      all(len([v for n, v in p if n == "participants[]"]) == 1 for path, p in fake.asked if path == "/calls")
      and not any(("participants[]", "+15550001111") in p for path, p in fake.asked if path == "/calls"))
check("the houses are read by their key column, and the calls house only with --calls",
      sheets.asked == [("texts", "Data", "message_id"), ("calls", "Data", "call_id")], sheets.asked)
code2, _o, _f, _q, _s, sheets2 = run(BASE)
check("without --calls no call is asked and the calls house is not read",
      not any(p == "/calls" for p, _ in _f.asked) and sheets2.asked == [("texts", "Data", "message_id")])

narrow = bf.plan(bf.Quo(get=FakeQuo(()), sleep=lambda s: None), bf.bound("2026-05-01"),
                 bf.bound("2026-08-31", True), only={"PNB"}, calls=False, house_texts=set(),
                 house_calls=set(), kept=set(), queued=set())
check("--line narrows to that line", set(narrow["texts"]) == {("PNB", "2026-08")}, narrow["texts"])

# ═══ --apply ═══════════════════════════════════════════════════════════════
code, out, *_ = run(BASE + ["--calls", "--apply"])
check("--apply refuses while an unfinished spool waits", str(code).startswith("exit: refused"), code)
# the relay fed that spool whole: its text now sits in a kept day, the spool retired
(INBOX / bf.SPOOL / "20260920T000000Z-queued.jsonl").rename(INBOX / bf.SPOOL / "20260920T000000Z-queued.jsonl.done")
with open(INBOX / "2026-09-20.jsonl", "ab") as fh:
    fh.write(qi._encode(inbox_line(queued_ev, "backfill")))
days_before = {k: v for k, v in tree(INBOX).items() if not k.startswith(bf.SPOOL)}


class Holey(FakeQuo):
    def __call__(self, path, params):
        if path == "/messages" and ("participants[]", "+15550009999") in params:
            raise qp.PullError("HTTP 500 on /messages", 500)
        return super().__call__(path, params)


code, out, *_ = run(BASE + ["--apply"], fake=Holey())
check("--apply writes nothing from a plan with holes", code == 2 and "NOT APPLIED" in out
      and not list((INBOX / bf.SPOOL).glob("*.jsonl")), (code, out[-300:]))
code, out, *_ = run(BASE + ["--calls", "--apply"])
spools = list((INBOX / bf.SPOOL).glob("*.jsonl"))
check("--apply writes one spool, and says where", code == 0 and len(spools) == 1 and "APPLIED: 8 events" in out,
      (code, out[-300:]))
check("the spool is 0600 in a 0700 directory",
      spools and stat.S_IMODE(spools[0].stat().st_mode) == 0o600
      and stat.S_IMODE((INBOX / bf.SPOOL).stat().st_mode) == 0o700)
spooled = [json.loads(x) for x in spools[0].read_text().splitlines()] if spools else []
ids = [qi.event_key(e)[0] for e in spooled]
check("it holds exactly what no store holds, oldest first",
      ids == ["M-edge-start", "M-may", "M-out-ok", "AC-new", "M-group", "M-b", "M-c", "M-edge-end"], ids)
check("a text is the pull's own event, field for field",
      spooled and spooled[0] == qp.wrap(MSGS[("PNA", ("+15550000000",))][0], "PNA"), spooled[:1])
tr = next((e for e in spooled if e["type"] == "call.transcript.completed"), {})
check("a transcript is the webhook's event, keyed by its call, with the call's line and participants",
      qi.event_key(tr) == ("AC-new", "call.transcript.completed")
      and tr["data"]["object"]["phoneNumberId"] == "PNA" and tr["data"]["object"]["participants"] == ["+15550000000"]
      and tr["data"]["object"]["dialogue"][0]["content"] == "hello", tr)
check("the inbox's days and state were not touched by --apply",
      {k: v for k, v in tree(INBOX).items() if not k.startswith(bf.SPOOL)} == days_before)
code, out, *_ = run(BASE + ["--calls"])
check("run again, everything spooled counts as stored: nothing more to add",
      "--apply would spool 0 events" in out, out[-300:])

# ═══ the relay's feed (quo_inbox.feed_backfill) ════════════════════════════
FEED_DIR = TMP / "feed"
qi.forget()
qi.INBOX_DIR = FEED_DIR / "inbox"
qi.STATE_FILE = qi.INBOX_DIR / ".state.json"
qi.SPOOL_DIR = qi.INBOX_DIR / ".backfill"
qi.SPOOL_FEED, qi.SPOOL_HOLD = 25, 25
qi.INBOX_DIR.mkdir(parents=True)
NOW = time.time()
live = qp.wrap(msg("LIVE-1", "2026-09-29T10:00:00.000Z"), "PNA")
qi.append_many([live], "webhook", NOW)
check("no spool, nothing fed", qi.feed_backfill(NOW)["fed"] == 0 and qi.backlog() == 1)
hist = [qp.wrap(msg(f"H{i:03d}", f"2026-06-01T10:{i // 60:02d}:{i % 60:02d}.000Z"), "PNA") for i in range(60)]
qi.SPOOL_DIR.mkdir(mode=0o700)
spool = qi.SPOOL_DIR / "run.jsonl"
qi._write_atomic(spool, b"".join(qi._encode(e) for e in hist) + b"not json\n")
said = qi.feed_backfill(NOW)
fed_lines = [x for lines in qi._DAYS.values() for x in lines if x["source"] == "backfill"]
check("a feed keeps at most SPOOL_FEED events, as `backfill`, each marked recheck",
      said["fed"] == 25 and said["added"] == 25 and len(fed_lines) == 25
      and all(x["recheck"] for x in fed_lines), said)
check("... behind the live text already waiting",
      [o["id"] for o in qi.pending(NOW, limit=2)] == ["LIVE-1", "H000"])
check("with SPOOL_HOLD lines waiting, the next feed holds", qi.feed_backfill(NOW)["held"] is True
      and qi.backlog() == 26)


def drain_all():
    offer = qi.pending(NOW, limit=1000)
    qi.after_batch(offer, {"status": 200, "data": {"results": [
        {"id": o["id"], "type": o["type"], "result": "filed"} for o in offer]}}, None, NOW)


drain_all()
check("once drained, the feed goes on from where it stopped",
      qi.feed_backfill(NOW)["added"] == 25 and qi._spool_offset(spool) > 0)
mark = json.loads(qi._spool_mark(spool).read_text())
qi._write_atomic(qi._spool_mark(spool), json.dumps({"offset": 0}).encode())
drain_all()
again = qi.feed_backfill(NOW)
check("a relay stopped before the mark moved offers them again, and the index keeps each once",
      again["added"] == 0 and again["duplicate"] == 25
      and len([x for lines in qi._DAYS.values() for x in lines if x["source"] == "backfill"]) == 50, again)
qi._write_atomic(qi._spool_mark(spool), json.dumps(mark).encode())
drain_all()
last = qi.feed_backfill(NOW)
check("the last feed takes the rest (a line that is not JSON counted invalid, never kept) and retires the spool",
      last["added"] == 10 and last["invalid"] == 1 and last["finished"] is True
      and not spool.exists() and (qi.SPOOL_DIR / "run.jsonl.done").exists()
      and not qi._spool_mark(spool).exists(), last)
check("a retired spool is never fed again", qi.feed_backfill(NOW)["fed"] == 0 and not qi.spool_pending())
check("the counters say what the backfill kept", qi.stats()["counters"].get("backfill_added") == 60, qi.stats())
check("the ears' globs never see a spool (it lives in a dot directory, not beside the days)",
      not any(p.parent == qi.SPOOL_DIR for p in qi.INBOX_DIR.glob("*.jsonl")))


def relay_source(name):
    src = (SERVER / "snapshot_service.py").read_text(encoding="utf-8")
    for node in ast.parse(src).body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == name:
            return ast.get_source_segment(src, node) or ""
    return ""


loop = relay_source("_quo_handoff_loop")
check("the hand-off loop feeds the backfill before each hand-off",
      0 < loop.index("await _quo_backfill_feed()") < loop.index("_quo_handoff_once()"), loop[-600:])


def relay_async(name, ns):
    src = (SERVER / "snapshot_service.py").read_text(encoding="utf-8")
    for node in ast.parse(src).body:
        if isinstance(node, ast.AsyncFunctionDef) and node.name == name:
            exec(compile(ast.Module(body=[node], type_ignores=[]), f"snapshot_service.py:{name}", "exec"), ns)
            return ns[name]
    raise AssertionError(f"{name} is not in snapshot_service.py")


class _Broken:
    calls = 0

    @staticmethod
    def feed_backfill(now):
        _Broken.calls += 1
        raise PermissionError("spool")


class _Log:
    def __init__(self):
        self.said = []

    def warning(self, *a):
        self.said.append(("warning", a[0] % a[1:]))

    def info(self, *a):
        self.said.append(("info", a[0] % a[1:]))


import asyncio  # noqa: E402

_log = _Log()
feed_ns = {"asyncio": asyncio, "time": time, "quo_inbox": _Broken, "log": _log, "Any": object,
           "_QUO_BACKFILL_SAID": {"key": None, "at": 0.0}, "QUO_HANDOFF_SAY_EVERY_S": 3600.0}
feed = relay_async("_quo_backfill_feed", feed_ns)
raised = None
try:
    asyncio.run(feed())
    asyncio.run(feed())
except Exception as exc:  # noqa: BLE001
    raised = exc
check("a spool that cannot be fed never raises into the hand-off, and is said once an hour, not each pass",
      raised is None and _Broken.calls == 2
      and [k for k, _ in _log.said] == ["warning"] and "live hand-off goes on" in _log.said[0][1], (raised, _log.said))

# ═══ Quo.gs: history is filed, never heard ═════════════════════════════════
GAS = r"""
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
var TAB = { header: ['id', 'message_id'], rows: [], ear: [], kicks: [], calls: [] };
var TABS = { quo_messages: { header: TAB.header, rows: TAB.rows, key: 'message_id' },
             quo_transcripts: { header: ['id', 'call_id'], rows: TAB.calls, key: 'call_id' } };
hubTabSheet_ = function (t) {
  var S = TABS[t];
  if (!S) return null;
  return { getLastRow: function () { return 1 + S.rows.length; },
    getLastColumn: function () { return S.header.length; },
    getRange: function (r, c, n, m) { return {
      getValues: function () { var out = []; for (var i = 0; i < n; i++) { var row = [];
        for (var j = 0; j < m; j++) row.push(r + i === 1 ? S.header[c + j - 1]
          : ((S.rows[r + i - 2] || {})[S.header[c + j - 1]] || '')); out.push(row); } return out; },
      createTextFinder: function (want) { return { matchCase: function () { return this; },
        matchEntireCell: function () { return this; }, findNext: function () {
          return S.rows.some(function (x) { return x[S.key] === want; }) ? {} : null; } }; } }; } };
};
createRow_ = function (res, rec) {
  if (res === 'quoMessages') TAB.rows.push({ id: 'r' + TAB.rows.length, message_id: rec.message_id, source: rec.source });
  else TAB.calls.push({ call_id: rec.call_id, source: rec.source });
  return rec;
};
sheetDbRefused_ = function () { return null; };
commInboundCapture_ = function (m) { TAB.ear.push(m.message_id); };
quoCommCallsKick_ = function (r) { TAB.kicks.push(r.call_id); };
hubSysLog_ = function () {};
`, sandbox)
const run = (code) => vm.runInContext(code, sandbox)
sandbox.svc = run('serviceUser_()')
const ev = (mid) => ({ id: 'pull:' + mid, type: 'message.received', createdAt: '2026-06-01T00:00:00Z',
  data: { object: { id: mid, from: '+15550000001', to: '+15550000002', direction: 'incoming', text: 'yes',
                    status: 'received', createdAt: '2026-06-01T00:00:00Z', phoneNumberId: 'PN1' } } })
const tr = (cid) => ({ id: 'pull:transcript:' + cid, type: 'call.transcript.completed', createdAt: '2026-06-01T00:00:00Z',
  data: { object: { callId: cid, createdAt: '2026-06-01T00:00:00Z', status: 'completed', duration: 3,
                    dialogue: [{ content: 'hi', identifier: '+15550000001' }], phoneNumberId: 'PN1' } } })
const item = (e, source, recheck) => ({ id: e.data.object.id || e.data.object.callId, type: e.type, source: source,
                                        event: e, recheck: !!recheck })
sandbox.P = { events: [item(ev('HIST'), 'backfill', true), item(ev('LIVE'), 'pull', false),
                       item(tr('ACHIST'), 'backfill', true), item(tr('ACLIVE'), 'webhook', false)] }
const out = {}
out.results = run('HUB_ACTIONS.quoIngestBatch(P, svc)').data.results.map((x) => x.id + '=' + x.result).join(' ')
out.rows = run("TAB.rows.map(function (r) { return r.message_id + ':' + r.source; })").join(',')
out.ear = run('TAB.ear').join(',')
out.calls = run("TAB.calls.map(function (r) { return r.call_id + ':' + r.source; })").join(',')
out.kicks = run('TAB.kicks').join(',')
sandbox.P = { events: [item(ev('HIST'), 'backfill', true), item(tr('ACHIST'), 'backfill', true)] }
out.again = run('HUB_ACTIONS.quoIngestBatch(P, svc)').data.results.map((x) => x.id + '=' + x.result).join(' ')
out.calls_after = run('TAB.calls.length')
console.log(JSON.stringify(out))
"""
harness = TMP / "gas-harness.mjs"
harness.write_text(GAS, encoding="utf-8")
proc = subprocess.run(["node", str(harness), str(ROOT)], capture_output=True, text=True, timeout=120)
try:
    gas = json.loads(proc.stdout.strip().splitlines()[-1])
except (ValueError, IndexError):
    gas = {"harness": proc.stdout[-400:] + proc.stderr[-400:]}
check("Quo.gs files recovered history like any text, as relay:backfill",
      gas.get("results") == "HIST=filed LIVE=filed ACHIST=filed ACLIVE=filed"
      and gas.get("rows") == "HIST:relay:backfill,LIVE:relay:pull"
      and gas.get("calls") == "ACHIST:relay:backfill,ACLIVE:relay:webhook", gas)
check("... but the reply ear hears only the live text: an old YES never settles what is open today",
      gas.get("ear") == "LIVE", gas)
check("... and only the live transcript is handed to the calls lane", gas.get("kicks") == "ACLIVE", gas)
check("a re-offered history text and transcript are looked up in every row and answered already",
      gas.get("again") == "HIST=already ACHIST=already" and gas.get("calls_after") == 2, gas)

print(f"\n{results['ok']} ok, {len(results['failed'])} failed")
for name in results["failed"]:
    print("  FAILED:", name)
if not results["failed"]:
    shutil.rmtree(TMP, ignore_errors=True)
sys.exit(1 if results["failed"] else 0)
