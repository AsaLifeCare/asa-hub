"""The public form's doors (Forms.gs formPublicGetPub_, formPublicSubmitPub_; FormFiles.gs formPublicFileStorePub_,
formPublicFileSessionPub_) read off asa-hub-db: a link somebody fills in without an account, opened by its slug and
token, never by a session. Here the reads — the form a page draws, a Drive upload session minted for a file too big for
the envelope — and each write's Drive half, asked by the relay before the write: a file filed in the intake shelf
(formFileStoreCore_, pending__ until a submit claims it), and the files an answer names read in Drive, sealed for the
write (app/forms_public_writes.py). Once an answer's ledger rows are kept the relay asks formPublicFilesClaim, and the
files lose their pending__ names."""
from __future__ import annotations

import hmac
import json
import logging
import re
import threading
import time
from typing import Any, Callable

import candidate_papers as CP
import client_writes as CW
import drive_files as DF
import form_file_store as FFS
import forms as F
import forms_writes as FW
import gsjs
import locations as L
import recon as R
import smart_comms_desk as SCD
import staff_views
from scope import Defer

log = logging.getLogger("asa-hub-app")

# hubSysLog_'s actor for the public form's lines
LOG_ACTOR = "asa-hub:form"
# the write a submit's prepared files are sealed for
SUBMIT = "formPublicSubmit"
PENDING = "pending__"
# formPubThrottled_: each kind's knocks an hour, platform-wide
CAPS = {"get": 600, "submit": 240, "file": 900}
THROTTLE_S = 3600.0
INVALID = {"status": 404, "message": "This link is not valid. Ask whoever sent it for a fresh one."}
CLOSED = "This form is closed."
CLOSED_DRAW = "This form is closed. Thank you for your interest."
THANKS = "Thank you — this has reached the team."
NO_FILE = "This form does not ask for a file."
NOT_STARTED = {"status": 503, "message": "The upload could not be started — please try again."}
NOT_FOUND = "One of the uploaded files could not be found — please re-attach it."
NOT_THIS_FORM = "One of the attached files does not belong to this form."
# FORM_MAX_ANSWER_CHARS
MAX_ANSWER = 4000
# FORM_FILE_MAX_BYTES * 10, in MB: the resumable lane's own ceiling unless the words book names one
SESSION_MAX_MB = 300
# the climb from a claimed file to the form's folder
MAX_HOPS = 8
FILE_FIELDS = "id,name,parents,webViewLink,description"
CLAIM_MAX = 60
# DIGEST_ANSWER_FACTS: the seed under the words book's Digest Answer Facts, the last one any date
ANSWER_FACTS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("expires_on", ("expiration", "expiry", "expires", "valid until", "valid thru", "valid through", "good until",
                    "good thru", "renewal date", "renews", "due date", "vencimento", "validade")),
    ("issued_on", ("issue date", "issued on", "date issued", "date of issue", "completion date", "date completed",
                   "completed on", "exam date", "test date", "date of test", "date signed", "signed on", "emitido",
                   "emissao")),
    ("person", ("full name", "your name", "employee name", "staff name", "legal name", "name of employee",
                "name on the document", "first name", "last name", "nome completo")),
    ("doc_kind", ("document type", "type of document", "kind of document", "which document", "what document",
                  "document category", "tipo de documento")),
    ("client", ("client", "individual served", "individual name", "consumer", "participant", "person served")),
    ("house", ("house", "home name", "residence", "site", "location", "program")),
    ("issuer", ("issued by", "issuer", "agency", "institution", "school", "training provider", "employer",
                "organisation", "organization")),
    ("number", ("license number", "licence number", "certificate number", "certification number", "id number",
                "policy number", "document number", "number on the")),
    ("date", ("date", "data")))
_INDEX = re.compile(r"0|[1-9][0-9]*")

s_ = gsjs.str_
_KNOCKS: dict[str, tuple[int, float]] = {}
_KNOCKS_LOCK = threading.Lock()


def throttled(kind: str) -> bool:
    """formPubThrottled_: the kind's knocks this hour, the window renewed by each one let through."""
    with _KNOCKS_LOCK:
        now = time.time()
        n, until = _KNOCKS.get(kind, (0, 0.0))
        if now > until:
            n = 0
        if n >= CAPS[kind]:
            return True
        _KNOCKS[kind] = (n + 1, now + THROTTLE_S)
        return False


def line(action: str, detail: str) -> None:
    """hubSysLog_('asa-hub:form', …)."""
    staff_views.record({"email": LOG_ACTOR}, action, detail)


def payload_of(payload: Any) -> dict:
    return payload if isinstance(payload, dict) else {}


def sealed_by(p: dict) -> str:
    """The link a submit's prepared files are sealed to."""
    return gsjs.trim(F.text_or(p.get("f"))).lower()


def link(reads: L.Reads, p: dict, closed: str) -> tuple[dict | None, dict[str, Any] | None]:
    """The form the link names, open; else the one answer every bad link gets — no such form, a wrong key and an
    archived one alike — or its closed message. (the form, the refusal)"""
    row = F.form_by_slug(reads, p.get("f"))
    token = F.text_or(p.get("t"))
    if row is None or not token:
        return None, dict(INVALID)
    held = s_(row.get("token"))
    if held.startswith(F.COPY_MARKER):
        raise Defer("the copy withholds the link's key")
    if not hmac.compare_digest(token.encode(), held.encode()) or s_(row.get("archived")).lower() == "true":
        return None, dict(INVALID)
    if (s_(row.get("status")).lower() or "draft") not in ("open", "testing"):
        return None, {"status": 410, "message": s_(row.get("closed_message")) or closed}
    return row, None


def kind_of(f: dict) -> str:
    """String(f.kind || 'text')."""
    return F.text_or(f.get("kind"), "text")


def prop(f: dict, name: str) -> str:
    """String(f[name]): undefined when the question does not carry it."""
    return gsjs.js_str(f[name]) if name in f else "undefined"


def file_field(row: dict, want: str) -> dict | None:
    """The form's first file question, or the one the page names."""
    for f in F.fields_of(row):
        if f is None:
            raise Defer("a question that is null, which Apps Script stops at")
        if isinstance(f, dict) and prop(f, "kind") == "file" and (not want or prop(f, "key") == want):
            return f
    return None


def _length(v: Any) -> int:
    """v.length, for what a question's accepted types hold."""
    if isinstance(v, (list, str)):
        if isinstance(v, str) and any(ord(ch) > 0xFFFF for ch in v):
            raise Defer("a length JavaScript counts by its own units")
        return len(v)
    return 0


def accepted(f: dict) -> list | None:
    """The question's own accepted types, None when it names none."""
    accept = f.get("accept")
    if F.falsy(accept) or not _length(accept):
        return None
    if not isinstance(accept, list):
        raise Defer("accepted types that are not a list, which Apps Script reads its own way")
    return accept


def number(v: Any) -> float:
    """Number(v || 0)."""
    return 0.0 if F.falsy(v) else SCD.js_number(v)


def mb(n: float) -> str:
    return gsjs.num_str(gsjs.js_round(n / 1048576))


def answers_of(p: dict) -> dict:
    """(payload && payload.answers) || {}."""
    given = p.get("answers")
    if F.falsy(given):
        return {}
    if not isinstance(given, dict):
        raise Defer("answers that are not an object, which Apps Script reads its own way")
    return given


def who_of(p: dict) -> dict[str, str]:
    """The contact block, cut to its columns."""
    return {"name": CW.js_cut(gsjs.trim(F.text_or(p.get("name"))), 120),
            "email": CW.js_cut(gsjs.trim(F.text_or(p.get("email"))), 160),
            "phone": CW.js_cut(gsjs.trim(F.text_or(p.get("phone"))), 40)}


def device_session(p: dict) -> None:
    """A blank name or e-mail is filled from the device's own session, where sign-in lives — in Apps Script: such a
    submit is its to answer."""
    who = who_of(p)
    if (not who["name"] or not who["email"]) and F.text_or(p.get("session")):
        raise Defer("a submit from a signed-in device with a blank contact: the session is read where sign-in lives")


def js_order(d: dict) -> dict:
    """An object's own keys in JavaScript's order: the array indexes first, ascending, then the rest as inserted."""
    idx = sorted((k for k in d if _INDEX.fullmatch(k) and int(k) < 4294967295), key=int)
    return {**{k: d[k] for k in idx}, **{k: v for k, v in d.items() if k not in idx}}


def text_json(s: str) -> str:
    """JSON.stringify of a string."""
    if any(0xD800 <= ord(ch) <= 0xDFFF for ch in s):
        raise Defer("a lone surrogate JavaScript escapes its own way")
    return json.dumps(s, ensure_ascii=False)


def stringify(answers: dict[str, str]) -> str:
    """JSON.stringify(answers): every value a string."""
    return "{" + ",".join(text_json(k) + ":" + text_json(v) for k, v in js_order(answers).items()) + "}"


def compact(kept: list[dict]) -> str:
    """JSON.stringify of each attached file's handle: its id, its name and its size."""
    return "[" + ",".join('{"file_id":' + text_json(s_(h.get("fid"))) + ',"file_name":' +
                          text_json(gsjs.or_blank(h.get("name"))) + ',"size_bytes":' +
                          ("null" if h.get("size") is None else gsjs.num_str(h["size"])) + "}" for h in kept) + "]"


def plain(v: Any) -> str:
    """A question's answer as the page sent it: a list joined, cut to the answer's ceiling."""
    if isinstance(v, list):
        v = ", ".join("" if x is None else gsjs.js_str(x) for x in v)
    return CW.js_cut(gsjs.trim(gsjs.or_blank(v)), MAX_ANSWER)


# ---- the words book's answer facts (Digest.gs digestAnswerFacts_, digestAnswerFactOf_) ------------------------------

def _order(v: Any) -> float:
    """Number(row.order) || 0."""
    n = SCD.js_number(v) if v is not None else float("nan")
    return 0.0 if n != n or not n else n


def vocab_list(cell: Any) -> list[str]:
    """digestVocabList_: 'a, b | c' as ['a', 'b', 'c']."""
    return [x for x in (gsjs.trim(p).lower() for p in re.split(r"[,|]", F.text_or(cell))) if x]


def answer_facts(reads: L.Reads) -> list[tuple[str, tuple[str, ...]]]:
    """digestAnswerFacts_: the words book's Digest Answer Facts that are on, in their order; else the seed."""
    def read() -> list[tuple[str, tuple[str, ...]]]:
        out = []
        for r in sorted(CP.vocab(reads).get("Digest Answer Facts") or [], key=lambda r: _order(r.get("order"))):
            if not FFS._active(r):
                continue
            fact, needles = gsjs.trim(r.get("fact") or ""), vocab_list(r.get("needles"))
            if fact and needles:
                out.append((fact, tuple(needles)))
        return out or list(ANSWER_FACTS)
    return reads.once("forms_public:facts", read)


def fact_of(reads: L.Reads, key: str, label: Any, declared: Any) -> str:
    """digestAnswerFactOf_: what a question declares it feeds, else what it asks."""
    d = gsjs.trim(F.text_or(declared))
    if d:
        return d
    asked = re.sub(r"[_\-]+", " ", (F.text_or(label) + " " + F.text_or(key)).lower())
    return next((fact for fact, needles in answer_facts(reads) if any(n in asked for n in needles)), "")


# ---- the files an answer names (FormFiles.gs formFileAnswer_, read half) --------------------------------------------

def handles_of(raw: Any) -> list:
    """The page's handles: its list, or that list's JSON text; anything else none."""
    got = raw
    if isinstance(raw, str):
        try:
            got = json.loads(raw or "[]", parse_constant=F.no_constant)
        except (ValueError, RecursionError):
            return []
    elif F.falsy(raw):
        got = []
    return got if isinstance(got, list) else []


def asset_of(description: Any) -> tuple[str, str]:
    """hubAssetOf_: the identity the spine stamped on a file at capture, read back; blank when it was not captured
    through it."""
    d = F.text_or(description)
    a = re.search(r"asset:(AST_[A-Za-z0-9_]+)", d)
    h = re.search(r"sha256:([0-9a-f]{64})", d)
    return (a.group(1) if a else "", h.group(1) if h else "")


def under(drv: Any, meta: dict, where: str) -> bool:
    """The claimed id lives under the form's folder (any depth, hop-limited), or a submit could launder a Drive id."""
    try:
        parents = meta.get("parents") or []
        hops = 0
        while parents and hops < MAX_HOPS:
            if s_(parents[0]) == where:
                return True
            parents = drv.file(s_(parents[0]), "id,parents").get("parents") or []
            hops += 1
    except Defer:
        raise
    except Exception:  # noqa: BLE001 - formFileAnswer_'s catch: not shown to belong
        return False
    return False


def _label(f: dict) -> str:
    """String(f.label || f.key)."""
    if not F.falsy(f.get("label")):
        return gsjs.js_str(f["label"])
    return gsjs.js_str(f["key"]) if "key" in f else "undefined"


def file_answer(reads: L.Reads, f: dict, raw: Any) -> tuple[str, list[dict]]:
    """formFileAnswer_ up to its filing: the handles held to the question's file count, each found in Drive under the
    form's uploads folder, with the name, the link and the identity its row will carry. (the refusal, the files)"""
    handles = handles_of(raw)
    if not handles:
        return "", []
    key = F.text_or(f.get("context"), "forms")
    if key in F.PROTO_NAMES:
        raise Defer("an upload context every JavaScript object answers")
    cap = f.get("max_files")
    if F.falsy(cap):
        if key not in FFS.CONTEXTS:
            raise Defer("a file question whose unknown upload context Apps Script stops at")
        cap = FW.UPLOAD_MAX_FILES[key]
    most = SCD.js_number(cap)
    if len(handles) > most:
        return f'"{_label(f)}" takes at most {gsjs.num_str(most)} file(s).', []
    if key not in FFS.CONTEXTS:
        return f'Unknown upload context "{key}".', []
    drv = reads.need_drive()
    where, why = FFS.uploads_folder(reads, drv, key)
    if not where:
        return why, []
    seen: set[str] = set()
    kept: list[dict] = []
    for item in handles:
        h = item if isinstance(item, dict) else {}
        fid = gsjs.trim(F.text_or(h.get("file_id")))
        if not fid or fid in seen:
            continue
        seen.add(fid)
        meta = DF.file(drv, fid, FILE_FIELDS)
        if meta is None:
            return NOT_FOUND, []
        if not under(drv, meta, where):
            return NOT_THIS_FORM, []
        size = number(h.get("size_bytes"))
        if size in (float("inf"), float("-inf")):
            raise Defer("a file size JavaScript writes its own way")
        asset_id, sha = asset_of(meta.get("description"))
        kept.append({"fid": fid, "name": CW.js_cut(F.text_or(h.get("file_name")) or gsjs.or_blank(meta.get("name")),
                                                   180),
                     "mime": F.text_or(h.get("mime_type")), "size": None if size != size else size,
                     "url": s_(meta.get("webViewLink")) or DF.file_url(fid), "asset_id": asset_id, "sha256": sha})
    return "", kept


# ---- the doors ------------------------------------------------------------------------------------------------------

def get(sess: L.Session, payload: dict) -> dict[str, Any]:
    """formPublicGet: what the page draws."""
    if throttled("get"):
        return {"status": 429, "message": "Too many requests right now — please try again in a few minutes."}
    row, refused = link(sess.reads, payload_of(payload), CLOSED_DRAW)
    if refused:
        return refused
    return F.shown({"status": 200, "data": {
        "slug": s_(row.get("slug")), "title": s_(row.get("title")), "intro": s_(row.get("intro")),
        "fields": F.fields_of(row), "thank_you": s_(row.get("thank_you")) or THANKS,
        # opt-in, never a default
        "asks_contact": s_(row.get("asks_contact")).lower() == "yes"}})


def submit_prepare(sess: L.Session, payload: dict) -> dict[str, Any]:
    """formPublicSubmit's slow half: the link checked, then each file question's handles read in Drive, sealed for
    the write; the first file refused is the answer."""
    if throttled("submit"):
        return {"status": 429, "message": "Too many submissions right now — please try again shortly."}
    p = payload_of(payload)
    reads = sess.reads
    row, refused = link(reads, p, CLOSED)
    if refused:
        return refused
    device_session(p)
    given = answers_of(p)
    files: dict[str, dict[str, Any]] = {}
    for i, item in enumerate(F.fields_of(row)):
        f = item if isinstance(item, dict) else {}
        if kind_of(f) != "file":
            continue
        key = F.text_or(f.get("key"))
        if key in F.PROTO_NAMES:
            raise Defer("a question named as every JavaScript object answers")
        bad, kept = file_answer(reads, f, given.get(key))
        if bad:
            return {"status": 400, "message": bad}
        files[str(i)] = {"key": key, "kept": kept}
    return {"status": 200, "data": R.seal(SUBMIT, sealed_by(p), {"files": files})}


def prepared_files(files: dict, i: int, key: str) -> list[dict]:
    """The files the prepare read found for this question; a form whose questions moved since is Apps Script's."""
    got = files.get(str(i))
    if not isinstance(got, dict) or got.get("key") != key:
        raise Defer("the form's questions changed between the prepare read and the write")
    return got.get("kept") if isinstance(got.get("kept"), list) else []


def file_store_prepare(sess: L.Session, payload: dict) -> dict[str, Any]:
    """formPublicFileStore's slow half: the link checked, then the file filed by formFileStoreCore_ under its
    question's own types, named pending__ until a submit claims it, so orphans stay visible by their prefix."""
    if throttled("file"):
        return {"status": 429, "message": "Too many uploads right now — please try again shortly."}
    p = payload_of(payload)
    reads = sess.reads
    row, refused = link(reads, p, CLOSED)
    if refused:
        return refused
    f = file_field(row, F.text_or(p.get("key")))
    if f is None:
        return {"status": 400, "message": NO_FILE}
    key = F.text_or(f.get("context"), "forms")
    # String(payload.upload_id) as the door hands it on: a page that names no key stores under "undefined"
    raw_key = "undefined" if "upload_id" not in p else gsjs.js_str(p.get("upload_id"))
    got = FFS.core(reads, key, accepted(f), p.get("filename"), p.get("base64"), PENDING, raw_key, "")
    if got.get("status") != 200:
        return got
    return {"status": 200, "data": {**got["data"], "context": key, "slug": s_(row.get("slug"))}}


def file_session(sess: L.Session, payload: dict) -> dict[str, Any]:
    """formPublicFileSession: a Drive resumable session minted for a file the envelope cannot carry, so its bytes go
    to Drive in pieces through the relay's courier and never through a door."""
    if throttled("file"):
        return {"status": 429, "message": "Too many uploads right now — please try again shortly."}
    p = payload_of(payload)
    reads = sess.reads
    row, refused = link(reads, p, CLOSED)
    if refused:
        return refused
    f = file_field(row, gsjs.trim(F.text_or(p.get("key"))))
    if f is None:
        return {"status": 400, "message": NO_FILE}
    filename = CW.js_cut(gsjs.trim(F.text_or(p.get("filename"))), 180) or "file"
    ext = FFS.ext_of(filename)
    known = FFS.known_types(reads)
    key = F.text_or(f.get("context"), "forms")
    if key in F.PROTO_NAMES:
        raise Defer("an upload context every JavaScript object answers")
    allow = accepted(f)
    if allow is None:
        if key not in FFS.CONTEXTS or FFS.CONTEXTS[key]["accept"] == "*":
            raise Defer("a file question whose context Apps Script cannot list the types of")
        allow = list(FFS.CONTEXTS[key]["accept"])
    if not ext or ext not in allow or ext not in known:
        return {"status": 400, "message": "That file type is not accepted here. Allowed: " +
                                          ", ".join("." + gsjs.js_str(a) for a in allow) + "."}
    size = number(p.get("size_bytes"))
    cap = SCD.digest_setting(reads, "session_max_mb", SESSION_MAX_MB, 30, 2000) * 1048576
    if not size > 0:
        return {"status": 400, "message": "The upload did not say how big it is."}
    if size > cap:
        return {"status": 400, "message": f"That file is {mb(size)}MB — {mb(cap)}MB is the ceiling."}
    if key not in FFS.CONTEXTS:
        return {"status": 503, "message": f'Unknown upload context "{key}".'}
    drv = reads.need_drive()
    where, why = FFS.uploads_folder(reads, drv, key)
    if not where:
        return {"status": 503, "message": why}
    folder = where
    sub = FFS.documents_name(reads)
    if sub:
        try:
            folder = s_(DF.child(drv, where, sub).get("id"))
        except Exception:  # noqa: BLE001 - the parent still receives: organisation, not a wall
            folder = where
    upload_key = re.sub(r"[^A-Za-z0-9_-]", "", F.text_or(p.get("upload_id")))[:40]
    stored = PENDING + (upload_key or str(int(reads.now.timestamp() * 1000))) + "__" + filename
    try:
        code, session = DF.upload_session(drv, folder, stored, known[ext], gsjs.num_str(size))
    except Defer:
        raise
    except Exception as exc:  # noqa: BLE001 - the session was not started: said, nothing else made
        log.info("form file session: Drive did not start one (%s)", type(exc).__name__)
        return dict(NOT_STARTED)
    if code >= 400 or not session:
        return dict(NOT_STARTED)
    line("form_file_session", f"{s_(row.get('slug'))} — {filename} ({mb(size)}MB)")
    return {"status": 200, "data": {"session": session, "file_name": filename, "mime_type": known[ext],
                                    "stored_name": stored}}


def files_claim(sess: L.Session, payload: dict) -> dict[str, Any]:
    """The relay's own follow-up to a kept submit: each file whose ledger row was filed loses the pending__ name it
    wore until then; the row is the record, the name cosmetics."""
    if (sess.user or {}).get("is_service") is not True:
        return {"status": 403, "message": "This is the relay's own read."}
    asked = payload_of(payload).get("files")
    want = [s_(x) for x in asked if isinstance(x, str) and s_(x)][:CLAIM_MAX] if isinstance(asked, list) else []
    reads = sess.reads
    filed = {s_(r.get("file_id")) for r in F.rows(reads, F.FILES_TAB)}
    drv = reads.need_drive() if want else None
    renamed = 0
    for fid in want:
        if fid not in filed:
            continue
        try:
            name = gsjs.or_blank((DF.file(drv, fid, "id,name") or {}).get("name"))
            if name.startswith(PENDING):
                DF.rename(drv, fid, name[len(PENDING):])
                renamed += 1
        except Exception as exc:  # noqa: BLE001 - the row is the record; the name is cosmetics
            log.info("form files: a pending name stayed (%s)", type(exc).__name__)
    return {"status": 200, "data": {"renamed": renamed}}


READS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {
    "formPublicGet": get, "formPublicFileSession": file_session, "formPublicSubmitPrepare": submit_prepare,
    "formPublicFileStorePrepare": file_store_prepare, "formPublicFilesClaim": files_claim,
}
# no HUB_POLICY: the link's slug and token are each door's gate
READ_POLICY: dict[str, dict[str, Any]] = {a: {} for a in READS}
# what nobody's account may ask; the claim is the relay's own
PUBLIC = frozenset(a for a in READS if a != "formPublicFilesClaim")
