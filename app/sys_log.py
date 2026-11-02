"""The platform's action log off Python (SysLog.gs hubSysLog_, and the line Main.gs doPost writes for every action it
answers), kept in the Hub's database alone: each line hubSysLog_'s system_logs row in app.system_logs and its events
trail row in app.log_events, read by the Logs app beside the logs book's history (app/system_logs.py); no sheet holds
them. A write's lines are kept in its own transaction under its write id, so a void takes them back with it; a read's,
and every line written outside a door, are gathered and kept together every FLUSH_S (sooner past BATCH_MAX), so a read
pays no write. The lines a door writes itself (staff_views.record, the handlers' hubSysLog_) are kept beside doPost's.
A session whose acts leave no line writes none, and a write Apps Script carries is logged there, never here."""
from __future__ import annotations

import atexit
import contextvars
import json
import logging
import os
import re
import secrets
import threading
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Callable

import envelope as EV
import gsjs
import system_logs as SLG

log = logging.getLogger("asa-hub-app")

LOGS_HEADER = SLG.LOGS_HEADER
EVENTS_HEADER = SLG.EVENTS_HEADER
# ServiceIdentity.gs serviceUser_
SERVICE_ACTOR = "snapshot@service.local"
# the service's doors whose HUB_POLICY lane is neither read nor tool: the only service acts hubSysLog_ keeps
SERVICE_LOGGED = frozenset({"runtimeSweepNow", "commRoutesIngest", "psiPunchesIngest", "psiPunchesFullIngest",
                            "commWhenIngest", "commProposalsIngest", "commCallsIngest", "houseMedsIngest"})
# hubSysLog_: chat's reads run on every beat and every open conversation; its sends, reactions and marks are the acts
QUIET = frozenset({"chatPing", "chatOverview", "chatMessages"})
# doPost's auth branch logs every auth* action under the identifier it was asked with, but these
AUTH_QUIET = frozenset({"authMe", "authStatus"})
RESET_DOORS = frozenset({"authForgot", "authResetContext", "authResetSubmit"})
GENERIC_READS = frozenset({"list", "get"})
GENERIC_WRITES = ("create", "update", "delete")
# the relay's generic doors (BACKEND_GENERIC_DOORS) whose name is not their resource's
RESOURCE_OF = {"docs": "documents", "imageBank": "photos", "scheduleEvents": "events"}
# Events.gs EVENTS_PAYLOAD_MAX
EVENTS_PAYLOAD_MAX = 2000
FLUSH_S = max(0.5, float(os.getenv("HUB_SYSLOG_FLUSH_S") or 5))
BATCH_MAX = max(1, int(os.getenv("HUB_SYSLOG_BATCH_MAX") or 200))
# lines held while the store cannot keep them; past this the oldest go, said
HOLD_MAX = 20000
# rows per insert statement
CHUNK = 2000

s_ = gsjs.str_


# ---- the tables -----------------------------------------------------------------------------------------------------

def _name(table: str) -> str:
    return table.rpartition(".")[2]


def ddl() -> tuple[str, ...]:
    """app.system_logs and app.log_events: the writer role's (asa_hub_app_rw), read by asa_hub_app_ro. Every column
    text as hubSysLog_ wrote it (an ISO timestamp stays text), and the write id a void takes back."""
    lg, ev = SLG.OWN_LOGS, SLG.OWN_EVENTS
    cols = ", ".join(f'"{c}" text not null default \'\'' for c in LOGS_HEADER)
    ecols = ", ".join(f'"{c}" text not null default \'\'' for c in EVENTS_HEADER if c != "event_id")
    return (
        f"create table if not exists {lg} (id bigserial primary key, write_id text not null default '', {cols},"
        " kept_at timestamptz not null default now())",
        f"create index if not exists {_name(lg)}_write on {lg} (write_id) where write_id <> ''",
        # the Logs app walks them newest first by the moment written, byte order
        f'create index if not exists {_name(lg)}_stamp on {lg} ("timestamp" collate "C", id)',
        f"grant select on {lg} to asa_hub_app_ro",
        f"create table if not exists {ev} (id bigserial primary key, event_id text not null unique,"
        f" write_id text not null default '', {ecols}, kept_at timestamptz not null default now())",
        f"create index if not exists {_name(ev)}_write on {ev} (write_id) where write_id <> ''",
        f'create index if not exists {_name(ev)}_at on {ev} ("at" collate "C", id)',
        f"grant select on {ev} to asa_hub_app_ro",
    )


_MADE: set[tuple[str, str]] = set()
_MAKING = threading.Lock()


def made() -> bool:
    return (SLG.OWN_LOGS, SLG.OWN_EVENTS) in _MADE


def ready(store: Any) -> bool:
    """The tables made once per process, on the writer's connection outside any transaction (a write's own would take
    them back with it)."""
    if made():
        return True
    with _MAKING:
        if made():
            return True
        c = store.conn()
        if int(getattr(getattr(c, "info", None), "transaction_status", 0) or 0) != 0:
            return False
        for stmt in ddl():
            c.execute(stmt)
        _MADE.add((SLG.OWN_LOGS, SLG.OWN_EVENTS))
    return True


# ---- one request's lines ------------------------------------------------------------------------------------------

class Door:
    """One request: the lines its door writes itself as they come, doPost's once it answers. `user` is the settled
    session (None until the door is reached: a refusal before it leaves no line); `gated` says the policy gate
    answered."""

    def __init__(self, action: str, said: dict | None, payload: Any, kind: str = "hub") -> None:
        s = said if isinstance(said, dict) else {}
        self.action = action
        self.kind = kind
        self.payload = payload if isinstance(payload, dict) else {}
        self.asked = gsjs.trim(gsjs.or_blank(s.get("asked")))
        self.public = s.get("public") is True
        # the relay's word: a session whose acts leave no line
        self.silent = s.get("acting") is True or s.get("unlogged") is True
        self.user: dict | None = None
        self.gated = False
        self.lines: list[dict[str, Any]] = []
        self.token: contextvars.Token | None = None


_DOOR: contextvars.ContextVar[Door | None] = contextvars.ContextVar("sys_log_door", default=None)


def enter(action: str, said: dict | None, payload: Any, kind: str = "hub") -> Door:
    """The request's door, listening for the lines it writes itself until leave()."""
    d = Door(action, said, payload, kind)
    d.token = _DOOR.set(d)
    return d


def leave(d: Door) -> None:
    if d.token is not None:
        try:
            _DOOR.reset(d.token)
        except ValueError:
            _DOOR.set(None)
        d.token = None


_STAMP = threading.Lock()
_LAST_MS = [0]


def stamp() -> str:
    """new Date().toISOString(), one millisecond later than this process's last line at least."""
    with _STAMP:
        ms = max(int(time.time() * 1000), _LAST_MS[0] + 1)
        _LAST_MS[0] = ms
    at = datetime.fromtimestamp(ms // 1000, timezone.utc).replace(microsecond=(ms % 1000) * 1000)
    return gsjs.iso(at)


def _or(*vals: Any) -> Any:
    """a || b || …: the first truthy value, else the last."""
    for v in vals:
        if not gsjs.falsy(v):
            return v
    return vals[-1] if vals else None


def _visiting(user: dict | None) -> bool:
    place = (user or {}).get("place")
    return isinstance(place, dict) and bool(s_(place.get("member_id")))


def _line(at: str, actor: Any, action: Any, target: Any, env: Any, tenant: str) -> dict[str, Any]:
    return {"at": at, "actor": gsjs.or_text(actor), "action": gsjs.or_text(action), "target": gsjs.or_text(target),
            "env": env if isinstance(env, dict) else None, "tenant": tenant}


# ---- the lines a door writes itself ------------------------------------------------------------------------------

def heard(user: dict | None, action: Any, target: Any, status: int = 200) -> None:
    """hubSysLog_ called by a door (a staff_views.record tap), with the status it was written with: gathered by the
    request it runs in, else kept with the next batch; never for a service, nor for a session whose acts leave no
    line."""
    try:
        u = user if isinstance(user, dict) else {}
        if u.get("is_service") or u.get("unlogged") or u.get("acting"):
            return
        line = _line(stamp(), EV.log_actor(u), action, target, {"status": status}, EV.place_of(u))
        d = _DOOR.get()
        if d is None:
            BATCH.add([line])
        elif not d.silent:
            d.lines.append(line)
    except Exception as exc:  # noqa: BLE001 - logging must never break the lane
        log.warning("%s: its log line was not kept (%s)", action, type(exc).__name__)


# ---- doPost's line, and every line of a door that answered ------------------------------------------------------

def _resource(action: str, verb: str) -> str:
    """The resource a generic door answers for: its name less the verb."""
    tail = verb.title()
    if action.endswith(tail) and len(action) > len(tail):
        head = action[:-len(tail)]
        return RESOURCE_OF.get(head, head)
    return action


def _main(d: Door, env: Any) -> dict[str, Any] | None:
    """doPost's own line for the action the door answered; None where doPost writes none."""
    a, p = d.action, d.payload
    if d.kind == "auth":
        if not a.startswith("auth") or a in RESET_DOORS or a in AUTH_QUIET:
            return None
        return _line(stamp(), s_(_or(p.get("identifier"), p.get("email"))), a, "", env, "")
    u = d.user or {}
    # the public doors answer before the session gate
    if d.public or u.get("public"):
        return None
    if d.asked in EV.GENERIC:
        # data reads are noise; a generic write's line is `resource.verb`, the payload's id, no answer judged
        if d.asked in GENERIC_READS or any(ln["action"].endswith("." + d.asked) for ln in d.lines):
            return None
        return _line(stamp(), EV.log_actor(u), _resource(a, d.asked) + "." + d.asked, s_(p.get("id")), None,
                     EV.place_of(u))
    # a generic door that wrote doPost's `resource.verb` line itself, whether or not the relay named the verb
    if any(a.endswith(v.title()) and ln["action"] == _resource(a, v) + "." + v for v in GENERIC_WRITES
           for ln in d.lines):
        return None
    # a write's preparation, asked under the write's name: the write's own line says it
    if d.asked and d.asked != a:
        return None
    if a in QUIET:
        return None
    if u.get("is_service"):
        if a not in SERVICE_LOGGED:
            return None
        actor = SERVICE_ACTOR
    else:
        actor = EV.log_actor(u)
    keys = ("candidate_id", "id") if d.gated else ("candidate_id", "id", "tab")
    target = s_(_or(*(p.get(k) for k in keys), ""))
    return _line(stamp(), actor, a, target, env if isinstance(env, dict) else {}, EV.place_of(u))


def lines_of(d: Door, env: Any, decision: Any = None) -> list[dict[str, Any]]:
    """Every line the request leaves: the door's own as it wrote them, then doPost's. During a visit every line names
    the account at the keyboard (envelope.log_actor); a write handed to Apps Script leaves none here."""
    if d.silent or (d.kind != "auth" and d.user is None):
        return []
    u = d.user or {}
    if u.get("unlogged") or u.get("acting"):
        return []
    if decision is not None and (getattr(decision, "engine", False) or getattr(decision, "lay", None)):
        return []
    out: list[dict[str, Any]] = []
    keyboard = EV.log_actor(u) if _visiting(u) else ""
    for ln in d.lines:
        # the sign-in's own copy of doPost's line is said once, below, with its answer
        if d.kind == "auth" and ln["action"] == d.action:
            continue
        if d.kind != "auth":
            ln = {**ln, "tenant": EV.place_of(u), **({"actor": keyboard} if keyboard else {})}
        out.append(ln)
    main = _main(d, env)
    if main is not None:
        out.append(main)
    return [ln for ln in out if ln["action"] not in QUIET]


# ---- a line as hubSysLog_ writes it ------------------------------------------------------------------------------

def _below_400(env: dict) -> bool:
    """env.status < 400, as JavaScript compares it."""
    if "status" not in env:
        return False
    v = env.get("status")
    if v is None:
        return True
    if isinstance(v, bool):
        return int(v) < 400
    if isinstance(v, (int, float)):
        return v < 400
    if isinstance(v, str):
        t = gsjs.trim(v)
        if not t:
            return True
        try:
            return float(t) < 400
        except ValueError:
            return False
    return False


def _who_plain(actor: str) -> str:
    email = re.sub(r"^asa-hub:", "", actor)
    if not email:
        return "Someone"
    if "@" not in email:
        return "The system" if email == "system" else "An automation (" + email + ")"
    return email


def who(reads: Any, actor: str) -> str:
    """logActorName_: the account's display name, an automation's own words, else the actor as written."""
    if reads is None:
        return _who_plain(actor)
    try:
        return SLG.actor_name(reads, actor)
    except Exception:  # noqa: BLE001 - the .gs's own catch: the actor as written
        return _who_plain(actor)


def what(reads: Any, target: str) -> str:
    """logFriendlyTarget_: a candidate by name, a paper by its label, a membership by its people."""
    if reads is None:
        return gsjs.trim(target)
    try:
        return SLG.friendly_target(reads, target)
    except Exception:  # noqa: BLE001 - each part's own catch keeps the id
        return gsjs.trim(target)


def rows_of(reads: Any, ln: dict[str, Any]) -> tuple[dict[str, str], dict[str, str]]:
    """hubSysLog_'s system_logs row (ok, outcome and detail from the answer, none: ok; the area and verb of the action;
    the actor's and the target's names; the place it was done in) and eventAppend_'s row of the same fact."""
    env = ln["env"]
    ok = _below_400(env) if env is not None else True
    status = env.get("status") if env is not None and not gsjs.falsy(env.get("status")) else (200 if ok else 500)
    denied = isinstance(status, (int, float)) and not isinstance(status, bool) and status in (401, 403)
    outcome = "ok" if ok else ("denied" if denied else "failed")
    detail = gsjs.js_str(env.get("message"))[:300] if env is not None and not gsjs.falsy(env.get("message")) else ""
    area, verb = SLG.vocab(ln["action"])
    name = who(reads, ln["actor"])
    said = what(reads, ln["target"])
    summary = name + " " + verb + (" " + said if said else "")
    if not ok:
        summary += " — not allowed" if outcome == "denied" else " — it failed"
    row = {"timestamp": ln["at"], "actor": ln["actor"], "action": ln["action"], "target": ln["target"],
           "ok": "true" if ok else "false", "detail": detail, "area": area, "outcome": outcome, "summary": summary,
           "actor_name": name, "tenant": ln["tenant"]}
    body = json.dumps({"ok": ok, "outcome": outcome, "area": area, "summary": summary, "detail": detail},
                      separators=(",", ":"), ensure_ascii=False)[:EVENTS_PAYLOAD_MAX]
    event = {"event_id": "evt_" + secrets.token_hex(6), "type": s_(ln["action"]), "actor": s_(ln["actor"]),
             "subject_type": "action", "subject_key": s_(ln["target"]), "subject_name": s_(said), "payload": body,
             "source": "hubSysLog_", "at": ln["at"], "tenant": ln["tenant"]}
    return row, event


def _insert(cur: Any, table: str, cols: tuple[str, ...], rows: list[tuple]) -> None:
    names = ", ".join(f'"{c}"' for c in cols)
    one = "(" + ", ".join(["%s"] * len(cols)) + ")"
    for i in range(0, len(rows), CHUNK):
        part = rows[i:i + CHUNK]
        cur.execute(f"insert into {table} ({names}) values " + ", ".join([one] * len(part)),
                    [v for r in part for v in r])


def keep_rows(cur: Any, reads: Any, lines: list[dict[str, Any]], write_id: str = "") -> int:
    """The lines kept through `cur` under one savepoint, one insert per table: a line that cannot be kept never fails
    the write around it."""
    if not lines:
        return 0
    logs: list[tuple] = []
    events: list[tuple] = []
    for ln in sorted(lines, key=lambda x: x["at"]):
        try:
            row, event = rows_of(reads, ln)
        except Exception as exc:  # noqa: BLE001 - that line alone is left out, said
            log.warning("%s: its log line is not well formed (%s)", ln.get("action"), type(exc).__name__)
            continue
        logs.append((write_id,) + tuple(row[c] for c in LOGS_HEADER))
        events.append((write_id,) + tuple(event[c] for c in EVENTS_HEADER))
    if logs:
        with cur.connection.transaction():
            _insert(cur, SLG.OWN_LOGS, ("write_id",) + LOGS_HEADER, logs)
            _insert(cur, SLG.OWN_EVENTS, ("write_id",) + EVENTS_HEADER, events)
    return len(logs)


def keep(d: Door, env: Any, reads: Any = None, decision: Any = None, cur: Any = None, write_id: str = "") -> None:
    """The request's lines kept: through the write's cursor, in its transaction under its write id, when it has one;
    onto the batch otherwise. Never fails the door."""
    try:
        lines = lines_of(d, env, decision)
        if not lines:
            return
        if cur is not None and write_id and made():
            keep_rows(cur, reads, lines, write_id)
        else:
            # the tables not made yet: the batch makes them, outside the write
            BATCH.add(lines)
    except Exception as exc:  # noqa: BLE001 - logging must never break the lane
        log.warning("%s: its log lines were not kept (%s)", d.action, type(exc).__name__)


def void(store: Any, write_id: str) -> None:
    """A write the relay did not use takes its lines back with it."""
    try:
        if not ready(store):
            raise RuntimeError("the log tables could not be made")
        c = store.conn()
        with c.transaction():
            cur = c.cursor()
            cur.execute(f"delete from {SLG.OWN_LOGS} where write_id = %s", (write_id,))
            cur.execute(f"delete from {SLG.OWN_EVENTS} where write_id = %s", (write_id,))
    except Exception as exc:  # noqa: BLE001 - said, never raised into the relay's settle
        log.warning("system log: the void of %s left its lines (%s)", write_id[:40], type(exc).__name__)


# ---- the batch: every line kept outside a write ------------------------------------------------------------------

class Batch:
    """The lines kept outside a write, gathered and kept together in one transaction: every FLUSH_S, or as soon as
    BATCH_MAX wait. A batch the store cannot keep waits for the next one (HOLD_MAX at most)."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._held: list[dict[str, Any]] = []
        self._wake = threading.Event()
        self._thread: threading.Thread | None = None
        self.store: Any = None
        self.reads_of: Callable[[], Any] | None = None

    def held(self) -> int:
        return len(self._held)

    def _cap(self) -> None:
        over = len(self._held) - HOLD_MAX
        if over > 0:
            del self._held[:over]
            log.warning("system log: %d line(s) dropped, the store kept none for too long", over)

    def add(self, lines: list[dict[str, Any]]) -> None:
        with self._lock:
            self._held.extend(lines)
            self._cap()
            full = len(self._held) >= BATCH_MAX
            if self.store is not None and (self._thread is None or not self._thread.is_alive()):
                self._thread = threading.Thread(target=self._loop, name="sys-log", daemon=True)
                self._thread.start()
        if full:
            self._wake.set()

    def _loop(self) -> None:
        while True:
            self._wake.wait(FLUSH_S)
            self._wake.clear()
            self.flush()

    def flush(self) -> int:
        """Every held line kept now, in one transaction; on failure they wait for the next batch."""
        with self._lock:
            held, self._held = self._held, []
        if not held:
            return 0
        try:
            store = self.store
            if store is None or not store.available or not store.ready() or not ready(store):
                raise RuntimeError("no write store is ready")
            reads = self.reads_of() if self.reads_of is not None else None
            c = store.conn()
            with c.transaction():
                return keep_rows(c.cursor(), reads, held, "log-" + uuid.uuid4().hex[:24])
        except Exception as exc:  # noqa: BLE001 - kept with the next batch
            with self._lock:
                self._held[:0] = held
                self._cap()
            log.warning("system log: %d line(s) wait for the next batch (%s)", len(held), type(exc).__name__)
            return 0


BATCH = Batch()


def bind(store: Any, reads_of: Callable[[], Any]) -> None:
    """The write store whose writer connection keeps the batches, and how a batch reads names (main.py's)."""
    BATCH.store, BATCH.reads_of = store, reads_of
    atexit.register(BATCH.flush)
