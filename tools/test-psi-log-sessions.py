#!/usr/bin/env python3
"""PSI Log's PsiAnywhere sessions decided by the streamed modules in asa-hub-db-sync: the seal (round trip, a changed
byte, another account, another key), a session kept and brought back after a restart, idle and expiry (the sealed
expiry capping a row whose plain one was pushed forward), sign-out, a row that never landed or went missing kept again,
a store that does not answer let rest, no lock held across a database round trip and no restore reviving what a
sign-out let go of meanwhile, a dead token (placeholder rows on a LIST read, PsiAnywhere's own words anywhere, a probe
for a write or a lookup that answered nothing) ending the session, a collection under a dead token refused with the
sign-in words, the wrong-password count surviving a restart, and the platform's one click — the master's alone (the
doors hand the gate's master flag down; anyone else is refused 403 and never offered it), a fresh attendance-lane token
borrowed, else one sign-in through the login clock, a rationed clock said plainly. db/psi_log_sessions.sql is applied
twice in a transaction rolled back.

NOTHING LEAVES: PsiAnywhere, its login clock and the attendance lane are stand-ins in the driver (the wire raises if
anything reaches for it, no state file is written), the server's secret is never read (a throwaway one seals), and the
kept tables are temp tables inside a transaction rolled back at the end. Prints shapes and counts only."""
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
import asyncio, base64, contextlib, hashlib, importlib.abc, importlib.util, json, os, sys, time, types, uuid
from datetime import datetime, timezone
PAY = json.loads(base64.b64decode(sys.stdin.readline()).decode())
SRC, SQL = PAY["modules"], PAY["sql"]


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
fake.Request = object
conc = types.ModuleType("starlette.concurrency")


async def run_in_threadpool(fn, *a, **kw):
    return fn(*a, **kw)
conc.run_in_threadpool = run_in_threadpool
sys.modules.update({"fastapi": fake, "starlette": types.ModuleType("starlette"), "starlette.concurrency": conc})

# a throwaway secret seals in this check: the server's own is never read here
os.environ["HUB_SERVICE_SECRET"] = "stand-in-" + uuid.uuid4().hex
os.environ.pop("HUB_APP_TOKEN", None)

import psycopg
import hubdb
import psi_anywhere as PA
import psi_attendance as AT
import psi_harvest as H
import psi_log as PL

out, facts = [], {}


def check(name, ok, detail=""):
    out.append([name, bool(ok), "" if ok else str(detail)[:400]])


# ---- NOTHING LEAVES: the wire raises, the lane's and the clock's files are never written ----
def no_wire(*_a, **_k):
    raise AssertionError("the check reached for PsiAnywhere")


AT._call = no_wire
AT._save = lambda: None
AT.held_here = lambda: ""
PA._persist = lambda: None

ANSWERS, SENT, ANSWERED = {}, [], [0]


def ask(method, body, timeout):
    SENT.append(method)
    ANSWERED[0] += 1
    a = ANSWERS.get(method)
    if a is None:
        raise AssertionError("no stand-in answer for " + method)
    return a(body) if callable(a) else a


AT._ask = ask


def blk(w, p, d):
    return f"<permissions><window_name>{w}</window_name><permission>{p}</permission><special_data>{d}</special_data></permissions>"


def login_xml(token, first="Pat", last="Stand", user="pat.stand", people="4242"):
    return "<results>" + blk("Token", "", token) + blk("Name", first, user) + blk("LName", last, people) + "</results>"


def word_xml(word, data=""):
    return "<results>" + blk(word, "", data) + "</results>"


ADM_PASS = "stand-in-" + uuid.uuid4().hex[:8]
CRED = {"adm": ("ADMSTAND", hashlib.md5(ADM_PASS.encode()).hexdigest()),
        "ty": ("TYSTAND", hashlib.md5(b"ty-stand-in").hexdigest())}
PA._read_credential = lambda account: CRED.get(PA._account(account), ("", ""))
PA.active_account = lambda: "adm"

CLOCK = {"ok": True, "why": "", "claims": [], "settles": [], "opens": 0.0, "at": 0.0}


def claim(purpose, now=None, account=None):
    CLOCK["claims"].append((purpose, account))
    return CLOCK["ok"], CLOCK["why"]


def settle(word, account_word, now=None, account=None):
    CLOCK["settles"].append((word, account_word, account))


def would(now=None, account=None, purpose=""):
    return float(now or 0.0) >= CLOCK["opens"], ""


def snapshot():
    return {"at": CLOCK["at"], "account": "adm", "refused": None, "refused_by": {"adm": None, "ty": None},
            "paused_until": 0.0, "paused_why": "", "down": None}


PA.login_claim, PA.login_settle, PA.login_would_allow, PA.login_snapshot = claim, settle, would, snapshot

T = [time.time()]
PL._now = lambda: T[0]
ERRS = []
PL._warn = lambda what, exc: ERRS.append(f"{what}: {type(exc).__name__}: {str(exc)[:200]}")


def iso(ts):
    return datetime.fromtimestamp(ts, timezone.utc).isoformat()


def lane(token="LANE-STAND-1", account="adm", obtained_ago=900, read_ago=300):
    AT._S.clear()
    AT._S.update({"session": {"token": token, "obtained_at": iso(T[0] - obtained_ago), "account": account},
                  "read_at": iso(T[0] - read_ago)})


class Reads:
    db = types.SimpleNamespace(query=lambda sql, params=None: [])


def reset_wire():
    SENT.clear()
    CLOCK.update(ok=True, why="", claims=[], settles=[])
    ANSWERS.clear()
    ANSWERS["getLogIn"] = lambda body: login_xml("TKN-PAT-" + uuid.uuid4().hex[:6])


PLACEHOLDER = [{"Single_Entry_ID": "", "Date_of_Service": None, "Start_Time": " ", "Location_Name": ""}]
REAL_ENTRY = [{"Single_Entry_ID": "901", "Date_of_Service": "2026-10-29T00:00:00", "Start_Time": "08:00:00",
               "End_Time": "", "WCCode": "DSP", "Anywhere_Status": "P", "Location_Name": "House"}]
REAL_CODE = [{"workcodeid": "7", "workcodename": "DSP", "billable": "N", "keytimes": "", "active": "Y"}]
REAL_PLACE = [{"ID": "31", "Name": "House"}]

real = psycopg.connect(hubdb._dsn(), autocommit=False, connect_timeout=5, application_name="psi-log-sessions-check")
# whether the session lock was held at each database round trip (it never may be), and the app.psi_log_events lines
# the doors would write — recorded here, never written
LOCKED, EVENTS = [], []


class Keep:
    available = True

    def conn(self):
        LOCKED.append(PL._LOCK.locked())
        return real

    @contextlib.contextmanager
    def locked(self):
        yield types.SimpleNamespace(cur=types.SimpleNamespace(
            execute=lambda sql, params=(): EVENTS.append(tuple(params[2:5]))))


class Down:
    """A store that does not answer (asa-hub-db unreachable): every connection refused, each one counted."""
    available = True
    calls = 0

    def conn(self):
        Down.calls += 1
        raise psycopg.OperationalError("stand-in: the database does not answer")


KEEP = Keep()


def one(sql, *params):
    with real.cursor() as c:
        c.execute(sql, params)
        return c.fetchone()


def run(sql, *params):
    with real.cursor() as c:
        c.execute(sql, params)


def kept_row(uid):
    return one(f"select psi_user, sealed, obtained_at, seen_at, expires_at from {PL.SESSIONS_TABLE}"
               " where hub_uid = %s", uid)


def columns(table):
    schema, name = table.split(".")
    if schema == "pg_temp":
        schema = one("select nspname from pg_namespace where oid = pg_my_temp_schema()")[0]
    with real.cursor() as c:
        c.execute("select column_name, data_type, is_nullable, column_default from information_schema.columns"
                  " where table_name = %s and table_schema = %s order by ordinal_position", (name, schema))
        return c.fetchall()


def sign(uid, user="pat.stand", token=None):
    if token:
        ANSWERS["getLogIn"] = lambda body: login_xml(token)
    return PL.sign_in(uid, user, "a-typed-password")


def msign(uid, user="ADMSTAND", password=""):
    """A sign-in by the master (the gate's master flag set)."""
    return PL.sign_in(uid, user, password, master=True)


def refused(fn):
    try:
        fn()
    except PL.Refused as exc:
        return exc
    return None


# ---- db/psi_log_sessions.sql: applied twice (idempotent) as the owner, then rolled back ----
FILE_COLS = {}
try:
    with real.transaction():
        with real.cursor() as c:
            c.execute(SQL)
            c.execute(SQL)
        for t in ("app.psi_log_sessions", "app.psi_log_refusals"):
            FILE_COLS[t] = columns(t)
        got = one("select tableowner from pg_tables where schemaname = 'app' and tablename = 'psi_log_sessions'")
        ro = one("select has_table_privilege('asa_hub_app_ro', 'app.psi_log_sessions', 'select'),"
                 " has_table_privilege('asa_hub_app_ro', 'app.psi_log_refusals', 'select')")
        check("db/psi_log_sessions.sql applies twice: owned by the writer, readable by the read role",
              got and got[0] == "asa_hub_app_rw" and ro == (True, True), (got, ro))
        raise psycopg.Rollback()
except Exception as exc:  # noqa: BLE001 - said as a failed check
    check("db/psi_log_sessions.sql applies", False, f"{type(exc).__name__}: {exc}")

PL.SESSIONS_TABLE, PL.REFUSALS_TABLE = "pg_temp.psi_log_sessions", "pg_temp.psi_log_refusals"
PL.keep_with(KEEP)
PL._KEEP["key"] = None
UID, UID2, UIDM, UIDS = ("check-" + w + "-" + uuid.uuid4().hex[:8] for w in ("pat", "kim", "master", "staff"))

try:
    with real.transaction():
        # ---- the seal ----
        s0 = {"token": "TKN-SEAL-STAND", "user": "pat.stand", "userId": "pat.stand", "at": T[0], "expires": T[0] + 9}
        blob = PL.seal(UID, s0)
        back = PL.unseal(UID, blob) or {}
        check("seal then unseal gives the session back", back.get("token") == "TKN-SEAL-STAND"
              and back.get("user") == "pat.stand", back.keys())
        check("the token is not in the sealed bytes", b"TKN-SEAL-STAND" not in blob)
        bad = bytearray(blob)
        bad[20] ^= 1
        check("one changed byte does not open", PL.unseal(UID, bytes(bad)) is None)
        check("another Hub account's row does not open", PL.unseal(UID2, blob) is None)
        key = PL._KEEP["key"]
        PL._KEEP["key"] = b"\x07" * 32
        check("another key does not open", PL.unseal(UID, blob) is None)
        PL._KEEP["key"] = key

        # ---- a session kept, and back after a restart ----
        reset_wire()
        check("the kept tables do not exist before the first use",
              one("select to_regclass('pg_temp.psi_log_sessions')")[0] is None)
        got = sign(UID, token="TKN-PAT-1")
        row = kept_row(UID)
        check("a sign-in keeps its sealed row (made on first use), the token never in it",
              got.get("signedIn") and row and b"TKN-PAT-1" not in bytes(row[1]), (got, bool(row)))
        check("the kept row expires 20 h after the sign-in",
              row and abs((row[4] - row[2]).total_seconds() - PL.SESSION_LIFE_S) < 2, row and (row[4] - row[2]))
        tmp_cols = {t: columns(t) for t in (PL.SESSIONS_TABLE, PL.REFUSALS_TABLE)}
        check("the app's own ddl makes the same tables as db/psi_log_sessions.sql",
              [tmp_cols[PL.SESSIONS_TABLE], tmp_cols[PL.REFUSALS_TABLE]]
              == [FILE_COLS.get("app.psi_log_sessions"), FILE_COLS.get("app.psi_log_refusals")],
              (tmp_cols, FILE_COLS))
        PL._SESS.clear()
        s = PL.session_of(UID)
        check("a restart (memory cleared) brings the session back from the table",
              s and s["token"] == "TKN-PAT-1" and s["first"] == "Pat" and s["userId"] == "pat.stand")
        seen0 = kept_row(UID)[3]
        T[0] += 60
        PL.session_of(UID)
        seen1 = kept_row(UID)[3]
        T[0] += PL.SEEN_EVERY_S
        PL.session_of(UID)
        seen2 = kept_row(UID)[3]
        check("seen_at is written at most every 5 minutes", seen1 == seen0 and seen2 > seen1, (seen0, seen1, seen2))

        # ---- idle and expiry ----
        T[0] += PL.IDLE_S + 10
        PL._SESS.clear()
        check("a kept session idle 10 h does not come back, and its row is deleted",
              PL.session_of(UID) is None and kept_row(UID) is None)
        sign(UID, token="TKN-PAT-2")
        T[0] += PL.IDLE_S + 10
        check("a held session idle 10 h is let go of, its row too", PL.session_of(UID) is None and kept_row(UID) is None)
        sign(UID, token="TKN-PAT-3")
        for _ in range(4):
            T[0] += 5 * 3600 - 60
            PL.session_of(UID)
        alive = PL.session_of(UID) is not None
        T[0] += 300
        check("a busy session lives 20 h and no longer (held)", alive and PL.session_of(UID) is None
              and kept_row(UID) is None)
        sign(UID, token="TKN-PAT-4")
        for _ in range(3):
            T[0] += 5 * 3600
            PL.session_of(UID)
        PL._SESS.clear()
        T[0] += 5 * 3600 + 10
        kept_before = kept_row(UID) is not None
        check("a kept session past its 20 h (used 5 h ago) does not come back after a restart, its row deleted",
              kept_before and PL.session_of(UID) is None and kept_row(UID) is None)

        # ---- sign-out ----
        sign(UID, token="TKN-PAT-5")
        user = PL.sign_out(UID)
        check("sign-out forgets the session and deletes its row",
              user == "pat.stand" and PL.session_of(UID) is None and kept_row(UID) is None)
        sign(UID, token="TKN-PAT-6")
        PL._SESS.clear()
        PL.sign_out(UID)
        check("sign-out right after a restart deletes the kept row too", kept_row(UID) is None
              and PL.session_of(UID) is None)

        # ---- the sealed expiry caps the session: the row's plain expires_at is not trusted alone ----
        reset_wire()
        sign(UID, token="TKN-CAP-1")
        sealed_until = PL._SESS[UID]["expires"]
        run(f"update {PL.SESSIONS_TABLE} set expires_at = %s where hub_uid = %s",
            datetime.fromtimestamp(T[0] + 100 * 3600, timezone.utc), UID)
        PL._SESS.clear()
        s = PL.session_of(UID) or {}
        check("a restored session ends when its SEALED expiry says, however far the row's was pushed",
              s.get("token") == "TKN-CAP-1" and abs(s.get("expires", 0) - sealed_until) < 1e-3, s.get("expires"))
        T[0] += PL.SESSION_LIFE_S + 60
        run(f"update {PL.SESSIONS_TABLE} set seen_at = %s, expires_at = %s where hub_uid = %s",
            datetime.fromtimestamp(T[0], timezone.utc), datetime.fromtimestamp(T[0] + 100 * 3600, timezone.utc), UID)
        PL._SESS.clear()
        check("past the sealed expiry it does not come back (the row pushed forward, seen just now), its row deleted",
              PL.session_of(UID) is None and kept_row(UID) is None)

        # ---- a row that never landed, or went missing, is kept again ----
        reset_wire()
        errs, PL._KEEP["store"] = len(ERRS), Down()
        Down.calls = 0
        got = sign(UID, token="TKN-DOWN-1")
        s = PL._SESS.get(UID) or {}
        calls = Down.calls
        for _ in range(5):
            PL.session_of(UID)
        check("a store that does not answer: the sign-in still lands in memory, not kept, and the store is let rest "
              "(no further connection tried for 30 s)", got.get("signedIn") and s.get("kept") is False
              and calls == 1 and Down.calls == 1 and PL._KEEP["rest_until"] > T[0], (s.get("kept"), calls, Down.calls))
        PL._KEEP["store"] = KEEP
        T[0] += 10
        PL.session_of(UID)
        rest_held = kept_row(UID) is None
        T[0] += PL.DB_REST_S
        s = PL.session_of(UID) or {}
        row = kept_row(UID)
        check("after the rest the next look keeps the session that never landed, then a restart brings it back",
              rest_held and s.get("kept") is True and row is not None, (rest_held, s.get("kept"), bool(row)))
        PL._SESS.clear()
        check("(the re-kept row opens after a restart)", (PL.session_of(UID) or {}).get("token") == "TKN-DOWN-1")
        run(f"delete from {PL.SESSIONS_TABLE} where hub_uid = %s", UID)
        T[0] += PL.SEEN_EVERY_S + 1  # past the restored seen_at, which came back rounded to the microsecond
        PL.session_of(UID)
        check("a kept row that went missing (seen_at touched no row) is written again",
              kept_row(UID) is not None and PL._SESS[UID].get("kept") is True)
        del ERRS[errs:]
        PL.sign_out(UID)

        # ---- no lock across a round trip; a restore never revives what a sign-out let go of meanwhile ----
        check("no process-wide lock is held across the kept tables any more", not hasattr(PL, "_KEEP_LOCK"))
        reset_wire()
        sign(UID, token="TKN-RACE-1")
        PL._SESS.clear()
        first = PL._restore

        def sign_out_meanwhile(uid):
            got = first(uid)
            PL._drop(uid)  # a sign-out lands while the row was being read
            return got
        PL._restore = sign_out_meanwhile
        try:
            back = PL.session_of(UID)
        finally:
            PL._restore = first
        check("a sign-out that lands while a restore reads the row is not undone: nothing put back, no row",
              back is None and UID not in PL._SESS and kept_row(UID) is None, (back and back.get("token")))
        sign(UID, token="TKN-RACE-2")
        PL._SESS.clear()

        def sign_in_meanwhile(uid):
            got = first(uid)
            ANSWERS["getLogIn"] = lambda body: login_xml("TKN-RACE-3")
            PL.sign_in(uid, "pat.stand", "a-typed-password")  # a fresh sign-in lands meanwhile
            return got
        PL._restore = sign_in_meanwhile
        try:
            back = PL.session_of(UID) or {}
        finally:
            PL._restore = first
        check("a sign-in that lands while a restore reads the row wins: the old row is never put over it",
              back.get("token") == "TKN-RACE-3" and PL._SESS[UID]["token"] == "TKN-RACE-3"
              and PL.unseal(UID, bytes(kept_row(UID)[1])).get("token") == "TKN-RACE-3")
        PL.sign_out(UID)
        s = PL._session(UID, "pat.stand", {"token": "TKN-RACE-4"}, T[0], T[0] + PL.SESSION_LIFE_S)
        PL._keep_held(UID, s)  # its sign-out landed before its row did
        check("a row written for a session already let go of is deleted again", kept_row(UID) is None
              and s.get("kept") is False)

        # ---- a dead token ----
        check("placeholder rows, a JSON string of them and PsiAnywhere's words read as a dead token",
              PL.ended(PLACEHOLDER) and PL.ended(json.dumps(PLACEHOLDER)) and PL.ended({})
              and PL.ended("Invalid token") and PL.ended("Session has expired"))
        check("an empty list, real rows, a typed comment and an entry number never do",
              not PL.ended([]) and not PL.ended("[]") and not PL.ended(REAL_ENTRY) and not PL.ended("-1")
              and not PL.ended([{"Single_Entry_ID": "5", "Comments": "my session expired"}]) and not PL.ended("12345"))
        check("for a write or a lookup only the words are the sign: placeholders and {} are not, on their own",
              PL.said_ended("Invalid token") and PL.said_ended("Session has expired") and not PL.said_ended(PLACEHOLDER)
              and not PL.said_ended({}) and not PL.said_ended(json.dumps(PLACEHOLDER)) and not PL.said_ended([])
              and not PL.said_ended([{"Comments": "invalid session"}]))
        reset_wire()
        sign(UID, token="TKN-PAT-7")
        ANSWERS.update(getSingleEntryByDateJSON=REAL_ENTRY, getWorkCodesJSON=REAL_CODE,
                       getSingleEntryLocationsJSON=REAL_PLACE)
        v = PL.view(Reads(), UID, False)
        check("a live session draws its entries, codes and places", v["signedIn"] and len(v.get("entries") or []) == 1
              and len(v.get("codes") or []) == 1 and len(v.get("locations") or []) == 1 and not v.get("ended"), v)
        ANSWERS["getSingleEntryByDateJSON"] = PLACEHOLDER
        PL._SESS[UID]["codes"] = None
        v = PL.view(Reads(), UID, False)
        check("placeholder entries end the session: the sign-in card with why, no lists — and, not the master, no "
              "stored accounts and no pre-filled name",
              v["signedIn"] is False and v.get("ended") == PL.ENDED and "entries" not in v and "codes" not in v
              and "platformAccounts" not in v and "prefill" not in v, v)
        check("and the session is forgotten, memory and row", UID not in PL._SESS and kept_row(UID) is None)
        sign(UID, token="TKN-PAT-8")
        ANSWERS["getConsumersByGroupJSON"] = [{"id": None, "FN": "", "LN": ""}]
        env = PL._answer(lambda: {"consumers": PL.consumers(PL._must(UID))})
        check("a door on a dead token answers 401 signed-out", env.get("status") == 401
              and env.get("reason") == "signed-out" and env.get("message") == PL.ENDED, env)
        sign(UID, token="TKN-PAT-9")
        s = PL.session_of(UID)
        ANSWERS["getWorkCodesJSON"] = [{"workcodeid": "", "workcodename": "", "active": ""}]
        exc = refused(lambda: PL.codes(s))
        check("dead work codes sign out and nothing is cached", exc and exc.word == "signed-out"
              and s.get("codes") is None and kept_row(UID) is None, exc)
        sign(UID, token="TKN-PAT-10")
        s = PL.session_of(UID)
        ANSWERS["getWorkCodesJSON"] = []
        check("an empty code list is never cached either", PL.codes(s) == [] and s.get("codes") is None)
        ANSWERS["updateActiveInactiveUser"] = "Invalid token"
        exc = refused(lambda: PL.set_account_active(s, "u-1", False))
        check("PsiAnywhere's own invalid-session words end it too", exc and exc.status == 401
              and exc.word == "signed-out" and kept_row(UID) is None, exc)

        # ---- a write or a single-record lookup that answers nothing: one probe decides ----
        reset_wire()
        sign(UID, token="TKN-PROBE-1")
        s = PL.session_of(UID)
        ANSWERS.update(getWorkCodesJSON=REAL_CODE, getStrongPassword="<a>Y</a><b>!#$%*@</b><c>8</c>",
                       getUserCredDateJSON=[{"password": "", "userId": ""}])
        SENT.clear()
        exc = refused(lambda: PL.reset_password(s, {"userId": "u-1", "useDefault": True}))
        check("reset: a credential row with no password, token alive — the probe says so, the session stands, and "
              "the answer is 'did not return this account's credential'",
              exc and exc.status == 502 and exc.word == "no-cred" and "did not return this account's credential"
              in str(exc) and PL.session_of(UID) is s and kept_row(UID) is not None
              and SENT.count(PL.PROBE) == 1 and "resetPassword" not in SENT, (exc, SENT))
        ANSWERS["getUserCredDateJSON"] = [{"password": "", "userId": "u-1"}]
        SENT.clear()
        exc = refused(lambda: PL.reset_password(s, {"userId": "u-1", "useDefault": True}))
        check("(a row with the account but no password needs no probe at all)", exc and exc.word == "no-cred"
              and PL.PROBE not in SENT, (exc, SENT))
        ANSWERS["updateActiveInactiveUser"] = {}
        SENT.clear()
        got = PL.set_account_active(s, "u-1", False)
        check("a write that answers {} with the token alive is a write done: no sign-out, one probe",
              got == {"userId": "u-1", "active": False} and PL.session_of(UID) is s and kept_row(UID) is not None
              and SENT == ["updateActiveInactiveUser", PL.PROBE], (got, SENT))

        def probe_down(body):
            raise AT.PsiTransport("probe stand-in")
        ANSWERS[PL.PROBE] = probe_down
        got = PL.set_account_active(s, "u-1", True)
        check("a probe PsiAnywhere does not answer signs no one out: the write's answer stands",
              got == {"userId": "u-1", "active": True} and PL.session_of(UID) is s, got)
        ANSWERS.update(getWorkCodesJSON=PLACEHOLDER, getUserCredDateJSON=[{"password": "", "userId": ""}])
        exc = refused(lambda: PL.reset_password(s, {"userId": "u-1", "useDefault": True}))
        check("a lookup answered with nothing on a dead token: the probe confirms it, 401 signed-out, row gone",
              exc and exc.status == 401 and exc.word == "signed-out" and kept_row(UID) is None
              and UID not in PL._SESS, exc)
        sign(UID, token="TKN-PROBE-2")
        s = PL.session_of(UID)
        ANSWERS["updateActiveInactiveUser"] = {}
        exc = refused(lambda: PL.set_account_active(s, "u-1", False))
        check("a write answered {} on a dead token: the probe confirms it, 401 signed-out", exc and exc.status == 401
              and exc.word == "signed-out" and kept_row(UID) is None, exc)

        # ---- a collection now, under a dead token: the sign-in words, never a run of blank rows ----
        STARTS = []
        start0 = H.start
        H.start = lambda store, ask, token, user, by: STARTS.append((ask, token, user, by)) or True
        try:
            reset_wire()
            sign(UID, token="TKN-COLLECT-1")
            ANSWERS[PL.PROBE] = PLACEHOLDER
            exc = refused(lambda: PL.collect(None, UID))
            check("Collect now on a dead token answers with the sign-in words; no run is started, the session ends",
                  exc and exc.word == "signed-out" and str(exc) == PL.ENDED and not STARTS and kept_row(UID) is None,
                  (exc, STARTS))
            sign(UID, token="TKN-COLLECT-2")
            ANSWERS[PL.PROBE] = REAL_CODE
            got = PL.collect(None, UID)
            ask = STARTS[-1][0] if STARTS else None
            check("Collect now on a live token starts the run with the checked ask, not the bare wire",
                  got.get("started") and ask is not None and ask is not H.ask and STARTS[-1][1] == "TKN-COLLECT-2",
                  (got, STARTS))
            ANSWERS["getActiveEmployees"] = PLACEHOLDER
            SENT.clear()
            same = ask("getActiveEmployees", {"token": "TKN-COLLECT-2"})
            check("a list the run reads that is really empty (the probe says the token lives) is kept as it came",
                  same == PLACEHOLDER and SENT == ["getActiveEmployees", PL.PROBE] and PL.session_of(UID) is not None,
                  SENT)
            ANSWERS["getConsumerDemographicsJSON"] = [{"id": "", "FN": ""}]
            SENT.clear()
            same = ask("getConsumerDemographicsJSON", {"token": "TKN-COLLECT-2", "consumerId": "9"})
            check("a per-item read is judged by the words alone (no probe per item)",
                  same == [{"id": "", "FN": ""}] and SENT == ["getConsumerDemographicsJSON"], SENT)
            ANSWERS[PL.PROBE] = PLACEHOLDER
            exc = refused(lambda: ask("getActiveEmployees", {"token": "TKN-COLLECT-2"}))
            SENT.clear()
            again = refused(lambda: ask("getEmployeeList", {"token": "TKN-COLLECT-2"}))
            check("a token that dies mid-run: that read is refused (no blank rows kept), the session ends, and every "
                  "later read is refused without reaching PsiAnywhere",
                  exc and exc.word == "signed-out" and again and again.word == "signed-out" and not SENT
                  and kept_row(UID) is None, (exc, again, SENT))
            sign(UID, token="TKN-COLLECT-3")
            ANSWERS[PL.PROBE] = REAL_CODE
            PL.collect(None, UID)
            ANSWERS["getEmployeeList"] = "Invalid token"
            exc = refused(lambda: STARTS[-1][0]("getEmployeeList", {"token": "TKN-COLLECT-3"}))
            check("PsiAnywhere's invalid-session words mid-run end it too", exc and exc.word == "signed-out"
                  and kept_row(UID) is None, exc)
        finally:
            H.start = start0

        # ---- the wrong-password count survives a restart ----
        reset_wire()
        KIM = "kim.stand"
        ANSWERS["getLogIn"] = lambda body: word_xml("Failed attempts", "1")
        e1 = refused(lambda: PL.sign_in(UID2, KIM, "wrong-1"))
        ANSWERS["getLogIn"] = lambda body: word_xml("Failed attempts", "2")
        e2 = refused(lambda: PL.sign_in(UID2, KIM, "wrong-2"))
        r = one(f"select count from {PL.REFUSALS_TABLE} where psi_user = %s", KIM)
        check("two refusals are kept in the table", e1 and e2 and r and r[0] == 2, (e1, e2, r))
        PL._REFUSED.clear()
        sent = len(SENT)
        e3 = refused(lambda: PL.sign_in(UID2, KIM, "wrong-3"))
        check("after a restart the third wrong password is still never sent", e3 and e3.word == "held-back"
              and len(SENT) == sent, (e3, SENT[sent:]))
        T[0] += PL.REFUSAL_REST_S + 5
        PL._REFUSED.clear()
        check("after the hour's rest the count is let go of, its row deleted", not PL._held_back(KIM)
              and one(f"select count(*) from {PL.REFUSALS_TABLE} where psi_user = %s", KIM)[0] == 0)
        ANSWERS["getLogIn"] = lambda body: word_xml("Failed attempts", "1")
        refused(lambda: PL.sign_in(UID2, KIM, "wrong-again"))
        PL._REFUSED.clear()
        ANSWERS["getLogIn"] = lambda body: word_xml("Invalid username")
        refused(lambda: PL.sign_in(UID2, KIM, "wrong-after-restart"))
        r = one(f"select count from {PL.REFUSALS_TABLE} where psi_user = %s", KIM)
        check("a refusal after a restart adds to the kept count, not to an empty one", r and r[0] == 2
              and PL._held_back(KIM), r)
        PL._REFUSED.clear()
        PL._db(f"delete from {PL.REFUSALS_TABLE}")
        ANSWERS["getLogIn"] = lambda body: word_xml("Failed attempts", "1")
        refused(lambda: PL.sign_in(UID2, KIM, "wrong-x"))
        ANSWERS["getLogIn"] = lambda body: login_xml("TKN-KIM-1", "Kim", "Stand", KIM)
        PL.sign_in(UID2, KIM, "right")
        check("a sign-in that lands forgets the count, row and memory",
              one(f"select count(*) from {PL.REFUSALS_TABLE} where psi_user = %s", KIM)[0] == 0
              and KIM not in PL._REFUSED)

        # ---- the platform's one click ----
        reset_wire()
        lane()
        got = msign(UIDM)
        s = PL.session_of(UIDM) or {}
        check("a fresh lane token is borrowed: no sign-in sent, no clock slot taken",
              got.get("signedIn") and s.get("token") == "LANE-STAND-1" and s.get("borrowed") == "adm"
              and not CLOCK["claims"] and "getLogIn" not in SENT, (got, CLOCK, SENT))
        check("a borrowed session expires 20 h after the lane obtained it",
              abs(s.get("expires", 0) - (T[0] - 900 + PL.SESSION_LIFE_S)) < 2)
        PL.sign_out(UIDM)
        check("sign-out of a borrowed token only forgets it here: the lane keeps it",
              AT._S["session"]["token"] == "LANE-STAND-1" and kept_row(UIDM) is None and UIDM not in PL._SESS)
        for name, kw in (("read 40 minutes ago", {"read_ago": 40 * 60}),
                         ("not read since it was obtained", {"obtained_ago": 120, "read_ago": 600}),
                         ("the other account's", {"account": "ty", "read_ago": 60})):
            reset_wire()
            lane(**kw)
            ANSWERS["getLogIn"] = lambda body: login_xml("TKN-ADM-1", "ADM", "Platform", "ADMSTAND")
            got = msign(UIDM)
            s = PL.session_of(UIDM) or {}
            check(f"a lane token {name} is not borrowed: one sign-in through the clock, settled as the lane settles",
                  got.get("signedIn") and s.get("token") == "TKN-ADM-1" and not s.get("borrowed")
                  and CLOCK["claims"] == [(PL.CLOCK_PURPOSE, "adm")] and CLOCK["settles"] == [("up", "Token", "adm")]
                  and SENT.count("getLogIn") == 1, (got, CLOCK, SENT))
            PL.sign_out(UIDM)
        reset_wire()
        AT._S.clear()
        CLOCK.update(ok=False, why="the credentialed check runs at most once every few minutes", at=T[0] - 100,
                     opens=T[0] - 100 + PA.PSI_LOGIN_GAP_S)
        exc = refused(lambda: msign(UIDM))
        said = str(exc or "")
        check("a rationed one click is said plainly, with when the next is possible, and nothing is sent",
              exc and exc.word == "rationed" and "once every few minutes" in said
              and "The next sign-in is possible at" in said and "New York time" in said and "getLogIn" not in SENT,
              said)
        facts["the rationed words"] = said
        CLOCK.update(opens=float("inf"))
        exc = refused(lambda: msign(UIDM))
        check("a clock that cannot say when still answers in words", exc and exc.word == "rationed"
              and "Try again later" in str(exc), str(exc))
        reset_wire()
        lane(token="LANE-STAND-2", read_ago=60)
        msign(UIDM)
        ANSWERS["getSingleEntryByDateJSON"] = PLACEHOLDER
        v = PL.view(Reads(), UIDM, True)
        check("a borrowed token PsiAnywhere answers as dead signs out here; the lane's state is left alone",
              v["signedIn"] is False and v.get("ended") == PL.ENDED and AT._S["session"]["token"] == "LANE-STAND-2")
        ANSWERS["getLogIn"] = lambda body: login_xml("TKN-ADM-2", "ADM", "Platform", "ADMSTAND")
        msign(UIDM)
        s = PL.session_of(UIDM) or {}
        check("and that dead lane token is never borrowed again: the next click takes the clock",
              s.get("token") == "TKN-ADM-2" and CLOCK["claims"] == [(PL.CLOCK_PURPOSE, "adm")], (CLOCK, s.get("borrowed")))
        PL.sign_out(UIDM)
        reset_wire()
        AT._S.clear()
        ANSWERS["getLogIn"] = lambda body: word_xml("2FA", "device-stand-in")
        got = msign(UIDM)
        check("a two-factor prompt is settled as answered, without latching the account",
              got.get("needsCode") and CLOCK["settles"] == [("up", "", "adm")], (got, CLOCK["settles"]))
        reset_wire()
        ANSWERS["getLogIn"] = lambda body: word_xml("Not active")
        exc = refused(lambda: msign(UIDM))
        check("a refusal is settled with the account's word, as the lane's sign-in settles it",
              exc and CLOCK["settles"] == [("up", "Not active", "adm")], (exc, CLOCK["settles"]))
        reset_wire()
        ANSWERS["getLogIn"] = lambda body: "<html>maintenance</html>"
        exc = refused(lambda: msign(UIDM))
        check("an answer without a word is settled unknown", exc and CLOCK["settles"] == [("unknown", "", "adm")],
              (exc, CLOCK["settles"]))

        def raises(kind):
            def go(body):
                raise kind("getLogIn stand-in")
            return go
        reset_wire()
        ANSWERS["getLogIn"] = raises(AT.PsiTransport)
        exc = refused(lambda: msign(UIDM))
        check("a sign-in that timed out is settled unknown and said as a 503", exc and exc.status == 503
              and CLOCK["settles"] == [("unknown", "", "adm")], (exc, CLOCK["settles"]))
        reset_wire()
        ANSWERS["getLogIn"] = raises(AT.PsiPaused)
        exc = refused(lambda: msign(UIDM))
        check("a sign-in held by DOWN after its claim is not settled (nothing left)", exc and exc.status == 503
              and CLOCK["claims"] and not CLOCK["settles"], (exc, CLOCK))
        reset_wire()
        ANSWERS["getLogIn"] = lambda body: login_xml("TKN-ADM-3", "ADM", "Platform", "ADMSTAND")
        got = msign(UIDM, password=ADM_PASS)
        check("the platform's password typed takes the same clock", got.get("signedIn")
              and CLOCK["claims"] == [(PL.CLOCK_PURPOSE, "adm")], CLOCK)
        reset_wire()
        exc = refused(lambda: msign(UIDM, password="not-the-password"))
        check("a wrong platform password is still never sent", exc and exc.word == "platform-wrong" and not SENT
              and not CLOCK["claims"])
        PL.sign_out(UIDM)

        # ---- the platform's accounts are the master's alone ----
        for name, fn in (("the one click", lambda: PL.sign_in(UIDS, "ADMSTAND", "")),
                         ("the one click, any case", lambda: PL.sign_in(UIDS, "admstand", " ")),
                         ("the platform's password typed", lambda: PL.sign_in(UIDS, "ADMSTAND", ADM_PASS)),
                         ("a wrong platform password", lambda: PL.sign_in(UIDS, "ADMSTAND", "not-the-password")),
                         ("Ty's one click", lambda: PL.sign_in(UIDS, "TYSTAND", "")),
                         ("platform_sign_in itself", lambda: PL.platform_sign_in(UIDS, "adm"))):
            reset_wire()
            lane(token="LANE-STAND-3", read_ago=60)
            exc = refused(fn)
            check(f"not the master — {name}: refused 403 in plain words; nothing sent, no clock slot, nothing borrowed",
                  exc and exc.status == 403 and exc.word == "master-only" and "master alone" in str(exc)
                  and not SENT and not CLOCK["claims"] and UIDS not in PL._SESS and kept_row(UIDS) is None,
                  (exc, SENT, CLOCK["claims"]))
        reset_wire()
        got = PL.sign_in(UIDS, "pat.stand", "their-own-password")
        check("not the master, their own account: signed in as ever", got.get("signedIn")
              and (PL.session_of(UIDS) or {}).get("user") == "pat.stand")
        PL.sign_out(UIDS)
        ANSWERS.update(getSingleEntryByDateJSON=REAL_ENTRY, getWorkCodesJSON=REAL_CODE,
                       getSingleEntryLocationsJSON=REAL_PLACE)
        v_staff, v_master = PL.view(Reads(), UIDS, False), PL.view(Reads(), UIDM, True)
        check("the sign-in card names the stored accounts and pre-fills ADM for the master only",
              "platformAccounts" not in v_staff and "prefill" not in v_staff
              and [a["user"] for a in v_master.get("platformAccounts") or []] == ["ADMSTAND", "TYSTAND"]
              and v_master.get("prefill") == "ADMSTAND", (v_staff.keys(), v_master.get("platformAccounts")))

        # ---- the doors hand the gate's master flag down (install, behind stand-in gates) ----
        GATE = {"master": False}

        async def app_gate(request, app_id, app_label=""):
            return ("staff", request.uid)

        async def session_of_hub(request):
            return types.SimpleNamespace(uid=request.uid, is_master=GATE["master"])
        stubs = {"sched_lanes": types.ModuleType("sched_lanes"), "lane_gate": types.ModuleType("lane_gate")}
        stubs["sched_lanes"]._app_gate, stubs["sched_lanes"]._session = app_gate, session_of_hub
        stubs["lane_gate"].answer = lambda env, no_store=False: env
        stubs["lane_gate"].query = lambda request, name: ""
        held_mods = {k: sys.modules.get(k) for k in stubs}
        ROUTES = {}

        class App:
            def get(self, path, include_in_schema=False):
                return lambda fn: ROUTES.setdefault(("GET", path), fn)

            def post(self, path, include_in_schema=False):
                return lambda fn: ROUTES.setdefault(("POST", path), fn)

        class Req:
            method = "POST"

            def __init__(self, uid, body=None):
                self.uid, self.body = uid, body or {}

            async def json(self):
                return self.body

        sys.modules.update(stubs)
        try:
            PL.install(App(), KEEP, lambda: Reads())
            sign_door, view_door = ROUTES[("POST", PL.LANE + "/sign-in")], ROUTES[("GET", PL.LANE)]
            reset_wire()
            lane(token="LANE-STAND-4", read_ago=60)
            EVENTS.clear()
            env = asyncio.run(sign_door(Req(UIDS, {"username": "ADMSTAND", "password": ""})))
            seen = asyncio.run(view_door(Req(UIDS)))
            check("through the door, not the master: the one click is a 403 with the plain words, logged as such, and "
                  "the lane's view offers no stored account",
                  env.get("status") == 403 and env.get("reason") == "master-only" and env.get("message") == PL.MASTER_ONLY
                  and not SENT and UIDS not in PL._SESS and ("sign-in", False, "master-only") in EVENTS
                  and seen.get("status") == 200 and "platformAccounts" not in (seen.get("data") or {}),
                  (env, EVENTS, seen.get("status")))
            GATE["master"] = True
            seen = asyncio.run(view_door(Req(UIDM)))
            env = asyncio.run(sign_door(Req(UIDM, {"username": "ADMSTAND", "password": ""})))
            check("through the door, the master: the view names ADM, and the one click signs in (the lane's token)",
                  (seen.get("data") or {}).get("prefill") == "ADMSTAND"
                  and env.get("status") == 200 and (env.get("data") or {}).get("signedIn") is True
                  and (PL.session_of(UIDM) or {}).get("token") == "LANE-STAND-4", (env, seen.get("status")))
            PL.sign_out(UIDM)
        finally:
            for k, mod in held_mods.items():
                if mod is None:
                    sys.modules.pop(k, None)
                else:
                    sys.modules[k] = mod

        # ---- no secret: memory alone, as before ----
        secret = os.environ.pop("HUB_SERVICE_SECRET")
        PL._KEEP["key"] = None
        reset_wire()
        UID3 = "check-nokey-" + uuid.uuid4().hex[:8]
        got = sign(UID3, token="TKN-NOKEY")
        held = PL.session_of(UID3) is not None
        PL._SESS.clear()
        check("without a secret the session lives in memory alone: no row, gone after a restart",
              got.get("signedIn") and held and kept_row(UID3) is None and PL.session_of(UID3) is None)
        os.environ["HUB_SERVICE_SECRET"] = secret
        PL._KEEP["key"] = None

        check("the kept tables never failed a statement", not ERRS, ERRS[:3])
        check("no database round trip ran under the session lock", LOCKED and not any(LOCKED),
              (len(LOCKED), sum(1 for x in LOCKED if x)))
        facts["database round trips watched for the lock"] = len(LOCKED)
        facts["kept rows at the end (temp)"] = one(f"select count(*) from {PL.SESSIONS_TABLE}")[0]
        facts["PsiAnywhere requests the stand-in answered (none reached PsiAnywhere)"] = ANSWERED[0]
        raise psycopg.Rollback()
except Exception as exc:  # noqa: BLE001 - said as a failed check
    check("the check ran to the end", False, f"{type(exc).__name__}: {str(exc)[:300]}")
finally:
    try:
        real.close()
    except Exception:
        pass
print(json.dumps({"checks": out, "facts": facts}, default=str))
'''


def main() -> int:
    py_compile.compile(str(ROOT / "app" / "psi_log.py"), doraise=True)
    print("ok   PSI Log compiles")
    payload = {"modules": {p.stem: p.read_text(encoding="utf-8") for p in (ROOT / "app").glob("*.py")},
               "sql": (ROOT / "db" / "psi_log_sessions.sql").read_text(encoding="utf-8")}
    got = subprocess.run(["docker", "exec", "-i", "-e", "MALLOC_ARENA_MAX=2", DB_RUNNER, "python", "-c", DRIVER],
                         input=base64.b64encode(json.dumps(payload).encode()) + b"\n", capture_output=True, timeout=600)
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
    print(f"{len(res['checks']) + 1 - failed} ok, {failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
