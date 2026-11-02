"""The staff beat's feeds the relay still carried (server/snapshot_service.py _staff_sweep_loop), in the app: the
company's lines into the Line Directory (hourly, the first tick after a start), and on the hourly tick the platform's
contact list, the behaviour signals, the comm routes, PsiAnywhere's stored and read punches, and each person's window
(commWhenIngest, its roster off the CALENDAR grids); once a day the proposals the replies taught. Each one is read
from the app's own modules (the old platform's own tables on the read-only connection, the sheets off asa-hub-db) and
handed to its door in-process as the service, in the relay's passes and with its words. Nothing here sends a
message; the doors that do go through Smart Comms."""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import clocks
import live_notify

log = logging.getLogger("asa-hub-app.feeds")

DSN = "asa-hub-db"
HIRING_APP = "hiring"
LINE_DIRECTORY_APP = "line-directory"
CONTACTS_SYNC_APP = "contacts-sync"
COMM_ROUTES_APP = "comm-routes"
COMM_WHEN_APP = "comm-when"
SMART_COMMS_APP = "smart-comms"
CONTACTS_SYNC_PASSES = 10
COMM_ROUTES_PASSES = 10
# the relay's wait for a hand-over's write
INGEST_WAIT_S = 300.0
LINES_TABLE = os.getenv("HUB_LINES_TABLE", "app.asa_openphone_lines")
NEVER_A_LINE = {"3303440430"}

_FAILURES = {"contacts": 0, "behavior": 0, "comm_routes": 0, "psi_punches": 0, "comm_when": 0, "comm_proposals": 0}


def _wid(tag: str) -> str:
    return "W" + hashlib.sha256(f"{tag}|{time.time_ns()}".encode()).hexdigest()[:24]


# ── the company's lines (line_directory.payload) ─────────────────────────────────────────────────────────────────────

def _digits(value: Any) -> str:
    import re  # noqa: PLC0415

    d = re.sub(r"\D+", "", str(value or ""))
    if len(d) >= 11 and d.startswith("1"):
        d = d[1:]
    d = d[-10:]
    return d if len(d) == 10 else ""


def lines_payload() -> dict[str, Any]:
    """Blocking: what lineDirectorySync accepts — the company lines kept again from the provider first
    (app/company_lines.py), then their rows as kept in asa-hub-db and when they were kept. A table with no rows is not
    a company with no lines: it raises."""
    import company_lines  # noqa: PLC0415
    import lanes_db  # noqa: PLC0415
    import lanes_pg  # noqa: PLC0415

    try:
        company_lines.refresh()
    except Exception as exc:  # noqa: BLE001 - the lines kept stand until the provider answers
        log.warning("company lines: the provider's listing was not kept (%s) — the lines kept stand", str(exc)[:160])
    with lanes_db.connect() as conn, conn.cursor(cursor_factory=lanes_pg.RealDictCursor) as cur:
        cur.execute(f"select id, name, number, assigned_users, forward_to, synced_at from {LINES_TABLE} "  # noqa: S608
                    "order by number")
        raw = [dict(r) for r in cur.fetchall()]
    if not raw:
        raise RuntimeError(f"{LINES_TABLE} holds no rows — refused rather than answered as 'we own none'")
    rows, newest = [], ""
    for r in raw:
        d = _digits(r.get("number"))
        if not d or d in NEVER_A_LINE:
            continue
        at = str(r.get("synced_at") or "")
        newest = max(newest, at)
        users = r.get("assigned_users") or []
        if isinstance(users, str):
            try:
                users = json.loads(users)
            except ValueError:
                users = []
        rows.append({"id": str(r.get("id") or ""), "number": str(r.get("number") or ""),
                     "name": str(r.get("name") or ""), "assigned_users": users,
                     "forward_to": str(r.get("forward_to") or "")})
    return {"rows": rows, "source_at": newest}


async def line_directory() -> None:
    """The company's lines handed to the Line Directory: the list a situation's sending line is judged against."""
    try:
        body = await asyncio.to_thread(lines_payload)
    except Exception as exc:  # noqa: BLE001 - the stored directory stands until the next tick
        log.warning("line directory hand-off: the platform's lines could not be read: %s", str(exc)[:160])
        return
    wid = _wid("line-directory")
    env, why = await clocks.call(LINE_DIRECTORY_APP, "lineDirectorySync", body, wid, clocks.PACK_S)
    if env is None:
        clocks.void_soon(LINE_DIRECTORY_APP, wid)
        log.warning("line directory hand-off: Python did not answer (%s)", why)
        return
    if env.get("status") != 200:
        log.warning("line directory hand-off refused: %s", str(env.get("message") or env)[:160])
        return
    data = env.get("data") or {}
    log.info("line directory hand-off: %s line(s) stored, %s shared, list as of %s", data.get("stored"),
             data.get("shared"), body.get("source_at") or "an unsaid time")


# ── the platform's contact list (contacts_slices → peopleSyncFromPlatform) ───────────────────────────────────────────

_CONTACTS: dict[str, Any] = {"source_at": "", "since": 0}
CONTACTS_FORCE_EVERY = 24


async def people_sync(payload: dict[str, Any]) -> dict[str, Any]:
    """peopleSyncFromPlatform pass after pass while it hands rows back, each pass its own final write; the passes'
    summed answer, or the one that stopped them."""
    why = clocks.ingest_hold("peopleSyncFromPlatform", await clocks.config_lane())
    if why:
        return {"status": 409, "message": why, "held": True}
    left = payload.get("rows")
    done = {k: 0 for k in ("updated", "inserted", "unchanged", "foreign", "unnamed", "refused", "writes", "received")}
    named: list[str] = []
    for _ in range(CONTACTS_SYNC_PASSES):
        wid = _wid("contacts-sync")
        env, unanswered = await clocks.call(CONTACTS_SYNC_APP, "peopleSyncFromPlatform", {**payload, "rows": left},
                                            wid, clocks.PACK_S)
        if env is None:
            clocks.void_soon(CONTACTS_SYNC_APP, wid)
            return {"status": 503, "message": f"Python did not answer ({unanswered})"}
        data = env.get("data") or {}
        if env.get("status") != 200 or data.get("skipped"):
            return env
        for k in done:
            done[k] += int(data.get(k) or 0)
        named = (named + list(data.get("refused_named") or []))[:40]
        left = data.get("left") or []
        if not left:
            return {"status": 200, "data": {**done, "refused_named": named,
                                            "source_at": str(payload.get("source_at") or "")}}
    return {"status": 503, "message": f"{len(left)} roster row(s) not reached in {CONTACTS_SYNC_PASSES} passes"}


async def contacts() -> None:
    import contacts_slices  # noqa: PLC0415

    try:
        rows, source_at, quality = await asyncio.to_thread(contacts_slices.build_with_quality, DSN)
    except Exception as exc:  # noqa: BLE001
        _FAILURES["contacts"] += 1
        log.warning("contacts hand-off: the platform list could not be read (%sx in a row): %s",
                    _FAILURES["contacts"], type(exc).__name__)
        return
    log.info("contacts hand-off: %s row(s) pass the filter; refused %s; fields dropped %s; id collisions %s; "
             "aliases %s", len(rows), json.dumps(quality.get("refused") or {}),
             json.dumps(quality.get("dropped") or {}), quality.get("collisions"), quality.get("aliases"))
    if not rows:
        # zero is an answer: an empty list is logged, never handed over
        log.info("contacts hand-off: the platform list is empty — nothing handed over")
        return
    unchanged = bool(source_at) and source_at == _CONTACTS["source_at"]
    if unchanged and _CONTACTS["since"] < CONTACTS_FORCE_EVERY:
        _CONTACTS["since"] += 1
        log.info("contacts hand-off: platform list unchanged since %s — not handed over", source_at)
        return
    try:
        env = await people_sync(contacts_slices.handoff_payload(rows, source_at))
    except Exception as exc:  # noqa: BLE001
        _FAILURES["contacts"] += 1
        log.warning("contacts hand-off failed (%sx in a row): %s", _FAILURES["contacts"], type(exc).__name__)
        return
    if env.get("status") != 200:
        _FAILURES["contacts"] += 1
        log.warning("contacts hand-off refused: %s", str(env.get("message") or env)[:160])
        return
    _FAILURES["contacts"] = 0
    _CONTACTS.update(source_at=source_at or "", since=0)
    data = env.get("data") or {}
    if data.get("skipped"):
        log.info("contacts hand-off: %s", data["skipped"])
        return
    log.info("contacts hand-off: %s roster row(s) refreshed, %s added, %s unchanged (%s received, platform list as "
             "of %s)", data.get("updated"), data.get("inserted"), data.get("unchanged"), data.get("received"),
             source_at)
    if data.get("updated") or data.get("inserted"):
        live_notify.dirty(["people"])


# ── what the platform's own log says about each person (behavior_slices) ─────────────────────────────────────────────

_BEHAVIOR: dict[str, Any] = {"hash": "", "since": 0}
BEHAVIOR_FORCE_EVERY = 12


async def behavior() -> None:
    import behavior_slices  # noqa: PLC0415

    try:
        payload = await asyncio.to_thread(behavior_slices.signals_payload, DSN)
    except Exception as exc:  # noqa: BLE001
        _FAILURES["behavior"] += 1
        log.warning("behavior hand-off: the platform's log could not be read (%sx in a row): %s",
                    _FAILURES["behavior"], type(exc).__name__)
        return
    rows = payload.get("rows") or []
    if not rows:
        log.info("behavior hand-off: nothing measured yet — %s account(s), none with evidence", payload.get("people"))
        return
    digest = hashlib.sha1(json.dumps([[r.get("id"), r.get("value")] for r in rows],  # noqa: S324
                                     sort_keys=True).encode()).hexdigest()
    if digest == _BEHAVIOR["hash"] and _BEHAVIOR["since"] < BEHAVIOR_FORCE_EVERY:
        _BEHAVIOR["since"] += 1
        log.info("behavior hand-off: %s signal(s) unchanged — not handed over", len(rows))
        return
    try:
        env = await clocks.service_door(HIRING_APP, "behaviorSignalsIngest",
                                        {"rows": rows, "source_at": payload.get("source_at"),
                                         "window": payload.get("window")}, wait=INGEST_WAIT_S)
    except Exception as exc:  # noqa: BLE001
        _FAILURES["behavior"] += 1
        log.warning("behavior hand-off failed (%sx in a row): %s", _FAILURES["behavior"], type(exc).__name__)
        return
    if env.get("status") != 200:
        _FAILURES["behavior"] += 1
        log.warning("behavior hand-off refused: %s", str(env.get("message") or env)[:160])
        return
    _FAILURES["behavior"] = 0
    _BEHAVIOR.update(hash=digest, since=0)
    data = env.get("data") or {}
    log.info("behavior hand-off: %s signal(s) added, %s refreshed, %s unchanged (%s account(s), %s with evidence)",
             data.get("inserted"), data.get("updated"), data.get("unchanged"), payload.get("people"),
             payload.get("read"))


# ── what the graph knows about reaching somebody (comm_cortex → commRoutesIngest) ───────────────────────────────────

_ROUTES: dict[str, Any] = {"hash": "", "since": 0}
ROUTES_FORCE_EVERY = 12


async def comm_routes_ingest(rows: list[dict], source_at: str) -> dict[str, Any]:
    """commRoutesIngest pass after pass while it hands rows back, one stamp for them all."""
    left, done = rows, {"wrote": 0, "refused": 0, "cleared": 0}
    for _ in range(COMM_ROUTES_PASSES):
        wid = _wid("comm-routes")
        env, unanswered = await clocks.call(COMM_ROUTES_APP, "commRoutesIngest", {"rows": left, "source_at": source_at},
                                            wid, clocks.PACK_S)
        if env is None:
            clocks.void_soon(COMM_ROUTES_APP, wid)
            return {"status": 503, "message": f"Python did not answer ({unanswered})"}
        if env.get("status") != 200:
            return env
        data = env.get("data") or {}
        for k in done:
            done[k] += int(data.get(k) or 0)
        left = data.get("left") or []
        if not left:
            return {"status": 200, "data": done}
    return {"status": 503, "message": f"{len(left)} route(s) not reached in {COMM_ROUTES_PASSES} passes"}


async def comm_routes() -> None:
    import comm_cortex  # noqa: PLC0415

    try:
        rows, _at = await asyncio.to_thread(comm_cortex.build, "commRoutes", DSN)
    except Exception as exc:  # noqa: BLE001
        _FAILURES["comm_routes"] += 1
        log.warning("comm routes: the graph could not be read (%sx in a row): %s", _FAILURES["comm_routes"],
                    type(exc).__name__)
        return
    if not rows:
        log.info("comm routes: the cortex offered no reachable person")
        return
    digest = hashlib.sha1(json.dumps([sorted((k, str(v)) for k, v in r.items() if k != "source_at") for r in rows],  # noqa: S324
                                     sort_keys=True).encode()).hexdigest()
    if digest == _ROUTES["hash"] and _ROUTES["since"] < ROUTES_FORCE_EVERY:
        _ROUTES["since"] += 1
        log.info("comm routes: %s route(s) unchanged — not handed over", len(rows))
        return
    source_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    try:
        env = await comm_routes_ingest(rows, source_at)
    except Exception as exc:  # noqa: BLE001
        _FAILURES["comm_routes"] += 1
        log.warning("comm routes hand-off failed (%sx in a row): %s", _FAILURES["comm_routes"], type(exc).__name__)
        return
    if env.get("status") != 200:
        _FAILURES["comm_routes"] += 1
        log.warning("comm routes hand-off refused: %s", str(env.get("message") or env)[:160])
        return
    _FAILURES["comm_routes"] = 0
    _ROUTES.update(hash=digest, since=0)
    got = env.get("data") or {}
    log.info("comm routes: %s written, %s refused", got.get("wrote"), got.get("refused"))


# ── the hours PsiAnywhere recorded, carried into the psi_punches house (psi_punches_feed) ────────────────────────────

_PSI: dict[str, Any] = {"digest": "", "probe": None, "passes": [], "cursor": 0, "answers": [], "expected": 0,
                        "at": 0.0, "full_at": 0.0, "quiet": 0.0, "prints": {}, "sweep_prints": {}, "full": True}
PSI_REVERIFY_S = float(os.getenv("HUB_PSI_PUNCHES_REVERIFY_S", str(7 * 24 * 3600)))
PSI_PASSES_PER_TICK = max(1, int(os.getenv("HUB_PSI_PUNCHES_PASSES", "2")))
PSI_QUIET_S = 86400.0


def _psi_due(probe: dict) -> str:
    """Why a sweep should run, or '' for no reason at all."""
    state = _PSI
    if not state["at"]:
        return "the house has not been verified by this process"
    if time.time() - float(state.get("full_at") or 0.0) >= PSI_REVERIFY_S:
        return "the weekly re-verification is due"
    if probe != state["probe"]:
        return "the record moved"
    return ""


async def psi_punches() -> None:
    """PsiAnywhere's punch record — the stored copy and the live reads — carried into the psi_punches house, in
    passes, only what changed once the house was proved whole in this process."""
    import psi_punches_feed as feed  # noqa: PLC0415

    state = _PSI
    if not state["passes"]:
        try:
            probe = await asyncio.to_thread(feed.probe, DSN)
        except Exception as exc:  # noqa: BLE001
            _FAILURES["psi_punches"] += 1
            log.warning("psi punches: the record could not be probed (%sx in a row): %s", _FAILURES["psi_punches"],
                        type(exc).__name__)
            return
        why = _psi_due(probe)
        if not why:
            if time.time() - state["quiet"] > PSI_QUIET_S:
                state["quiet"] = time.time()
                log.info("psi punches: the record has not moved (%s stored row(s), last synced %s; %s read live, "
                         "newest %s) and the house was verified %sh ago — nothing handed over", probe.get("rows"),
                         probe.get("newest") or "never", probe.get("live_rows", 0), probe.get("live_newest") or "never",
                         int((time.time() - state["at"]) / 3600))
            return
        try:
            got = await asyncio.to_thread(feed.read, DSN)
        except Exception as exc:  # noqa: BLE001
            _FAILURES["psi_punches"] += 1
            log.warning("psi punches: the record could not be read (%sx in a row): %s", _FAILURES["psi_punches"],
                        type(exc).__name__)
            return
        rows = got.get("rows") or []
        if not rows:
            log.warning("psi punches: the record answered with no punch at all — nothing handed over (it only grows, "
                        "and cannot be empty)")
            return
        prints = feed.fingerprints(rows)
        full = not state["prints"] or why != "the record moved"
        handing = rows if full else feed.changed_rows(rows, state["prints"])
        state["probe"] = probe
        state["digest"] = got.get("digest") or ""
        if not handing:
            log.info("psi punches: %s — and every one of the %s row(s) is already in the house as it reads now; "
                     "nothing handed over", why, len(rows))
            return
        state.update(passes=feed.batches(handing), cursor=0, answers=[], expected=len(handing), full=full,
                     sweep_prints={r["single_entry_id"]: prints[r["single_entry_id"]] for r in handing})
        log.info("psi punches: %s (%s punch(es): %s stored, %s read live, %s the stored copy never had; %s people, "
                 "%s never closed, %s → %s) — handing over %s%s in %s pass(es)", why, len(rows), got.get("stored"),
                 got.get("live"), got.get("live_new"), got.get("people"), got.get("open_punches"),
                 got.get("first_day"), got.get("last_day"), len(handing), "" if full else " changed row(s)",
                 len(state["passes"]))
        if got.get("keyless"):
            log.warning("psi punches: %s row(s) carry no single_entry_id and cannot be addressed by the house — not "
                        "handed over", got["keyless"])
    sent = 0
    while state["cursor"] < len(state["passes"]) and sent < PSI_PASSES_PER_TICK:
        seq = state["cursor"]
        try:
            env = await clocks.service_door(HIRING_APP, "psiPunchesIngest", feed.payload(state["passes"][seq]),
                                            wait=INGEST_WAIT_S)
        except Exception as exc:  # noqa: BLE001 - the cursor does not move
            _FAILURES["psi_punches"] += 1
            log.warning("psi punches: pass %s/%s failed (%sx in a row): %s — resuming next tick", seq + 1,
                        len(state["passes"]), _FAILURES["psi_punches"], type(exc).__name__)
            return
        if env.get("status") != 200:
            _FAILURES["psi_punches"] += 1
            log.warning("psi punches: pass %s/%s refused: %s", seq + 1, len(state["passes"]),
                        str(env.get("message") or env)[:160])
            return
        _FAILURES["psi_punches"] = 0
        data = env.get("data") or {}
        state["answers"].append(data)
        state["cursor"] = seq + 1
        sent += 1
        log.info("psi punches: pass %s/%s — %s handed, %s added, %s patched, %s unchanged, %s write(s)", seq + 1,
                 len(state["passes"]), data.get("kept"), data.get("inserted"), data.get("updated"),
                 data.get("unchanged"), data.get("writes"))
    if state["cursor"] < len(state["passes"]):
        return
    verdict = feed.verdict(state["answers"], state["expected"])
    state.update(passes=[], cursor=0, answers=[])
    if verdict["dropped_columns"]:
        log.warning("psi punches: the door dropped client column(s) at the line: %s",
                    ", ".join(verdict["dropped_columns"]))
    if not verdict["complete"]:
        log.warning("psi punches: the house accounted for %s of %s punch(es)%s — the record is NOT whole; the next "
                    "sweep re-sends it", verdict["held"], verdict["expected"],
                    " (%s past the door's cap)" % verdict["overflow"] if verdict["overflow"] else "")
        return
    state["at"] = time.time()
    if state.get("full", True):
        state["prints"] = dict(state.get("sweep_prints") or {})
        state["full_at"] = state["at"]
    else:
        state["prints"].update(state.get("sweep_prints") or {})
    state["sweep_prints"] = {}
    state["quiet"] = state["at"]
    if verdict["converged"]:
        log.info("psi punches: the house already holds all %s punch(es) — %s pass(es), zero writes, converged",
                 verdict["held"], verdict["passes"])
    else:
        log.info("psi punches: %s punch(es) now in the house — %s added, %s patched, %s unchanged over %s pass(es), "
                 "%s write(s)", verdict["held"], verdict["inserted"], verdict["updated"], verdict["unchanged"],
                 verdict["passes"], verdict["writes"])


# ── when each person may be asked something (comm_when_feed → commWhenIngest) ───────────────────────────────────────

_WHEN: dict[str, Any] = {"digest": "", "since": 0, "passes": [], "cursor": 0, "answers": [], "expected": 0, "at": "",
                         "read_at": 0.0, "pending": "", "said": 0.0}
WHEN_FORCE_EVERY = 4
WHEN_PASSES_PER_TICK = max(1, int(os.getenv("HUB_COMM_WHEN_PASSES", "2")))
WHEN_SAY_S = 21600.0


async def comm_when_ingest(batch: list[dict], source_at: str) -> dict[str, Any]:
    import comm_when_feed  # noqa: PLC0415

    wid = _wid("comm-when")
    env, unanswered = await clocks.call(COMM_WHEN_APP, "commWhenIngest", comm_when_feed.payload(batch, source_at), wid,
                                        clocks.PACK_S)
    if env is None:
        clocks.void_soon(COMM_WHEN_APP, wid)
        return {"status": 503, "message": f"Python did not answer ({unanswered})"}
    return env


async def comm_when() -> None:
    """The per-person window handed to commWhenIngest in passes; one stamp for the whole sweep."""
    import comm_when_feed  # noqa: PLC0415

    state = _WHEN
    if state["passes"] and state["read_at"] and time.time() - state["read_at"] > 6 * 3600:
        log.warning("comm when: the sweep in flight was read %sh ago and the house would ignore it — recomputing",
                    int((time.time() - state["read_at"]) / 3600))
        state.update(passes=[], cursor=0, answers=[])
    if not state["passes"]:
        try:
            got = await asyncio.to_thread(comm_when_feed.read, DSN)
        except comm_when_feed.CommWhenUnavailable as exc:
            if time.time() - state["said"] > WHEN_SAY_S:
                state["said"] = time.time()
                log.warning("comm when: %s", exc)
            return
        except Exception as exc:  # noqa: BLE001
            _FAILURES["comm_when"] += 1
            log.warning("comm when: the roster could not be read (%sx in a row): %s", _FAILURES["comm_when"],
                        type(exc).__name__)
            return
        rows = got.get("rows") or []
        if not rows:
            log.warning("comm when: the roster answered with nobody at all — nothing handed over")
            return
        digest = got.get("digest") or ""
        if digest == state["digest"] and state["since"] < WHEN_FORCE_EVERY:
            state["since"] += 1
            log.info("comm when: %s person(s) unchanged — not handed over", len(rows))
            return
        state.update(passes=comm_when_feed.batches(rows), cursor=0, answers=[], expected=len(rows), pending=digest,
                     at=comm_when_feed.stamp(), read_at=time.time())
        log.info("comm when: %s person(s) on the roster — %s reachable, %s of them only inside the platform's quiet "
                 "hours, %s with no readable hour — handing over in %s pass(es)", len(rows), got.get("reachable"),
                 got.get("only_by_this_rule"), got.get("states", {}).get("hours_unknown", 0), len(state["passes"]))
        if got.get("refused"):
            log.warning("comm when: %s row(s) name nobody or a state this platform does not know — not handed over",
                        got["refused"])
        if got.get("windowless"):
            log.warning("comm when: %s row(s) say reachable and carry no window — they grant nothing on the far side",
                        got["windowless"])
    sent = 0
    while state["cursor"] < len(state["passes"]) and sent < WHEN_PASSES_PER_TICK:
        seq = state["cursor"]
        try:
            env = await comm_when_ingest(state["passes"][seq], state["at"])
        except Exception as exc:  # noqa: BLE001 - the cursor does not move
            _FAILURES["comm_when"] += 1
            log.warning("comm when: pass %s/%s failed (%sx in a row): %s — resuming next tick", seq + 1,
                        len(state["passes"]), _FAILURES["comm_when"], type(exc).__name__)
            return
        if env.get("status") != 200:
            _FAILURES["comm_when"] += 1
            log.warning("comm when: pass %s/%s refused: %s", seq + 1, len(state["passes"]),
                        str(env.get("message") or env)[:160])
            return
        _FAILURES["comm_when"] = 0
        state["answers"].append(env.get("data") or {})
        state["cursor"] = seq + 1
        sent += 1
    if state["cursor"] < len(state["passes"]):
        return
    verdict = comm_when_feed.verdict(state["answers"], state["expected"])
    state.update(passes=[], cursor=0, answers=[])
    if verdict["dropped_columns"]:
        log.warning("comm when: the door dropped client column(s) at the line: %s",
                    ", ".join(verdict["dropped_columns"]))
    if verdict["unfit"]:
        log.warning("comm when: %s window(s) did not sit between 30 and 5 minutes before their own shift and were "
                    "emptied — those people are asked nothing", verdict["unfit"])
    if not verdict["complete"]:
        log.warning("comm when: the house accounted for %s of %s person(s)%s — the next sweep re-sends them",
                    verdict["held"], verdict["expected"],
                    " (%s past the door's cap)" % verdict["overflow"] if verdict["overflow"] else "")
        return
    state.update(digest=state["pending"], since=0)
    if verdict["converged"]:
        log.info("comm when: the house already holds all %s person(s) — %s pass(es), zero writes, converged",
                 verdict["held"], verdict["passes"])
    else:
        log.info("comm when: %s person(s) now in the house — %s added, %s patched, %s unchanged over %s pass(es), %s "
                 "write(s) · %s reachable", verdict["held"], verdict["inserted"], verdict["updated"],
                 verdict["unchanged"], verdict["passes"], verdict["writes"], verdict["reachable"])


# ── what the replies taught, once a day (comm_proposals_feed → commProposalsIngest) ─────────────────────────────────

_PROPOSALS: dict[str, Any] = {"digest": "", "passes": [], "cursor": 0, "answers": [], "expected": 0, "pending": "",
                              "said": 0.0}
PROPOSALS_PASSES_PER_TICK = max(1, int(os.getenv("HUB_COMM_PROPOSALS_PASSES", "2")))
PROPOSALS_SAY_S = float(os.getenv("HUB_COMM_PROPOSALS_SAY_S", str(12 * 3600)))
PROPOSALS_EVERY_S = float(os.getenv("HUB_COMM_PROPOSALS_EVERY_S", str(24 * 3600)))
# the day is a wall clock kept on disk, where the relay kept it
LANE_STAMP_DIR = Path(os.getenv("HUB_SNAPSHOT_OUT", "/srv/snapshot")) / "lane-stamps"
PROPOSALS_LANE = "comm_proposals"


def lane_last_run(lane: str) -> float:
    """When a periodic lane last started a pass, off the disk (0.0: never)."""
    try:
        return float(json.loads((LANE_STAMP_DIR / f"{lane}.json").read_text()).get("at") or 0.0)
    except FileNotFoundError:
        return 0.0
    except Exception as exc:  # noqa: BLE001 - an unreadable stamp is "never ran"
        log.warning("lane clock: %s's stamp could not be read (%s) — treated as never run", lane, type(exc).__name__)
        return 0.0


def lane_ran(lane: str, at: float | None = None) -> None:
    at = time.time() if at is None else at
    try:
        LANE_STAMP_DIR.mkdir(parents=True, exist_ok=True, mode=0o700)
        os.chmod(LANE_STAMP_DIR, 0o700)
        path = LANE_STAMP_DIR / f"{lane}.json"
        tmp = LANE_STAMP_DIR / f".{lane}.json.writing"
        tmp.write_text(json.dumps({"lane": lane, "at": at, "at_iso": datetime.fromtimestamp(at, timezone.utc)
                                   .strftime("%Y-%m-%dT%H:%M:%SZ")}, separators=(",", ":")))
        os.chmod(tmp, 0o600)
        tmp.replace(path)
    except Exception as exc:  # noqa: BLE001
        log.warning("lane clock: %s's stamp could not be written (%s) — it will be asked for again sooner than its "
                    "period", lane, type(exc).__name__)


def proposals_due(now: float | None = None) -> bool:
    if _PROPOSALS["passes"]:
        return True
    now = time.time() if now is None else now
    return now - lane_last_run(PROPOSALS_LANE) >= PROPOSALS_EVERY_S


async def proposals_pass(batch: list[dict]) -> dict[str, Any]:
    """One pass of the day's proposals: commProposalsIngest, the ingest gate held."""
    import comm_proposals_feed  # noqa: PLC0415

    why = clocks.ingest_hold("commProposalsIngest", await clocks.config_lane())
    if why:
        return {"status": 409, "message": why, "held": True}
    wid = _wid("comm-proposals")
    env, unanswered = await clocks.call(SMART_COMMS_APP, "commProposalsIngest", comm_proposals_feed.payload(batch),
                                        wid, clocks.PACK_S)
    if env is None:
        clocks.void_soon(SMART_COMMS_APP, wid)
        return {"status": 503, "message": f"Python did not answer ({unanswered})"}
    if env.get("status") == 200:
        clocks.smart_comms_rang()
    return env


async def comm_proposals() -> None:
    """The day's proposals handed to commProposalsIngest, in passes."""
    import comm_proposals_feed as feed  # noqa: PLC0415

    state = _PROPOSALS
    if not state["passes"]:
        # the clock is stamped when the day's look begins, before the counter is read
        lane_ran(PROPOSALS_LANE)
        try:
            got = await asyncio.to_thread(feed.read, DSN)
        except feed.CommProposalsUnavailable as exc:
            if time.time() - state["said"] > PROPOSALS_SAY_S:
                state["said"] = time.time()
                log.warning("comm proposals: %s", exc)
            return
        except Exception as exc:  # noqa: BLE001
            _FAILURES["comm_proposals"] += 1
            log.warning("comm proposals: the copy could not be read (%sx in a row): %s — this is NOT a day with "
                        "nothing to propose", _FAILURES["comm_proposals"], type(exc).__name__)
            return
        _FAILURES["comm_proposals"] = 0
        if got.get("release_refused"):
            log.warning("comm proposals: %s counted row(s) offered the opt-in list and were NOT carried — approving "
                        "one is a way to un-silence somebody who asked to be left alone", got["release_refused"])
        if not got.get("enough"):
            log.info("comm proposals: the counter proposes nothing and says why — %s",
                     got.get("why_not") or "the material is below its own floor")
            return
        rows = got.get("rows") or []
        if not rows:
            log.info("comm proposals: %s distinct unclear repl(y/ies), %s of vocabulary shape, measured against %s "
                     "the machine read correctly — no family cleared the gates, nothing proposed",
                     got.get("unclear_distinct"), got.get("proposable_shape"), got.get("control_distinct"))
            return
        digest = got.get("digest") or ""
        if digest == state["digest"]:
            log.info("comm proposals: the same %s proposal(s) as the last hand-over — nothing handed over, the house "
                     "already holds them", len(rows))
            return
        state.update(passes=feed.batches(rows), cursor=0, answers=[], expected=len(rows), pending=digest)
        log.info("comm proposals: %s proposal(s) counted — %s for a person to judge, %s blocked by their own leak, "
                 "against %s repl(y/ies) the machine read correctly — handing over in %s pass(es)", len(rows),
                 got.get("proposed"), got.get("blocked"), got.get("control_distinct"), len(state["passes"]))
        if got.get("refused"):
            log.warning("comm proposals: %s counted row(s) were not carried (%s)", got["refused"],
                        got.get("refused_by"))
    sent = 0
    while state["cursor"] < len(state["passes"]) and sent < PROPOSALS_PASSES_PER_TICK:
        seq = state["cursor"]
        try:
            env = await proposals_pass(state["passes"][seq])
        except Exception as exc:  # noqa: BLE001 - the cursor does not move
            _FAILURES["comm_proposals"] += 1
            log.warning("comm proposals: pass %s/%s failed (%sx in a row): %s — resuming next tick", seq + 1,
                        len(state["passes"]), _FAILURES["comm_proposals"], type(exc).__name__)
            return
        if env.get("status") != 200:
            _FAILURES["comm_proposals"] += 1
            log.warning("comm proposals: pass %s/%s refused: %s", seq + 1, len(state["passes"]),
                        str(env.get("message") or env)[:200])
            return
        _FAILURES["comm_proposals"] = 0
        state["answers"].append(env.get("data") or {})
        state["cursor"] = seq + 1
        sent += 1
    if state["cursor"] < len(state["passes"]):
        return
    verdict = feed.verdict(state["answers"], state["expected"])
    state.update(passes=[], cursor=0, answers=[])
    if verdict["dropped_columns"]:
        log.warning("comm proposals: the door dropped column(s) at the line: %s", ", ".join(verdict["dropped_columns"]))
    if verdict["release_refused"]:
        log.warning("comm proposals: the door refused %s row(s) offering the release list", verdict["release_refused"])
    if not verdict["complete"]:
        log.warning("comm proposals: the house accounted for %s of %s proposal(s)%s — the next pass re-sends them",
                    verdict["held"], verdict["expected"],
                    " (%s past the door's cap)" % verdict["overflow"] if verdict["overflow"] else "")
        return
    state["digest"] = state["pending"]
    if verdict["kept_decision"]:
        log.info("comm proposals: %s proposal(s) a person had already answered kept their answer — the counter's word "
                 "does not un-decide one", verdict["kept_decision"])
    if verdict["converged"]:
        log.info("comm proposals: the house already holds all %s proposal(s) — %s pass(es), zero writes, converged",
                 verdict["held"], verdict["passes"])
    else:
        log.info("comm proposals: %s proposal(s) now in the house — %s added, %s patched, %s unchanged over %s "
                 "pass(es), %s write(s) · %s waiting for a person, %s blocked", verdict["held"], verdict["inserted"],
                 verdict["updated"], verdict["unchanged"], verdict["passes"], verdict["writes"], verdict["proposed"],
                 verdict["blocked"])


# ── the staff beat's share ───────────────────────────────────────────────────────────────────────────────────────────

async def tick(n: int) -> None:
    """The relay's order on its staff beat: the lines hourly from the first tick after a start, the hourly feeds on
    the hour, the proposals when their day is due. Never raises."""
    async def guarded(name: str, fn: Any) -> None:
        try:
            await fn()
        except Exception:  # noqa: BLE001 - one feed that broke never stops the next
            log.exception("staff feeds: %s failed", name)

    if n % 6 == 1:
        await guarded("line directory", line_directory)
    if n % 6 == 0:
        for name, fn in (("contacts", contacts), ("behavior", behavior), ("comm routes", comm_routes),
                         ("psi punches", psi_punches), ("comm when", comm_when)):
            await guarded(name, fn)
    if proposals_due():
        await guarded("comm proposals", comm_proposals)


def health() -> dict[str, Any]:
    return {"failures": dict(_FAILURES)}
