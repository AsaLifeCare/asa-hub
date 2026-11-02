"""Live chat: the platform's half of the SignalR hub (signalr-hub/, container asa-hub-chat), server/chat_live.py
carried into asa-hub-app whole; its doors are app/chat_doors.py. The hub only carries the chat."""
from __future__ import annotations

import asyncio
import copy
import hashlib
import hmac
import json
import logging
import math
import os
import re
import secrets
import time
import urllib.parse
from typing import Any, Awaitable, Callable, Iterable

log = logging.getLogger("asa-hub-app.chat-live")

# no App Control row ships: the master's alone until it is released there
APP_ID = "my-inbox.liveChat"
APP_LABEL = "Live chat"

ACTIONS = ("chatOverview", "chatMessages", "chatSend", "chatReact", "chatMarkRead", "chatPing")
WRITES = frozenset({"chatSend", "chatReact", "chatMarkRead"})
# a second run of these is a second row or a toggle undone
APPEND_CLASS = frozenset({"chatSend", "chatReact"})
PAYLOAD_KEYS: dict[str, tuple[str, ...]] = {
    "chatOverview": (),
    "chatPing": (),
    "chatMessages": ("with_user", "after"),
    "chatSend": ("to_user", "body"),
    "chatReact": ("message_id", "emoji"),
    "chatMarkRead": ("with_user",),
}
REQUIRED_KEYS: dict[str, tuple[str, ...]] = {
    "chatMessages": ("with_user",),
    "chatSend": ("to_user", "body"),
    "chatReact": ("message_id", "emoji"),
    "chatMarkRead": ("with_user",),
}
LIMITS = {"with_user": 200, "to_user": 200, "after": 200, "body": 4000, "message_id": 200, "emoji": 16}
# who a caller is comes from the ticket, never from a field
REFUSED_FIELDS = ("member", "person", "target")
# the roles Chat.gs narrows to their circle (chatNarrowed_)
NARROWED_ROLES = frozenset({"client", "guardian"})
# scope.MASTER_ACCOUNT: this module reads no other app module
MASTER_ACCOUNT = "asatech@asalifecare.com"

TICKET_TTL_S = float(os.getenv("HUB_CHAT_TICKET_TTL_S", "60"))
TICKET_USES = 3
REF_IDLE_S = float(os.getenv("HUB_CHAT_REF_IDLE_S", str(12 * 3600)))
EXEC_BUDGET_S = float(os.getenv("HUB_CHAT_EXEC_BUDGET_S", "45"))
READ_TRIES, WRITE_TRIES = 2, 3
EXEC_CONCURRENCY = int(os.getenv("HUB_CHAT_EXEC_CONCURRENCY", "4"))
SETTLE_S = float(os.getenv("HUB_CHAT_SETTLE_S", "150"))
FOLD_TTL_S = 300.0
# a /gas send answered without its receipt: the hub nudges both ends after these (the row lands after the answer; by…
UNANSWERED_NUDGE_S = (35.0, SETTLE_S)
RAN_NUDGE_S = (2.0,)

HUB_URL = os.getenv("HUB_CHAT_URL", "http://asa-hub-chat:8080").rstrip("/")
FEED_TIMEOUT_S = 2.0
# a revocation is tried again after these; the hub's ref check is the floor under all of them
REVOKE_TRIES = 4
REVOKE_BACKOFF_S = (1.0, 3.0, 10.0)
# after the wait for a slot, a POST with less than this left is not sent: it could only be cut short
MIN_POST_S = 2.0
KEY_LABEL = b"asa-hub-chat"

TENANT_RE = re.compile(r"[A-Za-z0-9_.:-]{0,80}")
CLIENT_ID_RE = re.compile(r"[A-Za-z0-9_-]{8,64}")
TICKET_RE = re.compile(r"[A-Za-z0-9_-]{20,128}")
REF_RE = re.compile(r"[A-Za-z0-9_-]{20,128}")

MAX_REFS = 4000
MAX_TICKETS = 8000
# live tickets one ref may hold: a session minting in a loop only ever displaces its own
TICKETS_PER_REF = 5
# refs one session may hold (one per place its tabs are in): a session inventing places only displaces its own
REFS_PER_TOKEN = 8
# refs one /chat/refs call may ask about
MAX_CHECK = 5000


# ── the key the hub and the relay share ────────────────────────────────────

def derive_key(service_secret: str) -> str:
    """HMAC-SHA256(HUB_SERVICE_SECRET, "asa-hub-chat"), hex; '' without a secret (every internal door shut)."""
    if not service_secret:
        return ""
    return hmac.new(service_secret.encode("utf-8"), KEY_LABEL, hashlib.sha256).hexdigest()


def key_ok(given: str, expected: str) -> bool:
    if not expected or not given:
        return False
    return hmac.compare_digest(str(given).encode("utf-8"), str(expected).encode("utf-8"))


def _digest(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


# ── tickets and refs ────────────────────────────────────────────────────────

class Registry:
    """Tickets (short, few uses) that open refs (one per session and tenant)."""

    def __init__(self, *, ticket_ttl_s: float = TICKET_TTL_S, ticket_uses: int = TICKET_USES,
                 ref_idle_s: float = REF_IDLE_S, clock: Callable[[], float] = time.monotonic) -> None:
        self.ticket_ttl_s = float(ticket_ttl_s)
        self.ticket_uses = int(ticket_uses)
        self.ref_idle_s = float(ref_idle_s)
        self.clock = clock
        self._tickets: dict[str, dict[str, Any]] = {}
        self._refs: dict[str, dict[str, Any]] = {}
        self._by_token: dict[str, set[str]] = {}

    def mint(self, token: str, tenant: str, ident: dict[str, Any]) -> str:
        """A new ticket for this session in this tenant; the session's live ref is reused."""
        now = self.clock()
        self._purge(now)
        ref = next((r for r in self._by_token.get(token, ()) if self._refs.get(r, {}).get("tenant") == tenant), "")
        if not ref:
            # a new place for this session: past its share, its own least recently used refs make room, never…
            held = sorted(self._by_token.get(token, ()), key=lambda r: self._refs.get(r, {}).get("seen", 0.0))
            for old in held[: max(0, len(held) - REFS_PER_TOKEN + 1)]:
                self._forget_ref(old)
            ref = secrets.token_urlsafe(32)
            self._by_token.setdefault(token, set()).add(ref)
        entry = {"token": token, "tenant": tenant, "ident": dict(ident), "seen": now}
        listed = self._refs.get(ref, {}).get("listed")
        if listed is not None and bool(ident.get("narrowed")):
            entry["listed"] = listed
        self._refs[ref] = entry
        # this ref's own oldest tickets make room (insertion order is age order)
        own = [key for key, held in self._tickets.items() if held["ref"] == ref]
        for key in own[: max(0, len(own) - TICKETS_PER_REF + 1)]:
            self._tickets.pop(key, None)
        ticket = secrets.token_urlsafe(32)
        self._tickets[_digest(ticket)] = {"ref": ref, "until": now + self.ticket_ttl_s, "uses": self.ticket_uses}
        return ticket

    def redeem(self, ticket: str) -> dict[str, Any] | None:
        """{ref, tenant, **ident} for a live ticket (one use spent), else None."""
        if not isinstance(ticket, str) or not TICKET_RE.fullmatch(ticket):
            return None
        now = self.clock()
        key = _digest(ticket)
        held = self._tickets.get(key)
        if not held or now > held["until"] or held["uses"] <= 0:
            self._tickets.pop(key, None)
            return None
        held["uses"] -= 1
        if held["uses"] <= 0:
            self._tickets.pop(key, None)
        entry = self._refs.get(held["ref"])
        if entry is None:
            return None
        entry["seen"] = now
        ident = entry["ident"]
        return {"ref": held["ref"], "tenant": entry["tenant"], "account_id": str(ident.get("account_id") or ""),
                "person_id": str(ident.get("person_id") or ""), "fold_ids": list(ident.get("fold_ids") or []),
                "name": str(ident.get("name") or ""), "is_master": bool(ident.get("is_master")),
                "narrowed": bool(ident.get("narrowed"))}

    def lookup(self, ref: str) -> dict[str, Any] | None:
        entry = self.peek(ref)
        if entry is not None:
            entry["seen"] = self.clock()
        return entry

    def peek(self, ref: str) -> dict[str, Any] | None:
        """The ref's entry without counting as a use: a connection that only listens does not keep it alive."""
        if not isinstance(ref, str) or not REF_RE.fullmatch(ref):
            return None
        entry = self._refs.get(ref)
        if entry is None:
            return None
        if self.clock() - entry["seen"] > self.ref_idle_s:
            self._drop_ref(ref)
            return None
        return entry

    def listed(self, ref: str) -> frozenset[str] | None:
        """The ids a narrowed ref's last marked rail named; None before one."""
        entry = self.peek(ref)
        got = entry.get("listed") if entry is not None else None
        return got if isinstance(got, frozenset) else None

    def set_listed(self, ref: str, ids: Iterable[str] | None) -> None:
        entry = self._refs.get(ref)
        if entry is None:
            return
        if ids is None:
            entry.pop("listed", None)
        else:
            entry["listed"] = frozenset(ids)

    def revoke_token(self, token: str) -> list[str]:
        """Every ref this session holds, forgotten; their tickets die with them."""
        refs = sorted(self._by_token.pop(token, set()))
        for ref in refs:
            self._refs.pop(ref, None)
        if refs:
            gone = set(refs)
            for key, held in list(self._tickets.items()):
                if held["ref"] in gone:
                    self._tickets.pop(key, None)
        return refs

    def counts(self) -> dict[str, int]:
        return {"refs": len(self._refs), "tickets": len(self._tickets), "sessions": len(self._by_token)}

    def _drop_ref(self, ref: str) -> None:
        entry = self._refs.pop(ref, None)
        if entry is not None:
            kids = self._by_token.get(entry["token"])
            if kids is not None:
                kids.discard(ref)
                if not kids:
                    self._by_token.pop(entry["token"], None)

    def _forget_ref(self, ref: str) -> None:
        """The ref and the tickets that would open it."""
        self._drop_ref(ref)
        for key, held in list(self._tickets.items()):
            if held["ref"] == ref:
                self._tickets.pop(key, None)

    def _purge(self, now: float) -> None:
        if len(self._tickets) > MAX_TICKETS // 2:
            for key, held in list(self._tickets.items()):
                if now > held["until"] or held["uses"] <= 0:
                    self._tickets.pop(key, None)
        if len(self._refs) > MAX_REFS // 2:
            for ref, entry in list(self._refs.items()):
                if now - entry["seen"] > self.ref_idle_s:
                    self._drop_ref(ref)
        if len(self._tickets) > MAX_TICKETS:
            # the oldest go; never everyone's at once
            for key in list(self._tickets)[: len(self._tickets) - MAX_TICKETS]:
                self._tickets.pop(key, None)
        if len(self._refs) > MAX_REFS:
            for ref in sorted(self._refs, key=lambda r: self._refs[r]["seen"])[: len(self._refs) - MAX_REFS]:
                self._drop_ref(ref)


def check_refs(registry: Registry, refs: Any, ended: Callable[[str], bool]) -> dict[str, list[str]]:
    """Which of the refs the hub's connections hold are no longer sessions here: `unknown` (never minted by this…"""
    unknown: list[str] = []
    revoked: list[str] = []
    tokens: set[str] = set()
    seen: set[str] = set()
    for ref in (refs if isinstance(refs, list) else [])[:MAX_CHECK]:
        if not isinstance(ref, str) or ref in seen:
            continue
        seen.add(ref)
        entry = registry.peek(ref)
        if entry is None:
            unknown.append(ref)
            continue
        try:
            gone = bool(ended(entry["token"]))
        except Exception:  # noqa: BLE001 - a session that cannot be judged is not kept open on trust
            gone = True
        if gone:
            revoked.append(ref)
            tokens.add(entry["token"])
    for token in tokens:
        registry.revoke_token(token)
    return {"unknown": unknown, "revoked": revoked}


# ── who is one person (Chat.gs chatPeopleIndex_, chatPersonAccounts_) ─────

def _norm_key(key: Any) -> str:
    return re.sub(r"[^a-z0-9]", "", str(key).lower())


def _cell(value: Any) -> str:
    return "" if value is None else str(value).strip()


def _js_order(keys: Iterable[str]) -> list[str]:
    """A JS object's key order: array-index keys ascending first, then the rest as inserted."""
    keys = list(keys)

    def is_index(k: str) -> bool:
        return k.isdigit() and str(int(k)) == k and int(k) < 2 ** 32 - 1

    return sorted((k for k in keys if is_index(k)), key=int) + [k for k in keys if not is_index(k)]


def fold_index(rows: Iterable[Any]) -> dict[str, str]:
    """account id -> the person it folds onto, only through a same_as / merged_into / person_id cell."""
    by: dict[str, str] = {}
    for row in rows or ():
        if not isinstance(row, dict):
            continue
        norm = {_norm_key(k): v for k, v in row.items()}
        uid = _cell(norm.get("userid"))
        same = _cell(norm.get("sameas")) or _cell(norm.get("mergedinto")) or _cell(norm.get("personid"))
        if not uid or not same or same == uid:
            continue
        by[uid] = same
    ordered = {k: by[k] for k in _js_order(by)}
    for acct in list(ordered):
        seen: set[str] = set()
        at = ordered[acct]
        while ordered.get(at) and at not in seen:
            seen.add(at)
            at = ordered[at]
        ordered[acct] = at
    return ordered


def person_of(index: dict[str, str], uid: str) -> str:
    uid = _cell(uid)
    return _cell(index.get(uid)) or uid if uid else ""


def fold_ids(index: dict[str, str], uid: str) -> list[str]:
    """The person and every account folded onto it — the ids a frame for this person may be addressed to."""
    person = person_of(index, uid)
    if not person:
        return []
    out = [person]
    for acct, to in index.items():
        if _cell(to) == person and acct not in out:
            out.append(acct)
    if _cell(uid) not in out:
        out.append(_cell(uid))
    return out


def name_index(rows: Iterable[Any]) -> dict[str, str]:
    """account id -> the name its users row carries (display_name, else name)."""
    out: dict[str, str] = {}
    for row in rows or ():
        if not isinstance(row, dict):
            continue
        norm = {_norm_key(k): v for k, v in row.items()}
        uid = _cell(norm.get("userid"))
        name = _cell(norm.get("displayname")) or _cell(norm.get("name"))
        if uid and name:
            out[uid] = name
    return out


def narrowed_index(rows: Iterable[Any], index: dict[str, str]) -> frozenset[str]:
    """The people any of whose accounts is a client's or a guardian's (Chat.gs chatAccountIndex_ `client`)."""
    out: set[str] = set()
    for row in rows or ():
        if not isinstance(row, dict):
            continue
        norm = {_norm_key(k): v for k, v in row.items()}
        uid = _cell(norm.get("userid"))
        if not uid or _cell(norm.get("isservice")).lower() == "true":
            continue
        # a ticked FAMILY or SSA is a family-column account whatever its role says, the master's never
        # (chat.narrowed_account); a cell written before 10-30 says GUARDIAN for FAMILY
        ticked = {w.strip().upper() for w in re.split(r"[,;|\n]+", _cell(norm.get("types")))}
        family = bool(ticked & {"FAMILY", "GUARDIAN", "SSA"}) and _cell(norm.get("email")).lower() != MASTER_ACCOUNT
        if _cell(norm.get("role")).lower() in NARROWED_ROLES or family:
            out.add(person_of(index, uid))
    return frozenset(out)


def home_index(rows: Iterable[Any]) -> dict[str, str]:
    """account id -> the home place its users row names ('' for headquarters)."""
    out: dict[str, str] = {}
    for row in rows or ():
        if not isinstance(row, dict):
            continue
        norm = {_norm_key(k): v for k, v in row.items()}
        uid = _cell(norm.get("userid"))
        if uid:
            out[uid] = _cell(norm.get("hometenant"))
    return out


class FoldCache:
    """The fold index, read at most every FOLD_TTL_S; an unreadable copy folds nobody, never wrongly."""

    def __init__(self, loader: Callable[[], list[Any]], ttl_s: float = FOLD_TTL_S,
                 clock: Callable[[], float] = time.monotonic) -> None:
        self.loader, self.ttl_s, self.clock = loader, float(ttl_s), clock
        self._at = -math.inf
        self._index: dict[str, str] = {}
        self._names: dict[str, str] = {}
        self._homes: dict[str, str] = {}
        self._narrowed: frozenset[str] = frozenset()
        self.unreadable = ""

    def stale(self) -> bool:
        return self.clock() - self._at >= self.ttl_s

    def index(self) -> dict[str, str]:
        now = self.clock()
        if now - self._at < self.ttl_s:
            return self._index
        try:
            rows = list(self.loader() or [])
            self._index = fold_index(rows)
            self._names = name_index(rows)
            self._homes = home_index(rows)
            self._narrowed = narrowed_index(rows, self._index)
            self.unreadable = ""
        except Exception as exc:  # noqa: BLE001 - no folding at all rather than a wrong one
            self._index = {}
            self._names = {}
            self._homes = {}
            self._narrowed = frozenset()
            self.unreadable = type(exc).__name__
            log.warning("live chat: the account folds could not be read (%s)", type(exc).__name__)
        self._at = now
        return self._index

    def known(self) -> bool:
        """A users copy has been read, and read whole."""
        return self._at > -math.inf and not self.unreadable

    def peek_person(self, uid: str) -> str:
        """person_of over the index held now; never reads the copy."""
        return person_of(self._index, uid)

    def peek_identity(self, uid: str) -> tuple[str, list[str]]:
        return person_of(self._index, uid), fold_ids(self._index, uid)

    def peek_name(self, uid: str) -> str:
        uid = _cell(uid)
        return self._names.get(uid) or self._names.get(person_of(self._index, uid), "") if uid else ""

    def home_of(self, uid: str) -> str | None:
        """The account's home place ('' for headquarters); None for an account the copy does not list, or while…"""
        if not self.known():
            return None
        return self._homes.get(_cell(uid))

    def peek_narrowed(self, uid: str) -> bool | None:
        """Whether the person this account folds onto is a client's or a guardian's on any account; None for an…"""
        if not self.known() or _cell(uid) not in self._homes:
            return None
        return person_of(self._index, uid) in self._narrowed

    def identity(self, uid: str) -> tuple[str, list[str]]:
        index = self.index()
        return person_of(index, uid), fold_ids(index, uid)

    def name_of(self, uid: str) -> str:
        """The account's own name in the users copy, else its person's; '' when neither has one."""
        index = self.index()
        uid = _cell(uid)
        return self._names.get(uid) or self._names.get(person_of(index, uid), "") if uid else ""


# ── the exec door's request ─────────────────────────────────────────────────

def refusal(status: int, reason: str, message: str, **extra: Any) -> dict[str, Any]:
    return {"status": int(status), "reason": reason, "message": message, **extra}


def has_refused_field(*bodies: Any) -> bool:
    for body in bodies:
        if isinstance(body, dict) and any(_cell(body.get(k)) for k in REFUSED_FIELDS):
            return True
    return False


def clean_payload(action: str, payload: Any) -> dict[str, str] | dict[str, Any]:
    """Only the fields the action reads, as short strings; a refusal envelope (with `reason`) otherwise."""
    if payload is None:
        payload = {}
    if not isinstance(payload, dict):
        return refusal(400, "payload", "The payload could not be read.")
    if has_refused_field(payload):
        return refusal(400, "member", "Live chat answers the signed-in account only.")
    out: dict[str, str] = {}
    for key in PAYLOAD_KEYS.get(action, ()):
        raw = payload.get(key)
        if raw is None:
            continue
        if not isinstance(raw, (str, int, float)) or isinstance(raw, bool):
            return refusal(400, "payload", f"{key} could not be read.")
        value = str(raw) if key == "body" else str(raw).strip()
        if len(value) > LIMITS[key]:
            if key == "body":
                return refusal(400, "payload", "That message is too long.")
            return refusal(400, "payload", f"{key} is too long.")
        if key in ("with_user", "to_user") and "|" in value:
            return refusal(400, "payload", f"{key} is not a person.")
        if value.strip():
            out[key] = value
    for key in REQUIRED_KEYS.get(action, ()):
        if key not in out:
            return refusal(400, "payload", f"{key} is required.")
    return out


def exec_request(body: Any) -> dict[str, Any]:
    """{ref, action, payload, client_id} or a refusal (which carries `reason`)."""
    if not isinstance(body, dict):
        return refusal(400, "body", "The body could not be read.")
    if has_refused_field(body):
        return refusal(400, "member", "Live chat answers the signed-in account only.")
    ref = body.get("ref")
    if not isinstance(ref, str) or not REF_RE.fullmatch(ref):
        return refusal(401, "ref_unknown", "This live chat session is not known here; ask for a new ticket.")
    action = str(body.get("action") or "")
    if action not in ACTIONS:
        return refusal(400, "action", "Live chat carries the chat actions only.")
    payload = clean_payload(action, body.get("payload"))
    if "reason" in payload:
        return payload
    client_id = str(body.get("client_id") or "")
    if action in WRITES and not CLIENT_ID_RE.fullmatch(client_id):
        return refusal(400, "client_id", "A write carries its own client id.")
    return {"ref": ref, "action": action, "payload": payload, "client_id": client_id if action in WRITES else ""}


def narrowed(*roles: Any) -> bool:
    return any(_cell(role).lower() in NARROWED_ROLES for role in roles)


def narrow_overview(data: Any) -> tuple[dict[str, Any], frozenset[str]] | None:
    """A narrowed caller's rail as Chat.gs drew it, presence kept to the people it lists, and every id it names…"""
    if not isinstance(data, dict) or not isinstance(data.get("circle"), dict):
        return None
    people = [p for p in data.get("people") or [] if isinstance(p, dict) and _cell(p.get("user_id"))]
    shown = {_cell(p.get("user_id")) for p in people}
    threads: list[dict[str, Any]] = []
    for thread in data.get("threads") or []:
        if not isinstance(thread, dict) or not _cell(thread.get("with_user")):
            continue
        if _cell(thread.get("with_user")) not in shown:
            thread = {k: v for k, v in thread.items() if k != "seen_at"}
            thread["online"] = False
        threads.append(thread)
    listed = frozenset(shown | {_cell(t.get("with_user")) for t in threads})
    return {**data, "people": people, "threads": threads}, listed


def person_in(action: str, payload: dict[str, Any]) -> str:
    """The person an action is about, as the caller named them; '' for one that names nobody."""
    return _cell(payload.get("to_user") if action == "chatSend" else payload.get("with_user"))


def write_id_for(account_id: str, client_id: str) -> str:
    """Stable per account and client id, so a retry is the same write; never the client's word alone, so no…"""
    return "L" + _digest(f"{account_id}\n{client_id}")[:30]


def envelope(token: str, tenant: str, action: str, payload: dict[str, Any], write_id: str = "") -> dict[str, Any]:
    """The /gas envelope as the SPA sends it — no world, and never a member."""
    env: dict[str, Any] = {"token": token, "action": action, "payload": payload}
    if tenant:
        env["tenant"] = tenant
    if write_id:
        env["write_id"] = write_id
    return env


def form(env: dict[str, Any]) -> bytes:
    """form-encoded `body=<json>`: the only shape the relay's observers read."""
    return urllib.parse.urlencode({"body": json.dumps(env)}).encode()


# ── one exec, retried where a retry cannot run anything twice ──────────────

class Unsettled:
    """write_id -> when an append-class attempt left without an answer; and the ones on their way right now."""

    def __init__(self, settle_s: float = SETTLE_S, clock: Callable[[], float] = time.monotonic) -> None:
        self.settle_s, self.clock = float(settle_s), clock
        self._at: dict[str, float] = {}
        self._inflight: set[str] = set()

    def busy(self, write_id: str) -> bool:
        return write_id in self._inflight

    def begin(self, write_id: str) -> None:
        self._inflight.add(write_id)

    def end(self, write_id: str) -> None:
        self._inflight.discard(write_id)

    def wait_left(self, write_id: str) -> float:
        at = self._at.get(write_id)
        if at is None:
            return 0.0
        left = self.settle_s - (self.clock() - at)
        if left <= 0:
            return 0.0
        return left

    def mark(self, write_id: str) -> None:
        # from the LATEST attempt that left unanswered: a second one may still be running in Apps Script, and doPost…
        self._at[write_id] = self.clock()
        if len(self._at) > 4000:
            now = self.clock()
            for wid, at in list(self._at.items()):
                if now - at > self.settle_s * 4:
                    self._at.pop(wid, None)

    def clear(self, write_id: str) -> None:
        self._at.pop(write_id, None)

    def __len__(self) -> int:
        return len(self._at)


# sender(raw, timeout_s) -> (kind, content): kind is json | echo | pre | connect | timeout | error
Post = Callable[[bytes, float], Awaitable[tuple[str, bytes]]]


def _unconfirmed(left: float) -> dict[str, Any]:
    return refusal(504, "unconfirmed", "Sent, but the server has not confirmed it yet.",
                   retry_after_s=max(1, int(math.ceil(left))))


async def run_exec(sender: Post, raw: bytes, action: str, *, write_id: str = "", unsettled: Unsettled,
                   budget_s: float = EXEC_BUDGET_S, clock: Callable[[], float] = time.monotonic,
                   sleep: Callable[[float], Awaitable[Any]] = asyncio.sleep) -> dict[str, Any]:
    """The Apps Script envelope, or a refusal with `reason` (unconfirmed | unreachable)."""
    append = action in APPEND_CLASS and bool(write_id)
    if append:
        # the same write already on its way (a caller that gave up on its answer and asked again)
        if unsettled.busy(write_id):
            return _unconfirmed(5.0)
        left = unsettled.wait_left(write_id)
        if left > 0:
            return _unconfirmed(left)
        unsettled.begin(write_id)
    try:
        return await _exec_tries(sender, raw, action, write_id, append, unsettled, budget_s, clock, sleep)
    finally:
        if append:
            unsettled.end(write_id)


async def _exec_tries(sender: Post, raw: bytes, action: str, write_id: str, append: bool, unsettled: Unsettled,
                      budget_s: float, clock: Callable[[], float],
                      sleep: Callable[[float], Awaitable[Any]]) -> dict[str, Any]:
    tries = WRITE_TRIES if action in WRITES else READ_TRIES
    started = clock()
    attempt = 0
    free = 2
    while attempt < tries:
        remaining = budget_s - (clock() - started)
        if remaining < 2.0:
            break
        attempt += 1
        kind, content = await sender(raw, remaining)
        if kind == "json":
            try:
                env = json.loads(content)
            except (ValueError, UnicodeDecodeError):
                env = None
            if isinstance(env, dict):
                if write_id:
                    unsettled.clear(write_id)
                return env
            kind = "pre"
        if kind == "echo":
            # doPost ran and saved its receipt; the same body answers it
            continue
        if kind == "connect" or (kind == "pre" and not append):
            if free > 0:
                free -= 1
                attempt -= 1
            await sleep(1.2)
            continue
        # sent, outcome unknown
        if append:
            unsettled.mark(write_id)
            return _unconfirmed(unsettled.wait_left(write_id))
        await sleep(min(2.5 * attempt, 5.0))
    return refusal(502, "unreachable", "The server did not answer in time.")


# ── what the hub is told ────────────────────────────────────────────────────

def _form_body(raw: bytes) -> dict[str, Any]:
    if len(raw) > 100_000:
        return {}
    try:
        body = urllib.parse.parse_qs(raw.decode("utf-8", "ignore")).get("body", [""])[0]
        parsed = json.loads(body) if body else {}
    except Exception:  # noqa: BLE001
        return {}
    return parsed if isinstance(parsed, dict) else {}


def observed_event(raw: bytes, content: bytes, *, token_user: Callable[[str], str], held: bool,
                   source: str) -> dict[str, Any] | None:
    """A chat write that landed outside the hub, as the fact the hub needs: which thread, from whom, to whom."""
    head = raw[:4096]
    if b"chatSend" not in head and b"chatReact" not in head and b"chatMarkRead" not in head:
        return None
    req = _form_body(raw)
    action = str(req.get("action") or "")
    if action not in ("chatSend", "chatReact", "chatMarkRead"):
        return None
    try:
        env = json.loads(content)
    except (ValueError, UnicodeDecodeError, TypeError):
        return None
    if not isinstance(env, dict) or env.get("status") != 200:
        return None
    data = env.get("data") if isinstance(env.get("data"), dict) else {}
    payload = req.get("payload") if isinstance(req.get("payload"), dict) else {}
    me = token_user(str(req.get("token") or ""))
    if action == "chatMarkRead":
        if not me:
            return None
        return {"kind": "read", "by": me, "with_user": _cell(payload.get("with_user")), "source": source}
    to_user = _cell(payload.get("to_user")) or _cell(data.get("to_user"))
    return {"kind": "nudge", "action": action, "thread_key": _cell(data.get("thread_key")), "from": me,
            "to": [to_user] if to_user else [], "held": bool(held), "source": source}


def unanswered_event(raw: bytes, *, token_user: Callable[[str], str], source: str) -> dict[str, Any] | None:
    """A send that left without its receipt coming back: which thread it filed is not known, so the nudge names…"""
    if b"chatSend" not in raw[:4096]:
        return None
    req = _form_body(raw)
    if str(req.get("action") or "") != "chatSend":
        return None
    payload = req.get("payload") if isinstance(req.get("payload"), dict) else {}
    to_user = _cell(payload.get("to_user"))
    me = token_user(str(req.get("token") or ""))
    if not to_user and not me:
        return None
    return {"kind": "nudge", "action": "chatSend", "thread_key": "", "from": me,
            "to": [to_user] if to_user else [], "held": True, "source": source}


class Feed:
    """relay -> hub, fire and forget. A hub that is not there is counted, never logged per event."""

    def __init__(self, key: str, url: str = HUB_URL, timeout_s: float = FEED_TIMEOUT_S,
                 poster: Callable[[str, dict[str, str], bytes, float], Awaitable[int]] | None = None) -> None:
        self.key, self.url, self.timeout_s = key, url, float(timeout_s)
        self.poster = poster or _httpx_post
        self.sent = 0
        self.failed = 0
        self.last_failed = ""
        self._said = 0.0

    @property
    def enabled(self) -> bool:
        return bool(self.key)

    async def send(self, event: dict[str, Any], *, tries: int = 1,
                   sleep: Callable[[float], Awaitable[Any]] = asyncio.sleep) -> bool:
        """One event; `tries` > 1 (a revocation) tries again after 1, 3, 10 ... seconds before it counts as lost."""
        if not self.key:
            return False
        body = json.dumps(event, separators=(",", ":")).encode()
        why = ""
        for attempt in range(max(1, int(tries))):
            if attempt:
                await sleep(REVOKE_BACKOFF_S[min(attempt - 1, len(REVOKE_BACKOFF_S) - 1)])
            try:
                status = await self.poster(self.url + "/internal/event",
                                           {"Content-Type": "application/json", "X-Hub-Chat-Key": self.key},
                                           body, self.timeout_s)
            except Exception as exc:  # noqa: BLE001
                why = type(exc).__name__
            else:
                why = "" if 200 <= status < 300 else f"HTTP {status}"
            if not why:
                self.sent += 1
                return True
        self.failed += 1
        self.last_failed = why
        now = time.monotonic()
        if now - self._said > 3600:
            self._said = now
            log.warning("live chat: the hub did not take an event (%s); counted in /health from here", why)
        return False

    def health(self) -> dict[str, Any]:
        return {"enabled": self.enabled, "sent": self.sent, "failed": self.failed, "last_failed": self.last_failed}


async def _httpx_post(url: str, headers: dict[str, str], body: bytes, timeout_s: float) -> int:
    import httpx  # noqa: PLC0415 - the relay has it; a host suite may not

    async with httpx.AsyncClient(timeout=timeout_s) as client:
        res = await client.post(url, headers=headers, content=body)
    return int(res.status_code)


# ── the cache the exec door answers reads from ─────────────────────────────

CACHE_READS = ("chatMessages", "chatOverview")
CACHE_MESSAGES = 100
CACHE_REACTIONS = 500
# a copy the chat door confirmed this recently is served without being read again
CACHE_FRESH_S = float(os.getenv("HUB_CHAT_CACHE_FRESH_S", "15"))
# a copy the chat door has not confirmed for this long is not served
CACHE_CEILING_S = float(os.getenv("HUB_CHAT_CACHE_CEILING_S", str(24 * 3600)))
CACHE_MAX_ENTRIES = int(os.getenv("HUB_CHAT_CACHE_MAX_ENTRIES", "3000"))
CACHE_MAX_BYTES = int(os.getenv("HUB_CHAT_CACHE_MAX_BYTES", str(48 * 1024 * 1024)))
# a read older than this may have missed a change the cache no longer remembers: it fills nothing
CACHE_READ_WINDOW_S = 300.0
# a /gas read is taken as begun this long before its answer (the patient lane's longest wait)
CACHE_GAS_READ_S = 120.0
CACHE_FILE_RE = re.compile(r"[0-9a-f]{64}\.chat\.json")
CACHE_TEMP_RE = re.compile(r"\.[0-9a-f]{64}\.chat\.json\.[A-Za-z0-9_]+\.tmp")
# Chat.gs: a rail's last line, and a message
CACHE_LAST = 140
CACHE_BODY = 4000
_MESSAGE_TEXT = ("id", "from_user", "from_name", "body", "created_at", "read_at")


def pair_key(a: Any, b: Any) -> str:
    """Chat.gs chatThreadKey_ over two person ids; '' without two different people."""
    x, y = _cell(a), _cell(b)
    if not x or not y or x == y or "|" in x or "|" in y:
        return ""
    return f"{x}|{y}" if x < y else f"{y}|{x}"


def side_of(key: str, ids: Iterable[str]) -> int | None:
    """Which end of the thread these ids are (0 or 1); None when neither end, or both."""
    pair = str(key or "").split("|")
    if len(pair) != 2 or not pair[0] or not pair[1]:
        return None
    held = ids if isinstance(ids, (set, frozenset)) else set(ids or ())
    sides = [i for i in (0, 1) if pair[i] in held]
    return sides[0] if len(sides) == 1 else None


def iso_at(wall: float) -> str:
    """An instant as Apps Script's Date.toISOString writes it."""
    whole = int(wall)
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(whole)) + ".%03dZ" % min(999, int((wall - whole) * 1000))


def chat_envelope(raw: bytes) -> dict[str, Any]:
    """The /gas envelope a form body carries; {} when it cannot be read."""
    return _form_body(raw)


def _text(value: Any) -> str:
    return "" if value is None else str(value)


def _count(value: Any) -> int:
    return int(value) if isinstance(value, (int, float)) and not isinstance(value, bool) else 0


class ChatCache:
    """The recent messages of each thread and each person's rail, as Apps Script last answered them and patched…"""

    def __init__(self, *, clock: Callable[[], float] = time.monotonic, wall: Callable[[], float] = time.time,
                 fresh_s: float = CACHE_FRESH_S, ceiling_s: float = CACHE_CEILING_S,
                 max_entries: int = CACHE_MAX_ENTRIES, max_bytes: int = CACHE_MAX_BYTES) -> None:
        self.clock, self.wall = clock, wall
        self.fresh_s, self.ceiling_s = float(fresh_s), float(ceiling_s)
        self.max_entries, self.max_bytes = int(max_entries), int(max_bytes)
        self._entries: dict[tuple[str, ...], dict[str, Any]] = {}
        self._bytes = 0
        # ("t", key) a thread | ("tp", person) every thread of a person | ("p", person) a person's rails
        self._changed: dict[tuple[str, str], float] = {}
        self._settle: dict[tuple[str, str], float] = {}
        # sends kept here first that touch a thread or a rail: served as patched, never filled until they land
        self._pinned: dict[tuple[str, str], int] = {}
        # the last time everything was dropped at once
        self._all = -math.inf
        self._sent: dict[str, float] = {}
        self.dirty: set[tuple[str, ...]] = set()
        self.stats = dict.fromkeys(("hits", "misses", "fills", "late_fills", "wrong_fills", "patches", "drops",
                                    "evicted", "adopted"), 0)

    # which changes a slot answers to
    @staticmethod
    def _topics(slot: tuple[str, ...]) -> tuple[tuple[str, str], ...]:
        if slot[0] == "t":
            pair = slot[2].split("|")
            return ("t", slot[2]), ("tp", pair[0]), ("tp", pair[-1])
        return (("p", slot[2]),)

    def _touch(self, topic: tuple[str, str], settle_s: float = 0.0) -> None:
        now = self.clock()
        self._changed[topic] = now
        if settle_s > 0:
            self._settle[topic] = max(self._settle.get(topic, -math.inf), now + settle_s)

    def _settling(self, slot: tuple[str, ...]) -> bool:
        now = self.clock()
        return any(self._settle.get(topic, -math.inf) > now for topic in self._topics(slot))

    def _may_fill(self, slot: tuple[str, ...], began: float) -> bool:
        if began < self.clock() - CACHE_READ_WINDOW_S or began <= self._all:
            return False
        return all(began > self._changed.get(topic, -math.inf) and began >= self._settle.get(topic, -math.inf)
                   and topic not in self._pinned for topic in self._topics(slot))

    def _pin_topics(self, keys: Iterable[str], people: Iterable[str]) -> list[tuple[str, str]]:
        return [("t", k) for k in {k for k in keys if k}] + [("p", p) for p in {p for p in people if p}]

    def pin(self, *, keys: Iterable[str] = (), people: Iterable[str] = ()) -> None:
        """A send kept here first: its thread and both rails are served as patched and never filled from Apps…"""
        for topic in self._pin_topics(keys, people):
            self._pinned[topic] = self._pinned.get(topic, 0) + 1
            self._touch(topic)

    def unpin(self, *, keys: Iterable[str] = (), people: Iterable[str] = ()) -> None:
        """It landed (or never will): a read that began before now still fills nothing."""
        for topic in self._pin_topics(keys, people):
            left = self._pinned.get(topic, 0) - 1
            if left > 0:
                self._pinned[topic] = left
            else:
                self._pinned.pop(topic, None)
            self._touch(topic)

    def _held(self, slot: tuple[str, ...] | None) -> dict[str, Any] | None:
        entry = self._entries.get(slot) if slot is not None else None
        if entry is not None and self.wall() - entry["filled_at"] >= self.ceiling_s:
            self._drop(slot)
            return None
        return entry

    def _put(self, slot: tuple[str, ...], value: dict[str, Any], filled_at: float, *, disk: bool = False) -> None:
        size = len(json.dumps(value, separators=(",", ":")))
        old = self._entries.get(slot)
        if old is not None:
            self._bytes -= old["size"]
        self._entries[slot] = {"value": value, "filled_at": float(filled_at), "used": self.clock(), "size": size,
                               "disk": disk}
        self._bytes += size
        if not disk:
            self.dirty.add(slot)
        while self._entries and (len(self._entries) > self.max_entries or self._bytes > self.max_bytes):
            self._drop(min(self._entries, key=lambda s: self._entries[s]["used"]))
            self.stats["evicted"] += 1

    def _resize(self, slot: tuple[str, ...]) -> None:
        entry = self._entries[slot]
        size = len(json.dumps(entry["value"], separators=(",", ":")))
        self._bytes += size - entry["size"]
        entry["size"] = size
        self.dirty.add(slot)
        self.stats["patches"] += 1

    def _drop(self, slot: tuple[str, ...]) -> None:
        entry = self._entries.pop(slot, None)
        if entry is not None:
            self._bytes -= entry["size"]
            self.dirty.add(slot)
            self.stats["drops"] += 1

    def _refused(self, why: str) -> str:
        self.stats[f"{why}_fills"] += 1
        return why

    def drop(self, slot: tuple[str, ...] | None) -> None:
        if slot is not None:
            self._drop(slot)

    def holds(self, slot: tuple[str, ...] | None) -> bool:
        return self._held(slot) is not None

    def needs_refresh(self, slot: tuple[str, ...] | None) -> bool:
        entry = self._held(slot)
        return entry is not None and (entry["disk"] or self.wall() - entry["filled_at"] >= self.fresh_s)

    # ── served ──

    def thread(self, place: str | None, key: str, viewer_ids: Iterable[str], after: str = "") -> dict[str, Any] | None:
        """chatMessages' answer for one end of the thread: the messages after `after` (all it holds without one)…"""
        side = side_of(key, frozenset(viewer_ids))
        slot = ("t", place, key) if place is not None and key else None
        entry = self._held(slot) if slot is not None and side is not None and not self._settling(slot) else None
        messages = entry["value"]["messages"] if entry is not None else []
        if entry is not None and after:
            at = next((i for i in range(len(messages) - 1, -1, -1) if messages[i]["id"] == after), None)
            messages = messages[at + 1:] if at is not None else None
        if entry is None or messages is None:
            self.stats["misses"] += 1
            return None
        entry["used"] = self.clock()
        self.stats["hits"] += 1
        return {"messages": [{**{k: m[k] for k in _MESSAGE_TEXT}, "mine": m["side"] == side} for m in messages],
                "reset": False, "reactions": copy.deepcopy(entry["value"]["reactions"])}

    def rail(self, place: str | None, person: str, variant: str) -> dict[str, Any] | None:
        """chatOverview's answer for this person (this account, for a narrowed one); None when it holds none."""
        slot = ("o", place, person, variant) if place is not None and person else None
        entry = self._held(slot) if slot is not None and not self._settling(slot) else None
        if entry is None or _cell(entry["value"].get("me")) != person:
            self.stats["misses"] += 1
            return None
        entry["used"] = self.clock()
        self.stats["hits"] += 1
        return copy.deepcopy(entry["value"])

    # ── filled from Apps Script's answers ──

    def fill_thread(self, place: str | None, key: str, viewer_ids: Iterable[str], data: Any, began: float) -> str:
        """'' filled; 'late' when a change reached the cache after the read began; 'wrong' when the answer is not…"""
        ids = frozenset(viewer_ids)
        side = side_of(key, ids)
        if place is None or side is None or not isinstance(data, dict):
            return self._refused("wrong")
        slot = ("t", place, key)
        if not self._may_fill(slot, began):
            return self._refused("late")
        rows, reactions = data.get("messages"), data.get("reactions")
        if not isinstance(rows, list) or not isinstance({} if reactions is None else reactions, dict):
            return self._refused("wrong")
        messages: list[dict[str, Any]] = []
        for row in rows:
            if not isinstance(row, dict):
                return self._refused("wrong")
            mid, who, mine = _cell(row.get("id")), _cell(row.get("from_user")), row.get("mine") is True
            if not mid or not who or (who in ids) != mine:
                return self._refused("wrong")
            messages.append({"id": mid, "from_user": who, "from_name": _text(row.get("from_name")),
                             "body": _text(row.get("body")), "created_at": _text(row.get("created_at")),
                             "read_at": _text(row.get("read_at")), "side": side if mine else 1 - side})
        marks = {_cell(mid): copy.deepcopy(held) for mid, held in list((reactions or {}).items())[-CACHE_REACTIONS:]
                 if _cell(mid) and isinstance(held, dict) and held}
        self._put(slot, {"messages": messages[-CACHE_MESSAGES:], "reactions": marks}, self.wall())
        self.stats["fills"] += 1
        return ""

    def fill_rail(self, place: str | None, person: str, variant: str, data: Any, began: float,
                  narrowed: bool) -> str:
        """As fill_thread, for a rail: its `me` is the person, and it carries Chat.gs's circle mark exactly when…"""
        if place is None or not person or not isinstance(data, dict):
            return self._refused("wrong")
        slot = ("o", place, person, variant)
        if not self._may_fill(slot, began):
            return self._refused("late")
        if not self._valid_rail(slot, data) or bool(narrowed) != bool(variant):
            return self._refused("wrong")
        self._put(slot, copy.deepcopy(data), self.wall())
        self.stats["fills"] += 1
        return ""

    # ── patched by confirmed writes ──

    def sent(self, place: str | None, key: str, sender_ids: Iterable[str], message: dict[str, Any], *,
             expected_key: str = "", sender_person: str = "", to_person: str = "") -> bool:
        """A send Apps Script confirmed (its id, created_at and thread key): the message joins the thread's copy…"""
        ids = frozenset(sender_ids)
        side = side_of(key, ids)
        pair = key.split("|") if side is not None else []
        mid, at = _cell(message.get("id")), _cell(message.get("created_at"))
        if place is None or side is None or not mid or not at or (expected_key and expected_key != key):
            self.forget(keys=(key, expected_key), people=(*pair, sender_person, to_person))
            return False
        if mid in self._sent:
            return True
        self._sent[mid] = self.clock()
        me, other = pair[side], pair[1 - side]
        body = _text(message.get("body")).strip()[:CACHE_BODY]
        self._touch(("t", key))
        self._drop_elsewhere(key, place)
        slot = ("t", place, key)
        entry = self._held(slot)
        if entry is not None:
            messages = entry["value"]["messages"]
            if not any(m["id"] == mid for m in messages):
                at_ = len(messages)
                while at_ > 0 and messages[at_ - 1]["created_at"] > at:
                    at_ -= 1
                messages.insert(at_, {"id": mid, "from_user": me, "from_name": _text(message.get("from_name")),
                                      "body": body, "created_at": at, "read_at": "", "side": side})
                del messages[:-CACHE_MESSAGES]
            self._resize(slot)
        line = {"last": body[:CACHE_LAST], "last_at": at, "last_from": me}
        self._patch_rails(place, key, me, line, 0)
        self._patch_rails(place, key, other, line, 1)
        for person in (sender_person, to_person):
            if person and person not in pair:
                self.forget(people=(person,))
        return True

    def reacted(self, place: str | None, key: str, reactor_ids: Iterable[str], message_id: str,
                reactions: Any) -> bool:
        """A reaction Apps Script confirmed, with the message's whole reaction map."""
        side = side_of(key, frozenset(reactor_ids))
        mid = _cell(message_id)
        if place is None or side is None or not mid or not isinstance(reactions, dict):
            self.forget(keys=(key,))
            self.forget_message(mid)
            return False
        self._touch(("t", key))
        self._drop_elsewhere(key, place)
        slot = ("t", place, key)
        self.forget_message(mid, keep=slot)
        entry = self._held(slot)
        if entry is not None:
            value = entry["value"]
            if mid not in value["reactions"] and not any(m["id"] == mid for m in value["messages"]):
                # a message this copy cannot place
                self._drop(slot)
                return False
            if reactions:
                value["reactions"][mid] = copy.deepcopy(reactions)
            else:
                value["reactions"].pop(mid, None)
            self._resize(slot)
        return True

    def read(self, place: str | None, key: str, reader_ids: Iterable[str], at: str, *, reader_person: str = "") -> bool:
        """A read mark Apps Script confirmed: every message to the reader in the thread is read, its rails count none."""
        side = side_of(key, frozenset(reader_ids))
        if place is None or side is None:
            self.forget(keys=(key,), people=(reader_person,))
            return False
        pair = key.split("|")
        self._touch(("t", key))
        self._drop_elsewhere(key, place)
        slot = ("t", place, key)
        entry = self._held(slot)
        if entry is not None:
            for m in entry["value"]["messages"]:
                if m["side"] != side and not m["read_at"]:
                    m["read_at"] = at
            self._resize(slot)
        self._patch_rails(place, key, pair[side], None, -1, missing_drops=False)
        if reader_person and reader_person != pair[side]:
            self.forget(people=(reader_person,))
        return True

    def _drop_elsewhere(self, key: str, place: str) -> None:
        for slot in [s for s in self._entries if s[0] == "t" and s[2] == key and s[1] != place]:
            self._drop(slot)

    def _patch_rails(self, place: str, key: str, person: str, line: dict[str, str] | None, unread: int, *,
                     missing_drops: bool = True) -> None:
        self._touch(("p", person))
        for slot in [s for s in self._entries if s[0] == "o" and s[2] == person]:
            if slot[1] != place:
                self._drop(slot)
                continue
            data = self._entries[slot]["value"]
            thread = next((t for t in data["threads"] if t.get("thread_key") == key), None)
            if thread is None:
                if missing_drops:
                    self._drop(slot)
                continue
            if line:
                thread.update(line)
            was, total = _count(thread.get("unread")), _count(data.get("unread"))
            if unread > 0:
                thread["unread"], data["unread"] = was + unread, total + unread
            elif unread < 0:
                thread["unread"], data["unread"] = 0, max(0, total - was)
            data["threads"].sort(key=lambda t: _text(t.get("last_at")), reverse=True)
            self._resize(slot)

    # ── dropped ──

    def forget(self, *, keys: Iterable[str] = (), people: Iterable[str] = (), settle_s: float = 0.0) -> None:
        """What a write that failed, or may still land, can have changed: those threads and those people's rails…"""
        for key in {k for k in keys if k}:
            self._touch(("t", key), settle_s)
            for slot in [s for s in self._entries if s[0] == "t" and s[2] == key]:
                self._drop(slot)
        for person in {p for p in people if p}:
            self._touch(("p", person), settle_s)
            for slot in [s for s in self._entries if s[0] == "o" and s[2] == person]:
                self._drop(slot)

    def forget_all(self) -> None:
        """Everything dropped, and no read that began before now fills anything (a change the cache could not…"""
        self._all = self.clock()
        for slot in list(self._entries):
            self._drop(slot)

    def forget_person(self, person: str, settle_s: float = 0.0) -> None:
        """A write whose writer is not known: every thread this person is an end of, and its rails."""
        if not person:
            return
        self._touch(("tp", person), settle_s)
        for slot in [s for s in self._entries if s[0] == "t" and person in s[2].split("|")]:
            self._drop(slot)
        self.forget(people=(person,), settle_s=settle_s)

    def forget_message(self, message_id: str, settle_s: float = 0.0, *, keep: tuple[str, ...] | None = None) -> None:
        """Every thread whose copy holds this message (a reaction whose thread is not known)."""
        mid = _cell(message_id)
        if not mid:
            return
        for slot in [s for s in self._entries if s[0] == "t" and s != keep]:
            entry = self._entries.get(slot)
            if entry is None:
                continue
            value = entry["value"]
            if mid in value["reactions"] or any(m["id"] == mid for m in value["messages"]):
                self.forget(keys=(slot[2],), settle_s=settle_s)

    def expire(self) -> int:
        """Copies past the ceiling dropped, and marks no read can still be older than, forgotten."""
        wall, now = self.wall(), self.clock()
        gone = [s for s, e in self._entries.items() if wall - e["filled_at"] >= self.ceiling_s]
        for slot in gone:
            self._drop(slot)
        for marks in (self._changed, self._sent):
            for name, at in list(marks.items()):
                if now - at > CACHE_READ_WINDOW_S:
                    marks.pop(name, None)
        for topic, until in list(self._settle.items()):
            if until <= now:
                self._settle.pop(topic, None)
        return len(gone)

    def counts(self) -> dict[str, Any]:
        threads = sum(1 for s in self._entries if s[0] == "t")
        now = self.clock()
        return {"threads": threads, "rails": len(self._entries) - threads, "bytes": self._bytes,
                "held_off": sum(1 for until in self._settle.values() if until > now), "pinned": len(self._pinned),
                **self.stats}

    # ── kept on disk ──

    @staticmethod
    def file_name(slot: tuple[str, ...]) -> str:
        """A kept copy's file: a hash of its slot, never an id."""
        return hashlib.sha256("\x1f".join(slot).encode("utf-8")).hexdigest() + ".chat.json"

    def take_dirty(self) -> list[tuple[str, str | None]]:
        """Each slot changed since the last call: (its file's name, the text to keep — None to remove the file)."""
        out: list[tuple[str, str | None]] = []
        for slot in self.dirty:
            entry = self._entries.get(slot)
            text = None if entry is None else json.dumps(
                {"v": 1, "slot": list(slot), "filled_at": entry["filled_at"], "value": entry["value"]},
                separators=(",", ":"))
            out.append((self.file_name(slot), text))
        self.dirty.clear()
        return out

    def adopt(self, name: str, body: Any) -> bool:
        """A kept file taken up after a start, read again the first time it is served."""
        if not isinstance(body, dict) or body.get("v") != 1 or not isinstance(body.get("slot"), list):
            return False
        slot = tuple(body["slot"])
        if (not all(isinstance(part, str) for part in slot)
                or not ((len(slot) == 3 and slot[0] == "t") or (len(slot) == 4 and slot[0] == "o"))
                or self.file_name(slot) != name):
            return False
        filled_at = body.get("filled_at")
        now = self.wall()
        if (not isinstance(filled_at, (int, float)) or isinstance(filled_at, bool)
                or not 0 < filled_at <= now + 60 or now - filled_at >= self.ceiling_s):
            return False
        if (slot in self._entries or self._all > -math.inf
                or any(t in self._changed or t in self._settle or t in self._pinned for t in self._topics(slot))):
            return False
        value = body.get("value")
        if not (self._valid_thread(slot, value) if slot[0] == "t" else self._valid_rail(slot, value)):
            return False
        self._put(slot, value, float(filled_at), disk=True)
        self.stats["adopted"] += 1
        return True

    @staticmethod
    def _valid_thread(slot: tuple[str, ...], value: Any) -> bool:
        pair = slot[2].split("|")
        if len(pair) != 2 or pair_key(*pair) != slot[2] or not isinstance(value, dict):
            return False
        messages, reactions = value.get("messages"), value.get("reactions")
        return (isinstance(messages, list) and isinstance(reactions, dict) and len(messages) <= CACHE_MESSAGES
                and all(isinstance(m, dict) and set(m) == {*_MESSAGE_TEXT, "side"} and type(m["side"]) is int
                        and m["side"] in (0, 1) and all(isinstance(m[k], str) for k in _MESSAGE_TEXT) and m["id"]
                        for m in messages)
                and all(isinstance(held, dict) for held in reactions.values()))

    @staticmethod
    def _valid_rail(slot: tuple[str, ...], value: Any) -> bool:
        if not isinstance(value, dict):
            return False
        threads = value.get("threads")
        return (_cell(value.get("me")) == slot[2] and isinstance(value.get("circle"), dict) == bool(slot[3])
                and isinstance(threads, list) and isinstance(value.get("people"), list)
                and all(isinstance(t, dict) and _cell(t.get("thread_key")) for t in threads))


# ── a send kept here first, written behind to Apps Script ──────────────────

# a send that landed is still laid over reads this long: one that began before it landed may answer without it
BEHIND_LANDED_KEEP_S = float(os.getenv("HUB_CHAT_BEHIND_KEEP_S", "180"))
BEHIND_MAX_PENDING = int(os.getenv("HUB_CHAT_BEHIND_MAX", "2000"))
# a send Apps Script has not taken by then is given up, and both ends are told
BEHIND_MAX_AGE_S = float(os.getenv("HUB_CHAT_BEHIND_MAX_AGE_S", str(24 * 3600)))
BEHIND_BACKOFF_S = (5.0, 15.0, 30.0, 60.0)
BEHIND_FILE_RE = re.compile(r"\d{20}\.[0-9a-f]{16}\.behind\.json")
BEHIND_TEMP_RE = re.compile(r"\.\d{20}\.[0-9a-f]{16}\.behind\.json\.[A-Za-z0-9_]+\.tmp")
BEHIND_ID_RE = re.compile(r"msg_[0-9a-f]{24}")
BEHIND_STATE_FILE = "behind-state.json"


def message_id_for(write_id: str, account_id: str) -> str:
    """Chat.gs chatSendId_: the id Apps Script files a send with this write id under, run as this account."""
    return "msg_" + _digest(f"{_cell(write_id)}\n{_cell(account_id)}")[:24]


def behind_refusal(*, on: bool, acting: bool, place: str | None, sender_narrowed: bool | None,
                   to_narrowed: bool | None, sender_person: str, to_person: str, room: bool) -> str:
    """'' when a send may be kept here first; else why it goes to Apps Script now."""
    if not on:
        return "off"
    if acting:
        return "acting"
    if place != "":
        return "place"
    if sender_narrowed is None or to_narrowed is None:
        return "unknown"
    if sender_narrowed:
        return "sender"
    if to_narrowed:
        return "recipient"
    if not sender_person or not to_person or sender_person == to_person:
        return "self"
    if not room:
        return "full"
    return ""


def behind_entry(*, write_id: str, account_id: str, person_id: str, ids: Iterable[str], name: str, to_user: str,
                 to_person: str, to_ids: Iterable[str], body: str, client_id: str, source: str, raw: bytes,
                 created_at: str, wall: float) -> dict[str, Any]:
    """One send kept here: what both ends are told now, and the envelope Apps Script is given behind."""
    return {"v": 1, "write_id": write_id, "id": message_id_for(write_id, account_id), "created_at": created_at,
            "thread_key": pair_key(person_id, to_person), "from_account": account_id, "from_person": person_id,
            "from_ids": sorted({i for i in ids if i} | {account_id, person_id}), "from_name": name,
            "to_user": to_user, "to_person": to_person, "to_ids": sorted({i for i in to_ids if i} | {to_person}),
            "body": body, "client_id": client_id, "source": source, "raw": raw.decode("ascii"),
            "accepted_at": float(wall), "tries": 0}


def behind_valid(entry: Any) -> bool:
    """A kept file read back after a start: every field a delivery and a read need, of its own shape."""
    if not isinstance(entry, dict) or entry.get("v") != 1:
        return False
    text = ("write_id", "id", "created_at", "thread_key", "from_account", "from_person", "from_name", "to_user",
            "to_person", "body", "client_id", "source", "raw")
    return (all(isinstance(entry.get(k), str) for k in text)
            and bool(BEHIND_ID_RE.fullmatch(entry["id"])) and entry["id"] == message_id_for(entry["write_id"],
                                                                                             entry["from_account"])
            and entry["thread_key"] == pair_key(entry["from_person"], entry["to_person"]) != ""
            and isinstance(entry.get("from_ids"), list) and isinstance(entry.get("to_ids"), list)
            and isinstance(entry.get("accepted_at"), (int, float)) and not isinstance(entry.get("accepted_at"), bool))


class Behind:
    """The sends kept here first, while they wait for Apps Script and for a short while after they land, and…"""

    def __init__(self, *, clock: Callable[[], float] = time.time, keep_s: float = BEHIND_LANDED_KEEP_S,
                 max_pending: int = BEHIND_MAX_PENDING) -> None:
        self.clock = clock
        self.keep_s, self.max_pending = float(keep_s), int(max_pending)
        self._pending: dict[str, dict[str, Any]] = {}
        self._landed: dict[str, tuple[float, dict[str, Any]]] = {}
        self.on = False
        self.why = "the server has not yet filed a send under the id it was given"
        self.stats = dict.fromkeys(("kept", "landed", "refused", "given_up", "moved", "switched_off"), 0)
        self.not_kept: dict[str, int] = {}

    def learn(self, proven: bool, why: str) -> bool:
        """What an answer from Apps Script showed; True when it changed whether sends are kept here first."""
        changed = bool(proven) != self.on
        if changed and not proven:
            self.stats["switched_off"] += 1
        self.on, self.why = bool(proven), why
        return changed

    def room(self) -> bool:
        return len(self._pending) < self.max_pending

    def note_not_kept(self, why: str) -> None:
        self.not_kept[why] = self.not_kept.get(why, 0) + 1

    def held(self, write_id: str) -> dict[str, Any] | None:
        """The send kept under this write id, waiting or recently landed."""
        if write_id in self._pending:
            return self._pending[write_id]
        got = self._landed.get(write_id)
        if got is None or self.clock() - got[0] > self.keep_s:
            return None
        return got[1]

    def waiting(self, write_id: str) -> bool:
        return write_id in self._pending

    def waiting_entries(self) -> list[dict[str, Any]]:
        return list(self._pending.values())

    def any(self) -> bool:
        """Anything a read may still have to carry: a send waiting, or one that landed a moment ago."""
        return bool(self._pending) or bool(self._live())

    def add(self, entry: dict[str, Any], *, restored: bool = False) -> None:
        self._pending[entry["write_id"]] = entry
        if not restored:
            self.stats["kept"] += 1

    def senders(self) -> list[str]:
        return list(dict.fromkeys(e["from_person"] for e in self._pending.values()))

    def next_for(self, person: str) -> dict[str, Any] | None:
        """This sender's oldest send still waiting: one person's sends land in the order they were typed."""
        return next((e for e in self._pending.values() if e["from_person"] == person), None)

    def landed(self, write_id: str, how: str = "landed") -> dict[str, Any] | None:
        entry = self._pending.pop(write_id, None)
        if entry is not None:
            self._landed[write_id] = (self.clock(), entry)
            self.stats[how] = self.stats.get(how, 0) + 1
        return entry

    def drop(self, write_id: str, how: str = "refused") -> dict[str, Any] | None:
        entry = self._pending.pop(write_id, None)
        self._landed.pop(write_id, None)
        if entry is not None:
            self.stats[how] = self.stats.get(how, 0) + 1
        return entry

    def _live(self) -> list[dict[str, Any]]:
        now = self.clock()
        for wid, (at, _e) in list(self._landed.items()):
            if now - at > self.keep_s:
                self._landed.pop(wid, None)
        return [e for _at, e in self._landed.values()] + list(self._pending.values())

    def touching_thread(self, key: str) -> list[dict[str, Any]]:
        return [e for e in self._live() if key and e["thread_key"] == key]

    def touching(self, people: Iterable[str]) -> list[dict[str, Any]]:
        who = {p for p in people if p}
        return [e for e in self._live() if e["from_person"] in who or e["to_person"] in who]

    def counts(self) -> dict[str, Any]:
        live = self._live()
        return {"on": self.on, "why": self.why, "waiting": len(self._pending), "landed_kept": len(live) -
                len(self._pending), "senders": len(self.senders()), **self.stats, "not_kept": dict(self.not_kept)}


# statuses that mean no judge ran (a closed door, a lock still held, the clock): tried again, never taken as a verdict
BEHIND_TRANSIENT = frozenset({405, 408, 409, 423, 425, 429})


def behind_outcome(entry: dict[str, Any], answer: Any) -> tuple[str, str]:
    """What one delivery of a kept send came to: `landed` (the row, under the id both ends were given), `moved`…"""
    if not isinstance(answer, dict):
        return "retry", "unreadable"
    reason = _cell(answer.get("reason"))
    if reason:
        return "retry", reason
    status = answer.get("status")
    if not isinstance(status, int) or isinstance(status, bool):
        return "retry", "unreadable"
    if status == 200:
        data = answer.get("data") if isinstance(answer.get("data"), dict) else {}
        got = _cell(data.get("id"))
        return ("landed", "") if got == entry["id"] else ("moved", got)
    if status >= 500 or status in BEHIND_TRANSIENT:
        return "retry", str(status)
    return "refused", _cell(answer.get("message")) or f"The server refused it ({status})."


def _by_time(entries: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted(entries, key=lambda e: (e["created_at"], e["write_id"]))


def behind_row(entry: dict[str, Any], viewer_ids: Iterable[str]) -> dict[str, Any]:
    """A kept send as chatMessages lists a row, for this viewer."""
    ids = frozenset(viewer_ids)
    return {"id": entry["id"], "from_user": entry["from_person"], "from_name": entry["from_name"],
            "body": entry["body"], "created_at": entry["created_at"], "read_at": "",
            "mine": entry["from_person"] in ids or entry["from_account"] in ids}


def overlay_messages(data: Any, key: str, viewer_ids: Iterable[str], entries: Iterable[dict[str, Any]]) -> Any:
    """chatMessages as Apps Script answered it, with the sends of this thread kept here that it does not carry yet."""
    if not isinstance(data, dict) or not isinstance(data.get("messages"), list):
        return data
    have = {_cell(m.get("id")) for m in data["messages"] if isinstance(m, dict)}
    add = [e for e in _by_time(entries) if e["thread_key"] == key and e["id"] not in have]
    if not add:
        return data
    ids = frozenset(viewer_ids)
    return {**data, "messages": [*data["messages"], *(behind_row(e, ids) for e in add)]}


def overlay_rail(data: Any, person: str, entries: Iterable[dict[str, Any]]) -> Any:
    """chatOverview with the kept sends it does not show yet: the thread's last line, and one more unread for the…"""
    if not isinstance(data, dict) or not isinstance(data.get("threads"), list) or isinstance(data.get("circle"), dict):
        return data
    people = {_cell(p.get("user_id")): p for p in data.get("people") or [] if isinstance(p, dict)}
    threads = [dict(t) for t in data["threads"] if isinstance(t, dict)]
    by_with = {_cell(t.get("with_user")): t for t in threads}
    total = _count(data.get("unread"))
    moved = False
    for e in _by_time(entries):
        mine = e["from_person"] == person
        if not mine and e["to_person"] != person:
            continue
        other = e["to_person"] if mine else e["from_person"]
        thread = by_with.get(other)
        if thread is not None and _text(thread.get("last_at")) >= e["created_at"]:
            continue
        if thread is None:
            known = people.get(other) or {}
            thread = {"thread_key": e["thread_key"], "with_user": other,
                      "with_name": _text(known.get("name")) or ("" if mine else e["from_name"]),
                      "last": "", "last_at": "", "unread": 0, "online": known.get("online") is True}
            threads.append(thread)
            by_with[other] = thread
        thread.update(last=e["body"][:CACHE_LAST], last_at=e["created_at"], last_from=e["from_person"])
        if not mine:
            thread["unread"] = _count(thread.get("unread")) + 1
            total += 1
        moved = True
    if not moved:
        return data
    threads.sort(key=lambda t: _text(t.get("last_at")), reverse=True)
    return {**data, "threads": threads, "unread": total}


def overlay_ping(data: Any, person: str, entries: Iterable[dict[str, Any]]) -> Any:
    """chatPing with the kept sends to this person newer than the newest line it counts."""
    if not isinstance(data, dict):
        return data
    latest = data.get("latest") if isinstance(data.get("latest"), dict) else None
    since = _text(latest.get("at")) if latest else ""
    add = [e for e in _by_time(entries)
           if e["to_person"] == person and e["from_person"] != person and e["created_at"] > since]
    if not add:
        return data
    top = add[-1]
    return {**data, "unread": _count(data.get("unread")) + len(add),
            "latest": {"id": top["id"], "at": top["created_at"], "from_user": top["from_person"],
                       "from_name": top["from_name"], "body": top["body"][:CACHE_LAST]}}


def behind_line(entry: dict[str, Any], *, mine: bool) -> str:
    """The chat stream's line for a kept send, words included: to the person written to, or to the sender's other…"""
    return json.dumps({"kind": "chatSend", "thread_key": entry["thread_key"], "from_user": entry["from_account"],
                       "at": entry["created_at"],
                       "message": {"id": entry["id"], "from_user": entry["from_person"],
                                   "from_name": entry["from_name"], "body": entry["body"],
                                   "created_at": entry["created_at"], "mine": bool(mine),
                                   "with_user": entry["to_person"] if mine else entry["from_person"]}},
                      separators=(",", ":"))


def behind_gone_line(entry: dict[str, Any]) -> str:
    """The chat stream's line for a kept send Apps Script refused: its line goes."""
    return json.dumps({"kind": "chatSend", "thread_key": entry["thread_key"], "from_user": entry["from_account"],
                       "at": entry["created_at"], "gone": entry["id"]}, separators=(",", ":"))


def behind_event(entry: dict[str, Any], *, held: bool) -> dict[str, Any]:
    """What the hub is told of a send kept here from outside it: the words, as its own `confirm` carries them."""
    return {"kind": "sent", "id": entry["id"], "created_at": entry["created_at"], "thread_key": entry["thread_key"],
            "from": entry["from_person"], "from_name": entry["from_name"], "to": entry["to_person"],
            "to_ids": list(entry["to_ids"]), "body": entry["body"], "client_id": entry["client_id"],
            "held": bool(held)}


def behind_refused_event(entry: dict[str, Any], why: str) -> dict[str, Any]:
    """What the hub is told of a kept send Apps Script refused: the recipient's tabs take it back, the sender's…"""
    return {"kind": "refused", "id": entry["id"], "thread_key": entry["thread_key"], "from": entry["from_person"],
            "to": entry["to_person"], "to_ids": list(entry["to_ids"]), "client_id": entry["client_id"],
            "why": why}
