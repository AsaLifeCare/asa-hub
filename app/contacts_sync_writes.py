"""peopleSyncFromPlatform (apps-script/ContactsSync.gs) decided off asa-hub-db: the platform's contact list — the
relay's hourly hand-off, or an admin's press in Settings — reconciled into the People house by id, each refreshed row's
changed cells and each added row kept in app.edits as the truth, final; never a row removed, another lane's row, nor the
Hub's own avatar and guardian_for. A pass keeps what fits its budget and hands the rows it did not reach back (`left`);
the pass that reaches the end stamps the platform list's time in app.contacts_sync_state, a void putting it back."""
from __future__ import annotations

import time
from typing import Any, Callable

import contacts_sync as CS
import gsjs
import house_tables as HT
import hubdb
import locations as L
import resource_rows as RR
import smart_comms as SCM
import staff_views
import writes as W
from writes import Decision

BUSY = "The roster sync is already running."
UNREAD = "The People house did not answer — nothing was written."
# hubSysLog_'s actor for the relay's own hand-off
ACTOR = "asa-hub:contacts"
# inside the write's own budget: the reconcile's time, and the cells app.edits takes in one record
PASS_S = 4.0
CELLS_MAX = 1500

s_ = gsjs.str_


def _set_state(key: str, value: str) -> None:
    """hubPropSet_ on app.contacts_sync_state, the value replaced kept for a void."""
    RR._cur().execute(
        f"insert into {CS.STATE} as s (key, value, prev, write_id) values (%s, %s, '', %s)"
        " on conflict (key) do update set prev = s.value, value = excluded.value, write_id = excluded.write_id,"
        " updated_at = now()", (key, value, SCM.write_id()))


def _runs(rns: list[int]) -> int:
    """The setValues Apps Script makes for the refreshed rows: one per run of adjacent sheet rows."""
    n, last = 0, None
    for rn in sorted(rns):
        if last is None or rn != last + 1:
            n += 1
        last = rn
    return n


def sync(sess: L.Session, payload: dict) -> Decision:
    """peopleSyncFromPlatform: the relay's identity or an admin; the rows reconciled into the People house by id, the
    rows a pass did not reach in time handed back as `left`."""
    started = time.monotonic()
    user = sess.user or {}
    machine = user.get("is_service") is True
    p = payload if isinstance(payload, dict) else {}
    if p.get("rows") is None or p.get("rows") == "":
        return W.refuse(400, "Missing required parameter: rows.")
    if not machine and s_(user.get("role")) != "admin":
        return Decision(dict(CS.DENIED))
    rows = p.get("rows")
    if not isinstance(rows, list) or not rows:
        return W.refuse(400, "No rows — the roster is left as it is.")
    reads = sess.reads
    if not CS.source_enabled(reads):
        return Decision({"status": 200, "data": {"skipped": "ops_employees is switched off in roster_sources",
                                                 "received": len(rows)}})
    res = W.tab_of(reads, CS.PEOPLE_TAB)
    # the house's rows as they stand: its own table once kept there
    held = HT.where(reads, CS.PEOPLE_TAB).ref
    if held is None:
        return W.refuse(503, UNREAD)
    sid, tab = W.where_of(res)
    # ensureHeader_: the house's own header, then the declared columns it lacks
    have = [h for h in (gsjs.js_str(x) for x in held.headers) if h != ""]
    header = have + [k for k in CS.PEOPLE_HEADER if k not in have]
    raws = HT.tab_rows(reads, held)
    grid = [{h: CS.cstr(hubdb.typed(raw.get(h), "hub")) for h in header} for _rn, raw in raws]
    w = CS.Words(reads)

    def stop(out: dict) -> bool:
        return out["cells"] >= CELLS_MAX or time.monotonic() - started > PASS_S

    rec = CS.reconcile(header, grid, rows, w, stop)
    if rec.get("error"):
        return W.refuse(400, rec["error"])
    left = rows[rec["consumed"]:]
    edits: list[dict] = []
    for at, cells in sorted(rec["changed"].items()):
        raw = raws[at][1]
        edits.append(W.kept_record(sid, tab, "edit", "id", grid[at]["id"], "", cells,
                                   {f: raw.get(f) for f in cells}))
    for line in rec["appended"]:
        edits.append(W.kept_record(sid, tab, "append", "id", line["id"], "",
                                   {h: v for h, v in line.items() if v != ""}))
    writes = _runs([raws[at][0] for at in rec["changed"]]) + (1 if rec["appended"] else 0)
    source_at = s_(p.get("source_at"))
    stamped = bool(source_at) and not left
    if stamped:
        _set_state(CS.SOURCE_STAMP, source_at)
    named = rec["refused_named"]
    summary = (f"{rec['updated']} roster row(s) refreshed, {rec['inserted']} added, {rec['unchanged']} unchanged, "
               f"{rec['foreign']} owned by another lane, {rec['refused']} refused by the filter, {rec['unnamed']} "
               f"unnamed — {writes} write(s)" + (f", platform list as of {source_at}" if source_at else "")
               + (" · refused: " + " · ".join(named[:8]) if named else ""))
    if rec["updated"] or rec["inserted"] or rec["refused"]:
        staff_views.record({"email": ACTOR} if machine else user, "people_sync_platform", summary)
    data: dict[str, Any] = {"updated": rec["updated"], "inserted": rec["inserted"], "unchanged": rec["unchanged"],
                            "foreign": rec["foreign"], "unnamed": rec["unnamed"], "refused": rec["refused"],
                            "refused_named": named, "writes": writes, "received": rec["consumed"],
                            "source_at": source_at}
    if left:
        data["left"] = left
    answer = {"status": 200, "data": data}
    kept = [e for e in edits if e and e.get("cells")]
    if not kept and not stamped:
        return Decision(answer)
    return Decision(answer, edits=kept or None, subject="", own=stamped)


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {"peopleSyncFromPlatform": sync}
# HUB_POLICY.peopleSyncFromPlatform: an admin's, or the relay's identity; rows required, an array
POLICY: dict[str, dict[str, Any]] = {"peopleSyncFromPlatform": {"roles": ("admin",), "params": {"rows": "array"}}}
BUSY_OF: dict[str, dict[str, Any]] = {"peopleSyncFromPlatform": {"status": 409, "message": BUSY}}


class Store(RR.Store):
    """app.contacts_sync_writes and _receipts; the People house's cells app.edits', the stamp app.contacts_sync_state —
    a void takes a pass's cells back and puts the stamp where it was."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="contacts_sync", label="Contacts sync")

    def settle(self, write_id: str, state: str, why: str = "", fields: list[str] | None = None) -> bool:
        done = super().settle(write_id, state, why, fields)
        if state == "void" and done:
            try:
                with self.conn().transaction():
                    self.conn().execute(f"update {CS.STATE} set value = prev, write_id = '', updated_at = now()"
                                        " where write_id = %s", (write_id,))
            except Exception as exc:  # noqa: BLE001 - said, never raised into the relay's settle
                W.log.warning("contacts sync: the void of %s left the stamp (%s)", write_id[:40], type(exc).__name__)
        return done
