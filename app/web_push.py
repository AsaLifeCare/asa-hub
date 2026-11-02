"""Web Push of company notices; a test-mode hold is never sent later, a quiet-window hold only while still true.
A chat message's push (chat_push.py) is never held for later at all.

The relay's server/web_push.py in asa-hub-app, for the notices' clock (app/notice_clock.py): its tables
(asa_hub_push_subs, asa_hub_push_outbox) are the relay's own in asa-hub-db's schema app (lanes_db), and the keys are
the relay's file mounted read-only. Without the sending library there are no keys, so nothing is claimed as sending."""
from __future__ import annotations

import base64
import json
import logging
import os
import re
import urllib.parse
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Iterable, Iterator

import lanes_db as hub_db
import lanes_pg as psycopg2
import web_gate
import web_notices

log = logging.getLogger("asa-hub-app.webpush")

UTC = timezone.utc

VAPID_FILE = Path(os.getenv("HUB_WEBPUSH_VAPID_FILE", "/run/secrets/webpush-vapid.json"))
HELD_MAX_H = float(os.getenv("HUB_WEBPUSH_HELD_MAX_H", "14"))
MAX_TRIES = int(os.getenv("HUB_WEBPUSH_MAX_TRIES", "3"))
RETRY_S = float(os.getenv("HUB_WEBPUSH_RETRY_S", "120"))
SEND_TIMEOUT_S = float(os.getenv("HUB_WEBPUSH_TIMEOUT_S", "10"))
DEVICES_PER_ACCOUNT = int(os.getenv("HUB_WEBPUSH_DEVICES", "8"))

SUBS_DDL = (
    "CREATE TABLE IF NOT EXISTS asa_hub_push_subs ("
    "endpoint TEXT PRIMARY KEY, user_id TEXT NOT NULL, "
    "p256dh TEXT NOT NULL, auth TEXT NOT NULL, "
    "role TEXT NOT NULL DEFAULT '', ua TEXT NOT NULL DEFAULT '', "
    "created_at TIMESTAMPTZ NOT NULL DEFAULT now(), "
    "seen_at TIMESTAMPTZ NOT NULL DEFAULT now(), "
    "last_ok_at TIMESTAMPTZ, last_status INT, fails INT NOT NULL DEFAULT 0)"
)
SUBS_USER_DDL = "CREATE INDEX IF NOT EXISTS asa_hub_push_subs_user ON asa_hub_push_subs (user_id)"
OUTBOX_DDL = (
    "CREATE TABLE IF NOT EXISTS asa_hub_push_outbox ("
    "notice_id BIGINT NOT NULL, user_id TEXT NOT NULL, "
    "state TEXT NOT NULL, held_by TEXT NOT NULL DEFAULT '', "
    "words JSONB NOT NULL DEFAULT '{}'::jsonb, "
    "devices INT NOT NULL DEFAULT 0, tries INT NOT NULL DEFAULT 0, "
    "why TEXT NOT NULL DEFAULT '', "
    "created_at TIMESTAMPTZ NOT NULL DEFAULT now(), "
    "updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), sent_at TIMESTAMPTZ, "
    "PRIMARY KEY (notice_id, user_id))"
)
OUTBOX_STATE_DDL = "CREATE INDEX IF NOT EXISTS asa_hub_push_outbox_state ON asa_hub_push_outbox (state)"
DDL = (SUBS_DDL, SUBS_USER_DDL, OUTBOX_DDL, OUTBOX_STATE_DDL)

S_SENDING = "sending"
S_SENT = "sent"
S_HELD_QUIET = "held_quiet"
S_HELD_TEST = "held_test"
S_EXPIRED = "expired"
S_FAILED = "failed"
S_NO_DEVICE = "no_device"
HELD_STATES = (S_HELD_QUIET, S_HELD_TEST)
RELEASABLE_STATES = (S_HELD_QUIET,)
TEST_HELD_WHY = "held by test mode — the mock row is its only delivery"

SwitchFn = Callable[[], dict[str, Any]]

_READY: set[str] = set()
_KEYS: dict[str, Any] = {"mtime": None, "path": None, "value": None}


def _connect(dsn: str):
    return hub_db.connect(dsn)


def _ensure(cur, dsn: str) -> None:
    if dsn in _READY:
        return
    for statement in DDL:
        cur.execute(statement)
    _READY.add(dsn)


@contextmanager
def _tx(dsn: str, *, dict_rows: bool = False) -> Iterator[tuple[Any, Any]]:
    try:
        with _connect(dsn) as conn, conn.cursor(
                cursor_factory=psycopg2.extras.RealDictCursor if dict_rows else None) as cur:
            _ensure(cur, dsn)
            yield conn, cur
    except Exception:
        _READY.discard(dsn)
        raise


def _now() -> datetime:
    return datetime.now(UTC)


def _b64url_decode(text: str) -> bytes:
    raw = str(text or "").strip()
    return base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4))


def _sender_missing() -> str:
    try:
        import pywebpush  # noqa: F401, PLC0415
    except Exception as exc:  # noqa: BLE001
        return f"the push library (pywebpush) is not installed ({type(exc).__name__})"
    return ""


def keys(path: Path | str | None = None) -> dict[str, Any]:
    missing = _sender_missing()
    if missing:
        return {"ok": False, "why": missing}
    target = Path(path) if path is not None else VAPID_FILE
    try:
        mtime = target.stat().st_mtime
    except FileNotFoundError:
        return {"ok": False, "why": f"no VAPID keys at {target} — run tools/mint_vapid_keys.py"}
    except OSError as exc:
        return {"ok": False, "why": f"the VAPID key file cannot be read ({type(exc).__name__})"}
    if _KEYS["path"] == str(target) and _KEYS["mtime"] == mtime and _KEYS["value"]:
        return _KEYS["value"]
    try:
        body = json.loads(target.read_text(encoding="utf-8"))
        pub, priv = str(body["public_key"]), str(body["private_key"])
        subject = str(body.get("subject") or "")
        point, scalar = _b64url_decode(pub), _b64url_decode(priv)
    except Exception as exc:  # noqa: BLE001 — a broken file is no keys, said as such
        return {"ok": False, "why": f"the VAPID key file is not usable ({type(exc).__name__})"}
    if len(point) != 65 or point[0] != 4:
        return {"ok": False, "why": "the VAPID public key is not an uncompressed P-256 point"}
    if len(scalar) != 32:
        return {"ok": False, "why": "the VAPID private key is not a 32-byte P-256 scalar"}
    if not (subject.startswith("mailto:") or subject.startswith("https://")):
        return {"ok": False, "why": "the VAPID subject must be a mailto: or https:// address"}
    value = {"ok": True, "public_key": pub.rstrip("="), "private_key": priv.rstrip("="),
             "subject": subject, "why": ""}
    _KEYS.update({"path": str(target), "mtime": mtime, "value": value})
    return value


def public_key(path: Path | str | None = None) -> str | None:
    got = keys(path)
    return got["public_key"] if got.get("ok") else None


# any other endpoint is refused so the relay cannot be pointed elsewhere
PUSH_HOSTS = tuple(h.strip().lower() for h in os.getenv(
    "HUB_WEBPUSH_HOSTS",
    "fcm.googleapis.com,android.googleapis.com,push.services.mozilla.com,push.apple.com,notify.windows.com",
).split(",") if h.strip())


def _push_host(endpoint: str) -> bool:
    host = urllib.parse.urlsplit(endpoint).hostname or ""
    return any(host == h or host.endswith("." + h) for h in PUSH_HOSTS)


def _canonical_endpoint(endpoint: str) -> str | None:
    """Anything two URL parsers could disagree about is refused."""
    if "\\" in endpoint or "@" in endpoint or "#" in endpoint:
        return None
    try:
        parts = urllib.parse.urlsplit(endpoint)
        port = parts.port
    except ValueError:
        return None
    if parts.scheme != "https" or parts.username or parts.password or parts.fragment:
        return None
    if port not in (None, 443):
        return None
    host = (parts.hostname or "").strip().lower()
    if not host or not re.fullmatch(r"[a-z0-9.-]+", host):
        return None
    rebuilt = urllib.parse.urlunsplit(("https", host, parts.path or "/", parts.query, ""))
    try:
        from urllib3.util import parse_url  # noqa: PLC0415 — the sender's own parser, when installed
    except Exception:  # noqa: BLE001
        return rebuilt
    try:
        theirs = parse_url(rebuilt)
    except Exception:  # noqa: BLE001
        return None
    if (theirs.host or "").lower() != host or theirs.port not in (None, 443) or theirs.auth:
        return None
    return rebuilt


def clean_subscription(raw: Any) -> dict[str, str] | None:
    if not isinstance(raw, dict):
        return None
    endpoint = str(raw.get("endpoint") or "").strip()
    got_keys = raw.get("keys") if isinstance(raw.get("keys"), dict) else {}
    p256dh, auth = str(got_keys.get("p256dh") or "").strip(), str(got_keys.get("auth") or "").strip()
    if not endpoint.startswith("https://") or len(endpoint) > 2048 or re.search(r"\s", endpoint):
        return None
    endpoint = _canonical_endpoint(endpoint) or ""
    if not endpoint or not _push_host(endpoint):
        return None
    try:
        if len(_b64url_decode(p256dh)) != 65 or len(_b64url_decode(auth)) != 16:
            return None
    except Exception:  # noqa: BLE001
        return None
    return {"endpoint": endpoint, "p256dh": p256dh, "auth": auth}


def subscribe(dsn: str, *, uid: str, role: str, sub: dict[str, str], ua: str = "") -> dict[str, Any]:
    uid = str(uid or "").strip()
    if not uid:
        raise ValueError("a device is kept for an account, and this session carries none")
    with _tx(dsn) as (conn, cur):
        cur.execute(
            "INSERT INTO asa_hub_push_subs (endpoint, user_id, p256dh, auth, role, ua) "
            "VALUES (%s,%s,%s,%s,%s,%s) ON CONFLICT (endpoint) DO UPDATE SET "
            "user_id=EXCLUDED.user_id, p256dh=EXCLUDED.p256dh, auth=EXCLUDED.auth, "
            "role=EXCLUDED.role, ua=EXCLUDED.ua, seen_at=now(), fails=0 "
            "RETURNING (xmax = 0) AS fresh",
            (sub["endpoint"], uid, sub["p256dh"], sub["auth"], str(role or "")[:40], str(ua or "")[:300]))
        fresh = bool((cur.fetchone() or [False])[0])
        cur.execute(
            "DELETE FROM asa_hub_push_subs WHERE user_id=%s AND endpoint IN ("
            "SELECT endpoint FROM asa_hub_push_subs WHERE user_id=%s "
            "ORDER BY seen_at DESC OFFSET %s)", (uid, uid, DEVICES_PER_ACCOUNT))
        cur.execute("SELECT count(*) FROM asa_hub_push_subs WHERE user_id=%s", (uid,))
        devices = int(cur.fetchone()[0])
        conn.commit()
    return {"kept": True, "fresh": fresh, "devices": devices}


def unsubscribe(dsn: str, *, uid: str, endpoint: str) -> int:
    raw = str(endpoint or "")
    with _tx(dsn) as (conn, cur):
        cur.execute("DELETE FROM asa_hub_push_subs WHERE endpoint = ANY(%s) AND user_id=%s",
                    (sorted({raw, _canonical_endpoint(raw) or raw}), str(uid or "")))
        gone = cur.rowcount
        conn.commit()
    return int(gone or 0)


def devices(dsn: str) -> dict[str, list[dict[str, Any]]]:
    with _tx(dsn, dict_rows=True) as (conn, cur):
        cur.execute("SELECT endpoint, user_id, p256dh, auth FROM asa_hub_push_subs ORDER BY seen_at DESC")
        rows = [dict(r) for r in cur.fetchall()]
        conn.commit()
    out: dict[str, list[dict[str, Any]]] = {}
    for r in rows:
        out.setdefault(str(r["user_id"]), []).append(r)
    return out


def _forget_device(cur, endpoint: str, status: int | None) -> None:
    cur.execute("DELETE FROM asa_hub_push_subs WHERE endpoint=%s", (endpoint,))
    log.info("web push: a device answered %s and was forgotten", status)


URGENT_KINDS = ("call_off", "open_shift")


def is_urgent(copy: dict[str, Any]) -> bool:
    """Must match noticesApi.isUrgentNotice."""
    return (str(copy.get("kind") or "") in URGENT_KINDS and copy.get("tone") == "urgent"
            and copy.get("priority") == "high")


def wants_push(copy: dict[str, Any] | None, *, live: bool) -> bool:
    if not copy or copy.get("held") or copy.get("priority") != "high":
        return False
    if copy.get("role") == "staff":
        return False
    return (not live) or is_urgent(copy)


def _instant(raw: Any) -> datetime | None:
    return web_notices._at(raw)  # noqa: SLF001 — the notices' own reader of a stamp


def still_news(notice: dict[str, Any], copy: dict[str, Any], now: datetime) -> tuple[bool, str]:
    ends = _instant(copy.get("expires_at"))
    if ends is not None and ends <= now:
        return False, "its invitation closed while it was held"
    if str(notice.get("kind") or "") in URGENT_KINDS:
        start = _instant(((notice.get("facts") or {}).get("shift_start")))
        if start is not None and start <= now:
            return False, "its shift started while it was held"
    published = _instant(notice.get("published_at")) or _instant(notice.get("at"))
    if published is not None and now - published > timedelta(hours=HELD_MAX_H):
        return False, f"it is older than {HELD_MAX_H:g} hours"
    return True, ""


def payload_of(notice: dict[str, Any], copy: dict[str, Any]) -> dict[str, Any]:
    value, col_iso = str(notice.get("value") or copy.get("shift") or ""), str(copy.get("col_iso") or "")
    return {"v": 1, "id": int(copy["id"]), "tag": f"srv-{int(copy['id'])}",
            "title": web_gate.spelled(copy.get("title") or "", value, col_iso)[:200],
            "body": web_gate.spelled(copy.get("body") or "", value, col_iso)[:600],
            "href": str(copy.get("href") or ""), "urgent": is_urgent(copy),
            "kind": str(copy.get("kind") or ""), "at": str(copy.get("published_at") or copy.get("at") or "")}


def ttl_of(notice: dict[str, Any], copy: dict[str, Any], now: datetime) -> int:
    until = _instant(copy.get("expires_at"))
    if until is None and str(notice.get("kind") or "") in URGENT_KINDS:
        until = _instant(((notice.get("facts") or {}).get("shift_start")))
    seconds = (until - now).total_seconds() if until is not None else 4 * 3600
    return int(max(60, min(86400, seconds)))


def send_one(device: dict[str, Any], payload: dict[str, Any], *, vapid: dict[str, Any], ttl: int,
             urgent: bool) -> tuple[str, int | None, str]:
    from pywebpush import WebPushException, webpush  # noqa: PLC0415 — keys() said it is installed
    try:
        resp = webpush(
            subscription_info={"endpoint": device["endpoint"],
                               "keys": {"p256dh": device["p256dh"], "auth": device["auth"]}},
            data=json.dumps(payload, separators=(",", ":")),
            vapid_private_key=vapid["private_key"],
            vapid_claims={"sub": vapid["subject"]},
            ttl=ttl, timeout=SEND_TIMEOUT_S,
            headers={"Urgency": "high" if urgent else "normal"})
    except WebPushException as exc:
        status = getattr(getattr(exc, "response", None), "status_code", None)
        if status in (404, 410):
            return "gone", status, "the push service says this device is gone"
        return "failed", status, f"the push service answered {status}"
    except Exception as exc:  # noqa: BLE001 — a device that cannot be reached is a failure, said
        return "failed", None, f"the push service could not be reached ({type(exc).__name__})"
    status = getattr(resp, "status_code", None)
    if isinstance(status, int) and 200 <= status < 300:
        return "ok", status, ""
    return "failed", status, f"the push service answered {status}"


Sender = Callable[..., tuple[str, int | None, str]]


def _push_to_devices(cur, uid: str, notice: dict[str, Any], copy: dict[str, Any],
                     devs: list[dict[str, Any]], *, vapid: dict[str, Any], now: datetime,
                     sender: Sender) -> tuple[str, int, str]:
    if not devs:
        return S_NO_DEVICE, 0, "no device of theirs is kept"
    return _send_all(cur, devs, payload_of(notice, copy), vapid=vapid, ttl=ttl_of(notice, copy, now),
                     urgent=is_urgent(copy), sender=sender)


def _send_all(cur, devs: list[dict[str, Any]], payload: dict[str, Any], *, vapid: dict[str, Any], ttl: int,
              urgent: bool, sender: Sender) -> tuple[str, int, str]:
    """One payload to each device, each device's answer kept; a device the service calls gone is forgotten."""
    took, whys, gone = 0, [], 0
    for dev in devs:
        outcome, status, why = sender(dev, payload, vapid=vapid, ttl=ttl, urgent=urgent)
        if outcome == "ok":
            took += 1
            cur.execute("UPDATE asa_hub_push_subs SET last_ok_at=now(), last_status=%s, fails=0 "
                        "WHERE endpoint=%s", (status, dev["endpoint"]))
        elif outcome == "gone":
            gone += 1
            _forget_device(cur, dev["endpoint"], status)
        else:
            whys.append(why)
            cur.execute("UPDATE asa_hub_push_subs SET last_status=%s, fails=fails+1 WHERE endpoint=%s",
                        (status, dev["endpoint"]))
    if took:
        return S_SENT, took, ""
    if gone == len(devs):
        return S_NO_DEVICE, 0, "every device of theirs was gone"
    return S_FAILED, 0, "; ".join(sorted(set(whys)))[:300]


def _clock_of(now: datetime | None) -> Callable[[], datetime]:
    return (lambda: now) if now is not None else _now


def _held_now(switch_fn: SwitchFn | None) -> dict[str, Any] | None:
    if switch_fn is None:
        return None
    try:
        got = switch_fn()
    except Exception as exc:  # noqa: BLE001
        return {"on": True, "readable": False, "word": "unreadable",
                "why": f"the switch could not be read ({type(exc).__name__})"}
    return got if isinstance(got, dict) else {"on": True, "readable": False, "word": "unreadable",
                                              "why": "the switch reader answered nothing"}


def deliver(dsn: str, notice: dict[str, Any], candidates: Iterable[tuple[str, dict[str, Any]]], *,
            switch: dict[str, Any], now: datetime | None = None,
            vapid: dict[str, Any] | None = None, sender: Sender | None = None,
            devs: dict[str, list[dict[str, Any]]] | None = None,
            switch_fn: SwitchFn | None = None) -> dict[str, Any]:
    clock = _clock_of(now)
    now = clock()
    sender = sender or send_one
    out: dict[str, Any] = {"by_state": {}, "skipped": 0, "why": ""}
    candidates = [(str(u), c) for u, c in candidates if u and c]
    if not candidates:
        return out
    held_test = bool(switch.get("on"))
    night = (not held_test) and web_gate.quiet(now)
    vapid = vapid if vapid is not None else keys()
    if not held_test and not night and not vapid.get("ok"):
        out["skipped"], out["why"] = len(candidates), vapid.get("why") or "no VAPID keys"
        return out
    with _tx(dsn) as (conn, cur):
        if devs is None and not held_test and not night:
            cur.execute("SELECT endpoint, user_id, p256dh, auth FROM asa_hub_push_subs")
            devs = {}
            for endpoint, uid, p256dh, auth in cur.fetchall():
                devs.setdefault(str(uid), []).append({"endpoint": endpoint, "user_id": uid,
                                                      "p256dh": p256dh, "auth": auth})
        for uid, copy in candidates:
            if not held_test and not night:
                again = _held_now(switch_fn)
                if again is not None and again.get("on"):
                    held_test, switch = True, again
                elif web_gate.quiet(clock()):
                    night = True
            words = json.dumps(payload_of(notice, copy), default=str)
            if held_test or night:
                state = S_HELD_TEST if held_test else S_HELD_QUIET
                held_by = (web_gate.held_by_test(switch) if held_test
                           else f"held: the quiet window ({web_gate.quiet_words()})")
                cur.execute(
                    "INSERT INTO asa_hub_push_outbox (notice_id, user_id, state, held_by, words) "
                    "VALUES (%s,%s,%s,%s,%s) ON CONFLICT DO NOTHING RETURNING 1",
                    (int(notice["id"]), uid, state, held_by, words))
                if cur.fetchone():
                    out["by_state"].setdefault(state, []).append((uid, copy))
                continue
            cur.execute(
                "INSERT INTO asa_hub_push_outbox (notice_id, user_id, state, words, tries) "
                "VALUES (%s,%s,%s,%s,1) ON CONFLICT DO NOTHING RETURNING 1",
                (int(notice["id"]), uid, S_SENDING, words))
            if not cur.fetchone():
                continue
            conn.commit()
            state, took, why = _push_to_devices(cur, uid, notice, copy, (devs or {}).get(uid) or [],
                                                vapid=vapid, now=now, sender=sender)
            cur.execute(
                "UPDATE asa_hub_push_outbox SET state=%s, devices=%s, why=%s, updated_at=now(), "
                "sent_at=CASE WHEN %s THEN now() ELSE sent_at END WHERE notice_id=%s AND user_id=%s",
                (state, took, why, state == S_SENT, int(notice["id"]), uid))
            out["by_state"].setdefault(state, []).append((uid, copy))
        conn.commit()
    return out


def defer(dsn: str, notice: dict[str, Any], items: Iterable[tuple[str, str]]) -> set[str]:
    written: set[str] = set()
    items = [(str(u), str(w or "")) for u, w in items if u]
    if not items:
        return written
    with _tx(dsn) as (conn, cur):
        for uid, why in items:
            cur.execute(
                "INSERT INTO asa_hub_push_outbox (notice_id, user_id, state, why, tries, updated_at) "
                "VALUES (%s,%s,%s,%s,0, now() - make_interval(secs => %s)) "
                "ON CONFLICT DO NOTHING RETURNING 1",
                (int(notice["id"]), uid, S_FAILED, f"could not be judged ({why})"[:300], RETRY_S + 1))
            if cur.fetchone():
                written.add(uid)
        conn.commit()
    return written


Judge = Callable[[dict[str, Any], str], "dict[str, Any] | None"]


def release(dsn: str, *, switch: dict[str, Any], judge: Judge, now: datetime | None = None,
            vapid: dict[str, Any] | None = None, sender: Sender | None = None,
            limit: int = 200, switch_fn: SwitchFn | None = None) -> dict[str, Any]:
    clock = _clock_of(now)
    now = clock()
    sender = sender or send_one
    out: dict[str, Any] = {"by_state": {}, "expired": [], "waiting": 0, "why": ""}
    if switch.get("on"):
        out["why"] = "test mode is on"
        return out
    if web_gate.quiet(now):
        out["why"] = "the quiet window"
        return out
    vapid = vapid if vapid is not None else keys()
    if not vapid.get("ok"):
        out["why"] = vapid.get("why") or "no VAPID keys"
        return out
    with _tx(dsn, dict_rows=True) as (conn, cur):
        for statement in web_notices.DDL:
            cur.execute(statement)
        cur.execute(
            "UPDATE asa_hub_push_outbox SET state=%s, tries=%s, updated_at=now(), "
            "why='the relay stopped while sending it; whether it reached the device is not known' "
            "WHERE state=%s AND updated_at < %s",
            (S_FAILED, MAX_TRIES, S_SENDING, now - timedelta(minutes=10)))
        cur.execute(
            "UPDATE asa_hub_push_outbox SET state=%s, why=%s, updated_at=now() WHERE state=%s "
            "RETURNING user_id", (S_EXPIRED, TEST_HELD_WHY, S_HELD_TEST))
        out["expired"] += [(str(r["user_id"]), TEST_HELD_WHY) for r in cur.fetchall()]
        conn.commit()
        cur.execute(
            "SELECT o.notice_id, o.user_id, o.state, o.tries, "
            "n.id, n.key, n.kind, n.at, n.location, n.col_iso, n.ref, n.value, n.facts, n.created_at, "
            "n.held_test, r.read_at, r.dismissed_at "
            "FROM asa_hub_push_outbox o JOIN asa_hub_notices n ON n.id = o.notice_id "
            "LEFT JOIN asa_hub_notice_reads r ON r.user_id = o.user_id AND r.notice_id = o.notice_id "
            "WHERE o.state = ANY(%s) OR (o.state = %s AND o.tries < %s AND o.updated_at < %s) "
            "ORDER BY o.created_at LIMIT %s",
            (list(RELEASABLE_STATES), S_FAILED, MAX_TRIES, now - timedelta(seconds=RETRY_S), limit))
        rows = [dict(r) for r in cur.fetchall()]
        cur.execute("SELECT endpoint, user_id, p256dh, auth FROM asa_hub_push_subs")
        devs: dict[str, list[dict[str, Any]]] = {}
        for d in cur.fetchall():
            devs.setdefault(str(d["user_id"]), []).append(dict(d))
        for r in rows:
            uid, nid = str(r["user_id"]), int(r["notice_id"])
            notice = web_notices._row_notice(r)  # noqa: SLF001 — the notices' own row shape

            def let_go(why: str) -> None:
                cur.execute("UPDATE asa_hub_push_outbox SET state=%s, why=%s, updated_at=now() "
                            "WHERE notice_id=%s AND user_id=%s", (S_EXPIRED, why, nid, uid))
                out["expired"].append((uid, why))

            again = _held_now(switch_fn)
            if again is not None and again.get("on"):
                out["why"] = "test mode went on during the release"
                break
            if web_gate.quiet(clock()):
                out["why"] = "the quiet window began during the release"
                break
            if notice.get("held"):
                let_go(TEST_HELD_WHY)
                continue
            if r.get("read_at") or r.get("dismissed_at"):
                let_go("read in the bell before the hold ended")
                continue
            published = _instant(notice.get("published_at")) or _instant(notice.get("at"))
            if published is not None and now - published > timedelta(hours=HELD_MAX_H):
                let_go(f"it is older than {HELD_MAX_H:g} hours")
                continue
            try:
                copy = judge(notice, uid)
            except Exception as exc:  # noqa: BLE001 — one person's question waits for the next beat
                log.warning("web push: %s could not be judged again for one reader (%s)",
                            notice.get("key"), type(exc).__name__)
                out["waiting"] += 1
                continue
            if not copy:
                let_go("it is no longer theirs to hear")
                continue
            if not wants_push(copy, live=False):
                let_go("their copy does not interrupt — it waits in the bell")
                continue
            fine, why = still_news(notice, copy, now)
            if not fine:
                let_go(why)
                continue
            cur.execute("UPDATE asa_hub_push_outbox SET state=%s, tries=tries+1, updated_at=now() "
                        "WHERE notice_id=%s AND user_id=%s AND state=%s",
                        (S_SENDING, nid, uid, r["state"]))
            if cur.rowcount != 1:
                continue
            conn.commit()
            state, took, why = _push_to_devices(cur, uid, notice, copy, devs.get(uid) or [],
                                                vapid=vapid, now=now, sender=sender)
            cur.execute(
                "UPDATE asa_hub_push_outbox SET state=%s, devices=%s, why=%s, updated_at=now(), "
                "words=%s, sent_at=CASE WHEN %s THEN now() ELSE sent_at END "
                "WHERE notice_id=%s AND user_id=%s",
                (state, took, why, json.dumps(payload_of(notice, copy), default=str),
                 state == S_SENT, nid, uid))
            out["by_state"].setdefault(state, []).append((uid, copy, notice))
        conn.commit()
    return out


# A chat message (server/chat_push.py): no outbox row, nothing released later, and never the words.

# how long a push service may keep one for a device that is off: never into the quiet window
CHAT_TTL_S = int(os.getenv("HUB_WEBPUSH_CHAT_TTL_S", "3600"))


def devices_for(dsn: str, uids: Iterable[str]) -> list[dict[str, Any]]:
    """The devices kept for these accounts, newest first."""
    ids = sorted({str(u).strip() for u in uids if str(u or "").strip()})
    if not ids:
        return []
    with _tx(dsn, dict_rows=True) as (conn, cur):
        cur.execute("SELECT endpoint, user_id, p256dh, auth FROM asa_hub_push_subs WHERE user_id = ANY(%s) "
                    "ORDER BY seen_at DESC", (ids,))
        rows = [dict(r) for r in cur.fetchall()]
        conn.commit()
    return rows


def chat_ttl(now: datetime) -> int:
    import psi_reminders  # noqa: PLC0415 — the window has one home on this relay
    until = (psi_reminders.quiet_begins(now) - now).total_seconds()
    return int(max(0, min(CHAT_TTL_S, until)))


def push_chat(dsn: str, devs: list[dict[str, Any]], payload: dict[str, Any], *, vapid: dict[str, Any],
              ttl: int, sender: Sender | None = None) -> tuple[str, int, str]:
    """One chat push to these devices: (sent | failed | no_device, how many took it, why)."""
    if not devs:
        return S_NO_DEVICE, 0, "no device of theirs is kept"
    with _tx(dsn) as (conn, cur):
        got = _send_all(cur, devs, payload, vapid=vapid, ttl=ttl, urgent=False, sender=sender or send_one)
        conn.commit()
    return got
