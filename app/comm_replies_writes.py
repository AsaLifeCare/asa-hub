"""The mailbox ear's writes (CommInbound.gs commRepliesSweep's writing half, commRepliesKeep — the relay's own): what
commRepliesDue read, kept under the platform's write lock. The first pass stamps the fifteen-minute window
(commMailDue_), runs the close behind its own six-hour stamp (commCloseSweepMaybe_, commCloseSweep_) and answers the
dial, the mailbox or an empty inbox as commMailSweep_ answers them; then each thread from somebody we know (or a tester)
is captured as commInboundCapture_ captures it, a few seconds at a time, what is left handed back to the relay for the
next pass, the counts carried along in `tally`, and the sweep's line written once nothing is left.

The comm houses (comm_contributions, comm_intents, comm_bindings, comm_observations, comm_repairs, entity_comm_consent)
are read off asa-hub-db once a pass and every commRecordUpsert_ and commObserve_ is laid over them at once, so the
next reply reads what this one wrote; each row is an app.edits kept record of this write. A STOP, a START and a wrong
number go into the opt-out list where opt_outs_writes keeps it; the stamps into app.comm_replies_state, which a void
puts back."""
from __future__ import annotations

import re
import time
from datetime import datetime, timezone
from typing import Any, Callable

import comm_replies as CR
import gsjs
import hubdb
import locations as L
import opt_outs as OO
import opt_outs_writes as OOW
import resource_rows as RR
import smart_comms as SC
import smart_comms_desk as SCD
import staff_views
import support_desk_writes as SDW
import writes as W
from scope import Defer
from writes import Decision

PASS_S = 4.0
BUSY = "Another write holds the platform's lock; the ear listens again on the next tick."
# the pack key the relay reads again: Smart Comms' Replies
SUBJECT = "replies"
ACTOR = {"email": CR.ACTOR}

t, low, mask = CR.t, CR.low, CR.mask


class Refused(Exception):
    """What Apps Script throws here (a house with no tab), caught where it catches it."""


def _db_fault(exc: BaseException) -> bool:
    """A fault the write's own transaction cannot outlive: never swallowed as Apps Script's catch swallows its own."""
    return isinstance(exc, (hubdb.Unreadable, Defer)) or type(exc).__module__.startswith("psycopg")


def log_line(action: str, detail: str, status: int = 200) -> None:
    """hubSysLog_('asa-hub:comm', …)."""
    staff_views.record(ACTOR, action, detail, status)


def _cell(v: Any) -> Any:
    """serialize_: an object as JSON.stringify writes it, anything else as it is."""
    return W.json_text(v) if isinstance(v, (dict, list)) else v


# ---- the houses, as one pass reads and writes them -------------------------------------------------------------------

class Houses:
    """commBoardRows_, findRowIndex_, commRecordUpsert_ and commObserve_ over the copy: each house read once, each
    write laid over it at once, each row kept once in app.edits however many times the pass touched it."""

    def __init__(self, reads: L.Reads) -> None:
        self.reads = reads
        self._res: dict[str, hubdb.Resolved] = {}
        self._rows: dict[str, list[dict]] = {}
        self._before: dict[str, list[dict]] = {}
        self._index: dict[str, dict[str, int]] = {}
        self._kept: dict[tuple, dict] = {}
        self._matrix: list[dict] | None = None

    def where(self, tab: str) -> hubdb.Resolved:
        if tab not in self._res:
            res = SCD.house_where(self.reads, tab)
            SCD.must_book(res, tab)
            self._res[tab] = res
        return self._res[tab]

    def target(self, tab: str) -> tuple[str, str] | None:
        """Where a row of this house lands; None when hubTabSheet_ finds no tab (and the house is not declared)."""
        res = self.where(tab)
        if res.runtime or (res.ref is None and not res.declared_house):
            return None
        return W.where_of(res)

    def _load(self, tab: str) -> None:
        if tab in self._rows:
            return
        res = self.where(tab)
        rows: list[dict] = []
        before: list[dict] = []
        index: dict[str, int] = {}
        if res.ref is not None:
            heads = [(gsjs.js_str(h), h) for h in res.ref.headers]
            for _rn, raw in SCD.house_rows(self.reads, res.ref):
                row = {k: hubdb.typed(raw.get(h), "hub") for k, h in heads}
                rid = row.get("id")
                if rid is not None and rid != "":
                    index.setdefault(gsjs.js_str(rid), len(rows))
                rows.append(row)
                before.append({k: gsjs.or_blank(hubdb.typed(raw.get(h), "raw")) for k, h in heads})
        self._rows[tab], self._before[tab], self._index[tab] = rows, before, index

    def board(self, tab: str) -> list[dict]:
        """commBoardRows_: every row with anything in it, keyed by the house's own header — each one a copy."""
        self._load(tab)
        return [dict(r) for r in self._rows[tab] if any(v != "" and v is not None for v in r.values())]

    def find(self, tab: str, rid: Any) -> int | None:
        """findRowIndex_: the first row whose id is this one."""
        if rid is None or rid == "":
            return None
        self._load(tab)
        return self._index[tab].get(gsjs.js_str(rid))

    def _keep(self, target: tuple[str, str], tab: str, kind: str, match: str, key: str, cells: dict,
              before: dict | None) -> None:
        if not key:
            return
        slot = (target[0], target[1], match, key)
        rec = self._kept.get(slot)
        if rec is None:
            self._kept[slot] = W.kept_record(target[0], target[1], kind, match, key, SUBJECT,
                                             {k: _cell(v) for k, v in cells.items()},
                                             before=before if kind == "edit" else None)
            return
        for k, v in cells.items():
            rec["cells"][k] = W.sheet_text(_cell(v))
            if rec["kind"] == "edit" and before and k in before:
                rec.setdefault("before", {}).setdefault(k, W.sheet_text(before[k]))

    def upsert(self, tab: str, row: dict, keep_created: bool = False) -> bool:
        """commRecordUpsert_ (commRepairUpsert_'s write with `keep_created`): one row by id, appended whole or its
        cells written over the old ones; False when the house has no tab to take it, which is passed over in silence."""
        target = self.target(tab)
        if target is None:
            return False
        self._load(tab)
        row = dict(row)
        now = CR.now_iso()
        row["updatedAt"] = now
        rid = row.get("id")
        at = self.find(tab, rid)
        key = gsjs.js_str(rid) if rid is not None else ""
        if at is None:
            row["createdAt"] = (t(row.get("createdAt")) or now) if keep_created else now
            if rid is not None and rid != "":
                self._index[tab].setdefault(key, len(self._rows[tab]))
            self._rows[tab].append(row)
            self._before[tab].append({})
            self._keep(target, tab, "append", "id", key, row, None)
            return True
        cur = self._rows[tab][at]
        changed = {}
        for k, v in row.items():
            if W.sheet_text(_cell(v)) != W.sheet_text(_cell(cur.get(k))):
                changed[k] = v
            cur[k] = v
        if changed:
            appended = (self._kept.get((target[0], target[1], "id", key)) or {}).get("kind") == "append"
            self._keep(target, tab, "append" if appended else "edit", "id", key, changed, self._before[tab][at])
        return True

    def observe(self, otype: str, intent: dict | None, payload: dict, source: str, actor: str = "") -> str:
        """commObserve_: one trail row appended; never throws, never upserts; the event id or ''."""
        if otype not in CR.OBSERVATION_TYPES:
            return ""
        try:
            row = CR.observation_row(otype, intent, payload, source, actor, CR.now_iso())
            target = self.target(CR.OBSERVATIONS)
            if target is None:
                return ""
            self._keep(target, CR.OBSERVATIONS, "append", W.COLS + "event_id", row["event_id"], row, None)
            return row["event_id"]
        except Exception as exc:  # noqa: BLE001 - the trail never fails the reply it records
            if _db_fault(exc):
                raise
            return ""

    def edits(self) -> list[dict]:
        return [r for r in self._kept.values() if r.get("cells")]

    # -- the readers the ear asks, over what this pass wrote --

    def contribution_exists(self, message_id: Any) -> bool:
        """commContributionExists_."""
        return self.find(CR.CONTRIBUTIONS, "CMC_" + CR.record_id(t(message_id))) is not None

    def contribution_save(self, row: dict) -> bool:
        """commContributionSave_."""
        try:
            self.upsert(CR.CONTRIBUTIONS, row)
            return True
        except Exception as exc:  # noqa: BLE001
            if _db_fault(exc):
                raise
            return False

    def contribution_close(self, rid: str, state: str, by: str, reason: str, why: str, now: str,
                           extra: dict | None = None) -> bool:
        """commContributionClose_: refuses unknown states, closers and unlisted reasons."""
        if not rid or state not in CR.CONTRIBUTION_TERMINAL_STATES or by not in CR.CONTRIBUTION_CLOSERS:
            return False
        if by != "person" and reason not in CR.CONTRIBUTION_SILENT_CLOSES:
            return False
        row = {"id": rid, "state": state, "reason": t(reason), "close": by, "closed_at": t(now or CR.now_iso()),
               "note": CR.cut(t(why), 500)}
        row.update(extra or {})
        return self.contribution_save(row)

    def open_intents(self, person_key: Any) -> list[dict]:
        """commInboundOpenIntents_: this person's threads still asking, with their bindings attached."""
        who = low(person_key)
        intents = [r for r in self.board(CR.INTENTS)
                   if low(r.get("person_key")) == who and t(r.get("state")) in ("asking", "planned")]
        if not intents:
            return []
        bindings: dict[str, list[dict]] = {}
        for b in self.board(CR.BINDINGS):
            bindings.setdefault(t(b.get("intent_key")), []).append(b)
        for i in intents:
            i["bindings"] = bindings.get(t(i.get("intent_key"))) or []
        return intents

    def estate(self, person_key: Any) -> dict[str, dict[str, str]]:
        """commInboundEstate_: what the matrix says today about each of this person's obligations."""
        if self._matrix is None:
            try:
                self._matrix = CR.matrix(self.reads)
            except Exception as exc:  # noqa: BLE001
                if _db_fault(exc):
                    raise
                self._matrix = []
        who = low(person_key)
        out = {}
        for r in self._matrix:
            if low(r.get("person_key")) != who:
                continue
            out[who + "|" + t(r.get("req_id"))] = {"state": t(r.get("state")), "expires": t(r.get("expires"))}
        return out

    def repair_rows(self) -> list[dict]:
        """commInboundRepairRows_: the incidents ledger, read whole, or nothing."""
        return self.board(CR.REPAIRS)

    def repair_upsert(self, row: dict) -> bool:
        """commRepairUpsert_: refuses to invent the house where no pointer declares it."""
        res = self.where(CR.REPAIRS)
        if res.ref is None and not self.reads.db.house_moved(CR.REPAIRS):
            raise Refused(CR.REPAIR_NO_HOUSE)
        if not self.upsert(CR.REPAIRS, row, keep_created=True):
            raise Refused(CR.REPAIR_NO_HOUSE)
        return True

    def consent_window_for(self, person_key: Any) -> dict | None:
        """commConsentWindowFor_ over commRecordConsentRows_ (the store keyed by entity_name's name key)."""
        key = low(person_key)
        if not key:
            return None
        mine = [r for r in self.board(CR.CONSENT) if gsjs.name_key(r.get("entity_name")) == key]
        return CR.window_live(mine) if mine else None


# ---- the ear ---------------------------------------------------------------------------------------------------------

class Ear:
    """commInboundCapture_ and everything it asks, for one pass."""

    def __init__(self, reads: L.Reads, houses: Houses, by: dict) -> None:
        self.reads = reads
        self.h = houses
        self.by = by
        self.cfg = reads.config()
        self._testing: bool | None = None

    def testing(self) -> bool:
        if self._testing is None:
            self._testing = CR.test_mode(self.cfg)
        return self._testing

    def label_for(self, rid: str) -> str:
        return t(CR.cert_labels(self.reads).get(rid))

    def reason(self, corr: dict | None, contribution: dict | None, qualified: dict | None) -> str:
        return CR.desk_reason(self.reads, corr, contribution, qualified, 0)

    def rehearsal_row(self, m: dict, corr: dict | None, contribution: dict, state: str, reason: str, now: str,
                      extra: dict | None) -> dict[str, Any]:
        """commInboundRehearsalRow_: one rehearsal row, wearing the marks that keep it out of somebody's record."""
        c = corr or {"intent": None, "how": "own-line", "why": ""}
        row = CR.contribution_row(m, None, c, contribution, state, reason, now)
        row.update(test_mode="yes", claims="", settled_now="", awaiting="",
                   would_settle=t((extra or {}).get("would_settle")), would_await=t((extra or {}).get("would_await")))
        row["why"] = CR.REHEARSAL_MARK + t(row["why"])
        return row

    # -- commInboundCapture_ --

    def capture(self, m: dict) -> dict[str, Any]:
        """commInboundCapture_: which intent does this answer belong to?"""
        h = self.h
        now = CR.now_iso()
        mid = t(m.get("message_id"))
        if not mid:
            return {"ok": False, "why": "no message id"}
        if h.contribution_exists(mid):
            return {"ok": True, "already": True}
        who = CR.inbound_person(m, self.by)
        stub = {"person_key": (who or {}).get("key") or "", "person_name": (who or {}).get("name") or "",
                "intent_key": ""}
        h.observe("replied", stub, {"channel": m.get("channel"), "from": mask(m.get("from")), "message_id": mid,
                                    "matched": bool(who)}, "inbound", "provider")
        if not who:
            ours = False
            try:
                d = re.sub(r"^1", "", re.sub(r"\D", "", t(m.get("from"))))
                ours = t(m.get("channel")) == "sms" and bool(d) and OO.is_ours(self.reads, d)
                if not ours:
                    ours = CR.tester(self.cfg, m.get("from"), m.get("channel"))
            except Exception as exc:  # noqa: BLE001
                if _db_fault(exc):
                    raise
                ours = False
            if ours:
                rehearsed = self.rehearse(m, mid, now)
                if rehearsed:
                    return rehearsed
                testing = self.testing()
                own_why = ("a reply from one of our own lines with NO REFERENCE in the body — every message goes to "
                           "the tester while test mode is on, so a reply names its thread by quoting the Ref or not at "
                           "all" if testing else "a reply from one of our own lines — traffic between company numbers, "
                                                 "not somebody writing back")
                h.observe("replied", stub, {"channel": m.get("channel"), "from": mask(m.get("from")), "own_line": True,
                                            "test_mode": "yes" if testing else "no", "why": own_why},
                          "inbound", "the tester line")
                if testing:
                    h.contribution_save(self.rehearsal_row(m, None, {"kind": "unclear", "claims": [], "why": own_why},
                                                           "dismissed", "ambiguous", now, None))
                return {"ok": True, "matched": False, "own_line": True}
            roster = SDW.phone_who(self.reads, m.get("from")) if t(m.get("channel")) != "email" else None
            sole = bool(roster) and roster.get("state") == "sole"
            h.observe("unmatched", stub, {"channel": m.get("channel"), "from": mask(m.get("from")),
                                          "roster": roster["state"] if roster else "not asked",
                                          "candidate": roster["name"] if sole else "",
                                          "candidate_from": "phone" if sole else "",
                                          "why": CR.who_text(roster) if roster else
                                          "an address, not a number — the roster is asked by phone"},
                      "inbound", "provider")
            return {"ok": True, "matched": False}

        opened = h.open_intents(who["key"])
        corr = CR.correlate({"text": m.get("text"), "thread_id": m.get("thread_id")}, opened)
        text = t(m.get("text"))
        consent = CR.inbound_intent(text, self.cfg)

        if consent == "opt-in":
            freed = 0
            try:
                rel = OOW.release(self.reads, t(m.get("from")), CR.ACTOR)
                freed = int((rel or {}).get("freed") or 0)
            except Exception as exc:  # noqa: BLE001
                if _db_fault(exc):
                    raise
            row_in = CR.contribution_row(m, who, corr, {
                "kind": "opt-in", "claims": [],
                "why": "they asked us to contact them again" + (" — " + str(freed) + " suppression(s) released"
                                                                if freed else "")
                       + "; nothing was said about what is still open"}, "needs_human", "unclear", now)
            h.contribution_save(row_in)
            h.observe("consent_changed", corr["intent"] or stub,
                      {"channel": m.get("channel"), "intent": "opt-in", "phrase": CR.cut(text, 80), "released": freed,
                       "contribution": row_in["id"]}, "inbound", "the person")
            return {"ok": True, "matched": True, "opted_in": True, "released": freed, "contribution": row_in["id"]}

        if consent in ("opt-out", "wrong-number"):
            bad = consent == "wrong-number"
            try:
                OOW.add(self.reads, t(m.get("from")), {
                    "name": who["name"], "source": "wrong number" if bad else "comm_reply", "phrase": CR.cut(text, 80),
                    "messageId": mid, "by": CR.ACTOR, "scope": "staff" if corr["intent"] else ""})
            except Exception as exc:  # noqa: BLE001
                if _db_fault(exc):
                    raise
            stopped = corr["intent"] or stub
            h.observe("consent_changed", stopped, {"channel": m.get("channel"), "intent": consent,
                                                   "phrase": CR.cut(text, 80)}, "inbound", "the person")
            if corr["intent"]:
                self._upsert_soft(CR.INTENTS, {"id": corr["intent"].get("id"), "state": "stopped",
                                               "last_reply_at": now})
                h.observe("stopped", corr["intent"], {"by": "a wrong number" if bad else "the person",
                                                      "message_id": mid},
                          "inbound", "our own bad data" if bad else "the person")
            h.contribution_save(CR.contribution_row(m, who, corr, {
                "kind": "wrong-number" if bad else "stop", "claims": [],
                "why": ("the person on this line never applied — the number is ours to fix, not theirs to answer" if bad
                        else "the person asked us to stop")}, "stopped", "wrong-number" if bad else "stop", now))
            return {"ok": True, "matched": True, "stopped": True, "wrong_number": bad}

        said = CR.said_of(text)
        heard = CR.correction_read(said)
        if heard["kind"] in ("identity", "sender"):
            return self.correction_handle(m, who, corr, heard, said, now)
        ask_note = (" — and they say we already have it. That is a claim about an obligation, so the estate answers it "
                    "and not this ear: it settles only where the record already agrees") if heard["kind"] == "ask" \
            else ""

        if not corr["intent"]:
            back = self.close_repair_reply(m, who, corr, said, opened, now)
            if back and back.get("handled"):
                return back["result"]
            reason = self.reason(corr, None, None) or "ambiguous"
            why0 = t(corr["why"]) + ask_note + t((back or {}).get("note"))
            open_window = next((i for i in (opened or []) if CR.is_window_thread(i)), None)
            peek = CR.stated_window_read(CR.said_of(text)) if open_window else None
            if peek and peek["confident"]:
                why0 += (" — and their contact-window question is one of the threads open. This reply reads as "
                         + peek["read_as"] + ", but reading it INTO that thread because it looks like hours would be a "
                         "guess about which question they answered. Nothing was stored; a person decides")
            row0 = CR.contribution_row(m, who, corr, {"kind": "unclear", "claims": [], "why": why0}, "needs_human",
                                       reason, now)
            if peek and peek["confident"]:
                row0.update(window_read_as=t(peek["read_as"]), window_from=t(peek["from"]), window_to=t(peek["to"]),
                            window_days=t(peek["days"]), window_stored="no")
            h.contribution_save(row0)
            h.observe("needs_human", stub, {"reason": reason, "why": why0, "contribution": row0["id"]}, "inbound")
            return {"ok": True, "matched": True, "correlated": False, "reason": reason}

        intent = corr["intent"]
        h.observe("correlated", intent, {"how": corr["how"], "why": corr["why"], "message_id": mid}, "inbound")
        if CR.is_window_thread(intent):
            return self.window_handle(m, who, corr, intent, now)

        contribution = CR.contribution_of(text, intent, self.label_for)
        estate = h.estate(who["key"])
        qualified = CR.qualify(intent, contribution, lambda d: estate.get(t(d)) or {"state": "unknown"})
        settled_now: list[str] = []
        awaiting: list[str] = []
        for r in qualified["results"]:
            b = next((x for x in (intent.get("bindings") or []) if t(x.get("demand_id")) == t(r["demand_id"])), None)
            if b is None:
                continue
            if r["settle"]:
                self._upsert_soft(CR.BINDINGS, {"id": b.get("id"), "binding_state": "settled",
                                                "qualified_by": "estate", "qualified_at": now,
                                                "note": "the person said so and requirement_states agrees"})
                settled_now.append(t(r["demand_id"]))
            elif r["verdict"] in ("disagrees", "unknown"):
                awaiting.append(t(r["demand_id"]))
        state = "awaiting_owner" if awaiting else ("settled" if settled_now else "needs_human")
        why = self.reason(corr, contribution, qualified) or ""
        if state == "needs_human" and not why:
            why = "unclear" if contribution["kind"] == "unclear" else "ambiguous"
        row = CR.contribution_row(m, who, corr, contribution, state, why, now)
        row["settled_now"] = " · ".join(settled_now)
        row["awaiting"] = " · ".join(awaiting)
        if ask_note:
            row["correction_kind"] = "ask"
            row["why"] = t(row["why"]) + ask_note
        h.contribution_save(row)
        h.observe("contribution", intent, {"kind": contribution["kind"], "claims": len(contribution["claims"] or []),
                                           "settled_now": len(settled_now), "awaiting": len(awaiting), "state": state,
                                           "contribution": row["id"]}, "inbound")
        if settled_now:
            h.observe("settled", intent, {"demands": settled_now, "by": "estate", "contribution": row["id"]},
                      "inbound", "estate")
        if state == "needs_human":
            h.observe("needs_human", intent, {"reason": why, "contribution": row["id"]}, "inbound")
        still_open = sum(1 for b in (intent.get("bindings") or [])
                         if t(b.get("binding_state") or "open") == "open" and t(b.get("demand_id")) not in settled_now)
        self._upsert_soft(CR.INTENTS, {"id": intent.get("id"), "state": "asking" if still_open else "answered",
                                       "last_reply_at": now,
                                       "thread_id": t(m.get("thread_id") or intent.get("thread_id"))})
        return {"ok": True, "matched": True, "correlated": True, "how": corr["how"], "kind": contribution["kind"],
                "settled_now": len(settled_now), "awaiting": len(awaiting), "state": state, "contribution": row["id"]}

    def _upsert_soft(self, tab: str, row: dict) -> None:
        """A commRecordUpsert_ the capture wraps in try {} catch {}."""
        try:
            self.h.upsert(tab, row)
        except Exception as exc:  # noqa: BLE001
            if _db_fault(exc):
                raise

    # -- the rehearsal (test mode, a tester's reply) --

    def token_thread(self, token: str) -> dict[str, Any] | None:
        """commInboundTokenThread_: the thread a reference names — across everybody."""
        want = t(token).upper()
        if not want:
            return None
        rows = [r for r in self.h.board(CR.INTENTS) if t(r.get("state")) in ("asking", "planned")
                and t(r.get("intent_key")) and CR.reply_token(t(r.get("intent_key"))) == want]
        if len(rows) != 1:
            return {"intent": None, "found": len(rows)}
        key = t(rows[0].get("intent_key"))
        person = {"key": t(rows[0].get("person_key")), "name": t(rows[0].get("person_name"))}
        full = next((i for i in self.h.open_intents(person["key"]) if t(i.get("intent_key")) == key), None)
        return {"intent": full, "found": len(rows), "person": person}

    def rehearse(self, m: dict, mid: str, now: str) -> dict[str, Any] | None:
        """commInboundRehearse_: the rehearsed capture — the same arithmetic, and not one write of it."""
        if not self.testing():
            return None
        h = self.h
        text = t(m.get("text"))
        masked = mask(m.get("from"))
        if CR.our_echo(text):
            h.contribution_save(self.rehearsal_row(m, None, {
                "kind": "unclear", "claims": [],
                "why": "the test banner opens this message, so it is one of OUR redirected messages read back from the "
                       "tester's own mailbox — not an answer to it"}, "dismissed", "ambiguous", now, None))
            return {"ok": True, "matched": False, "own_line": True, "rehearsal": False, "echo": True}
        toks = CR.tokens(text)
        if not toks:
            return None
        if len(toks) > 1:
            h.contribution_save(self.rehearsal_row(m, None, {
                "kind": "unclear", "claims": [],
                "why": "the body carries " + str(len(toks)) + " references (" + ", ".join(toks) + ") — which thread "
                       "this answers is not knowable, and the first one is a guess"}, "dismissed", "ambiguous", now,
                None))
            h.observe("unmatched", {"person_key": "", "person_name": "", "intent_key": ""},
                      {"channel": m.get("channel"), "from": masked, "test_mode": "yes", "tokens": " · ".join(toks)},
                      "inbound", "the tester line")
            return {"ok": True, "matched": False, "own_line": True, "rehearsal": True, "correlated": False,
                    "reason": "ambiguous"}
        found = self.token_thread(toks[0])
        if not found or not found["intent"]:
            rep = CR.repair_thread(toks[0], "", h.repair_rows())
            if rep:
                r_said = CR.said_of(text)
                r_heard = CR.correction_read(r_said)
                r_ack = CR.ack_read(r_said)
                r_would = ("read this as a further correction (" + r_heard["kind"] + ") and put it in front of a person"
                           if r_heard["kind"] else
                           ("CLOSED the correction on their acknowledgement (\"" + r_ack["read_as"] + "\")"
                            if r_ack["ack"] else "put it in front of a person, because " + r_ack["why"]))
                r_corr = {"intent": {"intent_key": rep["intent_key"], "person_key": rep["person_key"],
                                     "person_name": rep["person_name"]},
                          "how": "token",
                          "why": "the tester quoted " + toks[0] + " — the reference the correction went out with"}
                r_row = self.rehearsal_row(m, r_corr, {"kind": "ack" if r_ack["ack"] else "ack-refused", "claims": [],
                                                       "why": "the machinery would have " + r_would},
                                           "needs_human", "unclear", now, None)
                r_row["repair_incident"] = t(rep["incident_id"])
                r_row["correction_kind"] = t(r_heard["kind"])
                r_row["why"] += (" · it closed nothing, enrolled nobody and left the correction exactly as open as it "
                                 "found it, because the tester answered and the person did not")
                h.contribution_save(r_row)
                h.observe("correlated", r_corr["intent"],
                          {"how": "token", "why": r_corr["why"], "message_id": mid, "from": masked,
                           "incident": rep["incident_id"], "test_mode": "yes", "rehearsal": True},
                          "inbound", "the tester line")
                h.observe("needs_human", r_corr["intent"],
                          {"reason": "rehearsal", "incident": rep["incident_id"], "contribution": r_row["id"],
                           "test_mode": "yes", "rehearsal": True}, "inbound", "the tester line")
                return {"ok": True, "matched": False, "own_line": True, "rehearsal": True, "correlated": True,
                        "how": "token", "incident": rep["incident_id"], "would_close": bool(r_ack["ack"]),
                        "state": "needs_human", "contribution": r_row["id"]}
            h.contribution_save(self.rehearsal_row(m, None, {
                "kind": "unclear", "claims": [],
                "why": "the reply quoted " + toks[0] + ", which matches "
                       + (str(found["found"]) + " open threads" if found and found["found"] > 1 else "no open thread")
                       + " and no correction either"}, "dismissed", "ambiguous", now, None))
            return {"ok": True, "matched": False, "own_line": True, "rehearsal": True, "correlated": False,
                    "reason": "ambiguous"}

        intent, person = found["intent"], found["person"]
        said = CR.said_of(text)
        corr = {"intent": intent, "how": "token",
                "why": "the tester quoted " + toks[0] + " — the reference this thread went out with"}
        h.observe("correlated", intent, {"how": "token", "why": corr["why"], "message_id": mid, "from": masked,
                                         "test_mode": "yes", "rehearsal": True}, "inbound", "the tester line")
        if CR.is_window_thread(intent):
            w_claim = CR.stated_window_read(said)
            w_would = ((w_claim["kind"] + " " + (w_claim["from"] or "(open)") + "-" + (w_claim["to"] or "(open)")
                        + (" on " + w_claim["days"] if w_claim["days"] else "")) if w_claim["confident"] else "")
            w_row = self.rehearsal_row(m, corr, {
                "kind": "window" if w_claim["confident"] else "window-unread", "claims": [],
                "why": ("the machinery would have stored " + w_would if w_claim["confident"] else "unreadable as hours")
                       + " — " + w_claim["why"]}, "needs_human", "unclear", now,
                {"would_settle": "", "would_await": ""})
            w_row.update(window_read_as=t(w_claim["read_as"]), window_from=t(w_claim["from"]),
                         window_to=t(w_claim["to"]), window_days=t(w_claim["days"]), window_stored="no",
                         would_store=w_would)
            w_row["why"] += (" · it stored nothing and the thread stays open, because the tester answered and the "
                             "person did not")
            h.contribution_save(w_row)
            h.observe("contribution", intent, {"kind": w_row["kind"], "claims": 0, "would_store": w_would,
                                               "state": "needs_human", "contribution": w_row["id"], "test_mode": "yes",
                                               "rehearsal": True}, "inbound", "the tester line")
            h.observe("needs_human", intent, {"reason": "rehearsal", "contribution": w_row["id"], "test_mode": "yes",
                                              "rehearsal": True}, "inbound", "the tester line")
            return {"ok": True, "matched": False, "own_line": True, "rehearsal": True, "correlated": True,
                    "how": "token", "intent_key": t(intent.get("intent_key")), "person_key": person["key"],
                    "kind": w_row["kind"], "would_store": w_would, "stored": False, "state": "needs_human",
                    "contribution": w_row["id"]}

        contribution = CR.contribution_of(said, intent, self.label_for)
        estate = h.estate(person["key"])
        qualified = CR.qualify(intent, contribution, lambda d: estate.get(t(d)) or {"state": "unknown"})
        would_settle: list[str] = []
        would_await: list[str] = []
        for r in qualified["results"]:
            b = next((x for x in (intent.get("bindings") or []) if t(x.get("demand_id")) == t(r["demand_id"])), None)
            if b is None:
                continue
            if r["settle"]:
                would_settle.append(t(r["demand_id"]))
            elif r["verdict"] in ("disagrees", "unknown"):
                would_await.append(t(r["demand_id"]))
        consent = CR.inbound_intent(said, self.cfg)
        consent_note = (" · the tester said \"" + consent + "\", recorded and NOT acted on: the address it would "
                        "suppress is where every message on the platform is redirected"
                        if consent and consent != "reply" else "")
        heard_note = ""
        rehearsed_heard = CR.correction_read(said)
        if rehearsed_heard["kind"]:
            heard_note = (" · the tester's words read as a correction (" + rehearsed_heard["kind"] + "): "
                          + rehearsed_heard["why"] + ". In production this would owe that person a correction; here "
                          "it enrolled nobody and wrote no incident")
        reason = self.reason(corr, contribution, qualified) or ""
        row = self.rehearsal_row(m, corr, contribution, "needs_human", reason, now,
                                 {"would_settle": " · ".join(would_settle), "would_await": " · ".join(would_await)})
        row["why"] += (" · the machinery would have settled " + (str(len(would_settle)) if would_settle else "nothing")
                       + " and sent " + (str(len(would_await)) if would_await else "nothing") + " to the owner; it did "
                       "neither, because the tester answered and the person did not" + consent_note + heard_note)
        row["correction_kind"] = t(rehearsed_heard["kind"])
        h.contribution_save(row)
        h.observe("contribution", intent, {"kind": contribution["kind"], "claims": len(contribution["claims"] or []),
                                           "would_settle": len(would_settle), "would_await": len(would_await),
                                           "state": "needs_human", "contribution": row["id"], "test_mode": "yes",
                                           "rehearsal": True, "consent": "" if consent == "reply" else consent},
                  "inbound", "the tester line")
        h.observe("needs_human", intent, {"reason": reason or "rehearsal", "contribution": row["id"],
                                          "test_mode": "yes", "rehearsal": True}, "inbound", "the tester line")
        return {"ok": True, "matched": False, "own_line": True, "rehearsal": True, "correlated": True, "how": "token",
                "intent_key": t(intent.get("intent_key")), "person_key": person["key"], "kind": contribution["kind"],
                "would_settle": len(would_settle), "would_await": len(would_await), "state": "needs_human",
                "contribution": row["id"]}

    # -- a window answer, heard --

    def consent_window_save(self, person_key: str, person_name: str, claim: dict, said: str, source: str,
                            message_id: str, now: str) -> dict[str, Any]:
        """commConsentWindowSave_: a later answer supersedes, the earlier one stays; stored only once it reads back."""
        key = low(person_key)
        if not key:
            return {"ok": False, "why": "no person key — a window belongs to somebody or to nobody"}
        if not gsjs.trim(t(person_name)):
            return {"ok": False, "why": "the People house holds no name for this person, and the consent store is "
                                        "keyed by name"}
        if t((claim or {}).get("kind")) not in CR.CONSENT_WINDOW_KINDS:
            return {"ok": False, "why": "not a kind of answer this store may hold: "
                                        + t((claim or {}).get("kind") or "nothing")}
        row = CR.window_row(key, person_name, claim, said, source, message_id, now)
        superseded = 0
        try:
            prior = self.h.consent_window_for(key)
            if prior and prior.get("row_id"):
                same = (prior["kind"] == row["window_kind"] and prior["from"] == row["window_from"]
                        and prior["to"] == row["window_to"] and prior["days"] == row["window_days"])
                if not same:
                    keep = CR.window_row(key, person_name, {"kind": prior["kind"], "from": prior["from"],
                                                            "to": prior["to"], "days": prior["days"],
                                                            "read_as": prior["read_as"]},
                                         prior["words"], prior["source"], "", prior["said_at"])
                    keep["id"] = CR.CONSENT_WINDOW_PREFIX + CR.record_id(key + "|window|" + t(prior["said_at"] or now))
                    keep.update(window_state="superseded", window_said_at=t(prior["said_at"]),
                                window_superseded_at=t(now), window_superseded_by=row["id"])
                    self.h.upsert(CR.CONSENT, keep)
                    superseded = 1
        except Exception as exc:  # noqa: BLE001
            if _db_fault(exc):
                raise
        try:
            self.h.upsert(CR.CONSENT, row)
        except Exception as exc:  # noqa: BLE001
            if _db_fault(exc):
                raise
            return {"ok": False, "why": "the consent store did not accept the row: " + str(exc)[:120]}
        back = self.h.consent_window_for(key)
        if not back or t(back.get("row_id")) != row["id"]:
            return {"ok": False, "superseded": superseded,
                    "why": "the row did not read back out of " + CR.CONSENT + " — the store took nothing, so nothing "
                           "may be treated as stored"}
        return {"ok": True, "id": row["id"], "superseded": superseded,
                "why": "stored as " + (row["window_kind"] or "window")
                       + (" " + (row["window_from"] or "(open)") + "-" + (row["window_to"] or "(open)")
                          if row["window_from"] or row["window_to"] else "")
                       + (" · " + row["window_days"] if row["window_days"] else "")}

    def window_handle(self, m: dict, who: dict, corr: dict, intent: dict, now: str) -> dict[str, Any]:
        """commStatedWindowHandle_: a window answer, heard; the asking stops on a stored fact."""
        h = self.h
        mid = t(m.get("message_id"))
        said = CR.said_of(t(m.get("text")))
        claim = CR.stated_window_read(said)
        channel = "email" if t(m.get("channel")) == "email" else "sms"
        source = "the person, by " + channel
        person_key = t(intent.get("person_key") or (who or {}).get("key"))
        person_name = t((who or {}).get("name") or intent.get("person_name"))
        stored = None
        if claim["confident"]:
            stored = self.consent_window_save(person_key, person_name, claim, said, source, mid, now)
        ok = bool(stored and stored.get("ok"))
        state, reason = "settled", ""
        why = claim["why"]
        if not claim["confident"]:
            state, reason = "needs_human", "unclear"
            why = ("NOT STORED — " + why + ". Their own words are on this row, unedited, and what they meant is a "
                   "person's to read")
        elif not ok:
            state, reason = "needs_human", "unclear"
            why = ("READ BUT NOT STORED — we read this as " + claim["read_as"] + ", and the consent store did not take "
                   "it (" + t((stored or {}).get("why") or "no answer") + "). Nothing may be treated as on record")
        else:
            why = ("STORED as " + claim["read_as"] + " — " + why
                   + (". Their earlier answer was superseded, not deleted" if stored.get("superseded") else ""))
            if claim["channel_named"]:
                state, reason = "needs_human", "unclear"
                why += (". THEY ALSO NAMED A CHANNEL: the hours are on record, the route is not — this lane has a "
                        "store for hours and none for routes, and changing somebody's route on a parse would be the "
                        "same misread with a louder consequence")
        contribution = {"kind": "window" if ok else "window-unread", "claims": [], "why": why}
        row = CR.contribution_row(m, who, corr, contribution, state, reason, now)
        row.update(claims="", settled_now="", awaiting="", window_read_as=t(claim["read_as"]),
                   window_from=t(claim["from"]), window_to=t(claim["to"]), window_days=t(claim["days"]),
                   window_stored="yes" if ok else "no", window_row=t(stored.get("id")) if ok else "")
        h.contribution_save(row)
        if ok:
            h.observe("consent_changed", intent, {"channel": m.get("channel"), "intent": "window_stated",
                                                  "kind": claim["kind"], "window_from": claim["from"],
                                                  "window_to": claim["to"], "window_days": claim["days"],
                                                  "superseded": stored.get("superseded") or 0, "row": stored.get("id"),
                                                  "contribution": row["id"]}, "inbound", "the person")
        h.observe("contribution", intent, {"kind": contribution["kind"], "claims": 0, "state": state,
                                           "stored": "yes" if ok else "no", "read_as": claim["read_as"],
                                           "contribution": row["id"]}, "inbound")
        if state == "needs_human":
            h.observe("needs_human", intent, {"reason": reason, "why": CR.cut(why, 200), "contribution": row["id"]},
                      "inbound")
        self._upsert_soft(CR.INTENTS, {"id": intent.get("id"), "state": "answered", "last_reply_at": now,
                                       "thread_id": t(m.get("thread_id") or intent.get("thread_id"))})
        return {"ok": True, "matched": True, "correlated": True, "how": corr["how"], "kind": contribution["kind"],
                "window": ((claim["from"] or "(open)") + "-" + (claim["to"] or "(open)")) if ok else "",
                "stored": ok, "state": state, "contribution": row["id"]}

    # -- the third way in: a correction --

    def correction_owed(self, person_key: str, person_name: str, kind: str, said: str, channel: str,
                        now: str) -> dict[str, Any]:
        """commCorrectionOwed_: is a correction already owed to this person, and if not, owe them one."""
        key = low(person_key)
        out: dict[str, Any] = {"held": "", "incident_id": "", "incident_state": "", "enrolled": False,
                               "ledger_ok": True, "why": ""}
        if not key or kind not in CR.CORRECTION_KINDS:
            out.update(ledger_ok=False, why="no person key to owe a correction to")
            return out
        rows = self.h.repair_rows()
        incidents = CR._incidents(rows)
        rank = {"repaired": 4, "claimed": 3, "planned": 2, "undeliverable": 1}
        best, best_rank = None, 0
        for r in rows:
            if t(r.get("kind")) != "person" or low(r.get("person_key")) != key:
                continue
            n = rank.get(t(r.get("claim_state") or "planned"), 0)
            if n > best_rank:
                best_rank, best = n, r
        if best is not None:
            out["held"] = t(best.get("claim_state") or "planned")
            out["incident_id"] = t(best.get("incident_id"))
            out["incident_state"] = t((incidents.get(out["incident_id"]) or {}).get("state"))
            return out
        incident_id = CR.correction_incident_id(key, kind)
        quote = CR.cut(gsjs.trim(re.sub(r"\s+", " ", t(said))), 200)
        try:
            self.h.repair_upsert(CR.repair_incident_row(self.reads, {
                "incident_id": incident_id, "situation": "", "window_from": "", "window_to": "",
                "what_was_wrong": CR.CORRECTION_WHAT[kind] + " — in their words: \"" + quote + "\"",
                "state": "declared", "audience": 1, "declared_by": "the person themselves, by " + t(channel),
                "declared_at": t(now),
                "note": "reported by the person, not detected: the audience is this one person and the window is "
                        "blank, so no other audience can be swept into it"}, now))
            self.h.repair_upsert(CR.repair_person_row(incident_id, {"person_key": key, "person_name": t(person_name)},
                                                      now))
            out.update(enrolled=True, incident_id=incident_id, incident_state="declared")
        except Exception as exc:  # noqa: BLE001
            if _db_fault(exc):
                raise
            out.update(ledger_ok=False, incident_id=incident_id,
                       why="the incidents ledger refused the row (" + str(exc)[:160] + "), so nothing is queued — a "
                           "person owes them this")
        return out

    def correction_handle(self, m: dict, who: dict, corr: dict, heard: dict, said: str, now: str) -> dict[str, Any]:
        """commCorrectionHandle_: they corrected us — the whole path, ending in a row on disk every time."""
        h = self.h
        channel = "email" if t(m.get("channel")) == "email" else "sms"
        owed = self.correction_owed(who["key"], who["name"], heard["kind"], said, channel, now)
        state, reason, close = "awaiting_owner", "correction", ""
        why = heard["why"]
        if not owed["ledger_ok"]:
            state, reason = "needs_human", "correction"
            why += " · " + owed["why"]
        elif owed["enrolled"]:
            why += (" · nobody owed them a word yet, so incident " + owed["incident_id"] + " was written with an "
                    "audience of one — themselves. It is DECLARED and not confirmed: an admin confirms it and the "
                    "repair pass says it through the same door every other message uses")
        elif owed["held"] == "repaired":
            state, reason = "needs_human", "correction-again"
            why += (" · WE ALREADY CORRECTED THIS TO THEM (incident " + owed["incident_id"] + ") and they are telling "
                    "us again, so the correction did not land. No second message is sent — a correction is never said "
                    "twice — and a person has to read this one")
        elif owed["held"] == "undeliverable":
            state, reason = "needs_human", "correction"
            why += (" · a correction is already owed to them under incident " + owed["incident_id"] + " and could not "
                    "be delivered by message, which is a person's job. This reply is the person, asking")
        elif owed["held"] == "claimed" or (owed["held"] == "planned" and owed["incident_state"] == "confirmed"):
            state, reason, close = "dismissed", "already-owed", "machine"
            why += (" · the correction is already " + ("going out" if owed["held"] == "claimed" else "queued")
                    + " under incident " + owed["incident_id"] + ". Nothing was added and nothing was said twice; "
                    "their telling us is recorded here")
        else:
            why += (" · a correction is already planned for them under incident " + owed["incident_id"] + ", which "
                    "nobody has confirmed yet. It waits on the same person this row does")
        if heard["also_ask"] and state == "dismissed":
            state, reason, close = "needs_human", "unclear", ""
            why += (" · AND they said something about what we asked them for. The estate was not asked — this path "
                    "does not settle obligations — so a person reads that half")
        contribution = {"kind": "correction:" + heard["kind"], "claims": [], "why": why}
        row = CR.contribution_row(m, who, corr, contribution, state, reason, now)
        row.update(claims="", settled_now="", awaiting="", correction_kind=t(heard["kind"]),
                   repair_incident=t(owed["incident_id"]))
        if close:
            row.update(close=close, closed_at=now)
        h.contribution_save(row)
        light = {"intent_key": t(((corr or {}).get("intent") or {}).get("intent_key")), "person_key": t(who["key"]),
                 "person_name": t(who["name"])}
        h.observe("contribution", light, {"channel": m.get("channel"), "kind": contribution["kind"],
                                          "correction": heard["kind"], "incident": owed["incident_id"],
                                          "held": owed["held"] or "nothing", "enrolled": owed["enrolled"],
                                          "state": state, "contribution": row["id"], "said": CR.cut(t(said), 300)},
                  "inbound", "the person")
        if close == "machine":
            h.observe("dismissed", light, {"reason": reason, "why": CR.cut(why, 200), "incident": owed["incident_id"],
                                           "said": CR.cut(t(said), 300), "close": "machine", "contribution": row["id"]},
                      "inbound", "the person")
        else:
            h.observe("needs_human", light, {"reason": reason, "why": CR.cut(why, 200),
                                             "incident": owed["incident_id"], "contribution": row["id"]}, "inbound")
        return {"ok": True, "matched": True, "correction": heard["kind"], "incident": owed["incident_id"],
                "enrolled": owed["enrolled"], "held": owed["held"], "state": state, "contribution": row["id"]}

    # -- the close: a reply to an apology --

    def close_repair_reply(self, m: dict, who: dict, corr: dict, said: str, opened: list[dict],
                           now: str) -> dict[str, Any]:
        """commCloseRepairReply_: a reply to an apology, and the end of that thread."""
        h = self.h
        none: dict[str, Any] = {"handled": False, "note": ""}
        toks = CR.tokens(t(m.get("text")))
        if len(toks) > 1:
            return none
        rows = h.repair_rows()
        if not rows:
            return none
        if len(toks) == 1:
            thread = CR.repair_thread(toks[0], who["key"], rows)
            if not thread:
                return none
            how = "token"
        else:
            mine = CR.repairs_for(who["key"], rows)
            if not mine:
                return none
            if len(mine) > 1:
                return {"handled": False,
                        "note": " — and " + str(len(mine)) + " corrections have been said to this person, so which "
                                "apology this answers is no more knowable than which question it answers"}
            if opened:
                return {"handled": False,
                        "note": " — a correction (incident " + mine[0]["incident_id"] + ") was also said to them and "
                                "is still open. Reading this reply into it because nothing else fits is the fourth "
                                "rung of the ladder, and one click of this desk finishes what it refused"}
            if self.testing():
                return {"handled": False,
                        "note": " — a correction (incident " + mine[0]["incident_id"] + ") was said to them, but test "
                                "mode is on: every message goes to the tester line, which many colleagues read, so a "
                                "reply names its thread by quoting the Ref or not at all"}
            thread, how = mine[0], "sole-repair"
        ack = CR.ack_read(said)
        light_corr = {"intent": {"intent_key": thread["intent_key"], "person_key": thread["person_key"],
                                 "person_name": thread["person_name"] or who["name"]},
                      "how": how,
                      "why": ("the reply quoted " + toks[0] + ", the reference the correction went out with"
                              if how == "token" else "exactly one correction has been said to this person and nothing "
                                                     "else of theirs is open")}
        close = ""
        if ack["ack"]:
            state, reason, close = "dismissed", "acknowledged", "machine"
            why = ("CLOSED — they answered our correction with \"" + ack["read_as"] + "\" and nothing else. A "
                   "correction asks for nothing, so an acknowledgement finishes it: there is no obligation to settle, "
                   "nothing for an owner to decide, and their words are on this row and in the trail")
        else:
            state, reason = "needs_human", "unclear"
            why = ("THEY ANSWERED OUR CORRECTION AND THIS READER WOULD NOT CLOSE IT: " + ack["why"] + ". Their own "
                   "words are on this row, unedited. Closing a question as an acknowledgement loses it for ever, and "
                   "they will not ask twice")
        why += (" · correction " + thread["incident_id"] + ", said "
                + ("at " + thread["told_at"] if thread["told_at"] else "to them")
                + (" by " + thread["told_channel"] if thread["told_channel"] else ""))
        contribution = {"kind": "ack" if ack["ack"] else "ack-refused", "claims": [], "why": why}
        row = CR.contribution_row(m, who, light_corr, contribution, state, reason, now)
        row.update(claims="", settled_now="", awaiting="", repair_incident=t(thread["incident_id"]))
        if close:
            row.update(close=close, closed_at=now)
        h.contribution_save(row)
        try:
            h.repair_upsert({"id": thread["id"],
                             "note": ("answered and closed: \"" if ack["ack"] else
                                      "answered, and a person is reading it: \"")
                                     + CR.cut(gsjs.trim(re.sub(r"\s+", " ", t(said))), 160) + "\""})
        except Exception as exc:  # noqa: BLE001 - the contribution row carries the answer either way
            if _db_fault(exc):
                raise
        light = {"intent_key": thread["intent_key"], "person_key": thread["person_key"],
                 "person_name": thread["person_name"] or who["name"]}
        h.observe("correlated", light, {"how": how, "why": light_corr["why"], "message_id": t(m.get("message_id")),
                                        "incident": thread["incident_id"]}, "inbound")
        if ack["ack"]:
            h.observe("dismissed", light, {"reason": "acknowledged", "close": "machine",
                                           "incident": thread["incident_id"], "said": CR.cut(t(said), 300),
                                           "contribution": row["id"]}, "inbound", "the person")
        else:
            h.observe("needs_human", light, {"reason": reason, "why": CR.cut(ack["why"], 200),
                                             "incident": thread["incident_id"], "contribution": row["id"]}, "inbound")
        return {"handled": True,
                "result": {"ok": True, "matched": True, "correlated": True, "how": how, "kind": contribution["kind"],
                           "incident": thread["incident_id"], "closed": bool(ack["ack"]), "state": state,
                           "contribution": row["id"]}}


# ---- THE CLOSE, ON THE CLOCK -----------------------------------------------------------------------------------------

def close_sweep(houses: Houses) -> dict[str, int]:
    """commCloseSweep_: what finishes when nobody says anything more — one pass of the endings."""
    h = houses
    now_dt = datetime.now(timezone.utc)
    now_iso, now_ms = gsjs.iso(now_dt), now_dt.timestamp() * 1000.0
    day = 86400000.0
    out = {"incidents_closed": 0, "closed_on_silence": 0, "closed_answered": 0, "desk_closed": 0, "escalated": 0,
           "still_open": 0, "held_by_desk": 0, "undeclared": 0, "stalled": 0, "wrote": 0}
    repairs = h.repair_rows()
    incidents: dict[str, dict] = {}
    by_incident: dict[str, list[dict]] = {}
    for r in repairs:
        if t(r.get("kind")) == "incident":
            incidents[t(r.get("incident_id"))] = r
            continue
        if t(r.get("kind")) != "person":
            continue
        by_incident.setdefault(t(r.get("incident_id")), []).append(r)
    answered_at: dict[str, float] = {}
    open_on: dict[str, int] = {}
    desk_open: list[dict] = []
    for r in h.board(CR.CONTRIBUTIONS):
        inc = t(r.get("repair_incident"))
        at = CR.ms(r.get("received_at"))
        if inc and at and at > answered_at.get(inc, 0):
            answered_at[inc] = at
        if not CR.contribution_open(r):
            continue
        desk_open.append(r)
        if inc:
            open_on[inc] = open_on.get(inc, 0) + 1

    for dr in desk_open:
        if out["wrote"] >= CR.CLOSE_PER_PASS:
            break
        d_inc = t(dr.get("repair_incident"))
        if not d_inc or t(dr.get("state")) != "awaiting_owner" or t(dr.get("reason")) != "correction":
            continue
        inc_row = incidents.get(d_inc)
        if not inc_row:
            continue
        i_state = t(inc_row.get("state"))
        if i_state == "confirmed":
            if h.contribution_close(gsjs.js_str(dr.get("id")), "dismissed", "machine", "already-owed",
                                    "the correction they reported was confirmed and the repair pass owes them the word "
                                    "— there is nothing left on this desk for this row", now_iso):
                out["wrote"] += 1
                out["desk_closed"] += 1
                open_on[d_inc] = max(0, (open_on.get(d_inc) or 1) - 1)
        elif i_state in ("dismissed", "closed"):
            if h.contribution_close(gsjs.js_str(dr.get("id")), "dismissed", "person", "incident-" + i_state,
                                    "the incident they reported was " + i_state + " by "
                                    + t(inc_row.get("confirmed_by") or inc_row.get("declared_by") or "an admin")
                                    + " — a person's decision, and this row ends with it", now_iso):
                out["wrote"] += 1
                out["desk_closed"] += 1
                open_on[d_inc] = max(0, (open_on.get(d_inc) or 1) - 1)

    for iid, inc in list(incidents.items()):
        if out["wrote"] >= CR.CLOSE_PER_PASS:
            break
        state = t(inc.get("state"))
        if state in ("closed", "dismissed"):
            continue
        if state != "confirmed":
            declared_ms = CR.ms(inc.get("declared_at") or inc.get("createdAt"))
            if not declared_ms:
                continue
            age = now_ms - declared_ms
            if age > CR.CLOSE_LOUD_DAYS * day and "UNCONFIRMED" not in t(inc.get("note")):
                try:
                    h.repair_upsert({"id": gsjs.js_str(inc.get("id")),
                                     "note": t(inc.get("note"))
                                     + " · UNCONFIRMED: nobody has confirmed this correction"})
                    out["wrote"] += 1
                    out["undeclared"] += 1
                except Exception as exc:  # noqa: BLE001 - the log below is the other half
                    if _db_fault(exc):
                        raise
                log_line("comm_close_unconfirmed", "incident " + iid + " has been waiting on a decision for "
                         + str(int(age // day)) + " days: " + CR.cut(t(inc.get("what_was_wrong")), 160)
                         + " — a correction nobody confirmed is a correction nobody made", 500)
            continue
        mine = by_incident.get(iid) or []
        if not mine:
            continue
        unfinished, last_told = 0, 0.0
        for p in mine:
            if t(p.get("claim_state") or "planned") not in ("repaired", "undeliverable"):
                unfinished += 1
            told = CR.ms(p.get("told_at"))
            if told > last_told:
                last_told = told
        if unfinished:
            confirmed_ms = CR.ms(inc.get("confirmed_at") or inc.get("declared_at") or inc.get("createdAt"))
            if not confirmed_ms:
                continue
            stalled = now_ms - confirmed_ms
            if stalled > CR.CLOSE_LOUD_DAYS * day and "STALLED" not in t(inc.get("note")):
                try:
                    h.repair_upsert({"id": gsjs.js_str(inc.get("id")),
                                     "note": t(inc.get("note")) + " · STALLED: " + str(unfinished) + " person(s) "
                                             "confirmed and still waiting for the word"})
                    out["wrote"] += 1
                    out["stalled"] += 1
                except Exception as exc:  # noqa: BLE001 - the log below is the other half
                    if _db_fault(exc):
                        raise
                log_line("comm_close_stalled", "incident " + iid + " was confirmed " + str(int(stalled // day))
                         + " days ago and " + str(unfinished) + " person(s) in it have still not been told: "
                         + CR.cut(t(inc.get("what_was_wrong")), 160)
                         + " — a correction confirmed and never said is a correction nobody made", 500)
            continue
        if not last_told:
            continue
        if open_on.get(iid):
            out["held_by_desk"] += 1
            continue
        answered = (answered_at.get(iid) or 0) > last_told
        if not answered and now_ms - last_told < CR.CLOSE_SILENCE_DAYS * day:
            continue
        why = ("answered, and the last word was dealt with — nothing is owed on either side" if answered else
               "nobody answered it in " + str(CR.CLOSE_SILENCE_DAYS) + " days. A correction asks for nothing, so "
               "silence is an ending and not a question left hanging; no further word is ever sent")
        try:
            h.repair_upsert({"id": gsjs.js_str(inc.get("id")), "state": "closed", "closed_at": now_iso,
                             "note": (t(inc.get("note")) + " · " if t(inc.get("note")) else "") + "closed: " + why})
            out["wrote"] += 1
            out["incidents_closed"] += 1
            out["closed_answered" if answered else "closed_on_silence"] += 1
        except Exception as exc:  # noqa: BLE001
            if _db_fault(exc):
                raise
            continue
        h.observe("dismissed" if answered else "unanswered", {"intent_key": "repair." + iid, "person_key": "",
                                                              "person_name": ""},
                  {"incident": iid, "people": len(mine), "why": why, "close": "person" if answered else "silence",
                   "last_told": CR.iso_of(last_told)}, "close", "the clock")

    for row in desk_open:
        if out["wrote"] >= CR.CLOSE_PER_PASS:
            break
        if t(row.get("escalated_at")):
            continue
        at = CR.ms(row.get("received_at"))
        if not at or now_ms - at < CR.CLOSE_LOUD_DAYS * day:
            continue
        if not CR.contribution_open(row):
            continue
        if h.contribution_save({"id": gsjs.js_str(row.get("id")), "escalated_at": now_iso}):
            out["wrote"] += 1
            out["escalated"] += 1
            h.observe("escalated", {"intent_key": t(row.get("intent_key")), "person_key": t(row.get("person_key")),
                                    "person_name": t(row.get("person_name"))},
                      {"reason": t(row.get("reason")), "state": t(row.get("state")),
                       "days": int((now_ms - at) // day), "contribution": gsjs.js_str(row.get("id")),
                       "said": CR.cut(t(row.get("text")), 300)}, "close", "the clock")
    out["still_open"] = max(0, len(desk_open) - out["desk_closed"])
    if out["wrote"]:
        log_line("comm_close_swept",
                 f"{out['incidents_closed']} correction(s) finished ({out['closed_on_silence']} on silence, "
                 f"{out['closed_answered']} answered) · {out['desk_closed']} desk row(s) closed by a decision already "
                 f"made · {out['escalated']} waiting on a person for more than {CR.CLOSE_LOUD_DAYS} days, said out "
                 f"loud once · {out['undeclared']} incident(s) nobody has confirmed · {out['stalled']} confirmed and "
                 "not reaching anybody", 500 if out["escalated"] or out["undeclared"] or out["stalled"] else 200)
    return out


# ---- the stamps ------------------------------------------------------------------------------------------------------

def _set_state(key: str, value: str) -> None:
    """props.setProperty on app.comm_replies_state, the value replaced kept for a void."""
    RR._cur().execute(
        f"insert into {CR.STATE} as s (key, value, prev, write_id) values (%s, %s, '', %s)"
        " on conflict (key) do update set prev = s.value, value = excluded.value, write_id = excluded.write_id,"
        " updated_at = now()", (key, value, SC.write_id()))


def _due_stamped(reads: L.Reads, key: str, gap_s: float) -> bool:
    """commMailDue_ / commCloseSweepMaybe_: the window, stamped before the work — a crash costs one pass, never a
    loop."""
    now = datetime.now(timezone.utc).timestamp() * 1000.0
    if not CR.window_open(CR.stamps(reads), key, gap_s, now):
        return False
    _set_state(key, gsjs.num_str(int(now)))
    return True


# ---- the door --------------------------------------------------------------------------------------------------------

TALLY = ("read", "mine", "captured", "already", "not_a_person", "no_thread", "tester", "corrections")


def _tally(v: Any, look: dict) -> dict[str, Any]:
    got = v if isinstance(v, dict) else {}
    out: dict[str, Any] = {}
    for k in TALLY:
        try:
            out[k] = max(0, int(got.get(k) or 0))
        except (TypeError, ValueError):
            out[k] = 0
    if not isinstance(v, dict):
        out["read"] = int(look.get("read") or 0)
        out["not_a_person"] = int(look.get("not_a_person") or 0)
    if isinstance(got.get("closed"), dict):
        out["closed"] = got["closed"]
    return out


def replies_keep(sess: L.Session, payload: dict) -> Decision:
    """commRepliesKeep (the relay's own): commRepliesSweep's writing half for what commRepliesDue read. The first pass
    (`first`) stamps and closes; every pass captures `threads` until its seconds are spent, hands back `left`, and
    carries the counts in `tally`; the sweep's line is written when nothing is left."""
    if (sess.user or {}).get("is_service") is not True:
        return Decision({"status": 403, "message": "This is the relay's own write."})
    reads = sess.reads
    CR.owned(reads)
    started = time.time()
    p = payload if isinstance(payload, dict) else {}
    look = p.get("look") if isinstance(p.get("look"), dict) else {}
    threads = [x for x in (p.get("threads") or []) if isinstance(x, dict)]
    h = Houses(reads)
    out = _tally(p.get("tally"), look)

    def answer(env: dict[str, Any]) -> Decision:
        return Decision(env, edits=h.edits() or None, subject=SUBJECT, own=True)

    if p.get("first") is True:
        if look.get("force") is not True and not _due_stamped(reads, CR.MAIL_SWEEP_KEY, CR.MAIL_SWEEP_GAP_S):
            return answer({"status": 200, "data": {"skipped": True, "why": "inside the fifteen-minute window"}})
        closed = None
        if _due_stamped(reads, CR.CLOSE_SWEEP_KEY, CR.CLOSE_SWEEP_GAP_S):
            try:
                closed = close_sweep(h)
            except Exception as exc:  # noqa: BLE001
                if _db_fault(exc):
                    raise
                closed = None
        if closed is not None:
            out["closed"] = closed
        if t(look.get("dial")) == "off":
            data: dict[str, Any] = {"skipped": True, "why": "the dial is off — nobody was asked anything"}
            if closed is not None:
                data["closed"] = closed
            return answer({"status": 200, "data": data})
        inbox = look.get("inbox") if isinstance(look.get("inbox"), dict) else {}
        if inbox.get("status") != 200:
            return answer({"status": 502, "message": "the mailbox did not answer: "
                                                     + CR.cut(t(inbox.get("message")) or "undefined", 120)})
        if not out["read"]:
            data = {"read": 0, "captured": 0, "note": "an empty inbox"}
            if closed is not None:
                data["closed"] = closed
            return answer({"status": 200, "data": data})

    by = CR.people_by_contact(reads)
    ear = Ear(reads, h, by)
    repair_rows: list[dict] | None = None
    left: list[dict] = []
    done_here = 0
    for i, th in enumerate(threads):
        if done_here and time.time() - started > PASS_S:
            left = threads[i:]
            break
        done_here += 1
        mid = t(th.get("id"))
        frm = CR.mail_address(th.get("from"))
        if not mid or not frm:
            continue
        m = {"channel": "email", "message_id": mid, "from": frm, "to": t(th.get("to")), "text": t(th.get("snippet")),
             "at": t(th.get("date") or CR.now_iso()), "thread_id": "", "source": "mailbox"}
        if not by["email"].get(frm):
            if not CR.tester(ear.cfg, frm, "email"):
                out["not_a_person"] += 1
                continue
            out["tester"] += 1
            if h.contribution_exists(mid):
                out["already"] += 1
                continue
        else:
            out["mine"] += 1
            if h.contribution_exists(mid):
                out["already"] += 1
                continue
            who = by["email"][frm]
            if not h.open_intents(who["key"]):
                if repair_rows is None:
                    repair_rows = h.repair_rows()
                if not CR.repairs_for(who["key"], repair_rows):
                    out["no_thread"] += 1
                    continue
                out["corrections"] += 1
        try:
            r = ear.capture(m)
            if r and r.get("ok") and not r.get("already"):
                out["captured"] += 1
        except Exception as exc:  # noqa: BLE001 - the next pass retries it
            if _db_fault(exc):
                raise
            log_line("comm_mail_failed", mid + ": " + (str(exc) or type(exc).__name__), 500)
    if not left and out["captured"]:
        log_line("comm_mail_swept",
                 f"{out['captured']} repl(y|ies) read of {out['mine']} from people we know · {out['already']} seen "
                 f"before · {out['no_thread']} with nothing open"
                 + (f" · {out['corrections']} answering a correction" if out["corrections"] else "")
                 + (f" · {out['tester']} from a tester (test mode)" if out["tester"] else ""))
    data = dict(out)
    if left:
        data["left"] = left
    return answer({"status": 200, "data": data})


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {"commRepliesKeep": replies_keep}
POLICY: dict[str, dict[str, Any]] = {"commRepliesKeep": {}}
BUSY_OF: dict[str, dict[str, Any]] = {"commRepliesKeep": {"status": 409, "message": BUSY}}


class Store(RR.Store):
    """app.comm_replies_writes and _receipts; the comm houses' rows app.edits', the opt-out list app.resource_rows',
    the stamps app.comm_replies_state — a void takes the rows back and puts each stamp where it was."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="comm_replies", label="Mailbox ear")

    def settle(self, write_id: str, state: str, why: str = "", fields: list[str] | None = None) -> bool:
        done = super().settle(write_id, state, why, fields)
        if state == "void" and done:
            try:
                with self.conn().transaction():
                    self.conn().execute(f"update {CR.STATE} set value = prev, write_id = '', updated_at = now()"
                                        " where write_id = %s", (write_id,))
            except Exception as exc:  # noqa: BLE001 - said, never raised into the relay's settle
                W.log.warning("mailbox ear: the void of %s left the stamps (%s)", write_id[:40], type(exc).__name__)
        return done
