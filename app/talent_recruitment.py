"""Recruitment (apps-script/Recruitment.gs) on Python: the Dropbox Sign mirror's settings (recruitmentConfig, the
dissolved recruitment_config facts), and the reads its outside calls are made in — the envelopes listed and their
answers fetched (recruitmentSyncPrepare; recruitmentSyncDue for the relay's clock), one signed PDF fetched, filed in
Drive as the platform's account and kept on the server (recruitmentDocPrepare). No address or SSN is mirrored: an
answer that is one is dropped (an SSN leaves only its salted fingerprint), never masked."""
from __future__ import annotations

import base64
import hashlib
import json
import logging
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from typing import Any, Callable

import requests

import candidate_papers as CPA
import candidate_writes as CW
import gsjs
import hubdb
import location_docs as LD
import locations as L
import onboarding as OB
import talent_pipeline as TP

log = logging.getLogger("asa-hub-app")

CONFIG_TAB, CONTRACTS, DOCS = "recruitment_config", "recruitment_contracts", "recruitment_docs"
CONFIG_KEYS = ("title_contains", "status_signed", "status_pending", "status_declined", "sync_minutes", "max_pages",
               "mirror_phone")
CONTRACT_HEADER = ("candidate", "email", "phone", "location", "applied", "signed", "status", "signature_request_id",
                   "title", "original_title", "signer_emails", "signer_count", "signed_count", "fields_json")
STATE_ABBR = {"ohio": "OH", "pennsylvania": "PA", "west virginia": "WV", "michigan": "MI", "indiana": "IN",
              "kentucky": "KY", "new york": "NY"}
KEY_PROP, SALT_PROP = "DROPBOX_SIGN_API_KEY", "HUB_PII_SALT"
API = "https://api.hellosign.com/v3/signature_request"
HTTP_TIMEOUT_S = 30.0
# the list and the answers stop being fetched past this, inside the relay's wait for a prepare (the rest is the next
# run's, as the field budget's is)
PREPARE_DEADLINE_S = 90.0
FIELDS_KEPT_MAX = 6000
# the clock: the daily pass (recruitSyncAutoSweep_'s 72000 s), the trigger's own cadence when one is installed
MARKS = "app.talent_marks"
SYNC_MARK, TRIGGER_MARK = "recruitment_sync", "recruitment_trigger"
DAILY_S = 72000
DOC_DIR = "recruitment"
GRANT_GATE = "gate_drive_grant_reader"
# the words the book's copy withholds (its keys name a key)
NO_KEY = "The Dropbox Sign API key is not set, so nothing was read from Dropbox Sign."

s_ = gsjs.str_


# ---- the settings ------------------------------------------------------------------------------------------------

def config_rows(reads: L.Reads) -> list[dict[str, str]]:
    """The settings tab's rows, each keyed by its own key (the subject its facts are kept under where the copy
    withholds the cell)."""
    out = []
    for sub, r in CW.dissolved_rows(reads, CONFIG_TAB).items():
        key = s_(r.get("key"))
        if not key or key.startswith("[withheld"):
            key = s_(sub)
        out.append({"subject": s_(sub), "key": key, "value": s_(r.get("value")), "help": s_(r.get("whatitdoes"))})
    return out


def recruit_config(reads: L.Reads) -> dict[str, str]:
    """recruitConfig_: the shipped words for the seven keys, any row's value over them."""
    out = {k: TP.words(reads, "recruit.cfg." + k, "") for k in CONFIG_KEYS}
    for r in config_rows(reads):
        if r["key"] and r["value"]:
            out[r["key"]] = r["value"]
    return out


def config_read(sess: L.Session, payload: dict) -> dict[str, Any]:
    """recruitmentConfig: the settings and whether the Dropbox Sign key is held — never the key."""
    reads = sess.reads
    if not TP.writer(sess.user):
        return dict(TP.DENIED)
    items = [{"key": r["key"], "value": r["value"], "help": r["help"]} for r in config_rows(reads) if r["key"]]
    return {"status": 200, "data": {"config": items, "key_present": bool(TP.secret(reads, KEY_PROP))}}


# ---- the answers kept (HubCore.gs redaction) ---------------------------------------------------------------------

def ssn_digits(v: Any) -> str:
    """hubSsnDigits_."""
    d = re.sub(r"\D", "", gsjs.or_blank(v))
    return d if len(d) == 9 else ""


def bank_field(key: Any, value: Any) -> bool:
    """hubIsBankField_."""
    k = gsjs.or_blank(key).lower()
    if re.search(r"account.*number|number.*account|routing|aba number|bank account", k):
        return True
    return bool(re.search(r"bank", k)) and bool(re.fullmatch(r"\d{8,17}", re.sub(r"\D", "", gsjs.or_blank(value))))


_NAMED_SSN = re.compile(r"(^|[^a-z])ssn([^a-z]|$)|social security")
# the packet's own fields that are the SSN whatever they are called (Packet.gs PACKET_FIELD_MAP, hiring_packet.FIELD_MAP)
PACKET_SSN_KEYS = frozenset({"ssn", "ssn#", "social security number", "textbox5"})
# the 3-2-4 grouping with any one separator a hand writes (dash, slash, dot, space)
_SSN_GROUPED = re.compile(r"\d{3}[-/. ]\d{2}[-/. ]\d{4}")
_SSN_SHAPE = re.compile(r"\d{3}[-/. ]?\d{2}[-/. ]?\d{4}")


def ssn_named(key: Any) -> bool:
    k = gsjs.trim(gsjs.or_blank(key)).lower()
    return bool(_NAMED_SSN.search(k)) or k in PACKET_SSN_KEYS


def ssn_answer(key: Any, value: Any) -> bool:
    """hubIsSsnAnswer_: stricter than the redactor — shape convicts only in the 3-2-4 grouping."""
    v = gsjs.trim(gsjs.or_blank(value))
    k = gsjs.or_blank(key).lower()
    if bank_field(key, v) or re.search(r"zip|postal|routing|aba", k):
        return False
    if _SSN_GROUPED.fullmatch(v):
        return True
    return ssn_named(key) and bool(ssn_digits(v))


def redact(key: Any, value: Any) -> str | None:
    """hubRedactAnswer_: the value to keep, or None to drop the field (bank numbers, anything that is an SSN)."""
    v = gsjs.or_blank(value)
    if bank_field(key, v):
        return None
    if _SSN_SHAPE.fullmatch(gsjs.trim(v)) or (ssn_named(key) and ssn_digits(v)):
        return None
    return v


def scrubbed(reads: L.Reads, fields_json: Any) -> str | None:
    """A stored contract's answers as the redactor keeps them now — an SSN leaving its salted fingerprint where none
    was kept — or None when nothing in them would be dropped."""
    try:
        fields = json.loads(gsjs.or_blank(fields_json) or "{}")
    except ValueError:
        return None
    if not isinstance(fields, dict):
        return None
    out: dict[str, Any] = {}
    dropped = False
    for k, v in fields.items():
        if k == "ssn_fp":
            out[k] = v
            continue
        if "ssn_fp" not in fields and "ssn_fp" not in out and ssn_answer(k, v):
            fp = ssn_fingerprint(reads, v)
            if fp:
                out["ssn_fp"] = fp
        if isinstance(v, (str, int)) and redact(k, v) is None:
            dropped = True
            continue
        out[k] = v
    return js_json(out) if dropped else None


def ssn_fingerprint(reads: L.Reads, v: Any) -> str:
    """hubSsnFingerprint_: the salted fingerprint, '' without a usable salt (this service never makes one)."""
    d = ssn_digits(v)
    if not d:
        return ""
    salt = gsjs.trim(gsjs.or_blank(reads.db.prop(SALT_PROP)))
    if len(salt) < 16 or salt.startswith("[withheld"):
        return ""
    return base64.b64encode(hashlib.sha256((salt + ":" + d).encode()).digest()).decode()[:22]


def js_json(obj: dict) -> str:
    """JSON.stringify of a plain object of strings."""
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":"))


# ---- the mirror (recruitmentSync's reading) ----------------------------------------------------------------------

def _day(ts: Any) -> str:
    if not ts:
        return ""
    try:
        return datetime.fromtimestamp(float(ts), timezone.utc).strftime("%Y-%m-%d")
    except (TypeError, ValueError, OverflowError, OSError):
        return ""


def _get(url: str, key: str) -> requests.Response:
    return requests.get(url, auth=(key, ""), timeout=HTTP_TIMEOUT_S)


def sync_reading(reads: L.Reads) -> dict[str, Any]:
    """recruitmentSync's reading: every envelope whose title carries the filter, its signer, its status in the
    settings' words and its answers — the list carries none, so they come from the mirror, or are fetched for a signed
    envelope under a budget — each answer filtered before it is kept."""
    key = TP.secret(reads, KEY_PROP)
    if not key:
        return {"status": 503, "message": TP.words(reads, "refuse.recruit.no_api_key", NO_KEY)}
    cfg = recruit_config(reads)
    needle = s_(cfg.get("title_contains")).lower()
    if not needle:
        return {"status": 503, "message": TP.words(reads, "refuse.recruit.no_filter",
                                                   "No title filter is set, so nothing was mirrored.")}
    max_pages = TP.parse_int(cfg.get("max_pages")) or 10
    want_phone = s_(cfg.get("mirror_phone")).lower() != "no"
    prev_fields: dict[str, str] = {}
    for sid, r in CW.dissolved_rows(reads, CONTRACTS).items():
        fj = s_(r.get("fieldsjson"))
        if fj and fj != "{}":
            prev_fields[s_(r.get("signaturerequestid")) or s_(sid)] = fj
    budget = TP.parse_int(cfg.get("field_fetch_per_run")) or 60
    deadline = time.monotonic() + PREPARE_DEADLINE_S
    tally = {"fetched": 0, "skipped": 0, "carried": 0}

    def fetch_fields(srid: str) -> list | None:
        if not srid:
            return None
        if tally["fetched"] >= budget or time.monotonic() >= deadline:
            tally["skipped"] += 1
            return None
        tally["fetched"] += 1
        try:
            r = _get(API + "/" + urllib.parse.quote(srid), key)
            if r.status_code >= 400:
                return None
            one = r.json() or {}
            return ((one.get("signature_request") or {}).get("response_data")) or None
        except (requests.RequestException, ValueError):
            return None

    lines: list[list] = []
    page = 1
    while page <= max_pages:
        try:
            resp = _get(API + f"/list?page={page}&page_size=100", key)
        except requests.RequestException as exc:
            return {"status": 502, "message": TP.words(reads, "refuse.recruit.list_failed",
                                                       "Dropbox Sign did not list the envelopes ({code}).",
                                                       {"code": type(exc).__name__})}
        if resp.status_code >= 400:
            return {"status": 502, "message": TP.words(reads, "refuse.recruit.list_failed",
                                                       "Dropbox Sign did not list the envelopes ({code}).",
                                                       {"code": str(resp.status_code)})}
        try:
            data = resp.json() or {}
        except ValueError:
            data = {}
        for sr in data.get("signature_requests") or []:
            line = _line(reads, sr, needle, cfg, want_phone, prev_fields, fetch_fields, tally)
            if line is not None:
                lines.append(line)
        info = data.get("list_info") or {}
        if page >= (TP.parse_int(info.get("num_pages")) or 1) or time.monotonic() >= deadline:
            break
        page += 1
    lines.sort(key=lambda ln: ln[4], reverse=True)
    return {"status": 200, "data": {"lines": lines, "fields_fetched": tally["fetched"],
                                    "fields_carried": tally["carried"], "fields_left_for_next_run": tally["skipped"],
                                    "status_words": {k: s_(cfg.get(k)) for k in ("status_signed", "status_pending",
                                                                                   "status_declined")}}}


def _line(reads: L.Reads, sr: dict, needle: str, cfg: dict, want_phone: bool, prev_fields: dict[str, str],
          fetch_fields: Callable[[str], list | None], tally: dict[str, int]) -> list | None:
    """One envelope as the mirror's row, or None when its title is not an application."""
    title = s_(sr.get("title"))
    original = s_(sr.get("original_title")) or title
    if needle not in original.lower() and needle not in title.lower():
        return None
    sigs = [x for x in sr.get("signatures") or [] if isinstance(x, dict)]
    sig = next((x for x in sigs if s_(x.get("status_code")) == "signed"), None)
    any_signed = sig is not None
    if sig is None:
        sig = sigs[0] if sigs else {}
    signer_emails = "|".join(e for e in (s_(x.get("signer_email_address")).lower() for x in sigs) if e)
    signed_count = sum(1 for x in sigs if s_(x.get("status_code")) == "signed")
    srid = s_(sr.get("signature_request_id"))
    fields: dict[str, str] = {}

    def absorb(found: Any) -> None:
        for f in found or []:
            if not isinstance(f, dict):
                continue
            n, v = s_(f.get("name")).lower(), s_(f.get("value"))
            if v and n not in fields:
                fields[n] = v
    absorb(sr.get("response_data"))
    if not fields:
        if prev_fields.get(srid):
            tally["carried"] += 1
            try:
                back = json.loads(prev_fields[srid]) or {}
                for bk, bv in (back.items() if isinstance(back, dict) else ()):
                    fields.setdefault(bk, bv)
            except ValueError:
                fields = {}
        elif any_signed:
            absorb(fetch_fields(srid))
    phone = ""
    for k, v in fields.items():
        if ("phone" in k or "cell" in k or "mobile" in k) and len(re.sub(r"\s", "", gsjs.or_blank(v))) >= 7:
            phone = gsjs.or_blank(v)
            break
    st = gsjs.or_text(fields.get("st")) or gsjs.or_text(fields.get("state"))
    if st:
        st = STATE_ABBR.get(st.lower()) or (st[:2].upper() if len(st) > 2 else st.upper())
    location = ", ".join(x for x in (gsjs.or_text(fields.get("city")), st) if x)
    status = (s_(cfg.get("status_declined")) if sr.get("is_declined") else
              s_(cfg.get("status_signed")) if sr.get("is_complete") or any_signed else s_(cfg.get("status_pending")))
    form_email = s_(fields.get("email")) or s_(fields.get("email address")) or s_(sig.get("signer_email_address"))
    kept: dict[str, str] = {}
    chars = 0
    for fk, fv in fields.items():
        if not fv:
            continue
        low = gsjs.or_blank(fv).lower()
        if low in ("false", "off", "no", "unchecked"):
            continue
        if chars > FIELDS_KEPT_MAX:
            break
        if "ssn_fp" not in kept and ssn_answer(fk, fv):
            fp = ssn_fingerprint(reads, fv)
            if fp:
                kept["ssn_fp"] = fp
                chars += 30
        safe = redact(fk, fv)
        if safe is None:
            continue
        kept[fk] = safe[:200]
        chars += len(fk) + len(kept[fk]) + 6
    return [s_(sig.get("signer_name")), form_email.lower(), phone if want_phone else "", location,
            _day(sr.get("created_at")), _day(sig.get("signed_at")), status, srid, title, original, signer_emails,
            len(sigs), signed_count, js_json(kept)]


def sync_prepare(sess: L.Session, payload: dict) -> dict[str, Any]:
    """recruitmentSync's reading, asked first by the relay for an admin's press."""
    u = sess.user or {}
    if not u or s_(u.get("role")) != "admin":
        return dict(TP.DENIED)
    env = sync_reading(sess.reads)
    if env.get("status") != 200:
        return env
    return {"status": 200, "data": TP.seal("recruitmentSyncPrepare", TP.actor(u), env["data"])}


# ---- the clock (recruitSyncAutoSweep_, and the trigger recruitmentInstallTrigger installs) ------------------------

def mark(reads: L.Reads, name: str) -> tuple[float | None, str]:
    """(when, what) a clock mark says; nothing when it was never set."""
    try:
        got = reads.db.query(f"select extract(epoch from at), said from {MARKS} where name = %s", (name,))
    except hubdb.Unreadable:
        return None, ""
    return (float(got[0][0]), s_(got[0][1])) if got else (None, "")


def cadence_s(reads: L.Reads) -> int:
    """How often the mirror is synced by itself: daily, sooner while a trigger is installed."""
    _at, said = mark(reads, TRIGGER_MARK)
    n = TP.parse_int(said)
    return min(DAILY_S, n) if n and n > 0 else DAILY_S


def sync_due(sess: L.Session, payload: dict) -> dict[str, Any]:
    """The relay's clock: once the cadence has passed since the last pass, the mirror's reading; recruitmentSyncSweep
    records it and the mark."""
    if (sess.user or {}).get("is_service") is not True:
        return {"status": 403, "message": "This is the relay's own read."}
    reads = sess.reads
    at, _said = mark(reads, SYNC_MARK)
    if at is not None and time.time() - at < cadence_s(reads):
        return {"status": 200, "data": {"due": False, "why": "ran at " + gsjs.iso(datetime.fromtimestamp(
            at, timezone.utc))}}
    if not TP.secret(reads, KEY_PROP):
        log.info("recruit_sync_no_key: %s", TP.words(reads, "recruit.log.no_key", NO_KEY))
    env = sync_reading(reads)
    return {"status": 200, "data": TP.seal("recruitmentSyncDue", "service", {"due": True, "sync": env})}


# ---- one signed PDF (recruitmentDoc's reading) -------------------------------------------------------------------

def envelope(reads: L.Reads, srid: str) -> dict | None:
    return CW.dissolved_rows(reads, CONTRACTS, [srid]).get(srid)


def doc_cached(reads: L.Reads, srid: str) -> str:
    """recruitDocCached_: the link the first fetch filed."""
    return s_((CW.dissolved_rows(reads, DOCS, [srid]).get(srid) or {}).get("docurl"))


def keep(srid: str, name: str, data: bytes) -> str:
    """The PDF on the server's disk; its path under the documents root."""
    folder = LD.ROOT / DOC_DIR / re.sub(r"[^A-Za-z0-9_-]+", "_", srid)[:80]
    folder.mkdir(parents=True, exist_ok=True)
    target = folder / name
    tmp = target.with_name(target.name + ".part")
    tmp.write_bytes(data)
    os.replace(tmp, target)
    return str(target.relative_to(LD.ROOT))


def grant_reader(drv: Any, fid: str, who: str) -> bool:
    """hubGrantReader_: reader access in silence (Google sends no letter), tried again on a refusal that passes."""
    url = (f"https://www.googleapis.com/drive/v3/files/{urllib.parse.quote(fid)}/permissions"
           "?sendNotificationEmail=false&supportsAllDrives=true")
    body = json.dumps({"role": "reader", "type": "user", "emailAddress": who}).encode()
    for attempt in (1, 2, 3):
        try:
            auth = drv._owner_write("reader access is granted in Drive")
            drv._send(urllib.request.Request(url, data=body, headers={**auth, "Content-Type": "application/json"},
                                             method="POST"))
            return True
        except urllib.error.HTTPError as exc:
            if exc.code not in (429, 500, 502, 503, 504):
                break
        except Exception:  # noqa: BLE001 - a call that never landed is the most retriable one there is
            pass
        time.sleep(attempt)
    log.warning("recruitment: reader access on %s not granted to an address", fid)
    return False


def doc_prepare(sess: L.Session, payload: dict) -> dict[str, Any]:
    """recruitmentDoc's reading: the link already filed, else the signed PDF fetched from Dropbox Sign, filed in the
    platform's Uploads folder as the platform's account, shared with the one who asked (unless the grant gate holds)
    and kept on the server; the write files its link."""
    reads, user = sess.reads, sess.user or {}
    if not TP.writer(user):
        return dict(TP.DENIED)
    srid = s_((payload or {}).get("signature_request_id"))
    if not srid:
        return {"status": 400, "message": TP.words(reads, "refuse.recruit.srid_required",
                                                   "signature_request_id is required.")}
    if envelope(reads, srid) is None:
        return {"status": 404, "message": TP.words(reads, "refuse.recruit.no_application", 'No application "{id}".',
                                                   {"id": srid})}
    by = TP.actor(user)
    cached = doc_cached(reads, srid)
    if cached:
        return {"status": 200, "data": TP.seal("recruitmentDocPrepare", by, {"doc_url": cached, "cached": True,
                                                                            "srid": srid})}
    key = TP.secret(reads, KEY_PROP)
    if not key:
        return {"status": 503, "message": TP.words(reads, "refuse.recruit.no_api_key", NO_KEY)}
    try:
        resp = _get(API + "/files/" + urllib.parse.quote(srid) + "?file_type=pdf", key)
    except requests.RequestException as exc:
        return {"status": 502, "message": TP.words(reads, "refuse.recruit.pdf_failed",
                                                   "Dropbox Sign did not hand the PDF ({code}).",
                                                   {"code": type(exc).__name__})}
    if resp.status_code >= 400:
        return {"status": 502, "message": TP.words(reads, "refuse.recruit.pdf_failed",
                                                   "Dropbox Sign did not hand the PDF ({code}).",
                                                   {"code": str(resp.status_code)})}
    name = "application-" + srid[:12] + ".pdf"
    try:
        drv = reads.need_drive()
        filed = drv.upload_into(OB.uploads_folder(reads, drv), name, "application/pdf", resp.content)
    except Exception as exc:  # noqa: BLE001 - nothing was filed, said
        log.warning("recruitment: a signed application was not filed in Drive (%s)", type(exc).__name__)
        return {"status": 502, "message": "The signed application could not be filed just now — try again."}
    fid = s_(filed.get("id"))
    who = s_(user.get("email"))
    if who and not CPA.gate_holds(reads, GRANT_GATE):
        grant_reader(drv, fid, who)
    path = keep(srid, name, resp.content)
    return {"status": 200, "data": TP.seal("recruitmentDocPrepare", by, {
        "doc_url": "https://drive.google.com/file/d/" + fid + "/view", "cached": False, "path": path, "srid": srid})}


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {
    "recruitmentConfig": config_read, "recruitmentSyncPrepare": sync_prepare, "recruitmentSyncDue": sync_due,
    "recruitmentDocPrepare": doc_prepare}
POLICY: dict[str, dict[str, Any]] = {
    "recruitmentConfig": {"roles": ("admin", "manager")}, "recruitmentSyncPrepare": {"roles": ("admin",)},
    "recruitmentSyncDue": {}, "recruitmentDocPrepare": {"roles": ("admin", "manager")}}
