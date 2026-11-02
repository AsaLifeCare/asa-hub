#!/usr/bin/env python3
"""Smart Comms' send core (app/smart_comms.py) in asa-hub-db-sync with the modules streamed in: every early return and
brake of smartTell_ and rpcCall_ in Apps Script's order, the idempotent repeat, test mode and the send switch holding on
missing, blank, unknown and unread, the absent arm, the drain, and one raise and one drain on the live copy. Render,
prune, the sendable number, the quiet window's edges and the provider's line pick are compared with the .gs functions
themselves run in node. A fake transport stands in for the provider and a socket guard proves nothing opens a
connection. Every write goes to temporary tables inside one transaction rolled back. Prints names, counts and states,
never a number, an address or a message's words."""
from __future__ import annotations

import base64
import json
import py_compile
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RUNNER = "asa-hub-db-sync"
# the .gs files the compared functions live in, loaded together as Apps Script loads a project
GS_FILES = ("Main", "SheetDb", "HubCore", "Talent", "Packet", "Rpc", "SmartGate", "SmartComms", "CommMock",
            "AlertsConfig", "OptOut", "LineDirectory")

DRIVER = r'''
import base64, importlib.abc, importlib.util, json, os, re, socket, sys, time, uuid
from datetime import datetime
from zoneinfo import ZoneInfo
blob = json.loads(base64.b64decode(sys.stdin.readline()).decode())
SRC = blob["app"]


class Checkout(importlib.abc.MetaPathFinder, importlib.abc.Loader):
    def find_spec(self, name, path, target=None):
        return importlib.util.spec_from_loader(name, self, origin="checkout:" + name) if name in SRC else None

    def create_module(self, spec):
        return None

    def exec_module(self, module):
        module.__file__ = module.__name__ + ".py"
        exec(compile(SRC[module.__name__], module.__name__ + ".py", "exec"), module.__dict__)


sys.meta_path.insert(0, Checkout())
os.environ.pop("HUB_SMART_COMMS_KEY_FILE", None)
import psycopg
import gsjs, hubdb, writes as W
import smart_comms as SC

out, facts, js = [], {}, {}


def check(name, ok, detail=""):
    out.append([name, bool(ok), "" if ok else str(detail)[:300]])


NY = ZoneInfo("America/New_York")


def ny(y, mo, d, h, mi):
    return datetime(y, mo, d, h, mi, tzinfo=NY).timestamp()


DAY = ny(2026, 10, 14, 14, 0)
NIGHT = ny(2026, 10, 14, 22, 0)
MORNING = ny(2026, 10, 15, 8, 0)
SMILE = chr(0x1F600)

# the stores and both locks the check's own: nothing it holds can stall a live write
SC.OUTBOX, SC.ARM = "pg_temp.scm_outbox", "pg_temp.scm_arm"
W.EDITS_TABLE = "pg_temp.scm_edits"
# the test-mode logs' own tables (comm_logs), stand-ins too
CL = SC.comm_logs
CL.TABLES = {CL.MOCK: "pg_temp.scm_comm_mock", CL.REHEARSAL: "pg_temp.scm_comm_rehearsal"}
CL.SEQ = "pg_temp.scm_comm_test_seq"
W.LOCK_KEY = 0x53434D434845
SC.DRAIN_LOCK = 0x53434D445241

live = hubdb.HubDb()
live.catalog()
real = psycopg.connect(hubdb._dsn(), autocommit=False, connect_timeout=5, application_name="smart-comms-check")

# ---- the socket guard: armed once every database connection is open ----
OPENED = []
_orig = (socket.socket.connect, socket.socket.connect_ex, socket.create_connection, socket.getaddrinfo)


def _refuse(kind):
    def f(*a, **kw):
        OPENED.append(kind)
        raise OSError("the check opens no connection")
    return f


socket.socket.connect = _refuse("connect")
socket.socket.connect_ex = _refuse("connect_ex")
socket.create_connection = _refuse("create_connection")
socket.getaddrinfo = _refuse("getaddrinfo")
try:
    socket.create_connection(("127.0.0.1", 9), timeout=1)
except OSError:
    pass
check("the socket guard refuses and records an attempt", OPENED == ["create_connection"], OPENED)
OPENED.clear()


class Fake:
    """A copy of asa-hub-db the check shapes: the houses Smart Comms reads, and the ones it appends to."""
    HOUSES = {"smart_comms": ("FAKE_SIT", "Data"), "entity_opt_outs": ("FAKE_OPT", "Data"),
              "comm_mock": ("FAKE_MOCK", "comm_mock"), "comm_rehearsal": ("FAKE_RH", "comm_rehearsal"),
              "smart_comms_sent": ("FAKE_SENT", "Data"), "rec_house": ("FAKE_REC", "rec_house")}

    def __init__(self):
        self.situations = [base_sit()]
        self.opt_outs = []
        self.cfg = {"test_mode": "off", "messages_paused": "off"}
        self.props = {"HUB_RPC_SEND": "on"}
        self.broken = set()

    def resolve(self, tab):
        if tab in self.broken:
            raise hubdb.Unreadable(f"{tab} is broken for the check")
        if tab not in self.HOUSES:
            return hubdb.Resolved("", (tab,), None, False, False)
        sid, name = self.HOUSES[tab]
        heads = tuple(sorted({k for r in self.situations for k in r})) if tab == "smart_comms" else ("id",)
        return hubdb.Resolved(sid, (tab, "Data"), hubdb.TabRef(sid, name, "t_fake", heads, None, 1), True, True)

    def rows(self, ref):
        return [(i + 2, dict(r)) for i, r in enumerate(self.situations)] if ref.sheet_id == "FAKE_SIT" else []

    def normalized_rows(self, ref):
        return [dict(r) for r in self.opt_outs]

    def query(self, sql, params=None):
        # no resource of the check's is uploaded to Postgres's own rows: the copy's tabs answer
        return []

    def prop(self, key):
        return self.props.get(key, "")

    def hiring_config(self):
        if "config" in self.broken:
            raise hubdb.Unreadable("the config is broken for the check")
        return dict(self.cfg)

    def facts(self):
        if "facts" in self.broken:
            raise hubdb.Unreadable("the facts are broken for the check")
        return {"areas": {"props": dict(self.props)}, "subjects": {}}


def base_sit(**kw):
    row = {"id": "sched_check", "enabled": "yes", "channels": "sms", "sender": "", "from_line": "", "record_to": "",
           "send_at": "", "sms_text": "Hi {first_name}, this is {sender}. Your shift on {day} is {state}."}
    row.update(kw)
    return row


FAKE = Fake()
TO = "+1 (555) 010-0000"
VARS = {"first_name": "Pat", "day": "Monday", "state": "covered"}
SENT = []


def fake_transport(to, body, from_line, lines=None):
    SENT.append({"to": to, "body_chars": len(body), "from_line": from_line})
    return {"ok": True, "sent": True, "gated": False, "receipt": f"FAKE-{len(SENT)}"}


def q(sql, params=None):
    with real.cursor() as c:
        c.execute(sql, params)
        return c.fetchall() if c.description else []


def counts():
    logs = sum(q(f"select count(*) from {t}")[0][0] for t in CL.TABLES.values())
    return q(f"select count(*) from {SC.OUTBOX}")[0][0], q(f"select count(*) from {W.EDITS_TABLE}")[0][0] + logs


def written_by(write_id):
    """The rows a write kept: its kept edits' tabs, and each test log it wrote a row of (tab, the book or the table)."""
    got = {t: s for t, s in q(f"select tab_name, min(sheet_id) from {W.EDITS_TABLE} where write_id = %s"
                              " group by tab_name", (write_id,))}
    for name, t in CL.TABLES.items():
        if q(f"select 1 from {t} where write_id = %s limit 1", (write_id,)):
            got[name] = t
    return got


def rows_of(tab, sid=None):
    """Each appended row of a tab, as {field: value}, oldest first: the test logs from their own tables."""
    if tab in CL.TABLES and sid is None:
        return [r[0] for r in q(f"select cells from {CL.table(tab)} order by seq")]
    got = {}
    for key, field, value in q(f"select row_key, field, value from {W.EDITS_TABLE} where tab_name = %s"
                               " and (%s::text is null or sheet_id = %s) order by id", (tab, sid, sid)):
        got.setdefault(key, {})[field] = value
    return list(got.values())


def outbox(key):
    return SC.outbox_for(real, key)


def arm(on):
    q(f"delete from {SC.ARM}")
    if on is not None:
        q(f"insert into {SC.ARM} (id, armed) values (1, %s)", (on,))


def reset(**cfg):
    """A fresh copy, no arm, and nothing left owed by an earlier case."""
    FAKE.__init__()
    FAKE.cfg.update(cfg)
    arm(None)
    q(f"update {SC.OUTBOX} set state = 'cancelled' where state = 'owed'")


def tell(key, **kw):
    args = {"situation": "sched_check", "to": TO, "vars": VARS, "key": key, "lane": "scheduling", "at_ms": DAY * 1000,
            "now": DAY, "db": FAKE, "door": "check", "write_id": "Wcheck-" + key}
    args.update(kw)
    return SC.raise_situation(real, **args)


SHAPE = {"situation", "state", "held", "why", "receipt", "unreadable"}


def early(name, key, want_state, want_unreadable=False, **kw):
    before = counts()
    got = tell(key, **kw)
    check(f"{name}: {want_state}, nothing written", set(got) == SHAPE and got["state"] == want_state
          and got["unreadable"] is want_unreadable and counts() == before, got)
    return got


def scenarios():
    ensure_why = SC.ensure(real)
    check("ensure() makes the outbox, the arm and the edits", ensure_why == "", ensure_why)

    # ---- the five early returns, in order ----
    reset(test_mode="sheet")
    early("an absent situation", "e1", "off", situation="sched_missing")
    FAKE.broken.add("smart_comms")
    got = early("an unread situations tab", "e2", "off", True)
    check("an unread tab says so", "could not be read" in got["why"], got)
    reset(test_mode="sheet")
    FAKE.situations = [base_sit(enabled="no")]
    early("a situation switched off", "e3", "off")
    FAKE.situations = [base_sit(), base_sit(enabled="no")]
    early("the last duplicate row off wins over an earlier on", "e4", "off")
    FAKE.situations = [base_sit(enabled="no"), base_sit()]
    got = tell("e5")
    check("the last duplicate row on wins over an earlier off", got["state"] == "held" and got["held"] == "test_mode",
          got)
    FAKE.situations = [base_sit(channels="SMS")]
    early("channels 'SMS' (the match is case-sensitive)", "e6", "off")
    FAKE.situations = [base_sit(sms_text="   ")]
    early("blank SMS words", "e7", "off")
    FAKE.situations = [base_sit()]
    early("a shared company line", "e8", "no_phone", to="(330) 919-5558")
    early("nine digits", "e9", "no_phone", to="555010000")
    before = counts()
    got = tell("e10", at_ms=NIGHT * 1000)
    rows = outbox("e10")
    check("the caller's clock at 22:00: held quiet, owed for 08:00, no mock row",
          got["state"] == "held" and got["held"] == "quiet" and got["why"].endswith("— owed at 08:00")
          and len(rows) == 1 and rows[0]["state"] == "owed" and rows[0]["held_by"] == "quiet"
          and abs(rows[0]["due_at"] - MORNING) < 1 and counts()[1] == before[1], [got, rows])
    got = tell("e11", at_ms="not a time")
    check("a caller's clock that is no instant holds (fail closed)", got["held"] == "quiet", got)
    FAKE.situations = [base_sit(sms_text="{greeting}. {closing}!")]
    early("words that render empty", "e12", "off")

    # ---- the brakes, in rpcCall_'s order ----
    reset(test_mode="sheet")
    FAKE.opt_outs = [{"targetkey": "5550100000", "target": "x", "releasedat": "", "at": "2026-09-01", "phrase": "stop"}]
    got = tell("b1")
    mock = rows_of("comm_mock")[-1]
    check("an opted-out person is refused before test mode", got["state"] == "refused"
          and mock.get("result") == "refused" and mock.get("held_by") == "the person asked us to stop"
          and outbox("b1")[0]["state"] == "refused", [got, mock.get("result")])
    FAKE.opt_outs = [dict(FAKE.opt_outs[0], releasedat="2026-09-02")]
    got = tell("b1r")
    check("a released stop no longer refuses", got["state"] == "held" and got["held"] == "test_mode", got)
    FAKE.broken.add("entity_opt_outs")
    got = tell("b2")
    mock = rows_of("comm_mock")[-1]
    check("an unread opt-out list is a refusal", got["state"] == "refused" and "could not be read" in got["why"]
          and mock.get("held_by") == "the opt-out list could not be read", got)

    reset(test_mode="sheet")
    n_mock = len(rows_of("comm_mock"))
    got = tell("b3", now=NIGHT)
    mocks = rows_of("comm_mock")
    check("the real clock at 22:00: held quiet with rpcCall_'s words, a held_quiet mock row, owed",
          got["state"] == "held" and got["held"] == "quiet" and got["why"] == SC.QUIET_DETAIL
          and len(mocks) == n_mock + 1 and mocks[-1].get("result") == "held_quiet"
          and outbox("b3")[0]["state"] == "owed", [got, len(mocks) - n_mock])
    got = tell("b3", now=NIGHT + 60)
    check("the same text again that night: held, owed once, no second mock row",
          got["held"] == "quiet" and len(outbox("b3")) == 1 and len(rows_of("comm_mock")) == n_mock + 1, got)

    # the live switches today: test mode at the sheet, messages paused, HUB_RPC_SEND on
    reset(test_mode="sheet", messages_paused="on")
    n_rh, n_mock = len(rows_of("comm_rehearsal")), len(rows_of("comm_mock"))
    got = tell("b4")
    rh, mock = rows_of("comm_rehearsal"), rows_of("comm_mock")
    row = rh[-1] if rh else {}
    check("test mode 'sheet': held test_mode with smartTell_'s words",
          got["state"] == "held" and got["held"] == "test_mode"
          and got["why"] == "test mode: written to the rehearsal book and the mock outbox — nobody contacted", got)
    check("one rehearsal row and one mock row, nothing owed", len(rh) == n_rh + 1 and len(mock) == n_mock + 1
          and outbox("b4")[0]["state"] == "held" and outbox("b4")[0]["held_by"] == "test_mode")
    check("the rehearsal row: its header, id, pass, lane, dial and reasons as Apps Script writes them",
          set(row) <= set(SC.REHEARSAL_HEADER) and row.get("id", "").startswith("CRH_") and len(row.get("id", "")) == 16
          and row.get("pass_id", "").startswith("RHP_") and row.get("pass_by") == "asa-hub:scheduling"
          and row.get("intent_key") == "b4" and row.get("channel") == "sms" and row.get("dial") == "record"
          and row.get("would_have_sent") == "no" and row.get("test_mode") == "sheet" and row.get("redirected") == "no"
          and row.get("reasons") == "HUB_RPC_SEND is off · the sending dial stands at `record`, not `send`"
          and row.get("sender_used") == SC.SENDER_DEFAULT and row.get("to_masked", "").startswith("•••"), row.keys())
    m = mock[-1]
    check("the mock row: rehearsed, the sheet, the dial at record, the switch off, the key as ledger_key",
          set(m) <= set(SC.MOCK_HEADER) and m.get("result") == "rehearsed" and m.get("test_mode") == "sheet"
          and m.get("dial") == "record" and m.get("send_switch") == "off" and m.get("ledger_key") == "b4"
          and m.get("method") == "smsSend" and m.get("channel") == "sms" and m.get("audience") == "1"
          and m.get("purpose") == "scheduling" and m.get("situation") == "sched_check"
          and m.get("reason") == SC.REHEARSED_DETAIL and m.get("id", "").startswith("mock_")
          and m.get("day") == "2026-10-14" and m.get("hour") == "14:00", m)
    for word in ("on", "rehearsal", "paper"):
        reset(test_mode=word)
        got = tell("b5" + word)
        check(f"test mode '{word}' holds", got["held"] == "test_mode", got)
    reset()
    FAKE.cfg.pop("test_mode")
    got = tell("b6")
    m = rows_of("comm_mock")[-1]
    check("no test_mode fact at all holds, the mock row says unreadable",
          got["held"] == "test_mode" and m.get("test_mode") == "unreadable" and m.get("dial") == "off", [got, m])
    reset(test_mode="")
    check("a blank test_mode holds", tell("b7")["held"] == "test_mode")
    reset(test_mode="banana")
    got = tell("b8")
    check("an unknown test_mode word holds", got["held"] == "test_mode", got)
    reset()
    FAKE.broken.add("config")
    check("an unread config holds", tell("b9")["held"] == "test_mode")

    reset()
    FAKE.situations = [base_sit(record_to="rec_house")]
    n_mock = len(rows_of("comm_mock"))
    got = tell("b10")
    rec = rows_of("rec_house")
    check("a row that writes into its own house: held recorded, its row there and none in the mock outbox",
          got["held"] == "recorded" and got["why"] == "written into rec_house — nobody contacted"
          and len(rec) == 1 and rec[0].get("result") == "recorded" and len(rows_of("comm_mock")) == n_mock, got)
    reset()
    FAKE.situations = [base_sit(record_to="send")]
    check("record_to 'send' is no house", tell("b11")["held"] == SC.SWITCH_OFF)

    reset()
    q(f"insert into {SC.OUTBOX} (idem_key, state, receipt) values ('b12', 'sent', 'FAKE-0')")
    got = tell("b12")
    m = rows_of("comm_mock")[-1]
    check("a key whose text already left: already, a held mock row", got["state"] == "already"
          and m.get("held_by") == "the same ask already landed", got)

    reset()
    FAKE.props["HUB_RPC_SEND"] = "off"
    arm(True)
    got = tell("b13")
    check("HUB_RPC_SEND off holds with Apps Script's words", got["state"] == "held" and got["held"] == SC.SWITCH_OFF
          and got["why"] == "", got)
    reset(messages_paused="on")
    arm(True)
    got = tell("b14")
    check("messages_paused on holds",
          got["held"] == SC.SWITCH_OFF and outbox("b14")[0]["why"] == "messages_paused is on", got)
    reset()
    FAKE.cfg.pop("messages_paused")
    arm(True)
    check("no messages_paused fact holds", tell("b15")["held"] == SC.SWITCH_OFF)
    reset(messages_paused="")
    arm(True)
    check("a blank messages_paused holds", tell("b16")["held"] == SC.SWITCH_OFF)
    reset()
    FAKE.broken.add("facts")
    arm(True)
    check("an unread HUB_RPC_SEND holds", tell("b17")["held"] == SC.SWITCH_OFF)
    reset()
    got = tell("b18")
    check("no arm row: held, the arm named", got["held"] == SC.SWITCH_OFF and got["why"] == SC.NOT_ARMED, got)
    arm(False)
    check("an arm row that says off holds", tell("b19")["held"] == SC.SWITCH_OFF)

    # ---- owed, the repeat, the drain ----
    reset()
    arm(True)
    got = tell("vc|sched_check|T1|U1")
    rows = outbox("vc|sched_check|T1|U1")
    check("every brake open and armed: answered sent with no receipt yet, owed after the grace",
          got["state"] == "sent" and got["receipt"] == "" and got["why"] == "" and len(rows) == 1
          and rows[0]["state"] == "owed" and abs(rows[0]["due_at"] - (DAY + max(SC.VOID_GRACE_S, 10.0))) < 1,
          [got, rows])
    got = tell("vc|sched_check|T1|U1")
    claims = [r for r in outbox("vc|sched_check|T1|U1") if r["state"] in SC.CLAIMS]
    check("the same key again: already, one claim", got["state"] == "already" and len(claims) == 1, got)
    res = SC.drain(real, DAY + 5, db=FAKE, transport=fake_transport)
    check("a drain before the grace sends nothing", res["ran"] and not SENT and not res["done"], res)
    res = SC.drain(real, DAY + 60, db=FAKE, transport=fake_transport)
    sent = [r for r in outbox("vc|sched_check|T1|U1") if r["state"] == "sent"]
    ledger = rows_of("Data", "FAKE_SENT")
    m = rows_of("comm_mock")[-1]
    check("the drain sends it once: sent with the provider's receipt", res["done"] == {"sent": 1} and len(SENT) == 1
          and len(sent) == 1 and sent[0]["receipt"] == "FAKE-1" and SENT[0]["from_line"] == "", [res, SENT])
    check("its mock row says sent and the ledger keeps its line", m.get("result") == "sent" and "held_by" not in m
          and ledger and ledger[-1].get("key") == "vc|sched_check|T1|U1" and ledger[-1].get("channel") == "sms", m)
    res = SC.drain(real, DAY + 120, db=FAKE, transport=fake_transport)
    got = tell("vc|sched_check|T1|U1", now=DAY + 130)
    check("drained again: nothing; raised again: already", len(SENT) == 1 and not res["done"]
          and got["state"] == "already", [res, got])

    changes = (("test mode back on", lambda: FAKE.cfg.update(test_mode="sheet"), "held:test_mode"),
               ("the arm off", lambda: arm(None), "held:" + SC.SWITCH_OFF),
               ("messages paused", lambda: FAKE.cfg.update(messages_paused="on"), "held:" + SC.SWITCH_OFF),
               ("the person said stop", lambda: FAKE.opt_outs.append(
                   {"targetkey": "5550100000", "releasedat": "", "at": "", "phrase": ""}), "refused"),
               ("the situation switched off", lambda: FAKE.situations.__setitem__(0, base_sit(enabled="no")), "off"))
    for label, change, want in changes:
        reset()
        arm(True)
        tell("d|" + label)
        change()
        res = SC.drain(real, DAY + 60, db=FAKE, transport=fake_transport)
        check(f"owed, then {label}: the drain decides again and sends nothing", res["done"] == {want: 1}
              and len(SENT) == 1, res)

    reset()
    arm(True)
    tell("d|night")
    res = SC.drain(real, NIGHT, db=FAKE, transport=fake_transport)
    row = outbox("d|night")[0]
    check("owed, drained at 22:00: still owed, due 08:00, nothing sent", res["done"] == {"held:quiet": 1}
          and row["state"] == "owed" and abs(row["due_at"] - MORNING) < 1 and len(SENT) == 1, [res, row])
    res = SC.drain(real, MORNING, db=FAKE, transport=fake_transport)
    check("at 08:00 the owed text is decided again and leaves", res["done"] == {"sent": 1} and len(SENT) == 2, res)

    reset()
    arm(True)
    tell("e10q", at_ms=NIGHT * 1000)
    res = SC.drain(real, MORNING, db=FAKE, transport=fake_transport)
    check("a text the caller's clock held at night leaves at 08:00", res["done"] == {"sent": 1} and len(SENT) == 3, res)

    reset()
    arm(True)
    tell("vc|sched_check|T9|U1")
    tell("vc|sched_check|T9|U2")
    n = SC.cancel_owed(real, "vc|sched_check|T9|")
    res = SC.drain(real, DAY + 60, db=FAKE, transport=fake_transport)
    check("cancel_owed withdraws what a door owed, by its key prefix", n == 2 and not res["done"] and len(SENT) == 3,
          [n, res])
    check("cancel_owed never takes everything", SC.cancel_owed(real, "") == 0)
    tell("v1", write_id="Wcheck-void-1")
    n = SC.void_write(real, "Wcheck-void-1")
    res = SC.drain(real, DAY + 60, db=FAKE, transport=fake_transport)
    check("a voided write's text never leaves", n == 1 and not res["done"] and outbox("v1")[0]["state"] == "void",
          [n, res])

    reset()
    arm(True)
    tell("f1")
    res = SC.drain(real, DAY + 60, db=FAKE,
                   transport=lambda *a, **k: {"ok": False, "sent": False, "error": "provider_422",
                                              "detail": "the provider refused with 422"})
    row = outbox("f1")[0]
    m = rows_of("comm_mock")[-1]
    check("a provider refusal: failed, said in the outbox and the mock row", res["done"] == {"failed": 1}
          and row["state"] == "failed" and row["why"] == "provider_422: the provider refused with 422"
          and m.get("result") == "failed" and m.get("held_by") == "provider_422", [res, row])

    def boom(*a, **k):
        raise TimeoutError("no answer")

    tell("f2")
    res = SC.drain(real, DAY + 60, db=FAKE, transport=boom)
    check("a transport that throws: failed 'transport', never retried", res["done"] == {"failed": 1}
          and outbox("f2")[0]["why"].startswith("transport"), res)
    q(f"insert into {SC.OUTBOX} (idem_key, state, updated_at) values ('f3', 'sending', now() - interval '1 hour')")
    SC.drain(real, time.time(), db=FAKE, transport=fake_transport)
    check("a send whose outcome was never kept turns unknown and holds its key", outbox("f3")[0]["state"] == "unknown"
          and tell("f3")["state"] == "already")

    reset()
    arm(True)
    FAKE.situations = [base_sit(from_line="Administration")]
    tell("l1")
    SC.drain(real, DAY + 60, db=FAKE, transport=fake_transport)
    check("the situation's own line rides to the transport", SENT[-1]["from_line"] == "Administration", SENT[-1])

    reset(test_mode="sheet")
    with SC.deciding(real, "Wcheck-deciding", "vehicleCalendarRequest"):
        got = SC.raise_situation(None, situation="sched_check", to=TO, vars=VARS, key="w1", lane="transportation",
                                 at_ms=DAY * 1000, now=DAY, db=FAKE)
    wrote = sum(q(f"select count(*) from {t} where write_id = 'Wcheck-deciding' and door = 'vehicleCalendarRequest'")[0][0]
                for t in CL.TABLES.values())
    check("raise_situation(None) inside deciding(): the door's transaction and write id", got["held"] == "test_mode"
          and wrote > 0 and outbox("w1")[0]["door"] == "vehicleCalendarRequest", got)
    got = SC.raise_situation(None, situation="sched_check", to=TO, vars=VARS, key="w2", db=FAKE)
    check("raise_situation(None) with no write being decided keeps nothing", got["state"] == "failed")
    check("no transport ran past a brake: four texts left, each through the fake", len(SENT) == 4, len(SENT))
    check("lengths are counted in UTF-16 units, as JavaScript counts them",
          SC._len16("a" + SMILE) == 3 and SC._cut16("ab" + SMILE, 3) == "ab")

    # ---- the provider path, never reached: no key file is named ----
    got = SC.openphone("+15550100000", "words", "")
    check("the real transport without a key file: failed no_provider_key, no socket", got["error"] == "no_provider_key"
          and not OPENED, got)
    check("the transport the drain uses by default is the provider's", SC.TRANSPORT is SC.openphone)


def quiet_edges():
    cases = []
    for (y, mo, d) in ((2026, 10, 14), (2026, 12, 14)):
        for h, mi, want in ((21, 30, False), (21, 31, True), (7, 59, True), (8, 0, False), (3, 0, True), (12, 0, False)):
            at = ny(y, mo, d, h, mi)
            got = SC.quiet_at(at)
            check(f"quiet window {y}-{mo:02d}-{d:02d} {h:02d}:{mi:02d} New York: {'held' if want else 'allowed'}",
                  got is want, got)
            cases.append(int(at * 1000))
    js["quiet"] = {"cases": cases, "py": [SC.quiet_at(ms / 1000) for ms in cases]}


def unit_parity():
    tpls = ["Hi {first_name}, this is {sender}. Your shift on {day} is {state}.",
            "Line one {a}.\n\nLine two has {b}! And {c}? Done.\n   \n{d}",
            "...{x} lead dots. Kept sentence.\r\nNext {y} line.",
            "Unicode" + chr(0xA0) + "space {u}." + chr(0x2003) + "Then {v}." + chr(0x3000) + "End" + chr(0x2028)
            + "after a separator {w}." + chr(0xFEFF),
            "Emoji " + SMILE + " {e} here. {f}",
            "{constructor} and {toString} and {hasOwnProperty}.",
            "Tail without stop {t}",
            "",
            "No placeholders at all.\n\nSecond paragraph."]
    vsets = [{"first_name": "Pat", "sender": "", "day": None, "state": 0, "a": "A", "b": "", "c": None,
              "e": SMILE, "u": "U", "x": False, "f": [1, None, 2], "toString": "own"},
             {}, {"a": "1", "b": "2", "c": "3", "d": "4", "x": "x", "y": "y", "u": "u", "v": "v", "e": "e", "f": "f",
                  "t": "t", "w": "w", "first_name": "F", "day": "D", "state": "S", "sender": "Z"}]
    cases = []
    for t in tpls:
        for vs in vsets:
            for pr in (False, True):
                cases.append({"tpl": t, "vars": vs, "prune": pr})
    lead = {"sms_tpl": tpls[0], "line_sms": "LEAD", "subject_tpl": "", "email_tpl": tpls[1], "line_email": "MAIL"}
    cases.append({"tpl": tpls[0], "vars": {"@lead": dict(lead), "first_name": "Q"}, "prune": False})
    cases.append({"tpl": tpls[1], "vars": {"@lead": dict(lead)}, "prune": True})
    # every live smartTell_ situation's words, with two sets of fixed values
    try:
        sits = [s for s in SC.read_situations(live) if s["id"].startswith(("sched_", "sr_", "transport_"))
                or s["id"] == "staff_loan_request"]
    except Exception as exc:
        sits = []
        check("the live situations are read", False, type(exc).__name__)
    ids = sorted({s["id"] for s in sits})
    facts["live smartTell_ situations"] = f"{len(ids)} ids, {len(sits)} rows"
    check("the live smartTell_ situations are there", len(ids) >= 20, len(ids))
    for s in sits:
        names = []
        for n in re.findall(r"\{([A-Za-z0-9_]+)\}", s.get("sms_text", "")):
            if n not in names:
                names.append(n)
        full = {n: f"V{i}" for i, n in enumerate(names)}
        full.setdefault("sender", SC.SENDER_DEFAULT)
        mixed = {}
        for i, n in enumerate(names):
            if i % 4 == 0:
                mixed[n] = f"W{i}"
            elif i % 4 == 1:
                mixed[n] = ""
            elif i % 4 == 2:
                mixed[n] = None
        for vs in (full, mixed):
            cases.append({"tpl": s.get("sms_text", ""), "vars": vs, "prune": True, "live": True})
            cases.append({"tpl": s.get("sms_text", ""), "vars": vs, "prune": False, "live": True})
    py = []
    for c in cases:
        vs = json.loads(json.dumps(c["vars"]))
        r = SC.render(c["tpl"], vs)
        py.append(SC.prune(r) if c["prune"] else r)
    js["render"] = {"cases": cases, "py": py}
    nums = ["+1 (555) 010-0000", "15550100000", "5550100000", "555010000", "1 330 919 5558", "3307544040",
            "+13309195559", "115550100000", "", None, 5550100000, "abc", "+44 20 7946 0958", "1-555-010-0000 x12"]
    js["sendable"] = {"cases": nums, "py": [SC.sendable(n) for n in nums]}
    masks = ["", "1234", "12345", "+15550100000", "a@b.cd, +15550100000; x", " ; , "]
    js["mask"] = {"cases": masks, "py": [[SC.mask(m), SC.mask_to(m)] for m in masks]}
    rows = [{"id": "transport_request_ask"}, {"id": "sched_x"}]
    reasons = ["transportation: transport_request_ask", "scheduling: sched_x", "smart comms: anything_else",
               "smart comms cc: a-b", "x comms : spaced", "support requests: not_there", "lane: sched_x \n",
               "no colon here", "a: b: transport_request_ask"]
    js["from"] = {"rows": rows, "cases": reasons, "py": [SC.situation_from(r, rows) for r in reasons]}
    lists = [{"id": "PNaaaa1111", "name": "Automations", "number": "+15550001111", "users": [{"id": "USa"}]},
             {"id": "PNbbbb2222", "name": "Front Desk", "number": "+15550002222", "users": []},
             {"id": "PNcccc3333", "name": "Administration", "number": "+15550003333"},
             {"id": "PNdddd4444", "name": "automations", "number": "+15550004444", "role": "Director"},
             {"id": "PNeeee5555", "name": "Other", "number": "+15550005555", "role": "Director"}]
    wants = ["", "Automations", "Administration", "administration", "front desk", "PNbbbb2222", "5550002222",
             "+1 555 000 9999", "Director", "Nobody", "PNzzzz9999"]
    js["pick"] = {"data": lists, "cases": wants, "py": [SC.sender_pick(lists, w) for w in wants]}
    js["pick_none"] = {"py": SC.sender_pick([{"name": "Other", "number": "+15550005555"}], "")}
    verdicts = [[200, '{"data":{"id":"AC1"}}'], [202, '{"data":{}}'], [200, "not json"], [400, "{}"], [500, ""],
                [201, '{"data":{"id":"  AC2  "}}'], [200, '[1, 2]']]
    js["verdict"] = {"cases": verdicts, "py": [SC.verdict(c, t) for c, t in verdicts]}
    lists_raw = ["sms, email", " SMS ;sms|x\n", "", None, ",,"]
    js["list"] = {"cases": lists_raw, "py": [SC.smart_list(x) for x in lists_raw]}
    ons = ["yes", " TRUE ", "On", "1", "no", "", None, "y"]
    js["on"] = {"cases": ons, "py": [SC.smart_on(x) for x in ons]}
    js["constants"] = {"py": {
        "mock_header": list(SC.MOCK_HEADER), "rehearsal_header": list(SC.REHEARSAL_HEADER),
        "shared": list(SC.SHARED_LINE_DIGITS), "roles": SC.LINE_ROLE_WORDS, "sender": SC.SENDER_DEFAULT,
        "lead": SC.LEAD_KEY, "quiet": [SC.QUIET_FROM, SC.QUIET_TO, SC.QUIET_TZ, SC.QUIET_WORDS],
        "test_words": [list(SC.TEST_ON), list(SC.TEST_OFF), list(SC.TEST_SHEET)],
        "seed_blank": sorted(SC.SEED_BLANK_SMS), "generic": list(SC.GENERIC_SEED), "record_to": SC.SEED_RECORD_TO,
        "line": SC.DEFAULT_LINE, "quiet_detail": SC.QUIET_DETAIL, "rehearsed": [SC.REHEARSED_DETAIL, SC.REHEARSAL_LOST],
        "switch_off": SC.SWITCH_OFF}}


def live_copy():
    SC.ensure(real)
    arm(None)
    q(f"update {SC.OUTBOX} set state = 'cancelled' where state = 'owed'")
    try:
        b = SC.brakes(live, real.cursor())
    except Exception as exc:
        check("the live brakes are read", False, type(exc).__name__)
        return
    facts["live brakes"] = (f"test mode holds {b['hold']} ({b['mock_test_mode']}), HUB_RPC_SEND copy "
                            f"{'on' if b['rpc_send'] else 'off'}, paused {b['paused']}, armed {b['armed']}")
    check("on the live copy nothing can send (test mode holds, no arm)", b["hold"] and not b["sending"],
          facts["live brakes"])
    sits = SC.read_situations(live)
    dup = {}
    for s in sits:
        dup[s["id"]] = dup.get(s["id"], 0) + 1
    facts["live situations"] = f"{len(sits)} rows, {len(dup)} ids, {sum(1 for n in dup.values() if n > 1)} duplicated"
    n_rh, n_mock = len(rows_of("comm_rehearsal")), len(rows_of("comm_mock"))
    words = (SC.situation_row(sits, "transport_request_ask") or {}).get("sms_text", "")
    filled = {n: "Check" for n in re.findall(r"\{([A-Za-z0-9_]+)\}", words)}
    got = SC.raise_situation(real, situation="transport_request_ask", to="+15550100000", vars=filled,
                             key="scm-check|live|1", lane="transportation", at_ms=DAY * 1000, now=DAY, db=live,
                             door="check", write_id="Wcheck-scm-live")
    landed = written_by("Wcheck-scm-live")
    check("a live raise in test mode: held test_mode, nothing owed", got["state"] == "held"
          and got["held"] == "test_mode" and not [r for r in outbox("scm-check|live|1") if r["state"] in SC.CLAIMS],
          got)
    as_edits = q(f"select count(*) from {W.EDITS_TABLE} where write_id = 'Wcheck-scm-live'"
                 " and tab_name in ('comm_rehearsal', 'comm_mock')")[0][0]
    check("its rehearsal and mock rows land in the test logs' own tables, under the write, none as a sheet's edit",
          landed.get("comm_rehearsal") == CL.table(CL.REHEARSAL) and landed.get("comm_mock") == CL.table(CL.MOCK)
          and as_edits == 0 and len(rows_of("comm_rehearsal")) == n_rh + 1 and len(rows_of("comm_mock")) == n_mock + 1,
          [sorted(landed), as_edits])
    ask = {"situation": "transport_request_ask", "to": "+15550100000", "vars": filled,
           "key": "scm-check|live|2", "lane": "transportation", "prune": True}
    q(f"insert into {SC.OUTBOX} (idem_key, situation, state, due_at, ask) values (%s, %s, 'owed', to_timestamp(%s),"
      " %s::jsonb)", ("scm-check|live|2", "transport_request_ask", DAY - 60, json.dumps(ask)))
    before = len(SENT)
    res = SC.drain(real, DAY, db=live, transport=fake_transport)
    check("a live drain of an owed text: decided again, held by test mode, the transport never called",
          res["done"] == {"held:test_mode": 1} and len(SENT) == before, res)


try:
    with real.transaction():
        for name, fn in (("scenarios", scenarios), ("quiet edges", quiet_edges), ("unit parity", unit_parity),
                         ("the live copy", live_copy)):
            try:
                with real.transaction():
                    fn()
            except Exception as exc:
                import traceback
                check(f"{name} ran to the end", False, type(exc).__name__ + ": " + traceback.format_exc()[-600:])
        check("no socket was opened by anything the check ran", not OPENED, OPENED)
        raise psycopg.Rollback()
finally:
    socket.socket.connect, socket.socket.connect_ex, socket.create_connection, socket.getaddrinfo = _orig
    try:
        real.close()
    except Exception:
        pass
print(json.dumps({"checks": out, "facts": facts, "js": js}, default=str))
'''

# the .gs functions themselves, in node, over the same cases
NODE = r'''
const fs = require('fs'), vm = require('vm'), path = require('path');
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
const ctx = { console };
vm.createContext(ctx);
let files = input.files.map(f => f + '.gs');
for (let pass = 0; pass < 5 && files.length; pass++) {
  const next = [];
  for (const f of files) {
    try { vm.runInContext(fs.readFileSync(path.join(input.dir, f), 'utf8'), ctx, { filename: f }); }
    catch (e) { next.push(f); }
  }
  files = next;
}
if (files.length) { console.log(JSON.stringify({ error: 'not loaded: ' + files.join(',') })); process.exit(0); }
ctx.hubSysLog_ = function () {};
ctx.Utilities = { formatDate: function (d, tz, fmt) {
  if (!(d instanceof Date) || isNaN(d.getTime())) throw new Error('Invalid Date');
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(d);
  const get = t => (p.find(x => x.type === t) || {}).value;
  return get('hour') + ':' + get('minute');
} };
const j = input.js, out = {};
out.render = j.render.cases.map(c => {
  const vars = JSON.parse(JSON.stringify(c.vars));
  const r = ctx.smartRender_(c.tpl, vars);
  return c.prune ? ctx.smartPruneUnfilled_(r) : r;
});
out.sendable = j.sendable.cases.map(x => ctx.packetSendableNumber_(x));
out.mask = j.mask.cases.map(x => [ctx.hubRehearsalMask_(x), ctx.rpcMaskTo_(x)]);
ctx.smartSituations_ = function () { return j.from.rows; };
out.from = j.from.cases.map(x => ctx.commMockSituationFrom_(x));
out.pick = j.pick.cases.map(w => ctx.rpcSenderPick_(j.pick.data, w));
out.pick_none = ctx.rpcSenderPick_([{ name: 'Other', number: '+15550005555' }], '');
out.verdict = j.verdict.cases.map(c => ctx.rpcProviderVerdict_(c[0], c[1]));
out.list = j.list.cases.map(x => ctx.smartList_(x));
out.on = j.on.cases.map(x => ctx.smartOn_(x));
out.quiet = j.quiet.cases.map(ms => ctx.hubQuietAt_(new Date(ms)));
ctx.hubBookMerge_ = function (name, seed) { return seed; };
const seeds = [].concat(ctx.smartExtraSituations_(), ctx.SMART_DIGESTS, ctx.SMART_HIRING_EVENTS,
                        ctx.SMART_GUARDIAN_EVENTS, ctx.SMART_MAILBOX_EVENTS_SEED || []);
const recordTo = {};
seeds.forEach(e => { if (e && String(e.record_to || '').trim()) recordTo[e.id] = String(e.record_to).trim(); });
const g = ctx.SMART_GENERIC_SEED;
out.constants = {
  mock_header: ctx.COMM_MOCK_HEADER, rehearsal_header: ctx.HUB_REHEARSAL_HEADER, shared: ctx.SHARED_LINE_DIGITS,
  roles: ctx.LINE_ROLE_WORDS, sender: ctx.SMART_SENDER_DEFAULT, lead: ctx.SMART_LEAD_KEY,
  quiet: [ctx.HUB_QUIET_FROM, ctx.HUB_QUIET_TO, ctx.HUB_QUIET_TZ, ctx.hubQuietWords_()],
  test_words: [ctx.HUB_TEST_MODE_ON_WORDS, ctx.HUB_TEST_MODE_OFF_WORDS, ctx.HUB_REHEARSAL_WORDS],
  seed_blank: ctx.SMART_EXTRA_SITUATIONS_SEED.filter(e => Object.prototype.hasOwnProperty.call(e, 'sms_text') &&
    String(e.sms_text == null ? '' : e.sms_text).trim() === '').map(e => String(e.id)).sort(),
  generic: [g.sms_text, g.email_subject, g.email_text], record_to: recordTo, line: ctx.RPC_DEFAULT_LINE_NAME,
  quiet_detail: ctx.hubQuietAnswer_('smsSend', {}).detail,
  rehearsed: [ctx.hubRehearsalAnswer_('smsSend', 'x', true).detail, ctx.hubRehearsalAnswer_('smsSend', 'x', false).detail],
  switch_off: (function () {
    // rpcCall_ itself, every brake before the switch stood aside and HUB_RPC_SEND read as off
    ctx.hubProp_ = function () { return 'off'; };
    ctx.optOutBlocked_ = function () { return ''; };
    ctx.hubQuietHolds_ = function () { return false; };
    ctx.hubRehearsalToSheet_ = function () { return false; };
    ctx.commMockRecordOnly_ = function () { return null; };
    ctx.commMockNote_ = function () {};
    ctx.CacheService = { getScriptCache: function () { return { get: function () { return null; } }; } };
    return ctx.rpcCall_('smsSend', { to: '+15550100000', body: 'x', reason: 'check: x' }, {}).reason;
  })()
};
process.stdout.write(JSON.stringify(out));
'''


def same_pick(py: dict, gs: dict) -> bool:
    """The pick as the transport uses it: the line's number and user, or the refusal and its words."""
    if gs.get("error") or py.get("error"):
        return gs.get("error") == py.get("error") and gs.get("detail") == py.get("detail")
    return all(gs.get(k) == py.get(k) for k in ("from", "userId", "line"))


def same_verdict(py: dict, gs: dict) -> bool:
    return all(gs.get(k) == py.get(k) for k in ("ok", "sent", "error", "detail", "receipt") if k in gs or k in py)


def main() -> int:
    py_compile.compile(str(ROOT / "app" / "smart_comms.py"), doraise=True)
    print("ok   app/smart_comms.py compiles")
    app = {p.stem: p.read_text(encoding="utf-8") for p in (ROOT / "app").glob("*.py")}
    got = subprocess.run(["docker", "exec", "-i", "-e", "MALLOC_ARENA_MAX=2", RUNNER, "python", "-c", DRIVER],
                         input=base64.b64encode(json.dumps({"app": app}).encode()) + b"\n", capture_output=True,
                         timeout=900)
    lines = got.stdout.decode().strip().splitlines()
    if got.returncode != 0 or not lines:
        print("FAIL the driver ran in asa-hub-db-sync")
        print(got.stderr.decode()[-2500:])
        return 1
    res = json.loads(lines[-1])
    checks = list(res["checks"])
    js = res["js"]
    ran = subprocess.run(["node", "-e", NODE], input=json.dumps({"dir": str(ROOT / "apps-script"), "files": GS_FILES,
                                                                  "js": js}).encode(),
                         capture_output=True, timeout=300)
    try:
        gs = json.loads(ran.stdout.decode() or "{}")
    except ValueError:
        gs = {"error": "node answered no JSON: " + ran.stderr.decode()[-400:]}
    if gs.get("error"):
        checks.append(["the .gs functions ran in node", False, gs["error"]])
    else:
        def compare(name: str, eq=lambda a, b: a == b) -> None:
            py, theirs = js[name]["py"], gs[name]
            bad = [i for i, (a, b) in enumerate(zip(py, theirs)) if not eq(a, b)]
            live = sum(1 for c in js[name].get("cases", []) if isinstance(c, dict) and c.get("live"))
            label = {"render": f"smartRender_ + smartPruneUnfilled_ on {len(py)} cases ({live} over the live words)",
                     "sendable": "packetSendableNumber_", "mask": "hubRehearsalMask_ and rpcMaskTo_",
                     "from": "commMockSituationFrom_", "pick": "rpcSenderPick_ over hubLineSenderMatch_",
                     "verdict": "rpcProviderVerdict_", "list": "smartList_", "on": "smartOn_",
                     "quiet": "hubQuietAt_ at the window's edges"}[name]
            checks.append([f"parity with the .gs: {label}", len(py) == len(theirs) and not bad,
                           f"{len(bad)} differ, first at case {bad[:5]}" if bad else f"{len(py)} vs {len(theirs)}"])

        for name in ("render", "sendable", "mask", "from", "list", "on", "quiet"):
            compare(name)
        compare("pick", same_pick)
        compare("verdict", same_verdict)
        checks.append(["parity with the .gs: no Automations line refuses alike",
                       same_pick(js["pick_none"]["py"], gs["pick_none"]), ""])
        mine, theirs = js["constants"]["py"], gs["constants"]
        for k in sorted(mine):
            checks.append([f"the copied constant matches the .gs: {k}", mine[k] == theirs.get(k), "differs"])
    failed = 0
    for name, ok, detail in checks:
        print(("ok   " if ok else "FAIL ") + name + ("" if ok else f"\n       {detail}"))
        failed += 0 if ok else 1
    for k, v in res["facts"].items():
        print(f"fact {k}: {v}")
    print(f"{len(checks) - failed} ok, {failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
