"""The PsiAnywhere collector's own records in asa-hub-db (app.psi_store, db/psi_store.sql), where until 2026-10-27 they
were JSON files on the app's disk: the staff-hours history (psi_entries: current.json and each day's rounds) and the
full punches' live reads, feed and clients present (psi_punches_full, psi_consumers). One row per file, named by the
path it had (the folder its module names, then the file), so a check that points a module at its own folder keeps its
own rows. The operator, 10-27: everything in Postgres.

The first time a folder is asked for in a process, every file left in it is carried in when it is newer than its row
(or has none); after that the disk is never read again, and nothing is ever written there. A round once gzipped is
kept under its name without ".gz". psi-full's rows.json, the union handed to the feed and read by nobody, stays out:
the full punches' table holds it.

asa-hub-db not answering raises Unkept, an OSError, so every caller treats it as the unreadable or unwritable file it
replaces: an unreadable history is never written over. Only the offline checks, which run without the database driver,
still keep the files."""
from __future__ import annotations

import gzip
import json
import logging
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

log = logging.getLogger("hub.psi_store")

TABLE = "app.psi_store"
NEVER_CARRIED = frozenset({"rows.json"})

_STORE: list[Any] = []
_CARRIED: set[str] = set()
_LOCK = threading.Lock()


class Unkept(OSError):
    """asa-hub-db did not answer."""


def _offline() -> bool:
    try:
        import psycopg  # noqa: F401, PLC0415
    except ImportError:
        return True
    return False


def _run(sql: str, params: tuple = ()) -> Any:
    try:
        if not _STORE:
            import writes  # noqa: PLC0415
            _STORE.append(writes.Store(kind="lanes", label="the PSI collector's records"))
        return _STORE[0].conn().execute(sql, params)
    except Exception as exc:  # noqa: BLE001 - said as the file it replaces
        raise Unkept(f"asa-hub-db did not answer ({type(exc).__name__}: {str(exc)[:160]})") from exc


def _key(folder: Path | str, name: str) -> str:
    return f"{str(folder).rstrip('/')}/{name}"


def _carry(folder: Path | str) -> None:
    """Each file left in the folder taken in when it is newer than its row; once per folder and process."""
    where = str(folder).rstrip("/")
    with _LOCK:
        if where in _CARRIED:
            return
        root = Path(where)
        took = []
        for p in sorted(root.iterdir()) if root.is_dir() else []:
            if not p.is_file() or p.name in NEVER_CARRIED or not p.name.endswith((".json", ".json.gz")):
                continue
            try:
                raw = p.read_bytes()
                body = json.loads((gzip.decompress(raw) if p.name.endswith(".gz") else raw).decode("utf-8") or "{}")
                at = datetime.fromtimestamp(p.stat().st_mtime, timezone.utc)
            except (OSError, ValueError) as exc:
                log.warning("psi store: %s could not be read (%s) — not carried", p, type(exc).__name__)
                continue
            name = p.name[:-3] if p.name.endswith(".gz") else p.name
            cur = _run(f"insert into {TABLE} (name, body, updated_at, carried_from) values (%s, %s::jsonb, %s, %s)"
                       " on conflict (name) do update set body = excluded.body, updated_at = excluded.updated_at,"
                       f" carried_from = excluded.carried_from where {TABLE}.updated_at < excluded.updated_at",
                       (_key(where, name), json.dumps(body, separators=(",", ":"), default=str), at, str(p)))
            if cur.rowcount:
                took.append(name)
        _CARRIED.add(where)
    if took:
        log.info("psi store: %d file(s) of %s carried into %s — %s", len(took), where, TABLE, ", ".join(took))


def get(folder: Path | str, name: str) -> dict:
    """The record a file of this folder held, or {} when there is none; raises Unkept when asa-hub-db does not answer."""
    if _offline():
        path = Path(folder) / name
        try:
            got = json.loads(path.read_text(encoding="utf-8") or "{}")
        except FileNotFoundError:
            return {}
        return got if isinstance(got, dict) else {}
    _carry(folder)
    row = _run(f"select body from {TABLE} where name = %s", (_key(folder, name),)).fetchone()
    body = row[0] if row else {}
    if isinstance(body, str):
        body = json.loads(body or "{}")
    return body if isinstance(body, dict) else {}


def put(folder: Path | str, name: str, body: Any) -> None:
    """The record kept, whole; raises Unkept when asa-hub-db does not take it."""
    data = json.dumps(body, separators=(",", ":"), default=str)
    if _offline():
        path = Path(folder) / name
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_name(path.name + ".tmp")
        tmp.write_text(data, encoding="utf-8")
        tmp.replace(path)
        return
    _carry(folder)
    _run(f"insert into {TABLE} (name, body, updated_at) values (%s, %s::jsonb, now())"
         " on conflict (name) do update set body = excluded.body, updated_at = excluded.updated_at",
         (_key(folder, name), data))


def names(folder: Path | str, prefix: str) -> list[str]:
    """The records of this folder whose name starts so, in name order."""
    if _offline():
        root = Path(folder)
        return sorted(p.name for p in root.glob(prefix + "*.json")) if root.is_dir() else []
    _carry(folder)
    head = _key(folder, prefix)
    like = head.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
    rows = _run(f"select name from {TABLE} where name like %s order by name", (like,)).fetchall()
    return [str(n)[len(_key(folder, "")):] for (n,) in rows]
