"""inviteSend and inviteRevoke (apps-script/Invites.gs) decided off asa-hub-db: the invitation's row kept in app.edits
over platform_invites, and its letter (and the SMS copy) said only through Smart Comms, as the authentication letter
`invitation` that the dial does not hold."""
from __future__ import annotations

import re
from datetime import timedelta
from typing import Any, Callable

import auth as A
import auth_invites as AI
import gsjs
import hubdb
import letters
import locations as L
import mail_designs as MD
import smart_comms as SC
import staff_views
import studio as ST
import writes as W
from writes import Decision

NO_SECRET = {"status": 503, "message": "Set the INTERVIEW_LINK_SECRET Script Property first — invitation links refuse "
                                      "to be minted without a signing key."}
NO_EMAIL = {"status": 400, "message": "A valid e-mail address is required."}
NO_NAME = {"status": 400, "message": "Their name is required — the letter greets a person."}
HAS_ACCOUNT = {"status": 409, "message": "That address already has an account here. Use Users → Invite to send them "
                                         "their login."}
WAITING = {"status": 409, "message": "They already have an invitation waiting. Revoke it first to send a new one."}
NO_ID = {"status": 400, "message": "invite_id is required."}
REGISTERED = {"status": 409, "message": "They have already registered — remove the account instead."}
NOT_FOUND = {"status": 404, "message": "Not found."}
# SmartGate.gs HUB_AUTH_SITUATIONS.invitation
SITUATION = "auth_invitation"
SMS_FLOOR = "{name}, your ASA invitation — create your account: {link}"
PREHEADER = "Create your account — you choose the password."

s_ = gsjs.str_


def line(user: dict | None, action: str, target: str, status: int = 200) -> None:
    """hubSysLog_."""
    staff_views.record(user, action, target, status)


def denied(user: dict | None) -> bool:
    u = user or {}
    return not user or bool(u.get("is_service")) or s_(u.get("role")) != "admin"


def gate(reads: L.Reads) -> dict[str, Any]:
    """hubAuthLetterAllowed_('invitation'): an unreadable situations tab holds the letter, a missing row lets it go,
    a row switched off on the Desk stops it."""
    try:
        rows = SC.read_situations(reads.db)
    except Exception as exc:  # noqa: BLE001 - an unreadable switch is never a yes
        why = (f"the situations tab could not be read ({type(exc).__name__}), so this letter is HELD — nobody can say "
               f"the situation {SITUATION} was not switched off, and an unreadable switch is never a yes. Asked again "
               "once the tab answers, it leaves.")
        return {"on": False, "row": None, "unreadable": True, "why": why}
    row = SC.situation_row(rows, SITUATION)
    if row is None:
        return {"on": True, "row": None, "unreadable": False, "why": ""}
    on = SC.smart_on(row.get("enabled"))
    return {"on": on, "row": row, "unreadable": False,
            "why": "" if on else (f"the situation {SITUATION} is switched off on the Desk, so this letter is not sent "
                                  "at all — the switch beats the exemption, the dial does not")}


def words(row: dict | None, field: str, floor: str = "") -> str:
    """hubAuthLetterWords_: the row's cell when filled, else the floor."""
    cell = gsjs.trim(gsjs.or_blank((row or {}).get(field))) if row else ""
    return cell or floor


def register_email(name: str, link: str, days: int, inviter: str) -> dict[str, str]:
    """inviteRegisterEmail_ (MailTemplates.gs): the designed invitation."""
    greeting = "Hi " + name + "," if name else "Hello,"
    blocks = [
        MD.mail_para(MD.mail_esc(greeting) + " you have been invited to the ASA LifeCare platform"
                     + (" by " + MD.mail_esc(inviter) if inviter else "") + "."),
        MD.mail_para("Open the link below to create your account. You choose your own password — "
                     "nobody here sets one for you, and there is nothing to change afterwards."),
        MD.mail_fact("Your invitation link", link, True),
        MD.mail_steps(["Open the link (it is personal to you).", "Pick a password of at least 8 characters.",
                       "You are in — the platform opens on your own workspace."]),
        MD.mail_para("The link stands for " + str(days) + " days. If it expires, ask for a new one."),
    ]
    html = MD.mail_shell({"title": "Your invitation to ASA LifeCare", "preheader": PREHEADER, "blocks": blocks})
    text = (greeting + " you have been invited to the ASA LifeCare platform" + (" by " + inviter if inviter else "")
            + ".\n\nCreate your account here (you choose your own password):\n" + link + "\n\n"
            "The link is personal to you and stands for " + str(days) + " days.")
    return {"subject": "Your invitation to ASA LifeCare", "html": html, "text": text}


def letter_from_row(row: dict | None, name: str, link: str, days: int, inviter: str) -> dict[str, str]:
    """inviteLetterFromRow_: the situation's own words when it has them, the designed letter when it has none."""
    floor = register_email(name, link, days, inviter)
    vars_ = {"name": gsjs.trim(name), "link": link, "days": str(days), "inviter": inviter,
             "by_inviter": " by " + inviter if inviter else ""}
    subj, text_cell = words(row, "email_subject"), words(row, "email_text")
    subject = letters.render(subj, vars_) if subj else floor["subject"]
    if not text_cell:
        return {"subject": subject, "text": floor["text"], "html": floor["html"], "words": "template"}
    text = letters.render(text_cell, vars_)
    href = MD.mail_esc(link)
    blocks = []
    for para in re.split(r"\n{2,}", text):
        inner = MD.mail_esc(para).replace("\n", "<br>")
        if href and href in inner:
            inner = inner.replace(href, f'<a href="{href}">{href}</a>')
        blocks.append(MD.mail_para(inner))
    html = MD.mail_shell({"title": subject, "preheader": PREHEADER, "blocks": blocks})
    return {"subject": subject, "text": text, "html": html, "words": "row"}


def invite_send(sess: L.Session, payload: dict) -> Decision:
    """inviteSend: an invitation to register, its row kept, the letter (and the SMS copy) raised in Smart Comms."""
    user = sess.user or {}
    if denied(sess.user):
        return Decision({"status": 403, "message": "Requires an admin or manager account"})
    reads = sess.reads
    secret = AI.secret(reads)
    if not secret:
        return Decision(dict(NO_SECRET))
    p = payload or {}
    email = gsjs.trim(s_(p.get("email"))).lower()
    name = gsjs.trim(s_(p.get("name")))
    phone = gsjs.trim(s_(p.get("phone")))
    if "@" not in email:
        return Decision(dict(NO_EMAIL))
    if not name:
        return Decision(dict(NO_NAME))
    if A.user_by_email(reads.users(), email):
        return Decision(dict(HAS_ACCOUNT))
    for r in AI.invites(reads):
        if s_(r.get("email")).lower() == email and s_(r.get("status")) not in ("revoked", "registered"):
            return Decision(dict(WAITING))
    iid = "inv_" + A.random_hex(10)
    token = A.invite_token(secret, iid)
    at = gsjs.iso(reads.now)
    rec = {"invite_id": iid, "email": email, "phone": phone, "name": name, "status": "sent",
           "invited_by": s_(user.get("email")), "invited_at": at, "registered_at": "", "user_id": "",
           "expires_at": gsjs.iso(reads.now + timedelta(days=AI.TTL_DAYS)), "tenant": ST.tenant_id(reads, user)}
    res = AI.tab(reads)
    sid, tab = W.where_of(res)
    heads = {hubdb.norm_key(h): gsjs.trim(gsjs.js_str(h)) for h in (res.ref.headers if res.ref is not None else ())}
    cells = {heads.get(hubdb.norm_key(h), h): rec[h] for h in AI.INVITES_HEADER}
    match = W.COLS + heads.get("inviteid", "invite_id")
    edit = W.kept_record(sid, tab, "append", match, iid, AI.SUBJECT, cells)
    link = AI.link(token)
    sent = {"email": False, "sms": False}
    why = ""
    allowed = gate(reads)
    if not allowed["on"]:
        line(user, "inviteSend_switch_unreadable" if allowed["unreadable"] else "inviteSend_situation_off",
             iid + " — " + allowed["why"], 502 if allowed["unreadable"] else 200)
        return W.final({"status": 200, "data": {"invite_id": iid, "sent": sent, "why": allowed["why"], "link": link}},
                       [edit], AI.SUBJECT)
    inviter = gsjs.trim(s_(user.get("display_name") or user.get("name")))
    letter = letter_from_row(allowed["row"], name, link, AI.TTL_DAYS, inviter)
    got = SC.raise_situation(None, situation=SITUATION, to=email, vars={}, key=f"invite_{iid}_email",
                             lane="invitation", channel="email", subject=letter["subject"], body=letter["text"],
                             html=letter["html"], transport=True, auth_letter="invitation", withhold=[link])
    if got.get("state") == "sent":
        sent["email"] = True
    else:
        why = s_(got.get("why")) or "the e-mail was refused"
    if phone:
        sms = A.fill(words(allowed["row"], "sms_text", SMS_FLOOR), {"name": name, "link": link})
        sgot = SC.raise_situation(None, situation=SITUATION, to=phone, vars={}, key=f"invite_{iid}_sms",
                                  lane="invitation", channel="sms", body=sms, transport=True, quiet_exempt=True,
                                  withhold=[link])
        if sgot.get("state") == "sent":
            sent["sms"] = True
        elif not why:
            why = s_(sgot.get("why")) or "the SMS was refused"
    line(user, "inviteSend", iid)
    return W.final({"status": 200, "data": {"invite_id": iid, "sent": sent, "why": why, "link": link}}, [edit],
                   AI.SUBJECT)


def invite_revoke(sess: L.Session, payload: dict) -> Decision:
    """inviteRevoke: an invitation not yet used stops working."""
    user = sess.user or {}
    if denied(sess.user):
        return Decision({"status": 403, "message": "Requires an admin or manager account"})
    iid = s_((payload or {}).get("invite_id"))
    if not iid:
        return Decision(dict(NO_ID))
    reads = sess.reads
    res = AI.tab(reads)
    if res.ref is None:
        return Decision(dict(NOT_FOUND))
    here = ST.tenant_id(reads, user)
    raw_rows = reads.db.rows(res.ref)
    for n, (_rn, raw) in enumerate(raw_rows):
        row = AI.normalized(raw)
        if s_(row.get("inviteid")) != iid:
            continue
        if here and s_(row.get("tenant")) != here:
            break
        if s_(row.get("status")) == "registered":
            return Decision(dict(REGISTERED))
        head = W.header_of(res.ref, "invite_id", norm=True)
        status = W.header_of(res.ref, "status", norm=True)
        got = W.row_key_of(raw_rows, n, [[head]]) if head and status else None
        if got is None:
            return Decision({"status": 409, "message": W.NOT_TOLD_APART})
        sid, tab = W.where_of(res)
        edit = W.kept_record(sid, tab, "edit", got[0], got[1], AI.SUBJECT, {status: "revoked"},
                             before={status: s_(raw.get(status))})
        line(user, "inviteRevoke", iid)
        return W.final({"status": 200, "data": {"ok": True}}, [edit], AI.SUBJECT)
    return Decision(dict(NOT_FOUND))


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {"inviteSend": invite_send, "inviteRevoke": invite_revoke}
# HUB_POLICY: Invites.gs's roles
POLICY: dict[str, dict[str, Any]] = {"inviteSend": {"roles": ("admin",)}, "inviteRevoke": {"roles": ("admin",)}}
BUSY_OF: dict[str, dict[str, Any]] = {a: {"status": 409, "message": W.BUSY} for a in ACTIONS}


class Store(W.Store):
    """app.auth_invites_writes and _receipts; the invitations' cells app.edits' over platform_invites."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="auth_invites", label="Settings › Members — Invitations")
