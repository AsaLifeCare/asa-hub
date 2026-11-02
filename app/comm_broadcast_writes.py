"""Staff Broadcast's writes (CommBroadcast.gs) on Python, each broadcast a row in Postgres (app/resource_rows.py): a
send re-resolves its audience, refuses one that changed since the preview, keeps its row and raises one text per
recipient through Smart Comms (staffBroadcastSend); a pass stopped at its budget is continued by its writer or anybody
above (staffBroadcastContinue); once withdrawn, nobody not yet asked is asked (staffBroadcastWithdraw). A send inside
the quiet window contacts nobody: the row itself is held, and the relay's clock carries it once the window is over
(staffBroadcastCarry) unless it was withdrawn first. staffBroadcastsUpload brings the broadcast house into Postgres as
the app is given to Python, and hands it back as it returns to Apps Script."""
from __future__ import annotations

import hashlib
import json
import logging
import math
import time
from datetime import datetime, timezone
from typing import Any, Callable

import comm_broadcast as CB
import gsjs
import locations as L
import resource_rows as RR
import smart_comms as SC
import smart_comms_desk as SCD
import writes as W
from scope import Defer
from writes import Decision

log = logging.getLogger("asa-hub-app")

RESOURCE = CB.RESOURCE
LANE = "broadcast"
# inside the write's own budget, with room left for the resolve and the row
BUDGET_S = 5.0
LIVE = ("held_quiet", "carrying", "partial", "interrupted")
OUTCOMES = ("sent", "recorded", "held", "refused", "failed", "pending", "withdrawn")
NOT_YOURS = "Only the person who wrote it, or a director, administrator or the master, may {} a broadcast."

s_ = gsjs.str_
text = SCD.text


def _now_iso() -> str:
    """new Date().toISOString(): the moment itself, never the request's."""
    return gsjs.iso(datetime.now(timezone.utc))


def _cell(v: Any) -> str:
    """serialize_: what a cell holds once the row is written."""
    if v is None:
        return ""
    if isinstance(v, (dict, list)):
        return json.dumps(v, separators=(",", ":"), ensure_ascii=False)
    return W.sheet_text(v)


def _rows(reads: L.Reads) -> list[dict]:
    """Every broadcast Postgres holds; Defer while the house is not uploaded yet."""
    if not RR.uploaded(reads.db, RESOURCE):
        raise Defer("the broadcasts are not in Postgres yet: the app is uploaded as it is given to Python")
    return SCD.broadcast_rows(reads)


def _find(reads: L.Reads, bid: str) -> dict | None:
    """commBroadcastFind_."""
    hit = None
    for r in _rows(reads):
        if gsjs.js_str(r.get("id")) == bid:
            hit = r
    if hit is not None and not isinstance(hit.get("recipients"), list):
        hit["recipients"] = []
    return hit


def _put(reads: L.Reads, row: dict, by: str) -> None:
    """commBroadcastPut_: a new row in the house's order, a known one changed in place."""
    now = W.now_iso(reads)
    row["updatedAt"] = now
    hit = RR.find(reads, RESOURCE, gsjs.js_str(row["id"]))
    if hit is None:
        row.setdefault("createdAt", now)
        RR.create(reads, RESOURCE, {h: _cell(row.get(h)) for h in CB.HEADER}, by)
        return
    RR.update(reads, RESOURCE, hit[0], hit[1], {h: _cell(row[h]) for h in CB.HEADER if h in row}, by)


def _id(email: str, client_id: str) -> str:
    """commBroadcastId_: the sender and the page's key, so a double press is one broadcast."""
    return "BC_" + hashlib.md5((email.lower() + "|" + client_id).encode("utf-8")).hexdigest()[:16]


def _key(row: dict, r: dict) -> str:
    return "bc_" + gsjs.js_str(row.get("id")) + "_" + s_(r.get("k"))


def _already(reads: L.Reads, row: dict, spec: dict, w: dict) -> dict[str, Any]:
    """commBroadcastAlready_."""
    def norm(v: Any) -> str:
        return gsjs.trim(CB._lines(v))
    differs = ""
    if norm(row.get("audience")).lower() != norm(spec["audience"]).lower():
        differs = "the audience"
    elif norm(row.get("house")) != norm(spec["house"]):
        differs = "the house"
    elif (gsjs.or_text(row.get("meddel")) == "yes") != bool(spec["meddel"]):
        differs = "the Med Del filter"
    elif norm(row.get("message")) != norm(spec["message"]):
        differs = "the message"
    elif norm(row.get("signature")) != norm(spec["signature"]):
        differs = "the signature"
    if differs:
        return {"status": 409, "message": "This page's key already carried a different broadcast (" + differs +
                                          " changed) — nothing was sent. Review it again and send."}
    return {"status": 200, "data": {"already": True, "broadcast": SCD.broadcast_public(reads, row, w, True)}}


def _tally(row: dict) -> dict[str, int]:
    """commBroadcastTally_."""
    t = {k: 0 for k in OUTCOMES}
    for r in row.get("recipients") or []:
        o = SCD.outcome_of(r)
        if o in t:
            t[o] += 1
    row.update(t)
    row["count"] = len(row.get("recipients") or [])
    return t


def _ending(t: dict[str, int]) -> str:
    """commBroadcastEnding_: never "sent" for what a brake held."""
    parts = []
    if t["sent"]:
        parts.append(f"{t['sent']} sent")
    if t["recorded"]:
        parts.append(f"{t['recorded']} recorded in the mock outbox — nobody contacted")
    if t["held"]:
        parts.append(f"{t['held']} held by a brake — nothing sent")
    if t["refused"]:
        parts.append(f"{t['refused']} refused (asked us to stop)")
    if t["failed"]:
        parts.append(f"{t['failed']} failed")
    if t["withdrawn"]:
        parts.append(f"{t['withdrawn']} withdrawn")
    return " · ".join(parts) or "nothing to send"


def _outcome(ans: dict[str, Any]) -> dict[str, Any]:
    """commBroadcastOutcome_ over Smart Comms' answer: a quiet-window answer stays pending."""
    st, held, why = s_(ans.get("state")), s_(ans.get("held")), s_(ans.get("why"))
    if st == "held" and held == "quiet":
        return {"o": "pending", "quiet": True, "w": "held by the quiet window"}
    if st == "held" and held == "recorded":
        return {"o": "recorded", "w": why}
    if st == "held" and held == "test_mode":
        return {"o": "recorded", "w": "test mode: a row in the mock outbox, nobody contacted"}
    if st == "sent":
        return {"o": "sent", "w": ""}
    if st == "already":
        return {"o": "sent", "w": "already sent under this broadcast"}
    if st == "refused" and why.startswith("This person asked us to stop"):
        return {"o": "refused", "w": "asked us to stop"}
    if st in ("held", "refused"):
        return {"o": "held", "w": why or held or "a brake held it"}
    return {"o": "failed", "w": why or "the send door refused"}


def _send_one(row: dict, r: dict, body: str) -> dict[str, Any]:
    """commBroadcastSendOne_: one copy through Smart Comms, under the broadcast's own key for this number."""
    group = bool(r.get("g"))
    team: Any = "group" if group else s_(r.get("f")).startswith("cc")
    return SC.raise_situation(None, situation=CB.SITUATION, to=s_(r.get("t")), vars={}, key=_key(row, r),
                              person="" if group else s_(r.get("n")), person_key=s_(r.get("k")), lane=LANE,
                              at_ms=int(time.time() * 1000), prune=False, team=team, body=body)


def _loop(row: dict, sit: dict, started: float, budget_s: float = BUDGET_S) -> dict[str, Any]:
    """commBroadcastSendLoop_: resumable, each copy under its own key."""
    lst = row.get("recipients") or []
    res: dict[str, Any] = {"asked": 0, "quiet": False, "stopped": "", "sent_any": False}
    n = SCD.js_number(row.get("next_index")) if row.get("next_index") not in (None, "") else 0
    i = max(0, int(n) if not math.isnan(n) else 0)
    while i < len(lst):
        r = lst[i]
        if SCD.outcome_of(r) != "pending":
            i += 1
            continue
        if res["asked"] >= CB.MAX:
            res["stopped"] = f"the cap of {CB.MAX} copies"
            break
        if time.monotonic() - started > budget_s:
            res["stopped"] = f"the {round(budget_s)}-second budget"
            break
        got = _outcome(_send_one(row, r, CB.render(sit.get("sms_text"), CB.vars_of(row, r))))
        if got.get("quiet"):
            res["quiet"] = True
            break
        r["o"] = got["o"]
        if got["w"]:
            r["w"] = got["w"][:120]
        else:
            r.pop("w", None)
        res["asked"] += 1
        if r["o"] == "sent":
            res["sent_any"] = True
        i += 1
    row["next_index"] = i
    t = _tally(row)
    if not t["pending"]:
        row["state"], row["finished_at"], row["why"] = "done", _now_iso(), _ending(t)
    elif res["quiet"]:
        row["state"] = "held_quiet"
    else:
        row["state"] = "partial"
        row["why"] = (f"{t['pending']} not asked yet — the pass stopped at {res['stopped'] or 'its budget'}; Continue "
                      "sends the rest, and a copy that already left is never sent twice")
    return res


def _unowe(row: dict, why: str) -> None:
    """The texts still owed to the recipients not asked: never sent while the broadcast says they were not."""
    tx = (SC._WRITE.get() or {}).get("tx")
    if tx is None:
        return
    for r in row.get("recipients") or []:
        if SCD.outcome_of(r) == "pending":
            SC.cancel_owed(tx, _key(row, r), why)


def _hold(row: dict) -> None:
    """commBroadcastHoldForMorning_: the row itself is what is owed — the clock's first pass after the window sends it,
    and a copy the window caught mid-pass waits with it rather than in the outbox."""
    _unowe(row, "held with its broadcast for the morning")
    _tally(row)
    row["state"] = "held_quiet"
    row["why"] = (f"held by the quiet window ({SCD.quiet_words()}): nobody was contacted — the first pass after "
                  f"{SCD.QUIET_TO} sends it, unless it is withdrawn first")


def _after(row: dict, run: dict | None) -> None:
    """commBroadcastAfterPass_'s line."""
    t = _tally(row)
    log.info("broadcast %s · %s · by %s · %s · %s%s", gsjs.js_str(row.get("id")), s_(row.get("audience_label")),
             s_(row.get("by_name")), s_(row.get("state")), _ending(t), f" · {t['pending']} pending" if t["pending"]
             else "")


def _mock_moved(row: dict, d: dict) -> str:
    """commBroadcastMockMoved_: a broadcast confirmed as a mock never goes real after test mode turns off."""
    stamped = gsjs.or_text(row.get("dial"))
    was_mock = gsjs.or_text(row.get("test_mode")) == "on" or (stamped != "" and stamped != "send")
    if not was_mock or not d["readable"] or d["word"] != "send":
        return ""
    return ("Confirmed while test mode was on, and test mode is off now — the rest was never sent, so a line written as "
            "a test cannot reach real phones; write it again to send it to people")


def _stop(row: dict, why: str, each: str = "") -> None:
    """commBroadcastStop_."""
    _unowe(row, why)
    row["state"] = "stopped"
    for r in row.get("recipients") or []:
        if SCD.outcome_of(r) == "pending":
            r["o"], r["w"] = "held", (each or why)[:120]
    _tally(row)
    row["why"] = why
    row["finished_at"] = _now_iso()


def _unsure(row: dict) -> str:
    """An interrupted pass was Apps Script's: the receipts that stop a second text are not Python's to see."""
    pending = sum(1 for r in row.get("recipients") or [] if SCD.outcome_of(r) == "pending")
    unsure = min(pending, SCD.COMM_BROADCAST_MARK_EVERY - 1)
    return (f"This pass was cut short by the platform before this one, whose receipts that stop a second text are not "
            f"readable here — "
            f"up to {unsure} of the {pending} not marked may already have it, so it is not continued. Withdraw it, and "
            "reach the rest another way if it still matters.")


def _dial(reads: L.Reads) -> dict[str, Any]:
    try:
        return SCD.dial(reads.config())
    except Exception:  # noqa: BLE001 - an unread switch is no answer, never a guess
        return {"word": "off", "readable": False}


DIAL_UNREAD = ("The test-mode switch could not be read, and a broadcast does not go out on a guess — try again in a "
               "minute.")


def _ok(data: dict[str, Any]) -> Decision:
    return Decision({"status": 200, "data": data}, subject="", own=True)


# ---- the doors -----------------------------------------------------------------------------------------------------

def send(sess: L.Session, payload: dict) -> Decision:
    """staffBroadcastSend: re-resolves and refuses a changed audience, keeps the row, then one text per copy."""
    started = time.monotonic()
    reads = sess.reads
    p = payload if isinstance(payload, dict) else {}
    bad = CB.required(p, ("audience", "message", "client_id", "audience_sha"))
    if bad:
        return Decision(bad)
    w = CB.who(reads, sess.user)
    if not w["ok"]:
        return Decision(CB.denied(w))
    spec = CB.spec_of(p)
    problem = CB.text_problem(spec["message"], spec["signature"])
    if problem:
        return W.refuse(400, problem)
    client_id = text(p.get("client_id"))
    if len(client_id) < 8:
        return W.refuse(400, "The page sends its own key with a broadcast; this one carried none.")
    sit = CB.situation(reads)
    if sit is None:
        return W.refuse(409, SCD.broadcast_situation_state(reads)["why"])
    if not reads.db.house_moved(CB.TAB):
        return W.refuse(503, "The broadcast house is not minted yet, and a broadcast is never sent without its row — "
                             "tools/mint_comm_broadcasts_house.py mints it.")
    d = _dial(reads)
    if not d["readable"]:
        return W.refuse(503, DIAL_UNREAD)
    bid = _id(w["email"], client_id)
    existing = _find(reads, bid)
    if existing is not None:
        return Decision(_already(reads, existing, spec, w))
    aud = CB.resolve(reads, spec, w, sess.user, sit)
    if aud["refused"]:
        return W.refuse(403, aud["refused"])
    if not aud["readable"]:
        return W.refuse(503, " · ".join(aud["why"]) or "the audience could not be resolved")
    if not aud["entries"]:
        return W.refuse(409, "This audience resolves to nobody this platform may text.")
    if len(aud["entries"]) > CB.MAX:
        return W.refuse(409, f"{len(aud['entries'])} recipients is over the {CB.MAX} this lane allows — a resolver "
                             "that went wrong, never a list that grew.")
    if CB.sha(aud["entries"]) != s_(p.get("audience_sha")):
        return _ok({"changed": True, "sent_nothing": True, "preview": CB.preview_out(reads, spec, aud, sit, w)})
    shape = {"message": spec["message"], "signature": spec["signature"], "by_name": w["name"], "house": spec["house"],
             "audience_label": aud["label"]}
    most = CB.longest(sit, shape, aud["entries"])
    if SC._len16(most) > CB.SMS_MAX:
        return W.refuse(400, f"With the words on the Desk around it the text would be {SC._len16(most)} characters, "
                             f"over the provider's {CB.SMS_MAX}. Shorten it.")
    warnings = CB.reason_hits(reads, spec["message"] + "\n" + spec["signature"]) \
        if CB.AUDIENCES[spec["audience"]]["staff"] else []
    recipients = []
    for e in aud["entries"]:
        r = {"n": e["name"], "t": e["to"], "k": e["key"], "f": e["from"], "o": "pending"}
        if e["group"]:
            r["g"] = 1
        recipients.append(r)
    row: dict[str, Any] = {
        "id": bid, "client_id": client_id, "by_email": w["email"], "by_name": w["name"],
        "by_badges": ",".join(w["badges"]), "audience": spec["audience"], "audience_label": aud["label"],
        "house": spec["house"], "meddel": "yes" if spec["meddel"] else "", "message": spec["message"],
        "signature": spec["signature"], "body_sample": CB.render(sit.get("sms_text"), CB.vars_of(shape, recipients[0])),
        "state": "sending", "test_mode": SCD.broadcast_mode(reads)["test_mode"], "dial": d["word"], "why": "",
        "warnings": ", ".join(warnings),
        "dropped": [{"reason": x["reason"], "label": x["label"], "count": x["count"]} for x in aud["dropped"]],
        "recipients": recipients, "next_index": 0, "audience_sha": CB.sha(aud["entries"]),
        "withdrawn_by": "", "withdrawn_at": "", "finished_at": ""}
    _tally(row)
    run = None
    if SCD.quiet_now(reads):
        _hold(row)
    else:
        run = _loop(row, sit, started)
        if run["quiet"]:
            _hold(row)
    _put(reads, row, w["email"])
    _after(row, run)
    return _ok({"broadcast": SCD.broadcast_public(reads, row, w, True)})


def _mine(sess: L.Session, p: dict, verb: str) -> tuple[dict, dict] | Decision:
    """The session's broadcast by id: its writer's, or anybody above."""
    bad = CB.required(p, ("id",))
    if bad:
        return Decision(bad)
    w = CB.who(sess.reads, sess.user)
    if not w["ok"]:
        return Decision(CB.denied(w))
    row = _find(sess.reads, text(p.get("id")))
    if row is None:
        return W.refuse(404, "No broadcast with that id.")
    if not w["above"] and SCD.lower(row.get("by_email")) != w["email"]:
        return W.refuse(403, NOT_YOURS.format(verb))
    return w, row


def resume(sess: L.Session, payload: dict) -> Decision:
    """staffBroadcastContinue: from where a stopped pass stopped; the writer or anybody above."""
    started = time.monotonic()
    reads = sess.reads
    got = _mine(sess, payload if isinstance(payload, dict) else {}, "continue")
    if isinstance(got, Decision):
        return got
    w, row = got
    sit = CB.situation(reads)
    if sit is None:
        return W.refuse(409, SCD.broadcast_situation_state(reads)["why"])
    d = _dial(reads)
    if not d["readable"]:
        return W.refuse(503, DIAL_UNREAD)
    if SCD.quiet_now(reads):
        return W.refuse(409, f"Inside the quiet window ({SCD.quiet_words()}) nothing reaches a person — continue after "
                             f"{SCD.QUIET_TO}.")
    state = SCD.broadcast_state(row, SCD.now_ms(reads))
    if state == "interrupted":
        return _ok({"refused": _unsure(row), "broadcast": SCD.broadcast_public(reads, row, w, True)})
    if state not in ("partial", "carrying"):
        return _ok({"refused": f"this broadcast is {state} — nothing to do",
                    "broadcast": SCD.broadcast_public(reads, row, w, True)})
    moved = _mock_moved(row, d)
    if moved:
        _stop(row, moved, "confirmed while test mode was on — never sent")
        _put(reads, row, w["email"])
        _after(row, None)
        return _ok({"refused": moved, "broadcast": SCD.broadcast_public(reads, row, w, True)})
    run = _loop(row, sit, started)
    if run["quiet"]:
        _hold(row)
    _put(reads, row, w["email"])
    _after(row, run)
    return _ok({"broadcast": SCD.broadcast_public(reads, row, w, True)})


def withdraw(sess: L.Session, payload: dict) -> Decision:
    """staffBroadcastWithdraw: recipients not yet asked are never asked."""
    reads = sess.reads
    got = _mine(sess, payload if isinstance(payload, dict) else {}, "withdraw")
    if isinstance(got, Decision):
        return got
    w, row = got
    state = SCD.broadcast_state(row, SCD.now_ms(reads))
    if state not in LIVE:
        return _ok({"refused": f"this broadcast is {state} — there is nothing left to withdraw",
                    "broadcast": SCD.broadcast_public(reads, row, w, True)})
    _unowe(row, "the broadcast was withdrawn")
    for r in row["recipients"]:
        if SCD.outcome_of(r) == "pending":
            r["o"], r["w"] = "withdrawn", "withdrawn before it was sent"
    row["state"], row["withdrawn_by"], row["withdrawn_at"] = "withdrawn", w["name"], _now_iso()
    t = _tally(row)
    row["why"] = (f"withdrawn by {w['name']} — {t['withdrawn']} never asked"
                  + (" · before that: " + _ending(t) if t["sent"] or t["recorded"] else ""))
    _put(reads, row, w["email"])
    log.info("broadcast %s withdrawn · %s", gsjs.js_str(row.get("id")), row["why"])
    return _ok({"broadcast": SCD.broadcast_public(reads, row, w, True)})


def carry(sess: L.Session, payload: dict) -> Decision:
    """commBroadcastQuietCarry_ for the relay's clock: a broadcast the quiet window held, sent once it is over."""
    started = time.monotonic()
    if (sess.user or {}).get("is_service") is not True:
        return W.refuse(403, "The carry is the relay's alone.")
    reads = sess.reads
    bid = text((payload or {}).get("id"))
    row = _find(reads, bid) if bid else None
    if row is None:
        return _ok({"state": "stale", "why": "the broadcast is no longer in its house"})
    state = s_(row.get("state"))
    if state == "withdrawn":
        return _ok({"state": "stale", "why": "withdrawn by " + (s_(row.get("withdrawn_by")) or "its author")
                                             + " — nobody was contacted"})
    if state not in CB.HELD_STATES:
        return _ok({"state": "stale", "why": f"nothing left to carry — it is {state}"})
    if SCD.quiet_now(reads):
        return _ok({"state": "kept", "why": "the quiet window still holds it"})
    d = _dial(reads)
    if not d["readable"]:
        return _ok({"state": "kept", "why": "the test-mode switch could not be read — kept for the next pass"})
    by = "asa-hub:comm-broadcast"
    sit = CB.situation(reads)
    if sit is None:
        _stop(row, f"the situation `{CB.SITUATION}` was switched off or lost its words overnight — nobody was "
                   "contacted", "the row was switched off overnight")
        _put(reads, row, by)
        return _ok({"state": "stale", "why": row["why"]})
    moved = _mock_moved(row, d)
    if moved:
        _stop(row, moved, "confirmed while test mode was on — never sent")
        _put(reads, row, by)
        _after(row, None)
        return _ok({"state": "stale", "why": row["why"]})
    run = _loop(row, sit, started)
    if row["state"] == "partial":
        row["state"] = "carrying"
        row["why"] = f"{row['pending']} still to send — the clock's next pass continues it"
    elif run["quiet"]:
        _hold(row)
    _put(reads, row, by)
    _after(row, run)
    return _ok({"state": "carried", "why": gsjs.js_str(row["id"]) + ": " + _ending(_tally(row))})


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {
    "staffBroadcastSend": send, "staffBroadcastContinue": resume, "staffBroadcastWithdraw": withdraw,
    "staffBroadcastCarry": carry, "staffBroadcastsUpload": RR.upload_door({RESOURCE: {"tab": CB.TAB}})}
# every signed-in session may ask; the door decides by badge
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
BUSY_OF: dict[str, dict[str, Any]] = {a: {"status": 409, "message": "Another broadcast is being written at this "
                                                                    "moment — try again."} for a in ACTIONS}


class Store(RR.Store):
    """app.broadcast_writes and app.broadcast_receipts, beside the other apps' own; the rows app.resource_rows'."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="broadcast", label="Staff Broadcast")
