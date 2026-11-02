"""My Inbox's read and cleared marks and its first sightings (server/my_inbox.py read_marks, mark_read, seen), kept in
asa-hub-db (app.inbox_reads, app.inbox_seen) and merged with the relay's own rows it hands in with each call: the newest
read and cleared stamps win, the earliest first sighting wins. The relay's tables are never read from here."""
from __future__ import annotations

import logging
import re
from datetime import date, datetime, timezone
from typing import Any

import gsjs
import hubdb
from scope import Defer

log = logging.getLogger("asa-hub-app")

UTC = timezone.utc
READS_TABLE = "app.inbox_reads"
SEEN_TABLE = "app.inbox_seen"
# the payload field the relay hands its rows in: {user_id, reads: [...], seen: [...]}
PAYLOAD_KEY = "inbox_marks"
# server/my_inbox.py's words for the keys and the marks
KEY_RE = re.compile(r"^[a-z_]+:[A-Za-z0-9:._-]{1,200}$")
NOTICE_KEY_RE = re.compile(r"^srv-([1-9][0-9]{0,17})$")
READ_MAX = 500
BASELINE = "~baseline"
PRUNE_KINDS = ("punch", "move", "staff", "staffcount", "client", "prospects")
PRUNE_DAYS = 60
NOT_HANDED = "the relay handed no read marks, so the relay answers"

_BOUND: dict[str, Any] = {"store": None}


def bind(store: Any) -> None:
    """The store the marks are read and kept through (main.py's my_inbox_writes.Store)."""
    _BOUND["store"] = store


def ddl() -> tuple[str, ...]:
    return (
        f"create table if not exists {READS_TABLE} (user_id text not null, alert_key text not null,"
        " read_at timestamptz not null default now(), dismissed_at timestamptz, primary key (user_id, alert_key))",
        f"create table if not exists {SEEN_TABLE} (kind text not null, key text not null,"
        " first_seen timestamptz not null default now(), primary key (kind, key))",
    )


def split_keys(keys: Any) -> tuple[list[int], list[str], int]:
    """(bell notice ids, inbox alert keys, how many could not be read) — at most READ_MAX looked at."""
    notices: list[int] = []
    alerts: list[str] = []
    ignored = 0
    for k in list(keys or [])[:READ_MAX]:
        text = k if isinstance(k, str) else ""
        m = NOTICE_KEY_RE.fullmatch(text)
        if m:
            notices.append(int(m.group(1)))
        elif KEY_RE.fullmatch(text):
            alerts.append(text)
        else:
            ignored += 1
    return sorted(set(notices)), sorted(set(alerts)), ignored


# ---- the relay's rows, as handed ------------------------------------------------------------------------------------

def _ts(v: Any) -> datetime | None:
    if isinstance(v, datetime):
        return v if v.tzinfo else v.replace(tzinfo=UTC)
    if isinstance(v, date) or v is None or not str(v).strip():
        return None
    try:
        got = datetime.fromisoformat(str(v).strip().replace("Z", "+00:00"))
    except ValueError:
        raise Defer("the relay handed a read mark this reader cannot date") from None
    return got if got.tzinfo else got.replace(tzinfo=UTC)


def _later(a: datetime | None, b: datetime | None) -> datetime | None:
    return b if a is None else a if b is None else max(a, b)


def _earlier(a: datetime | None, b: datetime | None) -> datetime | None:
    return b if a is None else a if b is None else min(a, b)


def _fold_read(held: dict[str, Any] | None, read_at: Any, dismissed_at: Any) -> dict[str, Any]:
    held = held or {"read_at": None, "dismissed_at": None}
    return {"read_at": _later(held["read_at"], _ts(read_at)), "dismissed_at": _later(held["dismissed_at"],
                                                                                     _ts(dismissed_at))}


def _marks_of(given: Any) -> dict[str, Any]:
    """The relay's marks from a payload (its inbox_marks) or the marks themselves; Defer when none were handed."""
    marks = given.get(PAYLOAD_KEY) if isinstance(given, dict) and PAYLOAD_KEY in given else given
    if not isinstance(marks, dict) or not isinstance(marks.get("reads"), list) \
            or not isinstance(marks.get("seen"), list):
        raise Defer(NOT_HANDED)
    return marks


def _seen_of(marks: dict[str, Any]) -> dict[tuple[str, str], datetime]:
    seen: dict[tuple[str, str], datetime] = {}
    for r in marks["seen"]:
        if not isinstance(r, dict):
            continue
        kind, key, at = gsjs.or_blank(r.get("kind")), gsjs.or_blank(r.get("key")), _ts(r.get("first_seen"))
        if kind and key and at is not None:
            seen[(kind, key)] = _earlier(seen.get((kind, key)), at)
    return seen


def handed_of(given: Any, user_id: str) -> dict[str, Any]:
    """{user_id, reads, seen}: the relay's rows for this account (another account's are never taken)."""
    marks = _marks_of(given)
    uid = gsjs.trim(gsjs.or_blank(user_id))
    if gsjs.trim(gsjs.or_blank(marks.get("user_id"))) != uid:
        raise Defer("the relay handed another account's read marks")
    reads: dict[str, dict[str, Any]] = {}
    for r in marks["reads"]:
        if not uid or not isinstance(r, dict) or gsjs.trim(gsjs.or_blank(r.get("user_id"))) != uid:
            continue
        key = gsjs.or_blank(r.get("alert_key"))
        if key:
            reads[key] = _fold_read(reads.get(key), r.get("read_at"), r.get("dismissed_at"))
    return {"user_id": uid, "reads": reads, "seen": _seen_of(marks)}


# ---- asa-hub-db's own rows ------------------------------------------------------------------------------------------

def _store() -> Any:
    store = _BOUND["store"]
    if store is None or not store.available:
        raise Defer("My Inbox's marks are not kept on this service (no write store), so the relay answers")
    if not store.ready():
        raise Defer((store.why or "My Inbox's marks store is not ready")[:160])
    return store


def _query(sql: str, params: tuple = ()) -> list[tuple]:
    store = _store()
    try:
        return list(store.conn().execute(sql, params).fetchall())
    except Exception as exc:  # noqa: BLE001 - the marks not answering is never "none"
        store._drop()
        raise hubdb.Unreadable(f"My Inbox's marks did not answer ({type(exc).__name__})") from exc


def own_reads(user_id: str, keys: list[str] | None = None) -> dict[str, dict[str, Any]]:
    """This account's marks kept here (on `keys` alone when given)."""
    uid = gsjs.trim(gsjs.or_blank(user_id))
    if not uid or keys == []:
        return {}
    if keys is None:
        rows = _query(f"select alert_key, read_at, dismissed_at from {READS_TABLE} where user_id = %s", (uid,))
    else:
        rows = _query(f"select alert_key, read_at, dismissed_at from {READS_TABLE}"
                      " where user_id = %s and alert_key = any(%s::text[])", (uid, list(keys)))
    return {str(k): _fold_read(None, r, d) for k, r, d in rows}


def own_seen(kind: str | None = None, keys: list[str] | None = None) -> dict[tuple[str, str], datetime]:
    if kind is None:
        rows = _query(f"select kind, key, first_seen from {SEEN_TABLE}")
    else:
        rows = _query(f"select kind, key, first_seen from {SEEN_TABLE} where kind = %s and key = any(%s::text[])",
                      (kind, list(keys or [])))
    return {(str(k), str(key)): _ts(at) for k, key, at in rows}


def merged_reads(*sources: dict[str, dict[str, Any]]) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for src in sources:
        for key, m in src.items():
            out[key] = _fold_read(out.get(key), m.get("read_at"), m.get("dismissed_at"))
    return out


def merged_seen(*sources: dict[tuple[str, str], datetime]) -> dict[tuple[str, str], datetime]:
    out: dict[tuple[str, str], datetime] = {}
    for src in sources:
        for k, at in src.items():
            if at is not None:
                out[k] = _earlier(out.get(k), at)
    return out


def marks_for(sess_or_reads: Any, user_id: str, handed: Any) -> dict[str, Any]:
    """{reads: {alert_key: {read_at, dismissed_at}}, seen: {(kind, key): first_seen}}: the relay's rows handed in and
    asa-hub-db's own, merged (the session or reader is the caller's; the marks are the store's)."""
    relay = handed_of(handed, user_id)
    return {"reads": merged_reads(relay["reads"], own_reads(relay["user_id"])),
            "seen": merged_seen(relay["seen"], own_seen())}


def record_seen(sess_or_reads: Any, kind: str, keys: list[str], handed: Any = None, *,
                record: bool = True) -> tuple[dict[str, datetime], datetime | None]:
    """server/my_inbox.py seen(): ({key: first seen}, when this kind began to be watched). `record` keeps the keys not
    seen before (and the kind's baseline) in app.inbox_seen, each at the relay's own first sighting when one is handed,
    else now; marks_for merges them again, the earliest first."""
    relay = _seen_of(_marks_of(handed)) if handed is not None else {}
    want = sorted({str(k) for k in keys or [] if str(k)} | {BASELINE})
    if record:
        store = _store()
        stamps = [relay.get((kind, k)) for k in want]
        try:
            store.conn().execute(
                f"insert into {SEEN_TABLE} as s (kind, key, first_seen)"
                " select %s::text, k, coalesce(t, now()) from unnest(%s::text[], %s::timestamptz[]) as u(k, t)"
                " on conflict (kind, key) do update set first_seen = excluded.first_seen"
                " where excluded.first_seen < s.first_seen", (kind, want, stamps))
        except Exception as exc:  # noqa: BLE001 - said by the one source that asked
            store._drop()
            raise hubdb.Unreadable(f"My Inbox's first sightings were not kept ({type(exc).__name__})") from exc
    got = merged_seen({k: v for k, v in relay.items() if k[0] == kind and k[1] in want}, own_seen(kind, want))
    rows = {k[1]: at for k, at in got.items()}
    baseline = rows.pop(BASELINE, None)
    return rows, baseline


class Marks:
    """The relay Store's two mark doors (server/my_inbox.py Store.marks and Store.seen) over the merged marks: the
    relay's rows checked and asa-hub-db's read when made, so a store that cannot answer defers before any source
    runs."""

    def __init__(self, sess_or_reads: Any, user_id: str, handed: Any) -> None:
        self.handed = _marks_of(handed)
        self.relay = handed_of(self.handed, user_id)
        self.uid = self.relay["user_id"]
        self.own = own_reads(self.uid)

    def marks(self, uid: str, keys: list[str], *, ensure: bool = False) -> dict[str, dict[str, Any]]:
        """read_marks(): {alert_key: {alert_key, read_at, dismissed_at}} on these keys, for the subject alone."""
        if gsjs.trim(gsjs.or_blank(uid)) != self.uid or not self.uid or not keys:
            return {}
        both = merged_reads(self.relay["reads"], self.own)
        return {k: {"alert_key": k, **both[k]} for k in keys if k in both}

    def seen(self, kind: str, keys: list[str], *, record: bool) -> tuple[dict[str, datetime], datetime | None]:
        return record_seen(None, kind, keys, self.handed, record=record)

    def close(self) -> None:
        return None


# ---- the write: the session's own marks, under the write store's transaction ----------------------------------------

def keep_marks(cur: Any, uid: str, keys: Any, dismiss: bool) -> int:
    """mark_read(): this account's read (or cleared) marks; a read stamp stays the first, a clearing stays once made."""
    uid = gsjs.trim(gsjs.or_blank(uid))
    clean = sorted({k for k in list(keys or [])[:READ_MAX] if isinstance(k, str) and KEY_RE.fullmatch(k)})
    if not uid or not clean:
        return 0
    cur.execute(f"insert into {READS_TABLE} as r (user_id, alert_key, read_at, dismissed_at)"
                " select %s::text, k, now(), %s::timestamptz from unnest(%s::text[]) as k"
                " on conflict (user_id, alert_key) do update set dismissed_at = coalesce(r.dismissed_at,"
                " excluded.dismissed_at)", (uid, datetime.now(UTC) if dismiss else None, clean))
    return len(clean)


def prune(cur: Any, uid: str) -> None:
    """_prune(): this account's marks on alerts long gone from the list let go; the marks just kept stand either way."""
    try:
        with cur.connection.transaction():
            cur.execute(f"delete from {READS_TABLE} where user_id = %s"
                        " and read_at < now() - make_interval(days => %s::int)"
                        " and split_part(alert_key, ':', 1) = any(%s::text[])", (uid, PRUNE_DAYS, list(PRUNE_KINDS)))
    except Exception as exc:  # noqa: BLE001
        log.warning("my inbox: old read marks were not let go (%s)", type(exc).__name__)
