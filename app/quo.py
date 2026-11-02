"""The relay's Quo inbox on Python (Quo.gs): what one verified provider event files — a call's transcript into
quo_transcripts, its summary into quo_summaries, a text into quo_messages — each record shaped from the event alone as
quoHandleTranscript_, quoHandleSummary_ and quoHandleMessage_ shape it, the lines a transcript's turns name read off the
Line Directory's stored list (hubLineStored_). The filing is app/quo_writes.py's (quoIngestBatch): the rows app.edits
records of the three books others read, an incoming text heard by the mailbox ear's own capture
(app/comm_replies_writes.py) and its consent word kept on the opt-out list (app/opt_outs_writes.py)."""
from __future__ import annotations

import math
import re
from typing import Any, Callable

import comm_routes_writes as CRW
import gsjs
import line_directory as LD
import locations as L
import opt_outs as OO
import smart_comms as SC
import smart_comms_writes as SW

APP_ID = "quo"
TRANSCRIPTS_TAB = "quo_transcripts"
MESSAGES_TAB = "quo_messages"
SUMMARIES_TAB = "quo_summaries"
# QUO_BATCH_MAX and QUO_BATCH_SEEN_ROWS; quoMessageSeen_ reads this many rows back from the last
BATCH_MAX = 25
BATCH_SEEN_ROWS = 2000
SEEN_TAIL_ROWS = 400
TEXT_MAX = 45000
BODY_MAX = 20000
# PasswordReset.gs RESET_TEXT_SECRET_RE
_RESET_SECRET = re.compile(r"(temporary password is[" + L._JS_WS + r"]+)[A-Za-z0-9]{6,64}", re.I)

s_ = gsjs.str_


def either(*vals: Any) -> Any:
    """a || b || …."""
    for v in vals:
        if not gsjs.falsy(v):
            return v
    return vals[-1] if vals else None


def number(v: Any) -> float:
    """Number(v)."""
    return 0.0 if v is None else CRW._number(v)


def js_join(items: list, sep: str) -> str:
    """Array.prototype.join: null and undefined as empty text."""
    return sep.join("" if x is None else gsjs.js_str(x) for x in items)


def obj_of(body: Any) -> dict[str, Any]:
    """`body.data || {}`, then its `object || data`: the provider's record inside the event."""
    b = body if isinstance(body, dict) else {}
    d = b.get("data") if not gsjs.falsy(b.get("data")) else {}
    obj = d.get("object") if isinstance(d, dict) and not gsjs.falsy(d.get("object")) else d
    return obj if isinstance(obj, dict) else {}


def is_transcript_type(t: Any) -> bool:
    """quoIsTranscriptType_."""
    return gsjs.or_text(t) in ("call.transcript.completed", "callTranscript")


def is_summary_type(t: Any) -> bool:
    """quoIsSummaryType_."""
    return gsjs.or_text(t) in ("call.summary.completed", "callSummary")


def is_history(source: Any) -> bool:
    """quoIsHistory_: history the relay recovered after the fact — filed, never heard."""
    return gsjs.or_text(source) == "relay:backfill"


def is_message_type(t: Any) -> bool:
    """quoIsMessageType_."""
    s = gsjs.or_text(t).lower()
    return bool(s) and ("message" in s or "sms" in s)


def names(v: Any) -> str:
    """quoNames_: a list of people or numbers as one line, each by its name, number or id."""
    if gsjs.falsy(v):
        return ""
    if not isinstance(v, list):
        return s_(v)
    out = []
    for x in v:
        if isinstance(x, dict):
            one = s_(either(x.get("name"), x.get("number"), x.get("phoneNumber"), x.get("email"), x.get("id")))
        elif isinstance(x, list):
            one = ""
        else:
            one = s_(x)
        if one:
            out.append(one)
    return ", ".join(out)


def turn_stamp(start: Any) -> str:
    """quoTurnStamp_: m:ss from a turn's start in seconds."""
    n = number(start)
    sec = int(gsjs.js_round(n)) if math.isfinite(n) else 0
    if not sec > 0:
        sec = 0
    return f"{sec // 60}:{sec % 60:02d}"


def _turns(dialogue: Any) -> list[dict[str, Any]]:
    """`dialogue && dialogue.length ? dialogue : []`, each turn `turn || {}`; a turn that is not a record says
    nothing."""
    if not isinstance(dialogue, list):
        return []
    return [t if isinstance(t, dict) else {} for t in dialogue]


def transcript_text(dialogue: Any) -> dict[str, Any]:
    """quoTranscriptText_: the words alone, and "[m:ss] who: said" lines, the one shape every reader parses."""
    plain: list[str] = []
    spoken: list[str] = []
    for turn in _turns(dialogue):
        said = gsjs.trim(gsjs.or_text(either(turn.get("content"), turn.get("text"), "")))
        if not said:
            continue
        plain.append(said)
        who = gsjs.js_str(either(turn.get("identifier"), turn.get("userId"), turn.get("participant"), "speaker"))
        spoken.append("[" + turn_stamp(turn.get("start")) + "] " + who + ": " + said)
    return {"plain": " ".join(plain), "spoken": "\n".join(spoken), "turns": len(plain)}


def numbers_from_turns(reads: L.Reads, dialogue: Any) -> dict[str, str]:
    """quoNumbersFromTurns_: the speakers' numbers, ours (the Line Directory's lines) apart from everybody else's."""
    lines: dict[str, bool] = {}
    others: dict[str, bool] = {}
    try:
        stored = LD.stored(reads)
    except Exception:  # noqa: BLE001 - hubLineStored_'s catch: no directory
        stored = None
    known: set[str] = set()
    for line in (stored or {}).get("lines") or []:
        digits = re.sub(r"\D", "", gsjs.or_text((line or {}).get("number") if isinstance(line, dict) else None))
        if digits:
            known.add(digits[-10:])
    for turn in _turns(dialogue):
        who = gsjs.js_str(either(turn.get("identifier"), turn.get("userId"), turn.get("participant"), ""))
        d = re.sub(r"\D", "", who)
        if len(d) < 10:
            continue
        ten = d[-10:]
        (lines if ten in known else others)["+1" + ten] = True
    return {"lines": ", ".join(lines), "others": ", ".join(others)}


def reset_scrub(text: Any) -> str:
    """resetTextScrub_: a copy of a text the platform keeps carries the words, never a temporary password."""
    return _RESET_SECRET.sub(lambda m: m.group(1) + SC.WITHHELD_WORDS, "" if text is None else gsjs.js_str(text))


def _joined(v: Any, sep: str) -> str:
    """`v && v.join ? v.join(sep) : str_(v)`."""
    return js_join(v, sep) if isinstance(v, list) else s_(v)


def _duration(v: Any) -> Any:
    """`Number(v || 0) || ''`."""
    n = number(v if not gsjs.falsy(v) else 0)
    return n if n and n == n else ""


def transcript_record(reads: L.Reads, body: dict, source: str, now_iso: str) -> tuple[dict[str, Any], int]:
    """quoHandleTranscript_'s record (the columns of the imported history), and how many turns spoke."""
    obj = obj_of(body)
    t = transcript_text(obj.get("dialogue"))
    from_turns = numbers_from_turns(reads, obj.get("dialogue"))
    users = names(either(obj.get("users"), obj.get("teamMembers")))
    record = {
        "call_id": s_(either(obj.get("callId"), obj.get("id"))),
        "event_id": s_(body.get("id")),
        "event_type": s_(body.get("type")),
        "transcript_created": s_(obj.get("createdAt")),
        "event_at": s_(either(body.get("createdAt"), obj.get("createdAt"))),
        "duration_s": _duration(obj.get("duration")),
        "quo_number": s_(obj.get("phoneNumberId")),
        "direction": s_(obj.get("direction")),
        "turns": t["turns"],
        "full_transcript": SW.js_slice(t["plain"], TEXT_MAX),
        "speaker_transcript": SW.js_slice(t["spoken"], TEXT_MAX),
        "status": s_(obj.get("status")),
        "participants": names(obj.get("participants")) or from_turns["others"],
        "team_members": from_turns["lines"] or (users if re.search(r"\d{10}", users) else ""),
        "contact_ids": names(obj.get("contactIds")),
        "source": source,
        "received_at": now_iso}
    return record, t["turns"]


def _attachments(media: Any) -> str:
    """`obj.media && obj.media.length ? obj.media.map(m => str_(m.url)).join(' ') : ''`."""
    if gsjs.falsy(media) or not (isinstance(media, (list, str)) and len(media)):
        return ""
    if not isinstance(media, list):
        raise TypeError("obj.media.map is not a function")
    out = []
    for m in media:
        if m is None:
            raise TypeError("Cannot read properties of null (reading 'url')")
        out.append(s_(m.get("url")) if isinstance(m, dict) else "")
    return " ".join(out)


def message_record(body: dict, source: str, now_iso: str) -> dict[str, Any]:
    """quoHandleMessage_'s record: the words kept without a temporary password this platform texted."""
    obj = obj_of(body)
    to = obj.get("to")
    return {
        "message_id": s_(obj.get("id")),
        "event_id": s_(body.get("id")),
        "event_type": s_(body.get("type")),
        "message_created": s_(obj.get("createdAt")),
        "event_at": s_(either(body.get("createdAt"), obj.get("createdAt"))),
        "status": s_(obj.get("status")),
        "quo_number": s_(obj.get("phoneNumberId")),
        "direction": s_(obj.get("direction")),
        "from_number": s_(obj.get("from")),
        "to_number": js_join(to, ", ") if isinstance(to, list) else s_(to),
        "user_id": s_(obj.get("userId")),
        "conversation_id": s_(obj.get("conversationId")),
        "body": SW.js_slice(reset_scrub(s_(either(obj.get("text"), obj.get("body")))), BODY_MAX),
        "attachments": _attachments(obj.get("media")),
        "participants": names(to) or s_(obj.get("from")),
        "team_members": s_(obj.get("userId")),
        "contact_ids": names(obj.get("contactIds")),
        "message_type": s_(either(obj.get("type"), body.get("type"))),
        "source": source,
        "received_at": now_iso}


def summary_record(body: dict, source: str, now_iso: str) -> dict[str, Any]:
    """quoHandleSummary_'s record."""
    obj = obj_of(body)
    return {
        "call_id": s_(either(obj.get("callId"), obj.get("id"))),
        "event_id": s_(body.get("id")),
        "event_type": s_(body.get("type")),
        "summary_created": s_(obj.get("createdAt")),
        "event_at": s_(either(body.get("createdAt"), obj.get("createdAt"))),
        "quo_number": s_(obj.get("phoneNumberId")),
        "direction": s_(obj.get("direction")),
        "duration_s": _duration(obj.get("duration")),
        "summary": SW.js_slice(_joined(obj.get("summary"), "\n"), TEXT_MAX),
        "next_steps": _joined(obj.get("nextSteps"), "\n"),
        "jobs": _joined(obj.get("jobs"), "\n"),
        "status": s_(obj.get("status")),
        "participants": names(obj.get("participants")),
        "team_members": names(either(obj.get("users"), obj.get("teamMembers"))),
        "source": source,
        "received_at": now_iso}


def event_message_id(event: Any) -> str:
    """quoEventMessageId_: the id exactly where quoHandleMessage_ reads it."""
    return s_(obj_of(event).get("id"))


def event_call_id(event: Any) -> str:
    """quoEventCallId_: the id exactly where quoHandleTranscript_ and quoHandleSummary_ read it."""
    obj = obj_of(event)
    return s_(either(obj.get("callId"), obj.get("id")))


def batch_outcome(data: dict | None) -> dict[str, str]:
    """quoBatchOutcome_: the relay drains an event only on filed or already; refused and error keep it."""
    d = data or {}
    if not gsjs.falsy(d.get("duplicate")):
        return {"result": "already", "why": "this " + gsjs.or_text(d.get("kind") or "event") + " id is already filed"}
    if d.get("kind") in ("message", "transcript", "summary"):
        return {"result": "filed", "why": ""}
    if d.get("kind") == "error":
        return {"result": "error", "why": s_(d.get("note")) or "the handler failed"}
    return {"result": "refused", "why": "no handler files type " + (s_(d.get("type")) or "(none)")}


def our_line(reads: L.Reads, to: Any) -> str:
    """quoOurLine_: our line among an incoming text's recipients, for a wrong number's scope; '' when none is ours."""
    for n in re.split(r"[,;]+", gsjs.or_text(to)):
        d = re.sub(r"\D", "", n)[-10:]
        if d and OO.is_ours(reads, d):
            return d
    return ""


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {}
POLICY: dict[str, dict[str, Any]] = {}
