"""Scheduling's houses kept up with the house calendars, until Scheduling makes them itself.

A house's period that never received a calendar of its own (no Builder publish) follows the house's CALENDAR tab as
the relay's House Calendars mirror reads it (the grid My Calendar and Locations draw): every cell the copy-in made and
nobody touched since takes the sheet's newest text, a cell the sheet gained is added, one it cleared is cleared, and a
person new to the sheet gets a row. A cell changed in Scheduling itself (an edit, a flow, a training) is never
replaced. Parsed as schedulingSeed parses a book (Scheduling.gs schedSeedParse_ / schedSeedPlan_), kept in app.edits
like any final write."""
from __future__ import annotations

import logging
import re
from typing import Any

import gsjs
import locations as L
import scheduling as SCH
import scheduling_writes as SW
from writes import Decision

log = logging.getLogger("asa-hub-app")

ACTION = "schedulingSheetImport"
BY = "sheet"
# a cell these made, and nobody changed since, follows the sheet
FOLLOWS = frozenset({"seed", BY})
# a house's period holding a cell of this source received a calendar directly: the sheet never replaces it
OWN_CALENDAR = "builder"
NO_COLOR = frozenset({"", "#ffffff", "#fff", "#ffffffff", "white", "transparent", "none"})


def _src(v: Any) -> str:
    return SCH.s_(v).split(":", 1)[0]


def _color(v: Any) -> str:
    c = SCH.s_(v).lower()
    return "" if c in NO_COLOR else c


def code_of(location: Any) -> str:
    """The house code a book's label ends with (CAN - BM - BM4060 → BM4060), spaced or not."""
    m = re.search(r"([A-Z]+\d+)\s*$", SCH.s_(location).upper())
    return m.group(1) if m else ""


def parse(house: dict, grid: dict, first: str, last: str) -> dict[str, Any]:
    """schedSeedParse_ off the mirror's grid: its rows in sheet order, each cell of a day inside the period."""
    cols = [(i, SCH.s_(c.get("iso"))) for i, c in enumerate(grid.get("cols") or []) if isinstance(c, dict)]
    cols = [(i, iso) for i, iso in cols if SCH.iso_valid(iso) and first <= iso <= last]
    out: dict[str, Any] = {"code": house["code"], "rows": [], "cells": [], "dates": [iso for _i, iso in cols]}
    seen: set[str] = set()
    slugs: dict[str, int] = {}
    open_n = order = 0
    for r in grid.get("rows") or []:
        name = SCH.s_((r or {}).get("employee"))
        if not name:
            continue
        kind = SCH.row_kind_of(name)
        if kind == "open":
            open_n += 1
            row_id = f"OPEN:{open_n}"
        elif kind == "person":
            key = SCH.fold(name)
            if not key or f"P:{key}" in seen:
                continue
            row_id = f"P:{key}"
        else:
            s = SCH.slug(name) or "row"
            slugs[s] = slugs.get(s, 0) + 1
            row_id = f"X:{s}" + (f"-{slugs[s]}" if slugs[s] > 1 else "")
        seen.add(row_id)
        order += 1
        out["rows"].append({"row_id": row_id, "row_kind": kind, "name": name,
                            "person_key": SCH.fold(name) if kind == "person" else "", "order": order})
        cells = r.get("cells") or []
        for i, iso in cols:
            c = cells[i] if i < len(cells) and isinstance(cells[i], dict) else {}
            text = SCH.s_(c.get("text"))
            if text:
                out["cells"].append({"row_id": row_id, "row_kind": kind, "name": name, "date": iso, "text": text,
                                     "color": _color(c.get("color"))})
    return out


def wanted(parsed: list[dict], tokens: dict[str, str]) -> dict[str, dict[str, Any]]:
    """schedSeedPlan_'s cells, by id: the echo of a shift written at another house is not stored twice."""
    timed: dict[str, tuple] = {}
    for b in parsed:
        for c in b["cells"]:
            if c["row_kind"] != "person":
                continue
            cls = SCH.classify(c["text"])
            if cls and cls.start is not None:
                timed[f"{b['code']}|{SCH.fold(c['name'])}|{c['date']}"] = (cls.start, cls.end)
    out: dict[str, dict[str, Any]] = {}
    for b in parsed:
        for c in b["cells"]:
            cls = SCH.classify(c["text"])
            if cls is None:
                continue
            if cls.kind == "alias" and c["row_kind"] == "person":
                named = SCH.names_house(c["text"], tokens)
                if named and named != b["code"]:
                    links = SCH._CHAIN.split(re.sub(r"^\*+", "", c["text"]))
                    if any(timed.get(f"{SCH.names_house(x, tokens)}|{SCH.fold(c['name'])}|{c['date']}")
                           for x in links if gsjs.trim(x)):
                        continue
            state = "open" if c["row_kind"] == "open" and cls.start is not None else \
                ("called_off" if cls.kind == "ro" and cls.code == "C/O" else "scheduled")
            cid = SCH.cell_id(b["code"], c["row_id"], c["date"])
            out[cid] = {"house": b["code"], "row_id": c["row_id"], "date": c["date"], "text": c["text"],
                        "color": c["color"], "state": state}
    return out


def plan(reads: L.Reads, grids: dict[str, dict], now: str) -> tuple[list[dict], dict[str, Any]]:
    """The kept records that bring every house's own-calendar-less period up to its sheet, and what was counted."""
    st = SCH.settings(reads)
    periods = [p for p in st["periods"] if p.get("state") == "live"]
    by_code = {code_of(loc): g for loc, g in grids.items() if code_of(loc)}
    tokens = SCH.house_tokens(reads)
    cells = SCH.read_tab(reads, "sched_cells")
    rows = SCH.read_tab(reads, "sched_rows")
    gone = SCH.gone_rows(reads, "sched_cells")
    report: dict[str, Any] = {"houses": 0, "periods_own": 0, "added": 0, "changed": 0, "cleared": 0, "kept_own": 0,
                              "rows_added": 0, "no_sheet": []}
    houses = [h for h in st["houses"] if by_code.get(h["code"])]
    report["no_sheet"] = [h["code"] for h in st["houses"] if not by_code.get(h["code"])]
    report["houses"] = len(houses)
    plans = {h["code"]: SW.Plan(reads, {"uid": BY}) for h in houses}
    row_ids = {h["code"]: {r["row_id"] for r in rows if r.get("house_code") == h["code"]} for h in houses}
    next_order = {h["code"]: int(max([SCH.pfloat(r.get("order")) for r in rows if r.get("house_code") == h["code"]]
                                     or [0])) + 1 for h in houses}
    for p in periods:
        parsed = {h["code"]: parse(h, by_code[h["code"]], p["first"], p["last"]) for h in houses}
        # an echo is backed by the person's timed shift at the house it names, at any house
        want_all = wanted(list(parsed.values()), tokens)
        for h in houses:
            got, p_plan = parsed[h["code"]], plans[h["code"]]
            mine = [c for c in cells if c.get("house_code") == h["code"] and p["first"] <= c.get("date", "") <= p["last"]]
            if any(_src(c.get("source")) == OWN_CALENDAR for c in mine):
                report["periods_own"] += 1
                continue
            want = {cid: w for cid, w in want_all.items() if w["house"] == h["code"]}
            # a day the tab no longer shows (its past weeks are cut away) says nothing about that day's cells
            shown = set(got["dates"])
            have = {c["id"]: c for c in mine if c.get("date") in shown}
            for r in got["rows"]:
                if r["row_id"] in row_ids[h["code"]]:
                    continue
                row_ids[h["code"]].add(r["row_id"])
                p_plan.upsert("sched_rows", {
                    "id": SCH.row_id_of(h["code"], r["row_id"]), "house_code": h["code"], "location": h["location"],
                    "row_id": r["row_id"], "row_kind": r["row_kind"], "name": r["name"], "person_key": r["person_key"],
                    "designation": "", "order": str(next_order[h["code"]]), "active": "yes",
                    "source": f"{BY}:{h['book_id']}", "updated_at": now, "updated_by": BY})
                next_order[h["code"]] += 1
                report["rows_added"] += 1
            for cid, w in want.items():
                cur = have.get(cid)
                if cur is not None and not follows(cur):
                    report["kept_own"] += 1
                    continue
                if cur is not None and SCH.s_(cur.get("text")) == w["text"] and SCH.s_(cur.get("state")) == w["state"] \
                        and _color(cur.get("color")) == w["color"]:
                    continue
                if cur is None and cid in gone and not follows(gone[cid]):
                    report["kept_own"] += 1
                    continue
                line = SW.cell_row(reads, h["code"], w["row_id"], w["date"], w["text"], {
                    "color": w["color"], "state": w["state"], "source": f"{BY}:{h['book_id']}", "updated_by": BY,
                    "period_id": p["id"]}, now)
                p_plan.upsert("sched_cells", line)
                report["added" if cur is None else "changed"] += 1
            for cid, cur in have.items():
                if cid not in want and follows(cur):
                    p_plan.remove("sched_cells", cid)
                    report["cleared"] += 1
    edits: list[dict] = []
    for code, p_plan in plans.items():
        if p_plan.touched:
            edits.extend(p_plan.records(code))
    return edits, report


def follows(cell: dict) -> bool:
    """A cell the copy-in or this import made and nobody changed since: no flow on it, made by neither a person nor
    the Builder."""
    return _src(cell.get("source")) in FOLLOWS and SCH.s_(cell.get("updated_by")) in FOLLOWS \
        and not SCH.s_(cell.get("flow_id"))


def decide(reads: L.Reads, grids: dict[str, dict]) -> tuple[Decision | None, dict[str, Any]]:
    """The import as one final write, or None when every house already reads as its sheet."""
    now = SCH.now_iso(reads)
    edits, report = plan(reads, grids, now)
    if not edits:
        return None, report
    said = (f"{report['added']} added, {report['changed']} changed, {report['cleared']} cleared from the house "
            f"calendars; {report['rows_added']} people added")
    return Decision({"status": 200, "data": {"ok": True, "said": said, "report": report}}, edits=edits,
                    subject="scheduling"), report
