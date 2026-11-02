"""The hiring intake's writes (HubCore.gs hubIntake, Referrals.gs referralSubmit_) kept as the hiring records' facts in
Postgres: Add Candidate's card — its résumé stub, a referral's fast-lane placement and the skipped stages' scaffold, a
packet attached at intake, a call attested at intake — and the public referral door's card with its indications-book
row. hubIntake is a door; referralSubmit_ is the function the simulator presses here while the public door that calls
it stays Apps Script's. The heavy parts (a résumé filed in Drive, a contact read out of it) are read first
(hiring_intake)."""
from __future__ import annotations

import logging
import re
import secrets
import threading
import time
from typing import Any, Callable

import candidate_writes as CW
import candidates as CND
import gsjs
import hiring_intake as HI
import hubdb
import locations as L
import onboarding as OB
import recon as R
import resume_intake as RI
import resume_intake_writes as RIW
import talent_pipeline as TP
import writes as W
from scope import Defer
from writes import Decision

log = logging.getLogger("asa-hub-app")
s_ = gsjs.str_
STALE = "What this intake was prepared on is no longer current — press it again."
# Referrals.gs: 30 an hour platform-wide — generous for people, a wall for scripts
REFERRALS_PER_HOUR = 30
_THROTTLE = {"count": 0, "until": 0.0}
_THROTTLE_LOCK = threading.Lock()


def hex_id(n: int) -> str:
    """randomHex_(n).toUpperCase()."""
    return secrets.token_hex((n + 1) // 2)[:n].upper()


def _dissolved(reads: L.Reads, *tabs: str) -> None:
    for tab in tabs:
        if not reads.db.dissolved(tab):
            raise Defer(f"{tab} is not dissolved: its sheet is Apps Script's to write")


def status_row(reads: L.Reads, cid: str, name: str, was: str, to: str, actor: str, now: str) -> list[dict]:
    """hubLogStatus_: one history row per real transition (an echo is not one)."""
    if s_(was) == s_(to):
        return []
    return CW.status_record(reads, cid, {"timestamp": now, "candidate_id": cid, "candidate_name": name,
                                         "from_status": was, "to_status": to, "actor": actor})


# ---- Add Candidate (hubIntake) ---------------------------------------------------------------------------------------

def scaffold(reads: L.Reads, cid: str, name: str, email: str, stage: str, referrer: str, who: str,
             now: str) -> list[dict]:
    """referralScaffold_: each stage the card skipped written as Skipped — never Completed or Advance, no
    recommendation invented — and, inserted at Onboarding, its packet row minted unbound."""
    placed = HI.STAGE_ORDER.index(stage) if stage in HI.STAGE_ORDER else -1
    if placed <= 0:
        return []
    why = ("Skipped at intake by " + who + " on " + now[:10] +
           (" — referred by " + referrer if referrer else " — referral fast lane") +
           ". This stage did not happen; the card was inserted at " + (CW.STAGE_TO_STATUS.get(stage) or stage) + ".")
    by = "asa-hub:fast-lane:" + who
    done = ["new"]
    recs = CW.facts_of(reads, CW.RESUME, cid, {"candidate_id": cid, "summary": why, "decision_status": "Skipped",
                                               "created_at": now, "updated_at": now, "created_by": by},
                       "append", cid, "", at=now)
    if placed > 1:
        recs += CW.facts_of(reads, CW.PHONE, cid, {"candidate_id": cid, "screen_status": "Skipped",
                                                   "final_result": "Skipped", "screen_date": now, "screened_by": by,
                                                   "transcript_text": why, "notes": why}, "append", cid, "", at=now)
        done.append("phone-screen")
    if placed > 2:
        recs += CW.facts_of(reads, CW.INTERVIEWS, cid, {"candidate_id": cid, "candidate_name": name,
                                                        "status": "Skipped", "recommendation": "", "comments": why,
                                                        "created_at": now, "created_by": by},
                            "append", cid, "", at=now)
        done.append("interview")
    if stage == "onboarding":
        seed = {"CandidateId": cid, "CandidateName": name, "CandidateEmail": email,
                "source": "hub:fast-lane" + (":" + referrer if referrer else ""), "cloned_at": now,
                "updated_by": "asa-hub:" + who, "updated_at": now}
        hdr = OB.header(reads)
        recs += CW.facts_of(reads, OB.PACKET_TAB, cid, {h: seed[h] for h in hdr if h in seed}, "runtime-sheet:append",
                            cid, "", at=now)
        done.append("onboarding-packet")
    log.info("%s fast_lane_scaffold: %s — %s inserted at %s; wrote: %s", who, cid, name, stage, ", ".join(done))
    return recs


def intake_records(sess: L.Session, p: dict, prep: dict | None) -> tuple[dict[str, Any], list[dict]]:
    """hubIntake: the card in the Hub's own entity_candidates — the identity floor, no duplicate, no staff contact
    unless overridden; a referral placed further up when the fast lane allows it and its skipped stages scaffolded; a
    packet or a phone screen said at intake settled at birth. (its answer, its records)"""
    reads, user = sess.reads, sess.user or {}
    first, last = s_(p.get("first_name")), s_(p.get("last_name"))
    phone, email = s_(p.get("phone")), s_(p.get("email")).lower()
    why = RI.intake_check(first, last, phone, email)
    if why:
        return {"status": 400, "message": why}, []
    dup = RI.find_duplicate(reads, re.sub(r"^1", "", HI.digits(phone)), email)
    if dup:
        return {"status": 409, "message": "A candidate with this phone or email already exists (" + dup["name"] + " — " +
                dup["id"] + ")."}, []
    name = gsjs.trim(first + " " + last)
    held = RIW.guard(reads, user, p, phone, email, name)
    if held is not None:
        return dict(held.answer or {}), []
    source = s_(p.get("source")) or "Direct"
    referral_name, referral_phone = s_(p.get("referral_name")), s_(p.get("referral_phone"))
    referrer = s_(p.get("referred_by")) or referral_name
    if re.search(r"referral", source, re.I) and referrer:
        source = "Referral — " + referrer
    placed, reasons = "new", []
    wanted = s_(p.get("start_stage"))
    if wanted and wanted != "new":
        if wanted not in HI.STAGE_ORDER:
            reasons = ["a stage a candidate can be inserted at — " + ", ".join(HI.STAGE_ORDER)]
        else:
            fast = HI.fast_lane_check({"source": s_(p.get("source")), "first": first, "last": last, "phone": phone,
                                       "email": email, "referrer": referrer})
            if fast["ok"]:
                placed = wanted
            else:
                reasons = fast["reasons"]
    link, link_name = s_(p.get("resume_link")), s_(p.get("resume_filename"))
    if not link and prep and s_(prep.get("resume_link")):
        link, link_name = s_(prep.get("resume_link")), s_(prep.get("resume_filename"))
    _dissolved(reads, CW.CANDIDATES, CW.RESUME, CW.PHONE)
    W.gate(reads)
    by = s_(user.get("email"))
    cid = "CAN_" + hex_id(20)
    now = W.now_iso(reads)
    status = CW.STAGE_TO_STATUS.get(placed) or "New"
    recs = CW.facts_of(reads, CW.CANDIDATES, cid, {
        "candidate_id": cid, "candidate_name": name, "first_name": first, "last_name": last, "phone": phone,
        "email": email, "city": s_(p.get("city")), "state": s_(p.get("state")), "zip": s_(p.get("zip")),
        "status": status, "source": source, "referral_name": referral_name, "referral_phone": referral_phone,
        "resume_link": link, "created_at": now, "updated_at": now, "created_by": "asa-hub:" + by},
        "append", cid, "", at=now)
    if link:
        recs += CW.facts_of(reads, CW.RESUME, cid, {
            "candidate_id": cid, "summary": "Resume on file (attached at intake) — " + (link_name or "resume"),
            "created_at": now, "updated_at": now, "created_by": "asa-hub:" + by}, "append", cid, "", at=now)
    if placed != "new":
        if placed in ("interview", "onboarding"):
            _dissolved(reads, CW.INTERVIEWS)
        if placed == "onboarding":
            _dissolved(reads, OB.PACKET_TAB)
        recs += CW.facts_of(reads, CW.CANDIDATES, cid, {
            "fast_lane_at": placed,
            "fast_lane_by": by + " at " + now + (" — referred by " + referrer if referrer else "")}, by, cid, "",
            at=now)
        recs += scaffold(reads, cid, name, email, placed, referrer, by or "asa-hub", now)
        recs += status_row(reads, cid, name, "New", status, "referral:direct:" + by, now)
        TP.syslog(user, "intake_referral_fast_lane", name + " — inserted at " + status + " on " +
                  (referrer + "'s" if referrer else "a") + " referral")
    packet = s_(p.get("packet_file_id"))
    if packet:
        verdict = s_(p.get("packet_verdict"))
        recs += CW.facts_of(reads, CW.CANDIDATES, cid, {
            "packet_waived_by": by + " — attached at intake" + (
                " (name verified)" if verdict == "match" else " (NAME DID NOT MATCH the document)"
                if verdict == "mismatch" else " (document unreadable)"),
            "packet_status": "waived", "packet_srid": "file:" + packet, "packet_checked_at": now}, by, cid, "", at=now)
    if gsjs.js_str(p.get("phone_screen_done")) == "true":
        note = CW.js_slice(s_(p.get("phone_screen_note")), 1000)
        recs += CW.facts_of(reads, CW.PHONE, cid, {
            "candidate_id": cid, "screen_status": "Completed", "manual_screen": "true", "screen_date": now,
            "screened_by": "asa-hub:intake-manual-screen:" + by,
            "transcript_text": "MANUAL PHONE SCREEN — recorded at intake by " + by + " on " + now +
                               ". The call happened before this candidate existed on the board." +
                               ("\nNote: " + note if note else ""),
            "notes": note}, "append", cid, "", at=now)
        if placed == "new":
            recs += CW.status_move(sess, cid, {"candidatename": name, "status": status}, "phone-screen", "", now)
            placed = "phone-screen"
        TP.syslog(user, "intake_phone_screen_done", name + " (" + phone + ") — call attested, card at " +
                  ("Phone Screen" if placed == "new" else CW.STAGE_TO_STATUS.get(placed, placed)))
    if RIW.operator_card({"phone": phone, "email": email}):
        try:
            recs += RIW.purge_operator_screens(reads, cid, by, now)
        except (Defer, hubdb.Unreadable):
            raise
        except Exception as exc:  # noqa: BLE001 - never blocks intake
            log.info("hubIntake: the test line's old screenings were not retired (%s)", type(exc).__name__)
    return {"status": 200, "data": {"candidate_id": cid, "candidate_name": name, "placed_at": placed,
                                    "placement_reasons": reasons, "resume_on_file": bool(link)}}, recs


def intake(sess: L.Session, payload: dict) -> Decision:
    """hubIntake (Add Candidate): the card opened; a pasted résumé was filed by hubIntakePrepare first."""
    user = sess.user or {}
    if not HI.writer(user):
        return Decision(dict(HI.DENIED))
    p = payload if isinstance(payload, dict) else {}
    prep = None
    if gsjs.or_blank(p.get("resume_text")) and not s_(p.get("resume_link")):
        if p.get("prepared") is None:
            raise Defer("hubIntake's pasted resume is filed by hubIntakePrepare first")
        prep = R.unsealed("hubIntake", R.actor(user), p.get("prepared"))
        if prep is None:
            return W.refuse(409, STALE)
    env, recs = intake_records(sess, p, prep)
    data = env.get("data") if isinstance(env.get("data"), dict) else {}
    return W.final(env, recs, s_(data.get("candidate_id")))


# ---- the public referral door (referralSubmit_) ----------------------------------------------------------------------

def throttled() -> bool:
    """30 an hour platform-wide, the window renewed by each knock (CacheService's put)."""
    with _THROTTLE_LOCK:
        now = time.time()
        if now > _THROTTLE["until"]:
            _THROTTLE["count"] = 0
        if _THROTTLE["count"] >= REFERRALS_PER_HOUR:
            return True
        _THROTTLE["count"] += 1
        _THROTTLE["until"] = now + 3600.0
        return False


def cell_safe(v: str) -> str:
    """hubCellSafe_: a public form's words never land as a live formula."""
    return "'" + v if re.match(r"[=+\-@]", v) else v


def book_append(reads: L.Reads, f: dict[str, str], now: str) -> tuple[str, list[dict]]:
    """referralBookAppend_: one row per knock in the indications book, whatever the door answered. A book the copy
    holds no tab of yet keeps nothing here (Apps Script makes the tab on its first row)."""
    rid = s_(f.get("referral_id")) or "REF_" + hex_id(8)
    res = W.tab_of(reads, HI.BOOK_TAB)
    if res.ref is None:
        raise LookupError("the indications book has no tab in the copy yet")
    sid, tab = W.where_of(res)
    row = {"referral_id": rid, "name": s_(f.get("name")), "email": s_(f.get("email")), "phone": s_(f.get("phone")),
           "referrer_name": s_(f.get("referrer_name")), "referrer_phone": s_(f.get("referrer_phone")),
           "referrer_email": s_(f.get("referrer_email")), "resume_link": s_(f.get("resume_link")),
           "candidate_id": s_(f.get("candidate_id")), "state": s_(f.get("state")) or "received",
           "state_detail": s_(f.get("state_detail"))[:500], "arrived_at": s_(f.get("arrived_at")) or now,
           "resolved_at": "", "created_by": s_(f.get("created_by")) or "referral:public"}
    heads = [h for h in (gsjs.trim(gsjs.js_str(x)) for x in res.ref.headers) if h]
    heads += [h for h in HI.BOOK_HEADER if h not in heads]
    cells = {h: cell_safe(row.get(h, "")) for h in heads}
    return rid, [W.kept_record(sid, tab, "append", W.COLS + "referral_id", rid, s_(f.get("candidate_id")), cells)]


def _booked(reads: L.Reads, f: dict[str, str], now: str) -> tuple[str, list[dict]]:
    """The book row, a hiccup in it never changing what the door answers."""
    try:
        return book_append(reads, f, now)
    except (Defer, hubdb.Unreadable, LookupError) as exc:
        log.info("referral:public the book row was not written (%s)", str(exc)[:160])
        return "", []


def _already_known(reads: L.Reads, name: str, f: dict[str, str], now: str) -> tuple[dict[str, Any], list[dict]]:
    """referralAlreadyKnownAnswer_."""
    log.info("referral:public referral_duplicate: %s", name)
    _rid, recs = _booked(reads, f, now)
    return {"status": 200, "code": "already_known", "message": HI.already_known_text(reads, name),
            "data": {"received": True, "already_known": True}}, recs


def referral_submit(sess: L.Session, payload: dict, prep: dict | None) -> tuple[dict[str, Any], list[dict]]:
    """referralSubmit_ — the only unauthenticated write: a name and a way to reach them become a card (at Phone
    Screen when a real phone came without a résumé), a known person is recognised and nothing made, and every knock
    is a row in the indications book; `prep` is what hiring_intake.referral_prepare read first. (its answer, its
    records)"""
    reads = sess.reads
    p = payload if isinstance(payload, dict) else {}
    prep = prep if isinstance(prep, dict) else {}
    if throttled():
        return {"status": 429, "message": "Too many referrals right now — please try again later."}, []
    f = HI.referral_fields(p)
    name = f["name"]
    if not name or len(re.sub(r"\s+", "", name)) < 2:
        return {"status": 400, "message": "The name is required."}, []
    _dissolved(reads, CW.CANDIDATES, CW.JOURNEY)
    W.gate(reads)
    now = W.now_iso(reads)
    stored = s_(prep.get("probe_url"))
    r = HI.reach(f["phone"], f["email"])

    def book_row(extra: dict[str, str]) -> dict[str, str]:
        return {"name": gsjs.trim(name), "email": r["email"], "phone": r["phone"], "referrer_name": f["referrer"],
                "referrer_phone": f["referrer_phone"], "referrer_email": f["referrer_email"], "resume_link": stored,
                **extra}
    if not r["has_phone"] and not r["has_email"]:
        found = prep.get("found") if isinstance(prep.get("found"), dict) else {}
        shared = r["shared"]
        if s_(found.get("email")):
            r.update(email=s_(found.get("email")), has_email=True)
        elif s_(found.get("phone")):
            r = {**HI.reach(s_(found.get("phone")), r["email"]), "has_email": False}
            shared = r["shared"] or shared
        if not r["has_phone"] and not r["has_email"]:
            known = HI.known_by_digits(reads, shared) if shared else None
            if known:
                return _already_known(reads, name, book_row({
                    "state": "already_known", "state_detail": "one of our own lines recognized " + s_(known["name"])}),
                    now)
            _rid, recs = _booked(reads, book_row({"state": "no_contact", "state_detail": "no phone or e-mail anywhere — "
                                                  "the form, the resume, the readers"}), now)
            return {"status": 422, "code": "no_contact", "message": HI.warn_text(reads, name)}, recs
    dup, why = CND.soft(lambda: RI.find_duplicate(reads, re.sub(r"^1", "", r["digits"]) if r["has_phone"] else "",
                                                   r["email"] if r["has_email"] else ""))
    if dup and not why:
        return _already_known(reads, name, book_row({"state": "already_known", "candidate_id": s_(dup["id"]),
                                                     "state_detail": "already in the pipeline as " + s_(dup["name"])}),
                              now)
    guard, why = CND.soft(lambda: TP.contact_guard(reads, r["phone"] if r["has_phone"] else "",
                                                   r["email"] if r["has_email"] else "", name=name, trusted=False))
    guard = None if why else guard
    if guard and guard["severity"] == "block" and TP.enforces(reads, "public"):
        log.info("referral:public referral_staff_conflict: %s — refused: %s", name, TP.guard_message(guard))
        _rid, recs = _booked(reads, book_row({"state": "refused_guard", "state_detail": TP.guard_message(guard)}), now)
        return {"status": 200, "data": {"received": True}}, recs
    if guard and guard["severity"] != "unverified":
        log.info("referral:public referral_staff_conflict: %s — %s (not enforced): %s", name, guard["severity"],
                 TP.guard_message(guard))
    link = s_(prep.get("link"))
    parts = re.split(r"\s+", gsjs.trim(name))
    cid = "CAN_" + hex_id(20)
    status = "Phone Screen" if r["has_phone"] and not link else "New"
    recs = CW.facts_of(reads, CW.CANDIDATES, cid, {
        "candidate_id": cid, "candidate_name": gsjs.trim(name), "first_name": parts[0] if parts else "",
        "last_name": " ".join(parts[1:]), "phone": r["phone"], "email": r["email"] if r["has_email"] else "",
        "status": status, "source": "Referral — " + f["referrer"] if f["referrer"] else "Referral", "resume_link": link,
        "created_at": now, "updated_at": now, "created_by": "referral:public"}, "append", cid, "", at=now)
    if status == "Phone Screen":
        recs += status_row(reads, cid, gsjs.trim(name), "New", "Phone Screen", "referral:fast-lane", now)
    machine = not r["has_phone"]
    rid, more = _booked(reads, book_row({
        "candidate_id": cid, "email": r["email"] if r["has_email"] else "", "state": "contacting" if machine else "received",
        "state_detail": "e-mail only — the ask machine takes them" if machine else
        "full contact — straight into the pipeline at " + status, "resume_link": link}), now)
    recs += more
    recs += CW.journey_records(reads, {"key": cid, "name": gsjs.trim(name)}, {
        "step": "referral_arrives", "title": "A referral arrived through the public door", "channel": "system",
        "ref": rid, "by": "referral:public",
        "detail": "book row " + (rid or "(unwritten)") + " — " + ("e-mail only — the ask machine takes them" if machine
                                                                   else "full contact — straight into the pipeline")},
        "")[2]
    log.info("referral:public referral_received: %s — %s%s", cid, name, " (resume attached)" if link else "")
    return {"status": 200, "data": {"received": True}}, recs


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {"hubIntake": intake}
POLICY: dict[str, dict[str, Any]] = {"hubIntake": {"roles": ("admin", "manager")}}
BUSY_OF: dict[str, dict[str, Any]] = {"hubIntake": {"status": 409, "message": W.BUSY}}
