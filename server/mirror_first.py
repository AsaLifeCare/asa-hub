"""Readers answer from their kept copy, then the Postgres mirror, then Google; if Google fails, the newest copy says so."""
from __future__ import annotations

import json
import logging
import os
import tempfile
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, NamedTuple

import hub_rows

try:
    import psycopg2
except Exception:  # pragma: no cover
    psycopg2 = None  # type: ignore[assignment]

log = logging.getLogger("hub.mirror_first")

MAX_AGE_S = float(os.getenv("HUB_MIRROR_MAX_AGE_S", "600"))
# Drive stamps an edit's modifiedTime a little after the edit
VOUCH_MARGIN_S = 60.0
# nothing filed while the relay was down is known, so news starts when this process did
STARTED_AT = time.time()


class MirrorDiffers(RuntimeError):
    """The mirror shows the book changed since the kept copy: ask Google."""


class Vouch(NamedTuple):
    has: bool
    fresh: bool
    as_of: float
    why: str
    # the keeper may read the book after its listing, so rows can hold edits up to this moment
    until: float = 0.0


class Answer(NamedTuple):
    value: Any
    count: int
    as_of: float
    via: str        # 'copy' | 'mirror' | 'live'
    stale: str
    until: float = 0.0


def _ts(value: Any) -> float:
    if value is None or value == "":
        return 0.0
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, datetime):
        return (value if value.tzinfo else value.replace(tzinfo=timezone.utc)).timestamp()
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).timestamp()
    except ValueError:
        return 0.0


def stamp(epoch: float, now: float | None = None) -> str:
    """The date is printed off today: copies outlive restarts, and a bare time made old copies look fresh."""
    if not epoch:
        return "an unknown time"
    at = datetime.fromtimestamp(epoch, timezone.utc)
    today = datetime.fromtimestamp(time.time() if now is None else now, timezone.utc).date()
    return at.strftime("%H:%M:%SZ" if at.date() == today else "%Y-%m-%d %H:%M:%SZ")


def iso(epoch: float) -> str:
    return datetime.fromtimestamp(epoch, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ") if epoch else ""


class PgMirror:
    def __init__(self, dsn: str) -> None:
        self.dsn = dsn

    def _conn(self):
        if psycopg2 is None:
            raise RuntimeError("psycopg2 is not importable")
        conn = psycopg2.connect(self.dsn, connect_timeout=5,
                                options="-c statement_timeout=8000")
        conn.set_session(readonly=True, autocommit=True)
        return conn

    def vouch_row(self, sheet_id: str, tab: str) -> dict[str, Any]:
        conn = self._conn()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "select m.sheet_id is not null, m.last_sync_status, m.modified_time,"
                    " m.last_sync_at,"
                    " exists(select 1 from asa_drive_sheets_rows r"
                    "        where r.sheet_id = %s and r.tab_name = %s)"
                    " from (select 1) one"
                    " left join asa_drive_sheets_meta m on m.sheet_id = %s",
                    (sheet_id, tab, sheet_id))
                known, status, modified, synced, has = (cur.fetchone()
                                                        or (False, None, None, None, False))
                out = {"known": bool(known), "status": status or "", "modified_time": modified,
                       "synced_at": synced, "has_rows": bool(has), "listed_at": None,
                       "pending": [], "dirty": False, "whole_at": None}
                try:
                    cur.execute("select listed_at, pending from hub_sheet_sync_state where id = 1")
                    got = cur.fetchone()
                    if got:
                        out["listed_at"], out["pending"] = got[0], list(got[1] or [])
                    cur.execute("select dirty_since is not null, whole_at from hub_sheet_sync_tabs"
                                " where sheet_id = %s and tab_name = %s", (sheet_id, tab))
                    got = cur.fetchone()
                    out["dirty"] = bool(got and got[0])
                    out["whole_at"] = got[1] if got else None
                except Exception:  # noqa: BLE001
                    out["listed_at"] = None
                return out
        finally:
            conn.close()

    def tab_keys(self, sheet_id: str, tab: str) -> set[str]:
        conn = self._conn()
        try:
            with conn.cursor() as cur:
                cur.execute("select array(select jsonb_object_keys(data)) from asa_drive_sheets_rows"
                            " where sheet_id = %s and tab_name = %s order by row_number limit 1",
                            (sheet_id, tab))
                got = cur.fetchone()
                return set(got[0] or []) if got else set()
        finally:
            conn.close()

    def tab_rows(self, sheet_id: str, tab: str,
                 headers: list[str]) -> tuple[set[str], list[tuple[int, list[Any]]]]:
        """Only the named cells leave Postgres; the keys come from one row's key set, never its values."""
        conn = self._conn()
        try:
            with conn.cursor() as cur:
                cur.execute("select array(select jsonb_object_keys(data)) from asa_drive_sheets_rows"
                            " where sheet_id = %s and tab_name = %s order by row_number limit 1",
                            (sheet_id, tab))
                got = cur.fetchone()
                keys = set(got[0] or []) if got else set()
                cells = ", ".join("data->>%s" for _ in headers) or "null"
                cur.execute(f"select row_number, {cells} from asa_drive_sheets_rows"  # noqa: S608
                            " where sheet_id = %s and tab_name = %s order by row_number",
                            (*headers, sheet_id, tab))
                return keys, [(int(r[0]), list(r[1:])) for r in cur.fetchall()]
        finally:
            conn.close()


# asa-hub-db's copy of the sheets, asked of asa-hub-app; PgMirror read the old platform's mirror
backend: Callable[[str], Any] = hub_rows.MirrorBackend


def vouch(pg_dsn: str, sheet_id: str, tab: str, *, now: float | None = None,
          max_age_s: float | None = None, rows_needed: bool = True) -> Vouch:
    """rows_needed=False vouches for a book the keeper read even when the tab holds no row."""
    now = time.time() if now is None else now
    max_age_s = MAX_AGE_S if max_age_s is None else max_age_s
    if not pg_dsn:
        return Vouch(False, False, 0.0, "no database is configured on this server")
    try:
        row = backend(pg_dsn).vouch_row(sheet_id, tab)
    except Exception as exc:  # noqa: BLE001
        return Vouch(False, False, 0.0, f"the mirror could not be asked ({type(exc).__name__})")
    if not (row.get("has_rows") if rows_needed else row.get("known")):
        return Vouch(False, False, 0.0, "the mirror holds no row of it")
    modified = _ts(row.get("modified_time"))
    listed = _ts(row.get("listed_at"))
    synced = _ts(row.get("synced_at"))
    late = max(modified, synced)
    if str(row.get("status") or "") != "ok":
        return Vouch(True, False, modified, "its last sync into the mirror failed", late)
    if sheet_id in (row.get("pending") or []):
        return Vouch(True, False, modified, "the mirror's last pass still owes it", late)
    if row.get("dirty"):
        return Vouch(True, False, modified, "the mirror is waiting to read it whole", late)
    # a tab kept by appends misses in-place edits to old rows until its next whole read
    whole_at = _ts(row.get("whole_at"))
    if whole_at and modified > whole_at:
        return Vouch(True, False, modified,
                     "the mirror has not re-read it whole since it changed", late)
    if not listed:
        return Vouch(True, False, modified, "the mirror's keeper has not said when it last looked",
                     late)
    as_of = listed - VOUCH_MARGIN_S
    if now - as_of > max_age_s:
        return Vouch(True, False, as_of, f"the mirror last looked at {stamp(listed, now)}",
                     max(as_of, synced))
    return Vouch(True, True, as_of, "", max(as_of, synced))


def mirror_table(pg_dsn: str, sheet_id: str, tab: str, fields: dict[str, str], *,
                 refuse: frozenset[str] | set[str] = frozenset(),
                 required: tuple[str, ...] = (),
                 must_have: tuple[str, ...] | None = None
                 ) -> tuple[set[str], list[dict[str, Any]]]:
    """A refused header is refused before Postgres is asked; a missing must_have column raises, never reads as empty."""
    asked = list(fields.values())
    if any(h in refuse for h in asked):
        raise ValueError("a refused column was asked for in a mirror read")
    keys, got = backend(pg_dsn).tab_rows(sheet_id, tab, asked)
    need = required if must_have is None else must_have
    missing = [fields[k] for k in need if fields[k] not in keys]
    if missing:
        raise RuntimeError(f"the mirror's copy has no {', '.join(repr(m) for m in missing)} column")
    out: list[dict[str, Any]] = []
    for rn, cells in got:
        row: dict[str, Any] = {k: ("" if v is None else v) for k, v in zip(fields, cells)}
        row["_row"] = int(rn)
        if all(str(row[k]).strip() for k in required):
            out.append(row)
    return set(keys), out


def mirror_header(pg_dsn: str, sheet_id: str, tab: str) -> set[str]:
    return set(backend(pg_dsn).tab_keys(sheet_id, tab))


def mirror_rows(pg_dsn: str, sheet_id: str, tab: str, fields: dict[str, str], *,
                refuse: frozenset[str] | set[str] = frozenset(),
                required: tuple[str, ...] = (),
                must_have: tuple[str, ...] | None = None) -> list[dict[str, Any]]:
    return mirror_table(pg_dsn, sheet_id, tab, fields, refuse=refuse, required=required,
                        must_have=must_have)[1]


_DIR: dict[str, Path | None] = {"dir": None}


def arm(directory: Any) -> None:
    path = Path(directory)
    path.mkdir(parents=True, exist_ok=True)
    try:
        os.chmod(path, 0o700)
    except OSError:
        pass
    _DIR["dir"] = path


def armed() -> Path | None:
    return _DIR["dir"]


class Copies:
    """In memory always, on disk once armed; a reader's value must be plain JSON."""

    def __init__(self, name: str) -> None:
        self.name = name
        self._lock = threading.Lock()
        self._items: dict[str, dict[str, Any]] = {}
        self._loaded: Path | None = None
        self._dirty = False

    def _path(self) -> Path | None:
        d = armed()
        return d / f"{self.name}.private.json" if d else None

    def _load(self) -> None:
        path = self._path()
        if path is None or self._loaded == path:
            return
        self._loaded = path
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            return
        except Exception as exc:  # noqa: BLE001
            log.warning("mirror-first: %s could not be read back (%s)", path.name, type(exc).__name__)
            return
        for source, item in (data.get("copies") or {}).items():
            if source not in self._items and isinstance(item, dict) and "value" in item:
                as_of = float(item.get("source_at") or 0.0)
                self._items[source] = {"value": item["value"], "count": int(item.get("count") or 0),
                                       "as_of": as_of,
                                       "until": float(item.get("source_until") or as_of),
                                       "via": str(item.get("via") or "copy")}

    def get(self, source: str) -> dict[str, Any] | None:
        with self._lock:
            self._load()
            item = self._items.get(source)
            return dict(item) if item else None

    def put(self, source: str, value: Any, count: int, as_of: float, via: str,
            write: bool = True, until: float | None = None) -> None:
        with self._lock:
            self._load()
            self._items[source] = {"value": value, "count": int(count), "as_of": float(as_of),
                                   "until": float(as_of if until is None else max(as_of, until)),
                                   "via": via}
            self._dirty = True
        if write:
            self.flush()

    def forget(self) -> None:
        with self._lock:
            self._items.clear()
            self._loaded = None
            self._dirty = False

    def flush(self) -> bool:
        path = self._path()
        with self._lock:
            if path is None or not self._dirty:
                return False
            body = {"built_at": iso(time.time()),
                    "copies": {s: {"source_at": it["as_of"],
                                   "source_until": it.get("until", it["as_of"]),
                                   "via": it["via"], "count": it["count"], "value": it["value"]}
                               for s, it in self._items.items()}}
            self._dirty = False
        try:
            fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=path.name, suffix=".tmp")
            try:
                with os.fdopen(fd, "w", encoding="utf-8") as fh:
                    json.dump(body, fh, separators=(",", ":"), ensure_ascii=False, default=str)
                # 0600: nginx serves this folder's parent
                os.chmod(tmp, 0o600)
                os.replace(tmp, path)
            except BaseException:
                try:
                    os.unlink(tmp)
                except OSError:
                    pass
                raise
            return True
        except Exception as exc:  # noqa: BLE001
            log.warning("mirror-first: %s could not be written (%s)", path.name, type(exc).__name__)
            with self._lock:
                self._dirty = True
            return False


def read(source: str, copies: Copies, *, label: str, need_after: float,
         vouch: Callable[[], Vouch],
         from_mirror: Callable[[dict[str, Any] | None], tuple[Any, int]],
         from_live: Callable[[], tuple[Any, int]],
         paused: Callable[[], str],
         fail: Callable[[str], Exception],
         sentence_of: Callable[[Exception], str] | None = None,
         stale_from_mirror: Callable[[], tuple[Any, int]] | None = None,
         now: float | None = None, max_age_s: float | None = None,
         write: bool = True) -> Answer:
    """from_mirror(kept) builds from the mirror, or confirms `kept` and raises MirrorDiffers if the book changed."""
    now = time.time() if now is None else now
    max_age_s = MAX_AGE_S if max_age_s is None else max_age_s
    say = sentence_of or (lambda exc: f"{label[:1].upper()}{label[1:]} could not be read "
                                      f"({type(exc).__name__}).")
    kept = copies.get(source)
    kept_at = float(kept["as_of"]) if kept else 0.0
    kept_until = float(kept.get("until") or kept_at) if kept else 0.0
    try:
        v = vouch()
    except Exception as exc:  # noqa: BLE001
        v = Vouch(False, False, 0.0, f"the mirror could not be asked ({type(exc).__name__})")
    v_until = max(v.as_of, float(v.until or 0.0))
    outdated = False
    if v.fresh and v.as_of >= need_after and v.as_of > kept_at:
        try:
            value, count = from_mirror(kept)
            copies.put(source, value, count, v.as_of, "mirror", write=write, until=v_until)
            return Answer(value, count, v.as_of, "mirror", "", v_until)
        except MirrorDiffers:
            outdated = True
        except Exception as exc:  # noqa: BLE001
            log.warning("mirror-first: %s from the mirror failed (%s)", source, type(exc).__name__)
    # the kept copy answers alone only beside a vouching mirror, or it would freeze the screen
    if (kept is not None and not outdated and v.fresh and kept_at >= need_after
            and now - kept_at <= max_age_s):
        return Answer(kept["value"], kept["count"], kept_at, "copy", "", kept_until)
    sentence = paused() or ""
    if not sentence:
        try:
            value, count = from_live()
            done = max(now, time.time())
            copies.put(source, value, count, now, "live", write=write, until=done)
            return Answer(value, count, now, "live", "", done)
        except Exception as exc:  # noqa: BLE001
            sentence = say(exc)
    options: list[tuple[float, str]] = []
    if kept is not None:
        options.append((kept_at, "copy"))
    if v.has:
        options.append((v.as_of, "mirror"))
    for at, via in sorted(options, key=lambda o: (-o[0], o[1] != "copy")):
        try:
            if via == "copy":
                value, count = kept["value"], kept["count"]  # type: ignore[index]
                whose = f"Showing the copy read at {stamp(at, now)}."
                until = kept_until
            else:
                value, count = (stale_from_mirror or (lambda: from_mirror(None)))()
                whose = f"Showing the mirror's copy, as of {stamp(at, now)}."
                until = v_until
        except Exception:  # noqa: BLE001
            continue
        return Answer(value, count, at, via, f"{sentence} {whose}".strip(), until)
    raise fail(f"{sentence} No earlier copy exists: the mirror holds no row of {label} "
               "and none was kept.".strip())
