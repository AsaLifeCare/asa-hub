"""PSIANYWHERE — IS IT UP, PROVED, AND PROVED WITHOUT ACCUSING THEM OF OUR OWN WEATHER.
WHAT THIS ANSWERS, AND FOR WHOM.

The relay's server/psi_anywhere.py, run in the app, the one process that signs in: the login plan and its latch are
the same file (/srv/snapshot/.psi-login-clock.json). While the credential it signs in with is not mounted here
(`unmounted`), no login is claimed and the clock is never written, so a latch it holds is never lifted from here."""
from __future__ import annotations

import asyncio
import errno
import hashlib
import json
import logging
import os
import re
import socket
import ssl
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

log = logging.getLogger("asa-hub-app.psi")

# THE SERVICE, ON THE PORT THAT ANSWERS.
PSI_BASE = os.getenv("HUB_PSI_BASE", "https://abrighterdawn.psianywhere.com").rstrip("/")
PSI_PAGE_PATH = "/"
PSI_WEBROOT_PATH = "/webroot/"
PSI_SERVICE_PATH = "/service/Anywhere.svc/getLogIn/"
# The login page's own marks.
PSI_PAGE_MARKS = ('id="loginBtn"', 'id="username"')
# The application's own grammar. Its refusal and its acceptance both carry it.
PSI_SERVICE_MARK = "<window_name>"
# WHAT MAKES AN ANSWER THEIRS.
PSI_THEIR_MARKS = ("psianywhere", "anywhere.svc", 'id="loginbtn"', 'id="username"', "<window_name>")
PSI_THEIR_STACK = ("microsoft-iis", "asp.net", "aspnet")
# An answer that announces a failure in a server's own words.
PSI_FAILURE_WORDS = ("internal server error", "service unavailable", "bad gateway",
                     "http error 5", "server error in ", "temporarily unavailable",
                     "under maintenance", "site is down")
# The switch.
PSI_ARMED = os.getenv("HUB_PSI_PROBE", "1").strip().lower() not in ("0", "no", "off", "false")
# The credential for the third rung, in the shape the seal mount already uses for the webhook key: a file, re-read…
PSI_SECRET_FILE = Path(os.getenv("HUB_PSI_SECRET_FILE", "/srv/secrets/psianywhere.json"))
# THE SECOND ACCOUNT, in the same shape and read the same way.
PSI_TY_SECRET_FILE = Path(os.getenv("HUB_PSI_TY_SECRET_FILE", "/srv/secrets/psianywhere-ty.json"))
ACCOUNTS = ("adm", "ty")
ACCOUNT_LABELS = {"adm": "ADM", "ty": "Ty"}
# At most this many Ty tries a New York day, counted on this clock.
PSI_TY_TRIES_PER_DAY = int(os.getenv("HUB_PSI_TY_TRIES_PER_DAY", "2"))
NEW_YORK = ZoneInfo("America/New_York")
# One rung's own ceiling, and the whole check's.
PSI_RUNG_TIMEOUT_S = float(os.getenv("HUB_PSI_RUNG_TIMEOUT_S", "1.5"))
PSI_CONNECT_TIMEOUT_S = float(os.getenv("HUB_PSI_CONNECT_TIMEOUT_S", "1.0"))
PSI_BUDGET_S = float(os.getenv("HUB_PSI_BUDGET_S", "2.0"))
# THE CEILINGS THE CALLERS PUT ON US.
PSI_FAST_WAIT_S = float(os.getenv("HUB_PSI_FAST_WAIT_S", "2.0"))
PSI_DOOR_WAIT_S = float(os.getenv("HUB_PSI_DOOR_WAIT_S", "3.0"))
# How long each word is held.
PSI_HOLD_UP_S = float(os.getenv("HUB_PSI_HOLD_UP_S", "120"))
PSI_HOLD_DOWN_S = float(os.getenv("HUB_PSI_HOLD_DOWN_S", "60"))
PSI_HOLD_UNKNOWN_S = float(os.getenv("HUB_PSI_HOLD_UNKNOWN_S", "30"))
# THE RATION ON THE ONE RUNG THAT IS A LOGIN.
PSI_LOGIN_GAP_S = float(os.getenv("HUB_PSI_LOGIN_GAP_S", "300"))
PSI_LOGIN_BRAKE_AFTER = int(os.getenv("HUB_PSI_LOGIN_BRAKE_AFTER", "2"))
PSI_LOGIN_BRAKE_S = float(os.getenv("HUB_PSI_LOGIN_BRAKE_S", "1800"))
# THE ACCOUNT SAID NO.
PSI_LOGIN_REFUSED_REST_S = float(os.getenv("HUB_PSI_LOGIN_REFUSED_REST_S", "86400"))
# DOWN'S HEALTH RETRY.
PSI_DOWN_RETRY_S = float(os.getenv("HUB_PSI_DOWN_RETRY_S", "1800"))
# THE ONE WIRE.
PSI_WIRE_GAP_S = float(os.getenv("HUB_PSI_WIRE_GAP_S", "1.5"))
# Where that clock is kept between processes: the relay's own writable disk.
PSI_LOGIN_CLOCK_FILE = Path(os.getenv(
    "HUB_PSI_LOGIN_CLOCK_FILE",
    str(Path(os.getenv("HUB_SNAPSHOT_OUT", "/srv/snapshot")) / ".psi-login-clock.json")))

# THE ONE HEADER PAIR THE SERVICE WANTS.
PSI_SERVICE_HEADERS = {"Content-Type": "application/json; charset=utf-8",
                       "X-Requested-With": "XMLHttpRequest"}

_STATES = ("up", "down", "unknown")
# A rung's word, and what each one is allowed to cost them: up their own voice refused the far side refused, reset…
_WORD_UP, _WORD_REFUSED, _WORD_FAILING = "up", "refused", "failing"
_WORD_STRANGER, _WORD_UNKNOWN = "stranger", "unknown"
# The errnos that mean the far side, or the road to it, said no.
_REFUSED_ERRNOS = {getattr(errno, name) for name in
                   ("ECONNREFUSED", "ECONNRESET", "ECONNABORTED", "EHOSTUNREACH",
                    "ENETUNREACH", "EHOSTDOWN", "ENETDOWN")
                   if getattr(errno, name, None) is not None}

_held: dict[str, Any] = {"at": 0.0, "verdict": None}
_flight: asyncio.Lock | None = None
_secret_state: dict[str, dict[str, Any]] = {
    a: {"stamp": None, "user": "", "hash": "", "said": None} for a in ACCOUNTS}


def _ty_blank() -> dict[str, Any]:
    """Ty's side of the clock: the New York day it counts, its tries and every login on it that day, and the last…"""
    return {"day": "", "tries": 0, "attempts": 0, "last_at": 0.0, "last_answer": ""}


# The third rung's own clock, deliberately OUTSIDE the verdict cache: dropping the held verdict must never buy…
_login_state: dict[str, Any] = {"at": 0.0, "misses": 0, "rested_until": 0.0, "refused": None,
                                 "refused_ty": None, "paused_until": 0.0, "paused_why": "",
                                 "account": "adm", "ty": _ty_blank(), "down": None}
# ONE ACCOUNT, ONE CLOCK.
_login_lock = threading.Lock()
# THE WIRE: held for the length of one request, so two can never be in flight.
_wire_lock = threading.Lock()
_wire_last: dict[str, float] = {"at": 0.0}


# ── the words of a call, and the one question this module asks of them ────── GATE A ONLY, AND DELIBERATELY WIDER…
_PSI_WORDS = re.compile(
    r"psi\s*anywhere|psy\s*anywhere|psianywhere|psyanywhere|\bpsi\b|\bpsy\b|"
    r"time\s*entr(?:y|ies)|"
    r"\banywhere\b[^.?!]{0,60}(?:log\s?in|logged|login|password|clock|punch|time\s?sheet|timesheet)|"
    r"(?:log\s?in|logged|login|password|clock|punch|time\s?sheet|timesheet)[^.?!]{0,60}\banywhere\b",
    re.IGNORECASE)


def sniff(text: str) -> bool:
    """Could these words be about PsiAnywhere? Gate A, and nothing more."""
    return bool(_PSI_WORDS.search(str(text or "")))


def dialogue_text(turns: Any) -> str:
    """The spoken words of a hotline dialogue, joined — content only, never a number, an identifier or a user id."""
    if not isinstance(turns, list):
        return ""
    return " ".join(str(t.get("content") or "") for t in turns if isinstance(t, dict))


def armed() -> bool:
    """Is the probe switched on? Nothing else here says anything about PSI."""
    return PSI_ARMED


# ── the credential, read the way the webhook key is read ───────────────────

def _account(account: str | None) -> str:
    return account if account in ACCOUNTS else "adm"


def _secret_file(account: str) -> Path:
    return PSI_TY_SECRET_FILE if account == "ty" else PSI_SECRET_FILE


def _read_credential(account: str) -> tuple[str, str]:
    """(userId, hash) from one account's secret file, or ('', '')."""
    account = _account(account)
    state = _secret_state[account]
    path = _secret_file(account)
    try:
        st = path.stat()
        stamp: tuple[int, int] | None = (int(st.st_mtime_ns), int(st.st_size))
    except OSError:
        stamp = None
    if stamp is None:
        state.update(stamp=None, user="", hash="")
    elif stamp != state["stamp"]:
        user = password = ""
        try:
            got = json.loads(path.read_text(encoding="utf-8") or "{}")
            if isinstance(got, dict):
                user = str(got.get("user") or "").strip()
                password = str(got.get("pass") or "").strip()
        except (OSError, ValueError):
            user = password = ""
        state.update(stamp=stamp,
                     user=user,
                     # The plain password never leaves this function.
                     hash=hashlib.md5(password.encode()).hexdigest() if (user and password) else "")
    said = bool(state["hash"])
    if said != state["said"]:
        state["said"] = said
        if account == "adm":
            log.info("psi anywhere: the ADM account %s",
                     "has a credential" if said else "has no credential — no login will be sent")
        else:
            log.info("psi anywhere: the Ty account %s",
                     "has a credential — its tries are armed" if said
                     else "has no credential file — its tries are idle")
    return str(state["user"] or ""), str(state["hash"] or "")


def active_account() -> str:
    """The account the lane signs in with: Ty once a Ty try signed in, ADM otherwise — and ADM whenever Ty's file…"""
    acct = _account(str(_login_state.get("account") or "adm"))
    if acct == "ty" and not _read_credential("ty")[1]:
        return "adm"
    return acct


def _credential(account: str | None = None) -> tuple[str, str]:
    """(userId, hash) for `account`, or for the active account."""
    return _read_credential(_account(account) if account else active_account())


def credential_present(account: str | None = None) -> bool:
    """Whether that account (the active one by default) could sign in."""
    return bool(_credential(account)[1])


# ── the credential mounted here, or nothing here signs in ─────────────────

_UNMOUNTED_SAID: dict[str, str] = {"why": ""}


def unmounted() -> str:
    """Why this process may neither sign in nor write the login clock ('' when it may): the ADM credential file is not
    mounted here, or the clock names the Ty line and Ty's file is not. Said once per reason."""
    why = ""
    if not PSI_SECRET_FILE.is_file():
        why = f"the PsiAnywhere credential is not mounted in this container ({PSI_SECRET_FILE})"
    elif _account(str(_login_state.get("account") or "adm")) == "ty" and not PSI_TY_SECRET_FILE.is_file():
        why = (f"the login clock names the Ty line and its credential is not mounted in this container "
               f"({PSI_TY_SECRET_FILE})")
    if why != _UNMOUNTED_SAID["why"]:
        _UNMOUNTED_SAID["why"] = why
        if why:
            log.warning("psi anywhere: %s — no login is sent and the login clock is not written from here", why)
        else:
            log.info("psi anywhere: the credential is mounted here — the login plan runs in this process")
    return why


# ── the ration on the third rung ───────────────────────────────────────────

def _refused_key(account: str) -> str:
    """Where an account's latch lives on the clock: `refused` is the ADM's (the name it had before there were…"""
    return "refused_ty" if account == "ty" else "refused"


def _ny_day(now: float) -> str:
    return datetime.fromtimestamp(now, NEW_YORK).date().isoformat()


def _ty_today(now: float) -> dict[str, Any]:
    """Ty's record for today's New York day — a new day starts from zero."""
    ty = _login_state.get("ty")
    if not isinstance(ty, dict):
        ty = _ty_blank()
    day = _ny_day(now)
    if ty.get("day") != day:
        ty = dict(_ty_blank(), day=day, last_at=float(ty.get("last_at") or 0.0),
                  last_answer=str(ty.get("last_answer") or ""))
    _login_state["ty"] = ty
    return ty


def _not_active(word: Any) -> bool:
    return str(word or "").strip().lower().startswith("not active")


def _login_allowed(now: float, account: str = "adm", purpose: str = "") -> tuple[bool, str]:
    """May a login on `account` go right now, for `purpose`?"""
    account = _account(account)
    held_here = unmounted()
    if held_here:
        return False, held_here
    if account == "ty" and purpose != "ty_try" \
            and _account(str(_login_state.get("account") or "adm")) != "ty":
        return False, ("a login on the Ty account goes only as one of its twice-daily tries, or "
                       "while Ty is the line the lane reads with")
    key = _refused_key(account)
    refused = _login_state.get(key)
    if refused:
        lifts = float(refused.get("at") or 0.0) + PSI_LOGIN_REFUSED_REST_S
        if refused.get("stamp") != _secret_stamp(account):
            _login_state[key] = None
            _persist()
            log.info("psi anywhere: the %s credential file changed — the account's refusal (%r) "
                     "is lifted", ACCOUNT_LABELS[account], refused.get("word"))
        elif now < lifts and not (purpose == "ty_try" and _not_active(refused.get("word"))):
            return False, (f"the {ACCOUNT_LABELS[account]} account refused the last login "
                           f"({refused.get('word')!r}) — no login on it until its credential file "
                           f"changes or {datetime.fromtimestamp(lifts, timezone.utc):%Y-%m-%d %H:%M}Z")
    # A SERVICE THAT IS DOWN IS NOT SIGNED IN TO EITHER.
    held = _paused_why(now)
    if held:
        return False, held
    if now < float(_login_state["rested_until"] or 0.0):
        return False, "the credentialed check is resting after tries that settled nothing"
    if account == "ty" and purpose == "ty_try":
        tries = int(_ty_today(now).get("tries") or 0)
        if tries >= PSI_TY_TRIES_PER_DAY:
            return False, (f"the Ty account was tried {tries} time(s) today — at most "
                           f"{PSI_TY_TRIES_PER_DAY} a day")
    last = float(_login_state["at"] or 0.0)
    if last and now - last < PSI_LOGIN_GAP_S and purpose != "fallback":
        return False, "the credentialed check runs at most once every few minutes"
    return True, ""


def _login_done(word: str, now: float) -> None:
    """Record the attempt and, when they keep settling nothing, rest the rung."""
    _login_state["at"] = now
    if word in (_WORD_UP, _WORD_REFUSED, _WORD_FAILING):
        _login_state["misses"] = 0
        return
    _login_state["misses"] = int(_login_state["misses"] or 0) + 1
    if _login_state["misses"] >= PSI_LOGIN_BRAKE_AFTER:
        _login_state["misses"] = 0
        _login_state["rested_until"] = now + PSI_LOGIN_BRAKE_S
        log.warning("psi anywhere: the credentialed check rests for %s s — %s tries in a row "
                    "settled nothing, which is not a password's fault",
                    int(PSI_LOGIN_BRAKE_S), PSI_LOGIN_BRAKE_AFTER)


def _secret_stamp(account: str | None = None) -> list[int] | None:
    """An account's credential file's (mtime, size) — what re-saving it moves."""
    try:
        st = _secret_file(_account(account) if account else active_account()).stat()
    except OSError:
        return None
    return [int(st.st_mtime_ns), int(st.st_size)]


def _refuse(word: str, now: float, account: str = "adm") -> None:
    account = _account(account)
    _login_state[_refused_key(account)] = {"word": str(word)[:80], "at": now,
                                           "stamp": _secret_stamp(account)}
    _persist()
    log.warning("psi anywhere: the %s account refused the login (%r) — no login on it from any "
                "lane until its credential file changes, or for %s h", ACCOUNT_LABELS[account],
                str(word)[:80], round(PSI_LOGIN_REFUSED_REST_S / 3600, 1))


def account_word(body: Any) -> str:
    """The service's own word on a getLogIn answer: `Token` when it signed us in, the refusal otherwise ("Not…"""
    text = str(body or "")
    try:
        env = json.loads(text)
        if isinstance(env, dict):
            text = str(env.get("getLogInResult") or "")
    except ValueError:
        pass
    m = re.search(r"<window_name>([^<]*)<\\?/window_name>", text)
    return m.group(1).strip() if m else ""


# ── the one login clock, for every lane that signs in ──────────────────────

def login_would_allow(now: float | None = None, account: str | None = None,
                      purpose: str = "") -> tuple[bool, str]:
    """The ration, asked without taking the slot — for the active account unless one is named."""
    with _login_lock:
        return _login_allowed(time.time() if now is None else now,
                              _account(account) if account else active_account(), purpose)


def login_claim(purpose: str, now: float | None = None,
                account: str | None = None) -> tuple[bool, str]:
    """Take the slot for one login, or say why not."""
    with _login_lock:
        now = time.time() if now is None else now
        account = _account(account) if account else active_account()
        ok, why = _login_allowed(now, account, purpose)
        if ok:
            _login_state["at"] = now
            _login_state["by"] = purpose
            if account == "ty":
                ty = _ty_today(now)
                ty["attempts"] = int(ty.get("attempts") or 0) + 1
                if purpose == "ty_try":
                    ty["tries"] = int(ty.get("tries") or 0) + 1
                ty["last_at"] = now
            # On disk before the request leaves: a restart during the login must not find the slot free and spend…
            _persist()
        return ok, why


def login_settle(word: str, account_word: str, now: float | None = None,
                 account: str | None = None) -> None:
    """What the claimed login came back with: the rung's word, and the account's own word when the service…"""
    with _login_lock:
        now = time.time() if now is None else now
        account = _account(account) if account else active_account()
        key = _refused_key(account)
        _login_done(word, now)
        if account_word == "Token":
            if _login_state.get(key):
                log.info("psi anywhere: the %s account signed in again — its refusal is lifted",
                         ACCOUNT_LABELS[account])
            _login_state[key] = None
        elif account_word:
            _refuse(account_word, now, account)
        if account == "ty":
            _ty_today(now)["last_answer"] = (str(account_word)[:80] if account_word
                                             else f"no answer the lane could read ({word})")
        _persist()


def login_refused(word: str, now: float | None = None, account: str | None = None) -> None:
    """Hold every login on an account (the active one unless named) as if it had just said `word`."""
    with _login_lock:
        _refuse(word, time.time() if now is None else now,
                _account(account) if account else active_account())


def set_active(account: str, why: str = "") -> None:
    """Make `account` the one the lane signs in with, on disk at once."""
    account = _account(account)
    with _login_lock:
        before = _account(str(_login_state.get("account") or "adm"))
        _login_state["account"] = account
        _persist()
    if before != account:
        log.warning("psi anywhere: the lane now signs in as %s (was %s)%s",
                    ACCOUNT_LABELS[account], ACCOUNT_LABELS[before], f" — {why}" if why else "")


def ty_note(answer: str, now: float | None = None) -> None:
    """What Ty's last try came to, when that is more than its login's word — a Token whose session could not read…"""
    with _login_lock:
        _ty_today(time.time() if now is None else now)["last_answer"] = str(answer or "")[:160]
        _persist()


def ty_status(now: float | None = None) -> dict[str, Any]:
    """Ty's day as it stands — never a user name, never a credential."""
    with _login_lock:
        now = time.time() if now is None else now
        ty = dict(_ty_today(now))
        refused = _login_state.get("refused_ty")
    return {"configured": bool(_read_credential("ty")[1]),
            "active": active_account() == "ty",
            "day": ty.get("day") or "", "tries_today": int(ty.get("tries") or 0),
            "attempts_today": int(ty.get("attempts") or 0),
            "tries_per_day": PSI_TY_TRIES_PER_DAY,
            "last_at": (datetime.fromtimestamp(float(ty["last_at"]), timezone.utc)
                        .strftime("%Y-%m-%dT%H:%M:%SZ") if ty.get("last_at") else ""),
            "last_answer": str(ty.get("last_answer") or ""),
            "refused": str((refused or {}).get("word") or "")}


def login_snapshot() -> dict[str, Any]:
    """The last attempt, the refusals, the pause and DOWN, as they stand."""
    account = active_account()
    with _login_lock:
        refused = _login_state.get(_refused_key(account))
        down = _login_state.get("down")
        return {"at": float(_login_state["at"] or 0.0),
                "account": account,
                "refused": dict(refused) if refused else None,
                "refused_by": {a: (dict(_login_state[_refused_key(a)])
                                   if _login_state.get(_refused_key(a)) else None)
                               for a in ACCOUNTS},
                "paused_until": float(_login_state.get("paused_until") or 0.0),
                "paused_why": str(_login_state.get("paused_why") or ""),
                "down": dict(down) if isinstance(down, dict) else None}


# ── DOWN, and the wire, for every request the collection makes ─────────────

def _stamp_utc(ts: float) -> str:
    return f"{datetime.fromtimestamp(ts, timezone.utc):%Y-%m-%d %H:%M}Z"


def _paused_why(now: float) -> str:
    """The sentence a held request carries, or '' when nothing holds it: DOWN until its next health retry — and…"""
    until = float(_login_state.get("paused_until") or 0.0)
    if now < until:
        return (f"PsiAnywhere requests are paused until {_stamp_utc(until)} — "
                f"{_login_state.get('paused_why') or 'a timeout or a failure'}")
    down = _login_state.get("down")
    if isinstance(down, dict) and now < float(down.get("retry_at") or 0.0):
        return (f"PsiAnywhere is down since {_stamp_utc(float(down.get('since') or now))} "
                f"({down.get('why') or 'a read and the login after it both failed'}) — nothing is "
                f"asked of it until the health retry at {_stamp_utc(float(down['retry_at']))}")
    return ""


def paused(now: float | None = None) -> tuple[bool, str]:
    """(held, why) — is every request to PsiAnywhere held right now?"""
    with _login_lock:
        why = _paused_why(time.time() if now is None else now)
        return bool(why), why


def mark_down(why: str, now: float | None = None) -> float:
    """DOWN ITSELF: a read on the kept session failed and the login right after it failed too (or there was no…"""
    with _login_lock:
        now = time.time() if now is None else now
        down = _login_state.get("down") if isinstance(_login_state.get("down"), dict) else None
        first = down is None
        down = dict(down or {"since": now, "retries": 0})
        down.update(why=str(why or "")[:200], retry_at=now + PSI_DOWN_RETRY_S,
                    retries=int(down.get("retries") or 0) + (0 if first else 1), last_at=now)
        _login_state["down"] = down
        _persist()
    if first:
        log.warning("psi anywhere: PsiAnywhere is DOWN — %s; nothing is asked of it until the "
                    "health retry in %s min", str(why or "")[:200], int(PSI_DOWN_RETRY_S / 60))
    else:
        log.info("psi anywhere: still down (retry %s) — %s; the next health retry in %s min",
                 down["retries"], str(why or "")[:200], int(PSI_DOWN_RETRY_S / 60))
    return float(down["retry_at"])


def mark_up(how: str = "", now: float | None = None) -> bool:
    """The first read that landed: DOWN is over. True when it was down."""
    with _login_lock:
        now = time.time() if now is None else now
        down = _login_state.get("down")
        if not isinstance(down, dict):
            return False
        _login_state["down"] = None
        _persist()
    log.warning("psi anywhere: PsiAnywhere is UP again after %s min down — %s",
                int((now - float(down.get("since") or now)) / 60), how or "a read landed")
    return True


def down_state() -> dict[str, Any] | None:
    """DOWN as it stands, or None."""
    with _login_lock:
        down = _login_state.get("down")
        return dict(down) if isinstance(down, dict) else None


def down_retry_due(now: float | None = None) -> bool:
    """Is PsiAnywhere down and its next health retry due?"""
    with _login_lock:
        down = _login_state.get("down")
        return isinstance(down, dict) and (time.time() if now is None else now) >= float(
            down.get("retry_at") or 0.0)


class wire:  # noqa: N801 — used as `with psi_anywhere.wire():`
    """ONE REQUEST AT A TIME, AND A BREATH BETWEEN TWO."""

    def __enter__(self) -> "wire":
        _wire_lock.acquire()
        wait = float(_wire_last["at"] or 0.0) + PSI_WIRE_GAP_S - time.monotonic()
        if wait > 0:
            time.sleep(wait)
        return self

    def __exit__(self, *_exc: Any) -> None:
        _wire_last["at"] = time.monotonic()
        _wire_lock.release()


def _persist() -> None:
    """THE CLOCK OUTLIVES THE PROCESS."""
    if unmounted():
        return
    body = {"at": float(_login_state["at"] or 0.0),
            "rested_until": float(_login_state["rested_until"] or 0.0),
            "refused": _login_state.get("refused"),
            "refused_ty": _login_state.get("refused_ty"),
            "paused_until": float(_login_state.get("paused_until") or 0.0),
            "paused_why": str(_login_state.get("paused_why") or ""),
            "account": _account(str(_login_state.get("account") or "adm")),
            "ty": _login_state.get("ty") if isinstance(_login_state.get("ty"), dict) else _ty_blank(),
            "down": _login_state.get("down") if isinstance(_login_state.get("down"), dict) else None}
    tmp = PSI_LOGIN_CLOCK_FILE.with_name(PSI_LOGIN_CLOCK_FILE.name + ".tmp")
    try:
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(body, fh)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, PSI_LOGIN_CLOCK_FILE)
    except OSError as exc:
        log.warning("psi anywhere: the login clock could not be written (%s: %s)",
                    type(exc).__name__, exc)


def _login_load() -> None:
    """The clock as the last process left it."""
    try:
        got = json.loads(PSI_LOGIN_CLOCK_FILE.read_text(encoding="utf-8") or "{}")
    except FileNotFoundError:
        return
    except (OSError, ValueError) as exc:
        # A CLOCK THAT CANNOT BE READ HOLDS EVERY LOGIN, the way a refusal does: the file exists because a login…
        log.warning("psi anywhere: the login clock could not be read (%s) — holding logins "
                    "as refused until the credential file changes or a day passes",
                    type(exc).__name__)
        got = {"refused": {"word": "unknown (the login clock was unreadable)",
                           "at": time.time(), "stamp": _secret_stamp("adm")}}
    if not isinstance(got, dict):
        got = {"refused": {"word": "unknown (the login clock was not a record)",
                           "at": time.time(), "stamp": _secret_stamp("adm")}}
    with _login_lock:
        _login_state["at"] = float(got.get("at") or 0.0)
        _login_state["rested_until"] = float(got.get("rested_until") or 0.0)
        for key in ("refused", "refused_ty"):
            refused = got.get(key)
            _login_state[key] = dict(refused) if isinstance(refused, dict) else None
        _login_state["paused_until"] = float(got.get("paused_until") or 0.0)
        _login_state["paused_why"] = str(got.get("paused_why") or "")
        _login_state["account"] = _account(str(got.get("account") or "adm"))
        ty = got.get("ty")
        _login_state["ty"] = dict(_ty_blank(), **ty) if isinstance(ty, dict) else _ty_blank()
        down = got.get("down")
        _login_state["down"] = dict(down) if isinstance(down, dict) else None


# ── one rung ───────────────────────────────────────────────────────────────

def _chain(exc: BaseException) -> list[BaseException]:
    """An exception and what it was raised from — causes AND contexts."""
    seen: list[BaseException] = []
    here: BaseException | None = exc
    for _ in range(8):
        if here is None or any(here is s for s in seen):
            break
        seen.append(here)
        here = here.__cause__ or here.__context__
    return seen


def _fault_word(exc: BaseException) -> tuple[str, str]:
    """(word, why) for a transport failure."""
    import httpx  # noqa: PLC0415 - the checks import this module with no httpx
    chain = _chain(exc)
    if any(isinstance(e, ssl.SSLError) for e in chain):
        return _WORD_UNKNOWN, "the secure connection could not be made from here"
    if any(isinstance(e, socket.gaierror) for e in chain):
        return _WORD_UNKNOWN, "the name did not resolve here"
    if isinstance(exc, httpx.TimeoutException):
        return _WORD_UNKNOWN, "it did not answer inside our own time limit"
    for e in chain:
        if isinstance(e, (ConnectionRefusedError, ConnectionResetError)):
            return _WORD_REFUSED, "the connection was refused there"
        if isinstance(e, OSError) and e.errno in _REFUSED_ERRNOS:
            return _WORD_REFUSED, "there was no route to it"
    if isinstance(exc, httpx.RemoteProtocolError):
        return _WORD_REFUSED, "the connection was closed before it answered"
    said = str(exc).lower()
    if "refused" in said or "reset by peer" in said or "unreachable" in said:
        return _WORD_REFUSED, "the connection was refused there"
    if isinstance(exc, (httpx.ProtocolError, httpx.TransportError)):
        return _WORD_UNKNOWN, f"the connection failed here ({type(exc).__name__})"
    return _WORD_UNKNOWN, f"the check itself failed here ({type(exc).__name__})"


def _theirs(body: str, headers: Any) -> bool:
    """Is this answer attributable to PsiAnywhere at all?"""
    low = str(body or "").lower()
    if any(mark in low for mark in PSI_THEIR_MARKS):
        return True
    try:
        seen = " ".join(f"{k}: {v}" for k, v in dict(headers or {}).items()).lower()
    except Exception:  # noqa: BLE001 - headers are only ever evidence, never a crash
        seen = ""
    return any(mark in seen for mark in PSI_THEIR_STACK)


def _announces_failure(body: str) -> bool:
    low = str(body or "").lower()
    return any(word in low for word in PSI_FAILURE_WORDS)


def _page_word(status: int, body: str, headers: Any = None) -> tuple[str, str, bool]:
    """(word, why, theirs) for the login page."""
    theirs = _theirs(body, headers)
    if status == 200 and all(mark in body for mark in PSI_PAGE_MARKS):
        return _WORD_UP, "their login page answered", True
    if status >= 500:
        return _WORD_FAILING, f"their login page answered {status}", theirs
    if status == 200:
        if _announces_failure(body):
            return _WORD_FAILING, "the login page answered with an error page", theirs
        return _WORD_STRANGER, "something answered that is not their login page", theirs
    if status in (401, 403):
        # Something in front of them is refusing US.
        return _WORD_UNKNOWN, f"the page was refused to us ({status})", theirs
    return _WORD_UNKNOWN, f"the page answered {status}", theirs


def _service_word(status: int, body: str, headers: Any = None) -> tuple[str, str, bool]:
    """(word, why, theirs) for the application's own endpoint."""
    theirs = _theirs(body, headers)
    if status == 200 and PSI_SERVICE_MARK in body:
        # Its own refusal, in its own grammar: the application is answering.
        return _WORD_UP, "the service answered in its own words", True
    if status in (401, 403):
        # THE SAME RULE AS `down`, ON THE WORD THAT TELLS A CALLER TO STOP WORRYING.
        if theirs:
            return _WORD_UP, "the service refused us in its own words", True
        return (_WORD_UNKNOWN,
                f"the service was refused to us ({status}), and nothing here attributes "
                "that refusal to them", False)
    if status >= 500:
        return _WORD_FAILING, f"the service answered {status}", theirs
    if status == 200:
        if _announces_failure(body):
            return _WORD_FAILING, "the service answered with an error page", theirs
        return _WORD_STRANGER, "the service answered with something that is not its own", theirs
    return _WORD_UNKNOWN, f"the service answered {status}", theirs


async def _rung(client: httpx.AsyncClient, name: str, left: float,
                credential: tuple[str, str] | None = None,
                path: str = PSI_PAGE_PATH) -> dict[str, Any]:
    """One rung, timed, never raising."""
    import httpx  # noqa: PLC0415
    out: dict[str, Any] = {"rung": name, "word": _WORD_UNKNOWN, "status": None,
                           "ms": 0, "why": "", "theirs": False}
    if left <= 0.25:
        out["why"] = "there was no time left for this check"
        out["skipped"] = True
        return out
    timeout = httpx.Timeout(min(PSI_RUNG_TIMEOUT_S, left), connect=min(PSI_CONNECT_TIMEOUT_S, left))
    started = time.monotonic()
    try:
        if name == "page":
            res = await client.get(PSI_BASE + path, timeout=timeout, follow_redirects=True)
            out["status"] = res.status_code
            out["word"], out["why"], out["theirs"] = _page_word(res.status_code, res.text, res.headers)
        else:
            body: dict[str, str] = {}
            if credential and credential[1]:
                body = {"userId": credential[0], "hash": credential[1]}
            res = await client.post(PSI_BASE + PSI_SERVICE_PATH, timeout=timeout,
                                    content=json.dumps(body).encode(),
                                    headers=PSI_SERVICE_HEADERS)
            out["status"] = res.status_code
            out["word"], out["why"], out["theirs"] = _service_word(res.status_code, res.text, res.headers)
            if name == "login" and res.status_code == 200:
                # The account's own word, apart from the service's health: "Not active" is the application answering…
                out["account"] = account_word(res.text)
            if res.status_code in (401, 403):
                # THE RUNG WAS REFUSED, WHATEVER IT IS WORTH.
                out["refused_us"] = True
    except Exception as exc:  # noqa: BLE001 - a rung reports, it never throws
        out["word"], out["why"] = _fault_word(exc)
    out["ms"] = round((time.monotonic() - started) * 1000)
    return out


async def _login_rung(client: httpx.AsyncClient, left: float,
                      credential: tuple[str, str]) -> dict[str, Any]:
    """THE CREDENTIALED RUNG, ON THE ONE WIRE AND UNDER THE PAUSE."""
    skipped: dict[str, Any] = {"rung": "login", "word": _WORD_UNKNOWN, "status": None, "ms": 0,
                               "why": "", "theirs": False, "skipped": True}
    if not _wire_lock.acquire(blocking=False):
        return dict(skipped, why="a collection request is on the wire — the login waits for none")
    sent = False
    try:
        if time.monotonic() - float(_wire_last["at"] or 0.0) < PSI_WIRE_GAP_S:
            return dict(skipped, why="a request left a moment ago — the login waits for none")
        account = active_account()
        allowed, held_back = login_claim("probe", account=account)
        if not allowed:
            return dict(skipped, why=held_back)
        rung = await _rung(client, "login", left, credential=credential)
        sent = not rung.get("skipped")
        login_settle(str(rung["word"]), str(rung.get("account") or ""), account=account)
        return rung
    finally:
        if sent:
            _wire_last["at"] = time.monotonic()
        _wire_lock.release()


# ── the rungs together ─────────────────────────────────────────────────────

def _attribute(rungs: list[dict[str, Any]]) -> None:
    """A REFUSAL BECOMES THEIR REFUSAL ONLY WHEN SOMETHING PINS IT ON THEM."""
    ran = [r for r in rungs if not r.get("skipped")]
    if not any(r["word"] == _WORD_UP for r in ran):
        return
    for r in ran:
        if r.get("refused_us") and r["word"] == _WORD_UNKNOWN:
            r["word"] = _WORD_UP
            r["theirs"] = True
            r["why"] = ("the service refused us in its own words, from the host that "
                        "answered for them in this same check")


def _read(rungs: list[dict[str, Any]]) -> tuple[str, str]:
    """(state, decided_by) from the rungs that ran, or ('', '') when nothing was proved and the third rung is…"""
    ran = [r for r in rungs if not r.get("skipped")]
    for r in ran:
        if r["rung"] != "page" and r["word"] == _WORD_UP:
            return "up", str(r["rung"])
    for r in ran:
        if r["word"] == _WORD_REFUSED:
            return "down", str(r["rung"])
    # Attribution can come from another rung in the same check: the host that served their login page a moment ago…
    proved_theirs = any(r.get("theirs") or r["word"] == _WORD_UP for r in ran)
    for r in ran:
        if r["word"] == _WORD_FAILING and (r.get("theirs") or proved_theirs):
            return "down", str(r["rung"])
    return "", ""


def _why(state: str, decided_by: str, rungs: list[dict[str, Any]]) -> str:
    """The one clause the sentence, the note and the `why` field all stand on, so none of the three can ever say…"""
    ran = [r for r in rungs if not r.get("skipped")]
    decider = next((r for r in ran if r["rung"] == decided_by), None)
    said = str(decider["why"]) if decider and decider.get("why") else ""
    if state == "up":
        # THE DECIDING RUNG'S OWN WORDS, exactly as `down` takes them.
        if decided_by == "login":
            return said or "the service answered when asked directly"
        # AND A REFUSAL IS NOT AN ANSWER, EVEN WHEN IT PROVES THEM UP.
        if said and not decider.get("refused_us") \
                and any(r["rung"] == "page" and r["word"] == _WORD_UP for r in ran):
            return "the login page and the service both answered"
        return said or "the service answered in its own words"
    if state == "down":
        return said or "it did not answer"
    # AND AN `unknown` SAYS WHICH KIND IT IS.
    return (said
            or next((str(r["why"]) for r in reversed(ran) if r.get("why")), "")
            or next((str(r["why"]) for r in reversed(rungs) if r.get("why")), "")
            or "nothing was proved either way")


def _stamp(when: str) -> str:
    return when[11:16] + "Z" if len(when) >= 16 else when


def _sentence(state: str, why: str, when: str) -> str:
    """One line a screen can print and a person can read."""
    if state == "up":
        return f"PsiAnywhere is up — {why} (checked {_stamp(when)})."
    if state == "down":
        return f"PsiAnywhere is down — {why} (checked {_stamp(when)})."
    return f"PsiAnywhere could not be checked from here — {why} (tried {_stamp(when)})."


def _note(state: str, why: str, rungs: list[dict[str, Any]], when: str) -> str:
    """The one line that goes into the queue row's notes cell, beside the requestor note and before the call stamp."""
    ran = [r for r in rungs if not r.get("skipped")]
    how = " / ".join(f"{r['rung']} {r['status'] if r['status'] is not None else r['word']}"
                     f" in {r['ms'] / 1000:.2f}s" for r in ran)
    # AND "NOBODY LOOKED" IS NOT "WE LOOKED AND COULD NOT TELL".
    unknown_head = (f"the check could not decide: {why}" if ran
                    else f"nothing was checked: {why}")
    head = (f"PsiAnywhere checked {_stamp(when)}: {state}"
            if state == "up" else
            f"PsiAnywhere checked {_stamp(when)}: {state} — " +
            (unknown_head if state == "unknown" else why))
    return " ".join(f"{head}{f' ({how})' if how else ''}.".split())


def _shape(state: str, decided_by: str, rungs: list[dict[str, Any]], ms: int,
           when: str) -> dict[str, Any]:
    """THE VERDICT OBJECT, AND WHY IT CARRIES TWO NAMES FOR THREE OF ITS FIELDS."""
    why = _why(state, decided_by, rungs)
    return {"state": state, "decided_by": decided_by,
            "checked_at": when, "at": when,        # `at` is the Apps Script name
            "ms": ms, "why": why,
            "sentence": _sentence(state, why, when),
            "note": _note(state, why, rungs, when),
            "rungs": rungs,
            "held": False, "cached": False,        # `cached` is the Apps Script name
            "armed": PSI_ARMED, "source": "relay", "host": PSI_BASE}


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


async def _check() -> dict[str, Any]:
    """The rungs, once, with no cache in front of them."""
    when, started = _now_iso(), time.monotonic()
    rungs: list[dict[str, Any]] = []
    if not PSI_ARMED:
        rungs.append({"rung": "page", "word": _WORD_UNKNOWN, "status": None, "ms": 0,
                      "why": "the check is switched off here", "theirs": False, "skipped": True})
        return _shape("unknown", "none", rungs, 0, when)

    def left() -> float:
        """What is still in the whole check's budget."""
        return PSI_BUDGET_S - (time.monotonic() - started)

    import httpx  # noqa: PLC0415
    async with httpx.AsyncClient(timeout=PSI_RUNG_TIMEOUT_S, follow_redirects=False) as client:
        page = await _rung(client, "page", left())
        if page["word"] == _WORD_STRANGER and page["status"] == 200:
            # `/` answered, and what came back is not their login page.
            direct = await _rung(client, "page", left(), path=PSI_WEBROOT_PATH)
            if direct["word"] == _WORD_UP or not direct.get("skipped"):
                page = direct
        rungs.append(page)
        rungs.append(await _rung(client, "service", left()))
        _attribute(rungs)
        state, decided_by = _read(rungs)
        # THE CREDENTIAL ONLY EVER GOES WHERE THEY ANSWERED, AND ONLY ON ITS RATION.
        reached = any(r["status"] is not None for r in rungs)
        if not state and reached:
            credential = _credential()
            if credential[1]:
                rung = await _login_rung(client, left(), credential)
                rungs.append(rung)
                if not rung.get("skipped"):
                    _attribute(rungs)
                    state, decided_by = _read(rungs)
    if not state:
        state, decided_by = "unknown", "none"
    ms = round((time.monotonic() - started) * 1000)
    verdict = _shape(state, decided_by, rungs, ms, when)
    log.log(logging.INFO if state == "up" else logging.WARNING,
            "psi anywhere: %s by %s in %s ms (%s)", state, decided_by, ms,
            " / ".join(f"{r['rung']} {r['word']}" for r in rungs))
    return verdict


def _hold_s(state: str) -> float:
    return {"up": PSI_HOLD_UP_S, "down": PSI_HOLD_DOWN_S}.get(state, PSI_HOLD_UNKNOWN_S)


def _fresh(now: float) -> dict[str, Any] | None:
    verdict = _held["verdict"]
    if not isinstance(verdict, dict):
        return None
    if now - float(_held["at"] or 0.0) >= _hold_s(str(verdict.get("state") or "")):
        return None
    return {**verdict, "held": True, "cached": True}


async def verdict(*, force: bool = False) -> dict[str, Any]:
    """Is PsiAnywhere up?"""
    global _flight
    now = time.time()
    if not force:
        got = _fresh(now)
        if got is not None:
            return got
    if _flight is None:
        _flight = asyncio.Lock()
    entered = time.time()
    async with _flight:
        # A caller that waited on somebody else's check takes its answer: the point of the flight is that the second…
        got = _fresh(time.time())
        if got is not None and (not force or float(_held["at"] or 0.0) >= entered):
            return got
        answer = await _check()
        _held.update({"at": time.time(), "verdict": answer})
        return answer


def health() -> dict[str, Any]:
    """What /health may say: whether the check is armed and whether a verdict is currently held."""
    return {"armed": PSI_ARMED, "held": _fresh(time.time()) is not None,
            "credential": credential_present()}


def forget() -> None:
    """Drop the held verdict."""
    _held.update({"at": 0.0, "verdict": None})


def forget_login() -> None:
    """Clear the whole login clock — the ration, both latches, DOWN, the active account and Ty's day."""
    with _login_lock:
        _login_state.update({"at": 0.0, "misses": 0, "rested_until": 0.0, "refused": None,
                             "refused_ty": None, "paused_until": 0.0, "paused_why": "",
                             "account": "adm", "ty": _ty_blank(), "down": None})
        _persist()


# The clock the last process left, before anything here can ask for a login.
_login_load()
