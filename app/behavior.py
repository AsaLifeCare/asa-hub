"""Behaviour support (Behavior.gs) off Postgres: the signals the relay measures and the reading composed from them,
kept as the platform's own resources (app.resource_rows `behaviorSignals` and `behaviorReadings`, the sheets' copies
read until they are uploaded). The reads — the board of snapshots, every reading this caller may see, one person's
whole record — and the heavy halves the relay asks first: a reading composed by the model (behaviorEvaluate, and the
six-hourly composition on the relay's clock, behaviorSweepDue) and the signals' hand-off compared with what is held
(behaviorSignalsPrepare). It never reads message, document or client-name content, and never ranks one person against
another; whoever may not see everybody is narrowed to themselves in silence."""
from __future__ import annotations

import hashlib
import json
import re
import time
from typing import Any, Callable

import candidate_papers as CP
import candidates as CND
import gsjs
import hubdb
import locations as L
import resource_rows as RR
import scope as sc
import screening as SG
from scope import Defer

s_ = gsjs.str_
DENIED = SG.DENIED
SIGNALS_TAB, READINGS_TAB = "behavior_signals", "behavior_readings"
SIGNALS, READINGS = "behaviorSignals", "behaviorReadings"
RESOURCES = {SIGNALS: SIGNALS_TAB, READINGS: READINGS_TAB}
SIGNALS_HEADER = ("id", "createdAt", "updatedAt", "subject_kind", "subject_key", "subject_name", "signal", "value", "unit",
                  "detail", "at", "window", "source", "tenant", "payload")
READINGS_HEADER = ("id", "createdAt", "updatedAt", "subject_kind", "subject_key", "subject_name", "role", "window_days",
                   "computed_at", "signals_hash", "metrics", "top_apps", "franchises", "site_verdict", "site_why",
                   "shift_verdict", "shift_why", "reach_verdict", "reading", "highlights", "tags", "ai_model", "ai_via",
                   "ai_at", "cortex_note", "cortex_at", "sources")
AI_REQUEST = "ai_behavior_reading"
INGEST_CAP = 900
EVALUATE_CAP = 6
INGEST_GATE = "gate_behavior_signals_ingest"
PROMPT_FLOOR = "\n".join((
    "You are reading how one person uses an internal care-agency platform, to",
    "help their manager notice STRAIN and support them. This is a wellbeing",
    "reading, never a performance score and never a disciplinary note.",
    "",
    "You are given only counted facts. Rules, all of them absolute:",
    "- Use ONLY the facts given. Never invent a number, a habit or a cause.",
    "- Never compare this person to anybody else, and never rank them.",
    "- \"quiet\" means the platform recorded little — say that plainly; it is not",
    "  a criticism and it may simply mean their work happens off the platform.",
    "- Nights, weekends and long unbroken runs are worth naming kindly, as",
    "  something a manager might ask about, never as an accusation.",
    "- If the facts are too thin to say anything, say exactly that.",
    "- Write about what the person DOES, never about what they are.",
    "- Courses and requirements describe PAPER, not character. An expired",
    "  certificate means a renewal date passed — say it as something to book,",
    "  never as neglect, risk or a reason to doubt anyone. Never suggest",
    "  removing someone from work, and never treat a missing record as proof",
    "  the training did not happen; our filing is incomplete, not the person.",
    "- What somebody was trained to do is context for their rhythm: it may",
    "  explain which apps they live in. Use it that way.",
    "",
    "Answer with JSON only, no prose outside it:",
    "{\"reading\":\"two or three sentences, plain English, addressed to a manager\",",
    " \"highlights\":[\"at most 3 short factual observations\"],",
    " \"tags\":[\"at most 4 one-or-two-word tags, lowercase\"]}",
    "",
    "THE FACTS:",
    "{facts}"))


# ---- the pure half -------------------------------------------------------------------------------------------------

def bstr(v: Any) -> str:
    """behaviorStr_: whitespace runs as one space, trimmed; null and undefined blank."""
    if v is None:
        return ""
    return re.sub(r"\s+", " ", gsjs.js_str(v)).strip()


def bjson(raw: Any, fallback: Any) -> Any:
    """behaviorJson_."""
    s = bstr(raw)
    if not s:
        return fallback
    try:
        v = json.loads(s)
    except ValueError:
        return fallback
    return fallback if v is None else v


def facts_block(person: dict, signals: list[dict]) -> str:
    """behaviorFactsBlock_: the only thing the model is shown — no id, e-mail, client name or message text."""
    by: dict[str, dict] = {}
    for sg in signals or []:
        name = bstr(sg.get("signal"))
        if name:
            by[name] = sg

    def val(k: str) -> str:
        return bstr(by[k].get("value")) if k in by else ""

    def why(k: str) -> str:
        return bstr(by[k].get("detail")) if k in by else ""
    lines = ["Person: " + bstr(person.get("name") or "unnamed")
             + (" (" + bstr(person.get("role")) + ")" if person.get("role") else "")
             + (" — " + bstr(person.get("title")) if person.get("title") else ""),
             "Window: the last " + bstr(person.get("window_days") or 30) + " days."]
    if val("site.actions"):
        lines.append("On the platform: " + val("site.actions") + " recorded actions across " + val("site.active_days")
                     + " day(s); " + (val("site.night_actions") or "0") + " between 10pm and 5am; "
                     + (val("site.weekend_actions") or "0") + " at weekends; longest unbroken run "
                     + (val("site.longest_run") or "0") + " day(s).")
    else:
        lines.append("On the platform: nothing was recorded for this account in the window.")
    apps = []
    for k in by:
        if k.startswith("app."):
            n = CND.js_number(by[k].get("value"))
            apps.append({"app": k[4:], "n": 0 if n != n or not n else n})
    apps.sort(key=lambda a: -a["n"])
    if apps:
        lines.append("Where that work happened: " + ", ".join(a["app"] + " (" + gsjs.num_str(a["n"]) + ")"
                                                              for a in apps[:5]) + ".")
    lines.append("Forms: " + val("habit.forms") + " form action(s) — they do work with forms." if val("habit.forms")
                 else "Forms: no form work recorded in the window.")
    lines.append("Client images: " + val("habit.images") + " action(s) in the wellbeing/image lane."
                 if val("habit.images") else "Client images: none recorded in the window.")
    if val("shift.count"):
        lines.append("On the roster: " + val("shift.count") + " shift(s) over " + val("shift.days") + " day(s), "
                     + (val("shift.overnights") or "0") + " overnight(s), longest run "
                     + (val("shift.longest_run") or "0") + " day(s) on.")
    else:
        lines.append("On the roster: no shift in the window.")
    if val("reach.verdict"):
        lines.append("Where they may stand: " + (why("reach.verdict") or val("reach.verdict")) + ".")
    if val("training.completed"):
        lines.append("Courses completed: " + (why("training.completed") or val("training.completed")) + ".")
        if val("training.valid"):
            lines.append("Still in date: " + why("training.valid") + ".")
        if val("training.expiring"):
            lines.append("Renewal due within 60 days: " + why("training.expiring") + ".")
        if val("training.expired"):
            lines.append("Past its date: " + why("training.expired") + ".")
    else:
        lines.append("Courses completed: the estate holds no course record for this person.")
    if val("ist.done"):
        lines.append("Client-specific training: " + val("ist.done") + " record(s) signed off"
                     + (" across " + why("ist.done") if why("ist.done") else "")
                     + ("; " + val("ist.owed") + " still owed" if val("ist.owed") else "") + ".")
    if val("req.ok") or val("req.missing") or val("req.expired"):
        lines.append("Onboarding requirements: " + (val("req.ok") or "0") + " met, " + (val("req.missing") or "0")
                     + " not yet on file, " + (val("req.expiring") or "0") + " expiring, "
                     + (val("req.expired") or "0") + " expired.")
    sv, hv = val("site.verdict"), val("shift.verdict")
    if sv:
        lines.append("The platform's own verdict on their rhythm here: " + sv + " — " + why("site.verdict") + ".")
    if hv:
        lines.append("And on their roster rhythm: " + hv + " — " + why("shift.verdict") + ".")
    return "\n".join(lines)


def facts_hash(block: str) -> str:
    """behaviorHash_: the reading is bought again only when this moves."""
    return hashlib.md5(block.encode("utf-8")).hexdigest()[:16]  # noqa: S324 - a fingerprint


def parse_reading(content: Any) -> dict | None:
    """behaviorParse_: a missing field stays missing, never a placeholder that could pass for a reading."""
    got = SG.parsed(bstr(content))
    if not isinstance(got, dict):
        return None
    reading = SG.js_slice(bstr(got.get("reading")), 1200)
    if not reading:
        return None

    def lst(v: Any, cap: int, n: int) -> list[str]:
        return [x for x in (SG.js_slice(bstr(i), n) for i in (v if isinstance(v, list) else [])) if x][:cap]
    return {"reading": reading, "highlights": lst(got.get("highlights"), 3, 160), "tags": lst(got.get("tags"), 4, 24)}


# ---- the houses (Postgres once uploaded, the sheet's copy before) --------------------------------------------------

def uploaded(reads: L.Reads, resource: str) -> bool:
    return bool(reads.once("behavior_up:" + resource, lambda: RR.uploaded(reads.db, resource)))


def rows(reads: L.Reads, resource: str) -> list[dict]:
    """behaviorRows_: every row with anything in it, header-keyed, each with its key (`_key`) where Postgres holds it."""
    def read() -> list[dict]:
        out = []
        if uploaded(reads, resource):
            cols = RR.columns(reads, resource)
            for k, cells in RR.table_rows(reads, resource):
                if all(cells.get(c) in (None, "") for c in cols):
                    continue
                out.append({**{c: cells.get(c, "") for c in cols if c}, "_key": k})
            return out
        res = reads.db.resolve(RESOURCES[resource])
        if res.runtime:
            raise Defer(f"{RESOURCES[resource]} lives in the depot's facts")
        if res.ref is None:
            if not res.book_known:
                raise hubdb.Unreadable(f"asa-hub-db holds no copy of the book behind {RESOURCES[resource]}")
            return []
        for _rn, raw in reads.db.rows(res.ref):
            if all(v in (None, "") for v in raw.values()):
                continue
            out.append({h: v for h, v in raw.items() if h != ""})
        return out
    return [dict(r) for r in reads.once("behavior_rows:" + resource, read)]


def signals_for(reads: L.Reads, key: str) -> list[dict]:
    """behaviorSignalsFor_: a house that cannot be read holds nothing."""
    try:
        got = rows(reads, SIGNALS)
    except (hubdb.Unreadable, Defer):
        raise
    except Exception:  # noqa: BLE001 - as the .gs
        return []
    k = bstr(key)
    return [{"signal": bstr(r.get("signal")), "value": bstr(r.get("value")), "unit": bstr(r.get("unit")),
             "detail": bstr(r.get("detail")), "at": bstr(r.get("at")), "window": bstr(r.get("window")),
             "source": bstr(r.get("source")), "subject_name": bstr(r.get("subject_name")),
             "subject_kind": bstr(r.get("subject_kind"))} for r in got if bstr(r.get("subject_key")) == k]


def reading_shape(key: str, found: dict) -> dict[str, Any]:
    return {"subject_key": key, "subject_name": bstr(found.get("subject_name")), "role": bstr(found.get("role")),
            "window_days": bstr(found.get("window_days")), "computed_at": bstr(found.get("computed_at")),
            "signals_hash": bstr(found.get("signals_hash")), "metrics": bjson(found.get("metrics"), {}),
            "top_apps": bjson(found.get("top_apps"), []), "franchises": bjson(found.get("franchises"), []),
            "site_verdict": bstr(found.get("site_verdict")), "site_why": bstr(found.get("site_why")),
            "shift_verdict": bstr(found.get("shift_verdict")), "shift_why": bstr(found.get("shift_why")),
            "reach_verdict": bstr(found.get("reach_verdict")), "reading": bstr(found.get("reading")),
            "highlights": bjson(found.get("highlights"), []), "tags": bjson(found.get("tags"), []),
            "ai_model": bstr(found.get("ai_model")), "ai_via": bstr(found.get("ai_via")), "ai_at": bstr(found.get("ai_at")),
            "cortex_note": bstr(found.get("cortex_note")), "cortex_at": bstr(found.get("cortex_at")),
            "sources": bjson(found.get("sources"), [])}


def reading_for(reads: L.Reads, key: str) -> dict | None:
    """behaviorReadingFor_: the person's last reading row."""
    try:
        got = rows(reads, READINGS)
    except (hubdb.Unreadable, Defer):
        raise
    except Exception:  # noqa: BLE001 - as the .gs
        return None
    k = bstr(key)
    found = None
    for r in got:
        if bstr(r.get("subject_key")) == k:
            found = r
    return reading_shape(k, found) if found is not None else None


# ---- who reads whom ------------------------------------------------------------------------------------------------

def sees_all(reads: L.Reads, user: dict | None) -> bool:
    """behaviorSeesAll_ through hubGrantedFeatureOn_('behavior_all_badges'): the master; else a badge the row names —
    an empty row means the master alone, never everyone."""
    if not user or SG.service(user):
        return False
    try:
        if sc.is_master_email(user.get("email")):
            return True
        cfg = s_(reads.config().get("behavior_all_badges"))
        if not cfg.strip():
            return False
        types = user.get("types")
        have = (",".join(str(t) for t in types) if isinstance(types, list) else gsjs.or_text(types)).upper()
        role = gsjs.or_text(user.get("role")).upper().strip()
        if role:
            have = have + "," + role if have else role
        for worn, stands in sc.BADGE_FOLLOWS.items():
            if worn in have:
                have = have + "," + stands
        return any(b.strip().upper() and b.strip().upper() in have for b in cfg.split(","))
    except (hubdb.Unreadable, Defer):
        raise
    except Exception:  # noqa: BLE001 - as the .gs: an unreadable grant is the admin's alone
        return s_(user.get("role")) == "admin"


def may_read(user: dict | None) -> bool:
    """behaviorMayRead_."""
    return bool(user) and not SG.service(user) and bool(s_((user or {}).get("id")))


def subject_for(reads: L.Reads, user: dict, wanted: Any) -> str:
    """behaviorSubjectFor_: narrowed silently to the caller — a refusal would reveal that the other person exists."""
    own = s_(user.get("id"))
    if not sees_all(reads, user):
        return own
    return bstr(wanted) or own


# ---- the reads -----------------------------------------------------------------------------------------------------

def readings(sess: L.Session, payload: dict) -> dict[str, Any]:
    """behaviorReadings: every stored reading this caller may see — everybody's for a badged reader, their own alone
    for everyone else."""
    reads, user = sess.reads, sess.user or {}
    if not may_read(user):
        return dict(DENIED)
    every, own = sees_all(reads, user), s_(user.get("id"))
    try:
        got = rows(reads, READINGS)
    except (hubdb.Unreadable, Defer):
        raise
    except Exception:  # noqa: BLE001 - as the .gs
        return {"status": 200, "data": {"readings": [], "sees_all": every, "note": "No reading has been composed yet."}}
    out = [{"subject_key": bstr(r.get("subject_key")), "subject_name": bstr(r.get("subject_name")),
            "computed_at": bstr(r.get("computed_at")), "signals_hash": bstr(r.get("signals_hash")),
            "site_verdict": bstr(r.get("site_verdict")), "shift_verdict": bstr(r.get("shift_verdict")),
            "reading": bstr(r.get("reading")), "tags": bjson(r.get("tags"), []), "ai_via": bstr(r.get("ai_via")),
            "ai_at": bstr(r.get("ai_at")), "cortex_note": bstr(r.get("cortex_note")),
            "cortex_at": bstr(r.get("cortex_at"))}
           for r in got if every or bstr(r.get("subject_key")) == own]
    return {"status": 200, "data": {"readings": out, "sees_all": every}}


def board(sess: L.Session, payload: dict) -> dict[str, Any]:
    """behaviorBoard: each person's profile snapshot, for a badged reader everybody's (a slice cannot check a badge)."""
    reads, user = sess.reads, sess.user or {}
    if not may_read(user):
        return dict(DENIED)
    every, own = sees_all(reads, user), s_(user.get("id"))
    try:
        got = rows(reads, SIGNALS)
    except (hubdb.Unreadable, Defer):
        raise
    except Exception:  # noqa: BLE001 - as the .gs
        return {"status": 200, "data": {"rows": [], "sees_all": every, "note": "Nothing has been measured yet."}}
    out = []
    for r in got:
        if bstr(r.get("signal")) != "profile.snapshot":
            continue
        key = bstr(r.get("subject_key"))
        if not every and key != own:
            continue
        snap = bjson(r.get("payload"), None)
        if not isinstance(snap, dict):
            continue
        snap.update(subject_key=key, subject_name=bstr(r.get("subject_name")),
                    subject_kind=bstr(r.get("subject_kind")) or "person", computed_at=bstr(r.get("at")))
        out.append(snap)
    return {"status": 200, "data": {"rows": out, "sees_all": every, "own": own}}


def profile(sess: L.Session, payload: dict) -> dict[str, Any]:
    """behaviorProfile: one person's signals, their stored reading and what the cortex last said about them."""
    reads, user = sess.reads, sess.user or {}
    if not may_read(user):
        return dict(DENIED)
    key = subject_for(reads, user, (payload or {}).get("subject_key"))
    if not key:
        return {"status": 400, "message": "There is no account behind this session."}
    signals = signals_for(reads, key)
    reading = reading_for(reads, key)
    snapshot = None
    for sg in signals:
        if sg["signal"] == "profile.snapshot":
            snapshot = bjson(sg.get("payload"), None)
            break
    return {"status": 200, "data": {
        "subject_key": key,
        "subject_name": (signals[0]["subject_name"] if signals and signals[0]["subject_name"] else "")
        or ((reading or {}).get("subject_name") or ""),
        "sees_all": sees_all(reads, user), "own": s_(user.get("id")), "snapshot": snapshot,
        "signals": [sg for sg in signals if sg["signal"] != "profile.snapshot"], "reading": reading}}


# ---- the composition (behaviorCompose_) ----------------------------------------------------------------------------

def person_of(key: str, p: dict) -> dict[str, Any]:
    return {"subject_key": key, "subject_kind": bstr(p.get("subject_kind")) or "person", "name": bstr(p.get("subject_name")),
            "role": bstr(p.get("role")), "title": bstr(p.get("title")), "window_days": bstr(p.get("window_days")) or "30",
            "metrics": p.get("metrics") or {}, "top_apps": p.get("top_apps") or [],
            "franchises": p.get("franchises") or [], "site_verdict": bstr(p.get("site_verdict")),
            "site_why": bstr(p.get("site_why")), "shift_verdict": bstr(p.get("shift_verdict")),
            "shift_why": bstr(p.get("shift_why")), "reach_verdict": bstr(p.get("reach_verdict"))}


def compose(reads: L.Reads, person: dict, refresh: bool, deadline: float) -> dict[str, Any]:
    """behaviorCompose_: the stored reading while the facts have not moved; else the model's, its row to keep under
    `row`; a dead model ladder answers the last paragraph with a note, never nothing and never an invention."""
    key = person["subject_key"]
    signals = signals_for(reads, key)
    if not signals:
        return {"data": {"subject_key": key, "state": "no-signals",
                         "message": "Nothing has been measured for this person yet."}}
    facts = facts_block(person, signals)
    h = facts_hash(facts)
    stored = reading_for(reads, key)
    if stored and stored["signals_hash"] == h and not refresh:
        return {"data": {**stored, "state": "stored"}}
    try:
        template = CND.book_text(reads, "Prompts", AI_REQUEST, PROMPT_FLOOR) or PROMPT_FLOOR
    except Defer:
        template = PROMPT_FLOOR
    chat = SG.ai(reads, template.replace("{facts}", facts), 0.2, AI_REQUEST, deadline)
    got = parse_reading(chat.get("content")) if chat.get("ok") else None
    if got is None:
        why = bstr(chat.get("error") or "no answer")
        if stored and stored["reading"]:
            return {"data": {**stored, "state": "stale",
                             "note": "The model could not be reached (" + why + ") — this is the last reading."}}
        return {"data": {"subject_key": key, "state": "unread", "message": "The model could not be reached (" + why
                         + ") — the measured facts stand on their own."}}
    now = gsjs.iso(reads.now)
    row = {"id": "BHR_" + bstr(key), "subject_kind": bstr(person.get("subject_kind") or "person"),
           "subject_key": bstr(key), "subject_name": bstr(person.get("name")), "role": bstr(person.get("role")),
           "window_days": bstr(person.get("window_days") or 30), "computed_at": now, "signals_hash": h,
           "metrics": json.dumps(person.get("metrics") or {}, separators=(",", ":"), ensure_ascii=False),
           "top_apps": json.dumps(person.get("top_apps") or [], separators=(",", ":"), ensure_ascii=False),
           "franchises": json.dumps(person.get("franchises") or [], separators=(",", ":"), ensure_ascii=False),
           "site_verdict": bstr(person.get("site_verdict")), "site_why": bstr(person.get("site_why")),
           "shift_verdict": bstr(person.get("shift_verdict")), "shift_why": bstr(person.get("shift_why")),
           "reach_verdict": bstr(person.get("reach_verdict")), "reading": got["reading"],
           "highlights": json.dumps(got["highlights"], separators=(",", ":"), ensure_ascii=False),
           "tags": json.dumps(got["tags"], separators=(",", ":"), ensure_ascii=False), "ai_model": "",
           "ai_via": bstr(chat.get("via")), "ai_at": now,
           "cortex_note": bstr(stored["cortex_note"] if stored else ""),
           "cortex_at": bstr(stored["cortex_at"] if stored else ""), "sources": json.dumps(["behavior_signals"])}
    return {"row": row, "name": person.get("name") or key}


def evaluate_prepare(sess: L.Session, payload: dict) -> dict[str, Any]:
    """behaviorEvaluate's reading: a slow tool — a button and a sweep, never a page load."""
    reads, user = sess.reads, sess.user or {}
    if not may_read(user):
        return dict(DENIED)
    p = payload if isinstance(payload, dict) else {}
    key = subject_for(reads, user, p.get("subject_key"))
    if not key:
        return {"status": 400, "message": "There is no account behind this session."}
    got = compose(reads, person_of(key, p), not gsjs.falsy(p.get("refresh")), time.monotonic() + SG.PREPARE_BUDGET_S)
    return {"status": 200, "data": SG.seal("behaviorEvaluate", SG.actor(user), {"key": key, **got})}


def sweep_due(sess: L.Session, payload: dict) -> dict[str, Any]:
    """behaviorSweepMaybe_ (the six-hourly composition), on the relay's clock: each person the signals name, newest
    first, composed while their facts moved — six fresh readings at most — for behaviorSweep to keep."""
    if not SG.service(sess.user):
        return dict(SG.SERVICE_ONLY)
    reads = sess.reads
    try:
        got = rows(reads, SIGNALS)
    except (hubdb.Unreadable, Defer):
        raise
    except Exception:  # noqa: BLE001 - as the .gs: a house that cannot be read composes nothing
        return {"status": 200, "data": {"due": False}}
    order, seen = [], set()
    for r in reversed(got):
        key = bstr(r.get("subject_key"))
        if not key or key in seen:
            continue
        seen.add(key)
        order.append({"subject_key": key, "name": bstr(r.get("subject_name")),
                      "subject_kind": bstr(r.get("subject_kind")) or "person"})
    deadline = time.monotonic() + SG.PREPARE_BUDGET_S
    fresh = []
    for person in order:
        if len(fresh) >= EVALUATE_CAP or time.monotonic() > deadline - 10:
            break
        try:
            out = compose(reads, person, False, deadline)
        except (hubdb.Unreadable, Defer):
            raise
        except Exception:  # noqa: BLE001 - one person's composition that throws is passed over
            continue
        if out.get("row"):
            fresh.append(out["row"])
    if not fresh:
        return {"status": 200, "data": {"due": False}}
    return {"status": 200, "data": SG.seal("behaviorSweep", "service", {"due": True, "rows": fresh})}


# ---- the signals' hand-off (behaviorSignalsIngest's comparison) -----------------------------------------------------

def clean_signals(rows_in: Any, machine: bool, by: str) -> list[dict[str, str]]:
    """Each row with an id, a subject and a signal, once, cut to its widths."""
    clean: list[dict[str, str]] = []
    seen: set[str] = set()
    for r in rows_in if isinstance(rows_in, list) else []:
        if len(clean) >= INGEST_CAP:
            break
        r = r if isinstance(r, dict) else {}
        rid, key, sig = bstr(r.get("id")), bstr(r.get("subject_key")), bstr(r.get("signal"))
        if not rid or not key or not sig or rid in seen:
            continue
        seen.add(rid)
        clean.append({"id": SG.js_slice(rid, 40), "subject_kind": SG.js_slice(bstr(r.get("subject_kind")), 24) or "person",
                      "subject_key": SG.js_slice(key, 60), "subject_name": SG.js_slice(bstr(r.get("subject_name")), 80),
                      "signal": SG.js_slice(sig, 60), "value": SG.js_slice(bstr(r.get("value")), 200),
                      "unit": SG.js_slice(bstr(r.get("unit")), 24), "detail": SG.js_slice(bstr(r.get("detail")), 400),
                      "at": SG.js_slice(bstr(r.get("at")), 40), "window": SG.js_slice(bstr(r.get("window")), 24),
                      "source": SG.js_slice(bstr(r.get("source")), 60) or ("relay" if machine else by),
                      "tenant": SG.js_slice(bstr(r.get("tenant")), 60),
                      "payload": SG.js_slice(bstr(r.get("payload")), 8000)})
    return clean


def upsert_plan(reads: L.Reads, resource: str, incoming: list[dict[str, Any]], now: str) -> dict[str, Any]:
    """behaviorUpsert_: by id, never a delete — a row not held made (its createdAt and updatedAt now), a held one's
    moved cells changed (its updatedAt now), the rest unchanged; only the house's own columns are written. `writes`
    counts the blocks a sheet would have written."""
    cols = RR.columns(reads, resource)
    held: dict[str, tuple[int, str, dict]] = {}
    for i, (k, cells) in enumerate(RR.table_rows(reads, resource)):
        rid = bstr(cells.get("id"))
        if rid and rid not in held:
            held[rid] = (i, k, cells)
    if "id" not in cols:
        return {"error": "the house lacks an \"id\" column"}
    creates: list[dict[str, str]] = []
    updates: list[tuple[str, dict, dict[str, str]]] = []
    at: list[int] = []
    unchanged = 0
    pending: dict[str, dict[str, str]] = {}
    for item in incoming:
        rid = bstr(item.get("id"))
        if not rid:
            continue
        if rid in pending:
            for k, v in item.items():
                if k not in ("id", "createdAt") and k in cols:
                    pending[rid][k] = "" if v is None else gsjs.js_str(v)
            continue
        hit = held.get(rid)
        if hit is None:
            line = {"id": rid}
            if "createdAt" in cols:
                line["createdAt"] = now
            if "updatedAt" in cols:
                line["updatedAt"] = now
            for k, v in item.items():
                if k != "id" and k in cols:
                    line[k] = "" if v is None else gsjs.js_str(v)
            creates.append(line)
            pending[rid] = line
            continue
        i, key, cells = hit
        changed = {k: ("" if v is None else gsjs.js_str(v)) for k, v in item.items()
                   if k not in ("id", "createdAt") and k in cols and bstr(cells.get(k)) != bstr(v)}
        if changed:
            if "updatedAt" in cols:
                changed["updatedAt"] = now
            updates.append((key, cells, changed))
            at.append(i)
        else:
            unchanged += 1
    at.sort()
    blocks = sum(1 for j, i in enumerate(at) if j == 0 or at[j - 1] != i - 1)
    return {"creates": creates, "updates": updates, "inserted": len(creates), "updated": len(updates),
            "unchanged": unchanged, "writes": blocks + (1 if creates else 0)}


def signals_prepare(sess: L.Session, payload: dict) -> dict[str, Any]:
    """behaviorSignalsIngest's first half, asked by the relay's hand-off: the rows cleaned (an id, a subject and a
    signal each, once, cut to their widths), so the write only sets them against what the house holds."""
    user = sess.user or {}
    machine = SG.service(user)
    if not machine and s_(user.get("role")) != "admin":
        return dict(DENIED)
    p = payload if isinstance(payload, dict) else {}
    got = p.get("rows")
    if not isinstance(got, list) or not got:
        return {"status": 400, "message": "No rows — nothing was written."}
    clean = clean_signals(got, machine, s_(user.get("email")))
    if not clean:
        return {"status": 400, "message": "No usable row — each needs id, subject_key and signal."}
    return {"status": 200, "data": SG.seal("behaviorSignalsIngest", SG.actor(user),
                                           {"rows": clean, "received": len(got)})}


def ingest_held(reads: L.Reads) -> dict[str, Any] | None:
    """hubIngestGate_('gate_behavior_signals_ingest'): its 409 while it holds."""
    why = CP.gate_holds(reads, INGEST_GATE)
    return {"status": 409, "message": why} if why else None


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {
    "behaviorReadings": readings, "behaviorBoard": board, "behaviorProfile": profile,
    "behaviorEvaluatePrepare": evaluate_prepare, "behaviorSweepDue": sweep_due,
    "behaviorSignalsPrepare": signals_prepare}
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
POLICY["behaviorSignalsPrepare"] = {"params": {"rows": "array"}}
