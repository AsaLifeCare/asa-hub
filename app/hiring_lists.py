"""The hiring resources the generic verbs read (Main.gs route()'s live adapters) off asa-hub-db, each answered in Apps
Script's own shapes and words — `candidates` (Talent.gs talentRoute_: the hiring board's cards), `onboarding`
(Onboarding.gs onboardingRoute_: the tracker, its stage derived from the paperwork), `talentPool`
(TalentPipeline.gs talentPoolRoute_: the legacy roster joined to its scores) and `recruitment` (Recruitment.gs
recruitmentRoute_: the Dropbox Sign envelopes, never their answers). The same doors fill their slices for the relay's
own identity; a write on any of them is refused (app/hiring_lists_writes.py)."""
from __future__ import annotations

from typing import Any, Callable

import candidates as CND
import gsjs
import interviews as IV
import locations as L
import scope as sc
import screening as SG
import staff as SP
import talent_pipeline as TP
from scope import Defer

s_ = gsjs.str_
WITHHELD = "[withheld"
ONB_ROLE = "Direct Support Professional"
ONB_SOURCE = "Hiring pipeline"
ONB_TEAM = "Onboarding records are for the team."
ONB_CREATE = ("A new hire enters onboarding by advancing in the Hiring pipeline — the interview scorecard is the "
              "gate.")
ONB_MOVE = ("Onboarding stages are derived from the paperwork on file: upload or verify a document instead of moving "
            "the card.")
POOL_TEAM = "The talent pool is for the hiring team."
POOL_READ_ONLY = "The talent pool is read-only — it mirrors the legacy workbook."
DAY_MS = 86400000.0


def _id_text(v: Any) -> str:
    """String(id) as a message joins it: undefined where none was named."""
    return "undefined" if v is None else gsjs.js_str(v)


def _client(user: dict | None) -> bool:
    """hubClientNarrowAnswer_'s caller: a client portal, never the service."""
    u = user or {}
    return not u.get("is_service") and (s_(u.get("role")) == "client" or not sc.role_counts(u.get("types"), u.get("role")))


def _withheld(rows: list[dict]) -> None:
    for r in rows:
        for v in (r or {}).values():
            if isinstance(v, str) and v.startswith(WITHHELD):
                raise Defer("the copy withholds a cell this list shows")


def _at_home(user: dict | None) -> None:
    """HUB_PLACE_ADAPTERS: headquarters' hiring pipeline — an account homed in another place reads its place's."""
    u = user or {}
    if not u.get("is_service") and not sc.is_real_master(u) and s_(u.get("home_tenant")):
        raise Defer("an account homed away from headquarters reads its place's rows")


# ---- candidates (Talent.gs talentRoute_) ----------------------------------------------------------------------------

def candidates_gate(sess: L.Session) -> dict[str, Any] | None:
    """talentLiveAllowed_: the service, the hiring roles, or a badge that interviews."""
    _at_home(sess.user)
    if not IV.hiring_team(sess.user, sess.reads):
        return {"status": 403, "message": SG.strings(sess.reads, "refuse.talent.not_team")}
    return None


def candidates_rows(reads: L.Reads) -> list[dict]:
    """talentCandidatesRead_: the board's cards (the graduation sweep it rode is the relay's clock's)."""
    rows = list(CND.board(reads)["rows"])
    _withheld(rows)
    return rows


def candidates_list(sess: L.Session, payload: dict) -> dict[str, Any]:
    """route('candidates', 'list')."""
    refused = candidates_gate(sess)
    if refused:
        return refused
    rows = candidates_rows(sess.reads)
    return {"status": 200, "data": [] if _client(sess.user) and rows else rows}


def candidates_get(sess: L.Session, payload: dict) -> dict[str, Any]:
    """route('candidates', 'get'): one card by its id."""
    refused = candidates_gate(sess)
    if refused:
        return refused
    pid = (payload or {}).get("id")
    hit = next((r for r in candidates_rows(sess.reads) if r.get("id") == pid), None)
    if hit is None:
        return {"status": 404, "message": CND.render(CND.book_text(sess.reads, "Strings", "refuse.talent.no_record", ""),
                                                     {"id": _id_text(pid)})}
    if _client(sess.user):
        return {"status": 404, "message": 'No row "candidates" here.'}
    return {"status": 200, "data": hit}


# ---- onboarding (Onboarding.gs onboardingRoute_) --------------------------------------------------------------------

def onboarding_gate(sess: L.Session) -> dict[str, Any] | None:
    """onboardingLiveAllowed_: the slice's own roles and the service that builds it."""
    _at_home(sess.user)
    u = sess.user or {}
    if not u or (not u.get("is_service") and s_(u.get("role")) not in ("admin", "director", "manager", "staff")):
        return {"status": 403, "message": ONB_TEAM}
    # an SSA or a FAMILY is never the onboarding team, whatever its role says (scope.role_counts)
    if not u.get("is_service") and not sc.role_counts(u.get("types"), u.get("role")):
        return {"status": 403, "message": ONB_TEAM}
    return None


def onboarding_days(reads: L.Reads, iso: str) -> int:
    """onboardingDays_: whole days since the moment; 0 when absent or unreadable."""
    if not iso:
        return 0
    t = CND.js_date_ms(iso)
    if t is None:
        return 0
    return max(0, int(gsjs.js_round((CND.now_ms(reads) - t) / DAY_MS)))


def onboarding_rows(reads: L.Reads) -> list[dict]:
    """onboardingRows_: one row per candidate at the onboarding stage, plus the hired — the stage derived from the
    papers on file, the packet read off the envelopes once for the board, the certificates off the estate once."""
    cands = CND.read_tab(reads, CND.TALENT_CANDIDATES_TAB)
    by_cid: dict[str, dict] = {}
    for a in CND.read_tab(reads, CND.TALENT_RESUME_TAB):
        if s_(a.get("candidateid")):
            by_cid[s_(a.get("candidateid"))] = a
    doc_index = CND.onboarding_doc_index(reads)
    mirror = CND.packet_rows(reads)
    pictures, _why = CND.soft(lambda: SP.cert_pictures(reads))
    cert_pic = pictures or {}
    obs: dict[str, dict] = {}
    got, _why = CND.soft(lambda: CND.read_tab(reads, CND.ONBOARDING_TAB))
    for o in got or []:
        if s_(o.get("candidateid")):
            obs[s_(o.get("candidateid"))] = o
    doc_rows = [r for r in CND.ONB_CHECKLIST if r["doc"]]
    out: list[dict] = []
    for c in cands:
        cid = s_(c.get("candidateid"))
        if not cid or cid in CND.TALENT_EXCLUDE_IDS:
            continue
        if s_(c.get("archived")).lower() == "true":
            continue
        if s_(c.get("status")).lower() not in ("onboarding", "hired"):
            continue
        docs = dict(doc_index.get(cid) or {})
        if s_(c.get("docsfolderid")):
            docs["__folder"] = True
        ob = obs.get(cid) or {}
        start = s_(ob.get("startdate"))
        stage = CND.onboarding_stage_of(c.get("status"), docs, start)
        analysis = by_cid.get(cid) or {}
        packet, _w = CND.soft(lambda: CND.packet_state(reads, c, mirror))
        ck = gsjs.name_key(s_(c.get("candidatename")))
        mine = (cert_pic.get(ck) or {}).get("certs") or {} if ck else {}
        checklist = CND.onboarding_checklist(docs, stage, analysis.get("cjisstatus"), packet, mine)
        verified = sum(1 for r in doc_rows if docs.get(r["doc"]) and docs[r["doc"]].get("status") == "verified")
        on_file = sum(1 for r in doc_rows if docs.get(r["doc"]) and docs[r["doc"]].get("status") in ("verified",
                                                                                                    "uploaded"))
        moved = s_(ob.get("datemovedtoonboarding")) or s_(c.get("updatedat")) or s_(c.get("createdat"))
        hold, _w = CND.soft(lambda: CND.packet_hold(reads, c))
        out.append({
            "id": cid, "candidateId": cid, "name": s_(c.get("candidatename")) or cid, "role": ONB_ROLE, "avatar": "",
            "stage": stage, "house": s_(ob.get("house")), "email": s_(c.get("email")), "phone": s_(c.get("phone")),
            "address": ", ".join(x for x in (s_(c.get("city")), s_(c.get("state"))) if x),
            "manager": s_(ob.get("updatedby")) or s_(c.get("assignedto")), "source": ONB_SOURCE,
            "appliedAt": CND.day_label(s_(c.get("createdat"))), "startDate": CND.day_label(start) if start else "",
            "daysInStage": onboarding_days(reads, moved), "daysInOnboarding": onboarding_days(reads, moved),
            "docsDone": on_file, "docsVerified": verified,
            "docsSummary": f"{verified} of {len(doc_rows)} verified", "checklist": checklist,
            "packet": CND.packet_chip(packet["state"]) if packet else None,
            "packetSignedOn": s_(packet.get("signed")) if packet and packet.get("state") == "signed" else "",
            "packetHold": hold, "notes": []})
    return out


def onboarding_list(sess: L.Session, payload: dict) -> dict[str, Any]:
    """route('onboarding', 'list')."""
    refused = onboarding_gate(sess)
    if refused:
        return refused
    rows = onboarding_rows(sess.reads)
    return {"status": 200, "data": [] if _client(sess.user) and rows else rows}


def onboarding_get(sess: L.Session, payload: dict) -> dict[str, Any]:
    """route('onboarding', 'get'): one new hire's row by its id."""
    refused = onboarding_gate(sess)
    if refused:
        return refused
    pid = (payload or {}).get("id")
    hit = next((r for r in onboarding_rows(sess.reads) if r["id"] == pid), None)
    if hit is None:
        return {"status": 404, "message": 'No "onboarding" record with id "' + _id_text(pid) + '".'}
    if _client(sess.user):
        return {"status": 404, "message": 'No row "onboarding" here.'}
    return {"status": 200, "data": hit}


# ---- talentPool (TalentPipeline.gs talentPoolRoute_) ----------------------------------------------------------------

def pool_gate(sess: L.Session) -> dict[str, Any] | None:
    u = sess.user or {}
    if not u or (not u.get("is_service") and not TP.manager(u)):
        return {"status": 403, "message": POOL_TEAM}
    return None


def pool_rows(sess: L.Session) -> dict[str, Any]:
    """talentPipelineList({crossing: true}) asked as an admin under the caller's address (or the service's)."""
    u = sess.user or {}
    got = TP.pipeline_list(L.Session(sess.reads, {"role": "admin", "email": s_(u.get("email")) or "service"}),
                           {"crossing": True})
    if got.get("status") != 200:
        return {"refused": got}
    return {"rows": list((got.get("data") or {}).get("rows") or [])}


def pool_list(sess: L.Session, payload: dict) -> dict[str, Any]:
    """route('talentPool', 'list')."""
    refused = pool_gate(sess)
    if refused:
        return refused
    got = pool_rows(sess)
    if got.get("refused"):
        return got["refused"]
    return {"status": 200, "data": [] if _client(sess.user) and got["rows"] else got["rows"]}


def pool_get(sess: L.Session, payload: dict) -> dict[str, Any]:
    """route('talentPool', 'get'): one legacy candidate by its id."""
    refused = pool_gate(sess)
    if refused:
        return refused
    got = pool_rows(sess)
    if got.get("refused"):
        return got["refused"]
    pid = s_((payload or {}).get("id"))
    hit = next((r for r in got["rows"] if s_(r.get("candidate_id")) == pid), None)
    if hit is None:
        return {"status": 404, "message": 'No talent pool row "' + pid + '".'}
    if _client(sess.user):
        return {"status": 404, "message": 'No row "talentPool" here.'}
    return {"status": 200, "data": hit}


# ---- recruitment (Recruitment.gs recruitmentRoute_) -----------------------------------------------------------------

def recruitment_gate(sess: L.Session) -> dict[str, Any] | None:
    u = sess.user or {}
    if not u or (not u.get("is_service") and not SG.writer(u)):
        return {"status": 403, "message": SG.strings(sess.reads, "refuse.recruit.not_team")}
    return None


def recruitment_rows(reads: L.Reads) -> dict[str, Any]:
    """The envelope of each application, never its answers; unreadable is not empty."""
    rows, why = CND.soft(lambda: CND.read_tab(reads, CND.RECRUIT_TAB))
    if why:
        return {"refused": {"status": 503, "message": SG.strings(reads, "refuse.recruit.mirror_unreadable",
                                                                 {"error": why})}}
    out = []
    for r in rows or []:
        srid = s_(r.get("signaturerequestid"))
        if not srid:
            continue
        out.append({"id": srid, "srid": srid, "name": s_(r.get("candidate")), "email": s_(r.get("email")),
                    "phone": s_(r.get("phone")), "location": s_(r.get("location")), "applied": s_(r.get("applied")),
                    "signed": s_(r.get("signed")), "status": s_(r.get("status")).lower(), "title": s_(r.get("title")),
                    "original_title": s_(r.get("originaltitle")), "signer_count": s_(r.get("signercount")),
                    "signed_count": s_(r.get("signedcount"))})
    return {"rows": out}


def recruitment_list(sess: L.Session, payload: dict) -> dict[str, Any]:
    """route('recruitment', 'list')."""
    refused = recruitment_gate(sess)
    if refused:
        return refused
    got = recruitment_rows(sess.reads)
    if got.get("refused"):
        return got["refused"]
    return {"status": 200, "data": [] if _client(sess.user) and got["rows"] else got["rows"]}


def recruitment_get(sess: L.Session, payload: dict) -> dict[str, Any]:
    """route('recruitment', 'get'): one envelope by its signature request id."""
    refused = recruitment_gate(sess)
    if refused:
        return refused
    got = recruitment_rows(sess.reads)
    if got.get("refused"):
        return got["refused"]
    pid = s_((payload or {}).get("id"))
    hit = next((r for r in got["rows"] if r["srid"] == pid), None)
    if hit is None:
        return {"status": 404, "message": SG.strings(sess.reads, "refuse.recruit.no_application", {"id": pid})}
    if _client(sess.user):
        return {"status": 404, "message": 'No row "recruitment" here.'}
    return {"status": 200, "data": hit}


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {
    "candidatesList": candidates_list, "candidatesGet": candidates_get, "onboardingList": onboarding_list,
    "onboardingGet": onboarding_get, "talentPoolList": pool_list, "talentPoolGet": pool_get,
    "recruitmentList": recruitment_list, "recruitmentGet": recruitment_get}
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
