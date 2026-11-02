"""The recruiters' book on Python (CommRecruit.gs): the relay copies their book (server/recruit_book.py), hands each
changed tab over whole to be written into its house, and plans the three texts the book owes — the in-person screen's
morning, the onboarding start, the background-check how-to. Once Python's, the two houses live in Postgres
(app/resource_rows.py `recruitPipeline`, `recruitOnboarding`, uploaded from their copies on the flip) and the texts
leave through the one send door (app/comm_recruit_writes.py). Here: the situations, the words and the number."""
from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone
from typing import Any, Callable

import gsjs
import line_directory as LD
import locations as L
import mail_designs as MD
import smart_clock as SK
import smart_comms as SC
import smart_comms_desk as SCD
import writes as W

APP_ID = "comm-recruit"
SITUATIONS = {"hiring_screen_day_reminder": "hiring.screen.day_reminder",
              "hiring_onboarding_start": "hiring.onboarding.start", "hiring_bci_howto": "hiring.bci.howto"}
SCREEN, ONBOARD, BCI = "hiring_screen_day_reminder", "hiring_onboarding_start", "hiring_bci_howto"
# RECRUIT_HOUSES, with the resource each house is in Postgres
HOUSES = {"recruit_pipeline": {"source_tab": "Talent Pipeline", "prefix": "TP", "resource": "recruitPipeline"},
          "recruit_onboarding": {"source_tab": "Onboarding Checklist", "prefix": "OC", "resource": "recruitOnboarding"}}
RESOURCES = {spec["resource"]: tab for tab, spec in HOUSES.items()}
MAX_ROWS = 20
# The copy travels back with the answer, cut where the mock outbox cuts a body, with its length.
WORDS_MAX = 4000
# No row starts past this: the relay's pass hands the rest to the next one.
START_BUDGET_S = 4.0
PASS_BY = "asa-hub:recruit-book"
SCREENER_FALLBACK = "Our house manager"
NAME_FALLBACK = "there"
INGEST_GATE = "gate_recruit_book_ingest"
DAYS = ("Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday")
MONTHS = ("January", "February", "March", "April", "May", "June", "July", "August", "September", "October",
          "November", "December")


def t(v: Any) -> str:
    """recruitStr_."""
    return gsjs.trim("" if v is None else gsjs.js_str(v))


def situation(reads: L.Reads, rows: list[dict] | None, sid: str) -> dict | None:
    """recruitSituation_: the bound row (commSituationId_) while it is on, its channels naming the text and the text
    written."""
    key = SITUATIONS.get(sid)
    if not key or rows is None:
        return None
    sit = SCD.situation_on(rows, MD.situation_id(reads, rows, key, sid))
    if sit is None:
        return None
    if "sms" not in SC.smart_list(sit.get("channels")) or not t(sit.get("sms_text")):
        return None
    return sit


def day_words(iso: Any) -> str:
    """recruitDayWords_: "2026-10-23" → "Friday, October 23"."""
    m = re.fullmatch(r"(\d{4})-(\d{2})-(\d{2})", t(iso))
    if not m:
        return ""
    try:
        d = datetime(int(m.group(1)), int(m.group(2)), int(m.group(3)), 12, tzinfo=timezone.utc)
    except ValueError:
        return ""
    return f"{DAYS[(d.weekday() + 1) % 7]}, {MONTHS[d.month - 1]} {d.day}"


def vars_of(r: dict, sit: dict | None) -> dict[str, str]:
    """recruitVars_."""
    first = t(r.get("first_name")) or re.split(r"\s+", t(r.get("name")))[0] or NAME_FALLBACK
    screener = t(r.get("screener"))
    if gsjs.or_blank(r.get("situation")) == ONBOARD and not screener:
        screener = SCREENER_FALLBACK
    return {"first_name": first, "name": t(r.get("name")) or first, "screener": screener, "time": t(r.get("time")),
            "location": re.sub(r"[.\s]+$", "", t(r.get("location"))), "date": day_words(r.get("date")),
            "sender": t((sit or {}).get("sender")) or SC.SENDER_DEFAULT}


def _directory(ask: Callable[[], bool]) -> bool:
    """One question of the line directory inside a write: a statement of its that failed rolls back to here, never
    the write's whole transaction; a question that could not be answered answers no."""
    cur = W.HELD.get()
    if cur is None:
        try:
            return bool(ask())
        except Exception:  # noqa: BLE001 - an unread directory names nobody
            return False
    name = "comm_recruit_" + uuid.uuid4().hex[:10]
    cur.execute(f"savepoint {name}")
    try:
        got = bool(ask())
    except Exception:  # noqa: BLE001 - an unread directory names nobody
        got = False
    if cur.connection.info.transaction_status.name == "INERROR":
        cur.execute(f"rollback to savepoint {name}")
        got = False
    cur.execute(f"release savepoint {name}")
    return got


def number(reads: L.Reads, raw: Any) -> dict[str, str]:
    """recruitNumber_: a shared line names nobody, one of our own lines is never texted, else a number we may text."""
    s = t(raw)
    shared = _directory(lambda: LD.shared_for_identity(reads, s))
    if not shared:
        shared = SCD.shared_line(s)
    if shared:
        return {"to": "", "state": "shared_line", "why": "that number is a shared line — it names nobody"}
    ours = _directory(lambda: LD.line_ours(reads, s))
    if ours:
        return {"to": "", "state": "our_line", "why": "that number is one of our own lines"}
    to = SC.sendable(s)
    if not to:
        return {"to": "", "state": "no_number", "why": "no number we may text on the row"}
    return {"to": to, "state": "", "why": ""}


def pacing(sit: dict | None) -> dict[str, Any]:
    """recruitPacing_: how many times the how-to may go, and how many days apart."""
    most = SCD.js_parse_int(t((sit or {}).get("max_attempts")))
    if most is None or most < 1:
        most = 1
    word = t((sit or {}).get("frequency")).lower() or "once"
    gap = SK.FREQUENCIES.get(word, 0)
    return {"max": most if gap > 0 else 1, "gap_days": gap}


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {}
POLICY: dict[str, dict[str, Any]] = {}
