"""The reply ear in asa-hub-app (app/sms_ears.py, its clock in app/clocks.py), run in-process on stand-ins: the ear's
ledger and every lane table are this session's pg_temp copies (db/relay_tables.sql) on one connection whose role cannot
write app.*, the house calendars are read live from the old platform read-only, who sent a text is a stand-in book, and
the acknowledgements' door is stood in for. It asserts the translation is the relay's own (every function but the
connection plumbing has the relay's syntax tree), that each kind of text comes to what the relay's ear makes of it,
exactly once, that the acknowledgement owed is handed to staffShiftReminder and written down, and that the pass lock is
given back. Nothing is sent and no real row is written.

Run inside asa-hub-db-sync by the in-process runner (the environment passes 128 KiB, so it goes as a file):

    cp tools/test-sms-ears-app.py "$RUNNER/test_sms_ears_app.py"
    python3 -c 'import json;json.dump({"RELAY_SQL":open("db/relay_tables.sql").read(),
        "RELAY_EARS":open("server/sms_ears.py").read(),
        "FD_ROUTES":open("app/front_door_routes.json").read(),"IST":open("app/ist_config_defaults.json").read()},
        open("'"$RUNNER"'/ears-env.json","w"))'
    sh "$RUNNER/run.sh" "$PWD/app" "$RUNNER/test_sms_ears_app.py" "@$RUNNER/ears-env.json"
"""
import logging

logging.disable(logging.CRITICAL)
import ast  # noqa: E402
import asyncio  # noqa: E402
import json  # noqa: E402
import os  # noqa: E402
import re  # noqa: E402
import sys  # noqa: E402
import tempfile  # noqa: E402
import types  # noqa: E402
from datetime import datetime, timedelta, timezone  # noqa: E402

import psycopg  # noqa: E402

out: dict = {}
fails: list = []


def check(name, cond, got=None):
    out[name] = "ok" if cond else {"FAILED": got}
    if not cond:
        fails.append(name)


# ---- the translation: the relay's syntax tree, but for the plumbing ------------------------------------------------

def _tops(src: str) -> dict[str, str]:
    tree = ast.parse(src)
    got = {}
    for n in tree.body:
        name = getattr(n, "name", None) or (ast.unparse(n.targets[0]) if isinstance(n, ast.Assign) else None)
        if name:
            got[name] = ast.dump(n)
    return got


PLUMBING = {"_EarLock", "Contacts", "load_contacts"}
relay, mine = _tops(os.environ["RELAY_EARS"]), _tops(SRC["sms_ears"])  # noqa: F821 - drv.py's sources
differ = sorted(k for k in set(relay) | set(mine) if k not in PLUMBING and relay.get(k) != mine.get(k))
check("translation: every function and constant of the ear but its connection plumbing is the relay's", not differ,
      differ)

# ---- the stand-ins ---------------------------------------------------------------------------------------------------


class _Resp:
    def __init__(self, content=None, status_code=200, media_type=None, headers=None):
        self.body, self.status_code = content, status_code


async def _threadpool(fn, *a, **k):
    return fn(*a, **k)


_fa = types.ModuleType("fastapi")
_fa.FastAPI, _fa.Request = object, object
_fr = types.ModuleType("fastapi.responses")
_fr.JSONResponse = _fr.Response = _Resp
_sc = types.ModuleType("starlette.concurrency")
_sc.run_in_threadpool = _threadpool
sys.modules.update({"fastapi": _fa, "fastapi.responses": _fr, "starlette": types.ModuleType("starlette"),
                    "starlette.concurrency": _sc})

WORK = tempfile.mkdtemp(prefix="sms-ears-test-")
INBOX = os.path.join(WORK, "inbox")
os.makedirs(INBOX)
with open(os.path.join(WORK, "routes.json"), "w") as fh:
    fh.write(os.environ["FD_ROUTES"])
os.environ.update(HUB_QUO_INBOX_DIR=INBOX, HUB_PSI_REMINDERS_STATE=os.path.join(WORK, "psi.json"),
                  HUB_DB_WRITE_DSN="stand-in", HUB_APP_PACK_DIR=WORK, HUB_SERVICE_SECRET="",
                  HUB_FRONT_DOOR_ROUTES=os.path.join(WORK, "routes.json"),
                  HUB_IST_CONFIG_DECLARATION_JSON=os.environ["IST"])
OWNER = (f"host={os.environ['HUB_DB_HOST']} dbname={os.environ['POSTGRES_DB']} user={os.environ['POSTGRES_USER']} "
         f"password={os.environ['POSTGRES_PASSWORD']}")
os.environ["HUB_DB_DSN"] = OWNER

# the relay's own tables as this session's pg_temp copies, on a connection that cannot write app.*
TEST = psycopg.connect(OWNER, autocommit=True)
TEST.execute("set role asa_hub_app_ro")
TEST.execute("set search_path = pg_temp, public")
sql = re.sub(r"--[^\n]*", "", os.environ["RELAY_SQL"])
for stmt in [s.strip() for s in sql.split(";") if s.strip()]:
    low = stmt.lower()
    if not low.startswith(("create table", "create index", "create unique index")):
        continue
    stmt = stmt.replace("app.", "")
    stmt = re.sub(r"(?i)^create table if not exists", "create temp table", stmt)
    TEST.execute(stmt)

import lanes_pg  # noqa: E402

lanes_pg.SCHEMA = "pg_temp"
lanes_pg.CONNECT["own"] = lanes_pg.CONNECT["spare"] = lambda: TEST
MIRROR = psycopg.connect(os.environ["MIRROR_DSN"], autocommit=True)
MIRROR.execute("set session characteristics as transaction read only")
lanes_pg.CONNECT["intel"] = lambda: MIRROR
_close = lanes_pg._close
lanes_pg._close = lambda c: None if c in (TEST, MIRROR) else _close(c)

try:
    import live_notify  # noqa: E402

    TOLD: list = []
    live_notify.tell = lambda resources=(), **said: TOLD.append({"resources": list(resources), **said})
    import psi_reminders  # noqa: E402
    import shift_requests  # noqa: E402
    import sms_ears  # noqa: E402
    import clocks as C  # noqa: E402

    DSN = C.SMS_EARS_DSN
    UTC = timezone.utc
    NOW = datetime.now(UTC)
    LINE = psi_reminders.REPLY_LINE
    ANA, STRANGER, SHARED = "3305550100", "3305550177", "3307544040"
    REF = "SP0A1B2C3D4E"
    check("words: a shift's ref is read off the text", shift_requests.REF_RE.findall(f"YES {REF}") == [REF])

    def line(mid: str, frm: str, text: str, at: datetime, to: list[str] | None = None) -> str:
        stamp = at.isoformat().replace("+00:00", "Z")
        obj = {"id": mid, "object": "message", "direction": "incoming", "from": f"+1{frm}",
               "to": to or [f"+1{LINE}"], "text": text, "createdAt": stamp}
        return json.dumps({"id": mid, "type": "message.received", "received_at": stamp, "source": "quo",
                           "event": {"id": mid, "type": "message.received", "data": {"object": obj}}})

    texts = [
        line("AC_GROUP", ANA, "yes", NOW - timedelta(minutes=50), to=[f"+1{LINE}", "+13305550199"]),
        line("AC_CHAT", ANA, "is the van at the house today", NOW - timedelta(minutes=45)),
        line("AC_STRANGER", STRANGER, "YES", NOW - timedelta(minutes=40)),
        line("AC_SHARED", SHARED, "YES", NOW - timedelta(minutes=35)),
        line("AC_REF", ANA, f"YES {REF}", NOW - timedelta(hours=2)),
        line("AC_OLD", ANA, "YES", NOW - timedelta(hours=30)),
    ]
    with open(os.path.join(INBOX, "a.jsonl"), "w") as fh:
        fh.write("\n".join(texts) + "\n")
    # the same delivery kept twice is one text
    with open(os.path.join(INBOX, "b.jsonl"), "w") as fh:
        fh.write(texts[4] + "\n")

    book = sms_ears.Contacts({}, {SHARED}, {ANA: {"anatester": "Ana Tester"}})
    sms_ears._ensure(DSN)
    TEST.execute("update asa_sms_reply_start set since = now() - interval '26 hours' where id = 1")

    said = sms_ears.listen(DSN, contacts=lambda: book)
    lanes_pg.finish()
    rows = {r[0]: r[1:] for r in TEST.execute(
        "select id, outcome, code, sender, person, ack, road from asa_sms_replies").fetchall()}
    check("pass: five texts heard once each, the one older than the ear left as history",
          said.get("heard") == 5 and said.get("before") == 1 and said.get("acted") == 0 and len(rows) == 5, said)
    check("ladder: a group text is not a reply", rows.get("AC_GROUP", ())[:2] == ("not_a_reply", "group"), rows)
    check("ladder: a chat is not a reply, its sender named", rows.get("AC_CHAT", ())[:4]
          == ("not_a_reply", "", "named", "Ana Tester"), rows)
    check("ladder: a stranger's YES does nothing", rows.get("AC_STRANGER", ())[:3]
          == ("unknown_sender", "unknown", "unknown"), rows)
    check("ladder: a shared line's YES does nothing", rows.get("AC_SHARED", ())[:3]
          == ("unknown_sender", "shared", "shared"), rows)
    check("ladder: a ref no shift carries is refused, and owes its acknowledgement", rows.get("AC_REF", ())
          == ("refused", "no_such_shift", "named", "Ana Tester", "sms_reply_refused", "call_off"), rows)
    again = sms_ears.listen(DSN, contacts=lambda: book)
    lanes_pg.finish()
    check("pass: nothing is heard twice", again.get("heard") == 0 and again.get("state") == "ok", again)

    OTHER = psycopg.connect(OWNER, autocommit=True)
    schema = TEST.execute("select current_schema()").fetchone()[0]
    key = int(__import__("hashlib").sha1(f"sms_ears|{schema}".encode()).hexdigest()[:8], 16) % (2 ** 31)
    free = OTHER.execute("select pg_try_advisory_lock(%s, %s)", (sms_ears.LOCK_NS, key)).fetchone()[0]
    OTHER.execute("select pg_advisory_unlock(%s, %s)", (sms_ears.LOCK_NS, key))
    check("lock: the pass lock is given back when the pass ends", free is True, (schema, free))

    # the acknowledgements, through the clock's own post, the door stood in for
    psi_reminders.quiet = lambda at: False
    asked: list = []

    async def door(app_id, action, payload):
        asked.append((app_id, action, payload))
        return {"status": 200, "data": {"results": [{"id": r["id"], "state": "told", "why": ""}
                                                    for r in payload.get("rows") or []],
                                        "dial": "send", "test_mode": "off"}}

    C.service_door = door

    async def post():
        await C.sms_replies_post()
        return await C.ear_run(sms_ears.owed, DSN)

    left = asyncio.run(post())
    sent = asked[0][2]["rows"] if asked else []
    check("acknowledgement: one row offered to staffShiftReminder, in the relay's shape",
          len(asked) == 1 and asked[0][:2] == ("staff-alerts", "staffShiftReminder") and len(sent) == 1
          and sent[0]["id"] == "SMS|AC_REF:sms_reply_refused" and sent[0]["kind"] == "sms_reply_refused"
          and sent[0]["person"] == "Ana Tester" and sent[0]["reply"] == "no open shift carries that reference",
          asked)
    said_col = TEST.execute("select said from asa_sms_replies where id='AC_REF'").fetchone()[0]
    check("acknowledgement: the door's answer written down, and nothing owed after it",
          left == [] and (said_col or {}).get("sms_reply_refused", {}).get("state") == "told", (left, said_col))

    # the clock's own pass, on its own thread: nothing new, and the connections left closed
    got = asyncio.run(C.ear_run(C._ear_pass))
    check("clock: a pass of the loop's own runs here and hears nothing new", got.get("heard") == 0, got)
    real = OTHER.execute("select count(*) from app.asa_sms_replies where id like 'AC\\_%%'").fetchone()[0]
    check("no real row: the real ledger holds none of the test's texts", real == 0, real)
except Exception:  # noqa: BLE001
    import traceback
    out["crashed"] = traceback.format_exc()[-2000:]
    fails.append("crashed")
print(json.dumps({"checks": len(out), "failed": fails, "out": out}, indent=1, default=str))
