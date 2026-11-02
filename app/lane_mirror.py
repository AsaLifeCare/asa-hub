"""The lane mirrors on Python (LaneMirror.gs laneMirrorOne_, laneMirrorSweepMaybe_ and laneMirrorAfterFiling_): each
lane's house holds the newest rows of its estate book — the incidents, the support queue, the daily notes and the
call-off form's clone — so what is ours is in our own database. The estate book is read off asa-hub-db's copy (the
rows Python's own doors filed laid over it), and a house is rewritten whole, as laneMirrorOne_ rewrote it, by a book
op (app/book_ops.py `mirror`) whenever those newest rows are not the ones it was last rewritten from: its rows have no
key a kept edit could find them by, so the op carries the rows themselves and asa-hub-sheet-sync writes them into the
house's Data tab in one request (apply, below). The look (laneMirrorDue) plans; app/lane_mirror_writes.py queues."""
from __future__ import annotations

import hashlib
import json
from typing import Any, Callable

import book_ops as BO
import clock_sweeps as CS
import gsjs
import house_tables as HT
import hubdb
import locations as L
import resource_rows as RR
import writes as W

APP_ID = "lane-mirror"
# LANE_MIRRORS: the house each resource is copied into and the newest rows it keeps; a clone names its own source
MIRRORS: dict[str, dict[str, Any]] = {
    "uiIncidents": {"prop": "HUB_HOUSE_UIINCIDENTS_ID", "keep": 100},
    "supportQueue": {"prop": "HUB_HOUSE_SUPPORTQUEUE_ID", "keep": 500},
    "dailyNotes": {"prop": "HUB_HOUSE_DAILYNOTES_ID", "keep": 500},
    "cloneCallOffs": {"prop": "HUB_HOUSE_CLONECALLOFFS_ID", "keep": 1000,
                      "source": {"prop": "ESTATE_CALLOFFS_ID", "tab": "Master"}}}
# Estate.gs ESTATE_SOURCES (estateSource_) for the three lanes the mirror reads through it
ESTATE_SOURCES = {"uiIncidents": ("ESTATE_UI_ID", "UIs and MUIs"), "supportQueue": ("EMP360_WORK_QUEUE_ID", "Requests"),
                  "dailyNotes": ("ESTATE_NOTES_ID", "Notes")}
# LANE_MIRROR_TAB: the relay reads a house from this tab and no other
HOUSE_TAB = "Data"
# LANE_MIRROR_EVERY_S, the sweep's script-cache key
EVERY_S = 600
THROTTLE_KEY = "lane_mirror_ran"
# Hotline.gs: what a filing pass mirrors after it files
AFTER_FILING = ("uiIncidents", "supportQueue", "dailyNotes")
LOG_BY = "asa-hub:lanemirror"
OP = "mirror"
# a house kept in its own table: its rows rewritten there, in this write
TABLE_OP = "table"

s_ = gsjs.str_


def subject(resource: str) -> str:
    """The book op's subject: one house's rewrite at a time."""
    return "lanemirror:" + resource


def _value(raw: Any) -> Any:
    """The cell getValues() hands back, as the copy keeps it: a linked cell's text alone."""
    return hubdb.typed(raw, "raw")


def _blank(raw: Any) -> bool:
    v = _value(raw)
    return v == "" or v is None


def _body(reads: L.Reads, ref: hubdb.TabRef) -> list[dict]:
    """getDataRange().getValues() after its header: every sheet row from the second to the last that holds anything,
    a row the copy lacks as an empty one; each row the copy's own cells by header."""
    by: dict[int, dict] = {}
    last = 1
    for rn, raw in reads.db.rows(ref):
        by[rn] = raw
        if rn > last and any(not _blank(v) for v in raw.values()):
            last = rn
    return [by.get(rn) or {} for rn in range(2, last + 1)]


def _source(reads: L.Reads, resource: str, spec: dict) -> tuple[str, str] | None:
    """A clone's own source, else estateSource_; None when its id is not declared."""
    own = spec.get("source")
    try:
        if own:
            sid, tab = gsjs.or_text(reads.db.prop(own["prop"])), s_(own.get("tab"))
        else:
            prop, tab = ESTATE_SOURCES.get(resource) or ("", "")
            sid = gsjs.or_text(reads.db.prop(prop)) if prop else ""
    except hubdb.Unreadable:
        raise
    except Exception:  # noqa: BLE001 - laneMirrorOne_'s catch: an undeclared source
        return None
    return (sid, tab) if sid else None


def fingerprint(header: list[str], rows: list[list[str]]) -> str:
    """What a rewrite carries, in one word: the same rows twice are one rewrite."""
    return hashlib.sha256(json.dumps([header, rows], ensure_ascii=False).encode("utf-8")).hexdigest()[:32]


def last_rewrite(reads: L.Reads, resource: str) -> tuple[str, str] | None:
    """The newest rewrite of this house queued: (its fingerprint, its state); None before the first. The copy shows
    a house through its own cell formats (a timestamp as its day, a clock as 30 Dec 1899), so the house is never set
    beside the book itself: the rows it was last rewritten from are."""
    got = RR._q(reads, f"select spec ->> 'fingerprint', state from {BO.table()} where subject = %s and op = %s"
                       " order by id desc limit 1", (subject(resource), OP))
    return (gsjs.or_blank(got[0][0]), gsjs.or_blank(got[0][1])) if got else None


def mirror_one(reads: L.Reads, resource: str, done: set[str]) -> tuple[dict[str, Any], dict | None]:
    """laneMirrorOne_ up to the house's rewrite: (what the pass says of it, the book op when the house differs)."""
    out: dict[str, Any] = {"resource": gsjs.or_text(resource), "rows": 0, "state": "skipped", "why": ""}
    spec = MIRRORS.get(out["resource"])
    if not spec:
        out["why"] = "no mirror is declared for this resource"
        return out, None
    if out["resource"] in done:
        out["state"] = "already"
        return out, None
    src = _source(reads, out["resource"], spec)
    if src is None:
        out["why"] = "the estate source for this resource is not declared"
        return out, None
    try:
        house = gsjs.or_text(reads.db.prop(spec["prop"]))
    except hubdb.Unreadable:
        raise
    except Exception:  # noqa: BLE001 - laneMirrorOne_'s catch: an undeclared house
        house = ""
    if not house:
        out["why"] = spec["prop"] + " is not in the depot — the house is not declared"
        return out, None
    sid, tab = src
    if reads.db.book(sid) is None:
        out["state"] = "unread"
        out["why"] = "the estate book could not be read: asa-hub-db holds no copy of it"
        return out, None
    ref = reads.db.tab(sid, tab)
    if ref is None:
        out["why"] = 'the estate book has no tab called "' + tab + '"'
        return out, None
    body = _body(reads, ref)
    if not body:
        # Never copy an emptiness: a header-only source leaves the standing mirror untouched.
        out["state"] = "empty_source"
        out["why"] = "the estate book answered with no rows — the house was left as it stands"
        return out, None
    kept = body[len(body) - spec["keep"]:] if len(body) > spec["keep"] else body
    tabled = HT.tabled(out["resource"])
    if not tabled and reads.db.book(house) is None:
        out["state"] = "unwritten"
        out["why"] = "the house could not be written: asa-hub-db holds no copy of it"
        return out, None
    dest = reads.db.tab(house, HOUSE_TAB)
    if dest is None and not tabled:
        # A missing Data tab is reported, never created here: shaping a house is the mint's job.
        out["state"] = "no_house_tab"
        out["why"] = 'the house has no "' + HOUSE_TAB + '" tab — mint it before it can be mirrored'
        return out, None
    heads = list(ref.headers)
    out["rows"] = len(kept)
    out["state"] = "mirrored"
    out["why"] = (f"the newest {len(kept)} of {len(body)} rows" if len(body) > len(kept)
                  else f"{len(kept)} row(s), the whole book")
    done.add(out["resource"])
    header = [hubdb.twin_base(gsjs.js_str(h)) for h in heads]
    rows = [[W.sheet_text(_value(r.get(h))) for h in heads] for r in kept]
    if tabled:
        # a house kept in its own table: rewritten there (house_tables.rewrite writes only what differs)
        return out, {"op": TABLE_OP, "tab": out["resource"], "lines": [dict(zip(header, r)) for r in rows]}
    mark = fingerprint(header, rows)
    last = last_rewrite(reads, out["resource"])
    if last is not None and last[0] == mark and last[1] in ("pending", "applying", "done"):
        out["held"] = True
        return out, None
    return out, {"op": OP, "sheet_id": house, "tab": dest.tab,
                 "spec": {"resource": out["resource"], "fingerprint": mark, "header": header, "rows": rows}}


def mirror_all(reads: L.Reads, resources: Any) -> tuple[list[dict], list[dict]]:
    """Each named mirror in turn, a fault of one said on its own line: (the lines, the book ops)."""
    lines: list[dict] = []
    ops: list[dict] = []
    done: set[str] = set()
    for r in resources:
        try:
            line, op = mirror_one(reads, r, done)
        except hubdb.Unreadable:
            raise
        except Exception as exc:  # noqa: BLE001 - laneMirrorSweepMaybe_'s catch: this mirror's own line
            line, op = {"resource": gsjs.or_text(r), "state": "failed", "why": str(exc) or type(exc).__name__}, None
        lines.append(line)
        if op is not None:
            ops.append(op)
    return lines, ops


def mirror_due(sess: L.Session, payload: dict) -> dict[str, Any]:
    """laneMirrorDue: the relay's look before laneMirrorSweep — nothing while the sweep's key holds, else what each
    mirror would rewrite."""
    if not CS.service(sess):
        return dict(CS.DENIED)
    reads = sess.reads
    if CS.held(reads, THROTTLE_KEY):
        return {"status": 200, "data": {"due": False, "skipped": "checked recently"}}
    lines, ops = mirror_all(reads, list(MIRRORS))
    return {"status": 200, "data": {"due": True, "mirrored": lines, "rewrites": [named(o) for o in ops]}}


def named(op: dict) -> str:
    """The mirror an op rewrites: a book op's spec names it, a table rewrite its house."""
    return op["tab"] if op.get("op") == TABLE_OP else op["spec"]["resource"]


# ---- asa-hub-sheet-sync's side: the op carried (book_ops.apply) ---------------------------------------------------

def rewrite(have: list[list[Any]], spec: dict) -> list[list[str]]:
    """dest.clearContents() and setValues(): the house's Data tab as the op leaves it, over every cell it holds now —
    the house's own column order kept, a column the book lacks emptied, one the house lacks added after its own."""
    header = [gsjs.or_blank(h) for h in spec.get("header") or []]
    keys = [gsjs.trim(h) for h in header]
    rows = [list(r) for r in spec.get("rows") or []]
    live = [gsjs.trim(gsjs.or_blank(h)) for h in (have[0] if have else [])]
    cols: list[int | None] = [keys.index(h) if h and h in keys else None for h in live]
    cols += [i for i, k in enumerate(keys) if k and k not in live]
    width = max(len(cols), max((len(r) for r in have), default=0))
    pad = [""] * (width - len(cols))
    out = [[header[c] if c is not None else "" for c in cols] + pad]
    for r in rows:
        out.append([gsjs.or_blank(r[c]) if c is not None and c < len(r) else "" for c in cols] + pad)
    out += [[""] * width for _ in range(max(len(rows) + 1, len(have)) - len(out))]
    return out


def apply(sheets: Any, op: dict, quote: Callable[[str], str], entered: Callable[[Any], str]) -> tuple[str, str]:
    """One house rewritten in one request, as laneMirrorOne_ rewrote it: ('done' | 'refused', why). A Google error
    is raised for the sync to retry."""
    sid, tab, spec = op["sheet_id"], op["tab"], op["spec"]
    props = sheets.sheet_props(sid)
    if tab not in props and spec.get("create") is True:
        # a rewrite that makes its tab (app/prefs_doors_writes.py, app/members_writes.py): added as hubTabEnsure_
        # inserts it, then written
        sheets.structure(sid, [{"addSheet": {"properties": {"title": tab}}}])
        props = sheets.sheet_props(sid)
    if tab not in props:
        return "refused", 'the house has no "' + tab + '" tab — mint it before it can be mirrored'
    have = sheets.batch_get(sid, [quote(tab)])[0]
    matrix = rewrite(have, spec)
    need = len(matrix) - int(props[tab].get("rows") or 0)
    grid = {"sheetId": props[tab]["id"], "gridProperties": {"frozenRowCount": 1}}
    requests: list[dict] = [{"updateSheetProperties": {"properties": grid, "fields": "gridProperties.frozenRowCount"}}]
    if need > 0:
        requests.insert(0, {"appendDimension": {"sheetId": props[tab]["id"], "dimension": "ROWS", "length": need}})
    sheets.structure(sid, requests)
    sheets.batch_update(sid, [{"range": f"{quote(tab)}!A1", "values": [[entered(c) for c in r] for r in matrix]}])
    rows = len(spec.get("rows") or [])
    return "done", f"{s_(spec.get('resource'))}: {rows} row(s) written over {len(have)} line(s)"


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {"laneMirrorDue": mirror_due}
POLICY: dict[str, dict[str, Any]] = {"laneMirrorDue": {}}
