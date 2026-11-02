"""The contact guard's scan (ContactGuard.gs staffGuardScan) read off asa-hub-db: every live card of the hiring pipeline
whose phone or e-mail is already on the staff roster — the rule is an invariant, since a clean card can collide later,
when its person is hired. It sends and writes nothing. The roster's index (staffContactIndex_) and its exemptions are
the Support Desk port's (app/support_desk_writes.py); the card's own account and a rehearsal card are left out here."""
from __future__ import annotations

from typing import Any, Callable

import candidates as CND
import client_writes as CW
import gsjs
import locations as L
import staff_views
import support_desk_writes as SDW
import writes as W

APP_ID = "contact-guard"
ROLES = ("admin", "manager")
# hubSysLog_'s actor when the roster's index could not be built whole
GUARD_ACTOR = {"email": "asa-hub:guard"}

s_ = gsjs.str_


def writer(user: dict | None) -> bool:
    """hubIsWriter_."""
    return bool(user) and (user or {}).get("role") in ROLES


def is_rehearsal(opts: dict | None) -> bool:
    """cgIsRehearsal_: '[test]' counts only for a trusted (signed-in) caller; anyone could type it on the public
    form."""
    if not opts or not opts.get("trusted"):
        return False
    return gsjs.trim(gsjs.or_text(opts.get("name"))).lower().startswith("[test]")


def index(reads: L.Reads) -> dict[str, Any]:
    """staffContactIndex_: fails closed, and says so once."""
    idx = SDW.contact_index(reads)
    if not idx["ok"]:
        reads.once("cg:index_failed", lambda: staff_views.record(GUARD_ACTOR, "staff_index_failed", "", 500) or True)
    return idx


def guard(reads: L.Reads, phone: Any, email: Any, opts: dict | None = None) -> dict[str, Any] | None:
    """contactGuard_: the staff roster's word on a phone and an e-mail, the card's own account left out."""
    if is_rehearsal(opts):
        return None
    self_cid = gsjs.or_text((opts or {}).get("self_candidate_id"))
    idx = index(reads)
    if not idx["ok"]:
        return {"severity": "unverified", "hits": []}
    pk = W.phone_key(phone)
    if pk and (pk in SDW.SHARED_LINE_DIGITS or pk in SDW.test_phones(reads)):
        pk = ""
    shared = SDW.shared_emails(reads)
    eks = [k for k in SDW.email_keys(email) if not SDW.test_email(reads, k) and k not in shared]

    def keep(people: list[dict] | None) -> list[dict]:
        return [p for p in people or [] if not (self_cid and p.get("cid") == self_cid)]

    hits: list[dict] = []
    if pk and keep(idx["phones"].get(pk)):
        hits.append({"via": "phone", "people": keep(idx["phones"].get(pk))})
    seen: set[str] = set()
    mail: dict | None = None
    for k in eks:
        for p in keep(idx["emails"].get(k)):
            sig = p["src"] + "|" + p["name"]
            if sig in seen:
                continue
            seen.add(sig)
            if mail is None:
                mail = {"via": "email", "people": []}
                hits.append(mail)
            mail["people"].append(p)
    if not hits:
        return None
    blocking = any(p.get("active") for h in hits for p in h["people"])
    return {"severity": "block" if blocking else "warn", "hits": hits}


def message(g: dict | None) -> str:
    """contactGuardMessage_: never asserts identity — a shared line does not prove who someone is."""
    if not g:
        return ""
    if g["severity"] == "unverified":
        return "Could not verify the staff roster right now — please try again."
    parts = []
    for h in g.get("hits") or []:
        names = list(dict.fromkeys(p["name"] for p in h["people"]))
        who = ", ".join(names[:3]) + (" and others" if len(names) > 3 else "")
        parts.append(("That phone number" if h["via"] == "phone" else "That e-mail address")
                     + f" is already on the staff roster ({who})")
    return "; ".join(parts) + ". An admin or manager can override with a reason."


def scan(sess: L.Session, payload: dict) -> dict[str, Any]:
    """staffGuardScan: every card not archived whose contact the staff roster already holds, with its severity."""
    user = sess.user
    if not writer(user):
        return CW.denied()
    reads = sess.reads
    rows: list[dict] = []
    try:
        for c in CND.read_tab(reads, CND.TALENT_CANDIDATES_TAB):
            if s_(c.get("archived")).lower() == "true":
                continue
            cid = s_(c.get("candidateid"))
            if not cid:
                continue
            g = guard(reads, c.get("phone"), c.get("email"),
                      {"self_candidate_id": cid, "name": s_(c.get("candidatename")), "trusted": True})
            if not g or g["severity"] == "unverified":
                continue
            rows.append({"candidate_id": cid, "name": s_(c.get("candidatename")),
                         "stage": CND.stage_of(c.get("status")), "severity": g["severity"], "why": message(g)})
    except Exception as e:  # noqa: BLE001 - staffGuardScan's catch: the pipeline's read said in its words
        return {"status": 500, "message": "Could not read the pipeline: " + (str(e) or type(e).__name__)}
    staff_views.record(user, "staff_guard_scan", f"{len(rows)} card(s) in conflict")
    return {"status": 200, "data": {"total": len(rows), "rows": rows}}


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {"staffGuardScan": scan}
POLICY: dict[str, dict[str, Any]] = {"staffGuardScan": {"roles": ROLES}}
