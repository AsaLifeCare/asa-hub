"""Forms' import from Google (Forms.gs formImportGoogle) on Python alone: the relay asks formImportGooglePrepare first
— the link resolved (a reimport's own source, else its Google original found in Drive by its title), the form opened as
the platform's account through the Forms API (FormApp's lane), else read off its public page (FB_PUBLIC_LOAD_DATA_) —
and formImportGoogle then maps its questions onto the platform's kinds and keeps the form as formSave keeps one
(app.edits over the forms tab): a reimport and a source already imported refresh the existing row, anything else is a
new open form. A column the forms tab lacks is added by a `mirror` book op that rewrites the tab."""
from __future__ import annotations

import json
import logging
import re
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Callable

import drive as dr
import forms as F
import forms_writes as FW
import gsjs
import hubdb
import locations as L
import resource_rows as RR
import staff_views
import writes as W
from scope import Defer
from writes import Decision

log = logging.getLogger("asa-hub-app")

ACTION, PREPARE = "formImportGoogle", "formImportGooglePrepare"
FORMS_API = "https://forms.googleapis.com/v1/forms/"
FORM_MIME = "application/vnd.google-apps.form"
# formImportFindByTitle_: candidates off the Drive name, then the best few opened
MAX_SCAN, MAX_OPENS = 30, 10
FETCH_TIMEOUT_S = 20.0
PAGE_CAP = 8 << 20
REDIRECTS = 5
# HUB_POLICY.formImportGoogle params, in declaration order (url optional: a reimport resolves its own source)
PARAMS = (("url", "string"), ("title", "string"), ("notify_to", "string"), ("reimport_slug", "string"))
UNSAVED = "That did not save — please try again in a moment."
UNPREPARED = "The form could not be read just now — nothing was imported. Try again in a minute."
UNOPENED = ("That link does not open and its public page has no form in it. Paste the form’s link — the short "
            "forms.gle one, the send link, or the edit link all work — and only a form that is visible to anyone with "
            "the link can be imported.")
CONTACT_BLOCK = "off — opt-in per form since 2026-09-08"
NO_COLUMN = ("The forms sheet lacks a column this form needs, and it cannot be rewritten safely from its copy — "
             "nothing was imported.")
# the public responder page's kinds (FB_PUBLIC_LOAD_DATA_ item[3]); 13 a file, 18 a star rating
PUBLIC_TYPES = {"0": "text", "1": "long", "2": "choice", "3": "choice", "4": "multi", "5": "scale", "9": "date",
                "10": "time", "13": "file", "18": "scale"}
_JS_WS = "[\t\n\x0b\x0c\r    -     　﻿]"
_PAYLOAD = re.compile(r"var FB_PUBLIC_LOAD_DATA_ = ([\s\S]*?);\s*</script>")
_OPTION_N = re.compile(r"Option \d+")
_FORM_ID = re.compile(r"^https?://docs\.google\.com/forms(?:/u/\d+)?/d/([^/]+)")

s_ = gsjs.str_


def _text(v: Any) -> str:
    """String(v || '').trim()."""
    return gsjs.trim(gsjs.or_text(v))


def _at(a: Any, i: int) -> Any:
    """a[i] of a parsed value; None (undefined) past its end or for anything not an array."""
    return a[i] if isinstance(a, list) and 0 <= i < len(a) else None


def _is(v: Any, n: int) -> bool:
    """v === n for a number n."""
    return isinstance(v, (int, float)) and not isinstance(v, bool) and v == n


def _number(v: Any) -> float:
    """Number(v) for what a parsed payload holds."""
    if isinstance(v, bool):
        return 1.0 if v else 0.0
    if v is None:
        return 0.0
    if isinstance(v, (int, float)):
        return float(v)
    if isinstance(v, str):
        t = gsjs.trim(v)
        try:
            return float(t) if t else 0.0
        except ValueError:
            return float("nan")
    return 0.0 if v == [] else float("nan")


def _first(c: Any) -> str:
    """String(c && c[0] || '')."""
    if gsjs.falsy(c):
        return ""
    v = c[0] if isinstance(c, (list, str)) and len(c) > 0 else None
    return gsjs.or_text(v)


def _payload(payload: Any) -> dict:
    return payload if isinstance(payload, dict) else {}


def gate(sess: L.Session, p: dict) -> dict[str, Any] | None:
    """hubPolicyGate_ (the declared roles, then each param in order), then hubIsWriter_: an admin's or a manager's
    alone, no edition."""
    user = sess.user or {}
    if user.get("is_service") is not True and gsjs.js_str(user.get("role")) not in F.ROLES:
        return {"status": 403, "message": F.ROLE_REFUSAL}
    for key, kind in PARAMS:
        val = p.get(key)
        if val is None or (isinstance(val, str) and val == ""):
            continue
        if F.js_type(val) != kind:
            return {"status": 400, "message": f"{key} must be {kind}, got {F.js_type(val)}."}
    if not F.writer(user):
        return {"status": 403, "message": "Requires an admin or manager account"}
    return None


# ---- the link (formImportNormalizeUrl_, formImportPublicUrl_) --------------------------------------------------------

def _google(url: str) -> bool:
    """Only Google's own pages are fetched: a link that leads anywhere else is not a form."""
    try:
        got = urllib.parse.urlsplit(url)
    except ValueError:
        return False
    host = (got.hostname or "").lower()
    return got.scheme in ("http", "https") and (host == "forms.gle" or host == "google.com" or
                                                 host.endswith(".google.com"))


class _Stay(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: ANN001, ANN201 - urllib's own signature
        return None


def _open(url: str, follow: bool) -> tuple[int, dict[str, str], bytes]:
    """UrlFetchApp.fetch with muteHttpExceptions: (code, headers, body), each hop on Google's own pages."""
    opener = urllib.request.build_opener(_Stay())
    for _ in range(REDIRECTS + 1):
        if not _google(url):
            raise ValueError("not a Google page")
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (asa-hub forms import)"})
        try:
            with opener.open(req, timeout=FETCH_TIMEOUT_S) as res:
                return res.status, {k.lower(): v for k, v in res.headers.items()}, res.read(PAGE_CAP)
        except urllib.error.HTTPError as e:
            heads = {k.lower(): v for k, v in (e.headers or {}).items()}
            loc = heads.get("location")
            if follow and e.code in (301, 302, 303, 307, 308) and loc:
                url = urllib.parse.urljoin(url, loc)
                continue
            return e.code, heads, e.read(PAGE_CAP) if e.fp is not None else b""
    raise ValueError("too many redirects")


def normalize_url(url: str) -> str:
    """formImportNormalizeUrl_: a forms.gle link followed one hop to the form it names; the query and the hash gone."""
    u = gsjs.trim(url)
    if re.match(r"^https?://forms\.gle/", u):
        try:
            _code, heads, _body = _open(u, False)
            if heads.get("location"):
                u = heads["location"]
        except Exception:  # noqa: BLE001 - the original is kept; the lanes below answer honestly
            pass
    return u.split("#")[0].split("?")[0]


def public_url(u: str) -> str:
    """formImportPublicUrl_: the public face of whatever link was pasted."""
    m = re.match(r"^(https?://docs\.google\.com/forms(?:/u/\d+)?/d/e/[^/]+)", u)
    if m:
        return m.group(1) + "/viewform"
    m = re.match(r"^(https?://docs\.google\.com/forms(?:/u/\d+)?/d/[^/]+)", u)
    if m:
        return m.group(1) + "/viewform"
    return u


# ---- the editor lane (FormApp, formImportAppItems_) ---------------------------------------------------------------

def form_api(drv: Any, form_id: str) -> dict[str, Any]:
    """FormApp.openById: the form as the Forms API answers it, asked with each credential the platform's Drive holds,
    asatech's own first; raised when none opens it."""
    url = FORMS_API + urllib.parse.quote(form_id, safe="")
    last: Exception = ValueError("no credential opens the form")
    for which in drv._usable():
        tok = drv._token_or_none(which)
        if not tok:
            continue
        req = urllib.request.Request(url, headers={"Authorization": f"Bearer {tok}"})
        try:
            with urllib.request.urlopen(req, timeout=FETCH_TIMEOUT_S) as res:
                got = json.loads(res.read(PAGE_CAP))
            if isinstance(got, dict):
                return got
        except urllib.error.HTTPError as e:
            last = e
            if e.code not in (401, 403, 404):
                raise
    raise last


def _choices(options: Any) -> list[str]:
    """getChoices().map(getValue).filter(Boolean): the "Other" box is not a choice."""
    return [v for v in (gsjs.or_text(o.get("value")) for o in options or [] if isinstance(o, dict)
                        and not o.get("isOther")) if v]


def _kind_words(q: dict) -> str:
    """An unknown kind's name, as FormApp's type reads lower-cased."""
    key = next((k for k in q if k not in ("questionId", "required", "grading")), "unknown")
    return re.sub(r"(?<!^)(?=[A-Z])", " ", key).lower()


def app_items(form: dict) -> list[dict[str, Any]]:
    """formImportAppItems_: the form's items flattened to the neutral shape the mapping reads — {label, type,
    required, options, help, skip}; a grid becomes one question per row."""
    out: list[dict[str, Any]] = []
    for it in form.get("items") or []:
        if not isinstance(it, dict):
            continue
        one: dict[str, Any] = {"label": _text(it.get("title")), "required": False, "options": None,
                               "help": _text(it.get("description")), "skip": ""}
        if "pageBreakItem" in it or "textItem" in it:
            one["type"] = "heading"
        elif "imageItem" in it or "videoItem" in it:
            one["type"] = "furniture"
        elif "questionGroupItem" in it:
            group = it.get("questionGroupItem") or {}
            grid = group.get("grid") if isinstance(group.get("grid"), dict) else None
            if grid is None:
                one["skip"] = "question group"
                out.append(one)
                continue
            cols = grid.get("columns") or {}
            g_cols = [gsjs.or_blank(o.get("value")) for o in cols.get("options") or [] if isinstance(o, dict)]
            rows = [q for q in group.get("questions") or [] if isinstance(q, dict)]
            g_req = any(q.get("required") is True for q in rows)
            for gr, q in enumerate(rows):
                row = gsjs.or_blank((q.get("rowQuestion") or {}).get("title"))
                out.append({"label": (one["label"] + " — " if one["label"] else "") + row, "required": g_req,
                            "help": one["help"] if gr == 0 else "", "options": list(g_cols),
                            "type": "multi" if cols.get("type") == "CHECKBOX" else "scale", "skip": ""})
            continue
        elif "questionItem" in it:
            q = (it.get("questionItem") or {}).get("question") or {}
            one["required"] = q.get("required") is True
            if "textQuestion" in q:
                one["type"] = "long" if (q.get("textQuestion") or {}).get("paragraph") else "text"
            elif "choiceQuestion" in q:
                cq = q.get("choiceQuestion") or {}
                one["type"] = "multi" if cq.get("type") == "CHECKBOX" else "choice"
                one["options"] = _choices(cq.get("options"))
            elif "scaleQuestion" in q:
                sq = q.get("scaleQuestion") or {}
                one["type"] = "scale"
                one["options"] = [str(b) for b in range(int(_number(sq.get("low"))), int(_number(sq.get("high"))) + 1)]
                one["left"] = _text(sq.get("lowLabel"))
                one["right"] = _text(sq.get("highLabel"))
            elif "dateQuestion" in q:
                if (q.get("dateQuestion") or {}).get("includeTime"):
                    one["skip"] = "date and time"
                else:
                    one["type"] = "date"
            elif "timeQuestion" in q:
                if (q.get("timeQuestion") or {}).get("duration"):
                    one["skip"] = "duration"
                else:
                    one["type"] = "time"
            elif "fileUploadQuestion" in q:
                one["type"] = "file"
            elif "ratingQuestion" in q:
                one["type"], one["style"] = "scale", "star"
                level = _number((q.get("ratingQuestion") or {}).get("ratingScaleLevel"))
                level = int(level) if level == level and level else 5
                one["options"] = [str(b) for b in range(1, level + 1)]
            else:
                one["skip"] = _kind_words(q)
        else:
            one["skip"] = _kind_words(it)
        out.append(one)
    return out


def _editor_lane(reads: L.Reads, u: str) -> dict[str, Any] | None:
    """The form opened as the platform's account: {items, title, intro}, or None when it does not open."""
    m = _FORM_ID.match(u)
    if not m or m.group(1) == "e":
        return None
    try:
        got = form_api(reads.need_drive(), m.group(1))
    except Exception as exc:  # noqa: BLE001 - FormApp not opening it is the public lane's turn
        log.info("forms import: the editor lane did not open the form (%s)", type(exc).__name__)
        return None
    info = got.get("info") if isinstance(got.get("info"), dict) else {}
    return {"items": app_items(got), "title": _text(info.get("title")), "intro": _text(info.get("description"))}


# ---- the public lane (formImportPublicFetch_) ---------------------------------------------------------------------

def public_items(data: Any) -> dict[str, Any] | None:
    """The responder page's definition read as formImportPublicFetch_ reads it: {title, intro, items}, or None."""
    info = _at(data, 1) if not gsjs.falsy(data) else data
    if not isinstance(info, list) or not isinstance(_at(info, 1), list):
        return None
    head = _at(info, 8)
    if gsjs.falsy(head):
        head = _at(data, 3)
    out: dict[str, Any] = {"title": _text(head), "intro": _text(_at(info, 0)), "items": []}
    for it in info[1]:
        if not isinstance(it, list) or len(it) < 4:
            continue
        kind = it[3]
        if _is(kind, 6) or _is(kind, 8):
            h_lab, h_txt = _text(_at(it, 1)), _text(_at(it, 2))
            if h_lab or h_txt:
                out["items"].append({"label": h_lab, "help": h_txt, "required": False, "options": None,
                                     "type": "heading", "skip": ""})
            continue
        if _is(kind, 11) or _is(kind, 12):
            continue
        if _is(kind, 7):
            g_title = _text(_at(it, 1))
            subs = it[4] if isinstance(_at(it, 4), list) else []
            made = 0
            for g, srow in enumerate(subs):
                if not isinstance(srow, list):
                    continue
                opts = [x for x in (_first(c) for c in srow[1]) if x] if isinstance(_at(srow, 1), list) else []
                if not opts:
                    continue
                labels = _at(srow, 3)
                r_lab = gsjs.js_str(labels[0]) if isinstance(labels, list) and labels else "Row " + str(g + 1)
                multi = isinstance(_at(srow, 11), list) and _number(_at(srow[11], 0)) == 1
                out["items"].append({"label": (g_title + " — " if g_title else "") + r_lab,
                                     "help": _text(_at(it, 2)) if g == 0 else "", "required": _is(_at(srow, 2), 1),
                                     "options": opts, "type": "multi" if multi else "scale", "skip": ""})
                made += 1
            if not made:
                out["items"].append({"label": g_title, "help": "", "required": False, "options": None,
                                     "skip": "grid"})
            continue
        head4 = _at(it, 4)
        sub = _at(head4, 0) if not gsjs.falsy(head4) else head4
        if gsjs.falsy(sub):
            sub = []
        name = PUBLIC_TYPES.get(gsjs.js_str(kind)) if isinstance(kind, (int, float, str)) else None
        one: dict[str, Any] = {"label": _text(_at(it, 1)), "help": _text(_at(it, 2)), "required": _is(_at(sub, 2), 1),
                               "options": None, "skip": ""}
        if name is None:
            one["skip"] = "unknown kind " + gsjs.js_str(kind)
        else:
            one["type"] = name
        if any(_is(kind, n) for n in (2, 3, 4, 5)) and isinstance(_at(sub, 1), list):
            one["options"] = [x for x in (_first(c) for c in sub[1]) if x]
        if _is(kind, 5) and isinstance(_at(sub, 3), list):
            one["left"], one["right"] = _text(_at(sub[3], 0)), _text(_at(sub[3], 1))
        if _is(kind, 18):
            one["style"] = "star"
            if not one["options"]:
                one["options"] = ["1", "2", "3", "4", "5"]
        out["items"].append(one)
    return out


def fetch_page(url: str) -> str | None:
    """The responder page's HTML, followed through its redirects; None unless it answered 200."""
    try:
        code, _heads, body = _open(url, True)
    except Exception:  # noqa: BLE001 - a page that does not answer is no form
        return None
    return body.decode("utf-8", "replace") if code == 200 else None


def public_fetch(u: str) -> dict[str, Any] | None:
    """formImportPublicFetch_: the responder page carries the whole form definition."""
    html = fetch_page(u)
    if html is None:
        return None
    m = _PAYLOAD.search(html)
    if not m:
        return None
    try:
        data = json.loads(m.group(1))
    except (ValueError, RecursionError):
        return None
    return public_items(data)


# ---- the original by its title (formImportFindByTitle_) -------------------------------------------------------------

def title_key(s: Any) -> str:
    """formImportTitleKey_: one title, one key."""
    t = re.sub("[​-‍﻿]", "", gsjs.or_text(s))
    t = re.sub("[‐-―−]", "-", t)
    t = re.sub("[  -   　]", " ", t)
    return gsjs.trim(re.sub(_JS_WS + "+", " ", t)).lower()


def ascii_chunk(s: Any) -> str:
    """formImportAsciiChunk_: the longest plain [A-Za-z0-9 ] run, 8+ characters once trimmed."""
    best = ""
    for run in re.split(r"[^A-Za-z0-9 ]+", gsjs.or_text(s)):
        r = gsjs.trim(re.sub(_JS_WS + "+", " ", run))
        if len(r) > len(best):
            best = r
    return best if len(best) >= 8 else ""


def _quote(s: str) -> str:
    return s.replace("\\", "\\\\").replace("'", "\\'")


def find_by_title(reads: L.Reads, title: str) -> str:
    """formImportFindByTitle_: the one Google form this account can open whose own title is this one's; '' for none,
    and for two."""
    want = title_key(title)
    if not want:
        return ""
    try:
        drv = reads.need_drive()
    except Defer:
        return ""
    base = f"mimeType = '{FORM_MIME}' and trashed = false and "
    queries = ["name = '" + _quote(gsjs.trim(title)) + "'"]
    chunk = ascii_chunk(title)
    if chunk:
        queries.append("name contains '" + _quote(chunk) + "'")
    seen: set[str] = set()
    cand: list[tuple[int, str]] = []
    for q in queries:
        if len(cand) >= MAX_SCAN:
            break
        try:
            got = drv._get(dr.API, {"q": base + q, "fields": "files(id,name)", "pageSize": MAX_SCAN,
                                    "includeItemsFromAllDrives": "true"})
        except Exception:  # noqa: BLE001 - a broken query lane is silence, not a crash
            continue
        for f in got.get("files") or []:
            if len(cand) >= MAX_SCAN:
                break
            fid = s_(f.get("id"))
            if not fid or fid in seen:
                continue
            seen.add(fid)
            name_key = title_key(re.sub(r"\s*\([^()]*\)\s*$", "", gsjs.or_text(f.get("name"))))
            rank = 0 if name_key == want else 1 if name_key and (name_key.startswith(want) or
                                                                  want.startswith(name_key)) else 2
            cand.append((rank, fid))
    cand.sort(key=lambda c: c[0])
    hit = ""
    for _rank, fid in cand[:MAX_OPENS]:
        try:
            got = form_api(drv, fid)
        except Exception:  # noqa: BLE001 - not openable as this account: not it
            continue
        info = got.get("info") if isinstance(got.get("info"), dict) else {}
        if title_key(info.get("title")) != want:
            continue
        if hit:
            return ""
        hit = fid
    return "https://docs.google.com/forms/d/" + hit + "/edit" if hit else ""


# ---- the reimport's own row ---------------------------------------------------------------------------------------

def _reimport_row(reads: L.Reads, slug: str) -> tuple[dict | None, dict[str, Any] | None]:
    row = F.form_by_slug(reads, slug)
    if row is None:
        return None, {"status": 404, "message": "No form by that name to reimport."}
    if s_(row.get("archived")).lower() == "true":
        return None, {"status": 409, "message": "This form is archived — restore it first."}
    return row, None


def prepare(sess: L.Session, payload: dict) -> dict[str, Any]:
    """formImportGoogle's slow half: the link resolved and the form read — opened as the platform's account, else off
    its public page; nothing is written."""
    try:
        return _prepare(sess, _payload(payload))
    except (Defer, hubdb.Unreadable) as exc:
        log.info("forms import: not prepared (%s)", exc)
        return {"status": 503, "message": UNPREPARED}


def _prepare(sess: L.Session, p: dict) -> dict[str, Any]:
    refused = gate(sess, p)
    if refused:
        return refused
    reads = sess.reads
    url = _text(p.get("url"))
    re_slug = _text(p.get("reimport_slug")).lower()
    if re_slug:
        row, refused = _reimport_row(reads, re_slug)
        if refused:
            return refused
        if not url:
            url = s_(row.get("source_url"))
        if not url:
            url = find_by_title(reads, s_(row.get("title")))
        if not url:
            return {"status": 409, "message": 'The Google original for "' + s_(row.get("title")) + '" could not be '
                    "found in Drive by its title. Open Import once with its link — it is remembered from then on."}
    if not url:
        return {"status": 400, "message": "Paste the Google Forms link first."}
    u = normalize_url(url)
    got, via = _editor_lane(reads, u), "edit link"
    if got is None:
        got, via = public_fetch(public_url(u)), "public link"
    if got is None:
        log.info("forms import: %s opened by neither lane", url[:120])
        return {"status": 422, "message": UNOPENED}
    return {"status": 200, "data": {"url": u, "via": via, "title": got["title"], "intro": got["intro"],
                                    "items": got["items"]}}


# ---- the mapping (formImportGoogle's own loop) ----------------------------------------------------------------------

def mint_key(base: Any, fallback: str, used: set[str]) -> str:
    """mintKey_: lower-case letters, digits and underscores, 40 at most, never twice (a name every JavaScript object
    answers counts as taken, as the handler's object found it)."""
    key = re.sub(r"^_+|_+$", "", re.sub(r"[^a-z0-9]+", "_", gsjs.or_text(base).lower()))[:40] or fallback
    root, n = key, 2
    while key in used or key in F.PROTO_NAMES:
        suf = "_" + str(n)
        n += 1
        key = root[:40 - len(suf)] + suf
    used.add(key)
    return key


def map_items(items: list) -> tuple[list[dict], list[str], dict[str, int]]:
    """The honest mapping onto FORM_FIELD_KINDS: (the questions, what was skipped and why, the tally per kind)."""
    fields: list[dict] = []
    skipped: list[str] = []
    kept: dict[str, int] = {}
    used: set[str] = set()
    for i, it in enumerate(items):
        it = it if isinstance(it, dict) else {}
        label = _text(it.get("label"))
        if it.get("type") == "furniture":
            continue
        if not gsjs.falsy(it.get("skip")):
            skipped.append(gsjs.js_str(it.get("skip")) + (' — "' + label + '"' if label else ""))
            continue
        help_ = it.get("help")
        if it.get("type") == "heading":
            if not label and gsjs.falsy(help_):
                continue
            fields.append({"key": mint_key(label, "section_" + str(i + 1), used), "label": label, "kind": "heading",
                           "required": "false", "help": help_ if not gsjs.falsy(help_) else ""})
            kept["heading"] = kept.get("heading", 0) + 1
            continue
        kind = it.get("type")
        options = it.get("options") if not gsjs.falsy(it.get("options")) else None
        if kind in ("choice", "multi") and isinstance(options, list) and options and \
                all(_OPTION_N.fullmatch(gsjs.trim(gsjs.or_blank(o))) for o in options):
            kind, options = "text", None
        if kind in ("choice", "multi", "scale") and not (isinstance(options, list) and options):
            skipped.append("choice of nothing" + (' — "' + label + '"' if label else ""))
            continue
        field: dict[str, Any] = {"key": mint_key(label, "q" + str(i + 1), used),
                                 "label": label or "Question " + str(i + 1), "kind": kind,
                                 "required": "false" if gsjs.falsy(it.get("required")) else "true"}
        for name in ("help", "options", "left", "right", "style"):
            v = options if name == "options" else it.get(name)
            if not gsjs.falsy(v):
                field[name] = v
        fields.append(field)
        kind_name = gsjs.js_str(kind) if kind is not None else "undefined"
        kept[kind_name] = kept.get(kind_name, 0) + 1
    return fields, skipped, kept


def keep_platform_fields(old: list, fresh: list[dict]) -> list:
    """formKeepPlatformFields_: a reimport mirrors the original, except where the original cannot speak — a question
    Google cannot author stays, and a declaration a question fed stays on it."""
    fresh_kinds = {gsjs.or_text(f.get("kind")) or "text" for f in fresh}
    fresh_keys = {gsjs.or_text(f.get("key")) for f in fresh}
    was_fact: dict[str, str] = {}
    for wf in old or []:
        wf = wf if isinstance(wf, dict) and wf else {}
        if not gsjs.falsy(wf.get("key")) and not gsjs.falsy(wf.get("fact")):
            was_fact[gsjs.js_str(wf.get("key"))] = gsjs.js_str(wf.get("fact"))
    for f in fresh:
        mk = gsjs.or_text(f.get("key"))
        if mk and gsjs.falsy(f.get("fact")) and was_fact.get(mk):
            f["fact"] = was_fact[mk]
    out = list(fresh)
    for f in old or []:
        f = f if isinstance(f, dict) and f else {}
        kind = gsjs.or_text(f.get("kind")) or "text"
        if kind != "file":
            continue
        if kind in fresh_kinds or gsjs.or_text(f.get("key")) in fresh_keys:
            continue
        out.append(f)
    return out


def _asks_self(fields: list[dict]) -> bool:
    """The form already asks who is answering: the contact block is not stacked on top of it."""
    for f in fields:
        if gsjs.js_str(f.get("kind")) == "heading":
            continue
        cl = gsjs.trim(gsjs.or_text(f.get("label"))).lower()
        if re.match(r"^(your\s+)?(full\s+)?name$", cl) or \
                re.match(r"^(evaluator|respondent|reviewer|applicant)('?s)?\s+(full\s+)?name", cl) or \
                re.match(r"^(your\s+)?e-?mail(\s+address)?$", cl):
            return True
    return False


# ---- the write ----------------------------------------------------------------------------------------------------

def _gate_held(reads: L.Reads) -> bool:
    """sheetDbGateHolds_: while the book-write funnel is armed, nothing is kept."""
    try:
        W.gate(reads)
    except Defer:
        return True
    return False


def new_row_edits(reads: L.Reads, row: dict[str, Any], subject: str, author: str) -> list[dict] | None:
    """createRow_ on the forms' own table, a column it lacks added with the row; [] once kept."""
    RR.create(reads, F.resource_of(F.FORMS_TAB), {k: _cell(v) for k, v in row.items()}, author)
    return []


def _cell(v: Any) -> str:
    """The text a cell is written with: a parsed list or object as JSON.stringify writes it."""
    if isinstance(v, (dict, list)):
        return FW.stringify(v)
    return W.sheet_text(v)


def import_google(sess: L.Session, payload: dict) -> Decision:
    """formImportGoogle: bring a Google Form in by its link — the questions mapped honestly onto the platform's kinds;
    a reimport re-copies them onto the existing row, a source already imported is refreshed rather than doubled, and
    anything else becomes a new open form with the contact block off."""
    try:
        return _import(sess, _payload(payload))
    except (Defer, hubdb.Unreadable) as exc:
        log.info("forms import: not kept (%s)", exc)
        return W.refuse(503, UNSAVED)


def _import(sess: L.Session, p: dict) -> Decision:
    refused = gate(sess, p)
    if refused:
        return Decision(refused)
    reads, user = sess.reads, sess.user or {}
    fresh = F.books(reads, F.FORMS_TAB)
    re_slug = _text(p.get("reimport_slug")).lower()
    re_row = None
    if re_slug:
        re_row, refused = _reimport_row(reads, re_slug)
        if refused:
            return Decision(refused, fresh=fresh)
    prep = p.get("prepared")
    if not isinstance(prep, dict) or not s_(prep.get("url")) or not isinstance(prep.get("items"), list):
        if not _text(p.get("url")) and not re_slug:
            return W.refuse(400, "Paste the Google Forms link first.")
        return W.refuse(503, UNPREPARED)
    u, via = s_(prep.get("url")), s_(prep.get("via"))
    intro = gsjs.or_text(prep.get("intro"))
    title = _text(p.get("title")) or gsjs.or_text(prep.get("title"))
    if not title:
        return W.refuse(422, "The form has no title — give it one in the title field.")
    fields, skipped, kept = map_items(prep["items"])
    breakdown = " · ".join(f"{n} {k}" for k, n in kept.items())
    n_questions = len(fields) - kept.get("heading", 0)
    asks_self = _asks_self(fields)
    bad = FW.check_fields(fields)
    if bad:
        return W.refuse(422, bad if fields else "Nothing importable: every question in that form is a kind this "
                        "platform does not carry (" + "; ".join(skipped) + ").")
    said = "kept: " + (breakdown or "nothing") + ("; skipped: " + "; ".join(skipped)[:300] if skipped else "") + \
        ", via " + via
    if _gate_held(reads):
        return W.refuse(503, UNSAVED)
    if re_row is not None:
        fields = keep_platform_fields(F.fields_of(re_row), fields)
        rid = s_(re_row.get("id"))
        cells = {"title": title, "intro": intro, "fields": FW.stringify(fields), "source_url": u}
        staff_views.record(user, "form_reimported_google", title + " (" + said + ")")
        answer = {"status": 200, "data": {"slug": re_slug, "title": title, "questions": n_questions,
                                          "skipped": skipped, "breakdown": breakdown, "url": F.public_url(re_row),
                                          "note": "Questions refreshed — the link, the status and every answer "
                                                  "stayed."}}
        return FW._kept(answer, [FW._record(reads, F.FORMS_TAB, rid, re_slug, cells, "")], re_slug, fresh, "")
    prior = by_source_url(reads, u)
    if prior is not None:
        fields = keep_platform_fields(F.fields_of(prior), fields)
        slug = s_(prior.get("slug"))
        cells = {"title": title, "intro": intro, "fields": FW.stringify(fields), "source_url": u}
        staff_views.record(user, "form_import_deduped", title + ' — this Google form is already "' + slug +
                           '"; its questions were refreshed instead of doubling it')
        answer = {"status": 200, "data": {"slug": slug, "title": title, "questions": n_questions, "skipped": skipped,
                                          "breakdown": breakdown, "url": F.public_url(prior),
                                          "note": "This Google form was already imported — its questions were "
                                                  "refreshed on the existing link."}}
        return FW._kept(answer, [FW._record(reads, F.FORMS_TAB, s_(prior.get("id")), slug, cells, "")], slug, fresh,
                        "")
    slug = slug_for(reads, title)
    token = FW.mint_token()
    stamp = W.now_iso(reads)
    rid = W.mint()
    row = {"slug": slug, "title": title, "intro": intro, "fields": FW.stringify(fields), "status": "open",
           "notify_to": _text(p.get("notify_to")), "asks_contact": "no", "token": token,
           "created_by": s_(user.get("email")), "source_url": u, "id": rid, "createdAt": stamp, "updatedAt": stamp}
    edits = new_row_edits(reads, row, slug, s_(user.get("email")))
    if edits is None:
        return W.refuse(409, NO_COLUMN, fresh=fresh)
    staff_views.record(user, "form_imported_google", title + " (" + said +
                       (", contact block off — the form asks its own" if asks_self else "") + ")")
    answer = {"status": 200, "data": {"slug": slug, "title": title, "questions": n_questions, "skipped": skipped,
                                      "breakdown": breakdown, "contact_block": CONTACT_BLOCK,
                                      "url": F.public_url({"slug": slug, "token": token})}}
    return FW._kept(answer, edits, slug, fresh, "")


def by_source_url(reads: L.Reads, u: str) -> dict | None:
    """formBySourceUrl_: the live row already holding this Google source — one source, one row."""
    want = gsjs.trim(u)
    if not want:
        return None
    return next((r for r in F.rows(reads, F.FORMS_TAB) if gsjs.trim(s_(r.get("source_url"))) == want and
                 s_(r.get("archived")).lower() != "true"), None)


def slug_for(reads: L.Reads, title: str) -> str:
    """The link name off the title, never one a form already answers to."""
    slug = re.sub(r"^-+|-+$", "", re.sub(r"[^a-z0-9]+", "-", title.lower()))[:49]
    if not FW.SLUG.fullmatch(slug):
        slug = "imported-form"
    base, n = slug, 2
    while F.form_by_slug(reads, slug) is not None:
        suf = "-" + str(n)
        n += 1
        slug = re.sub(r"-+$", "", base[:49 - len(suf)] + suf)
    return slug


READS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {PREPARE: prepare}
READ_POLICY: dict[str, dict[str, Any]] = {PREPARE: {}}
ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {ACTION: import_google}
# the roles and params are the door's own gate, in hubPolicyGate_'s order
POLICY: dict[str, dict[str, Any]] = {ACTION: {}}
BUSY_OF: dict[str, dict[str, Any]] = {ACTION: {"status": 409, "message": FW.BUSY}}
