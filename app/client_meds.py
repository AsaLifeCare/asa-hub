"""Clients › Medication off asa-hub-db: Administration (ClientSourceMar.gs) and Refills (ClientSourceRefills.gs)."""
from __future__ import annotations

import functools
import re
from datetime import date, datetime, timedelta, timezone
from typing import Any, Callable

import drive as dr
import gsjs
import house_tables as HT
import hubdb
import locations as L
import scope as sc
from gsjs import NY, SheetDate, name_key
from scope import Defer

POLICY_ROLES = ("admin", "director", "manager", "staff", "client", "onboarding", "interviewer")
EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)

# ---- ClientSourceMar.gs ----------------------------------------------------------------------------------------

CSM_TABS = ("papers", "passes", "errors")
CSM_PASS_WORDS = {"pass": "Recorded", "cancel": "Not given", "discontinued": "Discontinued", "breakdown": "Breakdown"}
CSM_PASS_STATUSES = ("Recorded", "Not given", "Discontinued", "Breakdown")
CSM_PASS_TIME_COLUMNS = (("schedule", "pass time"), ("src_prn_pass_time", "PRN pass time"))
CSM_PAPER_STATUSES = ("Latest", "Earlier", "Undated")
CSM_ERROR_KINDS = (("missed", "Missed"), ("wrong day", "Wrong day"), ("unavailable", "Unavailable"),
                   ("no staff", "No staff"), ("controlled", "Controlled"))
CSM_ERROR_MARKS = ("circled", "initialed", "explained")
CSM_ERROR_STATUSES = ("Missed", "Wrong day", "Unavailable", "No staff", "Controlled", "Marked", "Not flagged")
CSM_ERROR_SLOT = {"Missed": "missed", "Wrong day": "wrong_day", "Unavailable": "unavailable", "No staff": "no_staff",
                  "Controlled": "controlled"}
CSM_SHARED_SIGNER = "asatech"
CSM_SHARED_SIGNER_WORDS = "System account (eMAR pilot)"
CSM_MONTHS = ("january", "february", "march", "april", "may", "june", "july", "august", "september", "october",
              "november", "december")
# ClientFilesIndex.gs CFX_COLS: the slim columns clientFilesAll_ hands back
CFX_COLS = ("id", "client_key", "client_name", "title", "folder", "kind", "doc_kind", "subject", "digest_category",
            "mime_type", "drive_id", "url", "size_bytes", "file_date", "issued_on", "expires_on", "modified_time",
            "createdAt", "digest_state", "digest_text_chars", "text_file")
CLIENT_FILES_TAB, MAR_ENTRIES_TAB, MAR_ERRORS_TAB = "client_files", "mar_entries", "mar_errors"
CSM_TEXT_MAX = 200000
# an OCR text larger than this is Apps Script's to read
CSM_TEXT_CAP = 32 * 1024 * 1024
_RE_WITHHELD = re.compile(r"\s*\[withheld: [a-z]+\](?:\s.*)?", re.S)
# the papers' texts, read once by the relay's MARS lane (server/mar_papers.py) and kept in the Hub's own tables
MAR_TEXTS_SQL = ("select drive_id, state, chars, error, attempts, next_try_at, read_at from app.mar_paper_texts")
MAR_TEXT_SQL = ("select state, text, chars, error, attempts, next_try_at, read_at from app.mar_paper_texts"
                " where drive_id = %s")
MAR_FOUND_SQL = ("select drive_id, client_folder, area, folder, title, mime_type, size_bytes, file_date, modified_time,"
                 " found_at from app.mar_papers where gone_at is null order by found_at, drive_id")
MAR_BEAT_SQL = "select swept_at, note from app.mar_papers_beat where id = 1"

_RE_INSTANT_HEAD = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}", re.A)
_RE_INSTANT_ZONE = re.compile(r"(Z|[+-]\d{2}:?\d{2})\Z", re.A)
_RE_ISO_HEAD = re.compile(r"^(\d{4})-(\d{1,2})-(\d{1,2})", re.A)
_RE_PD_ISO = re.compile(r"^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(:\d{2})?)?\Z", re.A)
_RE_PD_US = re.compile(r"^(\d{1,2})/(\d{1,2})/(\d{4}),?\s*(?:(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp][Mm])?)?\Z", re.A)
_RE_PD_CLOCK = re.compile(r"^(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp][Mm])?\Z", re.A)
_RE_ERR_DAY = re.compile(r"^(\d{1,2})/(\d{1,2})(?:/(\d{4}|\d{2})(?!\d))?", re.A)
_RE_PARENS = re.compile(r"\([^)]*\)")

# ---- ClientSourceRefills.gs ------------------------------------------------------------------------------------

CSR_BOOK_PROP = "HUB_MISSING_MEDS_SHEET_ID"
CSR_BOOK_FALLBACK = "19Umc82evptvKj7GLG2RNdr6VhKDnX0Mp6C1paX6Gw1w"
CSR_LIVE_TAB = "Form Responses 4"
CSR_EARLIER_TAB = "Form Responses 1"
CSR_LOW_TAB = "Low Refills"
CSR_CONTROL_TAB = "Medication Control"
CSR_COPY_TAB = "missing_medications"
CSR_CLOSED = re.compile(r"^(completed|resolved|received|closed|done)\b", re.I | re.A)
CSR_MONTHS = {"jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6, "jul": 7, "aug": 8, "sep": 9, "oct": 10,
              "nov": 11, "dec": 12}
CSR_MONTH_LABELS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")

_H_CLIENT_FORM = re.compile(r"^(select client:?|client name|client)\Z", re.I)
_H_CLIENT = re.compile(r"^client( name)?\Z", re.I)
_H_MEDS = re.compile(r"^(.+?)\s*:\s*medications?\s*\Z", re.I)
_H_OFFICE = re.compile(r"^column \d+\Z", re.I | re.A)
_H_RUNS = re.compile(r"^expected date to run out", re.I)
_H_TIMESTAMP = re.compile(r"^timestamp\Z", re.I)


# ---- the cells ---------------------------------------------------------------------------------------------------

def _as_text_cell(v: Any) -> Any:
    """getValues() of these platform-written tabs: their dates are text cells, so a date-looking text stays text."""
    t = hubdb.typed(v, "hub")
    return hubdb.typed(v, "raw") if isinstance(t, SheetDate) else t


def _need(reads: Any, tab: str) -> hubdb.TabRef | None:
    """hubTabSheet_ for a hub tab: a book the copy does not hold is Apps Script's to read; a tab not there is empty."""
    res = reads.db.resolve(tab)
    if res.runtime:
        raise Defer(f"{tab} lives in the depot's facts")
    if res.ref is None and not res.book_known:
        raise hubdb.Unreadable(f"asa-hub-db holds no copy of the book behind {tab}")
    return res.ref


def _rows(reads: Any, tab: str) -> list[dict]:
    """listRows_(resource, {}) → readAll_: header-keyed, deserialize_d, rows of nothing but blanks dropped."""
    def read() -> list[dict]:
        import resource_rows as RR  # noqa: PLC0415 - a tab kept in Postgres, read only where one is
        import sheet_resources as SR  # noqa: PLC0415
        kept = SR.TAB_OF.get(tab)
        if kept and RR.uploaded(reads.db, kept):
            heads, lines = RR.columns(reads, kept), [c for _k, c in RR.table_rows(reads, kept)]
        else:
            ref = _need(reads, tab)
            if ref is None:
                return []
            heads, lines = list(ref.headers), [raw for _rn, raw in reads.db.rows(ref)]
        out = []
        for raw in lines:
            vals = [_as_text_cell(raw.get(h)) for h in heads]
            if all(v == "" or v is None for v in vals):
                continue
            out.append({h: hubdb.cell_text(v) for h, v in zip(heads, vals) if h != ""})
        return out
    return reads.once("client_meds:" + tab, read)


def _files_house(reads: Any) -> tuple[list[str], list[tuple[int, dict]]]:
    """client_files' header and its rows by sheet row: its own table once kept there, else the copy's tab."""
    if HT.tabled(CLIENT_FILES_TAB):
        return HT.raw(reads, CLIENT_FILES_TAB)
    ref = _need(reads, CLIENT_FILES_TAB)
    return (list(ref.headers), reads.db.rows(ref)) if ref is not None else ([], [])


def _client_files_all(reads: Any) -> list[dict]:
    """clientFilesAll_: client_files' slim columns, each row with its sheet row, in sheet order."""
    def read() -> list[dict]:
        headers, rows = _files_house(reads)
        heads = [h for h in headers if h in CFX_COLS]
        out = []
        for rn, raw in rows:
            obj: dict[str, Any] = {}
            empty = True
            for h in heads:
                v = _as_text_cell(raw.get(h))
                if v != "" and v is not None:
                    empty = False
                obj[h] = hubdb.cell_text(v)
            if empty:
                continue
            obj["_row"] = rn
            out.append(obj)
        return out
    return reads.once("client_meds:client_files", read)


def _iso_at(v: Any) -> str:
    return v.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ") if isinstance(v, datetime) else _text(v)


def _found_papers(reads: Any, files: list[dict]) -> list[dict]:
    """The papers the MARS lane found in the drive and client_files does not hold, shaped as client_files' rows."""
    def read() -> list[dict]:
        held = {_text(r.get("drive_id")) for r in files}
        out = []
        try:
            got = reads.db.query(MAR_FOUND_SQL)
        except hubdb.Unreadable:
            return []
        for fid, who, area, folder, title, mime, size, day, modified, found in got:
            if fid in held:
                continue
            out.append({"id": "MARS_" + fid, "client_key": "", "client_name": who, "title": title,
                        "folder": folder or area, "kind": mime.split(".")[-1].split("/")[-1], "doc_kind": "mar",
                        "mime_type": mime, "drive_id": fid, "size_bytes": str(size or ""), "file_date": day,
                        "modified_time": _iso_at(modified), "createdAt": _iso_at(found), "digest_state": "",
                        "digest_text_chars": "", "text_file": "", "_found": True})
        return out
    return reads.once("client_meds:mar_found", read)


def _stored(reads: Any) -> dict[str, dict] | None:
    """Each paper's reading as the lane kept it, by drive_id; None when the store does not answer."""
    def read() -> dict[str, dict] | None:
        try:
            got = reads.db.query(MAR_TEXTS_SQL)
        except hubdb.Unreadable:
            return None
        return {fid: {"state": state, "chars": chars or 0, "error": error or "", "attempts": attempts or 0,
                      "next_try_at": _iso_at(nxt), "read_at": _iso_at(at)}
                for fid, state, chars, error, attempts, nxt, at in got}
    return reads.once("client_meds:mar_texts", read)


def _sweep(reads: Any) -> dict[str, str]:
    def read() -> dict[str, str]:
        try:
            got = reads.db.query(MAR_BEAT_SQL)
        except hubdb.Unreadable:
            return {"at": "", "note": ""}
        return {"at": _iso_at(got[0][0]) if got and got[0][0] else "", "note": (got[0][1] or "") if got else ""}
    return reads.once("client_meds:mar_beat", read)


def _identity_names(reads: Any, key: str) -> dict[str, bool]:
    """hubClientIdentity_(key).names: the key, and every folded name the roster gives it."""
    names = {key: True}
    for r in reads.clients_derived():
        if gsjs.str_(r.get("client_key")) != key:
            continue
        n = name_key(gsjs.str_(r.get("name")))
        if n:
            names[n] = True
    return names


def _ny_day(at: datetime) -> str:
    d = at.astimezone(NY)
    return f"{d.year:04d}-{d.month:02d}-{d.day:02d}"


def _labelled(names: tuple, index: int) -> str:
    """names[index] where JavaScript's out-of-range read is undefined."""
    return names[index] if 0 <= index < len(names) else ""


# ---- Administration: the helpers ---------------------------------------------------------------------------------

def _unknown() -> dict[str, Any]:
    return {"status": 404, "message": "Unknown action."}


def _own_only(reader: dict | None) -> bool:
    """csmOwnOnly_: a client, an SSA or a family member."""
    return bool(reader) and reader.get("kind") in ("client", "guardian", "ssa")


def _text(v: Any) -> str:
    """csmText_: a Date as ISO, else whitespace runs as one space, trimmed."""
    if isinstance(v, SheetDate):
        return gsjs.iso(v.at)
    return gsjs.text(v)


def _num(v: Any) -> int | float:
    s = gsjs.trim(gsjs.or_blank(v).replace(",", ""))
    if not re.fullmatch(r"[0-9]+(\.[0-9]+)?", s):
        return 0
    return float(s) if "." in s else int(s)


def _valid_day(y: int, m: int, d: int) -> str:
    if not (y >= 1900 and 1 <= m <= 12 and 1 <= d <= 31):
        return ""
    try:
        date(y, m, d)
    except ValueError:
        return ""
    return f"{y}-{m:02d}-{d:02d}"


def _clock(h: str, mi: str, ap: str) -> str:
    hh = int(h)
    if ap:
        hh = hh % 12 + (12 if re.search("p", ap, re.I) else 0)
    return f"{hh:02d}:{mi}" if 0 <= hh <= 23 else ""


def _instant(s: str) -> datetime | None:
    if not _RE_INSTANT_HEAD.match(s) or not _RE_INSTANT_ZONE.search(s):
        return None
    ms = gsjs.date_parse(s)
    if ms is None:
        return None
    try:
        return EPOCH + timedelta(milliseconds=round(ms))
    except OverflowError:
        return None


def _iso_day(v: Any) -> str:
    """csmIsoDay_: New York's calendar day of a Date, an instant or an ISO day; '' otherwise."""
    if isinstance(v, SheetDate):
        return _ny_day(v.at)
    s = _text(v)
    t = _instant(s)
    if t is not None:
        return _ny_day(t)
    m = _RE_ISO_HEAD.match(s)
    return _valid_day(int(m[1]), int(m[2]), int(m[3])) if m else ""


def _month_words(ym: Any) -> str:
    m = re.match(r"^(\d{4})-(\d{2})", gsjs.or_text(ym), re.A)
    if not m:
        return ""
    name = _labelled(CSM_MONTHS, int(m[2]) - 1)
    return name[:1].upper() + name[1:] + " " + m[1] if name else ""


def _day_words(iso: Any) -> str:
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})\Z", gsjs.or_text(iso), re.A)
    name = _labelled(CSM_MONTHS, int(m[2]) - 1) if m else ""
    return f"{name[:1].upper()}{name[1:3]} {int(m[3])}, {m[1]}" if name else ""


def _clock_words(hhmm: Any) -> str:
    m = re.match(r"^(\d{2}):(\d{2})\Z", gsjs.or_text(hhmm), re.A)
    if not m:
        return gsjs.or_text(hhmm)
    h = int(m[1])
    return f"{12 if h % 12 == 0 else h % 12}:{m[2]} {'AM' if h < 12 else 'PM'}"


def _size(n: int | float) -> str:
    if not n:
        return ""
    if n >= 1048576:
        return gsjs.num_str(gsjs.js_round(n / 104857.6) / 10) + " MB"
    return gsjs.num_str(max(1.0, gsjs.js_round(n / 1024))) + " KB"


def _fl_key(name: Any) -> str:
    """csmFlKey_: first and last word of a name, letters only."""
    toks = [t for t in re.split(r"\s+", re.sub(r"[^a-z ]+", "", gsjs.or_text(name).lower())) if t]
    return toks[0] + "_" + toks[-1] if len(toks) >= 2 else (toks[0] if toks else "")


def _mar_client(reads: Any, raw: Any) -> dict[str, Any]:
    """csmClient_: the roster row a client_key names, and every spelling of it."""
    key = gsjs.trim(gsjs.or_blank(raw))
    if not key or len(key) > 120:
        return {"refused": {"status": 400, "message": "client: a client_key."}}
    hit = None
    roster: dict[str, bool] = {}
    folds: dict[str, str] = {}
    people: list[dict] = []

    def put(k: str, ck: str) -> None:
        # a fold two clients share names nobody (csmScanRoster_)
        folds[k] = ck if folds.get(k, ck) == ck else ""

    for c in reads.clients_derived():
        ck = gsjs.trim(gsjs.or_text(c.get("client_key"))) or name_key(c.get("name"))
        if not ck:
            continue
        roster[ck] = True
        fold, fl = name_key(c.get("name")), _fl_key(c.get("name"))
        if fold:
            put(fold, ck)
        if fl:
            put("fl:" + fl, ck)
        people.append({"key": ck, "name": _text(c.get("name"))})
        if hit is None and ck == key:
            hit = c
    if hit is None:
        return {"refused": {"status": 404, "message": f'No client "{key}" is on the roster.'}}
    names = _identity_names(reads, key)
    own = name_key(hit.get("name"))
    if own:
        names[own] = True
    return {"key": key, "name": _text(hit.get("name")), "names": names, "roster": roster, "folds": folds,
            "people": people}


def _owns(c: dict, key: Any, name: Any) -> bool:
    """csmOwns_: by key; a row with no roster key, by its folded name; never another client's key."""
    k = _text(key)
    if k == c["key"]:
        return True
    if k and k in c["roster"]:
        return False
    n = name_key(name)
    return bool(n) and n in c["names"]


def _newest_cmp(a: dict, b: dict) -> int:
    if a["date"] != b["date"]:
        return 1 if a["date"] < b["date"] else -1
    at, bt = a.get("time") or "", b.get("time") or ""
    if at != bt:
        return 1 if at < bt else -1
    return (b.get("order") or 0) - (a.get("order") or 0)


_NEWEST = functools.cmp_to_key(_newest_cmp)


def _statuses(rows: list[dict], vocabulary: tuple) -> list[str]:
    seen: dict[str, bool] = {}
    for r in rows:
        seen[r["status"]] = True
        for k in r.get("kinds") or []:
            seen[k] = True
    out = [s for s in vocabulary if s in seen]
    out += [s for s in sorted(seen) if s not in out]
    return out


# ---- Administration: the MARS papers -------------------------------------------------------------------------------

def _folder_key(c: dict, name: Any) -> str:
    """csmFolderClient_: the client a drive folder's name is, by its fold first, then its first and last word."""
    fold, fl = name_key(name), _fl_key(name)
    if fold and fold in c["folds"]:
        return c["folds"][fold]
    return c["folds"].get("fl:" + fl, "") if fl else ""


def _papers_of(c: dict, rows: list[dict]) -> list[dict]:
    return [r for r in rows or [] if _text(r.get("doc_kind")).lower() == "mar"
            and _owns(c, _folder_key(c, r.get("client_name")) if r.get("_found") else r.get("client_key"),
                      r.get("client_name"))]


def _digest_words(state: Any) -> str:
    s = _text(state).lower()
    if s == "done":
        return "OCR read"
    if not s or s == "pending":
        return "OCR pending"
    return "OCR " + s


def _ocr_of(r: dict, stored: dict[str, dict] | None) -> dict[str, Any]:
    """The paper's reading as the store keeps it; a paper the store does not hold yet keeps the sheet's own words."""
    got = (stored or {}).get(_text(r.get("drive_id")))
    if got is None:
        return {"state": "", "words": _digest_words(r.get("digest_state")), "has_text": bool(_text(r.get("text_file"))),
                "chars": _num(r.get("digest_text_chars")), "error": "", "attempts": 0, "next_try_at": "",
                "read_at": ""}
    state = got["state"]
    return {"state": state, "words": {"read": "OCR read", "failed": "OCR failed"}.get(state, "OCR pending"),
            "has_text": state == "read", "chars": got["chars"] if state == "read" else 0, "error": got["error"],
            "attempts": got["attempts"], "next_try_at": got["next_try_at"] if state != "read" else "",
            "read_at": got["read_at"] if state == "read" else ""}


def _papers_tab(c: dict, rows_all: list[dict], stored: dict[str, dict] | None = None,
                sweep: dict[str, str] | None = None) -> dict[str, Any]:
    as_of = indexed = ""
    for r in rows_all or []:
        at = _iso_day(r.get("createdAt"))
        if at > indexed:
            indexed = at
        if _text(r.get("doc_kind")).lower() != "mar":
            continue
        d = _iso_day(r.get("file_date"))
        if d > as_of:
            as_of = d
    mine = _papers_of(c, rows_all)
    latest = ""
    for r in mine:
        d = _iso_day(r.get("file_date"))
        if d[:7] > latest:
            latest = d[:7]
    rows = []
    for i, r in enumerate(mine):
        day = _iso_day(r.get("file_date"))
        month = day[:7]
        size = _num(r.get("size_bytes"))
        kind = _text(r.get("kind")).upper()
        folder = _text(r.get("folder"))
        ocr = _ocr_of(r, stored)
        rows.append({
            "id": _text(r.get("id")) or f"paper_{i}", "record": _text(r.get("title")) or "MARS paper", "date": day,
            "time": "", "order": i,
            "details": " · ".join(x for x in (_month_words(month), kind, _size(size),
                                               "Folder: " + folder if folder else "", ocr["words"]) if x),
            "status": "Undated" if not day else ("Latest" if month == latest else "Earlier"),
            "file_id": _text(r.get("drive_id")), "title": _text(r.get("title")), "month": month, "kind": kind,
            "mime": _text(r.get("mime_type")), "size_bytes": size, "folder": folder,
            "modified_time": _text(r.get("modified_time")), "indexed_at": _iso_day(r.get("createdAt")),
            "digest_state": _text(r.get("digest_state")), "has_text": ocr["has_text"], "text_chars": ocr["chars"],
            "ocr_state": ocr["state"], "ocr_error": ocr["error"], "ocr_attempts": ocr["attempts"],
            "ocr_next_try_at": ocr["next_try_at"], "ocr_read_at": ocr["read_at"], "found": bool(r.get("_found"))})
    rows.sort(key=_NEWEST)
    months: dict[str, bool] = {}
    k: dict[str, Any] = {"papers": len(rows), "months": 0, "latest": "", "with_text": 0, "undated": 0,
                         "ocr_read": 0, "ocr_failed": 0, "ocr_pending": 0}
    for r in rows:
        if r["month"]:
            months[r["month"]] = True
        if r["date"] > k["latest"]:
            k["latest"] = r["date"]
        if r["has_text"]:
            k["with_text"] += 1
        if not r["date"]:
            k["undated"] += 1
        if r["ocr_state"]:
            k["ocr_" + ("read" if r["ocr_state"] == "read" else "failed" if r["ocr_state"] == "failed"
                        else "pending")] += 1
        r.pop("order", None)
    k["months"] = len(months)
    return {"rows": rows, "kpis": k, "statuses": _statuses(rows, CSM_PAPER_STATUSES), "as_of": as_of,
            "indexed_at": indexed, "swept_at": (sweep or {}).get("at", ""), "why": ""}


# ---- Administration: the eMAR pass log -------------------------------------------------------------------------------

def _source_row(v: Any, i: int) -> int:
    m = re.search(r"(\d+)\s*\Z", _text(v), re.A)
    return int(m[1]) if m else 10 ** 9 + i


def _swappable(out: dict, y: int, mo: int, d: int) -> dict:
    out["day"] = _valid_day(y, mo, d)
    swap = _valid_day(y, d, mo)
    out["other"] = swap if out["day"] and swap and swap != out["day"] else ""
    return out


def _pass_date(v: Any) -> dict[str, str]:
    """csmPassDate_: one pass date as the tab holds it — {day, other, time}."""
    out = {"day": "", "other": "", "time": ""}
    t = v.at if isinstance(v, SheetDate) else _instant(_text(v))
    if t is not None:
        ny = t.astimezone(NY)
        out["time"] = f"{ny.hour:02d}:{ny.minute:02d}"
        if ny.year < 1900:
            return out
        return _swappable(out, ny.year, ny.month, ny.day)
    s = _text(v)
    m = _RE_PD_ISO.match(s)
    if m:
        if m[4] is None or m[6]:
            out["day"] = _valid_day(int(m[1]), int(m[2]), int(m[3]))
            if m[4] is not None:
                out["time"] = _clock(m[4], m[5], "")
            return out
        out["time"] = _clock(m[4], m[5], "")
        return _swappable(out, int(m[1]), int(m[2]), int(m[3]))
    m = _RE_PD_US.match(s)
    if m:
        ap = m[6] or ""
        if m[4] is not None:
            out["time"] = _clock(m[4], m[5], ap)
        dm = _valid_day(int(m[3]), int(m[2]), int(m[1]))
        md = _valid_day(int(m[3]), int(m[1]), int(m[2]))
        # AM/PM is the month-first locale; a 24-hour clock is day-first
        first, second = (md, dm) if ap else (dm, md)
        out["day"] = first or second
        out["other"] = second if first and second and first != second else ""
        return out
    m = _RE_PD_CLOCK.match(s)
    if m:
        out["time"] = _clock(m[1], m[2], m[3] or "")
    return out


def _pass_log(rows: list[dict]) -> list[dict]:
    """csmPassLog_: the whole log with each pass's day settled against its neighbours in source order."""
    log = []
    for i, r in enumerate(rows or []):
        d, frm = _pass_date(r.get("date")), ""
        if not d["day"]:
            for col, words in CSM_PASS_TIME_COLUMNS:
                alt = _pass_date(r.get(col))
                if alt["day"]:
                    d, frm = alt, words
                    break
        log.append({"r": r, "order": _source_row(r.get("source_row"), i), "day": d["day"], "other": d["other"],
                    "time": d["time"], "from": frm, "fixed": False, "unsure": False})
    seq = sorted(log, key=lambda p: p["order"])
    prev: list[str] = []
    nxt = [""] * len(seq)
    last = ahead = ""
    for p in seq:
        prev.append(last)
        if p["day"] and not p["other"]:
            last = p["day"]
    for j in range(len(seq) - 1, -1, -1):
        nxt[j] = ahead
        if seq[j]["day"] and not seq[j]["other"]:
            ahead = seq[j]["day"]
    for k, p in enumerate(seq):
        if not p["other"]:
            continue

        def fits(d: str, k: int = k) -> bool:
            return (not prev[k] or d >= prev[k]) and (not nxt[k] or d <= nxt[k])

        as_written, swapped = fits(p["day"]), fits(p["other"])
        if swapped and not as_written:
            p["day"], p["fixed"] = p["other"], True
        elif not as_written or swapped:
            p["unsure"] = True
    return log


def _stamp(v: Any, p: dict) -> dict | None:
    """csmStamp_: a pass-time cell that holds a whole date-time."""
    s = _pass_date(v)
    if not s["day"]:
        return None
    day = p["day"] if p["day"] and (s["day"] == p["day"] or s["other"] == p["day"]) else ("" if s["other"] else s["day"])
    words = (_day_words(day) + (" · " + _clock_words(s["time"]) if s["time"] else "") if day
             else '"' + _text(v) + '" as written — it reads two ways')
    return {"day": day, "time": s["time"], "agrees": bool(p["day"]) and day == p["day"], "words": words}


def _stamp_words(stamp: dict | None, time: str) -> str:
    return stamp["words"] if stamp and not (stamp["agrees"] and (not stamp["time"] or stamp["time"] == time)) else ""


def _pass_row(p: dict) -> dict[str, Any]:
    r = p["r"]
    raw = _text(r.get("status"))
    word = CSM_PASS_WORDS.get(raw.lower()) or raw or "No status"
    signed = _text(r.get("administeredBy"))
    by = CSM_SHARED_SIGNER_WORDS if signed.lower() == CSM_SHARED_SIGNER else signed
    withheld = _text(r.get("src_withheld_type"))
    reason = "" if word == "Recorded" else withheld
    prn = bool(re.fullmatch(r"prn", _text(r.get("src_prn")), re.I))
    prn_reason = _text(r.get("src_prn_reason"))
    stamp, prn_stamp = _stamp(r.get("schedule"), p), _stamp(r.get("src_prn_pass_time"), p)
    time = p["time"] or (stamp["time"] if stamp and stamp["agrees"] else "")
    # "Due" is only a clock the pass was scheduled for; a whole date-time there is when the pass happened
    schedule = "" if stamp else _text(r.get("schedule"))
    pass_time = _stamp_words(stamp, time)
    prn_time = _stamp_words(prn_stamp, time) if prn_stamp else _text(r.get("src_prn_pass_time"))
    dose = " ".join(x for x in (_text(r.get("src_dosage")), _text(r.get("src_medtype"))) if x)
    return {
        "id": _text(r.get("id")) or f"pass_{p['order']}", "record": _text(r.get("medication")) or "Medication not named",
        "date": p["day"], "time": time, "order": p["order"],
        "details": " · ".join(x for x in ("Due " + schedule if schedule else "",
                                           "Pass time " + pass_time if pass_time else "", dose,
                                           "PRN" + (": " + prn_reason if prn_reason else "") if prn else "",
                                           "Reason: " + reason if reason else "", "By " + by if by else "") if x),
        "status": word, "reason": reason, "schedule": schedule, "pass_time": pass_time,
        "schedule_as_written": _text(r.get("schedule")), "dose": _text(r.get("src_dosage")),
        "form": _text(r.get("src_medtype")), "prn": prn, "prn_reason": prn_reason, "prn_time": prn_time,
        "prn_time_as_written": _text(r.get("src_prn_pass_time")), "given_by": by, "signed_as": signed,
        "withheld": withheld, "comment": _text(r.get("src_comment")), "instructions": _text(r.get("src_instructions")),
        "blood_pressure": _text(r.get("src_bloodpressure")), "blood_sugar": _text(r.get("src_bloodsugar")),
        "quantity_remaining": _text(r.get("src_qntyremaining")), "source_status": raw,
        "date_as_written": _text(r.get("date")), "date_from": p["from"], "date_fixed": p["fixed"],
        "date_unsure": p["unsure"], "source_row": _text(r.get("source_row"))}


def _passes_tab(c: dict, rows_all: list[dict]) -> dict[str, Any]:
    as_of = ""
    rows = []
    for p in _pass_log(rows_all):
        if p["day"] > as_of:
            as_of = p["day"]
        if name_key(_text(p["r"].get("client"))) in c["names"]:
            rows.append(_pass_row(p))
    rows.sort(key=_NEWEST)
    k: dict[str, Any] = {"passes": len(rows), "recorded": 0, "not_given": 0, "discontinued": 0, "breakdown": 0,
                         "prn": 0, "dates_fixed": 0, "days_from_pass_time": 0, "no_day": 0, "first": "", "last": ""}
    slot = {"Recorded": "recorded", "Not given": "not_given", "Discontinued": "discontinued", "Breakdown": "breakdown"}
    for r in rows:
        if r["status"] in slot:
            k[slot[r["status"]]] += 1
        if r["prn"]:
            k["prn"] += 1
        if r["date_fixed"]:
            k["dates_fixed"] += 1
        if r["date_from"]:
            k["days_from_pass_time"] += 1
        if not r["date"]:
            k["no_day"] += 1
        else:
            if not k["first"] or r["date"] < k["first"]:
                k["first"] = r["date"]
            if r["date"] > k["last"]:
                k["last"] = r["date"]
        r.pop("order", None)
    return {"rows": rows, "kpis": k, "statuses": _statuses(rows, CSM_PASS_STATUSES), "as_of": as_of, "why": ""}


# ---- Administration: the MAR errors audit ------------------------------------------------------------------------------

def _error_day(v: Any, year: Any) -> str:
    """csmErrorDay_: m/d/yyyy, m/d/yy, or m/d with the row's year; the first day of a range."""
    iso = _iso_day(v)
    if iso:
        return iso
    m = _RE_ERR_DAY.match(_text(v))
    if not m:
        return ""
    yr = _text(year)
    if m[3]:
        y = 2000 + int(m[3]) if len(m[3]) == 2 else int(m[3])
    else:
        y = int(yr) if re.fullmatch(r"\d{4}", yr, re.A) else 0
    return _valid_day(y, int(m[1]), int(m[2])) if y else ""


def _fold(v: Any) -> str:
    return gsjs.trim(re.sub(r"[^a-z]+", " ", _RE_PARENS.sub(" ", gsjs.or_blank(v).lower())))


def _initials_only(v: Any) -> str:
    """csmInitialsOnly_: the letters of a value that is only initials; '' for a name or anything else."""
    s = _text(v)
    letters = re.sub(r"[^A-Za-z]", "", s)
    if (not re.fullmatch(r"[A-Za-z]{2,3}", letters) or re.search(r"[^A-Za-z.\s]", s)
            or re.search(r"[A-Za-z]{2,}\s", s)):
        return ""
    return letters.upper() if letters in (letters.upper(), letters.lower()) else ""


def _name_initials(name: Any) -> list[str]:
    """csmNameInitials_: first and last word, and every word when there are more than two."""
    if _initials_only(name):
        return []
    words = [w for w in re.split(r"\s+", re.sub(r"[^A-Za-z ]+", "", _RE_PARENS.sub(" ", gsjs.or_text(name)))) if w]
    if len(words) < 2:
        return []
    fl = (words[0][0] + words[-1][0]).upper()
    every = "".join(w[0] for w in words).upper()
    return [fl] if every == fl else [fl, every]


def _filed_initials(c: dict, r: dict) -> str:
    key, name = _text(r.get("client_key")), _text(r.get("client_name"))
    if key and key in c["roster"]:
        return ""
    said = [x for x in (key, name) if x]
    if not said and _text(r.get("initials")):
        said = [_text(r.get("initials"))]
    letters = [_initials_only(x) for x in said]
    if not letters or any(not l or l != letters[0] for l in letters):
        return ""
    return letters[0]


def _initials_of(c: dict, errors: list[dict], files: list[dict] | None) -> dict[str, Any]:
    """csmInitialsOf_: the client's initials, and whether each names the client alone."""
    own = _name_initials(c["name"])
    claims: dict[str, dict[str, bool]] = {}

    def claim(letters: str, who: str) -> None:
        claims.setdefault(letters, {})[who] = True

    for p in c["people"]:
        for l in _name_initials(p["name"]):
            claim(l, "key:" + p["key"])

    # a name that is a roster client's (by its fold, or first and last word) is already claimed by that client's key
    def loose(r: dict) -> None:
        key = _text(r.get("client_key"))
        if key and key in c["roster"]:
            return
        plain = _RE_PARENS.sub(" ", _text(r.get("client_name")))
        fold = name_key(plain)
        if (not fold or fold in c["names"] or fold in c["folds"] or name_key(r.get("client_name")) in c["names"]
                or "fl:" + _fl_key(plain) in c["folds"]):
            return
        for l in _name_initials(plain):
            claim(l, "name:" + fold)

    for r in errors or []:
        loose(r)
    for r in files or []:
        loose(r)
    sole = {}
    for l in own:
        who = list(claims.get(l) or {})
        sole[l] = files is not None and len(who) == 1 and who[0] == "key:" + c["key"]
    return {"own": own, "sole": sole,
            "why": "the MARS papers index could not be read, so nobody else can be ruled out" if files is None
            else "another client, or a person the records name in full, has the same initials"}


def _error_row(r: dict, day: str, i: int, by: str, filed: str) -> dict[str, Any]:
    flags = [f for f in (gsjs.trim(x) for x in _text(r.get("flags")).split(",")) if f]
    kinds = [kind[1] for kind in CSM_ERROR_KINDS if any(kind[0] in _fold(f) for f in flags)]
    marks = [f for f in flags if _fold(f) in CSM_ERROR_MARKS]
    problem, time, notes, staff = (_text(r.get(f)) for f in ("problem", "time", "notes", "staff"))
    return {
        "id": _text(r.get("id")) or f"error_{i}", "record": _text(r.get("medication")) or "Medication not named",
        "date": day, "time": "", "order": i,
        "details": " · ".join(x for x in ("Filed as " + filed if by == "initials" else "",
                                           "Problem: " + problem if problem else "", "Time: " + time if time else "",
                                           notes, "Staff: " + staff if staff else "") if x),
        "status": kinds[0] if kinds else ("Marked" if marks else "Not flagged"),
        "flags": flags, "kinds": kinds, "marks": marks, "problem": problem, "pass_time": time, "notes": notes,
        "staff": staff, "passer": _text(r.get("passer")), "reading": _text(r.get("reading")),
        "end_date": _error_day(r.get("end_date"), r.get("year")), "date_as_written": _text(r.get("error_date")),
        "matched_by": by, "filed_as": filed if by == "initials" else "",
        "source": " › ".join(x for x in (_text(r.get("source_book")), _text(r.get("source_tab"))) if x)}


def _errors_tab(c: dict, rows_all: list[dict], files: list[dict] | None) -> dict[str, Any]:
    """csmErrorsTab_: by key, by a folded name when the key is no roster key, and by initials only when sole."""
    as_of = ""
    rows = []
    initials = _initials_of(c, rows_all, files)
    by_initials = held = 0
    for i, r in enumerate(rows_all or []):
        day = _error_day(r.get("error_date"), r.get("year"))
        if day > as_of:
            as_of = day
        if _owns(c, r.get("client_key"), r.get("client_name")):
            rows.append(_error_row(r, day, i, "key" if _text(r.get("client_key")) == c["key"] else "name", ""))
            continue
        filed = _filed_initials(c, r)
        if not filed or filed not in initials["sole"]:
            continue
        if not initials["sole"][filed]:
            held += 1
            continue
        by_initials += 1
        rows.append(_error_row(r, day, i, "initials", filed))
    rows.sort(key=_NEWEST)
    k: dict[str, Any] = {"errors": len(rows), "missed": 0, "wrong_day": 0, "unavailable": 0, "no_staff": 0,
                         "controlled": 0, "undated": 0, "first": "", "latest": "", "by_initials": by_initials,
                         "initials_held": held}
    for r in rows:
        for kind in r["kinds"]:
            k[CSM_ERROR_SLOT[kind]] += 1
        if not r["date"]:
            k["undated"] += 1
        else:
            if not k["first"] or r["date"] < k["first"]:
                k["first"] = r["date"]
            if r["date"] > k["latest"]:
                k["latest"] = r["date"]
        r.pop("order", None)
    return {"rows": rows, "kpis": k, "statuses": _statuses(rows, CSM_ERROR_STATUSES), "as_of": as_of, "why": "",
            "initials": " / ".join(initials["own"]), "initials_why": initials["why"] if held else ""}


# ---- Administration: the answer ------------------------------------------------------------------------------------------

def _passes(reads: Any) -> list[dict]:
    """The medication passes from their owner: MAR's rows in Postgres once the app is given to Python (app/mar.py),
    else the mar_entries sheet's copy."""
    import resource_rows as RR  # noqa: PLC0415 - read only when a client's MAR is built
    if not RR.uploaded(reads.db, "marEntries"):
        return _rows(reads, MAR_ENTRIES_TAB)

    def read() -> list[dict]:
        # the same reading as the sheet's copy (_rows): a date-looking text stays text
        cols = RR.columns(reads, "marEntries")
        out = []
        for _k, cells in RR.table_rows(reads, "marEntries"):
            vals = [_as_text_cell(cells.get(h)) for h in cols]
            if all(v == "" or v is None for v in vals):
                continue
            out.append({h: hubdb.cell_text(v) for h, v in zip(cols, vals) if h != ""})
        return out
    return reads.once("client_meds:marEntries", read)


def _mar_build(reads: Any, c: dict) -> dict[str, Any]:
    files = _client_files_all(reads)
    papers = _papers_tab(c, files + _found_papers(reads, files), _stored(reads), _sweep(reads))
    tabs = {"papers": papers, "passes": _passes_tab(c, _passes(reads)),
            "errors": _errors_tab(c, _rows(reads, MAR_ERRORS_TAB), files)}
    return {"client": {"client_key": c["key"], "name": c["name"]}, "tabs": tabs,
            "degraded": any(bool(tabs[t]["why"]) for t in CSM_TABS)}


def mar_own(data: dict | None) -> dict[str, Any]:
    """csmOwn_: a client's or a family's cut — their papers and passes, never the office's errors audit."""
    out = dict(data or {})
    tabs = {t: v for t, v in ((data or {}).get("tabs") or {}).items() if t != "errors"}
    out["tabs"] = tabs
    out["degraded"] = any(bool(v and v.get("why")) for v in tabs.values())
    return out


def mar_door(reads: Any, payload: dict | None) -> dict[str, Any]:
    """csmDoor_: past the gate — the door's answer, and the pack's part."""
    c = _mar_client(reads, (payload or {}).get("client"))
    if c.get("refused"):
        return c["refused"]
    return {"status": 200, "data": _mar_build(reads, c)}


def _mar_gate(sess: Any, client: Any) -> dict | None:
    """csmGate_ (FAIL-CLOSED): the master in its own session, else the Clients reader for this client."""
    if sc.is_real_master(sess.user):
        return {"kind": "master", "keys": None}
    import clients as C  # noqa: PLC0415 - the Clients module imports this one
    return C.reader_for(sess, client) or None


def client_source_mar(sess: Any, payload: dict) -> dict[str, Any]:
    """clientSourceMar: the MARS papers, the eMAR passes and the MAR errors audit of one client."""
    reader = _mar_gate(sess, payload.get("client"))
    if not reader:
        return _unknown()
    got = mar_door(sess.reads, payload)
    if got.get("status") == 200 and _own_only(reader):
        return {"status": 200, "data": mar_own(got["data"])}
    return got


def _file_whole(reads: Any, slim: dict) -> dict | None:
    """clientFileWhole_: the paper's row whole, its OCR and digest columns too, at its sheet row or found by its id."""
    heads, rows = _files_house(reads)
    if not rows:
        return None

    def val(raw: dict, h: str) -> Any:
        return hubdb.cell_text(_as_text_cell(raw.get(h)))

    def cell(raw: dict, h: str) -> str:
        return gsjs.js_str(val(raw, h))

    has_id, has_file = "id" in heads, "drive_id" in heads
    want_id = "" if slim.get("id") is None else gsjs.js_str(slim.get("id"))
    want_file = "" if slim.get("drive_id") is None else gsjs.js_str(slim.get("drive_id"))

    def same(raw: dict) -> bool:
        return (not has_id or cell(raw, "id") == want_id) and (not has_file or cell(raw, "drive_id") == want_file)

    at = int(slim.get("_row") or 0)
    line = next((raw for rn, raw in rows if rn == at), None) if 2 <= at <= max(rn for rn, _r in rows) else None
    if line is not None and not same(line):
        line = None
    if line is None:
        col = "id" if has_id and want_id else ("drive_id" if has_file else "")
        if not col:
            return None
        want = want_id if col == "id" else want_file
        line = next((raw for _rn, raw in rows if cell(raw, col) == want and same(raw)), None)
    if line is None:
        return None
    return {h: val(line, h) for h in heads if h != ""}


def _paper_text(reads: Any, file_id: str, title: str, text_file: str) -> dict[str, Any]:
    """csmPaperText_: the archived OCR text in the drive, for a paper the MARS lane has not read yet; never Apps Script."""
    if not L.is_file_id(text_file):
        return {"status": 404, "message": "No OCR text is on file for this paper."}
    try:
        raw = reads.need_drive().media(text_file, CSM_TEXT_CAP)
    except dr.Gone:
        return {"status": 404, "message": "The OCR text is no longer in the drive."}
    except Exception as e:  # noqa: BLE001 - the type only; the lane reads it into the store meanwhile
        return {"status": 503, "message": f"The OCR text could not be read from the drive just now "
                                          f"({type(e).__name__}); it is being kept on the platform."}
    if len(raw) > CSM_TEXT_CAP:
        return {"status": 413, "message": "The OCR text is larger than the platform opens."}
    s, chars = _cut(raw.decode("utf-8", "replace"))
    return {"status": 200, "data": {"id": file_id, "name": title, "text": s, "chars": chars,
                                    "truncated": chars > CSM_TEXT_MAX}}


def _cut(s: str) -> tuple[str, int]:
    """csmPaperText_'s cut: at CSM_TEXT_MAX UTF-16 units, never between the two halves of one character."""
    units = s.encode("utf-16-le", "surrogatepass")
    chars = len(units) // 2
    if chars <= CSM_TEXT_MAX:
        return s, chars
    cut = units[:2 * CSM_TEXT_MAX]
    if 0xD800 <= int.from_bytes(cut[-2:], "little") <= 0xDBFF:
        cut = cut[:-2]
    return cut.decode("utf-16-le"), chars


def _stored_text(reads: Any, file_id: str, title: str, archived: bool) -> dict[str, Any] | None:
    """The text the MARS lane kept; None leaves an archived paper the store has not read yet to the drive's copy."""
    try:
        got = reads.db.query(MAR_TEXT_SQL, (file_id,))
    except hubdb.Unreadable:
        got = []
    if not got:
        return None
    state, text, chars, error, attempts, nxt, at = got[0]
    if state == "read" and text:
        s, n = _cut(text)
        return {"status": 200, "data": {"id": file_id, "name": title, "text": s, "chars": n,
                                        "truncated": n > CSM_TEXT_MAX, "read_at": _iso_at(at), "kept": True}}
    if archived:
        return None
    if state == "failed":
        return {"status": 404, "message": f"The OCR reading of this paper failed ({error or 'no reason given'}); "
                                          f"it is tried again by itself{' at ' + _iso_at(nxt) if nxt else ''}."}
    return {"status": 404, "message": "This paper is being read; its OCR text shows here once it is."}


def client_source_mar_doc_file(sess: Any, payload: dict) -> dict[str, Any]:
    """clientSourceMarDocFile: one MARS paper as bytes with its OCR digest; part 'text' answers the OCR text."""
    if not _mar_gate(sess, payload.get("client")):
        return _unknown()
    reads = sess.reads
    c = _mar_client(reads, payload.get("client"))
    if c.get("refused"):
        return c["refused"]
    file_id = gsjs.trim(gsjs.or_text(payload.get("file_id")))[:120]
    if not L.is_file_id(file_id):
        return {"status": 400, "message": "file_id: a Drive file id."}
    said = payload.get("part")
    part = gsjs.trim("file" if gsjs.falsy(said) else gsjs.js_str(said)).lower()
    if part not in ("file", "text"):
        return {"status": 400, "message": "part: file or text."}
    def listed() -> list[dict]:
        files = _client_files_all(reads)
        return _papers_of(c, files + _found_papers(reads, files))

    papers, why = L._soft(listed)
    if papers is None:
        return {"status": 503, "message": f"The MARS papers index could not be read just now ({why})."}
    paper = next((r for r in papers if _text(r.get("drive_id")) == file_id), None)
    if paper is None:
        return {"status": 404, "message": "This client names no such MARS paper."}
    title = _text(paper.get("title"))
    if part == "text":
        kept = _stored_text(reads, file_id, title, bool(_text(paper.get("text_file"))))
        return kept if kept is not None else _paper_text(reads, file_id, title, _text(paper.get("text_file")))
    if paper.get("_found"):
        # the lane's own find: no client_files row, so its digest is the head of the text it read
        got = (_stored(reads) or {}).get(file_id) or {}
        whole = {"digest_text": "", "digest_state": "done" if got.get("state") == "read" else "",
                 "digest_text_chars": got.get("chars") or "", "text_file": ""}
    else:
        whole, why_w = L._soft(lambda: _file_whole(reads, paper))
        if why_w:
            return {"status": 503, "message": f"The paper's OCR digest could not be read just now ({why_w})."}
        if whole is None:
            return {"status": 404, "message": "This client names no such MARS paper."}
    digest_text = whole.get("digest_text")
    if isinstance(digest_text, str) and _RE_WITHHELD.fullmatch(digest_text):
        # the copy withholds it: the panel reads the kept text instead
        digest_text = ""
    got = L.doc_file(reads, file_id)
    if got.get("refused"):
        return got["refused"]
    return {"status": 200, "data": {
        "id": file_id, "name": got["name"] or title, "mime": got["mime"], "size": got["size"],
        "exported": got["exported"], "b64": got["b64"],
        "digest": {"text": "" if digest_text is None else gsjs.js_str(digest_text),
                   "state": _text(whole.get("digest_state")), "chars": _num(whole.get("digest_text_chars")),
                   "has_text": bool(_text(whole.get("text_file")))}}}


# ---- Refills: the helpers ------------------------------------------------------------------------------------------------

def _csr_iso(y: int, mo: int, d: int) -> str:
    if not (1900 <= y <= 2200 and 1 <= mo <= 12 and 1 <= d <= 31):
        return ""
    try:
        date(y, mo, d)
    except ValueError:
        return ""
    return f"{y:04d}-{mo:02d}-{d:02d}"


def _day(v: Any) -> str:
    """csrDay_: "9/30/2025", "Thursday, December 12, 2024" or ISO → YYYY-MM-DD; '' otherwise."""
    if isinstance(v, SheetDate):
        return _ny_day(v.at)
    s = gsjs.text(v)
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})", s, re.A)
    if m:
        return _csr_iso(int(m[1]), int(m[2]), int(m[3]))
    m = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{2}|\d{4})\b", s, re.A)
    if m:
        return _csr_iso(2000 + int(m[3]) if len(m[3]) == 2 else int(m[3]), int(m[1]), int(m[2]))
    m = re.search(r"\b([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})\b", s, re.A)
    month = CSR_MONTHS.get(m[1][:3].lower()) if m else None
    return _csr_iso(int(m[3]), month, int(m[2])) if month else ""


def _day_label(iso: Any) -> str:
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})\Z", gsjs.or_text(iso), re.A)
    if not m:
        return ""
    return f"{_labelled(CSR_MONTH_LABELS, int(m[2]) - 1) or 'undefined'} {int(m[3])}, {m[1]}"


def _at(v: Any) -> str:
    """csrAt_: a form timestamp → "2025-09-22T09:51:14", the book's own wall clock; '' otherwise."""
    if isinstance(v, SheetDate):
        ny = v.at.astimezone(NY)
        return f"{_ny_day(v.at)}T{ny.hour:02d}:{ny.minute:02d}:00"
    s = gsjs.text(v)
    day = _day(s)
    if not day:
        return ""
    at = re.search(r"[ T]\d{1,2}:\d{2}", s, re.A)
    t = re.match(r"^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?", s[at.start() + 1:], re.A) if at else None
    if not t:
        return day
    h = int(t[1])
    if t[4]:
        h = h % 12 + (12 if re.search("p", t[4], re.I) else 0)
    return f"{day}T{h:02d}:{t[2]}:{t[3] or '00'}"


def _csr_num(v: Any) -> str:
    s = gsjs.text(v).replace(",", "")
    return s if re.fullmatch(r"-?\d+(\.\d+)?", s, re.A) else ""


def _shown(v: Any) -> str:
    """getDisplayValues() of a cell the copy kept as its shown text."""
    if v is None:
        return ""
    if isinstance(v, bool):
        return "TRUE" if v else "FALSE"
    t = hubdb.typed(v, "raw")
    return t if isinstance(t, str) else gsjs.or_blank(t)


def _book(reads: Any) -> dict[str, Any]:
    """csrBook_: the form book; a book the copy does not hold is Apps Script's to open."""
    sid = reads.db.prop(CSR_BOOK_PROP) or CSR_BOOK_FALLBACK
    if reads.db.book(sid) is None:
        raise hubdb.Unreadable("asa-hub-db holds no copy of the Missing Medications book")
    reads.db.note_book(sid)
    return {"book": sid, "why": ""}


def _grid(reads: Any, book: str | None, tab: str) -> dict[str, Any]:
    """csrGrid_: one tab as display text keyed by its own header."""
    if not book:
        return {"head": [], "rows": None, "why": "the book is not open"}

    def read() -> dict[str, Any]:
        ref = HT.book_tab(reads, book, tab)
        if ref is None:
            # the copy holds no tab with no rows, so a missing tab and an empty one look the same here
            raise Defer(f"the copy of the Missing Medications book holds no rows of {tab}")
        reads.db.note_book(book)
        src = list(ref.headers)
        got = reads.db.rows(ref)
        # an owned tab's repeated title: its columns in the sheet's order, each read under the title as written; a
        # row stored without its twins (read straight from Google) holds only the last column
        twins = [h for h in src if hubdb.TWIN_KEY.fullmatch(h)]
        whole = hubdb.in_sheet_order(src) and all(t in raw for _rn, raw in got for t in twins)
        head = [gsjs.text(hubdb.twin_base(h) if whole else h) for h in src]
        rows = []
        for rn, raw in got:
            o: dict[str, Any] = {"_row": rn}
            empty = True
            for h, s in zip(head, src):
                if not h:
                    continue
                v = gsjs.text(_shown(raw.get(s)), 2000)
                if v:
                    empty = False
                if not o.get(h):
                    o[h] = v
            if not empty:
                rows.append(o)
        return {"head": head, "rows": rows, "why": "", "whole": whole}
    return reads.once(f"client_meds:grid:{book}:{tab}", read)


def _head(head: list[str], rx: re.Pattern) -> str:
    return next((h for h in head if h and rx.search(h)), "")


def _cell(row: dict, head: list[str], rx: re.Pattern) -> str:
    h = _head(head, rx)
    return gsjs.text(row.get(h)) if h else ""


def _refills_names(reads: Any, key: str, rows: list[dict]) -> dict[str, Any]:
    """csrNames_: every folded name the client is written under, and whether another client shares one."""
    names = _identity_names(reads, key)
    for r in rows:
        if gsjs.str_(r.get("client_key")) == key:
            own = name_key(r.get("name"))
            if own:
                names[own] = True
    shared = any(gsjs.str_(r.get("client_key")) != key and name_key(r.get("name")) in names for r in rows)
    return {"names": names, "shared": shared}


def _tab(rows: list | None = None, kpis: dict | None = None, why: str = "", as_of: str = "",
         note: str = "") -> dict[str, Any]:
    return {"rows": rows or [], "kpis": kpis or {}, "why": why or "", "as_of": as_of or "", "note": note or ""}


def _newest(values: list[str]) -> str:
    best = ""
    for v in values:
        if v and v > best:
            best = v
    return best


def _report(o: dict) -> dict[str, Any]:
    """csrReport_: a Missing Medications report row, from either form or the Hub's copy."""
    record = o["medications"] or o["note"] or o["issue"] or "Medication not named"
    runs_out = _day_label(o["runs_out"]) or o["runs_out_text"]
    return {
        "id": o["id"], "record": gsjs.text(record, 300), "date": o["reported_at"][:10],
        "details": " · ".join(x for x in (o["issue"], "runs out " + runs_out if runs_out else "") if x),
        "status": o["status"] or "Reported", "source": o["source"], "form": o["form"],
        "reported_at": o["reported_at"], "reporter": o["reporter"], "issue": o["issue"], "medications": o["medications"],
        "runs_out": o["runs_out"], "runs_out_text": o["runs_out_text"], "note": o["note"], "office_note": o["office_note"],
        "house": o.get("house") or "", "dr": o.get("dr") or "", "otc": o.get("otc") or "", "notes": o.get("notes") or ""}


def _form_rows(grid: dict, names: dict, form: str, label: str) -> dict[str, Any]:
    """csrFormRows_: the reports a form tab holds for these names; the live form files medications per client."""
    h = grid["head"]
    client_col = _head(h, _H_CLIENT_FORM)
    if not client_col:
        return {"rows": None, "why": f"the {label} has no client column"}
    med_cols: dict[str, str] = {}
    med_heads: list[tuple[str, str]] = []
    for x in h:
        m = _H_MEDS.match(x)
        if m:
            med_cols[name_key(m[1])] = x
            med_heads.append((x, name_key(m[1])))
    office = [x for x in h if _H_OFFICE.match(x)]
    out = []
    for r in grid["rows"]:
        who = name_key(r.get(client_col))
        if not who or who not in names:
            continue
        # a copy that keys a row by header folds a repeated title: it shows up as an answer under another client's
        # column; an owned tab's copy keeps every column and reads the first answer, as csrGrid_ does
        if not grid.get("whole") and any(fold != who and gsjs.text(r.get(x)) for x, fold in med_heads):
            raise Defer(f"the copy of the {label} files this client's answer under another client's column")
        own = gsjs.text(r.get(med_cols[who])) if who in med_cols else ""
        runs_text = _cell(r, h, _H_RUNS)
        out.append(_report({
            "id": f"{form}-{r['_row']}", "form": form, "source": label,
            "reported_at": _at(_cell(r, h, _H_TIMESTAMP)), "reporter": _cell(r, h, re.compile(r"^your name\Z", re.I)),
            "issue": _cell(r, h, re.compile(r"issue related|^issue description\Z", re.I)),
            "medications": own or _cell(r, h, re.compile(r"^medication\(s\) name\Z", re.I)),
            "runs_out": _day(runs_text), "runs_out_text": runs_text,
            "note": _cell(r, h, re.compile(r"^if you don.?t see", re.I)),
            "office_note": " · ".join(x for x in (gsjs.text(r.get(c)) for c in office) if x),
            "status": _cell(r, h, re.compile(r"^status\Z", re.I)),
            "house": _cell(r, h, re.compile(r"^house\Z", re.I)), "dr": _cell(r, h, re.compile(r"^dr\Z", re.I)),
            "otc": _cell(r, h, re.compile(r"^otc\Z", re.I)), "notes": _cell(r, h, re.compile(r"^notes\Z", re.I))}))
    return {"rows": out, "why": ""}


def _copy_rows(reads: Any, key: str, names: dict) -> dict[str, Any]:
    """csrCopyRows_: the Hub's own copy of the live form, for when the book cannot be opened."""
    out = []
    for r in _rows(reads, CSR_COPY_TAB):
        if gsjs.str_(r.get("client_key")) != key and name_key(r.get("client_name")) not in names:
            continue
        runs_text = gsjs.text(r.get("expected_runout"))
        out.append(_report({
            "id": "copy-" + gsjs.text(r.get("id")), "form": "copy", "source": "Missing Medications (Hub copy)",
            "reported_at": _at(r.get("reported_at")), "reporter": gsjs.text(r.get("reporter")),
            "issue": gsjs.text(r.get("issue")), "medications": gsjs.text(r.get("medications")),
            "runs_out": _day(runs_text), "runs_out_text": runs_text, "note": gsjs.text(r.get("free_text")),
            "office_note": "", "status": gsjs.text(r.get("status"))}))
    return {"rows": out, "why": ""}


def _reports_kpis(rows: list[dict], today: str) -> dict[str, Any]:
    open_rows = [r for r in rows if not CSR_CLOSED.match(r["status"])]
    ahead = sorted(d for d in (r["runs_out"] for r in open_rows) if d and d >= today)
    return {"reports": len(rows), "open": len(open_rows), "next_run_out": ahead[0] if ahead else "",
            "last_reported": _newest([r["date"] for r in rows])}


def _by_newest(a: dict, b: dict) -> int:
    return 1 if a["reported_at"] < b["reported_at"] else (-1 if a["reported_at"] > b["reported_at"] else 0)


# ---- Refills: the tabs ------------------------------------------------------------------------------------------------------

def _reports(reads: Any, opened: dict, key: str, names: dict, today: str) -> dict[str, Any]:
    """csrReports_: the live form and the earlier one; the Hub's copy when the book is shut."""
    newest_first = functools.cmp_to_key(_by_newest)
    if not opened["book"]:
        copy = _copy_rows(reads, key, names)
        if copy["rows"] is None:
            return _tab([], {}, opened["why"] + "; " + copy["why"])
        if not copy["rows"]:
            return _tab([], {}, opened["why"] + "; the Hub's copy of the form holds no report for this client")
        copy["rows"].sort(key=newest_first)
        return _tab(copy["rows"], _reports_kpis(copy["rows"], today),
                    opened["why"] + ". These are the Hub's copy of the form, which stopped at its last report.",
                    _newest([r["date"] for r in copy["rows"]]))
    live = _grid(reads, opened["book"], CSR_LIVE_TAB)
    earlier = _grid(reads, opened["book"], CSR_EARLIER_TAB)
    rows: list[dict] = []
    why: list[str] = []
    live_rows = (_form_rows(live, names, "live", "Missing Medications form") if live["rows"] is not None
                 else {"rows": None, "why": live["why"]})
    if live_rows["rows"] is not None:
        rows += live_rows["rows"]
    else:
        why.append(live_rows["why"])
    earlier_rows = (_form_rows(earlier, names, "earlier", "earlier Missing Medications form")
                    if earlier["rows"] is not None else {"rows": None, "why": earlier["why"]})
    if earlier_rows["rows"] is not None:
        rows += earlier_rows["rows"]
    else:
        why.append(earlier_rows["why"])
    if live_rows["rows"] is None and earlier_rows["rows"] is None:
        return _tab([], {}, "; ".join(why))
    rows.sort(key=newest_first)
    as_of = (_newest([_at(_cell(r, live["head"], _H_TIMESTAMP))[:10] for r in live["rows"]])
             if live["rows"] is not None else "")
    return _tab(rows, _reports_kpis(rows, today), "; ".join(why), as_of)


def _low_refills(reads: Any, opened: dict, names: dict) -> dict[str, Any]:
    """csrLowRefills_: the office's refill worklist, one row per medication running out."""
    if not opened["book"]:
        return _tab([], {}, opened["why"])
    g = _grid(reads, opened["book"], CSR_LOW_TAB)
    if g["rows"] is None:
        return _tab([], {}, g["why"])
    h = g["head"]
    client_col = _head(h, _H_CLIENT)
    if not client_col:
        return _tab([], {}, f"the {CSR_LOW_TAB} tab has no client column")
    rows = []
    for r in g["rows"]:
        if name_key(r.get(client_col)) not in names:
            continue
        med = _cell(r, h, re.compile(r"^med(ication)?\Z", re.I))
        refills = _cell(r, h, re.compile(r"^#\s*of refills\Z", re.I))
        otc = _cell(r, h, re.compile(r"^otc\Z", re.I))
        dr = _cell(r, h, re.compile(r"^dr\Z", re.I))
        contact = _cell(r, h, re.compile(r"^contact dr\Z", re.I))
        rows.append({
            "id": f"low-{r['_row']}", "record": med or "Medication not named", "date": _day(contact),
            "details": " · ".join(x for x in ("Refills: " + refills if refills else "", otc, dr) if x),
            "status": _cell(r, h, re.compile(r"^status\Z", re.I)) or "No status", "source": "Low Refills",
            "refills": refills, "otc": otc, "dr": dr, "dr_phone": _cell(r, h, re.compile(r"^dr\s*#\Z", re.I)),
            "house": _cell(r, h, re.compile(r"^house\Z", re.I)), "manager": _cell(r, h, re.compile(r"^manager\Z", re.I)),
            "contact_dr": contact, "notes": _cell(r, h, re.compile(r"^notes\Z", re.I)),
            "pharmacy_received": _cell(r, h, re.compile(r"received\Z", re.I)),
            "important": bool(re.match(r"y", _cell(r, h, re.compile(r"^important med", re.I)), re.I))})
    open_n = sum(1 for r in rows if not CSR_CLOSED.match(r["status"]))
    return _tab(rows, {"rows": len(rows), "outstanding": open_n})


def _control(reads: Any, opened: dict, names: dict, today: str) -> dict[str, Any]:
    """csrControl_: the house's medication list, with the refill columns it carries."""
    if not opened["book"]:
        return _tab([], {}, opened["why"])
    g = _grid(reads, opened["book"], CSR_CONTROL_TAB)
    if g["rows"] is None:
        return _tab([], {}, g["why"])
    h = g["head"]
    client_col = _head(h, _H_CLIENT)
    if not client_col:
        return _tab([], {}, f"the {CSR_CONTROL_TAB} tab has no client column")
    rows = []
    for r in g["rows"]:
        if name_key(r.get(client_col)) not in names:
            continue
        due = _day(_cell(r, h, re.compile(r"^next refill due\Z", re.I)))
        written = _csr_num(_cell(r, h, re.compile(r"^qty written\Z", re.I)))
        dispensed = _csr_num(_cell(r, h, re.compile(r"^qty dispensed\Z", re.I)))
        remaining = _csr_num(_cell(r, h, re.compile(r"^qty remaining\Z", re.I)))
        physician = _cell(r, h, re.compile(r"^physician name\Z", re.I))
        qty = ", ".join(x for x in ("written " + written if written else "", "dispensed " + dispensed if dispensed else "",
                                    remaining + " remaining" if remaining else "") if x)
        rows.append({
            "id": f"control-{r['_row']}",
            "record": _cell(r, h, re.compile(r"^medication name\Z", re.I)) or "Medication not named", "date": due,
            "details": " · ".join(x for x in (qty, physician) if x),
            "status": ("Due" if due <= today else "Scheduled") if due else "No due date", "source": "Medication Control",
            "physician": physician, "physician_no": _cell(r, h, re.compile(r"^phys\w*\s*no\.?\Z", re.I | re.A)),
            "qty_written": written, "qty_dispensed": dispensed, "qty_remaining": remaining,
            "days_supply": _csr_num(_cell(r, h, re.compile(r"^days supply\Z", re.I))),
            "buffer_days": _csr_num(_cell(r, h, re.compile(r"^buffer days\Z", re.I))),
            "refill_status": _cell(r, h, re.compile(r"^refill status\Z", re.I)), "next_refill_due": due,
            "notes": _cell(r, h, re.compile(r"^notes", re.I))})
    dated = sum(1 for r in rows if r["next_refill_due"])
    supplied = sum(1 for r in rows if r["days_supply"])
    note = ("Medication Control lists these medications but writes no Days Supply or Next Refill Due for this client, "
            "so no refill date is shown.") if rows and not dated and not supplied else ""
    return _tab(rows, {"rows": len(rows), "with_due_date": dated, "due": sum(1 for r in rows if r["status"] == "Due")},
                "", "", note)


def _refills_answer(reads: Any, client: dict, joined: dict) -> dict[str, Any]:
    today = reads.today()
    opened = _book(reads)
    if joined["shared"]:
        shared = "Another client on file carries this name, so rows filed by name cannot be told apart."
        tabs = {"reports": _tab([], {}, shared), "low_refills": _tab([], {}, shared), "control": _tab([], {}, shared)}
    else:
        tabs = {"reports": _reports(reads, opened, client["client_key"], joined["names"], today),
                "low_refills": _low_refills(reads, opened, joined["names"]),
                "control": _control(reads, opened, joined["names"], today)}
    return {"client": client["client_key"], "name": client["name"], "today": today, "tabs": tabs,
            "degraded": any(bool(t["why"]) for t in tabs.values())}


def refills_door(reads: Any, payload: dict | None) -> dict[str, Any]:
    """csrDoor_: past the gate — the door's answer, and the pack's part."""
    key = gsjs.text((payload or {}).get("client"), 120)
    if not key:
        return {"status": 400, "message": "A client is required."}
    derived = reads.clients_derived()
    row = next((d for d in derived if gsjs.str_(d.get("client_key")) == key), None)
    if row is None:
        return {"status": 404, "message": "No such client."}
    client = {"client_key": key, "name": gsjs.text(row.get("name"))}
    return {"status": 200, "data": _refills_answer(reads, client, _refills_names(reads, key, derived))}


def _refills_gate(sess: Any, client: Any) -> bool:
    """clientSourceRefillsGate_ (FAIL-CLOSED): never the service; the master; else a reader who is not the client's own."""
    user = sess.user
    if not user or user.get("is_service"):
        return False
    if sc.is_real_master(user):
        return True
    import clients as C  # noqa: PLC0415 - the Clients module imports this one
    reader = C.reader_for(sess, client)
    return bool(reader) and reader.get("kind") not in ("client", "guardian", "ssa")


def client_source_refills(sess: Any, payload: dict) -> dict[str, Any]:
    """clientSourceRefills: Missing Medications reports (live form, earlier form), Low Refills, Medication Control."""
    if not _refills_gate(sess, payload.get("client")):
        return _unknown()
    return refills_door(sess.reads, payload)


# ---- the relay's pack (cpPackDoors_) -------------------------------------------------------------------------------------

def mar_part(reads: Any, ctx: dict) -> dict[str, Any]:
    return mar_door(reads, {"client": ctx["key"]})


def mar_own_part(reads: Any, ctx: dict, parts: dict | None = None) -> dict[str, Any]:
    """The own cut of the part the pack gathered already, else read here."""
    got = {"status": 200, "data": parts["mar"]} if parts and parts.get("mar") is not None else mar_part(reads, ctx)
    if got.get("status") == 200 and got.get("data") is not None:
        return {"status": 200, "data": mar_own(got["data"])}
    return got


def refills_part(reads: Any, ctx: dict) -> dict[str, Any]:
    return refills_door(reads, {"client": ctx["key"]})


PACK_DOORS: dict[str, Callable[..., dict[str, Any]]] = {"mar": mar_part, "mar_own": mar_own_part,
                                                        "refills": refills_part}

ACTIONS: dict[str, Callable[[Any, dict], dict[str, Any]]] = {
    "clientSourceMar": client_source_mar, "clientSourceRefills": client_source_refills,
    "clientSourceMarDocFile": client_source_mar_doc_file,
}

# HUB_POLICY: the roles each read is declared for, and its typed params
POLICY = {a: {"roles": POLICY_ROLES, "params": {"client": "string"}} for a in ACTIONS}
POLICY["clientSourceMarDocFile"] = {"roles": POLICY_ROLES,
                                    "params": {"client": "string", "file_id": "string", "part": "string"}}
