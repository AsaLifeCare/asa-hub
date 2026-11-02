"""Scheduling's seed (Scheduling.gs schedSeed_): the house books named by the Dashboard index's links, each one's
CALENDAR grid as the sheet keeper keeps it in asa-hub-db (app.sheet_grids, server/hub_sheet_sync.py keep_grids) —
its shown text, real dates and backgrounds — read into the board's rows and cells: a dry run, or the first copy."""
from __future__ import annotations

import json
import re
from typing import Any

import gsjs
import locations as L
import resource_rows as RR

# the keeper's table of grids (a stand-in beside a stand-in app.edits in the checks)
GRIDS = "app.sheet_grids"
INDEX_PROP = "RECON_INDEX_ID"
# SCHED_BOOK_LABEL
BOOK_LABEL = re.compile(r"^CAN\s*-\s*(.+?)\s*-\s*([A-Z]+\d+)$")
# reconCalendarLinks_: a book's id in a link or in a URL typed as the cell's text
LINK = re.compile(r"/d/([a-zA-Z0-9_-]{20,})")
INDEX_NOT_KEPT = ("The Dashboard index's links are not kept in asa-hub-db yet — the sheet keeper reads them on its next "
                  "pass.")
NOT_KEPT = "its CALENDAR grid is not kept in asa-hub-db yet — the sheet keeper reads it after the book's copy"


def _S() -> Any:
    import scheduling as SCH  # noqa: PLC0415 - the read module loads beside this one
    return SCH


def s_(v: Any) -> str:
    return gsjs.trim(gsjs.or_blank(v))


def _cells(raw: Any) -> dict:
    if isinstance(raw, dict):
        return raw
    try:
        got = json.loads(raw or "{}")
    except (TypeError, ValueError):
        return {}
    return got if isinstance(got, dict) else {}


# ---- the books ------------------------------------------------------------------------------------------------------

def calendar_links(reads: L.Reads) -> list[dict] | None:
    """reconCalendarLinks_: [{label, id}] of the books the index links, its cells in order; None when not kept."""
    index_id = s_(reads.db.prop(INDEX_PROP))
    got = RR._q(reads, f"select cells from {GRIDS} where sheet_id = %s and kind = 'links'", (index_id,))  # noqa: S608
    if not index_id or not got:
        return None
    out: list[dict] = []
    seen: set[str] = set()
    for _tab, _i, _j, label, link in _cells(got[0][0]).get("links") or []:
        label = s_(label)
        for url in [u for u in (s_(link), label) if u]:
            m = LINK.search(url)
            if not m:
                continue
            bid = m.group(1)
            if bid == index_id or bid in seen:
                continue
            seen.add(bid)
            out.append({"label": label or bid, "id": bid})
            break
    return out


def seed_links(links: list[dict]) -> list[dict]:
    """schedSeedLinks_: the houses' own books, [{label, id, code, short}]."""
    out = []
    for link in links:
        m = BOOK_LABEL.match(s_(link["label"]))
        if m:
            out.append({"label": s_(link["label"]), "id": link["id"], "code": m.group(2), "short": m.group(1).strip()})
    return out


def grids_of(reads: L.Reads, ids: list[str]) -> dict[str, dict]:
    """Each book's CALENDAR grid as the keeper kept it, by book id."""
    if not ids:
        return {}
    got = RR._q(reads, f"select sheet_id, cells from {GRIDS} where sheet_id = any(%s) and kind = 'calendar'",  # noqa: S608
                (list(ids),))
    return {sid: _cells(cells) for sid, cells in got}


def weekday_word(text: Any) -> str:
    """schedWeekdayWord_."""
    up = s_(text).upper()[:3]
    return up if up in _S().WEEKDAYS else ""


def parse(link: dict, grid: dict, first: str, last: str) -> dict[str, Any]:
    """schedSeedParse_ on the kept grid: the STAFF header row, the real dates under it and the cells as shown."""
    SCH = _S()
    out: dict[str, Any] = {"code": link["code"], "short": link["short"], "location": link["label"],
                           "book_id": link["id"], "rows": [], "cells": [], "header_row": -1, "dates": [],
                           "in_period": 0, "weekday_mismatch": [], "duplicates": [], "why": ""}
    shown = grid.get("shown") or []
    height, width = int(grid.get("rows") or len(shown)), int(grid.get("cols") or 0)
    days = {(int(r), int(c)): str(iso) for r, c, iso in grid.get("dates") or []}
    colors = {(int(r), int(c)): str(bg) for r, c, bg in grid.get("colors") or []}

    def display(r: int, c: int) -> str:
        line = shown[r] if 0 <= r < len(shown) else []
        return str(line[c]) if 0 <= c < len(line) else ""

    for r in range(min(12, height)):
        for c in range(min(4, width)):
            if s_(display(r, c)).upper() == "STAFF":
                out["header_row"] = r
                break
        if out["header_row"] != -1:
            break
    if out["header_row"] == -1:
        out["why"] = "no STAFF header in the first rows"
        return out
    hr = out["header_row"]
    cols = []
    for c2 in range(2, width):
        iso = days.get((hr, c2), "")
        if not iso:
            continue
        out["dates"].append(iso)
        label = weekday_word(display(hr - 1, c2)) if hr > 0 else ""
        if label and label != SCH.WEEKDAYS[SCH.dow(iso)]:
            out["weekday_mismatch"].append({"iso": iso, "label": label})
        if first <= iso <= last:
            cols.append({"c": c2, "iso": iso})
    out["in_period"] = len(cols)
    seen: set[str] = set()
    slug_seen: dict[str, int] = {}
    open_n = order = 0
    for r2 in range(hr + 1, height):
        name = s_(display(r2, 1))
        if not name:
            continue
        kind = SCH.row_kind_of(name)
        if kind == "open":
            open_n += 1
            row_id = "OPEN:" + str(open_n)
        elif kind == "person":
            key = SCH.fold(name)
            if not key:
                continue
            row_id = "P:" + key
            if row_id in seen:
                filled = sum(1 for x in cols if s_(display(r2, x["c"])))
                out["duplicates"].append({"name": name, "sheet_row": r2 + 1, "cells": filled})
                continue
        else:
            slug = SCH.slug(name) or "row"
            slug_seen[slug] = slug_seen.get(slug, 0) + 1
            row_id = "X:" + slug + ("-" + str(slug_seen[slug]) if slug_seen[slug] > 1 else "")
        seen.add(row_id)
        order += 1
        desig = s_(display(r2, 0))
        out["rows"].append({"row_id": row_id, "row_kind": kind, "name": name,
                            "person_key": SCH.fold(name) if kind == "person" else "",
                            "designation": desig if kind == "person" and re.fullmatch(r"\*{1,3}", desig) else "",
                            "order": order})
        for x in cols:
            text = s_(display(r2, x["c"]))
            if not text:
                continue
            bg = s_(colors.get((r2, x["c"]), "")).lower()
            out["cells"].append({"row_id": row_id, "row_kind": kind, "name": name, "date": x["iso"], "text": text,
                                 "color": bg if bg and bg != "#ffffff" else ""})
    return out


def read_book(link: dict, grid: dict | None, first: str, last: str) -> dict[str, Any]:
    """schedSeedRead_: a book whose grid the keeper has not kept reads as unreadable, never as empty."""
    if grid is None:
        return {"code": link["code"], "short": link["short"], "location": link["label"], "book_id": link["id"],
                "unreadable": True, "why": NOT_KEPT, "rows": [], "cells": [], "dates": [], "duplicates": [],
                "weekday_mismatch": []}
    return parse(link, grid, first, last)


# ---- the plan -------------------------------------------------------------------------------------------------------

def plan(books: list[dict], first: str, last: str, now: str) -> dict[str, Any]:
    """schedSeedPlan_: every parsed book → the rows and cells to store, and the report of what was not guessed. Pure."""
    SCH = _S()
    tokens: dict[str, str] = {}
    for b in books:
        for t in (b["code"], b["short"], b["location"]):
            up = s_(t).upper()
            if up:
                tokens[up] = b["code"]
                tokens[re.sub(r"\s+", "", up)] = b["code"]
    timed: dict[str, tuple[float, float]] = {}
    for b in books:
        for c in b["cells"]:
            if c["row_kind"] != "person":
                continue
            cls = SCH.classify(c["text"])
            if not cls or cls.start is None:
                continue
            timed[b["code"] + "|" + SCH.fold(c["name"]) + "|" + c["date"]] = (cls.start, cls.end)
    report: dict[str, Any] = {"first": first, "last": last, "at": now, "houses": [], "weekday_mismatch": [],
                              "stale_tabs": [], "duplicate_names": [], "multi_range_cells": [], "alias_with_time": [],
                              "unbacked_echoes": [], "timed_echoes": [], "not_a_house_aliases": 0,
                              "echoes_skipped": 0, "unreadable_books": [], "no_header": []}
    rows: list[dict] = []
    cells: list[dict] = []

    def listed(name: str, item: dict) -> None:
        if len(report[name]) < SCH.REPORT_LIST:
            report[name].append(item)

    def code_of(part: str) -> str:
        up = part.strip().upper()
        return tokens.get(up) or tokens.get(re.sub(r"\s+", "", up)) or ""

    for b in books:
        if b.get("unreadable"):
            report["unreadable_books"].append({"code": b["code"], "label": b["location"], "why": b["why"]})
            continue
        if b["header_row"] == -1:
            report["no_header"].append({"code": b["code"], "why": b["why"]})
            continue
        stored = 0
        if b["weekday_mismatch"]:
            report["weekday_mismatch"].append({"code": b["code"], "count": len(b["weekday_mismatch"]),
                                               "first": b["weekday_mismatch"][0]})
        if not b["in_period"]:
            ordered = sorted(b["dates"])
            report["stale_tabs"].append({"code": b["code"], "first": ordered[0] if ordered else "",
                                         "last": ordered[-1] if ordered else ""})
        for d in b["duplicates"]:
            listed("duplicate_names", {"code": b["code"], "name": d["name"], "sheet_row": d["sheet_row"],
                                       "cells": d["cells"]})
        for r in b["rows"]:
            rows.append({"id": SCH.row_id_of(b["code"], r["row_id"]), "house_code": b["code"], "location": b["location"],
                         "row_id": r["row_id"], "row_kind": r["row_kind"], "name": r["name"],
                         "person_key": r["person_key"], "designation": r["designation"], "order": str(r["order"]),
                         "active": "yes", "source": "seed:" + b["book_id"], "updated_at": now, "updated_by": "seed"})
        for c in b["cells"]:
            cls = SCH.classify(c["text"])
            where = {"code": b["code"], "name": c["name"], "date": c["date"], "text": c["text"]}
            if SCH.range_count(c["text"]) > 1:
                listed("multi_range_cells", where)
            if cls.kind == "alias":
                named = SCH.names_house(c["text"], tokens)
                if named and named != b["code"]:
                    parts = SCH._CHAIN.split(re.sub(r"^\*+", "", str(c["text"])))
                    backed = any(code_of(p) and (code_of(p) + "|" + SCH.fold(c["name"]) + "|" + c["date"]) in timed
                                 for p in parts)
                    if backed and c["row_kind"] == "person":
                        report["echoes_skipped"] += 1
                        continue
                    listed("unbacked_echoes", where)
                elif not named:
                    report["not_a_house_aliases"] += 1
                if SCH.time_inside(c["text"]):
                    listed("alias_with_time", where)
            elif cls.start is not None and c["row_kind"] == "person":
                # the same hours written at two houses, each naming the other: which one is worked is not guessed
                other = SCH.names_house(c["text"], tokens)
                there = timed.get(other + "|" + SCH.fold(c["name"]) + "|" + c["date"]) \
                    if other and other != b["code"] else None
                if there and there[0] == cls.start and there[1] == cls.end:
                    listed("timed_echoes", {**where, "other": other})
            state = "open" if c["row_kind"] == "open" and cls.start is not None else \
                ("called_off" if cls.kind == "ro" and cls.code == "C/O" else "scheduled")
            cells.append({"id": SCH.cell_id(b["code"], c["row_id"], c["date"]), "period_id": "P" + first,
                          "house_code": b["code"], "date": c["date"], "row_id": c["row_id"], "text": c["text"],
                          "kind": cls.kind,
                          "start_min": str(int(gsjs.js_round(cls.start * 60))) if cls.start is not None else "",
                          "end_min": str(int(gsjs.js_round(cls.end * 60))) if cls.end is not None else "",
                          "hours": f"{cls.hours:.2f}", "token": cls.token or "", "color": c["color"], "state": state,
                          "base": "", "flow_id": "", "source": "seed:" + b["book_id"], "note": "", "updated_at": now,
                          "updated_by": "seed"})
            stored += 1
        report["houses"].append({"code": b["code"], "short": b["short"], "book_id": b["book_id"],
                                 "rows": len(b["rows"]), "cells": stored, "days_in_period": b["in_period"]})
    return {"rows": rows, "cells": cells, "report": report,
            "houses": [{"code": b["code"], "location": b["location"], "short": b["short"], "book_id": b["book_id"]}
                       for b in books if not b.get("unreadable")]}


def books(reads: L.Reads, first: str, last: str) -> list[dict] | str:
    """Every house book the index links, read off its kept grid; or why there is none to read."""
    links = calendar_links(reads)
    if links is None:
        return INDEX_NOT_KEPT
    houses = seed_links(links)
    if not houses:
        return "The Dashboard index listed no house book (CAN - XX - CODE)."
    grids = grids_of(reads, [h["id"] for h in houses])
    return [read_book(h, grids.get(h["id"]), first, last) for h in houses]
