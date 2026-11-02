"""commRoutesIngest (CommCortex.gs) on Python, the relay's own write: the routes its hourly hand-off computed from the
cortex, shaped one by one and upserted by id into the comm_routes house in Postgres (app/resource_rows.py
`commRoutesHouse`) — each row whole, its createdAt carried forward, the retired contact columns emptied before anything
lands. A pass stops in time and hands the rows it did not reach back to the relay, which sends them again under the same
stamp. commRoutesUpload brings the tab's copy into Postgres on the flip (rows nothing here has touched), or hands it
back."""
from __future__ import annotations

import contextlib
import math
import re
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Callable, Iterator

import comm_routes as CR
import gsjs
import hubdb
import locations as L
import resource_rows as RR
import sheet_resources as SR
import staff_views
import writes as W
from scope import Defer
from writes import Decision

# inside the write's own budget, with room left for the reads
BUDGET_S = 5.0
# lines shaped before each write, and the clock looked at
CHUNK = 200
DENIED = {"status": 403, "message": "Requires an admin or manager account"}
BUSY = "Another write holds the platform's lock; the routes go on the next tick."
# hubSysLog_'s actor for this lane
ACTOR = "asa-hub:comm"
_NUM = re.compile(r"[+-]?(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][+-]?[0-9]+)?")
_RADIX = re.compile(r"0[xX][0-9a-fA-F]+|0[oO][0-7]+|0[bB][01]+")

s_ = gsjs.str_


def _now_iso() -> str:
    """new Date().toISOString()."""
    return gsjs.iso(datetime.now(timezone.utc))


def js_slice(s: str, n: int) -> str:
    """String.prototype.slice(0, n), in UTF-16 units; a pair it cuts through ends in U+FFFD."""
    return s.encode("utf-16-le", "surrogatepass")[:2 * n].decode("utf-16-le", "replace")


def _number(v: Any) -> float:
    """Number(v); NaN when it is not one."""
    if isinstance(v, bool):
        return 1.0 if v else 0.0
    if isinstance(v, (int, float)):
        return float(v)
    t = gsjs.trim(gsjs.or_blank(v))
    if not t:
        return 0.0
    if _NUM.fullmatch(t):
        return float(t)
    if _RADIX.fullmatch(t):
        return float(int(t[2:], {"x": 16, "o": 8, "b": 2}[t[1].lower()]))
    if t in ("Infinity", "+Infinity", "-Infinity"):
        return -math.inf if t[0] == "-" else math.inf
    return math.nan


def hour(v: Any) -> str:
    """commRoutesHour_: an hour off the wire, or ''."""
    if v == "" or v is None:
        return ""
    n = _number(v)
    if not math.isfinite(n) or n < 0 or n > 23:
        return ""
    return str(math.floor(n))


def line_of(r: Any, at: str) -> dict[str, str] | None:
    """One row of the hand-off as commRoutesIngest shapes it; None for a row proposing neither a window nor a
    supervisor."""
    row = r if isinstance(r, dict) else {}
    who = s_(row.get("person_key")).lower()
    frm, to, boss = hour(row.get("window_from")), hour(row.get("window_to")), s_(row.get("supervisor"))
    if not who or ((frm == "" or to == "") and not boss):
        return None
    return {"id": "RT_" + js_slice(who, 40), "person_key": who, "name": s_(row.get("name")), "window_from": frm,
            "window_to": to, "window_why": s_(row.get("window_why")), "supervisor": boss,
            "supervisor_key": s_(row.get("supervisor_key")),
            "supervisor_confidence": s_(row.get("supervisor_confidence")), "source_at": at}


def _cell(v: Any) -> str:
    """serialize_ of what getValues handed back, as the cell holds it once set again."""
    return hubdb.cell_text(v) if isinstance(v, gsjs.SheetDate) else W.sheet_text(v)


@contextlib.contextmanager
def _savepoint() -> Iterator[None]:
    """A failed statement rolls back to here and never aborts the write's transaction."""
    cur = RR._cur()
    name = "comm_routes_" + uuid.uuid4().hex[:10]
    cur.execute(f"savepoint {name}")
    try:
        yield
    except Exception:
        cur.execute(f"rollback to savepoint {name}")
        cur.execute(f"release savepoint {name}")
        raise
    cur.execute(f"release savepoint {name}")


def retire(reads: L.Reads) -> int:
    """commRoutesRetireContacts_: the retired columns emptied on every row, those this pass will not touch too; how
    many cells held something. A column that will not empty never stops the routes landing."""
    cleared = 0
    try:
        cols = RR.columns(reads, CR.RESOURCE)
        held = RR.table_rows(reads, CR.RESOURCE)
        for col in CR.RETIRED:
            if col not in cols:
                continue
            dirty = [(k, c, {col: ""}) for k, c in held if s_(hubdb.typed(c.get(col), "hub")) != ""]
            if not dirty:
                continue
            with _savepoint():
                RR.update_many(reads, CR.RESOURCE, dirty, ACTOR)
            cleared += len(dirty)
    except Exception as exc:  # noqa: BLE001 - the routes land either way
        W.log.warning("comm routes: a retired column was not emptied (%s)", type(exc).__name__)
    return cleared


def _held(reads: L.Reads) -> dict[str, tuple[str, dict]]:
    """id → the first row holding it (its key and cells), as the grid was read once before the pass wrote."""
    where: dict[str, tuple[str, dict]] = {}
    for k, c in RR.table_rows(reads, CR.RESOURCE):
        rid = RR.row_id_of(c)
        if rid != "" and rid not in where:
            where[rid] = (k, c)
    return where


def _rid(row: dict) -> str:
    return "" if row.get("id") is None else gsjs.js_str(row["id"])


def _one(reads: L.Reads, row: dict[str, str]) -> bool:
    """commRoutesUpsert_: one row by id through the one door — over the first row holding its id with the day it first
    appeared kept, else after every other; False when it would not go in."""
    try:
        with _savepoint():
            rid = _rid(row)
            found = next(((k, c) for k, c in RR.table_rows(reads, CR.RESOURCE) if RR.row_id_of(c) == rid), None)
            row = {**row, "updatedAt": _now_iso()}
            row["createdAt"] = row["updatedAt"] if found is None else \
                _cell(hubdb.typed(found[1].get("createdAt"), "hub"))
            RR._widen(reads, CR.RESOURCE, list(row))
            full = {h: row.get(h, "") for h in RR.columns(reads, CR.RESOURCE)}
            if found is None:
                RR.create(reads, CR.RESOURCE, full, ACTOR)
            else:
                RR.update(reads, CR.RESOURCE, found[0], found[1], full, ACTOR)
        return True
    except Exception:  # noqa: BLE001 - counted refused, as a row the sheet would not take
        return False


def _one_by_one(reads: L.Reads, rows: list[dict[str, str]]) -> dict[str, int]:
    """commRoutesOneByOne_: the whole set the slow way, for a header that would not be written."""
    wrote = refused = 0
    for row in rows:
        if _rid(row) and _one(reads, row):
            wrote += 1
        else:
            refused += 1
    return {"wrote": wrote, "refused": refused}


def upsert_many(reads: L.Reads, rows: list[dict[str, str]], where: dict[str, tuple[str, dict]],
                stamp: str) -> dict[str, int]:
    """commRoutesUpsertMany_: every column a row names added once, then each row whole by id — the ones already there
    over their row with the day they first appeared kept, everybody new after the rest; {wrote, refused}."""
    if not rows:
        return {"wrote": 0, "refused": 0}
    try:
        with _savepoint():
            RR._widen(reads, CR.RESOURCE, list(dict.fromkeys(k for r in rows for k in r)) + ["createdAt", "updatedAt"])
    except Exception:  # noqa: BLE001 - without a header nothing can be shaped: each row alone
        return _one_by_one(reads, rows)
    header = RR.columns(reads, CR.RESOURCE)
    wrote = refused = 0
    updates: list[tuple[str, dict, dict[str, str], dict[str, str]]] = []
    appends: list[tuple[dict[str, str], dict[str, str]]] = []
    for row in rows:
        rid = _rid(row)
        if not rid:
            refused += 1
            continue
        hit = where.get(rid)
        row["updatedAt"] = stamp
        if hit is None:
            row["createdAt"] = stamp
        else:
            was = hubdb.typed(hit[1].get("createdAt"), "hub")
            row["createdAt"] = stamp if was == "" else _cell(was)
        full = {h: row.get(h, "") for h in header}
        if hit is not None:
            updates.append((hit[0], hit[1], full, row))
        else:
            appends.append((full, row))
        wrote += 1
    if updates:
        try:
            with _savepoint():
                RR.update_many(reads, CR.RESOURCE, [(k, b, f) for k, b, f, _r in updates], ACTOR)
        except Exception:  # noqa: BLE001 - the run's rows one at a time
            lost = sum(0 if _one(reads, r) else 1 for _k, _b, _f, r in updates)
            wrote, refused = wrote - lost, refused + lost
    if appends:
        try:
            with _savepoint():
                RR.create_many(reads, CR.RESOURCE, [f for f, _r in appends], ACTOR)
        except Exception:  # noqa: BLE001 - the new rows one at a time
            lost = sum(0 if _one(reads, r) else 1 for _f, r in appends)
            wrote, refused = wrote - lost, refused + lost
    return {"wrote": wrote, "refused": refused}


def ingest(sess: L.Session, payload: dict) -> Decision:
    """commRoutesIngest: the relay's, and nobody else's. Each row shaped (a row proposing neither a window nor a
    supervisor is refused), the set written by id; the rows a pass did not reach in time come back as `left`."""
    started = time.monotonic()
    p = payload if isinstance(payload, dict) else {}
    if p.get("rows") is None or p.get("rows") == "":
        return W.refuse(400, "Missing required parameter: rows.")
    if (sess.user or {}).get("is_service") is not True:
        return Decision(dict(DENIED))
    rows = p.get("rows") or []
    if not rows:
        return Decision({"status": 200, "data": {"wrote": 0, "note": "nothing was handed over"}})
    reads = sess.reads
    if not RR.uploaded(reads.db, CR.RESOURCE):
        raise Defer("the comm_routes house is not uploaded to Postgres yet")
    cleared = retire(reads)
    at = s_(p.get("source_at")) or _now_iso()
    where = _held(reads)
    stamp = _now_iso()
    wrote = refused = 0
    lines: list[dict[str, str]] = []
    left: list[Any] = []
    for i, r in enumerate(rows):
        line = line_of(r, at)
        if line is None:
            refused += 1
        else:
            lines.append(line)
        if len(lines) >= CHUNK or i == len(rows) - 1:
            got = upsert_many(reads, lines, where, stamp)
            wrote, refused, lines = wrote + got["wrote"], refused + got["refused"], []
            if i < len(rows) - 1 and time.monotonic() - started > BUDGET_S:
                left = list(rows[i + 1:])
                break
    staff_views.record({"email": ACTOR}, "comm_routes_ingested",
                       f"{wrote} route(s) · {refused} refused"
                       + (f" · {cleared} retired contact cell(s) emptied" if cleared else ""))
    data: dict[str, Any] = {"wrote": wrote, "refused": refused, "cleared": cleared}
    if left:
        data["left"] = left
    return Decision({"status": 200, "data": data}, subject="", own=True)


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {
    "commRoutesIngest": ingest,
    "commRoutesUpload": RR.upload_door({CR.RESOURCE: SR.SPECS.get(CR.RESOURCE) or {"tab": CR.TAB}})}
# HUB_POLICY.commRoutesIngest's param types; the upload is the relay's own
POLICY: dict[str, dict[str, Any]] = {"commRoutesIngest": {"params": {"rows": "array"}}, "commRoutesUpload": {}}
BUSY_OF: dict[str, dict[str, Any]] = {a: {"status": 409, "message": BUSY} for a in ACTIONS}


class Store(RR.Store):
    """app.comm_routes_writes and _receipts; the house app.resource_rows' — a void takes a pass's rows back, and the
    relay's next tick hands the same routes again."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="comm_routes", label="Comm routes")
