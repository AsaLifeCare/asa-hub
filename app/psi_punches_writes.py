"""The PsiAnywhere feeds' writes (PsiPunches.gs psiPunchesIngest, psiPunchesFullIngest), the relay's alone: the
staff-hours house upserted in Postgres (app.resource_rows `psiPunches`), the full punch sheet — a house other readers
need as a sheet — by the cells that moved, kept in app.edits. Upserted by id, never deleted: the house is the only
readable copy of the stored rows, and a pass that changes nothing writes nothing."""
from __future__ import annotations

import logging
from typing import Any, Callable

import behavior as B
import candidate_papers as CP
import gsjs
import hubdb
import locations as L
import psi_punches as PP
import resource_rows as RR
import screening as SG
import staff_views
import writes as W
from writes import Decision

log = logging.getLogger("asa-hub-app")

s_ = gsjs.str_
LOGGER = {"email": "asa-hub:psi"}


def _service_only(sess: L.Session) -> Decision | None:
    if not SG.service(sess.user):
        return Decision(dict(SG.DENIED))
    return None


def _cleaned(rows: list, cap: int, shape: Callable[[Any, str], dict | None]) -> tuple[list[dict], int, int]:
    """Each row with a single_entry_id, once, up to the cap: (clean, refused, past the cap)."""
    clean: list[dict] = []
    seen: set[str] = set()
    refused = 0
    for r in rows:
        if len(clean) >= cap:
            break
        item = shape(r, "")
        if item is None or item["id"] in seen:
            refused += 1
            continue
        seen.add(item["id"])
        clean.append(item)
    return clean, refused, max(0, len(rows) - refused - len(clean))


def ingest(sess: L.Session, payload: dict) -> Decision:
    """psiPunchesIngest: the staff-hours rows the relay carried from PsiAnywhere's record, upserted; the client columns a
    row carried are dropped at the door and named."""
    shut = _service_only(sess)
    if shut:
        return shut
    reads = sess.reads
    why = CP.gate_holds(reads, PP.INGEST_GATE)
    if why:
        return W.refuse(409, why)
    rows = (payload or {}).get("rows") or []
    rows = rows if isinstance(rows, list) else []
    if not rows:
        return Decision({"status": 200, "data": {"wrote": 0, "converged": True, "note": "nothing was handed over"}})
    dropped = PP.crossed(rows)
    clean, refused, overflow = _cleaned(rows, PP.INGEST_CAP, PP.clean)
    if not clean:
        return W.refuse(400, "No usable row — each one needs a single_entry_id.")
    RR._widen(reads, PP.RESOURCE, list(PP.HEADER))
    res = B.upsert_plan(reads, PP.RESOURCE, clean, gsjs.iso(reads.now))
    if res.get("error"):
        return W.refuse(400, "the psi_punches house lacks an \"id\" column")
    RR.create_many(reads, PP.RESOURCE, res["creates"], "asa-hub:psi")
    RR.update_many(reads, PP.RESOURCE, res["updates"], "asa-hub:psi")
    moved = res["inserted"] + res["updated"]
    at = gsjs.iso(reads.now)
    total = len(RR.table_rows(reads, PP.RESOURCE))
    with PP.FEED_LOCK:
        PP.FEED.update(at=at, rows=str(total), switch=" @ " + at)
    if dropped:
        staff_views.record(LOGGER, "psi_punches_client_columns_refused", ", ".join(dropped))
    if moved or overflow:
        staff_views.record(LOGGER, "psi_punches_ingested",
                           f"{res['inserted']} added, {res['updated']} patched, {res['unchanged']} unchanged — "
                           f"{res['writes']} write(s)" + (f" · {overflow} past the cap, not seen" if overflow else ""))
    return Decision({"status": 200, "data": {
        "received": len(rows), "kept": len(clean), "refused": refused, "overflow": overflow,
        "inserted": res["inserted"], "updated": res["updated"], "unchanged": res["unchanged"], "writes": res["writes"],
        "converged": moved == 0, "dropped_columns": dropped, "at": at}}, subject="", own=True)


def full_ingest(sess: L.Session, payload: dict) -> Decision:
    """psiPunchesFullIngest: every field of every punch, client data included, on the full punch sheet — a house that
    is not declared yet answers 409 missing_tab and is never made here; only the cells that moved are kept."""
    shut = _service_only(sess)
    if shut:
        return shut
    reads = sess.reads
    rows = (payload or {}).get("rows") or []
    rows = rows if isinstance(rows, list) else []
    if not rows:
        return Decision({"status": 200, "data": {"wrote": 0, "converged": True, "note": "nothing was handed over"}})
    if not reads.db.house_moved(PP.FULL_TAB):
        return W.refuse(409, "The " + PP.FULL_TAB + " house is not declared yet — mint it "
                             "(tools/mint_psi_punches_full_house.py).", data={"missing_tab": True})
    res = W.tab_of(reads, PP.FULL_TAB)
    if res.ref is None:
        raise hubdb.Unreadable("asa-hub-db holds no copy of the full punch house")
    clean, refused, overflow = _cleaned(rows, PP.FULL_CAP, PP.full_clean)
    if not clean:
        return W.refuse(400, "No usable row — each one needs a single_entry_id.")
    W.gate(reads)
    sid, tab = W.where_of(res)
    heads = [gsjs.trim(gsjs.js_str(h)) for h in res.ref.headers if gsjs.trim(gsjs.js_str(h))]
    header = heads + [h for h in PP.FULL_HEADER if h not in heads]
    have: dict[str, tuple[int, dict]] = {}
    for i, (_rn, raw) in enumerate(reads.db.rows(res.ref)):
        rid = PP.text(raw.get("id"))
        if rid and rid not in have:
            have[rid] = (i, raw)
    now = gsjs.iso(reads.now)
    recs: list[dict] = []
    pending: dict[str, dict[str, str]] = {}
    at: list[int] = []
    inserted = updated = unchanged = 0
    for item in clean:
        rid = item["id"]
        if rid in pending:
            pending[rid].update({k: v for k, v in item.items() if k not in ("id", "createdAt") and k in header})
            continue
        hit = have.get(rid)
        if hit is None:
            line = {h: "" for h in header}
            line.update(id=rid, createdAt=now, updatedAt=now)
            line.update({k: v for k, v in item.items() if k != "id" and k in header})
            pending[rid] = line
            inserted += 1
            continue
        i, cur = hit
        changed = {k: v for k, v in item.items()
                   if k not in ("id", "createdAt") and k in header and PP.text(cur.get(k)) != PP.text(v)}
        if changed:
            changed["updatedAt"] = now
            recs.append(W.kept_record(sid, tab, "edit", "cols:id", rid, "psi", changed))
            at.append(i)
            updated += 1
        else:
            unchanged += 1
    for rid, line in pending.items():
        recs.append(W.kept_record(sid, tab, "append", "cols:id", rid, "psi", line))
    at.sort()
    writes = sum(1 for j, i in enumerate(at) if j == 0 or at[j - 1] != i - 1) + (1 if pending else 0)
    with PP.FEED_LOCK:
        PP.FEED["full_at"] = now
    if inserted or updated or overflow:
        staff_views.record(LOGGER, "psi_punches_full_ingested",
                           f"{inserted} added, {updated} patched, {unchanged} unchanged — {writes} write(s)"
                           + (f" · {overflow} past the cap, not seen" if overflow else ""))
    return W.final({"status": 200, "data": {
        "received": len(rows), "kept": len(clean), "refused": refused, "overflow": overflow, "inserted": inserted,
        "updated": updated, "unchanged": unchanged, "writes": writes, "converged": inserted + updated == 0, "at": now,
        "columns": len(PP.FULL_HEADER), "dropped": PP.full_dropped(rows)}}, recs, "")


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {
    "psiPunchesIngest": ingest, "psiPunchesFullIngest": full_ingest,
    "psiPunchesUpload": RR.upload_door({PP.RESOURCE: {"tab": PP.TAB}})}
POLICY: dict[str, dict[str, Any]] = {"psiPunchesIngest": {"params": {"rows": "array"}},
                                     "psiPunchesFullIngest": {"params": {"rows": "array"}}, "psiPunchesUpload": {}}
BUSY_OF: dict[str, dict[str, Any]] = {
    "psiPunchesIngest": {"status": 409, "message": "The punch feed is already running."},
    "psiPunchesFullIngest": {"status": 409, "message": "The full punch feed is already running."},
    "psiPunchesUpload": {"status": 409, "message": W.BUSY}}


class Store(RR.Store):
    """app.psi_punches_writes and app.psi_punches_receipts beside the other apps' own; the staff-hours house
    app.resource_rows'."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="psi_punches", label="PSI punches")
