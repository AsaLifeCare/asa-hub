#!/usr/bin/env python3
"""Staff Candidates' writes and editions decided by the streamed modules on real candidates in asa-hub-db-sync: the
master, a person not listed, a listed person (editions and App Control's release simulated), the presses once handed
to Apps Script (each final now), the refusals, and the exact app.edits rows each final write keeps. Nothing real is written: the edit store lives
in temp tables inside one transaction rolled back at the end. Prints shapes, counts and masked rows only."""
from __future__ import annotations

import base64
import json
import py_compile
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DB_RUNNER = "asa-hub-db-sync"

# the read module's parts the writes call, used only while app/candidates.py is not in this tree
STAND_IN = r'''
"""A stand-in for the Staff Candidates reads: the candidate and its Actions answer (the checklist's doors, the moves and
the code gate), off the candidate's own facts."""
import candidate_writes as CWR

APP_ID = "staff-candidates"
DOORS = {
    "resume-decision": ("setDecision", "", {"checkpoint": "resume-decision", "value": "Advance"}, ""),
    "advance-decision": ("setDecision", "", {"checkpoint": "advance-decision", "value": "Advance"}, "phone-screen"),
    "transcript": ("screenManualComplete", "notes", {}, "phone-screen"),
    "interview-scheduled": ("hiringScheduleCreate", "schedule", {"event_type": "in_person_interview"}, "interview"),
    "new-hire-packet": ("packetWaive", "note", {}, ""),
    "onboarding-complete": ("onboardingManualComplete", "notes", {}, "onboarding"),
}
FORCE = {}


def candidate(sess, key):
    got = CWR.own_ctx(sess.reads, key)
    if got.get("refused"):
        return got
    return {"key": got["key"], "name": got["name"], "row": {"stage": got["stage"]}, "archived": got["archived"]}


def gate_of(stage, cand, a, s):
    if stage == "new":
        r = [] if a.get("decisionstatus", "").lower() == "advance" else ["resume decision Advance"]
        return {"from": "new", "to": "phone-screen", "ok": not r, "reasons": r}
    if stage == "phone-screen":
        r = []
        if s.get("screenstatus", "").lower() != "completed":
            r.append("screen Completed")
        if s.get("finalresult", "").lower() != "advance":
            r.append("advance decision Advance")
        return {"from": "phone-screen", "to": "interview", "ok": not r, "reasons": r}
    if stage == "interview":
        return {"from": "interview", "to": "onboarding", "ok": False, "reasons": ["interview scorecard (score + comments)"]}
    if stage == "onboarding":
        return {"from": "onboarding", "to": "hired", "ok": False, "reasons": ["Manual onboarding"]}
    if stage == "hired":
        ok = bool(cand.get("hiredcompleteat"))
        return {"from": "hired", "to": "ready", "ok": ok, "reasons": [] if ok else ["the graduation has not finished"]}
    return {"from": stage, "to": None, "ok": False, "reasons": ["final stage"]}


def actions_build(sess, ctx):
    key = ctx["key"]
    reads = sess.reads
    cand = CWR.dissolved_rows(reads, CWR.CANDIDATES, [key]).get(key) or {}
    a = CWR.dissolved_rows(reads, CWR.RESUME, [key]).get(key) or {}
    s = CWR.dissolved_rows(reads, CWR.PHONE, [key]).get(key) or {}
    stage = CWR.stage_of(cand.get("status"))
    archived = str(cand.get("archived", "")).lower() == "true"
    done = {"resume-decision": a.get("decisionstatus", "").lower() == "advance",
            "advance-decision": s.get("finalresult", "").lower() == "advance",
            "transcript": s.get("screenstatus", "").lower() == "completed",
            "interview-scheduled": False, "new-hire-packet": False, "onboarding-complete": False}
    items = []
    for iid, (action, form, fields, at) in DOORS.items():
        is_open = not done[iid]
        door, why = None, ""
        if is_open and archived:
            why = "This candidate is out of the Hiring pipeline."
        elif is_open and at and at != stage:
            why = "Its door opens at " + CWR.stage_label(at) + "."
        elif is_open:
            door = {"action": action, "form": form, "payload": {"candidate_id": key, **fields}}
        items.append({"id": iid, "label": iid.replace("-", " ").capitalize(), "status": "done" if done[iid] else "pending",
                      "open": is_open, "complete": door, "complete_why": why})
    gate = gate_of(stage, cand, a, s)
    stages = []
    for st in CWR.STAGE_ORDER:
        o = {"id": st, "label": CWR.stage_label(st), "current": st == stage, "reachable": False, "door": None, "why": ""}
        if not o["current"] and not archived and st == gate.get("to"):
            if stage == "onboarding":
                o["reachable"], o["door"] = True, {"action": "onboardingManualComplete", "form": "notes",
                                                   "payload": {"candidate_id": key}}
            elif gate.get("ok"):
                o["reachable"], o["door"] = True, {"action": "moveStage", "form": "", "payload": {"candidate_id": key,
                                                                                                   "to_stage": st}}
            else:
                o["why"] = "Still needed: " + "; ".join(gate.get("reasons") or []) + "."
        elif not o["current"]:
            o["why"] = "The Hiring pipeline moves one stage at a time."
        stages.append(o)
    stages.append({"id": "not-hiring", "label": "Not hiring", "current": False, "reachable": not archived,
                   "door": None if archived else {"action": "hiringDiscard", "form": "reason",
                                                  "payload": {"candidate_id": key}}, "why": ""})
    return {"stage": stage, "archived": archived, "items": items, "gate": gate, "stages": stages}


def gate_after(sess, key, changes):
    reads = sess.reads
    rows = {t: dict(CWR.dissolved_rows(reads, t, [key]).get(key) or {}) for t in (CWR.CANDIDATES, CWR.RESUME, CWR.PHONE)}
    for tab, fields in changes.items():
        for col, v in fields.items():
            rows[tab][CWR.norm(col)] = v
    cand = rows[CWR.CANDIDATES]
    return gate_of(CWR.stage_of(cand.get("status")), cand, rows[CWR.RESUME], rows[CWR.PHONE])
'''

DRIVER = r'''
import base64, importlib.abc, importlib.util, json, re, sys, time, types, uuid
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
fake = types.ModuleType("fastapi")


class Resp:
    def __init__(self, content=b"", status_code=200, media_type="", headers=None):
        self.body = content if isinstance(content, (bytes, str)) else json.dumps(content)
        self.status_code, self.headers = status_code, dict(headers or {})


class App:
    def __init__(self, **_kw):
        pass

    def _route(self, *_a, **_kw):
        return lambda fn: fn
    get = post = _route


fake.FastAPI, fake.Request = App, object
responses = types.ModuleType("fastapi.responses")
responses.JSONResponse = lambda content, status_code=200, headers=None: Resp(content, status_code, "", headers)
responses.Response = Resp
conc = types.ModuleType("starlette.concurrency")


async def run_in_threadpool(fn, *a, **kw):
    return fn(*a, **kw)
conc.run_in_threadpool = run_in_threadpool
sys.modules.update({"fastapi": fake, "fastapi.responses": responses, "starlette": types.ModuleType("starlette"),
                    "starlette.concurrency": conc})

import psycopg
import gsjs, hubdb, scope as sc, locations as L, writes as W, client_writes as CW, editions as ED
import candidate_writes as CWR
import candidates as CND
import main as M

# a check forces a stage the record does not hold (the move into Onboarding): laid over whichever reads answer
CND.FORCE = getattr(CND, "FORCE", {})
_actions_build = CND.actions_build


def _forced(r, ctx):
    got = dict(_actions_build(r, ctx))
    got.update(CND.FORCE.get(ctx["key"]) or {})
    return got


CND.actions_build = _forced

out, facts, rows_out = [], {}, []


def check(name, ok, detail=""):
    out.append([name, bool(ok), "" if ok else str(detail)[:400]])


W.EDITS_TABLE = "pg_temp.hub_edits_cnd"
W.LOCK_KEY = 0x434E445743


def rw(sql):
    return sql.replace("app.check_", "pg_temp.check_") if isinstance(sql, str) else sql


class Cur:
    def __init__(self, cur):
        self.c = cur

    def execute(self, sql, params=None):
        self.c.execute(rw(sql), params)
        return self

    def executemany(self, sql, rows):
        self.c.executemany(rw(sql), rows)
        return self

    def fetchone(self):
        return self.c.fetchone()

    def fetchall(self):
        return self.c.fetchall()


class Conn:
    def __init__(self, real):
        self.real = real

    @property
    def closed(self):
        return self.real.closed

    @property
    def broken(self):
        return self.real.broken

    def execute(self, sql, params=None):
        return Cur(self.real.cursor()).execute(sql, params)

    def cursor(self):
        return Cur(self.real.cursor())

    def transaction(self):
        return self.real.transaction()

    def close(self):
        pass


# the catalogue's new entries, as app/editions.py will carry them (simulated here: that file is shared)
for e in blob["editions"]:
    if e["id"] not in ED._BY_ID:
        ED._BY_ID[e["id"]] = e
        ED.CATALOGUE = ED.CATALOGUE + (e,)
ED.IDS = tuple((e["id"], e["app"]) for e in ED.CATALOGUE)
sc.EDITIONS = ED.IDS

db = hubdb.HubDb()
real = psycopg.connect(hubdb._dsn(), autocommit=False, connect_timeout=5, application_name="candidate-writes-check")
proxy = Conn(real)
store = W.Store(connect=lambda: proxy, kind="check", label="Check")
EDITIONS = {"value": "[]"}
base_cfg = db.hiring_config
db.hiring_config = lambda: {**base_cfg(), sc.EDITIONS_KEY: EDITIONS["value"]}
db.stale = lambda books: False
base_query = db.query


def query(sql, params=None):
    """The check's temp edit store lives on the check's own connection: a read naming it is answered there."""
    if isinstance(sql, str) and "pg_temp." in sql:
        with real.cursor() as c:
            c.execute(sql, params)
            return list(c.fetchall())
    return base_query(sql, params)


db.query = query
HOLDER = {"id": "", "shut": ""}
base_gate = sc.profile_app_gate


def gate(app_id, user, src):
    uid = gsjs.str_((user or {}).get("id"))
    if uid and HOLDER["shut"] == uid:
        return {"open": False, "scope": sc.scope_of("none", "closed by the check")}
    if user and HOLDER["id"] and uid == HOLDER["id"] and not user.get("is_service"):
        return {"open": True, "scope": sc.scope_of("all")}
    return base_gate(app_id, user, src)


sc.profile_app_gate = gate
M.DB = db
M.STORE = M.CLIENT_STORE = M.STAFF_STORE = M.SSA_STORE = M.FAMILY_STORE = M.SCHEDULING_STORE = W.Store(dsn="")
M.WRITES["candidates"] = CWR
M.stores = lambda: {"candidates": store}
M.WRITE_BUDGET_S = 120.0
seq = [0]
# the values a row may print: words the platform writes, never a person's
SAFE = {"decisionstatus", "status", "manualscreen", "screenstatus", "reviewstatus", "__deleted", "step", "ok", "channel",
        "title", "ref", "rehearsal", "Kind", "Step", "Channel", "Title", "OK", "Source", "Rehearsal", "to_status",
        "from_status", "hasvehicle"}


def listed(*eids):
    EDITIONS["value"] = json.dumps([{"id": e, "on": True, "people": [HOLDER["id"]]} for e in eids])


SLOWEST = {}


def write(action, who, payload):
    seq[0] += 1
    wid = f"Wcheck-cnd-{seq[0]:04d}-{uuid.uuid4().hex[:8]}"
    started = time.time()
    res = M._run_write(CWR, action, who, payload, wid)
    took = time.time() - started
    SLOWEST[action] = max(SLOWEST.get(action, 0.0), took)
    return res.status_code, json.loads(res.body), wid


def mask(v):
    return f"<{len(v)} chars>" if v else ""


def rows_of(wid, label):
    with real.cursor() as c:
        c.execute("select tab_name, kind, match_by, row_key, field, value, edition from pg_temp.hub_edits_cnd"
                  " where write_id = %s order by id", (wid,))
        got = c.fetchall()
    shown = []
    by_key = {}
    for t, k, m, rk, f, v, e in got:
        by_key.setdefault((t, rk), {})[f] = v
    for (t, rk), cells in by_key.items():
        if t == "Facts":
            src = cells.get("Source", "")
            field = src.rsplit(".", 1)[-1]
            value = cells.get("Value", "")
            shown.append([t, "fact", src.split(".", 1)[0] + "." + field,
                          value if field in SAFE else mask(value), cells.get("Recorded By", "")
                          if "@" not in cells.get("Recorded By", "") else "<the presser's e-mail>",
                          next((x[6] for x in got if x[3] == rk), "")])
        else:
            shown.append([t, "row", ",".join(sorted(cells)), "", "", next((x[6] for x in got if x[3] == rk), "")])
    rows_out.append({"write": label, "rows": shown})
    return got


def plan(env):
    return env.get("_write") or {}


def facts_in(got):
    """{(subject, field): (value, recorded_by)} of the Facts a write kept."""
    cells = {}
    for t, k, m, rk, f, v, e in got:
        if t == "Facts":
            cells.setdefault(rk, {})[f] = v
    outd = {}
    for c in cells.values():
        outd[(c.get("Subject ID", ""), c.get("Source", "").rsplit(".", 1)[-1])] = (c.get("Value", ""), c.get("Recorded By", ""))
    return outd


def guarded(name, fn):
    try:
        with real.transaction():
            fn()
    except Exception as exc:  # noqa: BLE001 - said as a failed check, never a value
        import traceback
        check(name + ": ran to the end", False, type(exc).__name__ + ": " + str(exc)[:200] + " @ " +
              traceback.format_exc().strip().splitlines()[-3][:160])


def laid_reads():
    own = CW.Own([], book=db.book, edits=store.edits(), edits_at=time.time())
    return own


reads0 = L.Reads(db, None)
users = [u for u in reads0.users() if gsjs.str_(u.get("userid")) and not gsjs.str_(u.get("mergedinto"))]
master = next((u for u in users if gsjs.str_(u.get("email")).lower() == sc.MASTER_ACCOUNT), None)
holder = next((u for u in users if gsjs.str_(u.get("role")).lower() == "staff" and not gsjs.str_(u.get("clientkey"))
               and gsjs.str_(u.get("active")).lower() != "false" and gsjs.str_(u.get("email")).lower() != sc.MASTER_ACCOUNT),
              None)
MASTER = {"uid": gsjs.str_((master or {}).get("userid")) or "USR_MASTER", "role": "admin", "is_master": True}
HOLD = {"uid": gsjs.str_((holder or {}).get("userid")), "role": "staff", "is_master": False}
HOLDER["id"] = HOLD["uid"]
facts["reads module"] = blob["reads"]
facts["accounts"] = f"master row {'found' if master else 'absent'}, a staff account {'found' if holder else 'absent'}"
check("a staff account (not a client) is read from the users tab", bool(holder))
with real.transaction():
    store.ensure()
    check("the edit store is made in temp tables", store.ready(), store.why)

cands = CWR.dissolved_rows(reads0, CWR.CANDIDATES)
analyses = CWR.dissolved_rows(reads0, CWR.RESUME)
screens = CWR.dissolved_rows(reads0, CWR.PHONE)
docs = CWR.dissolved_rows(reads0, CWR.DOCS)
live = {k: r for k, r in cands.items() if CWR._KEY.fullmatch(k) and k not in CWR.EXCLUDE_IDS
        and r.get("archived", "").lower() != "true" and r.get("status", "").lower() != "not hiring"}
NEW = next((k for k, r in live.items() if CWR.stage_of(r.get("status")) == "new" and k in analyses
            and analyses[k].get("decisionstatus", "").lower() != "advance"), None)
PS = next((k for k, r in live.items() if CWR.stage_of(r.get("status")) == "phone-screen"
           and screens.get(k, {}).get("screenstatus", "").lower() != "completed"), None)
SCREENED = next((k for k in screens if k in live), None)
ONB = next((k for k, r in live.items() if CWR.stage_of(r.get("status")) in ("onboarding", "hired", "ready")), None)
ANY = NEW or next(iter(live), None)
facts["subjects"] = (f"{len(cands)} candidates on the facts ({len(live)} in the process), {len(analyses)} analyses, "
                     f"{len(screens)} phone screens, {len(docs)} document rows; a New one without the decision "
                     f"{'found' if NEW else 'absent'}, one at Phone Screen {'found' if PS else 'absent'}, one with a screen "
                     f"{'found' if SCREENED else 'absent'}, one past Onboarding {'found' if ONB else 'absent'}")
check("real candidates are read from the dissolved facts", bool(NEW and PS and SCREENED and ONB))
facts["events dual-write"] = "on" if CWR.events_on(reads0) else "off"


def notes():
    HOLDER["shut"] = ""
    EDITIONS["value"] = "[]"
    code, env, wid = write("candidateProfileNoteAdd", MASTER, {"candidate": ANY, "body": "Check — a note"})
    got = rows_of(wid, "master · note")
    check("the master files a note: 200, final, kept in app.edits",
          env.get("status") == 200 and plan(env).get("final") is True, env)
    kept = facts_in(got)
    jid = env.get("data", {}).get("note", {}).get("id", "")[4:]
    check("its journey line is 13 facts under one new journey id",
          sorted(f for (s, f) in kept if s == jid) == sorted(CWR.norm(h) for h in CWR.JOURNEY_HEADER), sorted(kept)[:20])
    check("the line is a note by the presser, recorded as the journey's append",
          kept.get((jid, "step"), ("",))[0] == "note" and kept.get((jid, "detail"), ("",))[0] == "Check — a note"
          and kept.get((jid, "by"), ("",))[0] == M.caller(MASTER, L.Reads(db, None))["email"]
          and kept.get((jid, "step"), ("", ""))[1] == "append")
    check("the Events dual-write row rides only while the events book is on",
          any(r[0] == "Events" for r in got) == CWR.events_on(reads0))
    check("the master's write names no edition", all(r[6] == "" for r in got))
    own = laid_reads()
    tok = hubdb.OWN.set(own)
    try:
        laid = CWR.dissolved_rows(L.Reads(db, None), CWR.JOURNEY, [jid]).get(jid)
    finally:
        hubdb.OWN.reset(tok)
    check("the next read lays the kept note over the copy", bool(laid) and laid.get("detail") == "Check — a note")
    code, env, _ = write("candidateProfileNoteAdd", HOLD, {"candidate": ANY, "body": "Check"})
    check("released but not listed: 'Unknown action.'", env == {"status": 404, "message": "Unknown action."}, env)
    listed("candidates.notes")
    code, env, wid = write("candidateProfileNoteAdd", HOLD, {"candidate": ANY, "body": "Check — listed note"})
    got2 = rows_of(wid, "listed (candidates.notes) · note")
    check("listed on candidates.notes: the note is kept, final", env.get("status") == 200 and plan(env).get("final"), env)
    check("every row it keeps names candidates.notes", got2 and all(r[6] == "candidates.notes" for r in got2))
    HOLDER["shut"] = HOLD["uid"]
    code, env, _ = write("candidateProfileNoteAdd", HOLD, {"candidate": ANY, "body": "Check"})
    check("listed but App Control does not release the app: 'Unknown action.'", env.get("status") == 404, env)
    HOLDER["shut"] = ""
    real_gate = W.gate

    def armed(_reads):
        raise sc.Defer("the book-write gate is armed (simulated)")
    W.gate = armed
    try:
        code, env, _ = write("candidateProfileNoteAdd", MASTER, {"candidate": ANY, "body": "Check — held"})
        check("the book-write gate armed: the master's note is not decided here either (Python's 503, never Apps Script)",
              code == 503 and "defer" in env and not plan(env), env)
        code, env, _ = write("candidateProfileNoteAdd", HOLD, {"candidate": ANY, "body": "Check — held"})
        check("the gate armed, a holder's note is not decided here (the relay says nothing was saved)",
              code == 503 and "defer" in env, env)
    finally:
        W.gate = real_gate
    code, env, _ = write("candidateProfileNoteAdd", MASTER, {"candidate": ANY, "body": "   "})
    check("a blank note is refused 400", env.get("status") == 400, env)
    code, env, _ = write("candidateProfileNoteAdd", MASTER, {"candidate": ANY, "body": "x" * 901})
    check("a note past 900 characters is refused 400", env.get("status") == 400, env)
    code, env, _ = write("candidateProfileNoteAdd", MASTER, {"candidate": "CAN_NOSUCHONE1", "body": "x"})
    check("a candidate no record carries is refused 400", env.get("status") == 400 and "is on file" in env.get("message", ""), env)
    # the note just filed, edited and removed (read back through the laid edits)
    code, env, wid = write("candidateProfileNoteEdit", MASTER, {"candidate": ANY, "id": "jrn_" + jid, "changes": [
        {"field": "body", "value": "Check — edited", "expected": "Check — a note"}]})
    got3 = rows_of(wid, "master · note edit")
    check("the master edits the note's text: one detail fact, final",
          env.get("status") == 200 and [f for (s, f) in facts_in(got3)] == ["detail"], env)
    code, env, _ = write("candidateProfileNoteEdit", MASTER, {"candidate": ANY, "id": "jrn_" + jid, "changes": [
        {"field": "body", "value": "Again", "expected": "Check — a note"}]})
    check("a stale witness is 409 with what the note holds now",
          env.get("status") == 409 and env.get("data", {}).get("current", {}).get("body") == "Check — edited", env)
    code, env, _ = write("candidateProfileNoteEdit", HOLD, {"candidate": ANY, "id": "jrn_" + jid, "changes": [
        {"field": "state", "value": "removed", "expected": "open"}]})
    check("listed on candidates.notes: the note is removed (its row tombstoned)", env.get("status") == 200, env)
    code, env, _ = write("candidateProfileNoteEdit", MASTER, {"candidate": ANY, "id": "jrn_" + jid, "changes": [
        {"field": "body", "value": "x", "expected": "Check — edited"}]})
    check("a removed note is no longer on the journey: 404", env.get("status") == 404, env)
    other = next((s for s, r in CWR.dissolved_rows(L.Reads(db, None), CWR.JOURNEY).items()
                  if r.get("candidateid") == ANY and r.get("step") not in ("note", "")), None)
    if other:
        code, env, _ = write("candidateProfileNoteEdit", MASTER, {"candidate": ANY, "id": "jrn_" + other, "changes": [
            {"field": "body", "value": "x", "expected": ""}]})
        check("a step the platform logged is never edited: 409", env.get("status") == 409, env)
    EDITIONS["value"] = "[]"
    code, env, _ = write("candidateProfileNoteEdit", HOLD, {"candidate": ANY, "id": "jrn_x" + jid, "changes": [
        {"field": "body", "value": "x", "expected": ""}]})
    check("not listed, the note edit is 'Unknown action.'", env.get("status") == 404, env)


def information():
    EDITIONS["value"] = "[]"
    raw = cands[ANY]
    code, env, wid = write("candidateProfileEdit", MASTER, {"candidate": ANY, "section": "information", "changes": [
        {"field": "source", "value": "Check source", "expected": raw.get("source", "")},
        {"field": "state", "value": "oh", "expected": raw.get("state", "")}]})
    got = rows_of(wid, "master · information (source, state)")
    kept = facts_in(got)
    check("the master edits Information: 200, final", env.get("status") == 200 and plan(env).get("final"), env)
    check("the two fields and the Hiring card's own stamp land as runtime-sheet facts, the state upper-cased",
          sorted(f for (s, f) in kept) == ["source", "state", "updatedat", "updatedby"]
          and kept[(ANY, "state")][0] == "OH" and kept[(ANY, "state")][1] == "runtime-sheet", sorted(kept))
    code, env, wid = write("candidateProfileEdit", MASTER, {"candidate": ANY, "section": "information", "changes": [
        {"field": "first_name", "value": "Checkfirst", "expected": raw.get("firstname", "")}]})
    kept = facts_in(rows_of(wid, "master · information (first name)"))
    check("a new first name recomposes the full name, as the Hiring card's edit does",
          kept.get((ANY, "candidatename"), ("",))[0].startswith("Checkfirst"), sorted(kept))
    check("the answer carries the Apply strip's steps", bool(env.get("data", {}).get("steps")), env)
    code, env, _ = write("candidateProfileEdit", MASTER, {"candidate": ANY, "section": "information", "changes": [
        {"field": "source", "value": "Other", "expected": raw.get("source", "") + "x"}]})
    check("a stale witness is 409 with what the record holds now (Python's own edit laid)",
          env.get("status") == 409 and env.get("data", {}).get("current", {}).get("source") == "Check source", env)
    code, env, _ = write("candidateProfileEdit", MASTER, {"candidate": ANY, "section": "information", "changes": [
        {"field": "position", "value": "Nurse", "expected": ""}, {"field": "cjis_status", "value": "Clear", "expected": ""},
        {"field": "zip", "value": "12", "expected": raw.get("zip", "")}, {"field": "ssn", "value": "1", "expected": ""}]})
    why = {r["field"]: r["why"] for r in env.get("data", {}).get("refused", [])}
    check("the position, the background result, a bad zip and an unknown field are each refused, nothing kept",
          env.get("status") == 200 and set(why) == {"position", "cjis_status", "zip", "ssn"} and not plan(env), env)
    code, env, _ = write("candidateProfileEdit", MASTER, {"candidate": ONB, "section": "information", "changes": [
        {"field": "email", "value": "check@example.org", "expected": cands[ONB].get("email", "")}]})
    check("from Onboarding the e-mail is the sign-in: refused here",
          env.get("data", {}).get("refused", [{}])[0].get("why") == CWR.EMAIL_SIGNIN, env)
    code, env, _ = write("candidateProfileEdit", HOLD, {"candidate": ANY, "section": "information", "changes": [
        {"field": "city", "value": "Akron", "expected": raw.get("city", "")}]})
    check("not listed: 'Unknown action.'", env.get("status") == 404, env)
    listed("candidates.information")
    code, env, wid = write("candidateProfileEdit", HOLD, {"candidate": ANY, "section": "information", "changes": [
        {"field": "city", "value": "Check City", "expected": raw.get("city", "")}]})
    got = rows_of(wid, "listed (candidates.information) · city")
    check("listed on candidates.information: kept, final, naming the edition",
          env.get("status") == 200 and plan(env).get("final") and all(r[6] == "candidates.information" for r in got), env)
    code, env, _ = write("candidateProfileEdit", HOLD, {"candidate": ANY, "section": "preferences", "changes": [
        {"field": "has_vehicle", "value": "Yes", "expected": ""}]})
    check("the information edition does not open the preferences", env.get("status") == 404, env)
    s_raw = CWR.yes_no(screens[SCREENED].get("hasvehicle"))
    listed("candidates.interviews")
    code, env, wid = write("candidateProfileEdit", HOLD, {"candidate": SCREENED, "section": "preferences", "changes": [
        {"field": "has_vehicle", "value": "No" if s_raw == "Yes" else "Yes", "expected": s_raw},
        {"field": "best_in_person_day_time", "value": "2026-02-30 10:00", "expected": ""}]})
    got = rows_of(wid, "listed (candidates.interviews) · a preference")
    check("listed on candidates.interviews: a preference kept on the screen, an impossible day refused",
          env.get("status") in (200, 409) and [f for (s, f) in facts_in(got)] == ["hasvehicle"]
          and any(r["field"] == "best_in_person_day_time" for r in env.get("data", {}).get("refused", [])), env)
    unscreened = next((k for k in live if k not in screens), None)
    if unscreened:
        code, env, _ = write("candidateProfileEdit", MASTER, {"candidate": unscreened, "section": "preferences",
                                                              "changes": [{"field": "has_vehicle", "value": "Yes",
                                                                           "expected": ""}]})
        check("no phone screen on file: the preferences are refused, never a new screen row",
              env.get("data", {}).get("refused", [{}])[0].get("why") == CWR.NO_SCREEN and not plan(env), env)
    listed("candidates.information", "candidates.interviews")
    sess = L.Session(L.Reads(db, None), M.caller(HOLD, L.Reads(db, None)))
    tok = hubdb.OWN.set(laid_reads())
    try:
        er = CWR.edit_read(sess, {"candidate": ANY, "section": "information"})
        er2 = CWR.edit_read(sess, {"candidate": ANY, "section": "document", "doc": "dodd_8hr"})
    finally:
        hubdb.OWN.reset(tok)
    check("the edit panel's read: every Information field with its raw value, the lines kept elsewhere said",
          er.get("status") == 200 and {f["key"] for f in er["data"]["fields"]} == set(CWR.INFO_FIELDS)
          and len(er["data"]["elsewhere"]) == len(CWR.INFO_LOCKED)
          and next(f for f in er["data"]["fields"] if f["key"] == "city")["raw"] == "Check City", er)
    check("a section's read is 404 to whom its edition does not open", er2.get("status") == 404, er2)


def presses():
    EDITIONS["value"] = "[]"
    code, env, wid = write("candidateProfileDoor", MASTER, {"candidate": NEW, "press": "complete", "item": "resume-decision"})
    got = rows_of(wid, "master · Mark complete · résumé decision")
    kept = facts_in(got)
    check("the master's résumé decision: 200, final, the decision and the press's journey line",
          env.get("status") == 200 and plan(env).get("final") and kept.get((NEW, "decisionstatus"), ("",))[0] == "Advance"
          and any(f == "step" and v[0] == CWR.PRESS_STEP for (s, f), v in kept.items()), env)
    check("its answer is the door's own: the gate New → Phone Screen now open",
          env.get("data", {}).get("answer", {}).get("gate_passed") is True and env["data"]["door"] == "setDecision", env)
    code, env, _ = write("candidateProfileDoor", MASTER, {"candidate": NEW, "press": "complete", "item": "resume-decision"})
    check("the same step again is already complete: 409", env.get("status") == 409, env)
    code, env, wid = write("candidateProfileDoor", MASTER, {"candidate": NEW, "press": "stage", "item": "phone-screen"})
    got = rows_of(wid, "master · Update stage · New → Phone Screen")
    kept = facts_in(got)
    check("the gate open, the master moves the card: status, updated_at and updated_by as the runtime sheet writes them",
          env.get("status") == 200 and kept.get((NEW, "status"), ("", ""))[0] == "Phone Screen"
          and kept.get((NEW, "status"))[1] == "runtime-sheet" and (NEW, "updatedby") in kept, env)
    res = W.tab_of(L.Reads(db, None), CWR.STATUS_TAB)
    facts["log_status_history lives at"] = "its house's own tab" if res.declared_house else "HUB_DB"
    status_cells = {r[4] for r in got if r[0] == W.where_of(res)[1] and r[2] == CWR.STATUS_MATCH}
    check("and its row on log_status_history, wherever the tab is homed", status_cells == set(CWR.STATUS_HEADER),
          sorted(status_cells))
    code, env, _ = write("candidateProfileDoor", MASTER, {"candidate": NEW, "press": "complete", "item": "nope"})
    check("a step the record does not carry: 400", env.get("status") == 400, env)
    code, env, _ = write("candidateProfileDoor", HOLD, {"candidate": PS, "press": "complete", "item": "transcript"})
    check("not listed: the press is 'Unknown action.'", env.get("status") == 404, env)
    listed("candidates.pipeline")
    code, env, wid = write("candidateProfileDoor", HOLD, {"candidate": PS, "press": "complete", "item": "transcript",
                                                          "fields": {"notes": "Check — screened by voice"}})
    got = rows_of(wid, "listed (candidates.pipeline) · Mark complete · manual phone screen")
    kept = facts_in(got)
    check("listed on candidates.pipeline: the manual phone screen attested on the screen's record, final",
          env.get("status") == 200 and kept.get((PS, "manualscreen"), ("",))[0] == "true"
          and kept.get((PS, "screenstatus"), ("",))[0] == "Completed" and (PS, "notes") in kept
          and all(r[6] == "candidates.pipeline" for r in got), env)
    check("the press's line says the card stays at Phone Screen",
          "the card stays at Phone Screen" in env.get("data", {}).get("entry", {}).get("body", ""), env)
    code, env, wid = write("candidateProfileDoor", MASTER, {"candidate": PS, "press": "complete", "item": "advance-decision"})
    got = rows_of(wid, "master · Mark complete · advance decision")
    kept = facts_in(got)
    ans = env.get("data", {}).get("answer", {})
    check("the master's advance decision: 200, final, Advance on the screen's record",
          env.get("status") == 200 and plan(env).get("final") and kept.get((PS, "finalresult"), ("",))[0] == "Advance", env)
    facts["the advance decision's gate (the board's book riding it)"] = (
        f"passed: {ans.get('gate_passed')}, moved to: {ans.get('moved_to') or 'nowhere'}")
    moved = ans.get("moved_to") == "interview"
    by_source = {}
    for t, k, m, rk, f, v, e in got:
        if t == "Facts" and f == "Value":
            by_source[rk.split("\x1f")[1]] = v
    check("an open gate moves the card to Interview (In Person) and books its visit; a closed one moves nothing",
          (by_source.get("dissolution:entity_candidates.status") == "In Person"
           and "dissolution:entity_in_person_interviews.interviewid" in by_source) if moved
          else "dissolution:entity_candidates.status" not in by_source, sorted(by_source))
    CND.FORCE[NEW] = {"stage": "interview", "gate": {"from": "interview", "to": "onboarding", "ok": True, "reasons": []},
                      "stages": [{"id": "onboarding", "label": "Onboarding", "current": False, "reachable": True,
                                  "door": {"action": "moveStage", "form": "",
                                           "payload": {"candidate_id": NEW, "to_stage": "onboarding"}}, "why": ""}]}
    try:
        code, env, wid = write("candidateProfileDoor", MASTER, {"candidate": NEW, "press": "stage", "item": "onboarding"})
        kept = facts_in(rows_of(wid, "master · Update stage · into Onboarding"))
        check("into Onboarding: decided by Python, final, the status kept (the login is the hiring sweep's, as for every "
              "way in), nothing carried to Apps Script",
              env.get("status") == 200 and plan(env).get("final") is True and not plan(env).get("engine")
              and kept.get((NEW, "status"), ("",))[0] == "Onboarding", env)
        code, env, wid = write("candidateProfileDoor", HOLD, {"candidate": NEW, "press": "stage", "item": "onboarding"})
        got = rows_of(wid, "listed (candidates.pipeline) · Update stage · into Onboarding")
        check("a person listed on candidates.pipeline moves the card there too: final, naming the edition",
              env.get("status") == 200 and plan(env).get("final") is True and bool(got)
              and all(r[6] == "candidates.pipeline" for r in got), env)
    finally:
        CND.FORCE.pop(NEW, None)
    code, env, wid = write("candidateProfileDoor", HOLD, {"candidate": PS, "press": "stage", "item": "not-hiring"})
    got = rows_of(wid, "listed (candidates.pipeline) · Update stage · Not hiring")
    check("Not hiring (the team is told) by a staff account: the hiring door's own refusal in Python, nothing kept",
          env == {"status": 403, "message": "Requires an admin or manager account"} and not got and not plan(env), env)
    no_file = "The file is required. Nothing was written."
    for press in ("upload", "document"):
        code, env, _ = write("candidateProfileDoor", MASTER, {"candidate": PS, "press": press, "item": "cjis"})
        check(f"{press}: a paper press without its file files nothing and never reaches Apps Script",
              env.get("status") == 400 and env.get("message") == no_file and not plan(env).get("engine"), env)
        code, env, _ = write("candidateProfileDoor", HOLD, {"candidate": PS, "press": press, "item": "cjis"})
        check(f"{press}: a pipeline holder files no paper (filing is the documents edition's)",
              env.get("message") == CWR.UNKNOWN, env)
    listed("candidates.documents")
    try:
        for press in ("upload", "document"):
            code, env, _ = write("candidateProfileDoor", HOLD, {"candidate": PS, "press": press, "item": "cjis"})
            check(f"{press}: a documents holder's paper is the relay's to read and file (candidate_papers)",
                  env.get("status") == 400 and env.get("message") == no_file and not plan(env).get("engine"), env)
    finally:
        listed("candidates.pipeline")


def documents():
    EDITIONS["value"] = "[]"
    real_rows = CWR.dissolved_rows
    sim = {"DOC_CHECKSIMULATED01": {"docrowid": "DOC_CHECKSIMULATED01", "candidateid": ANY, "docid": "dodd_8hr",
                                    "doclabel": "8-Hr DODD Training Certificate", "status": "uploaded",
                                    "reviewstatus": "pending", "filename": "dodd.pdf"}}

    def with_sim(reads, tab, subjects=None):
        rows = real_rows(reads, tab, subjects)
        if tab == CWR.DOCS:
            rows = {**rows, **{k: {**r, **rows.get(k, {})} for k, r in sim.items()}}
        return rows
    CWR.dissolved_rows = with_sim
    try:
        code, env, _ = write("candidateProfileDocReview", MASTER, {"candidate": ANY, "doc": "cjis", "changes": [
            {"field": "review_status", "value": "verified", "expected": ""}]})
        check("the background check's result is never reviewed here: 409", env.get("status") == 409
              and env.get("message") == CWR.DOC_LOCKED, env)
        code, env, wid = write("candidateProfileDocReview", MASTER, {"candidate": ANY, "doc": "doc_dodd_8hr", "changes": [
            {"field": "review_status", "value": "Verified", "expected": "pending"},
            {"field": "issued_on", "value": "2026-01-15", "expected": ""}]})
        got = rows_of(wid, "master · document review (a simulated row) · verified + issued")
        kept = facts_in(got)
        check("the master verifies a filed document: status, review, who and when, and the issued day, final",
              env.get("status") == 200 and sorted(f for (s, f) in kept) ==
              ["issuedon", "reviewstatus", "status", "verifiedat", "verifiedby"]
              and all(v[1] == "runtime-sheet" for v in kept.values()), env)
        code, env, _ = write("candidateProfileDocReview", MASTER, {"candidate": ANY, "doc": "dodd_8hr", "changes": [
            {"field": "expires_on", "value": "someday", "expected": ""}, {"field": "notes", "value": "x", "expected": "y"}]})
        check("a day not written as a day is refused and a stale note is 409",
              env.get("status") == 409 and env["data"]["refused"][0]["field"] == "expires_on", env)
        code, env, _ = write("candidateProfileDocReview", HOLD, {"candidate": ANY, "doc": "dodd_8hr", "changes": [
            {"field": "notes", "value": "x", "expected": ""}]})
        check("not listed: 'Unknown action.'", env.get("status") == 404, env)
        listed("candidates.documents")
        code, env, wid = write("candidateProfileDocReview", HOLD, {"candidate": ANY, "doc": "dodd_8hr", "changes": [
            {"field": "review_status", "value": "returned", "expected": "verified"}]})
        got = rows_of(wid, "listed (candidates.documents) · returned")
        check("listed on candidates.documents: returned, final, naming the edition",
              env.get("status") == 200 and all(r[6] == "candidates.documents" for r in got), env)
        code, env, _ = write("candidateProfileDocReview", MASTER, {"candidate": ANY, "doc": "hs_diploma", "changes": [
            {"field": "notes", "value": "x", "expected": ""}]})
        check("a paper with no row on file: 404", env.get("status") == 404, env)
    finally:
        CWR.dissolved_rows = real_rows


try:
    with real.transaction():
        for name, fn in (("notes", notes), ("information and preferences", information), ("presses", presses),
                         ("documents", documents)):
            if ANY and NEW and PS and SCREENED and ONB and holder:
                guarded(name, fn)
        with real.cursor() as c:
            c.execute("select count(*), count(distinct write_id) from pg_temp.hub_edits_cnd")
            n, w = c.fetchone()
        facts["cells kept in the check's app.edits (temp)"] = f"{n} cells from {w} writes"
        facts["slowest decision per door (the relay waits 10 s, the app 7 s)"] = ", ".join(
            f"{a} {s:.2f}s" for a, s in sorted(SLOWEST.items()))
        raise psycopg.Rollback()
finally:
    try:
        real.close()
    except Exception:
        pass
print(json.dumps({"checks": out, "facts": facts, "rows": rows_out}))
'''

# the catalogue entries this app adds to app/editions.py (the integrator lands them there)
EDITIONS_NEW = [
    {"id": "candidates.information", "app": "staff-candidates", "app_name": "Staff Candidates",
     "label": "Information — the candidate's details", "description": ""},
    {"id": "candidates.pipeline", "app": "staff-candidates", "app_name": "Staff Candidates",
     "label": "Pipeline — mark a step complete and move the stage", "description": ""},
    {"id": "candidates.notes", "app": "staff-candidates", "app_name": "Staff Candidates",
     "label": "Notes — add, edit or remove a note", "description": ""},
    {"id": "candidates.interviews", "app": "staff-candidates", "app_name": "Staff Candidates",
     "label": "Interviews — the phone screen's preferences and notes", "description": ""},
    {"id": "candidates.documents", "app": "staff-candidates", "app_name": "Staff Candidates",
     "label": "Documents — file and review a document", "description": ""},
]


def main() -> int:
    py_compile.compile(str(ROOT / "app" / "candidate_writes.py"), doraise=True)
    print("ok   app/candidate_writes.py compiles")
    app = {p.stem: p.read_text(encoding="utf-8") for p in (ROOT / "app").glob("*.py")}
    reads = "app/candidates.py" if "candidates" in app else "stand-in (app/candidates.py is not in this tree)"
    app.setdefault("candidates", STAND_IN)
    blob = {"app": app, "reads": reads, "editions": EDITIONS_NEW}
    got = subprocess.run(["docker", "exec", "-i", "-e", "MALLOC_ARENA_MAX=2", DB_RUNNER, "python", "-c", DRIVER],
                         input=base64.b64encode(json.dumps(blob).encode()) + b"\n", capture_output=True, timeout=900)
    lines = got.stdout.decode().strip().splitlines()
    if got.returncode != 0 or not lines:
        print("FAIL the driver ran in asa-hub-db-sync")
        print(got.stderr.decode()[-2500:])
        return 1
    res = json.loads(lines[-1])
    failed = 0
    for name, ok, detail in res["checks"]:
        print(("ok   " if ok else "FAIL ") + name + ("" if ok else f"\n       {detail}"))
        failed += 0 if ok else 1
    for k, v in res["facts"].items():
        print(f"fact {k}: {v}")
    for w in res["rows"]:
        print(f"rows {w['write']}:")
        for r in w["rows"]:
            print("     " + " | ".join(str(x) for x in r))
    print(f"{len(res['checks']) - failed} ok, {failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
