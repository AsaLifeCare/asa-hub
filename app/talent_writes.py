"""The hiring board's own writes (apps-script/Talent.gs): a card's parameters edited from the pipeline drawer
(candidateEdit) and cards archived or brought back (talentArchive) — kept as facts on the dissolved candidates tab
(app.edits), as the runtime sheet writes them."""
from __future__ import annotations

import re
from typing import Any, Callable

import candidate_writes as CW
import candidates as CND
import gsjs
import hubdb
import locations as L
import talent_pipeline as TP
import writes as W
from writes import Decision

BUSY = "Somebody else is changing the hiring board right now — try again."
CANDIDATES = CND.TALENT_CANDIDATES_TAB
CAN_ID = re.compile(r"^CAN_[A-Za-z0-9]{6,}$")
# Talent.gs candidateEdit: the payload's key, and the column it writes
EDITABLE = {"email": "email", "phone": "phone", "first_name": "first_name", "last_name": "last_name",
            "source": "source", "applied_at": "created_at", "city": "city", "state": "state"}
ARCHIVE_MAX = 200
SHEET_BY = "runtime-sheet"

s_ = gsjs.str_


def _header(reads: L.Reads) -> set[str]:
    """The candidates tab's columns, normalised, as the runtime sheet hands its header."""
    header, _grid = CND.shim(reads, CANDIDATES)
    return {hubdb.norm_key(h) for h in header}


def override_allowed(user: dict | None, p: dict) -> bool:
    """cgOverrideAllowed_: an admin or a manager, with a reason."""
    return TP.writer(user) and len(s_(p.get("staff_conflict_override"))) > 3


def candidate_edit(sess: L.Session, payload: dict) -> Decision:
    """candidateEdit: an admin edits a card's parameters from the pipeline drawer — the contact guard measured against
    what the row will become, a first or last name recomposing the full name the screens read."""
    reads, user = sess.reads, sess.user or {}
    if not user or s_(user.get("role")) != "admin":
        return Decision(dict(TP.DENIED))
    p = payload if isinstance(payload, dict) else {}
    cid = s_(p.get("candidate_id"))
    if not CAN_ID.match(cid):
        return W.refuse(400, TP.words(reads, "refuse.candidate_id", "invalid candidate_id"))
    row = CW.dissolved_rows(reads, CANDIDATES, [cid]).get(cid)
    if row is None:
        return W.refuse(404, TP.words(reads, "refuse.no_candidate", 'No candidate "{id}".', {"id": cid}))
    hdr = _header(reads)
    if "source" in p:
        hdr.add("source")

    def col(key: str) -> str:
        return s_(row.get(key)) if key in hdr else ""
    if "phone" in p or "email" in p:
        phone = s_(p.get("phone")) if "phone" in p else col("phone")
        email = s_(p.get("email")) if "email" in p else col("email")
        name = gsjs.or_text(p.get("first_name")).strip() or col("firstname")
        name = gsjs.trim(name + " " + (gsjs.or_text(p.get("last_name")).strip() or col("lastname"))) or \
            col("candidatename")
        guard = TP.contact_guard(reads, phone, email, self_cid=cid, name=name, trusted=True)
        if guard and guard["severity"] != "warn" and TP.enforces(reads, "auth"):
            if guard["severity"] == "unverified":
                return W.refuse(503, TP.guard_message(guard))
            if not override_allowed(user, p):
                return Decision({"status": 409, "message": TP.guard_message(guard), "staff_conflict": True})
            TP.syslog(user, "staff_guard_override", f"{name} — {guard['severity']}: "
                                                    f"{s_(p.get('staff_conflict_override'))[:300]}")
    fields: dict[str, str] = {}
    changed: list[str] = []
    for k, column in EDITABLE.items():
        if k not in p or hubdb.norm_key(column) not in hdr:
            continue
        fields[column] = s_(p.get(k))[:200]
        changed.append(k)
    if not changed:
        return W.refuse(400, TP.words(reads, "refuse.talent.nothing_to_change",
                                      "Nothing to change — send email, phone, first_name, last_name, source, "
                                      "applied_at"))
    if ("first_name" in p or "last_name" in p) and "candidatename" in hdr:
        fn = s_(p.get("first_name")) if "first_name" in p else col("firstname")
        ln = s_(p.get("last_name")) if "last_name" in p else col("lastname")
        full = " ".join(f"{fn} {ln}".split())
        if full:
            fields["candidate_name"] = full[:200]
            changed.append("candidate_name")
    at = W.now_iso(reads)
    if "updatedat" in hdr:
        fields["updated_at"] = at
    if "updatedby" in hdr:
        fields["updated_by"] = "candidate-edit:" + s_(user.get("email"))
    recs = CW.facts_of(reads, CANDIDATES, cid, fields, SHEET_BY, cid, "", at=at)
    TP.syslog(user, "candidate_edit", cid + " — " + ", ".join(changed))
    return W.final({"status": 200, "data": {"id": cid, "changed": changed}}, recs, cid)


def talent_archive(sess: L.Session, payload: dict) -> Decision:
    """talentArchive: cards archived — never deleted — or brought back, with who, when and why."""
    reads, user = sess.reads, sess.user or {}
    if not TP.writer(user):
        return Decision(dict(TP.DENIED))
    p = payload if isinstance(payload, dict) else {}
    ids = p.get("candidate_ids")
    if not isinstance(ids, list) or not ids:
        return W.refuse(400, TP.words(reads, "refuse.talent.pick_one", "Pick at least one person."))
    if len(ids) > ARCHIVE_MAX:
        return W.refuse(400, TP.words(reads, "refuse.talent.too_many", "Too many at once — at most 200."))
    hide = p.get("archived") is not False
    wanted = [gsjs.trim(gsjs.or_blank(x)) for x in ids]
    found = CW.dissolved_rows(reads, CANDIDATES, [w for w in wanted if w])
    at = W.now_iso(reads)
    reason = s_(p.get("reason"))[:200]
    by = s_(user.get("email"))
    fields = {"archived": "TRUE" if hide else "FALSE", "archived_at": at if hide else "",
              "archived_by": by if hide else "", "archived_reason": reason if hide else ""}
    recs: list[dict] = []
    for cid in found:
        recs += CW.facts_of(reads, CANDIDATES, cid, fields, SHEET_BY, cid, "", at=at)
    TP.syslog(user, "talent_archive" if hide else "talent_unarchive",
              f"{len(found)} candidate(s)" + (" · " + reason if reason else ""))
    return W.final({"status": 200, "data": {"changed": len(found), "archived": hide}}, recs,
                   next(iter(found), ""))


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {"candidateEdit": candidate_edit,
                                                              "talentArchive": talent_archive}
POLICY: dict[str, dict[str, Any]] = {"candidateEdit": {"roles": ("admin",)},
                                     "talentArchive": {"roles": ("admin", "manager")}}
BUSY_OF: dict[str, dict[str, Any]] = {a: {"status": 409, "message": BUSY} for a in ACTIONS}


class Store(W.Store):
    """app.talent_writes and app.talent_receipts, beside the other apps' own."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="talent", label="Hiring")
