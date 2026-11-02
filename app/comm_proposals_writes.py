"""Smart Comms' proposals doors (apps-script/CommProposals.gs) decided off asa-hub-db and kept in app.edits: the
counter's feed (commProposalsIngest, the relay's own: the day's proposals upserted into the comm_proposals house by id,
a person's answer and a person's columns never touched) and a person's decision on the Desk (commProposalsDecide: one
row appended to the comm_vocabulary house, a yes or a no). The Desk's read is smart_comms_desk.proposals_list; nothing
here sends, and nothing here reaches the shipped lists."""
from __future__ import annotations

import re
import uuid
from typing import Any, Callable

import gsjs
import hubdb
import locations as L
import resource_rows as RR
import smart_comms_desk as D
import smart_comms_doors as SD
import smart_comms_writes as SW
import staff_views
import writes as W
from writes import Decision

INGEST, DECIDE = "commProposalsIngest", "commProposalsDecide"
# the pack key the relay reads again after a kept write
SUBJECT = "proposals"
PROPOSALS_TAB, VOCAB_TAB = D.COMM_PROPOSALS_TAB, D.COMM_VOCAB_TAB
# COMM_PROPOSALS_COLUMNS: the header the mint declared, in its order
COLUMNS = ("id", "created_at", "status", "vocabularies_allowed", "phrase", "tokens", "family", "shape", "evidence_n",
           "people_n", "coverage", "leak_control", "leak_contains", "would_catch", "would_catch_wrongly", "verdict",
           "why", "merged_list", "shipped_intact", "example", "example_ref", "example_withheld", "corpus_n",
           "control_n", "decided_at", "decided_by", "notes")
# COMM_VOCAB_COLUMNS: a person's half of what this file writes, and append-only
VOCAB_COLUMNS = ("id", "created_at", "decision", "vocabulary", "phrase", "phrase_norm", "proposal_id", "family",
                 "evidence_n", "people_n", "coverage", "would_catch", "would_catch_wrongly", "example_ref",
                 "decided_by", "decided_at", "reason", "source")
MAX_TOKENS, MAX_CHARS = 4, 60
INGEST_CAP = 60
# the two words a machine may file, the two that mean somebody already answered, the cells it never writes
FEED_STATUS = ("proposed", "blocked")
DECIDED_STATUS = ("approved", "rejected")
PERSON_COLUMNS = ("decided_at", "decided_by")
# COMM_PROPOSALS_REFUSED: the line the door will not cross
REFUSED = ("text", "body", "message", "messages", "member", "members", "texts", "raw", "payload", "person_key",
           "person_name", "name", "from", "to", "from_key", "phone", "email", "number", "masked", "masked_number",
           "sid", "thread_id")
# HUB_POLICY's params of each door, in their declared order: (name, required, type)
PARAMS = {INGEST: (("rows", True, "array"),),
          DECIDE: (("id", True, "string"), ("decision", True, "string"), ("vocabulary", False, "string"),
                   ("reason", False, "string"))}
# hubSysLog_'s actor for the feed's lines
ACTOR = {"email": "asa-hub:comm", "display_name": "asa-hub:comm"}
FEED_BUSY = "The proposals feed is already running."

_WS = re.compile("[" + D._JS_WS + "]+")
_ID = re.compile(r"CP_[A-Za-z0-9_]+")
_COUNT = re.compile(r"[0-9]+(?:\.[0-9]+)?")
_LIST = re.compile(r"[,;]+")
_WITHHELD = re.compile(r"^\[withheld")

s_ = gsjs.str_


def _obj(v: Any) -> dict:
    return v if isinstance(v, dict) else {}


def param_refusal(action: str, p: dict[str, Any]) -> str:
    """hubPolicyGate_'s params: a required one missing, or one of the wrong type; '' when every one passes."""
    for key, required, kind in PARAMS[action]:
        v = p.get(key)
        missing = v is None or (isinstance(v, str) and v == "")
        if required and missing:
            return f"Missing required parameter: {key}."
        if not missing and SD.js_type(v) != kind:
            return f"{key} must be {kind}, got {SD.js_type(v)}."
    return ""


def log_line(action: str, target: str) -> None:
    """hubSysLog_ under the feed's own actor."""
    staff_views.record(ACTOR, action, target)


# ---- the machine's door, the pure half -------------------------------------------------------------------------------

def text(v: Any) -> str:
    """commProposalsText_: a value as the text this house stores."""
    if v is None or isinstance(v, gsjs.SheetDate):
        return ""
    return gsjs.trim(_WS.sub(" ", gsjs.js_str(v)))


def count(v: Any) -> str:
    """commProposalsCount_: a count, or '' — and never 0."""
    t = text(v)
    return t if t and _COUNT.fullmatch(t) else ""


def vocab_list(v: Any) -> list[str]:
    """commProposalsVocabList_: the lists a row offers a person, normalised."""
    out: list[str] = []
    for s in _LIST.split(text(v)):
        n = text(s).lower()
        if n and n not in out:
            out.append(n)
    return out


def offers_release(row: Any) -> str:
    """commProposalsOffersRelease_: which release list a row offers, or ''."""
    return next((v for v in vocab_list(_obj(row).get("vocabularies_allowed")) if v in D.COMM_VOCAB_FORBIDDEN), "")


def owned(key: str) -> bool:
    """commProposalsOwned_: is this column a person's to write?"""
    return key in PERSON_COLUMNS


def feed_refusal(row: Any) -> str:
    """commProposalsFeedRefusal_: may this handed-over row be filed at all?"""
    r = _obj(row)
    release = offers_release(r)
    if release:
        return (f"the row offers {release}, which is never proposed: approving one is a way to un-silence somebody "
                "who asked to be left alone, and that mistake arrives as a message already sent")
    pid = text(r.get("id"))
    if not pid:
        return "no id — a proposal nothing can address cannot be re-read, matched or decided"
    if not _ID.fullmatch(pid):
        return "the id is not one the counter mints"
    status = text(r.get("status")).lower()
    if status not in FEED_STATUS:
        return (f'a machine may file "{FEED_STATUS[0]}" or "{FEED_STATUS[1]}", never "{status or "(nothing)"}" — a '
                "decision belongs to the person who takes it")
    if not vocab_list(r.get("vocabularies_allowed")):
        return "the row names no list a person could file it under"
    phrase = D.vocab_norm(r.get("phrase"))
    if not phrase:
        return "the phrase is empty once normalised the way the lane normalises a reply"
    if SD.utf16_len(phrase) > MAX_CHARS:
        return f"the phrase is {SD.utf16_len(phrase)} characters; a vocabulary entry is a whole short message"
    if len(phrase.split(" ")) > MAX_TOKENS:
        return (f"the phrase is {len(phrase.split(' '))} words, and the lane compares WHOLE bodies — it could never "
                "fire, so filing it would look like teaching and teach nothing")
    return ""


def ingest_clean(row: Any) -> dict[str, str] | None:
    """commProposalsIngestClean_: one handed-over row as the line this house stores, or None."""
    if feed_refusal(row):
        return None
    r = _obj(row)

    def cut(k: str, n: int) -> str:
        return SW.js_slice(text(r.get(k)), n)
    return {"id": cut("id", 120), "created_at": cut("created_at", 40), "status": text(r.get("status")).lower(),
            "vocabularies_allowed": ", ".join(vocab_list(r.get("vocabularies_allowed"))),
            "phrase": cut("phrase", MAX_CHARS), "tokens": count(r.get("tokens")), "family": cut("family", 80),
            "shape": cut("shape", 24), "evidence_n": count(r.get("evidence_n")), "people_n": count(r.get("people_n")),
            "coverage": count(r.get("coverage")), "leak_control": count(r.get("leak_control")),
            "leak_contains": count(r.get("leak_contains")), "would_catch": count(r.get("would_catch")),
            "would_catch_wrongly": count(r.get("would_catch_wrongly")), "verdict": cut("verdict", 24),
            "why": cut("why", 400), "merged_list": cut("merged_list", 1000), "shipped_intact": cut("shipped_intact", 8),
            # the words travel only as far as the counter already allowed
            "example": cut("example", 300), "example_ref": cut("example_ref", 200),
            "example_withheld": cut("example_withheld", 200), "corpus_n": count(r.get("corpus_n")),
            "control_n": count(r.get("control_n")), "notes": cut("notes", 400)}


def crossed(rows: list[Any]) -> list[str]:
    """commProposalsCrossed_: which refused columns a hand-over carried, if any."""
    names: list[str] = []
    for r in rows:
        r = _obj(r)
        names.extend(n for n in REFUSED if n not in names and n in r)
    return names


# ---- the houses ------------------------------------------------------------------------------------------------------

def house_of(reads: L.Reads, tab: str) -> tuple[hubdb.Resolved, str]:
    """hubTabEnsure_ of a declared house: where it lives, and the tab its rows land in — the copy's own, else the
    tab's own name, which hubHouseTabIn_ opens first and the house was minted with (the copy holds no tab with no
    rows)."""
    res = D.where(reads, tab)
    D.must_book(res, tab)
    return res, res.ref.tab if res.ref is not None else tab


def grid(reads: L.Reads, res: hubdb.Resolved) -> tuple[list[str], list[tuple[int, dict[str, Any]]]]:
    """commProposalsGrid_ after ensureHeader_: the house's header with the declared columns it lacks after its own,
    and each row's cells as getValues() hands back a cell written as text."""
    ref = res.ref
    have = [gsjs.js_str(h) for h in ref.headers] if ref is not None else []
    header = have + [c for c in COLUMNS if c not in have]
    rows = [] if ref is None else [(rn, {gsjs.js_str(h): hubdb.typed(raw.get(h), "raw") for h in ref.headers})
                                   for rn, raw in reads.db.rows(ref)]
    return header, rows


def upsert(incoming: list[dict[str, str]], header: list[str], rows: list[tuple[int, dict[str, Any]]]) -> dict[str, Any]:
    """commProposalsUpsert_: append what is new, patch what moved, touch nothing else; `patches` are the rows patched
    (their index, the cells and what they held), `appended` the lines born."""
    col = {h: i for i, h in enumerate(header)}
    if "id" not in col:
        return {"error": f'the {PROPOSALS_TAB} house lacks an "id" column'}
    at: dict[str, int] = {}
    for i, (_rn, cells) in enumerate(rows):
        id0 = text(cells.get("id"))
        if id0 and id0 not in at:
            at[id0] = i
    out: dict[str, Any] = {"inserted": 0, "updated": 0, "unchanged": 0, "kept_decision": 0, "appended": [],
                           "writes": 0, "patches": {}}
    for item in incoming:
        pid = text(item.get("id"))
        if not pid:
            continue
        row = at.get(pid)
        if row is None:
            line = {h: "" for h in header}
            line["id"] = pid
            line.update({k: v for k, v in item.items() if k != "id" and k in col and not owned(k)})
            out["appended"].append(line)
            out["inserted"] += 1
            # a key handed over twice in one payload patches its own new line rather than appending a second one
            at[pid] = -len(out["appended"])
            continue
        if row < 0:
            out["appended"][-row - 1].update({k: "" if v is None else v for k, v in item.items()
                                              if k != "id" and k in col and not owned(k)})
            continue
        cur = rows[row][1]
        touched = held = False
        for k, v in item.items():
            if k in ("id", "created_at") or k not in col or owned(k):
                continue
            if k == "status" and text(cur.get("status")).lower() in DECIDED_STATUS:
                held = True
                continue
            v = "" if v is None else v
            was = cur.get(k)
            # a withheld cell is neither compared nor written
            if _WITHHELD.match(gsjs.or_blank(was)):
                continue
            if text(was) != text(v):
                patch = out["patches"].setdefault(row, {"cells": {}, "before": {}})
                patch["before"].setdefault(k, gsjs.or_blank(was))
                patch["cells"][k] = v
                cur[k] = v
                touched = True
        if held:
            out["kept_decision"] += 1
        if touched:
            out["updated"] += 1
        else:
            out["unchanged"] += 1
    idxs = sorted(out["patches"])
    # one write per run of adjacent sheet rows, and one for every line appended
    out["writes"] = sum(1 for n, i in enumerate(idxs) if n == 0 or rows[i][0] != rows[idxs[n - 1]][0] + 1)
    if out["appended"]:
        out["writes"] += 1
    return out


def row_match(rows: list[tuple[int, dict[str, Any]]], i: int) -> tuple[str, str] | None:
    """The kept edit's key for the first row an id names: the id alone, else the id with its first day."""
    pid = text(rows[i][1].get("id"))
    if sum(1 for _rn, cells in rows if text(cells.get("id")) == pid) == 1:
        return "id", pid
    return W.row_key_of(rows, i, [["id", "created_at"]])


# ---- the doors -------------------------------------------------------------------------------------------------------

def ingest(sess: L.Session, payload: dict) -> Decision:
    """commProposalsIngest: what the counter counted, filed where a person can read it — upserted by proposal id, a
    person's answer kept, at most INGEST_CAP rows a call (the rest said as overflow, for the relay to send again)."""
    p = payload if isinstance(payload, dict) else {}
    bad = param_refusal(INGEST, p)
    if bad:
        return W.refuse(400, bad)
    user = sess.user or {}
    if not user.get("is_service") and not D.is_admin(user):
        return Decision(dict(D.DENIED))
    rows = p.get("rows") or []
    if not rows:
        # a day with nothing to propose is not a day the lane did not run
        return Decision({"status": 200, "data": {"received": 0, "kept": 0, "refused": 0, "release_refused": 0,
                                                 "overflow": 0, "inserted": 0, "updated": 0, "unchanged": 0,
                                                 "writes": 0, "converged": True, "note": "nothing was handed over"}})
    reads = sess.reads
    if not reads.db.house_moved(PROPOSALS_TAB):
        return W.refuse(409, f"The {PROPOSALS_TAB} house is not declared — run tools/mint_comm_proposals_house.py. "
                             "Nothing was written.")
    cross = crossed(rows)
    clean: list[dict[str, str]] = []
    seen: set[str] = set()
    refused = release = proposed = blocked = 0
    reasons: list[str] = []
    for r in rows:
        if len(clean) >= INGEST_CAP:
            break
        if offers_release(r):
            release += 1
        why = feed_refusal(r)
        if why:
            refused += 1
            if why not in reasons and len(reasons) < 4:
                reasons.append(why)
            continue
        item = ingest_clean(r)
        if item is None or item["id"] in seen:
            refused += 1
            continue
        seen.add(item["id"])
        if item["status"] == "blocked":
            blocked += 1
        else:
            proposed += 1
        clean.append(item)
    overflow = max(0, len(rows) - refused - len(clean))
    if release:
        log_line("comm_proposals_release_refused", f"{release} row(s)")
    if cross:
        log_line("comm_proposals_columns_refused", ", ".join(cross))
    if not clean:
        return W.refuse(400, "No usable row: " + (" · ".join(reasons) or "every row was refused"))

    res, tab = house_of(reads, PROPOSALS_TAB)
    fresh = (res.sheet_id,)
    header, now_rows = grid(reads, res)
    if not header:
        return W.refuse(409, f"The {PROPOSALS_TAB} house has no readable header.", fresh=fresh)
    got = upsert(clean, header, now_rows)
    if got.get("error"):
        return W.refuse(400, got["error"], fresh=fresh)
    edits = []
    for i, patch in sorted(got["patches"].items()):
        key = row_match(now_rows, i)
        if key is None:
            return W.refuse(409, f"A proposal is written more than once in the {PROPOSALS_TAB} house and nothing tells "
                                 "the rows apart, so nothing was written.", fresh=fresh)
        edits.append(W.kept_record(res.sheet_id, tab, "edit", key[0], key[1], SUBJECT, patch["cells"],
                                   before=patch["before"]))
    for line in got["appended"]:
        edits.append(W.kept_record(res.sheet_id, tab, "append", "id", line["id"], SUBJECT,
                                   {h: v for h, v in line.items() if h == "id" or W.sheet_text(v) != ""}))
    moved = got["inserted"] + got["updated"]
    if moved or overflow or refused:
        log_line("comm_proposals_ingested",
                 f"{got['inserted']} added, {got['updated']} patched, {got['unchanged']} unchanged — {got['writes']} "
                 f"write(s) · {proposed} proposed · {blocked} blocked"
                 + (f" · {got['kept_decision']} already answered by a person, kept" if got["kept_decision"] else "")
                 + (f" · {refused} refused at the door" if refused else "")
                 + (f" · {overflow} past the cap, not seen" if overflow else ""))
    answer = {"status": 200, "data": {
        "received": len(rows), "kept": len(clean), "refused": refused, "release_refused": release,
        "overflow": overflow, "inserted": got["inserted"], "updated": got["updated"], "unchanged": got["unchanged"],
        "writes": got["writes"], "kept_decision": got["kept_decision"], "proposed": proposed, "blocked": blocked,
        "converged": moved == 0, "dropped_columns": cross, "why": reasons}}
    d = W.final(answer, edits, SUBJECT)
    d.fresh = fresh
    return d


def vocabulary_refusal(vocab: str, phrase: str, proposal: dict | None) -> str:
    """commVocabularyRefusal_: may this phrase be filed under this vocabulary?"""
    if vocab in D.COMM_VOCAB_FORBIDDEN:
        return ('The opt-in list may never be taught. Approving a way to say "start" releases a suppression somebody '
                "asked for, and a false positive there texts a person who told us to stop.")
    if vocab not in D.COMM_VOCAB_PROPOSABLE:
        return f'"{vocab}" is not a vocabulary this door files into.'
    if not phrase:
        return "The phrase is empty once normalised the way the lane normalises a reply."
    if SD.utf16_len(phrase) > MAX_CHARS:
        return f"The phrase is {SD.utf16_len(phrase)} characters; a vocabulary entry is a whole short message."
    if len(phrase.split(" ")) > MAX_TOKENS:
        return (f"The phrase is {len(phrase.split(' '))} words. The lane compares the WHOLE body against each entry, "
                "so a phrase this long could never fire — approving it would change nothing and look like it had.")
    if phrase in D.vocab_shipped("opt_in_phrases"):
        return (f'The release list already carries "{phrase}". A brake is compared first, so filing it here would '
                "silence the people who typed it to be let back in.")
    if phrase in D.vocab_shipped(vocab):
        return f'The shipped list already carries "{phrase}" — approving it would change nothing.'
    if proposal:
        if gsjs.or_blank(proposal.get("status")) == "blocked" or gsjs.or_blank(proposal.get("verdict")) == "blocked":
            return ("The counter marked this one blocked: "
                    + (gsjs.or_text(proposal.get("why")) or "it leaks into replies the machine already read correctly")
                    + ".")
        if gsjs.or_blank(proposal.get("shipped_intact")) != "yes":
            return ("The counter could not show that every shipped brake word survives beside this phrase "
                    f'(shipped_intact = "{s_(proposal.get("shipped_intact"))}"). Nothing is pasted anywhere by this '
                    "door, but a drift between the two copies of the shipped list is a reason to stop, not a reason "
                    "to proceed.")
    return ""


def decide(sess: L.Session, payload: dict) -> Decision:
    """commProposalsDecide: a person's yes or no, appended as one row of the vocabulary house — the phrase read from
    the proposals house, never from the payload; a refusal binds across every list."""
    p = payload if isinstance(payload, dict) else {}
    bad = param_refusal(DECIDE, p)
    if bad:
        return W.refuse(400, bad)
    user = sess.user or {}
    if not D.is_admin(user):
        return Decision(dict(D.DENIED))
    pid, decision = s_(p.get("id")), s_(p.get("decision")).lower()
    if not pid:
        return W.refuse(400, "Which proposal? An id is required.")
    if decision not in ("approve", "reject"):
        return W.refuse(400, 'A decision is "approve" or "reject".')
    reads = sess.reads
    props = D.proposals_rows(reads)
    if props["why"]:
        return W.refuse(409, props["why"])
    proposal = next((r for r in props["rows"] if r["id"] == pid), None)
    if proposal is None:
        return W.refuse(404, f'No proposal with id "{pid}" is in {PROPOSALS_TAB}.',
                        fresh=(reads.db.resolve(PROPOSALS_TAB).sheet_id,))
    phrase = D.vocab_norm(proposal["phrase"])
    vocab = s_(p.get("vocabulary"))
    if not vocab:
        allowed = [a for a in (s_(x) for x in _LIST.split(gsjs.or_text(proposal["vocabularies_allowed"]))) if a]
        vocab = allowed[0] if len(allowed) == 1 else ""
    decisions = D.vocabulary_rows(reads)
    if not decisions["declared"] or decisions["why"]:
        return W.refuse(409, decisions["why"] or "The vocabulary house is not declared, so a decision could not be "
                                                 "recorded — and a decision nobody can read is not a decision.")
    for row in decisions["rows"]:
        # a refusal binds across every list
        same_phrase = row["phrase"] == phrase and (row["decision"] == "rejected" or not vocab
                                                   or row["vocabulary"] == vocab)
        if (row["proposal_id"] and row["proposal_id"] == pid) or same_phrase:
            return Decision({"status": 200, "data": {
                "already": True, "decision": row["decision"], "row": row,
                "message": f'"{proposal["phrase"]}" was already {row["decision"]}'
                           + (f" by {row['decided_by']}" if row["decided_by"] else "")
                           + (f" on {SW.js_slice(row['decided_at'], 10)}" if row["decided_at"] else "") + "."}})

    now = W.now_iso(reads)
    who = s_(user.get("email")) or "asa-hub"
    rec = {"id": "CV_" + re.sub(r"[^0-9]", "", now)[:14] + "_" + str(uuid.uuid4())[:6], "created_at": now,
           "decision": "rejected" if decision == "reject" else "approved", "vocabulary": vocab,
           "phrase": proposal["phrase"], "phrase_norm": phrase, "proposal_id": pid, "family": proposal["family"],
           "evidence_n": proposal["evidence_n"], "people_n": proposal["people_n"], "coverage": proposal["coverage"],
           "would_catch": proposal["would_catch"], "would_catch_wrongly": proposal["would_catch_wrongly"],
           "example_ref": proposal["example_ref"], "decided_by": who, "decided_at": now,
           "reason": s_(p.get("reason")), "source": DECIDE}
    if decision == "reject":
        # a refusal is a decision, recorded in the same place as a yes, under the list it was offered for (or none)
        rec["reason"] = rec["reason"] or "refused on the screen; no reason typed"
        return kept(reads, rec, {"status": 200, "data": {
            "decision": "rejected", "phrase": proposal["phrase"],
            "message": f'"{proposal["phrase"]}" is refused, and the counter will not raise it again.'}})

    if not vocab:
        return W.refuse(400, "Choose which list this word joins — the proposal offers "
                        + (proposal["vocabularies_allowed"] or ", ".join(D.COMM_VOCAB_PROPOSABLE)) + ".")
    refusal = vocabulary_refusal(vocab, phrase, proposal)
    if refusal:
        return W.refuse(400, refusal)
    if len(D.vocab_learned(decisions)[vocab]) >= D.COMM_VOCAB_MAX_LEARNED:
        return W.refuse(409, f"The {vocab} list already carries {D.COMM_VOCAB_MAX_LEARNED} learned words, which is as "
                             "long as a list a person can still hold in their head. Retire one in the house before "
                             "teaching another.")
    # the learned list as the lane reads it once this row is in the house
    after = D.vocab_learned({"why": "", "rows": decisions["rows"] + [
        {"decision": "approved", "vocabulary": vocab, "phrase": phrase}]})[vocab]
    return kept(reads, rec, {"status": 200, "data": {
        "decision": "approved", "vocabulary": vocab, "phrase": phrase, "learned": len(after),
        "message": f'"{phrase}" joins {vocab}. One row was appended and nothing else changed — the shipped words are '
                   "untouched and the lane reads the new one within a minute."}})


def kept(reads: L.Reads, rec: dict[str, str], answer: dict[str, Any]) -> Decision:
    """hubAppendRow_ of the vocabulary house: the row's cells under the house's header (all of them while the copy
    holds no tab of it), kept in app.edits."""
    res, tab = house_of(reads, VOCAB_TAB)
    heads = {gsjs.js_str(h) for h in res.ref.headers} if res.ref is not None else set(VOCAB_COLUMNS)
    cells = {k: v for k, v in rec.items() if k in heads and (k == "id" or v != "")}
    d = W.final(answer, [W.kept_record(res.sheet_id, tab, "append", "id", rec["id"], SUBJECT, cells)], SUBJECT)
    d.fresh = (reads.db.resolve(PROPOSALS_TAB).sheet_id, res.sheet_id)
    return d


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {INGEST: ingest, DECIDE: decide}
# HUB_POLICY names admin for both (the feed also answers the relay's service identity); the params each door checks
POLICY: dict[str, dict[str, Any]] = {INGEST: {"roles": ("admin",)}, DECIDE: {"roles": ("admin",)}}
# the platform's write lock held by another write: the feed's own tryLock refusal, the Desk's 503
BUSY_OF: dict[str, dict[str, Any]] = {INGEST: {"status": 409, "message": FEED_BUSY},
                                      DECIDE: {"status": 503, "message": SW.BUSY}}


class Store(RR.Store):
    """app.comm_proposals_writes and _receipts, for the doors under an id of their own; joined to Smart Comms' writes
    (main.py), Smart Comms' store decides them instead."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="comm_proposals", label="Smart Comms' proposals")
