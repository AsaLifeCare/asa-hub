#!/usr/bin/env python3
"""app/service_doors.py (with service_mail.py, service_records.py, mail_reach.py, the real mail_server.py and
isp_decode.py) on a real FastAPI app inside asa-hub-snapshot (fastapi, httpx and MuPDF are there; asa-hub-app is never
exec'd into), every outside party stood in for: the session verdicts and Python's doors (front_door), the mail
server, the old platform's database, the forecast, the cortex, asa-hub-worker's Try and Google's upload session. Each
moved route: its happy path and one refusal, in the relay's words; a method the door does not take falls through to
the carrier.

    python3 tools/test-service-doors.py
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RUNNER = "asa-hub-snapshot"
REAL = ("service_doors", "service_mail", "service_records", "mail_reach", "mail_server", "isp_decode",
        "mw_relay_state")

DRIVER = r'''
import asyncio, base64, contextvars, importlib.abc, importlib.util, json, os, re, sys, tempfile, types
from dataclasses import dataclass
from pathlib import Path

SRC = json.loads(sys.stdin.read())
WORK = tempfile.mkdtemp(prefix="svc-doors-")
os.environ.update(HUB_SERVICE_SECRET="s3cret", ASA_MASTER_KEY="cortex-key", HUB_CORTEX_URL="http://cortex.test",
                  HUB_MAIL_CFG=WORK, HUB_RELAY_RO_DSN="", HUB_WORKER_URL="http://worker.test",
                  HUB_APP_TOKEN="machine-tok")

results = []
def check(name, ok, detail=None):
    results.append((name, bool(ok)))
    print(("  ok   " if ok else "  FAIL ") + name + ("" if ok or detail is None else f" — {detail}"))

def mod(name, **attrs):
    m = types.ModuleType(name)
    m.__dict__.update(attrs)
    sys.modules[name] = m
    return m

class Loader(importlib.abc.MetaPathFinder, importlib.abc.Loader):
    def find_spec(self, name, path, target=None):
        return importlib.util.spec_from_loader(name, self) if name in SRC else None
    def create_module(self, spec):
        return None
    def exec_module(self, module):
        module.__file__ = "/app/" + module.__name__ + ".py"
        exec(compile(SRC[module.__name__], module.__file__, "exec"), module.__dict__)
sys.meta_path.insert(0, Loader())

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response

# ---- stand-ins: the app's own modules the doors lean on ------------------------------------------------------------
class Defer(Exception):
    pass
class Unreadable(RuntimeError):
    pass
mod("scope", Defer=Defer)
mod("hubdb", OWN=contextvars.ContextVar("own", default=None), Unreadable=Unreadable)
CONFIG = {"test_mode": "on"}
class Reads:
    def __init__(self, db, drive=None):
        self.db, self.drive = db, drive
    def config(self):
        return CONFIG
class Session:
    def __init__(self, reads, user):
        self.reads, self.user = reads, user
mod("locations", Reads=Reads, Session=Session)
mod("location_docs", ROOT=Path(WORK))
ARMED = set()
UNREAD = []
def situations(reads):
    if UNREAD:
        raise Unreadable(UNREAD[0])
    return [{"id": g, "enabled": "yes"} for g in ARMED]
mod("smart_comms_desk", situations=situations,
    situation_on=lambda rows, gid: next((r for r in rows if r["id"] == gid), None))
mod("config_lane", test_mode=lambda cfg: {"on": cfg.get("test_mode") == "on", "word": cfg.get("test_mode")})
mod("digest_lab", lab_open=lambda sess: sess.user.get("id") == "u-granted")

class EmarDb:
    def tab(self, sid, tab):
        return types.SimpleNamespace(headers=("Client", "PrescriptionName", "Dosage", "AdministrationTimes", "MedType",
                                              "PRN", "med_pictures", "Discountinued"))
    def rows(self, ref):
        return [(2, {"Client": "Ann Lee", "PrescriptionName": "Aspirin", "Dosage": "81mg", "AdministrationTimes": "800",
                     "MedType": "oral", "PRN": "", "med_pictures": "pic [https://x.test/a.png]", "Discountinued": ""}),
                (3, {"Client": "Ann Lee", "PrescriptionName": "Old", "Discountinued": "yes"})]

@dataclass
class S:
    ok: bool
    role: str = ""
    uid: str = ""
    acting: bool = False
    @property
    def master(self):
        return False
SESSIONS = {"admin": S(True, "admin", "u1"), "staff": S(True, "staff", "u2"), "granted": S(True, "staff", "u-granted"),
            "switched": S(True, "admin", "u3", acting=True), "dead": S(False)}
CALLS = []
async def session(token):
    return SESSIONS.get(token)
def said(s, env, action):
    return {"uid": s.uid, "role": s.role.lower(), "is_master": False, "place": {}, "asked": action}
def form_raw(env):
    return json.dumps(env).encode()
async def fd_read(door, app_id, env, raw, s):
    CALLS.append(("read", door, app_id, env["payload"]))
    return Response(json.dumps({"status": 200, "door": door}), headers={"X-Hub-Phase": "ready"})
async def fd_write(door, app_id, env, raw, s):
    CALLS.append(("write", door, app_id, env["payload"]))
    return Response(json.dumps({"status": 200, "door": door}))
TECH = {}
async def call_app(app_id, action, user, payload, write_id="", at=0.0):
    CALLS.append(("call", action, app_id, payload))
    env = TECH.get(payload.get("file_id"))
    return None if env is None else (b"", 0.0, env, None, 0.0)
def header(resp, name):
    return resp.headers.get(name)
M = types.SimpleNamespace(DB=EmarDb(), DRIVE=None, _own=lambda: None, _finish=lambda own: None,
                          caller=lambda said_, reads, action, module: {"id": said_["uid"], "role": said_["role"]})
mod("front_door", session=session, said=said, form_raw=form_raw, read=fd_read, write=fd_write, call_app=call_app,
    header=header, M=M, UNREAD={"status": 503, "message": "unread"}, UNWRITTEN={"status": 503, "message": "unwritten"})

import service_doors as SD
import service_mail as SM
import service_records as SR
import mail_server as MB
import mw_relay_state as RS

# ---- the mail server ------------------------------------------------------------------------------------------------
LETTER = (b"Message-ID: <m1@asaop.org>\r\nFrom: Bo <bo@x.test>\r\nTo: hub@asaop.org\r\nSubject: Hello\r\n"
          b"Date: Fri, 23 Oct 2026 10:00:00 +0000\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary=b\r\n"
          b"\r\n--b\r\nContent-Type: text/plain\r\n\r\nhello there\r\n--b\r\nContent-Type: text/plain\r\n"
          b"Content-Disposition: attachment; filename=a.txt\r\n\r\nfile body\r\n--b--\r\n")
MAIL = {"appended": [], "stored": [], "copied": [], "smtp": []}
class Imap:
    def list(self):
        return "OK", [b'(\\HasNoChildren) "/" "Staff Late Show"', b'(\\HasNoChildren) "/" "INBOX"']
    def select(self, box, readonly=False):
        return "OK", [b"1"]
    def uid(self, cmd, *args):
        if cmd == "search":
            return "OK", [b"1"]
        if cmd == "fetch":
            return "OK", [(b"1 (FLAGS () BODY[] {1}", LETTER), b")"]
        if cmd == "store":
            MAIL["stored"].append(args)
        if cmd == "copy":
            MAIL["copied"].append(args)
        return "OK", [b""]
    def status(self, box, what):
        return "OK", [b"INBOX (UNSEEN 3)"]
    def append(self, box, flags, when, raw):
        MAIL["appended"].append((box, raw))
    def create(self, box):
        return "OK", []
    subscribe = create
    def expunge(self):
        return "OK", []
    def logout(self):
        pass
MB._open = lambda user, password, timeout=20: Imap()
class Smtp:
    def __init__(self, *a, **k):
        pass
    def __enter__(self):
        return self
    def __exit__(self, *a):
        return False
    def starttls(self):
        pass
    def login(self, u, p):
        pass
    def send_message(self, msg):
        MAIL["smtp"].append(msg)
SM.smtplib = types.SimpleNamespace(SMTP=Smtp)
SM.mail_reach.mx_lookup = lambda domain: "nxdomain" if domain == "dead.test" else "mx"

# ---- the old platform's database ------------------------------------------------------------------------------------
TABLES = {
    "asa_med_deliveries": [{"house": "H1", "file_date": "2026-10-01", "period_start": "", "period_end": "",
                            "meds_json": json.dumps([{"client": "Ann", "drug": "Aspirin", "qty": 30, "remaining": 4,
                                                      "sig": "daily"}])}],
    "asa_invoice_catalog": [{"file_uid": "f1", "name": "Receipt", "vendor": "Kroger", "category": "supplies_retail",
                             "kind": "receipt", "invoice_no": "", "amount": 12.5, "doc_date": "2026-10-02",
                             "web_view_link": "https://d.test/f1", "updated_at": "2026-10-02 10:00:00+00:00"}],
    "asa_isp_chat": [{"client_name": "Ann Lee", "isp_year": "2026", "medications": "Aspirin"}],
    "asa_finance_doc": [{"subfolder": "Receipts", "name": "r.pdf", "mime": "application/pdf", "size_bytes": 1,
                         "web_view_link": "", "vendor": "Kroger", "doc_date": "2026-10-02", "amount": 3,
                         "currency": "USD", "category": "", "method": ""}],
    "asa_client_financial_txns": [{"client_name": "Ann Lee", "txn_dt": "2026-10-02", "amount": -3.0}],
}
SQL = []
GRANTED = {"public." + t for t in SR.TABLES}
class Cur:
    description = None
    def __enter__(self):
        return self
    def __exit__(self, *a):
        return False
    def execute(self, sql, args=None):
        SQL.append(sql)
        if "has_table_privilege" in sql:
            self.description, self._rows = [("ok",)], [(args[0] in GRANTED,)]
            return
        m = re.search(r"FROM\s+(\w+)", sql)
        data = [] if (not m or "count(" in sql) else TABLES.get(m.group(1), [])
        cols = list(data[0]) if data else []
        self.description = [(c,) for c in cols]
        self._rows = [tuple(r.get(c) for c in cols) for r in data]
    def fetchall(self):
        return self._rows
class Conn:
    closed = False
    autocommit = True
    def cursor(self):
        return Cur()
    def close(self):
        pass

# ---- the outside world over HTTP --------------------------------------------------------------------------------------
UP = {"weather": "fail"}
TRIED = []
def world(request):
    url = str(request.url)
    if url.startswith("http://worker.test"):
        # asa-hub-worker's /digest/try (server/hub_worker.py): the machine token, then the lab's reading
        if UP.get("worker") == "down":
            raise httpx.ConnectError("worker down")
        if request.url.path != "/digest/try" or request.headers.get("x-hub-token") != "machine-tok":
            return httpx.Response(401, json={"status": 401, "message": "sign in again"})
        body = json.loads(request.content)
        TRIED.append(body)
        return httpx.Response(200, json={"status": 200, "file_id": body["file_id"], "file_name": body["file_name"],
                                         "kind": "pdf", "ordinary": {"chars": 5, "text": "hello"}})
    if "open-meteo" in url:
        if UP["weather"] == "fail":
            return httpx.Response(503)
        return httpx.Response(200, json={"daily": {"time": ["2026-10-24"], "weather_code": [61],
                                                   "temperature_2m_max": [61.4], "temperature_2m_min": [44.6],
                                                   "precipitation_probability_max": [70]},
                                         "current": {"temperature_2m": 55.2, "weather_code": 2,
                                                     "relative_humidity_2m": 60, "wind_speed_10m": 7.6}})
    if url.startswith("http://cortex.test"):
        if request.headers.get("authorization") != "Bearer cortex-key":
            return httpx.Response(401)
        if request.url.path == "/v1/monitor/actions/recent":
            return httpx.Response(500)
        return httpx.Response(200, content=json.dumps({"path": request.url.path}).encode())
    if "googleapis.com/upload" in url:
        if request.headers.get("content-range", "").endswith("/10"):
            return httpx.Response(200, json={"id": "F1", "name": "big.mp4"})
        return httpx.Response(308, headers={"Range": "bytes=0-4"})
    return httpx.Response(404)
Real = httpx.AsyncClient
class Faked(Real):
    def __init__(self, *a, **k):
        k["transport"] = httpx.MockTransport(world)
        super().__init__(*a, **k)
httpx.AsyncClient = Faked

async def carried(path: str, request: Request):
    return JSONResponse({"carried": request.url.path, "method": request.method})

def built():
    a = FastAPI()
    left = SD.install(a)
    a.api_route("/{path:path}", methods=["GET", "POST"])(carried)
    return a, left

GATED = {"mail": [p for p, _d in SM.ROUTES], "mail provision": ["/mail/provision"],
         "records": [p for p, _d in SR.ROUTES], "cortex": list(SD.CORTEX_READS)}

# every prerequisite missing: no credentials file, no database, no cortex key
cortex_env = {k: os.environ.pop(k) for k in ("ASA_MASTER_KEY", "HUB_CORTEX_URL")}
bare, bare_left = built()
os.environ.update(cortex_env)
# a database that answers but lacks one grant: fail closed
RS.CONNECT[0] = Conn
GRANTED.discard("public.asa_finance_doc")
records_short = SR.ready()
GRANTED.add("public.asa_finance_doc")
# every prerequisite here
(Path(WORK) / "hub-mail-creds.json").write_text(json.dumps({"ana@asaop.org": "pw"}))
ACCOUNTS = Path(WORK) / "postfix-accounts.cf"
ACCOUNTS.write_text("ana@asaop.org|{SHA512-CRYPT}$6$x$y\n")
app, app_left = built()

async def main():
    b = Real(transport=httpx.ASGITransport(app=bare), base_url="http://hub.test")
    check("without their prerequisites mail, records and cortex are left to the relay",
          bare_left == ["mail", "mail provision", "records", "cortex"], bare_left)
    falls = []
    for group, paths in GATED.items():
        for path in paths:
            r = (await (b.get(path) if group == "cortex" else b.post(path, json={}))).json()
            falls.append(r.get("carried") == path)
    check("each of their paths falls through to the carrier", all(falls) and len(falls) == 19, falls)
    r = (await b.get("/weather")).json()
    check("the doors with no prerequisite are here regardless", "carried" not in r, r)
    check("a database missing one grant keeps the record doors to the relay (fail closed)", records_short is False)
    check("with every prerequisite every group is here", app_left == [], app_left)

    c = Real(transport=httpx.ASGITransport(app=app), base_url="http://hub.test")
    svc = {"service_secret": "s3cret"}
    box = {**svc, "user": "hub@asaop.org", "password": "pw"}
    bear = lambda t: {"authorization": f"Bearer {t}"}

    # mail
    r = (await c.post("/mail/send", json={**box, "to": "a@b.test", "subject": "Hi", "body": "code 123456",
                                          "withhold": ["123456"], "send_id": "S1"})).json()
    check("mail/send sends, files the copy in Sent with the withheld words out",
          r["status"] == 200 and r["data"]["receipt"] == "queued" and len(MAIL["smtp"]) == 1
          and b"123456" not in MAIL["appended"][-1][1] and b"{withheld}" in MAIL["appended"][-1][1], r)
    r = (await c.post("/mail/send", json={**box, "to": "a@b.test", "subject": "Hi", "send_id": "S1"})).json()
    check("mail/send: a retried send_id is one letter", r == {"status": 200, "data": {"receipt": "deduplicated"}}, r)
    r = (await c.post("/mail/send", json={**box, "to": "x@dead.test", "subject": "Hi", "check_reach": True})).json()
    check("mail/send refuses an address that cannot receive mail (422)",
          r["status"] == 422 and r["data"]["undeliverable"] == "nxdomain", r)
    r = await c.post("/mail/send", json={"service_secret": "wrong", "to": "a@b.test"})
    check("mail/send without the secret: 401 in the body, HTTP 200",
          r.status_code == 200 and r.json() == {"status": 401, "message": "service identity required"}, r.text)
    r = (await c.post("/mail/inbox", json={**svc, "account": "ana@asaop.org", "limit": 5, "mailbox": "sent"})).json()
    check("mail/inbox reads a provisioned account's mailbox",
          r["status"] == 200 and r["data"]["mailbox"] == "Sent" and r["data"]["threads"][0]["subject"] == "Hello"
          and r["data"]["threads"][0]["has_attachment"] is True and r["data"]["folders"] == ["Staff Late Show"], r)
    r = (await c.post("/mail/inbox", json={**svc, "account": "nobody@asaop.org"})).json()
    check("mail/inbox with no credentials: 400", r == {"status": 400, "message": "mailbox credentials are required"})
    r = (await c.post("/mail/message", json={**box, "id": "<m1@asaop.org>"})).json()
    check("mail/message: the text and the attachment list",
          r["status"] == 200 and "hello there" in r["data"]["text"] and r["data"]["attachments"][0]["filename"] == "a.txt", r)
    r = (await c.post("/mail/message", json=box)).json()
    check("mail/message without an id: 400", r == {"status": 400, "message": "id is required"})
    part = (await c.post("/mail/message", json={**box, "id": "<m1@asaop.org>"})).json()["data"]["attachments"][0]["part"]
    r = (await c.post("/mail/attachment", json={**box, "id": "<m1@asaop.org>", "part": part})).json()
    check("mail/attachment: the bytes, base64",
          r["status"] == 200 and base64.b64decode(r["data"]["b64"]).strip() == b"file body", r)
    r = (await c.post("/mail/attachment", json={**box, "id": "<m1@asaop.org>"})).json()
    check("mail/attachment without a part: 400", r == {"status": 400, "message": "id and part are required"})
    r = (await c.post("/mail/mark", json={**box, "items": [{"id": "<m1@asaop.org>"}], "seen": "no"})).json()
    check("mail/mark clears the seen flag", r == {"status": 200, "data": {"marked": 1, "marked_ids": ["<m1@asaop.org>"]}}
          and MAIL["stored"][-1][1] == "-FLAGS", r)
    ARMED.add("gate_mail_mark_file")
    r = (await c.post("/mail/mark", json={**box, "items": [{"id": "<m1@asaop.org>"}]})).json()
    check("mail/mark held by the armed mail gate while the send switch is on: 409",
          r == {"status": 409, "message": "gate_mail_mark_file is armed and the send switch is on", "held": True}, r)
    r = (await c.post("/mail/file", json={**box, "items": [{"id": "<m1@asaop.org>"}], "folder": "Staff Late Show"})).json()
    check("mail/file held by the same gate", r.get("status") == 409 and r.get("held") is True, r)
    ARMED.clear()
    r = (await c.post("/mail/file", json={**box, "items": [{"id": "<m1@asaop.org>"}], "folder": "Staff Late Show"})).json()
    check("mail/file moves the message into its folder",
          r == {"status": 200, "data": {"moved": 1, "moved_ids": ["<m1@asaop.org>"], "not_found": [],
                                        "folder": "Staff Late Show"}}, r)
    r = (await c.post("/mail/file", json={**box, "ids": ["1"], "folder": "Random"})).json()
    check("mail/file into a folder of no platform shape: 400", r == {"status": 400, "message": "unknown folder shape"})
    r = (await c.post("/mail/unread", json={**svc, "accounts": ["ana@asaop.org"],
                                            "pairs": [{"user": "hub@asaop.org", "password": "pw", "label": "Hub"}]})).json()
    check("mail/unread counts each mailbox",
          r == {"status": 200, "data": {"counts": [{"address": "Hub", "unread": 3},
                                                   {"address": "ana@asaop.org", "unread": 3}]}}, r)
    r = (await c.post("/mail/unread", json=svc)).json()
    check("mail/unread with nothing to count: 400", r == {"status": 400, "message": "nothing to count"})

    # records
    for path in ("/inventory/meds", "/inventory/supplies", "/clients/meds", "/shopper/purchases",
                 "/finance/analytics", "/finance/history", "/finance/docs"):
        r = await c.post(path, json={"service_secret": "nope"})
        check(f"{path} without the secret: 401", r.json() == {"status": 401, "message": "service identity required"})
    r = (await c.post("/inventory/meds", json=svc)).json()
    check("inventory/meds: the pharmacy's stock per house",
          r["status"] == 200 and r["data"]["houses"][0]["meds"][0] == {"client": "Ann", "drug": "Aspirin", "qty": 30,
                                                                      "remaining": 4, "sig": "daily"}, r)
    r = (await c.post("/inventory/supplies", json=svc)).json()
    check("inventory/supplies: purchases by category and vendor",
          r["status"] == 200 and r["data"]["purchase_count"] == 1 and r["data"]["total_spend"] == 12.5, r)
    r = (await c.post("/shopper/purchases", json=svc)).json()
    check("shopper/purchases: the priced purchases", r["status"] == 200 and r["data"]["purchases"][0]["amount"] == 12.5, r)
    r = (await c.post("/clients/meds", json=svc)).json()
    meds = r["data"]["clients"][0]["meds"] if r.get("status") == 200 else []
    check("clients/meds: the ISP, then the eMAR off asa-hub-db (discontinued left out), times and photo read",
          r.get("status") == 200 and r["data"]["clients"][0]["isp_text"] == "Aspirin" and len(meds) == 1
          and meds[0]["times"] == ["08:00"] and meds[0]["image"] == "https://x.test/a.png", r)
    r = (await c.post("/finance/analytics", json={**svc, "client": "Ann Lee", "months": 3})).json()
    check("finance/analytics answers its rollups, the client and the window in the SQL",
          r["status"] == 200 and set(r["data"]) == {"kpis", "byFund", "byCategory", "monthly", "byClient",
                                                    "topVendors", "compliance", "flags"}
          and any("INTERVAL '3 months'" in s for s in SQL), r)
    r = (await c.post("/finance/history", json={**svc, "limit": 5})).json()
    check("finance/history: the ledger rows", r["status"] == 200 and r["data"]["rows"][0]["amount"] == -3.0, r)
    r = (await c.post("/finance/docs", json=svc)).json()
    check("finance/docs: the papers by subfolder", r["status"] == 200 and r["data"]["folders"][0]["count"] == 1, r)

    # weather
    r = (await c.get("/weather")).json()
    check("weather with the forecast down and nothing held: 502",
          r == {"status": 502, "message": "forecast unavailable (HTTPStatusError)"}, r)
    UP["weather"] = "up"
    r = (await c.get("/weather")).json()
    check("weather: today and the coming days",
          r["status"] == 200 and r["data"]["now"]["icon"] == "partsun" and r["data"]["days"][0]["icon"] == "rain"
          and r["data"]["days"][0]["tmax"] == 61, r)
    UP["weather"] = "fail"
    SD._WEATHER["at"] = 0.0
    r = (await c.get("/weather")).json()
    check("weather: a stale forecast before a blank one", r["status"] == 200 and r["data"]["place"] == "Columbus, OH")

    # the plan reader
    import fitz
    doc = fitz.open()
    doc.new_page().insert_text((72, 72), "Individual Name: Ann Lee")
    pdf = doc.tobytes()
    r = await c.post("/isp/decode", json={**svc, "pdf_b64": base64.b64encode(pdf).decode()})
    got = r.json()
    check("isp/decode reads a PDF's pages into the flat fields",
          r.status_code == 200 and got["status"] == 200 and got["data"]["pages"] == 1
          and "Ann Lee" in got["data"]["raw_text"] and isinstance(got["data"]["fields"], dict), got)
    r = await c.post("/isp/decode", json={"text": "x"})
    check("isp/decode without the secret: HTTP 401", r.status_code == 401
          and r.json() == {"status": 401, "message": "Authentication required."})

    # a Technology text
    TECH["doc1"] = {"status": 200, "data": {"b64": base64.b64encode(b"# Notes").decode()}}
    TECH["doc2"] = {"status": 404, "message": "not kept"}
    r = await c.get("/techdocs/text/doc1", headers=bear("admin"))
    check("techdocs/text: the kept text, as text", r.status_code == 200 and r.text == "# Notes"
          and r.headers["content-type"].startswith("text/plain") and CALLS[-1][1] == "techDocFile", r.text)
    r = await c.get("/techdocs/text/doc2", headers=bear("admin"))
    check("techdocs/text not kept yet: 404", r.status_code == 404 and r.json()["message"] == "not kept")
    r = await c.get("/techdocs/text/doc1", headers=bear("staff"))
    check("techdocs/text for staff: 403", r.status_code == 403
          and r.json() == {"status": 403, "message": "admins and managers only"})

    # the Decoder lab
    r = await c.get("/digest/shelf?folder=x&limit=9", headers=bear("admin"))
    check("digest/shelf: Python's read, its phase carried",
          r.json() == {"status": 200, "door": "digestShelf"} and r.headers.get("x-hub-phase") == "ready"
          and CALLS[-1] == ("read", "digestShelf", "digestlab", {"folder": "x", "q": "", "limit": 9}), r.text)
    r = (await c.get("/digest/proposals?scan=1", headers=bear("granted"))).json()
    check("digest/proposals?scan=1 is the scan write, open to an App Control grant",
          r["door"] == "digestScan" and CALLS[-1][0] == "write", r)
    r = (await c.get("/digest/proposals", headers=bear("staff"))).json()
    check("digest/proposals for a staff member without the lab: 403",
          r == {"status": 403, "message": "the decoder lab is for admins and managers"}, r)
    r = (await c.get("/digest/proposals")).json()
    check("digest/proposals with no session: 401", r == {"status": 401, "message": "sign in again"})
    r = (await c.post("/digest/proposals/decide", headers=bear("admin"), json={"id": "P1", "action": "approve"})).json()
    check("digest/proposals/decide: Python's write",
          r["door"] == "digestDecide" and CALLS[-1][3] == {"id": "P1", "action": "approve", "category": ""}, r)
    ARMED.add("gate_digest_writes")
    r = (await c.post("/digest/teach", headers=bear("admin"), json={"row_id": "R1", "kind": "Lab Result"})).json()
    check("digest/teach held by the armed digest gate: 409",
          r == {"status": 409, "message": "gate_digest_writes is armed and the send switch is on", "held": True}, r)
    ARMED.clear()
    r = (await c.post("/digest/teach", headers=bear("admin"), json={"row_id": "R1", "kind": "Lab Result"})).json()
    check("digest/teach: Python's write", r["door"] == "digestTeach"
          and CALLS[-1][3] == {"ledger": "client_files", "row_id": "R1", "kind": "Lab Result"}, r)
    r = (await c.post("/digest/teach", headers=bear("admin"), json={"kind": "x"})).json()
    check("digest/teach without a row: 400", r == {"status": 400, "message": "row_id and kind are required"})
    r = await c.post("/digest/teach", headers=bear("switched"), json={"row_id": "R1", "kind": "x"})
    check("a write door with a session minted from the master's own: HTTP 409, the relay's words",
          r.status_code == 409 and r.json() == SD.SWITCHED_WRITE, r.text)

    # the lab's Try: judged here, read on asa-hub-worker
    r = await c.post("/digest/try", headers=bear("granted"), json={"file_id": "F9", "file_name": "scan.pdf"})
    check("digest/try: forwarded to the worker with the machine token, its reading back whole",
          r.status_code == 200 and r.json()["file_id"] == "F9" and r.json()["ordinary"]["text"] == "hello"
          and TRIED[-1] == {"file_id": "F9", "file_name": "scan.pdf"}, r.text)
    n = len(TRIED)
    r = (await c.post("/digest/try", json={"file_id": "F9"})).json()
    check("digest/try with no session: 401, never forwarded", r == {"status": 401, "message": "sign in again"}
          and len(TRIED) == n, r)
    r = (await c.post("/digest/try", headers=bear("staff"), json={"file_id": "F9"})).json()
    check("digest/try for staff without the lab: 403, never forwarded",
          r == {"status": 403, "message": "the decoder lab is for admins and managers"} and len(TRIED) == n, r)
    r = await c.post("/digest/try", headers=bear("switched"), json={"file_id": "F9"})
    check("digest/try from a switched session: the write guard's 409", r.status_code == 409 and len(TRIED) == n)
    r = (await c.post("/digest/try", headers=bear("admin"), json={})).json()
    check("digest/try without a file: 400, never forwarded",
          r == {"status": 400, "message": "file_id is required"} and len(TRIED) == n, r)
    UP["worker"] = "down"
    r = await c.post("/digest/try", headers=bear("admin"), json={"file_id": "F9"})
    check("digest/try with the worker down: 503, said", r.status_code == 503 and r.json() == SD.TRY_UNREACHED, r.text)
    UP.pop("worker")

    # the cortex's reads
    for path, up in SD.CORTEX_READS.items():
        r = await c.get(path, headers=bear("admin"))
        if up.startswith("/v1/monitor"):
            check(f"{path}: a cortex that refuses is 502",
                  r.status_code == 502 and r.json() == {"status": 502, "message": "The cortex refused (500)."})
        else:
            check(f"{path}: the cortex's answer, whole", r.status_code == 200 and r.json() == {"path": up}, r.text)
    r = await c.get("/cortex/health", headers=bear("staff"))
    check("cortex reads for staff: 403", r.status_code == 403 and r.json() == {"status": 403, "message": "Admins only."})

    # the courier
    s_url = "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=1"
    r = await c.post("/upload-chunk", content=b"12345", headers={"x-upload-session": s_url,
                                                                 "content-range": "bytes 0-4/*"})
    check("upload-chunk: a piece taken, the next asked", r.json() == {"ok": True, "done": False, "range": "bytes=0-4"})
    r = await c.post("/upload-chunk", content=b"67890", headers={"x-upload-session": s_url,
                                                                 "content-range": "bytes 5-9/10"})
    check("upload-chunk: the last piece makes the file",
          r.json() == {"ok": True, "done": True, "file_id": "F1", "name": "big.mp4"})
    r = await c.post("/upload-chunk", content=b"1", headers={"x-upload-session": "https://evil.test/"})
    check("upload-chunk to anything but a Drive session: 403",
          r.status_code == 403 and r.json() == {"ok": False, "reason": "not an upload session"})

    # one personal mailbox on the mail server
    r = (await c.post("/mail/provision", json={**svc, "local": "Bea Cruz"})).json()
    line = ACCOUNTS.read_text().splitlines()[-1]
    creds = json.loads((Path(WORK) / "hub-mail-creds.json").read_text())
    check("mail/provision makes the box: a SHA512-CRYPT line, its password kept beside the others",
          r["status"] == 200 and r["data"]["account"] == "bea.cruz@asaop.org" and r["data"]["created"] is True
          and line.startswith("bea.cruz@asaop.org|{SHA512-CRYPT}$6$")
          and creds.get("bea.cruz@asaop.org") == r["data"]["password"] and creds.get("ana@asaop.org") == "pw"
          and oct(os.stat(Path(WORK) / "hub-mail-creds.json").st_mode)[-3:] == "600", r)
    r = (await c.post("/mail/provision", json={**svc, "local": "bea.cruz"})).json()
    check("mail/provision of a box already there: created false, no password, nothing appended",
          r == {"status": 200, "data": {"account": "bea.cruz@asaop.org", "created": False}}
          and len(ACCOUNTS.read_text().splitlines()) == 2, r)
    r = (await c.post("/mail/provision", json={**svc, "local": "..."})).json()
    check("mail/provision without a usable local part: 400",
          r == {"status": 400, "message": "a usable local part is required"}, r)
    r = (await c.post("/mail/provision", json={"service_secret": "wrong", "local": "x"})).json()
    check("mail/provision without the secret: 401", r == {"status": 401, "message": "service identity required"}, r)
    r = await c.post("/mail/provision", json={**svc, "local": "x"}, headers=bear("switched"))
    check("mail/provision from a switched session: the write guard's 409", r.status_code == 409, r.text)
    ARMED.add("gate_mail_provision")
    r = (await c.post("/mail/provision", json={**svc, "local": "cy"})).json()
    check("mail/provision held by its armed gate while the send switch is on: 409",
          r == {"status": 409, "message": "gate_mail_provision is armed and the send switch is on", "held": True}, r)
    ARMED.clear()
    UNREAD.append("the situations tab is not in asa-hub-db")
    r = (await c.post("/mail/provision", json={**svc, "local": "cy"})).json()
    check("mail/provision held when its gate cannot be read and the switch is on (it reaches a person)",
          r.get("status") == 409 and r.get("held") is True and "could not be read" in r.get("message", "")
          and "cy@asaop.org" not in ACCOUNTS.read_text(), r)
    r = (await c.post("/mail/mark", json={**box, "items": [{"id": "<m1@asaop.org>"}], "seen": "no"})).json()
    check("an unread gate still holds no door that reaches no one (mail/mark)", r.get("status") == 200, r)
    CONFIG["test_mode"] = "off"
    r = (await c.post("/mail/provision", json={**svc, "local": "cy"})).json()
    check("an unread gate with the send switch plainly off holds nothing: the box is made",
          r.get("status") == 200 and r["data"]["created"] is True, r)
    CONFIG["test_mode"] = "on"
    UNREAD.clear()

    # what the doors do not take goes on to the carrier
    r = (await c.get("/mail/send")).json()
    check("a method a door does not take falls through to the carrier", r == {"carried": "/mail/send", "method": "GET"})
    r = (await c.get("/digest/try")).json()
    check("the lab's Try by GET falls through to the carrier", r == {"carried": "/digest/try", "method": "GET"})

asyncio.run(main())
failed = [n for n, ok in results if not ok]
print(f"\n{len(results) - len(failed)} ok, {len(failed)} failed")
sys.exit(1 if failed else 0)
'''


def main() -> int:
    src = {name: (ROOT / "app" / f"{name}.py").read_text(encoding="utf-8") for name in REAL}
    got = subprocess.run(["docker", "exec", "-i", RUNNER, "python", "-c", DRIVER], input=json.dumps(src).encode(),
                         capture_output=True, timeout=300)
    sys.stdout.write(got.stdout.decode())
    if got.returncode != 0:
        sys.stdout.write(got.stderr.decode()[-3000:])
    return got.returncode


if __name__ == "__main__":
    sys.exit(main())
