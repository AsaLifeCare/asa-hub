"""The public form's writes (Forms.gs formPublicSubmitPub_, FormAnswers.gs formAnswersAppend_, FormFiles.gs
formPublicFileStorePub_ and formFileAnswer_'s filing) decided off asa-hub-db and kept in Forms' own tables under the Forms
store: an answer filed (form_submissions), the files it carried on the decoder's ledger (form_files, pending their
decoding) and one row per answered question (form_answers); a file stored ahead of its answer, on the asset's trail
(asset_events). Their Drive halves are prepare reads (app/forms_public.py); the answer's notice is written from the
filed row and raised through Smart Comms (app/letters.py)."""
from __future__ import annotations

import json
import re
from typing import Any, Callable

import client_writes as CW
import form_file_store as FFS
import forms as F
import forms_public as FP
import gsjs
import locations as L
import recon as R
import resource_rows as RR
import smart_comms_desk as SCD
import writes as W
from scope import Defer
from writes import Decision

ANSWERS_TAB = "form_answers"
_NAME_KEY = re.compile(r"(^|_)(full_?name|your_?name|name)\Z")
_EMAIL = re.compile(r"[^@\s]+@[^@\s]+\.[a-z]{2,}\Z", re.I)
_ISO_DAY = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}")
_US_DAY = re.compile(r"([0-9]{1,2})[/\-.]([0-9]{1,2})[/\-.]((?:20)?[0-9]{2})")

s_ = gsjs.str_


def append(reads: L.Reads, tab: str, row: dict, subject: str, now: str) -> dict:
    """createRow_ on the tab's own table: the row, an id, createdAt and updatedAt stamped; {row_key: its id}."""
    row = {**row, "id": W.mint(), "createdAt": now, "updatedAt": now}
    RR.create(reads, F.resource_of(tab), {k: gsjs.js_str(v) if v is not None else "" for k, v in row.items()},
              subject)
    return {"row_key": row["id"]}


def uploader(submission: dict) -> tuple[str, str]:
    """formFileUploader_: the contact block first, then name- and address-shaped answers; never a guessed uploader."""
    name, email = s_(submission.get("name")), s_(submission.get("email"))
    if name and email:
        return name, email
    answers = submission.get("answers")
    if isinstance(answers, str):
        try:
            answers = json.loads(answers or "{}", parse_constant=F.no_constant)
        except (ValueError, RecursionError):
            answers = None
    if isinstance(answers, dict):
        for k, raw in answers.items():
            v = gsjs.trim(gsjs.or_blank(raw))
            if not v:
                continue
            if not name and _NAME_KEY.search(gsjs.js_str(k).lower()) and len(v.encode("utf-16-le")) // 2 < 80 \
                    and "{" not in v:
                name = v
            if not email and _EMAIL.match(v):
                email = v
    return name, email


def answer_date(raw: str) -> str:
    """formAnswerDate_: an ISO day, or a month/day/year one, as YYYY-MM-DD; '' for anything else."""
    s = gsjs.trim(raw)
    if _ISO_DAY.match(s):
        return s[:10]
    m = _US_DAY.fullmatch(s)
    if not m:
        return ""
    y = 2000 + int(m[3]) if len(m[3]) == 2 else int(m[3])
    mo, d = int(m[1]), int(m[2])
    if mo < 1 or mo > 12 or d < 1 or d > 31 or y < 2000 or y > 2100:
        return ""
    return f"{y}-{mo:02d}-{d:02d}"


def answer_rows(reads: L.Reads, form: dict, sub_id: str, answers: dict[str, str], who: dict[str, str],
                now: str) -> list[dict]:
    """formAnswersAppend_: what the person said, one row per question, typed per its shape; a file answer has its own
    ledger."""
    slug = s_(form.get("slug"))
    out = []
    for item in F.fields_of(form):
        f = item if isinstance(item, dict) else {}
        kind = FP.kind_of(f)
        if kind == "heading":
            continue
        key = s_(f.get("key"))
        if not key or answers.get(key) is None:
            continue
        value = gsjs.trim(answers[key])
        if not value or value[0] in "[{":
            continue
        row = {"form_slug": slug, "submission_id": sub_id, "field_key": key, "field_label": s_(f.get("label")) or key,
               "field_kind": kind, "fact": FP.fact_of(reads, key, f.get("label"), f.get("fact")), "answer_text": "",
               "answer_date": "", "answer_choice": "", "answer_number": "",
               "answered_by": s_(who.get("email")) or s_(who.get("name")), "subject_kind": "", "subject_key": "",
               "subject_name": "", "file_id": "", "asset_id": "", "doc_kind": "", "found": "", "agree": "",
               "note": "", "checked_at": "", "decoder_v": ""}
        iso = answer_date(value)
        if kind == "date" or (iso and "_on" in row["fact"]):
            row["answer_date"] = iso
            if not iso:
                row["answer_text"] = CW.js_cut(value, 500)
        elif kind in ("choice", "multi", "select"):
            row["answer_choice"] = CW.js_cut(value, 500)
        elif kind == "number" and gsjs.num_str(SCD.js_number(value)) == value:
            row["answer_number"] = value
        else:
            row["answer_text"] = CW.js_cut(value, 2000)
            if iso:
                row["answer_date"] = iso
        out.append(append(reads, ANSWERS_TAB, row, slug, now))
    return out


def submit(sess: L.Session, payload: dict) -> Decision:
    """formPublicSubmit: one answer, filed — then the files it carried on the decoder's ledger, pending, and what the
    person said, one row per question."""
    p = FP.payload_of(payload)
    prep = R.unsealed(FP.SUBMIT, FP.sealed_by(p), p.get("prepared"))
    if prep is None:
        raise Defer("formPublicSubmit's files are read in Drive by formPublicSubmitPrepare first")
    reads = sess.reads
    fresh = F.books(reads, F.FORMS_TAB)
    row, refused = FP.link(reads, p, FP.CLOSED)
    if refused:
        return W.refuse(refused["status"], refused["message"], fresh=fresh)
    FP.device_session(p)
    given = FP.answers_of(p)
    files = prep.get("files") if isinstance(prep.get("files"), dict) else {}
    answers: dict[str, str] = {}
    missing: list[str] = []
    carried: list[tuple[str, list[dict]]] = []
    for i, item in enumerate(F.fields_of(row)):
        f = item if isinstance(item, dict) else {}
        key = F.text_or(f.get("key"))
        kind = FP.kind_of(f)
        if kind == "heading":
            continue
        if key in F.PROTO_NAMES:
            raise Defer("a question named as every JavaScript object answers")
        if kind == "file":
            kept = FP.prepared_files(files, i, key)
            v = CW.js_cut(FP.compact(kept), FP.MAX_ANSWER) if kept else ""
            if kept:
                carried.append((key, kept))
        else:
            v = FP.plain(given.get(key))
        # a question the form did not ask is not stored
        if v:
            answers[key] = v
        if gsjs.js_str(f.get("required")) == "true" and not v:
            missing.append(gsjs.js_str(f["label"]) if not F.falsy(f.get("label")) else key)
    if missing:
        return W.refuse(400, "Still needed: " + ", ".join(missing) + ".", fresh=fresh)
    if not answers:
        return W.refuse(400, "Nothing was filled in.", fresh=fresh)
    who = FP.who_of(p)
    W.gate(reads)
    now = W.now_iso(reads)
    slug = s_(row.get("slug"))
    record = {"form_id": s_(row.get("id")), "form_slug": slug, "form_title": s_(row.get("title")),
              "submitted_at": now, "name": who["name"], "email": who["email"], "phone": who["phone"],
              "answers": FP.stringify(answers), "state": "new", "handled_by": "", "handled_at": "", "note": ""}
    filed = append(reads, F.SUBMISSIONS_TAB, record, slug, now)
    sub_id = filed["row_key"]
    edits = [filed]
    claimed: list[str] = []
    if carried:
        # deduped against the ledger, so a doubled submit never mints twin rows
        known = {s_(r.get("file_id")) for r in F.rows(reads, F.FILES_TAB)}
        by_name, by_email = uploader(record)
        for key, kept in carried:
            for h in kept:
                fid = s_(h.get("fid"))
                if fid in known:
                    continue
                known.add(fid)
                size = h.get("size")
                # the identity comes from the Drive object stamped at capture, never from the browser
                edits.append(append(reads, F.FILES_TAB, {
                    "form_slug": slug, "submission_id": sub_id, "field_key": key, "file_id": fid,
                    "file_url": s_(h.get("url")), "file_name": gsjs.or_blank(h.get("name")),
                    "asset_id": s_(h.get("asset_id")), "sha256": s_(h.get("sha256")),
                    "mime_type": gsjs.or_blank(h.get("mime")), "size_bytes": gsjs.num_str(size) if size else "",
                    "uploaded_by_name": by_name, "uploaded_by_email": by_email, "digest_state": "pending",
                    "digest_kind": "", "digest_category": "", "digest_dates": "", "digest_names": "",
                    "digest_text_chars": "", "digest_text": "", "digest_json": "", "digest_error": "",
                    "digested_at": ""}, slug, now))
                claimed.append(fid)
    edits += answer_rows(reads, row, sub_id, answers, who, now)
    FP.line("form_submitted", s_(row.get("title")) + (" — " + who["name"] if who["name"] else ""))
    answer: dict[str, Any] = {"status": 200,
                              "data": {"filed": True, "thank_you": s_(row.get("thank_you")) or FP.THANKS}}
    if claimed:
        # the relay's to carry out once the rows are kept: these files lose their pending__ names
        answer["_after"] = {"files": claimed}
    return Decision(answer, subject=slug, own=True)


def file_store(sess: L.Session, payload: dict) -> Decision:
    """formPublicFileStore: the file its prepare read filed, answered; a new capture put on the asset's trail. Its
    ledger row waits for the submit that claims it."""
    p = FP.payload_of(payload)
    got = FFS._handle(p)
    if got is None:
        return W.refuse(503, FFS.UNFILED)
    reads = sess.reads
    data = {k: v for k, v in got.items() if k not in ("context", "slug")}
    slug = s_(got.get("slug"))
    if not got.get("reused"):
        FFS.asset_event(reads, s_(data.get("asset_id")), s_(got.get("context")), s_(data.get("file_name")), data,
                        W.now_iso(reads))
    FP.line("form_file_stored",
            f"{slug} — {s_(data.get('file_name'))} ({gsjs.or_blank(data.get('size_bytes'))} bytes)")
    return Decision({"status": 200, "data": data}, subject=slug, own=True)


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {"formPublicSubmit": submit,
                                                             "formPublicFileStore": file_store}
# no HUB_POLICY: the link's slug and token are each door's gate
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
# what nobody's account may ask; no BUSY_OF: while another write holds the lock, Apps Script answers the door
PUBLIC = frozenset(ACTIONS)
