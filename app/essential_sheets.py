"""The essential sheets: the books people and forms still post to, swept straight from Google into their tables in
asa-hub-db three times a day, until everyone uses only the Hub (the operator, 2026-10-27: "LER do postgree SEMPRE e ter
um JOB diário de 3 vezes ao dia que cheque algumas sheets essenciais"). Every screen reads Postgres alone; this job is
the one reader of those sheets, and it replaces the sheet keeper whose mirror lived in the old platform's database.

The books are the ones followed until now (app/followed_books.py: the Employee Database, the recruiters' book, the
division's tasks, the repairs, the staff documents forms, the HR tracker, Missing Medications), the Asa Client
Database (sheet_resources.CLIENT_DB_HOUSES: the clients still added there), the UIs and MUIs book (ESTATE_HOUSES: the
incident reports its form still files) and the Dr Appointments book
(app/dr_book.py). Each tab is read as asatech (its Drive token, server/.asatech-drive.json), keyed by its header
as the copies always were (db/sheets_source.py's shape) and passed through the one withholding rule of every copy
(server/redaction.py), then laid on its table: a row posted there and not here is added, a row nothing in the Hub
touched takes the sheet's cells, and no row is ever taken out of the Hub (resource_rows.lay with drop off; the Dr
Appointments book only carries new rows, dr_book.carry).

The master alone may sweep at once (Settings › Essential sheets, LANE): anyone else is told the lane does not exist.
Each sweep is kept in app.essential_sweeps (db/essential_sweeps.sql)."""
from __future__ import annotations

import asyncio
import collections
import contextlib
import json
import logging
import os
import re
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Callable, Optional
from zoneinfo import ZoneInfo

import gsjs
import locations as L
import resource_rows as RR
import sheet_resources as SR
import smart_comms as SC

try:
    from fastapi import Request
except ImportError:  # the checks import the sweep without the web framework
    Request = Any  # type: ignore[misc,assignment]

log = logging.getLogger("asa-hub-app.essential-sheets")

LANE = "/hub-lanes/essential-sheets"
NY = ZoneInfo("America/New_York")
# the three daily sweeps, New York time
AT = tuple(t.strip() for t in (os.getenv("HUB_ESSENTIAL_SWEEP_AT") or "07:00,13:00,19:00").split(",") if t.strip())
OWNER_FILE = os.getenv("HUB_APP_GOOGLE_OWNER_FILE", "/run/secrets/asatech-drive.json").strip()
RULES_DIR = os.getenv("HUB_RULES_DIR", "/rules").strip()
TOKEN_URL = "https://oauth2.googleapis.com/token"
SHEETS = "https://sheets.googleapis.com/v4/spreadsheets"
# a sheet holding fewer rows than this share of the table's own sheet rows is read wrong (a moved header, a cleared
# tab): it is not laid, and the sweep says why
TOO_FEW = 0.8
SWEPT_BY = "essential sheets sweep"
_RUN = threading.Lock()


class NotSwept(Exception):
    """Why a tab was not laid: said in the sweep's result, never an error."""


# ---- the essential tabs ------------------------------------------------------------------------------------------

# the incident reports' book, its form still filing there (the operator, 2026-10-29): its house is the estate's UIs and
# MUIs (locations.ESTATE_SOURCES), read by the Incident Log, Locations, a client's Incidents and Support Requests'
# incident events — by house, the estate source it keeps
ESTATE_HOUSES = {"bk1cocsVUIsAndMUIs": "uiIncidents"}


def essential() -> list[tuple[str, str, str]]:
    """(resource, the book's prop, tab) of every essential tab."""
    import dr_book  # noqa: PLC0415
    import followed_books  # noqa: PLC0415
    out = [(r, str(SR.BOOKED[r]["book"]), tab) for r, tab in followed_books.RESOURCES.items()]
    out += [(r, SR.CLIENT_DB_PROP, tab) for r, tab in SR.CLIENT_DB_HOUSES.items()]
    out += [(r, *L.ESTATE_SOURCES[e]) for r, e in ESTATE_HOUSES.items()]
    return out + [(r, dr_book.PROP, tab) for r, tab in dr_book.TABS.items()]


# a book whose prop is not declared, read where its readers fall back to (reads.prop_book)
FALLBACK = {SR.CLIENT_DB_PROP: SR.CLIENT_DB_FALLBACK}


# ---- Google, as asatech ------------------------------------------------------------------------------------------

class Sheets:
    """The Sheets API with asatech's Drive token (drive scope)."""

    def __init__(self, owner_file: str = OWNER_FILE) -> None:
        self.owner_file = owner_file
        self._token: tuple[str, float] = ("", 0.0)
        self._lock = threading.Lock()

    def _access(self) -> str:
        with self._lock:
            tok, until = self._token
            if tok and time.time() < until - 60:
                return tok
            try:
                held = json.loads(Path(self.owner_file).read_text())
            except (OSError, ValueError) as exc:
                raise NotSwept(f"asatech's Drive token is not readable here ({type(exc).__name__})") from exc
            body = urllib.parse.urlencode({"client_id": held.get("client_id", ""),
                                           "client_secret": held.get("client_secret", ""),
                                           "refresh_token": held.get("refresh_token", ""),
                                           "grant_type": "refresh_token"}).encode()
            req = urllib.request.Request(TOKEN_URL, body, headers={"User-Agent": "asa-hub-app"})
            got = json.loads(urllib.request.urlopen(req, timeout=20).read())
            self._token = (str(got.get("access_token") or ""), time.time() + float(got.get("expires_in") or 0))
            return self._token[0]

    def tabs(self, sid: str, titles: list[str]) -> dict[str, list[list]]:
        """Each named tab's values as the sheet shows them (a date as its text, never a serial)."""
        params = [("valueRenderOption", "FORMATTED_VALUE"), ("majorDimension", "ROWS")]
        params += [("ranges", "'" + t.replace("'", "''") + "'") for t in titles]
        req = urllib.request.Request(f"{SHEETS}/{urllib.parse.quote(sid)}/values:batchGet?"
                                     f"{urllib.parse.urlencode(params)}",
                                     headers={"Authorization": f"Bearer {self._access()}", "User-Agent": "asa-hub-app"})
        try:
            got = json.loads(urllib.request.urlopen(req, timeout=120).read())
        except urllib.error.HTTPError as exc:
            raise NotSwept(f"Google answered {exc.code}") from exc
        return {t: (vr.get("values") or []) for t, vr in zip(titles, got.get("valueRanges") or [])}


SHEETS_API = Sheets()


# ---- a tab's values as the copies keyed them (db/sheets_source.py) -----------------------------------------------------

def _looks_like_label(cell: Any) -> bool:
    s = str(cell or "").strip()
    if not s or re.fullmatch(r"-?\d+(\.\d+)?", s) or re.fullmatch(r"\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}.*)?", s):
        return False
    return bool(re.search(r"[A-Za-z]", s))


def _header(values: list[list]) -> tuple[Optional[int], list[str]]:
    """The first of eight rows with two filled cells, one of them a label; else none."""
    for i in range(min(len(values), 8)):
        row = values[i] or []
        filled = [c for c in row if c is not None and str(c).strip() != ""]
        if len(filled) < 2 or not any(_looks_like_label(c) for c in filled):
            continue
        last = max((j for j, c in enumerate(row) if c is not None and str(c).strip() != ""), default=-1)
        return i, [str(c).strip() for c in row[: last + 1]]
    return None, []


def _twins(header: list[str]) -> list[str]:
    """A repeated name's last column keeps the name, each earlier one is "<name> ⟨n⟩" (an owned book's copy)."""
    total = collections.Counter(h for h in header if h)
    seen: collections.Counter = collections.Counter()
    out = []
    for h in header:
        if h and total[h] > 1:
            seen[h] += 1
            out.append(h if seen[h] == total[h] else f"{h} ⟨{seen[h]}⟩")
        else:
            out.append(h)
    return out


def shape(values: list[list], twins: bool = False) -> tuple[list[str], list[tuple[int, dict]]]:
    """The header row's names, then one name -> text map per row below it, numbered as the sheet numbers them."""
    if not values:
        return [], []
    at, header = _header(values)
    if at is None or not header:
        at, header = 0, [str(h).strip() for h in values[0]]
    if twins:
        header = _twins(header)
    keys = list(dict.fromkeys(h for h in header if h))
    rows = []
    for n, row in enumerate(values[at + 1:], start=at + 2):
        data = {h: (str(row[i]) if i < len(row) else "") for i, h in enumerate(header) if h}
        if data:
            rows.append((n, data))
    return keys, rows


# ---- the withholding rule (server/redaction.py, mounted at HUB_RULES_DIR) ---------------------------------------------

def rule() -> Any:
    if (Path(RULES_DIR) / "redaction.py").is_file() and RULES_DIR not in sys.path:
        sys.path.insert(0, RULES_DIR)
    try:
        import redaction  # noqa: PLC0415
    except ImportError as exc:
        raise NotSwept("the withholding rule (server/redaction.py) is not mounted here; nothing is read without it") \
            from exc
    return redaction


def withheld(sid: str, keys: list[str], rows: list[tuple[int, dict]]) -> tuple[list[str], list[tuple[int, dict]]]:
    """The headers and rows as the rule lets a copy keep them: a withheld cell marked, a credential header renamed."""
    R = rule()
    told = getattr(R, "reading", None)
    with told(sid) if told is not None else contextlib.nullcontext():
        heads = list(R.redact_row(dict.fromkeys(keys))[0])
        out = []
        for rn, data in rows:
            red, _n = R.redact_row({k: data.get(k) for k in keys})
            out.append((rn, {h: v for k, h, v in zip(keys, red, red.values()) if k in data}))
    return heads, out


# ---- the sweep -----------------------------------------------------------------------------------------------------

def _sheet_rows_here(reads: L.Reads, resource: str) -> int:
    got = RR._q(reads, f"select count(*) from {RR.rows_of(resource)} where resource = %s and origin = 'sheet'"
                       " and removed_at is null", (resource,))
    return int(got[0][0]) if got else 0


def _twins_held(reads: L.Reads, resource: str) -> bool:
    """Whether the table keeps a repeated header's every column (a "<name> ⟨n⟩" cell in some row): the old copies kept
    them for an owned book alone, the last column winning elsewhere."""
    got = RR._q(reads, f"select exists (select 1 from {RR.rows_of(resource)} r, jsonb_object_keys(r.cells) k"
                       " where r.resource = %s and k like %s)", (resource, "%⟨%"))
    return bool(got and got[0][0])


_SERIAL = re.compile(r"\d+(?:\.\d+)?")
_DATEY = re.compile(r"\d{1,2}/\d{1,2}/\d{2,4}(?:\s.*)?")


def _same_text(old: Any, new: Any) -> bool:
    """Whether a sheet cell says what the table's cell says, the way each was read aside: two withheld markers (a tag
    drawn or not), or a date the old copy held as Google's serial number and the sheet shows as its text."""
    if old == new:
        return True
    o, n = str(old or ""), str(new or "")
    if o.startswith("[withheld") and n.startswith("[withheld"):
        return True
    # the old keeper wrote a linked cell as "text [link]"; the sheet's text is the same cell
    if n and o.startswith(n + " [") and o.endswith("]"):
        return True
    return bool(_SERIAL.fullmatch(o) and _DATEY.fullmatch(n))


def linked_names(heads: list[str], rows: list[tuple[int, dict]],
                 columns: list[str]) -> tuple[list[str], list[tuple[int, dict]]]:
    """A header the table holds only as the old keeper wrote a linked cell ("name [link]") takes that name."""
    rename = {}
    for h in heads:
        if h and h not in columns:
            held = [c for c in columns if c.startswith(h + " [") and c.endswith("]")]
            if len(held) == 1:
                rename[h] = held[0]
    if not rename:
        return heads, rows
    return ([rename.get(h, h) for h in heads],
            [(rn, {rename.get(h, h): v for h, v in cells.items()}) for rn, cells in rows])


def settled(reads: L.Reads, resource: str, heads: list[str],
            rows: list[tuple[int, dict]]) -> list[tuple[int, dict]]:
    """The sheet's rows with every cell that only reads differently from the table's (same_text) given the table's
    value, and the table's columns the sheet does not name kept: so a row is refreshed only when its text changed."""
    got = RR._q(reads, f"select row_key, cells from {RR.rows_of(resource)} where resource = %s", (resource,))
    have = {str(k): RR._json(c) or {} for k, c in got}
    named = set(heads)
    seen: set[str] = set()
    out = []
    for rn, cells in rows:
        cells = {h: v for h, v in cells.items() if v not in (None, "")}
        rid = RR.row_id_of(cells)
        key = rid or f"r{rn}"
        if key in seen:
            key = f"{key}#r{rn}"
        seen.add(key)
        was = have.get(key)
        if was is None:
            out.append((rn, cells))
            continue
        merged = {h: v for h, v in was.items() if h not in named}
        for h, v in cells.items():
            if h in was:
                merged[h] = was[h] if _same_text(was[h], v) else v
            elif not any(k.startswith(h + " [") and _same_text(was[k], v) for k in was):
                # a cell the row holds under the old keeper's linked name ("name [link]") is the same cell
                merged[h] = v
        out.append((rn, merged))
    return out


def _lay(reads: L.Reads, resource: str, sid: str, tab: str, values: list[list]) -> dict[str, Any]:
    import dr_book  # noqa: PLC0415
    if not RR.uploaded(reads.db, resource):
        raise NotSwept("its table holds no upload yet")
    columns = [h for h in RR.columns(reads, resource) if h]
    keys, rows = shape(values, twins=_twins_held(reads, resource))
    heads, rows = linked_names(*withheld(sid, keys, rows), columns)
    if not rows:
        raise NotSwept("the sheet holds no row under a header")
    shared = len(set(heads) & set(columns))
    if shared < max(1, len([h for h in heads if h]) // 2):
        raise NotSwept(f"the sheet's header shares {shared} of {len(heads)} names with the table")
    if resource in dr_book.TABS:
        return {"added": dr_book.carry(reads, resource, (heads, rows)), "rows": len(rows)}
    have = _sheet_rows_here(reads, resource)
    if len(rows) < TOO_FEW * have:
        raise NotSwept(f"the sheet holds {len(rows)} row(s) against {have} here")
    named = [h for h in heads if h]
    rows = settled(reads, resource, named, rows)
    # a cell the withholding rule took (an SSN, a card's PIN, a password) keeps its marker, as the copies always kept
    # it, unless the tab's own rule works it out: the rest of the row is laid, the secret never is
    derive = dict(SR.DERIVE.get(resource) or {})
    for h in named:
        if h not in derive and any(str(raw.get(h) or "").startswith(RR.WITHHELD) for _rn, raw in rows):
            derive[h] = SR.kept_withheld(h)
    # the table's own columns ride along, so a row keeps every cell the sheet does not name
    return RR.lay(resource, sid, tab, named + [c for c in columns if c not in named], rows, derive, drop=False)


def sweep(store: Any, reads_of: Callable[[], L.Reads], asked_by: str = "clock") -> dict[str, Any]:
    """Every essential tab read from Google and laid on its table, in one write under the platform's lock; one sweep at
    a time. Returns {resource: counts or {skipped: why}} and keeps it in app.essential_sweeps."""
    if not _RUN.acquire(blocking=False):
        return {"busy": "a sweep is running now"}
    started = time.time()
    try:
        by_book: dict[str, list[tuple[str, str]]] = {}
        out: dict[str, Any] = {}
        reads = reads_of()
        for resource, prop, tab in essential():
            sid = gsjs.trim(reads.db.prop(prop)) or FALLBACK.get(prop, "")
            if not sid:
                out[resource] = {"skipped": f"no {prop} is declared"}
                continue
            by_book.setdefault(sid, []).append((resource, tab))
        read: dict[str, dict[str, list[list]]] = {}
        for sid, tabs in by_book.items():
            try:
                read[sid] = SHEETS_API.tabs(sid, list(dict.fromkeys(t for _r, t in tabs)))
            except NotSwept as exc:
                for r, _t in tabs:
                    out[r] = {"skipped": str(exc)}
            except Exception as exc:  # noqa: BLE001 - the other books are swept
                for r, _t in tabs:
                    out[r] = {"skipped": f"the book was not read ({type(exc).__name__})"}
        # the recruiters' Talent Pipeline and Onboarding Checklist, whose houses the recruit pass keeps
        # (recruit_book): read from Google here with the rest, laid by that pass's own ingest on its next ring
        try:
            import recruit_book  # noqa: PLC0415 - the recruiters' book's own pass
            got = recruit_book.sync(google=True)
            out["recruitBook"] = ({"read": True, "changed": bool(got.get("changed"))} if got.get("read")
                                  else {"skipped": str(got.get("why") or "not read")})
        except Exception as exc:  # noqa: BLE001 - said in the result, the other books are swept
            out["recruitBook"] = {"skipped": f"not read ({type(exc).__name__})"}
        with store.locked():
            token = SC._WRITE.set({**(SC._WRITE.get() or {}), "write_id": f"essential-sweep-{int(started)}"})
            try:
                reads = reads_of()
                cur = RR._cur()
                for sid, tabs in by_book.items():
                    for resource, tab in tabs:
                        if resource in out:
                            continue
                        # each tab on its own: one that cannot be laid leaves the others' rows standing
                        cur.execute("savepoint essential_tab")
                        try:
                            out[resource] = _lay(reads, resource, sid, tab, read.get(sid, {}).get(tab) or [])
                            cur.execute("release savepoint essential_tab")
                        except NotSwept as exc:
                            cur.execute("rollback to savepoint essential_tab")
                            out[resource] = {"skipped": str(exc)}
                        except Exception as exc:  # noqa: BLE001 - said in the result, the other tabs go on
                            cur.execute("rollback to savepoint essential_tab")
                            out[resource] = {"skipped": f"not laid ({type(exc).__name__}: {str(exc)[:120]})"}
                # a person or a client added only in Google comes into the Hub's own lists (book_intake)
                cur.execute("savepoint essential_intake")
                try:
                    import book_intake  # noqa: PLC0415 - it reads the tables this sweep just laid
                    out["newInHub"] = book_intake.register(reads_of(), cur)
                    cur.execute("release savepoint essential_intake")
                except Exception as exc:  # noqa: BLE001 - said in the result, the laid tabs stand
                    cur.execute("rollback to savepoint essential_intake")
                    out["newInHub"] = {"skipped": f"not registered ({type(exc).__name__}: {str(exc)[:120]})"}
                cur.execute("insert into app.essential_sweeps (started_at, finished_at, asked_by, result)"
                            " values (to_timestamp(%s), now(), %s, %s)", (started, asked_by, json.dumps(out)))
            finally:
                SC._WRITE.reset(token)
        return out
    finally:
        _RUN.release()


def said(out: dict[str, Any]) -> str:
    moved = []
    for r, c in sorted(out.items()):
        if not isinstance(c, dict):
            continue
        if c.get("skipped"):
            moved.append(f"{r} not swept ({c['skipped']})")
        elif c.get("added") or c.get("refreshed"):
            moved.append(f"{r} +{c.get('added', 0)} ~{c.get('refreshed', 0)}")
    return "; ".join(moved) or "nothing new on the sheets"


# ---- the clock -----------------------------------------------------------------------------------------------------

def next_at(now: datetime | None = None) -> datetime:
    """The next of the day's sweep times, New York time."""
    now = (now or datetime.now(NY)).astimezone(NY)
    for day in (0, 1):
        for hhmm in sorted(AT):
            h, m = (int(x) for x in hhmm.split(":"))
            at = (now + timedelta(days=day)).replace(hour=h, minute=m, second=0, microsecond=0)
            if at > now:
                return at
    return now + timedelta(hours=8)


async def thrice(store: Any, reads_of: Callable[[], L.Reads]) -> None:
    """sweep at each of AT, every day."""
    while True:
        wait = (next_at() - datetime.now(NY)).total_seconds()
        await asyncio.sleep(max(1.0, wait))
        try:
            got = await asyncio.to_thread(sweep, store, reads_of, "clock")
            log.info("essential sheets: swept — %s", said(got))
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 - swept again at the next time
            log.warning("essential sheets: the sweep failed (%s)", type(exc).__name__)


# ---- the master's lane ---------------------------------------------------------------------------------------------

def view(reads: L.Reads) -> dict[str, Any]:
    """The tabs, each with its own last sweep (when, by the clock or the master, what came in, or why not), and the
    last sweeps whole."""
    rows = RR._q(reads, "select id, started_at, finished_at, asked_by, result from app.essential_sweeps"
                        " order by started_at desc limit 12", ())
    sweeps = [{"id": int(i), "started_at": s.isoformat() if s else "", "finished_at": f.isoformat() if f else "",
               "by": "clock" if a == "clock" else "master", "result": RR._json(r) or {}}
              for i, s, f, a, r in rows]
    tabs = []
    for r, p, t in essential():
        last = next(({"at": s["started_at"], "by": s["by"], **s["result"][r]} for s in sweeps
                     if isinstance(s["result"].get(r), dict)), None)
        tabs.append({"resource": r, "book": p, "tab": t, "last": last})
    return {"tabs": tabs, "times": list(AT), "zone": "America/New_York", "next_at": next_at().isoformat(),
            "sweeps": sweeps, "running": _RUN.locked()}


async def _the_master(request: Any) -> tuple[Any, dict[str, Any] | None]:
    """The master's own session alone, as Settings' other master lanes ask it (route_switches._master_door): the
    session's verdict is sc.is_real_master's rule taken at sign-in (an admin the sign-in names the master, never a
    session minted from it, never a visit); anyone else is told the lane does not exist."""
    import route_switches  # noqa: PLC0415
    return await route_switches._master_door(request)  # noqa: SLF001


def install(app: Any, store: Any, reads_of: Callable[[], L.Reads]) -> None:
    """GET the tabs and the last sweeps, POST to sweep now: the master's alone (_the_master)."""
    from starlette.concurrency import run_in_threadpool  # noqa: PLC0415

    async def lane(request: Request) -> Any:
        import lane_gate as LG  # noqa: PLC0415
        _s, refused = await _the_master(request)
        if refused is not None:
            return LG.answer(refused, no_store=True)
        got = await run_in_threadpool(lambda: view(reads_of()))
        return LG.answer({"status": 200, "data": got}, no_store=True)

    async def sweep_now(request: Request) -> Any:
        import lane_gate as LG  # noqa: PLC0415
        s, refused = await _the_master(request)
        if refused is not None:
            return LG.answer(refused, no_store=True)
        who = str(getattr(s, "uid", "") or "master")
        got = await run_in_threadpool(sweep, store, reads_of, who)
        log.info("essential sheets: swept now by the master — %s", said(got))
        data = await run_in_threadpool(lambda: view(reads_of()))
        return LG.answer({"status": 200, "data": {**data, "swept": got}}, no_store=True)

    app.get(LANE, include_in_schema=False)(lane)
    app.post(LANE, include_in_schema=False)(sweep_now)
