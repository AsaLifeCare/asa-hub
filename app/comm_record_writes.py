"""The comms obligations sweep carried (app/comm_record.py plans each thread): under the platform's write lock, each
thread's two rows written down as commRecordUpsert_ writes them (app.edits records on the comm houses), the bindings it
no longer carries settled or deferred, the first crossing of its attempt budget observed, and — the dial at send — the
attempt claimed first, handed to the one send door (comms_rpc.call: rpcCall_'s answers under Apps Script's own
idempotency keys), its evidence and its trail row kept and its ledger line written. A pass stops in time and hands what
is left back to the relay; the first stamps the six-hour window and retires the old generation, the last writes the
resume point and the sweep's log line."""
from __future__ import annotations

import re
import time
from datetime import datetime, timezone
from typing import Any, Callable

import comm_record as CR
import comms_rpc as CRPC
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

PASS_S = 4.0
BUSY = "Another write holds the platform's lock; the obligations sweep rings again."
ACTOR = "asa-hub:comm"
TALLY = ("wrote", "sent", "redirected", "gated", "held", "unreachable", "no_words", "doubts", "retired")
WORDS_SEP = "\n@@|@@\n"
UNWRITTEN_SMS = "the text behind this situation is a generic letter nobody wrote for it — refused"
UNWRITTEN_MAIL = "the letter behind this situation is a generic credential e-mail nobody wrote for it — refused"
_WITHHELD = re.compile(r"^\[withheld")

s_ = gsjs.str_
text = CR.text


def _now_iso() -> str:
    """new Date().toISOString(): the moment itself."""
    return gsjs.iso(datetime.now(timezone.utc))


def _set_state(key: str, value: str) -> None:
    """PropertiesService's setProperty (deleteProperty as ''), the value replaced kept for a void."""
    RR._cur().execute(
        f"insert into {CR.STATE} as s (key, value, prev, write_id) values (%s, %s, '', %s)"
        " on conflict (key) do update set prev = s.value, value = excluded.value, write_id = excluded.write_id,"
        " updated_at = now()", (key, value, SC.write_id()))


def _target(reads: L.Reads, tab: str) -> tuple[str, str] | None:
    """hubTabEnsure_ for an appended row: the house's tab, or none when the copy cannot name it."""
    try:
        res = SCD.house_where(reads, tab)
        SCD.must_book(res, tab)
    except (Defer, hubdb.Unreadable):
        return None
    if res.ref is None and not res.declared_house:
        return None
    return W.where_of(res)


class House:
    """One comm house as commBoardRows_ and commRecordUpsert_ see it: its rows (the copy, the kept edits laid), and
    each upsert by id kept as an app.edits record of the cells it changes; a row not there is appended whole."""

    def __init__(self, reads: L.Reads, tab: str, edits: list[dict]) -> None:
        res = SCD.house_where(reads, tab)
        SCD.must_book(res, tab)
        if res.ref is None:
            raise Defer(f"{tab} holds no tab in the copy yet")
        self.sid, self.tab = W.where_of(res)
        self.edits = edits
        self.rows: list[dict] = []
        self.by_id: dict[str, dict[str, str]] = {}
        self.made: set[str] = set()
        heads = [(gsjs.js_str(h), h) for h in res.ref.headers]
        for _rn, raw in SCD.house_rows(reads, res.ref):
            typed = {name: hubdb.typed(raw.get(src), "hub") for name, src in heads}
            if all(v == "" or v is None for v in typed.values()):
                continue
            self.rows.append(typed)
            rid = gsjs.or_blank(typed.get("id"))
            if rid and rid not in self.by_id:
                self.by_id[rid] = {name: gsjs.or_blank(raw.get(src)) for name, src in heads}

    def by_key(self) -> dict[str, dict]:
        """commRecordPrior_: the rows by intent_key, the last of each."""
        out: dict[str, dict] = {}
        for r in self.rows:
            k = text(r.get("intent_key"))
            if k:
                out[k] = r
        return out

    def grouped(self) -> dict[str, list[dict]]:
        """commRecordPriorBindings_: the rows grouped by intent_key."""
        out: dict[str, list[dict]] = {}
        for r in self.rows:
            k = text(r.get("intent_key"))
            if k:
                out.setdefault(k, []).append(r)
        return out

    def upsert(self, row: dict[str, Any]) -> None:
        """commRecordUpsert_: updatedAt stamped (createdAt with it on a new row); a withheld cell of the copy is never
        written over (the row holds what this would write), and an id nobody can name is never written."""
        rid = gsjs.or_blank(row.get("id"))
        if not rid:
            return
        cells = {k: W.sheet_text(v) for k, v in {**row, "updatedAt": _now_iso()}.items()}
        was = self.by_id.get(rid)
        if was is None:
            cells["createdAt"] = cells["updatedAt"]
            self.by_id[rid] = dict(cells)
            self.made.add(rid)
            self.edits.append(W.kept_record(self.sid, self.tab, "append", "id", rid, "", cells))
            return
        changed = {k: v for k, v in cells.items() if k != "id" and not _WITHHELD.match(was.get(k) or "")
                   and not W.same_cell(was.get(k), v, "header")}
        if not changed:
            return
        before = None if rid in self.made else {k: was.get(k) or "" for k in changed}
        self.edits.append(W.kept_record(self.sid, self.tab, "edit", "id", rid, "", changed, before=before))
        was.update(changed)


class Pass:
    """One pass of the loop: the houses read under the lock, the edits it keeps, the targets it appends to."""

    def __init__(self, reads: L.Reads) -> None:
        self.reads = reads
        self.edits: list[dict] = []
        self.intents = House(reads, CR.INTENTS_HOUSE, self.edits)
        self.bindings = House(reads, CR.BINDINGS_HOUSE, self.edits)
        self.prior = self.intents.by_key()
        self.prior_bindings = self.bindings.grouped()
        self._targets: dict[str, tuple[str, str] | None] = {}

    def _append(self, tab: str, rec: dict, match: str, key: str) -> bool:
        if tab not in self._targets:
            self._targets[tab] = _target(self.reads, tab)
        got = self._targets[tab]
        if got is None or not key:
            return False
        self.edits.append(W.kept_record(got[0], got[1], "append", match, key, "", rec))
        return True

    def observe(self, kind: str, intent: dict, payload: dict, source: str, actor: str = "") -> str:
        """commObserve_: one trail row appended, never upserted; its event id, or ''."""
        if kind not in CR.OBSERVATION_TYPES:
            return ""
        row = CR.observation_row(kind, intent, payload, source, actor, _now_iso())
        return row["event_id"] if self._append(CR.OBSERVATIONS_HOUSE, row, W.COLS + "event_id", row["event_id"]) \
            else ""

    def attempt(self, intent: dict, n: int, out: dict, test: bool, now_iso: str) -> str:
        """commRecordAttempt_: the evidence appended; its id, or '' (the intent row still carries the claim)."""
        row = CR.attempt_row(intent, n, out, test, now_iso)
        row["createdAt"] = now_iso
        return row["id"] if self._append(CR.ATTEMPTS_HOUSE, row, "id", row["id"]) else ""

    def claim(self, rid: str, test: bool, attempts: int, last_iso: str, channel: str = "") -> bool:
        """commRecordClaim_: the attempt count of the current mode written."""
        row: dict[str, Any] = {"id": rid}
        if test:
            row.update(test_attempts=attempts, test_last_asked_at=last_iso)
        else:
            row.update(attempts=attempts, last_asked_at=last_iso)
        if channel:
            row["channel"] = channel
        self.intents.upsert(row)
        return True

    def supersede(self, rows: dict, prior: list[dict], open_keys: list[str], now_iso: str) -> None:
        """commRecordSupersede_: the bindings the thread no longer carries settled (no longer open in the matrix) or
        deferred (still open, outside the cap)."""
        if not prior:
            return
        carried = {text(b.get("demand_id")) for b in rows["bindings"]}
        still = set(open_keys or ())
        for b in prior:
            d = text(b.get("demand_id"))
            if not d or d in carried:
                continue
            st = text(b.get("binding_state")) or "open"
            if st == "settled":
                continue
            if d not in still:
                self.bindings.upsert({"id": gsjs.or_blank(b.get("id")), "binding_state": "settled",
                                      "qualified_by": "engine", "qualified_at": now_iso,
                                      "note": "no longer open in requirement_states"})
            elif st != "deferred":
                self.bindings.upsert({"id": gsjs.or_blank(b.get("id")), "binding_state": "deferred",
                                      "note": "still open; outside the cap this pass"})

    def retire_old_keys(self, now_iso: str) -> int:
        """commRecordRetireOldKeys_: rows of the payload-keyed generation marked superseded, a batch per sweep."""
        n = 0
        for k in CR.js_keys(self.prior):
            if n >= CR.RETIRE_BATCH:
                break
            if len(k.split("|")) < 3:
                continue
            row = self.prior[k]
            if text(row.get("state")) == "superseded":
                continue
            self.intents.upsert({"id": gsjs.or_blank(row.get("id")), "state": "superseded",
                                 "reasons": f"superseded {now_iso} — the key became the thread (person|purpose); see "
                                            "the live row"})
            for b in self.prior_bindings.get(k) or ():
                if text(b.get("binding_state")) == "superseded":
                    continue
                self.bindings.upsert({"id": gsjs.or_blank(b.get("id")), "binding_state": "superseded",
                                      "note": "superseded with its intent " + now_iso})
            n += 1
        return n


def send(reads: L.Reads, item: dict, situation: dict, person: dict, route: dict, attempts: int,
         label_for: Callable[[str], str]) -> dict[str, Any]:
    """commRecordSend_: one intent handed to the transport, the route's channel first and then the situation's; a
    doubt is not a no, and stops the ladder."""
    v = CR.dispatch_vars(reads, item, situation, label_for)
    order: list[str] = []
    for c in [text(route.get("channel"))] + CR.channels_of(situation):
        if c and c not in order:
            order.append(c)
    res: dict[str, Any] = {"sent": False, "channel": "", "redirected": False, "gated": False, "doubt": False,
                           "error": "", "receipt": "", "to": ""}
    try:
        res["words_sha"] = CR.record_id(WORDS_SEP.join(SW.words_of(situation or {})))
    except Exception:  # noqa: BLE001 - the identity of the words is unknown, and said as unknown
        res["words_sha"] = ""
    res["situation"] = text((situation or {}).get("id")) or text(item.get("situation"))
    res["sender_used"] = text(v.get("sender"))
    reason = "comms: " + text(item.get("situation")) + " · " + text(item.get("intent_key"))
    for ch in order:
        if ch == "sms":
            to = SC.sendable(person.get("phone"))
            if not to or not s_(situation.get("sms_text")):
                continue
            if SC.unwritten_words(reads.db, situation, "sms_text"):
                res["error"] = UNWRITTEN_SMS
                continue
            res["to"] = to
            r = CRPC.call(reads, "smsSend", {"to": to, "body": SC.render(situation.get("sms_text"), v),
                                             "reason": reason},
                          {"idempotency_key": f"ci_{text(item.get('intent_key'))}_{attempts + 1}"})
        elif ch == "email":
            if not s_(person.get("email")) or not s_(situation.get("email_subject")):
                continue
            if SC.unwritten_words(reads.db, situation, "email_subject") or \
                    SC.unwritten_words(reads.db, situation, "email_text"):
                res["error"] = UNWRITTEN_MAIL
                continue
            res["to"] = s_(person.get("email"))
            r = CRPC.call(reads, "emailSend", {"to": s_(person.get("email")),
                                               "subject": SC.render(situation.get("email_subject"), v),
                                               "body": SC.render(situation.get("email_text"), v), "reason": reason},
                          {"idempotency_key": f"ci_mail_{text(item.get('intent_key'))}_{attempts + 1}"})
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
            if CR.is_doubt(res["error"]):
                res.update(doubt=True, channel=ch)
                return res
    return res


def _tally(v: Any) -> dict[str, int]:
    got = v if isinstance(v, dict) else {}
    out = {}
    for k in TALLY:
        try:
            out[k] = int(got.get(k) or 0)
        except (TypeError, ValueError):
            out[k] = 0
    return out


def _log_line(t: dict[str, int], run: dict, done: bool, at: int) -> str:
    """commRecordSweep_'s hubSysLog_ detail."""
    off = int(((run.get("skipped") or {}) if isinstance(run.get("skipped"), dict) else {}).get("off_roster") or 0)
    dropped, planned = int(run.get("left_to_reminders") or 0), int(run.get("planned") or 0)
    return (f"{t['wrote']} intent(s) recorded · {t['sent']} sent"
            + (f" ({t['redirected']} to the testers)" if t["redirected"] else "")
            + f" · {t['held']} held · {t['gated']} gated · {t['unreachable']} unreachable"
            + (f" · {t['doubts']} in doubt (claim kept)" if t["doubts"] else "")
            + (f" · {dropped} obligation(s) left to the reminder lane" if dropped else "")
            + (f" · {t['retired']} old-generation row(s) superseded" if t["retired"] else "")
            + (" · no situation carries compliance.owed" if t["no_words"] else "")
            + f" · {off} off roster"
            + ("" if done else f" · paused at {at} of {planned}, resuming next tick"))


def keep(sess: L.Session, payload: dict) -> Decision:
    """commRecordKeep (the relay's own): commRecordSweep_'s loop over the plans commRecordPlan made, a pass at a time
    under the write lock (`first` stamps the window when `stamp` says so and retires the old generation; the pass that
    ends the sweep, done or `last`, sets the resume point as commRecordCursorSet_ does and logs the sweep)."""
    if (sess.user or {}).get("is_service") is not True:
        return Decision(dict(CR.DENIED))
    p = payload if isinstance(payload, dict) else {}
    run = p.get("run") if isinstance(p.get("run"), dict) else {}
    plans = [x for x in p.get("plans") or [] if isinstance(x, dict) and isinstance(x.get("intent"), dict)]
    reads = sess.reads
    first, last = p.get("first") is True, p.get("last") is True
    if first and p.get("stamp") is True:
        stamp_ms = time.time() * 1000.0
        if not CR.due(CR.state(reads), stamp_ms):
            return Decision({"status": 200, "data": {"skipped": True, "why": CR.WINDOW_WHY, "left": []}},
                            subject="", own=True)
        # stamped before the work, not after
        _set_state(CR.SWEEP_KEY, str(int(stamp_ms)))
    if run.get("skipped") is True:
        return Decision({"status": 200, "data": {"skipped": True, "why": text(run.get("why")),
                                                 "unread": run.get("unread") or [], "left": []}},
                        subject="", own=True)
    dial, test, now_iso = text(run.get("dial")), run.get("test") is True, text(run.get("now"))
    now_ms = CR.ms(now_iso)
    if dial not in ("record", "send") or not now_ms:
        return W.refuse(400, "commRecordPlan's run is required: nothing was kept.")
    local = datetime.fromtimestamp(now_ms / 1000.0, tz=timezone.utc).astimezone(NY)
    started = time.time()
    t = _tally(p.get("tally"))
    ps = Pass(reads)
    if first:
        t["retired"] += ps.retire_old_keys(now_iso)
    situation: list[dict | None] = []
    labels: list[dict[str, str]] = []

    def sit() -> dict | None:
        if not situation:
            situation.append(CR.situation_for(reads, CR.PURPOSE))
        return situation[0]

    def label_for(rid: str) -> str:
        if not labels:
            labels.append(SCD.cert_labels(reads))
        return labels[0].get(rid) or ""

    left: list[dict] = []
    for n, pl in enumerate(plans):
        if n and time.time() - started > PASS_S:
            left = plans[n:]
            break
        intent = pl["intent"]
        was = ps.prior.get(text(intent.get("intent_key"))) or {}
        # a thread the person stopped is never re-planned
        if text(was.get("state")) == "stopped":
            t["held"] += 1
            continue
        mem = CR.memory(was, test)
        attempts = int(mem["attempts"])
        verdict = CR.plan_verdict(reads, intent, {"attempts": attempts, "last_ms": mem["last_ms"], "now_ms": now_ms,
                                                  "local_hour": local.hour, "local_day": local.isoweekday() % 7,
                                                  "test": test, "quiet": pl.get("quiet")}, dial)
        verdict["supervisor"] = text(pl.get("supervisor"))
        verdict["supervisor_confidence"] = text(pl.get("supervisor_confidence"))
        route = pl.get("route") if isinstance(pl.get("route"), dict) else {"ok": False, "why": "", "tried": []}
        verdict["channel"] = text(route.get("channel"))
        verdict["route_tried"] = [text(x) for x in route.get("tried") or []]
        verdict["reasons"].append("route: " + text(route.get("why")))
        rows = CR.record_rows(intent, verdict, now_iso, was)
        if rows is None:
            continue
        ps.intents.upsert(rows["intent"])
        for b in rows["bindings"]:
            ps.bindings.upsert(b)
        ps.supersede(rows, ps.prior_bindings.get(text(intent.get("intent_key"))) or [], pl.get("open") or [], now_iso)
        t["wrote"] += 1
        if verdict["escalate"] and text(was.get("escalate")) != "yes":
            # the first time a thread crosses the budget is a committed result: it is a person's job now
            ps.observe("escalated", intent, {"attempts": attempts, "why": " · ".join(verdict["reasons"]),
                                             "escalate_to": verdict["supervisor"],
                                             "escalate_to_confidence": verdict["supervisor_confidence"],
                                             "suggested_by": "the graph (MANAGED_BY)" if verdict["supervisor"] else ""},
                       "sweep")
            if attempts >= CR.num(CR.policy(reads, "max_attempts")) and not test:
                ps.observe("unanswered", intent, {"attempts": attempts, "last_asked_at": mem["last_iso"]}, "sweep")
        if not verdict["send"]:
            t["held"] += 1
            continue
        if not CR.dispatch_allowed(intent, verdict, route, dial)["ok"]:
            t["unreachable"] += 1
            continue
        situation_now = sit()
        if situation_now is None:
            t["no_words"] += 1
            continue
        person = pl.get("person") if isinstance(pl.get("person"), dict) else None
        if not person or (not person.get("phone") and not person.get("email")):
            t["unreachable"] += 1
            continue
        item = CR.dispatch_item(intent, person, situation_now)
        if item is None:
            continue
        rid = rows["intent"]["id"]
        # the attempt claimed first, in the same transaction as the message
        if not ps.claim(rid, test, attempts + 1, now_iso):
            t["held"] += 1
            continue
        out = send(reads, item, situation_now, person, route, attempts, label_for)
        evidence = ps.attempt(intent, attempts + 1, out, test, now_iso)
        kind = ("redirected" if out["redirected"] else "sent") if out["sent"] else ("doubt" if out["doubt"] else "held")
        ps.observe(kind, intent, {"attempt": attempts + 1, "attempt_id": evidence, "channel": out["channel"],
                                  "receipt": out["receipt"], "error": out["error"], "items": item["binding_count"],
                                  "test_mode": test}, "sweep")
        if out["sent"]:
            t["sent"] += 1
            t["redirected"] += 1 if out["redirected"] else 0
            ps.intents.upsert({"id": rid, "state": "asking", "channel": out["channel"]})
            # a rehearsal is written under the rehearsal key
            key = SK.rehearsal_key(item["key"]) if out["redirected"] else item["key"]
            SC.record_ledger(key, text(situation_now.get("id")), item["name"], item["expires"],
                             "rehearsal" if out["redirected"] else out["channel"], reads.db)
        elif out["doubt"]:
            # a doubt keeps the claim
            t["doubts"] += 1
            ps.intents.upsert({"id": rid, "last_error": out["error"]})
        else:
            if out["gated"]:
                t["gated"] += 1
            ps.claim(rid, test, attempts, mem["last_iso"])
    done = not left
    data: dict[str, Any] = {"left": [] if done or last else left, "tally": t}
    if done or last:
        at = int(left[0].get("at") or 0) if left else int(run.get("planned") or 0)
        settled = done or not t["wrote"]
        _set_state(CR.CURSOR_KEY, "0" if settled else str(at))
        if not settled:
            # the window is lifted, so the next tick resumes where this one stopped
            _set_state(CR.SWEEP_KEY, "")
        staff_views.record({"email": ACTOR}, "comm_record_swept", _log_line(t, run, done, at))
        data.update({"dial": dial, "test_mode": test, "intents": t["wrote"], "sent": t["sent"],
                     "redirected": t["redirected"], "held": t["held"], "gated": t["gated"],
                     "unreachable": t["unreachable"], "no_words": t["no_words"], "doubts": t["doubts"],
                     "left_to_reminders": int(run.get("left_to_reminders") or 0), "superseded": t["retired"],
                     "people_considered": int(run.get("people_considered") or 0),
                     "planned": int(run.get("planned") or 0), "resumed_from": int(run.get("resumed_from") or 0),
                     "complete": done, "skipped": run.get("skipped") or {}, "unread": run.get("unread") or [],
                     "note": (("sent — every message went to the testers, nobody else." if test else "sent.")
                              if dial == "send" else
                              f"planned and written down. Nothing was sent — the dial says {dial}.")})
    kept = [e for e in ps.edits if e and e.get("cells")]
    return Decision({"status": 200, "data": data}, edits=kept or None, subject="", own=True)


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {"commRecordKeep": keep}
POLICY: dict[str, dict[str, Any]] = {"commRecordKeep": {}}
BUSY_OF: dict[str, dict[str, Any]] = {"commRecordKeep": {"status": 409, "message": BUSY}}


class Store(RR.Store):
    """app.comm_record_writes and _receipts; the threads app.edits', the messages Smart Comms' outbox's, the pace and
    the resume point app.comm_record_state's — a void puts those back where they were."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="comm_record", label="The obligations sweep")

    def settle(self, write_id: str, state: str, why: str = "", fields: list[str] | None = None) -> bool:
        done = super().settle(write_id, state, why, fields)
        if state == "void" and done:
            try:
                with self.conn().transaction():
                    self.conn().execute(f"update {CR.STATE} set value = prev, write_id = '', updated_at = now()"
                                        " where write_id = %s", (write_id,))
            except Exception as exc:  # noqa: BLE001 - said, never raised into the relay's settle
                W.log.warning("comm record: the void of %s left the sweep's state (%s)", write_id[:40],
                              type(exc).__name__)
        return done
