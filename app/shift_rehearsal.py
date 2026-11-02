"""The staff answers, rehearsed (server/shift_rehearsal.py) — the app's door to a sandbox that can reach no real row,
file, person or host. Every rehearsed answer, every read of the board and every reset runs in a worker process of its
own (rehearsal_sandbox.py), over the sandbox's own schema in asa-hub-db."""
from __future__ import annotations

import json
import logging
import os
import subprocess
import sys
import threading
from pathlib import Path
from typing import Any

log = logging.getLogger("asa-hub-app.shift-rehearsal")

HERE = Path(__file__).resolve().parent
DOORS = ("app", "text")
ACTS = ("apply", "withdraw", "decide", "take", "offer_swap", "swap_accept", "swap_approve",
        "swap_director")
CLOCK_ACTS = ("apply", "decide", "take")

SCHEMA = os.getenv("HUB_SHIFT_REHEARSAL_SCHEMA", "asa_rehearsal")
ROOT = Path(os.getenv("HUB_SHIFT_REHEARSAL_DIR", str(
    Path(os.getenv("HUB_SNAPSHOT_OUT", "/srv/snapshot")) / "shift-rehearsal")))
WORKER_TIMEOUT_S = float(os.getenv("HUB_SHIFT_REHEARSAL_TIMEOUT_S", "150"))
RESULT = "REHEARSAL_RESULT "


def _slots_from_env() -> int:
    try:
        return max(1, int(os.getenv("HUB_SHIFT_REHEARSAL_WORKERS", "3")))
    except ValueError:
        return 3


# Each worker holds a thread of the relay's shared executor for its whole life, so only this many run at once; one…
WORKER_SLOTS = _slots_from_env()
_SLOTS = threading.BoundedSemaphore(WORKER_SLOTS)
# what the relay's session says about the driver, handed to the worker so the driver's own decisions and approvals…
READER_KEYS = ("badges", "whole_company", "sees_reasons", "manages", "decides_everywhere",
               "decides", "role", "managers_readable")
_BOOT = ("import sys; sys.dont_write_bytecode = True; sys.path.insert(0, {here!r}); "
         "import rehearsal_sandbox; rehearsal_sandbox.main()")


UNREADABLE = "unreadable"
# the field each lane's owed row names its recipient in: the pool's notice and a swap's ask go to `to_name` (never…
RECIPIENT = {"shift": "to_name", "swap": "to_name", "text": "person", "follow-up": "called_off_by"}


def owed_entry(lane: str, o: dict[str, Any]) -> dict[str, Any]:
    """One owed row as the rehearsal lists it."""
    about = " · ".join(str(x) for x in (o.get("house_name") or o.get("house"),
                                         o.get("col_iso") or o.get("day"),
                                         o.get("shift_code") or o.get("value")) if x)
    to = str(o.get(RECIPIENT.get(lane, "to_name")) or "").strip()
    return {"lane": lane, "key": f"{lane}:{o.get('id') or ''}",
            "kind": str(o.get("kind") or ""), "to": to, "to_known": bool(to),
            "about": about, "words": str(o.get("reply") or "")}


def worker_dsn(dsn: str) -> str:
    """The database the worker connects to: HUB_SHIFT_REHEARSAL_DSN when it is set (a role that owns only the
    sandbox), else asa-hub-db as the app's writer; `dsn` is the lanes' token and names no database."""
    return os.getenv("HUB_SHIFT_REHEARSAL_DSN", "").strip() or os.getenv("HUB_DB_WRITE_DSN", "").strip()


def owed_diff(before: list[dict[str, Any]], after: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """What the lanes owe after an answer that they did not owe before it, then one entry per lane that could not…"""
    unread_before = {str(o.get("lane") or "") for o in before if o.get("kind") == UNREADABLE}
    unread_after = {str(o.get("lane") or "") for o in after if o.get("kind") == UNREADABLE}
    known = {o.get("key") for o in before if o.get("kind") != UNREADABLE}
    out = [o for o in after if o.get("kind") != UNREADABLE
           and str(o.get("lane") or "") not in unread_before and o.get("key") not in known]
    why = {str(o.get("lane") or ""): str(o.get("why") or "")
           for o in [*before, *after] if o.get("kind") == UNREADABLE and o.get("why")}
    lanes = [str(o.get("lane") or "") for o in [*before, *after] if o.get("kind") == UNREADABLE]
    for lane in dict.fromkeys(lanes):
        side = ("before or after" if lane in unread_before and lane in unread_after
                else "before" if lane in unread_before else "after")
        out.append({"lane": lane, "key": f"{lane}:{UNREADABLE}", "kind": UNREADABLE, "to": "",
                    "about": (f"this lane could not be read {side} the answer"
                              + (f" ({why[lane]})" if why.get(lane) else "")
                              + ", so what it would have said is not known"),
                    "words": ""})
    return out


class Refused(Exception):
    """The rehearsal would not do it, and says exactly why."""

    def __init__(self, why: str, code: str = "refused", **extra: Any) -> None:
        super().__init__(why)
        self.why, self.code, self.extra = why, code, extra


class Failed(Exception):
    """The worker could not give an answer; nothing outside the sandbox was touched either way."""


def may_drive(is_master: bool | None, *, acting: bool) -> bool:
    """The master's own session alone: a new page inside a released app ships master-only until it is released."""
    return is_master is True and not acting


def board(dsn: str, *, who: dict[str, Any], run: str = "", at: str = "",
          schema: str = SCHEMA, root: Path = ROOT) -> dict[str, Any]:
    """The rehearsal screen: the sandbox's copy of the houses, shifts, people and swaps, and what was played in it."""
    driver = str((who or {}).get("name") or "")
    data = _worker(dsn, "board", {"driver": driver, "run": run, "at": at},
                   schema=schema, root=root)
    return {**data, "may": True, "driver": driver}


def driver_reader(who: dict[str, Any] | None) -> dict[str, Any] | None:
    """The part of the driver's session a decision or an approval is weighed by, or None."""
    if not who:
        return None
    return {k: (list(who.get(k) or []) if isinstance(who.get(k), (list, tuple, set))
                else who.get(k)) for k in READER_KEYS if k in who}


def answer(dsn: str, *, driver: str, door: str, act: str, run: str = "", location: str = "",
           open_row: str = "", col_iso: str = "", ref: str = "", person: str = "",
           request_id: str = "", handoff_id: str = "", to_staff: str = "", word: str = "yes",
           at: str = "", decider: str = "", who: dict[str, Any] | None = None,
           schema: str = SCHEMA, root: Path = ROOT) -> dict[str, Any]:
    """One simulated answer, through the door a real one comes through, inside the sandbox."""
    if door not in DOORS:
        raise Refused("the door is the app or a text", "no_door")
    if act not in ACTS:
        raise Refused(f"{act or 'nothing'} is not something the rehearsal answers", "no_act")
    return _worker(dsn, "answer", {
        "driver": driver, "door": door, "act": act, "run": run, "location": location,
        "open_row": open_row, "col_iso": col_iso, "ref": ref, "person": person,
        "request_id": request_id, "handoff_id": handoff_id, "to_staff": to_staff,
        "word": word, "at": at, "decider": decider,
        "driver_reader": driver_reader(who)}, schema=schema, root=root)


def reset(dsn: str, *, by: str, schema: str = SCHEMA, root: Path = ROOT) -> dict[str, Any]:
    """Empty the sandbox of everything the rehearsal made and take a fresh copy of the estate."""
    return _worker(dsn, "reset", {"by": by}, schema=schema, root=root)


def _worker(dsn: str, op: str, args: dict[str, Any], *, schema: str, root: Path) -> dict[str, Any]:
    if not _SLOTS.acquire(blocking=False):
        raise Refused(f"the rehearsal already has {WORKER_SLOTS} worker(s) running — nothing was "
                      f"started; try again in a moment", "busy")
    try:
        return _run_worker(dsn, op, args, schema=schema, root=root)
    finally:
        _SLOTS.release()


def _run_worker(dsn: str, op: str, args: dict[str, Any], *, schema: str,
                root: Path) -> dict[str, Any]:
    request = json.dumps({"op": op, "args": args, "dsn": worker_dsn(dsn), "schema": schema,
                          "root": str(root)})
    try:
        proc = subprocess.run(
            [sys.executable, "-B", "-c", _BOOT.format(here=str(HERE))], input=request,
            capture_output=True, text=True, timeout=WORKER_TIMEOUT_S, cwd=str(HERE),
            env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"})
    except subprocess.TimeoutExpired:
        raise Failed(f"the rehearsal's worker gave no answer inside {WORKER_TIMEOUT_S:g}s and was "
                     f"stopped — whatever it wrote stays inside the sandbox, and Reset clears it"
                     ) from None
    except OSError as exc:
        raise Failed(f"the rehearsal's worker could not be started ({type(exc).__name__})") from None
    got: dict[str, Any] | None = None
    for line in reversed((proc.stdout or "").splitlines()):
        if line.startswith(RESULT):
            try:
                got = json.loads(line[len(RESULT):])
            except ValueError:
                got = None
            break
    if got is None:
        log.warning("shift rehearsal: the worker gave no result line (exit %s): %s",
                    proc.returncode, (proc.stderr or "")[-1200:])
        raise Failed(f"the rehearsal's worker ended without an answer (exit {proc.returncode})")
    stopped = [str(s) for s in got.get("stopped") or []]
    if stopped:
        log.warning("shift rehearsal: the sandbox stopped %d reach(es) outside it during %s: %s",
                    len(stopped), op, "; ".join(stopped)[:900])
    err = got.get("error")
    if isinstance(err, dict):
        kind = str(err.get("kind") or "")
        why = str(err.get("why") or "")
        if kind == "refused":
            raise Refused(why or "refused", str(err.get("code") or "refused"),
                          **(err.get("extra") if isinstance(err.get("extra"), dict) else {}))
        if kind == "breach":
            raise Refused(f"the sandbox stopped it: {why} — nothing reached a real row, file, "
                          f"person or host", "sandbox_breach", stopped=stopped)
        if proc.stderr:
            log.warning("shift rehearsal: the worker failed during %s: %s", op,
                        (proc.stderr or "")[-1200:])
        raise Failed(f"the rehearsal failed inside its sandbox ({why or 'no reason given'})")
    data = got.get("data") if isinstance(got.get("data"), dict) else {}
    return {**data, "stopped": stopped}
