"""The company notices' clock, the relay's (server/snapshot_service.py _notices_loop, _notice_fan, _web_beat), in the
app: every minute and on a wake, each event without a notice yet is published (web_notices.catch_up); each stored
notice (published here, or by the relay's own clocks and handed here at POST /live/wake) is carried to the people
online as one frame per reader on their chat streams (app/chat_doors.py), and pushed (web_push) to the accounts it must
interrupt, judged from who is online here. The beat logs a move of the switch, judges the held and the failed pushes
again, and hands test mode's mockup rows (web_gate) to the mock outbox (commMockWebIngest, in-process).

Test mode is the config lane's (live_slices.lane_for, web_gate.switch_from), anything unreadable or stale ON: while it
holds nobody is shown a notice or pushed one, each is written for the mockup instead, and a notice stored under it
stays held. A kind is stored only while its own Smart Comms situation (web_notice_<kind>) is on. A reader is the
Requests lanes' (shift_requests.viewer), the alerts it turned off obeyed; a switched tab never counts as its account
online. HUB_APP_CLOCKS=off starts none of it."""
from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import os
import re
import time
from datetime import datetime, timezone
from typing import Any, AsyncIterator
from zoneinfo import ZoneInfo

from fastapi import Request
from fastapi.responses import Response

import chat_doors
import lanes_pg
import live_events
import live_notify
import live_slices
import scope as sc
import web_gate
import web_notices
import web_push

log = logging.getLogger("asa-hub-app.notices")

NOTICES_EVERY_S = float(os.getenv("HUB_NOTICES_EVERY_S", "60"))
NOTICES_FIRST_S = float(os.getenv("HUB_NOTICES_FIRST_S", "45"))
NOTICE_VIEWER_TTL_S = float(os.getenv("HUB_NOTICE_VIEWER_TTL_S", "120"))
WEB_MOCK_EVERY_S = float(os.getenv("HUB_WEB_MOCK_EVERY_S", "120"))
# how long a door that refused the last batch is left alone before it is asked again
WEB_MOCK_BACKOFF_S = float(os.getenv("HUB_WEB_MOCK_BACKOFF_S", "1800"))
RELEASE_EVERY_S = 30.0
WHO_TTL_S = 12 * 3600.0
# the roles a shift notice can be for
NOTICE_ACCOUNT_ROLES = ("staff", "manager", "admin", "director")
NOTICE_PREFIX = "web_notice_"
LANE_FRESH_S = web_gate.LANE_FRESH_S
COMM_MOCK_APP = "comm-mock"
MY_INBOX_EVENT = "my-inbox"
WAKE_PATH = "/live/wake"
NEW_YORK = ZoneInfo("America/New_York")

# uid -> (at, role, master flag) of a session seen for the account; uid -> (at, reader), held briefly for bursts
_WHO: dict[str, tuple[float, str, bool | None]] = {}
_VIEWERS: dict[str, tuple[float, dict[str, Any]]] = {}
_ACCOUNTS: dict[str, Any] = {"at": 0.0, "rows": None}
_SAID: dict[str, Any] = {"switch": None, "no_key": 0.0, "mock_last": 0.0, "mock_said": 0.0, "rotated": 0.0,
                         "released": 0.0, "roster_on": None, "mock_refused": False}
_LOOP: list[Any] = [None]
_EVT: list[asyncio.Event | None] = [None]
_TASKS: set[asyncio.Task] = set()


def _SL() -> Any:
    import sched_lanes  # noqa: PLC0415 - the Requests lanes' threads, reader and roster tell
    return sched_lanes


async def _run(fn: Any, *args: Any, **kwargs: Any) -> Any:
    """Blocking work on the lanes' own threads and connections."""
    return await _SL()._run(fn, *args, **kwargs)  # noqa: SLF001


def _spawn(coro: Any) -> asyncio.Task:
    task = asyncio.ensure_future(coro)
    _TASKS.add(task)
    task.add_done_callback(_TASKS.discard)
    return task


# ---- who is reading ------------------------------------------------------------------------------------------------

def seen(uid: str, role: str, is_master: bool | None) -> None:
    """The role and the master flag a session of this account carried (_notice_who_put)."""
    if not uid:
        return
    _WHO[uid] = (time.time(), str(role or ""), is_master)
    if len(_WHO) > 4000:  # a long-lived process, not a leak
        cutoff = time.time() - WHO_TTL_S
        for u, (at, _r, _m) in list(_WHO.items()):
            if at < cutoff:
                _WHO.pop(u, None)


def _stream_opened(sub: Any, s: Any) -> None:
    seen(sub.uid, s.role, bool(s.is_master))


def lane() -> dict[str, Any] | None:
    return live_slices.lane_for("")


def switch() -> dict[str, Any]:
    """_web_switch: the resolved test mode off the config lane; anything missing or old reads as ON."""
    return web_gate.switch_from(lane())


def _stale(got: dict[str, Any]) -> str:
    """lane_gate._stale: why the lane may not be read as current, or ''."""
    raw = got.get("built_at")
    try:
        built = raw if isinstance(raw, datetime) else datetime.fromisoformat(str(raw or "").replace("Z", "+00:00"))
    except ValueError:
        return "the configuration the relay holds says nothing of when it was read"
    if built.tzinfo is None:
        built = built.replace(tzinfo=NEW_YORK)
    age = (datetime.now(timezone.utc) - built).total_seconds()
    if age > LANE_FRESH_S:
        return f"the configuration the relay holds is {int(age // 60)} minutes old"
    return ""


def notice_state(kind: str) -> dict[str, Any]:
    """lane_gate.notice_state: {armed, unreadable, why} for one company notice kind, its own Smart Comms situation."""
    sid = NOTICE_PREFIX + str(kind or "")
    got = lane()
    if not isinstance(got, dict):
        why = "the relay has not read the platform's configuration yet"
        return {"armed": False, "unreadable": why, "why": why}
    stale = _stale(got)
    if stale:
        return {"armed": False, "unreadable": stale, "why": stale}
    said = got.get("notice_situations_unreadable")
    if said:
        why = f"the platform could not read the situations tab ({str(said)[:120]})"
        return {"armed": False, "unreadable": why, "why": why}
    switches = got.get("notice_situations")
    if switches is None:
        return {"armed": False, "unreadable": "",
                "why": f"the engine carries no switch for {sid} yet, and a new message arrives off"}
    if not isinstance(switches, dict):
        why = "the notice switches came back in a shape nothing here reads"
        return {"armed": False, "unreadable": why, "why": why}
    if switches.get(sid) is True:
        return {"armed": True, "unreadable": "", "why": ""}
    return {"armed": False, "unreadable": "", "why": f"the situation {sid} is switched off in Smart Comms"}


def _alerts_off(uid: str) -> list[str]:
    """_lane_alerts_off, FAIL-OPEN: the alerts this account turned off for itself (Settings > Alerts I receive)."""
    raw = (lane() or {}).get("alert_receive_off")
    got = raw.get(str(uid or "").strip()) if isinstance(raw, dict) and str(uid or "").strip() else None
    if not isinstance(got, list):
        return []
    return sorted({str(x).strip() for x in got if str(x or "").strip()})


def _reader(uid: str, role: str, types: str, is_master: bool | None) -> dict[str, Any]:
    import shift_requests  # noqa: PLC0415 - heavy, and only asked here
    SL = _SL()
    # an unreadable name raises rather than reading as on no roster
    who = shift_requests.viewer(SL.PG_DSN, name=SL._roster_name_of(uid, strict=True), role=role,  # noqa: SLF001
                                types=types, is_master=is_master)
    who["alerts_off"] = _alerts_off(uid)
    _VIEWERS[uid] = (time.time(), who)
    return who


def _notice_viewer(uid: str) -> dict[str, Any] | None:
    """The reader behind a stream, or None when no session was seen for them. Worker thread."""
    held = _VIEWERS.get(uid)
    if held and time.time() - held[0] < NOTICE_VIEWER_TTL_S:
        return held[1]
    got = _WHO.get(uid)
    if not got:
        return None
    return _reader(uid, got[1], _SL()._user_badges(uid), got[2])  # noqa: SLF001


def _notice_accounts() -> list[dict[str, str]]:
    """Every active account a notice could be for, off asa-hub-db's users copy; raises when it is empty or unread."""
    held = _ACCOUNTS.get("rows")
    if held is not None and time.time() - float(_ACCOUNTS["at"]) < NOTICE_VIEWER_TTL_S:
        return held
    import lanes_sheets  # noqa: PLC0415
    SL = _SL()
    text = lanes_sheets.text
    rows = [r for r in lanes_sheets.data(SL.HUB_DB_SHEET_ID, "users") if isinstance(r, dict)]
    if not rows:
        raise RuntimeError("the users copy holds no rows")
    out = []
    for r in rows:
        uid = text(r.get("user_id")).strip()
        role = text(r.get("role")).strip().lower()
        if not uid or role not in NOTICE_ACCOUNT_ROLES:
            continue
        if text(r.get("active")).strip().upper() in ("FALSE", "0", "NO"):
            continue
        out.append({"uid": uid, "role": role, "types": text(r.get("types")),
                    "label": text(r.get("display_name")).strip() or uid,
                    "unlisted": "1" if sc.is_master_email(r.get("email")) else ""})
    _ACCOUNTS.update({"at": time.time(), "rows": out})
    return out


def _account_viewer(acc: dict[str, str]) -> dict[str, Any]:
    """The reader behind an account, built as a session's is."""
    uid = acc["uid"]
    held = _VIEWERS.get(uid)
    if held and time.time() - held[0] < NOTICE_VIEWER_TTL_S:
        return held[1]
    got = _WHO.get(uid)
    return _reader(uid, got[1] if got and got[1] else acc["role"], acc["types"], got[2] if got else None)


# ---- the frames ----------------------------------------------------------------------------------------------------

def _online() -> list[str]:
    """The accounts with a notice-reading stream open here; a switched tab never counts as its account online."""
    return [uid for uid, subs in list(chat_doors._subs.items())  # noqa: SLF001
            if any(q.notices and not q.switched for q in list(subs))]


def _publish_frame(uid: str, payload: str) -> int:
    """Hand a notice to this person's notice-reading tabs; how many took it. On the loop."""
    took = 0
    for q in list(chat_doors._subs.get(uid) or ()):  # noqa: SLF001
        if not q.notices:
            continue
        try:
            q.put_nowait(payload)
            took += 1
        except asyncio.QueueFull:
            pass
    return took


def _frames(notice: dict[str, Any], uids: list[str]) -> list[tuple[str, str]]:
    """(uid, frame) for every online reader this notice is for. Worker thread."""
    readers: list[tuple[str, dict[str, Any]]] = []
    for uid in uids:
        try:
            who = _notice_viewer(uid)
        except Exception as exc:  # noqa: BLE001 - one account's lookup never silences the rest
            log.warning("notices: the reader %s could not be resolved (%s)", uid, type(exc).__name__)
            continue
        if who is not None:
            readers.append((uid, who))
    if not readers:
        return []
    shaped = web_notices.for_viewers(_SL().PG_DSN, notice, [w for _, w in readers])
    return [(uid, json.dumps({"kind": "notice", "notice": s}, separators=(",", ":"), default=str))
            for (uid, _), s in zip(readers, shaped) if s]


# ---- test mode's hold and the pushes -------------------------------------------------------------------------------

def _judged(notice: dict[str, Any], accounts: list[dict[str, str]]) -> list[tuple[dict[str, str], Any]]:
    """(account, copy | Unjudged | None) per account; an unbuildable reader is Unjudged, never "not theirs"."""
    readers: list[tuple[dict[str, str], dict[str, Any]]] = []
    unjudged: list[tuple[dict[str, str], Any]] = []
    for acc in accounts:
        try:
            readers.append((acc, _account_viewer(acc)))
        except Exception as exc:  # noqa: BLE001 - named below, not dropped
            unjudged.append((acc, web_notices.Unjudged(f"the reader could not be read ({type(exc).__name__})")))
    shaped = web_notices.for_viewers(_SL().PG_DSN, notice, [w for _, w in readers]) if readers else []
    return [(acc, s) for (acc, _), s in zip(readers, shaped)] + unjudged


def _unjudged_rows(channel: str, notice: dict[str, Any], unjudged: list[tuple[dict[str, str], Any]],
                   sw: dict[str, Any], held_by: str, reason: str) -> list[dict[str, Any]]:
    """The mock row naming the unjudged accounts."""
    if not unjudged:
        return []
    why = "; ".join(sorted({str(getattr(s, "why", "") or "a read failed") for _, s in unjudged}))
    stand_in = {"role": "unjudged", "title": f"{notice.get('kind')} — whether these accounts hear it "
                                              "could not be answered", "body": why}
    return web_gate.mock_rows(channel, notice, [(acc["label"], stand_in) for acc, _ in unjudged],
                              result="unjudged", held_by=held_by, reason=reason, switch=sw)


def _hold(notice: dict[str, Any], sw: dict[str, Any], live: set[str]) -> dict[str, Any]:
    """Test mode on (worker thread): mock rows per wording for the bell and the pushes; the row is the delivery."""
    PG = _SL().PG_DSN
    judged = _judged(notice, _notice_accounts())
    heard = [(acc, s) for acc, s in judged if s]
    unjudged = [(acc, s) for acc, s in judged if isinstance(s, web_notices.Unjudged)]
    held_by = web_gate.held_by_test(sw)
    rows = web_gate.mock_rows(
        web_gate.CH_NOTICE, notice, [(acc["label"], s) for acc, s in heard],
        result="held", held_by=held_by, switch=sw,
        reason=("test mode is on — nobody was shown this notice: no stream frame, no bell row, "
                "no operating-system notification, and not afterwards either"
                + (f" ({sw['why']})" if sw.get("why") else "")))
    rows += _unjudged_rows(web_gate.CH_NOTICE, notice, unjudged, sw, held_by,
                           "test mode is on, and whether these accounts would have heard it could not "
                           "be answered — a read under the question failed")
    devs = web_push.devices(PG)
    label = {acc["uid"]: acc["label"] for acc, _ in heard}
    wanted = [(acc["uid"], s) for acc, s in heard
              if acc["uid"] in devs and web_push.wants_push({**s, "held": False}, live=acc["uid"] in live)]
    got = web_push.deliver(PG, notice, wanted, switch=sw, devs=devs)
    pushed = got["by_state"].get(web_push.S_HELD_TEST) or []
    rows += web_gate.mock_rows(
        web_gate.CH_PUSH, notice, [(label.get(uid, uid), s) for uid, s in pushed],
        result="held", held_by=held_by, switch=sw,
        reason="test mode is on — no push left the platform, and none will: this row is its only delivery")
    kept = web_gate.record(rows)
    return {"readers": len(heard), "devices": len(pushed), "rows": kept["added"], "unjudged": len(unjudged)}


def _push_mock(notice: dict[str, Any], by_state: dict[str, list], sw: dict[str, Any],
               label: dict[str, str], *, released: bool = False) -> list[dict[str, Any]]:
    """Mock rows for decided pushes: sent, held for the night, or refused."""
    rows: list[dict[str, Any]] = []
    how = {
        web_push.S_SENT: ("sent", "", "pushed to the person's device(s)"
                          + (" once the hold ended, still true" if released else "")),
        web_push.S_HELD_QUIET: ("held_quiet", f"held: the quiet window ({web_gate.quiet_words()})",
                                "looked at again from 08:00, and pushed only if still true"),
        web_push.S_FAILED: ("failed", "the push service", "no device took it; tried again while still true"),
    }
    for state, (result, held_by, reason) in how.items():
        got = by_state.get(state) or []
        if got:
            rows += web_gate.mock_rows(web_gate.CH_PUSH, notice,
                                       [(label.get(item[0], item[0]), item[1]) for item in got],
                                       result=result, held_by=held_by, reason=reason, switch=sw)
    return rows


def _push(notice: dict[str, Any], live: set[str], sw: dict[str, Any]) -> dict[str, Any]:
    """Test mode off (worker thread): push to the people it must interrupt; outcome by state, or `why`."""
    PG = _SL().PG_DSN
    vapid = web_push.keys()
    if not vapid.get("ok"):
        return {"why": vapid.get("why") or "no VAPID keys"}
    devs = web_push.devices(PG)
    if not devs:
        return {}
    accounts = [acc for acc in _notice_accounts() if acc["uid"] in devs]
    if not accounts:
        return {}
    judged = _judged(notice, accounts)
    wanted = [(acc["uid"], s) for acc, s in judged if web_push.wants_push(s, live=acc["uid"] in live)]
    # an unjudged push is a `failed` row the release beat asks about again
    unjudged = [(acc, s) for acc, s in judged if isinstance(s, web_notices.Unjudged)]
    label = {acc["uid"]: acc["label"] for acc in accounts}
    out: dict[str, Any] = {}
    if unjudged:
        deferred = web_push.defer(PG, notice, [(acc["uid"], s.why) for acc, s in unjudged])
        web_gate.record(_unjudged_rows(
            web_gate.CH_PUSH, notice, [(acc, s) for acc, s in unjudged if acc["uid"] in deferred],
            sw, "", "whether this push is owed could not be answered — asked again on the next beat"))
        out["unjudged"] = len(deferred)
    if not wanted:
        return out
    got = web_push.deliver(PG, notice, wanted, switch=sw, vapid=vapid, devs=devs, switch_fn=switch)
    web_gate.record(_push_mock(notice, got["by_state"], sw, label))
    out.update({k: len(v) for k, v in got["by_state"].items()})
    return out


def _release(sw: dict[str, Any]) -> dict[str, Any]:
    """The held and the failed pushes, judged again now. Worker thread."""
    PG = _SL().PG_DSN
    by_uid = {acc["uid"]: acc for acc in _notice_accounts()}

    def judge(notice: dict[str, Any], uid: str) -> dict[str, Any] | None:
        acc = by_uid.get(uid)
        if acc is None:
            return None  # the account is gone or no longer active
        copy = web_notices.for_viewers(PG, notice, [_account_viewer(acc)])[0]
        if isinstance(copy, web_notices.Unjudged):
            # raised: waiting, asked again next beat
            raise RuntimeError(copy.why)
        return copy

    got = web_push.release(PG, switch=sw, judge=judge, switch_fn=switch)
    label = {uid: acc["label"] for uid, acc in by_uid.items()}
    per_notice: dict[int, tuple[dict[str, Any], dict[str, list]]] = {}
    for state, items in got["by_state"].items():
        for uid, copy, notice in items:
            per_notice.setdefault(int(notice["id"]), (notice, {}))[1].setdefault(state, []).append((uid, copy))
    rows: list[dict[str, Any]] = []
    for notice, by_state in per_notice.values():
        rows += _push_mock(notice, by_state, sw, label, released=True)
    if rows:
        web_gate.record(rows)
    return {"sent": len(got["by_state"].get(web_push.S_SENT) or []),
            "failed": len(got["by_state"].get(web_push.S_FAILED) or []),
            "expired": len(got["expired"]), "waiting": got["waiting"], "why": got["why"]}


# ---- one notice, carried -------------------------------------------------------------------------------------------

async def fan(notice: dict[str, Any]) -> None:
    """One stored notice: held for the mockup while test mode is on; else a frame to each reader online, then the
    pushes."""
    online = _online()
    sw = switch()
    if not sw["on"] and notice.get("held"):
        # stored under test mode: held regardless of the switch now
        sw = {**sw, "on": True, "why": "it was stored while test mode was on"}
    if sw["on"]:
        # NOTHING REACHES A PERSON: no frame, and the pushes are held
        try:
            said = await _run(_hold, notice, sw, set(online))
        except Exception as exc:  # noqa: BLE001 - still nobody is told; the log says the mockup missed it
            log.warning("notices: %s was held (test mode) but its mockup rows could not be written (%s)",
                        notice.get("key"), type(exc).__name__)
            return
        log.info("notices: %s held — test mode; %s reader(s) and %s device(s) written for the mockup "
                 "(%s row(s))%s", notice.get("key"), said["readers"], said["devices"], said["rows"],
                 f"; {said['unjudged']} account(s) could not be judged" if said.get("unjudged") else "")
        return
    if online:
        try:
            frames = await _run(_frames, notice, online)
        except Exception as exc:  # noqa: BLE001 - the bell still holds it
            log.warning("notices: %s could not be shaped for the people online (%s)",
                        notice.get("key"), type(exc).__name__)
            frames = []
        reached = sum(1 for uid, frame in frames if _publish_frame(uid, frame))
        if frames:
            log.info("notices: %s reached %s of %s people online (%s it was for)",
                     notice.get("key"), reached, len(online), len(frames))
    try:
        pushed = await _run(_push, notice, set(online), sw)
    except Exception as exc:  # noqa: BLE001 - the bell holds it; the push outbox never claimed it
        log.warning("web push: %s could not be pushed (%s)", notice.get("key"), type(exc).__name__)
        return
    if pushed.get("why"):
        if time.time() - float(_SAID["no_key"]) > 3600:
            _SAID["no_key"] = time.time()
            log.warning("web push: nothing is pushed — %s", pushed["why"])
    elif pushed:
        log.info("web push: %s — %s", notice.get("key"),
                 ", ".join(f"{n} {state}" for state, n in sorted(pushed.items())))


def _fanout(notice: dict[str, Any]) -> None:
    """web_notices' listener (the publishing thread): the notice handed to the loop; My Inbox read again."""
    loop = _LOOP[0]
    if loop is None:
        return
    try:
        loop.call_soon_threadsafe(lambda: _spawn(fan(notice)))
    except RuntimeError:
        return
    live_notify.dirty([MY_INBOX_EVENT])


def _stored(ids: list[int]) -> list[dict[str, Any]]:
    """The notices the relay's own clocks stored, read back by id. Worker thread."""
    PG = _SL().PG_DSN
    with web_notices._connect(PG) as conn, conn.cursor(cursor_factory=lanes_pg.RealDictCursor) as cur:  # noqa: SLF001
        web_notices._ensure(cur, PG)  # noqa: SLF001
        cur.execute("SELECT id, key, kind, at, location, col_iso, ref, value, facts, created_at, held_test "
                    "FROM asa_hub_notices WHERE id = ANY(%s) ORDER BY id", (ids,))
        rows = [dict(r) for r in cur.fetchall()]
        conn.commit()
    return [web_notices._row_notice(r) for r in rows]  # noqa: SLF001


async def _carry(ids: list[int]) -> None:
    try:
        notices = await _run(_stored, ids)
    except Exception as exc:  # noqa: BLE001 - the bell still holds them
        log.warning("notices: %s notice(s) the relay stored could not be read back (%s)", len(ids),
                    type(exc).__name__)
        return
    for notice in notices:
        with web_notices._SEEN_LOCK:  # noqa: SLF001
            web_notices._SEEN.add(notice["key"])  # noqa: SLF001
        await fan(notice)


# ---- the beat ------------------------------------------------------------------------------------------------------

async def _ingest(rows: list[dict[str, Any]]) -> dict[str, Any]:
    """commMockWebIngest in-process, as the relay's _backend_pass asked it; a 503 saying why when it gave no answer."""
    import clocks  # noqa: PLC0415 - main.py's doors as the relay's identity
    wid = clocks.write_id(COMM_MOCK_APP)
    env, why = await clocks.call(COMM_MOCK_APP, "commMockWebIngest", {"rows": rows}, wid, wait=clocks.PACK_S)
    if env is None:
        clocks.void_soon(COMM_MOCK_APP, wid)
        return {"status": 503, "message": f"Python did not answer ({why})"}
    return env


async def _mock_handoff() -> None:
    """Hand waiting mock rows to commMockWebIngest; a row is handed only when the door names it written."""
    now = time.time()
    if now - float(_SAID["rotated"]) > 3600:
        _SAID["rotated"] = now
        try:
            await _run(web_gate.rotate)
        except Exception as exc:  # noqa: BLE001 - the files stay as they are
            log.warning("web mock: the finished days could not be zipped (%s)", type(exc).__name__)
    # back off after a refused batch
    wait = WEB_MOCK_EVERY_S if not _SAID.get("mock_refused") else WEB_MOCK_BACKOFF_S
    if now - float(_SAID["mock_last"]) < wait:
        return
    try:
        rows = await _run(web_gate.pending)
    except Exception as exc:  # noqa: BLE001
        log.warning("web mock: the kept rows could not be read (%s)", type(exc).__name__)
        return
    if not rows:
        return
    _SAID["mock_last"] = now
    try:
        env = await _ingest(rows)
    except Exception as exc:  # noqa: BLE001 - the rows stay on the disk
        env = {"status": 0, "message": f"the door could not be reached ({type(exc).__name__})"}
    try:
        said = await _run(web_gate.after_handoff, env, [str(r["id"]) for r in rows])
    except Exception as exc:  # noqa: BLE001
        log.warning("web mock: the answer could not be written down (%s)", type(exc).__name__)
        return
    if said["handed"]:
        log.info("web mock: %s row(s) taken by the sheet, %s not taken", said["handed"], said["refused"])
    _SAID["mock_refused"] = not said["ok"]
    if not said["ok"] and now - float(_SAID["mock_said"]) > 1800:
        _SAID["mock_said"] = now
        waiting = await _run(web_gate.waiting_count)
        log.warning("web mock: %s row(s) wait on the disk — the sheet did not take them (%s)", waiting, said["why"])


async def beat() -> None:
    """Once a minute: log switch moves, release held pushes, hand on the mock rows."""
    sw = switch()
    # a switch move re-reads every shift reader now (held cells are laid only while it holds)
    was_on = _SAID.get("roster_on")
    _SAID["roster_on"] = bool(sw["on"])
    if was_on is not None and was_on != bool(sw["on"]):
        SL = _SL()
        SL._roster_published({"location": "every house", "cells": [], "actor": "the switch",  # noqa: SLF001
                              "via": "test mode " + ("on — held cells laid" if sw["on"]
                                                     else "off — held cells no longer laid")})
        SL._housecal_rang()  # noqa: SLF001
    # logged on change, digits folded so an ageing lane does not log every minute
    word = (sw["on"], sw.get("readable"), re.sub(r"\d+", "N", str(sw.get("why") or "")))
    if word != _SAID["switch"]:
        _SAID["switch"] = word
        if sw["on"]:
            log.warning("notices: test mode is ON%s — nothing reaches a person: no notice frame, "
                        "every bell answers held, no push; each notice is written for the mockup",
                        f" ({sw['why']})" if sw.get("why") else "")
        else:
            log.info("notices: test mode is off — notices and pushes deliver")
    if time.time() - float(_SAID.get("released") or 0) >= RELEASE_EVERY_S:
        _SAID["released"] = time.time()
        try:
            said = await _run(_release, sw)
            if said["sent"] or said["failed"] or said["expired"]:
                log.info("web push: released — %s sent, %s failed, %s no longer true",
                         said["sent"], said["failed"], said["expired"])
        except Exception as exc:  # noqa: BLE001 - the held rows wait for the next beat
            log.warning("web push: the held pushes could not be looked at (%s)", type(exc).__name__)
    await _mock_handoff()


def wake() -> None:
    """Run the catch-up now; any thread, a burst is one run."""
    loop, evt = _LOOP[0], _EVT[0]
    if loop is None or evt is None:
        return
    try:
        loop.call_soon_threadsafe(evt.set)
    except RuntimeError:
        pass


async def loop() -> None:
    """Publish every event without a notice yet, each minute and on a wake; then the beat."""
    evt = _EVT[0] = asyncio.Event()
    await asyncio.sleep(NOTICES_FIRST_S)
    while True:
        try:
            said = await _run(web_notices.catch_up, _SL().PG_DSN)
            if said.get("published") or said.get("failed") or said.get("unreadable"):
                log.info("notices: %s published %s, %s could not be stored%s",
                         said.get("published"), said.get("by_kind") or {}, said.get("failed"),
                         (" — could not read " + "; ".join(said["unreadable"])) if said.get("unreadable") else "")
        except Exception as exc:  # noqa: BLE001 - this minute is lost, the next one is not
            log.warning("notices: the catch-up failed (%s)", type(exc).__name__)
        # its own try, so a failed hand-over never costs the next catch-up
        try:
            await beat()
        except Exception as exc:  # noqa: BLE001
            log.warning("notices: the web beat failed (%s)", type(exc).__name__)
        with contextlib.suppress(asyncio.TimeoutError):
            await asyncio.wait_for(evt.wait(), timeout=NOTICES_EVERY_S)
        evt.clear()


# ---- the relay's door ----------------------------------------------------------------------------------------------

async def live_wake(request: Request) -> Response:
    """POST /live/wake — the relay's, with its X-Hub-Token: {wake: ["notices"]} runs the catch-up now, {notice_ids}
    carries the notices its own clocks stored."""
    if not live_events.authorized(request):
        return Response(status_code=401)
    try:
        body = json.loads(await request.body() or b"{}")
    except ValueError:
        return Response(status_code=400)
    if not isinstance(body, dict):
        return Response(status_code=400)
    if "notices" in (body.get("wake") or []):
        wake()
    ids = sorted({int(i) for i in body.get("notice_ids") or [] if str(i).isdigit()})
    if ids and _LOOP[0] is not None:
        _spawn(_carry(ids))
    return Response(status_code=204)


# ---- the wiring ----------------------------------------------------------------------------------------------------

def start() -> None:
    import clocks  # noqa: PLC0415
    _LOOP[0] = asyncio.get_running_loop()
    if not clocks.ON:
        log.warning("notices: HUB_APP_CLOCKS is off — no notice is published, carried or pushed here")
        return
    _spawn(loop())
    log.info("notices: the catch-up (%ss), the frames, the pushes and the mock hand-off started",
             int(NOTICES_EVERY_S))


async def stop() -> None:
    tasks = list(_TASKS)
    for task in tasks:
        task.cancel()
    for task in tasks:
        with contextlib.suppress(asyncio.CancelledError, Exception):
            await task
    _LOOP[0] = None


def install(app: Any) -> None:
    """POST /live/wake, the notices' listener and switches, and the clock in the app's lifespan."""
    app.post(WAKE_PATH)(live_wake)
    web_notices.on_publish(_fanout)
    # the switch is read when a notice is stored, and each kind's own situation
    web_notices.set_hold_probe(lambda: bool(switch().get("on")))
    web_notices.set_situation_probe(notice_state)
    live_notify.LOCAL_WAKES["notices"] = wake
    if _stream_opened not in chat_doors.ON_OPEN:
        chat_doors.ON_OPEN.append(_stream_opened)
    inner = getattr(getattr(app, "router", None), "lifespan_context", None)
    if inner is None:
        return

    @contextlib.asynccontextmanager
    async def lifespan(a: Any) -> AsyncIterator[Any]:
        async with inner(a) as state:
            start()
            try:
                yield state
            finally:
                await stop()

    app.router.lifespan_context = lifespan
