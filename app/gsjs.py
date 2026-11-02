"""What Apps Script's own JavaScript does to a value, in Python: String(), trim, Date.parse, localeCompare, Math.round."""
from __future__ import annotations

import math
import os
import re
import unicodedata
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

try:
    from zoneinfo import ZoneInfo
    NY = ZoneInfo("America/New_York")
except Exception:  # noqa: BLE001 - a host without tzdata keeps the summer offset
    ZoneInfo = None  # type: ignore[assignment,misc]
    NY = timezone(timedelta(hours=-4))

# server/hotline_desk.py TRANSCRIPTS and _DECLARED_ZONES: the New Transcripts book shows its Date cells on this clock
HOTLINE_TRANSCRIPTS_SHEET_ID = (os.getenv("HUB_HOTLINE_TRANSCRIPTS_SHEET_ID")
                                or "1nkYZ24EtG4woyIShMKouj1kWdQD2IGpjUkWEamZHMno")
HOTLINE_TRANSCRIPTS_ZONE = "America/Sao_Paulo"
DECLARED_ZONES = {HOTLINE_TRANSCRIPTS_SHEET_ID: HOTLINE_TRANSCRIPTS_ZONE}
# the props that open that same book (Hotline.gs, Comms.gs)
ZONE_PROPS = {"HOTLINE_TRANSCRIPTS_ID": HOTLINE_TRANSCRIPTS_ZONE, "QUO_SYNC_SHEET_ID": HOTLINE_TRANSCRIPTS_ZONE}

_WS = re.compile(r"[\s﻿]+")
_TRIM = " \t\n\r\x0b\x0c\xa0﻿                　"


class SheetDate:
    """A Date cell: the instant Apps Script's getValues() hands back."""
    __slots__ = ("at",)

    def __init__(self, at: datetime) -> None:
        self.at = at.astimezone(timezone.utc)

    def __eq__(self, other: object) -> bool:
        return isinstance(other, SheetDate) and other.at == self.at

    def __hash__(self) -> int:
        return hash(self.at)

    def __repr__(self) -> str:
        return f"SheetDate({iso(self.at)})"


def iso(at: datetime) -> str:
    """Date.prototype.toISOString()."""
    at = at.astimezone(timezone.utc)
    return (f"{at.year:04d}-{at.month:02d}-{at.day:02d}T{at.hour:02d}:{at.minute:02d}:{at.second:02d}."
            f"{at.microsecond // 1000:03d}Z")


def trim(s: str) -> str:
    return s.strip(_TRIM)


def num_str(n: float | int) -> str:
    """String(number) for the finite numbers a cell holds."""
    if isinstance(n, bool):
        return "true" if n else "false"
    if isinstance(n, int):
        return str(n)
    if math.isnan(n):
        return "NaN"
    if math.isinf(n):
        return "Infinity" if n > 0 else "-Infinity"
    if n == int(n) and abs(n) < 1e21:
        return str(int(n))
    text = repr(n)
    if "e" in text:
        mant, exp = text.split("e")
        e = int(exp)
        return f"{mant}e{'+' if e > 0 else '-'}{abs(e)}"
    return text


def js_str(v: Any) -> str:
    """String(v); null and undefined are the caller's to fold."""
    if v is None:
        return "null"
    if isinstance(v, SheetDate):
        local = v.at.astimezone(NY)
        summer = bool(local.dst())
        return local.strftime("%a %b %d %Y %H:%M:%S GMT%z") + (" (Eastern Daylight Time)" if summer
                                                               else " (Eastern Standard Time)")
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return num_str(v)
    if isinstance(v, (dict, list)):
        return "[object Object]" if isinstance(v, dict) else ",".join(js_str(x) if x is not None else "" for x in v)
    return str(v)


def or_blank(v: Any) -> str:
    """String(v == null ? '' : v)."""
    return "" if v is None else js_str(v)


def falsy(v: Any) -> bool:
    """JavaScript's falsy values among what a cell or a payload holds."""
    if v is None or v is False:
        return True
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return v == 0 or (isinstance(v, float) and math.isnan(v))
    return v == ""


def or_text(v: Any) -> str:
    """String(v || '')."""
    return "" if falsy(v) else js_str(v)


def name_key(v: Any) -> str:
    """clientNameKey_: letters and digits only, lower case."""
    return re.sub(r"[^a-z0-9]+", "", or_text(v).lower())


def text(v: Any, max_len: int = 0) -> str:
    """locationsText_: whitespace runs as one space, trimmed, cut to max."""
    s = trim(_WS.sub(" ", or_blank(v)))
    return s[:max_len] if max_len else s


def cell(v: Any) -> str:
    """locationsCell_: a Date as ISO text, anything else as trimmed text."""
    if isinstance(v, SheetDate):
        return iso(v.at)
    return trim(or_blank(v))


def str_(v: Any) -> str:
    """str_ (Talent.gs): '' for null, ISO for a Date, trimmed text otherwise."""
    if v is None:
        return ""
    if isinstance(v, SheetDate):
        return iso(v.at)
    return trim(js_str(v))


def js_round(x: float) -> float:
    """Math.round: halves go up."""
    return float(math.floor(x + 0.5))


_ISO_FULL = re.compile(r"^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}:?\d{2})?)?$")
_US = re.compile(r"^(\d{1,2})/(\d{1,2})/(\d{2,4})(?:,?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?)?$")


def date_parse(s: Any) -> float | None:
    """Date.parse for the shapes a cell's text takes; milliseconds, or None for NaN."""
    raw = trim(or_blank(s))
    if not raw:
        return None
    m = _ISO_FULL.match(raw)
    try:
        if m:
            y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
            if m.group(4) is None:
                at = datetime(y, mo, d, tzinfo=timezone.utc)
            else:
                frac = (m.group(7) or "0")[:6].ljust(6, "0")
                hh, mi, ss = int(m.group(4)), int(m.group(5)), int(m.group(6) or 0)
                zone = m.group(8)
                if zone is None:
                    at = datetime(y, mo, d, hh, mi, ss, int(frac), tzinfo=NY)
                elif zone == "Z":
                    at = datetime(y, mo, d, hh, mi, ss, int(frac), tzinfo=timezone.utc)
                else:
                    z = zone.replace(":", "")
                    off = timedelta(hours=int(z[1:3]), minutes=int(z[3:5]))
                    at = datetime(y, mo, d, hh, mi, ss, int(frac), tzinfo=timezone(off if z[0] == "+" else -off))
            return at.timestamp() * 1000.0
        m = _US.match(raw)
        if m:
            mo, d, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
            if y < 100:
                y += 2000 if y < 50 else 1900
            hh, mi, ss = int(m.group(4) or 0), int(m.group(5) or 0), int(m.group(6) or 0)
            half = (m.group(7) or "").upper()
            if half:
                hh = hh % 12 + (12 if half == "PM" else 0)
            return datetime(y, mo, d, hh, mi, ss, tzinfo=NY).timestamp() * 1000.0
    except ValueError:
        return None
    return None


def when(v: Any) -> float:
    """locationsWhen_: Date.parse, NaN as 0."""
    t = date_parse(v)
    return 0.0 if t is None else t


def day_shift(iso_day: str, days: int) -> str:
    """locationsDayShift_: noon UTC moved by whole days; '' for an unreadable day."""
    t = date_parse(f"{iso_day}T12:00:00Z") if re.match(r"^\d{4}-\d{2}-\d{2}$", str(iso_day or "")) else None
    if t is None:
        return ""
    return (datetime.fromtimestamp(t / 1000.0, timezone.utc) + timedelta(days=days)).strftime("%Y-%m-%d")


def today_ny(now: datetime | None = None) -> str:
    return (now or datetime.now(timezone.utc)).astimezone(NY).strftime("%Y-%m-%d")


def book_zone(sheet_id: Any, prop: Callable[[str], Any]) -> str:
    """The zone a book's Date cells are shown on: declared by its id or by the prop that opens it; '' otherwise."""
    sid = trim(or_blank(sheet_id))
    if not sid:
        return ""
    if sid in DECLARED_ZONES:
        return DECLARED_ZONES[sid]
    return next((z for key, z in ZONE_PROPS.items() if sid == trim(or_blank(prop(key)))), "")


# ---- server/hotline_desk.py's times, ported -------------------------------------------------------------------------

_SHEETS_EPOCH = datetime(1899, 12, 30)
_MONTH_NO = {m: i + 1 for i, m in enumerate(
    ("jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"))}
_MDY = re.compile(r"^\s*(\d{1,2})/(\d{1,2})/(\d{4})"
                  r"(?:[ T,]+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?\s*([AaPp][Mm])?)?\s*$")
_JS_DATE_TEXT = re.compile(r"^\s*(?:[A-Za-z]{3},?\s+)?([A-Za-z]{3})\s+(\d{1,2})\s+(\d{4})\s+"
                           r"(\d{1,2}):(\d{2}):(\d{2})\s+GMT([+-])(\d{2}):?(\d{2})")
_ISO_HEAD = re.compile(r"^\d{4}-\d{2}-\d{2}")


def zone(name: str | None) -> Any:
    """hotline_desk._zone: an unknown name reads as UTC."""
    if ZoneInfo is not None and name:
        try:
            return ZoneInfo(name)
        except Exception:  # noqa: BLE001
            pass
    return timezone.utc


def serial_to_utc(value: Any, tz_name: str | None) -> datetime | None:
    """hotline_desk.serial_to_utc: a Sheets serial (days since 1899-12-30 on the book's clock), half a second up."""
    try:
        days = float(value)
    except (TypeError, ValueError):
        return None
    if not 1.0 < days < 2958465.0:
        return None
    naive = _SHEETS_EPOCH + timedelta(seconds=math.floor(days * 86400.0 + 0.5))
    return naive.replace(tzinfo=zone(tz_name)).astimezone(timezone.utc)


def parse_when(value: Any, tz_name: str | None) -> datetime | None:
    """hotline_desk.parse_when: any date shape the estate writes, a wall clock on `tz_name`, as UTC; None otherwise."""
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return serial_to_utc(value, tz_name)
    s = str(value).strip()
    if not s:
        return None
    m = _JS_DATE_TEXT.match(s)
    if m:
        mon = _MONTH_NO.get(m.group(1).lower())
        if not mon:
            return None
        off = timedelta(hours=int(m.group(8)), minutes=int(m.group(9))) * (1 if m.group(7) == "+" else -1)
        try:
            local = datetime(int(m.group(3)), mon, int(m.group(2)), int(m.group(4)), int(m.group(5)),
                             int(m.group(6)), tzinfo=timezone(off))
        except ValueError:
            return None
        return local.astimezone(timezone.utc)
    if _ISO_HEAD.match(s):
        try:
            dt = datetime.fromisoformat(s.replace("Z", "+00:00").replace(" ", "T", 1))
        except ValueError:
            return None
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=zone(tz_name))
        return dt.astimezone(timezone.utc)
    m = _MDY.match(s)
    if m:
        hour = int(m.group(4) or 0)
        half = (m.group(7) or "").lower()
        if half == "pm" and hour < 12:
            hour += 12
        elif half == "am" and hour == 12:
            hour = 0
        try:
            naive = datetime(int(m.group(3)), int(m.group(1)), int(m.group(2)), hour, int(m.group(5) or 0),
                             int(m.group(6) or 0))
        except ValueError:
            return None
        return naive.replace(tzinfo=zone(tz_name)).astimezone(timezone.utc)
    if re.fullmatch(r"\d{5}(?:\.\d+)?", s):
        return serial_to_utc(float(s), tz_name)
    return None


def _char_class(ch: str) -> int:
    cat = unicodedata.category(ch)
    if ch.isspace() or cat.startswith("Z") or cat == "Cc":
        return 1
    if cat.startswith("P"):
        return 2
    if cat.startswith("S"):
        return 3
    if cat == "Nd" or ch.isdigit():
        return 4
    if cat.startswith("L"):
        return 5
    return 6


def collate_key(s: Any) -> tuple:
    """localeCompare's order (ICU, three levels): base letters, then accents, then lower case before upper."""
    primary, secondary, tertiary = [], [], []
    for ch in str(s):
        decomposed = unicodedata.normalize("NFD", ch)
        base = "".join(c for c in decomposed if not unicodedata.combining(c)) or ch
        marks = "".join(c for c in decomposed if unicodedata.combining(c))
        for b in base:
            primary.append((_char_class(b), b.casefold()))
            secondary.append(marks)
            tertiary.append(0 if not b.isupper() else 1)
    return (primary, secondary, tertiary)


def locale_cmp(a: Any, b: Any) -> int:
    ka, kb = collate_key(a), collate_key(b)
    return -1 if ka < kb else (1 if ka > kb else 0)
