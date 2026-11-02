"""The New Hire packet (Packet.gs) off asa-hub-db: what the signed packet says (packetFields), whether a person typed
into the intake form is already known (packetProbe, screenProbe), the envelopes a name finds (packetFind), a packet
attached by hand filed and read for its name before the write keeps the verdict (packetAttachPrepare), and the
looks the relay's clock asks before the request and hold sweeps (packetRequestDue, packetHoldDue)."""
from __future__ import annotations

import base64
import binascii
import json
import logging
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

import candidate_writes as CW
import candidates as CND
import gsjs
import hiring_hired as HH
import locations as L
import location_docs as LD
import names as N
import recon as R
import staff_comms as SCM

log = logging.getLogger("asa-hub-app")
s_ = CND.s_
DENIED = HH.DENIED
MAX_BYTES = 15 * 1024 * 1024
DOC_DIR = "hiring_packet"
_SAFE = re.compile(r"[^A-Za-z0-9 ._()-]+")
_FILE_ID = re.compile(r"^[A-Za-z0-9_-]{10,}\Z")
REQUEST = ("hiring.packet.request", "hiring_packet_request")
REHEARSAL_KEY = "packet_rehearsal_number"

# Packet.gs PACKET_FIELD_MAP: what the packet's fields are called
FIELD_MAP = {
    "nome completo1": "Employee Name", "fullname1": "Employee Name", "fullname2": "Employee Name",
    "fullname3": "Employee Name", "fullname4": "Employee Name", "fullname5": "Employee Name",
    "employee's name": "Employee Name", "employee name": "Employee Name", "caixa de texto1": "Employee Name",
    "first name": "First Name", "fisrt name": "First Name",
    "last name": "Last Name", "sobrenome": "Last Name", "textbox2": "Last Name",
    "nome1": "First Name",
    "mi": "Middle Initial", "middle initial": "Middle Initial",
    "ssn": "SSN", "ssn#": "SSN", "social security number": "SSN", "textbox5": "SSN",
    "textbox53": "Date of Birth", "caixa de texto53": "Date of Birth",
    "address": "Address", "street address": "Address", "employee's address": "Address",
    "employee's adress": "Address", "textbox3": "Address",
    "city": "City", "city or town": "City", "textbox4": "City",
    "state": "State", "st": "State",
    "zip": "Zip", "zipcode": "Zip", "zip code": "Zip",
    "phone": "Phone", "phone number": "Phone", "mobile phone": "Phone", "telephone number": "Phone",
    "email": "Email", "email address": "Email",
    "caixa de texto58": "Referral",
    "date of birth": "Date of Birth",
    "home phone": "Home Phone",
}
CHIP = CND.PACKET_CHIP
# Packet.gs PACKET_LABEL_STOP: a name read off a packet is cut at the next label
LABEL_STOP = re.compile(r"\b(MI|SSN|Social|Email|Address|Street|City|ST|State|Zip|Home|Mobile|Phone|Date|Signature|"
                        r"Signed|Middle|Initial|First|Last|Name)\b", re.I)
NAME_PATS = (re.compile(r"(?:Employee|Applicant|Candidate)\s*Name\s*[:\-]?\s*([^\n\r]{2,60})", re.I),
             re.compile(r"First\s*Name\s*[:\-]?\s*([^\n\r]{2,40})[\s\S]{0,80}?Last\s*Name\s*[:\-]?\s*([^\n\r]{2,40})",
                        re.I),
             re.compile(r"Last\s*Name\s*[:\-]?\s*([^\n\r]{2,40})[\s\S]{0,80}?First\s*Name\s*[:\-]?\s*([^\n\r]{2,40})",
                        re.I),
             re.compile(r"Print(?:ed)?\s*Name\s*[:\-]?\s*([^\n\r]{2,60})", re.I))


def _probe_name(p: dict) -> str:
    return gsjs.trim(s_(p.get("first_name")) + " " + s_(p.get("last_name"))) or s_(p.get("name"))


# ---- what the packet says (packetFields) ----------------------------------------------------------------------------

def redact(label: str, value: Any) -> Any:
    """packetRedact_: an SSN never leaves the packet in the clear."""
    if label != "SSN":
        return value
    d = re.sub(r"\D", "", gsjs.js_str(value))
    return "•••-••-" + d[-4:] if len(d) >= 4 else "•••"


def answers(fields: dict) -> dict[str, dict]:
    """packetAnswers_: the envelope's answers under names a person recognises."""
    out: dict[str, Any] = {}
    raw: dict[str, Any] = {}
    for k, v in fields.items():
        label = FIELD_MAP.get(str(k).lower())
        if label:
            if label not in out:
                out[label] = redact(label, v)
        else:
            raw[k] = v
    return {"named": out, "unnamed": raw}


def _parse(r: dict) -> dict:
    try:
        got = json.loads(s_(r.get("fieldsjson")) or "{}")
    except ValueError:
        return {}
    return got if isinstance(got, dict) else {}


def fields_door(sess: L.Session, payload: dict) -> dict[str, Any]:
    """packetFields: one candidate's envelope read under names a person recognises, or the field map across every
    envelope the mirror holds."""
    user = sess.user or {}
    if not user or s_(user.get("role")) != "admin":
        return dict(DENIED)
    reads = sess.reads
    rows = CND.packet_rows(reads)
    p = payload if isinstance(payload, dict) else {}
    cid = s_(p.get("candidate_id"))
    if cid:
        cand = CND.evidence(reads, cid).get("cand")
        if not cand:
            return {"status": 404, "message": f'No candidate "{cid}".'}
        res = CND.packet_match(reads, cand, rows)
        if not res["srid"]:
            return {"status": 200, "data": {"state": res["state"], "srid": "", "matched_by": "", "fields": {},
                                            "message": "No envelope matched this person, so there are no answers to "
                                                       "read."}}
        hit = None
        for r in rows:
            if s_(r.get("signaturerequestid")) == res["srid"]:
                hit = r
        return {"status": 200, "data": {
            "state": res["state"], "srid": res["srid"], "matched_by": res["by"],
            "title": s_(hit.get("title")) if hit else "", "signed": s_(hit.get("signed")) if hit else "",
            "answers": answers(_parse(hit)) if hit else {"named": {}, "unnamed": {}}}}
    counts: dict[str, int] = {}
    sample: dict[str, str] = {}
    envelopes = 0
    for r in rows:
        f = _parse(r)
        if not f:
            continue
        envelopes += 1
        for k, v in f.items():
            counts[k] = counts.get(k, 0) + 1
            if k not in sample:
                sample[k] = gsjs.js_str(v)[:60]
    listed = []
    for k, n in counts.items():
        known = FIELD_MAP.get(str(k).lower(), "")
        listed.append({"field": k, "means": known, "envelopes": n,
                       "example": redact(known, sample[k]) if known else sample[k]})
    listed.sort(key=lambda x: -x["envelopes"])
    has_column = bool(rows) and "fieldsjson" in rows[0]
    return {"status": 200, "data": {
        "mirror_rows": len(rows), "envelopes_with_answers": envelopes, "has_fields_column": has_column,
        "diagnosis": "" if envelopes else (
            "The column is there and empty — the answers are fetched one envelope at a time, up to a budget per sync. "
            "Run the sync again until fields_left_for_next_run is 0." if has_column
            else "This mirror was built before fields_json existed — run a recruitment sync."),
        "fields": listed[:400]}}


# ---- before the card exists (packetProbe, packetFind, screenProbe) -------------------------------------------------

def probe(sess: L.Session, payload: dict) -> dict[str, Any]:
    """packetProbe: is there already a signed packet for this person, asked while the intake form is typed."""
    if not HH.writer(sess.user):
        return dict(DENIED)
    p = payload if isinstance(payload, dict) else {}
    who = {"email": s_(p.get("email")), "phone": s_(p.get("phone")), "candidatename": _probe_name(p)}
    try:
        res = CND.packet_match(sess.reads, who, CND.packet_rows(sess.reads))
    except Exception:  # noqa: BLE001 - an unreadable mirror is an unknown, said
        return {"status": 200, "data": {"state": "unknown", "reason": "mirror unreadable"}}
    return {"status": 200, "data": {"state": res["state"], "srid": res["srid"], "matched_by": res["by"],
                                    "label": CHIP.get(res["state"]) or CHIP["unknown"]}}


def _rank(status: str) -> int:
    return {"signed": 3, "pending": 2, "declined": 1}.get(status, 0)


def find(sess: L.Session, payload: dict) -> dict[str, Any]:
    """packetFind: the envelopes a name finds — the strong match first, from the same matcher the sweep uses, and
    each found envelope's owner when it is already bound."""
    if not HH.writer(sess.user):
        return dict(DENIED)
    reads = sess.reads
    p = payload if isinstance(payload, dict) else {}
    cid = s_(p.get("candidate_id"))
    cand = None
    if cid:
        cand, _w = CND.soft(lambda: CND.evidence(reads, cid).get("cand"))
    query = s_(p.get("query")) or (s_(cand.get("candidatename")) if cand else "")
    if not query and not cand:
        return {"status": 400, "message": "Give a name to search for, or a candidate_id."}
    rows = CND.packet_rows(reads)
    strong = None
    if cand:
        m, _w = CND.soft(lambda: CND.packet_match(reads, cand, rows))
        if m and m["state"] != "unknown":
            strong = {"srid": m["srid"], "state": m["state"], "matched_by": m["by"], "signed": s_(m["signed"])}
    taken: dict[str, str] = {}
    every, _w = CND.soft(lambda: HH.cands(reads))
    for c in every or []:
        srid = s_(c.get("packetsrid"))
        if srid and s_(c.get("candidateid")) != cid:
            taken[srid] = s_(c.get("candidatename")) or s_(c.get("candidateid"))
    qt = N.tokens(query)["core"]
    out = []
    if qt:
        for r in rows:
            ct = N.tokens(s_(r.get("candidate")))["core"]
            if not ct:
                continue
            hit = sum(1 for t in qt if t in ct)
            if not (hit == 1 if len(qt) == 1 else hit >= 2):
                continue
            srid = s_(r.get("signaturerequestid"))
            out.append({"srid": srid, "name_on_envelope": s_(r.get("candidate")), "email": s_(r.get("email")),
                        "status": gsjs.or_text(r.get("status")).lower(), "applied": s_(r.get("applied")),
                        "signed": s_(r.get("signed")), "title": s_(r.get("title")), "found_by": "name",
                        "name_parts_matched": f"{hit} of {len(qt)}", "already_bound_to": taken.get(srid, "")})
    out.sort(key=CND._cmp(lambda a, b: (_rank(b["status"]) - _rank(a["status"])) or
                          gsjs.locale_cmp(gsjs.js_str(b["applied"]), gsjs.js_str(a["applied"]))))
    return {"status": 200, "data": {
        "candidate_id": cid, "searched_for": query, "strong": strong, "by_name": out[:25], "total_by_name": len(out),
        "note": ("This card already resolves to an envelope by " + strong["matched_by"] +
                 " — the name results are alternatives, not confirmations.") if strong else
        ("Found by NAME only. A name is not proof: check the e-mail and the date before binding one, because two "
         "people can share a name and only one of them signed this.")}}


def screen_probe(sess: L.Session, payload: dict) -> dict[str, Any]:
    """screenProbe: is this person already known — and did their phone screen already happen?"""
    if not HH.writer(sess.user):
        return dict(DENIED)
    reads = sess.reads
    p = payload if isinstance(payload, dict) else {}
    name = _probe_name(p)
    phone_key = SCM._digits10(s_(p.get("phone")))
    email_keys = set(SCM._email_keys(s_(p.get("email"))))
    out: dict[str, Any] = {"recognised": False, "matched_by": "", "screen_exists": False, "screen_status": "",
                           "candidate_id": "", "candidate_name": ""}
    try:
        screens: dict[str, dict] = {}
        for sc_row in CND.read_tab(reads, CND.TALENT_PHONE_TAB):
            if s_(sc_row.get("candidateid")):
                screens[s_(sc_row.get("candidateid"))] = sc_row
        for c in HH.cands(reads):
            if s_(c.get("archived")).lower() == "true":
                continue
            hit = ""
            if phone_key and SCM._digits10(c.get("phone")) == phone_key and phone_key not in CND.SHARED_LINE_DIGITS:
                hit = "phone"
            if not hit and email_keys and any(k in email_keys for k in SCM._email_keys(c.get("email"))):
                hit = "email"
            if not hit and name and N.norm(c.get("candidatename")) and N.norm(c.get("candidatename")) == N.norm(name):
                hit = "name"
            if not hit:
                continue
            out.update(recognised=True, matched_by=hit, candidate_id=s_(c.get("candidateid")),
                       candidate_name=s_(c.get("candidatename")))
            sc_row = screens.get(out["candidate_id"])
            if sc_row:
                out["screen_exists"] = True
                out["screen_status"] = s_(sc_row.get("screenstatus"))
            break
    except Exception:  # noqa: BLE001 - unknown is a fine answer
        pass
    if not out["recognised"]:
        try:
            pk = CND.packet_match(reads, {"email": s_(p.get("email")), "phone": s_(p.get("phone")),
                                          "candidatename": name}, CND.packet_rows(reads))
            if pk and pk["state"] != "unknown":
                out["recognised"], out["matched_by"] = True, "new-hire-packet"
        except Exception:  # noqa: BLE001 - leave it false
            pass
    out["may_attest"] = bool(name and len(re.split(r"\s+", name)) >= 2 and phone_key)
    return {"status": 200, "data": out}


# ---- a packet attached by hand, read for its name (packetAttach's heavy half) ----------------------------------------

def clean_name(v: Any) -> str:
    """packetCleanName_: one name out of a read line, cut at the next label; '' when implausible."""
    s = re.sub(r"\s+", " ", gsjs.or_blank(v)).strip()
    m = LABEL_STOP.search(s)
    if m and m.start() > 0:
        s = s[:m.start()].strip()
    s = re.sub(r"\s+", " ", re.sub(r"[^A-Za-z .'\-]", "", s)).strip()
    parts = [w for w in s.split(" ") if w]
    if not parts or len(parts) > 4:
        return ""
    return " ".join(parts)


def names_in(text: str) -> list[str]:
    """packetNamesFromText_: every name the document's labels offer, best first."""
    out: list[str] = []
    for rx in NAME_PATS:
        m = rx.search(text)
        if not m:
            continue
        if m.lastindex and m.lastindex >= 2:
            a, b = clean_name(m.group(1)), clean_name(m.group(2))
            if a and b:
                out += [a + " " + b, b + " " + a]
            else:
                out += [x for x in (clean_name(m.group(1)), clean_name(m.group(2))) if x]
        else:
            got = clean_name(m.group(1))
            if got:
                out.append(got)
    return out


def verdict(expected: str, text: str) -> dict[str, str]:
    """The name check: a failure to read is 'unreadable', never 'wrong'."""
    if not text:
        return {"verdict": "unreadable", "found": ""}
    hay = N.norm(re.sub(r"\s+", " ", text))
    needle = N.norm(expected)
    if needle and needle in hay:
        return {"verdict": "match", "found": expected}
    found = names_in(text)
    best = N.best(expected, [{"n": n} for n in found], lambda x: x["n"]) if found else {"ok": False}
    if best.get("ok"):
        return {"verdict": "match", "found": best["item"]["n"]}
    if found:
        return {"verdict": "mismatch", "found": found[0]}
    return {"verdict": "unreadable", "found": ""}


def kept_dir(fid: str) -> Path:
    return LD.ROOT / DOC_DIR / fid


def keep(fid: str, name: str, mime: str, data: bytes, by: str) -> str:
    """The bytes on the server's disk beside what they are; the path under the documents root."""
    folder = kept_dir(fid)
    folder.mkdir(parents=True, exist_ok=True)
    target = folder / (_SAFE.sub("_", name)[:150].strip() or "packet")
    tmp = target.with_name(target.name + ".part")
    tmp.write_bytes(data)
    os.replace(tmp, target)
    (folder / "meta.json").write_text(json.dumps({"name": name, "file": target.name, "mime": mime, "size": len(data),
                                                  "by": by, "at": gsjs.iso(datetime.now(timezone.utc))}),
                                      encoding="utf-8")
    return str(target.relative_to(LD.ROOT))


def attach_prepare(sess: L.Session, payload: dict) -> dict[str, Any]:
    """packetAttach's heavy half: the packet filed in the onboarding documents folder in Drive as the platform's
    account and kept on the server, then read for the name it carries; sealed for its write."""
    user = sess.user or {}
    if not HH.writer(user):
        return dict(DENIED)
    p = payload if isinstance(payload, dict) else {}
    expected = s_(p.get("name"))
    if not expected:
        return {"status": 400, "message": "Whose packet is this? A name is required."}
    b64 = gsjs.or_blank(p.get("base64"))
    if not b64 or b64 == "kept":
        return {"status": 400, "message": "No file attached."}
    try:
        data = base64.b64decode(b64, validate=False)
    except (binascii.Error, ValueError):
        return {"status": 400, "message": "The file could not be read."}
    if not data:
        return {"status": 400, "message": "The file is empty."}
    if len(data) > MAX_BYTES:
        return {"status": 400, "message": "The file is over 15MB."}
    import onboarding as OB  # noqa: PLC0415 - obDocsTarget_, the onboarding documents' folder
    reads = sess.reads
    try:
        drv = reads.need_drive()
        target = OB.docs_target(reads, drv)
    except Exception as exc:  # noqa: BLE001 - nothing was saved, said
        log.info("packet attach: the documents folder could not be opened (%s)", type(exc).__name__)
        return {"status": 502, "message": "The documents folder could not be opened — nothing was saved."}
    tail = s_(p.get("filename"))[-4:]
    mime = s_(p.get("mime_type")) or "application/pdf"
    name = expected + " - New Hire Packet" + (tail if tail.startswith(".") else ".pdf")
    try:
        filed = drv.upload_into(target["folder"], name, mime, data)
    except Exception as exc:  # noqa: BLE001 - nothing was saved, said
        log.warning("packet attach: the packet was not filed in Drive (%s)", type(exc).__name__)
        return {"status": 502, "message": "The packet could not be filed just now — nothing was saved."}
    fid = s_(filed.get("id"))
    by = s_(user.get("email"))
    path = keep(fid, name, mime, data, by)
    try:
        text = drv.ocr_text(data, mime)
    except Exception as exc:  # noqa: BLE001 - a failure to read is 'unreadable', never 'wrong'
        log.info("packet attach: the packet could not be read (%s)", type(exc).__name__)
        text = ""
    v = verdict(expected, text or "")
    return {"status": 200, "data": R.seal("packetAttach", R.actor(user), {
        "file_id": fid, "verdict": v["verdict"], "name_in_document": v["found"], "where": target["where"],
        "expected": expected, "path": path})}


# ---- the looks the relay's clock asks first ------------------------------------------------------------------------

def rehearsal_number(reads: L.Reads) -> str:
    """packetRehearsalNumber_."""
    cfg, why = CND.soft(reads.config)
    raw = "" if why else s_((cfg or {}).get(REHEARSAL_KEY))
    d = re.sub(r"^1", "", re.sub(r"\D", "", raw), count=1)
    return "+1" + d if len(d) == 10 else ""


def at_onboarding(reads: L.Reads) -> list[dict]:
    return [c for c in HH.cands(reads) if s_(c.get("candidateid")) and s_(c.get("candidateid")) not in CW.EXCLUDE_IDS
            and not HH.archived(c) and CND.stage_of(c.get("status")) == "onboarding"]


def request_plan(reads: L.Reads) -> dict[str, Any]:
    """packetRequestSweep_'s look: who at Onboarding is still owed the request, by which channels."""
    rows = at_onboarding(reads)
    if not rows:
        return {"none": True, "cards": [], "on": True}
    sid = HH.sit_id(reads, REQUEST)
    on = HH.situation_on(reads, sid) is not None
    mirror = CND.packet_rows(reads)
    cards = []
    for c in rows:
        cid = s_(c.get("candidateid"))
        st, why = CND.soft(lambda c=c: CND.packet_state(reads, c, mirror))
        if why:
            cards.append({"cid": cid, "skip": "unreadable"})
            continue
        if st["state"] in ("signed", "waived"):
            continue
        rung = HH.ladder_due(reads, "packet_request", cid)
        if not rung["due"] or not on:
            continue
        n = rung["sent"] + 1
        if HH.holding(reads, [f"packet_request_{cid}_{n}", f"packet_request_mail_{cid}_{n}"]):
            continue
        cards.append({"cid": cid, "sent": rung["sent"], "of": rung["of"]})
    return {"cards": cards, "on": on, "situation": sid}


def hold_plan(reads: L.Reads) -> dict[str, Any]:
    """hubPacketHoldSweep_'s look: the held cards whose signed packet is on file now."""
    held = [c for c in at_onboarding(reads) if s_(c.get("packetholduntil"))]
    if not held:
        return {"release": []}
    mirror = CND.packet_rows(reads)
    out = []
    for c in held:
        res, why = CND.soft(lambda c=c: CND.packet_state(reads, c, mirror))
        if why or not res or res["state"] not in ("signed", "waived"):
            continue
        out.append({"cid": s_(c.get("candidateid")), "res": {k: s_(res.get(k)) for k in ("state", "srid", "by",
                                                                                         "signed")}})
    return {"release": out}


def request_due(sess: L.Session, payload: dict) -> dict[str, Any]:
    if not HH.service(sess):
        return dict(HH.SERVICE_ONLY)
    plan = request_plan(sess.reads)
    return {"status": 200, "data": {**plan, "due": len([d for d in plan["cards"] if not d.get("skip")])}}


def hold_due(sess: L.Session, payload: dict) -> dict[str, Any]:
    if not HH.service(sess):
        return dict(HH.SERVICE_ONLY)
    plan = hold_plan(sess.reads)
    return {"status": 200, "data": {**plan, "due": len(plan["release"])}}


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {
    "packetFields": fields_door, "packetProbe": probe, "packetFind": find, "screenProbe": screen_probe,
    "packetAttachPrepare": attach_prepare, "packetRequestDue": request_due, "packetHoldDue": hold_due}
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
