"""Smart Comms' test-mode record of what would have been sent (db/comm_logs.sql): the mock outbox (comm_mock) and the
rehearsal book (comm_rehearsal), one row per id, its cells as the outbox's header names them, kept in the write that
held the message. Postgres is their only record; no sheet is written and none is read."""
from __future__ import annotations

import contextlib
import json
import logging
import uuid
from typing import Any, Iterator

import gsjs

log = logging.getLogger("asa-hub-app")

MOCK = "comm_mock"
REHEARSAL = "comm_rehearsal"
TABLES = {MOCK: "app.comm_mock", REHEARSAL: "app.comm_rehearsal"}
# one sequence numbers both logs, so the rows kept since a moment are one query (db/comm_logs.sql app.comm_test_rows)
SEQ = "app.comm_test_seq"
READER = "asa_hub_app_ro"


def table(name: str) -> str:
    if name not in TABLES:
        raise ValueError(f"no test log named {name}")
    return TABLES[name]


def ddl() -> tuple[str, ...]:
    """db/comm_logs.sql's tables, made when missing by the writer role (Smart Comms' ensure)."""
    out: list[str] = [f"create sequence if not exists {SEQ}"]
    for t in TABLES.values():
        out += [f"create table if not exists {t} (seq bigint not null default nextval('{SEQ}'), id text primary key,"
                " cells jsonb not null default '{}'::jsonb, write_id text not null default '',"
                " door text not null default '', origin text not null default 'postgres'"
                " check (origin in ('postgres', 'sheet')), kept_at timestamptz not null default now(),"
                " changed_at timestamptz, changed_by text not null default '')",
                f"grant select on {t} to {READER}"]
    return tuple(out)


def text(v: Any) -> str:
    """The text a cell holds once written (writes.sheet_text)."""
    if v is None:
        return ""
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return gsjs.num_str(v)
    return gsjs.js_str(v)


@contextlib.contextmanager
def _savepoint(cur: Any) -> Iterator[None]:
    """A failed statement here never aborts the write's own transaction."""
    name = "comm_logs_" + uuid.uuid4().hex[:10]
    held = True
    try:
        cur.execute(f"savepoint {name}")
    except Exception:  # noqa: BLE001 - outside a transaction each statement stands alone
        held = False
    try:
        yield
    except Exception:
        if held:
            cur.execute(f"rollback to savepoint {name}")
            cur.execute(f"release savepoint {name}")
        raise
    else:
        if held:
            cur.execute(f"release savepoint {name}")


def keep(cur: Any, name: str, rec: dict[str, Any], write_id: str = "", door: str = "", *, blanks: bool = True,
         once: bool = False) -> bool:
    """One row kept by its id in the write being decided: its cells laid over what a row of that id holds (the newest
    cell wins; `blanks` False leaves a blank cell unwritten), or with `once` left as it stands when the id is held.
    True when it was kept; False when it could not be (said, never raised)."""
    rid = gsjs.trim(text(rec.get("id")))
    if not rid:
        return False
    cells = {str(k): text(v) for k, v in rec.items() if blanks or text(v) != "" or k == "id"}
    cells["id"] = rid
    t = table(name)
    tail = (" on conflict (id) do nothing" if once else
            f" on conflict (id) do update set cells = {t}.cells || excluded.cells, changed_at = now(),"
            " changed_by = excluded.write_id")
    try:
        with _savepoint(cur):
            cur.execute(f"insert into {t} (id, cells, write_id, door) values (%s, %s::jsonb, %s, %s)" + tail,
                        (rid, json.dumps(cells, ensure_ascii=False), write_id, door))
        return True
    except Exception as exc:  # noqa: BLE001 - a lost proof row never changes the answer
        log.warning("comm logs: a %s row was not kept (%s)", name, type(exc).__name__)
        return False


def _rows(q: Any, sql: str, params: tuple) -> list[tuple]:
    """A query through a HubDb (its read connection) or a cursor (the write's own)."""
    if hasattr(q, "query"):
        return q.query(sql, params)
    q.execute(sql, params)
    return list(q.fetchall())


def held_ids(q: Any, name: str, ids: list[str]) -> set[str]:
    """Which of these ids the log holds."""
    if not ids:
        return set()
    return {str(r[0]) for r in _rows(q, f"select id from {table(name)} where id = any(%s)", (list(ids),))}


def rows(q: Any, name: str, where: str = "", params: tuple = (), limit: int = 0) -> list[dict[str, Any]]:
    """The rows in the order they were kept, each its cells with `_seq`; `where` a condition on `cells`."""
    sql = f"select seq, cells from {table(name)}" + (f" where {where}" if where else "") + " order by seq"
    if limit:
        sql += f" limit {int(limit)}"
    out = []
    for seq, cells in _rows(q, sql, params):
        c = cells if isinstance(cells, dict) else json.loads(cells or "{}")
        out.append({**c, "_seq": int(seq)})
    return out


def newest(q: Any, name: str, limit: int) -> list[dict[str, Any]]:
    """The last `limit` rows kept, newest first, each its cells with `_seq` and when it was kept."""
    out = []
    for seq, cells, kept in _rows(q, f"select seq, cells, kept_at from {table(name)} order by seq desc limit %s",
                                  (int(limit),)):
        c = cells if isinstance(cells, dict) else json.loads(cells or "{}")
        out.append({**c, "_seq": int(seq), "_kept_at": kept.isoformat() if kept is not None else ""})
    return out


def void(conn: Any, write_id: str) -> None:
    """A write the relay took back: the rows it made leave both logs."""
    for t in TABLES.values():
        conn.execute(f"delete from {t} where write_id = %s and origin = 'postgres'", (write_id,))


# ---- the one-off import of what the sheet-backed logs held (tools/import_comm_logs.py) ----------------------------

def sheet_rows(db: Any, own: Any, edits_table: str, name: str) -> dict[str, Any]:
    """The log as every read saw it before it had a table: its house's copy with the kept edits laid, in that order,
    each row with its origin ('sheet': the copy's alone) and the first write that kept it."""
    import hubdb  # noqa: PLC0415
    import writes as W  # noqa: PLC0415
    token = hubdb.OWN.set(own)
    try:
        res = db.resolve(name)
        if res.ref is None:
            return {"sheet_id": res.sheet_id, "tab": "", "rows": [], "why": f"no copy of {name} is held"}
        sid, tab = W.where_of(res)
        laid = db.rows(res.ref)
    finally:
        hubdb.OWN.reset(token)
    first = {str(k): (str(w), str(a)) for k, w, a in db.query(
        f"select row_key, (array_agg(write_id order by id))[1], (array_agg(action order by id))[1] from {edits_table}"
        " where sheet_id = %s and tab_name = %s and match_by = 'id' group by row_key", (sid, tab))}
    heads = [h for h in res.ref.headers if gsjs.trim(gsjs.js_str(h)) == "id"]
    out = []
    for _rn, raw in laid:
        rid = gsjs.trim(text(raw.get(heads[0]))) if heads else ""
        if not rid:
            continue
        wid, door = first.get(rid, ("", ""))
        out.append({"id": rid, "cells": {str(k): text(v) for k, v in raw.items()}, "write_id": wid, "door": door,
                    "origin": "postgres" if rid in first else "sheet"})
    return {"sheet_id": sid, "tab": tab, "rows": out, "why": ""}


def import_rows(cur: Any, name: str, rows: list[dict[str, Any]]) -> dict[str, int]:
    """The rows into the log in their order, an id it holds already left as it stands (run again, nothing doubles)."""
    t = table(name)
    kept = 0
    for r in rows:
        cur.execute(f"insert into {t} (id, cells, write_id, door, origin) values (%s, %s::jsonb, %s, %s, %s)"
                    " on conflict (id) do nothing returning 1",
                    (r["id"], json.dumps({**r["cells"], "id": r["id"]}, ensure_ascii=False), r["write_id"],
                     r["door"], r["origin"]))
        kept += 1 if cur.fetchone() else 0
    return {"rows": len(rows), "kept": kept, "held_before": len(rows) - kept}


def retire(cur: Any, name: str, edits_table: str, sync_table: str, sheet_id: str, tab: str) -> dict[str, int]:
    """The kept edits (and their sync states) of the old sheet-backed log whose row the table now holds, removed:
    nothing of them is owed to the sheet any more."""
    t = table(name)
    cur.execute(f"delete from {edits_table} e where e.sheet_id = %s and e.tab_name = %s and e.match_by = 'id'"
                f" and exists (select 1 from {t} c where c.id = e.row_key)", (sheet_id, tab))
    edits = cur.rowcount
    cur.execute(f"delete from {sync_table} s where s.sheet_id = %s and s.tab_name = %s and s.match_by = 'id'"
                f" and exists (select 1 from {t} c where c.id = s.row_key)", (sheet_id, tab))
    return {"edits": edits, "states": cur.rowcount}
