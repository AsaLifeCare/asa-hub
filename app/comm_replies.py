"""The mailbox ear on Python (CommInbound.gs commRepliesSweep): the platform's mailbox read for replies to the threads
the platform opened, each one captured for the person who wrote it as commInboundCapture_ captures it — the thread it
answers, what it says about the open items, a consent word, a stated contact window, a correction, an acknowledgement
of one — and, on the same tick behind its own six-hour stamp, the close (commCloseSweep_).

Here are the readers every step of that asks, each a port of the Apps Script function it names (CommInbound.gs, with
CommContribution.gs, CommQualify.gs, CommDesk.gs, CommConsent.gs, CommRepair.gs and CommRecord.gs where the ear asks
them), and the look (commRepliesDue): the fifteen-minute window, the dial and the inbox itself, read over IMAP
(mail_server.py, the Mail app's own reading, the first box) and never inside the write lock. Every write is
app/comm_replies_writes.py's: the houses as app.edits kept records, the opt-out list where opt_outs_writes keeps it,
the stamps (Script Properties comm_mail_last_run and comm_close_last_run) in app.comm_replies_state
(db/comm_replies.sql)."""
from __future__ import annotations

import functools
import hashlib
import math
import re
from datetime import datetime, timezone
from typing import Any, Callable

import gsjs
import hubdb
import locations as L
import mail_server as MB
import opt_outs as OO
import resource_rows as RR
import smart_clock as SK
import smart_comms_desk as SCD
import staff as SP
from gsjs import SheetDate
from scope import Defer

APP_ID = "comm-replies"
STATE = "app.comm_replies_state"
DENIED = {"status": 403, "message": "Requires an admin or manager account"}
ACTOR = "asa-hub:comm"

# CommInbound.gs
MAIL_SWEEP_KEY = "comm_mail_last_run"
MAIL_SWEEP_GAP_S = 15 * 60
MAIL_READ = 40
CLOSE_SWEEP_KEY = "comm_close_last_run"
CLOSE_SWEEP_GAP_S = 6 * 3600
CLOSE_SILENCE_DAYS = 7
CLOSE_LOUD_DAYS = 3
CLOSE_PER_PASS = 30
REHEARSAL_MARK = "REHEARSAL (test mode, the tester answered — not the person) — "
WINDOW_ASK_PURPOSE = "contact.window"

# the houses (CommRecord.gs, CommQualify.gs, CommRepair.gs, CommConsent.gs)
INTENTS = SCD.COMM_INTENTS_HOUSE
BINDINGS = SCD.COMM_BINDINGS_HOUSE
CONTRIBUTIONS = SCD.COMM_CONTRIBUTIONS_HOUSE
OBSERVATIONS = "comm_observations"
REPAIRS = "comm_repairs"
CONSENT = "entity_comm_consent"
OBSERVATION_TYPES = ("sent", "redirected", "doubt", "held", "escalated", "unanswered", "replied", "unmatched",
                     "correlated", "contribution", "needs_human", "settled", "dismissed", "stopped", "consent_changed")
CONTRIBUTION_TERMINAL_STATES = ("settled", "dismissed", "stopped")
CONTRIBUTION_OPEN_STATES = SCD.COMM_CONTRIBUTION_OPEN_STATES
CONTRIBUTION_CLOSERS = ("machine", "person", "silence")
CONTRIBUTION_SILENT_CLOSES = SCD.COMM_CONTRIBUTION_SILENT_CLOSES
REPAIRS_HEADER = ("id", "createdAt", "updatedAt", "kind", "incident_id", "situation", "window_from", "window_to",
                  "what_was_wrong", "words_sha_then", "sender_then", "state", "priority", "audience", "declared_by",
                  "declared_at", "confirmed_by", "confirmed_at", "closed_at", "note", "intent_key", "person_key",
                  "person_name", "told_at", "told_channel", "claim_state", "claimed_at", "claim_path",
                  "claim_host_key", "attempt_id", "receipt", "test_claim_state", "test_claimed_at",
                  "undeliverable_why", "tenant")
REPAIR_STATES = ("candidate", "declared", "confirmed", "closed", "dismissed")
REPAIR_PURPOSE = "correction.owed"
REPAIR_NO_HOUSE = ("`comm_repairs` has no house yet. Mint it (the comm houses' own tool) before declaring an incident "
                   "— a tab invented in HUB_DB would be orphaned the day the pointer answers.")
# CommPolicy.gs
PRIORITY_ORDER = ("safety", "repair", "ask", "notice")
PRIORITY_FLOOR = {"safety": "", "repair": "correction.owed,correction_notice", "notice": "call_off_acknowledged"}
MAX_ATTEMPTS_FLOOR = 3
CONSENT_WINDOW_PREFIX = "CMW_"
CONSENT_WINDOW_KINDS = ("window", "anytime", "days")

_WS = L._JS_WS
# JavaScript's `.`: anything but a line terminator (U+2028 and U+2029 among them)
_DOT = "[^\\n\\r" + chr(0x2028) + chr(0x2029) + "]"


def t(v: Any) -> str:
    """String(v || '')."""
    return gsjs.or_text(v)


def low(v: Any) -> str:
    """String(v || '').trim().toLowerCase()."""
    return gsjs.trim(t(v)).lower()


def u16(s: str) -> int:
    """String.prototype.length."""
    return len(s.encode("utf-16-le", "surrogatepass")) // 2


def cut(s: str, n: int) -> str:
    """String.prototype.slice(0, n)."""
    return OO.js_cut(s, n)


def now_iso() -> str:
    """new Date().toISOString()."""
    return gsjs.iso(datetime.now(timezone.utc))


def ms(v: Any) -> float:
    """commCloseMs_: Date.parse of the cell, 0 for nothing and for NaN."""
    if isinstance(v, SheetDate):
        return v.at.timestamp() * 1000.0
    got = gsjs.date_parse(gsjs.trim(gsjs.or_blank(v)))
    return got or 0.0


def iso_of(at_ms: float) -> str:
    return gsjs.iso(datetime.fromtimestamp(at_ms / 1000.0, timezone.utc))


def record_id(key: str) -> str:
    """commRecordId_: the key's MD5, its first eight bytes in upper-case hex."""
    return hashlib.md5(key.encode("utf-8")).hexdigest()[:16].upper()


def json_text(v: Any) -> str:
    import writes as W  # noqa: PLC0415 - JSON.stringify as every door writes it
    return W.json_text(v)


# ---- the token, the address, the mask --------------------------------------------------------------------------------

TOKEN_RE = re.compile(r"\b([A-Z]{2}-[A-Z0-9]{6})\b", re.A)
TOKEN_SCAN_RE = re.compile(r"\bCI-[A-Z0-9]{6}\b", re.A)
QUOTE_RE = re.compile(r"^[" + _WS + r"]*(>|On[" + _WS + r"]" + _DOT + r"+[" + _WS + r"]wrote:|Em[" + _WS + r"]" + _DOT
                      + r"+[" + _WS + r"]escreveu:|-{2,}[" + _WS + r"]*Original Message|From:[" + _WS + r"]|De:["
                      + _WS + r"]|Sent:[" + _WS + r"]|\[TEST)", re.A | re.I)
_TEST_TOP = re.compile(r"^[" + _WS + r"]*\[TEST\b", re.A | re.I)


def reply_token(intent_key: Any) -> str:
    """commReplyToken_: the token this lane would put in a message for one intent."""
    return "CI-" + re.sub(r"[^A-Z0-9]", "", record_id(t(intent_key)))[:6]


def mail_address(v: Any) -> str:
    """commMailAddress_: the bare address out of whatever the header carried."""
    s = gsjs.trim(t(v))
    m = re.search(r"<([^>]+)>", s)
    if m:
        s = m.group(1)
    s = gsjs.trim(s.lower())
    return s if "@" in s else ""


def mask(v: Any) -> str:
    """commMask_: the last four characters, for a trail that names nobody's number."""
    s = t(v)
    return "•••" + s[-4:] if len(s) > 4 else s


def tokens(text: Any) -> list[str]:
    """commInboundTokens_: every reference in the body, distinct, in the order they appear."""
    out: list[str] = []
    for m in TOKEN_SCAN_RE.finditer(t(text).upper()):
        if m.group(0) not in out:
            out.append(m.group(0))
        if len(out) >= 8:
            break
    return out


def said_of(text: Any) -> str:
    """commInboundSaid_: what the person actually typed — everything above the quoted original."""
    kept = []
    for line in re.split(r"\r?\n", t(text)):
        if QUOTE_RE.search(line):
            break
        kept.append(line)
    return gsjs.trim("\n".join(kept))


def our_echo(text: Any) -> bool:
    """commInboundOurEcho_: our own message, read back."""
    top = said_of(text)
    if not top:
        return _TEST_TOP.search(t(text)) is not None
    return _TEST_TOP.search(top) is not None


# ---- what they said about being contacted ----------------------------------------------------------------------------

def intent_floor(text: Any) -> str:
    """commInboundIntentFloor_: the shipped brake, asked of the platform's own shipped words."""
    s = OO.intent_norm(text)
    if not s:
        return ""

    def has(shipped: str) -> bool:
        return s in [p for p in (gsjs.trim(x).lower() for x in re.split(r"[,;\n]+", shipped)) if p]
    if has(OO.OPT_OUT_PHRASES_SHIPPED):
        return "opt-out"
    if has(OO.OPT_IN_PHRASES_SHIPPED):
        return "opt-in"
    if has(OO.WRONG_NUMBER_PHRASES_SHIPPED):
        return "wrong-number"
    return "reply"


def inbound_intent(text: Any, cfg: dict | None) -> str:
    """commInboundIntent_: the platform's vocabulary (optOutIntent_) first, the shipped brake behind it."""
    try:
        heard = t(OO.opt_out_intent(text, cfg))
    except Exception:  # noqa: BLE001 - the shipped words answer alone
        heard = ""
    if heard and heard != "reply":
        return heard
    shipped = intent_floor(text)
    if shipped == "opt-out":
        return "opt-out"
    return heard or shipped


# ---- test mode, as the ear asks it -----------------------------------------------------------------------------------

def test_redirect(cfg: dict | None) -> dict[str, Any] | None:
    """hubTestRedirect_: None while test mode is off; on, nothing leaves, and the testers ride beside the lists."""
    try:
        if cfg is None:
            raise ValueError("the hiring alerts could not be read")
        st = SCD.test_mode_state(cfg)
        if st["unrecognized"]:
            raise ValueError(st["unrecognized"])
        if not st["on"]:
            return None
        return {"sms": [], "emails": [], "sheet": True, "testers_sms": st["sms"] or [],
                "testers_emails": st["emails"] or [], "shared": st["shared"] or []}
    except (hubdb.Unreadable, Defer):
        raise
    except Exception as exc:  # noqa: BLE001 - an unreadable switch holds everything (hubSwitchHeldRedirect_)
        return {"sms": [], "emails": [], "sheet": True, "unreadable": True,
                "why": "the send switch could not be read at hubTestRedirect_: " + str(exc)[:200],
                "testers_sms": [], "testers_emails": [], "shared": []}


def test_mode(cfg: dict | None) -> bool:
    """commTestMode_."""
    return bool(test_redirect(cfg))


def tester(cfg: dict | None, frm: Any, channel: Any) -> bool:
    """commInboundTester_: is this sender a tester?"""
    if not test_mode(cfg):
        return False
    redir = test_redirect(cfg)
    if not redir:
        return False
    s = low(frm)
    if not s:
        return False
    if "@" not in s or t(channel) == "sms":
        d = re.sub(r"\D", "", s)[-10:]
        if not d or len(d) < 10:
            return False
        return any(re.sub(r"\D", "", t(n))[-10:] == d for n in redir.get("sms") or [])
    addr = mail_address(s) or s
    return any(low(e) == addr for e in redir.get("emails") or [])


def dial(cfg: dict | None) -> str:
    """commDial_: record while test mode is on, send while off, off when the switch cannot be read."""
    if cfg is None:
        return "off"
    return SCD.dial(cfg)["word"]


# ---- who a person is -------------------------------------------------------------------------------------------------

def people_by_contact(reads: L.Reads) -> dict[str, dict[str, dict[str, str]]]:
    """commRecordPeopleByContact_: who a phone or an address belongs to — the People house, keyed both ways."""
    out: dict[str, dict[str, dict[str, str]]] = {"phone": {}, "email": {}}
    try:
        people = SP.without_isp_clients(reads, SP.people_merged(reads, SP._people(reads)))
        for p in people or []:
            k = gsjs.name_key((p or {}).get("name"))
            if not k:
                continue
            d = re.sub(r"\D", "", t(p.get("phone")))[-10:]
            if len(d) == 10 and d not in out["phone"]:
                out["phone"][d] = {"key": k, "name": t(p.get("name"))}
            e = low(p.get("email"))
            if e and e not in out["email"]:
                out["email"][e] = {"key": k, "name": t(p.get("name"))}
    except (hubdb.Unreadable, Defer):
        raise
    except Exception:  # noqa: BLE001 - nobody matched is a real answer, and it is observed
        pass
    return out


def inbound_person(m: dict, by: dict) -> dict | None:
    """commInboundPerson_: who wrote — the People house by phone or address."""
    if t(m.get("channel")) == "email":
        e = re.sub(r"^.*<([^>]+)>.*$", r"\1", gsjs.trim(t(m.get("from"))).lower())
        return by["email"].get(e)
    d = re.sub(r"\D", "", t(m.get("from")))[-10:]
    return by["phone"].get(d) if len(d) == 10 else None


def who_text(who: dict | None) -> str:
    """contactWhoText_ (ContactGuard.gs): what the caller ID did or did not name."""
    if not who:
        return ""
    if who.get("state") == "sole":
        return "Named from the caller ID: " + t(who.get("name")) + " — one person on the staff roster holds this line."
    if who.get("state") == "shared":
        names = [t((p or {}).get("name")) for p in who.get("people") or []]
        return ("Not named from the caller ID: " + str(len(names)) + " people on the staff roster hold this line ("
                + ", ".join(names[:3]) + (" and others" if len(names) > 3 else "") + "). A shared line names nobody.")
    return "Not named from the caller ID — " + t(who.get("why") or "the number is not on the staff roster") + "."


def matrix(reads: L.Reads) -> list[dict[str, str]]:
    """commRecordMatrix_: the obligations matrix, read by header name."""
    def pick(row: dict, name: str) -> str:
        return gsjs.trim(gsjs.or_blank(row.get(name)))
    out = []
    for row in SK._matrix(reads):
        r = {k: pick(row, k) for k in ("person_key", "person_name", "req_id", "state", "expires", "days_left")}
        if r["person_key"] and r["req_id"]:
            out.append(r)
    return out


def cert_labels(reads: L.Reads) -> dict[str, str]:
    """certLabels_ (Certs.gs): the catalogue's one door, config first and the shipped floor behind."""
    return reads.once("crp:labels", lambda: SCD.cert_labels(reads))


def max_attempts(reads: L.Reads) -> float:
    """commPolicy_('max_attempts')."""
    return SCD.digest_setting(reads, "comm_max_attempts", MAX_ATTEMPTS_FLOOR, 0, 9999)


def priority_for(reads: L.Reads, ident: str) -> str:
    """commPriorityFor_, walked in ladder order (commPriorityIds_ off the words book's comm_priority_<p> lists)."""
    want = gsjs.trim(t(ident)).lower()
    if not want:
        return "ask"
    for p in PRIORITY_ORDER:
        if p == "ask":
            continue
        floor = PRIORITY_FLOOR.get(p)
        if floor is None:
            continue
        raw = SCD.digest_word(reads, "comm_priority_" + p, floor)
        ids =[x for x in (gsjs.trim(s).lower() for s in re.split(r"[,;\n]", t(raw))) if x]
        if want in ids:
            return p
    return "ask"


# ---- the ladder: which thread an answer belongs to -------------------------------------------------------------------

def correlate(message: dict, open_list: list[dict]) -> dict[str, Any]:
    """commCorrelate_: the token, then the provider's thread, then exactly one open — or nothing."""
    text = t(message.get("text"))
    lst = [i for i in (open_list or []) if i and t(i.get("state")) not in ("answered", "stopped")]
    if not lst:
        return {"intent": None, "how": "none", "why": "nothing was open for this person"}
    m = TOKEN_RE.search(text.upper())
    if m:
        token = m.group(1)
        for i in lst:
            if reply_token(i.get("intent_key")) == token:
                return {"intent": i, "how": "token", "why": "the reply quoted " + token}
        return {"intent": None, "how": "unknown-token",
                "why": "the reply quoted " + token + ", which matches no open intent"}
    thread = t(message.get("thread_id"))
    if thread:
        by_thread = [i for i in lst if t(i.get("thread_id")) == thread]
        if len(by_thread) == 1:
            return {"intent": by_thread[0], "how": "thread", "why": "the provider threaded it"}
    if len(lst) == 1:
        return {"intent": lst[0], "how": "sole-open", "why": "exactly one intent was open for this person"}
    return {"intent": None, "how": "ambiguous",
            "why": str(len(lst)) + " intents are open for this person — which one this answers cannot be known, and "
                   "guessing would advance an obligation nobody answered"}


# ---- CommContribution.gs: what a reply claims ------------------------------------------------------------------------

AFFIRMATIVE = ("yes", "y", "yep", "yeah", "done", "sent", "ok", "okay", "sim", "feito", "enviei", "ja enviei",
               "já enviei")
NEGATIVE = ("no", "n", "not yet", "nope", "nao", "não", "ainda nao", "ainda não")


def _phrase_is(text: str, lst: tuple) -> bool:
    """commPhraseIs_: whole-message match only."""
    return re.sub(r"[.!]+$", "", gsjs.trim(text).lower()) in lst


def _named(text: str, bindings: list[dict], label_for: Callable[[str], str]) -> list[dict]:
    """commNamed_: whole-word match of an item's id or label."""
    tt = " " + re.sub(r"[^a-z0-9]+", " ", text.lower()) + " "
    hit = []
    for b in bindings or []:
        bid = t(b.get("req_id"))
        words = [bid]
        label = t(label_for(bid)) if label_for else ""
        if label:
            words.append(label)
        for w in words:
            clean = gsjs.trim(re.sub(r"[^a-z0-9]+", " ", gsjs.js_str(w).lower()))
            if clean and len(clean) >= 3 and (" " + clean + " ") in tt:
                hit.append(b)
                break
    return hit


def _open_bindings(intent: dict | None) -> list[dict]:
    return [b for b in ((intent or {}).get("bindings") or []) if t(b.get("binding_state") or "open") == "open"]


def contribution_of(text: Any, intent: dict | None, label_for: Callable[[str], str]) -> dict[str, Any]:
    """commContribution_: a reply claims only what it names; a bare yes counts only for a one-item message."""
    bindings = _open_bindings(intent)
    body = gsjs.trim(t(text))
    if not body:
        return {"kind": "unclear", "claims": [], "why": "an empty reply claims nothing"}
    if not bindings:
        return {"kind": "unclear", "claims": [], "why": "this intent has nothing open to claim against"}
    named = _named(body, bindings, label_for)
    affirmative = _phrase_is(body, AFFIRMATIVE)
    negative = _phrase_is(body, NEGATIVE)
    if named:
        if len(named) == len(bindings) and len(bindings) > 1 and not affirmative:
            return {"kind": "named", "claims": named, "why": "the reply names every open item"}
        return {"kind": "named", "claims": named,
                "why": "the reply names " + str(len(named)) + " of " + str(len(bindings)) + " open item(s)"}
    if negative:
        return {"kind": "declined", "claims": bindings if len(bindings) == 1 else [],
                "why": ("a plain no, to a message that asked about one thing" if len(bindings) == 1 else
                        "a plain no, to a message that asked about " + str(len(bindings))
                        + " — which one they mean is not knowable")}
    if affirmative:
        if len(bindings) == 1:
            return {"kind": "whole", "claims": bindings,
                    "why": "a bare yes, to a message that asked about exactly one thing"}
        return {"kind": "unclear", "claims": [],
                "why": "a bare \"" + body.lower() + "\" to a message carrying " + str(len(bindings))
                       + " items — the commonest one-word answer there is, and it names none of them"}
    return {"kind": "unclear", "claims": [], "why": "the reply says something this platform should not try to read"}


# ---- CommQualify.gs and CommDesk.gs ----------------------------------------------------------------------------------

def _qualify_one(claim: dict | None, current: dict | None) -> dict[str, Any]:
    """commQualifyOne_: the estate re-read now; a claim the record contradicts is a disagreement."""
    said = t((claim or {}).get("kind") or "unclear")
    now = t((current or {}).get("state"))
    if not now:
        return {"verdict": "unknown", "settle": False,
                "why": "the obligations matrix holds nothing for this item right now"}
    if now in ("ok", "na"):
        return {"verdict": "agrees", "settle": True,
                "why": "the estate holds it as " + now + " — the claim and the record agree"}
    if said == "declined":
        return {"verdict": "agrees", "settle": False, "why": "they said it is not done, and the record says the same"}
    return {"verdict": "disagrees", "settle": False,
            "why": "they said it is handled; the estate still reads " + now + " — worth a look, not a settlement"}


def qualify(intent: dict | None, contribution: dict, lookup: Callable[[str], dict]) -> dict[str, Any]:
    """commQualify_."""
    claims = (contribution or {}).get("claims") or []
    opened = _open_bindings(intent)
    claimed = {t(c.get("demand_id") or c.get("req_id")) for c in claims}
    results = []
    for b in claims:
        bid = t(b.get("demand_id") or b.get("req_id"))
        got = _qualify_one(contribution, lookup(bid) if lookup else None)
        results.append({"demand_id": bid, "req_id": t(b.get("req_id")), "claimed": t((contribution or {}).get("kind")),
                        "verdict": got["verdict"], "settle": got["settle"], "why": got["why"]})
    untouched = [t(b.get("demand_id") or b.get("req_id")) for b in opened
                 if t(b.get("demand_id") or b.get("req_id")) not in claimed]
    return {"results": results, "settled": sum(1 for r in results if r["settle"]),
            "disagreements": sum(1 for r in results if r["verdict"] == "disagrees"), "untouched": untouched,
            "all_answered": not untouched and bool(results)}


def desk_reason(reads: L.Reads, corr: dict | None, contribution: dict | None, qualified: dict | None,
                attempts: float) -> str:
    """commDeskReason_: asked in order of consequence; '' when the machine handled it."""
    if qualified and float(qualified.get("disagreements") or 0) > 0:
        return "disagreement"
    if corr and not corr.get("intent") and corr.get("how") in ("ambiguous", "unknown-token"):
        return "ambiguous"
    if contribution and t(contribution.get("kind")) == "unclear":
        return "unclear"
    cap = max_attempts(reads)
    if not math.isnan(cap) and float(attempts or 0) >= cap:
        return "exhausted"
    return ""


def contribution_open(row: dict | None) -> bool:
    """commContributionOpen_."""
    return t((row or {}).get("state")) in CONTRIBUTION_OPEN_STATES


def contribution_row(m: dict, who: dict | None, corr: dict | None, contribution: dict | None, state: str,
                     reason: str, now: str) -> dict[str, Any]:
    """commContributionRow_: one reply, as the row it becomes."""
    intent = (corr or {}).get("intent") or {}
    c = contribution or {}
    return {
        "id": "CMC_" + record_id(t(m.get("message_id"))),
        "intent_key": t(intent.get("intent_key")),
        "person_key": t((who or {}).get("key") or intent.get("person_key")),
        "person_name": t((who or {}).get("name") or intent.get("person_name")),
        "channel": t(m.get("channel")), "message_id": t(m.get("message_id")), "thread_id": t(m.get("thread_id")),
        "received_at": t(m.get("at") or now), "text": cut(t(m.get("text")), 2000),
        "correlation": t((corr or {}).get("how")), "kind": t(c.get("kind")),
        "claims": " · ".join(t(b.get("demand_id") or b.get("req_id")) for b in (c.get("claims") or [])),
        "why": t(c.get("why") or (corr or {}).get("why")),
        "settled_now": "", "awaiting": "", "state": t(state or "needs_human"), "reason": t(reason),
        "verdict": "", "verdict_by": "", "verdict_at": "", "note": "", "test_mode": "",
        "correction_kind": "", "repair_incident": "", "close": "", "closed_at": "", "escalated_at": ""}


def observation_row(otype: str, intent: dict | None, payload: dict | None, source: str, actor: str,
                    now: str) -> dict[str, str]:
    """commObservationRow_: one trail row, its payload as JSON.stringify writes it."""
    i = intent or {}
    try:
        body = json_text(payload or {})
    except Exception:  # noqa: BLE001
        body = "{}"
    if u16(body) > 2000:
        body = cut(body, 2000)
    return {"event_id": "cmo_" + record_id(t(otype) + "|" + t(i.get("intent_key")) + "|" + t(now) + "|"
                                           + cut(body, 80)),
            "type": t(otype), "actor": t(actor or ACTOR), "subject_type": "person",
            "subject_key": t(i.get("person_key")),
            "subject_name": t(i.get("person_name") or i.get("name")), "intent_key": t(i.get("intent_key")),
            "payload": body, "source": t(source or "sweep"), "at": t(now or now_iso()), "tenant": ""}


# ---- THE HEARING: a stated contact window ----------------------------------------------------------------------------

STATED_ANYTIME = ("anytime", "any time", "anytime is fine", "any time is fine", "anytime works", "any time works",
                  "anytime is good", "any time is good", "all day", "whenever", "whenever is fine", "whenever works",
                  "whenever you like", "whenever you want", "no preference", "doesnt matter", "does not matter",
                  "dont mind", "do not mind", "im flexible", "i am flexible", "flexible", "qualquer hora",
                  "qualquer horario", "a qualquer hora", "tanto faz", "nao importa", "quando quiser")
STATED_VAGUE = ("morning", "mornings", "afternoon", "afternoons", "evening", "evenings", "night", "nights",
                "nighttime", "daytime", "early", "late", "lunch", "lunchtime", "after work", "before work",
                "after my shift", "before my shift", "during my shift", "off hours", "business hours", "work hours",
                "manha", "de manha", "tarde", "de tarde", "noite", "a noite", "horario comercial")
STATED_CHANNEL_RE = re.compile(r"\b(e-?mails?|texts?|texting|sms|call|calls|phone|ligar|ligue|whats ?app|mensagem|"
                               r"mensagens)\b", re.A)
STATED_REFUSAL_RE = re.compile(r"\b(?:dont|do not|no|never|nao|nunca)\s+(?:me|us|nos|lhe|my|our)?\s*(?:text|txt|"
                               r"message|msg|e-?mail|call|contact|bother|reach|mande|manda|envie|ligue|ligar)\b", re.A)
STATED_RANGE_RE = re.compile(r"(\d{1,2})(?::(\d{2}))?\s*(am|pm|a|p|h)?(?![a-z0-9])\s*(?:-|to\b|until\b|till\b|thru\b|"
                             r"as\b|ate\b)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm|a|p|h)?(?![a-z0-9])", re.A)
STATED_AFTER_RE = re.compile(r"\b(?:after|from|starting|a partir d[ae]s?|apos|depois d[ae]s?|depois)\s+(\d{1,2})"
                             r"(?::(\d{2}))?\s*(am|pm|a|p|h)?(?![a-z0-9])", re.A)
STATED_BEFORE_RE = re.compile(r"\b(?:before|until|till|by|up to|no later than|antes d[ae]s?|antes|ate as|ate)\s+"
                              r"(\d{1,2})(?::(\d{2}))?\s*(am|pm|a|p|h)?(?![a-z0-9])", re.A)
STATED_MIN_MINUTES = 60
STATED_MAX_INFERRED_HOURS = 14
STATED_WEEKDAY_RE = re.compile(r"\b(not weekends?|no weekends?|except weekends?|weekdays?|week days|during the week|"
                               r"mon(?:day)?\s*(?:-|to|thru|through)?\s*fri(?:day)?|dias uteis|durante a semana|"
                               r"nao no fim de semana)\b", re.A)
STATED_WEEKEND_RE = re.compile(r"\b(weekends? only|only (?:on )?weekends?|sat(?:urday)?\s*(?:,|/|and|&|-)\s*"
                               r"sun(?:day)?|apenas (?:no )?fim de semana|so (?:no )?fim de semana|"
                               r"somente (?:no )?fim de semana)\b", re.A)
STATED_WEEKEND_WHOLE = ("weekend", "weekends", "on weekends", "on the weekend", "fim de semana", "fins de semana",
                        "fds")
_SIX_NEXT = "The six next shifts on this platform all start at 22:00"


def stated_claim(kind: str, frm: str, to: str, days: str, confident: bool, read_as: str, why: str) -> dict[str, Any]:
    """commStatedClaim_: one shape, so every reader of a window claim reads the same fields."""
    return {"kind": t(kind or "unclear"), "from": t(frm), "to": t(to), "days": t(days), "confident": bool(confident),
            "read_as": t(read_as), "why": t(why), "channel_named": False}


def clock_text(minutes: int) -> str:
    """commStatedClockText_: minutes since midnight → 'HH:MM'."""
    m = int(minutes) % 1440
    return f"{m // 60:02d}:{m % 60:02d}"


def stated_clock(hour: Any, minute: Any, marker: Any) -> dict[str, Any] | None:
    """commStatedClock_: one time off one token, and whether it says so for itself."""
    try:
        h, mi = int(hour), int(minute or 0)
    except (TypeError, ValueError):
        return None
    if mi > 59 or h > 24:
        return None
    mk = gsjs.trim(t(marker))
    if mk in ("a", "am"):
        if h < 1 or h > 12:
            return None
        return {"min": (h % 12) * 60 + mi, "explicit": True, "meridiem": True, "h12": h % 12}
    if mk in ("p", "pm"):
        if h < 1 or h > 12:
            return None
        return {"min": ((h % 12) + 12) * 60 + mi, "explicit": True, "meridiem": True, "h12": h % 12}
    if mk == "h" or h >= 13 or h == 0:
        if h > 23:
            return None
        return {"min": h * 60 + mi, "explicit": True, "meridiem": False, "h12": h % 12}
    return {"min": h * 60 + mi, "explicit": False, "meridiem": False, "h12": h % 12}


def stated_days(s: str) -> dict[str, str]:
    """commStatedDays_: the days somebody named, and the sentence with those words taken out."""
    tt = gsjs.trim(s)
    flat = gsjs.trim(re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]+", " ", tt)))
    days, hit = "", ""
    mw = STATED_WEEKDAY_RE.search(" " + tt + " ")
    if mw:
        days, hit = "mon-fri", mw.group(0)
    else:
        me = STATED_WEEKEND_RE.search(" " + tt + " ")
        if me:
            days, hit = "sat,sun", me.group(0)
        elif flat in STATED_WEEKEND_WHOLE:
            days, hit = "sat,sun", flat
    hit_flat = gsjs.trim(re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]+", " ", hit)))
    rest = (" " + flat + " ").replace(hit_flat, " ") if hit_flat else flat
    return {"days": days, "rest": gsjs.trim(re.sub(r"\s+", " ", rest)), "said": gsjs.trim(hit)}


def stated_normalise(text: Any) -> str:
    """commStatedNormalise_: the sentence flattened so one vocabulary can be asked of it."""
    s = cut(t(text), 300).lower()
    s = re.sub("[" + chr(0x2010) + "-" + chr(0x2015) + chr(0x2212) + "]", "-", s)
    s = re.sub("['‘’ʼ`]", "", s)
    for chars, to in (("àáâãä", "a"), ("éèêë", "e"), ("íìîï", "i"), ("óòôõö", "o"), ("úùûü", "u"), ("ç", "c")):
        s = re.sub("[" + chars + "]", to, s)
    s = re.sub(r"a[" + _WS + r"]*\.[" + _WS + r"]*m[" + _WS + r"]*\.?", "am", s)
    s = re.sub(r"p[" + _WS + r"]*\.[" + _WS + r"]*m[" + _WS + r"]*\.?", "pm", s)
    s = re.sub(r"\bo'?clock\b", "", s, flags=re.A)
    s = re.sub(r"\bhrs?\b", "h", s, flags=re.A)
    s = re.sub(r"\b(noon|midday|meio-?[" + _WS + r"]?dia)\b", "12pm", s, flags=re.A)
    s = re.sub(r"\b(midnight|meia-?[" + _WS + r"]?noite)\b", "12am", s, flags=re.A)
    for pat, to in ((r"\bnot before\b", "after"), (r"\bnao antes d[ae]s?\b", "after"), (r"\bnao antes\b", "after"),
                    (r"\bnot after\b", "before"), (r"\bnao depois d[ae]s?\b", "before"),
                    (r"\bnao depois\b", "before")):
        s = re.sub(pat, to, s, flags=re.A)
    return gsjs.trim(re.sub("[" + _WS + "]+", " ", s))


def stated_range(s: str) -> dict[str, Any]:
    """commStatedRange_: a two-ended range, or a refusal that says which rule refused it."""
    found = []
    for m in STATED_RANGE_RE.finditer(s):
        found.append(m)
        if len(found) >= 4:
            break
    if not found:
        return {"ok": False, "why": ""}
    if len(found) > 1:
        return {"ok": False, "why": "the reply holds " + str(len(found)) + " separate ranges, and one row can carry "
                                    "one window — which one governs is theirs to say, not ours"}
    m = found[0]
    whole = gsjs.trim(m.group(0))
    a = stated_clock(m.group(1), m.group(2), m.group(3))
    b = stated_clock(m.group(4), m.group(5), m.group(6))
    if not a or not b:
        return {"ok": False, "why": "\"" + whole + "\" is not a pair of clock times"}
    inferred = ""
    if not a["explicit"] and b["explicit"]:
        if b["meridiem"]:
            shared = stated_clock(m.group(1), m.group(2), m.group(6))
            if not shared or shared["min"] >= b["min"]:
                return {"ok": False, "why": "\"" + whole + "\" carries one marker and the ends do not ascend under it, "
                                            "so which half of the day each end belongs to is a guess"}
            a = shared
        else:
            a = stated_clock(m.group(1), m.group(2), "h")
            if not a:
                return {"ok": False, "why": "\"" + whole + "\" is not a pair of clock times"}
    elif a["explicit"] and not b["explicit"]:
        first, cand, alt = a["min"], b["min"], (b["min"] + 720) % 1440
        span_a, span_b = (cand - first + 1440) % 1440, (alt - first + 1440) % 1440
        pick = cand if 0 < span_a <= span_b else alt
        b = {"min": pick, "explicit": True, "meridiem": True, "h12": 0}
        inferred = "the end had no marker and a range runs forward from its start"
    elif not a["explicit"] and not b["explicit"]:
        return {"ok": False, "why": "\"" + whole + "\" carries no am/pm anywhere. The six next shifts on this platform "
                                    "all start at 22:00, so a bare range from somebody here is as likely to be the "
                                    "night half of the day as the day half — and there is no tie-break that is not a "
                                    "guess about their life"}
    span = (b["min"] - a["min"] + 1440) % 1440
    if span == 0:
        return {"ok": False, "why": "\"" + whole + "\" begins and ends at the same time"}
    if span < STATED_MIN_MINUTES:
        return {"ok": False, "why": "\"" + whole + "\" is " + str(span) + " minutes wide, and the planner compares "
                                    "whole hours — honouring it would mean widening it, which is the one direction a "
                                    "stated window must never be moved"}
    if inferred and span > STATED_MAX_INFERRED_HOURS * 60:
        return {"ok": False, "why": "\"" + whole + "\" only reads as a " + gsjs.num_str(gsjs.js_round(span / 60))
                                    + "-hour window, which means the end was read on the wrong half of the day"}
    return {"ok": True, "from": clock_text(a["min"]), "to": clock_text(b["min"]), "inferred": inferred,
            "read_as": clock_text(a["min"]) + " to " + clock_text(b["min"]) + (" (" + inferred + ")" if inferred
                                                                                 else "")}


def stated_minutes(hhmm: str) -> int:
    """commStatedMinutes_."""
    return int(hhmm[0:2]) * 60 + int(hhmm[3:5])


def stated_window_read(said: Any) -> dict[str, Any]:
    """commStatedWindowRead_: what a person said about their hours — a claim, or an honest refusal."""
    raw = gsjs.trim(t(said))
    if not raw:
        return stated_claim("unclear", "", "", "", False, "",
                            "nothing above the quoted original — they sent back our own letter and typed nothing")
    s = stated_normalise(raw)
    plain = gsjs.trim(re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]+", " ", s)))
    if STATED_REFUSAL_RE.search(plain):
        return stated_claim("unclear", "", "", "", False, "reads as a refusal",
                            "this reads as a refusal, and the platform's own stop words did not match it — so NOTHING "
                            "was suppressed and nothing was stored. A person decides whether they meant stop, or meant "
                            "\"not by text\", or were narrowing an hour")
    d = stated_days(s)
    rng = stated_range(s)
    claim = None
    if rng["ok"]:
        claim = stated_claim("window", rng["from"], rng["to"], d["days"], True,
                             rng["read_as"] + (" on " + d["days"] if d["days"] else ""),
                             "an explicit range" + (" — " + rng["inferred"] if rng["inferred"] else "")
                             + (", and they named the days" if d["days"] else ""))
    elif rng["why"]:
        return stated_claim("unclear", "", "", "", False, "a range this reader will not guess at", rng["why"])
    if not claim:
        af = STATED_AFTER_RE.search(s)
        bf = STATED_BEFORE_RE.search(s)
        bare = af.group(0) if (af and not af.group(3) and int(af.group(1)) < 13) else \
            (bf.group(0) if (bf and not bf.group(3) and int(bf.group(1)) < 13) else "")
        if bare:
            hour = af.group(1) if (af and not af.group(3)) else bf.group(1)
            return stated_claim("unclear", "", "", d["days"], False, "an hour with no am or pm",
                                "\"" + gsjs.trim(bare) + "\" names one edge and no half of the day. " + _SIX_NEXT
                                + ", so \"" + hour + "\" here is as likely to be the evening as the morning — and with "
                                "no second end to read it against there is nothing to break the tie but a guess about "
                                "their life")
        frm = to = ""
        if af:
            ca = stated_clock(af.group(1), af.group(2), af.group(3))
            if ca and ca["explicit"]:
                frm = clock_text(ca["min"])
        if bf:
            cb = stated_clock(bf.group(1), bf.group(2), bf.group(3))
            if cb and cb["explicit"]:
                to = clock_text(cb["min"])
        if frm and to:
            sp = (stated_minutes(to) - stated_minutes(frm) + 1440) % 1440
            if sp < STATED_MIN_MINUTES:
                return stated_claim("unclear", "", "", "", False, "a window narrower than an hour",
                                    "they named both edges and they are " + str(sp) + " minutes apart; the planner "
                                    "compares whole hours and widening somebody's stated window is the one direction "
                                    "it must never move")
        if frm or to:
            claim = stated_claim("window", frm, to, d["days"], True,
                                 ("from " + frm if frm else "any time") + (" until " + to if to else " onwards")
                                 + (" on " + d["days"] if d["days"] else ""),
                                 "they stated " + ("both edges" if frm and to else "one edge")
                                 + ("" if frm and to else " — the other is left EMPTY on purpose, because they said "
                                    "nothing about it and the platform's own hours still decide it")
                                 + (", and they named the days" if d["days"] else ""))
    if not claim and d["days"] and (not d["rest"] or len(d["rest"]) <= 4):
        claim = stated_claim("days", "", "", d["days"], True, d["days"],
                             "they restricted the days and said nothing about hours — so the hours are left to the "
                             "platform, which is exactly as much as they told us")
    if not claim:
        bare = gsjs.trim(re.sub(r"\s+", " ", re.sub(r"[^a-z ]+", " ", d["rest"] or plain)))
        if bare in STATED_ANYTIME:
            claim = stated_claim("anytime", "", "", d["days"], True,
                                 "any time is fine" + (" on " + d["days"] if d["days"] else ""),
                                 "they told us they have no restriction. It narrows nothing — being easy-going is not "
                                 "a request to be texted at three in the morning — and the platform's own hours still "
                                 "stand. What it does end is the asking")
    if not claim:
        vague = next((v for v in STATED_VAGUE if (" " + v + " ") in (" " + plain + " ")), "")
        if vague:
            claim = stated_claim("unclear", "", "", d["days"], False, "\"" + vague + "\"",
                                 "\"" + vague + "\" is an answer but it is not an hour — it is one time to one person "
                                 "and another to the next, and a clock invented for them would be ours, not theirs")
    if not claim:
        claim = stated_claim("unclear", "", "", d["days"], False, "",
                             "nothing in this reply reads as a clock time with enough certainty to store on somebody's "
                             "row")
    claim["channel_named"] = STATED_CHANNEL_RE.search(plain) is not None
    return claim


def is_window_thread(intent: dict | None) -> bool:
    """commStatedIsWindowThread_: is this thread the window question?"""
    if not intent:
        return False
    want = WINDOW_ASK_PURPOSE
    p = gsjs.trim(t(intent.get("purpose"))).lower()
    if p:
        return p == want
    key = gsjs.trim(t(intent.get("intent_key"))).lower()
    return len(key) > len(want) and key[-(len(want) + 1):] == "|" + want


# ---- THE THIRD WAY IN: a correction ----------------------------------------------------------------------------------

CORRECTION_KINDS = ("identity", "sender", "ask")
CORRECTION_IDENTITY_RE = re.compile(
    r"\b(thats not my name|that is not my name|not my name|wrong name|wrong person|you have the wrong person|"
    r"got the wrong person|i(?: a)?m not (?!sure|certain|able|going|free|available|home|working|doing|really|very|too|"
    r"interested|comfortable|happy|ready|at |in |on |the |a )[a-z]{2,}|i dont work (there|here|for)|i no longer work|"
    r"i dont work at|i left (the company|there)|i never worked|nao trabalho mais|nunca trabalhei|"
    r"nao sou (eu|essa|esse)|nao e o meu nome|nao e meu nome|nome errado|pessoa errada)\b", re.A)
CORRECTION_SENDER_RE = re.compile(
    r"\b(who is this|whos this|who are you|who sent this|what company (is )?(this|that)|which company|"
    r"what is this company|i dont know (this|who|what) |never heard of|is this a scam|this is a scam|"
    r"quem e (voce|isso|essa|voces)|que empresa|qual empresa|nao conheco (essa|esta) empresa)\b", re.A)
CORRECTION_ASK_RE = re.compile(
    r"\b(you already have|already have (my|it|this)|i already sent|i sent (it|that|those|them|this)|"
    r"i sent (it )?(last|on|yesterday)|already sent (it|this|that)|ja enviei|ja mandei|voces ja tem|voce ja tem|"
    r"ja esta (com voces|enviado))\b", re.A)
CORRECTION_WHAT = {
    "identity": "we addressed the wrong person, or addressed them by a name or an employer that is not theirs",
    "sender": "we reached them under a sender they do not recognise",
    "ask": "we asked them for something they say we already have"}


def correction_read(said: Any) -> dict[str, Any]:
    """commCorrectionRead_: what did this reply tell us we got wrong?"""
    out: dict[str, Any] = {"kind": "", "also_ask": False, "read_as": "", "why": ""}
    raw = gsjs.trim(t(said))
    if not raw:
        return out
    s = stated_normalise(raw)
    plain = " " + gsjs.trim(re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]+", " ", s))) + " "
    ask = CORRECTION_ASK_RE.search(plain) is not None
    ident = CORRECTION_IDENTITY_RE.search(plain)
    sender = None if ident else CORRECTION_SENDER_RE.search(plain)
    if ident:
        out["kind"], out["read_as"] = "identity", gsjs.trim(ident.group(0))
    elif sender:
        out["kind"], out["read_as"] = "sender", gsjs.trim(sender.group(0))
    elif ask:
        out["kind"], out["read_as"] = "ask", "they say we already have it"
    if not out["kind"]:
        return out
    out["also_ask"] = ask and out["kind"] != "ask"
    out["why"] = (CORRECTION_WHAT[out["kind"]] + " — they wrote \"" + out["read_as"] + "\""
                  + (", and in the same breath a claim about something we asked them for" if out["also_ask"] else ""))
    return out


# ---- THE CLOSE: an acknowledgement and nothing else ------------------------------------------------------------------

ACK_WORDS = ("ok", "okay", "ok ok", "k", "kk", "okey", "okie", "ok thanks", "okay thanks", "ok thank you",
             "okay thank you", "ok thx", "thanks ok", "thanks", "thank you", "thanks a lot", "many thanks", "thx", "ty",
             "cheers", "no worries", "no worry", "no problem", "no prob", "np", "all good", "its all good", "got it",
             "understood", "noted", "sounds good", "fine", "thats fine", "thats ok", "thats okay", "alright",
             "all right", "great", "perfect", "appreciate it", "thanks for letting me know",
             "thank you for letting me know", "ok got it", "obrigado", "obrigada", "ok obrigado", "ok obrigada",
             "valeu", "tudo bem", "tudo bom", "sem problema", "sem problemas", "entendi", "ok entendi", "beleza",
             "ta bom", "ta certo", "esta bem", "tranquilo", "certo", "ok certo", "de nada")
# thumbs up, OK hand, folded hands, white check, slight smile, smiling eyes
ACK_EMOJI_OK = tuple(chr(c) for c in (0x1F44D, 0x1F44C, 0x1F64F, 0x2705, 0x1F642, 0x1F60A))
# everything past the basic plane, plus the arrows, symbols and the joiners that travel with them
ACK_EMOJI_ANY_RE = re.compile("[" + chr(0x10000) + "-" + chr(0x10FFFF) + "]|[" + chr(0x2190) + "-" + chr(0x27BF)
                              + chr(0xFE0F) + chr(0x200D) + "]")
ACK_QUESTION_RE = re.compile(
    r"\b(do|does|did|can|could|should|shall|will|would|is|are|was|were|am|have|has|who|what|when|where|why|how|which|"
    r"whose|still|need|needs|needed|send|sending|quando|como|quem|qual|quais|porque|por que|preciso|precisa|posso|"
    r"pode|podem|ainda|entao|devo|tenho que|mando|envio)\b", re.A)
ACK_HEDGE_RE = re.compile(r"\b(but|however|though|although|except|unless|anyway|actually|mas|porem|so que|todavia|"
                          r"contudo|apesar)\b", re.A)
ACK_NEGATION_RE = re.compile(r"\b(not|dont|doesnt|didnt|cant|wont|never|nunca)\b", re.A)
ACK_MAX_WORDS = 6
ACK_MAX_CHARS = 120


def ack_read(said: Any) -> dict[str, Any]:
    """commAckRead_: is this reply an acknowledgement and nothing else?"""
    out: dict[str, Any] = {"ack": False, "read_as": "", "why": ""}
    raw = gsjs.trim(t(said))
    if not raw:
        out["why"] = "they typed nothing above the quoted original, which is not an answer to anything"
        return out
    if u16(raw) > ACK_MAX_CHARS:
        out["why"] = "it runs to " + str(u16(raw)) + " characters — nobody writes that much to say \"ok\""
        return out
    if "?" in raw or "¿" in raw:
        out["why"] = ("there is a question mark in it, and a question closed as an acknowledgement is a question lost "
                      "for ever")
        return out
    s = stated_normalise(raw)
    plain = gsjs.trim(re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]+", " ", ACK_EMOJI_ANY_RE.sub(" ", s))))
    if not plain:
        if any(e in raw for e in ACK_EMOJI_OK) and u16(raw) <= 12:
            out.update(ack=True, read_as="an emoji and nothing else",
                       why="the whole reply is an emoji this platform reads as assent")
            return out
        out["why"] = "nothing here but punctuation, or an emoji this reader will not translate"
        return out
    if re.search(r"[0-9]", plain):
        out["why"] = "there is a number in it, and a number is information rather than assent"
        return out
    if ACK_QUESTION_RE.search(" " + plain + " "):
        out["why"] = "it carries a word a question is built from, with or without the mark"
        return out
    if ACK_HEDGE_RE.search(" " + plain + " "):
        out["why"] = ("a friendly word and then a turn — the commonest shape there is, and the thing after the turn is "
                      "what they wrote to say")
        return out
    if plain in ACK_WORDS:
        out.update(ack=True, read_as=plain, why="the whole message is assent and nothing else")
        return out
    if ACK_NEGATION_RE.search(" " + plain + " "):
        out["why"] = "a negation in a short reply turns it around, and which way is not this reader's to decide"
        return out
    words = len([w for w in plain.split(" ") if w])
    if words > ACK_MAX_WORDS:
        out["why"] = (str(words) + " words — long enough to be saying something, and this reader only closes a reply "
                      "that is wholly assent")
        return out
    out["why"] = ("\"" + plain + "\" is short and it may well be friendly, but it is not one of the acknowledgements "
                  "this reader knows, and guessing costs somebody their question")
    return out


# ---- the corrections already said (CommRepair.gs' ledger, as the ear reads it) ---------------------------------------

def _incidents(rows: list[dict]) -> dict[str, dict]:
    out: dict[str, dict] = {}
    for r in rows:
        if t(r.get("kind")) == "incident":
            out[t(r.get("incident_id"))] = r
    return out


def repairs_for(person_key: Any, rows: list[dict]) -> list[dict[str, str]]:
    """commInboundRepairsFor_: the corrections already said to this person, newest last."""
    key = low(person_key)
    if not key:
        return []
    incidents = _incidents(rows)
    out = []
    for r in rows:
        if t(r.get("kind")) != "person" or low(r.get("person_key")) != key:
            continue
        state = t(r.get("claim_state") or "planned")
        if state not in ("repaired", "claimed"):
            continue
        inc = incidents.get(t(r.get("incident_id"))) or {}
        out.append({"id": t(r.get("id")), "incident_id": t(r.get("incident_id")), "intent_key": t(r.get("intent_key")),
                    "person_key": key, "person_name": t(r.get("person_name")), "claim_state": state,
                    "told_at": t(r.get("told_at")), "told_channel": t(r.get("told_channel")),
                    "incident_state": t(inc.get("state")), "what_was_wrong": t(inc.get("what_was_wrong"))})
    out.sort(key=functools.cmp_to_key(lambda a, b: gsjs.locale_cmp(a["told_at"], b["told_at"])))
    return out


def repair_thread(token: Any, person_key: Any, rows: list[dict]) -> dict[str, str] | None:
    """commInboundRepairThread_: the correction a reference names — rung one of the ladder, over the ledger."""
    want = t(token).upper()
    if not want:
        return None
    key = low(person_key)
    incidents = _incidents(rows)
    hit = [r for r in rows if t(r.get("kind")) == "person" and t(r.get("intent_key"))
           and reply_token(t(r.get("intent_key"))) == want and (not key or low(r.get("person_key")) == key)]
    if len(hit) != 1:
        return None
    row = hit[0]
    inc = incidents.get(t(row.get("incident_id"))) or {}
    return {"id": t(row.get("id")), "incident_id": t(row.get("incident_id")), "intent_key": t(row.get("intent_key")),
            "person_key": low(row.get("person_key")), "person_name": t(row.get("person_name")),
            "claim_state": t(row.get("claim_state") or "planned"), "told_at": t(row.get("told_at")),
            "told_channel": t(row.get("told_channel")), "incident_state": t(inc.get("state")),
            "what_was_wrong": t(inc.get("what_was_wrong"))}


def repair_incident_id(situation: str, frm: str, to: str, what: str) -> str:
    """commRepairIncidentId_: what was wrong, where, and when."""
    return "RPI" + record_id("|".join((t(situation), t(frm), t(to), t(what))))[:12]


def correction_incident_id(person_key: Any, kind: str) -> str:
    """commCorrectionIncidentId_: one incident per person per kind."""
    return repair_incident_id("self." + t(kind), low(person_key), "", "reported by the person")


def repair_incident_row(reads: L.Reads, incident: dict, now: str) -> dict[str, Any]:
    """commRepairIncidentRow_: one incident, as the row it becomes."""
    iid = t(incident.get("incident_id"))
    state = t(incident.get("state"))
    try:
        audience = float(incident.get("audience") or 0)
    except (TypeError, ValueError):
        audience = 0.0
    return {"id": "RPI_" + record_id(iid), "kind": "incident", "incident_id": iid,
            "situation": t(incident.get("situation")), "window_from": t(incident.get("window_from")),
            "window_to": t(incident.get("window_to")), "what_was_wrong": cut(t(incident.get("what_was_wrong")), 500),
            "words_sha_then": t(incident.get("words_sha_then")), "sender_then": t(incident.get("sender_then")),
            "state": state if state in REPAIR_STATES else "candidate", "priority": priority_for(reads, REPAIR_PURPOSE),
            "audience": int(audience) if audience == int(audience) else audience,
            "declared_by": t(incident.get("declared_by")), "declared_at": t(incident.get("declared_at") or now),
            "note": cut(t(incident.get("note")), 500)}


def repair_person_row(incident_id: str, person: dict, now: str) -> dict[str, Any]:
    """commRepairPersonRow_: one person inside an incident, as the row it becomes."""
    key = low(person.get("person_key"))
    return {"id": "RPP_" + record_id(t(incident_id) + "|" + key), "kind": "person", "incident_id": t(incident_id),
            "intent_key": key + "|repair." + t(incident_id), "person_key": key,
            "person_name": t(person.get("person_name")), "told_at": t(person.get("at")),
            "told_channel": t(person.get("channel")), "claim_state": "planned", "createdAt": t(now)}


# ---- CommConsent.gs: the stated window's store -----------------------------------------------------------------------

def window_clock(v: Any) -> str:
    """commConsentWindowClock_."""
    s = gsjs.trim(t(v))
    m = re.fullmatch(r"(\d{1,2}):(\d{2})", s, flags=re.A)
    if not m:
        return ""
    h, mi = int(m.group(1)), int(m.group(2))
    if h > 23 or mi > 59:
        return ""
    return f"{h:02d}:{mi:02d}"


def window_row(person_key: Any, person_name: Any, claim: dict, said: Any, source: str, message_id: str,
               now: str) -> dict[str, str]:
    """commConsentWindowRow_: its own row, never written over one of the seeded grants."""
    key = low(person_key)
    c = claim or {}
    return {"id": CONSENT_WINDOW_PREFIX + record_id(key + "|window"), "entity_name": t(person_name),
            "entity_type": "employee", "person_key": key, "channel_type": "", "purpose": WINDOW_ASK_PURPOSE,
            "status": "window_stated", "source": t(source), "window_state": "stated", "window_kind": t(c.get("kind")),
            "window_from": window_clock(c.get("from")), "window_to": window_clock(c.get("to")),
            "window_days": t(c.get("days")), "window_said_at": t(now), "window_source": t(source),
            "window_words": cut(t(said), 500), "window_read_as": t(c.get("read_as")),
            "window_message": t(message_id), "window_superseded_at": "", "window_superseded_by": ""}


def window_live(rows: list[dict]) -> dict[str, Any] | None:
    """commConsentWindowLive_: newest window_said_at wins."""
    best, best_at = None, ""
    for r in rows or []:
        if low(r.get("window_state")) == "superseded":
            continue
        kind = low(r.get("window_kind"))
        frm, to = window_clock(r.get("window_from")), window_clock(r.get("window_to"))
        days = gsjs.trim(t(r.get("window_days")))
        if not kind and not frm and not to and not days:
            continue
        at = t(r.get("window_said_at") or r.get("updatedAt"))
        if best is None or at > best_at:
            best, best_at = r, at
    if best is None:
        return None
    return {"kind": t(best.get("window_kind") or "window"), "from": window_clock(best.get("window_from")),
            "to": window_clock(best.get("window_to")), "days": t(best.get("window_days")),
            "said_at": t(best.get("window_said_at")), "source": t(best.get("window_source") or best.get("source")),
            "words": t(best.get("window_words")), "read_as": t(best.get("window_read_as")), "stated": True,
            "row_id": t(best.get("id"))}


# ---- the stamps (Script Properties) ----------------------------------------------------------------------------------

def stamps(reads: L.Reads) -> dict[str, str]:
    """comm_mail_last_run and comm_close_last_run, from app.comm_replies_state (the write's own cursor inside one)."""
    try:
        got = RR._q(reads, f"select key, value from {STATE}")
    except Exception as exc:  # noqa: BLE001 - a missing table is said, never read as "never ran"
        raise Defer(f"{STATE} could not be read ({type(exc).__name__}): apply db/comm_replies.sql") from exc
    return {gsjs.or_blank(k): gsjs.or_blank(v) for k, v in got}


def stamp_ms(st: dict[str, str], key: str) -> float:
    """Number(props.getProperty(key) || 0) || 0."""
    try:
        n = float(gsjs.trim(st.get(key) or "") or 0)
    except ValueError:
        return 0.0
    return 0.0 if math.isnan(n) else n


def window_open(st: dict[str, str], key: str, gap_s: float, now: float) -> bool:
    """commMailDue_ / commCloseSweepMaybe_'s question, before the stamp."""
    last = stamp_ms(st, key)
    return not (last and (now - last) / 1000.0 < gap_s)


def owned(reads: L.Reads) -> None:
    """The ear writes the opt-out list (a STOP, a START, a wrong number): only once it lives in Postgres."""
    if not (RR.uploaded(reads.db, OO.OPT_OUT_RESOURCE) and RR.uploaded(reads.db, OO.INBOUND_RESOURCE)):
        raise Defer("the opt-out list is not in Postgres yet; the ear waits until the opt-outs are uploaded")


def is_machine_or_admin(user: dict | None) -> bool:
    u = user or {}
    return bool(u.get("is_service")) or gsjs.js_str(u.get("role")) == "admin"


def forced(p: dict) -> bool:
    return p.get("force") is True or t(p.get("force")) == "true"


# ---- the look --------------------------------------------------------------------------------------------------------

def replies_due(sess: L.Session, payload: dict) -> dict[str, Any]:
    """commRepliesDue, the relay's look before commRepliesKeep (commRepliesSweep's reading half): the window
    (commMailDue_ asked, not stamped), the dial, and the inbox read over IMAP (the first box, read-only, the newest
    COMM_MAIL_READ), each thread from nobody we know and no tester counted and left out. The keep stamps, closes and
    captures."""
    if not is_machine_or_admin(sess.user):
        return dict(DENIED)
    p = payload if isinstance(payload, dict) else {}
    reads = sess.reads
    owned(reads)
    force = forced(p)
    st = stamps(reads)
    now = datetime.now(timezone.utc).timestamp() * 1000.0
    if not force and not window_open(st, MAIL_SWEEP_KEY, MAIL_SWEEP_GAP_S, now):
        return {"status": 200, "data": {"skipped": True, "why": "inside the fifteen-minute window"}}
    cfg = reads.config()
    data: dict[str, Any] = {"force": force, "dial": dial(cfg), "read": 0, "not_a_person": 0, "threads": []}
    if data["dial"] == "off":
        return {"status": 200, "data": data}
    box = MB.creds(None)
    if box is None:
        data["inbox"] = {"status": 502, "message": "PLATFORM_EMAIL is not configured"}
        return {"status": 200, "data": data}
    try:
        got = MB.inbox(box["user"], box["password"], MAIL_READ)
    except Exception as exc:  # noqa: BLE001 - the class, never the conversation (the relay's /mail/inbox said it so)
        data["inbox"] = {"status": 502, "message": f"imap_failed ({type(exc).__name__})"}
        return {"status": 200, "data": data}
    data["inbox"] = {"status": 200}
    threads = got.get("threads") or []
    data["read"] = len(threads)
    by = people_by_contact(reads)
    for th in threads:
        th = th or {}
        mid = t(th.get("id"))
        frm = mail_address(th.get("from_addr") or th.get("from_name"))
        if not mid or not frm:
            continue
        if not by["email"].get(frm) and not tester(cfg, frm, "email"):
            data["not_a_person"] += 1
            continue
        data["threads"].append({"id": mid, "from": frm, "to": t(th.get("to")), "snippet": t(th.get("snippet")),
                                "date": t(th.get("date"))})
    return {"status": 200, "data": data}


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {"commRepliesDue": replies_due}
# HUB_POLICY.commRepliesSweep: admins, and the relay's own identity
POLICY: dict[str, dict[str, Any]] = {"commRepliesDue": {"roles": ("admin",)}}
