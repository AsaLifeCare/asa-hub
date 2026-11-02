"""Smart Comms' data-only doors beside the Desk save (app/smart_comms_writes.py), decided off asa-hub-db: the Replies
verdict (CommQualify.gs commContributionVerdict) kept in app.edits — a settled reply with the demands it answers
closed, and its thread answered when none is left open."""
from __future__ import annotations

import hashlib
import re
from typing import Any, Callable

import book_ops as BO
import gsjs
import house_tables as HT
import hubdb
import locations as L
import scope as sc
import smart_comms_desk as D
import smart_comms_writes as SW
import writes as W
from scope import Defer
from writes import Decision

ACTION = "commContributionVerdict"
EDITION = "smartComms.replies"
EDITION_APP = SW.EDITION_APP
# the pack key the relay reads again after a kept verdict
SUBJECT = "replies"
CONTRIBUTIONS = D.COMM_CONTRIBUTIONS_HOUSE
OBSERVATIONS = "comm_observations"
# CommQualify.gs HUB_POLICY.commContributionVerdict: its roles, and its params in their declared order
ROLES = ("admin", "director", "manager")
PARAMS = (("id", True, "string"), ("verdict", True, "string"), ("note", False, "string"))
# CommQualify.gs COMM_CONTRIBUTION_VERDICTS
VERDICTS = ("settled", "not_settled", "dismissed")
# CommRecord.gs COMM_OBSERVATIONS_HEADER
OBSERVATION_HEADER = ("event_id", "type", "actor", "subject_type", "subject_key", "subject_name", "intent_key",
                      "payload", "source", "at", "tenant")
OBSERVATION_PAYLOAD_MAX = 2000
OBSERVATION_KEY_BODY = 80
ACTOR_DEFAULT = "asa-hub:comm"
# the cells commContributionSave_ upserts beside the id (commRecordUpsert_ stamps updatedAt)
SAVED = ("state", "verdict", "verdict_by", "verdict_at", "note", "close", "closed_at", "updatedAt")

POLICY_REFUSAL = "This action is for " + " or ".join(ROLES) + "."
DENIED = "Requires an admin or manager account"
NEED = "A contribution id and a verdict (settled · not_settled · dismissed) are required."
NO_SUCH = "No such contribution."
SETTLE_HELD = ("Settling a reply closes the items it answers, and that stays with an admin, a director or a manager "
               "— nothing was saved.")
COLUMN_HELD = "The replies sheet lacks a column this verdict writes ({}) — nothing was saved."
WITHHELD_HELD = ("A cell this verdict writes is withheld from the Hub's copy, so it is changed on the sheet itself — "
                 "nothing was saved.")
SETTLED_NOTE = "settled by the demand's owner"
DEMANDS_SEP = " · "

EDITIONS: tuple[dict[str, str], ...] = (
    {"id": EDITION, "app": EDITION_APP, "app_name": "Smart Comms",
     "label": "Replies — not settled or dismissed",
     "description": ("Give a reply on the Replies page its verdict: not settled (it stays open, waiting for the "
                     "item's owner) or dismissed (filed as read, closing nothing). The verdict is kept in the Hub's "
                     "database and carried to the replies sheet. Settling a reply closes the items it answers, so it "
                     "stays with an admin, a director or a manager.")},
)

_WITHHELD = re.compile(r"^\[withheld")


# ---- who may give a verdict ------------------------------------------------------------------------------------------

def holds(sess: L.Session) -> bool:
    """The edition lists this person, and App Control opens Smart Comms to them."""
    user = sess.user or {}
    if not user or user.get("is_service"):
        return False
    if not sc.edition_allows(EDITION, user, sess.reads.config()):
        return False
    try:
        got = sc.profile_app_gate(SW.APP_ID, user, sess.reads.scope_sources())
    except (Defer, hubdb.Unreadable):
        raise
    except Exception:  # noqa: BLE001 - a gate that throws is shut
        return False
    return got.get("open") is True


def is_owner(user: dict[str, Any] | None) -> bool:
    """The handler's own rule: an admin, a director or a manager."""
    return bool(user) and gsjs.js_str((user or {}).get("role")) in ROLES


def replies_powers(sess: L.Session) -> dict[str, bool]:
    """What the Replies page may offer this viewer: a verdict, the settling one, and whether an edition opened it."""
    owner = is_owner(sess.user)
    holder = not owner and holds(sess)
    return {"verdict": owner or holder, "settle": owner, "edition": holder}


# ---- what JavaScript does to the payload -----------------------------------------------------------------------------

def js_type(v: Any) -> str:
    """Array.isArray(v) ? 'array' : typeof v."""
    if isinstance(v, list):
        return "array"
    if isinstance(v, bool):
        return "boolean"
    if isinstance(v, (int, float)):
        return "number"
    if isinstance(v, str):
        return "string"
    return "object"


def param_refusal(p: dict[str, Any]) -> str:
    """hubPolicyGate_'s params: a required one missing, or one of the wrong type; '' when every one passes."""
    for key, required, kind in PARAMS:
        v = p.get(key)
        missing = v is None or (isinstance(v, str) and v == "")
        if required and missing:
            return f"Missing required parameter: {key}."
        if not missing and js_type(v) != kind:
            return f"{key} must be {kind}, got {js_type(v)}."
    return ""


def record_id(key: str) -> str:
    """commRecordId_: the key's MD5, its first eight bytes in upper-case hex."""
    return hashlib.md5(key.encode("utf-8")).hexdigest()[:16].upper()


def utf16_len(s: str) -> int:
    return len(s.encode("utf-16-le", "surrogatepass")) // 2


# ---- the houses ------------------------------------------------------------------------------------------------------

def house_of(reads: L.Reads, tab: str) -> hubdb.Resolved:
    """hubTabSheet_ of a comm house, as the Replies read resolves it (its own table once kept there); a house with no
    tab in the copy defers."""
    res = D.house_where(reads, tab)
    D.must_book(res, tab)
    if res.ref is None:
        raise Defer(f"{tab} holds no tab in the copy yet")
    return res


def heads_of(ref: hubdb.TabRef, names: tuple[str, ...]) -> dict[str, Any] | None:
    """Each name's header exactly as the house writes it (ensureHeader_ keys); None when one is missing."""
    have = {gsjs.js_str(h): h for h in ref.headers}
    if any(n not in have for n in names):
        return None
    return {n: have[n] for n in names}


# ---- the door --------------------------------------------------------------------------------------------------------

def settle(reads: L.Reads, row: Any, intent_key: str, by: str, note: str, now: str,
           edits: list[dict]) -> tuple[list[str], tuple[str, ...]]:
    """The settled verdict's closing: each open binding of the thread whose demand the reply answers settled, and the
    thread answered when none is left open; (the demands closed, the books it rests on)."""
    import comm_record as CR  # noqa: PLC0415 - comm_record reads this module's trail header
    import comm_record_writes as CRW  # noqa: PLC0415 - and so through it

    demands: list[str] = []
    for d in (CR.text(row("awaiting")).split(DEMANDS_SEP) + CR.text(row("claims")).split(DEMANDS_SEP)):
        d = gsjs.trim(d)
        if d and d not in demands:
            demands.append(d)
    bindings_house = CRW.House(reads, CR.BINDINGS_HOUSE, edits)
    bindings = [b for b in bindings_house.rows if gsjs.or_blank(b.get("intent_key")) == intent_key]
    closed: list[str] = []
    for b in bindings:
        demand = gsjs.or_blank(b.get("demand_id"))
        if demand not in demands or (CR.text(b.get("binding_state")) or "open") == "settled":
            continue
        bid = gsjs.or_blank(b.get("id"))
        if not bid:
            continue
        bindings_house.upsert({"id": bid, "binding_state": "settled", "qualified_by": by, "qualified_at": now,
                               "note": note or SETTLED_NOTE})
        closed.append(demand)
    still_open = sum(1 for b in bindings if (CR.text(b.get("binding_state")) or "open") == "open"
                     and gsjs.or_blank(b.get("demand_id")) not in closed)
    intents_house = CRW.House(reads, CR.INTENTS_HOUSE, edits)
    thread = None
    for r in intents_house.rows:
        if gsjs.or_blank(r.get("intent_key")) == intent_key and gsjs.or_blank(r.get("state")) != "superseded":
            thread = r
    if thread is not None and not still_open and gsjs.or_blank(thread.get("id")):
        intents_house.upsert({"id": gsjs.or_blank(thread.get("id")), "state": "answered"})
    return closed, (bindings_house.sid, intents_house.sid)


def contribution_verdict(sess: L.Session, payload: dict) -> Decision:
    """commContributionVerdict: refused, or kept in app.edits — not settled, dismissed, or settled with the demands it
    answers closed. The reply's last row of its id is read and its first one written, as Apps Script did."""
    p = payload if isinstance(payload, dict) else {}
    user = sess.user
    owner = is_owner(user)
    holder = not owner and holds(sess)
    if not owner and not holder and user and not user.get("is_service"):
        return W.refuse(403, POLICY_REFUSAL)
    bad = param_refusal(p)
    if bad:
        return W.refuse(400, bad)
    if not owner and not holder:
        return W.refuse(403, DENIED)
    pid, verdict = gsjs.str_(p.get("id")), gsjs.str_(p.get("verdict"))
    if not pid or verdict not in VERDICTS:
        return W.refuse(400, NEED)

    reads = sess.reads
    house = house_of(reads, CONTRIBUTIONS)
    trail = house_of(reads, OBSERVATIONS)
    fresh: tuple[str, ...] = (house.sheet_id, trail.sheet_id)
    idh = next((h for h in house.ref.headers if gsjs.js_str(h) == "id"), None)
    hits: list[tuple[int, dict]] = []
    for rn, raw in D.house_rows(reads, house.ref) if idh is not None else ():
        v = hubdb.typed(raw.get(idh), "hub")
        if v is not None and v != "" and gsjs.js_str(v) == pid:
            hits.append((rn, raw))
    if not hits:
        return W.refuse(404, NO_SUCH, fresh=fresh)
    if verdict == "settled" and not owner:
        return W.refuse(403, SETTLE_HELD, fresh=fresh)
    try:
        W.gate(reads)
    except W.GateHeld as held:
        return W.refuse(409, held.answer["message"])
    except Defer:
        return W.refuse(503, SW.ARMED_HELD)

    heads = heads_of(house.ref, ("intent_key", "person_key", "person_name") + SAVED)
    obs_heads = heads_of(trail.ref, OBSERVATION_HEADER)
    if heads is None or obs_heads is None:
        named = {gsjs.js_str(h) for h in house.ref.headers}
        lacking = [n for n in ("intent_key", "person_key", "person_name") + SAVED if n not in named]
        return W.refuse(500, COLUMN_HELD.format(", ".join(lacking) or "the trail's"), fresh=fresh)
    _rn, first = hits[0]
    _rn_last, last = hits[-1]
    have = {gsjs.js_str(h): h for h in house.ref.headers}

    def cell(name: str) -> Any:
        """The reply as Apps Script read it: the last row of its id."""
        return hubdb.typed(last.get(have[name]), "hub") if name in have else None

    now = W.now_iso(reads)
    by = gsjs.str_((user or {}).get("email"))
    note = gsjs.str_(p.get("note"))
    intent_key = gsjs.or_text(cell("intent_key"))
    edits: list[dict] = []
    closed: list[str] = []
    if verdict == "settled":
        closed, books = settle(reads, cell, intent_key, by, note, now, edits)
        fresh = fresh + books
    ended = verdict in ("settled", "dismissed")
    # not_settled leaves the row open; the endings are stamped as a person's close, never the machine's
    want = {"state": verdict if ended else "awaiting_owner", "verdict": verdict, "verdict_by": by,
            "verdict_at": now, "note": note, "close": "person" if ended else "",
            "closed_at": now if ended else "", "updatedAt": now}
    cells = {k: v for k, v in want.items() if not W.same_cell(first.get(heads[k]), v, "header")}
    before = {k: gsjs.or_blank(hubdb.typed(first.get(heads[k]), "raw")) for k in cells}
    if any(_WITHHELD.match(before[k]) or _WITHHELD.match(v) for k, v in cells.items()):
        return W.refuse(403, WITHHELD_HELD, fresh=fresh)

    # commObserve_: one trail row, its payload as JSON.stringify writes it
    otype = verdict if ended else "contribution"
    said = {"demands": closed, "by": by, "contribution": pid} if verdict == "settled" else \
        {"verdict": verdict, "by": by, "contribution": pid}
    body = W.json_text(said)
    if utf16_len(body) > OBSERVATION_PAYLOAD_MAX:
        body = SW.js_slice(body, OBSERVATION_PAYLOAD_MAX)
    event_id = "cmo_" + record_id(f"{otype}|{intent_key}|{now}|{SW.js_slice(body, OBSERVATION_KEY_BODY)}")
    observation = {"event_id": event_id, "type": otype, "actor": by or ACTOR_DEFAULT, "subject_type": "person",
                   "subject_key": gsjs.or_text(cell("person_key")), "subject_name": gsjs.or_text(cell("person_name")),
                   "intent_key": intent_key, "payload": body, "source": "desk", "at": now, "tenant": ""}

    edition = "" if owner else EDITION
    edits.append(W.kept_record(trail.sheet_id, trail.ref.tab, "append", W.COLS + "event_id", event_id, SUBJECT,
                               observation, edition=edition))
    # its own table lays an edit by id on the first row of the id, as commRecordUpsert_ wrote it
    if len(hits) == 1 or isinstance(house.ref, HT.KeptRef):
        edits.append(W.kept_record(house.sheet_id, house.ref.tab, "edit", "id", pid, SUBJECT, cells, before=before,
                                   edition=edition))
    elif cells:
        # an id on more than one row, which no kept edit tells apart: commRecordUpsert_ wrote the first
        spec = {"match": "id", "key": pid, "which": "first", "cells": cells, "before": before}
        if edition:
            spec["editions"] = [edition]
        BO.queue([{"op": "cells", "sheet_id": house.sheet_id, "tab": house.ref.tab, "spec": spec}], SW.EVENT,
                 W.who(user), ACTION)
    answer = {"status": 200, "data": {"id": pid, "verdict": verdict, "settled": closed}}
    d = W.final(answer, edits, SUBJECT, edition=edition)
    d.fresh = fresh
    return d


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {ACTION: contribution_verdict}
# HUB_POLICY names admin, director and manager; the door answers that sentence itself, so a listed holder reaches it
POLICY: dict[str, dict[str, Any]] = {ACTION: {"roles": ()}}
# the platform's write lock held by another write: never a 409
BUSY_OF: dict[str, dict[str, Any]] = {ACTION: {"status": 503, "message": SW.BUSY}}
