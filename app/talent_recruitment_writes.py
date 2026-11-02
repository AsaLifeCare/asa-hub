"""Recruitment's writes (apps-script/Recruitment.gs): a setting saved (recruitmentConfigSet), the Dropbox Sign mirror
synced — by an admin (recruitmentSync) or by the relay's clock (recruitmentSyncSweep, the daily pass and the installed
trigger's) — one signed PDF's link filed (recruitmentDoc), and the trigger's cadence installed or removed
(recruitmentInstallTrigger: the relay's clock reads it). The mirror, its settings and its links are the dissolved
recruitment_* facts (app.edits); the clock's marks app.talent_marks. Dropbox Sign and Drive are reached by the prepare
reads (app/talent_recruitment.py)."""
from __future__ import annotations

import logging
from typing import Any, Callable

import candidate_writes as CW
import gsjs
import hubdb
import locations as L
import resource_rows as RR
import talent_pipeline as TP
import talent_recruitment as TR
import writes as W
from writes import Decision

log = logging.getLogger("asa-hub-app")

BUSY = "Somebody else is changing Recruitment right now — try again."
SNAPS = (1, 5, 10, 15, 30)

s_ = gsjs.str_


def _denied() -> Decision:
    return Decision(dict(TP.DENIED))


def config_set(sess: L.Session, payload: dict) -> Decision:
    """recruitmentConfigSet: a setting's value saved; a key the tab lacks added with its help."""
    reads, user = sess.reads, sess.user or {}
    if not TP.writer(user):
        return _denied()
    p = payload if isinstance(payload, dict) else {}
    key = s_(p.get("key"))
    if not key:
        return W.refuse(400, TP.words(reads, "refuse.recruit.key_required", "A key is required."))
    value = s_(p.get("value"))
    at = W.now_iso(reads)
    hit = next((r for r in TR.config_rows(reads) if r["key"] == key), None)
    if hit is not None:
        recs = CW.facts_of(reads, TR.CONFIG_TAB, hit["subject"], {"value": value}, "runtime-sheet", key, "", at=at)
        TP.syslog(user, "recruitmentConfigSet", key)
        return W.final({"status": 200, "data": {"key": key, "value": value}}, recs, key)
    recs = CW.facts_of(reads, TR.CONFIG_TAB, key, {"key": key, "value": value, "what it does": s_(p.get("help"))},
                       "runtime-sheet:append", key, "", at=at)
    return W.final({"status": 200, "data": {"key": key, "value": value, "created": True}}, recs, key)


# ---- the mirror ----------------------------------------------------------------------------------------------

def scrub_stored(reads: L.Reads) -> list[dict]:
    """Each contract's answers kept before the redactor dropped an SSN, a bank or an identity number: the fact's own
    row rewritten without them (no `before`, so the value dropped is kept nowhere); one already rewritten is left."""
    sid, ref = CW.facts_where(reads)
    source = f"dissolution:{TR.CONTRACTS}.{CW.norm('fields_json')}"
    got = reads.db.query(f'select subject_id, value, evidence from {reads.db.from_sql(ref)} where source = %s',  # noqa: S608
                         (source,))
    own = hubdb.OWN.get()
    groups = {g["row_key"]: g for g in ((getattr(own, "edits", None) or {}).get((sid, ref.tab)) or ())
              if g["match"] == CW.FACT_MATCH}
    recs: list[dict] = []
    for sub, value, ev in got:
        clean = TR.scrubbed(reads, value)
        if clean is None:
            continue
        key = "\x1f".join((gsjs.trim(gsjs.or_blank(sub)), source, gsjs.or_blank(ev)))
        kept = groups.get(key)
        if kept is not None and (kept["cells"].get("Value") or (0, None, 0))[1] == clean:
            continue
        recs.append(W.kept_record(sid, hubdb.FACTS_TAB, "edit", CW.FACT_MATCH, key, "", {"Value": clean}))
    return recs


def record_sync(reads: L.Reads, data: dict) -> tuple[dict[str, Any], list[dict]]:
    """recruitmentSync's writes: each envelope upserted by its id, only the columns that changed (re-filing every
    envelope each pass ran out of time); the counts."""
    lines = [ln for ln in data.get("lines") or [] if isinstance(ln, list) and len(ln) == len(TR.CONTRACT_HEADER)]
    prev = CW.dissolved_rows(reads, TR.CONTRACTS)
    at = W.now_iso(reads)
    mirrored = unfiled = 0
    recs: list[dict] = []
    for line in lines:
        sub = s_(line[7])
        if not sub:
            unfiled += 1
            continue
        was = prev.get(sub)
        one: dict[str, str] = {}
        for i, h in enumerate(TR.CONTRACT_HEADER):
            now = gsjs.or_blank(line[i])
            if was is not None and gsjs.or_blank(was.get(hubdb.norm_key(h))) == now:
                continue
            one[h] = now
        if one:
            recs += CW.facts_of(reads, TR.CONTRACTS, sub, one, "recruitment-sync", sub, "", at=at)
        mirrored += 1
    sw = data.get("status_words") if isinstance(data.get("status_words"), dict) else {}
    counts = {"total": len(lines), "mirrored": mirrored, "unfiled": unfiled,
              "fields_fetched": data.get("fields_fetched") or 0, "fields_carried": data.get("fields_carried") or 0,
              "fields_left_for_next_run": data.get("fields_left_for_next_run") or 0,
              "signed": sum(1 for ln in lines if ln[6] == s_(sw.get("status_signed"))),
              "pending": sum(1 for ln in lines if ln[6] == s_(sw.get("status_pending"))),
              "declined": sum(1 for ln in lines if ln[6] == s_(sw.get("status_declined")))}
    scrub = scrub_stored(reads)
    counts["scrubbed"] = len(scrub)
    return counts, recs + scrub


def sync(sess: L.Session, payload: dict) -> Decision:
    """recruitmentSync: an admin's press — the mirror as recruitmentSyncPrepare read it."""
    reads, user = sess.reads, sess.user or {}
    if not user or s_(user.get("role")) != "admin":
        return _denied()
    prep = TP.unsealed("recruitmentSyncPrepare", TP.actor(user), (payload or {}).get("prepared"))
    if prep is None:
        return W.refuse(409, TP.STALE)
    counts, recs = record_sync(reads, prep)
    return W.final({"status": 200, "data": counts}, recs, "")


def set_mark(name: str, said: str) -> None:
    RR._cur().execute(f"insert into {TR.MARKS} (name, at, said) values (%s, now(), %s) on conflict (name) do update"
                      " set at = excluded.at, said = excluded.said", (name, said[:400]))


def sync_sweep(sess: L.Session, payload: dict) -> Decision:
    """recruitSyncAutoSweep_ on the relay's clock: what recruitmentSyncDue read recorded, and the mark that holds the
    next pass (stamped whatever the sync said, so a refused pass is not asked again at once)."""
    if (sess.user or {}).get("is_service") is not True:
        return Decision({"status": 403, "message": "This is the relay's own write."})
    reads = sess.reads
    prep = TP.unsealed("recruitmentSyncDue", "service", (payload or {}).get("prepared"))
    if prep is None:
        return W.refuse(409, TP.STALE)
    if prep.get("due") is not True:
        return Decision({"status": 200, "data": {"due": False}})
    env = prep.get("sync") if isinstance(prep.get("sync"), dict) else {}
    recs: list[dict] = []
    if env.get("status") == 200 and isinstance(env.get("data"), dict):
        counts, recs = record_sync(reads, env["data"])
        left = counts["fields_left_for_next_run"]
        said = TP.words(reads, "recruit.log.ran", "{total} envelope(s), {signed} signed{left}", {
            "total": str(counts["total"]), "signed": str(counts["signed"]),
            "left": " · " + TP.words(reads, "recruit.log.left", "{left} left for the next run",
                                     {"left": str(left)}) if left else ""})
        out: dict[str, Any] = {"due": True, "sync": counts}
    else:
        said = TP.words(reads, "recruit.log.refused", "refused: {why}", {"why": s_(env.get("message"))})
        out = {"due": True, "refused": {k: env.get(k) for k in ("status", "message")}}
    set_mark(TR.SYNC_MARK, said)
    log.info("recruit_sync_auto: %s", said[:300])
    if recs:
        return W.final({"status": 200, "data": out}, recs, "")
    return Decision({"status": 200, "data": out}, own=True, subject="")


# ---- one signed PDF ------------------------------------------------------------------------------------------

def doc(sess: L.Session, payload: dict) -> Decision:
    """recruitmentDoc: the link recruitmentDocPrepare filed, kept for every later click (the first click downloads,
    every later one reuses it)."""
    reads, user = sess.reads, sess.user or {}
    if not TP.writer(user):
        return _denied()
    p = payload if isinstance(payload, dict) else {}
    srid = s_(p.get("signature_request_id"))
    prep = TP.unsealed("recruitmentDocPrepare", TP.actor(user), p.get("prepared"))
    if prep is None or s_(prep.get("srid")) != srid:
        return W.refuse(409, TP.STALE)
    url = s_(prep.get("doc_url"))
    if prep.get("cached") or TR.doc_cached(reads, srid):
        return Decision({"status": 200, "data": {"doc_url": TR.doc_cached(reads, srid) or url}})
    at = W.now_iso(reads)
    recs = CW.facts_of(reads, TR.DOCS, srid, {"signature_request_id": srid, "doc_url": url, "fetched_at": at,
                                              "fetched_by": s_(user.get("email"))},
                       "runtime-sheet:append", srid, "", at=at)
    return W.final({"status": 200, "data": {"doc_url": url}}, recs, srid)


# ---- the trigger -------------------------------------------------------------------------------------------

def install_trigger(sess: L.Session, payload: dict) -> Decision:
    """recruitmentInstallTrigger: the refresh cadence from `sync_minutes` installed for the relay's clock (snapped to
    1, 5, 10, 15 or 30 minutes, else whole hours); 0 means manual only, the daily pass alone."""
    reads, user = sess.reads, sess.user or {}
    if not TP.writer(user):
        return _denied()
    minutes = TP.parse_int(TR.recruit_config(reads).get("sync_minutes"))
    if minutes is None:
        minutes = 60
    at, _said = TR.mark(reads, TR.TRIGGER_MARK)
    removed = 1 if at is not None else 0
    RR._cur().execute(f"delete from {TR.MARKS} where name = %s", (TR.TRIGGER_MARK,))
    if minutes <= 0:
        out: dict[str, Any] = {"installed": False, "removed": removed,
                               "note": TP.words(reads, "recruit.trigger.manual_only", "Manual only — no trigger.")}
    elif minutes < 60:
        snap = 30
        for n in SNAPS:
            if abs(n - minutes) < abs(snap - minutes):
                snap = n
        set_mark(TR.TRIGGER_MARK, str(snap * 60))
        out = {"installed": True, "every_minutes": snap, "removed": removed}
    else:
        hours = max(1, int(gsjs.js_round(minutes / 60)))
        set_mark(TR.TRIGGER_MARK, str(hours * 3600))
        out = {"installed": True, "every_hours": hours, "removed": removed}
    return Decision({"status": 200, "data": out}, own=True, subject="")


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {
    "recruitmentConfigSet": config_set, "recruitmentSync": sync, "recruitmentSyncSweep": sync_sweep,
    "recruitmentDoc": doc, "recruitmentInstallTrigger": install_trigger}
POLICY: dict[str, dict[str, Any]] = {
    "recruitmentConfigSet": {"roles": ("admin", "manager")}, "recruitmentSync": {"roles": ("admin",)},
    "recruitmentSyncSweep": {}, "recruitmentDoc": {"roles": ("admin", "manager")},
    "recruitmentInstallTrigger": {"roles": ("admin", "manager")}}
BUSY_OF: dict[str, dict[str, Any]] = {a: {"status": 409, "message": BUSY} for a in ACTIONS}


def ddl() -> tuple[str, ...]:
    """The clock's marks (db/talent.sql), made here too so the store never waits on it."""
    return (f"create table if not exists {TR.MARKS} (name text primary key, at timestamptz not null default now(),"
            " said text not null default '')",
            f"grant select on {TR.MARKS} to asa_hub_app_ro")


class Store(RR.Store):
    """app.talent_recruitment_writes and app.talent_recruitment_receipts, and the clock's marks."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="talent_recruitment", label="Recruitment")
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
                for stmt in ddl():
                    c.execute(stmt)
                self._own = True
            except Exception as exc:  # noqa: BLE001 - said on /healthz; the doors defer meanwhile
                self._drop()
                self._ready = False
                self.why = f"the recruitment clock's marks are not ready ({type(exc).__name__}: {str(exc)[:120]})"
        return self.why
