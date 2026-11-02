"""The comms repair pass carried (comm_repair reads and judges): under the platform's write lock, CommRepair.gs
commRepairRun_ — the claims settled, each confirmed incident's audience planned row by row, whoever may be spoken to now
claimed and told through the one send door, every ending written as Apps Script wrote it (the house, the evidence and
the trail as kept edits in app.edits, the ledger line as smartRecord_ kept it, the owed count and the continuation in
app.comm_repair_state). A pass stops after a few seconds and says what it left; the relay rings the next one.
commRepairSweep is the backstop door; commRepairContinue is the continuation the one-shot trigger fired;
commRepairDeclare and commRepairConfirm are a person's (confirming carries the head, path A's first few); the save's
correction is on_words_changed, and path B's lead is lead(), each for its caller's own write."""
from __future__ import annotations

import time
from datetime import datetime, time as dtime, timedelta, timezone
from typing import Any, Callable

import comm_repair as CP
import comms_rpc as CR
import gsjs
import hubdb
import locations as L
import resource_rows as RR
import smart_clock as SK
import smart_comms as SC
import smart_comms_desk as SCD
import smart_comms_writes as SW
import staff_views
import writes as W
from gsjs import NY
from scope import Defer
from writes import Decision

# a pass's own budget inside the write's seven seconds (COMM_REPAIR_RUN_MS was one execution's)
PASS_S = 4.0
ACTOR = "asa-hub:comm"
BUSY = "Another write holds the platform's lock; the repair pass rings again."
DENIED = {"status": 403, "message": "Requires an admin or manager account"}
NO_HOUSE = ("`" + CP.HOUSE + "` has no house yet. Mint it (the comm houses' own tool) before declaring an incident — a "
            "tab invented in HUB_DB would be orphaned the day the pointer answers.")

s_ = gsjs.str_
text = CP.text


class NoHouse(Exception):
    """commRepairUpsert_'s refusal to invent the house inside HUB_DB."""


def _now_iso() -> str:
    """new Date().toISOString(): the moment itself."""
    return gsjs.iso(datetime.now(timezone.utc))


def log_line(actor: str, action: str, detail: str, status: int = 200) -> None:
    """hubSysLog_."""
    staff_views.record({"email": actor, "display_name": actor}, action, detail, status)


# ---- the house as this pass leaves it -----------------------------------------------------------------------------

class House:
    """commRepairUpsert_ over the house: one kept edit per row (an appended row whole, a copied row's cells by id), and
    the pass's own later reads (a claim, the stamp) answered from what it wrote."""

    def __init__(self, reads: L.Reads, rows: list[dict]) -> None:
        self.res = SCD.where(reads, CP.HOUSE)
        self.rows = [dict(r) for r in rows]
        self.by_id: dict[str, dict] = {}
        for r in self.rows:
            rid = gsjs.or_blank(r.get("id"))
            if rid and rid not in self.by_id:
                self.by_id[rid] = r
        self.copied = set(self.by_id)
        self.cells: dict[str, dict[str, Any]] = {}

    def upsert(self, row: dict[str, Any]) -> None:
        """commRepairUpsert_: by id; a person's cells and the pass's own each kept, nothing else touched."""
        if self.res.ref is None and not self.res.declared_house:
            raise NoHouse(NO_HOUSE)
        rid = text(row.get("id"))
        row = dict(row)
        now = _now_iso()
        row["updatedAt"] = now
        found = self.by_id.get(rid)
        if found is None:
            row["createdAt"] = row.get("createdAt") or now
            found = self.by_id[rid] = {}
            self.rows.append(found)
        self.cells.setdefault(rid, {}).update(row)
        found.update(row)

    def mark(self, incident_id: Any, person_key: Any, state: str, fields: dict | None, test: bool) -> bool:
        """commRepairMark_: the ending of one person's repair."""
        if state not in CP.PERSON_STATES:
            return False
        row: dict[str, Any] = {"id": CP.person_id(incident_id, person_key),
                               ("test_claim_state" if test else "claim_state"): state}
        row.update(fields or {})
        try:
            self.upsert(row)
            return True
        except NoHouse:
            return False

    def claim(self, incident_id: Any, person_key: Any, test: bool, now_iso: str, path: str, host: str) -> bool:
        """commRepairClaim_: the mark that makes 'never both' true, taken under the platform's write lock; nothing
        planned for this person, or anything but planned, is no claim."""
        rid = CP.person_id(incident_id, person_key)
        row = self.by_id.get(rid)
        if row is None:
            return False
        col, at_col = ("test_claim_state", "test_claimed_at") if test else ("claim_state", "claimed_at")
        if text(row.get(col)) not in ("", "planned"):
            return False
        try:
            self.upsert({"id": rid, col: "claimed", at_col: now_iso or _now_iso(), "claim_path": path or "A",
                         "claim_host_key": host or ""})
            return True
        except NoHouse:
            return False

    def edits(self) -> list[dict[str, Any]]:
        if not self.cells:
            return []
        sid, tab = W.where_of(self.res)
        out = []
        for rid, cells in self.cells.items():
            if rid in self.copied:
                edited = {k: v for k, v in cells.items() if k != "id"}
                out.append(W.kept_record(sid, tab, "edit", "id", rid, "", edited))
            else:
                out.append(W.kept_record(sid, tab, "append", "id", rid, "", cells))
        return out


# ---- the pass's own state (its Script Properties) -----------------------------------------------------------------

def put_state(key: str, value: str) -> bool:
    cur = RR._cur()
    try:
        with SC._guard(cur):
            cur.execute(f"insert into {CP.STATE} (key, value) values (%s, %s) on conflict (key) do update"
                        " set value = excluded.value, updated_at = now()", (key, value))
        return True
    except Exception:  # noqa: BLE001 - a property that could not be written is said by its caller
        return False


def drop_state(key: str) -> None:
    cur = RR._cur()
    try:
        with SC._guard(cur):
            cur.execute(f"delete from {CP.STATE} where key = %s", (key,))
    except Exception:  # noqa: BLE001 - at worst the continuation fires once more
        pass


def stamp(rows: list[dict]) -> int:
    """commRepairStamp_: the people still owed, counted and kept for the cheap question."""
    n = CP.owed_count(rows)
    put_state(CP.OWED_KEY, str(n))
    return n


# ---- the evidence, the trail and the ledger -----------------------------------------------------------------------

def observe(reads: L.Reads, edits: list[dict], kind: str, lt: dict, payload: dict, source: str,
            actor: str = "") -> str:
    """commObserve_: one trail row appended, never upserted; its event id, '' when it could not be kept."""
    if kind not in CP.OBSERVATION_TYPES:
        return ""
    target = SC._target(reads.db, CP.OBSERVATIONS)
    if target is None:
        return ""
    now = _now_iso()
    body = SW.js_slice(W.json_text(payload or {}), 2000)
    event_id = "cmo_" + CP.record_id(kind + "|" + text(lt.get("intent_key")) + "|" + now + "|" + SW.js_slice(body, 80))
    row = {"event_id": event_id, "type": kind, "actor": actor or ACTOR, "subject_type": "person",
           "subject_key": text(lt.get("person_key")),
           "subject_name": text(lt.get("person_name")) or text(lt.get("name")),
           "intent_key": text(lt.get("intent_key")), "payload": body, "source": source or "sweep", "at": now,
           "tenant": ""}
    edits.append(W.kept_record(target[0], target[1], "append", W.COLS + "event_id", event_id, "", row))
    return event_id


def record_attempt(reads: L.Reads, edits: list[dict], lt: dict, attempt: int, out: dict, test: bool,
                   now_iso: str) -> str:
    """commRecordAttempt_ (commAttemptRow_): the evidence row of one attempt; its id, '' when it could not be kept."""
    target = SC._target(reads.db, CP.ATTEMPTS)
    if target is None:
        return ""
    to, sha = text(out.get("to")), text(out.get("words_sha"))
    sit, sender = text(out.get("situation")), text(out.get("sender_used"))
    row = {"id": "CMA_" + CP.record_id(text(lt.get("intent_key")) + "|" + str(attempt) + "|" + now_iso),
           "intent_key": text(lt.get("intent_key")), "person_key": text(lt.get("person_key")), "attempt": attempt,
           "channel": text(out.get("channel")), "to_masked": "•••" + to[-4:] if to else "",
           "receipt": text(out.get("receipt")), "error": text(out.get("error")),
           "redirected": "yes" if out.get("redirected") else "no", "doubt": "yes" if out.get("doubt") else "no",
           "test_mode": "yes" if test else "no", "at": now_iso, "words_sha": sha, "situation": sit,
           "sender_used": sender, "words_known": "yes" if (sha or sit or sender) else "no", "createdAt": now_iso}
    edits.append(W.kept_record(target[0], target[1], "append", "id", row["id"], "", row))
    return row["id"]


def escalate(reads: L.Reads, edits: list[dict], incident_id: str, lt: dict, why: Any, test: bool) -> None:
    """commRepairEscalate_: a correction nobody can be sent is a person's job, said on the trail and in the log."""
    observe(reads, edits, "needs_human", lt, {"incident": incident_id, "reason": CP.DESK_REASON,
                                              "why": SW.js_slice(text(why), 300), "test_mode": bool(test)}, "repair")
    log_line(ACTOR, "comm_repair_undeliverable",
             (text(lt.get("person_name")) or text(lt.get("person_key"))) + " holds words we have since corrected and "
             "cannot be told by message: " + text(why) + " · incident " + text(incident_id) +
             " — a person owes them this", 500)


# ---- and then it is said ------------------------------------------------------------------------------------------

def _rpc(reads: L.Reads, name: str, params: dict, opts: dict) -> dict[str, Any]:
    """rpcCall_: the contract first, then the one send door."""
    return CR.refused_contract(name, params) or CR.call(reads, name, params, opts)


def record_send(reads: L.Reads, it: dict, sit: dict, person: dict, route: dict, attempts: int) -> dict[str, Any]:
    """commRecordSend_: one thread handed to the transport — the route's channel first, then the situation's own, each
    through rpcCall_ under the thread's idempotency key; a doubt is not a no."""
    vars_ = CP.dispatch_vars(reads, it, sit)
    order = [c for c in dict.fromkeys([text(route.get("channel"))] + CP.channels(sit)) if c]
    res: dict[str, Any] = {"sent": False, "channel": "", "redirected": False, "gated": False, "doubt": False,
                           "error": "", "receipt": "", "to": "", "words_sha": CP.words_sha(sit),
                           "situation": text(sit.get("id")) or text(it.get("situation")),
                           "sender_used": text(vars_.get("sender"))}
    reason = "comms: " + it["situation"] + " · " + it["intent_key"]
    for ch in order:
        if ch == "sms":
            to = SC.sendable(person.get("phone"))
            if not to or not s_(sit.get("sms_text")):
                continue
            if SC.unwritten_words(reads.db, sit, "sms_text"):
                res["error"] = "the text behind this situation is a generic letter nobody wrote for it — refused"
                continue
            res["to"] = to
            r = _rpc(reads, "smsSend", {"to": to, "body": SC.render(sit.get("sms_text"), vars_), "reason": reason},
                     {"idempotency_key": "ci_" + it["intent_key"] + "_" + str(attempts + 1)})
        elif ch == "email":
            if not s_(person.get("email")) or not s_(sit.get("email_subject")):
                continue
            if SC.unwritten_words(reads.db, sit, "email_subject") or SC.unwritten_words(reads.db, sit, "email_text"):
                res["error"] = ("the letter behind this situation is a generic credential e-mail nobody wrote for it "
                                "— refused")
                continue
            res["to"] = s_(person.get("email"))
            r = _rpc(reads, "emailSend", {"to": res["to"], "subject": SC.render(sit.get("email_subject"), vars_),
                                          "body": SC.render(sit.get("email_text"), vars_), "reason": reason},
                     {"idempotency_key": "ci_mail_" + it["intent_key"] + "_" + str(attempts + 1)})
        else:
            continue
        if r.get("ok") and (r.get("sent") or r.get("deduplicated")):
            res.update(sent=True, channel=ch, redirected=bool(r.get("redirected")), receipt=s_(r.get("receipt")))
            return res
        if r.get("ok") and r.get("gated"):
            res.update(gated=True, error=s_(r.get("reason")))
            return res
        if not r.get("ok"):
            res["error"] = s_(r.get("error"))
            if CP.is_doubt(res["error"]):
                res.update(doubt=True, channel=ch)
                return res
    return res


def say(reads: L.Reads, edits: list[dict], incident_id: str, lt: dict, sit: dict, person: dict, route: dict,
        test: bool, now_iso: str, incident: dict) -> dict[str, Any]:
    """commRepairSay_: through the lane's one door, written down three times — the evidence, the trail, and the
    catalogue's ledger when it was said."""
    it = CP.item(lt, sit, person, incident)
    try:
        out = record_send(reads, it, sit, person, route, 0)
    except (Defer, hubdb.Unreadable):
        raise
    except Exception as exc:  # noqa: BLE001 - a throw is a doubt: the provider may have taken it
        out = {"sent": False, "gated": False, "doubt": True, "redirected": False, "channel": text(route.get("channel")),
               "receipt": "", "error": "threw: " + (str(exc) or type(exc).__name__)}
    out["attempt_id"] = record_attempt(reads, edits, lt, 1, out, test, now_iso)
    kind = ("redirected" if out.get("redirected") else "sent") if out.get("sent") else \
        ("doubt" if out.get("doubt") else "held")
    observe(reads, edits, kind, lt, {"attempt": 1, "attempt_id": out["attempt_id"], "channel": out.get("channel"),
                                     "receipt": out.get("receipt"), "error": out.get("error"), "incident": incident_id,
                                     "purpose": CP.PURPOSE, "test_mode": bool(test)}, "repair")
    if out.get("sent"):
        key = SK.rehearsal_key(it["key"]) if out.get("redirected") else it["key"]
        SC.record_ledger(key, text(sit.get("id")), it["name"], "", "rehearsal" if out.get("redirected")
                         else text(out.get("channel")), reads.db)
    return out


def verdict_for(reads: L.Reads, lt: dict, ctx: dict) -> dict[str, Any]:
    """commRepairVerdict_: the ladder asked, the platform's hours narrowed by the person's own."""
    try:
        narrowed = CP.cortex_window(reads, ctx["routes"]().get(lt["person_key"]), ctx["quiet"]["from"],
                                    ctx["quiet"]["to"], lt["person_key"], ctx["now_ms"])
    except (Defer, hubdb.Unreadable):
        raise
    except Exception:  # noqa: BLE001 - the platform's hours stand
        narrowed = None
    return CP.plan_verdict(reads, lt, {"priority_id": CP.PURPOSE, "situation": text(ctx["situation"].get("id")),
                                       "attempts": 0, "last_ms": 0, "now_ms": ctx["now_ms"],
                                       "local_hour": ctx["local_hour"], "local_day": ctx["local_day"],
                                       "test": ctx["test"], "quiet": narrowed})


# ---- the engine ---------------------------------------------------------------------------------------------------

def spent(ctx: dict) -> bool:
    """commRepairSpent_."""
    if ctx["max_people"] and ctx["said"] >= ctx["max_people"]:
        return True
    return time.monotonic() - ctx["started"] > ctx["budget_s"]


def deliver(reads: L.Reads, house: House, edits: list[dict], incident: dict, ctx: dict, known: dict,
            stats: dict) -> dict[str, Any]:
    """commRepairDeliver_: one incident carried as far as this pass can carry it."""
    incident_id = text(incident.get("incident_id"))
    aud = CP.audience_of(reads, incident)
    existing = known.get(incident_id) or {}
    test_said = 0
    if ctx["test"]:
        test_said = sum(1 for k in existing if text(existing[k].get("test_claim_state")) in ("claimed", "repaired"))
    test = ctx["test"]
    for who in aud["people"]:
        if spent(ctx):
            stats["left_for_later"] += 1
            continue
        key = CP.lkey(who.get("person_key"))
        if not key:
            continue
        if not who.get("person_name") and ctx["people"].get(key):
            who["person_name"] = text(ctx["people"][key].get("name"))
        had = existing.get(key)
        if had is not None:
            prod = text(had.get("claim_state")) or "planned"
            mine = text(had.get("test_claim_state" if test else "claim_state")) or "planned"
            if prod != "planned" or mine != "planned":
                stats["already"] += 1
                continue
        reach = CP.reachable(reads, ctx, key) if ctx["purpose_ok"] else None
        if had is None:
            row = CP.person_row(incident_id, who, ctx["now_iso"])
            if not ctx["purpose_ok"]:
                try:
                    house.upsert(row)
                    stats["planned"] += 1
                except NoHouse:
                    break
                existing[key] = row
                continue
            if not reach["ok"]:
                row["claim_state"] = "undeliverable"
                row["undeliverable_why"] = SW.js_slice(text(reach.get("why")), 300)
                try:
                    house.upsert(row)
                    stats["undeliverable"] += 1
                except NoHouse:
                    break
                existing[key] = row
                escalate(reads, edits, incident_id, CP.light(incident_id, key, who.get("person_name")),
                         reach.get("why"), test)
                continue
            row["told_channel"] = text(reach.get("channel"))
            try:
                house.upsert(row)
                stats["planned"] += 1
            except NoHouse:
                break
            existing[key] = had = row
        elif ctx["purpose_ok"] and not reach["ok"]:
            house.mark(incident_id, key, "undeliverable",
                       {"undeliverable_why": SW.js_slice(text(reach.get("why")), 300)}, test)
            stats["undeliverable"] += 1
            escalate(reads, edits, incident_id, CP.light(incident_id, key, who.get("person_name")), reach.get("why"),
                     test)
            continue

        if not ctx["purpose_ok"] or not ctx["situation"] or not ctx["can_say"] or not reach or not reach["ok"]:
            continue
        if key in ctx["spoken"] or CP.in_breath(key, ctx["rows"], ctx["now_ms"]):
            stats["held_for_breath"] += 1
            house.mark(incident_id, key, "planned", {"note": "held: this person was told about another incident in the "
                                                             "same breath, and two apologies minutes apart is worse "
                                                             "than one late one"}, test)
            continue
        if test and test_said >= CP.TEST_CAP:
            house.mark(incident_id, key, "collapsed", {
                "undeliverable_why": "test mode: every destination is the testers' one group number, so this incident "
                                     "sends one message and no more. This person is still owed the real thing."}, True)
            stats["collapsed"] += 1
            continue
        lt = CP.light(incident_id, key, who.get("person_name"))
        verdict = verdict_for(reads, lt, ctx)
        if not verdict["send"]:
            if text(verdict.get("policy")) == "would send":
                stats["held_by_dial"] += 1
            else:
                stats["deferred"] += 1
                stats["wants_wake"] = True
            continue
        if not house.claim(incident_id, key, test, ctx["now_iso"], "A", ""):
            stats["already"] += 1
            continue
        ctx["said"] += 1
        ctx["spoken"].add(key)
        if test:
            test_said += 1
        out = say(reads, edits, incident_id, lt, ctx["situation"], reach["person"], reach, test, ctx["now_iso"],
                  incident)
        if out.get("sent"):
            stats["said"] += 1
            if out.get("redirected"):
                stats["redirected"] += 1
            house.mark(incident_id, key, "repaired", {
                "told_at": ctx["now_iso"], "told_channel": text(out.get("channel")),
                "attempt_id": text(out.get("attempt_id")), "receipt": text(out.get("receipt"))}, test)
        elif out.get("doubt"):
            stats["doubts"] += 1
            house.mark(incident_id, key, "repaired", {
                "told_at": ctx["now_iso"], "told_channel": text(out.get("channel")),
                "attempt_id": text(out.get("attempt_id")),
                "undeliverable_why": "in doubt: " + text(out.get("error")) + " — it may have landed, and a correction "
                                     "is never said twice"}, test)
        else:
            why = text(out.get("error")) or "the transport said no"
            if out.get("gated") and why != "opted_out":
                stats["gated"] += 1
                house.mark(incident_id, key, "planned", {"note": "held at the door: " + why + " — not said, not spent",
                                                         "claim_path": "", "claim_host_key": ""}, test)
                ctx["spoken"].discard(key)
                if test:
                    test_said -= 1
            else:
                stats["undeliverable"] += 1
                said = ("gated: " if out.get("gated") else "refused: ") + why
                house.mark(incident_id, key, "undeliverable", {"told_channel": text(out.get("channel")),
                                                               "attempt_id": text(out.get("attempt_id")),
                                                               "undeliverable_why": said}, test)
                escalate(reads, edits, incident_id, lt, said, test)
    try:
        house.upsert({"id": text(incident.get("id")), "audience": aud["count"] or 0})
    except NoHouse:
        pass
    return aud


def _note(stats: dict, ctx: dict, no_words: bool) -> str:
    if stats["said"]:
        return ("said — one message per incident, to the testers, and the people are still owed." if ctx["test"]
                else "said, through the same door as every other message.")
    return "nothing was said this run — " + (
        CP.PURPOSE + " is not a declared employment purpose" if not ctx["purpose_ok"]
        else "the lane's one transport door could not be asked" if not ctx["can_say"]
        else "no situation carries the correction" if no_words
        else "the dial says " + ctx["dial"] if ctx["dial"] != "send"
        else "everybody reachable is already spoken for, or deferred")


def run(reads: L.Reads, user: dict | None, started: float, budget_s: float, house: House | None = None,
        only: set[str] | None = None, max_people: int = 0) -> tuple[dict, House, list[dict]]:
    """commRepairRun_: every confirmed incident (or only those named: the fresh ones a head carries) carried as far as
    this pass can; (answer, the house as the pass leaves it, the other edits)."""
    stats = CP.new_stats()
    house = house if house is not None else House(reads, CP.house_rows(reads))
    edits: list[dict] = []
    if house.rows:
        W.gate(reads)
    rows = CP.settle_all(reads, [dict(r) for r in house.rows], CP.now_ms(reads), house.mark)
    incidents: list[dict] = []
    known: dict[str, dict[str, dict]] = {}
    for r in rows:
        kind = text(r.get("kind"))
        if kind == "incident":
            if text(r.get("state")) == "confirmed":
                incidents.append(r)
            continue
        if kind == "person":
            known.setdefault(text(r.get("incident_id")), {})[text(r.get("person_key"))] = r
    if only:
        incidents = [r for r in incidents if text(r.get("incident_id")) in only]
    if not incidents:
        stamp(rows)
        return {"status": 200, "data": {"incidents": 0, "still_owed": CP.owed_now(reads),
                                        "note": "nothing is owed."}}, house, edits

    ctx = CP.context(reads)
    ctx.update(started=started, budget_s=budget_s, max_people=max_people, rows=rows)
    read_ms = int((time.monotonic() - started) * 1000)
    for inc in incidents:
        if spent(ctx):
            stats["left_for_later"] += 1
            break
        deliver(reads, house, edits, inc, ctx, known, stats)
        stats["incidents"] += 1

    owed = stamp(house.rows)
    no_words = not ctx["situation"]
    st = stats
    log_line(s_((user or {}).get("email")) or ACTOR, "comm_repair_run",
             f"{st['incidents']} incident(s) · {st['planned']} owed a word · {st['said']} told"
             + (f" ({st['redirected']} to the testers)" if st["redirected"] else "")
             + f" · {st['deferred']} deferred (quiet hours) · {st['held_by_dial']} held by the dial · "
             + (f"{st['collapsed']} collapsed (the testers' group number) · " if st["collapsed"] else "")
             + (f"{st['held_for_breath']} held (a second incident in one breath) · " if st["held_for_breath"] else "")
             + (f"{st['gated']} held at the transport door (claim given back) · " if st["gated"] else "")
             + f"{st['undeliverable']} undeliverable — a person owes them this · "
             + (f"{st['doubts']} in doubt (claim kept) · " if st["doubts"] else "")
             + f"{st['already']} already spoken for · {owed} still owed"
             + (" · NO WORDS: no situation carries " + CP.PURPOSE + " and `" + CP.SITUATION_FLOOR + "` is absent or off"
                if no_words else "")
             + (" · TEST MODE: one message per incident to the testers' group number, and every real person is still "
                "owed" if ctx["test"] else "")
             + ("" if ctx["purpose_ok"] else " · WARNING: " + CP.PURPOSE + " is not in COMM_EMPLOYMENT_PURPOSES — "
                "nothing was said to anybody, because judging the route on that would mark a whole audience "
                "undeliverable for a missing string"))
    data = {"incidents": st["incidents"], "planned": st["planned"], "said": st["said"], "redirected": st["redirected"],
            "deferred": st["deferred"], "held_by_dial": st["held_by_dial"], "held_at_the_door": st["gated"],
            "held_for_breath": st["held_for_breath"], "collapsed": st["collapsed"], "doubts": st["doubts"],
            "undeliverable": st["undeliverable"], "already_spoken_for": st["already"],
            "left_for_later": st["left_for_later"], "still_owed": owed, "wants_wake": st["wants_wake"],
            "read_ms": read_ms, "test_mode": ctx["test"], "dial": ctx["dial"],
            "purpose_declared": ctx["purpose_ok"], "words": not no_words, "priority": CP.priority(reads),
            "note": _note(st, ctx, no_words)}
    return {"status": 200, "data": data}, house, edits


# ---- the continuation ---------------------------------------------------------------------------------------------

def wake(reads: L.Reads, when_ms: float, why: str) -> tuple[str, float]:
    """commRepairWake_: the continuation pointed at a moment (app.comm_repair_state, which the relay's look fires in
    the one-shot trigger's place); a pending one soon enough is the answer, an earlier need replaces a later one."""
    at = when_ms or CP.now_ms(reads) + 1000
    pending = CP.num(CP.state(reads, CP.WAKE_KEY))
    pending = pending if pending == pending and pending > 0 else 0
    if pending and pending <= at + 1000:
        return "a continuation is already pending for " + CP.iso_ms(pending), pending
    if not put_state(CP.WAKE_KEY, str(int(at))):
        log_line(ACTOR, "comm_repair_wake_failed", "the continuation could not be minted (its state could not be "
                 "written) — the corrections are written down and the backstop door carries them, which costs up to "
                 "an hour", 500)
        return "no continuation: its state could not be written", 0
    return "a continuation fires at " + CP.iso_ms(at) + (" — " + why if why else ""), at


def wake_for(reads: L.Reads, data: dict, progressed: bool) -> tuple[str, float]:
    """commRepairWakeFor_: when the rest should follow — at once, or the top of the morning when the hour is why."""
    more = (CP.num(data.get("left_for_later") or 0) or 0) + (CP.num(data.get("still_owed") or 0) or 0)
    if not more and not data.get("wants_wake"):
        return "nothing is left to carry", 0
    local = reads.now.astimezone(NY)
    quiet_from, quiet_to = CP.num(CP.policy(reads, "quiet_from")), CP.num(CP.policy(reads, "quiet_to"))
    h = local.hour
    in_quiet = (h >= quiet_from or h < quiet_to) if quiet_from > quiet_to else (quiet_from <= h < quiet_to)
    if not in_quiet:
        if not progressed:
            return "nothing moved and the hour is not the reason — the backstop door carries it", 0
        return wake(reads, CP.now_ms(reads) + 1000, "the rest of the audience")
    at_ms = 0.0
    if quiet_to == quiet_to and 0 <= quiet_to < 24:
        at = local.replace(hour=int(quiet_to), minute=0, second=0, microsecond=0)
        if at <= local:
            at = datetime.combine(local.date() + timedelta(days=1), dtime(int(quiet_to)), tzinfo=NY)
        # a minute past the hour, so the boundary is never read as still quiet
        at_ms = at.timestamp() * 1000.0 + 60000
    return wake(reads, at_ms, "quiet hours — the one wait a correction is allowed, and it waits as an A")


# ---- the doors ----------------------------------------------------------------------------------------------------

def _progress(data: dict) -> int:
    """What commRepairContinue counts as progress: said, planned, undeliverable."""
    return int(data.get("said") or 0) + int(data.get("planned") or 0) + int(data.get("undeliverable") or 0)


def _decision(answer: dict, house: House, edits: list[dict]) -> Decision:
    kept = house.edits()
    d = W.final(answer, kept + edits, "")
    d.own = True
    if kept:
        # a claim rests on the house as the copy holds it: a book written since the copy was made defers
        d.fresh = (house.res.sheet_id,)
    return d


def _missing(p: dict, keys: tuple[str, ...]) -> Decision | None:
    """hubPolicyGate_'s required params."""
    for k in keys:
        if p.get(k) is None or p.get(k) == "":
            return W.refuse(400, f"Missing required parameter: {k}.")
    return None


def sweep(sess: L.Session, payload: dict) -> Decision:
    """commRepairSweep: the backstop — nobody owed a word answers at once (unless forced), else one pass of the run.
    `left` is what the pass had no time for, and `again` asks the relay for the next pass (forced, as the same run)."""
    started = time.monotonic()
    user = sess.user or {}
    if not user.get("is_service") and s_(user.get("role")) != "admin":
        return Decision(dict(DENIED))
    p = payload if isinstance(payload, dict) else {}
    force = p.get("force") is True or gsjs.js_str(p.get("force")) == "true"
    reads = sess.reads
    if not force and CP.owed_now(reads) <= 0:
        return Decision({"status": 200, "data": {
            "skipped": True, "still_owed": 0,
            "why": "nobody is owed a word. This door is the backstop, not the clock — a correction goes on the "
                   "discovery that creates it, or on the front of the next message its lane sends."}},
            subject="", own=True)
    answer, house, edits = run(reads, user, started, PASS_S)
    data = answer["data"]
    data["left"] = int(data.get("left_for_later") or 0)
    data["again"] = bool(data["left"] and _progress(data))
    return _decision(answer, house, edits)


def continue_(sess: L.Session, payload: dict) -> Decision:
    """commRepairContinue: the continuation — its pending time taken down first, one pass of the run, and the next
    one pointed only when this one moved or the hour held it. `again` asks the relay for the next at once."""
    started = time.monotonic()
    if (sess.user or {}).get("is_service") is not True:
        return Decision(dict(CP.DENIED))
    reads = sess.reads
    drop_state(CP.WAKE_KEY)
    try:
        answer, house, edits = run(reads, None, started, PASS_S)
    except (Defer, hubdb.Unreadable):
        raise
    except Exception as exc:
        log_line(ACTOR, "comm_repair_continue_error", (str(exc) or type(exc).__name__) + " — the debts are written "
                 "down and the backstop door carries them", 500)
        raise
    data = answer["data"]
    progress = _progress(data)
    woke, at = "", 0.0
    if progress or data.get("wants_wake"):
        woke, at = wake_for(reads, data, progress > 0)
    data["continuation"] = woke
    data["left"] = int(data.get("left_for_later") or 0)
    data["again"] = bool(data["left"] and progress) or bool(at and at <= CP.now_ms(reads) + 5000)
    return _decision(answer, house, edits)


def declare(sess: L.Session, payload: dict) -> Decision:
    """commRepairDeclare: a person declares the mistake — a situation, the window it happened in, and what was wrong;
    the same incident declared twice is one row, never walked back."""
    p = payload if isinstance(payload, dict) else {}
    miss = _missing(p, ("situation", "from", "to", "what_was_wrong"))
    if miss is not None:
        return miss
    user = sess.user or {}
    if s_(user.get("role")) != "admin":
        return Decision(dict(DENIED))
    sid, frm, to, what = (s_(p.get(k)) for k in ("situation", "from", "to", "what_was_wrong"))
    if not sid or not frm or not to or not what:
        return W.refuse(400, "a situation, a window and what was wrong are all required — an incident nobody can "
                             "describe is one nobody can confirm")
    if CP.ms(frm, -1) < 0 or CP.ms(to, -1) < 0:
        return W.refuse(400, "the window must be two readable times")
    reads = sess.reads
    now = _now_iso()
    iid = CP.incident_id_of(sid, frm, to, what)
    house = House(reads, CP.house_rows(reads))
    already = CP.incident_by(house.rows, iid)
    if already is not None:
        aud = CP.num(already.get("audience"))
        return Decision({"status": 200, "data": {"incident_id": iid, "state": text(already.get("state")),
                                                 "audience": int(aud) if aud == aud and aud else 0,
                                                 "note": "already declared — nothing was changed"}})
    aud = CP.audience(reads, sid, frm, to)
    row = CP.incident_row(reads, {"incident_id": iid, "situation": sid, "window_from": frm, "window_to": to,
                                  "what_was_wrong": what, "state": "declared", "audience": aud["count"],
                                  "declared_by": s_(user.get("email")), "declared_at": now}, now)
    W.gate(reads)
    try:
        house.upsert(row)
    except NoHouse as exc:
        return W.refuse(500, "the incident could not be written: " + str(exc))
    stamp(house.rows)
    return _decision({"status": 200, "data": {
        "incident_id": iid, "audience": aud["count"], "dropped": aud["dropped"], "state": "declared",
        "next": "confirm it, and it goes at once — confirming mints the same one-shot continuation the save does. "
                "Nothing waits for a tick; the only wait is quiet hours, and that one ends at the top of the window."}},
        house, [])


TIMING = ("the first few are already sent. The rest follow in the continuation, which the relay's look fires — and "
          "nothing is scheduled at all beyond that. Quiet hours are the one allowed wait: a correction owed at 02:00 "
          "waits for the top of the window and goes then, still as path A.")


def confirm(sess: L.Session, payload: dict) -> Decision:
    """commRepairConfirm: confirm (it goes at once: the head here, the rest in the continuation), dismiss or close a
    declared incident; nothing nobody declared is confirmed."""
    started = time.monotonic()
    p = payload if isinstance(payload, dict) else {}
    miss = _missing(p, ("incident_id",))
    if miss is not None:
        return miss
    user = sess.user or {}
    if s_(user.get("role")) != "admin":
        return Decision(dict(DENIED))
    iid = s_(p.get("incident_id"))
    if not iid:
        return W.refuse(400, "which incident?")
    reads = sess.reads
    house = House(reads, CP.house_rows(reads))
    if CP.incident_by(house.rows, iid) is None:
        return W.refuse(404, "no incident by that id — declare it first, with the situation and the window it "
                             "happened in")
    decision = s_(p.get("decision")).lower() or "confirm"
    state = "dismissed" if decision == "dismiss" else ("closed" if decision == "close" else "confirmed")
    now = _now_iso()
    row: dict[str, Any] = {"id": "RPI_" + CP.record_id(iid), "state": state,
                           "note": SW.js_slice(s_(p.get("note")), 500)}
    if state == "confirmed":
        row.update(confirmed_by=s_(user.get("email")), confirmed_at=now)
    else:
        row["closed_at"] = now
    W.gate(reads)
    try:
        house.upsert(row)
    except NoHouse as exc:
        return W.refuse(500, str(exc))
    owed = stamp(house.rows)
    if state != "confirmed":
        return _decision({"status": 200, "data": {"incident_id": iid, "state": state, "still_owed": owed}}, house, [])
    head, house, edits = run(reads, user, started, min(CP.HEAD_S, PASS_S), house=house, only={iid},
                             max_people=CP.HEAD_PEOPLE)
    hd = head["data"]
    woke, _at = wake_for(reads, hd, True)
    return _decision({"status": 200, "data": {
        "incident_id": iid, "state": state, "still_owed": stamp(house.rows), "said": int(hd.get("said") or 0),
        "head": SCD.wire(hd), "continuation": woke, "timing": TIMING}}, house, edits)


def on_words_changed(reads: L.Reads, changes: list[dict], user: dict | None,
                     started: float) -> tuple[dict[str, Any], House | None, list[dict]]:
    """commRepairOnWordsChanged_: the second half of the save — a change declared wrong, with the sentence saying
    what, is a confirmed incident at once, and a few of the people holding the old words hear it before the screen
    comes back; the rest go in the continuation. `changes` are the save's own (smart_comms_writes: before, after,
    correct, what). (answer, the house, the other edits), for the save's own decision."""
    out: dict[str, Any] = {"discovered": 0, "incidents": [], "said": 0, "audience": 0, "skipped": [], "woke": ""}
    house: House | None = None
    if not changes:
        return out, house, []
    now = _now_iso()
    fresh: set[str] = set()
    for c in changes:
        c = c or {}
        before, after = c.get("before") or {}, c.get("after") or {}
        sid = text(after.get("id")) or text(before.get("id"))
        if not sid:
            continue
        sha_then, sha_now = CP.words_sha(before), CP.words_sha(after)
        sender_then, sender_now = SW.sender_of(before), SW.sender_of(after)
        if sha_then == sha_now and sender_then == sender_now:
            out["skipped"].append(sid + ": the words did not move")
            continue
        if not c.get("correct"):
            out["skipped"].append(sid + ": the words moved, and nothing was declared wrong — an improvement")
            continue
        what = gsjs.trim(text(c.get("what")))
        if not what:
            out["skipped"].append(sid + ": declared wrong with no sentence saying what — nothing was sent")
            continue
        iid = CP.incident_id_of(sid, sha_then, sha_now, what)
        if house is None:
            house = House(reads, CP.house_rows(reads))
            W.gate(reads)
        if CP.incident_by(house.rows, iid) is not None:
            out["skipped"].append(sid + ": this exact correction is already on the ledger")
            continue
        aud = CP.audience_by_sha(reads, sid, sha_then, sender_then)
        row = CP.incident_row(reads, {"incident_id": iid, "situation": sid, "window_from": CP.earliest(aud["people"]),
                                      "window_to": now, "words_sha_then": sha_then, "sender_then": sender_then,
                                      "what_was_wrong": what, "state": "confirmed", "audience": aud["count"],
                                      "declared_by": s_((user or {}).get("email")), "declared_at": now}, now)
        row.update(confirmed_by=s_((user or {}).get("email")), confirmed_at=now)
        try:
            house.upsert(row)
        except NoHouse as exc:
            out["skipped"].append(sid + ": the incident could not be written — " + str(exc))
            continue
        out["discovered"] += 1
        out["audience"] += aud["count"]
        out["incidents"].append({"incident_id": iid, "situation": sid, "audience": aud["count"],
                                 "what_moved": ("the sender and the words" if sender_then != sender_now
                                                else "the words") if sha_then != sha_now else "the sender"})
        fresh.add(iid)
    if not out["discovered"] or house is None:
        return out, house, []
    stamp(house.rows)
    head, house, edits = run(reads, user, started, min(CP.HEAD_S, PASS_S), house=house, only=fresh,
                             max_people=CP.HEAD_PEOPLE)
    out["said"] = int(head["data"].get("said") or 0)
    out["head"] = SCD.wire(head["data"])
    out["woke"] = wake_for(reads, head["data"], True)[0]
    return out, house, edits


# ---- path B: the front of the next message ------------------------------------------------------------------------

def lead(reads: L.Reads, house: House, it: dict | None, situation: dict | None,
         base_vars: dict | None) -> dict[str, Any] | None:
    """commRepairLead_: the oldest correction this person is owed, as the first line of the next message we send
    them — claimed (path B, the host thread's key) before it is joined, or None. The caller's write keeps the house
    (house.edits()) with its own, and sets the result as vars[smart_comms.LEAD_KEY]."""
    if not it or not situation:
        return None
    if it.get("rehearsal") or it.get("rehearsed"):
        return None
    person_key, host = CP.lkey(it.get("name_key")), text(it.get("intent_key"))
    if not person_key or not host or CP.owed_now(reads) <= 0:
        return None
    corr = CP.situation_now(reads)
    if corr is None or text(corr.get("id")) == text(situation.get("id")):
        return None
    at = CP.now_ms(reads)
    rows = [dict(r) for r in house.rows]
    owed = CP.owed_for(reads, person_key, rows, at, house.mark)
    if not owed or CP.in_breath(person_key, rows, at):
        return None
    debt = owed[0]
    v = CP.lead_vars(reads, it, corr, debt["incident"])
    sms_line, mail_line = s_(SC.render(corr.get("sms_text"), v)), s_(SC.render(corr.get("email_text"), v))
    if not sms_line and not mail_line:
        return None
    sms_live = bool(s_(situation.get("sms_text")))
    mail_live = bool(s_(situation.get("email_subject"))) and bool(s_(situation.get("email_text")))
    if not sms_live and not mail_live:
        return None
    subj = text(situation.get("email_subject"))
    if subj and (subj == text(situation.get("sms_text")) or subj == text(situation.get("email_text"))):
        return None
    if sms_live:
        if not sms_line:
            return None
        host_sms = s_(SC.render(situation.get("sms_text"), base_vars or {}))
        if SC._len16(sms_line + "\n\n" + host_sms) > CP.LEAD_SMS_MAX:
            return None
    if mail_live and not mail_line:
        return None
    iid = text(debt["incident"].get("incident_id"))
    out = {"line_sms": sms_line, "line_email": mail_line, "sms_tpl": text(situation.get("sms_text")),
           "email_tpl": text(situation.get("email_text")), "subject_tpl": text(situation.get("email_subject")),
           "incident_id": iid, "person_key": person_key, "host_key": host, "used": "", "why": ""}
    if not house.claim(iid, person_key, CP.test_mode(reads), CP.iso_ms(at), "B", host):
        return None
    return out


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {
    "commRepairSweep": sweep, "commRepairContinue": continue_, "commRepairDeclare": declare,
    "commRepairConfirm": confirm}
# HUB_POLICY's roles and param types (hubPolicyGate_; the required ones each door asks); the continuation the relay's
POLICY: dict[str, dict[str, Any]] = {
    "commRepairSweep": {"roles": ("admin",), "params": {"force": "boolean"}},
    "commRepairContinue": {},
    "commRepairDeclare": {"roles": ("admin",), "params": {"situation": "string", "from": "string", "to": "string",
                                                          "what_was_wrong": "string"}},
    "commRepairConfirm": {"roles": ("admin",), "params": {"incident_id": "string", "decision": "string",
                                                          "note": "string"}}}
# a screen's save held by another write: never a 409, which a screen reads as a save that landed
BUSY_OF: dict[str, dict[str, Any]] = {"commRepairSweep": {"status": 409, "message": BUSY},
                                      "commRepairContinue": {"status": 409, "message": BUSY},
                                      "commRepairDeclare": {"status": 503, "message": BUSY},
                                      "commRepairConfirm": {"status": 503, "message": BUSY}}


class Store(RR.Store):
    """app.comm_repair_writes and _receipts; the house, the evidence and the trail app.edits', the messages Smart
    Comms' outbox's, the pass's own state app.comm_repair_state."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="comm_repair", label="The comms repair pass")
