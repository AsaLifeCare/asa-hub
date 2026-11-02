#!/usr/bin/env python3
"""My Profile's address doors (app/my_profile_writes.py) and the compliance-document doors (app/cert_docs.py), decided
by the streamed modules on real accounts in asa-hub-db-sync: the person's own read and save, the master's, the wrong
person refused, the ledger's reads, a paper's bytes through a stand-in Drive, the record and the confirmation with the
exact app.edits rows, and the review edition. Nothing real is written: the edit store lives in temp tables inside one
transaction rolled back at the end. Shapes and counts only, never a personal value."""
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
import gsjs, hubdb, scope as sc, locations as L, writes as W, editions as ED, drive as dr
import staff as SP, staff_writes as SW, client_writes as CW
import my_profile_writes as MPW, cert_docs as CD
import main as M

out, facts, rows_out = [], {}, []
SECRET = []


def mask(s):
    s = str(s)
    for word in sorted({w for w in SECRET if w and len(w) > 2}, key=len, reverse=True):
        s = s.replace(word, "<person>")
    s = re.sub(r'"[^"]*"', '"…"', s)
    return re.sub(r"\d", "#", s)[:300]


def check(name, ok, detail=""):
    out.append([name, bool(ok), "" if ok else mask(detail)])


W.EDITS_TABLE = "pg_temp.hub_edits_mpd"
W.LOCK_KEY = 0x4D5044


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


assert "certDocs.review" in ED._BY_ID, "the review edition is in the catalogue"

db = hubdb.HubDb()
real = psycopg.connect(hubdb._dsn(), autocommit=False, connect_timeout=5, application_name="my-profile-doors-check")
proxy = Conn(real)
store_mp = W.Store(connect=lambda: proxy, kind="check_mp", label="Check")
store_cd = W.Store(connect=lambda: proxy, kind="check_cd", label="Check")
EDITIONS = {"value": "[]"}
base_cfg = db.hiring_config
db.hiring_config = lambda: {**base_cfg(), sc.EDITIONS_KEY: EDITIONS["value"]}
db.stale = lambda books: False
OPEN = {"my-profile": set(), "staff-profiles": set(), "shut": set()}
base_gate = sc.profile_app_gate


def gate(app_id, user, src):
    uid = gsjs.str_((user or {}).get("id"))
    if uid and uid in OPEN["shut"]:
        return {"open": False, "scope": sc.scope_of("none", "closed by the check")}
    if user and not user.get("is_service") and uid in OPEN.get(app_id, set()):
        return {"open": True, "scope": sc.scope_of("all")}
    return base_gate(app_id, user, src)


sc.profile_app_gate = gate
M.DB = db
M.WRITES["my-profile"] = MPW
M.WRITES["cert-docs"] = CD.WRITE
M.APPS["cert-docs"] = CD
MP_READS = types.SimpleNamespace(ACTIONS=dict(MPW.READS), POLICY=dict(MPW.READ_POLICY))
M.stores = lambda: {"my-profile": store_mp, "cert-docs": store_cd}
M.WRITE_BUDGET_S = 120.0
seq = [0]


def write(module, action, who, payload):
    seq[0] += 1
    wid = f"Wcheck-mpd-{seq[0]:04d}-{uuid.uuid4().hex[:8]}"
    res = M._run_write(module, action, who, payload, wid)
    body = json.loads(res.body)
    return res.status_code, body, wid


def read(module, action, who, payload, drive=None):
    held = M.DRIVE
    M.DRIVE = drive if drive is not None else held
    try:
        res = M._run(module, action, who, payload)
    finally:
        M.DRIVE = held
    return res.status_code, json.loads(res.body)


def edits_of(wid):
    with real.cursor() as c:
        c.execute("select app, action, tab_name, kind, match_by, keyed_by, row_key, field, value, before, edition"
                  " from pg_temp.hub_edits_mpd where write_id = %s order by id", (wid,))
        return c.fetchall()


def show_rows(label, got, keyed):
    shown = []
    for app, act, tab, kind, match, keyed_by, rk, field, value, before, ed in got:
        shown.append([app, act, tab, kind, match, keyed_by, keyed.get(rk, "<another row>"), field,
                      "<set>" if value else "", "<was>" if before else "", ed or "(master)"])
    rows_out.append({"write": label, "rows": shown})


def guarded(name, fn):
    try:
        with real.transaction():
            fn()
    except Exception as exc:  # noqa: BLE001 - said as a failed check, never a value
        import traceback
        check(name + ": ran to the end", False, type(exc).__name__ + ": " + str(exc)[:200] + " @ " +
              " / ".join(x.strip()[:120] for x in traceback.format_exc().strip().splitlines()[-4:]))


reads0 = L.Reads(db, None)
users = [u for u in reads0.users() if gsjs.str_(u.get("userid")) and not gsjs.str_(u.get("mergedinto"))]
master = next((u for u in users if gsjs.str_(u.get("email")).lower() == sc.MASTER_ACCOUNT), None)
MASTER = {"uid": gsjs.str_((master or {}).get("userid")) or "USR_MASTER", "role": "admin", "is_master": True}
check("the master's account row is read from the users tab", bool(master))
staff_rows = [u for u in users if gsjs.str_(u.get("role")).lower() == "staff" and not gsjs.str_(u.get("clientkey"))
              and gsjs.str_(u.get("active")).upper() not in ("FALSE", "0", "NO")]
admins = [u for u in users if gsjs.str_(u.get("role")).lower() == "admin"
          and gsjs.str_(u.get("email")).lower() != sc.MASTER_ACCOUNT]

# ---- the people: settled staff accounts, with a Master row the address lands on ----
settled = []
for u in staff_rows:
    me = SP.compliance_self(reads0, sc.user_from_row(u))
    if me["key"] and not me["bridged"]:
        settled.append((u, me))
facts["staff accounts"] = f"{len(staff_rows)} live staff accounts, {len(settled)} settle to their own roster row"
chosen = None
for u, me in settled:
    ctx = SP.person(reads0, me["key"])
    if ctx.get("refused") or not ctx.get("people") or SP.roster_id(ctx["people"].get("id")) != me["id"]:
        continue
    if SP.edit_refusal(ctx, "city") or SW.master_target(reads0, ctx).get("why"):
        continue
    raw = ctx.get("master_edit") or {}
    if any(SP._marker(raw.get(f)) for f in SP.ADDRESS_FIELDS) or set(SP.ADDRESS_FIELDS) & set(ctx.get("_unsure") or ()):
        continue
    chosen = (u, me, ctx)
    break
check("a staff account whose own address the Master holds is found", chosen is not None)
other = next(((u, me) for u, me in settled if chosen and me["key"] != chosen[1]["key"]), None)
check("a second settled staff account is found (the wrong person)", other is not None)
if chosen:
    SECRET.extend([chosen[1]["key"], chosen[1]["name"], gsjs.str_(chosen[0].get("displayname")),
                   gsjs.str_(chosen[0].get("email"))])
if other:
    SECRET.extend([other[1]["key"], other[1]["name"], gsjs.str_(other[0].get("displayname"))])
ME = {"uid": gsjs.str_(chosen[0].get("userid")), "role": "staff", "is_master": False} if chosen else None
OTHER = {"uid": gsjs.str_(other[0].get("userid")), "role": "staff", "is_master": False} if other else None
facts["the address's copy"] = (f"{sum(1 for f in SP.ADDRESS_FIELDS if (chosen[2].get('master_edit') or {}).get(f))} of "
                               "4 address cells filled on the chosen person's Master row" if chosen else "no person")
NEW_CITY = "Checkville"


def address():
    key = chosen[1]["key"]
    OPEN["my-profile"].update({ME["uid"], OTHER["uid"]})
    st, env = read(MP_READS, "staffProfileAddress", ME, {})
    d = env.get("data") or {}
    check("address read: the person's own address, 200, own, the four fields and their raw cells",
          st == 200 and env.get("status") == 200 and d.get("own") is True and d.get("staff_key") == key
          and sorted(d.get("address") or {}) == sorted(SP.ADDRESS_FIELDS) and "city" in (d.get("edit") or {}),
          [st, env.get("status"), env.get("message"), sorted(d)])
    city0 = (d.get("edit") or {}).get("city", "")
    st, env = read(MP_READS, "staffProfileAddress", ME, {"key": other[1]["key"]})
    check("address read: another person's key from a staff session is refused in the door's words",
          env == {"status": 403, "message": SP.ADDRESS_WORDS["others"]}, env)
    st, env = read(MP_READS, "staffProfileAddress", MASTER, {"key": key})
    check("address read: the master reading another person's address is left to Apps Script (its audit line)",
          st != 200 and "audit" in str(env.get("defer", "")), [st, env])
    OPEN["shut"].add(OTHER["uid"])
    st, env = read(MP_READS, "staffProfileAddress", OTHER, {})
    check("address read: an account My Profile is not open to is refused (App Control)",
          env == {"status": 403, "message": SP.ADDRESS_WORDS["gate"]}, env)
    st, env, wid = write(MPW, "staffProfileAddressEdit", OTHER, {"changes": [
        {"field": "city", "value": NEW_CITY, "expected": ""}]})
    check("address save: refused for an account My Profile is not open to, nothing kept",
          env == {"status": 403, "message": SP.ADDRESS_WORDS["gate"]} and not edits_of(wid), env)
    OPEN["shut"].discard(OTHER["uid"])
    st, env, wid = write(MPW, "staffProfileAddressEdit", OTHER, {"key": key, "changes": [
        {"field": "city", "value": NEW_CITY, "expected": city0}]})
    check("address save: another person's record from a staff session is refused, nothing kept",
          env == {"status": 403, "message": SP.ADDRESS_WORDS["others"]} and not edits_of(wid), env)
    st, env, wid = write(MPW, "staffProfileAddressEdit", ME, {"changes": [
        {"field": "phone", "value": "1", "expected": ""}, {"field": "state", "value": "zz", "expected": ""},
        {"field": "zip", "value": "4430", "expected": ""}, {"field": "address", "value": "", "expected": ""}]})
    check("address save: a field it does not change, a state, a zip and a blank refused in the door's words",
          env == {"status": 200, "data": {"written": [], "refused": [
              {"field": "phone", "why": MPW.ADDRESS_WORDS["only"]}, {"field": "state", "why": MPW.ADDRESS_WORDS["state"]},
              {"field": "zip", "why": MPW.ADDRESS_WORDS["zip"]}, {"field": "address", "why": MPW.ADDRESS_WORDS["blank"]}],
              "staff_key": key}} and not edits_of(wid), env)
    st, env, wid = write(MPW, "staffProfileAddressEdit", ME, {"changes": [
        {"field": "city", "value": NEW_CITY, "expected": city0 + "x"}]})
    check("address save: a stale witness is a 409 carrying what the record holds now, nothing kept",
          env.get("status") == 409 and (env.get("data") or {}).get("current") == {"city": city0}
          and (env.get("data") or {}).get("written") == [] and not edits_of(wid), [env.get("status"), env.get("message")])
    st, env, wid = write(MPW, "staffProfileAddressEdit", ME, {"changes": [
        {"field": "city", "value": NEW_CITY, "expected": city0}, {"field": "state", "value": "oh", "expected": "?"}]})
    got = edits_of(wid)
    plan = env.get("_write") or {}
    stale_state = (env.get("data") or {}).get("current", {})
    check("address save: the city kept final in Postgres (one cell on the Master row), the stale state said",
          env.get("status") == 409 and (env.get("data") or {}).get("written") == ["city"] and "state" in stale_state
          and plan.get("final") is True and plan.get("house") == key and len(got) == 1
          and got[0][2] == SP.cert_source_tab(reads0, "master") and got[0][8] == NEW_CITY and got[0][9] == city0
          and got[0][10] == "" and (env.get("data") or {}).get("staff_key") == key
          and (env.get("data") or {}).get("app") == MPW.APP_ID,
          [env.get("status"), (env.get("data") or {}).get("written"), plan, len(got)])
    tgt = SW.master_target(reads0, chosen[2])
    show_rows("staffProfileAddressEdit (own city)", got, {tgt.get("key"): "<the person's Master row key>"})
    check("address save: the kept row is keyed as the Staff edits key the same Master row",
          bool(got) and got[0][4] == tgt.get("match") and got[0][6] == tgt.get("key"), [got[0][4:7] if got else None])
    st, env = read(MP_READS, "staffProfileAddress", ME, {})
    check("address read: the saved city is laid over the copy at once",
          ((env.get("data") or {}).get("edit") or {}).get("city") == NEW_CITY
          and ((env.get("data") or {}).get("address") or {}).get("city") == NEW_CITY, env.get("status"))
    st, env, wid = write(MPW, "staffProfileAddressEdit", ME, {"changes": [
        {"field": "city", "value": NEW_CITY + "a", "expected": city0}]})
    check("address save: the next save is witnessed by the kept value, not the sheet's",
          env.get("status") == 409 and (env.get("data") or {}).get("current") == {"city": NEW_CITY}, env.get("status"))
    st, env, wid = write(MPW, "staffProfileAddressEdit", MASTER, {"key": key, "changes": [
        {"field": "zip", "value": "44301", "expected": (chosen[2].get("master_edit") or {}).get("zip", "")}]})
    got = edits_of(wid)
    check("address save: the master changes another person's address by key, kept final, no edition",
          env.get("status") == 200 and (env.get("data") or {}).get("written") == ["zip"] and len(got) == 1
          and got[0][10] == "", [env.get("status"), env.get("message"), len(got)])
    show_rows("staffProfileAddressEdit (the master, by key)", got, {tgt.get("key"): "<the person's Master row key>"})


# ---- the compliance documents: the ledger's tab is born by the first filing, so two rows are seeded as kept appends ----
LEDGER = db.resolve(CD.TAB)
facts["the certificate ledger in asa-hub-db"] = (f"{len(CD.ledger(reads0))} rows" if LEDGER.ref is not None else
                                                 "not born: no book in the catalog carries the tab (the first filing "
                                                 "makes it), so the rows below are seeded in the check's temp edits")
HEADER = ("id", "person", "cert", "name", "url", "by", "at", "file_id", "req_id", "read_state", "read_kind", "issued_on",
          "expires_on", "read_how", "read_confidence", "read_why", "read_at", "read_v", "confirmed_on", "confirmed_by",
          "confirmed_at", "read_tries", "roster_id")
SEED = {}
FAKE_FILE = "FAKEcheckFile0123456789"


def with_own(fn):
    tok = hubdb.OWN.set(CW.Own([], book=db.book, edits=store_cd.edits(), edits_at=time.time()))
    try:
        return fn(L.Reads(db, None))
    finally:
        hubdb.OWN.reset(tok)


CERT = {}


def pick_cert_person():
    """A settled staff account, and an enabled requirement a paper is dated for whose Master column their row has
    (found by name, as an unstamped filing's is); a second settled account for the wrong person."""
    reqs = [r for r in SP.requirements(reads0) if gsjs.str_(r.get("enabled")).lower() == "yes" and not SP._confirm_shut(r)]
    with_eid = no_row = 0
    for u, me in settled:
        found = CD.subject_row(reads0, me["name"])
        eid = gsjs.str_(found.get("employee_id")) if isinstance(found, dict) else ""
        if eid:
            with_eid += 1
            no_row += 0 if CD.master_target(reads0, me["name"], eid)["ok"] else 1
        for req in reqs if not CERT else ():
            if CD.master_now(reads0, me["name"], gsjs.str_(req.get("date_source")), "")["ok"]:
                CERT.update(u=u, me=me, req=req, who={"uid": gsjs.str_(u.get("userid")), "role": "staff",
                                                      "is_master": False})
                break
    facts["settled people whose roster employee id finds no Master row (a stamped filing's confirmation)"] = (
        f"{no_row} of the {with_eid} whose roster row carries an employee id, of {len(settled)} settled")
    if CERT:
        wrong = next(((u, me) for u, me in settled if me["key"] != CERT["me"]["key"]), None)
        CERT["other"] = {"uid": gsjs.str_(wrong[0].get("userid")), "role": "staff", "is_master": False}
        SECRET.extend([CERT["me"]["key"], CERT["me"]["name"], gsjs.str_(CERT["u"].get("displayname")),
                       wrong[1]["key"], wrong[1]["name"]])


def seed():
    pick_cert_person()
    facts["a settled person whose Master row dates a requirement"] = "found" if CERT else "none"
    if not CERT:
        return
    me, req = CERT["me"], CERT["req"]
    now = gsjs.iso(reads0.now)
    base = {"person": me["name"], "cert": gsjs.str_(req.get("label")), "name": "paper.pdf", "url": "",
            "by": me["mail"], "at": now, "file_id": FAKE_FILE, "req_id": gsjs.str_(req.get("req_id"))}
    # an older filing carries no roster id: its record is found by the name it was filed under
    SEED["read"] = {**base, "id": "seed-read-" + uuid.uuid4().hex[:12], "read_state": "read",
                    "read_kind": "cpr_first_aid", "expires_on": "2030-06-30", "read_how": "label",
                    "read_confidence": "91", "read_at": now, "read_v": "check"}
    SEED["pending"] = {**base, "id": "seed-pending-" + uuid.uuid4().hex[:12], "read_state": "pending",
                       "roster_id": me["id"]}
    SEED["stamped"] = {**base, "id": "seed-stamped-" + uuid.uuid4().hex[:12], "read_state": "read",
                       "roster_id": me["id"]}
    rows = [("Wseed-" + which, "check_cd", "seed", LEDGER.sheet_id, CD.TAB, "append", "id", "header", cells["id"], f,
             cells.get(f, ""), "", "check", "") for which, cells in SEED.items() for f in HEADER]
    with real.cursor() as c:
        c.executemany("insert into pg_temp.hub_edits_mpd (write_id, app, action, sheet_id, tab_name, kind, match_by,"
                      " keyed_by, row_key, field, value, before, author, edition) values"
                      " (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)", rows)


class FakeDrive:
    available = True

    def __init__(self, items, data):
        self.items, self.data = items, data

    def _bytes(self, url, params, cap):
        fid = url.rsplit("/", 1)[-1]
        if fid not in self.items:
            raise dr.Gone("No item with the given ID could be found.")
        return json.dumps(self.items[fid]).encode()

    def media(self, fid, cap):
        return self.data[:cap + 1]


def docs():
    if not SEED:
        check("ledger rows are seeded for a settled person", False, "no settled person's Master row dates a requirement")
        return
    ME, OTHER, chosen_me = CERT["who"], CERT["other"], CERT["me"]
    r_id, p_id = SEED["read"]["id"], SEED["pending"]["id"]
    SECRET.extend([r_id, p_id])
    st, env = read(CD, "certUploadsList", MASTER, {})
    d = env.get("data") or {}
    ids = [u["id"] for u in d.get("uploads") or []]
    check("ledger: the master reads every row, scope all",
          env.get("status") == 200 and d.get("scope") == "all" and d.get("self") == "" and r_id in ids and p_id in ids,
          [env.get("status"), d.get("scope"), len(ids)])
    check("ledger: each row in complianceDocsOut_'s shape",
          bool(ids) and all(list(u) == ["id", "person", "cert", "name", "url", "by", "at", "roster_id", "file_id",
                                        "req_id", "read_state", "read_kind", "read_kind_words", "issued_on",
                                        "expires_on", "read_how", "read_confidence", "read_why", "read_at", "read_v",
                                        "confirmed_on", "confirmed_by", "confirmed_at"]
                            for u in d.get("uploads") or []), "")
    st, env = read(CD, "certUploadsList", ME, {})
    d = env.get("data") or {}
    ids = [u["id"] for u in d.get("uploads") or []]
    check("ledger: the person reads their own rows, scope own, under their roster name",
          env.get("status") == 200 and d.get("scope") == "own" and d.get("self") == chosen_me["name"]
          and r_id in ids and p_id in ids and all(SP.fold(u.get("person")) == chosen_me["key"]
                                                  for u in d.get("uploads") or []), [env.get("status"), d.get("scope")])
    st, env = read(CD, "certUploadsList", OTHER, {})
    d = env.get("data") or {}
    ids = [u["id"] for u in d.get("uploads") or []]
    check("ledger: the wrong person reads their own scope, never these rows",
          env.get("status") == 200 and d.get("scope") == "own" and r_id not in ids and p_id not in ids,
          [env.get("status"), d.get("scope")])
    unsettled = next((u for u in staff_rows if SP.compliance_self(reads0, sc.user_from_row(u))["status"] == 403), None)
    if unsettled:
        who = {"uid": gsjs.str_(unsettled.get("userid")), "role": "staff", "is_master": False}
        SECRET.extend([gsjs.str_(unsettled.get("displayname"))])
        st, env = read(CD, "certUploadsList", who, {})
        check("ledger: an account no roster row settles is refused as its own scope, no row listed",
              env.get("status") == 403 and env.get("scope") == "own" and "data" not in env, env)
    row_out = with_own(lambda R: SP.upload_out(next(r for r in CD.ledger(R) if gsjs.str_(r.get("id")) == r_id)))
    check("certDocRead's row: the seeded reading in complianceDocsOut_'s words (kind, day, confidence, roster id)",
          row_out["read_state"] == "read" and row_out["read_kind_words"] == "CPR / First Aid card"
          and row_out["expires_on"] == "2030-06-30" and row_out["read_confidence"] == 91
          and row_out["roster_id"] == "" and row_out["file_id"] == FAKE_FILE, sorted(row_out))
    st, env = read(CD, "certDocRead", MASTER, {"id": r_id})
    check("certDocRead: a reading the ledger keeps is answered as the row, to the master",
          env == {"status": 200, "data": row_out}, env.get("status"))
    st, env = read(CD, "certDocRead", ME, {"id": r_id})
    check("certDocRead: and to its own person", env == {"status": 200, "data": row_out}, env.get("status"))
    st, env = read(CD, "certDocRead", OTHER, {"id": r_id})
    check("certDocRead: refused to the wrong person in the door's words",
          env == {"status": 403, "message": CD.WORDS["notYours"]}, env)
    st, env = read(CD, "certDocFile", OTHER, {"id": r_id}, FakeDrive({}, b""))
    check("certDocFile: refused to the wrong person before Drive is asked",
          env == {"status": 403, "message": CD.WORDS["notYours"]}, env)
    st, env = read(CD, "certDocRead", MASTER, {"id": p_id})
    check("certDocRead: a paper still to read is left to Apps Script (the decoder)",
          st != 200 and "decoder" in str(env.get("defer", "")), [st, env])
    st, env = read(CD, "certDocRead", MASTER, {})
    check("certDocRead: no id is the policy's 400", env == {"status": 400, "message": "Missing required parameter: id."},
          env)
    st, env = read(CD, "certDocFile", MASTER, {"id": "no-such-row"})
    check("certDocFile: an id the ledger does not hold is a 404 to the master",
          env == {"status": 404, "message": CD.NO_ROW}, env)
    st, env = read(CD, "certDocFile", ME, {"id": "no-such-row"})
    check("certDocFile: and the person's own words for an id that is not theirs",
          env == {"status": 403, "message": CD.WORDS["notYours"]}, env)
    # the bytes, through a stand-in Drive that answers as the owning account would
    if True:
        fid, rid = FAKE_FILE, r_id
        tree = {fid: {"id": fid, "name": "paper.pdf", "mimeType": "application/pdf", "size": "5", "parents": ["P1"]},
                "P1": {"id": "P1", "parents": ["G1"]}, "G1": {"id": "G1", "name": "Compliance Docs"}}
        st, env = read(CD, "certDocFile", MASTER, {"id": rid}, FakeDrive(tree, b"%PDF-"))
        check("certDocFile: a PDF in Compliance Docs/<cert> is handed over as bytes, its name, type and size",
              env == {"status": 200, "data": {"id": rid, "name": "paper.pdf", "mime": "application/pdf", "size": 5,
                                              "b64": base64.b64encode(b"%PDF-").decode()}}, env.get("status"))
        st, env = read(CD, "certDocFile", ME, {"id": rid}, FakeDrive(tree, b"%PDF-"))
        check("certDocFile: and to its own person", env.get("status") == 200, env.get("status"))
        word = {**tree, fid: {**tree[fid], "name": "paper.docx", "mimeType": "application/msword"}}
        st, env = read(CD, "certDocFile", MASTER, {"id": rid}, FakeDrive(word, b"x"))
        check("certDocFile: a file that is not a PDF or a picture is the door's 415",
              env == {"status": 415, "message": CD.WORDS["unshown"]}, env)
        big = {**tree, fid: {**tree[fid], "size": str(CD.DOC_MAX_BYTES + 1)}}
        st, env = read(CD, "certDocFile", MASTER, {"id": rid}, FakeDrive(big, b"x"))
        check("certDocFile: over 15MB is the door's 400", env == {"status": 400, "message": CD.TOO_BIG}, env)
        stray = {**tree, "G1": {"id": "G1", "name": "Elsewhere"}}
        st, env = read(CD, "certDocFile", MASTER, {"id": rid}, FakeDrive(stray, b"x"))
        check("certDocFile: a file outside the compliance folder is left to the owning account (Apps Script)",
              st != 200 and "compliance folder" in str(env.get("defer", "")), [st, env])
        st, env = read(CD, "certDocFile", MASTER, {"id": rid}, FakeDrive({}, b""))
        check("certDocFile: a file Drive no longer has is the door's 404", env == {"status": 404, "message": CD.GONE},
              env)
        if not M.DRIVE.available:
            st, env = read(CD, "certDocFile", MASTER, {"id": rid})
            check("certDocFile: with no Drive credentials here, Apps Script answers", st != 200, [st, env])


def confirm():
    target = None
    ME, OTHER = (CERT["who"], CERT["other"]) if CERT else (None, None)
    if SEED:
        st, env = read(CD, "certUploadRecord", MASTER, {"id": SEED["stamped"]["id"]})
        d = env.get("data") or {}
        found = CD.subject_row(reads0, CERT["me"]["name"])
        eid = gsjs.str_(found.get("employee_id")) if isinstance(found, dict) else ""
        if eid and not CD.master_target(reads0, CERT["me"]["name"], eid)["ok"]:
            check("certUploadRecord: a stamped filing whose roster employee id finds no Master row says so, as Apps "
                  "Script does on the same rows",
                  env.get("status") == 200 and (d.get("confirm") or {}).get("allowed") is False
                  and d.get("record_why", "").startswith("The record could not be read for this person: ")
                  and (d.get("confirm") or {}).get("why") == d.get("record_why"),
                  [env.get("status"), mask(d.get("record_why"))])
        else:
            check("certUploadRecord: a stamped filing is matched through its roster row", env.get("status") == 200
                  and (d.get("confirm") or {}).get("allowed") is True, [env.get("status"), d.get("confirm")])
        st, env = read(CD, "certUploadRecord", MASTER, {"id": SEED["read"]["id"]})
        d = env.get("data") or {}
        check("certUploadRecord: the record's shape, the requirement's date column and the confirmation open",
              env.get("status") == 200 and list(d) == ["id", "person", "req_id", "date_source", "date_role", "record",
                                                       "record_why", "confirm"]
              and d.get("req_id") == SEED["read"]["req_id"] and d.get("date_source")
              and d.get("confirm") == {"allowed": True, "why": ""} and d.get("record_why") == "",
              [env.get("status"), env.get("message"), d.get("confirm")])
        if (d.get("confirm") or {}).get("allowed"):
            target = ({"id": SEED["read"]["id"], "person": SEED["read"]["person"]}, d)
    if ME:
        rid0 = SEED["read"]["id"] if SEED else "x"
        st, env = read(CD, "certUploadRecord", ME, {"id": rid0})
        check("certUploadRecord: a staff session is refused as the policy refuses it",
              env == {"status": 403, "message": "This action is for admin."}, env)
        st, env, wid = write(CD.WRITE, "certUploadConfirm", ME, {"id": rid0, "date": "2031-01-15", "expected": ""})
        check("certUploadConfirm: a staff session is refused, nothing kept",
              env == {"status": 403, "message": "This action is for admin."} and not edits_of(wid), env)
    if admins:
        adm = {"uid": gsjs.str_(admins[0].get("userid")), "role": "admin", "is_master": False}
        st, env, wid = write(CD.WRITE, "certUploadConfirm", adm, {"id": "x", "date": "2031-01-15"})
        check("certUploadConfirm: an admin who is not the master is refused in the door's words, nothing kept",
              env == {"status": 403, "message": CD.CONFIRM_WORDS["master"]} and not edits_of(wid), env)
    st, env, wid = write(CD.WRITE, "certUploadConfirm", MASTER, {"id": "x", "date": "15/01/2031"})
    check("certUploadConfirm: a date that is not a calendar day is a 400",
          env == {"status": 400, "message": "The date must be a calendar day (YYYY-MM-DD)."}, env)
    st, env, wid = write(CD.WRITE, "certUploadConfirm", MASTER, {"date": "2031-01-15"})
    check("certUploadConfirm: no id is the policy's 400",
          env == {"status": 400, "message": "Missing required parameter: id."}, env)
    if not target:
        return
    row, rec = target
    rid = gsjs.str_(row.get("id"))
    SECRET.extend([gsjs.str_(row.get("person")), SP.fold(row.get("person"))])
    st, env, wid = write(CD.WRITE, "certUploadConfirm", MASTER, {"id": rid, "date": "2031-01-15",
                                                                 "expected": rec["record"] + "x"})
    check("certUploadConfirm: a stale witness is a 409 carrying what the record holds now, nothing kept",
          env.get("status") == 409 and env.get("data") == {"current": rec["record"]} and not edits_of(wid),
          [env.get("status"), env.get("message")])
    st, env, wid = write(CD.WRITE, "certUploadConfirm", MASTER, {"id": rid, "date": "2031-01-15",
                                                                 "expected": rec["record"]})
    got = edits_of(wid)
    d = env.get("data") or {}
    plan = env.get("_write") or {}
    master_tab = SP.cert_source_tab(reads0, "master")
    check("certUploadConfirm: the date kept final on the Master row and the ledger row stamped, one write",
          env.get("status") == 200 and d.get("confirmed_on") == "2031-01-15" and d.get("ledger_stamped") is True
          and plan.get("final") is True and len(got) == 4
          and [g[2] for g in got] == [master_tab, CD.TAB, CD.TAB, CD.TAB]
          and hubdb.estate_key(got[0][7]) == hubdb.estate_key(rec["date_source"]) and got[0][8] == "2031-01-15"
          and got[0][9] == rec["record"]
          and got[0][4].startswith("cols:") and [g[4] for g in got[1:]] == ["id", "id", "id"]
          and {g[7] for g in got[1:]} == {"confirmed_on", "confirmed_by", "confirmed_at"}
          and all(g[6] == rid for g in got[1:]) and all(g[10] == "" for g in got),
          [env.get("status"), env.get("message"), d.get("ledger_stamped"), len(got),
           [(g[2] == master_tab, g[4][:5], g[7]) for g in got]])
    show_rows("certUploadConfirm (the master)", got, {rid: "<the ledger row id>", got[0][6] if got else "": "<Employee ID>"})
    # the day as the sheet reads it once set (emp360Cell_ of the Date it becomes), as Apps Script's record shows it
    shown = hubdb.estate_cell(hubdb.typed("2031-01-15", "estate"))
    facts["the record's date cell, as read before and after"] = (re.sub(r"\d", "#", rec["record"]) or "(blank)") + \
        " → " + re.sub(r"\d", "#", shown)
    st, env = read(CD, "certUploadRecord", MASTER, {"id": rid})
    check("certUploadRecord: the record now reads the confirmed date, laid at once",
          (env.get("data") or {}).get("record") == shown, [env.get("status"), mask((env.get("data") or {}).get("record"))])
    st, env = read(CD, "certUploadsList", MASTER, {})
    up = next((u for u in (env.get("data") or {}).get("uploads") or [] if u["id"] == rid), {})
    check("certUploadsList: the ledger row reads as confirmed, laid at once",
          up.get("confirmed_on") == "2031-01-15" and bool(up.get("confirmed_at")), sorted(up)[:3])
    st, env, wid = write(CD.WRITE, "certUploadConfirm", MASTER, {"id": rid, "date": "2031-02-01",
                                                                 "expected": rec["record"]})
    check("certUploadConfirm: the next confirmation is witnessed by the kept date, not the sheet's",
          env.get("status") == 409 and env.get("data") == {"current": shown} and not edits_of(wid),
          env.get("status"))
    # the review edition: nobody until listed, then a listed person who reads Staff whole
    if OTHER:
        st, env, wid = write(CD.WRITE, "certUploadConfirm", OTHER, {"id": rid, "date": "2031-02-01",
                                                                    "expected": "2031-01-15"})
        check("review edition: a person not listed is refused, nothing kept",
              env == {"status": 403, "message": "This action is for admin."} and not edits_of(wid), env)
        EDITIONS["value"] = json.dumps([{"id": CD.EDITION, "on": True, "people": [OTHER["uid"]]}])
        OPEN["shut"].add(OTHER["uid"])
        st, env, wid = write(CD.WRITE, "certUploadConfirm", OTHER, {"id": rid, "date": "2031-02-01",
                                                                    "expected": "2031-01-15"})
        check("review edition: a listed person who does not read Staff whole is still refused",
              env == {"status": 403, "message": "This action is for admin."} and not edits_of(wid), env)
        OPEN["shut"].discard(OTHER["uid"])
        OPEN["staff-profiles"].add(OTHER["uid"])
        st, env = read(CD, "certUploadsList", OTHER, {})
        check("review edition: the holder reads every row (scope all)",
              (env.get("data") or {}).get("scope") == "all", env.get("status"))
        st, env, wid = write(CD.WRITE, "certUploadConfirm", OTHER, {"id": rid, "date": "2031-02-01",
                                                                    "expected": shown})
        got = edits_of(wid)
        check("review edition: the holder confirms, kept final under the edition's name",
              env.get("status") == 200 and len(got) == 4 and all(g[10] == CD.EDITION for g in got),
              [env.get("status"), env.get("message"), len(got)])
        show_rows("certUploadConfirm (a review holder)", got, {rid: "<the ledger row id>",
                                                                 got[0][6] if got else "": "<Employee ID>"})
        EDITIONS["value"] = json.dumps([{"id": CD.EDITION, "on": False, "people": [OTHER["uid"]]}])
        st, env = read(CD, "certUploadsList", OTHER, {})
        check("review edition: its key off, the holder reads their own rows again",
              (env.get("data") or {}).get("scope") in ("own", None), env.get("status"))
        OPEN["staff-profiles"].discard(OTHER["uid"])
        EDITIONS["value"] = "[]"


try:
    with real.transaction():
        with real.transaction():
            store_mp.ensure()
            store_cd.ensure()
        check("the edit stores are made in temp tables", store_mp.ready() and store_cd.ready(),
              store_mp.why or store_cd.why)
        if chosen and other:
            guarded("address", address)
            guarded("seed", seed)
            guarded("documents", docs)
            guarded("confirmation", confirm)
        check("the real stores' tables: app.my_profile_* and app.cert_docs_*",
              MPW.Store(dsn="").kind == "my_profile" and CD.Store(dsn="").kind == "cert_docs"
              and W.Tx(None, "my_profile").app == "my_profile" and W.Tx(None, "cert_docs").app == "cert_docs")
        with real.cursor() as c:
            c.execute("select count(*), count(distinct write_id) from pg_temp.hub_edits_mpd")
            n, w = c.fetchone()
        facts["cells kept in the check's app.edits (temp)"] = f"{n} cells from {w} writes"
        raise psycopg.Rollback()
finally:
    try:
        real.close()
    except Exception:
        pass
print(json.dumps({"checks": out, "facts": facts, "rows": rows_out}))
'''

def main() -> int:
    for f in ("my_profile_writes.py", "cert_docs.py"):
        py_compile.compile(str(ROOT / "app" / f), doraise=True)
        print(f"ok   app/{f} compiles")
    app = {p.stem: p.read_text(encoding="utf-8") for p in (ROOT / "app").glob("*.py")}
    blob = {"app": app}
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
