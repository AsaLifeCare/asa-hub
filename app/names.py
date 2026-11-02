"""Names.gs: one name matched against a list the way the platform matches a spoken or typed name — accents and
punctuation folded, suffixes and titles dropped, a nickname read as its name, the first and last parts compared."""
from __future__ import annotations

import re
import unicodedata
from typing import Any, Callable

NAME_SUFFIXES = frozenset({"jr", "sr", "ii", "iii", "iv", "v", "md", "rn", "lpn", "stna", "dsp", "phd", "esq", "mr",
                           "mrs", "ms", "miss", "dr"})
NAME_NICKNAMES = {
    "mike": "michael", "mikey": "michael", "mick": "michael",
    "bob": "robert", "bobby": "robert", "robbie": "robert", "rob": "robert",
    "bill": "william", "billy": "william", "willie": "william",
    "jim": "james", "jimmy": "james",
    "joe": "joseph", "joey": "joseph",
    "tom": "thomas", "tommy": "thomas",
    "dave": "david", "davey": "david",
    "dan": "daniel", "danny": "daniel",
    "chris": "christopher", "kris": "christopher",
    "matt": "matthew", "nick": "nicholas", "tony": "anthony",
    "steve": "steven", "stevie": "steven",
    "eddie": "edward", "ed": "edward",
    "rick": "richard", "ricky": "richard", "rich": "richard",
    "jen": "jennifer", "jenny": "jennifer", "jess": "jessica", "jessie": "jessica",
    "liz": "elizabeth", "lizzie": "elizabeth", "beth": "elizabeth",
    "katie": "katherine", "kathy": "katherine", "kate": "katherine",
    "sue": "susan", "suzy": "susan", "susie": "susan",
    "patty": "patricia", "trish": "patricia",
    "maggie": "margaret", "peggy": "margaret",
    "becky": "rebecca", "debbie": "deborah", "deb": "deborah",
    "cindy": "cynthia", "vicky": "victoria", "angie": "angela", "barb": "barbara",
    "ken": "kenneth", "kenny": "kenneth",
    "larry": "lawrence", "jerry": "gerald", "gerry": "gerald",
    "ron": "ronald", "ronnie": "ronald", "don": "donald", "donnie": "donald",
    "charlie": "charles", "chuck": "charles",
    "hank": "henry", "johnny": "john", "jon": "john", "jack": "john",
    "greg": "gregory", "andy": "andrew", "drew": "andrew",
    "ben": "benjamin", "benny": "benjamin",
    "sam": "samuel", "sammy": "samuel",
    "alex": "alexander", "zach": "zachary", "josh": "joshua",
    "nate": "nathaniel", "gabe": "gabriel", "theo": "theodore",
    "tina": "christina", "chrissy": "christina",
    "shell": "michelle", "shelly": "michelle",
    "toni": "antoinette", "dee": "deandra",
}
NAME_MATCH_MIN = 0.86
NAME_MATCH_GAP = 0.05


def deburr(s: Any) -> str:
    return re.sub(r"[̀-ͯ]", "", unicodedata.normalize("NFD", str(s)))


def norm(v: Any) -> str:
    s = deburr("" if v is None else v).lower()
    s = re.sub(r"['’`]", "", s)
    s = re.sub(r"[^a-z0-9\s]", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def tokens(v: Any) -> dict[str, list[str]]:
    """{'all': every part but a suffix, 'core': the parts longer than one letter, a leading nickname read whole}."""
    every = [t for t in norm(v).split(" ") if t and t not in NAME_SUFFIXES]
    core = [t for t in every if len(t) > 1] or every
    if len(core) > 1 and core[0] in NAME_NICKNAMES:
        core = [NAME_NICKNAMES[core[0]]] + core[1:]
    return {"all": every, "core": core}


def lev(a: str, b: str) -> int:
    if a == b:
        return 0
    if not a:
        return len(b)
    if not b:
        return len(a)
    prev = list(range(len(b) + 1))
    for i in range(1, len(a) + 1):
        cur = [i] + [0] * len(b)
        for j in range(1, len(b) + 1):
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (0 if a[i - 1] == b[j - 1] else 1))
        prev = cur
    return prev[len(b)]


def sim(a: str, b: str) -> float:
    if a == b:
        return 1.0
    m = max(len(a), len(b))
    if not m:
        return 0.0
    s = 1 - lev(a, b) / m
    if a[:1] != b[:1] and s < 0.85:
        s *= 0.75
    return max(s, 0.0)


def score(a: Any, b: Any) -> float:
    ta, tb = tokens(a)["core"], tokens(b)["core"]
    if not ta or not tb:
        return 0.0
    an, bn = " ".join(ta), " ".join(tb)
    if an == bn:
        return 1.0
    af, al, bf, bl = ta[0], ta[-1], tb[0], tb[-1]
    if len(ta) == 1 or len(tb) == 1:
        return sim(an, bn)
    direct = (sim(af, bf) + sim(al, bl)) / 2
    swapped = (sim(af, bl) + sim(al, bf)) / 2 * 0.98
    s = max(direct, swapped)
    holds = min(sim(af, bf), sim(al, bl)) >= 0.7 or min(sim(af, bl), sim(al, bf)) >= 0.7
    return max(s, sim(an, bn)) if holds else s


def best(typed: Any, items: list[Any], get_name: Callable[[Any], Any] = str) -> dict[str, Any]:
    """nameBest_: the best match, refused under NAME_MATCH_MIN or when another person scores within NAME_MATCH_GAP."""
    scored = []
    for item in items:
        nm = get_name(item)
        if not norm(nm):
            continue
        scored.append({"item": item, "name": nm, "key": " ".join(tokens(nm)["core"]), "score": score(typed, nm)})
    scored.sort(key=lambda x: -x["score"])
    top = scored[0] if scored else None
    if top is None or top["score"] < NAME_MATCH_MIN:
        return {"ok": False, "reason": "no match", "score": top["score"] if top else 0}
    runner = None
    for other in scored[1:]:
        if other["key"] == top["key"] or score(top["name"], other["name"]) >= NAME_MATCH_MIN:
            continue
        runner = other
        break
    if runner and runner["score"] >= NAME_MATCH_MIN and top["score"] - runner["score"] < NAME_MATCH_GAP:
        return {"ok": False, "reason": "ambiguous", "score": top["score"], "candidates": [top["name"], runner["name"]]}
    return {"ok": True, "item": top["item"], "matched_name": top["name"], "key": top["key"], "score": top["score"]}
