#!/usr/bin/env python3
"""Client Candidates' writes and editions decided by the streamed modules on a real referral in asa-hub-db-sync: the
master, a person not listed, a listed person, a stale witness, a protected value, a paper filed by its read (Drive
simulated) and the exact cells each write keeps: app.edits' rows, or Postgres' own record while Potential Clients is
Python's. Nothing real is written: the edit store lives in temp tables, and every write inside one transaction rolled
back at the end. Shapes only."""
from __future__ import annotations

import base64
import json
import py_compile
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DB_RUNNER = "asa-hub-db-sync"

DRIVER = r'''
import base64, importlib.abc, importlib.util, json, sys, time, types, uuid
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
import gsjs, hubdb, scope as sc, locations as L, writes as W, editions as ED
import client_candidate_writes as CCW
import recon as RC
import main as M

out, facts, rows_out = [], {}, []


def check(name, ok, detail=""):
    out.append([name, bool(ok), "" if ok else str(detail)[:400]])


W.EDITS_TABLE = "pg_temp.hub_edits_ccw"
W.LOCK_KEY = 0x4343575254


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
real = psycopg.connect(hubdb._dsn(), autocommit=False, connect_timeout=5, application_name="client-candidate-writes-check")
proxy = Conn(real)
store = W.Store(connect=lambda: proxy, kind="check", label="Check")
EDITIONS = {"value": "[]"}
base_cfg = db.hiring_config
db.hiring_config = lambda: {**base_cfg(), sc.EDITIONS_KEY: EDITIONS["value"]}
db.stale = lambda books: False
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
M.WRITES["client-candidates"] = CCW
M.stores = lambda: {"client-candidates": store}
M.WRITE_BUDGET_S = 120.0
seq = [0]
UNKNOWN = {"status": 404, "message": "Unknown action."}


def listed(*eids):
    EDITIONS["value"] = json.dumps([{"id": e, "on": True, "people": [HOLDER["id"]]} for e in eids])


def write(action, who, payload):
    seq[0] += 1
    wid = f"Wcheck-ccw-{seq[0]:04d}-{uuid.uuid4().hex[:8]}"
    res = M._run_write(CCW, action, who, payload, wid)
    return res.status_code, json.loads(res.body), wid


def read(who, payload):
    user = M.caller(who, L.Reads(db, None))
    return seen(lambda: CCW.edit_read(L.Session(L.Reads(db, None), user), payload))


def laid():
    import client_writes as CW
    return CW.Own([], book=db.book, edits=store.edits(), edits_at=time.time())


def seen(fn):
    """A read as the next one sees the check's writes: the kept edits laid, and the rows Postgres keeps read on the
    check's own connection, inside its transaction."""
    tok, held = hubdb.OWN.set(laid()), W.HELD.set(proxy.cursor())
    try:
        return fn()
    finally:
        W.HELD.reset(held)
        hubdb.OWN.reset(tok)


def row_now(key):
    return seen(lambda: CCW.ctx_of(L.Reads(db, None), key).get("row") or {})


def plan(env):
    return env.get("_write") or {}


def kept_of(wid):
    """(tab, kind, match, row key, field, value, edition) of each cell one write kept in app.edits — or, while Potential
    Clients is Postgres' own, each cell its app.resource_changes rows changed, the account that wrote it in the
    edition's place (that record names no edition)."""
    with real.cursor() as c:
        if not IN_PG:
            c.execute("select tab_name, kind, match_by, row_key, field, value, edition from pg_temp.hub_edits_ccw"
                      " where write_id = %s order by id", (wid,))
            return c.fetchall()
        c.execute("select resource, kind, before, after, by_email from app.resource_changes where write_id = %s"
                  " order by id", (wid,))
        got = []
        for res, kind, before, after, by in c.fetchall():
            before, after = [(json.loads(x) if isinstance(x, str) else x) or {} for x in (before, after)]
            rid = gsjs.str_(after.get("id") or before.get("id"))
            got += [(res, "edit" if kind == "update" else kind, "id", rid, f, gsjs.str_(after[f]), (by or "").lower())
                    for f in after if after.get(f) != before.get(f)]
        return got


def named(got, edition, who):
    """Every cell names the edition the write came in by (the master's none) — in Postgres, the account that wrote it."""
    want = gsjs.str_((who or {}).get("email")).lower() if IN_PG else edition
    return bool(got) and all(r[6] == want for r in got)


def by_shown(e):
    if not IN_PG:
        return e or "(master)"
    return "(by the master)" if e == gsjs.str_(master.get("email")).lower() else \
        "(by the holder)" if e == gsjs.str_(holder.get("email")).lower() else "(by another account)"


def rows_of(wid, label):
    got = kept_of(wid)
    shown = []
    for t, k, m, rk, f, v, e in got:
        if f == "stage":
            said = v
        elif f == CCW.LOG_FIELD:
            lst = json.loads(v)
            said = f"<{len(lst)} entries; last {lst[-1]['kind']}: {lst[-1]['text'][:60]}>"
        elif f in (CCW.DOCS_FIELD, CCW.PREFS_FIELD):
            said = "<keys " + ",".join(sorted(json.loads(v))) + ">"
        else:
            said = f"<{len(v)} chars>" if v else ""
        shown.append([t, k, m, "<the referral>" if rk == KEY else "<another>", f, said, by_shown(e)])
    rows_out.append({"write": label, "rows": shown})
    return got


def fields_of(got):
    return sorted(r[4] for r in got)


def guarded(name, fn):
    try:
        with real.transaction():
            fn()
    except Exception as exc:  # noqa: BLE001 - said as a failed check, never a value
        import traceback
        check(name + ": ran to the end", False, type(exc).__name__ + ": " + str(exc)[:200] + " @ " +
              traceback.format_exc().strip().splitlines()[-3][:160])


reads0 = L.Reads(db, None)
users = [u for u in reads0.users() if gsjs.str_(u.get("userid")) and not gsjs.str_(u.get("mergedinto"))]
master = next((u for u in users if gsjs.str_(u.get("email")).lower() == sc.MASTER_ACCOUNT), None)
holder = next((u for u in users if gsjs.str_(u.get("role")).lower() == "staff" and not gsjs.str_(u.get("clientkey"))
               and gsjs.str_(u.get("active")).lower() != "false" and gsjs.str_(u.get("email")).lower() != sc.MASTER_ACCOUNT),
              None)
MASTER = {"uid": gsjs.str_((master or {}).get("userid")) or "USR_MASTER", "role": "admin", "is_master": True}
HOLD = {"uid": gsjs.str_((holder or {}).get("userid")), "role": "staff", "is_master": False}
HOLDER["id"] = HOLD["uid"]
facts["accounts"] = f"master row {'found' if master else 'absent'}, a staff account {'found' if holder else 'absent'}"
check("a staff account (not a client) is read from the users tab", bool(holder))
with real.transaction():
    store.ensure()
    check("the edit store is made in temp tables", store.ready(), store.why)

_res, leads0 = CCW.leads(reads0)
IN_PG = _res is CCW.KEPT
facts["the referrals live in"] = ("Postgres' own rows (app.resource_rows, each change in app.resource_changes)" if IN_PG
                                  else "the sheet's copy, Python's cells in app.edits")
fresh = [r for r in leads0 if gsjs.str_(r.get("client_name")) and CCW._KEY.fullmatch(gsjs.str_(r.get("id")))
         and CCW.stage_of(CCW.stage_id(r.get("stage"))) == "referral" and not gsjs.str_(r.get("notes"))
         and not any(CCW.protected(gsjs.str_(r.get(f))) for f in CCW.INFO_FIELDS)]
KEY = gsjs.str_(fresh[0].get("id")) if fresh else ""
OTHER = gsjs.str_(fresh[1].get("id")) if len(fresh) > 1 else ""
facts["subjects"] = (f"{len(leads0)} referrals on the copy, {len(fresh)} at Referral with no notes; one for the "
                     f"writes {'found' if KEY else 'absent'}, one for the simulations {'found' if OTHER else 'absent'}")
check("real referrals are read from the copy's potentialClients", bool(KEY and OTHER))


def pipeline():
    EDITIONS["value"] = "[]"
    code, env, wid = write("clientCandidateWrite", MASTER, {"candidate_id": KEY, "kind": "note", "note": "Check — a note"})
    got = rows_of(wid, "master · Add note")
    check("the master adds a note: 200, final", env.get("status") == 200 and plan(env).get("final") is True, env)
    check("one edit of the referral's own row: notes, candidate_log, updatedAt, keyed by id, naming no edition (in "
          "Postgres, under the master's account)",
          fields_of(got) == ["candidate_log", "notes", "updatedAt"] and all(r[0] == "potentialClients" and r[1] == "edit"
          and r[2] == "id" and r[3] == KEY for r in got) and named(got, "", master), [r[:5] for r in got])
    row = row_now(KEY)
    check("the next read lays the note: one line, stamped, ending in its words",
          row.get("notes", "").endswith("— Check — a note") and len(row.get("notes", "").split("\n")) == 1)
    check("the log carries 'Note added'", CCW.log_of(row.get(CCW.LOG_FIELD))[-1:] and
          CCW.log_of(row.get(CCW.LOG_FIELD))[-1]["text"] == "Note added")
    code, env, _ = write("clientCandidateWrite", HOLD, {"candidate_id": KEY, "kind": "note", "note": "x"})
    check("not listed: 'Unknown action.'", env == UNKNOWN, env)
    listed("clientCandidates.notes")
    code, env, wid = write("clientCandidateWrite", HOLD, {"candidate_id": KEY, "kind": "note", "note": "Check — listed"})
    got = rows_of(wid, "listed (clientCandidates.notes) · Add note")
    check("listed on clientCandidates.notes: kept, final, naming the edition (in Postgres, the holder's account)",
          env.get("status") == 200 and plan(env).get("final") and named(got, "clientCandidates.notes", holder), env)
    code, env, _ = write("clientCandidateWrite", HOLD, {"candidate_id": KEY, "kind": "stage", "stage": "Discovery"})
    check("the notes edition does not open Update stage", env == UNKNOWN, env)
    HOLDER["shut"] = HOLD["uid"]
    code, env, _ = write("clientCandidateWrite", HOLD, {"candidate_id": KEY, "kind": "note", "note": "x"})
    check("listed but App Control keeps the app closed: 'Unknown action.'", env == UNKNOWN, env)
    HOLDER["shut"] = ""
    code, env, wid = write("clientCandidateWrite", MASTER, {"candidate_id": KEY, "kind": "stage", "stage": "discovery",
                                                            "expected_stage": "new"})
    got = rows_of(wid, "master · Update stage → Discovery")
    check("the master moves the stage: the label on the row, its log line",
          env.get("status") == 200 and env["data"]["row"].get("stage") == "Discovery"
          and fields_of(got) == ["candidate_log", "stage", "updatedAt"], env)
    code, env, _ = write("clientCandidateWrite", MASTER, {"candidate_id": KEY, "kind": "stage", "stage": "assessment",
                                                          "expected_stage": "new"})
    check("a stage the panel opened on that moved since: 409, nothing written",
          env.get("status") == 409 and env.get("data", {}).get("current", {}).get("stage") == "Discovery", env)
    code, env, _ = write("clientCandidateWrite", MASTER, {"candidate_id": KEY, "kind": "stage", "stage": "Discovery"})
    check("the stage it is already at: 409", env.get("status") == 409, env)
    code, env, _ = write("clientCandidateWrite", MASTER, {"candidate_id": KEY, "kind": "complete", "item": "placement"})
    check("a step that is not next: 409", env.get("status") == 409, env)
    listed("clientCandidates.pipeline")
    code, env, wid = write("clientCandidateWrite", HOLD, {"candidate_id": KEY, "kind": "complete", "item": "assessment",
                                                          "note": "Check — assessed"})
    got = rows_of(wid, "listed (clientCandidates.pipeline) · Mark complete with a note")
    check("listed on clientCandidates.pipeline: the next step completed, its note riding, naming the edition (in "
          "Postgres, the holder's account)",
          env.get("status") == 200 and env["data"]["row"].get("stage") == "Placement Review"
          and fields_of(got) == ["candidate_log", "notes", "stage", "updatedAt"]
          and named(got, "clientCandidates.pipeline", holder), env)
    code, env, wid = write("clientCandidateWrite", HOLD, {"candidate_id": KEY, "kind": "reopen", "item": "assessment"})
    check("and reopens it: back to Discovery", env.get("status") == 200 and env["data"]["row"].get("stage") == "Discovery",
          env)
    code, env, _ = write("clientCandidateWrite", MASTER, {"candidate_id": "LEA_NO_SUCH_ONE", "kind": "note", "note": "x"})
    check("a referral no row carries: 400", env.get("status") == 400 and "is on file" in env.get("message", ""), env)
    code, env, _ = write("clientCandidateWrite", MASTER, {"candidate_id": KEY, "kind": "note", "note": "x" * 901})
    check("a note past 900 characters: 400", env.get("status") == 400, env)
    real_gate = W.gate

    def armed(_reads):
        raise sc.Defer("the book-write gate is armed (simulated)")
    W.gate = armed
    try:
        code, env, _ = write("clientCandidateWrite", MASTER, {"candidate_id": KEY, "kind": "note", "note": "held"})
        check("the book-write gate armed: the master's press is not decided here (Python's 503, never Apps Script)",
              code == 503 and "defer" in env and not plan(env), env)
    finally:
        W.gate = real_gate


def information():
    EDITIONS["value"] = "[]"
    row = row_now(KEY)
    code, env, wid = write("clientCandidateEdit", MASTER, {"candidate": KEY, "section": "information", "changes": [
        {"field": "owner", "value": "Check Coordinator", "expected": row.get("owner", "")},
        {"field": "postal_code", "value": "43215", "expected": row.get("postal_code", "")}]})
    got = rows_of(wid, "master · Information (coordinator, ZIP)")
    check("the master edits Information: 200, final, the two columns with the log and updatedAt",
          env.get("status") == 200 and plan(env).get("final") and fields_of(got) ==
          ["candidate_log", "owner", "postal_code", "updatedAt"] and bool(env["data"].get("steps")), env)
    code, env, _ = write("clientCandidateEdit", MASTER, {"candidate": KEY, "section": "information", "changes": [
        {"field": "owner", "value": "Other", "expected": row.get("owner", "")}]})
    check("a stale witness: 409 with what the row holds now (Python's own edit laid)",
          env.get("status") == 409 and env.get("data", {}).get("current", {}).get("owner") == "Check Coordinator", env)
    code, env, _ = write("clientCandidateEdit", MASTER, {"candidate": KEY, "section": "information", "changes": [
        {"field": "diagnosis", "value": "Check SSN 123-45-6789", "expected": row.get("diagnosis", "")},
        {"field": "referral_id", "value": "1", "expected": row.get("referral_id", "")},
        {"field": "phone", "value": "123", "expected": row.get("phone", "")},
        {"field": "client_name", "value": "", "expected": row.get("client_name", "")}]})
    why = {r["field"]: r["why"] for r in env.get("data", {}).get("refused", [])}
    check("a protected number typed, the referral number, a short phone and a blank name: each refused, nothing kept",
          env.get("status") == 200 and set(why) == {"diagnosis", "referral_id", "phone", "client_name"}
          and why["diagnosis"] == CCW.NEVER_TYPED and not plan(env), env)
    code, env, _ = write("clientCandidateEdit", HOLD, {"candidate": KEY, "section": "information", "changes": [
        {"field": "source", "value": "x", "expected": row.get("source", "")}]})
    check("not listed: 'Unknown action.'", env == UNKNOWN, env)
    listed("clientCandidates.information")
    code, env, wid = write("clientCandidateEdit", HOLD, {"candidate": KEY, "section": "information", "changes": [
        {"field": "source", "value": "Check source", "expected": row.get("source", "")}]})
    got = rows_of(wid, "listed (clientCandidates.information) · source")
    check("listed on clientCandidates.information: kept, final, naming the edition (in Postgres, the holder's account)",
          env.get("status") == 200 and plan(env).get("final") and named(got, "clientCandidates.information", holder), env)
    code, env, _ = write("clientCandidateEdit", HOLD, {"candidate": KEY, "section": "intake", "changes": [
        {"field": "next_step", "value": "x", "expected": row.get("next_step", "")}]})
    check("the information edition does not open the intake", env == UNKNOWN, env)
    listed("clientCandidates.intake")
    code, env, wid = write("clientCandidateEdit", HOLD, {"candidate": KEY, "section": "intake", "changes": [
        {"field": "next_step", "value": "Check — call the family", "expected": row.get("next_step", "")},
        {"field": "contact_method", "value": "Phone call", "expected": ""},
        {"field": "best_time", "value": "Mornings", "expected": ""}]})
    got = rows_of(wid, "listed (clientCandidates.intake) · next step and contact preferences")
    prefs = CCW.prefs_of(row_now(KEY).get(CCW.PREFS_FIELD))
    check("listed on clientCandidates.intake: the next step and the preferences' one JSON cell",
          env.get("status") == 200 and fields_of(got) == ["candidate_log", "contact_preferences", "next_step", "updatedAt"]
          and prefs == {"method": "Phone call", "best_time": "Mornings", "who": ""}, env)
    got = read(HOLD, {"candidate": KEY, "section": "intake"})
    check("the intake panel's read opens to the holder with the laid values",
          got.get("status") == 200 and {f["key"]: f["raw"] for f in got["data"]["fields"]}.get("best_time") == "Mornings",
          got.get("status"))
    EDITIONS["value"] = "[]"
    check("not listed, the panel's read is 'Unknown action.'", read(HOLD, {"candidate": KEY, "section": "intake"}) == UNKNOWN)


def notes():
    EDITIONS["value"] = "[]"
    lines = [x for x in row_now(KEY).get("notes", "").split("\n") if x.strip()]
    n = next((i + 1 for i, x in enumerate(lines) if x.endswith("— Check — a note")), 0)
    got = read(MASTER, {"candidate": KEY, "section": "note", "id": f"note_{n}"})
    body = (got.get("data") or {}).get("fields", [{}])[0].get("raw")
    check("the note panel's read: the words alone, the stamp kept apart", got.get("status") == 200 and body == "Check — a note"
          and bool(got["data"].get("at")), got.get("status"))
    code, env, wid = write("clientCandidateNoteEdit", MASTER, {"candidate": KEY, "id": f"note_{n}", "changes": [
        {"field": "body", "value": "Check — edited", "expected": "Check — a note"}]})
    got = rows_of(wid, "master · note edited")
    after = [x for x in row_now(KEY).get("notes", "").split("\n") if x.strip()]
    check("the master edits a note's words: its stamp kept, the other lines as they were",
          env.get("status") == 200 and fields_of(got) == ["candidate_log", "notes", "updatedAt"]
          and after[n - 1].endswith("— Check — edited") and after[n - 1][:19] == lines[n - 1][:19]
          and len(after) == len(lines), env)
    code, env, _ = write("clientCandidateNoteEdit", MASTER, {"candidate": KEY, "id": f"note_{n}", "changes": [
        {"field": "body", "value": "Again", "expected": "Check — a note"}]})
    check("a stale witness: 409 with the words now", env.get("status") == 409
          and env.get("data", {}).get("current", {}).get("body") == "Check — edited", env)
    listed("clientCandidates.notes")
    code, env, wid = write("clientCandidateNoteEdit", HOLD, {"candidate": KEY, "id": f"note_{n}", "changes": [
        {"field": "state", "value": "removed", "expected": "Check — edited"}]})
    got = rows_of(wid, "listed (clientCandidates.notes) · note removed")
    check("listed on clientCandidates.notes: the note removed, one line fewer",
          env.get("status") == 200 and named(got, "clientCandidates.notes", holder)
          and len([x for x in row_now(KEY).get("notes", "").split("\n") if x.strip()]) == len(lines) - 1, env)
    EDITIONS["value"] = "[]"
    code, env, _ = write("clientCandidateNoteEdit", HOLD, {"candidate": KEY, "id": "note_1", "changes": [
        {"field": "body", "value": "x", "expected": ""}]})
    check("not listed: 'Unknown action.'", env == UNKNOWN, env)


def documents():
    EDITIONS["value"] = "[]"
    sim = json.dumps({"consent": {"file_id": "FILE_CHECK_SIMULATED", "name": "consent.pdf", "mime": "application/pdf",
                                  "at": "2026-01-01T00:00:00.000Z", "by": "Check"}})
    real_leads = CCW.leads

    def with_sim(reads):
        # only while the referral holds no papers' record at all: an emptied one ({} as Postgres hands it) stays empty
        res, rows = real_leads(reads)
        return res, [{**r, CCW.DOCS_FIELD: sim, "diagnosis": "Check DOB 01/02/1990"}
                     if r.get("id") == OTHER and r.get(CCW.DOCS_FIELD) in (None, "") else r for r in rows]
    CCW.leads = with_sim
    try:
        got = read(MASTER, {"candidate": OTHER, "section": "information"})
        diag = next((f for f in got.get("data", {}).get("fields", []) if f["key"] == "diagnosis"), {})
        check("a value holding a protected number is drawn withheld and locked in the panel",
              bool(diag.get("lockedBy")) and "[withheld]" in diag.get("raw", ""), diag.get("lockedBy"))
        code, env, _ = write("clientCandidateEdit", MASTER, {"candidate": OTHER, "section": "information", "changes": [
            {"field": "diagnosis", "value": "x", "expected": diag.get("raw", "")}]})
        check("and its edit is refused, nothing kept", env.get("status") == 200 and not plan(env)
              and env["data"]["refused"][0]["why"] == CCW.PROTECTED, env)
        code, env, wid = write("clientCandidateFile", MASTER, {"candidate_id": OTHER, "doc": "consent", "confirm": True})
        got = rows_of(wid, "master · consent confirmed (a simulated paper)")
        docs = CCW.docs_of(row_now(OTHER).get(CCW.DOCS_FIELD))
        check("the master confirms the filed consent: kept on the row, final",
              env.get("status") == 200 and plan(env).get("final") and fields_of(got) ==
              ["candidate_docs", "candidate_log", "updatedAt"] and bool(docs.get("consent", {}).get("confirmed_at")), env)
        code, env, _ = write("clientCandidateFile", MASTER, {"candidate_id": OTHER, "doc": "consent", "confirm": True})
        check("confirmed twice: 409", env.get("status") == 409, env)
        paper = {"candidate_id": OTHER, "doc": "assessment", "file": {"filename": "a.pdf", "base64": "JVBERi0="}}
        code, env, _ = write("clientCandidateFile", MASTER, paper)
        check("a paper the master presses without its filing read: 503, nothing filed or kept, never Apps Script",
              env.get("status") == 503 and env.get("message") == CCW.NOT_FILED and not plan(env), env)
        sess = L.Session(L.Reads(db, None), M.caller(MASTER, L.Reads(db, None)))
        got = seen(lambda: CCW.file_prepare(sess, paper))
        check("its filing read refuses as the .gs does before Drive: the assessment waits for the Assessment stage",
              got.get("status") == 409 and "filed at the Assessment stage" in got.get("message", ""), got)
        code, env, _ = write("clientCandidateDocEdit", HOLD, {"candidate": OTHER, "doc": "consent", "changes": [
            {"field": "confirmed", "value": "No", "expected": "Yes"}]})
        check("not listed: 'Unknown action.'", env == UNKNOWN, env)
        listed("clientCandidates.documents")
        code, env, _ = write("clientCandidateFile", HOLD, paper)
        check("a listed holder files a paper as the master does (Drive is Python's): without its read, 503, nothing kept",
              env.get("status") == 503 and env.get("message") == CCW.NOT_FILED and not plan(env), env)
        code, env, wid = write("clientCandidateDocEdit", HOLD, {"candidate": OTHER, "doc": "consent", "changes": [
            {"field": "confirmed", "value": "No", "expected": "Yes"}]})
        got = rows_of(wid, "listed (clientCandidates.documents) · confirmation withdrawn")
        check("listed on clientCandidates.documents: the confirmation withdrawn, naming the edition (in Postgres, the "
              "holder's account)",
              env.get("status") == 200 and named(got, "clientCandidates.documents", holder)
              and not CCW.docs_of(row_now(OTHER).get(CCW.DOCS_FIELD)).get("consent", {}).get("confirmed_at"), env)
        code, env, _ = write("clientCandidateDocEdit", HOLD, {"candidate": OTHER, "doc": "consent", "changes": [
            {"field": "confirmed", "value": "Yes", "expected": "Yes"}]})
        check("a stale witness: 409", env.get("status") == 409, env)
        code, env, wid = write("clientCandidateDocEdit", HOLD, {"candidate": OTHER, "doc": "consent", "changes": [
            {"field": "state", "value": "removed", "expected": "filed"}]})
        rows_of(wid, "listed (clientCandidates.documents) · the paper's record removed")
        check("the paper's record taken off the referral", env.get("status") == 200
              and "consent" not in CCW.docs_of(row_now(OTHER).get(CCW.DOCS_FIELD)), env)
        # the paper its read filed in Drive, simulated: the read's sealed answer, as the relay hands it to the write
        sealed = RC.seal("clientCandidateFile", RC.actor(M.caller(HOLD, L.Reads(db, None))),
                         {"candidate_id": OTHER, "doc": "consent", "file_id": "FILE_CHECK_SIMULATED_0002",
                          "name": "Consent - check.pdf", "mime": "application/pdf"})
        code, env, wid = write("clientCandidateFile", HOLD, {"candidate_id": OTHER, "doc": "consent", "file": "kept",
                                                             "prepared": sealed, "method": "Phone call",
                                                             "best_time": "Mornings"})
        got = rows_of(wid, "listed (clientCandidates.documents) · a consent its read filed (Drive simulated)")
        row = row_now(OTHER)
        check("a listed holder's consent its read filed: recorded on the row with the contact preferences, final, "
              "naming the edition (in Postgres, the holder's account)",
              env.get("status") == 200 and plan(env).get("final") is True and fields_of(got) ==
              ["candidate_docs", "candidate_log", "contact_preferences", "updatedAt"]
              and CCW.docs_of(row.get(CCW.DOCS_FIELD)).get("consent", {}).get("file_id") == "FILE_CHECK_SIMULATED_0002"
              and CCW.prefs_of(row.get(CCW.PREFS_FIELD)).get("method") == "Phone call"
              and named(got, "clientCandidates.documents", holder), env)
        code, env, _ = write("clientCandidateFile", HOLD, {"candidate_id": OTHER, "doc": "consent", "file": "kept",
                                                           "prepared": {**sealed, "file_id": "FILE_CHECK_OTHER_0003"}})
        check("a filing read's answer this press did not get as sealed: 409, nothing written",
              env.get("status") == 409 and not plan(env), env)
    finally:
        CCW.leads = real_leads


try:
    with real.transaction():
        for name, fn in (("pipeline", pipeline), ("information", information), ("notes", notes),
                         ("documents", documents)):
            if KEY and OTHER and holder:
                guarded(name, fn)
        with real.cursor() as c:
            c.execute("select count(*), count(distinct write_id) from pg_temp.hub_edits_ccw")
            n, w = c.fetchone()
            c.execute("select count(*), count(distinct write_id) from app.resource_changes where write_id like %s",
                      ("Wcheck-ccw-%",))
            rn, rw_ = c.fetchone()
        facts["cells kept in the check's app.edits (temp)"] = f"{n} cells from {w} writes"
        facts["rows changed in Postgres' own record (rolled back)"] = f"{rn} changes from {rw_} writes"
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
    {"id": "clientCandidates.information", "app": "client-candidates", "app_name": "Client Candidates",
     "label": "Information — the referral's details", "description": ""},
    {"id": "clientCandidates.intake", "app": "client-candidates", "app_name": "Client Candidates",
     "label": "Intake — the next step and the contact preferences", "description": ""},
    {"id": "clientCandidates.pipeline", "app": "client-candidates", "app_name": "Client Candidates",
     "label": "Pipeline — update the stage, mark a step complete or reopen it", "description": ""},
    {"id": "clientCandidates.notes", "app": "client-candidates", "app_name": "Client Candidates",
     "label": "Notes — add, edit or remove a note", "description": ""},
    {"id": "clientCandidates.documents", "app": "client-candidates", "app_name": "Client Candidates",
     "label": "Documents — confirm the consent, take a filed paper's record off", "description": ""},
]


def main() -> int:
    py_compile.compile(str(ROOT / "app" / "client_candidate_writes.py"), doraise=True)
    print("ok   app/client_candidate_writes.py compiles")
    app = {p.stem: p.read_text(encoding="utf-8") for p in (ROOT / "app").glob("*.py")}
    blob = {"app": app, "editions": EDITIONS_NEW}
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
