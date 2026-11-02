"""Forms (apps-script/Forms.gs, FormFiles.gs) read off asa-hub-db: the forms with their links, a form's answers and
the files they carried."""
from __future__ import annotations

import json
import urllib.parse
from typing import Any, Callable

import client_writes as CW
import gsjs
import locations as L
import scope as sc
from scope import Defer

APP_ID = "forms"
FORMS_TAB = "forms"
SUBMISSIONS_TAB = "form_submissions"
FILES_TAB = "form_files"
ANSWERS_TAB = "form_answers"
ASSET_EVENTS_TAB = "asset_events"
# each Forms tab's own table (sheet_resources.SPECS)
RESOURCES = {FORMS_TAB: "forms", SUBMISSIONS_TAB: "formSubmissions", FILES_TAB: "formFiles",
             ANSWERS_TAB: "formAnswers", ASSET_EVENTS_TAB: "assetEvents"}
# Settings › Editions: who else, beside the admins, the managers and the master
EDITION = {"answers": "forms.answers", "links": "forms.links"}
# hubIsWriter_ and the roles every Forms door declares (HUB_POLICY)
ROLES = ("admin", "manager")
ROLE_REFUSAL = "This action is for admin or manager."
SUBMISSIONS_MAX = 500
DIGEST_PREVIEW = 600
COPY_MARKER = "[withheld"
# PlatformMail.gs PLATFORM_MAIL_RELAY: where a form's public page answers
PUBLIC_BASE = "https://asamylife.asalifecare.com"
# FORM_FIELD_KINDS (Object.keys(FORM_KINDS)), in their order
KINDS = ("text", "long", "number", "date", "time", "phone", "email", "yes_no", "choice", "multi", "scale", "heading",
         "file")
# names every JavaScript object answers through its prototype: a lookup by one of them is never a plain miss
PROTO_NAMES = frozenset({"constructor", "__proto__", "hasOwnProperty", "isPrototypeOf", "propertyIsEnumerable",
                         "toLocaleString", "toString", "valueOf", "__defineGetter__", "__defineSetter__",
                         "__lookupGetter__", "__lookupSetter__"})
# HUB_POLICY params, in declaration order: (key, required, type)
PARAMS: dict[str, tuple[tuple[str, bool, str], ...]] = {
    "formsList": (),
    "formSubmissions": (("slug", False, "string"),),
    "formFilesList": (("form_slug", False, "string"), ("submission_id", False, "string")),
    "formSave": (("slug", True, "string"), ("title", True, "string"), ("fields", True, "string")),
    "formSubmissionHandle": (("id", True, "string"), ("state", False, "string")),
    "formArchive": (("slug", True, "string"), ("archived", False, "boolean"), ("reason", False, "string")),
    "formRename": (("slug", True, "string"), ("title", True, "string")),
}


def falsy(v: Any) -> bool:
    """!v in JavaScript."""
    if v is None or v is False or v == "":
        return True
    return isinstance(v, (int, float)) and not isinstance(v, bool) and (v == 0 or v != v)


def js_type(v: Any) -> str:
    """Array.isArray(v) ? 'array' : typeof v."""
    if isinstance(v, list):
        return "array"
    if isinstance(v, bool):
        return "boolean"
    if isinstance(v, (int, float)):
        return "number"
    return "string" if isinstance(v, str) else "object"


def text_or(v: Any, fallback: str = "") -> str:
    """String(v || fallback)."""
    return fallback if falsy(v) else gsjs.js_str(v)


def withheld(v: Any) -> bool:
    """A cell the copy keeps withheld anywhere in an answer: Apps Script's alone to show."""
    if isinstance(v, str):
        return v.startswith(COPY_MARKER)
    if isinstance(v, dict):
        return any(withheld(x) for x in v.values())
    if isinstance(v, list):
        return any(withheld(x) for x in v)
    return False


def shown(env: dict[str, Any]) -> dict[str, Any]:
    if withheld(env.get("data")):
        raise Defer("the copy withholds a cell this answer shows")
    return env


def resource_of(tab: str) -> str:
    """The Forms table a tab's rows live in (sheet_resources.SPECS)."""
    return RESOURCES[tab]


def rows(reads: L.Reads, tab: str) -> list[dict]:
    """Every row of a Forms table, as the table keeps it."""
    import sheet_resources as SR  # noqa: PLC0415 - it imports the apps this module serves

    return SR.rows(reads, resource_of(tab))


def raw_rows(reads: L.Reads, tab: str) -> list[dict]:
    """Each row's cells as their text: what a write names as the value before it."""
    return [{k: gsjs.trim(gsjs.or_blank(v)) for k, v in r.items()} for r in rows(reads, tab)]


def books(reads: L.Reads, *tabs: str) -> tuple[str, ...]:
    """The books a verdict on these tables rests on: none, a table being no copy of a book."""
    return ()


def form_by_slug(reads: L.Reads, slug: Any) -> dict | None:
    """formBySlug_: the copy's row for this link name, or None."""
    want = gsjs.trim(text_or(slug)).lower()
    if not want:
        return None
    return next((r for r in rows(reads, FORMS_TAB) if gsjs.str_(r.get("slug")).lower() == want), None)


def fields_of(row: dict | None) -> list:
    """formFields_: the questions, parsed."""
    raw = (row or {}).get("fields")
    if falsy(raw):
        return []
    if isinstance(raw, list):
        return raw
    try:
        got = json.loads(gsjs.js_str(raw))
    except (ValueError, RecursionError):
        return []
    return got if isinstance(got, list) else []


def encode_uri_component(s: str) -> str:
    """encodeURIComponent."""
    if any(0xD800 <= ord(ch) <= 0xDFFF for ch in s):
        raise Defer("a link name JavaScript refuses to encode")
    return urllib.parse.quote(s, safe="!'()*-._~")


def public_url(row: dict) -> str:
    """formPublicUrl_: the link a person is sent."""
    token = gsjs.str_(row.get("token"))
    if token.startswith(COPY_MARKER):
        raise Defer("the copy withholds the link's key")
    return (PUBLIC_BASE + "/form.html?f=" + encode_uri_component(gsjs.str_(row.get("slug"))) + "&t=" +
            encode_uri_component(token))


def answer_items(v: Any) -> list[tuple[str, Any]]:
    """Each answer under its question's key. listRows_ has already parsed the cell into an object; Apps Script put it
    back through str_ ("[object Object]") and flattened nothing, so its Answers page drew a dash under every question."""
    got = v
    if isinstance(v, str):
        try:
            got = json.loads(v, parse_constant=no_constant) if v.strip() else {}
        except (ValueError, RecursionError):
            return []
    return list(got.items()) if isinstance(got, dict) else []


def no_constant(name: str) -> Any:
    raise ValueError(f"JSON.parse has no {name}")


def writer(user: dict | None) -> bool:
    return CW.writer(user)


def edition_holds(sess: L.Session, eid: str) -> bool:
    """A person the edition lists, Forms open to them, from their own account."""
    user = sess.user or {}
    if user.get("is_service") is True or user.get("visiting_member"):
        return False
    if not sc.profile_app_gate(APP_ID, user, sess.reads.scope_sources()).get("open"):
        return False
    return sc.edition_allows(eid, user, sess.reads.config())


def by_edition(sess: L.Session, eid: str) -> bool:
    """Let in by the edition alone: neither the service nor an admin or a manager."""
    user = sess.user or {}
    return user.get("is_service") is not True and not writer(user) and edition_holds(sess, eid)


def gate(sess: L.Session, action: str, payload: dict, eids: str | tuple[str, ...]) -> dict[str, Any] | None:
    """hubPolicyGate_ (the declared roles, then each param in order), an edition's people let in beside the roles;
    then hubIsWriter_ for them too."""
    user = sess.user or {}
    held = (eids,) if isinstance(eids, str) else eids
    let_in = user.get("is_service") is True or gsjs.js_str(user.get("role")) in ROLES or \
        any(edition_holds(sess, e) for e in held)
    if not let_in:
        return {"status": 403, "message": ROLE_REFUSAL}
    for key, required, kind in PARAMS[action]:
        val = payload.get(key)
        missing = val is None or (isinstance(val, str) and val == "")
        if required and missing:
            return {"status": 400, "message": f"Missing required parameter: {key}."}
        if not missing and js_type(val) != kind:
            return {"status": 400, "message": f"{key} must be {kind}, got {js_type(val)}."}
    return None


def _payload(payload: Any) -> dict:
    return payload if isinstance(payload, dict) else {}


def _kind_of(f: Any) -> str:
    """String(f.kind) of one question, as the list's count reads it."""
    if f is None:
        raise Defer("a question that is null, which Apps Script's count stops at")
    return gsjs.js_str(f.get("kind")) if isinstance(f, dict) and "kind" in f else "undefined"


# ---- the reads ----------------------------------------------------------------------------------------------------

def forms_list(sess: L.Session, payload: dict) -> dict[str, Any]:
    """formsList: every form, with its link and how many answers it has taken."""
    p = _payload(payload)
    refused = gate(sess, "formsList", p, (EDITION["answers"], EDITION["links"]))
    if refused:
        return refused
    reads = sess.reads
    subs: dict[str, dict[str, int]] = {}
    for s in rows(reads, SUBMISSIONS_TAB):
        k = gsjs.str_(s.get("form_slug"))
        if not k:
            continue
        if k in PROTO_NAMES:
            raise Defer("an answer filed under a name every JavaScript object answers")
        count = subs.setdefault(k, {"total": 0, "unhandled": 0})
        count["total"] += 1
        if gsjs.str_(s.get("state")) != "handled":
            count["unhandled"] += 1
    want_archived = p.get("archived") is True
    out = []
    for r in rows(reads, FORMS_TAB):
        if (gsjs.str_(r.get("archived")).lower() == "true") != want_archived:
            continue
        slug = gsjs.str_(r.get("slug"))
        if slug in PROTO_NAMES:
            raise Defer("a form named as every JavaScript object answers")
        count = subs.get(slug) or {"total": 0, "unhandled": 0}
        fields = fields_of(r)
        out.append({"id": gsjs.str_(r.get("id")), "slug": slug, "title": gsjs.str_(r.get("title")),
                    "intro": gsjs.str_(r.get("intro")), "status": gsjs.str_(r.get("status")) or "draft",
                    "notify_to": gsjs.str_(r.get("notify_to")), "thank_you": gsjs.str_(r.get("thank_you")),
                    "fields": fields, "field_count": sum(1 for f in fields if _kind_of(f) != "heading"),
                    "url": public_url(r), "submissions": count["total"], "unhandled": count["unhandled"],
                    "source_url": gsjs.str_(r.get("source_url")), "updatedAt": gsjs.str_(r.get("updatedAt"))})
    return shown({"status": 200, "data": {"forms": out, "kinds": list(KINDS)}})


def form_submissions(sess: L.Session, payload: dict) -> dict[str, Any]:
    """formSubmissions: the answers, newest first, and the shape to draw them in."""
    p = _payload(payload)
    refused = gate(sess, "formSubmissions", p, EDITION["answers"])
    if refused:
        return refused
    reads = sess.reads
    slug = gsjs.trim(text_or(p.get("slug"))).lower()
    got = rows(reads, SUBMISSIONS_TAB)
    if slug:
        got = [r for r in got if gsjs.str_(r.get("form_slug")).lower() == slug]
    got.sort(key=lambda r: gsjs.str_(r.get("submitted_at")), reverse=True)
    out = []
    for r in got[:SUBMISSIONS_MAX]:
        flat: dict[str, Any] = {"id": gsjs.str_(r.get("id")), "form_slug": gsjs.str_(r.get("form_slug")),
                                "form_title": gsjs.str_(r.get("form_title")),
                                "submitted_at": gsjs.str_(r.get("submitted_at")), "name": gsjs.str_(r.get("name")),
                                "email": gsjs.str_(r.get("email")), "phone": gsjs.str_(r.get("phone")),
                                "state": gsjs.str_(r.get("state")) or "new",
                                "handled_by": gsjs.str_(r.get("handled_by")), "note": gsjs.str_(r.get("note"))}
        for k, v in answer_items(r.get("answers")):
            if k not in flat:
                flat[k] = v
        out.append(flat)
    form = form_by_slug(reads, slug) if slug else None
    return shown({"status": 200, "data": {"slug": slug, "total": len(out), "fields": fields_of(form) if form else [],
                                          "title": gsjs.str_(form.get("title")) if form else "",
                                          "submissions": out}})


def form_files_list(sess: L.Session, payload: dict) -> dict[str, Any]:
    """formFilesList: the form files ledger, filtered by form or answer; the digest cut to a preview unless full."""
    p = _payload(payload)
    refused = gate(sess, "formFilesList", p, EDITION["answers"])
    if refused:
        return refused
    slug = gsjs.trim(text_or(p.get("form_slug"))).lower()
    sub = gsjs.trim(text_or(p.get("submission_id")))
    full = p.get("full") is True or gsjs.js_str(p.get("full")) == "true"
    out = []
    for r in rows(sess.reads, FILES_TAB):
        if slug and gsjs.str_(r.get("form_slug")).lower() != slug:
            continue
        if sub and gsjs.str_(r.get("submission_id")) != sub:
            continue
        if full:
            out.append(r)
            continue
        copy = dict(r)
        copy["digest_text"] = CW.js_cut(gsjs.str_(r.get("digest_text")), DIGEST_PREVIEW)
        out.append(copy)
    return shown({"status": 200, "data": {"files": out}})


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {
    "formsList": forms_list, "formSubmissions": form_submissions, "formFilesList": form_files_list,
}
# the roles and params are each door's own gate (an edition lets its people in beside the roles)
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
