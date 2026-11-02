"""Support Requests Queue's writes (Requests.gs requestSubmit / requestResolve), kept in app.edits as the truth and
carried to the Hub's `staff_requests` tab by the two-way sync: a request filed for a person on the roster (its dates
read when it is a time off, never guessed), and a verdict given once."""
from __future__ import annotations

import re
import uuid
from datetime import date
from typing import Any, Callable

import gsjs
import locations as L
import staff as SP
import support_requests as SR
import writes as W
from gsjs import NY
from scope import Defer
from writes import Decision

TYPE_TIME_OFF = "Schedule - Time Off Request"
VERDICTS = ("approved", "denied", "resolved")
URGENCIES = ("high", "mid", "low")
NON_PEOPLE = ("OPEN", "WORKSHOP", "FAMILY", "NURSE", "LOCATION", "NEW")
MONTHS = {m: i for i, m in enumerate(("jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov",
                                      "dec"))}
BUSY = "Somebody else is changing this queue right now — try again."

s_ = gsjs.str_


# ---- the dates of a request (requestsParseDates_) -----------------------------------------------------------------

def _valid(y: int, mo: int, d: int) -> bool:
    try:
        date(y, mo + 1, d)
        return mo >= 0 and d >= 1
    except ValueError:
        return False


def calendar_name(full: Any) -> str:
    """requestsCalendarName_: the vacation calendar's short name, 'FIRST L'."""
    parts = [p for p in re.split(r"[\s,]+", s_(full).strip()) if p]
    if not parts:
        return ""
    first = parts[0].upper()
    return first if len(parts) <= 1 else first + " " + parts[-1][0].upper()


def _tokens(s: str) -> list[dict]:
    found: list[dict] = []

    def push(at: int, raw: str, y: int | None, mo: int, d: int, two: bool = False) -> None:
        found.append({"at": at, "end": at + len(raw), "raw": raw, "y": y, "mo": mo, "d": d, "two": two})
    for m in re.finditer(r"(\d{4})-(\d{1,2})-(\d{1,2})", s):
        push(m.start(), m[0], int(m[1]), int(m[2]) - 1, int(m[3]))
    for m in re.finditer(r"\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?"
                         r"(?:\s*,?\s*(\d{4}))?\b", s, re.I):
        push(m.start(), m[0], int(m[3]) if m[3] else None, MONTHS[m[1][:3].lower()], int(m[2]))
    for m in re.finditer(r"\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)"
                         r"[a-z]*\.?(?:\s*,?\s*(\d{4}))?\b", s, re.I):
        push(m.start(), m[0], int(m[3]) if m[3] else None, MONTHS[m[2][:3].lower()], int(m[1]))
    for m in re.finditer(r"\b(\d{1,2})/(\d{1,2})(?:/(\d{2,4}))?\b", s):
        y, two = None, False
        if m[3]:
            if len(m[3]) == 3:
                continue
            y = int(m[3])
            if len(m[3]) == 2:
                y, two = 2000 + y, True
        push(m.start(), m[0], y, int(m[1]) - 1, int(m[2]), two)
    found.sort(key=lambda t: (t["at"], -t["end"]))
    out, last = [], -1
    for t in found:
        if t["at"] < last:
            continue
        out.append(t)
        last = t["end"]
    return out


def parse_dates(text: Any, today: date) -> dict[str, Any]:
    """requestsParseDates_: one start and one end read from the words, no year guessed silently, a reversed range
    refused, never reordered."""
    s = re.sub(r"\s+", " ", s_(text)).strip()
    quote = s[:90] + "..." if len(s) > 90 else s
    if not s:
        return {"error": "There is no text to read dates from."}
    toks = _tokens(s)
    if len(toks) == 1:
        rest = s[toks[0]["end"]:]
        cont = re.match(r"^\s*(?:to|through|thru|until|till|and|[-–—])\s*(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)?\b"
                        r"(?!\s*(?:day|week|hour|month|year)s?\b)", rest, re.I)
        if cont:
            end_day = int(cont[1])
            if end_day <= toks[0]["d"]:
                return {"error": f'The range in "{quote}" reads as ending on day {end_day}, before it starts '
                                 f'({toks[0]["raw"]}) — write both dates in full.'}
            toks.append({"at": toks[0]["end"], "end": toks[0]["end"], "y": toks[0]["y"], "mo": toks[0]["mo"],
                         "d": end_day, "two": toks[0]["two"],
                         "raw": f'"{cont[1]}" (read against {toks[0]["raw"]})'})
    if not toks:
        if re.search(r"\b\d{1,2}(st|nd|rd|th)\b", s, re.I):
            return {"error": f'"{quote}" names a day but never a month — the month has to be written, because '
                             "guessing it was the old parser's favourite mistake."}
        return {"error": f'No calendar date could be read in "{quote}" — a real date is needed (for example: March 25 '
                         "to March 27)."}
    if len(toks) > 2:
        return {"error": f'{len(toks)} dates were read in "{quote}" — a request needs one start and one end, and which '
                         "two those are was not guessed."}
    assumed: list[str] = []

    def resolve(tok: dict, not_before: date) -> dict[str, Any]:
        if tok["y"] is not None:
            if not _valid(tok["y"], tok["mo"], tok["d"]):
                return {"error": f'"{tok["raw"]}" is not a real calendar day.'}
            if tok["two"]:
                assumed.append(f"the two-digit year in {tok['raw']} was read as {tok['y']}")
            return {"d": date(tok["y"], tok["mo"] + 1, tok["d"])}
        for y in range(not_before.year, not_before.year + 9):
            if not _valid(y, tok["mo"], tok["d"]):
                continue
            d = date(y, tok["mo"] + 1, tok["d"])
            if d >= not_before:
                assumed.append(f"no year written in {tok['raw']} — read as {d.isoformat()}, the next such day")
                return {"d": d}
        return {"error": f'"{tok["raw"]}" never lands on a real calendar day.'}

    t_from, t_to = toks[0], (toks[1] if len(toks) == 2 else None)
    if t_from["y"] is None and t_to and t_to["y"] is not None:
        if not _valid(t_to["y"], t_from["mo"], t_from["d"]):
            return {"error": f'"{t_from["raw"]}" is not a real calendar day in {t_to["y"]}.'}
        frm = {"d": date(t_to["y"], t_from["mo"] + 1, t_from["d"])}
        assumed.append(f"the start's year was taken from the end date ({t_to['y']})")
    else:
        frm = resolve(t_from, today)
    if "error" in frm:
        return frm
    to = resolve(t_to, frm["d"]) if t_to else {"d": frm["d"]}
    if "error" in to:
        return to
    if to["d"] < frm["d"]:
        return {"error": f'The range in "{quote}" ends ({to["d"].isoformat()}) before it starts '
                         f'({frm["d"].isoformat()}).'}
    days = (to["d"] - frm["d"]).days + 1
    if t_to and t_to["y"] is None and to["d"].year > frm["d"].year and days > 45:
        return {"error": f'Read literally, "{quote}" would be {days} days ending in the following year — more likely a '
                         "reversed range than a vacation. Write the years out."}
    if days > 370:
        return {"error": f'"{quote}" spans {days} days ({frm["d"].isoformat()} to {to["d"].isoformat()}) — more likely '
                         "a misread year than time off."}
    return {"from": frm["d"].isoformat(), "to": to["d"].isoformat(), "days": days, "assumed": "; ".join(assumed)}


# ---- the person and the tab ----------------------------------------------------------------------------------------

def person(reads: L.Reads, person_id: str) -> dict[str, Any]:
    """requestsPerson_: by roster id, never a loose name; an empty roster is a broken read, not an empty staff."""
    if not person_id:
        return {"error": W.refuse(400, "A personId (roster) is required — never a loose name.")}
    try:
        people = SP.without_isp_clients(reads, SP.people_merged(reads, SP._people(reads)))
    except Exception as exc:  # noqa: BLE001 - who is asking cannot be resolved
        return {"error": W.refuse(503, f"The people roster could not be read ({type(exc).__name__}) — who is asking "
                                       "cannot be resolved, so nothing was recorded.")}
    if not people:
        return {"error": W.refuse(503, "The people roster answered with nobody at all — that is a broken read, not "
                                       "proof this person does not exist. Nothing was recorded.")}
    hit = next((p for p in people if s_(p.get("id")) == person_id), None)
    if hit is None:
        return {"error": W.refuse(404, f'No person "{person_id}" in the roster.')}
    name = s_(hit.get("name"))
    up = name.upper()
    if up in NON_PEOPLE or "WORKSHOP" in up:
        return {"error": W.refuse(422, f'"{name}" is a roster label, not a person — a request cannot be filed for it.')}
    return {"person": {"id": s_(hit.get("id")), "name": name, "phone": s_(hit.get("phone")),
                       "email": s_(hit.get("email"))}}


def _where(reads: L.Reads) -> tuple[str, str, tuple]:
    res = SR.where(reads)
    if res.ref is None:
        raise Defer(f"the copy holds no {SR.TAB} tab: Apps Script makes it on its first request")
    sid, tab = W.where_of(res)
    return sid, tab, res.ref.headers


# ---- the doors -----------------------------------------------------------------------------------------------------

def submit(sess: L.Session, payload: dict) -> Decision:
    """requestSubmit: one request for one person on the roster; a time off's dates read, or the row says why not."""
    if not SR.writer(sess.user):
        return Decision(SR.DENIED)
    p = payload if isinstance(payload, dict) else {}
    reads = sess.reads
    kind = s_(p.get("type"))
    if kind not in SR.TYPES:
        return W.refuse(400, f'Unknown request type "{kind}" — the queue speaks the Work Queue\'s own '
                             f"{len(SR.TYPES)} types (requestsList returns the list).")
    who = person(reads, s_(p.get("personId")))
    if "error" in who:
        return who["error"]
    details = s_(p.get("details")).strip()
    if not details:
        return W.refuse(400, "A request needs a description — an empty row is work for nobody.")
    urgency = s_(p.get("urgency")).lower() or "low"
    if urgency not in URGENCIES:
        return W.refuse(400, f'Unknown urgency "{urgency}". Valid: {", ".join(URGENCIES)} (the legacy sheet\'s own '
                             "vocabulary).")
    dates_text = s_(p.get("dates")).strip()
    time_off = kind == TYPE_TIME_OFF
    source = dates_text or (details if time_off else "")
    parsed = parse_dates(source, reads.now.astimezone(NY).date()) if source else None
    now = W.now_iso(reads)
    rec = {"id": "rq_" + str(uuid.uuid4())[:12], "createdAt": now, "updatedAt": now, "type": kind, "urgency": urgency,
           "personId": who["person"]["id"], "personName": who["person"]["name"], "phone": who["person"]["phone"],
           "email": who["person"]["email"], "details": details, "datesText": dates_text, "dateFrom": "", "dateTo": "",
           "dateDays": "", "calendarName": "", "parseNote": "", "status": "open", "verdict": "", "resolvedAt": "",
           "resolvedBy": "", "resolutionNote": "", "notifiedAt": "", "notifyCount": "0"}
    if parsed:
        if "error" in parsed:
            rec["parseNote"] = parsed["error"]
            if time_off:
                rec["status"] = "needs_dates"
        else:
            rec.update(dateFrom=parsed["from"], dateTo=parsed["to"], dateDays=str(parsed["days"]),
                       parseNote=parsed["assumed"])
            if time_off:
                rec["calendarName"] = calendar_name(who["person"]["name"])
    sid, tab, headers = _where(reads)
    if any(h not in headers for h in rec):
        raise Defer(f"the {SR.TAB} tab lacks a column a request writes; Apps Script grows the header")
    W.gate(reads)
    edits = [W.kept_record(sid, tab, "append", "id", rec["id"], rec["id"], rec)]
    answer = {"status": 200, "data": {k: rec[k] for k in ("id", "status", "dateFrom", "dateTo", "dateDays",
                                                         "calendarName", "parseNote")}}
    d = W.final(answer, edits, rec["id"])
    d.fresh = (sid,)
    return d


def resolve(sess: L.Session, payload: dict) -> Decision:
    """requestResolve: one verdict per request; the same verdict again is an answer, a different one a refusal."""
    if not SR.writer(sess.user):
        return Decision(SR.DENIED)
    p = payload if isinstance(payload, dict) else {}
    rid = s_(p.get("id"))
    if not rid:
        return W.refuse(400, "Which request?")
    verdict = s_(p.get("verdict")).lower()
    if verdict not in VERDICTS:
        return W.refuse(400, f'Unknown verdict "{verdict}". Valid: {", ".join(VERDICTS)}.')
    reads = sess.reads
    row = next((r for r in SR.rows(reads) if s_(r.get("id")) == rid), None)
    if row is None:
        return W.refuse(404, f'No staff request with id "{rid}".')
    if s_(row.get("status")) == "resolved":
        if s_(row.get("verdict")) == verdict:
            return Decision({"status": 200, "data": {"id": rid, "verdict": verdict, "already": True}})
        return W.refuse(409, f'That request is already resolved as "{row.get("verdict")}" — a second, different '
                             "verdict is a conversation, not an overwrite.")
    user = sess.user or {}
    now = W.now_iso(reads)
    cells = {"status": "resolved", "verdict": verdict, "resolvedAt": now, "resolvedBy": s_(user.get("email")),
             "resolutionNote": s_(p.get("note")), "updatedAt": now}
    sid, tab, headers = _where(reads)
    if any(h not in headers for h in cells):
        raise Defer(f"the {SR.TAB} tab lacks a column a verdict writes; Apps Script grows the header")
    W.gate(reads)
    edits = [W.kept_record(sid, tab, "edit", "id", rid, rid, cells,
                           before={k: s_(row.get(k)) for k in cells})]
    d = W.final({"status": 200, "data": {"id": rid, "verdict": verdict, "personName": s_(row.get("personName"))}},
                edits, rid)
    d.fresh = (sid,)
    return d


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {"requestSubmit": submit, "requestResolve": resolve}
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
BUSY_OF: dict[str, dict[str, Any]] = {a: {"status": 409, "message": BUSY} for a in ACTIONS}


class Store(W.Store):
    """app.support_requests_writes and app.support_requests_receipts, beside the other apps' own."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="support_requests", label="Support Requests Queue")
