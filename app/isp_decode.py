"""OhioISP decoder, a copy of server/isp_decode.py, itself a copy of the old platform/app/analytics/isp_to_json.py
(change all three); `flatten()` is the Hub's own. `pdf_text` reads a plan's pages as the relay's /isp/decode read them."""


from __future__ import annotations

import re
import json
import logging
import threading

log = logging.getLogger("isp_to_json")


# ─────────────────────────── helpers ───────────────────────────

def _clean_lines(raw_text: str) -> str:
    """Mirror the JS pre-clean: drop 'HCBS -', 'Last revised …', bare 'Page N'."""
    raw_text = (raw_text or "").replace("HCBS -", "")
    out = []
    for line in raw_text.split("\n"):
        line = line.strip()
        if re.match(r"^last revised\s+", line, re.I):
            continue
        if re.match(r"^page\s+\d+$", line, re.I):
            continue
        out.append(line)
    return "\n".join(out)


def _lines(block: str, *, minlen: int = 2, drop=r"^(Page|OhioISP|ISP Span|Effective)"):
    return [l.strip() for l in (block or "").split("\n")
            if l.strip() and len(l.strip()) > minlen and not re.match(drop, l.strip(), re.I)]


def _defurniture(text: str) -> str:
    """Strip per-page header/footer lines so label-bounded captures do not bleed across page breaks."""
    out = []
    for ln in (text or "").split("\n"):
        s = ln.strip()
        if re.match(r"^OhioISP\s*-\s", s, re.I): continue
        if re.match(r"^Page\s+\d+\s*$", s, re.I): continue
        if re.match(r"^ISP Span Dates\s*:", s, re.I): continue
        if re.match(r"^Effective Date\s*:", s, re.I): continue
        if re.match(r"^Last revised\b", s, re.I): continue
        if re.match(r"^HCBS\b", s, re.I): continue
        if re.match(r"^\d{1,3}$", s): continue          # bare page numbers
        out.append(s)
    return "\n".join(out)


# Section labels that end any capture.
STOP_LABELS = [
    r"Important To\b", r"Important For\b", r"Need to Know to Support", r"Great Things About",
    r"Contact Information", r"Assessment Area", r"Discovery Assessment",
    r"Healthy Living", r"Nutrition\b", r"Communication\b", r"Advocacy", r"Safety\s*&\s*Security",
    r"Social\s*&\s*Spirituality", r"Daily Life", r"School and Education", r"Community Living",
    r"Skills and Abilities", r"Getting Around", r"Supervision Considerations",
    r"Known and Likely Risks", r"Outcomes", r"Services and Supports", r"Informed Consent",
    r"Team Signatures", r"Scope of Service", r"Who is Responsible", r"Support Planning",
    r"What does a healthy lifestyle", r"Does the person\b", r"What kinds of food",
    r"What physical", r"Has the person been to the hospital", r"Do they require",
    r"Assistive/adaptive equipment used", r"Date of Birth",
]
_STOP_RE = re.compile("|".join(f"(?:{p})" for p in STOP_LABELS), re.I)


def _block(body: str, start_pat: str, *, extra_stops=(), drop_stops=()) -> str:
    """Text after `start_pat` up to the nearest STOP label, adjusted by `extra_stops`/`drop_stops`."""
    sm = re.search(start_pat, body, re.I | re.M)
    if not sm:
        return ""
    sub = body[sm.end():]
    pats = [p for p in STOP_LABELS if p not in drop_stops] + list(extra_stops)
    # Stops anchor at line start so a label word inside prose never ends a capture.
    stop_re = re.compile(r"(?m)^\s*(?:" + "|".join(f"(?:{p})" for p in pats) + ")", re.I)
    em = stop_re.search(sub)
    return (sub[:em.start()] if em else sub).strip()


def _para(block: str, *, limit: int = 600,
          drop=r"^(Yes|No|Yes\s*✓|✓|Explain further|If so,?\s*please explain|N/?A|None|None known)\b") -> str:
    """One clean paragraph from a block, minus Yes/No/Explain tokens."""
    kept = [l.strip() for l in (block or "").split("\n")
            if l.strip() and not re.match(drop, l.strip(), re.I)
            and not re.match(r"^(Page|OhioISP|ISP Span|Effective Date|Waiver|HCBS)", l.strip(), re.I)]
    return re.sub(r"\s+", " ", " ".join(kept)).strip()[:limit]


def _is_empty(v) -> bool:
    if v is None or v == "":
        return True
    if isinstance(v, (list, dict)) and len(v) == 0:
        return True
    return False


def prune_empty(obj):
    """Drop empty values + the internal fullText/_metadata/_source keys (JS pruneEmpty)."""
    if isinstance(obj, list):
        out = []
        for it in (prune_empty(x) for x in obj):
            if _is_empty(it):
                continue
            out.append(it)
        return out
    if isinstance(obj, dict):
        new = {}
        for k, v in obj.items():
            if k in ("fullText", "_metadata", "_source"):
                continue
            pv = prune_empty(v)
            if _is_empty(pv):
                continue
            new[k] = pv
        return new
    return obj


# ─────────────────────────── top-level extractors ───────────────────────────

_ADDR_LABELS = (r"^(City,?\s*State,?\s*Zip|City|County|Phone|State|Zip|Email|Status|Medicaid|"
                r"DODD|Sex|Date of Birth|Best Way|Primary|OhioISP|ISP Span|Effective)\b")


def _grab_address(text: str) -> str:
    """Address, including a wrapped 'NW'/'Apt 8' continuation line; never a form label."""
    m = re.search(r"(?m)^Address\s*:?\s*(.*)$", text, re.I)
    if not m:
        return ""
    parts = []
    first = m.group(1).strip()
    if first and not re.match(_ADDR_LABELS, first, re.I):
        parts.append(first)
    for ln in text[m.end():].split("\n")[1:4]:
        s = ln.strip()
        if not s:
            continue
        if re.match(_ADDR_LABELS, s, re.I):
            break
        if re.match(r"^(NW|NE|SW|SE|N|S|E|W|Apt\b|#|Suite|Unit|Lot|\d)", s, re.I) or re.search(r",\s*(OH|Ohio)\b", s, re.I):
            parts.append(s)
            continue
        break
    return re.sub(r"\s+", " ", " ".join(parts)).strip(" ,")


def extract_individual(text: str) -> dict:
    r = {"name": "", "dateOfBirth": "", "address": "", "county": "", "phone": "",
         "sex": "", "medicaidNumber": "", "email": "", "doddNumber": "",
         "bestWayToConnect": "", "moreDetail": ""}
    m = re.search(r"^OhioISP\s*-\s*(.+?)(?:\n|Page)", text, re.I | re.M)
    if m: r["name"] = m.group(1).strip()
    m = re.search(r"Date of Birth:\s*(.+?)(?:\n|Sex:|Address:|$)", text, re.I)
    if m: r["dateOfBirth"] = m.group(1).strip()
    r["address"] = _grab_address(text)
    m = re.search(r"County:\s*(.+?)(?:\n|Phone:|$)", text, re.I)
    if m:
        c = m.group(1).strip()
        if not re.match(r"^(Email|Phone|City|State|Zip|Status|Medicaid|DODD|Sex)\b", c, re.I):
            r["county"] = c
    m = re.search(r"Phone:\s*(.+?)(?:\n|Status:|$)", text, re.I)
    if m: r["phone"] = m.group(1).strip()
    m = re.search(r"Sex:\s*(Male|Female)", text, re.I)
    if m: r["sex"] = m.group(1).strip()
    m = re.search(r"Medicaid\s*#?:\s*(\d+)", text, re.I)
    if m: r["medicaidNumber"] = m.group(1).strip()
    m = re.search(r"Email:\s*([^\s\n]+@[^\s\n]+)", text, re.I)
    if m: r["email"] = m.group(1).strip()
    m = re.search(r"DODD\s*#?:\s*(\d+)", text, re.I)
    if m: r["doddNumber"] = m.group(1).strip()
    return r


def extract_isp_dates(text: str) -> dict:
    r = {"start": "", "end": "", "effectiveDate": ""}
    m = re.search(r"ISP Span Dates:\s*(.+?)\s*-\s*(.+?)(?:\n|Effective)", text, re.I)
    if m:
        r["start"] = m.group(1).strip()
        r["end"] = m.group(2).strip()
    m = re.search(r"Effective Date:\s*(.+?)(?:\n|$)", text, re.I)
    if m: r["effectiveDate"] = m.group(1).strip()
    return r


def _block_list(body, start_pat, *, extra_stops=()):
    """Bounded narrative block → its non-empty lines."""
    blk = _block(body, start_pat, extra_stops=extra_stops)
    return _lines(blk)


def extract_important_to(body):
    return _block_list(body, r"(?m)^Important To\s*:?\s*$|^Important To\s*:")

def extract_great_things(body):
    return _block_list(body, r"(?m)^Great Things About\s*:?")

def extract_important_for(body):
    return _block_list(body, r"(?m)^Important For\b[^\n]*:?")

def extract_need_to_know(body):
    return _block_list(body, r"(?m)^Need to Know to Support\s*:?")


# ─────────────────────────── HEALTHY LIVING ───────────────────────────

def extract_healthy_living(body: str) -> dict:
    r = {"physicalHealthConditions": [], "hospitalRecently": "", "hospitalExplanation": "",
         "allergies": "", "medications": "", "medicalEquipment": "", "seizureInfo": "",
         "visionHearing": "", "mobilityInfo": ""}

    blk = _block(body, r"What physical/health conditions/concerns should people know about\??",
                 extra_stops=(r"Allergies\b",))
    if not blk:
        blk = _block(body, r"(?m)^Diagnoses\b")
    if blk:
        r["physicalHealthConditions"] = [l for l in _lines(blk, minlen=3)
                                         if not re.match(r"^(Yes|No)[\s\d]*$", l, re.I)][:25]

    m = re.search(r"Has the person been to the hospital recently\?\s*\n?\s*(Yes|No)", body, re.I)
    if m: r["hospitalRecently"] = m.group(1)

    # Kept only when it reads like an allergy statement: the label often heads a bleeding table.
    blk = _block(body, r"(?m)^(?:Known\s+)?Allergies\s*:?",
                 extra_stops=(r"Medications\b", r"Primary Care", r"Medical Provider", r"Diagnoses\b"))
    para = _para(blk, limit=240)
    if para:
        if re.match(r"^(no known|none|nkda|no\b)", para, re.I):
            r["allergies"] = "None known"
        elif (len(para) < 200 and re.search(
                r"\b(allerg|sulfa|iodine|codeine|morphine|penicillin|bee|peanut|nut|latex|"
                r"seasonal|environmental|pollen|shellfish|dairy|gluten|detergent|sensitiv)\b", para, re.I)):
            r["allergies"] = para

    # Both medication questions as one narrative; drug names live in the MAR, not the ISP.
    blk = _block(body, r"Does the person take medication\??",
                 drop_stops=(r"Does the person\b",),
                 extra_stops=(r"Does the person require support", r"What kinds of food",
                              r"Nutrition\b", r"Getting Around", r"Self-Administration Assessment"))
    if blk:
        blk = re.sub(r"Does the person need help with medication\?.*?(?=\n)", "", blk, flags=re.I)
        med = _para(blk, limit=600)
        if med and len(med) > 4:
            r["medications"] = med

    blk = _block(body, r"(?m)^Seizure[s]?\b\s*:?|Seizure (?:Action |Care)?Plan",
                 extra_stops=(r"Medical Provider", r"Nutrition\b"))
    if blk and re.search(r"seizure", blk, re.I):
        r["seizureInfo"] = _para(blk, limit=500)

    blk = _block(body, r"Does the person safely and reliably get around\??",
                 drop_stops=(r"Does the person\b",),
                 extra_stops=(r"Do they require", r"Assistive/adaptive equipment used",
                              r"Are there certain areas"))
    if blk:
        r["mobilityInfo"] = _para(blk, limit=500)

    blk = _block(body, r"Assistive/adaptive equipment used\s*:?")
    if not blk:
        blk = _block(body, r"Do they require supports,? adaptive equipment[^\n]*")
    if blk:
        # Drops the wrapped question remnant.
        blk = re.sub(r"^\s*(?:etc\.?\??|technology,?|modifications,?|or\b)\s*", "", blk, flags=re.I)
        eq = _para(blk, limit=400, drop=r"^(Yes|No|N/?A|None needed|etc\.?\??|.*\?)$")
        if (eq and not re.match(r"^(no\b|none\b)", eq, re.I)) or re.search(
                r"wheelchair|walker|cane|lift|bar|chair|tube|oxygen|hearing|glasses|brace|splint|alarm|ramp", eq or "", re.I):
            r["medicalEquipment"] = eq

    if re.search(r"vision impair|legally blind|\bblind\b", body, re.I):
        m = re.search(r"([^\n.]*(?:vision impair|legally blind|\bblind\b)[^\n.]*)", body, re.I)
        if m: r["visionHearing"] = m.group(1).strip()[:200]
    return r


# ─────────────────────────── NUTRITION ───────────────────────────

def extract_nutrition(body: str) -> dict:
    r = {"specialDiet": "", "dietType": "", "dietDetails": "", "textureModification": "",
         "fluidConsistency": "", "foodPreferences": "", "foodDislikes": "", "mealSupport": "",
         "mealSupportDetails": "", "chokingRisk": "", "feedingNotes": ""}

    m = re.search(r"Does the person need any special food or follow any kind of diet\?\s*\n?\s*(Yes|No)", body, re.I)
    if m: r["specialDiet"] = m.group(1)
    dd = _para(_block(body, r"Does the person need any special food[^?\n]*\?",
                      drop_stops=(r"Does the person\b",),
                      extra_stops=(r"What kinds of food", r"Does the person require support")), limit=500)
    if dd:
        r["dietDetails"] = dd
        if re.search(r"mechanical soft", dd, re.I): r["dietType"] = "Mechanical soft"
        elif re.search(r"pureed", dd, re.I): r["dietType"] = "Pureed Diet"
        elif re.search(r"diabetic", dd, re.I): r["dietType"] = "Diabetic Diet"
        elif re.search(r"g[\s-]?tube|tube feed", dd, re.I): r["dietType"] = "G-tube feeds"
        elif re.search(r"lactose|lactaid", dd, re.I): r["dietType"] = "Lactose-intolerant"
        elif re.search(r"\bsoft\b", dd, re.I): r["dietType"] = "Soft Diet"
        if re.search(r"pudding", dd, re.I): r["textureModification"] = "Pudding consistency"
        elif re.search(r"pureed", dd, re.I): r["textureModification"] = "Pureed"
        elif re.search(r"chopped|quarter", dd, re.I): r["textureModification"] = "Chopped / quarter-sized"
        if re.search(r"thickened liquid", dd, re.I): r["fluidConsistency"] = "Thickened liquids"
        elif re.search(r"thin liquid", dd, re.I): r["fluidConsistency"] = "Thin liquids"
    # The audit expects a value, not a blank.
    if not r["dietType"] and r["specialDiet"]:
        r["dietType"] = "Special diet" if r["specialDiet"].lower() == "yes" else "No special diet"

    likes = _block(body, r"What kinds of food does the person typically like to eat\??",
                   drop_stops=(r"Does the person\b",),
                   extra_stops=(r"Does the person require support",))
    likes = _para(likes, limit=400)
    if likes:
        r["foodPreferences"] = likes
        dm = re.search(r"((?:dislike|does not (?:like|care for)|except|avoids?|no )[^.\n]{0,160}\.?)", likes, re.I)
        if dm: r["foodDislikes"] = dm.group(1).strip()[:200]

    m = re.search(r"Does the person require support before, during, and/or after a mealtime\?\s*\n?\s*(Yes|No)", body, re.I)
    if m: r["mealSupport"] = m.group(1)
    md = _para(_block(body, r"Does the person require support before, during, and/or after a mealtime\??",
                      drop_stops=(r"Does the person\b",),
                      extra_stops=(r"What does a healthy lifestyle", r"Wellness\b", r"What kinds of food")), limit=600)
    if md:
        r["mealSupportDetails"] = md
        r["feedingNotes"] = md
        if re.search(r"chok", md, re.I): r["chokingRisk"] = "Yes"
    return r


# ─────────────────────────── other assessment areas ───────────────────────────

def extract_communication(text):
    r = {"expressiveCommunication": "", "receptiveCommunication": "",
         "communicationDevices": [], "communicationTips": [], "fullText": ""}
    m = re.search(r"Communication\s*([\s\S]+?)(?=Advocacy|Safety|Social|Daily Life|ISP Span|$)", text, re.I)
    if m:
        r["fullText"] = m.group(1).strip()
        em = re.search(r"[Ee]xpress(?:ive|es)?[:\s]*([^\n]+)", m.group(1))
        if em: r["expressiveCommunication"] = em.group(1).strip()
        rm = re.search(r"[Rr]eceptive|[Uu]nderstand[:\s]*([^\n]+)", m.group(1))
        if rm and rm.lastindex: r["receptiveCommunication"] = (rm.group(1) or "").strip()
    return r


def extract_advocacy(text):
    r = {"guardian": "", "guardianContact": "", "decisionMaking": "", "rights": [], "fullText": ""}
    m = re.search(r"Advocacy.*Engagement\s*([\s\S]+?)(?=Safety|Social|Daily Life|ISP Span|$)", text, re.I)
    if m:
        r["fullText"] = m.group(1).strip()
        gm = re.search(r"[Gg]uardian[:\s]*([^\n]+)", m.group(1))
        if gm: r["guardian"] = gm.group(1).strip()
    return r


def extract_safety(body):
    r = {"supervisionLevel": "", "canBeAlone": "", "safetyRisks": "", "emergencyResponse": "",
         "fallRisk": "", "elopementRisk": ""}

    # Preamble and generic level list stripped, leaving the assigned supervision.
    sup_blk = _block(body, r"Supervision Considerations")
    sup_blk = re.sub(r"SSA/QIDP Only:[^\n]*", "", sup_blk, flags=re.I)
    sup_blk = re.sub(r"What are the results of applicable pre-assessments\?[^\n]*", "", sup_blk, flags=re.I)
    sup_blk = re.sub(r"What is the recommended (?:level of )?supervision[^\n]*\??", "", sup_blk, flags=re.I)
    sup_blk = re.sub(r"Levels of Supervision and Definitions[\s\S]*?(?=(?:Close and Constant|Auditory|Visual|General|24[\s/-]?hour|No alone)\b)",
                     "", sup_blk, flags=re.I)
    sup = _para(sup_blk, limit=450)
    if not sup:
        m = re.search(r"([^\n.]{0,80}(?:close and constant|auditory|visual|general|24[\s/-]?hour|no alone time)[^\n.]{0,120}\.?)",
                      body, re.I)
        if m: sup = m.group(1).strip()[:300]
    if sup:
        r["supervisionLevel"] = sup

    am = re.search(r"(can|cannot|can not|no)\s+(?:be\s+)?(?:left\s+)?(?:home\s+)?alone", body, re.I)
    if am: r["canBeAlone"] = "No" if re.search(r"cannot|can not|^no$", am.group(1), re.I) else "Yes"
    if re.search(r"fall(?:ing)?\s*risk|risk\s*of\s*fall|fall\s*risk", body, re.I): r["fallRisk"] = "Yes"
    if re.search(r"elopement|elope|wander", body, re.I):
        r["elopementRisk"] = "No" if re.search(r"no\s*(?:elopement|history of elope)", body, re.I) else "Yes"

    # The first occurrence is the blank template: keep the remainder only if it reads like real risks.
    risk = _block(body, r"(?m)^Known and Likely Risks\b")
    risk = re.sub(r"Include (?:and )?MUI trends[\s\S]*?plan\.\s*", "", risk, flags=re.I)
    risk = re.sub(r"Levels of Supervision and Definitions[\s\S]*", "", risk, flags=re.I)
    risk = _para(risk, limit=700)
    legend_like = re.match(r"^[\d.\s]*(?:None|General|Visual|Close|Auditory|Awake|Staff)", risk, re.I)
    if risk and len(risk) > 12 and not legend_like:
        r["safetyRisks"] = risk
    return r


def extract_social(text):
    r = {"socialActivities": [], "relationships": [], "spiritualBeliefs": "",
         "churchAttendance": "", "hobbies": [], "fullText": ""}
    m = re.search(r"Social\s*(?:&|and)?\s*Spirituality\s*([\s\S]+?)(?=Daily Life|School|Finance|Community|ISP Span|$)", text, re.I)
    if m:
        block = m.group(1)
        r["fullText"] = block.strip()
        cm = re.search(r"[^\n]*(?:church|worship|religious|spiritual)[^\n]*", block, re.I)
        if cm: r["churchAttendance"] = cm.group(0).strip()
        r["hobbies"] = [l.strip() for l in block.split("\n")
                        if re.search(r"music|sports|watching|listening|reading|games|activities", l, re.I)]
    return r


def extract_daily_life(text):
    r = {"employmentStatus": "", "employer": "", "dayProgram": "", "schedule": "",
         "transportationNeeds": "", "adlSupport": [], "fullText": ""}
    m = re.search(r"Daily Life\s*(?:&|and)?\s*Employment\s*([\s\S]+?)(?=School|Finance|Community|Social|ISP Span|$)", text, re.I)
    if m:
        block = m.group(1)
        r["fullText"] = block.strip()
        dm = re.search(r"day\s*(?:program|care|services?)[:\s]*([^\n]+)", block, re.I)
        if dm: r["dayProgram"] = dm.group(1).strip()
        tm = re.search(r"transport(?:ation)?[:\s]*([^\n]+)", block, re.I)
        if tm: r["transportationNeeds"] = tm.group(1).strip()
    return r


def extract_school(text):
    r = {"currentlyInSchool": "", "schoolName": "", "gradeLevel": "", "specialEducation": "", "fullText": ""}
    m = re.search(r"School\s*(?:and|&)?\s*Education\s*([\s\S]+?)(?=Finance|Community|Social|Daily|ISP Span|$)", text, re.I)
    if m:
        r["fullText"] = m.group(1).strip()
        im = re.search(r"(?:Is the person )?currently in school\??\s*(Yes|No)", m.group(1), re.I)
        if im: r["currentlyInSchool"] = im.group(1)
    return r


def extract_finance(text):
    r = {"makesMoney": "", "incomeSource": [], "receivesBenefits": "", "benefitsList": [],
         "payee": "", "moneyControl": "", "fullText": ""}
    m = re.search(r"Finance\s*([\s\S]+?)(?=Community|Social|Safety|Daily|ISP Span|$)", text, re.I)
    if m:
        block = m.group(1)
        r["fullText"] = block.strip()
        mm = re.search(r"Does the person make money\??\s*(Yes|No)", block, re.I)
        if mm: r["makesMoney"] = mm.group(1)
        bm = re.search(r"Does the person receive any benefits\??\s*(Yes|No)", block, re.I)
        if bm: r["receivesBenefits"] = bm.group(1)
        bt = re.findall(r"(SSI|SSDI|food stamps|Medicaid|Medicare|Social Security)", block, re.I)
        if bt:
            seen = []
            for x in bt:
                if x not in seen: seen.append(x)
            r["benefitsList"] = seen
        pm = re.search(r"payee[:\s]*([^\n]+)", block, re.I)
        if pm: r["payee"] = pm.group(1).strip()
        cm = re.search(r"What control does the person have[^?]*\??\s*([\s\S]+?)(?=\n\n|Does|$)", block, re.I)
        if cm: r["moneyControl"] = cm.group(1).strip()
    return r


def extract_community_living(text):
    r = {"livingArrangement": "", "provider": "", "livesWithWhom": [], "homeNeeds": [], "fullText": ""}
    m = re.search(r"Community Living\s*([\s\S]+?)(?=Skills|Known Risks|Outcomes|Services|ISP Span|$)", text, re.I)
    if m:
        block = m.group(1)
        r["fullText"] = block.strip()
        pm = re.search(r"provider[:\s]*([^\n]+)", block, re.I)
        if pm: r["provider"] = pm.group(1).strip()
        r["homeNeeds"] = [i.strip() for i in re.findall(r"It is important[^\n]+", block, re.I)]
    return r


def extract_skills(text):
    r = {"selfAdministration": "", "personalHygiene": [], "mobility": "", "eating": "",
         "dressing": "", "bathing": "", "toileting": "", "fullText": ""}
    m = re.search(r"Skills\s*(?:and|&)?\s*Abilities\s*([\s\S]+?)(?=Known Risks|Outcomes|Services|ISP Span|$)", text, re.I)
    if m:
        r["fullText"] = m.group(1).strip()
        sm = re.search(r"self.?admin[:\s]*([^\n]+)", m.group(1), re.I)
        if sm: r["selfAdministration"] = sm.group(1).strip()
    return r


def extract_known_risks(text):
    r = {"risks": [], "mitigationStrategies": [], "fullText": ""}
    m = re.search(r"Known Risks\s*([\s\S]+?)(?=Outcomes|Services|Informed Consent|Team|ISP Span|$)", text, re.I)
    if m:
        r["fullText"] = m.group(1).strip()
        r["risks"] = _lines(m.group(1), minlen=5)
    return r


def extract_outcomes(text):
    r = {"summaryOfProgress": [], "outcomes": [], "fullText": ""}
    m = re.search(r"Outcomes\s*(?:and|&)?\s*Experiences\s*([\s\S]+?)(?=Services|Informed Consent|Team|ISP Span|$)", text, re.I)
    if m:
        r["fullText"] = m.group(1).strip()
        for gm in re.finditer(r"(?:goal|outcome)[:\s]*([^\n]+)", m.group(1), re.I):
            r["outcomes"].append({"goal": gm.group(1).strip()})
    return r


# ─────────────────────────── services / consent / signatures ───────────────────────────

def _parse_funding_block(block_text, out):
    lines = [l.strip() for l in block_text.split("\n") if l.strip()]
    cur = {}
    def push():
        nonlocal cur
        if cur:
            out.append(dict(cur)); cur = {}
    for ln in lines:
        if re.search(r"individual options waiver", ln, re.I):
            cur["funding"] = (cur.get("funding") or []) + [ln]
        elif re.search(r"daily life & employment|communication|advocacy|safety &|social &|healthy living|homemaker personal care|adult day support|non-medical transportation|residential respite", ln, re.I):
            if cur: push()
            cur["sectionLabel"] = ln
        elif re.search(r"^Shared\s+Living|^Adult Day\s+Support|^Homemaker\s+Personal\s+Care|^Non-Medical\s+Transportation|^Residential\s+Respite", ln, re.I):
            push(); cur["serviceType"] = ln
        elif re.search(r"^\d+/\d+/\d{4}\s*-\s*\d+/\d+/\d{4}", ln) or re.search(r"\w+\s+\d{1,2},\s*\d{4}\s*-\s*\w+\s+\d{1,2},\s*\d{4}", ln):
            cur["dates"] = ln
        elif re.search(r"^\d+\s*x\s+a\s+month|^weekly|^monthly|^daily|^other|\banytime\b", ln, re.I):
            cur.setdefault("schedule", []).append(ln)
        elif re.search(r"^Who is Responsible", ln, re.I):
            cur["whoIsResponsible"] = re.sub(r"^Who is Responsible\s*", "", ln, flags=re.I).strip()
        elif re.search(r"^Assessment Area:", ln, re.I):
            cur["assessmentArea"] = re.sub(r"^Assessment Area:\s*", "", ln, flags=re.I).strip()
        elif re.search(r"^Service\s+Name:", ln, re.I):
            cur["serviceName"] = re.sub(r"^Service\s+Name:\s*", "", ln, flags=re.I).strip()
        elif re.search(r"^Scope of Service", ln, re.I):
            cur["scopeOfService"] = re.sub(r"^Scope of Service[^:]*:\s*", "", ln, flags=re.I).strip()
        elif re.search(r"^How often", ln, re.I):
            cur["howOften"] = re.sub(r"^How often[^?]*\?\s*", "", ln, flags=re.I).strip()
        elif re.search(r"^Begin Date", ln, re.I):
            cur["dates"] = re.sub(r"^Begin Date[^:]*:\s*", "", ln, flags=re.I).strip()
        else:
            cur["scopeOfService"] = (cur["scopeOfService"] + " " + ln) if cur.get("scopeOfService") else ln
    push()


def extract_services(text):
    out = []
    for m in re.finditer(r"Funding Source:\s*([\s\S]+?)(?=(?:Funding Source:|ISP Span Dates:|OhioISP|$))", text, re.I):
        _parse_funding_block(m.group(1).strip(), out)
    pm = re.search(r"Paid Supports:\s*([\s\S]+?)(?=ISP Span Dates:|OhioISP|$)", text, re.I)
    if pm:
        _parse_funding_block(pm.group(1).strip(), out)
    return out


def extract_informed_consent(text):
    out = []
    last_q = None
    for line in [l.strip() for l in text.split("\n") if l.strip()]:
        if line in ("Yes ✔", "Yes ✓"):
            if last_q:
                out.append({"question": last_q, "answer": "Yes"}); last_q = None
        elif line.endswith("Yes ✔") or line.endswith("Yes ✓"):
            idx = line.rfind("Yes")
            qpart = line[:idx].strip().rstrip(".:")
            if qpart:
                out.append({"question": qpart, "answer": "Yes"}); last_q = None
            elif last_q:
                out.append({"question": last_q, "answer": "Yes"}); last_q = None
        else:
            last_q = line
    return out


def extract_team_signatures(text):
    out = []
    bm = re.search(r"All Team Members: By signing below([\s\S]+?)(?=ISP Span Dates:|$)", text, re.I)
    if not bm:
        return out
    lines = [l.strip() for l in bm.group(1).strip().split("\n") if l.strip()]
    cur = {}
    def push():
        nonlocal cur
        if cur:
            out.append(dict(cur)); cur = {}
    for ln in lines:
        if re.match(r"^\d{2}/\d{2}/\d{4}$", ln):
            if not cur.get("date"): cur["date"] = ln
            else: push(); cur["date"] = ln
        elif re.search(r"Yes\s*[✔✓]\s*Signed by Team Member", ln, re.I):
            cur["signatureYes"] = True
        elif re.search(r"Name/Relationship:", ln, re.I) or re.search(r"Signature of Approval", ln, re.I) or re.match(r"^Date:", ln, re.I):
            continue
        elif re.search(r"\b(Person Supported|Guardian|Home Provider|Day Provider|Other|Case Manager)\b", ln, re.I):
            push()
            parts = ln.split()
            cur["name"] = " ".join(parts[:-1])
            cur["role"] = parts[-1]
        elif re.search(r"\s", ln) and len(ln.split()) <= 4:
            push(); cur["name"] = ln
        elif ln in ("Yes", "Yes ✔", "Yes ✓"):
            cur["signatureYes"] = True
        else:
            if re.match(r"^(Guardian|Other|Case Manager|Day Provider|Home Provider)$", ln, re.I):
                cur["role"] = ln
            elif re.search(r"\b(Guardian|Provider|Manager|Supported|LLC)\b", ln, re.I):
                push(); cur["name"] = ln; cur["role"] = "TeamMember"
            else:
                cur["name"] = (cur["name"] + " " + ln) if cur.get("name") else ln
    push()
    return out


# ─────────────────────────── main API ───────────────────────────

def parse_isp_text(text: str, *, prune: bool = True) -> dict:
    """ISP text → structured dict by deterministic regex; no model."""
    text = _clean_lines(text)
    # Individual and date fields read the raw text: they anchor on the page furniture.
    body = _defurniture(text)
    result = {
        "individual": extract_individual(text),
        "ispSpanDates": extract_isp_dates(text),
        "importantTo": extract_important_to(body),
        "greatThingsAbout": extract_great_things(body),
        "importantFor": extract_important_for(body),
        "needToKnowToSupport": extract_need_to_know(body),
        "assessmentAreas": {
            "healthyLiving": extract_healthy_living(body),
            "nutrition": extract_nutrition(body),
            "communication": extract_communication(text),
            "advocacyEngagement": extract_advocacy(text),
            "safetySecurity": extract_safety(body),
            "socialSpirituality": extract_social(text),
            "dailyLifeEmployment": extract_daily_life(text),
            "schoolEducation": extract_school(text),
            "finance": extract_finance(text),
            "communityLiving": extract_community_living(text),
        },
        "skillsAndAbilities": extract_skills(text),
        "knownRisks": extract_known_risks(text),
        "outcomesAndExperiences": extract_outcomes(text),
        "servicesAndSupports": extract_services(text),
        "informedConsent": extract_informed_consent(text),
        "teamSignatures": extract_team_signatures(text),
    }
    return prune_empty(result) if prune else result


_PDF_LOCK = threading.Lock()


def pdf_text(raw: bytes) -> str:
    """A plan's pages, form-feed separated (the relay's _isp_from_pdf); MuPDF is not safe across documents in
    parallel, so one document is open at a time."""
    import fitz  # noqa: PLC0415 - loaded only when a plan is read
    with _PDF_LOCK, fitz.open(stream=raw, filetype="pdf") as doc:
        return "\f".join(p.get_text() for p in doc)


# ── The projection onto the seventeen flat fields (not part of the copied parser) ──

# The form's own prompts, picked up when a section is left blank, are never the person's data.
_PROMPT = re.compile(
    r'^\s*(include any|consider |describe |list any|list the|explain |identify |'
    r'indicate |provide |note any|does the person|is the person|if yes|if no|'
    r'what (is|are|does)|how (does|will)|please )', re.I)

def _isprompt(s):
    return bool(_PROMPT.match(str(s or '')))

def _b(v):
    if isinstance(v, list):
        return [str(x).strip() for x in v if str(x).strip() and not _isprompt(x)]
    s = str(v or '').strip()
    return [s] if s and not _isprompt(s) else []

def _s(v):
    s = str(v or '').strip()
    return '' if _isprompt(s) else s

def flatten(d):
    ind = d.get('individual') or {}
    span = d.get('ispSpanDates') or {}
    aa = d.get('assessmentAreas') or {}
    hl = aa.get('healthyLiving') or {}
    nu = aa.get('nutrition') or {}
    co = aa.get('communication') or {}
    ss = aa.get('safetySecurity') or {}
    ae = aa.get('advocacyEngagement') or {}
    sk = d.get('skillsAndAbilities') or {}
    kr = d.get('knownRisks') or {}
    oe = d.get('outcomesAndExperiences') or {}
    dl = aa.get('dailyLifeEmployment') or {}

    year = ''
    if span.get('start') or span.get('end'):
        year = '%s - %s' % (span.get('start',''), span.get('end',''))
        if span.get('effectiveDate'):
            year += ' (Effective Date: %s)' % span['effectiveDate']

    diet = _b(nu.get('dietType')) + _b(nu.get('dietDetails')) + \
           _b(nu.get('textureModification')) + _b(nu.get('fluidConsistency')) + \
           _b(nu.get('foodPreferences')) + _b(nu.get('foodDislikes')) + \
           _b(nu.get('mealSupportDetails')) + _b(nu.get('chokingRisk'))

    safety = _b(ss.get('safetyRisks')) + _b(ss.get('emergencyResponse'))
    if str(ss.get('fallRisk','')).strip().lower() == 'yes': safety.append('Fall risk: yes')
    if str(ss.get('elopementRisk','')).strip().lower() == 'yes': safety.append('Elopement risk: yes')
    safety += _b(kr.get('risks')) + _b(kr.get('mitigationStrategies'))

    med = _b(hl.get('medications')) + _b(hl.get('medicalEquipment')) + \
          _b(hl.get('seizureInfo')) + _b(hl.get('visionHearing'))
    if str(hl.get('hospitalRecently','')).strip():
        med.append('Hospitalised recently: %s' % hl['hospitalRecently'])
    med += _b(hl.get('hospitalExplanation'))

    care = _b(sk.get('personalHygiene')) + _b(sk.get('bathing')) + _b(sk.get('dressing')) + \
           _b(sk.get('toileting')) + _b(sk.get('eating')) + _b(sk.get('selfAdministration')) + \
           _b(dl.get('adlSupport'))

    contacts = {}
    if ae.get('guardian'): contacts['guardian'] = ae['guardian']
    if ae.get('guardianContact'): contacts['guardian'] = \
        (contacts.get('guardian','') + ' ' + str(ae['guardianContact'])).strip()

    return {
        'client_name':       str(ind.get('name') or '').strip(),
        'isp_year':          year,
        'diagnoses':         _b(hl.get('physicalHealthConditions')),
        'medications':       med,
        'allergies':         _b(hl.get('allergies')),
        'diet_nutrition':    diet,
        'goals_outcomes':    _b(oe.get('outcomes')) + _b(oe.get('summaryOfProgress')),
        'behaviors':         _b(kr.get('fullText')),
        'safety_risks':      safety,
        'supervision_level': _s(ss.get('supervisionLevel')),
        'communication':     _s(co.get('fullText')) or _s(co.get('expressiveCommunication')),
        'mobility':          _s(hl.get('mobilityInfo')) or _s(sk.get('mobility')),
        'personal_care':     care,
        'medical_summary':   ' '.join(_b(hl.get('physicalHealthConditions'))
                                      + _b(hl.get('medications'))).strip(),
        'important_to':      _b(d.get('importantTo')),
        'important_for':     _b(d.get('importantFor')) + _b(d.get('needToKnowToSupport')),
        'contacts':          contacts,
    }
