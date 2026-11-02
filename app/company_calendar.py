"""Calendar (CompanyCalendar.gs companyCalendar, CalendarFiles.gs calendarDayFilesList) off asa-hub-db: what no slice
carries — the hiring calendar's interviews and start dates, the Smart Comms ledger's sends, the Employee Database's
birthdays as MM-DD only — and the files pinned to each day: the ones kept in app.calendar_files and any row the
calendar_files tab holds that no removal took off. calendarDayFilePlan is the relay's question before it files a day's
file in Drive."""
from __future__ import annotations

import re
from typing import Any, Callable

import candidate_papers as CNDP
import candidates as CND
import gsjs
import house_tables as HT
import hubdb
import locations as L
import scope as sc
import staff as SP
import staff_comms as STC
from gsjs import NY, SheetDate
from scope import Defer

APP_ID = "calendar"
TABLE = "app.calendar_files"
FILES_TAB = "calendar_files"
SMART_LEDGER_TAB = "smart_comms_sent"
DAY = re.compile(r"^\d{4}-\d{2}-\d{2}\Z")
DENIED = {"status": 403, "message": "Requires an admin or manager account"}
# EMPDB_COLUMNS: the two the calendar reads, first hit wins
NAME_COLUMNS = ("Employee", "Name", "Employee Name", "Full Name")
DOB_COLUMNS = ("Date of Birth", "DOB", "Birth Date")
# CalendarFiles.gs: the day files' Drive home under the platform's project folder, one folder a month. The folder's id
# is a key Apps Script keeps for itself; unnamed here, the relay finds the folder by its name, as Apps Script did
TASK_PROJECT_PROP = "TASK_PROJECT_FOLDER_ID"
TASK_PROJECT_FOLDER = "2025_07_28_new_project"
FOLDER_PATH = ("app", "app-script", "Calendar Attachments")
FILE_ROLES = ("admin", "manager", "staff")
FILE_EXT = re.compile(r"\.(png|jpe?g|webp|gif|heic|pdf)$", re.I)
B64_MAX = 21000000
LINK_GATE = "gate_calendar_file_link"

s_ = gsjs.str_


def at_headquarters(user: dict) -> None:
    """tenantContext_ standing nowhere: an account homed in a place reads that place's calendar, Apps Script's."""
    if not user.get("is_service") and not sc.is_real_master(user) and s_(user.get("home_tenant")):
        raise Defer("an account homed away from headquarters reads its place's calendar")


def _missing(p: dict, *keys: str) -> dict[str, Any] | None:
    """hubPolicyGate_'s required params."""
    for k in keys:
        v = p.get(k)
        if v is None or v == "":
            return {"status": 400, "message": f"Missing required parameter: {k}."}
    return None


# ---- the hiring calendar (HiringFlow.gs hiringCalendarList) -----------------------------------------------------

def _rows_or_none(reads: L.Reads, tab: str) -> list[dict]:
    """readTabNormalized_ inside Apps Script's try: a tab missing reads as none; a copy missing is said."""
    try:
        return CND.read_tab(reads, tab)
    except hubdb.Unreadable:
        raise
    except RuntimeError:
        return []


def hiring_events(reads: L.Reads) -> list[dict[str, Any]]:
    """hiringCalendarList's events: the calendar's live rows and the interviews it does not book, by day and time,
    the interviews and start dates kept (hiringCalendarKeep_)."""
    events = []
    for r in _rows_or_none(reads, CND.HIRING_EVENTS_TAB):
        if not s_(r.get("eventid")) or s_(r.get("status")).lower() == "cancelled":
            continue
        kind = s_(r.get("eventtype"))
        events.append({"id": s_(r.get("eventid")), "candidate_id": s_(r.get("candidateid")),
                       "name": s_(r.get("candidatename")), "type": kind,
                       "type_label": CND.HIRING_EVENT_TYPES.get(kind) or kind, "date": CND.hiring_date(r.get("date")),
                       "time": CND.hiring_time(r.get("time")), "location": s_(r.get("location")),
                       "with_name": s_(r.get("withname")), "notes": s_(r.get("notes")),
                       "status": s_(r.get("status")) or "scheduled", "source": "calendar"})
    booked = {e["candidate_id"] for e in events if e["type"] == "in_person_interview"}
    out = list(events)
    for iv in _rows_or_none(reads, CND.HUB_INTERVIEWS_TAB):
        cid, when = s_(iv.get("candidateid")), s_(iv.get("scheduledfor"))
        if not cid or not when or cid in booked:
            continue
        day = CND.hiring_date(when)
        if not day:
            continue
        tm = re.search(r"T(\d{2}:\d{2})", when)
        out.append({"id": s_(iv.get("interviewid")), "candidate_id": cid, "name": s_(iv.get("candidatename")),
                    "type": "in_person_interview", "type_label": CND.HIRING_EVENT_TYPES["in_person_interview"],
                    "date": day, "time": CND.hiring_time(tm.group(1) if tm else ""), "location": "",
                    "with_name": s_(iv.get("interviewername")), "notes": "", "status": s_(iv.get("status")) or "Scheduled",
                    "source": "interview"})
    out.sort(key=lambda e: e["date"] + "T" + (e["time"] or "00:00"))
    return [e for e in out if e["type"] in ("in_person_interview", "start_date")]


# ---- the sends and the birthdays ------------------------------------------------------------------------------------

def sends(reads: L.Reads, frm: str, to: str) -> list[dict[str, str]]:
    """The Smart Comms ledger's sends whose day falls in the window."""
    if HT.tabled(SMART_LEDGER_TAB):
        rows = STC._normalized_rows(*HT.raw(reads, SMART_LEDGER_TAB), True)
    else:
        res = reads.db.resolve(SMART_LEDGER_TAB)
        if res.runtime:
            raise Defer(f"{SMART_LEDGER_TAB} lives in the depot's facts")
        if res.ref is None:
            if not res.book_known:
                raise hubdb.Unreadable(f"asa-hub-db holds no copy of the book behind {SMART_LEDGER_TAB}")
            return []
        rows = STC._normalized(reads, res.ref, True)
    out = []
    for r in rows:
        at = s_(r.get("at"))
        d = at[:10]
        if d < frm or d > to:
            continue
        out.append({"date": d, "at": at, "situation": s_(r.get("situation")), "person": s_(r.get("person")),
                    "channel": s_(r.get("channel"))})
    return out


def month_day(v: Any) -> str:
    """companyCalendarMonthDay_: a Date's own month and day, else the text's; never re-parsed."""
    if isinstance(v, SheetDate):
        local = v.at.astimezone(NY)
        return f"{local.month:02d}-{local.day:02d}"
    s = gsjs.trim(gsjs.or_blank(v))
    iso = re.match(r"^(\d{4})-(\d{2})-(\d{2})", s)
    if iso:
        return iso.group(2) + "-" + iso.group(3)
    us = re.match(r"^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})", s)
    if us:
        return ("0" + us.group(1))[-2:] + "-" + ("0" + us.group(2))[-2:]
    return ""


def _column(heads: list[str], names: tuple[str, ...]) -> str | None:
    """empdbColumnIndex_ for one label: the first name any header answers to."""
    for name in names:
        key = hubdb.estate_key(name)
        hits = [h for h in heads if hubdb.estate_key(hubdb.twin_base(h)) == key]
        if not hits:
            continue
        if len(hits) > 1 or hits[0] != hubdb.twin_base(hits[0]):
            raise Defer("the Employee Database repeats the " + name + " column")
        return hits[0]
    return None


def staff_birthdays(reads: L.Reads) -> list[dict[str, str]]:
    """Every Employee Database row's name and its birthday as MM-DD."""
    tab = SP.cert_source_tab(reads, "master")
    try:
        heads, rows = SP._emp_tab(reads, tab)
    except SP.Said:
        # the tab missing: Apps Script's caught throw, no birthdays
        return []
    c_name, c_dob = _column(heads, NAME_COLUMNS), _column(heads, DOB_COLUMNS)
    if c_name is None or c_dob is None:
        return []
    out = []
    for r in rows:
        name = gsjs.trim(gsjs.or_text(r.get(c_name)))
        if not name:
            continue
        md = month_day(r.get(c_dob))
        if md:
            out.append({"name": name, "md": md})
    return out


def company_calendar(sess: L.Session, payload: dict) -> dict[str, Any]:
    """companyCalendar: the month's hiring days, sends and every staff birthday, for an admin or a manager."""
    reads, user = sess.reads, sess.user or {}
    p = payload if isinstance(payload, dict) else {}
    missing = _missing(p, "from", "to")
    if missing:
        return missing
    if not user or user.get("is_service") or s_(user.get("role")) not in ("admin", "manager"):
        return DENIED
    frm, to = s_(p.get("from")), s_(p.get("to"))
    if not DAY.match(frm) or not DAY.match(to):
        return {"status": 400, "message": "from and to must be YYYY-MM-DD."}
    at_headquarters(user)
    hiring = [e for e in hiring_events(reads) if frm <= s_(e["date"]) <= to]
    return {"status": 200, "data": {"hiring": hiring, "sends": sends(reads, frm, to),
                                    "staff_birthdays": staff_birthdays(reads)}}


# ---- the day files ----------------------------------------------------------------------------------------------

def tab_files(reads: L.Reads) -> list[dict[str, str]]:
    """The calendar_files tab's rows, read through the router, as readTabNormalized_ hands them."""
    res = reads.db.resolve(FILES_TAB)
    if res.runtime:
        raise Defer(f"{FILES_TAB} lives in the depot's facts")
    if res.ref is None:
        if not res.book_known:
            raise hubdb.Unreadable(f"asa-hub-db holds no copy of the book behind {FILES_TAB}")
        return []
    return [{k: s_(r.get(k)) for k in ("id", "date", "name", "url", "mime", "by", "at")}
            for r in STC._normalized(reads, res.ref, res.sheet_id == reads.db.prop("HUB_DB_ID"))]


def tab_files_on(reads: L.Reads) -> list[dict[str, str]]:
    """The tab's rows no removal took off: a tab row taken off its day is kept in app.calendar_files, marked removed."""
    rows = tab_files(reads)
    if not rows:
        return rows
    held = {fid for (fid,) in reads.db.query(f"select file_id from {TABLE} where file_id = any(%s)",
                                             ([r["id"] for r in rows],))}
    return [r for r in rows if r["id"] not in held]


def kept_files(reads: L.Reads) -> list[dict[str, str]]:
    """The files kept in app.calendar_files and not removed, in the order they were pinned."""
    return [{"id": fid, "date": day, "name": name, "url": url, "mime": mime, "by": by, "at": at}
            for fid, day, name, url, mime, by, at in reads.db.query(
                f"select file_id, day, name, url, mime, by_email, at from {TABLE} where removed_at is null"
                " order by at, file_id")]


def day_files_list(sess: L.Session, payload: dict) -> dict[str, Any]:
    """calendarDayFilesList: the files pinned to the days between `from` and `to` (either open)."""
    reads, user = sess.reads, sess.user or {}
    if not user or user.get("is_service"):
        return DENIED
    at_headquarters(user)
    p = payload if isinstance(payload, dict) else {}
    frm, to = s_(p.get("from")), s_(p.get("to"))
    out = []
    for f in tab_files_on(reads) + kept_files(reads):
        d = s_(f["date"])
        if not DAY.match(d) or (frm and d < frm) or (to and d > to):
            continue
        out.append({**f, "date": d})
    return {"status": 200, "data": {"files": out}}


def day_file_plan(sess: L.Session, payload: dict) -> dict[str, Any]:
    """calendarDayFileStore before Drive, for the relay: every refusal Apps Script gives, then where the file goes
    (the project folder, its path, the month), its name and type, and why its link stays private when it does."""
    reads, user = sess.reads, sess.user or {}
    if not user or user.get("is_service") or s_(user.get("role")) not in FILE_ROLES:
        return DENIED
    at_headquarters(user)
    p = payload if isinstance(payload, dict) else {}
    date = s_(p.get("date"))
    if not DAY.match(date):
        return {"status": 400, "message": "A day (YYYY-MM-DD) is required."}
    name = s_(p.get("filename")) or "attachment"
    mime = s_(p.get("mime")).lower()
    if not (mime.startswith("image/") or mime == "application/pdf") and not FILE_EXT.search(name):
        return {"status": 400, "message": "Images and PDFs only."}
    chars = p.get("b64_chars")
    chars = chars if isinstance(chars, int) and not isinstance(chars, bool) else 0
    if not chars:
        return {"status": 400, "message": "The file is required."}
    if chars > B64_MAX:
        return {"status": 400, "message": "The file is too large — up to 15MB."}
    held = CNDP.gate_holds(reads, LINK_GATE)
    return {"status": 200, "data": {"date": date, "name": name, "mime": mime,
                                    "platform_root": gsjs.trim(gsjs.or_text(reads.db.prop(TASK_PROJECT_PROP))),
                                    "project": TASK_PROJECT_FOLDER, "path": list(FOLDER_PATH) + [date[:7]],
                                    "held": held}}


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {
    "companyCalendar": company_calendar, "calendarDayFilesList": day_files_list,
    "calendarDayFilePlan": day_file_plan}
# HUB_POLICY: the month for admins and managers, the files for every signed-in account of these roles
POLICY: dict[str, dict[str, Any]] = {
    "companyCalendar": {"roles": ("admin", "manager"), "params": {"from": "string", "to": "string"}},
    "calendarDayFilesList": {"roles": ("admin", "manager", "staff", "client")},
    "calendarDayFilePlan": {"roles": FILE_ROLES}}
