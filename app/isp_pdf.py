"""The service plan as a filed PDF (Clients.gs ispPlanPdf): the isps row the action prints, the plan's demographics, the
HTML the PDF is converted from and the name the file is filed under. No reads and no Drive: the filing is the caller's."""
from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any

import clients as C
from gsjs import js_str, name_key, or_blank, or_text, str_, trim

ISP_PDF_FOLDER = "ASA Hub — Service Plans"
# Shift reading order; `critical` is read before a shift, `keep` prints even when empty.
ISP_PDF_SECTIONS = (
    {"heading": "Allergies", "field": "allergies", "weight": "critical", "keep": True},
    {"heading": "Safety & risks", "field": "safety_risks", "weight": "critical"},
    {"heading": "Supervision level", "field": "supervision_level", "weight": "critical", "keep": True},
    {"heading": "Medications", "field": "medications"},
    {"heading": "Diet & nutrition", "field": "diet_nutrition"},
    {"heading": "Behaviours", "field": "behaviors"},
    {"heading": "Mobility", "field": "mobility"},
    {"heading": "Personal care", "field": "personal_care"},
    {"heading": "Communication", "field": "communication"},
    {"heading": "Diagnoses", "field": "diagnoses"},
    {"heading": "Medical summary", "field": "medical_summary"},
    {"heading": "Goals & outcomes", "field": "goals_outcomes"},
    {"heading": "Important TO them", "field": "important_to"},
    {"heading": "Important FOR them", "field": "important_for"},
)
HUB_MONTH_NAMES = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")

# JavaScript's \s: Python's own adds \x1c-\x1f and \x85 and leaves out
_WS = r"\t\n\x0b\x0c\r \xa0  -     　﻿"
_S = "[" + _WS + "]"
_SPACES = re.compile(_S + "+")
_BULLET = re.compile(r"[•\-*]" + _S + r"*([^\n\r  ]+)")
_PAIR = re.compile(r"([^:]{3,64}):" + _S + r"*([\s\S]+)\Z")
_SENTENCE = re.compile(r"(.{40,}?[.!?])" + _S, re.S)
_TAIL = re.compile("[" + _WS + ",;]+\\Z")
_BARE_DAY = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}")
_ASTRAL = re.compile("[\U00010000-\U0010ffff]")


def _units(s: str) -> str:
    """The string as JavaScript counts it: an astral character is two code units."""
    if not _ASTRAL.search(s):
        return s
    b = s.encode("utf-16-le", "surrogatepass")
    return "".join(chr(int.from_bytes(b[i:i + 2], "little")) for i in range(0, len(b), 2))


def _chars(s: str) -> str:
    """Code units back to characters; a pair cut in half stays a lone half, as in JavaScript."""
    return s.encode("utf-16-le", "surrogatepass").decode("utf-16-le", "surrogatepass")


def esc(value: Any) -> str:
    """mailEsc_ (MailTemplates.gs)."""
    return (or_blank(value).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
            .replace('"', "&quot;").replace("'", "&#39;"))


def _e164(v: Any) -> str:
    """hubPhoneE164_ (HubCore.gs): display only."""
    s = trim(or_blank(v))
    if not s:
        return s
    digits = re.sub(r"[^0-9]", "", s)
    if len(digits) == 10:
        return "+1" + digits
    if len(digits) == 11 and digits[0] == "1":
        return "+" + digits
    return s


def _day_label(v: Any) -> str:
    """hubDayOnlyLabel_ (Talent.gs): a bare day as `Mon d, yyyy`, else ''."""
    if v is None:
        return ""
    s = trim(js_str(v))
    if not _BARE_DAY.fullmatch(s):
        return ""
    m, d = int(s[5:7]), int(s[8:10])
    if m < 1 or m > 12 or d < 1 or d > 31:
        return ""
    return f"{HUB_MONTH_NAMES[m - 1]} {d}, {int(s[:4])}"


def stamp_day(now: datetime | None = None) -> str:
    """new Date().toISOString().slice(0, 10): the UTC day the action prints and names the file by."""
    return (now or datetime.now(timezone.utc)).astimezone(timezone.utc).strftime("%Y-%m-%d")


def demographics(block: Any, client_name: str = "") -> dict:
    """ispDemographics_."""
    return C.demographics(block, client_name)


def find_row(rows: list[dict], client_key: Any) -> dict | None:
    """ispPlanPdf's lookup: the first isps row whose client_key, id or name key is the asked key."""
    key = str_(client_key)
    if not key:
        return None
    nk = name_key(key)
    for r in rows:
        if str_(r.get("client_key")) == key or str_(r.get("id")) == key or name_key(str_(r.get("client_name"))) == nk:
            return r
    return None


def pdf_name(row: dict, today_iso: str) -> str:
    return str_(row.get("client_name")) + " — service plan (" + today_iso + ").pdf"


def _blocks(value: Any) -> dict[str, Any]:
    """ispPdfBlocks_."""
    raw = or_text(value).replace("\r", "")
    bullets: list[str] = []
    prose: list[str] = []
    for line in (ln for ln in (trim(x) for x in raw.split("\n")) if ln):
        m = _BULLET.fullmatch(line)
        if m:
            bullets.append(trim(m.group(1)))
        elif bullets:
            bullets[-1] += " " + line
        else:
            prose.append(line)
    return {"bullets": bullets, "prose": trim(" ".join(prose))}


def _bullet(text: Any) -> str:
    """ispPdfBullet_."""
    t = or_text(text)
    m = _PAIR.match(_units(t))
    if not m:
        return '<li style="margin:0 0 7px 0;">' + esc(t) + "</li>"
    return ('<li style="margin:0 0 7px 0;"><span style="font-weight:bold;">' + esc(_chars(m.group(1)))
            + "</span> — " + esc(_chars(m.group(2))) + "</li>")


def _section_body(value: Any) -> str:
    """ispPdfSectionBody_."""
    b = _blocks(value)
    out = ""
    if b["prose"]:
        out += ('<p style="margin:0 0 8px 0;font:12.5px/19px Helvetica,Arial,sans-serif;color:#1c2024;">'
                + esc(b["prose"]) + "</p>")
    if b["bullets"]:
        out += '<ul style="margin:0;padding:0 0 0 18px;font:12.5px/19px Helvetica,Arial,sans-serif;color:#1c2024;">'
        for item in b["bullets"]:
            out += _bullet(item)
        out += "</ul>"
    return out


def _first_sentence(value: Any, cap: int = 0) -> str:
    """ispPdfFirstSentence_: lengths in UTF-16 code units, as JavaScript measures them."""
    t = trim(_SPACES.sub(" ", or_text(value)))
    if not t:
        return ""
    u = _units(t)
    m = _SENTENCE.match(u)
    s = m.group(1) if m else u
    most = cap or 220
    return _chars(_TAIL.sub("", s[:most - 1]) + "…" if len(s) > most else s)


def _glance(r: dict) -> str:
    """ispPdfGlance_: blank allergies print "None recorded in the plan", never nothing."""
    diag = _blocks(r.get("diagnoses"))["bullets"]
    allerg = _blocks(r.get("allergies"))
    allerg_text = " · ".join(allerg["bullets"]) if allerg["bullets"] else (allerg["prose"] or "")
    sup = _first_sentence(or_text(r.get("supervision_level")), 180)
    rows = (("Supervision", sup or "Not recorded in the plan.", not sup),
            ("Allergies", allerg_text or "None recorded in the plan.", not allerg_text),
            ("Conditions", " · ".join(diag) if diag
             else (_first_sentence(r.get("diagnoses"), 200) or "None recorded in the plan."), not diag))
    html = ('<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" '
            'style="border-collapse:collapse;margin:0 0 4px 0;">')
    for label, value, soft in rows:
        html += ('<tr>'
                 '<td valign="top" width="108" style="padding:7px 12px 7px 0;border-top:1px solid #e3e6ea;'
                 'font:bold 10px Helvetica,Arial,sans-serif;letter-spacing:1px;text-transform:uppercase;color:#5b6470;">'
                 + esc(label) + "</td>"
                 + '<td style="padding:7px 0;border-top:1px solid #e3e6ea;font:12.5px/18px Helvetica,Arial,sans-serif;color:'
                 + ("#5b6470" if soft else "#1c2024") + ';">' + esc(value) + "</td></tr>")
    html += "</table>"
    summary = trim(_SPACES.sub(" ", or_text(r.get("medical_summary"))))
    if summary:
        html += ('<p style="margin:12px 0 0 0;font:italic 12.5px/19px Georgia,serif;color:#2f3540;">'
                 + esc(summary) + "</p>")
    return html


def plan_html(row: dict, demo: dict | None, today_iso: str) -> str:
    """ispPdfHtml_; `today_iso` is the day printed, which the action takes from stamp_day()."""
    name = str_(row.get("client_name"))
    year = str_(row.get("isp_year"))
    d = demo or {}

    live = []
    for sec in ISP_PDF_SECTIONS:
        value = str_(row.get(sec["field"]))
        if not value and not sec.get("keep"):
            continue
        live.append({"n": len(live) + 1, "id": "sec-" + sec["field"], "heading": sec["heading"], "value": value,
                     "weight": sec.get("weight")})

    contents = ""
    for c, it in enumerate(live):
        contents += ('<td width="33%" valign="top" style="padding:2px 10px 2px 0;'
                     'font:11.5px/17px Helvetica,Arial,sans-serif;">'
                     + '<a href="#' + it["id"] + '" style="color:#1c2024;text-decoration:none;">'
                     + '<span style="color:#2f6f5f;font-weight:bold;">' + str(it["n"]) + ".</span> "
                     + esc(it["heading"]) + "</a></td>")
        if (c + 1) % 3 == 0:
            contents += "</tr><tr>"

    body = ""
    for it in live:
        critical = it["weight"] == "critical"
        n = it["n"]
        body += ('<div style="page-break-inside:avoid;margin:0 0 18px 0;'
                 + ("border-left:2px solid #c2410c;padding:0 0 0 14px;" if critical else "") + '">'
                 + '<h2 id="' + it["id"] + '" style="margin:0 0 7px 0;font:bold 11.5px Helvetica,Arial,sans-serif;'
                 + "letter-spacing:1.3px;text-transform:uppercase;color:" + ("#c2410c" if critical else "#2f6f5f") + ";"
                 + "border-bottom:1px solid " + ("#f0dfd4" if critical else "#e3e6ea") + ';padding-bottom:5px;">'
                 + '<span style="color:#c3c9d0;">' + ("0" + str(n) if n < 10 else str(n)) + "</span> &nbsp;"
                 + esc(it["heading"]) + "</h2>"
                 + (_section_body(it["value"]) if it["value"]
                    else '<p style="margin:0;font:12.5px/19px Helvetica,Arial,sans-serif;color:#5b6470;">'
                         "None recorded in the plan.</p>")
                 + "</div>")

    facts = [f for f in (("Date of birth", str_(d.get("dob"))), ("County", str_(d.get("county"))),
                         ("Phone", _e164(str_(d.get("client_phone")))), ("Guardian", str_(d.get("guardian_name"))),
                         ("Guardian phone", _e164(str_(d.get("guardian_phone")))), ("S.S.A.", str_(d.get("ssa_name"))))
             if f[1]]
    facts_html = ""
    for k in range(0, len(facts), 2):
        facts_html += "<tr>"
        for label, value in facts[k:k + 2]:
            facts_html += ('<td width="50%" valign="top" style="padding:3px 16px 3px 0;">'
                           '<span style="font:10px Helvetica,Arial,sans-serif;letter-spacing:1px;'
                           'text-transform:uppercase;color:#9aa3ad;">'
                           + esc(label) + "</span><br>"
                           + '<span style="font:12.5px Helvetica,Arial,sans-serif;color:#1c2024;">' + esc(value)
                           + "</span></td>")
        facts_html += "</tr>"

    return ('<!DOCTYPE html><html><head><meta charset="utf-8"><title>' + esc(name) + " — service plan</title>"
            # @page is only a request the converter may ignore, so the body carries its own margin too.
            + "<style>@page { margin: 12mm 10mm; }</style></head>"
            + '<body style="margin:0;padding:26px 34px 30px 34px;background:#ffffff;">'
            + '<a name="top" id="top"></a>'
            + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">'
            + '<tr><td style="border-bottom:2px solid #2f6f5f;padding:0 0 10px 0;">'
            + '<p style="margin:0 0 3px 0;font:10px Helvetica,Arial,sans-serif;letter-spacing:2px;'
              'text-transform:uppercase;color:#2f6f5f;">'
            + "ASA LifeCare · Individual Service Plan</p>"
            + '<h1 style="margin:0;font:normal 30px/36px Georgia,serif;color:#1c2024;">' + esc(name) + "</h1>"
            + '<p style="margin:3px 0 0 0;font:11.5px Helvetica,Arial,sans-serif;color:#5b6470;">'
            + ("Plan year " + esc(year) + " &nbsp;·&nbsp; " if year else "")
            + "Printed " + esc(_day_label(today_iso)) + "</p>"
            + "</td></tr></table>"
            + ('<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" '
               'style="margin:14px 0 0 0;background:#fafbfc;border-radius:8px;">'
               '<tr><td style="padding:10px 14px;"><table role="presentation" width="100%" cellpadding="0" '
               'cellspacing="0" border="0">' + facts_html + "</table></td></tr></table>" if facts_html else "")
            + '<div style="page-break-inside:avoid;margin:18px 0 0 0;background:#f2f7f5;border-radius:10px;'
              'padding:14px 18px;">'
            + '<p style="margin:0 0 8px 0;font:bold 10px Helvetica,Arial,sans-serif;letter-spacing:1.6px;'
              'text-transform:uppercase;color:#2f6f5f;">'
            + "Before the shift</p>" + _glance(row) + "</div>"
            + '<div style="page-break-inside:avoid;margin:18px 0 22px 0;border-top:1px solid #e3e6ea;'
              'border-bottom:1px solid #e3e6ea;padding:12px 0;">'
            + '<p style="margin:0 0 8px 0;font:bold 10px Helvetica,Arial,sans-serif;letter-spacing:1.6px;'
              'text-transform:uppercase;color:#9aa3ad;">'
            + "On this page</p>"
            + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>' + contents
            + "</tr></table></div>"
            + body
            + '<p style="margin:28px 0 0 0;font:10px/15px Helvetica,Arial,sans-serif;color:#9aa3ad;'
              'border-top:1px solid #e3e6ea;padding-top:10px;">'
            + "This document is the ASA LifeCare platform's reading of the Individual Service Plan, not the county's "
              "own plan. Where the two differ, the plan on file is the authority. It carries clinical information: "
              "handle it the way you would handle the plan itself.</p>"
            + "</body></html>")
