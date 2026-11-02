"""Person-to-person chat in the Hub's own tables (db/chat.sql), never a sheet: a thread is the messages between two people,
keyed by the pair. Six doors, the relay's alone (POST /v1/chat/<action>): the rail, one thread and the shell's
heartbeat, and a send, a reaction and a read mark. A write is decided once under its write id and answered again from
its receipt. Accounts fold onto one person only through a `merged_into` cell; a client-role caller sees its circle."""
from __future__ import annotations

import hashlib
import secrets
import threading
import time
import unicodedata
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

import clients as C
import gsjs
import hubdb
import locations as L
import scope as sc
import smart_comms_desk
import ssa
import staff
import writes

MESSAGES = "app.chat_messages"
PRESENCE = "app.chat_presence"
RECEIPTS = "app.chat_receipts"

READS = ("chatOverview", "chatMessages", "chatPing")
WRITES = ("chatSend", "chatReact", "chatMarkRead")
ACTIONS = READS + WRITES

ONLINE = timedelta(minutes=6)
BODY_MAX = 4000
EMOJI_MAX = 16
LAST_MAX = 140
THREAD_MAX = 300
# a send the relay took names its moment: never more than two minutes ahead, never a day old
SEND_AHEAD = timedelta(minutes=2)
SEND_BACK = timedelta(hours=24)
NARROWED_ROLES = ("client", "guardian")
CIRCLE_TTL_S = 600.0
CIRCLES_MAX = 2000

NOT_FOUND = {"status": 404, "message": "Not found."}
NO_MESSAGE = {"status": 404, "message": "No such message."}
SERVICE = {"status": 403, "message": "A service session does not chat."}

_COLS = "seq, message_id, from_user, from_name, to_user, body, created_at, read_at, reactions"


class Store(writes.Store):
    """The chat's tables, through the writer connection every store on the DSN shares."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn=dsn, connect=connect, kind="chat", label="Chat")
        if not self.available:
            self.why = "no HUB_DB_WRITE_DSN is set, so the chat can be neither read nor written"

    def ensure(self) -> str:
        """The tables are db/chat.sql's, applied by hand: here they are only looked for."""
        if not self.available:
            return self.why
        with self._lock:
            if self._ready:
                return ""
            self._tried = time.time()
            try:
                got = self.conn().execute("select to_regclass(%s), to_regclass(%s), to_regclass(%s)",
                                          (MESSAGES, PRESENCE, RECEIPTS)).fetchone()
                if not got or not all(got):
                    raise RuntimeError("the chat tables are missing: apply db/chat.sql")
                self._ready, self.why = True, ""
            except Exception as exc:  # noqa: BLE001 - said on /healthz; every chat door answers 503 meanwhile
                self._drop()
                self.why = f"the chat store is not ready ({type(exc).__name__}: {str(exc)[:120]})"
        return self.why

    def run(self, fn: Callable[[Any], Any]) -> Any:
        """fn(connection); a connection that failed is dropped and the call said unreadable, never half-answered."""
        try:
            return fn(self.conn())
        except Exception as exc:
            if getattr(exc, "sqlstate", None) is not None or type(exc).__module__.startswith("psycopg"):
                self._drop()
                raise hubdb.Unreadable(f"the chat store did not answer ({type(exc).__name__})") from exc
            raise


def iso(at: datetime | None) -> str:
    """Date.toISOString(): milliseconds and a Z."""
    if at is None:
        return ""
    u = at.astimezone(timezone.utc)
    return u.strftime("%Y-%m-%dT%H:%M:%S.") + f"{u.microsecond // 1000:03d}Z"


def _parse(v: Any) -> datetime | None:
    s = gsjs.str_(v)
    if not s:
        return None
    try:
        at = datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None
    return at if at.tzinfo else at.replace(tzinfo=timezone.utc)


def narrowed_account(role: Any, types: Any, email: Any) -> bool:
    """chatNarrowed_: a client's or a guardian's account — by its role, or by a ticked GUARDIAN whatever its role says
    (a family account is never matched on its role word: scope.role_counts); the master is never narrowed by a tick."""
    if gsjs.str_(role).lower() in NARROWED_ROLES:
        return True
    return not sc.role_counts(types, role) and not sc.is_master_email(email)


def family_column(types: Any, email: Any) -> bool:
    """An SSA or a FAMILY account (the master never): the operator's sheet shuts My Inbox › Chat to both, so no chat door
    answers it and nobody writes to it or finds it here."""
    return any(t in sc.FAMILY_TICKS for t in sc.types_from_raw(types)) and not sc.is_master_email(email)


def _sort_name(s: str) -> str:
    """localeCompare's order, near enough: accents and case set aside."""
    return "".join(c for c in unicodedata.normalize("NFKD", s) if not unicodedata.combining(c)).casefold()


class People:
    """The users copy as the chat folds it (chatPeopleIndex_): an account onto the person its `merged_into` names."""

    def __init__(self, rows: list[dict[str, Any]]) -> None:
        self.rows = rows
        fold: dict[str, str] = {}
        for u in rows:
            uid = gsjs.str_(u.get("userid"))
            same = gsjs.str_(u.get("sameas")) or gsjs.str_(u.get("mergedinto")) or gsjs.str_(u.get("personid"))
            if uid and same and same != uid:
                fold[uid] = same
        for acct in list(fold):
            seen: set[str] = set()
            at = fold[acct]
            while at in fold and at not in seen:
                seen.add(at)
                at = fold[at]
            fold[acct] = at
        self.fold = fold
        self._accounts: dict[str, list[str]] = {}
        for acct, pid in fold.items():
            self._accounts.setdefault(pid, []).append(acct)
        self.ids = {gsjs.str_(u.get("userid")) for u in rows if gsjs.str_(u.get("userid"))}

    def person(self, uid: Any) -> str:
        u = gsjs.str_(uid)
        return (self.fold.get(u) or u) if u else ""

    def accounts(self, pid: Any) -> list[str]:
        """chatPersonAccounts_: the person and every account folded onto them."""
        want = self.person(pid)
        if not want:
            return []
        return [want] + [a for a in self._accounts.get(want, []) if a != want]

    def key(self, a: Any, b: Any) -> str:
        """chatThreadKey_: the two people, sorted."""
        x, y = self.person(a), self.person(b)
        if not x or not y:
            return ""
        return f"{x}|{y}" if x < y else f"{y}|{x}"


def other_of(key: str, me: str) -> str:
    parts = key.split("|")
    if len(parts) != 2:
        return ""
    return parts[1] if parts[0] == me else parts[0]


class Ctx:
    """One call: the store, the request's reads, the caller and the people as the chat folds them."""

    def __init__(self, store: Store, reads: L.Reads, user: dict[str, Any]) -> None:
        self.store = store
        self.reads = reads
        self.user = user
        self.people = People(reads.users())
        self.me = self.people.person(user.get("id"))
        self.name = gsjs.str_(user.get("display_name") or user.get("name")) or gsjs.str_(user.get("email"))
        self.narrowed = (not user.get("is_service")) and narrowed_account(user.get("role"), user.get("types"),
                                                                           user.get("email"))
        # a session that leaves no line reads, but is not the person at a keyboard: it stamps no presence
        self.present = not user.get("unlogged")
        self.now = datetime.now(timezone.utc)

    def rows(self, sql_where: str, params: tuple) -> list[dict[str, Any]]:
        def read(c: Any) -> list[dict[str, Any]]:
            cur = c.execute(f"select {_COLS} from {MESSAGES} where {sql_where} order by seq", params)
            return [_row(r) for r in cur.fetchall()]
        return self.store.run(read)

    def rows_of(self, accounts: list[str]) -> list[dict[str, Any]]:
        return self.rows("from_user = any(%s) or to_user = any(%s)", (accounts, accounts))

    def rows_between(self, a: str, b: str) -> list[dict[str, Any]]:
        """Every message of the thread between these two people, in the order they were taken."""
        mine, theirs = self.people.accounts(a), self.people.accounts(b)
        key = self.people.key(a, b)
        got = self.rows("(from_user = any(%s) and to_user = any(%s)) or (from_user = any(%s) and to_user = any(%s))",
                        (mine, theirs, theirs, mine))
        return [r for r in got if self.people.key(r["from_user"], r["to_user"]) == key]

    def presence(self) -> dict[str, datetime]:
        def read(c: Any) -> dict[str, datetime]:
            return {uid: at for uid, at in c.execute(f"select user_id, seen_at from {PRESENCE}").fetchall()}
        return self.store.run(read)

    def online(self, presence: dict[str, datetime], pid: str, window: timedelta = ONLINE) -> bool:
        return any(self.now - presence[a] < window for a in self.people.accounts(pid) if a in presence)

    def touch(self, c: Any = None) -> None:
        """chatTouchPresence_: this person is here now; a name already on file stays."""
        if not self.me or not self.present:
            return
        sql = (f"insert into {PRESENCE} (user_id, name, seen_at) values (%s, %s, now()) on conflict (user_id) do update"
               f" set seen_at = excluded.seen_at, name = case when {PRESENCE}.name = '' then excluded.name"
               f" else {PRESENCE}.name end")
        if c is not None:
            c.execute(sql, (self.me, self.name))
        else:
            self.store.run(lambda conn: conn.execute(sql, (self.me, self.name)))


def _row(r: tuple) -> dict[str, Any]:
    seq, mid, frm, frm_name, to, body, created, read, reactions = r
    return {"seq": seq, "message_id": mid, "from_user": frm, "from_name": frm_name, "to_user": to, "body": body,
            "created_at": created, "read_at": read, "reactions": reactions if isinstance(reactions, dict) else {}}


def reactions_of(row: dict[str, Any]) -> dict[str, list[str]] | None:
    """chatReactionsOf_: the marks a message carries, none for an empty map."""
    out = {e: list(ids) for e, ids in (row.get("reactions") or {}).items() if isinstance(ids, list) and ids}
    return out or None


# ── a client-role account's circle ──────────────────────────────────────────

_CIRCLES: dict[str, tuple[float, dict[str, Any]]] = {}
_CIRCLES_LOCK = threading.Lock()


def accounts_index(ctx: Ctx) -> dict[str, Any]:
    """chatAccountIndex_: person → {client, office}; folded name, sign-in e-mail and client key → the live people."""
    def build() -> dict[str, Any]:
        by_person: dict[str, dict[str, bool]] = {}
        by_name: dict[str, list[str]] = {}
        by_email: dict[str, list[str]] = {}
        by_client: dict[str, list[str]] = {}

        def wear(m: dict[str, list[str]], k: str, pid: str) -> None:
            if k:
                worn = m.setdefault(k, [])
                if pid not in worn:
                    worn.append(pid)

        for u in ctx.people.rows:
            uid = gsjs.str_(u.get("userid"))
            if not uid or gsjs.str_(u.get("isservice")).lower() == "true":
                continue
            pid = ctx.people.person(uid)
            p = by_person.setdefault(pid, {"client": False, "office": False})
            role = gsjs.str_(u.get("role")).lower()
            family = narrowed_account(role, u.get("types"), u.get("email"))
            if family:
                p["client"] = True
            if role == "admin" or sc.is_master_email(u.get("email")):
                p["office"] = True
            off = gsjs.str_(u.get("active")).upper()
            if off in ("FALSE", "0", "NO") or gsjs.str_(u.get("mergedinto")):
                continue
            wear(by_name, gsjs.name_key(u.get("displayname")), pid)
            wear(by_email, gsjs.str_(u.get("email")).lower(), pid)
            if family:
                wear(by_client, gsjs.str_(u.get("clientkey")), pid)
        return {"by_person": by_person, "by_name": by_name, "by_email": by_email, "by_client": by_client}
    return ctx.reads.once("chat_accounts", build)


def _soft(fn: Callable[[], Any]) -> Any:
    try:
        return fn()
    except Exception:  # noqa: BLE001 - what cannot be read adds nobody
        return None


def _serving(ctx: Ctx, key: str, idx: dict[str, Any]) -> tuple[set[str], list[str], bool]:
    """chatServingIds_: the people who serve one client beyond its house's calendar."""
    me = ctx.me
    ids: set[str] = set()
    why: list[str] = []
    lasting = True

    def staff_only(pid: str) -> None:
        p = idx["by_person"].get(pid)
        if pid != me and p and not p["client"]:
            ids.add(pid)

    for pid in idx["by_client"].get(key, []):
        if pid != me:
            ids.add(pid)
    try:
        got = ssa.index(ctx.reads)
        mails = {gsjs.str_(c.get("ssa_email")).lower()
                 for s in (got.get("ssas") or {}).values() for c in s.get("clients") or []
                 if C.client_live(c) and gsjs.str_(c.get("client_key")) == key and c.get("ssa_email")}
        for m in mails:
            worn = idx["by_email"].get(m) or []
            if len(worn) == 1:
                staff_only(worn[0])
        if got.get("degraded"):
            why.append("Not every client record could be read, so its SSA may be missing.")
    except Exception:  # noqa: BLE001
        why.append("The SSA records could not be read just now, so its SSA is not listed.")
        lasting = False
    try:
        houses = ctx.reads.houses_of([key])
        seen = L.staff_visible(ctx.reads, houses["codes"])
        for k in seen.get("keys") or []:
            worn = idx["by_name"].get(k) or []
            if len(worn) == 1:
                staff_only(worn[0])
        if houses.get("why") or seen.get("why"):
            why.append("Not every record of its house's staff could be read, so some of them may be missing.")
    except Exception:  # noqa: BLE001
        why.append("Its house's staff records could not be read just now, so they are not listed.")
        lasting = False
    return ids, why, lasting


def circle(ctx: Ctx) -> dict[str, Any]:
    """chatCircle_: {ids, why} — the office, then the client's house calendar, its SSA and its house's staff."""
    me = ctx.me
    with _CIRCLES_LOCK:
        held = _CIRCLES.get(me)
    if held and time.time() - held[0] < CIRCLE_TTL_S:
        return held[1]
    idx = accounts_index(ctx)
    ids = {pid for pid, p in idx["by_person"].items() if p["office"] and not p["client"] and pid != me}
    why: list[str] = []
    lasting = True
    key = sc.client_key_of(ctx.user)
    codes: list[str] = []
    if not key:
        why.append("This account is not linked to a client yet, so only the office is listed.")
    else:
        # FAIL-CLOSED: a client whose house cannot be named is shown no house
        houses = _soft(lambda: ctx.reads.houses_of([key]))
        if houses is None:
            lasting = False
        codes = list((houses or {}).get("codes") or [])
        if not codes:
            why.append("The house on this client's record cannot be matched to the hotline calendar, so its schedule "
                       "adds nobody.")
    if codes:
        ours = set(codes)
        names: set[str] = set()
        read = False
        cal = _soft(lambda: smart_comms_desk.broadcast_calendar(ctx.reads))
        if cal and cal.get("readable"):
            read = True
            for loc, h in (cal.get("houses") or {}).items():
                if L.house_code(loc) in ours:
                    names.update(p["key"] for p in h.get("people") or [] if p.get("key"))
        managers = _soft(lambda: staff.calendar_managers(ctx.reads))
        if managers is not None:
            read = True
            names.update(k for k, locs in managers.items() if any(L.house_code(loc) in ours for loc in locs))
        if not read:
            why.append("The hotline calendar could not be read just now, so its schedule adds nobody.")
            lasting = False
        for k in names:
            worn = idx["by_name"].get(k) or []
            if len(worn) != 1 or worn[0] == me:
                continue
            hp = idx["by_person"].get(worn[0])
            if hp and not hp["client"]:
                ids.add(worn[0])
    if key:
        served, said, kept = _serving(ctx, key, idx)
        ids |= served
        why.extend(said)
        lasting = lasting and kept
    out = {"ids": ids, "why": " ".join(why)}
    if lasting:
        with _CIRCLES_LOCK:
            if len(_CIRCLES) > CIRCLES_MAX:
                _CIRCLES.clear()
            _CIRCLES[me] = (time.time(), out)
    return out


def narrow_may(ctx: Ctx, held: dict[str, Any], other: str, rows: list[dict[str, Any]] | None) -> bool:
    """chatNarrowMay_: in the circle, or not a client and has written to this caller here."""
    pid = ctx.people.person(other)
    if not pid or pid == ctx.me:
        return False
    if pid in held["ids"]:
        return True
    p = accounts_index(ctx)["by_person"].get(pid)
    if not p or p["client"]:
        return False
    thread = rows if rows is not None else ctx.rows_between(ctx.me, pid)
    key = ctx.people.key(ctx.me, pid)
    return any(ctx.people.key(r["from_user"], r["to_user"]) == key and ctx.people.person(r["from_user"]) == pid
               for r in thread)


# ── reads ───────────────────────────────────────────────────────────────────

def overview(ctx: Ctx, payload: dict[str, Any], write_id: str = "") -> dict[str, Any]:
    """chatOverview: the whole left rail in one call — people, my threads, last lines and unread counts."""
    me = ctx.me
    if not me:
        return {"status": 400, "message": "This session has no account id."}
    ctx.touch()
    presence = ctx.presence()
    held = circle(ctx) if ctx.narrowed else None
    threads: dict[str, dict[str, Any]] = {}
    at_of: dict[str, datetime] = {}
    wrote: set[str] = set()
    unread_total = 0
    for r in ctx.rows_of(ctx.people.accounts(me)):
        key = ctx.people.key(r["from_user"], r["to_user"])
        if not key or me not in key.split("|"):
            continue
        t = threads.get(key)
        if t is None:
            t = threads[key] = {"thread_key": key, "with_user": other_of(key, me), "with_name": "", "last": "",
                                "last_at": "", "unread": 0}
        if key not in at_of or r["created_at"] >= at_of[key]:
            at_of[key] = r["created_at"]
            t["last_at"] = iso(r["created_at"])
            t["last"] = r["body"][:LAST_MAX]
            t["last_from"] = r["from_user"]
        if ctx.people.person(r["to_user"]) == me and r["read_at"] is None:
            t["unread"] += 1
            unread_total += 1
        if r["from_user"] == t["with_user"] and not t["with_name"]:
            t["with_name"] = r["from_name"]
        if ctx.people.person(r["from_user"]) == t["with_user"]:
            wrote.add(key)

    people: list[dict[str, Any]] = []
    for u in ctx.people.rows:
        raw = gsjs.str_(u.get("userid"))
        uid = ctx.people.person(raw)
        # one entry per person: an account folded into another is skipped
        if not uid or uid == me or uid != raw:
            continue
        if held is not None and uid not in held["ids"]:
            continue
        if gsjs.str_(u.get("active")).lower() != "true" or gsjs.str_(u.get("isservice")).lower() == "true":
            continue
        if sc.is_master_email(u.get("email")) or family_column(u.get("types"), u.get("email")):
            continue
        people.append({"user_id": uid, "name": gsjs.str_(u.get("displayname")) or gsjs.str_(u.get("email")),
                       "title": gsjs.str_(u.get("title")), "avatar": gsjs.str_(u.get("avatar")),
                       "online": ctx.online(presence, uid), "seen_at": iso(presence.get(uid))})
    people.sort(key=lambda p: (not p["online"], _sort_name(p["name"])))

    by_person = accounts_index(ctx)["by_person"] if held is not None else {}
    if held is not None:
        unread_total = 0
    listed: list[dict[str, Any]] = []
    for key, th in threads.items():
        shown = held is None or th["with_user"] in held["ids"]
        if not shown:
            other = by_person.get(th["with_user"])
            if not other or other["client"] or key not in wrote:
                continue
        if not th["with_name"]:
            th["with_name"] = next((p["name"] for p in people if p["user_id"] == th["with_user"]), "")
        th["online"] = ctx.online(presence, th["with_user"]) if shown else False
        if held is not None:
            unread_total += th["unread"]
        listed.append(th)
    listed.sort(key=lambda t: at_of[t["thread_key"]], reverse=True)
    data: dict[str, Any] = {"me": me, "threads": listed, "people": people, "unread": unread_total}
    # the mark the relay asks for before it carries a narrowed rail
    if held is not None:
        data["circle"] = {"why": held["why"]}
    return {"status": 200, "data": data}


def messages(ctx: Ctx, payload: dict[str, Any], write_id: str = "") -> dict[str, Any]:
    """chatMessages: one conversation, read after the `after` cursor so a quiet thread answers with nothing."""
    me = ctx.me
    other = gsjs.str_(payload.get("with_user"))
    key = ctx.people.key(me, other)
    if not key:
        return {"status": 400, "message": "with_user: whose conversation."}
    after = gsjs.str_(payload.get("after"))
    thread = ctx.rows_between(me, other)
    if ctx.narrowed and not narrow_may(ctx, circle(ctx), other, thread):
        return dict(NOT_FOUND)

    def line(r: dict[str, Any]) -> dict[str, Any]:
        return {"id": r["message_id"], "from_user": r["from_user"], "from_name": r["from_name"], "body": r["body"],
                "created_at": iso(r["created_at"]), "read_at": iso(r["read_at"]),
                "mine": ctx.people.person(r["from_user"]) == me}

    ids = [r["message_id"] for r in thread]
    # a cursor the tab no longer holds re-reads the whole thread (reset) instead of "nothing new" forever
    stale = bool(after) and after not in ids
    start = ids.index(after) + 1 if after and not stale else 0
    out = [line(r) for r in thread[start:]]
    if len(out) > THREAD_MAX:
        out = out[-THREAD_MAX:]
    # reactions travel whole every time: they land on old messages the cursor never re-reads
    reactions = {r["message_id"]: packed for r in thread if (packed := reactions_of(r))}
    return {"status": 200, "data": {"messages": out, "reset": stale, "reactions": reactions}}


def ping(ctx: Ctx, payload: dict[str, Any], write_id: str = "") -> dict[str, Any]:
    """chatPing: the shell's heartbeat — stamps presence, returns the unread count and the newest line."""
    me = ctx.me
    if not me:
        return {"status": 200, "data": {"unread": 0, "latest": None}}
    ctx.touch()
    mine = ctx.people.accounts(me)
    rows = ctx.rows("to_user = any(%s) and read_at is null", (mine,))
    # a narrowed caller counts what its rail shows: a line from another client, or from nobody on record, is not
    by_person = None
    same_client: set[str] = set()
    if ctx.narrowed:
        idx = accounts_index(ctx)
        by_person = idx["by_person"]
        ck = sc.client_key_of(ctx.user)
        if ck:
            same_client = set(idx["by_client"].get(ck) or [])
    unread = 0
    latest: dict[str, Any] | None = None
    latest_at: datetime | None = None
    for r in rows:
        if ctx.people.person(r["to_user"]) != me:
            continue
        if by_person is not None:
            frm = ctx.people.person(r["from_user"])
            sender = by_person.get(frm)
            if not sender or (sender["client"] and frm not in same_client):
                continue
        unread += 1
        if latest_at is None or r["created_at"] > latest_at:
            latest_at = r["created_at"]
            latest = {"id": r["message_id"], "at": iso(r["created_at"]), "from_user": r["from_user"],
                      "from_name": r["from_name"], "body": r["body"][:LAST_MAX]}
    # `me` lets the shell catch a second sign-in swapping the session under an open tab
    return {"status": 200, "data": {"unread": unread, "latest": latest, "me": me, "me_name": ctx.name}}


# ── writes ──────────────────────────────────────────────────────────────────

def send_id(write_id: str, account: str) -> str:
    """chatSendId_: the id a send is filed under, named by its write id and the account it runs as."""
    wid, acct = gsjs.str_(write_id), gsjs.str_(account)
    if not wid or not acct:
        return ""
    return "msg_" + hashlib.sha256(f"{wid}\n{acct}".encode("utf-8")).hexdigest()[:24]


def send_at(raw: Any, now: datetime) -> datetime:
    """chatSendAt_: the moment the relay took the send, when it names one it may."""
    at = _parse(raw)
    if at is None or at > now + SEND_AHEAD or at < now - SEND_BACK:
        return now
    return at


def _receipt(c: Any, write_id: str, account: str) -> dict[str, Any] | None:
    if not write_id:
        return None
    got = c.execute(f"select answer, account from {RECEIPTS} where write_id = %s", (write_id,)).fetchone()
    if got is None:
        return None
    # a write id is one account's: another's is never answered with it
    return got[0] if got[1] == account else {"status": 409, "message": "That write belongs to another session."}


def _keep(c: Any, write_id: str, action: str, account: str, answer: dict[str, Any]) -> None:
    if write_id:
        from psycopg.types.json import Jsonb  # noqa: PLC0415 - the unit checks run without the driver
        c.execute(f"insert into {RECEIPTS} (write_id, action, account, answer) values (%s, %s, %s, %s)"
                  " on conflict (write_id) do nothing", (write_id, action, account, Jsonb(answer)))


def send(ctx: Ctx, payload: dict[str, Any], write_id: str = "") -> dict[str, Any]:
    """chatSend: one message, kept before it is answered; the same write id is the same message."""
    if ctx.user.get("is_service"):
        return dict(SERVICE)
    me = ctx.me
    account = gsjs.str_(ctx.user.get("id"))
    to = gsjs.str_(payload.get("to_user"))
    body = gsjs.str_(payload.get("body"))[:BODY_MAX]
    if not to:
        return {"status": 400, "message": "to_user: whom you are writing to."}
    if not body:
        return {"status": 400, "message": "An empty message is not sent."}
    if to == me or ctx.people.person(to) == me:
        return {"status": 400, "message": "You cannot write to yourself here."}
    # a line to nobody on record is never filed, nor to an SSA or a FAMILY (family_column)
    if to not in ctx.people.ids:
        return dict(NOT_FOUND)
    them = next((u for u in ctx.people.rows if gsjs.str_(u.get("userid")) == to), None)
    if them is not None and family_column(them.get("types"), them.get("email")):
        return dict(NOT_FOUND)
    if ctx.narrowed and not narrow_may(ctx, circle(ctx), to, None):
        return dict(NOT_FOUND)
    key = ctx.people.key(me, to)
    mid = send_id(write_id, account) or ("msg_" + secrets.token_hex(6))
    at = send_at(payload.get("at"), ctx.now)

    def write(c: Any) -> dict[str, Any]:
        with c.transaction():
            kept = _receipt(c, write_id, account)
            if kept is not None:
                return kept
            got = c.execute(f"insert into {MESSAGES} (message_id, thread_key, from_user, from_name, to_user, body,"
                            " created_at, write_id) values (%s, %s, %s, %s, %s, %s, %s, %s)"
                            " on conflict (message_id) do nothing returning created_at",
                            (mid, key, me, ctx.name, to, body, at, write_id)).fetchone()
            if got is None:
                got = c.execute(f"select created_at from {MESSAGES} where message_id = %s", (mid,)).fetchone()
            answer = {"status": 200, "data": {"id": mid, "created_at": iso(got[0]), "thread_key": key,
                                              "emailed": False}}
            _keep(c, write_id, "chatSend", account, answer)
            return answer
    return ctx.store.run(write)


def react(ctx: Ctx, payload: dict[str, Any], write_id: str = "") -> dict[str, Any]:
    """chatReact: my mark on a message toggled, under the row's own lock so two reactions never erase each other."""
    if ctx.user.get("is_service"):
        return dict(SERVICE)
    me = ctx.me
    account = gsjs.str_(ctx.user.get("id"))
    mid = gsjs.str_(payload.get("message_id"))
    emoji = gsjs.str_(payload.get("emoji"))[:EMOJI_MAX]
    if not mid:
        return {"status": 400, "message": "message_id: which message."}
    if not emoji:
        return {"status": 400, "message": "emoji: which reaction."}
    held = circle(ctx) if ctx.narrowed else None

    def write(c: Any) -> dict[str, Any]:
        from psycopg.types.json import Jsonb  # noqa: PLC0415
        with c.transaction():
            kept = _receipt(c, write_id, account)
            if kept is not None:
                return kept
            got = c.execute(f"select from_user, to_user, reactions from {MESSAGES} where message_id = %s for update",
                            (mid,)).fetchone()
            if got is None:
                return dict(NO_MESSAGE)
            frm, to, marks = got
            if ctx.people.person(frm) != me and ctx.people.person(to) != me:
                return dict(NO_MESSAGE)
            other = to if ctx.people.person(frm) == me else frm
            if held is not None and not narrow_may(ctx, held, other, None):
                return dict(NO_MESSAGE)
            marks = dict(marks) if isinstance(marks, dict) else {}
            ids = [i for i in marks.get(emoji) or [] if isinstance(i, str)]
            on = me not in ids
            if on:
                ids.append(me)
            else:
                ids.remove(me)
            if ids:
                marks[emoji] = ids
            else:
                marks.pop(emoji, None)
            c.execute(f"update {MESSAGES} set reactions = %s where message_id = %s", (Jsonb(marks), mid))
            ctx.touch(c)
            # to_user lets the relay wake the other screen without reading the table
            answer = {"status": 200, "data": {"message_id": mid, "reactions": marks, "on": on, "to_user": other}}
            _keep(c, write_id, "chatReact", account, answer)
            return answer
    return ctx.store.run(write)


def mark_read(ctx: Ctx, payload: dict[str, Any], write_id: str = "") -> dict[str, Any]:
    """chatMarkRead: everything this person has been sent in one conversation, marked read."""
    me = ctx.me
    other = gsjs.str_(payload.get("with_user"))
    key = ctx.people.key(me, other)
    if not key:
        return {"status": 400, "message": "with_user: whose conversation."}
    if ctx.narrowed and not narrow_may(ctx, circle(ctx), other, None):
        return dict(NOT_FOUND)
    if ctx.people.person(other) == me:
        ctx.touch()
        return {"status": 200, "data": {"marked": 0}}

    def write(c: Any) -> dict[str, Any]:
        with c.transaction():
            cur = c.execute(f"update {MESSAGES} set read_at = %s where to_user = any(%s) and from_user = any(%s)"
                            " and read_at is null",
                            (ctx.now, ctx.people.accounts(me), ctx.people.accounts(other)))
            marked = cur.rowcount
            ctx.touch(c)
        return {"status": 200, "data": {"marked": marked}}
    return ctx.store.run(write)


DOORS: dict[str, Callable[[Ctx, dict[str, Any], str], dict[str, Any]]] = {
    "chatOverview": overview, "chatMessages": messages, "chatPing": ping,
    "chatSend": send, "chatReact": react, "chatMarkRead": mark_read,
}


def answer(store: Store, reads: L.Reads, user: dict[str, Any], action: str, payload: dict[str, Any],
           write_id: str = "") -> dict[str, Any]:
    """One chat door's envelope; Unreadable when the store cannot answer, so the relay says 503 and nothing else."""
    door = DOORS.get(action)
    if door is None:
        return {"status": 404, "message": "Unknown action."}
    if not store.ready():
        raise hubdb.Unreadable(store.why or "the chat store is not ready")
    if write_id and not writes.WRITE_ID.fullmatch(write_id):
        return {"status": 400, "message": "The write id could not be read."}
    if action in WRITES and user.get("unlogged"):
        return {"status": 409, "message": "A switched session writes nothing in the chat."}
    if not user.get("is_service") and family_column(user.get("types"), user.get("email")):
        return {"status": 404, "message": "Unknown action."}
    return door(Ctx(store, reads, user), payload, write_id)
