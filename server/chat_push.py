"""Web Push for a chat message whose recipient has nothing open: no chat stream and no live chat connection.
A push never carries the words: the title names the sender, the body says where to read them, and one thread's…"""
from __future__ import annotations

import hashlib
import json
import math
import os
import threading
import time
import urllib.parse
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Iterable

RATE_S = float(os.getenv("HUB_CHAT_PUSH_EVERY_S", "120"))
# two of the hub's ref checks (every 2 minutes, on a 15-second sweep) and some slack
LIVE_S = float(os.getenv("HUB_CHAT_PUSH_LIVE_S", "300"))
# a connection opened while the hub was writing its list is not read as closed by that list
LIST_GRACE_S = 10.0
# a send answered without its receipt is looked for after the echo (doPost ran) at once, after silence once Apps…
AFTER_ECHO_S = 2.0
AFTER_SILENCE_S = 35.0
# a row of the sender's filed this long before the relay heard of the send is that send's: the /gas budget, the…
ROW_WINDOW_S = 120.0

KIND = "chat_message"
INBOX_CHAT = "/app/my-inbox/chat"
BODY = "Open My Inbox to read it."
TAG_PREFIX = "chat-"
MAX_RAW = 100_000
MAX_KEYS = 4000

# what one landed message comes to
LIVE = "live"
NOT_OWED = "not_owed"
NO_DEVICE = "no_device"
RATE = "rate"
HELD_TEST = "held_test"
QUIET = "quiet"
NO_KEY = "no_key"
SEND = "send"


def _cell(value: Any) -> str:
    return "" if value is None else str(value).strip()


def now() -> datetime:
    return datetime.now(timezone.utc)


def _form_body(raw: bytes) -> dict[str, Any]:
    if len(raw) > MAX_RAW:
        return {}
    try:
        body = urllib.parse.parse_qs(raw.decode("utf-8", "ignore")).get("body", [""])[0]
        parsed = json.loads(body) if body else {}
    except Exception:  # noqa: BLE001
        return {}
    return parsed if isinstance(parsed, dict) else {}


# ── what landed ─────────────────────────────────────────────────────────────

def landed_send(raw: bytes, content: bytes) -> dict[str, str] | None:
    """A chatSend Apps Script answered 200: {token, to_user, thread_key, message_id, tenant}; no message_id when…"""
    if b"chatSend" not in raw[:4096]:
        return None
    req = _form_body(raw)
    if str(req.get("action") or "") != "chatSend":
        return None
    try:
        env = json.loads(content)
    except (ValueError, UnicodeDecodeError, TypeError):
        return None
    if not isinstance(env, dict) or env.get("status") != 200:
        return None
    data = env.get("data") if isinstance(env.get("data"), dict) else {}
    payload = req.get("payload") if isinstance(req.get("payload"), dict) else {}
    to_user = _cell(payload.get("to_user")) or _cell(data.get("to_user"))
    if not to_user:
        return None
    return {"token": _cell(req.get("token")), "to_user": to_user, "thread_key": _cell(data.get("thread_key")),
            "message_id": _cell(data.get("id")), "tenant": _cell(req.get("tenant"))}


def unanswered_send(raw: bytes) -> dict[str, str] | None:
    """A chatSend that left without its receipt: {token, to_user, tenant}. Never the words."""
    if b"chatSend" not in raw[:4096]:
        return None
    req = _form_body(raw)
    if str(req.get("action") or "") != "chatSend":
        return None
    payload = req.get("payload") if isinstance(req.get("payload"), dict) else {}
    to_user = _cell(payload.get("to_user"))
    if not to_user:
        return None
    return {"token": _cell(req.get("token")), "to_user": to_user, "thread_key": "", "message_id": "",
            "tenant": _cell(req.get("tenant"))}


def _when(value: Any) -> datetime | None:
    text = _cell(value)
    if not text:
        return None
    try:
        at = datetime.fromisoformat(text[:-1] + "+00:00" if text.endswith("Z") else text)
    except ValueError:
        return None
    return at if at.tzinfo else at.replace(tzinfo=timezone.utc)


def row_since(at_: datetime | None = None) -> str:
    """The earliest a row may have been filed and still be the send the relay just heard of."""
    return ((at_ or now()) - timedelta(seconds=ROW_WINDOW_S)).astimezone(timezone.utc).isoformat()


def row_filed(answer: Any, since: str) -> str | None:
    """A chatMessages answer read as the sender: the id of their newest message filed at or after `since`, or…"""
    if not isinstance(answer, dict) or "reason" in answer or answer.get("status") != 200:
        return None
    data = answer.get("data") if isinstance(answer.get("data"), dict) else {}
    floor = _when(since)
    if floor is None:
        return None
    best: tuple[datetime, str] | None = None
    for m in data.get("messages") or []:
        if not isinstance(m, dict) or m.get("mine") is not True or not _cell(m.get("id")):
            continue
        at = _when(m.get("created_at"))
        if at is None or at < floor:
            continue
        if best is None or at >= best[0]:
            best = (at, _cell(m.get("id")))
    return best[1] if best else None


# ── the words, the tag, the link ────────────────────────────────────────────

def thread_of(a: str, b: str) -> str:
    """Chat.gs chatThreadKey_: the sorted pair of person ids."""
    x, y = _cell(a), _cell(b)
    if not x or not y:
        return ""
    return f"{x}|{y}" if x < y else f"{y}|{x}"


def other_side(thread_key: str, person: str) -> str:
    parts = _cell(thread_key).split("|")
    if len(parts) != 2 or not all(parts):
        return ""
    if parts[0] == _cell(person):
        return parts[1]
    if parts[1] == _cell(person):
        return parts[0]
    return ""


def tag_of(thread: str) -> str:
    """One tag per thread, so a device replaces the last push of that conversation; no id in it."""
    return TAG_PREFIX + hashlib.sha256(_cell(thread).encode("utf-8")).hexdigest()[:20]


def title_of(sender_name: str) -> str:
    name = " ".join(_cell(sender_name).split())[:80]
    return f"New message from {name}" if name else "New message"


def href_of(sender_person: str) -> str:
    who = _cell(sender_person)
    return f"{INBOX_CHAT}?with={urllib.parse.quote(who, safe='')}" if who else INBOX_CHAT


def plan(*, to_user: str, to_person: str, to_ids: Iterable[str], to_name: str, from_person: str,
         from_name: str, thread_key: str, message_id: str) -> dict[str, Any] | None:
    """One push to decide, or None (nobody to push to, or a message to oneself)."""
    to_user, to_person = _cell(to_user), _cell(to_person) or _cell(to_user)
    ids = [i for i in dict.fromkeys([_cell(x) for x in to_ids] + [to_person, to_user]) if i]
    if not ids:
        return None
    from_person = _cell(from_person) or other_side(thread_key, to_person)
    if from_person and from_person in ids:
        return None
    thread = thread_of(from_person, to_person) or _cell(thread_key) or f"?|{to_person}"
    event = _cell(message_id) or hashlib.sha256(
        f"{thread}\n{time.time_ns()}".encode("utf-8")).hexdigest()[:24]
    return {"to_person": to_person, "to_ids": ids, "to_name": _cell(to_name), "from_person": from_person,
            "from_name": _cell(from_name), "thread": thread, "rate_key": f"{to_person}\n{thread}",
            "tag": tag_of(thread), "event": event}


def copy_of(p: dict[str, Any]) -> dict[str, Any]:
    """The copy web_push.wants_push judges and the mock row names: high, a chat's own role, never held here."""
    return {"priority": "high", "role": "chat", "kind": KIND, "held": False,
            "title": title_of(p.get("from_name") or ""), "body": BODY}


def payload(p: dict[str, Any], at_: datetime | None = None) -> dict[str, Any]:
    """What reaches the device, in the shape public/sw.js reads."""
    at = (at_ or now()).astimezone(timezone.utc).isoformat()
    return {"v": 1, "id": 0, "tag": p["tag"], "title": title_of(p.get("from_name") or ""), "body": BODY,
            "href": href_of(p.get("from_person") or ""), "urgent": False, "kind": KIND, "at": at}


def judge(*, devices: int, rate: "RateLimit", key: str, held: bool, quiet: bool, keys_ok: bool) -> str:
    """What becomes of a push owed to someone with nothing open. The rate is spent only with a device to reach."""
    if devices <= 0:
        return NO_DEVICE
    if not rate.claim(key):
        return RATE
    if held:
        return HELD_TEST
    if quiet:
        return QUIET
    if not keys_ok:
        return NO_KEY
    return SEND


# ── who is live on the hub, and how often ───────────────────────────────────

class HubLive:
    """The ids (person and folded accounts) that hold a live chat connection, from the hub's own word."""

    def __init__(self, live_s: float = LIVE_S, grace_s: float = LIST_GRACE_S,
                 clock: Callable[[], float] = time.monotonic) -> None:
        self.live_s, self.grace_s, self.clock = float(live_s), float(grace_s), clock
        self._listed: set[str] = set()
        self._listed_at = -math.inf
        self._touched: dict[str, float] = {}
        self._lock = threading.Lock()

    def listed(self, groups: Iterable[Iterable[str]]) -> None:
        """The hub's list of the refs its connections hold, as each ref's ids: the word for all of them."""
        ids = {_cell(i) for group in groups for i in (group or ()) if _cell(i)}
        with self._lock:
            self._listed, self._listed_at = ids, self.clock()

    def touched(self, ids: Iterable[str]) -> None:
        """A ticket redeemed or an exec made for these ids: live until the next list says otherwise."""
        now = self.clock()
        with self._lock:
            for i in ids or ():
                if _cell(i):
                    self._touched[_cell(i)] = now
            if len(self._touched) > MAX_KEYS:
                for k, at in list(self._touched.items()):
                    if now - at > self.live_s:
                        self._touched.pop(k, None)

    def live(self, ids: Iterable[str]) -> bool:
        now = self.clock()
        want = {_cell(i) for i in ids or () if _cell(i)}
        with self._lock:
            if want & self._listed and now - self._listed_at <= self.live_s:
                return True
            for i in want:
                at = self._touched.get(i)
                if at is not None and at >= self._listed_at - self.grace_s and now - at <= self.live_s:
                    return True
        return False

    def counts(self) -> dict[str, Any]:
        with self._lock:
            age = self.clock() - self._listed_at
            return {"listed": len(self._listed), "touched": len(self._touched),
                    "list_age_s": int(age) if math.isfinite(age) else None}


class RateLimit:
    """One push per recipient and thread every `every_s`."""

    def __init__(self, every_s: float = RATE_S, clock: Callable[[], float] = time.monotonic) -> None:
        self.every_s, self.clock = float(every_s), clock
        self._at: dict[str, float] = {}
        self._lock = threading.Lock()

    def open(self, key: str) -> bool:
        """Whether a claim now would be granted; nothing is spent."""
        now = self.clock()
        with self._lock:
            at = self._at.get(key)
            return at is None or now - at >= self.every_s

    def claim(self, key: str) -> bool:
        now = self.clock()
        with self._lock:
            at = self._at.get(key)
            if at is not None and now - at < self.every_s:
                return False
            self._at[key] = now
            if len(self._at) > MAX_KEYS:
                for k, t in list(self._at.items()):
                    if now - t >= self.every_s:
                        self._at.pop(k, None)
        return True
