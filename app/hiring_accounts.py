"""The accounts Apps Script's hiring sweep made, on Python (Hired.gs onboardingUserSweepMaybe_ with
onboardingEnsureUser_, and hubHiredSweep_'s graduation, hubHiredGraduate_): each a look the relay's clock asks first
(`…Due`) before the write that keeps it (hiring_accounts_writes). The onboarding login is minted with the workspace
default, kept by the sign-in's credential store and told through Smart Comms; a graduation promotes that account to
staff, or makes an unarmed staff account."""
from __future__ import annotations

import json
import logging
import re
import time
from typing import Any, Callable

import auth as A
import candidates as CND
import client_care_sweeps as CCS
import gsjs
import hiring_hired as HH
import locations as L
import recon as R
import scope as sc
import staff as SP
import users_accounts as UA
import users_writes as UW

log = logging.getLogger("asa-hub-app")
s_ = gsjs.str_

MINT_DOOR = "onboardingUserSweep"
EMAIL_OK = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]{2,}$")
FIND_EMAIL_PROMPT = "ai_find_email"
AI_DEADLINE_S = 20.0
WAITS_CJIS = ("the login WAITS for the CJIS report — the sweep mints it the moment it lands (the folders are "
              "watched; the packet no longer holds this door)")
NO_EMAIL = "no email on the candidate — create the account by hand"
ALREADY = "already a user"


def latest(reads: L.Reads) -> dict[str, dict]:
    """Each candidate's last row (hubSetFieldLastRow_'s row), by id."""
    out: dict[str, dict] = {}
    for c in HH.cands(reads):
        cid = s_(c.get("candidateid"))
        if cid:
            out[cid] = c
    return out


def password(reads: L.Reads) -> str:
    """str_(hubProp_('ONBOARDING_USER_PASSWORD')) || str_(hubProp_('FIRST_USER_PASSWORD')), as this service holds
    them; a value the copy withholds is none."""
    for key in ("ONBOARDING_USER_PASSWORD", "FIRST_USER_PASSWORD"):
        v = s_(reads.db.prop(key))
        if v and not v.startswith("[withheld"):
            return v
    return UW.default_password(reads)


def emails_found(reads: L.Reads, cand: dict, analysis: dict | None) -> list[dict[str, str]]:
    """onboardingFindEmail_'s sources, deduped as onboardingEmailDedupe_ keeps them: the card, the résumé analysis,
    and every roster row matching the name or the phone's last ten digits."""
    found = [{"email": s_(cand.get("email")), "source": "candidate card"}]
    if analysis:
        found.append({"email": s_(analysis.get("email")), "source": "resume analysis"})
    raw = s_(cand.get("candidatename"))
    key = gsjs.name_key(raw) if raw else ""
    digits = re.sub(r"\D", "", s_(cand.get("phone")))[-10:]
    try:
        people = SP._people(reads)
    except Exception:  # noqa: BLE001 - no roster, no matches
        people = []
    for p in people:
        pn = s_(p.get("name"))
        pk = gsjs.name_key(pn) if pn else ""
        pd = re.sub(r"\D", "", s_(p.get("phone")))[-10:]
        if (key and pk == key) or (len(digits) == 10 and pd == digits):
            found.append({"email": s_(p.get("email")), "source": f"people roster ({pn})"})
    seen: set[str] = set()
    out: list[dict[str, str]] = []
    for f in found:
        e = gsjs.trim(f["email"]).lower()
        if not EMAIL_OK.match(e) or e in seen:
            continue
        seen.add(e)
        out.append({"email": e, "source": f["source"]})
    return out


def email_pick(reads: L.Reads, cand: dict, distinct: list[dict[str, str]], deadline: float) -> dict[str, str] | None:
    """onboardingFindEmail_'s choice: the one address, or the model's pick bounded to the found list; the card's own
    address stands when the model cannot say."""
    if len(distinct) < 2:
        return distinct[0] if distinct else None
    try:
        tpl = CND.book_text(reads, "Prompts", FIND_EMAIL_PROMPT, "")
        if tpl:
            ask = (tpl.replace("{name}", s_(cand.get("candidatename"))).replace("{phone}", s_(cand.get("phone")))
                   .replace("{candidates}", json.dumps(distinct, separators=(",", ":"), ensure_ascii=False)))
            chat = CCS.ai_chat(reads, ask, 0, FIND_EMAIL_PROMPT, deadline)
            try:
                pick = s_((json.loads(s_(chat.get("content"))) or {}).get("email")).lower()
            except (ValueError, AttributeError):
                pick = ""
            for d in distinct:
                if chat.get("ok") and d["email"] == pick:
                    return d
    except Exception:  # noqa: BLE001 - its catch: the card's own address stands
        pass
    return distinct[0]


def said_waiting(reads: L.Reads, cid: str) -> bool:
    """The journey's last line already says the login waits for the CJIS report (or the journey cannot be read)."""
    lines = CND.journey_for(reads, cid)
    if lines is None:
        return True
    return bool(lines) and lines[-1]["step"] == "onboarding" and lines[-1]["detail"][:60] == WAITS_CJIS[:60]


def mint_plan(reads: L.Reads) -> dict[str, Any]:
    """onboardingUserSweepMaybe_'s look: each card at Onboarding whose login can be minted (its address picked), the
    ones waiting on the CJIS report, and a blank card address an existing account fills. The quiet window holds no
    login, only its letter and text (Smart Comms owes them at its end)."""
    users = reads.users()
    mint: list[dict] = []
    waiting: list[str] = []
    fills: list[dict] = []
    deadline = time.monotonic() + AI_DEADLINE_S
    no_password = not password(reads)
    for cid, c in latest(reads).items():
        if CND.stage_of(c.get("status")) != "onboarding":
            continue
        ev = CND.evidence(reads, cid)
        cand = ev.get("cand") or c
        a = ev.get("analysis") or {}
        name = s_(cand.get("candidatename")) or cid
        if not HH.is_test(reads, cand) and not (CND.cjis_cleared(a) or s_(a.get("cjisreporturl"))):
            if not said_waiting(reads, cid):
                waiting.append(cid)
            continue
        distinct = emails_found(reads, cand, a)
        if not distinct:
            log.info("onboarding_user_no_email: %s — %s: no valid e-mail in any source, no account made", cid, name)
            continue
        have = next((d for d in distinct if A.user_by_email(users, d["email"])), None)
        if have is not None:
            if not s_(cand.get("email")):
                fills.append({"cid": cid, "email": have["email"], "source": have["source"]})
            continue
        if no_password:
            log.warning("onboarding_user_no_property: %s — set ONBOARDING_USER_PASSWORD (or FIRST_USER_PASSWORD); "
                        "no account made", cid)
            continue
        picked = email_pick(reads, cand, distinct, deadline)
        if picked is None:
            continue
        clash = UA.identity_conflict(reads, name, picked["email"], s_(cand.get("phone")))
        if clash:
            log.info('onboarding_user_already: %s — "%s" matches "%s" by %s; no second account was made', cid, name,
                     clash["who"], clash["how"])
            continue
        mint.append({"cid": cid, "email": picked["email"], "source": picked["source"],
                     "fill": not s_(cand.get("email"))})
    return {"mint": mint, "waiting": waiting, "fills": fills}


def mint_due(sess: L.Session, payload: dict) -> dict[str, Any]:
    """onboardingUserDue: the look, sealed for onboardingUserSweep."""
    if not HH.service(sess):
        return dict(HH.SERVICE_ONLY)
    plan = mint_plan(sess.reads)
    due = len(plan["mint"]) + len(plan["waiting"]) + len(plan["fills"])
    return {"status": 200, "data": R.seal(MINT_DOOR, "service", {**plan, "due": due})}


def graduation(reads: L.Reads, users: list[dict], c: dict) -> dict[str, Any] | None:
    """hubHiredGraduate_'s verdict on one card: `create`, `promote` the onboarding account, or `held` with why; None
    for a test card, a card already holding the account its address signs in with, or a hold already said."""
    cid = s_(c.get("candidateid"))
    if HH.is_test(reads, c):
        return None
    email = s_(c.get("email")).lower()
    why = ""
    if not email or "@" not in email:
        why = NO_EMAIL
    else:
        u = A.user_by_email(users, email)
        if u is None:
            return {"cid": cid, "act": "create"}
        if s_(u.get("role")) == "onboarding" and not sc.is_master_email(u.get("email")):
            return {"cid": cid, "act": "promote", "uid": s_(u.get("userid"))}
        if s_(c.get("staffuserid")) and s_(c.get("staffuserid")) == s_(u.get("userid")):
            return None
        why = ALREADY
    if s_(c.get("graduationheld")) == why:
        return None
    return {"cid": cid, "act": "held", "why": why}


def graduate_plan(reads: L.Reads) -> dict[str, Any]:
    """hubHiredSweep_'s graduations: each card whose day at Hired ran out, and what hubHiredGraduate_ does with it."""
    by_id = latest(reads)
    users = reads.users()
    out = []
    for cid in dict.fromkeys(HH.hired_stay_plan(reads)["graduating"]):
        c = by_id.get(cid)
        got = graduation(reads, users, c) if c else None
        if got:
            out.append(got)
    return {"graduating": out}


def graduate_due(sess: L.Session, payload: dict) -> dict[str, Any]:
    """hiredGraduateDue: the look before hiredGraduateSweep."""
    if not HH.service(sess):
        return dict(HH.SERVICE_ONLY)
    plan = graduate_plan(sess.reads)
    return {"status": 200, "data": {**plan, "due": len(plan["graduating"])}}


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {"onboardingUserDue": mint_due,
                                                                    "hiredGraduateDue": graduate_due}
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
