"""Time Reconciliation's pure part (apps-script/Recon.gs): the clock and calendar-cell grammar, and the five detectors a
run finds its errors with — punches against the planned roster, nothing read or written here."""
from __future__ import annotations

import math
import re
from datetime import date, datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal
from typing import Any

import gsjs
import names as N
from psi_periods import NEW_YORK

# RECON_NOT_WORKING, RECON_NOT_STAFF
NOT_WORKING = frozenset({"OFF", "R/O", "C/O", "RO", "R\\O", "R/0", "NCNS", "NO WORKSHOP"})
NOT_STAFF = frozenset({"OPEN", "NONE", "WORKSHOP"})
NOT_FOUND = "Not Found"
# A run judges only what should already be over by the moment it is judged at (`now`: the day it covers may be today,
# still in progress). A shift is judged once it has been over SETTLE_MIN — PsiAnywhere's entries are written and
# corrected after the fact, as psi_attendance's ENTRY_GRACE_MIN allows them —; an entry with no clock-out begun less
# than ON_CLOCK_MIN before is a person still on the clock (a double runs 16 h): never a missing end, and its minutes
# up to `now` cover their shift. Without them every run of the current period called each shift not started yet, and
# each one still running (its entry open, covering nothing), missing, and each person clocked in a missing end.
SETTLE_MIN = 60
ON_CLOCK_MIN = 16 * 60
# RECON_T, RECON_T1, RECON_RANGE_RE
_T = r"([0-9]{1,2})(?::?([0-9]{2}))?\s*([AP])M?"
_T1 = r"([0-9]{1,2})(?::?([0-9]{2}))?\s*([AP])?M?"
_RANGE = re.compile(r"^\*?\s*" + _T1 + r"\s*[-–]\s*" + _T + r"(?:\s+[A-Za-z]{1,4})?\s*$", re.IGNORECASE)
_CHAIN = re.compile(r"\s*[><]\s*")
_HMS_AP = re.compile(r"^([0-9]{1,2}):([0-9]{2}):([0-9]{2})\s*(AM|PM)$", re.IGNORECASE)
_HM_AP = re.compile(r"^([0-9]{1,2}):([0-9]{2})\s*(AM|PM)$", re.IGNORECASE)
_HM = re.compile(r"^([0-9]{1,2}):([0-9]{2})$")
_ISO_DAY = re.compile(r"^([0-9]{4})-([0-9]{2})-([0-9]{2})")
_US_DAY = re.compile(r"^([0-9]{1,2})/([0-9]{1,2})/([0-9]{4})$")
_INDEX_KEY = re.compile(r"^(?:0|[1-9][0-9]*)$")

s_ = gsjs.str_


def pad2(n: int) -> str:
    """reconPad2_."""
    return "0" + str(n) if n < 10 else str(n)


def to_fixed(x: float, digits: int = 1) -> str:
    """Number.prototype.toFixed: the exact value rounded, a tie away from zero."""
    return str(Decimal(x).quantize(Decimal(1).scaleb(-digits), rounding=ROUND_HALF_UP))


def round2(x: float) -> float:
    """Math.round(x * 100) / 100."""
    return gsjs.js_round(x * 100) / 100


def num(x: float) -> float | int:
    """A number as JSON.stringify writes it."""
    return int(x) if isinstance(x, float) and math.isfinite(x) and x == int(x) else x


def js_keys(d: dict) -> list:
    """A plain object's for-in order: the array-index keys ascending, then the rest as they were made."""
    idx = [k for k in d if isinstance(k, str) and _INDEX_KEY.match(k) and int(k) < 4294967295]
    return sorted(idx, key=int) + [k for k in d if k not in set(idx)]


def min_to_time(m: Any) -> str:
    """reconMinToTime_: minutes from midnight → 'h:mm AM'; past 1440 wraps."""
    if m is None or (isinstance(m, float) and math.isnan(m)):
        return ""
    v = ((int(gsjs.js_round(m)) % 1440) + 1440) % 1440
    h = v // 60
    ap = "PM" if h >= 12 else "AM"
    h = h % 12 or 12
    return f"{h}:{pad2(v % 60)} {ap}"


def parse_time_min(v: Any) -> int | None:
    """reconParseTimeMin_: 'h:mm:ss AM' | 'h:mm AM' | 'HH:MM' → minutes from midnight, or None."""
    ts = gsjs.trim(gsjs.or_blank(v))
    if not ts:
        return None
    sec = 0
    m = _HMS_AP.match(ts)
    if m:
        h, mi, sec, p = int(m.group(1)), int(m.group(2)), int(m.group(3)), m.group(4).upper()
    else:
        m = _HM_AP.match(ts)
        if m:
            h, mi, p = int(m.group(1)), int(m.group(2)), m.group(3).upper()
        else:
            m = _HM.match(ts)
            if not m:
                return None
            h, mi, p = int(m.group(1)), int(m.group(2)), ""
    if p == "PM" and h != 12:
        h += 12
    if p == "AM" and h == 12:
        h = 0
    if h > 24 or mi > 59:
        return None
    return h * 60 + mi + int(gsjs.js_round(sec / 60))


def js_date(y: int, m0: int, d: int) -> date | None:
    """new Date(y, m0, d): a month or a day past its end rolls over, as the constructor does."""
    try:
        y, m0 = y + m0 // 12, m0 % 12
        return date(y, m0 + 1, 1) + timedelta(days=d - 1)
    except (ValueError, OverflowError):
        return None


def parse_date(v: Any) -> date | None:
    """reconParseDate_: a day as it is, 'yyyy-MM-dd…' or 'M/d/yyyy' → that day; anything else None."""
    if isinstance(v, date):
        return v
    s = gsjs.trim(gsjs.or_blank(v))
    m = _ISO_DAY.match(s)
    if m:
        return js_date(int(m.group(1)), int(m.group(2)) - 1, int(m.group(3)))
    m = _US_DAY.match(s)
    if m:
        return js_date(int(m.group(3)), int(m.group(1)) - 1, int(m.group(2)))
    return None


def overnight(start: Any, end: Any) -> Any:
    """reconOvernight_: an end at or before its start crosses midnight."""
    return end + 1440 if end is not None and start is not None and end <= start else end


def parse_range(segment: Any) -> tuple[int, int] | None:
    """reconParseRange_: one segment → (startMin, endMin), the end past 1440 when overnight."""
    m = _RANGE.match(gsjs.trim(gsjs.or_text(segment)))
    if not m:
        return None
    h1, m1 = int(m.group(1)), int(m.group(2)) if m.group(2) else 0
    h2, m2 = int(m.group(4)), int(m.group(5)) if m.group(5) else 0
    ap1 = (m.group(3) or m.group(6) or "").upper()
    ap2 = (m.group(6) or "").upper()
    start = (h1 % 12) + (12 if ap1 == "P" else 0) + m1 / 60
    end = (h2 % 12) + (12 if ap2 == "P" else 0) + m2 / 60
    if not m.group(3) and start >= end:
        start = (start - 12) % 24
    if end <= start:
        end += 24
    return int(gsjs.js_round(start * 60)), int(gsjs.js_round(end * 60))


def classify_cell(raw: Any) -> dict[str, Any] | None:
    """reconClassifyCell_: None (blank) | off | ro | hours (start, end, token) | alias (token)."""
    code = gsjs.trim(gsjs.or_blank(raw))
    if not code:
        return None
    upper = code.upper()
    if upper in NOT_WORKING:
        return {"kind": "off" if upper == "OFF" else "ro", "token": ""}
    got: tuple[int, int] | None = None
    token = ""
    for seg in _CHAIN.split(code):
        seg = gsjs.trim(seg)
        if not seg or seg.upper() in NOT_WORKING:
            continue
        r = parse_range(seg)
        if r and not got:
            got = r
            continue
        if not r and not token:
            token = seg
    if got:
        return {"kind": "hours", "startMin": got[0], "endMin": got[1], "token": token}
    return {"kind": "alias", "token": token or code}


def punch_for_detect(row: dict) -> dict[str, Any]:
    """reconPunchForDetect_: a stored punch in the detectors' shape."""
    raw = s_(row.get("employeeRaw"))
    hours = gsjs_number(row.get("totalHours"))
    return {"date": s_(row.get("date")),
            "matchKey": s_(row.get("employeeId")) or "name:" + " ".join(N.tokens(raw)["core"]),
            "employeeId": s_(row.get("employeeId")), "employeeName": s_(row.get("employeeName")) or raw,
            "location": s_(row.get("location")), "startMin": parse_time_min(row.get("start")),
            "endMin": parse_time_min(row.get("end")), "startTime": s_(row.get("start")),
            "endTime": s_(row.get("end")), "consumers": s_(row.get("consumers")),
            "hours": hours if hours == hours else 0}


def gsjs_number(v: Any) -> float:
    """Number(v)."""
    if v is None:
        return 0.0
    if isinstance(v, bool):
        return 1.0 if v else 0.0
    if isinstance(v, (int, float)):
        return float(v)
    t = gsjs.trim(gsjs.js_str(v))
    if not t:
        return 0.0
    if re.fullmatch(r"[+-]?(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][+-]?[0-9]+)?", t):
        return float(t)
    return math.nan


# ---- the five detectors --------------------------------------------------------------------------------------------

def err(kind: str, day: str, location: str, src: dict, fields: dict | None = None) -> dict[str, Any]:
    """reconErr_."""
    e = {"type": kind, "date": day, "location": location, "employeeId": src.get("employeeId") or "",
         "employeeName": src.get("employeeName") or "", "consumers": src.get("consumers") or "",
         "startTime": src.get("startTime") or "", "endTime": src.get("endTime") or "",
         "hours": src.get("hours") or 0, "detail": src.get("detail") or ""}
    e.update(fields or {})
    return e


def span(p: dict) -> tuple[int, int] | None:
    """A punch's [start, end) in minutes from its day's midnight (past 1440 when overnight); None while it is open."""
    if p.get("startMin") is None or p.get("endMin") is None:
        return None
    return p["startMin"], overnight(p["startMin"], p["endMin"])


def minute_of(day: Any, minute: int | None) -> int | None:
    """A moment as one count of minutes: the day's ordinal × 1440 plus its minute (past 1440 runs into the next day),
    so moments on different days compare; None without a day or a minute."""
    d = parse_date(day)
    return None if d is None or minute is None else d.toordinal() * 1440 + minute


def now_minute(now: datetime | None) -> int | None:
    """The moment a run judges at, counted as minute_of counts: New York's wall clock (a naive time is New York's)."""
    if now is None:
        return None
    local = now.astimezone(NEW_YORK) if now.tzinfo is not None else now
    return local.date().toordinal() * 1440 + local.hour * 60 + local.minute


def on_clock(p: dict, at: int | None) -> bool:
    """An entry with no clock-out begun less than ON_CLOCK_MIN before `at`: its person is still on the clock."""
    if at is None or p.get("endMin") is not None:
        return False
    began = minute_of(p.get("date"), p.get("startMin"))
    return began is not None and at - began < ON_CLOCK_MIN


def doubled_minutes(spans: list[tuple[int, int]]) -> int:
    """The minutes two or more of these spans cover at once (a span ending where another starts shares none)."""
    events = sorted([(a, 1) for a, _b in spans] + [(b, -1) for _a, b in spans])
    total, depth, at = 0, 0, None
    for t, delta in events:
        if depth >= 2 and at is not None:
            total += t - at
        depth += delta
        at = t
    return total


def _joined_consumers(ps: list[dict]) -> str:
    return ", ".join(dict.fromkeys(gsjs.trim(c) for p in ps for c in s_(p.get("consumers")).split(",") if gsjs.trim(c)))


def detect_dupes(punches: list[dict]) -> list[dict]:
    """reconDetectDupes_, one card per cluster: a person's punches of one day joined while any two of them overlap (or
    repeat each other), so n copies of one punch are ONE card, never the n(n-1)/2 pairs the sheet era counted. The card
    stands at its earliest punch's place, from the earliest start to the latest end; its hours are the minutes the
    punches doubled; its detail names every punch of the cluster."""
    groups: dict[tuple, list[int]] = {}
    for i, p in enumerate(punches):
        if span(p) is not None:
            groups.setdefault((p["date"], p["matchKey"]), []).append(i)
    out = []
    for idx in groups.values():
        if len(idx) < 2:
            continue
        parent = {i: i for i in idx}

        def root(i: int) -> int:
            while parent[i] != i:
                parent[i] = parent[parent[i]]
                i = parent[i]
            return i

        for n, i in enumerate(idx):
            sa, ea = span(punches[i])
            for j in idx[n + 1:]:
                sb, eb = span(punches[j])
                if (sa < eb and sb < ea) or (sa == sb and ea == eb):
                    a, b = root(i), root(j)
                    if a != b:
                        parent[max(a, b)] = min(a, b)
        clusters: dict[int, list[int]] = {}
        for i in idx:
            clusters.setdefault(root(i), []).append(i)
        for members in clusters.values():
            if len(members) < 2:
                continue
            ps = sorted((punches[i] for i in members), key=lambda p: span(p))
            first, last = ps[0], max(ps, key=lambda p: span(p)[1])
            spans = [span(p) for p in ps]
            out.append(err("dupe", first["date"], first["location"], first, {
                "endTime": last["endTime"], "consumers": _joined_consumers(ps),
                "hours": num(round2(doubled_minutes(spans) / 60)),
                "detail": "Overlapping entries: " + "; ".join(
                    f"{min_to_time(a)}–{min_to_time(b)} at {p['location']}" for p, (a, b) in zip(ps, spans))}))
    return out


def detect_no_end(punches: list[dict], now: datetime | None = None) -> list[dict]:
    """reconDetectNoEnd_: punches with no clock-out — but, judged at `now`, never one whose person is still on the
    clock (on_clock)."""
    at = now_minute(now)
    return [err("noEnd", p["date"], p["location"], p, {"endTime": "", "detail": "Missing end time"})
            for p in punches if p["endMin"] is None and not on_clock(p, at)]


def detect_missing(punches: list[dict], shifts: list[dict], cfg: dict, now: datetime | None = None) -> list[dict]:
    """reconDetectMissing_: a scheduled shift whose punch coverage is under cfg.missingCoveragePct. A shift is judged
    only on a day PsiAnywhere has entries for (a punch at a real house that day: a day of General Admin alone, or one
    not read yet, holds no verdict) and at a house that appears in the run (a punch there on any of its days: a house
    PsiAnywhere does not name is never all missing). Judged at `now`, only a shift over SETTLE_MIN before it (one not
    started yet, still running or just ended has no verdict), and an entry still on the clock covers its minutes up to
    `now`. Where the same person punched at another house over the shift, the detail says so (two at most)."""
    at = now_minute(now)
    real = [p for p in punches if p["date"] and p["location"] and p["location"] != NOT_FOUND]
    days = {p["date"] for p in real}
    places = {p["location"] for p in real}
    by: dict[tuple, list[dict]] = {}
    by_person: dict[tuple, list[dict]] = {}
    for p in punches:
        by.setdefault((p["matchKey"], p["date"], p["location"]), []).append(p)
    for p in real:
        if span(p) is not None:
            by_person.setdefault((p["matchKey"], p["date"]), []).append(p)
    out = []
    for s in shifts:
        if s["date"] not in days or s["location"] not in places:
            continue
        start, end = s["startMin"], overnight(s["startMin"], s["endMin"])
        scheduled = end - start
        if scheduled <= 0:
            continue
        over = minute_of(s["date"], end)
        if at is not None and (over is None or at - over < SETTLE_MIN):
            continue
        # `now` as minutes from the shift's own midnight: how far an entry still on the clock has run
        now_here = at - over + end if at is not None and over is not None else None
        covered = 0
        for p in by.get((s["matchKey"], s["date"], s["location"]), ()):
            if p["startMin"] is None:
                continue
            if p["endMin"] is not None:
                upto = overnight(p["startMin"], p["endMin"])
            elif on_clock(p, at) and now_here is not None:
                upto = now_here
            else:
                continue
            got = min(end, upto) - max(start, p["startMin"])
            if got > 0:
                covered += got
        if covered / scheduled * 100 < cfg["missingCoveragePct"]:
            hrs = round2((scheduled - covered) / 60)
            detail = f"Scheduled {s['startTime']}-{s['endTime']} ({to_fixed(hrs)}h missing)"
            away = sorted((span(p) + (p["location"],) for p in by_person.get((s["matchKey"], s["date"]), ())
                           if p["location"] != s["location"] and span(p)[0] < end and start < span(p)[1]))
            for a, b, house in away[:2]:
                detail += f" · punched at {house} {min_to_time(a)}–{min_to_time(b)}"
            out.append(err("missing", s["date"], s["location"], s, {"hours": num(hrs), "detail": detail}))
    return out


def detect_gaps(punches: list[dict], shifts: list[dict], missing: list[dict], cfg: dict) -> tuple[list, list]:
    """reconDetectGaps_: a consumer without staff past cfg.gapMin; a gap beside a missing shift is folded into it.
    Each consumer's spans are read day by day in order of start, each against the furthest end reached that day so far
    (sorting by the minute alone mixed the days of a run, and no gap was ever found over more than one day)."""
    by: dict[str, list[dict]] = {}
    for p in punches:
        if not p["consumers"] or p["startMin"] is None or p["endMin"] is None or p["location"] == NOT_FOUND:
            continue
        for con in p["consumers"].split(","):
            con = gsjs.trim(con)
            if con:
                by.setdefault(con, []).append({"date": p["date"], "location": p["location"], "start": p["startMin"],
                                               "end": overnight(p["startMin"], p["endMin"])})
    linked_of: dict[str, list[str]] = {}
    for m in missing or ():
        linked_of.setdefault(m["date"] + "|" + m["location"], []).append(m["employeeName"])
    gaps, folded = [], []
    for consumer in js_keys(by):
        cur: dict | None = None
        for nxt in sorted(by[consumer], key=lambda x: (x["date"], x["start"])):
            if cur is None or nxt["date"] != cur["date"]:
                cur = nxt
                continue
            gap = nxt["start"] - cur["end"]
            if gap <= cfg["gapMin"]:
                if nxt["end"] > cur["end"]:
                    cur = nxt
                continue
            hrs = round2(gap / 60)
            g0, g1 = cur["end"], nxt["start"]
            who, who_id, best = "", "", 0.0
            for sh in shifts:
                if sh["date"] != cur["date"] or sh["location"] != cur["location"]:
                    continue
                ov = min(g1, overnight(sh["startMin"], sh["endMin"])) - max(g0, sh["startMin"])
                if ov <= 0:
                    continue
                pct = ov / gap
                if pct >= 0.70 and pct > best:
                    best, who, who_id = pct, sh["employeeName"], sh["employeeId"]
            linked = linked_of.get(cur["date"] + "|" + cur["location"]) or []
            entry = err("gap", cur["date"], cur["location"], {
                "employeeId": who_id, "employeeName": who or consumer + " (consumer)", "consumers": consumer,
                "startTime": min_to_time(g0), "endTime": min_to_time(g1), "hours": num(hrs)}, {})
            parts = [to_fixed(hrs) + "h gap in coverage"]
            if who:
                parts.append("attributed: " + who)
            if linked:
                parts.append("missing shift: " + ", ".join(linked))
            entry["detail"] = " · ".join(parts)
            (folded if linked else gaps).append(entry)
            # past a gap, the next span starts after the furthest end: it reaches further still
            cur = nxt
    notes: dict[str, list[str]] = {}
    for g in folded:
        notes.setdefault(g["date"] + "|" + g["location"], []).append(
            gsjs.num_str(g["hours"]) + "h gap (" + g["consumers"] + ")")
    for m in missing or ():
        got = notes.get(m["date"] + "|" + m["location"])
        if got:
            m["detail"] += " · consumer gaps: " + ", ".join(got)
    return gaps, folded


def _rostered(shifts: list[dict] | None) -> dict[tuple, list[tuple[str, int, int]]]:
    """The roster by (day, house): each shift's person and [start, end)."""
    out: dict[tuple, list[tuple[str, int, int]]] = {}
    for s in shifts or ():
        if s.get("startMin") is None or s.get("endMin") is None:
            continue
        out.setdefault((s["date"], s["location"]), []).append(
            (s["matchKey"], s["startMin"], overnight(s["startMin"], s["endMin"])))
    return out


def detect_overlaps(punches: list[dict], cfg: dict, shifts: list[dict] | None = None) -> tuple[list[dict], int]:
    """reconDetectOverlaps_: more staff on one consumer than the roster planned, past cfg.overlapMin — a sweep over
    each consumer's day. A stretch with two or more staff on the consumer at once holds k of them at its peak; the
    roster expects as many as the distinct people it schedules at that house that day over the stretch (one at least,
    and one with no roster given), so a planned 2:1 is not double coverage. Only k past that is an overlap; a stretch
    within the plan or within cfg.overlapMin is counted in `suppressed`."""
    groups: dict[str, dict] = {}
    for p in punches:
        if not p["consumers"] or p["startMin"] is None or p["endMin"] is None:
            continue
        for con in p["consumers"].split(","):
            con = gsjs.trim(con)
            if not con:
                continue
            g = groups.setdefault(con + "|" + p["date"], {"consumer": con, "date": p["date"], "location": p["location"],
                                                          "entries": []})
            g["entries"].append({"name": p["employeeName"], "start": p["startMin"],
                                 "end": overnight(p["startMin"], p["endMin"])})
    roster = _rostered(shifts)
    out: list[dict] = []
    suppressed = 0
    for k in js_keys(groups):
        group = groups[k]
        if len(group["entries"]) < 2:
            continue
        planned = roster.get((group["date"], group["location"]), [])
        # each moment's events at once: the ends first, so staff handing over on the minute are never two
        events = sorted([(e["start"], 1, e["name"]) for e in group["entries"]] +
                        [(e["end"], -1, e["name"]) for e in group["entries"]], key=lambda x: (x[0], x[1]))
        active: dict[str, int] = {}
        start: Any = None
        peak, emps = 0, set()
        n = 0
        while n < len(events):
            t = events[n][0]
            while n < len(events) and events[n][0] == t:
                _t, delta, emp = events[n]
                active[emp] = active.get(emp, 0) + delta
                if active[emp] <= 0:
                    del active[emp]
                n += 1
            if len(active) > 1:
                if start is None:
                    start, peak, emps = t, 0, set()
                peak = max(peak, len(active))
                emps |= set(active)
                continue
            if start is None:
                continue
            dur = t - start
            expected = max(1, len({who for who, a, b in planned if a < t and start < b}))
            if dur > cfg["overlapMin"] and peak > expected:
                out.append(err("overlap", group["date"], group["location"], {
                    "employeeName": ", ".join(sorted(emps)), "consumers": group["consumer"],
                    "startTime": min_to_time(start), "endTime": min_to_time(t), "hours": num(round2(dur / 60))}, {
                    "detail": f"{to_fixed(dur / 60)}h overstaffed ({peak} employees vs {expected} scheduled) "
                              f"{min_to_time(start)} – {min_to_time(t)}"}))
            elif dur > 0:
                suppressed += 1
            start = None
    return out, suppressed


def detect_all(punches: list[dict], shifts: list[dict], cfg: dict, now: datetime | None = None) -> dict[str, Any]:
    """reconDetectAll_: the five classes over one punch set and one roster (the overlaps weighed against it too), the
    missing shifts and the missing ends judged at `now` (None: every one, as of old)."""
    dupe = detect_dupes(punches)
    no_end = detect_no_end(punches, now)
    missing = detect_missing(punches, shifts, cfg, now)
    gaps, folded = detect_gaps(punches, shifts, missing, cfg)
    overlaps, quiet = detect_overlaps(punches, cfg, shifts)
    return {"missing": missing, "noEnd": no_end, "dupe": dupe, "gap": gaps, "overlap": overlaps,
            "suppressed": len(folded) + quiet}
