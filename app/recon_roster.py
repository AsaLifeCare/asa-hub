"""Time Reconciliation's people and planned roster (apps-script/Recon.gs reconRoster_, reconResolveName_,
reconLoadShifts_): every name resolved by nameBest_ against the people tab, and the worked cells of the house calendars
read off their live copy in Postgres (asa_house_calendar_live), never off Google."""
from __future__ import annotations

import json
import re
import threading
from typing import Any

import gsjs
import locations as L
import mw_relay_state as RS
import names as N
import recon_detect as D

LIVE = "asa_house_calendar_live"
# one name's verdict against one roster, kept across requests: nameBest_ scores the whole roster each time
MEMO_MAX = 6000
_MEMO: dict[tuple, dict[str, Any]] = {}
_MEMO_LOCK = threading.Lock()
_CODE = re.compile(r"([A-Z]+[0-9]+)")
# a calendar row that names no person but a slot: open, none, a workshop, family, a nurse, to be decided, vacant — in
# any spelling after the word ("WORKSHOP (KC)", "Family", "Nurse"), each worked cell of it a false missing shift
PLACEHOLDER = re.compile(r"^(open|none|workshop|family|nurse|tbd|vacant)\b", re.IGNORECASE)

s_ = gsjs.str_


def roster(reads: L.Reads) -> tuple[list[dict[str, str]], int]:
    """reconRoster_: the people tab's names (name, else first and last), with the roster's fingerprint."""
    def read() -> tuple[list[dict[str, str]], int]:
        out = []
        for r in reads.hub_rows("people"):
            name = s_(r.get("name")) or gsjs.trim(s_(r.get("first_name")) + " " + s_(r.get("last_name")))
            if name:
                out.append({"id": s_(r.get("id")), "name": name})
        return out, hash(tuple((p["id"], p["name"]) for p in out))
    return reads.once("recon:roster", read)


def resolve(typed: Any, people: list[dict[str, str]], fingerprint: int) -> dict[str, Any]:
    """reconResolveName_: {ok, id, name, key} or {ok: False, reason, candidates, score, key}."""
    memo = (fingerprint, gsjs.or_blank(typed))
    got = _MEMO.get(memo)
    if got is not None:
        return dict(got)
    fallback = "name:" + " ".join(N.tokens(typed)["core"])
    if not N.norm(typed):
        out: dict[str, Any] = {"ok": False, "reason": "no match", "key": "name:"}
    else:
        best = N.best(typed, people, lambda p: p["name"])
        if not best["ok"]:
            out = {"ok": False, "reason": best["reason"], "candidates": list(best.get("candidates") or []),
                   "score": best.get("score"), "key": fallback}
        else:
            out = {"ok": True, "id": best["item"]["id"], "name": best["matched_name"], "key": best["item"]["id"]}
    with _MEMO_LOCK:
        if len(_MEMO) >= MEMO_MAX:
            _MEMO.clear()
        _MEMO[memo] = out
    return dict(out)


def house_aliases(labels: list[str]) -> tuple[dict[str, str], dict[str, str]]:
    """reconHouseAliases_: each calendar's code off its label ('CAN - 48TH (A) - ABD1547' → ABD1547), and every
    spelling of it (the code, the label, the short name) → the code; and label → code."""
    alias: dict[str, str] = {}
    code_of: dict[str, str] = {}
    for label in labels:
        m = _CODE.search(label)
        code = m.group(1) if m else ""
        if not code:
            parts = label.split(" - ")
            code = gsjs.trim(parts[-1]) if len(parts) > 1 else gsjs.trim(label)
        if not code:
            continue
        alias[code.upper()] = code
        alias[label.upper()] = code
        seg = label.split(" - ")
        if len(seg) >= 2:
            alias[gsjs.trim(seg[1]).upper()] = code
        code_of[label] = code
    return alias, code_of


def _grid(v: Any) -> dict[str, Any]:
    if isinstance(v, str):
        try:
            v = json.loads(v)
        except ValueError:
            return {}
    return v if isinstance(v, dict) else {}


def calendars(reads: L.Reads) -> list[tuple[str, dict[str, Any]]]:
    """Each house calendar's label and grid (its days and its people's cells), as the live copy holds them."""
    def read() -> list[tuple[str, dict[str, Any]]]:
        got = RS.rows(LIVE, columns=("location", "grid"))
        return sorted(((s_(r.get("location")), _grid(r.get("grid"))) for r in got if s_(r.get("location"))),
                      key=lambda x: x[0])
    return reads.once("recon:calendars", read)


def load_shifts(reads: L.Reads, day_from: str, day_to: str, location: str | None = None) -> list[dict[str, Any]]:
    """reconLoadShifts_: one entry per worked cell in [day_from, day_to] (an alias without hours cannot reconcile
    times; a placeholder row names nobody to reconcile); `location` keeps one place's alone, its people the only ones
    resolved."""
    people, fp = roster(reads)
    cals = calendars(reads)
    alias, code_of = house_aliases([label for label, _g in cals])
    out = []
    for label, grid in cals:
        house = code_of.get(label) or label
        days = [s_((c or {}).get("iso")) if isinstance(c, dict) else "" for c in grid.get("cols") or []]
        for row in grid.get("rows") or []:
            if not isinstance(row, dict):
                continue
            staff = gsjs.trim(gsjs.or_blank(row.get("employee")))
            if not staff or staff.upper() in D.NOT_STAFF or PLACEHOLDER.match(staff):
                continue
            cells = row.get("cells") if isinstance(row.get("cells"), list) else []
            who = None
            for c, day in enumerate(days):
                if not day or day < day_from or day > day_to or c >= len(cells):
                    continue
                cell = cells[c]
                raw = cell.get("text") if isinstance(cell, dict) else cell
                cls = D.classify_cell(raw)
                if not cls or cls["kind"] != "hours":
                    continue
                loc = house
                if cls["token"]:
                    loc = alias.get(cls["token"].upper()) or cls["token"]
                if location is not None and loc != location:
                    continue
                if who is None:
                    who = resolve(staff, people, fp)
                out.append({"date": day, "location": loc, "employeeId": who["id"] if who["ok"] else "",
                            "employeeName": who["name"] if who["ok"] else staff, "matchKey": who["key"],
                            "startMin": cls["startMin"], "endMin": cls["endMin"],
                            "startTime": D.min_to_time(cls["startMin"]), "endTime": D.min_to_time(cls["endMin"]),
                            "raw": gsjs.trim(gsjs.or_blank(raw))})
    return out
