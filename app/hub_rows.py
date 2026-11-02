"""The reads the relay's modules made of the old platform's mirror, answered from asa-hub-db: a tab's rows as every
read shows them (its copy with Python's kept edits laid), a book's word on how current its copy is, the books holding
a tab, My World's owners and the action log. server/hub_rows.py asks the same reads of this module's door
(/v1/hub-rows/<action>) under the same names and answers, so a relay module moved here keeps its calls."""
from __future__ import annotations

import contextlib
import time
import hashlib
import json
import re
from typing import Any, Callable, Iterator

import gsjs
import hubdb
import locations as L
import system_logs as SLG
import world_store as WS
from scope import Defer

APP_ID = "hub-rows"
DENIED = {"status": 403, "message": "This is the relay's own door."}
# a call of the relay names at most this many tabs or books
MAX_ASKS = 32
# catalog.books.status of a copy that holds its book: the mirror's word for each was "ok"
COPIED = frozenset({"ok", "skipped_by_policy", "direct", "direct_formatted", hubdb.RECORD_STATUS})
_TABLE = re.compile(r"[a-z0-9_]{1,63}")
# the action log's cells (SysLog.gs LOGS_HEADER)
LOG_FIELDS = frozenset(SLG.LOGS_HEADER)
# the writes Python accepted and the edits it keeps (main._own), laid over a read made outside a door
OWN_OF: Callable[[], Any] | None = None

Unreadable = hubdb.Unreadable


def cell(v: Any) -> Any:
    """What data->>key gave on the mirror: text as is, any other JSON value as its JSON text, an absent key as None."""
    if v is None or isinstance(v, str):
        return v
    return json.dumps(v, ensure_ascii=False)


@contextlib.contextmanager
def _laying(db: hubdb.HubDb | None) -> Iterator[hubdb.HubDb]:
    """The reader, and Python's own writes laid over what it reads: a door's, else this moment's."""
    db = db if db is not None else hubdb.shared()
    if hubdb.OWN.get() is not None or OWN_OF is None:
        yield db
        return
    token = hubdb.OWN.set(OWN_OF())
    try:
        yield db
    finally:
        hubdb.OWN.reset(token)


def _wanted(where: dict[str, Any] | None) -> dict[str, frozenset[str]]:
    out: dict[str, frozenset[str]] = {}
    for h, v in (where or {}).items():
        vals = v if isinstance(v, list) else [v]
        out[str(h)] = frozenset(str(x) for x in vals if x is not None)
    return out


def _matches(raw: dict, wanted: dict[str, frozenset[str]]) -> bool:
    return all(cell(raw.get(h)) in vals for h, vals in wanted.items())


def _ref(db: hubdb.HubDb, sid: str, tab: str) -> hubdb.TabRef | None:
    ref = db.tab(sid, tab)
    if ref is None:
        virtual = getattr(hubdb.OWN.get(), "virtual", None)
        ref = virtual(sid, tab) if virtual is not None else None
    return ref


def _laid(sid: str, tab: str) -> tuple:
    """What Python lays over a tab now: its kept edits' newest id and count, and the writes not yet kept."""
    own = hubdb.OWN.get()
    groups = (getattr(own, "edits", None) or {}).get((sid, tab)) or ()
    ids = [eid for g in groups for (eid, _v, _b) in g["cells"].values()]
    pending = sorted(str(w.get("write_id")) + ":" + str(w.get("state")) for w in getattr(own, "items", None) or ()
                     if w.get("sheet_id") == sid and w.get("tab_name") == tab)
    return (max(ids) if ids else 0), len(ids), pending


def signature(ref: hubdb.TabRef, laid: tuple, where: Any, count: str) -> str:
    """Moves whenever the rows a read would show do: the copy's load, its headers, what is laid over it, the ask."""
    text = json.dumps([ref.table, str(ref.loaded_at or ""), ref.row_count, list(ref.headers), list(laid[:2]), laid[2],
                       where or None, count or ""], sort_keys=True, default=str)
    return hashlib.sha1(text.encode("utf-8")).hexdigest()


def _subset(db: hubdb.HubDb, ref: hubdb.TabRef, wanted: dict[str, frozenset[str]]) -> list[tuple[int, dict]]:
    """The copy's rows whose cells equal what is asked, chosen by Postgres (a giant tab never crosses whole)."""
    if ref.row_count < 0:
        return []
    if not _TABLE.fullmatch(ref.table or ""):
        raise Unreadable(f"the catalog names an unusable table for {ref.tab}")
    db.note_book(ref.sheet_id)
    cond = " and ".join("_raw->>%s = any(%s)" for _ in wanted)
    args: list[Any] = []
    for h, vals in wanted.items():
        args += [h, sorted(vals)]
    got = db.query(f'select row_number, _raw from {db.from_sql(ref)} where {cond}'  # noqa: S608
                   " order by row_number", tuple(args))
    out = []
    for rn, raw in got:
        if isinstance(raw, str):
            raw = json.loads(raw)
        out.append((int(rn), raw if isinstance(raw, dict) else {}))
    return out


def _numbered(db: hubdb.HubDb, ref: hubdb.TabRef, where: dict[str, Any] | None) -> list[tuple[int, dict]]:
    wanted = _wanted(where)
    if not wanted:
        return db.rows(ref)
    rows = _subset(db, ref, wanted)
    own = hubdb.OWN.get()
    if own is not None:
        rows = own.merge(ref, rows)
    return [(rn, raw) for rn, raw in rows if _matches(raw, wanted)]


def _counts(db: hubdb.HubDb, ref: hubdb.TabRef, column: str) -> dict[str, int]:
    _top, n, pending = _laid(ref.sheet_id, ref.tab)
    if n or pending or ref.row_count < 0 or not _TABLE.fullmatch(ref.table or ""):
        out: dict[str, int] = {}
        for _rn, raw in db.rows(ref):
            v = cell(raw.get(column))
            if v:
                out[v] = out.get(v, 0) + 1
        return out
    db.note_book(ref.sheet_id)
    got = db.query(f'select _raw->>%s, count(*) from {db.from_sql(ref)}'  # noqa: S608
                   " where coalesce(_raw->>%s, '') <> '' group by 1", (column, column))
    return {str(v): int(c) for v, c in got}


def _word(db: hubdb.HubDb, sid: str) -> dict[str, Any]:
    b = db.book(sid)
    at = db.as_of({sid})
    if b is None:
        return {"known": False, "name": "", "status": "", "modified_time": None, "synced_at": None, "as_of": at,
                "stale": True, "record": False}
    return {"known": True, "name": b.name, "status": b.status if b.status not in COPIED else "ok",
            "modified_time": hubdb._epoch(b.modified_time) or None, "synced_at": hubdb._epoch(b.synced_at) or None,
            "as_of": at, "stale": db.stale({sid}), "record": b.status == hubdb.RECORD_STATUS}


def _names(v: Any) -> list[str] | None:
    return [gsjs.js_str(x) for x in v if x is not None] if isinstance(v, list) and v else None


def _cut(got: list[tuple[int, dict]], fields: list[str] | None, sizes: list[str] | None) -> list[tuple[int, dict]]:
    """Each row with only the cells asked (`fields`), and of each cell named in `sizes` its length alone."""
    if fields is None and sizes is None:
        return got
    keep = set(fields or ()) | set(sizes or ())
    sized = set(sizes or ())
    out = []
    for rn, raw in got:
        row = {k: v for k, v in raw.items() if fields is None or k in keep}
        for k in sized:
            row[k] = len(str(cell(raw.get(k)) or ""))
        out.append((rn, row))
    return out


def _kept_resource(db: hubdb.HubDb, sid: str, tab: str) -> str | None:
    """The resource a house kept in its own table answers for (the book and tab its upload named; a house book's Data
    tab its one house), None while its copy does."""
    import resource_rows as RR  # noqa: PLC0415 - the tables the apps moved their houses into
    got = RR._q(L.Reads(db, None), f"select resource, tab_name from {RR.COLUMNS} where sheet_id = %s"
                                   " and uploaded_at is not null", (sid,))
    by_tab = {str(t): str(r) for r, t in got}
    if tab in by_tab:
        return by_tab[tab]
    return next(iter(by_tab.values())) if tab == hubdb.HOUSE_DATA_TAB and len(by_tab) == 1 else None


def _kept_answer(db: hubdb.HubDb, resource: str, word: dict[str, Any], a: dict[str, Any],
                 sig: str | None) -> dict[str, Any]:
    """One ask answered off the house's own table, in the copy's shape: each row by its position (an uploaded row's
    sheet row), its cells the text as kept; a signature that moves whenever a row is made, changed or removed."""
    import resource_rows as RR  # noqa: PLC0415
    reads = L.Reads(db, None)
    where = a.get("where") if isinstance(a.get("where"), dict) else None
    count = gsjs.js_str(a.get("count") or "")
    fields, sizes = _names(a.get("fields")), _names(a.get("sizes"))
    cols = [h for h in RR.columns(reads, resource) if h]
    facts = resource == hubdb.FACTS_RESOURCE
    # the depot's Facts: their mark and their rows as hubdb holds them per mark (read once a change, never per ask)
    marks = [[db.facts_mark()]] if facts else RR._q(
        reads, f"select count(*) filter (where removed_at is null), max(updated_at), max(created_at),"
               f" max(removed_at) from {RR.rows_of(resource)} where resource = %s", (resource,))
    mark = hashlib.sha1(json.dumps(["kept", resource, cols, list(marks[0]) if marks else [], where or None,
                                    count or ""], sort_keys=True, default=str).encode("utf-8")).hexdigest()
    word = {**word, "as_of": max(float(word.get("as_of") or 0.0), time.time())}
    if sig and sig == mark:
        return {**word, "sig": mark, "tab_known": True, "same": True}
    placed = db.rows(db.tab(hubdb.ESSENCIAL_ID, hubdb.FACTS_TAB)) if facts else \
        [(p, c) for _k, p, c in RR.placed_rows(reads, resource)]
    wanted = _wanted(where)
    if wanted:
        placed = [(p, c) for p, c in placed if _matches({h: gsjs.or_blank(c.get(h)) for h in wanted}, wanted)]
    rows = [(p, {h: gsjs.or_blank(c.get(h)) for h in cols}) for p, c in placed]
    if count:
        counts: dict[str, int] = {}
        for _rn, raw in rows:
            v = cell(raw.get(count))
            if v:
                counts[v] = counts.get(v, 0) + 1
        return {**word, "sig": mark, "tab_known": True, "rows": [], "headers": cols, "counts": counts}
    return {**word, "sig": mark, "tab_known": True, "headers": cols, "counts": {}, "rows": _cut(rows, fields, sizes)}


def _answer(db: hubdb.HubDb, a: dict[str, Any], sig: str | None = None) -> dict[str, Any]:
    """One ask answered as server/hub_rows.py hands it on: rows or counts, headers, as_of, what the copy knows and
    the book's word; `same` when the signature sent is the tab's."""
    sid, tab = gsjs.js_str(a.get("sheet_id") or ""), gsjs.js_str(a.get("tab") or "")
    if not sid or not tab:
        raise Unreadable("sheet_id and tab are required")
    where = a.get("where") if isinstance(a.get("where"), dict) else None
    count = gsjs.js_str(a.get("count") or "")
    fields, sizes = _names(a.get("fields")), _names(a.get("sizes"))
    b = _word(db, sid)
    word = {"as_of": b["as_of"], "book_known": b["known"], "book_status": b["status"]}
    resource = _kept_resource(db, sid, tab)
    if resource is not None:
        return _kept_answer(db, resource, word, a, sig)
    ref = _ref(db, sid, tab)
    if ref is None:
        return {**word, "sig": "", "tab_known": False, "rows": [], "counts": {}, "headers": []}
    mark = signature(ref, _laid(sid, tab), [where, fields, sizes], count)
    if sig and sig == mark:
        return {**word, "sig": mark, "tab_known": True, "same": True}
    if count:
        return {**word, "sig": mark, "tab_known": True, "rows": [], "headers": list(ref.headers),
                "counts": _counts(db, ref, count)}
    return {**word, "sig": mark, "tab_known": True, "headers": list(ref.headers), "counts": {},
            "rows": _cut(_numbered(db, ref, where), fields, sizes)}


# ---- the reads, as server/hub_rows.py names them ------------------------------------------------------------------

def tabs(asks: list[dict[str, Any]], *, db: hubdb.HubDb | None = None) -> list[dict[str, Any]]:
    """Each ask ({sheet_id, tab, where?, fields?, sizes?, count?}) answered: its rows [(sheet row, {header: text})] in
    sheet order (only the cells in `fields`; of each cell in `sizes`, its length) or its counts, its headers, the
    moment its book is known current (as_of, epoch seconds), whether the copy knows the tab and the book, and the
    book's word (book_status, "ok" for a copy that holds it)."""
    with _laying(db) as d:
        return [_answer(d, a) for a in asks]


def read(sheet_id: str, tab: str, where: dict[str, Any] | None = None, *, fields: list[str] | None = None,
         sizes: list[str] | None = None, db: hubdb.HubDb | None = None) -> dict[str, Any]:
    ask: dict[str, Any] = {"sheet_id": str(sheet_id), "tab": str(tab)}
    for k, v in (("where", where), ("fields", fields), ("sizes", sizes)):
        if v:
            ask[k] = v
    return tabs([ask], db=db)[0]


def numbered(sheet_id: str, tab: str, where: dict[str, Any] | None = None, *, fields: list[str] | None = None,
             sizes: list[str] | None = None, db: hubdb.HubDb | None = None) -> list[tuple[int, dict]]:
    """(sheet row, {header: text}) in sheet order, as every read shows the tab; with `where` ({header: value or
    [values]}), only the rows whose cells equal one of them."""
    return list(read(sheet_id, tab, where, fields=fields, sizes=sizes, db=db)["rows"])


def rows(sheet_id: str, tab: str, where: dict[str, Any] | None = None, *, fields: list[str] | None = None,
         sizes: list[str] | None = None, db: hubdb.HubDb | None = None) -> list[dict]:
    return [d for _rn, d in read(sheet_id, tab, where, fields=fields, sizes=sizes, db=db)["rows"]]


def counts(sheet_id: str, tab: str, column: str, *, db: hubdb.HubDb | None = None) -> dict[str, int]:
    """How many rows carry each non-blank text of one cell."""
    return dict(tabs([{"sheet_id": str(sheet_id), "tab": str(tab), "count": str(column)}], db=db)[0]["counts"])


def books(sheet_ids: list[str], *, db: hubdb.HubDb | None = None) -> dict[str, dict[str, Any]]:
    """Each book as asa_drive_sheets_meta spoke of it: known, name, status ("ok" for a copy that holds it),
    modified_time and synced_at (epoch seconds or None), as_of, stale (Drive changed it after the copy) and record."""
    d = db if db is not None else hubdb.shared()
    return {str(s): _word(d, str(s)) for s in sheet_ids}


def book(sheet_id: str, *, db: hubdb.HubDb | None = None) -> dict[str, Any]:
    return books([sheet_id], db=db)[str(sheet_id)]


def holders(tab: str, *, db: hubdb.HubDb | None = None) -> list[str]:
    """The books whose copy holds a tab of that name, the newest load first."""
    d = db if db is not None else hubdb.shared()
    cat = d.catalog()
    found = sorted(((hubdb._epoch(ref.loaded_at), sid) for (sid, t), ref in cat["tabs"].items()
                    if t == tab and sid in cat["books"]), key=lambda x: (-x[0], x[1]))
    return [sid for _at, sid in found]


def worlds(*, db: hubdb.HubDb | None = None) -> list[dict[str, str]]:
    """My World's registry (app.worlds): each world_id with its owner_user_id and owner_email."""
    reads = L.Reads(db if db is not None else hubdb.shared())
    return [{"world_id": r["world_id"], "owner_user_id": r["owner_user_id"], "owner_email": r["owner_email"]}
            for r in WS.registry_rows(reads)]


def log_lines(since: str, fields: list[str], *, db: hubdb.HubDb | None = None) -> list[dict[str, str]]:
    """The action log's lines at or after `since` (ISO text, compared as text): the logs book's history and the Hub's
    own lines (app.system_logs), each with the cells asked."""
    reads = L.Reads(db if db is not None else hubdb.shared())
    cols = [f for f in fields if f in LOG_FIELDS] or list(SLG.LOGS_HEADER)
    out: list[dict[str, str]] = []
    ref = SLG.logs_tab(reads)
    if ref is not None and ref.row_count >= 0:
        table = reads.db.from_sql(ref)
        reads.db.note_book(ref.sheet_id)
        got = reads.db.query(f"select {', '.join('_raw->>%s' for _ in cols)} from {table}"  # noqa: S608
                             " where _raw->>'timestamp' >= %s order by row_number", (*cols, since))
        out += [dict(zip(cols, ("" if v is None else str(v) for v in r))) for r in got]
    if SLG.own_kept(reads, SLG.OWN_LOGS):
        got = reads.db.query(f"select {', '.join(chr(34) + c + chr(34) for c in cols)} from {SLG.OWN_LOGS}"  # noqa: S608
                             ' where "timestamp" >= %s order by id', (since,))
        out += [dict(zip(cols, ("" if v is None else str(v) for v in r))) for r in got]
    return out


class MirrorBackend:
    """server/mirror_first.py's backend over asa-hub-db's copy: a book's vouch from its catalog word, a tab's keys
    from its first row, and only the named cells of each row."""
    VOUCH_MARGIN_S = 60.0

    def __init__(self, dsn: str = "") -> None:
        self.dsn = dsn

    def vouch_row(self, sheet_id: str, tab: str) -> dict[str, Any]:
        b, t = book(sheet_id), read(sheet_id, tab)
        at = float(b.get("as_of") or 0.0)
        return {"known": bool(b.get("known")), "status": str(b.get("status") or ""),
                "modified_time": b.get("modified_time"), "synced_at": b.get("synced_at"),
                "has_rows": bool(t["rows"]), "listed_at": at + self.VOUCH_MARGIN_S if at else None,
                "pending": [sheet_id] if b.get("stale") else [], "dirty": False, "whole_at": None}

    def tab_keys(self, sheet_id: str, tab: str) -> set[str]:
        got = read(sheet_id, tab)["rows"]
        return set(got[0][1]) if got else set()

    def tab_rows(self, sheet_id: str, tab: str,
                 headers: list[str]) -> tuple[set[str], list[tuple[int, list[Any]]]]:
        got = read(sheet_id, tab)["rows"]
        keys = set(got[0][1]) if got else set()
        return keys, [(int(rn), [cell(d.get(h)) for h in headers]) for rn, d in got]


# ---- the relay's door --------------------------------------------------------------------------------------------

def _service(sess: L.Session) -> bool:
    return bool((sess.user or {}).get("is_service"))


def _asks(p: dict, key: str) -> list | None:
    got = p.get(key)
    return got[:MAX_ASKS] if isinstance(got, list) and got else None


def tab_rows(sess: L.Session, payload: dict) -> dict[str, Any]:
    """tabRows: each tab asked ({sheet_id, tab, where?, count?, sig?}), as tabs() answers it; a tab whose signature is
    the one sent answers `same`, and one the copy cannot read is named `unread`, never served as empty."""
    if not _service(sess):
        return dict(DENIED)
    p = payload if isinstance(payload, dict) else {}
    asks = _asks(p, "asks")
    if asks is None:
        return {"status": 400, "message": "asks: a list of {sheet_id, tab} is required."}
    db = sess.reads.db
    answers: list[dict[str, Any]] = []
    for a in asks:
        a = a if isinstance(a, dict) else {}
        try:
            got = _answer(db, a, str(a.get("sig") or ""))
        except (Defer, Unreadable) as why:
            answers.append({"unread": str(why) or type(why).__name__})
            continue
        answers.append({**got, "rows": [[rn, raw] for rn, raw in got.get("rows") or []]} if "rows" in got else got)
    return {"status": 200, "data": {"answers": answers}}


def book_words(sess: L.Session, payload: dict) -> dict[str, Any]:
    """bookWords: each book asked, as books() answers it."""
    if not _service(sess):
        return dict(DENIED)
    sids = _asks(payload if isinstance(payload, dict) else {}, "sheet_ids")
    if sids is None:
        return {"status": 400, "message": "sheet_ids: a list of book ids is required."}
    return {"status": 200, "data": {"books": books([gsjs.js_str(s) for s in sids], db=sess.reads.db)}}


def tab_holders(sess: L.Session, payload: dict) -> dict[str, Any]:
    """tabHolders: the books holding a tab of that name, the newest load first."""
    if not _service(sess):
        return dict(DENIED)
    tab = gsjs.js_str((payload or {}).get("tab") or "")
    if not tab:
        return {"status": 400, "message": "tab is required."}
    return {"status": 200, "data": {"holders": [{"sheet_id": s} for s in holders(tab, db=sess.reads.db)]}}


def world_owners(sess: L.Session, payload: dict) -> dict[str, Any]:
    """worldOwners: My World's registry, each world and its owner."""
    if not _service(sess):
        return dict(DENIED)
    return {"status": 200, "data": {"worlds": worlds(db=sess.reads.db)}}


def log_window(sess: L.Session, payload: dict) -> dict[str, Any]:
    """logWindow: the action log's lines at or after `since`, with the cells named in `fields`."""
    if not _service(sess):
        return dict(DENIED)
    p = payload if isinstance(payload, dict) else {}
    since = gsjs.js_str(p.get("since") or "")
    if not since:
        return {"status": 400, "message": "since is required."}
    fields = [gsjs.js_str(f) for f in p.get("fields") or [] if f]
    return {"status": 200, "data": {"lines": log_lines(since, fields, db=sess.reads.db)}}


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {
    "tabRows": tab_rows, "bookWords": book_words, "tabHolders": tab_holders, "worldOwners": world_owners,
    "logWindow": log_window}
# the relay's own identity alone; each door answers everyone else itself
POLICY: dict[str, dict[str, Any]] = {
    "tabRows": {"params": {"asks": "array"}}, "bookWords": {"params": {"sheet_ids": "array"}},
    "tabHolders": {"params": {"tab": "string"}}, "worldOwners": {},
    "logWindow": {"params": {"since": "string", "fields": "array"}}}
