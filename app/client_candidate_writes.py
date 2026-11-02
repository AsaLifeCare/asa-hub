"""Client Candidates' writes (apps-script/ClientCandidates.gs) decided off asa-hub-db: each kept in app.edits on the
referral's own Potential Clients row (or Postgres' own rows once Potential Clients is Python's), final. A paper is filed
in the referral's Drive folder as the platform's account by the read the relay asks first (clientCandidateFilePrepare),
and the write records it; what this side cannot read is its own 503, never Apps Script's."""
from __future__ import annotations

import base64
import binascii
import logging
import re
from typing import Any, Callable

import cert_docs as CD
import client_candidates as CC
import client_writes as CW
import drive_files as DF
import gsjs
import hubdb
import locations as L
import photos as P
import recon as RC
import resource_rows as RR
import scope as sc
import sheet_resources as SR
import ssa as S
import writes as W
from scope import Defer
from writes import Decision

log = logging.getLogger("asa-hub-app")

APP_ID = "client-candidates"
APP_NAME = "Client Candidates"
# Settings › Editions: who else makes each change beside the master (app/editions.py)
EDITION = {"information": "clientCandidates.information", "intake": "clientCandidates.intake",
           "pipeline": "clientCandidates.pipeline", "notes": "clientCandidates.notes",
           "documents": "clientCandidates.documents"}
EDITIONS = tuple(EDITION.values())
UNKNOWN = "Unknown action."
LEADS = "potentialClients"
# where the referrals are once Potential Clients is Python's: Postgres, not a sheet's copy
KEPT = object()
LOG_FIELD, DOCS_FIELD, PREFS_FIELD = CC.LOG_FIELD, CC.DOCS_FIELD, CC.PREFS_FIELD
LOG_CAP, LOG_CHARS, NOTE_MAX = CC.LOG_CAP, CC.LOG_CHARS, CC.NOTE_MAX
COPY_MARKER = "[withheld"
_KEY = re.compile(r"^[A-Za-z0-9_-]{3,80}$")
_NOTE_ID = re.compile(r"^note_([1-9][0-9]{0,4})$")
_DAY_CLOCK = re.compile(r"^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})(?: · (.*?))? — (.*)$", re.S)

# the stages, the phases and the log are the read module's (one port of ClientCandidates.gs)
STAGES, STAGE_HELD, ORDER, PHASES = CC.STAGES, CC.STAGE_HELD, CC.ORDER, CC.PHASES
STAGE_IDS = tuple(s["id"] for s in STAGES)
WRITE_KINDS, FILED = CC.WRITE_KINDS, CC.FILED
CONTACT_METHODS = ("Phone call", "Text message", "E-mail", "Mail", "In person")

# ClientCandidates.gs: the referrals' folder under the platform's, and the longest file the door takes (as base64)
FOLDER = "Client Candidates"
FILE_MAX_B64 = 21000000
_FILE_ID = re.compile(r"^[A-Za-z0-9_-]{10,}$")
NOT_FILED = "The paper could not be filed in Drive just now — try again in a minute. Nothing was filed."
PROTECTED = ("It holds a number the platform withholds (a Social Security, Medicaid or card number, or a date of "
             "birth), so it is changed in Potential Clients.")
NEVER_TYPED = "A Social Security, Medicaid or card number, or a date of birth, is never typed here."
CACHES = "Client Candidates reads it from Postgres at once; the relay read this referral again."
INFO_WORDS = "The referral's details on its Potential Clients row, kept in the Hub's database."
INTAKE_WORDS = "The intake's answers on the referral's row, kept in the Hub's database."
NOTE_WORDS = "The note on the referral's notes, kept in the Hub's database."
DOC_WORDS = "The paper's record on the referral's row, kept in the Hub's database."

# Information: the row's own columns (label, kind, longest value)
INFO_FIELDS: dict[str, tuple[str, str, int]] = {
    "client_name": ("Full name", "text", 160),
    "phone": ("Phone", "phone", 40),
    "email": ("E-mail", "email", 120),
    "source": ("Source", "text", 120),
    "owner": ("Intake coordinator", "text", 120),
    "postal_code": ("ZIP", "text", 10),
    "description": ("Service requested", "textarea", CC.SERVICE_MAX),
    "frequency": ("Frequency", "text", 200),
    "funding_source": ("Funding source", "text", 80),
    "diagnosis": ("Diagnosis", "textarea", CC.DIAGNOSIS_MAX),
    "client_age": ("Age", "text", 3),
    "client_gender": ("Gender", "text", 20),
}
# the lines Information shows that no edition writes, and why
INFO_LOCKED: dict[str, tuple[str, str]] = {
    "stage": ("Stage", "The stage moves through Update stage, and Mark complete or Reopen on Actions."),
    "referral_id": ("Referral number", "The county portal's number; the referral scraper knows the referral by it."),
    "expiration_date": ("Referral window", "The window is the county portal's, as the referral came in."),
    "scraped_at": ("Referred", "When the referral came in, as the platform recorded it."),
    "ai_rating": ("AI rating", "The referral scraper's reading of the referral; it is never typed."),
    "notes": ("Notes", "A note is added with Add note, and changed or removed one at a time from the notes."),
    "county": ("Location / county", "The Potential Clients row carries the ZIP alone; edit the ZIP."),
    "family": ("Family / guardian", "The Potential Clients row does not carry a family or guardian."),
    "important_to_me": ("Important to me", "The Potential Clients row does not carry it."),
    "preferred_start": ("Preferred start", "The Potential Clients row does not carry a preferred start."),
}
# Intake: the next step (a column) and the contact preferences (one JSON cell)
INTAKE_FIELDS: dict[str, tuple[str, str, int]] = {
    "next_step": ("Next step", "text", 300),
    "contact_method": ("Contact method", "select", 60),
    "best_time": ("Best time", "text", 120),
    "contact_who": ("Who to contact", "text", 200),
}
PREF_KEY = {"contact_method": "method", "best_time": "best_time", "contact_who": "who"}
INTAKE_LOCKED: dict[str, tuple[str, str]] = {
    "plan": ("The intake's phases", "A phase moves with Mark complete or Reopen on Actions."),
    "details": ("Service, frequency, funding, location, phone, e-mail, referred by",
                "The referral's details, edited in Information."),
    "family": ("Family / guardian", "The Potential Clients row does not carry a family or guardian."),
    "preferred_start": ("Preferred start", "The Potential Clients row does not carry a preferred start."),
    "important_to": ("Important to them", "The Potential Clients row does not carry it."),
}
DOC_STATES = ("filed", "removed")
OPTION_WORDS = {"": "Not said", "Yes": "Yes", "No": "No", "filed": "On the referral",
                "removed": "Removed from the referral (the file stays in its folder)"}

# CC_DOB_RE, CC_MEDICAID_RE, a bare 12-digit run, CC_SSN_RE and CC_CARD_RE: the guard on top of ssaScrub_
_DOB = re.compile(
    r"\b(DOB|D\.O\.B\.?|date of birth|birth ?date|birthday|born(?: on)?)(?:\s+(?:is|was))?\s*[:#-]?\s*"
    r"(\d{1,2}\s*[/.\-\s]\s*\d{1,2}\s*[/.\-\s]\s*\d{2,4}|\d{4}\s*[/.\-]\s*\d{1,2}\s*[/.\-]\s*\d{1,2}"
    r"|[A-Z][a-z]{2,8}\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}|\d{1,2}(?:st|nd|rd|th)?\s+[A-Z][a-z]{2,8}\.?,?\s+\d{4})",
    re.I)
_MEDICAID = re.compile(r"\b(Medicaid|MMIS)(\s*(?:no\.?|number|id|#))?\s*[:#-]?\s*#?\s*\d[\d -]{6,}\d", re.I)
_TWELVE = re.compile(r"(^|\D)\d{12}(?=\D|\Z)")
_SSN = re.compile(r"(^|\D)\d{3}\s*[\s.-]\s*\d{2}\s*[\s.-]\s*\d{4}(?=\D|\Z)")
_CARD = re.compile(r"(^|\D)\d(?:[\s.-]{0,2}\d){12,18}(?=\D|\Z)")


# ---- small pure helpers -------------------------------------------------------------------------------------------

def text(v: Any, n: int = 0) -> str:
    """ccText_."""
    return gsjs.text(v, n)


stage_id, stage_of, stage_meta, stage_label = CC.stage_id, CC.stage_of, CC.stage_meta, CC.stage_label
stage_index, stage_wanted, json_of = CC.stage_index, CC.stage_wanted, CC.json_of
log_of, log_with, docs_of, prefs_of = CC.log_of, CC.log_with, CC.docs_of, CC.prefs_of
clock, note_line, notes_with = CC.clock, CC.note_line, CC.notes_with


def scrubbed(v: str) -> str:
    """ccScrub_ for one text."""
    s = _DOB.sub(r"\1 [withheld]", v)
    s = _MEDICAID.sub(lambda m: m.group(1) + (m.group(2) or "") + " [withheld]", s)
    s = _TWELVE.sub(r"\1[withheld]", s)
    s = _SSN.sub(r"\1[withheld]", s)
    s = _CARD.sub(r"\1[withheld]", s)
    return S.scrub(s)


def protected(v: str) -> bool:
    """A value the reads withhold, or one the copy itself withholds."""
    return bool(v) and (COPY_MARKER in v or scrubbed(v) != v)


def marked(*vals: Any) -> None:
    if any(isinstance(v, str) and COPY_MARKER in v for v in vals):
        raise Defer("the copy withholds a cell this decision rests on")


def refused(env: dict[str, Any]) -> Decision:
    if env.get("status") == 503:
        raise Defer(str(env.get("message") or "the Potential Clients records could not be read")[:160])
    return Decision(env)


# ---- who may write ------------------------------------------------------------------------------------------------

def viewer(sess: L.Session) -> dict[str, Any] | None:
    """clientCandidatesGate_'s scope (the real master always); None when App Control keeps the app closed."""
    user = sess.user
    if sc.is_real_master(user):
        return sc.scope_of("master")
    try:
        got = sc.profile_app_gate(APP_ID, user, sess.reads.scope_sources())
    except (Defer, hubdb.Unreadable):
        raise
    except Exception:  # noqa: BLE001 - a gate that throws is shut, as the .gs catch
        return None
    scope = got.get("scope") if got and got.get("open") is True else None
    return scope if scope and scope.get("kind") != "none" else None


def wide(scope: dict | None) -> bool:
    return bool(scope) and scope.get("kind") in ("master", "all")


def edit_door(sess: L.Session, edition: str) -> dict[str, Any] | None:
    """The master; else a listed holder of the edition who reads the app whole. FAIL-CLOSED."""
    if sc.is_real_master(sess.user):
        return None
    if not sc.edition_allows(edition, sess.user or {}, sess.reads.config()):
        return {"status": 404, "message": UNKNOWN}
    return None if wide(viewer(sess)) else {"status": 404, "message": UNKNOWN}


def edition_of(sess: L.Session, edition: str) -> str:
    """The edition a person's write came in by; the master's names none."""
    return "" if sc.is_real_master(sess.user) else edition


# ---- the referral's own row ---------------------------------------------------------------------------------------

def leads(reads: L.Reads) -> tuple[Any, list[dict]]:
    """ccLeads_: the Potential Clients rows, Python's kept edits laid — or, once Potential Clients is Python's, the rows
    Postgres keeps (KEPT stands for where they are)."""
    def read() -> tuple[Any, list[dict]]:
        if RR.uploaded(reads.db, LEADS):
            return KEPT, [{h: gsjs.trim(v) if isinstance(v, str) else v for h, v in r.items()}
                          for r in SR.rows(reads, LEADS)]
        res = W.tab_of(reads, LEADS)
        if res.ref is None:
            raise hubdb.Unreadable("the Potential Clients records are not in asa-hub-db")
        return res, reads.db.locations_rows(res.ref)
    return reads.once("ccw:leads", read)


def ctx_of(reads: L.Reads, raw: Any) -> dict[str, Any]:
    """ccCandidate_: the referral's context, or 400 when no row carries the id."""
    key = gsjs.trim(gsjs.or_blank(raw))
    none = {"refused": {"status": 400, "message": f'No candidate "{key[:120]}" is on file.'}}
    if not _KEY.fullmatch(key):
        return none
    res, rows = leads(reads)
    hits = [r for r in rows if gsjs.trim(gsjs.or_blank(r.get("id"))) == key]
    if not hits:
        return none
    if len(hits) > 1:
        return {"refused": {"status": 409, "message": W.NOT_TOLD_APART}}
    row = hits[0]
    return {"key": key, "name": text(row.get("client_name"), 160) or key, "row": row, "stage": stage_id(row.get("stage")),
            "res": res}


def raw_of(row: dict, col: str) -> str:
    return gsjs.or_blank(row.get(col))


def row_record(sess: L.Session, ctx: dict, cells: dict[str, str], entry: dict[str, str] | None,
               edition: str) -> dict[str, Any]:
    """updateRowById_ on the referral's row: the cells, the log with its line, updatedAt; what it held before."""
    row = ctx["row"]
    out = dict(cells)
    if entry is not None:
        out[LOG_FIELD] = W.json_text(log_with(row.get(LOG_FIELD), entry))
    out["updatedAt"] = W.now_iso(sess.reads)
    if ctx["res"] is KEPT:
        # the referrals live in Postgres once Potential Clients is Python's: the row is changed there (None: written)
        hit = RR.find(sess.reads, LEADS, ctx["key"])
        if hit is None:
            raise Defer(f"the referral {ctx['key']} is not in Postgres")
        RR.update(sess.reads, LEADS, hit[0], hit[1], out, gsjs.str_((sess.user or {}).get("email")))
        return None
    sid, tab = W.where_of(ctx["res"])
    before = {k: raw_of(row, k) for k in out}
    return W.kept_record(sid, tab, "edit", "id", ctx["key"], ctx["key"], out, before, edition)


def finish(answer: dict[str, Any], rec: dict[str, Any] | None, key: str) -> Decision:
    """The write answered final: kept in app.edits, or already in Postgres (rec None)."""
    if rec is None:
        return Decision(answer, subject=key, own=True)
    return W.final(answer, [rec], key)


def entry_of(sess: L.Session, kind: str, words: str) -> dict[str, str]:
    return {"at": W.now_iso(sess.reads), "by": W.who(sess.user), "kind": kind, "text": words}


# ccWritePlan_: what one press writes, the same plan the read module's Actions offers
write_plan = CC.write_plan


# ---- a press on the row (clientCandidateWrite) --------------------------------------------------------------------

def write(sess: L.Session, payload: dict) -> Decision:
    """clientCandidateWrite: Update stage, Mark complete, Reopen or Add note, kept on the referral's row."""
    p = payload if isinstance(payload, dict) else {}
    kind = gsjs.or_text(p.get("kind"))
    eid = EDITION["notes"] if kind == "note" else EDITION["pipeline"]
    shut = edit_door(sess, eid)
    if shut:
        return Decision(shut)
    key = gsjs.trim(gsjs.or_blank(p.get("candidate_id")))
    if not _KEY.fullmatch(key):
        return W.refuse(400, "candidate_id: the referral's row id.")
    if kind not in WRITE_KINDS:
        return W.refuse(400, "kind: stage, complete, reopen or note.")
    note = gsjs.trim(CW.fold_ws(gsjs.or_blank(p.get("note"))))
    if CW.utf16_len(note) > NOTE_MAX:
        return W.refuse(400, f"note: up to {NOTE_MAX} characters.")
    if kind == "note" and not note:
        return W.refuse(400, "note: what the note says.")
    if kind == "stage" and note:
        return W.refuse(400, "note: Update stage files no note.")
    reads = sess.reads
    ctx = ctx_of(reads, key)
    if ctx.get("refused"):
        return refused(ctx["refused"])
    row = ctx["row"]
    marked(row.get("stage"), row.get(LOG_FIELD), row.get("notes") if note else "")
    # the stage the panel opened on, when it names one: a move since is said, never written over
    seen = stage_id(p.get("expected_stage"))
    if seen and (stage_of(seen) or seen) != (stage_of(ctx["stage"]) or ctx["stage"]):
        return W.refuse(409, f"{ctx['name']} is now at {stage_label(ctx['stage'])} — reloaded, nothing was written.",
                        data={"current": {"stage": stage_label(ctx["stage"])}})
    plan = write_plan(ctx, kind, p)
    if plan.get("refused"):
        return Decision(plan["refused"])
    W.gate(reads)
    by = W.who(sess.user)
    entry = entry_of(sess, plan["log"], plan["text"])
    cells = dict(plan["fields"])
    if note:
        cells["notes"] = notes_with(row.get("notes"), note_line(reads.now, by, plan["about"], note))
    rec = row_record(sess, ctx, cells, entry, edition_of(sess, eid))
    out_row: dict[str, str] = {"id": key}
    if "stage" in cells:
        out_row["stage"] = cells["stage"]
    return finish({"status": 200, "data": {"entry": entry, "row": out_row}}, rec, key)


# ---- a paper (clientCandidateFile): filed in Drive by its read, recorded on the row; the consent confirmed ----------

def file_head(sess: L.Session, p: dict) -> tuple[dict[str, Any] | None, str, str, bool]:
    """The press's own checks before anything is read: (the refusal, the referral, the paper, a confirmation)."""
    shut = edit_door(sess, EDITION["documents"])
    if shut:
        return shut, "", "", False
    key = gsjs.trim(gsjs.or_blank(p.get("candidate_id")))
    if not _KEY.fullmatch(key):
        return {"status": 400, "message": "candidate_id: the referral's row id."}, "", "", False
    doc = gsjs.or_text(p.get("doc"))
    if doc not in FILED:
        return {"status": 400, "message": "doc: assessment or consent."}, "", "", False
    confirm = p.get("confirm") is True
    if confirm and doc != "consent":
        return {"status": 400, "message": "confirm: only a filed consent is confirmed."}, "", "", False
    return None, key, doc, confirm


def paper_of(p: dict, doc: str) -> tuple[dict[str, Any] | None, dict[str, str]]:
    """The file a filing press carries, read as the .gs reads it: (the refusal, its name, type and base64)."""
    f = p.get("file") if isinstance(p.get("file"), dict) else {}
    fname = text(f.get("filename") or f.get("name"), 180) or doc
    b64 = re.sub(r"^data:[^,]*,", "", gsjs.js_str(f.get("base64") or f.get("b64") or f.get("data") or ""))
    mime = CD.file_type(fname, f.get("mime") or f.get("type"))
    if not mime:
        return {"status": 400, "message": CD.TYPE_WORDS + " Nothing was filed."}, {}
    if not b64:
        return {"status": 400, "message": "The file is required."}, {}
    if len(b64) > FILE_MAX_B64:
        return {"status": 400, "message": "The file is too large — up to 15MB."}, {}
    return None, {"fname": fname, "mime": mime, "b64": b64}


def filed_row(ctx: dict, doc: str) -> dict[str, Any] | None:
    """The live row's own refusal of a paper: the support assessment is filed at the Assessment stage alone."""
    if doc == "assessment" and stage_of(ctx["stage"]) != "assessment":
        return {"status": 409, "message": "The support assessment is filed at the Assessment stage — Update stage "
                                          "moves " + ctx["name"] + " there first."}
    row = ctx["row"]
    marked(row.get(DOCS_FIELD), row.get(LOG_FIELD))
    return None


def file_prepare(sess: L.Session, payload: dict) -> dict[str, Any]:
    """clientCandidateFile's Drive half (ccFolder_ and createFile): every refusal first, then the paper filed in the
    referral's own folder under the platform's as its account, sealed for the write that records it."""
    p = payload if isinstance(payload, dict) else {}
    shut, key, doc, confirm = file_head(sess, p)
    if shut:
        return shut
    if confirm:
        # a confirmation files nothing
        return {"status": 200, "data": {}}
    bad, paper = paper_of(p, doc)
    if bad:
        return bad
    reads = sess.reads
    W.gate(reads)
    ctx = ctx_of(reads, key)
    if ctx.get("refused"):
        return ctx["refused"]
    held = filed_row(ctx, doc)
    if held:
        return held
    try:
        data = base64.b64decode(paper["b64"], validate=False)
    except (binascii.Error, ValueError):
        return {"status": 400, "message": "The file could not be read as sent. Nothing was filed."}
    if not data:
        return {"status": 400, "message": "The file is empty."}
    name = CW.js_cut(FILED[doc] + " - " + key + " - " + paper["fname"], 200)
    drv = reads.need_drive()
    try:
        root = gsjs.str_(DF.root(reads, drv).get("id"))
        folder = DF.child(drv, DF.child(drv, root, FOLDER)["id"], key)["id"]
        filed = drv.upload_into(folder, name, paper["mime"], data)
    except Defer:
        raise
    except Exception as exc:  # noqa: BLE001 - the type only: Drive's words may carry an id
        log.warning("client candidates: a paper was not filed in Drive (%s)", type(exc).__name__)
        return {"status": 502, "message": NOT_FILED}
    fid = gsjs.str_(filed.get("id"))
    log.info("client candidates: %s filed in Drive for %s", doc, key)
    return {"status": 200, "data": RC.seal("clientCandidateFile", RC.actor(sess.user),
                                           {"candidate_id": key, "doc": doc, "file_id": fid, "name": name,
                                            "mime": paper["mime"]})}


def file_door(sess: L.Session, payload: dict) -> Decision:
    """clientCandidateFile: the paper its read filed in the referral's folder recorded on the row (the consent with its
    contact preferences), or a filed consent confirmed."""
    p = payload if isinstance(payload, dict) else {}
    shut, key, doc, confirm = file_head(sess, p)
    if shut:
        return Decision(shut)
    prep: dict[str, Any] | None = None
    if not confirm:
        if p.get("file") != "kept":
            bad = paper_of(p, doc)[0]
            return Decision(bad) if bad else W.refuse(503, NOT_FILED)
        prep = RC.unsealed("clientCandidateFile", RC.actor(sess.user), p.get("prepared"))
        if prep is None or prep.get("candidate_id") != key or prep.get("doc") != doc or \
                not _FILE_ID.fullmatch(gsjs.str_(prep.get("file_id"))):
            return W.refuse(409, "The paper filed is not the one this press names — file it again. Nothing was "
                                 "written.")
    try:
        got = file_record(sess, p, key, doc, confirm, prep)
    except (Defer, hubdb.Unreadable):
        if prep is not None:
            log.warning("client candidates: %s filed in Drive but not recorded — orphan file: %s", doc, prep["file_id"])
        raise
    if prep is not None and (got.answer or {}).get("status") != 200:
        log.warning("client candidates: %s filed in Drive but refused (%s) — orphan file: %s", doc,
                    (got.answer or {}).get("status"), prep["file_id"])
    return got


def file_record(sess: L.Session, p: dict, key: str, doc: str, confirm: bool, prep: dict | None) -> Decision:
    """The row as it stands now: the paper recorded with its log line, or the consent confirmed."""
    reads = sess.reads
    ctx = ctx_of(reads, key)
    if ctx.get("refused"):
        return refused(ctx["refused"])
    held = filed_row(ctx, doc)
    if held:
        return Decision(held)
    docs = docs_of(ctx["row"].get(DOCS_FIELD))
    if confirm:
        c = docs.get("consent") if isinstance(docs.get("consent"), dict) else None
        if not c or not gsjs.or_text(c.get("file_id")):
            return W.refuse(409, "No signed consent is filed yet.")
        if gsjs.or_text(c.get("confirmed_at")):
            return W.refuse(409, "The consent is already confirmed.")
    W.gate(reads)
    if confirm:
        entry = entry_of(sess, "document", FILED["consent"] + " confirmed")
        docs["consent"] = {**c, "confirmed_at": entry["at"], "confirmed_by": entry["by"]}
        cells = {DOCS_FIELD: W.json_text(docs)}
    else:
        entry = entry_of(sess, "document", FILED[doc] + " filed")
        docs[doc] = {"file_id": gsjs.str_(prep["file_id"]), "name": gsjs.str_(prep.get("name")),
                     "mime": gsjs.str_(prep.get("mime")), "at": entry["at"], "by": entry["by"]}
        cells = {DOCS_FIELD: W.json_text(docs)}
        if doc == "consent":
            cells[PREFS_FIELD] = W.json_text({"method": text(p.get("method"), 60),
                                              "best_time": text(p.get("best_time"), 120),
                                              "who": text(p.get("contact_who"), 200)})
    rec = row_record(sess, ctx, cells, entry, edition_of(sess, EDITION["documents"]))
    return finish({"status": 200, "data": {"entry": entry, "row": {"id": key}, "doc": doc}}, rec, key)


# ---- Information and the intake's answers (clientCandidateEdit) ----------------------------------------------------

def info_check(field: str, value: str) -> tuple[str, str]:
    """(the value as kept, why it is refused or '')."""
    max_len = INFO_FIELDS[field][2]
    if field == "client_name" and not value:
        return value, "A name is never blank."
    if field == "phone" and value:
        digits = W.phone_key(value)
        if not digits:
            return value, "A phone of 10 digits, such as (614) 555-0100."
        value = digits
    if field == "email":
        value = value.lower()
        if value and not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", value):
            return value, "The e-mail does not look like an address."
    if field == "postal_code" and value and not re.fullmatch(r"\d{5}(-\d{4})?", value):
        return value, "A 5-digit ZIP, or ZIP+4 (12345-6789)."
    if field == "client_age" and value and (not re.fullmatch(r"\d{1,3}", value) or int(value) > 120):
        return value, "The age as a whole number of years."
    if field != "phone" and protected(value):
        return value, NEVER_TYPED
    if CW.utf16_len(value) > max_len:
        return value, f"Up to {max_len} characters."
    return value, ""


def intake_check(field: str, value: str) -> tuple[str, str]:
    max_len = INTAKE_FIELDS[field][2]
    if protected(value):
        return value, NEVER_TYPED
    if CW.utf16_len(value) > max_len:
        return value, f"Up to {max_len} characters."
    return value, ""


def intake_raw(row: dict) -> dict[str, str]:
    prefs = prefs_of(row.get(PREFS_FIELD))
    out = {"next_step": raw_of(row, "next_step")}
    out.update({f: prefs[k] for f, k in PREF_KEY.items()})
    return out


def edit(sess: L.Session, payload: dict) -> Decision:
    """clientCandidateEdit (Python's own): Information's fields or the intake's answers, per field refused, stale or
    kept on the referral's row."""
    section = gsjs.or_text(payload.get("section")) or "information"
    if section not in ("information", "intake"):
        return W.refuse(400, "section: information or intake.")
    eid = EDITION[section]
    shut = edit_door(sess, eid)
    if shut:
        return Decision(shut)
    reads = sess.reads
    ctx = ctx_of(reads, payload.get("candidate"))
    if ctx.get("refused"):
        return refused(ctx["refused"])
    changes, bad = W.edit_changes(payload)
    if bad:
        return Decision(bad)
    row = ctx["row"]
    fields, locked = (INFO_FIELDS, INFO_LOCKED) if section == "information" else (INTAKE_FIELDS, INTAKE_LOCKED)
    raw = {f: raw_of(row, f) for f in INFO_FIELDS} if section == "information" else intake_raw(row)
    written: list[dict] = []
    out: list[dict] = []
    stale: dict[str, str] = {}
    cells: dict[str, str] = {}
    prefs = prefs_of(row.get(PREFS_FIELD))
    prefs_changed = False
    for c in changes:
        f = c["field"]
        if f in locked:
            out.append({"field": f, "why": locked[f][1]})
            continue
        if f not in fields:
            out.append({"field": f, "why": "Not a field this panel edits."})
            continue
        if protected(raw[f]):
            out.append({"field": f, "why": PROTECTED})
            continue
        now = CW.witness(c["expected"], raw[f])
        if now is not None:
            stale[f] = now
            continue
        kind = fields[f][1]
        value = c["value"].strip() if kind == "textarea" else gsjs.trim(CW.fold_ws(c["value"]))
        value, why = info_check(f, value) if section == "information" else intake_check(f, value)
        if why:
            out.append({"field": f, "why": why})
            continue
        if f in PREF_KEY:
            prefs[PREF_KEY[f]] = value
            prefs_changed = True
        else:
            cells[f] = value
        written.append({"field": f, "before": raw[f], "after": value})
    if prefs_changed:
        cells[PREFS_FIELD] = W.json_text(prefs)
    words = INFO_WORDS if section == "information" else INTAKE_WORDS
    answer = W.edit_answer(written, out, stale, W.pg_steps(words, CACHES, APP_ID))
    if not written:
        return Decision(answer)
    W.gate(reads)
    labels = ", ".join(fields[w["field"]][0] for w in written)
    title = ("Information edited: " if section == "information" else "Intake edited: ") + labels
    rec = row_record(sess, ctx, cells, entry_of(sess, "record", title), edition_of(sess, eid))
    return finish(answer, rec, ctx["key"])


# ---- one line of the referral's notes edited or removed (clientCandidateNoteEdit) ---------------------------------

def note_at(row: dict, nid: Any) -> dict[str, Any] | None:
    """The note an id names (note_<n>: the n-th line written, blank lines aside), its stamp kept apart from its words."""
    m = _NOTE_ID.fullmatch(gsjs.trim(gsjs.or_blank(nid)))
    if not m:
        return None
    lines = raw_of(row, "notes").split("\n")
    at = [i for i, line in enumerate(lines) if line.strip()]
    n = int(m.group(1))
    if n > len(at):
        return None
    i = at[n - 1]
    line = lines[i].strip()
    hit = _DAY_CLOCK.fullmatch(line)
    head = line[:len(line) - len(hit.group(3))] if hit else ""
    return {"lines": lines, "index": i, "head": head, "body": hit.group(3).strip() if hit else line,
            "at": hit.group(1) if hit else "", "by": (hit.group(2) or "") if hit else "", "id": f"note_{n}"}


def note_edit(sess: L.Session, payload: dict) -> Decision:
    """clientCandidateNoteEdit (Python's own): a note's words, or the note removed; its stamp stays as written."""
    shut = edit_door(sess, EDITION["notes"])
    if shut:
        return Decision(shut)
    reads = sess.reads
    ctx = ctx_of(reads, payload.get("candidate"))
    if ctx.get("refused"):
        return refused(ctx["refused"])
    changes, bad = W.edit_changes(payload)
    if bad:
        return Decision(bad)
    hit = note_at(ctx["row"], payload.get("id"))
    if hit is None:
        return W.refuse(404, f"No such note is on {ctx['name']}'s referral.")
    written: list[dict] = []
    out: list[dict] = []
    stale: dict[str, str] = {}
    lines = list(hit["lines"])
    removed = False
    for c in changes:
        f = c["field"]
        if f not in ("body", "state"):
            out.append({"field": f, "why": "Not a field of a note."})
            continue
        if protected(hit["body"]):
            out.append({"field": f, "why": PROTECTED})
            continue
        # the note's words are the witness either way: a line moved since is never the one changed
        now = CW.witness(c["expected"], hit["body"])
        if now is not None:
            stale[f] = now
            continue
        if f == "state":
            if c["value"].strip().lower() != "removed":
                out.append({"field": f, "why": "A note on file is only removed here."})
                continue
            removed = True
            written.append({"field": f, "before": "open", "after": "removed"})
            continue
        value = gsjs.trim(CW.fold_ws(c["value"]))
        if not value:
            out.append({"field": f, "why": "A note says something; remove it instead."})
            continue
        if protected(value):
            out.append({"field": f, "why": NEVER_TYPED})
            continue
        if CW.utf16_len(value) > NOTE_MAX:
            out.append({"field": f, "why": f"Up to {NOTE_MAX} characters."})
            continue
        lines[hit["index"]] = hit["head"] + value
        written.append({"field": f, "before": hit["body"], "after": value})
    answer = W.edit_answer(written, out, stale, W.pg_steps(NOTE_WORDS, CACHES, APP_ID))
    if not written:
        return Decision(answer)
    if removed:
        lines = hit["lines"][:hit["index"]] + hit["lines"][hit["index"] + 1:]
    W.gate(reads)
    notes = gsjs.trim("\n".join(lines))
    rec = row_record(sess, ctx, {"notes": notes}, entry_of(sess, "note", "Note removed" if removed else "Note edited"),
                     edition_of(sess, EDITION["notes"]))
    return finish(answer, rec, ctx["key"])


# ---- a filed paper's record on the row (clientCandidateDocEdit) ---------------------------------------------------

def doc_raw(docs: dict, doc: str) -> dict[str, str]:
    d = docs.get(doc) if isinstance(docs.get(doc), dict) else {}
    filed = bool(gsjs.or_text(d.get("file_id")))
    return {"state": "filed" if filed else "", "confirmed": ("Yes" if gsjs.or_text(d.get("confirmed_at")) else "No")
            if filed and doc == "consent" else ""}


def doc_edit(sess: L.Session, payload: dict) -> Decision:
    """clientCandidateDocEdit (Python's own): the consent confirmed or its confirmation withdrawn, or a filed paper's
    record taken off the referral (the file stays in its folder)."""
    shut = edit_door(sess, EDITION["documents"])
    if shut:
        return Decision(shut)
    reads = sess.reads
    ctx = ctx_of(reads, payload.get("candidate"))
    if ctx.get("refused"):
        return refused(ctx["refused"])
    doc = gsjs.or_text(payload.get("doc"))
    if doc not in FILED:
        return W.refuse(400, "doc: assessment or consent.")
    changes, bad = W.edit_changes(payload)
    if bad:
        return Decision(bad)
    docs = docs_of(ctx["row"].get(DOCS_FIELD))
    raw = doc_raw(docs, doc)
    if not raw["state"]:
        return W.refuse(404, f"No {FILED[doc].lower()} is filed for {ctx['name']} yet.")
    written: list[dict] = []
    out: list[dict] = []
    stale: dict[str, str] = {}
    paper = dict(docs[doc])
    gone = False
    by, at = W.who(sess.user), W.now_iso(reads)
    for c in changes:
        f = c["field"]
        if f not in ("state", "confirmed") or (f == "confirmed" and doc != "consent"):
            out.append({"field": f, "why": "Not a field of this paper's record."})
            continue
        now = CW.witness(c["expected"], raw[f])
        if now is not None:
            stale[f] = now
            continue
        value = c["value"].strip()
        if f == "state":
            if value != "removed":
                out.append({"field": f, "why": "A filed paper's record is only taken off the referral here."})
                continue
            gone = True
        else:
            value = value[:1].upper() + value[1:].lower()
            if value not in ("Yes", "No"):
                out.append({"field": f, "why": "Yes or No."})
                continue
            if value == "Yes":
                paper.update({"confirmed_at": at, "confirmed_by": by})
            else:
                paper.pop("confirmed_at", None)
                paper.pop("confirmed_by", None)
        written.append({"field": f, "before": raw[f], "after": value})
    answer = W.edit_answer(written, out, stale, W.pg_steps(DOC_WORDS, CACHES, APP_ID))
    if not written:
        return Decision(answer)
    if gone:
        docs.pop(doc, None)
        words = FILED[doc] + " removed from the referral"
    else:
        docs[doc] = paper
        words = FILED[doc] + (" confirmed" if paper.get("confirmed_at") else ": confirmation withdrawn")
    W.gate(reads)
    rec = row_record(sess, ctx, {DOCS_FIELD: W.json_text(docs)}, entry_of(sess, "document", words),
                     edition_of(sess, EDITION["documents"]))
    return finish(answer, rec, ctx["key"])


# ---- the edit panels' read (clientCandidateEditRead): a READ, laid into the read module's ACTIONS ------------------

def _field(key: str, label: str, kind: str, raw: str, max_len: int, lock: dict | None = None,
           options: tuple | None = None, hint: str = "") -> dict[str, Any]:
    f: dict[str, Any] = {"key": key, "label": label, "kind": kind, "raw": raw, "max": max_len}
    if options is not None:
        f["options"] = list(options)
        f["optionLabels"] = {o: OPTION_WORDS.get(o, o) for o in options}
    if hint:
        f["hint"] = hint
    if lock:
        f["lockedBy"] = lock
    return f


def _guarded(key: str, label: str, kind: str, raw: str, max_len: int, **kw: Any) -> dict[str, Any]:
    """A field whose value the reads withhold is drawn withheld and locked."""
    if protected(raw):
        return _field(key, label, kind, scrubbed(raw), max_len, {"why": PROTECTED, "door": "Potential Clients"})
    return _field(key, label, kind, raw, max_len, **kw)


def edit_read(sess: L.Session, payload: dict) -> dict[str, Any]:
    """The raw values a section's edit panel opens on, each lock with its reason; 404 to whom the edition does not open."""
    section = gsjs.or_text(payload.get("section")) or "information"
    eid = {"information": EDITION["information"], "intake": EDITION["intake"], "note": EDITION["notes"],
           "document": EDITION["documents"]}.get(section)
    if eid is None:
        return {"status": 400, "message": "section: information, intake, note or document."}
    shut = edit_door(sess, eid)
    if shut:
        return shut
    reads = sess.reads
    ctx = ctx_of(reads, payload.get("candidate"))
    if ctx.get("refused"):
        env = ctx["refused"]
        if env.get("status") == 503:
            raise Defer(str(env.get("message"))[:160])
        return env
    row = ctx["row"]
    head = {"section": section, "candidate": ctx["key"], "name": ctx["name"], "stage": stage_label(ctx["stage"])}
    fields: list[dict] = []
    if section == "information":
        for f, (label, kind, max_len) in INFO_FIELDS.items():
            fields.append(_guarded(f, label, kind, raw_of(row, f), max_len))
        elsewhere = [{"field": f, "label": label, "why": why} for f, (label, why) in INFO_LOCKED.items()]
        return {"status": 200, "data": {**head, "fields": fields, "elsewhere": elsewhere}}
    if section == "intake":
        raw = intake_raw(row)
        for f, (label, kind, max_len) in INTAKE_FIELDS.items():
            opts = None
            if kind == "select":
                opts = ("", *CONTACT_METHODS) + ((raw[f],) if raw[f] and raw[f] not in CONTACT_METHODS else ())
            fields.append(_guarded(f, label, kind, raw[f], max_len, options=opts))
        elsewhere = [{"field": f, "label": label, "why": why} for f, (label, why) in INTAKE_LOCKED.items()]
        return {"status": 200, "data": {**head, "fields": fields, "elsewhere": elsewhere}}
    if section == "note":
        hit = note_at(row, payload.get("id"))
        if hit is None:
            return {"status": 404, "message": f"No such note is on {ctx['name']}'s referral."}
        fields.append(_guarded("body", "Note", "textarea", hit["body"], NOTE_MAX))
        return {"status": 200, "data": {**head, "id": hit["id"], "by": S.scrub(hit["by"]), "at": hit["at"],
                                        "fields": fields, "elsewhere": []}}
    doc = gsjs.or_text(payload.get("doc"))
    if doc not in FILED:
        return {"status": 400, "message": "doc: assessment or consent."}
    docs = docs_of(row.get(DOCS_FIELD))
    raw = doc_raw(docs, doc)
    if not raw["state"]:
        return {"status": 404, "message": f"No {FILED[doc].lower()} is filed for {ctx['name']} yet."}
    if doc == "consent":
        fields.append(_field("confirmed", "Confirmed", "select", raw["confirmed"], 3, options=("Yes", "No")))
    fields.append(_field("state", "On the referral", "select", "filed", 10, options=DOC_STATES,
                         hint="Removing the record leaves the file itself in the referral's folder."))
    paper = docs.get(doc) or {}
    return {"status": 200, "data": {**head, "doc": doc, "label": FILED[doc],
                                    "file": scrubbed(text(paper.get("name"), 200)), "fields": fields, "elsewhere": []}}


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {
    "clientCandidatePhoto": P.door("client-candidates"), "clientCandidateWrite": write,
    "clientCandidateFile": file_door, "clientCandidateEdit": edit, "clientCandidateNoteEdit": note_edit,
    "clientCandidateDocEdit": doc_edit,
}
_EDITORS = sc.EDITION_ROLES
FILE_PARAMS = {"candidate_id": "string", "doc": "string", "method": "string", "best_time": "string",
               "contact_who": "string", "confirm": "boolean"}
# HUB_POLICY: the roles each write is declared for, and its typed params
POLICY: dict[str, dict[str, Any]] = {
    "clientCandidatePhoto": P.policy("client-candidates"),
    "clientCandidateWrite": {"roles": _EDITORS, "params": {"candidate_id": "string", "kind": "string",
                                                           "stage": "string", "item": "string", "note": "string",
                                                           "expected_stage": "string"}},
    "clientCandidateFile": {"roles": _EDITORS, "params": FILE_PARAMS},
    "clientCandidateEdit": {"roles": _EDITORS, "params": {"candidate": "string", "section": "string",
                                                          "changes": "array"}},
    "clientCandidateNoteEdit": {"roles": _EDITORS, "params": {"candidate": "string", "id": "string",
                                                              "changes": "array"}},
    "clientCandidateDocEdit": {"roles": _EDITORS, "params": {"candidate": "string", "doc": "string",
                                                             "changes": "array"}},
}
# the edit panels' read and a paper's filing before its write (BACKEND_WRITE_PREPARE): answered by the read module's
# door (main.APPS), never under the write lock
READS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {"clientCandidateEditRead": edit_read,
                                                                 "clientCandidateFilePrepare": file_prepare}
READ_POLICY: dict[str, dict[str, Any]] = {
    "clientCandidateEditRead": {"roles": ("admin", "director", "manager", "staff", "client", "onboarding",
                                          "interviewer"),
                                "params": {"candidate": "string", "section": "string", "doc": "string",
                                           "id": "string"}},
    "clientCandidateFilePrepare": {"roles": _EDITORS, "params": FILE_PARAMS}}
# the platform's write lock held by another write: Python's own sentence, never a hand-off a holder could not take
BUSY_OF: dict[str, dict[str, Any]] = {a: {"status": 409, "message": W.BUSY} for a in ACTIONS}


class Store(W.Store):
    """app.client_candidates_writes and app.client_candidates_receipts, beside the other apps' own."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="client_candidates", label=APP_NAME)
