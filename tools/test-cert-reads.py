#!/usr/bin/env python3
"""Compliance documents read by Python alone: the relay's lane (server/cert_reads.py) queues the ledger's papers still
to read, reads a CPR card with the decoder's engine under the certificate's view of the words book, says a HEIC
photo and a paper outside Compliance Docs for what they are, and keeps a paper Drive will not hand over FAILED with
its error; asa-hub-app then lays certReadVerdict_ over each row, and certDocRead answers every row itself, never
handing one to Apps Script. The lane runs in asa-hub-snapshot on temporary tables with the real words book and
requirements; the door runs in asa-hub-db-sync on a test ledger over the real requirements and roster."""
from __future__ import annotations

import base64
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LANE_RUNNER, DOOR_RUNNER = "asa-hub-snapshot", "asa-hub-db-sync"
DDL = (ROOT / "db" / "cert-reads.sql").read_text()
CPR = ("AMERICAN HEART ASSOCIATION. BLS Provider. CPR and AED Program. This card certifies that the above individual "
       "has successfully completed the cognitive and skills evaluations in accordance with the curriculum of the "
       "American Heart Association Basic Life Support (CPR and AED) Program. Jane Q Testperson. Issue Date: "
       "03/10/2026. Recommended Renewal Date: 03/2028. Training Center Name: ASA LifeCare Training Center. Training "
       "Center ID: OH12345. Instructor Name: John Example. Instructor ID: 0012345. eCard Code: 215412345678. "
       "Training Center City, State: Akron, OH. CPR AED BLS Provider card, valid for two years.")

LOADER = r'''
import base64, importlib.abc, importlib.util, json, sys
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
out, facts = [], {}


def check(name, ok, detail=""):
    out.append([name, bool(ok), "" if ok else str(detail)[:400]])
'''

LANE = LOADER + r'''
from pathlib import Path
sys.path.insert(1, "/srv/app")
import psycopg2
import mar_papers as MP
import cert_reads as CR

DDL, CPR = json.loads(sys.argv[1]), sys.argv[2]
CR.SCHEMA = "pg_temp"
conn = psycopg2.connect(MP.DSN, connect_timeout=5)
with conn, conn.cursor() as cur:
    for stmt in DDL:
        cur.execute(stmt)
with MP._connect(MP.MIRROR_DSN) as m, m.cursor() as cur:
    REQS = CR._tab(cur, CR.REQUIREMENTS_BOOK, CR.REQUIREMENTS_TAB)
    VOCAB = {t: CR._vocab_rows(CR._tab(cur, CR.VOCAB_BOOK, t)) for t in CR.VOCAB_TABS}
LEDGER = [
    {"id": "CU1", "person": "Jane Q Testperson", "cert": "CPR / First Aid", "req_id": "cpr", "file_id": "fileCpr00001",
     "name": "cpr card.pdf", "read_state": "pending"},
    {"id": "CU2", "person": "Jane Q Testperson", "cert": "CPR / First Aid", "req_id": "cpr", "file_id": "fileHeic0001",
     "name": "card.HEIC", "read_state": ""},
    {"id": "CU3", "person": "Jane Q Testperson", "cert": "CPR / First Aid", "req_id": "cpr", "file_id": "fileStray001",
     "name": "card.pdf", "read_state": "pending"},
    {"id": "CU4", "person": "Jane Q Testperson", "cert": "CPR / First Aid", "req_id": "cpr", "file_id": "fileDone0001",
     "name": "card.pdf", "read_state": "read"},
    {"id": "CU5", "person": "Jane Q Testperson", "cert": "CPR / First Aid", "req_id": "cpr", "file_id": "fileGone0001",
     "name": "card.pdf", "read_state": "pending"},
    {"id": "CU6", "person": "Jane Q Testperson", "cert": "CPR / First Aid", "req_id": "cpr", "file_id": "",
     "url": "https://drive.google.com/file/d/fileFromUrl01/view", "name": "card.pdf", "read_state": "pending"},
]
CR.MIRROR_READER = lambda: {"ledger": LEDGER, "requirements": REQS, "vocab": VOCAB}
TREE = {"fileCpr00001": ("application/pdf", ["certCpr"]), "fileHeic0001": ("image/heic", ["certCpr"]),
        "fileStray001": ("application/pdf", ["elsewhere"]), "fileFromUrl01": ("application/pdf", ["certCpr"]),
        "certCpr": (None, ["compDocs"]), "compDocs": (None, ["root"]), "elsewhere": (None, ["someone"]),
        "someone": (None, ["root"])}
NAMES = {"compDocs": "Compliance Docs", "someone": "Somebody's folder"}
ASKED = []


class Req:
    def __init__(self, fn):
        self.fn = fn

    def execute(self):
        return self.fn()


class NotThere(Exception):
    def __init__(self):
        self.resp = type("R", (), {"status": 404})()


class Files:
    def get(self, fileId, fields="", **kw):
        ASKED.append(fileId)
        if fileId not in TREE:
            return Req(lambda: (_ for _ in ()).throw(NotThere()))
        mime, parents = TREE[fileId]
        return Req(lambda: {"id": fileId, "name": NAMES.get(fileId, fileId), "mimeType": mime or "folder",
                            "size": "1000", "parents": parents})


class Drive:
    def files(self):
        return Files()


MP.DRIVE_FACTORY = Drive
READ = []
CR.TEXT_READER = lambda drive, fid, name, mime: (READ.append(fid), CPR)[1]


def store():
    with conn, conn.cursor() as cur:
        cur.execute("select row_id, state, reading, error, attempts, next_try_at > now() from pg_temp.cert_reads")
        return {r[0]: {"state": r[1], "reading": r[2] or {}, "error": r[3], "attempts": r[4], "due": r[5]}
                for r in cur.fetchall()}


try:
    said = CR.one_pass(conn)
    facts["first pass"] = said
    s = store()
    check("the ledger's papers still to read are queued; a read one is not, a file named only by its url is",
          set(s) == {"CU1", "CU2", "CU3", "CU5", "CU6"} and said.get("owed") == 5, sorted(s))
    p1 = (s.get("CU1") or {}).get("reading", {}).get("paper", {})
    facts["CU1 paper"] = {k: p1.get(k) for k in ("state", "kind", "kind_score", "issued_on", "expires_on", "chars")}
    facts["CU1 book"] = {k: s.get("CU1", {}).get("reading", {}).get(k) for k in ("wants_expiry", "floor",
                                                                                  "no_expiry_ceiling", "v")}
    check("a CPR card is read by the decoder's engine: its kind and its expiry, with the book's dials",
          s.get("CU1", {}).get("state") == "read" and p1.get("kind") == "cpr_first_aid" and p1.get("expires_on")
          and s["CU1"]["reading"].get("floor") and s["CU1"]["reading"].get("wants_expiry") is True, facts["CU1 paper"])
    check("the paper's lists are kept as counts, never its numbers", isinstance(p1.get("facts", {}).get("numbers"), int)
          and "pairs" in p1.get("facts", {}) and "text" not in json.dumps(p1), p1.get("facts"))
    check("a HEIC photo is said as one, its words never asked",
          (s.get("CU2") or {}).get("reading", {}).get("paper", {}).get("state") == "heic" and "fileHeic0001" not in READ,
          s.get("CU2"))
    check("a paper outside Compliance Docs is stray, its words never read",
          (s.get("CU3") or {}).get("reading", {}).get("paper", {}).get("state") == "stray" and "fileStray001" not in READ,
          s.get("CU3"))
    c5 = s.get("CU5") or {}
    check("a paper Drive will not hand over is FAILED with its error and a later try, never read",
          c5.get("state") == "failed" and "no longer in the drive" in c5.get("error", "") and c5.get("attempts") == 1
          and c5.get("due") is True and not c5.get("reading"), c5)
    check("the file a url names is read", (s.get("CU6") or {}).get("state") == "read" and "fileFromUrl01" in READ,
          s.get("CU6"))
    READ.clear()
    said = CR.one_pass(conn)
    check("the next pass reads nothing again", said.get("read", 0) == 0 and said.get("failed", 0) == 0 and not READ,
          said)
    MP.DRIVE_FACTORY = None
    MP._DRIVE["v"] = None
    CR.TEXT_READER = None
    real = MP._drive()
    words = CR.paper_text(real, "1KS5vIyV_LZo6NJfL8c_RPzqKreGJbnl_", "scan.pdf", "application/pdf")
    check("the reader itself reads a real scanned paper with Tesseract", len(words) > 100, len(words))
    facts["readings"] = {k: v["reading"] for k, v in s.items() if v["state"] == "read"}
finally:
    conn.close()
print(json.dumps({"checks": out, "facts": facts}, default=str))
'''

DOOR = LOADER + r'''
import types
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
import gsjs, hubdb, scope as sc, locations as L, staff as SP
import cert_docs as CD, cert_reads as CRA
import main as M

DDL, READINGS = json.loads(sys.argv[1]), json.loads(sys.argv[2])
real = psycopg.connect(hubdb._dsn(), autocommit=True, connect_timeout=5, application_name="cert-reads-check")
for stmt in DDL:
    real.execute(stmt)
db0 = hubdb.HubDb()
people = [p for p in SP.people_merged(L.Reads(db0, None), SP._people(L.Reads(db0, None))) if gsjs.str_(p.get("id"))]
someone = people[0]
SUBJECT = SP.roster_id(someone.get("id"))
HEAD = ("id", "person", "cert", "name", "url", "by", "at", "file_id", "req_id", "read_state", "read_kind", "issued_on",
        "expires_on", "read_how", "read_confidence", "read_why", "read_at", "read_v", "confirmed_on", "confirmed_by",
        "confirmed_at", "read_tries", "roster_id")
REF = hubdb.TabRef("TESTBOOK", "cert_uploads", "t_test_cert_uploads", HEAD, 1, 9)


def line(rid, **kw):
    base = {"id": rid, "person": gsjs.str_(someone.get("name")), "cert": "CPR / First Aid", "name": "card.pdf",
            "file_id": "file" + rid, "req_id": "cpr", "read_state": "pending", "roster_id": SUBJECT}
    base.update(kw)
    return base


LEDGER = [line("CU1", file_id="fileCpr00001"), line("CU2", file_id="fileHeic0001"),
          line("CU3", file_id="fileStray001"), line("CU5", file_id="fileGone0001"),
          line("CU7"), line("CU8", req_id="no_such_requirement", cert="Nothing at all"),
          line("CU9", read_state="read", read_kind="cpr_first_aid", expires_on="2027-01-01"),
          line("CU10", file_id="fileTried0001"), line("CU11", file_id="fileCpr00002", roster_id="SOMEONE_ELSE_ID")]


class Db(hubdb.HubDb):
    """asa-hub-db as the copy is read, but a test ledger, and the lane's readings off this connection's temporary table."""

    def query(self, sql_text, params=None):
        if "app.cert_reads" in str(sql_text):
            return list(real.execute(str(sql_text).replace("app.cert_reads", "pg_temp.cert_reads"), params).fetchall())
        return super().query(sql_text, params)

    def resolve(self, tab):
        if tab == "cert_uploads":
            return hubdb.Resolved("TESTBOOK", ("cert_uploads",), REF, False, True)
        return super().resolve(tab)

    def rows(self, ref):
        if ref is REF:
            return [(i + 2, {h: r.get(h, "") for h in HEAD}) for i, r in enumerate(LEDGER)]
        return super().rows(ref)


cpr = READINGS.get("CU1") or {}
real.execute("insert into pg_temp.cert_reads (row_id, file_id, state, reading, attempts, read_at) values"
             " ('CU1', 'fileCpr00001', 'read', %s, 1, now()), ('CU2', 'fileHeic0001', 'read', %s, 1, now()),"
             " ('CU3', 'fileStray001', 'read', %s, 1, now()), ('CU11', 'fileCpr00002', 'read', %s, 1, now())",
             (json.dumps(cpr), json.dumps({"paper": {"state": "heic", "chars": 0}}),
              json.dumps({"paper": {"state": "stray", "chars": 0}}),
              json.dumps({**cpr, "paper": {**cpr.get("paper", {}), "who": "people:SOMEBODY_ELSE"}})))
real.execute("insert into pg_temp.cert_reads (row_id, file_id, state, error, attempts) values"
             " ('CU5', 'fileGone0001', 'failed', 'the file is no longer in the drive', 1),"
             " ('CU10', 'fileTried0001', 'failed', 'Drive did not answer (TimeoutError)', 3)")
db = Db()
db.stale = lambda books: False
M.DB = db
users = [u for u in L.Reads(db, None).users() if gsjs.str_(u.get("userid")) and not gsjs.str_(u.get("mergedinto"))]
master = next((u for u in users if gsjs.str_(u.get("email")).lower() == sc.MASTER_ACCOUNT), None)
MASTER = {"uid": gsjs.str_((master or {}).get("userid")), "role": "admin", "is_master": True}


def door(action, payload):
    return json.loads(M._run(CD, action, MASTER, payload).body)


env = door("certUploadsList", {})
rows = {r["id"]: r for r in ((env.get("data") or {}).get("uploads") or [])}
facts["list"] = {k: (v["read_state"], v["read_why"][:60], v.get("expires_on"), v.get("read_confidence"))
                 for k, v in rows.items()}
r1 = rows.get("CU1") or {}
check("a read CPR card's verdict stands for its requirement: read, its expiry, the confidence over the floor",
      env.get("status") == 200 and r1.get("read_state") == "read" and r1.get("expires_on") and r1.get("read_kind") ==
      "cpr_first_aid" and (r1.get("read_confidence") or 0) >= cpr.get("floor", 85), r1)
check("a HEIC photo is unread with its words", (rows.get("CU2") or {}).get("read_state") == "unread"
      and "photo format" in (rows.get("CU2") or {}).get("read_why", ""), rows.get("CU2"))
check("a paper outside Compliance Docs is unread as stray", (rows.get("CU3") or {}).get("read_state") == "unread"
      and "compliance folder" in (rows.get("CU3") or {}).get("read_why", ""), rows.get("CU3"))
check("a failed reading under its tries is pending, read again", (rows.get("CU5") or {}).get("read_state") == "pending"
      and "read again" in (rows.get("CU5") or {}).get("read_why", ""), rows.get("CU5"))
check("a paper the lane has not reached yet is pending, being read", (rows.get("CU7") or {}).get("read_state") ==
      "pending" and "being read" in (rows.get("CU7") or {}).get("read_why", ""), rows.get("CU7"))
check("a paper filed under no requirement a paper is read for is unread, nothing read",
      (rows.get("CU8") or {}).get("read_state") == "unread" and "not filed under a requirement" in
      (rows.get("CU8") or {}).get("read_why", ""), rows.get("CU8"))
check("a row Apps Script already decided keeps its reading", (rows.get("CU9") or {}).get("read_state") == "read"
      and (rows.get("CU9") or {}).get("expires_on") == "2027-01-01", rows.get("CU9"))
check("a reading that failed three times is unread, HR confirms", (rows.get("CU10") or {}).get("read_state") ==
      "unread" and "after 3 tries" in (rows.get("CU10") or {}).get("read_why", ""), rows.get("CU10"))
check("a paper that names someone else is refused", (rows.get("CU11") or {}).get("read_state") == "unread"
      and "names someone else" in (rows.get("CU11") or {}).get("read_why", ""), rows.get("CU11"))
for rid in ("CU1", "CU7"):
    env = door("certDocRead", {"id": rid})
    check(f"certDocRead answers {rid} itself (200), never handed to Apps Script",
          env.get("status") == 200 and "defer" not in env and (env.get("data") or {}).get("id") == rid, env)
real.close()
print(json.dumps({"checks": out, "facts": facts}, default=str))
'''


def ddl_temp() -> str:
    body = "\n".join(line for line in DDL.splitlines() if not line.startswith("--"))
    stmts = [s.strip() for s in body.split(";") if s.strip()]
    return json.dumps([s.replace("app.", "pg_temp.").replace("create table if not exists pg_temp.",
                                                             "create temp table if not exists ")
                       for s in stmts if s.startswith("create")])


def sources(folder: Path, names: tuple[str, ...] | None = None) -> str:
    src = {p.stem: p.read_text() for p in folder.glob("*.py") if names is None or p.stem in names}
    return base64.b64encode(json.dumps(src).encode()).decode()


def run(runner: str, script: str, payload: str, *args: str) -> dict:
    got = subprocess.run(["docker", "exec", "-i", runner, "python3", "-c", script, *args], input=payload + "\n",
                         capture_output=True, text=True, timeout=900)
    if got.returncode != 0 or not got.stdout.strip():
        print(got.stderr[-3000:])
        raise SystemExit(f"{runner}: the check did not finish (rc {got.returncode})")
    return json.loads(got.stdout.strip().splitlines()[-1])


def main() -> int:
    failed = 0
    print("the lane (asa-hub-snapshot)")
    lane = run(LANE_RUNNER, LANE, sources(ROOT / "server", ("cert_reads", "mar_papers", "digest_engine")), ddl_temp(),
               CPR)
    print("the door (asa-hub-db-sync)")
    door = run(DOOR_RUNNER, DOOR, sources(ROOT / "app"), ddl_temp(), json.dumps(lane["facts"].get("readings") or {}))
    for got in (lane, door):
        for name, ok, detail in got["checks"]:
            print(f"  {'ok  ' if ok else 'FAIL'} {name}" + ("" if ok else f"\n       {detail}"))
            failed += 0 if ok else 1
        for k, v in got["facts"].items():
            if k != "readings":
                print(f"  · {k}: {v}")
    print("all ok" if not failed else f"{failed} FAILED")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
