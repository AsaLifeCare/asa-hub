"""The books Postgres keeps the record of (db/postgres_record.sql): every book a kept edit or a book change names. For
each, what it owes Google and when that was last carried (asa-hub-sheet-sync's backup), and when Google is read next
for what someone still edits there (the daily check, app/sheet_check.py). A stored check makes some kept edits
redundant — the copy now holds them — and they are compacted here."""
from __future__ import annotations

import json
import time
from typing import Any

import hubdb
import writes as W

# catalog.books.status of a book whose copy is the daily check's, never the mirror's (db/sync.py writes it)
RECORD_STATUS = hubdb.RECORD_STATUS
CHECK_EVERY_S = 86400
# a pull is the copy only once asa-hub-db-sync stored it; its compactions wait this much more, well past every
# reader's catalog cache (hubdb.CATALOG_TTL_S), so no read ever sees the edit gone before the copy holding it
COMPACT_AFTER_S = 300.0
PULLS_KEEP_DAYS = 14
# heard by asa-hub-sheet-sync: a check was asked; heard by asa-hub-db-sync: a check's read is staged
CHANNEL = "hub_record_check"
STAGED = "hub_sheet_pull"


def books_table() -> str:
    return W.beside("record_books")


def pulls_table() -> str:
    return W.beside("sheet_pulls")


def pull_rows_table() -> str:
    return W.beside("sheet_pull_rows")


def compactions_table() -> str:
    return W.beside("edit_compactions")


def ddl() -> tuple[str, ...]:
    b, p, r, c = books_table(), pulls_table(), pull_rows_table(), compactions_table()
    return (
        f"create table if not exists {b} ("
        " sheet_id text primary key, name text not null default '', enrolled_at timestamptz not null default now(),"
        " held_since timestamptz, paused boolean not null default false,"
        " owed integer not null default 0, owed_since timestamptz, last_backup_at timestamptz,"
        " backup_try_at timestamptz, backup_next_at timestamptz, backup_tries integer not null default 0,"
        " backup_why text not null default '',"
        f" check_every_s integer not null default {CHECK_EVERY_S} check (check_every_s >= 300),"
        " check_due_at timestamptz not null default now(), check_tabs jsonb, last_check_at timestamptz,"
        " last_pull_id bigint, check_tries integer not null default 0, check_why text not null default '')",
        f"create table if not exists {p} ("
        " id bigserial primary key, sheet_id text not null, name text not null default '',"
        " read_at timestamptz not null, partial boolean not null default false,"
        " tabs jsonb not null default '[]'::jsonb,"
        " state text not null default 'reading'"
        " check (state in ('reading', 'staged', 'stored', 'compacted', 'failed')),"
        " stored_at timestamptz, why text not null default '', at timestamptz not null default now())",
        f"create table if not exists {r} ("
        f" pull_id bigint not null references {p} (id) on delete cascade, tab_name text not null,"
        " row_number integer not null, data jsonb not null, primary key (pull_id, tab_name, row_number))",
        f"create table if not exists {c} ("
        f" pull_id bigint not null references {p} (id) on delete cascade, sheet_id text not null,"
        " tab_name text not null, match_by text not null, keyed_by text not null, row_key text not null,"
        " field text not null, upto_id bigint not null,"
        " primary key (pull_id, sheet_id, tab_name, match_by, keyed_by, row_key, field))",
    )


# ---- the record set ----------------------------------------------------------------------------------------------

def enroll(conn: Any) -> int:
    """Every book a kept edit or a book change names joins the record set; how many joined now."""
    import book_ops as BO  # noqa: PLC0415 - it imports writes, as this module does
    got = conn.execute(
        f"insert into {books_table()} (sheet_id) select sheet_id from (select distinct sheet_id from {W.EDITS_TABLE}"
        f" union select distinct sheet_id from {BO.table()} where op <> all(%s)) s where sheet_id <> ''"
        " on conflict (sheet_id) do nothing returning 1", (list(BO.OWN_RECORD_OPS),)).fetchall()
    return len(got)


def owed_now(conn: Any, owed: dict[str, tuple[int, float]]) -> None:
    """What each book owes Google now (cells, since when); a book owing nothing says 0."""
    b = books_table()
    with conn.transaction():
        conn.execute(f"update {b} set owed = 0, owed_since = null where owed <> 0 and not (sheet_id = any(%s))",
                     (list(owed),))
        for sid, (n, since) in owed.items():
            conn.execute(f"update {b} set owed = %s, owed_since = to_timestamp(%s) where sheet_id = %s",
                         (int(n), float(since), sid))


def backups_due(conn: Any) -> list[str]:
    """The books owing Google, oldest owed first, that are not waiting out a refusal."""
    return [r[0] for r in conn.execute(
        f"select sheet_id from {books_table()} where owed > 0 and not paused"
        " and (backup_next_at is null or backup_next_at <= now()) order by owed_since nulls last, sheet_id")]


def backup_said(conn: Any, sid: str, ok: bool, why: str = "", next_at: float = 0.0, left: int | None = None) -> None:
    """The backup's word on one book: carried (the last success; `left`, the cells still owed after it), or why not
    and when it is asked again."""
    if ok:
        conn.execute(f"update {books_table()} set last_backup_at = now(), backup_try_at = now(), backup_next_at = null,"
                     " backup_tries = 0, backup_why = %s, owed = coalesce(%s, owed),"
                     " owed_since = case when coalesce(%s, owed) = 0 then null else owed_since end where sheet_id = %s",
                     (why[:400], left, left, sid))
        return
    conn.execute(f"update {books_table()} set backup_try_at = now(), backup_tries = backup_tries + 1,"
                 " backup_next_at = case when %s > 0 then to_timestamp(%s) end, backup_why = %s where sheet_id = %s",
                 (next_at, next_at, why[:400], sid))


def checks_due(conn: Any) -> list[tuple[str, list[str] | None]]:
    """The books whose check is due (on demand first, then the books owing nothing, then the rest): each with the tabs
    asked, None for the whole book."""
    rows = conn.execute(
        f"select sheet_id, check_tabs from {books_table()} where not paused and check_due_at <= now()"
        " order by (check_tabs is null), (owed > 0), check_due_at, sheet_id").fetchall()
    return [(sid, [str(t) for t in tabs] if isinstance(tabs, list) and tabs else None) for sid, tabs in rows]


def ask_check(conn: Any, sid: str, tabs: list[str] | None = None) -> None:
    """A check of one book now: these tabs (added to any already asked), or the whole book."""
    b = books_table()
    conn.execute(f"insert into {b} (sheet_id) values (%s) on conflict (sheet_id) do nothing", (sid,))
    if tabs:
        # a whole check already due stays whole
        conn.execute(f"update {b} set check_tabs = case when check_tabs is null and check_due_at <= now() then null"
                     " else (select jsonb_agg(distinct t) from jsonb_array_elements_text("
                     "coalesce(check_tabs, '[]'::jsonb) || %s::jsonb) t) end, check_due_at = now()"
                     " where sheet_id = %s", (json.dumps(tabs), sid))
    else:
        conn.execute(f"update {b} set check_due_at = now(), check_tabs = null where sheet_id = %s", (sid,))
    conn.execute(f"notify {CHANNEL}")


def check_said(conn: Any, sid: str, ok: bool, why: str = "", pull_id: int | None = None, partial: bool = False,
               retry_at: float = 0.0) -> None:
    """The check's word on one book: staged (the next one a day on, or as the book says), or why not and when it is
    tried again."""
    b = books_table()
    if ok:
        # a check of some tabs leaves the whole book's day as it was; a book never checked whole is checked next
        conn.execute(f"update {b} set last_check_at = case when %s then last_check_at else now() end,"
                     " check_due_at = case when %s then coalesce(last_check_at + make_interval(secs => check_every_s),"
                     " now()) else now() + make_interval(secs => check_every_s) end,"
                     " check_tabs = null, last_pull_id = %s, check_tries = 0, check_why = %s"
                     " where sheet_id = %s", (partial, partial, pull_id, why[:400], sid))
        return
    conn.execute(f"update {b} set check_tries = check_tries + 1, check_why = %s,"
                 " check_due_at = to_timestamp(%s) where sheet_id = %s",
                 (why[:400], retry_at or time.time() + 3600, sid))


def name_of(conn: Any, sid: str, name: str) -> None:
    if name:
        conn.execute(f"update {books_table()} set name = %s where sheet_id = %s and name is distinct from %s",
                     (name[:300], sid, name[:300]))


# ---- compaction: the kept edits a stored check made redundant ----------------------------------------------------

def compact(conn: Any, after_s: float = COMPACT_AFTER_S) -> dict[str, int]:
    """Every pull stored more than `after_s` ago, compacted: each cell's kept edits up to the one it names deleted
    (an acknowledged edit the copy now holds in its own text, or one the sheet took), and the cell's sync state when
    none of it is left — one transaction. What a read shows comes from the copy from then on, the same, or the sheet's
    value it hands over; an edit newer than the one named stays and wins. The pulls of past days go with their rows."""
    c, p, s, e = compactions_table(), pulls_table(), W.beside("edit_sync"), W.EDITS_TABLE
    key = ("sheet_id", "tab_name", "match_by", "keyed_by", "row_key", "field")
    on = lambda a, b: " and ".join(f"{a}.{k} = {b}.{k}" for k in key)  # noqa: E731
    out = {"edits": 0, "states": 0, "pulls": 0, "pruned": 0}
    with conn.transaction():
        ids = [int(r[0]) for r in conn.execute(
            f"select id from {p} where state = 'stored' and stored_at < now() - make_interval(secs => %s)"
            " order by id for update skip locked", (float(after_s),)).fetchall()]
        if ids:
            ready = f"select * from {c} where pull_id = any(%s)"
            out["edits"] = conn.execute(f"delete from {e} e using ({ready}) r where {on('e', 'r')}"
                                        " and e.id <= r.upto_id", (ids,)).rowcount
            out["states"] = conn.execute(
                f"delete from {s} s using ({ready}) r where {on('s', 'r')} and s.edit_id <= r.upto_id"
                f" and not exists (select 1 from {e} e where {on('e', 's')})", (ids,)).rowcount
            conn.execute(f"delete from {c} where pull_id = any(%s)", (ids,))
            out["pulls"] = conn.execute(f"update {p} set state = 'compacted' where id = any(%s)", (ids,)).rowcount
        # a read its service never finished (stopped mid-book) is never stored
        conn.execute(f"update {p} set state = 'failed', why = 'the read never finished' where state = 'reading'"
                     " and at < now() - interval '1 day'")
        out["pruned"] = conn.execute(f"delete from {p} where state in ('compacted', 'failed')"
                                     " and at < now() - make_interval(days => %s)", (PULLS_KEEP_DAYS,)).rowcount
    return out


def status(conn: Any) -> list[dict[str, Any]]:
    """Each book: what it owes and since when, the last backup and check, and what waits."""
    names = ("sheet_id", "name", "held_since", "owed", "owed_since", "last_backup_at", "backup_next_at",
             "backup_why", "last_check_at", "check_due_at", "check_tabs", "check_why", "paused")
    rows = conn.execute(f"select {', '.join(names)} from {books_table()} order by owed desc, sheet_id").fetchall()
    return [{n: (v.isoformat() if hasattr(v, "isoformat") else v) for n, v in zip(names, r)} for r in rows]
