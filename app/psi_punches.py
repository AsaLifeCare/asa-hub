"""The hours PsiAnywhere recorded (PsiPunches.gs) on Python: the staff-hours house kept as the platform's own resource
(app.resource_rows `psiPunches`), read by psiPunchesList with the caveat every answer carries, and the shapes both
feeds hand over (the staff-hours rows, and the full punch sheet whose house stays a sheet other readers need). A
missing row is evidence of nothing: never use this record to say someone did not work, dock pay or discipline."""
from __future__ import annotations

import re
import threading
from typing import Any, Callable

import gsjs
import hubdb
import locations as L
import resource_rows as RR
import screening as SG
from scope import Defer

s_ = gsjs.str_
TAB, RESOURCE = "psi_punches", "psiPunches"
HEADER = ("id", "createdAt", "updatedAt", "single_entry_id", "status", "employee", "people_id", "date_service",
          "date_iso", "start_time", "end_time", "hours", "work_code", "submitted_user", "supervisor_id",
          "has_signature", "is_documented", "evv_reasons", "source", "source_synced_at", "tenant")
# client data never enters the staff-hours house: dropped on arrival and logged by name
REFUSED = ("address", "latitude", "longitude", "consumers", "num_consumers", "comments", "house", "raw")
INGEST_CAP = 1200
LIST_CAP = 1000
FULL_TAB = "psi_punches_full"
FULL_HEADER = (
    "id", "createdAt", "updatedAt", "single_entry_id", "status", "employee", "firstname", "lastname", "people_id",
    "user_id", "date_service", "date_iso", "start_time", "end_time", "hours", "work_code", "work_code_id",
    "supervisor_id", "submitted_user", "submit_date", "approved_user", "approved_time", "rejected_user",
    "rejected_time", "last_update", "transportation_units", "key_times", "location_name", "house", "latitude",
    "longitude", "consumers_present", "consumers", "consumer_1", "consumer_1_id", "consumer_1_evv_reason_code",
    "consumer_1_has_signature", "consumer_1_has_note", "consumer_1_is_documented", "consumer_2", "consumer_2_id",
    "consumer_2_evv_reason_code", "consumer_2_has_signature", "consumer_2_has_note", "consumer_2_is_documented",
    "consumer_3", "consumer_3_id", "consumer_3_evv_reason_code", "consumer_3_has_signature", "consumer_3_has_note",
    "consumer_3_is_documented", "has_signature", "is_documented", "evv_reasons", "comments", "extra_json", "source",
    "source_synced_at", "live_first_seen", "tenant")
FULL_CAP = 600
FULL_TEXT_CAP = 5000
INGEST_GATE = "gate_psi_punches_ingest"
CAVEAT = ("A row is evidence that a punch was filed. A missing row is evidence of nothing — PsiAnywhere was habitually "
          "not filled in, and this record cannot show that somebody did not work.")
SOURCE_WORDS = "asa_psi_time_entries (the stored copy, to 2026-08-14) + psianywhere_live (the relay's reads)"
_US_DAY = re.compile(r"^(\d{2})/(\d{2})/(\d{4})$")

# PSI_PUNCHES_FEED_AT, _ROWS, _SWITCH and PSI_PUNCHES_FULL_FEED_AT: when each feed last wrote (a convenience; the rows
# are the record)
FEED: dict[str, str] = {"at": "", "rows": "", "switch": "", "full_at": ""}
FEED_LOCK = threading.Lock()


def text(v: Any) -> str:
    """psiPunchesText_: times and hours stay PsiAnywhere's own strings."""
    if v is None:
        return ""
    if isinstance(v, gsjs.SheetDate):
        return hubdb.cell_text(v) or ""
    return re.sub(r"\s+", " ", gsjs.js_str(v)).strip()


def flag(v: Any) -> str:
    """psiPunchesFlag_: one spelling, so a re-feed never looks like a change; absence stays blank."""
    if v is True:
        return "true"
    if v is False:
        return "false"
    s = text(v).lower()
    if s in ("true", "t", "yes", "1"):
        return "true"
    if s in ("false", "f", "no", "0"):
        return "false"
    return ""


def date_iso(service: Any) -> str:
    """psiPunchesDateIso_: derived here, never trusted from the wire."""
    m = _US_DAY.match(text(service))
    if not m:
        return ""
    mo, da = int(m.group(1)), int(m.group(2))
    if mo < 1 or mo > 12 or da < 1 or da > 31:
        return ""
    return m.group(3) + "-" + m.group(1) + "-" + m.group(2)


def cut(v: Any, n: int) -> str:
    return SG.js_slice(text(v), n)


def clean(r: Any, tenant: str) -> dict[str, str] | None:
    """psiPunchesClean_: the staff-hours columns of one punch; a missing clock-out stays blank."""
    row = r if isinstance(r, dict) else {}
    key = text(row.get("single_entry_id") or row.get("id"))
    if not key:
        return None
    service = text(row.get("date_service"))
    return {"id": SG.js_slice(key, 60), "single_entry_id": SG.js_slice(key, 60), "status": cut(row.get("status"), 12),
            "employee": cut(row.get("employee"), 120), "people_id": cut(row.get("people_id"), 40),
            "date_service": SG.js_slice(service, 40), "date_iso": date_iso(service),
            "start_time": cut(row.get("start_time"), 40), "end_time": cut(row.get("end_time"), 40),
            "hours": cut(row.get("hours"), 20), "work_code": cut(row.get("work_code"), 24),
            "submitted_user": cut(row.get("submitted_user"), 120), "supervisor_id": cut(row.get("supervisor_id"), 40),
            "has_signature": flag(row.get("has_signature")), "is_documented": flag(row.get("is_documented")),
            "evv_reasons": cut(row.get("evv_reasons"), 60),
            "source": cut(row.get("source"), 60) or "asa_psi_time_entries",
            "source_synced_at": cut(row.get("source_synced_at"), 40), "tenant": SG.js_slice(text(tenant), 60)}


def full_clean(r: Any, tenant: str) -> dict[str, str] | None:
    """psiPunchesFullClean_: every declared column; the relay folds anything unnamed into extra_json."""
    row = r if isinstance(r, dict) else {}
    key = text(row.get("single_entry_id") or row.get("id"))
    if not key:
        return None
    out = {c: cut(row.get(c), FULL_TEXT_CAP) for c in FULL_HEADER
           if c not in ("id", "createdAt", "updatedAt", "date_iso", "tenant")}
    out.update(id=SG.js_slice(key, 60), single_entry_id=SG.js_slice(key, 60), date_iso=date_iso(out["date_service"]),
               tenant=SG.js_slice(text(tenant), 60))
    return out


def full_dropped(rows: list) -> list[str]:
    """psiPunchesFullDropped_: the undeclared keys of the first five rows — proof a pass landed whole."""
    declared = set(FULL_HEADER)
    seen: set[str] = set()
    names: list[str] = []
    for r in (rows or [])[:5]:
        for k in (r if isinstance(r, dict) else {}):
            if len(names) >= 40:
                break
            if k in declared or k in seen:
                continue
            seen.add(k)
            names.append(str(k)[:60])
    return names


def crossed(rows: list) -> list[str]:
    """psiPunchesCrossed_: the client columns a row carried — names only, the values never copied anywhere."""
    hit: list[str] = []
    for r in rows or []:
        for name in REFUSED:
            if name not in hit and isinstance(r, dict) and name in r:
                hit.append(name)
    return hit


def summary(rows: list[dict]) -> dict[str, Any]:
    """psiPunchesSummary_."""
    people: set[str] = set()
    hours, open_n, undocumented = 0.0, 0, 0
    for r in rows:
        who = text(r.get("people_id")) or text(r.get("employee"))
        if who:
            people.add(who)
        t = text(r.get("hours"))
        try:
            h = float(t) if t else 0.0
        except ValueError:
            h = float("nan")
        if h == h and h not in (float("inf"), float("-inf")):
            hours += h
        if not text(r.get("end_time")):
            open_n += 1
        if text(r.get("is_documented")) != "true":
            undocumented += 1
    return {"rows": len(rows), "people": len(people), "hours": gsjs.js_round(hours * 100) / 100,
            "open_punches": open_n, "undocumented": undocumented}


def held_rows(reads: L.Reads) -> list[dict] | None:
    """psiPunchesRows_: the house's rows — Postgres once uploaded, the sheet's copy before; None when it cannot be
    read."""
    if RR.uploaded(reads.db, RESOURCE):
        cols = RR.columns(reads, RESOURCE)
        return [{c: cells.get(c, "") for c in cols} for _k, cells in RR.table_rows(reads, RESOURCE)
                if any(cells.get(c) not in (None, "") for c in cols)]
    res = reads.db.resolve(TAB)
    if res.runtime:
        raise Defer(f"{TAB} lives in the depot's facts")
    if res.ref is None:
        if not res.book_known:
            return None
        return []
    return [dict(raw) for _rn, raw in reads.db.rows(res.ref) if any(v not in (None, "") for v in raw.values())]


def punches_list(sess: L.Session, payload: dict) -> dict[str, Any]:
    """psiPunchesList: the punches a person, a window and a work code narrow to, newest first, paged; every answer
    carries the caveat, or the numbers read as an attendance report, which they are not."""
    reads = sess.reads
    if not SG.writer(sess.user):
        return dict(SG.DENIED)
    p = payload if isinstance(payload, dict) else {}
    try:
        got = held_rows(reads)
    except (hubdb.Unreadable, Defer):
        raise
    except Exception:  # noqa: BLE001 - as the .gs: the house not fed yet
        got = None
    if got is None:
        return {"status": 200, "data": {"rows": [], "total": 0, "shown": 0, "read_only": True, "frozen": False,
                                        "caveat": CAVEAT, "note": "The punch house has not been fed yet."}}
    person, people_id = text(p.get("person")).lower(), text(p.get("people_id"))
    frm, to, code = text(p.get("from")), text(p.get("to")), text(p.get("work_code")).upper()

    def keep(r: dict) -> bool:
        if person and person not in text(r.get("employee")).lower():
            return False
        if people_id and text(r.get("people_id")) != people_id:
            return False
        if code and text(r.get("work_code")).upper() != code:
            return False
        iso = text(r.get("date_iso"))
        if frm and (not iso or iso < frm):
            return False
        return not (to and (not iso or iso > to))
    kept = [r for r in got if keep(r)]
    summ = summary(kept)
    kept.sort(key=lambda r: text(r.get("employee")))
    kept.sort(key=lambda r: text(r.get("date_iso")), reverse=True)
    off_n = SG._number(p.get("offset"))
    offset = max(0, int(off_n // 1)) if off_n == off_n else 0
    lim_n = SG._number(p.get("limit"))
    limit = int(lim_n // 1) if lim_n == lim_n else 0
    if not limit > 0:
        limit = 200
    limit = min(limit, LIST_CAP)
    cols = ("id", "single_entry_id", "status", "employee", "people_id", "date_service", "date_iso", "start_time",
            "end_time", "hours", "work_code", "submitted_user", "supervisor_id", "has_signature", "is_documented",
            "evv_reasons", "source", "source_synced_at")
    page = [{c: text(r.get(c)) for c in cols} for r in kept[offset:offset + limit]]
    with FEED_LOCK:
        fed = FEED["at"]
    if not fed:
        fed = s_(reads.db.prop("PSI_PUNCHES_FEED_AT"))
    return {"status": 200, "data": {"rows": page, "shown": len(page), "total": len(kept), "held": len(got),
                                    "offset": offset, "limit": limit, "summary": summ, "read_only": True,
                                    "frozen": False, "source": SOURCE_WORDS, "confirmed_at": fed, "caveat": CAVEAT}}


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {"psiPunchesList": punches_list}
POLICY: dict[str, dict[str, Any]] = {"psiPunchesList": {"params": {
    "person": "string", "people_id": "string", "from": "string", "to": "string", "work_code": "string",
    "limit": "number", "offset": "number"}}}
