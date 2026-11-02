"""What a filed hotline call says, through Smart Comms (smart_comms.raise_situation): a new support request paged to
the support line (CommSupport.gs commSupportFiled_), and an incident paged to its list and the house's manager
(CommIncident.gs commIncidentFiled_, its letters too), less anyone who turned the incident alert off
(AlertReceive.gs arKeep_).
`pages` decides who hears what and says nothing; `say` raises each page in the filing's own write."""
from __future__ import annotations

import re
from typing import Any

import gsjs
import hotline as H
import locations as L
import scope as sc
import smart_comms as SC
import support_desk_writes as SDW

SUPPORT_SITUATION = "hotline_support_request"
SUPPORT_MAX_PER_PASS = 4
INCIDENT_SITUATION = "hotline_incident"
INCIDENT_MAX_PER_PASS = 6
LANE = "hotline"
AR_PART = "incident"

s_ = H.s_


def _digits10(v: Any) -> str:
    return re.sub(r"\D", "", s_(v))[-10:]


# ---- AlertReceive.gs: the incident alert, turned off by a holder of Settings › Alerts I receive -----------------

def _ar_off(reads: L.Reads) -> set[str]:
    """arOff_ for one part: the uids who turned it off and still hold the section (the master or a director)."""
    try:
        rows = SDW.tab_rows(reads, SDW.TABS["settings"])
    except Exception:  # noqa: BLE001 - fail open, as arKeep_
        return set()
    off: set[str] = set()
    for r in rows:
        key = s_(r.get("key"))
        if key.startswith("receive_off:") and AR_PART in re.split(r"[,;\s]+", s_(r.get("value")).lower()):
            off.add(key[len("receive_off:"):])
    if not off:
        return off
    holders = {s_(d.get("uid")) for d in SDW.directors(reads).get("list") or []}
    for u in reads.users():
        if s_(u.get("role")) == "admin" and sc.is_master_email(u.get("email")):
            holders.add(s_(u.get("userid")))
    return {uid for uid in off if uid in holders}


def ar_keep(reads: L.Reads, dests: list[str]) -> list[str]:
    """arKeep_ (FAIL-OPEN): the destinations left once every number or address reaching only holders who turned the
    incident alert off is out."""
    try:
        mine = _ar_off(reads)
        if not mine or not dests:
            return list(dests)
        owners: dict[str, dict[str, set[str]]] = {"emails": {}, "digits": {}}
        for u in reads.users():
            uid = s_(u.get("userid"))
            if not SDW.live(u) or not uid:
                continue
            for e in [u.get("email")] + list(SDW.parse_emails(u.get("emails"))):
                k = s_(e).lower()
                if k.find("@") > 0:
                    owners["emails"].setdefault(k, set()).add(uid)
            phones = [u.get("phone")] + [p.get("number") if isinstance(p, dict) else p
                                         for p in SDW.parse_phones(u.get("phones"))]
            for n in phones:
                d = _digits10(n)
                if len(d) == 10:
                    owners["digits"].setdefault(d, set()).add(uid)
        dropped = {bag: {k for k, who in got.items() if who <= mine} for bag, got in owners.items()}
        return [d for d in dests if not (s_(d).lower() in dropped["emails"] if "@" in s_(d)
                                         else _digits10(d) in dropped["digits"] and len(_digits10(d)) == 10)]
    except Exception:  # noqa: BLE001 - fail open
        return list(dests)


# ---- the pages -------------------------------------------------------------------------------------------------------

def _situation(rows: list[dict] | None, sid: str) -> dict | None:
    """commSupportSituation_ / commIncidentSituation_: on, with words on a channel it names."""
    sit = SC.situation_row(rows or [], sid)
    if sit is None or not SC.smart_on(sit.get("enabled")):
        return None
    return sit if _channels(sit) else None


def _channels(sit: dict) -> list[str]:
    named = SC.smart_list(sit.get("channels"))
    out = []
    if "sms" in named and s_(sit.get("sms_text")):
        out.append("sms")
    if "email" in named and (s_(sit.get("email_text")) or s_(sit.get("sms_text"))):
        out.append("email")
    return out


def _page(sid: str, dest: str, chans: list[str], vars_: dict, key: str, person: str, team: bool) -> dict[str, Any]:
    """commSupportCopyTo_ / commIncidentCopyTo_ up to the send: a number is a text, an address a letter."""
    if "@" in dest:
        if "email" not in chans:
            return {"situation": sid, "to": dest, "key": key, "skip": "an address, and this row has no written letter"}
        return {"situation": sid, "to": dest, "key": key, "vars": vars_, "person": person, "team": False,
                "channel": "email"}
    if "sms" not in chans:
        return {"situation": sid, "to": dest, "key": key, "skip": "a number, and this row has no written text"}
    return {"situation": sid, "to": dest, "key": key, "vars": vars_, "person": person, "team": team, "channel": "sms"}


def support_vars(r: dict) -> dict[str, str]:
    """commSupportVars_."""
    who = s_(r.get("requestor"))
    return {"requestor": who or "somebody the row does not name", "type": s_(r.get("type_of_request")) or "not typed",
            "urgency": s_(r.get("urgency")), "received": s_(r.get("date_received")),
            "description": s_(r.get("description_of_request"))[:700], "status": s_(r.get("status")) or "New",
            "first_name": (who.split() or [""])[0], "name": who}


def incident_vars(r: dict, manager: dict | None) -> dict[str, str]:
    """commIncidentVars_."""
    hm = s_((manager or {}).get("name"))
    return {"client": s_(r.get("client_name")) or "a client we could not name",
            "category": s_(r.get("incident_category")) or "uncategorised",
            "location": s_(r.get("incident_location")) or "a location that was not given",
            "date": s_(r.get("incident_date")) or s_(r.get("incident_reported_date")),
            "time": s_(r.get("incident_time")) or s_(r.get("incident_reported_time")),
            "dsp": s_(r.get("your_name")) or "the caller", "employees": s_(r.get("employees_involved")),
            "summary": s_(r.get("summary_of_incident"))[:900], "action": s_(r.get("immediate_action_taken"))[:400],
            "house_manager": hm, "first_name": (hm.split() or [""])[0], "name": s_(r.get("client_name"))}


def pages(reads: L.Reads, call_id: str, requests: list[dict], incidents: list[dict],
          house_manager: Any) -> dict[str, Any]:
    """Every page the filing owes, and why any other is not sent."""
    out: dict[str, Any] = {"pages": [], "why": [], "support_capped": 0, "incident_capped": 0}
    try:
        rows = SC.read_situations(reads.db)
    except Exception as exc:  # noqa: BLE001 - an unread tab says nothing
        out["why"].append(f"the situations tab could not be read ({type(exc).__name__}) — nothing was paged")
        return out
    asked = [r for r in requests if r and r.get("type_of_request") != H.CALL_OFF_TYPE]
    if asked:
        sit = _situation(rows, SUPPORT_SITUATION)
        dests = SC.smart_list(sit.get("to")) if sit else []
        if sit is None:
            out["why"].append(f"the situation `{SUPPORT_SITUATION}` is absent, switched off, or has no written words "
                              "on a channel it names — nothing was sent")
        elif not dests:
            out["why"].append(f"`{SUPPORT_SITUATION}` names nobody")
        else:
            out["support_capped"] = max(0, len(asked) - SUPPORT_MAX_PER_PASS)
            for i, r in enumerate(asked[:SUPPORT_MAX_PER_PASS]):
                idem = f"support_{call_id[:24]}_{i}"
                for n, dest in enumerate(dests):
                    out["pages"].append(_page(SUPPORT_SITUATION, dest, _channels(sit), support_vars(r), f"{idem}_{n}",
                                              s_(r.get("requestor")), True))
    listed = [r for r in incidents if r and (r.get("client_name") or r.get("summary_of_incident"))]
    if listed:
        sit = _situation(rows, INCIDENT_SITUATION)
        if sit is None:
            out["why"].append(f"the situation `{INCIDENT_SITUATION}` is absent, switched off, or has no written words "
                              "on a channel it names — nothing was sent")
        else:
            chans = _channels(sit)
            dests = SC.smart_list(sit.get("to"))
            kept = ar_keep(reads, dests)
            if len(kept) < len(dests):
                out["why"].append(f"{len(dests) - len(kept)} on the list turned this alert off in Settings — not paged")
            out["incident_capped"] = max(0, len(listed) - INCIDENT_MAX_PER_PASS)
            for i, r in enumerate(listed[:INCIDENT_MAX_PER_PASS]):
                manager = house_manager(s_(r.get("incident_location")))
                vars_ = incident_vars(r, manager)
                idem = f"incident_{call_id[:24]}_{i}"
                heard: set[str] = set()
                for n, dest in enumerate(dests):
                    if dest not in kept:
                        continue
                    page = _page(INCIDENT_SITUATION, dest, chans, vars_, f"{idem}_to{n}", s_(r.get("client_name")),
                                 False)
                    out["pages"].append(page)
                    if page.get("channel") == "sms":
                        heard.add(_digits10(dest))
                phone = s_((manager or {}).get("phone"))
                if not phone:
                    out["why"].append(f'no house manager resolved for "{(s_(r.get("incident_location")) or "(no location)")[:40]}"'
                                      " — nobody was texted about that house")
                elif _digits10(phone) in heard:
                    out["why"].append("the house manager is already on the named list — told once")
                elif not ar_keep(reads, [phone]):
                    out["why"].append("the house manager turned this alert off in Settings — not texted")
                else:
                    out["pages"].append(_page(INCIDENT_SITUATION, phone, chans, vars_, f"{idem}_hm",
                                              s_((manager or {}).get("name")), False))
    return out


# ---- PSI Anywhere (CommPsi.gs commPsiReported_) --------------------------------------------------------------------

PSI_UP_SITUATION = "psyanywhere_false_message"
PSI_DOWN_SITUATION = "psyanywhere_true_message"
PSI_TEAM_WINDOW_S = 3600
# a team page that reached nobody leaves the outage hour open for the next caller
PSI_NOT_PAGED = frozenset({"off", "no_phone", "no_address", "refused", "failed", "skipped"})


def _psi_situation(rows: list[dict] | None, sid: str) -> dict | None:
    """commPsiSituation_: on, and words on a channel it names (a text, or a letter's subject)."""
    sit = SC.situation_row(rows or [], sid)
    if sit is None or not SC.smart_on(sit.get("enabled")):
        return None
    chans = SC.smart_list(sit.get("channels")) or ["sms", "email"]
    ok = any((c == "sms" and s_(sit.get("sms_text"))) or (c == "email" and s_(sit.get("email_subject")))
             for c in chans)
    return sit if ok else None


def _psi_people(reads: L.Reads) -> dict[str, dict[str, str]]:
    """commRecordPeople_: the People house by name key, merged rows and the clients left out."""
    clients = set()
    try:
        clients = {gsjs.name_key(c.get("name")) for c in H.C.derived(reads)}
    except Exception:  # noqa: BLE001 - nobody left out is still an answer
        pass
    out: dict[str, dict[str, str]] = {}
    for p in reads.hub_rows("people"):
        k = gsjs.name_key(p.get("name"))
        if not k or k in out or k in clients or s_(p.get("mergedinto")):
            continue
        out[k] = {"name": s_(p.get("name")), "phone": s_(p.get("phone")), "email": s_(p.get("email"))}
    return out


def _psi_stamp(v: dict) -> str:
    """psiStampAt_: the proof's own minute."""
    at = s_(v.get("at"))
    return at[11:16] + "Z" if re.match(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}", at) else ""


def _psi_vars(sit: dict, name: str, day: str, v: dict) -> dict[str, Any]:
    """commDispatchBaseVars_ for a PSI answer: no bindings, the proof's minute."""
    return {"first_name": (name.split() or [""])[0], "name": name, "expires": day, "days_left": "", "credential": "",
            "items": "0", "correction": "", "status_at": _psi_stamp(v)}


def psi_window_open(reads: L.Reads, now_s: float) -> bool:
    """commPsiWindowClaim_'s standing hour: a team page within the hour, anchored at it, no proved `up` after it —
    read off the calls this hotline filed."""
    try:
        rows = reads.db.query(f"select filed_at, filing->'psi' from {H.CALLS} where filed_at > to_timestamp(%s)"
                              " and filing ? 'psi' order by filed_at desc", (now_s - PSI_TEAM_WINDOW_S,))
    except Exception:  # noqa: BLE001 - an unread hour pages, as an unread cache does
        return False
    for _at, psi in rows:
        for one in (psi or []):
            if one.get("state") == "up":
                return False
            if one.get("state") == "down" and one.get("team_paged"):
                return True
    return False


def psi_plan(reads: L.Reads, call_id: str, requests: list[dict]) -> list[dict[str, Any]]:
    """Each request whose caller reported PSI Anywhere down and reached a verdict: who answers whom."""
    out: list[dict[str, Any]] = []
    rows = None
    ordinal = 0
    for r in requests:
        v = r.get("_psi_verdict")
        if not v:
            continue
        instance = f"{call_id or 'call'}:psi:{ordinal}"
        ordinal += 1
        state = s_(v.get("state"))
        one: dict[str, Any] = {"instance": instance, "state": state, "verdict": v, "caller": None, "team": [],
                               "why": []}
        out.append(one)
        if state not in ("up", "down"):
            one["why"].append("the check did not settle — nothing is claimed to a caller about an unknown")
            continue
        if rows is None:
            rows = SC.read_situations(reads.db)
        sid = PSI_DOWN_SITUATION if state == "down" else PSI_UP_SITUATION
        sit = _psi_situation(rows, sid)
        if sit is None:
            one["why"].append(f"the situation `{sid}` is absent, switched off, or still has no words")
            continue
        name, name_from, day = s_(r.get("requestor")), s_(r.get("_name_from")), s_(r.get("date_received"))[:10]
        key = gsjs.name_key(name) if name_from else ""
        vars_ = _psi_vars(sit, name, day, v)
        # the caller: one answer per call, to the person the caller said they are
        if not key:
            one["why"].append("the request names nobody this lane can key")
        elif name_from == "phone":
            one["why"].append("who this was came from the caller ID, not from anybody saying it")
        else:
            person = _psi_people(reads).get(key)
            if not person or not (person["phone"] or person["email"]):
                one["why"].append("no contact in the People house — a person has to find them")
            else:
                chans = [c for c in (SC.smart_list(sit.get("channels")) or ["sms", "email"]) if c in ("sms", "email")]
                pick = None
                for c in chans:
                    if c == "sms" and SC.sendable(person["phone"]) and s_(sit.get("sms_text")):
                        pick = ("sms", SC.sendable(person["phone"]))
                    elif c == "email" and SC.letter_to(person["email"]) and s_(sit.get("email_subject")):
                        pick = ("email", SC.letter_to(person["email"]))
                    if pick:
                        break
                if pick is None:
                    one["why"].append("no channel of this situation reaches them")
                else:
                    one["caller"] = {"situation": sid, "to": pick[1], "channel": pick[0], "vars": vars_,
                                     "key": f"ci_PSI|{instance}|{key}_1", "person": person["name"], "team": False}
        if state != "down":
            continue
        # the people who can act on an outage, once an hour
        dests = SC.smart_list(sit.get("to")) + SC.smart_list(sit.get("cc"))
        if not dests:
            one["why"].append("the situation names nobody to escalate to")
            continue
        if psi_window_open(reads, reads.now.timestamp()):
            one["why"].append("this outage was already escalated within the hour — this caller rides that page")
            continue
        # each destination once, however often the Desk writes it; `directors` (or 5558 written out) is the group
        import smart_comms_desk as SCD  # noqa: PLC0415 - the Desk's own rule for a `to` entry
        heard: set[str] = set()
        for dest_cell in dests:
            got = SCD.team_dest(dest_cell)
            if got is None:
                continue
            dest, team = got
            k = dest.lower() if "@" in dest else SCD.digits(dest)[-10:]
            if k in heard:
                continue
            heard.add(k)
            i = len(one["team"])
            one["team"].append({"situation": sid, "to": dest, "channel": "email" if team is False else "sms",
                                "team": team, "vars": dict(vars_), "key": f"psi_team{i}_{sid}_{instance[:40]}",
                                "person": "the escalation list", "_sit": sit,
                                "reported": name if name_from == "person" else ""})
    return out


def _psi_caller_line(said: dict | None) -> str:
    """psiCallerLine_: only what really reached the caller."""
    if said is None:
        return "The message below is the one this platform would send the caller."
    why, ch = s_(said.get("why")), s_(said.get("channel"))
    if said.get("state") == "sent":
        return "The caller was told the message below" + (f", on {ch}" if ch else "") + "."
    if said.get("state") == "already":
        return "The caller had already been answered for this call; the message below is what she was sent."
    return "THE CALLER WAS TOLD NOTHING" + (f": {why}" if why else "") + \
        ". The message below is what she would have been sent."


def psi_say(plan: list[dict[str, Any]], at_ms: int) -> list[dict[str, Any]]:
    """commPsiReported_ for each: the caller first, then the team with a lead line saying what reached the caller."""
    out = []
    for one in plan:
        said = None
        rec: dict[str, Any] = {"instance": one["instance"], "state": one["state"], "why": list(one["why"]),
                               "caller": None, "team": []}
        c = one.get("caller")
        if c:
            got = SC.raise_situation(None, situation=c["situation"], to=c["to"], vars=c["vars"], key=c["key"],
                                     person=c["person"], lane="psi", at_ms=at_ms, prune=True, channel=c["channel"])
            said = {"state": got.get("state"), "why": s_(got.get("why")), "channel": c["channel"]}
            rec["caller"] = {"to": SC.mask_to(c["to"]), "channel": c["channel"], "state": got.get("state"),
                             "held": got.get("held"), "why": s_(got.get("why"))[:200]}
        for t in one["team"]:
            sit, v = t["_sit"], one["verdict"]
            lead = ("PSI ANYWHERE IS NOT ANSWERING. " + H.psi_note(v) +
                    (f" Reported on the hotline by {t['reported']}." if t["reported"] else "") +
                    " " + _psi_caller_line(said))
            vars_ = dict(t["vars"])
            vars_[SC.LEAD_KEY] = {"sms_tpl": s_(sit.get("sms_text")), "line_sms": lead,
                                  "email_tpl": s_(sit.get("email_text")) or s_(sit.get("sms_text")),
                                  "line_email": lead, "subject_tpl": s_(sit.get("email_subject"))}
            got = SC.raise_situation(None, situation=t["situation"], to=t["to"], vars=vars_, key=t["key"],
                                     person=t["person"], lane="psi", at_ms=at_ms, prune=False, team=t["team"],
                                     channel=t["channel"])
            rec["team"].append({"to": SC.mask_to(t["to"]), "channel": t["channel"], "state": got.get("state"),
                                "held": got.get("held"), "why": s_(got.get("why"))[:200]})
        rec["team_paged"] = any(x["state"] not in PSI_NOT_PAGED for x in rec["team"])
        out.append(rec)
    return out


def psi_preview(plan: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [{"instance": o["instance"], "state": o["state"], "why": o["why"],
             "caller": {"to": SC.mask_to(o["caller"]["to"]), "channel": o["caller"]["channel"],
                        "key": o["caller"]["key"]} if o.get("caller") else None,
             "team": [{"to": SC.mask_to(t["to"]), "channel": t["channel"], "key": t["key"]} for t in o["team"]]}
            for o in plan]


def preview(planned: dict[str, Any]) -> dict[str, Any]:
    """The pages as the shadow keeps them: the number masked, never the words."""
    return {"why": planned["why"], "support_capped": planned["support_capped"],
            "incident_capped": planned["incident_capped"],
            "pages": [{"situation": p["situation"], "to": SC.mask_to(p["to"]), "key": p["key"],
                       "team": p.get("team", False), "channel": p.get("channel", ""), "skip": p.get("skip", "")}
                      for p in planned["pages"]]}


def say(planned: dict[str, Any], at_ms: int) -> list[dict[str, Any]]:
    """Each page raised in the filing's own write (smart_comms.deciding): its state, never its words."""
    told = []
    for p in planned["pages"]:
        if p.get("skip"):
            told.append({"situation": p["situation"], "to": SC.mask_to(p["to"]), "state": "skipped", "why": p["skip"]})
            continue
        got = SC.raise_situation(None, situation=p["situation"], to=p["to"], vars=p["vars"], key=p["key"],
                                 person=p["person"], lane=LANE, at_ms=at_ms, prune=True, team=p["team"],
                                 channel=p["channel"])
        told.append({"situation": p["situation"], "to": SC.mask_to(p["to"]), "state": got.get("state"),
                     "held": got.get("held"), "why": s_(got.get("why"))[:200]})
    return told
