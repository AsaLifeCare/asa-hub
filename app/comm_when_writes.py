"""commWhenIngest (CommWhen.gs) on Python, a pass of the relay's sweep: the windows it computed, each emptied at the
door unless it sits 30 to 5 minutes before its own shift start, upserted one row per person into the comm_when house in
Postgres (app/resource_rows.py `commWhenHouse`) — only the cells that moved, so a pass that changes nothing writes
nothing — and the feed's stamp kept (app.comm_when_state). The door's cap (400 rows) bounds a pass, as in Apps Script;
the relay hands 200 at a time. One feed at a time is the platform's write lock. commWhenUpload makes the house
Postgres' on the flip (the rows its copy holds where the depot names it), or hands it back."""
from __future__ import annotations

import contextlib
import uuid
from datetime import datetime, timezone
from typing import Any, Callable, Iterator

import comm_when as CW
import gsjs
import locations as L
import resource_rows as RR
import sheet_resources as SR
import staff_views
import writes as W
from scope import Defer
from writes import Decision

DENIED = {"status": 403, "message": "Requires an admin or manager account"}
BUSY = "The window feed is already running."
# hubSysLog_'s actor for this lane
ACTOR = "asa-hub:comm"
NO_ID = 'the comm_when house lacks an "id" column'


def _now_iso() -> str:
    """new Date().toISOString()."""
    return gsjs.iso(datetime.now(timezone.utc))


@contextlib.contextmanager
def _savepoint() -> Iterator[None]:
    """A failed statement rolls back to here and never aborts the write's transaction."""
    cur = RR._cur()
    name = "comm_when_" + uuid.uuid4().hex[:10]
    cur.execute(f"savepoint {name}")
    try:
        yield
    except Exception:
        cur.execute(f"rollback to savepoint {name}")
        cur.execute(f"release savepoint {name}")
        raise
    cur.execute(f"release savepoint {name}")


def _runs(rows: list[int]) -> int:
    """How many contiguous runs these row indexes make: one setValues each."""
    out, last = 0, None
    for i in sorted(rows):
        if last is None or i != last + 1:
            out += 1
        last = i
    return out


def upsert(reads: L.Reads, incoming: list[dict[str, str]], header: list[str],
           held: list[tuple[str, dict]]) -> dict[str, Any]:
    """commWhenUpsert_: one row per person by id — a moved cell patches its row and stamps updatedAt, a new person is
    appended after every other; `writes` counts the setValues a sheet would have taken."""
    if "id" not in header:
        return {"error": NO_ID}
    at: dict[str, int] = {}
    for n, (_k, cells) in enumerate(held):
        id0 = CW.text(cells.get("id"))
        if id0 and id0 not in at:
            at[id0] = n
    now = _now_iso()
    out: dict[str, Any] = {"inserted": 0, "updated": 0, "unchanged": 0, "writes": 0}
    appended: list[dict[str, Any]] = []
    work: dict[int, dict[str, Any]] = {}
    changed: set[int] = set()
    for item in incoming:
        rid = CW.text(item.get("id"))
        if not rid:
            continue
        row = at.get(rid)
        if row is None:
            line = {h: "" for h in header}
            line["id"] = rid
            for h in ("createdAt", "updatedAt"):
                if h in line:
                    line[h] = now
            for k, v in item.items():
                if k != "id" and k in line:
                    line[k] = v
            appended.append(line)
            out["inserted"] += 1
            # a key handed over twice in one payload patches its own new line instead of appending another
            at[rid] = -len(appended)
            continue
        if row < 0:
            pending = appended[-row - 1]
            for k, v in item.items():
                if k not in ("id", "createdAt") and k in pending:
                    pending[k] = "" if v is None else v
            continue
        cur = work.setdefault(row, dict(held[row][1]))
        touched = False
        for k, v in item.items():
            if k in ("id", "createdAt") or k not in header:
                continue
            v = "" if v is None else v
            if CW.text(cur.get(k)) != CW.text(v):
                cur[k] = v
                touched = True
        if touched:
            if "updatedAt" in header:
                cur["updatedAt"] = now
            changed.add(row)
            out["updated"] += 1
        else:
            out["unchanged"] += 1
    if changed:
        RR.update_many(reads, CW.RESOURCE, [(held[n][0], held[n][1], work[n]) for n in sorted(changed)], ACTOR)
        out["writes"] += _runs(list(changed))
    if appended:
        RR.create_many(reads, CW.RESOURCE, appended, ACTOR)
        out["writes"] += 1
    out["rows"] = len(held) + len(appended)
    return out


def _stamp(key: str, value: str) -> None:
    RR._cur().execute(f"insert into {CW.STATE} (key, value, updated_at) values (%s, %s, now()) on conflict (key) do"
                      " update set value = excluded.value, updated_at = now()", (key, value))


def ingest(sess: L.Session, payload: dict) -> Decision:
    """commWhenIngest: the relay computes the windows, this writes them and refuses any window not 30 to 5 minutes
    before its shift start. Nothing on this side caches the house, so no cache scope is bumped."""
    p = payload if isinstance(payload, dict) else {}
    if p.get("rows") is None or p.get("rows") == "":
        return W.refuse(400, "Missing required parameter: rows.")
    user = sess.user or {}
    if user.get("is_service") is not True and gsjs.js_str(user.get("role")) != "admin":
        return Decision(dict(DENIED))
    rows = p.get("rows") or []
    if not rows:
        return Decision({"status": 200, "data": {"wrote": 0, "converged": True, "note": "nothing was handed over"}})
    reads = sess.reads
    if not RR.uploaded(reads.db, CW.RESOURCE):
        raise Defer("the comm_when house is not uploaded to Postgres yet")
    crossed = CW.crossed(rows)
    # freshness is the relay's clock, when the calendar was read; this side's only if that stamp is unreadable
    at = CW.instant(p.get("source_at")) or _now_iso()
    clean: list[dict[str, str]] = []
    seen: set[str] = set()
    refused = unfit = reachable = in_quiet = 0
    for r in rows:
        if len(clean) >= CW.INGEST_CAP:
            break
        item = CW.clean(r, at)
        if item is None or item["id"] in seen:
            refused += 1
            continue
        seen.add(item["id"])
        unfit += item["state"] == "window_refused"
        reachable += item["state"] == "reachable"
        in_quiet += bool(item["window_from"] and item["only_by_this_rule"])
        clean.append(item)
    overflow = max(0, len(rows) - refused - len(clean))
    if not clean:
        return W.refuse(400, "No usable row — each one needs a person and a known state.")
    header = RR.columns(reads, CW.RESOURCE)
    if not header:
        RR._widen(reads, CW.RESOURCE, list(CW.HEADER))
        header = RR.columns(reads, CW.RESOURCE)
    res = upsert(reads, clean, header, RR.table_rows(reads, CW.RESOURCE))
    if res.get("error"):
        return W.refuse(400, res["error"])
    moved = res["inserted"] + res["updated"]
    try:
        with _savepoint():
            _stamp(CW.FEED_STAMP, at)
            _stamp(CW.FEED_ROWS, str(res["rows"]))
    except Exception:  # noqa: BLE001 - the stamp is a convenience; the rows are the answer
        pass
    if crossed:
        staff_views.record({"email": ACTOR}, "comm_when_client_columns_refused", ", ".join(crossed))
    if moved or overflow or unfit:
        staff_views.record({"email": ACTOR}, "comm_when_ingested",
                           f"{res['inserted']} added, {res['updated']} patched, {res['unchanged']} unchanged — "
                           f"{res['writes']} write(s) · {reachable} reachable · {in_quiet} reachable only inside quiet "
                           "hours"
                           + (f" · {unfit} window(s) outside the {CW.MAX_MIN}-{CW.MIN_MIN} minute bound, emptied"
                              if unfit else "")
                           + (f" · {overflow} past the cap, not seen" if overflow else ""))
    return Decision({"status": 200, "data": {
        "received": len(rows), "kept": len(clean), "refused": refused, "overflow": overflow,
        "inserted": res["inserted"], "updated": res["updated"], "unchanged": res["unchanged"],
        "writes": res["writes"], "converged": moved == 0, "reachable": reachable, "only_by_this_rule": in_quiet,
        "unfit": unfit, "dropped_columns": crossed, "at": at}}, subject="", own=True)


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {
    "commWhenIngest": ingest,
    "commWhenUpload": RR.upload_door({CW.RESOURCE: SR.SPECS.get(CW.RESOURCE) or {"tab": CW.TAB}})}
# HUB_POLICY.commWhenIngest: admins (the relay passes as the service); the upload is the relay's own
POLICY: dict[str, dict[str, Any]] = {"commWhenIngest": {"roles": ("admin",),
                                                        "params": {"rows": "array", "source_at": "string"}},
                                     "commWhenUpload": {}}
BUSY_OF: dict[str, dict[str, Any]] = {"commWhenIngest": {"status": 409, "message": BUSY},
                                      "commWhenUpload": {"status": 409, "message": W.BUSY}}


class Store(RR.Store):
    """app.comm_when_writes and _receipts; the house app.resource_rows', the feed's stamp app.comm_when_state — a void
    takes a pass's rows back (the stamp is a convenience and stays), and the relay's next tick hands the pass again."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="comm_when", label="Comm when")
