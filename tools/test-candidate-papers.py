#!/usr/bin/env python3
"""Staff Candidates' papers, Python's alone, on real candidates: asa-hub-app's plan, verdict and records
(candidatePaperPlan, candidatePaperDecide, candidatePaperKeep, candidateResumeScore, the packet on file) in
asa-hub-db-sync, every write inside one transaction rolled back; then the relay's half in asa-hub-snapshot — a paper's
words read and the decoder's reading in Python, the Drive filing as asatech against a recording Drive, and the
résumé's scorecard against a stubbed model. Nothing real is written or filed. Prints shapes and counts only."""
from __future__ import annotations

import base64
import json
import py_compile
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DB_RUNNER = "asa-hub-db-sync"
RELAY = "asa-hub-snapshot"

LOADER = r'''
import base64, importlib.abc, importlib.util, json, sys, types
blob = json.loads(base64.b64decode(sys.stdin.readline()).decode())
SRC = blob["src"]


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

APP_DRIVER = LOADER + r'''
import time, uuid
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
import candidate_writes as CWR
import candidate_papers as CP
import candidates as CND
import main as M

W.EDITS_TABLE = "pg_temp.hub_edits_cnp"
W.LOCK_KEY = 0x434E5050


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
real = psycopg.connect(hubdb._dsn(), autocommit=False, connect_timeout=5, application_name="candidate-papers-check")
proxy = Conn(real)
store = W.Store(connect=lambda: proxy, kind="check", label="Check")
db.stale = lambda books: False
M.DB = db
M.WRITES["candidates"] = CWR
M.stores = lambda: {"candidates": store}
M.WRITE_BUDGET_S = 120.0
TIMES = {}


def timed(action, t0):
    TIMES[action] = max(TIMES.get(action, 0.0), time.time() - t0)


def read(action, who, payload):
    t0 = time.time()
    res = M._run(CND, action, who, payload)
    timed(action, t0)
    return json.loads(res.body)


def write(action, who, payload):
    wid = "Wcheck-cnp-" + uuid.uuid4().hex[:12]
    t0 = time.time()
    res = M._run_write(CWR, action, who, payload, wid)
    timed(action, t0)
    return json.loads(res.body), wid


def kept(wid):
    with real.cursor() as c:
        c.execute("select tab_name, row_key, field, value from pg_temp.hub_edits_cnp where write_id = %s order by id",
                  (wid,))
        got = c.fetchall()
    cells = {}
    for t, rk, f, v in got:
        cells.setdefault((t, rk), {})[f] = v
    facts_ = {}
    tabs = set()
    for (t, rk), c in cells.items():
        tabs.add(t)
        if t == "Facts":
            facts_[(c.get("Subject ID", ""), c.get("Source", ""))] = c.get("Value", "")
    return facts_, tabs


reads0 = L.Reads(db, None)
users = [u for u in reads0.users() if gsjs.str_(u.get("userid")) and not gsjs.str_(u.get("mergedinto"))]
master = next((u for u in users if gsjs.str_(u.get("email")).lower() == sc.MASTER_ACCOUNT), None)
stranger = next((u for u in users if gsjs.str_(u.get("role")).lower() == "staff" and not gsjs.str_(u.get("clientkey"))
                 and gsjs.str_(u.get("email")).lower() != sc.MASTER_ACCOUNT), None)
MASTER = {"uid": gsjs.str_((master or {}).get("userid")) or "USR_MASTER", "role": "admin", "is_master": True}
STRANGER = {"uid": gsjs.str_((stranger or {}).get("userid")), "role": "staff", "is_master": False}
with real.transaction():
    store.ensure()
check("the edit store is made in temp tables", store.ready(), store.why)

# real candidates whose Actions answer asks a paper of a step
b = CND.board(reads0)
want = {"cjis": None, "resume": None, "new-hire-packet": None}
upload_doc = None
seen = 0
for key, row in list(b["byId"].items()):
    if all(want.values()) and upload_doc:
        break
    seen += 1
    if seen > 400:
        break
    ctx = CND.candidate_of(reads0, key)
    if ctx.get("refused") or ctx.get("archived"):
        continue
    try:
        a = CND.actions_build(reads0, ctx)
    except Exception:
        continue
    for it in a.get("items") or []:
        if it.get("paper") and it["id"] in want and want[it["id"]] is None:
            want[it["id"]] = (key, it)
    if upload_doc is None:
        try:
            docs = CND.documents_build(reads0, ctx).get("docs") or []
        except Exception:
            docs = []
        hit = next((d for d in docs if d.get("upload") and str(d.get("id", "")).startswith("doc_")
                    and d["upload"]["payload"].get("doc_id")), None)
        if hit:
            upload_doc = (key, hit)
facts["candidates looked at"] = f"{seen}; a step asking a paper: " + ", ".join(
    f"{k} {'found' if v else 'absent'}" for k, v in want.items()) + f"; an upload {'found' if upload_doc else 'absent'}"
B64 = 4000
FILED = {"file_id": "1CHECKfileIdNotReal0001", "size": 3000, "folder_id": "1CHECKfolderNotReal0001",
         "folder_made": True}


def reading_for(plan, kind, named="match", result="clear", packet=False, score=20):
    return {"paper": {"state": "read", "chars": 900, "kind": kind, "kind_score": score, "person_seen": plan["who"],
                      "issued_on": "2026-01-15", "expires_on": ""}, "named": named, "result": result, "packet": packet}


def run_document(key, item, doc, mime, filename, extra=None):
    ask = {"candidate": key, "press": "document", "item": item,
           "fields": {"filename": filename, "mime_type": mime, **({"doc": doc} if doc else {}), **(extra or {})},
           "b64_chars": B64}
    return ask, read("candidatePaperPlan", MASTER, ask)


def carried(plan):
    return {k: v for k, v in plan.items() if k != "vocab"}


def guarded(name, fn):
    try:
        with real.transaction():
            fn()
    except Exception as exc:  # noqa: BLE001
        import traceback
        check(name + ": ran to the end", False, type(exc).__name__ + ": " + str(exc)[:200] + " @ " +
              traceback.format_exc().strip().splitlines()[-3][:160])


def cjis():
    key, it = want["cjis"]
    ask, env = run_document(key, "cjis", "", "image/png", "report.png")
    check("CJIS keeps the report as a PDF: a picture is refused before anything is read",
          env.get("status") == 400 and "as a PDF" in env.get("message", ""), env)
    ask, env = run_document(key, "cjis", "", "application/pdf", "report.pdf", {"check": True})
    plan = env.get("data") or {}
    check("CJIS: the plan names the step, its kinds, the words book and the result on file",
          env.get("status") == 200 and plan.get("step") == "cjis" and plan.get("kinds") == ["background_check"]
          and plan.get("cjis") is True and isinstance(plan.get("vocab"), dict) and "Digest Kinds" in plan["vocab"], env)
    r = reading_for(plan, "background_check")
    env = read("candidatePaperDecide", MASTER, {**ask, "plan": carried(plan), "reading": r})
    done = (env.get("data") or {}).get("done") or {}
    check("CJIS read only: verified, nothing filed, a Clear suggested only off a clear, named reading",
          env.get("status") == 200 and done.get("verified") is True and done.get("filed") is False
          and done.get("cjis_status") in ("Clear", done.get("cjis_on_file") or "Clear"), env)
    ask, env = run_document(key, "cjis", "", "application/pdf", "report.pdf", {"cjis_status": "Clear"})
    plan = env["data"]
    other = reading_for(plan, "cpr_first_aid")
    env = read("candidatePaperDecide", MASTER, {**ask, "plan": carried(plan), "reading": other})
    done = (env.get("data") or {}).get("done") or {}
    check("a paper read as something else is not taken, and says nothing was written",
          done.get("verified") is False and done.get("reason") == "kind" and done.get("why", "").endswith(
              "Nothing was written."), env)
    env = read("candidatePaperDecide", MASTER, {**ask, "plan": carried(plan), "reading": r})
    d = env.get("data") or {}
    places = d.get("placements") or []
    check("CJIS filed: the report goes to the uploads folder as CJIS_…, a PDF, shared with the admins",
          env.get("status") == 200 and places and places[0]["door"] == "cjisUpload" and places[0]["where"] == "uploads"
          and places[0]["name"].startswith("CJIS_") and places[0]["mime"] == "application/pdf"
          and isinstance(places[0].get("grants"), list), env)
    filed = [dict(FILED, file_id=f"1CHECKfileIdNotReal000{i}") for i in range(len(places))]
    env, wid = write("candidatePaperKeep", MASTER, {**ask, "plan": carried(plan), "reading": r, "filed": filed})
    facts_, tabs = kept(wid)
    sources = {s for (_sub, s) in facts_}
    check("CJIS kept: the result and the report on the analysis row, its line and the press's, final",
          env.get("status") == 200 and (env.get("_write") or {}).get("final") is True
          and facts_.get((key, "dissolution:entity_resume_analyses.cjisstatus")) == "Clear"
          and "dissolution:entity_resume_analyses.cjisreporturl" in sources
          and any(v == "cjis_filed" for (s, src), v in facts_.items() if src.endswith("hiring_journey.step"))
          and any(v == "staff_candidates" for (s, src), v in facts_.items() if src.endswith("hiring_journey.step")),
          sorted(sources)[:12])
    data = env.get("data") or {}
    check("CJIS answer: filed, the doors it ran, the journey entry",
          data.get("filed") is True and data.get("doors") and data["doors"][0]["action"] == "tableDocUpload"
          and (data.get("entry") or {}).get("title") == "Document filed", data)
    if plan.get("signed"):
        check("a signed packet deposits the report in Onboarding Documents too",
              len(places) == 2 and places[1]["door"] == "docUpload")
    env = read("candidatePaperPlan", STRANGER, {**ask})
    check("someone App Control does not open the app to is told nothing", env.get("status") in (403, 404), env)


def resume():
    key, it = want["resume"]
    ask, env = run_document(key, "resume", "", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                            "cv.docx")
    plan = env.get("data") or {}
    check("Résumé: a Word file is taken where the step takes one", env.get("status") == 200 and plan.get("word"), env)
    r = reading_for(plan, "application_resume")
    env = read("candidatePaperDecide", MASTER, {**ask, "plan": carried(plan), "reading": r})
    places = (env.get("data") or {}).get("placements") or []
    check("Résumé filed: the uploads folder, shared, its shortcuts beside the Hiring table",
          places and places[0]["door"] == "resumeUpload" and places[0].get("shortcuts", {}).get("folder"), env)
    filed = [dict(FILED, shortcuts=3)]
    env, wid = write("candidatePaperKeep", MASTER, {**ask, "plan": carried(plan), "reading": r, "filed": filed})
    facts_, tabs = kept(wid)
    sources = {s for (_sub, s) in facts_}
    check("Résumé kept: its line, the record touched, the decoder's ledger row; a scorecard owed when none is on file",
          env.get("status") == 200 and "dissolution:entity_candidates.updatedby" in sources
          and any(v == "resume_on_file" for (s, src), v in facts_.items() if src.endswith("hiring_journey.step")),
          sorted(sources)[:12])
    facts["résumé keep"] = (f"tabs {sorted(tabs)}, score owed: {'yes' if (env.get('data') or {}).get('score_owed') else 'no'}")
    owed = (env.get("data") or {}).get("score_owed")
    if owed:
        env, wid = write("candidateResumeScore", MASTER, {"candidate": key, "fields": {
            "skills_rating": "4", "experience_rating": "3", "job_history_rating": "3", "certs_rating": "2",
            "composite_score": "13.0", "summary": "Check"}, "hash": "0011223344556677", "raw": "{}", "error": "",
            "source_asset_id": FILED["file_id"]})
        facts_, _t = kept(wid)
        check("the scorecard is kept as the analysis row's facts, its composite as computed",
              env.get("status") == 200 and facts_.get((key, "dissolution:entity_resume_analyses.compositescore"))
              == "13.0", env)


def packet():
    key, it = want["new-hire-packet"]
    paper = it["paper"]
    doc = paper["choices"][0]["doc_id"] if paper.get("choices") else ""
    ask, env = run_document(key, "new-hire-packet", doc, "application/pdf", "packet.pdf")
    plan = env.get("data") or {}
    check("the packet step's plan: its paper, whole-packet reading asked unless a choice is filed",
          env.get("status") == 200 and plan.get("packet_whole") == (not doc), env)
    kind = (plan.get("kinds") or ["offer_letter"])[0]
    r = reading_for(plan, kind, packet=False)
    env = read("candidatePaperDecide", MASTER, {**ask, "plan": carried(plan), "reading": r})
    d = env.get("data") or {}
    doors = [x["door"] for x in d.get("doors") or []]
    check("one form of the packet is deposited and the step stays open (no packetWaive)",
          env.get("status") == 200 and doors[:1] == ["docUpload"] and "packetWaive" not in doors, env)
    env, wid = write("candidatePaperKeep", MASTER, {**ask, "plan": carried(plan), "reading": r, "filed": [FILED]})
    facts_, _t = kept(wid)
    sources = {s for (_sub, s) in facts_}
    check("the deposit is a candidate_documents row: uploaded, pending review, its file and day",
          env.get("status") == 200 and "dissolution:candidate_documents.docrowid" in sources
          and any(v == "uploaded" for (s, src), v in facts_.items() if src.endswith("candidate_documents.status")),
          sorted(sources)[:12])
    if not doc:
        r2 = reading_for(plan, "offer_letter", packet=True)
        env = read("candidatePaperDecide", MASTER, {**ask, "plan": carried(plan), "reading": r2})
        doors = [x["door"] for x in (env.get("data") or {}).get("doors") or []]
        check("the whole signed packet closes the step: deposited, then packetWaive", doors == ["docUpload", "packetWaive"],
              env)
        env, wid = write("candidatePaperKeep", MASTER, {**ask, "plan": carried(plan), "reading": r2, "filed": [FILED]})
        facts_, _t = kept(wid)
        check("the packet on file: waived on the candidate's record with the file it names",
              env.get("status") == 200 and facts_.get((key, "dissolution:entity_candidates.packetstatus")) == "waived"
              and facts_.get((key, "dissolution:entity_candidates.packetsrid")) == "file:" + FILED["file_id"], env)
        facts["the packet's release"] = json.dumps({k: v for k, v in (env.get("data") or {}).items()
                                                    if k in ("closes", "filed")})


def uploads():
    key, doc = upload_doc
    ask = {"candidate": key, "press": "upload", "item": doc["id"],
           "fields": {"filename": "paper.pdf", "mime_type": "application/pdf"}, "b64_chars": B64}
    env = read("candidatePaperPlan", MASTER, ask)
    plan = env.get("data") or {}
    places = plan.get("placements") or []
    check("Upload: tableDocUpload's own door chosen and placed (the candidate's folder for a catalog paper)",
          env.get("status") == 200 and plan.get("doors", [{}])[0].get("door") == "docUpload"
          and places and places[0]["where"] == "candidate", env)
    env, wid = write("candidatePaperKeep", MASTER, {**ask, "plan": carried(plan), "filed": [FILED]})
    facts_, _t = kept(wid)
    check("Upload kept: the document's row and the press's line, the folder id remembered",
          env.get("status") == 200 and (env.get("data") or {}).get("door") == "tableDocUpload"
          and any(src.endswith("entity_candidates.docsfolderid") for (_s, src) in facts_), env)
    env, _w = write("candidatePaperKeep", MASTER, {**ask, "plan": carried(plan), "filed": []})
    check("a keep naming no filed file writes nothing", env.get("status") == 400, env)


def resume_scans():
    import resume_texts as RT
    owed, rows = [], {}
    real_kept, real_owe = RT.kept, RT.owe
    RT.kept = lambda reads, fid: rows.get(fid)
    RT.owe = lambda fid, modified, cand: owed.append((fid, modified, cand))
    try:
        check("a PDF with no text layer and a picture are scans; a Word file is not",
              CND.resume_scan({"mimeType": "application/pdf"}, "the PDF is a scan, with no text layer")
              and CND.resume_scan({"mimeType": "image/jpeg"}, "x")
              and not CND.resume_scan({"mimeType": "application/pdf"}, "the PDF could not be opened (X)"))
        text, why = CND.resume_scan_text(reads0, "FILE1", "2026-10-18T00:00:00.000Z", "CAN_X")
        check("a scan not read yet is owed to the OCR lane once, and said being read",
              text == "" and "being read" in why and owed == [("FILE1", "2026-10-18T00:00:00.000Z", "CAN_X")], owed)
        rows["FILE1"] = {"state": "read", "text": "Jane Doe\nExperience\nCaregiver 2019-2024",
                         "modified_time": "2026-10-18T00:00:00.000Z", "error": ""}
        text, why = CND.resume_scan_text(reads0, "FILE1", "2026-10-18T00:00:00.000Z", "CAN_X")
        check("the lane's words for that modified time are the résumé's text", text.startswith("Jane Doe") and not why)
        owed.clear()
        text, why = CND.resume_scan_text(reads0, "FILE1", "2026-10-19T00:00:00.000Z", "CAN_X")
        check("a newer file is owed again", text == "" and len(owed) == 1)
    finally:
        RT.kept, RT.owe = real_kept, real_owe


try:
    with real.transaction():
        guarded("résumé scans", resume_scans)
        # the upload first: a deposit the packet's check keeps would put that paper on file
        for name, fn, ok in (("uploads", uploads, upload_doc), ("cjis", cjis, want["cjis"]),
                             ("resume", resume, want["resume"]), ("packet", packet, want["new-hire-packet"])):
            if ok:
                guarded(name, fn)
            else:
                facts["skipped " + name] = "no candidate on file asks it now"
        facts["slowest per action"] = ", ".join(f"{a} {s:.2f}s" for a, s in sorted(TIMES.items()))
        raise psycopg.Rollback()
finally:
    try:
        real.close()
    except Exception:
        pass
print(json.dumps({"checks": out, "facts": facts}))
'''

RELAY_DRIVER = LOADER + r'''
sys.path.insert(0, "/srv/app")
import io
import fitz
import candidate_papers as CNP
import cert_papers as CPS
import digest_engine as DE

NAME = "Jordan Avery Example"


def pdf(text):
    d = fitz.open()
    p = d.new_page()
    p.insert_text((50, 72), text, fontsize=11)
    return d.tobytes()


body = ("STATE OF OHIO BUREAU OF CRIMINAL INVESTIGATION\nWebCheck Background Check Results\nName: " + NAME +
        "\nDate of Report: 01/15/2026\nResult: No record found\n")
data = pdf(body)
plan = {"file": {"name": "report.pdf", "mime": "application/pdf"}, "kinds": ["background_check"], "today": "2026-10-18",
        "who": NAME, "packet_whole": False, "packet_shows": [["offer_letter"], ["work_authorization", "tax_form"]],
        "vocab": None}
reading, text = CNP.read_paper(plan, data)
p = reading["paper"]
check("a PDF's words are read here (no Drive copy, no Apps Script) and the decoder's reading is Python's",
      p.get("state") == "read" and int(p.get("chars") or 0) > 0 and isinstance(reading.get("named"), str), reading)
check("the name printed on the paper is the candidate's", reading.get("named") == "match", reading)
facts["the paper's reading"] = json.dumps({"kind": p.get("kind"), "score": p.get("kind_score"),
                                           "named": reading.get("named"), "result": reading.get("result")})
heic = CNP.read_paper({**plan, "file": {"name": "a.heic", "mime": "image/heic"}}, b"x")[0]
check("a HEIC photo is said unread, never guessed", heic["paper"]["state"] == "heic", heic)
try:
    CNP.decode("", CPS.MAX_BYTES)
    check("no file attached is refused", False)
except CNP.Refused as why:
    check("no file attached is refused in the door's words", str(why) == "No file attached", why)


class Exec:
    def __init__(self, v):
        self.v = v

    def execute(self):
        return self.v


class Files:
    def __init__(self, rec):
        self.rec = rec

    def get(self, fileId, fields="", supportsAllDrives=True):
        self.rec.append(("get", fileId))
        if fileId.startswith("ALIVE"):
            return Exec({"id": fileId, "mimeType": CPS.FOLDER_MIME, "trashed": False, "parents": ["PARENT"]})
        return Exec({"id": fileId, "parents": ["SIBPARENT"]})

    def list(self, **kw):
        self.rec.append(("list", kw.get("q", "")[:40]))
        return Exec({"files": []})

    def create(self, body=None, media_body=None, fields="", supportsAllDrives=True):
        kind = "shortcut" if (body or {}).get("mimeType") == CNP.SHORTCUT_MIME else (
            "folder" if (body or {}).get("mimeType") == CPS.FOLDER_MIME else "file")
        self.rec.append(("create", kind, (body or {}).get("name"), tuple((body or {}).get("parents") or ())))
        return Exec({"id": "NEW" + kind.upper() + str(len(self.rec)), "name": (body or {}).get("name")})


class Perms:
    def __init__(self, rec):
        self.rec = rec

    def create(self, fileId, body, sendNotificationEmail=True, supportsAllDrives=True, fields=""):
        self.rec.append(("grant", fileId, body.get("emailAddress"), sendNotificationEmail))
        return Exec({"id": "P"})


class Drive:
    def __init__(self):
        self.rec = []

    def files(self):
        return Files(self.rec)

    def permissions(self):
        return Perms(self.rec)


drv = Drive()
CPS.OWNER_FACTORY = lambda: drv
places = [{"door": "docUpload", "where": "candidate", "folder_id": "", "folder_name": "Name — CAN_X", "parent_id": "",
           "parent_name": "Onboarding Documents", "root": "ROOT", "name": "dodd_8hr__2026-10-18__paper.pdf",
           "mime": "application/pdf", "max_bytes": CPS.MAX_BYTES},
          {"door": "resumeUpload", "where": "uploads", "folder_id": "ALIVE_UPLOADS", "parent_name": "Uploads",
           "root": "ROOT", "name": "cv.pdf", "mime": "application/pdf", "grants": ["a@example.org", "b@example.org"],
           "uploader": "c@example.org", "grants_held": "", "max_bytes": CPS.MAX_BYTES,
           "shortcuts": {"folder": "TABLEFOLDER", "siblings": ["SIB1", "SIB2"]}}]
filed = CNP.file_all(places, data)
creates = [r for r in drv.rec if r[0] == "create"]
grants = [r for r in drv.rec if r[0] == "grant"]
check("a deposit with no folder on the record makes the candidate's folder under Onboarding Documents",
      [c[1] for c in creates[:3]] == ["folder", "folder", "file"] and filed[0]["folder_made"] is True, creates[:3])
check("an uploads-folder file is shared with each admin and the uploader, Google sending no letter",
      len(grants) == 3 and all(g[3] is False for g in grants) and filed[1]["shared"] == 3, grants)
check("a résumé's shortcuts are placed beside the Hiring table (3)", filed[1].get("shortcuts") == 3, filed[1])
CPS.OWNER_FACTORY = None

import resume_texts as RTX
scan = fitz.open()
page = scan.new_page()
words_pic = fitz.open()
wp = words_pic.new_page(width=600, height=200)
wp.insert_text((30, 80), "Caregiver Experience 2019 2024 Home Health Aide", fontsize=22)
pix = wp.get_pixmap(dpi=150)
page.insert_image(page.rect, stream=pix.tobytes("png"))
got_text, pages = RTX.ocr(scan.tobytes(), "scan.pdf", "application/pdf")
check("a scanned résumé (a PDF holding only a picture) is read by Tesseract here",
      "Caregiver" in got_text and pages == 1, got_text[:80])
CNP.rubric_text = lambda doc:"RUBRIC: rate skills, experience, job history and certifications"
CNP.ask_model = lambda prompt: (json.dumps({"SkillsRating": 4, "ExperienceRating": 3, "JobHistoryRating": 3,
                                            "CertsRating": 2, "CompositeScore": 12, "Summary": "Check"}), "stub")
card = CNP.scorecard("Experienced caregiver resume text", {"rubric_doc": "DOC", "wrap": "{rubric}\n---\n{resume}"})
check("the scorecard's composite is computed here, never taken from the model (and the difference said)",
      card["status"] == "ok" and card["fields"].get("composite_score") == "14.5" and "recomputed" in card["error"], card)
print(json.dumps({"checks": out, "facts": facts}))
'''


def run(runner: str, driver: str, src: dict[str, str], py: str) -> dict:
    got = subprocess.run(["docker", "exec", "-i", "-e", "MALLOC_ARENA_MAX=2", runner, py, "-c", driver],
                         input=base64.b64encode(json.dumps({"src": src}).encode()) + b"\n", capture_output=True,
                         timeout=900)
    lines = got.stdout.decode().strip().splitlines()
    if got.returncode != 0 or not lines:
        return {"checks": [[f"the driver ran in {runner}", False, got.stderr.decode()[-2500:]]], "facts": {}}
    return json.loads(lines[-1])


def main() -> int:
    for f in ("app/candidate_papers.py", "app/candidate_writes.py", "server/candidate_papers.py"):
        py_compile.compile(str(ROOT / f), doraise=True)
    print("ok   the papers' modules compile")
    app = {p.stem: p.read_text(encoding="utf-8") for p in (ROOT / "app").glob("*.py")}
    server = {n: (ROOT / "server" / f"{n}.py").read_text(encoding="utf-8")
              for n in ("candidate_papers", "cert_papers", "digest_engine", "resume_texts")
              if (ROOT / "server" / f"{n}.py").is_file()}
    failed = total = 0
    for runner, driver, src, py in ((DB_RUNNER, APP_DRIVER, app, "python"), (RELAY, RELAY_DRIVER, server, "python3")):
        res = run(runner, driver, src, py)
        for name, ok, detail in res["checks"]:
            total += 1
            print(("ok   " if ok else "FAIL ") + name + ("" if ok else f"\n       {detail}"))
            failed += 0 if ok else 1
        for k, v in res["facts"].items():
            print(f"fact {k}: {v}")
    print(f"{total - failed} ok, {failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
