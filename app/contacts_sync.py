"""The platform's contact list and the accounts (apps-script/ContactsSync.gs) answered off asa-hub-db: the pure half —
each field's gate, the People house reconciled by id, the contact merge's plan — and usersContactMergePreview, what the
merge would do with every account named, nothing written. peopleSyncFromPlatform is app/contacts_sync_writes.py's; the
merge itself (usersContactMergeApply) writes the Users tab, the extra e-mails sign-in accepts among it, and stays
Apps Script's. The platform list's stamp (PEOPLE_SYNC_SOURCE_AT) is kept in app.contacts_sync_state
(db/contacts_sync.sql)."""
from __future__ import annotations

import json
import re
import unicodedata
from typing import Any, Callable

import client_writes as CW
import gsjs
import house_tables as HT
import hubdb
import line_directory as LD
import locations as L
import resource_rows as RR
import staff as SP
from gsjs import SheetDate
from scope import Defer

APP_ID = "contacts-sync"
PEOPLE_TAB = "people"
PEOPLE_SOURCE = "ops.employees"
LABEL = "Platform"
# stamped only on a fresh tab; an existing house is addressed by column name
PEOPLE_HEADER = ("id", "name", "first_name", "last_name", "role", "status", "email", "phone", "city", "state",
                 "employee_id", "start_date", "end_date", "avatar", "source", "source_coverage", "external_id",
                 "updated_at", "guardian_for")
# `avatar` and `guardian_for` are the Hub's own and never touched
PEOPLE_FIELDS = ("name", "first_name", "last_name", "role", "status", "email", "phone", "city", "state", "employee_id",
                 "start_date", "end_date", "source", "source_coverage", "external_id", "updated_at")
SOURCE_STAMP = "PEOPLE_SYNC_SOURCE_AT"
STATE = "app.contacts_sync_state"
GENERIC_CONFIG_PROP = "HUB_GENERIC_CONFIG_ID"
ROSTER_SOURCES_TAB = "roster_sources"
DENIED = {"status": 403, "message": "Requires an admin or manager account"}
# Talent.gs SHARED_LINE_DIGITS: the company's own lines
SHARED_LINE_DIGITS = ("3307544040", "3309195558", "3309195559")
# the three lists live in the words book; the seed is the floor, never an empty vocabulary
INSTITUTIONAL_SEED = ("info@", "hr@", "admin@", "support@", "office@", "billing@", "noreply@", "no-reply@", "payroll@",
                      "contact@")
STATUS_VOCAB_SEED = ("active", "inactive", "archived", "pending", "unknown", "other", "admin", "onboarding", "on leave",
                     "offboarding", "terminated", "away", "off")
ROLE_VOCAB_SEED = ("staff", "admin", "administrator", "manager", "director", "dsp", "direct support professional",
                   "direct support professional (dsp)", "house manager", "hm", "nurse", "rn", "lpn", "qidp",
                   "supervisor", "division supervisor", "coordinator", "software engineer", "hr", "finances",
                   "quality", "entity", "guardian", "client", "interviewer", "onboarding")
BULK_NEAR_RATIO = 0.88
PREVIEW_NAMED = 80
PREVIEW_PLAN = 300
# the relay applies these gates too (server/contacts_slices.py); this door applies them again before writing
FORM_WORDS = re.compile(r"ssn|social security|applica|street|zip|date of birth|\bdob\b|\[|\]|home phone|mobile phone|"
                        r"please explain|branch|position|signature|initial|last first|p\.?o\.? box|louisville|44641|"
                        r"http|www\.|\.com\b|@", re.I | re.A)
TEST_WORDS = re.compile(r"\btest\b|\bteste\b|\bprobe\b|\bdiag\b|\bsample\b|\bdummy\b|\bplaceholder\b", re.I | re.A)
ROLE_FREE = re.compile(r"[a-z][a-z /&\-().]{1,39}")
EMAIL = re.compile(r"[a-z0-9._%+\-']+@[a-z0-9.\-]+\.[a-z]{2,}")
NAME_TOKEN = re.compile(r"[a-z][a-z'\-.]*")
_DIGIT = re.compile(r"[0-9]")
_NOT_DIGITS = re.compile(r"[^0-9]+")
# JavaScript's \s
_JS_WS = re.compile("[\t\n\x0b\x0c\r \xa0  -     　﻿]+")
_MARKS = re.compile("[̀-ͯ]")
_ISO_START = re.compile(r"([0-9]{4})[-/]([0-9]{1,2})[-/]([0-9]{1,2})")
_US_DAY = re.compile(r"([0-9]{1,2})[/\-]([0-9]{1,2})[/\-]([0-9]{2,4})")
_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9\-_.]{0,19}")
_CITY = re.compile(r"[A-Za-z][A-Za-z .'\-]{1,39}")
_COVERAGE = re.compile(r"[^a-z0-9,_\- ]", re.I | re.A)
_INDEX = re.compile(r"0|[1-9][0-9]*")

s_ = gsjs.str_


# ---- what JavaScript does to a value --------------------------------------------------------------------------------

def js_len(s: str) -> int:
    """String.prototype.length, in UTF-16 units."""
    return len(s.encode("utf-16-le", "surrogatepass")) // 2


def js_slice(s: str, n: int) -> str:
    """String.prototype.slice(0, n), in UTF-16 units."""
    return s.encode("utf-16-le", "surrogatepass")[:2 * n].decode("utf-16-le", "replace")


def js_keys(d: dict) -> list[str]:
    """Object.keys: the array-index keys first, ascending, then the rest as they were added."""
    idx = [k for k in d if _INDEX.fullmatch(k) and int(k) < 4294967295]
    held = set(idx)
    return sorted(idx, key=int) + [k for k in d if k not in held]


def get(row: Any, key: str) -> Any:
    """row && row[key]: a field of an object, nothing of anything else."""
    return row.get(key) if isinstance(row, dict) else None


def cstr(v: Any) -> str:
    """contactsStr_: a Date as its UTC day, anything else trimmed."""
    if v is None:
        return ""
    if isinstance(v, SheetDate):
        at = v.at
        return f"{at.year}-{at.month:02d}-{at.day:02d}"
    return gsjs.trim(gsjs.js_str(v))


def spaced(v: Any) -> str:
    return _JS_WS.sub(" ", cstr(v))


def fold(v: Any) -> str:
    """contactsFold_."""
    s = spaced(v)
    try:
        s = _MARKS.sub("", unicodedata.normalize("NFKD", s))
    except ValueError:
        pass
    return s.lower()


def bulk_name_key(v: Any) -> str:
    """bulkNameKey_."""
    return re.sub(r"[^a-z0-9]+", "", gsjs.or_text(v).lower())


def bulk_name_key_no_middle(v: Any) -> str:
    """bulkNameKeyNoMiddle_."""
    parts = [w for w in _JS_WS.split(re.sub(r"[^a-z ]+", " ", gsjs.or_text(v).lower())) if w]
    if len(parts) >= 3:
        parts = [w for i, w in enumerate(parts) if i == 0 or i == len(parts) - 1 or len(w) > 1]
    return "".join(parts)


def bulk_phone_key(v: Any) -> str:
    """bulkPhoneKey_."""
    d = _NOT_DIGITS.sub("", gsjs.or_text(v))
    return d[-10:] if len(d) >= 10 else ""


def bulk_name_ratio(a: str, b: str) -> float:
    """bulkNameRatio_: 1 less the edit distance over the longer length."""
    if not a or not b:
        return 0.0
    if a == b:
        return 1.0
    prev = list(range(len(b) + 1))
    for i in range(1, len(a) + 1):
        cur = [i] + [0] * len(b)
        for j in range(1, len(b) + 1):
            cost = 0 if a[i - 1] == b[j - 1] else 1
            cur[j] = min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost)
        prev = cur
    longest = max(len(a), len(b))
    return (longest - prev[len(b)]) / longest if longest else 0.0


# ---- the words book and the lines -----------------------------------------------------------------------------------

def book_rows(reads: L.Reads, tab: str) -> list[dict]:
    """hubBookRows_: the generic config book's tab, its headers snake_cased; none when it cannot be read."""
    def read() -> list[dict]:
        try:
            sid = reads.db.prop(GENERIC_CONFIG_PROP)
            ref = HT.tab_of(reads, sid, tab, f"the {tab} book") if sid else None
            if ref is None:
                return []
            heads = [re.sub(r"[^a-z0-9]+", "_", gsjs.trim(gsjs.or_text(h)).lower()) for h in ref.headers]
            out = []
            for _rn, raw in reads.db.rows(ref):
                row: dict[str, Any] = {}
                filled = False
                for k, h in zip(heads, ref.headers):
                    if not k:
                        continue
                    cell = hubdb.typed(raw.get(h), "hub")
                    row[k] = cell
                    if gsjs.trim(gsjs.or_text(cell)):
                        filled = True
                if filled:
                    out.append(row)
            return out
        except (hubdb.Unreadable, Defer):
            raise
        except Exception:  # noqa: BLE001 - the floor answers, as hubBookRows_'s catch has it
            return []
    return reads.once("cs_book:" + tab, read)


def book_on(row: dict) -> bool:
    """hubBookOn_."""
    v = row["active"] if "active" in row else row.get("enabled")
    return gsjs.trim(gsjs.or_text(v) or "on").lower() not in ("off", "false", "no", "0")


def book_list(reads: L.Reads, tab: str, column: str, floor: tuple[str, ...]) -> list[str]:
    """hubBookList_: one column of a words book tab, each row on, lower-cased; the floor when it is silent."""
    out = [w.lower() for w in (gsjs.trim(gsjs.or_text(r.get(column))) for r in book_rows(reads, tab) if book_on(r))
           if w]
    return out or list(floor)


class Words:
    """The words book's three lists and the line directory, read once for one request."""

    def __init__(self, reads: L.Reads) -> None:
        self.reads = reads
        self._lists: dict[str, list[str]] = {}

    def _list(self, tab: str, column: str, floor: tuple[str, ...]) -> list[str]:
        if tab not in self._lists:
            self._lists[tab] = book_list(self.reads, tab, column, floor)
        return self._lists[tab]

    def institutional(self) -> list[str]:
        """contactsInstitutional_."""
        return self._list("Contacts Institutional", "prefix", INSTITUTIONAL_SEED)

    def statuses(self) -> list[str]:
        """contactsStatusVocab_."""
        return self._list("Contacts Statuses", "status", STATUS_VOCAB_SEED)

    def roles(self) -> list[str]:
        """contactsRoleVocab_."""
        return self._list("Contacts Roles", "role", ROLE_VOCAB_SEED)

    def shared(self, digits: str) -> bool:
        """hubLineSharedForIdentity_, a directory that cannot answer naming nobody shared."""
        try:
            return LD.shared_for_identity(self.reads, digits)
        except Exception:  # noqa: BLE001 - as the door's own catch has it
            return False


# ---- each field's gate ----------------------------------------------------------------------------------------------

def name_clean(v: Any) -> str:
    """contactsNameClean_."""
    s = spaced(v)
    if not s or js_len(s) > 60:
        return ""
    if FORM_WORDS.search(s) or TEST_WORDS.search(s) or _DIGIT.search(s):
        return ""
    tokens = fold(s).split(" ")
    if len(tokens) < 2 or len(tokens) > 5:
        return ""
    return s if all(NAME_TOKEN.fullmatch(t) for t in tokens) else ""


def name_part_clean(v: Any) -> str:
    """contactsNamePartClean_."""
    s = spaced(v)
    if not s or FORM_WORDS.search(s) or _DIGIT.search(s):
        return ""
    tokens = fold(s).split(" ")
    if len(tokens) < 1 or len(tokens) > 3:
        return ""
    return s if all(NAME_TOKEN.fullmatch(t) for t in tokens) else ""


def status_clean(v: Any, w: Words) -> str:
    """contactsStatusClean_."""
    s = fold(v)
    if not s or s == "active test":
        return ""
    return s if s in w.statuses() else ""


def email_clean(v: Any) -> str:
    """contactsEmailClean_."""
    s = fold(v)
    if not s or not EMAIL.fullmatch(s):
        return ""
    return "" if TEST_WORDS.search(s.split("@")[0]) else s


def phone_digits(v: Any, w: Words) -> str:
    """contactsPhoneDigits_: a shared company line identifies nobody, nor a suffix of one (a mistyped company line)."""
    d = _NOT_DIGITS.sub("", cstr(v))
    if len(d) == 11 and d[0] == "1":
        d = d[1:]
    if len(d) != 10 or d[0] in "01" or len(set(d)) < 3:
        return ""
    if w.shared(d):
        return ""
    for line in SHARED_LINE_DIGITS:
        sd = _NOT_DIGITS.sub("", line)
        if sd and (sd == d or (len(sd) >= 7 and d[-len(sd):] == sd)):
            return ""
    return d


def phone_clean(v: Any, w: Words) -> str:
    """contactsPhoneClean_."""
    d = phone_digits(v, w)
    return f"{d[:3]}-{d[3:6]}-{d[6:]}" if d else ""


def date_clean(v: Any) -> str:
    """contactsDateClean_."""
    if isinstance(v, SheetDate):
        return cstr(v) if 1940 <= v.at.year <= 2100 else ""
    s = cstr(v)
    if not s:
        return ""
    m = _ISO_START.match(s)
    if m:
        y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
    else:
        m = _US_DAY.fullmatch(s)
        if not m:
            return ""
        mo, d, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
        if len(m.group(3)) == 2:
            y += 2000 if y < 50 else 1900
    if y < 1940 or y > 2100 or mo < 1 or mo > 12 or d < 1 or d > 31:
        return ""
    return f"{y}-{mo:02d}-{d:02d}"


def id_clean(v: Any) -> str:
    """contactsIdClean_."""
    s = cstr(v)
    return s if s and _ID.fullmatch(s) and not FORM_WORDS.search(s) else ""


def city_clean(v: Any) -> str:
    """contactsCityClean_."""
    s = spaced(v)
    return s if s and _CITY.fullmatch(fold(s)) and not FORM_WORDS.search(s) else ""


def state_clean(v: Any) -> str:
    """contactsStateClean_."""
    s = spaced(v)
    if not s or FORM_WORDS.search(s):
        return ""
    f = fold(s)
    if re.fullmatch(r"[a-z]{2}", f):
        return s.upper()
    return s if re.fullmatch(r"[a-z][a-z ]{2,29}", f) else ""


def role_clean(role: Any, provenance: dict | None, w: Words) -> str:
    """contactsRoleClean_: an old-platform-provenance role is trusted; anything else must be vocabulary or short plain words."""
    r = spaced(role)
    if not r:
        return ""
    if provenance and gsjs.or_text(provenance.get("role")) == "erp" and not FORM_WORDS.search(r):
        return js_slice(r, 80)
    low = fold(r)
    if low in w.roles():
        return r
    if FORM_WORDS.search(r) or _DIGIT.search(r) or not ROLE_FREE.fullmatch(low):
        return ""
    return "" if len(low.split(" ")) > 5 else r


def row_clean(r: Any, w: Words) -> dict[str, str] | None:
    """contactsRowClean_: a row the filter takes, every field through its gate; None for one it refuses whole."""
    if not isinstance(r, dict):
        return None
    name = name_clean(r.get("name"))
    if not name:
        return None
    return {"id": js_slice(cstr(r.get("id")), 40), "name": name, "first_name": name_part_clean(r.get("first_name")),
            "last_name": name_part_clean(r.get("last_name")), "role": role_clean(r.get("role"), None, w),
            "status": status_clean(r.get("status"), w), "email": email_clean(r.get("email")),
            "phone": phone_clean(r.get("phone"), w), "city": city_clean(r.get("city")),
            "state": state_clean(r.get("state")), "employee_id": id_clean(r.get("employee_id")),
            "start_date": date_clean(r.get("start_date")), "end_date": date_clean(r.get("end_date")),
            "source": PEOPLE_SOURCE,
            "source_coverage": js_slice(_COVERAGE.sub("", cstr(r.get("source_coverage"))), 80),
            "external_id": js_slice(cstr(r.get("external_id")), 80),
            "updated_at": js_slice(cstr(r.get("updated_at")), 40)}


def email_key(v: Any, w: Words) -> str:
    """contactsEmailKey_: an institutional address keys nobody."""
    k = cstr(v).lower()
    if not k or "@" not in k:
        return ""
    return "" if any(k.startswith(p) for p in w.institutional()) else k


def phones_of(row: Any) -> list[str]:
    """contactsPhonesOf_."""
    out = []
    one = cstr(get(row, "phone"))
    if one:
        out.append(one)
    for p in SP._parse_phones(get(row, "phones")):
        n = cstr(get(p, "number"))
        if n:
            out.append(n)
    return out


def emails_of(row: Any) -> list[str]:
    """contactsEmailsOf_."""
    out = []
    one = cstr(get(row, "email"))
    if one:
        out.append(one)
    for e in CW.parse_emails(get(row, "emails")):
        v = cstr(e)
        if v:
            out.append(v)
    return out


# ---- the People house reconciled ------------------------------------------------------------------------------------

def reconcile(header: list[str], grid: list[dict[str, str]], rows: list[Any], w: Words,
              stop: Callable[[dict], bool] | None = None) -> dict[str, Any]:
    """contactsPeopleReconcile_ over the house's cells as text: another lane's row, or a row the payload omits, is left
    alone — this adds and refreshes, never removes. `changed` holds each refreshed row's new cells (a row seen twice
    is compared with what the first made of it), `cells` how many cells the change names; `stop`, asked after each
    row, ends the pass there and `consumed` says how many rows it took."""
    have = set(header)
    for need in ("id", "source") + PEOPLE_FIELDS:
        if need not in have:
            return {"error": f'The People house lacks the column "{need}".'}
    by_id: dict[str, int] = {}
    for i, cur in enumerate(grid):
        rid = cur.get("id", "")
        if rid and rid not in by_id:
            by_id[rid] = i
    out: dict[str, Any] = {"changed": {}, "appended": [], "updated": 0, "inserted": 0, "unchanged": 0, "foreign": 0,
                           "unnamed": 0, "refused": 0, "refused_named": [], "cells": 0, "consumed": len(rows or [])}
    for n, raw in enumerate(rows or []):
        if stop is not None and n and stop(out):
            out["consumed"] = n
            break
        r = row_clean(raw, w)
        if r is None:
            raw_name = js_slice(cstr(get(raw, "name")), 40)
            if not raw_name:
                out["unnamed"] += 1
                continue
            out["refused"] += 1
            if len(out["refused_named"]) < 40:
                out["refused_named"].append(raw_name)
            continue
        rid = r["id"]
        if not rid:
            out["unnamed"] += 1
            continue
        at = by_id.get(rid)
        if at is None:
            line = {h: "" for h in header}
            line["id"] = rid
            for f in PEOPLE_FIELDS:
                line[f] = r[f]
            line["source"] = PEOPLE_SOURCE
            out["appended"].append(line)
            out["inserted"] += 1
            out["cells"] += sum(1 for v in line.values() if v != "")
            continue
        cur = grid[at]
        owner = cur.get("source", "")
        if owner and owner != PEOPLE_SOURCE:
            out["foreign"] += 1
            continue
        touched = False
        for f in PEOPLE_FIELDS:
            v = PEOPLE_SOURCE if f == "source" else r[f]
            if cur.get(f, "") != v:
                cur[f] = v
                cells = out["changed"].setdefault(at, {})
                out["cells"] += 0 if f in cells else 1
                cells[f] = v
                touched = True
        if touched:
            out["updated"] += 1
        else:
            out["unchanged"] += 1
    return out


def source_enabled(reads: L.Reads) -> bool:
    """contactsSourceEnabled_: on unless roster_sources switches ops_employees off."""
    res = reads.db.resolve(ROSTER_SOURCES_TAB)
    if res.ref is None and not res.book_known:
        raise hubdb.Unreadable("asa-hub-db holds no copy of the book behind roster_sources")
    try:
        if res.ref is None:
            return True
        grid = reads.db.grid(res.ref)
        if len(grid) < 2:
            return True
        hdr = [hubdb.norm_key(h) for h in grid[0]]
        if "key" not in hdr or "enabled" not in hdr:
            return True
        i_key, i_on = hdr.index("key"), hdr.index("enabled")
        for line in grid[1:]:
            if s_(hubdb.typed(line[i_key], "hub")) != "ops_employees":
                continue
            return s_(hubdb.typed(line[i_on], "hub")).lower() not in ("no", "false", "off", "0")
    except Exception:  # noqa: BLE001 - on, as Apps Script's catch has it
        return True
    return True


def source_stamp(reads: L.Reads) -> str:
    """hubProp_(PEOPLE_SYNC_SOURCE_AT): the stamp Python's sync kept, else the one Apps Script's left."""
    try:
        got = RR._q(reads, f"select value from {STATE} where key = %s", (SOURCE_STAMP,))
    except Exception:  # noqa: BLE001 - a table not made yet holds no stamp
        got = []
    return s_(got[0][0]) if got and s_(got[0][0]) else s_(reads.db.prop(SOURCE_STAMP))


# ---- the contact merge's plan ---------------------------------------------------------------------------------------

def on_staff_statuses(reads: L.Reads) -> dict[str, bool]:
    """contactsOnStaffStatuses_ (cgBlockStatuses_, default active/admin)."""
    try:
        raw = gsjs.or_text(reads.config().get("staff_guard_block_statuses"))
    except (hubdb.Unreadable, Defer):
        raise
    except Exception:  # noqa: BLE001 - the default, as cgBlockStatuses_'s catch has it
        raw = ""
    out = {v: True for v in (gsjs.trim(x).lower() for x in re.split(r"[,;\n]+", raw or "active, admin")) if v}
    return out or {"active": True, "admin": True}


def merge_hint(u: dict, uname: str, by_email: dict, by_phone: dict, by_no_middle: dict, dup: dict, w: Words) -> str:
    """contactsMergeHint_: the roster row an account's own writing points at — a profile e-mail, a phone, the name
    without its middle — worded for an administrator; '' when none points at exactly one."""
    for m in (email_key(e, w) for e in CW.parse_emails(u.get("emails"))):
        if m and not dup["email"].get(m) and m in by_email:
            return gsjs.js_str(by_email[m].get("name")) + " (by a profile e-mail)"
    for k in (bulk_phone_key(n) for n in phones_of(u)):
        if k and not dup["phone"].get(k) and k in by_phone:
            return gsjs.js_str(by_phone[k].get("name")) + " (by a phone)"
    nm = bulk_name_key_no_middle(uname)
    if nm and not dup["nomid"].get(nm) and nm in by_no_middle:
        return gsjs.js_str(by_no_middle[nm].get("name")) + " (by the name without its middle)"
    return ""


def link_proof(u: dict, p: dict, w: Words) -> str:
    """contactsLinkProof_: 'email' when the row carries the account's sign-in address, 'name' when the row is its exact
    name, carries no other personal address, and the account did not choose that name itself; '' otherwise."""
    sign_in = email_key(u.get("email"), w)
    row_mails = [k for k in (email_key(e, w) for e in emails_of(p)) if k]
    if sign_in and sign_in in row_mails:
        return "email"
    if s_(u.get("nameby")).lower() == "self":
        return ""
    nk = bulk_name_key(s_(u.get("displayname")))
    return "name" if nk and nk == bulk_name_key(p.get("name")) and not row_mails else ""


def _sources(u: dict) -> dict:
    try:
        got = json.loads(s_(u.get("contactsources")) or "{}") or {}
    except ValueError:
        got = {}
    return got if isinstance(got, dict) else {}


def merge_plan(users: list[dict], people: list[dict], now: str, on_staff: dict, w: Words) -> dict[str, Any]:
    """contactsMergePlan_: link, sign-in e-mail, exact roster name; a key two roster people share is ambiguous, a near
    name only reported."""
    staff = on_staff if isinstance(on_staff, dict) and on_staff else {"active": True, "admin": True}

    def is_on_staff(p: dict) -> bool:
        return staff.get(cstr(p.get("status")).lower()) is True

    by_id: dict[str, dict] = {}
    by_email: dict[str, dict] = {}
    by_phone: dict[str, dict] = {}
    by_name: dict[str, dict] = {}
    by_no_middle: dict[str, dict] = {}
    by_name_all: dict[str, list[dict]] = {}
    dup: dict[str, dict[str, bool]] = {"email": {}, "phone": {}, "name": {}, "nomid": {}}

    def claim(where: dict, dups: dict, key: str, p: dict) -> None:
        if not key:
            return
        if key in where and cstr(where[key].get("id")) != cstr(p.get("id")):
            dups[key] = True
            return
        where[key] = p

    for p in people or []:
        if not isinstance(p, dict):
            continue
        pid = cstr(p.get("id"))
        if not pid or not cstr(p.get("name")):
            continue
        by_id[pid] = p
        for e in emails_of(p):
            claim(by_email, dup["email"], email_key(e, w), p)
        for ph in phones_of(p):
            claim(by_phone, dup["phone"], bulk_phone_key(ph), p)
        claim(by_name, dup["name"], bulk_name_key(p.get("name")), p)
        claim(by_no_middle, dup["nomid"], bulk_name_key_no_middle(p.get("name")), p)
        nk0 = bulk_name_key(p.get("name"))
        if nk0:
            by_name_all.setdefault(nk0, []).append(p)
    names = [(k, by_name[k].get("name")) for k in js_keys(by_name)]

    out: dict[str, Any] = {"plan": [], "near": [], "confirm": [], "ambiguous": [], "unmatched": [], "examined": 0,
                           "skipped_merged": 0, "skipped_client": 0, "unchanged": 0, "garbage_roles": 0,
                           "matched_by": {"link": 0, "email": 0, "phone": 0, "name": 0}}

    def row_key(v: Any) -> str:
        return gsjs.trim(re.sub(r"^people:", "", cstr(v)))

    # the roster rows accounts already stand on; a merged-away account stands nowhere
    standing: dict[str, list[str]] = {}
    for u in users or []:
        if s_(u.get("mergedinto")):
            continue
        at = row_key(u.get("peopleid"))
        if at and at in by_id:
            standing.setdefault(at, []).append(s_(u.get("userid")))

    def stands_elsewhere(row_id: Any, uid: str) -> bool:
        return any(x != uid for x in standing.get(row_key(row_id), []))

    def off_staff(p: dict) -> str:
        st = cstr(p.get("status"))
        return f'the roster row is marked "{st}", not on staff' if st else "the roster row carries no staff status"

    def pname(p: dict) -> str:
        return gsjs.js_str(p.get("name")) if p.get("name") is not None else "undefined"

    found: list[dict] = []
    for u in users or []:
        uname = s_(u.get("displayname"))
        if s_(u.get("mergedinto")):
            out["skipped_merged"] += 1
            continue
        if s_(u.get("role")) == "client" or s_(u.get("clientkey")):
            out["skipped_client"] += 1
            continue
        out["examined"] += 1
        p: dict | None = None
        how = amb = proof = ""
        uid = s_(u.get("userid"))
        sources = _sources(u)
        linked = s_(u.get("peopleid"))
        if linked and linked in by_id:
            p, how = by_id[linked], "link"
            recorded = s_(sources.get("people_id"))
            if recorded not in ("email", "name"):
                # a link written before proofs were recorded stands only on the sign-in e-mail
                proof = "email" if link_proof(u, p, w) == "email" else ""
                why = ("its sign-in e-mail is not on the row" if not proof else off_staff(p) if not is_on_staff(p)
                       else "another account is linked to the row" if stands_elsewhere(p.get("id"), uid) else "")
                if why:
                    out["confirm"].append(f"{uname} ~ {pname(p)} (linked by an older rule: {why})")
                    continue
        if p is None:
            sign_in, by_sign = email_key(u.get("email"), w), None
            if sign_in and dup["email"].get(sign_in):
                amb = "e-mail shared by several roster people"
            elif sign_in and sign_in in by_email:
                by_sign = by_email[sign_in]
            same_name = by_name_all.get(bulk_name_key(uname)) or []
            if not amb and by_sign is not None:
                agrees = not same_name or any(cstr(r.get("id")) == cstr(by_sign.get("id")) for r in same_name)
                if agrees:
                    p, how = by_sign, "email"
                else:
                    amb = "sign-in e-mail on one roster row and name on another"
            elif not amb and len(same_name) == 1:
                p, how = same_name[0], "name"
            elif not amb and len(same_name) > 1:
                amb = "name shared by several roster people"
            if p is not None and not amb:
                # a name alone links only a row with no other address, never a self-chosen name
                if how == "name" and not link_proof(u, p, w):
                    out["confirm"].append(f"{uname} ~ {pname(p)}" + (" (the account chose that name itself)"
                                                                    if s_(u.get("nameby")).lower() == "self"
                                                                    else " (the roster row carries another e-mail)"))
                    continue
                if not is_on_staff(p):
                    out["confirm"].append(f"{uname} ~ {pname(p)} ({off_staff(p)})")
                    continue
                if stands_elsewhere(p.get("id"), uid):
                    amb = "roster row already linked to another account"
        if amb:
            out["ambiguous"].append(f"{uname} ({amb})")
            continue
        if p is None:
            hint = merge_hint(u, uname, by_email, by_phone, by_no_middle, dup, w)
            if hint:
                out["confirm"].append(f"{uname} ~ {hint}")
                continue
            best, best_r, key0 = None, 0.0, bulk_name_key(uname)
            if key0:
                for k, nm in names:
                    r = bulk_name_ratio(key0, k)
                    if r > best_r:
                        best_r, best = r, nm
            if not gsjs.falsy(best) and best_r >= BULK_NEAR_RATIO:
                out["near"].append(f"{uname} ~ {gsjs.js_str(best)} ({int(gsjs.js_round(best_r * 100))}%)")
            else:
                out["unmatched"].append(uname)
            continue
        found.append({"u": u, "uname": uname, "p": p, "how": how, "proof": proof, "sources": sources})

    # one roster row that several accounts would newly stand on is none of theirs
    fresh: dict[str, int] = {}
    for f in found:
        if f["how"] != "link":
            k = row_key(f["p"].get("id"))
            fresh[k] = fresh.get(k, 0) + 1
    for f in found:
        u, uname, p, how, sources = f["u"], f["uname"], f["p"], f["how"], f["sources"]
        if how != "link" and fresh.get(row_key(p.get("id")), 0) > 1:
            out["ambiguous"].append(f"{uname} (roster row several accounts point at)")
            continue
        out["matched_by"][how] += 1
        sets: dict[str, str] = {}
        phones_add: list[dict] = []
        emails_add: list[str] = []
        coverage = cstr(p.get("source_coverage"))
        frm = "platform" + (":" + coverage if coverage else "")
        # always linked, so the next pass matches by id — and what proved the link is kept with it
        if s_(u.get("peopleid")) != cstr(p.get("id")):
            sets["people_id"] = cstr(p.get("id"))
        proven = f["proof"] if how == "link" else how
        stamped = bool(proven) and s_(sources.get("people_id")) != proven
        if stamped:
            sources["people_id"] = proven
        # blank-only, each through its gate: older roster rows predate the filter
        title = role_clean(p.get("role"), None, w)
        if cstr(p.get("role")) and not title:
            out["garbage_roles"] += 1
        wants = {"title": title, "employee_id": id_clean(p.get("employee_id")),
                 "start_date": date_clean(p.get("start_date")), "end_date": date_clean(p.get("end_date"))}
        for k, v in wants.items():
            if not v or s_(u.get(hubdb.norm_key(k))):
                continue
            sets[k] = v
            sources[k] = frm
        # informative only: it never flips `active`
        status = status_clean(p.get("status"), w)
        if status and s_(u.get("rosterstatus")) != status:
            sets["roster_status"] = status
        # a different number is appended as context, never a correction
        have = {d for d in (bulk_phone_key(n) for n in phones_of(u)) if d}
        count = len(SP._parse_phones(u.get("phones")))
        platform_phones = [c for c in (phone_clean(n, w) for n in phones_of(p)) if c]
        for n in platform_phones:
            d = bulk_phone_key(n)
            if not d or d in have or count + len(phones_add) >= 8:
                continue
            have.add(d)
            phones_add.append({"label": LABEL, "number": n})
        if not s_(u.get("phone")) and platform_phones:
            sets["phone"] = platform_phones[0]
            sources["phone"] = frm
        # the sign-in address is never written; other addresses go beside it
        login = s_(u.get("email")).lower()
        have_em = {login} if login else set()
        mails = CW.parse_emails(u.get("emails"))
        have_em |= {s_(e).lower() for e in mails}
        for e in emails_of(p):
            v = email_clean(e)
            if not v or v in have_em or len(mails) + len(emails_add) >= 8:
                continue
            have_em.add(v)
            emails_add.append(v)
        if phones_add:
            sources["phones"] = frm
        if emails_add:
            sources["emails"] = frm
        if not sets and not phones_add and not emails_add and not stamped:
            out["unchanged"] += 1
            continue
        sets["contact_sources"] = json.dumps(sources, separators=(",", ":"), ensure_ascii=False)
        sets["contact_synced_at"] = now
        out["plan"].append({"user_id": s_(u.get("userid")), "name": uname, "matched_by": how,
                            "people_id": cstr(p.get("id")), "person": cstr(p.get("name")), "set": sets,
                            "phones_add": phones_add, "emails_add": emails_add})
    return out


# ---- usersContactMergePreview ---------------------------------------------------------------------------------------

def merge_inputs(reads: L.Reads) -> dict[str, Any]:
    """contactsMergeInputs_: the accounts, the merged roster without the plans' clients, the on-staff statuses."""
    return {"users": reads.users(),
            "people": SP.without_isp_clients(reads, SP.people_merged(reads, SP._people(reads))) or [],
            "on_staff": on_staff_statuses(reads)}


def merge_preview(sess: L.Session, payload: dict) -> dict[str, Any]:
    """usersContactMergePreview: what the contact merge would do — every account named, nothing written."""
    user = sess.user
    if not user or user.get("is_service") or s_(user.get("role")) != "admin":
        return dict(DENIED)
    reads = sess.reads
    inputs = merge_inputs(reads)
    planned = merge_plan(inputs["users"], inputs["people"], gsjs.iso(reads.now), inputs["on_staff"], Words(reads))
    n = PREVIEW_NAMED
    return {"status": 200, "data": {
        "examined": planned["examined"], "planned": len(planned["plan"]), "unchanged": planned["unchanged"],
        "matched_by": planned["matched_by"],
        "skipped_merged": planned["skipped_merged"], "skipped_client": planned["skipped_client"],
        "garbage_roles": planned["garbage_roles"],
        "near": len(planned["near"]), "near_named": planned["near"][:n],
        "confirm": len(planned["confirm"]), "confirm_named": planned["confirm"][:n],
        "ambiguous": len(planned["ambiguous"]), "ambiguous_named": planned["ambiguous"][:n],
        "unmatched": len(planned["unmatched"]), "unmatched_named": planned["unmatched"][:n],
        "people": len(inputs["people"]),
        "source_at": source_stamp(reads),
        "plan": [{"user_id": it["user_id"], "name": it["name"], "matched_by": it["matched_by"],
                  "person": it["person"],
                  "fills": [k for k in it["set"] if k not in ("contact_sources", "contact_synced_at")],
                  "phones_add": len(it["phones_add"]), "emails_add": len(it["emails_add"])}
                 for it in planned["plan"][:PREVIEW_PLAN]]}}


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {"usersContactMergePreview": merge_preview}
POLICY: dict[str, dict[str, Any]] = {"usersContactMergePreview": {"roles": ("admin",)}}
