#!/usr/bin/env python3
"""Families' note and call editions on real subjects, in asa-hub-db-sync: an admin note's text and its removal
(family.notes) and a scheduled call's day, priority, state and details (family.calls) — the master, a person not listed
and a listed person (the editions value and App Control's release simulated), the panels' witness read, a stale witness,
per-field refusals, each write's app.edits rows printed as shapes. Nothing real is written: the edit store lives in temp
tables inside one transaction rolled back at the end. Prints shapes, counts and timings only."""
from __future__ import annotations

import base64
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DB_RUNNER = "asa-hub-db-sync"

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
import gsjs, hubdb, scope as sc, locations as L, clients as C, writes as W, client_writes as CW
import family as F, family_writes as FW
import main as M

out, facts, rows_seen = [], {}, []


def check(name, ok, detail=""):
    out.append([name, bool(ok), "" if ok else str(detail)[:400]])


W.EDITS_TABLE = "pg_temp.hub_edits_check"
W.LOCK_KEY = 0x46414D45444B


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


db = hubdb.HubDb()
real = psycopg.connect(hubdb._dsn(), autocommit=False, connect_timeout=5, application_name="family-editions-check")
proxy = Conn(real)
store = W.Store(connect=lambda: proxy, kind="check", label="Check")
EDITIONS = {"value": "[]"}
base_cfg = db.hiring_config
db.hiring_config = lambda: {**base_cfg(), sc.EDITIONS_KEY: EDITIONS["value"]}
db.stale = lambda books: False
HOLDER = {"id": ""}
base_gate = sc.profile_app_gate


def gate(app_id, user, src):
    if user and HOLDER["id"] and gsjs.str_(user.get("id")) == HOLDER["id"] and not user.get("is_service"):
        return {"open": True, "scope": sc.scope_of("all")}
    return base_gate(app_id, user, src)


sc.profile_app_gate = gate
M.DB = db
M.STORE = M.CLIENT_STORE = M.SCHEDULING_STORE = W.Store(dsn="")
M.STAFF_STORE = M.SSA_STORE = M.FAMILY_STORE = store
M.WRITE_BUDGET_S = 120.0
spent, seq = {}, [0]
SHOWN = {"kind", "due", "priority", "column", "labels", "state"}
SENTINELS = set()


def listed(*eids):
    EDITIONS["value"] = json.dumps([{"id": e, "on": True, "people": [HOLDER["id"]]} for e in eids])


def rows_of(wid):
    with real.cursor() as c:
        c.execute("select tab_name, kind, match_by, field, value, edition from pg_temp.hub_edits_check"
                  " where write_id = %s order by id", (wid,))
        return c.fetchall()


def shown_value(f, v):
    if f in SHOWN or v in SENTINELS or f in ("updatedAt", "completedAt") and re.match(r"\d{4}-\d{2}-\d{2}T", v or ""):
        return v
    return f"<{len(v or '')} chars>"


def write(action, who, payload, what):
    """One decision kept in the check's store (rolled back with everything at the end); its rows read back."""
    seq[0] += 1
    wid = f"Wcheck-fe-{seq[0]:04d}-{uuid.uuid4().hex[:8]}"
    t0 = time.monotonic()
    res = M._run_write(FW, action, who, payload, wid)
    spent[action] = max(spent.get(action, 0.0), time.monotonic() - t0)
    env, rows = json.loads(res.body), rows_of(wid)
    rows_seen.append([what + " · " + action, env.get("status"),
                      [[t, k, m, f, shown_value(f, v), e] for t, k, m, f, v, e in rows]])
    return res.status_code, env, rows


def read(action, who, payload):
    res = M._run(M.APPS["family"], action, who, payload)
    return res.status_code, json.loads(res.body)


def laid(fn):
    own = CW.Own([], book=db.book, edits=store.edits(), edits_at=time.time())
    tok = hubdb.OWN.set(own)
    try:
        return fn(L.Reads(db, None))
    finally:
        hubdb.OWN.reset(tok)


def final_of(env):
    return (env.get("_write") or {}).get("final") is True


def unknown(code, env):
    return code == 200 and env == {"status": 404, "message": "Unknown action."}


def why_of(env, field):
    return next((r["why"] for r in (env.get("data") or {}).get("refused", []) if r["field"] == field), "")


reads0 = L.Reads(db, None)
users = reads0.users()
live_users = [u for u in users if gsjs.str_(u.get("userid")) and not gsjs.str_(u.get("mergedinto"))]
master = next((u for u in live_users if gsjs.str_(u.get("email")).lower() == sc.MASTER_ACCOUNT), None)
holder = next((u for u in live_users if gsjs.str_(u.get("role")).lower() in ("staff", "manager")
               and not gsjs.str_(u.get("clientkey")) and gsjs.str_(u.get("active")).lower() != "false"
               and gsjs.str_(u.get("email")).lower() != sc.MASTER_ACCOUNT), None)
MASTER = {"uid": gsjs.str_((master or {}).get("userid")), "role": "admin", "is_master": True}
HOLD = {"uid": gsjs.str_((holder or {}).get("userid")), "role": gsjs.str_((holder or {}).get("role")).lower(),
        "is_master": False}
HOLDER["id"] = HOLD["uid"]
check("the master's account and an employee's account are read from the users tab", bool(master and holder))
TODAY = reads0.today()
# the tab the tasks resource resolves to, as the doors write it
TASKS_TAB = W.where_of(W.tab_of(reads0, "tasks"))[1]


def subjects(n):
    picked = []
    for key in sorted(F.index(reads0)["families"]):
        c = F.family_ctx(reads0, key)
        if c.get("refused") or c.get("degraded") or not c["family"]["clients"]:
            continue
        picked.append((key, c["family"]["clients"][0]["client_key"]))
        if len(picked) == n:
            break
    return picked


def one(i, subject, ck):
    tag = f"subject {i}"
    EDITIONS["value"] = "[]"
    body = f"Edition check note {i}"
    SENTINELS.update({body, body + " (edited)", f"Edition check call {i}", f"Edition check call {i} (edited)"})
    code, env, _r = write("familyProfileNoteAdd", MASTER, {"family": subject, "body": body}, f"{tag} · master")
    nid = ((env.get("data") or {}).get("note") or {}).get("id", "")
    check(f"{tag}: the master files a note to edit", env.get("status") == 200 and final_of(env) and nid, env.get("message"))
    code, got = read("familyProfileNotes", MASTER, {"family": subject, "edit": True})
    e = (got.get("data") or {}).get("edit") or {}
    mine = next((n for n in e.get("notes") or [] if n["id"] == nid), None)
    check(f"{tag}: familyProfileNotes edit:true opens the master's panels on each note and each call this app filed",
          got.get("status") == 200 and mine and mine["raw"] == {"body": body, "state": "open"}
          and isinstance(e.get("calls"), list), [got.get("status"), sorted(e)])
    code, got = read("familyProfileNotes", MASTER, {"family": subject})
    check(f"{tag}: without edit the notes answer as before (no edit part)", "edit" not in (got.get("data") or {}))
    code, env, rows = write("familyProfileNoteEdit", MASTER, {"family": subject, "id": nid, "changes": [
        {"field": "body", "value": body + " (edited)", "expected": body}]}, f"{tag} · master · the text")
    check(f"{tag}: the master's new text kept final on the note's row (no edition named)",
          env.get("status") == 200 and final_of(env) and [(r[0], r[1], r[3], r[5] or "") for r in rows]
          == [(F.NOTES_TAB, "edit", "body", "")], [env.get("status"), env.get("message"), rows and rows[0][5]])
    now = laid(lambda r: next((n["body"] for n in F.notes_of(F.own_rows(r, subject)) if n["id"] == nid), ""))
    check(f"{tag}: the next read of the notes shows it", now == body + " (edited)")
    code, env, rows = write("familyProfileNoteEdit", MASTER, {"family": subject, "id": nid, "changes": [
        {"field": "body", "value": "zz", "expected": body}]}, f"{tag} · master · a stale witness")
    check(f"{tag}: a stale witness is the 409 with what the note holds now, nothing kept",
          env.get("status") == 409 and (env.get("data") or {}).get("current", {}).get("body") == body + " (edited)"
          and not rows, env.get("status"))
    code, env, rows = write("familyProfileNoteEdit", MASTER, {"family": subject, "id": nid, "changes": [
        {"field": "by", "value": "Someone", "expected": ""}, {"field": "body", "value": "", "expected": body + " (edited)"}]},
        f"{tag} · master · refusals")
    check(f"{tag}: the filer is not a field and a blank text is refused, per field, nothing kept",
          env.get("status") == 200 and why_of(env, "by") and why_of(env, "body") and not rows, env)
    code, env, rows = write("familyProfileNoteEdit", HOLD, {"family": subject, "id": nid, "changes": [
        {"field": "state", "value": "removed", "expected": "open"}]}, f"{tag} · not listed")
    check(f"{tag}: a person not listed meets no door", unknown(code, env) and not rows, env)
    code, got = read("familyProfileNotes", HOLD, {"family": subject, "edit": True})
    check(f"{tag}: a person not listed reads the notes, never their witnesses",
          got.get("status") == 200 and "edit" not in (got.get("data") or {}), got.get("status"))

    day = gsjs.day_shift(TODAY, 1)
    code, env, _r = write("familyProfileCallSchedule", MASTER, {"family": subject, "client_key": ck, "date": day,
                                                               "priority": "normal", "details": f"Edition check call {i}"},
                          f"{tag} · master")
    cid = ((env.get("data") or {}).get("call") or {}).get("id", "")
    check(f"{tag}: the master schedules a call to change", env.get("status") == 200 and cid, env.get("message"))
    code, got = read("familyProfileNotes", MASTER, {"family": subject, "edit": True})
    call = next((x for x in ((got.get("data") or {}).get("edit") or {}).get("calls") or [] if x["id"] == cid), None)
    check(f"{tag}: the call panel's witnesses: the day, the priority, the state and the details",
          call and call["raw"]["due"] == day and call["raw"]["priority"] == "normal"
          and call["raw"]["state"] == "this-week" and call["raw"]["details"].startswith(f"Edition check call {i}"), call)
    later = gsjs.day_shift(TODAY, 12)
    code, env, rows = write("familyProfileCallEdit", MASTER, {"family": subject, "id": cid, "changes": [
        {"field": "due", "value": later, "expected": day}, {"field": "priority", "value": "high", "expected": "normal"}]},
        f"{tag} · master · day and priority")
    cells = {r[3]: r[4] for r in rows}
    check(f"{tag}: the master's day and priority kept final on the card; past a week it leaves This week for Backlog",
          env.get("status") == 200 and final_of(env) and cells.get("due") == later and cells.get("priority") == "high"
          and cells.get("column") == "backlog" and {r[0] for r in rows} == {TASKS_TAB}, [env.get("status"), sorted(cells)])
    code, env, rows = write("familyProfileCallEdit", MASTER, {"family": subject, "id": cid, "changes": [
        {"field": "due", "value": gsjs.day_shift(TODAY, -1), "expected": later},
        {"field": "priority", "value": "low", "expected": "high"}]}, f"{tag} · master · refusals")
    check(f"{tag}: a day past and a priority not offered are refused per field, nothing kept",
          env.get("status") == 200 and why_of(env, "due") == "Today or later." and why_of(env, "priority") and not rows,
          env)
    code, env, rows = write("familyProfileCallEdit", MASTER, {"family": subject, "id": cid, "changes": [
        {"field": "priority", "value": "urgent", "expected": "normal"}]}, f"{tag} · master · a stale witness")
    check(f"{tag}: a stale priority is the 409, nothing kept",
          env.get("status") == 409 and (env.get("data") or {}).get("current", {}).get("priority") == "high" and not rows)
    code, env, rows = write("familyProfileCallEdit", HOLD, {"family": subject, "id": cid, "changes": [
        {"field": "state", "value": "cancelled", "expected": "backlog"}]}, f"{tag} · not listed")
    check(f"{tag}: a person not listed meets no call door", unknown(code, env) and not rows, env)

    listed("family.notes", "family.calls")
    code, got = read("familyProfileNotes", HOLD, {"family": subject, "edit": True})
    e = (got.get("data") or {}).get("edit") or {}
    check(f"{tag}: a listed person's panels open on the notes and the calls",
          any(n["id"] == nid for n in e.get("notes") or []) and any(x["id"] == cid for x in e.get("calls") or []))
    code, env, rows = write("familyProfileCallEdit", HOLD, {"family": subject, "id": cid, "changes": [
        {"field": "state", "value": "cancelled", "expected": "backlog"},
        {"field": "details", "value": f"Edition check call {i} (edited)", "expected": call["raw"]["details"]}]},
        f"{tag} · listed · cancel and details")
    cells = {r[3]: r[4] for r in rows}
    check(f"{tag}: a listed person cancels the call (Done, labelled Cancelled) and rewrites its details, under family.calls",
          env.get("status") == 200 and final_of(env) and cells.get("column") == "done"
          and F.CALL_CANCELLED in F.labels_of(cells.get("labels")) and {r[5] for r in rows} == {"family.calls"},
          [env.get("status"), sorted(cells)])
    state = laid(lambda r: next((F.call_words(x) for x in F.calls_for(r, subject, F.call_ties_of(F.own_rows(r, subject)))
                                 if gsjs.str_(x.get("id")) == cid), ""))
    check(f"{tag}: the Activity names the call Cancelled", state == F.CALL_CANCELLED, state)
    code, got = read("familyProfileNotes", HOLD, {"family": subject, "edit": True})
    again = next((x for x in ((got.get("data") or {}).get("edit") or {}).get("calls") or [] if x["id"] == cid), None)
    check(f"{tag}: the call panel opens on the cancelled state and the new details",
          again and again["raw"]["state"] == "cancelled" and again["raw"]["details"] == f"Edition check call {i} (edited)")
    code, env, rows = write("familyProfileNoteEdit", HOLD, {"family": subject, "id": nid, "changes": [
        {"field": "state", "value": "removed", "expected": "open"}]}, f"{tag} · listed · remove the note")
    check(f"{tag}: a listed person removes the note (its row kept, its kind note_removed), under family.notes",
          env.get("status") == 200 and final_of(env) and [(r[3], r[4], r[5]) for r in rows]
          == [("kind", F.NOTE_REMOVED, "family.notes")], [env.get("status"), rows])
    gone = laid(lambda r: [n for n in F.notes_of(F.own_rows(r, subject)) if n["id"] == nid])
    check(f"{tag}: a removed note leaves the notes and the Activity", gone == [])
    EDITIONS["value"] = "[]"


try:
    with real.transaction():
        store.ensure()
        check("the edit store is made in temp tables", store.ready(), store.why)
        picked = subjects(2)
        check("two family members with clients on file", len(picked) == 2, len(picked))
        for i, (subject, ck) in enumerate(picked, 1):
            try:
                one(i, subject, ck)
            except Exception as exc:  # noqa: BLE001 - said as a failed check, never a value
                check(f"subject {i}: ran to the end", False, type(exc).__name__ + ": " + str(exc)[:300])
        raise psycopg.Rollback()
finally:
    try:
        real.close()
    except Exception:
        pass
with psycopg.connect(hubdb._dsn(), autocommit=True, connect_timeout=5) as c2:
    left = c2.execute("select count(*) from pg_stat_activity where application_name = 'family-editions-check'").fetchone()[0]
check("nothing is left: the check's session is gone, its temp tables with it", left == 0, left)
facts["slowest decision per door (s)"] = ", ".join(f"{a} {t:.1f}" for a, t in sorted(spent.items()))
print(json.dumps({"checks": out, "facts": facts, "rows": rows_seen}))
'''


def main() -> int:
    blob = {"app": {p.stem: p.read_text(encoding="utf-8") for p in (ROOT / "app").glob("*.py")}}
    got = subprocess.run(["docker", "exec", "-i", "-e", "MALLOC_ARENA_MAX=2", DB_RUNNER, "python", "-c", DRIVER],
                         input=base64.b64encode(json.dumps(blob).encode()) + b"\n", capture_output=True, timeout=1500)
    lines = got.stdout.decode().strip().splitlines()
    if got.returncode != 0 or not lines:
        print("the driver did not run in asa-hub-db-sync:", got.stderr.decode()[-1500:])
        return 1
    res = json.loads(lines[-1])
    failed = 0
    for name, ok, detail in res["checks"]:
        print(f"  {'ok  ' if ok else 'FAIL'} {name}" + ("" if ok or not detail else f"\n       {detail}"))
        failed += 0 if ok else 1
    for k, v in res["facts"].items():
        print(f"  fact {k}: {v}")
    print("app.edits rows (tab, kind, match, field, value, edition) — values other than the check's own withheld:")
    for what, status, rows in res["rows"]:
        print(f"  [{status}] {what}")
        for r in rows:
            print(f"      {r}")
    print(f"{len(res['checks']) - failed} ok, {failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
