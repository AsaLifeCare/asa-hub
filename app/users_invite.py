"""userInvite (apps-script/HubCore.gs) off asa-hub-db: an existing account sent its way in — the sign-in, and the
workspace default while the account is still on it — only through Smart Comms. The letter claims the authentication
letter `invitation` (HUB_AUTH_LETTERS: the dial, the window and the sending switch do not hold it, a person's opt-out
does); the text claims nothing, and a first password is never texted to a shared line. The password is named to every
leg as a secret its records never keep. Nothing is written but the messages; the master's row is the real master's
alone, as in users_writes."""
from __future__ import annotations

import re
from typing import Any, Callable

import auth_invites_writes as AIW
import gsjs
import locations as L
import mail_designs as MD
import smart_clock as SK
import smart_comms as SC
import smart_comms_desk as SCD
import users_writes as UW
import writes as W
from writes import Decision

s_ = gsjs.str_
# HubCore.gs USER_INVITE_SITUATION / USER_INVITE_AUTH_KIND; MailTemplates.gs mailPlatformUrl_
SITUATION = "user_account_invite"
AUTH_KIND = "invitation"
PLATFORM_URL = "https://asamylife.asalifecare.com"
CAP = 50
# commReleaseHeldReason_'s word for each brake raise_situation names
BRAKE = {"quiet": "quiet_hours", "test_mode": "rehearsal", "recorded": "recorded_to"}


def situation_gate(reads: L.Reads, sid: str) -> dict[str, Any]:
    """hubSituationGate_: the situation's row, on; unreadable, absent or off says why, nothing is sent."""
    try:
        rows = SC.read_situations(reads.db)
    except Exception as exc:  # noqa: BLE001 - an unreadable switch is never a yes
        return {"on": False, "row": None, "unreadable": True,
                "why": f"the situations tab could not be read ({type(exc).__name__}) — {sid} is held, not sent: an "
                       "unreadable switch is never a yes"}
    row = SC.situation_row(rows, sid)
    if row is None:
        return {"on": False, "row": None, "unreadable": False,
                "why": f"the situation {sid} is not in the situations tab yet — nothing was sent"}
    if not SC.smart_on(row.get("enabled")):
        return {"on": False, "row": row, "unreadable": False,
                "why": f"the situation {sid} is switched off in Smart Comms — nothing was sent"}
    return {"on": True, "row": row, "unreadable": False, "why": ""}


def invite_gate(reads: L.Reads) -> dict[str, Any]:
    """userInviteGate_: the invitation's switch (auth_invitation stops every invitation), then this letter's own row."""
    kind = AIW.gate(reads)
    sid = AIW.SITUATION
    if not kind["on"]:
        if not kind["unreadable"]:
            return {"on": False, "row": None, "state": "off", "situation": sid, "planted": True,
                    "why": f"the invitation situation ({sid}) is switched off in Smart Comms, and it stops every "
                           "invitation, this one too"}
        return {"on": False, "row": None, "state": "held", "situation": sid, "planted": None,
                "why": f"the invitation situation ({sid}) could not be read, so the invitation is held — an unreadable "
                       "switch is never a yes; asked again once the tab answers, it leaves"}
    own = situation_gate(reads, SITUATION)
    if not own["on"]:
        return {"on": False, "row": None, "state": "held" if own["unreadable"] else "off", "situation": SITUATION,
                "planted": None if own["unreadable"] else own["row"] is not None, "why": s_(own["why"])}
    return {"on": True, "row": own["row"], "state": "", "situation": SITUATION, "planted": True, "why": ""}


def letter(row: dict, vars_: dict[str, str], login: str, pw: str, url: str) -> dict[str, str]:
    """userInviteLetter_: the row's words; the sign-in and the password ride as facts."""
    subject = SC.render(s_(row.get("email_subject")), vars_) or "Your ASA LifeCare account"
    body = SC.render(gsjs.or_blank(row.get("email_text")), vars_)
    blocks = [MD.mail_para(MD.mail_esc(para).replace("\n", "<br>"))
              for para in (gsjs.trim(x) for x in re.split(r"\n{2,}", body)) if para]
    blocks.append(MD.mail_fact("Your sign-in", login, True))
    if pw:
        blocks.append(MD.mail_fact("First-time password", pw, True))
        blocks.append(MD.mail_para("<strong>This password is not yours and is not private.</strong> It is the one "
                                   "every new account starts on, so the platform asks you to choose your own the "
                                   "moment you sign in."))
    text = (body + "\n\nSign-in: " + login
            + ("\nFirst-time password: " + pw + " (not private — you choose your own at sign-in)" if pw else "")
            + "\n" + url)
    html = MD.mail_shell({"title": subject, "preheader": "Your account is ready to use.", "blocks": blocks,
                          "cta": {"href": url, "label": "Open the platform"} if url else None})
    return {"subject": subject, "text": text, "html": html}


def leg(channel: str, label: str, got: dict[str, Any]) -> dict[str, str]:
    """userInviteLeg_: one leg's answer in the invite's words."""
    state = s_(got.get("state"))
    if state == "sent":
        return {"channel": channel, "state": "sent", "why": ""}
    if state == "already":
        return {"channel": channel, "state": "already", "why": label + ": the same message already went out — not "
                                                                       "sent again"}
    if state == "refused":
        # the one refusal raise_situation makes is the person's opt-out
        return {"channel": channel, "state": "refused", "why": label + " refused: the person asked us to stop"}
    if state == "held":
        held = s_(got.get("held"))
        brake = BRAKE.get(held, "send_switch_off" if "HUB_RPC_SEND" in held or held == SC.SWITCH_OFF else held)
        return {"channel": channel, "state": "held",
                "why": label + " held" + (" (" + brake + ")" if brake else "") + ": "
                       + (s_(got.get("why")) or "a brake")}
    return {"channel": channel, "state": "refused",
            "why": label + " refused: " + (s_(got.get("why")) or "the send door refused it")}


def outcome(legs: list[dict]) -> str:
    """userInviteOutcome_: any sent is sent, then held, then already, else refused."""
    for s in ("sent", "held", "already"):
        if any(x["state"] == s for x in legs):
            return s
    return "refused"


def user_invite(sess: L.Session, payload: dict) -> Decision:
    """userInvite: each account sent its sign-in (and the default while it is still on it) — sent, held or refused
    per account, said."""
    p = payload if isinstance(payload, dict) else {}
    shut, _here = UW.door_gate(sess, "userInvite", p)
    if shut is not None:
        return shut
    user = sess.user or {}
    if not sess.user or s_(user.get("role")) != "admin":
        return Decision(dict(UW.DENIED))
    if user.get("is_service"):
        return W.refuse(403, "A service session does not invite people.")
    ids = p.get("user_ids") if isinstance(p.get("user_ids"), list) else []
    if not ids:
        return W.refuse(400, "user_ids: at least one account.")
    if len(ids) > CAP:
        return W.refuse(400, "Fifty invitations at a time is the cap.")
    reads = sess.reads
    default_pw = UW.default_password(reads)
    gate = invite_gate(reads)
    if not gate["on"]:
        UW.log_line(user, "user_invite_situation", gate["why"], 502 if gate["state"] == "held" else 200)
        return Decision({"status": 200, "data": {"state": gate["state"], "situation": gate["situation"],
                                                 "planted": gate["planted"],
                                                 "why": "Nobody was invited: " + gate["why"] + ".",
                                                 "sent": [], "held": [], "skipped": []}})
    row = gate["row"]
    acc = UW.Accounts(reads)
    chans = SC.smart_list(row.get("channels"))
    inviter = s_(user.get("display_name") or user.get("name"))
    today = W.now_iso(reads)[:10]
    sent: list[dict] = []
    held: list[dict] = []
    skipped: list[dict] = []
    for raw_id in ids:
        uid = s_(raw_id)
        at = acc.first(uid)
        if at is None or acc.hidden(at, user):
            skipped.append({"id": uid, "why": "no such account"})
            continue
        email = acc.cell(at, "email")
        who = acc.cell(at, "displayname") or email
        if "@" not in email and not SC.sendable(email):
            skipped.append({"id": uid, "name": who, "why": "no address, and the number cannot be texted"})
            continue
        if "active" in acc.raw and acc.cell(at, "active").lower() != "true":
            skipped.append({"id": uid, "name": who, "why": "the account is not active yet"})
            continue
        on_default = (acc.cell(at, "mustchange").lower() == "true" or not acc.armed(at)
                      or ("lastlogin" in acc.raw and not acc.cell(at, "lastlogin")))
        if on_default and not default_pw:
            skipped.append({"id": uid, "name": who, "why": "FIRST_USER_PASSWORD is not set on this project"})
            continue
        pw = default_pw if on_default else ""
        vars_ = {"first_name": who.split(" ")[0], "name": who, "login": email, "url": PLATFORM_URL,
                 "inviter": inviter, "by_inviter": " — " + inviter + " set it up for you" if inviter else "",
                 "password_line": (" — first-time password: " + pw + " (you will choose your own at sign-in).")
                 if pw else "."}
        secret = [pw] if pw else None
        ledger = SK.ledger_key(SITUATION, email or uid, today)
        legs: list[dict] = []
        if "@" in email and "email" in chans and s_(row.get("email_text")):
            mail = letter(row, vars_, email, pw, PLATFORM_URL)
            got = SC.raise_situation(None, situation=SITUATION, to=email, vars={}, key=f"user_invite_{uid}_email",
                                     ledger_key=ledger, ledger_person=who, channel="email", subject=mail["subject"],
                                     body=mail["text"], html=mail["html"], transport=True, auth_letter=AUTH_KIND,
                                     withhold=secret)
            legs.append(leg("email", "the letter", got))
        raw_num = acc.cell(at, "phone") or (email if "@" not in email else "")
        to_num = SC.sendable(raw_num)
        if to_num and pw and SCD.shared_line(to_num) and "sms" in chans and s_(row.get("sms_text")):
            legs.append({"channel": "sms", "state": "refused",
                         "why": "the text refused: that number is a shared line — a first-time password is not "
                                "texted there"})
        elif to_num and "sms" in chans and s_(row.get("sms_text")):
            got = SC.raise_situation(None, situation=SITUATION, to=to_num, vars={}, key="invite_sms_" + uid,
                                     ledger_key=ledger, ledger_person=who, channel="sms",
                                     body=SC.render(s_(row.get("sms_text")), vars_), transport=True,
                                     quiet_exempt=True, withhold=secret)
            legs.append(leg("sms", "the text", got))
        state = outcome(legs)
        why = " · ".join(x["why"] for x in legs if x["state"] != "sent")
        entry = {"id": uid, "name": who, "email": email, "state": state, "with_password": bool(on_default),
                 "via": "+".join(x["channel"] for x in legs if x["state"] == "sent"), "why": why}
        if state == "sent":
            sent.append(entry)
        elif state in ("held", "already"):
            held.append(entry)
        else:
            entry["why"] = why or f"the situation {SITUATION} writes no letter or text this account can receive"
            skipped.append(entry)
    states = [e.get("state") or "refused" for e in sent + held + skipped]
    word = "mixed" if any(s != states[0] for s in states) else (states[0] if states else "refused")
    UW.log_line(user, "user_invite", f"{len(sent)} invitation(s) sent, {len(held)} held, {len(skipped)} refused")
    return Decision({"status": 200, "data": {"state": word, "situation": SITUATION, "why": "", "sent": sent,
                                             "held": held, "skipped": skipped}})


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {"userInvite": user_invite}
POLICY: dict[str, dict[str, Any]] = {"userInvite": {}}
