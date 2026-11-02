"""Compliance documents: a filed certificate's reading laid over its ledger row. The relay's lane (server/cert_reads.py)
reads the paper with Tesseract and the decoder's engine into app.cert_reads; the verdict is ComplianceDocs.gs
certReadVerdict_ and complianceDocsReadRow_, decided here per read, so no paper is ever left to Apps Script."""
from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any

import gsjs
import hubdb

READS_SQL = "select row_id, file_id, state, reading, error, attempts, read_at from app.cert_reads"
TRIES = 3
# ComplianceDocs.gs CERT_READ_KINDS, CERT_READ_REPORT_KINDS, CERT_READ_NEVER_EXPIRES, CERT_READ_LEVEL_SCORE
KINDS = {
    "dodd": ["dodd_certification"], "cpr": ["cpr_first_aid"],
    "med1": ["med_admin_cert"], "med2": ["med_admin_cert"], "med3": ["med_admin_cert"],
    "mandt": ["crisis_prevention"], "driver_license": ["drivers_licence", "state_id"],
    "car_insurance": ["auto_insurance"], "drive_abstract": ["driver_abstract"],
    "i9_type_1": ["drivers_licence", "state_id", "passport", "work_authorization", "ssn_card", "birth_certificate"],
    "i9_type_2": ["drivers_licence", "state_id", "passport", "work_authorization", "ssn_card", "birth_certificate"],
}
REPORT_KINDS = {"driver_abstract"}
NEVER_EXPIRES = {"ssn_card", "birth_certificate"}
LEVEL_SCORE = 6
UPLOADABLE = {"training", "documents"}
WORDS = {
    "heic": "This photo format cannot be read for a date — a JPG or PDF of the same paper can.",
    "empty": "No words could be read from this file.",
    "someone": "This paper names someone else.",
    "noExpiry": "No expiry date could be read from this file.",
    "noIssued": "No date of issue could be read from this file.",
    "noRecordDay": ("This paper prints a licence's dates but not the day the record itself was drawn, so no date is "
                    "taken from it."),
    "noReq": "This document is not filed under a requirement a paper is read for, so no date is taken from it.",
    "noFile": "The ledger keeps no file for this document.",
    "stray": "The file behind this document is not in the compliance folder, so it is not shown here — HR opens it.",
    "reading": "This paper is being read; its dates show here once it is.",
    "again": "The file could not be read just now — it is read again within minutes.",
}


def _s(v: Any) -> str:
    return gsjs.str_(v)


def day(v: Any) -> str:
    """complianceDocsDay_."""
    m = re.match(r"(\d{4}-\d{2}-\d{2})", _s(v))
    return m.group(1) if m else ""


def date_role(req: dict | None) -> str:
    """complianceDocsDateRole_."""
    source = _s((req or {}).get("date_source"))
    if not source:
        return ""
    return "expires" if (_s((req or {}).get("credential")) or re.search(r"\bexp", source, re.I)) else "issued"


def req_shut(req: dict) -> str:
    """complianceDocsReqShut_."""
    category = _s(req.get("category")).lower()
    if category in UPLOADABLE:
        return ""
    return "HR files this form." if category == "onboarding" else "HR records this one."


def _a(w: str) -> str:
    return ("an " if re.match(r"[aeiou]", w, re.I) else "a ") + w


def kind_words(kind: Any, kind_words_of: dict[str, str]) -> str:
    """certReadKindWords_."""
    k = _s(kind)
    return _a(kind_words_of.get(k) or k.replace("_", " "))


def confidence(f: dict[str, Any], reading: dict[str, Any]) -> int:
    """digestConfidence_ over the paper's facts, its lists counted by the lane, and the book's no-expiry ceiling."""
    score = 0
    chars = float(f.get("chars") or 0)
    score += 30 if chars >= 400 else 18 if chars >= 80 else 8 if chars > 0 else 0
    if float(f.get("kind_score") or 0) >= 20:
        score += 8
    if f.get("who") and (f.get("person_source") in ("roster", "ledger", "document") or f.get("person_agree") == "yes"):
        score += 5
    if f.get("doc_kind"):
        score += 25
    if f.get("category") and f.get("category") != "other":
        score += 15 if f.get("category_source") in ("drawer", "doc_kind") else 8
    if f.get("expires_on") or f.get("issued_on"):
        score += 12
    elif int(f.get("dates") or 0):
        score += 5
    if f.get("who"):
        score += 10
    if int(f.get("numbers") or 0):
        score += 5
    if int(f.get("pairs") or 0) >= 3:
        score += 5
    if f.get("issuer"):
        score += 3
    if reading.get("wants_expiry") and not _s(f.get("expires_on")):
        score = min(score, float(reading.get("no_expiry_ceiling") or 60))
    return int(max(0, min(100, score)))


def verdict(req: dict | None, reading: dict[str, Any], subject_id: Any,
            kind_words_of: dict[str, str]) -> dict[str, Any]:
    """certReadVerdict_: whether a paper's reading stands for its requirement — pure."""
    p = reading.get("paper") or {}
    req_id = _s((req or {}).get("req_id"))
    label = _s((req or {}).get("label")) or req_id or "this requirement"
    role = date_role(req)
    out = {"state": "unread", "kind": _s(p.get("kind")), "issued_on": day(p.get("issued_on")),
           "expires_on": day(p.get("expires_on")), "how": _s(p.get("expires_source")), "confidence": 0, "why": "",
           "who": "", "person_source": ""}
    credential_days = False
    if role == "issued":
        out["expires_on"] = ""
        issued_how = _s((p.get("how") or {}).get("issued")) if isinstance(p.get("how"), dict) else ""
        out["how"] = "issued" + (":" + issued_how if issued_how else "")
        if out["kind"] in REPORT_KINDS:
            drawn = day(p.get("report_on"))
            if drawn:
                out["issued_on"], out["how"] = drawn, "issued:report"
            else:
                credential_days = bool(day(p.get("expires_on"))) or p.get("licence_dated") is True
                if credential_days:
                    out["issued_on"] = ""

    def refuse(why: str) -> dict[str, Any]:
        out["why"] = why
        return out

    if p.get("state") == "heic":
        return refuse(WORDS["heic"])
    if p.get("state") != "read" or not float(p.get("chars") or 0):
        return refuse(WORDS["empty"])
    kinds = KINDS.get(req_id)
    if kinds:
        if not out["kind"]:
            return refuse(f"What this paper is could not be told from its words, so it is not taken as {_a(label)}.")
        if out["kind"] not in kinds:
            return refuse(f"This reads as {kind_words(out['kind'], kind_words_of)}, not {_a(label)}.")
    med = re.match(r"^med([123])$", req_id)
    levels = _s(p.get("level")).split(",") if med and _s(p.get("level")) else []
    if med and levels and med.group(1) not in levels:
        return refuse(f"This reads as a Category {' and '.join(levels)} medication certificate, not {_a(label)}.")
    kind_score = float(p.get("kind_score") or 0) + (LEVEL_SCORE if med and levels else 0)
    if kinds and kind_score < 10:
        return refuse(f"This reads only faintly as {_a(label)}, so its dates are not taken.")
    if med:
        if not levels:
            return refuse(f"The category on this medication certificate could not be read, so it is not taken as "
                          f"{_a(label)}.")
        best = None
        for g in p.get("grid") or []:
            if isinstance(g, dict) and g.get("status") == "certified" and _s(g.get("level")) == med.group(1) and \
                    (best is None or _s(g.get("expires")) > _s(best.get("expires"))):
                best = g
        if best and day(best.get("expires")):
            out["expires_on"] = day(best.get("expires"))
            out["issued_on"] = day(best.get("effective")) or out["issued_on"]
            out["how"] = "grid"
    who = _s(p.get("who"))
    subject = re.sub(r"^(people:)+", "", _s(subject_id))
    who_id = re.sub(r"^(people:)+", "", who) if who.startswith("people:") else ""
    if who and (not subject or who_id != subject):
        return refuse(WORDS["someone"])
    if subject:
        out["who"] = "people:" + subject
        out["person_source"] = "document" if who else "ledger"
    if role == "expires":
        if out["kind"] in NEVER_EXPIRES:
            out["expires_on"] = ""
            words = kind_words(out["kind"], kind_words_of)
            return refuse(f"{words[0].upper()}{words[1:]} carries no expiry, so it gives this record no date — HR "
                          "confirms the date.")
        if not out["expires_on"]:
            return refuse(WORDS["noExpiry"])
        if out["how"].startswith("derived") and not (kinds and out["kind"] in kinds):
            return refuse(WORDS["noExpiry"])
    elif role == "issued":
        if credential_days:
            return refuse(WORDS["noRecordDay"])
        if not out["issued_on"]:
            return refuse(WORDS["noIssued"])
    facts = dict(p.get("facts") or {})
    facts.update(who=out["who"], person_source=out["person_source"], issued_on=out["issued_on"],
                 expires_on=out["expires_on"])
    out["confidence"] = confidence(facts, reading)
    floor = float(reading.get("floor") or 85)
    if out["confidence"] < floor:
        return refuse(f"The reading was not sure enough to take its dates ({out['confidence']} of the "
                      f"{int(floor)} needed).")
    out["state"] = "read"
    return out


def stored(reads: Any) -> dict[str, dict] | None:
    """Each paper's reading as the lane kept it, by ledger row id; None when the store does not answer."""
    def read() -> dict[str, dict] | None:
        try:
            got = reads.db.query(READS_SQL)
        except hubdb.Unreadable:
            return None
        return {rid: {"file_id": fid, "state": state, "reading": reading if isinstance(reading, dict) else {},
                      "error": error or "", "attempts": int(attempts or 0), "read_at": at}
                for rid, fid, state, reading, error, attempts, at in got}
    return reads.once("cert_reads:stored", read)


def _iso(v: Any) -> str:
    return v.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z") if isinstance(v, datetime) else _s(v)


def outcome(reads: Any, row: dict[str, Any], kept: dict | None, kind_words_of: dict[str, str]) -> dict[str, Any]:
    """complianceDocsReadRow_'s outcome for a row still to read, as ledger cells (readTabNormalized_ keys)."""
    import cert_docs as CD  # noqa: PLC0415 - cert_docs reads the ledger through staff, which lays this over it
    import staff as SP  # noqa: PLC0415
    req, req_read = None, True
    try:
        req = CD.req_of(reads, row.get("reqid"), row.get("cert"))
    except Exception:  # noqa: BLE001 - complianceDocsReqOf_ throwing: the requirement is not ruled out
        req_read = False
    v: dict[str, Any] | None = None
    if req_read and (not req or req_shut(req)):
        v = {"state": "unread", "why": WORDS["noReq"]}
    elif not SP.upload_out(row).get("file_id"):
        v = {"state": "unread", "why": WORDS["noFile"]}
    elif kept is None or kept["file_id"] != SP.upload_out(row).get("file_id") or kept["state"] == "pending":
        return {"readstate": "pending", "readwhy": WORDS["reading"]}
    elif kept["state"] == "failed":
        if kept["attempts"] < TRIES:
            return {"readstate": "pending", "readwhy": WORDS["again"], "readtries": str(kept["attempts"])}
        v = {"state": "unread", "why": f"The file could not be read after {kept['attempts']} tries — HR confirms the "
                                       "date from the document."}
    else:
        reading = kept["reading"]
        if (reading.get("paper") or {}).get("state") == "stray":
            v = {"state": "unread", "why": WORDS["stray"]}
        else:
            subject = SP.roster_id(row.get("rosterid")) or None
            if subject is None:
                got = CD.subject_row(reads, row.get("person"))
                if got is None:
                    return {"readstate": "pending", "readwhy": WORDS["again"]}
                subject = SP.roster_id(got.get("id")) if got else ""
            v = verdict(req, reading, subject, kind_words_of)
    reading = (kept or {}).get("reading") or {}
    return {"readstate": v["state"], "readkind": _s(v.get("kind")), "issuedon": day(v.get("issued_on")),
            "expireson": day(v.get("expires_on")), "readhow": _s(v.get("how")),
            "readconfidence": str(v["confidence"]) if v.get("confidence") else "", "readwhy": _s(v.get("why")),
            "readat": _iso((kept or {}).get("read_at")), "readv": _s(reading.get("v")),
            "readtries": str((kept or {}).get("attempts") or "")}


def overlay(reads: Any, rows: list[dict]) -> list[dict]:
    """The ledger with every paper still to read given its kept reading's verdict; a read or unread row stays."""
    import staff as SP  # noqa: PLC0415
    owed = [r for r in rows if _s(r.get("readstate")).lower() not in ("read", "unread")]
    if not owed:
        return rows
    kept = stored(reads) or {}
    out = []
    for r in rows:
        if _s(r.get("readstate")).lower() in ("read", "unread"):
            out.append(r)
        else:
            out.append({**r, **outcome(reads, r, kept.get(_s(r.get("id"))), SP.READ_KIND_WORDS)})
    return out
