"""Staff attendance (apps-script/StaffAlerts.gs) read off asa-hub-db: the facts every attendance letter and shift-flow
message is built from, and staffAttendanceDue — the attendance sweep's look on the relay's clock. The look reads the
platform mailbox, knows each report by its subject or by the model (one question per message, ever), gives every other
message its folder, and files what an earlier pass recorded; staff_alerts_writes records it under the write lock and
says it through Smart Comms. The sweep's memory (staff_alerts, mail_ai_verdicts, mail_routes) is app.resource_rows'."""
from __future__ import annotations

import hashlib
import json
import logging
import re
import time
import unicodedata
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from typing import Any, Callable

import gsjs
import hotline_file as HF
import hubdb
import locations as L
import mail_designs as MD
import mail_server as MS
import mw_roster
import recon as R
import recon_roster as RRO
import resource_rows as RR
import smart_comms as SC
import smart_comms_desk as SCD
import staff as SP
import support_desk as SD
import support_desk_writes as SDW
from gsjs import NY, name_key

log = logging.getLogger("asa-hub-app")

APP_ID = "staff-alerts"
DENIED = {"status": 403, "message": "Requires an admin or manager account"}
SWEEP = "staffAttendanceSweep"

ALERTS_TAB, AI_TAB, ROUTES_TAB = "staff_alerts", "mail_ai_verdicts", "mail_routes"
RESOURCES = {"staffAlerts": ALERTS_TAB, "mailAiVerdicts": AI_TAB, "mailRoutes": ROUTES_TAB}
ALERTS_HEADER = ("message_id", "kind", "person", "when_iso", "when_text", "alerted", "recipients", "filed", "seen_at",
                 "folder")
AI_HEADER = ("message_id", "verdict", "label", "person", "when_iso", "via", "seen_at")
ROUTES_HEADER = ("message_id", "folder", "via", "filed", "seen_at", "hint")
INBOX_LIMIT = 50
FILE_BATCH = 50
FRESH_MS = 48 * 3600 * 1000.0
# the look's own clock: no model is asked past it (the message waits for the next pass), the filing still runs
ASK_BUDGET_S = 75.0
ROUTES_BOOK = "comm_routes"
# the relay's /mail/file answered to this gate; the filing here does too
MAIL_GATE = "gate_mail_mark_file"
KNOWN_KINDS = ("late_show", "no_call", "call_off", "early_out")
AR_PARTS = ("no_call", "punch", "incident")
AR_KEY_PREFIX = "receive_off:"
ON_WORDS = ("yes", "on", "true", "1")
# server/shift_slices.py's words for a roster cell's kind
SHIFT_LABEL = {"day": "Day", "morning": "Morning", "afternoon": "Afternoon", "evening": "Evening",
               "overnight": "Overnight", "ro": "R/O", "off": "OFF"}

s_ = gsjs.str_


# ---- the clock's words (America/New_York) ----------------------------------------------------------------------

def parse_ms(v: Any) -> float | None:
    """Date.parse for an ISO instant or a mail Date header; None for NaN."""
    t = gsjs.date_parse(v)
    if t is not None:
        return t
    raw = gsjs.trim(gsjs.or_blank(v))
    if not raw:
        return None
    try:
        return parsedate_to_datetime(raw).timestamp() * 1000.0
    except (TypeError, ValueError, IndexError):
        pass
    try:
        at = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        return (at if at.tzinfo else at.replace(tzinfo=NY)).timestamp() * 1000.0
    except ValueError:
        return None


def _ny(ms: float) -> datetime:
    return datetime.fromtimestamp(ms / 1000.0, timezone.utc).astimezone(NY)


def clock_12(d: datetime) -> str:
    """Utilities.formatDate's 'h:mm a'."""
    return f"{d.hour % 12 or 12}:{d.minute:02d} {'AM' if d.hour < 12 else 'PM'}"


def when_text(iso: Any) -> str:
    """staffAlertWhen_: the instant on the company's clock, its hour left out at midnight."""
    t = parse_ms(iso)
    if not t:
        return gsjs.or_text(iso)
    d = _ny(t)
    day = d.strftime("%a, %b ") + str(d.day) + d.strftime(", %Y")
    return day if d.strftime("%H:%M") == "00:00" else day + " at " + clock_12(d)


def day_of(iso: Any) -> str:
    """staffAlertDay_: the New York day an instant falls on; a bare ISO day is already the day."""
    raw = gsjs.trim(gsjs.or_blank(iso))
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", raw):
        return raw
    t = parse_ms(raw)
    return _ny(t).strftime("%Y-%m-%d") if t else ""


_ISO_IN_TEXT = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:?\d{2})?")


def quote_text(s: Any) -> str:
    """staffAlertQuoteText_: the report's words, each raw ISO instant said on the company's clock."""
    return _ISO_IN_TEXT.sub(lambda m: when_text(m.group(0)), gsjs.or_text(s))


def shift_time(iso: Any) -> str:
    """staffShiftTime_: '8:00 AM', or '' when unreadable."""
    t = parse_ms(iso)
    return clock_12(_ny(t)) if t else ""


def shift_day(iso: Any) -> str:
    """staffShiftDay_: 'Mon 9/22'."""
    t = parse_ms(iso)
    if not t:
        return ""
    d = _ny(t)
    return d.strftime("%a ") + f"{d.month}/{d.day}"


def shift_clock(hhmm: Any) -> str:
    """staffShiftClock_: the relay's '07:30' as '7:30 AM'; anything else as it came."""
    m = re.fullmatch(r"(\d{1,2}):(\d{2})", gsjs.trim(gsjs.or_text(hhmm)))
    if not m or int(m.group(1)) > 23:
        return gsjs.or_text(hhmm)
    h = int(m.group(1))
    return f"{(h % 12) or 12}:{m.group(2)} {'AM' if h < 12 else 'PM'}"


def quiet_now(now: datetime) -> bool:
    """staffShiftQuiet_: inside 21:31–08:00 New York."""
    hm = now.astimezone(NY).strftime("%H:%M")
    return hm >= "21:31" or hm < "08:00"


def phone_key(raw: Any) -> str:
    """staffShiftPhoneKey_: sha256 of the last ten digits, its first sixteen hex characters."""
    d = re.sub(r"\D", "", gsjs.or_text(raw))[-10:]
    return hashlib.sha256(d.encode("utf-8")).hexdigest()[:16] if len(d) == 10 else ""


_DASHES = "[" + "".join(map(chr, (0x2012, 0x2013, 0x2014, 0x2015, 0x2212))) + "]"
_SINGLES = "[" + "".join(map(chr, (0x2018, 0x2019, 0x201B))) + "]"
_DOUBLES = "[" + "".join(map(chr, (0x201C, 0x201D, 0x201F))) + "]"
_WIDE = "[" + "".join(map(chr, (0x00A0, 0x2007, 0x202F))) + "]"


def ascii_words(v: Any) -> str:
    """staffShiftAscii_: a relay sentence folded to ASCII so the SMS stays GSM-7."""
    s = s_(v)
    if not s:
        return ""
    s = re.sub(_DASHES, "-", s)
    s = re.sub(_SINGLES, "'", s)
    s = re.sub(_DOUBLES, '"', s)
    s = s.replace(chr(0x2026), "...")
    s = re.sub(_WIDE, " ", s)
    return "".join(ch for ch in unicodedata.normalize("NFD", s) if not 0x300 <= ord(ch) <= 0x36F)


# ---- the mailbox's reports ----------------------------------------------------------------------------------------

_SUBJECT = re.compile(r"^\s*([A-Za-z][A-Za-z0-9 ]{1,40}?)\s*[—–-]+\s*(.+?)\s*\(([^)]+)\)\s*$")


def parse_subject(subject: Any) -> dict[str, str] | None:
    """staffAlertParse_: "<Category> — Name (iso)", whatever the dash; the category is open."""
    m = _SUBJECT.match(gsjs.or_text(subject))
    if not m:
        return None
    when_iso = gsjs.trim(m.group(3))
    if not parse_ms(when_iso):
        return None
    label = gsjs.trim(re.sub(r"\s+", " ", m.group(1)))
    low = label.lower()
    if re.search(r"late", low):
        kind, canon = "late_show", "Late Show"
    elif re.search(r"no\s*show|ncns|no\s*call", low):
        kind, canon = "no_call", "No Show No Call"
    elif re.search(r"call\s*off", low):
        kind, canon = "call_off", "Call Off"
    elif re.search(r"early", low):
        kind, canon = "early_out", "Early Out"
    else:
        kind, canon = re.sub(r"^_+|_+$", "", re.sub(r"[^a-z0-9]+", "_", low)), label
    if not kind:
        return None
    return {"kind": kind, "label": canon, "person": gsjs.trim(m.group(2)), "whenIso": when_iso}


def folder_of(kind: str, label: Any) -> str:
    """staffAlertFolder_."""
    fixed = {"late_show": "Staff Late Show", "no_call": "Staff No Call", "call_off": "Staff Call Off",
             "early_out": "Staff Early Out"}
    if kind in fixed:
        return fixed[kind]
    clean = gsjs.trim(re.sub(r"\s+", " ", re.sub(r"[^A-Za-z0-9 ]+", " ", gsjs.or_text(label))))[:40]
    return "Staff " + clean if clean else "Staff Reports"


def ledger_sid(kind: str) -> str:
    """staffAlertLedgerSid_: the attendance situation a category belongs to, '' for any other."""
    return "staff_no_call" if kind == "no_call" else "staff_late_show" if kind == "late_show" else ""


def ledger_key(sid: str, person: Any, day: Any) -> str:
    """staffAlertLedgerKey_ (smartLedgerKey_): the situation, the person, the day the absence is about."""
    return sid + "|" + name_key(person) + "|" + s_(day)[:10]


def route_folder(label: Any) -> str:
    """mailRouteFolder_."""
    clean = gsjs.trim(re.sub(r"\s+", " ", re.sub(r"[^A-Za-z0-9 ]+", " ", gsjs.or_text(label))))[:40]
    return "Mail " + clean if clean else "Mail Other"


def route_hint(subject: Any) -> str:
    """mailRouteHint_: the ASCII search bait for the filing's subject fallback."""
    return gsjs.trim(re.sub(r"\s+", " ", re.sub(r"[^\x20-\x7E]+", " ", gsjs.or_text(subject))))[:60]


def route_rule(t: dict) -> str:
    """mailRouteRule_: the deterministic reader, first."""
    frm, to, subj = s_(t.get("from_addr")).lower(), s_(t.get("to")).lower(), s_(t.get("subject")).lower()
    if re.search(r"(^|[@.])groq\.com$", frm) or re.search(r"(^|[@.])(openai\.com|anthropic\.com|cerebras\.ai)$", frm):
        return "Mail Free Tier"
    if "interviewer@asalifecare.com" in to or "interviewer@asalifecare.com" in subj:
        return "Mail Interviews"
    if "onboarding@asalifecare.com" in to or "onboarding@asalifecare.com" in subj:
        return "Mail Onboarding"
    if re.search(r"(^|[@.])github\.com$", frm):
        return "Mail Github"
    return ""


def _model(reads: L.Reads, ask: str, tag: str, deadline: float) -> tuple[bool, dict | None, str]:
    """screenAiChat_(ask, 0.1, tag): whether a reader answered, its JSON (None when unparsable) and which it was."""
    import client_care_sweeps as CCS  # noqa: PLC0415 - the model's ladder, loaded only when a message needs it
    try:
        res = CCS.ai_chat(reads, ask, 0.1, tag, deadline)
    except Exception:  # noqa: BLE001 - no reader answered
        return False, None, ""
    if not res.get("ok"):
        return False, None, ""
    try:
        got = json.loads(s_(res.get("content")))
    except ValueError:
        got = None
    return True, (got if isinstance(got, dict) else None), s_(res.get("via"))


def classify_ai(reads: L.Reads, subject: Any, snippet: Any, deadline: float) -> dict[str, Any] | None:
    """staffAlertClassifyAi_: the second reader, gated on the name being written and the date parsing."""
    text_all = SC._cut16(gsjs.or_text(subject) + "\n" + gsjs.or_text(snippet), 1200)
    ask = ("You sort the mailbox of a care company. Decide whether this message is a STAFF "
           "ATTENDANCE REPORT about one employee, and classify it.\n\n"
           "MESSAGE:\n" + text_all + "\n\n"
           "Known categories: late_show (arrived late), no_call (no show no call), "
           "call_off (called off the shift), early_out (left early).\n"
           "Reply with JSON only:\n"
           '{"category":"<one of the known slugs, or a NEW 1-3 word lowercase slug, or none>",'
           '"label":"<2-3 word title for the category>",'
           '"person":"<the employee\'s name exactly as written in the message>",'
           '"date_iso":"<the shift date/instant from the message, ISO>"}\n'
           'If it is not a staff attendance report, category is "none".')
    ok, parsed, via = _model(reads, ask, "ai_alert_classify", deadline)
    if not ok or parsed is None:
        return None
    cat = re.sub(r"^_+|_+$", "", re.sub(r"[^a-z0-9]+", "_", s_(parsed.get("category")).lower()))
    if not cat or cat == "none":
        return {"none": True, "via": via}
    person = s_(parsed.get("person"))
    hay = text_all.lower()
    words = [w for w in re.split(r"\s+", person.lower()) if w]
    if not person or not words or not all(w in hay for w in words):
        return {"refused": True, "why": "the message never wrote that name", "via": via}
    when_iso = s_(parsed.get("date_iso"))
    if not parse_ms(when_iso):
        return {"refused": True, "why": "the date does not parse", "via": via}
    label = gsjs.trim(re.sub(r"\s+", " ", re.sub(r"[^A-Za-z0-9 ]+", " ", s_(parsed.get("label")))))[:30]
    if cat in KNOWN_KINDS:
        label = ""
    return {"kind": cat, "label": label, "person": person, "whenIso": when_iso, "via": via}


def route_ai(reads: L.Reads, t: dict, deadline: float) -> dict[str, str] | None:
    """mailRouteAi_: the model reads what no rule matched — one call per message, ever."""
    text_all = SC._cut16("FROM: " + s_(t.get("from_addr")) + "\nTO: " + s_(t.get("to")) + "\nSUBJECT: "
                         + s_(t.get("subject")) + "\n" + s_(t.get("snippet")), 1200)
    ask = ("You sort the mailbox of a care company into folders. Read this message "
           "and pick its category.\n\nMESSAGE:\n" + text_all + "\n\n"
           "Known categories: Free Tier (AI/API provider notices, usage caps, "
           "billing tiers), Interviews (candidates, interview scheduling), "
           "Onboarding (new-hire paperwork), Github (repository notifications), "
           "Invoices (bills, receipts), Newsletters, Security (sign-in alerts, "
           "password resets), Notices (automated no-reply mail).\n"
           'Reply with JSON only: {"category":"<one of the known names, or a NEW '
           '1-3 word Title Case name that fits better>"}')
    ok, got, via = _model(reads, ask, "ai_mail_route", deadline)
    if not ok:
        return None
    return {"folder": route_folder(s_((got or {}).get("category"))), "via": via or "ai"}


# ---- the situations Smart Comms owns ------------------------------------------------------------------------------

def situations(reads: L.Reads) -> list[dict]:
    """smartSituations_, once per request; raises when the tab cannot be read."""
    return reads.once("sa:situations", lambda: SC.read_situations(reads.db))


def sid_of(reads: L.Reads, rows: list[dict] | None, kind: str) -> str:
    """staffAlertSid_ (commSituationId_)."""
    no_call = kind == "no_call"
    return MD.situation_id(reads, rows or [], "staff.no_call" if no_call else "staff.late_show",
                           "staff_no_call" if no_call else "staff_late_show")


def situation(reads: L.Reads, kind: str) -> dict[str, Any]:
    """staffAlertSituation_: {id, row, on, unreadable} — the first row of the bound id."""
    out: dict[str, Any] = {"id": "", "row": None, "on": False, "unreadable": ""}
    try:
        rows = situations(reads)
    except Exception as exc:  # noqa: BLE001 - an unread tab is said, never read as off
        out["id"] = sid_of(reads, None, kind)
        out["unreadable"] = ("the Smart Comms situations could not be read ("
                             + (str(exc) or type(exc).__name__)[:160] + ")")
        return out
    out["id"] = sid_of(reads, rows, kind)
    out["row"] = next((r for r in rows if s_(r.get("id")) == out["id"]), None)
    out["on"] = bool(out["row"]) and SC.smart_on(out["row"].get("enabled"))
    return out


def stop_why(read: dict | None) -> str:
    """staffAlertStopWhy_: why this situation sends nothing now, or ''."""
    r = read or {}
    if r.get("unreadable"):
        return r["unreadable"] + " — nothing was sent; the next pass asks again"
    if not r.get("row"):
        return "the situation " + s_(r.get("id")) + " is not in the situations tab — nothing was sent"
    if not r.get("on"):
        return "the situation " + s_(r.get("id")) + " is switched off"
    return ""


def _split_to(raw: Any) -> list[str]:
    return [gsjs.trim(x) for x in re.split(r"[,;]+", gsjs.or_text(raw))]


def recipients(read: dict | None) -> list[str]:
    """staffAlertRecipients_: the row's addresses and only the row's; [] when it cannot speak."""
    if stop_why(read):
        return []
    return [x for x in _split_to(read["row"].get("to")) if "@" in x]


def sms_plan(read: dict | None, vars_: dict) -> dict[str, Any] | None:
    """staffAlertSmsPlan_: the row's numbers and its text, rendered; None when the row names no text leg."""
    if stop_why(read):
        return None
    sit = read["row"]
    if "sms" not in SC.smart_list(sit.get("channels")):
        return None
    words = s_(sit.get("sms_text"))
    if not words:
        return None
    numbers = [x for x in _split_to(sit.get("to")) if x and "@" not in x]
    if not numbers:
        return None
    return {"numbers": numbers, "body": SC.render(words, vars_ or {})}


def letter(read: dict | None, opts: dict, vars_: dict) -> dict[str, str]:
    """staffAlertLetter_: the letter, in the row's words when it has them."""
    row = (read or {}).get("row") or {}
    o = dict(opts)
    subj, text = s_(row.get("email_subject")), s_(row.get("email_text"))
    if subj:
        o["subject"] = SC.render(subj, vars_)
    if text:
        o["leadText"] = SC.render(text, vars_)
    return MD.staff_alert_email(o)


_NOBODY_SAID: set[str] = set()


def nobody_say(read: dict | None) -> None:
    """staffAlertNobodySay_: said once per situation per process."""
    sid = s_((read or {}).get("id"))
    if sid in _NOBODY_SAID:
        return
    _NOBODY_SAID.add(sid)
    log.info("staff alerts: %s is on and names no address and no number in `to`, so nothing was sent — type the "
             "recipients on the Desk", sid)


def ledger_keys(reads: L.Reads) -> set[str] | None:
    """smartAlreadySent_: every key the ledger holds; None when it could not be read."""
    try:
        got = SCD.ledger_rows(reads)
    except Exception:  # noqa: BLE001 - a read that failed is not a ledger that is empty
        return None
    if got is None:
        return set()
    rows, heads = got
    out: set[str] = set()
    for _rn, raw in rows:
        k = gsjs.trim(gsjs.or_blank(raw.get(heads["key"])))
        if k:
            out.add(k)
    return out


# ---- AlertReceive.gs: the alerts a director or the master turned off for themselves -----------------------------

def _ar_off(reads: L.Reads) -> dict[str, set[str]]:
    """arOff_: uid → the parts turned off, for the holders alone (a director on the list, or the master)."""
    def read() -> dict[str, set[str]]:
        try:
            if not reads.db.house_moved(SDW.TABS["settings"]):
                return {}
            rows = SDW.tab_rows(reads, SDW.TABS["settings"])
        except Exception:  # noqa: BLE001 - settings that cannot be read cut nobody
            return {}
        off: dict[str, set[str]] = {}
        for r in rows:
            key = s_(r.get("key"))
            if not key.startswith(AR_KEY_PREFIX):
                continue
            named = re.split(r"[,;\s]+", s_(r.get("value")).lower())
            parts = {p for p in AR_PARTS if p in named}
            uid = key[len(AR_KEY_PREFIX):]
            if uid and parts:
                off[uid] = parts
        if not off:
            return {}
        holders = {s_(d.get("uid")) for d in SDW.directors(reads).get("list") or []}
        import scope as sc  # noqa: PLC0415
        for u in reads.users():
            if sc.is_master_email(u.get("email")) and not s_(u.get("mergedinto")):
                holders.add(s_(u.get("userid")))
        return {uid: parts for uid, parts in off.items() if uid in holders}
    try:
        return reads.once("sa:ar_off", read)
    except Exception:  # noqa: BLE001 - fail open
        return {}


def ar_receivers(reads: L.Reads, people: list[dict], part: str) -> list[dict]:
    """arReceivers_ (sdReceivers_): the people this alert still reaches."""
    if part not in AR_PARTS:
        return list(people or [])
    off = _ar_off(reads)
    return [p for p in people or [] if part not in off.get(s_((p or {}).get("uid")), set())]


def ar_keep(reads: L.Reads, part: str, dests: list[str]) -> list[str]:
    """arKeep_ (FAIL-OPEN): the destinations left once every one reaching only holders who turned it off is out."""
    if part not in AR_PARTS or not dests:
        return list(dests or [])
    try:
        mine = {uid for uid, parts in _ar_off(reads).items() if part in parts}
        if not mine:
            return list(dests)
        emails: dict[str, set[str]] = {}
        digits: dict[str, set[str]] = {}
        for u in reads.users():
            uid = s_(u.get("userid"))
            if not SDW.live(u) or not uid:
                continue
            for e in [u.get("email")] + list(SDW.parse_emails(u.get("emails"))):
                k = s_(e).lower()
                if k.find("@") > 0:
                    emails.setdefault(k, set()).add(uid)
            for n in [u.get("phone")] + [p.get("number") if isinstance(p, dict) else p
                                         for p in SDW.parse_phones(u.get("phones"))]:
                d = re.sub(r"\D", "", gsjs.or_blank(n))[-10:]
                if len(d) == 10:
                    digits.setdefault(d, set()).add(uid)
        drop_e = {k for k, who in emails.items() if who <= mine}
        drop_d = {k for k, who in digits.items() if who <= mine}
        out = []
        for d in dests:
            t = s_(d)
            if "@" in t:
                if t.lower() not in drop_e:
                    out.append(d)
                continue
            ten = re.sub(r"\D", "", t)[-10:]
            if not (len(ten) == 10 and ten in drop_d):
                out.append(d)
        return out
    except Exception:  # noqa: BLE001 - fail open
        return list(dests)


# ---- the switches (Settings › My Work) -------------------------------------------------------------------------

def auto_on(reads: L.Reads, part: str) -> bool:
    """hubMyWorkAutoOn_ (FAIL-CLOSED): the switch plainly on, its catalogue default when it has no cell."""
    try:
        key = SD.AUTO_KEYS[part]
        cfg = reads.config()
        raw = cfg[key] if key in cfg else SD.auto_defaults(reads).get(key)
        return gsjs.trim(gsjs.or_blank(raw)).lower() in ON_WORDS
    except Exception:  # noqa: BLE001 - anything unread is off
        return False


# ---- the roster, the time clock and the people who can act ----------------------------------------------------

def _hhmm(h: float) -> str:
    return f"{int(h) % 24:02d}:{int(round(h % 1 * 60)):02d}"


def _roster_day(reads: L.Reads, day: str) -> list[dict[str, str]]:
    """The relay's `shifts` rows of one day (server/shift_slices.py), off the house calendars' live copy."""
    def read() -> list[dict[str, str]]:
        cals = RRO.calendars(reads)
        short_by_code: dict[str, str] = {}
        code_of: dict[str, str] = {}
        for label, _g in cals:
            parts = [gsjs.trim(p) for p in label.split(" - ")]
            code = parts[-1] if len(parts) >= 2 else gsjs.trim(label)
            code_of[label] = code
            if len(parts) >= 3:
                short_by_code[parts[-1]] = " - ".join(parts[1:-1])
        code_by_short = {v.upper(): k for k, v in short_by_code.items()}
        out: list[dict[str, str]] = []
        for label, grid in cals:
            house = code_of.get(label) or label
            cols = [s_(c.get("iso")) if isinstance(c, dict) else "" for c in grid.get("cols") or []]
            if day not in cols:
                continue
            at = cols.index(day)
            for row in grid.get("rows") or []:
                if not isinstance(row, dict):
                    continue
                staff = gsjs.trim(gsjs.or_blank(row.get("employee")))
                cells = row.get("cells") if isinstance(row.get("cells"), list) else []
                if not staff or at >= len(cells):
                    continue
                cell = cells[at]
                c = mw_roster.shift_slices.classify(gsjs.or_blank(cell.get("text") if isinstance(cell, dict) else cell))
                if not c or c["kind"] == "off":
                    continue
                home = code_by_short.get(s_(c.get("token") or c["code"]).upper(), house) if c["kind"] == "alias" \
                    else house
                out.append({"staff": staff, "house": short_by_code.get(home, home), "house_code": home,
                            "start": _hhmm(c["start"]) if "start" in c else "",
                            "end": _hhmm(c["end"]) if "end" in c else "",
                            "status": "@ " + c["code"] if c["kind"] == "alias" else SHIFT_LABEL.get(c["kind"], "")})
        return out
    return reads.once("sa:roster:" + day, read)


def shift_of(reads: L.Reads, person: Any, day: str) -> list[dict[str, str]]:
    """The relay's /shift/of: one person's shifts on one day — the exact name, else every one of its words."""
    want = gsjs.trim(gsjs.or_text(person)).lower()
    if not want or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", day or ""):
        return []
    rows = _roster_day(reads, day)
    hits = [r for r in rows if r["staff"].strip().lower() == want]
    if not hits:
        tokens = [t for t in want.split() if t]
        hits = [r for r in rows if tokens and all(t in r["staff"].lower() for t in tokens)]
    return hits[:4]


def shift_text(reads: L.Reads, person: Any, day: str) -> str:
    """staffShiftText_: '48TH · 08:00–20:00' off the roster, '' when nothing is found or it cannot be read."""
    if not day:
        return ""
    try:
        shifts = shift_of(reads, person, day)
    except Exception:  # noqa: BLE001 - the letter says the roster had nothing, honestly
        return ""
    timed = [x for x in shifts if x["start"] and x["end"]]
    return "  +  ".join((x["house"] + " · " if x["house"] else "")
                        + (x["start"] + "–" + x["end"] if x["start"] and x["end"] else x["status"])
                        for x in (timed or shifts))


def _minutes(text: str) -> int | None:
    m = re.fullmatch(r"\s*(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp][Mm])?\s*", text)
    if not m:
        return None
    h = int(m.group(1))
    if m.group(3):
        h = h % 12 + (12 if m.group(3).upper() == "PM" else 0)
    return h * 60 + int(m.group(2))


def arrival_text(reads: L.Reads, person: Any, day: str) -> str:
    """staffArrivalText_: the earliest clock-in that day off time_punches, '' when none."""
    if not day:
        return ""
    try:
        rows = R.rows(reads, R.PUNCHES_TAB)
    except Exception:  # noqa: BLE001 - no punch read is no arrival said
        return ""
    want = gsjs.trim(gsjs.or_text(person)).lower()
    best, best_t = None, None
    for r in rows:
        if s_(r.get("date"))[:10] != day or s_(r.get("employeeName")).lower() != want:
            continue
        start = s_(r.get("start"))
        if not start:
            continue
        t = _minutes(start)
        if best is None or (t is not None and (best_t is None or t < best_t)):
            best, best_t = r, t if t is not None else best_t
    if best is None:
        return ""
    return s_(best.get("start")) + (" at " + s_(best.get("location")) if s_(best.get("location")) else "") \
        + " (time clock)"


def record_routes(reads: L.Reads) -> dict[str, dict]:
    """commRecordRoutes_: the routes by person key, the first row of each; {} when they cannot be read."""
    out: dict[str, dict] = {}
    try:
        for r in SCD.board_rows(reads, ROUTES_BOOK):
            k = gsjs.trim(gsjs.or_text(r.get("person_key"))).lower()
            if k and k not in out:
                out[k] = r
    except Exception:  # noqa: BLE001 - no routes: the platform default stands
        pass
    return out


def escalation(reads: L.Reads, person: Any, day: str) -> list[str]:
    """staffAlertEscalation_: the house manager of the roster's house and the person's supervisor, as numbers."""
    out: list[str] = []
    why: list[str] = []
    house = ""
    try:
        house = next((x["house"] for x in shift_of(reads, person, day) if x["house"]), "")
    except Exception:  # noqa: BLE001
        house = ""
    if not house:
        why.append("no house on the roster for that day")
    else:
        try:
            hm = HF.house_manager(reads, house)
            if hm and s_(hm.get("phone")):
                out.append(s_(hm["phone"]))
            else:
                why.append('the house "' + house + '" resolves to no manager with a number')
        except Exception:  # noqa: BLE001
            why.append('the manager of "' + house + '" could not be read')
    try:
        sup = s_((record_routes(reads).get(name_key(person)) or {}).get("supervisor"))
        if not sup:
            why.append("the routes name no supervisor for " + s_(person))
        elif len(re.sub(r"\D", "", sup)) >= 10:
            out.append(sup)
        else:
            found = ""
            try:
                for p in SP._people(reads):
                    if not found and name_key(p.get("name")) == name_key(sup):
                        found = s_(p.get("phone"))
            except Exception:  # noqa: BLE001
                found = ""
            if found:
                out.append(found)
            else:
                why.append("the supervisor (" + sup + ") carries no number we may text")
    except Exception:  # noqa: BLE001
        why.append("the routes could not be read")
    if why:
        log.info("staff alerts: escalation partial for %s: %s", s_(person), " · ".join(why))
    return out


def people_index(reads: L.Reads) -> dict[str, Any]:
    """staffShiftPeople_: the People house by name fold, each with whether they are on staff."""
    def read() -> dict[str, Any]:
        out: dict[str, Any] = {"readable": False, "byKey": {}}
        try:
            rows = SP.without_isp_clients(reads, SP.people_merged(reads, SP._people(reads)))
        except Exception:  # noqa: BLE001 - unreadable, said by the caller
            return out
        out["readable"] = True
        try:
            on = SDW.block_statuses(reads)
        except Exception:  # noqa: BLE001
            on = set()
        on = on or {"active", "admin"}
        for p in rows or []:
            k = name_key((p or {}).get("name"))
            if not k:
                continue
            mine = {"name": s_(p.get("name")), "phone": s_(p.get("phone")), "email": s_(p.get("email")),
                    "onStaff": gsjs.trim(gsjs.or_text(p.get("status"))).lower() in on}
            held = out["byKey"].get(k)
            if held is None or (not held["onStaff"] and mine["onStaff"]):
                out["byKey"][k] = mine
        return out
    return reads.once("sa:people", read)


def house_manager(reads: L.Reads, house: Any, memo: dict) -> dict[str, Any]:
    """staffShiftHouseManager_: {hm, readable} — the exact location first, then the house's code."""
    want = s_(house)
    if not want:
        return {"hm": None, "readable": True}
    exact = memo.setdefault("exact", {})
    if want not in exact:
        try:
            exact[want] = HF.house_manager(reads, want)
        except Exception:  # noqa: BLE001
            exact[want] = None
    if exact[want]:
        return {"hm": exact[want], "readable": True}
    if "all" not in memo:
        try:
            memo["all"] = SCD.hotline_house_managers(reads)
        except Exception:  # noqa: BLE001
            memo["all"] = None
    every = memo["all"]
    if not every or not every.get("readable"):
        return {"hm": None, "readable": False}
    code = gsjs.trim(want.split(" - ")[-1]).upper()
    for p in every.get("people") or []:
        loc = s_(p.get("house")).upper()
        if code and (loc == code or loc[-(len(code) + 3):] == " - " + code):
            return {"hm": {"name": s_(p.get("name")), "phone": s_(p.get("phone"))}, "readable": True}
    return {"hm": None, "readable": True}


# ---- the sweep's memory ----------------------------------------------------------------------------------------

def memory(reads: L.Reads, resource: str) -> list[tuple[str | None, dict[str, str]]]:
    """A memory tab's rows as (row key, cells as text): Postgres' once uploaded, else the sheet's copy (no key)."""
    if RR.uploaded(reads.db, resource):
        cols = RR.columns(reads, resource)
        out = []
        for k, c in RR.table_rows(reads, resource):
            row = RR.shown(cols, c)
            if row is not None:
                out.append((k, {h: s_(v) for h, v in row.items()}))
        return out
    res = reads.db.resolve(RESOURCES[resource])
    if res.ref is None:
        return []
    heads = [(h, gsjs.trim(gsjs.js_str(h))) for h in res.ref.headers if h != ""]
    return [(None, {k: s_(hubdb.cell_text(hubdb.typed(raw.get(h), "hub"))) for h, k in heads})
            for _rn, raw in reads.db.rows(res.ref)]


# ---- staffAttendanceDue ------------------------------------------------------------------------------------------

def _gate(user: dict | None) -> bool:
    u = user or {}
    return u.get("is_service") is True or s_(u.get("role")) == "admin"


def _simulation(reads: L.Reads) -> dict[str, Any]:
    """The simulation's facts: the last two reports recorded (a sample when none), their roster and arrival."""
    recorded = [r for _k, r in memory(reads, "staffAlerts") if r.get("kind") and r.get("person")][-2:]
    if not recorded:
        recorded = [{"kind": "late_show", "person": "Jeremiah Inman", "when_iso": "2026-08-15T04:00:00.000Z"}]
    letters = []
    for r in recorded:
        kind = "no_call" if s_(r.get("kind")) == "no_call" else "late_show"
        person, when_iso = s_(r.get("person")), s_(r.get("when_iso"))
        day = day_of(when_iso)
        letters.append({"kind": kind, "person": person, "when_iso": when_iso,
                        "shift": shift_text(reads, person, day),
                        "arrived": arrival_text(reads, person, day) if kind == "late_show" else ""})
    return {"due": True, "simulate": True, "letters": letters}


def _file(creds: dict, pending: dict[str, dict[str, str]]) -> list[dict[str, Any]]:
    """The memory's unfiled messages moved into their folders, a batch per folder; a folder that refused is left."""
    out = []
    for folder, ids in pending.items():
        if not ids or not MS.FOLDER_SHAPE.fullmatch(folder):
            continue
        items = [{"id": mid, "hint": hint} for mid, hint in list(ids.items())[:FILE_BATCH]]
        try:
            got = MS.file_into(creds["user"], creds["password"], items, folder)
        except Exception as exc:  # noqa: BLE001 - a filing failure costs tidiness, never the alert
            log.info("staff alerts: %s could not be filed (%s)", folder, type(exc).__name__)
            continue
        out.append({"folder": folder, "moved": [s_(x) for x in got.get("moved_ids") or []],
                    "missing": [s_(x) for x in got.get("not_found") or []]})
    return out


def _pending(rows: list[tuple[str | None, dict[str, str]]], folder: Callable[[dict], str],
             hint: Callable[[dict], str]) -> dict[str, dict[str, str]]:
    """folder → {message id → hint} of the rows never filed, or missed once ('not-in-inbox')."""
    out: dict[str, dict[str, str]] = {}
    for _k, r in rows:
        mark = s_(r.get("filed"))
        mid = s_(r.get("message_id"))
        if not mid or mark not in ("", "not-in-inbox"):
            continue
        out.setdefault(folder(r), {})[mid] = hint(r)
    return out


def attendance_due(sess: L.Session, payload: dict) -> dict[str, Any]:
    """staffAttendanceSweep's look (the relay's clock, or an admin pressing it): the inbox read, each report and
    each other message classified, the facts each letter needs looked up, and the unfiled messages filed — sealed for
    staffAttendanceSweep, which records them and says what is owed."""
    if not _gate(sess.user):
        return dict(DENIED)
    p = payload if isinstance(payload, dict) else {}
    reads = sess.reads
    by = R.actor(sess.user)
    if p.get("simulate"):
        return {"status": 200, "data": R.seal(SWEEP, by, _simulation(reads))}
    creds = MS.creds(None)
    if creds is None:
        return {"status": 502, "message": "The mailbox did not answer: PLATFORM_EMAIL is not configured"}
    started = time.monotonic()
    deadline = started + ASK_BUDGET_S
    try:
        inbox = MS.inbox(creds["user"], creds["password"], INBOX_LIMIT)
    except Exception as exc:  # noqa: BLE001 - said, never an empty inbox
        return {"status": 502, "message": ("The mailbox did not answer: " + (str(exc) or type(exc).__name__))[:148]}
    threads = [t for t in inbox.get("threads") or [] if isinstance(t, dict)]
    alerts = memory(reads, "staffAlerts")
    seen = {r["message_id"] for _k, r in alerts if r.get("message_id")}
    ai_seen: dict[str, str] = {}
    ai_was: dict[str, dict[str, str]] = {}
    for _k, r in memory(reads, "mailAiVerdicts"):
        mid = r.get("message_id")
        if mid:
            ai_seen[mid] = s_(r.get("verdict"))
            ai_was[mid] = {"label": s_(r.get("label")), "person": s_(r.get("person")), "whenIso": s_(r.get("when_iso"))}
    now_ms = time.time() * 1000.0
    stamp = gsjs.iso(datetime.now(timezone.utc))
    reports: list[dict[str, Any]] = []
    ai_rows: list[dict[str, str]] = []
    held_no_reader = held_refused = 0
    for t in threads:
        mid = s_(t.get("id"))
        if not mid or mid in seen:
            continue
        parsed = parse_subject(t.get("subject"))
        if not parsed:
            if mid in ai_seen:
                verdict = ai_seen[mid]
                if verdict == "gate-refused":
                    seen.add(mid)
                    held_refused += 1
                    continue
                if not verdict or verdict == "none":
                    continue
                was = ai_was.get(mid) or {}
                if not was.get("person") or not parse_ms(was.get("whenIso")):
                    seen.add(mid)
                    held_refused += 1
                    continue
                ai: dict[str, Any] | None = {"kind": verdict, "label": was.get("label", ""), "person": was["person"],
                                             "whenIso": was["whenIso"]}
            else:
                ai = classify_ai(reads, t.get("subject"), t.get("snippet"), deadline) \
                    if time.monotonic() < deadline else None
                if ai is None:
                    seen.add(mid)
                    log.info("staff alerts: %s — no reader answered; held, and every sweep asks again", mid)
                    held_no_reader += 1
                    continue
                if ai.get("refused"):
                    ai_rows.append({"message_id": mid, "verdict": "gate-refused", "via": s_(ai.get("via")),
                                    "seen_at": stamp})
                    ai_seen[mid] = "gate-refused"
                    seen.add(mid)
                    held_refused += 1
                    log.info("staff alerts: %s — the reader's answer failed the gate (%s); held for a person, and the "
                             "model is not asked again", mid, s_(ai.get("why")))
                    continue
                ai_rows.append({"message_id": mid, "verdict": "none" if ai.get("none") else ai["kind"],
                                "label": s_(ai.get("label")), "person": s_(ai.get("person")),
                                "when_iso": s_(ai.get("whenIso")), "via": s_(ai.get("via")), "seen_at": stamp})
                ai_seen[mid] = "none" if ai.get("none") else ai["kind"]
                ai_was[mid] = {"label": s_(ai.get("label")), "person": s_(ai.get("person")),
                               "whenIso": s_(ai.get("whenIso"))}
                if ai.get("none"):
                    continue
            parsed = {"kind": ai["kind"], "label": ai.get("label", ""), "person": ai["person"],
                      "whenIso": ai["whenIso"]}
            canon = {"late_show": "Late Show", "no_call": "No Show No Call", "call_off": "Call Off",
                     "early_out": "Early Out"}
            parsed["label"] = canon.get(parsed["kind"], parsed["label"])
        arrived = parse_ms(t.get("date")) or now_ms
        fresh = (now_ms - arrived) < FRESH_MS
        day = day_of(parsed["whenIso"])
        lsid = ledger_sid(parsed["kind"])
        rep: dict[str, Any] = {
            "mid": mid, "kind": parsed["kind"], "label": parsed["label"], "person": parsed["person"],
            "when_iso": parsed["whenIso"], "when_text": when_text(parsed["whenIso"]), "fresh": fresh, "day": day,
            "ledger_sid": lsid, "ledger_key": ledger_key(lsid, parsed["person"], day) if lsid and day else "",
            "report_words": SC._cut16(quote_text(s_(t.get("snippet"))), 300),
            "folder": folder_of(parsed["kind"], parsed["label"])}
        if fresh:
            rep["shift"] = shift_text(reads, parsed["person"], day)
            rep["arrived"] = arrival_text(reads, parsed["person"], day) if parsed["kind"] == "late_show" else ""
            rep["escalation"] = escalation(reads, parsed["person"], day) if day else []
        reports.append(rep)
        seen.add(mid)

    routes_rows = memory(reads, "mailRoutes")
    routed = {r["message_id"] for _k, r in routes_rows if r.get("message_id")}
    route_new: list[dict[str, str]] = []
    for t in threads:
        gid = s_(t.get("id"))
        if not gid or gid in seen or gid in routed:
            continue
        folder, via = route_rule(t), "rule"
        if not folder:
            verdict = route_ai(reads, t, deadline) if time.monotonic() < deadline else None
            if not verdict:
                continue
            folder, via = verdict["folder"], verdict["via"]
        route_new.append({"message_id": gid, "folder": folder, "via": via, "filed": "", "seen_at": stamp,
                          "hint": route_hint(t.get("subject"))})
        routed.add(gid)

    pending = _pending(alerts, lambda r: s_(r.get("folder")) or folder_of(s_(r.get("kind")), ""),
                       lambda r: s_(r.get("person")) + " (" + s_(r.get("when_iso")) + ")")
    route_pending = _pending(routes_rows, lambda r: s_(r.get("folder")) or "Mail Other", lambda r: s_(r.get("hint")))
    import candidate_papers as CNDP  # noqa: PLC0415 - the gate the mail server's folders answer to
    held = CNDP.gate_holds(reads, MAIL_GATE)
    if held:
        log.info("staff alerts: the filing is held — %s", held)
    filed = [] if held else _file(creds, pending)
    route_filed = [] if held else _file(creds, route_pending)
    data = {"due": bool(reports or ai_rows or route_new or filed or route_filed or held_no_reader or held_refused),
            "reports": reports, "ai_rows": ai_rows, "routes": route_new, "filed": filed, "route_filed": route_filed,
            "folders": list(pending), "route_folders": list(route_pending),
            "held_no_reader": held_no_reader, "held_refused": held_refused, "threads": len(threads),
            "took_s": round(time.monotonic() - started, 2)}
    return {"status": 200, "data": R.seal(SWEEP, by, data)}


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {"staffAttendanceDue": attendance_due}
POLICY: dict[str, dict[str, Any]] = {"staffAttendanceDue": {}}
