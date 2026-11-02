"""My Calendar's roster names off the relay's state and asa-hub-db: effective_roster, house_cal_live, house_directory and
shift_slices, translated. The relay's own tables only through mw_relay_state; sheets from asa-hub-db with app.edits laid."""
from __future__ import annotations

import contextlib
import contextvars
import json
import os
import re
from datetime import date, datetime, timedelta, timezone
from typing import Any, Iterator

import editions
import gsjs
import house_tables as HT
import hubdb
import locations as L
import mw_relay_state
from scope import Defer

UTC = timezone.utc


# ---- the reads ------------------------------------------------------------------

def _db(src: Any) -> Any:
    """The asa-hub-db reader a session, a request's reads or the reader itself carries."""
    for got in (src, getattr(src, "reads", None)):
        db = getattr(got, "db", got)
        if db is not None and hasattr(db, "facts") and hasattr(db, "rows") and hasattr(db, "tab"):
            return db
    raise hubdb.Unreadable("no asa-hub-db reader was handed to the roster reads")


def _once(src: Any, name: str, fn: Any) -> Any:
    """Once per request when the request's reads are at hand."""
    once = getattr(getattr(src, "reads", src), "once", None) if src is not None else None
    return once("mw_roster:" + name, fn) if callable(once) else fn()


def _cell(v: Any) -> str:
    """A copied cell as the keeper's text column holds it."""
    if v is None:
        return ""
    if isinstance(v, str):
        return v
    if isinstance(v, bool):
        return "true" if v else "false"
    return json.dumps(v, ensure_ascii=False)


# ---- shift_slices ----------------------------------------------------------------------

class shift_slices:  # noqa: N801 - server/shift_slices.py, the cell grammar
    _T = r"(\d{1,2})(?::?(\d{2}))?\s*([AP])M?"
    _T1 = r"(\d{1,2})(?::?(\d{2}))?\s*([AP])?M?"
    _TIME_RANGE = re.compile(rf"^\*?\s*{_T1}\s*[-–]\s*{_T}(?:\s+[A-Za-z]{{1,4}})?\s*$", re.IGNORECASE)
    _NOT_WORKING = {"OFF", "R/O", "C/O", "RO", "R\\O", "R/0", "NCNS", "NO WORKSHOP"}
    _CHAIN = re.compile(r"\s*[><]\s*")

    @staticmethod
    def _hour(h: str, m: str | None, ap: str) -> float:
        out = int(h) % 12 + (12 if ap.upper() == "P" else 0)
        return out + (int(m) / 60 if m else 0)

    @staticmethod
    def _range(segment: str) -> tuple[float, float] | None:
        m = shift_slices._TIME_RANGE.match(segment.strip())
        if not m:
            return None
        h1, m1, ap1, h2, m2, ap2 = m.groups()
        ap1 = ap1 or ap2
        start, end = shift_slices._hour(h1, m1, ap1), shift_slices._hour(h2, m2, ap2)
        if m.group(3) is None and start >= end:
            start = (start - 12) % 24
        if end <= start:
            end += 24
        return start, end

    @staticmethod
    def _kind_for(start: float, end: float) -> str:
        if start >= 19 or end > 24:
            return "overnight"
        if end - start >= 11 and start <= 10:
            return "day"
        if start < 11:
            return "morning"
        if start < 16:
            return "afternoon"
        return "evening"

    @staticmethod
    def classify(raw: str) -> dict | None:
        """`code` stays the cell as written: the chip must say what the sheet says."""
        code = (raw or "").strip()
        if not code:
            return None
        segments = [s for s in shift_slices._CHAIN.split(code) if s.strip()]
        hours: tuple[float, float] | None = None
        token: str | None = None
        for seg in segments:
            got = shift_slices._range(seg)
            if got and hours is None:
                hours = got
            elif not got and token is None:
                up = seg.strip().upper().lstrip("*").strip()
                if up not in shift_slices._NOT_WORKING:
                    token = seg.strip()
        shown = code.lstrip("*").strip()
        if hours:
            return {"kind": shift_slices._kind_for(*hours), "code": shown,
                    "start": hours[0], "end": hours[1], "token": token}
        up = shown.upper()
        if up == "OFF":
            return {"kind": "off", "code": "OFF"}
        if up in shift_slices._NOT_WORKING:
            return {"kind": "ro", "code": up}
        return {"kind": "alias", "code": shown, "token": shown}


# ---- house_directory -----------------------------------------------------------------

class house_directory:  # noqa: N801 - server/house_directory.py, off the entity_homes tab in asa-hub-db
    ENTITIES_PROP = "HUB_CLIENT_ENTITIES_SHEET_ID"
    ENTITIES_FALLBACK = "1yIc3f9S9ZRlAJ3drUinFmm0gTflO-GUx0BVaFVYVopI"
    HOMES_TAB = "entity_homes"

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

    @staticmethod
    def read(src: Any, now: float | None = None) -> dict[str, dict[str, str]]:
        """code → {code, label, name, address, region}; a tab asa-hub-db does not hold raises hubdb.Unreadable."""
        def build() -> dict[str, dict[str, str]]:
            db = _db(src)
            sid = db.prop(house_directory.ENTITIES_PROP) or house_directory.ENTITIES_FALLBACK
            # the registry as it stands: its own table once kept there
            ref = HT.book_tab(L.Reads(db, None), sid, house_directory.HOMES_TAB)
            if ref is None:
                raise hubdb.Unreadable(f"asa-hub-db holds no {house_directory.HOMES_TAB} tab of the house registry")
            rows: dict[str, dict[str, str]] = {}
            for _rn, r in db.rows(ref):
                r = r if isinstance(r, dict) else {}
                code = _cell(r.get("abbreviation")).strip().upper() or house_directory.code_of(_cell(r.get("home_name")))
                if not code:
                    continue
                label = house_directory.label_of(_cell(r.get("home_name")), code)
                rows[code] = {"code": code, "label": label,
                              "name": f"{label} home" if label and label != code else code,
                              "address": " ".join(_cell(r.get("address")).split()),
                              "region": _cell(r.get("region")).strip()}
            return rows
        return dict(_once(src, "homes", build))

    @staticmethod
    def lookup(src: Any, house: Any) -> dict[str, str] | None:
        code = house_directory.code_of(house)
        if not code:
            return None
        return house_directory.read(src).get(code)


# ---- effective_roster ----------------------------------------------------------------

# this request's test mode switch: the relay's own when it hands one in, else read off the platform's config
_SWITCH: contextvars.ContextVar[Any] = contextvars.ContextVar("mw_roster_switch", default=None)
# this request's published and held cells as the relay handed them (asa_house_calendar_edits is the relay's alone)
_PUBLISHED_HANDED: contextvars.ContextVar[list[dict[str, Any]] | None] = contextvars.ContextVar(
    "mw_roster_published", default=None)


class effective_roster:  # noqa: N801 - server/effective_roster.py
    EDITS = "asa_house_calendar_edits"
    LIVE = "asa_house_calendar_live"
    STATE_PENDING = "pending"
    STATE_CONFIRMED = "confirmed"
    STATE_CHANGED = "changed"
    STATE_UNDRAWN = "undrawn"
    STATE_TEST_MODE = "test_mode"
    _PUBLISHED = "published"
    _TEST_MODE = "test_mode"
    REHEARSAL = "rehearsal"
    REHEARSAL_VIA = f"{REHEARSAL}:"
    # AlertsConfig.gs HUB_TEST_MODE_ON_WORDS / HUB_TEST_MODE_OFF_WORDS, Rpc.gs HUB_REHEARSAL_WORDS
    ON_WORDS = ("on", "true", "1", "test")
    OFF_WORDS = ("off", "false", "0", "production")
    REHEARSAL_WORDS = ("sheet", "rehearsal", "paper")
    # the payload field the relay hands its switch in
    SWITCH_KEY = "test_mode"
    NO_EDITS = (f"the published calendar cells ({EDITS}) are not among the relay tables Python reads, "
                "so the relay answers")

    @staticmethod
    @contextlib.contextmanager
    def use_switch(given: Any = None) -> Iterator[None]:
        """This request's switch: the relay's {on, readable, word, why} (or a callable giving it); None reads the config."""
        token = _SWITCH.set(given)
        try:
            yield
        finally:
            _SWITCH.reset(token)

    @staticmethod
    @contextlib.contextmanager
    def use_published(cells: list[dict[str, Any]] | None) -> Iterator[None]:
        """This request's published and held cells as the relay handed them; None reads the edits table."""
        token = _PUBLISHED_HANDED.set(None if cells is None else [dict(c) for c in cells if isinstance(c, dict)])
        try:
            yield
        finally:
            _PUBLISHED_HANDED.reset(token)

    @staticmethod
    def lane_test_mode(cfg: dict[str, Any]) -> dict[str, Any]:
        """Bundle.gs configLane's test_mode part over hubTestModeState_, from the config as Python reads it."""
        def items(v: Any) -> list[str]:
            return [x for x in (gsjs.trim(s) for s in re.split(r"[,;\n]+", gsjs.or_blank(v))) if x]

        sms = {"+1" + d for d in (re.sub(r"^1", "", re.sub(r"[^0-9]", "", x)) for x in items(cfg.get("test_redirect_sms")))
               if len(d) == 10}
        mails = {x for x in (gsjs.trim(m) for m in items(cfg.get("test_redirect_email")))
                 if re.fullmatch(r"[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+", x)}
        raw = gsjs.trim(gsjs.or_blank(cfg.get("test_mode"))).lower()
        unrecognized = ""
        if raw in effective_roster.ON_WORDS or raw in effective_roster.REHEARSAL_WORDS:
            on = True
        elif raw in effective_roster.OFF_WORDS:
            on = False
        elif not raw:
            on = (len(sms) + len(mails)) > 0
        else:
            on, unrecognized = True, raw
        if unrecognized:
            return {"unreadable": ('test_mode reads "' + unrecognized[:40] + '", a word the switch does not know '
                                   "(on or off) — held as on until it is saved as one of them"),
                    "on": True, "word": raw, "explicit": True}
        return {"on": bool(on), "word": raw or ("on" if on else "off"), "explicit": raw != ""}

    @staticmethod
    def switch_from_lane(tm: Any) -> dict[str, Any]:
        """web_gate.switch_from over a fresh lane's test_mode part: `on` unless it plainly says off."""
        def held(why: str) -> dict[str, Any]:
            return {"on": True, "readable": False, "word": "unreadable", "why": why}

        if not isinstance(tm, dict):
            return held("the configuration the relay reads does not carry test mode "
                        "(Bundle.gs configLane has no test_mode part)")
        if tm.get("unreadable"):
            return held(f"the platform could not read test mode ({str(tm.get('unreadable'))[:120]})")
        on = tm.get("on")
        if on is not True and on is not False:
            return held(f"test mode came back as {on!r}, which is neither on nor off")
        word = str(tm.get("word") or ("on" if on else "off")).strip() or ("on" if on else "off")
        return {"on": on, "readable": True, "word": word, "why": ""}

    @staticmethod
    def switch_from_config(src: Any) -> dict[str, Any]:
        """The switch as the relay resolves it from a fresh lane, read off asa-hub-db's config with app.edits laid."""
        if src is None:
            raise Defer("no test mode switch was handed and no reader is at hand, so the relay answers")
        try:
            db = _db(src)
            cfg = editions.laid_config(db, db.hiring_config())
        except Defer:
            raise
        except Exception as exc:  # noqa: BLE001 - the switch unread is the relay's to answer
            raise Defer(f"test mode could not be read off asa-hub-db ({type(exc).__name__}), so the relay answers") \
                from exc
        return effective_roster.switch_from_lane(effective_roster.lane_test_mode(cfg))

    @staticmethod
    def test_mode(src: Any = None) -> dict[str, Any]:
        given = _SWITCH.get()
        if given is None:
            return effective_roster.switch_from_config(src)
        if callable(given):
            try:
                got = given()
            except Exception as exc:  # noqa: BLE001
                return {"on": True, "readable": False, "word": "unreadable",
                        "why": f"the switch could not be read ({type(exc).__name__})"}
        else:
            got = given
        if not isinstance(got, dict) or got.get("on") is not False:
            return {"on": True, "readable": bool(isinstance(got, dict) and got.get("readable")),
                    "word": str((got or {}).get("word") or "on") if isinstance(got, dict) else "unreadable",
                    "why": str((got or {}).get("why") or "") if isinstance(got, dict) else "no answer"}
        return {"on": False, "readable": True, "word": str(got.get("word") or "off"), "why": ""}

    @staticmethod
    def test_mode_said(src: Any = None) -> dict[str, Any]:
        """The switch as a read door tells a screen: on, readable and why; an unreadable switch holds."""
        switch = effective_roster.test_mode(src)
        return {"on": bool(switch.get("on")), "readable": bool(switch.get("readable")),
                "why": str(switch.get("why") or "")}

    @staticmethod
    def fold(name: Any) -> str:
        return " ".join(str(name or "").lower().split())

    @staticmethod
    def house_code(location: Any) -> str:
        text = str(location or "").strip()
        return text.split(" - ")[-1].strip() if text else ""

    @staticmethod
    def _day(v: Any) -> date | None:
        if isinstance(v, datetime):
            return v.date()
        if isinstance(v, date):
            return v
        try:
            return date.fromisoformat(str(v or "")[:10])
        except ValueError:
            return None

    @staticmethod
    def published(src: Any = None, day_from: date | None = None, day_to: date | None = None, *,
                  location: str | None = None, held: bool | None = None) -> list[dict[str, Any]]:
        """Pending = newer than the copy's stamp less the settle time; while `held`, test mode's cells too."""
        er = effective_roster
        handed = _PUBLISHED_HANDED.get()
        if handed is not None:
            return [dict(c) for c in handed
                    if (day_from is None or str(c.get("col_iso") or "") >= day_from.isoformat())
                    and (day_to is None or str(c.get("col_iso") or "") <= day_to.isoformat())
                    and (location is None or c.get("location") == location)]
        if er.EDITS not in mw_relay_state.TABLES:
            raise Defer(er.NO_EDITS)
        held = bool(er.test_mode(src).get("on")) if held is None else bool(held)
        where, args = ["stage = ANY(%s)"], [[er._PUBLISHED, er._TEST_MODE]]
        if day_from is not None:
            where.append("col_iso >= %s")
            args.append(day_from.isoformat())
        if day_to is not None:
            where.append("col_iso <= %s")
            args.append(day_to.isoformat())
        if location is not None:
            where.append("location = %s")
            args.append(location)
        got = mw_relay_state.rows(er.EDITS, " AND ".join(where), tuple(args),
                                  order="location, employee, col_iso, id DESC",
                                  columns=("id", "location", "employee", "col_iso", "new_value", "at", "actor", "via",
                                           "stage", "undone_at"))
        mirror = {str(r.get("location")): r.get("updated_at")
                  for r in mw_relay_state.rows(er.LIVE, columns=("location", "updated_at"))}
        settle = timedelta(seconds=house_cal_live.PUBLISH_SETTLE_S)
        cells: dict[tuple[str, str, str], list[dict[str, Any]]] = {}
        for e in got:
            cells.setdefault((e.get("location"), e.get("employee"), e.get("col_iso")), []).append(e)
        out: list[dict[str, Any]] = []
        for key, rows in cells.items():
            if str(key[0]) not in mirror:
                continue
            p = next((e for e in rows if e.get("stage") == er._PUBLISHED
                      or (held and e.get("stage") == er._TEST_MODE and e.get("undone_at") is None)), None)
            if p is None:
                continue
            mirror_at = mirror[str(key[0])]
            pending = p.get("stage") == er._TEST_MODE or (
                p.get("at") is not None and mirror_at is not None and p["at"] > mirror_at - settle)
            rehearsed = False
            if p.get("stage") == er._TEST_MODE:
                rehearsed = any(
                    r.get("stage") == er._TEST_MODE and r.get("undone_at") is None
                    and str(r.get("via") or "").startswith(er.REHEARSAL_VIA)
                    and not any(q.get("stage") == er._PUBLISHED and int(q.get("id") or 0) > int(r.get("id") or 0)
                                for q in rows)
                    for r in rows)
            out.append({"id": int(p["id"]), "location": str(p["location"]),
                        "employee": str(p["employee"]), "col_iso": str(p["col_iso"]),
                        "value": str(p.get("new_value") or "").strip(), "at": p.get("at"),
                        "actor": str(p.get("actor") or ""), "via": str(p.get("via") or ""),
                        "mirror_at": mirror_at, "pending": bool(pending),
                        "test_mode": str(p.get("stage") or "") == er._TEST_MODE,
                        er.REHEARSAL: bool(rehearsed)})
        return out

    @staticmethod
    def on_mirror(src: Any = None, location: str | None = None) -> dict[str, dict[str, Any]]:
        """The pending, held and rehearsed cells per house, from ONE read of published()."""
        pending: dict[str, dict[tuple[str, str], str]] = {}
        held: dict[str, set[tuple[str, str]]] = {}
        played: dict[str, set[tuple[str, str]]] = {}
        for c in effective_roster.published(src, location=location):
            key = (c["employee"], c["col_iso"])
            if c["pending"]:
                pending.setdefault(c["location"], {})[key] = c["value"]
            if c["test_mode"]:
                held.setdefault(c["location"], set()).add(key)
                if c[effective_roster.REHEARSAL]:
                    played.setdefault(c["location"], set()).add(key)
        return {"pending": pending, "held": held, "rehearsed": played}

    @staticmethod
    def pending_on_mirror(src: Any = None, location: str | None = None) -> dict[str, dict[tuple[str, str], str]]:
        return effective_roster.on_mirror(src, location)["pending"]

    @staticmethod
    def held_on_mirror(src: Any = None, location: str | None = None) -> dict[str, set[tuple[str, str]]]:
        return effective_roster.on_mirror(src, location)["held"]

    @staticmethod
    def rehearsed_on_mirror(src: Any = None, location: str | None = None) -> dict[str, set[tuple[str, str]]]:
        return effective_roster.on_mirror(src, location)["rehearsed"]


# ---- house_cal_live ----------------------------------------------------------------------

class house_cal_live:  # noqa: N801 - server/house_cal_live.py, its reads
    LIVE = "asa_house_calendar_live"
    STAGE_DRAFT = "draft"
    STAGE_PUBLISHED = "published"
    STAGE_CALL_OFF = "call_off"
    STAGE_TEST_MODE = "test_mode"
    PUBLISH_SETTLE_S = int(os.getenv("HUB_HOUSECAL_PUBLISH_SETTLE_S", "180"))
    # OPEN, OPEN 2, Open (B) — but a name that merely begins with "Open" is a person
    _OPEN_ROW = re.compile(r"^\s*open(?![a-z])", re.IGNORECASE)

    @staticmethod
    def _as_dict(grid: Any) -> dict[str, Any]:
        """Decode the `grid` column; every grid reader comes through here, so OPEN rows are keyed here."""
        if isinstance(grid, str):
            try:
                return house_cal_live.key_rows(dict(json.loads(grid)))
            except Exception:  # noqa: BLE001 - a torn grid is an empty grid
                return {}
        return house_cal_live.key_rows(dict(grid or {}))

    @staticmethod
    def is_open_row(name: Any) -> bool:
        return bool(house_cal_live._OPEN_ROW.match(str(name or "")))

    @staticmethod
    def _skip_staff(name: str, house: str) -> bool:
        """calendar_builder_slices._skip_staff."""
        low = (name or "").lower()
        return (not name or low == "open" or "workshop" in low
                or "workshop" in (house or "").lower())

    @staticmethod
    def not_a_person(name: Any, location: Any = "") -> bool:
        """OPEN and WORKSHOP rows; `_skip_staff` plus the numbered OPEN rows."""
        return house_cal_live._skip_staff(str(name or ""), str(location or "")) or house_cal_live.is_open_row(name)

    @staticmethod
    def key_rows(grid: dict[str, Any]) -> dict[str, Any]:
        """Give each repeated OPEN row a unique name in sheet order (OPEN, OPEN 2, …), since every key is (row, day)."""
        rows = grid.get("rows")
        if not isinstance(rows, list):
            return grid
        taken = {str((r or {}).get("employee") or "").strip() for r in rows if isinstance(r, dict)}
        seen: set[str] = set()
        out = []
        for r in rows:
            if not isinstance(r, dict):
                out.append(r)
                continue
            name = str(r.get("employee") or "").strip()
            if name and house_cal_live.is_open_row(name):
                if name in seen:
                    n = 2
                    while f"{name} {n}" in taken:
                        n += 1
                    fresh = f"{name} {n}"
                    taken.add(fresh)
                    r = {**r, "employee": fresh, "sheet_name": r.get("sheet_name") or name}
                    name = fresh
                seen.add(name)
            out.append(r)
        grid["rows"] = out
        return grid

    @staticmethod
    def house_tokens(src: Any = None) -> set[str]:
        """The short codes the estate uses for its own houses, READ OFF the houses."""
        out: set[str] = set()
        for r in mw_relay_state.rows(house_cal_live.LIVE, columns=("location",)):
            parts = [p.strip() for p in str(r.get("location") or "").split(" - ")]
            if len(parts) >= 2 and parts[1]:
                out.add(parts[1].upper())
        return out

    @staticmethod
    def col_isos(grid: dict[str, Any]) -> list[str]:
        """The column key for every drawn day, in order."""
        out: list[str] = []
        for i, c in enumerate(grid.get("cols", []) or []):
            out.append(str(c.get("iso") or c.get("date") or i))
        return out

    @staticmethod
    def _names_a_house(token: str | None, houses: set[str]) -> bool:
        """Does this token name one of the estate's own houses?"""
        if not token:
            return False
        if not houses:
            return False
        for part in str(token).replace(">", ";").replace("<", ";").split(";"):
            if part.strip().upper() in houses:
                return True
        return False

    @staticmethod
    def day_of(iso: str) -> date | None:
        try:
            y, m, d = (int(p) for p in str(iso).split("-")[:3])
            return date(y, m, d)
        except Exception:  # noqa: BLE001 - a malformed column has no day
            return None

    @staticmethod
    def pending_publishes(src: Any = None, location: str | None = None) -> dict[str, dict[tuple[str, str], str]]:
        return effective_roster.pending_on_mirror(src, location)

    @staticmethod
    def held_publishes(src: Any = None, location: str | None = None) -> dict[str, set[tuple[str, str]]]:
        return effective_roster.held_on_mirror(src, location)

    @staticmethod
    def mirror_publishes(src: Any = None, location: str | None = None) -> dict[str, dict[str, Any]]:
        return effective_roster.on_mirror(src, location)
