#!/usr/bin/env python3
"""Clients › Medication › Administration with the OCR text kept: the relay's MARS lane (server/mar_papers.py) finds
a new paper in a client folder, queues client_files' papers, reads each once (an archived text whole, a real paper
with Tesseract) and keeps a failed reading failed with its error and its next try; the Clients door then lists the
found paper, says where each reading stands and opens the kept text without Drive. Both halves run on temporary
tables (pg_temp) in asa-hub-db, the lane in asa-hub-snapshot and the door in asa-hub-db-sync: nothing in app.* or
in the drive is written. Prints shapes and counts only, never a paper's words."""
from __future__ import annotations

import base64
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LANE_RUNNER, DOOR_RUNNER = "asa-hub-snapshot", "asa-hub-db-sync"
# a real MARS paper no list held (three scanned pages), read for real; the client whose folder it sits in
REAL_PAPER, REAL_NAME = "1KS5vIyV_LZo6NJfL8c_RPzqKreGJbnl_", "MARS_2026 August_ Martha Sites.pdf"
CLIENT, FOLDER = "martha_sites", "Martha Sites"

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

DDL = (Path(__file__).resolve().parent.parent / "db" / "mar-papers.sql").read_text()

LANE = LOADER + r'''
import io, os, time
from datetime import datetime, timedelta, timezone
sys.path.insert(1, "/srv/app")
import psycopg2
import mar_papers as MP

REAL_PAPER, REAL_NAME, DDL = sys.argv[1], sys.argv[2], json.loads(sys.argv[3])
MP.SCHEMA, MP.CLIENTS_FOLDER = "pg_temp", "ROOT"
conn = psycopg2.connect(MP.DSN, connect_timeout=5)
with conn, conn.cursor() as cur:
    for stmt in DDL:
        cur.execute(stmt)
real = MP._drive()
NOW = "2026-10-18T12:00:00.000Z"


def f(fid, name, mime="application/pdf", size=1000, modified=NOW):
    return {"id": fid, "name": name, "mimeType": mime, "size": str(size), "createdTime": NOW, "modifiedTime": modified}


FOLDER = "application/vnd.google-apps.folder"
TREE = {
    "ROOT": [f("tpl", "0 - Templates", FOLDER), f("inact", "0 - Client Inactive", FOLDER), f("mrt", "Martha Sites", FOLDER)],
    "tpl": [f("tplMar01", "MAR template.pdf")],
    "inact": [f("old", "Old Client", FOLDER)],
    "old": [f("olddocs", "Docs", FOLDER)],
    "olddocs": [f("oldmars", "MARS", FOLDER)],
    "oldmars": [f("fakeHeld0001", "MAR 2025 May.pdf")],
    "mrt": [f(REAL_PAPER, REAL_NAME, size=1456107), f("fakeNotes001", "notes.pdf"), f("mrtmars", "MARS", FOLDER),
            f("mrtother", "Medical", FOLDER)],
    "mrtmars": [f("fakeTmp00001", "digest-tmp", "application/vnd.google-apps.document"),
                f("fakeSheet001", "MARS tracker", "application/vnd.google-apps.spreadsheet"),
                f("fakeBroken01", "scan Sept.pdf")],
    "mrtother": [f("deep", "Deep", FOLDER)],
    "deep": [f("deepmars", "MARS", FOLDER)],
    "deepmars": [],
}
ARCHIVE = ("---\nrow_id: CDOC_fakeHeld0001\nledger: clientFiles\nfile_id: fakeHeld0001\n---\n"
           "MEDICATION ADMINISTRATION RECORD May 2025 SSN 123-45-6789 initials")
GONE, LISTED = {"fakeBroken01"}, []


class Req:
    def __init__(self, fn):
        self.fn = fn

    def execute(self):
        return self.fn()


class NotThere(Exception):
    def __init__(self):
        self.resp = type("R", (), {"status": 404})()


class Files:
    def list(self, q="", **kw):
        fid = q.split("'")[1]
        LISTED.append(fid)
        return Req(lambda: {"files": TREE.get(fid, [])})

    def get(self, fileId, **kw):
        if fileId == REAL_PAPER:
            return real.files().get(fileId=fileId, **kw)
        if fileId in GONE:
            return Req(lambda: (_ for _ in ()).throw(NotThere()))
        return Req(lambda: {"id": fileId, "size": "100"})

    def get_media(self, fileId, **kw):
        if fileId == REAL_PAPER:
            return real.files().get_media(fileId=fileId, **kw)
        if fileId == "fakeArchive01":
            return Req(lambda: ARCHIVE.encode())
        return Req(lambda: b"%PDF-1.4 not a paper")


class Drive:
    def files(self):
        return Files()


MP.DRIVE_FACTORY = Drive
HELD = {
    "fakeHeld0001": {"drive_id": "fakeHeld0001", "doc_kind": "mar", "text_file": "fakeArchive01", "title": "MAR 2025 May.pdf",
                     "mime_type": "application/pdf", "chars": 90, "cell": 40, "house": "H"},
    "fakeCell0001": {"drive_id": "fakeCell0001", "doc_kind": "mar", "text_file": "", "title": "MAR 2025 June.pdf",
                     "mime_type": "application/pdf", "chars": 21, "cell": 21, "house": "H", "cell_text": "JUNE MAR WHOLE IN CELL"},
    "fakeOrder001": {"drive_id": "fakeOrder001", "doc_kind": "physician_order", "text_file": "", "title": "order.pdf",
                     "mime_type": "application/pdf", "chars": 0, "cell": 0, "house": "H"},
}
MP.MIRROR_READER = lambda: HELD


def rows(sql, args=()):
    with conn, conn.cursor() as cur:
        cur.execute(sql, args)
        return cur.fetchall() if cur.description else []


def texts():
    return {r[0]: {"source": r[1], "state": r[2], "engine": r[3], "chars": r[4], "pages": r[5], "masked": r[6],
                   "error": r[7], "attempts": r[8], "due": r[9], "text": r[10]}
            for r in rows("select drive_id, source, state, engine, chars, pages, masked, error, attempts,"
                          " next_try_at > now(), text from pg_temp.mar_paper_texts")}


try:
    t0 = time.monotonic()
    said = MP.one_pass(conn)
    facts["first pass"] = {k: v for k, v in said.items() if k != "sweep"} | {"seconds": round(time.monotonic() - t0, 1)}
    sw = said.get("sweep") or {}
    check("the walk finds each client folder and every MARS folder down to two levels, never a system top's",
          sw.get("walked") and sw.get("places") == 4 and "tpl" not in LISTED and "deep" not in LISTED, (sw, LISTED))
    found = {r[0]: r[1:] for r in rows("select drive_id, client_folder, area, folder, file_date from pg_temp.mar_papers")}
    check("a new paper in a client folder is found and kept, with its folder and the month its name states",
          found.get(REAL_PAPER) == ("Martha Sites", "active", "", "2026-08-01") and "fakeBroken01" in found, found)
    check("never a scratch copy, a Google file, a file not named MAR at a folder's root, nor one client_files holds",
          not {"fakeTmp00001", "fakeSheet001", "fakeNotes001", "fakeHeld0001", "tplMar01"} & set(found), sorted(found))
    t = texts()
    check("client_files' MARS rows are queued beside the found papers; a physician order is not",
          {"fakeHeld0001", "fakeCell0001", REAL_PAPER, "fakeBroken01"} == set(t), sorted(t))
    real_row = t.get(REAL_PAPER) or {}
    facts["the real paper"] = {k: real_row.get(k) for k in ("state", "engine", "chars", "pages")}
    check("the new paper arrives read: Tesseract over its scanned pages, kept in the store",
          real_row.get("state") == "read" and real_row.get("engine") == "tesseract" and (real_row.get("chars") or 0) > 100
          and real_row.get("pages") == 3, facts["the real paper"])
    held = t.get("fakeHeld0001") or {}
    check("an archived text is kept whole without the head Digest.gs wrote, the SSN masked as the archives are",
          held.get("state") == "read" and held.get("engine") == "archive" and held.get("masked") == 1
          and held.get("text", "").startswith("MEDICATION ADMINISTRATION RECORD") and "***-**-6789" in held.get("text", "")
          and "row_id" not in held.get("text", ""), {k: held.get(k) for k in ("state", "engine", "masked")})
    check("a text that fitted in the cell is kept from the cell", (t.get("fakeCell0001") or {}).get("engine") == "sheet",
          t.get("fakeCell0001"))
    broken = t.get("fakeBroken01") or {}
    check("a paper that cannot be read is FAILED, never read: its error, one attempt, a later try",
          broken.get("state") == "failed" and "no longer in the drive" in broken.get("error", "")
          and broken.get("attempts") == 1 and broken.get("due") is True and broken.get("text") is None, broken)
    beat = rows("select swept_at is not null, walked_at is not null, found, read, failed from pg_temp.mar_papers_beat")
    check("the beat says when the drive was listed and walked, and the counts", beat == [(True, True, 2, 3, 1)], beat)

    LISTED.clear()
    said = MP.one_pass(conn)
    check("the next pass lists nothing (not due) and reads nothing: a failure waits for its time",
          "sweep" not in said and said.get("read") == 0 and said.get("failed") == 0 and not LISTED, said)

    rows("update pg_temp.mar_paper_texts set next_try_at = now() - interval '1 second' where drive_id = 'fakeBroken01'")
    GONE.clear()
    said = MP.one_pass(conn)
    broken = texts()["fakeBroken01"]
    check("tried again at its time and failing again: still failed, a second attempt, a longer wait",
          said.get("failed") == 1 and broken["state"] == "failed" and broken["attempts"] == 2
          and "saw no words" in broken["error"] and broken["due"] is True, (said, broken))
    rows("update pg_temp.mar_paper_texts set next_try_at = now() - interval '1 second' where drive_id = 'fakeBroken01'")
    MP.PAPER_READER = lambda drive, fid, name, mime: ("SEPTEMBER MAR READ ON RETRY", 1, "tesseract")
    said = MP.one_pass(conn)
    broken = texts()["fakeBroken01"]
    check("a retry that reads marks it read, the error gone", broken["state"] == "read" and broken["error"] == ""
          and broken["chars"] == len("SEPTEMBER MAR READ ON RETRY"), broken)

    TREE["mrt"][0] = f(REAL_PAPER, REAL_NAME, size=1456107, modified="2026-10-18T13:00:00.000Z")
    TREE["mrtmars"] = [x for x in TREE["mrtmars"] if x["id"] != "fakeBroken01"]
    rows("update pg_temp.mar_papers_beat set swept_at = null, walked_at = null")
    MP.PAPER_READER = lambda drive, fid, name, mime: ("AUGUST MAR READ AGAIN", 3, "tesseract")
    said = MP.one_pass(conn)
    t = texts()
    check("a paper changed in the drive is read again", t[REAL_PAPER]["text"] == "AUGUST MAR READ AGAIN"
          and t[REAL_PAPER]["state"] == "read", t[REAL_PAPER]["state"])
    gone = rows("select drive_id from pg_temp.mar_papers where gone_at is not null")
    check("a paper a whole walk no longer sees is marked gone, never deleted", gone == [("fakeBroken01",)], gone)
    HELD["fakeHeld0001"] = {**HELD["fakeHeld0001"], "text_file": "fakeArchive02"}
    MP.PAPER_READER = None
    said = MP.one_pass(conn)
    check("client_files naming a new archive queues the paper again, read from it", said.get("seeded") == 2
          and texts()["fakeHeld0001"]["engine"] == "archive", said)

    SCRATCH = [{"id": "tmpDoc1", "name": "digest-tmp", "mimeType": "application/vnd.google-apps.document"},
               {"id": "tmpSheet1", "name": "digest-tmp", "mimeType": "application/vnd.google-apps.spreadsheet"},
               {"id": "tmpForm1", "name": "digest-tmp", "mimeType": "application/vnd.google-apps.form"},
               {"id": "paper1", "name": "digest-tmp (1)", "mimeType": "application/pdf"}]
    TRASHED, QUERIES = [], []

    class WFiles:
        def list(self, q="", **kw):
            QUERIES.append(q)
            return Req(lambda: {"files": [f for f in SCRATCH if f["id"] not in TRASHED]})

        def update(self, fileId, body=None, **kw):
            return (fileId, body)

    class Batch:
        def __init__(self, callback):
            self.cb, self.calls = callback, []

        def add(self, call, request_id):
            self.calls.append((call, request_id))

        def execute(self):
            for (fid, body), rid in self.calls:
                if body == {"trashed": True}:
                    TRASHED.append(fid)
                self.cb(rid, {"id": fid, "name": "digest-tmp", "trashed": True}, None)

    class WDrive:
        def files(self):
            return WFiles()

        def new_batch_http_request(self, callback):
            return Batch(callback)

    MP.WRITE_FACTORY = WDrive
    swept = MP.tidy_scratch(budget_s=30)
    check("the scratch tidy trashes only the hour-old 'digest-tmp' Docs and Sheets, never a Form or another name",
          sorted(TRASHED) == ["tmpDoc1", "tmpSheet1"] and swept == {"trashed": 2, "failed": 0}
          and "modifiedTime <" in QUERIES[0] and "trashed = false" in QUERIES[0], (TRASHED, swept, QUERIES[:1]))
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
import gsjs, hubdb, scope as sc, locations as L
import client_app as CA, client_meds as CM
import main as M

CLIENT, FOLDER, DDL = sys.argv[1], sys.argv[2], json.loads(sys.argv[3])
real = psycopg.connect(hubdb._dsn(), autocommit=True, connect_timeout=5, application_name="mar-papers-check")
for stmt in DDL:
    real.execute(stmt)


class Db(hubdb.HubDb):
    """asa-hub-db as the copy is read; the MARS lane's tables off this connection's temporary ones."""

    def query(self, sql_text, params=None):
        if "app.mar_" in str(sql_text):
            return list(real.execute(str(sql_text).replace("app.mar_", "pg_temp.mar_"), params).fetchall())
        return super().query(sql_text, params)


ASKED = []


class NoDrive:
    available = True

    def __getattr__(self, name):
        ASKED.append(name)
        raise ConnectionError("no drive in this check")


db = Db()
db.stale = lambda books: False
M.DB, M.DRIVE = db, NoDrive()
reads0 = L.Reads(db, None)
users = [u for u in reads0.users() if gsjs.str_(u.get("userid")) and not gsjs.str_(u.get("mergedinto"))]
master = next((u for u in users if gsjs.str_(u.get("email")).lower() == sc.MASTER_ACCOUNT), None)
MASTER = {"uid": gsjs.str_((master or {}).get("userid")) or "USR_MASTER", "role": "admin", "is_master": True}


def door(action, payload):
    return json.loads(M._run(CA, action, MASTER, payload).body)


env = door("clientSourceMar", {"client": CLIENT})
papers = (((env.get("data") or {}).get("tabs") or {}).get("papers") or {})
rows = papers.get("rows") or []
facts["papers before"] = len(rows)
check("the client's papers read from asa-hub-db", env.get("status") == 200 and len(rows) > 5, env.get("status"))
held = [r for r in rows if r.get("has_text")]
kept, archived = held[0]["file_id"], held[1]["file_id"]
real.execute("insert into pg_temp.mar_papers (drive_id, client_folder, title, mime_type, size_bytes, file_date)"
             " values ('fakeFound0001', %s, 'MARS_2026 September_x.pdf', 'application/pdf', 1000, '2026-09-01'),"
             " ('fakeFound0002', %s, 'MARS_2026 October_x.pdf', 'application/pdf', 1000, '2026-10-01'),"
             " ('fakeElse00001', 'Somebody Else Entirely', 'MARS_2026 September_y.pdf', 'application/pdf', 1, '')",
             (FOLDER, FOLDER))
real.execute("insert into pg_temp.mar_paper_texts (drive_id, source, state, text, chars, read_at, mark) values"
             " (%s, 'client_files', 'read', 'KEPT WORDS OF THE PAPER', 23, now(), 'm'),"
             " (%s, 'client_files', 'pending', null, null, null, 'm'),"
             " ('fakeFound0001', 'drive', 'failed', null, null, null, 'm'),"
             " ('fakeFound0002', 'drive', 'pending', null, null, null, 'm')", (kept, archived))
real.execute("update pg_temp.mar_paper_texts set error = 'the reading saw no words on the paper', attempts = 2,"
             " next_try_at = now() + interval '20 minutes' where drive_id = 'fakeFound0001'")
real.execute("insert into pg_temp.mar_papers_beat (id, swept_at) values (1, now())")

env = door("clientSourceMar", {"client": CLIENT})
papers = env["data"]["tabs"]["papers"]
by = {r["file_id"]: r for r in papers["rows"]}
check("a paper the lane found joins the client's list; another client's folder does not",
      "fakeFound0001" in by and "fakeFound0002" in by and "fakeElse00001" not in by
      and len(papers["rows"]) == facts["papers before"] + 2, sorted(by)[:3])
f1, f2 = by.get("fakeFound0001") or {}, by.get("fakeFound0002") or {}
check("a failed reading says so, with its error and its next try, and offers no text",
      f1.get("ocr_state") == "failed" and f1.get("has_text") is False and "OCR failed" in f1.get("details", "")
      and "saw no words" in f1.get("ocr_error", "") and f1.get("ocr_next_try_at"), f1)
check("a reading still owed is pending", f2.get("ocr_state") == "pending" and "OCR pending" in f2.get("details", ""), f2)
k = by.get(kept) or {}
check("a kept reading is read, with its length and when", k.get("ocr_state") == "read" and k.get("has_text") is True
      and k.get("text_chars") == 23 and k.get("ocr_read_at") and "OCR read" in k.get("details", ""), k)
check("the tab says when the drive was last listed", bool(papers.get("swept_at")), papers.get("swept_at"))
facts["kpis"] = {x: papers["kpis"].get(x) for x in ("papers", "ocr_read", "ocr_failed", "ocr_pending")}

env = door("clientSourceMarDocFile", {"client": CLIENT, "file_id": kept, "part": "text"})
d = env.get("data") or {}
check("the whole text opens from the store, the drive never asked", env.get("status") == 200
      and d.get("text") == "KEPT WORDS OF THE PAPER" and d.get("kept") is True and d.get("read_at") and not ASKED,
      (env.get("status"), ASKED))
env = door("clientSourceMarDocFile", {"client": CLIENT, "file_id": "fakeFound0001", "part": "text"})
check("a found paper whose reading failed answers why, not an empty text",
      env.get("status") == 404 and "failed" in env.get("message", "") and "tried again" in env.get("message", ""), env)
env = door("clientSourceMarDocFile", {"client": CLIENT, "file_id": "fakeFound0002", "part": "text"})
check("a found paper still owed its reading says it is being read",
      env.get("status") == 404 and "being read" in env.get("message", ""), env)
env = door("clientSourceMarDocFile", {"client": CLIENT, "file_id": archived, "part": "text"})
check("an archived paper the store has not read yet asks the drive's copy, and a drive that fails is said by Python "
      "(503), never handed on", ASKED and env.get("status") == 503 and "defer" not in env, (ASKED, env))
env = door("clientSourceMarDocFile", {"client": CLIENT, "file_id": "fakeElse00001", "part": "text"})
check("another client's found paper is not this client's", env.get("status") == 404
      and "no such MARS paper" in env.get("message", ""), env)
real.close()
print(json.dumps({"checks": out, "facts": facts}, default=str))
'''


def sources(*dirs_and_names: tuple[Path, tuple[str, ...]]) -> str:
    src = {}
    for folder, names in dirs_and_names:
        for n in names:
            src[n] = (folder / f"{n}.py").read_text()
    return base64.b64encode(json.dumps(src).encode()).decode()


def ddl_for_temp() -> str:
    """db/mar-papers.sql as temporary tables: the roles and grants left out, the schema pg_temp."""
    body = "\n".join(line for line in DDL.splitlines() if not line.startswith("--"))
    stmts = [s.strip() for s in body.split(";") if s.strip()]
    keep = [s.replace("app.", "pg_temp.").replace("create table if not exists pg_temp.", "create temp table if not exists ")
            for s in stmts if s.startswith("create")]
    return json.dumps(keep)


def run(runner: str, script: str, payload: str, *args: str) -> dict:
    got = subprocess.run(["docker", "exec", "-i", runner, "python3", "-c", script, *args], input=payload + "\n",
                         capture_output=True, text=True, timeout=900)
    if got.returncode != 0 or not got.stdout.strip():
        print(got.stderr[-3000:])
        raise SystemExit(f"{runner}: the check did not finish (rc {got.returncode})")
    return json.loads(got.stdout.strip().splitlines()[-1])


def main() -> int:
    failed = 0
    halves = (
        ("the lane (asa-hub-snapshot)", LANE_RUNNER, LANE, sources((ROOT / "server", ("mar_papers",))),
         (REAL_PAPER, REAL_NAME, ddl_for_temp())),
        ("the door (asa-hub-db-sync)", DOOR_RUNNER, DOOR,
         sources((ROOT / "app", tuple(p.stem for p in (ROOT / "app").glob("*.py")))), (CLIENT, FOLDER, ddl_for_temp())),
    )
    for title, runner, script, payload, args in halves:
        print(title)
        got = run(runner, script, payload, *args)
        for name, ok, detail in got["checks"]:
            print(f"  {'ok  ' if ok else 'FAIL'} {name}" + ("" if ok else f"\n       {detail}"))
            failed += 0 if ok else 1
        for k, v in got["facts"].items():
            print(f"  · {k}: {v}")
    print("all ok" if not failed else f"{failed} FAILED")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
