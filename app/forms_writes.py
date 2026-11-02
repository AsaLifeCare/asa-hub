"""Forms' writes (apps-script/Forms.gs) decided off asa-hub-db and kept in Forms' own tables (app.resource_rows): a
form saved (made, or its questions, words and status changed), an answer marked handled or put back, a form renamed,
archived or restored."""
from __future__ import annotations

import json
import math
import re
import secrets
from typing import Any, Callable

import client_writes as CW
import forms as F
import gsjs
import locations as L
import resource_rows as RR
import writes as W
from scope import Defer
from writes import Decision

BUSY = "Somebody else is changing the forms right now — try again."
NOTE_ARCHIVED = "Archived — the link answers 404; the answers stay filed."
NOTE_RESTORED = "Restored — reopen it from the editor when ready."
NOTE_OPEN = "The link is live — anybody holding it can fill it in."
SLUG = re.compile(r"[a-z0-9][a-z0-9-]{1,48}")
KEY = re.compile(r"[a-z0-9_]{1,40}")
STATUSES = ("draft", "open", "closed", "testing")
MAX_FIELDS = 60
# FORM_KINDS: what each kind asks of a question
NEEDS_OPTIONS = frozenset({"choice", "multi", "scale"})
# FORM_FIELD_FACTS: what a question may feed, and the kinds that can answer it
FACTS: dict[str, tuple[str, ...]] = {"person": ("text",), "doc_kind": ("choice", "text"),
                                     "expires_on": ("date", "text"), "issued_on": ("date", "text"),
                                     "date": ("date", "text"), "house": ("choice", "text"),
                                     "client": ("choice", "text")}
# FORM_UPLOAD_CONTEXTS: each upload context's default file count
UPLOAD_MAX_FILES = {"forms": 5, "lab": 10, "finance": 10}
# FORM_FILE_TYPES: the extensions every file question may accept (the words book can only add to them)
FILE_TYPES = frozenset({"pdf", "png", "jpg", "jpeg", "webp", "gif", "docx", "xlsx", "csv", "txt", "json", "xml",
                        "tsv", "md", "zip", "html", "htm", "js", "mjs", "cjs", "ts", "tsx", "jsx", "css", "py", "sql",
                        "yml", "yaml", "heic", "mp4", "mov", "m4v", "webm", "3gp", "m4a", "mp3", "wav", "ogg"})
TOKEN_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"
_INDEX_KEY = re.compile(r"0|[1-9][0-9]*")
_DECIMAL = re.compile(r"[+-]?(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][+-]?[0-9]+)?")


def _payload(payload: Any) -> dict:
    return payload if isinstance(payload, dict) else {}


def _edition(sess: L.Session, eid: str) -> str:
    """The edition that let this write in, '' for an admin, a manager or the service."""
    return eid if F.by_edition(sess, eid) else ""


def _record(reads: L.Reads, tab: str, key: str, subject: str, cells: dict, edition: str) -> dict:
    """updateRowById_ on the row's own table: the cells it sets and updatedAt; {} once written (the row is gone: a
    Defer, so the door says it could not be saved)."""
    resource = F.resource_of(tab)
    hit = RR.find(reads, resource, key)
    if hit is None:
        raise Defer(f"no row {key} in {resource}")
    RR.update(reads, resource, hit[0], hit[1], {k: W.sheet_text(v) if not isinstance(v, str) else v
                                                for k, v in {**cells, "updatedAt": W.now_iso(reads)}.items()},
              "forms")
    return {}


def _kept(answer: dict[str, Any], edits: list[dict], subject: str, fresh: tuple[str, ...], edition: str) -> Decision:
    """The answer of a write already kept in its table."""
    return Decision(answer, subject=subject, own=True)


# ---- formSave's own rules -----------------------------------------------------------------------------------------

def _length(v: Any) -> int | None:
    """v.length, for the values that have one."""
    if isinstance(v, (list, str)):
        if isinstance(v, str) and any(ord(ch) > 0xFFFF for ch in v):
            raise Defer("a length JavaScript counts by its own units")
        return len(v)
    return None


def _number(v: Any) -> float:
    """Number(v), for the values a question's file count holds."""
    if isinstance(v, bool):
        return 1.0 if v else 0.0
    if isinstance(v, (int, float)):
        return float(v)
    if isinstance(v, str):
        s = gsjs.trim(v)
        if not s:
            return 0.0
        if _DECIMAL.fullmatch(s):
            return float(s)
        if s in ("Infinity", "+Infinity", "-Infinity"):
            return float(s.replace("Infinity", "inf"))
    raise Defer("a file count JavaScript would turn into a number its own way")


def _file_check(f: dict) -> str:
    """formFileFieldCheck_."""
    key = F.text_or(f.get("key"))
    ctx = F.text_or(f.get("context"), "forms")
    if ctx in F.PROTO_NAMES:
        raise Defer("an upload context every JavaScript object answers")
    if ctx not in UPLOAD_MAX_FILES:
        return f'Question "{key}" names an unknown upload context "{ctx}".'
    raw = f.get("max_files")
    count = _number(UPLOAD_MAX_FILES[ctx] if F.falsy(raw) else raw)
    if not (1 <= count <= 10):
        return f'Question "{key}" allows {gsjs.num_str(count)} files — 1 to 10 is the range.'
    accept = f.get("accept")
    if not F.falsy(accept) and _length(accept):
        for ext in (list(accept) if isinstance(accept, (list, str)) else []):
            if gsjs.js_str(ext).lower() not in FILE_TYPES:
                # the words book may carry it: Apps Script's to say
                raise Defer("a file type the base list does not carry")
    return ""


def check_fields(fields: Any) -> str:
    """formCheckFields_: refuse a definition rather than store one that cannot be drawn."""
    if not isinstance(fields, list):
        return "The questions must be a list."
    if not fields:
        return "A form with no questions collects nothing."
    seen: set[str] = set()
    questions = 0
    for i, item in enumerate(fields):
        f = item if isinstance(item, dict) else {}
        key = gsjs.trim(F.text_or(f.get("key")))
        if not KEY.fullmatch(key):
            return (f"Question {i + 1} needs a key of lower-case letters, digits and underscores — it is the column "
                    "the answer is stored under.")
        if key in seen or key in F.PROTO_NAMES:
            return f'Two questions both call themselves "{key}".'
        seen.add(key)
        kind = F.text_or(f.get("kind"), "text")
        if kind in F.PROTO_NAMES:
            raise Defer("a kind of question every JavaScript object answers")
        if kind not in F.KINDS:
            return f'"{kind}" is not a kind of question. Use one of: {", ".join(F.KINDS)}.'
        if kind == "heading":
            if not gsjs.trim(F.text_or(f.get("label"))) and not gsjs.trim(F.text_or(f.get("help"))):
                return f"Heading {i + 1} says nothing — give it a title or a text."
            continue
        questions += 1
        if not gsjs.trim(F.text_or(f.get("label"))):
            return f'Question "{key}" has no label, so nobody would know what to answer.'
        if kind in NEEDS_OPTIONS and not (not F.falsy(f.get("options")) and _length(f.get("options"))):
            return f'Question "{key}" offers a choice of nothing.'
        if kind == "file":
            bad = _file_check(f)
            if bad:
                return bad
        fact = gsjs.trim(F.text_or(f.get("fact")))
        if fact:
            if fact in F.PROTO_NAMES:
                raise Defer("a fact every JavaScript object answers")
            if fact not in FACTS:
                return (f'Question "{key}" says it feeds "{fact}", which this platform does not carry. One of: '
                        f'{", ".join(FACTS)}.')
            if kind not in FACTS[fact]:
                return f'Question "{key}" feeds "{fact}", which needs {" or ".join(FACTS[fact])} — not {kind}.'
    if not questions:
        return "A form with no questions collects nothing."
    if questions > MAX_FIELDS:
        return (f"That is {questions} questions. Sixty is the cap — past it nobody finishes the form and the answers "
                "stop being worth having.")
    return ""


def _plain(v: Any) -> Any:
    """The parsed questions as JSON.stringify writes them; a value it would write its own way is Apps Script's."""
    if isinstance(v, dict):
        if any(_INDEX_KEY.fullmatch(k) for k in v):
            raise Defer("an object JavaScript orders by its index keys")
        return {k: _plain(x) for k, x in v.items()}
    if isinstance(v, list):
        return [_plain(x) for x in v]
    if isinstance(v, bool) or v is None:
        return v
    if isinstance(v, int):
        if abs(v) > 2 ** 53:
            raise Defer("a number past JavaScript's exact integers")
        return v
    if isinstance(v, float):
        if not math.isfinite(v) or v != int(v) or abs(v) >= 1e21:
            raise Defer("a number JavaScript writes its own way")
        return int(v)
    if isinstance(v, str) and any(0xD800 <= ord(ch) <= 0xDFFF for ch in v):
        raise Defer("a lone surrogate JavaScript escapes its own way")
    return v


def stringify(v: Any) -> str:
    """JSON.stringify(fields)."""
    return json.dumps(_plain(v), separators=(",", ":"), ensure_ascii=False)


def mint_token() -> str:
    """formMintToken_: 24 characters of real randomness — the part of the link that is a key."""
    return "".join(secrets.choice(TOKEN_ALPHABET) for _ in range(24))


# ---- the doors ----------------------------------------------------------------------------------------------------

def form_save(sess: L.Session, payload: dict) -> Decision:
    """formSave: create or change one form."""
    p = _payload(payload)
    refused = F.gate(sess, "formSave", p, F.EDITION["links"])
    if refused:
        return Decision(refused)
    reads = sess.reads
    slug = gsjs.trim(F.text_or(p.get("slug"))).lower()
    if not SLUG.fullmatch(slug):
        return W.refuse(400, "The link name must be lower-case letters, digits and hyphens — it is what people will "
                             "see.")
    title = gsjs.trim(F.text_or(p.get("title")))
    if not title:
        return W.refuse(400, "The form needs a title.")
    fields = p.get("fields")
    if isinstance(fields, str):
        try:
            fields = json.loads(fields, parse_constant=F.no_constant)
        except (ValueError, RecursionError):
            fields = None
    bad = check_fields(fields)
    if bad:
        return W.refuse(400, bad)
    status = F.text_or(p.get("status"), "draft").lower()
    if status not in STATUSES:
        status = "draft"
    fresh = F.books(reads, F.FORMS_TAB)
    existing = F.form_by_slug(reads, slug)
    if existing is not None and gsjs.str_(existing.get("archived")).lower() == "true":
        return W.refuse(409, "This form is archived — restore it first (Archived filter on the Forms screen).",
                        fresh=fresh)
    record: dict[str, Any] = {"slug": slug, "title": title, "intro": gsjs.trim(F.text_or(p.get("intro"))),
                              "fields": stringify(fields), "status": status}
    # a status flip from the list sends no settings, and blanks none of them
    for name in ("notify_to", "thank_you", "closed_message"):
        if name in p:
            record[name] = gsjs.trim(F.text_or(p.get(name)))
    if "asks_contact" in p:
        record["asks_contact"] = "no" if p.get("asks_contact") is False or p.get("asks_contact") == "no" else "yes"
    W.gate(reads)
    edition = _edition(sess, F.EDITION["links"])
    if existing is not None:
        rid = gsjs.str_(existing.get("id"))
        token = gsjs.str_(existing.get("token"))
        if token.startswith(F.COPY_MARKER):
            raise Defer("the copy withholds the link's key")
        if not token:
            token = record["token"] = mint_token()
        edits = [_record(reads, F.FORMS_TAB, rid, slug, record, edition)]
    else:
        token = record["token"] = mint_token()
        record["created_by"] = gsjs.str_((sess.user or {}).get("email"))
        stamp = W.now_iso(reads)
        rid = W.mint()
        row = {**record, "id": rid, "createdAt": stamp, "updatedAt": stamp}
        RR.create(reads, F.resource_of(F.FORMS_TAB), row, record["created_by"])
        edits = []
    url = F.public_url({"slug": slug, "token": token})
    answer = {"status": 200, "data": {
        "slug": slug, "status": status, "url": url, "field_count": len(fields),
        "note": NOTE_OPEN if status == "open" else "Saved as " + status + ". The link answers nothing until it is open."}}
    return _kept(answer, edits, slug, fresh, edition)


def submission_handle(sess: L.Session, payload: dict) -> Decision:
    """formSubmissionHandle: mark one answer dealt with — or put it back."""
    p = _payload(payload)
    refused = F.gate(sess, "formSubmissionHandle", p, F.EDITION["answers"])
    if refused:
        return Decision(refused)
    reads = sess.reads
    rid = gsjs.str_(p.get("id"))
    if not rid:
        return W.refuse(400, "Which answer?")
    state = F.text_or(p.get("state"), "handled").lower()
    if state not in ("new", "handled"):
        state = "handled"
    answer = {"status": 200, "data": {"id": rid, "state": state}}
    fresh = F.books(reads, F.SUBMISSIONS_TAB)
    W.gate(reads)
    row = next((r for r in F.rows(reads, F.SUBMISSIONS_TAB) if gsjs.or_blank(r.get("id")) == rid), None)
    if row is None:
        # updateRowById_ finds no such row and the door answers as it does: nothing written
        return Decision(answer, fresh=fresh)
    handled = state == "handled"
    user = sess.user or {}
    cells = {"state": state, "handled_by": gsjs.str_(user.get("email")) if handled else "",
             "handled_at": W.now_iso(reads) if handled else "", "note": gsjs.trim(F.text_or(p.get("note")))}
    edition = _edition(sess, F.EDITION["answers"])
    return _kept(answer, [_record(reads, F.SUBMISSIONS_TAB, rid, rid, cells, edition)], rid, fresh, edition)


def form_archive(sess: L.Session, payload: dict) -> Decision:
    """formArchive: nothing is deleted — the form archived (closed, its link answering 404) or restored."""
    p = _payload(payload)
    refused = F.gate(sess, "formArchive", p, F.EDITION["links"])
    if refused:
        return Decision(refused)
    reads = sess.reads
    fresh = F.books(reads, F.FORMS_TAB)
    row = F.form_by_slug(reads, p.get("slug"))
    if row is None:
        return W.refuse(404, "No form by that name.", fresh=fresh)
    hide = p.get("archived") is not False
    user = sess.user or {}
    stamp = W.now_iso(reads)
    cells = {"archived": "true" if hide else "false", "archived_at": stamp if hide else "",
             "archived_by": gsjs.str_(user.get("email")) if hide else "",
             "archived_reason": CW.js_cut(F.text_or(p.get("reason")), 200) if hide else "",
             "status": "closed" if hide else gsjs.str_(row.get("status"))}
    slug = gsjs.str_(row.get("slug"))
    W.gate(reads)
    edition = _edition(sess, F.EDITION["links"])
    answer = {"status": 200, "data": {"slug": slug, "archived": hide, "note": NOTE_ARCHIVED if hide else NOTE_RESTORED}}
    rid = gsjs.str_(row.get("id"))
    return _kept(answer, [_record(reads, F.FORMS_TAB, rid, slug, cells, edition)], slug, fresh, edition)


def form_rename(sess: L.Session, payload: dict) -> Decision:
    """formRename: the title only, so a name can be edited in Forms; the link stays the same."""
    p = _payload(payload)
    refused = F.gate(sess, "formRename", p, F.EDITION["links"])
    if refused:
        return Decision(refused)
    reads = sess.reads
    fresh = F.books(reads, F.FORMS_TAB)
    row = F.form_by_slug(reads, p.get("slug"))
    if row is None:
        return W.refuse(404, "No form by that name.", fresh=fresh)
    title = gsjs.trim(F.text_or(p.get("title")))
    if not title:
        return W.refuse(400, "The form needs a name.", fresh=fresh)
    slug = gsjs.str_(row.get("slug"))
    answer = {"status": 200, "data": {"slug": slug, "title": title}}
    if title == gsjs.str_(row.get("title")):
        return Decision(answer, fresh=fresh)
    W.gate(reads)
    edition = _edition(sess, F.EDITION["links"])
    rid = gsjs.str_(row.get("id"))
    return _kept(answer, [_record(reads, F.FORMS_TAB, rid, slug, {"title": title}, edition)], slug, fresh, edition)


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {
    "formSave": form_save, "formSubmissionHandle": submission_handle, "formArchive": form_archive,
    "formRename": form_rename,
}
# the roles and params are each door's own gate (an edition lets its people in beside the roles)
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
# the platform's write lock held by another write
BUSY_OF: dict[str, dict[str, Any]] = {a: {"status": 409, "message": BUSY} for a in ACTIONS}


class Store(RR.Store):
    """app.forms_writes and app.forms_receipts, beside the other apps' own; a void takes its rows' changes back."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="forms", label="Forms")
