"""The sign-in's tables (db/auth.sql) on the writer role's shared connection: the credentials, the sessions, the
counters Apps Script's script cache held, the temporary passwords, the spent reset links and the importer's stamps.
Every door that gives an account a password keeps it through `credential_put` (users_writes' CREDENTIALS['set']) or
`password_set`, and a write the relay voids takes it back through `credential_void`."""
from __future__ import annotations

import contextlib
import logging
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Iterator

import auth as A
import gsjs
import hubdb
import writes as W

log = logging.getLogger("asa-hub-app.auth")

CREDENTIALS = "app.auth_credentials"
SESSIONS = "app.auth_sessions"
COUNTS = "app.auth_counts"
TEMPS = "app.auth_temp_passwords"
RESET_SPENT = "app.auth_reset_spent"
STATE = "app.auth_state"


def now() -> datetime:
    return datetime.now(timezone.utc)


def _cur(x: Any) -> Any:
    """A cursor from a writes.Tx, a connection or a cursor."""
    if hasattr(x, "cur"):
        return x.cur
    if hasattr(x, "cursor") and not hasattr(x, "fetchone"):
        return x.cursor()
    return x


# ---- the credential ------------------------------------------------------------------------------------------------

MASTER_UIDS = "master_uids"
MASTER_REFUSED = "the master's password is kept by Apps Script while the master signs in there"


def credential(x: Any, uid: str) -> dict[str, Any] | None:
    cur = _cur(x)
    cur.execute(f"select salt, pass_hash, origin from {CREDENTIALS} where user_id = %s", (uid,))
    r = cur.fetchone()
    return None if r is None else {"salt": r[0] or "", "hash": r[1] or "", "origin": r[2]}


def master_uids(x: Any) -> set[str]:
    """The master's account ids, as the importer last found them on the users copy."""
    got = state_get(x, MASTER_UIDS)
    return {u for u in (got[0] if got else "").split(",") if u}


def credential_put(x: Any, uid: str, salt: str, pass_hash: str, write_id: str = "") -> None:
    """The salt and pass_hash cells of every door that gives an account a password (users_writes CREDENTIALS['set']),
    kept with the write that set them and what they replaced; never the master's while the master signs in through
    Apps Script, whose own doors keep it there."""
    if not uid or not salt or not pass_hash:
        raise W.NotKept("a credential names an account, a salt and a hash")
    if A.MASTER_SIGN_IN_ON_APPS_SCRIPT and uid in master_uids(x):
        raise W.NotKept(MASTER_REFUSED)
    _cur(x).execute(
        f"insert into {CREDENTIALS} (user_id, salt, pass_hash, origin, write_id, updated_at)"
        " values (%s, %s, %s, 'python', %s, now()) on conflict (user_id) do update set"
        f" prev_salt = {CREDENTIALS}.salt, prev_pass_hash = {CREDENTIALS}.pass_hash,"
        f" prev_origin = {CREDENTIALS}.origin, prev_write_id = {CREDENTIALS}.write_id,"
        " salt = excluded.salt, pass_hash = excluded.pass_hash, origin = 'python', write_id = excluded.write_id,"
        " updated_at = now()", (uid, salt, pass_hash, write_id))


def credential_void(x: Any, write_id: str) -> int:
    """A write the relay voided (users_writes CREDENTIALS['void']): each credential it set, while still its own, back to
    the one it replaced; one that had none is left blank."""
    if not write_id:
        return 0
    cur = _cur(x)
    cur.execute(f"update {CREDENTIALS} set salt = prev_salt, pass_hash = prev_pass_hash,"
                " origin = coalesce(nullif(prev_origin, ''), origin), write_id = prev_write_id,"
                " prev_salt = '', prev_pass_hash = '', prev_origin = '', prev_write_id = '', updated_at = now()"
                " where write_id = %s", (write_id,))
    return int(getattr(cur, "rowcount", 0) or 0)


def password_set(x: Any, uid: str, password: str, write_id: str = "") -> None:
    """hashPassword_ under a fresh randomHex_(32) salt, kept as the account's credential."""
    if not isinstance(password, str) or not password:
        raise W.NotKept("a password is required")
    salt = A.random_hex(32)
    credential_put(x, uid, salt, A.hash_password(password, salt), write_id)


# ---- the sessions --------------------------------------------------------------------------------------------------

def session_open(x: Any, uid: str, at: datetime | None = None, twin: str = "") -> tuple[str, dict[str, Any]]:
    """sessionCreate_: a fresh token, its hash kept with the account and an expiry SESSION_DAYS out; (the token, handed
    back once and kept nowhere, and the session's row as the Sessions tab keeps it). `twin`: the write whose book op
    lays that row on the tab."""
    t = at or now()
    token = A.mint_token()
    th, exp = A.token_hash(token), t + timedelta(days=A.SESSION_DAYS)
    _cur(x).execute(f"insert into {SESSIONS} (token_hash, user_id, created_at, expires_at, last_seen, origin, twin)"
                    " values (%s, %s, %s, %s, %s, 'python', %s)", (th, uid, t, exp, t, twin))
    return token, {"token_hash": th, "user_id": uid, "created_at": gsjs.iso(t), "expires_at": gsjs.iso(exp),
                   "last_seen": gsjs.iso(t)}


def child_open(x: Any, target_uid: str, real_uid: str, parent_th: str, until: datetime, at: datetime,
               twin: str = "") -> tuple[str, dict[str, Any]]:
    """A session minted from the master's own: it wears the target, names the real account and its parent, and
    lives until `until` (never slid)."""
    token = A.mint_token()
    th = A.token_hash(token)
    _cur(x).execute(f"insert into {SESSIONS} (token_hash, user_id, created_at, expires_at, last_seen, origin, twin,"
                    " real_user_id, parent_token_hash) values (%s, %s, %s, %s, %s, 'python', %s, %s, %s)",
                    (th, target_uid, at, until, at, twin, real_uid, parent_th))
    return token, {"token_hash": th, "user_id": target_uid, "created_at": gsjs.iso(at), "expires_at": gsjs.iso(until),
                   "last_seen": gsjs.iso(at), "acting_real_user_id": real_uid, "parent_token_hash": parent_th}


def children_end(x: Any, parent_th: str) -> list[str]:
    """Every live session minted from this one, ended; the writes that queued their rows."""
    if not parent_th:
        return []
    cur = _cur(x)
    cur.execute(f"update {SESSIONS} set revoked_at = now() where parent_token_hash = %s and revoked_at is null"
                " returning twin", (parent_th,))
    return [r[0] for r in cur.fetchall()]


def account_sessions_end(x: Any, uid: str) -> list[tuple[str, str]]:
    """releaseEndSessions_: every session of the account, and every one minted from them; (token hash, twin) of
    each."""
    cur = _cur(x)
    cur.execute(f"update {SESSIONS} set revoked_at = now() where revoked_at is null and (user_id = %s or"
                f" parent_token_hash in (select token_hash from {SESSIONS} where user_id = %s))"
                " returning token_hash, twin", (uid, uid))
    return [(r[0], r[1]) for r in cur.fetchall()]


def session_of(x: Any, th: str) -> dict[str, Any] | None:
    cur = _cur(x)
    cur.execute(f"select user_id, created_at, expires_at, last_seen, revoked_at, origin, twin, real_user_id,"
                f" parent_token_hash from {SESSIONS} where token_hash = %s", (th,))
    r = cur.fetchone()
    if r is None:
        return None
    return {"user_id": r[0], "created_at": r[1], "expires_at": r[2], "last_seen": r[3], "revoked_at": r[4],
            "origin": r[5], "twin": r[6] or "", "real_user_id": r[7] or "", "parent_token_hash": r[8] or ""}


def session_live(s: dict[str, Any] | None, at: datetime | None = None) -> bool:
    return bool(s) and s["revoked_at"] is None and s["expires_at"] > (at or now())


def session_slide(x: Any, th: str, at: datetime | None = None) -> bool:
    """Sliding TTL: refreshed at most once a day; True when it moved."""
    t = at or now()
    cur = _cur(x)
    cur.execute(f"update {SESSIONS} set expires_at = %s, last_seen = %s where token_hash = %s and revoked_at is null"
                " and expires_at > %s and last_seen < %s",
                (t + timedelta(days=A.SESSION_DAYS), t, th, t, t - timedelta(seconds=A.SLIDE_S)))
    return bool(getattr(cur, "rowcount", 0))


def session_end(x: Any, th: str) -> bool:
    """sessionDestroy_."""
    cur = _cur(x)
    cur.execute(f"update {SESSIONS} set revoked_at = now() where token_hash = %s and revoked_at is null", (th,))
    return bool(getattr(cur, "rowcount", 0))


# ---- the counters (CacheService.getScriptCache: a count good until its key's time runs out) ------------------------

def count(x: Any, kind: str, key: str, at: datetime | None = None) -> int:
    cur = _cur(x)
    cur.execute(f"select n from {COUNTS} where kind = %s and key_hash = %s and expires_at > %s",
                (kind, key, at or now()))
    r = cur.fetchone()
    return int(r[0]) if r else 0


def count_put(x: Any, kind: str, key: str, n: int, ttl_s: float, at: datetime | None = None) -> None:
    """cache.put(key, n, ttl): the count and a fresh expiry."""
    t = at or now()
    _cur(x).execute(f"insert into {COUNTS} (kind, key_hash, n, expires_at) values (%s, %s, %s, %s)"
                    " on conflict (kind, key_hash) do update set n = excluded.n, expires_at = excluded.expires_at",
                    (kind, key, int(n), t + timedelta(seconds=ttl_s)))


def count_drop(x: Any, kind: str, key: str) -> None:
    """cache.remove(key)."""
    _cur(x).execute(f"update {COUNTS} set n = 0, expires_at = now() where kind = %s and key_hash = %s", (kind, key))


# ---- the temporary passwords (PasswordReset.gs temp_passwords) ----------------------------------------------------

def temp_live(x: Any, uid: str, at: datetime | None = None) -> dict[str, Any] | None:
    """resetTempLive_: the account's NEWEST temporary password while it is unused and inside its window."""
    cur = _cur(x)
    cur.execute(f"select id, salt, pass_hash, expires_at, used_at from {TEMPS} where user_id = %s"
                " order by created_at desc, id desc limit 1", (uid,))
    r = cur.fetchone()
    if r is None or r[4] is not None or not (r[3] > (at or now())):
        return None
    return {"id": int(r[0]), "salt": r[1] or "", "hash": r[2] or ""}


def temp_match(x: Any, uid: str, password: str) -> dict[str, Any] | None:
    """resetTempMatch_."""
    live = temp_live(x, uid) if uid and password else None
    if not live or not live["salt"] or not live["hash"]:
        return None
    return live if A.same(A.hash_password(password, live["salt"]), live["hash"]) else None


def temp_spend(x: Any, hit: dict[str, Any]) -> bool:
    """resetTempSpend_: marked used only while it is still the live one."""
    cur = _cur(x)
    cur.execute(f"update {TEMPS} t set used_at = now() where t.id = %s and t.used_at is null and t.expires_at > now()"
                f" and t.pass_hash = %s and not exists (select 1 from {TEMPS} n where n.user_id = t.user_id"
                " and (n.created_at, n.id) > (t.created_at, t.id))", (hit["id"], hit["hash"]))
    return bool(getattr(cur, "rowcount", 0))


def temp_issued_since(x: Any, uid: str, since: datetime) -> int:
    """resetTempIssuedSince_."""
    cur = _cur(x)
    cur.execute(f"select count(*) from {TEMPS} where user_id = %s and created_at >= %s", (uid, since))
    return int(cur.fetchone()[0])


def temp_keep(x: Any, uid: str, password: str, channel: str, minutes: int, write_id: str = "") -> None:
    salt = A.random_hex(32)
    t = now()
    _cur(x).execute(f"insert into {TEMPS} (user_id, salt, pass_hash, channel, created_at, expires_at, write_id)"
                    " values (%s, %s, %s, %s, %s, %s, %s)",
                    (uid, salt, A.hash_password(password, salt), channel, t, t + timedelta(minutes=minutes), write_id))


# ---- the reset links already spent, the importer's stamps ---------------------------------------------------------

def reset_spent(x: Any, th: str) -> bool:
    cur = _cur(x)
    cur.execute(f"select 1 from {RESET_SPENT} where token_hash = %s", (th,))
    return cur.fetchone() is not None


def reset_spend(x: Any, th: str, uid: str) -> bool:
    cur = _cur(x)
    cur.execute(f"insert into {RESET_SPENT} (token_hash, user_id) values (%s, %s) on conflict do nothing", (th, uid))
    return bool(getattr(cur, "rowcount", 0))


def state_put(x: Any, key: str, value: str) -> None:
    _cur(x).execute(f"insert into {STATE} (key, value, at) values (%s, %s, now())"
                    " on conflict (key) do update set value = excluded.value, at = now()", (key, value))


def state_get(x: Any, key: str) -> tuple[str, datetime] | None:
    cur = _cur(x)
    cur.execute(f"select value, at from {STATE} where key = %s", (key,))
    r = cur.fetchone()
    return (r[0], r[1]) if r else None


class Store(W.Store):
    """The writer role's shared connection (HUB_DB_WRITE_DSN); the tables are db/auth.sql's, never made here."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="auth", label="the sign-in")

    def ensure(self) -> str:
        if not self.available:
            return self.why
        with self._lock:
            if self._ready:
                return ""
            self._tried = time.time()
            try:
                c = self.conn()
                for t in (CREDENTIALS, SESSIONS, COUNTS, TEMPS, RESET_SPENT, STATE):
                    c.execute(f"select 1 from {t} limit 0")
                self._ready, self.why = True, ""
            except Exception as exc:  # noqa: BLE001 - said on /healthz; the sign-in stays on Apps Script meanwhile
                self._drop()
                self.why = f"the sign-in's tables are not ready ({type(exc).__name__}): apply db/auth.sql"
        return self.why

    @contextlib.contextmanager
    def tx(self) -> Iterator[Any]:
        """One transaction on the shared connection, without the platform's write lock."""
        c = self.conn()
        try:
            with c.transaction():
                yield c.cursor()
        except Exception as exc:
            if getattr(exc, "sqlstate", None) is not None or type(exc).__module__.startswith("psycopg"):
                self._drop()
                raise hubdb.Unreadable(f"the sign-in's store did not answer ({type(exc).__name__})") from exc
            raise
