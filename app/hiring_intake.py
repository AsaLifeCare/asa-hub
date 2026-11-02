"""The hiring intake (HubCore.gs hubIntake, Referrals.gs) on Python — its reads: hubIntakePrepare (a pasted résumé
filed in the platform's Uploads folder before the card is opened) and what the public referral door reads before it
writes (the résumé it stores, the contact the résumé names — referralSubmit_ itself stays Apps Script's while the
door is public); and the rules both share: the referral fast lane's check, the contact search, who one of our own
lines already names, the referral screen's words."""
from __future__ import annotations

import re
import time
from typing import Any, Callable

import candidates as CND
import gsjs
import hubdb
import locations as L
import mail_designs as MD
import onboarding as OB
import recon as R
import resume_intake as RI
import resume_intake_writes as RIW
import screening as SG
import smart_comms as SC
import support_desk_writes as SDW
import talent_pipeline as TP
from scope import Defer

s_ = gsjs.str_
DENIED = {"status": 403, "message": "Requires an admin or manager account"}
# Referrals.gs REFERRAL_PLACEHOLDER_DOMAINS, REFERRAL_STAGE_ORDER, REFERRAL_BOOK_TAB / HEADER
PLACEHOLDER_DOMAINS = frozenset({
    "example.com", "example.org", "example.net", "mail.example", "test.com", "test.test", "email.com", "none.com",
    "noemail.com", "no.com", "na.com", "nomail.com", "domain.com", "sample.com"})
STAGE_ORDER = ("new", "phone-screen", "interview", "onboarding")
BOOK_TAB = "entity_referrals"
BOOK_HEADER = ("referral_id", "name", "email", "phone", "referrer_name", "referrer_phone", "referrer_email",
               "resume_link", "candidate_id", "state", "state_detail", "arrived_at", "resolved_at", "created_by")
RESUME_TEXT_MAX = 20000
CONTACT_MODEL_S = 60.0
_NAME_PART = re.compile(r"[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'.\- ]*")
_EMAIL = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}", re.A)
_DIALABLE = re.compile(r"[2-9]\d{2}[2-9]\d{6}", re.A)
_RUN = re.compile(r"\+?\d[\d\s().\/-]{7,}\d")
ALREADY_KNOWN = ("Good news — {name} is already in our hiring records, and our team is on it. There is nothing you need "
                 "to do: if anything is missing on their side, we will reach out to them directly. Thank you for "
                 "looking out!")
NO_CONTACT = ("Thank you for thinking of {name}! To move forward, our team needs a way to reach them — a phone number "
              "or an e-mail address. We read the resume you sent and could not find either one. Please add a number "
              "or an e-mail to the form and press Send again.")


def writer(user: dict | None) -> bool:
    """hubIsWriter_."""
    return bool(user) and s_((user or {}).get("role")) in ("admin", "manager")


def digits(v: Any) -> str:
    return re.sub(r"\D", "", gsjs.or_blank(v))


# ---- the fast lane (referralFastLaneCheck_) --------------------------------------------------------------------------

def name_part(v: Any) -> bool:
    """referralNamePart_."""
    s = gsjs.trim(s_(v))
    return len(s) >= 2 and _NAME_PART.fullmatch(s) is not None


def fast_lane_check(o: dict[str, Any]) -> dict[str, Any]:
    """referralFastLaneCheck_: shape only (a placeholder is refused, a plausible wrong number passes); every reason at
    once."""
    reasons: list[str] = []
    if not re.search(r"referral", s_(o.get("source")), re.I):
        reasons.append("the source must be Referral")
    if not name_part(o.get("first")) or not name_part(o.get("last")):
        reasons.append("a full name — first and last, letters only")
    d = re.sub(r"^1", "", digits(s_(o.get("phone"))))
    if len(d) != 10:
        reasons.append("a complete 10-digit phone number")
    elif not _DIALABLE.fullmatch(d):
        reasons.append("a dialable phone number — that area code or prefix cannot exist")
    elif d in SC.SHARED_LINE_DIGITS:
        reasons.append("a personal phone number — that is one of our own lines")
    email = gsjs.trim(s_(o.get("email")).lower())
    domain = email[email.index("@") + 1:] if email.find("@") > 0 else ""
    if not _EMAIL.fullmatch(email) or ".." in email:
        reasons.append("a valid email address")
    elif domain in PLACEHOLDER_DOMAINS:
        reasons.append("a real email address — " + domain + " is a placeholder")
    if not name_part(o.get("referrer")):
        reasons.append("the name of whoever referred them")
    return {"ok": not reasons, "reasons": reasons}


# ---- the referral's contact (referralContactFind_, referralKnownByDigits_) ------------------------------------------

def contact_find(reads: L.Reads, text: str, deadline: float) -> dict[str, str]:
    """referralContactFind_: every answer must literally occur in the text — the deterministic reading first, any
    phone-shaped run next, the model last."""
    out = {"email": "", "phone": ""}
    t = gsjs.or_blank(text)
    if not re.sub(r"\s+", "", t):
        return out
    low, td = t.lower(), digits(t)

    def occurs(c: Any) -> bool:
        c = gsjs.or_blank(c)
        if not c:
            return False
        if "@" in c:
            return c.lower() in low
        d = digits(c)
        return len(d) >= 10 and d in td
    try:
        parsed = RI.identity(t)
        if parsed.get("email") and occurs(parsed["email"]):
            out["email"] = parsed["email"].lower()
        if parsed.get("phone") and occurs(parsed["phone"]):
            out["phone"] = parsed["phone"]
    except Exception:  # noqa: BLE001 - as Apps Script: the next reader tries
        pass
    if out["phone"]:
        return out
    for m in _RUN.finditer(t):
        if 10 <= len(digits(m.group(0))) <= 13:
            out["phone"] = gsjs.trim(m.group(0))
            break
    if out["phone"] or out["email"]:
        return out
    try:
        prompt = CND.book_text(reads, "Prompts", "ai_referral_contact", "").replace("{text}", t[:12000])
        chat = SG.ai(reads, prompt, 0, "ai_referral_contact", deadline) if prompt else None
        obj = SG.parsed((chat or {}).get("content"))
        if chat and chat.get("ok") and isinstance(obj, dict):
            em, ph = s_(obj.get("email")).lower(), s_(obj.get("phone"))
            if em and em.find("@") > 0 and occurs(em):
                out["email"] = em
            elif ph and occurs(ph):
                out["phone"] = ph
    except (Defer, hubdb.Unreadable):
        raise
    except Exception:  # noqa: BLE001 - as Apps Script: no answer is no contact
        pass
    return out


def known_by_digits(reads: L.Reads, raw: Any) -> dict[str, str] | None:
    """referralKnownByDigits_: who one of our own lines already names — a live card, an account, a person on the
    roster. Raw digits on purpose: recognition needs the owner. Never creates."""
    d = re.sub(r"^1", "", digits(raw))
    if len(d) < 10:
        return None

    def same(v: Any) -> bool:
        pd = re.sub(r"^1", "", digits(v))
        return len(pd) >= 10 and pd == d

    def cards() -> dict | None:
        for c in CND.read_tab(reads, CND.TALENT_CANDIDATES_TAB):
            if s_(c.get("archived")).lower() != "true" and same(c.get("phone")):
                return {"name": s_(c.get("candidatename"))}
        return None

    def users() -> dict | None:
        for u in reads.users():
            if s_(u.get("mergedinto")):
                continue
            if same(u.get("phone")) or any(same(x) for x in re.split(r"[,;|]", gsjs.or_blank(u.get("phones")))):
                return {"name": s_(u.get("displayname"))}
        return None

    def people() -> dict | None:
        import staff as SP  # noqa: PLC0415 - listRows_('people'), read only on this path
        for p in SP._people(reads):
            if same(p.get("phone")):
                return {"name": s_(p.get("name"))}
        return None
    for look in (cards, users, people):
        hit, why = CND.soft(look)
        if hit and not why:
            return hit
    return None


def screen_text(reads: L.Reads, key: str, shipped: str, fallback: str, name: str) -> str:
    """referralScreenText_: the situation row's words, else the floor, {name} filled."""
    text = fallback
    try:
        rows = SC.read_situations(reads.db)
        sid = MD.situation_id(reads, rows, key, shipped)
        hit = next((r for r in rows if s_(r.get("id")) == sid), None)
        if hit is not None:
            text = s_(hit.get("email_text")) or s_(hit.get("emailtext")) or fallback
    except Exception:  # noqa: BLE001 - the floor answers
        pass
    return text.replace("{name}", s_(name) or "this person")


def already_known_text(reads: L.Reads, name: str) -> str:
    return screen_text(reads, "referral.already_known", "referral_already_known", ALREADY_KNOWN, name)


def warn_text(reads: L.Reads, name: str) -> str:
    """referralWarnText_."""
    return screen_text(reads, "referral.no_contact", "referral_no_contact", NO_CONTACT, name)


# ---- what a referral reads before it writes (referralSubmit_'s Drive and model half) --------------------------------

def referral_fields(p: dict) -> dict[str, str]:
    """referralSubmit_'s fields as the door cuts them; a malformed referrer contact is recorded as nothing."""
    ref_phone = s_(p.get("referrer_phone"))[:40]
    ref_email = s_(p.get("referrer_email")).lower()[:160]
    at = ref_email.find("@")
    return {"name": s_(p.get("name"))[:120], "phone": s_(p.get("phone"))[:40],
            "email": s_(p.get("email")).lower()[:160], "referrer": s_(p.get("referrer"))[:120],
            "referrer_phone": ref_phone if len(digits(ref_phone)) >= 10 else "",
            "referrer_email": ref_email if at > 0 and ref_email.rfind(".") > at else "",
            "resume_text": gsjs.or_blank(p.get("resume_text"))[:RESUME_TEXT_MAX]}


def reach(phone: str, email: str) -> dict[str, Any]:
    """Whether a phone and an e-mail reach anybody: our own lines create nobody (their digits kept to recognise)."""
    d = digits(phone)
    out = {"phone": phone, "digits": d, "has_phone": len(d) >= 10, "shared": "", "email": email,
           "has_email": email.find("@") > 0 and email.rfind(".") > email.find("@")}
    if out["has_phone"] and d[-10:] in SC.SHARED_LINE_DIGITS:
        out.update(shared=d, has_phone=False, phone="")
    return out


def _stored(reads: L.Reads, p: dict, default: str) -> dict[str, Any]:
    """hubDriveFileObj_ for the form's file: filed in the platform's Uploads folder, the admins given a reader seat,
    kept on the server."""
    got = RI.store_file(L.Session(reads, {}), {"base64": s_(p.get("file_base64")),
                                               "filename": s_(p.get("file_name")) or default,
                                               "mime_type": s_(p.get("mime"))}, default)
    if "refused" in got:
        raise ValueError(s_(got["refused"].get("message")))
    return got


def text_file(reads: L.Reads, name: str, text: str, by: str) -> dict[str, str]:
    """hubUploadsFolder_().createFile(name, text, PLAIN_TEXT): folder-inherited access only, kept on the server."""
    data = text.encode("utf-8")
    drv = reads.need_drive()
    filed = drv.upload_into(OB.uploads_folder(reads, drv), name, "text/plain", data)
    fid = s_(filed.get("id"))
    RI.keep(fid, name, "text/plain", data, by)
    return {"url": "https://drive.google.com/file/d/" + fid + "/view", "name": s_(filed.get("name")) or name}


def clean_name(name: str) -> str:
    """name.replace(/[^\\w ]/g, '').slice(0, 40).trim()."""
    return gsjs.trim(re.sub(r"[^\w ]", "", name, flags=re.A)[:40])


def referral_prepare(reads: L.Reads, p: dict, deadline: float | None = None) -> dict[str, Any]:
    """referralSubmit_ up to its writing: the résumé stored and read when the form named no contact, the contact it
    names, and the résumé's link once the door would open a card (a duplicate or a refusal stores nothing)."""
    deadline = deadline if deadline is not None else time.monotonic() + CONTACT_MODEL_S
    f = referral_fields(p if isinstance(p, dict) else {})
    out: dict[str, Any] = {"probe_url": "", "found": {"email": "", "phone": ""}, "link": ""}
    name = f["name"]
    if not name or len(re.sub(r"\s+", "", name)) < 2:
        return out
    r = reach(f["phone"], f["email"])
    if not r["has_phone"] and not r["has_email"]:
        text = f["resume_text"]
        if not re.sub(r"\s+", "", text) and s_(p.get("file_base64")):
            try:
                probe = _stored(reads, p, "referral-resume.pdf")
                out["probe_url"] = probe["url"]
                text = RI.text_of(reads, probe["id"], probe["data"], probe["mime"])[0]
            except (Defer, hubdb.Unreadable):
                raise
            except Exception:  # noqa: BLE001 - as Apps Script: nothing to search
                text = ""
        out["found"] = contact_find(reads, text, deadline)
        if out["found"]["email"]:
            r.update(email=out["found"]["email"], has_email=True)
        elif out["found"]["phone"]:
            r = reach(out["found"]["phone"], r["email"])
        if not r["has_phone"] and not r["has_email"]:
            return out
    dup, why = CND.soft(lambda: RI.find_duplicate(reads, re.sub(r"^1", "", r["digits"]) if r["has_phone"] else "",
                                                   r["email"] if r["has_email"] else ""))
    if dup and not why:
        return out
    guard, why = CND.soft(lambda: TP.contact_guard(reads, r["phone"] if r["has_phone"] else "",
                                                   r["email"] if r["has_email"] else "", name=name, trusted=False))
    if guard and not why and guard["severity"] == "block" and TP.enforces(reads, "public"):
        return out
    try:
        if out["probe_url"]:
            out["link"] = out["probe_url"]
        elif s_(p.get("file_base64")):
            out["link"] = _stored(reads, p, "referral-resume.pdf")["url"]
        elif re.sub(r"\s+", "", f["resume_text"]):
            out["link"] = text_file(reads, "referral-" + clean_name(name) + ".txt", f["resume_text"], "referral:public")[
                "url"]
    except (Defer, hubdb.Unreadable):
        raise
    except Exception:  # noqa: BLE001 - a failure costs the document, never the referral
        out["link"] = ""
    return out


# ---- hubIntake's pasted résumé ---------------------------------------------------------------------------------------

def intake_refused(reads: L.Reads, p: dict) -> bool:
    """What hubIntake refuses before its résumé is filed: the identity, a duplicate, a staff contact held by the guard
    (said by the write, never here)."""
    first, last = s_(p.get("first_name")), s_(p.get("last_name"))
    phone, email = s_(p.get("phone")), s_(p.get("email")).lower()
    if RI.intake_check(first, last, phone, email):
        return True
    if RI.find_duplicate(reads, re.sub(r"^1", "", digits(phone)), email):
        return True
    name = gsjs.trim(first + " " + last)
    if name.lower().startswith("[test]"):
        return False
    g = SDW.contact_guard(reads, phone, email)
    mode = gsjs.trim(gsjs.or_blank(SDW.guard_config(reads).get(RIW.GUARD_KEY))).lower() or "shadow"
    if not g or g["severity"] == "warn" or mode != "enforce":
        return False
    return g["severity"] == "unverified" or len(s_(p.get("staff_conflict_override"))) <= 3


def intake_prepare(sess: L.Session, payload: dict) -> dict[str, Any]:
    """hubIntakePrepare: a pasted résumé (no file attached) filed as a text file in the platform's Uploads folder and
    kept on the server, sealed for hubIntake; a failure costs the document, never the candidate."""
    user = sess.user or {}
    if not writer(user):
        return dict(DENIED)
    p = payload if isinstance(payload, dict) else {}
    reads = sess.reads
    out = {"resume_link": "", "resume_filename": ""}
    pasted = gsjs.or_blank(p.get("resume_text"))[:RESUME_TEXT_MAX]
    if not s_(p.get("resume_link")) and re.sub(r"\s+", "", pasted) and not intake_refused(reads, p):
        name = gsjs.trim(s_(p.get("first_name")) + " " + s_(p.get("last_name")))
        try:
            got = text_file(reads, "resume-" + clean_name(name) + ".txt", pasted, s_(user.get("email")))
            out = {"resume_link": got["url"], "resume_filename": got["name"]}
        except (Defer, hubdb.Unreadable):
            raise
        except Exception:  # noqa: BLE001 - the document is lost, the card is not
            pass
    return {"status": 200, "data": R.seal("hubIntake", R.actor(user), out)}


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {"hubIntakePrepare": intake_prepare}
POLICY: dict[str, dict[str, Any]] = {"hubIntakePrepare": {"roles": ("admin", "manager")}}
