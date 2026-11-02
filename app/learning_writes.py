"""Learning's writes (apps-script/Learning.gs) decided off asa-hub-db and kept in app.edits: a person's attempt at a
competency, and a competency made, changed or retired."""
from __future__ import annotations

from typing import Any, Callable

import client_writes as CW
import gsjs
import house_tables as HT
import learning as LR
import locations as L
import resource_rows as RR
import scope as sc
import writes as W
from scope import Defer
from writes import Decision

BUSY = "Somebody else is changing Learning right now — try again."
ADMIN_ONLY = "This action is for admin."


def _kept(answer: dict[str, Any], edits: list[dict], subject: str, fresh: tuple[str, ...], edition: str) -> Decision:
    d = W.final(answer, edits, subject, edition)
    d.fresh = fresh
    return d


def _where(reads: L.Reads, tab: str) -> tuple[str, str, tuple]:
    res = W.tab_of(reads, tab)
    if res.ref is None:
        raise Defer(f"{tab} holds no tab in the copy")
    sid, name = W.where_of(res)
    return sid, name, res.ref.headers


def _skill(reads: L.Reads, sid: str) -> dict | None:
    """requireRow_('learnSkills', id): String(cell) === String(id)."""
    return next((r for r in LR.rows(reads, LR.SKILLS_TAB) if gsjs.or_blank(r.get("id")) == sid), None)


def learn_attempt(sess: L.Session, payload: dict) -> Decision:
    """learnAttempt: append-only; a helped attempt never counts toward mastered. The attempt is the person's own
    (learnAttempts is ownedBy ownerId), so the state it answers with counts it."""
    user = sess.user or {}
    if not LR.may_use(sess.user):
        return Decision(CW.denied())
    p = payload if isinstance(payload, dict) else {}
    reads = sess.reads
    skill_id = gsjs.str_(p.get("skillId"))
    if not skill_id:
        return W.refuse(400, "Which competency?")
    fresh = LR.books(reads, LR.SKILLS_TAB, LR.ATTEMPTS_TAB)
    if _skill(reads, skill_id) is None:
        return W.refuse(404, f'No "learnSkills" record with id "{skill_id}".', fresh=fresh)
    now = W.now_iso(reads)
    record = {"skillId": skill_id, "at": now,
              "correct": "true" if p.get("correct") is True or gsjs.str_(p.get("correct")) == "true" else "false",
              "helped": "true" if p.get("helped") is True or gsjs.str_(p.get("helped")) == "true" else "false",
              "note": gsjs.str_(p.get("note")), "ownerId": gsjs.str_(user.get("id")),
              "id": W.mint(), "createdAt": now, "updatedAt": now}
    if HT.tabled(LR.ATTEMPTS_TAB):
        W.gate(reads)
        RR.create(reads, HT.resource_of(LR.ATTEMPTS_TAB) or "", record, gsjs.str_(user.get("email")) or skill_id)
        return Decision({"status": 200, "data": LR.state(reads, user)}, subject=skill_id, own=True)
    sid, tab, headers = _where(reads, LR.ATTEMPTS_TAB)
    if any(k not in headers for k in record):
        raise Defer("an attempt naming a column the attempts tab does not have")
    W.gate(reads)
    edits = [W.kept_record(sid, tab, "append", "id", record["id"], skill_id,
                           {h: record.get(h, "") for h in headers if h})]
    return _kept({"status": 200, "data": LR.state(reads, user, [record])}, edits, skill_id, fresh, "")


def learn_skill_save(sess: L.Session, payload: dict) -> Decision:
    """learnSkillSave: the competencies themselves — shared and the admins'; retired, never deleted (attempts point at
    them). A person learning.skills lists keeps them too."""
    user = sess.user or {}
    # Settings › Learning is the master's and the Platform Lead's (scope.settings_lead); learning.skills adds its people
    admin = gsjs.js_str(user.get("role")) == "admin" and sc.settings_lead(user)
    by_edition = not admin and user.get("is_service") is not True and LR.edition_holds(sess)
    if not admin and not by_edition and user.get("is_service") is not True:
        return Decision({"status": 403, "message": ADMIN_ONLY})
    if user.get("is_service") is True:
        return Decision(CW.denied())
    p = payload if isinstance(payload, dict) else {}
    reads = sess.reads
    name = gsjs.str_(p.get("name"))
    if not name:
        return W.refuse(400, "A competency needs a name.")
    fields = {"name": name, "area": gsjs.str_(p.get("area")), "description": gsjs.str_(p.get("description")),
              "active": "false" if p.get("active") is False else "true"}
    edition = LR.EDITION if by_edition else ""
    fresh = LR.books(reads, LR.SKILLS_TAB)
    rid = gsjs.str_(p.get("id"))
    now = W.now_iso(reads)
    if HT.tabled(LR.SKILLS_TAB):
        if rid and _skill(reads, rid) is None:
            return W.refuse(404, f'No "learnSkills" record with id "{rid}".')
        W.gate(reads)
        by = gsjs.str_(user.get("email"))
        if rid:
            HT.put(reads, LR.SKILLS_TAB, "id", rid, {**fields, "updatedAt": now}, by)
        else:
            rid = W.mint()
            RR.create(reads, HT.resource_of(LR.SKILLS_TAB) or "", {**fields, "id": rid, "createdAt": now,
                                                                   "updatedAt": now}, by)
        return Decision({"status": 200, "data": {"id": rid}}, subject=rid, own=True, edition=edition)
    sid, tab, headers = _where(reads, LR.SKILLS_TAB)
    if rid:
        if _skill(reads, rid) is None:
            return W.refuse(404, f'No "learnSkills" record with id "{rid}".', fresh=fresh)
        W.gate(reads)
        cells = {**fields, "updatedAt": now}
        was = next((r for r in LR.raw_rows(reads, LR.SKILLS_TAB) if r.get("id") == rid), {})
        edits = [W.kept_record(sid, tab, "edit", "id", rid, rid, cells, before={k: was.get(k, "") for k in cells},
                               edition=edition)]
        return _kept({"status": 200, "data": {"id": rid}}, edits, rid, fresh, edition)
    made = {**fields, "id": W.mint(), "createdAt": now, "updatedAt": now}
    if any(k not in headers for k in made):
        raise Defer("a competency naming a column the competencies tab does not have")
    W.gate(reads)
    edits = [W.kept_record(sid, tab, "append", "id", made["id"], made["id"], {h: made.get(h, "") for h in headers if h},
                           edition=edition)]
    return _kept({"status": 200, "data": {"id": made["id"]}}, edits, made["id"], fresh, edition)


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {"learnAttempt": learn_attempt,
                                                              "learnSkillSave": learn_skill_save}
# learnAttempt declares no roles; learnSkillSave's admin role is the door's own gate (an edition adds its people)
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
BUSY_OF: dict[str, dict[str, Any]] = {a: {"status": 409, "message": BUSY} for a in ACTIONS}


class Store(RR.Store):
    """app.learning_writes and app.learning_receipts, beside the other apps' own."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="learning", label="Learning")
