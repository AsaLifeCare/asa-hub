"""Books (Books.gs) on Python behind its switch (`books`): the shelf (`books`, the books tab) and each title's stored
text (`booksText`, the books_text tab) kept in Postgres once uploaded; every file the shelf holds kept on the server in
the documents folder (books/<Drive id>/) and filed in Drive as the platform's account in ASA Hub — Books, where the
shelf's link opens it. The shelf's generic list and get, booksRead, and the slow halves of the writes the relay asks
first (BACKEND_WRITE_PREPARE: booksFetchPrepare, booksMinePrepare, booksHarvestPrepare, booksFileUploadPrepare — the
publishers fetched, the model asked, the files filed and their PDFs read) are here; the writes are in
app/books_writes.py."""
from __future__ import annotations

import base64
import binascii
import html
import json
import logging
import os
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Callable

import requests

import candidates as CND
import drive as dr
import drive_files as DF
import gsjs
import hubdb
import locations as L
import resource_rows as RR
import sheet_resources as SR
from scope import Defer

log = logging.getLogger("asa-hub-app")

APP_ID = "books"
RESOURCE, TEXT = "books", "booksText"
TEXT_HEADER = ("bookId", "title", "via", "ord", "text")
FOLDER = "ASA Hub — Books"
INDEX_DOC = "ASA Hub — Books — index"
KEPT_DIR = "books"
MAX_BYTES = 40 * 1024 * 1024
READ_PDF_MAX = 15 * 1024 * 1024
# booksFileUpload: ~15MB decoded (base64 carries 4/3 of the bytes)
B64_MAX = 21000000
# UrlFetchApp's own ceiling on an answer
FETCH_CAP = 50 * 1024 * 1024
# a pass stops before the relay's wait for its read (BACKEND_PREPARE_TIMEOUT_S, 110 s) runs out
RUN_S = float(os.getenv("HUB_BOOKS_RUN_S", "85"))
FETCH_TIMEOUT_S = 30.0
CACHE_S = 21600.0
PDF_TEXT_MAX = 90000
TEXT_MAX = 8000
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 "
      "Safari/537.36")
# what UrlFetchApp says it is when a fetch names no agent
UA_PLAIN = "Mozilla/5.0 (compatible; Google-Apps-Script)"
AI_REQUEST = "ai_book_licence"
DENIED = {"status": 403, "message": "Requires an admin or manager account"}
_WS = re.compile(r"[\s﻿]+")
_UNSAFE_NAME = re.compile(r'[\\/:*?"<>|]+')

s_ = gsjs.str_

# Sources must serve static text to a plain fetch. SAMHSA: NCBI Bookshelf chapter urls, never NBK record pages.
CATALOGUE: tuple[dict[str, str], ...] = (
    {"title": "The Caregiver's Handbook", "author": "National Institute on Aging (NIH)", "subject": "Caregiving",
     "licence": "Public domain — work of the US federal government",
     "source": "https://order.nia.nih.gov/sites/default/files/2023-03/caregivers-handbook-nia_0.pdf",
     "home": "https://order.nia.nih.gov/publication/caregivers-handbook",
     "summary": "The whole of day-to-day care in one place: daily living, safety at home, medications, working with "
                "doctors, money and legal papers, and looking after the person doing the caring.",
     "why": "The closest thing to a manual for what a DSP does on a shift, written for people with no clinical "
            "training."},
    {"title": "Caring for a Person With Alzheimer's Disease", "author": "National Institute on Aging (NIH)",
     "subject": "Dementia", "licence": "Public domain — work of the US federal government",
     "source": "https://order.nia.nih.gov/sites/default/files/2024-03/caring-for-a-Person-with-alzheimers-disease.pdf",
     "home": "https://order.nia.nih.gov/publication/caring-for-a-person-with-alzheimers-disease",
     "summary": "What changes as dementia progresses, how to handle bathing, dressing, eating and wandering, and what "
                "to do about the behaviours families find hardest.",
     "why": "Our houses hold people ageing into dementia; the behaviour chapters are the ones staff ask about most."},
    {"title": "Caregiver skills training for families of children with developmental delays or disabilities — "
              "adaptation and implementation guide",
     "author": "World Health Organization", "subject": "Developmental disability", "licence": "CC BY-NC-SA 3.0 IGO",
     "source": "https://iris.who.int/bitstream/handle/10665/353581/9789240048850-eng.pdf?sequence=1",
     "home": "https://iris.who.int/handle/10665/353581",
     "summary": "WHO's programme for teaching everyday skills to the people around a person with a developmental "
                "disability — communication, engagement, routines, and managing challenging behaviour without force.",
     "why": "The evidence base under most of what we do, and it is written to be taught by non-specialists."},
    {"title": "TIP 57 — Trauma-Informed Care in Behavioral Health Services", "author": "SAMHSA",
     "subject": "Trauma & behaviour", "licence": "Public domain — work of the US federal government",
     "source": "https://library.samhsa.gov/sites/default/files/sma14-4816.pdf",
     "home": "https://library.samhsa.gov/product/tip-57-trauma-informed-care-behavioral-health-services/sma14-4816",
     "summary": "What trauma does to a person, how it shows up as behaviour years later, and how a service can stop "
                "re-creating it. Includes screening, de-escalation and staff burnout.",
     "why": "Most \"behaviours\" our teams meet have a history behind them; this is the standard reference for "
            "reading one."},
    {"title": "Trauma-Informed Care — Quick Guide for Clinicians", "author": "SAMHSA", "subject": "Trauma & behaviour",
     "licence": "Public domain — work of the US federal government",
     "source": "https://library.samhsa.gov/sites/default/files/sma15-4912.pdf",
     "home": "https://library.samhsa.gov/product/trauma-informed-care-behavioral-health-services-quick-guide-"
             "clinicians-based-tip-57/sma15",
     "summary": "The short form of TIP 57 — the principles, the warning signs and the responses, in a booklet somebody "
                "can read between shifts.",
     "why": "The version people actually finish. Good for a training day."},
    {"title": "Dietary Guidelines for Americans, 2025–2030",
     "author": "USDA & US Department of Health and Human Services", "subject": "Nutrition",
     "licence": "Public domain — work of the US federal government", "source": "https://cdn.realfood.gov/DGA.pdf",
     "home": "https://www.realfood.gov/",
     "summary": "The current federal standard for what to eat, by life stage, with the reasoning behind every "
                "recommendation.",
     "why": "Menu planning and the diet sections of a service plan both answer to this document."},
    {"title": "Anatomy and Physiology 2e", "author": "OpenStax (Rice University)", "subject": "Clinical grounding",
     "licence": "CC BY 4.0", "source": "https://openstax.org/details/books/anatomy-and-physiology-2e",
     "home": "https://openstax.org/details/books/anatomy-and-physiology-2e",
     "summary": "A full college anatomy and physiology course, free to read, print and adapt — including the nutrition "
                "and metabolism chapters.",
     "why": "When somebody asks WHY a medication or a positioning instruction matters, the answer is in here."},
    {"title": "Notes on Nursing: What It Is, and What It Is Not", "author": "Florence Nightingale (1859)",
     "subject": "Caregiving", "licence": "Public domain — published 1859",
     "source": "https://www.gutenberg.org/files/17366/17366-h/17366-h.htm",
     "home": "https://www.gutenberg.org/ebooks/17366",
     "summary": "The founding text on caring for somebody in a room: air, light, noise, food, cleanliness, and the "
                "discipline of actually observing the person in front of you.",
     "why": "A hundred and sixty years old and still the clearest thing ever written about noticing a change in "
            "somebody."},
    {"title": "Crisis Services: Effectiveness, Cost-Effectiveness and Funding Strategies", "author": "SAMHSA",
     "subject": "Crisis response", "licence": "Public domain — work of the US federal government",
     "source": "https://library.samhsa.gov/sites/default/files/sma14-4848.pdf",
     "home": "https://library.samhsa.gov/product/crisis-services-effectiveness-cost-effectiveness-and-funding-"
             "strategies/sma14-4848",
     "summary": "What actually works in a behavioural-health crisis — mobile teams, stabilization beds, warm lines — "
                "and the evidence behind each model.",
     "why": "The reference for why we de-escalate first and hospitalise last."},
    {"title": "TAP 34 — Disaster Planning Handbook for Behavioral Health Programs", "author": "SAMHSA",
     "subject": "Emergency planning", "licence": "Public domain — work of the US federal government",
     "source": "https://library.samhsa.gov/sites/default/files/pep21-02-01-001.pdf",
     "home": "https://library.samhsa.gov/product/tap-34-disaster-planning-handbook-behavioral-health-programs/"
             "pep21-02-01-001",
     "summary": "How a residential program keeps running through a storm, an outbreak or an evacuation — planning "
                "templates, staff roles, and continuity of medication and records.",
     "why": "Our houses cannot close; this is the handbook for the day something tries to close them."},
    {"title": "2025 National Guidelines for a Behavioral Health Coordinated System of Crisis Care",
     "author": "SAMHSA", "subject": "Crisis response", "licence": "Public domain — work of the US federal government",
     "source": "https://library.samhsa.gov/sites/default/files/national-guidelines-crisis-care-pep24-01-037.pdf",
     "home": "https://library.samhsa.gov/product/national-behavioral-health-crisis-care-guidance/pep24-01-037",
     "summary": "The current national standard for crisis care: someone to call, someone to respond, a safe place to "
                "be — and how 988, mobile teams and receiving facilities fit together.",
     "why": "When a crisis call leaves the house, this is the system it enters; staff should know its shape."},
    {"title": "Medication Errors", "author": "MedlinePlus (NIH/NLM)", "subject": "Medication safety",
     "licence": "Public domain — work of the US federal government",
     "source": "https://medlineplus.gov/medicationerrors.html", "home": "https://medlineplus.gov/medicationerrors.html",
     "summary": "What medication errors are, where they happen — wrong drug, wrong dose, wrong time — and the habits "
                "that prevent them at home and in care settings.",
     "why": "Half the incidents a MAR ever records start with one of the mistakes this page prevents."},
    {"title": "Alzheimer's Caregivers", "author": "MedlinePlus (NIH/NLM)", "subject": "Dementia",
     "licence": "Public domain — work of the US federal government",
     "source": "https://medlineplus.gov/alzheimerscaregivers.html",
     "home": "https://medlineplus.gov/alzheimerscaregivers.html",
     "summary": "Day-to-day care in Alzheimer's — communication, bathing, dressing, wandering, agitation — with NIH "
                "guidance for each stage of the disease.",
     "why": "Our houses hold people ageing into dementia; the behaviour questions staff ask most are answered here."},
    {"title": "Caregivers", "author": "MedlinePlus (NIH/NLM)", "subject": "Caregiving",
     "licence": "Public domain — work of the US federal government",
     "source": "https://medlineplus.gov/caregivers.html", "home": "https://medlineplus.gov/caregivers.html",
     "summary": "The whole caregiving job on one page: communicating with the person and their clinicians, help with "
                "daily living, and looking after the person doing the caring.",
     "why": "The static, machine-readable replacement for the walled ACL communication guides."},
    {"title": "Dementia", "author": "MedlinePlus (NIH/NLM)", "subject": "Dementia",
     "licence": "Public domain — work of the US federal government", "source": "https://medlineplus.gov/dementia.html",
     "home": "https://medlineplus.gov/dementia.html",
     "summary": "What dementia is and is not, the conditions that cause it, how it is diagnosed, and what treatment "
                "and support exist.",
     "why": "The plain-language grounding under every dementia care plan our staff read."},
    {"title": "Nutrition for Older Adults", "author": "MedlinePlus (NIH/NLM)", "subject": "Nutrition",
     "licence": "Public domain — work of the US federal government",
     "source": "https://medlineplus.gov/nutritionforolderadults.html",
     "home": "https://medlineplus.gov/nutritionforolderadults.html",
     "summary": "How nutritional needs change with age — fewer calories, more protein and key vitamins — and what a "
                "good plate looks like for an older adult.",
     "why": "Menu planning for our older residents starts here."},
    {"title": "Patient and caregiver perspectives on quality of life in dementia: Evidence from a South Asian "
              "population",
     "author": "Jayakody & Arambepola — PLOS ONE", "subject": "Dementia", "licence": "CC BY 4.0",
     "source": "https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0285701",
     "home": "https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0285701",
     "summary": "What quality of life actually means to people living with dementia and to the people caring for them "
                "— in their own words, side by side.",
     "why": "The person's definition of a good day, not ours, is the care plan's target."},
    {"title": "Factors influencing the caregiver burden for family caregivers of people with moderate-to-severe "
              "dementia: A structural equation modeling analysis",
     "author": "Qi, Ban, Wang et al. — PLOS ONE", "subject": "Caregiving", "licence": "CC BY 4.0",
     "source": "https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0341719",
     "home": "https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0341719",
     "summary": "A structural model of what actually drives caregiver burden in moderate-to-severe dementia, and which "
                "of those pressures are modifiable.",
     "why": "Burnout has causes, not moods; this names the ones a service can act on."},
    {"title": "Facilitating the measurement and treatment of Behavioral and Psychological Symptoms of Dementia "
              "(BPSD) and understanding caregiver burden using wearable devices in Rural Taiwan — Protocol for a "
              "dyadic feasibility pilot study",
     "author": "Guu, Li, Lee et al. — PLOS ONE", "subject": "Dementia", "licence": "CC BY 4.0",
     "source": "https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0342136",
     "home": "https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0342136",
     "summary": "Measuring and treating the behavioural and psychological symptoms of dementia — agitation, sleep "
                "disruption, wandering — and the caregiver burden they create.",
     "why": "BPSD is the hardest part of a dementia shift; this is current evidence on reading it."},
    {"title": "Clinical and behavioural features of SYNGAP1-related intellectual disability: a parent and caregiver "
              "description",
     "author": "Wright, Kenny, Eley et al. — Journal of Neurodevelopmental Disorders",
     "subject": "Developmental disability", "licence": "CC BY 4.0",
     "source": "https://www.ebi.ac.uk/europepmc/webservices/rest/PMC9164368/fullTextXML",
     "home": "https://europepmc.org/article/PMC/PMC9164368",
     "summary": "What SYNGAP1-related intellectual disability looks like day to day — seizures, sensory issues, sleep, "
                "behaviour — described by the parents and caregivers who live with it.",
     "why": "A caregiver-eye view of a genetic intellectual disability, from the people our staff's work most "
            "resembles."},
    {"title": "Anticipatory grief among caregivers of people living with dementia: A scoping review",
     "author": "Rodriguez Colmenares, Alvarez, Gilbreath et al. — Palliative & Supportive Care",
     "subject": "Caregiving", "licence": "CC BY 4.0",
     "source": "https://www.ebi.ac.uk/europepmc/webservices/rest/PMC13202407/fullTextXML",
     "home": "https://europepmc.org/article/PMC/PMC13202407",
     "summary": "The grief that starts long before a death — how it shows up in dementia caregivers, and what helps.",
     "why": "Staff grieve residents while still caring for them; naming that is the first support."},
    {"title": "Trauma‐informed care in early intervention: Providers’ barriers, boundaries, and needs",
     "author": "Williams, Chudzik & Holden — Infant Mental Health Journal", "subject": "Trauma & behaviour",
     "licence": "CC BY 4.0", "source": "https://www.ebi.ac.uk/europepmc/webservices/rest/PMC12813253/fullTextXML",
     "home": "https://europepmc.org/article/PMC/PMC12813253",
     "summary": "What actually stops front-line providers from delivering trauma-informed care — the barriers, the "
                "role boundaries, and the support they say they need.",
     "why": "TIP 57 says what trauma-informed care is; this says why teams struggle to do it."},
    {"title": "The effect of mindfulness-based intervention on depression in family caregivers of dementia patients: "
              "a meta-analysis and GRADE evaluation",
     "author": "Zhang, Zhang, Wang et al. — Frontiers in Psychology", "subject": "Caregiving", "licence": "CC BY 4.0",
     "source": "https://www.ebi.ac.uk/europepmc/webservices/rest/PMC13201155/fullTextXML",
     "home": "https://europepmc.org/article/PMC/PMC13201155",
     "summary": "Pooled evidence on whether mindfulness practice actually lifts depression in people caring for "
                "somebody with dementia — and how strong that evidence is.",
     "why": "Caregiver wellbeing programmes should rest on evidence, not vibes; here is the evidence."},
)

# A model's suggestion survives only on a host whose whole catalogue is provably free; a claimed licence is not proof.
TRUSTED_HOSTS = ("gutenberg.org", "openstax.org", "iris.who.int", "nia.nih.gov", "order.nia.nih.gov", "samhsa.gov",
                 "library.samhsa.gov", "store.samhsa.gov", "cdc.gov", "stacks.cdc.gov", "dietaryguidelines.gov",
                 "nimh.nih.gov", "ninds.nih.gov", "acl.gov", "eldercare.acl.gov", "journals.plos.org", "ebi.ac.uk",
                 "europepmc.org", "medlineplus.gov", "ncbi.nlm.nih.gov")
INDEX_INTRO = ("Every title here is free to read and to share: a work of the US federal government (public domain by "
               "statute) or published under a Creative Commons licence. The licence is printed with each one — check "
               "it before reprinting anything for a training day.")

# booksRead's six hours, cleared as booksTextReplace_ clears books_read_v2_<id>
_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}
_CACHE_LOCK = threading.Lock()


def writer(user: dict | None) -> bool:
    """hubIsWriter_."""
    return bool(user) and s_((user or {}).get("role")) in ("admin", "manager")


def missing(p: dict, keys: tuple[str, ...]) -> dict[str, Any] | None:
    """hubPolicyGate_'s required params, read after its roles."""
    for k in keys:
        if p.get(k) is None or p.get(k) == "":
            return {"status": 400, "message": f"Missing required parameter: {k}."}
    return None


def owned(reads: L.Reads) -> None:
    for r in (RESOURCE, TEXT):
        if not RR.uploaded(reads.db, r):
            raise Defer(f"{r} is not uploaded to Postgres yet")


# ---- the shelf and its stored text ----------------------------------------------------------------------------------

def shelf(reads: L.Reads) -> list[dict]:
    """listRows_('books')."""
    return SR.rows(reads, RESOURCE)


def row_of(reads: L.Reads, bid: str) -> dict | None:
    return next((r for r in shelf(reads) if s_(r.get("id")) == bid), None)


def _text_col(reads: L.Reads, name: str) -> str:
    """The books_text header readTabNormalized_ folds as it folds this one (BOOKS_TEXT_HEADER's own when none)."""
    key = hubdb.norm_key(name)
    return next((c for c in RR.columns(reads, TEXT) if hubdb.norm_key(c) == key), name)


def _text_row(cols: list[str], cells: dict) -> dict[str, Any]:
    """readTabNormalized_'s row: each header folded, each cell as getValues() hands it back."""
    return {hubdb.norm_key(h): hubdb.typed(cells.get(h), "hub") for h in cols if h != ""}


def text_rows(reads: L.Reads, bid: str) -> list[dict[str, Any]]:
    """The books_text rows of one book, in the tab's order."""
    cols = RR.columns(reads, TEXT)
    col = _text_col(reads, "bookId")
    got = RR._q(reads, f"select cells from {RR.ROWS} where resource = %s and removed_at is null"
                       " and btrim(cells->>%s) = %s order by position, created_at, row_key", (TEXT, col, bid))
    return [r for r in (_text_row(cols, RR._json(c) or {}) for (c,) in got) if s_(r.get("bookid")) == bid]


def text_counts(reads: L.Reads) -> dict[str, int]:
    """How many books_text rows each book holds."""
    col = _text_col(reads, "bookId")
    out: dict[str, int] = {}
    for (v,) in RR._q(reads, f"select cells->>%s from {RR.ROWS} where resource = %s and removed_at is null",
                      (col, TEXT)):
        b = gsjs.trim(gsjs.or_blank(v))
        if b:
            out[b] = out.get(b, 0) + 1
    return out


def cache_get(bid: str) -> dict[str, Any] | None:
    with _CACHE_LOCK:
        hit = _CACHE.get(bid)
        if hit is None or hit[0] < time.time():
            _CACHE.pop(bid, None)
            return None
        return json.loads(json.dumps(hit[1]))


def cache_put(bid: str, data: dict[str, Any]) -> None:
    with _CACHE_LOCK:
        _CACHE[bid] = (time.time() + CACHE_S, json.loads(json.dumps(data)))


def cache_clear(bid: str) -> None:
    with _CACHE_LOCK:
        _CACHE.pop(bid, None)


# ---- the words ------------------------------------------------------------------------------------------------------

def file_name(title: str) -> str:
    """booksFileName_."""
    return gsjs.trim(_WS.sub(" ", _UNSAFE_NAME.sub(" ", s_(title))))[:90] or "book"


def human_size(n: int) -> str:
    """booksHumanSize_."""
    if not n:
        return ""
    if n < 1024 * 1024:
        return gsjs.num_str(gsjs.js_round(n / 1024)) + " KB"
    return gsjs.num_str(gsjs.js_round(n / 1024 / 1024 * 10) / 10) + " MB"


def host_trusted(url: Any) -> bool:
    """booksHostTrusted_."""
    m = re.match(r"^https?://([^/]+)", s_(url), re.I)
    if not m:
        return False
    host = re.sub(r"^www\.", "", m.group(1).lower())
    return any(host == t or host.endswith("." + t) for t in TRUSTED_HOSTS)


def licence_free(licence: Any) -> bool:
    """booksLicenceFree_."""
    return bool(re.search(r"public domain|cc[- ]by|creative commons|us federal government", s_(licence), re.I))


def _char(n: str) -> str:
    """String.fromCharCode(Number(n)), a lone surrogate written as the replacement character."""
    code = int(n) % 65536 if len(n) < 309 else 0
    return "�" if 0xD800 <= code <= 0xDFFF else chr(code)


def strip_html(page: Any) -> str:
    """booksStripHtml_."""
    s = gsjs.js_str(page if page else "")
    for tag in ("script", "style", "nav", "header", "footer", "aside"):
        s = re.sub(rf"<{tag}[\s\S]*?</{tag}>", " ", s, flags=re.I)
    s = re.sub(r"<!--[\s\S]*?-->", " ", s)
    # JATS XML (Europe PMC): tables, reference lists and xref markers are noise as prose
    for tag in ("table-wrap", "ref-list", "xref"):
        s = re.sub(rf"<{tag}[\s\S]*?</{tag}>", " ", s, flags=re.I)
    s = re.sub(r"</(p|div|h[1-6]|li|tr|blockquote|section|article|sec|title|abstract)>", "\n\n", s, flags=re.I)
    s = re.sub(r"<br\s*/?>", "\n", s, flags=re.I)
    s = re.sub(r"<[^>]+>", " ", s)
    for ent, ch in (("&nbsp;", " "), ("&amp;", "&"), ("&lt;", "<"), ("&gt;", ">"), ("&quot;", '"'), ("&#39;", "'")):
        s = re.sub(re.escape(ent), lambda _m, c=ch: c, s, flags=re.I)
    return re.sub(r"&#(\d+);", lambda m: _char(m.group(1)), s)


def paragraphs(text: Any) -> list[str]:
    """booksParagraphs_: PDF exports break per line, not per paragraph — those are re-flowed by sentence rhythm."""
    t = gsjs.or_text(text).replace("\r", "")
    parts = re.split(r"\n{2,}", t)
    if len(parts) < 4 and len(t) > 4000:
        parts, cur = [], ""
        for raw in t.split("\n"):
            ln = gsjs.trim(raw)
            if not ln:
                if cur:
                    parts.append(cur)
                    cur = ""
                continue
            cur = cur + " " + ln if cur else ln
            if re.search(r"[.!?:]$", ln) and len(cur) > 300:
                parts.append(cur)
                cur = ""
        if cur:
            parts.append(cur)
    out: list[str] = []
    total = 0
    for part in parts:
        if len(out) >= 400:
            break
        p = gsjs.trim(_WS.sub(" ", part))
        if len(p) < 3:
            continue
        p = p[:2000]
        total += len(p)
        out.append(p)
        if total > 60000:
            out.append("… (the text continues at the source)")
            break
    return out


# ---- the publishers and Drive ---------------------------------------------------------------------------------------

def fetch(url: str, agent: str, deadline: float = 0.0) -> tuple[int, bytes, str]:
    """UrlFetchApp.fetch (redirects followed, any status answered): the status, the body and its content type; a body
    past UrlFetchApp's ceiling is refused as it refuses one."""
    timeout = FETCH_TIMEOUT_S if not deadline else max(1.0, min(FETCH_TIMEOUT_S, deadline - time.monotonic()))
    with requests.get(url, headers={"User-Agent": agent}, timeout=timeout, allow_redirects=True, stream=True) as r:
        body = bytearray()
        for chunk in r.iter_content(1 << 16):
            body += chunk
            if len(body) > FETCH_CAP:
                raise ValueError("Exceeded maximum response size")
        return r.status_code, bytes(body), s_(r.headers.get("Content-Type"))


def mime_of(ctype: str) -> str:
    """Blob.getContentType(): the type without its parameters."""
    return gsjs.trim(ctype.split(";")[0]).lower()


def text_of(body: bytes, ctype: str) -> str:
    """HTTPResponse.getContentText(): the header's charset, else UTF-8."""
    m = re.search(r"charset\s*=\s*\"?([A-Za-z0-9._-]+)", ctype or "", re.I)
    try:
        return body.decode(m.group(1) if m else "utf-8", "replace")
    except LookupError:
        return body.decode("utf-8", "replace")


def pdf_text(drv: Any, data: bytes, why: dict[str, str]) -> str:
    """booksPdfText_: the PDF made a Google Doc as the platform's account, its words exported, the copy deleted; ''
    with the reason in `why` when no words came out."""
    def note(msg: str) -> None:
        why["reason"] = msg
    try:
        auth = drv._owner_write("a PDF is read")
    except Defer as e:
        note(str(e))
        return ""
    boundary = "hub" + os.urandom(12).hex()
    meta = json.dumps({"name": "books-read-tmp", "mimeType": DF.GOOGLE_DOC}).encode()
    body = (f"--{boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n".encode() + meta +
            f"\r\n--{boundary}\r\nContent-Type: application/pdf\r\n\r\n".encode() + data +
            f"\r\n--{boundary}--\r\n".encode())
    req = urllib.request.Request("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart"
                                 "&supportsAllDrives=true&fields=id", data=body,
                                 headers={**auth, "Content-Type": f"multipart/related; boundary={boundary}"},
                                 method="POST")
    try:
        with urllib.request.urlopen(req, timeout=dr.CONVERT_TIMEOUT_S) as res:
            doc = s_(json.loads(res.read()).get("id"))
    except urllib.error.HTTPError as e:
        note(f"Drive refused to convert it (HTTP {e.code})")
        return ""
    text = ""
    try:
        req = urllib.request.Request(f"{dr.API}/{urllib.parse.quote(doc)}/export?mimeType=text%2Fplain", headers=auth)
        try:
            with urllib.request.urlopen(req, timeout=dr.CONVERT_TIMEOUT_S) as res:
                text = res.read(PDF_TEXT_MAX * 4).decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            note(f"the converted copy could not be exported (HTTP {e.code})")
        except Exception as e:  # noqa: BLE001 - booksPdfText_'s catch: said in the reason
            note("the export threw: " + str(e))
    finally:
        gone = urllib.request.Request(f"{dr.API}/{urllib.parse.quote(doc)}?supportsAllDrives=true", headers=auth,
                                      method="DELETE")
        try:
            urllib.request.urlopen(gone, timeout=dr.BYTES_TIMEOUT_S).close()
        except Exception as e:  # noqa: BLE001 - the copy stays; nothing reads it
            log.warning("books: a PDF's reading copy was not deleted (%s)", type(e).__name__)
    out = text[:PDF_TEXT_MAX]
    if not gsjs.trim(out):
        note(why.get("reason") or "it converted but held no text — a scan, which needs eyes")
        return ""
    return out


def folder(reads: L.Reads, drv: Any) -> dict[str, Any]:
    """booksFolder_: the platform folder's ASA Hub — Books, made when there is none."""
    return DF.child(drv, s_(DF.root(reads, drv).get("id")), FOLDER)


def file_book(drv: Any, folder_id: str, name: str, mime: str, data: bytes, by: str) -> dict[str, Any]:
    """The shelf's copy of a book: the old ones of its name to the bin, the new one filed and kept on the server."""
    DF.trash_named(drv, folder_id, name)
    made = drv.upload_into(folder_id, name, mime, data)
    fid = s_(made.get("id"))
    DF.keep(KEPT_DIR, fid, name, mime, data, by)
    return {"id": fid, "url": DF.file_url(fid)}


def index_html(rows: list[dict], today: str) -> str:
    """booksWriteIndex_'s words: the shelf by subject, each title with its licence and where it is."""
    e = html.escape
    out = ["<html><body>", f'<p style="font-size:26pt">{e("ASA Hub — Books")}</p>', f"<p>{e(INDEX_INTRO)}</p>",
           f"<p><i>{e('Updated ' + today + ' · ' + str(len(rows)) + ' titles')}</i></p>"]
    by: dict[str, list[dict]] = {}
    for r in rows:
        by.setdefault(s_(r.get("subject")) or "General", []).append(r)
    for subject in sorted(by):
        out.append(f"<h1>{e(subject)}</h1>")
        for r in by[subject]:
            out.append(f"<h2>{e(s_(r.get('title')))}</h2>")
            out.append(f"<p><i>{e(s_(r.get('author')))}</i></p>")
            if s_(r.get("summary")):
                out.append(f"<p>{e(s_(r.get('summary')))}</p>")
            if s_(r.get("why")):
                out.append(f"<p>{e('Why it is here: ' + s_(r.get('why')))}</p>")
            out.append(f"<p>{e('Licence: ' + s_(r.get('licence')))}</p>")
            out.append(f"<p>{e('Source: ' + (s_(r.get('home')) or s_(r.get('source'))))}</p>")
            if s_(r.get("driveUrl")):
                out.append(f"<p>{e('In this folder: ' + s_(r.get('title')))}</p>")
            elif s_(r.get("fetchNote")):
                out.append(f"<p>{e('Not downloaded — ' + s_(r.get('fetchNote')))}</p>")
    out.append("</body></html>")
    return "".join(out)


def write_index(drv: Any, folder_id: str, rows: list[dict], today: str) -> str:
    """booksWriteIndex_: the folder's index document written again; its link, '' for an empty shelf."""
    if not rows:
        return ""
    return DF.doc_url(DF.write_doc(drv, folder_id, INDEX_DOC, index_html(rows, today)))


# ---- the doors ------------------------------------------------------------------------------------------------------

def books_list(sess: L.Session, payload: dict) -> dict[str, Any]:
    return SR.list_rows(sess, RESOURCE, payload)


def books_get(sess: L.Session, payload: dict) -> dict[str, Any]:
    return SR.get_row(sess, RESOURCE, payload)


def _read_from_source(reads: L.Reads, row: dict, bid: str) -> dict[str, Any]:
    url = s_(row.get("source")) or s_(row.get("home"))
    if not url:
        return {"status": 400, "message": "This row names no source to read."}
    if not host_trusted(url):
        return {"status": 403, "message": "That host is not on the trusted list — open it at the source instead."}
    try:
        code, body, ctype = fetch(url, UA)
    except Exception as e:  # noqa: BLE001 - booksRead's catch: the publisher's silence, said
        return {"status": 502, "message": "The publisher did not answer: " + str(e)[:160]}
    if code != 200:
        return {"status": 502, "message": f"The publisher answered {code}."}
    if "pdf" in ctype.lower():
        if len(body) > READ_PDF_MAX:
            return {"status": 413, "message": "This PDF is too large to read inline — a curator can fetch it to the "
                                              "shelf instead."}
        why: dict[str, str] = {}
        text = pdf_text(reads.need_drive(), body, why)
        if not text:
            return {"status": 422, "message": "The PDF held no readable text" +
                                              (" — " + why["reason"] if why.get("reason") else ".")}
        out = {"title": s_(row.get("title")), "author": s_(row.get("author")), "via": "pdf",
               "paragraphs": paragraphs(text)}
    else:
        out = {"title": s_(row.get("title")), "author": s_(row.get("author")), "via": "scrape",
               "paragraphs": paragraphs(strip_html(text_of(body, ctype)))}
    if not out["paragraphs"]:
        return {"status": 422, "message": "Nothing readable came back from the source."}
    cache_put(bid, out)
    return {"status": 200, "data": out}


def books_read(sess: L.Session, payload: dict) -> dict[str, Any]:
    """booksRead: the stored copy first, else the source scraped or its PDF read from a trusted host, held six
    hours."""
    user = sess.user
    p = payload if isinstance(payload, dict) else {}
    gap = missing(p, ("id",))
    if gap:
        return gap
    if not user or user.get("is_service"):
        return dict(DENIED)
    bid = s_(p.get("id"))
    if not bid:
        return {"status": 400, "message": "Which book?"}
    hit = cache_get(bid)
    if hit is not None:
        return {"status": 200, "data": hit}
    reads = sess.reads
    owned(reads)
    row = row_of(reads, bid)
    if row is None:
        return {"status": 404, "message": "That book is not on the shelf."}
    # a publisher outage never blanks the reader
    stored, via = [], ""
    for t in text_rows(reads, bid):
        via = s_(t.get("via")) or via
        n = CND.js_number(t.get("ord"))
        stored.append((n if n == n else 0.0, s_(t.get("text"))))
    if len(stored) >= 3:
        stored.sort(key=lambda x: x[0])
        return {"status": 200, "data": {"title": s_(row.get("title")), "author": s_(row.get("author")),
                                        "via": via or "stored", "paragraphs": [t for _o, t in stored]}}
    return _read_from_source(reads, row, bid)


def harvest_one(reads: L.Reads, row: dict, deadline: float) -> dict[str, Any]:
    """booksHarvestOne_: the book's paragraphs, or why there are none."""
    url = s_(row.get("source")) or s_(row.get("home"))
    if not url:
        return {"why": "This row names no source to read."}
    if not host_trusted(url):
        return {"why": "That host is not on the trusted list."}
    try:
        code, body, ctype = fetch(url, UA, deadline)
    except Exception as e:  # noqa: BLE001 - booksHarvestOne_'s catch: the publisher's silence, said
        return {"why": "The publisher did not answer: " + str(e)[:140]}
    if code != 200:
        return {"why": f"The publisher answered {code}."}
    if "pdf" in ctype.lower():
        why: dict[str, str] = {}
        text = pdf_text(reads.need_drive(), body, why)
        if not text:
            return {"why": "The PDF held no readable text" + (" — " + why["reason"] if why.get("reason") else ".")}
        paras = paragraphs(text)
    else:
        paras = paragraphs(strip_html(text_of(body, ctype)))
    if len(paras) < 3:
        return {"why": f"Only {len(paras)} readable paragraph{'' if len(paras) == 1 else 's'} came back — a bot wall "
                       "or an empty page, not the book."}
    return {"paragraphs": paras}


def harvest_prepare(sess: L.Session, payload: dict) -> dict[str, Any]:
    """booksHarvest's slow half: the text of the books still missing a copy, three books or the pass's time at most;
    the write stores it."""
    if not writer(sess.user):
        return dict(DENIED)
    reads = sess.reads
    owned(reads)
    started = time.monotonic()
    counts = text_counts(reads)
    need = [r for r in shelf(reads) if counts.get(s_(r.get("id")), 0) < 3]
    harvested: list[dict[str, Any]] = []
    failed: list[dict[str, str]] = []
    for row in need:
        if len(harvested) >= 3 or time.monotonic() - started > RUN_S:
            break
        got = harvest_one(reads, row, started + RUN_S + 15)
        if got.get("why"):
            failed.append({"title": s_(row.get("title")), "why": got["why"]})
            continue
        harvested.append({"id": s_(row.get("id")), "title": s_(row.get("title")), "paragraphs": got["paragraphs"]})
    return {"status": 200, "data": {"harvested": harvested, "failed": failed, "remaining": len(need) - len(harvested)}}


def fetch_prepare(sess: L.Session, payload: dict) -> dict[str, Any]:
    """booksFetch's slow half: each book still without a file fetched from its publisher (or the one named, again),
    filed in ASA Hub — Books as the platform's account and kept on the server — a link only for a file that provably
    arrived — and the folder's index written again; the write records each row's outcome."""
    user = sess.user
    if not writer(user):
        return dict(DENIED)
    reads = sess.reads
    owned(reads)
    only = s_((payload or {}).get("id"))
    rows = shelf(reads)
    drv = reads.need_drive()
    home = folder(reads, drv)
    started = time.monotonic()
    by = s_((user or {}).get("email"))
    results: list[dict[str, Any]] = []
    fetched = failed = skipped = 0
    stopped = False
    for row in rows:
        if only and s_(row.get("id")) != only:
            continue
        if not only and s_(row.get("driveUrl")):
            skipped += 1
            continue
        if time.monotonic() - started > RUN_S:
            stopped = True
            break
        url = s_(row.get("source"))
        if not url:
            skipped += 1
            continue
        note, code, body, ctype = "", 0, b"", ""
        try:
            code, body, ctype = fetch(url, UA_PLAIN, started + RUN_S + 15)
        except Exception as e:  # noqa: BLE001 - booksFetch's catch: the publisher's silence, said on the row
            note = "The publisher did not answer: " + str(e)[:160]
        if not note and code != 200:
            note = f"The publisher answered {code}."
        if not note:
            kind = ctype.lower()
            if len(body) < 4096:
                note = f"What came back was too small to be the document ({len(body)} bytes)."
            elif len(body) > MAX_BYTES:
                note = f"The file is larger than the {gsjs.num_str(gsjs.js_round(MAX_BYTES / 1024 / 1024))}MB limit."
            elif "html" in kind and ".htm" not in url:
                note = ("The publisher returned a web page instead of the file — it is likely refusing machine "
                        "downloads.")
        if note:
            results.append({"id": s_(row.get("id")), "fetchNote": note, "driveUrl": ""})
            failed += 1
            continue
        ext = ".pdf" if "pdf" in ctype else (".html" if ".htm" in url else "")
        name = file_name(s_(row.get("title"))) + ext
        try:
            filed = file_book(drv, s_(home.get("id")), name, mime_of(ctype) or "application/octet-stream", body, by)
        except Exception as e:  # noqa: BLE001 - what was filed before stays recorded; the next pass goes on from here
            log.warning("books: %s was not filed in Drive (%s) — the pass stops here", s_(row.get("id")),
                        type(e).__name__)
            stopped = True
            break
        results.append({"id": s_(row.get("id")), "driveUrl": filed["url"], "fileSize": human_size(len(body)),
                        "fetchNote": ""})
        fetched += 1
    laid = {r["id"]: r for r in results}
    after = [{**r, **{k: v for k, v in laid.get(s_(r.get("id")), {}).items() if k != "id"}} for r in rows]
    try:
        index = write_index(drv, s_(home.get("id")), after, reads.today())
    except Exception as e:  # noqa: BLE001 - the books are filed either way; the index is written on the next pass
        log.warning("books: the folder's index was not written (%s)", type(e).__name__)
        index = ""
    return {"status": 200, "data": {"results": results, "fetched": fetched, "failed": failed, "skipped": skipped,
                                    "stopped_early": stopped, "folder": DF.folder_url(s_(home.get("id"))),
                                    "index": index}}


def mine_prompt(titles: list[str]) -> str:
    """booksMine's ask."""
    return ("You curate a free professional library for a company that runs group homes for adults with "
            "developmental disabilities in Ohio (direct support professionals, house managers, nurses).\n"
            "The shelf already holds: " + "; ".join(titles)[:2200] + "\n\n"
            "Suggest up to 10 MORE genuinely free publications, ONLY from these publishers: "
            "Project Gutenberg (gutenberg.org), OpenStax (openstax.org), WHO IRIS (iris.who.int), "
            "NIA (nia.nih.gov / order.nia.nih.gov), SAMHSA (library.samhsa.gov), CDC (cdc.gov / stacks.cdc.gov), "
            "ACL (acl.gov), NIMH (nimh.nih.gov), NINDS (ninds.nih.gov), Dietary Guidelines (dietaryguidelines.gov).\n"
            "Relevant subjects: caregiving, dementia and ageing, developmental disability, autism, "
            "de-escalation and trauma, crisis response, communication, nutrition, medication safety, "
            "seizure response and epilepsy, diabetes care, infection control, oral health, fall prevention, "
            "safe lifting and positioning, documentation and incident reporting, caregiver wellbeing, first aid.\n"
            "Prefer DIRECT FILE URLS (a PDF on the publisher's own host) over landing pages. "
            "Only real, currently-published documents — never guess a URL you are not sure exists.\n"
            "Reply with JSON only:\n"
            '{"books":[{"title":"...","author":"<publisher or author>","subject":"<2-3 words>",'
            "\"licence\":\"<the real licence, named — e.g. 'Public domain — work of the US federal government', "
            "'CC BY 4.0'>\","
            '"source":"<https URL on one of those hosts>",'
            '"home":"<landing page URL>","summary":"<2 sentences>",'
            '"why":"<1 sentence: why THIS workforce needs it>"}]}')


def judged(b: Any, have_src: set[str], have_title: set[str]) -> tuple[dict[str, str] | None, str]:
    """One suggestion through booksMine's tests: the row it makes, or why it is refused ('' for a refusal said by
    count alone)."""
    b = b if isinstance(b, dict) else {}
    src, title = s_(b.get("source")), s_(b.get("title"))
    if not title or not src:
        return None, ""
    if not host_trusted(src) or (s_(b.get("home")) and not host_trusted(b.get("home"))):
        return None, title + " (untrusted host)"
    if not licence_free(b.get("licence")):
        return None, title + " (unproven licence)"
    if src in have_src or title.lower() in have_title:
        return None, ""
    return {"title": title, "author": s_(b.get("author")), "subject": s_(b.get("subject")) or "General",
            "licence": s_(b.get("licence")), "source": src, "home": s_(b.get("home")) or src,
            "summary": s_(b.get("summary")), "why": s_(b.get("why"))}, ""


def mine_prepare(sess: L.Session, payload: dict) -> dict[str, Any]:
    """booksMine's slow half: the model asked, round after round, for more free titles from the trusted publishers
    (each round told what the shelf and the earlier rounds hold); the write adds the ones that still pass."""
    if not writer(sess.user):
        return dict(DENIED)
    import client_care_sweeps as CCS  # noqa: PLC0415 - screenAiChat_'s port, read only for this door
    reads = sess.reads
    owned(reads)
    asked = CND.js_number((payload or {}).get("rounds"))
    rounds = max(1.0, min(3.0, asked if asked == asked and asked else 2.0))
    deadline = time.monotonic() + RUN_S
    titles = [s_(r.get("title")) for r in shelf(reads)]
    have_src = {s_(r.get("source")) for r in shelf(reads) if s_(r.get("source"))}
    have_title = {t.lower() for t in titles if t}
    made: list[dict[str, str]] = []
    refused, named, via = 0, [], ""
    rnd = 0
    while rnd < rounds:
        res = CCS.ai_chat(reads, mine_prompt(titles), 0.3, AI_REQUEST, deadline)
        if not res.get("ok"):
            if rnd == 0:
                return {"status": 502, "message": "No provider answered."}
            break
        via = s_(res.get("via"))
        try:
            parsed = json.loads(s_(res.get("content")))
        except ValueError:
            parsed = None
        books = parsed.get("books") if isinstance(parsed, dict) else None
        added = 0
        for b in books if isinstance(books, list) else []:
            if added >= 12:
                break
            row, why = judged(b, have_src, have_title)
            if row is None:
                refused += 1
                if why and len(named) < 6:
                    named.append(why)
                continue
            made.append({**row, "via": via})
            have_src.add(row["source"])
            have_title.add(row["title"].lower())
            titles.append(row["title"])
            added += 1
        if not added:
            break
        rnd += 1
    return {"status": 200, "data": {"rows": made, "refused": refused, "refused_named": named, "via": via,
                                    "rounds": int(rounds) if rounds == int(rounds) else rounds}}


def upload_kind(p: dict) -> tuple[bool, bool]:
    """booksFileUpload: whether the file is a PDF, whether it is an HTML page."""
    name, mime = s_(p.get("filename")) or "book", s_(p.get("mime")).lower()
    return ("pdf" in mime or bool(re.search(r"\.pdf$", name, re.I)),
            "html" in mime or bool(re.search(r"\.html?$", name, re.I)))


def upload_refused(reads: L.Reads, p: dict) -> tuple[dict | None, dict[str, Any] | None]:
    """booksFileUpload's first refusals, in its order: which book, on the shelf, a kind the reader holds, a file at
    all. (the row, the refusal)"""
    gap = missing(p, ("id",))
    if gap:
        return None, gap
    bid = s_(p.get("id"))
    if not bid:
        return None, {"status": 400, "message": "Which book?"}
    row = row_of(reads, bid)
    if row is None:
        return None, {"status": 404, "message": "That book is not on the shelf."}
    is_pdf, is_html = upload_kind(p)
    if not is_pdf and not is_html:
        return row, {"status": 400, "message": "A PDF or an HTML file — that is what the reader can hold."}
    if not str(p.get("base64") or ""):
        return row, {"status": 400, "message": "The file is required."}
    return row, None


def upload_prepare(sess: L.Session, payload: dict) -> dict[str, Any]:
    """booksFileUpload's slow half: a PDF or an HTML file named after the book, filed in ASA Hub — Books as the
    platform's account and kept on the server, and its words read; the write records the link and stores the text."""
    user = sess.user
    if not writer(user):
        return dict(DENIED)
    p = payload if isinstance(payload, dict) else {}
    reads = sess.reads
    owned(reads)
    row, refused = upload_refused(reads, p)
    if refused:
        return refused
    bid = s_(p.get("id"))
    mime = s_(p.get("mime")).lower()
    is_pdf, _is_html = upload_kind(p)
    b64 = str(p.get("base64") or "")
    if len(b64) > B64_MAX:
        return {"status": 400, "message": "The file is too large — up to 15MB."}
    try:
        data = base64.b64decode(b64, validate=False)
    except (binascii.Error, ValueError):
        data = b""
    if not data:
        return {"status": 400, "message": "The file is empty."}
    drive_name = file_name(s_(row.get("title"))) + (".pdf" if is_pdf else ".html")
    drv = reads.need_drive()
    home = folder(reads, drv)
    filed = file_book(drv, s_(home.get("id")), drive_name, mime or ("application/pdf" if is_pdf else "text/html"), data,
                      s_((user or {}).get("email")))
    why: dict[str, str] = {}
    text = pdf_text(drv, data, why) if is_pdf else strip_html(data.decode("utf-8", "replace"))
    return {"status": 200, "data": {"id": bid, "drive_id": filed["id"], "drive_url": filed["url"],
                                    "saved": drive_name, "size": len(data), "had_text": bool(text),
                                    "reason": why.get("reason", ""), "paragraphs": paragraphs(text) if text else []}}


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {
    "booksList": books_list, "booksGet": books_get, "booksRead": books_read,
    "booksFetchPrepare": fetch_prepare, "booksMinePrepare": mine_prepare, "booksHarvestPrepare": harvest_prepare,
    "booksFileUploadPrepare": upload_prepare}
_WRITERS = ("admin", "manager")
POLICY: dict[str, dict[str, Any]] = {
    "booksList": {}, "booksGet": {}, "booksRead": {"roles": ("admin", "manager", "staff", "client"),
                                                   "params": {"id": "string"}},
    "booksFetchPrepare": {"roles": _WRITERS}, "booksMinePrepare": {"roles": _WRITERS},
    "booksHarvestPrepare": {"roles": _WRITERS}, "booksFileUploadPrepare": {"roles": _WRITERS}}
