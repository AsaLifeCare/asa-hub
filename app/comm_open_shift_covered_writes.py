"""openShiftCovered (CommOpenShiftCovered.gs) on Python, the relay's door: each fill it hands over answered under the
platform's write lock — the fill stamped on the call-off rows it follows first (so an ask the quiet window still holds
is dropped at 08:00), every ending written on the row (commRecordUpsert_ as app.edits records of the call-off house),
the follow-up claimed before a word leaves, then a copy to each person the URGENT OPEN SHIFT reached through the one
send door (comms_rpc.call, rpcCall_'s answers under Apps Script's own idempotency keys) and the ledger line written. A
dial that does not hand over writes the words into the rehearsal book and the mock outbox instead. A pass starts no row
after its budget: those come back in `left`, for the relay's next pass."""
from __future__ import annotations

import json
import re
import time
from datetime import datetime, timezone
from typing import Any, Callable

import comm_record_writes as CRW
import comm_rehearsal as CRH
import comm_repair as CRP
import comms_rpc as CRPC
import gsjs
import hotline_calloff as HCO
import hubdb
import locations as L
import comm_open_shift_covered as OSC
import resource_rows as RR
import smart_clock as SK
import smart_comms as SC
import smart_comms_desk as SCD
import smart_comms_writes as SW
import staff_views
from scope import Defer
from writes import Decision

DENIED = {"status": 403, "message": "Requires an admin or manager account"}
BUSY = "Another write holds the platform's lock; the relay offers the fills again."
ACTOR = "asa-hub:comm"
# COMM_CALLOFF_BLAST_BUDGET_MS, bounded by the write's own budget: a write decided too late keeps nothing
BLAST_BUDGET_S = 5.0

t = OSC.t
s_ = gsjs.str_


class Calls:
    """The call-off house as commCallOffRows_ reads it under the lock (a later row with an id replaces the earlier;
    none when it cannot be read), each commRecordUpsert_ kept as an app.edits record and laid over what this pass
    reads next."""

    def __init__(self, reads: L.Reads, edits: list[dict]) -> None:
        try:
            self.house: CRW.House | None = CRW.House(reads, SCD.COMM_CALLOFF_HOUSE, edits)
        except (Defer, hubdb.Unreadable):
            self.house = None
        self.rows: dict[str, dict] = {}
        for r in self.house.rows if self.house else ():
            rid = gsjs.or_text(r.get("id"))
            if rid:
                self.rows[rid] = dict(r)

    def put(self, matched: list[dict], patch: dict[str, Any]) -> bool:
        """openShiftCoveredPut_: the patch on each row, by id."""
        ok = True
        for c in matched or ():
            rid = gsjs.js_str(c.get("id"))
            try:
                if self.house is None:
                    raise Defer("the call-off house holds no tab in the copy")
                self.house.upsert({"id": rid, **patch})
            except Exception:  # noqa: BLE001 - a lost row write never costs the pass
                ok = False
                continue
            row = self.rows.get(rid)
            if row is not None:
                row.update(patch)
        return ok


def end(calls: Calls, matched: list[dict], state: str, why: str, count: Any, env: dict, rehearsal: bool) -> None:
    """openShiftCoveredEnd_: the ending in the production cell (the rehearsal's own when it was one), its words and
    when."""
    cols = OSC.COLS
    patch: dict[str, Any] = {cols["test"] if rehearsal else cols["prod"]: state,
                             cols["why"]: (OSC.REHEARSAL_MARK if rehearsal else "") + SW.js_slice(s_(why), OSC.WHY_MAX),
                             cols["at"]: env["now_iso"]}
    if count is not None:
        patch["covered_count"] = str(count)
    calls.put(matched, patch)


def claim(calls: Calls, rid: str, test: bool, now_iso: str) -> bool:
    """commCallOffClaim_(…, 'covered'): a compare-and-set under the write lock, taken before a word is rendered."""
    cols = OSC.COLS
    row = calls.rows.get(rid)
    if not row:
        return False
    col = cols["test"] if test else cols["prod"]
    if gsjs.or_text(row.get(col)) not in OSC.CLAIMABLE:
        return False
    nxt: dict[str, Any] = {col: "claimed", "test_mode": "yes" if test else "no"}
    if not test:
        nxt[cols["at"]] = now_iso
    return calls.put([row], nxt)


def copy_to(reads: L.Reads, dest: Any, sit: dict, vals: dict, reason: str, idem: str,
            chans: list[str]) -> dict[str, Any]:
    """commCallOffCopyTo_: one address, one message, and the answer read rather than assumed."""
    out: dict[str, Any] = {"sent": False, "redirected": False, "why": ""}
    d = gsjs.trim(gsjs.or_text(dest))
    if not d:
        out["why"] = "an empty entry"
        return out
    try:
        if "@" in d:
            if "email" not in chans:
                out["why"] = SW.js_slice(d, 30) + ": an e-mail address, and this row has no written letter to send"
                return out
            name = "emailSend"
            p = {"to": d, "subject": SC.render(sit.get("email_subject"), vals),
                 "body": SC.render(OSC.either(sit.get("email_text"), sit.get("sms_text")), vals), "reason": reason}
        else:
            if "sms" not in chans:
                out["why"] = SW.js_slice(d, 20) + ": a number, and this row has no written text to send"
                return out
            num = SCD.team_copy_number(d)
            if not num:
                out["why"] = SW.js_slice(d, 20) + " is neither an e-mail nor a number we may text"
                return out
            name = "smsSend"
            p = {"to": num, "body": SC.render(sit.get("sms_text"), vals), "reason": reason}
        res = CRPC.refused_contract(name, p) or CRPC.call(reads, name, p, {"idempotency_key": idem})
    except Exception as exc:  # noqa: BLE001 - one copy failing is said on the row
        out["why"] = SW.js_slice(d, 20) + ": " + type(exc).__name__
        return out
    if res.get("redirected"):
        out["redirected"] = True
        out["why"] = SW.js_slice(d, 20) + ": test mode — the testers heard it, not this audience"
    elif res.get("ok") and (res.get("sent") or res.get("deduplicated")):
        out["sent"] = True
    elif res.get("ok") and res.get("gated"):
        out["why"] = SW.js_slice(d, 20) + ": held at the send door (" + \
            (gsjs.or_text(res.get("reason")) or gsjs.or_text(res.get("detail")) or "gated") + ")"
    else:
        out["why"] = SW.js_slice(d, 20) + ": " + \
            (gsjs.or_text(res.get("error")) or gsjs.or_text(res.get("detail")) or "the send door refused")
    return out


def one(reads: L.Reads, r: dict, env: dict, calls: Calls, held: CRH.Held, begun: float) -> dict[str, Any]:
    """openShiftCoveredOne_: one fill, from the call-off it follows to the people that call-off reached."""
    res: dict[str, Any] = {"id": t(r.get("id")), "state": "", "why": "", "count": ""}

    def done(state: str, why: str, count: Any = None) -> dict[str, Any]:
        res.update(state=state, why=gsjs.or_text(why), count="" if count is None else str(count))
        return res

    if not res["id"] or not t(r.get("col_iso")) or not t(OSC.either(r.get("called_off_by"), r.get("open_row"))):
        return done("refused", "not a row this door knows — it needs the shift, its day and the call-off it came from")
    m = OSC.match(r, env["rows"])
    if not m["rows"]:
        # the pool may learn of a call-off before the hotline pass records it
        return done("nobody_heard" if m["ambiguous"] else "not_yet", m["why"])
    cols = OSC.COLS
    # stamped first, even in the quiet window, so a held ask is dropped at 08:00
    filled_at = t(r.get("filled_at")) or env["now_iso"]
    calls.put([c for c in m["rows"] if not t(c.get("covered_filled_at"))], {"covered_filled_at": filled_at})
    already = [c for c in m["rows"] if (t(c.get(cols["prod"])) and t(c.get(cols["prod"])) != "planned")
               or (t(c.get(cols["test"])) and t(c.get(cols["test"])) != "planned")]
    if already:
        return done("duplicate", "this shift's \"covered\" already ended `"
                    + (t(already[0].get(cols["prod"])) or t(already[0].get(cols["test"])))
                    + "` — one follow-up per shift")
    end_ms = gsjs.date_parse(t(r.get("shift_end")))
    filled = OSC.filled_words(r)
    if end_ms is not None and end_ms <= env["now_ms"]:
        stale = f"the shift ({t(r.get('col_iso'))}) is over — nobody is told it is covered"
        end(calls, m["rows"], "stale", stale + " · " + filled, None, env, False)
        return done("stale", stale)
    h = OSC.heard(m["rows"], env["now_ms"])
    if h["heard"] == "sending":
        return done("not_yet", "its URGENT OPEN SHIFT is still being sent — the follow-up waits for it to finish")
    if h["heard"] == "deferred":
        drop = (f"the URGENT OPEN SHIFT was still held for {SC.QUIET_TO} and is dropped instead: the shift is covered, "
                "nobody is asked and nobody needs telling")
        end(calls, h["deferred"], "ask_dropped", drop + " · " + filled, None, env, False)
        return done("ask_dropped", drop)
    if env["quiet"]:
        return done("refused_quiet", OSC.quiet_refusal())
    if h["heard"] == "none":
        none = " · ".join(h["why"]) or "its URGENT OPEN SHIFT reached nobody"
        end(calls, m["rows"], "nobody_heard", none + " — so nobody is told it is covered · " + filled, None, env,
            False)
        return done("nobody_heard", none + " — so nobody is told it is covered")
    if h["heard"] == "unknown" or not h["audience"]:
        unknown = ((" · ".join(h["why"]) or "its URGENT OPEN SHIFT kept no audience")
                   + " — nobody new is ever texted, so nobody is told it is covered")
        end(calls, m["rows"], "unknown_audience", unknown + " · " + filled, None, env, False)
        return done("unknown_audience", unknown)
    sit = env["sit"]
    if not sit:
        off = f"the situation `{OSC.SITUATION}` is off on the Desk or has no text to send"
        end(calls, m["rows"], "held", off + " · " + filled, None, env, False)
        return done("held", off)
    if not env["dial_readable"]:
        return done("dial_unknown", "the sending dial could not be read: nothing is said, and the relay asks again")
    vals = OSC.vars_of(r, sit, env["now"])
    if not vals["house"] and not vals["day_word"]:
        return done("refused", "the follow-up could not say which shift — no house and no day")
    sit_now = OSC.words(sit, vals)
    n = len(h["audience"])
    lead = m["rows"][0]
    instance = t(lead.get("instance")) or t(lead.get("id"))
    person = t(lead.get("person_name"))

    def with_name(a: dict) -> dict[str, str]:
        o = dict(vals)
        o["name"] = t(a.get("name"))
        o["first_name"] = re.split(r"\s+", o["name"])[0] or ""
        return o

    if env["dial"] != "send":
        held_why = CRH.dial_held_why(env["dial"], n, "the people this call-off's URGENT OPEN SHIFT reached") + \
            " · " + filled
        try:
            held.held({"channel": "sms", "to": ", ".join(a["to"] for a in h["audience"]), "situation": OSC.SITUATION,
                       "intent_key": f"CO|{instance}|covered", "person_key": t(lead.get("person_key")),
                       "person_name": person, "purpose": OSC.SUBJECT_PURPOSE, "sender_used": vals["sender"],
                       "verdict": "recorded", "reasons": held_why,
                       "body": SC.render(sit_now.get("sms_text"), with_name(h["audience"][0])),
                       "reason": "call off: " + OSC.SITUATION, "pass_by": OSC.PASS_BY})
            wrote = 1
        except Exception:  # noqa: BLE001 - the row says the rehearsal could not be written
            wrote = 0
        end(calls, m["rows"], "recorded", held_why, f"0/{n}", env, False)
        return done("recorded", f"the sending dial stands at `{env['dial']}`: {n} resolved and NOBODY WAS CONTACTED"
                    + (" — the words are in the rehearsal book and the mock outbox" if wrote
                       else " — and the rehearsal row could not be written"), f"0/{n}")
    if h["heard"] != "real":
        never = ("its URGENT OPEN SHIFT reached only the testers, in test mode" if h["heard"] == "testers"
                 else "its URGENT OPEN SHIFT was only written down while the dial held it")
        never += " — nobody was asked, so nobody is told it is covered"
        end(calls, m["rows"], "nobody_heard", never + " · " + filled, None, env, False)
        return done("nobody_heard", never)
    # asked again: one post can span a minute or more
    if OSC.quiet_now():
        return done("refused_quiet", OSC.quiet_refusal())
    claimed = [c for c in m["rows"] if claim(calls, gsjs.js_str(c.get("id")), env["test"], env["now_iso"])]
    if not claimed:
        return done("duplicate", "already claimed by another pass — one follow-up per shift")
    rehearsal = bool(env["test"])
    end(calls, claimed, "sending", f"sending to {n} · {filled}", f"0/{n}", env, rehearsal)
    chans = HCO.channels_with_words(sit_now)
    stopped, why = "", ""
    sent = redirected = asked = 0
    idem = "osc_" + SW.js_slice(gsjs.js_str(claimed[0].get("id")), 40) + "_"
    for i, a in enumerate(h["audience"]):
        if i >= OSC.BLAST_MAX:
            stopped = f"the cap of {OSC.BLAST_MAX} copies"
            break
        if time.time() - begun > BLAST_BUDGET_S:
            stopped = f"the {round(BLAST_BUDGET_S)}-second budget"
            break
        if OSC.quiet_now():
            stopped = f"the quiet window ({SC.QUIET_WORDS})"
            break
        got = copy_to(reads, a["to"], sit_now, with_name(a), "call off: " + OSC.SITUATION,
                      idem + HCO.address_key(a["to"]), chans)
        asked += 1
        if got["sent"]:
            sent += 1
        if got["redirected"]:
            redirected += 1
        elif not got["sent"] and len(why) < 400:
            why += (" · " if why else "") + gsjs.or_text(got["why"])
    if stopped and asked == 0:
        back = f"the pass stopped at {stopped} before its first copy — nothing was said"
        night = OSC.quiet_now()
        end(calls, claimed, "planned", back + " · " + filled, None, env, rehearsal)
        return done("refused_quiet" if night else "not_yet",
                    back + ", and the relay offers it again" + (f" at {SC.QUIET_TO}" if night else ""))
    state = OSC.ending(sent, redirected, asked)
    if state == "nobody":
        state = "held"
    said = f"{sent} of {n} told" + (f", {redirected} rehearsed at the testers" if redirected else "")
    if stopped:
        not_told = asked - sent - redirected
        if sent > 0 or redirected > 0:
            state = "partial"
        said = (f"{n} reached by the ask: {sent} told" + (f", {redirected} rehearsed at the testers" if redirected
                                                           else "")
                + (f", {not_told} held, refused or failed at the send door" if not_told > 0 else "")
                + f", {n - asked} NEVER ASKED — the pass stopped at {stopped} and a follow-up is never retried (the "
                  "ones already told would hear it twice)")
    end(calls, claimed, state, said + (" · " + why if why else "") + " · " + filled, f"{sent}/{n}", env, rehearsal)
    if sent > 0 or redirected > 0:
        key = f"CO|{instance}|covered"
        rehearsed = not sent and redirected
        SC.record_ledger(SK.rehearsal_key(key) if rehearsed else key, OSC.SITUATION, person, t(r.get("col_iso"))[:10],
                         "rehearsal" if rehearsed else "sms", reads.db)
    return done(state, said + (" · " + why if why else ""), f"{sent}/{n}")


def covered(sess: L.Session, payload: dict) -> Decision:
    """openShiftCovered: the open-shift fills the relay hands over, one result for every row it starts; the rows this
    pass did not start come back in `left`."""
    user = sess.user or {}
    if not sess.user or (user.get("is_service") is not True and gsjs.js_str(user.get("role")) != "admin"):
        return Decision(dict(DENIED))
    data = payload if isinstance(payload, dict) else {}
    rows = data["rows"][:OSC.MAX_ROWS] if isinstance(data.get("rows"), list) else []
    out: dict[str, Any] = {"results": [], "counts": {}, "dial": "", "left": []}
    if not rows:
        return Decision({"status": 200, "data": out})
    reads = sess.reads
    now = datetime.now(timezone.utc)
    try:
        dial = SCD.dial(reads.config())
    except Exception:  # noqa: BLE001 - an unreadable dial is `dial_unknown`, never `off`
        dial = {"word": "off", "readable": False}
    try:
        test = CRP.test_mode(reads)
    except Exception:  # noqa: BLE001 - commTestMode_ answers false on a throw
        test = False
    try:
        sits = SC.read_situations(reads.db)
    except Exception:  # noqa: BLE001 - an unread house has no situation on
        sits = []
    edits: list[dict] = []
    calls = Calls(reads, edits)
    held = CRH.Held(reads, edits)
    env = {"now": now, "now_ms": now.timestamp() * 1000.0, "now_iso": gsjs.iso(now), "quiet": OSC.quiet_now(),
           "dial": s_(dial.get("word")) or "off", "dial_readable": dial.get("readable") is not False,
           "test": bool(test), "rows": calls.rows, "sit": OSC.situation(sits)}
    out["dial"] = env["dial"] if env["dial_readable"] else "unknown"
    begun = time.time()
    for i, raw in enumerate(rows):
        r = raw if isinstance(raw, dict) else {}
        if i and time.time() - begun > OSC.START_BUDGET_S:
            out["left"] = rows[i:]
            break
        try:
            res = one(reads, r, env, calls, held, begun)
        except Exception as exc:  # noqa: BLE001 - the row answers failed and the relay offers it again
            res = {"id": t(r.get("id")), "state": "failed", "count": "",
                   "why": "the lane threw: " + type(exc).__name__}
        out["counts"][res["state"]] = out["counts"].get(res["state"], 0) + 1
        out["results"].append(res)
    held.say_capped()
    staff_views.record({"email": ACTOR}, "open_shift_covered",
                       f"{len(out['results'])} fill(s): " + json.dumps(out["counts"], separators=(",", ":")))
    kept = [e for e in edits if e and e.get("cells")]
    return Decision({"status": 200, "data": out}, edits=kept or None, subject="", own=True)


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {"openShiftCovered": covered}
POLICY: dict[str, dict[str, Any]] = {"openShiftCovered": {}}
BUSY_OF: dict[str, dict[str, Any]] = {"openShiftCovered": {"status": 409, "message": BUSY}}


class Store(RR.Store):
    """app.open_shift_covered_writes and _receipts; the call-off rows, the rehearsal book and the mock outbox
    app.edits', the messages Smart Comms' outbox's."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="open_shift_covered", label="The covered-shift follow-up")
