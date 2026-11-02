"""Smart Comms' screens answered off asa-hub-db: the Desk (SmartComms.gs smartCommsGet), the trail
(smartCommsHistory), the stops (OptOut.gs optOutList), the replies (CommQualify.gs commReplies), the board
(CommRecord.gs commBoard), the covered notices (CommOpenShiftCovered.gs openShiftCoveredBoard), the broadcast page
(CommBroadcast.gs staffBroadcastBoard) and the proposals (CommProposals.gs commProposalsList), each with Python's own
edits laid. Nothing here sends, seeds or writes."""
from __future__ import annotations

import functools
import json
import math
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

import candidates as CND
import editions
import gsjs
import house_tables as HT
import hubdb
import locations as L
import my_work as MW
import opt_outs as OO
import scope as sc
import staff as SP
import staff_comms as SC
from gsjs import NY, SheetDate
from scope import Defer

APP_ID = "smart-comms"
RELEASE_ID = "smartcomms"  # App Control's id, the save door's gate
# Props.gs HUB_DB_ID: the Core, where a tab no house declares lives (never the frozen 'ASA Hub — DB')
CORE_ID = MW.CORE_USERS_SHEET_ID
_JS_WS = L._JS_WS


def attempt(fn: Callable[[], Any]) -> tuple[Any, str]:
    """A try/catch of the code being ported: its own failure said in words; the database's is never swallowed."""
    try:
        return fn(), ""
    except (hubdb.Unreadable, Defer):
        raise
    except Exception as e:  # noqa: BLE001 - the code being ported says why in words
        return None, str(e) or type(e).__name__

# ---- SmartComms.gs ---------------------------------------------------------------------------------------------------

SMART_TAB = "smart_comms"
SMART_LEDGER_TAB = "smart_comms_sent"
SMART_LEDGER_HEADER = ("key", "situation", "person", "expires", "channel", "at")
SMART_HEADER = ("id", "enabled", "credential", "days_before", "statuses", "kind", "direction", "to", "exclude_column",
                "exclude_values", "channels", "cc", "label", "sender", "sms_text", "email_subject", "email_text",
                "note", "event", "max_attempts", "frequency", "email_design", "ai_model", "ai_providers", "send_at",
                "record_to", "from_line")
SMART_SLOT_GRACE_MIN = 60
SMART_SLOTS_MAX = 24
SMART_HISTORY_WINDOW = 2000
PLACEHOLDERS = ("{first_name}", "{name}", "{expires}", "{days_left}", "{credential}", "{sender}", "{correction}")
SMART_ELSEWHERE_KINDS = frozenset({"call_off", "bundle", "window_ask", "ai", "shift_clock", "letter", "gate"})
SMART_EVENT_IDS = frozenset({
    "hotline_call_off", "travel_outcome_missing", "shopper_worth_checking", "truelink_run", "ist_due",
    "questionnaire_due", "onboarding_report", "finance_receipts_missing", "recon_errors_found",
    "recon_punch_reminder", "packet_missing", "packet_day_elapsed", "deadline_extended_expired",
    "hiring_event_scheduled", "hiring_date_accepted", "hiring_hired_complete", "hiring_hired_missing",
    "hiring_packet_request", "hiring_ready_to_start", "hiring_phone_collect", "hiring_phone_confirm",
    "hiring_contact_failed", "hiring_referral_contact", "hiring_screen_report", "interview_slots_ask",
    "hiring_scorecard_report", "hiring_cjis_gate", "hiring_onboarding_finish", "hiring_onboarding_stalled",
    "hiring_hired_congrats", "interview_days_ask", "hiring_welcome", "hiring_ask", "hiring_shortlist",
    "hiring_outreach", "hiring_cjis_request", "hiring_decision_ask", "hiring_resume_request",
    "interview_candidate_confirmed", "hiring_screen_redo", "hiring_screen_call", "hiring_first_contact",
    "hiring_unreachable_archived", "referral_no_contact", "referral_already_known", "interview_invite",
    "interview_supervisor_ask", "interview_supervisor_slots_request", "interview_slots_offer", "interview_confirmed",
    "guardian_alert", "psyanywhere_false_message", "psyanywhere_true_message", "hotline_incident",
    "hotline_support_request", "pattern_scan_daily", "user_release_invite", "app_release_announced",
    "staff_broadcast", "open_shift_covered", "hiring_screen_day_reminder", "hiring_onboarding_start",
    "hiring_bci_howto"
})
SMART_EVENT_TO_SUBJECT = frozenset({"travel_outcome_missing", "shopper_worth_checking", "ist_due", "questionnaire_due",
                                    "recon_punch_reminder"})
SMART_EVENT_SENDERS = {
    "psyanywhere_true_message": "CommPsi.gs", "psyanywhere_false_message": "CommPsi.gs",
    "hotline_incident": "CommIncident.gs", "hotline_support_request": "CommSupport.gs",
    "pattern_scan_daily": "DuplicateScan.gs", "user_release_invite": "CommRelease.gs",
    "app_release_announced": "CommRelease.gs", "staff_broadcast": "CommBroadcast.gs",
    "open_shift_covered": "CommOpenShiftCovered.gs", "hiring_screen_day_reminder": "CommRecruit.gs",
    "hiring_onboarding_start": "CommRecruit.gs", "hiring_bci_howto": "CommRecruit.gs",
    "hiring_welcome": "HiringOutreach.gs", "hiring_ask": "HiringOutreach.gs",
    "hiring_shortlist": "HiringOutreach.gs", "hiring_outreach": "HiringOutreach.gs",
    "hiring_cjis_request": "HiringOutreach.gs", "hiring_decision_ask": "HiringOutreach.gs",
    "hiring_resume_request": "HiringOutreach.gs", "hiring_first_contact": "HiringOutreach.gs",
    "hiring_screen_call": "HiringOutreach.gs", "hiring_screen_redo": "HiringOutreach.gs",
    "hiring_phone_collect": "HiringOutreach.gs", "hiring_phone_confirm": "HiringOutreach.gs",
    "hiring_contact_failed": "HiringOutreach.gs", "hiring_referral_contact": "HiringOutreach.gs",
    "hiring_unreachable_archived": "HiringOutreach.gs", "hiring_hired_complete": "Hired.gs",
    "hiring_hired_missing": "Hired.gs", "hiring_hired_congrats": "Hired.gs", "hiring_ready_to_start": "Hired.gs",
    "hiring_onboarding_finish": "Hired.gs", "hiring_onboarding_stalled": "Hired.gs",
    "hiring_date_accepted": "Screening.gs", "hiring_screen_report": "Screening.gs",
    "hiring_scorecard_report": "Interview.gs", "hiring_cjis_gate": "Interview.gs",
    "hiring_event_scheduled": "HiringFlow.gs", "hiring_packet_request": "Packet.gs",
    "interview_invite": "InterviewFlow.gs", "interview_supervisor_ask": "InterviewFlow.gs",
    "interview_supervisor_slots_request": "InterviewFlow.gs", "interview_slots_offer": "InterviewFlow.gs",
    "interview_slots_ask": "InterviewFlow.gs", "interview_confirmed": "InterviewFlow.gs",
    "interview_candidate_confirmed": "InterviewFlow.gs", "interview_days_ask": "InterviewFlow.gs",
    "referral_no_contact": "Referrals.gs", "referral_already_known": "Referrals.gs"
}
# SMART_TO_KEYWORDS: the words a `to` cell may hold that are not addresses, and what each one is
SMART_TO_KEYWORDS = (("allstaff", "every active member of staff this platform can text"),
                     ("housemanagers", "every house manager on the hotline calendar we can text"),
                     ("directors", "the 5558 group — the directors and the people responsible"))
CERT_LABELS = SC.CERT_LABELS

# ---- Packet.gs, AlertsConfig.gs, Rpc.gs, Comms.gs, Talent.gs ---------------------------------------------------------

PACKET_AMBER_SMS_FLOOR = ("+13309195559", "+13309197779", "+13309195558")
SHARED_LINE_DIGITS = SC.SHARED_LINE_DIGITS
COMMS_OPERATOR_LINE_DIGITS = "3309195558"
TEST_ON_WORDS = ("on", "true", "1", "test")
TEST_OFF_WORDS = ("off", "false", "0", "production")
REHEARSAL_WORDS = ("sheet", "rehearsal", "paper")
QUIET_FROM, QUIET_TO = "21:31", "08:00"
RPC_RECEIPT_TTL_S = 21600

# ---- SmartGate.gs ----------------------------------------------------------------------------------------------------

HUB_GATE_ARMED_TTL_S = 300
# how long the clocks keep the configuration lane before reading it again (clocks.LANE_TTL_S)
CLOCKS_REREAD_S = 180
HUB_GATES = (
    {"id": "gate_drive_grant_reader",
     "person": True,
     "label": "Drive reader access handed to a person",
     "reaches": "a real Google account gets reader access on a real document — candidate uploads, task attachments, "
                "the signed application PDF that carries an SSN",
     "costs": "while this holds, an upload lane grants nobody anything; the row says who would have been given what",
     },
    {"id": "gate_screening_report_share",
     "person": True,
     "label": "the phone-screen report handed to the administrators",
     "reaches": "every address the admin list answers gets reader access on a freshly minted document holding a "
                "candidate's score, concerns and background disclosure",
     "costs": "the report is still written; nobody is given access to it while this holds",
     },
    {"id": "gate_calendar_file_link",
     "person": True,
     "label": "a calendar day file published to anyone with the link",
     "reaches": "anybody holding the link — it publishes a company calendar attachment, permanently",
     "costs": "the file is still made; it stays private while this holds",
     },
    {"id": "gate_wellbeing_image_link",
     "person": True,
     "label": "a generated illustration published to anyone with the link",
     "reaches": "anybody holding the link — the same permanent link-sharing, on generated images",
     "costs": "the image is still made; it stays private while this holds",
     "unwired": "no door in this build publishes a generated illustration by link: the Hub serves them from its own "
                "path, so arming it changes nothing",
     },
    {"id": "gate_book_write_funnel",
     "label": "every create, update and delete in an ASA DATA workbook",
     "reaches": "a live book — this is the funnel 106 call sites across 27 files pass through",
     "costs": "THE WIDEST GATE ON THE PLATFORM. While this holds, a rehearsal writes nothing to any workbook at all: "
              "every action that creates a row answers that the write was held, and an import or rebuild stops at "
              "the first held row and says how many landed before it. Arm it only for a rehearsal that is meant to "
              "leave no trace.",
     },
    {"id": "gate_resource_write_door",
     "label": "the generic resource door (create / update / delete)",
     "reaches": "a live book — roughly sixty declared resources, whichever workbook each one's tab is in",
     "costs": "while this holds, the screens' save buttons answer held instead of writing",
     "unwired": "the generic resource door (app/generic_rows_writes.py) does not ask this gate: its saves are kept in "
                "Postgres whether it is armed or not, so arming it changes nothing",
     },
    {"id": "gate_psi_punches_ingest",
     "label": "the time clock's punches written into their house",
     "reaches": "a live book — the punches house, plus the two stamps beside it",
     "costs": "this door MIRRORS facts the time clock already recorded, so holding it makes the mirror stale rather "
              "than protecting anybody. Left off, the rows are stamped with the switch instead, which is the honest "
              "half of the fix.",
     },
    {"id": "gate_behavior_signals_ingest",
     "label": "behaviour signals written into their house",
     "reaches": "a live book — the behaviour signals house",
     "costs": "the staff feed keeps the signals and offers them again on its next pass; nothing is lost, the house "
              "is behind",
     },
    {"id": "gate_recruit_book_ingest",
     "label": "the recruiters' book written back",
     "reaches": "a live book — the recruiters' house. Its SEND path already asks the dial; this is the write "
                "upstream of it, which never did.",
     "costs": "the feed keeps the rows and offers them again",
     },
    {"id": "gate_relay_ingest_lane",
     "relay": True,
     "label": "the platform's own ingest lane, on its own clock",
     "reaches": "live books — every row the platform's clocks post into an ingest door: the feeds on their own clock, "
                "the call feed (its tick and its webhook door), the provider's webhook filing a call or a text, and "
                "the line directory push",
     "costs": "the sweeps keep computing and stop posting; every house they feed falls behind. A call the feed read "
              "stays parked and is not charged a refusal. A provider webhook held is answered \"not filed\", and the "
              "provider retries it only for as long as it retries",
     },
    {"id": "gate_digest_writes",
     "relay": True,
     "engine": True,
     "label": "the digest lane writing claim state and verdicts",
     "reaches": "live books — the form files and client files ledgers, and the words book the proposals and kinds "
                "tables live in",
     "costs": "the digest keeper on asa-hub-worker stops claiming and sealing rows, and the proposals and teach doors "
              "refuse; nothing is read twice, the queue waits",
     },
    {"id": "gate_ledger_drain_replay",
     "relay": True,
     "label": "the parked-write drain replaying to the platform",
     "reaches": "whatever the queued write reached — a browser write parked minutes or hours ago",
     "costs": "the queue holds. A write is never dropped: the time it spent held does not count toward the day after "
              "which an undeliverable write is set aside",
     },
    {"id": "gate_mail_provision",
     "relay": True,
     "person": True,
     "label": "a mailbox created on the real mail server",
     "reaches": "a real account on the real mail server, and its password in the answer",
     "costs": "a first sign-in cannot provision a mailbox while this holds",
     },
    {"id": "gate_mail_mark_file",
     "relay": True,
     "label": "a real mailbox flagged or refiled",
     "reaches": "a real mailbox — a message marked seen, or moved between real folders",
     "costs": "the mail rail reads but does not mutate while this holds",
     },
    {"id": "gate_chat_live_frame",
     "relay": True,
     "label": "the live chat frame pushed to an open tab",
     "reaches": "a real colleague's screen, the moment a chat message lands",
     "costs": "THE STATED EXCEPTION. This is one person deliberately writing to another, not the platform notifying "
              "anybody, so it is delivered while the lane holds — the same reason the two authentication letters "
              "are. It is named here so the exception is a decision somebody can see and reverse, not an omission.",
     },
)
# the gates no door in this build asks: armed, they change nothing
GATE_UNWIRED = frozenset({"gate_resource_write_door", "gate_wellbeing_image_link"})
GATE_CAVEATS = {"gate_book_write_funnel": "While this holds, every door that writes a book answers held — the Hub's "
                                          "screens, the imports and the feeds alike. The generic resource door does "
                                          "not ask it. This Desk is never held by it, so it can always be switched "
                                          "off here."}
HUB_AUTH_SITUATIONS = (("password_reset", "auth_password_reset"), ("invitation", "auth_invitation"))
HUB_AUTH_LETTER_WORDS = {"password_reset": "row", "invitation": "row"}
HUB_AUTH_ALSO_CLAIMED = {
    "invitation": ({"id": "user_release_invite", "label": "the release invite (a first password)",
                    "door": "Release Users"},
                   {"id": "user_account_invite", "label": "the account invitation (a sign-in and a first password)",
                    "door": "Settings → Users → Invite"})}

# ---- CommCallOff.gs, CommOpenShiftCovered.gs -------------------------------------------------------------------------

COMM_CALLOFF_HOUSE = "comm_call_offs"
COVERED_COLS = {"prod": "covered_state", "test": "covered_test_state", "at": "covered_at", "why": "covered_why"}
OPEN_SHIFT_COVERED_SITUATION = "open_shift_covered"
OPEN_SHIFT_COVERED_HISTORY = 25
COMM_CALLOFF_LEGACY_SENDER = {
    "name": "the hotline's own Call Off Processor v1.3",
    "what": "it detects the call-off in the transcript, fuzzy-matches the employee, finds the House Lead and texts "
            "her through OpenPhone — the same woman this row texts, about the same absence",
    "words": "CALL OFF ALERT: <name> called off <date> at <house>. Reason: <the caller's own words> — it carries the "
             "reason, which this lane refuses to send",
    "last_seen": "the newest CALL OFF ALERT the platform can see is from 2026-03-20, delivered to three "
                 "destinations; that message log has recorded nothing since, while the legacy project itself still "
                 "runs",
    "proved": "the sender, its wording and its delivery",
    "unknown": "whether it spoke this week — the log that would say went quiet, and a quiet log is NOT a disarmed "
               "sender",
    "risk": "arming this row means the House Lead may hear about one absence twice, from two systems that cannot see "
            "each other's ledger",
    "lifts_when": "the legacy processor is retired, or its per-call-off send becomes readable from here",
}

# ---- CommIntent.gs, CommQualify.gs -----------------------------------------------------------------------------------

COMM_INTENTS_HOUSE = "comm_intents"
COMM_BINDINGS_HOUSE = "comm_bindings"
COMM_CONTRIBUTIONS_HOUSE = "comm_contributions"
COMM_CONTRIBUTION_OPEN_STATES = ("awaiting_owner", "needs_human")
COMM_CONTRIBUTION_SILENT_CLOSES = ("acknowledged", "already-owed", "already-told", "test-rehearsal", "silence")

# ---- OptOut.gs -------------------------------------------------------------------------------------------------------

OPT_OUT_TAB = "entity_opt_outs"
OPT_OUT_SCOPES = ("hiring", "staff")
# OPT_OUT_SCOPE_BY_FILE for these doors' files: SmartComms.gs is 'staff'
OPT_OUT_SCOPE_DESK = "staff"
OPT_OUT_PHRASES_SHIPPED = ("stop, stopall, unsubscribe, cancel, end, quit, revoke, optout, opt out, remove me, pare, "
                           "parar, para, nao quero, não quero, remova, descadastrar, sair")
OPT_IN_PHRASES_SHIPPED = "start, unstop, resume, voltar, pode mandar"
WRONG_NUMBER_PHRASES_SHIPPED = ("wrong number, wrong person, you have the wrong number, sorry wrong number, "
                                "this is not me, not me, numero errado, número errado, nao sou eu, não sou eu, "
                                "pessoa errada")

# ---- CommBroadcast.gs ------------------------------------------------------------------------------------------------

COMM_BROADCAST_SITUATION = "staff_broadcast"
COMM_BROADCAST_HOUSE = "comm_broadcasts"
# the broadcasts' rows in Postgres (app/resource_rows.py) once the Staff Broadcast runs on Python
COMM_BROADCAST_RESOURCE = "commBroadcasts"
COMM_BROADCAST_JSON_COLS = ("recipients", "dropped")
COMM_BROADCAST_ABOVE = ("DIRECTOR", "ADMINISTRATOR", "ADMIN")
# the badges that broadcast as a house manager: their own houses and the audiences marked True below
COMM_BROADCAST_HOUSE_MANAGER = ("HM", "TEAMLEAD")
COMM_BROADCAST_AUDIENCES = (("allstaff", "All staff", True), ("meddel", "Only Med Del", True),
                            ("house", "One house", True), ("leadership", "Leadership", False), ("prn", "PRN", True))
COMM_BROADCAST_LIMITS = {"text_min": 2, "text_max": 1400, "signature_max": 160, "cap": 200}
COMM_BROADCAST_HISTORY = 25
COMM_BROADCAST_HOUSE_DAYS = 28
COMM_BROADCAST_STALE_MS = 3 * 60 * 1000
COMM_BROADCAST_MARK_EVERY = 20
COMM_BROADCAST_RECEIPT_MARGIN_MS = 30 * 60 * 1000
HOTLINE_CALENDAR_TAB = L.HOTLINE_CALENDAR_TAB

# ---- CommProposals.gs ------------------------------------------------------------------------------------------------

COMM_PROPOSALS_TAB = "comm_proposals"
COMM_VOCAB_TAB = "comm_vocabulary"
COMM_VOCAB_PROPOSABLE = ("opt_out_phrases", "wrong_number_phrases", "availability_phrases")
COMM_VOCAB_FORBIDDEN = ("opt_in_phrases",)
COMM_VOCAB_MAX_LEARNED = 40
PROPOSAL_FIELDS = (("id", "id"), ("created_at", "createdat"), ("status", "status"),
                   ("vocabularies_allowed", "vocabulariesallowed"), ("phrase", "phrase"), ("tokens", "tokens"),
                   ("family", "family"), ("shape", "shape"), ("evidence_n", "evidencen"), ("people_n", "peoplen"),
                   ("coverage", "coverage"), ("leak_control", "leakcontrol"), ("leak_contains", "leakcontains"),
                   ("would_catch", "wouldcatch"), ("would_catch_wrongly", "wouldcatchwrongly"),
                   ("verdict", "verdict"), ("why", "why"), ("merged_list", "mergedlist"),
                   ("shipped_intact", "shippedintact"), ("example", "example"), ("example_ref", "exampleref"),
                   ("example_withheld", "examplewithheld"), ("corpus_n", "corpusn"), ("control_n", "controln"),
                   ("notes", "notes"))

# ---- who may read ----------------------------------------------------------------------------------------------------

DENIED = {"status": 403, "message": "Requires an admin or manager account"}
# hubPolicyGate_'s refusal of smartCommsGet (roles: admin), kept for whoever no edition opens the Desk to
DESK_REFUSED = {"status": 403, "message": "This action is for admin."}
# Settings › Editions: each field family the Desk saves; a holder reads the Desk too (none is listed until released)
DESK_EDITIONS = ("smartComms.words", "smartComms.switch", "smartComms.audience", "smartComms.pacing",
                 "smartComms.ai", "smartComms.recording")


# ---- what JavaScript does to a value ---------------------------------------------------------------------------------

s_ = gsjs.str_


def text(v: Any) -> str:
    """String(v == null ? '' : v).trim()."""
    return gsjs.trim(gsjs.or_blank(v))


def first(*vals: Any) -> Any:
    """a || b || …: the first truthy value, else the last."""
    for v in vals:
        if not gsjs.falsy(v):
            return v
    return vals[-1]


def digits(v: Any) -> str:
    return re.sub(r"[^0-9]", "", gsjs.or_blank(v))


def lower(v: Any) -> str:
    return gsjs.or_text(v).lower()


def smart_list(raw: Any) -> list[str]:
    """smartList_: comma, semicolon, pipe or newline."""
    return [x for x in (gsjs.trim(p) for p in re.split(r"[,;|\n]+", gsjs.or_text(raw))) if x]


def cfg_list(raw: Any) -> list[str]:
    """hubCfgList_ (and every String(raw).split(/[,;\\n]+/) of a config cell)."""
    return [x for x in (gsjs.trim(p) for p in re.split(r"[,;\n]+", gsjs.or_blank(raw))) if x]


def smart_on(v: Any) -> bool:
    """smartOn_: yes, true, on or 1."""
    return gsjs.trim(gsjs.or_text(v)).lower() in ("yes", "true", "on", "1")


def js_parse_int(v: Any) -> int | None:
    """parseInt(v, 10); None for NaN."""
    m = re.match(r"^[" + _JS_WS + r"]*([+-]?)([0-9]+)", "undefined" if v is None else gsjs.js_str(v))
    if not m:
        return None
    n = int(m.group(2))
    return -n if m.group(1) == "-" else n


def js_number(v: Any) -> float:
    """Number(v) for a cell's text; NaN when it is not one."""
    if isinstance(v, bool):
        return 1.0 if v else 0.0
    if isinstance(v, (int, float)):
        return float(v)
    s = gsjs.trim(gsjs.or_blank(v))
    if not s:
        return 0.0
    if re.fullmatch(r"[+-]?(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][+-]?[0-9]+)?", s):
        return float(s)
    if re.fullmatch(r"0[xX][0-9a-fA-F]+", s):
        return float(int(s, 16))
    if re.fullmatch(r"[+-]?Infinity", s):
        return -math.inf if s.startswith("-") else math.inf
    return math.nan


def wire(v: Any) -> Any:
    """A cell as JSON.stringify writes what getValues() handed back: a Date as its instant."""
    if isinstance(v, SheetDate):
        return gsjs.iso(v.at)
    if isinstance(v, hubdb.SheetTime):
        return gsjs.iso(datetime(1899, 12, 30, v.h, v.m, v.s, tzinfo=NY))
    if isinstance(v, dict):
        return {k: wire(x) for k, x in v.items()}
    if isinstance(v, list):
        return [wire(x) for x in v]
    return v


def by_locale_desc(key: Callable[[Any], Any]) -> Callable[[Any], Any]:
    """String(b.x).localeCompare(String(a.x))."""
    return functools.cmp_to_key(lambda a, b: gsjs.locale_cmp(key(b), key(a)))


def mask(v: Any) -> str:
    """rpcMaskTo_."""
    s = gsjs.or_blank(v)
    return "•••" + s[-4:] if len(s) > 4 else "•••"


def sendable(raw: Any) -> str:
    """packetSendableNumber_."""
    d = re.sub(r"^1", "", digits(gsjs.or_text(raw)))
    if len(d) != 10 or d in SHARED_LINE_DIGITS:
        return ""
    return "+1" + d


def team_copy_number(raw: Any) -> str:
    """packetTeamCopyNumber_."""
    d = re.sub(r"^1", "", digits(gsjs.or_text(raw)))
    if len(d) != 10 or d == COMMS_OPERATOR_LINE_DIGITS:
        return ""
    return "+1" + d


def shared_line(v: Any) -> bool:
    """hubSharedLine_."""
    k = digits(v)[-10:]
    return bool(k) and k in SHARED_LINE_DIGITS


def now_ms(reads: L.Reads) -> float:
    return reads.now.timestamp() * 1000.0


def ny_hm(reads: L.Reads) -> str:
    return reads.now.astimezone(NY).strftime("%H:%M")


# ---- where a tab lives -----------------------------------------------------------------------------------------------

def where(reads: L.Reads, tab: str) -> hubdb.Resolved:
    """hubTabSheet_ at headquarters: a declared house or a homed tab, else the Core HUB_DB_ID names."""
    db = reads.db
    if db.dissolved(tab):
        raise Defer(f"{tab} lives in the depot's facts")
    if db.house_moved(tab) or tab in hubdb.HUB_TAB_HOME:
        return db.resolve(tab)
    ref = db.tab(CORE_ID, tab)
    virtual = getattr(hubdb.OWN.get(), "virtual", None)
    if ref is None and virtual is not None:
        ref = virtual(CORE_ID, tab)
    db.note_book(CORE_ID)
    return hubdb.Resolved(CORE_ID, (tab,), ref, False, db.book(CORE_ID) is not None)


def must_book(res: hubdb.Resolved, what: str) -> None:
    if res.ref is None and not res.book_known:
        raise hubdb.Unreadable(f"asa-hub-db holds no copy of the book behind {what}")


def house_where(reads: L.Reads, tab: str) -> hubdb.Resolved:
    """where() of a house; its tab, once the house is kept in its own table, that table (house_tables.KeptRef), which
    house_rows reads. A write still names the book and the house, and writes.into_tables lays it on the table."""
    res = where(reads, tab)
    return res._replace(ref=HT.kept_ref(reads, tab)) if HT.tabled(tab) else res


def house_rows(reads: L.Reads, ref: Any) -> list[tuple[int, dict]]:
    """(row number, cells) of a house's tab: its table's rows, else the copy's with the kept edits laid."""
    if isinstance(ref, HT.KeptRef):
        return HT.raw(reads, ref.tab, ref.resource)[1]
    return reads.db.rows(ref)


def board_rows(reads: L.Reads, tab: str) -> list[dict]:
    """commBoardRows_: one house as objects keyed by its own header, each cell as getValues() hands it back."""
    def read() -> list[dict]:
        res = house_where(reads, tab)
        must_book(res, tab)
        if res.ref is None:
            return []
        heads = [gsjs.js_str(h) for h in res.ref.headers]
        out = []
        for _rn, raw in house_rows(reads, res.ref):
            row: dict[str, Any] = {}
            empty = True
            for h, src in zip(heads, res.ref.headers):
                v = hubdb.typed(raw.get(src), "hub")
                row[h] = v
                if v != "" and v is not None:
                    empty = False
            if not empty:
                out.append(row)
        return out
    return [dict(r) for r in reads.once("scd:board:" + tab, read)]


def normalized(reads: L.Reads, tab: str) -> list[dict] | None:
    """readTabNormalized_ of a house; None when the house holds no tab in a book the copy knows."""
    res = where(reads, tab)
    must_book(res, tab)
    if res.ref is None:
        return None
    return SC._normalized(reads, res.ref, res.sheet_id == CORE_ID)


# ---- the situations --------------------------------------------------------------------------------------------------

def situations(reads: L.Reads) -> list[dict]:
    """smartSituations_: every row with an id, each of the header's cells as String(); never seeded here."""
    def read() -> list[dict]:
        if HT.tabled(SMART_TAB):
            cols, rows = HT.raw(reads, SMART_TAB)
            heads: dict[str, str] = {h: h for h in cols}
        else:
            res = where(reads, SMART_TAB)
            must_book(res, "the situations house")
            if res.ref is None:
                raise Defer("the situations house holds no tab in the copy yet")
            heads = {}
            for h in res.ref.headers:
                heads[gsjs.trim(gsjs.js_str(h))] = h
            rows = reads.db.rows(res.ref)
        missing = [h for h in SMART_HEADER if h not in heads]
        if missing:
            raise Defer("the situations house lacks " + ", ".join(missing) + "")
        out = []
        for _rn, raw in rows:
            row = {h: gsjs.or_blank(hubdb.typed(raw.get(heads[h]), "hub")) for h in SMART_HEADER}
            if row["id"]:
                out.append(row)
        return out
    return [dict(r) for r in reads.once("scd:situations", read)]


def situation_last(rows: list[dict], sid: str) -> dict | None:
    """The last row carrying this id (the row Apps Script reads and writes)."""
    hit = None
    for r in rows:
        if s_(r.get("id")) == sid:
            hit = r
    return hit


def situation_on(rows: list[dict], sid: str) -> dict | None:
    """smartSituationOn_: the last row with this id, when it is on."""
    sit = situation_last(rows, sid)
    return sit if sit is not None and smart_on(sit.get("enabled")) else None


def house_id(reads: L.Reads) -> str:
    """hubTabWorkbook_(SMART_TAB).getId(); where the table is, once the situations are kept in one."""
    if HT.tabled(SMART_TAB):
        return "app.resource_rows · " + (HT.resource_of(SMART_TAB) or "")
    return where(reads, SMART_TAB).sheet_id


# ---- the brakes, as every reader here resolves them ------------------------------------------------------------------

def test_mode_state(cfg: dict[str, str]) -> dict[str, Any]:
    """hubTestModeState_."""
    dropped: list[str] = []
    sms: list[str] = []
    emails: list[str] = []
    for raw in cfg_list(cfg.get("test_redirect_sms")):
        d = re.sub(r"^1", "", digits(raw))
        n = "+1" + d if len(d) == 10 else ""
        if n:
            if n not in sms:
                sms.append(n)
        else:
            dropped.append(raw)
    for raw in cfg_list(cfg.get("test_redirect_email")):
        e = gsjs.trim(raw)
        e = e if re.fullmatch(r"[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+", e) else ""
        if e:
            if e not in emails:
                emails.append(e)
        else:
            dropped.append(raw)
    raw_word = gsjs.trim(gsjs.or_blank(cfg.get("test_mode"))).lower()
    unrecognized = ""
    if raw_word in TEST_ON_WORDS or raw_word in REHEARSAL_WORDS:
        on = True
    elif raw_word in TEST_OFF_WORDS:
        on = False
    elif not raw_word:
        on = (len(sms) + len(emails)) > 0
    else:
        on, unrecognized = True, raw_word
    return {"on": on, "explicit": raw_word != "", "unrecognized": unrecognized, "sms": sms, "emails": emails,
            "dropped": dropped, "shared": [n for n in sms if shared_line(n)]}


def dial(cfg: dict[str, str]) -> dict[str, Any]:
    """commDial_ (with COMM_DIAL_UNREADABLE): record while test mode is on, send while off, off when unreadable."""
    st = test_mode_state(cfg)
    if st["unrecognized"]:
        return {"word": "off", "readable": False}
    return {"word": "record" if st["on"] else "send", "readable": True}


def switch_word(cfg: dict[str, str]) -> str:
    """hubSwitchWord_."""
    st = test_mode_state(cfg)
    return "unreadable" if st["unrecognized"] else ("on" if st["on"] else "off")


def send_enabled(reads: L.Reads, cfg: dict[str, str]) -> bool:
    """rpcSendEnabled_: HUB_RPC_SEND on, and Settings has not paused."""
    if gsjs.or_text(reads.db.prop("HUB_RPC_SEND")).lower() not in ("on", "true", "1"):
        return False
    return gsjs.trim(gsjs.or_blank(cfg.get("messages_paused"))).lower() not in ("on", "true", "1", "yes")


def quiet_now(reads: L.Reads) -> bool:
    """hubQuietAt_ on the real clock."""
    hm = ny_hm(reads)
    return hm >= QUIET_FROM or hm < QUIET_TO


def quiet_words() -> str:
    """hubQuietWords_."""
    h, m = (int(x) for x in QUIET_TO.split(":"))
    mins = (h * 60 + m + 1439) % 1440
    return f"{QUIET_FROM}–{mins // 60:02d}:{mins % 60:02d} New York"


# ---- the opt-out list ------------------------------------------------------------------------------------------------

def opt_out_key(target: Any) -> str:
    """optOutKey_."""
    s = gsjs.trim(gsjs.or_text(target))
    if not s:
        return ""
    if "@" in s:
        return s.lower()
    d = digits(s)
    return d[-10:] if len(d) >= 10 else ""


def opt_out_index(reads: L.Reads) -> dict[str, Any]:
    """optOutIndex_: target key → its stop; an unreadable list says so."""
    def read() -> dict[str, Any]:
        got, why = attempt(lambda: OO.opt_out_rows(reads))
        if why:
            return {"by": {}, "error": "The opt-out list could not be read: " + why}
        by: dict[str, dict] = {}
        for r in got or []:
            key = s_(r.get("targetkey")) or opt_out_key(r.get("target"))
            if not key:
                continue
            if s_(r.get("releasedat")):
                by.pop(key, None)
                continue
            by[key] = {"target": s_(r.get("target")), "kind": s_(r.get("kind")), "name": s_(r.get("personname")),
                       "candidate_id": s_(r.get("candidateid")), "source": s_(r.get("source")),
                       "phrase": s_(r.get("phrase")), "at": s_(r.get("at")), "scope": s_(r.get("scope"))}
        return {"by": by, "error": ""}
    return reads.once("scd:optouts", read)


def opt_out_blocked(reads: L.Reads, target: Any, scope: str) -> str:
    """optOutBlocked_ inside an action whose file names this conversation scope."""
    key = opt_out_key(target)
    if not key:
        return ""
    idx = opt_out_index(reads)
    if idx["error"]:
        return idx["error"]
    hit = idx["by"].get(key)
    if not hit:
        return ""
    scoped = "wrong" in hit["source"].lower() and hit["scope"] in OPT_OUT_SCOPES
    if scope and scoped and hit["scope"] != scope:
        return ""
    return ("This person asked us to stop" + (" on " + hit["at"][:10] if hit["at"] else "")
            + (' ("' + hit["phrase"] + '")' if hit["phrase"] else "") + ".")


# ---- the Desk's derived facts ----------------------------------------------------------------------------------------

def cert_labels(reads: L.Reads) -> dict[str, str]:
    """certLabels_."""
    pairs = SP.cfg_pairs(reads, "ist_cert_labels")
    return dict(pairs["map"]) if pairs and pairs["order"] else dict(CERT_LABELS)


def amber_floor(cfg: dict[str, str]) -> list[str]:
    """packetAmberFloor_: the configured floor, or the shipped one."""
    typed = [s for s in cfg_list(first(cfg.get("escalation_floor_sms"), "")) if s and len(digits(s)) >= 10]
    return typed if typed else list(PACKET_AMBER_SMS_FLOOR)


def alert_recipients(reads: L.Reads, cfg: dict[str, str]) -> dict[str, list[str]]:
    """hubAlertRecipients_: the config's lists, the words book's when a list is empty."""
    sms = cfg_list(first(cfg.get("sms_recipients"), ""))
    emails = cfg_list(first(cfg.get("email_recipients"), ""))
    return {"sms": sms if sms else cfg_list(CND.book_text(reads, "Strings", "recipients.date_accepted.sms", "")),
            "emails": emails if emails else cfg_list(CND.book_text(reads, "Strings",
                                                                   "recipients.date_accepted.emails", ""))}


def team_recipients(reads: L.Reads, cfg: dict[str, str]) -> dict[str, Any]:
    """smartTeamRecipients_: who a teamAlert reaches, off the list the send path uses."""
    out: dict[str, Any] = {"sms": [], "emails": [], "floor_sms": [], "amber_sms": [], "readable": True}
    out["floor_sms"] = amber_floor(cfg)
    rc, why = attempt(lambda: alert_recipients(reads, cfg))
    # packetAmberRecipients_: the floor, with the configured numbers it lacks unioned in
    amber = amber_floor(cfg)
    seen = {digits(n)[-10:] for n in amber}
    for n in (rc or {}).get("sms") or []:
        k = digits(n)[-10:]
        if k and k not in seen:
            seen.add(k)
            amber.append(n)
    out["amber_sms"] = amber
    if why:
        out["readable"] = False
        return out
    out["sms"] = [n for n in rc["sms"] if len(digits(n)) >= 10]
    out["emails"] = [e for e in rc["emails"] if "@" in e]
    return out


def floor_alerts(rows: list[dict]) -> dict[str, dict]:
    """smartFloorAlerts_: the event rows that page the alert floor whatever their `to` says."""
    out: dict[str, dict] = {}
    for s in rows:
        if gsjs.trim(gsjs.or_text(s.get("kind"))).lower() != "event":
            continue
        ev = gsjs.trim(gsjs.or_text(s.get("event")))
        if ev not in SMART_EVENT_IDS or ev in SMART_EVENT_TO_SUBJECT or ev in SMART_EVENT_SENDERS:
            continue
        out[gsjs.or_text(s.get("id"))] = {"floor": True, "adds": True}
    return out


_SLOT = re.compile(r"^([0-9]{1,2})[" + _JS_WS + r"]*(?::|h)?[" + _JS_WS + r"]*([0-9]{2})?[" + _JS_WS
                   + r"]*(am|pm|a|p)?\.?\Z")


def slot_label(mins: int) -> str:
    return f"{mins // 60:02d}:{mins % 60:02d}"


def slots_parse(value: Any) -> dict[str, Any]:
    """smartSlotsParse_."""
    out: dict[str, Any] = {"slots": [], "labels": [], "bad": [], "over": 0}
    raw = text(value)
    if not raw:
        return out
    seen: set[int] = set()
    for piece in re.split(r"[,;\n|]+", raw):
        t = gsjs.trim(piece).lower()
        if not t:
            continue
        m = _SLOT.match(t)
        if not m:
            out["bad"].append(gsjs.trim(piece))
            continue
        h = int(m.group(1))
        mi = int(m.group(2)) if m.group(2) else 0
        ap = (m.group(3) or "")[:1]
        if ap == "p" and h < 12:
            h += 12
        if ap == "a" and h == 12:
            h = 0
        if h > 23 or mi > 59:
            out["bad"].append(gsjs.trim(piece))
            continue
        mins = h * 60 + mi
        if mins in seen:
            continue
        seen.add(mins)
        out["slots"].append(mins)
    out["slots"].sort()
    if len(out["slots"]) > SMART_SLOTS_MAX:
        out["over"] = len(out["slots"]) - SMART_SLOTS_MAX
        out["slots"] = out["slots"][:SMART_SLOTS_MAX]
    out["labels"] = [slot_label(x) for x in out["slots"]]
    return out


def schedule_now(sit: dict, reads: L.Reads) -> dict[str, Any]:
    """smartScheduleNow_ on the script's clock (New York)."""
    parsed = slots_parse(sit.get("send_at"))
    if not parsed["slots"]:
        return {"scheduled": False, "holds": False, "slot": "", "labels": []}
    local = reads.now.astimezone(NY)
    now_min = local.hour * 60 + local.minute
    standing = -1
    for mins in parsed["slots"]:
        late = now_min - mins
        if 0 <= late <= SMART_SLOT_GRACE_MIN:
            standing = mins
    if standing < 0:
        nxt = next((parsed["labels"][i] for i, mins in enumerate(parsed["slots"]) if mins > now_min), "")
        return {"scheduled": True, "holds": True, "slot": "", "labels": parsed["labels"],
                "next": nxt or (parsed["labels"][0] + " tomorrow")}
    return {"scheduled": True, "holds": False, "labels": parsed["labels"], "label": slot_label(standing),
            "slot": local.strftime("%Y-%m-%d") + "T" + slot_label(standing)}


def schedule_facts(rows: list[dict], reads: L.Reads) -> dict[str, dict]:
    """smartScheduleFacts_: the hours each row keeps, and whether a clock listens on it."""
    out: dict[str, dict] = {}
    for s in rows:
        sid = gsjs.or_text(s.get("id"))
        if not sid:
            continue
        parsed = slots_parse(s.get("send_at"))
        kind = gsjs.trim(gsjs.or_text(first(s.get("kind"), "reminder"))).lower()
        ev = gsjs.trim(gsjs.or_text(s.get("event")))
        elsewhere = ev in SMART_EVENT_SENDERS or kind in SMART_ELSEWHERE_KINDS
        now = schedule_now(s, reads)
        out[sid] = {
            "hours": parsed["labels"], "unreadable": parsed["bad"], "honored": not elsewhere,
            "standing": bool(now["scheduled"] and not now["holds"]), "next": now.get("next") or "",
            "why": ("this one is sent the moment it happens, by its own lane — hours here hold nothing back"
                    if elsewhere else
                    ("the sweep speaks at " + ", ".join(parsed["labels"]) + ", and each hour is its own telling"
                     if parsed["labels"] else "no hours kept: it speaks whenever its sweep passes"))}
    return out


def to_keyword(entry: Any) -> str:
    """smartToKeyword_."""
    v = re.sub(r"[^a-z]", "", gsjs.trim(gsjs.or_blank(entry)).lower())
    return v if v and any(v == k for k, _l in SMART_TO_KEYWORDS) else ""


def keywords_in_use(rows: list[dict]) -> set[str]:
    """smartKeywordsInUse_."""
    return {k for s in rows for k in (to_keyword(e) for e in smart_list(s.get("to"))) if k}


def everyone_audience(reads: L.Reads, cfg: dict[str, str]) -> dict[str, Any]:
    """commCallOffEveryoneAudience_({}): every active member of staff this platform may text, no one skipped."""
    out: dict[str, Any] = {"ok": False, "readable": False, "people": [], "why": "", "missing": "",
                           "counted": {"rows": 0, "active": 0, "no_phone": 0, "refused": 0}}
    out["missing"] = ("a readable roster — who is already ON SHIFT today is not knowable from here, so this list can "
                      "include somebody who is at work right now")
    rows, why = attempt(lambda: SP.without_isp_clients(reads, SP.people_merged(reads, SP._people(reads))))
    if rows is None:
        out["why"] = ("the People house could not be read at all — NOBODY was resolved, which is a refusal and not an "
                      "empty company")
        return out
    out["readable"] = True
    on_staff = {x.lower(): True for x in cfg_list(first(cfg.get("staff_guard_block_statuses"), "") or
                                                  "active, admin")}
    if not on_staff:
        on_staff = {"active": True, "admin": True}
    counted = out["counted"]
    counted["rows"] = len(rows)
    counted["her_number"] = 0
    counted["time_off"] = 0
    seen: set[str] = set()
    for p in rows:
        if not on_staff.get(gsjs.trim(gsjs.or_text((p or {}).get("status"))).lower()):
            continue
        counted["active"] += 1
        k = gsjs.name_key((p or {}).get("name"))
        if not k or k in seen:
            continue
        phone = sendable((p or {}).get("phone"))
        if not phone:
            counted["no_phone"] += 1
            continue
        if opt_out_blocked(reads, phone, OPT_OUT_SCOPE_DESK):
            counted["refused"] += 1
            continue
        seen.add(k)
        out["people"].append({"person_key": k, "name": gsjs.or_text((p or {}).get("name")), "phone": phone})
    out["ok"] = len(out["people"]) > 0
    out["why"] = (f"{len(out['people'])} of {counted['active']} people on staff can be texted ("
                  f"{counted['no_phone']} carry no number we may text, {counted['refused']} have opted out). "
                  "\"On staff\" is the `status` column, read with the same allow-list the contact guard uses; being "
                  "on staff is not the same as being free today.")
    return out


def hotline_house_managers(reads: L.Reads) -> dict[str, Any]:
    """hotlineHouseManagers_: every house's current managers off the hotline calendar."""
    out: dict[str, Any] = {"readable": False, "rows": 0, "people": [], "why": ""}
    sid = gsjs.trim(reads.db.prop("HOTLINE_CALENDAR_ID"))
    if not sid:
        raise Defer("no hotline calendar is declared in the depot")
    ref = reads.tab_of(sid, HOTLINE_CALENDAR_TAB, "the hotline calendar")
    if ref is None:
        out["why"] = "the hotline calendar has no tab named " + HOTLINE_CALENDAR_TAB
        return out
    data = reads.db.grid(ref)
    out["readable"] = True
    out["rows"] = max(0, len(data) - 1)
    for loc, got in L.managers_by_house(data, reads.today()).items():
        for r in got["current"]:
            out["people"].append({"name": r["name"], "phone": r["phone"], "house": loc})
    return out


def house_managers_audience(reads: L.Reads) -> dict[str, Any]:
    """commCallOffHouseManagersAudience_: the house managers on the hotline calendar we can text."""
    out: dict[str, Any] = {"ok": False, "readable": False, "people": [], "why": "", "missing": "",
                           "counted": {"rows": 0, "named": 0, "no_phone": 0}}
    out["missing"] = ("a house manager whose calendar row carries no number we may text is not in this list — the "
                      "Desk counts phones, not names")
    got = hotline_house_managers(reads)
    if not got["readable"]:
        out["why"] = ("the hotline calendar could not be read, so the house managers were NOT resolved — that is "
                      "\"we cannot see\", never \"there are none\"" + (": " + got["why"] if got["why"] else ""))
        return out
    out["readable"] = True
    counted = out["counted"]
    counted["rows"] = int(got["rows"] or 0)
    seen: set[str] = set()
    for p in got["people"]:
        name = gsjs.trim(gsjs.or_text(p.get("name")))
        counted["named"] += 1
        phone = team_copy_number(gsjs.or_text(p.get("phone")))
        if not phone:
            counted["no_phone"] += 1
            continue
        k = digits(phone)[-10:]
        if not k or k in seen:
            continue
        seen.add(k)
        out["people"].append({"person_key": "", "name": name, "phone": phone})
    out["ok"] = len(out["people"]) > 0
    out["why"] = (f"{len(out['people'])} house manager(s) on the hotline calendar carry a number we may text, out of "
                  f"{counted['named']} named on {counted['rows']} row(s)"
                  + (f" ({counted['no_phone']} carry none)" if counted["no_phone"] else ""))
    return out


def directors_audience() -> dict[str, Any]:
    """commCallOffDirectorsAudience_: the 5558 group, one shared line."""
    return {"ok": True, "readable": True, "missing": "",
            "people": [{"person_key": "", "name": "the 5558 group", "phone": "+1" + COMMS_OPERATOR_LINE_DIGITS}],
            "why": "one shared line: the 5558 group, the directors and the people responsible"}


def team_dest(entry: Any) -> tuple[str, Any] | None:
    """One `to`/`cc` entry as one team destination, (to, team): an address by letter (False), a number by team-copy
    text (True), the `directors` keyword — or the 5558 line written out, which is that group — as the 5558 group
    ("group"); another keyword names many people and is not one destination (None)."""
    e = gsjs.trim(gsjs.or_blank(entry))
    word = to_keyword(e)
    if word == "directors" or digits(e)[-10:] == COMMS_OPERATOR_LINE_DIGITS:
        return "+1" + COMMS_OPERATOR_LINE_DIGITS, "group"
    if word or not e:
        return None
    if "@" in e:
        return e, False
    return (e, True) if len(digits(e)) >= 10 else None


def keyword_audiences(reads: L.Reads, cfg: dict[str, str], wanted: set[str]) -> dict[str, dict]:
    """smartToKeywordAudiences_: what each keyword written in a `to` cell resolves to now."""
    resolvers: dict[str, Callable[[], dict]] = {"allstaff": lambda: everyone_audience(reads, cfg),
                                                "housemanagers": lambda: house_managers_audience(reads),
                                                "directors": directors_audience}
    out: dict[str, dict] = {}
    for k, label in SMART_TO_KEYWORDS:
        if k not in wanted:
            out[k] = {"label": label, "count": None, "readable": False, "pending": True, "at": "",
                      "why": "no situation names this keyword, so it was not resolved", "missing": ""}
            continue
        row: dict[str, Any] = {"label": label, "count": 0, "readable": False, "pending": False,
                               "at": gsjs.iso(reads.now), "why": "", "missing": ""}
        got, why = attempt(resolvers[k])
        if got is None:
            row["count"] = None
            row["why"] = "the audience could not be resolved: " + why
        else:
            row["readable"] = bool(got["readable"]) if "readable" in got else bool(got.get("ok"))
            row["count"] = len(got.get("people") or []) if row["readable"] else None
            row["why"] = gsjs.or_text(got.get("why"))
            row["missing"] = gsjs.or_text(got.get("missing"))
        out[k] = row
    return out


def call_off_rows(reads: L.Reads) -> dict[str, dict]:
    """commCallOffRows_: the call-off house's rows by id (a later row with the same id replaces the earlier)."""
    out: dict[str, dict] = {}
    for r in board_rows(reads, COMM_CALLOFF_HOUSE):
        rid = gsjs.or_text(r.get("id"))
        if rid:
            out[rid] = r
    return out


def call_off_reach(reads: L.Reads) -> dict[str, Any]:
    """commCallOffManagerReach_(null): how many recorded call-offs resolved a house manager."""
    seen = resolved = nobody = 0
    for r in call_off_rows(reads).values():
        m = gsjs.or_text(first(r.get("manager_state"), r.get("manager_test_state"), ""))
        if not m or m == "not_owed":
            continue
        seen += 1
        if m == "nobody":
            nobody += 1
        else:
            resolved += 1
    return {"call_offs": seen, "resolved": resolved, "no_house_manager": nobody, "at": gsjs.iso(reads.now),
            "why": (f"{resolved} of {seen} recorded call-off(s) resolved a house manager this row could tell; the "
                    f"other {nobody} named no house the hotline could match, and nothing was sent about them")
            if seen else ("no call-off has reached this row yet, so its reach is not yet measured — the house is "
                          "matched from the caller's own description of the request")}


def gate_desk(rows: list[dict], cfg: dict[str, str]) -> dict[str, Any]:
    """hubGateDesk_: the doors that reach the world without a word, armed or not."""
    by_id = {gsjs.js_str(r["id"]): r for r in rows if r and not gsjs.falsy(r.get("id"))}
    word = switch_word(cfg)
    lane = "unreadable" if word == "unreadable" else ("holding" if word == "on" else "off")
    mins = int(gsjs.js_round(CLOCKS_REREAD_S / 60))
    gates = []
    for g in HUB_GATES:
        row = by_id.get(g["id"])
        armed = bool(row and smart_on(row.get("enabled")))
        wired = g["id"] not in GATE_UNWIRED
        gates.append({"id": g["id"], "label": g["label"], "reaches": g["reaches"], "costs": g["costs"],
                      "relay": bool(g.get("relay")), "person": bool(g.get("person")), "known": bool(row),
                      "armed": armed, "wired": wired,
                      "wired_why": "" if wired else (g.get("unwired") or "the door that asks this gate is not in "
                                                                         "this build"),
                      "caveat": GATE_CAVEATS.get(g["id"], ""), "holds_now": armed and wired and lane != "off"})
    return {"lane": lane,
            "lag": ("A switch saved on this desk is kept in Postgres. The Hub's doors read it the next time they are "
                    "asked, and its clocks within " + str(mins) + " minutes, when they next read the configuration. "
                    "A cell typed into the Google sheet comes back only with the daily check."),
            "gates": gates}


def auth_letters(rows: list[dict]) -> list[dict]:
    """The two authentication letters that leave while everything else is held, and the rows that claim them."""
    out = []
    for kind, sid in HUB_AUTH_SITUATIONS:
        row = situation_last(rows, sid)
        kind_on = row is None or smart_on(row.get("enabled"))
        words = HUB_AUTH_LETTER_WORDS.get(kind) or "row"
        out.append({"kind": kind, "id": sid, "known": row is not None, "on": kind_on, "delivered_while_held": True,
                    "email_words": words,
                    "note": ("the letter is delivered to the real person while the lane is holding; switched off here "
                             "it does not send at all, and a situations tab that cannot be read holds it"
                             + (". Its e-mail is a designed letter whose words are not in this row; the SMS copy is "
                                "this row's words and the dial holds it like any text" if words == "template"
                                else ""))})
        for a in HUB_AUTH_ALSO_CLAIMED.get(kind, ()):
            arow = situation_last(rows, a["id"])
            out.append({"kind": kind, "id": a["id"], "label": a["label"], "known": arow is not None,
                        "on": arow is not None and smart_on(arow.get("enabled")) and kind_on, "also_needs": sid,
                        "delivered_while_held": True, "email_words": "row",
                        "note": ("sent from " + a["door"] + "; its letter passes test mode: it claims the "
                                 + kind.replace("_", " ") + "'s exemption, so the letter reaches the real person "
                                 "while test mode holds every other message. It sends only while this row and " + sid
                                 + " are both on; its text leg is held like any text")})
    return out


def desk_editions(sess: L.Session) -> list[str]:
    """The Desk's field families this account holds an edition for, while App Control opens Smart Comms to it."""
    cfg = sess.reads.config()
    held = [e for e in DESK_EDITIONS if editions.allows(e, sess.user, cfg)]
    if not held or is_admin(sess.user):
        return held
    try:
        got = sc.profile_app_gate(RELEASE_ID, sess.user, sess.reads.scope_sources())
    except (Defer, hubdb.Unreadable):
        raise
    except Exception:  # noqa: BLE001 - a gate that throws is shut
        return []
    return held if got.get("open") is True else []


# ---- the doors -------------------------------------------------------------------------------------------------------

def is_admin(user: dict | None) -> bool:
    return bool(user) and gsjs.js_str(user.get("role")) == "admin"


def is_writer(user: dict | None) -> bool:
    """hubIsWriter_."""
    return bool(user) and gsjs.js_str(user.get("role")) in ("admin", "manager")


# the lane's knobs, each a row of the words book's Digest Settings (comm_repair, comm_window_ask read them)
LANE_KNOBS = ("comm_silence", "comm_min_gap_hours", "comm_gap_overdue_hours", "comm_gap_soon_hours",
              "comm_gap_open_hours", "comm_max_attempts", "comm_escalate_after", "comm_quiet_from", "comm_quiet_to",
              "comm_weekend_ok", "comm_test_gap_hours", "comm_window_ask_max_asks", "comm_window_ask_gap_hours",
              "comm_priority_safety", "comm_priority_repair", "comm_priority_notice")


def book_of(reads: L.Reads, sheet_id: str) -> dict[str, Any]:
    """A book as the catalogue names it: its name, and whether Postgres keeps its record (the sheet then a copy)."""
    book = reads.db.book(sheet_id) if sheet_id else None
    return {"id": sheet_id, "name": book.name if book else "",
            "record": bool(book and book.status == hubdb.RECORD_STATUS)}


def lane_knobs(reads: L.Reads, rows: list[dict]) -> dict[str, Any]:
    """Each knob's cell as written ('' leaves the code's floor) and each situation's rung of the ladder
    (comm_repair.priority_for); both None, with the reason, when the words book cannot be read."""
    import comm_repair as CR  # noqa: PLC0415 - it imports this module
    try:
        settings = digest_settings(reads)
        ids = dict.fromkeys(gsjs.js_str(r.get("id")) for r in rows)
        rungs = {sid: CR.priority_for(reads, sid) for sid in ids if sid}
    except (Defer, hubdb.Unreadable) as exc:
        return {"settings": None, "priorities": None, "why": str(exc)[:200]}
    return {"settings": {k: str(settings.get(k, "")) for k in LANE_KNOBS}, "priorities": rungs, "why": "",
            "book": book_of(reads, gsjs.trim(reads.db.prop("HUB_GENERIC_CONFIG_ID")))}


def desk_get(sess: L.Session, payload: dict) -> dict[str, Any]:
    """smartCommsGet: the situations and everything the Desk says beside them."""
    reads, user = sess.reads, sess.user
    if not is_admin(user) and not desk_editions(sess):
        return DESK_REFUSED
    cfg = reads.config()
    rows = situations(reads)
    st = test_mode_state(cfg)
    house = house_id(reads)
    return {"status": 200, "data": {
        "tab": SMART_TAB, "spreadsheet_id": house, "book": book_of(reads, house),
        "lane": lane_knobs(reads, rows),
        "situations": rows,
        "credentials": cert_labels(reads),
        "placeholders": list(PLACEHOLDERS),
        "team": team_recipients(reads, cfg),
        "floor_alerts": floor_alerts(rows),
        "schedule": schedule_facts(rows, reads),
        "event_senders": dict(SMART_EVENT_SENDERS),
        "keywords": keyword_audiences(reads, cfg, keywords_in_use(rows)),
        "sending": "on" if send_enabled(reads, cfg) else "off",
        "dial": dial(cfg)["word"],
        "dial_follows": "test_mode",
        "test_mode": {"on": st["on"], "explicit": st["explicit"], "unrecognized": st["unrecognized"], "sms": st["sms"],
                      "emails": st["emails"], "shared": st["shared"]},
        "call_off_reach": call_off_reach(reads),
        "call_off_also_sent_by": dict(COMM_CALLOFF_LEGACY_SENDER),
        "gates": gate_desk(rows, cfg),
        "auth_letters": auth_letters(rows)}}


def ledger_rows(reads: L.Reads) -> tuple[list[tuple[int, dict]], dict[str, str]] | None:
    """The Sendings house's rows and its six columns by name (its own table once kept there); None when it holds no
    tab yet."""
    if HT.tabled(SMART_LEDGER_TAB):
        cols, rows = HT.raw(reads, SMART_LEDGER_TAB)
        if any(h not in cols for h in SMART_LEDGER_HEADER):
            raise Defer("the Sendings table lacks a column of the six the trail reads by position")
        return rows, {h: h for h in cols}
    res = where(reads, SMART_LEDGER_TAB)
    must_book(res, "the Sendings house")
    if res.ref is None:
        return None
    heads = {gsjs.trim(gsjs.js_str(h)): h for h in res.ref.headers}
    if any(h not in heads for h in SMART_LEDGER_HEADER):
        raise Defer("the Sendings house lacks a column of the six the trail reads by position")
    return reads.db.rows(res.ref), heads


# the houses the lane writes, as the Activity page counts them
ACTIVITY_HOUSES = ("comm_intents", "comm_bindings", "comm_attempts", "comm_observations", "comm_routes",
                   "comm_contributions", SMART_LEDGER_TAB)


def houses(reads: L.Reads) -> list[dict[str, Any]]:
    """Each house where it lives now: its book, whether Postgres keeps that book's record, and its rows as every read
    sees them (the copy with the kept edits laid); rows None, with the reason, when it cannot be read."""
    out: list[dict[str, Any]] = []
    for tab in ACTIVITY_HOUSES:
        try:
            if HT.tabled(tab):
                out.append({"id": tab, "name": "Postgres · " + (HT.resource_of(tab) or ""), "book_id": "",
                            "record": True, "rows": len(HT.raw(reads, tab)[1]), "why": ""})
                continue
            res = where(reads, tab)
            rows: int | None = len(reads.db.rows(res.ref)) if res.ref is not None else 0
            book = book_of(reads, res.sheet_id)
            out.append({"id": tab, "name": book["name"], "book_id": book["id"], "record": book["record"], "rows": rows,
                        "why": ""})
        except (Defer, hubdb.Unreadable) as exc:
            out.append({"id": tab, "name": "", "book_id": "", "record": False, "rows": None, "why": str(exc)[:160]})
    return out


REHEARSALS_SHOWN = 200


def rehearsals(reads: L.Reads, admin: bool) -> dict[str, Any]:
    """What test mode held, newest first (app.comm_rehearsal): who would have been told, by which channel, under which
    situation, and why it was held; the words themselves for an admin only. None, with the reason, when unread."""
    import comm_logs  # noqa: PLC0415 - the test-mode logs
    try:
        got = comm_logs.newest(reads.db, comm_logs.REHEARSAL, REHEARSALS_SHOWN)
    except Exception as exc:  # noqa: BLE001 - said beside the trail, never as an empty one
        return {"rows": None, "why": f"the rehearsal log did not answer ({type(exc).__name__})"}
    rows = []
    for c in got:
        rows.append({"at": s_(c.get("at")) or s_(c.get("pass_at")) or s_(c.get("_kept_at")),
                     "situation": s_(c.get("situation")), "purpose": s_(c.get("purpose")),
                     "channel": s_(c.get("channel")), "person": s_(c.get("person_name")),
                     "to": s_(c.get("to_masked")), "would_have_sent": s_(c.get("would_have_sent")) == "yes",
                     "reasons": s_(c.get("reasons"))[:240], "subject": s_(c.get("subject"))[:160] if admin else "",
                     "body": s_(c.get("body"))[:280] if admin else ""})
    return {"rows": rows, "why": ""}


def history(sess: L.Session, payload: dict) -> dict[str, Any]:
    """smartCommsHistory: the tellings, newest first, of the ledger's last 2000 rows; never a rehearsal. Beside them
    test mode's position, what test mode held, and the lane's houses."""
    if not is_writer(sess.user):
        return DENIED
    p = payload if isinstance(payload, dict) else {}
    situation = s_(p.get("situation"))
    limit = min(500, max(1, js_parse_int(p.get("limit")) or 200))
    st = test_mode_state(sess.reads.config())
    beside = {"test_mode": {"on": st["on"], "sms": st["sms"], "emails": st["emails"]}, "houses": houses(sess.reads),
              "rehearsals": rehearsals(sess.reads, is_admin(sess.user)), "not_sent": not_sent(sess.reads)}
    got = ledger_rows(sess.reads)
    if got is None:
        return {"status": 200, "data": {"deliveries": [], **beside}}
    rows, heads = got
    by_rn = {rn: raw for rn, raw in rows}
    last = max(by_rn, default=1)
    if last < 2:
        return {"status": 200, "data": {"deliveries": [], **beside}}
    start = max(2, last - (SMART_HISTORY_WINDOW - 1))
    out: list[dict] = []
    for rn in range(last, start - 1, -1):
        if len(out) >= limit:
            break
        raw = by_rn.get(rn) or {}
        cell = {h: s_(hubdb.typed(raw.get(heads[h]), "hub")) for h in SMART_LEDGER_HEADER}
        if situation and cell["situation"] != situation:
            continue
        if cell["channel"].lower() == "rehearsal":
            continue
        out.append({"situation": cell["situation"], "person": cell["person"], "expires": cell["expires"],
                    "channel": cell["channel"], "at": cell["at"], "key": cell["key"], "status": "sent"})
    words = sent_words(sess.reads, [d["key"] for d in out if d["key"]], is_admin(sess.user))
    for d in out:
        d.update(words.get(d.pop("key"), {}))
    return {"status": 200, "data": {"deliveries": out, **beside}}


NOT_SENT_STATES = ("failed", "refused", "no_phone", "unknown")
NOT_SENT_SHOWN = 100


def sent_words(reads: L.Reads, keys: list[str], admin: bool) -> dict[str, dict[str, Any]]:
    """What left for each ledger key, from the outbox's sent row: the words (secrets withheld, for an admin only), the
    subject and whether the provider gave a receipt. A send from before the outbox kept its words has none."""
    import smart_comms as SMC  # noqa: PLC0415 - the transport's outbox
    if not keys:
        return {}
    try:
        got = reads.db.query(f"select idem_key, ask, body, receipt from {SMC.OUTBOX} where state = 'sent' and"
                             " (idem_key = any(%s) or ask ->> 'ledger_key' = any(%s)) order by updated_at",
                             (keys, keys))
    except Exception:  # noqa: BLE001 - the deliveries still stand without their words
        return {}
    out: dict[str, dict[str, Any]] = {}
    for idem, ask, body, receipt in got:
        a = ask if isinstance(ask, dict) else json.loads(ask or "{}")
        c = {"ask": a}
        out[s_(a.get("ledger_key")) or s_(idem)] = {
            "text": SMC.withheld(body, c)[:600] if admin else "",
            "subject": SMC.withheld(a.get("subject") or "", c)[:160] if admin else "",
            "receipt": bool(s_(receipt))}
    return out


def not_sent(reads: L.Reads) -> list[dict[str, Any]] | None:
    """The sends the transport tried and that did not leave, newest first: who (masked), under which situation, and
    why. None when the outbox cannot be read."""
    import smart_comms as SMC  # noqa: PLC0415 - the transport's outbox
    try:
        got = reads.db.query(f"select situation, to_digits, state, why, ask, updated_at from {SMC.OUTBOX}"
                             " where state = any(%s) order by updated_at desc limit %s",
                             (list(NOT_SENT_STATES), NOT_SENT_SHOWN))
    except Exception:  # noqa: BLE001 - said as unread, never as none
        return None
    rows = []
    for sit, to, state, why, ask, at in got:
        a = ask if isinstance(ask, dict) else json.loads(ask or "{}")
        rows.append({"situation": s_(sit), "person": s_(a.get("ledger_person")) or s_(a.get("person")),
                     "to": SMC.mask(to), "channel": s_(a.get("channel")) or "sms", "state": s_(state),
                     "why": s_(why)[:240], "at": at.isoformat() if at is not None else ""})
    return rows


def opt_out_list(sess: L.Session, payload: dict) -> dict[str, Any]:
    """optOutList: who asked us to stop, newest first, and the stops since released."""
    if not is_writer(sess.user):
        return DENIED
    reads = sess.reads
    idx = opt_out_index(reads)
    stops = []
    for k in SC._js_keys(idx["by"]):
        v = idx["by"][k]
        stops.append({"key": k, "target": v["target"], "kind": v["kind"], "name": v["name"],
                      "candidate_id": v["candidate_id"], "source": v["source"], "phrase": v["phrase"], "at": v["at"],
                      "scope": v["scope"] or ""})
    stops.sort(key=by_locale_desc(lambda r: r["at"]))
    released: list[dict] = []

    def read_released() -> None:
        for r in OO.opt_out_rows(reads):
            if not s_(r.get("releasedat")):
                continue
            released.append({"key": s_(r.get("targetkey")) or opt_out_key(r.get("target")),
                             "target": s_(r.get("target")), "kind": s_(r.get("kind")), "name": s_(r.get("personname")),
                             "candidate_id": s_(r.get("candidateid")), "source": s_(r.get("source")),
                             "phrase": s_(r.get("phrase")), "at": s_(r.get("at")), "scope": s_(r.get("scope")),
                             "released_at": s_(r.get("releasedat")), "released_by": s_(r.get("releasedby"))})

    attempt(read_released)
    released.sort(key=by_locale_desc(lambda r: r["released_at"]))
    return {"status": 200, "data": {"optOuts": stops, "released": released, "unreadable": idx["error"] or ""}}


def contribution_open(row: dict) -> bool:
    return gsjs.or_text(row.get("state")) in COMM_CONTRIBUTION_OPEN_STATES


def fold_twins(rows: list[dict]) -> list[dict]:
    """One message a person sent, however many of our lines it reached: the provider files it once per line (a group
    with two of our numbers), each its own contribution. Rows of one person with the same words at the same instant
    are one card — a closed one speaks for them all — carrying `twins`, how many more lines it arrived on."""
    groups: dict[tuple, list[dict]] = {}
    order: list[tuple] = []
    for r in rows:
        who, words = gsjs.or_text(r.get("person_key")), " ".join(gsjs.or_text(r.get("text")).split()).lower()
        at = gsjs.or_text(r.get("received_at"))
        key = (who, words, at) if who and words and at else ("", gsjs.or_text(r.get("id")) or str(id(r)), "")
        if key not in groups:
            groups[key] = []
            order.append(key)
        groups[key].append(r)
    out = []
    for key in order:
        members = groups[key]
        lead = next((m for m in members if not contribution_open(m)), members[0])
        out.append({**lead, "twins": len(members) - 1} if len(members) > 1 else lead)
    return out


def replies(sess: L.Session, payload: dict) -> dict[str, Any]:
    """commReplies: the contributions that wait for a person, newest first, a message that reached several of our
    lines folded into one."""
    import smart_comms_doors as SD  # noqa: PLC0415 - the doors import this module
    user = sess.user
    if not user or gsjs.js_str(user.get("role")) not in ("admin", "director", "manager"):
        # the read answers the policy sentence itself, so a listed holder of the Replies edition reaches it
        if not SD.holds(sess):
            return ({"status": 403, "message": "This action is for admin or director or manager."}
                    if user and not user.get("is_service") else DENIED)
    p = payload if isinstance(payload, dict) else {}
    rows, _why = attempt(lambda: board_rows(sess.reads, COMM_CONTRIBUTIONS_HOUSE))
    rows = fold_twins(rows or [])
    every = not gsjs.falsy(p.get("all"))
    out = [r for r in rows if every or contribution_open(r)]
    out.sort(key=by_locale_desc(lambda r: gsjs.or_text(r.get("received_at"))))
    alone = sum(1 for r in rows if gsjs.or_text(r.get("close")) == "machine"
                and gsjs.or_text(r.get("reason")) in COMM_CONTRIBUTION_SILENT_CLOSES)
    return {"status": 200, "data": {"rows": [wire(r) for r in out[:500]],
                                    "open": sum(1 for r in rows if contribution_open(r)),
                                    "closed_by_the_machine": alone, "total": len(rows)}}


def comm_board(sess: L.Session, payload: dict) -> dict[str, Any]:
    """commBoard: what the rehearsal decided — each intent with its bindings, and the dial."""
    user = sess.user
    if not user or gsjs.js_str(user.get("role")) not in ("admin", "director", "manager"):
        return DENIED
    reads = sess.reads
    intents = board_rows(reads, COMM_INTENTS_HOUSE)
    bindings = board_rows(reads, COMM_BINDINGS_HOUSE)
    by_intent: dict[str, list[dict]] = {}
    for b in bindings:
        by_intent.setdefault(gsjs.or_text(b.get("intent_key")), []).append(b)
    rows = []
    for i in intents:
        i["items"] = by_intent.get(gsjs.or_text(i.get("intent_key"))) or []
        rows.append(i)
    word = dial(reads.config())["word"]
    return {"status": 200, "data": {
        "rows": wire(rows), "dial": word,
        "note": ("The dial is off. Nothing is planned and nothing is written." if word == "off"
                 else ("" if rows else "The dial is on; the sweep has not come round yet."))}}


# ---- the broadcast page's who and when -------------------------------------------------------------------------------

def users_row(reads: L.Reads, user: dict | None) -> dict:
    """The session's own users row (userPublic_'s people_id, phone and phones)."""
    uid = gsjs.str_((user or {}).get("id"))
    return next((u for u in reads.users() if uid and gsjs.str_(u.get("userid")) == uid), None) or {}


def broadcast_who(reads: L.Reads, user: dict | None) -> dict[str, Any]:
    """commBroadcastWho_."""
    out: dict[str, Any] = {"ok": False, "above": False, "hm": False, "master": False, "email": "", "name": "",
                           "badges": [], "why": ""}
    if not user or user.get("is_service"):
        out["why"] = "a broadcast is written by a person, from their own session"
        return out
    out["email"] = gsjs.trim(gsjs.or_text(user.get("email"))).lower()
    out["name"] = gsjs.trim(gsjs.or_text(first(user.get("display_name"), user.get("email"), "")))
    worn, _why = attempt(lambda: badges_worn_by(reads, user))
    out["badges"] = worn or []
    out["master"] = bool(out["email"]) and sc.is_master_email(out["email"])
    out["above"] = out["master"] or any(b in out["badges"] for b in COMM_BROADCAST_ABOVE)
    # a team lead broadcasts as a house manager does (the operator's matrix, 2026-10-29), never as a director
    out["hm"] = any(b in out["badges"] for b in COMM_BROADCAST_HOUSE_MANAGER)
    out["ok"] = out["above"] or out["hm"]
    if not out["ok"]:
        out["why"] = ("broadcasting is for a house manager or a team lead (their own house and all staff) and, for "
                      "every audience, a director, administrator or the master")
    return out


def badges_worn_by(reads: L.Reads, user: dict) -> list[str]:
    """userBadgesWornBy_: the account's badges, then the ones the calendar derives."""
    worn = sc.badges_worn(user.get("types"), user.get("role"))
    derived = user.get("derived_types") if isinstance(user.get("derived_types"), list) else \
        SP.calendar_badges(reads, user)
    for b in derived:
        if b not in worn:
            worn.append(b)
    return worn


def covered_situation_state(rows: list[dict]) -> dict[str, Any]:
    """openShiftCoveredSituationState_."""
    out: dict[str, Any] = {"id": OPEN_SHIFT_COVERED_SITUATION, "on": False, "found": False, "sms_text": ""}
    for s in rows:
        if gsjs.js_str(s.get("id")) != OPEN_SHIFT_COVERED_SITUATION:
            continue
        out["found"] = True
        out["sms_text"] = gsjs.or_text(s.get("sms_text"))
    sit = situation_on(rows, OPEN_SHIFT_COVERED_SITUATION)
    if sit is not None:
        chans = [c.lower() for c in smart_list(sit.get("channels")) if c.lower()] or ["sms", "email"]
        # the seed spells this row's sms_text, so no planted letter can stand in for its words
        out["on"] = "sms" in chans and bool(gsjs.trim(gsjs.or_text(sit.get("sms_text"))))
    return out


def call_off_date(raw: Any) -> str:
    """commCallOffDate_."""
    if isinstance(raw, SheetDate):
        return raw.at.astimezone(NY).strftime("%Y-%m-%d")
    s = text(raw)
    if not s:
        return ""

    def ymd(y: str, m: str, d: str) -> str:
        yy, mm, dd = int(y), int(m), int(d)
        if not yy or not mm or not dd or yy < 1900 or yy > 2999 or not 1 <= mm <= 12 or not 1 <= dd <= 31:
            return ""
        try:
            datetime(yy, mm, dd)
        except ValueError:
            return ""
        return f"{yy}-{mm:02d}-{dd:02d}"

    m = re.match(r"^([0-9]{4})-([0-9]{1,2})-([0-9]{1,2})(?![A-Za-z0-9_])", s)
    if m:
        return ymd(m.group(1), m.group(2), m.group(3))
    m = re.match(r"^([0-9]{1,2})/([0-9]{1,2})/([0-9]{4})(?![A-Za-z0-9_])", s)
    if m:
        return ymd(m.group(3), m.group(1), m.group(2))
    return ""


def audience_read(cell: Any) -> dict[str, Any]:
    """commCallOffAudienceRead_."""
    out: dict[str, Any] = {"day": "", "house": "", "to": [], "readable": False}
    raw = text(cell)
    if not raw:
        return out
    try:
        got = json.loads(raw)
    except ValueError:
        return out
    if not got or not isinstance(got, (dict, list)):
        return out
    obj = got if isinstance(got, dict) else {}
    day = gsjs.or_text(obj.get("day"))
    out["day"] = day if re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", day) else ""
    out["house"] = gsjs.or_text(obj.get("house"))
    for pair in obj.get("to") if isinstance(obj.get("to"), list) else []:
        addr = gsjs.trim(gsjs.or_text(pair[0] if isinstance(pair, list) and pair else
                                      (pair.get("to") if isinstance(pair, dict) else None)))
        if not addr:
            continue
        name = pair[1] if isinstance(pair, list) and len(pair) > 1 else (pair.get("name") if isinstance(pair, dict)
                                                                         else None)
        out["to"].append({"to": addr, "name": gsjs.trim(gsjs.or_text(name))})
    out["readable"] = True
    return out


def house_label(location: Any) -> str:
    """commCallOffHouseLabel_: "CAN - JH - ABD2704" → "JH"."""
    loc = text(location)
    parts = loc.split(" - ")
    return gsjs.trim(" - ".join(parts[1:-1])) if len(parts) >= 3 else loc


def covered_masked(why: Any) -> str:
    """openShiftCoveredMasked_: a number in the words shows its last four."""
    def one(m: re.Match) -> str:
        d = digits(m.group(0))
        return "•••" + d[-4:] if len(d) >= 10 else m.group(0)
    return re.sub(r"\+?[0-9][0-9" + _JS_WS + r"().-]{8,}[0-9]", one, gsjs.or_text(why))


def covered_board(sess: L.Session, payload: dict) -> dict[str, Any]:
    """openShiftCoveredBoard: what the covered-shift follow-ups did, for the Broadcast page."""
    reads = sess.reads
    who = broadcast_who(reads, sess.user)
    out: dict[str, Any] = {"can_see": bool(who["ok"]), "why": who["why"],
                           "situation": covered_situation_state(situations(reads)), "items": [], "error": ""}
    if not who["ok"]:
        return {"status": 200, "data": out}
    rows, _why = attempt(lambda: call_off_rows(reads))
    items = []
    for rid, c in (rows or {}).items():
        prod, test = text(c.get(COVERED_COLS["prod"])), text(c.get(COVERED_COLS["test"]))
        filled_at = text(c.get("covered_filled_at"))
        if not prod and not test and not filled_at:
            continue
        aud = audience_read(c.get("everyone_audience"))
        items.append({"id": gsjs.or_text(first(c.get("id"), rid)),
                      "day": aud["day"] or call_off_date(c.get("shift_date")),
                      "house": house_label(aud["house"]) or "", "state": prod or test or "waiting",
                      "rehearsal": not prod and bool(test), "why": covered_masked(c.get(COVERED_COLS["why"])),
                      "at": text(c.get(COVERED_COLS["at"])) or filled_at, "filled_at": filled_at,
                      "count": text(c.get("covered_count")), "audience": len(aud["to"]) if aud["readable"] else None,
                      "ask": text(c.get("everyone_state")) or text(c.get("everyone_test_state"))})
    items.sort(key=lambda i: gsjs.js_str(i["at"]), reverse=True)
    out["items"] = items[:OPEN_SHIFT_COVERED_HISTORY]
    return {"status": 200, "data": out}


def digest_setting(reads: L.Reads, key: str, fallback: float, low: float, high: float) -> float:
    """digestSetting_ for a number: the words book's Digest Settings row, else the fallback."""
    got = digest_settings(reads).get(key.lower())
    if got is None:
        return fallback
    n = js_number(got)
    if math.isnan(n) or n < low or n > high:
        return fallback
    return n


def digest_word(reads: L.Reads, key: str, fallback: str) -> str:
    """digestSetting_ for a word: the row's text, else the fallback."""
    return gsjs.trim(gsjs.or_blank(digest_settings(reads).get(key.lower()))) or fallback


def digest_settings(reads: L.Reads) -> dict[str, str]:
    """The words book's Digest Settings rows that are on: key → its value as written."""
    def read() -> dict[str, Any]:
        sid = gsjs.trim(reads.db.prop("HUB_GENERIC_CONFIG_ID"))
        if not sid:
            return {}
        ref = HT.tab_of(reads, sid, "Digest Settings", "the words book")
        if ref is None:
            return {}
        heads = [re.sub(r"[^a-z0-9]+", "_", gsjs.trim(gsjs.or_text(h)).lower()) for h in ref.headers]
        out: dict[str, Any] = {}
        for _rn, raw in reads.db.rows(ref):
            row = {h: text(hubdb.typed(raw.get(src), "hub")) for h, src in zip(heads, ref.headers) if h}
            if not any(row.values()):
                continue
            if lower(first(row.get("active"), "on")) in ("off", "false", "no", "0"):
                continue
            sk, raw_v = gsjs.trim(row.get("key") or "").lower(), gsjs.trim(row.get("value") or "")
            if sk and raw_v != "":
                out[sk] = raw_v
        return out
    return reads.once("scd:digest_settings", read)


def broadcast_calendar(reads: L.Reads) -> dict[str, Any]:
    """commBroadcastCalendar_: who works where in the window the page reads, off the hotline calendar."""
    def read() -> dict[str, Any]:
        out: dict[str, Any] = {"readable": False, "why": "", "from": "", "houses": {}, "order": [], "managers": [],
                               "rows": 0}
        sid = gsjs.trim(reads.db.prop("HOTLINE_CALENDAR_ID"))
        if not sid:
            raise Defer("no hotline calendar is declared in the depot")
        ref = reads.tab_of(sid, HOTLINE_CALENDAR_TAB, "the hotline calendar")
        if ref is None:
            out["why"] = ("the hotline calendar could not be read (the hotline calendar has no tab named "
                          + HOTLINE_CALENDAR_TAB + ") — that is \"we cannot see\", never \"nobody works there\"")
            return out
        values = reads.db.grid(ref)
        out["readable"] = True
        head = [gsjs.trim(gsjs.or_text(h)).lower() for h in (values[0] if values else [])]

        def col(name: str, fallback: int) -> int:
            return head.index(name) if name in head else fallback

        c_loc, c_name, c_des, c_phone, c_date = (col("location", 0), col("employee", 1), col("designation", 2),
                                                 col("phone", 3), col("date", 4))
        days = digest_setting(reads, "comm_broadcast_house_days", COMM_BROADCAST_HOUSE_DAYS, 1, 366)
        today = reads.now.astimezone(NY).strftime("%Y-%m-%d")
        noon = datetime.strptime(today, "%Y-%m-%d").replace(hour=12, tzinfo=timezone.utc)
        out["from"] = (noon - timedelta(milliseconds=days * 86400000)).strftime("%Y-%m-%d")
        houses: dict[str, dict] = out["houses"]
        for line in values[1:]:
            def at(i: int) -> Any:
                return line[i] if i < len(line) else ""
            loc, name = text(at(c_loc)), text(at(c_name))
            if not loc or not name:
                continue
            up = name.upper()
            if up == "OPEN" or "WORKSHOP" in up:
                continue
            day = L.broadcast_day(at(c_date), "America/New_York")
            if not day or day < out["from"]:
                continue
            key = gsjs.name_key(name)
            if not key:
                continue
            house = houses.setdefault(loc, {"location": loc, "label": house_label(loc), "people": {}})
            person = house["people"].setdefault(key, {"name": name, "key": key, "meddel": False, "manager": False,
                                                      "phone": ""})
            des = text(at(c_des))
            if "*" in des:
                person["meddel"] = True
            if des == "**":
                person["manager"] = True
            ph = text(at(c_phone))
            if not person["phone"] and ph:
                person["phone"] = ph
            out["rows"] += 1
        for loc, h in houses.items():
            people = sorted(h["people"].values(), key=lambda p: p["name"].lower())
            h["people"] = people
            for p in people:
                if p["manager"]:
                    out["managers"].append({"name": p["name"], "key": p["key"], "location": loc,
                                            "phone_key": digits(p["phone"])[-10:]})
        out["order"] = sorted(houses, key=lambda loc: houses[loc]["label"].lower())
        return out
    return reads.once("scd:broadcast_calendar", read)


def shared_key(reads: L.Reads, v: Any) -> bool:
    """commBroadcastSharedKey_: a shared line names nobody (the line directory as the Staff app reads it)."""
    k = digits(v)[-10:]
    if len(k) != 10:
        return False
    if k in SHARED_LINE_DIGITS:
        return True
    row = SC._line_row(reads, k)
    return bool(row and row.get("shared"))


def broadcast_people_rows(reads: L.Reads) -> list[dict]:
    """commBroadcastPeopleRows_."""
    return SP.without_isp_clients(reads, SP.people_merged(reads, SP._people(reads)))


def own_houses(reads: L.Reads, user: dict, cal: dict[str, Any]) -> dict[str, Any]:
    """commBroadcastOwnHouses_ over commBroadcastIdentity_: the houses the calendar names this person the manager of."""
    me = users_row(reads, user)
    name_key, phones = "", []
    pid = re.sub(r"^people:", "", gsjs.or_text(me.get("peopleid")))
    pid = gsjs.trim(pid)
    mine = None
    if pid:
        rows, _why = attempt(lambda: broadcast_people_rows(reads))
        mine = next((p for p in rows or [] if p and gsjs.or_text(p.get("id")) == pid), None)
    if mine is not None and gsjs.name_key(mine.get("name")):
        name_key = gsjs.name_key(mine.get("name"))
        phones = [mine.get("phone")]
    else:
        name_key = gsjs.name_key(user.get("display_name"))
        phones = [me.get("phone")]
        for p in SP._parse_phones(me.get("phones")):
            phones.append(p.get("number") if isinstance(p, dict) else p)
    by_name: list[str] = []
    candidates: list[dict] = []
    for m in cal.get("managers") or []:
        if name_key and m["key"] == name_key:
            if m["location"] not in by_name:
                by_name.append(m["location"])
        else:
            candidates.append(m)
    if by_name:
        return {"houses": by_name, "via": "name"}
    held: set[str] = set()
    for v in phones:
        d = digits(v)[-10:]
        if len(d) == 10 and not shared_key(reads, d):
            held.add(d)
    by_phone: list[str] = []
    for m in candidates:
        if m["phone_key"] and m["phone_key"] in held and not shared_key(reads, m["phone_key"]):
            if m["location"] not in by_phone:
                by_phone.append(m["location"])
    return {"houses": by_phone, "via": "phone" if by_phone else ""}


def broadcast_situation_state(reads: L.Reads) -> dict[str, Any]:
    """commBroadcastSituationState_ over commBroadcastSituation_."""
    rows = situations(reads)
    out: dict[str, Any] = {"id": COMM_BROADCAST_SITUATION, "on": False, "found": False, "sms_text": "", "cc_count": 0,
                           "why": ""}
    row = situation_last(rows, COMM_BROADCAST_SITUATION)
    if row is not None:
        out["found"] = True
        out["sms_text"] = gsjs.or_text(row.get("sms_text"))
        out["cc_count"] = len(smart_list(row.get("cc")))
    sit = situation_on(rows, COMM_BROADCAST_SITUATION)
    out["on"] = bool(sit and "sms" in smart_list(sit.get("channels"))
                     and "{message}" in gsjs.or_text(sit.get("sms_text")))
    if not out["on"]:
        out["why"] = (("the situation `" + COMM_BROADCAST_SITUATION + "` is not in the situations tab yet — it is "
                       "planted on the first read after the publish that carries it") if row is None else
                      ("the situation `" + COMM_BROADCAST_SITUATION + "` is switched off on the Desk, does not name "
                       "sms, or its words have lost {message} — nothing can be sent until it is on with the words in "
                       "place"))
    return out


def broadcast_mode(reads: L.Reads) -> dict[str, Any]:
    """commBroadcastMode_: the brakes as a sender sees them."""
    cfg = reads.config()
    d = dial(cfg)
    st = test_mode_state(cfg)
    return {"test_mode": "on" if st["on"] or st["unrecognized"] else "off", "dial": d["word"],
            "dial_readable": d["readable"], "quiet_now": quiet_now(reads), "quiet_words": quiet_words(),
            "quiet_until": QUIET_TO, "send_switch": "on" if send_enabled(reads, cfg) else "off"}


def broadcast_rows(reads: L.Reads) -> list[dict]:
    """commBroadcastRows_: the broadcasts — Postgres's once the Staff Broadcast is given to Python (comm_broadcast.py),
    else the broadcast house's copy — their JSON cells parsed and a Date as cellText_."""
    import resource_rows as RR  # noqa: PLC0415 - the broadcasts' own rows
    if RR.uploaded(reads.db, COMM_BROADCAST_RESOURCE):
        cols = RR.columns(reads, COMM_BROADCAST_RESOURCE)
        return [r for r in (broadcast_row(cols, cells) for _k, cells in RR.table_rows(reads, COMM_BROADCAST_RESOURCE))
                if r is not None]
    if not reads.db.house_moved(COMM_BROADCAST_HOUSE):
        raise RuntimeError("the broadcast house (" + COMM_BROADCAST_HOUSE + ") is not declared yet — "
                           "tools/mint_comm_broadcasts_house.py mints it")
    res = where(reads, COMM_BROADCAST_HOUSE)
    must_book(res, "the broadcast house")
    if res.ref is None:
        return []
    return [r for r in (broadcast_row(res.ref.headers, raw) for _rn, raw in reads.db.rows(res.ref)) if r is not None]


def broadcast_row(heads: Any, raw: dict) -> dict | None:
    """One broadcast as commBroadcastRows_ reads it; None for a row without an id."""
    obj: dict[str, Any] = {}
    for h in heads:
        name = gsjs.trim(gsjs.or_text(h))
        if not name:
            continue
        v = hubdb.typed(raw.get(h), "hub")
        if name in COMM_BROADCAST_JSON_COLS:
            try:
                obj[name] = json.loads(gsjs.or_text(first(v, "[]")))
            except ValueError:
                obj[name] = []
        elif isinstance(v, SheetDate):
            obj[name] = hubdb.cell_text(v)
        else:
            obj[name] = v
    return None if gsjs.falsy(obj.get("id")) else obj


def outcome_of(r: Any) -> str:
    """String(r.o || 'pending') of one recipient."""
    return gsjs.or_text(first(r.get("o") if isinstance(r, dict) else None, "pending"))


def broadcast_state(row: dict, at_ms: float) -> str:
    """commBroadcastState_: a send whose row stopped moving is interrupted."""
    state = gsjs.or_text(row.get("state"))
    if state == "sending":
        t = gsjs.date_parse(gsjs.or_text(first(row.get("updatedAt"), row.get("createdAt"), "")))
        if t is not None and at_ms - t > COMM_BROADCAST_STALE_MS:
            return "interrupted"
    return state


def broadcast_public(reads: L.Reads, row: dict, who: dict, with_recipients: bool) -> dict[str, Any]:
    """commBroadcastPublic_: names and last four digits; full numbers stay in the house."""
    recipients = row.get("recipients") if isinstance(row.get("recipients"), list) else []
    mine = bool(who) and lower(row.get("by_email")) == gsjs.or_text(who.get("email"))
    at_ms = now_ms(reads)
    state = broadcast_state(row, at_ms)
    tally = {"sent": 0, "recorded": 0, "held": 0, "refused": 0, "failed": 0, "pending": 0, "withdrawn": 0}
    for r in recipients:
        o = outcome_of(r)
        if o in tally:
            tally[o] += 1
    may = mine or bool(who and who.get("above"))
    quiet = quiet_now(reads)
    live = state in ("held_quiet", "carrying", "partial", "interrupted") and tally["pending"] > 0
    mock_moved = ""
    if live:
        stamped = gsjs.or_text(row.get("dial"))
        was_mock = gsjs.or_text(row.get("test_mode")) == "on" or (stamped != "" and stamped != "send")
        d = dial(reads.config())
        if was_mock and d["readable"] and d["word"] == "send":
            mock_moved = ("Confirmed while test mode was on, and test mode is off now — the rest was never sent, so a "
                          "line written as a test cannot reach real phones; write it again to send it to people")
    gone = False
    if live and not mock_moved and state == "interrupted":
        t = gsjs.date_parse(gsjs.or_text(first(row.get("updatedAt"), row.get("createdAt"), "")))
        gone = t is not None and at_ms - t > RPC_RECEIPT_TTL_S * 1000 - COMM_BROADCAST_RECEIPT_MARGIN_MS
    hold_why = mock_moved
    if not hold_why and gone:
        pending = sum(1 for r in recipients if outcome_of(r) == "pending")
        unsure = min(pending, COMM_BROADCAST_MARK_EVERY - 1)
        hours = gsjs.js_round((RPC_RECEIPT_TTL_S * 1000 - COMM_BROADCAST_RECEIPT_MARGIN_MS) / 360000) / 10
        hold_why = ("This pass was cut short more than " + gsjs.num_str(hours) + " hours ago, and the receipts that "
                    "stop a second text have expired — up to " + str(unsure) + " of the " + str(pending)
                    + " not marked may already have it, so it is not continued. Withdraw it, and reach the rest "
                    "another way if it still matters.")
    dropped = row.get("dropped")
    if isinstance(dropped, str):
        try:
            dropped = json.loads(dropped or "[]")
        except ValueError:
            dropped = []

    def num(v: Any) -> Any:
        """Number(v) || 0, as JSON writes it."""
        n = js_number(v) if v is not None else math.nan
        if math.isnan(n) or n == 0:
            return 0
        return None if math.isinf(n) else (int(n) if n == int(n) else n)

    def each(r: Any) -> dict:
        return r if isinstance(r, dict) else {}

    return {
        "id": gsjs.js_str(row.get("id")), "at": gsjs.or_text(row.get("createdAt")),
        "updated_at": gsjs.or_text(row.get("updatedAt")), "by_name": gsjs.or_text(row.get("by_name")), "mine": mine,
        "audience": gsjs.or_text(row.get("audience")), "audience_label": gsjs.or_text(row.get("audience_label")),
        "house": gsjs.or_text(row.get("house")), "meddel": gsjs.or_text(row.get("meddel")) == "yes",
        "message": gsjs.or_text(row.get("message")), "signature": gsjs.or_text(row.get("signature")),
        "body_sample": gsjs.or_text(row.get("body_sample")),
        "state": state, "count": len(recipients), "tally": tally,
        "test_mode": gsjs.or_text(row.get("test_mode")), "dial": gsjs.or_text(row.get("dial")),
        "why": gsjs.or_text(row.get("why")), "warnings": gsjs.or_text(row.get("warnings")),
        "dropped": [{"reason": gsjs.or_text((d or {}).get("reason") if isinstance(d, dict) else None),
                     "label": gsjs.or_text((d or {}).get("label") if isinstance(d, dict) else None),
                     "count": num((d or {}).get("count") if isinstance(d, dict) else None)}
                    for d in (dropped if isinstance(dropped, list) else [])],
        "withdrawn_by": gsjs.or_text(row.get("withdrawn_by")), "withdrawn_at": gsjs.or_text(row.get("withdrawn_at")),
        "hold_why": hold_why,
        "can_continue": may and tally["pending"] > 0 and not quiet and not hold_why
                        and state in ("partial", "interrupted", "carrying"),
        "can_withdraw": may and tally["pending"] > 0 and state in ("held_quiet", "carrying", "partial", "interrupted"),
        "can_resend": may and (state == "stopped" or bool(mock_moved)),
        "recipients": [{"name": gsjs.or_text(each(r).get("n")), "to": mask(each(r).get("t")),
                        "from": gsjs.or_text(each(r).get("f")),
                        "outcome": gsjs.or_text(first(each(r).get("o"), "pending")),
                        "why": gsjs.or_text(each(r).get("w"))} for r in recipients] if with_recipients else []}


def broadcast_board(sess: L.Session, payload: dict) -> dict[str, Any]:
    """staffBroadcastBoard: the page's one read; anybody signed in may ask, and the answer says who may send."""
    reads, user = sess.reads, sess.user
    who = broadcast_who(reads, user)
    out: dict[str, Any] = {
        "can_send": who["ok"], "above": who["above"], "hm": who["hm"], "master": who["master"], "why": who["why"],
        "name": who["name"], "audiences": [], "houses": [], "own_houses_via": "", "situation": None, "mode": None,
        "house_ready": False, "calendar": {"readable": False, "why": "", "from": ""},
        "limits": dict(COMM_BROADCAST_LIMITS), "history": [], "history_error": ""}
    if not who["ok"]:
        return {"status": 200, "data": out}
    out["situation"] = broadcast_situation_state(reads)
    out["mode"] = broadcast_mode(reads)
    out["house_ready"] = reads.db.house_moved(COMM_BROADCAST_HOUSE)
    cal = broadcast_calendar(reads)
    out["calendar"] = {"readable": bool(cal["readable"]), "why": cal["why"], "from": cal["from"]}
    own = None if who["above"] else own_houses(reads, user or {}, cal)
    if own:
        out["own_houses_via"] = own["via"]
    locations = cal["order"] if who["above"] else (own["houses"] if own else [])
    for loc in locations:
        h = cal["houses"].get(loc)
        if not h:
            continue
        out["houses"].append({"location": loc, "label": h["label"], "people": len(h["people"]),
                              "meddel": sum(1 for p in h["people"] if p["meddel"])})
    for aid, label, hm in COMM_BROADCAST_AUDIENCES:
        allowed = who["above"] or hm
        why = ""
        if not allowed:
            why = label + " is sent by a director, administrator or the master."
        elif aid == "house" and not out["houses"]:
            allowed = False
            why = (cal["why"] or "the calendar could not be read") if not cal["readable"] else \
                ("the calendar lists no house in the window it reads" if who["above"]
                 else "the calendar names you as the manager of no house in the window it reads")
        out["audiences"].append({"id": aid, "label": label, "allowed": allowed, "why": why})

    def hist() -> list[dict]:
        rows = [r for r in broadcast_rows(reads)
                if who["above"] or lower(r.get("by_email")) == who["email"]]
        rows.sort(key=lambda r: gsjs.js_str(r.get("createdAt")), reverse=True)
        out_rows = []
        for r in rows[:COMM_BROADCAST_HISTORY]:
            if not isinstance(r.get("recipients"), list):
                try:
                    r["recipients"] = json.loads(gsjs.or_text(first(r.get("recipients"), "[]")))
                except ValueError:
                    r["recipients"] = []
            out_rows.append(broadcast_public(reads, r, who, True))
        return out_rows

    got, why = attempt(hist)
    if why:
        out["history_error"] = why[:200]
    else:
        out["history"] = got
    return {"status": 200, "data": out}


# ---- the proposals ---------------------------------------------------------------------------------------------------

def vocab_norm(body: Any) -> str:
    """commVocabularyNorm_: what optOutIntent_ does to a body before it compares."""
    s = gsjs.or_text(body).lower()
    s = re.sub(r"[^a-zà-ú0-9" + _JS_WS + r"]", " ", s, flags=re.I)
    return gsjs.trim(re.sub(r"[" + _JS_WS + r"]+", " ", s))


def vocab_shipped(key: str) -> list[str]:
    """commVocabularyShipped_."""
    raw = {"opt_out_phrases": OPT_OUT_PHRASES_SHIPPED, "opt_in_phrases": OPT_IN_PHRASES_SHIPPED,
           "wrong_number_phrases": WRONG_NUMBER_PHRASES_SHIPPED}.get(key, "")
    out: list[str] = []
    for w in re.split(r"[,;\n]+", raw):
        n = vocab_norm(w)
        if n and n not in out:
            out.append(n)
    return out


def proposals_rows(reads: L.Reads) -> dict[str, Any]:
    """commProposalsRows_."""
    if not reads.db.house_moved(COMM_PROPOSALS_TAB):
        return {"rows": [], "declared": False,
                "why": "The proposals house is not declared yet — run tools/mint_comm_proposals_house.py, then let the "
                       "counter write into it."}

    def read() -> list[dict]:
        out = []
        for r in normalized(reads, COMM_PROPOSALS_TAB) or []:
            pid = s_(r.get("id"))
            if not pid:
                continue
            row = {f: s_(r.get(k)) for f, k in PROPOSAL_FIELDS}
            row["id"] = pid
            row["status"] = row["status"] or "proposed"
            out.append(row)
        return out

    got, why = attempt(read)
    if why:
        return {"rows": [], "declared": True, "why": "The proposals house could not be read: " + why}
    return {"rows": got, "declared": True, "why": ""}


def vocabulary_rows(reads: L.Reads) -> dict[str, Any]:
    """commVocabularyRows_."""
    if not reads.db.house_moved(COMM_VOCAB_TAB):
        return {"rows": [], "declared": False,
                "why": "The vocabulary house is not declared yet — no decision can be recorded until "
                       "tools/mint_comm_vocabulary_house.py has run."}

    def read() -> list[dict]:
        out = []
        for r in normalized(reads, COMM_VOCAB_TAB) or []:
            phrase = s_(r.get("phrasenorm")) or vocab_norm(s_(r.get("phrase")))
            if not phrase:
                continue
            out.append({"id": s_(r.get("id")), "created_at": s_(r.get("createdat")),
                        "decision": s_(r.get("decision")).lower(), "vocabulary": s_(r.get("vocabulary")),
                        "phrase": phrase, "proposal_id": s_(r.get("proposalid")), "family": s_(r.get("family")),
                        "evidence_n": s_(r.get("evidencen")), "people_n": s_(r.get("peoplen")),
                        "coverage": s_(r.get("coverage")), "would_catch": s_(r.get("wouldcatch")),
                        "would_catch_wrongly": s_(r.get("wouldcatchwrongly")), "example_ref": s_(r.get("exampleref")),
                        "decided_by": s_(r.get("decidedby")),
                        "decided_at": s_(r.get("decidedat")) or s_(r.get("createdat")),
                        "reason": s_(r.get("reason")), "source": s_(r.get("source"))})
        return out

    got, why = attempt(read)
    if why:
        return {"rows": [], "declared": True, "why": "The vocabulary house could not be read: " + why}
    return {"rows": got, "declared": True, "why": ""}


def vocab_learned(decisions: dict[str, Any]) -> dict[str, list[str]]:
    """commVocabularyLearned_ for each vocabulary a word may be taught to."""
    by: dict[str, list[str]] = {v: [] for v in COMM_VOCAB_PROPOSABLE}
    if decisions["why"]:
        return by
    releases = vocab_shipped("opt_in_phrases")
    for r in decisions["rows"]:
        v = r["vocabulary"]
        if r["decision"] != "approved" or v not in by:
            continue
        if r["phrase"] in releases or r["phrase"] in vocab_shipped(v) or r["phrase"] in by[v]:
            continue
        if len(by[v]) >= COMM_VOCAB_MAX_LEARNED:
            continue
        by[v].append(r["phrase"])
    return by


def proposals_list(sess: L.Session, payload: dict) -> dict[str, Any]:
    """commProposalsList: the words waiting for a person, with what each one would cost."""
    if not is_admin(sess.user):
        return DENIED
    reads = sess.reads
    props = proposals_rows(reads)
    decisions = vocabulary_rows(reads)
    by_proposal: dict[str, dict] = {}
    by_phrase: dict[str, dict] = {}
    for d in decisions["rows"]:
        if d["proposal_id"]:
            by_proposal[d["proposal_id"]] = d
        by_phrase[d["vocabulary"] + "|" + d["phrase"]] = d
    rows = []
    for p in props["rows"]:
        norm = vocab_norm(p["phrase"])
        decided = by_proposal.get(p["id"])
        if decided is None:
            decided = next((by_phrase[v + "|" + norm] for v in COMM_VOCAB_PROPOSABLE if v + "|" + norm in by_phrase),
                           None)
        p["phrase_norm"] = norm
        p["decision"] = decided["decision"] if decided else ""
        p["decided_by"] = decided["decided_by"] if decided else ""
        p["decided_at"] = decided["decided_at"] if decided else ""
        p["decision_reason"] = decided["reason"] if decided else ""
        p["decided_vocabulary"] = decided["vocabulary"] if decided else ""
        rows.append(p)
    learned = vocab_learned(decisions)
    return {"status": 200, "data": {
        "rows": rows, "proposable": list(COMM_VOCAB_PROPOSABLE), "forbidden": list(COMM_VOCAB_FORBIDDEN),
        "shipped": {v: vocab_shipped(v) for v in ("opt_out_phrases", "opt_in_phrases", "wrong_number_phrases")},
        "learned": {v: learned[v] for v in COMM_VOCAB_PROPOSABLE}, "decisions": decisions["rows"],
        "houses": {"proposals": {"tab": COMM_PROPOSALS_TAB, "declared": props["declared"], "why": props["why"]},
                   "vocabulary": {"tab": COMM_VOCAB_TAB, "declared": decisions["declared"], "why": decisions["why"]}}}}


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {
    "smartCommsGet": desk_get, "smartCommsHistory": history, "optOutList": opt_out_list, "commReplies": replies,
    "commBoard": comm_board, "openShiftCoveredBoard": covered_board, "staffBroadcastBoard": broadcast_board,
    "commProposalsList": proposals_list}
# HUB_POLICY: the roles each read is declared for; the Desk's read opens to an edition holder in its handler
POLICY: dict[str, dict[str, Any]] = {
    "smartCommsGet": {"roles": ()},
    "smartCommsHistory": {"roles": ("admin", "manager")},
    "optOutList": {"roles": ("admin", "manager")},
    "commReplies": {"roles": ()},
    "commBoard": {"roles": ("admin", "director", "manager")},
    "openShiftCoveredBoard": {"roles": ()},
    "staffBroadcastBoard": {"roles": ()},
    "commProposalsList": {"roles": ("admin",)}}
