"""The relay's sheet-mode slices (BulkRead.gs bulkTabsRead_, the `tabs` read) off asa-hub-db: each tab as
readTabRawKeys_ hands it — a dissolved hiring tab from the runtime's facts, a moved tab from its house, a tab its app
keeps in Postgres from there (sheet_resources.kept_rows) — with the moment the copy is known to hold what the sheet
held."""
from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any, Callable

import candidates as CND
import gsjs
import hubdb
import locations as L
import sheet_resources as SR
from scope import Defer

APP_ID = "sheet-tabs"
ACTION = "sheetTabs"
# a pass of the relay asks every sheet slice it serves at once (BulkRead.gs BULK_MAX_TABS paged Apps Script's)
MAX_TABS = 64
DENIED = {"status": 403, "message": "This is the relay's own door."}
_NOT_WORD = re.compile(r"[^A-Za-z0-9]+")


def raw_keys(db: hubdb.HubDb, ref: hubdb.TabRef, utc: bool) -> list[dict[str, Any]]:
    """readTabRawKeys_: each header trimmed, a Date as cellText_ in a UTC book and as estateCell_ elsewhere, every
    other cell as getValues() hands it back; rows of nothing but blanks dropped."""
    heads = [(gsjs.trim(gsjs.js_str(h)), h) for h in ref.headers]
    out = []
    for _rn, raw in db.rows(ref):
        vals = [(name, hubdb.typed(raw.get(src), "hub")) for name, src in heads]
        if all(v == "" or v is None for _n, v in vals):
            continue
        row: dict[str, Any] = {}
        for name, v in vals:
            if not name:
                continue
            if isinstance(v, (hubdb.SheetDate, hubdb.SheetTime)):
                v = hubdb.cell_text(v) if utc else hubdb.estate_cell(v)
            row[name] = v
        out.append(row)
    return out


def legacy_raw(reads: L.Reads, tab: str) -> list[dict] | None:
    """hiringLegacyRawRows_: the dissolved tab's rows under the headers the tab had; None when the facts hold none."""
    rows = CND.legacy_rows(reads, tab)
    if rows is None:
        return None
    hdr = CND.legacy_header(reads, tab)
    if not hdr:
        return rows
    back = {_NOT_WORD.sub("", gsjs.js_str(h)).lower(): gsjs.js_str(h) for h in hdr}
    return [{back.get(k, k): v for k, v in r.items()} for r in rows]


def tab_rows(reads: L.Reads, tab: str) -> tuple[list[dict], set[str]]:
    """bulkTabsRead_ for one tab: its rows, and the books they were read from ([] for a tab no book holds)."""
    kept = SR.kept_rows(reads, tab)
    if kept is not None:
        return kept, set()
    db = reads.db
    if db.dissolved(tab):
        moved = legacy_raw(reads, tab)
        if moved is not None:
            return moved, set()
        # no facts yet: the tab as HUB_DB still holds it
        hub = db.prop("HUB_DB_ID")
        ref = reads.tab_of(hub, tab, "HUB_DB") if hub else None
        return (raw_keys(db, ref, True), {hub}) if ref is not None else ([], set())
    res = db.resolve(tab)
    if res.ref is None:
        if res.sheet_id and not res.book_known:
            raise hubdb.Unreadable(f"asa-hub-db holds no copy of the book behind {tab}")
        return [], set()
    return raw_keys(db, res.ref, res.sheet_id == db.prop("HUB_DB_ID")), {res.sheet_id}


def sheet_tabs(sess: L.Session, payload: dict) -> dict[str, Any]:
    """sheetTabs: the tabs named, each read on its own; one the copy cannot answer is named in `unread`, never served
    as empty. `read_at` is when every book read was known to hold what Google held."""
    if not (sess.user or {}).get("is_service"):
        return dict(DENIED)
    p = payload if isinstance(payload, dict) else {}
    names = p.get("tabs")
    if not isinstance(names, list) or not names:
        return {"status": 400, "message": "tabs: a list of tab names is required."}
    reads = sess.reads
    tabs: dict[str, list[dict]] = {}
    unread: dict[str, str] = {}
    books: set[str] = set()
    for name in names[:MAX_TABS]:
        tab = gsjs.js_str(name)
        try:
            rows, read = tab_rows(reads, tab)
        except (Defer, hubdb.Unreadable) as why:
            unread[tab] = str(why) or type(why).__name__
            continue
        tabs[tab] = rows
        books |= read
    at = reads.db.as_of(books) if books else datetime.now(timezone.utc).timestamp()
    return {"status": 200, "data": {"tabs": tabs, "unread": unread, "truncated": len(names) > MAX_TABS,
                                    "read_at": gsjs.iso(datetime.fromtimestamp(at, timezone.utc))}}


# ---- the record books as every read sees them, for the relay's master JSON (server/master_json.py RecordSource) ----

RECORD_ACTION = "recordTabs"
# the parts of a tab are counted off its last row as the read lays it: (copy's load, kept edits' newest and count) → row
_LAST_ROW: dict[tuple[str, str], tuple[tuple, int]] = {}


def _groups(sid: str, tab: str) -> list[dict]:
    own = hubdb.OWN.get()
    return list((getattr(own, "edits", None) or {}).get((sid, tab)) or ())


def _mark(groups: list[dict]) -> tuple[int, int]:
    """The kept edits laid over a tab: the newest edit's id and how many cells, which move whenever one is kept."""
    ids = [eid for g in groups for (eid, _v, _b) in g["cells"].values()]
    return (max(ids) if ids else 0), len(ids)


def _ref(db: hubdb.HubDb, sid: str, tab: str) -> hubdb.TabRef | None:
    ref = db.tab(sid, tab)
    if ref is None:
        virtual = getattr(hubdb.OWN.get(), "virtual", None)
        ref = virtual(sid, tab) if virtual is not None else None
    return ref


def record_marks(db: hubdb.HubDb) -> dict[str, Any]:
    """Every record book (catalog status `record`): its name, and per tab its rows' signature — the copy's load and
    the kept edits laid over it — and its last row as a read lays it."""
    cat = db.catalog()
    books = {sid: b for sid, b in cat["books"].items() if b.status == hubdb.RECORD_STATUS}
    own = hubdb.OWN.get()
    edited = {k for k in (getattr(own, "edits", None) or {}) if k[0] in books}
    out: dict[str, Any] = {}
    for sid, b in books.items():
        names = [t for (s, t) in cat["tabs"] if s == sid]
        names += sorted(t for (s, t) in edited if s == sid and t not in names)
        refs: dict[str, tuple[hubdb.TabRef, tuple]] = {}
        for tab in names:
            ref = _ref(db, sid, tab)
            if ref is not None:
                top, n = _mark(_groups(sid, tab))
                refs[tab] = (ref, (str(ref.loaded_at or ""), ref.row_count, top, n))
        # a tab no edit is laid over: its copy's last row, every such tab of the book asked at once
        bare = [t for t, (ref, sig) in refs.items() if not sig[3] and ref.row_count >= 0
                and (_LAST_ROW.get((sid, t)) or ((),))[0] != sig and re.fullmatch(r"[a-z0-9_]{1,63}", ref.table)]
        if bare:
            sql = " union all ".join(f'select %s, max(row_number), count(*) from {db.from_sql(refs[t][0])}'  # noqa: S608
                                     for t in bare)
            for tab, last, n in db.query(sql, tuple(bare)):
                _LAST_ROW[(sid, tab)] = (refs[tab][1], int(last or 0), int(n or 0))
        tabs = []
        for tab, (ref, sig) in refs.items():
            held = _LAST_ROW.get((sid, tab))
            if held is None or held[0] != sig:
                # the edits laid: the row a read numbers last
                rows = db.rows(ref)
                held = (sig, max((rn for rn, _r in rows), default=0), len(rows))
                _LAST_ROW[(sid, tab)] = held
            tabs.append({"tab": tab, "sig": "|".join(str(x) for x in sig), "last_row": held[1], "rows": held[2],
                         "loaded_at": str(ref.loaded_at or ""), "headers": list(ref.headers)})
        out[sid] = {"name": b.name, "synced_at": str(b.synced_at or ""), "tabs": tabs}
    return out


def record_tabs(sess: L.Session, payload: dict) -> dict[str, Any]:
    """recordTabs, the relay's own: with `marks`, every record book's tabs and their signatures; with `sheet_id` and
    `tab`, that tab's rows as the copy keeps them (each header's text), the kept edits laid — what every read shows."""
    if not (sess.user or {}).get("is_service"):
        return dict(DENIED)
    p = payload if isinstance(payload, dict) else {}
    db = sess.reads.db
    if p.get("marks") is True:
        return {"status": 200, "data": {"books": record_marks(db)}}
    sid, tab = gsjs.js_str(p.get("sheet_id") or ""), gsjs.js_str(p.get("tab") or "")
    if not sid or not tab:
        return {"status": 400, "message": "marks, or sheet_id and tab, are required."}
    b = db.book(sid)
    if b is None or b.status != hubdb.RECORD_STATUS:
        return {"status": 404, "message": "Not a book Postgres keeps the record of."}
    ref = _ref(db, sid, tab)
    if ref is None:
        return {"status": 404, "message": "No such tab."}
    return {"status": 200, "data": {"sheet_id": sid, "tab": tab, "headers": list(ref.headers),
                                    "rows": [[rn, raw] for rn, raw in db.rows(ref)]}}


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {ACTION: sheet_tabs, RECORD_ACTION: record_tabs}
# the relay's own identity alone; the door answers everyone else itself
POLICY: dict[str, dict[str, Any]] = {ACTION: {"params": {"tabs": "array"}},
                                     RECORD_ACTION: {"params": {"marks": "boolean", "sheet_id": "string",
                                                                "tab": "string"}}}
