"""Pulls Quo texts and call transcripts into the webhook's inbox on its own clock, deduped by the inbox's (id, type) key. Stdlib only."""
from __future__ import annotations

import http.client
import json
import logging
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Iterator

import quo_inbox

log = logging.getLogger("hub.quo_pull")

API_BASE = os.getenv("HUB_QUO_API_BASE", "https://api.openphone.com/v1").rstrip("/")
KEY_FILE = Path(os.getenv("HUB_QUO_API_KEY_FILE", "/srv/secrets/quo-api.key"))
# Where a line with no cursor starts.
SINCE = os.getenv("HUB_QUO_PULL_SINCE", "2026-09-16T00:36:00Z")
EVERY_S = float(os.getenv("HUB_QUO_PULL_EVERY_S", "600"))
OVERLAP_S = float(os.getenv("HUB_QUO_PULL_OVERLAP_S", "900"))
GAP_S = float(os.getenv("HUB_QUO_PULL_GAP_S", "0.15"))
TIMEOUT_S = float(os.getenv("HUB_QUO_PULL_TIMEOUT_S", "30"))
# How long a sent text still on its way is asked about by id.
WATCH_S = float(os.getenv("HUB_QUO_PULL_WATCH_S", str(24 * 3600)))
PAGE = 100
MAX_PAGES = 200
LOUD_AFTER = 6
NEVER_DELIVERED = ("undelivered", "failed", "canceled", "cancelled")
USER_AGENT = "asa-hub-relay/1.0 (quo-pull)"
DEEP_LINK = "https://my.quo.com/inbox/{pn}/c/{conv}?at={mid}"
TRANSCRIPT = "call.transcript.completed"
# A thread's calls are listed this far behind its window: a long call is created long before its transcript exists.
CALL_LOOKBACK_S = float(os.getenv("HUB_QUO_PULL_CALL_LOOKBACK_S", str(6 * 3600)))
# How long past a call's end its transcript is still asked for; Quo makes one within minutes.
TRANSCRIPT_WAIT_S = float(os.getenv("HUB_QUO_PULL_TRANSCRIPT_WAIT_S", str(3 * 3600)))
# A call listed while it is still going is owed too: its thread may never be listed again once it ends.
LIVE_CALL = ("queued", "initiated", "ringing", "in-progress", "answered")

_KEY: dict[str, Any] = {"stamp": None, "key": "", "why": "", "said": None}
_HEADER_SAFE = re.compile(r"[\x21-\x7e]+")


class RateLimited(Exception):
    """Quo answered 429: the round ends here."""


class PullError(Exception):
    """A read that could not be made; the words never carry the key."""

    def __init__(self, why: str, code: int | None = None):
        super().__init__(why)
        self.code = code


def read_key(text: str) -> tuple[str, str]:
    """(key, "") or ("", why unusable); must be one header-safe token, and the why never quotes the file."""
    words: list[str] = []
    for raw in text.splitlines():
        line = raw.strip()
        if line and not line.startswith("#"):
            words.extend(line.split())
    if not words:
        return "", "empty"
    if len(words) > 1:
        return "", f"{len(words)} entries where one key is expected"
    if not _HEADER_SAFE.fullmatch(words[0]):
        return "", "characters a request header cannot carry"
    return words[0], ""


def _key() -> str:
    try:
        st = KEY_FILE.stat()
        stamp: tuple[int, int] | None = (int(st.st_mtime_ns), int(st.st_size))
    except OSError:
        stamp = None
    if stamp != _KEY["stamp"]:
        key, why = "", "no file"
        if stamp is not None:
            try:
                key, why = read_key(KEY_FILE.read_text(encoding="utf-8"))
            except (OSError, ValueError) as exc:
                key, why = "", f"unreadable ({type(exc).__name__})"
        _KEY.update(stamp=stamp, key=key, why=why)
    said = (bool(_KEY["key"]), _KEY["why"])
    if said != _KEY["said"]:
        _KEY["said"] = said
        if said[0]:
            log.info("quo pull: API key read from the file — the pull is armed")
        elif stamp is None:
            log.info("quo pull: no API key at %s — the pull is off", KEY_FILE)
        else:
            log.warning("quo pull: the key file at %s is unusable (%s) — the pull is off",
                        KEY_FILE, said[1])
    return str(_KEY["key"])


def _get(path: str, params: list[tuple[str, str]]) -> dict:
    """The only network door; failures raise RateLimited or PullError without the request, which carries the key."""
    key = _key()
    if not key:
        raise PullError("no API key")
    url = API_BASE + path + ("?" + urllib.parse.urlencode(params) if params else "")
    try:
        req = urllib.request.Request(url, method="GET", headers={
            "Authorization": key, "User-Agent": USER_AGENT, "Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=TIMEOUT_S) as res:
            body = res.read()
    except urllib.error.HTTPError as exc:
        if exc.code == 429:
            raise RateLimited(f"429 on {path}") from None
        raise PullError(f"HTTP {exc.code} on {path}", exc.code) from None
    except (urllib.error.URLError, TimeoutError, OSError, ValueError, http.client.HTTPException) as exc:
        raise PullError(f"{type(exc).__name__} on {path}") from None
    try:
        got = json.loads(body.decode("utf-8") or "{}")
    except (UnicodeDecodeError, ValueError):
        raise PullError(f"not JSON on {path}") from None
    if not isinstance(got, dict):
        raise PullError(f"not an object on {path}")
    return got


def _pages(path: str, params: list[tuple[str, str]]) -> Iterator[dict]:
    """Every item of a listing, page after page, GAP_S between requests."""
    token = ""
    for _ in range(MAX_PAGES):
        got = _get(path, params + ([("pageToken", token)] if token else []))
        time.sleep(GAP_S)
        items = got.get("data")
        for item in items if isinstance(items, list) else []:
            if isinstance(item, dict):
                yield item
        token = str(got.get("nextPageToken") or "")
        if not token or not items:
            return
    raise PullError(f"{path} was still paging after {MAX_PAGES} pages")


def wrap(msg: Any, phone_number_id: str | None = None) -> dict | None:
    """An API message in the webhook's event shape, or None when the webhook never would have sent it."""
    if not isinstance(msg, dict):
        return None
    mid = str(msg.get("id") or "").strip()
    direction = str(msg.get("direction") or "")
    status = str(msg.get("status") or "")
    if not mid:
        return None
    if direction.lower() == "incoming":
        kind, at = "message.received", msg.get("createdAt")
    elif direction.lower() == "outgoing" and status.lower() == "delivered":
        kind, at = "message.delivered", msg.get("updatedAt") or msg.get("createdAt")
    else:
        return None
    to = msg.get("to")
    if isinstance(to, list):
        to = [str(t) for t in to if t]
        to = to[0] if len(to) == 1 else to
    line = str(msg.get("phoneNumberId") or phone_number_id or "")
    conv = str(msg.get("conversationId") or "")
    obj: dict[str, Any] = {
        "id": mid, "object": "message", "from": msg.get("from"), "to": to,
        "direction": direction, "text": msg.get("text") or "", "status": status,
        "createdAt": msg.get("createdAt"), "userId": msg.get("userId"),
        "phoneNumberId": line, "conversationId": conv or None, "contactIds": [],
    }
    media = msg.get("media")
    if isinstance(media, list) and media:
        obj["media"] = media
    data: dict[str, Any] = {"object": obj}
    if line and conv:
        data["deepLink"] = DEEP_LINK.format(pn=line, conv=conv, mid=mid)
    return {"id": f"pull:{mid}", "object": "event", "createdAt": at, "type": kind, "data": data}


def wrap_transcript(t: dict, call: dict, pid: str) -> dict | None:
    """A transcript in the webhook's event shape, with the call's line, direction and participants."""
    cid = str(t.get("callId") or call.get("id") or "").strip()
    if not cid or str(t.get("status") or "").lower() != "completed":
        return None
    obj = {"callId": cid, "createdAt": t.get("createdAt"), "dialogue": t.get("dialogue") or [],
           "duration": t.get("duration"), "status": t.get("status"),
           "phoneNumberId": str(call.get("phoneNumberId") or pid), "direction": call.get("direction"),
           "participants": [str(p) for p in (call.get("participants") or []) if p]}
    return {"id": f"pull:transcript:{cid}", "object": "event", "createdAt": t.get("createdAt"),
            "type": TRANSCRIPT, "data": {"object": obj}}


def on_its_way(msg: Any) -> bool:
    """A sent text not delivered yet, and not refused either: worth asking about again."""
    if not isinstance(msg, dict) or str(msg.get("direction") or "").lower() != "outgoing":
        return False
    status = str(msg.get("status") or "").lower()
    return status != "delivered" and status not in NEVER_DELIVERED


def _after(cursor: str | None, now: float) -> str:
    since = quo_inbox._ts(cursor or SINCE)
    if since is None:
        since = quo_inbox._ts(SINCE) or now
    return quo_inbox._iso(max(0.0, since - OVERLAP_S))


def _earlier(a: str, b: str | None) -> str:
    """The earlier of two ISO instants; `a` when `b` is missing or unreadable."""
    ta, tb = quo_inbox._ts(a), quo_inbox._ts(b) if b else None
    return b if (tb is not None and ta is not None and tb < ta) else a


class _Round:
    """What one round has read so far, and what it said."""

    def __init__(self, now: float):
        self.now = now
        self.events: list[dict] = []
        self.read_ids: set[str] = set()
        self.said: dict[str, Any] = {
            "state": "ok", "why": "", "lines": 0, "lines_done": 0, "lines_failed": 0,
            "threads": 0, "threads_failed": 0, "messages": 0, "kept_candidates": 0,
            "not_delivered": 0, "watching": 0, "watch_delivered": 0, "watch_let_go": 0,
            "owed": 0, "calls_failed": 0, "transcripts": 0, "transcripts_owed": 0,
            "added": 0, "duplicate": 0, "invalid": 0}

    def fault(self, why: str) -> None:
        if self.said["state"] == "ok":
            self.said.update(state="partial", why=why)

    def take(self, msg: dict, pid: str, watch: dict[str, dict]) -> None:
        """Kept when the webhook would have delivered it, watched when still on its way."""
        mid = str(msg.get("id") or "").strip()
        if mid:
            self.read_ids.add(mid)
        ev = wrap(msg, pid)
        if ev is not None:
            self.events.append(ev)
            if watch.pop(mid, None) is not None:
                self.said["watch_delivered"] += 1
            return
        self.said["not_delivered"] += 1
        if not mid:
            return
        created = quo_inbox._ts(msg.get("createdAt"))
        if on_its_way(msg) and created is not None and self.now - created < WATCH_S:
            watch.setdefault(mid, {"created": str(msg.get("createdAt")),
                                   "conversation": str(msg.get("conversationId") or "")})
        elif watch.pop(mid, None) is not None:
            self.said["watch_let_go"] += 1


def _read_thread(rnd: _Round, pid: str, cid: str, parts: list[str], since: str,
                 owed: dict[str, dict], watch: dict[str, dict]) -> None:
    """One thread since `since`; a failure leaves it owed from the earlier start, a 429 goes up."""
    query = ([("phoneNumberId", pid)] + [("participants[]", p) for p in parts]
             + [("createdAfter", since), ("maxResults", str(PAGE))])
    try:
        for msg in _pages("/messages", query):
            rnd.said["messages"] += 1
            rnd.take(msg, pid, watch)
    except PullError as exc:
        debt = owed.get(cid) or {}
        tries = int(debt.get("tries") or 0) + 1
        owed[cid] = {"after": _earlier(since, debt.get("after")), "participants": parts,
                     "tries": tries, "last_error": str(exc)[:160]}
        rnd.said["threads_failed"] += 1
        rnd.fault(str(exc))
        if tries >= LOUD_AFTER:
            log.warning("quo pull: thread %s on line %s failed %s rounds running (%s) — owed from %s, "
                        "asked again every round", cid, pid, tries, exc, owed[cid]["after"])
        return
    owed.pop(cid, None)


def _owed_call(call: dict, pid: str) -> dict | None:
    """What the pull keeps of a call whose transcript may come, with the instant it stops asking; None when none will."""
    status = str(call.get("status") or "").lower()
    created = quo_inbox._ts(call.get("createdAt"))
    if created is None:
        return None
    try:
        duration = max(0.0, float(call.get("duration") or 0))
    except (TypeError, ValueError):
        duration = 0.0
    if status == "completed" and duration:
        until = created + duration + TRANSCRIPT_WAIT_S
    elif status in LIVE_CALL:
        until = created + CALL_LOOKBACK_S + TRANSCRIPT_WAIT_S
    else:
        return None
    return {"createdAt": str(call.get("createdAt") or ""), "until": quo_inbox._iso(until),
            "phoneNumberId": str(call.get("phoneNumberId") or pid), "direction": call.get("direction"),
            "participants": [str(p) for p in (call.get("participants") or []) if p]}


def _read_calls(rnd: _Round, pid: str, part: str, since: str, calls: dict[str, dict]) -> None:
    """One thread's calls since `since` whose transcript the inbox lacks, owed by call id."""
    try:
        for call in _pages("/calls", [("phoneNumberId", pid), ("participants[]", part),
                                      ("createdAfter", since), ("maxResults", str(PAGE))]):
            cid = str(call.get("id") or "").strip()
            if not cid or quo_inbox.kept(cid, TRANSCRIPT):
                continue
            owed = _owed_call(call, pid)
            if owed is not None:
                calls[cid] = owed
    except PullError as exc:
        rnd.said["calls_failed"] += 1
        rnd.fault(str(exc))


def _read_transcripts(rnd: _Round, pid: str, calls: dict[str, dict]) -> None:
    """Every owed call's transcript, asked by id each round until it is kept or its `until` has passed (asked…"""
    for cid, call in list(calls.items()):
        until = quo_inbox._ts(call.get("until"))
        if until is None:
            created = quo_inbox._ts(call.get("createdAt"))
            until = None if created is None else created + CALL_LOOKBACK_S + TRANSCRIPT_WAIT_S
        if quo_inbox.kept(cid, TRANSCRIPT) or until is None or rnd.now >= until + WATCH_S:
            calls.pop(cid, None)
            continue
        try:
            got = _get("/call-transcripts/" + urllib.parse.quote(cid, safe=""), [])
        except PullError as exc:
            if exc.code != 404:
                rnd.fault(str(exc))
            elif rnd.now >= until:
                calls.pop(cid, None)
            continue
        finally:
            time.sleep(GAP_S)
        data = got.get("data")
        ev = wrap_transcript(data if isinstance(data, dict) else {}, dict(call, id=cid), pid)
        if ev is not None:
            rnd.events.append(ev)
            rnd.said["transcripts"] += 1
            calls.pop(cid, None)
        elif rnd.now >= until:
            calls.pop(cid, None)


def _read_line(rnd: _Round, pid: str, memo: dict[str, Any]) -> bool:
    """One line; True when its thread list was read whole, so its cursor may move."""
    owed, watch = memo["owed"], memo["watch"]
    calls = memo.setdefault("calls", {})
    after = _after(memo.get("cursor"), rnd.now)
    call_since = quo_inbox._iso(max(0.0, (quo_inbox._ts(after) or rnd.now) - CALL_LOOKBACK_S))
    try:
        threads = list(_pages("/conversations", [("phoneNumbers[]", pid), ("updatedAfter", after),
                                                 ("maxResults", str(PAGE))]))
    except PullError as exc:
        memo["fails"] = int(memo.get("fails") or 0) + 1
        rnd.said["lines_failed"] += 1
        rnd.fault(str(exc))
        if memo["fails"] >= LOUD_AFTER:
            log.warning("quo pull: line %s — its threads could not be listed %s rounds running (%s); "
                        "its cursor waits", pid, memo["fails"], exc)
        return False
    memo["fails"] = 0
    read: set[str] = set()
    for conv in threads:
        cid = str(conv.get("id") or "")
        parts = [str(p) for p in (conv.get("participants") or []) if p]
        if not parts or not cid:
            continue
        rnd.said["threads"] += 1
        read.add(cid)
        _read_thread(rnd, pid, cid, parts, _earlier(after, (owed.get(cid) or {}).get("after")), owed, watch)
        if len(parts) == 1:
            _read_calls(rnd, pid, parts[0], call_since, calls)
    for cid, debt in list(owed.items()):
        if cid in read:
            continue
        parts = [str(p) for p in (debt.get("participants") or []) if p]
        if not parts:
            owed.pop(cid, None)
            continue
        rnd.said["threads"] += 1
        _read_thread(rnd, pid, cid, parts, str(debt.get("after") or after), owed, watch)
    _read_transcripts(rnd, pid, calls)
    rnd.said["transcripts_owed"] += len(calls)
    for mid, seen in list(watch.items()):
        if mid in rnd.read_ids:
            continue
        created = quo_inbox._ts(seen.get("created"))
        if created is None or rnd.now - created >= WATCH_S:
            watch.pop(mid, None)
            rnd.said["watch_let_go"] += 1
            log.info("quo pull: sent text %s on line %s was still not delivered after %sh — no longer asked about",
                     mid, pid, round(WATCH_S / 3600))
            continue
        try:
            got = _get("/messages/" + urllib.parse.quote(mid, safe=""), [])
        except PullError as exc:
            if exc.code == 404:
                watch.pop(mid, None)
                rnd.said["watch_let_go"] += 1
            else:
                rnd.fault(str(exc))
            continue
        finally:
            time.sleep(GAP_S)
        msg = got.get("data")
        if isinstance(msg, dict):
            rnd.take(msg, pid, watch)
    return True


def run_round(now: float | None = None) -> dict[str, Any]:
    """One pass over every line; never raises for a failed read, and unfinished lines keep their cursors."""
    now = time.time() if now is None else now
    rnd = _Round(now)
    said = rnd.said
    if not _key():
        said.update(state="off", why="no API key")
        return said
    advanced: dict[str, str] = {}
    memos: dict[str, dict] = {}
    try:
        lines = [p for p in _pages("/phone-numbers", []) if str(p.get("id") or "")]
    except RateLimited as exc:
        said.update(state="rate_limited", why=str(exc))
        lines = []
    except PullError as exc:
        said.update(state="failed", why=str(exc))
        lines = []
    said["lines"] = len(lines)
    for pn in lines:
        memos[str(pn["id"])] = quo_inbox.pull_line(str(pn["id"]))
    order = sorted(memos, key=lambda pid: quo_inbox._ts(memos[pid].get("tried")) or 0.0)
    tried: dict[str, dict] = {}
    for pid in order:
        memo = memos[pid]
        started = quo_inbox._iso(time.time())
        memo["tried"] = started
        tried[pid] = memo
        try:
            whole = _read_line(rnd, pid, memo)
        except RateLimited as exc:
            said.update(state="rate_limited", why=str(exc))
            break
        if whole:
            advanced[pid] = started
            said["lines_done"] += 1
    # Oldest first, so a reply never lands before its question.
    events = rnd.events
    events.sort(key=lambda e: str(((e.get("data") or {}).get("object") or {}).get("createdAt") or ""))
    said["kept_candidates"] = len(events)
    try:
        counts = quo_inbox.append_many(events, "pull", now)
    except OSError as exc:
        # Nothing was kept, so no cursor moves and nothing is struck off.
        said.update(state="failed", why=f"the inbox refused the round ({type(exc).__name__})")
        advanced, tried = {}, {}
        counts = {"added": 0, "duplicate": 0, "invalid": 0}
    said.update(counts)
    said["owed"] = sum(len(m["owed"]) for m in tried.values())
    said["watching"] = sum(len(m["watch"]) for m in tried.values())
    quo_inbox.pull_done(advanced, said, now, lines=tried)
    return said
