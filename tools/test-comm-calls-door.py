"""The phone-call lane's webhook half in the app (app/comm_calls_door.py over app/comm_calls_feed.py and comm_seal.py):
the door registered only where the reading and the seal key are, its refusals in the relay's words, and one transcript
claimed, sealed, parked and handed to a stand-in of the comm-calls doors — on asa-hub-db's real engine with the ledger
as temp copies of app.comm_call_reads / comm_call_seals / comm_call_catchup, the old platform's own reading module
(its model call stood in for by a refusal, so no model is asked) and a throwaway certificate made for the run. Nothing
is written to a live table; nothing reaches a model, Quo or the relay.

Run inside asa-hub-db-sync by the in-process runner (openssl is there), the reading module handed in as the env file:

    RUNNER=$(mktemp -d) && cp tools/inprocess/run.sh tools/inprocess/drv.py "$RUNNER"/
    cp tools/test-comm-calls-door.py "$RUNNER/test_comm_calls_door.py"
    python3 -c 'import json,sys; json.dump({"COMM_CALLS_MODULE_SRC": open(sys.argv[1]).read()}, open(sys.argv[2], "w"))' \
        /opt/docker/the old platform/app/analytics/comm_calls.py "$RUNNER/env.json"
    sh "$RUNNER/run.sh" "$PWD/app" "$RUNNER/test_comm_calls_door.py" "@$RUNNER/env.json"
"""
import logging

logging.disable(logging.CRITICAL)
import asyncio  # noqa: E402
import json  # noqa: E402
import os  # noqa: E402
import shutil  # noqa: E402
import subprocess  # noqa: E402
import sys  # noqa: E402
import tempfile  # noqa: E402
import types  # noqa: E402

out: dict = {}
fails: list = []


def check(name, cond, got=None):
    out[name] = "ok" if cond else {"FAILED": got}
    if not cond:
        fails.append(name)


class _Resp:
    def __init__(self, content=None, status_code=200, headers=None, media_type=None):
        self.body = json.dumps(content).encode() if isinstance(content, (dict, list)) else (content or b"")
        self.status_code, self.headers = status_code, dict(headers or {})


class _App:
    def __init__(self):
        self.paths = []

    def post(self, path, **_kw):
        self.paths.append(path)
        return lambda f: f


_fa = types.ModuleType("fastapi")
_fa.Request = object
_fr = types.ModuleType("fastapi.responses")
_fr.Response = _fr.JSONResponse = _Resp
SD = types.ModuleType("service_doors")
SD.SERVICE_SECRET = "svc-check"


async def _body_of(request):
    try:
        got = json.loads(request.raw)
    except ValueError:
        return None
    return got if isinstance(got, dict) else None
SD.body_of = _body_of
SD.said = lambda env, status_code=200, headers=None: _Resp(env, status_code, headers)
dirty: list = []
LN = types.ModuleType("live_notify")
LN.dirty = lambda names: dirty.append(sorted(names))
# the comm-calls doors stood in for, as the clocks ask them in-process
handed: list = []
DOOR = {"ingest": "ok"}
CL = types.ModuleType("clocks")
CL.PACK_S = 60.0
CL.write_id = lambda tag: "Wcheck" + str(len(handed))
CL.void_soon = lambda app_id, wid: None


async def _lane():
    return {}
CL.config_lane = _lane
CL.ingest_hold = lambda action, lane: ""


async def _call(app_id, action, payload, wid="", wait=0.0):
    if action == "commCallsWho":
        return {"status": 200, "data": {"rows": [{"phone": p, "state": "unknown", "name": "", "why": "check"}
                                                 for p in payload.get("phones") or []]}}, ""
    handed.append({"action": action, "calls": len(payload.get("calls") or []),
                   "items": len(payload.get("items") or []), "wid": wid,
                   "words": "TRANSCRIPT-WORDS" in json.dumps(payload)})
    if DOOR["ingest"] == "held":
        return {"status": 409, "message": "the write lock is held"}, ""
    return {"status": 200, "data": {"kept_calls": len(payload.get("calls") or []),
                                    "kept_items": len(payload.get("items") or [])}}, ""
CL.call = _call
sys.modules.update({"fastapi": _fa, "fastapi.responses": _fr, "service_doors": SD, "live_notify": LN, "clocks": CL})


class Req:
    def __init__(self, body):
        self.raw = body if isinstance(body, bytes) else json.dumps(body).encode()


def door(body):
    async def go():
        r = await CD.transcript(Req(body))
        for t in list(CD._TASKS):
            await t
        return json.loads(r.body)
    return asyncio.run(go())


WORK = tempfile.mkdtemp(prefix="comm-calls-door-")
try:
    import psycopg
    from psycopg.rows import tuple_row

    import hubdb
    import lanes_pg

    MODULE = os.path.join(WORK, "comm_calls.py")
    os.environ["HUB_COMM_CALLS_MODULE"] = os.path.join(WORK, "absent.py")
    os.environ["COMM_SEAL_PUBLIC"] = os.path.join(WORK, "cert.pem")
    import comm_calls_feed as CCF
    import comm_seal
    import comm_calls_door as CD
    comm_seal.PUBLIC_PATHS[:] = [os.path.join(WORK, "cert.pem")]
    CCF.MODULE_PATHS[:] = [os.path.join(WORK, "absent.py")]

    a = _App()
    check("no reading here: the door is left to the relay", CD.install(a) is False and a.paths == [], a.paths)
    with open(MODULE, "w") as fh:
        fh.write(os.environ["COMM_CALLS_MODULE_SRC"])
    CCF.MODULE_PATHS[:] = [MODULE]
    ok, why = CD.ready()
    check("the reading here, no certificate: still left to the relay, and said why",
          ok is False and "certificate" in why, why)
    subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout",
                    os.path.join(WORK, "key.pem"), "-out", os.path.join(WORK, "cert.pem"), "-subj", "/CN=check",
                    "-days", "1"], check=True, capture_output=True)
    os.remove(os.path.join(WORK, "key.pem"))
    a = _App()
    check("the reading and the seal key here: the door is answered here",
          CD.install(a) is True and a.paths == ["/comm-calls/transcript"], a.paths)
    mod = CCF.reading()

    def refused_ask(*_a, **_k):
        raise mod.Refused("no model in the check")
    mod.ask = refused_ask

    test = psycopg.connect(hubdb._dsn(), autocommit=True, connect_timeout=5, application_name="comm-calls-door-check")
    for t in ("comm_call_reads", "comm_call_seals", "comm_call_catchup"):
        test.execute(f"CREATE TEMP TABLE {t} (LIKE app.{t} INCLUDING ALL)")
    test.execute("INSERT INTO pg_temp.comm_call_catchup (id, enabled) VALUES (1, false)")
    CCF.LEDGER, CCF.SEALS, CCF.CONTROL = "pg_temp.comm_call_reads", "pg_temp.comm_call_seals", "pg_temp.comm_call_catchup"
    lanes_pg.CONNECT["own"] = lanes_pg.CONNECT["spare"] = lambda: test

    def q(sql):
        return test.cursor(row_factory=tuple_row).execute(sql).fetchall()

    rec = {"call_id": "CHK-call-0001", "event_at": "2031-01-02T15:00:00Z", "duration_s": 61.4,
           "participants": "+13305550100", "team_members": "+13305550199", "direction": "incoming", "turns": 4,
           "full_transcript": "TRANSCRIPT-WORDS about a shift", "speaker_transcript": "A: TRANSCRIPT-WORDS"}
    got = door({"record": rec, "service_secret": "wrong"})
    check("a wrong service secret: 401", got == {"status": 401, "message": "service identity required"}, got)
    got = door({"service_secret": "svc-check"})
    check("no record: 400", got == {"status": 400, "message": "record with a call_id is required"}, got)
    got = door(b"not json")
    check("a body that is not JSON: 400", got == {"status": 400, "message": "invalid body"}, got)
    got = door({"record": {**rec, "full_transcript": ""}, "service_secret": "svc-check"})
    check("an event with no words is read as nothing", got == {
        "status": 200, "data": {"call_id": "CHK-call-0001", "read": 0, "why": "no words on the event"}}, got)
    got = door({"record": rec, "service_secret": "svc-check"})
    check("the lane's switch off: nothing read", got == {
        "status": 200, "data": {"call_id": "CHK-call-0001", "read": 0, "why": "the switch is off"}}
        and q("select count(*) from pg_temp.comm_call_reads") == [(0,)], got)
    test.execute("UPDATE pg_temp.comm_call_catchup SET enabled = true WHERE id = 1")
    got = door({"record": rec, "service_secret": "svc-check"})
    row = q("select state, facts is null, landed_at is not null, attempts from pg_temp.comm_call_reads")
    seals = q("select count(*), bool_and(position(convert_to('TRANSCRIPT-WORDS', 'UTF8') in ciphertext) = 0), "
              "bool_and(recipient_fpr <> '') from pg_temp.comm_call_seals")
    check("a transcript: accepted at once, then claimed, sealed and parked",
          got == {"status": 200, "data": {"call_id": "CHK-call-0001", "accepted": True}}
          and row and row[0][0] == "unreadable" and seals[0][0] >= 1 and seals[0][1] is True and seals[0][2] is True,
          (got, row, seals))
    check("handed to the comm-calls doors with a write id, the words never in the hand-over",
          [h["action"] for h in handed] == ["commCallsIngest"] and handed[0]["calls"] == 1
          and handed[0]["wid"].startswith("W") and handed[0]["words"] is False, handed)
    check("the door's counts prove it kept the call: landed, the clear facts dropped",
          row and row[0][1] is True and row[0][2] is True, row)
    check("the calls' slices told", ["commCalls", "commWorkItems"] in dirty, dirty)
    got = door({"record": rec, "service_secret": "svc-check"})
    check("the same call again: already read, delivered, never re-read",
          got == {"status": 200, "data": {"call_id": "CHK-call-0001", "read": 0, "already": "unreadable",
                                          "delivered": 0}}
          and q("select attempts from pg_temp.comm_call_reads") == [(1,)] and len(handed) == 1, got)
    DOOR["ingest"] = "held"
    got = door({"record": {**rec, "call_id": "CHK-call-0002"}, "service_secret": "svc-check"})
    parked = q("select state, facts is not null, landed_at is null from pg_temp.comm_call_reads "
               "where call_id = 'CHK-call-0002'")
    check("a held hand-over: the call stays parked with its facts, to be offered again",
          got.get("data", {}).get("accepted") is True and parked == [("unreadable", True, True)], (got, parked))
    test.close()
except Exception as exc:  # noqa: BLE001
    import traceback
    check("the test ran to the end", False, type(exc).__name__ + ": " + str(exc)[:300] + traceback.format_exc()[-800:])
finally:
    shutil.rmtree(WORK, ignore_errors=True)

print(json.dumps({"ok": not fails, "checks": len(out), "failed": fails, "out": out}, indent=1, default=str))
sys.exit(1 if fails else 0)
