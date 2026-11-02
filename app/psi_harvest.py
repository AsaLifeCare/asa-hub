"""PSI LOG'S COLLECTION — everything PsiAnywhere answers about staff, clients and their places, kept in the Hub (the
operator, 2026-10-28: "dentro desse App pode criar mais páginas e coletar 100% de tudo o que conseguir via PSI dos
usuarios staff e clients e logs").

Each KIND is one PsiAnywhere read, sent as its own screens send it (methods and payloads from its bundle.js): a list
read once (the active employees, every consumer, the locations, the work codes…) or a read per item of another kind
(each consumer's demographics, relationships and notes; each supervisor's employees; each user's credential dates).
Every row it answers lands in app.psi_harvest (db/psi_harvest.sql) under (kind, key), refreshed on each run and never
taken out — seen_at says when PsiAnywhere last answered it. Every cell passes the platform's one withholding rule
(server/redaction.py) first: an SSN, a card, a password or an identifier the rule names is kept as its marker, never
its value. Each run is a row of app.psi_harvest_runs, with what each kind answered or why it could not.

The run goes over the platform's one PsiAnywhere wire (psi_attendance._ask), paced and held while PsiAnywhere is DOWN.
It uses the master's PSI Log session when he is signed in, else the platform's own sign-in, through the login clock
that rations it (psi_attendance._sign_in). One run at a time. The time entries are not collected again here: the
attendance lane already keeps every punch (the full punches' house, PUNCHES), which the app reads."""
from __future__ import annotations

import hashlib
import json
import logging
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any, Callable

log = logging.getLogger("asa-hub-app.psi-harvest")

TIMEOUT_S = 45.0
# a row's key: the first of these its answer carries, else a digest of the row
ID_KEYS = ("id", "ID", "consumerId", "consumer_id", "consumerID", "peopleId", "PeopleID", "people_id", "person_id",
           "personId", "Person_ID", "userId", "UserID", "user_id", "User_ID", "employeeId", "EmployeeID",
           "workcodeid", "locationId", "locationID", "Location_ID", "periodId", "code", "Code")


@dataclass
class Run:
    token: str
    user_id: str
    today: Any
    rows: dict[str, list[dict[str, Any]]] = field(default_factory=dict)


def _token(c: Run) -> dict[str, Any]:
    return {"token": c.token}


# (kind, page, label, method, body) — read once
LISTS: list[tuple[str, str, str, str, Callable[[Run], dict[str, Any]]]] = [
    ("staff.active", "staff", "Active employees", "getActiveEmployees", _token),
    ("staff.list", "staff", "Employee list", "getEmployeeList", _token),
    # getAllEmployees is getEmployeesForScheduling — a scheduling-user dropdown this account does not populate (it
    # answered 0). Every employee is already here through active, list and the two user reads, so it is not collected.
    ("staff.users-active", "staff", "Users (active)", "getActiveInactiveUserDateJSON",
     lambda c: {"token": c.token, "isActive": "Y"}),
    ("staff.users-inactive", "staff", "Users (inactive)", "getActiveInactiveUserDateJSON",
     lambda c: {"token": c.token, "isActive": "N"}),
    ("staff.supervisors", "staff", "Supervisors", "getSingleEntrySupervisorsJSON", _token),
    ("staff.statuses", "other", "Employee statuses", "getEmployeeStatusDropDown", _token),
    # getConsumersByGroupJSON's isActive is "Show Inactives": "No" is the active caseload, "Yes" brings the inactive
    # ones too; EVERYONE ("%") is the widest group, so clients.all reads everyone, inactive included
    ("clients.active", "clients", "Clients (active)", "getConsumersByGroupJSON",
     lambda c: {"groupCode": "All", "retrieveId": "0", "token": c.token, "serviceDate": c.today.isoformat(),
                "daysBackDate": (c.today - timedelta(days=7)).isoformat(), "isActive": "No"}),
    ("clients.all", "clients", "Clients (all, inactive included)", "getConsumersByGroupJSON",
     lambda c: {"groupCode": "%", "retrieveId": "%", "token": c.token, "serviceDate": c.today.isoformat(),
                "daysBackDate": (c.today - timedelta(days=7)).isoformat(), "isActive": "Yes"}),
    ("clients.numbers", "clients", "Client numbers (every client on record)", "getConsumerNumberList", _token),
    ("places.locations", "other", "Locations", "getLocationsJSON", _token),
    ("places.residences", "other", "Locations and residences", "getLocationsAndResidencesJSON", _token),
    ("places.time-entry", "other", "Time entry locations", "getAdminSingleEntryLocationsJSON", _token),
    ("codes.work", "other", "Work codes", "getWorkCodesJSON", _token),
    ("codes.call-off", "other", "Call-off reasons", "getCallOffDropdownReasons", _token),
    # getSchedulingPeriods answered nothing: ASA runs its shifts on the Hub's own calendars, not PsiAnywhere's
    # scheduling module, so there are no periods to collect. Left out rather than kept as a standing zero.
]

# (kind, page, label, method, the kind whose items it reads, their id keys, body) — read per item
PER_ITEM: list[tuple[str, str, str, str, str, tuple[str, ...], Callable[[Run, str], dict[str, Any]]]] = [
    ("staff.by-supervisor", "staff", "Employees by supervisor", "getEmployeeListAndCountInfoJSON",
     "staff.supervisors", ("person_id", "personId", "id"),
     lambda c, i: {"token": c.token, "supervisorId": i}),
    ("staff.credentials", "staff", "Credential dates", "getUserCredDateJSON", "staff.users-active",
     ("UserID", "userId", "User_ID", "user_id", "userid"), lambda c, i: {"token": c.token, "userId": i}),
    ("clients.demographics", "clients", "Demographics", "getConsumerDemographicsJSON", "clients.all",
     ("id", "consumerId", "consumer_id", "ID"), lambda c, i: {"token": c.token, "consumerId": i}),
    ("clients.relationships", "clients", "Relationships", "getConsumerRelationshipsJSON", "clients.all",
     ("id", "consumerId", "consumer_id", "ID"), lambda c, i: {"token": c.token, "consumerId": i}),
    ("clients.notes", "clients", "Demographics notes", "getDemographicsNotesJSON", "clients.all",
     ("id", "consumerId", "consumer_id", "ID"), lambda c, i: {"token": c.token, "consumerId": i}),
]

KINDS: dict[str, dict[str, str]] = {
    **{k: {"page": p, "label": lab, "method": m} for k, p, lab, m, _b in LISTS},
    **{k: {"page": p, "label": lab, "method": m, "of": of} for k, p, lab, m, of, _ids, _b in PER_ITEM},
}

_RUN = threading.Lock()
STATUS: dict[str, Any] = {"running": False, "kind": "", "done": 0, "of": 0, "started": ""}


# ---- shaping what PsiAnywhere answers ----------------------------------------------------------------------------------

def rows_of(answer: Any) -> list[dict[str, Any]]:
    if isinstance(answer, str) and answer.strip().startswith(("[", "{")):
        try:
            answer = json.loads(answer)
        except ValueError:
            return [{"value": answer}]
    if isinstance(answer, dict):
        inner = [v for v in answer.values() if isinstance(v, list) and v and all(isinstance(x, dict) for x in v)]
        return inner[0] if len(inner) == 1 else [answer]
    if isinstance(answer, list):
        return [r if isinstance(r, dict) else {"value": r} for r in answer]
    return [{"value": answer}] if answer not in (None, "") else []


def flat(row: dict[str, Any]) -> dict[str, Any]:
    """One level: a nested value kept as its JSON text."""
    return {str(k): (json.dumps(v, default=str) if isinstance(v, (dict, list)) else v) for k, v in row.items()}


def first_id(row: dict[str, Any], keys: tuple[str, ...] = ID_KEYS) -> str:
    low = {str(k).lower(): v for k, v in row.items()}
    for k in keys:
        v = low.get(k.lower())
        if v not in (None, "") and str(v).strip():
            return str(v).strip()
    return ""


def key_of(row: dict[str, Any], item: str = "") -> str:
    k = first_id(row) or hashlib.sha1(json.dumps(row, sort_keys=True, default=str).encode()).hexdigest()[:16]
    return f"{item}:{k}" if item else k


def withheld(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Every row as the platform's withholding rule lets a copy keep it; nothing is kept without the rule."""
    import essential_sheets  # noqa: PLC0415 - the rule is mounted once, read where the sweep reads it
    R = essential_sheets.rule()
    return [R.redact_row(flat(r))[0] for r in rows]


# ---- keeping it --------------------------------------------------------------------------------------------------------

def keep(store: Any, run_id: int, kind: str, rows: list[tuple[str, str, dict[str, Any]]]) -> None:
    """(key, item, cells) rows into app.psi_harvest: added, or refreshed with the time PsiAnywhere answered them."""
    if not rows:
        return
    with store.locked() as tx:
        for key, item, cells in rows:
            tx.cur.execute(
                "insert into app.psi_harvest (kind, key, item, cells, run_id) values (%s, %s, %s, %s, %s)"
                " on conflict (kind, key) do update set item = excluded.item, cells = excluded.cells,"
                " seen_at = now(), run_id = excluded.run_id", (kind, key, item, json.dumps(cells, default=str), run_id))


def _run_row(store: Any, asked_by: str) -> int:
    with store.locked() as tx:
        tx.cur.execute("insert into app.psi_harvest_runs (asked_by) values (%s) returning id", (asked_by,))
        return int(tx.cur.fetchone()[0])


def _run_done(store: Any, run_id: int, result: dict[str, Any]) -> None:
    with store.locked() as tx:
        tx.cur.execute("update app.psi_harvest_runs set finished_at = now(), result = %s where id = %s",
                       (json.dumps(result, default=str), run_id))


# ---- the run -----------------------------------------------------------------------------------------------------------

def harvest(store: Any, ask: Callable[[str, dict[str, Any]], Any], token: str, user_id: str, asked_by: str,
            today: Any = None) -> dict[str, Any]:
    """Every kind read and kept; {kind: {rows, items?} or {skipped: why}}. One run at a time."""
    if not _RUN.acquire(blocking=False):
        return {"busy": "a collection is running now"}
    try:
        from zoneinfo import ZoneInfo  # noqa: PLC0415
        c = Run(token, user_id, today or datetime.now(ZoneInfo("America/New_York")).date())
        run_id = _run_row(store, asked_by)
        out: dict[str, Any] = {}
        STATUS.update(running=True, done=0, of=len(LISTS) + len(PER_ITEM), started=datetime.utcnow().isoformat())
        for kind, _page, _label, method, body in LISTS:
            STATUS["kind"] = kind
            try:
                got = rows_of(ask(method, body(c)))
                c.rows[kind] = got
                keep(store, run_id, kind, [(key_of(r), "", cells) for r, cells in zip(got, withheld(got))])
                out[kind] = {"rows": len(got)}
            except Exception as exc:  # noqa: BLE001 - said in the result, the other kinds go on
                out[kind] = {"skipped": f"{type(exc).__name__}: {str(exc)[:160]}"}
            STATUS["done"] += 1
        for kind, _page, _label, method, of, ids, body in PER_ITEM:
            STATUS["kind"] = kind
            items = list(dict.fromkeys(i for i in (first_id(r, ids) for r in c.rows.get(of, [])) if i))
            if of not in c.rows:
                out[kind] = {"skipped": f"{of} was not read"}
                STATUS["done"] += 1
                continue
            rows_n, missed, first_miss = 0, 0, ""
            for item in items:
                try:
                    got = rows_of(ask(method, body(c, item)))
                    keep(store, run_id, kind, [(key_of(r, item), item, dict(cells, _of=item))
                                               for r, cells in zip(got, withheld(got))])
                    rows_n += len(got)
                except Exception as exc:  # noqa: BLE001 - one item's miss is counted, the rest are read
                    missed += 1
                    first_miss = first_miss or f"{type(exc).__name__}: {str(exc)[:120]}"
            out[kind] = {"rows": rows_n, "items": len(items), "missed": missed,
                         **({"firstMiss": first_miss} if first_miss else {})}
            STATUS["done"] += 1
        _run_done(store, run_id, out)
        return {"run": run_id, **out}
    finally:
        STATUS.update(running=False, kind="")
        _RUN.release()


def said(out: dict[str, Any]) -> str:
    parts = []
    for kind, r in out.items():
        if isinstance(r, dict):
            parts.append(f"{kind} {'not read' if r.get('skipped') else r.get('rows', 0)}")
    return ", ".join(parts)


# ---- reading it back ---------------------------------------------------------------------------------------------------

def kinds_of(reads: Any, page: str) -> list[dict[str, Any]]:
    """The page's kinds, each with how many rows are kept and when PsiAnywhere last answered."""
    names = [k for k, v in KINDS.items() if v["page"] == page]
    counts = {k: (n, at) for k, n, at in reads.db.query(
        "select kind, count(*), max(seen_at) from app.psi_harvest where kind = any(%s) group by kind", (names,))}
    return [{"kind": k, "label": KINDS[k]["label"], "method": KINDS[k]["method"], "of": KINDS[k].get("of", ""),
             "rows": int(counts.get(k, (0, None))[0]),
             "seenAt": (counts[k][1].isoformat() if k in counts and counts[k][1] else "")} for k in names]


def rows(reads: Any, kind: str, q: str = "", limit: int = 500, offset: int = 0) -> dict[str, Any]:
    """One kind's rows, newest seen first, filtered by any cell containing `q`."""
    where, params = "kind = %s", [kind]
    if q.strip():
        where += " and cells::text ilike %s"
        params.append(f"%{q.strip()}%")
    total = int(reads.db.query(f"select count(*) from app.psi_harvest where {where}", tuple(params))[0][0])
    got = reads.db.query(f"select key, item, cells, seen_at from app.psi_harvest where {where}"
                         " order by item, key limit %s offset %s", tuple(params + [limit, offset]))
    out, cols = [], {}
    for key, item, cells, seen in got:
        c = cells if isinstance(cells, dict) else json.loads(cells or "{}")
        out.append({"_key": key, "_item": item, "_seenAt": seen.isoformat() if seen else "", **c})
        for k in c:
            cols[k] = cols.get(k, 0) + 1
    columns = [k for k, _n in sorted(cols.items(), key=lambda kv: -kv[1]) if k != "_of"]
    return {"kind": kind, "label": KINDS.get(kind, {}).get("label", kind), "total": total, "columns": columns,
            "rows": out}


def runs(reads: Any, limit: int = 10) -> list[dict[str, Any]]:
    got = reads.db.query("select id, started_at, finished_at, asked_by, result from app.psi_harvest_runs"
                         " order by id desc limit %s", (limit,))
    return [{"id": i, "startedAt": s.isoformat() if s else "", "finishedAt": f.isoformat() if f else "",
             "by": by, "result": r if isinstance(r, dict) else json.loads(r or "{}")} for i, s, f, by, r in got]


# every punch PsiAnywhere holds, as the attendance lane keeps it: the full punches' house (psi_punches_full, its rows on
# app.resource_rows), the August copy and every live read since, one row per entry
PUNCHES = "bk1ttZRJPsiPunchesFull"
PUNCH_FIELDS = (("id", "single_entry_id"), ("status", "status"), ("employee", "employee"), ("date", "date_iso"),
                ("start", "start_time"), ("end", "end_time"), ("hours", "hours"), ("house", "house"),
                ("location", "location_name"), ("workCode", "work_code"), ("consumers", "consumers"),
                ("people", "consumers_present"), ("comments", "comments"), ("submittedBy", "submitted_user"),
                ("approvedBy", "approved_user"), ("latitude", "latitude"), ("longitude", "longitude"),
                ("evvReasons", "evv_reasons"), ("signed", "has_signature"), ("documented", "is_documented"),
                ("source", "source"), ("syncedAt", "source_synced_at"))


def entries(reads: Any, day_from: str, day_to: str, q: str = "", limit: int = 1000) -> dict[str, Any]:
    """The punches between two days (New York service days), any text filtered, newest first."""
    where = "resource = %s and removed_at is null and cells->>'date_iso' between %s and %s"
    params: list[Any] = [PUNCHES, day_from, day_to]
    if q.strip():
        where += " and cells::text ilike %s"
        params.append(f"%{q.strip()}%")
    got = reads.db.query(f"select cells from app.resource_rows where {where}"
                         " order by cells->>'date_iso' desc, cells->>'single_entry_id' desc limit %s",
                         tuple(params + [limit]))
    out = []
    for (cells,) in got:
        c = cells if isinstance(cells, dict) else json.loads(cells or "{}")
        d = {name: c.get(col, "") for name, col in PUNCH_FIELDS}
        try:
            d["hours"] = float(d["hours"]) if str(d["hours"]).strip() else None
        except ValueError:
            d["hours"] = None
        out.append(d)
    return {"from": day_from, "to": day_to, "rows": out, "hours": round(sum(r["hours"] or 0 for r in out), 2)}


def ask(method: str, body: dict[str, Any]) -> Any:
    """One read on the platform's PsiAnywhere wire."""
    import psi_attendance as PA  # noqa: PLC0415
    return PA._ask(method, body, TIMEOUT_S)


def platform_session() -> tuple[str, str, str]:
    """(token, user id, why not) from the platform's own sign-in, through the login clock that rations it."""
    import psi_anywhere  # noqa: PLC0415
    import psi_attendance as PA  # noqa: PLC0415
    got = PA._sign_in(TIMEOUT_S, purpose="psi log collection")
    if not got.get("token"):
        return "", "", str(got.get("why") or got.get("word") or "the platform did not sign in")
    return str(got["token"]), psi_anywhere._credential(got.get("account"))[0], ""


DAILY_AT = (4, 30)   # New York: before the day's first shifts, when PsiAnywhere is quiet


async def daily(store: Any) -> None:
    """One collection a day at DAILY_AT, New York, with the platform's own sign-in."""
    import asyncio  # noqa: PLC0415
    from zoneinfo import ZoneInfo  # noqa: PLC0415
    ny = ZoneInfo("America/New_York")
    while True:
        now = datetime.now(ny)
        at = now.replace(hour=DAILY_AT[0], minute=DAILY_AT[1], second=0, microsecond=0)
        if at <= now:
            at += timedelta(days=1)
        await asyncio.sleep(max(1.0, (at - now).total_seconds()))
        try:
            token, user, why = await asyncio.to_thread(platform_session)
            if not token:
                log.warning("psi harvest: the daily collection did not sign in (%s)", why)
                continue
            got = await asyncio.to_thread(harvest, store, ask, token, user, "clock")
            log.info("psi harvest: daily — %s", said(got))
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 - collected again tomorrow
            log.warning("psi harvest: the daily collection failed (%s)", type(exc).__name__)


def start(store: Any, ask: Callable[[str, dict[str, Any]], Any], token: str, user_id: str, asked_by: str) -> bool:
    """The run in its own thread; False when one is running."""
    if STATUS["running"]:
        return False

    def go() -> None:
        try:
            got = harvest(store, ask, token, user_id, asked_by)
            log.info("psi harvest: by %s — %s", asked_by, said(got))
        except Exception as exc:  # noqa: BLE001 - a run that fell is logged, never the app's problem
            log.warning("psi harvest: the run fell (%s: %s)", type(exc).__name__, str(exc)[:200])

    threading.Thread(target=go, name="psi-harvest", daemon=True).start()
    time.sleep(0.05)
    return True
