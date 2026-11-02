"""Settings' last tools on Python, their writes: Quo Enrich kept (HubCore.gs usersQuoEnrich over the book its read
walked), the contact clock armed (contactSweepInstall) and its pass on the relay's clock (contactAutoSweep: the phones
filled from the roster, then the book), the legacy import (syncFromLegacy) and the asking rhythm's refused verbs
(flowCadencesRoute_). A user's cells and a hiring fact are kept in app.edits; the clock in app.contact_sweep_clock."""
from __future__ import annotations

import json
import logging
import re
import time
from typing import Any, Callable

import candidate_writes as CW
import door_gate as DG
import gsjs
import hubdb
import locations as L
import recon as R
import settings_tools as ST
import smart_comms as SC
import staff as SP
import users_phone_fill as UPF
import writes as W
from writes import Decision

log = logging.getLogger("asa-hub-app")

USERS_TAB = "users"
SUBJECT = "users"
QUO_CAP = 100
STALE = {"status": 409, "message": "The contact book was read too long ago, and nothing was written. Press it again."}
WITHHELD = "[withheld"
# HubCore.gs syncFromLegacy's plan: each talent tab and the key columns its rows are matched by, in order
LEGACY_PLAN = (("entity_candidates", ("candidate_id",)),
               ("entity_resume_analyses", ("resume_analysis_id", "candidate_id")),
               ("entity_phone_screens", ("phone_screen_id", "candidate_id")))
LEGACY_PROP = "LEGACY_TALENT_SHEET_ID"
LEGACY_BY = "runtime-sheet"

s_ = gsjs.str_


def _held() -> Any:
    cur = W.HELD.get()
    if cur is None:
        raise W.NotKept("the contact clock is written only under the platform's write lock")
    return cur


def _admin(sess: L.Session, gs_action: str, payload: dict) -> dict[str, Any] | None:
    """doPost's place gate and HUB_POLICY, then the handler's own: an admin's session, never the service."""
    refused = DG.refusal(sess, gs_action, payload, ST.GS_POLICY)
    if refused:
        return refused
    user = sess.user or {}
    if not sess.user or user.get("is_service") or s_(user.get("role")) != "admin":
        return dict(DG.DENIED)
    return None


# ---- the asking rhythm's verbs -----------------------------------------------------------------------------------

def _cadence_verb(door: str) -> Callable[[L.Session, dict], Decision]:
    def refuse(sess: L.Session, payload: dict) -> Decision:
        """flowCadencesRoute_ for create, update and delete: the cells are Settings' to edit."""
        return Decision(ST.cadence_refusal(sess, door, payload) or dict(ST.CADENCE_READ_ONLY))
    return refuse


# ---- Quo Enrich ---------------------------------------------------------------------------------------------------

def _digits10(v: Any) -> str:
    return re.sub(r"\D+", "", gsjs.or_blank(v))[-10:]


def _cell(raw: dict, head: str | None) -> Any:
    return hubdb.typed(raw.get(head), "hub") if head else None


def enrich(reads: L.Reads, book: dict[str, Any], cap: int, filled: dict[str, str] | None = None
           ) -> tuple[dict[str, Any], list[dict]]:
    """usersQuoEnrichCore_ past its fetch: each active, unmerged account matched to the book by its e-mails and its
    numbers; new numbers and contact e-mails appended (deduped, cleaned as Profile.gs cleans them), the single phone
    filled when blank, the sign-in e-mail never touched; at most `cap` accounts. `filled`: phones this same pass just
    filled, by row key."""
    contacts = [c for c in book.get("contacts") or [] if isinstance(c, dict)]
    by_email: dict[str, list[dict]] = {}
    by_digits: dict[str, list[dict]] = {}
    for c in contacts:
        for e in c.get("emails") or []:
            k = gsjs.trim(s_(e)).lower()
            if k:
                by_email.setdefault(k, []).append(c)
        for p in c.get("phones") or []:
            d = _digits10((p or {}).get("value"))
            if len(d) >= 7:
                by_digits.setdefault(d, []).append(c)
    out = {"examined": 0, "matched": 0, "updated": 0, "phonesAdded": 0, "emailsAdded": 0,
           "pages": book.get("pages") or 0, "contacts": len(contacts), "note": s_(book.get("note"))}
    res = W.tab_of(reads, USERS_TAB)
    if res.ref is None:
        raise hubdb.Unreadable("the users tab holds no rows in the copy")
    raw_heads = list(res.ref.headers)
    head = {hubdb.norm_key(h): h for h in reversed(raw_heads)}
    missing = [c for c in ("phone", "phones", "emails", "userid") if c not in head]
    if missing:
        return {"status": 409, "message": "The users tab has no " + ", ".join(missing) + " column, so nothing was "
                                          "written."}, []
    rows = reads.db.rows(res.ref)
    sid, tab = W.where_of(res)
    sets = [[head["userid"]], [head[k] for k in ("email",) if k in head]]
    names = {k: gsjs.trim(gsjs.js_str(head[k])) for k in ("phone", "phones", "emails")}
    edits: list[dict] = []
    for n, (_rn, raw) in enumerate(rows):
        if out["updated"] >= cap:
            break
        if s_(_cell(raw, head.get("mergedinto"))):
            continue
        if s_(_cell(raw, head.get("active"))).lower() == "false":
            continue
        out["examined"] += 1
        got = W.row_key_of(rows, n, sets)
        sign_in = gsjs.trim(s_(_cell(raw, head.get("email")))).lower()
        phone_now = s_(_cell(raw, head["phone"])) or (filled or {}).get(got[1] if got else "", "")
        phones_raw, emails_raw = _cell(raw, head["phones"]), _cell(raw, head["emails"])
        mine: dict[str, dict] = {}

        def claim(found: list[dict]) -> None:
            for c in found:
                if c.get("id"):
                    mine[c["id"]] = c
        if sign_in:
            claim(by_email.get(sign_in, []))
        emails = _parse_emails(emails_raw)
        for e in emails:
            claim(by_email.get(gsjs.trim(s_(e)).lower(), []))
        phones = SP._parse_phones(phones_raw)
        own: set[str] = set()
        for v in [phone_now] + [(p or {}).get("number") if isinstance(p, dict) else None for p in phones]:
            d = _digits10(v)
            if len(d) >= 7:
                own.add(d)
        for d in own:
            claim(by_digits.get(d, []))
        if not mine:
            continue
        out["matched"] += 1
        have = {_digits10((p or {}).get("number") if isinstance(p, dict) else None) for p in phones}
        have.add(_digits10(phone_now))
        have_em = {gsjs.trim(s_(e)).lower() for e in emails}
        added = added_em = 0
        for c in mine.values():
            for p in c.get("phones") or []:
                num = gsjs.trim(s_((p or {}).get("value")))
                d = _digits10(num)
                if not num or len(d) < 7 or d in have:
                    continue
                have.add(d)
                phones.append({"label": s_((p or {}).get("name"))[:24] or "Quo", "number": num})
                added += 1
            for e in c.get("emails") or []:
                em = gsjs.trim(s_(e))
                k = em.lower()
                if not em or "@" not in em or k == sign_in or k in have_em:
                    continue
                have_em.add(k)
                emails.append(em)
                added_em += 1
        if not added and not added_em:
            continue
        if got is None or any(WITHHELD in gsjs.or_blank(raw.get(head[k])) for k in ("phone", "phones", "emails")):
            # a row no key tells apart, or one whose contact cells the copy withholds, is never written
            continue
        clean_p, clean_e = SP._clean_phones(phones), SP._clean_emails(emails)
        cells: dict[str, Any] = {}
        if added:
            cells[names["phones"]] = json.dumps(clean_p, separators=(",", ":"), ensure_ascii=False)
        if added_em:
            cells[names["emails"]] = json.dumps(clean_e, separators=(",", ":"), ensure_ascii=False)
        if not phone_now and clean_p:
            cells[names["phone"]] = clean_p[0]["number"]
        before = {names["phones"]: gsjs.or_blank(raw.get(head["phones"])),
                  names["emails"]: gsjs.or_blank(raw.get(head["emails"])),
                  names["phone"]: gsjs.or_blank(raw.get(head["phone"]))}
        edits.append(W.kept_record(sid, tab, "edit", got[0], got[1], SUBJECT, cells, before=before))
        out["updated"] += 1
        out["phonesAdded"] += added
        out["emailsAdded"] += added_em
    return out, edits


def _parse_emails(raw: Any) -> list:
    """profileParseEmails_."""
    if isinstance(raw, list):
        return list(raw)
    s = s_(raw)
    if not s:
        return []
    try:
        got = json.loads(s)
        return got if isinstance(got, list) else []
    except ValueError:
        return [x for x in re.split(r"\s*[;,]\s*", s) if x]


def _enriched_line(out: dict[str, Any]) -> str:
    return (f"{out['updated']} account(s) enriched from {out['contacts']} Quo contact(s): {out['phonesAdded']} "
            f"phone(s), {out['emailsAdded']} e-mail(s)")


def quo_enrich(sess: L.Session, payload: dict) -> Decision:
    """usersQuoEnrich's second half: the book its read walked (usersQuoFetch, sealed for this admin) matched and kept,
    a hundred accounts at most; a second press finds nothing new."""
    refused = _admin(sess, "usersQuoEnrich", payload)
    if refused:
        return Decision(refused)
    user = sess.user or {}
    book = R.unsealed("usersQuoFetch", s_(user.get("id")), (payload or {}).get("prepared"))
    if book is None:
        return Decision(dict(STALE))
    out, edits = enrich(sess.reads, book, QUO_CAP)
    if "status" in out:
        return Decision(out)
    log.info("usersQuoEnrich: %s", _enriched_line(out))
    d = W.final({"status": 200, "data": out}, edits, SUBJECT)
    d.fresh = True
    return d


# ---- the contact clock --------------------------------------------------------------------------------------------

def clock_ddl() -> tuple[str, ...]:
    """The contact clock: armed by Settings' press alone, stamped by each pass (contactSweepDue_'s stamp)."""
    return (f"create table if not exists {ST.CLOCK_TABLE} (id smallint primary key default 1 check (id = 1),"
            " armed boolean not null default false, hours integer not null default 2, armed_at timestamptz,"
            " ran_at timestamptz, said text not null default '', write_id text not null default '', prev jsonb)",
            f"grant select on {ST.CLOCK_TABLE} to asa_hub_app_ro")


def sweep_install(sess: L.Session, payload: dict) -> Decision:
    """contactSweepInstall: the contact clock armed at the configured cadence — pressed again, the same clock, never a
    second one. It runs on the relay's hourly tick (contactSweepDue, then contactSweepRun) only once armed here."""
    refused = _admin(sess, "contactSweepInstall", payload)
    if refused:
        return Decision(refused)
    hours = ST.sweep_hours(sess.reads)
    cur = _held()
    cur.execute(f"select armed, hours, armed_at from {ST.CLOCK_TABLE} where id = 1 for update")
    got = cur.fetchone()
    prev = None if not got else {"armed": got[0], "hours": got[1],
                                 "armed_at": got[2].isoformat() if got[2] is not None else None}
    cur.execute(f"insert into {ST.CLOCK_TABLE} (id, armed, hours, armed_at, write_id, prev)"
                " values (1, true, %s, now(), %s, %s::jsonb) on conflict (id) do update set armed = true,"
                " hours = excluded.hours, armed_at = excluded.armed_at, write_id = excluded.write_id,"
                " prev = excluded.prev", (hours, SC.write_id(), json.dumps(prev)))
    log.info("contactSweepInstall: contact clock armed — every %sh", hours)
    return Decision({"status": 200, "data": {"installed": True, "hours": hours}}, own=True)


def sweep_run(sess: L.Session, payload: dict) -> Decision:
    """contactAutoSweep's contact pass, after contactSweepDue read the book on the relay's clock: the stamp first, then
    the blank phones filled from the roster and the candidates, then the book matched — each capped at a hundred."""
    if (sess.user or {}).get("is_service") is not True:
        return Decision({"status": 403, "message": "This is the relay's own write."})
    prep = R.unsealed("contactSweepDue", "service", (payload or {}).get("prepared"))
    if prep is None:
        return Decision(dict(STALE))
    if prep.get("due") is not True:
        return Decision({"status": 200, "data": {"due": False}}, own=True)
    reads = sess.reads
    cur = _held()
    cur.execute(f"select armed, extract(epoch from ran_at) from {ST.CLOCK_TABLE} where id = 1 for update")
    got = cur.fetchone()
    hours = ST.sweep_hours(reads)
    if not got or got[0] is not True or not ST.window_open(float(got[1]) if got[1] is not None else None, hours,
                                                          time.time()):
        return Decision({"status": 200, "data": {"due": False, "why": "not armed, or ran already"}}, own=True)
    out: dict[str, Any] = {"ran": True, "hours": hours}
    fill, edits = UPF.phone_fill(reads, UPF.CAP)
    out["filled"] = fill.get("filled", 0)
    filled = {e["row_key"]: next(iter(e["cells"].values()), "") for e in edits}
    quo = prep.get("quo") if isinstance(prep.get("quo"), dict) else {}
    if quo.get("no_key"):
        out["quo"] = {"skipped": "no provider key"}
    elif quo.get("error"):
        out["quo"] = {"error": s_(quo.get("error"))}
    else:
        got_q, more = enrich(reads, quo, QUO_CAP, filled)
        out["quo"] = got_q
        edits += more
    said = f"{out['filled']} phone(s) filled; " + (
        _enriched_line(out["quo"]) if "updated" in out["quo"] else s_(out["quo"].get("error") or
                                                                     out["quo"].get("skipped") or
                                                                     out["quo"].get("message")))
    cur.execute(f"update {ST.CLOCK_TABLE} set ran_at = now(), said = %s where id = 1", (said[:400],))
    log.info("contact clock: %s", said)
    d = W.final({"status": 200, "data": out}, edits, SUBJECT)
    if not d.edits:
        d.own = True
    d.fresh = True
    return d


# ---- the legacy import --------------------------------------------------------------------------------------------

def _legacy_text(v: Any) -> str:
    """serialize_ of the cell getValues hands back: a Date as its text, anything else as the cell keeps it."""
    t = hubdb.typed(v, "hub")
    if isinstance(t, (gsjs.SheetDate, hubdb.SheetTime)):
        t = hubdb.cell_text(t)
        return t if isinstance(t, str) else json.dumps(t)
    return W.sheet_text(t)


def _key_of(row: dict[str, str], keys: tuple[str, ...]) -> str:
    """keyOf: the first key column the row fills, named with its value."""
    for k in keys:
        v = gsjs.trim(s_(row.get(hubdb.norm_key(k))))
        if v:
            return k + "=" + v
    return ""


def sync_from_legacy(sess: L.Session, payload: dict) -> Decision:
    """syncFromLegacy: the old talent sheet's three tabs upserted by key into the Hub's own (dissolved into the depot's
    facts), read off asa-hub-db's copy of the legacy book: a row the Hub lacks added, a row it has given the legacy
    cells it holds blank. A cell the Hub holds is never written over — the one-time import is long done, and its
    overwrite would put the Hub's candidates back as the old sheet left them (the blanked columns of cR16)."""
    refused = DG.refusal(sess, "syncFromLegacy", payload, ST.GS_POLICY)
    if refused:
        return Decision(refused)
    user = sess.user or {}
    if not sess.user or s_(user.get("role")) != "admin":
        return Decision(dict(DG.DENIED))
    reads = sess.reads
    legacy = gsjs.trim(reads.db.prop(LEGACY_PROP))
    if not legacy:
        raise hubdb.Unreadable("no legacy talent sheet is configured")
    summary: dict[str, Any] = {}
    edits: list[dict] = []
    for tab, keys in LEGACY_PLAN:
        src = reads.tab_of(legacy, tab, "the legacy talent sheet")
        if src is None:
            summary[tab] = "tab missing"
            continue
        if not reads.db.dissolved(tab):
            return Decision({"status": 409, "message": f"{tab} is not kept in the depot's facts, so the import has "
                                                       "nowhere to land; nothing was written."})
        s_heads = [gsjs.trim(gsjs.js_str(h)) for h in src.headers]
        if not s_heads:
            summary[tab] = "legacy empty"
            continue
        dest = CW.dissolved_rows(reads, tab)
        index: dict[str, str] = {}
        for sub, row in dest.items():
            k = _key_of(row, keys)
            if k and k not in index:
                index[k] = sub
        updated = inserted = 0
        for _rn, raw in reads.db.rows(src):
            line: dict[str, str] = {}
            for h in src.headers:
                if gsjs.trim(gsjs.js_str(h)):
                    line.setdefault(hubdb.norm_key(h), _legacy_text(raw.get(h)))
            k = _key_of(line, keys)
            if not k:
                continue
            sub = index.get(k)
            if sub is not None:
                updated += 1
            else:
                # appendRow's subject (hiringRowKey_): the candidate, whose row the dissolved tab may already hold
                sub = gsjs.trim(s_(line.get("candidateid")))
                inserted += 1
            if not sub:
                continue
            have = dest.setdefault(sub, {})
            cells = {h: v for h, v in line.items() if h and s_(v) and not s_(have.get(h))}
            if cells:
                edits += CW.facts_of(reads, tab, sub, cells, LEGACY_BY, "", "")
                have.update(cells)
        summary[tab] = {"updated": updated, "inserted": inserted}
    log.info("syncFromLegacy: %s", json.dumps(summary, separators=(",", ":"))[:300])
    d = W.final({"status": 200, "data": summary}, edits, "")
    d.fresh = True
    return d


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {
    **{"hiringCadences" + v: _cadence_verb("hiringCadences" + v) for v in ("Create", "Update", "Delete")},
    "usersQuoEnrichApply": quo_enrich, "contactSweepInstall": sweep_install, "contactSweepRun": sweep_run,
    "syncFromLegacy": sync_from_legacy}
# main.policy_gate asks nothing: each door asks door_gate first
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
BUSY_OF: dict[str, dict[str, Any]] = {a: {"status": 409, "message": W.BUSY} for a in ACTIONS}


class Store(W.Store):
    """app.settings_tools_writes and _receipts beside the other apps' own, and the contact clock; a void puts the clock
    back as the press found it."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="settings_tools", label="Settings tools")
        self._own = False

    def ensure(self) -> str:
        why = super().ensure()
        if why or self._own:
            return why
        with self._lock:
            if self._own:
                return ""
            try:
                c = self.conn()
                for stmt in clock_ddl():
                    c.execute(stmt)
                self._own = True
            except Exception as exc:  # noqa: BLE001 - said on /healthz; the doors answer 503 meanwhile
                self._drop()
                self._ready = False
                self.why = f"the contact clock is not ready ({type(exc).__name__}: {str(exc)[:120]})"
        return self.why

    def settle(self, write_id: str, state: str, why: str = "", fields: list[str] | None = None) -> bool:
        done = super().settle(write_id, state, why, fields)
        if state == "void" and done:
            try:
                c = self.conn()
                with c.transaction():
                    got = c.execute(f"select prev from {ST.CLOCK_TABLE} where id = 1 and write_id = %s for update",
                                    (write_id,)).fetchone()
                    if got is not None:
                        prev = got[0] if isinstance(got[0], dict) else json.loads(got[0] or "null")
                        if prev is None:
                            c.execute(f"delete from {ST.CLOCK_TABLE} where id = 1")
                        else:
                            c.execute(f"update {ST.CLOCK_TABLE} set armed = %s, hours = %s, armed_at = %s,"
                                      " write_id = '', prev = null where id = 1",
                                      (prev.get("armed") is True, int(prev.get("hours") or 2), prev.get("armed_at")))
            except Exception as exc:  # noqa: BLE001 - said, never raised into the relay's settle
                log.warning("contact clock: the void of %s was not applied (%s)", write_id[:40], type(exc).__name__)
        return done
