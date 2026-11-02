"""System Logs (SysLog.gs logsList, Events.gs eventsList) off asa-hub-db: the platform's log feed (HUB_LOGS_ID, its
system_logs tab) and the engine's events trail, newest first, for an admin or a manager standing at headquarters. Both
tabs hold hundreds of thousands of rows: the filters run inside the statement as a wider net, and every row it hands
back is judged again here as Apps Script judges it. The lines Python writes (app/sys_log.py) live in the Hub's own
tables (app.system_logs, app.log_events) and are read with each book's history as one feed, by moment."""
from __future__ import annotations

import json
import math
import re
from datetime import datetime, timezone
from typing import Any, Callable, Iterator

import candidate_papers as CNDP
import candidates as CND
import gsjs
import house_tables as HT
import hubdb
import locations as L
import resource_rows as RR
import scope as sc
import staff_perf as SPF
from gsjs import NY
from scope import Defer

APP_ID = "logs"
LOGS_TAB = "system_logs"
EVENTS_TAB = "events"
EVENTS_HEADER = ("event_id", "type", "actor", "subject_type", "subject_key", "subject_name", "payload", "source", "at",
                 "tenant")
EVENTS_READ_WINDOW = 500
# SysLog.gs LOGS_HEADER
LOGS_HEADER = ("timestamp", "actor", "action", "target", "ok", "detail", "area", "outcome", "summary", "actor_name",
               "tenant")
# the lines Python keeps (app/sys_log.py), in the Hub's own tables: read beside the books' history, never in a sheet
OWN_LOGS = "app.system_logs"
OWN_EVENTS = "app.log_events"
# their moments, ISO text as hubSysLog_ wrote it, compared byte by byte: text order is time order
_OWN_STAMP = '"timestamp" collate "C"'
_OWN_AT = '"at" collate "C"'
PLATFORM_MEMBERS_TAB = "platform_members"
# rows asked of the statement at a time while the feed fills its limit
PAGE = 1000
DENIED = {"status": 403, "message": "Requires an admin or manager account"}
MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")

# LOG_VOCAB: matched by prefix, longest wins (`doc_review:verified` beats `doc_review`)
LOG_VOCAB = (
    ("authLogin", "Access", "signed in"), ("authLogout", "Access", "signed out"),
    ("authMe", "Access", "resumed a session"), ("login", "Access", "signed in"), ("logout", "Access", "signed out"),
    ("userCreate", "Settings", "created a user account"), ("people_merge", "People", "merged duplicate people"),
    ("people_sync_platform", "People", "refreshed the roster from the platform"),
    ("users_contact_merge_error", "Settings", "could not merge platform contacts"),
    ("users_contact_merge", "Settings", "merged platform contacts into accounts"),
    ("behavior_signals_ingest", "People", "filed behaviour signals"),
    ("behavior_reading", "People", "composed a behaviour reading"), ("lead_read", "Leads", "read a texted lead"),
    ("userUpdate", "Settings", "changed a user account"), ("userDelete", "Settings", "removed a user account"),
    ("profileUpdate", "Settings", "updated their own profile"), ("platformMemberAsk", "Access", "asked to bring in"),
    ("platformMemberAuthorize", "Access", "was let in by"), ("platformMemberRemove", "Access", "ended the link with"),
    ("platformMemberLeave", "Access", "left the platform of"),
    ("platformMemberSweep", "Access", "swept the invitations for"),
    ("myWorldAccessSet", "Access", "changed who may open their world —"), ("doc_upload", "Documents", "uploaded"),
    ("doc_review:verified", "Documents", "verified"), ("doc_review:returned", "Documents", "returned"),
    ("doc_review", "Documents", "reviewed"), ("docFeedback", "Library", "rated a document"),
    ("collectionCreate", "Library", "created a collection"),
    ("onboarding_window", "Onboarding", "changed new-hire access for"),
    ("interviewSave", "Hiring", "recorded an interview scorecard for"),
    ("interviewSetWindow", "Hiring", "changed interviewer access for"), ("hubIntake", "Hiring", "added a candidate"),
    ("hubMoveStage", "Hiring", "moved"), ("screenSave", "Hiring", "saved a phone screen for"),
    ("screenAnalyze", "Hiring", "ran the phone-screen analysis for"),
    ("screenAutoCollect", "Comms", "collected a screening call"),
    ("screenPullTranscript", "Comms", "pulled a call transcript for"),
    ("commsSync", "Comms", "refreshed the phone window"), ("resume", "Hiring", "handled a resume for"),
    ("cjisUpload", "Hiring", "filed a background report for"),
    ("app_badge_access_set", "Settings", "changed which badges reach"),
    ("app_shelf_set", "Settings", "rearranged the workspace sections"),
    ("user_menu_links_set", "Settings", "set the company menu"),
    ("guardians_to_roster", "People", "lifted the plans' guardians onto the roster"),
)

_TABLE = re.compile(r"[a-z0-9_]{1,63}")
# a stamp the statement may compare as text: toISOString's own shape, where text order is time order
_STAMP = r"^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{3}Z$"
_DAY_ONLY = re.compile(r"^\d{4}-\d{2}-\d{2}\Z")
_PAIR = re.compile(r"^(CAN_[A-Z0-9]+)\s*:\s*([a-z0-9_]+)\Z")
_CAND = re.compile(r"^(CAN_[A-Z0-9]+)")

s_ = gsjs.str_


def writer(user: dict | None) -> bool:
    """hubIsWriter_."""
    return gsjs.js_str((user or {}).get("role")) in ("admin", "manager")


def at_headquarters(user: dict) -> None:
    """tenantContext_ standing nowhere: an account homed in a place reads that place's rows, Apps Script's to narrow."""
    if not user.get("is_service") and not sc.is_real_master(user) and s_(user.get("home_tenant")):
        raise Defer("an account homed away from headquarters reads its place's rows")


def cell(raw: dict, key: str) -> str:
    """str_ of the value getValues() hands back for this cell."""
    return s_(hubdb.typed(raw.get(key), "hub"))


def ms(v: str) -> float | None:
    """new Date(v).getTime(); None for NaN."""
    t = CND.js_date_ms(v)
    return None if t is None else float(math.floor(t))


def vocab(action: str) -> tuple[str, str]:
    """logVocab_: the area and the verb an action is said with."""
    best: tuple[str, str, str] | None = None
    for entry in LOG_VOCAB:
        if action.startswith(entry[0]) and (best is None or len(entry[0]) > len(best[0])):
            best = entry
    if best:
        return best[1], best[2]
    # resource.action rows from the generic router (people.update)
    if action.find(".") > 0:
        parts = action.split(".")
        return "Data", parts[1] + " " + parts[0]
    return "Other", action or "did something"


def when_label(v: str) -> str:
    """hubWhenLabel_: a bare day as itself, a moment on New York's clock, unreadable text as written."""
    if v == "":
        return ""
    s = gsjs.trim(v)
    if _DAY_ONLY.match(s):
        m, d = int(s[5:7]), int(s[8:10])
        if 1 <= m <= 12 and 1 <= d <= 31:
            return f"{MONTHS[m - 1]} {d}, {int(s[:4])}"
    t = ms(v)
    if t is None:
        return v
    at = datetime.fromtimestamp(t / 1000.0, timezone.utc).astimezone(NY)
    day = f"{MONTHS[at.month - 1]} {at.day}, {at.year:04d}"
    if at.hour == 0 and at.minute == 0:
        return day
    return f"{day} · {at.hour % 12 or 12}:{at.minute:02d} {'AM' if at.hour < 12 else 'PM'}"


def actor_name(reads: L.Reads, actor: str) -> str:
    """logActorName_."""
    email = re.sub(r"^asa-hub:", "", actor)
    if not email:
        return "Someone"
    if "@" not in email:
        return "The system" if email == "system" else "An automation (" + email + ")"
    u = SPF.user_by_email(reads, email)
    if u and s_(u.get("displayname")):
        return s_(u.get("displayname"))
    return email


def candidate_name(reads: L.Reads, cid: str) -> str:
    """logCandidateName_: the candidate's name, else the id."""
    def read() -> dict[str, str]:
        try:
            rows = CND.read_tab(reads, CND.TALENT_CANDIDATES_TAB)
        except hubdb.Unreadable:
            raise
        except RuntimeError:
            # the tab missing is Apps Script's caught throw: the id stands
            return {}
        return {s_(r.get("candidateid")): s_(r.get("candidatename")) for r in rows}
    return reads.once("syslog:candidates", read).get(cid) or cid


def doc_label(reads: L.Reads, doc_id: str) -> str:
    """logDocLabel_: the catalog's label, else the id with its underscores as spaces."""
    hit = CNDP.catalog(reads).get(doc_id)
    return gsjs.js_str(hit["label"]) if hit is not None else doc_id.replace("_", " ")


def member_pair(reads: L.Reads, mid: str) -> str:
    """logMemberPair_: who a membership brought in and onto whose platform, else the id."""
    def read() -> dict[str, str]:
        names = {s_(u.get("userid")): s_(u.get("displayname")) or s_(u.get("email")) for u in reads.users()}
        res = reads.db.resolve(PLATFORM_MEMBERS_TAB)
        if res.ref is None:
            if not res.book_known:
                raise hubdb.Unreadable(f"asa-hub-db holds no copy of the book behind {PLATFORM_MEMBERS_TAB}")
            return {}
        out: dict[str, str] = {}
        for r in reads.db.normalized_rows(res.ref):
            member = names.get(s_(r.get("memberuserid"))) or s_(r.get("memberemail"))
            owner = names.get(s_(r.get("owneruserid"))) or ""
            out[s_(r.get("memberid"))] = (member + (", on " + owner + "'s platform" if owner else "")) if member else ""
        return out
    return reads.once("syslog:members", read).get(mid) or mid


def friendly_target(reads: L.Reads, target: str) -> str:
    """logFriendlyTarget_: a candidate's id as their name, a paper as its label, a membership as its people."""
    t = gsjs.trim(target)
    if not t:
        return ""
    pair = _PAIR.match(t)
    if pair:
        return "the " + doc_label(reads, pair.group(2)) + " for " + candidate_name(reads, pair.group(1))
    cand = _CAND.match(t)
    if cand:
        return t.replace(cand.group(1), candidate_name(reads, cand.group(1)), 1)
    if t.startswith("mem_"):
        return member_pair(reads, t)
    return t


def _table(ref: hubdb.TabRef) -> str:
    if not _TABLE.fullmatch(ref.table or ""):
        raise hubdb.Unreadable(f"the catalog names an unusable table for {ref.tab}")
    return ref.table


def _last_row(reads: L.Reads, ref: hubdb.TabRef) -> int:
    """getLastRow(): the copy's last sheet row, 1 (the header) for none."""
    if ref.row_count < 0:
        return 1
    got = reads.db.query(f'select max(row_number) from {reads.db.from_sql(ref)}')  # noqa: S608
    return int(got[0][0]) if got and got[0][0] is not None else 1


def _raw(v: Any) -> dict:
    if isinstance(v, str):
        v = json.loads(v)
    return v if isinstance(v, dict) else {}


def logs_tab(reads: L.Reads) -> hubdb.TabRef | None:
    """logsSheet_: HUB_LOGS_ID's own system_logs tab, never routed (a second feed would start in HUB_DB); None while it
    is unborn, which Apps Script answers by making it empty."""
    sid = gsjs.trim(reads.db.prop("HUB_LOGS_ID"))
    if not sid:
        raise hubdb.Unreadable("HUB_LOGS_ID names no book")
    reads.db.note_book(sid)
    ref = reads.db.tab(sid, LOGS_TAB)
    if ref is None and reads.db.book(sid) is None:
        raise hubdb.Unreadable(f"asa-hub-db holds no copy of the book behind {LOGS_TAB}")
    return ref


def _sheet_col(c: str) -> str:
    return f"(_raw->>'{c}')"


def _own_col(c: str) -> str:
    return f'"{c}"'


def _net(area: str, outcome: str, since_ms: float | None, actor_q: str, q: str,
         col: Callable[[str], str] = _sheet_col) -> tuple[list[str], list[Any]]:
    """The rows each filter could keep, wider than the filter: a blank cell Apps Script fills in is always let through.
    `col` names a column: the copy's cell, or the Hub's own table's column."""
    def blank(c: str) -> str:
        return f"coalesce({col(c)}, '') !~ '\\S'"
    where: list[str] = []
    args: list[Any] = []
    if area:
        where.append(f"(position(%s in lower({col('area')})) > 0 or {blank('area')})")
        args.append(area)
    if outcome:
        where.append(f"(position(%s in lower({col('outcome')})) > 0 or {blank('outcome')})")
        args.append(outcome)
    if since_ms:
        where.append(f"({col('timestamp')} >= %s or coalesce({col('timestamp')}, '') !~ %s)")
        args += [gsjs.iso(datetime.fromtimestamp(since_ms / 1000.0, timezone.utc)), _STAMP]
    if actor_q:
        where.append(f"position(%s in lower({col('actor')})) > 0")
        args.append(actor_q)
    if q:
        where.append(f"(position(%s in lower({col('summary')})) > 0 or position(%s in lower({col('action')})) > 0"
                     f" or {blank('summary')})")
        args += [q, q]
    return where, args


def own_kept(reads: L.Reads, table: str) -> bool:
    """The Hub's own table of lines is made (app/sys_log.py makes it with its first line): none made holds none."""
    got = reads.db.query("select to_regclass(%s) is not null", (table,))
    return bool(got and got[0][0])


def _plain(raw: dict, key: str) -> str:
    """A column of the Hub's own table, the text hubSysLog_ wrote."""
    return s_(raw.get(key))


def _merged(sheet: Iterator[tuple[float, int, Any]], own: Iterator[tuple[float, int, Any]]
            ) -> Iterator[tuple[str, int, Any]]:
    """Two walks, each newest first, as one: the newer head first, the Hub's own on a tie."""
    hs, ho = next(sheet, None), next(own, None)
    while hs is not None or ho is not None:
        if ho is not None and (hs is None or ho[0] >= hs[0]):
            yield "own", ho[1], ho[2]
            ho = next(own, None)
        else:
            yield "sheet", hs[1], hs[2]
            hs = next(sheet, None)


def _timed(walk: Iterator[tuple[int, Any]], at: Callable[[Any], str]) -> Iterator[tuple[float, int, Any]]:
    """Each item with its moment; one that reads as none takes the moment before it, keeping its place in its walk."""
    carry = math.inf
    for pos, item in walk:
        t = ms(at(item))
        carry = carry if t is None else t
        yield carry, pos, item


def logs_list(sess: L.Session, payload: dict) -> dict[str, Any]:
    """logsList: the feed newest first, cut at `limit`, with the areas of every row read on the way down — the logs
    book's history and the Hub's own lines (app.system_logs) as one feed, by moment."""
    reads, user = sess.reads, sess.user or {}
    if not writer(user):
        return DENIED
    at_headquarters(user)
    p = payload if isinstance(payload, dict) else {}
    empty = {"status": 200, "data": {"events": [], "areas": [], "total": 0}}
    ref = logs_tab(reads)
    last = _last_row(reads, ref) if ref is not None else 1
    table = reads.db.from_sql(ref) if ref is not None and last >= 2 else ""
    own_total = int(reads.db.query(f"select count(*) from {OWN_LOGS}")[0][0]) if own_kept(reads, OWN_LOGS) else 0
    if not table and not own_total:
        return empty

    area = s_(p.get("area")).lower()
    outcome = s_(p.get("outcome")).lower()
    actor_q = s_(p.get("actor")).lower()
    q = s_(p.get("q")).lower()
    since = s_(p.get("since"))
    since_ms = ms(since) if since else None
    n = CND.js_parse_int(p.get("limit"))
    limit = min(1000, max(1, int(n) if n == n and n else 200))

    def judge(raw: dict, cell: Callable[[dict, str], str] = cell) -> dict[str, str] | None:
        at = cell(raw, "timestamp")
        action = cell(raw, "action")
        v_area, v_verb = vocab(action)
        row_area = cell(raw, "area") or v_area
        row_outcome = cell(raw, "outcome") or ("failed" if cell(raw, "ok").lower() == "false" else "ok")
        if area and row_area.lower() != area:
            return None
        if outcome and row_outcome.lower() != outcome:
            return None
        if since_ms:
            t = ms(at)
            if t is not None and t < since_ms:
                return None
        actor = cell(raw, "actor")
        if actor_q and actor_q not in actor.lower():
            return None
        who = cell(raw, "actor_name") or actor_name(reads, actor)
        summary = cell(raw, "summary") or gsjs.trim(
            who + " " + v_verb + " " + friendly_target(reads, cell(raw, "target")))
        if q and q not in summary.lower() and q not in action.lower():
            return None
        return {"at": at, "when": when_label(at), "actor": actor, "actor_name": who, "area": row_area,
                "outcome": row_outcome, "summary": summary, "action": action, "target": cell(raw, "target"),
                "detail": cell(raw, "detail")}

    size = min(PAGE, limit + 50)

    def sheet_walk() -> Iterator[tuple[int, dict[str, str]]]:
        if not table:
            return
        where, args = _net(area, outcome, since_ms, actor_q, q)
        below = last + 1
        while True:
            got = reads.db.query(f'select row_number, _raw from {table}'  # noqa: S608
                                 " where " + " and ".join(where + ["row_number < %s"])
                                 + " order by row_number desc limit %s", tuple(args + [below, size]))
            for rn, raw in got:
                ev = judge(_raw(raw))
                if ev is not None:
                    yield int(rn), ev
            if len(got) < size:
                return
            below = int(got[-1][0])

    def own_walk() -> Iterator[tuple[int, dict[str, str]]]:
        # newest first by the moment written: a batch kept after a write may hold lines older than the write's
        if not own_total:
            return
        where, args = _net(area, outcome, since_ms, actor_q, q, _own_col)
        cols = ", ".join(_own_col(c) for c in LOGS_HEADER)
        below: tuple[str, int] | None = None
        while True:
            after = [] if below is None else [f"({_OWN_STAMP}, id) < (%s, %s)"]
            got = reads.db.query(f"select id, {cols} from {OWN_LOGS} where "  # noqa: S608
                                 + " and ".join(where + after + ["true"])
                                 + f" order by {_OWN_STAMP} desc, id desc limit %s",
                                 tuple(args + ([] if below is None else list(below)) + [size]))
            for r in got:
                ev = judge(dict(zip(LOGS_HEADER, r[1:])), _plain)
                if ev is not None:
                    yield int(r[0]), ev
            if len(got) < size:
                return
            below = (s_(got[-1][1]), int(got[-1][0]))

    def stamp_of(ev: dict[str, str]) -> str:
        return ev["at"]

    events: list[dict[str, str]] = []
    seen: set[tuple[str, ...]] = set()
    cut: tuple[str, int, dict[str, str]] | None = None
    for src, pos, ev in _merged(_timed(sheet_walk(), stamp_of), _timed(own_walk(), stamp_of)):
        # one line, whichever record holds it
        key = (ev["at"][:19], ev["actor"], ev["action"], ev["target"])
        if key in seen:
            continue
        seen.add(key)
        events.append(ev)
        if len(events) >= limit:
            cut = (src, pos, ev)
            break

    # every row the walk passed counts toward its area, in the order the walk first met each area: in each record the
    # rows from its newest down to the cut's moment
    sheet_from: int | None = 0
    own_from = ""
    if cut is not None:
        t = ms(cut[2]["at"])
        moment = gsjs.iso(datetime.fromtimestamp(t / 1000.0, timezone.utc)) if t is not None else ""
        if cut[0] == "sheet":
            sheet_from = cut[1]
            own_from = moment or "~"
        else:
            own_from = cut[2]["at"]
            got = reads.db.query(f"select min(row_number) from {table}"  # noqa: S608
                                 " where (_raw->>'timestamp') >= %s and (_raw->>'timestamp') ~ %s",
                                 (moment, _STAMP)) if table and moment else []
            sheet_from = int(got[0][0]) if got and got[0][0] is not None else None
    areas: dict[str, list[Any]] = {}

    def count(name: str, n: int, newest: str, top: int) -> None:
        held = areas.setdefault(name, [0, "", 0])
        held[0] += n
        held[1] = max(held[1], newest)
        held[2] = max(held[2], top)

    if table and sheet_from is not None:
        for a, act, n, top, newest in reads.db.query(
                f"select _raw->>'area', _raw->>'action', count(*), max(row_number), max(_raw->>'timestamp')"
                f' from {table}'  # noqa: S608
                + (" where row_number >= %s" if sheet_from else "") + " group by 1, 2",
                (sheet_from,) if sheet_from else None):
            count(s_(hubdb.typed(a, "hub")) or vocab(s_(hubdb.typed(act, "hub")))[0], int(n), s_(newest), int(top))
    if own_total:
        for a, act, n, newest in reads.db.query(
                f"select area, action, count(*), max({_OWN_STAMP}) from {OWN_LOGS}"  # noqa: S608
                + (f" where {_OWN_STAMP} >= %s" if own_from else "") + " group by 1, 2",
                (own_from,) if own_from else None):
            count(s_(a) or vocab(s_(act))[0], int(n), s_(newest), 0)
    order = sorted(areas.items(), key=lambda kv: -kv[1][2])
    order = sorted(order, key=lambda kv: kv[1][1], reverse=True)
    order = sorted(order, key=lambda kv: -kv[1][0])
    area_list = [{"area": k, "count": v[0]} for k, v in order]
    return {"status": 200, "data": {"events": events, "areas": area_list, "total": max(0, last - 1) + own_total}}


def _json(text: str) -> Any:
    """JSON.parse, which refuses NaN and Infinity."""
    def refuse(_c: str) -> Any:
        raise ValueError("not JSON")
    return json.loads(text, parse_constant=refuse)


def events_list(sess: L.Session, payload: dict) -> dict[str, Any]:
    """eventsList (eventList_): one page of the trail's newest window, newest first, below `cursor` when it names one,
    filtered by type, subject, actor or date."""
    reads, user = sess.reads, sess.user or {}
    if not writer(user):
        return DENIED
    p = payload if isinstance(payload, dict) else {}
    cursor = s_(p.get("cursor"))
    n = CND.js_parse_int(p.get("limit"))
    limit = min(200, max(1, int(n) if n == n and n else 50))
    # the trail in its own table once kept there: its newest window by position, its columns in the sheet's order
    kept = HT.resource_of(EVENTS_TAB) if HT.tabled(EVENTS_TAB) else None
    newest: list[dict] = []
    kept_heads: list[str] = []
    if kept is not None:
        kept_heads = RR.columns(reads, kept)[:len(EVENTS_HEADER)]
        newest = [_raw(c) for (c,) in RR._q(reads, f"select cells from {RR.rows_of(kept)} where resource = %s"
                                                   " and removed_at is null order by position desc, created_at desc"
                                                   " limit %s", (kept, EVENTS_READ_WINDOW))]
        ref, last = None, len(newest) + 1
    else:
        res = reads.db.resolve(EVENTS_TAB)
        if res.runtime:
            raise Defer(f"{EVENTS_TAB} lives in the depot's facts")
        if res.ref is None and not res.book_known:
            raise hubdb.Unreadable(f"asa-hub-db holds no copy of the book behind {EVENTS_TAB}")
        ref = res.ref
        last = _last_row(reads, ref) if ref is not None else 1
    own = reads.db.query(f"select {', '.join(_own_col(c) for c in EVENTS_HEADER)} from {OWN_EVENTS}"  # noqa: S608
                         f" order by {_OWN_AT} desc, id desc limit %s",
                         (EVENTS_READ_WINDOW,)) if own_kept(reads, OWN_EVENTS) else []
    if last < 2 and not own:
        return {"status": 200, "data": {"events": [], "next_cursor": ""}}

    since_ms = 0.0
    if not gsjs.falsy(p.get("since")):
        since_ms = ms(gsjs.js_str(p.get("since"))) or 0.0
    kind = s_(p.get("type")).lower()
    subject_key = s_(p.get("subject_key")).lower()
    actor = s_(p.get("actor")).lower()

    def sheet_rows() -> Iterator[tuple[int, list[str]]]:
        if last < 2:
            return
        if kept is not None:
            for i, raw in enumerate(newest):
                yield last - i, [cell(raw, kept_heads[j]) if j < len(kept_heads) else ""
                                 for j in range(len(EVENTS_HEADER))]
            return
        start = max(2, last - EVENTS_READ_WINDOW + 1)
        held = {int(rn): _raw(raw) for rn, raw in reads.db.query(
            f'select row_number, _raw from {reads.db.from_sql(ref)} where row_number >= %s', (start,))}  # noqa: S608
        # read by position, as the window's getValues() hands the columns back
        heads = list(ref.headers[:len(EVENTS_HEADER)])
        for rn in range(last, start - 1, -1):
            raw = held.get(rn, {})
            yield rn, [cell(raw, heads[i]) if i < len(heads) else "" for i in range(len(EVENTS_HEADER))]

    def own_rows() -> Iterator[tuple[int, list[str]]]:
        for i, r in enumerate(own):
            yield i, [s_(v) for v in r]

    # the trail's newest window: the book's last rows and the Hub's own newest, as one by moment
    window = [row for _src, _pos, row in _merged(_timed(sheet_rows(), lambda r: r[8]),
                                                 _timed(own_rows(), lambda r: r[8]))][:EVENTS_READ_WINDOW]
    out: list[dict[str, Any]] = []
    seen_cursor = not cursor
    for row in window:
        if len(out) >= limit:
            break
        eid = row[0]
        if not seen_cursor:
            if eid == cursor:
                seen_cursor = True
            continue
        at = row[8]
        at_ms = (ms(at) if at else 0.0)
        if since_ms and at_ms is not None and at_ms < since_ms:
            continue
        if kind and row[1].lower() != kind:
            continue
        if subject_key and row[4].lower() != subject_key:
            continue
        if actor and actor not in row[2].lower():
            continue
        try:
            body = _json(row[6] or "{}")
        except ValueError:
            body = {}
        out.append({"event_id": eid, "type": row[1], "actor": row[2], "subject_type": row[3], "subject_key": row[4],
                    "subject_name": row[5], "payload": body, "source": row[7], "at": at, "tenant": row[9]})
    return {"status": 200, "data": {"events": out, "next_cursor": out[-1]["event_id"] if out else "",
                                    "window": EVENTS_READ_WINDOW}}


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {"logsList": logs_list, "eventsList": events_list}
# HUB_POLICY: both for admins and managers
POLICY: dict[str, dict[str, Any]] = {a: {"roles": ("admin", "manager")} for a in ACTIONS}
