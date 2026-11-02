"""The recruiters' book: master JSON into our copy (JSON first), then our houses, then three texts."""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import tempfile
import threading
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

OHIO = ZoneInfo("America/New_York")
UTC = timezone.utc
FORMAT = "hub-recruit-book/1"

# also declared in the depot (switchboard:props.RECRUIT_BOOK_ID)
SOURCE_BOOK_ID = os.getenv("HUB_RECRUIT_BOOK_ID", "1zUuZP2IBAO0YbPrJzlkuHi7-pR97tL_gQMJ1A7Fg8l8")

TABS: dict[str, dict[str, str]] = {
    "recruit_pipeline": {"source_tab": "Talent Pipeline", "prefix": "TP",
                         "prop": "HUB_HOUSE_RECRUIT_PIPELINE_ID",
                         "title": "ASA Data — RecruitPipeline"},
    "recruit_onboarding": {"source_tab": "Onboarding Checklist", "prefix": "OC",
                           "prop": "HUB_HOUSE_RECRUIT_ONBOARDING_ID",
                           "title": "ASA Data — RecruitOnboarding"},
}

# the book's own column order (the mirror's is not); unlisted columns follow, never dropped
SHEET_ORDER: dict[str, list[str]] = {
    "recruit_pipeline": [
        "Hire ?", "Score", "Status", "Candidate Name", "First Name", "Phone", "Location",
        "Gender", "1st Contact", "Screener", "Screen Date", "Screen Time", "Screen Location",
        "Best In-Person Day/Time", "PS Notes", "Additional / Unusual Notes",
        "Earliest \nStart Date", "Shifts", "PT/FT", "DODD", "CPR/1st Aid", "Med Del", "DL",
        "Vehicle", "Behaviors", "Male", "CJIS Findings", "Sent to Onboarding", "Hire?",
        "Earliest Start Date", "Screen Reminder Night Sent", "Screen Reminder Morning Sent",
        "Notes",
    ],
    "recruit_onboarding": [
        "Status", "Candidate Name", "First Name", "Phone", "Email", "Score",
        "Earliest Start Date", "PT/FT", "M/F", "Shifts", "Background Check", "Dropbox",
        "8 Hr Train", "CPR/1st Aid", "Med Del", "DL / ID", "HS Diploma", "SS / Birth Cert",
        "Notes", "Self - DODD", "Self - CPR/1st Aid", "Self - Med Del", "Self - DL",
        "Self - Vehicle", "Self - Behaviors", "Self - Male", "Messages Sent", "Docusign Sent",
        "Date Moved to Onboarding",
    ],
}

# columns the rules read; a missing one holds the rule
PIPE_COLS = {"hire": "Hire ?", "status": "Status", "name": "Candidate Name",
             "first": "First Name", "phone": "Phone", "screener": "Screener",
             "date": "Screen Date", "time": "Screen Time", "location": "Screen Location"}
ONB_COLS = {"status": "Status", "name": "Candidate Name", "first": "First Name",
            "phone": "Phone", "bci": "Background Check"}

SCREEN = "hiring_screen_day_reminder"
ONBOARD = "hiring_onboarding_start"
BCI = "hiring_bci_howto"
SITUATIONS = (SCREEN, ONBOARD, BCI)
DOOR_HOUSE = "recruitBookIngest"
DOOR_TELL = "recruitTell"
RESOURCES = ("recruitBook",)

ROOT = Path(os.getenv("HUB_SNAPSHOT_OUT", "/srv/snapshot"))
DIR = Path(os.getenv("HUB_RECRUIT_DIR", str(ROOT / "recruit")))
MASTER_ROOT = Path(os.getenv("HUB_MASTER_JSON_DIR", str(ROOT / "master")))
CARDS_FILE = Path(os.getenv("HUB_RECRUIT_CARDS", str(ROOT / "candidates.json")))
COPY_FILE = "book.json"
STATE_FILE = "state.json"

PASS_EVERY_S = float(os.getenv("HUB_RECRUIT_PASS_EVERY_S", "300"))
HOUSE_EVERY_S = float(os.getenv("HUB_RECRUIT_HOUSE_EVERY_S", "1800"))
MASTER_MAX_AGE_S = float(os.getenv("HUB_RECRUIT_MASTER_MAX_AGE_S", "7200"))
HUB_CARDS_MAX_AGE_S = float(os.getenv("HUB_RECRUIT_CARDS_MAX_AGE_S", "21600"))
ONBOARD_FRESH_S = float(os.getenv("HUB_RECRUIT_ONBOARD_FRESH_S", str(72 * 3600)))
RETRY_S = float(os.getenv("HUB_RECRUIT_RETRY_S", "600"))
DIAL_RETRY_S = float(os.getenv("HUB_RECRUIT_DIAL_RETRY_S", "120"))
HELD_RETRY_S = float(os.getenv("HUB_RECRUIT_HELD_RETRY_S", str(6 * 3600)))
FAILED_OFFERS = int(os.getenv("HUB_RECRUIT_FAILED_OFFERS", "3"))
MAX_PER_POST = int(os.getenv("HUB_RECRUIT_MAX_PER_POST", "20"))
QUIET_FROM = os.getenv("HUB_QUIET_FROM", "21:31")
QUIET_TO = os.getenv("HUB_QUIET_TO", "08:00")
BCI_DAYS = (0, 1, 2, 3, 4)
BCI_FROM = os.getenv("HUB_RECRUIT_BCI_FROM", "08:00")
BCI_TO = os.getenv("HUB_RECRUIT_BCI_TO", "17:00")
BCI_AFTER_DAYS = int(os.getenv("HUB_RECRUIT_BCI_AFTER_DAYS", "2"))
VIEW_MESSAGES = 150

FINAL = frozenset({"told", "redirected", "recorded", "rehearsed", "duplicate", "opted_out",
                   "no_number", "shared_line", "our_line", "stale", "dial_off", "refused",
                   "hub_card", "baseline", "gave_up"})
NOT_NOW = frozenset({"refused_quiet", "dial_unknown", "held", "failed", "offered", "owed"})
# said to a person, the testers or the mock: each counts toward a repeat
SAID = frozenset({"told", "redirected", "recorded", "rehearsed"})

# the page's allow-list; refused names are asserted at import
STATUS_FIELDS = ("row_kind", "id", "source_state", "source_why", "source_at", "source_modified_at",
                 "keeper_at", "copy_at", "copy_counts", "houses", "birth_at", "baseline",
                 "cards_state", "cards_why", "cards_at", "last_pass_at", "last_post_at",
                 "last_post_why", "counts", "planned_at", "held_why")
SCREEN_FIELDS = ("row_kind", "id", "day", "first_name", "name", "last4", "screener", "time",
                 "location", "status", "verdict", "why", "state", "source")
MESSAGE_FIELDS = ("row_kind", "id", "situation", "first_name", "name", "last4", "state", "why",
                  "first_seen", "said_at", "count", "detail", "source",
                  "words", "words_chars", "to_masked", "line", "channel")
# What the door answers back about the copy it wrote, and how far each is kept; the words are cut where the mock…
COPY_FIELDS = (("words", 4000), ("to_masked", 40), ("line", 80), ("channel", 20))
REFUSED = ("CJIS Findings", "PS Notes", "Notes", "Email", "Phone", "phone", "email", "notes",
           "cjis", "Additional / Unusual Notes")
_HOLDS = sorted((set(STATUS_FIELDS) | set(SCREEN_FIELDS) | set(MESSAGE_FIELDS)) & set(REFUSED))
if _HOLDS:
    raise RuntimeError("recruit_book: the page may never carry a note, a finding or a number — "
                       + ", ".join(_HOLDS))

_LOCK = threading.Lock()
_LAST_PASS = {"at": 0.0}


def _iso(t: float | datetime | None) -> str:
    if t is None or t == "":
        return ""
    if isinstance(t, datetime):
        return t.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
    return datetime.fromtimestamp(float(t), UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def _epoch(v: Any) -> float:
    if not v:
        return 0.0
    if isinstance(v, (int, float)):
        return float(v)
    try:
        got = datetime.fromisoformat(str(v).replace("Z", "+00:00"))
    except ValueError:
        return 0.0
    return (got if got.tzinfo else got.replace(tzinfo=UTC)).timestamp()


def _hm(raw: str) -> tuple[int, int]:
    h, _, m = str(raw).partition(":")
    return int(h or 0), int(m or 0)


def _collapse(name: Any) -> str:
    """Newlines are kept: two columns differ only by one."""
    return re.sub(r"[ \t]+", " ", str(name or "")).strip()


def phone10(raw: Any) -> str:
    d = re.sub(r"\D", "", str(raw or ""))
    if len(d) == 11 and d.startswith("1"):
        d = d[1:]
    return d if len(d) == 10 else ""


_MONTHS = {m: i for i, m in enumerate(
    ["january", "february", "march", "april", "may", "june", "july", "august", "september",
     "october", "november", "december"], start=1)}


def parse_day(raw: Any) -> date | None:
    s = str(raw or "").strip()
    if not s:
        return None
    m = re.match(r"^(?:[A-Za-z]+,\s*)?([A-Za-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})$", s)
    if m:
        mon = _MONTHS.get(m.group(1).lower()) or next(
            (v for k, v in _MONTHS.items() if len(m.group(1)) >= 3 and k.startswith(m.group(1).lower())), 0)
        try:
            return date(int(m.group(3)), mon, int(m.group(2))) if mon else None
        except ValueError:
            return None
    m = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{2}|\d{4})$", s)
    if m:
        y = int(m.group(3))
        y = y + 2000 if y < 100 else y
        try:
            return date(y, int(m.group(1)), int(m.group(2)))
        except ValueError:
            return None
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})", s)
    if m:
        try:
            return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        except ValueError:
            return None
    return None


def parse_time(raw: Any) -> tuple[int, int] | None:
    s = str(raw or "").strip().lower().replace(".", "")
    s = re.sub(r"^[\s'\"`]+|[\s'\"`,;:!?]+$", "", s)
    if not s:
        return None
    m = (re.match(r"^(\d{1,2})(?::(\d{2}))?(?::(\d{2}))?\s*([ap])m?$", s)
         or re.match(r"^(\d{1,2})(\d{2})()\s*([ap])m?$", s))
    if m:
        h, mi, sec = int(m.group(1)), int(m.group(2) or 0), int(m.group(3) or 0)
        if not 1 <= h <= 12 or mi > 59 or sec > 59:
            return None
        if m.group(4) == "p" and h < 12:
            h += 12
        if m.group(4) == "a" and h == 12:
            h = 0
        return h, mi
    m = re.match(r"^(\d{1,2}):(\d{2})(?::(\d{2}))?$", s)
    if m:
        h, mi, sec = int(m.group(1)), int(m.group(2)), int(m.group(3) or 0)
        return (h, mi) if h <= 23 and mi <= 59 and sec <= 59 else None
    return None


def time_words(hm: tuple[int, int]) -> str:
    h, mi = hm
    h12 = h % 12 or 12
    return f"{h12}{':%02d' % mi if mi else ''}{'AM' if h < 12 else 'PM'}"


def clean_place(raw: Any) -> str:
    s = re.sub(r"\s+", " ", str(raw or "")).strip()
    s = re.sub(r"[.\s]+$", "", s)
    return "" if s.upper() in ("#N/A", "N/A", "NA", "#REF!", "#VALUE!") else s


def first_name(first: Any, full: Any) -> str:
    f = re.sub(r"\s+", " ", str(first or "")).strip()
    if f:
        return f.split(" ")[0]
    full_s = re.sub(r"\s+", " ", str(full or "")).strip()
    return full_s.split(" ")[0] if full_s else ""


def quiet(at: datetime) -> bool:
    local = at.astimezone(OHIO)
    t = local.hour * 60 + local.minute
    fh, fm = _hm(QUIET_FROM)
    th, tm = _hm(QUIET_TO)
    start, end = fh * 60 + fm, th * 60 + tm
    if start <= end:
        return start <= t < end
    return t >= start or t < end


def bci_hours(at: datetime) -> bool:
    local = at.astimezone(OHIO)
    t = local.hour * 60 + local.minute
    fh, fm = _hm(BCI_FROM)
    th, tm = _hm(BCI_TO)
    return local.weekday() in BCI_DAYS and fh * 60 + fm <= t < th * 60 + tm


def _private_dir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)
    try:
        os.chmod(path, 0o700)
    except OSError:
        pass


def _write(path: Path, doc: Any) -> None:
    _private_dir(path.parent)
    data = json.dumps(doc, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=".recruit-", suffix=".tmp")
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "wb") as fh:
            fd = -1
            fh.write(data)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, path)
    except BaseException:
        if fd >= 0:
            os.close(fd)
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def _read(path: Path) -> Any:
    try:
        return json.loads(path.read_bytes())
    except FileNotFoundError:
        return None


def read_source(root: Path | str | None = None, book_id: str = SOURCE_BOOK_ID,
                now: float | None = None) -> dict[str, Any]:
    root = Path(root) if root is not None else MASTER_ROOT
    now = time.time() if now is None else now
    out: dict[str, Any] = {"ok": False, "why": "", "name": "", "synced_at": "", "modified_time": "",
                           "keeper_at": "", "tabs": {}, "notes": []}
    try:
        manifest = json.loads((root / "manifest.json").read_bytes())
    except FileNotFoundError:
        out["why"] = "the platform's copy of the sheets (the master JSON) is not on this disk yet"
        return out
    except (OSError, ValueError) as exc:
        out["why"] = f"the master JSON's manifest could not be read ({type(exc).__name__})"
        return out
    out["keeper_at"] = str(manifest.get("written_at") or "")
    age = now - _epoch(out["keeper_at"])
    if not out["keeper_at"] or age > MASTER_MAX_AGE_S:
        out["why"] = (f"the sheet keeper has not written a round since {out['keeper_at'] or 'ever'} — "
                      "a copy nobody is refreshing does not speak")
        return out
    entry = next((b for b in (manifest.get("books") or []) if str(b.get("id")) == book_id), None)
    if entry is None:
        out["why"] = ("the recruiters' book is not in the platform's copy of the sheets — the keeper "
                      "cannot see it (not shared with the platform, renamed away, or deleted)")
        return out
    out["name"] = str(entry.get("name") or "")
    out["synced_at"] = str(entry.get("synced_at") or "")
    out["modified_time"] = str(entry.get("modified_time") or "")
    if str(entry.get("status") or "ok") != "ok":
        out["why"] = f"the keeper's last read of the book ended `{entry.get('status')}`"
        return out
    listed = {str(t.get("tab")): t for t in (entry.get("tabs") or [])}
    try:
        index = json.loads((root / str(entry.get("file") or f"books/{book_id}.json")).read_bytes())
    except (OSError, ValueError) as exc:
        out["why"] = f"the book's index in the master JSON could not be read ({type(exc).__name__})"
        return out
    by_name = {str(t.get("tab")): t for t in (index.get("tabs") or [])}
    for house, spec in TABS.items():
        want = spec["source_tab"]
        t = by_name.get(want)
        if t is None:
            out["why"] = f"the book has no tab called \"{want}\" in the platform's copy"
            out["tabs"] = {}
            return out
        if (listed.get(want) or {}).get("stale"):
            out["notes"].append(f"{want}: the keeper kept its last good copy of this tab")
        header: list[str] = []
        rows: list[dict[str, Any]] = []
        try:
            segs = ([json.loads((root / f).read_bytes()) for f in t["parts"]] if "parts" in t else [t])
        except (OSError, ValueError, KeyError) as exc:
            out["why"] = f"a part of \"{want}\" could not be read ({type(exc).__name__})"
            out["tabs"] = {}
            return out
        for seg in segs:
            for h in seg.get("header") or []:
                if h not in header:
                    header.append(h)
            for r in seg.get("rows") or []:
                row = {"_row": int(r[0])}
                row.update({h: c for h, c in zip(seg.get("header") or [], r[1:]) if c is not None})
                rows.append(row)
        if not rows:
            out["why"] = (f"\"{want}\" came back with no rows — a tab somebody cleared or a read that "
                          "went wrong; the copy that stands is kept")
            out["tabs"] = {}
            return out
        out["tabs"][house] = {"header": header, "rows": rows}
    out["ok"] = True
    return out


def house_header(house: str, names: list[str]) -> list[str]:
    order = {_collapse(n): i for i, n in enumerate(SHEET_ORDER.get(house, []))}
    seen: list[str] = []
    for n in names:
        if n in seen or n == "_row" or n == "id":
            continue
        seen.append(n)
    ranked = sorted(enumerate(seen), key=lambda p: (order.get(_collapse(p[1]), len(order) + p[0])))
    return ["id"] + [n for _, n in ranked]


def build_copy(source: dict[str, Any], now: float | None = None) -> dict[str, Any]:
    now = time.time() if now is None else now
    doc: dict[str, Any] = {
        "format": FORMAT,
        "source": {"id": SOURCE_BOOK_ID, "name": source.get("name", ""),
                   "synced_at": source.get("synced_at", ""),
                   "modified_time": source.get("modified_time", ""),
                   "keeper_at": source.get("keeper_at", "")},
        "built_at": _iso(now),
        "tabs": {},
    }
    for house, spec in TABS.items():
        t = (source.get("tabs") or {}).get(house) or {"header": [], "rows": []}
        header = house_header(house, t["header"])
        body = []
        for r in sorted(t["rows"], key=lambda x: int(x.get("_row") or 0)):
            line = [f"{spec['prefix']}-{int(r.get('_row') or 0)}"]
            line += [str(r.get(h, "")) if r.get(h) is not None else "" for h in header[1:]]
            body.append(line)
        fp = hashlib.sha256(json.dumps([header, body], ensure_ascii=False,
                                       separators=(",", ":")).encode("utf-8")).hexdigest()
        doc["tabs"][house] = {"source_tab": spec["source_tab"], "header": header, "rows": body,
                              "count": len(body), "fingerprint": fp}
    return doc


def rows_of(doc: dict[str, Any] | None, house: str) -> list[dict[str, str]]:
    t = ((doc or {}).get("tabs") or {}).get(house) or {}
    header = t.get("header") or []
    out = []
    for line in t.get("rows") or []:
        row: dict[str, str] = {}
        for h, c in zip(header, line):
            row[h] = c
            row.setdefault(_collapse(h), c)
        out.append(row)
    return out


def has_columns(doc: dict[str, Any] | None, house: str, cols: dict[str, str]) -> list[str]:
    t = ((doc or {}).get("tabs") or {}).get(house) or {}
    have = {_collapse(h) for h in (t.get("header") or [])}
    return [c for c in cols.values() if _collapse(c) not in have]


def load_state(path: Path | None = None) -> dict[str, Any]:
    got = _read(path or DIR / STATE_FILE)
    if not isinstance(got, dict):
        got = {}
    got.setdefault("format", FORMAT)
    got.setdefault("ledger", {})
    got.setdefault("houses", {})
    got.setdefault("source", {})
    got.setdefault("cards", {})
    got.setdefault("birth", None)
    return got


def save_state(state: dict[str, Any], path: Path | None = None) -> None:
    _write(path or DIR / STATE_FILE, state)


def occasion_id(key: str) -> str:
    """A plain hash, so never shown on the page."""
    return "RB-" + hashlib.sha256(key.encode("utf-8")).hexdigest()[:16]


KEY_FILE = "slice-key.json"
_KEY_LOCK = threading.Lock()
_SLICE_KEYS: dict[str, bytes] = {}


def _slice_key(out_dir: Path) -> bytes:
    path = out_dir / KEY_FILE
    with _KEY_LOCK:
        got = _SLICE_KEYS.get(str(path))
        if got:
            return got
        try:
            doc = _read(path) or {}
            got = bytes.fromhex(str(doc.get("key") or ""))
        except (OSError, ValueError, AttributeError):
            got = b""
        if len(got) < 32:
            got = os.urandom(32)
            try:
                _write(path, {"format": FORMAT, "key": got.hex()})
            except OSError:
                pass
        _SLICE_KEYS[str(path)] = got
        return got


def view_id(key: str, out_dir: Path | None = None) -> str:
    """Keyed by the relay's secret: a plain hash of the key would reveal the phone."""
    k = _slice_key(out_dir or DIR)
    return "RB-" + hmac.new(k, key.encode("utf-8"), hashlib.sha256).hexdigest()[:16]


def due(entry: dict[str, Any] | None, now: float) -> bool:
    if entry is None:
        return True
    st = str(entry.get("state") or "owed")
    if st in FINAL:
        return False
    said = _epoch(entry.get("said_at"))
    if st in ("owed", "refused_quiet"):
        return True
    if st == "dial_unknown":
        return now >= said + DIAL_RETRY_S
    if st == "held":
        return now >= said + HELD_RETRY_S
    if st == "failed":
        return int(entry.get("failures") or 0) < FAILED_OFFERS and now >= said + RETRY_S
    if st == "offered":
        return now >= _epoch(entry.get("offered_at")) + RETRY_S
    return False


def repeat_due(entry: dict[str, Any] | None, now: float) -> bool:
    if not entry or str(entry.get("state")) not in SAID:
        return False
    count = int(entry.get("count") or 0)
    most = int(entry.get("max") or 1)
    gap = float(entry.get("gap_days") or 0)
    if count >= most or gap <= 0:
        return False
    return now >= _epoch(entry.get("said_at")) + gap * 86400


def hub_cards(path: Path | None = None, now: float | None = None) -> dict[str, Any]:
    now = time.time() if now is None else now
    p = path or CARDS_FILE
    try:
        doc = json.loads(p.read_bytes())
    except FileNotFoundError:
        return {"ok": False, "why": "the hiring board's file (candidates.json) is not on this disk",
                "at": "", "phones": set()}
    except (OSError, ValueError) as exc:
        return {"ok": False, "why": f"the hiring board's file could not be read ({type(exc).__name__})",
                "at": "", "phones": set()}
    at = str(doc.get("built_at") or doc.get("source_at") or "")
    if not at or now - _epoch(at) > HUB_CARDS_MAX_AGE_S:
        return {"ok": False, "at": at, "phones": set(),
                "why": f"the hiring board's file is from {at or 'an unknown time'} — too old to say who "
                       "is on the board"}
    phones = set()
    for r in doc.get("rows") or []:
        k = phone10((r or {}).get("phone"))
        if k:
            phones.add(k)
    return {"ok": True, "why": "", "at": at, "phones": phones}


def _view(row: dict[str, str], cols: dict[str, str], extra: dict[str, Any] | None = None) -> dict[str, Any]:
    p = phone10(row.get(cols["phone"]) or row.get(_collapse(cols["phone"])))
    v = {"first_name": first_name(row.get(cols["first"]), row.get(cols["name"])),
         "name": re.sub(r"\s+", " ", str(row.get(cols["name"]) or "")).strip(),
         "last4": p[-4:] if p else "", "source": str(row.get("id") or "")}
    v.update(extra or {})
    return v


def _cell(row: dict[str, str], name: str) -> str:
    v = row.get(name)
    if v is None:
        v = row.get(_collapse(name), "")
    return str(v or "")


def screens(doc: dict[str, Any] | None, cards: dict[str, Any], now: float,
            days: int = 2) -> list[dict[str, Any]]:
    at = datetime.fromtimestamp(now, UTC)
    today = at.astimezone(OHIO).date()
    horizon = {today + timedelta(days=i): ("today" if i == 0 else "tomorrow" if i == 1 else f"+{i}")
               for i in range(days)}
    out = []
    missing = has_columns(doc, "recruit_pipeline", PIPE_COLS)
    if missing:
        return out
    seen: set[str] = set()
    for row in rows_of(doc, "recruit_pipeline"):
        d = parse_day(_cell(row, PIPE_COLS["date"]))
        if d not in horizon:
            continue
        p = phone10(_cell(row, PIPE_COLS["phone"]))
        hm = parse_time(_cell(row, PIPE_COLS["time"]))
        place = clean_place(_cell(row, PIPE_COLS["location"]))
        screener = re.sub(r"\s+", " ", _cell(row, PIPE_COLS["screener"])).strip()
        status = _cell(row, PIPE_COLS["status"]).strip()
        hire = _cell(row, PIPE_COLS["hire"]).strip().lower()
        v = _view(row, PIPE_COLS, {"day": horizon[d], "date": d.isoformat(), "screener": screener,
                                   "time": time_words(hm) if hm else _cell(row, PIPE_COLS["time"]).strip(),
                                   "location": place, "status": status})
        key = f"{SCREEN}|{p}|{d.isoformat()}|{'%02d:%02d' % hm if hm else ''}" if p else ""
        v["key"] = key
        v["phone"] = p
        start = (datetime(d.year, d.month, d.day, hm[0], hm[1], tzinfo=OHIO) if hm else None)
        v["deadline"] = _iso(start) if start else ""
        why = ""
        if not status.startswith("3"):
            why = f"the book says \"{status or 'no status'}\" — only a screen still at 3 - In Person is reminded"
        elif hire in ("yes", "no"):
            why = f"the book already decided (Hire ? = {hire.capitalize()})"
        elif not p:
            why = "no phone we can text on the row"
        elif not hm:
            why = "no screen time the reminder can say"
        elif not place:
            why = "no screen location the reminder can say"
        elif not screener:
            why = "no screener named on the row"
        elif key in seen:
            why = "the same screen is on another row — reminded once"
        if why:
            v["verdict"], v["why"] = "skipped", why
        elif horizon[d] != "today":
            v["verdict"], v["why"] = "waiting", f"reminded on the day, from {QUIET_TO}"
        elif start and at >= start:
            v["verdict"], v["why"] = "passed", "the screen has started — no reminder after it"
        elif not cards.get("ok"):
            v["verdict"], v["why"] = "held", cards.get("why") or "the hiring board could not be read"
        elif p in cards.get("phones", set()):
            v["verdict"], v["why"] = "hub_card", "this person is on the hiring board — the Hub's lanes text them"
        elif quiet(at):
            v["verdict"], v["why"] = "waiting", f"inside the quiet window — reminded from {QUIET_TO}"
        else:
            v["verdict"], v["why"] = "owed", ""
        if key and not why:
            seen.add(key)
        out.append(v)
    out.sort(key=lambda s: (s["date"], s.get("deadline") or "9", s["name"]))
    return out


def business_days_since(first: Any, now: float) -> int:
    t = _epoch(first)
    if not t:
        return 0
    day = datetime.fromtimestamp(t, UTC).astimezone(OHIO).date()
    today = datetime.fromtimestamp(now, UTC).astimezone(OHIO).date()
    n = 0
    for _ in range(400):
        if day >= today:
            break
        day += timedelta(days=1)
        if day.weekday() < 5:
            n += 1
    return n


def houses_hold(doc: dict[str, Any] | None, state: dict[str, Any]) -> str:
    """Nothing is said before both houses are proved to hold this copy."""
    for house, spec in TABS.items():
        fp = str((((doc or {}).get("tabs") or {}).get(house) or {}).get("fingerprint") or "")
        h = (state.get("houses") or {}).get(house) or {}
        if not h.get("proved"):
            said = str(h.get("why") or "")
            return (f"{spec['title']} has never been written — nothing is texted from their book until a house "
                    "of ours holds it" + (f" ({said[:160]})" if said else ""))
        if h.get("proved") != fp:
            return (f"{spec['title']} does not hold this copy of their book yet — the texts wait until the house "
                    "is proved to hold it")
    return ""


def plan(doc: dict[str, Any] | None, state: dict[str, Any], cards: dict[str, Any],
         now: float, fresh_read: bool) -> dict[str, Any]:
    """Mutates `state`; silent unless `fresh_read`."""
    at = datetime.fromtimestamp(now, UTC)
    led = state.setdefault("ledger", {})
    out: dict[str, Any] = {"rows": [], "held_why": "", "counts": {}}
    if not doc:
        out["held_why"] = "there is no copy of the recruiters' book yet"
        return out
    if not fresh_read:
        why = str((state.get("source") or {}).get("why") or "")
        out["held_why"] = ("the recruiters' book could not be read on this pass" + (f" ({why[:200]})" if why else "")
                           + " — nothing is offered from an old copy")
        return out

    pipe_missing = has_columns(doc, "recruit_pipeline", PIPE_COLS)
    onb_missing = has_columns(doc, "recruit_onboarding", ONB_COLS)
    passed: dict[str, dict[str, Any]] = {}
    screener_by_phone: dict[str, str] = {}
    if not pipe_missing:
        for row in rows_of(doc, "recruit_pipeline"):
            p = phone10(_cell(row, PIPE_COLS["phone"]))
            if not p:
                continue
            scr = re.sub(r"\s+", " ", _cell(row, PIPE_COLS["screener"])).strip()
            if scr:
                screener_by_phone[p] = scr
            if _cell(row, PIPE_COLS["hire"]).strip().lower() == "yes":
                passed.setdefault(p, {"row": row, "cols": PIPE_COLS})
    if not onb_missing:
        for row in rows_of(doc, "recruit_onboarding"):
            p = phone10(_cell(row, ONB_COLS["phone"]))
            if p and _cell(row, ONB_COLS["status"]).strip().lower() == "pending":
                passed.setdefault(p, {"row": row, "cols": ONB_COLS})
    can_see_both = not pipe_missing and not onb_missing
    if can_see_both:
        if state.get("birth") is None:
            for p in passed:
                led[f"{ONBOARD}|{p}"] = {"situation": ONBOARD, "state": "baseline", "first_seen": _iso(now),
                                         "said_at": _iso(now), "offers": 0, "count": 0,
                                         "why": "already passed when this lane was born — never texted",
                                         "view": _view(passed[p]["row"], passed[p]["cols"])}
            state["birth"] = {"at": _iso(now), "baseline": len(passed)}
        else:
            # after unread passes the window starts from the last read, so a stall ends stale, not late
            prev = _epoch(state.get("onboard_seen_at"))
            since = prev if prev and now - prev > 2 * PASS_EVERY_S else now
            for p, hit in passed.items():
                key = f"{ONBOARD}|{p}"
                if led.get(key) is None:
                    entry = {"situation": ONBOARD, "state": "owed", "first_seen": _iso(since), "offers": 0,
                             "count": 0, "view": _view(hit["row"], hit["cols"])}
                    if since != now:
                        entry["why"] = (f"first seen after the lane could not read the book since {_iso(prev)} — "
                                        "the 72 hours are counted from then")
                    led[key] = entry
        state["onboard_seen_at"] = _iso(now)

    holds = houses_hold(doc, state)
    if holds:
        out["held_why"] = holds
        return out
    if not cards.get("ok"):
        out["held_why"] = cards.get("why") or "the hiring board could not be read"
        return out
    if quiet(at):
        out["held_why"] = f"inside the quiet window — nothing is offered until {QUIET_TO}"
        return out
    hub = cards.get("phones", set())
    offered_people: set[str] = set()
    rows: list[dict[str, Any]] = []

    def offer(key: str, sit: str, person: str, payload: dict[str, Any], view: dict[str, Any],
              slot: int = 1) -> None:
        if person in offered_people or len(rows) >= MAX_PER_POST:
            return
        entry = led.get(key) or {"situation": sit, "state": "owed", "first_seen": _iso(now),
                                 "offers": 0, "count": 0}
        entry["view"] = {k: view.get(k, "") for k in ("first_name", "name", "last4", "source",
                                                       "screener", "time", "date", "location")}
        led[key] = entry
        offered_people.add(person)
        body = {"id": occasion_id(key + (f"#{slot}" if slot > 1 else "")), "key": key, "situation": sit,
                "slot": slot, "phone": "+1" + person}
        body.update(payload)
        rows.append(body)

    for s in screens(doc, cards, now, days=1):
        if s["verdict"] != "owed" or not s["key"]:
            continue
        entry = led.get(s["key"])
        if not due(entry, now):
            continue
        offer(s["key"], SCREEN, s["phone"],
              {"first_name": s["first_name"], "name": s["name"], "screener": s["screener"],
               "time": s["time"], "location": s["location"], "date": s["date"],
               "deadline": s["deadline"], "source": s["source"]}, s)

    for key, entry in list(led.items()):
        if entry.get("situation") != ONBOARD or str(entry.get("state")) in FINAL:
            continue
        p = key.split("|", 1)[1]
        if now - _epoch(entry.get("first_seen")) > ONBOARD_FRESH_S:
            entry.update({"state": "stale", "said_at": _iso(now),
                          "why": "not told within 72 hours of the book saying so — never sent late"})
            clear_copy(entry)
            continue
        if p in hub:
            entry.update({"state": "hub_card", "said_at": _iso(now),
                          "why": "this person is on the hiring board — the Hub's lanes text them"})
            clear_copy(entry)
            continue
        if not due(entry, now) or p not in passed:
            continue
        hit = passed[p]
        v = _view(hit["row"], hit["cols"])
        offer(key, ONBOARD, p, {"first_name": v["first_name"], "name": v["name"],
                                "screener": screener_by_phone.get(p, ""), "source": v["source"]}, v)

    if not onb_missing:
        undone: set[str] = set()
        for row in rows_of(doc, "recruit_onboarding"):
            p = phone10(_cell(row, ONB_COLS["phone"]))
            if not p:
                continue
            if _cell(row, ONB_COLS["status"]).strip().lower() not in ("pending", "yes"):
                continue
            if _cell(row, ONB_COLS["bci"]).strip().lower() != "n":
                continue
            undone.add(p)
            key = f"{BCI}|{p}"
            entry = led.get(key)
            if p in hub:
                if entry is None or str(entry.get("state")) not in FINAL:
                    led[key] = dict(entry or {"situation": BCI, "first_seen": _iso(now), "offers": 0, "count": 0},
                                    state="hub_card", said_at=_iso(now),
                                    why="this person is on the hiring board — the Hub's lanes text them",
                                    view=_view(row, ONB_COLS))
                    clear_copy(led[key])
                continue
            if entry is None:
                entry = {"situation": BCI, "state": "owed", "first_seen": _iso(now), "offers": 0, "count": 0,
                         "view": _view(row, ONB_COLS),
                         "why": f"the how-to waits {BCI_AFTER_DAYS} business days after the book first shows "
                                "the check undone"}
                led[key] = entry
            if not bci_hours(at):
                continue
            if str(entry.get("state")) in SAID:
                if not repeat_due(entry, now):
                    continue
            elif not due(entry, now):
                continue
            elif (int(entry.get("count") or 0) == 0
                  and business_days_since(entry.get("first_seen"), now) < BCI_AFTER_DAYS):
                continue
            slot = int(entry.get("count") or 0) + 1
            v = _view(row, ONB_COLS)
            offer(key, BCI, p, {"first_name": v["first_name"], "name": v["name"], "source": v["source"]}, v,
                  slot=slot)
        for key, entry in list(led.items()):
            if (entry.get("situation") == BCI and str(entry.get("state")) == "owed"
                    and not int(entry.get("offers") or 0) and key.split("|", 1)[1] not in undone):
                del led[key]

    for r in rows:
        out["counts"][r["situation"]] = out["counts"].get(r["situation"], 0) + 1
    out["rows"] = rows
    return out


def copy_of(ans: dict[str, Any] | None) -> dict[str, Any]:
    """The copy one answer carries; an answer without words carries an empty one."""
    a = ans or {}
    out: dict[str, Any] = {f: str(a.get(f) or "")[:cap] for f, cap in COPY_FIELDS}
    try:
        told = int(a.get("words_chars") or 0)
    except (TypeError, ValueError):
        told = 0
    # never shorter than the words the door handed over, so a cut made here is said too
    out["words_chars"] = max(told, len(str(a.get("words") or "")))
    return out


def clear_copy(entry: dict[str, Any]) -> None:
    """A state that is not the door's answer shows no earlier answer's words."""
    entry.update(copy_of(None))


def posted(state: dict[str, Any], rows: list[dict[str, Any]], said: dict[str, Any] | None,
           failure: str, now: float) -> dict[str, int]:
    led = state.setdefault("ledger", {})
    by_id = {str((r or {}).get("id")): r for r in ((said or {}).get("results") or [])}
    counts: dict[str, int] = {}
    for row in rows:
        entry = led.setdefault(row["key"], {"situation": row["situation"], "first_seen": _iso(now),
                                            "offers": 0, "count": 0})
        ans = by_id.get(str(row["id"])) if not failure else None
        st = str((ans or {}).get("state") or ("failed" if failure or said is not None else "offered"))
        if not failure and said is not None and ans is None:
            st, why = "failed", "the door answered and said nothing about this row"
        else:
            why = failure or str((ans or {}).get("why") or "")
        if st not in FINAL and st not in NOT_NOW:
            st, why = "failed", f"an answer this lane does not know (`{st}`): {why}"[:300]
        entry["state"] = st
        entry["why"] = why[:400]
        entry["said_at"] = _iso(now)
        entry["detail"] = str((ans or {}).get("detail") or "")[:200]
        # The copy of the answer that stands, never an older one: a state decided before the door composed the words…
        entry.update(copy_of(ans))
        if st == "failed":
            entry["failures"] = int(entry.get("failures") or 0) + 1
            if entry["failures"] >= FAILED_OFFERS:
                entry["state"] = "gave_up"
                entry["why"] = f"the door failed {entry['failures']} times — {why}"[:400]
        if st in SAID:
            entry["count"] = int(row.get("slot") or 1)
            entry["failures"] = 0
            if ans and ans.get("max") is not None:
                entry["max"] = int(ans.get("max") or 1)
            if ans and ans.get("gap_days") is not None:
                entry["gap_days"] = float(ans.get("gap_days") or 0)
        counts[entry["state"]] = counts.get(entry["state"], 0) + 1
    return counts


def mark_offered(state: dict[str, Any], rows: list[dict[str, Any]], now: float) -> None:
    """Marked before the post leaves; the door's idempotency key makes a retry safe."""
    led = state.setdefault("ledger", {})
    for row in rows:
        entry = led.setdefault(row["key"], {"situation": row["situation"], "first_seen": _iso(now),
                                            "offers": 0, "count": 0})
        entry["offers"] = int(entry.get("offers") or 0) + 1
        entry["offered_at"] = _iso(now)
        entry["state"] = "offered"
        clear_copy(entry)


def due_pass(now: float | None = None) -> bool:
    now = time.time() if now is None else now
    return now - _LAST_PASS["at"] >= PASS_EVERY_S


def sync(now: float | None = None, root: Path | None = None, out_dir: Path | None = None) -> dict[str, Any]:
    now = time.time() if now is None else now
    out_dir = out_dir or DIR
    with _LOCK:
        _LAST_PASS["at"] = now
        state = load_state(out_dir / STATE_FILE)
        src = read_source(root, now=now)
        changed = False
        counts: dict[str, int] = {}
        if src["ok"]:
            doc = build_copy(src, now)
            old = _read(out_dir / COPY_FILE) or {}
            same = all(((old.get("tabs") or {}).get(h) or {}).get("fingerprint") ==
                       doc["tabs"][h]["fingerprint"] for h in TABS)
            if not same or not old:
                _write(out_dir / COPY_FILE, doc)
                changed = True
            counts = {h: doc["tabs"][h]["count"] for h in TABS}
            state["source"] = {"state": "read", "why": "; ".join(src.get("notes") or []),
                               "at": _iso(now), "synced_at": src["synced_at"],
                               "modified_time": src["modified_time"], "keeper_at": src["keeper_at"]}
        else:
            prior = state.get("source") or {}
            state["source"] = dict(prior, state="unread", why=src["why"], at=_iso(now),
                                   keeper_at=src.get("keeper_at") or prior.get("keeper_at", ""))
        save_state(state, out_dir / STATE_FILE)
        return {"read": bool(src["ok"]), "changed": changed, "why": src["why"], "counts": counts}


def house_offer(now: float | None = None, out_dir: Path | None = None) -> list[dict[str, Any]]:
    now = time.time() if now is None else now
    out_dir = out_dir or DIR
    with _LOCK:
        doc = _read(out_dir / COPY_FILE)
        if not doc:
            return []
        state = load_state(out_dir / STATE_FILE)
        offers = []
        for house, spec in TABS.items():
            t = (doc.get("tabs") or {}).get(house) or {}
            if not t.get("rows"):
                continue
            h = state["houses"].get(house) or {}
            if h.get("proved") == t.get("fingerprint"):
                continue
            if h.get("state") != "written" and now - _epoch(h.get("offered_at")) < HOUSE_EVERY_S:
                continue
            offers.append({"tab": house, "source_tab": spec["source_tab"], "header": t["header"],
                           "rows": t["rows"], "fingerprint": t["fingerprint"],
                           "source": dict(doc.get("source") or {}, built_at=doc.get("built_at", ""))})
        return offers


def house_mark(offer: dict[str, Any], said: dict[str, Any] | None, failure: str,
               now: float | None = None, out_dir: Path | None = None) -> str:
    """Only `written` with a matching fingerprint and count proves the house holds the copy."""
    now = time.time() if now is None else now
    out_dir = out_dir or DIR
    with _LOCK:
        state = load_state(out_dir / STATE_FILE)
        h = state["houses"].setdefault(offer["tab"], {})
        h["offered_at"] = _iso(now)
        st = str((said or {}).get("state") or ("failed" if failure else "failed"))
        ok = (not failure and st == "written" and str((said or {}).get("fingerprint")) == offer["fingerprint"]
              and int((said or {}).get("rows") or -1) == len(offer["rows"]))
        if ok:
            h["proved"] = offer["fingerprint"]
            h["proved_at"] = _iso(now)
            h["rows"] = len(offer["rows"])
            st = "written"
        elif st == "written":
            st = "failed"
            failure = failure or "the door said written but not with these rows"
        h["state"] = st
        h["why"] = (failure or str((said or {}).get("why") or ""))[:300]
        save_state(state, out_dir / STATE_FILE)
        return st


def pending(now: float | None = None, out_dir: Path | None = None,
            cards_path: Path | None = None) -> dict[str, Any]:
    now = time.time() if now is None else now
    out_dir = out_dir or DIR
    with _LOCK:
        state = load_state(out_dir / STATE_FILE)
        doc = _read(out_dir / COPY_FILE)
        cards = hub_cards(cards_path, now)
        state["cards"] = {"state": "read" if cards["ok"] else "unread", "why": cards["why"],
                          "at": cards["at"], "count": len(cards["phones"])}
        fresh = (state.get("source") or {}).get("state") == "read"
        got = plan(doc, state, cards, now, fresh_read=fresh)
        state["planned_at"] = _iso(now)
        state["held_why"] = got["held_why"]
        if got["rows"]:
            mark_offered(state, got["rows"], now)
        save_state(state, out_dir / STATE_FILE)
        return got


def mark(rows: list[dict[str, Any]], said: dict[str, Any] | None, failure: str,
         now: float | None = None, out_dir: Path | None = None) -> dict[str, int]:
    now = time.time() if now is None else now
    out_dir = out_dir or DIR
    with _LOCK:
        state = load_state(out_dir / STATE_FILE)
        counts = posted(state, rows, said, failure, now)
        state["last_post_at"] = _iso(now)
        state["last_post_why"] = failure[:300]
        save_state(state, out_dir / STATE_FILE)
        return counts


def door_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """The ledger key spells the phone."""
    return [{k: v for k, v in r.items() if k != "key"} for r in rows]


def _pick(row: dict[str, Any], fields: tuple[str, ...]) -> dict[str, Any]:
    return {f: row.get(f) for f in fields if f in row}


def build_slice(resource: str = "recruitBook", dsn: str = "", out_dir: Path | None = None,
                cards_path: Path | None = None, now: float | None = None) -> tuple[list[dict[str, Any]], str]:
    now = time.time() if now is None else now
    out_dir = out_dir or DIR
    state = load_state(out_dir / STATE_FILE)
    doc = _read(out_dir / COPY_FILE)
    cards = hub_cards(cards_path, now)
    src = state.get("source") or {}
    houses = []
    for house, spec in TABS.items():
        h = state["houses"].get(house) or {}
        houses.append({"tab": house, "title": spec["title"], "state": h.get("state", "never"),
                       "rows": h.get("rows", 0), "proved_at": h.get("proved_at", ""),
                       "why": h.get("why", "")})
    led = state.get("ledger") or {}
    counts: dict[str, dict[str, int]] = {}
    for entry in led.values():
        sit = str(entry.get("situation") or "")
        counts.setdefault(sit, {})
        st = str(entry.get("state") or "owed")
        counts[sit][st] = counts[sit].get(st, 0) + 1
    status = {
        "row_kind": "status", "id": "status",
        "source_state": src.get("state", "never"), "source_why": src.get("why", ""),
        "source_at": src.get("synced_at", ""), "source_modified_at": src.get("modified_time", ""),
        "keeper_at": src.get("keeper_at", ""), "copy_at": (doc or {}).get("built_at", ""),
        "copy_counts": {h: ((doc or {}).get("tabs") or {}).get(h, {}).get("count", 0) for h in TABS},
        "houses": houses,
        "birth_at": (state.get("birth") or {}).get("at", ""),
        "baseline": (state.get("birth") or {}).get("baseline", 0),
        "cards_state": "read" if cards["ok"] else "unread", "cards_why": cards["why"], "cards_at": cards["at"],
        "last_pass_at": src.get("at", ""), "last_post_at": state.get("last_post_at", ""),
        "last_post_why": state.get("last_post_why", ""), "counts": counts,
        "planned_at": state.get("planned_at", ""), "held_why": state.get("held_why", ""),
    }
    rows = [_pick(status, STATUS_FIELDS)]
    for s in screens(doc, cards, now, days=2):
        entry = led.get(s.get("key") or "") or {}
        st = str(entry.get("state") or "")
        verdict = s["verdict"]
        if st in SAID or st in ("duplicate",):
            verdict = st
        rows.append(_pick({"row_kind": "screen", "id": view_id(s.get("key") or s["source"], out_dir),
                           "day": s["day"], "first_name": s["first_name"], "name": s["name"],
                           "last4": s["last4"], "screener": s["screener"], "time": s["time"],
                           "location": s["location"], "status": s["status"], "verdict": verdict,
                           "why": entry.get("why") or s["why"], "state": st, "source": s["source"]},
                          SCREEN_FIELDS))
    recent = sorted(((k, e) for k, e in led.items() if str(e.get("state")) != "baseline"),
                    key=lambda kv: str(kv[1].get("said_at") or kv[1].get("offered_at") or kv[1].get("first_seen") or ""),
                    reverse=True)[:VIEW_MESSAGES]
    for key, e in recent:
        v = e.get("view") or {}
        rows.append(_pick({"row_kind": "message", "id": view_id(key, out_dir), "situation": e.get("situation", ""),
                           "first_name": v.get("first_name", ""), "name": v.get("name", ""),
                           "last4": v.get("last4", ""), "state": e.get("state", ""), "why": e.get("why", ""),
                           "first_seen": e.get("first_seen", ""), "said_at": e.get("said_at", ""),
                           "count": int(e.get("count") or 0), "detail": e.get("detail", ""),
                           "source": v.get("source", ""),
                           **{f: e.get(f, "") for f, _cap in COPY_FIELDS},
                           "words_chars": int(e.get("words_chars") or 0)}, MESSAGE_FIELDS))
    return rows, str(state.get("planned_at") or src.get("at") or "")
