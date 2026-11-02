"""The Email Designs screen (StaffAlerts.gs mailPreviewAll_, mailPreview) on Python: every letter the platform can
write, rendered with sample people through the templates of MailTemplates.gs and MailTemplatesHiring.gs, ported here
to the byte. Mail clients get tables and inline styles only — no <style>, fonts or images — and the text says all the
html says. The one read is the words of the hiring_unreachable_archived situation (commSituationId_ through the words
book's bindings, then the situations off the Smart Comms copy); when they cannot be read the template's own words
stand, as they do in Apps Script."""
from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from typing import Any, Callable

import gsjs
import house_tables as HT
import hubdb
import locations as L
import smart_comms as SC

APP_ID = "email-designs"
DENIED = {"status": 403, "message": "Requires an admin or manager account"}

# literals: a mail client cannot read a CSS variable
MAIL_INK = "#1c2024"
MAIL_INK_SOFT = "#5b6470"
MAIL_LINE = "#e3e6ea"
MAIL_PAPER = "#f5f6f8"
MAIL_ACCENT = "#2f6f5f"
MAIL_ACCENT_SOFT = "#eaf3f0"
MAIL_DANGER = "#b3261e"
MAIL_DANGER_SOFT = "#fdecea"
HIRING_MAIL_EYEBROW = "ASA LifeCare · Hiring"

# HiringSimConfig.gs COMM_BINDINGS_*: the words book's tab naming which situation row each purpose speaks through
BINDINGS_TAB = "Smart Comms"
BINDINGS_KEY_COL = "Config ID"
BINDINGS_VAL_COL = "Smart Comms Situation ID"
BINDINGS_COMPILED = "COMM_BINDINGS_COMPILED"
UNREACHABLE_KEY, UNREACHABLE_SIT = "hiring.unreachable_archived", "hiring_unreachable_archived"

_PARAS = re.compile(r"\n{2,}")


def _or(v: Any, floor: str = "") -> str:
    """String(v || floor)."""
    return floor if gsjs.falsy(v) else gsjs.js_str(v)


def _trim(v: Any) -> str:
    """String(v || '').trim()."""
    return gsjs.trim(_or(v))


def _cat(v: Any) -> str:
    """A value joined into a string with +."""
    return gsjs.js_str(v)


# ---- the parts (MailTemplates.gs) ----------------------------------------------------------------------------------

def mail_esc(value: Any) -> str:
    return (gsjs.or_blank(value).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
            .replace('"', "&quot;").replace("'", "&#39;"))


def mail_shell(opts: dict | None) -> str:
    """mailShell_: without a preheader, inboxes preview the body's first words — the greeting."""
    o = opts or {}
    blocks = o.get("blocks") or []
    bar = _or(o.get("barColor"), MAIL_ACCENT)
    html = (
        '<!DOCTYPE html><html><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1">'
        '<title>' + mail_esc(_or(o.get("title"))) + '</title></head>'
        '<body style="margin:0;padding:0;background:' + MAIL_PAPER + ';">'
        '<div style="display:none;max-height:0;overflow:hidden;opacity:0;">' + mail_esc(_or(o.get("preheader")))
        + '</div>'
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:'
        + MAIL_PAPER + ';padding:32px 12px;">'
        '<tr><td align="center">'
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;'
        'background:#ffffff;border:1px solid ' + MAIL_LINE + ';border-radius:14px;">'
        '<tr><td style="height:4px;background:' + bar
        + ';border-radius:14px 14px 0 0;font-size:0;line-height:0;">&nbsp;</td></tr>'
        '<tr><td style="padding:28px 32px 8px 32px;">'
        '<p style="margin:0 0 6px 0;font-family:Helvetica,Arial,sans-serif;font-size:11px;letter-spacing:1.4px;'
        'text-transform:uppercase;color:' + MAIL_INK_SOFT + ';">'
        + mail_esc(_or(o.get("eyebrow"), "ASA LifeCare")) + '</p>'
        '<h1 style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:22px;line-height:30px;font-weight:bold;'
        'letter-spacing:-0.2px;color:' + MAIL_INK + ';">'
        + mail_esc(_or(o.get("title"))) + '</h1>'
        '</td></tr>')
    if not gsjs.falsy(o.get("intro")):
        html += ('<tr><td style="padding:12px 32px 0 32px;">'
                 '<p style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:24px;color:'
                 + MAIL_INK + ';">' + _cat(o.get("intro")) + '</p></td></tr>')
    for b in blocks:
        html += '<tr><td style="padding:16px 32px 0 32px;">' + _cat(b) + '</td></tr>'
    cta = o.get("cta")
    if isinstance(cta, dict) and not gsjs.falsy(cta.get("href")):
        html += ('<tr><td style="padding:24px 32px 4px 32px;">'
                 '<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>'
                 '<td style="background:' + bar + ';border-radius:8px;">'
                 '<a href="' + mail_esc(cta.get("href")) + '" style="display:inline-block;padding:12px 22px;'
                 'font-family:Helvetica,Arial,sans-serif;font-size:14px;font-weight:bold;color:#ffffff;'
                 'text-decoration:none;">'
                 + mail_esc(_or(cta.get("label"), "Open")) + '</a></td></tr></table>'
                 # the bare address: a button is not clickable in every client
                 '<p style="margin:10px 0 0 0;font-family:Helvetica,Arial,sans-serif;font-size:12px;line-height:18px;'
                 'color:' + MAIL_INK_SOFT + ';">'
                 'Or paste this into your browser:<br><span style="color:' + MAIL_INK + ';">'
                 + mail_esc(cta.get("href")) + '</span></p>'
                 '</td></tr>')
    if not gsjs.falsy(o.get("footnote")):
        html += ('<tr><td style="padding:22px 32px 0 32px;">'
                 '<p style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:12.5px;line-height:20px;color:'
                 + MAIL_INK_SOFT + ';">' + _cat(o.get("footnote")) + '</p></td></tr>')
    html += ('<tr><td style="padding:24px 32px 28px 32px;">'
             '<div style="border-top:1px solid ' + MAIL_LINE + ';padding-top:14px;">'
             '<p style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:11.5px;line-height:18px;color:'
             + MAIL_INK_SOFT + ';">'
             'This message was sent by the ASA LifeCare platform. If it reached you by mistake, please ignore it — '
             'nothing was created for you.'
             '</p></div></td></tr>'
             '</table></td></tr></table></body></html>')
    return html


def mail_fact(label: Any, value: Any, mono: Any = False) -> str:
    """mailFact_: mono only where the glyphs are the content (a password or login: O vs 0)."""
    plain = gsjs.falsy(mono)
    face = "Helvetica,Arial,sans-serif" if plain else "'Courier New',Courier,monospace"
    return ('<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:'
            + MAIL_ACCENT_SOFT + ';border-radius:10px;">'
            '<tr><td style="padding:12px 16px;">'
            '<p style="margin:0 0 2px 0;font-family:Helvetica,Arial,sans-serif;font-size:11px;letter-spacing:1px;'
            'text-transform:uppercase;color:' + MAIL_INK_SOFT + ';">' + mail_esc(label) + '</p>'
            '<p style="margin:0;font-family:' + face + ';font-size:16px;line-height:22px;font-weight:'
            + ("bold" if plain else "normal") + ';color:' + MAIL_INK + ';">' + mail_esc(value) + '</p>'
            '</td></tr></table>')


def mail_para(html: Any) -> str:
    return ('<p style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:24px;color:'
            + MAIL_INK + ';">' + _cat(html) + '</p>')


def mail_steps(steps: list) -> str:
    out = '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">'
    for i, step in enumerate(steps):
        out += ('<tr>'
                '<td valign="top" width="26" style="padding:0 0 10px 0;font-family:Helvetica,Arial,sans-serif;'
                'font-size:13px;font-weight:bold;color:' + MAIL_ACCENT + ';">' + str(i + 1) + '.</td>'
                '<td style="padding:0 0 10px 0;font-family:Helvetica,Arial,sans-serif;font-size:14px;line-height:21px;'
                'color:' + MAIL_INK + ';">' + _cat(step) + '</td>'
                '</tr>')
    return out + '</table>'


def mail_platform_url() -> str:
    return "https://asamylife.asalifecare.com"


def mail_fact_red(label: Any, value: Any) -> str:
    return ('<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:'
            + MAIL_DANGER_SOFT + ';border-left:3px solid ' + MAIL_DANGER + ';border-radius:0 10px 10px 0;">'
            '<tr><td style="padding:12px 16px;">'
            '<p style="margin:0 0 2px 0;font-family:Helvetica,Arial,sans-serif;font-size:11px;letter-spacing:1px;'
            'text-transform:uppercase;color:' + MAIL_DANGER + ';">' + mail_esc(label) + '</p>'
            '<p style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:16px;line-height:22px;font-weight:bold;'
            'color:' + MAIL_INK + ';">' + mail_esc(value) + '</p>'
            '</td></tr></table>')


def mail_body_blocks(body_text: Any) -> list[str]:
    """mailBodyBlocks_ (MailTemplatesHiring.gs): a row's words, one paragraph per blank line."""
    return [mail_para(mail_esc(p).replace("\n", "<br>")) for p in _PARAS.split(gsjs.trim(_or(body_text)))]


# ---- the letters ---------------------------------------------------------------------------------------------------

def invite_email(o: dict | None) -> dict[str, str]:
    """inviteEmail_: must say the password is shared by every new account and gets replaced at first sign-in."""
    opts = o or {}
    name = _trim(opts.get("name"))
    login = _trim(opts.get("login"))
    password = _trim(opts.get("password"))
    url = _or(opts.get("url"), mail_platform_url())
    greeting = "Hi " + name + "," if name else "Hello,"
    inviter = _trim(opts.get("inviterName"))

    blocks = [
        mail_para(mail_esc(greeting) + " you have an account on the ASA LifeCare platform"
                  + (" — " + mail_esc(inviter) + " set it up for you" if inviter else "") + "."),
        mail_fact("Your sign-in", login, True),
    ]
    if password:
        blocks.append(mail_fact("First-time password", password, True))
        blocks.append(mail_para(
            "<strong>This password is not yours and is not private.</strong> It is the one every new account starts "
            "on, so the platform will ask you to choose your own the moment you sign in — you cannot reach any screen "
            "until you do."))
        blocks.append(mail_steps([
            "Open the platform and sign in with the two lines above.",
            "Choose a password of your own (at least 8 characters). This one takes its place immediately.",
            "You will land on your own workspace — only what your role opens, nothing else.",
        ]))
    else:
        blocks.append(mail_para(
            "Sign in with the password you already chose. If you do not remember it, ask an administrator to reset "
            "it — nobody here can read it, so a new one is the only way back in."))

    text = (greeting + "\n\n"
            + "You have an account on the ASA LifeCare platform"
            + (" — " + inviter + " set it up for you" if inviter else "") + ".\n\n"
            + "Sign-in: " + login + "\n"
            + ("First-time password: " + password + "\n\n"
               + "This password is not yours and is not private: it is the one every new account starts on, so the "
                 "platform will ask you to choose your own the moment you sign in. You cannot reach any screen until "
                 "you do.\n\n"
               + "1. Open " + url + " and sign in with the two lines above.\n"
               + "2. Choose a password of your own (at least 8 characters).\n"
               + "3. You will land on your own workspace.\n\n"
               if password else
               "\nSign in with the password you already chose. If you do not remember it, ask an administrator to "
               "reset it — nobody here can read it, so a new one is the only way back in.\n\n"
               + "Open " + url + " to sign in.\n\n")
            + "If you did not expect this message, please ignore it — nothing was created for you.\n")

    return {
        "subject": "Your access to the ASA LifeCare platform",
        "text": text,
        "html": mail_shell({
            "eyebrow": "ASA LifeCare",
            "title": "Your access is ready",
            "preheader": ("Sign in with the first-time password and choose your own." if password
                          else "Your account is ready — sign in with your own password."),
            "blocks": blocks,
            "cta": {"label": "Sign in", "href": url},
            "footnote": ("Keep this message until you have set your own password. After that it is of no use to "
                         "anybody, including you." if password
                         else "Nothing in this message is a secret — it names no password."),
        }),
    }


def chat_unread_email(o: dict | None) -> dict[str, str]:
    """chatUnreadEmail_: the messages themselves, never "you have messages"."""
    opts = o or {}
    name = _trim(opts.get("name"))
    frm = gsjs.trim(_or(opts.get("fromName"), "A colleague"))
    messages = list(opts.get("messages") or [])
    url = _or(opts.get("url"), mail_platform_url())
    shown = messages[:5]
    rest = len(messages) - len(shown)

    quoted = '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">'
    for m in shown:
        quoted += ('<tr><td style="padding:0 0 8px 0;">'
                   '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:'
                   + MAIL_PAPER + ';border-left:3px solid ' + MAIL_ACCENT + ';border-radius:0 8px 8px 0;">'
                   '<tr><td style="padding:10px 14px;font-family:Helvetica,Arial,sans-serif;font-size:14px;'
                   'line-height:21px;color:' + MAIL_INK + ';">'
                   + mail_esc(m) + '</td></tr></table></td></tr>')
    quoted += '</table>'

    more = "" if rest == 1 else "s"
    blocks = [
        mail_para(("Hi " + mail_esc(name) + "," if name else "Hello,") + " <strong>" + mail_esc(frm)
                  + "</strong> wrote to you on the platform while you were away."),
        quoted,
    ]
    if rest > 0:
        blocks.append(mail_para("…and " + str(rest) + " more message" + more + " waiting inside."))

    text = (("Hi " + name + "," if name else "Hello,") + "\n\n"
            + frm + " wrote to you on the platform while you were away.\n\n"
            + "\n".join('  "' + _cat(m) + '"' for m in shown) + "\n"
            + ("\n…and " + str(rest) + " more message" + more + " waiting inside.\n" if rest > 0 else "")
            + "\nReply from the platform: " + url + "\n")

    return {
        "subject": frm + " sent you a message",
        "text": text,
        "html": mail_shell({
            "eyebrow": "ASA LifeCare",
            "title": "You have messages waiting",
            "preheader": frm + " wrote to you on the platform.",
            "blocks": blocks,
            "cta": {"label": "Open the conversation", "href": url},
            "footnote": "You are getting this because you were signed out when the message arrived. "
                        "While you are on the platform, messages reach you there instead.",
        }),
    }


def staff_alert_email(o: dict | None) -> dict[str, str]:
    """staffAlertEmail_: shift and arrival print only when actually found, never guessed; the situation row's words,
    when it has them, replace the sentence about the kind."""
    opts = o or {}
    kind = _or(opts.get("kind"))
    person = _trim(opts.get("person")) or "A staff member"
    when_text = _trim(opts.get("whenText"))
    shift_text = _trim(opts.get("shiftText"))
    arrived_text = _trim(opts.get("arrivedText"))
    report_words = _trim(opts.get("reportWords"))
    no_call = kind == "no_call"
    late_show = kind == "late_show"
    call_off = kind == "call_off"
    early_out = kind == "early_out"
    kind_label = _trim(opts.get("kindLabel")) or (
        "No Show, No Call" if no_call else "Late Show" if late_show
        else "Call Off" if call_off else "Early Out" if early_out else "Staff report")
    folder_name = _trim(opts.get("folderName")) or (
        "Staff No Call" if no_call else "Staff Late Show" if late_show
        else "Staff Call Off" if call_off else "Staff Early Out" if early_out else "Staff Reports")
    source = _or(opts.get("source"), "mailbox")
    clock = source == "time_clock"
    form = source == "form"
    lead_text = _trim(opts.get("leadText"))

    blocks = [
        mail_fact("Staff member", person),
        mail_fact("Seen" if clock else "Shift date", when_text or "not stated"),
    ]
    blocks.append(mail_fact("Scheduled shift", shift_text or "Not found on the roster for this date"))
    if late_show:
        blocks.append(mail_fact("Arrived", arrived_text or "The time clock has no punch for this day yet"))
    if lead_text:
        blocks.append(mail_para(mail_esc(lead_text).replace("\n", "<br>")))
    elif no_call:
        blocks.append(mail_para(
            "The time clock has no punch for this shift and no call-off is on record. "
            "The house may be short right now — coverage comes first, the conversation second." if clock
            else "Nobody heard from them before the shift. The house may be short right now — "
                 "coverage comes first, the conversation second."))
    elif late_show:
        blocks.append(mail_para(
            "They clocked in late for this shift. One late show is a conversation; a pattern "
            "belongs in their record." if clock
            else "They arrived late for this shift. One late show is a conversation; a pattern "
                 "belongs in their record."))
    elif call_off:
        blocks.append(mail_para("They called off this shift. The house needs the gap covered — the Call Offs "
                                "app carries the running history."))
    elif early_out:
        blocks.append(mail_para("They left before the end of this shift. The remaining hours may need covering."))
    else:
        blocks.append(mail_para("A " + mail_esc(kind_label) + " report just arrived for this person. The message "
                                "itself is filed in the mailbox for the record."))
    if report_words:
        blocks.append(
            '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:'
            + MAIL_PAPER + ';border-left:3px solid ' + MAIL_ACCENT + ';border-radius:0 8px 8px 0;">'
            '<tr><td style="padding:10px 14px;">'
            '<p style="margin:0 0 2px 0;font-family:Helvetica,Arial,sans-serif;font-size:11px;letter-spacing:1px;'
            'text-transform:uppercase;color:' + MAIL_INK_SOFT + ';">'
            + ("What the time clock shows" if clock else "What the office typed" if form
               else "The report's own words") + '</p>'
            '<p style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:13px;line-height:20px;color:'
            + MAIL_INK + ';">' + mail_esc(report_words) + '</p>'
            '</td></tr></table>')

    if clock:
        intro = ("The time clock was read and this shift is a <strong>" + mail_esc(kind_label)
                 + "</strong>. Nobody typed this report — the platform noticed it.")
    elif form:
        intro = ("A <strong>" + mail_esc(kind_label) + "</strong> was typed on the Call Off form. "
                 "The row is in the Call Off Tracker.")
    else:
        intro = ("The platform mailbox just received a <strong>" + mail_esc(kind_label)
                 + "</strong> report. The message itself is filed under "
                 "<strong>" + mail_esc(folder_name) + "</strong> in the mailbox.")
    html = mail_shell({
        "eyebrow": "Staff attendance",
        "title": kind_label + " — " + person,
        "preheader": kind_label + ": " + person + (" · " + when_text if when_text else ""),
        "intro": intro,
        "blocks": blocks,
        "cta": {"href": mail_platform_url(), "label": "Open the platform"},
        "footnote": "Sent automatically by asa-hub@asaop.org "
                    + ("when the time clock was read. " if clock
                       else "when the form row was read. " if form else "the moment the report arrived. ")
                    + "The Call Offs and Time Reconciliation apps carry the running history.",
    })

    if lead_text:
        lead = lead_text + "\n"
    elif no_call:
        lead = ("The time clock has no punch for this shift and no call-off is on record. Coverage first.\n" if clock
                else "Nobody heard from them before the shift. Coverage first.\n")
    else:
        lead = "They clocked in late for this shift.\n" if clock else "They arrived late for this shift.\n"
    text = (kind_label + " — " + person + "\n"
            + (("Seen: " if clock else "Shift date: ") + when_text + "\n" if when_text else "")
            + "Scheduled shift: " + (shift_text or "not found on the roster for this date") + "\n"
            + ("Arrived: " + (arrived_text or "no punch on the time clock yet") + "\n" if not no_call else "") + "\n"
            + lead
            + ("\n" + ("What the time clock shows: " if clock else "What the office typed: " if form
                       else "The report's own words: ") + report_words + "\n" if report_words else "")
            + ("\nNobody typed this report — the platform read the time clock.\n" if clock
               else "\nThe row is in the Call Off Tracker.\n" if form
               else '\nThe original message is filed under "' + folder_name + '" in the platform mailbox.\n')
            + mail_platform_url())

    return {"subject": _trim(opts.get("subject"))
            or ("[" + kind_label + "] " + person + (" — " + when_text if when_text else "")),
            "html": html, "text": text}


def referral_phone_email(o: dict | None) -> dict[str, str]:
    """referralPhoneEmail_: a referral with only a name and an e-mail — the one missing thing, asked warmly."""
    opts = o or {}
    name = _trim(opts.get("name"))
    greeting = "Hi " + name + "," if name else "Hello,"

    blocks = [
        mail_para(mail_esc(greeting) + " thank you for your interest in working with ASA LifeCare — "
                  "your information reached our hiring team and we would love to talk."),
        mail_para("One thing is missing before we can move forward: <strong>a phone number</strong>. "
                  "Interviews and scheduling happen over the phone, and the message we received only carried your "
                  "name and e-mail."),
        mail_fact("What we need", "The best phone number to reach you"),
        mail_para("Just <strong>reply to this e-mail</strong> with your number and the best time to call. "
                  "That is all — we will take it from there."),
    ]

    text = (greeting + "\n\n"
            "Thank you for your interest in working with ASA LifeCare — your information reached our hiring team "
            "and we would love to talk.\n\n"
            "One thing is missing before we can move forward: a phone number. Interviews and scheduling happen "
            "over the phone, and the message we received only carried your name and e-mail.\n\n"
            "Just reply to this e-mail with the best number to reach you, and the best time to call. "
            "That is all — we will take it from there.\n\n"
            "If you did not apply or were not referred to us, please ignore this message.\n")

    return {
        "subject": "One more thing for your application — a phone number",
        "text": text,
        "html": mail_shell({
            "eyebrow": "ASA LifeCare · Hiring",
            "title": "We would love to call you",
            "preheader": "Your application arrived without a phone number — reply with yours.",
            "blocks": blocks,
            "footnote": "You are receiving this because your name and e-mail reached the ASA LifeCare hiring team. "
                        "If you did not apply or were not referred to us, please ignore this message.",
        }),
    }


def birthday_email(o: dict | None) -> dict[str, str]:
    """birthdayEmail_: no buttons, no asks — just the wish, in a staff member's or a client's words."""
    opts = o or {}
    name = _trim(opts.get("name")) or "friend"
    audience = _or(opts.get("audience"), "staff")
    is_client = audience == "client"

    celebration = (
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:'
        + MAIL_ACCENT_SOFT + ';border-radius:12px;">'
        '<tr><td align="center" style="padding:22px 16px;">'
        '<p style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:34px;line-height:38px;">&#127874;</p>'
        '<p style="margin:8px 0 0 0;font-family:Helvetica,Arial,sans-serif;font-size:20px;line-height:26px;'
        'font-weight:bold;color:' + MAIL_ACCENT + ';">Happy birthday, ' + mail_esc(name) + '!</p>'
        '</td></tr></table>')

    blocks = [
        celebration,
        mail_para("Today is all about you, and everyone at ASA LifeCare is glad to be part of your story. "
                  "We hope your day is full of the people and the things you love most.") if is_client
        else mail_para("Everyone at ASA LifeCare wishes you a wonderful day. The care you give the people we "
                       "serve is what this company is made of — today the appreciation points at you."),
        mail_para("From all of us — the caregivers, the office, the whole ASA family: "
                  "<strong>may this new year of yours be the best one yet.</strong>") if is_client
        else mail_para("<strong>Enjoy your day.</strong> The schedule can wait a moment for the cake."),
    ]

    text = ("Happy birthday, " + name + "!\n\n"
            + ("Today is all about you, and everyone at ASA LifeCare is glad to be part of your story. "
               "We hope your day is full of the people and the things you love most.\n\n"
               "From all of us - the caregivers, the office, the whole ASA family: may this new year of yours be the "
               "best one yet.\n" if is_client
               else "Everyone at ASA LifeCare wishes you a wonderful day. The care you give the people we serve is "
                    "what this company is made of - today the appreciation points at you.\n\n"
                    "Enjoy your day. The schedule can wait a moment for the cake.\n"))

    return {
        "subject": "Happy birthday, " + name + "! From all of us at ASA LifeCare",
        "text": text,
        "html": mail_shell({
            "eyebrow": "ASA LifeCare",
            "title": "It’s your day",
            "preheader": "Happy birthday from the whole ASA family.",
            "blocks": blocks,
            "footnote": "Sent with love by the ASA LifeCare platform on your birthday.",
        }),
    }


def certs_expired_email(o: dict | None) -> dict[str, str]:
    """certsExpiredEmail_: the one letter allowed to wear red, with the steps back to compliance."""
    opts = o or {}
    name = _trim(opts.get("name"))
    items = list(opts.get("items") or [])
    greeting = "Hi " + name + "," if name else "Hello,"
    one = len(items) == 1

    blocks = [
        mail_para(mail_esc(greeting) + " the platform checked your certifications today and "
                  '<strong style="color:' + MAIL_DANGER + ';">'
                  + ("one of them has expired" if one else str(len(items)) + " of them have expired") + "</strong>. "
                  "An expired certification means you cannot be scheduled until it is renewed."),
    ]
    for it in items:
        it = it if isinstance(it, dict) else {}
        blocks.append(mail_fact_red(_or(it.get("cert"), "Certification") + " — EXPIRED",
                                    "Expired on " + _or(it.get("expiredOn"), "an earlier date")))
    blocks.append(mail_steps([
        "Book the renewal class or exam for each certification above as soon as you can.",
        "Send the new certificate (a photo or PDF is fine) to <strong>onboarding@asalifecare.com</strong>.",
        "The platform updates your record the moment the new document is verified.",
    ]))
    blocks.append(mail_para("If any of these is already renewed and this letter is out of date, reply with the new "
                            "certificate attached and we will fix your record — the reminder stops the moment the "
                            "record is right."))

    text = (greeting + "\n\n"
            + "The platform checked your certifications today and "
            + ("one of them has EXPIRED" if one else str(len(items)) + " of them have EXPIRED") + ". "
            + "An expired certification means you cannot be scheduled until it is renewed.\n\n"
            + "\n".join("  " + _or((it if isinstance(it, dict) else {}).get("cert"), "Certification")
                        + " - EXPIRED on " + _or((it if isinstance(it, dict) else {}).get("expiredOn"),
                                                 "an earlier date") for it in items) + "\n\n"
            + "1. Book the renewal class or exam for each certification above.\n"
              "2. Send the new certificate to onboarding@asalifecare.com.\n"
              "3. The platform updates your record the moment the new document is verified.\n\n"
              "If any of these is already renewed, reply with the new certificate attached and we will fix your "
              "record.\n")

    return {
        "subject": "[Action required] Your certification" + (" has" if one else "s have") + " expired",
        "text": text,
        "html": mail_shell({
            "eyebrow": "Certifications",
            "title": "Action required: renew your certifications",
            "preheader": ("One certification has expired" if one else str(len(items)) + " certifications have expired")
                         + " — you cannot be scheduled until renewed.",
            "barColor": MAIL_DANGER,
            "blocks": blocks,
            "cta": {"label": "See my certifications", "href": mail_platform_url()},
            "footnote": "Raised automatically by the certification watcher. It checks every record daily and only "
                        "writes when something needs a person.",
        }),
    }


def platform_digest_email(o: dict | None) -> dict[str, str]:
    """platformDigestEmail_: one row per app — what is live, what is new."""
    opts = o or {}
    items = [it if isinstance(it, dict) else {} for it in (opts.get("items") or [])]

    rows = '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">'
    for it in items:
        is_new = _or(it.get("status")).lower() == "new"
        rows += ('<tr>'
                 '<td valign="top" style="padding:0 10px 10px 0;white-space:nowrap;">'
                 '<span style="display:inline-block;padding:2px 10px;border-radius:999px;background:'
                 + (MAIL_ACCENT if is_new else MAIL_ACCENT_SOFT)
                 + ';font-family:Helvetica,Arial,sans-serif;font-size:11px;font-weight:bold;letter-spacing:0.5px;'
                 'text-transform:uppercase;color:' + ("#ffffff" if is_new else MAIL_ACCENT) + ';">'
                 + mail_esc(_or(it.get("status"), "live")) + '</span></td>'
                 '<td style="padding:0 0 10px 0;">'
                 '<p style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:14px;line-height:20px;color:'
                 + MAIL_INK + ';"><strong>' + mail_esc(it.get("app")) + '</strong>'
                 + (" — " + mail_esc(it.get("note")) if not gsjs.falsy(it.get("note")) else "") + '</p></td></tr>')
    rows += '</table>'

    text = ("Platform status - what is live and what is new\n\n"
            + "\n".join("  [" + _or(it.get("status"), "live").upper() + "] " + _cat(it.get("app"))
                        + (" - " + _cat(it.get("note")) if not gsjs.falsy(it.get("note")) else "") for it in items)
            + "\n\n"
            + "Everything above is on " + mail_platform_url() + " - your badge decides which doors open.\n")

    return {
        "subject": "ASA platform — what is live and what is new",
        "text": text,
        "html": mail_shell({
            "eyebrow": "Platform news",
            "title": "What is live, what is new",
            "preheader": str(len(items)) + " apps on the board today.",
            "intro": "The state of every app on the platform, in one look. Your badge decides which doors open for "
                     "you.",
            "blocks": [rows],
            "cta": {"label": "Open the platform", "href": mail_platform_url()},
            "footnote": "Sent by the platform when the board changes enough to be worth a letter — never on a timer.",
        }),
    }


def how_it_works_email(o: dict | None) -> dict[str, str]:
    """howItWorksEmail_: the whole platform in sentences, for a person's first week."""
    opts = o or {}
    name = _trim(opts.get("name"))
    greeting = "Hi " + name + "," if name else "Hello,"
    url = mail_platform_url()

    def section(title: str) -> str:
        return ('<p style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:12px;letter-spacing:1.2px;'
                'text-transform:uppercase;font-weight:bold;color:' + MAIL_ACCENT + ';">' + mail_esc(title) + '</p>')

    blocks = [
        mail_para(mail_esc(greeting) + " this letter explains how the ASA LifeCare platform works — "
                  "what you will see, why you see it, and where everything lives. Keep it around for your first "
                  "week."),
        section("Signing in"),
        mail_para("You sign in at <strong>" + mail_esc(url) + "</strong> with your e-mail (or login) and your own "
                  "password. The first time, the platform gives you a shared starter password and immediately demands "
                  "you choose your own — you cannot reach any screen until you do. Nobody, including administrators, "
                  "can read your password afterwards."),
        section("Your workspace"),
        mail_para("The home screen is <strong>My asa.</strong> — your week, your reminders, your indicators. "
                  "The grid button opens every app your badge allows: what you see depends on your role (staff, "
                  "manager, client, guardian), so two people’s platforms can look different and both are right."),
        section("The apps, in one breath"),
        mail_steps([
            "<strong>Chat</strong> — talk to anyone on the platform. If someone is away, the message waits; after a "
            "few minutes it also goes to their e-mail.",
            "<strong>Calendar</strong> — the whole company’s month: shifts, birthdays, trainings, appointments, the "
            "weather on every coming day.",
            "<strong>Kanban</strong> — the team’s work on one wall, and the company’s projects behind the Projects "
            "button.",
            "<strong>Users &amp; Clients</strong> — every person, one profile each: documents, certifications, "
            "activity, support requests.",
            "<strong>Suggestions</strong> — the box the leadership actually reads. Anything, anytime.",
        ]),
        section("How your data moves"),
        mail_para("Everything you save lands in the company’s own records the moment you press the button — "
                  'there is no "sync later". Reading is instant because every screen keeps its own fresh copy. '
                  "If your internet drops mid-save, the platform says so plainly instead of pretending."),
        section("When the platform writes to you"),
        mail_para("E-mail from the platform always comes from <strong>asa-hub@asaop.org</strong> and always looks "
                  "like this letter. It writes when something needs you — a message you missed, a certification "
                  "about to expire — and never just to exist."),
        section("If something looks wrong"),
        mail_para("Say it in <strong>Suggestions</strong> or tell your manager. The platform is built by people who "
                  "read those."),
    ]

    text = (greeting + "\n\n"
            + "This letter explains how the ASA LifeCare platform works.\n\n"
            + "SIGNING IN\nYou sign in at " + url + " with your e-mail (or login) and your own password. The first "
            "time, the platform gives you a shared starter password and immediately demands you choose your own. "
            "Nobody can read your password afterwards.\n\n"
            "YOUR WORKSPACE\nThe home screen is My asa. - your week, your reminders, your indicators. The grid button "
            "opens every app your badge allows: what you see depends on your role.\n\n"
            "THE APPS\n"
            "1. Chat - talk to anyone; missed messages follow you to e-mail.\n"
            "2. Calendar - the company's month: shifts, birthdays, trainings, appointments, the weather.\n"
            "3. Kanban - the team's work on one wall, projects behind the Projects button.\n"
            "4. Users & Clients - every person, one profile each.\n"
            "5. Suggestions - the box the leadership actually reads.\n\n"
            "HOW YOUR DATA MOVES\nEverything you save lands in the company's records the moment you press the button. "
            "Reading is instant because every screen keeps its own fresh copy.\n\n"
            "WHEN THE PLATFORM WRITES TO YOU\nAlways from asa-hub@asaop.org, always looking like this letter, only "
            "when something needs you.\n\n"
            "IF SOMETHING LOOKS WRONG\nSay it in Suggestions or tell your manager.\n")

    return {
        "subject": "How the ASA LifeCare platform works",
        "text": text,
        "html": mail_shell({
            "eyebrow": "Welcome aboard",
            "title": "How the platform works",
            "preheader": "What you will see, why you see it, and where everything lives.",
            "blocks": blocks,
            "cta": {"label": "Open the platform", "href": url},
            "footnote": "Keep this letter for your first week — after that you will not need it.",
        }),
    }


def hiring_notice_email(o: dict | None) -> dict[str, str]:
    """hiringNoticeEmail_: the team is pointed at the card; the card carries the whole record."""
    opts = o or {}
    title = gsjs.trim(_or(opts.get("title"), "Hiring pipeline notice"))
    body_text = _or(opts.get("bodyText"))
    facts = [x if isinstance(x, dict) else {} for x in (opts.get("facts") or [])]
    steps = list(opts.get("steps") or [])

    blocks = [mail_fact(_or(f.get("label")), _or(f.get("value"))) for f in facts]
    if body_text:
        blocks.extend(mail_para(mail_esc(p).replace("\n", "<br>")) for p in _PARAS.split(body_text))
    if steps:
        blocks.append(mail_steps(steps))

    text = (body_text
            + ("\n\n" + "\n".join("  " + _or(x.get("label")) + ": " + _or(x.get("value")) for x in facts)
               if facts else "")
            + "\n")

    return {
        "subject": title,
        "text": text,
        "html": mail_shell({
            "eyebrow": "Hiring pipeline",
            "title": title,
            "preheader": _or(opts.get("preheader"), title),
            "blocks": blocks,
            "cta": {"label": "Open the Hiring Pipeline", "href": mail_platform_url()},
            "footnote": "Raised automatically by the hiring pipeline. The card itself carries "
                        "the whole record — this letter only points at it.",
        }),
    }


def packet_request_email(o: dict | None) -> dict[str, str]:
    """packetRequestEmail_: the one hiring letter an applicant reads — the signed packet is still owed."""
    opts = o or {}
    body_text = _or(opts.get("bodyText"))

    blocks = [mail_para(mail_esc(p).replace("\n", "<br>")) for p in _PARAS.split(body_text)]
    blocks.append(mail_fact("What we are waiting on", "Your signed New Hire packet"))

    return {
        "subject": _or(opts.get("subject"), "Your signed New Hire packet — ASA Lifecare"),
        "text": body_text + "\n",
        "html": mail_shell({
            "eyebrow": "ASA LifeCare · New hire",
            "title": "One signature left",
            "preheader": "Your onboarding is waiting on the signed New Hire packet.",
            "blocks": blocks,
            "footnote": "You are receiving this because your onboarding with ASA LifeCare is "
                        "almost done. If the packet is already signed and sent, you can ignore this "
                        "message — the record catches up on its own.",
        }),
    }


def hiring_discard_email(o: dict | None) -> dict[str, str]:
    """hiringDiscardEmail_ (MailTemplatesHiring.gs): a card left the process for the Archive, nothing deleted."""
    opts = o or {}
    name = _trim(opts.get("name"))
    reason = _trim(opts.get("reason"))
    stage = _trim(opts.get("stage"))
    when = _trim(opts.get("when"))
    by = _trim(opts.get("by"))
    body_text = _trim(opts.get("bodyText"))
    link = _or(opts.get("link"), mail_platform_url() + "/#/app/hiring/archive")

    blocks = mail_body_blocks(body_text) if body_text else [
        mail_para("<strong>" + mail_esc(name) + "</strong> has just been taken out of our selection "
                  "process. Their card and everything on it moved to the Archive — nothing was deleted."),
    ]
    blocks.append(mail_fact("Candidate", name))
    if stage:
        blocks.append(mail_fact("Stage when it happened", stage))
    if reason:
        blocks.append(mail_fact("Reason", reason))
    if when:
        blocks.append(mail_fact("When", when))
    if by:
        blocks.append(mail_fact("Decided by", by))

    text = ((body_text or name + " has just been taken out of our selection process. Their card and everything "
                              "on it moved to the Archive — nothing was deleted.") + "\n\n"
            + "Candidate: " + name + "\n" + ("Stage: " + stage + "\n" if stage else "")
            + ("Reason: " + reason + "\n" if reason else "") + ("When: " + when + "\n" if when else "")
            + ("Decided by: " + by + "\n" if by else "") + "\nThe Archive: " + link + "\n")

    return {
        "subject": _or(opts.get("subject")) or (name + " was removed from the hiring process"),
        "text": text,
        "html": mail_shell({
            "eyebrow": HIRING_MAIL_EYEBROW,
            "title": "A candidate left the process",
            "preheader": name + " moved to the Archive with their whole record.",
            "blocks": blocks,
            "cta": {"label": "Open the Archive", "href": link},
            "footnote": "The Archive keeps the whole record — the resume, the screen, the messages and "
                        "the reason. Nothing about them was thrown away.",
        }),
    }


def guardian_alert_email(o: dict | None, now: datetime | None = None) -> dict[str, str]:
    """guardianAlertEmail_: the issues in red, the way in one button; `now` stands for new Date()."""
    opts = o or {}
    issues = list(opts.get("issues") or [])
    stamp = gsjs.iso(now or datetime.now(timezone.utc))[:16].replace("T", " ", 1)
    when = _or(opts.get("when"), stamp) + " UTC"

    blocks = [
        mail_para("The platform checked itself and found "
                  '<strong style="color:' + MAIL_DANGER + ';">'
                  + ("one thing that needs a person" if len(issues) == 1
                     else str(len(issues)) + " things that need a person")
                  + "</strong>. Nothing is on fire — but none of these fix themselves."),
    ]
    for issue in issues:
        blocks.append(mail_fact_red("Needs attention", mail_esc(_cat(issue))))
    blocks.append(mail_steps([
        "Open the Guardian app — the full picture is there, live.",
        "Fix what you can; the alert goes quiet the moment the platform is healthy again.",
        "If one of these keeps coming back, that is the conversation to have — the alert means it.",
    ]))
    blocks.append(mail_para("This alert fires at most once a day while something is red — "
                            "a red week is one letter a day, never one per sweep."))

    text = ("GUARDIAN ALERT — the environment needs a person\n\n"
            + "The platform checked itself (" + when + ") and found:\n\n"
            + "\n".join("  - " + _cat(s) for s in issues) + "\n\n"
            + "Open the Guardian app for the full picture: " + mail_platform_url() + "#/app/guardian/health\n")

    return {
        "subject": "[Guardian] The environment needs a person — "
                   + ("1 issue" if len(issues) == 1 else str(len(issues)) + " issues"),
        "text": text,
        "html": mail_shell({
            "eyebrow": "Guardian",
            "title": "The environment needs a person",
            "preheader": str(len(issues)) + " issue(s) found on the platform check — the full picture is in the "
                                            "Guardian app.",
            "barColor": MAIL_DANGER,
            "blocks": blocks,
            "cta": {"label": "Open the Guardian app", "href": mail_platform_url() + "/#/app/guardian/health"},
            "footnote": "Raised automatically by the Guardian, the platform's own watcher. It only writes when "
                        "something needs a person — red for a week is one letter a day, never one per sweep.",
        }),
    }


# ---- the words the unreachable letter carries ----------------------------------------------------------------------

def bindings(reads: L.Reads) -> dict[str, Any]:
    """commBindings_: the words book's Smart Comms tab, Config ID → Smart Comms Situation ID; the compiled copy when
    the tab cannot be read or holds none."""
    got: dict[str, Any] | None = {}
    try:
        ref = HT.tab_of(reads, gsjs.trim(reads.db.prop("HUB_GENERIC_CONFIG_ID")), BINDINGS_TAB, "the comm bindings")
        heads = [gsjs.trim(gsjs.or_blank(h)) for h in ref.headers] if ref is not None else []
        if BINDINGS_KEY_COL in heads and BINDINGS_VAL_COL in heads:
            k_src = ref.headers[heads.index(BINDINGS_KEY_COL)]
            v_src = ref.headers[heads.index(BINDINGS_VAL_COL)]
            for _rn, raw in reads.db.rows(ref):
                key = _trim(hubdb.typed(raw.get(k_src), "hub"))
                if key:
                    got[key] = gsjs.trim(gsjs.or_blank(hubdb.typed(raw.get(v_src), "hub")))
    except Exception:  # noqa: BLE001 - an unreadable book: the compiled copy answers
        got = None
    if not got:
        try:
            baked = reads.db.prop(BINDINGS_COMPILED)
            if baked:
                got = json.loads(baked)
        except Exception:  # noqa: BLE001 - the floors below
            pass
        if not isinstance(got, dict):
            got = {}
    return got


def situation_id(reads: L.Reads, rows: list[dict], key: str, shipped: str) -> str:
    """commSituationId_: the bound row when the situations know it, the shipped id as the floor."""
    try:
        v = _trim(bindings(reads).get(key))
        if not v or v == shipped:
            return shipped or v
        return v if SC.situation_row(rows, v) is not None else shipped
    except Exception:  # noqa: BLE001 - the floor still answers
        return shipped


def unreachable_words(reads: L.Reads) -> dict | None:
    """The unreachable-archived situation's row; None when the situations cannot be read."""
    try:
        rows = SC.read_situations(reads.db)
    except Exception:  # noqa: BLE001 - the template's own words stand
        return None
    try:
        return SC.situation_row(rows, situation_id(reads, rows, UNREACHABLE_KEY, UNREACHABLE_SIT))
    except Exception:  # noqa: BLE001
        return None


def _unreach_fill(s: Any) -> str:
    return (_or(s).replace("{name}", "Marcus Webb").replace("{tries}", "7 time(s) over 24h")
            .replace("{phone}", "+1 330 555 0142").replace("{email}", "marcus.webb@example.com"))


# ---- the designs ---------------------------------------------------------------------------------------------------

def designs(unreach_words: dict | None, now: datetime | None = None) -> list[dict[str, str]]:
    """mailPreviewAll_ with its one read done: every letter the platform can write, rendered with sample people."""
    invite = invite_email({"name": "Priya Raman", "login": "priya.raman@asalifecare.com",
                           "password": "Welcome#2026", "inviterName": "Ty Bond"})
    invite_armed = invite_email({"name": "Marcus Cole", "login": "marcus.cole@asalifecare.com",
                                 "password": "", "inviterName": "Ty Bond"})
    chat = chat_unread_email({"name": "David", "fromName": "Emma Reyes",
                              "messages": ["Cover for the 7am at Maple? Tami called off.",
                                           "Never mind — Lucas took it. See you at the huddle."]})
    late = staff_alert_email({"kind": "late_show", "person": "Jeremiah Inman",
                              "whenText": "Sat, Aug 15, 2026",
                              "shiftText": "48TH · 08:00–20:00",
                              "arrivedText": "9:12 AM at 48TH (time clock)",
                              "reportWords": "Late Show — Jeremiah Inman (2026-08-15T04:00:00.000Z)"})
    no_call = staff_alert_email({"kind": "no_call", "person": "Nikyla Compton",
                                 "whenText": "Sat, Aug 15, 2026",
                                 "shiftText": "BM · 20:00–08:00"})
    ref_phone = referral_phone_email({"name": "Jordan Ellis"})
    bday_staff = birthday_email({"name": "Emma Reyes", "audience": "staff"})
    bday_client = birthday_email({"name": "Daniel", "audience": "client"})
    certs_red = certs_expired_email({"name": "Alex Morgan", "items": [
        {"cert": "DODD Certification", "expiredOn": "Jul 30, 2026"},
        {"cert": "CPR / First Aid", "expiredOn": "Aug 2, 2026"},
        {"cert": "Medication Delegation", "expiredOn": "Aug 10, 2026"},
    ]})
    digest = platform_digest_email({"items": [
        {"app": "My asa.", "status": "live",
         "note": "your week, reminders and indicators — now accepts widgets from the bank"},
        {"app": "Chat", "status": "live", "note": "messages the moment they are sent; e-mail follows you when away"},
        {"app": "Kanban", "status": "live", "note": "the team wall, plus the whole projects portfolio full screen"},
        {"app": "Calendar", "status": "new", "note": "the weather on every coming day, and files pinned to days"},
        {"app": "Staff Performance", "status": "new", "note": "a 0–10 grade per person, explained line by line"},
        {"app": "Employee Support Hotline", "status": "new", "note": "every call heard, sorted and filed on its own"},
        {"app": "Talent Pipeline", "status": "new",
         "note": "341 candidates scored, résumés readable in place"},
        {"app": "Transportation", "status": "live", "note": "van runs, fleet, mileage and routes on one screen"},
        {"app": "Inventory", "status": "live", "note": "the pharmacy’s own remaining-quantity record, per house"},
        {"app": "Books", "status": "live", "note": "a licence-clean library that grows itself"},
    ]})
    how_works = how_it_works_email({"name": "Priya"})
    date_accepted = hiring_notice_email({
        "title": "Hub — Date Accepted missing: Jordan Ellis",
        "preheader": "Every reading of the accepted in-person date failed.",
        "facts": [{"label": "Candidate", "value": "Jordan Ellis"},
                  {"label": "Phone · Email", "value": "+1 (330) 555-0148 · jordan.ellis@example.com"},
                  {"label": "Screen", "value": "8/10 · qualified · call 2026-08-15"}],
        "bodyText": "Hub: could not read the accepted in-person date for Jordan Ellis.\n\n"
                    "Action: open the Hiring Pipeline card and press Manual on Date accepted.",
    })
    hired_complete = hiring_notice_email({
        "title": "Hub — Hired, onboarding checked: Priya Raman",
        "preheader": "The New Hire Questionnaire and Tutorials are complete on the portal.",
        "facts": [{"label": "Candidate", "value": "Priya Raman"},
                  {"label": "Phone · Email", "value": "+1 (330) 555-0102 · priya.raman@example.com"}],
        "bodyText": "Hub: Priya Raman reached Hired. What was checked: the New Hire Questionnaire and the New Hire "
                    "Tutorials are both complete on the onboarding portal. Uploaded documents are not part of this "
                    "check.\n\n"
                    "They stay on the last step of the Hiring Pipeline for one more day, "
                    "then move to Users as staff automatically.",
    })
    hired_missing = hiring_notice_email({
        "title": "Hub — Hired with items MISSING: Marcus Cole",
        "preheader": "The card reached Hired with items still owed.",
        "facts": [{"label": "Candidate", "value": "Marcus Cole"},
                  {"label": "Phone · Email", "value": "+1 (330) 555-0177 · marcus.cole@example.com"},
                  {"label": "Missing", "value": "Upload Documents — CPR card · New Hire Questionnaire"}],
        "bodyText": "Hub: Marcus Cole reached Hired, but items are missing.\n\n"
                    "They still stay one more day on the pipeline and then move to Users as "
                    "staff — chase the missing items in the Onboarding Tracker.",
    })
    packet_ask = packet_request_email({
        "subject": "Your signed New Hire packet — ASA Lifecare",
        "bodyText": "Hi DSP,\n\n"
                    "To finish your onboarding we still need your signed New Hire packet.\n"
                    "Please check your inbox for your New Hire packet and complete it.\n\n"
                    "ASA Lifecare",
    })
    ready_start = hiring_notice_email({
        "title": "Hub — Priya Raman is ready to start",
        "preheader": "Hiring finished — a manager starts them from the board.",
        "facts": [{"label": "Staff account", "value": "Created and able to sign in"},
                  {"label": "ASA Employee Database", "value": "Written"}],
        "bodyText": "Priya Raman has finished the hiring process.\n\n"
                    "Their card is at READY TO START — a manager begins their activities from the board.",
    })
    words = unreach_words or {}
    unreachable = hiring_discard_email({
        "name": "Marcus Webb",
        "reason": "nobody could reach them — 7 time(s) over 24h on every contact we hold, no answer",
        "stage": "Outreach",
        "when": "2026-08-29T14:20:00Z",
        "by": "the platform, after 7 time(s) over 24h",
        "subject": _unreach_fill(words.get("email_subject")),
        "bodyText": _unreach_fill(words.get("email_text")),
    })
    guardian = guardian_alert_email({"issues": [
        "14 expired requirements in the matrix",
        "2 dead write(s) in the ledger",
        "the matrix has not rebuilt in 31h",
    ]}, now)

    def d(did: str, label: str, about: str, subject: str, got: dict[str, str]) -> dict[str, str]:
        return {"id": did, "label": label, "about": about, "subject": subject, "html": got["html"],
                "text": got["text"]}

    return [
        d("invite", "Platform invitation",
          "A new account, with the first-time password and the demand to change it.",
          "Your access to the ASA LifeCare platform", invite),
        d("invite-armed", "Invitation — account already armed",
          "The same letter for an account that already chose its own password: no password block.",
          "Your access to the ASA LifeCare platform", invite_armed),
        d("chat-unread", "Chat — messages while away",
          'What somebody gets after five minutes away: the messages themselves, not "you have messages".',
          "Emma Reyes wrote to you", chat),
        d("late-show", "Staff alert — Late Show",
          "Raised automatically when the mailbox receives a Late Show report.", late["subject"], late),
        d("no-call", "Staff alert — No Show No Call",
          "Raised automatically when the mailbox receives a No Show No Call report.", no_call["subject"], no_call),
        d("referral-phone", "Referral — the phone-number ask",
          "A referral arrived with only a name and an e-mail: this asks for the one missing thing, warmly.",
          ref_phone["subject"], ref_phone),
        d("birthday-staff", "Happy birthday — staff",
          "The company’s birthday wish for a staff member. No buttons, no asks — just the wish.",
          bday_staff["subject"], bday_staff),
        d("birthday-client", "Happy birthday — client",
          "The same warmth in a client’s words: the ASA family celebrating their day.",
          bday_client["subject"], bday_client),
        d("certs-expired", "Certifications expired — the red letter",
          "DODD / CPR / Med Delegation expired: the one letter allowed to wear red, with the steps back to "
          "compliance.", certs_red["subject"], certs_red),
        d("platform-status", "Platform digest — status & news",
          "One row per app: what is live, what is new this week.", digest["subject"], digest),
        d("how-it-works", "How the platform works",
          "The whole platform explained in sentences for a person’s first week: signing in, the workspace, the "
          "apps, how data moves.", how_works["subject"], how_works),
        d("hiring-date-accepted", "Hiring — Date Accepted unreadable",
          "Every reading of the accepted in-person date failed: the team is pointed at the card. Words: the "
          "hiring_date_accepted situation.", date_accepted["subject"], date_accepted),
        d("hired-complete", "Hiring — Hired, onboarding checked",
          "A card reached Hired with its New Hire Questionnaire and Tutorials complete (or onboarding confirmed by "
          "hand). Words: the hiring_hired_complete situation.",
          hired_complete["subject"], hired_complete),
        d("hired-missing", "Hiring — Hired with items missing",
          "A card reached Hired still owing items — the team chases them in the Tracker. Words: the "
          "hiring_hired_missing situation.", hired_missing["subject"], hired_missing),
        d("packet-request", "Hiring — the New Hire packet ask",
          "The one hiring letter an APPLICANT reads: the signed packet is still owed. Words: the "
          "hiring_packet_request situation.", packet_ask["subject"], packet_ask),
        d("ready-to-start", "Hiring — ready to start",
          "Hiring finished, account armed, Employee Database written. Words: the hiring_ready_to_start situation.",
          ready_start["subject"], ready_start),
        d("unreachable-archived", "Hiring — nobody could reach them",
          "Seven tries across a day on every contact we hold, no answer: the card goes to the Archive and the team "
          "is told once. The only hiring letter about somebody leaving the board with no person deciding it. Words: "
          "the hiring_unreachable_archived situation.", unreachable["subject"], unreachable),
        d("guardian-alert", "Guardian — the environment needs a person",
          "The platform checked itself and something needs a person: the issues in red, the way in one button. "
          "Words: the guardian_alert situation.", guardian["subject"], guardian),
    ]


def preview_all(reads: L.Reads) -> list[dict[str, str]]:
    """mailPreviewAll_: the 18 designs, the unreachable letter in its situation's words when they can be read."""
    return designs(unreachable_words(reads), reads.now)


# ---- the door ------------------------------------------------------------------------------------------------------

def writer(user: dict | None) -> bool:
    """hubIsWriter_."""
    return bool(user) and (user or {}).get("role") in ("admin", "manager")


def mail_preview(sess: L.Session, payload: dict) -> dict[str, Any]:
    """mailPreview: every design the Email Designs screen shows."""
    if not writer(sess.user):
        return dict(DENIED)
    return {"status": 200, "data": {"designs": preview_all(sess.reads)}}


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {"mailPreview": mail_preview}
POLICY: dict[str, dict[str, Any]] = {"mailPreview": {"roles": ("admin", "manager")}}
