"""Who HAS a CV on file, never who lacks one, so a failed read yields no badges rather than accusing everyone."""
from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any

import hub_rows

RESOURCES = ("resumeCoverage",)

# resume_versions is left out on purpose: its user ids resolve to no account.
_SOURCES = (
    ("tp_candidates", "name", "resume_link"),
    ("entity_resume_analyses", "CandidateName", None),
)


def _key(v: Any) -> str:
    """Same key as `clientNameKey_` in Clients.gs."""
    return re.sub(r"[^a-z0-9]+", "", str(v or "").strip().lower())


def _text(v: Any, cap: int = 120) -> str:
    return re.sub(r"\s+", " ", str(v or "")).strip()[:cap]


def _everywhere(tab: str) -> list[tuple[dict, float]]:
    """Every row of a tab of that name, in every book whose copy holds one, with the moment its book is known
    current."""
    sids = hub_rows.holders(tab)
    got = hub_rows.tabs([{"sheet_id": sid, "tab": tab} for sid in sids]) if sids else []
    return [(d, t["as_of"]) for t in got for _rn, d in t["rows"]]


def build(resource: str, dsn: str) -> tuple[list[dict], str | None]:
    if resource not in RESOURCES:
        raise ValueError(f"Unknown resource {resource!r}")
    found: dict[str, dict] = {}
    newest: float | None = None
    unread = 0
    for tab, name_col, has_col in _SOURCES:
        try:
            got = _everywhere(tab)
        except Exception:  # noqa: BLE001 - this source then names nobody
            unread += 1
            continue
        for d, at in got:
            if not isinstance(d, dict):
                continue
            if has_col and not str(d.get(has_col) or "").strip():
                continue
            k = _key(d.get(name_col))
            if not k:
                continue
            if at and (newest is None or at > newest):
                newest = at
            if k not in found:
                found[k] = {"id": "CV_" + k[:40], "person_key": k,
                            "name": _text(d.get(name_col)), "sources": tab}
            elif tab not in found[k]["sources"]:
                found[k]["sources"] += " · " + tab

    try:
        got = _everywhere("form_files")
    except Exception:  # noqa: BLE001 - the filed papers then name nobody
        unread += 1
        got = []
    if unread > len(_SOURCES):
        # nothing reached at all fails the build, as a mirror that could not be opened did
        raise hub_rows.Unreadable("no copy of the CV sources could be read")
    for d, at in got:
        if not isinstance(d, dict) or "resume" not in str(hub_rows.cell(d.get("doc_kind")) or "").lower():
            continue
        k = _key(d.get("person") or d.get("subject"))
        if not k:
            continue
        if at and (newest is None or at > newest):
            newest = at
        if k not in found:
            found[k] = {"id": "CV_" + k[:40], "person_key": k,
                        "name": _text(d.get("person") or d.get("subject")),
                        "sources": "form_files"}
        elif "form_files" not in found[k]["sources"]:
            found[k]["sources"] += " · form_files"

    rows = sorted(found.values(), key=lambda r: r["person_key"])
    at = datetime.fromtimestamp(newest, timezone.utc) if newest else datetime.now(timezone.utc)
    return rows, at.strftime("%Y-%m-%dT%H:%M:%SZ")
