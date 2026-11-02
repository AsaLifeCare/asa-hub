"""What a lane writes down when the sending dial held its message (Rpc.gs hubRehearsalHeld_, with the mock outbox's
row of CommMock.gs commMockHeld_): the words into the rehearsal book (comm_rehearsal) and the mock outbox (comm_mock),
each a row of its own table (comm_logs) kept in the write that held them — nobody contacted, nothing in Smart Comms'
outbox. The lanes
that ask it name the person themselves: their situations' events are about no person (open_shift, recruit_book), so
commMockPersonFrom_ answers nothing for them. commDialHeldWhy_ is the one sentence for such a message."""
from __future__ import annotations

import hashlib
import re
import time
import uuid
from datetime import datetime, timezone
from typing import Any

import comm_logs
import comm_repair as CRP
import gsjs
import locations as L
import resource_rows as RR
import smart_comms as SC
import smart_comms_desk as SCD
import smart_comms_doors as SCO
import smart_comms_writes as SW
import staff_views
import writes as W

REHEARSAL_TAB = SC.REHEARSAL_TAB
MOCK_TAB = SC.MOCK_TAB
# CommMock.gs COMM_MOCK_PER_EXECUTION: the outbox's cap; past it a row is counted, not written
MOCK_PER_EXECUTION = 200
HELD_PASS_BY = "asa-hub:held-by-the-dial"
_LANE = re.compile(r"^comms:\s*([^·]+)·\s*(.+)$")

s_ = gsjs.str_


def dial_held_why(dial: Any, resolved: Any, what: Any) -> str:
    """commDialHeldWhy_."""
    return ("the sending dial stands at `" + (gsjs.or_text(dial) or "off") + "`, not `send`: "
            + (gsjs.or_text(what) + " " if gsjs.or_text(what) else "this audience ")
            + "was resolved (" + (gsjs.num_str(resolved) if isinstance(resolved, (int, float)) else str(resolved))
            + ") and written down, and NOBODY WAS CONTACTED. The turn is still owed — nothing was claimed, so this "
            "row can still take it. IT IS NOT A QUEUE: nothing re-sends this one, so turning test mode off — the dial "
            "follows it — hands over the NEXT call-off or the next caller, and what stands for this one is the mock "
            "outbox, the rehearsal book and this row.")


def _now_iso() -> str:
    return gsjs.iso(datetime.now(timezone.utc))


class Held:
    """One execution's rehearsal pass and sequence (HUB_REHEARSAL_PASS, HUB_REHEARSAL_SEQ), the mock outbox's count,
    and the rows they keep, in the write's own transaction (the edits list is the write's, for its other records)."""

    def __init__(self, reads: L.Reads, edits: list[dict]) -> None:
        self.reads = reads
        self.edits = edits
        self.run = SC._Run(time.time())
        self._pass = ""
        self.seq = 0
        self.mocked = 0
        self.capped = 0
        self._made: set[str] = set()
        self._brakes: dict[str, Any] | None = None

    @staticmethod
    def _keep(name: str, rec: dict) -> bool:
        """One row of a test log under the write being decided; raised when no write holds the lock."""
        cur = W.HELD.get()
        if cur is None:
            raise RuntimeError("a test log row is kept only under the platform's write lock")
        held = SC._WRITE.get() or {}
        return comm_logs.keep(cur, name, rec, SC.write_id(), s_(held.get("door")))

    def brakes(self) -> dict[str, Any]:
        """The switch as the rows record it: the dial, test mode's position, the send switch."""
        if self._brakes is None:
            self._brakes = SC.brakes(self.reads.db, RR._cur())
        return self._brakes

    def _to_sheet(self) -> bool:
        """hubRehearsalToSheet_: test mode on in any position, or a switch that cannot be read."""
        try:
            return CRP.test_mode(self.reads)
        except Exception:  # noqa: BLE001 - an unread switch holds
            return True

    def pass_id(self) -> str:
        """hubRehearsalPassId_: minted once per execution, and the brake that opened it said."""
        if not self._pass:
            self._pass = "RHP_" + re.sub(r"[^0-9]", "", _now_iso())[:14] + "_" + str(uuid.uuid4())[:6]
            staff_views.record({"email": "asa-hub:rpc"}, "rehearsal_pass_opened", self._pass + " — " + (
                "the test dial is at the sheet; nothing leaves this platform until it says on or off again"
                if self._to_sheet() else
                "a lane held its own message and wrote the words down instead; the sending dial is what decides "
                "whether they leave"))
        return self._pass

    def _testers(self, channel: str) -> list[str]:
        """hubTestRedirect_'s testers for the channel, when test mode is on."""
        try:
            st = SCD.test_mode_state(self.reads.config())
        except Exception:  # noqa: BLE001 - nobody the rehearsal would have reached
            return []
        if not st["on"]:
            return []
        return list(st["emails"] if channel == "email" else st["sms"])

    def held(self, w: dict[str, Any]) -> str:
        """hubRehearsalHeld_: the rehearsal row (hubRehearsalRow_ under the lane's context), then the mock outbox's
        row whether or not that one landed; the rehearsal row's id, or ''."""
        b = self.brakes()
        test_word = "on" if self._to_sheet() else "off"
        channel = s_(w.get("channel")) or "sms"
        to, subject, body, reason = s_(w.get("to")), s_(w.get("subject")), s_(w.get("body")), s_(w.get("reason"))
        rid = ""
        try:
            rid = self._rehearse(w, b, channel, to, subject, body, reason, test_word)
        except Exception as exc:  # noqa: BLE001 - nothing was sent either way
            staff_views.record({"email": "asa-hub:rpc"}, "rehearsal_row_lost",
                               "held by the dial → " + SC.mask(to) + ": " + type(exc).__name__, 502)
        held_by = s_(w.get("held_by")) or f"the sending dial stands at `{b['dial'] or 'off'}`, not `send`"
        try:
            self.mock_held(w, held_by)
        except Exception:  # noqa: BLE001 - the mock is never worth a message
            pass
        return rid

    def _rehearse(self, w: dict, b: dict, channel: str, to: str, subject: str, body: str, reason: str,
                  test_word: str) -> str:
        lane = _LANE.match(reason)
        situation = s_(w.get("situation")) or (gsjs.trim(lane.group(1)) if lane else "")
        intent = s_(w.get("intent_key")) or (gsjs.trim(lane.group(2)) if lane else "")
        if not situation:
            try:
                situation = SC.situation_from(reason, SC.read_situations(self.reads.db))
            except Exception:  # noqa: BLE001 - stays blank
                situation = ""
        would = ",".join(self._testers(channel))
        seq = w.get("seq")
        if seq is None or seq == "":
            self.seq += 1
            seq = self.seq
        dial = b["dial"]
        hands_over = not dial or dial == "send"
        reasons = s_(w.get("reasons"))
        if not b["sending"]:
            reasons = (reasons + " · " if reasons else "") + (
                SC.NOT_ARMED if (b["rpc_send"] and not b["paused"]) else SC.SWITCH_OFF)
        if dial and not hands_over:
            reasons = (reasons + " · " if reasons else "") + f"the sending dial stands at `{dial}`, not `send`"
        pass_id = s_(w.get("pass_id")) or self.pass_id()
        seed = f"{pass_id}|{intent or (to + '|' + subject + '|' + SW.js_slice(body, 40))}|{channel}"
        rid = "CRH_" + hashlib.md5(seed.encode("utf-8")).hexdigest()[:12]
        now = _now_iso()
        attempt = w.get("attempt")
        row = {"id": rid, "createdAt": now, "updatedAt": now, "pass_id": pass_id, "pass_at": now,
               "pass_by": s_(w.get("pass_by")) or HELD_PASS_BY, "seq": seq, "intent_key": intent,
               "person_key": s_(w.get("person_key")), "person_name": s_(w.get("person_name")), "channel": channel,
               "to_masked": SC.mask(to), "redirected": "yes" if would else "no", "redirect_to_masked": SC.mask(would),
               "situation": situation, "purpose": s_(w.get("purpose")), "words_sha": "",
               "sender_used": s_(w.get("sender_used")), "from_account": s_(w.get("from_account")), "subject": subject,
               "body": body, "body_chars": SCO.utf16_len(body),
               "would_have_sent": "yes" if b["sending"] and hands_over else "no", "verdict": s_(w.get("verdict")),
               "reasons": reasons, "consent": s_(w.get("consent")), "window": s_(w.get("window")),
               "attempt": "" if attempt is None else gsjs.or_blank(attempt), "dial": dial, "at": now,
               "test_mode": test_word or "sheet", "tenant": ""}
        if rid in self._made:
            row.pop("createdAt")
        if not self._keep(comm_logs.REHEARSAL, row):
            raise RuntimeError("the rehearsal row was not kept")
        self._made.add(rid)
        return rid

    def mock_held(self, w: dict[str, Any], why: str) -> None:
        """commMockHeld_ through commMockNote_: one `held` row of the mock outbox for a message the lane held itself,
        the recipient riding the purpose."""
        if self.mocked >= MOCK_PER_EXECUTION:
            self.capped += 1
            return
        to = s_(w.get("to"))
        purpose = " · ".join(x for x in (s_(w.get("purpose")), ("to " + s_(w.get("to_name"))) if s_(w.get("to_name"))
                                         else "") if x)
        try:
            rows = SC.read_situations(self.reads.db)
        except Exception:  # noqa: BLE001 - the hours stay blank
            rows = []
        sid = s_(w.get("situation")) or SC.situation_from(s_(w.get("reason")), rows)
        c = {"sid": sid, "lane": purpose or s_(w.get("reason")), "rows": rows, "person": s_(w.get("person_name")),
             "to": to, "channel": s_(w.get("channel")) or "sms", "subject": s_(w.get("subject")),
             "body": s_(w.get("body")), "key": s_(w.get("intent_key")), "ask": {}}
        rec = SC.mock_row(self.run, c, self.brakes(), "held", why, s_(w.get("reasons")) or why)
        if self._keep(comm_logs.MOCK, rec):
            self.mocked += 1

    def say_capped(self) -> None:
        """commMockSayIfCapped_."""
        if self.capped:
            staff_views.record({"email": "asa-hub:commmock"}, "comm_mock_capped",
                               f"{self.capped} more message(s) this execution are NOT in the book (the cap is "
                               f"{MOCK_PER_EXECUTION})")
            self.capped = 0
