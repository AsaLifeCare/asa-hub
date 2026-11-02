#!/usr/bin/env python3
"""Forms' reads and writes decided by the streamed modules on real forms in asa-hub-db-sync: the answers and their
files read off the copy, an answer handled, a form renamed, archived and restored, a person an edition lists, and
the app.edits rows each final write keeps. Nothing real is written: the edit store lives in temp tables inside one
transaction rolled back at the end. Prints shapes and counts only."""
from __future__ import annotations

import base64
import importlib.util
import json
import py_compile
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DB_RUNNER = "asa-hub-db-sync"

DRIVER = r'''
import base64, importlib.abc, importlib.util, json, sys, time, types, uuid
SRC = json.loads(base64.b64decode(sys.stdin.readline()).decode())


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
import gsjs, hubdb, scope as sc, locations as L, writes as W
import forms as F
import forms_writes as FW
import main as M

out, facts = [], {}


def check(name, ok, detail=""):
    out.append([name, bool(ok), "" if ok else str(detail)[:400]])


W.EDITS_TABLE = "pg_temp.hub_edits_frm"
W.LOCK_KEY = 0x46524D43484B


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
real = psycopg.connect(hubdb._dsn(), autocommit=False, connect_timeout=5, application_name="forms-check")
store = W.Store(connect=lambda: Conn(real), kind="check", label="Check")
EDITIONS = {"value": "[]"}
if not any(a == "forms" for _e, a in sc.EDITIONS):
    sc.EDITIONS = tuple(sc.EDITIONS) + (("forms.answers", "forms"), ("forms.links", "forms"))
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
M.stores = lambda: {"forms": store}
M.WRITE_BUDGET_S = 120.0
seq = [0]


def read(action, who, payload):
    res = M._run(F, action, who, payload)
    return res.status_code, json.loads(res.body)


def write(action, who, payload):
    seq[0] += 1
    wid = f"Wcheck-frm-{seq[0]:04d}-{uuid.uuid4().hex[:8]}"
    res = M._run_write(FW, action, who, payload, wid)
    return res.status_code, json.loads(res.body), wid


def kept(wid):
    with real.cursor() as c:
        c.execute("select sheet_id, tab_name, kind, row_key, field, edition from pg_temp.hub_edits_frm"
                  " where write_id = %s order by id", (wid,))
        return c.fetchall()


def final(env):
    return (env.get("_write") or {}).get("final") is True


reads0 = L.Reads(db, None)
users = [u for u in reads0.users() if gsjs.str_(u.get("userid")) and not gsjs.str_(u.get("mergedinto"))]
master = next((u for u in users if gsjs.str_(u.get("email")).lower() == sc.MASTER_ACCOUNT), None)
staff = next((u for u in users if gsjs.str_(u.get("role")).lower() == "staff" and not gsjs.str_(u.get("clientkey"))
              and gsjs.str_(u.get("active")).lower() != "false"
              and gsjs.str_(u.get("email")).lower() != sc.MASTER_ACCOUNT), None)
MASTER = {"uid": gsjs.str_((master or {}).get("userid")) or "USR_MASTER", "role": "admin", "is_master": True}
STAFF = {"uid": gsjs.str_((staff or {}).get("userid")), "role": "staff", "is_master": False}
check("a staff account is read from the users tab", bool(staff))

subs0 = F.rows(reads0, F.SUBMISSIONS_TAB)
forms0 = F.rows(reads0, F.FORMS_TAB)
counts = {}
for s in subs0:
    counts[gsjs.str_(s.get("form_slug")).lower()] = counts.get(gsjs.str_(s.get("form_slug")).lower(), 0) + 1
answered = [f for f in forms0 if counts.get(gsjs.str_(f.get("slug")).lower())]
FORM = max(answered, key=lambda f: counts[gsjs.str_(f.get("slug")).lower()]) if answered else None
SLUG = gsjs.str_((FORM or {}).get("slug")).lower()
SUB = next((s for s in subs0 if gsjs.str_(s.get("form_slug")).lower() == SLUG), None)
house = {t: db.resolve(t).sheet_id for t in (F.FORMS_TAB, F.SUBMISSIONS_TAB, F.FILES_TAB)}
facts["copy"] = f"{len(forms0)} forms, {len(subs0)} answers, {len(F.rows(reads0, F.FILES_TAB))} files"
facts["subject"] = f"a form with {counts.get(SLUG, 0)} answers"
check("a form with answers is read from the copy", bool(FORM and SUB))
FIXED = {"id", "form_slug", "form_title", "submitted_at", "name", "email", "phone", "state", "handled_by", "note"}


KEYS_CARRIED = all(not gsjs.str_(f.get("token")).startswith(F.COPY_MARKER) for f in forms0)
facts["the copy's link keys"] = "carried" if KEYS_CARRIED else "withheld"


def list_doors():
    code, env = read("formsList", MASTER, {})
    live = [f for f in forms0 if gsjs.str_(f.get("archived")).lower() != "true"]
    if KEYS_CARRIED:
        got = (env.get("data") or {}).get("forms") or []
        check("the master reads the forms list: 200, every live form with its link",
              code == 200 and env.get("status") == 200 and len(got) == len(live) and
              all(f["url"].startswith(F.PUBLIC_BASE + "/form.html?f=") and "&t=" in f["url"] for f in got), env.get("message"))
        mine = next((f for f in got if f["slug"].lower() == SLUG), {})
        check("a form's count of answers is the copy's", mine.get("submissions") == counts[SLUG], mine.get("submissions"))
        code, env = read("formsList", MASTER, {"archived": True})
        check("the archived filter lists the archived ones",
              len((env.get("data") or {}).get("forms") or []) == len(forms0) - len(live), env.get("message"))
    else:
        check("while the copy withholds the link's key, the list is left to Apps Script",
              code == 503 and "link's key" in str(env.get("defer")), env)
    code, env = read("formsList", STAFF, {})
    check("a staff member nobody listed is refused the list", env == {"status": 403, "message": F.ROLE_REFUSAL}, env)


def save_doors():
    new = "check-forms-python"
    one = json.dumps([{"key": "q1", "kind": "text", "label": "First question"}])
    code, env, wid = write("formSave", MASTER, {"slug": new, "title": "Check form", "fields": one, "status": "draft"})
    got = kept(wid)
    url = (env.get("data") or {}).get("url") or ""
    check("the master makes a new form: 200, final, one row appended in the forms house's Data tab",
          env.get("status") == 200 and final(env) and got and
          all(r[0] == house[F.FORMS_TAB] and r[1] == "Data" and r[2] == "append" for r in got), env)
    check("with a minted 24-character key in its link, saved as a draft",
          url.startswith(F.PUBLIC_BASE + "/form.html?f=" + new + "&t=") and len(url.split("&t=")[1]) == 24 and
          (env.get("data") or {}).get("note", "").startswith("Saved as draft."), url[:60])
    code, env, wid = write("formSave", MASTER, {"slug": new, "title": "Check form", "fields": one, "status": "open"})
    check("opening it edits the kept row and keeps the same link",
          env.get("status") == 200 and final(env) and (env.get("data") or {}).get("url") == url and
          {r[2] for r in kept(wid)} == {"edit"} and (env.get("data") or {}).get("note") == FW.NOTE_OPEN, env)
    if KEYS_CARRIED:
        f0 = next(f for f in forms0 if gsjs.str_(f.get("slug")).lower() == SLUG)
        code, env, wid = write("formSave", MASTER, {"slug": SLUG, "title": gsjs.str_(f0.get("title")),
                                                    "fields": FW.stringify(F.fields_of(f0)), "status": "closed"})
        cells = {r[4] for r in kept(wid)}
        check("a status flip on a real form: 200, final, its key never written again",
              env.get("status") == 200 and final(env) and "status" in cells and "token" not in cells, env)
    for fields, said in (("[]", "A form with no questions collects nothing."),
                         (json.dumps([{"key": "q1", "kind": "choice", "label": "Pick"}]),
                          'Question "q1" offers a choice of nothing.'),
                         (json.dumps([{"key": "Q 1", "label": "x"}]), "Question 1 needs a key of lower-case letters, "
                          "digits and underscores — it is the column the answer is stored under."),
                         (json.dumps([{"key": "q1", "kind": "nope", "label": "x"}]),
                          '"nope" is not a kind of question. Use one of: ' + ", ".join(F.KINDS) + ".")):
        code, env, _ = write("formSave", MASTER, {"slug": new, "title": "Check form", "fields": fields})
        check("a definition that cannot be drawn is refused: " + said[:40], env == {"status": 400, "message": said}, env)
    code, env, _ = write("formSave", MASTER, {"slug": "Bad Slug", "title": "x", "fields": one})
    check("a link name that is not lower-case letters, digits and hyphens is refused", env.get("status") == 400, env)


def reads_doors():
    code, env = read("formSubmissions", MASTER, {"slug": SLUG})
    d = env.get("data") or {}
    check("the master reads one form's answers: 200, as many as the copy holds",
          code == 200 and env.get("status") == 200 and d.get("total") == min(500, counts[SLUG]), env.get("message"))
    check("its questions and title come with them", isinstance(d.get("fields"), list) and d.get("title") ==
          gsjs.str_(FORM.get("title")))
    subs = d.get("submissions") or []
    check("newest first", [s["submitted_at"] for s in subs] == sorted((s["submitted_at"] for s in subs), reverse=True))
    extra = {k for s in subs for k in s} - FIXED
    facts["answer keys beyond the fixed ones"] = str(len(extra))
    by_id = {gsjs.str_(s.get("id")): s.get("answers") for s in subs0}
    flat_ok = all(FIXED <= set(s) and all(s.get(k) == v for k, v in (by_id.get(s["id"]) or {}).items()
                                          if k not in FIXED) for s in subs)
    check("each answer carries the fixed keys and every question's answer under its own key",
          flat_ok and bool(extra), sorted(extra)[:5])
    named = {f.get("key") for f in d.get("fields") or [] if isinstance(f, dict) and f.get("kind") != "heading"}
    drawn = sum(1 for s in subs for k in named if gsjs.str_(s.get(k)))
    facts["answers the page now draws under this form's questions"] = str(drawn)
    check("the Answers page finds something under this form's questions", drawn > 0, drawn)
    code, env = read("formSubmissions", MASTER, {})
    check("every form's answers: 200", env.get("status") == 200 and
          (env.get("data") or {}).get("total") == min(500, len(subs0)), env.get("message"))
    code, env = read("formFilesList", MASTER, {"form_slug": SLUG})
    files = (env.get("data") or {}).get("files")
    check("the form's files ledger: 200, each digest a preview",
          env.get("status") == 200 and isinstance(files, list) and
          all(len(gsjs.str_(f.get("digest_text"))) <= 600 for f in files), env.get("message"))
    code, env = read("formSubmissions", STAFF, {"slug": SLUG})
    check("a staff member nobody listed is refused as Apps Script refuses",
          env == {"status": 403, "message": F.ROLE_REFUSAL}, env)
    code, env = read("formSubmissions", MASTER, {"slug": 5})
    check("a param of the wrong type is refused 400", env == {"status": 400, "message": "slug must be string, got number."},
          env)


def writes_doors():
    code, env, wid = write("formSubmissionHandle", MASTER, {"id": gsjs.str_(SUB.get("id")), "state": "handled"})
    got = kept(wid)
    check("the master marks an answer handled: 200, final", env.get("status") == 200 and final(env) and
          (env.get("data") or {}).get("state") == "handled", env)
    check("its cells: state, who, when, the note and the stamp",
          {r[4] for r in got} == {"state", "handled_by", "handled_at", "note", "updatedAt"}, [r[4] for r in got])
    check("kept in the answers house's Data tab, no edition",
          all(r[0] == house[F.SUBMISSIONS_TAB] and r[1] == "Data" and r[2] == "edit" and r[5] == "" for r in got))
    code, env, _ = write("formSubmissionHandle", MASTER, {})
    check("no id is refused as the policy refuses it", env == {"status": 400, "message": "Missing required parameter: id."},
          env)
    code, env, wid = write("formRename", MASTER, {"slug": SLUG, "title": "Check — renamed"})
    got = kept(wid)
    check("the master renames the form: 200, final, its title and stamp kept in the forms house's Data tab",
          env.get("status") == 200 and final(env) and {r[4] for r in got} == {"title", "updatedAt"} and
          all(r[0] == house[F.FORMS_TAB] and r[1] == "Data" for r in got), env)
    code, env = read("formSubmissions", MASTER, {"slug": SLUG})
    check("the next read lays the kept title over the copy", (env.get("data") or {}).get("title") == "Check — renamed",
          (env.get("data") or {}).get("title"))
    code, env, wid = write("formRename", MASTER, {"slug": SLUG, "title": "Check — renamed"})
    check("the same title again answers 200 and keeps nothing", env.get("status") == 200 and not final(env) and
          not kept(wid), env)
    code, env, _ = write("formRename", MASTER, {"slug": "no-such-form-check", "title": "X"})
    check("an unknown form is 404", env == {"status": 404, "message": "No form by that name."}, env)
    code, env, wid = write("formArchive", MASTER, {"slug": SLUG, "reason": "check"})
    got = {r[4] for r in kept(wid)}
    check("the master archives it: 200, final, closed",
          env.get("status") == 200 and final(env) and (env.get("data") or {}).get("archived") is True and
          got == {"archived", "archived_at", "archived_by", "archived_reason", "status", "updatedAt"}, env)
    code, env, wid = write("formArchive", MASTER, {"slug": SLUG, "archived": False})
    check("and restores it", env.get("status") == 200 and final(env) and
          (env.get("data") or {}).get("note") == FW.NOTE_RESTORED, env)


def editions_doors():
    HOLDER["id"] = STAFF["uid"]
    EDITIONS["value"] = json.dumps([{"id": "forms.answers", "on": True, "people": [STAFF["uid"]]}])
    code, env, wid = write("formSubmissionHandle", STAFF, {"id": gsjs.str_(SUB.get("id")), "state": "new"})
    got = kept(wid)
    check("a staff member forms.answers lists puts an answer back: 200, final, the edition named",
          env.get("status") == 200 and final(env) and got and all(r[5] == "forms.answers" for r in got), env)
    code, env = read("formSubmissions", STAFF, {"slug": SLUG})
    check("and reads the answers", env.get("status") == 200, env)
    code, env, _ = write("formRename", STAFF, {"slug": SLUG, "title": "Check — by staff"})
    check("but forms.answers does not rename a form", env == {"status": 403, "message": F.ROLE_REFUSAL}, env)
    EDITIONS["value"] = json.dumps([{"id": "forms.links", "on": False, "people": [STAFF["uid"]]}])
    code, env, _ = write("formRename", STAFF, {"slug": SLUG, "title": "Check — by staff"})
    check("an edition whose key is off lets nobody in", env == {"status": 403, "message": F.ROLE_REFUSAL}, env)
    HOLDER["id"] = ""


try:
    with real.transaction():
        store.ensure()
        check("the edit store is made in temp tables", store.ready(), store.why)
        for name, fn in (("the list", list_doors), ("reads", reads_doors), ("saves", save_doors),
                         ("writes", writes_doors), ("editions", editions_doors)):
            if FORM and SUB and staff:
                try:
                    with real.transaction():
                        fn()
                except Exception as exc:  # noqa: BLE001 - said as a failed check
                    check(name + ": ran to the end", False, type(exc).__name__ + ": " + str(exc)[:300])
        with real.cursor() as c:
            c.execute("select count(*), count(distinct write_id) from pg_temp.hub_edits_frm")
            n, w = c.fetchone()
        facts["cells kept in the check's app.edits (temp)"] = f"{n} cells from {w} writes"
        raise psycopg.Rollback()
finally:
    try:
        real.close()
    except Exception:
        pass
print(json.dumps({"checks": out, "facts": facts}))
'''


def main() -> int:
    for name in ("forms.py", "forms_writes.py", "main.py", "editions.py"):
        py_compile.compile(str(ROOT / "app" / name), doraise=True)
    py_compile.compile(str(ROOT / "server" / "snapshot_service.py"), doraise=True)
    py_compile.compile(str(ROOT / "server" / "edit_overlay.py"), doraise=True)
    py_compile.compile(str(ROOT / "server" / "hub_sheet_sync.py"), doraise=True)
    py_compile.compile(str(ROOT / "db" / "sync.py"), doraise=True)
    print("ok   the Forms modules, main, the catalogue, the relay and both keepers compile")
    spec = importlib.util.spec_from_file_location("redaction_check", ROOT / "server" / "redaction.py")
    R = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(R)
    forms_book = next(iter(R.BOOK_KEPT_COLUMNS))
    with R.reading(forms_book):
        kept_here = R.redact_row({"token": "abc", "password": "x"})[0]
    with R.reading("another-book"):
        elsewhere = R.redact_row({"token": "abc"})[0]
    bare = R.redact_row({"token": "abc"})[0]
    local = [("the Forms book's keeper copies its link keys, and withholds a password beside them",
              kept_here == {"token": "abc", "password": R.MARKER_SECRET}),
             ("another book's token column stays withheld", elsewhere == {"token": R.MARKER_SECRET}),
             ("a caller that names no book withholds it too", bare == {"token": R.MARKER_SECRET})]
    for name, ok in local:
        print(("ok   " if ok else "FAIL ") + name)
    app = {p.stem: p.read_text(encoding="utf-8") for p in (ROOT / "app").glob("*.py")}
    got = subprocess.run(["docker", "exec", "-i", "-e", "MALLOC_ARENA_MAX=2", DB_RUNNER, "python", "-c", DRIVER],
                         input=base64.b64encode(json.dumps(app).encode()) + b"\n", capture_output=True, timeout=900)
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
    failed += sum(1 for _n, ok in local if not ok)
    print(f"{len(res['checks']) + 1 + len(local) - failed} ok, {failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
