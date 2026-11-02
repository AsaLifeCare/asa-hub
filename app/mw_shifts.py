"""My Work's shift names off asa-hub-db: the relay's shift_requests, shift_handoff, ist_config and redaction, translated.
Sheets are read from asa-hub-db with app.edits laid (hubdb); the relay's own tables only through mw_relay_state."""
from __future__ import annotations

import hashlib
import hmac
import json
import logging
import os
import re
import threading
import time
from datetime import date, datetime, time as clock_time, timedelta, timezone
from typing import Any, Iterable
from urllib.parse import quote
from zoneinfo import ZoneInfo

import hubdb
import mw_relay_state
import mw_roster
import scope as sc

log = logging.getLogger("asa-hub-app.mw_shifts")

OHIO = ZoneInfo("America/New_York")


# ---- the reads ------------------------------------------------------------------

def _db(src: Any) -> Any:
    """The asa-hub-db reader a session, a request's reads or the reader itself carries."""
    for got in (src, getattr(src, "reads", None)):
        db = getattr(got, "db", got)
        if db is not None and hasattr(db, "facts") and hasattr(db, "rows") and hasattr(db, "tab"):
            return db
    raise hubdb.Unreadable("no asa-hub-db reader was handed to the shift reads")


def _once(src: Any, name: str, fn: Any) -> Any:
    """Once per request when the request's reads are at hand."""
    once = getattr(getattr(src, "reads", src), "once", None)
    return once("mw_shifts:" + name, fn) if callable(once) else fn()


def _text(v: Any, cap: int = 300) -> str:
    return re.sub(r"\s+", " ", "" if v is None else str(v)).strip()[:cap]


def _pointer(db: Any, subject: str) -> str:
    """The depot's Facts value for a pointer, by Subject ID."""
    return str(db.facts()["subjects"].get(subject) or "").strip()


def _tab_rows(db: Any, sheet_id: str, tab: str) -> list[dict]:
    """A tab's rows as the copy keeps them, in sheet order, with the kept edits laid; none when the tab is not there."""
    ref = db.tab(sheet_id, tab) if sheet_id else None
    return [raw for _rn, raw in db.rows(ref)] if ref is not None else []


def _pg_text(v: Any) -> str:
    """What data->>key gives for a cell."""
    if v is None:
        return ""
    if isinstance(v, str):
        return v
    if isinstance(v, bool):
        return "true" if v else "false"
    return json.dumps(v, ensure_ascii=False)


def _today() -> date:
    return datetime.now(OHIO).date()


def _ref_key() -> bytes:
    """The relay's HMAC key for pool handles, from the same secrets; none set, no handle is made."""
    raw = (os.getenv("HUB_SHIFT_REF_KEY") or os.getenv("HUB_SERVICE_SECRET")
           or os.getenv("HUB_SERVICE_TOKEN") or "")
    return hashlib.sha256(b"asa-hub shift pool ref|" + raw.encode("utf-8")).digest() if raw else b""


_REF_KEY = _ref_key()


# ---- house_directory --------------------------------------------------------------

class house_directory:  # noqa: N801 - the relay module's name
    @staticmethod
    def label_of(home_name: Any, code: Any = "") -> str:
        """ "CAN - JH - ABD2704" → "JH": the region prefix and the code both go."""
        parts = [p.strip() for p in str(home_name or "").split(" - ") if p.strip()]
        code = str(code or "").strip()
        if parts and code and parts[-1].upper() == code.upper():
            parts = parts[:-1]
        elif len(parts) >= 2 and re.fullmatch(r"[A-Z]{2,4}\d{3,6}", parts[-1]):
            parts = parts[:-1]
        if len(parts) >= 2 and re.fullmatch(r"[A-Z]{3}", parts[0]):
            parts = parts[1:]
        return " - ".join(parts) or code

    @staticmethod
    def code_of(house: Any) -> str:
        text = str(house or "").strip()
        last = text.split(" - ")[-1].strip() if text else ""
        return last.upper()


# ---- redaction ----------------------------------------------------------------------

class redaction:  # noqa: N801 - server/redaction.py, the one withholding rule, as My Work applies it
    MARKER_SECRET = "[withheld: secret]"
    MARKER_CARD = "[withheld: card]"
    MARKER_IDENTIFIER = "[withheld: identifier]"
    MARKER_PRIVATE = "[withheld: private]"
    MARKERS = (MARKER_SECRET, MARKER_CARD, MARKER_IDENTIFIER, MARKER_PRIVATE)
    PRIVATE_COLUMNS = frozenset({"time off reason"})
    KEY_TOKENS = frozenset({"key", "secret", "token", "password", "passwd", "credential", "webhook", "private",
                            "signing"})
    NAMED_PROPS = frozenset({
        "OPENAI_API_KEY", "GROK_API_KEY", "GROQ_KEY1", "GROQ_KEY2", "GROQ_KEY3", "GROQ_KEY4", "GROQ_KEY5",
        "OPENPHONE_API_KEY", "DROPBOX_SIGN_API_KEY", "HUB_SERVICE_SECRET", "HUB_MEDIA_PROBE_KEY",
        "INTERVIEW_LINK_SECRET", "BROWSER_AUTOMATION_BOT_SECRET", "QUO_WEBHOOK_KEY_MESSAGES",
        "QUO_WEBHOOK_KEY_SUMMARIES", "QUO_WEBHOOK_KEY_TRANSCRIPTS", "BRITTCO_PASSWORD", "FIRST_USER_PASSWORD",
        "ONBOARDING_USER_PASSWORD", "PLATFORM_EMAIL_PASSWORD", "PLATFORM_EMAIL_PASSWORD2",
        "PLATFORM_EMAIL_PASSWORD3", "PLATFORM_EMAIL_PASSWORD4", "PLATFORM_EMAIL_PASSWORD5"})
    KEY_COLUMNS = frozenset({"fact key", "key", "prop", "prop name", "property", "config key", "setting",
                             "subject id"})
    VALUE_COLUMNS = frozenset({"value", "values", "secret", "evidence", "current value", "default value",
                               "prop value"})
    CARD_PHRASES: tuple[tuple[str, ...], ...] = (
        ("debit", "card"), ("credit", "card"), ("card", "number"), ("card", "no"), ("card", "num"), ("pan",),
        ("account", "number"), ("routing", "number"), ("bank", "account"), ("security", "code"), ("card", "pin"),
        ("pin",), ("cvv",), ("ccv",), ("iban",), ("dc", "exp"))
    IDENTIFIER_PHRASES: tuple[tuple[str, ...], ...] = (
        ("ssn",), ("social", "security"), ("medicaid",), ("medicare",), ("passport",), ("itin",),
        ("alien", "registration"), ("government", "id"), ("govt", "id"), ("national", "id"),
        ("state", "issued", "id"), ("dd", "id"), ("dodd", "id"))
    IDENTIFIER_NUMBERED: tuple[tuple[str, ...], ...] = (
        ("dl",), ("driver", "license"), ("drivers", "license"), ("driver", "licence"), ("drivers", "licence"),
        ("driving", "license"), ("driving", "licence"), ("state", "id"), ("id", "card"))
    NUMBER_WORDS = frozenset({"num", "number", "no", "nbr"})
    LICENCE_PHRASES: tuple[tuple[str, ...], ...] = (
        ("dl",), ("driver", "license"), ("drivers", "license"), ("driver", "licence"), ("drivers", "licence"),
        ("driving", "license"), ("driving", "licence"))
    LICENCE_TAIL = " licence:"
    US_STATES = frozenset(("AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV "
                           "NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY PR GU VI AS MP").split())
    LICENCE_NA = re.compile(r"n/?a|na|none|not applicable|not required|n-a|no", re.I)
    LICENCE_STATE = re.compile(r"([A-Z]{2})[\s\-:#.]+(.+)")
    LICENCE_WRITTEN = re.compile(re.escape(MARKER_IDENTIFIER) + "(?:" + re.escape(LICENCE_TAIL)
                                 + r"(?:none|short|(?:[A-Z]{2} )?[0-9]{4}))?")
    LOGIN_WORDS = frozenset({"username", "login", "logon", "signin"})
    LOGIN_ABOUT = frozenset({"count", "at", "last", "time", "times", "date", "attempt", "attempts", "failed", "fail",
                             "url", "link", "page", "method", "status", "error", "history", "log", "type",
                             "required"})
    EXPIRY_HEAD = frozenset({"expiration", "expires", "expiry", "exp"})
    EXPIRY_ONLY = EXPIRY_HEAD | frozenset({"date", "dt", "the"})
    SECRET_NAME_MIN = 12
    SECRET_NAME_SYMBOLS = frozenset("!\"#$%&'*+;<=>?@[\\]^`{|}~")
    SECRET_NAME_NEVER = frozenset("/:")
    HEADER_TOKENS = frozenset({"password", "passwd", "pwd", "secret", "token", "salt"})
    HEADER_PHRASES: tuple[tuple[str, ...], ...] = (("pass", "hash"), ("api", "key"), ("private", "key"),
                                                   ("signing", "key"))
    HEADER_KEPT = frozenset({"token managed", "token hash", "secret ref", "requires secret ref", "secret tab",
                             "secret key name"})
    CAMEL = re.compile(r"(?<=[a-z0-9])(?=[A-Z])")
    RUN = re.compile(r"[A-Za-z]+|[0-9]+")

    @staticmethod
    def words_of(name: Any) -> tuple[str, ...]:
        text = redaction.CAMEL.sub(" ", str(name or "")).replace("#", " num ")
        return tuple(w.lower() for w in redaction.RUN.findall(text) if not w.isdigit())

    @staticmethod
    def _has_run(words: tuple[str, ...], phrase: tuple[str, ...]) -> bool:
        n = len(phrase)
        return any(words[i:i + n] == phrase for i in range(len(words) - n + 1))

    @staticmethod
    def is_card_column(name: Any) -> bool:
        words = redaction.words_of(name)
        return any(redaction._has_run(words, p) for p in redaction.CARD_PHRASES)

    @staticmethod
    def is_identifier_column(name: Any) -> bool:
        words = redaction.words_of(name)
        if not words:
            return False
        if any(redaction._has_run(words, p) for p in redaction.IDENTIFIER_PHRASES):
            return True
        if not set(words) & redaction.NUMBER_WORDS:
            return False
        return any(redaction._has_run(words, p) for p in redaction.IDENTIFIER_NUMBERED)

    @staticmethod
    def is_licence_column(name: Any) -> bool:
        words = redaction.words_of(name)
        if not set(words) & redaction.NUMBER_WORDS or not any(redaction._has_run(words, p)
                                                               for p in redaction.LICENCE_PHRASES):
            return False
        if any(redaction._has_run(words, p) for p in redaction.IDENTIFIER_PHRASES):
            return False
        return not any(redaction._has_run(words, p) for p in redaction.IDENTIFIER_NUMBERED
                       if p not in redaction.LICENCE_PHRASES)

    @staticmethod
    def licence_kept(value: Any) -> str:
        raw = str(value if value is not None else "").strip().upper()
        if not raw or redaction.LICENCE_NA.fullmatch(raw):
            return "none"
        st, num = "", raw
        tok = redaction.LICENCE_STATE.fullmatch(raw)
        if tok and tok.group(1) in redaction.US_STATES and re.search(r"[A-Z]", tok.group(2)) \
                and re.search(r"[0-9]", tok.group(2)):
            st, num = tok.group(1), tok.group(2)
        digits = re.sub(r"[^0-9]", "", num)
        if len(digits) < 6:
            return "short"
        return (st + " " if st else "") + digits[-4:]

    @staticmethod
    def licence_marker(value: Any) -> str:
        return redaction.MARKER_IDENTIFIER + redaction.LICENCE_TAIL + redaction.licence_kept(value)

    @staticmethod
    def is_marker_value(value: Any) -> bool:
        text = str(value).strip() if isinstance(value, str) else ""
        return any(text == m or text.startswith(m + " ") for m in redaction.MARKERS)

    @staticmethod
    def is_login_column(name: Any) -> bool:
        words = set(redaction.words_of(name))
        return bool(words & redaction.LOGIN_WORDS) and not (words & redaction.LOGIN_ABOUT)

    @staticmethod
    def is_bare_expiry_column(name: Any) -> bool:
        words = set(redaction.words_of(name))
        return bool(words & redaction.EXPIRY_HEAD) and not (words - redaction.EXPIRY_ONLY)

    @staticmethod
    def is_secret_name(name: Any) -> bool:
        text = str(name or "").strip()
        if len(text) < redaction.SECRET_NAME_MIN:
            return False
        if any(c.isspace() or c in redaction.SECRET_NAME_NEVER for c in text):
            return False
        if not (any(c.islower() for c in text) and any(c.isupper() for c in text)
                and any(c.isdigit() for c in text)):
            return False
        return any(c in redaction.SECRET_NAME_SYMBOLS for c in text)

    @staticmethod
    def _normal(name: Any) -> str:
        return " ".join(redaction.words_of(name))

    @staticmethod
    def is_secret_column(name: Any) -> bool:
        words = redaction.words_of(name)
        if not words or redaction._normal(name) in redaction.HEADER_KEPT:
            return False
        if set(words) & redaction.HEADER_TOKENS:
            return True
        return any(redaction._has_run(words, p) for p in redaction.HEADER_PHRASES)

    @staticmethod
    def is_secret_key(value: Any) -> bool:
        text = str(value or "").strip()
        if not text:
            return False
        if text.upper() in redaction.NAMED_PROPS:
            return True
        return bool(set(redaction.words_of(text)) & redaction.KEY_TOKENS)

    @staticmethod
    def _key_and_value_columns(columns: Iterable[Any]) -> tuple[list[Any], list[Any]]:
        keys, values = [], []
        for column in columns:
            normal = redaction._normal(column)
            if normal in redaction.KEY_COLUMNS:
                keys.append(column)
            elif normal in redaction.VALUE_COLUMNS:
                values.append(column)
        return keys, values

    @staticmethod
    def is_marker_name(name: Any) -> bool:
        text = str(name or "").strip()
        return any(text == m or text.startswith(m + " ") for m in redaction.MARKERS)

    @staticmethod
    def is_private_column(name: Any) -> bool:
        return redaction._normal(name) in redaction.PRIVATE_COLUMNS

    @staticmethod
    def withheld_columns(row: dict) -> tuple[Any, ...]:
        if not isinstance(row, dict):
            return ()
        out = [c for c in row
               if not redaction.is_marker_name(c)
               and (redaction.is_card_column(c) or redaction.is_secret_column(c)
                    or redaction.is_identifier_column(c) or redaction.is_login_column(c))]
        out.extend(c for c in row if redaction.is_private_column(c) and c not in out)
        if any(redaction.is_card_column(c) for c in row):
            out.extend(c for c in row if redaction.is_bare_expiry_column(c) and c not in out)
        keys, values = redaction._key_and_value_columns(row)
        if keys and values and any(redaction.is_secret_key(row.get(k)) for k in keys):
            out.extend(c for c in values if c not in out)
        return tuple(out)

    @staticmethod
    def secret_named_columns(row: dict) -> tuple[Any, ...]:
        if not isinstance(row, dict):
            return ()
        return tuple(c for c in row if redaction.is_secret_name(c))

    @staticmethod
    def marker_for(column: Any, row: dict | None = None) -> str:
        if redaction.is_private_column(column):
            return redaction.MARKER_PRIVATE
        if redaction.is_card_column(column):
            return redaction.MARKER_CARD
        if redaction.is_identifier_column(column):
            return redaction.MARKER_IDENTIFIER
        if row is not None and redaction.is_bare_expiry_column(column) \
                and any(redaction.is_card_column(c) for c in row):
            return redaction.MARKER_CARD
        return redaction.MARKER_SECRET

    @staticmethod
    def _is_empty(cell: Any) -> bool:
        return cell is None or (isinstance(cell, str) and not cell.strip())

    @staticmethod
    def _secret_name_key(taken: set, seen: int) -> str:
        key = redaction.MARKER_SECRET if seen == 1 else f"{redaction.MARKER_SECRET} {seen}"
        while key in taken:
            seen += 1
            key = f"{redaction.MARKER_SECRET} {seen}"
        return key

    @staticmethod
    def redact_row(row: dict) -> tuple[dict, int]:
        """→ (row, cells withheld); an empty cell stays empty so no marker reveals who has a card."""
        columns = redaction.withheld_columns(row)
        names = redaction.secret_named_columns(row)
        if not columns and not names:
            return row, 0
        withheld = 0
        named, marked = set(names), set(columns)
        out: dict = {}
        seen = 0
        for column in row:
            value = row[column]
            if column in named:
                seen += 1
                out[redaction._secret_name_key(set(out) | (set(row) - named), seen)] = redaction.MARKER_SECRET
                withheld += 1
            elif column in marked and not redaction._is_empty(value):
                marker = redaction.marker_for(column, row)
                if marker == redaction.MARKER_IDENTIFIER and redaction.is_licence_column(column):
                    marker = value if redaction.LICENCE_WRITTEN.fullmatch(str(value)) \
                        else redaction.licence_marker(value)
                out[column] = marker
                withheld += 1
            else:
                out[column] = value
        return (out, withheld) if withheld else (row, 0)


# ---- ist_config ---------------------------------------------------------------------

# server/ist_config_defaults.json's keys, the declaration every copy is built from (its notes stay with it)
_IST_KEYS: list[dict[str, Any]] = json.loads(r"""[
    {"key": "ist_non_person_names", "type": "list", "value": "OPEN, NEW, FAMILY, LOCATION, NURSE, STAFF, TBD, AGENCY, VACANT, TBA, PRN"},
    {"key": "ist_non_person_contains", "type": "list", "min_entry_length": 4, "value": "workshop"},
    {"key": "ist_roster_lookback_days", "type": "int", "min": 0, "max": 3650, "unit": "day", "value": "0"},
    {"key": "ist_pair_requires_overlap", "type": "yesno", "value": "yes"},
    {"key": "ist_trained_scope", "type": "choice", "allowed": ["house", "client"], "value": "house"},
    {"key": "ist_valid_days", "type": "int", "min": 0, "max": 3650, "unit": "day", "value": "0"},
    {"key": "ist_trainer_must_be_free", "type": "yesno", "value": "yes"},
    {"key": "ist_trainer_when_no_hm", "type": "choice", "allowed": ["approver", "refuse"], "value": "approver"},
    {"key": "ist_assigner_owns_training", "type": "yesno", "value": "yes"},
    {"key": "ist_gate_certification", "type": "course", "value": "dodd"},
    {"key": "ist_gate_certification_label", "type": "text", "falls_back_with": "ist_gate_certification", "value": "DODD"},
    {"key": "ist_cert_expiring_days", "type": "int", "min": 1, "max": 365, "unit": "day", "value": "60"},
    {"key": "ist_requirements_window", "type": "choice", "allowed": ["own", "ist"], "value": "own"},
    {"key": "ist_cert_labels", "type": "pairs", "value": "dodd=DODD 8-Hour, cpr=CPR / First Aid, med1=Med Delivery 1, med2=Med Delivery 2, med3=Med Delivery 3, mais=MAIS Certification, money=Money Management, mandt=MANDT"},
    {"key": "ist_cert_master_columns", "type": "pairs", "key_pattern": "^[a-z0-9_]+$", "course_values": true, "value": "cpr_exp_date=cpr, dodd_8_hour_exp=dodd, med_1_exp_date=med1, med_2_exp_date=med2, med_3_exp_date=med3, money_mgt_date=money, mandt_exp_date=mandt"},
    {"key": "ist_cert_training_keys", "type": "pairs", "course_values": true, "value": "cpr exp date=cpr, dodd 8-hour exp=dodd, dodd 8 hour exp=dodd, med 1 exp date=med1, med 2 exp date=med2, med 3 exp date=med3, money mgt date=money"},
    {"key": "ist_cert_source_tabs", "type": "pairs", "keys": ["trainings", "mais", "master"], "value": "trainings=Trainings Status, mais=Med Del Certs (MAIS), master=Master"},
    {"key": "ist_cert_source_fields", "type": "pairs", "keys": ["master.name", "trainings.name", "trainings.course", "trainings.status", "trainings.expires", "mais.name", "mais.status", "mais.expires", "mais.category"], "value_pattern": "^[a-z0-9_]+([|+][a-z0-9_]+)*$", "value": "master.name=employee|name, trainings.name=name, trainings.course=training, trainings.status=status, trainings.expires=expiration_date, mais.name=name, mais.status=status, mais.expires=expiration, mais.category=cert_type"},
    {"key": "ist_cert_tracker_statuses", "type": "pairs", "values": ["expiring", "expired"], "value": "expired=expired, *=expiring"},
    {"key": "ist_cert_mais_statuses", "type": "pairs", "values": ["certified", "expired", "skip"], "never_value": "certified", "never_words": ["expired", "revoked", "suspended", "inactive", "lapsed", "denied", "error"], "value": "certified=certified, ERROR*=skip, *=expired"},
    {"key": "ist_columns", "type": "pairs", "value": "staffName:Employee, clientName:Client, house:House, status:IST, dueDate:Needed by, certNote:Certification, notifiedAt:Last notice, notifyCount:Notices"},
    {"key": "ist_statuses", "type": "list", "value": "owed, done"},
    {"key": "ist_status_tints", "type": "pairs", "values": ["mint", "peach", "lavender", "pink", "blue", "amber", "green"], "value": "owed=amber, done=mint"},
    {"key": "ist_page_size", "type": "int", "min": 5, "max": 200, "value": "25"},
    {"key": "ist_matrix_columns", "type": "list", "course_entries": true, "value": "dodd, cpr, med1, med2, med3, mais"},
    {"key": "ist_matrix_labels", "type": "pairs", "course_keys": true, "value": "dodd=DODD 8-Hr, cpr=CPR/FA, med1=Med Del 1, med2=Med Del 2, med3=Med Del 3, mais=DODD MAIS"},
    {"key": "ist_matrix_page_size", "type": "int", "min": 5, "max": 200, "value": "12"},
    {"key": "ist_cert_status_tints", "type": "pairs", "keys": ["valid", "expiring", "expired", "missing"], "values": ["mint", "peach", "lavender", "pink", "blue", "amber", "green"], "value": "valid=mint, expiring=amber, expired=pink, missing=pink"},
    {"key": "ist_dashboard_months", "type": "int", "min": 3, "max": 24, "unit": "month", "value": "12"},
    {"key": "ist_note_no_certification", "type": "template", "placeholders": ["cert"], "value": "no {cert} certification on file"},
    {"key": "ist_note_expired", "type": "template", "placeholders": ["cert", "date"], "value": "{cert} expired {date}"},
    {"key": "ist_note_unreadable", "type": "template", "placeholders": ["cert", "value"], "value": "{cert} date unreadable: {value}"},
    {"key": "ist_stale_marker", "type": "text", "value": "house no longer mapped"},
    {"key": "ist_notice_repeats", "type": "yesno", "value": "no"}
]""")
_IST_LOCK = threading.Lock()
_IST_HELD: dict[str, Any] = {"at": 0.0, "raw": None, "source": "shipped", "pinned": None, "resolved": None, "gen": 0}


class ist:  # noqa: N801 - server/ist_config.py
    TAB = "ist_config"
    SPEC: dict[str, dict[str, Any]] = {d["key"]: d for d in _IST_KEYS}
    SHIPPED: dict[str, str] = {d["key"]: str(d["value"]) for d in _IST_KEYS}
    IST_STATUS_OWED = "owed"
    IST_STATUS_DONE = "done"
    TTL_S = float(os.getenv("HUB_IST_CONFIG_TTL_S", "300"))
    UNREAD_WHY = f"the {TAB} settings house could not be read, so nobody can be shown to be trained"
    INT = re.compile(r"(-?[0-9]+)(?:[ \t]*([A-Za-z]+))?")

    @staticmethod
    def bits(raw: Any) -> list[str]:
        return [b.strip() for b in re.split(r"[,;\n]+", str(raw or "")) if b.strip()]

    @staticmethod
    def pairs_of(raw: Any) -> tuple[list[str], dict[str, str]] | None:
        order: list[str] = []
        out: dict[str, str] = {}
        for bit in ist.bits(raw):
            i = bit.find("=")
            if i == -1:
                i = bit.find(":")
            if i <= 0:
                continue
            k, v = bit[:i].strip(), bit[i + 1:].strip()
            if not k:
                continue
            if k not in out:
                order.append(k)
            out[k] = v
        return (order, out) if order else None

    @staticmethod
    def int_value(key: str, raw: Any) -> int | None:
        m = ist.INT.fullmatch(str(raw if raw is not None else "").strip())
        if not m:
            return None
        word = (m.group(2) or "").lower()
        if word:
            unit = str((ist.SPEC.get(key) or {}).get("unit") or "").lower()
            if not unit or word not in (unit, unit + "s"):
                return None
        return int(m.group(1))

    @staticmethod
    def shipped_catalogue() -> list[str]:
        return (ist.pairs_of(ist.SHIPPED["ist_cert_labels"]) or ([], {}))[0]

    @staticmethod
    def _refs(catalogue: list[str]) -> list[str]:
        out = list(catalogue)
        for k in ist.shipped_catalogue():
            if k not in out:
                out.append(k)
        return out

    @staticmethod
    def _never(spec: dict[str, Any], key: str, value: str) -> bool:
        if not spec.get("never_value") or value.strip().lower() != str(spec["never_value"]).lower():
            return False
        k = key.strip().lower()
        words = [str(w).lower() for w in spec.get("never_words") or []]
        if k.endswith("*"):
            p = k[:-1]
            return any(w.startswith(p) or p.startswith(w) for w in words)
        return any(k.startswith(w) for w in words)

    @staticmethod
    def uses_catalogue(key: str) -> bool:
        spec = ist.SPEC.get(key) or {}
        return spec.get("type") == "course" or any(spec.get(f) for f in ("course_entries", "course_keys",
                                                                         "course_values"))

    @staticmethod
    def check(key: str, raw: Any, catalogue: list[str] | None = None) -> str:
        """'' when the cell is usable, else the reason. A blank cell is the shipped value, never wrong."""
        spec = ist.SPEC.get(key)
        if spec is None:
            return f"{key} is not a setting this version reads"
        s = str(raw if raw is not None else "").strip()
        if not s:
            return ""
        cat = catalogue if catalogue is not None else ist.shipped_catalogue()
        kind = spec.get("type")
        if kind == "int":
            n = ist.int_value(key, s)
            lo, hi = spec.get("min"), spec.get("max")
            if n is None or (lo is not None and n < lo) or (hi is not None and n > hi):
                return f"{key} takes a whole number from {lo} to {hi} — \"{s}\" is not one"
            return ""
        if kind == "yesno":
            return "" if s.lower() in ("yes", "no") else f"{key} takes yes or no — not \"{s}\""
        if kind == "choice":
            allowed = [str(a) for a in spec.get("allowed") or []]
            return "" if s.lower() in allowed else f"{key} takes one of {', '.join(allowed)} — not \"{s}\""
        if kind == "course":
            if cat and s not in cat:
                return (f"\"{s}\" is not a course in the course list — use one of its short keys: "
                        f"{', '.join(cat)}")
            return ""
        if kind == "list":
            entries = ist.bits(s)
            if not entries:
                return f"{key} holds no entry"
            least = int(spec.get("min_entry_length") or 0)
            short = [e for e in entries if least and len(e) < least]
            if short:
                return (f"{', '.join(short)} — each entry needs at least {least} characters: a short "
                        f"word matched inside a name removes real people")
            if spec.get("course_entries"):
                refs = ist._refs(cat)
                wrong = [e for e in entries if e not in refs]
                if wrong:
                    return f"{', '.join(wrong)} — not a course key; use the short keys: {', '.join(refs)}"
            return ""
        if kind == "pairs":
            got = ist.pairs_of(s)
            if not got:
                return f"{key} holds no key=value pair"
            for bit in ist.bits(s):
                i = bit.find("=")
                if i == -1:
                    i = bit.find(":")
                if i <= 0:
                    return f"\"{bit}\" is not a key=value pair"
                if not bit[i + 1:].strip():
                    return f"\"{bit}\" has nothing after the ="
            order, m = got
            keys = spec.get("keys")
            if keys:
                wrong = [k for k in order if k not in keys]
                if wrong:
                    return f"{', '.join(wrong)} — {key} knows only {', '.join(keys)}"
            kp = spec.get("key_pattern")
            if kp:
                wrong = [k for k in order if not re.fullmatch(kp, k)]
                if wrong:
                    return (f"{', '.join(wrong)} — the left side is the column heading lowercased, "
                            f"with spaces and punctuation turned into _ (dodd_8_hour_exp)")
            refs = ist._refs(cat)
            if spec.get("course_keys"):
                wrong = [k for k in order if k not in refs]
                if wrong:
                    return f"{', '.join(wrong)} — not a course key; use the short keys: {', '.join(refs)}"
            values = spec.get("values")
            if values:
                wrong = [f"{k}={m[k]}" for k in order if m[k].strip().lower() not in values]
                if wrong:
                    return f"{', '.join(wrong)} — the value must be one of {', '.join(values)}"
            pattern = spec.get("value_pattern")
            if pattern:
                wrong = [f"{k}={m[k]}" for k in order if not re.fullmatch(pattern, m[k].strip())]
                if wrong:
                    return f"{', '.join(wrong)} — a column is lowercase letters, digits and _, joined by | or +"
            if spec.get("course_values"):
                wrong = [f"{k}={m[k]}" for k in order if m[k].strip() not in refs]
                if wrong:
                    return (f"{', '.join(wrong)} — the right side must be a course key: "
                            f"{', '.join(refs)}")
            if spec.get("never_value"):
                wrong = [f"{k}={m[k]}" for k in order if ist._never(spec, k, m[k])]
                if wrong:
                    return (f"{', '.join(wrong)} — {spec['never_value']} is never given to * or to a "
                            f"word that means a lapsed or broken record")
            return ""
        if kind == "template":
            allowed = set(spec.get("placeholders") or [])
            wrong = sorted({p for p in re.findall(r"\{([^{}]*)\}", s) if p not in allowed})
            if wrong:
                return (f"{', '.join('{' + w + '}' for w in wrong)} is not filled in by this sentence — "
                        f"it knows {', '.join('{' + a + '}' for a in sorted(allowed))}")
            return ""
        return ""

    @staticmethod
    def resolve_one(key: str, raw: Any, catalogue: list[str] | None = None) -> tuple[str, str]:
        s = str(raw if raw is not None else "").strip()
        shipped = ist.SHIPPED.get(key, "")
        if not s or key not in ist.SPEC:
            return (shipped if key in ist.SPEC else s), ""
        why = ist.check(key, s, catalogue)
        if not why:
            return (str(ist.int_value(key, s)) if ist.SPEC[key].get("type") == "int" else s), ""
        if ist.SPEC[key].get("type") in ("list", "pairs"):
            kept = [b for b in ist.bits(s) if not ist.check(key, b, catalogue)]
            if kept:
                return ", ".join(kept), why
        return shipped, why

    @staticmethod
    def catalogue_of(raw_map: dict[str, Any] | None) -> list[str]:
        value, _why = ist.resolve_one("ist_cert_labels", (raw_map or {}).get("ist_cert_labels"))
        return (ist.pairs_of(value) or ([], {}))[0]

    @staticmethod
    def _partner_refused(raw_map: dict[str, Any], key: str, catalogue: list[str]) -> str:
        partner = (ist.SPEC.get(key) or {}).get("falls_back_with")
        if not partner:
            return ""
        value, why = ist.resolve_one(partner, raw_map.get(partner), catalogue)
        return partner if why and value == ist.SHIPPED.get(partner) else ""

    @staticmethod
    def resolve(raw_map: dict[str, Any] | None) -> tuple[dict[str, str], dict[str, str]]:
        raw_map = raw_map or {}
        catalogue = ist.catalogue_of(raw_map)
        values: dict[str, str] = {}
        problems: dict[str, str] = {}
        for key in ist.SHIPPED:
            values[key], why = ist.resolve_one(key, raw_map.get(key), catalogue)
            if why:
                problems[key] = why
        for key in ist.SHIPPED:
            partner = ist._partner_refused(raw_map, key, catalogue)
            if partner and values[key] != ist.SHIPPED[key]:
                values[key] = ist.SHIPPED[key]
                problems[key] = f"answers its shipped value with {partner}, which is refused"
        return values, problems

    @staticmethod
    def text(values: dict[str, str], key: str) -> str:
        if key not in ist.SPEC:
            return str(values.get(key) or "").strip()
        cat = ist.catalogue_of(values) if ist.uses_catalogue(key) or ist.SPEC[key].get("falls_back_with") else None
        if cat is not None and ist._partner_refused(values, key, cat):
            return ist.SHIPPED[key]
        return ist.resolve_one(key, values.get(key), cat)[0]

    @staticmethod
    def list_of(values: dict[str, str], key: str) -> list[str]:
        return ist.bits(ist.text(values, key)) or ist.bits(ist.SHIPPED.get(key, ""))

    @staticmethod
    def pairs(values: dict[str, str], key: str) -> tuple[list[str], dict[str, str]]:
        return ist.pairs_of(ist.text(values, key)) or ist.pairs_of(ist.SHIPPED.get(key, "")) or ([], {})

    @staticmethod
    def int_of(values: dict[str, str], key: str) -> int:
        n = ist.int_value(key, ist.text(values, key))
        spec = ist.SPEC.get(key) or {}
        lo, hi = spec.get("min"), spec.get("max")
        if n is None or (lo is not None and n < lo) or (hi is not None and n > hi):
            return int(ist.SHIPPED[key])
        return n

    @staticmethod
    def yes(values: dict[str, str], key: str) -> bool:
        return ist.text(values, key).lower() == "yes"

    @staticmethod
    def choice(values: dict[str, str], key: str) -> str:
        got = ist.text(values, key).lower()
        allowed = [str(a) for a in (ist.SPEC.get(key) or {}).get("allowed") or []]
        return got if got in allowed else ist.SHIPPED[key]

    @staticmethod
    def labels(values: dict[str, str]) -> tuple[frozenset[str], tuple[str, ...]]:
        return (frozenset(n.strip().upper() for n in ist.list_of(values, "ist_non_person_names")),
                tuple(w.strip().upper() for w in ist.list_of(values, "ist_non_person_contains") if w.strip()))

    @staticmethod
    def held_labels() -> tuple[frozenset[str], tuple[str, ...]]:
        return ist._resolved()["labels"]

    @staticmethod
    def not_a_person(name: Any, values: dict[str, str] | None = None) -> bool:
        names, words = ist.labels(values) if values is not None else ist._resolved()["labels"]
        up = str(name or "").strip().upper()
        if not up:
            return True
        return up in names or any(w in up for w in words)

    @staticmethod
    def ohio_today() -> date:
        return _today()

    @staticmethod
    def lapsed(trained_at: Any, valid_days: int, today: date | None = None) -> bool:
        day = str(trained_at or "").strip()[:10]
        if not valid_days or not day:
            return False
        try:
            at = date.fromisoformat(day)
        except ValueError:
            return False
        return (today or _today()) > at + timedelta(days=int(valid_days))

    @staticmethod
    def read(src: Any) -> tuple[dict[str, str], str]:
        """The declared house's cells and 'sheet', or ({}, why) — never a same-named tab in another book."""
        try:
            db = _db(src)
            house = _text(_pointer(db, "HUB_HOUSE_" + ist.TAB.upper() + "_ID"), 60)
        except Exception as exc:  # noqa: BLE001 - a failed read is said, never an empty config
            return {}, f"the {ist.TAB} house could not be read ({type(exc).__name__})"
        if not house:
            return {}, f"no {ist.TAB} house is declared in the depot"
        rows: list[dict] = []
        try:
            for tab in ("Data", ist.TAB):
                rows = [r for r in _tab_rows(db, house, tab) if isinstance(r, dict)]
                if rows:
                    break
        except Exception as exc:  # noqa: BLE001
            return {}, f"the {ist.TAB} house could not be read ({type(exc).__name__})"
        found: dict[str, str] = {}
        for d in rows:
            k = str((d or {}).get("key") or "").strip()[:80]
            if k:
                found[k] = str((d or {}).get("value") or "")[:4000]
        return (found, "sheet") if found else ({}, f"the {ist.TAB} house holds no rows in asa-hub-db yet")

    @staticmethod
    def adopt(raw: dict[str, str], source: str = "sheet") -> None:
        with _IST_LOCK:
            _IST_HELD.update(at=time.time(), raw=dict(raw), source=source, resolved=None, gen=_IST_HELD["gen"] + 1)

    @staticmethod
    def pin(values: dict[str, str] | None) -> None:
        """Checks only: answer these cells without reading anything (None un-pins)."""
        with _IST_LOCK:
            _IST_HELD["pinned"] = dict(values) if values is not None else None
            _IST_HELD["resolved"] = None
            _IST_HELD["gen"] += 1

    @staticmethod
    def forget() -> None:
        """Checks only: back to nothing read."""
        with _IST_LOCK:
            _IST_HELD.update(at=0.0, raw=None, source="shipped", resolved=None, gen=_IST_HELD["gen"] + 1)

    @staticmethod
    def _resolved() -> dict[str, Any]:
        with _IST_LOCK:
            got = _IST_HELD.get("resolved")
            if got is not None:
                return got
            gen = _IST_HELD["gen"]
            pinned = _IST_HELD.get("pinned")
            raw = pinned if pinned is not None else _IST_HELD.get("raw")
            source = "pinned" if pinned is not None else (_IST_HELD.get("source") if raw else "shipped")
        values, problems = ist.resolve(raw or {})
        got = {"values": values, "problems": problems, "source": source, "labels": ist.labels(values),
               "unknown": sorted(k for k in (raw or {}) if k not in ist.SPEC)}
        with _IST_LOCK:
            if _IST_HELD["gen"] == gen:
                _IST_HELD["resolved"] = got
        return got

    @staticmethod
    def state() -> dict[str, Any]:
        got = ist._resolved()
        return {"values": dict(got["values"]), "problems": dict(got["problems"]), "source": got["source"],
                "unknown": list(got["unknown"])}

    @staticmethod
    def current() -> dict[str, str]:
        return dict(ist._resolved()["values"])

    @staticmethod
    def unread() -> bool:
        """True while no read of the house has landed: the shipped values answer only because nothing was read."""
        return ist.state()["source"] == "shipped"

    @staticmethod
    def rules(src: Any = None, *, cur: Any = None, fresh: bool = False) -> dict[str, str]:
        """The resolved settings, refreshed from asa-hub-db at most every TTL_S; a failed read keeps the last copy."""
        with _IST_LOCK:
            if _IST_HELD.get("pinned") is not None:
                return ist.resolve(_IST_HELD["pinned"])[0]
            young = _IST_HELD.get("raw") is not None and time.time() - float(_IST_HELD["at"]) < ist.TTL_S
        if young and not fresh:
            return ist.current()
        got: dict[str, str] = {}
        why = "no reader"
        reader = src if src is not None else cur
        try:
            if reader is not None:
                got, why = ist.read(reader)
        except Exception as exc:  # noqa: BLE001
            why = f"the {ist.TAB} house could not be read ({type(exc).__name__})"
        if got:
            before = ist.state()["problems"]
            ist.adopt(got, "sheet")
            after = ist.state()["problems"]
            if after and after != before:
                log.warning("ist_config: %d cell(s) refused, their shipped values answer: %s",
                            len(after), "; ".join(f"{k}: {v}" for k, v in sorted(after.items())))
        else:
            with _IST_LOCK:
                _IST_HELD["at"] = time.time()
                if _IST_HELD.get("raw") is None:
                    _IST_HELD["raw"] = {}
                if _IST_HELD.get("raw"):
                    _IST_HELD["source"] = "last known"
                _IST_HELD["resolved"] = None
                _IST_HELD["gen"] += 1
            log.info("ist_config: %s — answering with the %s settings", why,
                     "last known" if ist.state()["source"] == "last known" else "shipped")
        return ist.current()


# ---- shift_requests -------------------------------------------------------------------

class sr:  # noqa: N801 - server/shift_requests.py
    OHIO = OHIO
    ESSENCIAL_SHEET_ID = hubdb.ESSENCIAL_ID
    # TEAMLEAD is the stored token, beside HM (house manager parity); TL and TEAM LEAD are older spellings, kept
    MANAGER_BADGES = frozenset(b.strip().upper() for b in os.getenv(
        "HUB_REQUESTS_MANAGER_BADGES",
        "MASTER,DIRECTOR,ADMINISTRATOR,ADMIN,MANAGER,HM,TEAMLEAD,TL,TEAM LEAD").split(",") if b.strip())
    REASON_BADGES = frozenset(b.strip().upper() for b in os.getenv(
        "HUB_REQUESTS_REASON_BADGES", "MASTER,DIRECTOR,ADMINISTRATOR,ADMIN").split(",") if b.strip())
    BADGE_TITLES = {"DIRECTOR": "director", "TEAM LEAD": "team lead", "TL": "team lead",
                    "ADMINISTRATOR": "administrator", "ADMIN": "administrator", "MANAGER": "manager", "MASTER": "",
                    "PLATFORM LEAD": ""}
    TITLE_ORDER = ("director", "supervisor", "team lead", "administrator", "manager")
    KIND_OPEN = "open_shift"
    KIND_CALLOFF = "call_off"
    KIND_SWAP = "swap"
    KIND_IST = "ist_approval"
    KIND_TIME_OFF = "time_off"
    TRAINING = "training"
    APPLIED = "applied"
    NEEDS_TRAINING = "needs_training_approval"
    APPROVED = "approved"
    NOT_CHOSEN = "not_chosen"
    WITHDRAWN = "withdrawn"
    REFUSED = "refused"
    LIVE_STATES = (APPLIED, NEEDS_TRAINING)
    REHEARSAL = "rehearsal"
    REHEARSAL_VIA = f"{REHEARSAL}:"
    REF_RE = re.compile(r"\bSP[0-9A-F]{10}\b")
    DEEP_LINK_PATH = "/#/app/calendarbuilder/house-cal"
    HOTLINE_TAB = os.getenv("HUB_HOTLINE_CALENDAR_TAB", "Calendar Archive")
    MANAGERS_CURRENT_DAYS = int(os.getenv("HUB_HOUSE_MANAGER_CURRENT_DAYS", "7"))
    CALENDAR_BADGE = "HM"
    CALENDAR_REFUSED_ROLES = frozenset(r.strip().lower() for r in os.getenv(
        "HUB_HOUSECAL_REFUSED_ROLES", "client,guardian").split(",") if r.strip())
    CALENDAR_EDIT_ROLES = frozenset(r.strip().lower() for r in os.getenv(
        "HUB_HOUSECAL_EDIT_ROLES", "manager").split(",") if r.strip())
    OPEN_ROW = re.compile(r"^\s*open(?![a-z])", re.IGNORECASE)

    @staticmethod
    def fold(name: Any) -> str:
        """The platform's own name key (`clientNameKey_`)."""
        return re.sub(r"[^a-z0-9]+", "", str(name or "").lower())

    @staticmethod
    def is_rehearsed(row: dict[str, Any] | None) -> bool:
        """True when a request row was made by the rehearsal — by its via or by the evidence on it."""
        row = row or {}
        if str(row.get("via") or "").startswith(sr.REHEARSAL_VIA):
            return True
        if bool(row.get(sr.REHEARSAL)):
            return True
        extra = row.get("extra")
        return isinstance(extra, dict) and sr.REHEARSAL in extra

    @staticmethod
    def ref_of(location: str, open_row: str, col_iso: str) -> str:
        """The pool handle the relay mints; without the relay's key no handle is guessed: the relay answers."""
        if not _REF_KEY:
            raise sc.Defer("a shift handle the pool row lacks needs the relay's key, so the relay answers")
        raw = f"{location}|{open_row}|{col_iso}".encode()
        return "SP" + hmac.new(_REF_KEY, raw, hashlib.sha256).hexdigest()[:10].upper()

    @staticmethod
    def deep_link(ref: str, location: str = "") -> str:
        parts = [f"house={quote(location, safe='')}"] if location else []
        parts.append(f"ref={quote(str(ref or ''), safe='')}")
        return f"{sr.DEEP_LINK_PATH}?{'&'.join(parts)}"

    @staticmethod
    def short_house(location: str) -> str:
        return house_directory.label_of(location, house_directory.code_of(location)) or location

    @staticmethod
    def at_hour(day: date, hour: float) -> datetime:
        """26.5 is 2:30 the next morning, as the grammar writes an overnight."""
        return datetime.combine(day, clock_time(0, 0), tzinfo=OHIO) + timedelta(hours=float(hour))

    @staticmethod
    def day_of(col_iso: str) -> date | None:
        try:
            y, m, d = (int(p) for p in str(col_iso).split("-")[:3])
            return date(y, m, d)
        except Exception:  # noqa: BLE001 - a column that is not a day has no span
            return None

    @staticmethod
    def overlaps(a: tuple[datetime, datetime], b: tuple[datetime, datetime]) -> bool:
        return a[0] < b[1] and b[0] < a[1]

    @staticmethod
    def is_open_row(name: Any) -> bool:
        return bool(sr.OPEN_ROW.match(str(name or "")))

    @staticmethod
    def not_a_person(name: Any, location: Any = "", rules: dict[str, str] | None = None) -> bool:
        """An OPEN or WORKSHOP row, or a coverage label from the IST settings (ist_non_person_*)."""
        n, low = str(name or ""), str(name or "").lower()
        skip = not n or low == "open" or "workshop" in low or "workshop" in str(location or "").lower()
        return skip or sr.is_open_row(name) or ist.not_a_person(name, rules)

    @staticmethod
    def _badge_title(badge: str) -> str:
        bare = str(badge).replace(" ", "").upper()
        return next((t for k, t in sr.BADGE_TITLES.items() if k.replace(" ", "") == bare), str(badge).lower())

    @staticmethod
    def decider_titles(badges: Any = None) -> list[str]:
        given = set(badges) if badges is not None else set(sr.REASON_BADGES)
        given |= {w for w, stands in sc.BADGE_FOLLOWS.items() if stands in given}
        titles = {sr._badge_title(b) for b in given} - {""}
        return sorted(titles, key=lambda t: (sr.TITLE_ORDER.index(t) if t in sr.TITLE_ORDER
                                             else len(sr.TITLE_ORDER), t))

    @staticmethod
    def deciders_one(badges: Any = None) -> str:
        t = sr.decider_titles(badges) or ["manager above the house"]
        head = ", ".join(t[:-1]) + (" or " if len(t) > 1 else "") + t[-1]
        return ("an " if head[0] in "aeiou" else "a ") + head

    @staticmethod
    def deciders_all(badges: Any = None) -> str:
        t = [w + "s" for w in sr.decider_titles(badges)]
        if not t:
            return "managers above the house"
        return ", ".join(t[:-1]) + (" and " if len(t) > 1 else "") + t[-1]

    @staticmethod
    def _row_day(raw: Any) -> date | None:
        text = str(raw or "").strip()
        if not text:
            return None
        try:
            return datetime.strptime(text.split()[0], "%m/%d/%Y").date()
        except ValueError:
            pass
        try:
            return date.fromisoformat(text[:10])
        except ValueError:
            return None

    @staticmethod
    def managers_from_rows(rows: Iterable[dict[str, Any]], *, today: date) -> dict[str, dict[str, Any]]:
        """code → {name, names, phone, house, last_day}: the latest ** row on or before today, never the first."""
        per: dict[str, list[tuple[date | None, int, dict[str, Any]]]] = {}
        for order, d in enumerate(rows):
            if not isinstance(d, dict):
                continue
            where = str(d.get("Location") or "").strip()
            code = house_directory.code_of(where) or where.upper()
            name = str(d.get("Employee") or "").strip()
            if not code or not name:
                continue
            per.setdefault(code, []).append((sr._row_day(d.get("Date")), order, d))
        lo = today - timedelta(days=sr.MANAGERS_CURRENT_DAYS)
        hi = today + timedelta(days=sr.MANAGERS_CURRENT_DAYS)
        out: dict[str, dict[str, Any]] = {}
        for code, items in per.items():
            dated = [x for x in items if x[0] is not None]
            past = [x for x in dated if x[0] <= today]
            if past:
                anchor = max(past, key=lambda x: (x[0], x[1]))
            elif dated:
                anchor = min(dated, key=lambda x: (x[0], x[1]))
            else:
                anchor = max(items, key=lambda x: x[1])
            first = str(anchor[2].get("Employee") or "").strip()
            latest: dict[str, tuple[date, int]] = {}
            for day, order, d in dated:
                if lo <= day <= hi:
                    nm = str(d.get("Employee") or "").strip()
                    if nm not in latest or (day, order) > latest[nm]:
                        latest[nm] = (day, order)
            names = [first] + [nm for nm, _ in sorted(latest.items(), key=lambda kv: kv[1], reverse=True)
                               if sr.fold(nm) != sr.fold(first)]
            out[code] = {"name": first, "names": names,
                         "phone": str(anchor[2].get("Phone") or "").strip(),
                         "house": str(anchor[2].get("Location") or "").strip(),
                         "last_day": anchor[0].isoformat() if anchor[0] else ""}
        return out

    @staticmethod
    def house_managers(src: Any, *, fresh: bool = False, today: date | None = None) -> dict[str, Any]:
        """Who manages each house: the hotline calendar's ** rows; asa-hub-db not answering raises hubdb.Unreadable."""
        def build() -> dict[str, Any]:
            view: dict[str, Any] = {"readable": False, "why": "", "by_code": {}}
            db = _db(src)
            book = _pointer(db, "HOTLINE_CALENDAR_ID")
            if not book:
                view["why"] = "the platform declares no HOTLINE_CALENDAR_ID"
                return view
            rows = [r for r in _tab_rows(db, book, sr.HOTLINE_TAB)
                    if isinstance(r, dict) and _pg_text(r.get("Designation")).strip(" ") == "**"]
            view["readable"] = True
            view["by_code"] = sr.managers_from_rows(rows, today=today or _today())
            if not view["by_code"]:
                view["why"] = f"the hotline calendar's {sr.HOTLINE_TAB} tab holds no ** rows"
            return view
        if fresh or today is not None:
            return build()
        return _once(src, "managers", build)

    @staticmethod
    def _is_manager_of(hm: dict[str, Any] | None, person: str) -> bool:
        key = sr.fold(person)
        if not hm or not key:
            return False
        return any(sr.fold(n) == key for n in (hm.get("names") or [hm.get("name")]))

    @staticmethod
    def manages(src: Any, person: str, location: str) -> bool:
        if not person.strip():
            return False
        code = house_directory.code_of(location) or str(location or "").strip().upper()
        return sr._is_manager_of(sr.house_managers(src)["by_code"].get(code), person)

    @staticmethod
    def houses_managed(src: Any, person: str) -> list[str]:
        if not sr.fold(person):
            return []
        return sorted(code for code, hm in sr.house_managers(src)["by_code"].items()
                      if sr._is_manager_of(hm, person))

    @staticmethod
    def badges_of(role: Any, types: Any) -> set[str]:
        worn: set[str] = set()
        if isinstance(types, str):
            worn |= {t.strip().upper() for t in re.split(r"[,;|\n]+", types) if t.strip()}
        elif isinstance(types, (list, tuple, set)):
            worn |= {str(t).strip().upper() for t in types if str(t).strip()}
        # an SSA's or a FAMILY's role word is never a badge (scope.role_counts)
        if role and sc.role_counts(list(worn), role):
            worn.add(str(role).strip().upper())
        out = {str(w).strip().upper() for w in worn if str(w).strip()}
        for word in list(out):
            stands = sc.BADGE_FOLLOWS.get(word)
            if stands:
                out.add(stands)
        return out

    @staticmethod
    def viewer(src: Any, *, name: str, role: str = "", types: Any = None,
               is_master: bool | None = None) -> dict[str, Any]:
        """Who is reading: the badges worn, the houses the hotline calendar says they manage."""
        worn = sr.badges_of(role, types)
        if is_master:
            worn.add("MASTER")
        whole = bool(worn & sr.MANAGER_BADGES)
        mine = sr.houses_managed(src, name)
        everywhere = bool(worn & sr.REASON_BADGES)
        derived = bool(mine) and sr.CALENDAR_BADGE not in worn
        if derived:
            worn.add(sr.CALENDAR_BADGE)
        readable = True
        if sr.fold(name):
            try:
                readable = bool(sr.house_managers(src).get("readable"))
            except Exception:  # noqa: BLE001 - said, not raised: the reader is still built
                readable = False
        return {"name": name, "badges": sorted(worn), "whole_company": whole,
                "sees_reasons": everywhere, "manages": mine,
                "decides_everywhere": everywhere, "decides": mine,
                "role": str(role or "").strip().lower(), "managers_readable": readable,
                "hm_by_calendar": derived, "is_master": bool(is_master)}

    @staticmethod
    def sees_house(view: dict[str, Any], location: str) -> bool:
        if view.get("whole_company"):
            return True
        code = house_directory.code_of(location) or str(location or "").strip().upper()
        return code in set(view.get("manages") or [])

    @staticmethod
    def may_decide(view: dict[str, Any], location: str) -> bool:
        if view.get("decides_everywhere"):
            return True
        code = house_directory.code_of(location) or str(location or "").strip().upper()
        return code in set(view.get("decides") or [])

    @staticmethod
    def _ist_rows(src: Any) -> tuple[list[dict[str, Any]], str]:
        """(rows, where) from the declared IST house (both tab spellings), or ([], why) — never another book's."""
        db = _db(src)
        import ist  # noqa: PLC0415 - the records' owner, IST Records: Postgres once the app is Python's
        kept = ist.raw_records(db)
        if kept is not None:
            return kept, "postgres/" + ist.RECORDS
        book = _pointer(db, "HUB_HOUSE_IST_RECORDS_ID")
        if not book:
            return [], "the IST house is not declared (HUB_HOUSE_IST_RECORDS_ID)"
        for tab in ("Data", "ist_records"):
            rows = [dict(r) for r in _tab_rows(db, book, tab) if isinstance(r, dict)]
            if rows:
                return rows, f"{book}/{tab}"
        return [], f"the declared IST house {book} holds no rows in Data or ist_records"

    # -- the estate and the cell's hours (My Calendar) --
    UNREADABLE = "unreadable"
    CALL_OFF_ROW = "OPEN · call-off"
    OPEN_SHIFT_REGULAR_DAYS = int(os.getenv("HUB_OPEN_SHIFT_REGULAR_DAYS", "28"))
    OVERRIDES_TABLE = "asa_house_calendar_overrides"
    WORKED_TABLE = "asa_house_worked_days"

    @staticmethod
    def _iso(value: Any) -> str:
        return value.isoformat() if hasattr(value, "isoformat") else str(value or "")

    @staticmethod
    def span_of(col_iso: str, text: str) -> tuple[datetime, datetime] | None:
        """The interval one roster cell occupies, via shift_slices.classify; None when it holds no hours."""
        day = sr.day_of(col_iso)
        if day is None:
            return None
        shift = mw_roster.shift_slices.classify(str(text or ""))
        if not shift or shift.get("start") is None or shift.get("end") is None:
            return None
        return sr.at_hour(day, float(shift["start"])), sr.at_hour(day, float(shift["end"]))

    @staticmethod
    def unreadable_hours(value: Any) -> bool:
        """A working cell whose hours nobody can read — classify's alias. Empty, OFF and R/O hold no hours."""
        got = mw_roster.shift_slices.classify(str(value or ""))
        return bool(got) and got.get("kind") == "alias"

    @staticmethod
    def whole_day(col_iso: Any) -> tuple[datetime, datetime] | None:
        """The day a cell with unreadable hours is held for: nothing else may stand beside it."""
        day = sr.day_of(str(col_iso or ""))
        return (sr.at_hour(day, 0), sr.at_hour(day, 24)) if day else None

    @staticmethod
    def grid_name(view: dict[str, Any], name: str, location: str = "", *,
                  this_house_only: bool = False) -> str:
        """The name as the calendars spell it (this house first), or ''; writes are keyed by that spelling."""
        key = sr.fold(name)
        if not key:
            return ""
        houses = [location] if this_house_only else \
            [location] + [x for x in view.get("locations") or [] if x != location]
        for loc in houses:
            for n in (view.get("people") or {}).get(loc, []):
                if sr.fold(n) == key and not sr.not_a_person(n, loc):
                    return n
        return ""

    @staticmethod
    def essentials(location: str, col_iso: str, value: str, *,
                   homes: dict[str, dict[str, str]],
                   managers: dict[str, Any]) -> dict[str, Any]:
        code = house_directory.code_of(location) or str(location or "").strip().upper()
        home = homes.get(code) or {}
        span = sr.span_of(col_iso, value)
        hm = (managers.get("by_code") or {}).get(code) or {}
        names = [n for n in (hm.get("names") or [hm.get("name")]) if n]
        return {"house": sr.short_house(location), "house_name": str(home.get("name") or ""),
                "code": code, "address": str(home.get("address") or ""),
                "col_iso": col_iso, "shift_code": str(value or "").strip(),
                "shift_start": sr._iso(span[0]) if span else "",
                "shift_end": sr._iso(span[1]) if span else "",
                "hours": round((span[1] - span[0]).total_seconds() / 3600.0, 2) if span else None,
                "manager": str(hm.get("name") or ""), "managers": names,
                "managers_readable": bool(managers.get("readable")),
                "deciders": sr.deciders_all()}

    @staticmethod
    def _worked_record(src: Any, today: date) -> dict[str, Any]:
        """{worked, since, why}: the remembered roster days of the regular window, and each house's first one."""
        out: dict[str, Any] = {"worked": {}, "since": {}, "why": ""}
        try:
            got = mw_relay_state.rows(sr.WORKED_TABLE, columns=("person_key", "location", "day"))
            floor = today - timedelta(days=sr.OPEN_SHIFT_REGULAR_DAYS + 1)
            since: dict[str, date] = {}
            for r in got:
                d = r.get("day")
                if isinstance(d, datetime):
                    d = d.date()
                elif d is not None and not isinstance(d, date):
                    d = date.fromisoformat(str(d)[:10])
                if d is None:
                    continue
                if d >= floor:
                    out["worked"].setdefault((str(r.get("person_key")), str(r.get("location"))), set()).add(d)
                loc = str(r.get("location"))
                since[loc] = min(since[loc], d) if loc in since else d
            out["since"] = since
        except sc.Defer:
            raise
        except Exception as exc:  # noqa: BLE001 - FAIL-CLOSED: the grids alone cover fewer days, said as such
            out["worked"], out["since"] = {}, {}
            out["why"] = f"the worked-days record could not be read ({type(exc).__name__})"
        return out

    @staticmethod
    def estate(src: Any, *, fresh: bool = False) -> dict[str, Any]:
        """Every house grid with its overrides and pending published cells on top, indexed several ways."""
        def build() -> dict[str, Any]:
            hcl = mw_roster.house_cal_live
            view: dict[str, Any] = {"locations": [], "by_code": {}, "cells": {}, "isos": {},
                                    "people": {}, "spans": {}, "unreadable": {}, "worked": {},
                                    "read_at": sr._iso(datetime.now(timezone.utc))}
            grids = [(r.get("location"), r.get("grid"))
                     for r in mw_relay_state.rows(hcl.LIVE, order="location", columns=("location", "grid"))]
            overrides: dict[str, dict[tuple[str, str], str]] = {}
            for r in mw_relay_state.rows(sr.OVERRIDES_TABLE, columns=("location", "employee", "col_iso", "value")):
                overrides.setdefault(r.get("location"), {})[(r.get("employee"), r.get("col_iso"))] = r.get("value")
            published = hcl.pending_publishes(src)
            for loc, raw in grids:
                grid = hcl._as_dict(raw)
                isos = hcl.col_isos(grid)
                view["locations"].append(loc)
                view["isos"][loc] = isos
                code = house_directory.code_of(loc)
                if code:
                    view["by_code"][code] = loc
                cells: dict[tuple[str, str], str] = {}
                people: list[str] = []
                for row in grid.get("rows", []) or []:
                    emp = str(row.get("employee") or "")
                    if not emp:
                        continue
                    people.append(emp)
                    drawn = row.get("cells", []) or []
                    for i, iso in enumerate(isos):
                        text = str((drawn[i] or {}).get("text") or "") if i < len(drawn) else ""
                        text = overrides.get(loc, {}).get((emp, iso), text)
                        if text.strip():
                            cells[(emp, iso)] = text
                for (emp, iso), value in overrides.get(loc, {}).items():
                    if value.strip() and (emp, iso) not in cells:
                        cells[(emp, iso)] = value
                        if emp not in people:
                            people.append(emp)
                for (emp, iso), value in published.get(loc, {}).items():
                    if iso not in isos:
                        continue
                    if str(value).strip():
                        cells[(emp, iso)] = value
                        if emp not in people:
                            people.append(emp)
                    else:
                        cells.pop((emp, iso), None)
                view["cells"][loc] = cells
                view["people"][loc] = people
                for (emp, iso), text in cells.items():
                    if sr.not_a_person(emp, loc):
                        continue
                    key = sr.fold(emp)
                    span = sr.span_of(iso, text)
                    if span is None:
                        whole = sr.whole_day(iso) if sr.unreadable_hours(text) else None
                        if whole:
                            view["unreadable"].setdefault(key, []).append(
                                {"location": loc, "employee": emp, "col_iso": iso, "value": text,
                                 "span": whole, "source": sr.UNREADABLE})
                        continue
                    day = sr.day_of(iso)
                    if day is not None:
                        view["worked"].setdefault((key, loc), set()).add(day)
                    view["spans"].setdefault(key, []).append(
                        {"location": loc, "employee": emp, "col_iso": iso, "value": text,
                         "span": span, "source": "roster"})
            record = sr._worked_record(src, datetime.now(OHIO).date())
            for pair, days in record["worked"].items():
                view["worked"].setdefault(pair, set()).update(days)
            view["worked_since"] = {}
            for loc in view["locations"]:
                firsts = [d for d in (min((sr.day_of(i) for i in view["isos"].get(loc, []) if sr.day_of(i)),
                                          default=None), record["since"].get(loc)) if d]
                view["worked_since"][loc] = min(firsts) if firsts else None
            view["worked_why"] = record["why"]
            return view
        return build() if fresh else _once(src, "estate", build)


# ---- shift_handoff ----------------------------------------------------------------------

class handoff:  # noqa: N801 - server/shift_handoff.py
    TABLE = "asa_shift_handoffs"
    REQUESTS_TABLE = "asa_shift_requests"
    REHEARSAL_KEY = sr.REHEARSAL
    REHEARSAL_VIA = sr.REHEARSAL_VIA
    PENDING, DONE, DEAD = "pending", "done", "dead"
    ACCEPTED, DECLINED = "accepted", "declined"
    APPROVED, NOT_APPROVED = "approved", "declined"
    BY_HOUSE_MANAGER = "house_manager"
    BY_ABOVE = "above"
    REF_RE = re.compile(r"\bHO[0-9A-F]{10}\b")
    KIND_ASK_STAFF = "handoff_ask_staff"
    KIND_ASK_MANAGER = "handoff_ask_manager"
    KIND_ASK_ABOVE = "handoff_ask_above"
    KIND_ASK_DIRECTOR = "handoff_ask_director"
    DELIVERED = frozenset({"told", "duplicate"})

    @staticmethod
    def is_rehearsed(row: dict[str, Any] | None) -> bool:
        """True when a transfer was offered or answered by the staff-answers rehearsal."""
        row = row or {}
        extra = row.get("extra")
        if isinstance(extra, dict) and handoff.REHEARSAL_KEY in extra:
            return True
        return any(str(row.get(col) or "").startswith(handoff.REHEARSAL_VIA)
                   for col in ("staff_via", "manager_via", "director_via"))

    @staticmethod
    def _iso(value: Any) -> str:
        return value.isoformat() if hasattr(value, "isoformat") else str(value or "")

    @staticmethod
    def _names(raw: Any) -> list[str]:
        if isinstance(raw, str):
            try:
                raw = json.loads(raw)
            except ValueError:
                raw = []
        return [str(n) for n in (raw or []) if str(n or "").strip()]

    @staticmethod
    def _json(raw: Any) -> dict[str, Any]:
        if isinstance(raw, str):
            try:
                raw = json.loads(raw)
            except ValueError:
                raw = {}
        return raw if isinstance(raw, dict) else {}

    @staticmethod
    def director_names(row: dict[str, Any]) -> list[str]:
        return handoff._names(row.get("directors"))

    @staticmethod
    def manager_names(row: dict[str, Any]) -> list[str]:
        """The names this row asked for the house manager's consent; empty when it was asked above."""
        return [n for n in (handoff._names(row.get("approvers")) + [row.get("house_manager")])
                if str(n or "").strip()]

    @staticmethod
    def _words(name: Any) -> list[str]:
        return [w for w in re.split(r"[^a-z0-9]+", str(name or "").lower()) if w]

    @staticmethod
    def _named_as(name: Any, listed: Any) -> bool:
        """time_off.named_as: the listed name itself, or its words with its middle initial left out."""
        fa, fb = sr.fold(name), sr.fold(listed)
        if not fa or not fb:
            return False
        if fa == fb:
            return True
        wa, wb = handoff._words(name), handoff._words(listed)
        long_a, long_b = [w for w in wa if len(w) > 1], [w for w in wb if len(w) > 1]
        if len(long_a) < 2 or long_a != long_b:
            return False
        ia, ib = [w for w in wa if len(w) == 1], [w for w in wb if len(w) == 1]
        return not ia or ia == ib

    @staticmethod
    def _same_name(a: Any, b: Any) -> bool:
        if not sr.fold(a) or not sr.fold(b):
            return False
        return sr.fold(a) == sr.fold(b) or handoff._named_as(a, b) or handoff._named_as(b, a)

    @staticmethod
    def listed_director(name: Any, row: dict[str, Any]) -> bool:
        return bool(sr.fold(name)) and any(handoff._named_as(name, n) for n in handoff.director_names(row))

    @staticmethod
    def _pair_names(row: dict[str, Any]) -> list[str]:
        return [str(row.get(k) or "") for k in ("from_staff", "to_staff", "offered_by") if sr.fold(row.get(k))]

    @staticmethod
    def _in_swap(name: Any, row: dict[str, Any]) -> bool:
        return any(handoff._same_name(name, p) for p in handoff._pair_names(row))

    @staticmethod
    def _gave(row: dict[str, Any], field: str, name: Any) -> bool:
        return handoff._same_name(name, row.get(field))

    @staticmethod
    def _pair(row: dict[str, Any]) -> set[str]:
        return {k for k in (sr.fold(row.get("from_staff")), sr.fold(row.get("to_staff")),
                            sr.fold(row.get("offered_by"))) if k}

    @staticmethod
    def may_approve_director(who: dict[str, Any], row: dict[str, Any]) -> bool:
        name = str((who or {}).get("name") or "")
        if not sr.fold(name) or handoff._in_swap(name, row):
            return False
        if handoff._gave(row, "manager_by", name):
            return False
        if (who or {}).get("is_master") is True:
            return True
        return handoff.listed_director(name, row)

    @staticmethod
    def may_approve(who: dict[str, Any], row: dict[str, Any]) -> bool:
        name = str((who or {}).get("name") or "")
        me = sr.fold(name)
        if me and me in handoff._pair(row):
            return False
        if me and handoff._gave(row, "director_by", name):
            return False
        named = [sr.fold(n) for n in handoff.manager_names(row)]
        if me and named and me not in named and handoff.listed_director(name, row):
            return False
        if not me and not (who or {}).get("decides_everywhere"):
            return False
        if row.get("approval") == handoff.BY_ABOVE:
            return bool((who or {}).get("decides_everywhere"))
        if me and me in named:
            return True
        return sr.may_decide(who or {}, str(row.get("location") or ""))

    @staticmethod
    def side_for(who: dict[str, Any], row: dict[str, Any]) -> str:
        """'staff', 'manager', 'director' or '' — from the session only, never the request body."""
        me = sr.fold((who or {}).get("name"))
        if me and me == sr.fold(row.get("to_staff")):
            return "staff"
        manager, director = handoff.may_approve(who, row), handoff.may_approve_director(who, row)
        manager_open = manager and str(row.get("manager_state") or handoff.PENDING) == handoff.PENDING
        if manager_open and me and any(sr.fold(n) == me for n in handoff.manager_names(row)):
            return "manager"
        if director and str(row.get("director_state") or handoff.PENDING) == handoff.PENDING:
            return "director"
        if manager_open:
            return "manager"
        return ""

    @staticmethod
    def may_withdraw(who: dict[str, Any], row: dict[str, Any]) -> bool:
        me = sr.fold((who or {}).get("name"))
        if me and me in (sr.fold(row.get("from_staff")), sr.fold(row.get("offered_by"))):
            return True
        return sr.may_decide(who or {}, str(row.get("location") or ""))

    @staticmethod
    def waits_on(row: dict[str, Any], name: str, *, above: bool = False) -> bool:
        """Whether a pending swap waits on this name, seat by seat."""
        me = sr.fold(name)
        if not me or row.get("state") != handoff.PENDING:
            return False
        if me == sr.fold(row.get("to_staff")) and row.get("staff_state") == handoff.PENDING:
            return True
        if me in (sr.fold(row.get("from_staff")), sr.fold(row.get("to_staff"))):
            return False
        if row.get("manager_state") == handoff.PENDING and not handoff._gave(row, "director_by", name) and (
                any(sr.fold(n) == me for n in handoff.manager_names(row))
                or (above and row.get("approval") == handoff.BY_ABOVE)):
            return True
        return (str(row.get("director_state") or handoff.PENDING) == handoff.PENDING
                and not handoff._in_swap(name, row) and not handoff._gave(row, "manager_by", name)
                and handoff.listed_director(name, row))

    @staticmethod
    def _ask_state(entry: Any) -> dict[str, Any]:
        if isinstance(entry, str):
            return {"state": "told", "why": "", "at": entry, "reached": True}
        if not isinstance(entry, dict):
            return {"state": "", "why": "", "at": "", "reached": False}
        state = str(entry.get("state") or "")
        return {"state": state, "why": str(entry.get("why") or ""), "at": str(entry.get("at") or ""),
                "reached": state in handoff.DELIVERED}

    @staticmethod
    def _ask_seen(said: dict[str, Any], kind: str) -> dict[str, Any]:
        """One ask's outcome over all its seats: a seat that reached somebody speaks for it."""
        seen = [v for k, v in said.items() if str(k or "").partition(":")[0] == kind]
        for entry in seen:
            if handoff._ask_state(entry)["reached"]:
                return handoff._ask_state(entry)
        return handoff._ask_state(seen[0] if seen else None)

    @staticmethod
    def describe(row: dict[str, Any], who: dict[str, Any] | None, *, training_state: str = "") -> dict[str, Any]:
        who = who or {}
        me = sr.fold(who.get("name"))
        said = handoff._json(row.get("said"))
        training = handoff._json(row.get("training"))
        side = handoff.side_for(who, row) if row.get("state") == handoff.PENDING else ""
        ask_manager = handoff.KIND_ASK_ABOVE if row.get("approval") == handoff.BY_ABOVE else handoff.KIND_ASK_MANAGER
        directors = handoff.director_names(row)
        director_state = str(row.get("director_state") or handoff.PENDING)
        if director_state == handoff.PENDING and not directors and row.get("state") != handoff.PENDING:
            director_state = "not_asked"
        iso = handoff._iso
        return {
            "id": row["id"], "location": row.get("location") or "",
            "house": sr.short_house(str(row.get("location") or "")),
            "col_iso": row.get("col_iso") or "", "value": row.get("value") or "",
            "from_staff": row.get("from_staff") or "", "to_staff": row.get("to_staff") or "",
            "house_manager": row.get("house_manager") or "",
            "state": row.get("state") or "", "why": row.get("why") or "",
            "staff_state": row.get("staff_state") or "", "staff_via": row.get("staff_via") or "",
            "staff_at": iso(row.get("staff_at")), "staff_by": row.get("staff_by") or "",
            "manager_state": row.get("manager_state") or "",
            "manager_via": row.get("manager_via") or "", "manager_at": iso(row.get("manager_at")),
            "manager_by": row.get("manager_by") or "",
            "director_state": director_state,
            "director_via": row.get("director_via") or "", "director_at": iso(row.get("director_at")),
            "director_by": row.get("director_by") or "",
            "directors": directors, "director": directors[0] if directors else "",
            "created_at": iso(row.get("created_at")), "closed_at": iso(row.get("closed_at")),
            "offered_by": row.get("offered_by") or "", "closed_by": row.get("closed_by") or "",
            "shift_start": iso(row.get("shift_start")),
            "approval": {"mode": row.get("approval") or (handoff.BY_HOUSE_MANAGER if row.get("house_manager")
                                                         else ""),
                         "names": handoff._names(row.get("approvers")) or ([row["house_manager"]]
                                                                           if row.get("house_manager") else []),
                         "why": row.get("approval_why") or ""},
            "first_shift": {**training, "request": row.get("training_request") or "",
                            "request_state": training_state},
            "asks": {"staff": handoff._ask_state(said.get(handoff.KIND_ASK_STAFF)),
                     "manager": handoff._ask_state(said.get(ask_manager)),
                     "director": handoff._ask_seen(said, handoff.KIND_ASK_DIRECTOR)},
            "may_accept": side == "staff" and row.get("staff_state") == handoff.PENDING
            and not handoff.is_rehearsed(row),
            "may_approve": side == "manager" and row.get("manager_state") == handoff.PENDING
            and not handoff.is_rehearsed(row),
            "may_approve_director": side == "director" and director_state == handoff.PENDING
            and not handoff.is_rehearsed(row),
            "may_withdraw": row.get("state") == handoff.PENDING and handoff.may_withdraw(who, row),
            handoff.REHEARSAL_KEY: handoff.is_rehearsed(row),
            "mine": bool(me) and (me in handoff._pair(row) or me == sr.fold(row.get("offered_by"))
                                  or any(sr.fold(n) == me for n in handoff._names(row.get("approvers")))
                                  or handoff.listed_director(who.get("name"), row)),
        }

    @staticmethod
    def _training_states(rids: Iterable[str]) -> dict[str, str]:
        ids = sorted({r for r in rids if r})
        if not ids:
            return {}
        got = mw_relay_state.rows(handoff.REQUESTS_TABLE, "id = ANY(%s)", (ids,), columns=("id", "state"))
        return {str(r["id"]): str(r.get("state") or "") for r in got}

    @staticmethod
    def rows_for(src: Any = None, *, where: str = "", args: tuple = (), limit: int = 400
                 ) -> tuple[list[dict[str, Any]], dict[str, str]]:
        """The newest `limit` transfers matching `where` (the relay's SQL condition), and their training states."""
        rows = mw_relay_state.rows(handoff.TABLE, where or None, tuple(args), order="created_at DESC",
                                   limit=int(limit))
        return rows, handoff._training_states(str(r.get("training_request") or "") for r in rows)
