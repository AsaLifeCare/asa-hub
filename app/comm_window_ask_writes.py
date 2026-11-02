"""The window ask carried (app/comm_window_ask.py plans each person): under the platform's write lock, each thread
judged on the house as it stands — an answer already on record settles it; else the lane's own pace (three asks, once
a day), the route consent allows, the person's own hours and the words — and written whatever the verdict
(commRecordUpsert_ as app.edits records of comm_intents), the first crossing of the ceiling observed, and — the dial
at send — the ask claimed first, handed to the one send door (comms_rpc.call, rpcCall_'s answers under Apps Script's
own idempotency keys), its evidence and its trail row kept and its ledger line written. A pass stops in time and hands
what is left back to the relay; the first stamps the nine-minute window, the last writes the sweep's log line."""
from __future__ import annotations

import time
from datetime import datetime, timezone
from typing import Any, Callable

import comm_record as CR
import comm_record_writes as CRW
import comm_window_ask as CWA
import gsjs
import locations as L
import resource_rows as RR
import smart_clock as SK
import smart_comms as SC
import staff_views
import writes as W
from gsjs import NY
from writes import Decision

PASS_S = 4.0
BUSY = "Another write holds the platform's lock; the window ask rings again."
TALLY = ("considered", "wrote", "sent", "redirected", "held", "answered", "spent", "off_roster", "no_route", "doubts",
         "gated")

text = CR.text


def _set_state(key: str, value: str) -> None:
    """PropertiesService's setProperty, the value replaced kept for a void."""
    RR._cur().execute(
        f"insert into {CWA.STATE} as s (key, value, prev, write_id) values (%s, %s, '', %s)"
        " on conflict (key) do update set prev = s.value, value = excluded.value, write_id = excluded.write_id,"
        " updated_at = now()", (key, value, SC.write_id()))


def _tally(v: Any) -> dict[str, int]:
    got = v if isinstance(v, dict) else {}
    out = {}
    for k in TALLY:
        try:
            out[k] = int(got.get(k) or 0)
        except (TypeError, ValueError):
            out[k] = 0
    return out


def _log_line(t: dict[str, int], words: str) -> str:
    """commWindowAskSweep_'s hubSysLog_ detail."""
    return (f"{t['considered']} inside a window · {t['wrote']} thread(s) written · {t['sent']} asked"
            + (f" ({t['redirected']} to the testers)" if t["redirected"] else "")
            + f" · {t['answered']} already answered · {t['held']} held · {t['spent']} at the ceiling"
            + f" · {t['off_roster']} off roster · {t['no_route']} unreachable"
            + (f" · {t['doubts']} in doubt (claim kept)" if t["doubts"] else "")
            + ("" if words else " · the words are off, so nothing was handed over"))


def _answer(t: dict[str, int], dial: str, test: bool, words: str) -> dict[str, Any]:
    return {"dial": dial, "test_mode": test, "considered": t["considered"], "threads": t["wrote"], "asked": t["sent"],
            "redirected": t["redirected"], "answered": t["answered"], "held": t["held"], "at_ceiling": t["spent"],
            "off_roster": t["off_roster"], "unreachable": t["no_route"], "doubts": t["doubts"], "gated": t["gated"],
            "words": words,
            "note": (("asked — every message went to the testers, nobody else." if test else "asked.")
                     if dial == "send" else f"planned and written down. Nothing was sent — the dial says {dial}.")}


def keep(sess: L.Session, payload: dict) -> Decision:
    """commWindowAskKeep (the relay's own): commWindowAskSweep_'s loop over the plans commWindowAskPlan made, a pass at
    a time under the write lock (`first` stamps the window when `stamp` says so, before the work; the pass that ends
    the sweep, done or `last`, logs it and answers the sweep)."""
    if (sess.user or {}).get("is_service") is not True:
        return Decision(dict(CR.DENIED))
    p = payload if isinstance(payload, dict) else {}
    run = p.get("run") if isinstance(p.get("run"), dict) else {}
    plans = [x for x in p.get("plans") or [] if isinstance(x, dict) and isinstance(x.get("moment"), dict)]
    reads = sess.reads
    first, last = p.get("first") is True, p.get("last") is True
    if first and p.get("stamp") is True:
        stamp_ms = time.time() * 1000.0
        if not CWA.due(CWA.state(reads), stamp_ms):
            return Decision({"status": 200, "data": {"skipped": True, "why": CWA.WINDOW_WHY, "left": []}},
                            subject="", own=True)
        # stamped before the work: a pass that dies halfway must not run again on the very next tick
        _set_state(CWA.SWEEP_KEY, str(int(stamp_ms)))
    if run.get("skipped") is True:
        return Decision({"status": 200, "data": {"skipped": True, "why": text(run.get("why")),
                                                 "dial": text(run.get("dial")), "left": []}}, subject="", own=True)
    if run.get("done") is True:
        return Decision({"status": 200, "data": {"asked": 0, "considered": 0, "dial": text(run.get("dial")),
                                                 "note": text(run.get("note")), "left": []}}, subject="", own=True)
    dial, test, now_iso = text(run.get("dial")), run.get("test") is True, text(run.get("now"))
    now_ms = CR.ms(now_iso)
    if dial not in ("record", "send") or not now_ms:
        return W.refuse(400, "commWindowAskPlan's run is required: nothing was kept.")
    local = datetime.fromtimestamp(now_ms / 1000.0, tz=timezone.utc).astimezone(NY)
    started = time.time()
    t = _tally(p.get("tally"))
    ps = CRW.Pass(reads)
    sit = CWA.situation(reads)
    words = text((sit or {}).get("id"))
    left: list[dict] = []
    for n, pl in enumerate(plans):
        if n and time.time() - started > PASS_S:
            left = plans[n:]
            break
        moment = pl["moment"]
        t["considered"] += 1
        # the roster is a law here too
        if pl.get("off_roster"):
            t["off_roster"] += 1
            continue
        intent = CWA.intent_of(moment)
        was = ps.prior.get(text(intent["intent_key"])) or {}
        done = CWA.answered(was, pl.get("consent") or [])
        if done["answered"]:
            t["answered"] += 1
            # a thread still saying `asking` about a question already answered is settled now
            if was.get("id") and text(was.get("state")) in ("asking", "planned"):
                ps.intents.upsert({"id": gsjs.or_blank(was.get("id")), "state": "answered",
                                   "reasons": "answered — " + done["why"]})
                ps.observe("settled", intent, {"by": "the answer on record", "why": done["why"]}, "sweep")
            continue
        mem = CR.memory(was, test)
        attempts = int(mem["attempts"])
        reasons = ["priority: " + CWA.PRIORITY + " — it asks a person for something, so it joins the queue it is in",
                   "moment: " + (text(moment.get("why")) or "inside the window before their shift")]
        verdict: dict[str, Any] = {"send": True, "defer": False, "escalate": False, "test": test,
                                   "priority": CWA.PRIORITY, "priority_id": CWA.PURPOSE, "droppable": False,
                                   "parts": [], "skipped": [], "reasons": reasons}
        att = CWA.attempt_verdict(reads, mem["attempts"])
        # named `attempts:` so the escalation's reason is this one
        reasons.append("attempts: " + att["why"])
        if att.get("escalate"):
            verdict["escalate"] = True
        if not att["ok"]:
            verdict["send"], verdict["defer"] = False, bool(att.get("defer"))
            if att.get("spent"):
                t["spent"] += 1
        if verdict["send"]:
            day = CWA.day_verdict(reads, mem["last_ms"], now_ms)
            reasons.append("pace: " + day["why"])
            if not day["ok"]:
                verdict["send"], verdict["defer"] = False, True
        person = pl.get("person") if isinstance(pl.get("person"), dict) else None
        route = pl.get("route") if isinstance(pl.get("route"), dict) else {"ok": False, "why": "", "tried": []}
        reasons.append("route: " + text(route.get("why")))
        verdict["channel"] = text(route.get("channel"))
        verdict["route_tried"] = [text(x) for x in route.get("tried") or []]
        # no permitted route is a block, never a hold
        blocked = not route.get("ok")
        if blocked:
            verdict["send"], verdict["defer"] = False, False
        if verdict["send"]:
            win = CR.window_verdict(reads, local.hour, local.isoweekday() % 7, pl.get("quiet"), CWA.PRIORITY)
            reasons.append("window: " + win["why"])
            if not win["ok"]:
                verdict["send"], verdict["defer"] = False, True
        # the words are part of the verdict
        if sit is None:
            verdict["send"], verdict["defer"] = False, False
            reasons.append(f"words: no situation carries this question — `{CWA.SITUATION}` is off or absent, and a "
                           "publish never switches a sender on")
        unreachable = not person or (not person.get("phone") and not person.get("email"))
        if unreachable:
            verdict["send"], verdict["defer"] = False, False
            reasons.append("reach: the People house holds neither a number nor an address for them")
        verdict["policy"] = "would send" if verdict["send"] else ("held" if verdict["defer"] else "blocked")
        verdict["dial"] = dial
        if dial != "send":
            verdict["send"] = False
            reasons.append("dial: " + dial + " — worked out, not handed over")
        # the thread is written whatever the verdict, in the shape every other thread in this house wears
        built = CR.record_rows(intent, verdict, now_iso, was)
        if built is None:
            continue
        try:
            ps.intents.upsert(built["intent"])
        except Exception:  # noqa: BLE001 - one person failing must not cost the pass
            continue
        t["wrote"] += 1
        if att.get("spent") and text(was.get("escalate")) != "yes":
            ps.observe("escalated", intent, {"attempts": mem["attempts"], "why": att["why"]}, "sweep")
            if not test:
                ps.observe("unanswered", intent, {"attempts": mem["attempts"], "last_asked_at": mem["last_iso"],
                                                  "why": "the ceiling was reached — this lane asks no more"}, "sweep")
        if not verdict["send"]:
            if blocked or unreachable:
                t["no_route"] += 1
            else:
                t["held"] += 1
            continue
        item = CWA.item_of(intent, person, sit)
        rid = built["intent"]["id"]
        # claim first, fail closed: a lost write may cost one ask, never a second message
        if not ps.claim(rid, test, attempts + 1, now_iso, ""):
            t["held"] += 1
            continue
        out = CRW.send(reads, item, sit, person, route, attempts, lambda _r: "")
        evidence = ps.attempt(intent, attempts + 1, out, test, now_iso)
        kind = ("redirected" if out["redirected"] else "sent") if out["sent"] else ("doubt" if out["doubt"] else "held")
        ps.observe(kind, intent, {"attempt": attempts + 1, "attempt_id": evidence, "channel": out["channel"],
                                  "receipt": out["receipt"], "error": out["error"], "test_mode": test,
                                  "asking": "when we may reach them"}, "sweep")
        if out["sent"]:
            t["sent"] += 1
            t["redirected"] += 1 if out["redirected"] else 0
            ps.intents.upsert({"id": rid, "state": "asking", "channel": out["channel"]})
            # a redirected send reached the testers and not the person — written under the rehearsal key
            key = SK.rehearsal_key(item["key"]) if out["redirected"] else item["key"]
            SC.record_ledger(key, words, item["name"], "", "rehearsal" if out["redirected"] else out["channel"],
                             reads.db)
        elif out["doubt"]:
            # a doubt keeps the claim: the provider may have taken it
            t["doubts"] += 1
            ps.intents.upsert({"id": rid, "last_error": out["error"]})
        else:
            if out["gated"]:
                t["gated"] += 1
            ps.claim(rid, test, attempts, text(mem["last_iso"]), "")
    done_all = not left
    data: dict[str, Any] = {"left": [] if done_all or last else left, "tally": t}
    if done_all or last:
        staff_views.record({"email": CWA.ACTOR}, "comm_window_ask_swept", _log_line(t, words))
        data.update(_answer(t, dial, test, words))
    kept = [e for e in ps.edits if e and e.get("cells")]
    return Decision({"status": 200, "data": data}, edits=kept or None, subject="", own=True)


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {"commWindowAskKeep": keep}
POLICY: dict[str, dict[str, Any]] = {"commWindowAskKeep": {}}
BUSY_OF: dict[str, dict[str, Any]] = {"commWindowAskKeep": {"status": 409, "message": BUSY}}


class Store(RR.Store):
    """app.comm_window_ask_writes and _receipts; the threads app.edits', the messages Smart Comms' outbox's, the
    window's stamp app.comm_window_ask_state's — a void puts it back where it was."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="comm_window_ask", label="The window ask")

    def settle(self, write_id: str, state: str, why: str = "", fields: list[str] | None = None) -> bool:
        done = super().settle(write_id, state, why, fields)
        if state == "void" and done:
            try:
                with self.conn().transaction():
                    self.conn().execute(f"update {CWA.STATE} set value = prev, write_id = '', updated_at = now()"
                                        " where write_id = %s", (write_id,))
            except Exception as exc:  # noqa: BLE001 - said, never raised into the relay's settle
                W.log.warning("comm window ask: the void of %s left the window's stamp (%s)", write_id[:40],
                              type(exc).__name__)
        return done
