"""The Support Requests raise (apps-script/SupportDesk.gs sdRaise_, sdEventRow_, sdTellAll_, sdItemNotes_,
sdPunchAlso_, sdUnion_, sdLeads_) and who an alert still reaches (AlertReceive.gs arReceivers_), for the Python doors
that raise on the board (support_punch, support_desk_vacation): every row one write appends or changes kept as an
app.edits record over the Support Requests houses and laid over what the same write reads next, every text through
Smart Comms under sdTell_'s own key."""
from __future__ import annotations

from typing import Any

import alert_receive as AR
import client_writes as CW
import gsjs
import hubdb
import locations as L
import scope as sc
import support_desk as SD
import support_desk_writes as SDW
import writes as W
from scope import Defer

s_ = SDW.s_
TABS, HEADERS = SDW.TABS, SDW.HEADERS
# sdEventRow_: a details cell longer than this is kept as the cut's own words
DETAILS_MAX = 4000
DETAILS_CUT = {"cut": True, "why": "the details were longer than 4000 characters"}
AUTO_ON = ("yes", "on", "true", "1")


def event_id(kind: str, source_ref: str) -> str:
    """sdEventId_."""
    return "SE" + SDW.sha10(kind + "|" + source_ref)


def item_id(ref: str, kind: str, uid: Any) -> str:
    """sdItemId_."""
    return "SN" + SDW.sha10(ref + "|" + kind + "|" + s_(uid))


def auto_on(reads: L.Reads, part: str) -> bool:
    """hubMyWorkAutoOn_: FAIL-CLOSED — a blank, an unknown word or a switch that cannot be read is off; a copy that
    cannot say what Apps Script would read is never taken for off."""
    key = SD.AUTO_KEYS.get(part)
    if not key:
        return False
    try:
        cfg = reads.config()
        raw = cfg[key] if key in cfg else SD.auto_defaults(reads).get(key)
    except (hubdb.Unreadable, Defer):
        raise
    except Exception:  # noqa: BLE001 - hubMyWorkAutoOn_ reads a throw as off
        return False
    return gsjs.trim(gsjs.or_blank(raw)).lower() in AUTO_ON


def union(*lists: list[dict] | None) -> list[dict]:
    """sdUnion_: the people lists together, one per account."""
    seen: set[str] = set()
    out: list[dict] = []
    for people in lists:
        for p in people or []:
            uid = s_((p or {}).get("uid"))
            if not p or not uid or uid in seen:
                continue
            seen.add(uid)
            out.append(p)
    return out


def leads(reads: L.Reads) -> dict[str, Any]:
    """sdLeads_ (sdPeople_('leads')): the leads the settings name, each a live account."""
    def read() -> dict[str, Any]:
        st = SDW.settings(reads)
        return SDW.resolve_emails(reads, st["values"]["leads"]) if st["readable"] else \
            {"list": [], "missed": [], "why": st["why"]}
    return reads.once("sdr:leads", read)


# ---- Settings › Alerts I receive (AlertReceive.gs) ----------------------------------------------------------------

def master_uid(reads: L.Reads) -> str:
    """arMasterUid_: the master account's id; '' when it cannot be read."""
    def read() -> str:
        try:
            u = CW.user_by_email(reads, sc.MASTER_ACCOUNT)
        except (hubdb.Unreadable, Defer):
            raise
        except Exception:  # noqa: BLE001 - arMasterUid_ reads a throw as no master
            return ""
        return s_(u.get("userid")) if u else ""
    return reads.once("sdr:master", read)


def holder(reads: L.Reads, uid: Any) -> str:
    """arHolder_: 'master' | 'director' | '' — whether this account holds the section now."""
    want = s_(uid)
    if not want:
        return ""
    if want == master_uid(reads):
        return "master"
    return "director" if any(d.get("uid") == want for d in SDW.directors(reads)["list"]) else ""


def receive_off(reads: L.Reads) -> dict[str, dict[str, bool]]:
    """arOff_: uid → {part: True} for the holders alone; {} when nobody turned anything off or nothing could be
    read."""
    def read() -> dict[str, dict[str, bool]]:
        try:
            st = AR.stored(reads)
            return {uid: parts for uid, parts in (st.get("off") or {}).items() if holder(reads, uid)}
        except hubdb.Unreadable:
            raise
        except Exception:  # noqa: BLE001 - arOff_ cuts nobody when it cannot read
            return {}
    return reads.once("sdr:receive_off", read)


def receivers(reads: L.Reads, people: list[dict] | None, part: str) -> list[dict]:
    """arReceivers_: the people this alert still reaches (FAIL-OPEN); the list itself for any other alert."""
    got = list(people or [])
    if not AR.is_part(part):
        return got
    off = receive_off(reads)
    return [p for p in got if (off.get(s_((p or {}).get("uid"))) or {}).get(part) is not True]


# ---- one write's raises -------------------------------------------------------------------------------------------

class Raise:
    """One write's rows over the Support Requests houses (sdAppend_ / sdUpsert_ as app.edits records), each laid over
    what the same write reads next, as sdMemoDrop_ makes the next read see it there."""

    def __init__(self, reads: L.Reads) -> None:
        self.reads = reads
        self.edits: list[dict] = []
        self.events: dict[str, dict] = {}
        self.appended: dict[str, tuple[dict, dict]] = {}
        self.changed: dict[str, tuple[dict, dict]] = {}
        self.notes: dict[str, list[dict]] = {}
        self.gated = False

    def _write(self, tab: str) -> None:
        """sdWrite_'s own checks before a row is written: the book-write funnel, then the house itself (sdSheet_)."""
        if not self.gated:
            W.gate(self.reads)
            self.gated = True
        if not self.reads.db.house_moved(tab):
            raise Defer(f'The Support Requests house "{tab}" is not set up (no pointer, or moved.{tab} is not on).')

    def event(self, eid: str) -> dict | None:
        """sdEventById_, this write's own events laid over the house's."""
        return self.events.get(eid) or SDW.event_by_id(self.reads, eid)

    def items_of(self, ref: str) -> list[dict]:
        """sdItemsByRef_()[ref], this write's own items laid over the house's."""
        mine = [row for row, _rec in self.appended.values() if row["ref"] == ref]
        return (SDW.items_by_ref(self.reads).get(ref) or []) + mine

    def event_row(self, ev: dict) -> dict[str, str]:
        """sdEventRow_: every column, the details JSON capped, the stamps filled."""
        row = {h: "" for h in HEADERS["support_events"]}
        row.update(ev)
        d = row["details"] if isinstance(row["details"], str) else SDW.json_text(row["details"] or {})
        if CW.utf16_len(d) > DETAILS_MAX:
            d = SDW.json_text(DETAILS_CUT)
        row["details"] = d
        row["status"] = row["status"] or "raised"
        row["test_mode"] = SDW.test_word(self.reads)
        row["created_at"] = row["created_at"] or SDW.iso_now(self.reads)
        row["created_by"] = row["created_by"] or "support-desk"
        return row

    def raise_(self, ev: dict, items: list[dict | None]) -> bool:
        """sdRaise_: the items absent so far appended, then the event when its id is absent; whether it was raised."""
        known = {s_(it.get("id")) for it in self.items_of(ev["ref"])}
        fresh = []
        for it in items or []:
            if not it or not it.get("to_uid") or it["id"] in known:
                continue
            known.add(it["id"])
            fresh.append(it)
        if fresh:
            self._write(TABS["inbox"])
        for it in fresh:
            rec = SDW.item_record(self.reads, None, it, ev["ref"])
            self.appended[it["id"]] = (it, rec)
            self.edits.append(rec)
        if self.event(ev["id"]):
            return False
        self._write(TABS["events"])
        row = self.event_row(ev)
        sid, tab = SDW.where(self.reads, TABS["events"])
        self.edits.append(W.kept_record(sid, tab, "append", "id", row["id"], ev["ref"],
                                        {h: row.get(h, "") for h in HEADERS["support_events"]}))
        self.events[row["id"]] = row
        return True

    def tell_all(self, situation: str, people: list[dict], vars_: dict, ref: str, kind: str) -> list[dict]:
        """sdTellAll_: the situation said to each recipient, the outcome written on that recipient's item."""
        told, notes = [], []
        for p in people or []:
            r = SDW.tell(self.reads, situation, p, vars_, ref)
            word = SDW.outcome(r)
            iid = item_id(ref, kind, p.get("uid"))
            told.append({"uid": p.get("uid"), "name": p.get("name"), "inbox_id": iid,
                         "text": {"situation": situation, "state": word, "why": SDW.text_(r.get("why"), 160)}})
            notes.append((iid, word))
        self.item_notes(notes)
        return told

    def item_notes(self, notes: list[tuple[str, str]]) -> None:
        """sdItemNotes_: "text: <outcome>" on each item (only its note changes); a write that fails leaves the outcome
        on the event."""
        if not notes:
            return
        try:
            by = {s_(it.get("id")): it for it in SDW.tab_rows(self.reads, TABS["inbox"])}
            for iid, word in notes:
                note = "text: " + word
                if iid in self.appended:
                    row, rec = self.appended[iid]
                    row["note"] = note
                    rec["cells"]["note"] = W.sheet_text(note)
                    continue
                base = by.get(iid)
                if base is None:
                    continue
                prev = self.changed.pop(iid, None)
                now = {**(prev[0] if prev else base), "note": note}
                self._write(TABS["inbox"])
                rec = SDW.item_record(self.reads, base, now, s_(base.get("ref")))
                if prev:
                    self.edits = [e for e in self.edits if e is not prev[1]]
                if rec:
                    self.changed[iid] = (now, rec)
                    self.edits.append(rec)
        except hubdb.Unreadable:
            raise
        except Exception:  # noqa: BLE001 - the event keeps the outcome
            pass

    def also(self, ref: str, line: str) -> None:
        """sdPunchAlso_: one note decision per line on the event's decisions."""
        decs = (SDW.decisions_by_ref(self.reads).get(ref) or []) + self.notes.get(ref, [])
        if any(s_(d.get("verdict")) == "note" and s_(d.get("note")) == line for d in decs):
            return
        self._write(TABS["decisions"])
        row = SDW.decision_row(self.reads, ref=ref, source="event", verdict="note", note=line, by_uid="",
                               by_name="Support Requests", via="auto")
        self.notes.setdefault(ref, []).append(row)
        self.edits.append(SDW.decision_record(self.reads, row, ref))

    def books(self) -> tuple[str, ...]:
        """The books the raise rests on: the four houses."""
        out: list[str] = []
        for t in TABS.values():
            sid = self.reads.db.resolve(t).sheet_id
            if sid and sid not in out:
                out.append(sid)
        return tuple(out)
