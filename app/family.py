"""Families' reads (apps-script/FamilyProfiles.gs) off asa-hub-db: every family member the clients' records name."""
from __future__ import annotations

import functools
import json
import logging
import os
import re
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

import client_writes as CW
import family_registry as FR
import clients as C
import gsjs
import hubdb
import locations as L
import photos as P
import scope as sc
import staff_comms as SC
from gsjs import NY, SheetDate, name_key
from scope import Defer

log = logging.getLogger("asa-hub-app")

APP_ID = "family-profiles"
# the operator's access sheet (10-29): Families & Guardians is open to Family, shut to the SSA
VIEW_KINDS = ("all", "client", "guardian")
NARROW_KINDS = ("isp", "calendar", "incident")
NOTES_TAB = "family_notes"
NOTE_MAX = 4000
CALL_PRIORITIES = ("normal", "high", "urgent")
CALL_SOURCE = "families"
PACK_PARTS = ("overview", "documents", "activity", "notes")
ACTIVITY_DAYS = 365
CALENDAR_AHEAD_DAYS = 30
ACTIVITY_CAP = 400
MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
MIMES = {"pdf": "application/pdf", "png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "gif": "image/gif",
         "doc": "application/msword",
         "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document"}
# FAM_PACK_BUDGET_MS for this engine: the relay waits HUB_APP_PACK_TIMEOUT_S (60 s) for a whole pack
PACK_BUDGET_S = float(os.getenv("HUB_APP_FAMILY_PACK_BUDGET_S", "40"))
NOT_GATHERED = "This part was not gathered in this pack; it is read on its own."
# why a part was left, in the pack's log, when no door said why
PAST_BUDGET = "past the pack's budget"
# MyFamily.gs MY_FAMILY_TASK_WORDS
TASK_WORDS = {"backlog": "Backlog", "this-week": "This week", "in-progress": "In progress", "review": "Review",
              "done": "Done"}
SOURCE_LABELS = {"registry": "Families registry", "record": "Client record", "isp": "ISP important people",
                 "directory": "People directory"}
DOC_REFUSED_CATEGORIES = ("identity", "medical", "receipt_invoice", "insurance")
# FAM_EDITION_*: the edition each write belongs to (Editions.gs EDITIONS)
EDITION = {"profile": "family.profile", "notes": "family.notes", "calls": "family.calls", "create": "family.create",
           "documents": "family.documents",
           "incidents": "family.incidents"}
# FAM_EDIT_RENAME: a rename is the master's own, never an edition's
RENAME_LOCK = {"why": "A new name re-keys the family member and moves their admin notes; this edition does not open it.",
               "door": ""}
# the admin notes: the master, and whom App Control's Notes row names; with no badges on it, a badge from ADMIN up
# (Supervisor, Director…)
NOTES_FEATURE = "family-profiles.notes"
NOTES_FLOOR = "ADMIN"
# a removed note keeps its row under this kind: no reader lists it as a note
NOTE_REMOVED = "note_removed"
NOTE_STATES = ("open", "removed")
NOTE_WITHHELD = {"why": "This note holds a number the platform withholds, so its text is not edited here; it can still "
                        "be removed.", "door": ""}
# a call card's column on the Task Board, and cancelled (Done with the label)
CALL_STATES = ("backlog", "this-week", "in-progress", "review", "done", "cancelled")
CALL_CANCELLED = "Cancelled"
CALL_DETAILS_MAX = 5000
CALL_WITHHELD = {"why": "The call's details hold a number the platform withholds, so they are not edited here.",
                 "door": ""}

_A = re.I | re.A
_WS = L._JS_WS
WORDS = re.compile(
    r"\b(step-?(?:mother|father|mom|dad|sister|brother|son|daughter|parent)|"
    r"(?:mother|father|sister|brother|son|daughter)[- ]in[- ]law|in-laws?|"
    r"grand(?:mother|father|ma|pa|parents?|son|daughter|child(?:ren)?)|great[- ]?(?:aunt|uncle)|"
    r"half[- ]?(?:brother|sister)|mother|father|mom|mommy|mum|dad|daddy|parents?|sisters?|brothers?|siblings?|"
    r"aunt|auntie|uncle|cousin|son|daughter|spouse|wife|husband|niece|nephew|family|relative)\b", _A)
NOT_FAMILY_ROLES = re.compile(
    r"\b(ssa|case manager|case ?worker|support administrat\w*|physician|doctor|pcp|medical provider|home provider|"
    r"provider|employer|therapist|pharmacy|payee|nurse|dentist|roommate|social worker|job coach|coordinator|"
    r"counsel+or|psychiatrist|psychologist|teacher|dsp)\b", _A)
PLAN_TABLE_END = re.compile(r"(Important Places|Important To\b|Important For\b|Discovery Assessment)", _A)
# a record's guardian who is a friend or the like is the client's own people, never an appointed office: the FAMILY
# badge's wearer (the operator, 10-30: FAMILY is whoever the client records name as guardian)
PERSONAL_TIE = re.compile(r"\b(friends?|family friend|god-?(?:mother|father|parent)|neighbou?r|partner|fianc[eé]e?|"
                          r"girlfriend|boyfriend)\b", _A)
BARE_GUARDIAN_REL = re.compile(r"(n/?a|none|unknown|guardian|legal guardian|guardian(ship)? of (the )?person)", re.I)
APPOINTED_TEXT = re.compile(r"\b(state|court)[- ]appointed\b|\bprofessional (guardian|services)\b|"
                            r"\bguardianship services\b|\bagency\b", _A)
ORG = re.compile(r"\b(services?|agency|inc|llc|board|office|probate|guardianship|program|center|centre|association|"
                 r"trust|bank|hospital|clinic|department|dept|court|corp|company|group|foundation|society|county|"
                 r"ministries)\b", _A)
DOC_REFUSED_FOLDER = re.compile(r"\b(funds|receipts?)\b", _A)
GUARDIANSHIP_DOC = re.compile(r"guardianship|letters? of (authority|guardianship)", re.I)
_ID_KIND = re.compile(r"ssn|social.?security|identity|licen[cs]e|state_id|birth|passport", re.I)
_PLAN_HEAD = re.compile(r"Important People\b", _A)
_PLAN_STOP = re.compile(r"(?:" + "|".join(x for x in C.STOP_LABELS if x != "Important People") + ")", _A)
_TAIL = re.compile(r"[" + _WS + r"]*[/\-–—][" + _WS + r"]*([^/\-–—]*)\Z", re.A)
_SSN_SPACED = re.compile(r"(^|\D)\d{3}[" + _WS + r".-]\d{2}[" + _WS + r".-]\d{4}(?=\D|\Z)", re.A)
_CARD_SPACED = re.compile(r"(^|\D)\d(?:[ -]?\d){12,18}(?=\D|\Z)", re.A)
_EMAIL = re.compile(r"[^" + _WS + r"@]+@[^" + _WS + r"@]+\.[a-z]{2,}", re.A)
_KEY = re.compile(r"fam_[a-z0-9]{3,120}", re.A)
_DAY = re.compile(r"\d{4}-\d{2}-\d{2}", re.A)
_EDIT_FIELD = re.compile(r"[a-z][a-z0-9_]{0,63}", re.A)

_keys = SC._js_keys
_digits10 = SC._digits10


def _try(fn: Callable[[], Any]) -> tuple[bool, Any, str]:
    """A try/catch of the .gs: (ok, value, why); the database's own failures are never swallowed."""
    try:
        return True, fn(), ""
    except (hubdb.Unreadable, Defer):
        raise
    except Exception as e:  # noqa: BLE001 - the code being ported says why in words
        return False, None, L._why(e)


# ---- pure helpers ---------------------------------------------------------------------------------------------------

def unknown() -> dict[str, Any]:
    """familyProfilesUnknown_."""
    return {"status": 404, "message": "Unknown action."}


def _lt(v: Any, n: int = 0) -> str:
    """locationsText_: JavaScript's whitespace runs as one space, trimmed, cut to n UTF-16 units."""
    s = gsjs.trim(CW.fold_ws(gsjs.or_blank(v)))
    return SC._js_slice(s, n) if n else s


def _cmp(fn: Callable[[Any, Any], int]) -> Callable[[Any], Any]:
    return functools.cmp_to_key(fn)


def title(s: Any) -> str:
    """famTitle_."""
    t = gsjs.trim(gsjs.or_text(s)).lower()
    return t[:1].upper() + t[1:] if t else ""


def relation(text: Any) -> str:
    """famRelation_: the family word a text carries, first letter up."""
    m = WORDS.search(gsjs.or_blank(text))
    return title(m.group(1)) if m else ""


def key_of(name: Any) -> str:
    """famKeyOf_: 'fam_' + the folded name; '' for a blank, a non-person or an organisation."""
    n = _lt(name, 200)
    if not n or not C.guardian_is_person(n) or ORG.search(n):
        return ""
    fold = name_key(n)
    return "fam_" + fold if len(fold) >= 3 else ""


def fam_name(raw: Any) -> str:
    """famName_: the guardian roster's name, a trailing family word after a dash or slash dropped."""
    s = _lt(C.guardian_display_name(raw), 120)
    m = _TAIL.search(s)
    if m and WORDS.search(m.group(1)):
        s = s[:m.start()] + s[m.end():]
    return gsjs.trim(s)


def only_relation(name: Any) -> bool:
    """famOnlyRelation_."""
    t = gsjs.trim(re.sub(r"[^a-zA-Z" + _WS + r"\-]", "", _lt(name), flags=re.A))
    m = WORDS.search(t)
    return bool(m) and m.start() == 0 and len(m.group(0)) == len(t)


def plan_key(name: Any, client_fold: str) -> str:
    """famPlanKey_: a first name alone is keyed to its client."""
    if only_relation(name):
        return ""
    k = key_of(name)
    return k + client_fold if k and len(tokens(name)) < 2 else k


def email(v: Any) -> str:
    """famEmail_."""
    s = _lt(v, 200).lower()
    return s if _EMAIL.fullmatch(s) else ""


def address(v: Any) -> str:
    """famAddress_: the relationship word the table wrapped onto the start dropped."""
    s = _lt(v, 300)
    m = WORDS.search(s)
    if m and not re.search(r"[^" + _WS + r"(]", s[:m.start()], re.A):
        s = s[m.end():]
    return gsjs.trim(re.sub(r"^[" + _WS + r"(),:;\-–—]+", "", s, flags=re.A))


def tokens(name: Any) -> list[str]:
    """famTokens_."""
    return [t for t in (name_key(x) for x in _lt(name).split(" ")) if t]


def rel_class(rel: Any) -> str:
    r = gsjs.trim(gsjs.or_text(rel)).lower()
    if re.fullmatch(r"mom|mother|mommy|mum", r):
        return "mother"
    if re.fullmatch(r"dad|father|daddy", r):
        return "father"
    return ""


def same_person(a: dict, b: dict) -> bool:
    """famSamePerson_."""
    ta, tb = tokens(a["name"]), tokens(b["name"])
    pa, pb = _digits10(a["phone"]), _digits10(b["phone"])
    if len(ta) >= 2 and len(tb) >= 2 and ta[-1] == tb[-1] and len(ta[0]) >= 3 and ta[0][:3] == tb[0][:3]:
        return not (pa and pb and pa != pb) and not (a["email"] and b["email"] and a["email"] != b["email"])
    cls = rel_class(a["relationship"])
    if not cls or cls != rel_class(b["relationship"]):
        return False
    return (bool(pa) and pa == pb) or (bool(a["email"]) and a["email"] == b["email"])


def record_tie(rel: Any, segment: Any) -> dict[str, Any]:
    """famRecordTie_: family, not family, or unknown (None)."""
    r = _lt(rel, 80)
    said = relation(r)
    if said:
        return {"family": True, "relationship": said}
    if PERSONAL_TIE.search(r) and not APPOINTED_TEXT.search(r):
        return {"family": True, "relationship": r}
    if r and not BARE_GUARDIAN_REL.fullmatch(re.sub(r"[." + _WS + r"]+\Z", "", r, flags=re.A)):
        return {"family": False, "relationship": r}
    said = relation(segment)
    if said:
        return {"family": True, "relationship": said}
    if APPOINTED_TEXT.search(gsjs.or_text(segment)):
        return {"family": False, "relationship": ""}
    return {"family": None, "relationship": "Guardian"}


def plan_tie(p: dict | None) -> dict[str, Any] | None:
    """famPlanTie_."""
    role = _lt((p or {}).get("role"), 120)
    if not role or NOT_FAMILY_ROLES.search(role):
        return None
    said = relation(p.get("name")) or relation(role)
    return {"family": True, "relationship": said} if said else None


def most(items: list) -> str:
    """famMost_: the most common non-blank value, the first seen on a tie."""
    count: dict[str, int] = {}
    best, n = "", 0
    for v in items or []:
        s = gsjs.or_text(v)
        if not s:
            continue
        count[s] = count.get(s, 0) + 1
        if count[s] > n:
            best, n = s, count[s]
    return best


def pick(items: list[dict]) -> str:
    """famPick_."""
    return most([x["v"] for x in items if x["active"]]) or most([x["v"] for x in items])


def mime(name: Any) -> str:
    """famMime_."""
    m = re.search(r"\.([a-z0-9]{2,5})[" + _WS + r"]*\Z", gsjs.or_text(name), _A)
    return MIMES.get(m.group(1).lower(), "") if m else ""


def _parse_ms(s: str) -> int | None:
    """Date.parse on the script's New York clock; None for NaN."""
    got = C._v8_parse(s)
    if got is None:
        return None
    year, month0, d, h, mi, sec, ms, offset = got
    y = year + month0 // 12
    days = C._days_from_civil(y, month0 % 12 + 1, 1) + d - 1
    local_ms = days * 86400000 + h * 3600000 + mi * 60000 + sec * 1000 + ms
    if offset is not None:
        utc_ms = local_ms - offset * 1000
    else:
        yy, mm, dd = C._civil_from_days(local_ms // 86400000)
        if not 1 <= yy <= 9998:
            raise Defer("a date outside what this engine's clock reads")
        wall = datetime(yy, mm, dd) + timedelta(milliseconds=local_ms % 86400000)
        utc_ms = int(round(wall.replace(tzinfo=NY).timestamp() * 1000))
    return None if abs(utc_ms) > 8.64e15 else utc_ms


def when(v: Any) -> str:
    """famWhen_: a Date as ISO, an ISO cell as written, any other date text parsed; '' otherwise."""
    if isinstance(v, SheetDate):
        return gsjs.iso(v.at)
    s = gsjs.trim(gsjs.or_blank(v))
    if not s or re.match(r"\d{4}-\d{2}-\d{2}", s, re.A):
        return s
    t = _parse_ms(s)
    if t is None:
        return ""
    at = datetime(1970, 1, 1, tzinfo=timezone.utc) + timedelta(milliseconds=t)
    if not 1 <= at.year <= 9999:
        raise Defer("a date outside what this engine's clock writes")
    return gsjs.iso(at)


def _cell_when(v: Any, direct: bool, zone: str = "") -> str:
    """famWhen_ of a cell spReadColumns_ hands back, on its book's clock (a straight copy keeps a serial number)."""
    return when(SC._dated(v, direct, zone))


_newest =_cmp(lambda a, b: 1 if a["at"] < b["at"] else (-1 if a["at"] > b["at"] else 0))


def day_words(iso: Any) -> str:
    """famDayWords_: "2026-09-15" → "Sep 15, 2026"."""
    m = re.fullmatch(r"(\d{4})-(\d{2})-(\d{2})", gsjs.or_text(iso), re.A)
    return f"{MONTHS[int(m.group(2)) - 1]} {int(m.group(3))}, {m.group(1)}" if m else gsjs.or_text(iso)


def named(names: list, cells: list) -> bool:
    """famNamed_: one of the person's whole folded names inside a cell."""
    keys = [k for k in (name_key(n) for n in names or []) if len(k) >= 5]
    if not keys:
        return False
    for c in cells or []:
        hay = name_key(c)
        if hay and any(k in hay for k in keys):
            return True
    return False


def doc_served(r: dict | None) -> bool:
    """famDocServed_: a plan the Clients door serves or a guardianship paper, never an identity or money paper."""
    if not r or gsjs.trim(gsjs.or_text(r.get("digest_category"))).lower() in DOC_REFUSED_CATEGORIES:
        return False
    if DOC_REFUSED_FOLDER.search(gsjs.or_text(r.get("folder"))):
        return False
    if C.plan_file(r):
        return True
    if _ID_KIND.search(gsjs.or_text(r.get("doc_kind"))):
        return False
    return gsjs.trim(gsjs.or_text(r.get("doc_kind"))).lower() == "guardianship" or \
        bool(GUARDIANSHIP_DOC.search(gsjs.or_text(r.get("title")) + " " + gsjs.or_text(r.get("folder"))))


def scrub(v: Any, key: str | None = None) -> Any:
    """famScrub_: cpScrub_, and an SSN or a card number written with spaces, dots or dashes."""
    if key and key in C.SCRUB_KEYS:
        return v
    if isinstance(v, str):
        return C.scrub(_CARD_SPACED.sub(r"\1[withheld]", _SSN_SPACED.sub(r"\1[withheld]", v)))
    if isinstance(v, list):
        return [scrub(x) for x in v]
    if isinstance(v, dict):
        return {k: scrub(x, k) for k, x in v.items()}
    return C.scrub(v)


def shown(data: Any) -> dict[str, Any]:
    """A 200 answer; a cell the copy withholds is Apps Script's to show."""
    if C._marked(data):
        raise Defer("the copy withholds a cell this answer shows")
    return {"status": 200, "data": data}


def drive_id(v: Any) -> str:
    """famDriveId_: a link or a bare id; '' for "Yes", "No" and the like."""
    s = _lt(v, 500)
    return L.drive_id(s) or (s if re.fullmatch(r"[A-Za-z0-9_-]{25,}", s, re.A) else "")


def house_code(house: Any) -> str:
    return L.house_code(house) or L.code_of(house)


def _join(*vals: Any) -> str:
    """[…].join(' '): null and undefined as blanks."""
    return "\n".join("" if v is None else gsjs.js_str(v) for v in vals)


def _get(o: dict | None, k: str) -> Any:
    return (o or {}).get(k)


# ---- the index ------------------------------------------------------------------------------------------------------

def master_kept(fields: dict | None, row: dict | None) -> dict[str, Any]:
    """famMasterKept_: the Master fields less the columns the Hub record cleared on purpose."""
    out = dict(fields or {})
    for col in C.edit_cleared((row or {}).get("cleared_fields")):
        for n in L.CP_FIELD_NAMES.get(col, (col,)):
            out.pop(n, None)
    return out


def isps_by_key(reads: L.Reads) -> dict[str, dict]:
    """famIspsByKey_: the first plan row of each client."""
    out: dict[str, dict] = {}
    for r in C._hub(reads, "isps"):
        k = gsjs.trim(gsjs.or_text(r.get("client_key")))
        if k and k not in out:
            out[k] = r
    return out


def plan_sections(reads: L.Reads) -> dict[str, list[dict]]:
    """famPlanSections_."""
    out: dict[str, list[dict]] = {}
    for r in C.own_rows(reads, C.SECTIONS_TAB):
        if gsjs.or_blank(r.get("section")) != "important_people":
            continue
        k = gsjs.trim(gsjs.or_text(r.get("client_key")))
        if k:
            out.setdefault(k, []).append(r)
    return out


def plan_table(text: Any) -> str:
    """famPlanTable_: the Important People table alone, up to the next section."""
    lines = C.plan_lines(text)
    at = next((i for i, ln in enumerate(lines) if _PLAN_HEAD.match(ln)), -1)
    if at == -1:
        return ""
    out = [lines[at]]
    for ln in lines[at + 1:]:
        if PLAN_TABLE_END.match(ln) or _PLAN_STOP.match(ln):
            break
        out.append(ln)
    return "\n".join(out)


def plan_people(key: str, isp: dict | None, sections: dict[str, list[dict]]) -> dict[str, Any]:
    """famPlanPeople_: the filed section of the plan year, else the contact page."""
    text = ""
    year = _lt(_get(isp, "isp_year"))
    for r in sections.get(key) or []:
        if not text or gsjs.or_blank(r.get("isp_year")) == year:
            text = gsjs.or_text(r.get("text"))
    if not text and isp:
        text = gsjs.or_text(isp.get("contact_block"))
    table = plan_table(text)
    return {"text": table, "people": C.isp_people(table)}


def index_build(reads: L.Reads) -> dict[str, Any]:
    """famIndexBuild_: every family member the clients' records name, keyed fam_<folded name>."""
    why: list[str] = []
    degraded = False

    def soft(what: str, fn: Callable[[], Any], fallback: Any) -> Any:
        nonlocal degraded
        ok, got, err = _try(fn)
        if ok:
            return got
        why.append(f"{what} could not be read ({err}).")
        degraded = True
        return fallback

    active = soft("The client records", lambda: C.derived(reads), None)
    master = soft("The Asa Client Database", lambda: C.master_index(reads), None)
    arch = soft("The archive of old clients", lambda: C.archive_index(reads), None)
    if active is None and arch is None:
        raise RuntimeError(" ".join(why))
    ok, photos, _w = _try(lambda: C.photo_index(reads))
    photos = photos if ok and photos else {}
    isps = soft("The plans", lambda: isps_by_key(reads), {})
    sections = soft("The plans' important people", lambda: plan_sections(reads), {})
    people = soft("The people directory", lambda: C._hub(reads, "people"), [])
    registry = soft("The Families registry", lambda: FR.registry(reads), {})

    clients: list[dict] = []
    by_fold: dict[str, dict] = {}
    seen: dict[str, bool] = {}
    hub: dict[str, bool] = {}

    def add_record(cl: dict, name: Any, rel: Any, segment: Any, phone: Any, mail: Any, addr: Any, plan: str) -> None:
        judged = record_tie(rel, segment)
        n = fam_name(name)
        tie = {"key": key_of(n), "name": n, "relationship": judged["relationship"], "family": judged["family"],
               "source": "record", "phone": C.cp_phone(phone), "email": email(mail), "address": _lt(addr, 300),
               "in_plan": named([n, name], [plan])}
        if tie["key"]:
            cl["record_key"] = tie["key"]
            cl["ties"].append(tie)

    for c in active or []:
        row = C.roster_row(c, photos)
        if not row["client_key"] or seen.get(row["client_key"]):
            continue
        seen[row["client_key"]] = True
        fold = name_key(row["name"])
        m = master["rows"].get(fold) if master else None
        # set inactive, its Master row went to the archive: that row still names its guardian
        if not m and arch and not C.client_live(row):
            m = arch["rows"].get(fold) or None
        mf = master_kept(m["fields"], c) if m and not m["ambiguous"] else {}
        isp = isps.get(row["client_key"]) or None
        plan = plan_people(row["client_key"], isp, sections)
        plan_text = _join(plan["text"], _get(isp, "contact_block") if isp else None,
                          _get(isp, "contacts") if isp else None, c.get("contacts"))
        cl = {"client_key": row["client_key"], "fold": fold, "name": row["name"], "house": row["house"],
              "status": row["status"], "avatar": row["avatar"],
              "isp_year": _lt(C._or(_get(isp, "isp_year") if isp else None, row["isp_year"])),
              "isp_day": C.cp_day(C._or(c.get("isp_signed_date"), mf.get("isp_signed_date")))
              or C.cp_day(_get(isp, "loaded_at") if isp else None),
              "papers": drive_id(C._or(c.get("guardianship_papers"), mf.get("guardianship_papers"))),
              "archived": False, "record_key": "", "record_blank": False, "ties": []}
        g_hub = _lt(C._or(c.get("guardianName"), c.get("guardian_name")), 200)
        g_master = _lt(mf.get("guardian_name"), 200)
        cl["record_blank"] = not g_hub and not g_master
        src = c if C.guardian_is_person(g_hub) else (mf if not g_hub and C.guardian_is_person(g_master) else None)
        if src is not None:
            if src is c:
                hub[row["client_key"]] = True
            g_raw = g_hub if src is c else g_master

            def same(o: dict, n: Any, g_raw: str = g_raw) -> dict:
                return o if name_key(fam_name(n)) == name_key(fam_name(g_raw)) else {}

            a, b = same(c, g_hub), same(mf, g_master)
            add_record(cl, g_raw, C._or(a.get("guardian_relationship"), b.get("guardian_relationship")),
                       C.guardian_segment(c.get("contacts")),
                       C._or(a.get("guardian_phone"), b.get("guardian_phone")),
                       C._or(a.get("guardian_email"), b.get("guardian_email")),
                       C._or(a.get("guardian_address"), b.get("guardian_address")), plan_text)
        plan_seen: dict[str, bool] = {}
        for p in plan["people"]:
            n = fam_name(p.get("name"))
            k = plan_key(n, fold)
            if not k or plan_seen.get(k) or k == "fam_" + fold:
                continue
            judged = plan_tie(p)
            if not judged:
                continue
            plan_seen[k] = True
            cl["ties"].append({"key": k, "name": n, "relationship": judged["relationship"], "family": True,
                               "source": "isp", "phone": C.cp_phone(p.get("phone")), "email": email(p.get("email")),
                               "address": address(p.get("address")), "in_plan": True})
        clients.append(cl)
        by_fold[fold] = cl
    if arch:
        for k in arch["order"]:
            hit = arch["rows"].get(k)
            if not hit or hit["ambiguous"] or seen.get(k) or k in by_fold:
                continue
            seen[k] = True
            f = hit["fields"] or {}
            cl = {"client_key": k, "fold": k, "name": _lt(hit["name"]), "house": _lt(f.get("house")),
                  "status": "inactive", "avatar": P.of(reads, "clients", k, photos.get(k)), "isp_year": "",
                  "isp_day": C.cp_day(f.get("isp_signed_date")), "papers": drive_id(f.get("guardianship_papers")),
                  "archived": True, "record_key": "", "record_blank": not _lt(f.get("guardian_name")), "ties": []}
            if C.guardian_is_person(f.get("guardian_name")):
                add_record(cl, f.get("guardian_name"), f.get("guardian_relationship"), "", f.get("guardian_phone"),
                           f.get("guardian_email"), f.get("guardian_address"), "")
            clients.append(cl)
            by_fold[k] = cl

    # one person under two spellings of one client's record and plan answers to the record's key
    aliases: dict[str, str] = {}
    for cl in clients:
        rec = None
        for t in cl["ties"]:
            if t["source"] == "record":
                rec = t
        if rec is None:
            continue
        for t in cl["ties"]:
            if t is rec or t["key"] == rec["key"] or t["key"] in aliases:
                continue
            if same_person(rec, t):
                aliases[t["key"]] = rec["key"]

    def canon(k: str) -> str:
        return aliases.get(k) or k

    directory: dict[str, dict] = {}
    for p in people:
        guardian = gsjs.trim(gsjs.or_text(p.get("role"))).lower() == "guardian" or bool(_lt(p.get("guardian_for")))
        if not guardian:
            continue
        n = fam_name(p.get("name"))
        k = canon(key_of(n))
        if not k:
            continue
        if k not in directory:
            directory[k] = {"person_id": gsjs.or_text(p.get("id")), "avatar": _lt(p.get("avatar"), 500)}
        for who in gsjs.or_text(p.get("guardian_for")).split(","):
            cl = by_fold.get(name_key(who))
            if not cl:
                continue
            if not (canon(cl["record_key"]) == k if cl["record_key"] else cl["record_blank"]):
                continue
            cl["ties"].append({"key": k, "name": n, "relationship": "Guardian", "family": None, "source": "directory",
                               "phone": C.cp_phone(p.get("phone")), "email": email(p.get("email")), "address": "",
                               "in_plan": False})

    # the family members a director or the master registered (db/families.sql), each tied to the clients it names
    by_client = {cl["client_key"]: cl for cl in clients}
    for k, r in registry.items():
        for t in r["clients"]:
            cl = by_client.get(t["client_key"])
            if cl is None:
                continue
            cl["ties"].append({"key": k, "name": r["name"], "relationship": t["relationship"] or r["relationship"]
                               or "Family", "family": True, "source": FR.SOURCE, "phone": C.cp_phone(r["phone"]),
                               "email": email(r["email"]), "address": _lt(r["address"], 300), "in_plan": False})

    def rank(t: dict) -> int:
        if t["family"] is True:
            return 0 if t["source"] == "record" else 1
        return 2 if t["family"] is None else 3

    acc: dict[str, dict] = {}
    for cl in clients:
        live = C.client_live(cl)
        for t in cl["ties"]:
            k = canon(t["key"])
            a = acc.get(k)
            if a is None:
                a = acc[k] = {"names": [], "phones": [], "emails": [], "addresses": [], "by_client": {},
                              "family": False, "unknown": False, "appointed": False}
            if t["family"] is True:
                a["family"] = True
            elif t["family"] is None:
                a["unknown"] = True
            else:
                a["appointed"] = True
            a["names"].append({"v": t["name"], "active": live})
            if _digits10(t["phone"]):
                a["phones"].append({"v": t["phone"], "active": live})
            if t["email"]:
                a["emails"].append({"v": t["email"], "active": live})
            if t["address"]:
                a["addresses"].append({"v": t["address"], "active": live})
            had = a["by_client"].get(cl["client_key"])
            if had is None:
                had = a["by_client"][cl["client_key"]] = {"client": cl, "tie": t, "in_plan": False, "sources": {}}
            had["sources"][t["source"]] = True
            if t["in_plan"]:
                had["in_plan"] = True
            if rank(t) < rank(had["tie"]):
                had["tie"] = t

    families: dict[str, dict] = {}
    phones: dict[str, dict[str, bool]] = {}
    houses: dict[str, dict[str, bool]] = {}
    for k in _keys(acc):
        a = acc[k]
        if not a["family"] and not (a["unknown"] and not a["appointed"]):
            continue
        mine = [a["by_client"][ck] for ck in _keys(a["by_client"])]
        mine = [x for x in mine if x["tie"]["family"] is not False]
        if not mine:
            continue
        mine.sort(key=_cmp(lambda x, y: (0 if x["client"]["status"] == y["client"]["status"]
                                         else (-1 if x["client"]["status"] == "active" else 1))
                           or gsjs.locale_cmp(x["client"]["name"], y["client"]["name"])))
        rels: list[str] = []
        rel_seen: set[str] = set()
        for x in mine:
            r = x["tie"]["relationship"] or "Guardian"
            if r.lower() not in rel_seen:
                rel_seen.add(r.lower())
                rels.append(r)
        digits: dict[str, bool] = {}
        for p in a["phones"]:
            digits[_digits10(p["v"])] = True
        for d in _keys(digits):
            phones.setdefault(d, {})[k] = True
        names: list[str] = []
        for x in a["names"]:
            if x["v"] not in names:
                names.append(x["v"])
        d = directory.get(k) or {}
        frm: dict[str, bool] = {}
        for x in mine:
            frm.update(x["sources"])
        fam = {"key": k, "name": pick(a["names"]), "names": names, "relationships": rels,
               "relationship": rels[0] if rels else "Guardian", "phone": pick(a["phones"]),
               "email": pick(a["emails"]), "address": pick(a["addresses"]),
               "avatar": P.of(reads, "family", k, d.get("avatar") or photos.get(k[4:])),
               "person_id": d.get("person_id") or "",
               "sources": [SOURCE_LABELS[s] for s in (FR.SOURCE, "record", "isp", "directory") if frm.get(s)],
               "status": "active" if any(C.client_live(x["client"]) for x in mine) else "inactive",
               "phones": _keys(digits),
               "clients": [{"client_key": x["client"]["client_key"], "name": x["client"]["name"],
                            "relationship": x["tie"]["relationship"] or "Guardian", "house": x["client"]["house"],
                            "status": x["client"]["status"], "avatar": x["client"]["avatar"],
                            "isp_year": x["client"]["isp_year"], "isp_day": x["client"]["isp_day"],
                            "papers": x["client"]["papers"], "archived": x["client"]["archived"],
                            "in_plan": bool(x["in_plan"])} for x in mine]}
        for c in fam["clients"]:
            code = house_code(c["house"]) if c["status"] == "active" else ""
            if code:
                houses.setdefault(code, {})[k] = True
        families[k] = fam
    # what the registry holds stands over what the records spell: name, relationship, phone, e-mail and address
    for k, r in registry.items():
        fam = families.get(canon(k))
        if fam is None:
            continue
        fam["name"] = r["name"] or fam["name"]
        fam["relationship"] = r["relationship"] or fam["relationship"]
        fam["phone"] = C.cp_phone(r["phone"]) or fam["phone"]
        fam["email"] = email(r["email"]) or fam["email"]
        fam["address"] = _lt(r["address"], 300) or fam["address"]
        fam["registered"] = {"by": r["created_by_name"] or r["created_by"], "at": r["created_at"]}
    # the family member each client's own record names as its guardian
    records = {cl["client_key"]: canon(cl["record_key"]) for cl in clients if cl["record_key"]}
    return {"families": families, "aliases": aliases, "phones": phones, "houses": houses, "records": records,
            "hub": hub, "why": why, "degraded": degraded}


def index(reads: L.Reads) -> dict[str, Any]:
    """famIndex_, once per request."""
    return reads.once("fam_index", lambda: index_build(reads))


def family_ctx(reads: L.Reads, raw: Any) -> dict[str, Any]:
    """familyProfilesFamily_: 400 when no record names the key, 503 when the records cannot say."""
    key = gsjs.trim(gsjs.or_blank(raw))
    none = {"refused": {"status": 400, "message": f'No family member "{SC._js_slice(key, 120)}" is on file.'}}
    if not _KEY.fullmatch(key):
        return none
    ok, idx, err = _try(lambda: index(reads))
    if not ok:
        return {"refused": {"status": 503, "message": f"The client records could not be read just now ({err}) — "
                                                      "nothing is said about this family member."}}
    canon = idx["aliases"].get(key) or key
    f = idx["families"].get(canon)
    if not f:
        if idx["degraded"]:
            return {"refused": {"status": 503, "message": "Not every client record could be read just now ("
                                + SC._js_slice(" ".join(idx["why"]), 200)
                                + ") — nothing is said about this family member."}}
        return none
    return {"key": canon, "name": f["name"], "family": f, "index": idx, "why": list(idx["why"]),
            "degraded": bool(idx["degraded"])}


def serve(reads: L.Reads, part: str, ctx: dict, what: str, build: Callable[[], Any]) -> dict[str, Any]:
    """famServe_: one read's answer; 503 names the source when the build throws."""
    ok, data, err = _try(lambda: reads.once(f"fam_{part}:{ctx['key']}", lambda: scrub(build())))
    if not ok:
        return {"status": 503, "message": f"{what} could not be read just now ({err})."}
    return shown(data)


# ---- the viewer's cut -----------------------------------------------------------------------------------------------

def view_of(sess: L.Session) -> dict[str, Any] | None:
    """familyProfilesGate_: { kind, scope, user, notes } — the master, or whom App Control releases the app to, and
    whether a whole viewer reads the admin notes."""
    user = sess.user
    if sc.is_real_master(user):
        return {"kind": "master", "scope": None, "user": user}
    try:
        gate = sc.profile_app_gate(APP_ID, user, sess.reads.scope_sources())
    except (Defer, hubdb.Unreadable):
        raise
    except Exception:  # noqa: BLE001 - FAIL-CLOSED, as the gate's try/catch
        gate = None
    kind = gsjs.str_(gate["scope"].get("kind")) if gate and gate.get("open") and gate.get("scope") else ""
    if kind not in VIEW_KINDS:
        return None
    return {"kind": kind, "scope": gate["scope"], "user": user,
            "notes": kind == "all" and notes_open(sess.reads.scope_sources(), user)}


def notes_open(src: sc.ScopeSources, user: dict[str, Any] | None) -> bool:
    """The admin notes for a whole viewer: App Control's Notes row (NOTES_FEATURE) when it names badges, else a badge
    from NOTES_FLOOR up."""
    if (src.rules().get("rules") or {}).get(NOTES_FEATURE):
        return sc.profile_app_gate(NOTES_FEATURE, user, src).get("open") is True
    return sc.wears_from(user or {}, NOTES_FLOOR)


def view_all(view: dict) -> bool:
    return view["kind"] in ("master", "all")


def edition_door(sess: L.Session, edition: str) -> dict[str, Any] | None:
    """famEditionDoor_: the master; else a listed holder of the edition whose release reads every family member."""
    if sc.is_real_master(sess.user):
        return None
    if edition not in {e for e, _a in sc.EDITIONS}:
        raise Defer("this engine's catalogue does not carry the edition")
    if not sc.edition_allows(edition, sess.user or {}, sess.reads.config()):
        return unknown()
    view = view_of(sess)
    return None if view and view_all(view) else unknown()


def view_clients(view: dict) -> dict[str, bool]:
    """famViewClients_."""
    return {gsjs.str_(k): True for k in (view.get("scope") or {}).get("client_keys") or [] if gsjs.str_(k)}


def notes_seen(view: dict) -> bool:
    """Who reads the admin notes (their tab, and their lines in the Activity): the master, or a whole viewer the notes
    are open to (notes_open, decided as view_of builds the view)."""
    return view["kind"] == "master" or (view["kind"] == "all" and view.get("notes") is True)


def notes_out(data: dict) -> dict:
    """An activity answer without its admin notes."""
    items = [i for i in data.get("items") or [] if not (isinstance(i, dict) and i.get("kind") == "note")]
    gone = len(data.get("items") or []) - len(items)
    return {**data, "items": items, "total": max(0, int(data.get("total") or 0) - gone)}


def view_words(view: dict) -> dict[str, Any]:
    return {"kind": view["kind"], "notes": notes_seen(view)}


def view_opens(view: dict, idx: dict) -> dict[str, bool]:
    """famViewOpens_: the family of a narrowed viewer's own clients (a FAMILY account's are the clients whose records
    name it, scope.client_scope)."""
    mine = view_clients(view)
    return {k: True for k in _keys(idx["families"])
            if any(mine.get(c["client_key"]) for c in idx["families"][k]["clients"])}


def view_family(reads: L.Reads, view: dict, payload: dict) -> dict[str, Any]:
    """famViewFamily_: to a narrowed viewer any key it may not open is 404."""
    ctx = family_ctx(reads, payload.get("family"))
    if view_all(view):
        return ctx
    if ctx.get("refused"):
        return ctx if ctx["refused"]["status"] == 503 else {"refused": unknown()}
    return ctx if view_opens(view, ctx["index"]).get(ctx["key"]) else {"refused": unknown()}


def view_serve(reads: L.Reads, view: dict, payload: dict, answer: Callable[[L.Reads, dict], dict],
               cut: Callable[[dict, dict, dict], dict] | None) -> dict[str, Any]:
    """famViewServe_: the door's own answer to a whole viewer, its cut to a narrowed one."""
    whole = view_all(view)
    if not whole and cut is None:
        return unknown()
    ctx = view_family(reads, view, payload)
    if ctx.get("refused"):
        return ctx["refused"]
    got = answer(reads, ctx)
    if whole or not got or got.get("status") != 200:
        return got
    return shown(scrub(cut(view, ctx, got["data"])))


def roster_cut(view: dict, idx: dict) -> dict[str, Any]:
    """famRosterCut_: the family members a narrowed viewer may open, each drawn from its own clients alone."""
    mine = view_clients(view)
    families = []
    for k in _keys(view_opens(view, idx)):
        f = idx["families"][k]
        cl = [c for c in f["clients"] if mine.get(c["client_key"])]
        families.append({"key": f["key"], "name": f["name"],
                         "relationship": (cl[0]["relationship"] if cl else "") or f["relationship"],
                         "phone": f["phone"], "email": f["email"], "clients": len(cl), "avatar": f["avatar"],
                         "status": "active" if any(C.client_live(c) for c in cl) else "inactive"})
    families.sort(key=L.by_name(lambda f: f["name"]))
    why = list(idx["why"])
    scope_why = gsjs.str_((view.get("scope") or {}).get("why"))
    if not families and view.get("scope") and scope_why:
        why.append(scope_why)
    return {"families": families, "why": why, "degraded": bool(idx["degraded"])}


def overview_cut(view: dict, ctx: dict, data: dict) -> dict[str, Any]:
    """famOverviewCut_: the details, and only the viewer's own clients."""
    mine = view_clients(view)
    clients = [c for c in data.get("clients") or [] if mine.get(c.get("client_key"))]
    rels: list[str] = []
    seen: set[str] = set()
    for c in clients:
        r = c.get("relationship") or "Guardian"
        if r.lower() not in seen:
            seen.add(r.lower())
            rels.append(r)
    f = data.get("family") or {}
    return {"family": {"key": f.get("key"), "name": f.get("name"), "relationships": rels, "phone": f.get("phone"),
                       "email": f.get("email"), "address": f.get("address"), "avatar": f.get("avatar"),
                       "sources": list(f.get("sources") or []), "person_id": "",
                       "status": "active" if any(C.client_live(c) for c in clients) else "inactive"},
            "clients": clients, "why": list(data.get("why") or []), "degraded": bool(data.get("degraded"))}


def documents_cut(view: dict, ctx: dict, data: dict) -> dict[str, Any]:
    """famDocumentsCut_."""
    mine = view_clients(view)
    return {"docs": [d for d in data.get("docs") or [] if mine.get(d.get("client_key"))],
            "why": list(data.get("why") or []), "degraded": bool(data.get("degraded"))}


def cal_code(item_id: Any) -> str:
    """famCalCode_: the house of a FAMILY shift item, from cal_<code>_<first day>."""
    s = gsjs.or_text(item_id)
    at = s.rfind("_")
    return s[4:at] if s.startswith("cal_") and at > 4 else ""


def activity_cut(view: dict, ctx: dict, data: dict) -> dict[str, Any]:
    """famActivityCut_: the plans, the FAMILY shifts at its own clients' houses and its own clients' incidents."""
    mine = view_clients(view)
    codes: dict[str, bool] = {}
    for c in ctx["family"]["clients"]:
        code = house_code(c["house"]) if mine.get(c["client_key"]) and c["status"] == "active" else ""
        if code:
            codes[code] = True
    ssa = view["kind"] == "ssa"
    whole = ssa and all(mine.get(c["client_key"]) for c in ctx["family"]["clients"])

    def keep(x: dict) -> bool:
        if x.get("kind") == "calendar":
            return bool(codes.get(cal_code(x.get("id"))))
        if x.get("kind") in NARROW_KINDS:
            return bool(mine.get(x.get("client_key")))
        if x.get("kind") == "scheduled_call":
            return ssa and bool(mine.get(x.get("client_key")))
        return whole and x.get("kind") in ("sms", "call")

    items = [x for x in data.get("items") or [] if keep(x)]
    return {"items": items, "total": len(items), "phones_matched": data.get("phones_matched") if whole else 0,
            "why": list(data.get("why") or []), "degraded": bool(data.get("degraded"))}


# ---- the roster and the overview ------------------------------------------------------------------------------------

def roster_build(reads: L.Reads) -> dict[str, Any]:
    """famRosterBuild_."""
    idx = index(reads)
    families = [{"key": f["key"], "name": f["name"], "relationship": f["relationship"], "phone": f["phone"],
                 "email": f["email"], "clients": len(f["clients"]), "status": f["status"], "avatar": f["avatar"]}
                for f in (idx["families"][k] for k in _keys(idx["families"]))]
    families.sort(key=L.by_name(lambda f: f["name"]))
    return {"families": families, "why": list(idx["why"]), "degraded": bool(idx["degraded"])}


def _labels(reads: L.Reads) -> dict[str, str]:
    return {h["code"]: h["home_name"] for h in reads.homes() if h.get("code") and h.get("home_name")}


def overview_build(reads: L.Reads, ctx: dict) -> dict[str, Any]:
    """famOverviewBuild_: the details and every client they are family of, the active ones first."""
    f, why, degraded = ctx["family"], list(ctx["why"]), ctx["degraded"]
    ok, labels, err = _try(lambda: _labels(reads))
    if not ok:
        why.append(f"The house registry could not be read ({err}).")
        degraded, labels = True, {}
    clients = []
    for c in f["clients"]:
        code = house_code(c["house"])
        clients.append({"client_key": c["client_key"], "name": c["name"], "relationship": c["relationship"],
                        "house": c["house"], "house_label": (labels.get(code) if code else "") or c["house"],
                        "avatar": c["avatar"], "status": c["status"]})
    return {"family": {"key": f["key"], "name": f["name"], "relationships": list(f["relationships"]),
                       "phone": f["phone"], "email": f["email"], "address": f["address"], "avatar": f["avatar"],
                       "status": f["status"], "sources": list(f["sources"]), "person_id": f["person_id"]},
            "clients": clients, "why": why, "degraded": degraded}


def overview_answer(reads: L.Reads, ctx: dict) -> dict[str, Any]:
    return serve(reads, "overview", ctx, "The family member", lambda: overview_build(reads, ctx))


# ---- documents ------------------------------------------------------------------------------------------------------

def files_for(reads: L.Reads, keys: list[str], name_keys: list[str]) -> list[dict]:
    """clientFilesFor_: every row of an owner (its key, else its folded name) the keys or the names select."""
    rows = C.client_files(reads)

    def owner(r: dict) -> str:
        return gsjs.trim(gsjs.or_blank(r.get("client_key"))) or "~" + name_key(r.get("client_name"))

    want = {gsjs.trim(gsjs.or_blank(k)) for k in keys if gsjs.trim(gsjs.or_blank(k))}
    names = set(name_keys)
    picked = {owner(r) for r in rows if owner(r) in want or name_key(r.get("client_name")) in names}
    return [r for r in rows if owner(r) in picked]


def documents_build(reads: L.Reads, ctx: dict) -> dict[str, Any]:
    """famDocumentsBuild_: the guardianship papers the record links, each plan, and the client files let through."""
    f, why, degraded = ctx["family"], list(ctx["why"]), ctx["degraded"]
    docs: list[dict] = []
    seen: set[str] = set()

    def add(d: dict) -> None:
        if not d["file_id"] or d["file_id"] in seen:
            return
        seen.add(d["file_id"])
        docs.append(d)

    by_key = {c["client_key"]: c for c in f["clients"]}
    by_name = {name_key(c["name"]): c for c in f["clients"]}
    for c in f["clients"]:
        if not c["papers"]:
            continue
        add({"id": "gp_" + c["client_key"], "title": "Guardianship papers — " + c["name"], "kind": "guardianship",
             "client_key": c["client_key"], "client_name": c["name"], "date": "", "file_id": c["papers"], "mime": "",
             "source": "Client record"})
    # Drive not listing the plans folder here is Apps Script's to answer (C.isp_files defers)
    C.isp_files(reads)
    for c in f["clients"]:
        ok, doc, _w = _try(lambda c=c: C.isp_doc(reads, c["name"]))
        doc = doc if ok and doc else {"id": ""}
        if not doc.get("id"):
            continue
        add({"id": "isp_" + c["client_key"], "title": _lt(doc.get("name")) or "Individual Service Plan", "kind": "isp",
             "client_key": c["client_key"], "client_name": c["name"], "date": c["isp_day"],
             "file_id": gsjs.js_str(doc["id"]), "mime": mime(doc.get("name")), "source": "Plans folder"})

    def client_docs() -> None:
        for r in files_for(reads, list(by_key), list(by_name)):
            c = by_key.get(gsjs.trim(gsjs.or_text(r.get("client_key")))) or by_name.get(name_key(r.get("client_name")))
            if not c or not doc_served(r):
                continue
            fid = gsjs.or_text(r.get("drive_id")) or L.drive_id(r.get("url"))
            folder = _lt(r.get("folder"))
            add({"id": "cf_" + (gsjs.or_text(r.get("id")) or fid),
                 "title": _lt(r.get("title")) or folder or "Client document", "kind": "client_doc",
                 "client_key": c["client_key"], "client_name": c["name"],
                 "date": C.cp_day(r.get("issued_on")) or C.cp_day(r.get("file_date")), "file_id": fid,
                 "mime": _lt(r.get("mime_type")) or mime(r.get("title")),
                 "source": "Client files" + (" · " + folder if folder else "")})

    ok, _none, err = _try(client_docs)
    if not ok:
        why.append(f"The client files could not be read ({err}).")
        degraded = True
    # the papers filed on the family member in Families itself (db/families.sql)
    ok, kept, err = _try(lambda: FR.documents(reads, f["key"]))
    if not ok:
        why.append(f"The family member's own papers could not be read ({err}).")
        degraded = True
    for d in kept or []:
        add({"id": "fd_" + d["id"], "title": d["name"], "kind": "family_doc", "client_key": "", "client_name": "",
             "date": d["added_at"][:10], "file_id": d["drive_id"], "mime": d["mime"] or mime(d["name"]),
             "source": "Families & Guardians" + (" · " + d["doc_type"] if d["doc_type"] else "")})
    docs.sort(key=_cmp(lambda a, b: (1 if a["date"] < b["date"] else (-1 if a["date"] > b["date"] else 0))
                       or gsjs.locale_cmp(a["title"], b["title"])))
    return {"docs": docs, "why": why, "degraded": degraded}


def documents_data(reads: L.Reads, ctx: dict) -> dict[str, Any]:
    """famDocuments_: the kept (scrubbed) list; a build that throws throws."""
    return reads.once(f"fam_documents:{ctx['key']}", lambda: scrub(documents_build(reads, ctx)))


def documents_answer(reads: L.Reads, ctx: dict) -> dict[str, Any]:
    return serve(reads, "documents", ctx, "The documents", lambda: documents_build(reads, ctx))


# ---- activity -------------------------------------------------------------------------------------------------------

def own_phones(reads: L.Reads, ctx: dict) -> dict[str, Any]:
    """famOwnPhones_: one another family member also carries, or a company line, is dropped."""
    mine: dict[str, bool] = {}
    shared = 0
    for d in ctx["family"]["phones"]:
        others = [k for k in _keys(ctx["index"]["phones"].get(d) or {}) if k != ctx["key"]]
        if others or SC._line_ours(reads, d):
            shared += 1
            continue
        mine[d] = True
    return {"mine": mine, "shared": shared}


def texts(reads: L.Reads, own: dict, since: str) -> list[dict]:
    """famTexts_: texts on the company lines to or from the family member's own phones since `since`."""
    ref = SC._tab(reads, SC.QUO_MESSAGES_TAB)
    if ref is None:
        raise RuntimeError("the texts house (quo_messages) could not be opened")
    direct, rows = SC._read_columns(reads, ref, {
        "id": (("message_id",), None), "created": (("message_created",), None), "event": (("event_at",), None),
        "received": (("received_at",), None), "dir": (("direction",), None), "from": (("from_number",), None),
        "to": (("to_number",), None), "body": (("body",), None), "quo": (("quo_number",), None)})
    mine = own["mine"]
    out = []
    for rn, c in rows:
        d = gsjs.trim(gsjs.or_text(SC._typed(c["dir"], direct))).lower()
        incoming = d in ("incoming", "inbound")
        if not any(x in mine for x in SC._numbers(SC._js_text(c["from"] if incoming else c["to"], direct))):
            continue
        at = _cell_when(c["created"], direct) or _cell_when(c["event"], direct) or _cell_when(c["received"], direct)
        if not at or at[:10] < since:
            continue
        quo = gsjs.trim(gsjs.or_text(SC._typed(c["quo"], direct)))
        line = next((x for x in SC._numbers(SC._js_text(c["to"] if incoming else c["from"], direct))
                     if x not in mine), "") or quo
        who = SC._line_of(reads, line, quo)
        out.append({"id": "sms_" + (gsjs.or_text(SC._typed(c["id"], direct)) or f"row{rn}"), "at": at,
                    "incoming": incoming, "line": who["label"], "owner": who["owner"],
                    "body": SC._js_text(c["body"], direct)})
    return out


def calls(reads: L.Reads, own: dict, since: str, why: list[str]) -> dict[str, Any]:
    """famCalls_: calls with the family member's own phones in the hotline book and the transcripts house."""
    found: dict[str, dict] = {}
    degraded = False
    mine = own["mine"]

    def hit(cell: Any, direct: bool) -> bool:
        return any(d in mine for d in SC._numbers(SC._js_text(cell, direct)))

    def take(cid: str, at: str, secs: str, direction: Any, team: str) -> None:
        if not cid or cid in found or not at or at[:10] < since:
            return
        found[cid] = {"id": "call_" + cid, "at": at, "secs": secs, "direction": gsjs.or_text(direction).lower(),
                      "line": "+1" + team if team else ""}

    hot_id = gsjs.or_text(reads.db.prop("HOTLINE_TRANSCRIPTS_ID"))
    hot = reads.tab_of(hot_id, SC.HOTLINE_TRANSCRIPTS_TAB, "the hotline transcripts") if hot_id else None
    if hot is None:
        why.append("The hotline transcripts book could not be opened, so its calls are not listed.")
        degraded = True
    else:
        cols = SC.HOTLINE_COLS
        hd, hrows = SC._read_columns(reads, hot, {
            "id": (("Call ID",), cols["CALL_ID"]), "created": (("Transcript Created",), 1),
            "event": (("Event Timestamp",), cols["EVENT_TS"]), "secs": (("Duration (sec)",), 3),
            "who": (("Participant(s)",), cols["PARTICIPANTS"]), "team": (("Team Member(s)",), cols["TEAM"]),
            "dir": (("Direction",), None)})
        hz = gsjs.book_zone(hot.sheet_id, reads.db.prop)
        for _rn, h in hrows:
            if not hit(h["who"], hd):
                continue
            at = _cell_when(h["event"], hd, hz) or _cell_when(h["created"], hd, hz)
            take(gsjs.trim(gsjs.or_text(SC._typed(h["id"], hd))), at, SC._js_text(h["secs"], hd),
                 SC._typed(h["dir"], hd), next(iter(SC._numbers(SC._js_text(h["team"], hd))), ""))

    def quo() -> None:
        ref = SC._tab(reads, SC.QUO_TRANSCRIPTS_TAB)
        if ref is None:
            return
        qd, qrows = SC._read_columns(reads, ref, {
            "id": (("call_id",), None), "created": (("transcript_created",), None), "event": (("event_at",), None),
            "secs": (("duration_s",), None), "dir": (("direction",), None), "who": (("participants",), None),
            "team": (("team_members",), None)})
        for _rn, q in qrows:
            if not hit(q["who"], qd):
                continue
            take(gsjs.trim(gsjs.or_text(SC._typed(q["id"], qd))), _cell_when(q["created"], qd) or
                 _cell_when(q["event"], qd), SC._js_text(q["secs"], qd), SC._typed(q["dir"], qd),
                 next(iter(SC._numbers(SC._js_text(q["team"], qd))), ""))

    ok, _none, err = _try(quo)
    if not ok:
        why.append(f"The transcripts house could not be read ({err}).")
        degraded = True
    return {"calls": [found[k] for k in _keys(found)], "degraded": degraded}


def family_shifts(reads: L.Reads, codes: dict[str, bool], since: str, until: str) -> list[dict]:
    """famFamilyShifts_: the house calendars' FAMILY cells at these houses, as runs of consecutive days."""
    got = reads.calendar()
    cal = got.get("cal")
    if not cal or not cal.get("values"):
        raise RuntimeError(got.get("why") or "the Calendar Archive could not be read")
    values = cal["values"]
    head = [gsjs.trim(gsjs.or_text(h)).lower() for h in (values[0] or [])]
    direct = SC._direct(reads, reads.db.prop("HOTLINE_CALENDAR_ID"))

    def cell(v: Any, clock: bool) -> Any:
        if direct:
            t = SC._typed(v, True)
            return SC._serial(t) if isinstance(t, (int, float)) and not isinstance(t, bool) else t
        return hubdb.typed(v, "estate") if clock else v

    def col(names: tuple, fb: int) -> int:
        for n in names:
            if n in head:
                return head.index(n)
        if fb != -1:
            raise Defer("the Calendar Archive lacks a column read by position, and the copy keeps no column order")
        return fb

    c_loc, c_name, c_date = col(("location",), 0), col(("employee",), 1), col(("date",), 4)
    c_start = col(("start time", "start", "shift start", "time in", "shift"), -1)
    c_end = col(("end time", "end", "shift end", "time out"), -1)
    by_code: dict[str, dict[str, dict]] = {}
    for line in values[1:]:
        line = line or []

        def at(j: int, line: list = line) -> Any:
            return line[j] if 0 <= j < len(line) else None

        if not re.match(r"family\b", _lt(at(c_name)), _A):
            continue
        code = L.code_of(at(c_loc))
        if not code or not codes.get(code):
            continue
        day = L.broadcast_day(cell(at(c_date), False))
        if not day or day < since or day > until:
            continue
        d = by_code.setdefault(code, {})
        if day not in d:
            d[day] = {"start": "" if c_start == -1 else SC._clock(cell(at(c_start), True), NY),
                      "end": "" if c_end == -1 else SC._clock(cell(at(c_end), True), NY)}
    runs: list[dict] = []
    for code in sorted(by_code):
        run = None
        for day in sorted(by_code[code]):
            t = by_code[code][day]
            tm = t["start"] + "–" + t["end"] if t["start"] and t["end"] else (t["start"] or t["end"])
            if run and gsjs.day_shift(run["to"], 1) == day:
                run["to"] = day
                run["count"] += 1
                if run["time"] != tm:
                    run["time"] = ""
                continue
            run = {"code": code, "from": day, "to": day, "count": 1, "time": tm}
            runs.append(run)
    return runs


def calls_for(reads: L.Reads, key: str, tied: dict[str, bool] | None = None) -> list[dict]:
    """famCallsFor_: the master's own Task Board cards that carry the family key, and those `tied` names."""
    master = CW.user_by_email(reads, sc.MASTER_ACCOUNT) or {}
    # a users row read here names its account userid (userByEmail_'s public user calls it id)
    master_id = gsjs.str_(master.get("userid") or master.get("id"))
    if not master_id:
        raise RuntimeError("the master account could not be found")
    return [r for r in C._hub(reads, "tasks")
            if gsjs.str_(r.get("family_key")) == key and gsjs.str_(r.get("source")) == CALL_SOURCE
            and ((gsjs.str_(r.get("ownerId")) or gsjs.str_(r.get("assigneeId"))) == master_id
                 or bool(tied and tied.get(gsjs.str_(r.get("id")))))]


def call_ties_of(rows: list[dict]) -> dict[str, bool]:
    """famCallTiesOf_: the cards a holder of the calls edition filed from here, by card id."""
    out: dict[str, bool] = {}
    for r in rows:
        if gsjs.or_text(r.get("kind")) != "call":
            continue
        cid = gsjs.trim(gsjs.or_text(r.get("body")))
        if cid:
            out[cid] = True
    return out


def task_state(column: Any) -> str:
    """famTaskState_."""
    col = gsjs.str_(column)
    return TASK_WORDS.get(col) or (title(col) if col else "Open")


def labels_of(v: Any) -> list[str]:
    """A card's labels (the list listRows_ parses, its JSON text, or one word) as its words."""
    items: Any = v
    if not isinstance(v, list):
        s = gsjs.trim(gsjs.or_text(v))
        if not s:
            return []
        try:
            items = json.loads(s)
        except ValueError:
            return [s]
    items = items if isinstance(items, list) else [items]
    return [w for w in (gsjs.trim(gsjs.js_str(x)) for x in items if x is not None) if w]


def call_state(card: dict) -> str:
    """A call card's state: cancelled when it carries the label, else its column."""
    return "cancelled" if CALL_CANCELLED in labels_of(card.get("labels")) else gsjs.str_(card.get("column"))


def call_words(card: dict) -> str:
    return CALL_CANCELLED if call_state(card) == "cancelled" else task_state(card.get("column"))


def call_raw(card: dict) -> dict[str, str]:
    """A call card's fields as its edit panel opens on them: the witnesses its save is checked against."""
    return {"due": C.cp_day(card.get("due")), "priority": gsjs.str_(card.get("priority")).lower() or "normal",
            "state": call_state(card), "details": gsjs.or_text(card.get("description"))}


def note_state(row: dict) -> str:
    return "removed" if gsjs.or_text(row.get("kind")) == NOTE_REMOVED else "open"


def notes_rows(reads: L.Reads) -> list[dict]:
    """The notes tab as locationsTabRows_ reads it; none while it is unborn."""
    return C.own_rows(reads, NOTES_TAB)


def own_rows(reads: L.Reads, key: str) -> list[dict]:
    """famOwnRows_: one family member's rows of the notes tab, notes and incident ties both."""
    return [r for r in notes_rows(reads) if gsjs.or_text(r.get("family_key")) == key]


def notes_of(rows: list[dict]) -> list[dict]:
    """famNotesOf_: the notes among the rows, newest first."""
    out = [{"id": gsjs.or_text(r.get("id")), "at": gsjs.or_text(r.get("at")), "by": gsjs.or_text(r.get("by")),
            "body": gsjs.or_text(r.get("body"))} for r in rows if (gsjs.or_text(r.get("kind")) or "note") == "note"]
    out.sort(key=_newest)
    return out


def incident_key(client_key: Any, ts: Any) -> str:
    """famIncidentKey_: client_key|its timestamp to the second."""
    ck = gsjs.trim(gsjs.or_text(client_key))
    at = when(ts)
    return ck + "|" + SC._js_slice(at, 19).replace(" ", "T", 1) if ck and at else ""


def incident_ties_of(rows: list[dict]) -> dict[str, bool]:
    """famIncidentTiesOf_."""
    out: dict[str, bool] = {}
    for r in rows:
        if gsjs.or_text(r.get("kind")) != "incident":
            continue
        k = incident_key(r.get("client_key"), r.get("incident_ts"))
        if k:
            out[k] = True
    return out


def _near_tie(ties: dict[str, bool], keys: set[str]) -> None:
    """A tie one second off a report's own key: the copy rounds what Apps Script cuts, so it decides."""
    for tie in ties:
        if tie in keys:
            continue
        ck, _bar, at = tie.rpartition("|")
        try:
            t = datetime.strptime(at, "%Y-%m-%dT%H:%M:%S")
        except ValueError:
            continue
        for d in (-1, 1):
            if f"{ck}|{(t + timedelta(seconds=d)).strftime('%Y-%m-%dT%H:%M:%S')}" in keys:
                raise Defer("an incident tie rests on a timestamp the copy keeps only to the second")


def _number(s: str) -> float:
    """Number(s): NaN as nan."""
    n = SC._js_number(s) if gsjs.trim(s) else 0.0
    return float("nan") if n is None else n


def activity_build(reads: L.Reads, ctx: dict) -> dict[str, Any]:
    """famActivityBuild_: notes, texts, calls, the plans naming them, FAMILY shifts, scheduled calls and incidents."""
    f, why, degraded = ctx["family"], list(ctx["why"]), ctx["degraded"]
    today = reads.today()
    since = gsjs.day_shift(today, -ACTIVITY_DAYS)
    items: list[dict] = []

    # scrubbed before the cut, so no number is left half-cut past the scrub
    def add(iid: str, at: Any, kind: str, ttl: str, body: Any, by: Any, client_key: str) -> None:
        w = when(at)
        if not w:
            return
        items.append({"id": iid, "at": w, "kind": kind, "title": ttl,
                      "body": _lt(scrub("" if body is None else gsjs.js_str(body)), 240), "by": by or "",
                      "client_key": client_key or ""})

    # every step since the family member was registered in Families (db/families.sql): its progress list
    ok, steps, err = _try(lambda: FR.events(reads, f["key"]))
    if not ok:
        why.append(f"The family member's registry steps could not be read ({err}).")
        degraded = True
    for e in steps or []:
        add("fe_" + e["id"], e["at"], "registered" if e["kind"] == "created" else e["kind"], e["title"], e["body"],
            e["by"], e["client_key"])

    by_key = {c["client_key"]: c for c in f["clients"]}
    ok, own, err = _try(lambda: own_rows(reads, f["key"]))
    if not ok:
        why.append(f"The family notes could not be read ({err}).")
        degraded, own = True, []
    for n in notes_of(own):
        add("note_" + n["id"], n["at"], "note", "Admin note", n["body"], n["by"], "")
    ties = incident_ties_of(own)
    call_ties = call_ties_of(own)
    for c in f["clients"]:
        if not c["in_plan"]:
            continue
        add("isp_" + c["client_key"], c["isp_day"], "isp", "Named in " + c["name"] + "'s ISP",
            c["relationship"] + (" · ISP " + c["isp_year"] if c["isp_year"] else ""), "", c["client_key"])
    phones = own_phones(reads, ctx)
    count = len(phones["mine"])
    if phones["shared"]:
        why.append(f"{phones['shared']} phone number(s) on the records also belong to another family member or to a "
                   "company line, so texts and calls on them are not attributed.")
    if count:
        ok, got, err = _try(lambda: texts(reads, phones, since))
        if not ok:
            why.append(f"The texts could not be read ({err}).")
            degraded = True
        for t in got or []:
            add(t["id"], t["at"], "sms", ("Text from " + f["name"] if t["incoming"] else "Text to " + f["name"])
                + " · " + t["line"], t["body"], f["name"] if t["incoming"] else t["owner"], "")
        ok, got, err = _try(lambda: calls(reads, phones, since, why))
        if not ok:
            why.append(f"The calls could not be read ({err}).")
            degraded = True
        else:
            if got["degraded"]:
                degraded = True
            for k in got["calls"]:
                n = _number(k["secs"])
                mins = f"{gsjs.num_str(max(1.0, gsjs.js_round(n / 60)))} min" if n > 0 else ""
                verb = "Call to " if k["direction"] == "outgoing" else "Call with "
                add(k["id"], k["at"], "call", verb + f["name"], " · ".join(x for x in (k["line"], mins) if x), "", "")
    codes: dict[str, bool] = {}
    code_client: dict[str, str] = {}
    for c in f["clients"]:
        code = house_code(c["house"]) if c["status"] == "active" else ""
        if not code:
            continue
        codes[code] = True
        code_client[code] = c["client_key"] if code not in code_client else ""
    if codes:
        def shifts() -> None:
            ok_l, labels, _wl = _try(lambda: _labels(reads))
            labels = labels if ok_l else {}
            shared: dict[str, int] = {}
            for run in family_shifts(reads, codes, since, gsjs.day_shift(today, CALENDAR_AHEAD_DAYS)):
                label = labels.get(run["code"]) or run["code"]
                rng = (day_words(run["from"]) + " – " + day_words(run["to"]) + " · " + str(run["count"]) + " shifts"
                       if run["count"] > 1 else day_words(run["from"]))
                add("cal_" + run["code"] + "_" + run["from"], run["to"], "calendar",
                    "Family coverage shifts" if run["count"] > 1 else "Family coverage shift",
                    " · ".join(x for x in (label, rng, run["time"]) if x), "", code_client.get(run["code"]) or "")
                others = len(ctx["index"]["houses"].get(run["code"]) or {})
                if others > 1:
                    shared[run["code"]] = others
            for code in shared:
                why.append(f"The house calendar at {labels.get(code) or code} writes FAMILY without a name, and "
                           f"{shared[code]} family members have clients there, so its shifts are listed for each of "
                           "them.")

        ok, _none, err = _try(shifts)
        if not ok:
            why.append(f"The Calendar Archive could not be read ({err}), so no FAMILY shift is listed.")
            degraded = True

    def scheduled() -> None:
        for r in calls_for(reads, f["key"], call_ties):
            c = by_key.get(gsjs.str_(r.get("client_key")))
            due = C.cp_day(r.get("due"))
            add("task_" + gsjs.str_(r.get("id")), gsjs.str_(r.get("createdAt")), "scheduled_call",
                "Call scheduled" + (" — " + c["name"] if c else ""),
                " · ".join(x for x in ("Due " + day_words(due) if due else "",
                                       title(r.get("priority") or "normal") + " priority",
                                       call_words(r)) if x), "", c["client_key"] if c else "")

    ok, _none, err = _try(scheduled)
    if not ok:
        why.append(f"The scheduled calls could not be read ({err}).")
        degraded = True

    def incidents() -> None:
        joined = L.incidents_for(reads.estate("uiIncidents"),
                                 [{"client_key": c["client_key"], "name": c["name"]} for c in f["clients"]])
        if ties:
            _near_tie(ties, {incident_key(j["client_key"], (j.get("row") or {}).get("timestamp")) for j in joined})
        for j in joined:
            row = j.get("row") or {}
            # filed from this app, or naming them in its own words
            if not ties.get(incident_key(j["client_key"], row.get("timestamp"))) and \
                    not named(f["names"], [row.get("summary_of_incident"), row.get("immediate_action_taken"),
                                           row.get("cause_and_contributing_factors"), row.get("prevention_plan"),
                                           row.get("your_name"), row.get("employees_involved")]):
                continue
            day = C.cp_day(j["incident_date"]) or C.cp_day(row.get("timestamp"))
            if not day or day < since:
                continue
            add("inc_" + j["id"], day, "incident", "Incident — " + j["client_name"]
                + (" · " + _lt(j["incident_category"], 80) if j["incident_category"] else ""),
                C.gist(row.get("summary_of_incident")), j["your_name"], j["client_key"])

    ok, _none, err = _try(incidents)
    if not ok:
        why.append(f"The incidents could not be read ({err}).")
        degraded = True
    items.sort(key=_newest)
    return {"items": items[:ACTIVITY_CAP], "total": len(items), "phones_matched": count, "why": why,
            "degraded": degraded}


def activity_answer(reads: L.Reads, ctx: dict) -> dict[str, Any]:
    return serve(reads, "activity", ctx, "The activity", lambda: activity_build(reads, ctx))


# ---- notes ----------------------------------------------------------------------------------------------------------

def notes_answer(reads: L.Reads, ctx: dict) -> dict[str, Any]:
    return serve(reads, "notes", ctx, "The family notes", lambda: {"notes": notes_of(own_rows(reads, ctx["key"]))})


# ---- the member's details, as the edit panel opens on them ----------------------------------------------------------

def edit_tie_lock(c: dict, idx: dict, key: str) -> dict[str, str] | None:
    """famEditTieLock_: why a client's tie is not edited here; None when that client's own Hub record names them."""
    if c["archived"]:
        return {"why": "The archive of old clients names this tie; the archive is not edited here.", "door": ""}
    if idx["records"].get(c["client_key"]) != key:
        return {"why": "The client's record does not name this family member; the tie comes from the plan's important "
                       "people or the people directory.", "door": "the client's ISP"}
    if not idx["hub"].get(c["client_key"]):
        return {"why": "Only the Asa Client Database Master names this guardian, not the client's Hub record.",
                "door": "Clients"}
    return None


def edit_account(reads: L.Reads, mail: Any, phone: Any) -> bool:
    """famEditAccount_: whether a sign-in already uses this email or phone."""
    asks = [gsjs.trim(gsjs.or_text(mail)).lower(), re.sub(r"\D+", "", gsjs.or_text(phone), flags=re.A),
            _digits10(phone)]
    for a in asks:
        if not a:
            continue
        ok, found, _w = _try(lambda a=a: CW.user_by_email(reads, a))
        if ok and found:
            return True
    return False


def edit_of(reads: L.Reads, ctx: dict, narrow: bool = False) -> dict[str, Any]:
    """famEditOf_: each field as the profile shows it now (the witness), the fields edited elsewhere and why."""
    f, idx = ctx["family"], ctx["index"]
    raw: dict[str, Any] = {"name": f["name"], "phone": f["phone"], "email": f["email"], "address": f["address"]}
    if f["person_id"]:
        raw["avatar"] = f["avatar"]
    locked: dict[str, dict] = {}
    ties: list[dict] = []
    records: list[str] = []
    for c in f["clients"]:
        rel, papers = "rel_" + c["client_key"], "papers_" + c["client_key"]
        lock = edit_tie_lock(c, idx, ctx["key"])
        if not lock:
            records.append(c["client_key"])
        ties.append({"client_key": c["client_key"], "name": c["name"], "status": c["status"],
                     "why": lock["why"] if lock else ""})
        if not _EDIT_FIELD.fullmatch(papers):
            continue
        raw[rel] = c["relationship"] or "Guardian"
        raw[papers] = c["papers"] or ""
        if lock:
            locked[rel] = lock
            locked[papers] = lock
    none = {"why": "No client's Hub record names this family member, so their details are edited where the tie is "
                   "written.", "door": "the client's ISP"}
    if not records:
        locked["name"] = none
        locked["address"] = none
        if not f["person_id"]:
            locked["phone"] = none
            locked["email"] = none
    if narrow and "name" not in locked:
        locked["name"] = dict(RENAME_LOCK)
    return scrub({"raw": raw, "locked": locked, "ties": ties, "records": records, "person_id": f["person_id"] or "",
                  "account": edit_account(reads, f["email"], f["phone"])})


def edit_check(field: str, value: str, ctx: dict) -> str:
    """famEditCheck_: why `value` is refused for `field`; '' when it may be written."""
    if field == "name":
        if not value:
            return "A family member keeps a name."
        k = key_of(fam_name(value))
        if not k:
            return "Not a person's name (a relationship, \"Self\" or an organisation)."
        to = ctx["index"]["aliases"].get(k) or k
        if to != ctx["key"] and ctx["index"]["families"].get(to):
            return "Another family member is on file under this name."
    if field == "phone" and value and not _digits10(value):
        return "A phone number has ten digits."
    if field == "email" and value and not email(value):
        return "Not an email address."
    if field == "avatar" and value and not re.fullmatch(r"https://\S+", value, re.A):
        return "A photo is an https link."
    return ""


def admin_edit_of(sess: L.Session, reads: L.Reads, ctx: dict) -> dict[str, Any]:
    """The witnesses the note and call panels open on, each part to its edition's (the master both); {} for neither."""
    out: dict[str, Any] = {}
    own = own_rows(reads, ctx["key"])
    if edition_door(sess, EDITION["notes"]) is None:
        notes = []
        for r in own:
            if (gsjs.or_text(r.get("kind")) or "note") != "note":
                continue
            body = gsjs.or_text(r.get("body"))
            notes.append({"id": gsjs.or_text(r.get("id")), "at": gsjs.or_text(r.get("at")),
                          "by": gsjs.or_text(r.get("by")), "raw": {"body": body, "state": "open"},
                          "locked": {} if scrub(body) == body else {"body": dict(NOTE_WITHHELD)}})
        notes.sort(key=_newest)
        out["notes"] = notes
    if edition_door(sess, EDITION["calls"]) is None:
        names = {c["client_key"]: c["name"] for c in ctx["family"]["clients"]}
        ok, cards, err = _try(lambda: calls_for(reads, ctx["key"], call_ties_of(own)))
        calls = []
        for r in cards if ok else []:
            raw = call_raw(r)
            ck = gsjs.str_(r.get("client_key"))
            locked = {} if scrub(raw["details"]) == raw["details"] else {"details": dict(CALL_WITHHELD)}
            calls.append({"id": gsjs.str_(r.get("id")), "at": gsjs.str_(r.get("createdAt")), "client_key": ck,
                          "client_name": names.get(ck) or "", "raw": raw, "locked": locked})
        calls.sort(key=_newest)
        out["calls"] = calls
        if not ok:
            out["why"] = [f"The scheduled calls could not be read ({err})."]
    return out


# ---- the doors ------------------------------------------------------------------------------------------------------

def _door(answer: Callable[[L.Reads, dict], dict]) -> Callable[[L.Reads, dict], dict]:
    """famDoor_ for the pack: the family member it names, then its answer."""
    return lambda reads, ctx: ctx["refused"] if ctx.get("refused") else answer(reads, ctx)


def family_profile_roster(sess: L.Session, payload: dict) -> dict[str, Any]:
    """familyProfileRoster: the switcher, cut to a narrowed viewer's own clients."""
    view = view_of(sess)
    if not view:
        return unknown()
    reads = sess.reads

    def read() -> dict:
        if view_all(view):
            return reads.once("fam_roster", lambda: scrub(roster_build(reads)))
        return scrub(roster_cut(view, index(reads)))

    ok, got, err = _try(read)
    if not ok:
        return {"status": 503, "message": f"The family list could not be read just now ({err})."}
    return shown({"families": got["families"], "why": got["why"], "degraded": got["degraded"],
                  "view": view_words(view)})


def family_profile_overview(sess: L.Session, payload: dict) -> dict[str, Any]:
    """familyProfileOverview: the details and every client; the edit panel with edit: true, to the profile edition's."""
    view = view_of(sess)
    if not view:
        return unknown()
    reads = sess.reads
    got = view_serve(reads, view, payload, overview_answer, overview_cut)
    if payload.get("edit") is not True or not got or got.get("status") != 200:
        return got
    if view["kind"] != "master" and (not view_all(view) or edition_door(sess, EDITION["profile"])):
        return got
    ctx = family_ctx(reads, payload.get("family"))
    if ctx.get("refused"):
        return ctx["refused"]
    data = dict(got["data"])
    data["edit"] = edit_of(reads, ctx, view["kind"] != "master")
    return shown(data)


def family_profile_documents(sess: L.Session, payload: dict) -> dict[str, Any]:
    """familyProfileDocuments."""
    view = view_of(sess)
    if not view:
        return unknown()
    return view_serve(sess.reads, view, payload, documents_answer, documents_cut)


def family_profile_doc_file(sess: L.Session, payload: dict) -> dict[str, Any]:
    """familyProfileDocFile: one document the member's list names, as bytes for the platform's viewer."""
    view = view_of(sess)
    if not view:
        return unknown()
    reads = sess.reads
    ctx = view_family(reads, view, payload)
    if ctx.get("refused"):
        return ctx["refused"]
    fid = _lt(payload.get("file_id"), 120)
    if not re.fullmatch(r"[A-Za-z0-9_-]{10,}", fid, re.A):
        return {"status": 400, "message": "file_id: a Drive file id."}

    def listed() -> list[dict]:
        docs = documents_data(reads, ctx)
        return (docs if view_all(view) else documents_cut(view, ctx, docs)).get("docs") or []

    ok, docs, _w = _try(listed)
    if not ok:
        return {"status": 503, "message": "The documents could not be read just now — try again in a minute."}
    if not any(d.get("file_id") == fid for d in docs):
        return {"status": 404, "message": "This family member names no such document."}
    got = L.doc_file(reads, fid)
    if got.get("refused"):
        return got["refused"]
    return {"status": 200, "data": {"id": fid, **got}}


def family_profile_activity(sess: L.Session, payload: dict) -> dict[str, Any]:
    """familyProfileActivity: the admin notes' lines only to whom the notes are open."""
    view = view_of(sess)
    if not view:
        return unknown()
    got = view_serve(sess.reads, view, payload, activity_answer, activity_cut)
    if notes_seen(view) or not got or got.get("status") != 200:
        return got
    return shown(notes_out(got["data"]))


def family_profile_notes(sess: L.Session, payload: dict) -> dict[str, Any]:
    """familyProfileNotes: internal — the master's, and a whole viewer's wearing NOTES_FLOOR or above; with edit: true,
    the note and call panels' witnesses."""
    view = view_of(sess)
    if not view or not notes_seen(view):
        return unknown()
    reads = sess.reads
    got = view_serve(reads, view, payload, notes_answer, None)
    if payload.get("edit") is not True or not got or got.get("status") != 200:
        return got
    ctx = family_ctx(reads, payload.get("family"))
    if ctx.get("refused"):
        return ctx["refused"]
    edit = admin_edit_of(sess, reads, ctx)
    if not edit:
        return got
    data = dict(got["data"])
    data["edit"] = scrub(edit)
    return shown(data)


PACK_DOORS: dict[str, Callable[[L.Reads, dict], dict[str, Any]]] = {
    "overview": _door(overview_answer), "documents": _door(documents_answer), "activity": _door(activity_answer),
    "notes": _door(notes_answer)}


def _take(parts: dict, status: dict, name: str, got: Any) -> None:
    if isinstance(got, dict) and got.get("status") == 200 and got.get("data") is not None:
        parts[name] = got["data"]
        status[name] = {"status": 200}
        return
    said = got.get("status") if isinstance(got, dict) else None
    status[name] = {"status": int(said) if isinstance(said, (int, float)) and not isinstance(said, bool) and said
                    else 503,
                    "message": gsjs.js_str((got or {}).get("message") or "This part did not answer.")[:200]}


def family_pack(sess: L.Session, payload: dict) -> dict[str, Any]:
    """familyPack: overview, documents, activity and notes of one family member, for the relay alone."""
    if not sess.user or not sess.user.get("is_service"):
        return unknown()
    started = time.monotonic()
    reads = sess.reads
    ctx = family_ctx(reads, payload.get("family"))
    if ctx.get("refused"):
        return ctx["refused"]
    parts: dict[str, Any] = {}
    status: dict[str, Any] = {}
    left: list[str] = []
    for name in PACK_PARTS:
        if time.monotonic() - started > PACK_BUDGET_S:
            status[name] = {"status": 503, "message": NOT_GATHERED}
            left.append(f"{name} ({PAST_BUDGET})")
            continue
        try:
            got = PACK_DOORS[name](reads, ctx)
        except (Defer, hubdb.Unreadable) as e:
            # not this engine's answer: the section reads on its own door, which says why
            status[name] = {"status": 503, "message": NOT_GATHERED}
            left.append(f"{name} ({str(e)[:120]})")
            continue
        except Exception as e:  # noqa: BLE001 - the pack's own try/catch
            status[name] = {"status": 503, "message": f"This part could not be read just now ({L._why(e)})."}
            continue
        _take(parts, status, name, got)
    if not parts:
        raise Defer("no part of this pack could be read here")
    if left:
        log.info("familyPack: %d part(s) left to their own reads: %s", len(left), "; ".join(left))
    return {"status": 200, "data": {"family": ctx["key"], "built_at": gsjs.iso(reads.now), "parts": parts,
                                    "part_status": status}}


def notes_rows_by_key(reads: L.Reads) -> dict[str, list[dict]]:
    """famNotesRowsByKey_: the notes tab read once, by family key."""
    out: dict[str, list[dict]] = {}
    for r in notes_rows(reads):
        k = gsjs.or_text(r.get("family_key"))
        if k:
            out.setdefault(k, []).append(r)
    return out


def family_index_pack(sess: L.Session, payload: dict) -> dict[str, Any]:
    """familyIndexPack: the roster, the aliases, each member's overview and notes, for the relay alone."""
    if not sess.user or not sess.user.get("is_service"):
        return unknown()
    started = time.monotonic()
    reads = sess.reads

    def failed(err: str) -> dict[str, Any]:
        return {"status": 503, "message": f"This part could not be read just now ({err})."}

    ok, idx, err = _try(lambda: index(reads))
    if not ok:
        raise Defer(f"the family index could not be built here ({err})")
    parts: dict[str, Any] = {}
    status: dict[str, Any] = {}
    ok, roster, err = _try(lambda: scrub(roster_build(reads)))
    if not ok:
        status["roster"] = failed(err)
    else:
        parts["roster"] = {"families": roster["families"], "why": roster["why"], "degraded": roster["degraded"]}
        status["roster"] = {"status": 200}
    parts["aliases"] = {k: v for k, v in idx["aliases"].items() if idx["families"].get(v)}
    status["aliases"] = {"status": 200}
    # the family member each client's own record names: the relay's map of which family a client's write touches
    parts["records"] = {c: k for c, k in idx["records"].items() if idx["families"].get(k)}
    status["records"] = {"status": 200}
    ok, notes, err = _try(lambda: notes_rows_by_key(reads))
    if not ok:
        status["notes"] = failed(err)
        notes = None
    overviews: dict[str, Any] = {}
    written: dict[str, Any] = {}
    left = broken = 0
    for k in sorted(idx["families"]):
        if time.monotonic() - started > PACK_BUDGET_S:
            left += 1
            continue
        ctx = family_ctx(reads, k)
        if ctx.get("refused"):
            broken += 1
            continue
        ok, ov, _w = _try(lambda ctx=ctx: scrub(overview_build(reads, ctx)))
        if not ok:
            broken += 1
        else:
            overviews[ctx["key"]] = ov
        if notes is not None:
            written[ctx["key"]] = scrub({"notes": notes_of(notes.get(ctx["key"]) or [])})
    short = f"{left} family member(s) were not gathered in this pack; theirs are read on their own." if left else ""
    parts["overviews"] = overviews
    status["overviews"] = {"status": 200, "missing": left + broken, "message": short} if short or broken \
        else {"status": 200}
    if notes is not None:
        parts["notes"] = written
        status["notes"] = {"status": 200, "missing": left, "message": short} if short else {"status": 200}
    if C._marked(parts):
        raise Defer("the copy withholds a cell this pack shows")
    return {"status": 200, "data": {"built_at": gsjs.iso(reads.now), "parts": parts, "part_status": status}}


# a paper filed on a family member: what cert_papers files in Drive (images and PDFs), under <root>/Families/<name>
PAPER_TYPES = {"pdf": "application/pdf", "png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg",
               "gif": "image/gif", "webp": "image/webp", "heic": "image/heic", "heif": "image/heif"}
PAPER_TYPE_WORDS = "Images and PDFs only — a PDF, or a PNG, JPEG, GIF, WebP or HEIC picture."
PAPER_TOP = "Families"
# ComplianceDocs.gs CERT_PLATFORM_ROOT: the platform's own Drive folder, unless the depot names another
PAPER_ROOT = "1fNb2-pqSGS-DZcyXAoxPY7Sp9CaPC8-b"


def family_doc_plan(sess: L.Session, payload: dict) -> dict[str, Any]:
    """familyDocPlan: whether a paper is filed on this family member and where — asked by the relay, which files it in
    Drive as asatech before familyProfileDocAdd keeps its row. Every refusal is said before Drive is touched."""
    shut = edition_door(sess, EDITION["documents"])
    if shut:
        return shut
    ctx = family_ctx(sess.reads, payload.get("family"))
    if ctx.get("refused"):
        return ctx["refused"]
    mime_type = gsjs.trim(gsjs.or_text(payload.get("mime"))).lower()
    if mime_type not in PAPER_TYPES.values():
        return {"status": 400, "message": PAPER_TYPE_WORDS + " Nothing was filed."}
    raw = _lt(payload.get("title"), 120) or _lt(payload.get("filename"), 160) or "Family document"
    ext = next((e for e, m in PAPER_TYPES.items() if m == mime_type), "pdf")
    stem = re.sub(r"[\\/:*?\"<>|]+", " ", re.sub(r"\.[A-Za-z0-9]{2,5}\Z", "", raw)).strip() or "Family document"
    root = gsjs.trim(gsjs.or_text(sess.reads.db.prop("HUB_PLATFORM_FOLDER_ID"))) or PAPER_ROOT
    return {"status": 200, "data": {"platform_root": root, "top": PAPER_TOP, "folder": ctx["name"],
                                    "name": f"{stem}.{ext}", "mime": mime_type, "family": ctx["key"]}}


def family_client_choices(sess: L.Session, payload: dict) -> dict[str, Any]:
    """familyClientChoices: the clients a new family member can be tied to, for New Family's picker — the active
    first — to the master or a holder of family.create."""
    shut = edition_door(sess, EDITION["create"])
    if shut:
        return shut
    rows = [C.roster_row(c, None) for c in C.derived(sess.reads)]
    seen: set[str] = set()
    out: list[dict[str, Any]] = []
    for r in rows:
        if not r["client_key"] or r["client_key"] in seen:
            continue
        seen.add(r["client_key"])
        out.append({"client_key": r["client_key"], "name": r["name"], "house": r["house"], "status": r["status"]})
    out.sort(key=lambda r: (r["status"] != "active", gsjs.or_text(r["name"]).lower()))
    return {"status": 200, "data": {"clients": out}}


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {
    "familyClientChoices": family_client_choices,
    "familyProfileRoster": family_profile_roster, "familyProfileOverview": family_profile_overview,
    "familyProfileDocuments": family_profile_documents, "familyProfileDocFile": family_profile_doc_file,
    "familyProfileActivity": family_profile_activity, "familyProfileNotes": family_profile_notes,
    "familyPack": family_pack, "familyIndexPack": family_index_pack, "familyDocPlan": family_doc_plan,
}
# HUB_POLICY: every read names each account role a release can reach; the gate decides, not the role
POLICY_ROLES = ("admin", "director", "manager", "staff", "client", "onboarding", "interviewer")
POLICY: dict[str, dict[str, Any]] = {
    "familyProfileRoster": {"roles": POLICY_ROLES, "params": {}},
    "familyProfileOverview": {"roles": POLICY_ROLES, "params": {"family": "string", "edit": "boolean"}},
    "familyProfileDocuments": {"roles": POLICY_ROLES, "params": {"family": "string"}},
    "familyProfileDocFile": {"roles": POLICY_ROLES, "params": {"family": "string", "file_id": "string"}},
    "familyProfileActivity": {"roles": POLICY_ROLES, "params": {"family": "string"}},
    "familyProfileNotes": {"roles": POLICY_ROLES, "params": {"family": "string", "edit": "boolean"}},
    "familyPack": {"roles": ("admin",), "params": {"family": "string"}},
    "familyIndexPack": {"roles": ("admin",), "params": {}},
    "familyClientChoices": {"roles": POLICY_ROLES, "params": {}},
    "familyDocPlan": {"roles": POLICY_ROLES, "params": {"family": "string", "mime": "string", "filename": "string",
                                                        "title": "string"}},
}
