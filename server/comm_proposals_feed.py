"""Shape comm_proposals.scan() rows for commProposalsIngest: Python counts, Apps Script writes (Python cannot write the house)."""
from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import re
from types import ModuleType
from typing import Any

# never decided_at/decided_by: a machine that carried them could file its own approval
FIELDS = [
    "id", "created_at", "status", "vocabularies_allowed", "phrase", "tokens",
    "family", "shape", "evidence_n", "people_n", "coverage",
    "leak_control", "leak_contains", "would_catch", "would_catch_wrongly",
    "verdict", "why", "merged_list", "shipped_intact",
    "example", "example_ref", "example_withheld",
    "corpus_n", "control_n", "notes",
]

PERSON_FIELDS = ["decided_at", "decided_by"]

# absent stays absent, never 0
COUNTS = {
    "tokens", "evidence_n", "people_n", "coverage",
    "leak_control", "leak_contains", "would_catch", "would_catch_wrongly",
    "corpus_n", "control_n",
}

# repeated here, not imported from the door, so this file refuses on its own
REFUSED = ["text", "body", "message", "messages", "member", "members", "texts",
           "raw", "payload", "person_key", "person_name", "name", "from", "to",
           "from_key", "phone", "email", "number", "masked", "masked_number",
           "sid", "thread_id"]

_LINE_HOLDS = sorted((set(REFUSED) | set(PERSON_FIELDS)) & set(FIELDS))
if _LINE_HOLDS:
    raise RuntimeError(
        "comm_proposals_feed: a proposal carries counts and one proved phrase, "
        "never the pile and never a person's decision — " + ", ".join(_LINE_HOLDS))

# approved and rejected are a person's, through commProposalsDecide only
FEED_STATUS = ("proposed", "blocked")

# a phrase that releases a suppression someone asked for is never proposed, at any evidence level
FORBIDDEN_VOCAB = ("opt_in_phrases",)

# duplicated in the door (COMM_VOCAB_MAX_TOKENS/CHARS) on purpose: the duplication is the check
MAX_TOKENS = 4
MAX_CHARS = 60

# the door caps a call at COMM_PROPOSALS_INGEST_CAP (60)
BATCH_ROWS = max(1, min(60, int(os.getenv("HUB_COMM_PROPOSALS_BATCH", "30"))))

MODULE_PATHS = [
    os.getenv("HUB_COMM_PROPOSALS_MODULE") or "",
    "/srv/analytics/comm_proposals.py",
]

_MODULE: ModuleType | None = None

_NUMBER = re.compile(r"^\d+(?:\.\d+)?$")


class CommProposalsUnavailable(RuntimeError):
    """The counting could not be loaded: nothing is proposed and nothing is guessed."""


def module() -> ModuleType:
    """Loaded by path, not import: the sibling package pulls in far more than this one file."""
    global _MODULE
    if _MODULE is not None:
        return _MODULE
    tried = []
    for path in MODULE_PATHS:
        if not path:
            continue
        tried.append(path)
        if not os.path.exists(path):
            continue
        spec = importlib.util.spec_from_file_location("hub_comm_proposals", path)
        if spec is None or spec.loader is None:
            continue
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        if not hasattr(mod, "scan"):
            raise CommProposalsUnavailable(
                f"{path} has no scan() — it is not the proposals counter")
        _MODULE = mod
        return mod
    raise CommProposalsUnavailable(
        "comm_proposals.py is not reachable from this process (looked in: "
        + ", ".join(tried) + ") — the relay needs it mounted read-only, and until it "
        "is, nothing is proposed and nothing is guessed")


def _text(v: Any, cap: int = 0) -> str:
    """The door's own normalisation, so the payload is what lands."""
    if v is None or v is False:
        return ""
    if v is True:
        return "yes"
    s = " ".join(str(v).split())
    return s[:cap] if cap and len(s) > cap else s


def _count(v: Any) -> str:
    """A measurement or '', never '0': not measured is not zero."""
    s = _text(v, 24)
    if not s:
        return ""
    return s if _NUMBER.match(s) else ""


def _vocab_list(v: Any) -> list[str]:
    out: list[str] = []
    for part in re.split(r"[,;]+", _text(v, 300)):
        n = part.strip().lower()
        if n and n not in out:
            out.append(n)
    return out


def _norm(text: Any) -> str:
    """Must match comm_proposals.norm and commVocabularyNorm_ character for character."""
    s = str(text or "").lower()
    s = re.sub(r"[^a-zà-ú0-9\s]", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def refusal_of(row: dict) -> str:
    """A one-word reason, or '', so the log can count 'release' apart from 'shape'."""
    r = row or {}
    for v in _vocab_list(r.get("vocabularies_allowed")):
        if v in FORBIDDEN_VOCAB:
            return "release"
    ident = _text(r.get("id"), 120)
    if not ident or not re.match(r"^CP_[A-Za-z0-9_]+$", ident):
        return "id"
    if _text(r.get("status"), 24).lower() not in FEED_STATUS:
        return "status"
    if not _vocab_list(r.get("vocabularies_allowed")):
        return "no_list"
    phrase = _norm(r.get("phrase"))
    if not phrase or len(phrase) > MAX_CHARS or len(phrase.split(" ")) > MAX_TOKENS:
        return "shape"
    return ""


def project(row: dict) -> dict | None:
    """Columns are named one by one, so nothing new upstream can ride along."""
    if refusal_of(row):
        return None
    r = dict(row or {})
    out: dict[str, str] = {}
    for f in FIELDS:
        if f in COUNTS:
            out[f] = _count(r.get(f))
        elif f == "phrase":
            out[f] = _text(r.get(f), MAX_CHARS)
        elif f == "vocabularies_allowed":
            out[f] = ", ".join(_vocab_list(r.get(f)))
        elif f == "status":
            out[f] = _text(r.get(f), 24).lower()
        elif f in ("why", "notes"):
            out[f] = _text(r.get(f), 400)
        elif f == "merged_list":
            out[f] = _text(r.get(f), 1000)
        elif f == "example":
            out[f] = _text(r.get(f), 300)
        elif f in ("example_ref", "example_withheld"):
            out[f] = _text(r.get(f), 200)
        else:
            out[f] = _text(r.get(f), 120)
    return out


def digest(rows: list[dict]) -> str:
    """Every carried field except created_at, which the counter re-mints every run."""
    keys = [f for f in FIELDS if f != "created_at"]
    return hashlib.sha1(json.dumps(
        [[r[k] for k in keys] for r in rows], sort_keys=True).encode()).hexdigest()


def read(dsn: str) -> dict:
    """Ordered by key so batches are stable; the counter's own refusal (enough, why_not) comes back verbatim."""
    mod = module()
    summary = dict(mod.scan(dsn))
    raw = summary.pop("proposals", None) or []

    rows: list[dict] = []
    refused: dict[str, int] = {}
    for r in raw:
        why = refusal_of(dict(r))
        if why:
            refused[why] = refused.get(why, 0) + 1
            continue
        out = project(dict(r))
        if out is None:
            refused["shape"] = refused.get("shape", 0) + 1
            continue
        rows.append(out)
    rows.sort(key=lambda r: r["id"])

    return {
        "rows": rows,
        "digest": digest(rows),
        "counted": len(raw),
        "refused": sum(refused.values()),
        "refused_by": refused,
        "release_refused": refused.get("release", 0),
        "proposed": sum(1 for r in rows if r["status"] == "proposed"),
        "blocked": sum(1 for r in rows if r["status"] == "blocked"),
        "enough": bool(summary.get("enough")),
        "why_not": _text(summary.get("why_not"), 500),
        "control_distinct": summary.get("control_distinct"),
        "unclear_distinct": summary.get("unclear_distinct"),
        "proposable_shape": summary.get("proposable_shape"),
        "min_control": summary.get("min_control"),
    }


def batches(rows: list[dict], size: int = 0) -> list[list[dict]]:
    n = size if size > 0 else BATCH_ROWS
    return [rows[i:i + n] for i in range(0, len(rows), n)] or []


def payload(batch: list[dict]) -> dict:
    return {"rows": batch}


def verdict(answers: list[dict], expected: int) -> dict:
    """Counted from the door's reading of the grid; converged (nothing inserted or updated) is the normal day."""
    def total(field: str) -> int:
        return sum(int(a.get(field) or 0) for a in answers)

    held = total("inserted") + total("updated") + total("unchanged")
    crossed: list[str] = []
    for a in answers:
        for name in a.get("dropped_columns") or []:
            if name not in crossed:
                crossed.append(name)
    return {
        "passes": len(answers),
        "handed": total("received"),
        "kept": total("kept"),
        "refused": total("refused"),
        "release_refused": total("release_refused"),
        "overflow": total("overflow"),
        "inserted": total("inserted"),
        "updated": total("updated"),
        "unchanged": total("unchanged"),
        "writes": total("writes"),
        "kept_decision": total("kept_decision"),
        "proposed": total("proposed"),
        "blocked": total("blocked"),
        "held": held,
        "expected": expected,
        "complete": held == expected and total("overflow") == 0,
        "converged": total("inserted") == 0 and total("updated") == 0,
        "dropped_columns": crossed,
    }


if __name__ == "__main__":
    import sys
    _dsn = os.getenv("HUB_SNAPSHOT_PG_DSN") or os.getenv("DATABASE_URL") or ""
    if not _dsn:
        sys.exit("HUB_SNAPSHOT_PG_DSN is not set")
    try:
        _got = read(_dsn)
    except CommProposalsUnavailable as exc:
        sys.exit(str(exc))
    _rows = _got.pop("rows")
    _got["batches"] = [len(b) for b in batches(_rows)]
    _got["fields"] = len(FIELDS)
    _got["refused_columns_present"] = sorted(
        {k for r in _rows for k in r if k in REFUSED or k in PERSON_FIELDS})
    print(json.dumps(_got, indent=2, sort_keys=True))
