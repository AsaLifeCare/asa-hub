"""The CJIS folder (Cjis.gs) off asa-hub-db: the background-check reports the watched Drive folders hold, matched to
the board by the name each file carries (cjisScan), and the heavy halves the relay asks before a write — the folder
read and each report a card did not know about planned for attachment (cjisApply, cjisFolderSweepNow), and the same
on the relay's clock in place of the half-hourly rider (cjisSweepDue). A filename never decides a verdict: a report
is attached "On file", and a person still reads it."""
from __future__ import annotations

import re
import threading
import time
from typing import Any, Callable

import candidates as CND
import gsjs
import hubdb
import locations as L
import resume_intake as RI
import screening as SG
from scope import Defer

s_ = gsjs.str_
DENIED = SG.DENIED
INDEX_TTL_S = 900
MAX_PAGES = 4
ORIGINAL_DOCS_PROP = "HUB_FOLDER_ORIGINAL_DOCS"
NOT_A_NAME = re.compile(r"\b(" + "|".join((
    "cjis", "bci", "fbi", "rapback", "background", "report", "reports", "check", "checks", "result", "results", "copy",
    "of", "the", "and", "dodd", "training", "certificate", "certificates", "cert", "certs", "cpr", "st", "aid", "first",
    "hs", "diploma", "transcripts", "ged", "drivers", "driver", "license", "licence", "oh", "id", "social", "security",
    "card", "birth", "car", "insurance", "med", "del", "mandt", "mandtt")) + r")\b", re.I | re.A)
_COMMA = re.compile(r"^\s*([A-Za-zÀ-ÿ'’]+)\s*,\s*([A-Za-zÀ-ÿ'’]+)")


def key_of(name: Any) -> str:
    """cjisKey_: one person keys one way here, in the résumé inbox and in the staff archive."""
    return RI.inbox_key(name)


def clean_name(text: Any) -> str:
    """cjisCleanName_: two words or nothing — a single word matches the wrong person too often."""
    n = re.sub(r"[_\-.]+", " ", gsjs.or_blank(text))
    comma = _COMMA.match(n)
    if comma:
        n = comma.group(2) + " " + comma.group(1) + " " + n.replace(comma.group(0), " ", 1)
    n = NOT_A_NAME.sub(" ", n)
    n = re.sub(r"\b\d{1,2}[\s/]\d{1,2}[\s/]\d{2,4}\b", " ", n, flags=re.A)
    n = re.sub(r"\d+", " ", n, flags=re.A)
    n = re.sub(r"\s+", " ", re.sub(r"[^A-Za-zÀ-ÿ'’ ]+", " ", n)).strip()
    words = [w for w in n.split(" ") if len(w) > 1]
    return " ".join(words[:3]) if len(words) >= 2 else ""


def name_from(filename: Any) -> str:
    """cjisNameFrom_: the folder's `<Name> - <Document type> - <YYYYMMDD>` first; a file naming nobody is reported,
    never guessed onto someone."""
    raw = re.sub(r"\.[A-Za-z0-9]{2,5}$", "", gsjs.or_blank(filename))
    dash = raw.split(" - ")
    for t in ([dash[0]] if len(dash) > 1 else []) + [raw]:
        got = clean_name(t)
        if got:
            return got
    return ""


def folder_ids(reads: L.Reads) -> list[str]:
    """cjisFolderIds_: the request letter's docs folder (then the shared compliance folder, then CJIS_FOLDER_ID), and
    the résumé inbox's extra folders."""
    out: list[str] = []
    main = next((gsjs.trim(reads.db.prop(k)) for k in (ORIGINAL_DOCS_PROP, "COMPLIANCE_SHARED_FOLDER_ID",
                                                         "CJIS_FOLDER_ID") if gsjs.trim(reads.db.prop(k))), "")
    if main:
        out.append(main)
    extra = gsjs.trim(reads.db.prop("RESUME_EXTRA_FOLDERS"))
    for fid in (extra.split(",") if extra else RI.EXTRA_FOLDERS):
        fid = fid.strip()
        if fid and fid not in out:
            out.append(fid)
    return out


_INDEX: dict[str, Any] = {"at": 0.0, "got": None}
_INDEX_LOCK = threading.Lock()


def folder_index(reads: L.Reads, fresh: bool = False) -> dict[str, Any]:
    """cjisFolderIndex_: each person's newest file in the watched folders, held a quarter of an hour; a folder that
    cannot be read never reads as an empty one."""
    with _INDEX_LOCK:
        if not fresh and _INDEX["got"] is not None and time.time() - _INDEX["at"] < INDEX_TTL_S:
            return _INDEX["got"]
    got = RI.folder_files(reads, folder_ids(reads), MAX_PAGES)
    if not got["read"]:
        return {"error": "None of the watched CJIS folder(s) could be read (HTTP "
                         + ", ".join(str(u["http"]) for u in got["unreadable"]) + ")."}
    by: dict[str, dict] = {}
    unparsed: list[str] = []
    for f in got["files"]:
        name = name_from(f.get("name"))
        k = key_of(name)
        if not k:
            unparsed.append(s_(f.get("name")))
            continue
        prev = by.get(k)
        if prev is None or s_(f.get("modifiedTime")) > prev["at"]:
            by[k] = {"name": name, "fileId": s_(f.get("id")), "filename": s_(f.get("name")),
                     "at": s_(f.get("modifiedTime")), "mimeType": s_(f.get("mimeType"))}
    out = {"people": by, "filesSeen": len(got["files"]), "truncated": got["truncated"], "unparsed": unparsed[:20],
           "unparsedCount": len(unparsed), "unreadable": got["unreadable"], "error": ""}
    with _INDEX_LOCK:
        _INDEX.update(at=time.time(), got=out)
    return out


def board(reads: L.Reads) -> dict[str, Any]:
    """cjisCandidates_: every live card, its background result and link, whether its background paper is on file, and
    whether it is a rehearsal (which never takes a real person's report)."""
    try:
        cands = CND.read_tab(reads, CND.TALENT_CANDIDATES_TAB)
        by_id = {s_(a.get("candidateid")): a for a in CND.read_tab(reads, CND.TALENT_RESUME_TAB)
                 if s_(a.get("candidateid"))}
        docs, _why = CND.soft(lambda: CND.onboarding_doc_index(reads))
        docs = docs or {}
        rows = []
        for c in cands:
            if s_(c.get("archived")).lower() == "true":
                continue
            cid = s_(c.get("candidateid"))
            if not cid:
                continue
            a = by_id.get(cid) or {}
            bg = (docs.get(cid) or {}).get("background_check")
            rows.append({"id": cid, "name": s_(c.get("candidatename")), "status": s_(c.get("status")),
                         "isTest": SG.test_card(reads, c), "cjisStatus": s_(a.get("cjisstatus")),
                         "cjisUrl": s_(a.get("cjisreporturl")),
                         "hasDoc": bool(bg and bg.get("status") in ("uploaded", "verified"))})
    except (hubdb.Unreadable, Defer):
        raise
    except Exception as e:  # noqa: BLE001 - as the .gs: the board that cannot be read is said
        return {"error": str(e)[:200], "rows": []}
    return {"error": "", "rows": rows}


def file_url(fid: str) -> str:
    return "https://drive.google.com/file/d/" + fid + "/view"


def scan(sess: L.Session, payload: dict) -> dict[str, Any]:
    """cjisScan: the reports on file the platform did not know about, those already attached, the cards with nothing
    in the folder, and the rehearsals a file names."""
    reads = sess.reads
    if not SG.writer(sess.user):
        return dict(DENIED)
    idx = folder_index(reads)
    if idx.get("error"):
        return {"status": 503, "message": idx["error"] + " Nothing was read."}
    who = board(reads)
    if who["error"]:
        return {"status": 503, "message": "The board could not be read: " + who["error"]}
    found, already, none, rehearsals = [], [], [], []
    for c in who["rows"]:
        hit = idx["people"].get(key_of(c["name"]))
        row: dict[str, Any] = {"candidate_id": c["id"], "name": c["name"], "status": c["status"],
                               "cjis_status": c["cjisStatus"], "has_doc": c["hasDoc"]}
        if c["isTest"]:
            if hit:
                row["filename"] = hit["filename"]
                rehearsals.append(row)
            continue
        if not hit:
            none.append(row)
            continue
        row.update(filename=hit["filename"], file_url=file_url(hit["fileId"]), at=hit["at"])
        if c["cjisUrl"] and c["hasDoc"]:
            already.append(row)
            continue
        found.append(row)
    if found:
        message = (f"{len(found)} report(s) on file that this platform did not know about. {len(already)} already "
                   f"attached, {len(none)} with nothing in the folder."
                   + (f" {idx['unparsedCount']} file(s) name nobody — open those by hand." if idx["unparsedCount"]
                      else ""))
    else:
        message = f"Nothing new: {len(already)} already attached, {len(none)} with no report in the folder."
    return {"status": 200, "data": {"found": found, "already": already, "without": none, "rehearsals": rehearsals,
                                    "filesSeen": idx["filesSeen"], "truncated": bool(idx["truncated"]),
                                    "unparsed": idx["unparsed"], "unparsedCount": idx["unparsedCount"],
                                    "message": message}}


def apply_plan(reads: L.Reads, wanted: str) -> dict[str, Any]:
    """cjisApply's reading: each wanted card's report to attach, or why it is skipped."""
    idx = folder_index(reads, fresh=True)
    if idx.get("error"):
        return {"refused": {"status": 503, "message": idx["error"] + " Nothing was written."}}
    who = board(reads)
    if who["error"]:
        return {"refused": {"status": 503, "message": "The board could not be read: " + who["error"]}}
    attach, skipped = [], []
    for c in who["rows"]:
        if wanted and c["id"] not in wanted:
            continue
        if c["isTest"]:
            skipped.append({"name": c["name"], "why": "a test card — no report is attached"})
            continue
        hit = idx["people"].get(key_of(c["name"]))
        if not hit:
            continue
        if c["cjisUrl"] and c["hasDoc"]:
            skipped.append({"name": c["name"], "why": "already attached"})
            continue
        attach.append({"candidate_id": c["id"], "name": c["name"], "filename": hit["filename"],
                       "file_id": hit["fileId"], "file_url": file_url(hit["fileId"])})
    return {"attach": attach, "skipped": skipped}


def sweep_plan(reads: L.Reads) -> dict[str, Any]:
    """cjisFolderSweepRun_'s reading: every card whose report sits in the folder unattached, which of them the team
    was told of before (a cjis_filed line), and the files that match nobody."""
    idx = folder_index(reads, fresh=True)
    if idx.get("error"):
        return {"error": idx["error"]}
    who = board(reads)
    if who["error"]:
        return {"error": who["error"]}
    journey = CND.journey_for(reads, "") or []
    told = {s_(j.get("candidate_id")) for j in journey if s_(j.get("step")) == "cjis_filed"}
    matched: set[str] = set()
    attach = []
    for c in who["rows"]:
        k = key_of(c["name"])
        hit = idx["people"].get(k)
        if not hit:
            continue
        matched.add(k)
        if c["isTest"] or (c["cjisUrl"] and c["hasDoc"]):
            continue
        attach.append({"candidate_id": c["id"], "name": c["name"], "filename": hit["filename"],
                       "file_id": hit["fileId"], "file_url": file_url(hit["fileId"]), "told": c["id"] in told})
    orphans = sum(1 for k in idx["people"] if k not in matched)
    return {"error": "", "attach": attach, "orphans": orphans}


def apply_prepare(sess: L.Session, payload: dict) -> dict[str, Any]:
    """cjisApply's reading, read first by the relay for the admin who pressed Apply."""
    user = sess.user or {}
    if SG.service(user) or s_(user.get("role")) != "admin":
        return dict(DENIED)
    plan = apply_plan(sess.reads, s_((payload or {}).get("candidate_ids")))
    if plan.get("refused"):
        return plan["refused"]
    return {"status": 200, "data": SG.seal("cjisApply", SG.actor(user), plan)}


def sweep_prepare(sess: L.Session, payload: dict) -> dict[str, Any]:
    """cjisFolderSweepNow's reading: look now rather than waiting for the clock."""
    if not SG.writer(sess.user):
        return dict(DENIED)
    return {"status": 200, "data": SG.seal("cjisFolderSweepNow", SG.actor(sess.user), sweep_plan(sess.reads))}


def sweep_due(sess: L.Session, payload: dict) -> dict[str, Any]:
    """cjisFolderSweepMaybe_ (the half-hourly rider on the machine reads), on the relay's clock: the folder read and
    planned for cjisSweep; `due` false when nothing waits to be attached."""
    if not SG.service(sess.user):
        return dict(SG.SERVICE_ONLY)
    plan = sweep_plan(sess.reads)
    if plan.get("error") or not plan.get("attach"):
        return {"status": 200, "data": {"due": False, "error": plan.get("error") or "",
                                        "orphans": plan.get("orphans", 0)}}
    return {"status": 200, "data": SG.seal("cjisSweep", "service", {"due": True, **plan})}


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {
    "cjisScan": scan, "cjisApplyPrepare": apply_prepare, "cjisFolderSweepNowPrepare": sweep_prepare,
    "cjisSweepDue": sweep_due}
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
POLICY["cjisApplyPrepare"] = {"params": {"candidate_ids": "string"}}
