"""The Employee Database step (EmployeeDb.gs empdbStepSweep_ / employeeDbFill) on Python: a card at Hired or Ready to
start has its origin details — what its signed packet said and the papers on file — added to the Asa Employee
Database's Master as a new row, blanks only; a row that already belongs to the person is left as it is. This module is
the read: who is due, the fill decided off asa-hub-db, and the look the relay's clock asks first (employeeDbStepDue),
which reads the papers' text once (OCR) so the write never waits on Drive. The SSN is never read, written or shown: a
person is matched by the salted fingerprint the packet carries against the one the sheet keeper keeps beside the
Master's SSN# (server/hub_sheet_sync.py), by e-mail, then by name."""
from __future__ import annotations

import json
import logging
import re
import time
from typing import Any, Callable

import candidates as CND
import files_docs as FD
import gsjs
import hiring_hired as HH
import hiring_packet as HP
import house_tables as HT
import hubdb
import locations as L
import recon as R
import staff as SP
import staff_comms as SPC
import staff_docs as SDOC
from scope import Defer

log = logging.getLogger("asa-hub-app")
s_ = CND.s_

LOOK = "employeeDbStepDue"
SWEEP = "employeeDbStepSweep"
BY = "auto-internal-docs"
CAN_ID = re.compile(r"^CAN_[A-Za-z0-9]{6,}$")
MASTER_TAB = "Master"
# server/hub_sheet_sync.py FINGERPRINT_COLUMN: the keeper's own column, never one of the sheet's
FINGERPRINT_COLUMN = "Hub SSNfingerprint"
# EMPDB_COLUMNS: headers were renamed over the years; first hit wins ('Employee'/'Name' first, the sheet's wording)
COLUMNS: dict[str, tuple[str, ...]] = {
    "Employee Name": ("Employee", "Name", "Employee Name", "Full Name"),
    "First Name": ("First Name", "First"),
    "Last Name": ("Last Name", "Last"),
    "Middle Initial": ("Middle Initial", "MI"),
    "Date of Birth": ("Date of Birth", "DOB", "Birth Date"),
    "SSN": ("SSN#", "SSN", "Social Security"),
    "Email": ("Email", "Email Address", "E-mail"),
    "Address": ("Address", "Street Address", "Home Address"),
    "City": ("City",),
    "State": ("State", "ST"),
    "Zip": ("Zip", "Zip Code", "Zipcode"),
    "Phone": ("Phone Number", "Phone", "Mobile Phone", "Cell", "Cell Phone"),
    "Home Phone": ("Home Phone",),
    "Referral": ("Referral", "Referred By", "Source"),
}
# EMPDB_PACKET_FORMS: signing completes only the employee half of the I-9
PACKET_FORMS = ((("I-9 Completed",), "No"),)
# EMPDB_PACKET_DATES: the signature date, by rule
PACKET_DATES = (("I-9 Date",), ("W-4 Date", "W4 Date"), ("HIPAA Form Date",), ("Pay Auth Form Date",),
                ("Attestation Date",), ("Job App Date",), ("Start Date(doc)", "Start Date (doc)"),
                ("Start Date (first day)", "Start Date(first day)"))
# EMPDB_CERT_DOCS: a date that cannot be read is left blank, never guessed
CERT_DOCS = (
    {"doc": "dodd_8hr", "cred": "dodd", "cols": ("DODD 8-Hour Exp", "DODD 8 Hour Exp")},
    {"doc": "cpr_first_aid", "cred": "cpr", "cols": ("CPR Exp Date",)},
    {"doc": "med_del", "cred": "med1", "cols": ("Med 1 Exp Date",),
     "by_level": {"1": ("Med 1 Exp Date",), "2": ("Med 2 Exp Date",), "3": ("Med 3 Exp Date",)}},
    {"doc": "drivers_id", "cred": "id", "cols": ("I-9 1 Exp Date", "License Exp Date")},
    {"doc": "background_check", "cred": "", "cols": ("BCI Check Date",), "use": "issued"},
)
# only these count as a row somebody started
BASIC = ("Employee Name", "First Name", "Last Name", "Date of Birth", "SSN", "Email", "Address", "City", "Zip", "Phone")
# textOf's budget: documents read by OCR in one fill
OCR_PER_FILL = 4
# the look reads papers until this many seconds have gone; the rest are read on the next ring
LOOK_BUDGET_S = 60.0
# what a document's text is read for (clearanceDateFromText_'s credentials, the insurance's own)
TEXT_CREDS = ("dodd", "cpr", "med1", "id", "", "insurance")
NO_FINGERPRINT = ("The Employee Database's SSN match is not available here: asa-hub-db keeps no fingerprint of its SSN# "
                  "column yet (the sheet keeper keeps one once it is given the salt). Nothing was written, so no second "
                  "row is made for this person; it is tried again on the next pass.")
WITHHELD = "[withheld"


class Unprepared(Exception):
    """A paper's text the look did not read: the card waits for the next ring, unstamped."""


# ---- small rules ----------------------------------------------------------------------------------------------------

def key(h: Any) -> str:
    """empdbKey_ (estateKey_)."""
    return hubdb.estate_key(h)


def doc_type(text: Any, which: str) -> str:
    """empdbDocType_."""
    t = gsjs.or_blank(text)
    if which == "id":
        if re.search(r"driver'?s?\s*licen[sc]e", t, re.I):
            return "Driver License"
        if re.search(r"non-?driver|identification\s+card|state\s+id", t, re.I):
            return "OH ID"
        return ""
    if re.search(r"social\s+security", t, re.I):
        return "Social Security"
    if re.search(r"birth\s+certificate|certificate\s+of\s+(live\s+)?birth", t, re.I):
        return "Birth Certificate"
    return ""


def file_id(url: Any) -> str:
    """empdbFileId_."""
    m = re.search(r"/file/d/([A-Za-z0-9_-]{10,})", gsjs.or_blank(url))
    return m.group(1) if m else ""


def us_date(iso: Any) -> str:
    """empdbUsDate_."""
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})", gsjs.or_blank(iso))
    return f"{m.group(2)}/{m.group(3)}/{m.group(1)}" if m else ""


_SCAN_CAP = 120000
_GRID_ROW = re.compile(r"cat(?:egory)?\s*[\-–]?\s*(i{1,3}|[123])\b[^0-9A-Za-z]{0,6}"
                       r"([0-9]{1,2}[/\-.][0-9]{1,2}[/\-.][0-9]{2,4})[^0-9A-Za-z]{0,6}"
                       r"([0-9]{1,2}[/\-.][0-9]{1,2}[/\-.][0-9]{2,4})", re.I | re.A)
_GRID_STATUS = re.compile(r"(certified|expired|revoked|pending|active)", re.I)
_CATEGORY = re.compile(r"\bcat(?:egory)?\s*[\-–:]?\s*(1|2|3|i{1,3})\b", re.I | re.A)


def _roman(v: Any) -> str:
    """digestRoman_."""
    t = gsjs.or_blank(v).lower()
    return {"i": "1", "ii": "2", "iii": "3"}.get(t) or (t if t in ("1", "2", "3") else "")


def med_level(text: Any) -> str:
    """digestMedLevel_: the certified categories of the certification grid, else the first category the paper names."""
    s = gsjs.or_blank(text)[:_SCAN_CAP]
    live: list[str] = []
    rows = 0
    for line in s.replace("\r", "\n").split("\n"):
        if rows >= 16:
            break
        m = _GRID_ROW.search(line)
        if not m or not _roman(m.group(1)):
            continue
        rows += 1
        st = _GRID_STATUS.search(line)
        if st and st.group(1).lower() == "certified" and _roman(m.group(1)) not in live:
            live.append(_roman(m.group(1)))
    if live:
        return ",".join(sorted(live))
    m = _CATEGORY.search(s)
    return _roman(m.group(1)) if m else ""


def facts_of(text: str) -> dict[str, Any]:
    """What a paper's text is read for — never the text itself."""
    return {"dates": {c: SDOC.date_from_text(text, c) for c in TEXT_CREDS}, "id": doc_type(text, "id"),
            "ss": doc_type(text, "ss"), "level": med_level(text)}


NO_TEXT = facts_of("")


class Texts:
    """textOf: each paper read by OCR once, at most OCR_PER_FILL a fill — live in the look, replayed in the sweep from
    what the look prepared (a paper it did not read is Unprepared)."""

    def __init__(self, reads: L.Reads, prepared: dict[str, Any] | None = None, until: float = 0.0) -> None:
        self.reads, self.prepared, self.until = reads, prepared, until
        self.budget = OCR_PER_FILL
        self.read: dict[str, dict[str, Any]] = {}

    def of(self, d: dict | None) -> dict[str, Any]:
        fid = file_id((d or {}).get("file_url"))
        if not fid:
            return NO_TEXT
        if fid in self.read:
            return self.read[fid]
        if self.prepared is not None:
            if fid not in self.prepared:
                raise Unprepared(fid)
            self.read[fid] = self.prepared[fid]
            return self.read[fid]
        if self.budget <= 0:
            self.read[fid] = NO_TEXT
            return NO_TEXT
        if self.until and time.time() > self.until:
            raise Defer("the look's time for reading papers ran out")
        self.budget -= 1
        self.read[fid] = facts_of(SDOC.ocr_text(self.reads, fid))
        return self.read[fid]

    def date(self, d: dict | None, cred: str) -> str:
        return gsjs.or_blank((self.of(d).get("dates") or {}).get(cred))

    def kind(self, d: dict | None, which: str) -> str:
        return gsjs.or_blank(self.of(d).get(which))


# ---- the Master as the copy holds it --------------------------------------------------------------------------------

def master(reads: L.Reads) -> dict[str, Any]:
    """empdbSheet_'s tab: its headers in the sheet's order (a repeated name under its own name), each row's cells by
    position, and whether the keeper keeps the SSN# fingerprint."""
    def read() -> dict[str, Any]:
        sid = SP.emp_db_id(reads)
        try:
            tab = SP.cert_source_tab(reads, "master") or MASTER_TAB
        except (hubdb.Unreadable, Defer):
            tab = MASTER_TAB
        ref = HT.tab_of(reads, sid, tab, "the Employee Database's " + tab)
        if ref is None:
            return {"sid": sid, "tab": tab, "missing": True}
        keys = [h for h in ref.headers if h != FINGERPRINT_COLUMN]
        rows = [(rn, [gsjs.trim(gsjs.or_blank(raw.get(k))) for k in keys], gsjs.trim(gsjs.or_blank(
            raw.get(FINGERPRINT_COLUMN)))) for rn, raw in reads.db.rows(ref)]
        return {"sid": sid, "tab": tab, "missing": False, "hdr": [gsjs.trim(hubdb.twin_base(h)) for h in keys],
                "keys": keys, "rows": rows, "printed": FINGERPRINT_COLUMN in ref.headers}
    return reads.once("empdb:master", read)


def column_index(hdr: list[str]) -> dict[str, int]:
    """empdbColumnIndex_."""
    norm = [key(h) for h in hdr]
    out: dict[str, int] = {}
    for label, names in COLUMNS.items():
        for n in names:
            if key(n) in norm:
                out[label] = norm.index(key(n))
                break
    return out


def cert_cols(reads: L.Reads, course: str, literal: tuple[str, ...]) -> list[str]:
    """empdbCertCols_: the columns ist_cert_master_columns names for the course first; the typed ones are the floor."""
    named: list[str] = []
    if course:
        try:
            named = SDOC.master_columns_for(reads, course)
        except Exception:  # noqa: BLE001 - as the catch around certMasterColumnsFor_: the typed headers stand
            named = []
    keys = [key(n) for n in named]
    return named + [c for c in literal if key(c) not in keys]


def driver_number(reads: L.Reads, cand: dict) -> str:
    """empdbDriverNumber_: the newest licence number the staff documentation form holds — '' when the copy withholds
    it, so a marker is never written."""
    name = s_(cand.get("candidatename"))
    if not name:
        return ""
    try:
        mine = SPC._staff_docs_form(reads).get(SPC._staff_docs_key(name))
    except Exception:  # noqa: BLE001 - as the catch around staffDocsFormIndex_
        return ""
    for r in reversed((mine or {}).get("rows") or []):
        n = s_(r.get("driverslicense"))
        if n:
            return "" if n.startswith(WITHHELD) else n
    return ""


def find_row(m: dict, idx: dict[str, int], answers: dict[str, Any], ssn_fp: str) -> dict[str, Any]:
    """empdbFindRow_: SSN (its fingerprint), then e-mail, then name; a tie is a refusal, never a guess."""
    want_ssn = "fp:" + ssn_fp if ssn_fp else ""
    email = gsjs.trim(gsjs.or_blank(answers.get("Email"))).lower()
    name = SP.name_norm(answers.get("Employee Name"))
    hits = []
    for rn, row, fp in m["rows"]:
        by = ""
        if want_ssn and "SSN" in idx and fp and "fp:" + fp == want_ssn:
            by = "ssn"
        if not by and email and "Email" in idx and row[idx["Email"]].lower() == email:
            by = "email"
        if not by and name and "Employee Name" in idx and SP.name_norm(row[idx["Employee Name"]]) == name:
            by = "name"
        if by:
            hits.append({"row": rn, "by": by, "cells": row})
    if not hits:
        return {"row": 0, "by": ""}
    strong = [h for h in hits if h["by"] in ("ssn", "email")]
    if len(strong) == 1:
        return strong[0]
    if len(strong) > 1:
        return {"row": 0, "by": "", "conflict": len(strong)}
    if len(hits) > 1:
        return {"row": 0, "by": "", "conflict": len(hits)}
    return hits[0]


# ---- the fill -------------------------------------------------------------------------------------------------------

def fill(reads: L.Reads, cid: str, texts: Texts) -> dict[str, Any]:
    """employeeDbFill as the step presses it (commit): a refusal ({status, message}); the row a person has, left alone
    ({status 200, data.touched False}); or the new row's cells ({status 200, data.filled, append: {header: value}}).
    The SSN is never taken from the packet: only its fingerprint, to match."""
    if not CAN_ID.match(cid):
        return {"status": 400, "message": "invalid candidate_id"}
    cand = CND.evidence(reads, cid).get("cand")
    if not cand:
        return {"status": 404, "message": f'No candidate "{cid}".'}
    name = s_(cand.get("candidatename"))
    rows = CND.packet_rows(reads)
    res = CND.packet_match(reads, cand, rows)
    if res["state"] != "signed" or not res["srid"]:
        return {"status": 409, "message": "There is no SIGNED packet for " + name +
                " — the origin details come from the packet, so there is nothing to fill from yet."}
    hit = None
    for r in rows:
        if s_(r.get("signaturerequestid")) == res["srid"]:
            hit = r
    try:
        raw = json.loads(s_((hit or {}).get("fieldsjson")) or "{}") or {}
    except ValueError:
        raw = {}
    if not isinstance(raw, dict) or not raw:
        return {"status": 409, "message": "The packet is signed but its answers are not mirrored yet — run a "
                                          "recruitment sync first."}
    answers: dict[str, Any] = dict(HP.answers(raw)["named"])
    answers.pop("SSN", None)
    ssn_fp = ""
    for k in raw:
        if str(k).lower() == "ssn_fp":
            ssn_fp = gsjs.trim(gsjs.or_blank(raw[k]))

    m = master(reads)
    if m["missing"]:
        return {"status": 500, "message": "The " + m["tab"] + " tab is missing from the Employee Database."}
    hdr = m["hdr"]
    idx: dict[str, int] = column_index(hdr)
    if ssn_fp and "SSN" in idx and not m["printed"]:
        return {"status": 503, "message": NO_FINGERPRINT}

    signed_on = us_date(s_((hit or {}).get("signed")))
    norm = [key(h) for h in hdr]

    def put(names: tuple[str, ...] | list[str], value: str) -> None:
        if not value:
            return
        for n in names:
            if key(n) in norm:
                at = norm.index(key(n))
                idx["__" + hdr[at]] = at
                answers["__" + hdr[at]] = value
                return

    for cols, value in PACKET_FORMS:
        put(cols, value)
    my_docs = CND.onboarding_doc_index(reads).get(cid) or {}
    withheld: list[str] = []

    def has_it(d: dict | None) -> bool:
        return bool(d) and d.get("status") in ("uploaded", "verified")

    review_needed: dict[str, bool] = {}
    try:
        for c in FD.catalog(reads):
            flag = gsjs.trim(gsjs.or_blank(c.get("review_required"))).lower()
            review_needed[s_(c.get("doc_id"))] = flag not in ("false", "no", "off")
    except Exception:  # noqa: BLE001 - unconfigured means review needed
        review_needed = {}

    def date_allowed(d: dict | None, what: str, doc: str) -> bool:
        if not d:
            return False
        if d.get("status") == "verified" or d.get("review_status") == "verified":
            return True
        if review_needed.get(doc) is False and d.get("status") == "uploaded":
            return True
        if d.get("status") == "uploaded":
            withheld.append(what + " — the document is on file but nobody has reviewed it")
        return False

    for cd in CERT_DOCS:
        d = my_docs.get(cd["doc"])
        if not has_it(d) or not date_allowed(d, (cd["cred"] or cd["doc"]) + " date", cd["doc"]):
            continue
        iso = s_(d.get("issued_on" if cd.get("use") == "issued" else "expires_on"))
        if not iso or not re.match(r"^\d{4}-\d{2}-\d{2}", iso):
            iso = texts.date(d, cd["cred"])
            if cd["cred"] == "id":
                put(("I-9 Type 1",), texts.kind(d, "id"))
        cols = cert_cols(reads, cd["cred"], cd["cols"])
        if cd.get("by_level"):
            picked: list[str] = []
            for one in texts.kind(d, "level").split(","):
                if one in cd["by_level"]:
                    picked += cert_cols(reads, "med" + one, cd["by_level"][one])
            if picked:
                cols = picked
        put(cols, us_date(iso))
    ss = my_docs.get("ss_birth")
    if has_it(ss):
        t2 = texts.kind(ss, "ss")
        if t2:
            put(("I-9 Type 2",), t2)
            put(("I-9 2 Exp Date",), "n/a")
    if has_it(my_docs.get("hs_diploma")):
        put(("HS Diploma",), "Yes")
    if has_it(my_docs.get("drivers_id")):
        put(("Driver",), "Yes")
    dl = s_(answers.get("DL Number")) or driver_number(reads, cand)
    if dl:
        put(("DL #", "DL#", "Drivers License #"), dl)
    ins = my_docs.get("car_insurance")
    if has_it(ins) and date_allowed(ins, "auto insurance expiry", "car_insurance"):
        ins_iso = s_(ins.get("expires_on"))
        if not ins_iso or not re.match(r"^\d{4}-\d{2}-\d{2}", ins_iso):
            ins_iso = texts.date(ins, "insurance")
        put(("Insurance Exp Date",), us_date(ins_iso))
    if key("Resume") in norm:
        at = norm.index(key("Resume"))
        idx["__" + hdr[at]] = at
        answers["__" + hdr[at]] = "Yes" if s_(cand.get("resumelink")) else "No"
    if signed_on:
        for names in PACKET_DATES:
            put(names, signed_on)

    found = find_row(m, idx, answers, ssn_fp)
    if found.get("conflict"):
        return {"status": 409, "message": "Two rows in the Employee Database match this person (" +
                str(found["conflict"]) + "). Merging people is not something to do automatically — sort the "
                "duplicate out first."}
    if found["row"]:
        started = [hdr[idx[label]] for label in BASIC if label in idx and found["cells"][idx[label]]]
        return {"status": 200, "data": {
            "touched": False, "candidate_id": cid, "name": name, "matched_row": found["row"],
            "matched_by": found["by"], "already_started": started,
            "message": "Somebody is already filling this row (" + str(len(started)) + " field(s) on row " +
                       str(found["row"]) + "). Left exactly as it is."}}
    if not gsjs.trim(gsjs.or_blank(answers.get("Status"))):
        answers["Status"] = "Hired"
    if withheld:
        log.info("%s: employee_db_withheld — %s — %d date(s) held back: %s", BY, name, len(withheld),
                 "; ".join(withheld)[:400])
    plan, no_column = [], []
    for label, value in answers.items():
        value = gsjs.trim(gsjs.or_blank(value))
        if not value or value.startswith(WITHHELD):
            continue
        at = idx.get(label)
        if at is None:
            no_column.append(label)
            continue
        plan.append({"label": label[2:] if label.startswith("__") else label, "column": hdr[at], "at": at,
                     "value": value})
    # appendRow's line, by the column's own key (a repeated header's earlier column is "<name> ⟨n⟩"); a column two
    # answers name takes the last
    cells = {m["keys"][p["at"]]: p["value"] for p in plan}
    return {"status": 200, "data": {"filled": [p["label"] + " → " + p["column"] for p in plan], "matched_row": 0,
                                    "matched_by": "", "skipped_already_filled": [], "no_such_column": no_column,
                                    "waiting_on_review": withheld, "appended": True},
            "append": cells}


# ---- who is due, and the look ----------------------------------------------------------------------------------------

def due(reads: L.Reads) -> list[dict]:
    """empdbStepSweep_'s cards: at Hired or Ready to start, never a test card, never moved backwards — unstamped, or
    stamped 'Not filled' (retried); 'Left alone' means a person has the row. The last row of each card."""
    last: dict[str, dict] = {}
    for c in HH.cands(reads):
        cid = s_(c.get("candidateid"))
        if cid:
            last[cid] = c
    out = []
    for cid, c in last.items():
        if cid in CND.TALENT_EXCLUDE_IDS or HH.archived(c) or HH.is_test(reads, c):
            continue
        if CND.stage_of(c.get("status")) not in ("hired", "ready"):
            continue
        if s_(c.get("internaldocsat")):
            note = s_(c.get("internaldocsnote"))
            if note.startswith("Left alone") or not note.startswith("Not filled"):
                continue
        out.append(c)
    return out


def step_due(sess: L.Session, payload: dict) -> dict[str, Any]:
    """The step's look: the cards due, each one's papers read by OCR as its fill will need them (only what is read off
    them is kept), sealed for employeeDbStepSweep."""
    if not HH.service(sess):
        return dict(HH.SERVICE_ONLY)
    reads = sess.reads
    started = time.time()
    cids: list[str] = []
    texts: dict[str, dict[str, Any]] = {}
    for c in due(reads):
        if time.time() - started > LOOK_BUDGET_S:
            break
        cid = s_(c.get("candidateid"))
        t = Texts(reads, until=started + LOOK_BUDGET_S)
        try:
            fill(reads, cid, t)
        except Defer as why:
            log.info("%s: %s — its papers could not be read now (%s); asked again on the next ring", LOOK, cid,
                     str(why)[:160])
            continue
        except Exception:  # noqa: BLE001 - the sweep stamps what the fill says
            pass
        cids.append(cid)
        texts[cid] = t.read
    return {"status": 200, "data": R.seal(SWEEP, "service", {"cids": cids, "texts": texts, "due": len(cids)})}


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {LOOK: step_due}
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
