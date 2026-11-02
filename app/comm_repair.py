"""The comms repair lane on Python (CommRepair.gs whole): every incident a person declared and confirmed, and inside it
each person who holds the words we have since corrected, owed one correction. The house (comm_repairs) and the evidence
(comm_attempts) are read off asa-hub-db; a claim the front of another message took (path B) is settled from the
evidence; whoever is still owed is planned and judged by the gates an ask meets (the purpose declared, consent, the
opt-out list, the priority ladder, the quiet hours, the dial), then told through the one send door (comms_rpc.call,
rpcCall_'s answers) under Apps Script's own idempotency keys. The Script Properties the lane kept (comm_repair_owed,
comm_repair_wake_at) are app.comm_repair_state's, and a continuation is a time in it the relay's look fires. Here the
reads: the relay's look (commRepairDue), the scan (commRepairScan) and the board (commRepairBoard);
app/comm_repair_writes.py holds the writes — the declaration, the confirmation with its head, the save's correction,
the backstop and the continuation, each carried under the write lock a few seconds at a time — and path B's lead."""
from __future__ import annotations

import hashlib
import math
import re
from datetime import datetime, timezone
from typing import Any, Callable

import gsjs
import hubdb
import locations as L
import mail_designs as MD
import opt_outs as OO
import smart_clock as SK
import smart_comms as SC
import smart_comms_desk as SCD
import smart_comms_writes as SW
import writes as W
from gsjs import NY
from scope import Defer

APP_ID = "comm-repair"
STATE = "app.comm_repair_state"
DENIED = {"status": 403, "message": "This is the relay's own door."}
# CommRepair.gs
HOUSE = "comm_repairs"
STATES = ("candidate", "declared", "confirmed", "closed", "dismissed")
PERSON_STATES = ("planned", "claimed", "repaired", "undeliverable", "collapsed")
PURPOSE = "correction.owed"
SITUATION_FLOOR = "correction_notice"
DESK_REASON = "undeliverable"
OWED_KEY = "comm_repair_owed"
WAKE_KEY = "comm_repair_wake_at"
CLAIM_TTL_MS = 10 * 60 * 1000
BREATH_MS = 15 * 60 * 1000
TEST_CAP = 1
LEDGER_READ = 5000
NEEDED_COLUMNS = ("words_sha", "situation", "sender_used")
# path A's head: a few people, for real, before the screen comes back (bounded here by the write's own pass)
HEAD_PEOPLE = 3
HEAD_S = 6.0
LEAD_SMS_MAX = 306
WRITER_DENIED = {"status": 403, "message": "Requires an admin or manager account"}
# CommRecord.gs
ATTEMPTS = "comm_attempts"
ATTEMPTS_HEADER = ("id", "createdAt", "intent_key", "person_key", "attempt", "channel", "to_masked", "receipt", "error",
                   "redirected", "doubt", "test_mode", "at", "words_sha", "situation", "sender_used", "words_known")
OBSERVATIONS = "comm_observations"
OBSERVATION_TYPES = ("sent", "redirected", "doubt", "held", "escalated", "unanswered", "replied", "unmatched",
                     "correlated", "contribution", "needs_human", "settled", "dismissed", "stopped", "consent_changed")
# CommConsent.gs
CONSENT = "entity_comm_consent"
EMPLOYMENT_PURPOSES = ("compliance.owed", "shift", "roster", "safety")
CONSENT_GRANTED = ("granted", "opt_in", "opted_in", "yes")
CONSENT_REFUSED = ("revoked", "withdrawn", "opt_out", "opted_out", "no")
# CommCortex.gs
REACH = "comm_reach"
# CommPolicy.gs
POLICY_FLOOR: dict[str, Any] = {"quiet_from": 21, "quiet_to": 8, "min_gap_hours": 72, "max_attempts": 3,
                                "weekend_ok": False, "escalate_after": 2, "gap_overdue_hours": 36,
                                "gap_soon_hours": 72, "gap_open_hours": 168, "test_gap_hours": 24}
PRIORITY_ORDER = ("safety", "repair", "ask", "notice")
PRIORITIES: dict[str, dict[str, Any]] = {
    "safety": {"name": "safety", "skip_gap": True, "skip_quiet": True, "skip_weekend": True, "cap": "none",
               "droppable": False, "why": "somebody could be hurt"},
    "repair": {"name": "repair", "skip_gap": True, "skip_quiet": False, "skip_weekend": True, "cap": 1,
               "droppable": False, "why": "we owe them a word"},
    "ask": {"name": "ask", "skip_gap": False, "skip_quiet": False, "skip_weekend": False, "cap": "book",
            "droppable": False, "why": "they owe us something"},
    "notice": {"name": "notice", "skip_gap": False, "skip_quiet": False, "skip_weekend": False, "cap": "book",
               "droppable": True, "why": "worth knowing, never urgent"},
}
PRIORITY_FLOOR = {"safety": "", "repair": "correction.owed,correction_notice", "notice": "call_off_acknowledged"}

s_ = gsjs.str_
_INDEX = re.compile(r"^(?:0|[1-9][0-9]{0,9})$")


def text(v: Any) -> str:
    """String(v || '')."""
    return gsjs.or_text(v)


def cell(v: Any) -> str:
    """String(v === null || v === undefined ? '' : v).trim()."""
    return gsjs.trim(gsjs.or_blank(v))


def lkey(v: Any) -> str:
    """String(v || '').trim().toLowerCase()."""
    return gsjs.trim(gsjs.or_text(v)).lower()


def num(v: Any) -> float:
    """Number(v)."""
    return math.nan if v is None else SCD.js_number(v)


def js_keys(d: dict) -> list:
    """Object.keys order: the array-index keys ascending, then the rest as they were added."""
    idx = sorted((k for k in d if _INDEX.match(k) and int(k) < 4294967295), key=int)
    return idx + [k for k in d if k not in idx]


def ms(v: Any, fallback: float) -> float:
    """commRepairMs_: Date.parse of the cell's text, the fallback for a blank or an unreadable one."""
    if isinstance(v, gsjs.SheetDate):
        return v.at.timestamp() * 1000.0
    s = cell(v)
    if not s:
        return fallback
    got = gsjs.date_parse(s)
    if got is None and gsjs._JS_DATE_TEXT.match(s):
        at = gsjs.parse_when(s, None)
        got = at.timestamp() * 1000.0 if at is not None else None
    return fallback if got is None else got


def iso_ms(at_ms: float) -> str:
    return gsjs.iso(datetime.fromtimestamp(at_ms / 1000.0, tz=timezone.utc))


def now_ms(reads: L.Reads) -> float:
    return reads.now.timestamp() * 1000.0


def record_id(key: str) -> str:
    """commRecordId_ (commRepairId_ when it is loaded): the key's MD5, its first eight bytes in upper-case hex."""
    return hashlib.md5(key.encode("utf-8")).hexdigest()[:16].upper()


def words_sha(sit: dict | None) -> str:
    """commRepairWordsSha_: the words as resolved at send time — the id, the three templates and the sender."""
    return record_id("\n@@|@@\n".join(SW.words_of(sit or {})))


def intent_key(person_key: Any, incident_id: Any) -> str:
    """commRepairIntentKey_."""
    return lkey(person_key) + "|repair." + text(incident_id)


def person_id(incident_id: Any, person_key: Any) -> str:
    return "RPP_" + record_id(text(incident_id) + "|" + lkey(person_key))


def person_row(incident_id: str, person: dict, now_iso: str) -> dict[str, Any]:
    """commRepairPersonRow_: one person inside an incident, as the row it becomes."""
    key = lkey(person.get("person_key"))
    return {"id": person_id(incident_id, key), "kind": "person", "incident_id": text(incident_id),
            "intent_key": intent_key(key, incident_id), "person_key": key,
            "person_name": text(person.get("person_name")), "told_at": text(person.get("at")),
            "told_channel": text(person.get("channel")), "claim_state": "planned", "createdAt": text(now_iso)}


def incident_id_of(situation: Any, from_iso: Any, to_iso: Any, what: Any) -> str:
    """commRepairIncidentId_: what was wrong, where and when — the same incident declared twice is one row."""
    return "RPI" + record_id("|".join((text(situation), text(from_iso), text(to_iso), text(what))))[:12]


def incident_row(reads: L.Reads, incident: dict, now_iso: str) -> dict[str, Any]:
    """commRepairIncidentRow_: one incident, as the row it becomes (the declared half; confirming is its caller's)."""
    iid = text(incident.get("incident_id"))
    st = text(incident.get("state"))
    aud = num(incident.get("audience"))
    return {"id": "RPI_" + record_id(iid), "kind": "incident", "incident_id": iid,
            "situation": text(incident.get("situation")), "window_from": text(incident.get("window_from")),
            "window_to": text(incident.get("window_to")),
            "what_was_wrong": SW.js_slice(text(incident.get("what_was_wrong")), 500),
            "words_sha_then": text(incident.get("words_sha_then")), "sender_then": text(incident.get("sender_then")),
            "state": st if st in STATES else "candidate", "priority": priority(reads),
            "audience": int(aud) if aud == aud and aud else 0, "declared_by": text(incident.get("declared_by")),
            "declared_at": text(incident.get("declared_at")) or text(now_iso),
            "note": SW.js_slice(text(incident.get("note")), 500)}


def incident_by(rows: list[dict], incident_id: Any) -> dict | None:
    """commRepairIncidentBy_: one incident by its id (the last row carrying it), or None."""
    want = text(incident_id)
    found = None
    if want:
        for r in rows:
            if text(r.get("kind")) == "incident" and text(r.get("incident_id")) == want:
                found = r
    return found


def earliest(people_: list[dict]) -> str:
    """commRepairEarliest_: the earliest moment anybody in an audience was told."""
    best = ""
    for p in people_ or []:
        at = text((p or {}).get("at"))
        if at and (not best or at < best):
            best = at
    return best


def reply_token(key: Any) -> str:
    """commReplyToken_."""
    return "CI-" + re.sub(r"[^A-Z0-9]", "", record_id(text(key)))[:6]


def new_stats() -> dict[str, Any]:
    """commRepairStats_."""
    return {"incidents": 0, "planned": 0, "said": 0, "redirected": 0, "deferred": 0, "held_by_dial": 0, "gated": 0,
            "doubts": 0, "undeliverable": 0, "already": 0, "collapsed": 0, "held_for_breath": 0, "left_for_later": 0,
            "wants_wake": False}


# ---- the houses ---------------------------------------------------------------------------------------------------

def house_rows(reads: L.Reads) -> list[dict]:
    """commRepairRows_: the house as objects keyed by its own header; a house with no tab is empty."""
    return SCD.board_rows(reads, HOUSE)


def attempt_rows(reads: L.Reads) -> list[dict]:
    """commRepairAttemptRows_: the evidence house, read once per request."""
    return SCD.board_rows(reads, ATTEMPTS)


def ledger_rows(reads: L.Reads) -> list[dict[str, str]]:
    """commRepairLedgerRows_: the catalogue's ledger, its newest rows only."""
    got = SCD.ledger_rows(reads)
    if got is None:
        return []
    rows, heads = got
    out = []
    for _rn, raw in rows[-LEDGER_READ:]:
        out.append({k: text(hubdb.typed(raw.get(heads[k]), "hub"))
                    for k in ("key", "situation", "person", "expires", "channel", "at")})
    return out


def owed_count(rows: list[dict]) -> int:
    """commRepairStamp_'s count: the person rows planned or claimed."""
    return sum(1 for r in rows if text(r.get("kind")) == "person"
               and (text(r.get("claim_state")) or "planned") in ("planned", "claimed"))


def owed_now(reads: L.Reads) -> int:
    """commRepairOwedCount_: the cheap question, one property read."""
    n = num(state(reads, OWED_KEY))
    return int(n) if n == n and n else 0


def state(reads: L.Reads, key: str) -> str:
    """A Script Property the pass kept, from app.comm_repair_state; '' when it holds none or cannot be read."""
    sql = f"select value from {STATE} where key = %s"
    cur = W.HELD.get()
    try:
        if cur is not None:
            with SC._guard(cur):
                cur.execute(sql, (key,))
                got = cur.fetchall()
        else:
            got = reads.db.query(sql, (key,))
    except Exception:  # noqa: BLE001 - a property that cannot be read is none
        return ""
    return str(got[0][0] or "") if got else ""


# ---- settling a provisional claim ---------------------------------------------------------------------------------

def host_evidence(reads: L.Reads, key: str, since_ms: float) -> dict | None:
    """commRepairHostEvidence_: the newest evidence row a host thread left at or after the claim, a minute of slack."""
    if not key:
        return None
    best = None
    for r in attempt_rows(reads):
        if text(r.get("intent_key")) != key:
            continue
        at = ms(r.get("at"), 0)
        if not at or at < (since_ms or 0) - 60000:
            continue
        if best is None or at >= ms(best.get("at"), 0):
            best = r
    return best


def settle(reads: L.Reads, row: dict, at_ms: float, mark: Callable[..., bool] | None) -> dict[str, Any]:
    """commRepairSettle_: a path-B claim read against what the host message did; `mark` writes the ending."""
    out: dict[str, Any] = {"id": text(row.get("id")), "changed": False, "to": "", "why": ""}
    if text(row.get("kind")) != "person":
        return out
    if (text(row.get("claim_state")) or "planned") == "claimed":
        test = False
    elif (text(row.get("test_claim_state")) or "planned") == "claimed":
        test = True
    else:
        return out
    out["test"] = test
    if (text(row.get("claim_path")) or "A") != "B":
        return out
    host = text(row.get("claim_host_key"))
    since = ms(row.get("test_claimed_at") if test else row.get("claimed_at"), 0)
    age = at_ms - (since or 0)
    ev = host_evidence(reads, host, since) if host else None
    fields: dict[str, Any] = {}
    if ev is None:
        if age < CLAIM_TTL_MS:
            out["why"] = "in flight"
            return out
        out.update(changed=True, to="planned", why="the line was rendered and no send followed it — the host message "
                   "never reached the transport, so nothing was said and the debt stands")
        fields["note"] = out["why"]
    elif text(ev.get("redirected")) == "yes" or text(ev.get("test_mode")) == "yes":
        out.update(changed=True, to="repaired" if test else "planned",
                   why="the host message was redirected to the testers" + (
                       " — which is what test mode is, and the real person is still owed" if test
                       else " — the person was never told"))
        if test:
            fields.update(told_at=text(ev.get("at")), told_channel="rehearsal")
        else:
            fields["note"] = out["why"]
    elif text(ev.get("doubt")) == "yes":
        out.update(changed=True, to="repaired", why="in doubt: " + text(ev.get("error")) + " — it may have landed, and "
                   "a correction is never said twice")
        fields.update(told_at=text(ev.get("at")), told_channel=text(ev.get("channel")), attempt_id=text(ev.get("id")),
                      undeliverable_why=out["why"])
    elif text(ev.get("receipt")):
        out.update(changed=True, to="repaired", why="it rode the front of a message that landed — no extra message, "
                   "which is the point of this path")
        fields.update(told_at=text(ev.get("at")), told_channel=text(ev.get("channel")), attempt_id=text(ev.get("id")),
                      receipt=text(ev.get("receipt")))
    else:
        out.update(changed=True, to="planned", why="the host message was refused (" + (text(ev.get("error"))
                   or "no receipt") + ") — nothing was said, and the front of the next message carries it")
        fields["note"] = out["why"]
    fields.update(claim_path="", claim_host_key="")
    if mark is not None:
        mark(text(row.get("incident_id")), text(row.get("person_key")), out["to"], fields, test)
    return out


def settle_all(reads: L.Reads, rows: list[dict], at_ms: float, mark: Callable[..., bool] | None) -> list[dict]:
    """commRepairSettleAll_: every provisional claim settled, the rows answered as they now stand."""
    for r in rows:
        res = settle(reads, r, at_ms, mark)
        if not res["changed"]:
            continue
        r["test_claim_state" if res["test"] else "claim_state"] = res["to"]
        if res["to"] == "planned":
            r["claim_path"] = ""
            r["claim_host_key"] = ""
            r["test_claimed_at" if res["test"] else "claimed_at"] = ""
    return rows


def owed_for(reads: L.Reads, person_key: Any, rows: list[dict], at_ms: float,
             mark: Callable[..., bool] | None) -> list[dict[str, Any]]:
    """commRepairOwedFor_: what this person is still owed, settled and oldest first — only a confirmed incident's."""
    key = lkey(person_key)
    if not key:
        return []
    every = settle_all(reads, rows, at_ms, mark)
    confirmed = {text(r.get("incident_id")): r for r in every
                 if text(r.get("kind")) == "incident" and text(r.get("state")) == "confirmed"}
    out = []
    for r in every:
        if text(r.get("kind")) != "person" or lkey(r.get("person_key")) != key:
            continue
        if (text(r.get("claim_state")) or "planned") != "planned":
            continue
        inc = confirmed.get(text(r.get("incident_id")))
        if inc is None:
            continue
        out.append({"person": r, "incident": inc, "at": ms(text(inc.get("confirmed_at")) or text(inc.get(
            "declared_at")) or text(inc.get("createdAt")), 0)})
    out.sort(key=lambda o: o["at"])
    return out


def in_breath(person_key: Any, rows: list[dict], at_ms: float) -> bool:
    """commRepairInBreath_: was this person told anything by this lane in the last breath?"""
    key = lkey(person_key)
    for r in rows:
        if text(r.get("kind")) != "person" or lkey(r.get("person_key")) != key:
            continue
        told = ms(r.get("told_at"), 0)
        if told and (at_ms - told) < BREATH_MS:
            return True
    return False


# ---- who holds the old words --------------------------------------------------------------------------------------

def person_key_from(raw_key: Any, person_name: Any) -> str:
    """commRepairPersonKeyFrom_: the person a ledger row's key names, else the name's key."""
    key = gsjs.trim(text(raw_key))
    if key.startswith("REHEARSAL|"):
        key = key[len("REHEARSAL|"):]
    parts = key.split("|")
    candidate = parts[1] if len(parts) >= 2 else ""
    candidate = gsjs.trim(text(candidate)).lower()
    return candidate or gsjs.name_key(person_name)


def attempts_in(reads: L.Reads, sid: str, from_ms: float, to_ms: float) -> list[dict]:
    """commRepairAttemptsIn_: our own evidence rows for a situation in a window."""
    out = []
    for r in attempt_rows(reads):
        at = ms(r.get("at"), 0)
        if not at or at < from_ms or at > to_ms:
            continue
        sit = gsjs.trim(text(r.get("situation")))
        if sit and sid and sit != sid:
            continue
        out.append(r)
    return out


def audience(reads: L.Reads, situation_id: Any, from_iso: Any, to_iso: Any) -> dict[str, Any]:
    """commRepairAudience_: who the ledger says was told a situation in a window, less the rehearsals and the sends
    our evidence says reached the testers."""
    want = gsjs.trim(text(situation_id))
    from_ms, to_ms = ms(from_iso, 0), ms(to_iso, now_ms(reads))
    out: dict[str, Any] = {"situation": want, "from": text(from_iso), "to": text(to_iso), "people": [], "count": 0,
                           "dropped": {"rehearsal": 0, "redirected": 0, "test_mode": 0, "unkeyed": 0}, "read": 0}
    if not want:
        return out
    seen: dict[str, dict] = {}
    rows = ledger_rows(reads)
    out["read"] = len(rows)
    for r in rows:
        if gsjs.trim(r["situation"]) != want:
            continue
        at = ms(r["at"], 0)
        if not at or at < from_ms or at > to_ms:
            continue
        if gsjs.trim(r["channel"]).lower() == "rehearsal" or r["key"].startswith("REHEARSAL|"):
            out["dropped"]["rehearsal"] += 1
            continue
        key = person_key_from(r["key"], r["person"])
        if not key:
            out["dropped"]["unkeyed"] += 1
            continue
        if key in seen:
            continue
        seen[key] = {"person_key": key, "person_name": r["person"], "at": r["at"], "channel": r["channel"]}
    for a in attempts_in(reads, want, from_ms, to_ms):
        k = lkey(a.get("person_key"))
        if not k or k not in seen:
            continue
        if text(a.get("redirected")) == "yes":
            del seen[k]
            out["dropped"]["redirected"] += 1
        elif text(a.get("test_mode")) == "yes":
            del seen[k]
            out["dropped"]["test_mode"] += 1
    out["people"] = [seen[k] for k in js_keys(seen)]
    out["count"] = len(out["people"])
    return out


def audience_by_sha(reads: L.Reads, situation_id: Any, sha: Any, sender: Any) -> dict[str, Any]:
    """commRepairAudienceBySha_: whoever our evidence says holds a known version, no window needed."""
    want, sha, sender = gsjs.trim(text(situation_id)), gsjs.trim(text(sha)), gsjs.trim(text(sender))
    out: dict[str, Any] = {"situation": want, "words_sha": sha, "sender_used": sender, "people": [], "count": 0,
                           "read": 0, "dropped": {"redirected": 0, "test_mode": 0, "unknown_words": 0, "unkeyed": 0}}
    if not want or (not sha and not sender):
        return out
    seen: dict[str, dict] = {}
    for r in attempt_rows(reads):
        out["read"] += 1
        if gsjs.trim(text(r.get("situation"))) != want:
            continue
        row_sha, row_sender = gsjs.trim(text(r.get("words_sha"))), gsjs.trim(text(r.get("sender_used")))
        if not row_sha and not row_sender:
            out["dropped"]["unknown_words"] += 1
            continue
        if not ((row_sha == sha) if sha else (row_sender == sender)):
            continue
        if text(r.get("redirected")) == "yes":
            out["dropped"]["redirected"] += 1
            continue
        if text(r.get("test_mode")) == "yes":
            out["dropped"]["test_mode"] += 1
            continue
        if not text(r.get("receipt")) and text(r.get("error")) and text(r.get("doubt")) != "yes":
            continue
        key = lkey(r.get("person_key"))
        if not key:
            out["dropped"]["unkeyed"] += 1
            continue
        if key not in seen:
            seen[key] = {"person_key": key, "person_name": "", "at": text(r.get("at")),
                         "channel": text(r.get("channel"))}
    out["people"] = [seen[k] for k in js_keys(seen)]
    out["count"] = len(out["people"])
    return out


def audience_of(reads: L.Reads, incident: dict) -> dict[str, Any]:
    """commRepairAudienceOf_: the exact digest when the save found it, else the window a person declared."""
    sha, sender = text(incident.get("words_sha_then")), text(incident.get("sender_then"))
    if sha or sender:
        return audience_by_sha(reads, text(incident.get("situation")), sha, sender)
    return audience(reads, text(incident.get("situation")), text(incident.get("window_from")),
                    text(incident.get("window_to")))


# ---- can this person be reached at all ----------------------------------------------------------------------------

def people(reads: L.Reads) -> dict[str, dict[str, str]]:
    """commRecordPeople_: the People house by name key, the first row of a name kept."""
    out: dict[str, dict[str, str]] = {}
    for p in SK._people(reads):
        k = gsjs.name_key((p or {}).get("name"))
        if not k or k in out:
            continue
        out[k] = {"name": text(p.get("name")), "phone": s_(p.get("phone")), "email": s_(p.get("email"))}
    return out


def routes(reads: L.Reads) -> dict[str, dict]:
    """commRecordRoutes_: the cortex's route rows by person_key, the first one kept — from the house where it is kept
    (comm_routes: Postgres once the routes are, else the copy)."""
    import comm_routes  # noqa: PLC0415 - the routes' owner
    return comm_routes.routes(reads)


def consent(reads: L.Reads) -> dict[str, list[dict]]:
    """commRecordConsentRows_: the canonical consent store's rows by name key; an unreadable store is silence."""
    out: dict[str, list[dict]] = {}
    try:
        rows = SCD.board_rows(reads, CONSENT)
    except Exception:  # noqa: BLE001 - silence, judged by the rule
        return out
    for r in rows:
        k = gsjs.name_key(r.get("entity_name") or "")
        if k:
            out.setdefault(k, []).append(r)
    return out


def contact(ppl: dict, rts: dict, person_key: Any) -> dict[str, str] | None:
    """commRecordContact_: the People house first, the cortex's proposal when the house is silent."""
    k = lkey(person_key)
    p, r = ppl.get(k), rts.get(k)
    if p is None and r is None:
        return None
    return {"name": text((p or {}).get("name")) or text((r or {}).get("name")),
            "phone": s_((p or {}).get("phone")) or s_((r or {}).get("phone")),
            "email": s_((p or {}).get("email")) or s_((r or {}).get("email"))}


def refused_of(reads: L.Reads, person: dict | None) -> dict[str, bool]:
    """commRecordRefused_: what the opt-out list says about this person, per channel (this file names no scope)."""
    out = {"sms": False, "email": False}
    if not person:
        return out
    for ch, target in (("sms", person.get("phone")), ("email", person.get("email"))):
        if not target:
            continue
        try:
            out[ch] = bool(SCD.opt_out_blocked(reads, target, ""))
        except (Defer, hubdb.Unreadable):
            raise
        except Exception:  # noqa: BLE001 - a list that throws refuses
            out[ch] = True
    return out


def wrong_number(reads: L.Reads, person: dict | None) -> bool:
    """commRepairWrongNumber_: was this person suppressed because the number was ours to get wrong?"""
    try:
        keys = {SCD.opt_out_key(person.get(f)) for f in ("phone", "email") if person and person.get(f)}
        for r in OO.opt_out_rows(reads):
            if text(r.get("releasedat")):
                continue
            if text(r.get("targetkey")) not in keys:
                continue
            if gsjs.trim(text(r.get("source"))).lower() == "wrong number":
                return True
    except (Defer, hubdb.Unreadable):
        raise
    except Exception:  # noqa: BLE001 - an unreadable list names nobody
        return False
    return False


def consent_row_verdict(row: dict | None, at_ms: float) -> str:
    """commConsentRowVerdict_."""
    if not row:
        return "unknown"
    status = lkey(row.get("status"))
    if status in CONSENT_REFUSED:
        return "refused"
    if status not in CONSENT_GRANTED:
        return "unknown"
    until = gsjs.trim(text(row.get("expires_at")))
    if until:
        t = gsjs.date_parse(until)
        if t is not None and t < at_ms:
            return "unknown"
    start = gsjs.trim(text(row.get("effective_at")))
    if start:
        t = gsjs.date_parse(start)
        if t is not None and t > at_ms:
            return "unknown"
    return "granted"


def consent_verdict(reads: L.Reads, rows: list[dict], refused: dict, channel: str, purpose: str,
                    at_ms: float) -> dict[str, Any]:
    """commConsentVerdict_: a refusal wins; a grant permits its own purpose; silence is the comm_silence rule's."""
    ch, why = lkey(channel), lkey(purpose)
    if refused and (refused.get("all") or refused.get(ch)):
        return {"ok": False, "hard": True,
                "why": "this person asked us to stop" + ("" if refused.get("all") else " on " + ch)}
    live = [r for r in rows or [] if lkey(r.get("channel_type")) == ch and consent_row_verdict(r, at_ms) == "granted"]
    if any(not lkey(r.get("purpose")) or lkey(r.get("purpose")) == why for r in live):
        return {"ok": True, "why": "granted for " + ch + (" · " + why if why else "")}
    others = list(dict.fromkeys(p for p in (lkey(r.get("purpose")) for r in live) if p))
    seen = " (granted for " + ", ".join(others) + ", not for this)" if others else ""
    rule = SCD.digest_word(reads, "comm_silence", "employment").strip().lower()
    if rule == "allow":
        return {"ok": True, "why": "no record for this purpose" + seen + ", and the words book allows silence"}
    if rule == "employment" and why in EMPLOYMENT_PURPOSES:
        return {"ok": True, "why": "no consent record for this purpose" + seen + "; permitted because " + why +
                " is the employment relationship's own purpose, not marketing"}
    return {"ok": False, "hard": False,
            "why": "no consent record for " + ch + (" · " + why if why else "") + seen + " — silence is not permission"}


def route_for(reads: L.Reads, rows: list[dict], refused: dict, purpose: str, channels: list[str],
              at_ms: float) -> dict[str, Any]:
    """commRouteFor_: the first channel consent permits, every one tried said."""
    tried = []
    for ch in channels or ["sms", "email", "voice"]:
        v = consent_verdict(reads, rows, refused, ch, purpose, at_ms)
        tried.append(ch + ": " + v["why"])
        if v["ok"]:
            return {"channel": ch, "ok": True, "why": v["why"], "tried": tried}
    return {"channel": "", "ok": False, "why": "no permitted route", "tried": tried}


def purpose_declared() -> bool:
    """commRepairPurposeDeclared_: is correction.owed one of the employment purposes?"""
    return PURPOSE in EMPLOYMENT_PURPOSES


def reachable(reads: L.Reads, ctx: dict, person_key: str) -> dict[str, Any]:
    """commRepairReachable_: the route for a correction, every gate an ask passes asked the same way."""
    person = contact(ctx["people"], ctx["routes"](), person_key)
    if not person or (not person["phone"] and not person["email"]):
        return {"ok": False, "why": "no contact in the People house — a person has to find them"}
    refused = refused_of(reads, person)
    if (refused["sms"] or refused["email"]) and wrong_number(reads, person):
        return {"ok": False, "person": person,
                "why": "suppressed as a wrong number — the likeliest person to have received something not meant for "
                       "them, and the one we may not text. A person owes them this, on the desk."}
    route = route_for(reads, ctx["consent"]().get(lkey(person_key)) or [], refused, PURPOSE, ctx["channels"],
                      ctx["now_ms"])
    if not route["ok"]:
        return {"ok": False, "person": person, "why": route["why"], "tried": route["tried"]}
    return {"ok": True, "person": person, "channel": route["channel"], "why": route["why"], "tried": route["tried"]}


# ---- the ladder and the hours (CommPolicy.gs) ---------------------------------------------------------------------

def policy(reads: L.Reads, key: str) -> Any:
    """commPolicy_: the words book's comm_<key> row, the floor behind it."""
    floor = POLICY_FLOOR[key]
    if isinstance(floor, bool):
        return SCD.digest_word(reads, "comm_" + key, "yes" if floor else "no").strip().lower() == "yes"
    return SCD.digest_setting(reads, "comm_" + key, floor, 0, 9999)


def priority_ids(reads: L.Reads, priority: str) -> list[str]:
    """commPriorityIds_: the ids the book lists under a priority, its floor behind."""
    floor = PRIORITY_FLOOR.get(priority)
    if floor is None:
        return []
    raw = SCD.digest_word(reads, "comm_priority_" + priority, floor)
    return [x for x in (gsjs.trim(p).lower() for p in re.split(r"[,;\n]", raw or "")) if x]


def priority_for(reads: L.Reads, pid: Any) -> str:
    """commPriorityFor_: walked in ladder order, an id listed twice taking the higher."""
    want = lkey(pid)
    if not want:
        return "ask"
    for p in PRIORITY_ORDER:
        if p != "ask" and want in priority_ids(reads, p):
            return p
    return "ask"


def priority_rule(priority: str) -> dict[str, Any]:
    return PRIORITIES.get(priority) or PRIORITIES["ask"]


def priority(reads: L.Reads) -> str:
    """commRepairPriority_: asked of the ladder, never decided here."""
    return priority_for(reads, PURPOSE)


def priority_of(reads: L.Reads, intent: dict, ctx: dict) -> dict[str, str]:
    """commPriorityOf_: from the declared ids, never from the contents."""
    ids = [x for x in (ctx.get("priority_id"), ctx.get("situation"), intent.get("purpose")) if x]
    for i in ids:
        word = priority_for(reads, i)
        if word != "ask":
            return {"priority": word, "id": lkey(i),
                    "why": word + " (" + priority_rule(word)["why"] + ") — declared for `" + lkey(i) + "`"}
    return {"priority": "ask", "id": lkey(ids[0]) if ids else "",
            "why": "ask (" + PRIORITIES["ask"]["why"] + ") — nothing above it is declared for this" +
                   (" (`" + lkey(ids[0]) + "`)" if ids else "")}


def attempt_cap(reads: L.Reads, priority: str) -> float:
    """commAttemptCapFor_: 0 is no cap at all."""
    rule = priority_rule(priority)
    if rule["cap"] == "none":
        return 0
    if isinstance(rule["cap"], int):
        return rule["cap"]
    return num(policy(reads, "max_attempts"))


def attempt_verdict(reads: L.Reads, attempts: Any, priority: str) -> dict[str, Any]:
    """commAttemptVerdict_."""
    n = num(attempts)
    n = 0 if n != n else n
    rule = priority_rule(priority)
    cap = attempt_cap(reads, priority)
    after = num(policy(reads, "escalate_after"))
    if cap == 0:
        return {"ok": True, "escalate": n >= after, "why": "attempt " + gsjs.num_str(n + 1) + ", uncapped — priority "
                + rule["name"] + " is tried until it is delivered or a person takes it"}
    if n >= cap:
        return {"ok": False, "defer": False, "escalate": True,
                "why": "priority " + rule["name"] + " is said once per person and this one is spent — it is a "
                       "person's job now, and never a retry" if isinstance(rule["cap"], int)
                else gsjs.num_str(n) + " attempts with no answer — this is a person's job now, not a reminder's"}
    return {"ok": True, "escalate": n >= after, "why": "attempt " + gsjs.num_str(n + 1) + " of " + gsjs.num_str(cap) +
            (" (priority " + rule["name"] + ")" if isinstance(rule["cap"], int) else "")}


def gap_for(reads: L.Reads, band: str) -> float:
    """commGapFor_."""
    key = {"overdue": "gap_overdue_hours", "soon": "gap_soon_hours", "open": "gap_open_hours"}.get(band)
    return num(policy(reads, key or "min_gap_hours"))


def gap_verdict(reads: L.Reads, last_ms: float, at_ms: float, band: str, priority: str) -> dict[str, Any]:
    """commGapVerdict_."""
    rule = priority_rule(priority)
    if rule["skip_gap"]:
        return {"ok": True, "skipped": "the gap",
                "why": "not paced — priority " + rule["name"] + " is not another ask, and the gap counts asks"}
    if not last_ms:
        return {"ok": True, "why": "never asked"}
    hours = (at_ms - last_ms) / 3600000.0
    gap = gap_for(reads, band)
    if hours < gap:
        return {"ok": False, "defer": True,
                "why": "asked " + gsjs.num_str(gsjs.js_round(hours)) + "h ago; the floor is " + gsjs.num_str(gap) + "h"}
    return {"ok": True, "why": gsjs.num_str(gsjs.js_round(hours)) + "h since the last ask"}


def test_gap_verdict(reads: L.Reads, last_ms: float, at_ms: float, priority: str) -> dict[str, Any]:
    """commTestGapVerdict_."""
    rule = priority_rule(priority)
    if rule["skip_gap"]:
        return {"ok": True, "skipped": "the test pace",
                "why": "not paced — priority " + rule["name"] + " is not another ask (test pace)"}
    gap = num(policy(reads, "test_gap_hours"))
    if not gap > 0:
        return {"ok": True, "why": "test mode, no pace"}
    if not last_ms:
        return {"ok": True, "why": "never asked"}
    hours = (at_ms - last_ms) / 3600000.0
    if hours < gap:
        return {"ok": False, "defer": True, "why": "asked " + gsjs.num_str(gsjs.js_round(hours)) + "h ago; the test "
                "pace is " + gsjs.num_str(gap) + "h"}
    return {"ok": True, "why": gsjs.num_str(gsjs.js_round(hours)) + "h since the last ask (test pace " +
            gsjs.num_str(gap) + "h)"}


def window_verdict(reads: L.Reads, local_hour: Any, local_day: Any, quiet: dict | None,
                   priority: str) -> dict[str, Any]:
    """commWindowVerdict_: is this a moment we may speak?"""
    rule = priority_rule(priority)
    h = math.nan if local_hour in ("", None) else num(local_hour)
    if h != h:
        return {"ok": True, "why": "no local clock for this person — the platform default stands"}
    q = quiet or {}
    frm = num(q["from"] if "from" in q else policy(reads, "quiet_from"))
    to = num(q["to"] if "to" in q else policy(reads, "quiet_to"))
    in_quiet = (h >= frm or h < to) if frm > to else (frm <= h < to)
    if in_quiet:
        if rule["skip_quiet"]:
            return {"ok": True, "skipped": "quiet hours", "why": gsjs.num_str(h) + ":00 local and sent anyway — "
                    "priority " + rule["name"] + " is the only one that may wake somebody"}
        return {"ok": False, "defer": True, "why": "quiet hours for this person (" + gsjs.num_str(h) + ":00 local" +
                ("; " + text(q.get("why")) if q.get("why") else "") + ")"}
    day = math.nan if local_day in ("", None) else num(local_day)
    if not policy(reads, "weekend_ok") and day in (0, 6):
        if rule["skip_weekend"]:
            return {"ok": True, "skipped": "the weekend", "why": "a weekend, and priority " + rule["name"] +
                    " is not held by it — it asks for nothing"}
        return {"ok": False, "defer": True, "why": "a weekend, and compliance is not urgent enough to cost one"}
    return {"ok": True, "why": "inside the window"}


def dial_word(reads: L.Reads) -> str:
    """commDial_: record while test mode is on, send while off, off when the switch cannot be read."""
    return SCD.dial(reads.config())["word"]


def test_mode(reads: L.Reads) -> bool:
    """commTestMode_: hubTestRedirect_ answers — on, or a switch that cannot be read."""
    return bool(SCD.test_mode_state(reads.config())["on"])


def plan_verdict(reads: L.Reads, intent: dict, ctx: dict) -> dict[str, Any]:
    """commPlanVerdict_: the whole verdict for one thread, every reason it reached; what the policy decided kept apart
    from whether the dial lets it act."""
    reasons: list[str] = []
    skipped: list[str] = []
    verdict: dict[str, Any] = {"send": True, "defer": False, "escalate": False}
    test = bool(ctx["test"])
    verdict["test"] = test
    soft = " — not enforced in test mode"
    pri = priority_of(reads, intent, ctx)
    verdict.update(priority=pri["priority"], priority_id=pri["id"],
                   droppable=bool(priority_rule(pri["priority"])["droppable"]))
    reasons.append("priority: " + pri["why"])
    # commConsolidate_ of a thread that carries no obligation
    verdict["parts"] = []
    att = attempt_verdict(reads, ctx.get("attempts"), verdict["priority"])
    if att.get("escalate"):
        verdict["escalate"] = True
    if not att["ok"] and test:
        reasons.append("attempts: " + att["why"] + soft)
    else:
        reasons.append("attempts: " + att["why"])
        if not att["ok"]:
            verdict["send"], verdict["defer"] = False, bool(att.get("defer"))
    if verdict["send"]:
        gap = test_gap_verdict(reads, ctx.get("last_ms") or 0, ctx["now_ms"], verdict["priority"]) if test else \
            gap_verdict(reads, ctx.get("last_ms") or 0, ctx["now_ms"], "", verdict["priority"])
        reasons.append("gap: " + gap["why"])
        if gap.get("skipped"):
            skipped.append(gap["skipped"])
        if not gap["ok"]:
            verdict["send"], verdict["defer"] = False, True
    if verdict["send"]:
        win = window_verdict(reads, ctx.get("local_hour"), ctx.get("local_day"), ctx.get("quiet"), verdict["priority"])
        if not win["ok"] and test:
            reasons.append("window: " + win["why"] + soft)
        else:
            reasons.append("window: " + win["why"])
            if win.get("skipped"):
                skipped.append(win["skipped"])
            if not win["ok"]:
                verdict["send"], verdict["defer"] = False, True
    verdict["skipped"] = skipped
    if skipped:
        reasons.append("skipped: " + ", ".join(skipped) + " — priority " + verdict["priority"] + " allows it")
    verdict["reasons"] = reasons
    verdict["dial"] = dial_word(reads)
    verdict["policy"] = "would send" if verdict["send"] else ("held" if verdict["defer"] else "blocked")
    if verdict["dial"] != "send":
        verdict["send"] = False
        reasons.append("dial: " + verdict["dial"] + " — worked out, not handed over")
    return verdict


# ---- the hours the cortex knows (CommCortex.gs) -------------------------------------------------------------------

def reach_rows(reads: L.Reads) -> dict[str, dict]:
    """commReachRows_: the reach house by person_key, the last row kept."""
    def read() -> dict[str, dict]:
        out: dict[str, dict] = {}
        for r in SCD.board_rows(reads, REACH):
            who = lkey(r.get("person_key"))
            if who:
                out[who] = r
        return out
    return reads.once("comm_repair:reach", read)


def reach_ms(v: Any) -> float:
    """commReachMs_: an instant off a cell, or 0."""
    if v is None or v == "":
        return 0
    if isinstance(v, bool):
        return 0
    if isinstance(v, (int, float)):
        return math.floor(v) if math.isfinite(v) and v > 0 else 0
    if isinstance(v, gsjs.SheetDate):
        return v.at.timestamp() * 1000.0
    t = s_(v)
    if not t:
        return 0
    if re.fullmatch(r"\d{10,16}", t):
        return math.floor(float(t))
    got = ms(t, 0)
    return got if math.isfinite(got) else 0


def reach_clock(at_ms: float, with_day: bool = False) -> str:
    """commReachClock_: HH:mm on the script's clock, with the weekday when asked."""
    try:
        return datetime.fromtimestamp(at_ms / 1000.0, tz=NY).strftime("%a %H:%M" if with_day else "%H:%M")
    except (OverflowError, OSError, ValueError):
        return ""


def cortex_window(reads: L.Reads, route: dict | None, floor_from: Any, floor_to: Any, person_key: Any,
                  at_ms: float) -> dict[str, Any]:
    """commCortexWindowFrom_: the platform's quiet hours narrowed by the person's own shifts, never widened; a hold
    first. (The shift pass it carries along is not read by commWindowVerdict_, so it is not drawn here.)"""
    quiet_from, quiet_to = num(floor_from), num(floor_to)
    who = s_(person_key).lower() or (lkey(route.get("person_key")) if route else "")
    reach = reach_rows(reads).get(who) if who else None
    hold = 0.0
    if reach:
        hold = reach_ms(reach.get("hold_until_ms")) or reach_ms(reach.get("hold_until"))
        hold = hold if hold > at_ms else 0
    if hold:
        return {"from": 0, "to": 24, "hold_until_ms": hold,
                "why": "they are not at work today, held until " + reach_clock(hold, True) + " — " +
                       (s_(reach.get("why")) or "a call-off the platform already holds")}
    if not route:
        return {"from": quiet_from, "to": quiet_to, "why": "the platform default"}
    frm, to = text(route.get("window_from")), text(route.get("window_to"))
    if frm == "" or to == "":
        return {"from": quiet_from, "to": quiet_to, "why": "the cortex holds no shift for them — the default stands"}
    awake_from, awake_to = num(frm), num(to)
    late = math.nan if math.isnan(quiet_to) or math.isnan(awake_from) else max(quiet_to, awake_from)
    early = math.nan if math.isnan(quiet_from) or math.isnan(awake_to) else min(quiet_from, awake_to)
    return {"from": early, "to": late, "why": "narrowed by their own shifts: " + text(route.get("window_why"))}


# ---- the words of the correction ----------------------------------------------------------------------------------

def situation_now(reads: L.Reads) -> dict | None:
    """commRepairSituationNow_: the situation the bindings name for correction.owed (commSituationFor_), else
    correction_notice — on, or None."""
    rows = SCD.situations(reads)
    try:
        sid = text(MD.bindings(reads).get(PURPOSE))
    except (Defer, hubdb.Unreadable):
        raise
    except Exception:  # noqa: BLE001 - no binding: the floor
        sid = ""
    if sid:
        sit = SCD.situation_on(rows, sid)
        if sit is not None:
            return sit
    return SCD.situation_on(rows, SITUATION_FLOOR)


def channels(sit: dict) -> list[str]:
    """commRecordChannels_: the situation's channels in its order; sms then email when silent."""
    got = [c.strip().lower() for c in SC.smart_list(sit.get("channels"))]
    got = [c for c in got if c]
    return got or ["sms", "email"]


def light(incident_id: str, person_key: str, person_name: str) -> dict[str, Any]:
    """commRepairLight_: the thread, as the three fields every house in this lane reads."""
    key = lkey(person_key)
    return {"intent_key": intent_key(key, incident_id), "person_key": key, "person_name": text(person_name),
            "purpose": PURPOSE, "bindings": []}


def item(lt: dict, sit: dict, person: dict, incident: dict) -> dict[str, Any]:
    """commRepairItem_: the transport's shape for a message that carries no obligation."""
    return {"situation": text(sit.get("id")), "correction": text(incident.get("what_was_wrong")),
            "key": "CI|" + text(lt.get("intent_key")), "name": text(lt.get("person_name")),
            "name_key": text(lt.get("person_key")), "phone": text(person.get("phone")),
            "email": text(person.get("email")), "credential": text(sit.get("credential")), "expires": "",
            "days_left": "", "intent_key": text(lt.get("intent_key"))}


def dispatch_vars(reads: L.Reads, it: dict, sit: dict) -> dict[str, Any]:
    """commDispatchVars_ for a correction: commDispatchBaseVars_ with no bindings; its lead is its own words, so
    commRepairLead_ joins nothing."""
    name = text(it.get("name"))
    return {"first_name": re.split(r"\s+", name)[0] if name else "", "name": name, "expires": text(it.get("expires")),
            "days_left": "", "credential": SK.credential_label(reads, sit), "items": "0",
            "sender": text(sit.get("sender")) or SC.SENDER_DEFAULT, "correction": text(it.get("correction")),
            "status_at": "", "token": reply_token(it.get("intent_key"))}


def is_doubt(error: Any) -> bool:
    """commRecordIsDoubt_: which transport answers mean 'we do not know' rather than 'no'."""
    e = text(error).lower()
    if not e:
        return False
    if e in ("transport", "threw", "provider_bad_shape") or re.fullmatch(r"provider_5\d\d", e):
        return True
    if re.fullmatch(r"provider_4\d\d", e):
        return False
    return e not in ("opted_out", "missing_param", "no_provider_key", "no_sending_line", "undeclared_method",
                     "test_redirect_no_sms", "test_redirect_no_email")


# ---- everything one pass needs in order to speak ------------------------------------------------------------------

def context(reads: L.Reads) -> dict[str, Any]:
    """commRepairContext_: read once — the people, the routes and consent (when a route is asked), test mode, the dial,
    the hours, the words of the correction."""
    local = reads.now.astimezone(NY)
    ctx: dict[str, Any] = {"now_iso": gsjs.iso(reads.now), "now_ms": now_ms(reads), "said": 0, "spoken": set(),
                           "local_hour": local.hour, "local_day": local.isoweekday() % 7, "people": people(reads),
                           "routes": lambda: reads.once("comm_repair:routes", lambda: routes(reads)),
                           "consent": lambda: reads.once("comm_repair:consent", lambda: consent(reads)),
                           "purpose_ok": purpose_declared(), "test": test_mode(reads), "dial": dial_word(reads)}
    ctx["quiet"] = {"from": policy(reads, "quiet_from"), "to": policy(reads, "quiet_to")}
    ctx["can_say"] = True
    ctx["situation"] = situation_now(reads)
    ctx["channels"] = channels(ctx["situation"]) if ctx["situation"] else ["sms", "email"]
    return ctx


# ---- what changed, and who holds the old words --------------------------------------------------------------------

def situation_any(reads: L.Reads, sid: Any) -> dict | None:
    """commRepairSituation_: the situation row by id, whether or not it is on."""
    want = gsjs.trim(text(sid))
    return SCD.situation_last(SCD.situations(reads), want) if want else None


def drift(reads: L.Reads, frm: Any, to: Any) -> dict[str, Any]:
    """commRepairDrift_: do people hold words we would no longer say? Computable only when the evidence in the window
    says what was said."""
    from_ms, to_ms = ms(frm, 0), ms(to, now_ms(reads))
    carries = {c: False for c in NEEDED_COLUMNS}
    in_window = 0
    groups: dict[str, dict[str, Any]] = {}
    for r in attempt_rows(reads):
        at = ms(r.get("at"), 0)
        if not at or at < from_ms or at > to_ms:
            continue
        in_window += 1
        for c in NEEDED_COLUMNS:
            if cell(r.get(c)):
                carries[c] = True
        sit = gsjs.trim(text(r.get("situation")))
        if not sit:
            continue
        sha, sender = gsjs.trim(text(r.get("words_sha"))), gsjs.trim(text(r.get("sender_used")))
        if not sha and not sender:
            continue
        k = sit + "|" + sha + "|" + sender
        g = groups.get(k)
        if g is None:
            g = groups[k] = {"situation": sit, "words_sha": sha, "sender_used": sender, "people": {},
                             "first_at": text(r.get("at")), "last_at": text(r.get("at")), "redirected": 0,
                             "test_mode": 0}
        if text(r.get("redirected")) == "yes":
            g["redirected"] += 1
            continue
        if text(r.get("test_mode")) == "yes":
            g["test_mode"] += 1
            continue
        who = lkey(r.get("person_key"))
        if who:
            g["people"][who] = text(r.get("at"))
        if text(r.get("at")) < g["first_at"]:
            g["first_at"] = text(r.get("at"))
        if text(r.get("at")) > g["last_at"]:
            g["last_at"] = text(r.get("at"))
    if not carries["situation"] or (not carries["words_sha"] and not carries["sender_used"]):
        return {"computable": False, "attempts_in_window": in_window, "needs_columns": list(NEEDED_COLUMNS),
                "why": "no attempt row in this window says what was said. The columns (" + ", ".join(NEEDED_COLUMNS) +
                       ") exist, but every row here predates them or was written by a caller that did not go through "
                       "commRecordSend_, and a blank is an unknown rather than an agreement. The audience half "
                       "(commRepairAudience_) is the honest answer for a window like this: a person declares the "
                       "situation and the window, and the platform counts exactly who holds it."}
    changed = []
    for k in js_keys(groups):
        g = groups[k]
        sit = situation_any(reads, g["situation"])
        if sit is None:
            continue
        now_sha, now_sender = words_sha(sit), SW.sender_of(sit)
        sender_moved = bool(g["sender_used"] and g["sender_used"] != now_sender)
        words_moved = bool(g["words_sha"] and g["words_sha"] != now_sha)
        if not sender_moved and not words_moved:
            continue
        held = js_keys(g["people"])
        if not held:
            continue
        changed.append({"situation": g["situation"], "audience": len(held), "people": held,
                        "window_from": g["first_at"], "window_to": g["last_at"], "sender_then": g["sender_used"],
                        "sender_now": now_sender, "words_sha_then": g["words_sha"], "words_sha_now": now_sha,
                        "what_moved": ("the sender and the words" if words_moved else "the sender") if sender_moved
                        else "the words", "dropped_redirected": g["redirected"], "dropped_test": g["test_mode"]})
    return {"computable": True, "attempts_in_window": in_window, "changed": changed,
            "limit": "this proves the words CHANGED and who holds the old ones. It cannot know the old ones were wrong "
                     "— a person declares that, and the audience is already counted."}


def lead_vars(reads: L.Reads, it: dict, corr: dict, incident: dict) -> dict[str, Any]:
    """commRepairLeadVars_: the catalogue's words, rendered with this person's name and what was wrong."""
    name = text((it or {}).get("name"))
    return {"first_name": re.split(r"\s+", name)[0] if name else "", "name": name, "expires": "", "days_left": "",
            "credential": SK.credential_label(reads, corr or {}), "items": "0",
            "correction": text((incident or {}).get("what_was_wrong")), "sender": SW.sender_of(corr or {})}


def repair_scan(sess: L.Session, payload: dict) -> dict[str, Any]:
    """commRepairScan: what changed and who holds the old words; with a situation, its audience in the window."""
    if not SCD.is_writer(sess.user):
        return dict(WRITER_DENIED)
    reads = sess.reads
    p = payload if isinstance(payload, dict) else {}
    sid, frm, to = s_(p.get("situation")), s_(p.get("from")), s_(p.get("to"))
    out: dict[str, Any] = {"drift": drift(reads, frm, to), "priority": priority(reads),
                           "gates": "priority paces; it never permits. The opt-out list, the dial, the send switch and "
                                    "the test redirect are asked exactly as they are for an ask.",
                           "purpose_declared": purpose_declared()}
    if sid:
        out["audience"] = audience(reads, sid, frm, to)
    return {"status": 200, "data": SCD.wire(out)}


def repair_board(sess: L.Session, payload: dict) -> dict[str, Any]:
    """commRepairBoard: the incidents and who inside them is still owed a word, the claims read as they settle (a read
    writes no ending: the next pass keeps it)."""
    if not SCD.is_writer(sess.user):
        return dict(WRITER_DENIED)
    reads = sess.reads
    want = s_((payload or {}).get("incident_id"))
    incidents, owed, in_flight, undelivered, collapsed = [], [], [], [], []
    rows = settle_all(reads, house_rows(reads), now_ms(reads), None)
    for r in rows:
        kind = text(r.get("kind"))
        if kind == "incident":
            if not want or text(r.get("incident_id")) == want:
                incidents.append(r)
            continue
        if kind != "person" or (want and text(r.get("incident_id")) != want):
            continue
        st = text(r.get("claim_state")) or "planned"
        if st == "repaired":
            continue
        if st == "undeliverable":
            undelivered.append(r)
            continue
        if st == "claimed":
            in_flight.append(r)
            continue
        if text(r.get("test_claim_state")) == "collapsed":
            collapsed.append(r)
        owed.append(r)
    return {"status": 200, "data": SCD.wire({
        "incidents": incidents, "owed": owed, "in_flight": in_flight, "undeliverable": undelivered,
        "collapsed_in_test": collapsed, "still_owed": owed_count(rows), "purpose_declared": purpose_declared(),
        "priority": priority(reads),
        "reading": "owed = nobody has taken them. in_flight = a claim is held and settles itself from the evidence. "
                   "collapsed_in_test = the testers' group number saw one message for the whole incident, and these "
                   "people are still owed the real one."})}


# ---- the look -----------------------------------------------------------------------------------------------------

def repair_due(sess: L.Session, payload: dict) -> dict[str, Any]:
    """commRepairDue: the relay's look before it rings the pass — the people still owed (the question commRepairSweep
    asks before it sweeps) and the continuation pending, in place of the one-shot trigger. `due` names the door:
    continue (a continuation is due), sweep (somebody is owed), or none."""
    if (sess.user or {}).get("is_service") is not True:
        return dict(DENIED)
    reads = sess.reads
    owed = owed_now(reads)
    wake = num(state(reads, WAKE_KEY))
    wake = wake if wake == wake and wake > 0 else 0
    due = "continue" if wake and wake <= now_ms(reads) else ("sweep" if owed > 0 else "")
    return {"status": 200, "data": {"ready": True, "owed": owed, "wake_at": iso_ms(wake) if wake else "",
                                    "due": due}}


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {
    "commRepairDue": repair_due, "commRepairScan": repair_scan, "commRepairBoard": repair_board}
# HUB_POLICY's roles and params (hubPolicyGate_); the lane's own look is the relay's
POLICY: dict[str, dict[str, Any]] = {
    "commRepairDue": {},
    "commRepairScan": {"roles": ("admin", "manager"),
                       "params": {"situation": "string", "from": "string", "to": "string"}},
    "commRepairBoard": {"roles": ("admin", "manager"), "params": {"incident_id": "string"}}}
