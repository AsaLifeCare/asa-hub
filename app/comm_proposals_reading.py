"""THE REPLIES TEACH THE COMMS LANE — deterministically.

the old platform's app/analytics/comm_proposals.py translated here: its houses are read off asa-hub-db's copy
(rows_from_mirror below), never off the old platform's sheet mirror; the counting is unchanged.

So nothing here knows anything. It counts.

The decoder's lane (server/digest_proposals.py) learned this the hard way: a
paper called "Pink Slip" was GUESSED to be Ohio's emergency-admission form
when its own letterhead said "Missing Medication Notification". The one
mistake of that day happened exactly where knowledge was used instead of
evidence. The technique is copied here on purpose and rewritten from nothing,
because the two lanes must never share a tab, a list, or a helper.

WHAT IS FROZEN IN THE COMMS LANE. OptOut.gs ships four fixed vocabularies —
OPT_OUT_PHRASES_SHIPPED, OPT_IN_PHRASES_SHIPPED, WRONG_NUMBER_PHRASES_SHIPPED,
and the parser that reads an availability answer. When somebody writes back in
a way none of them knows, the reply lands in a person's queue and the platform
learns nothing from it, ever. The same unreadable phrasing arrives a hundred
times and is filed a hundred times.

  1. THE FAMILY — replies nobody could classify, grouped by the SHAPE a
     vocabulary match must have (see `family_of`).
  2. THE PHRASE — n-grams that appear in at least COVERAGE of the family AND
     are absent from everything the machine already read correctly. Shared and
     distinctive, or not a phrase. One that leaks is still WRITTEN, marked
     `blocked` and unapprovable: a silent rejection teaches nobody, and the
     phrase the lane keeps almost learning is worth seeing.
  3. THE PROPOSAL — a ROW in this module's own house, never a rule. It carries
     what it would have caught and WHAT IT WOULD HAVE CAUGHT WRONGLY, because
     a proposal nobody can judge is a proposal that gets approved blindly.
  4. THE PERSON — approves it on a screen. Nothing here is published, nothing
     is deployed, and no name of any person leaves this machine.

═══ WHAT A FAMILY IS HERE ═══════════════════════════════════════════════════

In the decoder a family is papers sharing a title. A reply has no title. Three
candidates were weighed against what is actually in the houses:

  (a) replies to the same SITUATION — dead. Measured on the live mirror, 49 of
      63 unclear contributions carry correlation `none`: they have no
      situation. A family definition that needs the very thing that was
      missing is a definition that never fires.
  (b) replies the machine read the same WRONG way — dead. All 63 carry
      kind `unclear`. One bucket cannot discriminate.
  (c) replies of the same SHAPE — chosen.

And the shape is not a matter of taste; the lane dictates it. `optOutIntent_`
compares the WHOLE normalized body against each vocabulary. A vocabulary entry
is therefore never a substring — it is an entire short message. So:

    a family = replies whose whole normalized text could BE a vocabulary
    entry, grouped by (token-count band, first token).

Bands: `solo` (1 token), `short` (2-4). A reply of 5+ tokens is counted as
material and reported, but can never be proposed, because under the lane's own
matcher it could never fire. That last rule is what keeps "I am able to start
Wednesday" — a real line from the mirror — out of the opt-in vocabulary.

═══ WHICH VOCABULARIES MAY BE PROPOSED ══════════════════════════════════════

  opt_out_phrases       YES. A brake. A false positive silences somebody who
                        did not ask to be silenced — a real harm, but one that
                        errs toward NOT contacting, and one a person can undo
                        (`optOutRelease_` exists).
  wrong_number_phrases  YES. Same direction, same undo. It records that OUR
                        data is wrong; it is not a decision of theirs.
  availability_phrases  YES. It changes no suppression at all — only how a
                        shift preference is read, which the demand owner sees
                        and corrects. This is also where the live material
                        actually is: "Afternoons", "Days please.",
                        "midnights if possible", "On a monthly" are all
                        sitting unread in the unclear pile.
  opt_in_phrases        NEVER. Approving one appends a way to RELEASE a
                        suppression somebody asked for, and a false positive
                        there texts a person who told us to stop. The shipped
                        list already carries the scar: "YES" was on it until
                        the mirror was measured — of 89 messages it would have
                        matched, 88 were the bare word "yes" answering a
                        question and one was a real "start". A counter cannot
                        tell a release from an agreement, because they are the
                        same words. The safe answer is the right one, and the
                        corpus says so twice: "Yes", "Yes sir" and "Yes — the
                        candidate sent it to me" are all in the unclear pile.

The vocabulary is never GUESSED from a phrase's meaning. This module does not
assign one. It writes the phrase with `vocabularies_allowed` naming the three
a person may choose from, and `opt_in_phrases` is not among them — the one
decision that requires meaning belongs to the person, and the one that must
never be made is removed from the screen rather than argued with.

═══ THE REPLACE-NOT-ADD HAZARD ══════════════════════════════════════════════

`optOutPhrases_` reads a configurable list from Settings and REPLACES the
shipped one when non-empty. A person who pastes an approved phrase into
Settings on its own DELETES every shipped brake word — "stop", "unsubscribe",
"cancel" — with one save. So a proposal never carries a bare phrase to be
pasted. It carries `merged_list`: the entire shipped list plus the new phrase,
already joined, and `shipped_intact` computed by checking every shipped word
survived. A proposal whose `shipped_intact` is not `yes` is blocked.

═══ NO NAMES ════════════════════════════════════════════════════════════════

A reply is a person writing about their own life. The live pile holds first
names, full names, a client's initials and a dollar amount. Four guarantees,
each a gate rather than an intention:

  1. every text is redacted BEFORE it is counted — e-mail, URL, any run of 4+
     digits, any money amount, any token in the roster ban list built from the
     lane's own `comm_routes` names and the houses' `person_name` columns, and
     any capitalised token that is not sentence-initial (proper-noun shape);
  2. a candidate phrase is re-run through the redactor and DROPPED if the
     redactor would have touched it — a phrase that needs redacting is not a
     vocabulary word;
  3. a phrase must be written independently by MIN_PEOPLE different people —
     one person's habit is not a vocabulary;
  4. a phrase must EQUAL the whole text of a family member the redactor never
     touched, so no phrase is ever assembled out of the hole where a name used
     to be, and no phrase is a fragment nobody actually sent;
  5. `example` holds only members the redactor left untouched, at most two.
     Every other member still counts toward evidence_n, but its words do not
     travel: `example_ref` names the house and the message ids, and
     `example_withheld` says how many were held back and why. A person with
     the access to read the reply goes and reads it where it lives. The
     pointer travels; the words do not.

This module writes to no lane tab, no Settings key and no spreadsheet the
comms lane reads. It reads asa-hub-db's copy of the sheets read-only and
returns rows for its own house.
"""
from __future__ import annotations

import json
import logging
import os
import re
from collections import Counter, defaultdict
from datetime import datetime, timezone
from typing import Any

log = logging.getLogger("comm.proposals")

TAB = "comm_proposals"
HEADER = [
    "id", "created_at", "status", "vocabularies_allowed", "phrase", "tokens",
    "family", "shape", "evidence_n", "people_n", "coverage",
    "leak_control", "leak_contains", "would_catch", "would_catch_wrongly",
    "verdict", "why", "merged_list", "shipped_intact",
    "example", "example_ref", "example_withheld",
    "corpus_n", "control_n", "decided_at", "decided_by", "notes",
]

# THE HOUSES, by the pointers the Hub declared. Literals on purpose, exactly as
# comm_events.py keeps them: this reader must not invent an address, and a
# house that moves is a declaration somebody changes deliberately in both
# places. Read-only, every one of them.
SRC = {
    # the raw material: replies nobody could classify. The only house with words.
    "contributions": ("1XJ3lXZ-_wAhHGOGcmZEqqGQOpy_xNKOibNk4tKp1L0Y", "comm_contributions"),
    # the trail. NO TEXT — payload is channel, masked number, message id. It can
    # say HOW MUCH material exists and never WHAT it says, so it is counted and
    # never mined.
    "observations": ("1cTG1c8jpI4zJJux3zOPQy18cUjc3B7uRshBSmKLuQWY", "comm_observations"),
    # the control: every reply the machine read correctly, with the reading it
    # made. This is what a phrase must be absent from.
    "inbound": ("1SGC3fDFJsraqLXzHgUGRARe5n_IkguyBsTD4bze36ts", "entity_inbound_messages"),
    # the roster, for names only.
    "routes": ("1qGKRdejHb9xLXwvvSYwf3ih-Np_mE_pRtXnkBuKbH84", "comm_routes"),
}

# ── the vocabularies, and the one that may not grow ───────────────────────────

# Mirrors OptOut.gs' three shipped lists. Kept as a copy, never imported: Apps
# Script is another runtime, and a copy that drifts is visible in `merged_list`
# where a missing shipped word blocks the proposal outright.
SHIPPED = {
    "opt_out_phrases": (
        "stop, stopall, unsubscribe, cancel, end, quit, revoke, optout, opt out, "
        "remove me, pare, parar, para, nao quero, não quero, remova, descadastrar, sair"),
    "opt_in_phrases": "start, unstop, resume, voltar, pode mandar",
    "wrong_number_phrases": (
        "wrong number, wrong person, you have the wrong number, sorry wrong number, "
        "this is not me, not me, numero errado, número errado, nao sou eu, não sou eu, "
        "pessoa errada"),
    # No shipped list in code — the lane parses hour ranges instead. An empty
    # shipped list cannot be deleted by a replace, so this one carries no hazard.
    "availability_phrases": "",
}

# A brake may grow. A release may not. See the header for the argument and the
# 89-messages measurement behind it.
PROPOSABLE = ("opt_out_phrases", "wrong_number_phrases", "availability_phrases")
FORBIDDEN = ("opt_in_phrases",)

# ── the thresholds, and what moved from the decoder's ─────────────────────────
#
# The decoder reads a letterhead: hundreds of words, thousands of papers. This
# reads a reply: ten words, typed with a thumb, a few hundred of them. Every
# change below is in one of two directions — loosened where SHORTNESS is
# structural, tightened everywhere the material is thin.
#
#   decoder            here           why
#   LEAD = 300         no window      a reply has no letterhead; the whole
#                                     message is the evidence, capped at
#                                     MAX_TEXT so a pasted essay cannot flood
#                                     the n-gram counter.
#   ngrams 2..5        1..3           the shipped brake words are one and two
#                                     tokens ("stop", "wrong number"). A
#                                     5-gram cannot be shared across ten-word
#                                     replies; a 1-gram must be allowed or
#                                     "stop" itself could never be learned.
#   MIN_PHRASE_CHARS   10 -> 3        "stop" is four characters. The floor that
#                                     protected the decoder from junk is done
#                                     here by the people gate and the leak gate
#                                     instead.
#   COVERAGE 0.6       0.66           TIGHTER. Short text yields few phrases,
#                                     so the ones that recur recur hard; 0.6 on
#                                     a five-member family is three members,
#                                     which is an accident.
#   LEAK 0.05          0 hits         TIGHTER, and absolute rather than a rate.
#                                     A rate is meaningless against a control
#                                     corpus of two dozen rows, and a brake word
#                                     that appeared even once in a message that
#                                     was NOT a brake is a word that will
#                                     suppress somebody who did not ask.
#   MIN_FAMILY 3       5              three thumb-typed replies sharing "thank
#                                     you" is not a family.
#   (none)             MIN_PEOPLE 3   new gate. A phrase three different people
#                                     reached independently is a vocabulary; a
#                                     phrase one person repeats is their habit,
#                                     and their habit carries their identity.
#   (none)             MIN_CONTROL    new gate, and the one that decides
#                                     whether this module speaks at all.

MAX_TEXT = 200            # characters of a reply that count as evidence
NGRAM_LO, NGRAM_HI = 1, 3
MIN_PHRASE_CHARS = 3
COVERAGE = 0.66
MIN_FAMILY = 5            # distinct texts, not rows — duplicates never vote
MIN_PEOPLE = 3
MAX_PROPOSALS = 12

# THE GATE THAT MAKES THIS MODULE HONEST. The leak is measured against replies
# the machine read CORRECTLY. Below this many, "absent from everything else"
# means "absent from almost nothing", and a mechanism that proposes confidently
# from a two-dozen-row control is worse than one that says "not yet".
MIN_CONTROL = 200

# A vocabulary entry is a whole short message (see `family_of`). Longer replies
# are counted as material and reported; they are never proposed.
SOLO_MAX = 1
SHORT_MAX = 4

EXAMPLE_MAX_TOKENS = 8

# Words too common to be anybody's vocabulary. Deliberately tiny: a long stop
# list is knowledge, and this module is not allowed knowledge. These are the
# English and Portuguese function words that carry no intent on their own.
STOP = set("""a an the and or of to in on at by for with from is are was were be been it
its as if then than so no not any all my me you your we our they them this that
i im i'm ok okay yes yea yeah yep nope ya sim nao não de da do e o os as um uma
""".split())


# ── the lane's own normalisation, copied exactly ──────────────────────────────

def norm(text: str) -> str:
    """EXACTLY what `optOutIntent_` does to a body before it compares.

    This is the one place where copying the lane is mandatory rather than
    tempting: a phrase normalised any other way is a phrase that would never
    match, and a proposal that cannot fire is a lie told with a number
    attached.
    """
    s = str(text or "").lower()
    s = re.sub(r"[^a-zà-ú0-9\s]", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def tokens(text: str) -> list[str]:
    return norm(text)[:MAX_TEXT].split()


def shape_of(toks: list[str]) -> str:
    if not toks:
        return ""
    if len(toks) <= SOLO_MAX:
        return "solo"
    if len(toks) <= SHORT_MAX:
        return "short"
    return "long"


def family_of(text: str) -> str:
    """The shape key: band plus first token. Empty when there is no text.

    `long` families are kept — they are counted, reported and used as a leak
    source — but `build` never proposes from one.
    """
    toks = tokens(text)
    if not toks:
        return ""
    return f"{shape_of(toks)}:{toks[0]}"


# ── the redactor: no names, as a gate ─────────────────────────────────────────

_EMAIL = re.compile(r"\b[\w.+-]+@[\w-]+\.[\w.]+\b")
_URL = re.compile(r"\b(?:https?://|www\.)\S+", re.I)
_DIGITS = re.compile(r"\d{4,}")
_MONEY = re.compile(r"[$€£]\s?\d[\d.,]*")
_PROPER = re.compile(r"(?<![.!?]\s)(?<!^)\b[A-Z][a-z']{1,}\b")


def name_tokens(rows: list[dict], *fields: str) -> set[str]:
    """The ban list: every word of every person's name the houses carry.

    Built from the lane's own roster rather than a dictionary, so it bans the
    names of the people who actually write in. Tokens of one or two letters are
    left out — they would ban half the language.
    """
    out: set[str] = set()
    for r in rows:
        for f in fields:
            for tok in re.split(r"[^A-Za-zÀ-ÿ']+", str(r.get(f) or "")):
                tok = tok.strip("'").lower()
                if len(tok) >= 3:
                    out.add(tok)
    return out


def redact(text: str, banned: set[str]) -> tuple[str, list[str]]:
    """Return the text with every identifying thing gone, and what was removed.

    The second half of the pair is the whole point: a caller decides what to do
    by asking whether anything was removed, never by trusting that nothing was.
    """
    removed: list[str] = []
    s = str(text or "")
    if _EMAIL.search(s):
        removed.append("email")
        s = _EMAIL.sub(" ", s)
    if _URL.search(s):
        removed.append("url")
        s = _URL.sub(" ", s)
    if _MONEY.search(s):
        removed.append("money")
        s = _MONEY.sub(" ", s)
    if _DIGITS.search(s):
        removed.append("digits")
        s = _DIGITS.sub(" ", s)
    # Proper-noun SHAPE, before lowercasing loses it: a capital in the middle of
    # a sentence is how a name looks when the roster has not heard of it yet.
    if _PROPER.search(s):
        removed.append("proper_noun")
        s = _PROPER.sub(" ", s)
    kept = []
    for tok in norm(s).split():
        if tok in banned:
            removed.append("roster_name")
            continue
        kept.append(tok)
    return " ".join(kept), sorted(set(removed))


def phrase_is_safe(phrase: str, banned: set[str]) -> bool:
    """A phrase that needs redacting is not a vocabulary word."""
    safe, removed = redact(phrase, banned)
    return not removed and safe == norm(phrase) and bool(safe)


# ── the counting ──────────────────────────────────────────────────────────────

def ngrams(toks: list[str]) -> set[str]:
    out: set[str] = set()
    for n in range(NGRAM_LO, NGRAM_HI + 1):
        for i in range(0, max(0, len(toks) - n + 1)):
            g = toks[i:i + n]
            if all(w in STOP or w.isdigit() for w in g):
                continue
            if g[0] in STOP or g[-1] in STOP:
                continue
            p = " ".join(g)
            if len(p) >= MIN_PHRASE_CHARS and not p.isdigit():
                out.add(p)
    return out


def merged_list(vocab: str, phrase: str) -> tuple[str, bool]:
    """The shipped list plus the phrase, and whether every shipped word survived.

    The answer to `optOutPhrases_` replacing rather than adding. What a person
    pastes into Settings is THIS, never the phrase on its own.
    """
    shipped = [w.strip() for w in SHIPPED.get(vocab, "").split(",") if w.strip()]
    out = list(shipped)
    if norm(phrase) not in {norm(w) for w in out}:
        out.append(norm(phrase))
    joined = ", ".join(out)
    have = {norm(w) for w in joined.split(",")}
    intact = all(norm(w) in have for w in shipped)
    return joined, intact


def _catalogue(rows: list[dict], src: str, banned: set[str]) -> dict[str, dict]:
    """One corpus, deduplicated by redacted text, with its shape.

    THE TWO CORPORA ARE CATALOGUED SEPARATELY, and that is not an
    implementation detail. A first pass keyed both piles in one dictionary, so
    a text written once into the unclear pile and once read correctly landed on
    a single entry that then called itself `control` — which silently deleted
    the family member AND the conflict, and made `would_catch_wrongly`
    structurally zero for every proposal it could ever make. The one number the
    approving person most needs was the one number that could not be non-zero.
    A message living in both piles is the most important evidence there is.
    """
    seen: dict[str, dict] = {}
    for r in rows:
        raw = r.get("text") or r.get("body") or ""
        safe, removed = redact(raw, banned)
        toks = safe.split()[:MAX_TEXT]
        if not toks:
            continue
        key = " ".join(toks)
        rec = seen.get(key)
        if rec is None:
            rec = seen[key] = {
                "text": key, "toks": toks, "shape": shape_of(toks),
                "people": set(), "rows": 0, "src": src,
                "removed": removed, "ids": [], "read_as": set(),
            }
        # A DUPLICATE NEVER VOTES. The live mirror holds 63 rows carrying 38
        # distinct texts — some written once and mirrored three times. Counted
        # by row, one message would have manufactured its own coverage.
        rec["rows"] += 1
        pk = str(r.get("person_key") or r.get("from_key") or "").strip()
        if pk:
            rec["people"].add(pk)
        mid = str(r.get("message_id") or "").strip()
        if mid and len(rec["ids"]) < 3:
            rec["ids"].append(mid)
        if src == "control":
            rec["read_as"].add(str(r.get("intent") or "reply"))
    return seen


def build(unclear: list[dict], control: list[dict], roster: list[dict],
          decided: set[str]) -> tuple[list[dict], dict[str, Any]]:
    """Count, and propose only what the counting supports.

    Returns (proposals, summary). The summary is not decoration: when the
    material is too thin the proposals list is EMPTY and the summary is the
    whole answer.
    """
    banned = name_tokens(roster, "name") | name_tokens(unclear, "person_name") \
        | name_tokens(control, "person_name")
    cat_unclear = _catalogue(unclear, "unclear", banned)
    cat_control = _catalogue(control, "control", banned)
    control_texts = list(cat_control.values())
    unclear_texts = list(cat_unclear.values())
    proposable_pool = [m for m in unclear_texts if m["shape"] in ("solo", "short")]

    summary: dict[str, Any] = {
        "unclear_rows": len(unclear),
        "unclear_distinct": len(unclear_texts),
        "control_rows": len(control),
        "control_distinct": len(control_texts),
        "proposable_shape": len(proposable_pool),
        "long_shape": len(unclear_texts) - len(proposable_pool),
        "banned_name_tokens": len(banned),
        "min_control": MIN_CONTROL,
        "enough": False,
        "why_not": "",
        "proposed": 0,
    }

    # THE GATE. Below MIN_CONTROL there is nothing to be distinctive AGAINST,
    # so nothing is proposed — and the reason is stated rather than implied.
    if len(control_texts) < MIN_CONTROL:
        summary["why_not"] = (
            f"not yet: the leak is measured against replies the machine read "
            f"correctly, and there are {len(control_texts)} distinct ones "
            f"(floor {MIN_CONTROL}). A phrase cannot be shown to be distinctive "
            f"against a corpus this small; it can only be shown to be untested.")
        return [], summary

    fam: dict[str, list[dict]] = defaultdict(list)
    for m in proposable_pool:
        f = family_of(m["text"])
        if f:
            fam[f].append(m)

    # Everything the phrase must be absent from: every reply the machine read,
    # plus every unclear reply too long to be a vocabulary entry.
    leak_pool = control_texts + [m for m in unclear_texts if m["shape"] == "long"]
    contains_pool = unclear_texts + control_texts

    out: list[dict] = []
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    for fname, members in sorted(fam.items(), key=lambda kv: -len(kv[1])):
        if len(members) < MIN_FAMILY:
            continue
        people = set().union(*[m["people"] for m in members]) if members else set()
        if len(people) < MIN_PEOPLE:
            continue
        cnt: Counter = Counter()
        for m in members:
            cnt.update(ngrams(m["toks"]))
        n = len(members)
        # A VOCABULARY ENTRY IS A WHOLE MESSAGE SOMEBODY ACTUALLY SENT.
        # Without this the counter proposes the commonest FRAGMENT: on the
        # bench, a family of "quit texting", "quit texting me", "quit texting
        # please" yielded the single word "quit" — shorter, therefore shared by
        # more of the family, and already a shipped brake word. A candidate must
        # equal the entire normalised text of at least one member, and that
        # member must be one the redactor did not touch, so no phrase is ever
        # assembled out of the hole where a name used to be.
        whole = {m["text"] for m in members if not m["removed"]}
        already = {norm(w) for v in SHIPPED.values() for w in v.split(",") if w.strip()}
        scored = []
        for phrase, c in cnt.items():
            cov = c / n
            if cov < COVERAGE:
                continue
            if phrase not in whole or phrase in already:
                continue
            if not phrase_is_safe(phrase, banned):
                continue
            # SHARED, AND DISTINCTIVE. Zero hits, not a small rate — but a
            # phrase that leaks is CARRIED and marked `blocked`, never dropped.
            # A silent rejection teaches nobody: the person looking at the house
            # must be able to see which phrase the lane keeps almost learning
            # and exactly which correct reading it would have destroyed.
            # Longest first at equal coverage: a longer whole message is more
            # distinctive and catches less by accident. The decoder preferred
            # the shorter needle because a letterhead repeats itself; a reply
            # does not.
            scored.append((cov, len(phrase), phrase))
        scored.sort(reverse=True)
        for cov, _nl, phrase in scored:
            if phrase in decided or any(p["phrase"] == phrase for p in out):
                continue
            # What it WOULD have caught: whole-message matches anywhere.
            catch = [m for m in contains_pool if m["text"] == phrase]
            # What it would have caught WRONGLY: a message the machine already
            # read correctly, whose reading this phrase would now overwrite.
            # This is the leak, counted in messages rather than as a rate.
            wrong = [m for m in leak_pool if m["text"] == phrase]
            # And the trap that killed "yes": the phrase living INSIDE a longer
            # reply. Today's matcher is whole-message so this does not fire —
            # the row shows it anyway, because the person approving is deciding
            # about a word, not about one matcher.
            contains = [m for m in contains_pool
                        if m["text"] != phrase and re.search(rf"\b{re.escape(phrase)}\b", m["text"])]
            if wrong:
                read_as = sorted({r for m in wrong for r in (m["read_as"] or {"a longer reply"})})
                verdict, why = "blocked", (
                    f"{len(wrong)} message(s) the machine already read correctly "
                    f"({', '.join(read_as)}) would be re-read as this phrase")
            elif contains:
                verdict, why = "review", (
                    f"appears inside {len(contains)} longer repl(y/ies) that were not this "
                    f"phrase — safe under whole-message matching, unsafe under any other")
            else:
                verdict, why = "clean", "no message the machine read correctly carries it"
            merged, intact = merged_list("opt_out_phrases", phrase)
            if not intact:
                verdict, why = "blocked", "the merged list would drop a shipped brake word"
            # THE EXAMPLES. Only members the redactor left untouched are shown,
            # and only while they stay short. Every other member still COUNTS —
            # it is in evidence_n — but its words do not travel: `example_ref`
            # carries the house and the message ids instead, so a person with
            # the access to read the reply goes and reads it where it lives.
            # The pointer travels; the words do not.
            shown = [m["text"] for m in members
                     if not m["removed"] and len(m["toks"]) <= EXAMPLE_MAX_TOKENS][:2]
            hidden = [m for m in members if m["removed"]]
            _, src_tab = SRC["contributions"]
            ids = [i for m in hidden for i in m["ids"]][:4]
            example = " | ".join(shown)
            ref = f"{src_tab}:{','.join(ids)}" if ids else ""
            why_hidden = sorted({k for m in hidden for k in m["removed"]})
            withheld = (f"{len(hidden)} of {n} members not shown (redaction removed "
                        f"{', '.join(why_hidden)})") if hidden else ""
            out.append({
                "id": f"CP_{re.sub(r'[^a-z0-9]+', '_', phrase)}",
                "created_at": now,
                "status": "blocked" if verdict == "blocked" else "proposed",
                "vocabularies_allowed": ", ".join(PROPOSABLE),
                "phrase": phrase, "tokens": str(len(phrase.split())),
                "family": fname, "shape": fname.split(":", 1)[0],
                "evidence_n": str(n), "people_n": str(len(people)),
                "coverage": str(round(cov, 2)),
                "leak_control": str(len(wrong)), "leak_contains": str(len(contains)),
                "would_catch": str(len(catch)), "would_catch_wrongly": str(len(wrong)),
                "verdict": verdict, "why": why,
                "merged_list": merged, "shipped_intact": "yes" if intact else "NO",
                "example": example, "example_ref": ref, "example_withheld": withheld,
                "corpus_n": str(len(contains_pool)), "control_n": str(len(control_texts)),
                "decided_at": "", "decided_by": "",
                "notes": f"vocabulary NOT assigned by this module; {', '.join(FORBIDDEN)} "
                         f"is not offered — approving one releases a suppression somebody asked for",
            })
            break   # one proposal per family: the family's own best phrase
        if len(out) >= MAX_PROPOSALS:
            break

    summary["enough"] = True
    summary["proposed"] = len(out)
    return out, summary


# ── the corpus, from asa-hub-db's copy, read-only ─────────────────────────────

def rows_from_mirror(dsn: str, which: str) -> list[dict]:
    """The house's rows in sheet order, as asa-hub-db holds them with Python's kept edits laid (never
    the old platform's mirror); `dsn` is kept for the caller's signature."""
    import hub_rows  # noqa: PLC0415 - asa-hub-db's copy of the sheets

    sid, tab = SRC[which]
    return [d for d in hub_rows.rows(sid, tab) if isinstance(d, dict)]


def material(dsn: str) -> dict[str, list[dict]]:
    """Everything this module is allowed to look at, and nothing else."""
    contrib = rows_from_mirror(dsn, "contributions")
    unclear = [r for r in contrib
               if (r.get("kind") or "").strip().lower() == "unclear"
               or (r.get("state") or "").strip().lower() == "needs_human"]
    obs = rows_from_mirror(dsn, "observations")
    return {
        "unclear": unclear,
        "control": rows_from_mirror(dsn, "inbound"),
        "roster": rows_from_mirror(dsn, "routes"),
        # counted, never mined: the trail carries no words.
        "observations": obs,
    }


def scan(dsn: str) -> dict[str, Any]:
    m = material(dsn)
    props, summary = build(m["unclear"], m["control"], m["roster"], set())
    seen: Counter = Counter(str(o.get("type") or "") for o in m["observations"])
    summary["observations"] = dict(seen)
    summary["proposals"] = props
    return summary
