"""PSI LOG — a person's own PsiAnywhere sign-in and time clock, inside the Hub (the operator, 2026-10-28: "implemente
o PSY ANYWHERE login direto na plataforma em um novo APP PSI Log").

PsiAnywhere is the official time clock. A person signs in here with THEIR OWN PsiAnywhere user name and password and
clocks in and out as its Single Entry screen does: the same service methods, the same payloads (getLogIn,
authenticatedLogin, getSingleEntryByDateJSON, insertSingleEntry / getSelectedConsumerLocations + preInsertSingleEntry,
updateSingleEntry, updateSingleEntryStatus), sent through the platform's one PsiAnywhere wire (psi_attendance._ask),
held while PsiAnywhere is DOWN.

- The password goes to PsiAnywhere as its md5, as their login page sends it, and is never kept or logged. The session
  token stays in this process's memory, keyed by the Hub account, and SEALED in app.psi_log_sessions, so a restart
  (every deploy) does not sign anyone out; it never reaches the browser and is never logged. A token PsiAnywhere has
  let go of ends the session: the page asks to sign in again. A LIST read answered with placeholder rows (not an
  error) is the sign; a write or a single-record lookup ends it only on PsiAnywhere's invalid-session words, or when
  one probe list read confirms the token is dead.
- A person's sign-in is their own. The platform's accounts (ADM, Ty) — the pre-set login — are the MASTER's alone:
  they sign in through the platform's one login clock (psi_anywhere.login_claim / login_settle), or borrow the
  attendance lane's kept token while it is fresh. Anyone else the app is opened to signs in with their own account.
- PsiAnywhere locks an account at its third wrong password. After its second refusal the Hub sends no third one: the
  person resets it in PsiAnywhere (Forgot Password) or asks an administrator. The count is kept in
  app.psi_log_refusals too, so a restart never forgets it.
- A clock-in saves the entry (start time, location or clients, work code, GPS); a clock-out writes the end time and the
  hours, and submits the entry for approval only when the person attests it, in PsiAnywhere's own words.
- Every step is kept in app.psi_log_events (db/psi_log.sql), the log the app shows.
- The app ships for the master alone: its door is App Control's (sched_lanes._app_gate, no row = the master's)."""
from __future__ import annotations

import hashlib
import html
import json
import logging
import os
import re
import threading
import time
from datetime import date, datetime, timedelta, timezone
from typing import Any, Callable
from zoneinfo import ZoneInfo

try:
    from fastapi import Request
except ImportError:  # the sync container runs the module's logic without the web stack
    Request = Any  # type: ignore[misc,assignment]

log =logging.getLogger("asa-hub-app.psi-log")

LANE = "/hub-lanes/psi-log"
APP_ID, APP_LABEL = "psi-log", "PSI Log"
# the collection's pages (app/psi_harvest.py): their own App Control row, the master's alone until he names a badge
COLLECTION, COLLECTION_LABEL = "psi-log.collection", "PSI collection"
# approving time entries: its own App Control row, the master's alone until he releases it (to the platform lead)
APPROVE_FEATURE, APPROVE_LABEL = "psi-log.approve", "PSI time approval"
# creating a client in PsiAnywhere: its own App Control row, the master's alone until he releases it
NEWCLIENT_FEATURE, NEWCLIENT_LABEL = "psi-log.newClient", "PSI new client"
# turning a person's PsiAnywhere account on or off: its own App Control row, the master's alone until released
ACCOUNTS_FEATURE, ACCOUNTS_LABEL = "psi-log.accounts", "PSI account on/off"
NY = ZoneInfo("America/New_York")
TIMEOUT_S = 25.0
# a session nobody used for this long is forgotten
IDLE_S = 10 * 3600
# a session is never trusted longer than this after its sign-in, however busy: the attendance lane saw PsiAnywhere
# still take a token at 1,195 minutes, and none is kept past that
SESSION_LIFE_S = 20 * 3600
# a session's seen_at is written at most this often, so a busy page is not a write on every read
SEEN_EVERY_S = 300
# the attendance lane's kept token is borrowed for a platform sign-in only when it READ this recently, and only when
# the lane's lock is had within LANE_WAIT_S (mid-collection, its token may be changing hands)
LANE_FRESH_S = 30 * 60
LANE_WAIT_S = 3.0
# the purpose the platform's login clock records for a PSI Log sign-in on ADM or Ty
CLOCK_PURPOSE = "psi log sign-in"
# where sessions and refusals outlive the process (db/psi_log_sessions.sql); a check points them at temp tables
SESSIONS_TABLE, REFUSALS_TABLE = "app.psi_log_sessions", "app.psi_log_refusals"
SEAL_INFO = b"psi-log-session-v1"
# after a kept table did not answer, it is not asked again for this long: a slow or unreachable asa-hub-db costs one
# timeout per rest, never one per page view
DB_REST_S = 30.0
ENDED = "Your PsiAnywhere session ended — sign in again."
# the list read that settles whether a token is still alive, when a write or a lookup answered with nothing
PROBE = "getWorkCodesJSON"
MASTER_ONLY = ("The platform's stored PsiAnywhere accounts sign in for the master alone. Sign in with your own "
               "PsiAnywhere user name and password.")
# after this many refusals PsiAnywhere makes the account inactive on the next one; the Hub never sends that one
REFUSALS_BEFORE_LOCK = 2
REFUSAL_REST_S = 3600
ATTEST = ("By clicking Yes, you are confirming that you have reviewed this entry and it is correct to the best of "
          "your knowledge.")

# PsiAnywhere's own words for each refusal, as its login page says them
WORDS = {
    "Not active": "Your PsiAnywhere account is inactive. Please contact your System Administrator to enable it.",
    "Invalid username": "Invalid user name or password.",
    "No demographics record": ("There is no Name in Demographics defined for your PsiAnywhere user. Please contact "
                               "your system administrator."),
    "No recipient": ("Two-factor authentication is on, and PsiAnywhere has no valid email address or cell phone for "
                     "your account. Please contact your system administrator."),
    "Expired password": "Your PsiAnywhere password has expired. Change it in PsiAnywhere, then sign in here again.",
}
FAILED = {
    "1": "Invalid user name or password.",
    "2": ("This is your second failed login attempt. If you have one more failed attempt your PsiAnywhere account "
          "will become inactive. Please use Forgot Password on PsiAnywhere to reset your password."),
}
LOCKED = ("Your PsiAnywhere account is inactive due to the number of failed login attempts. Please contact your "
          "System Administrator to enable your account.")
HELD_BACK = ("PsiAnywhere has refused this account twice, and one more wrong password makes it inactive — so the Hub "
             "will not send another. Reset your password with Forgot Password on PsiAnywhere, or ask an "
             "administrator, then sign in here.")
CODE_WORDS = {
    "Invalid key": "That verification code is not right. Check it and try again.",
    "Too many failed attempts": ("Too many failed attempts. Your PsiAnywhere account has been disabled. Please "
                                 "contact a system administrator."),
    "Expired key": "That verification code has expired. Sign in again to get a new one.",
}

_LOCK = threading.Lock()
# hub uid -> {uid, token, user, userId, peopleId, first, last, locations, at, expires, borrowed, seen, keptSeen, codes}
_SESS: dict[str, dict[str, Any]] = {}
# hub uid -> {user, device, at}: a sign-in waiting for its two-factor code
_PENDING: dict[str, dict[str, Any]] = {}
# psi user name (lowercase) -> {count, at}: PsiAnywhere's refusals, so its locking one is never sent from here; a cache
# of app.psi_log_refusals, which outlives the process
_REFUSED: dict[str, dict[str, Any]] = {}
# No lock is ever held across a database round trip: memory changes under _LOCK alone, the kept row outside it. So a
# restore never revives a session a sign-out or a dead token let go of meanwhile, each Hub account has a generation,
# bumped under _LOCK whenever its session is put in or let go of, and a count of the drops still deleting its row: a
# restore puts what it read in only when the generation it began with still stands and no drop is in flight.
_GEN: dict[str, int] = {}
_DROPPING: dict[str, int] = {}
_KEEP_DDL = threading.Lock()
# the write store, the sealing key (None until derived, b'' when there is no secret), whether the tables are made, when
# the last warning was said, and until when a store that did not answer is let rest
_KEEP: dict[str, Any] = {"store": None, "key": None, "tables": False, "warned": 0.0, "rest_until": 0.0}
# digests of attendance-lane tokens PsiAnywhere answered as dead here, so a one-click never borrows one again
_DEAD_LANE: dict[str, float] = {}


class Refused(Exception):
    """A step the Hub or PsiAnywhere said no to, in words for the person; status is the lane's."""

    def __init__(self, message: str, status: int = 409, word: str = "") -> None:
        super().__init__(message)
        self.status, self.word = status, word


# ---- the wire --------------------------------------------------------------------------------------------------------

def _ask(method: str, body: dict[str, Any]) -> Any:
    """One request on the platform's PsiAnywhere wire; its failures said in words."""
    import psi_attendance as PA  # noqa: PLC0415
    try:
        return PA._ask(method, body, TIMEOUT_S)
    except PA.PsiPaused as exc:
        raise Refused(f"PsiAnywhere is not answering now, so nothing was sent ({exc}). Try again later.", 503) from exc
    except PA.PsiTransport as exc:
        raise Refused(f"PsiAnywhere could not be reached ({exc}). Nothing changed here; try again.", 503) from exc
    except PA.PsiAnswer as exc:
        raise Refused(f"PsiAnywhere answered something the Hub cannot read ({exc}).", 502) from exc


# ---- reading PsiAnywhere's answers -----------------------------------------------------------------------------------

_BLOCK = re.compile(r"<permissions>(.*?)</permissions>", re.S)


def _tag(text: str, name: str) -> str:
    m = re.search(rf"<{name}>(.*?)</{name}>", text, re.S)
    return html.unescape(m.group(1)).strip() if m else ""


def read_login(answer: Any) -> dict[str, Any]:
    """A getLogIn / authenticatedLogin answer: the session (token, the user's ids and names, their staff locations) or
    the word PsiAnywhere refused with, and that word's data (the refusal count, the two-factor device)."""
    text = str(answer if not isinstance(answer, (dict, list)) else json.dumps(answer)).replace("<\\/", "</")
    rows = [(_tag(b, "window_name"), _tag(b, "permission"), _tag(b, "special_data")) for b in _BLOCK.findall(text)]
    if not rows:
        rows = [(_tag(text, "window_name"), _tag(text, "permission"), _tag(text, "special_data"))]
    out: dict[str, Any] = {"word": "", "data": "", "token": "", "userId": "", "peopleId": "", "first": "", "last": "",
                           "locations": []}
    for w, p, d in rows:
        if w == "Token":
            out["token"] = d
        elif w == "Name":
            out["first"], out["userId"] = p, d
        elif w == "LName":
            out["last"], out["peopleId"] = p, d
        elif w == "stafflocation" and d:
            out["locations"].append({"id": d, "name": p})
    first = next(((w, d) for w, _p, d in rows if w), ("", ""))
    out["word"], out["data"] = ("Token", "") if out["token"] else first
    if not out["word"]:
        out["word"] = ("Expired password" if "609" in text else "608" if "608" in text else "")
    return out


def _pick(row: dict[str, Any], *keys: str) -> str:
    """The first of these keys the row has, any case; '' when none."""
    low = {str(k).lower(): v for k, v in row.items()}
    for k in keys:
        v = low.get(k.lower())
        if v is not None and str(v).strip() != "":
            return str(v).strip()
    return ""


def _rows(answer: Any) -> list[dict[str, Any]]:
    if isinstance(answer, str) and answer.strip().startswith(("[", "{")):
        try:
            answer = json.loads(answer)
        except ValueError:
            return []
    if isinstance(answer, dict):
        answer = [answer]
    return [r for r in answer if isinstance(r, dict)] if isinstance(answer, list) else []


# PsiAnywhere's words for a session it no longer holds, when it says one instead of answering placeholder rows
_ENDED_WORDS = re.compile(r"\b(?:invalid|expired|bad|unknown)\s+(?:session|token)\b"
                          r"|\b(?:session|token)\s+(?:has\s+|is\s+)?(?:expired|invalid|ended|timed\s*out)\b", re.I)


def _blank(row: dict[str, Any]) -> bool:
    return all(v is None or str(v).strip() == "" for v in row.values())


def placeholders(answer: Any) -> bool:
    """Whether an answer is rows that are ALL placeholders — every field empty ({} too). An empty list is not."""
    rows = _rows(answer)
    return bool(rows) and all(_blank(r) for r in rows)


def said_ended(answer: Any) -> bool:
    """Whether PsiAnywhere said in its own words that the session is gone — read only in an answer that is not rows,
    so words inside a real row (a typed comment) are never taken for them."""
    if _rows(answer) or (isinstance(answer, list) and not answer):
        return False
    text = str(answer if not isinstance(answer, (dict, list)) else json.dumps(answer, default=str))
    return bool(_ENDED_WORDS.search(text))


def ended(answer: Any) -> bool:
    """Whether a LIST read's answer says the session's token is dead. It does not say so with an error: a dead token is
    answered with placeholder rows — every field empty — which a page would draw as "no entries" (the 10-28 drops), so
    rows that are ALL placeholders are the sign, besides PsiAnywhere's own words. An empty list is a real "nothing",
    never the sign. Only a list read is judged by its placeholders: a write or a single-record lookup may answer a real
    "nothing" that way, so _asked confirms it with a probe instead."""
    return placeholders(answer) or said_ended(answer)


def _hhmm(raw: Any) -> str:
    """'08:05', from '08:05:00', '8:05 AM' or '1900-01-01T08:05:00'."""
    m = re.search(r"(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp][Mm])?", str(raw or ""))
    if not m:
        return ""
    h, mi = int(m.group(1)), int(m.group(2))
    ap = (m.group(3) or "").lower()
    if ap == "pm" and h < 12:
        h += 12
    elif ap == "am" and h == 12:
        h = 0
    return f"{h:02d}:{mi:02d}"


def _iso_day(raw: Any) -> str:
    """'2026-10-28', from '10/28/2026 12:00:00 AM' or '2026-10-28T00:00:00'."""
    text = str(raw or "")
    m = re.search(r"(\d{4})-(\d{1,2})-(\d{1,2})", text)
    if m:
        return f"{int(m.group(1)):04d}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"
    m = re.search(r"(\d{1,2})/(\d{1,2})/(\d{4})", text)
    return f"{int(m.group(3)):04d}-{int(m.group(1)):02d}-{int(m.group(2)):02d}" if m else ""


def entry_of(r: dict[str, Any]) -> dict[str, Any]:
    end = _hhmm(_pick(r, "End_Time", "endTime", "end_time", "stopTime"))  # an open entry has none
    return {
        "id": _pick(r, "Single_Entry_ID", "singleEntryId", "single_entry_id"),
        "date": _iso_day(_pick(r, "Date_of_Service", "dateOfService", "date_service")),
        "start": _hhmm(_pick(r, "Start_Time", "startTime", "start_time")),
        "end": end,
        "hours": _pick(r, "Check_Hours", "checkHours", "check_hours"),
        "location": _pick(r, "Location_Name", "locationName", "Location", "description"),
        "workCode": _pick(r, "WCCode", "workcodename", "Work_Code", "workCode", "Work_Code_ID"),
        "status": _pick(r, "Anywhere_Status", "anywhere_status", "status"),
        "consumers": _pick(r, "Number_Consumers_Present", "numberOfConsumersPresent", "num_consumers"),
    }


# PsiAnywhere's own status letters (its Single Entry review grid)
STATUS = {"A": "Awaiting approval", "P": "Pending", "R": "Rejected", "I": "Imported", "S": "Submitted",
          "D": "Duplicate"}


# ---- the session -----------------------------------------------------------------------------------------------------

def _now() -> float:
    return time.time()


def _ts(at: float) -> datetime:
    return datetime.fromtimestamp(at, timezone.utc)


# ---- the session kept across restarts --------------------------------------------------------------------------------
# The app restarts with every deploy (37 starts in 26 h on 10-27/28) and a session held in memory alone signed everyone
# out each time, while PsiAnywhere's own tokens live for hours. So a session is kept in app.psi_log_sessions as well,
# SEALED: AES-GCM under a key derived (HKDF-SHA256, info SEAL_INFO) from the server secret the app already holds —
# HUB_SERVICE_SECRET, else HUB_APP_TOKEN — with the Hub account bound in as associated data, so a row copied onto
# another account does not open. The cryptography package comes with pywebpush (requirements.txt): no new dependency.
# No secret here and the session lives in memory alone, as before, said once in the log. A row never holds a password,
# and the token is only ever inside the sealed blob. The refusal count beside it (app.psi_log_refusals) needs no seal.
# Both tables are made here on first use (ddl, as recon_writes.ddl does), so the app never waits on a manual step.

# what the sealed blob carries: who the session is and the token; the work codes, places and password rule are re-read
SEALED = ("token", "user", "userId", "peopleId", "first", "last", "locations", "at", "expires", "borrowed")


def ddl() -> tuple[str, ...]:
    """The kept sessions and refusals (db/psi_log_sessions.sql), made here too so the app never waits on them."""
    return (f"create table if not exists {SESSIONS_TABLE} (hub_uid text primary key,"
            " psi_user text not null default '', sealed bytea not null,"
            " obtained_at timestamptz not null default now(), seen_at timestamptz not null default now(),"
            " expires_at timestamptz not null)",
            f"create table if not exists {REFUSALS_TABLE} (psi_user text primary key,"
            " count integer not null default 0, at timestamptz not null default now())",
            f"grant select on {SESSIONS_TABLE} to asa_hub_app_ro",
            f"grant select on {REFUSALS_TABLE} to asa_hub_app_ro")


def keep_with(store: Any) -> None:
    """The write store sessions and refusals are kept through (install's; a check's own)."""
    _KEEP.update(store=store, tables=False, rest_until=0.0)


def _seal_key() -> bytes:
    """The sealing key, derived once from the server secret; b'' when there is none (memory only, said once)."""
    if _KEEP["key"] is None:
        secret = (os.getenv("HUB_SERVICE_SECRET", "") or os.getenv("HUB_APP_TOKEN", "")).strip()
        key, why = b"", "no HUB_SERVICE_SECRET or HUB_APP_TOKEN is set here"
        if secret:
            try:
                from cryptography.hazmat.primitives import hashes  # noqa: PLC0415
                from cryptography.hazmat.primitives.kdf.hkdf import HKDF  # noqa: PLC0415
                key = HKDF(algorithm=hashes.SHA256(), length=32, salt=None, info=SEAL_INFO).derive(secret.encode())
            except ImportError:
                why = "the cryptography package is not installed here"
        if not key:
            log.warning("psi log: %s, so PsiAnywhere sessions are kept in memory alone — a restart signs everyone out",
                        why)
        _KEEP["key"] = key
    return _KEEP["key"]


def _aad(uid: str) -> bytes:
    return b"psi-log-session|" + uid.encode()


def seal(uid: str, s: dict[str, Any]) -> bytes:
    """The session's SEALED fields, encrypted and bound to the Hub account: a 12-byte nonce, then the ciphertext."""
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM  # noqa: PLC0415
    key = _seal_key()
    if not key:
        raise RuntimeError("no sealing key")
    nonce = os.urandom(12)
    body = json.dumps({k: s.get(k) for k in SEALED}, separators=(",", ":")).encode()
    return nonce + AESGCM(key).encrypt(nonce, body, _aad(uid))


def unseal(uid: str, blob: bytes) -> dict[str, Any] | None:
    """A sealed session opened, or None: another key, another account, or a single byte changed."""
    key = _seal_key()
    if not key or len(blob or b"") < 29:
        return None
    from cryptography.exceptions import InvalidTag  # noqa: PLC0415
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM  # noqa: PLC0415
    try:
        got = json.loads(AESGCM(key).decrypt(bytes(blob[:12]), bytes(blob[12:]), _aad(uid)))
    except (InvalidTag, ValueError, TypeError):
        return None
    return got if isinstance(got, dict) else None


def _warn(what: str, exc: BaseException) -> None:
    """A kept table that did not answer, said at most once a minute: memory still holds the session meanwhile."""
    if _now() - _KEEP["warned"] >= 60:
        _KEEP["warned"] = _now()
        log.warning("psi log: %s (%s)", what, type(exc).__name__)


def _db(sql: str, params: tuple[Any, ...] = (), fetch: bool = False) -> list[tuple[Any, ...]] | None:
    """One statement on the kept tables, its rows when fetched; None when nothing is kept here or the store did not
    answer — never "none", so a caller can tell an unreadable table from an empty one. A store that did not answer is
    let rest DB_REST_S: meanwhile every statement answers None at once (memory holds the sessions)."""
    store = _KEEP["store"]
    if store is None or not getattr(store, "available", False):
        return None
    if _now() < float(_KEEP.get("rest_until") or 0.0):
        return None
    try:
        c = store.conn()
        if not _KEEP["tables"]:
            with _KEEP_DDL:  # once per process; whoever waited behind a make that failed rests too, never retries it
                if _now() < float(_KEEP.get("rest_until") or 0.0):
                    return None
                if not _KEEP["tables"]:
                    now = _now()
                    with c.transaction():
                        for stmt in ddl():
                            c.execute(stmt)
                        # what a restart left behind and can never use again
                        c.execute(f"delete from {SESSIONS_TABLE} where expires_at <= %s or seen_at < %s",
                                  (_ts(now), _ts(now - IDLE_S)))
                        c.execute(f"delete from {REFUSALS_TABLE} where at < %s", (_ts(now - REFUSAL_REST_S),))
                    _KEEP["tables"] = True
        with c.transaction():
            cur = c.execute(sql, params)
            return list(cur.fetchall()) if fetch else []
    except Exception as exc:  # noqa: BLE001 - said, never the person's problem
        _KEEP["rest_until"] = _now() + DB_REST_S
        _warn("the kept PsiAnywhere sessions did not answer", exc)
        return None


def _session(uid: str, user: str, got: dict[str, Any], at: float, expires: float, borrowed: str = "") -> dict[str, Any]:
    now = _now()
    return {"uid": uid, "token": got["token"], "user": user, "userId": got.get("userId") or user,
            "peopleId": got.get("peopleId") or "", "first": got.get("first") or "", "last": got.get("last") or "",
            "locations": list(got.get("locations") or []), "at": at, "expires": expires, "borrowed": borrowed,
            "seen": now, "keptSeen": 0.0, "kept": False, "codes": None}


def _bump(uid: str) -> None:
    """The account's session changed hands (put in or let go of); the caller holds _LOCK."""
    _GEN[uid] = _GEN.get(uid, 0) + 1


def _forget_row(uid: str, s: dict[str, Any] | None = None) -> None:
    """Delete the account's kept row — with `s`, only that session's (the time it was obtained), so the row of a
    sign-in that replaced it meanwhile stands."""
    if s is None:
        _db(f"delete from {SESSIONS_TABLE} where hub_uid = %s", (uid,))
    else:
        _db(f"delete from {SESSIONS_TABLE} where hub_uid = %s and obtained_at = %s", (uid, _ts(s["at"])))


def _keep(uid: str, s: dict[str, Any]) -> None:
    """The session into its sealed row; nothing when this process keeps none. s['kept'] says whether the row landed."""
    if not _seal_key():
        return
    now = _now()
    try:
        blob = seal(uid, s)
    except Exception as exc:  # noqa: BLE001 - memory holds the session; only the restart loses it
        _warn("a PsiAnywhere session could not be sealed", exc)
        return
    got = _db(f"insert into {SESSIONS_TABLE} (hub_uid, psi_user, sealed, obtained_at, seen_at, expires_at)"
              " values (%s, %s, %s, %s, %s, %s) on conflict (hub_uid) do update set psi_user = excluded.psi_user,"
              " sealed = excluded.sealed, obtained_at = excluded.obtained_at, seen_at = excluded.seen_at,"
              " expires_at = excluded.expires_at",
              (uid, s["user"], blob, _ts(s["at"]), _ts(now), _ts(s["expires"])))
    if got is not None:
        s["keptSeen"], s["kept"] = now, True


def _keep_held(uid: str, s: dict[str, Any]) -> None:
    """_keep (a sign-in, a code, a row that never landed or went missing), outside every lock — and when the session was
    let go of or replaced while its row was being written (a sign-out racing it), that row is deleted again, so a row
    never outlives its session."""
    _keep(uid, s)
    with _LOCK:
        held = _SESS.get(uid) is s
    if not held and s.get("kept"):
        _forget_row(uid, s)
        s["kept"] = False


def _restore(uid: str) -> dict[str, Any] | None:
    """The kept session of a Hub account this process does not hold (it restarted), or None — and a row too idle, too
    old or no longer opening (another secret) is deleted on the way. The session's life is capped by BOTH expiries:
    the row's and the one sealed inside it, which is authenticated — a row whose plain expires_at was pushed forward
    still ends when its sealed one says, and a blob without one is not trusted."""
    if not _seal_key():
        return None
    rows = _db(f"select psi_user, sealed, seen_at, expires_at, obtained_at from {SESSIONS_TABLE} where hub_uid = %s",
               (uid,), fetch=True)
    if not rows:
        return None
    user, sealed, seen, expires, obtained = rows[0]

    def gone() -> None:  # only the row read here: a sign-in's fresh row written meanwhile stands
        _db(f"delete from {SESSIONS_TABLE} where hub_uid = %s and obtained_at = %s", (uid, obtained))

    now = _now()
    if now >= expires.timestamp() or now - seen.timestamp() > IDLE_S:
        gone()
        return None
    got = unseal(uid, bytes(sealed or b""))
    if not got or not got.get("token"):
        gone()
        log.warning("psi log: %s's kept PsiAnywhere session could not be opened — forgotten; they sign in again", uid)
        return None
    try:
        until = min(expires.timestamp(), float(got.get("expires") or 0.0))
    except (TypeError, ValueError):
        until = 0.0
    if now >= until:
        gone()
        return None
    s = _session(uid, str(got.get("user") or user), got, float(got.get("at") or now), until,
                 str(got.get("borrowed") or ""))
    s["keptSeen"], s["kept"] = seen.timestamp(), True
    log.info("psi log: %s's PsiAnywhere session (%s) came back from the kept table", uid, s["user"])
    return s


def _restored(uid: str) -> dict[str, Any] | None:
    """The held session, else the kept one: the row is read OUTSIDE every lock, and what was read is put in only when
    nothing happened to the account meanwhile — a sign-in that landed wins, a sign-out or dead token in flight or done
    since the read leaves it out."""
    with _LOCK:
        s, gen = _SESS.get(uid), _GEN.get(uid, 0)
    if s is not None:
        return s
    got = _restore(uid)
    if got is None:
        return None
    with _LOCK:
        held = _SESS.get(uid)
        if held is not None:
            return held
        if _GEN.get(uid, 0) != gen or _DROPPING.get(uid):
            return None
        _SESS[uid] = got
        _bump(uid)
    return got


def _drop(uid: str, s: dict[str, Any] | None = None) -> None:
    """Forget a session, in memory and its kept row: a sign-out, an idle or expired one, a dead token. With `s`, only
    that one — a sign-in that replaced it meanwhile stands. Memory first, under _LOCK; the row after, outside it, with
    the drop counted in flight meanwhile so no restore puts back what is being deleted."""
    with _LOCK:
        held = _SESS.get(uid)
        if s is not None and held is not None and held is not s:
            return
        _SESS.pop(uid, None)
        _bump(uid)
        _DROPPING[uid] = _DROPPING.get(uid, 0) + 1
    try:
        _forget_row(uid, s)
    finally:
        with _LOCK:
            left = _DROPPING.get(uid, 1) - 1
            if left > 0:
                _DROPPING[uid] = left
            else:
                _DROPPING.pop(uid, None)
            _bump(uid)


def session_of(uid: str) -> dict[str, Any] | None:
    """The person's PsiAnywhere session: this process's, else the kept one (after a restart); None when there is none,
    it sat idle IDLE_S or it is SESSION_LIFE_S old. seen_at is written at most every SEEN_EVERY_S; a session whose row
    never landed (the store did not answer at its sign-in) or went missing is kept again then."""
    now = _now()
    with _LOCK:
        s = _SESS.get(uid)
    if s is not None and (now - s["seen"] > IDLE_S or now >= s["expires"]):
        _drop(uid, s)
        return None
    if s is None:
        s = _restored(uid)
        if s is None:
            return None
    s["seen"] = now
    if _seal_key() and (not s.get("kept") or now - float(s.get("keptSeen") or 0.0) >= SEEN_EVERY_S):
        if s.get("kept"):
            rows = _db(f"update {SESSIONS_TABLE} set seen_at = %s where hub_uid = %s and obtained_at = %s"
                       " returning hub_uid", (_ts(now), uid, _ts(s["at"])), fetch=True)
            if rows:
                s["keptSeen"] = now
            elif rows is not None:
                s["kept"] = False  # the row is gone: kept again just below
        if not s.get("kept"):
            _keep_held(uid, s)
    return s


def _must(uid: str) -> dict[str, Any]:
    s = session_of(uid)
    if not s:
        raise Refused("Sign in to PsiAnywhere first.", 409, "signed-out")
    return s


def _digest(token: str) -> str:
    return hashlib.sha256(str(token).encode()).hexdigest()[:32]


def _session_ended(s: dict[str, Any]) -> None:
    """PsiAnywhere let go of this session's token: forgotten here (memory and row). A token borrowed from the attendance
    lane is never borrowed again, and the lane's own state is left to the lane."""
    if s.get("borrowed"):
        _DEAD_LANE[_digest(s["token"])] = _now()
        for old in sorted(_DEAD_LANE, key=_DEAD_LANE.get)[:-20]:
            _DEAD_LANE.pop(old, None)
    _drop(str(s.get("uid") or ""), s)
    log.info("psi log: %s's PsiAnywhere session (%s) ended — PsiAnywhere answered it as a dead one",
             s.get("uid"), s.get("user"))


def _signed_out(s: dict[str, Any]) -> Refused:
    _session_ended(s)
    return Refused(ENDED, 401, "signed-out")


def _probe(s: dict[str, Any]) -> None:
    """One list read (PROBE) through the checked path, to settle an answer that may be a dead token's or a real
    "nothing": a dead token ends the session (401 signed-out); anything else — alive, or PsiAnywhere not answering —
    leaves the first answer standing, never a sign-out on a guess."""
    try:
        _asked(s, PROBE, {"token": s["token"]}, listing=True)
    except Refused as exc:
        if exc.word == "signed-out":
            raise


def _asked(s: dict[str, Any], method: str, body: dict[str, Any], listing: bool = False) -> Any:
    """One request under a signed-in session, through the one check, so a dead token asks the person to sign in again
    — never an empty list drawn as "nothing". PsiAnywhere's invalid-session words end it on any call. Placeholder rows
    end it on a LIST read (`listing`), where they are the verified sign; a write or a single-record lookup that answers
    them (or {}) may mean a real "nothing" — an account with no password on file, a write that answers empty — so one
    probe list read decides, and the answer is handed back as it came when the token is alive."""
    answer = _ask(method, body)
    if ended(answer) if listing else said_ended(answer):
        raise _signed_out(s)
    if not listing and placeholders(answer):
        _probe(s)
    return answer


def _refused_row(key: str) -> dict[str, Any] | None:
    rows = _db(f"select count, at from {REFUSALS_TABLE} where psi_user = %s", (key,), fetch=True)
    return {"count": int(rows[0][0] or 0), "at": rows[0][1].timestamp()} if rows else None


def _held_back(user: str) -> bool:
    """Whether PsiAnywhere refused this user name REFUSALS_BEFORE_LOCK times within REFUSAL_REST_S: memory first, the
    kept table when memory has nothing (a restart). A table that cannot be read holds nothing back."""
    key = user.lower()
    with _LOCK:
        r = _REFUSED.get(key)
    if r is None:
        r = _refused_row(key)
        if r is not None:
            with _LOCK:
                r = _REFUSED.setdefault(key, r)
    if r and _now() - r["at"] > REFUSAL_REST_S:
        with _LOCK:
            _REFUSED.pop(key, None)
        _db(f"delete from {REFUSALS_TABLE} where psi_user = %s and at < %s", (key, _ts(_now() - REFUSAL_REST_S)))
        return False
    return bool(r and r["count"] >= REFUSALS_BEFORE_LOCK)


def _refusal(user: str, count: int) -> None:
    """One more refusal, in memory and the kept table; the table's count wins when it is higher (memory was empty)."""
    key, now = user.lower(), _now()
    with _LOCK:
        r = _REFUSED.setdefault(key, {"count": 0, "at": 0.0})
        r["count"], r["at"] = max(r["count"] + 1, count), now
        mine = r["count"]
    rows = _db(f"insert into {REFUSALS_TABLE} as t (psi_user, count, at) values (%s, %s, %s)"
               " on conflict (psi_user) do update set count = case when t.at < %s then excluded.count"
               " else greatest(t.count + 1, excluded.count) end, at = excluded.at returning count",
               (key, mine, _ts(now), _ts(now - REFUSAL_REST_S)), fetch=True)
    if rows:
        with _LOCK:
            r["count"] = max(r["count"], int(rows[0][0] or 0))


def _signed_in(uid: str, user: str, got: dict[str, Any], at: float | None = None,
               borrowed: str = "") -> dict[str, Any]:
    """A session for this Hub account, in memory and its sealed row; the user name's refusals are forgotten."""
    at = _now() if at is None else at
    s = _session(uid, user, got, at, at + SESSION_LIFE_S, borrowed)
    with _LOCK:
        _REFUSED.pop(user.lower(), None)
        _PENDING.pop(uid, None)
        _SESS[uid] = s
        _bump(uid)
    _keep_held(uid, s)
    _db(f"delete from {REFUSALS_TABLE} where psi_user = %s", (user.lower(),))
    return s


def refusal_words(got: dict[str, Any]) -> str:
    word = got.get("word") or ""
    if word == "Failed attempts":
        return FAILED.get(str(got.get("data") or "").strip(), LOCKED)
    if word == "608":
        return "This user name does not exist in PsiAnywhere's demographics."
    return WORDS.get(word) or f"PsiAnywhere did not sign you in ({word or 'no answer it could read'})."


def platform_users() -> dict[str, str]:
    """The platform's own PsiAnywhere accounts (ADM, Ty — the ones that collect everyone's punches): user name in
    lowercase -> the md5 their credential file holds. Read where psi_anywhere reads them; '' when a file is absent."""
    import psi_anywhere as PA  # noqa: PLC0415
    out: dict[str, str] = {}
    for account in PA.ACCOUNTS:
        try:
            user, digest = PA._read_credential(account)
        except Exception:  # noqa: BLE001 - an unreadable file names nobody
            continue
        if user:
            out[user.strip().lower()] = digest
    return out


def is_platform(user: str) -> bool:
    return (user or "").strip().lower() in platform_users()


def platform_account_of(user: str) -> str:
    """Which stored platform account (adm/ty) this user name is, or '' — so an empty password uses its credential."""
    import psi_anywhere as PA  # noqa: PLC0415
    u = (user or "").strip().lower()
    for account in PA.ACCOUNTS:
        try:
            cu, cd = PA._read_credential(account)
        except Exception:  # noqa: BLE001
            continue
        if cu and cd and cu.strip().lower() == u:
            return account
    return ""


def platform_accounts() -> list[dict[str, str]]:
    """The stored platform accounts, for the sign-in page's one-click buttons: the one to pre-fill first, then the
    others (ADM, then Ty). The user name is not a secret; the password never leaves the server."""
    import psi_anywhere as PA  # noqa: PLC0415
    out = []
    for account in PA.ACCOUNTS:
        try:
            cu, cd = PA._read_credential(account)
        except Exception:  # noqa: BLE001
            continue
        if cu and cd:
            out.append({"account": account, "label": PA.ACCOUNT_LABELS.get(account, account), "user": cu})
    return out


def _lane_token(account: str) -> dict[str, Any] | None:
    """The attendance lane's kept session — {token, at} — when it is this account's and READ within LANE_FRESH_S
    (after it was obtained), so the master's one click spends none of the platform's rationed sign-ins. Read only: the
    lane's state is never written from here (its own _session_token drops a session its rules refuse, as its next beat
    would), and a token PsiAnywhere already answered as dead here is never borrowed again."""
    import psi_attendance as AT  # noqa: PLC0415
    try:
        if AT.held_here():
            return None
    except Exception:  # noqa: BLE001 - a lane that cannot say lends nothing
        return None
    if not AT._LOCK.acquire(timeout=LANE_WAIT_S):
        return None
    try:
        if not AT._S:
            return None  # the lane has not loaded its state in this process
        kept = dict(AT._S.get("session") or {})
        if str(kept.get("account") or "adm") != account:
            return None
        read_at, obtained = AT._read_at(), AT._instant(kept.get("obtained_at"))
        if read_at is None or obtained is None or read_at < obtained \
                or _now() - read_at.timestamp() > LANE_FRESH_S:
            return None
        token = AT._session_token()
    except Exception:  # noqa: BLE001 - nothing borrowed; the clock decides
        return None
    finally:
        AT._LOCK.release()
    if not token or _digest(token) in _DEAD_LANE:
        return None
    return {"token": token, "at": obtained.timestamp()}


def _ny_when(at: float) -> str:
    d, today = datetime.fromtimestamp(at, NY), datetime.fromtimestamp(_now(), NY).date()
    clock = d.strftime("%I:%M %p").lstrip("0")
    return f"{clock} New York time" if d.date() == today else f"{d:%m/%d} at {clock} New York time"


def _next_sign_in(account: str) -> str:
    """When the login clock will next let a PSI Log sign-in on this account go, in words; '' when it cannot say (the
    Ty line, an unmounted credential): every mark the clock keeps is tried in order, asked without taking a slot."""
    import psi_anywhere as PA  # noqa: PLC0415
    now = _now()
    try:
        snap = PA.login_snapshot()
        refused = (snap.get("refused_by") or {}).get(account) or {}
        down = snap.get("down") or {}
        marks = [float(snap.get("at") or 0.0) + PA.PSI_LOGIN_GAP_S,
                 float(refused.get("at") or 0.0) + PA.PSI_LOGIN_REFUSED_REST_S if refused else 0.0,
                 float(snap.get("paused_until") or 0.0), float(down.get("retry_at") or 0.0),
                 float(getattr(PA, "_login_state", {}).get("rested_until") or 0.0)]
        for at in sorted(m + 1 for m in marks if m + 1 > now):
            if PA.login_would_allow(at, account=account, purpose=CLOCK_PURPOSE)[0]:
                return _ny_when(at)
    except Exception:  # noqa: BLE001 - the words go without a time
        return ""
    return ""


def clock_words(account: str, why: str) -> str:
    """A platform sign-in the login clock did not let go, in plain words, with when the next one is possible."""
    import psi_anywhere as PA  # noqa: PLC0415
    label = PA.ACCOUNT_LABELS.get(account, account)
    when = _next_sign_in(account)
    head = (f"The Hub did not sign in with the platform's {label} account — every part of the Hub shares its "
            f"PsiAnywhere sign-ins, and none may go now: {why}.")
    return head + (f" The next sign-in is possible at {when}." if when
                   else " Try again later, or sign in with your own PsiAnywhere account.")


def _platform_login(account: str, user: str, digest: str, device: str) -> dict[str, Any]:
    """getLogIn for a platform account on the slot login_claim gave, settled on the clock exactly as the attendance
    lane's _sign_in settles it — but a two-factor prompt is settled as an attempt answered, without the account's
    word: it is not a refusal, and latching ADM for a day would stop the lane over a code the master can type."""
    import psi_anywhere as PSA  # noqa: PLC0415
    import psi_attendance as AT  # noqa: PLC0415
    try:
        answer = AT._ask("getLogIn", {"userId": user, "hash": digest, "deviceId": device or ""}, TIMEOUT_S)
    except AT.PsiPaused as exc:
        # the slot was claimed and nothing left: DOWN landed between the claim and the wire — nothing to settle
        raise Refused(f"PsiAnywhere is not answering now, so nothing was sent ({exc}). Try again later.", 503) from exc
    except AT.PsiAnswer as exc:
        PSA.login_settle("unknown", "", account=account)
        raise Refused(f"PsiAnywhere answered something the Hub cannot read ({exc}).", 502) from exc
    except AT.PsiTransport as exc:
        PSA.login_settle("unknown", "", account=account)
        raise Refused(f"PsiAnywhere could not be reached ({exc}). Nothing changed here; try again.", 503) from exc
    except Exception as exc:  # noqa: BLE001 - a login that never landed is a reason, not a crash
        PSA.login_settle("unknown", "", account=account)
        raise Refused(f"PsiAnywhere could not be asked ({type(exc).__name__}). Try again.", 503) from exc
    got = read_login(answer)
    _token, word = AT.read_login(answer)
    if not word:
        PSA.login_settle("unknown", "", account=account)
        if got["word"]:
            raise Refused(refusal_words(got), 409, got["word"])
        raise Refused("PsiAnywhere answered the sign-in with nothing the Hub can read. Try again later.", 502,
                      "unreadable")
    PSA.login_settle("up", "" if got["word"] == "2FA" else ("Token" if got["token"] else word), account=account)
    return got


def platform_sign_in(uid: str, account: str, device: str = "", master: bool = False) -> dict[str, Any]:
    """Sign in with a stored platform account's own credential (its md5, never a password in the open), so the login
    and password are pre-set for the master — one click, and the MASTER's alone: anyone else is refused (403) before
    anything is read or sent. The attendance lane's fresh token is borrowed when it is this account's; otherwise the
    sign-in goes through the platform's one login clock, which rations and latches every lane's sign-ins on ADM and
    Ty — a rationed or latched one is said plainly, with when the next is possible."""
    import psi_anywhere as PA  # noqa: PLC0415
    if not master:
        raise Refused(MASTER_ONLY, 403, "master-only")
    account = PA._account(account)
    user, digest = PA._read_credential(account)
    if not user or not digest:
        raise Refused(f"The {PA.ACCOUNT_LABELS.get(account, account)} PsiAnywhere account is not set up here.", 409,
                      "no-platform")
    lane = _lane_token(account)
    if lane:
        _signed_in(uid, user, {"token": lane["token"], "userId": user}, at=lane["at"], borrowed=account)
        log.info("psi log: %s borrowed the attendance lane's %s session (no new sign-in)", uid,
                 PA.ACCOUNT_LABELS.get(account, account))
        return {"signedIn": True, "name": user, "via": "lane"}
    ok, why = PA.login_claim(CLOCK_PURPOSE, account=account)
    if not ok:
        raise Refused(clock_words(account, why), 409, "rationed")
    got = _platform_login(account, user, digest, device)
    if got["token"]:
        s = _signed_in(uid, user, got)
        return {"signedIn": True, "name": f"{s['first']} {s['last']}".strip() or user}
    if got["word"] == "2FA":
        with _LOCK:
            _PENDING[uid] = {"user": user, "device": got["data"], "at": _now()}
        return {"signedIn": False, "needsCode": True}
    raise Refused(refusal_words(got), 409, got["word"] or "refused")


def sign_in(uid: str, user: str, password: str, device: str = "", master: bool = False) -> dict[str, Any]:
    """getLogIn with the person's account: signed in, a two-factor code asked for, or PsiAnywhere's refusal. An empty
    password for a stored platform account (ADM, Ty) uses its stored credential — the login is pre-set, for the master
    alone: the platform's accounts, one click or typed, are refused to anyone else (403) and nothing is sent."""
    user = (user or "").strip()
    if not user:
        raise Refused("Type your PsiAnywhere user name.", 400)
    if not master and is_platform(user):
        raise Refused(MASTER_ONLY, 403, "master-only")
    if not (password or "").strip():
        account = platform_account_of(user)
        if account:
            return platform_sign_in(uid, account, device, master)
        raise Refused("Type your PsiAnywhere password.", 400)
    if _held_back(user):
        raise Refused(HELD_BACK, 409, "held-back")
    # their login page: the md5 of the trimmed password, never the password itself
    digest = hashlib.md5(password.strip().encode()).hexdigest()
    # THE COLLECTION'S OWN ACCOUNTS: a wrong password is never sent for them — three lock the account every punch is
    # collected with — so it is checked here, against the credential the platform signs in with
    kept_digest = platform_users().get(user.lower())
    if kept_digest is not None and kept_digest and digest != kept_digest:
        raise Refused(f"That is not {user}'s password. {user} is the account the platform collects everyone's punches "
                      "with, so a wrong password for it is never sent to PsiAnywhere.", 409, "platform-wrong")
    # the platform account's own password, typed: the same sign-in as the one click, through the same login clock
    if kept_digest:
        account = platform_account_of(user)
        if account:
            return platform_sign_in(uid, account, device, master)
    got = read_login(_ask("getLogIn", {"userId": user, "hash": digest, "deviceId": device or ""}))
    if got["token"]:
        s = _signed_in(uid, user, got)
        return {"signedIn": True, "name": f"{s['first']} {s['last']}".strip() or user}
    if got["word"] == "2FA":
        with _LOCK:
            _PENDING[uid] = {"user": user, "device": got["data"], "at": _now()}
        return {"signedIn": False, "needsCode": True}
    if got["word"] == "Failed attempts":
        n = int(got["data"]) if str(got["data"]).strip().isdigit() else REFUSALS_BEFORE_LOCK + 1
        _refusal(user, n)
    elif got["word"] == "Invalid username":
        _refusal(user, 1)
    raise Refused(refusal_words(got), 409, got["word"] or "refused")


def send_code(uid: str, code: str) -> tuple[dict[str, Any], str, str]:
    """authenticatedLogin with the two-factor code; (answer, user, device to keep)."""
    with _LOCK:
        p = _PENDING.get(uid)
    if not p or _now() - p["at"] > 900:
        raise Refused("Sign in again to get a new verification code.", 409, "no-code-asked")
    code = (code or "").strip()
    if not code:
        raise Refused("Type the verification code PsiAnywhere sent you.", 400)
    answer = _ask("authenticatedLogin", {"userName": p["user"], "genKey": code})
    word = str(answer or "").strip()
    if word in CODE_WORDS:
        if word != "Invalid key":
            with _LOCK:
                _PENDING.pop(uid, None)
        raise Refused(CODE_WORDS[word], 409, word)
    got = read_login(answer)
    if not got["token"]:
        raise Refused(refusal_words(got), 409, got["word"] or "refused")
    s = _signed_in(uid, p["user"], got)
    return {"signedIn": True, "name": f"{s['first']} {s['last']}".strip() or p["user"]}, p["user"], p["device"]


def sign_out(uid: str) -> str:
    """Forget the session here — memory and its kept row. PsiAnywhere is never told, so a token borrowed from the
    attendance lane is only let go of here: the lane keeps reading with it."""
    s = session_of(uid)
    with _LOCK:
        _PENDING.pop(uid, None)
    _drop(uid)
    return s["user"] if s else ""


# ---- what the person sees --------------------------------------------------------------------------------------------

def _today() -> date:
    return datetime.now(NY).date()


def codes(s: dict[str, Any]) -> list[dict[str, Any]]:
    """The active work codes, kept for the session — never an empty list: PsiAnywhere gives every account its codes,
    so none is a read to make again (a dead token's placeholders never get this far)."""
    if not s.get("codes"):
        rows = _rows(_asked(s, "getWorkCodesJSON", {"token": s["token"]}, listing=True))
        got = sorted(({"id": _pick(r, "workcodeid", "WorkCodeID", "id"),
                       "name": _pick(r, "workcodename", "WorkCodeName", "name"),
                       "billable": _pick(r, "billable").upper() == "Y",
                       "keytimes": _pick(r, "keytimes").upper()}
                      for r in rows if _pick(r, "active").upper() in ("Y", "")
                      and _pick(r, "workcodeid", "WorkCodeID", "id")),
                     key=lambda c: c["name"].lower())
        if not got:
            return []
        s["codes"] = got
    return s["codes"]


def locations(s: dict[str, Any]) -> list[dict[str, str]]:
    """The places this person may save time at: Single Entry's list, else the staff locations the login named."""
    if s.get("places") is None:
        try:
            rows = _rows(_asked(s, "getSingleEntryLocationsJSON", {"token": s["token"]}, listing=True))
        except Refused as exc:
            if exc.word == "signed-out":
                raise
            rows = []
        places = [{"id": _pick(r, "ID", "locationID", "locationId", "Location_ID"),
                   "name": _pick(r, "Name", "shortDescription", "description", "Location_Name")} for r in rows]
        places = [p for p in places if p["id"]] or list(s["locations"])
        s["places"] = sorted(places, key=lambda p: p["name"].lower())
    return s["places"]


def entries(s: dict[str, Any], days: int = 1) -> list[dict[str, Any]]:
    """The person's own entries from `days` days back through today, newest first."""
    today = _today()
    rows = _rows(_asked(s, "getSingleEntryByDateJSON", {
        "token": s["token"], "userId": s["userId"], "startDate": (today - timedelta(days=days)).isoformat(),
        "endDate": today.isoformat(), "locationId": "%", "statusIn": ""}, listing=True))
    out = [entry_of(r) for r in rows]
    out = [dict(e, statusName=STATUS.get(e["status"], e["status"])) for e in out if e["id"]]
    return sorted(out, key=lambda e: (e["date"], e["start"]), reverse=True)


def open_entry(rows: list[dict[str, Any]]) -> dict[str, Any] | None:
    """The entry the person is clocked in on: started, no end yet."""
    return next((e for e in rows if e["start"] and not e["end"]), None)


def consumers(s: dict[str, Any]) -> list[dict[str, str]]:
    """The people PsiAnywhere lets this person save time for (its roster, everyone active)."""
    today = _today()
    rows = _rows(_asked(s, "getConsumersByGroupJSON", {
        "groupCode": "ALL", "retrieveId": "0", "token": s["token"], "serviceDate": today.isoformat(),
        "daysBackDate": (today - timedelta(days=7)).isoformat(), "isActive": "Yes"}, listing=True))
    out = []
    for r in rows:
        cid = _pick(r, "id", "consumerId", "consumer_id", "ID")
        name = " ".join(x for x in (_pick(r, "FN", "firstName", "FirstName"),
                                    _pick(r, "LN", "lastName", "LastName")) if x) or _pick(r, "name")
        if cid and name:
            out.append({"id": cid, "name": name})
    return sorted({c["id"]: c for c in out}.values(), key=lambda c: c["name"].lower())


# ---- the clock -------------------------------------------------------------------------------------------------------

def _gps(body: dict[str, Any]) -> tuple[str, str]:
    lat, lng = str(body.get("latitude") or "").strip(), str(body.get("longitude") or "").strip()
    try:
        if not (-90 <= float(lat) <= 90 and -180 <= float(lng) <= 180):
            raise ValueError
    except ValueError:
        raise Refused("PsiAnywhere needs where you are: allow this page to use your location, then try again.",
                      400, "no-gps") from None
    return lat, lng


def _entry_id(answer: Any) -> str:
    # their screen splits the answer at '@singleEntryRecordID>': the id follows, '-1' when the time is already held
    m = re.search(r"singleEntryRecordID[^-\d]{0,6}(-?\d+)\b(?!\s*:)", str(answer or ""))
    return m.group(1) if m else ""


def _said(answer: Any) -> str:
    """PsiAnywhere's answer as words, for a refusal that carries no entry."""
    text = re.sub(r"<[^>]+>", " ", str(answer if not isinstance(answer, (dict, list)) else json.dumps(answer)))
    return re.sub(r"\s+", " ", text).strip()[:200] or "no answer"


def _saved(made: list[str]) -> None:
    """Only an entry number is a saved entry: '-1' is a time PsiAnywhere already holds, anything else its refusal
    ("558: Error inserting single entry")."""
    if made and all(re.fullmatch(r"\d+", m) for m in made):
        return
    if "-1" in made:
        raise Refused("PsiAnywhere already holds an entry for this time, so nothing new was saved.", 409, "exists")
    why = next((m for m in made if not re.fullmatch(r"\d+", m)), "") or "no entry number"
    raise Refused(f"PsiAnywhere did not save the entry — it answered: {why}", 409, "not-saved")


PLATFORM_CLOCK = ("{user} is the platform's own PsiAnywhere account — it collects everyone's punches and is not a "
                  "person, so it never clocks in: a billable entry under it would be a visit nobody made. Clock in "
                  "with a person's own account.")


def _a_person(s: dict[str, Any]) -> None:
    if is_platform(s["user"]):
        raise Refused(PLATFORM_CLOCK.format(user=s["user"]), 409, "platform-account")


def clock_in(s: dict[str, Any], body: dict[str, Any]) -> dict[str, Any]:
    """Single Entry's Save of a started entry: start time now (New York), the work code, a location (or, for a
    billable code, the clients present), the phone's place. Saved, not submitted."""
    _a_person(s)
    if open_entry(entries(s)):
        raise Refused("You are already clocked in. Clock out first.", 409, "already-in")
    code = next((c for c in codes(s) if c["id"] == str(body.get("workCodeId") or "")), None)
    if not code:
        raise Refused("Choose a work code.", 400)
    ids = [str(i).strip() for i in (body.get("consumerIds") or []) if str(i).strip()]
    location = "" if code["billable"] else str(body.get("locationId") or "").strip()
    if code["billable"] and not ids:
        raise Refused(f"{code['name']} is billable: choose the people you are with.", 400)
    if not code["billable"] and not any(p["id"] == location for p in locations(s)):
        raise Refused("Choose where you are working.", 400)
    lat, lng = _gps(body)
    now = datetime.now(NY)
    data = {
        "token": s["token"], "userId": s["userId"], "updaterId": "", "personId": 0, "checkHours": "",
        "crossMidnightCheckHours": "", "consumerId": ",".join(ids), "dateOfService": now.date().isoformat(),
        "defaultStartTimeChanged": False, "defaultEndTimeChanged": False, "endTime": "", "endLatitude": "",
        "endLongitude": "", "inComments": str(body.get("note") or "").strip()[:1000], "latitude": lat,
        "longitude": lng, "locationId": location, "numberOfConsumersPresent": len(ids),
        "startTime": now.strftime("%H:%M"), "workCodeID": code["id"], "destination": "", "origination": "",
        "licensePlateNumber": "", "odometerEnd": None, "odometerStart": None, "transportationEndTime": "",
        "transportationStartTime": "", "reason": "", "transportationReimbursable": "", "transportationUnits": "",
        "deviceType": "Mobile" if body.get("mobile") else "Other", "evvReason": "", "attest": "N",
        "community": "N", "evvLocationType": None}
    if location or not ids:
        answer = _asked(s, "insertSingleEntry", data)
        made = [_entry_id(answer) or _said(answer)]
    else:
        overlaps = _rows(_asked(s, "getSelectedConsumerLocations", data))
        if overlaps:
            raise Refused("Someone you chose lives at more than one PsiAnywhere location. Clock in on PsiAnywhere "
                          "this time, where you can pick the location for them.", 409, "overlap")
        answer = _asked(s, "preInsertSingleEntry", data)
        made = [_pick(r, "singleEntryId") for r in _rows(answer)] or [_said(answer)]
    _saved(made)
    return {"entryIds": made, "start": data["startTime"], "workCode": code["name"],
            "billable": code["billable"], "people": len(ids)}


def _hours(start: str, end: str) -> str:
    a = datetime.strptime(start, "%H:%M")
    b = datetime.strptime(end, "%H:%M")
    return f"{(b - a).total_seconds() / 3600:.2f}"


def clock_out(s: dict[str, Any], body: dict[str, Any]) -> dict[str, Any]:
    """Single Entry's Update of the open entry: the end time now, the hours, the phone's place; submitted for approval
    only when the person attested it (updateSingleEntryStatus S)."""
    _a_person(s)
    rows = entries(s)
    sid = str(body.get("singleEntryId") or "").strip()
    mine = next((e for e in rows if e["id"] == sid and e["start"] and not e["end"]), None)
    if not mine:
        raise Refused("That entry is not open on your PsiAnywhere account any more. Refresh and look again.", 409,
                      "not-open")
    lat, lng = _gps(body)
    ed = next(iter(_rows(_asked(s, "getSingleEntryByIdJSON", {"token": s["token"], "singleEntryId": sid}))), None)
    if not ed:
        raise Refused("PsiAnywhere did not hand the entry back, so it was not changed.", 502, "unread")
    now = datetime.now(NY)
    start, end = _hhmm(_pick(ed, "Start_Time")) or mine["start"], now.strftime("%H:%M")
    day = _iso_day(_pick(ed, "Date_of_Service")) or mine["date"]
    if day != now.date().isoformat() or end < start:
        raise Refused("This entry started on another day. Clock out on PsiAnywhere, which splits it at midnight.",
                      409, "cross-midnight")
    present = int(_pick(ed, "Number_Consumers_Present") or 0)
    ids: list[str] = []
    if present:
        ids = [_pick(r, "consumerId", "consumer_id", "id", "ID")
               for r in _rows(_asked(s, "getSingleEntryConsumersPresentJSON",
                                     {"token": s["token"], "singleEntryId": sid}))]
        ids = [i for i in ids if i]
        if len(ids) != present:
            raise Refused("PsiAnywhere did not name the people on this entry, so it was not changed. Clock out on "
                          "PsiAnywhere this time.", 502, "unread-people")
    data = {
        "token": s["token"], "userId": s["userId"], "singleEntryId": sid, "checkHours": _hours(start, end),
        "crossMidnightCheckHours": "", "consumerId": ",".join(ids), "dateOfService": day,
        "defaultStartTimeChanged": False, "defaultEndTimeChanged": False, "endTime": end, "endLatitude": lat,
        "endLongitude": lng, "inComments": _pick(ed, "Comments"), "locationId": _pick(ed, "Location_ID"),
        "numberOfConsumersPresent": present or len(ids), "startTime": start,
        "workCodeID": _pick(ed, "Work_Code_ID"), "destination": _pick(ed, "destination"),
        "origination": _pick(ed, "origination"), "licensePlateNumber": _pick(ed, "licensePlateNumber"),
        "odometerEnd": _pick(ed, "odometerend") or None, "odometerStart": _pick(ed, "odometerstart") or None,
        "transportationEndTime": _pick(ed, "transportationendtime"),
        "transportationStartTime": _pick(ed, "transportationstarttime"), "reason": _pick(ed, "reason"),
        "transportationReimbursable": _pick(ed, "Transportation_reimbursable"),
        "transportationUnits": _pick(ed, "Transportation_Units"),
        "deviceType": "Mobile" if body.get("mobile") else "Other", "evvReason": "",
        "attest": _pick(ed, "attest") or "N", "community": _pick(ed, "community") or "N", "updateEVVReason": "true",
        "evvLocationType": _pick(ed, "locationTypeCode") or None}
    answer = _said(_asked(s, "updateSingleEntry", data))
    if answer == "-1":
        raise Refused("PsiAnywhere already holds an entry for this time, so the end was not saved.", 409, "exists")
    if re.search(r"error|exception|fail", answer, re.I):
        raise Refused(f"PsiAnywhere did not save the end — it answered: {answer}", 409, "not-saved")
    submitted = False
    if body.get("submit") is True:
        said = _said(_asked(s, "updateSingleEntryStatus", {"token": s["token"], "singleEntryIdString": sid,
                                                           "newStatus": "S"}))
        if re.search(r"error|exception|fail", said, re.I):
            raise Refused(f"The end was saved, but PsiAnywhere did not take the submit — it answered: {said}", 409,
                          "not-submitted")
        submitted = True
    return {"entryId": sid, "start": start, "end": end, "hours": data["checkHours"], "submitted": submitted}


# ---- resetting a person's PsiAnywhere password -----------------------------------------------------------------------
# The Reset Password page: the master gives an employee a new PsiAnywhere password (the operator, 2026-10-28: people
# forget and mistype theirs). It is PsiAnywhere's own admin reset (resetPassword), done under the signed-in admin
# session, so the person's own credential — not the platform's — carries it. The password is shown to the master to
# tell the person, and it is never kept or logged.

import secrets  # noqa: E402

# a readable default, easy to say over the phone: no l/1/o/0; the policy's own minimum, special char and classes
SPEAK = "abcdefghijkmnpqrstuvwxyz"
SPEAK_UP = "ABCDEFGHJKLMNPQRSTUVWXYZ"
DIGITS = "23456789"
RESET_FEATURE = "psi-log.passwordReset"


def policy(s: dict[str, Any]) -> dict[str, Any]:
    """PsiAnywhere's own password rule (getStrongPassword): its minimum length, the special characters it allows, and
    whether a strong password is required. Kept for the session; a sane default when it cannot be read."""
    if s.get("policy") is None:
        pol = {"strong": True, "special": "!#$%*@", "length": 8}
        try:
            text = str(_ask("getStrongPassword", {})).replace("<\\/", "</")
            vals = [v.strip() for _t, v in re.findall(r"<([^/>]+)>([^<]*)</\1>", text)]
            if vals:
                pol["strong"] = vals[0].upper() in ("Y", "YES", "TRUE", "1")
            if len(vals) > 1 and vals[1]:
                pol["special"] = vals[1]
            if len(vals) > 2 and re.search(r"\d", vals[2]):
                pol["length"] = max(8, int(re.sub(r"\D", "", vals[2])))
        except Exception:  # noqa: BLE001 - the default rule stands
            pass
        s["policy"] = pol
    return s["policy"]


def passes(pw: str, pol: dict[str, Any]) -> bool:
    """Whether a password meets the rule: the length, an upper- and a lower-case letter, a number, and one allowed
    special character."""
    return bool(pw and len(pw) >= pol["length"] and re.search(r"[a-z]", pw) and re.search(r"[A-Z]", pw)
                and re.search(r"\d", pw) and any(c in (pol["special"] or "!#$%*@") for c in pw))


def default_password(pol: dict[str, Any]) -> str:
    """A standard password that meets the rule and is different every time (so PsiAnywhere's no-reuse rule lets it
    through), still easy to read to a person: a capital, letters, a special character and four digits."""
    sp = next((c for c in "!#$*@" if c in (pol["special"] or "")), (pol["special"] or "!")[:1]) or "!"
    for _ in range(40):
        pw = (secrets.choice(SPEAK_UP) + "".join(secrets.choice(SPEAK) for _ in range(3)) + sp
              + "".join(secrets.choice(DIGITS) for _ in range(4)))
        while len(pw) < pol["length"]:
            pw += secrets.choice(SPEAK)
        if passes(pw, pol):
            return pw
    return "Asa" + sp + "".join(secrets.choice(DIGITS) for _ in range(5))


def reset_users(s: dict[str, Any], include_inactive: bool = False) -> list[dict[str, Any]]:
    """The accounts the master may reset: PsiAnywhere's active users, and the inactive ones when asked."""
    out: dict[str, dict[str, Any]] = {}
    for active in (["Y"] + (["N"] if include_inactive else [])):
        for r in _rows(_asked(s, "getActiveInactiveUserDateJSON", {"token": s["token"], "isActive": active},
                              listing=True)):
            uid = _pick(r, "id", "UserID", "User_ID", "userId", "userid")
            name = " ".join(x for x in (_pick(r, "FirstName", "First_Name", "firstName"),
                                        _pick(r, "LastName", "Last_Name", "lastName")) if x)
            if uid and (uid not in out or active == "Y"):
                out[uid] = {"id": uid, "name": name or uid, "active": active == "Y",
                            "term": _pick(r, "TermDate", "Term_Date")}
    return sorted(out.values(), key=lambda u: u["name"].lower())


def reset_password(s: dict[str, Any], body: dict[str, Any]) -> dict[str, Any]:
    """PsiAnywhere's admin reset of one account: the standard password, or one the master typed, set under the signed-in
    admin session. Returns the password set, to tell the person; it is never kept or logged."""
    uid = str(body.get("userId") or "").strip()
    if not uid:
        raise Refused("Choose a person.", 400)
    if is_platform(s["user"]) and uid.strip().lower() == s["user"].strip().lower():
        raise Refused("Change the platform account's own password in PsiAnywhere, not here.", 409, "platform-own")
    pol = policy(s)
    typed = not body.get("useDefault")
    new = str(body.get("password") or "") if typed else default_password(pol)
    if typed and not passes(new, pol):
        raise Refused(f"That password does not meet PsiAnywhere's rule: at least {pol['length']} characters, with an "
                      f"upper- and a lower-case letter, a number, and one of {pol['special']}.", 400, "weak")
    # PsiAnywhere's admin reset authenticates the change with the account's current credential (getUserCredDateJSON);
    # it is used only to build the hash resetPassword wants, never kept. A lookup, not a list: a row with no password
    # is a probe away from "did not return this account's credential", never a sign-out on its own
    cred = _rows(_asked(s, "getUserCredDateJSON", {"token": s["token"], "userId": uid}))
    current = _pick(cred[0], "password", "Password") if cred else ""
    if not current:
        raise Refused("PsiAnywhere did not return this account's credential, so the password was not changed. Your "
                      "PsiAnywhere account may not be an administrator.", 502, "no-cred")
    cur_hash = hashlib.md5(current.encode()).hexdigest()
    for attempt in (1, 2):
        answer = _said(_ask("resetPassword", {"userId": uid, "hash": cur_hash, "newPassword": new,
                                              "changingToHashPassword": hashlib.md5(new.encode()).hexdigest()}))
        if "Not active" in answer:
            raise Refused("That PsiAnywhere account is inactive, so it cannot be signed in to even with a new "
                          "password. Activate it in PsiAnywhere first.", 409, "inactive")
        if "611" in answer:
            if not typed and attempt == 1:
                new = default_password(pol)
                continue
            raise Refused("PsiAnywhere does not allow reusing a recent password. Type a different one.", 409, "reuse")
        if "610" in answer or re.search(r"error|exception|fail", answer, re.I):
            raise Refused(f"PsiAnywhere did not change the password — it answered: {answer}", 409, "not-changed")
        return {"userId": uid, "password": new, "how": "typed" if typed else "default"}
    raise Refused("PsiAnywhere kept refusing the password. Try again.", 409, "not-changed")


# ---- approving a person's time entries -------------------------------------------------------------------------------
# The master approves time entries that are awaiting approval (the operator, 2026-10-28). It is PsiAnywhere's own admin
# approval (adminUpdateSingleEntryStatus), done under the signed-in admin session, exactly as its review grid does it:
# an "Awaiting approval" (A) entry becomes "Submitted" (S). Weighty — these are payroll hours — so only the master,
# until he releases it in App Control, and never the platform account's own entries (it has none).

APPROVE_BATCH = 100


def decide_entries(s: dict[str, Any], items: list[dict[str, Any]], decision: str = "approve",
                   reason: str = "") -> dict[str, Any]:
    """Every chosen entry that is awaiting approval approved (Submitted) or rejected, as PsiAnywhere's review grid does
    it (adminUpdateSingleEntryStatus, newStatus S for approve, R with a reason for reject). Others are left alone."""
    reject = decision == "reject"
    if reject and not reason.strip():
        raise Refused("Type why you are rejecting these entries.", 400, "no-reason")
    ids = [str(it.get("id") or "").strip() for it in items
           if str(it.get("status") or "").strip().upper() == "A" and str(it.get("id") or "").strip()]
    ids = list(dict.fromkeys(ids))
    skipped = len(items) - len(ids)
    if not ids:
        raise Refused("None of the chosen entries are awaiting approval.", 400, "none")
    out: dict[str, Any] = {"decided": 0, "decision": decision, "skipped": skipped, "failed": []}
    for i in range(0, len(ids), APPROVE_BATCH):
        batch = ids[i:i + APPROVE_BATCH]
        answer = _said(_asked(s, "adminUpdateSingleEntryStatus", {
            "token": s["token"], "singleEntryIdString": ",".join(batch), "newStatus": "R" if reject else "S",
            "userID": s["userId"], "rejectionReason": reason.strip()[:500] if reject else ""}))
        if re.search(r"error|exception|fail", answer, re.I):
            out["failed"].append({"count": len(batch), "why": answer})
        else:
            out["decided"] += len(batch)
    if not out["decided"] and out["failed"]:
        word = "reject" if reject else "approve"
        raise Refused(f"PsiAnywhere did not {word} the entries — it answered: {out['failed'][0]['why']}", 409,
                      "not-" + ("rejected" if reject else "approved"))
    return out


def approve_entries(s: dict[str, Any], items: list[dict[str, Any]]) -> dict[str, Any]:
    """Approve (Submitted) the chosen awaiting entries; keeps the "approved" count for its own door."""
    got = decide_entries(s, items, "approve")
    return {"approved": got["decided"], "skipped": got["skipped"], "failed": got["failed"]}


# ---- a person's PsiAnywhere account on or off -------------------------------------------------------------------------
# updateActiveInactiveUser: deactivate a departed employee's account (they can no longer sign in) or reactivate one,
# as PsiAnywhere's own user page does. The platform's own accounts are never switched off here.

def set_account_active(s: dict[str, Any], user_id: str, active: bool) -> dict[str, Any]:
    """Turn a PsiAnywhere account on or off (updateActiveInactiveUser)."""
    user_id = (user_id or "").strip()
    if not user_id:
        raise Refused("Choose a person.", 400, "missing")
    if is_platform(s["user"]) and user_id.strip().lower() == s["user"].strip().lower():
        raise Refused("The platform account is not switched off here.", 409, "platform-own")
    answer = _said(_asked(s, "updateActiveInactiveUser", {"token": s["token"], "isActive": "Y" if active else "N",
                                                          "userId": user_id}))
    if re.search(r"error|exception|fail", answer, re.I):
        raise Refused(f"PsiAnywhere did not change the account — it answered: {answer}", 409, "not-changed")
    return {"userId": user_id, "active": active}


# ---- creating a client in PsiAnywhere --------------------------------------------------------------------------------
# PsiAnywhere's own "add individual" (insertNewIndividual), under the signed-in admin session, exactly as its roster
# adds one: name, consumer and billing number, the customer and location it belongs to, its address and dates, EVV
# eligibility and the SELF waiver. A client is billing and EVV, so the master's alone until he releases it.

CLIENT_REQUIRED = (("first name", "firstName"), ("last name", "lastName"), ("consumer number", "consumerNumber"),
                   ("customer", "defaultCustomer"), ("location", "currentlocation"))


def _options(answer: Any) -> list[dict[str, str]]:
    return [{"id": _pick(r, "ID", "id"), "name": _pick(r, "Name", "name", "value")}
            for r in _rows(answer) if _pick(r, "ID", "id")]


def new_client_form(s: dict[str, Any]) -> dict[str, Any]:
    """The customers and locations a new client can belong to (PsiAnywhere's own dropdowns)."""
    return {"customers": _options(_asked(s, "getCustomerDropdown", {"token": s["token"]}, listing=True)),
            "locations": _options(_asked(s, "getCurrentLocationDropdown", {"token": s["token"]}, listing=True))}


def create_client(s: dict[str, Any], body: dict[str, Any]) -> dict[str, Any]:
    """A client added to PsiAnywhere. A consumer number already in use is refused; a name already on record asks to go
    on (force), as PsiAnywhere's own form does. Returns the new client's id."""
    def g(k: str) -> str:
        return str(body.get(k) or "").strip()

    missing = [label for label, key in CLIENT_REQUIRED if not g(key)]
    if missing:
        raise Refused("Fill in: " + ", ".join(missing) + ".", 400, "missing")
    first, last, num = g("firstName"), g("lastName"), g("consumerNumber")
    nums = _rows(_asked(s, "getConsumerNumberList", {"token": s["token"]}, listing=True))
    if any(_pick(r, "ConsumerNumber", "consumerNumber").strip() == num for r in nums):
        raise Refused(f"Consumer number {num} is already in use in PsiAnywhere. Choose another.", 409, "number-used")
    if not body.get("force") and any(
            _pick(r, "ConsumerFirstName", "firstName").strip().lower() == first.lower()
            and _pick(r, "ConsumerLastName", "lastName").strip().lower() == last.lower() for r in nums):
        return {"needsConfirm": True,
                "message": f"PsiAnywhere already has an individual named {first} {last}. Add this one anyway?"}
    answer = _asked(s, "insertNewIndividual", {
        "token": s["token"], "userId": s["userId"], "firstName": first, "lastName": last, "consumerNumber": num,
        "billingNumber": g("billingNumber") or num, "defaultCustomer": g("defaultCustomer"),
        "currentlocation": g("currentlocation"), "address1": g("address1"), "address2": g("address2"),
        "city": g("city"), "state": g("state").upper()[:2], "zipcode": g("zipcode"), "dateActive": g("dateActive"),
        "dateBirth": g("dateBirth"), "EVVEligibleChk": "Y" if body.get("evvEligible") else "N",
        "SELFWaiver": "Y" if body.get("selfWaiver") else "N"})
    rows = _rows(answer)
    new_id = _pick(rows[0], "ID", "id") if rows else ""
    if not new_id:
        raise Refused(f"PsiAnywhere did not add the client — it answered: {_said(answer)}", 409, "not-created")
    return {"id": new_id, "name": f"{first} {last}", "consumerNumber": num}


# ---- the log ---------------------------------------------------------------------------------------------------------

def kept(store: Any, uid: str, user: str, action: str, ok: bool, word: str = "", entry: str = "",
         detail: dict[str, Any] | None = None) -> None:
    """One step into app.psi_log_events; a store that cannot take it is logged, never the person's problem."""
    try:
        with store.locked() as tx:
            tx.cur.execute("insert into app.psi_log_events (hub_uid, psi_user, action, ok, word, entry_id, detail)"
                           " values (%s, %s, %s, %s, %s, %s, %s)",
                           (uid, user, action, ok, word[:200], entry, json.dumps(detail or {}, default=str)))
    except Exception as exc:  # noqa: BLE001 - the step happened; only its line is missing
        log.warning("psi log: the %s line for %s was not kept (%s)", action, uid, type(exc).__name__)


def device_of(reads: Any, uid: str, user: str) -> str:
    try:
        rows = reads.db.query("select device_guid from app.psi_log_devices where hub_uid = %s and psi_user = %s",
                              (uid, user.lower()))
    except Exception:  # noqa: BLE001 - no device means PsiAnywhere may ask a code; nothing worse
        return ""
    return str(rows[0][0] or "") if rows else ""


def keep_device(store: Any, uid: str, user: str, device: str) -> None:
    if not device:
        return
    try:
        with store.locked() as tx:
            tx.cur.execute("insert into app.psi_log_devices (hub_uid, psi_user, device_guid) values (%s, %s, %s)"
                           " on conflict (hub_uid, psi_user) do update set device_guid = excluded.device_guid,"
                           " updated_at = now()", (uid, user.lower(), device))
    except Exception as exc:  # noqa: BLE001 - the next sign-in asks a code again; nothing worse
        log.warning("psi log: the device for %s was not kept (%s)", uid, type(exc).__name__)


def history(reads: Any, uid: str, everyone: bool = False, limit: int = 40) -> list[dict[str, Any]]:
    sql = ("select at, hub_uid, psi_user, action, ok, word, entry_id, detail from app.psi_log_events"
           + ("" if everyone else " where hub_uid = %s") + " order by at desc limit %s")
    try:
        rows = reads.db.query(sql, (limit,) if everyone else (uid, limit))
    except Exception:  # noqa: BLE001 - the log is shown as unread, never as empty
        return [{"unread": True}]
    out = []
    for at, who, user, action, ok, word, entry, detail in rows:
        d = detail if isinstance(detail, dict) else json.loads(detail or "{}")
        out.append({"at": at.isoformat() if hasattr(at, "isoformat") else str(at), "uid": who, "psiUser": user,
                    "action": action, "ok": bool(ok), "word": word, "entryId": entry, "detail": d})
    return out


def view(reads: Any, uid: str, is_master: bool) -> dict[str, Any]:
    s = session_of(uid)
    out: dict[str, Any] = {"signedIn": bool(s), "needsCode": False, "attest": ATTEST,
                           "log": history(reads, uid), "everyone": history(reads, uid, True) if is_master else None}
    if s:
        out.update(name=f"{s['first']} {s['last']}".strip() or s["user"], psiUser=s["user"])
        if is_platform(s["user"]):
            out["platform"] = PLATFORM_CLOCK.format(user=s["user"])
        try:
            rows = entries(s)
            out.update(entries=rows, open=open_entry(rows), codes=codes(s), locations=locations(s))
            return out
        except Refused as exc:
            if exc.word != "signed-out":
                out["why"] = str(exc)
                return out
            # PsiAnywhere let go of the token: the sign-in again, never a signed-in screen with empty lists
            for k in ("name", "psiUser", "platform", "entries", "open", "codes", "locations"):
                out.pop(k, None)
            out.update(signedIn=False, ended=str(exc))
    with _LOCK:
        out["needsCode"] = uid in _PENDING
    # the login pre-set for the MASTER alone: the platform accounts whose credential the Hub holds (ADM first), so an
    # empty password signs in with the stored one; the user name shown is not a secret. Anyone else the app is opened
    # to is never offered them (no one click, no pre-filled name) — they sign in with their own account
    if is_master:
        accounts = platform_accounts()
        out["platformAccounts"] = accounts
        out["prefill"] = accounts[0]["user"] if accounts else ""
    return out


# ---- a collection now, under the asker's own session -----------------------------------------------------------------

def harvest_ask(s: dict[str, Any]) -> Callable[[str, dict[str, Any]], Any]:
    """psi_harvest's ask under a person's PSI Log session, through the one check, so a token that dies mid-run keeps no
    blank rows: PsiAnywhere's invalid-session words end it on any read; placeholder rows on one of the collection's
    LIST reads are settled by one probe (a real "nothing" on a list it reads is kept as it came); a per-item read is
    judged by the words alone (hundreds of them — a probe each would double the run). Once the session ended, every
    later read is refused here without reaching PsiAnywhere."""
    import psi_harvest as H  # noqa: PLC0415
    lists = {m for _k, _p, _l, m, _b in H.LISTS}
    gone = [False]

    def ask(method: str, body: dict[str, Any]) -> Any:
        if gone[0]:
            raise Refused(ENDED, 401, "signed-out")
        answer = H.ask(method, body)
        if said_ended(answer):
            gone[0] = True
            raise _signed_out(s)
        if method in lists and placeholders(answer):
            try:
                _probe(s)  # raises only when the token is dead
            except Refused:
                gone[0] = True
                raise
        return answer
    return ask


def collect(store: Any, uid: str) -> dict[str, Any]:
    """A collection now: with the asker's own PSI Log session when they are signed in, else the platform's. The own
    session is first read once through the checked path (PROBE), so a dead token answers with the sign-in words
    instead of a run that keeps blank rows; the run itself reads through harvest_ask."""
    import psi_harvest as H  # noqa: PLC0415
    mine = session_of(uid)
    if mine:
        _asked(mine, PROBE, {"token": mine["token"]}, listing=True)
        token, user, how = mine["token"], mine["userId"], f"your PsiAnywhere session ({mine['user']})"
        ask = harvest_ask(mine)
    else:
        token, user, why = H.platform_session()
        if not token:
            raise Refused(f"PsiAnywhere did not sign in for the collection: {why}", 503)
        how, ask = "the platform's own sign-in", H.ask
    started = H.start(store, ask, token, user, uid or "master")
    return {"started": started, "how": how, "status": dict(H.STATUS)}


# ---- the doors -------------------------------------------------------------------------------------------------------

def _answer(fn: Callable[[], dict[str, Any]]) -> dict[str, Any]:
    try:
        return {"status": 200, "data": fn()}
    except Refused as exc:
        return {"status": exc.status, "message": str(exc), "reason": exc.word}


def install(app: Any, store: Any, reads_of: Callable[[], Any]) -> None:
    """GET the person's PSI Log; POST sign-in, code, sign-out, clock-in, clock-out, consumers — behind App Control."""
    from starlette.concurrency import run_in_threadpool  # noqa: PLC0415
    keep_with(store)

    def edition_opens(uid: str) -> bool:
        """Whether the PSI Log edition (Settings › Editions) opens the app to this person, by name."""
        import editions as ED  # noqa: PLC0415
        import gsjs  # noqa: PLC0415
        import scope as sc  # noqa: PLC0415
        try:
            reads = reads_of()
            row = next((u for u in reads.users() if gsjs.str_(u.get("userid")) == uid), None)
            if row is None:
                return False
            return ED.allows("psiLog.clock", sc.user_from_row(row), reads.config())
        except Exception:  # noqa: BLE001 - FAIL-CLOSED: opens nothing it cannot read
            return False

    async def gate(request: Request) -> tuple[str, bool] | dict[str, Any]:
        import sched_lanes  # noqa: PLC0415
        got = await sched_lanes._app_gate(request, APP_ID, app_label=APP_LABEL)
        if isinstance(got, dict):
            # refused by badge — the app is still opened to whoever the PSI Log edition names, by user
            s = await sched_lanes._session(request)
            if s is not None and got.get("status") == 403 and await run_in_threadpool(edition_opens, str(s.uid)):
                return str(s.uid), False
            return got
        s = await sched_lanes._session(request)
        return got[1], bool(s is not None and s.is_master is True)

    async def body_of(request: Request) -> dict[str, Any]:
        try:
            b = await request.json()
        except Exception:  # noqa: BLE001 - an unreadable body asks nothing
            b = {}
        return b if isinstance(b, dict) else {}

    async def lane(request: Request) -> Any:
        import lane_gate as LG  # noqa: PLC0415
        g = await gate(request)
        if isinstance(g, dict):
            return LG.answer(g, no_store=True)
        uid, master = g
        return LG.answer(await run_in_threadpool(lambda: _answer(lambda: view(reads_of(), uid, master))),
                         no_store=True)

    # every door is handed the gate's master flag: only the master may sign in with the platform's stored accounts
    def do_sign_in(uid: str, body: dict[str, Any], master: bool = False) -> dict[str, Any]:
        user = str(body.get("username") or "").strip()
        try:
            got = sign_in(uid, user, str(body.get("password") or ""), device_of(reads_of(), uid, user), master)
        except Refused as exc:
            kept(store, uid, user, "sign-in", False, exc.word)
            raise
        lane = got.pop("via", "") == "lane"
        kept(store, uid, user, "sign-in", bool(got.get("signedIn")),
             ("lane token" if lane else "Token") if got.get("signedIn") else "2FA")
        log.info("psi log: %s signed in to PsiAnywhere as %s (%s)", uid, user,
                 "the lane's session" if lane else "signed in" if got.get("signedIn") else "a code was asked")
        return got

    def do_code(uid: str, body: dict[str, Any], _master: bool = False) -> dict[str, Any]:
        with _LOCK:
            user = (_PENDING.get(uid) or {}).get("user", "")
        try:
            got, user, device = send_code(uid, str(body.get("code") or ""))
        except Refused as exc:
            kept(store, uid, user, "code", False, exc.word)
            raise
        keep_device(store, uid, user, device)
        kept(store, uid, user, "code", True, "Token")
        return got

    def do_sign_out(uid: str, _body: dict[str, Any], _master: bool = False) -> dict[str, Any]:
        user = sign_out(uid)
        kept(store, uid, user, "sign-out", True)
        return {"signedIn": False}

    def do_clock_in(uid: str, body: dict[str, Any], _master: bool = False) -> dict[str, Any]:
        s = _must(uid)
        try:
            got = clock_in(s, body)
        except Refused as exc:
            kept(store, uid, s["user"], "clock-in", False, exc.word or str(exc)[:80])
            raise
        kept(store, uid, s["user"], "clock-in", True, "saved", ",".join(got["entryIds"]),
             {"start": got["start"], "workCode": got["workCode"], "people": got["people"]})
        log.info("psi log: %s clocked in on PsiAnywhere (%s, entry %s)", uid, got["workCode"], got["entryIds"])
        return got

    def do_clock_out(uid: str, body: dict[str, Any], _master: bool = False) -> dict[str, Any]:
        s = _must(uid)
        try:
            got = clock_out(s, body)
        except Refused as exc:
            kept(store, uid, s["user"], "clock-out", False, exc.word or str(exc)[:80],
                 str(body.get("singleEntryId") or ""))
            raise
        kept(store, uid, s["user"], "clock-out", True, "submitted" if got["submitted"] else "saved",
             got["entryId"], {"start": got["start"], "end": got["end"], "hours": got["hours"]})
        log.info("psi log: %s clocked out on PsiAnywhere (entry %s, %s h%s)", uid, got["entryId"], got["hours"],
                 ", submitted" if got["submitted"] else "")
        return got

    def do_consumers(uid: str, _body: dict[str, Any], _master: bool = False) -> dict[str, Any]:
        return {"consumers": consumers(_must(uid))}

    doors = {"sign-in": do_sign_in, "code": do_code, "sign-out": do_sign_out, "clock-in": do_clock_in,
             "clock-out": do_clock_out, "consumers": do_consumers}

    def door(name: str) -> Callable[[Request], Any]:
        async def run(request: Request) -> Any:
            import lane_gate as LG  # noqa: PLC0415
            g = await gate(request)
            if isinstance(g, dict):
                return LG.answer(g, no_store=True)
            uid, master = g
            body = await body_of(request)
            return LG.answer(await run_in_threadpool(lambda: _answer(lambda: doors[name](uid, body, master))),
                             no_store=True)
        return run

    app.get(LANE, include_in_schema=False)(lane)
    for name in doors:
        app.post(f"{LANE}/{name}", include_in_schema=False)(door(name))

    # ---- the collection's pages: their own App Control row (COLLECTION), the master's alone until he names a badge
    # there, on top of the app's — whoever the clock is opened to never reads everyone's records by that alone ----

    async def feature_gate(request: Request, feature: str, label: str) -> tuple[str, dict[str, Any] | None]:
        """The app's door, then the page's own App Control row (no row = the master's alone). But an edition that opens
        the app opens ALL of it — full access — to the people it names, the admin pages included."""
        import sched_lanes  # noqa: PLC0415
        s = await sched_lanes._session(request)
        if s is not None and await run_in_threadpool(edition_opens, str(s.uid)):
            return str(s.uid), None
        for app_id, lab in ((APP_ID, APP_LABEL), (feature, label)):
            got = await sched_lanes._app_gate(request, app_id, app_label=lab)
            if isinstance(got, dict):
                return "", got
        return got[1], None

    async def collection_gate(request: Request) -> tuple[str, dict[str, Any] | None]:
        return await feature_gate(request, COLLECTION, COLLECTION_LABEL)

    def collected(name: str, fn: Callable[[str, Request], dict[str, Any]]) -> Callable[[Request], Any]:
        async def run(request: Request) -> Any:
            import lane_gate as LG  # noqa: PLC0415
            uid, refused = await collection_gate(request)
            if refused is not None:
                return LG.answer(refused, no_store=True)
            try:
                got = await run_in_threadpool(fn, uid, request)
            except Exception as exc:  # noqa: BLE001 - said, never a blank page
                log.warning("psi log: %s could not be read (%s)", name, type(exc).__name__)
                return LG.answer({"status": 503, "message": f"The collection could not be read ({type(exc).__name__})."},
                                 no_store=True)
            return LG.answer({"status": 200, "data": got}, no_store=True)
        return run

    def data_of(_s: Any, request: Request) -> dict[str, Any]:
        import lane_gate as LG  # noqa: PLC0415
        import psi_harvest as H  # noqa: PLC0415
        reads = reads_of()
        page, kind = LG.query(request, "page") or "staff", LG.query(request, "kind")
        kinds = H.kinds_of(reads, page)
        kind = kind if any(k["kind"] == kind for k in kinds) else next((k["kind"] for k in kinds if k["rows"]),
                                                                      kinds[0]["kind"] if kinds else "")
        offset = int(LG.query(request, "offset") or 0) if (LG.query(request, "offset") or "0").isdigit() else 0
        got = H.rows(reads, kind, LG.query(request, "q"), 500, offset) if kind else {"rows": [], "columns": []}
        return {"page": page, "kinds": kinds, **got}

    def entries_of(_s: Any, request: Request) -> dict[str, Any]:
        import lane_gate as LG  # noqa: PLC0415
        import psi_harvest as H  # noqa: PLC0415
        today = _today()
        day = re.compile(r"^\d{4}-\d{2}-\d{2}$")
        a, b = LG.query(request, "from"), LG.query(request, "to")
        a = a if day.match(a) else (today - timedelta(days=6)).isoformat()
        b = b if day.match(b) else today.isoformat()
        return H.entries(reads_of(), a, b, LG.query(request, "q"))

    def collect_view(_s: Any, _request: Request) -> dict[str, Any]:
        import psi_harvest as H  # noqa: PLC0415
        reads = reads_of()
        return {"status": dict(H.STATUS), "runs": H.runs(reads),
                "kinds": [k for p in ("staff", "clients", "other") for k in H.kinds_of(reads, p)],
                "dailyAt": "%02d:%02d" % H.DAILY_AT, "zone": "America/New_York"}

    def collect_now(uid: str, _request: Request) -> dict[str, Any]:
        return collect(store, uid)

    def collect_door(uid: str, request: Request) -> dict[str, Any]:
        try:
            return collect_now(uid, request)
        except Refused as exc:
            return {"started": False, "why": str(exc)}

    app.get(f"{LANE}/data", include_in_schema=False)(collected("data", data_of))
    app.get(f"{LANE}/entries", include_in_schema=False)(collected("entries", entries_of))
    app.get(f"{LANE}/collect", include_in_schema=False)(collected("collect", collect_view))
    app.post(f"{LANE}/collect", include_in_schema=False)(collected("collect-now", collect_door))

    # ---- Reset Password: the master gives an employee a new PsiAnywhere password, its own App Control row ----

    def reset_view(uid: str, request: Request) -> dict[str, Any]:
        import lane_gate as LG  # noqa: PLC0415
        s = session_of(uid)
        if not s:
            return {"signedIn": False}
        inactive = LG.query(request, "inactive").strip() in ("1", "true", "yes")
        try:
            users = reset_users(s, inactive)
        except Refused as exc:
            if exc.word != "signed-out":
                raise
            return {"signedIn": False, "ended": str(exc)}
        return {"signedIn": True, "psiUser": s["user"], "platform": is_platform(s["user"]),
                "minLength": policy(s)["length"], "users": users}

    def reset_now(uid: str, request: Request) -> dict[str, Any]:
        s = session_of(uid)
        if not s:
            raise Refused("Sign in to PsiAnywhere first, on the PSI Log page.", 409, "signed-out")
        got = reset_password(s, getattr(request, "_psi_body", {}) or {})
        kept(store, uid, s["user"], "reset-password", True, got["how"], "", {"target": got["userId"]})
        log.info("psi log: %s reset the PsiAnywhere password of %s (%s)", uid, got["userId"], got["how"])
        return {"userId": got["userId"], "password": got["password"], "how": got["how"]}

    async def reset_lane(request: Request) -> Any:
        import lane_gate as LG  # noqa: PLC0415
        uid, refused = await feature_gate(request, RESET_FEATURE, "PSI password reset")
        if refused is not None:
            return LG.answer(refused, no_store=True)
        if request.method == "POST":
            request._psi_body = await body_of(request)  # noqa: SLF001

            def run() -> dict[str, Any]:
                try:
                    return {"status": 200, "data": reset_now(uid, request)}
                except Refused as exc:
                    s = session_of(uid)
                    if s:
                        kept(store, uid, s["user"], "reset-password", False, exc.word or str(exc)[:80],
                             {"target": str((getattr(request, "_psi_body", {}) or {}).get("userId") or "")})
                    return {"status": exc.status, "message": str(exc), "reason": exc.word}

            return LG.answer(await run_in_threadpool(run), no_store=True)
        return LG.answer(await run_in_threadpool(lambda: _answer(lambda: reset_view(uid, request))), no_store=True)

    app.get(f"{LANE}/reset", include_in_schema=False)(reset_lane)
    app.post(f"{LANE}/reset", include_in_schema=False)(reset_lane)

    # ---- approve time entries: the master's alone until released (to the platform lead) ----

    async def approve_lane(request: Request) -> Any:
        import lane_gate as LG  # noqa: PLC0415
        uid, refused = await feature_gate(request, APPROVE_FEATURE, APPROVE_LABEL)
        if refused is not None:
            return LG.answer(refused, no_store=True)
        body = await body_of(request)

        def run() -> dict[str, Any]:
            s = session_of(uid)
            if not s:
                return {"status": 409, "reason": "signed-out",
                        "message": "Sign in to PsiAnywhere first, on the PSI Log page, with an administrator account."}
            items = body.get("entries")
            items = [i for i in items if isinstance(i, dict)] if isinstance(items, list) else []
            decision = "reject" if str(body.get("decision") or "").strip().lower() == "reject" else "approve"
            try:
                got = decide_entries(s, items, decision, str(body.get("reason") or ""))
            except Refused as exc:
                return {"status": exc.status, "message": str(exc), "reason": exc.word}
            action = "approve" if decision == "approve" else "reject"
            kept(store, uid, s["user"], action, not got["failed"], f"{got['decided']} {action}d", "",
                 {"decided": got["decided"], "skipped": got["skipped"], "failed": len(got["failed"])})
            log.info("psi log: %s %sd %d PsiAnywhere entr(y/ies) (%d skipped, %d batch(es) failed)",
                     uid, action, got["decided"], got["skipped"], len(got["failed"]))
            return {"status": 200, "data": got}

        return LG.answer(await run_in_threadpool(run), no_store=True)

    app.post(f"{LANE}/approve", include_in_schema=False)(approve_lane)

    # ---- an account on or off: the master's alone until released ----

    async def account_lane(request: Request) -> Any:
        import lane_gate as LG  # noqa: PLC0415
        uid, refused = await feature_gate(request, ACCOUNTS_FEATURE, ACCOUNTS_LABEL)
        if refused is not None:
            return LG.answer(refused, no_store=True)
        body = await body_of(request)

        def run() -> dict[str, Any]:
            s = session_of(uid)
            if not s:
                return {"status": 409, "reason": "signed-out",
                        "message": "Sign in to PsiAnywhere first, on the PSI Log page, with an administrator account."}
            active = body.get("active") is True
            try:
                got = set_account_active(s, str(body.get("userId") or ""), active)
            except Refused as exc:
                kept(store, uid, s["user"], "account", False, exc.word or str(exc)[:80],
                     {"target": str(body.get("userId") or "")})
                return {"status": exc.status, "message": str(exc), "reason": exc.word}
            kept(store, uid, s["user"], "account", True, "active" if active else "inactive", "",
                 {"target": got["userId"], "active": active})
            log.info("psi log: %s set the PsiAnywhere account %s %s", uid, got["userId"],
                     "active" if active else "inactive")
            return {"status": 200, "data": got}

        return LG.answer(await run_in_threadpool(run), no_store=True)

    app.post(f"{LANE}/account", include_in_schema=False)(account_lane)

    # ---- New client: add a client to PsiAnywhere, the master's alone until released ----

    async def new_client_lane(request: Request) -> Any:
        import lane_gate as LG  # noqa: PLC0415
        uid, refused = await feature_gate(request, NEWCLIENT_FEATURE, NEWCLIENT_LABEL)
        if refused is not None:
            return LG.answer(refused, no_store=True)
        is_post = request.method == "POST"
        body = await body_of(request) if is_post else {}

        def run() -> dict[str, Any]:
            s = session_of(uid)
            if not s:
                if is_post:
                    return {"status": 409, "reason": "signed-out",
                            "message": "Sign in to PsiAnywhere first, on the PSI Log page, with an administrator "
                                       "account."}
                return {"status": 200, "data": {"signedIn": False}}
            try:
                if is_post:
                    got = create_client(s, body)
                    if got.get("id"):
                        kept(store, uid, s["user"], "new-client", True, "created", got["id"],
                             {"name": got["name"], "consumerNumber": got["consumerNumber"]})
                        log.info("psi log: %s added a PsiAnywhere client (%s, %s)", uid, got["id"],
                                 got["consumerNumber"])
                    return {"status": 200, "data": got}
                return {"status": 200, "data": {"signedIn": True, "psiUser": s["user"], **new_client_form(s)}}
            except Refused as exc:
                if not is_post and exc.word == "signed-out":
                    return {"status": 200, "data": {"signedIn": False, "ended": str(exc)}}
                if is_post:
                    kept(store, uid, s["user"], "new-client", False, exc.word or str(exc)[:80])
                return {"status": exc.status, "message": str(exc), "reason": exc.word}

        return LG.answer(await run_in_threadpool(run), no_store=True)

    app.get(f"{LANE}/new-client", include_in_schema=False)(new_client_lane)
    app.post(f"{LANE}/new-client", include_in_schema=False)(new_client_lane)
