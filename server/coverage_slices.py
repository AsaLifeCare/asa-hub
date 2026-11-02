"""Roster profile and coverage suggestions, served from roster_profile.py; built late, from this relay's own slices."""
from __future__ import annotations

import importlib.util
import json
import logging
import os
from datetime import datetime, timezone
from pathlib import Path
from types import ModuleType
from typing import Any

log = logging.getLogger("hub.coverage")

RESOURCES = ("rosterProfile", "coverageSuggestions")

# Only hard availability (ended, suspended) may cross from the Staff Issues tracker; nothing that could rank a person.
EMPLOYMENT_SOURCE = "employmentFacts"

# snapshot_service rebuilds these readings whenever any of these slices is written.
SOURCES = ("calendarGrid", "calendarStaff", "calendarRequests", "callOffs",
           "behaviorBoard", "commRoutes", "commAttendance", EMPLOYMENT_SOURCE)

# Named one by one: no dict(row) or **row, so an unnamed column can never be carried.
EMPLOYMENT_READ = ("person_key", "name", "verdict", "confident",
                   "effective_on", "suspended_from", "suspended_to",
                   "identity")

IDENTITY_EXACT = "exact"

EMPLOYMENT_REFUSED = (
    "situation", "follow_up", "disciplinary_action", "result",
    "termination_summary", "notes", "comments", "quote", "excerpt", "history",
    "reported_by", "your_name",
    "issues", "issue_count", "issues_count", "incidents", "incident_count",
    "count", "rows", "score", "risk", "risk_score", "reliability", "trust",
    "rating", "rank", "weight", "severity", "flags",
)

_EMPLOYMENT_LOCKED = set(EMPLOYMENT_REFUSED) & set(EMPLOYMENT_READ)
if _EMPLOYMENT_LOCKED:
    raise RuntimeError(
        "coverage_slices: only a hard availability fact may cross from the "
        "Staff Issues tracker into a roster suggestion — "
        + ", ".join(sorted(_EMPLOYMENT_LOCKED)))

VERDICT_ENDED = "employment_ended"
VERDICT_SUSPENDED = "suspended"

_RANKED_VERDICTS = (VERDICT_ENDED, VERDICT_SUSPENDED, "unsure")

# Read off the env, not imported: snapshot_service imports this module.
_SNAPSHOT_DIR = Path(os.getenv("HUB_SNAPSHOT_OUT", "/srv/snapshot"))

# The last path is for a host-side probe, never for the relay.
MODULE_PATHS = [
    os.getenv("HUB_ROSTER_PROFILE_MODULE") or "",
    "/srv/analytics/roster_profile.py",
]

_MODULE: ModuleType | None = None


class CoverageUnavailable(RuntimeError):
    """The computation could not be loaded; refuse rather than rank people another way."""


def module() -> ModuleType:
    """Loaded by path, not import, so the sibling package's dependencies stay out."""
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
        spec = importlib.util.spec_from_file_location("hub_roster_profile", path)
        if spec is None or spec.loader is None:
            continue
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        if not hasattr(mod, "suggestions") or not hasattr(mod, "profiles"):
            raise CoverageUnavailable(
                f"{path} carries no profiles()/suggestions() — it is not the "
                "coverage reading")
        _MODULE = mod
        return mod
    raise CoverageUnavailable(
        "roster_profile.py is not reachable from this process (looked in: "
        + ", ".join(tried) + ") — the relay needs it mounted read-only beside "
        "the other analytics readings, and until it is, this lane refuses "
        "rather than inventing a second ranking of its own")


def _slice(name: str) -> tuple[list[dict], str]:
    try:
        doc = json.loads((_SNAPSHOT_DIR / f"{name}.json").read_text())
    except Exception:  # noqa: BLE001 — no file, bad JSON: the same honest empty
        return [], ""
    rows = doc.get("rows")
    return (rows if isinstance(rows, list) else []), str(doc.get("built_at") or "")


def _employment_rows(rows: list[dict]) -> tuple[list[dict], int, int]:
    """Allowlist scrub; counts rows carrying known prose apart from rows with merely unknown columns."""
    out: list[dict] = []
    prose = 0
    drifted = 0
    allowed = set(EMPLOYMENT_READ)
    for row in rows:
        if not isinstance(row, dict):
            continue
        if any(k in row for k in EMPLOYMENT_REFUSED):
            prose += 1
        elif set(row) - allowed:
            drifted += 1
        out.append({k: row.get(k) for k in EMPLOYMENT_READ})
    return out, prose, drifted


def _iso(raw: Any) -> str:
    """A parsed YYYY-MM-DD or ''; a string compare against an unparsed date silently stops guarding."""
    s = str(raw or "").strip()
    if not s:
        return ""
    try:
        return datetime.strptime(s[:10], "%Y-%m-%d").strftime("%Y-%m-%d")
    except ValueError:
        return ""


def _employment_gate(rows: list[dict], key_of: Any,
                     check: dict) -> dict[str, dict]:
    """Removes only on an exact, agreeing key, confident is True and parsed dates; the rest is unsure."""
    gate: dict[str, dict] = {}
    unreadable = 0
    for row in rows:
        key = key_of(row.get("person_key") or "")
        verdict = str(row.get("verdict") or "").strip()
        name = str(row.get("name") or "").strip()
        identity = str(row.get("identity") or "").strip()
        confident = row.get("confident") is True
        ended_on = _iso(row.get("effective_on"))
        s_from = _iso(row.get("suspended_from"))
        s_to = _iso(row.get("suspended_to"))
        if verdict == "unsure":
            found = {"name": name, "verdict": "unsure"}
        elif verdict not in (VERDICT_ENDED, VERDICT_SUSPENDED):
            if verdict or name or key:
                unreadable += 1
            continue
        elif not key or key != key_of(name) or identity != IDENTITY_EXACT:
            found = {"name": name or str(row.get("person_key") or ""),
                     "verdict": "unsure"}
        elif verdict == VERDICT_ENDED and confident and (
                ended_on or not str(row.get("effective_on") or "").strip()):
            found = {"name": name, "verdict": VERDICT_ENDED, "from": ended_on}
        elif verdict == VERDICT_SUSPENDED and confident and s_from and s_to:
            found = {"name": name, "verdict": VERDICT_SUSPENDED,
                     "from": s_from, "to": s_to}
        else:
            found = {"name": name, "verdict": "unsure"}
        if not key:
            unreadable += 1
            continue
        # The strongest verdict wins, not the last row.
        held = gate.get(key)
        if held is None or (_RANKED_VERDICTS.index(found["verdict"])
                            < _RANKED_VERDICTS.index(held["verdict"])):
            gate[key] = found
    check["facts_unreadable"] = unreadable
    return gate


def _bars(fact: dict, date: str) -> str:
    """Sentence built from verdict and dates only; no tracker word may travel."""
    day = _iso(date)
    if fact["verdict"] == VERDICT_ENDED:
        since = fact.get("from") or ""
        if since and day and day < since:
            return ""
        return ("employment ended" + (f" on {since}" if since else "")
                + " — the Staff Issues tracker says they no longer work here, "
                  "so no shift is proposed to them")
    if fact["verdict"] == VERDICT_SUSPENDED:
        if day and fact["from"] <= day <= fact["to"]:
            return (f'suspended {fact["from"]} to {fact["to"]} — this shift '
                    f'falls inside that period, so it is not proposed to them')
        return ""
    return ""


def _withhold(rows: list[dict], gate: dict[str, dict], check: dict,
              key_of: Any) -> None:
    """Filters AFTER the ladder: it can only remove names, never reorder the survivors."""
    unsure ={k: f["name"] for k, f in gate.items() if f["verdict"] == "unsure"}
    hard = {k: f for k, f in gate.items() if f["verdict"] != "unsure"}
    seen_unsure: set[str] = set()
    seen_withheld: dict[str, str] = {}
    pool_keys: set[str] = set()
    for row in rows:
        date = str(row.get("date") or "")
        withheld: list[dict] = []

        def bar(key: str) -> str:
            fact = hard.get(key)
            return _bars(fact, date) if fact else ""

        kept = []
        for cand in row.get("candidates") or []:
            why = bar(str(cand.get("person_key") or ""))
            if why:
                withheld.append({"name": cand.get("name") or "", "because": why})
            else:
                kept.append(cand)
        also = []
        for other in row.get("also") or []:
            why = bar(key_of(other.get("name") or ""))
            if why:
                withheld.append({"name": other.get("name") or "", "because": why})
            else:
                also.append(other)
        here = [str(c.get("person_key") or "")
                for c in (row.get("candidates") or [])]
        here += [key_of(a.get("name") or "") for a in (row.get("also") or [])]
        pool_keys.update(k for k in here if k)
        row_unsure = sorted({unsure[k] for k in here if k in unsure})

        row["candidates"] = kept
        row["also"] = also
        row["qualified"] = len(kept) + len(also)
        row["withheld"] = withheld
        row["employment_unsure"] = row_unsure
        if withheld and row["qualified"] == 0:
            row["why_empty"] = (
                "everybody who cleared every hard fact for this shift is "
                "withheld on an employment fact — "
                + "; ".join(f'{w["name"]}: {w["because"]}' for w in withheld))
        for w in withheld:
            seen_withheld[w["name"]] = w["because"]
        seen_unsure.update(row_unsure)
    check["people_withheld"] = len(seen_withheld)
    check["withheld"] = [{"name": n, "because": b}
                         for n, b in sorted(seen_withheld.items())]
    check["unsure"] = sorted(seen_unsure)
    check["unsure_facts"] = len(unsure)
    # A confident fact matching no one in any list usually means a name drifted between tables.
    check["facts_reached_nobody"] = len(set(hard) - pool_keys)


def _sources() -> dict[str, Any]:
    """Every input slice, each with its own build stamp."""
    loaded: dict[str, Any] = {}
    stamps: dict[str, str] = {}
    missing: list[str] = []
    for name in SOURCES:
        rows, built = _slice(name)
        if name == EMPLOYMENT_SOURCE:
            rows, prose, drifted = _employment_rows(rows)
            loaded["employmentCheck"] = {
                # could_not_run (no slice) is not "ran with 0 facts", and it blocks every removal.
                "state": "ran" if built else "could_not_run",
                "as_of": built,
                "facts_read": len(rows),
                "prose_refused_on_rows": prose,
                "unknown_columns_on_rows": drifted,
                "facts_unreadable": 0,
                "facts_reached_nobody": 0,
                "people_withheld": 0,
                "withheld": [],
                "unsure": [],
                "unsure_facts": 0,
            }
        loaded[name] = rows
        stamps[name] = built
        if not built:
            missing.append(name)
    loaded["freshness"] = {
        "sources": stamps,
        "sources_not_answering": missing,
        "read_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    return loaded


def build(resource: str, dsn: str | None = None) -> tuple[list[dict], str | None]:
    """Dated by the grid's build stamp; `dsn` is unused, nothing here reads Postgres."""
    if resource not in RESOURCES:
        raise ValueError(f"Unknown resource {resource!r}")
    mod = module()
    src = _sources()
    # The computation must never see this bookkeeping.
    check = src.pop("employmentCheck", None) or {
        "state": "could_not_run", "as_of": "", "facts_read": 0,
        "prose_refused_on_rows": 0, "unknown_columns_on_rows": 0,
        "facts_unreadable": 0, "facts_reached_nobody": 0, "people_withheld": 0,
        "withheld": [], "unsure": [], "unsure_facts": 0,
    }
    if not src.get("calendarGrid"):
        # No grid is a builder that has not run, never an empty roster.
        raise CoverageUnavailable(
            "calendarGrid has not been written yet, so there is no roster to "
            "read — this is a builder that has not run, never an empty period")
    rows = (mod.profiles(src) if resource == "rosterProfile"
            else mod.suggestions(src))
    if resource == "coverageSuggestions":
        if check.get("state") == "ran":
            _withhold(rows, _employment_gate(src.get(EMPLOYMENT_SOURCE) or [],
                                             mod.person_key, check),
                      check, mod.person_key)
        for row in rows:
            row["employment_check"] = check
    return rows, src["freshness"]["sources"].get("calendarGrid") or None


if __name__ == "__main__":
    import sys

    if len(sys.argv) > 1:
        _SNAPSHOT_DIR = Path(sys.argv[1])
    print(json.dumps(module().scan(_sources()), indent=2, sort_keys=True,
                     default=str))
