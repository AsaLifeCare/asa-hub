"""The hiring outreach letters (MailTemplatesHiring.gs) on Python: each builder answers {subject, text, html} as its
Apps Script twin does, a Smart Comms row's words (bodyText) winning when present and the layout ours either way. The
parts are mail_designs' (MailTemplates.gs, ported there to the byte)."""
from __future__ import annotations

import re
from typing import Any

import gsjs
import mail_designs as MD

EYEBROW = MD.HIRING_MAIL_EYEBROW
_PARAS = re.compile(r"\n{2,}")
_LINE = re.compile(r"^\+1(\d{3})(\d{3})(\d{4})$")

esc, para, fact, steps, shell = MD.mail_esc, MD.mail_para, MD.mail_fact, MD.mail_steps, MD.mail_shell
blocks_of = MD.mail_body_blocks


def _or(v: Any, floor: str = "") -> str:
    """String(v || floor)."""
    return floor if gsjs.falsy(v) else gsjs.js_str(v)


def _trim(v: Any) -> str:
    """String(v || '').trim()."""
    return gsjs.trim(_or(v))


def _first(name: str) -> str:
    """name.split(/\\s+/)[0] || name."""
    return (re.split(r"\s+", name)[0] if name else "") or name


def _given(v: Any) -> bool:
    """v !== undefined && v !== null && v !== ''."""
    return v is not None and v != ""


def _paras(text: str) -> list[str]:
    """Each paragraph of a row's words as its own block, the lines inside it kept."""
    return [para(esc(p).replace("\n", "<br>")) for p in _PARAS.split(text)]


def line_label(line: str) -> str:
    """+1XXXXXXXXXX as (XXX) XXX-XXXX, anything else as it stands."""
    return _LINE.sub(r"(\1) \2-\3", line) or line


def score_table(rows: list[dict]) -> str:
    """hiringScoreTable_: unscored prints a dash, never a zero."""
    if not rows:
        return ""
    soft = MD.MAIL_INK_SOFT
    head = ("font-family:Helvetica,Arial,sans-serif;font-size:11px;letter-spacing:1px;text-transform:uppercase;color:"
            + soft + ";")
    html = ('<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" '
            'style="border:1px solid ' + MD.MAIL_LINE + ';border-radius:10px;border-collapse:separate;border-spacing:0;'
            'overflow:hidden;">'
            '<tr style="background:' + MD.MAIL_ACCENT_SOFT + ';">'
            '<td style="padding:9px 14px;' + head + '">Candidate</td>'
            '<td align="center" style="padding:9px 10px;' + head + '">Score</td>'
            '<td style="padding:9px 14px;' + head + '">Why</td>'
            '</tr>')
    for r in rows:
        r = r or {}
        contact = [gsjs.js_str(r[k]) for k in ("phone", "email", "city") if not gsjs.falsy(r.get(k))]
        score = "–" if r.get("score") is None or r.get("score") == "" else gsjs.js_str(r.get("score"))
        html += ('<tr style="border-top:1px solid ' + MD.MAIL_LINE + ';">'
                 '<td style="padding:11px 14px;border-top:1px solid ' + MD.MAIL_LINE + ';font-family:Helvetica,Arial,'
                 'sans-serif;font-size:14px;line-height:20px;color:' + MD.MAIL_INK + ';">'
                 '<strong>' + esc(_or(r.get("name"))) + '</strong>'
                 + ('<br><span style="font-size:12px;color:' + soft + ';">' + esc(" · ".join(contact)) + '</span>'
                    if contact else '')
                 + '</td>'
                 '<td align="center" style="padding:11px 10px;border-top:1px solid ' + MD.MAIL_LINE + ';font-family:'
                 'Helvetica,Arial,sans-serif;font-size:18px;font-weight:bold;color:'
                 + (soft if score == "–" else MD.MAIL_ACCENT) + ';">' + esc(score) + '</td>'
                 '<td style="padding:11px 14px;border-top:1px solid ' + MD.MAIL_LINE + ';font-family:Helvetica,Arial,'
                 'sans-serif;font-size:13px;line-height:19px;color:' + soft + ';">' + esc(_or(r.get("why"))) + '</td>'
                 '</tr>')
    return html + '</table>'


def score_text(rows: list[dict]) -> str:
    """hiringScoreText_."""
    out = []
    for i, r in enumerate(rows or []):
        score = "not scored" if r.get("score") is None or r.get("score") == "" else gsjs.js_str(r["score"]) + "/10"
        contact = " · ".join(gsjs.js_str(r[k]) for k in ("phone", "email", "city") if not gsjs.falsy(r.get(k)))
        out.append("  " + str(i + 1) + ". " + _or(r.get("name")) + " — " + score
                   + ("\n     " + gsjs.js_str(r["why"]) if not gsjs.falsy(r.get("why")) else "")
                   + ("\n     " + contact if contact else ""))
    return "\n".join(out)


def welcome(o: dict) -> dict[str, str]:
    """hiringWelcomeEmail_."""
    roles = list(o.get("roles") or [])
    count = o.get("candidateCount")
    link = _or(o.get("link"), MD.mail_platform_url() + "/#/app/hiring/pipeline")
    body_text = _trim(o.get("bodyText"))
    roles_line = ", ".join(roles) if roles else "the roles named in the access matrix"
    if body_text:
        blocks = blocks_of(body_text)
        blocks.append(fact("Who can open it", roles_line))
    else:
        blocks = [para("The <strong>Hiring Pipeline</strong> is open on the platform. It carries every candidate from "
                       "the first contact to their first day — the resume and its score, the background check, the "
                       "phone screen and its transcript, the in-person interview, the onboarding paperwork, and the "
                       "account the new hire signs in with."),
                  fact("Who can open it", roles_line)]
    if _given(count):
        blocks.append(fact("Ready to work today", gsjs.js_str(count) + " DSPs already in our database"))
    if not body_text:
        blocks.append(para("Open the app, pick the people worth calling, and start them down the process — every step "
                           "after that is prompted by the platform itself, and every message it sends is recorded on "
                           "the card."))
        blocks.append(steps(["Open <strong>Hiring Pipeline</strong> from the app hub.",
                             "Choose a candidate from the board and open their card.",
                             "Advance them when the card says every piece of evidence is on file — it names what is "
                             "missing."]))
    floor = ("The Hiring Pipeline is open on the platform.\n\nIt carries every candidate from first contact to first "
             "day: the resume and its score, the background check, the phone screen and its transcript, the in-person "
             "interview, the onboarding paperwork, and the account the new hire signs in with.")
    ready = "Ready to work today: " + gsjs.js_str(count) + " DSPs already in our database\n" if _given(count) else ""
    text = ((body_text or floor) + "\n\n" + "Who can open it: " + roles_line + "\n" + ready + "\nOpen it here: " + link
            + "\n")
    return {"subject": _or(o.get("subject")) or "The Hiring Pipeline is open — start hiring from our own database",
            "text": text,
            "html": shell({"eyebrow": EYEBROW, "title": "The Hiring Pipeline is open",
                           "preheader": "Pick candidates from our own database and start the hiring process.",
                           "blocks": blocks, "cta": {"label": "Open the Hiring Pipeline", "href": link},
                           "footnote": "You are reading this because your role reaches the Hiring Pipeline. Everything "
                                       "the app sends from here on is recorded on the candidate’s own card."})}


def ask(o: dict) -> dict[str, str]:
    """hiringAskEmail_."""
    count = o.get("candidateCount")
    body_text = _trim(o.get("bodyText"))
    if body_text:
        blocks = _paras(body_text)
    else:
        blocks = [para("Hello team — <strong>are we currently hiring?</strong>"),
                  para("If we are, how many Direct Support Professionals from the pool I have already analyzed would "
                       "you like to see? Reply with a number and I will send the ranked shortlist with my reading of "
                       "it.")]
    if _given(count):
        blocks.append(fact("Analyzed and ready to be ranked", gsjs.js_str(count) + " DSPs"))
    blocks.append(para("<strong>Reply to this message</strong> — a number, or simply OK, is all this needs. I read the "
                       "answer and take the next step from it."))
    text = ((body_text or "Hello team — are we currently hiring?\n\nIf we are, how many Direct Support Professionals "
                          "from the pool I have already analyzed would you like to see? Reply with a number and I will "
                          "send the ranked shortlist.")
            + ("\n\nAnalyzed and ready to be ranked: " + gsjs.js_str(count) + " DSPs\n" if _given(count) else "\n"))
    return {"subject": _or(o.get("subject")) or "Are we hiring? — your word starts the process",
            "text": text,
            "html": shell({"eyebrow": EYEBROW, "title": "Are we hiring?",
                           "preheader": "One reply starts the whole process.", "blocks": blocks,
                           "footnote": "The platform reads the reply on this thread. OK, a number, or the names you "
                                       "want are all answers it understands."})}


def shortlist(o: dict) -> dict[str, str]:
    """hiringShortlistEmail_: an override replaces only the intro; the table, criteria and reply line always ride."""
    rows = list(o.get("rows") or [])
    reading = _or(o.get("reading"))
    criteria = list(o.get("criteria") or [])
    body_text = _trim(o.get("bodyText"))
    link = _or(o.get("link"), MD.mail_platform_url() + "/#/app/hiring/pipeline")
    blocks = blocks_of(body_text) if body_text else [
        para("We reviewed the Direct Support Professionals currently in our database and ranked them against the work "
             "we actually need covered." + (" These are the strongest, in order:" if rows else ""))]
    if rows:
        blocks.append(score_table(rows))
    if criteria:
        blocks.append(para("<strong>The criteria behind the score:</strong><br>"
                           + "<br>".join(chr(65 + i) + " · " + esc(gsjs.js_str(c)) for i, c in enumerate(criteria))))
    if reading:
        blocks.extend(_paras(reading))
    blocks.append(para("<strong>If any of them is worth a call, reply to this message and say which one.</strong> We "
                       "open the conversation from there and keep every step on their card."))
    text = ((body_text or "We reviewed the Direct Support Professionals currently in our database and ranked them "
                          "against the work we need covered.") + "\n\n"
            + (score_text(rows) + "\n\n" if rows else "")
            + ("The criteria behind the score:\n"
               + "\n".join("  " + chr(65 + i) + " - " + gsjs.js_str(c) for i, c in enumerate(criteria)) + "\n\n"
               if criteria else "")
            + (reading + "\n\n" if reading else "")
            + "If any of them is worth a call, reply and say which one — we open the conversation from there.\n\n"
              "The board: " + link + "\n")
    return {"subject": _or(o.get("subject")) or ("Our strongest DSPs right now"
                                                 + (" — top " + str(len(rows)) if rows else "")),
            "text": text,
            "html": shell({"eyebrow": EYEBROW, "title": "The candidates worth calling",
                           "preheader": "Our analysis of the DSPs already in our database, ranked.", "blocks": blocks,
                           "cta": {"label": "See them on the board", "href": link},
                           "footnote": "Scores come from our own resume analysis. A dash means the resume was never "
                                       "scored — it is not a zero, and it is not a verdict."})}


def interest_thanks(o: dict) -> dict[str, str]:
    """hiringInterestThanksEmail_: the subject never names a DSP."""
    who = _trim(o.get("who"))
    about = _trim(o.get("about"))
    body_text = _trim(o.get("bodyText"))
    first = re.split(r"\s+", who)[0] if who else ""
    many = "," in about
    blocks = blocks_of(body_text) if body_text else [
        para(("Hi " + esc(first) + "," if first else "Hello,") + " thank you — that is exactly what we needed."),
        para("We are reaching out to " + ("<strong>" + esc(about) + "</strong>" if about else "them")
             + " now — the conversation lands on " + ("each card" if many else "their card")
             + " from the first message. You will see the outcome there without having to ask.")]
    text = body_text + "\n" if body_text else (
        ("Hi " + first + "," if first else "Hello,") + "\n\nThank you — that is exactly what we needed.\n\nWe are "
        "reaching out to " + (about or "them") + " now — the conversation lands on "
        + ("each card" if many else "their card") + " from the first message.\n")
    return {"subject": _or(o.get("subject")) or "Thank you — we will take it from here",
            "text": text,
            "html": shell({"eyebrow": EYEBROW, "title": "Thank you — we will take it from here",
                           "preheader": "We are opening the conversation now.", "blocks": blocks,
                           "footnote": "No reply needed. Everything from here is recorded on the candidate’s card."})}


def resume_request(o: dict) -> dict[str, str]:
    """hiringResumeRequestEmail_."""
    name = _trim(o.get("name"))
    first = _first(name)
    referrer = _trim(o.get("referrer"))
    body_text = _trim(o.get("bodyText"))
    link = _or(o.get("link"))
    blocks = blocks_of(body_text) if body_text else [
        para(("Hi " + esc(first) + "," if first else "Hello,") + " "
             + (esc(referrer) + " passed your name to us at <strong>ASA LifeCare</strong>" if referrer
                else "your name reached us at <strong>ASA LifeCare</strong>")
             + " — we support people with developmental disabilities across Ohio, and we are hiring Direct Support "
               "Professionals."),
        para("To look at you for a selection process, we would like <strong>either or both</strong> of:"),
        steps(["<strong>A phone number</strong> we can reach you on.",
               "<strong>Your resume</strong> — attached to a reply is perfect."]),
        para("<strong>And the question that decides it: are you interested in a selection process at ASA "
             "LifeCare?</strong> Reply to this message with your number, your resume, or simply \"yes, I am "
             "interested\" — our recruiting team reads it and calls you.")]
    text = (body_text + "\n" if body_text else
            ("Hi " + first + "," if first else "Hello,") + "\n\n"
            + (referrer + " passed your name to us at ASA LifeCare" if referrer
               else "Your name reached us at ASA LifeCare")
            + " — we support people with developmental disabilities across Ohio, and we are hiring Direct Support "
              "Professionals.\n\nTo look at you for a selection process, we would like either or both of:\n\n  1. A "
              "phone number we can reach you on.\n  2. Your resume — attached to a reply is perfect.\n\nAnd the "
              "question that decides it: are you interested in a selection process at ASA LifeCare? Reply with your "
              "number, your resume, or simply \"yes, I am interested\" — our recruiting team reads it and calls you.\n"
            ) + ("\n" + link + "\n" if link else "")
    return {"subject": _or(o.get("subject")) or "REFERRAL - Your phone or resume — a selection process at ASA LifeCare",
            "text": text,
            "html": shell({"eyebrow": "ASA LifeCare", "title": "A phone, a resume — and your interest",
                           "preheader": "A phone number or your resume, and whether a selection process interests you.",
                           "blocks": blocks, "cta": {"label": "Send them here", "href": link} if link else None,
                           "footnote": "If this reached you by mistake, you can ignore it — nothing was created for "
                                       "you."})}


def cjis_request(o: dict) -> dict[str, str]:
    """hiringCjisRequestEmail_: only the folder — nothing on this platform reads an attachment out of a mailbox."""
    name = _trim(o.get("name"))
    folder = _or(o.get("folderUrl"))
    status = _trim(o.get("status"))
    body_text = _trim(o.get("bodyText"))
    if body_text:
        blocks = blocks_of(body_text)
        blocks.append(fact("Candidate", name))
    else:
        blocks = [para("The hiring pipeline is holding <strong>" + esc(name) + "</strong> at the first gate: the "
                       "background check is not on file, and nothing moves without it."),
                  fact("Candidate", name)]
    if status:
        blocks.append(fact("What the record says today", status))
    if not body_text:
        blocks.append(para("Download the CJIS result and drop it in the folder. The platform reads that folder on its "
                           "own and matches the file to the candidate by name; putting it on their record stays a "
                           "deliberate press by one of us, because finding a document and deciding it is theirs are "
                           "two different things."))
    if body_text:
        text = (body_text + "\n\nCandidate: " + name + "\n"
                + ("What the record says today: " + status + "\n" if status else "")
                + ("The folder: " + folder + "\n" if folder else ""))
    else:
        text = ("The hiring pipeline is holding " + name + " at the first gate: the background check is not on "
                "file.\n\n" + ("What the record says today: " + status + "\n\n" if status else "")
                + "Download the CJIS result and drop it in the folder" + (": " + folder if folder else "")
                + "\n\nThe platform reads that folder, matches the file to the candidate by name and puts it on their "
                  "card. Attaching it to their record stays a deliberate press by one of us.\n")
    return {"subject": _or(o.get("subject")) or ("CJIS needed to move " + name + " forward"),
            "text": text,
            "html": shell({"eyebrow": EYEBROW, "title": "A background check is holding a candidate",
                           "preheader": name + " cannot move until the CJIS result is on file.", "blocks": blocks,
                           "cta": {"label": "Open Original Documents", "href": folder} if folder else None,
                           "footnote": "The folder is the whole ask. The platform reads it on its own, and the card "
                                       "shows the report the moment one of us attaches it."})}


def decision_ask(o: dict) -> dict[str, str]:
    """hiringDecisionAskEmail_: an override replaces only the intro, the reply is read for ADVANCE/DECLINE."""
    name = _trim(o.get("name"))
    score = o.get("score")
    summary = _trim(o.get("summary"))
    report_url = _or(o.get("reportUrl"))
    body_text = _trim(o.get("bodyText"))
    link = _or(o.get("link"), MD.mail_platform_url() + "/#/app/hiring/pipeline")
    blocks = blocks_of(body_text) if body_text else [
        para("<strong>" + esc(name) + "</strong> finished the phone screen. We read the transcript and scored it — the "
             "next move is yours.")]
    if _given(score):
        blocks.append(fact("Screen score", gsjs.js_str(score) + " / 10"))
    if summary:
        blocks.extend(_paras(summary))
    blocks.append(para("<strong>Reply ADVANCE to release them to the interview and scheduling step, or DECLINE to "
                       "close the file.</strong> Either answer is recorded on the card with your name and the time."))
    text = ((body_text or name + " finished the phone screen. We read the transcript and scored it — the next move is "
                                 "yours.") + "\n\n"
            + ("Screen score: " + gsjs.js_str(score) + "/10\n\n" if _given(score) else "")
            + (summary + "\n\n" if summary else "")
            + ("The full report: " + report_url + "\n\n" if report_url else "")
            + "Reply ADVANCE to release them to the interview and scheduling step, or DECLINE to close the file.\n\n"
              "The card: " + link + "\n")
    return {"subject": _or(o.get("subject")) or ("Your decision: " + name + " after the phone screen"),
            "text": text,
            "html": shell({"eyebrow": EYEBROW, "title": "One decision left on " + (name or "this candidate"),
                           "preheader": "The phone screen is done — advance them or close the file.", "blocks": blocks,
                           "cta": {"label": "Read the full report" if report_url else "Open the card",
                                   "href": report_url or link},
                           "footnote": "The platform is watching this thread and the recruiting line for your answer. "
                                       "Whichever way you reply, the card records who said it and when."})}


def outreach(o: dict) -> dict[str, str]:
    """hiringOutreachEmail_: the only person named is the candidate; the company speaks as the company."""
    name = _trim(o.get("name"))
    first = _first(name)
    body_text = _trim(o.get("bodyText"))
    if body_text:
        blocks = _paras(body_text)
    else:
        blocks = [para(("Hi " + esc(first) + "," if first else "Hello,") + " this is <strong>ASA LifeCare</strong> "
                       "— we support people with developmental disabilities across Ohio, and we are hiring Direct "
                       "Support Professionals."),
                  para("We would like to talk with you about the role. <strong>Are you interested? Reply "
                       "YES</strong> — or answer the text we sent to your phone — and we will call you.")]
    text = body_text or (("Hi " + first + "," if first else "Hello,") + "\n\nThis is ASA LifeCare — we support people "
                         "with developmental disabilities across Ohio, and we are hiring Direct Support Professionals."
                         "\n\nWe would like to talk with you about the role. Are you interested? Reply YES and we will "
                         "call you.\n")
    return {"subject": _or(o.get("subject")) or "A Direct Support Professional opportunity — ASA LifeCare",
            "text": text,
            "html": shell({"eyebrow": "ASA LifeCare", "title": "We would like to talk with you",
                           "preheader": "We would like to talk with you about a DSP opportunity.", "blocks": blocks,
                           "footnote": "Reply YES to this message, or to the text on your phone — either answer "
                                       "reaches the same team."})}


def screen_call(o: dict) -> dict[str, str]:
    """hiringScreenCallEmail_."""
    name = _trim(o.get("name"))
    first = _first(name)
    label = line_label(_trim(o.get("line")))
    body_text = _trim(o.get("bodyText"))
    if body_text:
        blocks = _paras(body_text)
    else:
        blocks = [para(("Hi " + esc(first) + "," if first else "Hello,") + " great — we are glad you want to move "
                                                                            "forward."),
                  para("The next step is a short <strong>phone evaluation</strong>. Call our interview line whenever "
                       "you are ready:"),
                  fact("Interview line", label, True),
                  para("The call takes a few minutes and is answered by our screening line. <strong>As soon as you "
                       "finish, one of our employees will contact you</strong> with the next step.")]
    text = body_text or (("Hi " + first + "," if first else "Hello,") + "\n\nGreat — we are glad you want to move "
                         "forward.\n\nThe next step is a short phone evaluation. Call our interview line whenever you "
                         "are ready: " + label + "\n\nAs soon as you finish, one of our employees will contact you "
                         "with the next step.\n")
    return {"subject": _or(o.get("subject")) or "Your phone evaluation — call us when you are ready",
            "text": text,
            "html": shell({"eyebrow": "ASA LifeCare", "title": "Call us for your phone evaluation",
                           "preheader": "Call " + label + " — a few minutes, then we contact you.", "blocks": blocks,
                           "footnote": "The call is the evaluation itself. Nothing else is needed from you until we "
                                       "reach out."})}


def accepted(o: dict) -> dict[str, str]:
    """hiringAcceptedEmail_."""
    name = _trim(o.get("name"))
    reply = _trim(o.get("reply"))
    phone = _trim(o.get("phone"))
    email = _trim(o.get("email"))
    body_text = _trim(o.get("bodyText"))
    if body_text:
        blocks = _paras(body_text)
    else:
        blocks = [para("<strong>" + esc(name) + "</strong> answered our outreach and agreed to talk about the Direct "
                                                "Support Professional role.")]
        if reply:
            blocks.append(fact("Their words", reply[:300]))
        if phone:
            blocks.append(fact("Their number", phone))
        if email:
            blocks.append(fact("Their e-mail", email))
        blocks.append(para("<strong>Arthur — the next two things are yours:</strong> talk with them, and ask for the "
                           "CJIS background check and the document signatures. The card holds everything as it "
                           "arrives."))
    text = body_text or (name + " answered our outreach and agreed to talk about the DSP role.\n\n"
                         + ("Their words: \"" + reply[:300] + "\"\n" if reply else "")
                         + ("Their number: " + phone + "\n" if phone else "")
                         + ("Their e-mail: " + email + "\n" if email else "")
                         + "\nArthur — the next two things are yours: talk with them, and ask for the CJIS background "
                           "check and the document signatures.\n")
    return {"subject": _or(o.get("subject")) or (name + " said yes — CJIS and signatures are next"),
            "text": text,
            "html": shell({"eyebrow": EYEBROW, "title": name + " wants to talk",
                           "preheader": name + " accepted — the CJIS and the signatures are the next two asks.",
                           "blocks": blocks,
                           "footnote": "Recorded on their card. The folder sweep files the CJIS the moment it lands in "
                                       "Original Documents."})}


def plain(subject: str, body_text: str, title: str, preheader: str, footnote: str) -> dict[str, str]:
    """A letter written whole by its lane (the manual first contact, the phone collection): its words, one paragraph
    per blank line, in the ASA LifeCare shell."""
    return {"subject": subject, "text": body_text,
            "html": shell({"eyebrow": "ASA LifeCare", "title": title, "preheader": preheader,
                           "blocks": _paras(body_text), "cta": None, "footnote": footnote})}


discard = MD.hiring_discard_email
