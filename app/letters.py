"""The letters Apps Script wrote through hubLetterSend_ from its sweeps and its public form door, written by Python
instead: a public form's answer to the address the form names (Forms.gs formNoticeLetter_, `form_answer_notice`), a
form file the digester gave up on (Digest.gs digestStalledLetter_, `form_file_stalled`) and each call-off into the
platform's own mailbox (Estate.gs callOffsNoteLetter_, `calloff_mailbox_note`). Only what was filed after the moment
they became Python's is told (app.letters_state), each once by its key (app.letters_told); letters_writes.py raises
them through Smart Comms, whose outbox holds them through the quiet window. lettersDue is the relay's look before its
clock rings lettersSweep."""
from __future__ import annotations

import re
from typing import Any, Callable

import call_offs as CO
import forms as F
import gsjs
import locations as L
import resource_rows as RR
import smart_comms as SC

APP_ID = "letters"
TOLD = "app.letters_told"
STATE = "app.letters_state"
FORM, STALLED, CALLOFF = "form_answer", "form_stalled", "calloff_note"
SITUATIONS = {FORM: "form_answer_notice", STALLED: "form_file_stalled", CALLOFF: "calloff_mailbox_note"}
# the digest ledger's own name for the form files (DIGEST_LEDGERS' res), which the stalled letter's key carries
FILES_RES = "formFiles"
# Estate.gs CALLOFFS_MAIL_CAP: a flood becomes several passes
CALLOFF_CAP = 20
_FIELD = re.compile(r"\{(\w+)\}")

s_ = gsjs.str_


def render(tpl: Any, v: dict[str, Any]) -> str:
    """hubLetterRender_: a named value fills its placeholder, an empty one too; an unnamed one is left as written."""
    return _FIELD.sub(lambda m: (gsjs.js_str(v[m.group(1)]) if v[m.group(1)] is not None else "")
                      if m.group(1) in v else m.group(0), gsjs.js_str(tpl) if tpl is not None else "")


def _ms(v: Any) -> float | None:
    return gsjs.date_parse(gsjs.or_text(v))


def since_ms(reads: L.Reads) -> float | None:
    """The moment the letters became Python's; None before the first sweep."""
    got = RR._q(reads, f"select extract(epoch from since) * 1000 from {STATE} where id = 1")
    return float(got[0][0]) if got else None


def told_keys(reads: L.Reads) -> set[str]:
    return {k for (k,) in RR._q(reads, f"select key from {TOLD}")}


def _letter(lane: str, ref: str, to: str, vars_: dict[str, Any], subject_floor: str, text_floor: str,
            sit: dict | None) -> dict[str, Any]:
    """hubLetterSend_'s words: the row's subject and text, or the lane's own floor where a cell is blank."""
    row = sit or {}
    return {"lane": lane, "key": lane + "|" + ref if lane != STALLED else STALLED + "|" + FILES_RES + "|" + ref,
            "ref": ref, "situation": SITUATIONS[lane], "to": to,
            "subject": render(s_(row.get("email_subject")) or subject_floor, vars_),
            "body": render(s_(row.get("email_text")) or text_floor, vars_)}


def form_notice(reads: L.Reads, form: dict, sub: dict, sit: dict | None) -> dict[str, Any] | None:
    """formNoticeLetter_ for a filed answer; None when the form names nobody to tell."""
    to = s_(form.get("notify_to"))
    if not to:
        return None
    answers = dict(F.answer_items(sub.get("answers")))
    lines = []
    for f in F.fields_of(form):
        f = f if isinstance(f, dict) else {}
        k = gsjs.or_text(f.get("key"))
        if not gsjs.falsy(answers.get(k)):
            lines.append((gsjs.or_text(f.get("label")) or k) + ": " + gsjs.js_str(answers[k]))
    head = []
    for word, field in (("From: ", "name"), ("E-mail: ", "email"), ("Phone: ", "phone")):
        if s_(sub.get(field)):
            head.append(word + s_(sub.get(field)))
    return _letter(FORM, s_(sub.get("id")), to, {"form_title": s_(form.get("title")),
                                                 "answers": "\n".join(head + [""] + lines)},
                   "{form_title} — a new answer", "{answers}", sit)


def stalled_notice(reads: L.Reads, form: dict | None, row: dict, sit: dict | None) -> dict[str, Any] | None:
    """digestStalledLetter_: None when the file's form names nobody to tell."""
    to = s_((form or {}).get("notify_to"))
    if not to:
        return None
    return _letter(STALLED, s_(row.get("id")), to,
                   {"form_title": s_((form or {}).get("title")) or "a form",
                    "file_name": s_(row.get("file_name")) or "a file"},
                   "A file did not go through — {file_name}",
                   'A file sent through "{form_title}" could not be read: {file_name}.\n\n'
                   "Please send it again. If it is a long video, a shorter clip works better — or send the part that "
                   "matters.\n\nNothing else about the submission was lost.", sit)


def calloff_note(r: dict, n: int, mailbox: str, sit: dict | None) -> dict[str, Any]:
    """callOffsNoteLetter_: one call-off into the platform's own mailbox."""
    date = s_(r.get("date"))
    details = ("Type: " + s_(r.get("type")) + "\nEmployee: " + s_(r.get("employee_name")) + "\nShift date: " + date
               + ("\nHow late: " + s_(r.get("how_late")) if s_(r.get("how_late")) else "")
               + ("\nNotes: " + s_(r.get("notes")) if s_(r.get("notes")) else "")
               + ("\nReported by: " + s_(r.get("your_name")) if s_(r.get("your_name")) else "")
               + ("\nForm time: " + s_(r.get("timestamp")) if s_(r.get("timestamp")) else ""))
    return _letter(CALLOFF, s_(r.get("id")) or str(n), mailbox,
                   {"type": s_(r.get("type")) or "Call Off", "employee": s_(r.get("employee_name")) or "unknown",
                    "date_part": " (" + date + ")" if date else "", "details": details},
                   "{type} — {employee}{date_part}", "{details}", sit)


def due(reads: L.Reads, since: float, told: set[str]) -> list[dict[str, Any]]:
    """Every letter owed for what was filed at or after `since` and not told yet, in the order each lane files."""
    sits = SC.read_situations(reads.db)
    sit = {lane: SC.situation_row(sits, sid) for lane, sid in SITUATIONS.items()}
    forms = {s_(f.get("slug")).lower(): f for f in F.rows(reads, F.FORMS_TAB) if s_(f.get("slug"))}
    out: list[dict[str, Any]] = []
    for sub in F.rows(reads, F.SUBMISSIONS_TAB):
        at = _ms(sub.get("submitted_at")) or _ms(sub.get("createdAt"))
        sid = s_(sub.get("id"))
        if not sid or at is None or at < since or FORM + "|" + sid in told:
            continue
        form = forms.get(s_(sub.get("form_slug")).lower())
        got = form_notice(reads, form, sub, sit[FORM]) if form else None
        out.append(got or {"lane": FORM, "key": FORM + "|" + sid, "ref": sid, "situation": SITUATIONS[FORM],
                           "none": "the form names nobody to tell"})
    for row in F.rows(reads, F.FILES_TAB):
        rid = s_(row.get("id"))
        key = STALLED + "|" + FILES_RES + "|" + rid
        at = _ms(row.get("updatedAt")) or _ms(row.get("createdAt"))
        if not rid or s_(row.get("digest_state")) != "stalled" or at is None or at < since or key in told:
            continue
        got = stalled_notice(reads, forms.get(s_(row.get("form_slug")).lower()), row, sit[STALLED])
        out.append(got or {"lane": STALLED, "key": key, "ref": rid, "situation": SITUATIONS[STALLED],
                           "none": "the file's form names nobody to tell"})
    mailbox = gsjs.trim(gsjs.or_blank(reads.db.prop("PLATFORM_EMAIL")))
    n_calloffs = 0
    for i, r in enumerate(CO.rows(reads)):
        n = i + 2
        at = _ms(r.get("createdAt"))
        key = CALLOFF + "|" + (s_(r.get("id")) or str(n))
        if at is None or at < since or key in told:
            continue
        if not mailbox:
            # no mailbox configured: the house still holds the rows, and nothing is told until there is one
            break
        if n_calloffs >= CALLOFF_CAP:
            break
        n_calloffs += 1
        out.append(calloff_note(r, n, mailbox, sit[CALLOFF]))
    return out


def still(reads: L.Reads, lane: str, ref: str) -> str:
    """Why an owed letter is no longer true ('' while it is): its answer gone, or its file no longer stalled."""
    if lane == FORM:
        sub = next((r for r in F.rows(reads, F.SUBMISSIONS_TAB) if s_(r.get("id")) == ref), None)
        if sub is None:
            return "the answer " + ref + " is no longer filed"
        form = F.form_by_slug(reads, sub.get("form_slug"))
        if form is None or not s_(form.get("notify_to")):
            return "the form no longer names anybody to notify"
    elif lane == STALLED:
        row = next((r for r in F.rows(reads, F.FILES_TAB) if s_(r.get("id")) == ref), None)
        if row is None:
            return "the file's row " + ref + " is gone"
        if s_(row.get("digest_state")) != "stalled":
            return "the file is no longer stalled (" + (s_(row.get("digest_state")) or "no state") + ")"
    return ""


def owed(reads: L.Reads) -> list[tuple[str, str, str]]:
    """(key, lane, ref) of every told letter the outbox still owes."""
    return [(k, ln, ref) for k, ln, ref in RR._q(
        reads,
        f"select t.key, t.lane, t.ref from {TOLD} t where exists (select 1 from {SC.OUTBOX} o where o.idem_key = t.key"
        " and o.state = 'owed')", ())]


def letters_due(sess: L.Session, payload: dict) -> dict[str, Any]:
    """The relay's look before it rings the sweep: how many letters wait, and how many owed ones stopped being true."""
    if (sess.user or {}).get("is_service") is not True:
        return {"status": 403, "message": "This is the relay's own read."}
    reads = sess.reads
    since = since_ms(reads)
    if since is None:
        return {"status": 200, "data": {"ready": False, "due": 0, "untrue": 0}}
    waiting = due(reads, since, told_keys(reads))
    untrue = sum(1 for _k, lane, ref in owed(reads) if lane != CALLOFF and still(reads, lane, ref))
    return {"status": 200, "data": {"ready": True, "due": len(waiting), "untrue": untrue}}


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {"lettersDue": letters_due}
POLICY: dict[str, dict[str, Any]] = {"lettersDue": {}}
