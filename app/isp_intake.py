"""The ISP Library's intake on Python (IspIntake.gs; ClientProfiles.gs Read the plans and clientIspSectionsSweep_): a
plan PDF in the plans folder is brought onto the server (documents/isp-plans/source), read here (isp_decode, MuPDF as
the relay read it, regex only — no model guesses at clinical fields), filed as the client's isps row and cut into its
sections (isp_sections), both in Postgres. The reading is a read (ispIntakeFetch: the folder, the file, the decode, the
cut, for as long as it takes); the filing is a write (ispIntakeKeep, quick, under the platform's lock). The relay
pairs them: on its clock for the plans whose sections are not filed yet, and behind ispIntakeSweep, ispIntakeRedo and
clientProfileIspSections when a person asks."""
from __future__ import annotations

import re
import time
from datetime import datetime, timezone
from typing import Any, Callable

import clients as C
import gsjs
import isp_decode as ID
import location_docs as LD
import locations as L
import resource_rows as RR
import scope as sc
import sheet_resources as SR
import staff_views
from scope import Defer

PLANS, SECTIONS = "isps", "ispSections"
TRIES = "app.isp_section_tries"
FOLDER_PROP = "ISP_DOCS_FOLDER_ID"
SOURCE_DIR = "isp-plans/source"
CONTACT_BLOCK_CHARS = 3000
# the plan PDF read whole, at most this much
PDF_CAP = 60 * 1024 * 1024
# ClientProfiles.gs CP_ISP_SWEEP_*: plans a pass, the first wait after a refusal, doubling up to the cap
PER_PASS = 2
WAIT_S = 60 * 60
WAIT_CAP_S = 24 * 60 * 60
# a fetch stops taking plans once it has run this long; the relay asks again while more is left
FETCH_BUDGET_S = 40.0
INTAKE_ACTOR = {"email": "asa-hub:isp", "display_name": "asa-hub:isp"}
SWEEP_ACTOR = {"email": "auto-digest", "display_name": "auto-digest"}

s_ = gsjs.str_


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _js_trim(v: Any) -> str:
    return gsjs.trim("" if v is None else str(v))


# ---- the folder and what is already filed --------------------------------------------------------------------------

def files(reads: L.Reads) -> list[dict]:
    """ispIntakeFiles_: the folder's PDFs, oldest change first; none when the folder is not set or not readable."""
    folder = s_(reads.db.prop(FOLDER_PROP))
    if not folder:
        return []
    try:
        got = reads.need_drive().children(folder, False, "id,name,mimeType,modifiedTime")
    except Defer:
        raise
    except Exception:  # noqa: BLE001 - as Apps Script: an unreadable folder lists none
        return []
    out = [{"id": s_(f.get("id")), "name": s_(f.get("name")), "at": s_(f.get("modifiedTime"))}
           for f in got if "pdf" in s_(f.get("mimeType"))]
    return sorted(out, key=lambda f: f["at"])


def name_words(text: Any) -> list[str]:
    """ispIntakeNameWords_: every 3+ letter word of a name or a file name, once."""
    t = ("" if text is None else str(text)).lower()
    t = re.sub(r"\.[a-z0-9]+$", "", t)
    t = re.sub(r"\bisp'?s?\b", " ", t)
    t = re.sub(r"[^a-z]+", " ", t)
    out: list[str] = []
    for w in re.split(r"\s+", t):
        if len(w) >= 3 and w not in out:
            out.append(w)
    return out


def known(reads: L.Reads) -> dict[str, Any]:
    """ispIntakeKnown_: the filed plans' source files, client keys and names."""
    k: dict[str, Any] = {"names": [], "keys": {}, "files": {}}
    try:
        for r in SR.rows(reads, PLANS):
            if s_(r.get("source_file")):
                k["files"][s_(r.get("source_file"))] = True
            if s_(r.get("client_key")):
                k["keys"][s_(r.get("client_key"))] = True
            if s_(r.get("client_name")):
                k["names"].append(name_words(s_(r.get("client_name"))))
    except Defer:
        raise
    except Exception:  # noqa: BLE001 - as Apps Script: nothing known reads as nothing filed
        pass
    return k


def is_known(k: dict[str, Any], file_name: str) -> bool:
    """ispIntakeIsKnown_: the file itself filed, or every word of its name in one filed client's name."""
    if k["files"].get(file_name):
        return True
    want = name_words(file_name)
    if not want:
        return False
    return any(all(w in have for w in want) for have in k["names"])


def key_of(name: Any) -> str:
    """ispIntakeKey_."""
    t = _js_trim(name).lower()
    return re.sub(r"[^a-z0-9_]", "", re.sub(r"\s+", "_", t))


def bullets(v: Any) -> str:
    """ispIntakeBullets_."""
    if isinstance(v, list):
        return "\n".join("• " + _js_trim(x) for x in v if _js_trim(x))
    return _js_trim(v)


def contacts(c: Any) -> str:
    """ispIntakeContacts_."""
    if not isinstance(c, dict):
        return _js_trim(c or "")
    out = []
    for k in ("guardian", "ssa_qidp", "physician", "emergency"):
        v = _js_trim(c.get(k) or "")
        if v:
            out.append(("Case manager" if k == "ssa_qidp" else k[0].upper() + k[1:]) + ": " + v)
    return "\n".join(out)


def contact_block(raw: str) -> str:
    """ispIntakeContactBlock_: cut exactly like the filed rows, which ispContactsSweep parses."""
    at = raw.find("Contact Information")
    return "" if at == -1 else raw[at:at + CONTACT_BLOCK_CHARS]


# ---- reading one plan ----------------------------------------------------------------------------------------------

def decode(reads: L.Reads, f: dict) -> dict[str, Any]:
    """ispIntakeDecode_ and the relay's /isp/decode: the plan brought onto the server and read; {status, data|message}."""
    try:
        raw = reads.need_drive().media(f["id"], PDF_CAP)
    except Defer:
        raise
    except Exception as exc:  # noqa: BLE001
        return {"status": 502, "message": f"the plan could not be opened: {type(exc).__name__}"}
    if len(raw) > PDF_CAP:
        return {"status": 502, "message": "the plan could not be opened: it is over 60MB"}
    try:
        target = LD.ROOT / SOURCE_DIR / (re.sub(r"[\\/\x00-\x1f]+", "_", f["name"]).strip(" .") or f["id"])
        target.parent.mkdir(parents=True, exist_ok=True)
        tmp = target.with_name(target.name + ".part")
        tmp.write_bytes(raw)
        tmp.replace(target)
    except OSError as exc:
        return {"status": 503, "message": f"the server's documents folder is not writable ({type(exc).__name__})"}
    try:
        text = ID.pdf_text(raw)
        flat = ID.flatten(ID.parse_isp_text(text, prune=False))
    except Exception as exc:  # noqa: BLE001
        return {"status": 500, "message": "The plan could not be read: " + str(exc)[:140]}
    return {"status": 200, "data": {"fields": flat, "pages": text.count("\f") + 1 if text else 0,
                                    "chars": len(text), "raw_text": text}}


def record_of(f: dict, data: dict) -> dict[str, Any]:
    """ispIntakeOnce_'s isps row for a decoded plan."""
    fl = data.get("fields") or {}
    name = _js_trim(fl.get("client_name"))
    key = key_of(name)
    raw = s_(data.get("raw_text")) if data.get("raw_text") is not None else ""
    pages = int(data.get("pages") or 0)
    return {"id": "ISP_" + key, "client_key": key, "client_name": name, "isp_year": s_(fl.get("isp_year") or ""),
            "allergies": bullets(fl.get("allergies")), "medications": bullets(fl.get("medications")),
            "diet_nutrition": bullets(fl.get("diet_nutrition")), "safety_risks": bullets(fl.get("safety_risks")),
            "supervision_level": s_(fl.get("supervision_level") or ""), "behaviors": bullets(fl.get("behaviors")),
            "mobility": s_(fl.get("mobility") or ""), "personal_care": bullets(fl.get("personal_care")),
            "communication": s_(fl.get("communication") or ""), "diagnoses": bullets(fl.get("diagnoses")),
            "medical_summary": s_(fl.get("medical_summary") or ""), "goals_outcomes": bullets(fl.get("goals_outcomes")),
            "important_to": bullets(fl.get("important_to")), "important_for": bullets(fl.get("important_for")),
            "contacts": contacts(fl.get("contacts")), "source_file": f["name"],
            "page_count": str(pages) if pages else "", "loaded_at": _now_iso(), "contact_block": contact_block(raw)}


def empty_sections(record: dict) -> list[str]:
    """ispIntakeEmpty_."""
    return [w for w in ("allergies", "medications", "diagnoses", "safety_risks", "supervision_level", "behaviors",
                        "goals_outcomes") if not _js_trim(record.get(w))]


# ---- what is filed -------------------------------------------------------------------------------------------------

def plans_book(reads: L.Reads) -> dict[str, Any]:
    """cpIspPlans_: the filed plans by client name, and the clients whose sections are filed."""
    plans = [r for r in SR.rows(reads, PLANS) if _js_trim(r.get("client_key"))]
    filed = {s_(r.get("client_key")): True for r in SR.rows(reads, SECTIONS)}
    plans.sort(key=lambda r: s_(r.get("client_name")).casefold())
    return {"plans": plans, "filed": filed}


def owned(reads: L.Reads) -> None:
    if not (RR.uploaded(reads.db, PLANS) and RR.uploaded(reads.db, SECTIONS)):
        raise Defer("the plans and their sections are not uploaded to Postgres yet")


def tries(reads: L.Reads) -> dict[str, dict]:
    """cpIspSweepTries_: client key → {n, next (epoch ms), status}."""
    return {k: {"n": int(n), "next": int(nx), "status": int(st)}
            for k, n, nx, st in RR._q(reads, f"select client_key, n, next_ms, status from {TRIES}")}


def sections_of(key: str, isp_year: str, source: str, cut: dict, now: str) -> list[dict[str, str]]:
    """cpSectionsWrite_'s new rows for one client."""
    count: dict[str, int] = {}
    out = []
    for row in cut.get("rows") or []:
        count[row["section"]] = count.get(row["section"], 0) + 1
        n = count[row["section"]]
        out.append({"id": "IS_" + key + "_" + row["section"] + ("_" + str(n) if n > 1 else ""), "client_key": key,
                    "isp_year": isp_year, "section": row["section"], "record": s_(row.get("record")),
                    "text": s_(row.get("text")), "source_file": source, "loaded_at": now})
    return out


# ---- the fetch: the read half --------------------------------------------------------------------------------------

def _plan_item(reads: L.Reads, f: dict, *, only: bool, redo: bool, k: dict, todo_n: int, seen: int) -> dict[str, Any]:
    """ispIntakeOnce_ up to the write: the plan read and checked, its row and its sections cut — or the refusal."""
    env = decode(reads, f)
    if env.get("status") != 200 or not (env.get("data") or {}).get("fields"):
        return {"answer": {"status": 502, "message": "The plan could not be read: " + s_(env.get("message") or
                                                                                         "no answer from the relay"),
                           "data": {"filed": "", "pending": todo_n, "seen": seen}}}
    rec = record_of(f, env["data"])
    if not rec["client_name"]:
        return {"answer": {"status": 422, "message": 'That plan names nobody — "' + f["name"] +
                           '" was left where it is rather than filed against a blank person.',
                           "data": {"filed": "", "pending": todo_n, "seen": seen}}}
    if k["keys"].get(rec["client_key"]) and not redo:
        return {"answer": {"status": 409, "message": rec["client_name"] + " already has a plan on file. Filing \"" +
                           f["name"] + "\" would be a second row for one person — use ispIntakeRedo to replace the one "
                           "that is there.", "data": {"filed": "", "pending": todo_n - 1, "seen": seen}}}
    cut = C.isp_cut(s_(env["data"].get("raw_text")))
    return {"kind": "plan", "record": rec, "cut": cut, "redo": redo, "pending": todo_n - 1, "seen": seen,
            "empty_sections": empty_sections(rec)}


def _sections_item(reads: L.Reads, plan: dict, listed: list[dict]) -> dict[str, Any]:
    """cpIspSectionsFile_ up to the write."""
    key, source = _js_trim(plan.get("client_key")), s_(plan.get("source_file"))
    f = next((x for x in listed if x["name"] == source), None)
    if f is None:
        return {"kind": "refused", "key": key, "status": 404,
                "message": "The plan's file is not in the plans folder any more."}
    env = decode(reads, f)
    if env.get("status") != 200 or not env.get("data"):
        return {"kind": "refused", "key": key, "status": 502,
                "message": "The plan could not be read: " + s_(env.get("message") or "no answer from the relay")}
    cut = C.isp_cut(s_(env["data"].get("raw_text")))
    if not cut["rows"]:
        return {"kind": "refused", "key": key, "status": 422, "message": "The plan carries none of the sections."}
    return {"kind": "sections", "key": key, "isp_year": s_(plan.get("isp_year") or ""), "source": source, "cut": cut,
            "client_name": gsjs.text(plan.get("client_name"))}


def fetch(sess: L.Session, payload: dict) -> dict[str, Any]:
    """ispIntakeFetch: the reading half of ispIntakeSweep and ispIntakeRedo (`only`, `redo`), of Read the plans
    (`client`, `sections`), and of the clock's sections sweep (nothing asked)."""
    user = sess.user or {}
    p = payload if isinstance(payload, dict) else {}
    reads = sess.reads
    owned(reads)
    mode = s_(p.get("mode"))
    if mode in ("sweep", "redo"):
        if not (user.get("is_service") or s_(user.get("role")) == "admin"):
            return {"status": 403, "message": "Denied."}
        listed = files(reads)
        if not listed:
            return {"status": 200, "data": {"items": [], "answer": {"status": 200, "data": {
                "filed": "", "pending": 0, "seen": 0, "note": "The plans folder is empty, or its id is not set."}}}}
        k = known(reads)
        only = s_(p.get("only"))
        todo = [f for f in listed if (f["name"] == only if only else not is_known(k, f["name"]))]
        if not todo:
            return {"status": 200, "data": {"items": [], "answer": {"status": 200, "data": {
                "filed": "", "pending": 0, "seen": len(listed), "note": "Every plan in the folder is already filed."}}}}
        got = _plan_item(reads, todo[0], only=bool(only), redo=mode == "redo", k=k, todo_n=len(todo),
                         seen=len(listed))
        return {"status": 200, "data": {"items": [got] if got.get("kind") else [], "answer": got.get("answer")}}
    if mode == "sections":
        if not sc.is_real_master(user):
            return C.unknown()
        asked = gsjs.text(p.get("client"), 120)
        ctx = C.client_ctx(reads, asked) if asked else None
        if ctx is not None and ctx.get("refused"):
            return {"status": 200, "data": {"items": [], "answer": ctx["refused"]}}
        try:
            book = plans_book(reads)
        except Defer:
            raise
        except Exception as exc:  # noqa: BLE001
            return {"status": 200, "data": {"items": [], "answer": {
                "status": 503, "message": f"The plans could not be read just now ({type(exc).__name__})."}}}
        if ctx is not None:
            plan = next((r for r in book["plans"] if _js_trim(r.get("client_key")) == ctx["key"]), None)
            if plan is None:
                return {"status": 200, "data": {"items": [], "answer": {
                    "status": 404, "message": "No plan is filed for this client."}}}
        else:
            plan = next((r for r in book["plans"] if not book["filed"].get(_js_trim(r.get("client_key")))), None)
            if plan is None:
                return {"status": 200, "data": {"items": [], "answer": {"status": 200, "data": {
                    "filed": "", "pending": 0, "note": "Every filed plan already has its sections."}}}}
        got = _sections_item(reads, plan, files(reads))
        return {"status": 200, "data": {"items": [got], "asked": True}}
    # the clock's pass (clientIspSectionsSweep_): the plans with no sections filed, as many as fit, each failure
    # waiting longer before it is tried again
    if user.get("is_service") is not True:
        return {"status": 403, "message": "This is the relay's own read."}
    book = plans_book(reads)
    held = tries(reads)
    now_ms = int(time.time() * 1000)
    due, seen, waiting = [], set(), 0
    for r in book["plans"]:
        key = _js_trim(r.get("client_key"))
        if book["filed"].get(key) or key in seen:
            continue
        seen.add(key)
        t = held.get(key)
        if t and now_ms < t["next"]:
            waiting += 1
        else:
            due.append(r)
    items: list[dict] = []
    listed: list[dict] | None = None
    started = time.monotonic()
    for plan in due:
        if len(items) >= PER_PASS or time.monotonic() - started > FETCH_BUDGET_S:
            break
        if listed is None:
            listed = files(reads)
            if not listed:
                return {"status": 200, "data": {"items": [], "more": False, "shut": True, "waiting": waiting}}
        try:
            items.append(_sections_item(reads, plan, listed))
        except Defer:
            raise
        except Exception as exc:  # noqa: BLE001
            items.append({"kind": "refused", "key": _js_trim(plan.get("client_key")), "status": 500,
                          "message": str(exc)[:120]})
    return {"status": 200, "data": {"items": items, "more": False, "waiting": waiting}}


def status(sess: L.Session, payload: dict) -> dict[str, Any]:
    """ispIntakeStatus: how many plans are in the folder, how many are filed, which still wait."""
    user = sess.user or {}
    if not user or user.get("is_service") or s_(user.get("role")) != "admin":
        return {"status": 403, "message": "Denied."}
    listed = files(sess.reads)
    k = known(sess.reads)
    waiting = [f["name"] for f in listed if not k["files"].get(f["name"])]
    return {"status": 200, "data": {"in_folder": len(listed), "filed": len(listed) - len(waiting), "waiting": waiting,
                                    "folder_set": bool(s_(sess.reads.db.prop(FOLDER_PROP)))}}


# ---- the keep: the write half --------------------------------------------------------------------------------------

def write_sections(reads: L.Reads, key: str, isp_year: str, source: str, cut: dict, by: str) -> dict[str, Any]:
    """cpSectionsFileCut_ / cpSectionsWrite_: one client's sections replaced — the old rows taken out, the new ones
    after every other row."""
    k = _js_trim(key)
    if not k:
        return {"refused": {"status": 400, "message": "client_key: which client the plan is about."}}
    for row_key, cells in RR.table_rows(reads, SECTIONS):
        if _js_trim(cells.get("client_key")) == k:
            RR.remove(reads, SECTIONS, row_key, cells, by)
    RR.create_many(reads, SECTIONS, sections_of(k, s_(isp_year), s_(source), cut, _now_iso()), by)
    return {"rows": len(cut.get("rows") or []), "sections": [r["section"] for r in cut.get("rows") or []],
            "absent": cut.get("absent") or []}


def keep_tries(reads: L.Reads, done: dict[str, dict | None]) -> None:
    """cpIspSweepTriesSave_: a failure's count and next try kept, a filed plan's taken off."""
    cur = RR._cur()
    for key, t in done.items():
        if t is None:
            cur.execute(f"delete from {TRIES} where client_key = %s", (key,))
        else:
            cur.execute(f"insert into {TRIES} (client_key, n, next_ms, status) values (%s, %s, %s, %s)"
                        " on conflict (client_key) do update set n = excluded.n, next_ms = excluded.next_ms,"
                        " status = excluded.status, updated_at = now()", (key, t["n"], t["next"], t["status"]))


def log_line(actor: dict, action: str, target: str) -> None:
    staff_views.record(actor, action, target)


ACTIONS_READ: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {"ispIntakeFetch": fetch,
                                                                         "ispIntakeStatus": status}
