"""Learning (apps-script/Learning.gs) read off asa-hub-db: a person's competencies, each stage recomputed from their
attempts under the rules."""
from __future__ import annotations

import functools
import json
import math
import re
from typing import Any, Callable

import client_writes as CW
import gsjs
import house_tables as HT
import hubdb
import locations as L
import resource_rows as RR
import scope as sc
from scope import Defer

APP_ID = "learning"
SKILLS_TAB = "learn_skills"
ATTEMPTS_TAB = "learn_attempts"
CONFIG_TAB = "finance_config"
# Settings › Editions: who else, beside the admins and the master, keeps the competencies
EDITION = "learning.skills"
STAGES = ("exposed", "emerging", "practising", "stable", "mastered", "generalised")
# LEARN_FLOOR: Settings may make these stricter, never laxer
FLOOR = {"emergingCorrect": 1, "practisingRun": 2, "stableRun": 3, "masteredRun": 4, "generalisedGapDays": 7}
DAY_MS = 86400000
COPY_MARKER = "[withheld"
_DECIMAL = re.compile(r"[+-]?(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][+-]?[0-9]+)?")
_STRIPPED = re.compile(r"[,$\s]")


def withheld(v: Any) -> bool:
    if isinstance(v, str):
        return v.startswith(COPY_MARKER)
    if isinstance(v, dict):
        return any(withheld(x) for x in v.values())
    if isinstance(v, list):
        return any(withheld(x) for x in v)
    return False


def _ref(reads: L.Reads, tab: str) -> hubdb.TabRef | None:
    res = reads.db.resolve(tab)
    if res.runtime:
        raise Defer(f"{tab} lives in the depot's facts")
    if res.ref is None and not res.book_known:
        raise hubdb.Unreadable(f"asa-hub-db holds no copy of {tab}")
    return res.ref


def rows(reads: L.Reads, tab: str) -> list[dict]:
    """listRows_: readAll_ of its own table once kept there, else of the copy with Python's own kept edits laid."""
    if HT.tabled(tab):
        got = reads.once("learn:" + tab, lambda: RR.read_all(reads, HT.resource_of(tab) or ""))
    else:
        got = reads.once("learn:" + tab, lambda: reads.db.sheetdb_rows(_ref(reads, tab)))
    return [dict(r) for r in got]


def raw_rows(reads: L.Reads, tab: str) -> list[dict]:
    """Each row's cells as the copy keeps their text: what a write names as the sheet's value before it."""
    def read() -> list[dict]:
        if HT.tabled(tab):
            return [{h: gsjs.trim(v) for h, v in r.items()} for r in HT.rows(reads, tab)]
        ref = _ref(reads, tab)
        if ref is None:
            return []
        return [{h: gsjs.trim(gsjs.or_blank(hubdb.typed(raw.get(h), "raw"))) for h in ref.headers if h}
                for _rn, raw in reads.db.rows(ref)]
    return [dict(r) for r in reads.once("learn_raw:" + tab, read)]


def books(reads: L.Reads, *tabs: str) -> tuple[str, ...]:
    out: list[str] = []
    for t in tabs:
        sid = "" if HT.tabled(t) else reads.db.resolve(t).sheet_id
        if sid and sid not in out:
            out.append(sid)
    return tuple(out)


def fin_num(v: Any) -> float:
    """finNum_: Number(String(v ?? '').replace(/[,$\\s]/g, '')), 0 when it is not finite."""
    s = _STRIPPED.sub("", "" if v is None else gsjs.js_str(v))
    if not s:
        return 0.0
    if _DECIMAL.fullmatch(s):
        n = float(s)
        return n if math.isfinite(n) else 0.0
    if re.fullmatch(r"0[xX][0-9a-fA-F]+", s):
        return float(int(s, 16))
    return 0.0


def rules(reads: L.Reads) -> dict[str, float]:
    """learnRules_: the floor, made stricter by a learnRules config row (its JSON read back through str_)."""
    out: dict[str, float] = dict(FLOOR)
    try:
        for r in rows(reads, CONFIG_TAB):
            if gsjs.str_(r.get("key")) != "learnRules":
                continue
            try:
                saved = json.loads(gsjs.str_(r.get("value")) or "{}")
            except (ValueError, RecursionError):
                saved = None
            if not saved:
                continue
            for key, floor in FLOOR.items():
                n = fin_num(saved.get(key) if isinstance(saved, dict) else None)
                if n > floor:
                    out[key] = n
    except (hubdb.Unreadable, Defer):
        raise
    except Exception:  # noqa: BLE001 - learnRules_ reads a broken config as the floor
        return dict(FLOOR)
    return out


def _ms(iso: str) -> float:
    got = gsjs.date_parse(iso)
    return float("nan") if got is None else float(got)


def stage(attempts: list[dict], r: dict[str, float]) -> dict[str, Any]:
    """learnStage_: never stored, always recomputed from the attempts."""
    if not attempts:
        return {"stage": "exposed", "run": 0, "unassistedRun": 0, "why": "not attempted yet"}
    ordered = sorted(attempts, key=functools.cmp_to_key(lambda a, b: gsjs.locale_cmp(gsjs.js_str(a.get("at")),
                                                                                      gsjs.js_str(b.get("at")))))
    run = unassisted = 0
    any_correct = False
    last_correct_at = ""
    for a in ordered:
        if a["correct"]:
            any_correct = True
            run += 1
            unassisted = 0 if a["helped"] else unassisted + 1
            last_correct_at = gsjs.str_(a.get("at"))
        else:
            run = unassisted = 0
    if not any_correct:
        return {"stage": "exposed", "run": 0, "unassistedRun": 0, "why": "attempted, not yet correct"}
    if unassisted >= r["masteredRun"] and last_correct_at:
        first = None
        streak = 0
        for a in ordered:
            if a["correct"] and not a["helped"]:
                streak += 1
                if streak >= r["masteredRun"] and not first:
                    first = gsjs.str_(a.get("at"))
            elif not a["correct"]:
                streak = 0
        if first:
            gap = _ms(last_correct_at) - _ms(first)
            if not math.isnan(gap) and gap >= r["generalisedGapDays"] * DAY_MS:
                return {"stage": "generalised", "run": run, "unassistedRun": unassisted,
                        "why": "held after " + gsjs.num_str(math.floor(gap / DAY_MS)) + " days"}
        return {"stage": "mastered", "run": run, "unassistedRun": unassisted,
                "why": gsjs.num_str(unassisted) + " in a row, unaided"}
    if run >= r["stableRun"]:
        return {"stage": "stable", "run": run, "unassistedRun": unassisted, "why": gsjs.num_str(run) + " in a row"}
    if run >= r["practisingRun"]:
        return {"stage": "practising", "run": run, "unassistedRun": unassisted,
                "why": gsjs.num_str(run) + " in a row"}
    return {"stage": "emerging", "run": run, "unassistedRun": unassisted, "why": "correct at least once"}


def _yes(v: Any) -> bool:
    return gsjs.str_(v) == "true" or v is True


def state(reads: L.Reads, user: dict, extra: list[dict] | None = None) -> dict[str, Any]:
    """learnState_: the active competencies, each with this person's attempts and the stage they make."""
    me = gsjs.str_(user.get("id"))
    r = rules(reads)
    skills = [s for s in rows(reads, SKILLS_TAB) if gsjs.str_(s.get("active")).lower() != "false"]
    mine = [a for a in rows(reads, ATTEMPTS_TAB) + list(extra or []) if gsjs.str_(a.get("ownerId")) == me]
    by_skill: dict[str, list[dict]] = {}
    for a in mine:
        by_skill.setdefault(gsjs.str_(a.get("skillId")), []).append(
            {"id": gsjs.str_(a.get("id")), "at": gsjs.str_(a.get("at")), "correct": _yes(a.get("correct")),
             "helped": _yes(a.get("helped")), "note": gsjs.str_(a.get("note"))})
    out = []
    for s in skills:
        attempts = by_skill.get(gsjs.str_(s.get("id"))) or []
        st = stage(attempts, r)
        out.append({"id": gsjs.str_(s.get("id")), "name": gsjs.str_(s.get("name")), "area": gsjs.str_(s.get("area")),
                    "description": gsjs.str_(s.get("description")), "attempts": len(attempts),
                    "lastAt": attempts[-1]["at"] if attempts else "", "stage": st["stage"], "why": st["why"],
                    "run": st["run"], "unassistedRun": st["unassistedRun"]})
    out.sort(key=functools.cmp_to_key(lambda a, b: gsjs.locale_cmp(a["area"] or "", b["area"] or "")
                                      or gsjs.locale_cmp(a["name"], b["name"])))
    got = {"rules": r, "stages": list(STAGES), "skills": out}
    if withheld(got):
        raise Defer("the copy withholds a cell this answer shows")
    return got


def may_use(user: dict | None) -> bool:
    """learnMayUse_: a person's own account."""
    return bool(user) and user.get("is_service") is not True and bool(gsjs.str_(user.get("id")))


def learn_state(sess: L.Session, payload: dict) -> dict[str, Any]:
    """learnState."""
    if not may_use(sess.user):
        return CW.denied()
    return {"status": 200, "data": state(sess.reads, sess.user or {})}


def edition_holds(sess: L.Session) -> bool:
    """A person learning.skills lists, Learning open to them, from their own account."""
    user = sess.user or {}
    if user.get("is_service") is True or user.get("visiting_member"):
        return False
    if not sc.profile_app_gate(APP_ID, user, sess.reads.scope_sources()).get("open"):
        return False
    return sc.edition_allows(EDITION, user, sess.reads.config())


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {"learnState": learn_state}
POLICY: dict[str, dict[str, Any]] = {"learnState": {}}
