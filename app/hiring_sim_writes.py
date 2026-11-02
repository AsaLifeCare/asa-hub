"""The hiring simulator's writes (HiringSim.gs, HiringSimConfig.gs), each kept as the dissolved tabs' facts in Postgres:
the config's cells saved (hiringSimConfigSet), the evidence a rehearsal card is handed (hiringSimEvidenceFill), a
borrowed transcript (hiringSimTranscriptSeed), the rehearsal and everything filed against it torn down (hiringSimReset,
its "(SIM)" files already put in Drive's bin by its prepare read), the flow entrances — the rehearsal card made
through the intake (hiringSimSeed) or through the public referral door (hiringSimReferralSeed) — and the team's replies
acted on, read by the prepare reads (hiringInterestScan, the typed pretend reply hiringSimPretendReply, the retry pass
hiringSimRetryNow). A door Apps Script presses from another is pressed in this same write; one Python does not answer
yet is skipped where Apps Script skips it, and defers the write where Apps Script needs it. Every guard that a door
touches only rehearsal cards stands."""
from __future__ import annotations

import json
import re
import secrets
import sys
from datetime import timezone
from typing import Any, Callable

import candidate_writes as CW
import candidates as CND
import gsjs
import hiring_intake_writes as HIW
import hiring_sim as HS
import hiring_sim_defaults as D
import house_tables as HT
import hubdb
import locations as L
import opt_outs as OO
import recon as RC
import resource_rows as RR
import staff_views
import writes as W
from scope import Defer
from writes import Decision

BORROWED_MIN = 400
STRANGER = "’"

s_ = gsjs.str_


def _hex(n: int) -> str:
    """randomHex_(n), upper-cased as the ids take it."""
    return secrets.token_hex((n + 1) // 2)[:n].upper()


def _by(user: dict) -> str:
    """hiringLegacyWrite_'s `by` for hubSetFieldLastRow_: the account, else the runtime's own word."""
    return s_(user.get("email")) or "runtime-write"


def _dissolved(reads: L.Reads, *tabs: str) -> None:
    for t in tabs:
        if not reads.db.dissolved(t):
            raise Defer(f"{t} is written as the runtime's facts only while it is dissolved")


def journey(reads: L.Reads, cid: str, name: str, line: dict[str, Any]) -> list[dict]:
    """journeyLog_: the line on the dissolved journey (and the runtime's Events while that book is on); its title the
    one written, else the step's words in the book, else the step."""
    step = s_(line.get("step"))
    title = s_(line.get("title")) or HS._soft(lambda: CND.journey_steps(reads).get(step, ""), "") or step
    return CW.journey_records(reads, {"key": cid, "name": name}, {**line, "title": title}, "")[2]


def ask_answer(reads: L.Reads, steps: tuple[str, ...], by: str, cid: str, now: str, closed: set[str]) -> list[dict]:
    """simAskAnswer_: the named steps' asks closed in either live state (open or exhausted) — a reply arrived; the
    subjects in `closed` (gone, or closed already in this write) skipped, and the ones closed here added."""
    recs: list[dict] = []
    for sub, row in HS._soft(lambda: CW.dissolved_rows(reads, HS.ASKS_TAB), {}).items():
        if sub in closed or s_(row.get("state")) not in ("open", "exhausted") or s_(row.get("step")) not in steps:
            continue
        if cid and s_(row.get("candidateid")) and s_(row.get("candidateid")) != cid:
            continue
        recs += CW.facts_of(reads, HS.ASKS_TAB, sub, {"state": "answered", "answered_at": now,
                                                      "answered_by": s_(by)[:120]}, "runtime-sheet", cid, "", at=now)
        closed.add(sub)
    return recs


class Missing(Defer):
    """A door pressed in-process that Python does not answer yet (Apps Script's typeof HUB_ACTIONS[action] check);
    raised before anything was pressed, so a caller that skips such a door, as Apps Script does, may go on."""


def press(sess: L.Session, action: str, payload: dict, user: dict) -> tuple[dict[str, Any], list[dict]]:
    """HUB_ACTIONS[action](payload, user) inside this write, as Apps Script presses one door from another: its answer
    and the records it keeps. A door Python does not answer yet (Missing), or one that hands its write to Apps Script,
    defers this one."""
    fn = None
    for mod in list(sys.modules.values()):
        acts = getattr(mod, "ACTIONS", None)
        if isinstance(acts, dict) and action in acts and hasattr(mod, "BUSY_OF"):
            fn = acts[action]
            break
    if fn is None:
        raise Missing(f"{action} is not answered in Python yet")
    got = fn(L.Session(sess.reads, user), payload)
    if not isinstance(got, Decision):
        return dict(got or {"status": 200}), []
    if got.engine or got.lay or got.deliver or got.record:
        raise Defer(f"{action} hands its write to Apps Script")
    return dict(got.answer or {"status": 200}), list(got.edits or [])


def softly(fn: Callable[[], Any]) -> tuple[Any, str]:
    """fn inside a savepoint of this write, as Apps Script's try/catch around an in-process press: (its result, '') or
    (None, why) with every row it kept taken back. A door that cannot be decided here (Defer: one Python does not
    answer, or one read by its own prepare door first) and the database's own failures stay the caller's, its rows
    taken back as well."""
    cur = W.HELD.get()
    if cur is None:
        raise Defer("a door is pressed in-process only under the platform's write lock")
    name = "hiring_sim_" + secrets.token_hex(5)
    cur.execute(f"savepoint {name}")
    try:
        got = fn()
    except Exception as exc:
        cur.execute(f"rollback to savepoint {name}")
        cur.execute(f"release savepoint {name}")
        if isinstance(exc, (Defer, hubdb.Unreadable)):
            raise
        return None, str(exc)[:200] or type(exc).__name__
    cur.execute(f"release savepoint {name}")
    return got, ""


# ---- the config (hiringSimConfigSet) --------------------------------------------------------------------------------

def config_set(sess: L.Session, payload: dict) -> Decision:
    """hiringSimConfigSet: each edited cell saved (every row of its key), a key never seen appended with its note."""
    reads, user = sess.reads, sess.user or {}
    if not HS.writer(user):
        return Decision(dict(HS.DENIED))
    values = (payload or {}).get("values")
    values = values if isinstance(values, dict) else {}
    unknown = [k for k in values if HS.default_of(k) is None]
    if unknown:
        return W.refuse(400, "This backend version does not know: " + ", ".join(unknown) + ".")
    _dissolved(reads, HS.CFG_TAB)
    W.gate(reads)
    have = CW.dissolved_rows(reads, HS.CFG_TAB)
    now = W.now_iso(reads)
    recs: list[dict] = []
    saved: dict[str, str] = {}
    for key, raw in values.items():
        v = gsjs.or_blank(raw)
        if key in have:
            recs += CW.facts_of(reads, HS.CFG_TAB, key, {"value": v}, "runtime-sheet", "", "", at=now)
        else:
            recs += CW.facts_of(reads, HS.CFG_TAB, key, {"key": key, "value": v, "note": HS.default_of(key)[1]},
                                "runtime-sheet:append", "", "", at=now)
        saved[key] = s_(v)
    HS.laid(reads, saved)
    staff_views.record(user, "hiring_sim_config_set", f"{len(saved)} key(s)")
    return W.final({"status": 200, "data": {"saved": len(saved), "actors": HS.actors(reads)}}, recs, "")


# ---- the rehearsal card's evidence and transcript ----------------------------------------------------------------

def _rehearsal_card(reads: L.Reads, cid: str, refusal: str) -> tuple[dict | None, Decision | None]:
    if not HS.CAN_ID.match(cid):
        return None, W.refuse(400, "invalid candidate_id")
    cand = CND.evidence(reads, cid).get("cand")
    if not cand:
        return None, W.refuse(404, f'No candidate "{cid}".')
    if not HS.is_test_card(reads, cand):
        return None, W.refuse(409, refusal)
    return cand, None


def evidence_fill(sess: L.Session, payload: dict) -> Decision:
    """hiringSimEvidenceFill: the actor phone, a resume mark, the resume decision and CJIS Clear on a rehearsal card,
    every line signed by the SIM."""
    reads, user = sess.reads, sess.user or {}
    if not HS.writer(user):
        return Decision(dict(HS.DENIED))
    cid = s_((payload or {}).get("candidate_id"))
    cand, refused = _rehearsal_card(reads, cid, "Sim evidence lands on REHEARSAL cards only — a real candidate's "
                                                "resume, decision and CJIS are earned, never typed.")
    if refused:
        return refused
    _dissolved(reads, CW.CANDIDATES, CW.RESUME)
    W.gate(reads)
    c = HS.contacts(reads)
    now, by = W.now_iso(reads), _by(user)
    recs = CW.facts_of(reads, CW.CANDIDATES, cid, {
        "phone": c["phone"] or s_(cand.get("phone")),
        "resume_link": s_(cand.get("resumelink")) or "(SIM) resume received by e-mail — sample on file"},
        by, cid, "", at=now)
    recs += CW.facts_of(reads, CW.RESUME, cid, {"decision_status": "Advance", "cjis_status": "Clear"}, by, cid, "",
                        at=now)
    recs += journey(reads, cid, s_(cand.get("candidatename")), {
        "step": "welcome", "title": "The missing pieces landed (sim)", "channel": "record", "ok": True,
        "rehearsal": True, "by": s_(user.get("email")),
        "detail": "SIM filled: the actor phone, a sample resume mark, resume decision Advance, CJIS Clear — stand-ins "
                  "for the inbox scan, the folder sweep and the recruiter's own presses"})
    return W.final({"status": 200, "data": {"filled": True, "note": "phone + resume mark + decision Advance + CJIS Clear "
                                                                    "are on the card — the DECISION is the one the gate "
                                                                    "reads; the other two light their squares"}},
                   recs, cid)


def call_complete(reads: L.Reads, text: str) -> bool:
    """hubCallComplete_: the call reached its own goodbye — the farewell pattern is a cell (words.goodbye.regex)."""
    src = HS._soft(lambda: CND.book_text(reads, "Strings", "words.goodbye.regex", ""), "")
    if not src:
        return False
    try:
        return re.search(src, text[-500:].lower()) is not None
    except re.error:
        return False


def _ten(v: Any) -> str:
    """The digits, a leading 1 dropped."""
    d = re.sub(r"\D", "", s_(v))
    return d[1:] if d.startswith("1") else d


def comms_transcripts(reads: L.Reads) -> list[dict]:
    """readTabNormalized_(HUB_COMMS_ID, 'transcripts'): the comms window's calls."""
    import staff_comms as STC  # noqa: PLC0415 - the normalized reader every copy shares
    sid = gsjs.trim(reads.db.prop("HUB_COMMS_ID"))
    ref = HT.tab_of(reads, sid, "transcripts", "the comms book") if sid else None
    if ref is None:
        raise RuntimeError("the transcripts tab is not in the comms book")
    return STC._normalized(reads, ref, False)


def transcript_seed(sess: L.Session, payload: dict) -> Decision:
    """hiringSimTranscriptSeed: a real screen's transcript (or the newest complete call on the evaluation line, or the
    built-in sample) borrowed onto a rehearsal card so the reading machinery can be validated without a live call."""
    reads, user = sess.reads, sess.user or {}
    if not HS.writer(user):
        return Decision(dict(HS.DENIED))
    cid = s_((payload or {}).get("candidate_id"))
    cand, refused = _rehearsal_card(reads, cid, "That card is not a rehearsal. A borrowed transcript belongs on a [TEST] "
                                                f"card only — a real candidate must never carry a conversation that was "
                                                f"somebody else{STRANGER}s.")
    if refused:
        return refused
    want = HS._soft(lambda: HS.val(reads, "sim_transcript_from"), "")
    tests = HS._soft(lambda: {s_(c.get("candidateid")) for c in CND.read_tab(reads, CND.TALENT_CANDIDATES_TAB)
                              if s_(c.get("candidatename")).lower().startswith("[test]")}, set())
    screens, why = CND.soft(lambda: CND.read_tab(reads, CND.TALENT_PHONE_TAB))
    if why:
        return W.refuse(500, "The phone screens tab could not be read.")
    source: dict[str, str] | None = None
    for s in screens or []:
        scid = s_(s.get("candidateid"))
        if not scid or scid == cid or scid in tests:
            continue
        if len(s_(s.get("transcripttext"))) < BORROWED_MIN or (want and scid != want):
            continue
        source = {"candidateid": scid, "transcripttext": s_(s.get("transcripttext"))}
    if source is None and not want:
        def the_line() -> dict[str, str] | None:
            d = _ten(HS._soft(lambda: HS.val(reads, "sim_screen_line"), ""))
            digits = d if len(d) == 10 else HS.SCREEN_DIGITS
            hit: dict[str, str] | None = None
            for t in comms_transcripts(reads):
                if _ten(t.get("quonumber")) != digits:
                    continue
                text = s_(t.get("speakertranscript")) or s_(t.get("fulltranscript"))
                # only a complete call: a cut transcript scores as a bad candidate, not a bad sample
                if len(text) < BORROWED_MIN or not call_complete(reads, text):
                    continue
                if hit is None or len(text) > len(hit["transcripttext"]):
                    hit = {"candidateid": f"the 4040 line (call {s_(t.get('callid')) or 'unknown'})",
                           "transcripttext": text}
            return hit or {"candidateid": "the built-in sample call (a complete Sona screening)",
                           "transcripttext": D.SAMPLE_TRANSCRIPT}
        source = HS._soft(the_line, None)
    if source is None:
        return W.refuse(404, f"No completed transcript on file for {want} — clear sim_transcript_from to take the "
                             "newest one instead." if want else
                        "Nothing to borrow anywhere: no phone screen carries a transcript, and the comms window has no "
                        "call on the evaluation line. Run Comms → Sync (or make one call to the 4040) and press again.")
    _dissolved(reads, CW.PHONE)
    W.gate(reads)
    now = W.now_iso(reads)
    borrowed = (f"BORROWED TRANSCRIPT — copied by the simulator on {now} from {source['candidateid']} so the reading "
                "machinery can be validated without a live call. Every fact below belongs to the ORIGINAL conversation."
                "\n\n" + source["transcripttext"])
    recs = CW.facts_of(reads, CW.PHONE, cid, {
        "screen_status": "Completed", "screen_date": now, "transcript_text": borrowed,
        "transcript_call_id": "SIM_BORROWED_" + _hex(8), "transcript_created": now, "transcript_pulled_at": now,
        "screened_by": "asa-hub:sim-transcript:" + s_(user.get("email"))}, _by(user), cid, "", at=now)
    chars = len(source["transcripttext"])
    recs += journey(reads, cid, s_(cand.get("candidatename")), {
        "step": "screen_done", "title": "A borrowed transcript is on the card", "channel": "record", "ok": True,
        "rehearsal": True, "by": s_(user.get("email")),
        "detail": f"copied from {source['candidateid']} ({chars} chars) — press Analyze next"})
    return W.final({"status": 200, "data": {"seeded": True, "source_candidate": source["candidateid"], "chars": chars,
                                            "note": "the card reads Completed with the borrowed words — run the "
                                                    "analysis next"}}, recs, cid)


# ---- the teardown (hiringSimReset) ------------------------------------------------------------------------------

def _inbound_cid(cells: dict) -> str:
    return s_(next((v for k, v in cells.items() if hubdb.norm_key(k) == "candidateid"), ""))


def reset(sess: L.Session, payload: dict) -> Decision:
    """hiringSimReset: a provable rehearsal and every row filed against it removed (a dissolved row's tombstone, an
    inbound row marked removed in Postgres); the ask and shortlist asks closed; the "(SIM)" files its prepare read put
    in the bin counted."""
    reads, user = sess.reads, sess.user or {}
    p = payload if isinstance(payload, dict) else {}
    cid = s_(p.get("candidate_id"))
    refused, _card = HS.reset_refusal(reads, user, cid)
    if refused:
        return Decision(refused)
    prep = RC.unsealed("hiringSimReset", RC.actor(user), p.get("prepared"))
    files = int((prep or {}).get("sim_files_trashed") or 0) if s_((prep or {}).get("candidate_id")) == cid else 0
    W.gate(reads)
    now = W.now_iso(reads)
    removed: dict[str, int] = {}
    failed: list[str] = []
    gone: dict[str, set[str]] = {}
    recs: list[dict] = []
    for tab, col in HS.TABS:
        key = hubdb.norm_key(col)
        if reads.db.dissolved(tab):
            kill = [sub for sub, row in CW.dissolved_rows(reads, tab).items() if s_(row.get(key)) == cid]
            for sub in kill:
                recs += CW.facts_of(reads, tab, sub, {"__deleted": "true"}, "runtime-sheet:delete", cid, "", at=now)
            gone[tab] = set(kill)
        elif tab == OO.INBOUND_TAB and RR.uploaded(reads.db, OO.INBOUND_RESOURCE):
            kill = [(k, c) for k, c in RR.table_rows(reads, OO.INBOUND_RESOURCE) if _inbound_cid(c) == cid]
            for k, c in kill:
                RR.remove(reads, OO.INBOUND_RESOURCE, k, c, s_(user.get("email")))
        elif tab == OO.INBOUND_TAB:
            if any(s_(r.get("candidateid")) == cid for r in OO.inbound_rows(reads)):
                failed.append(f"{tab}: the inbound log is the sheet's copy until it is uploaded to Postgres, and no "
                              "sheet row is removed from here")
            continue
        else:
            failed.append(f"{tab}: no sheet answered at its declared address")
            continue
        if kill:
            removed[tab] = len(kill)
    # the team's asks close with the rehearsal
    recs += ask_answer(reads, ("ask", "shortlist"), "torn down", "", now, set(gone.get(HS.ASKS_TAB, set())))
    staff_views.record(user, "hiring_sim_reset", cid + " — " + json.dumps(removed, separators=(",", ":"))
                       + (f" + {files} (SIM) file(s) trashed from the docs folder" if files else ""))
    note = (f"the rehearsal was torn down, but {len(failed)} tab(s) did not answer — rows may still be filed against "
            "it; see failed" if failed else "the rehearsal and everything filed against it are gone")
    return W.final({"status": 200, "data": {"removed": removed, "failed": failed, "sim_files_trashed": files,
                                            "note": note}}, recs, cid)


# ---- the flow entrances ------------------------------------------------------------------------------------------

def _hms(reads: L.Reads) -> str:
    """new Date().toISOString().slice(11, 19) without its colons."""
    return reads.now.astimezone(timezone.utc).strftime("%H%M%S")


def _contacts_refusal(c: dict) -> str:
    """hiringSimSeed's refusals: the card IS those mailboxes, or test mode is what stands between it and a person."""
    if c["mode"] == "actors":
        if c["email"] and c["phone"]:
            return ""
        return ("Actors mode needs both rehearsal contacts configured (" +
                ("" if c["email"] else "sim_candidate_email is empty") + ("" if c["email"] or c["phone"] else " and ") +
                ("" if c["phone"] else "sim_candidate_phone is empty") +
                "). Fill them in the simulation config — the card IS those mailboxes, and they are the only thing "
                f"keeping a rehearsal letter out of a stranger{STRANGER}s inbox.")
    if not c["on"]:
        return ("Test mode is OFF. Turn it on in Settings before running a rehearsal — every step below sends a real "
                "message, and test mode is the only thing standing between this card and a real candidate. (Or switch "
                "the simulation to actors mode in its config.)")
    if not c["phone"] or not c["email"]:
        return ("Test mode is on but one of the two rehearsal endpoints is empty (" +
                ("" if c["phone"] else "no SMS number") + ("" if c["phone"] or c["email"] else " and ") +
                ("" if c["email"] else "no e-mail address") +
                "). A channel with nobody on it refuses every send, so half the rehearsal would look broken rather "
                "than tested.")
    return ""


def sim_seed(sess: L.Session, payload: dict) -> Decision:
    """hiringSimSeed: the card the rehearsal walks — found, or made through the intake on the rehearsal contacts."""
    reads, user = sess.reads, sess.user or {}
    if not HS.writer(user):
        return Decision(dict(HS.DENIED))
    p = payload if isinstance(payload, dict) else {}
    c = HS.contacts(reads)
    why = _contacts_refusal(c)
    if why:
        return W.refuse(409, why)
    existing = HS.sim_card(reads)
    if existing and not p.get("fresh"):
        return Decision({"status": 200, "data": {"candidate_id": s_(existing.get("candidateid")),
                                                 "name": s_(existing.get("candidatename")), "created": False,
                                                 "phone": s_(existing.get("phone")),
                                                 "email": s_(existing.get("email"))}})
    W.gate(reads)
    env, recs = HIW.intake_records(L.Session(reads, user), {
        "first_name": HS.SIM_FIRST, "last_name": s_(p.get("name")) or f"{HS.SIM_LAST} {_hms(reads)}",
        "phone": c["phone"], "email": c["email"], "source": "Simulator"}, None)
    if env.get("status") != 200:
        return Decision({"status": env.get("status") or 500,
                         "message": s_(env.get("message")) or "the intake refused the rehearsal card"})
    data = env.get("data") if isinstance(env.get("data"), dict) else {}
    cid = s_(data.get("candidate_id") or data.get("id"))
    name = f"{HS.SIM_FIRST} {HS.SIM_LAST}"
    recs += journey(reads, cid, name, {"step": "welcome", "title": "Rehearsal card created", "channel": "sim",
                                       "to": c["email"], "ok": True, "rehearsal": True, "by": s_(user.get("email")),
                                       "detail": "the simulator created a rehearsal card on the test contacts"})
    return W.final({"status": 200, "data": {"candidate_id": cid, "created": True, "phone": c["phone"],
                                            "email": c["email"], "name": name}}, recs, cid)


def _card_of(recs: list[dict]) -> tuple[str, str]:
    """The rehearsal card a pressed door filed: its id and name, off the candidate facts it keeps."""
    prefix = "dissolution:" + CW.CANDIDATES + ".candidatename"
    for r in recs:
        cells = r.get("cells") or {}
        if s_(cells.get("Source")) == prefix and s_(cells.get("Value")).lower().startswith("[test]"):
            return s_(cells.get("Subject ID")), s_(cells.get("Value"))
    return "", ""


def referral_seed(sess: L.Session, payload: dict) -> Decision:
    """hiringSimReferralSeed: the referral flow's first press — the real public door files a rehearsal referral with
    a name and the actor's e-mail, nothing else."""
    reads, user = sess.reads, sess.user or {}
    if not HS.writer(user):
        return Decision(dict(HS.DENIED))
    c = HS.contacts(reads)
    if not c["email"]:
        return W.refuse(409, "sim_candidate_email is empty — the referral needs a mailbox to land on.")
    existing = HS.sim_card(reads)
    if existing:
        return Decision({"status": 200, "data": {
            "candidate_id": s_(existing.get("candidateid")), "created": False, "name": s_(existing.get("candidatename")),
            "note": "a rehearsal card already exists — tear it down first to rehearse the arrival"}})
    W.gate(reads)
    # no file, no résumé text and an e-mail on it: the door has nothing to read first
    env, recs = HIW.referral_submit(L.Session(reads, user), {
        "name": f"{HS.SIM_FIRST} Referral {_hms(reads)}", "email": c["email"], "phone": "", "referrer": "the simulator",
        "resume_text": ""}, None)
    ok = env.get("status") == 200
    cid, name = _card_of(recs) if ok else ("", "")
    data = env.get("data") if isinstance(env.get("data"), dict) else {}
    cid = cid or (s_(data.get("candidate_id")) if ok else "")
    if ok:
        recs += journey(reads, cid, name, {
            "step": "welcome", "title": "A rehearsal referral arrived", "channel": "record", "ok": True,
            "rehearsal": True, "by": s_(user.get("email")),
            "detail": "through the REAL public door (referralSubmit) — an e-mail only, no phone, no resume: the "
                      "exception lane begins"})
    return W.final({"status": 200, "data": {
        "created": ok, "door": env.get("status"), "message": s_(env.get("message")), "candidate_id": cid,
        "name": name,
        "note": "the referral card exists on the actor mailbox — the REFERRAL ask is the next press" if ok
        else "the public door refused: " + s_(env.get("message"))}}, recs, cid)


# ---- the team's reply, acted on (simInterestAct_, hiringInterestScan, hiringSimPretendReply) -------------------------

SVC_SCAN = {"role": "manager", "email": "hiring-sim-scan@service.local", "id": "SVC_HIRING_SIM"}
SVC_RETRY = {"role": "manager", "email": "hiring-sim-retry@service.local", "id": "SVC_HIRING_SIM"}
HANDED_MAX = 200


def try_press(sess: L.Session, action: str, payload: dict, actor: dict) -> tuple[dict | None, list[dict], bool]:
    """A press Apps Script wraps in its try/catch: (its answer, or None when it threw; its records; whether it is
    handed to the relay — a door this write cannot decide, read by its own prepare door first or not in Python yet)."""
    try:
        got, _why = softly(lambda: press(sess, action, payload, actor))
    except Defer:
        return None, [], True
    return (None, [], False) if got is None else (got[0], got[1], False)


def handed_entry(kind: str, action: str, payload: dict, actor: dict, **said: Any) -> dict[str, Any]:
    """A press handed to the relay: it presses `action` with `payload` through the door's own lane as `as`, then gives
    the entry back to hiringSimPressRecord with the door's status, data and message."""
    return {"kind": kind, "action": action, "payload": payload, "as": actor["email"], **said}


def more_line(reads: L.Reads, mid: str, frm: str, ok: bool) -> list[dict]:
    return journey(reads, "", "", {"step": "interest", "title": "The team asked for more options", "channel": "email",
                                   "ok": ok, "ref": mid, "by": frm,
                                   "detail": f"reply from {frm} — sent the next 5 from the ranking window"})


def retry_line(reads: L.Reads, step: str, cid: str, count: int, most: int, sent: bool, why_not: str) -> list[dict]:
    return journey(reads, cid, "", {
        "step": "sim_retry", "title": "Asked again — no reply yet" if sent else "The re-ask did not go out",
        "channel": "sim", "ok": sent, "by": "asa-hub:sim-retry",
        "detail": f"{step} — attempt {count + 1} of {most}" if sent
        else f"{step} — still on attempt {count} of {most} ({why_not or 'nothing was sent'})"})


def _outcome(env: dict | None) -> tuple[bool, str]:
    """200 is not "sent": a door that says whether it sent is believed."""
    env = env or {}
    data = env.get("data") if isinstance(env.get("data"), dict) else {}
    sent = bool(data["sent"]) if "sent" in data else env.get("status") == 200
    return sent, s_(data.get("reason") or data.get("detail") or env.get("message"))


def ai_row(reads: L.Reads, mid: str, verdict: str, names: list[str], via: str, now: str) -> list[dict]:
    """One verdict per message, ever: the verdict book's row."""
    return CW.facts_of(reads, HS.AI_TAB, mid, {"message_id": mid, "verdict": verdict, "names": "; ".join(names),
                                                "via": via, "seen_at": now}, "runtime-sheet:append", "", "", at=now)


def interest_act(sess: L.Session, verdict: str, names: list[str], frm: str, mid: str, listed: list[dict],
                 now: str, closed: set[str], handed: list[dict]) -> tuple[dict[str, Any], list[dict]]:
    """simInterestAct_: what a team verdict does — the asking stops on a yes (and each chosen card says so, the
    rehearsal card born from the choice); "more" sends the next five from the ranking window (handed to the relay when
    the shortlist is read by its own prepare door first)."""
    reads = sess.reads
    out: dict[str, Any] = {"acted": ""}
    recs: list[dict] = []
    if verdict in ("ok", "selected"):
        recs += ask_answer(reads, ("ask", "shortlist"), frm, "", now, closed)
        out["acted"] = verdict
        if verdict == "ok":
            detail = (f"reply from {frm} — start with the shortlist as sent" if listed
                      else f"reply from {frm} — hiring is open; the shortlist is the next step")
        else:
            detail = f"reply from {frm} — chosen: " + (", ".join(names) or "(no listed name matched)")
        recs += journey(reads, "", ", ".join(names), {
            "step": "interest", "channel": "email", "to": "", "ok": True, "detail": detail, "ref": mid, "by": frm,
            "title": "The team said to proceed" if verdict == "ok" else "The team chose who to proceed with"})
        for n in names:
            hit = None
            for x in listed:
                if x["name"].lower() == n.lower():
                    hit = x
            if hit:
                recs += journey(reads, hit["candidate_id"], hit["name"], {
                    "step": "interest", "channel": "email", "ok": True, "ref": mid, "by": frm,
                    "detail": f"named by {frm} as somebody to proceed with"})
        # the rehearsal card is born from the choice, ALL the chosen names on it
        if verdict == "selected" and names and HS.sim_card(reads) is None:
            try:
                d, err = softly(lambda: sim_seed(L.Session(reads, SVC_SCAN), {"name": ", ".join(names)}))
            except Defer as exc:
                d, err = None, str(exc)
            if d is None:
                out["card_error"] = "the seed threw: " + err
            else:
                env = d.answer or {}
                data = env.get("data") if isinstance(env.get("data"), dict) else {}
                if env.get("status") == 200 and data.get("created"):
                    recs += list(d.edits or [])
                    out["card"] = s_(data.get("candidate_id"))
                    recs += journey(reads, out["card"], s_(data.get("name")), {
                        "step": "interest", "channel": "", "ok": True, "ref": mid, "by": frm,
                        "detail": f"the rehearsal card was born from the choice — {len(names)} name(s) on it, the "
                                  "actor mailboxes behind it: " + ", ".join(names)})
                else:
                    out["card_error"] = s_(env.get("message")) or f"the seed answered {env.get('status')}"
                    recs += journey(reads, "", ", ".join(names), {
                        "step": "interest", "channel": "", "ok": False, "ref": mid, "by": frm,
                        "detail": "the choice could NOT mint the rehearsal card — " + out["card_error"]})
    elif verdict == "more":
        out["acted"] = "more"
        # no_auto: the auto decider must not answer the letter its own "more" just asked for
        asked = {"limit": 5, "exclude_ids": [x["candidate_id"] for x in listed if x["candidate_id"]], "no_auto": True}
        env, more, hand = try_press(sess, "hiringShortlistSend", asked, SVC_SCAN)
        if hand:
            handed.append(handed_entry("more", "hiringShortlistSend", asked, SVC_SCAN, mid=mid, frm=frm))
        else:
            recs += more + more_line(reads, mid, frm, bool(env) and env.get("status") == 200)
    return out, recs


def interest_record(sess: L.Session, scan: dict, now: str, closed: set[str],
                    handed: list[dict]) -> tuple[dict[str, Any], list[dict]]:
    """hiringInterestScanRun_'s acting half: each new verdict remembered, then acted on ('other' moves nothing)."""
    reads = sess.reads
    out: dict[str, Any] = {"read": int(scan.get("read") or 0), "judged": 0, "acted": "", "names": []}
    if scan.get("error"):
        out["error"] = s_(scan.get("error"))
    seen = HS.judged(reads)
    listed = HS.shortlist_names(reads)
    recs: list[dict] = []
    for v in scan.get("verdicts") or []:
        mid = s_(v.get("mid"))
        if not mid or mid in seen:
            continue
        names = [gsjs.js_str(n) for n in v.get("names") or []]
        recs += ai_row(reads, mid, s_(v.get("verdict")), names, s_(v.get("via")), now)
        seen[mid] = s_(v.get("verdict"))
        out["judged"] += 1
        acted, more = interest_act(sess, s_(v.get("verdict")), names, s_(v.get("from")), mid, listed, now, closed,
                                   handed)
        recs += more
        if acted["acted"]:
            out["acted"], out["names"] = acted["acted"], names
    return out, recs


def _prepared(sess: L.Session, door: str, p: dict) -> dict | None:
    return RC.unsealed(door, RC.actor(sess.user), p.get("prepared"))


def interest_scan(sess: L.Session, payload: dict) -> Decision:
    """hiringInterestScan: the deciders' replies, read now by its prepare read, remembered and acted on."""
    reads, user = sess.reads, sess.user or {}
    if not HS.writer(user):
        return Decision(dict(HS.DENIED))
    prep = _prepared(sess, "hiringInterestScan", payload if isinstance(payload, dict) else {})
    if prep is None:
        return W.refuse(409, "The mailbox was not read just now — press again.")
    _dissolved(reads, HS.AI_TAB, HS.ASKS_TAB, CW.JOURNEY)
    W.gate(reads)
    handed: list[dict] = []
    out, recs = interest_record(sess, prep.get("scan") or {}, W.now_iso(reads), set(), handed)
    if handed:
        out["handed"] = handed
    return W.final({"status": 200, "data": out}, recs, "")


def pretend_reply(sess: L.Session, payload: dict) -> Decision:
    """hiringSimPretendReply: a reply typed as the team, read by the same rule-then-model reader a real one meets
    (its prepare read) and acted on by the same code. The candidate's reply, the slot pick and the interviewer's answer
    ride doors Python does not answer yet."""
    reads, user = sess.reads, sess.user or {}
    if not HS.writer(user):
        return Decision(dict(HS.DENIED))
    p = payload if isinstance(payload, dict) else {}
    channel = s_(p.get("channel")).lower()
    if channel == "team":
        if not s_(p.get("text")):
            return W.refuse(400, "Type the reply you are pretending — the machine reads the words.")
        prep = _prepared(sess, "hiringSimPretendReply", p)
        if prep is None or s_(prep.get("channel")) != "team" or not s_(prep.get("verdict")):
            return W.refuse(409, "The reply was not read just now — send it again.")
        _dissolved(reads, HS.AI_TAB, HS.ASKS_TAB, CW.JOURNEY)
        W.gate(reads)
        now = W.now_iso(reads)
        frm = s_(p.get("from")) or (HS.actors(reads)["decider_emails"] or [""])[0]
        mid = "sim:pretend:" + secrets.token_hex(4)
        verdict, via = s_(prep.get("verdict")), s_(prep.get("via"))
        names = [gsjs.js_str(n) for n in prep.get("names") or []]
        recs = ai_row(reads, mid, verdict, names, via, now)
        handed: list[dict] = []
        acted, more = interest_act(sess, verdict, names, frm + " (pretend)", mid, HS.shortlist_names(reads), now, set(),
                                   handed)
        data = {"read_as": verdict, "names": names, "via": via,
                "acted": acted["acted"] or "nothing — the message decided nothing", "from": frm, "pretend": True}
        if handed:
            data["handed"] = handed
        return W.final({"status": 200, "data": data}, recs + more, "")
    if channel in ("candidate", "pick"):
        cid = s_(p.get("candidate_id"))
        if not HS.CAN_ID.match(cid):
            return W.refuse(400, "invalid candidate_id")
        if not HS.is_rehearsal(reads, cid):
            return W.refuse(409, "Pretend replies land on REHEARSAL cards only — this one is a real person."
                            if channel == "candidate" else "Pretend picks land on REHEARSAL cards only.")
        raise Missing("the candidate's reply is read by the outreach reply scan" if channel == "candidate"
                      else "the pick goes through the public scheduling door, which Python does not answer yet")
    if channel == "interviewer":
        if not s_(p.get("text")):
            return W.refuse(400, "Type the reply you are pretending — the machine reads the words.")
        raise Missing("the interviewer's answer is applied by the interview ask's reader, which Python does not "
                      "answer yet")
    return W.refuse(400, "channel must be team, candidate, pick or interviewer.")


# ---- the retry pass (hiringSimRetryRun_) ------------------------------------------------------------------------

def _open_ask(reads: L.Reads, cid: str) -> dict | None:
    """interviewAskOpenFor_: the candidate's open ask (last wins)."""
    hit = None
    for r in CND.ask_rows(reads):
        if s_(r.get("candidateid")) == cid and s_(r.get("state")) != "confirmed":
            hit = r
    return hit


def retry_now(sess: L.Session, payload: dict) -> Decision:
    """hiringSimRetryNow (and the relay's clock every fifteen minutes): first the ears (the deciders' replies its
    prepare read judged), then the mouth — each open ask answered by its own state, ended out loud once its attempts
    are spent, or pressed again when its clock says so. A press this write cannot decide (a door read by its own
    prepare door first, or one not in Python yet) is handed to the relay, which presses it and gives the outcome to
    hiringSimPressRecord; a door no lane holds is skipped, as Apps Script skips one it does not hold."""
    reads, user = sess.reads, sess.user or {}
    if not HS.writer(user):
        return Decision(dict(HS.DENIED))
    prep = _prepared(sess, "hiringSimRetryNow", payload if isinstance(payload, dict) else {})
    if prep is None:
        return W.refuse(409, "The replies were not read just now — run the retry pass again.")
    _dissolved(reads, HS.AI_TAB, HS.ASKS_TAB, CW.JOURNEY)
    W.gate(reads)
    now = W.now_iso(reads)
    now_ms = reads.now.timestamp() * 1000.0
    closed: set[str] = set()
    handed: list[dict] = []
    out: dict[str, Any] = {"open": 0, "resent": 0, "exhausted": 0, "answered": 0, "scanned": None}
    got, why = CND.soft(lambda: interest_record(sess, prep.get("scan") or {}, now, closed, handed))
    recs: list[dict] = []
    if why:
        out["scanned"] = {"error": why}
    else:
        out["scanned"], recs = got
    rows = [(sub, r) for sub, r in HS._soft(lambda: CW.dissolved_rows(reads, HS.ASKS_TAB), {}).items()
            if s_(r.get("state")) == "open" and sub not in closed]
    out["open"] = len(rows)
    for sub, r in rows:
        step, cid = s_(r.get("step")), s_(r.get("candidateid"))
        # the invite answers itself: the interview ask moved past 'invited'
        if step == "invite":
            st = s_((HS._soft(lambda: _open_ask(reads, cid), None) or {}).get("state"))
            if st and st != "invited":
                recs += ask_answer(reads, ("invite",), f"the candidate picked ({st})", cid, now, closed)
                out["answered"] += 1
                continue
        count = HS._int(r.get("sentcount")) or 0
        most = HS._int(r.get("maxattempts")) or 1
        mins = HS._int(r.get("intervalminutes")) or 30
        if count >= most:
            recs += CW.facts_of(reads, HS.ASKS_TAB, sub, {"state": "exhausted"}, "runtime-sheet", cid, "", at=now)
            recs += journey(reads, cid, "", {"step": "sim_retry", "title": "The asking ended without a reply",
                                             "channel": "sim", "ok": False, "by": "asa-hub:sim-retry",
                                             "detail": f"{step} — {count} attempt(s) made, none answered"})
            out["exhausted"] += 1
            continue
        last = CND.js_date_ms(r.get("lastsentat"))
        if last is not None and now_ms - last < mins * 60000:
            continue
        try:
            asked = json.loads(s_(r.get("payloadjson")) or "{}") or {}
        except ValueError:
            asked = {}
        action = s_(r.get("action"))
        asked = asked if isinstance(asked, dict) else {}
        # a step the machine re-asks by its own sweep names no door: nothing to press
        if not re.fullmatch(r"[a-z][A-Za-z0-9]*", action):
            continue
        env, more, hand = try_press(sess, action, asked, SVC_RETRY)
        if hand:
            handed.append(handed_entry("retry", action, asked, SVC_RETRY, ask_id=sub, step=step, candidate_id=cid,
                                       count=count, of=most))
            continue
        sent, why_not = _outcome(env)
        recs += more + retry_line(reads, step, cid, count, most, sent, why_not)
        if sent:
            out["resent"] += 1
    if handed:
        out["handed"] = handed
    return W.final({"status": 200, "data": out}, recs, "")


def press_record(sess: L.Session, payload: dict) -> Decision:
    """The outcome of each press the relay made for a handed entry (hiringInterestScan, hiringSimPretendReply,
    hiringSimRetryNow): the journey's line Apps Script wrote beside the press, and how many re-asks went out."""
    reads, user = sess.reads, sess.user or {}
    if not HS.writer(user):
        return Decision(dict(HS.DENIED))
    results = (payload or {}).get("results")
    if not isinstance(results, list) or len(results) > HANDED_MAX:
        return W.refuse(400, f"results: the handed entries, each with the pressed door's status (up to {HANDED_MAX}).")
    _dissolved(reads, CW.JOURNEY)
    W.gate(reads)
    recs: list[dict] = []
    resent = 0
    for r in results:
        if not isinstance(r, dict):
            continue
        env = {"status": r.get("status"), "data": r.get("data"), "message": r.get("message")}
        if r.get("kind") == "retry":
            sent, why_not = _outcome(env)
            count, most = HS._int(r.get("count")) or 0, HS._int(r.get("of")) or 1
            recs += retry_line(reads, s_(r.get("step")), s_(r.get("candidate_id")), count, most, sent, why_not)
            resent += 1 if sent else 0
        elif r.get("kind") == "more":
            recs += more_line(reads, s_(r.get("mid")), s_(r.get("frm")), env["status"] == 200)
    return W.final({"status": 200, "data": {"recorded": len(results), "resent": resent}}, recs, "")


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {
    "hiringSimConfigSet": config_set, "hiringSimEvidenceFill": evidence_fill, "hiringSimTranscriptSeed": transcript_seed,
    "hiringSimReset": reset, "hiringSimSeed": sim_seed, "hiringSimReferralSeed": referral_seed,
    "hiringInterestScan": interest_scan, "hiringSimPretendReply": pretend_reply, "hiringSimRetryNow": retry_now,
    "hiringSimPressRecord": press_record}
POLICY: dict[str, dict[str, Any]] = {
    "hiringSimConfigSet": {"roles": ("admin", "manager")},
    "hiringSimEvidenceFill": {"roles": ("admin", "manager"), "params": {"candidate_id": "string"}},
    "hiringSimTranscriptSeed": {"roles": ("admin", "manager"), "params": {"candidate_id": "string"}},
    "hiringSimReset": {"roles": ("admin",), "params": {"candidate_id": "string"}},
    "hiringSimSeed": {"roles": ("admin", "manager"), "params": {"fresh": "boolean"}},
    "hiringSimReferralSeed": {"roles": ("admin", "manager")},
    "hiringInterestScan": {"roles": ("admin", "manager")},
    "hiringSimPretendReply": {"roles": ("admin", "manager"),
                              "params": {"channel": "string", "text": "string", "from": "string",
                                         "candidate_id": "string"}},
    "hiringSimRetryNow": {"roles": ("admin", "manager")},
    "hiringSimPressRecord": {"roles": ("admin", "manager"), "params": {"results": "array"}}}
BUSY_OF: dict[str, dict[str, Any]] = {a: {"status": 409, "message": W.BUSY} for a in ACTIONS}


class Store(RR.Store):
    """app.hiring_sim_writes and app.hiring_sim_receipts, beside the other apps' own; an inbound row the teardown
    removed is app.resource_rows', taken back with a void."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="hiring_sim", label="Hiring simulator")
