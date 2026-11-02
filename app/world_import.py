"""My World copied once out of the sheets into Postgres (app/world_store.py): every world the registry (user_worlds)
names, with every tab of its workbook, exactly as My World served them from asa-hub-db's copy — Python's kept edits
laid on the registry, the `rows` book ops not read back yet laid on each tab (app/app_builder.py's view_at). A world
already in Postgres is never touched, so a run again adds nothing; the registry is marked copied, and My World's doors
answer, once every world it names is."""
from __future__ import annotations

from typing import Any

import app_builder as AB
import gsjs
import hubdb
import locations as L
import world_store as WS
from scope import Defer
from writes import Decision

ACTION = "worldImport"
REGISTRY_TAB = "user_worlds"
WITHHELD = "[withheld"

s_ = gsjs.str_


def workbook(reads: L.Reads, sid: str) -> list[AB.View]:
    """bundleReadWorld_'s tabs: every tab the copy holds of the workbook and every one a write made since, each as My
    World read it."""
    known = reads.db.book(sid) is not None
    made = {t for (s, t) in AB._ops(reads) if s == sid}
    if not known and not made:
        raise hubdb.Unreadable("asa-hub-db holds no copy of this world's workbook")
    if known:
        reads.db.note_book(sid)
    names = {t for (s, t) in reads.db.catalog()["tabs"] if s == sid} | made
    out = []
    for name in sorted(names):
        v = AB.view_at(reads, sid, name, reads.db.tab(sid, name) if known else None)
        if not v.exists:
            continue
        if any(isinstance(x, str) and x.startswith(WITHHELD) for r in v.rows for x in r.values()):
            raise Defer(f"the copy of {name} withholds a cell, so this world is not copied")
        out.append(v)
    return out


def door(sess: L.Session, payload: dict) -> Decision:
    """worldImport: the relay's own identity copies the registry's worlds (`world`: that one alone) into Postgres;
    a world the copy cannot be read for is named and left for a run again."""
    if (sess.user or {}).get("is_service") is not True:
        return Decision({"status": 403, "message": "The import is the relay's alone."})
    p = payload if isinstance(payload, dict) else {}
    only = s_(p.get("world"))
    reads = sess.reads
    res = reads.db.resolve(REGISTRY_TAB)
    if res.runtime or (res.ref is None and not res.book_known):
        raise hubdb.Unreadable("asa-hub-db holds no copy of the world registry")
    out: dict[str, Any] = {"copied": [], "kept": [], "skipped": [], "tabs": 0, "rows": 0}
    blocked = False
    seen: set[str] = set()
    for r in reads.db.sheetdb_rows(res.ref):
        wid, sid = s_(r.get("world_id")), s_(r.get("spreadsheet_id"))
        if only and wid != only:
            continue
        if not wid or not s_(r.get("owner_user_id")):
            out["skipped"].append({"world": wid, "why": "the row names no world or no owner"})
            continue
        if wid in seen or WS.known(reads, wid):
            out["kept"].append(wid)
            continue
        seen.add(wid)
        try:
            tabs = workbook(reads, sid) if sid else []
        except (hubdb.Unreadable, Defer) as why:
            blocked = True
            out["skipped"].append({"world": wid, "why": str(why)})
            continue
        n = WS.import_world({k: r.get(k) for k in WS.FIELDS}, tabs, sid or "world:" + wid)
        out["copied"].append(wid)
        out["tabs"] += n["tabs"]
        out["rows"] += n["rows"]
    source = WS.REGISTRY + res.sheet_id
    before = WS.imported(reads, source)
    marked = not only and not blocked and not before
    if marked:
        WS.mark(source, "", {k: len(v) if isinstance(v, list) else v for k, v in out.items()})
    out["ready"] = before or marked
    answer = {"status": 200, "data": out}
    return Decision(answer, own=True, subject="") if out["copied"] or marked else Decision(answer)
