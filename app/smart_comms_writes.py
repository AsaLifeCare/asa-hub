"""Smart Comms' Desk save (apps-script/SmartComms.gs smartCommsSet) decided off asa-hub-db and kept in app.edits: a
sending line judged against the line directory, an id on more than one row carried to the last of them as a book
op (app/book_ops.py `cells`), and a correction declared with the words carried by the repair lane
(comm_repair_writes.on_words_changed) in the same write."""
from __future__ import annotations

import logging
import re
import time
from typing import Any, Callable

import book_ops as BO
import gsjs
import house_tables as HT
import hubdb
import line_directory as LD
import locations as L
import resource_rows as RR
import scope as sc
import smart_comms as SC
import writes as W
from scope import Defer
from writes import Decision

log = logging.getLogger("asa-hub-app")

# App Control's id for the app (the registry's), Settings › Editions' app, the live event the relay rings
APP_ID = "smartcomms"
EDITION_APP = "smart-comms"
EVENT = "smartcomms"
TAB = "smart_comms"
SUBJECT = "situations"
ACTION = "smartCommsSet"

# SmartComms.gs SMART_HEADER: positional on the sheet, written here by name
SMART_HEADER = ("id", "enabled", "credential", "days_before", "statuses", "kind", "direction", "to", "exclude_column",
                "exclude_values", "channels", "cc", "label", "sender", "sms_text", "email_subject", "email_text", "note",
                "event", "max_attempts", "frequency", "email_design", "ai_model", "ai_providers", "send_at", "record_to",
                "from_line")
# SmartComms.gs SMART_TO_KEYWORDS, in its order
TO_KEYWORDS = ("allstaff", "housemanagers", "directors")
SENDER_DEFAULT = "the admin team from ASA LifeCare"
SLOTS_MAX = 24

# the field families a person beside the admins may change, each its own edition (off, nobody listed)
FAMILIES: tuple[tuple[str, str, tuple[str, ...], str], ...] = (
    ("words", "smartComms.words", ("sms_text", "email_subject", "email_text"), "the words"),
    ("switch", "smartComms.switch", ("enabled",), "the switch"),
    ("audience", "smartComms.audience", ("to", "cc"), "who it goes to"),
    ("pacing", "smartComms.pacing", ("channels", "max_attempts", "frequency", "send_at", "days_before"),
     "the channels and the pacing"),
    ("ai", "smartComms.ai", ("ai_model", "ai_providers"), "the AI model and providers"),
    ("recording", "smartComms.recording", ("record_to",), "the sheet it records to"),
)
FAMILY_OF: dict[str, str] = {f: fam for fam, _e, fields, _w in FAMILIES for f in fields}
EDITION_OF: dict[str, str] = {fam: eid for fam, eid, _f, _w in FAMILIES}
WORDS_OF: dict[str, str] = {fam: w for fam, _e, _f, w in FAMILIES}
_WORKS = (" The change is kept in the Hub's database. A gate row, the sending line, the brakes (test mode, the "
          "message pause) and a correction sent to the people who got the old words stay an admin's.")
# Settings › Editions' catalogue entries (app/editions.py CATALOGUE), each off with nobody listed
EDITIONS: tuple[dict[str, str], ...] = (
    {"id": "smartComms.words", "app": EDITION_APP, "app_name": "Smart Comms",
     "label": "Words — the text message and the e-mail",
     "description": ("Change a situation's words on the Smart Comms Desk: its text message, its e-mail subject and its "
                     "e-mail. The new words are what the situation says the next time it speaks." + _WORKS)},
    {"id": "smartComms.switch", "app": EDITION_APP, "app_name": "Smart Comms",
     "label": "Switch — turn a situation on or off",
     "description": ("Turn a situation on or off on the Smart Comms Desk, from its card or its panel. Turned off, it "
                     "says nothing until somebody turns it on." + _WORKS)},
    {"id": "smartComms.audience", "app": EDITION_APP, "app_name": "Smart Comms",
     "label": "Audience — who it goes to and who is copied",
     "description": ("Change a situation's Goes to and Also copied: addresses written out (an e-mail with its domain, a "
                     "number with its ten digits) or a keyword the platform resolves (allstaff, housemanagers, "
                     "directors). A word that reaches nobody is refused, as it is for an admin." + _WORKS)},
    {"id": "smartComms.pacing", "app": EDITION_APP, "app_name": "Smart Comms",
     "label": "Pacing — channels, attempts, how often, the hours and the days before",
     "description": ("Change how a situation speaks: its channels (text, e-mail), how many times one person may be "
                     "told and how often, the hours of the day it may speak and how many days before a date it "
                     "starts. Hours nobody can read are refused, as they are for an admin." + _WORKS)},
    {"id": "smartComms.ai", "app": EDITION_APP, "app_name": "Smart Comms",
     "label": "AI — the model and the providers",
     "description": ("Change an AI row's model and its providers on the Smart Comms Desk. The prompt itself stays in "
                     "the code." + _WORKS)},
    {"id": "smartComms.recording", "app": EDITION_APP, "app_name": "Smart Comms",
     "label": "Recording — the sheet a situation records to",
     "description": ("Change a situation's Record to: a row with a sheet writes each message there and texts nobody; "
                     "cleared, it speaks again." + _WORKS)},
)

ADMIN_ONLY = "This action is for admin."
NOTHING = "Nothing to save."
GATE_HELD = "A gate stays an admin's to change — nothing was saved."
WITHHELD_HELD = ("A cell of this situation is withheld from the Hub's copy, so it is changed on the sheet itself — "
                 "nothing was saved.")
ARMED_HELD = "Saving is held on the platform right now — nothing was saved. Try again later."
BUSY = "Somebody else is saving on the platform right now — nothing was written. Try again in a moment."

# what JavaScript's \s and String.prototype.trim treat as white space
_JS_WS = "\t\n\x0b\x0c\r \xa0  -     　﻿"
_LIST_SPLIT = re.compile(r"[,;|\n]+")
_SLOT_SPLIT = re.compile(r"[,;\n|]+")
_SLOT = re.compile(r"([0-9]{1,2})[" + _JS_WS + r"]*(?::|h)?[" + _JS_WS + r"]*([0-9]{2})?[" + _JS_WS +
                   r"]*(am|pm|a|p)?\.?\Z")
_MAIL = re.compile(r"@[^@" + _JS_WS + r"]+\.[A-Za-z]{2,}\Z")
_NOT_DIGIT = re.compile(r"[^0-9]")
_NOT_LETTER = re.compile(r"[^a-z]")
_WITHHELD = re.compile(r"^\[withheld")


# ---- SmartComms.gs' small readers, as JavaScript reads them --------------------------------------------------------

def js_slice(s: str, n: int) -> str:
    """String.prototype.slice(0, n): n UTF-16 code units, a split pair dropped."""
    units = s.encode("utf-16-le", "surrogatepass")
    if len(units) <= 2 * n:
        return s
    cut = units[:2 * n]
    if 0xD8 <= cut[-1] <= 0xDB:
        cut = cut[:-2]
    return cut.decode("utf-16-le", "surrogatepass")


def smart_list(raw: Any) -> list[str]:
    """smartList_: a cell holding a list, split on comma, semicolon, pipe or newline."""
    return [x for x in (gsjs.trim(p) for p in _LIST_SPLIT.split(gsjs.or_text(raw))) if x]


def to_keyword(entry: Any) -> str:
    """smartToKeyword_: the keyword this entry is, or ''."""
    v = _NOT_LETTER.sub("", gsjs.trim(gsjs.or_blank(entry)).lower())
    return v if v in TO_KEYWORDS else ""


def addressable(raw: Any) -> bool:
    """smartAddressable_: an e-mail with its domain, ten digits, or a keyword the backend resolves."""
    for v in smart_list(raw):
        if "@" in v and _MAIL.search(v):
            return True
        if len(_NOT_DIGIT.sub("", v)) >= 10:
            return True
        if to_keyword(v):
            return True
    return False


def slots_parse(value: Any) -> dict[str, list]:
    """smartSlotsParse_: the hours a cell names (minutes of the day) and the pieces nobody can read."""
    out: dict[str, list] = {"slots": [], "bad": []}
    raw = gsjs.trim(gsjs.or_blank(value))
    if not raw:
        return out
    seen: set[int] = set()
    for piece in _SLOT_SPLIT.split(raw):
        t = gsjs.trim(piece).lower()
        if not t:
            continue
        m = _SLOT.match(t)
        if not m:
            out["bad"].append(gsjs.trim(piece))
            continue
        h, mi = int(m.group(1)), int(m.group(2)) if m.group(2) else 0
        ap = m.group(3)[0] if m.group(3) else ""
        if ap == "p" and h < 12:
            h += 12
        if ap == "a" and h == 12:
            h = 0
        if h > 23 or mi > 59:
            out["bad"].append(gsjs.trim(piece))
            continue
        if h * 60 + mi not in seen:
            seen.add(h * 60 + mi)
            out["slots"].append(h * 60 + mi)
    out["slots"] = sorted(out["slots"])[:SLOTS_MAX]
    return out


def correct_declared(v: Any) -> bool:
    """The save's correct_audience as smartCommsSet reads it."""
    return v is True or gsjs.or_text(v).lower() in ("true", "yes")


def sender_of(s: dict[str, str]) -> str:
    """commRepairSenderOf_: the row's own sender, else the code's."""
    return gsjs.trim(s.get("sender") or "") or SENDER_DEFAULT


def words_of(s: dict[str, str]) -> tuple[str, ...]:
    """What commRepairWordsSha_ hashes: the id, the three templates and the sender."""
    return (s.get("id") or "", s.get("sms_text") or "", s.get("email_subject") or "", s.get("email_text") or "",
            sender_of(s))


def line_known(lines: list, word: Any) -> dict[str, Any]:
    """hubLineSenderKnown_: may a `from_line` cell hold this word — {ok, why, names}."""
    w = gsjs.trim(gsjs.or_blank(word))
    if not w:
        return {"ok": True, "why": "", "names": []}
    m = SC.line_match(lines, w)
    names: list[str] = []
    for r in lines:
        label = (r.get("role") or r.get("name")) if isinstance(r, dict) else None
        if label and gsjs.js_str(label) not in names:
            names.append(gsjs.js_str(label))
    return {"ok": bool(m.get("line")), "why": "" if m.get("line") else m.get("why"), "names": names}


def directory_lines(reads: L.Reads) -> list:
    """hubLines_ as hubLineSenderKnown_ reads it: the directory's lines, none when it answers nothing."""
    try:
        got = LD.lines(reads)
    except (Defer, hubdb.Unreadable):
        raise
    except Exception:  # noqa: BLE001 - as Apps Script: a directory that throws names no line
        return []
    return list((got or {}).get("lines") or [])


# ---- who may save ---------------------------------------------------------------------------------------------------

def is_admin(user: dict[str, Any] | None) -> bool:
    """smartCommsSet's own rule: String(user.role) === 'admin'."""
    return bool(user) and gsjs.js_str((user or {}).get("role")) == "admin"


def held_families(sess: L.Session) -> dict[str, str]:
    """The field families this person changes by an edition, while App Control opens Smart Comms to them."""
    user = sess.user or {}
    if not user or user.get("is_service"):
        return {}
    cfg = sess.reads.config()
    held = {fam: eid for fam, eid in EDITION_OF.items() if sc.edition_allows(eid, user, cfg)}
    if not held:
        return {}
    try:
        got = sc.profile_app_gate(APP_ID, user, sess.reads.scope_sources())
    except (Defer, hubdb.Unreadable):
        raise
    except Exception:  # noqa: BLE001 - a gate that throws is shut
        return {}
    return held if got.get("open") is True else {}


def what_of(field: str) -> str:
    if field in FAMILY_OF:
        return WORDS_OF[FAMILY_OF[field]]
    if field == "from_line":
        return "the sending line"
    return f"the {field} cell"


def is_gate(was: dict[str, str]) -> bool:
    return gsjs.trim(was.get("kind") or "").lower() == "gate" or gsjs.trim(was.get("id") or "").startswith("gate_")


# ---- the house -------------------------------------------------------------------------------------------------------

def situations(reads: L.Reads) -> tuple[hubdb.Resolved, dict[str, Any], dict[str, list[tuple[dict, dict]]]]:
    """The live situations tab: where it is, its header by name, and each id's rows (as String(), and as the copy's
    text) in sheet order, Python's own kept edits laid; its own table once kept there (no book then)."""
    heads: dict[str, Any] = {}
    if HT.tabled(TAB):
        res = None
        cols, rows = HT.raw(reads, TAB)
        heads = {h: h for h in cols}
    else:
        res = W.tab_of(reads, TAB)
        if res.ref is None:
            raise Defer("the situations tab is not in the copy yet")
        for h in res.ref.headers:
            name = gsjs.trim(gsjs.js_str(h))
            if name and name not in heads:
                heads[name] = h
        rows = reads.db.rows(res.ref)
    missing = [h for h in SMART_HEADER if h not in heads]
    if missing:
        raise Defer("the situations tab's header lacks " + ", ".join(missing[:4]))
    index: dict[str, list[tuple[dict, dict]]] = {}
    for _rn, raw in rows:
        shown = {h: gsjs.js_str(hubdb.typed(raw.get(heads[h]), "hub")) for h in SMART_HEADER}
        text = {h: gsjs.or_blank(hubdb.typed(raw.get(heads[h]), "raw")) for h in SMART_HEADER}
        index.setdefault(gsjs.trim(shown["id"]), []).append((shown, text))
    return res, heads, index


def situation_keys(reads: L.Reads) -> dict[str, tuple[str, dict]]:
    """Each id's last row in the situations' own table: its row key and its cells as kept."""
    out: dict[str, tuple[str, dict]] = {}
    for key, _p, cells, kept in HT.placed(reads, TAB)[1]:
        out[gsjs.trim(gsjs.js_str(hubdb.typed(cells.get("id"), "hub")))] = (key, kept)
    return out


# ---- the door ---------------------------------------------------------------------------------------------------------

def judge(rows: list, index: dict[str, list], lines: Callable[[], list]) -> dict[str, Any] | None:
    """smartCommsSet's all-or-nothing validation: its 400, or None when every row may be written. `lines` reads the
    directory, asked only when a row names a sending line."""
    unknown: list[str] = []
    unaddressed: list[str] = []
    bad_hours: list[str] = []
    bad_lines: list[str] = []
    line_names: list[str] = []
    for row in rows:
        r = row if isinstance(row, dict) else {}
        rid = gsjs.str_(r.get("id"))
        if not rid or rid not in index:
            unknown.append(rid or "(blank)")
            continue
        if "to" in r and smart_list(r["to"]) and not addressable(r["to"]):
            unaddressed.append(f'{rid}: "{js_slice(gsjs.js_str(r["to"]), 40)}"')
        if "send_at" in r and gsjs.trim(gsjs.js_str(r["send_at"])):
            hrs = slots_parse(r["send_at"])
            if hrs["bad"]:
                bad_hours.append(f'{rid}: "' + '", "'.join(hrs["bad"]) + '"')
            elif not hrs["slots"]:
                bad_hours.append(f'{rid}: "{js_slice(gsjs.js_str(r["send_at"]), 40)}"')
        # an unknown line is refused at save rather than failing at the send door
        if "from_line" in r and gsjs.trim(gsjs.js_str(r["from_line"])):
            fl = line_known(lines(), r["from_line"])
            if not fl["ok"]:
                bad_lines.append(f'{rid}: "{js_slice(gsjs.js_str(r["from_line"]), 40)}" ({fl["why"]})')
                line_names = fl["names"]
    if not (unaddressed or unknown or bad_hours or bad_lines):
        return None
    refusal: list[str] = []
    if unaddressed:
        refusal.append("Nobody would be reached: " + " · ".join(unaddressed) + ". `to` holds e-mail addresses and phone "
                       "numbers written out — the only words allowed there are keywords this backend resolves (" +
                       ", ".join(TO_KEYWORDS) + "). Leave it blank if the lane resolves its own audience.")
    if unknown:
        refusal.append("No situation has the id " + " · ".join(unknown) + " — a row is editable here, never creatable.")
    if bad_hours:
        refusal.append("These hours could not be read: " + " · ".join(bad_hours) + ". Write times of day separated by "
                       "commas — 09:00, 13:00, 17:00 (9am and 21h are read too). Leave it blank for a row that speaks "
                       "whenever its sweep passes.")
    if bad_lines:
        refusal.append("No line of ours sends from: " + " · ".join(bad_lines) + ". Write a line's role, its name or "
                       "its number" + (" (" + ", ".join(line_names) + ")" if line_names else "") +
                       ", or leave it blank to send from " + SC.DEFAULT_LINE + ".")
    refusal.append(f"NOTHING WAS SAVED, including the other "
                   f"{max(0, len(rows) - len(unaddressed) - len(unknown) - len(bad_hours) - len(bad_lines))} row(s) "
                   f"in this save.")
    return {"status": 400, "message": " ".join(refusal),
            "data": {"saved": 0, "unknown": unknown, "unaddressed": unaddressed, "bad_hours": bad_hours,
                     "bad_lines": bad_lines}}


def smart_comms_set(sess: L.Session, payload: dict) -> Decision:
    """smartCommsSet: refused, or kept in app.edits, with the correction it declares carried in the same write."""
    started = time.monotonic()
    p = payload if isinstance(payload, dict) else {}
    reads = sess.reads
    admin = is_admin(sess.user)
    mine = {} if admin else held_families(sess)
    if not admin and not mine:
        return W.refuse(403, ADMIN_ONLY)
    rows = p.get("rows")
    if not isinstance(rows, list) or not rows:
        return W.refuse(400, NOTHING)
    res, _heads, index = situations(reads)
    sid, tab = W.where_of(res) if res is not None else ("", TAB)
    fresh: tuple = (sid,) if sid else ()
    held_lines: list[list] = []

    def lines() -> list:
        if not held_lines:
            held_lines.append(directory_lines(reads))
        return held_lines[0]

    refused = judge(rows, index, lines)
    if refused:
        return W.refuse(400, refused["message"], fresh=fresh, data=refused["data"])
    # every row known: each one as smartCommsSet writes it, the stored row and the payload's cells over it
    changed: list[dict[str, Any]] = []
    final: dict[str, dict[str, str]] = {}
    for r in rows:
        rid = gsjs.str_(r.get("id"))
        was, _text = index[rid][-1]
        after = {h: gsjs.js_str(r[h]) if h in r else was[h] for h in SMART_HEADER}
        changed.append({"id": rid, "before": was, "after": after, "correct": correct_declared(r.get("correct_audience")),
                        "what": gsjs.str_(r.get("what_was_wrong"))})
        final[rid] = after
    if not admin:
        not_theirs: list[str] = []
        for c in changed:
            if c["correct"] or c["what"]:
                not_theirs.append("a correction to the people who got the old words")
            moved = [h for h in SMART_HEADER if h != "id" and c["after"][h] != c["before"][h]]
            if moved and is_gate(c["before"]):
                return W.refuse(403, GATE_HELD, fresh=fresh)
            for h in moved:
                if FAMILY_OF.get(h) not in mine:
                    not_theirs.append(what_of(h))
        if not_theirs:
            said = list(dict.fromkeys(not_theirs))
            return W.refuse(403, "Only an admin changes " + (", ".join(said[:-1]) + " and " + said[-1] if len(said) > 1
                                                             else said[0]) + " here — nothing was saved.", fresh=fresh)
    # what each id's last row changes on the stored row, the id itself kept as stored
    writes_of: dict[str, dict[str, str]] = {}
    for rid, after in final.items():
        was = index[rid][-1][0]
        cells = {h: after[h] for h in SMART_HEADER if h != "id" and after[h] != was[h]}
        if not cells:
            continue
        if any(_WITHHELD.match(was[h]) or _WITHHELD.match(after[h]) for h in cells):
            return W.refuse(403, WITHHELD_HELD, fresh=fresh)
        writes_of[rid] = cells
    # the correction path: the words moved, declared wrong, with the sentence saying what — that save sends
    skipped: list[str] = []
    declared = False
    for c in changed:
        cid = c["after"]["id"] or c["before"]["id"] or ""
        if words_of(c["before"]) == words_of(c["after"]):
            skipped.append(f"{cid}: the words did not move")
        elif not c["correct"]:
            skipped.append(f"{cid}: the words moved, and nothing was declared wrong — an improvement")
        elif not c["what"]:
            skipped.append(f"{cid}: declared wrong with no sentence saying what — nothing was sent")
        elif not admin:
            return W.refuse(403, "Only an admin declares a correction — nothing was saved.", fresh=fresh)
        else:
            declared = True
    # never held by the book-write funnel: every gate, the funnel's own row with them, is switched here
    edits: list[dict[str, Any]] = []
    ops: list[dict[str, Any]] = []
    tabled = res is None
    keys = situation_keys(reads) if tabled and writes_of else {}
    editions: list[str] = []
    for rid, cells in writes_of.items():
        if tabled:
            # the table tells every row apart: the id's last row is written, as smartCommsSet did
            key, kept = keys[rid]
            RR.update(reads, HT.resource_of(TAB) or "", key, kept, cells, W.who(sess.user))
            if not admin:
                editions += [EDITION_OF[FAMILY_OF[h]] for h in cells if EDITION_OF[FAMILY_OF[h]] not in editions]
            continue
        text = index[rid][-1][1]
        if len(index[rid]) > 1:
            # an id on more than one row, which no kept edit tells apart: written on the last, as smartCommsSet did
            spec = {"match": "id", "key": rid, "cells": cells, "before": {h: text[h] for h in cells}}
            if not admin:
                spec["editions"] = sorted({EDITION_OF[FAMILY_OF[h]] for h in cells})
            ops.append({"op": "cells", "sheet_id": sid, "tab": tab, "spec": spec})
            continue
        if admin:
            edits.append(W.kept_record(sid, tab, "edit", "id", rid, SUBJECT, cells,
                                       before={h: text[h] for h in cells}))
            continue
        for fam, eid, fields, _w in FAMILIES:
            part = {h: v for h, v in cells.items() if h in fields}
            if part:
                edits.append(W.kept_record(sid, tab, "edit", "id", rid, SUBJECT, part,
                                           before={h: text[h] for h in part}, edition=eid))
    BO.queue(ops, EVENT, W.who(sess.user), ACTION)
    correction: dict[str, Any] = {"discovered": 0, "incidents": [], "said": 0, "audience": 0, "skipped": skipped,
                                  "woke": ""}
    if declared:
        correction, more = correct(reads, changed, sess.user, started)
        edits += more
    answer = {"status": 200, "data": {"saved": len(rows), "unknown": [], "unaddressed": [], "bad_hours": [],
                                      "correction": correction}}
    d = W.final(answer, edits, SUBJECT)
    if tabled and writes_of:
        d.own, d.subject, d.edition = True, SUBJECT, d.edition or ",".join(editions)
    d.fresh = fresh
    return d


def correct(reads: L.Reads, changed: list[dict[str, Any]], user: dict[str, Any] | None,
            started: float) -> tuple[dict[str, Any], list[dict]]:
    """commRepairOnWordsChanged_ after the save: the incidents declared and the first few people told, with the
    repair's own edits; the save is not lost because the apology failed (what it began is rolled back)."""
    import comm_repair_writes as CRW  # noqa: PLC0415 - the repair lane reads this module's own helpers
    try:
        with SC._guard(RR._cur()):
            out, house, more = CRW.on_words_changed(reads, changed, user, started)
    except (Defer, hubdb.Unreadable, W.Busy):
        raise
    except Exception as exc:  # noqa: BLE001 - said in the answer and the log, never a lost save
        why = str(exc) or type(exc).__name__
        CRW.log_line(gsjs.str_((user or {}).get("email")), "smart_comms_correction_error",
                     "the words were saved and the correction could not be started: " + why, 500)
        return {"error": why}, []
    return out, (house.edits() if house is not None else []) + more


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {ACTION: smart_comms_set}
# HUB_POLICY.smartCommsSet names admin alone; the door answers that sentence itself, so a listed holder reaches it
POLICY: dict[str, dict[str, Any]] = {ACTION: {"roles": ()}}
# the platform's write lock held by another write: never a 409, which the Desk reads as a save that landed
BUSY_OF: dict[str, dict[str, Any]] = {ACTION: {"status": 503, "message": BUSY}}


class Store(RR.Store):
    """app.smart_comms_writes and app.smart_comms_receipts, beside the other apps' own."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="smart_comms", label="Smart Comms")
