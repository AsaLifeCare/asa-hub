#!/usr/bin/env python3
"""Copy the relay's own tables from the old platform's database into asa-hub-db (schema app), counts printed only.

    move_relay_tables.py            the counts on both sides, nothing written (the default)
    move_relay_tables.py --mirror   the cutover copy: every row the source holds lands as the source holds it, and a
                                    target row the source no longer holds is taken out of the TARGET; refused while
                                    the relay is connected to asa-hub-db (it writes there once moved)
    move_relay_tables.py --keep     a top-up safe at any time, of the tables only ever added to (and Technology's):
                                    rows the target lacks are added, none changed or removed; a table whose rows
                                    change or go is moved by --mirror alone, so a row the relay took out is never
                                    put back

The source is read in one read-only snapshot and is never written; the target is written in one transaction, so a
failed pass leaves it as it was. Running it again changes nothing that is already equal. The DSNs come from the
environment (HUB_SNAPSHOT_PG_DSN, HUB_RELAY_DB_DSN, or --source-env/--target-env) and are never printed. Exit 0 when
every table's counts agree (--keep: the target holds at least the source's rows), 1 when one does not, 2 refused."""
from __future__ import annotations

import argparse
import os
import sys
from typing import Any

try:
    import psycopg2
    import psycopg2.extensions
    import psycopg2.extras
except ImportError:  # psycopg 3 below, where the relay's driver is absent (asa-hub-db-sync, the sheet-sync)
    psycopg2 = None
try:
    import psycopg
    from psycopg.types.json import set_json_loads
except ImportError:  # the refusal below says it when neither is here
    psycopg = None
DB_ERROR: Any = psycopg2.Error if psycopg2 is not None else psycopg.Error if psycopg is not None else Exception

MIRROR, APPEND, KEEP = "mirror", "append", "keep"
RELAY_APP_NAME = "asa-hub-snapshot"
PAGE = 500

# (source table, target table, how --mirror moves it); every target is in --schema
TABLES: tuple[tuple[str, str, str], ...] = (
    ("hub_session_vouch", "hub_session_vouch", MIRROR),
    ("hub_backend_switch", "hub_backend_switch", MIRROR),
    ("asa_hub_notices", "asa_hub_notices", MIRROR),
    ("asa_hub_notice_reads", "asa_hub_notice_reads", MIRROR),
    ("asa_hub_push_subs", "asa_hub_push_subs", MIRROR),
    ("asa_hub_push_outbox", "asa_hub_push_outbox", MIRROR),
    ("asa_hub_inbox_reads", "asa_hub_inbox_reads", MIRROR),
    ("asa_hub_inbox_seen", "asa_hub_inbox_seen", MIRROR),
    ("asa_shift_pool", "asa_shift_pool", MIRROR),
    ("asa_shift_requests", "asa_shift_requests", MIRROR),
    ("asa_shift_handoffs", "asa_shift_handoffs", MIRROR),
    ("asa_house_day_published", "asa_house_day_published", MIRROR),
    ("asa_house_worked_days", "asa_house_worked_days", APPEND),
    ("asa_open_shift_covered", "asa_open_shift_covered", MIRROR),
    ("asa_open_shift_covered_birth", "asa_open_shift_covered_birth", MIRROR),
    ("asa_calendar_calloff_road", "asa_calendar_calloff_road", MIRROR),
    ("asa_house_calendar_claims", "asa_house_calendar_claims", MIRROR),
    ("asa_house_calendar_overrides", "asa_house_calendar_overrides", MIRROR),
    ("asa_house_calendar_edits", "asa_house_calendar_edits", MIRROR),
    ("asa_cal_builder_draft", "asa_cal_builder_draft", MIRROR),
    ("asa_cal_builder_house_draft", "asa_cal_builder_house_draft", MIRROR),
    ("asa_cal_builder_periods", "asa_cal_builder_periods", MIRROR),
    ("asa_cal_builder_publish_log", "asa_cal_builder_publish_log", MIRROR),
    ("asa_punch_warnings", "asa_punch_warnings", MIRROR),
    ("asa_punch_said", "asa_punch_said", MIRROR),
    ("asa_time_off_said", "asa_time_off_said", MIRROR),
    ("asa_time_off_writes", "asa_time_off_writes", MIRROR),
    ("asa_sms_replies", "asa_sms_replies", MIRROR),
    ("asa_sms_reply_start", "asa_sms_reply_start", MIRROR),
    ("hub_form_digest_items", "hub_form_digest_items", MIRROR),
    ("hub_form_digest_state", "hub_form_digest_state", MIRROR),
    ("comm_call_reads", "comm_call_reads", MIRROR),
    ("comm_call_seals", "comm_call_seals", APPEND),
    ("comm_call_catchup", "comm_call_catchup", MIRROR),
    # the Technology app already keeps its own: the source's rows join them, never over them
    ("asa_tech_project_status", "tech_project_status", KEEP),
    ("asa_tech_manual_projects", "tech_manual_projects", KEEP),
)
# a source column read through an expression where the target column refuses its NULL
EXPRS: dict[str, dict[str, str]] = {
    "asa_tech_project_status": {"updated_at": "coalesce(updated_at, now())"},
    "asa_tech_manual_projects": {"category": "coalesce(category, '')", "status": "coalesce(status, 'Not started')",
                                 "blurb": "coalesce(blurb, '')", "created_at": "coalesce(created_at, now())"},
}
# the rows a partial unique index holds are written after the rest, so a row leaving it frees its place first
LIVE_LAST: dict[str, str] = {
    "asa_shift_requests": "state IN ('applied', 'needs_training_approval')",
    "asa_shift_handoffs": "state = 'pending'",
}


class Refused(RuntimeError):
    pass


def _ident(*parts: str) -> str:
    return ".".join('"' + p.replace('"', '""') + '"' for p in parts)


def _columns(cur: Any, schema: str, table: str) -> list[str]:
    cur.execute("SELECT a.attname FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid "
                "JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = %s AND c.relname = %s "
                "AND c.relkind IN ('r', 'p') AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attnum",
                (schema, table))
    return [str(r[0]) for r in cur.fetchall()]


def _key(cur: Any, schema: str, table: str) -> list[str]:
    cur.execute("SELECT a.attname FROM pg_index i JOIN pg_class c ON c.oid = i.indrelid "
                "JOIN pg_namespace n ON n.oid = c.relnamespace "
                "JOIN LATERAL unnest(i.indkey) WITH ORDINALITY k(attnum, ord) ON true "
                "JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = k.attnum "
                "WHERE n.nspname = %s AND c.relname = %s AND i.indisprimary ORDER BY k.ord", (schema, table))
    return [str(r[0]) for r in cur.fetchall()]


def _count(cur: Any, qualified: str) -> int:
    cur.execute(f"SELECT count(*) FROM {qualified}")  # noqa: S608 - quoted identifiers
    return int(cur.fetchone()[0])


def _relay_on_target(cur: Any) -> int:
    cur.execute("SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND application_name = %s",
                (RELAY_APP_NAME,))
    return int(cur.fetchone()[0])


def _connect(env: str, *, source: bool) -> Any:
    where = os.getenv(env, "").strip()
    if not where:
        raise Refused(f"{env} is not set")
    name = "move-relay-tables-source" if source else "move-relay-tables"
    if psycopg2 is None:
        conn = psycopg.connect(where, connect_timeout=10, application_name=name)
        if source:
            conn.isolation_level = psycopg.IsolationLevel.REPEATABLE_READ
            conn.read_only = True
            # json and jsonb travel as their text and land as it
            set_json_loads(lambda s: s if isinstance(s, str) else bytes(s).decode("utf-8"), conn)
        return conn
    conn = psycopg2.connect(where, connect_timeout=10, application_name=name)
    if source:
        conn.set_session(isolation_level=psycopg2.extensions.ISOLATION_LEVEL_REPEATABLE_READ, readonly=True)
        # json and jsonb travel as their text and land as it
        psycopg2.extras.register_default_json(conn, loads=lambda s: s)
        psycopg2.extras.register_default_jsonb(conn, loads=lambda s: s)
    return conn


def _values(cur: Any, sql: str, batch: list[tuple]) -> list[tuple]:
    """execute_values for either driver: one INSERT ... VALUES row per tuple, every RETURNING row back."""
    if psycopg2 is not None:
        return psycopg2.extras.execute_values(cur, sql, batch, page_size=PAGE, fetch=True)
    width = len(batch[0])
    rows = ",".join(["(" + ",".join(["%s"] * width) + ")"] * len(batch))
    cur.execute(sql.replace("VALUES %s", "VALUES " + rows, 1), [v for row in batch for v in row])
    return cur.fetchall()


def _sequences(cur: Any, schema: str, table: str, cols: list[str]) -> int:
    """Each serial column's sequence moved past the copied rows, never back."""
    moved = 0
    for col in cols:
        cur.execute("SELECT pg_get_serial_sequence(%s, %s)", (_ident(schema, table), col))
        seq = (cur.fetchone() or [None])[0]
        if not seq:
            continue
        cur.execute(f"SELECT max({_ident(col)}) FROM {_ident(schema, table)}")  # noqa: S608
        top = cur.fetchone()[0]
        cur.execute(f"SELECT last_value, is_called FROM {seq}")  # noqa: S608 - the catalog's own quoted name
        last, called = cur.fetchone()
        if top is not None and int(top) > (int(last) if called else int(last) - 1):
            cur.execute("SELECT setval(%s, %s, true)", (seq, int(top)))
            moved += 1
    return moved


def move_one(src: Any, dst: Any, source_table: str, target_table: str, how: str, *, schema: str,
             write: bool) -> dict[str, Any]:
    """One table: counts, and when `write`, its rows moved by `how`. The caller commits or rolls back."""
    out: dict[str, Any] = {"table": source_table, "target": f"{schema}.{target_table}", "how": how}
    with src.cursor() as s, dst.cursor() as d:
        s_cols = _columns(s, "public", source_table)
        if not s_cols:
            out["error"] = "not in the source"
            return out
        d_cols = _columns(d, schema, target_table)
        if not d_cols:
            out["error"] = "not in the target (apply db/relay_tables.sql)"
            return out
        missing = [c for c in s_cols if c not in d_cols]
        if missing:
            out["error"] = f"the target lacks {', '.join(missing)}"
            return out
        key = _key(d, schema, target_table)
        if not key or any(k not in s_cols for k in key):
            out["error"] = "no primary key both sides share"
            return out
        src_q, dst_q = _ident("public", source_table), _ident(schema, target_table)
        out["source"] = _count(s, src_q)
        out["before"] = _count(d, dst_q)
        if not write:
            out["after"] = out["before"]
            return out
        d.execute(f"SELECT {', '.join(_ident(k) for k in key)} FROM {dst_q}")  # noqa: S608
        held = {tuple(r) for r in d.fetchall()}
        exprs = EXPRS.get(source_table, {})
        picked = ", ".join(f"{exprs[c]} AS {_ident(c)}" if c in exprs else _ident(c) for c in s_cols)
        order = f" ORDER BY ({LIVE_LAST[source_table]}) NULLS FIRST" if source_table in LIVE_LAST else ""
        names = ", ".join(_ident(c) for c in s_cols)
        conflict = ", ".join(_ident(k) for k in key)
        rest = [c for c in s_cols if c not in key]
        if how == MIRROR and rest:
            sets = ", ".join(f"{_ident(c)} = EXCLUDED.{_ident(c)}" for c in rest)
            mine = ", ".join(f"t.{_ident(c)}" for c in rest)
            theirs = ", ".join(f"EXCLUDED.{_ident(c)}" for c in rest)
            tail = f"DO UPDATE SET {sets} WHERE ({mine}) IS DISTINCT FROM ({theirs})"
        else:
            tail = "DO NOTHING"
        sql = (f"INSERT INTO {dst_q} AS t ({names}) VALUES %s ON CONFLICT ({conflict}) {tail} "  # noqa: S608
               f"RETURNING (xmax = 0)")
        k_at = [s_cols.index(k) for k in key]
        seen: set[tuple] = set()
        inserted = updated = 0
        with src.cursor(name=f"move_{source_table}") as stream:
            stream.itersize = PAGE
            stream.execute(f"SELECT {picked} FROM {src_q}{order}")  # noqa: S608
            batch: list[tuple] = []
            for row in stream:
                pk = tuple(row[i] for i in k_at)
                seen.add(pk)
                if how != MIRROR and pk in held:
                    continue
                batch.append(tuple(row))
                if len(batch) >= PAGE:
                    got = _values(d, sql, batch)
                    inserted += sum(1 for (new,) in got if new)
                    updated += sum(1 for (new,) in got if not new)
                    batch = []
            if batch:
                got = _values(d, sql, batch)
                inserted += sum(1 for (new,) in got if new)
                updated += sum(1 for (new,) in got if not new)
        removed = 0
        if how == MIRROR:
            gone = [pk for pk in held if pk not in seen]
            where = " AND ".join(f"{_ident(k)} = %s" for k in key)
            for pk in gone:
                d.execute(f"DELETE FROM {dst_q} WHERE {where}", pk)  # noqa: S608
                removed += d.rowcount
        out.update(inserted=inserted, updated=updated, removed=removed, after=_count(d, dst_q),
                   sequences=_sequences(d, schema, target_table, d_cols))
    return out


def _agrees(r: dict[str, Any], mode: str) -> bool:
    if "error" in r:
        return False
    if r.get("skipped"):
        return True
    if mode == KEEP or r["how"] == KEEP:
        return r["after"] >= r["source"]
    return r["after"] == r["source"]


def _line(r: dict[str, Any], mode: str) -> str:
    if "error" in r:
        return f"{r['table']:<30} {r['target']:<36} REFUSED: {r['error']}"
    if r.get("skipped"):
        return f"{r['table']:<30} {r['target']:<36} skipped: its rows change or go, so --mirror alone moves it"
    moved = (f" +{r.get('inserted', 0)} ~{r.get('updated', 0)} -{r.get('removed', 0)}"
             if "inserted" in r else "")
    verdict = "ok" if _agrees(r, mode) else "DIFFERS"
    return (f"{r['table']:<30} {r['target']:<36} source={r['source']:<7} before={r['before']:<7} "
            f"after={r['after']:<7}{moved} {verdict}")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    how = ap.add_mutually_exclusive_group()
    how.add_argument("--mirror", action="store_true", help="the cutover copy (before the relay writes asa-hub-db)")
    how.add_argument("--keep", action="store_true", help="add only the rows the target lacks")
    ap.add_argument("--source-env", default="HUB_SNAPSHOT_PG_DSN")
    ap.add_argument("--target-env", default="HUB_RELAY_DB_DSN")
    ap.add_argument("--schema", default="app")
    ap.add_argument("--only", action="append", default=[], help="a source table name (repeatable)")
    args = ap.parse_args(argv)
    mode = MIRROR if args.mirror else KEEP if args.keep else "check"
    if psycopg2 is None and psycopg is None:
        print("refused: no Postgres driver is importable here")
        return 2
    unknown = [t for t in args.only if t not in {s for s, _t, _h in TABLES}]
    if unknown:
        print(f"refused: not a relay table: {', '.join(unknown)}")
        return 2
    try:
        src = _connect(args.source_env, source=True)
        dst = _connect(args.target_env, source=False)
    except Refused as exc:
        print(f"refused: {exc}")
        return 2
    except DB_ERROR as exc:
        print(f"refused: a database did not answer ({type(exc).__name__})")
        return 2
    try:
        with dst.cursor() as d:
            relay = _relay_on_target(d)
        if mode == MIRROR and relay:
            print(f"refused: the relay holds {relay} connection(s) to the target, so it writes there now; "
                  "--mirror would undo its rows (use --keep)")
            return 2
        results = []
        for source_table, target_table, table_how in TABLES:
            if args.only and source_table not in args.only:
                continue
            if mode == KEEP and table_how == MIRROR:
                results.append({"table": source_table, "target": f"{args.schema}.{target_table}", "how": table_how,
                                "skipped": True})
                continue
            use = table_how if mode == MIRROR else KEEP
            results.append(move_one(src, dst, source_table, target_table, use, schema=args.schema,
                                    write=mode != "check"))
        if mode == "check" or any("error" in r for r in results):
            dst.rollback()
        else:
            dst.commit()
        src.rollback()
    except DB_ERROR as exc:
        dst.rollback()
        print(f"refused: the copy stopped and nothing was kept ({type(exc).__name__}: "
              f"{str(getattr(exc, 'pgerror', '') or '').strip()[:160]})")
        return 2
    finally:
        src.close()
        dst.close()
    print(f"mode={mode} tables={len(results)} relay_connections_on_target={relay}")
    for r in results:
        print(_line(r, mode))
    errors = sum(1 for r in results if "error" in r)
    if errors and mode != "check":
        print(f"nothing was kept: {errors} table(s) refused")
        return 2
    return 0 if all(_agrees(r, mode) for r in results) else 1


if __name__ == "__main__":
    sys.exit(main())
