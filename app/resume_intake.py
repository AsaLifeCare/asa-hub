"""A résumé's way in (ResumeIntake.gs, ResumeRubric.gs, ResumeInbox.gs) off asa-hub-db: the file kept on the server and
filed in the platform's Uploads folder as its own account (resumeStore, resumeParse), its words read and the identity
taken from them (resumeExtract — a scan's words come from the relay's OCR lane, app/resume_texts.py), the scorecard
asked of the model against the rubric document (resumeScorecardRun, and the card a résumé opens), the stored scorecard
(resumeAnalysisGet), and the watched résumé folders read (resumeInboxScan, resumeInboxImport). Every heavy half is a
read the relay asks first; its answer is sealed for its write (app/resume_intake_writes.py)."""
from __future__ import annotations

import base64
import binascii
import hashlib
import json
import os
import re
import threading
import time
from datetime import datetime, timezone
from typing import Any, Callable

import candidates as CND
import gsjs
import hubdb
import location_docs as LD
import locations as L
import onboarding as OB
import screening as SG
import staff_comms as SCM
from scope import Defer

s_ = gsjs.str_
DENIED = SG.DENIED
CID = SG.CID
MAX_BYTES = 15 * 1024 * 1024
OCTET = "application/octet-stream"
DIR = "resume_intake"
TEXT_CAP = 20000
EXTRACT_TTL_S = 600
# ResumeRubric.gs
RUBRIC_PROMPT_ID = "resume_analysis_v1"
RUBRIC_TTL_S = 1800
RUBRIC_RESUME_CAP = 18000
RUBRIC_RAW_CAP = 45000
RUBRIC_MAP = {
    "MonthsSinceLastExperience": "months_since_last_experience", "TotalYearsCaregiving": "total_years_caregiving",
    "AvgTenurePerJob": "avg_tenure_per_job", "HighestResponsibility": "highest_responsibility",
    "ScheduleAvailability": "schedule_availability", "NumDSPAgencies": "num_dsp_agencies",
    "ConsistencyInField": "consistency_in_field", "LeadershipRatio": "leadership_ratio",
    "SettingBalance": "setting_balance", "CareExperience": "care_experience",
    "ListedCertifications": "listed_certifications", "SkillsRating": "skills_rating", "CertsRating": "certs_rating",
    "ExperienceRating": "experience_rating", "JobHistoryRating": "job_history_rating",
    "CompositeScore": "composite_score", "RedFlagShortTenure": "red_flag_short_tenure",
    "RedFlagNoCerts": "red_flag_no_certs", "RedFlagStaleExperience": "red_flag_stale_experience",
    "Summary": "summary", "Zip": "zip", "Gender": "gender", "Languages": "languages", "FirstName": "first_name",
    "Phone": "phone", "Email": "email", "City": "city", "State": "state"}
# ResumeInbox.gs
INBOX_BATCH = 5
INBOX_MAX_PAGES = 3
INBOX_BUDGET_S = 70.0
INBOX_SCORE_UNTIL_S = 45.0
INBOX_TAB = "entity_resume_inbox"
INBOX_COLUMNS = ("file_id", "person_key", "person_name", "filename", "file_modified_at", "outcome", "reason",
                 "candidate_id", "text_chars", "read_at", "read_by")
INBOX_UNNAMED = re.compile(r"^(new\s*)?resume(\s*\d+)?$|^stna\s*resume$|^cv$", re.I)
EXTRA_FOLDERS = ("1YVyiaMAi4oJ5hUmYGdX1KmXZla6bwHR_",
                 "1igORZ8bHmXECSEFByu6eOdhFDCAfGHlkaaCNmTCrm5oGuJeBMLKPyk6R2ZWq_EKREG9oXjJ2")
OCR_PENDING = "the scan is being read by OCR"
_SAFE = re.compile(r"[^A-Za-z0-9._ -]+")
_FILE_ID = re.compile(r"^[A-Za-z0-9_-]{10,}$")
_EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}", re.A)
_PHONE = re.compile(r"(\+?1[\s.\-]?)?\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4}", re.A)
_NAME_WORD = re.compile(r"^[A-Za-zÀ-ÿ'.\-]+$")
_CITY_STATE = re.compile(r"([A-Za-z .]{2,30}),\s*([A-Z]{2})\b", re.A)


def blank_identity() -> dict[str, str]:
    return {"first_name": "", "last_name": "", "phone": "", "email": "", "city": "", "state": ""}


# ---- the identity a résumé names (hubParseResumeIdentity_) ---------------------------------------------------------

def identity(text: str) -> dict[str, str]:
    """Deterministic, never a model: the identity comes from the résumé, not the session."""
    out = blank_identity()
    m = _EMAIL.search(text)
    if m:
        out["email"] = m.group(0).lower()
    for pm in _PHONE.finditer(text):
        d = re.sub(r"^1", "", re.sub(r"[^\d]", "", pm.group(0), flags=re.A))
        if len(d) == 10 and d not in CND.SHARED_LINE_DIGITS:
            out["phone"] = d
            break
    lines = [ln.strip() for ln in re.split(r"\r?\n", text) if ln.strip()]
    for ln in lines[:8]:
        if "@" in ln or re.search(r"\d{3}", ln, re.A) or len(ln) > 48:
            continue
        words = re.split(r"\s+", ln)
        if 2 <= len(words) <= 4 and all(_NAME_WORD.match(w) for w in words):
            out["first_name"] = re.sub(r"[^A-Za-zÀ-ÿ'\-]", "", words[0])
            out["last_name"] = " ".join(words[1:])
            break
    for ln in lines[:15]:
        cs = _CITY_STATE.search(ln)
        if cs:
            out["city"], out["state"] = cs.group(1).strip(), cs.group(2)
            break
    return out


def complete(parsed: dict[str, str]) -> bool:
    return bool(parsed["first_name"] and parsed["last_name"] and parsed["phone"] and parsed["email"])


def intake_check(first: str, last: str, phone: str, email: str) -> str:
    """hubIntakeIdentityCheck_: '' when the card may be opened, else why not."""
    if not first or not last or not phone:
        return "First name, last name and phone are all required."
    if len(re.sub(r"\D", "", phone)) < 7:
        return "The phone needs at least 7 digits."
    if email and not re.match(r"^\S+@\S+\.\S+$", email):
        return "The e-mail does not look like an address."
    return ""


def find_duplicate(reads: L.Reads, d: str, email: str) -> dict[str, str] | None:
    """hubFindDuplicate_: a live card on the board with these digits or this address; an off-board one never."""
    if d and d in CND.SHARED_LINE_DIGITS:
        d = ""
    for c in CND.read_tab(reads, CND.TALENT_CANDIDATES_TAB):
        cid = s_(c.get("candidateid"))
        if not cid or cid in CND.TALENT_EXCLUDE_IDS or s_(c.get("archived")).lower() == "true":
            continue
        if not CND.stage_of(c.get("status")):
            continue
        cd = re.sub(r"^1", "", re.sub(r"\D", "", s_(c.get("phone"))))
        if cd in CND.SHARED_LINE_DIGITS:
            cd = ""
        if (d and cd == d) or (email and s_(c.get("email")).lower() == email):
            return {"id": cid, "name": s_(c.get("candidatename"))}
    return None


def file_id_of(url: Any) -> str:
    """rubricFileId_: the Drive id a link carries."""
    s = gsjs.or_blank(url)
    m = re.search(r"/d/([A-Za-z0-9_-]{20,})", s) or re.search(r"[?&]id=([A-Za-z0-9_-]{20,})", s)
    return m.group(1) if m else ""


# ---- the file kept on the server -----------------------------------------------------------------------------------

def _safe(v: str, n: int = 150) -> str:
    return _SAFE.sub("_", v)[:n].strip() or "file"


def keep(fid: str, name: str, mime: str, data: bytes, by: str) -> str:
    """The bytes on the server's disk beside what they are; the path under the documents root."""
    folder = LD.ROOT / DIR / _safe(fid, 80)
    folder.mkdir(parents=True, exist_ok=True)
    target = folder / _safe(name)
    tmp = target.with_name(target.name + ".part")
    tmp.write_bytes(data)
    os.replace(tmp, target)
    (folder / "meta.json").write_text(json.dumps({"name": name, "file": target.name, "mime": mime, "size": len(data),
                                                  "by": by, "at": gsjs.iso(datetime.now(timezone.utc))}),
                                      encoding="utf-8")
    return str(target.relative_to(LD.ROOT))


def kept(fid: str) -> tuple[bytes, dict] | None:
    """The server's copy of a file this door filed, with what it is; None when there is none."""
    if not _FILE_ID.match(fid or ""):
        return None
    folder = LD.ROOT / DIR / _safe(fid, 80)
    try:
        meta = json.loads((folder / "meta.json").read_text(encoding="utf-8"))
        return (folder / str(meta["file"])).read_bytes(), meta
    except (OSError, ValueError, KeyError):
        return None


def decoded(p: dict) -> tuple[bytes | None, str]:
    """hubDriveFileObj_'s bytes: none, empty or over 15MB is said."""
    b64 = s_(p.get("base64"))
    if not b64 or b64 == "kept":
        return None, "missing base64"
    try:
        data = base64.b64decode(b64, validate=False)
    except (binascii.Error, ValueError):
        return None, "missing base64"
    if not data or len(data) > MAX_BYTES:
        return None, "file empty or over 15MB"
    return data, ""


def store_file(sess: L.Session, p: dict, default_name: str) -> dict[str, Any]:
    """hubDriveFileObj_: the bytes filed in the platform's Uploads folder as its own account, every admin and the
    uploader given a reader seat (silently, each gated), and kept on the server; {id, url, shared, data, name, mime}."""
    data, why = decoded(p)
    if data is None:
        return {"refused": {"status": 400, "message": why}}
    name = s_(p.get("filename")) or default_name
    mime = s_(p.get("mime_type")) or OCTET
    reads, user = sess.reads, sess.user or {}
    drv = reads.need_drive()
    filed = drv.upload_into(OB.uploads_folder(reads, drv), name, mime, data)
    fid = s_(filed.get("id"))
    to_admins = SG.share_with_admins(reads, drv, fid)
    who = s_(user.get("email"))
    up = SG.grant_reader(reads, drv, fid, who) if who and "@" in who else {"ok": False, "skipped": True,
                                                                          "reason": "no address to grant"}
    keep(fid, name, mime, data, who)
    return {"id": fid, "url": "https://drive.google.com/file/d/" + fid + "/view", "data": data, "name": name,
            "mime": mime, "shared": {"admins": to_admins["shared"], "admins_total": to_admins["total"],
                                     "admins_failed": to_admins["failed"], "admins_held_why": to_admins["held_why"],
                                     "uploader": bool(up.get("ok")), "uploader_skipped": bool(up.get("skipped")),
                                     "uploader_held": bool(up.get("held")),
                                     "why": "" if up.get("ok") else s_(up.get("reason"))}}


# ---- the words of a résumé (hubExtractResumeText_) -----------------------------------------------------------------

class _Held:
    """The server's copy standing in for Drive where a reader asks a file's bytes."""

    def __init__(self, data: bytes) -> None:
        self.data = data

    def media(self, _fid: str, _cap: int) -> bytes:
        return self.data

    def export(self, _fid: str, _mime: str, _cap: int) -> bytes:
        raise Defer("a Google Doc is read from Drive, never from the server's copy")


def text_of(reads: L.Reads, fid: str, data: bytes | None = None, mime: str = "", candidate: str = "",
            modified: str = "") -> tuple[str, str]:
    """A résumé's words: a Google Doc's own text, a PDF's text layer, a Word file's paragraphs, plain text; a scan is
    owed to the relay's OCR lane and read from it once it has read it. ('', why) when there are none yet."""
    if data is None:
        held = kept(fid)
        if held is not None:
            data, mime = held[0], s_(held[1].get("mime"))
    if data is not None and not mime.startswith("application/vnd.google-apps."):
        meta = {"mimeType": mime}
        text, why = CND.resume_file_text(_Held(data), fid, meta)
    else:
        drv = reads.need_drive()
        meta = drv.file_meta(fid, fields="id,mimeType,modifiedTime,size,trashed")
        modified = s_(meta.get("modifiedTime"))
        text, why = CND.resume_file_text(drv, fid, meta)
    if text.strip():
        return text[:TEXT_CAP], ""
    if CND.resume_scan(meta, why):
        return CND.resume_scan_text(reads, fid, modified, candidate)
    return "", why or "the file held no text"


# ---- the rubric (ResumeRubric.gs) ----------------------------------------------------------------------------------

_RUBRIC: dict[str, Any] = {"at": 0.0, "text": ""}
_RUBRIC_LOCK = threading.Lock()


def rubric_prompt(reads: L.Reads) -> str:
    """rubricPrompt_: the rubric document's text, held half an hour; '' when it cannot be read."""
    with _RUBRIC_LOCK:
        if _RUBRIC["text"] and time.time() - _RUBRIC["at"] < RUBRIC_TTL_S:
            return _RUBRIC["text"]
    doc = gsjs.trim(reads.db.prop("RUBRIC_DOC_ID"))
    if not doc:
        return ""
    try:
        text = reads.need_drive().export(doc, "text/plain", 4 << 20).decode("utf-8", "replace")
    except (hubdb.Unreadable,):
        raise
    except Exception:  # noqa: BLE001 - as the .gs: an unreadable rubric is said by its caller
        text = ""
    if text:
        with _RUBRIC_LOCK:
            _RUBRIC.update(at=time.time(), text=text)
    return text


def rubric_hash(text: str) -> str:
    """rubricHash_: the first eight bytes of the rubric's MD5, in hex."""
    return hashlib.md5(text.encode("utf-8")).hexdigest()[:16] if text else ""  # noqa: S324 - a fingerprint


def rubric_num(v: Any) -> float | None:
    """rubricNum_: parseFloat of the value with everything but digits, dots and minus taken out."""
    return CND.js_parse_float(re.sub(r"[^0-9.\-]", "", "" if v is None else gsjs.js_str(v)))


def rubric_composite(obj: dict) -> float | None:
    """rubricComposite_: computed here from the four ratings, never taken from the model."""
    s, e = rubric_num(obj.get("SkillsRating")), rubric_num(obj.get("ExperienceRating"))
    j, c = rubric_num(obj.get("JobHistoryRating")), rubric_num(obj.get("CertsRating"))
    if s is None or e is None or j is None or c is None:
        return None
    return gsjs.js_round((s * 1.5 + e * 1.5 + j * 1.0 + c * 0.5) * 10) / 10


def rubric_analyze(reads: L.Reads, text: str, deadline: float) -> dict[str, Any]:
    """rubricAnalyze_: the résumé read against the rubric by the model; the recommendation kept, never written as the
    decision (only a person moves a candidate out of New)."""
    out: dict[str, Any] = {"fields": {}, "raw": "", "status": "", "error": "", "promptId": RUBRIC_PROMPT_ID,
                           "hash": "", "recommendation": ""}
    if not s_(text):
        out["status"] = "no résumé text"
        return out
    prompt = rubric_prompt(reads)
    if not prompt:
        out["status"] = "rubric doc unreadable"
        return out
    out["hash"] = rubric_hash(prompt)
    wrapped = SG.prompt_text(reads, "ai_resume_rubric_wrap").replace(
        "{resume}", SG.js_slice(text, RUBRIC_RESUME_CAP)).replace("{rubric}", prompt)
    chat = SG.ai(reads, wrapped, 0.1, "ai_resume_rubric", deadline) if wrapped else \
        {"ok": False, "error": "prompt_cell_empty"}
    if not chat.get("ok"):
        out["status"] = "no provider"
        out["error"] = s_(chat.get("error"))
        return out
    out["raw"] = SG.js_slice(gsjs.or_text(chat.get("content")), RUBRIC_RAW_CAP)
    obj = SG.parsed(chat.get("content"))
    if not isinstance(obj, dict):
        out["status"] = "reply was not JSON"
        return out
    for key, col in RUBRIC_MAP.items():
        v = obj.get(key)
        if v is None or gsjs.js_str(v) == "":
            continue
        out["fields"][col] = gsjs.js_str(v)
    mine = rubric_composite(obj)
    if mine is not None:
        theirs = rubric_num(obj.get("CompositeScore"))
        out["fields"]["composite_score"] = gsjs.num_str(mine)
        if theirs is not None and abs(theirs - mine) > 0.05:
            out["error"] = ("composite recomputed: the reply said " + gsjs.num_str(theirs) + ", the weights give "
                            + gsjs.num_str(mine))
    out["recommendation"] = s_(obj.get("DecisionStatus"))
    out["status"] = "ok"
    return out


def rubric_row(reads: L.Reads, cid: str, analysis: dict, by: str, source: str, now: str) -> dict[str, str]:
    """rubricWrite_'s row: the scorecard, when and against which rubric it was read."""
    doc = gsjs.trim(reads.db.prop("RUBRIC_DOC_ID"))
    row = {"candidate_id": cid, **{k: s_(v) for k, v in (analysis.get("fields") or {}).items()},
           "analyzed_at": now, "created_at": now, "updated_at": now, "created_by": "asa-hub-rubric:" + by,
           "prompt_id": RUBRIC_PROMPT_ID, "prompt_doc_id": doc,
           "prompt_doc_url": "https://docs.google.com/document/d/" + doc + "/edit",
           "prompt_content_hash": s_(analysis.get("hash")), "prompt_last_fetched_at": now,
           "prompt_parse_status": s_(analysis.get("status")), "prompt_error": s_(analysis.get("error")),
           "raw_prompt_output_json": s_(analysis.get("raw"))}
    if source:
        row["source_asset_id"] = source
    return row


def composite_of(analysis: dict) -> float | None:
    return CND.js_parse_float((analysis.get("fields") or {}).get("composite_score"))


def rubric_ensure(reads: L.Reads, cid: str, file_id: str, deadline: float, cand: dict | None = None,
                  link: str = "") -> dict[str, Any]:
    """rubricEnsureForCandidate_ before its write: never a gate — a failure says its reason and hiring walks on. The
    scorecard to keep is under `analysis` (with the file it was read from) when one was read."""
    if not CID.match(s_(cid)):
        return {"scored": False, "reason": "invalid candidate_id"}
    if cand is None:
        cand = next((c for c in CND.read_tab(reads, CND.TALENT_CANDIDATES_TAB) if s_(c.get("candidateid")) == cid),
                    None)
        if cand is None:
            return {"scored": False, "reason": "no such candidate"}
    link = link or s_(cand.get("resumelink"))
    fid = s_(file_id) or file_id_of(link)
    if not fid:
        return {"scored": False, "reason": "the resume link carries no Drive file id" if link else "no resume on file"}
    last = (CND.evidence(reads, cid).get("analysis") or {})
    if s_(last.get("compositescore")):
        have = CND.js_parse_float(last.get("compositescore"))
        return {"scored": True, "reason": "already scored", "composite": have}
    try:
        text, why = text_of(reads, fid, candidate=cid)
    except (hubdb.Unreadable,):
        raise
    except Exception as e:  # noqa: BLE001 - as the .gs: the reading that throws says so
        return {"scored": False, "reason": "extract threw: " + str(e)[:160]}
    if not text:
        return {"scored": False, "reason": why or "the resume held no readable text"}
    analysis = rubric_analyze(reads, text, deadline)
    if analysis["status"] != "ok":
        return {"scored": False, "reason": analysis["status"] + (" — " + analysis["error"] if analysis["error"] else "")}
    return {"scored": True, "reason": "ok", "composite": composite_of(analysis), "analysis": analysis, "fid": fid}


def soft_rubric(read: Callable[[], dict[str, Any]]) -> dict[str, Any]:
    """The nota can wait: a scorecard that could not be read never costs the card or its link."""
    try:
        return read()
    except hubdb.Unreadable:
        raise
    except Exception as e:  # noqa: BLE001 - said as its reason
        return {"scored": False, "reason": "the scorecard could not be read just now (" + str(e)[:120] + ")"}


# ---- the doors ------------------------------------------------------------------------------------------------------

def store_prepare(sess: L.Session, payload: dict) -> dict[str, Any]:
    """resumeStore's heavy half: the PDF filed and kept, answered fast; resumeExtract reads it."""
    if not SG.writer(sess.user):
        return dict(DENIED)
    p = payload if isinstance(payload, dict) else {}
    got = store_file(sess, p, "resume.pdf")
    if got.get("refused"):
        return got["refused"]
    return {"status": 200, "data": SG.seal("resumeStore", SG.actor(sess.user), {
        "file_id": got["id"], "resume_link": got["url"], "filename": s_(p.get("filename")) or "resume.pdf"})}


def parse_prepare(sess: L.Session, payload: dict) -> dict[str, Any]:
    """resumeParse's heavy half: the file filed and kept, its words read, and what of the identity is missing."""
    if not SG.writer(sess.user):
        return dict(DENIED)
    p = payload if isinstance(payload, dict) else {}
    got = store_file(sess, p, "resume.pdf")
    if got.get("refused"):
        return got["refused"]
    text, _why = text_of(sess.reads, got["id"], got["data"], got["mime"])
    parsed = identity(text) if text else blank_identity()
    return {"status": 200, "data": SG.seal("resumeParse", SG.actor(sess.user), {
        "resume_link": got["url"], "filename": s_(p.get("filename")) or "resume.pdf", "extracted": bool(text),
        "complete": complete(parsed), "parsed": parsed})}


_EXTRACTED: dict[str, tuple[float, dict]] = {}
_EXTRACTED_LOCK = threading.Lock()


def extract(sess: L.Session, payload: dict) -> dict[str, Any]:
    """resumeExtract: the file's words and the identity they name, held per file; a scan the OCR lane has not read
    yet answers `working`, so the form polls again."""
    reads = sess.reads
    if not SG.writer(sess.user):
        return dict(DENIED)
    fid = s_((payload or {}).get("file_id"))
    if not fid:
        return {"status": 400, "message": SG.strings(reads, "refuse.resume.file_id")}
    with _EXTRACTED_LOCK:
        held = _EXTRACTED.get(fid)
        if held and time.time() - held[0] < EXTRACT_TTL_S:
            return {"status": 200, "data": dict(held[1])}
    try:
        text, why = text_of(reads, fid)
    except (hubdb.Unreadable,):
        raise
    except Exception:  # noqa: BLE001 - as the .gs: a reading that throws is read as empty
        text, why = "", ""
    if not text and why == OCR_PENDING:
        return {"status": 200, "data": {"working": True}}
    parsed = identity(text) if text else blank_identity()
    out = {"working": False, "extracted": bool(text), "complete": complete(parsed), "parsed": parsed}
    with _EXTRACTED_LOCK:
        _EXTRACTED[fid] = (time.time(), out)
    return {"status": 200, "data": out}


def attach_prepare(sess: L.Session, payload: dict) -> dict[str, Any]:
    """resumeAttach's scorecard, asked before the link is written (the score can wait; the link cannot)."""
    reads = sess.reads
    if not SG.writer(sess.user):
        return dict(DENIED)
    p = payload if isinstance(payload, dict) else {}
    cid, link = s_(p.get("candidate_id")), s_(p.get("resume_link"))
    if not CID.match(cid) or not link:
        return {"status": 400, "message": SG.strings(reads, "refuse.resume.attach_args")}
    cand = next((c for c in CND.read_tab(reads, CND.TALENT_CANDIDATES_TAB) if s_(c.get("candidateid")) == cid), None)
    rubric = None
    if cand is not None:
        rubric = soft_rubric(lambda: rubric_ensure(reads, cid, file_id_of(link), time.monotonic() + SG.PREPARE_BUDGET_S,
                                                   cand=cand, link=s_(cand.get("resumelink")) or link))
    return {"status": 200, "data": SG.seal("resumeAttach", SG.actor(sess.user), {"cid": cid, "link": link,
                                                                                 "rubric": rubric})}


def commit_prepare(sess: L.Session, payload: dict) -> dict[str, Any]:
    """resumeIntakeCommit's scorecard: the résumé read against the rubric before its card is opened."""
    reads = sess.reads
    if not SG.writer(sess.user):
        return dict(DENIED)
    p = payload if isinstance(payload, dict) else {}
    first, last, phone = s_(p.get("first_name")), s_(p.get("last_name")), s_(p.get("phone"))
    email, link = s_(p.get("email")).lower(), s_(p.get("resume_link"))
    rubric = None
    if not intake_check(first, last, phone, email) and \
            not find_duplicate(reads, re.sub(r"^1", "", re.sub(r"\D", "", phone)), email):
        fid = s_(p.get("file_id")) or file_id_of(link)
        if fid:
            deadline = time.monotonic() + SG.PREPARE_BUDGET_S

            def read() -> dict[str, Any]:
                text, why = text_of(reads, fid)
                if not text:
                    return {"scored": False, "reason": why or "the resume held no readable text"}
                a = rubric_analyze(reads, text, deadline)
                if a["status"] != "ok":
                    return {"scored": False, "reason": a["status"] + (" — " + a["error"] if a["error"] else "")}
                return {"scored": True, "reason": "ok", "composite": composite_of(a), "analysis": a, "fid": fid}
            rubric = soft_rubric(read)
    return {"status": 200, "data": SG.seal("resumeIntakeCommit", SG.actor(sess.user), {"rubric": rubric})}


def analysis_get(sess: L.Session, payload: dict) -> dict[str, Any]:
    """resumeAnalysisGet: the scored analysis (the upload stub never shadows it)."""
    if not SG.writer(sess.user):
        return dict(DENIED)
    cid = s_((payload or {}).get("candidate_id"))
    if not cid:
        return {"status": 400, "message": "Missing required parameter: candidate_id."}
    if not CID.match(cid):
        return {"status": 400, "message": "invalid candidate_id"}
    last = None
    for a in CND.read_tab(sess.reads, CND.TALENT_RESUME_TAB):
        if s_(a.get("candidateid")) == cid and s_(a.get("compositescore")):
            last = a
    if last is None:
        return {"status": 200, "data": {"found": False}}

    def num(v: Any) -> float | None:
        return CND.js_parse_float(s_(v))

    def flag(v: Any) -> bool:
        return s_(v).lower() in ("true", "yes", "y", "1")
    g = (lambda k: s_(last.get(k)))
    return {"status": 200, "data": {"found": True, "analysis": {
        "composite": num(last.get("compositescore")),
        "ratings": {"skills": num(last.get("skillsrating")), "certs": num(last.get("certsrating")),
                    "experience": num(last.get("experiencerating")), "job_history": num(last.get("jobhistoryrating"))},
        "red_flags": {"short_tenure": flag(last.get("redflagshorttenure")), "no_certs": flag(last.get("redflagnocerts")),
                      "stale_experience": flag(last.get("redflagstaleexperience"))},
        "total_years_caregiving": g("totalyearscaregiving"), "avg_tenure_per_job": g("avgtenureperjob"),
        "months_since_last_experience": g("monthssincelastexperience"),
        "highest_responsibility": g("highestresponsibility"), "schedule_availability": g("scheduleavailability"),
        "num_dsp_agencies": g("numdspagencies"), "consistency_in_field": g("consistencyinfield"),
        "setting_balance": g("settingbalance"), "care_experience": g("careexperience"),
        "listed_certifications": g("listedcertifications"), "languages": g("languages"), "summary": g("summary"),
        "analyzed_at": g("analyzedat")}}}


def scorecard_prepare(sess: L.Session, payload: dict) -> dict[str, Any]:
    """resumeScorecardRun's reading: the scorecard asked of the model, when none is on file."""
    if not SG.writer(sess.user):
        return dict(DENIED)
    p = payload if isinstance(payload, dict) else {}
    cid = s_(p.get("candidate_id"))
    if not cid:
        return {"status": 400, "message": "Missing required parameter: candidate_id."}
    out = rubric_ensure(sess.reads, cid, s_(p.get("file_id")), time.monotonic() + SG.PREPARE_BUDGET_S)
    return {"status": 200, "data": SG.seal("resumeScorecardRun", SG.actor(sess.user), {"cid": cid, "out": out})}


# ---- the watched folders (ResumeInbox.gs) --------------------------------------------------------------------------

def inbox_name(filename: Any) -> str:
    """resumeInboxName_: the file's name without its kind or the uploader's stamp."""
    n = gsjs.or_blank(filename)
    n = re.sub(r"\.(pdf|docx?|rtf|txt)$", "", n, flags=re.I)
    n = re.sub(r"_\d{8}_\d{6}$", "", n)
    return re.sub(r"\s+", " ", re.sub(r"[_.]+", " ", n)).strip()


def inbox_key(name: Any) -> str:
    """resumeInboxKey_ (the résumé inbox and the CJIS folder key one person one way)."""
    return re.sub(r"[^a-z]", "", gsjs.or_blank(name).lower())


def inbox_folders(reads: L.Reads) -> list[str]:
    """resumeInboxFolders_: the inbox, then RESUME_EXTRA_FOLDERS (or the shipped pair)."""
    out: list[str] = []
    main = gsjs.trim(reads.db.prop("RESUME_INBOX_FOLDER_ID"))
    if main:
        out.append(main)
    extra = gsjs.trim(reads.db.prop("RESUME_EXTRA_FOLDERS"))
    for fid in (extra.split(",") if extra else EXTRA_FOLDERS):
        fid = fid.strip()
        if fid and fid not in out:
            out.append(fid)
    return out


def folder_files(reads: L.Reads, folders: list[str], max_pages: int) -> dict[str, Any]:
    """Each watched folder's files, one unreadable folder said while the others answer; every folder refusing is
    the only hard error."""
    drv = reads.need_drive()
    files: list[dict] = []
    unreadable: list[dict] = []
    read_one = 0
    truncated = False
    for folder in folders:
        try:
            got = drv.children(folder, False, "id,name,modifiedTime,mimeType", 1000 * max_pages)
        except Exception as e:  # noqa: BLE001 - one folder Drive refuses is said, never fatal alone
            code = getattr(e, "code", 0)
            m = re.search(r"\((\d{3})", str(e))
            unreadable.append({"folder": folder, "http": int(code or (m.group(1) if m else 0) or 0)})
            continue
        if len(got) >= 1000 * max_pages:
            truncated = True
        files.extend(got)
        read_one += 1
    return {"files": files, "unreadable": unreadable, "read": read_one, "truncated": truncated}


def inbox_files(reads: L.Reads) -> dict[str, Any]:
    """resumeInboxFiles_: one entry per person (the folders are flooded with copies), the newest copy wins."""
    folders = inbox_folders(reads)
    got = folder_files(reads, folders, INBOX_MAX_PAGES)
    if not got["read"]:
        return {"error": f"None of the {len(folders)} watched resume folder(s) could be read (HTTP "
                         + ", ".join(str(u["http"]) for u in got["unreadable"]) + "). Nothing was imported."}
    by: dict[str, dict] = {}
    for f in got["files"]:
        name = inbox_name(f.get("name"))
        key = inbox_key(name)
        if not key:
            continue
        if key not in by:
            by[key] = {"name": name, "key": key, "fileId": s_(f.get("id")), "filename": s_(f.get("name")),
                       "modifiedTime": s_(f.get("modifiedTime")), "mimeType": s_(f.get("mimeType")), "copies": 1,
                       "unnamed": bool(INBOX_UNNAMED.search(name))}
        else:
            by[key]["copies"] += 1
            if s_(f.get("modifiedTime")) > by[key]["modifiedTime"]:
                by[key].update(fileId=s_(f.get("id")), filename=s_(f.get("name")),
                               modifiedTime=s_(f.get("modifiedTime")), mimeType=s_(f.get("mimeType")))
    people = sorted(by.values(), key=lambda p: p["modifiedTime"], reverse=True)
    return {"people": people, "filesSeen": len(got["files"]), "truncated": got["truncated"],
            "foldersRead": got["read"], "unreadable": got["unreadable"]}


def inbox_known(reads: L.Reads) -> dict[str, dict]:
    """resumeInboxKnown_: who the board or the roster already holds, by name."""
    known: dict[str, dict] = {}

    def board_rows() -> list[dict]:
        try:
            return reads.hub_rows("candidates")
        except Defer:
            return CND.read_tab(reads, "candidates")
    rows, _why = CND.soft(board_rows)
    for c in rows or []:
        k = inbox_key(c.get("candidate_name") or c.get("candidatename") or c.get("name"))
        if k:
            known[k] = {"where": "board", "status": s_(c.get("status"))}
    rows, _why = CND.soft(lambda: CND.read_tab(reads, CND.TALENT_CANDIDATES_TAB))
    for c in rows or []:
        k = inbox_key(c.get("candidatename"))
        if k and k not in known:
            known[k] = {"where": "board", "status": s_(c.get("status"))}
    try:
        rows, _why = CND.soft(lambda: reads.hub_rows("people"))
    except Defer:
        rows = []
    for p in rows or []:
        k = inbox_key(p.get("name"))
        if k and k not in known:
            known[k] = {"where": "roster", "status": s_(p.get("status"))}
    return known


def inbox_ledger(reads: L.Reads) -> dict[str, dict]:
    """resumeInboxLedger_: the latest reading of each person."""
    by: dict[str, dict] = {}
    rows, why = CND.soft(lambda: CND.read_tab(reads, INBOX_TAB))
    if why:
        return {}
    for r in rows or []:
        k = s_(r.get("personkey"))
        if not k:
            continue
        prev = by.get(k)
        if prev is None or s_(r.get("readat")) >= s_(prev.get("readat")):
            by[k] = r
    return by


def inbox_scan(sess: L.Session, payload: dict) -> dict[str, Any]:
    """resumeInboxScan: what the watched folders hold that the board does not — what was read before stays listed,
    since the ones that never became cards are exactly what a person must see."""
    reads = sess.reads
    if not SG.writer(sess.user):
        return dict(DENIED)
    got = inbox_files(reads)
    if got.get("error"):
        return {"status": 503, "message": got["error"]}
    known, ledger = inbox_known(reads), inbox_ledger(reads)
    fresh, seen_before, unnamed, read_before = [], [], [], []
    for p in got["people"]:
        row: dict[str, Any] = {"name": p["name"], "fileId": p["fileId"], "filename": p["filename"],
                               "modifiedTime": p["modifiedTime"], "copies": p["copies"]}
        if p["unnamed"]:
            unnamed.append(row)
            continue
        past = ledger.get(p["key"])
        if past is not None:
            row.update(outcome=s_(past.get("outcome")), reason=s_(past.get("reason")), readAt=s_(past.get("readat")),
                       candidateId=s_(past.get("candidateid")))
            read_before.append(row)
            continue
        hit = known.get(p["key"])
        if hit:
            row.update(knownIn=hit["where"], status=hit["status"])
            seen_before.append(row)
            continue
        try:
            filed = SCM._staff_docs_for(reads, p["name"])
        except hubdb.Unreadable:
            raise
        except Exception:  # noqa: BLE001 - as the .gs: papers that cannot be read name none
            filed = None
        if filed and filed.get("docs"):
            row["docsOnFile"] = len(filed["docs"])
            row["docTypes"] = ", ".join(s_(d.get("type")) for d in filed["docs"])
        fresh.append(row)
    if fresh:
        message = (f"{len(fresh)} new résumé(s) waiting. {len(seen_before)} already on the board or the roster"
                   + (f", {len(read_before)} read before" if read_before else "")
                   + (f", {len(unnamed)} file(s) name nobody" if unnamed else "") + ".")
    else:
        message = ("Nothing new in the folder." + (f" {len(read_before)} were read on an earlier press."
                                                   if read_before else "")
                   + (f" (The scan stopped after {got['filesSeen']} files.)" if got["truncated"] else ""))
    return {"status": 200, "data": {"fresh": fresh, "alreadyKnown": seen_before, "unnamed": unnamed,
                                    "readBefore": read_before, "filesSeen": got["filesSeen"],
                                    "foldersRead": got["foldersRead"], "unreadable": got["unreadable"],
                                    "truncated": bool(got["truncated"]), "batch": INBOX_BATCH, "message": message}}


def import_prepare(sess: L.Session, payload: dict) -> dict[str, Any]:
    """resumeInboxImport's reading: the picks (an explicit pick overrules the ledger), each read, its identity taken
    and — while the pass has time — scored; a scan the OCR lane has not read yet waits for the next press."""
    reads = sess.reads
    if not SG.writer(sess.user):
        return dict(DENIED)
    p = payload if isinstance(payload, dict) else {}
    n = CND.js_number(p.get("limit"))
    limit = max(1, min(int(n) if n == n and n else INBOX_BATCH, 10))
    started = time.monotonic()
    got = inbox_files(reads)
    if got.get("error"):
        return {"status": 503, "message": got["error"]}
    known, ledger = inbox_known(reads), inbox_ledger(reads)
    wanted = s_(p.get("fileIds"))
    picks = []
    for person in got["people"]:
        if len(picks) >= limit:
            break
        if person["unnamed"]:
            continue
        if wanted:
            if person["fileId"] in wanted:
                picks.append(person)
            continue
        if person["key"] not in known and person["key"] not in ledger:
            picks.append(person)
    read: list[dict] = []
    ran_out = 0
    for person in picks:
        if time.monotonic() - started > INBOX_BUDGET_S:
            ran_out += 1
            continue
        try:
            text, why = text_of(reads, person["fileId"], modified=person["modifiedTime"])
        except (hubdb.Unreadable,):
            raise
        except Exception as e:  # noqa: BLE001 - the file that cannot be read is said
            text, why = "", str(e)[:160]
        entry: dict[str, Any] = {"p": person, "chars": len(text)}
        if not text:
            if why == OCR_PENDING:
                entry.update(skip=person["name"] + " — " + OCR_PENDING + "; press again in a few minutes", ledger="")
                read.append(entry)
                continue
            why_text = (why or "the file could not be read as text") + \
                (" [" + person["mimeType"] + "]" if person["mimeType"] else "")
            entry.update(skip=why_text, ledger="unreadable")
            read.append(entry)
            continue
        parsed = identity(text)
        first, last = parsed["first_name"], parsed["last_name"]
        if not first or not last:
            parts = re.split(r"\s+", person["name"])
            if len(parts) >= 2:
                first, last = first or parts[0], last or parts[-1]
        if len(re.sub(r"\D", "", parsed["phone"])) < 7:
            entry.update(skip="no usable phone number in the résumé — a card without one cannot be de-duplicated or "
                              "contact-guarded", ledger="no contact")
            read.append(entry)
            continue
        scored: dict[str, Any] = {"fields": {}, "status": "not attempted", "error": "", "raw": "", "hash": "",
                                  "recommendation": ""}
        if time.monotonic() - started > INBOX_SCORE_UNTIL_S:
            scored["status"] = "not scored — the pass was running out of time"
        else:
            try:
                scored = rubric_analyze(reads, text, started + SG.PREPARE_BUDGET_S)
            except (hubdb.Unreadable, Defer):
                raise
            except Exception as e:  # noqa: BLE001 - as the .gs
                scored = {**scored, "status": "rubric threw", "error": str(e)[:160]}
        entry.update(commit={"first_name": first, "last_name": last, "phone": parsed["phone"],
                             "email": parsed["email"], "city": parsed["city"] or s_(scored["fields"].get("city")),
                             "state": parsed["state"] or s_(scored["fields"].get("state")),
                             "resume_link": "https://drive.google.com/file/d/" + person["fileId"] + "/view",
                             "filename": person["filename"], "file_id": person["fileId"]}, scored=scored)
        read.append(entry)
    return {"status": 200, "data": SG.seal("resumeInboxImport", SG.actor(sess.user), {
        "picks": len(picks), "read": read, "ran_out": ran_out, "seconds": round(time.monotonic() - started)})}


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {
    "resumeExtract": extract, "resumeAnalysisGet": analysis_get, "resumeInboxScan": inbox_scan,
    "resumeStorePrepare": store_prepare, "resumeParsePrepare": parse_prepare, "resumeAttachPrepare": attach_prepare,
    "resumeIntakeCommitPrepare": commit_prepare, "resumeScorecardRunPrepare": scorecard_prepare,
    "resumeInboxImportPrepare": import_prepare}
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
