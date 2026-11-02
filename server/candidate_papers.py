"""STAFF CANDIDATES' PAPERS — READ HERE AND FILED IN DRIVE AS THE PLATFORM'S OWN ACCOUNT, NEVER BY APPS SCRIPT.
asa-hub-app plans a press on a Hiring record (candidatePaperPlan), gives the verdict on the reading
(candidatePaperDecide) and keeps every record (candidatePaperKeep). This side reads the paper's words (Tesseract, then
the decoder's reading in digest_engine), files it in Drive as asatech through cert_papers' Drive-only token, lets the
admins and the uploader read an uploads-folder file in silence, places a résumé's shortcuts beside the Hiring table and
asks the platform's model for a résumé's scorecard (ResumeRubric.gs)."""
from __future__ import annotations

import base64
import binascii
import hashlib
import json
import logging
import math
import os
import re
import sys
import tempfile
import threading
import time
from pathlib import Path
from typing import Any

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import cert_papers as CP  # noqa: E402 — the platform account's Drive and its folder lookups

log = logging.getLogger("hub.candidate_papers")

FOLDER_MIME = CP.FOLDER_MIME
SHORTCUT_MIME = "application/vnd.google-apps.shortcut"
GRANT_ATTEMPTS = 3
GRANT_RETRY_S = 0.8
# CandidateProfiles.gs CND_PAPER_UNNAMED: what a paper is comes from its own words, never from what the file is called
UNNAMED = "-"
NAME_MATCH_MIN = 0.86
EXT_OF = {"application/pdf": ".pdf", "image/png": ".png", "image/jpeg": ".jpg", "image/gif": ".gif",
          "image/webp": ".webp", "image/heic": ".heic", "image/heif": ".heif", "application/msword": ".doc",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx"}
# ResumeRubric.gs
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
RUBRIC_TEXT_MAX = 18000
RUBRIC_RAW_MAX = 45000
RUBRIC_HOLD_S = 1800.0
ASK_TIMEOUT_S = float(os.getenv("HUB_RESUME_SCORE_ASK_S", "60"))
_RUBRIC: dict[str, Any] = {}
_RUBRIC_LOCK = threading.Lock()


class Refused(ValueError):
    """The paper itself is refused (a 400), in the door's words; nothing was filed."""


# ---- the bytes and their words -------------------------------------------------------------------------------------

def decode(b64: str, max_bytes: int) -> bytes:
    """docUpload's own checks of the bytes: attached, not empty, not over 15MB."""
    if not b64:
        raise Refused("No file attached")
    try:
        data = base64.b64decode(b64, validate=False)
    except (binascii.Error, ValueError):
        raise Refused("The file could not be read as sent. Nothing was written.") from None
    if not data:
        raise Refused("The file is empty")
    if len(data) > max_bytes:
        raise Refused("The file is over 15MB")
    return data


def words(data: bytes, name: str, mime: str) -> str:
    """The paper's words: its own where it has them, Tesseract where it is a scan (the relay's reader)."""
    import form_digest as fd  # noqa: PLC0415 — the relay's reader, loaded with the lane
    ext = Path(name).suffix.lower() or EXT_OF.get(mime, "")
    handle, path = tempfile.mkstemp(suffix=ext, prefix="cnd_")
    try:
        with os.fdopen(handle, "wb") as fh:
            fh.write(data)
        if fd.digest_kind(path) in ("unsupported", "unknown"):
            raise RuntimeError(f"a {ext or 'file'} of this kind cannot be read")
        return re.sub(r"\n{3,}", "\n\n", (fd.extract_text(path) or "").replace("\x00", "")).strip()
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass


def named_in(text: str, seen: str, who: str) -> str:
    """cndNamedIn_: 'match' when the paper prints the first and last name together, 'other' when the name it prints
    is someone else's, 'unread' when it prints none."""
    import daily_notes as DN  # noqa: PLC0415 — the relay's own port of the name matcher
    t = DN.name_tokens(who)["all"]
    if len(t) >= 2:
        first, last = t[0], t[-1]
        hay = " " + DN.name_norm(text) + " "
        if re.search(" " + first + "(?: [a-z0-9]{1,20}){0,2} " + last + " | " + last + " " + first + " ", hay):
            return "match"
    if not str(seen or "").strip():
        return "unread"
    return "match" if DN.name_score(seen, who) >= NAME_MATCH_MIN else "other"


def check_result(text: str, book: Any) -> str:
    """cndCheckResult_: one line that reads a record outweighs any line that reads clear."""
    import digest_engine as DE  # noqa: PLC0415
    for line in re.split(r"\n+", str(text or "")):
        if DE.check_result(line, book).get("result") == "records":
            return "records"
    return str(DE.check_result(text, book).get("result") or "")


def kinds_seen(text: str, kinds: list[str], book: Any) -> dict[str, bool]:
    """cndKindsSeen_: which of the kinds the paper's own words carry a word of, under the words book."""
    import digest_engine as DE  # noqa: PLC0415
    body = DE.plain_dashes(str(text or "")[:DE.SCAN_CAP].lower())
    seen: dict[str, bool] = {}
    for row in DE.kinds(book):
        if row[0] not in kinds:
            continue
        if any(n and str(n) in body for n in (row[2] or [])):
            seen[row[0]] = True
    return seen


def read_paper(plan: dict[str, Any], data: bytes) -> tuple[dict[str, Any], str]:
    """cndPaperRead_: the decoder's reading of the paper under the step's kinds, the name it carries, a background
    check's result and whether it is the whole packet. (the reading, the words)"""
    import digest_engine as DE  # noqa: PLC0415
    file = plan["file"]

    def unread(paper: dict[str, Any]) -> tuple[dict[str, Any], str]:
        return {"paper": paper, "named": "unread", "result": "", "packet": False}, ""
    if re.match(r"^image/hei[cf]$", str(file["mime"])):
        return unread({"state": "heic", "chars": 0})
    try:
        text = words(data, file["name"], file["mime"])
    except Exception as exc:  # noqa: BLE001 — the type only: a message may carry the paper's words
        return unread({"state": "error", "chars": 0, "why": str(exc)[:160] if isinstance(exc, RuntimeError)
                       else f"the reader stopped ({type(exc).__name__})"})
    book = DE.cert_book(DE.book(plan.get("vocab")), list(plan.get("kinds") or []))
    paper = DE.paper_from_text(text, UNNAMED, str(plan.get("today") or ""), book, None)
    shows = [list(g) for g in plan.get("packet_shows") or []]
    whole = plan.get("packet_whole") is True
    seen = kinds_seen(text, [k for g in shows for k in g], book) if whole else {}
    redacted = DE.redact(text, paper.get("kind") or "", book).get("text") or ""
    out = {"paper": {k: paper.get(k) for k in ("state", "chars", "kind", "kind_score", "kind_alt", "issued_on",
                                               "expires_on", "person_seen", "why")},
           "named": named_in(redacted, paper.get("person_seen") or "", str(plan.get("who") or "")),
           "result": check_result(redacted, book) if paper.get("kind") == "background_check" else "",
           "packet": whole and all(any(seen.get(k) is True for k in g) for g in shows)}
    return out, text


# ---- Drive, as asatech ---------------------------------------------------------------------------------------------

def _alive_folder(drive: Any, fid: str) -> bool:
    if not fid:
        return False
    try:
        got = drive.files().get(fileId=fid, fields="id,mimeType,trashed", supportsAllDrives=True).execute()
    except Exception:  # noqa: BLE001 — a folder that cannot be opened is not the folder
        return False
    return got.get("mimeType") == FOLDER_MIME and not got.get("trashed")


def _home(drive: Any, spot: dict[str, Any]) -> tuple[str, bool]:
    """filesCandidateFolder_ / filesUploadsFolder_: the folder the paper goes in, and whether it was made now."""
    with CP._FOLDER_LOCK:
        if spot["where"] == "candidate":
            if _alive_folder(drive, str(spot.get("folder_id") or "")):
                return str(spot["folder_id"]), False
            docs = str(spot.get("parent_id") or "")
            if not _alive_folder(drive, docs):
                docs = CP.child_folder(drive, str(spot["root"]), str(spot["parent_name"]))
            return CP.child_folder(drive, docs, str(spot["folder_name"])), True
        if _alive_folder(drive, str(spot.get("folder_id") or "")):
            return str(spot["folder_id"]), False
        return CP.child_folder(drive, str(spot["root"]), str(spot["parent_name"])), False


def grant_reader(drive: Any, file_id: str, who: str) -> bool:
    """hubGrantReader_: reader access granted in silence (Google sends no letter), tried again on a refusal Drive takes
    back on its own; a refusal that stands is said."""
    why = ""
    for attempt in range(1, GRANT_ATTEMPTS + 1):
        try:
            drive.permissions().create(fileId=file_id, body={"role": "reader", "type": "user", "emailAddress": who},
                                       sendNotificationEmail=False, supportsAllDrives=True, fields="id").execute()
            return True
        except Exception as exc:  # noqa: BLE001
            code = int(getattr(getattr(exc, "resp", None), "status", 0) or 0)
            why = f"{code or type(exc).__name__}"
            if code and code not in (429, 500, 502, 503, 504):
                break
            if attempt < GRANT_ATTEMPTS:
                time.sleep(GRANT_RETRY_S)
    log.warning("candidate papers: reader access on %s not granted to an address (%s)", file_id, why)
    return False


def shortcuts(drive: Any, file_id: str, name: str, where: dict[str, Any]) -> int:
    """tableDocsMirror_: a shortcut to the file in the Hiring table's folder and beside its two sibling files; one
    that cannot be placed never costs the upload."""
    homes: list[str] = []
    if where.get("folder"):
        homes.append(str(where["folder"]))
    for sib in where.get("siblings") or []:
        try:
            got = drive.files().get(fileId=str(sib), fields="parents", supportsAllDrives=True).execute()
            if got.get("parents"):
                homes.append(str(got["parents"][0]))
        except Exception:  # noqa: BLE001
            continue
    placed = 0
    for home in homes:
        try:
            drive.files().create(body={"name": name, "mimeType": SHORTCUT_MIME, "parents": [home],
                                       "shortcutDetails": {"targetId": file_id}}, fields="id",
                                 supportsAllDrives=True).execute()
            placed += 1
        except Exception:  # noqa: BLE001
            continue
    if placed < 3:
        log.info("candidate papers: %d of 3 shortcuts placed for %s", placed, file_id)
    return placed


def file_all(placements: list[dict[str, Any]], data: bytes) -> list[dict[str, Any]]:
    """Each door's paper in its folder as asatech, shared where its door shares, in order."""
    drive = CP.owner_drive()
    out = []
    for spot in placements:
        if len(data) > int(spot.get("max_bytes") or CP.MAX_BYTES):
            raise Refused("The file is over 15MB")
        folder, made = _home(drive, spot)
        got = CP._upload(drive, folder, str(spot["name"]), str(spot["mime"]), data)
        fid = str(got.get("id") or "")
        if not fid:
            raise RuntimeError("Drive named no file")
        one: dict[str, Any] = {"file_id": fid, "size": len(data), "folder_id": folder, "folder_made": made}
        if spot["where"] == "uploads":
            readers = [w for w in dict.fromkeys(list(spot.get("grants") or []) + [str(spot.get("uploader") or "")])
                       if w and "@" in w and w.lower() != CP.OWNER]
            one["shared"] = sum(1 for w in readers if grant_reader(drive, fid, w))
            if spot.get("grants_held"):
                log.info("candidate papers: reader access on %s held by its gate (%s)", fid,
                         str(spot["grants_held"])[:160])
        if spot.get("shortcuts"):
            one["shortcuts"] = shortcuts(drive, fid, str(spot["name"]), spot["shortcuts"])
        if spot["door"] == "resumeUpload":
            # the words read here are kept as this file's, at the time Drive says it was made
            try:
                one["modified_time"] = str(drive.files().get(fileId=fid, fields="modifiedTime",
                                                             supportsAllDrives=True).execute().get("modifiedTime") or "")
            except Exception:  # noqa: BLE001 — kept without its time, never read again for it
                one["modified_time"] = ""
        out.append(one)
    return out


# ---- the résumé's scorecard ----------------------------------------------------------------------------------------

def rubric_text(doc_id: str) -> str:
    """rubricPrompt_: the rubric document's text, held half an hour."""
    with _RUBRIC_LOCK:
        held = _RUBRIC.get(doc_id)
        if held and time.monotonic() - held[0] < RUBRIC_HOLD_S:
            return held[1]
    try:
        raw = CP.owner_drive().files().export(fileId=doc_id, mimeType="text/plain").execute()
    except Exception as exc:  # noqa: BLE001
        log.info("candidate papers: the rubric document was not read (%s)", type(exc).__name__)
        return ""
    text = raw.decode("utf-8", "replace") if isinstance(raw, (bytes, bytearray)) else str(raw or "")
    if text:
        with _RUBRIC_LOCK:
            _RUBRIC[doc_id] = (time.monotonic(), text)
    return text


def rubric_hash(text: str) -> str:
    """rubricHash_: the first eight bytes of the rubric's MD5, in hex."""
    return hashlib.md5(text.encode("utf-8")).hexdigest()[:16] if text else ""  # noqa: S324 — a fingerprint only


def jsonish(raw: str) -> str:
    """screenJsonish_."""
    t = str(raw or "").strip()
    t = re.sub(r"```\s*$", "", re.sub(r"^```(?:json)?\s*", "", t, flags=re.I)).strip()
    a, b = t.find("{"), t.rfind("}")
    return t[a:b + 1] if a != -1 and b > a else t


def ask_model(prompt: str) -> tuple[str, str]:
    """One completion of the prompt from the first of the platform's upstreams that answers: (content, upstream)."""
    import httpx  # noqa: PLC0415
    import call_prefs as CPF  # noqa: PLC0415 — the /analyze door's upstreams, as the call lane reads them
    ups = []
    if CPF.POOL_URL and CPF.POOL_KEYS:
        ups += [("pool", CPF.POOL_URL, model, CPF.POOL_KEYS) for model in dict.fromkeys(CPF.POOL_MODELS)]
    if CPF.LOCAL_URL:
        ups.append(("local-cortex", CPF.LOCAL_URL, CPF.LOCAL_MODEL, [""]))
    refusals: list[str] = []
    deadline = time.monotonic() + ASK_TIMEOUT_S * 2
    for name, url, model, keys in ups:
        for key in keys:
            for strict in (True, False):
                left = deadline - time.monotonic()
                if left <= 1:
                    break
                body: dict[str, Any] = {"model": model, "temperature": 0.1,
                                        "messages": [{"role": "user", "content": prompt}]}
                if strict:
                    body["response_format"] = {"type": "json_object"}
                try:
                    r = httpx.post(url, json=body, headers={"Authorization": f"Bearer {key}"} if key else {},
                                   timeout=min(ASK_TIMEOUT_S, left))
                except Exception as exc:  # noqa: BLE001 — the type only
                    refusals.append(f"{name}/{model} {type(exc).__name__}")
                    break
                if r.status_code == 400 and strict and "json_validate_failed" in r.text:
                    continue
                if r.status_code >= 400:
                    refusals.append(f"{name}/{model} {r.status_code}")
                    break
                content = (((r.json().get("choices") or [{}])[0].get("message") or {}).get("content")) or ""
                if content:
                    return jsonish(content), f"{name}/{model}"
                refusals.append(f"{name}/{model} empty")
                break
    raise RuntimeError("no provider (" + "; ".join(refusals or ["no upstream configured"]) + ")")


def _num(v: Any) -> float | None:
    """rubricNum_: parseFloat over the digits, dot and minus left in it."""
    m = re.match(r"^[+-]?(\d+\.?\d*|\.\d+)", re.sub(r"[^0-9.\-]", "", "" if v is None else str(v)))
    try:
        return float(m.group(0)) if m else None
    except ValueError:
        return None


def _js_text(v: Any) -> str:
    """String(v) for what a JSON reply holds."""
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        if isinstance(v, float) and math.isfinite(v) and v == int(v):
            return str(int(v))
        return repr(v) if isinstance(v, float) else str(v)
    if isinstance(v, list):
        return ",".join("" if x is None else _js_text(x) for x in v)
    if isinstance(v, dict):
        return "[object Object]"
    return str(v)


def composite(obj: dict[str, Any]) -> float | None:
    """rubricComposite_: computed here, never taken from the model."""
    s, e = _num(obj.get("SkillsRating")), _num(obj.get("ExperienceRating"))
    j, c = _num(obj.get("JobHistoryRating")), _num(obj.get("CertsRating"))
    if s is None or e is None or j is None or c is None:
        return None
    return math.floor((s * 1.5 + e * 1.5 + j * 1.0 + c * 0.5) * 10 + 0.5) / 10


def scorecard(text: str, owed: dict[str, Any]) -> dict[str, Any]:
    """rubricAnalyze_: the résumé's words held against the rubric by the platform's model."""
    out: dict[str, Any] = {"fields": {}, "raw": "", "status": "", "error": "", "hash": ""}
    if not str(text or "").strip():
        out["status"] = "no résumé text"
        return out
    rubric = rubric_text(str(owed.get("rubric_doc") or "")) if owed.get("rubric_doc") else ""
    if not rubric:
        out["status"] = "rubric doc unreadable"
        return out
    out["hash"] = rubric_hash(rubric)
    wrap = str(owed.get("wrap") or "")
    if not wrap:
        out["status"], out["error"] = "no provider", "prompt_cell_empty"
        return out
    prompt = wrap.replace("{resume}", str(text)[:RUBRIC_TEXT_MAX]).replace("{rubric}", rubric)
    try:
        content, _via = ask_model(prompt)
    except Exception as exc:  # noqa: BLE001
        out["status"], out["error"] = "no provider", str(exc)[:300] if isinstance(exc, RuntimeError) else ""
        return out
    out["raw"] = content[:RUBRIC_RAW_MAX]
    try:
        obj = json.loads(content)
    except ValueError:
        obj = None
    if not isinstance(obj, dict):
        out["status"] = "reply was not JSON"
        return out
    for key, col in RUBRIC_MAP.items():
        v = obj.get(key)
        if v is None or _js_text(v) == "":
            continue
        out["fields"][col] = _js_text(v)
    mine = composite(obj)
    if mine is not None:
        theirs = _num(obj.get("CompositeScore"))
        out["fields"]["composite_score"] = _js_text(mine)
        if theirs is not None and abs(theirs - mine) > 0.05:
            out["error"] = (f"composite recomputed: the reply said {_js_text(theirs)}, the weights give "
                            f"{_js_text(mine)}")
    out["status"] = "ok"
    return out
