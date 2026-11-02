"""The one withholding rule both copies of the sheets (Postgres mirror, master JSON) call; credentials, logins, cards and government identifiers."""
from __future__ import annotations

import contextlib
import contextvars
import hashlib
import hmac
import os
import re
from typing import Any, Iterable, Iterator

# One marker a kind, so a missing prop, a missing card and a missing identifier read differently to whoever opens…
MARKER_SECRET = "[withheld: secret]"
MARKER_CARD = "[withheld: card]"
MARKER_IDENTIFIER = "[withheld: identifier]"
MARKER_PRIVATE = "[withheld: private]"
MARKERS = (MARKER_SECRET, MARKER_CARD, MARKER_IDENTIFIER, MARKER_PRIVATE)

# A column a book's own app needs back, kept only while a keeper copies THAT book (reading()); every other caller
# withholds it still. ASA Data — Forms: `token` is the key of each form's public link, which the Forms list hands
# to admins and managers. The client books: the Medicaid number Client Details shows whole and Billing joins its
# claim lines on.
BOOK_KEPT_COLUMNS: dict[str, frozenset[str]] = {
    "1yMFlXYlcS-bBImucBfULgMv3XSFzqeNPvkefG-j7IdQ": frozenset({"token"}),
    # Asa Client Database (Master, Archive - Old Clients)
    "1fTi78ztKDiK3hvYLbI2IQ1TeSrzVLceK5LyXJ4BVPe8": frozenset({"Medicaid #"}),
    # ASA Data — Clients (Data), the clients rows the Clients app layers over the plans
    "1FhcCovLFJIAiPOP2u_NgXU-Tsw1vKQ_GI-FcWFg0M6w": frozenset({"medicaid_id"}),
}

# A client book's masked cell keeps, inside its marker, only what the Clients mask draws (clientProfileMask_,
# csfLast4_), and only while a keeper copies THAT book: " kept: 1234", " kept: on file" or " kept: none". Every
# other caller withholds the cell whole, and every reader still treats it as withheld.
KEPT_TAIL = " kept:"
KEPT_ON_FILE = "on file"
KEPT_NONE = "none"
BOOK_KEPT_FACTS: dict[str, dict[str, str]] = {
    # Asa Client Database (Master, Archive - Old Clients)
    "1fTi78ztKDiK3hvYLbI2IQ1TeSrzVLceK5LyXJ4BVPe8": {
        "SSN": "ssn", "TL Debit Card Number": "card",
        "DC Exp Date": "present", "DC Security Code": "present", "DC PIN #": "present"},
    # Master Data (Client - Database)
    "1Yv8j2u1xN2auqjOS0udTeldk5mDJqMU9lswmkTNYTks": {"TL Debit Card Number": "card", "DC PIN #": "present"},
    # ASA Hub — Apps (finance_balances)
    "1zP_zDVlqah1eCUjAaxnFkcTacOwMcZSDH4YwPAoLyOY": {"debit_card": "last4"},
    # Asa Employee Database: the Staff masks (spSsnMask_) and the MAIS records' DD ID, kept only as an equality tag
    "1Gqq08-3nZgKDoCLDnIHg16qTtdzeSZt9aNQRRi5y45s": {"SSN#": "ssn9", "SSN (Last 4)": "four", "DD ID": "tag"},
}
# A "tag" keeps a keyed digest of the cell, never the cell: two equal cells carry the same tag. Its key is derived
# from the relay's service secret; with no secret the cell is withheld whole.
TAG_KEY_ENV = "HUB_SERVICE_SECRET"
TAG_CONTEXT = b"redaction-tag\0"
TAG_HEX = 16
_KEPT_ABSENT = re.compile(r"(na|none|no|null|0+)", re.I)
_KEPT_SPACES = re.compile(r"[\s﻿\-–—./]+")
_BOOK: contextvars.ContextVar[str] = contextvars.ContextVar("redaction_book", default="")


@contextlib.contextmanager
def reading(sheet_id: Any) -> Iterator[None]:
    """The book a keeper is copying, so the columns BOOK_KEPT_COLUMNS names for it pass."""
    token = _BOOK.set(str(sheet_id or ""))
    try:
        yield
    finally:
        _BOOK.reset(token)


def is_kept_here(column: Any) -> bool:
    kept = BOOK_KEPT_COLUMNS.get(_BOOK.get())
    return bool(kept) and str(column) in kept


def kept_fact_kind(column: Any) -> str:
    """What the book being copied keeps of this masked column ('ssn', 'card', 'last4', 'present'), '' for nothing."""
    return (BOOK_KEPT_FACTS.get(_BOOK.get()) or {}).get(str(column), "")


def _tag_key() -> bytes:
    secret = (os.getenv(TAG_KEY_ENV) or "").strip()
    return hashlib.sha256(TAG_CONTEXT + secret.encode()).digest() if secret else b""


def kept_fact(kind: str, value: Any) -> str:
    """The figure the mask draws from the cell alone: its last four digits, "on file", "none", or a "#" tag; "" when
    nothing may be kept (a tag with no key)."""
    if isinstance(value, float) and value.is_integer():
        value = int(value)
    raw = str(value if value is not None else "").strip()
    if kind == "tag":
        key = _tag_key()
        norm = re.sub(r"\s+", "", raw).upper()
        return "#" + hmac.new(key, norm.encode(), hashlib.sha256).hexdigest()[:TAG_HEX] if key and norm else ""
    if kind == "four":
        # spSsnMask_'s _four: a number pads to four digits, text keeps its digits
        four = ("000" + str(value))[-4:] if isinstance(value, int) and 0 <= value < 10000 else re.sub(r"[^0-9]", "", raw)
        return four if len(four) == 4 else KEPT_NONE
    if kind == "present":
        s = _KEPT_SPACES.sub("", raw)
        return KEPT_ON_FILE if s and not _KEPT_ABSENT.fullmatch(s) else KEPT_NONE
    digits = re.sub(r"[^0-9]", "", raw)
    if kind == "ssn":
        shown = len(digits) in (9, 4)
    elif kind == "ssn9":
        shown = len(digits) == 9
    elif kind == "card":
        shown = 12 <= len(digits) <= 19 or len(digits) == 4
    else:
        shown = len(digits) >= 4
    if shown:
        return digits[-4:]
    return KEPT_ON_FILE if len(digits) >= 4 else KEPT_NONE


def kept_marker(marker: str, kind: str, value: Any) -> str:
    fact = kept_fact(kind, value)
    return f"{marker}{KEPT_TAIL} {fact}" if fact else marker

# A person's own words kept out of both copies, matched by the normalised header.
PRIVATE_COLUMNS = frozenset({"time off reason"})

# Matched as whole words, never as substrings.
KEY_TOKENS = frozenset({
    "key", "secret", "token", "password", "passwd", "credential",
    "webhook", "private", "signing",
})

# Named one by one so a rename the word rule would miss cannot un-withhold one.
NAMED_PROPS = frozenset({
    "OPENAI_API_KEY",
    "GROK_API_KEY",
    "GROQ_KEY1", "GROQ_KEY2", "GROQ_KEY3", "GROQ_KEY4", "GROQ_KEY5",
    "OPENPHONE_API_KEY",
    "DROPBOX_SIGN_API_KEY",
    "HUB_SERVICE_SECRET",
    "HUB_MEDIA_PROBE_KEY",
    "INTERVIEW_LINK_SECRET",
    "BROWSER_AUTOMATION_BOT_SECRET",
    "QUO_WEBHOOK_KEY_MESSAGES",
    "QUO_WEBHOOK_KEY_SUMMARIES",
    "QUO_WEBHOOK_KEY_TRANSCRIPTS",
    "BRITTCO_PASSWORD",
    "FIRST_USER_PASSWORD",
    "ONBOARDING_USER_PASSWORD",
    "PLATFORM_EMAIL_PASSWORD",
    "PLATFORM_EMAIL_PASSWORD2",
    "PLATFORM_EMAIL_PASSWORD3",
    "PLATFORM_EMAIL_PASSWORD4",
    "PLATFORM_EMAIL_PASSWORD5",
})

# A key/value row needs one of these AND a VALUE_COLUMNS column: a lone `source` saying "webhook" is provenance.
KEY_COLUMNS = frozenset({
    "fact key", "key", "prop", "prop name", "property", "config key",
    "setting", "subject id",
})

VALUE_COLUMNS = frozenset({
    "value", "values", "secret", "evidence",
    "current value", "default value", "prop value",
})

# Read from the header only: guessing at a value's shape would hit phone numbers and miss spaced cards.
CARD_PHRASES: tuple[tuple[str, ...], ...] = (
    ("debit", "card"),
    ("credit", "card"),
    ("card", "number"),
    ("card", "no"),
    ("card", "num"),
    ("pan",),
    ("account", "number"),
    ("routing", "number"),
    ("bank", "account"),
    ("security", "code"),
    ("card", "pin"),
    ("pin",),
    ("cvv",),
    ("ccv",),
    ("iban",),
    # ("dc", "exp"), never ("exp", "date"): certification expiry columns are not secrets
    ("dc", "exp"),
)

# A government identifier, read from the header's WORDS like the card rule and for the same reason: a rule that…
IDENTIFIER_PHRASES: tuple[tuple[str, ...], ...] = (
    ("ssn",),
    ("social", "security"),
    ("medicaid",),
    ("medicare",),
    ("passport",),
    ("itin",),
    ("alien", "registration"),
    ("government", "id"),
    ("govt", "id"),
    ("national", "id"),
    ("state", "issued", "id"),
    # The Ohio state-issued number a direct support professional is certified under.
    ("dd", "id"),
    ("dodd", "id"),
)

# These name a DOCUMENT, and the books use them both ways: the columns spelled `DL`, `DL / ID`, `Self - DL`…
IDENTIFIER_NUMBERED: tuple[tuple[str, ...], ...] = (
    ("dl",),
    ("driver", "license"), ("drivers", "license"),
    ("driver", "licence"), ("drivers", "licence"),
    ("driving", "license"), ("driving", "licence"),
    ("state", "id"),
    ("id", "card"),
)

NUMBER_WORDS = frozenset({"num", "number", "no", "nbr"})

# A licence NUMBER column keeps, inside its marker, only what the Staff mask shows (StaffProfiles.gs…
LICENCE_PHRASES: tuple[tuple[str, ...], ...] = (
    ("dl",),
    ("driver", "license"), ("drivers", "license"),
    ("driver", "licence"), ("drivers", "licence"),
    ("driving", "license"), ("driving", "licence"),
)
LICENCE_TAIL = " licence:"
US_STATES = frozenset(("AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH "
                       "NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY PR GU VI AS MP").split())
_LICENCE_NA = re.compile(r"n/?a|na|none|not applicable|not required|n-a|no", re.I)
_LICENCE_STATE = re.compile(r"([A-Z]{2})[\s\-:#.]+(.+)")
_LICENCE_WRITTEN = re.compile(re.escape(MARKER_IDENTIFIER) + "(?:" + re.escape(LICENCE_TAIL)
                              + r"(?:none|short|(?:[A-Z]{2} )?[0-9]{4}))?")

# ── WHAT THIS MODULE DELIBERATELY DOES NOT WITHHOLD ───────────────────────── DATE OF BIRTH IS NOT WITHHELD, and…

# ── THE USER HALF OF A CREDENTIAL PAIR ────────────────────────────────────── A password withheld beside a username…
LOGIN_WORDS = frozenset({"username", "login", "logon", "signin"})

# The word alone is not enough, because the commonest columns carrying it are facts ABOUT a sign-in rather than the…
LOGIN_ABOUT = frozenset({
    "count", "at", "last", "time", "times", "date", "attempt", "attempts",
    "failed", "fail", "url", "link", "page", "method", "status", "error",
    "history", "log", "type", "required",
})

# ("user","name") AS TWO WORDS IS NOT HERE.

# ── A BARE EXPIRY BESIDE A CARD ───────────────────────────────────────────── `DC Exp Date` is withheld by its…
EXPIRY_HEAD = frozenset({"expiration", "expires", "expiry", "exp"})
EXPIRY_ONLY = EXPIRY_HEAD | frozenset({"date", "dt", "the"})

# ── A COLUMN WHOSE NAME IS ITSELF A CREDENTIAL ────────────────────────────── A header is a NAME: it is made of…
SECRET_NAME_MIN = 12
SECRET_NAME_SYMBOLS = frozenset("!\"#$%&'*+;<=>?@[\\]^`{|}~")
SECRET_NAME_NEVER = frozenset("/:")

# "key" must never be here: it names the key column of every key/value tab.
HEADER_TOKENS = frozenset({
    "password", "passwd", "pwd", "secret", "token", "salt",
})

# Neither word is trusted alone: "pass" is also a medication pass, "hash" a dedup hash.
HEADER_PHRASES: tuple[tuple[str, ...], ...] = (
    ("pass", "hash"),
    ("api", "key"),
    ("private", "key"),
    ("signing", "key"),
)

# Normalised headers that carry one of those words and are not credentials.
HEADER_KEPT = frozenset({
    "token managed",
    # the relay's session door matches this column IN SQL; a marker breaks every vouch silently
    "token hash",
    # these name a secret, they do not hold one
    "secret ref", "requires secret ref", "secret tab", "secret key name",
})

# The camelCase split makes "TalentBotSecret" three words.
_CAMEL = re.compile(r"(?<=[a-z0-9])(?=[A-Z])")
_RUN = re.compile(r"[A-Za-z]+|[0-9]+")


def words_of(name: Any) -> tuple[str, ...]:
    """Lower-case words with digits dropped, so GROQ_KEY1 reads like GROQ_KEY."""
    text = _CAMEL.sub(" ", str(name or "")).replace("#", " num ")
    return tuple(w.lower() for w in _RUN.findall(text) if not w.isdigit())


def _has_run(words: tuple[str, ...], phrase: tuple[str, ...]) -> bool:
    n = len(phrase)
    return any(words[i:i + n] == phrase for i in range(len(words) - n + 1))


def is_card_column(name: Any) -> bool:
    words = words_of(name)
    return any(_has_run(words, phrase) for phrase in CARD_PHRASES)


def is_identifier_column(name: Any) -> bool:
    """A column holding a government identifier, judged by its header alone."""
    words = words_of(name)
    if not words:
        return False
    if any(_has_run(words, phrase) for phrase in IDENTIFIER_PHRASES):
        return True
    if not set(words) & NUMBER_WORDS:
        return False
    return any(_has_run(words, phrase) for phrase in IDENTIFIER_NUMBERED)


def is_licence_column(name: Any) -> bool:
    """A driver's licence NUMBER column and nothing else: a header that also names another identifier stays whole."""
    words = words_of(name)
    if not set(words) & NUMBER_WORDS or not any(_has_run(words, p) for p in LICENCE_PHRASES):
        return False
    if any(_has_run(words, p) for p in IDENTIFIER_PHRASES):
        return False
    return not any(_has_run(words, p) for p in IDENTIFIER_NUMBERED if p not in LICENCE_PHRASES)


def licence_kept(value: Any) -> str:
    """What spLicenceMask_ takes from the cell alone: "none", "short", or the cell's own state and the last four digits."""
    raw = str(value if value is not None else "").strip().upper()
    if not raw or _LICENCE_NA.fullmatch(raw):
        return "none"
    st, num = "", raw
    tok = _LICENCE_STATE.fullmatch(raw)
    if tok and tok.group(1) in US_STATES and re.search(r"[A-Z]", tok.group(2)) and re.search(r"[0-9]", tok.group(2)):
        st, num = tok.group(1), tok.group(2)
    digits = re.sub(r"[^0-9]", "", num)
    if len(digits) < 6:
        return "short"
    return (st + " " if st else "") + digits[-4:]


def licence_marker(value: Any) -> str:
    return MARKER_IDENTIFIER + LICENCE_TAIL + licence_kept(value)


def is_marker_value(value: Any) -> bool:
    """A cell this rule wrote: a marker alone, or a marker followed by what it keeps."""
    text = str(value).strip() if isinstance(value, str) else ""
    return any(text == m or text.startswith(m + " ") for m in MARKERS)


def is_login_column(name: Any) -> bool:
    """The name someone signs in with — the half of the pair the password rule left."""
    words = set(words_of(name))
    return bool(words & LOGIN_WORDS) and not (words & LOGIN_ABOUT)


def is_bare_expiry_column(name: Any) -> bool:
    """A header naming an expiry and nothing else; only a row says whose."""
    words = set(words_of(name))
    return bool(words & EXPIRY_HEAD) and not (words - EXPIRY_ONLY)


def is_secret_name(name: Any) -> bool:
    """The header is not a name at all — it is a credential standing in the header row."""
    text = str(name or "").strip()
    if len(text) < SECRET_NAME_MIN:
        return False
    if any(c.isspace() or c in SECRET_NAME_NEVER for c in text):
        return False
    if not (any(c.islower() for c in text) and any(c.isupper() for c in text)
            and any(c.isdigit() for c in text)):
        return False
    return any(c in SECRET_NAME_SYMBOLS for c in text)


def _normal(name: Any) -> str:
    return " ".join(words_of(name))


def is_secret_column(name: Any) -> bool:
    words = words_of(name)
    if not words or _normal(name) in HEADER_KEPT:
        return False
    if set(words) & HEADER_TOKENS:
        return True
    return any(_has_run(words, phrase) for phrase in HEADER_PHRASES)


def is_secret_key(value: Any) -> bool:
    text = str(value or "").strip()
    if not text:
        return False
    if text.upper() in NAMED_PROPS:
        return True
    return bool(set(words_of(text)) & KEY_TOKENS)


def _key_and_value_columns(columns: Iterable[Any]) -> tuple[list[Any], list[Any]]:
    keys, values = [], []
    for column in columns:
        normal = _normal(column)
        if normal in KEY_COLUMNS:
            keys.append(column)
        elif normal in VALUE_COLUMNS:
            values.append(column)
    return keys, values


def is_marker_name(name: Any) -> bool:
    """A column ALREADY renamed by a pass of this rule."""
    text = str(name or "").strip()
    return any(text == m or text.startswith(m + " ") for m in MARKERS)


def withheld_columns(row: dict) -> tuple[Any, ...]:
    """Columns of one row that must not be copied; a marked column is named again so copies count alike."""
    if not isinstance(row, dict):
        return ()
    out = [c for c in row
           if not is_marker_name(c)
           and (is_card_column(c) or is_secret_column(c) or is_identifier_column(c)
                or is_login_column(c))]
    out.extend(c for c in row if is_private_column(c) and c not in out)
    if any(is_card_column(c) for c in row):
        out.extend(c for c in row if is_bare_expiry_column(c) and c not in out)
    keys, values = _key_and_value_columns(row)
    if keys and values and any(is_secret_key(row.get(k)) for k in keys):
        out.extend(c for c in values if c not in out)
    return tuple(c for c in out if not is_kept_here(c))


def secret_named_columns(row: dict) -> tuple[Any, ...]:
    """Columns whose NAME is the credential; the name goes, and the cells under it with it."""
    if not isinstance(row, dict):
        return ()
    return tuple(c for c in row if is_secret_name(c))


def is_private_column(name: Any) -> bool:
    return _normal(name) in PRIVATE_COLUMNS


def marker_for(column: Any, row: dict | None = None) -> str:
    if is_private_column(column):
        return MARKER_PRIVATE
    if is_card_column(column):
        return MARKER_CARD
    if is_identifier_column(column):
        return MARKER_IDENTIFIER
    if row is not None and is_bare_expiry_column(column) \
            and any(is_card_column(c) for c in row):
        return MARKER_CARD
    return MARKER_SECRET


def _is_empty(cell: Any) -> bool:
    return cell is None or (isinstance(cell, str) and not cell.strip())


def _secret_name_key(taken: set, seen: int) -> str:
    """The marker the credential header becomes; numbered only if a row holds two."""
    key = MARKER_SECRET if seen == 1 else f"{MARKER_SECRET} {seen}"
    while key in taken:
        seen += 1
        key = f"{MARKER_SECRET} {seen}"
    return key


def redact_row(row: dict) -> tuple[dict, int]:
    """→ (row, cells withheld); an empty cell stays empty so no marker reveals who has a card."""
    columns = withheld_columns(row)
    names = secret_named_columns(row)
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
            out[_secret_name_key(set(out) | (set(row) - named), seen)] = MARKER_SECRET
            withheld += 1
        elif column in marked and not _is_empty(value):
            marker = marker_for(column, row)
            kind = kept_fact_kind(column)
            if kind:
                # a cell already withheld (a copy's own row) is never read again as a figure
                marker = value if is_marker_value(value) else kept_marker(marker, kind, value)
            elif marker == MARKER_IDENTIFIER and is_licence_column(column):
                # a cell already withheld is never read again as a licence
                marker = value if _LICENCE_WRITTEN.fullmatch(str(value)) else licence_marker(value)
            out[column] = marker
            withheld += 1
        else:
            out[column] = value
    return (out, withheld) if withheld else (row, 0)


def redacts(text: str) -> bool:
    """Whether source text is a working copy of this rule; the needles are built so this function never matches itself."""
    mark = "[withheld: {}]"
    needed = (mark.format("secret"), mark.format("card"), mark.format("identifier"),
              "def redact_row",
              "def is_card_column", "def is_secret_key", "def is_secret_column",
              "def is_identifier_column", "def is_login_column",
              "def is_secret_name", "def is_bare_expiry_column",
              "def secret_named_columns", "def is_marker_name",
              "CARD_PHRASES", "KEY_TOKENS", "HEADER_TOKENS", "HEADER_PHRASES",
              "IDENTIFIER_PHRASES", "IDENTIFIER_NUMBERED",
              "LOGIN_WORDS", "LOGIN_ABOUT", "EXPIRY_HEAD",
              "SECRET_NAME_SYMBOLS")
    return all(piece in text for piece in needed)
