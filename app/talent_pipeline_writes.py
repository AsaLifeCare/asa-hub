"""Talent Pipeline's writes (apps-script/TalentPipeline.gs): a person typed into the legacy store (talentPipelineAdd) or
taken out of it (talentPoolArchive), one person brought into the hiring process (talentCrossIn), the legacy workbook's
new rows copied (talentPipelineMigrate; talentPipelineSync on the relay's clock, or an admin's hand), the top five put
to the leaders (talentAuthorizationSend) and their replies acted on (talentAuthorizationSweep). The store's rows and
every card a crossing mints are kept as facts on the dissolved hiring tabs (app.edits); the asks and the replies judged
in app.resource_rows; every message through Smart Comms. The mailbox and the model are read first by the prepare reads
in app/talent_pipeline.py."""
from __future__ import annotations

import json
import logging
import re
from datetime import timedelta
from typing import Any, Callable

import candidate_writes as CW
import candidates as CND
import gsjs
import hubdb
import locations as L
import mail_designs as MD
import resource_rows as RR
import smart_comms as SC
import smart_comms_desk as SCD
import talent_pipeline as TP
import writes as W
from writes import Decision

log = logging.getLogger("asa-hub-app")

BUSY = "Somebody else is changing the Talent Pipeline right now — try again."
CANDIDATES, RESUME = TP.CANDIDATES, TP.RESUME
STORE = TP.TP_TABS["candidates"]
STAGE_TO_STATUS = CW.STAGE_TO_STATUS
FINISH_KEY, FINISH_DEFAULT = "sim_talent_finish_minutes", 10
# the situation the ask is put through (talent_authorization_ask) and its SMS floor (TP_AUTH_SMS)
ASK_SIT = "talent_authorization_ask"
ASK_SMS = "asamylife need help in one decision. thanks and check your email"
LANE = "talent"
MIGRATED_BY = "talent-pipeline:migrate"

s_ = gsjs.str_


def _denied() -> Decision:
    return Decision(dict(TP.DENIED))


def facts(reads: L.Reads, tab: str, subject: str, fields: dict[str, Any], by: str, at: str) -> list[dict]:
    """hiringLegacyWrite_(tab, subject, fields, by): one fact per field."""
    return CW.facts_of(reads, tab, subject, fields, by, subject, "", at=at)


def required(p: dict, *keys: str) -> Decision | None:
    """hubPolicyGate_'s required params."""
    for k in keys:
        if p.get(k) is None or p.get(k) == "":
            return W.refuse(400, f"Missing required parameter: {k}.")
    return None


def _prepared(door: str, sess: L.Session, p: dict) -> dict | None:
    return TP.unsealed(door, TP.actor(sess.user), p.get("prepared"))


def finish_minutes(reads: L.Reads) -> int:
    """tpFinishMinutes_: how long a finished person stands at Ready to start (1 to 1440, else 10)."""
    rows, _why = CND.soft(lambda: CND.read_tab(reads, "hiring_sim_config"))
    v = next((s_(r.get("value")) for r in reversed(rows or []) if s_(r.get("key")) == FINISH_KEY), "")
    n = TP.parse_int(v)
    return min(n, 1440) if n is not None and n >= 1 else FINISH_DEFAULT


def journey(reads: L.Reads, cid: str, name: str, line: dict[str, Any]) -> list[dict]:
    """journeyLog_: one line on the hiring journey."""
    return CW.journey_records(reads, {"key": cid, "name": name}, line, "")[2]


def store_row(reads: L.Reads, cid: str) -> dict | None:
    """The last tp_candidates row of one legacy id."""
    return TP.last_row(reads, STORE, cid)


# ---- the card a crossing mints (tpAuthMove_, tpMoveFromApplication_) ---------------------------------------------

def find_duplicate(reads: L.Reads, digits: str, email: str) -> dict | None:
    """hubFindDuplicate_: a live card on the board with this number or e-mail (a company line is nobody's)."""
    if digits and digits in CND.SHARED_LINE_DIGITS:
        digits = ""
    for c in TP.soft_rows(reads, CANDIDATES):
        cid = s_(c.get("candidateid"))
        if not cid or cid in TP.EXCLUDE_IDS or s_(c.get("archived")).lower() == "true":
            continue
        if not CND.stage_of(c.get("status")):
            continue
        cd = re.sub(r"^1", "", re.sub(r"\D", "", s_(c.get("phone"))))
        if cd in CND.SHARED_LINE_DIGITS:
            cd = ""
        if (digits and cd == digits) or (email and s_(c.get("email")).lower() == email):
            return {"id": cid, "name": s_(c.get("candidatename"))}
    return None


def carry_records(reads: L.Reads, tp_cid: str, hiring_cid: str, at: str) -> list[dict]:
    """tpCarryScores_ as facts: the legacy id stamped on the card, the analysis' blank score columns filled."""
    plan: dict[tuple[str, str], dict[str, str]] = {}
    TP.carry(reads, tp_cid, hiring_cid, plan)
    return plan_records(reads, plan, at)


def plan_records(reads: L.Reads, plan: dict[tuple[str, str], dict[str, str]], at: str) -> list[dict]:
    recs: list[dict] = []
    for (tab, cid), fields in plan.items():
        if fields:
            recs += facts(reads, tab, cid, fields, "talent-auth", at)
    return recs


def _guarded(reads: L.Reads, phone: str, email: str, name: str, force: str, approver: str) -> str:
    """The contact guard on a crossing: '' to go on, else why not (a forced crossing says why it overrode)."""
    guard = TP.contact_guard(reads, phone, email, name=name, trusted=True)
    if guard and guard["severity"] != "warn" and TP.enforces(reads, "auth"):
        if not force:
            return TP.guard_message(guard)
        TP.syslog(approver, "staff_guard_override", f"{name} — {guard['severity']}: {force[:300]}")
    return ""


def auth_move(reads: L.Reads, ask: dict, approver: str, at: str) -> tuple[dict[str, Any], list[dict]]:
    """tpAuthMove_: a legacy row minted a card at New with its notas — or, already on the board, the notas carried
    onto that card (never a second row)."""
    cid = s_(ask.get("candidateid"))
    cand = store_row(reads, cid)
    if cand is None:
        return {"moved": False, "reason": "no tp_candidates row for " + cid}, []
    name = s_(cand.get("name")) or s_(ask.get("candidatename"))
    words = name.split()
    first = s_(cand.get("firstname")) or (words[0] if words else "")
    last = " ".join(words[1:]) if len(words) > 1 else ""
    phone = s_(cand.get("phone"))
    email = s_(cand.get("email")).lower()
    if "@" not in email:
        email = ""
    if not phone and not email:
        return {"moved": False, "reason": "neither a phone nor an e-mail on the record"}, []
    dup = find_duplicate(reads, re.sub(r"^1", "", re.sub(r"\D", "", phone)), email)
    if dup:
        TP.syslog("asa-hub:talent-auth", "talent_auth_match_existing", f"{name} matched {dup['id']} ({dup['name']})")
        recs, _why = CND.soft(lambda: carry_records(reads, cid, dup["id"], at))
        return {"moved": True, "candidate_id": dup["id"], "matched_existing": True}, recs or []
    why = _guarded(reads, phone, email, name, s_(ask.get("force_contact")), approver)
    if why:
        return {"moved": False, "reason": why}, []
    hid = "CAN_" + TP.hex_id(20).upper()
    card = {"candidate_id": hid, "candidate_name": name, "first_name": first, "last_name": last, "phone": phone,
            "email": email, "city": s_(cand.get("city")), "state": s_(cand.get("state")), "status": "New",
            "resume_link": s_(cand.get("resumelink")), "tp_candidate_id": cid, "created_at": at, "updated_at": at,
            "created_by": "asa-hub-talent-auth:" + approver}
    recs = facts(reads, CANDIDATES, hid, card, "append", at)
    carried = TP.carried_fields(reads, cid)
    analysis = {"candidate_id": hid,
                "summary": s_(ask.get("why")) or ("Moved from the Talent Pipeline after leader authorization (ask " +
                                                  s_(ask.get("askid")) + ")."),
                "created_at": at, "updated_at": at, "created_by": "asa-hub:talent-auth", **carried["fields"]}
    recs += facts(reads, RESUME, hid, analysis, "append", at)
    return {"moved": True, "candidate_id": hid, "name": name}, recs


def move_from_application(reads: L.Reads, env: dict, landing: str, approver: str,
                          at: str) -> tuple[dict[str, Any], list[dict]]:
    """tpMoveFromApplication_: a card minted at New from a signed application, or the card already holding them."""
    name = s_(env.get("candidate"))
    words = name.split()
    first = words[0] if words else ""
    last = " ".join(words[1:]) if len(words) > 1 else ""
    phone = s_(env.get("phone"))
    email = s_(env.get("email")).lower()
    if "@" not in email:
        email = ""
    if not phone and not email:
        return {"moved": False, "reason": "the envelope carries no way to reach them"}, []
    dup = find_duplicate(reads, re.sub(r"^1", "", re.sub(r"\D", "", phone)), email)
    if dup:
        return {"moved": True, "candidate_id": dup["id"], "matched_existing": True}, []
    guard = TP.contact_guard(reads, phone, email, name=name, trusted=True)
    if guard and guard["severity"] != "warn" and TP.enforces(reads, "auth"):
        if landing != "ready":
            return {"moved": False, "reason": TP.guard_message(guard)}, []
        TP.syslog(approver, "staff_guard_override", name + " — application crossing, already on the staff roster")
    hid = "CAN_" + TP.hex_id(20).upper()
    card = {"candidate_id": hid, "candidate_name": name, "first_name": first, "last_name": last, "phone": phone,
            "email": email, "city": s_(env.get("location")), "status": STAGE_TO_STATUS["new"],
            "source": "Application form", "created_at": at, "updated_at": at,
            "created_by": "asa-hub-talent-auth:" + approver}
    return {"moved": True, "candidate_id": hid}, facts(reads, CANDIDATES, hid, card, "append", at)


def land_ready(sess: L.Session, hid: str, name: str, why: str, by: str, at: str, who: str = "") -> list[dict]:
    """A crossed card at Ready to start, marked for the finisher (talent_finish_at): hubSetStatus_, then the stamp —
    as `who` when a machine names itself."""
    reads = sess.reads
    who = who or "asa-hub-talent-auth:" + by
    recs = CW.status_move(L.Session(reads, {"email": who}), hid, {"candidatename": name, "status": "New"}, "ready", "",
                          at)
    due = gsjs.iso(reads.now + timedelta(minutes=finish_minutes(reads)))
    recs += facts(reads, CANDIDATES, hid, {"talent_finish_at": due, "talent_finish_why": why}, who, at)
    return recs


# ---- the store's own rows ----------------------------------------------------------------------------------------

def identity_check(first: str, last: str, phone: str, email: str) -> str:
    """hubIntakeIdentityCheck_: '' when the intake may go on."""
    if not first or not last or not phone:
        return "First name, last name and phone are all required."
    if len(re.sub(r"\D", "", phone)) < 7:
        return "The phone needs at least 7 digits."
    if email and not re.fullmatch(r"\S+@\S+\.\S+", email):
        return "The e-mail does not look like an address."
    return ""


def pipeline_add(sess: L.Session, payload: dict) -> Decision:
    """talentPipelineAdd: somebody typed into the store — never into the process, and never a second row for a person
    already in the store or on the board."""
    reads, user = sess.reads, sess.user or {}
    if not TP.writer(user) or not TP.manager(user):
        return _denied()
    p = payload if isinstance(payload, dict) else {}
    missing = required(p, "first_name", "last_name", "phone")
    if missing:
        return missing
    first, last = s_(p.get("first_name")), s_(p.get("last_name"))
    phone, email = s_(p.get("phone")), s_(p.get("email")).lower()
    why = identity_check(first, last, phone, email)
    if why:
        return W.refuse(400, why)
    name = gsjs.trim(first + " " + last)
    digits = TP.digits10(phone)
    key = TP.name_key(name)
    for c in TP.soft_rows(reads, STORE):
        if (digits and TP.digits10(c.get("phone")) == digits) or (key and TP.name_key(c.get("name")) == key):
            return W.refuse(409, s_(c.get("name")) + " is already in the Talent Pipeline" +
                            (" (" + s_(c.get("status")) + ")" if s_(c.get("status")) else "") + ".")
    if TP.already_here(TP.on_board_index(reads), {"name": name, "phone": phone}):
        return W.refuse(409, name + " is already a candidate on the hiring board.")
    cid = "TPC_" + TP.hex_id(10).upper()
    at = W.now_iso(reads)
    by = s_(user.get("email"))
    row = {"candidate_id": cid, "name": name, "first_name": first, "phone": phone, "email": email,
           "city": s_(p.get("city")), "state": s_(p.get("state")), "status": "",
           "resume_link": s_(p.get("resume_link")), "created_at": at, "src": "asa-hub:" + by, "migrated_at": ""}
    recs = facts(reads, STORE, cid, row, "append", at)
    TP.syslog(user, "talent_pipeline_add", f"{name} — {cid} typed into the Talent Pipeline")
    return W.final({"status": 200, "data": {"tp_candidate_id": cid, "name": name}}, recs, cid)


def pool_archive(sess: L.Session, payload: dict) -> Decision:
    """talentPoolArchive: a store row taken out (archived, never deleted) or put back."""
    reads, user = sess.reads, sess.user or {}
    if not TP.writer(user) or not TP.manager(user):
        return _denied()
    p = payload if isinstance(payload, dict) else {}
    missing = required(p, "tp_candidate_id")
    if missing:
        return missing
    cid = s_(p.get("tp_candidate_id"))
    if not cid:
        return W.refuse(400, "Which row? A tp_candidate_id is required.")
    hide = p.get("archived") is not False
    rows = TP.soft_rows(reads, STORE)
    if not rows:
        return W.refuse(404, "The Talent Pipeline store has no tab yet.")
    row = next((r for r in rows if s_(r.get("candidateid")) == cid), None)
    if row is None:
        return W.refuse(404, f'No Talent Pipeline row "{cid}".')
    at = W.now_iso(reads)
    fields = {"archived": "TRUE" if hide else "FALSE", "archived_at": at if hide else "",
              "archived_by": s_(user.get("email")) if hide else "",
              "archived_reason": s_(p.get("reason"))[:200] if hide else ""}
    recs = facts(reads, STORE, cid, fields, "runtime-sheet", at)
    TP.syslog(user, "talentPoolArchive",
              cid + " — " + ("removed from the store" if hide else "put back in the store"))
    name = gsjs.or_blank(row.get("name")) or cid
    return W.final({"status": 200, "data": {"tp_candidate_id": cid, "name": name, "archived": hide}}, recs, cid)


# ---- one person in (talentCrossIn) -------------------------------------------------------------------------------

def _cross_application(sess: L.Session, srid: str) -> Decision:
    reads, user = sess.reads, sess.user or {}
    by = s_(user.get("email"))
    env = None
    for r in TP.envelopes(reads):
        if s_(r.get("signaturerequestid")) == srid:
            env = r
    if env is None:
        return W.refuse(404, f'No application envelope "{srid}".')
    if s_(env.get("status")).lower() != "signed":
        return W.refuse(409, "That application is not signed — it reads " + (s_(env.get("status")) or "nothing") +
                        ".")
    name = s_(env.get("candidate"))
    staff = TP.staff_hit(TP.staff_index(reads), env.get("phone"), env.get("email"))
    landing = "ready" if staff else "new"
    at = W.now_iso(reads)
    moved, recs = move_from_application(reads, env, landing, by, at)
    if not moved["moved"]:
        recs = journey(reads, "", name, {"step": "talent_cross", "channel": "record", "ok": False,
                                         "title": "The crossing was refused",
                                         "detail": "from a signed application — " + s_(moved.get("reason")),
                                         "by": by})
        return W.final({"status": 409, "message": moved.get("reason") or "The move was refused."}, recs, "")
    hid = s_(moved["candidate_id"])
    if landing == "ready" and not moved.get("matched_existing"):
        got, _why = CND.soft(lambda: land_ready(sess, hid, name, "already on the staff roster as " +
                                                s_((staff or {}).get("name")), by, at))
        recs += got or []
    TP.syslog(user, "talent_cross_in", f"{name} (application {srid}) — {hid}")
    recs += journey(reads, hid, name, {
        "step": "talent_cross", "channel": "record", "ok": True, "title": "They came in from a signed application",
        "detail": "they signed the application form on " + (s_(env.get("signed")) or
                                                             "a day the envelope does not carry") +
                  " and were in no book here; they start at " + ("Ready to start" if landing == "ready" else "New"),
        "by": by})
    return W.final({"status": 200, "data": {"moved": True, "candidate_id": hid,
                                            "matched_existing": bool(moved.get("matched_existing"))}}, recs, hid)


def cross_in(sess: L.Session, payload: dict) -> Decision:
    """talentCrossIn: one person into the hiring process — a legacy store row by its id, or a signed application by its
    envelope — landing at New, or at Ready to start for somebody the company already employs; every outcome leaves a
    trace on the journey."""
    reads, user = sess.reads, sess.user or {}
    if not TP.writer(user):
        return _denied()
    p = payload if isinstance(payload, dict) else {}
    cid, srid = s_(p.get("tp_candidate_id")), s_(p.get("srid"))
    if not cid and not srid:
        return W.refuse(400, "Send tp_candidate_id or srid.")
    if not cid:
        return _cross_application(sess, srid)
    cand = store_row(reads, cid)
    if cand is None:
        return W.refuse(404, f'No Talent Pipeline row "{cid}".')
    rz = TP.last_row(reads, TP.TP_TABS["resume"], cid) or {}
    by = s_(user.get("email"))
    name = s_(cand.get("name"))
    at = W.now_iso(reads)
    recs: list[dict] = []

    def trace(ok: bool, what: str) -> None:
        TP.syslog(user, "talent_cross_in", f"{name} ({cid}) — {what}", 200 if ok else 409)
        recs.extend(journey(reads, cid, name, {"step": "talent_cross", "channel": "record", "ok": ok,
                                               "title": "They came in from the Talent Pipeline" if ok
                                               else "The crossing was refused", "detail": what, "by": by}))
    can = TP.crossable(cand, rz, TP.staff_index(reads))
    if not can["ok"]:
        trace(False, "refused — " + s_(can.get("why")))
        return W.final({"status": 409, "message": "They cannot come in: " + s_(can.get("why"))}, recs, cid)
    already = TP.already_here(TP.on_board_index(reads), cand)
    if already:
        trace(False, "already on the board as " + already)
        return W.final({"status": 200, "data": {"moved": False, "matched_existing": True, "candidate_id": already,
                                                "message": name + " is already on the board."}}, recs, cid)
    landing = s_(can.get("landing")) or "new"
    legacy, check = s_(cand.get("status")) or "nothing", s_(rz.get("cjisstatus")) or "nothing"
    moved, got = auth_move(reads, {
        "candidateid": cid, "candidatename": name, "askid": "",
        "force_contact": s_(can.get("why")) if landing == "ready" else "",
        "why": f"Brought in from the Talent Pipeline by {by} — the legacy record said {legacy} and its background "
               f"check read {check}."}, by, at)
    recs += got
    if not moved["moved"]:
        trace(False, "the move door refused — " + (s_(moved.get("reason")) or "no reason given"))
        return W.final({"status": 409, "message": s_(moved.get("reason")) or "The move was refused."}, recs, cid)
    hid = s_(moved["candidate_id"])
    if landing == "ready" and not moved.get("matched_existing"):
        landed, why = CND.soft(lambda: land_ready(sess, hid, name, s_(can.get("why")), by, at))
        if why:
            trace(False, "they crossed but could not be placed at Ready to start — " + why)
        recs += landed or []
    if moved.get("matched_existing"):
        said = "matched the existing card " + hid + " — the notas crossed, no second row"
    else:
        said = ("became " + hid + " at " + ("Ready to start" if landing == "ready" else "New") + "; " +
                (s_(can.get("why")) + ". " if landing == "ready" else "") + "the legacy said " + legacy +
                " and its background check read " + check + "; the notas crossed with them and they start at New")
    trace(True, said)
    return W.final({"status": 200, "data": {"moved": True, "candidate_id": hid,
                                            "matched_existing": bool(moved.get("matched_existing"))}}, recs, hid)


# ---- the legacy workbook's new rows (tpMigrateRun_'s writes) ------------------------------------------------------

def record_migration(reads: L.Reads, rows: dict[str, list]) -> tuple[dict[str, int], list[dict]]:
    """The rows prepared, each one still new under the lock, landed as facts; the count is what landed."""
    counts: dict[str, int] = {}
    recs: list[dict] = []
    for _tab, dest, _key, _map in TP.COPIES:
        have = TP.have_keys(reads, dest)
        n = 0
        for item in rows.get(dest) or []:
            if not isinstance(item, list) or len(item) != 2 or not isinstance(item[1], dict):
                continue
            key = s_(item[0])
            if not key or key in have:
                continue
            fields = {h: gsjs.or_blank(item[1].get(h)) for h in TP.TP_HEADERS[dest]}
            recs += facts(reads, dest, key, fields, MIGRATED_BY, s_(fields.get("migrated_at")) or W.now_iso(reads))
            have.add(key)
            n += 1
        counts[dest] = n
    return counts, recs


def _migrated_said(who: Any, counts: dict[str, int]) -> None:
    if any(counts.values()):
        TP.syslog(who, "talent_pipeline_migrate", json.dumps(counts, separators=(",", ":"))[:200])
    else:
        log.info("talent-migrate: the legacy workbook carried no row we had not already copied")


def migrate(sess: L.Session, payload: dict) -> Decision:
    """talentPipelineMigrate: an admin's press — every legacy row not copied yet, as talentPipelineMigratePrepare read
    it."""
    reads, user = sess.reads, sess.user or {}
    if not user or user.get("is_service") or s_(user.get("role")) != "admin":
        return _denied()
    prep = _prepared("talentPipelineMigratePrepare", sess, payload if isinstance(payload, dict) else {})
    if prep is None:
        return W.refuse(409, TP.STALE)
    counts, recs = record_migration(reads, ((prep.get("migrate") or {}).get("data") or {}).get("rows") or {})
    _migrated_said(user, counts)
    return W.final({"status": 200, "data": {"added": counts}}, recs, "")


# ---- the leaders' replies acted on (tpAuthSweepRun_'s writes) -----------------------------------------------------

def _rr_rows(reads: L.Reads, resource: str) -> list[list]:
    return [[k, dict(c)] for k, c in RR.table_rows(reads, resource)]


def auth_record(sess: L.Session, env: Any, by: str) -> tuple[dict[str, Any] | None, list[dict], bool]:
    """tpAuthSweepRun_'s writes: the notas owed to cards already crossed; then, for each reply the model judged, the
    judgement kept once, the asks it names denied or approved — the approved minted a card — never a name no open ask
    carries. (the sweep's answer, its records, whether a row was kept in Postgres)"""
    reads = sess.reads
    at = W.now_iso(reads)
    recs, _why = CND.soft(lambda: plan_records(reads, TP.heal(reads), at))
    recs = recs or []
    if not isinstance(env, dict) or env.get("status") != 200:
        return (dict(env) if isinstance(env, dict) else None), recs, False
    d = env.get("data") if isinstance(env.get("data"), dict) else {}
    if not d.get("open"):
        return {"checked": 0, "note": "no open asks"}, recs, False
    asks = _rr_rows(reads, TP.AUTH_RESOURCE)
    open_by: dict[str, list] = {}
    for item in asks:
        if s_(item[1].get("state")) == "requested":
            open_by[s_(item[1].get("candidate_name")).lower()] = item
    seen = {s_(c.get("message_id")) for _k, c in RR.table_rows(reads, TP.AUTH_AI_RESOURCE)}
    approved = denied = moved = 0
    skipped: list[str] = []
    kept = False
    for v in d.get("verdicts") or []:
        mid = s_(v.get("id"))
        if not mid or mid in seen:
            continue
        ok_deny = [s_(n) for n in v.get("denies") or [] if s_(n).lower() in open_by]
        ok_approve = [s_(n) for n in v.get("approves") or [] if s_(n).lower() in open_by]
        kind = "decided" if ok_approve or ok_deny else "none"
        RR.create(reads, TP.AUTH_AI_RESOURCE, {"message_id": mid, "verdict": kind, "approves": "; ".join(ok_approve),
                                               "denies": "; ".join(ok_deny), "via": s_(v.get("via")),
                                               "seen_at": W.now_iso(reads)}, by)
        kept = True
        seen.add(mid)
        if kind == "none":
            continue
        frm = s_(v.get("from_addr"))

        def patch(item: list, changed: dict[str, str]) -> None:
            RR.update(reads, TP.AUTH_RESOURCE, item[0], item[1], changed, by)
            item[1] = {**item[1], **changed}
        for n in ok_deny:
            item = open_by.pop(n.lower(), None)
            if item is None:
                continue
            patch(item, {"state": "denied", "reply_message_id": mid, "reply_from": frm, "reply_verdict": "deny",
                         "reply_analyzed_at": at})
            denied += 1
        for n in ok_approve:
            item = open_by.pop(n.lower(), None)
            if item is None:
                continue
            patch(item, {"state": "approved", "reply_message_id": mid, "reply_from": frm, "reply_verdict": "approve",
                         "reply_analyzed_at": at})
            approved += 1
            ask = {hubdb.norm_key(k): s_(x) for k, x in item[1].items()}
            mv, got = auth_move(reads, ask, frm, at)
            recs += got
            if mv["moved"]:
                patch(item, {"state": "moved", "moved_candidate_id": s_(mv["candidate_id"]), "moved_at": at})
                moved += 1
            elif mv.get("reason"):
                skipped.append(s_(ask.get("candidatename")) + ": " + s_(mv["reason"]))
    checked = int(d.get("checked") or 0)
    if checked or approved or denied or moved or skipped:
        log.info("talent_auth_sweep: %s read, %s approved, %s denied, %s moved%s", checked, approved, denied, moved,
                 (", skipped: " + " | ".join(skipped)[:120]) if skipped else "")
    return {"checked": checked, "approved": approved, "denied": denied, "moved": moved, "skipped": skipped}, recs, kept


def _settled(answer: dict[str, Any], recs: list[dict], kept: bool) -> Decision:
    if recs:
        return W.final(answer, recs, "")
    return Decision(answer, own=kept, subject="")


def authorization_sweep(sess: L.Session, payload: dict) -> Decision:
    """talentAuthorizationSweep: the reply reader — the relay's clock or an admin by hand — on what
    talentAuthorizationDue read."""
    refused = TP._sync_gate(sess.user)
    if refused:
        return Decision(refused)
    prep = _prepared("talentAuthorizationDue", sess, payload if isinstance(payload, dict) else {})
    if prep is None:
        return W.refuse(409, TP.STALE)
    data, recs, kept = auth_record(sess, prep.get("auth"), TP.actor(sess.user) or "service")
    if data is not None and "status" in data:
        return _settled({k: v for k, v in data.items() if k in ("status", "message")}, recs, kept)
    return _settled({"status": 200, "data": data}, recs, kept)


def sync(sess: L.Session, payload: dict) -> Decision:
    """talentPipelineSync (and talentPipelineSweep, the relay's clock): the legacy workbook's new rows copied, then the
    authorization sweep riding the same pass — a sweep fault never breaks the copy."""
    refused = TP._sync_gate(sess.user)
    if refused:
        return Decision(refused)
    reads, user = sess.reads, sess.user or {}
    prep = _prepared("talentPipelineDue", sess, payload if isinstance(payload, dict) else {})
    if prep is None:
        return W.refuse(409, TP.STALE)
    mig = prep.get("migrate") if isinstance(prep.get("migrate"), dict) else {}
    if mig.get("status") != 200:
        return Decision({k: v for k, v in mig.items() if k in ("status", "message")} or {"status": 500})
    counts, recs = record_migration(reads, (mig.get("data") or {}).get("rows") or {})
    _migrated_said("asa-hub:relay-clock" if user.get("is_service") else user, counts)
    data: dict[str, Any] = {"added": counts}
    cur = RR._cur()
    cur.execute("savepoint talent_auth_sweep")
    try:
        sweep, more, kept = auth_record(sess, prep.get("auth"), TP.actor(user) or "service")
        cur.execute("release savepoint talent_auth_sweep")
        recs += more
        data["authorization_sweep"] = None if sweep is None or "status" in sweep else sweep
    except (hubdb.Unreadable, W.NotKept):
        raise
    except Exception as exc:  # noqa: BLE001 - the sweep's fault is said, the copy stands
        cur.execute("rollback to savepoint talent_auth_sweep")
        kept = False
        data["authorization_sweep"] = {"error": str(exc)[:120]}
    return _settled({"status": 200, "data": data}, recs, kept)


# ---- the ask (talentAuthorizationSend) ---------------------------------------------------------------------------

def lane_situation(reads: L.Reads, sid: str) -> dict[str, Any]:
    """hubLaneSituation_: the situation's row, whether it is on and why not, its words and its legs."""
    try:
        rows = SCD.situations(reads)
    except Exception as exc:  # noqa: BLE001 - an unreadable switch is never a yes
        why = f"{type(exc).__name__} — {sid} is held, not sent: an unreadable switch is never a yes"
        return {"id": sid, "on": False, "why": why, "row": None}
    row = SCD.situation_last(rows, sid)
    if row is None:
        return {"id": sid, "on": False, "row": None,
                "why": f"the situation {sid} is not in the situations tab yet — nothing was sent"}
    if not SC.smart_on(row.get("enabled")):
        return {"id": sid, "on": False, "row": row,
                "why": f"the situation {sid} is switched off in Smart Comms — nothing was sent"}
    return {"id": sid, "on": True, "row": row, "why": ""}


def sit_word(sit: dict, field: str, floor: str, var: dict[str, str]) -> str:
    """hubLaneSituation_'s word(): the row's cell rendered (hubLetterRender_), else the floor."""
    cell = s_((sit.get("row") or {}).get(field))
    if not cell:
        return floor
    return re.sub(r"\{(\w+)\}", lambda m: s_(var[m.group(1)]) if m.group(1) in var else m.group(0), cell)


def sit_leg(sit: dict, channel: str) -> bool:
    """hubLaneSituation_'s leg(): every channel while the row names none."""
    raw = s_((sit.get("row") or {}).get("channels"))
    return not raw or channel in SC.smart_list(raw)


def ask_letter(items: list[dict]) -> dict[str, str]:
    """talentAuthorizationEmail_."""
    n = len(items)

    def line(it: dict) -> str:
        bits = []
        if it.get("nota") is not None and it.get("nota") != "":
            bits.append("Nota " + gsjs.js_str(it["nota"]) + "/10")
        if it.get("decision"):
            bits.append(it["decision"])
        if it.get("stage"):
            bits.append("stage: " + it["stage"])
        if it.get("screen"):
            bits.append("screen: " + it["screen"])
        if it.get("cjis"):
            bits.append("CJIS " + it["cjis"])
        bits.append("red flags: " + ", ".join(it["flags"]) if it.get("flags") else "no red flags")
        return " · ".join(bits)
    first = s_(items[0].get("name")) if items else ""
    blocks = [MD.mail_para("The platform re-ranked every analyzed candidate in the Talent Pipeline and these " +
                           ("is the one standing" if n == 1 else f"{n} stand") + " at the top. "
                           "<strong>It needs your authorization before anyone moves into the hiring process.</strong>")]
    for it in items:
        blocks.append(MD.mail_fact("#" + str(it["rank"]) + " — " + s_(it.get("name")), line(it)))
    blocks.append(MD.mail_steps([
        '<strong>Reply to this e-mail</strong> naming who to proceed with — e.g. "Proceed with ' +
        MD.mail_esc((first or "the first candidate") if items else "the first candidate") + '".',
        'To hold somebody back, say that the same way — "Do not proceed with …".',
        "The platform reads the reply and moves each approved candidate into the hiring process on its own."]))
    text = ("Hiring authorization needed - the top " + str(n) + " candidates\n\n"
            "The platform re-ranked every analyzed candidate in the Talent Pipeline and these stand at "
            "the top. It needs your authorization before anyone moves into the hiring process.\n\n" +
            "\n".join("  #" + str(it["rank"]) + " " + s_(it.get("name")) + " - " + line(it).replace("·", "-")
                      for it in items) + "\n\n"
            '1. Reply to this e-mail naming who to proceed with (e.g. "Proceed with ' +
            (first if items else "the first candidate") + '").\n'
            '2. To hold somebody back, say that the same way ("Do not proceed with ...").\n'
            "3. The platform reads the reply and moves each approved candidate into the hiring "
            "process on its own.\n\n"
            "The platform is now waiting on this thread and reads the replies automatically.\n")
    return {"subject": "[Action required] Hiring authorization — the top " + str(n) + " candidate" +
                       ("" if n == 1 else "s"),
            "text": text,
            "html": MD.mail_shell({"eyebrow": "Talent Pipeline", "title": "Authorization to proceed with hiring",
                                   "preheader": "The top " + str(n) + " ranked candidates await your word — reply to "
                                                "decide.",
                                   "blocks": blocks,
                                   "footnote": "The platform is now waiting on this thread and reads the replies "
                                               "automatically. Nothing moves until one of you answers; every decision "
                                               "the reply names is recorded."})}


def authorization_send(sess: L.Session, payload: dict) -> Decision:
    """talentAuthorizationSend: the top five by the canonical rank put to the leaders — one ask row per person not
    already asked, one letter and one SMS per configured leader, through Smart Comms."""
    reads, user = sess.reads, sess.user or {}
    if not TP.manager(user):
        return _denied()
    sit = lane_situation(reads, ASK_SIT)
    if not sit["on"]:
        return W.refuse(409, "Nobody was asked: " + sit["why"] + ".")
    top5 = TP.rank(TP.joined(reads)["rows"])[:5]
    if not top5:
        return W.refuse(409, "No eligible candidate to ask about yet.")
    opened = {}
    for _k, c in RR.table_rows(reads, TP.AUTH_RESOURCE):
        st = s_(c.get("state"))
        if st in ("requested", "approved"):
            opened[s_(c.get("candidate_id"))] = st
    fresh = [r for r in top5 if r["candidate_id"] not in opened]
    if not fresh:
        return W.refuse(409, "Every candidate in the top 5 already has an open or approved ask — the platform is "
                             "waiting on the leaders' reply.")
    to = TP.recipients(reads)
    at = W.now_iso(reads)
    by = s_(user.get("email"))
    items = [{"rank": i + 1, "name": r["name"], "nota": TP.nota(r["composite_score"]), "score": TP.rank_score(r),
              "decision": r["decision"], "stage": r["status"], "flags": r["flags"], "cjis": r["cjis"],
              "screen": r["screen_result"]} for i, r in enumerate(top5)]
    rank_of = {r["candidate_id"]: i + 1 for i, r in enumerate(top5)}
    RR.create_many(reads, TP.AUTH_RESOURCE, [{
        "ask_id": "ASK_" + TP.hex_id(12).upper(), "candidate_id": r["candidate_id"], "candidate_name": r["name"],
        "rank": str(rank_of[r["candidate_id"]]), "nota": W.sheet_text(TP.nota(r["composite_score"])),
        "requested_at": at, "requested_by": by, "recipients": ", ".join(to["emails"]), "state": "requested",
        "reply_message_id": "", "reply_from": "", "reply_verdict": "", "reply_analyzed_at": "",
        "moved_candidate_id": "", "moved_at": ""} for r in fresh], by)
    letter = ask_letter(items)
    var = {"count": str(len(items)), "list": "\n".join(f"{it['rank']}. {it['name']}" for it in items)}
    subject = sit_word(sit, "email_subject", letter["subject"], var)
    text = sit_word(sit, "email_text", letter["text"], var)
    batch = TP.hex_id(8)
    at_ms = int(reads.now.timestamp() * 1000)
    emailed = texted = 0
    if sit_leg(sit, "email"):
        for i, addr in enumerate(to["emails"]):
            got = SC.raise_situation(None, situation=ASK_SIT, to=addr, vars=var, key=f"tpauth_{batch}_e{i}",
                                     lane=LANE, at_ms=at_ms, prune=False, channel="email", body=text, subject=subject,
                                     html=letter["html"])
            emailed += s_(got.get("state")) == "sent"
    sms = sit_word(sit, "sms_text", ASK_SMS, var)
    if sit_leg(sit, "sms"):
        for i, num in enumerate(to["sms"]):
            got = SC.raise_situation(None, situation=ASK_SIT, to=num, vars=var, key=f"tpauth_{batch}_s{i}",
                                     lane=LANE, at_ms=at_ms, prune=False, channel="sms", body=sms)
            texted += s_(got.get("state")) == "sent"
    TP.syslog(user, "talent_auth_send", f"{len(fresh)} ask(s), {emailed} email(s), {texted} sms")
    return Decision({"status": 200, "data": {"asked": len(fresh), "already_open": len(top5) - len(fresh),
                                             "emails_sent": emailed, "sms_sent": texted,
                                             "top5": [it["name"] for it in items]}}, own=True, subject="")


# ---- the relay's upload of the resources kept here ----------------------------------------------------------------

UPLOAD_SPECS = {TP.AUTH_RESOURCE: {"tab": TP.AUTH_TAB}, TP.AUTH_AI_RESOURCE: {"tab": TP.AUTH_AI_TAB},
                "scraperConfig": {"tab": "scraper_config"}}

ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {
    "talentPipelineAdd": pipeline_add, "talentPoolArchive": pool_archive, "talentCrossIn": cross_in,
    "talentPipelineMigrate": migrate, "talentPipelineSync": sync, "talentPipelineSweep": sync,
    "talentAuthorizationSend": authorization_send, "talentAuthorizationSweep": authorization_sweep,
    "talentUpload": RR.upload_door(UPLOAD_SPECS)}
POLICY: dict[str, dict[str, Any]] = {
    "talentPipelineAdd": {"roles": ("admin", "manager"),
                          "params": {"first_name": "string", "last_name": "string", "phone": "string",
                                     "email": "string", "city": "string", "state": "string",
                                     "resume_link": "string"}},
    "talentPoolArchive": {"roles": ("admin", "manager"),
                          "params": {"tp_candidate_id": "string", "archived": "boolean", "reason": "string"}},
    "talentCrossIn": {"roles": ("admin", "manager"), "params": {"tp_candidate_id": "string"}},
    "talentPipelineMigrate": {"roles": ("admin",)}, "talentPipelineSync": {}, "talentPipelineSweep": {},
    "talentAuthorizationSend": {"roles": ("admin", "manager")}, "talentAuthorizationSweep": {},
    "talentUpload": {}}
BUSY_OF: dict[str, dict[str, Any]] = {a: {"status": 409, "message": BUSY} for a in ACTIONS}


class Store(RR.Store):
    """app.talent_pipeline_writes and app.talent_pipeline_receipts; the asks and the replies judged
    app.resource_rows'."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="talent_pipeline", label="Talent Pipeline")
