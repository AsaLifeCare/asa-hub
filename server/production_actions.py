"""Production Actions: the go-live runbook, read from the master JSON; the door is the master's alone."""
from __future__ import annotations

import hashlib
import json
import re
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import house_slices
import master_json

ACTIONS_TAB = "production_actions"
RUNS_TAB = "production_action_runs"
ACTIONS_POINTER = "HUB_HOUSE_PRODUCTION_ACTIONS_ID"
RUNS_POINTER = "HUB_HOUSE_PRODUCTION_ACTION_RUNS_ID"
POINTER_TTL_S = 300.0
RUNS_CAP = 500
PHASES = ("before", "at", "after")
HANDLERS = ("banner", "link", "form_close")
NOT_SET_UP = "its Google Sheet is not set up yet"
NOT_COPIED = "its Google Sheet is set up, and the platform has not copied it yet"

ACTIONS_HEADER = [
    "id", "createdAt", "updatedAt", "updated_by",
    "number", "phase", "title", "system", "kind", "handler", "params",
    "how", "link", "requires", "effect", "enabled",
]
RUNS_HEADER = [
    "id", "createdAt", "updatedAt",
    "action_id", "number", "title",
    "act", "result", "expect", "test_mode", "dial",
    "by_email", "by_name", "client_id",
    "def_sha", "preview_sha", "target", "detail",
    "before", "after", "undoes", "mock_row_id", "tenant",
]

_POINTERS: dict[str, Any] = {"at": 0.0, "values": None}
_POINTERS_LOCK = threading.Lock()
_DIGITS = re.compile(r"(\d+)")


def admin_role(role: Any) -> bool:
    return str(role or "").strip().lower() == "admin"


def master_verdict(role: Any, flag: Any) -> bool:
    """Open only for an admin session the backend itself named the master; no admin floor."""
    return admin_role(role) and flag is True


def fold_enabled(value: Any) -> str:
    return "no" if str(value or "").strip().lower() in ("no", "false", "0", "off") else "yes"


def def_sha(row: dict[str, Any]) -> str:
    text = "\n".join([
        str(row.get("id") or "").strip(), str(row.get("kind") or "").strip(),
        str(row.get("handler") or "").strip(), str(row.get("phase") or "").strip(),
        fold_enabled(row.get("enabled")), str(row.get("params") or "").strip(),
    ])
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]


def natural_key(number: Any) -> list[Any]:
    parts = _DIGITS.split(str(number or "").strip().lower())
    return [(0, int(p), "") if p.isdigit() else (1, 0, p) for p in parts if p != ""]


def _phase_rank(phase: Any) -> int:
    p = str(phase or "").strip()
    return PHASES.index(p) if p in PHASES else len(PHASES)


def pointers(master: house_slices.Master, *, fresh: bool = False) -> dict[str, str]:
    """The two house pointers from the Essencial Facts in the master JSON; the newest row per Subject ID wins."""
    with _POINTERS_LOCK:
        held = _POINTERS["values"]
        if held is not None and not fresh and master.now - float(_POINTERS["at"]) < POINTER_TTL_S:
            return dict(held)
    wanted = {ACTIONS_POINTER, RUNS_POINTER}
    doc = json.loads((master.root / master_json.book_file(house_slices.ESSENCIAL_ID)).read_bytes())
    tab = next(t for t in doc["tabs"] if t.get("tab") == "Facts")
    segs = ([json.loads((master.root / f).read_bytes()) for f in tab["parts"]] if "parts" in tab else [tab])
    found: dict[str, tuple[int, str]] = {}
    for seg in segs:
        head = list(seg.get("header") or [])
        if "Subject ID" not in head or "Value" not in head:
            continue
        i_s, i_v = head.index("Subject ID"), head.index("Value")
        for r in seg.get("rows") or []:
            cells = r[1:]
            subj = cells[i_s] if i_s < len(cells) else None
            if subj not in wanted:
                continue
            value = str((cells[i_v] if i_v < len(cells) else "") or "").strip()
            if value and (subj not in found or int(r[0]) > found[subj][0]):
                found[subj] = (int(r[0]), value)
    values = {k: v for k, (_, v) in found.items()}
    with _POINTERS_LOCK:
        _POINTERS["at"], _POINTERS["values"] = master.now, values
    return dict(values)


def forget_pointers() -> None:
    with _POINTERS_LOCK:
        _POINTERS["at"], _POINTERS["values"] = 0.0, None


def _house(master: house_slices.Master, key: str, label: str, sid: str,
           tab: str) -> tuple[dict[str, Any], list[dict] | None]:
    if not sid:
        return ({"key": key, "label": label, "book": "", "tab": tab, "rows": 0, "read_at": "",
                 "state": "missing", "why": NOT_SET_UP}, None)
    state = master.state(key, label, sid, tab)
    if state["state"] == "unreadable":
        if sid not in master.books:
            state.update({"state": "pending", "why": NOT_COPIED})
        return state, None
    try:
        return state, master.rows(sid, tab)
    except Exception as exc:  # noqa: BLE001 - said on the house, never an empty list
        state.update({"state": "unreadable", "why": f"its rows could not be read ({type(exc).__name__})"})
        return state, None


def _clean(row: dict[str, Any], header: list[str]) -> dict[str, str]:
    return {h: str(row.get(h) if row.get(h) is not None else "").strip() for h in header}


def action_out(row: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = _clean(row, ACTIONS_HEADER)
    raw = out["params"]
    out["params_obj"] = {}
    if raw:
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, dict):
                out["params_obj"] = parsed
            else:
                out["params_obj"], out["params_error"] = None, "The params are not a JSON object."
        except ValueError:
            out["params_obj"], out["params_error"] = None, "The params are not valid JSON."
    out["def_sha"] = def_sha(out)
    return out


def run_out(row: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = _clean(row, [h for h in RUNS_HEADER if h not in ("before", "after")])
    out["has_undo"] = (out["act"] == "run" and out["result"] == "ok"
                       and bool(str(row.get("before") or "").strip()))
    return out


def _unread(why: str, as_of: str) -> dict[str, Any]:
    def one(key: str, label: str, tab: str) -> dict[str, Any]:
        return {"key": key, "label": label, "book": "", "tab": tab, "rows": 0, "read_at": "",
                "state": "unreadable", "why": why}
    return {"house": {"actions": one("actions", "Runbook", ACTIONS_TAB),
                      "runs": one("runs", "Runbook history", RUNS_TAB)}, "as_of": as_of}


def view(root: Path | str, now: float) -> dict[str, Any]:
    """Both houses, each with its freshness; a house that could not be read carries no list at all."""
    stamp = datetime.fromtimestamp(now, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    try:
        master = house_slices.Master(root, now)
    except Exception as exc:  # noqa: BLE001
        return _unread(f"the master JSON could not be read ({type(exc).__name__})", stamp)
    try:
        ptr = pointers(master)
    except Exception as exc:  # noqa: BLE001
        return _unread(f"the Essencial's Facts could not be read from the master JSON ({type(exc).__name__})",
                       master.stamp() or stamp)
    a_state, a_rows = _house(master, "actions", "Runbook", ptr.get(ACTIONS_POINTER, ""), ACTIONS_TAB)
    r_state, r_rows = _house(master, "runs", "Runbook history", ptr.get(RUNS_POINTER, ""), RUNS_TAB)
    out: dict[str, Any] = {"house": {"actions": a_state, "runs": r_state}, "as_of": master.stamp() or stamp}
    if a_rows is not None:
        actions = [action_out(r) for r in a_rows if str(r.get("id") or "").strip()]
        actions.sort(key=lambda a: (_phase_rank(a["phase"]), natural_key(a["number"]), a["id"]))
        out["actions"] = actions
    if r_rows is not None:
        keyed = [(str(r.get("createdAt") or ""), int(r.get("_row") or 0), r) for r in r_rows
                 if str(r.get("id") or "").strip()]
        keyed.sort(key=lambda k: (k[0], k[1]), reverse=True)
        out["runs"] = [run_out(r) for _, _, r in keyed[:RUNS_CAP]]
        out["runs_total"] = len(keyed)
    return out
