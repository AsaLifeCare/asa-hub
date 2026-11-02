"""The IST lane's settings on the relay: one declaration, one validator, one reader of the mirror.
`ist_config_defaults.json` beside this file is the declaration every copy is built from — the SPA imports it…"""
from __future__ import annotations

import json
import logging
import os
import re
import threading
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import hub_rows

try:
    from zoneinfo import ZoneInfo
    OHIO = ZoneInfo("America/New_York")
except Exception:  # noqa: BLE001 — a host without tzdata keeps the summer offset
    OHIO = timezone(timedelta(hours=-4))

log = logging.getLogger("ist_config")

DECLARATION_PATH = Path(__file__).with_name("ist_config_defaults.json")


def _declaration() -> dict[str, Any]:
    """The declaration beside this file; a relay test that runs the checkout's modules in memory hands the…"""
    inline = os.getenv("HUB_IST_CONFIG_DECLARATION_JSON", "")
    if inline:
        return json.loads(inline)
    return json.loads(DECLARATION_PATH.read_text(encoding="utf-8"))


DECLARATION: dict[str, Any] = _declaration()
TAB = str(DECLARATION.get("tab") or "ist_config")
TINTS: tuple[str, ...] = tuple(DECLARATION.get("tints") or ())
GROUPS: list[dict[str, str]] = list(DECLARATION.get("groups") or [])
SPEC: dict[str, dict[str, Any]] = {d["key"]: d for d in DECLARATION["keys"]}
SHIPPED: dict[str, str] = {d["key"]: str(d["value"]) for d in DECLARATION["keys"]}

# the two words the rows carry; stored in ist_records, so never a setting
IST_STATUS_OWED = "owed"
IST_STATUS_DONE = "done"

TTL_S = float(os.getenv("HUB_IST_CONFIG_TTL_S", "300"))
_LOCK = threading.Lock()
_HELD: dict[str, Any] = {"at": 0.0, "raw": None, "source": "shipped", "pinned": None,
                         "resolved": None, "gen": 0}


# ── parsing ────────────────────────────────────────────────────────────────

def bits(raw: Any) -> list[str]:
    """A cell as its comma, semicolon or newline separated entries."""
    return [b.strip() for b in re.split(r"[,;\n]+", str(raw or "")) if b.strip()]


def pairs_of(raw: Any) -> tuple[list[str], dict[str, str]] | None:
    """`a=b, c:d` in the order written, or None when the cell holds no pair."""
    order: list[str] = []
    out: dict[str, str] = {}
    for bit in bits(raw):
        i = bit.find("=")
        if i == -1:
            i = bit.find(":")
        if i <= 0:
            continue
        k, v = bit[:i].strip(), bit[i + 1:].strip()
        if not k:
            continue
        if k not in out:
            order.append(k)
        out[k] = v
    return (order, out) if order else None


_INT = re.compile(r"(-?[0-9]+)(?:[ \t]*([A-Za-z]+))?")


def int_value(key: str, raw: Any) -> int | None:
    """A whole number in ASCII digits, optionally followed by the key's own unit ("90 days")."""
    m = _INT.fullmatch(str(raw if raw is not None else "").strip())
    if not m:
        return None
    word = (m.group(2) or "").lower()
    if word:
        unit = str((SPEC.get(key) or {}).get("unit") or "").lower()
        if not unit or word not in (unit, unit + "s"):
            return None
    return int(m.group(1))


def shipped_catalogue() -> list[str]:
    return (pairs_of(SHIPPED["ist_cert_labels"]) or ([], {}))[0]


def _refs(catalogue: list[str]) -> list[str]:
    """The course keys a join may name: the course list, and every shipped course (still tracked)."""
    out = list(catalogue)
    for k in shipped_catalogue():
        if k not in out:
            out.append(k)
    return out


def _never(spec: dict[str, Any], key: str, value: str) -> bool:
    """A pair giving `never_value` to a word that means a broken record, or to a * covering one."""
    if not spec.get("never_value") or value.strip().lower() != str(spec["never_value"]).lower():
        return False
    k = key.strip().lower()
    words = [str(w).lower() for w in spec.get("never_words") or []]
    if k.endswith("*"):
        p = k[:-1]
        return any(w.startswith(p) or p.startswith(w) for w in words)
    return any(k.startswith(w) for w in words)


def uses_catalogue(key: str) -> bool:
    spec = SPEC.get(key) or {}
    return spec.get("type") == "course" or any(
        spec.get(f) for f in ("course_entries", "course_keys", "course_values"))


def check(key: str, raw: Any, catalogue: list[str] | None = None) -> str:
    """'' when the cell is usable, else the reason. A blank cell is the shipped value, never wrong."""
    spec = SPEC.get(key)
    if spec is None:
        return f"{key} is not a setting this version reads"
    s = str(raw if raw is not None else "").strip()
    if not s:
        return ""
    cat = catalogue if catalogue is not None else shipped_catalogue()
    kind = spec.get("type")
    if kind == "int":
        n = int_value(key, s)
        lo, hi = spec.get("min"), spec.get("max")
        if n is None or (lo is not None and n < lo) or (hi is not None and n > hi):
            return f"{key} takes a whole number from {lo} to {hi} — \"{s}\" is not one"
        return ""
    if kind == "yesno":
        return "" if s.lower() in ("yes", "no") else f"{key} takes yes or no — not \"{s}\""
    if kind == "choice":
        allowed = [str(a) for a in spec.get("allowed") or []]
        return "" if s.lower() in allowed else f"{key} takes one of {', '.join(allowed)} — not \"{s}\""
    if kind == "course":
        if cat and s not in cat:
            return (f"\"{s}\" is not a course in the course list — use one of its short keys: "
                    f"{', '.join(cat)}")
        return ""
    if kind == "list":
        entries = bits(s)
        if not entries:
            return f"{key} holds no entry"
        least = int(spec.get("min_entry_length") or 0)
        short = [e for e in entries if least and len(e) < least]
        if short:
            return (f"{', '.join(short)} — each entry needs at least {least} characters: a short "
                    f"word matched inside a name removes real people")
        if spec.get("course_entries"):
            refs = _refs(cat)
            wrong = [e for e in entries if e not in refs]
            if wrong:
                return f"{', '.join(wrong)} — not a course key; use the short keys: {', '.join(refs)}"
        return ""
    if kind == "pairs":
        got = pairs_of(s)
        if not got:
            return f"{key} holds no key=value pair"
        for bit in bits(s):
            i = bit.find("=")
            if i == -1:
                i = bit.find(":")
            if i <= 0:
                return f"\"{bit}\" is not a key=value pair"
            if not bit[i + 1:].strip():
                return f"\"{bit}\" has nothing after the ="
        order, m = got
        keys = spec.get("keys")
        if keys:
            wrong = [k for k in order if k not in keys]
            if wrong:
                return f"{', '.join(wrong)} — {key} knows only {', '.join(keys)}"
        kp = spec.get("key_pattern")
        if kp:
            wrong = [k for k in order if not re.fullmatch(kp, k)]
            if wrong:
                return (f"{', '.join(wrong)} — the left side is the column heading lowercased, "
                        f"with spaces and punctuation turned into _ (dodd_8_hour_exp)")
        refs = _refs(cat)
        if spec.get("course_keys"):
            wrong = [k for k in order if k not in refs]
            if wrong:
                return f"{', '.join(wrong)} — not a course key; use the short keys: {', '.join(refs)}"
        values = spec.get("values")
        if values:
            wrong = [f"{k}={m[k]}" for k in order if m[k].strip().lower() not in values]
            if wrong:
                return f"{', '.join(wrong)} — the value must be one of {', '.join(values)}"
        pattern = spec.get("value_pattern")
        if pattern:
            wrong = [f"{k}={m[k]}" for k in order if not re.fullmatch(pattern, m[k].strip())]
            if wrong:
                return f"{', '.join(wrong)} — a column is lowercase letters, digits and _, joined by | or +"
        if spec.get("course_values"):
            wrong = [f"{k}={m[k]}" for k in order if m[k].strip() not in refs]
            if wrong:
                return (f"{', '.join(wrong)} — the right side must be a course key: "
                        f"{', '.join(refs)}")
        if spec.get("never_value"):
            wrong = [f"{k}={m[k]}" for k in order if _never(spec, k, m[k])]
            if wrong:
                return (f"{', '.join(wrong)} — {spec['never_value']} is never given to * or to a "
                        f"word that means a lapsed or broken record")
        return ""
    if kind == "template":
        allowed = set(spec.get("placeholders") or [])
        wrong = sorted({p for p in re.findall(r"\{([^{}]*)\}", s) if p not in allowed})
        if wrong:
            return (f"{', '.join('{' + w + '}' for w in wrong)} is not filled in by this sentence — "
                    f"it knows {', '.join('{' + a + '}' for a in sorted(allowed))}")
        return ""
    return ""


def resolve_one(key: str, raw: Any, catalogue: list[str] | None = None) -> tuple[str, str]:
    """(value, problem) for one cell: itself, its usable entries, or the shipped value."""
    s = str(raw if raw is not None else "").strip()
    shipped = SHIPPED.get(key, "")
    if not s or key not in SPEC:
        return (shipped if key in SPEC else s), ""
    why = check(key, s, catalogue)
    if not why:
        return (str(int_value(key, s)) if SPEC[key].get("type") == "int" else s), ""
    if SPEC[key].get("type") in ("list", "pairs"):
        kept = [b for b in bits(s) if not check(key, b, catalogue)]
        if kept:
            return ", ".join(kept), why
    return shipped, why


def catalogue_of(raw_map: dict[str, Any] | None) -> list[str]:
    """The course keys a map carries, as its course list resolves."""
    value, _why = resolve_one("ist_cert_labels", (raw_map or {}).get("ist_cert_labels"))
    return (pairs_of(value) or ([], {}))[0]


def _partner_refused(raw_map: dict[str, Any], key: str, catalogue: list[str]) -> str:
    """The key this one falls back with, when that one is refused whole."""
    partner = (SPEC.get(key) or {}).get("falls_back_with")
    if not partner:
        return ""
    value, why = resolve_one(partner, raw_map.get(partner), catalogue)
    return partner if why and value == SHIPPED.get(partner) else ""


def resolve(raw_map: dict[str, Any] | None) -> tuple[dict[str, str], dict[str, str]]:
    """(values, problems): every declared key resolved; a blank or refused cell answers the shipped value."""
    raw_map = raw_map or {}
    catalogue = catalogue_of(raw_map)
    values: dict[str, str] = {}
    problems: dict[str, str] = {}
    for key in SHIPPED:
        values[key], why = resolve_one(key, raw_map.get(key), catalogue)
        if why:
            problems[key] = why
    for key in SHIPPED:
        partner = _partner_refused(raw_map, key, catalogue)
        if partner and values[key] != SHIPPED[key]:
            values[key] = SHIPPED[key]
            problems[key] = f"answers its shipped value with {partner}, which is refused"
    return values, problems


def save_problems(values: dict[str, Any], stored: dict[str, Any] | None = None) -> list[str]:
    """Every `key: why` the save door refuses `values` over `stored` for; a course-list change re-checks the rest."""
    stored = dict(stored or {})
    after = {**stored, **values}
    before_cat, after_cat = catalogue_of(stored), catalogue_of(after)
    out = [f"{k}: {why}" for k in values if (why := check(k, values[k], after_cat))]
    if "ist_cert_labels" in values:
        for key in SHIPPED:
            if key in values or not uses_catalogue(key):
                continue
            cell = str(stored.get(key) or "").strip() or SHIPPED[key]
            if check(key, cell, after_cat) and not check(key, cell, before_cat):
                out.append(f"{key}: \"{cell}\" would no longer name a course in the course list this "
                           f"save leaves — change {key} in the same save, or keep the course")
    return out


# ── typed readers over a resolved map ──────────────────────────────────────

def text(values: dict[str, str], key: str) -> str:
    """One cell: itself, its usable entries, or the shipped value (resolved or raw maps)."""
    if key not in SPEC:
        return str(values.get(key) or "").strip()
    cat = catalogue_of(values) if uses_catalogue(key) or SPEC[key].get("falls_back_with") else None
    if cat is not None and _partner_refused(values, key, cat):
        return SHIPPED[key]
    return resolve_one(key, values.get(key), cat)[0]


def list_of(values: dict[str, str], key: str) -> list[str]:
    return bits(text(values, key)) or bits(SHIPPED.get(key, ""))


def pairs(values: dict[str, str], key: str) -> tuple[list[str], dict[str, str]]:
    return pairs_of(text(values, key)) or pairs_of(SHIPPED.get(key, "")) or ([], {})


def int_of(values: dict[str, str], key: str) -> int:
    n = int_value(key, text(values, key))
    spec = SPEC.get(key) or {}
    lo, hi = spec.get("min"), spec.get("max")
    if n is None or (lo is not None and n < lo) or (hi is not None and n > hi):
        return int(SHIPPED[key])
    return n


def yes(values: dict[str, str], key: str) -> bool:
    return text(values, key).lower() == "yes"


def choice(values: dict[str, str], key: str) -> str:
    got = text(values, key).lower()
    allowed = [str(a) for a in (SPEC.get(key) or {}).get("allowed") or []]
    return got if got in allowed else SHIPPED[key]


def labels(values: dict[str, str]) -> tuple[frozenset[str], tuple[str, ...]]:
    """(whole names, words matched anywhere), uppercased."""
    return (frozenset(n.strip().upper() for n in list_of(values, "ist_non_person_names")),
            tuple(w.strip().upper() for w in list_of(values, "ist_non_person_contains")
                  if w.strip()))


def held_labels() -> tuple[frozenset[str], tuple[str, ...]]:
    """labels() of the copy held now, resolved once per change."""
    return _resolved()["labels"]


def not_a_person(name: Any, values: dict[str, str] | None = None) -> bool:
    """A roster cell that is a coverage label (ist_non_person_names / ist_non_person_contains)."""
    names, words = labels(values) if values is not None else _resolved()["labels"]
    up = str(name or "").strip().upper()
    if not up:
        return True
    return up in names or any(w in up for w in words)


def ohio_today() -> date:
    return datetime.now(OHIO).date()


def lapsed(trained_at: Any, valid_days: int, today: date | None = None) -> bool:
    """A completed IST still counts on day `valid_days` after trainedAt (Ohio date); no date or 0 never lapses."""
    day = str(trained_at or "").strip()[:10]
    if not valid_days or not day:
        return False
    try:
        at = date.fromisoformat(day)
    except ValueError:
        return False
    return (today or ohio_today()) > at + timedelta(days=int(valid_days))


# ── the mirror ─────────────────────────────────────────────────────────────

def read(cur) -> tuple[dict[str, str], str]:
    """The declared house's cells and 'sheet', or ({}, why) — never a same-named tab in another book."""
    try:
        from behavior_slices import _house_of  # noqa: PLC0415 — lazy: it imports this module
        house = _house_of(cur, TAB)
    except Exception as exc:  # noqa: BLE001 — a failed read is said, never an empty config
        return {}, f"the {TAB} house could not be read ({type(exc).__name__})"
    if not house:
        return {}, f"no {TAB} house is declared in the depot"
    rows: list[dict] = []
    try:
        for tab in ("Data", TAB):
            rows = hub_rows.rows(house, tab)
            if rows:
                break
    except Exception as exc:  # noqa: BLE001
        return {}, f"the {TAB} house could not be read ({type(exc).__name__})"
    found: dict[str, str] = {}
    for d in rows:
        k = str((d or {}).get("key") or "").strip()[:80]
        if k:
            found[k] = str((d or {}).get("value") or "")[:4000]
    return (found, "sheet") if found else ({}, f"the {TAB} house is not in the mirror yet")


def adopt(raw: dict[str, str], source: str = "sheet") -> None:
    """Hold a copy another reader already made of the mirror."""
    with _LOCK:
        _HELD.update(at=time.time(), raw=dict(raw), source=source, resolved=None,
                     gen=_HELD["gen"] + 1)


def pin(values: dict[str, str] | None) -> None:
    """Tests only: answer these cells without reading anything (None un-pins)."""
    with _LOCK:
        _HELD["pinned"] = dict(values) if values is not None else None
        _HELD["resolved"] = None
        _HELD["gen"] += 1


def forget() -> None:
    """Tests only: back to nothing read."""
    with _LOCK:
        _HELD.update(at=0.0, raw=None, source="shipped", resolved=None, gen=_HELD["gen"] + 1)


def _resolved() -> dict[str, Any]:
    """The held copy resolved once per change — readers ask per roster cell."""
    with _LOCK:
        got = _HELD.get("resolved")
        if got is not None:
            return got
        gen = _HELD["gen"]
        pinned = _HELD.get("pinned")
        raw = pinned if pinned is not None else _HELD.get("raw")
        source = "pinned" if pinned is not None else (_HELD.get("source") if raw else "shipped")
    values, problems = resolve(raw or {})
    got = {"values": values, "problems": problems, "source": source, "labels": labels(values),
           "unknown": sorted(k for k in (raw or {}) if k not in SPEC)}
    with _LOCK:
        # a copy adopted while this one was being resolved wins
        if _HELD["gen"] == gen:
            _HELD["resolved"] = got
    return got


def state() -> dict[str, Any]:
    """{values, problems, source, unknown} as held now — no I/O; the shipped rules until a read lands."""
    got = _resolved()
    return {"values": dict(got["values"]), "problems": dict(got["problems"]), "source": got["source"],
            "unknown": list(got["unknown"])}


def current() -> dict[str, str]:
    return dict(_resolved()["values"])


def unread() -> bool:
    """True while no read of the house has landed: the shipped values answer only because nothing was read."""
    return state()["source"] == "shipped"


UNREAD_WHY = f"the {TAB} settings house could not be read, so nobody can be shown to be trained"


def bundle_block(role: str) -> dict[str, Any] | None:
    """/bundle's IST block: values for every role, problems for admin/manager; None unless the copy is the mirror's."""
    held = state()
    if held["source"] != "sheet":
        return None
    block: dict[str, Any] = {"values": held["values"], "source": "mirror", "tab": TAB}
    if role in ("admin", "manager"):
        block["problems"] = held["problems"]
        block["unknown"] = held["unknown"]
    return block


def rules(dsn: str | None = None, *, cur=None, fresh: bool = False) -> dict[str, str]:
    """The resolved settings, refreshed from the mirror at most every TTL_S; a failed read keeps the last copy."""
    with _LOCK:
        if _HELD.get("pinned") is not None:
            return resolve(_HELD["pinned"])[0]
        young = _HELD.get("raw") is not None and time.time() - float(_HELD["at"]) < TTL_S
    if young and not fresh:
        return current()
    got: dict[str, str] = {}
    why = "no reader"
    try:
        if cur is not None:
            got, why = read(cur)
        elif dsn:
            import psycopg2  # noqa: PLC0415
            import psycopg2.extras  # noqa: PLC0415
            with psycopg2.connect(dsn) as conn, conn.cursor(
                    cursor_factory=psycopg2.extras.RealDictCursor) as c:
                got, why = read(c)
    except Exception as exc:  # noqa: BLE001
        why = f"the {TAB} house could not be read ({type(exc).__name__})"
    if got:
        before = state()["problems"]
        adopt(got, "sheet")
        after = state()["problems"]
        if after and after != before:
            log.warning("ist_config: %d cell(s) refused, their shipped values answer: %s",
                        len(after), "; ".join(f"{k}: {v}" for k, v in sorted(after.items())))
    else:
        with _LOCK:
            _HELD["at"] = time.time()
            if _HELD.get("raw") is None:
                _HELD["raw"] = {}
            if _HELD.get("raw"):
                _HELD["source"] = "last known"
            _HELD["resolved"] = None
            _HELD["gen"] += 1
        log.info("ist_config: %s — answering with the %s settings", why,
                 "last known" if state()["source"] == "last known" else "shipped")
    return current()
