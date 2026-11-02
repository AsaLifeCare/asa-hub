"""Settings' last tools on Python, their reads: the asking rhythm (FlowAdmin.gs flowCadencesRoute_, the `hiringCadences`
adapter — its generic list and get, and the rows its slice holds), the phone provider's contact book walked for Quo
Enrich (HubCore.gs usersQuoEnrichCore_'s fetch, through Smart Comms' own provider key) and the contact clock's look
(contactSweepDue_). What they prepare is sealed for its write (app/settings_tools_writes.py); nothing here writes."""
from __future__ import annotations

import json
import logging
import time
import urllib.parse
from typing import Any, Callable

import candidates as CND
import door_gate as DG
import flow_cadence as FC
import gsjs
import hiring_outreach as HO
import hiring_sim_defaults as D
import locations as L
import recon as R
import smart_comms as SC

log = logging.getLogger("asa-hub-app")

APP_ID = "settings-tools"
RESOURCE = "hiringCadences"
ASKS_TAB = "hiring_sim_asks"
# FlowAdmin.gs FLOW_CADENCE_STEPS: (id, retry, action)
STEPS = (("ask", "pass", "hiringAskSend"), ("shortlist", "pass", "hiringShortlistSend"),
         ("outreach", "pass", "hiringOutreachSend"), ("screen_call", "pass", "hiringScreenCallSend"),
         ("resume_request", "pass", "hiringResumeRequestSend"), ("cjis_request", "pass", "hiringCjisRequestSend"),
         ("manual_contact", "pass", "manualContactSend"), ("invite", "pass", "interviewInviteSend"),
         ("referral_relay", "own", "referralRelaySweepMaybe_"), ("manual_adder", "own", "manualAdderSweepMaybe_"),
         ("director_docs", "own", "directorDocsSweepMaybe_"), ("ready_parked", "own", ""), ("ready_ask", "once", ""))
CADENCE_DENIED = {"status": 403, "message": "The asking rhythm is for the hiring team."}
CADENCE_READ_ONLY = {"status": 405, "message": "Cadence cells are edited through Settings."}
# HubCore.gs usersQuoEnrichCore_: the book's pages, fifty contacts each, 0.3 s apart
QUO_PAGES_MAX = 80
QUO_PAGE_SIZE = 50
QUO_PAGE_GAP_S = 0.3
# the walk stops here and enriches from the pages it read: the relay waits 110 s for the read
QUO_BUDGET_S = 95.0
QUO_NO_KEY = {"status": 400, "message": "Set OPENPHONE_API_KEY in Script Properties first."}
# HubCore.gs contactSweepHours_: 2 hours unless the config names a whole number from 1 to 24
SWEEP_HOURS_DEFAULT = 2
CLOCK_TABLE = "app.contact_sweep_clock"
SERVICE_ONLY = {"status": 403, "message": "This is the relay's own read."}

s_ = gsjs.str_


# ---- the asking rhythm -------------------------------------------------------------------------------------------

def _int(v: Any) -> int | None:
    n = CND.js_parse_int(v)
    return None if n != n else int(n)


def _shipped(key: str) -> str:
    """HIRING_SIM_CFG_DEFAULTS' first value for this key, else simTextDefault_ (no sim_text_ key is asked here)."""
    for k, v, _note in D.CFG_DEFAULTS:
        if k == key:
            return s_(v)
    return ""


def cadence_source(cfg: dict[str, str], per_key: str, all_key: str) -> dict[str, str]:
    """flowCadenceSource_: a blank step cell takes the shipped default before the global cell."""
    per = s_(cfg.get(per_key))
    if per:
        return {"from": "step", "key": per_key, "value": per}
    shipped = _shipped(per_key)
    if shipped:
        return {"from": "shipped", "key": per_key, "value": shipped}
    every = s_(cfg.get(all_key))
    if every:
        return {"from": "global", "key": all_key, "value": every}
    return {"from": "shipped", "key": all_key, "value": ""}


def cadences(reads: L.Reads) -> dict[str, Any]:
    """flowCadences_: each asking step's numbers, where they come from, and its open asks drifting from them."""
    cfg = HO.sim_cfg(reads)
    open_by: dict[str, list[dict[str, int]]] = {}
    book_ok = True
    try:
        for r in CND.read_tab(reads, ASKS_TAB):
            if s_(r.get("state")) != "open":
                continue
            open_by.setdefault(s_(r.get("step")), []).append(
                {"max": _int(s_(r.get("maxattempts"))) or 0, "mins": _int(s_(r.get("intervalminutes"))) or 0})
    except Exception as exc:  # noqa: BLE001 - an unreadable book is not an empty one
        book_ok = False
        log.warning("hiringCadences: the ask book was not read (%s)", type(exc).__name__)
    words = CND.book_kv(reads, "Steps")
    rows = []
    for sid, retry, action in STEPS:
        force = FC.attempts_for(cfg, sid)
        rows_open = open_by.get(sid, [])
        rows.append({
            "id": sid, "label": s_(words.get("cadence." + sid + ".label")),
            "asks": s_(words.get("cadence." + sid + ".asks")), "retry": retry,
            "retry_words": s_(words.get("cadence.retry." + retry)), "action": action,
            "attempts": force["attempts"], "minutes": force["minutes"],
            "attempts_source": cadence_source(cfg, "sim_attempts_" + sid, "sim_attempts"),
            "minutes_source": cadence_source(cfg, "sim_retry_minutes_" + sid, "sim_retry_minutes"),
            "attempts_key": "sim_attempts_" + sid, "minutes_key": "sim_retry_minutes_" + sid,
            "open": len(rows_open),
            "drifting": sum(1 for o in rows_open if o["max"] != force["attempts"] or o["mins"] != force["minutes"])})
    return {"rows": rows, "book_readable": book_ok,
            "global_attempts": _int(s_(cfg.get("sim_attempts"))) or 1,
            "global_minutes": _int(s_(cfg.get("sim_retry_minutes"))) or 30,
            "floor_minutes": 5, "cap_attempts": 50}


def cadence_refusal(sess: L.Session, door: str, payload: dict) -> dict[str, Any] | None:
    """doPost's place gate for the generic verb, then flowCadencesRoute_'s: the hiring team, or the service."""
    refused = DG.refusal(sess, door, payload, {})
    if refused:
        return refused
    user = sess.user or {}
    if not sess.user or (not user.get("is_service") and s_(user.get("role")) not in ("admin", "manager")):
        return dict(CADENCE_DENIED)
    return None


def cadences_door(door: str) -> Callable[[L.Session, dict], dict[str, Any]]:
    def answer(sess: L.Session, payload: dict) -> dict[str, Any]:
        """flowCadencesRoute_ for `list` and `get`: the rhythm, whole."""
        return cadence_refusal(sess, door, payload) or {"status": 200, "data": cadences(sess.reads)}
    return answer


def cadence_rows(sess: L.Session, payload: dict) -> dict[str, Any]:
    """The hiringCadences slice: the rows of the adapter's answer, as the relay keeps them (data.rows)."""
    refused = cadence_refusal(sess, "hiringCadencesList", payload)
    if refused:
        return refused
    return {"status": 200, "data": cadences(sess.reads)["rows"]}


# ---- the phone provider's contact book ---------------------------------------------------------------------------

def _contact(c: Any) -> dict[str, Any] | None:
    """One provider contact as the enrich reads it: its id, its e-mails, its labelled numbers."""
    if not isinstance(c, dict):
        return None
    df = c.get("defaultFields") if isinstance(c.get("defaultFields"), dict) else {}
    emails = [s_((e or {}).get("value")) for e in (df.get("emails") or []) if isinstance(e, dict)]
    phones = [{"name": s_((p or {}).get("name")), "value": s_((p or {}).get("value"))}
              for p in (df.get("phoneNumbers") or []) if isinstance(p, dict)]
    return {"id": s_(c.get("id")), "emails": emails, "phones": phones}


def quo_book(budget_s: float = QUO_BUDGET_S) -> dict[str, Any]:
    """usersQuoEnrichCore_'s fetch: the whole book, page by page; {no_key} without a provider key, {error} when the
    provider answered no contact. Read-only toward the provider, and never says the key."""
    key = SC._key()
    if not key:
        return {"no_key": True}
    contacts: list[dict[str, Any]] = []
    page_token, pages, note = "", 0, ""
    started = time.monotonic()
    while pages < QUO_PAGES_MAX:
        if time.monotonic() - started > budget_s:
            note = f"stopped after {pages} page(s): the read's time ran out"
            break
        url = f"{SC.PROVIDER}/contacts?maxResults={QUO_PAGE_SIZE}" + (
            "&pageToken=" + urllib.parse.quote(page_token, safe="") if page_token else "")
        try:
            code, text = SC._http("GET", url, key)
        except Exception as exc:  # noqa: BLE001 - said as the walk's note, never the key
            note = "transport: " + (type(exc).__name__ + (": " + str(exc)[:120] if str(exc) else ""))
            break
        if code != 200:
            note = f"HTTP {code}"
            break
        try:
            body = json.loads(text or "")
        except ValueError:
            note = "unparseable page"
            break
        for c in (body.get("data") if isinstance(body, dict) and isinstance(body.get("data"), list) else []):
            got = _contact(c)
            if got is not None:
                contacts.append(got)
        pages += 1
        page_token = s_(body.get("nextPageToken")) if isinstance(body, dict) else ""
        if not page_token:
            break
        time.sleep(QUO_PAGE_GAP_S)
    if not contacts:
        return {"error": "Quo answered no contacts (" + (note or "empty book") + ") — nothing was written."}
    return {"contacts": contacts, "pages": pages, "note": note}


def quo_fetch(sess: L.Session, payload: dict) -> dict[str, Any]:
    """usersQuoEnrich's first half: the admin's gate, then the book read and sealed for usersQuoEnrichApply."""
    refused = DG.refusal(sess, "usersQuoEnrich", payload, GS_POLICY)
    if refused:
        return refused
    user = sess.user or {}
    if not sess.user or user.get("is_service") or s_(user.get("role")) != "admin":
        return dict(DG.DENIED)
    book = quo_book()
    if book.get("no_key"):
        return dict(QUO_NO_KEY)
    if book.get("error"):
        return {"status": 502, "message": book["error"]}
    return {"status": 200, "data": R.seal("usersQuoFetch", s_(user.get("id")), book)}


# ---- the contact clock's look ------------------------------------------------------------------------------------

def sweep_hours(reads: L.Reads) -> int:
    """contactSweepHours_: the configured whole hours, 1 to 24; anything else is 2."""
    try:
        h = _int(s_(SC.read_config(reads.db).get("contact_sweep_hours")))
    except Exception:  # noqa: BLE001 - an unread config is the default
        h = None
    return h if h is not None and 1 <= h <= 24 else SWEEP_HOURS_DEFAULT


def clock(reads: L.Reads) -> dict[str, Any]:
    """The contact clock as Settings armed it: off while no press armed it, or while it cannot be read."""
    try:
        got = reads.db.query(f"select armed, extract(epoch from ran_at) from {CLOCK_TABLE} where id = 1")
    except Exception:  # noqa: BLE001 - a clock that cannot be read is off
        return {"armed": False, "ran_at": None}
    if not got:
        return {"armed": False, "ran_at": None}
    return {"armed": got[0][0] is True, "ran_at": float(got[0][1]) if got[0][1] is not None else None}


def window_open(ran_at: float | None, hours: int, now: float) -> bool:
    """contactSweepDue_'s window: never run, or the configured hours gone since the last pass."""
    return not ran_at or now - ran_at >= hours * 3600


def sweep_due(sess: L.Session, payload: dict) -> dict[str, Any]:
    """contactAutoSweep's look on the relay's clock: while armed and its window is open, the contact book read for the
    pass (contactSweepRun keeps it, with the phones filled from the roster)."""
    if (sess.user or {}).get("is_service") is not True:
        return dict(SERVICE_ONLY)
    reads = sess.reads
    held = clock(reads)
    hours = sweep_hours(reads)
    if not held["armed"]:
        return {"status": 200, "data": {"due": False, "armed": False, "hours": hours}}
    if not window_open(held["ran_at"], hours, time.time()):
        return {"status": 200, "data": {"due": False, "armed": True, "hours": hours}}
    return {"status": 200, "data": R.seal("contactSweepDue", "service", {"due": True, "hours": hours,
                                                                        "quo": quo_book()})}


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {
    "hiringCadencesList": cadences_door("hiringCadencesList"), "hiringCadencesGet": cadences_door("hiringCadencesGet"),
    "hiringCadencesRows": cadence_rows, "usersQuoFetch": quo_fetch, "contactSweepDue": sweep_due}
# HUB_POLICY as HubCore.gs declares it, asked by door_gate after the place, as doPost asks it
GS_POLICY: dict[str, dict[str, Any]] = {"usersQuoEnrich": {"roles": ("admin",)},
                                        "syncFromLegacy": {"roles": ("admin",)},
                                        "contactSweepInstall": {"roles": ("admin",)}}
# main.policy_gate asks nothing: each door asks door_gate first
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
