"""The staff documents' and the clearance overlay's writes (apps-script/StaffDocs.gs, apps-script/Clearance.gs) decided
off asa-hub-db: staffDocsApplyDates fills a blank Employee Database Master date from the documentation form
(emp360WriteCell_ with nothing expected, kept in app.edits), clearanceSet files a person's credential on the overlay
and clearanceReadDates records the expiries its prepare read (staff_docs.clearance_read_prepare) found — the overlay's
rows in Postgres once kept there (app.resource_rows `staffClearance`), else kept in app.edits over the staff_clearance
tab. The two cursors move in app.staff_docs_state under the same write; a void puts each back."""
from __future__ import annotations

import functools
import math
import re
import secrets
from typing import Any, Callable

import candidates as CND
import cert_docs as CD
import gsjs
import hubdb
import locations as L
import resource_rows as RR
import smart_comms as SCM
import staff as SP
import staff_comms as SC
import staff_docs as SD
import staff_views
import writes as W
from writes import Decision

BUSY = "Somebody else is changing the staff documents right now — try again."
NOT_READ = "The documents were not read just now, so nothing was written. Try again."
_DAY = re.compile(r"^\d{4}-\d{2}-\d{2}$")

s_ = gsjs.str_


def _set_state(key: str, value: str) -> None:
    """hubPropSet_ on app.staff_docs_state, the value replaced kept for a void."""
    RR._cur().execute(
        f"insert into {SD.STATE} as s (key, value, prev, write_id) values (%s, %s, '', %s)"
        " on conflict (key) do update set prev = s.value, value = excluded.value, write_id = excluded.write_id,"
        " updated_at = now()", (key, value, SCM.write_id()))


def _kept(answer: dict[str, Any], edits: list[dict], subject: str, own: bool) -> Decision:
    """W.final, and a row or a cursor kept in the app's own tables under this write as well."""
    kept = [e for e in edits if e and e.get("cells")]
    if not kept and not own:
        return Decision(answer)
    return Decision(answer, edits=kept or None, subject=subject, own=own)


# ---- staffDocsApplyDates ---------------------------------------------------------------------------------------------

def _write_cell(reads: L.Reads, d: dict) -> dict[str, Any]:
    """emp360WriteCell_({employeeId: the form's name, field, value: the expiry, expected: ''}, user, true): the kept
    edit and the audit line's words, or the refusal's words."""
    cell = CD.master_cell(reads, d["field"], d["name"], "")
    if "stale" in cell:
        return {"why": "Someone changed this row since you opened it — reloaded."}
    if cell.get("why"):
        return {"why": cell["why"]}
    rec = W.kept_record(cell["sid"], cell["tab"], "edit", cell["match"], cell["key"], SP.fold(d["name"]),
                        {cell["head"]: d["expires"]}, {cell["head"]: cell["before"]})
    found = CD.find_master_row(reads, "", d["name"])
    row = found.get("row") or {}
    rn = CD.master_sheet(reads)["raw"][found["at"]][0] if found.get("at") is not None else ""
    field = hubdb.estate_key(d["field"])
    return {"edit": rec, "line": f"{s_(row.get('employee') or row.get('name'))}: {field} (row {rn}) · via review"}


def apply_dates(sess: L.Session, payload: dict) -> Decision:
    """staffDocsApplyDates: the form's expiries written into the Master's blank date cells, a window at a time from the
    saved cursor (refusals spend slots too, so every press moves on); a date a person typed outranks the form."""
    user = sess.user or {}
    if not sess.user or user.get("is_service") or gsjs.js_str(user.get("role")) != "admin":
        return Decision(dict(SD.DENIED))
    p = payload if isinstance(payload, dict) else {}
    n = CND.js_number(p.get("limit"))
    limit = max(1, min(25 if math.isnan(n) or n == 0 else n, 100))
    only = SC._staff_docs_key(s_(p.get("name")))
    reads = sess.reads
    got = SD.dated(reads)
    if got.get("error"):
        return W.refuse(503, got["error"])
    order = sorted(got["dated"], key=functools.cmp_to_key(
        lambda a, b: gsjs.locale_cmp(a["key"] + "|" + a["field"], b["key"] + "|" + b["field"])))
    cur = 0 if only else SD.cursor(reads, SD.APPLY_CURSOR)
    if not cur >= 0 or cur >= len(order):
        cur = 0
    ordered = order[cur:] + order[:cur]
    wrote: list[dict] = []
    skipped: list[dict] = []
    edits: list[dict] = []
    lines: list[str] = []
    done = examined = 0
    for d in ordered:
        if done >= limit:
            break
        examined += 1
        if only and d["key"] != only:
            continue
        # expected '' makes this fill-blank only
        res = _write_cell(reads, d)
        done += 1
        if res.get("edit"):
            edits.append(res["edit"])
            lines.append(res["line"])
            wrote.append({"name": d["name"], "field": d["field"], "value": d["expires"], "type": d["type"]})
        else:
            # the ordinary case: a date already there
            skipped.append({"name": d["name"], "field": d["field"], "value": d["expires"],
                            "why": res["why"] or "refused"})
    moved = not only and bool(order)
    if moved:
        _set_state(SD.APPLY_CURSOR, str(SD.js_mod(cur + examined, len(order))))
    for line in lines:
        staff_views.record(user, "emp360WriteCell", line)
    staff_views.record(user, "staff_docs_apply_dates", f"{len(wrote)} written, {len(skipped)} left alone"
                       + ("" if only else f" (from {cur} of {len(order)})"))
    message = (f"{len(wrote)} date(s) filled from the archive" + (f", {len(skipped)} left as they were" if skipped
                                                                    else "") + "."
               + ("" if only else f" {examined} of {len(order)} archive entries looked at, starting at "
                  f"{cur + 1 if order else 0}; the next press carries on from where this one stopped."))
    answer = {"status": 200, "data": {"wrote": wrote, "skipped": skipped, "total": len(order),
                                      "from": 0 if only else cur, "examined": examined, "message": message}}
    return _kept(answer, edits, "", moved)


# ---- clearanceSet ----------------------------------------------------------------------------------------------------

def clearance_set(sess: L.Session, payload: dict) -> Decision:
    """clearanceSet: a person's credential submitted, verified (with its evidence) or revoked — a row on the overlay,
    never the estate's sheets; the matrix reads the last row per person and credential."""
    user = sess.user or {}
    if not SD.is_writer(sess.user):
        return Decision(dict(SD.DENIED))
    p = payload if isinstance(payload, dict) else {}
    name = s_(p.get("person_name"))
    cred = s_(p.get("credential")).lower()
    decision = s_(p.get("decision")).lower()
    if not name:
        return W.refuse(400, "person_name is required.")
    if cred not in SD.CREDENTIALS:
        return W.refuse(400, f'Unknown credential "{cred}".')
    if decision not in SD.DECISIONS:
        return W.refuse(400, "decision must be submitted, verified or revoked.")
    file_id, state_ref = s_(p.get("file_id")), s_(p.get("state_ref"))
    if decision == "verified" and not file_id and not state_ref:
        return W.refuse(409, "Verified needs the evidence: attach the document or record the state reference.")
    reads = sess.reads
    row = {"clearance_id": "CLR_" + secrets.token_hex(8).upper(), "person_key": gsjs.name_key(name),
           "person_name": name, "candidate_id": s_(p.get("candidate_id")), "credential": cred,
           "evidence_kind": s_(p.get("evidence_kind")) or ("state_registry" if state_ref else "document"),
           "file_id": file_id, "state_ref": state_ref, "issued_on": s_(p.get("issued_on")),
           "expires_on": s_(p.get("expires_on")), "decision": decision, "verified_by": s_(user.get("email")),
           "verified_at": W.now_iso(reads), "source": "hub:manual"}
    answer = {"status": 200, "data": {"person": name, "credential": cred, "decision": decision}}
    if RR.uploaded(reads.db, SD.CLEARANCE):
        RR.create(reads, SD.CLEARANCE, {k: v for k, v in row.items() if v != ""}, s_(user.get("email")))
        out = _kept(answer, [], row["person_key"], True)
    else:
        sid, tab = W.where_of(W.tab_of(reads, SD.CLEARANCE_TAB))
        out = _kept(answer, [W.kept_record(sid, tab, "append", W.COLS + "clearance_id", row["clearance_id"],
                                           row["person_key"], row)], row["person_key"], False)
    staff_views.record(user, "clearance_set", f"{name} — {cred} {decision}")
    return out


# ---- clearanceReadDates ----------------------------------------------------------------------------------------------

def _head(got: dict, key: str) -> str:
    return next((h for h in got["heads"] if hubdb.norm_key(h) == key), "")


def read_dates(sess: L.Session, payload: dict) -> Decision:
    """clearanceReadDates: the expiries its prepare read found written onto the documents still waiting for one, and
    the cursor moved past every document read, found or not."""
    user = sess.user or {}
    if not SD.is_writer(sess.user):
        return Decision(dict(SD.DENIED))
    p = payload if isinstance(payload, dict) else {}
    prep = p.get("prepared")
    if not isinstance(prep, dict) or not isinstance(prep.get("found"), list):
        return W.refuse(503, NOT_READ)
    reads = sess.reads
    got = SD.clearance_rows(reads)
    if SD.ocr_queue(got) is None:
        return W.refuse(500, SD.MISSING_COLUMNS)
    try:
        cur, total, read = int(prep.get("cursor") or 0), int(prep.get("total") or 0), int(prep.get("read") or 0)
    except (TypeError, ValueError):
        return W.refuse(503, NOT_READ)
    exp_head, id_head = _head(got, "expireson"), _head(got, "clearanceid")
    by = s_(user.get("email"))
    edits: list[dict] = []
    updates: list[tuple[str, dict, dict[str, str]]] = []
    found = 0
    for f in prep["found"]:
        f = f if isinstance(f, dict) else {}
        iso, fid, cid = s_(f.get("expires_on")), s_(f.get("file_id")), s_(f.get("clearance_id"))
        if not _DAY.fullmatch(iso) or not fid:
            continue
        if got["kept"]:
            hit = next(((k, c) for k, c in got["rows"] if k == s_(f.get("key"))), None)
            if hit is None or SD.at(got, hit[1], "fileid") != fid or SD.at(got, hit[1], "expireson"):
                continue
            updates.append((hit[0], hit[1], {exp_head: iso}))
        else:
            at = [i for i, (_rn, raw) in enumerate(got["rows"]) if cid and SD.at(got, raw, "clearanceid") == cid]
            if len(at) != 1 or not id_head:
                continue
            raw = got["rows"][at[0]][1]
            if SD.at(got, raw, "fileid") != fid or SD.at(got, raw, "expireson"):
                continue
            key = W.row_key_of(got["rows"], at[0], [[id_head]])
            if key is None:
                continue
            sid, tab = W.where_of(got["res"])
            edits.append(W.kept_record(sid, tab, "edit", key[0], key[1], SD.at(got, raw, "personkey"),
                                       {exp_head: iso}, {exp_head: ""}))
        found += 1
    if updates:
        RR.update_many(reads, SD.CLEARANCE, updates, by)
    if total:
        _set_state(SD.OCR_CURSOR, str(SD.js_mod(cur + read, total)))
    left = max(0, total - read)
    staff_views.record(user, "clearance_read_dates",
                       f"{read} document(s) read, {found} date(s) found, {left} still waiting for a date")
    answer = {"status": 200, "data": {"read": read, "found": found, "pending": left}}
    return _kept(answer, edits, "", bool(total) or bool(updates))


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {
    "staffDocsApplyDates": apply_dates, "clearanceSet": clearance_set, "clearanceReadDates": read_dates}
POLICY: dict[str, dict[str, Any]] = {
    "staffDocsApplyDates": {"roles": ("admin",), "params": {"limit": "number", "name": "string"}},
    "clearanceSet": {"roles": ("admin", "manager")},
    "clearanceReadDates": {"roles": ("admin", "manager")}}
BUSY_OF: dict[str, dict[str, Any]] = {a: {"status": 409, "message": BUSY} for a in ACTIONS}


class Store(RR.Store):
    """app.staff_docs_writes and _receipts; the overlay's rows app.resource_rows', the cursors app.staff_docs_state —
    a void takes the rows back and puts each cursor where it was."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="staff_docs", label="Staff documents")

    def settle(self, write_id: str, state: str, why: str = "", fields: list[str] | None = None) -> bool:
        done = super().settle(write_id, state, why, fields)
        if state == "void" and done:
            try:
                with self.conn().transaction():
                    self.conn().execute(f"update {SD.STATE} set value = prev, write_id = '', updated_at = now()"
                                        " where write_id = %s", (write_id,))
            except Exception as exc:  # noqa: BLE001 - said, never raised into the relay's settle
                W.log.warning("staff documents: the void of %s left the cursor (%s)", write_id[:40],
                              type(exc).__name__)
        return done
