"""Staff Issues (StaffIssues.gs, server/hr_slices.py) off asa-hub-db: the estate's Employee HR Tracker (ESTATE_HR_ID,
its Master tab) as the staffIssues slice — newest first, the sheet row as id — and staffIssueAdd, one situation
appended to the tracker, kept in app.edits and carried to the book by the two-way sync. The relay lays its digest
(server/hr_digest.py) over the rows this answers."""
from __future__ import annotations

import re
from datetime import datetime
from typing import Any, Callable

import gsjs
import hubdb
import locations as L
import staff_writes as SW
import writes as W
from writes import Decision

APP_ID = "staffissues"
# the tracker's own headers, as the slice names them (hr_slices._FIELDS)
FIELDS = (("Date", "date"), ("Employees Involved", "employees_involved"), ("Situation", "situation"),
          ("Follow up", "follow_up"), ("Disciplinary Action", "disciplinary_action"), ("Result", "result"),
          ("Termination summary", "termination_summary"))
ACTIONS_LIST = ("Monitoring", "1st Warning", "2nd Warning", "Final Warning", "Not at this time", "Terminated", "Quit")
DATE_RE = re.compile(r"^(\d{1,2})/(\d{1,2})/(\d{2}|\d{4})$")
YEAR_PIVOT = 70
DENIED = {"status": 403, "message": "Requires an admin or manager account"}

s_ = gsjs.str_


def _cell(v: Any) -> str:
    """A tracker cell as the sheet shows it: a day as M/D/YYYY, a number without a trailing .0, text trimmed."""
    t = hubdb.typed(v, "raw")
    if isinstance(t, datetime):
        return f"{t.month}/{t.day}/{t.year}"
    if isinstance(t, float) and t.is_integer():
        return str(int(t))
    return s_(t).strip()


def _sort_key(row: dict) -> tuple[int, float, int]:
    """hr_slices._sort_key: newest first; a day the sheet did not fill sorts after every real one, in sheet order."""
    m = DATE_RE.match(s_(row.get("date")).strip())
    if not m:
        return (1, 0.0, row["_row"])
    month, day, year = (int(g) for g in m.groups())
    if len(m.group(3)) == 2:
        year += 2000 if year < YEAR_PIVOT else 1900
    try:
        ts = datetime(year, month, day).timestamp()
    except ValueError:
        return (1, 0.0, row["_row"])
    return (0, -ts, row["_row"])


def rows(reads: L.Reads) -> list[dict]:
    """Every tracker row with anything in it, newest first, `r<sheet row>` its id."""
    _sid, ref, _heads = SW.hr_tracker(reads)
    out = []
    for rn, raw in reads.db.rows(ref):
        row = {field: _cell(raw.get(header)) for header, field in FIELDS}
        if not any(row.values()):
            continue
        row["id"], row["_row"] = f"r{rn}", int(rn)
        out.append(row)
    out.sort(key=_sort_key)
    for r in out:
        del r["_row"]
    return out


def staff_issues_list(sess: L.Session, payload: dict) -> dict[str, Any]:
    """The staffIssues slice, for the relay's own identity (it lays the digest)."""
    if (sess.user or {}).get("is_service") is not True:
        return {"status": 403, "message": "The tracker's slice is the relay's alone."}
    return {"status": 200, "data": rows(sess.reads)}


def _day(raw: Any) -> str | None:
    """staffIssueDate_: yyyy-mm-dd or M/D/YY(YY) as the tracker's M/D/YYYY; '' for none, None for a non-day."""
    s = s_(raw).strip()
    if not s:
        return ""
    m = re.fullmatch(r"(\d{4})-(\d{1,2})-(\d{1,2})", s)
    if m:
        y, mo, d = int(m[1]), int(m[2]), int(m[3])
    else:
        m = re.fullmatch(r"(\d{1,2})/(\d{1,2})/(\d{2}|\d{4})", s)
        if not m:
            return None
        mo, d, y = int(m[1]), int(m[2]), int(("20" + m[3]) if len(m[3]) == 2 else m[3])
    if not SW.issue_day_ok(f"{y:04d}-{mo:02d}-{d:02d}"):
        return None
    return f"{mo}/{d}/{y}"


def add(sess: L.Session, payload: dict) -> Decision:
    """staffIssueAdd: one situation on the tracker, its values placed by header, never by position; a value whose
    column is gone refused, never dropped."""
    user = sess.user or {}
    if s_(user.get("role")) not in ("admin", "manager"):
        return Decision(DENIED)
    p = payload if isinstance(payload, dict) else {}
    day = _day(p.get("date"))
    if day is None:
        return W.refuse(400, "The date must be a calendar day (yyyy-mm-dd) — the tracker keeps them as M/D/YYYY and "
                             "sorts on that shape.")
    if not day:
        return W.refuse(400, "A staff issue needs the date it happened.")
    involved = s_(p.get("employees_involved")).strip()
    if not involved:
        return W.refuse(400, "A staff issue needs the people it is about — the tracker is read by name.")
    situation = s_(p.get("situation")).strip()
    if not situation:
        return W.refuse(400, "A staff issue needs the situation. A row with no situation is dropped by the reader and "
                             "would vanish.")
    action = s_(p.get("disciplinary_action")).strip()
    if action and action not in ACTIONS_LIST:
        return W.refuse(400, f'Unknown disciplinary action "{action}". The tracker\'s own list: '
                             f'{", ".join(ACTIONS_LIST)}.')
    values = {"date": day, "employees_involved": involved[:500], "situation": situation[:4000],
              "follow_up": s_(p.get("follow_up"))[:4000], "disciplinary_action": action,
              "result": s_(p.get("result"))[:2000]}
    reads = sess.reads
    W.gate(reads)
    sid, ref, heads = SW.hr_tracker(reads)
    missing = [k for k, v in values.items() if v and k not in heads]
    if missing:
        return W.refuse(409, "The HR tracker no longer has a column for: " + ", ".join(missing) + ". Nothing was "
                             "written — the sheet's headers moved and the Hub will not guess where these belong.")
    cells = {heads[k]: v for k, v in values.items() if v}
    match_heads = (heads["employees_involved"], heads["situation"])
    row_key = "\x1f".join(gsjs.trim(cells[h]) for h in match_heads)
    rec = W.kept_record(sid, ref.tab, "append", W.COLS + W.COLS_SEP.join(match_heads), row_key, involved[:120], cells)
    return W.final({"status": 200, "data": {"ok": True, "kept": True, "written": values, "book": "Employee HR Tracker",
                                            "tab": ref.tab}}, [rec], involved[:120])


ACTIONS: dict[str, Callable[[L.Session, dict], Any]] = {"staffIssuesList": staff_issues_list}
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
