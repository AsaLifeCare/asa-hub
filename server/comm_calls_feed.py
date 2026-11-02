"""Claim, read, seal, park, deliver: a call is read once, never without the seal key, and landed only by the door's own counts."""
from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import sys
import time
import urllib.error
import urllib.request
from types import ModuleType
from typing import Any, Callable

try:
    import psycopg2
    from psycopg2.extras import Json
except Exception:  # pragma: no cover
    psycopg2 = None  # type: ignore[assignment]
    Json = None  # type: ignore[assignment]

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import comm_seal  # noqa: E402  — same directory, mounted together

hub_db: Any = None
if psycopg2 is not None:
    import hub_db  # noqa: E402  — the relay's own tables, asa-hub-db once moved

# Mount first; the sibling-project path is only for a probe run on the host.
MODULE_PATHS = [
    os.getenv("HUB_COMM_CALLS_MODULE") or "",
    "/srv/analytics/comm_calls.py",
]

_SCHEMA = hub_db.schema() if hub_db is not None else "public"
LEDGER = f"{_SCHEMA}.comm_call_reads"
SEALS = f"{_SCHEMA}.comm_call_seals"
CONTROL = f"{_SCHEMA}.comm_call_catchup"

# Half the door's 500-call cap (CommCalls.gs); the door writes one block per hand-over, so small batches only add executions.
BATCH = max(1, min(500, int(os.getenv("HUB_COMM_CALLS_BATCH", "250"))))

ITEM_BATCH = max(1, min(2000, int(os.getenv("HUB_COMM_CALLS_ITEM_BATCH", "1000"))))

# Per deliver() call, not per tick: run() already delivers twice, so the relay must never call deliver() beside live().
DELIVER_BATCHES = max(1, int(os.getenv("HUB_COMM_CALLS_DELIVER_BATCHES", "2")))

# Only a door that answered and refused counts; past this the row is filed 'refused' with its facts kept.
HAND_MAX = max(1, int(os.getenv("HUB_COMM_CALLS_HAND_MAX", "5")))

# A 'reading' row older than this is abandoned, not in flight, and is offered again.
STALE_READING_S = max(60, int(os.getenv("HUB_COMM_CALLS_STALE_S", "3600")))

LIVE_MAX = max(1, min(20, int(os.getenv("HUB_COMM_CALLS_LIVE_MAX", "6"))))

RETRY_MAX = max(1, int(os.getenv("HUB_COMM_CALLS_RETRIES", "3")))

# Reading stops once this many read calls wait on a shut door.
PARK_MAX = max(1, int(os.getenv("HUB_COMM_CALLS_PARK_MAX", "500")))

# Terminal states: facts kept (the only copy), never delivered, never re-read.
HELD = ("refused", "unusable")

# The door's entry conditions (commCallsClean_), asked here only to name a row it would refuse; shapes nothing.
DOOR_READ_STATES = ("read", "unread", "unreadable")
# In step with COMM_WORK_TYPES (CommCalls.gs) and WORK_TYPES (comm_calls.py).
DOOR_WORK_TYPES = ("DailyNote", "Incident", "Request", "Screening")

_MODULE: ModuleType | None = None
# None = not checked yet; False = runs without the hand-over quarantine.
_HAND_COLUMNS: bool | None = None


class LaneUnavailable(RuntimeError):
    """The lane cannot run; `delivery` carries the hand-over already attempted this pass, or None."""

    def __init__(self, message: str, delivery: dict | None = None):
        super().__init__(message)
        self.delivery = delivery


def reading() -> ModuleType:
    """comm_calls.py, loaded by path and kept for the life of the process."""
    global _MODULE
    if _MODULE is not None:
        return _MODULE
    tried = []
    for path in MODULE_PATHS:
        if not path:
            continue
        tried.append(path)
        if not os.path.exists(path):
            continue
        spec = importlib.util.spec_from_file_location("hub_comm_calls", path)
        if spec is None or spec.loader is None:
            continue
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        if not hasattr(mod, "pile"):
            raise LaneUnavailable(f"{path} has no pile() — it is not the reading")
        _MODULE = mod
        return mod
    raise LaneUnavailable(
        "comm_calls.py is not reachable from this process (looked in: " + ", ".join(tried)
        + ") — the relay needs it mounted read-only and until it is, nothing is read")


def _connect(dsn: str):
    if psycopg2 is None:
        raise LaneUnavailable("psycopg2 is not importable in this process")
    return hub_db.connect(dsn)


def _stamp() -> str:
    """The reading's own stamp when mounted, plain UTC otherwise, so delivery never depends on the reader."""
    try:
        return reading().stamp()
    except Exception:  # noqa: BLE001
        from datetime import datetime, timezone
        return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _hand_columns(dsn: str) -> bool:
    """Adds the hand-over columns if absent; call outside any transaction, since the ALTER takes ACCESS EXCLUSIVE."""
    global _HAND_COLUMNS
    if _HAND_COLUMNS is not None:
        return _HAND_COLUMNS
    schema, _, table = LEDGER.rpartition(".")
    want = {"hand_attempts", "hand_at", "hand_error"}
    try:
        with _connect(dsn) as conn, conn.cursor() as cur:
            cur.execute("""select column_name from information_schema.columns
                            where table_schema = %s and table_name = %s""",
                        (schema or "public", table))
            have = {r[0] for r in cur.fetchall()}
            if not want - have:
                _HAND_COLUMNS = True
                return True
            cur.execute(f"""alter table {LEDGER}
                              add column if not exists hand_attempts integer not null default 0,
                              add column if not exists hand_at timestamptz,
                              add column if not exists hand_error text""")
            conn.commit()
        _HAND_COLUMNS = True
    except Exception:  # noqa: BLE001
        _HAND_COLUMNS = False
    return _HAND_COLUMNS


def ready(dsn: str) -> dict:
    """Everything that must be true before one word is read. Never raises."""
    out: dict[str, Any] = {"key": False, "tables": False, "reading": False,
                           "enabled": False, "why": []}
    try:
        out["key"] = comm_seal.available()
        if out["key"]:
            out["key_fingerprint"] = comm_seal.fingerprint()
        else:
            out["why"].append("the keyholder's public certificate is not on this machine")
    except Exception as exc:  # noqa: BLE001
        out["why"].append(str(exc)[:200])
    try:
        reading()
        out["reading"] = True
    except Exception as exc:  # noqa: BLE001
        out["why"].append(str(exc)[:200])
    try:
        with _connect(dsn) as conn, conn.cursor() as cur:
            cur.execute("select to_regclass(%s), to_regclass(%s), to_regclass(%s)",
                        (LEDGER, SEALS, CONTROL))
            got = cur.fetchone() or (None, None, None)
            out["tables"] = all(got)
            if not out["tables"]:
                out["why"].append("the comm_ tables are not minted "
                                  "(tools/mint_comm_call_seals_table.py)")
            else:
                cur.execute(f"select enabled, note from {CONTROL} where id = 1")
                row = cur.fetchone()
                out["enabled"] = bool(row and row[0])
                out["note"] = (row[1] if row else "") or ""
                if not out["enabled"]:
                    out["why"].append("the catch-up switch is off — this is the shipped state")
    except Exception as exc:  # noqa: BLE001
        out["why"].append(f"{type(exc).__name__}: {str(exc)[:160]}")
    return out


def switch(dsn: str, on: bool, by: str = "operator", note: str = "") -> dict:
    """The one knob, kept in the database so a stop needs no container recreate."""
    with _connect(dsn) as conn, conn.cursor() as cur:
        cur.execute(f"""insert into {CONTROL} (id, enabled, updated_at, updated_by, note)
                        values (1, %s, now(), %s, %s)
                        on conflict (id) do update
                          set enabled = excluded.enabled,
                              updated_at = now(),
                              updated_by = excluded.updated_by,
                              note = excluded.note
                        returning enabled, updated_at, updated_by, note""",
                    (on, by, note))
        row = cur.fetchone()
        conn.commit()
    return {"enabled": bool(row[0]), "at": str(row[1]), "by": row[2], "note": row[3]}


def running(dsn: str) -> bool:
    """Asked before every call so a stop takes effect within one call."""
    try:
        with _connect(dsn) as conn, conn.cursor() as cur:
            cur.execute(f"select enabled from {CONTROL} where id = 1")
            row = cur.fetchone()
            return bool(row and row[0])
    except Exception:  # noqa: BLE001
        # An unreadable switch means stop.
        return False


def seen(dsn: str) -> list[str]:
    """Calls this lane will not offer again; unreadable ones under RETRY_MAX and stale claims come back."""
    with _connect(dsn) as conn, conn.cursor() as cur:
        cur.execute(f"""select call_id from {LEDGER}
                         where not (
                                 (state = 'unreadable' and attempts < %s)
                              or (state = 'reading' and facts is null and attempts < %s
                                  and claimed_at < now() - make_interval(secs => %s))
                             )""",
                    (RETRY_MAX, RETRY_MAX, STALE_READING_S))
        return [r[0] for r in cur.fetchall()]


def claim(dsn: str, call_id: str, run_id: str) -> bool:
    """Atomic claim won by the database; a re-take clears landed_at so the re-read stays deliverable."""
    with _connect(dsn) as conn, conn.cursor() as cur:
        cur.execute(f"""insert into {LEDGER} (call_id, state, run_id, claimed_at, attempts)
                        values (%s, 'reading', %s, now(), 1)
                        on conflict (call_id) do update
                           set state = 'reading', run_id = excluded.run_id,
                               claimed_at = now(), landed_at = null,
                               attempts = {LEDGER}.attempts + 1
                         where ({LEDGER}.state = 'unreadable'
                                and {LEDGER}.attempts < %s)
                            or ({LEDGER}.state = 'reading'
                                and {LEDGER}.facts is null
                                and {LEDGER}.attempts < %s
                                and {LEDGER}.claimed_at < now() - make_interval(secs => %s))
                        returning call_id""",
                    (call_id, run_id, RETRY_MAX, RETRY_MAX, STALE_READING_S))
        got = cur.fetchone()
        conn.commit()
    return bool(got)


def park(dsn: str, call_id: str, facts: dict, state: str, model_via: str,
         items: int | None, error: str = "") -> None:
    """The clear facts, held in the ledger until the door confirms them, so a failed hand-over never costs a re-read."""
    with _connect(dsn) as conn, conn.cursor() as cur:
        cur.execute(f"""update {LEDGER}
                           set state = %s, facts = %s, model_via = %s,
                               items = %s, error = %s, read_at = now()
                         where call_id = %s""",
                    (state, Json(facts), model_via, items, error[:400], call_id))
        conn.commit()


def landed(dsn: str, call_ids: list[str]) -> int:
    """Marks landed and drops parked facts; call only with ids `verify` proved the door kept."""
    if not call_ids:
        return 0
    extra = ", hand_error = null" if _hand_columns(dsn) else ""
    with _connect(dsn) as conn, conn.cursor() as cur:
        cur.execute(f"""update {LEDGER}
                           set landed_at = now(), facts = null{extra}
                         where call_id = any(%s) and landed_at is null""", (call_ids,))
        got = cur.rowcount or 0
        conn.commit()
    return got


def hand_noted(dsn: str, call_ids: list[str], why: str, answered: bool) -> list[str]:
    """Records a failed hand-over and returns ids moved to 'refused'; only an answering door counts against HAND_MAX."""
    if not call_ids or not _hand_columns(dsn):
        return []
    bump = 1 if answered else 0
    with _connect(dsn) as conn, conn.cursor() as cur:
        cur.execute(f"""update {LEDGER}
                           set hand_at = now(), hand_error = %s,
                               hand_attempts = hand_attempts + %s,
                               state = case
                                 when %s and hand_attempts + %s >= %s
                                  and state in ('read', 'unreadable') then 'refused'
                                 else state end
                         where call_id = any(%s) and landed_at is null
                        returning call_id, state""",
                    (why[:400], bump, answered, bump, HAND_MAX, call_ids))
        rows = cur.fetchall()
        conn.commit()
    return [r[0] for r in rows if r[1] == "refused"]


def unusable(dsn: str, call_id: str, why: str) -> None:
    """Files a row the door's preconditions refuse; its facts are kept because they are the only copy."""
    sets = "state = 'unusable'"
    args: list[Any] = []
    if _hand_columns(dsn):
        sets += ", hand_at = now(), hand_error = %s"
        args.append(why[:400])
    args.append(call_id)
    with _connect(dsn) as conn, conn.cursor() as cur:
        cur.execute(f"update {LEDGER} set {sets} where call_id = %s and landed_at is null",
                    tuple(args))
        conn.commit()


def store_seals(dsn: str, call_id: str, sealed: list[dict]) -> int:
    """Stores ciphertext with clear locators; idempotent by (seal_id, field) and never replaces a first seal."""
    if not sealed:
        return 0
    wrote = 0
    with _connect(dsn) as conn, conn.cursor() as cur:
        for part in sealed:
            out = comm_seal.seal(part["text"], call_id, part["field"], part.get("item_no", ""))
            seal_id = call_id if part["scope"] == "transcript" \
                else f"{call_id}:{part['item_no']}"
            cur.execute(f"""insert into {SEALS}
                    (seal_id, call_id, scope, item_no, field, alg, recipient_fpr,
                     ciphertext, plain_len, cipher_len, plain_sha256, sealed_at)
                    values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                    on conflict (seal_id, field) do nothing""",
                        (seal_id, call_id, part["scope"], str(part.get("item_no", "")),
                         part["field"], out["alg"], out["key_fp"],
                         psycopg2.Binary(out["ciphertext"]), out["plain_len"],
                         out["cipher_len"], out["sha256"], out["sealed_at"]))
            wrote += cur.rowcount or 0
        conn.commit()
    return wrote


def who(numbers: list[str], post: Callable[[dict], dict] | None) -> dict[str, dict]:
    """Asks the lane's one matcher (commCallsWho) who these numbers are; a silent door names nobody."""
    want = sorted({n for n in numbers if n})
    if not want or post is None:
        return {n: {"state": "unresolved", "name": "",
                    "why": "the resolver was not asked"} for n in want}
    try:
        env = post({"action": "commCallsWho", "payload": {"phones": want}})
    except Exception as exc:  # noqa: BLE001
        return {n: {"state": "unresolved", "name": "",
                    "why": f"the resolver could not be reached ({type(exc).__name__})"}
                for n in want}
    if (env or {}).get("status") != 200:
        why = str((env or {}).get("message") or "the resolver refused")[:160]
        return {n: {"state": "unresolved", "name": "", "why": why} for n in want}
    rows = ((env.get("data") or {}).get("rows") or [])
    got = {str(r.get("phone") or ""): r for r in rows if isinstance(r, dict)}
    return {n: got.get(n) or {"state": "unresolved", "name": "",
                              "why": "the resolver returned no verdict for this number"}
            for n in want}


def payload(calls: list[dict], items: list[dict], source_at: str) -> dict:
    """Exactly the three parameters commCallsIngest declares."""
    return {"calls": calls, "items": items, "source_at": source_at}


def read_one(dsn: str, row: dict, whois: dict, run_id: str,
             http: Any = None) -> dict | None:
    """Claim, read, seal, park one call; None means another worker already claimed it."""
    mod = reading()
    call_id = mod.text(row.get("call_id"), 60)
    if not call_id or not claim(dsn, call_id, run_id):
        return None
    at = mod.stamp()
    number = mod.caller_digits(row.get("participant_s"))
    if not number:
        # The cell is often empty; the speaker labels carry the caller's number.
        number = mod.caller_from_turns(row.get("speaker_transcript"),
                                       row.get("team_member_s"))
    verdict = whois.get(number) or {"state": "unresolved", "name": "",
                                    "why": "no ten-digit caller number on the row"}
    try:
        answer = mod.ask(str(row.get(mod.READ_FIELD) or ""), call_id,
                         mod.instant(row.get("event_timestamp")), http=http)
        got = mod.project(row, mod.parse(answer["content"]), verdict, answer["via"], at)
        state, error = "read", ""
    except mod.Refused as exc:
        # Still sealed: a transcript must not wait in the clear for a retry.
        got = mod.unreadable(row, str(exc)[:60], at, verdict)
        state, error = "unreadable", str(exc)[:400]
    # Seal before parking: if sealing throws, nothing clear about the call is written.
    store_seals(dsn, call_id, got["sealed"])
    park(dsn, call_id, {"call": got["call"], "items": got["items"]},
         state, got["call"].get("model_via", ""),
         len(got["items"]) if state == "read" else None, error)
    return {"call": got["call"], "items": got["items"], "coerced": got["coerced"],
            "invented": got["invented"],
            "state": state}


def pending(dsn: str, limit: int | None = None) -> list[dict]:
    """Parked facts not yet confirmed by the door, oldest first, excluding rows the door has ended."""
    cols = "call_id, facts, " + ("coalesce(hand_attempts, 0)" if _hand_columns(dsn) else "0")
    with _connect(dsn) as conn, conn.cursor() as cur:
        cur.execute(f"""select {cols} from {LEDGER}
                         where facts is not null and landed_at is null
                           and state <> all(%s)
                         order by read_at asc nulls first limit %s""",
                    (list(HELD), int(limit or BATCH)))
        rows = cur.fetchall()
    out = []
    for call_id, facts, tries in rows:
        row = dict(facts or {})
        row["call_id"] = call_id
        row["hand_attempts"] = tries
        out.append(row)
    return out


def usable(row: dict) -> str:
    """'' when the door would accept this row, else why; a call and its matters stand or fall together."""
    call = (row or {}).get("call") or {}
    call_id = str(call.get("call_id") or "")
    if not call_id:
        return "the parked facts carry no call_id — the door cannot match or patch a call without one"
    if len(call_id) > 60:
        return f"the call_id is {len(call_id)} characters and the door keeps 60"
    state = str(call.get("read_state") or "").lower()
    if state not in DOOR_READ_STATES:
        return f"read_state {state!r} is not one of {', '.join(DOOR_READ_STATES)}"
    for item in (row.get("items") or []):
        if str(item.get("call_id") or "") != call_id:
            return "a matter names a different call than the row it is parked with"
        digits = "".join(ch for ch in str(item.get("item_no") or "") if ch.isdigit())
        if not digits:
            return "a matter carries no item number, so the door cannot give it an id"
        if str(item.get("work_type") or "") not in DOOR_WORK_TYPES:
            return f"a matter's work_type {str(item.get('work_type'))!r} is not one the door knows"
    return ""


def plan(rows: list[dict]) -> list[list[dict]]:
    """Parked rows cut into hand-overs by whichever ceiling comes first. Pure."""
    out: list[list[dict]] = []
    batch: list[dict] = []
    items = 0
    for row in rows:
        n = len(row.get("items") or [])
        if batch and (len(batch) >= BATCH or items + n > ITEM_BATCH):
            out.append(batch)
            batch, items = [], 0
        batch.append(row)
        items += n
    if batch:
        out.append(batch)
    return out


def verify(carried: list[dict], door: dict) -> str:
    """'' only when the door's counts prove it kept the whole batch; a 200 alone is not proof."""
    calls = len(carried)
    items = sum(len(r.get("items") or []) for r in carried)
    kept_calls = int(door.get("kept_calls") or 0)
    kept_items = int(door.get("kept_items") or 0)
    if kept_calls == calls and kept_items == items:
        return ""
    why = (f"the door kept {kept_calls} of {calls} call(s) and {kept_items} of "
           f"{items} matter(s)")
    if door.get("refused"):
        why += f" · it refused {door['refused']} row(s)"
    if door.get("overflow"):
        why += f" · {door['overflow']} row(s) past its cap"
    return why


def hand_over(post: Callable[[dict], dict], calls: list[dict], items: list[dict],
              source_at: str) -> dict:
    """One batch to the door; never raises, so unreached, refused and answered stay distinct."""
    try:
        env = post({"action": "commCallsIngest",
                    "payload": payload(calls, items, source_at)}) or {}
    except Exception as exc:  # noqa: BLE001
        return {"reached": False, "status": None, "data": {},
                "message": f"the door could not be reached ({type(exc).__name__}: "
                           f"{str(exc)[:120]})"}
    status = env.get("status")
    if env.get("held"):
        # A gate held the post on this side: nothing reached the door, so nothing is charged.
        return {"reached": False, "held": True, "status": status, "data": {},
                "message": f"held on this side: {str(env.get('message') or '')[:180]}"}
    if status != 200:
        return {"reached": True, "status": status, "data": {},
                "message": str(env.get("message") or env)[:200]}
    return {"reached": True, "status": 200, "data": env.get("data") or {}, "message": ""}


DOOR_APP = "comm-calls"
# passes one hand-over may take while the door hands rows back (the relay's COMM_CALLS_PASSES)
DOOR_PASSES = 30


def door(timeout: int = 300) -> Callable[[dict], dict] | None:
    """The lane's post on Python (app/comm_calls_writes.py) from this machine's asa-hub-app token, as the relay's
    _comm_calls_python posts it: commCallsWho a read, the ingest kept pass by pass while it hands rows back, a held lock
    or no answer said as held so the feed parks. None (no token) is reported as no-door, not zero."""
    url = os.getenv("HUB_APP_URL", "http://asa-hub-app:8080").rstrip("/")
    kept = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".hub-app-token")
    token = os.getenv("HUB_APP_TOKEN", "") or (open(kept).read().strip() if os.path.isfile(kept) else "")
    if not token:
        return None

    def call(action: str, payload: Any, write_id: str = "") -> dict | None:
        body = {"payload": payload, **({"write_id": write_id} if write_id else {})}
        req = urllib.request.Request(
            f"{url}/v1/{DOOR_APP}/{action}", data=json.dumps(body).encode(),
            headers={"Content-Type": "application/json", "X-Hub-Token": token,
                     "X-Hub-User": json.dumps({"is_service": True})})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as res:
                env = json.loads(res.read().decode("utf-8", "replace"))
        except (urllib.error.URLError, OSError, ValueError):
            return None
        return env if isinstance(env, dict) and isinstance(env.get("status"), int) else None

    def post(body: dict) -> dict:
        # The ingest gate first: a held post neither leaves nor is journaled.
        import lane_gate  # noqa: PLC0415 — same directory; a gate that will not load stops the post
        action, payload = str(body.get("action") or ""), body.get("payload") or {}
        gate = lane_gate.action_gate(action)
        if gate["held"]:
            return lane_gate.refused(gate["why"])
        if action == "commCallsWho":
            return call(action, payload) or {"status": 503, "message": "Python did not answer"}
        for _ in range(DOOR_PASSES):
            write_id = "W" + hashlib.sha256(f"comm-calls|{time.time_ns()}".encode()).hexdigest()[:24]
            env = call(action, payload, write_id)
            if env is None or env.get("status") == 409:
                return {"status": 409, "held": True,
                        "message": str((env or {}).get("message") or "Python did not answer")}
            env.pop("_write", None)
            left = (env.get("data") or {}).pop("left", None) if isinstance(env.get("data"), dict) else None
            if not left:
                return env
            payload = left
        return {"status": 409, "held": True, "message": f"the hand-over outran its {DOOR_PASSES} passes"}

    return post


def parked_count(dsn: str) -> int:
    """Deliverable parked rows (the backpressure); held rows are excluded so they never trip PARK_MAX."""
    with _connect(dsn) as conn, conn.cursor() as cur:
        cur.execute(f"select count(*) from {LEDGER} "
                    f"where facts is not null and landed_at is null and state <> all(%s)",
                    (list(HELD),))
        return (cur.fetchone() or [0])[0]


def held_count(dsn: str) -> dict:
    """Rows that ended without reaching the house, counted by state."""
    out = {"refused": 0, "unusable": 0}
    try:
        with _connect(dsn) as conn, conn.cursor() as cur:
            cur.execute(f"""select state, count(*) from {LEDGER}
                             where state = any(%s) group by state""", (list(HELD),))
            for state, n in cur.fetchall():
                out[state] = n
    except Exception:  # noqa: BLE001
        pass
    return out


def deliver(dsn: str, post: Callable[[dict], dict] | None,
            say: Callable[[str], None] = print,
            max_batches: int = DELIVER_BATCHES) -> dict:
    """Hands parked facts to the door under none of the reading's gates; never raises, and `outcome` names which zero."""
    out: dict[str, Any] = {
        "outcome": "", "why": "", "attempted": False, "answered": False,
        "parked": 0, "carried": 0, "landed": 0, "unusable": 0, "quarantined": 0,
        "batches": 0, "remaining": 0, "door": [], "refused": "", "status": None,
    }
    try:
        return _deliver(dsn, post, say, max_batches, out)
    except Exception as exc:  # noqa: BLE001
        out["outcome"] = out["outcome"] or "no-ledger"
        out["why"] = (f"the pass stopped on {type(exc).__name__}: {str(exc)[:140]} — "
                      f"{out['landed']} call(s) had landed by then and the rest stay "
                      f"parked; what remains is unknown, not zero")
        return out


def _deliver(dsn: str, post: Callable[[dict], dict] | None,
             say: Callable[[str], None], max_batches: int, out: dict) -> dict:
    """The pass itself; `deliver` is its guard rail."""
    try:
        _hand_columns(dsn)
        total = parked_count(dsn)
    except Exception as exc:  # noqa: BLE001
        out["outcome"] = "no-ledger"
        out["why"] = (f"the ledger could not be read ({type(exc).__name__}: "
                      f"{str(exc)[:120]}) — what is parked is unknown, which is not "
                      f"the same as nothing being parked")
        return out
    out["parked"] = out["remaining"] = total
    if not total:
        out["outcome"] = "nothing-parked"
        out["why"] = "every call the ledger has read is already in the house"
        return out
    if post is None:
        out["outcome"] = "no-door"
        out["why"] = (f"{total} read and sealed call(s) are parked and this process holds no "
                      f"service credential to hand them over — they are waiting, not missing")
        say("· " + out["why"])
        return out

    # Named before carried: one refused row would otherwise sink its whole batch every pass.
    fit: list[dict] = []
    for row in pending(dsn, limit=BATCH * max(1, max_batches)):
        why = usable(row)
        if not why:
            fit.append(row)
            continue
        out["unusable"] += 1
        unusable(dsn, row.get("call_id") or "", why)
        say(f"· call {row.get('call_id')} cannot be given to the house: {why} — its facts "
            f"are kept and it will not be read again")
    if not fit:
        out["remaining"] = parked_count(dsn)
        out["outcome"] = "unusable"
        out["why"] = (f"{out['unusable']} parked call(s) were filed by name because the door's "
                      f"own preconditions refuse them — nothing was carried and no execution "
                      f"was spent; {out['remaining']} call(s) remain parked")
        return out

    first_failure = ""
    for batch in plan(fit)[:max(1, max_batches)]:
        calls = [r["call"] for r in batch]
        items = [i for r in batch for i in (r.get("items") or [])]
        ids = [r["call_id"] for r in batch]
        out["attempted"] = True
        out["carried"] += len(calls)
        out["batches"] += 1
        got = hand_over(post, calls, items, _stamp())
        out["status"] = got["status"]
        out["answered"] = out["answered"] or got["reached"]
        if not got["reached"]:
            # Held or unreached: the door never answered, so the rows stay parked uncharged.
            out["outcome"] = "held" if got.get("held") else "unreachable"
            first_failure = got["message"]
            hand_noted(dsn, ids, first_failure, answered=False)
            break
        if got["status"] != 200:
            out["outcome"] = "refused"
            out["refused"] = got["message"]
            first_failure = f"the door answered {got['status']}: {got['message']}"
            out["quarantined"] += len(hand_noted(dsn, ids, first_failure, answered=True))
            break
        short = verify(batch, got["data"])
        if short:
            out["outcome"] = "mismatch"
            first_failure = short
            out["quarantined"] += len(hand_noted(dsn, ids, short, answered=True))
            break
        out["door"].append(got["data"])
        out["landed"] += landed(dsn, ids)
        say(f"  {len(ids)} call(s) landed · the door says "
            f"{json.dumps(got['data'], default=str)[:200]}")

    out["remaining"] = parked_count(dsn)
    if first_failure:
        if out["landed"]:
            out["outcome"] = "partial"
        out["why"] = (f"{out['landed']} call(s) landed and then the hand-over stopped: "
                      f"{first_failure}. {out['remaining']} call(s) stay parked and will be "
                      f"offered again; none of them will be read a second time")
        if out["quarantined"]:
            out["why"] += (f" · {out['quarantined']} row(s) reached {HAND_MAX} refusals and "
                           f"are held for a person to look at")
    else:
        out["outcome"] = "landed"
        out["why"] = (f"{out['landed']} call(s) are in the house"
                      + (f" · {out['remaining']} still parked for the next pass"
                         if out["remaining"] else " · nothing is parked"))
    return out


def say_line(got: dict) -> str:
    """The one log sentence every caller of `deliver` uses."""
    return (f"comm calls delivery: {got.get('outcome') or 'unknown'} — {got.get('why') or ''}"
            + (f" · {got['unusable']} unusable" if got.get("unusable") else "")
            + (f" · {got['batches']} execution(s)" if got.get("batches") else ""))


def run(dsn: str, limit: int, post: Callable[[dict], dict] | None = None,
        newest_first: bool = True, only: list[str] | None = None,
        gate: bool = True, say: Callable[[str], None] = print,
        http: Any = None) -> dict:
    """The engine both cadences use; a rehearsal over named calls (`only`) may bypass the switch."""
    state = ready(dsn)
    if not state["tables"]:
        raise LaneUnavailable("; ".join(state["why"]))

    # Deliver before every gate: the switch and the key govern reading only.
    first = deliver(dsn, post, say=say)
    if first["parked"]:
        say("· " + say_line(first))

    if not state["key"]:
        raise LaneUnavailable(
            "nothing may be read: " + "; ".join(state["why"])
            + ". A call read before there is a key to seal with leaves the words in the clear.",
            delivery=first)
    if gate and not state["enabled"]:
        raise LaneUnavailable("the switch is off — a person starts this lane, "
                              "the lane never starts itself",
                              delivery=first)

    mod = reading()
    run_id = f"{int(time.time())}"
    out = {"run_id": run_id, "read": 0, "unreadable": 0, "skipped": 0,
           "too_long": 0, "window_chars": mod.window(),
           "items": 0, "coerced": 0, "invented": 0, "sealed": 0, "landed": 0,
           "parked": 0, "stopped": "", "by_type": {}, "by_state": {},
           "delivery": first, "executions": first["batches"]}
    out["landed"] += first["landed"]
    out["parked"] = parked_count(dsn)
    if out["parked"] >= PARK_MAX:
        out["stopped"] = (f"{out['parked']} call(s) are read, sealed and waiting on the "
                          f"door — reading stops until it accepts them")
        say("· " + out["stopped"])
        return out

    rows = mod.pile(dsn, exclude=seen(dsn), limit=limit,
                    newest_first=newest_first, only=only or ())
    if not rows:
        return out
    say(f"· {len(rows)} call(s) to read this pass")

    # One resolver call per batch: the far side rebuilds its index on every call.
    whois = who([mod.caller_digits(r.get("participant_s")) for r in rows], post)

    fresh = 0
    for n, row in enumerate(rows, start=1):
        if gate and not running(dsn):
            out["stopped"] = "the switch is off"
            break
        # Too long for every door: left unclaimed so a wider door can read it later.
        if not mod.fits(len(str(row.get(mod.READ_FIELD) or ""))):
            out["too_long"] += 1
            continue
        got = read_one(dsn, row, whois, run_id, http=http)
        if got is None:
            out["skipped"] += 1
            continue
        out["sealed"] += 1
        if got["state"] == "read":
            out["read"] += 1
            out["items"] += len(got["items"])
            out["coerced"] += got["coerced"]
            out["invented"] += got["invented"]
            for item in got["items"]:
                out["by_type"][item["work_type"]] = out["by_type"].get(item["work_type"], 0) + 1
        else:
            out["unreadable"] += 1
        who_state = got["call"]["who_state"]
        out["by_state"][who_state] = out["by_state"].get(who_state, 0) + 1
        fresh += 1
        if fresh >= BATCH:
            mid = _flush(dsn, post, say)
            out["landed"] += mid["landed"]
            out["executions"] += mid["batches"]
            out["delivery"] = _worse(out["delivery"], mid)
            fresh = 0
        if n % 10 == 0 or n == len(rows):
            say(f"  {n}/{len(rows)} · read {out['read']} · unreadable "
                f"{out['unreadable']} · items {out['items']}")
    if fresh:
        tail = _flush(dsn, post, say)
        out["landed"] += tail["landed"]
        out["executions"] += tail["batches"]
        # A live tick's only hand-over; keep its verdict.
        out["delivery"] = _worse(out["delivery"], tail)
    out["parked"] = parked_count(dsn)
    return out


def _flush(dsn: str, post: Callable[[dict], dict] | None,
           say: Callable[[str], None]) -> dict:
    """Hands over from the ledger (never an in-memory list) and returns the whole verdict, not a count."""
    if post is None:
        return deliver(dsn, None, say=say, max_batches=1)
    got = deliver(dsn, post, say=say)
    if got["outcome"] not in ("landed", "nothing-parked"):
        say("  " + say_line(got))
    return got


_DELIVERY_CLEAN = ("landed", "nothing-parked")


def _worse(held: dict, got: dict) -> dict:
    """The first unclean verdict wins over any later success; otherwise the latest stands."""
    if held and held.get("outcome") not in _DELIVERY_CLEAN:
        return held
    if got.get("outcome") not in _DELIVERY_CLEAN:
        return got
    return got or held


def live(dsn: str, post: Callable[[dict], dict] | None,
         say: Callable[[str], None] = print) -> dict:
    """Arriving calls on the relay's clock; inert until the seal key is present and the switch is on."""
    return run(dsn, LIVE_MAX, post=post, newest_first=True, say=say)


def catch_up(dsn: str, post: Callable[[dict], dict] | None, limit: int = 0,
             say: Callable[[str], None] = print) -> dict:
    """The backlog, newest first; `limit` 0 means the whole pile, still stoppable per call."""
    return run(dsn, limit, post=post, newest_first=True, say=say)


def status(dsn: str) -> dict:
    """Where the catch-up got to, answered from the ledger alone."""
    out: dict[str, Any] = {"ready": ready(dsn)}
    # Before the transaction opens: the ALTER would otherwise wait on this function's own lock.
    books = _hand_columns(dsn)
    try:
        with _connect(dsn) as conn, conn.cursor() as cur:
            cur.execute(f"""select state, count(*), min(read_at), max(read_at)
                              from {LEDGER} group by state order by 2 desc""")
            out["ledger"] = [{"state": r[0], "calls": r[1],
                              "first": str(r[2] or ""), "last": str(r[3] or "")}
                             for r in cur.fetchall()]
            cur.execute(f"""select count(*) filter (where landed_at is null
                                                      and facts is not null
                                                      and state <> all(%s)),
                                   count(*) filter (where landed_at is not null),
                                   count(*) filter (where state = 'refused'),
                                   count(*) filter (where state = 'unusable'),
                                   count(*) filter (where state = 'reading'
                                                      and facts is null
                                                      and claimed_at < now()
                                                          - make_interval(secs => %s))
                              from {LEDGER}""", (list(HELD), STALE_READING_S))
            row = cur.fetchone() or (0, 0, 0, 0, 0)
            out["parked"] = row[0]
            out["landed"] = row[1]
            out["held"] = {"refused_by_the_door": row[2],
                           "the_door_would_never_accept": row[3]}
            out["abandoned_claims_to_retry"] = row[4]
            out["hand_bookkeeping"] = books
            if books:
                cur.execute(f"""select call_id, hand_attempts, hand_error from {LEDGER}
                                 where hand_error is not null and landed_at is null
                                 order by hand_at desc nulls last limit 5""")
                out["last_refusals"] = [{"call_id": r[0], "tries": r[1],
                                         "why": (r[2] or "")[:200]}
                                        for r in cur.fetchall()]
            cur.execute(f"""select count(*), coalesce(sum(plain_len),0),
                                   coalesce(sum(cipher_len),0), count(distinct recipient_fpr)
                              from {SEALS}""")
            row = cur.fetchone() or (0, 0, 0, 0)
            out["seals"] = {"rows": row[0], "chars_sealed": row[1],
                            "cipher_bytes": row[2], "keys": row[3]}
            mod = reading()
            cur.execute(f"""select count(*),
                                   count(*) filter (where length(full_transcript) > %s)
                              from {mod.MIRROR}
                             where coalesce(call_id,'') <> ''
                               and coalesce(full_transcript,'') <> ''
                               and call_id not in (select call_id from {LEDGER})""",
                        (mod.window(),))
            row = cur.fetchone() or (0, 0)
            out["remaining"] = row[0]
            out["too_long_for_this_door"] = row[1]
            out["window_chars"] = mod.window()
    except Exception as exc:  # noqa: BLE001
        out["error"] = f"{type(exc).__name__}: {str(exc)[:200]}"
    return out


def _cli() -> None:
    """status · start · stop · run · deliver; `start` only flips the switch, it reads nothing."""
    dsn = os.getenv("HUB_SNAPSHOT_PG_DSN") or os.getenv("DATABASE_URL") or ""
    if not dsn:
        sys.exit("HUB_SNAPSHOT_PG_DSN is not set")
    verb = sys.argv[1] if len(sys.argv) > 1 else "status"
    rest = sys.argv[2:]
    if verb == "status":
        print(json.dumps(status(dsn), indent=2, default=str))
        return
    if verb in ("start", "stop"):
        note = " ".join(rest)
        print(json.dumps(switch(dsn, verb == "start", note=note), indent=2, default=str))
        return
    if verb == "deliver":
        # `deliver [n]` spends at most n executions and reads nothing, so it is safe beside a running catch-up.
        batches = int(rest[0]) if rest and rest[0].isdigit() else DELIVER_BATCHES
        got = deliver(dsn, door(), max_batches=batches)
        print(json.dumps(got, indent=2, default=str))
        print(say_line(got))
        return
    if verb == "run":
        limit = int(rest[0]) if rest and rest[0].isdigit() else 0
        try:
            print(json.dumps(catch_up(dsn, door(), limit=limit), indent=2, default=str))
        except LaneUnavailable as exc:
            # Reading stopped, but run() may already have delivered; report that too.
            print(json.dumps({"stopped": str(exc), "delivery": exc.delivery},
                             indent=2, default=str))
            if exc.delivery:
                print(say_line(exc.delivery))
            sys.exit(f"nothing was read: {exc}")
        return
    sys.exit("usage: comm_calls_feed.py [status|start|stop|run [n]|deliver [batches]]")


if __name__ == "__main__":
    _cli()
