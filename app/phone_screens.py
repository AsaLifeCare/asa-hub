"""The phone screen's two drawer doors (apps-script/Comms.gs) off asa-hub-db: a candidate's screening call pulled from
the Comms mirror's transcripts onto their phone screen (screenPullTranscript), and a test card's screen reset with
every test call on the screening line retired (screenUseLast). The phone screens are dissolved, so each write is kept
as facts on the depot's Facts (hiringLegacyWrite_); a retired call is a row appended to the mirror's ignored_calls."""
from __future__ import annotations

import logging
import re
from typing import Any, Callable

import candidate_writes as CDW
import client_writes as CLW
import gsjs
import house_tables as HT
import hubdb
import locations as L
import smart_comms as SC
import staff_comms as SCM
import staff_views
import team_alerts as TA
import writes as W
from scope import Defer
from writes import Decision

log = logging.getLogger("asa-hub-app")

COMMS_PROP = "HUB_COMMS_ID"
IGNORED_TAB = "ignored_calls"
# Comms.gs: the screening assistant's line, the lines a screening can happen on, the test line, the cell cap
SCREEN_BOT_LINE = "3307544040"
SCREEN_LINES = (SCREEN_BOT_LINE,)
OPERATOR_LINE = "3309195558"
CELL_CAP = 45000
MIN_SCREEN_SEC = 60
# Talent.gs SHARED_LINE_DIGITS: the company's own lines
SHARED_LINE_DIGITS = ("3307544040", "3309195558", "3309195559")
CID = re.compile(r"CAN_[A-Za-z0-9]{6,}")
_SPEAKER = re.compile(r"\]\s*([^:\n]{3,40}):")
DENIED = {"status": 403, "message": "Requires an admin or manager account"}

s_ = gsjs.str_


def digits(v: Any) -> str:
    """commsDigits_."""
    return re.sub(r"\D+", "", gsjs.or_blank(v))


def when_ms(v: Any) -> float | None:
    """commsWhen_: a date-ish cell as ms; None when unreadable."""
    return gsjs.date_parse(gsjs.trim(gsjs.or_blank(v)))


def cap(v: Any) -> str:
    """commsCap_: cut to the cell cap, marked when cut."""
    t = gsjs.or_blank(v)
    return SC._cut16(t, CELL_CAP) + "\n[truncated]" if CLW.utf16_len(t) > CELL_CAP else t


def _number(v: Any) -> float:
    """Number(v) || 0."""
    if isinstance(v, bool):
        return 1.0 if v else 0.0
    if isinstance(v, (int, float)):
        n = float(v)
    else:
        t = gsjs.trim(gsjs.or_blank(v))
        if not t:
            return 0.0
        n = float(t) if re.fullmatch(r"[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?", t) else float("nan")
    return n if n == n else 0.0


def usable(duration: Any, text: str) -> dict[str, Any]:
    """commsScreenUsable_: a real screening — long enough, and both sides speaking when the transcript names them."""
    n = len({m.group(1).strip() for m in _SPEAKER.finditer(text or "")})
    secs = _number(duration)
    return {"ok": secs >= MIN_SCREEN_SEC and (n == 0 or n >= 2), "secs": secs, "speakers": n}


def _words(reads: L.Reads, key: str, said: dict[str, str] | None = None) -> str:
    """bookText_('Strings', key) as hiringRenderMail_ renders it."""
    t = CDW.book_text(reads, key)
    return CDW.render(t, said) if said else t


def _book(reads: L.Reads) -> str:
    sid = gsjs.trim(gsjs.or_blank(reads.db.prop(COMMS_PROP)))
    if not sid:
        raise hubdb.Unreadable(f"{COMMS_PROP} names no book")
    return sid


def comms_rows(reads: L.Reads, tab: str) -> list[dict]:
    """readTabNormalized_(ssOpen_(hubId_('HUB_COMMS_ID')), tab), off asa-hub-db's copy of the mirror."""
    def read() -> list[dict]:
        sid = _book(reads)
        ref = HT.tab_of(reads, sid, tab, f"{COMMS_PROP} {tab}")
        if ref is None:
            raise RuntimeError("Talent tab missing: " + tab)
        return SCM._normalized(reads, ref, False)
    return [dict(r) for r in reads.once("phone_screens:" + tab, read)]


def ignored_calls(reads: L.Reads) -> dict[str, bool]:
    """commsIgnoredCalls_: the calls retired by hand; none while the tab is not there."""
    try:
        return {s_(r.get("callid")): True for r in comms_rows(reads, IGNORED_TAB) if s_(r.get("callid"))}
    except Exception:  # noqa: BLE001 - the tab not created yet
        return {}


def summary_for(reads: L.Reads, call_id: str) -> dict | None:
    """commsSummaryFor_: the latest summary row for a call."""
    return next((r for r in reversed(comms_rows(reads, "summaries")) if s_(r.get("callid")) == call_id), None)


def card_floor_ms(c: dict) -> float:
    """commsTestCardFloorMs_ (commsCardWhenMs_): created_at, else updated_at, as ms; 0 when unreadable."""
    return gsjs.date_parse(s_(c.get("createdat")) or s_(c.get("updatedat"))) or 0.0


def _evidence(reads: L.Reads, cid: str) -> tuple[dict | None, dict]:
    """hubEvidence_'s candidate and phone screen, off the dissolved records with Python's own facts laid."""
    for tab in (CDW.CANDIDATES, CDW.PHONE):
        if not reads.db.dissolved(tab):
            raise Defer(f"{tab} is not dissolved: its sheet is Apps Script's to write")
    cand = CDW.dissolved_rows(reads, CDW.CANDIDATES, [cid]).get(cid)
    screen = CDW.dissolved_rows(reads, CDW.PHONE, [cid]).get(cid) or {}
    return cand, screen


def _screen_facts(sess: L.Session, cid: str, fields: dict[str, str], at: str) -> list[dict]:
    """hubSetFieldLastRow_ on the dissolved phone screens: hiringLegacyWrite_(tab, cid, fields, user.email)."""
    return CDW.facts_of(sess.reads, CDW.PHONE, cid, fields, CDW.who_email(sess.user), cid, "", at=at)


def pull_transcript(sess: L.Session, payload: dict) -> Decision:
    """screenPullTranscript: the candidate's screening call, newest usable first, from OUR transcripts onto their
    phone screen."""
    p = payload if isinstance(payload, dict) else {}
    user = sess.user or {}
    if not CLW.writer(user):
        return Decision(dict(DENIED))
    reads = sess.reads
    cid = s_(p.get("candidate_id"))
    if not CID.fullmatch(cid):
        return W.refuse(400, _words(reads, "refuse.candidate_id"))
    cand, screen = _evidence(reads, cid)
    if cand is None:
        return W.refuse(404, _words(reads, "refuse.no_candidate", {"id": cid}))
    CDW.marked(cand.get("phone"), screen.get("errorhold"), screen.get("notes"), screen.get("transcriptcallid"))
    if s_(screen.get("errorhold")).lower() == "true":
        return W.refuse(409, _words(reads, "refuse.comms.error_hold"))
    phone = digits(cand.get("phone"))
    if len(phone) >= 11 and phone.startswith("1"):
        phone = phone[1:]
    phone = phone[-10:]
    if len(phone) < 10:
        return W.refuse(409, _words(reads, "refuse.comms.no_phone"))
    ignored = ignored_calls(reads)
    rows = [r for r in comms_rows(reads, "transcripts") if not ignored.get(s_(r.get("callid")))]
    test = TA.test_card(reads, cand)
    if not test and phone in SHARED_LINE_DIGITS:
        return W.refuse(409, _words(reads, "refuse.comms.company_line"))
    floor = card_floor_ms(cand) if test else 0.0
    if test:
        reset = when_ms(screen.get("uselastresetat"))
        if reset is not None:
            floor = max(floor, reset)
    hit = None
    skipped = too_old = 0
    last_bad = None
    for r in reversed(rows):
        if digits(r.get("quonumber"))[-10:] not in SCREEN_LINES:
            continue
        part = digits(r.get("participants"))[-10:]
        mine = (part == "" or part in SHARED_LINE_DIGITS) if test else phone in digits(r.get("participants"))
        if not mine:
            continue
        if floor:
            w = when_ms(r.get("transcriptcreated"))
            if w is None or w < floor:
                too_old += 1
                continue
        body = s_(r.get("speakertranscript")) or s_(r.get("fulltranscript"))
        if not body:
            continue
        q = usable(r.get("durationsec"), body)
        if not q["ok"]:
            skipped += 1
            last_bad = q
            continue
        hit = r
        break
    if hit is None:
        if last_bad is not None:
            secs = last_bad["secs"]
            which = "refuse.comms.short.only" if skipped == 1 else "refuse.comms.short.latest"
            return W.refuse(409, _words(reads, "refuse.comms.calls_too_short", {
                "which": _words(reads, which) + " ",
                "secs": gsjs.num_str(secs),
                "assistant": " " + _words(reads, "refuse.comms.short.assistant_only")
                if last_bad["speakers"] == 1 else ""}))
        if too_old:
            return W.refuse(404, _words(reads, "refuse.comms.none_since_card", {"older": str(too_old)}))
        return W.refuse(404, _words(reads, "refuse.comms.none_in_window"))
    text = s_(hit.get("speakertranscript")) or s_(hit.get("fulltranscript"))
    CDW.marked(text)
    now = W.now_iso(reads)
    call_id = s_(hit.get("callid"))
    fields = {"transcript_text": cap(text), "transcript_call_id": call_id,
              "transcript_created": s_(hit.get("transcriptcreated")), "transcript_pulled_at": now}
    overwriting = test and bool(s_(screen.get("transcriptcallid"))) and s_(screen.get("transcriptcallid")) != call_id
    if overwriting:
        fields.update({"screen_date": s_(hit.get("transcriptcreated")), "screen_status": "Completed",
                       "screen_score": "", "qualification": "", "phone_screen_report_url": "", "final_result": "",
                       "notes": "", "best_in_person_day_time": ""})
    summary = summary_for(reads, call_id)
    if summary is not None and s_(summary.get("summary")) and (overwriting or not s_(screen.get("notes"))):
        fields["notes"] = "Summary: " + s_(summary.get("summary"))
    W.gate(reads)
    edits = _screen_facts(sess, cid, fields, now)
    answer = {"status": 200, "data": {
        "found": True, "call_id": call_id, "created": s_(hit.get("transcriptcreated")),
        "duration_sec": s_(hit.get("durationsec")), "turns": s_(hit.get("turns")), "chars": CLW.utf16_len(text),
        "has_summary": summary is not None, "preview": SC._cut16(text, 300)}}
    return W.final(answer, edits, cid)


def use_last(sess: L.Session, payload: dict) -> Decision:
    """screenUseLast: a test card's screen reset, every test call on the screening line retired with the one it
    carried; the one door out of the Force Error hold."""
    p = payload if isinstance(payload, dict) else {}
    user = sess.user or {}
    if not user or user.get("is_service") or s_(user.get("role")) != "admin":
        return Decision(dict(DENIED))
    reads = sess.reads
    cid = s_(p.get("candidate_id"))
    if not CID.fullmatch(cid):
        return W.refuse(400, _words(reads, "refuse.candidate_id"))
    cand, screen = _evidence(reads, cid)
    if cand is None:
        return W.refuse(404, _words(reads, "refuse.no_candidate", {"id": cid}))
    CDW.marked(cand.get("status"), screen.get("transcriptcallid"))
    if CDW.stage_of(cand.get("status")) != "phone-screen":
        return W.refuse(409, _words(reads, "refuse.use_last.stage"))
    if not TA.test_card(reads, cand):
        return W.refuse(403, _words(reads, "refuse.use_last.test_only"))
    now = W.now_iso(reads)
    ignored = ignored_calls(reads)
    retire: list[str] = []
    for r in comms_rows(reads, "transcripts"):
        call = s_(r.get("callid"))
        if not call or ignored.get(call):
            continue
        if digits(r.get("quonumber"))[-10:] != SCREEN_BOT_LINE:
            continue
        part = digits(r.get("participants"))
        if part[-10:] == "" or OPERATOR_LINE in part or part[-10:] in SHARED_LINE_DIGITS:
            retire.append(call)
    old = s_(screen.get("transcriptcallid"))
    if old and not ignored.get(old) and old not in retire:
        retire.append(old)
    W.gate(reads)
    edits: list[dict] = []
    if retire:
        edits += _retired(reads, retire, "use-the-last reset by " + CDW.who_email(user), now, cid)
    edits += _screen_facts(sess, cid, {
        "screen_status": "", "screen_date": "", "transcript_text": "", "transcript_call_id": "",
        "transcript_created": "", "transcript_pulled_at": "", "screen_score": "", "qualification": "",
        "phone_screen_report_url": "", "final_result": "", "notes": "", "best_in_person_day_time": "",
        "error_hold": "", "date_accepted_alert_at": "", "use_last_reset_at": now}, now)
    staff_views.record(user, "screen_use_last",
                       cid + " — " + _words(reads, "use_last.logged", {"retired": str(len(retire))}))
    answer = {"status": 200, "data": {"reset": True, "retired": len(retire), "message": _words(reads, "use_last.said")}}
    return W.final(answer, edits, cid)


def _retired(reads: L.Reads, calls: list[str], reason: str, at: str, subject: str) -> list[dict]:
    """ignored_calls' appendRow([id, reason, at]) per call, best effort as the door's own: a tab the copy lacks, or
    whose columns are not these three, keeps nothing (the reset floor still blocks the calls)."""
    try:
        sid = _book(reads)
        ref = HT.tab_of(reads, sid, IGNORED_TAB, f"{COMMS_PROP} {IGNORED_TAB}")
    except Exception:  # noqa: BLE001 - best effort, as Apps Script's
        return []
    if ref is None:
        return []
    heads = {hubdb.norm_key(h): gsjs.trim(gsjs.js_str(h)) for h in ref.headers if gsjs.trim(gsjs.js_str(h))}
    names = [heads.get(k) for k in ("callid", "reason", "addedat")]
    if any(n is None for n in names):
        log.warning("screenUseLast: %s carries no call_id, reason and added_at columns; the calls stay unretired",
                    IGNORED_TAB)
        return []
    return [W.kept_record(sid, ref.tab, "append", "cols:" + names[0], c, subject,
                          {names[0]: c, names[1]: reason, names[2]: at}) for c in calls]


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {
    "screenPullTranscript": pull_transcript, "screenUseLast": use_last}
# HUB_POLICY: the roles each door is declared for
POLICY: dict[str, dict[str, Any]] = {"screenPullTranscript": {"roles": ("admin", "manager")},
                                     "screenUseLast": {"roles": ("admin",)}}
BUSY_OF: dict[str, dict[str, Any]] = {a: {"status": 409, "message": W.BUSY} for a in ACTIONS}
