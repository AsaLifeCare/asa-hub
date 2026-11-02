"""When each person may be asked something (CommWhen.gs, the comm_when house): the window before their own next shift,
computed by the relay and handed over in passes. Fails by not asking: a missing, stale or unfit window means nobody is
asked, never a guessed hour. While the hand-off is Apps Script's the house is a book whose pointer only Apps Script
holds; once it is Python's (comm_when_writes.py, commWhenIngest) the house lives in Postgres (app/resource_rows.py
`commWhenHouse`). when_rows is commWhenRows_ with commWhenRefusal_'s reason, for the sweeps that ask in the window."""
from __future__ import annotations

import re
from datetime import date
from typing import Any, Callable

import gsjs
import locations as L
import resource_rows as RR

APP_ID = "comm-when"
RESOURCE = "commWhenHouse"
TAB = "comm_when"
# CommWhen.gs COMM_WHEN_HEADER
HEADER = ("id", "createdAt", "updatedAt", "person_key", "name", "state", "window_from", "window_to", "moment_at",
          "shift_at", "only_by_this_rule", "why", "source_at")
# COMM_WHEN_REFUSED: refused on arrival rather than assumed absent — site codes are client addresses, and a second
# contact list is forbidden
REFUSED = ("house", "shift_code", "location_code", "address", "latitude", "longitude", "consumers", "num_consumers",
           "comments", "notes", "note", "shift_raw", "raw", "phone", "email")
INGEST_CAP = 400
# duplicated in the computing module on purpose: a hand-over that moves its own bounds is refused here
MAX_MIN = 30
MIN_MIN = 5
# a stale window would make the platform noisier, so an old row dies
STALE_H = 6
# `window_refused` is written only by the door, never declared by a hand-over
STATES = ("reachable", "held", "spent", "hours_unknown", "no_shift")
# the Script Properties the door stamps, kept in app.comm_when_state (db/comm_when.sql)
STATE = "app.comm_when_state"
FEED_STAMP = "COMM_WHEN_FEED_AT"
FEED_ROWS = "COMM_WHEN_FEED_ROWS"

_WS = re.compile(r"[\s﻿]+")
_INSTANT = re.compile(r"([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})(?:\.([0-9]+))?"
                      r"(?:Z|([+-])([0-9]{2}):?([0-9]{2}))")
_EPOCH = date(1970, 1, 1).toordinal()


def text(v: Any) -> str:
    """commWhenText_: whitespace runs as one space, trimmed; a Date cell is no text."""
    if v is None or isinstance(v, gsjs.SheetDate):
        return ""
    return gsjs.trim(_WS.sub(" ", gsjs.js_str(v)))


def date_ms(t: str) -> float | None:
    """Date.parse of the one shape the house admits, as V8 reads it: a day past its month's end rolls on, 24:00:00 is
    the next midnight, the fraction is cut to milliseconds; None for NaN."""
    m = _INSTANT.fullmatch(t)
    if m is None:
        return None
    y, mo, d, hh, mi, ss = (int(m.group(i)) for i in range(1, 7))
    frac = int(((m.group(7) or "") + "000")[:3])
    if not (1 <= mo <= 12 and 1 <= d <= 31) or mi > 59 or ss > 59 or hh > 24 or (hh == 24 and (mi or ss or frac)):
        return None
    off = 0
    if m.group(8):
        oh, om = int(m.group(9)), int(m.group(10))
        if oh > 23 or om > 59:
            return None
        off = (oh * 60 + om) * (1 if m.group(8) == "+" else -1)
    try:
        days = date(y, mo, 1).toordinal() - _EPOCH + d - 1
    except ValueError:
        return None
    return float((((days * 24 + hh) * 60 + mi) * 60 + ss) * 1000 + frac - off * 60000)


def instant(v: Any) -> str:
    """commWhenInstant_: an ISO instant with its offset, or ''; a Date cell is refused, never converted."""
    t = text(v)
    return t if _INSTANT.fullmatch(t) and date_ms(t) is not None else ""


def ms(v: Any) -> float:
    """commWhenMs_: 0 means "no time in this cell"; no caller may read it as an instant."""
    t = instant(v)
    return (date_ms(t) or 0.0) if t else 0.0


def truthy(v: Any) -> bool:
    """commWhenTruthy_."""
    return v is True or text(v).lower() in ("yes", "true", "y", "1")


def fits(from_ms: float, to_ms: float, shift_ms: float) -> bool:
    """commWhenFits_: checked on arrival and again on every read."""
    if not from_ms or not to_ms or not shift_ms:
        return False
    if to_ms <= from_ms:
        return False
    return from_ms >= shift_ms - MAX_MIN * 60000 and to_ms <= shift_ms - MIN_MIN * 60000


def key(v: Any) -> str:
    """commWhenKey_: the same flattening the computation used (clientNameKey_)."""
    raw = text(v)
    return gsjs.name_key(raw) if raw else ""


def js_slice(s: str, n: int) -> str:
    """String.prototype.slice(0, n), in UTF-16 units; a pair it cuts through ends in U+FFFD."""
    return s.encode("utf-16-le", "surrogatepass")[:2 * n].decode("utf-16-le", "replace")


def crossed(rows: list[Any]) -> list[str]:
    """commWhenCrossed_: the refused columns any row carries — names only, the values are never copied anywhere."""
    hit: list[str] = []
    for r in rows or []:
        if not isinstance(r, dict):
            continue
        hit += [name for name in REFUSED if name not in hit and name in r]
    return hit


def clean(r: Any, at: Any) -> dict[str, str] | None:
    """commWhenClean_: one row as the house keeps it; None for an unknown state, which would match no test anywhere.
    A window that does not fit is emptied and the row still lands: dropping it would lose a hold."""
    row = r if isinstance(r, dict) else {}
    who = key(row.get("person_key"))
    state = text(row.get("state")).lower()
    if not who or state not in STATES:
        return None
    frm, to, shift, moment = (instant(row.get(k)) for k in ("window_from", "window_to", "shift_at", "moment_at"))
    claimed = bool(frm or to or shift)
    if not fits(ms(frm), ms(to), ms(shift)):
        frm = to = shift = moment = ""
        if claimed and state == "reachable":
            state = "window_refused"
    return {"id": "CW_" + js_slice(who, 40), "person_key": who, "name": js_slice(text(row.get("name")), 120),
            "state": state, "window_from": frm, "window_to": to, "moment_at": moment, "shift_at": shift,
            "only_by_this_rule": "yes" if truthy(row.get("only_by_this_rule")) else "",
            "why": js_slice(text(row.get("why")), 300), "source_at": js_slice(text(at), 40)}


def kept(reads: L.Reads) -> bool:
    """The house is Postgres' (uploaded on the flip, not handed back since)."""
    return reads.once("comm_when_kept", lambda: RR.uploaded(reads.db, RESOURCE))


def sheet_rows(reads: L.Reads) -> tuple[list[str], list[dict[str, Any]]] | None:
    """commWhenSheetRows_: the header and every row with anything in it, header-keyed, the cells as the house holds
    them (written as text); None when the house did not answer."""
    if kept(reads):
        header = RR.columns(reads, RESOURCE)
        lines = [[c.get(h) for h in header] for _k, c in RR.table_rows(reads, RESOURCE)]
    else:
        res = reads.db.resolve(TAB)
        if res.runtime or res.ref is None:
            return None
        header = [gsjs.js_str(h) for h in res.ref.headers]
        lines = [[raw.get(h) for h in res.ref.headers] for _rn, raw in reads.db.rows(res.ref)]
    rows = [{h: v for h, v in zip(header, line) if h != ""} for line in lines
            if any(v != "" and v is not None for v in line)]
    return header, rows


def when_rows(reads: L.Reads) -> tuple[list[dict[str, Any]] | None, str]:
    """commWhenRows_ and commWhenRefusal_: (rows, '') when the house answered — [] holds nobody — or (None, why) when
    it did not and nobody may be asked. Every row thrown away is a refusal, never "nobody is reachable"."""
    def read() -> tuple[list[dict[str, Any]] | None, str]:
        got = sheet_rows(reads)
        if got is None:
            return None, (f"the {TAB} house did not answer — it may not be minted (tools/mint_comm_when_house.py) or "
                          "its pointer may be unset")
        header, rows = got
        if not header or "person_key" not in header:
            return None, f"the {TAB} house has no readable header"
        if not rows:
            return None, f"the {TAB} house is empty — the relay has never handed a window over"
        now = reads.now.timestamp() * 1000.0
        out: list[dict[str, Any]] = []
        stale = unfit = 0
        for r in rows:
            who = key(r.get("person_key"))
            if not who:
                continue
            src = ms(r.get("source_at"))
            if not src or now - src > STALE_H * 3600000:
                stale += 1
                continue
            state = text(r.get("state")).lower()
            frm, to, shift = instant(r.get("window_from")), instant(r.get("window_to")), instant(r.get("shift_at"))
            if state == "reachable" and not fits(ms(frm), ms(to), ms(shift)):
                unfit += 1
                continue
            out.append({"person_key": who, "name": text(r.get("name")), "state": state, "window_from": frm,
                        "window_to": to, "moment_at": instant(r.get("moment_at")), "shift_at": shift,
                        "only_by_this_rule": truthy(r.get("only_by_this_rule")), "why": text(r.get("why"))})
        if not out and (stale or unfit):
            return None, ((f"{stale} row(s) not refreshed in {STALE_H}h — the feed has stopped" if stale else "")
                          + ("; " if stale and unfit else "")
                          + (f"{unfit} row(s) claim a window that does not sit before their own shift" if unfit else "")
                          + f" ({TAB})")
        return out, ""
    return reads.once("comm_when_rows", read)


def feed_state(reads: L.Reads) -> dict[str, str]:
    """The door's stamps (COMM_WHEN_FEED_AT, COMM_WHEN_FEED_ROWS), from their table."""
    return {gsjs.str_(k): gsjs.or_blank(v) for k, v in RR._q(reads, f"select key, value from {STATE}")}


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {}
POLICY: dict[str, dict[str, Any]] = {}
