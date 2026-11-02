"""An app's release announcement (ReleaseUsers.gs, CommRelease.gs commReleaseAppTell_) on Python: when App Control
opens an app to a badge, every released account the badges reach is told once — a text and a letter through Smart
Comms (`app_release_announced`), held in its outbox through the quiet window. Who was told is app.app_release_told
beside the sheet's app_release_log; the badges each app opened as last seen app.app_release_access (what a save adds
to); the announcements owed for later app.app_release_pending (the morning list). appReleaseDue is the relay's look
before its clock rings appReleaseSweep."""
from __future__ import annotations

import time
from datetime import datetime, timezone
from typing import Any, Callable

import gsjs
import house_tables as HT
import locations as L
import resource_rows as RR
import scope as sc
import smart_comms as SC
import smart_comms_desk as SCD
import staff as SP

APP_ID = "app-release"
SITUATION = "app_release_announced"
URL = "https://asamylife.asalifecare.com"
MATRIX_TAB = "app_badge_access"
LOG_TAB = "app_release_log"
TOLD, ACCESS, PENDING, STAMP = ("app.app_release_told", "app.app_release_access", "app.app_release_pending",
                                "app.app_release_stamp")
# inside a write's own budget, with room left for the reads
BUDGET_S = 5.0
# APP_RELEASE_AUTO_MAX_LETTERS: a pass on a save writes to this many people at most, the clock the rest
AUTO_MAX = 40
# HUB_QUIET_OWED_HORIZON_MS: an announcement owed longer than a day and a half is let go
HORIZON_S = 36 * 3600.0

s_ = gsjs.str_


def _at_ms(v: Any) -> float:
    if isinstance(v, datetime):
        return v.timestamp() * 1000.0
    got = gsjs.date_parse(gsjs.or_text(v))
    return got if got is not None else 0.0


def access(reads: L.Reads) -> dict[str, list[str]]:
    """The badges each app opens to: the access matrix's copy, and the newer of it and what Python last saw a save
    write."""
    out: dict[str, tuple[list[str], float]] = {}
    res = HT.where(reads, MATRIX_TAB)
    if res.ref is None and not res.book_known:
        raise RuntimeError("asa-hub-db holds no copy of the access matrix")
    for _rn, raw in (reads.db.rows(res.ref) if res.ref else []):
        app = s_(raw.get("app_id"))
        if app:
            out[app] = (sc.types_from_raw(raw.get("badges")), _at_ms(raw.get("updated_at")))
    for app, badges, at in RR._q(reads, f"select app_id, badges, at from {ACCESS}"):
        if app not in out or _at_ms(at) >= out[app][1]:
            out[app] = (sc.types_from_raw(badges), _at_ms(at))
    return {a: b for a, (b, _t) in out.items()}


def masters_only(reads: L.Reads) -> set[str]:
    """Settings › My Work's app list: an app kept to the master's own session is announced to nobody."""
    return set(sc.list_cell(reads.config().get(sc.MYWORK_APPS_KEY)))


def situation(reads: L.Reads) -> dict[str, Any]:
    """commReleaseSituationRead_: on with its words, off, wordless, or unreadable."""
    try:
        row = SC.situation_row(SC.read_situations(reads.db), SITUATION)
    except Exception as exc:  # noqa: BLE001 - an unread book is never a yes
        return {"state": "unreadable", "sit": None,
                "why": f"the situations tab could not be read ({type(exc).__name__}) — nobody was written to"}
    if row is None:
        return {"state": "wordless", "sit": None,
                "why": f"the situation `{SITUATION}` is not in the situations tab — nobody was written to"}
    if not SC.smart_on(row.get("enabled")):
        return {"state": "off", "sit": row,
                "why": f"the situation `{SITUATION}` is switched off in Smart Comms — nobody was written to"}
    if not (s_(row.get("sms_text")) or s_(row.get("email_text"))):
        return {"state": "wordless", "sit": row, "why": f"the situation `{SITUATION}` has no words — nobody was "
                                                         "written to"}
    return {"state": "on", "sit": row, "why": ""}


def told(reads: L.Reads) -> dict[str, Any]:
    """appReleaseAlreadyTold_: who heard about which app (the sheet's log and Python's), and who declined when."""
    out: dict[str, Any] = {"map": set(), "declined": {}}

    def note(app: str, uid: str, mail: str, sent: bool, mode: str, at: float) -> None:
        if sent:
            if app and uid:
                out["map"].add(app + "|" + uid)
            if app and mail:
                out["map"].add(app + "|" + mail)
            return
        if mode != "declined" or not at:
            return
        for k in (app + "|" + uid if uid else "", app + "|" + mail if mail else ""):
            if k and out["declined"].get(k, 0) < at:
                out["declined"][k] = at

    if HT.tabled(LOG_TAB):
        logged = HT.raw(reads, LOG_TAB)[1]
    else:
        res = reads.db.resolve(LOG_TAB)
        logged = reads.db.rows(res.ref) if res.ref else []
    for _rn, raw in logged:
        note(s_(raw.get("app_id")), s_(raw.get("user_id")), s_(raw.get("email")).lower(),
             s_(raw.get("sent")).lower() == "true", s_(raw.get("mode")).lower(), _at_ms(raw.get("at")))
    for app, uid, mail, sent, mode, at in RR._q(reads, f"select app_id, user_id, email, sent, mode, at from {TOLD}"):
        note(s_(app), s_(uid), s_(mail).lower(), bool(sent), s_(mode).lower(), _at_ms(at))
    return out


def matches(u: dict, app_id: str, badges: list[str]) -> str:
    """appReleaseMatches_: the account's address when its badges open the app."""
    if not badges or not s_(u.get("userid")) or s_(u.get("active")).lower() != "true":
        return ""
    email = s_(u.get("email"))
    if "@" not in email or s_(u.get("systemhidden")).lower() == "true":
        return ""
    import json  # noqa: PLC0415
    try:
        den = json.loads(s_(u.get("appdenials")) or "[]")
        if isinstance(den, list) and app_id in den:
            return ""
    except ValueError:
        pass
    mine = {b.upper() for b in sc.badges_matched(u.get("types"), u.get("role"))}
    return email.lower() if any(b in mine for b in badges) else ""


def phone_at(u: dict) -> str:
    """releasePhoneAt_: the phone column, else the first number the phones list carries."""
    raw = s_(u.get("phone"))
    if not raw:
        for p in SP._parse_phones(u.get("phones")):
            raw = s_(p.get("number") if isinstance(p, dict) else p)
            if raw:
                break
    return raw


def tell(sit: dict, who: dict[str, str], app: dict[str, str]) -> dict[str, Any]:
    """commReleaseAppTell_ and appReleaseLetterOut_: a letter and a text, one answer per person."""
    name = who["name"]
    v = {"first_name": name.split()[0] if name.split() else "", "name": name, "app_title": app["title"] or app["id"],
         "objective": app["objective"], "url": URL, "sender": SC.SENDER_DEFAULT}
    idem = "apprel_" + app["id"][:24] + "_" + who["uid"][:24]
    chans = SC.smart_list(sit.get("channels")) or ["sms", "email"]
    legs: list[dict] = []
    if "@" in who["email"] and "email" in chans:
        legs.append(SC.raise_situation(None, situation=SITUATION, to=who["email"], vars=v, key=idem + "_email",
                                       lane="release", at_ms=int(time.time() * 1000), prune=False, channel="email"))
    if "sms" in chans and who["phone"] and SC.team_copy(who["phone"]):
        legs.append(SC.raise_situation(None, situation=SITUATION, to=who["phone"], vars=v, key=idem + "_sms",
                                       lane="release", at_ms=int(time.time() * 1000), prune=False, team=True))
    n = {"sent": 0, "already": 0, "dial": 0, "quiet": 0, "declined": 0, "unchecked": 0}
    reason, off = "", ""
    for g in legs:
        st, held, why = s_(g.get("state")), s_(g.get("held")), s_(g.get("why"))
        if st in ("sent", "already"):
            n[st] += 1
        elif st == "held" and held == "quiet":
            n["quiet"] += 1
        elif st == "refused":
            n["declined" if why.startswith("This person asked us to stop") else "unchecked"] += 1
        elif st == "held":
            n["dial"] += 1
            reason = reason or ("rehearsal" if held in ("test_mode", "recorded") else held)
        elif st == "off":
            off = off or why
    for key, outcome in (("sent", "sent"), ("already", "already_sent"), ("dial", "dial"), ("quiet", "quiet"),
                         ("unchecked", "unchecked"), ("declined", "declined")):
        if n[key]:
            return {"outcome": outcome, "held_reason": reason if outcome == "dial" else ""}
    return {"outcome": "silenced", "held_reason": "", "why": off} if off else {"outcome": "failed", "held_reason": ""}


def log_mode(res: dict, mode: str) -> str:
    """appReleaseLogMode_."""
    o = res["outcome"]
    if o in ("sent", "failed"):
        return mode
    if o == "already_sent":
        return "already_sent"
    if o == "quiet":
        return "held_quiet"
    if o == "dial":
        brake = res["held_reason"]
        return "rehearsal" if brake in ("", "rehearsal", "held") else "held_" + brake
    return o


def tally() -> dict[str, Any]:
    return {"sent": 0, "already_sent": 0, "held_dial": 0, "held_quiet": 0, "declined": 0, "unchecked": 0,
            "failed": 0, "silenced": ""}


def count(t: dict, res: dict) -> None:
    """appReleaseCount_."""
    o = res["outcome"]
    key = {"sent": "sent", "already_sent": "already_sent", "dial": "held_dial", "quiet": "held_quiet",
           "declined": "declined", "unchecked": "unchecked"}.get(o)
    if key:
        t[key] += 1
    elif o == "silenced":
        t["silenced"] = res.get("why") or "the situation went silent"
    else:
        t["failed"] += 1


def complete(t: dict, told_before: int) -> bool:
    """appReleaseComplete_: everybody who can still be told was told."""
    return (not t["silenced"] and not t["held_dial"] and not t["held_quiet"] and not t["unchecked"]
            and not t["failed"] and (t["sent"] + t["already_sent"] + told_before) > 0)


def run(reads: L.Reads, sit: dict, app: dict[str, str], badges: list[str], *, mode: str, again: bool = False,
        resume: int = 0, since_ms: float = 0.0, most: int = 0, started: float = 0.0) -> dict[str, Any]:
    """One pass over the accounts: whom the badges reach, released, not yet told — each told and logged."""
    known = told(reads)
    t = tally()
    out: dict[str, Any] = {"tally": t, "eligible": 0, "matched": 0, "not_released": 0, "already_told": 0,
                           "declined_before": 0, "unwritten": 0, "stopped_at": 0, "held_by": {}}
    sent_to: set[str] = set()
    letters = 0
    for r, u in enumerate(reads.users(), start=1):
        email = matches(u, app["id"], badges)
        if not email or email in sent_to:
            continue
        sent_to.add(email)
        out["matched"] += 1
        if not s_(u.get("releasedat")):
            out["not_released"] += 1
            continue
        out["eligible"] += 1
        if resume and r < resume:
            continue
        uid = s_(u.get("userid"))
        if not again and (app["id"] + "|" + uid in known["map"] or app["id"] + "|" + email in known["map"]):
            out["already_told"] += 1
            continue
        if since_ms:
            at = max(known["declined"].get(app["id"] + "|" + uid, 0), known["declined"].get(app["id"] + "|" + email, 0))
            if at and at >= since_ms:
                out["declined_before"] += 1
                continue
        if (most and letters >= most) or (started and time.monotonic() - started > BUDGET_S):
            out["unwritten"] += 1
            if not out["stopped_at"]:
                out["stopped_at"] = r
            if mode == "manual":
                break
            continue
        letters += 1
        res = tell(sit, {"email": email, "phone": phone_at(u), "name": s_(u.get("displayname")), "uid": uid}, app)
        count(t, res)
        if res["outcome"] == "dial":
            out["held_by"][res["held_reason"] or "held"] = out["held_by"].get(res["held_reason"] or "held", 0) + 1
        if res["outcome"] == "silenced":
            break
        RR._cur().execute(f"insert into {TOLD} (app_id, title, user_id, email, mode, sent) values (%s, %s, %s, %s, %s,"
                          " %s)", (app["id"], app["title"], uid, email, log_mode(res, mode),
                                   res["outcome"] in ("sent", "already_sent")))
    return out


def stamped(reads: L.Reads, app_id: str) -> str:
    """APP_RELEASE_ANNOUNCED: when the app's announcement reached everybody it could (Python's, then the depot's)."""
    got = RR._q(reads, f"select at from {STAMP} where app_id = %s", (app_id,))
    if got:
        return gsjs.iso(got[0][0]) if isinstance(got[0][0], datetime) else s_(got[0][0])
    import json  # noqa: PLC0415
    try:
        seen = json.loads(s_(reads.db.prop("APP_RELEASE_ANNOUNCED")) or "{}")
    except ValueError:
        seen = {}
    return s_(seen.get(app_id)) if isinstance(seen, dict) else ""


def pending(reads: L.Reads) -> list[dict[str, Any]]:
    return [{"app_id": a, "badges": sc.types_from_raw(b), "name": s_(n), "tagline": s_(tg), "whole": bool(w),
             "since": since} for a, b, n, tg, w, since in RR._q(
                 reads, f"select app_id, badges, name, tagline, whole, since from {PENDING} order by since")]


def app_release_due(sess: L.Session, payload: dict) -> dict[str, Any]:
    """The relay's look before it rings the sweep: the announcements owed, none while the quiet window holds."""
    if (sess.user or {}).get("is_service") is not True:
        return {"status": 403, "message": "This is the relay's own read."}
    quiet = SCD.quiet_now(sess.reads)
    return {"status": 200, "data": {"quiet": quiet, "pending": 0 if quiet else len(pending(sess.reads))}}


def now_iso() -> str:
    return gsjs.iso(datetime.now(timezone.utc))


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {"appReleaseDue": app_release_due}
POLICY: dict[str, dict[str, Any]] = {"appReleaseDue": {}}
