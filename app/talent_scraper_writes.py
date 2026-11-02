"""The Lead Scraper's Hub writes (apps-script/Scraper.gs): its settings saved (scraperConfigSet), the referrals the
portal walk found appended (scraperRun), the model's ratings kept (scraperScore) and the high-value referrals put to
the team through Smart Comms' lead_alert (scraperNotify). The referrals are Potential Clients' rows — in
app.resource_rows once that app is Python's, else on its sheet through app.edits; the settings in app.resource_rows.
The portal and the model are reached by the prepare reads (app/talent_scraper.py)."""
from __future__ import annotations

import re
from typing import Any, Callable

import gsjs
import locations as L
import resource_rows as RR
import smart_comms as SC
import talent_pipeline as TP
import talent_pipeline_writes as TPW
import talent_scraper as TS
import writes as W
from writes import Decision

BUSY = "Somebody else is running the Lead Scraper right now — try again."
ALERT_SIT = "lead_alert"
LANE = "scraper"
NOTIFY_LIMIT = 25

s_ = gsjs.str_


def _denied() -> Decision:
    return Decision(dict(TP.DENIED))


def _update(reads: L.Reads, got: dict, key: str, cells: dict | None, row: dict, changed: dict[str, Any],
            by: str) -> list[dict]:
    """One referral changed where it is kept: in Postgres now, else the sheet's row laid through app.edits."""
    if got["owned"]:
        RR.update(reads, TS.LEADS, key, cells or {}, changed, by)
        return []
    sid, tab = W.where_of(W.tab_of(reads, TS.LEADS))
    rid = s_(row.get("id"))
    return [W.kept_record(sid, tab, "edit", "id", rid, rid, changed, before={k: row.get(k) for k in changed})]


def _kept(answer: dict[str, Any], got: dict, recs: list[dict], touched: bool) -> Decision:
    if recs:
        return W.final(answer, recs, "")
    return Decision(answer, own=touched, subject="")


# ---- the settings (scraperConfigSet) -----------------------------------------------------------------------------

def config_set(sess: L.Session, payload: dict) -> Decision:
    """scraperConfigSet: the keys the tab already holds written back, any other ignored; a tab never seeded gets its
    shipped rows first."""
    reads, user = sess.reads, sess.user or {}
    if not TP.writer(user):
        return _denied()
    p = payload if isinstance(payload, dict) else {}
    updates = p.get("config") if isinstance(p.get("config"), dict) else {}
    by = s_(user.get("email"))
    rows = RR.table_rows(reads, TS.CONFIG_RESOURCE)
    if not rows:
        RR.create_many(reads, TS.CONFIG_RESOURCE, [{"key": k, "value": v, "note": n} for k, v, n in TS.CONFIG_DEFAULT],
                       by)
        rows = RR.table_rows(reads, TS.CONFIG_RESOURCE)
    written = 0
    cfg: dict[str, str] = {}
    for k, cells in rows:
        key = gsjs.trim(gsjs.or_text(cells.get("key")))
        value = cells.get("value")
        if key and key in updates:
            value = gsjs.js_str(updates[key])
            RR.update(reads, TS.CONFIG_RESOURCE, k, cells, {"value": value}, by)
            written += 1
        if key:
            cfg[key] = gsjs.trim(gsjs.or_blank(value))
    TP.syslog(user, "scraper_config", f"{written} setting(s)")
    return Decision({"status": 200, "data": {"config": cfg, "written": written}}, own=True, subject="")


# ---- the walk (scraperRun) ---------------------------------------------------------------------------------------

def run(sess: L.Session, payload: dict) -> Decision:
    """scraperRun: the referrals scraperRunPrepare read, appended — only the referral ids not seen before, since what
    is already there may have been worked on."""
    reads, user = sess.reads, sess.user or {}
    if not TP.writer(user):
        return _denied()
    prep = TP.unsealed("scraperRunPrepare", TP.actor(user), (payload or {}).get("prepared"))
    if prep is None:
        return W.refuse(409, TP.STALE)
    got = TS.leads(reads)
    header = list(got["header"]) or list(TS.LEAD_HEADER)
    known = {gsjs.trim(gsjs.or_text(r.get("referral_id"))) for _k, _c, r in got["rows"]}
    at = W.now_iso(reads)
    made: list[dict[str, str]] = []
    for lead in prep.get("leads") or []:
        rid = s_((lead or {}).get("referral_id"))
        if not rid or rid in known:
            continue
        known.add(rid)
        cells = {**lead, "id": "LEAD_" + rid, "source": "brittco", "scraped_at": at, "stage": "new"}
        made.append({h: gsjs.or_blank(cells.get(h)) for h in header})
    by = s_(user.get("email"))
    recs: list[dict] = []
    if made and got["owned"]:
        RR.create_many(reads, TS.LEADS, made, by)
    elif made:
        res = W.tab_of(reads, TS.LEADS)
        recs = [W.append_record(res, tuple(header), row, row["id"]) for row in made]
    TP.syslog(user, "scraper_run", f"{len(made)} new of {prep.get('seen')}")
    answer = {"status": 200, "data": {"pages": prep.get("pages"), "seen": prep.get("seen"),
                                      "unique": prep.get("unique"), "added": len(made), "ran_at": at}}
    return _kept(answer, got, recs, bool(made))


# ---- the rating (scraperScore) -----------------------------------------------------------------------------------

def score(sess: L.Session, payload: dict) -> Decision:
    """scraperScore: the ratings scraperScorePrepare had the model give, each kept on a referral still unrated — a rated
    row is never rated again."""
    reads, user = sess.reads, sess.user or {}
    if not TP.writer(user):
        return _denied()
    prep = TP.unsealed("scraperScorePrepare", TP.actor(user), (payload or {}).get("prepared"))
    if prep is None:
        return W.refuse(409, TP.STALE)
    got = TS.leads(reads)
    by = s_(user.get("email"))
    at = {s_(r.get("id")): i for i, (_k, _c, r) in enumerate(got["rows"]) if s_(r.get("id"))}
    rows = list(got["rows"])
    recs: list[dict] = []
    scored = 0
    for res in prep.get("results") or []:
        i = at.get(s_(res.get("id")))
        if i is None:
            continue
        key, cells, row = rows[i]
        if gsjs.trim(gsjs.or_text(row.get("ai_rating"))):
            continue
        changed = {"ai_rating": res.get("ai_rating"), "ai_notes": s_(res.get("ai_notes"))}
        recs += _update(reads, got, key, cells, row, changed, by)
        rows[i] = (key, {**(cells or {}), **changed} if cells is not None else None, {**row, **changed})
        scored += 1
    failed = int(prep.get("failed") or 0)
    TP.syslog(user, "scraper_score", f"{scored} rated, {failed} failed")
    after = TS.counts(reads, {**got, "rows": rows})
    answer = {"status": 200, "data": {"considered": prep.get("considered"), "scored": scored, "failed": failed,
                                      "counts": after}}
    return _kept(answer, got, recs, bool(scored))


# ---- the alerts (scraperNotify) ----------------------------------------------------------------------------------

def alert_key(lead_id: str, to: str) -> str:
    """scraperAlertKey_: the referral and the number, never the text — a re-rated lead never texts the same person
    twice."""
    return ("scraper_lead:" + re.sub(r"[^A-Za-z0-9_.:-]", "", lead_id.strip()) + ":" +
            re.sub(r"\D", "", to)[-10:])


def notify(sess: L.Session, payload: dict) -> Decision:
    """scraperNotify: each open referral rated at or over the threshold and not alerted yet, put to every configured
    number through Smart Comms' lead_alert; only a fully delivered alert stamps the referral, a rehearsal or a held one
    never does."""
    reads, user = sess.reads, sess.user or {}
    if not TP.writer(user):
        return _denied()
    p = payload if isinstance(payload, dict) else {}
    cfg = TS.config(reads)
    if s_(cfg.get("notify_enabled")).lower() != "yes":
        return W.refuse(400, "Text messages are switched off. Set `notify_enabled` to yes first.")
    sit = TPW.lane_situation(reads, ALERT_SIT)
    if not sit["on"] or not TPW.sit_leg(sit, "sms"):
        return W.refuse(409, "Nothing was sent: " + (sit["why"] or "the situation lead_alert writes no text") + ".")
    recipients = [x.strip() for x in s_(cfg.get("notify_recipients")).split(",") if x.strip()]
    if not recipients:
        return W.refuse(400, "No recipients set in scraper_config.")
    threshold = TP.parse_int(cfg.get("score_threshold")) or 7
    sender = gsjs.trim(s_(cfg.get("notify_from"))) or "the Automations line"
    got = TS.leads(reads)
    if "sms_sent" not in got["header"]:
        return W.refuse(400, "The sheet has no sms_sent column.")
    today = TS.today_ms(reads)
    limit = max(1, TP.parse_int(p.get("limit")) or NOTIFY_LIMIT)
    at_ms = int(reads.now.timestamp() * 1000)
    by = s_(user.get("email"))
    sent = eligible = failed = blocked = opted_out = rehearsals = 0
    paused = raised = False
    recs: list[dict] = []
    for key, cells, row in got["rows"]:
        if eligible >= limit:
            break
        lead_id = gsjs.trim(gsjs.or_text(row.get("id")))
        if not lead_id:
            continue
        rating = TP.parse_int(row.get("ai_rating"))
        if rating is None or rating < threshold or TS.truthy(row.get("sms_sent")):
            continue
        exp = TS.lead_date(row.get("expiration_date")) if "expiration_date" in got["header"] else None
        if exp is None or exp < today:
            continue
        eligible += 1
        client = gsjs.trim(gsjs.or_text(row.get("client_name")))
        notes = gsjs.trim(gsjs.or_text(row.get("ai_notes"))) or "High-value lead: " + client
        var = {"notes": notes, "client": client, "rating": str(rating), "lead_id": lead_id}
        text = TPW.sit_word(sit, "sms_text", notes, var)
        reached = stopped = hard = held = rehearsed = 0
        for to in recipients:
            raised = True
            r = SC.raise_situation(None, situation=ALERT_SIT, to=to, vars=var, key=alert_key(lead_id, to), lane=LANE,
                                   at_ms=at_ms, prune=False, channel="sms", body=text)
            state, why = s_(r.get("state")), s_(r.get("held"))
            if state == "held" and why == "test_mode":
                rehearsed += 1
            elif state in ("sent", "already"):
                reached += 1
            elif state == "refused":
                stopped += 1
            elif state == "held":
                held += 1
            else:
                hard += 1
        opted_out += stopped
        if held:
            paused = True
            break
        if hard:
            failed += 1
            continue
        if rehearsed:
            rehearsals += 1
            continue
        if not reached:
            blocked += 1
            continue
        recs += _update(reads, got, key, cells, row, {"sms_sent": "true"}, by)
        sent += 1
    TP.syslog(user, "scraper_notify", f"{sent} alert(s) to {len(recipients)} number(s)" +
              (f", {rehearsals} rehearsed to the testers" if rehearsals else "") +
              (f", {blocked} reached nobody (opted out)" if blocked else "") +
              (", stopped: platform sending is switched off" if paused else ""))
    note = ("Nothing was sent: sending is switched off for the whole platform. The leads stay unstamped and go out "
            "when it is switched back on." if paused else
            f"{rehearsals} alert(s) went to the testers because test mode is on. The leads stay unstamped so the real "
            "alert still goes out." if rehearsals else
            f"{blocked} alert(s) reached nobody: every recipient on the list has asked us to stop." if blocked else "")
    answer = {"status": 200, "data": {"eligible": eligible, "sent": sent, "failed": failed, "blocked": blocked,
                                      "opted_out": opted_out, "rehearsed": rehearsals, "paused": paused,
                                      "from": sender, "recipients": len(recipients), "note": note}}
    return _kept(answer, got, recs, raised)


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {
    "scraperConfigSet": config_set, "scraperRun": run, "scraperScore": score, "scraperNotify": notify}
POLICY: dict[str, dict[str, Any]] = {a: {"roles": ("admin", "manager")} for a in ACTIONS}
BUSY_OF: dict[str, dict[str, Any]] = {a: {"status": 409, "message": BUSY} for a in ACTIONS}


class Store(RR.Store):
    """app.talent_scraper_writes and app.talent_scraper_receipts; the settings and the referrals app.resource_rows'
    (the referrals the sheet's, through app.edits, while Potential Clients is Apps Script's)."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="talent_scraper", label="Lead Scraper")
