"""The phone-call lane's webhook half (the relay's POST /comm-calls/transcript), answered here in its words: one
transcript, read now — claimed, read by the lane's reading (app/comm_calls_reading.py),
sealed, parked in asa-hub-db's ledger (app/comm_calls_feed.py) and handed to the comm-calls doors in-process. The answer
goes at once, the work after it. The Quo hand-off's kick posts here (clocks.QUO_CALLS_KICK_URL). The door registers only
where the reading and the seal key are both at hand; until then its path goes on to the relay."""
from __future__ import annotations

import asyncio
import hmac
import logging
import re
import time
from typing import Any, Callable

from fastapi import Request
from fastapi.responses import Response

import comm_calls_feed as CCF
import comm_seal
import live_notify
import service_doors as SD

log = logging.getLogger("asa-hub-app.comm-calls")

DSN = "asa-hub-db"
APP_ID = "comm-calls"
SLICES = ("commCalls", "commWorkItems")
PASSES = 30
_TASKS: set[asyncio.Task] = set()

# The webhook's record → the lane's row.
ROW_MAP = (
    ("call_id", ("call_id",)),
    ("event_timestamp", ("event_at", "transcript_created", "received_at")),
    ("duration_sec", ("duration_s", "duration_sec")),
    ("participant_s", ("participants", "participant_s")),
    ("team_member_s", ("team_members", "team_member_s")),
    ("direction", ("direction",)),
    ("turns", ("turns",)),
    ("full_transcript", ("full_transcript",)),
    ("speaker_transcript", ("speaker_transcript",)),
)


def call_row(record: dict) -> dict:
    """Blocking: the relay's _comm_calls_row — the record in the lane's names, the line named by its number."""
    row: dict[str, Any] = {}
    for lane_name, sources in ROW_MAP:
        for src in sources:
            value = record.get(src)
            if value not in (None, ""):
                row[lane_name] = value
                break
    if row.get("duration_sec") not in (None, ""):
        try:
            row["duration_sec"] = str(int(float(row["duration_sec"])))
        except (TypeError, ValueError):
            row["duration_sec"] = ""
    has_number = bool(re.search(r"\d{10}", re.sub(r"\D", "", str(row.get("team_member_s") or ""))))
    if not has_number and record.get("quo_number"):
        try:
            import lanes_db  # noqa: PLC0415
            with lanes_db.connect() as conn, conn.cursor() as cur:
                cur.execute("select number from app.asa_openphone_lines where id = %s",
                            (str(record["quo_number"]),))
                got = cur.fetchone()
            if got and got[0]:
                row["team_member_s"] = str(got[0])
        except Exception:  # noqa: BLE001 - no resolution is not a reason to lose the call
            pass
    row.setdefault("processed", "")
    row.setdefault("processedbyagent", "")
    row.setdefault("processingerror", "")
    row.setdefault("_row_number", 0)
    return row


def ledger_row(call_id: str) -> dict | None:
    """Blocking: the ledger's row for one call, or None — the idempotency check."""
    try:
        import lanes_pg  # noqa: PLC0415
        with CCF.hub_db.connect(DSN) as conn, conn.cursor(cursor_factory=lanes_pg.extras.RealDictCursor) as cur:
            cur.execute(f"select call_id, state, facts, landed_at from {CCF.LEDGER} where call_id = %s", (call_id,))
            got = cur.fetchone()
            return dict(got) if got else None
    except Exception:  # noqa: BLE001 - a database that will not answer reads as not read
        return None


async def python_post(body: dict) -> dict[str, Any]:
    """The relay's _comm_calls_python in-process: commCallsWho a read, the ingest kept pass by pass while it hands rows
    back; a held lock or no answer said as held, so the feed parks."""
    import clocks  # noqa: PLC0415 - the clocks' in-process door and gate

    action, payload = str(body.get("action") or ""), body.get("payload") or {}
    why = clocks.ingest_hold(action, await clocks.config_lane())
    if why:
        return {"status": 409, "message": why, "held": True}
    if action == "commCallsWho":
        env, unanswered = await clocks.call(APP_ID, action, payload, wait=clocks.PACK_S)
        return env if env is not None else {"status": 503, "message": unanswered}
    for _ in range(PASSES):
        wid = clocks.write_id("comm-calls")
        env, unanswered = await clocks.call(APP_ID, action, payload, wid, clocks.PACK_S)
        if env is None:
            clocks.void_soon(APP_ID, wid)
        if env is None or env.get("status") == 409:
            return {"status": 409, "held": True, "message": str((env or {}).get("message") or unanswered)}
        env = dict(env)
        env.pop("_write", None)
        if env.get("status") == 200:
            live_notify.dirty(list(SLICES))
        left = (env.get("data") or {}).pop("left", None) if isinstance(env.get("data"), dict) else None
        if not left:
            return env
        payload = left
    return {"status": 409, "held": True, "message": f"the hand-over outran its {PASSES} passes"}


def _poster(loop: asyncio.AbstractEventLoop) -> Callable[[dict], dict]:
    def post(body: dict) -> dict:
        return asyncio.run_coroutine_threadsafe(python_post(body), loop).result()
    return post


async def transcript(request: Request) -> Response:
    """One transcript, read now — the webhook's half of the lane."""
    body = await SD.body_of(request)
    if body is None:
        return SD.said({"status": 400, "message": "invalid body"})
    given = str(body.get("service_secret") or "")
    if not SD.SERVICE_SECRET or not hmac.compare_digest(given, SD.SERVICE_SECRET):
        log.warning("comm calls transcript: refused, bad or missing service secret")
        return SD.said({"status": 401, "message": "service identity required"})
    record = body.get("record")
    if not isinstance(record, dict) or not str(record.get("call_id") or ""):
        return SD.said({"status": 400, "message": "record with a call_id is required"})
    if not str(record.get("full_transcript") or ""):
        return SD.said({"status": 200, "data": {"call_id": record["call_id"], "read": 0,
                                                "why": "no words on the event"}})
    state = await asyncio.to_thread(CCF.ready, DSN)
    if not state["key"]:
        return SD.said({"status": 503, "message": "nothing may be read: " + "; ".join(state["why"])})
    if not state.get("enabled"):
        return SD.said({"status": 200, "data": {"call_id": record["call_id"], "read": 0, "why": "the switch is off"}})
    row = await asyncio.to_thread(call_row, record)
    call_id = str(row["call_id"])
    post = _poster(asyncio.get_running_loop())
    prior = await asyncio.to_thread(ledger_row, call_id)
    if prior and (prior.get("facts") or prior.get("landed_at")):
        log.info("comm calls transcript: %s already read (%s) — delivering", call_id, prior.get("state"))
        delivery = await asyncio.to_thread(CCF.deliver, DSN, post, say=lambda m: log.info("%s", m))
        return SD.said({"status": 200, "data": {"call_id": call_id, "read": 0, "already": prior.get("state"),
                                                "delivered": delivery.get("landed", 0)}})
    task = asyncio.get_running_loop().create_task(read_and_serve(row, post))
    _TASKS.add(task)
    task.add_done_callback(_TASKS.discard)
    return SD.said({"status": 200, "data": {"call_id": call_id, "accepted": True}})


async def read_and_serve(row: dict, post: Callable[[dict], dict]) -> None:
    """The background half of the webhook door: read, deliver, rebuild. Never raises."""
    call_id = str(row["call_id"])
    try:
        reading = await asyncio.to_thread(CCF.reading)
        if not reading.fits(len(str(row.get("full_transcript") or ""))):
            log.info("comm calls transcript: %s too long for this door — the mirror pass files it", call_id)
            return

        def read() -> dict | None:
            whois = CCF.who([reading.caller_digits(row.get("participant_s"))], post)
            return CCF.read_one(DSN, row, whois, f"wh{int(time.time())}")

        got = await asyncio.to_thread(read)
        if got is None:
            log.info("comm calls transcript: %s was claimed by another worker", call_id)
        else:
            log.info("comm calls transcript: %s read on the webhook (%s, %d item(s))", call_id, got["state"],
                     len(got["items"]))
        await asyncio.to_thread(CCF.deliver, DSN, post, say=lambda m: log.info("%s", m))
        live_notify.dirty(list(SLICES))
    except Exception as exc:  # noqa: BLE001 - the mirror pass is the safety net
        log.warning("comm calls transcript: background pass failed for %s (%s: %s)", call_id, type(exc).__name__,
                    str(exc)[:160])


# the relay's _comm_calls_tick: said rarely while it cannot read, and with the reason
COMM_CALLS_SAY_S = 6 * 3600.0
_LIVE: dict[str, Any] = {"said": 0.0, "failures": 0}


def _say_rarely(level: int, msg: str, *args: Any) -> None:
    if time.time() - _LIVE["said"] > COMM_CALLS_SAY_S:
        _LIVE["said"] = time.time()
        log.log(level, msg, *args)


async def live_tick() -> None:
    """The arriving calls, the live half of the transcript lane (the relay's _comm_calls_tick), on the staff beat's
    hour (clocks.sweep_loop): the pile read off asa-hub-db's Transcripts copy, inert until the seal key is here and
    the switch is on."""
    state = await asyncio.to_thread(CCF.ready, DSN)
    if not (state.get("key") and state.get("tables") and state.get("enabled")):
        _say_rarely(logging.INFO, "comm calls: not reading — %s", "; ".join(state.get("why") or ["off"]))
        return
    post = _poster(asyncio.get_running_loop())
    try:
        got = await asyncio.to_thread(CCF.live, DSN, post, lambda _m: None)
    except CCF.LaneUnavailable as exc:
        # not a failure streak
        _say_rarely(logging.WARNING, "comm calls: %s", str(exc)[:200])
        return
    except Exception as exc:  # noqa: BLE001
        _LIVE["failures"] += 1
        log.warning("comm calls: the pass failed (%sx in a row): %s", _LIVE["failures"], type(exc).__name__)
        return
    _LIVE["failures"] = 0
    if got.get("stopped"):
        log.info("comm calls: stopped mid-pass — %s", got["stopped"])
    if not (got.get("read") or got.get("unreadable") or got.get("landed")) and not _LIVE.get("ran"):
        # the first pass after a start says itself even when nothing was new
        log.info("comm calls: the hourly pass ran — nothing new to read (%s parked)", got.get("parked") or 0)
    _LIVE["ran"] = True
    if got.get("read") or got.get("unreadable") or got.get("landed"):
        live_notify.dirty(list(SLICES))
        # every zero has a name here
        log.info("comm calls: %s read, %s unreadable, %s matter(s), %s call(s) landed%s", got.get("read"),
                 got.get("unreadable"), got.get("items"), got.get("landed"),
                 " · %s coerced category(ies)" % got["coerced"] if got.get("coerced") else "")


def ready() -> tuple[bool, str]:
    """(registered, why not): the service secret, the reading and the seal key all here."""
    if not SD.SERVICE_SECRET:
        return False, "no HUB_SERVICE_SECRET"
    try:
        CCF.reading()
    except Exception as exc:  # noqa: BLE001 - said in the startup line
        return False, str(exc)[:200]
    try:
        if not comm_seal.available():
            return False, "the keyholder's public certificate is not on this machine"
    except Exception as exc:  # noqa: BLE001
        return False, f"the seal key could not be read ({type(exc).__name__})"
    return True, ""


def install(app: Any) -> bool:
    """The transcript door on main.py's app, before the relay carrier, when it can read and seal here."""
    ok, why = ready()
    if ok:
        app.post("/comm-calls/transcript", include_in_schema=False)(transcript)
        log.info("comm calls: the transcript door answered here")
    else:
        log.info("comm calls: the transcript door left to the relay — %s", why)
    return ok
