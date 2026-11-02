"""Two sweeps of the clients' care records on Python (Clients.gs ispContactsSweep, Meds.gs marImportSweepMaybe_).

The plans' guardians: each plan's contact text (isps: contact_block, then contacts) read by the model as screenAiChat_
reads it under its ai_isp_guardian row, a value kept only when the plan's own text holds it, one isp_contacts row per
client (ispContacts in app.resource_rows, uploaded from the tab's copy). The reading is a read (ispContactsFetch: the
plans and the model, for as long as a pass may run, `more` and `next` while plans are left); the filing is a write
(ispContactsKeep, under the platform's lock). The relay pairs them behind ispContactsSweep: each keep's answer is the
next fetch's `tally` and its `next` that fetch's `from`, until `more` is gone.

The eMAR import: the pass log's one-time copy into mar_entries, tracked in MAR_IMPORT_GEN and MAR_IMPORT_CURSOR
(app.client_care_sweeps, db/client_care_sweeps.sql). Its generation was copied whole before mar_entries came to
Postgres, so marImportSweep is its guard: done answers at once; anything else is said, and nothing is copied."""
from __future__ import annotations

import json
import os
import re
import time
from datetime import datetime, timezone
from typing import Any, Callable

import requests

import clients as C
import gsjs
import hotline as HL
import hubdb
import locations as L
import resource_rows as RR
import sheet_resources as SR
import smart_comms as SC
import staff_views
from scope import Defer
from writes import Decision

PLANS, CONTACTS, CONTACTS_TAB, MAR_TAB = "isps", "ispContacts", "isp_contacts", "mar_entries"
STATE = "app.client_care_sweeps"
# Clients.gs ISP_CONTACTS_HEADER
CONTACTS_HEADER = ("client_key", "client_name", "guardian_name", "guardian_relationship", "guardian_email",
                   "guardian_phone", "source", "via", "checked_at")
TALLY = ("examined", "read", "wrote", "refused", "skipped", "unreadable")
PLAN_TEXT_MAX = 6000
RELATIONSHIP_MAX = 60
AI_REQUEST = "ai_isp_guardian"
# SmartComms.gs SMART_AI_DEFAULT_ID
AI_DEFAULT = "ai_default"
# SCREEN_AI_PROVIDERS after the Groq rotation (the rotation here: each GROQ_API_KEY* this service holds)
OPENAI = {"name": "openai", "env": "OPENAI_API_KEY", "model_prop": "OPENAI_MODEL",
          "url": "https://api.openai.com/v1/chat/completions", "model": "gpt-4o-mini"}
# a fetch starts no plan after this long, and cuts a model call short of the relay's own wait
FETCH_BUDGET_S = 25.0
CALL_DEADLINE_S = 52.0
# Meds.gs
MAR_IMPORT_PROP, MAR_IMPORT_GEN_PROP, MAR_IMPORT_GEN = "MAR_IMPORT_CURSOR", "MAR_IMPORT_GEN", "4"
MAR_IMPORT_SRC_ID = "1epBvwaEn-m-JRG9NCMw0QIQdq3zUwJf4L4QgE027jxI"
DENIED = {"status": 403, "message": "Requires an admin or manager account"}
BUSY = "Somebody else is changing the plans' contacts right now — try again."
_JS_SPACE = "\t\n\x0b\x0c\r \xa0  -     　﻿"
_SPACES = re.compile("[" + _JS_SPACE + "]+")
# a plan the pass had no time left to read: read again by the next fetch
LATE = object()

s_ = gsjs.str_


class _Late(Exception):
    """The pass's deadline came before the model answered."""


# ---- the model, as screenAiChat_ asks it ------------------------------------------------------------------------

def _wants_lines(prompt: str) -> bool:
    """screenAskWantsLines_."""
    return bool(re.search(r"\bNDJSON\b", prompt, re.I | re.A) or re.search(r"one\s+JSON\s+object\s+per\s+line",
                                                                           prompt, re.I))


def _jsonish(raw: Any) -> str:
    """screenJsonish_."""
    t = gsjs.trim(gsjs.or_text(raw))
    t = gsjs.trim(re.sub(r"```\s*\Z", "", re.sub(r"^```(?:json)?\s*", "", t, count=1, flags=re.I), count=1))
    a, b = t.find("{"), t.rfind("}")
    return t[a:b + 1] if a != -1 and b > a else t


def _why(body: str) -> str:
    """screenAiWhy_."""
    for field in ("code", "type"):
        m = re.search(r'"' + field + r'"\s*:\s*"([A-Za-z0-9_.-]{1,40})"', body or "")
        if m:
            return "(" + m.group(1) + ")"
    return ""


def _ai_request(sits: list[dict], rid: str) -> dict | None:
    """smartAiRequest_: the last situations row of this id whose kind is ai, while it is on."""
    sit = None
    for x in sits:
        if s_(x.get("id")) == rid and gsjs.trim(gsjs.or_text(x.get("kind"))).lower() == "ai":
            sit = x
    if sit is None or not SC.smart_on(sit.get("enabled")):
        return None
    return {"id": s_(sit.get("id")), "model": s_(sit.get("ai_model")), "providers": SC.smart_list(sit.get("ai_providers"))}


def ai_config(reads: L.Reads, request_id: str) -> dict | None:
    """screenAiConfig_: the place's own row when it names a model or providers, else the default row; None leaves the
    code's ladder."""
    try:
        sits = reads.once("client_care:situations", lambda: SC.read_situations(reads.db))
        own = _ai_request(sits, request_id) if request_id else None
        if own and (own["model"] or own["providers"]):
            return own
        return _ai_request(sits, AI_DEFAULT) or own
    except Exception:  # noqa: BLE001 - as Apps Script: an unreadable book leaves the shipped ladder
        return None


def providers() -> list[dict]:
    """SCREEN_AI_PROVIDERS as this service holds them: a Groq entry per GROQ_API_KEY* (groq, groq2, ...), then
    OpenAI; `prop` names the variable each key is read from."""
    keys = [(k, v.strip()) for k, v in sorted(os.environ.items())
            if re.fullmatch(r"GROQ_API_KEY\d*", k) and v.strip()] or [("GROQ_API_KEY", "")]
    groq = [{"name": "groq" + (str(i + 1) if i else ""), "prop": env, "key": key, "model_prop": "GROQ_MODEL",
             "url": HL.GROQ_URL, "model": HL.GROQ_MODEL} for i, (env, key) in enumerate(keys)]
    return groq + [{**OPENAI, "prop": OPENAI["env"], "key": os.getenv(OPENAI["env"], "").strip()}]


def _model_for(cfg: dict | None, p: dict) -> str:
    """screenAiModelFor_: the row's model named for this provider, its host's second-level name or its whole host,
    else the row's bare model."""
    if not cfg:
        return ""
    raw = gsjs.or_text(cfg.get("model"))
    if not raw:
        return ""
    by_name: dict[str, str] = {}
    fallback = ""
    for piece in re.split(r"[,;\n]+", raw):
        t = gsjs.trim(piece)
        if not t:
            continue
        eq = t.find("=")
        if eq == -1:
            fallback = fallback or t
            continue
        k, v = gsjs.trim(t[:eq]).lower(), gsjs.trim(t[eq + 1:])
        if k and v:
            by_name[k] = v
    m = re.match(r"^https?://([^/]+)", p["url"])
    host = m.group(1) if m else ""
    parts = host.split(".")
    for k in (p["name"].lower(), (parts[-2] if len(parts) >= 2 else host).lower(), host.lower()):
        if k and by_name.get(k):
            return by_name[k]
    return fallback


def _model(reads: L.Reads, p: dict, cfg: dict | None) -> str:
    """screenAiModel_: the row's model, else the provider's model property, else the code's."""
    picked = _model_for(cfg, p)
    if picked:
        return picked
    try:
        return gsjs.or_text(reads.db.prop(p["model_prop"])) or p["model"]
    except Exception:  # noqa: BLE001 - as Apps Script: an unreadable property is the code's model
        return p["model"]


def _post(p: dict, model: str, messages: list, temperature: float, strict: bool, deadline: float) -> tuple[int, str]:
    """screenAiFetch_: a refusal is a value, never raised."""
    left = deadline - time.monotonic()
    if left <= 1:
        raise _Late
    body: dict[str, Any] = {"model": model, "temperature": temperature, "messages": messages}
    if strict:
        body["response_format"] = {"type": "json_object"}
    try:
        r = requests.post(p["url"], json=body, headers={"Authorization": "Bearer " + p["key"]},
                          timeout=min(HL.GROQ_TIMEOUT_S, left))
    except requests.Timeout:
        if time.monotonic() >= deadline - 1:
            raise _Late from None
        raise
    return r.status_code, r.text


def ai_chat(reads: L.Reads, prompt: str, temperature: float, request_id: str, deadline: float) -> dict[str, Any]:
    """screenAiChat_: each provider in turn, the first answer kept (cut to its JSON), every refusal said in `error`;
    `late` when the pass's deadline came first."""
    out: dict[str, Any] = {"ok": False, "content": "", "via": "", "error": "", "late": False}
    errors: list[str] = []
    messages = [{"role": "user", "content": prompt}]
    wants_lines = _wants_lines(prompt)
    cfg = ai_config(reads, request_id)
    for p in providers():
        name = p["name"]
        if cfg and cfg["providers"] and name not in cfg["providers"]:
            errors.append(name + "_offbyconfig")
            continue
        if not p["key"]:
            errors.append(name + "_nokey")
            continue
        try:
            strict = not wants_lines
            code, body = _post(p, _model(reads, p, cfg), messages, temperature, strict, deadline)
            # json_validate_failed is the promise discarding the answer: the same prompt again without it
            if code == 400 and strict and "json_validate_failed" in body:
                strict = False
                code, body = _post(p, _model(reads, p, cfg), messages, temperature, False, deadline)
            if code >= 400:
                errors.append(f"{name}_{code}{_why(body)}")
                continue
            try:
                choice = json.loads(body)["choices"][0]
                c, finish = choice["message"]["content"], gsjs.or_text(choice.get("finish_reason"))
            except (ValueError, KeyError, IndexError, TypeError, AttributeError):
                c, finish = "", ""
            if gsjs.falsy(c):
                if wants_lines and finish == "stop":
                    out.update(ok=True, content="", via=name, error="+".join(errors))
                    return out
                errors.append(name + "_empty" + (f"({finish[:20]})" if finish else "(no finish_reason)"))
                continue
            out.update(ok=True, content=_jsonish(c), via=name)
            return out
        except _Late:
            out.update(late=True, error="+".join(errors))
            return out
        except Exception as exc:  # noqa: BLE001 - as Apps Script: a provider that throws is the next one's turn
            errors.append(f"{name}_threw({str(exc)[:90]})")
    out["error"] = "+".join(errors) or "no_provider_configured"
    return out


# ---- the plans' guardians -----------------------------------------------------------------------------------------

def text_has(text: Any, value: Any, kind: str) -> bool:
    """ispTextHas_: the value is written in the plan — an e-mail with the spaces a wrap left, a phone by its ten
    digits, a name by each of its words."""
    hay = gsjs.or_text(text)
    v = gsjs.trim(gsjs.or_text(value))
    if not v:
        return False
    if kind == "email":
        return _SPACES.sub("", v).lower() in _SPACES.sub("", hay).lower()
    if kind == "phone":
        digits = re.sub(r"[^0-9]", "", v)
        if len(digits) == 11 and digits[0] == "1":
            digits = digits[1:]
        return len(digits) == 10 and digits in re.sub(r"[^0-9]", "", hay)
    words = [w for w in _SPACES.split(v) if len(re.sub(r"[^A-Za-z0-9_]", "", w)) >= 3]
    low = hay.lower()
    return bool(words) and all(re.sub(r"[^A-Za-z0-9_'-]", "", w).lower() in low for w in words)


def _no_constant(name: str) -> Any:
    raise ValueError(name)


def guardian_extract(reads: L.Reads, client_name: str, text: str, deadline: float) -> Any:
    """ispGuardianExtract_: the model's guardian, each value kept only when the plan's text holds it (the quote it is
    asked for is never kept); None when the model gave nothing readable, LATE when the pass ran out of time first."""
    src = gsjs.or_text(text)
    if not gsjs.trim(src):
        return None
    prompt = ("You are reading one Individual Service Plan for " + (gsjs.or_text(client_name) or "a person") + ".\n"
              "Find the GUARDIAN — the person or organisation legally responsible for them. Ignore case "
              "managers, SSAs, physicians, home providers, employers, family members who are NOT the guardian, "
              "and any agency that merely provides a service.\n\n"
              "Rules:\n"
              "- Copy values EXACTLY as they appear. Never correct, complete or reformat them.\n"
              "- If a value is not written in the text, use \"\".\n"
              "- If the plan says there is no guardian, or the person is their own guardian, "
              "return name \"\" and set self_or_none true.\n"
              "- An e-mail broken across two lines is still one e-mail: join it.\n\n"
              "Answer as JSON only:\n"
              "{\"name\":\"\",\"relationship\":\"\",\"email\":\"\",\"phone\":\"\",\"self_or_none\":false,"
              "\"quote\":\"the sentence you took this from\"}\n\n"
              "PLAN TEXT:\n" + SC._cut16(src, PLAN_TEXT_MAX))
    ai = ai_chat(reads, prompt, 0, AI_REQUEST, deadline)
    if ai["late"]:
        return LATE
    if not ai["ok"]:
        return None
    try:
        got = json.loads(ai["content"], parse_constant=_no_constant)
    except ValueError:
        return None
    nobody = {"name": "", "email": "", "phone": "", "relationship": "", "via": ai["via"]}
    if gsjs.falsy(got) or not isinstance(got, dict) or got.get("self_or_none") is True:
        return nobody
    name = gsjs.trim(gsjs.js_str(got.get("name"))) if text_has(src, got.get("name"), "name") else ""
    if not name or not C.guardian_is_person(name):
        return nobody
    return {"name": C.guardian_display_name(name),
            "relationship": SC._cut16(gsjs.trim(gsjs.or_text(got.get("relationship"))), RELATIONSHIP_MAX),
            "email": gsjs.trim(gsjs.js_str(got.get("email"))) if text_has(src, got.get("email"), "email") else "",
            "phone": (C.isp_phone(gsjs.trim(gsjs.js_str(got.get("phone"))))
                      if text_has(src, got.get("phone"), "phone") else ""),
            "via": ai["via"]}


def owned(reads: L.Reads) -> None:
    if not RR.uploaded(reads.db, CONTACTS):
        raise Defer("the plans' contacts are not uploaded to Postgres yet")


def _tally(v: Any) -> dict[str, int]:
    t = v if isinstance(v, dict) else {}
    out = {}
    for k in TALLY:
        try:
            out[k] = max(0, int(t.get(k) or 0))
        except (TypeError, ValueError):
            out[k] = 0
    return out


def contacts_fetch(sess: L.Session, payload: dict) -> dict[str, Any]:
    """ispContactsSweep's reading half: every plan (one, `client_key`) whose client has no contacts row yet (each
    again, `redo`) read by the model, from `from` on, adding to `tally`; the lines to keep, and `more` with `next`
    when the pass ran out of time."""
    user = sess.user or {}
    if not user or s_(user.get("role")) != "admin":
        return dict(DENIED)
    p = payload if isinstance(payload, dict) else {}
    reads = sess.reads
    owned(reads)
    only = s_(p.get("client_key"))
    redo = p.get("redo") is True or s_(p.get("redo")) == "true"
    try:
        start = max(0, int(p.get("from") or 0))
    except (TypeError, ValueError):
        start = 0
    tally = _tally(p.get("tally"))
    rows = reads.hub_rows(PLANS)
    known = {s_(c.get("client_key")) for _k, c in RR.table_rows(reads, CONTACTS)}
    started = time.monotonic()
    deadline = started + CALL_DEADLINE_S
    items: list[dict[str, str]] = []
    more, nxt, read_here = False, len(rows), 0
    for i in range(start, len(rows)):
        r = rows[i]
        key = s_(r.get("client_key"))
        if not key or (only and key != only):
            continue
        if key in known and not redo:
            tally["skipped"] += 1
            continue
        text = "\n\n".join(t for t in (s_(r.get("contact_block")), s_(r.get("contacts"))) if t)
        if not text:
            tally["unreadable"] += 1
            continue
        if time.monotonic() - started > FETCH_BUDGET_S:
            more, nxt = True, i
            break
        got = guardian_extract(reads, s_(r.get("client_name")), text, deadline)
        # a plan that alone outlasts a whole pass is refused, so every pass moves on
        if got is LATE and read_here:
            more, nxt = True, i
            break
        read_here += 1
        tally["read"] += 1
        if got is None or got is LATE:
            tally["refused"] += 1
            continue
        items.append(dict(zip(CONTACTS_HEADER, (
            key, s_(r.get("client_name")), got["name"], got["relationship"], got["email"], got["phone"],
            "read" if got["name"] else "none", s_(got.get("via")), gsjs.iso(datetime.now(timezone.utc))))))
        tally["wrote"] += 1
    tally["examined"] = len(rows)
    data: dict[str, Any] = {"items": items, "tally": tally, "more": more}
    if more:
        data["next"] = nxt
    return {"status": 200, "data": data}


def contacts_keep(sess: L.Session, payload: dict) -> Decision:
    """ispContactsSweep's writing half (the relay's own): each line over its client's row (the last one the tab holds
    for the key), else after every other; the sweep's log line once nothing more is owed."""
    if (sess.user or {}).get("is_service") is not True:
        return Decision({"status": 403, "message": "This is the relay's own write."})
    reads = sess.reads
    owned(reads)
    p = payload if isinstance(payload, dict) else {}
    by = s_(p.get("by"))
    rows = {s_(c.get("client_key")): (k, c) for k, c in RR.table_rows(reads, CONTACTS)}
    made, changed = [], []
    for it in p.get("items") or []:
        if not isinstance(it, dict) or not s_(it.get("client_key")):
            continue
        line = {h: s_(it.get(h)) for h in CONTACTS_HEADER}
        hit = rows.get(line["client_key"])
        if hit is None:
            made.append(line)
        else:
            changed.append((hit[0], hit[1], line))
    RR.update_many(reads, CONTACTS, changed, by)
    RR.create_many(reads, CONTACTS, made, by)
    data: dict[str, Any] = dict(_tally(p.get("tally")))
    if p.get("more") is True:
        data.update(more=True, next=p.get("next"))
    else:
        staff_views.record({"email": by, "display_name": by}, "isp_contacts_sweep",
                           f"{data['wrote']} plan(s) written, {data['refused']} refused, {data['skipped']} already known")
    return Decision({"status": 200, "data": data}, subject="", own=True)


# ---- the eMAR import ----------------------------------------------------------------------------------------------

def sweep_state(reads: L.Reads) -> dict[str, str]:
    """The Script Properties the sweeps kept, from their table."""
    return {s_(k): gsjs.or_blank(v) for k, v in RR._q(reads, f"select key, value from {STATE}")}


def mar_source(db: hubdb.HubDb) -> hubdb.TabRef | None:
    """marImportSourceSheet_ off the copy: the eMAR workbook's tab with a "Med Passer" header."""
    for (sid, _tab), ref in db.catalog()["tabs"].items():
        if sid == MAR_IMPORT_SRC_ID and any(gsjs.trim(str(h)).lower() == "med passer" for h in ref.headers):
            return ref
    return None


def mar_import_sweep(sess: L.Session, payload: dict) -> dict[str, Any]:
    """marImportSweepMaybe_ (the relay's own, on the clock that rang hubHiredSweepMaybe_): a generation copied whole
    and marked done is a no-op, as in Apps Script. The copy is not ported — it was finished before mar_entries came to
    Postgres — so a generation or cursor that says otherwise is said, with how much of the pass log mar_entries holds,
    and nothing is copied."""
    if (sess.user or {}).get("is_service") is not True:
        return {"status": 403, "message": "This is the relay's own read."}
    reads = sess.reads
    state = sweep_state(reads)
    gen, cur = state.get(MAR_IMPORT_GEN_PROP, ""), state.get(MAR_IMPORT_PROP, "")
    if gen == MAR_IMPORT_GEN and cur == "done":
        return {"status": 200, "data": {"done": True}}
    src = mar_source(reads.db)
    held = sum(1 for r in reads.hub_rows(MAR_TAB) if s_(r.get("id")).startswith("emar_"))
    return {"status": 409, "message": f"The eMAR import says generation \"{gen}\", cursor \"{cur}\" (the code's is "
                                      f"{MAR_IMPORT_GEN}, done): its copy is not ported, and nothing was copied.",
            "data": {"done": False, "gen": gen, "cursor": cur, "held": held,
                     "source_rows": src.row_count if src is not None else None}}


READ_ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {"ispContactsFetch": contacts_fetch,
                                                                         "marImportSweep": mar_import_sweep}
WRITE_ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {
    "ispContactsKeep": contacts_keep,
    "ispContactsUpload": RR.upload_door({CONTACTS: SR.SPECS.get(CONTACTS) or {"tab": CONTACTS_TAB}})}
# HUB_POLICY.ispContactsSweep: admins (its reading half); the keep, the upload and the import's guard are the relay's
POLICY: dict[str, dict[str, Any]] = {"ispContactsFetch": {"roles": ("admin",)}, "ispContactsKeep": {},
                                     "ispContactsUpload": {}, "marImportSweep": {}}
BUSY_OF: dict[str, dict[str, Any]] = {a: {"status": 409, "message": BUSY} for a in WRITE_ACTIONS}


class Store(RR.Store):
    """app.client_care_writes and _receipts; the plans' contacts app.resource_rows'."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="client_care", label="Client care sweeps")
