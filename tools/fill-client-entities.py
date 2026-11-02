#!/usr/bin/env python3
"""MyLife OS — Client Entities filled from asa-hub-db: the rows its tabs lack and the blank cells a source holds, as app.edits.

Default --dry-run reads the copy (read-only) and prints, per tab, the rows to append and the cells to fill.
--apply records them as final app.edits (asa-hub-sheet-sync writes them); --create-tabs also makes house_staff_off.
"""
from __future__ import annotations

import argparse
import os
import re
import sys
import urllib.parse
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable


def _on_path() -> None:
    f = globals().get("__file__")
    here = Path(f).resolve().parent if f and not str(f).startswith("<") else None
    for env, sub, probe, fallback in (("HUB_APP_DIR", "app", "hubdb.py", "/app"),
                                      ("HUB_RULES_DIR", "server", "redaction.py", "/rules")):
        for p in (os.getenv(env), str(here.parent / sub) if here else None, fallback):
            if p and (Path(p) / probe).is_file():
                sys.path.insert(0, p)
                break


_on_path()

import gsjs  # noqa: E402
import house_tables as HT  # noqa: E402
import hubdb  # noqa: E402
import locations as L  # noqa: E402
import writes as W  # noqa: E402

try:
    import redaction as R  # noqa: E402
except ImportError:
    R = None  # type: ignore[assignment]

APP, ACTION, AUTHOR = "entities", "fill", "system:entities-fill"
TZ = "America/New_York"
STAMP_BY = "entities-fill"
CLIENT_DB = ("HUB_CLIENT_DB_SHEET_ID", "1fTi78ztKDiK3hvYLbI2IQ1TeSrzVLceK5LyXJ4BVPe8")
HOUSES_DATA = ("HUB_HOUSES_DATA_SHEET_ID", "1ZL5EHUfx627VFJ9rRlv8D1J8ljZJvns8TZsUKj_oAe0")
EMPLOYEES = ("HUB_EMPLOYEE_ENTITIES_SHEET_ID", "12v9fEnlJwO9GzGOGhskdRVZM5TqHHb65CJF4icHcAmE")
REFERRALS = ("HUB_POTENTIAL_CLIENTS_SHEET_ID", "1ii0f-uzkJ-y36m59aizbt8I03yBecW3GO9Qln8VWGBk")
TABS = ("entity_homes", "entity_clients", "entity_isp", "entity_physicians", "entity_appointments",
        "entity_daily_notes", "entity_incidents", "entity_referrals")
_LABEL_TAB = re.compile(r"^([A-Z]{2,4})\s*-\s*(.+?)\s*-\s*([A-Z]{2,4}\d{3,6})$")
_TITLES = frozenset("dr doctor md do np pa pac aprn cnp fnp bc phd dds dmd od dpm rn lpn msn crnp mr mrs ms miss "
                    "jr sr ii iii iv".split())
_ADDR_ZIP = re.compile(r"\b([A-Z]{2})\.?,?\s+(\d{5})(?:-\d{4})?\s*$")
_ADDR_CITY = re.compile(r",\s*([A-Za-z][A-Za-z .'-]*?)\s*,?\s+[A-Z]{2}\.?,?\s+\d{5}(?:-\d{4})?\s*$")
_STATES = frozenset(getattr(R, "US_STATES", ()) or "OH PA MI IN WV KY NY".split())


# ---- text ---------------------------------------------------------------------------------------------------------

def low(v: Any) -> str:
    return re.sub(r"\s+", " ", str(v or "")).strip().lower()


def tk(v: Any, n: int = 0) -> str:
    s = re.sub(r"[^a-z0-9]+", "", str(v or "").lower())
    return s[:n] if n else s


def nk(v: Any) -> str:
    return gsjs.name_key(v)


def digits(v: Any) -> str:
    return re.sub(r"\D+", "", str(v or ""))


def name_keys(v: Any) -> list[str]:
    """A person's name key, and for 'Last, First' the key of 'First Last' too."""
    s = gsjs.trim(str(v or ""))
    out = [nk(s)] if nk(s) else []
    if s.count(",") == 1:
        last, first = (gsjs.trim(x) for x in s.split(","))
        if nk(first + last) and nk(first + last) not in out:
            out.append(nk(first + last))
    return out


def canon_name(v: Any) -> str:
    keys = name_keys(v)
    return keys[-1] if keys else ""


def day(v: Any) -> str:
    s = gsjs.trim(str(v or ""))
    if not s:
        return ""
    at = gsjs.parse_when(s, TZ)
    if at is not None:
        return at.astimezone(gsjs.NY).date().isoformat()
    for fmt in ("%m/%d/%y", "%A, %B %d, %Y", "%B %d, %Y", "%b %d, %Y", "%A, %b %d, %Y"):
        try:
            return datetime.strptime(s, fmt).date().isoformat()
        except ValueError:
            continue
    return ""


def hm(v: Any) -> str:
    t = hubdb.typed(gsjs.trim(str(v or "")), "estate")
    if isinstance(t, hubdb.SheetTime):
        return f"{t.h:02d}:{t.m:02d}"
    if isinstance(t, gsjs.SheetDate):
        loc = t.at.astimezone(gsjs.NY)
        return f"{loc.hour:02d}:{loc.minute:02d}"
    return ""


def minute(v: Any) -> str:
    at = gsjs.parse_when(gsjs.trim(str(v or "")), TZ)
    return at.astimezone(gsjs.NY).strftime("%Y-%m-%d %H:%M") if at is not None else ""


def pn(v: Any) -> str:
    """A doctor as the appointments name one: the text, case and spacing folded."""
    return re.sub(r"[.,;]+$", "", low(v))


def pset(v: Any) -> frozenset:
    return frozenset(t for t in re.findall(r"[a-z]+", str(v or "").lower()) if t not in _TITLES and len(t) > 1)


def joined(*parts: str) -> str:
    return "|".join(parts) if all(parts) else ""


def agree(a: Any, b: Any) -> bool:
    if low(a) == low(b):
        return True
    da = day(a)
    if da and da == day(b):
        return True
    xa = digits(a)
    return len(xa) >= 7 and xa == digits(b)


def shape(v: Any) -> str:
    s = str(v or "")
    if len(s) > 40:
        return f"text·{len(s)}"
    s = re.sub(r"[A-Z]", "A", s)
    s = re.sub(r"[a-z]", "a", s)
    s = re.sub(r"\d", "9", s)
    return re.sub(r"(.)\1+", lambda m: f"{m.group(1)}{{{len(m.group(0))}}}", s)


def val(raw: dict, header: str, url: bool = False) -> str | None:
    """A source cell as text (a link's address for a url column); None for a withheld one."""
    v = raw.get(header)
    if v is None:
        return ""
    if isinstance(v, (dict, list)):
        return ""
    v = v if isinstance(v, str) else gsjs.js_str(v)
    if R.is_marker_value(v):
        return None
    m = hubdb._LINKED.match(v)
    if m:
        v = m.group(2) if url else m.group(1)
    return gsjs.trim(v)


def withheld_of(headers: Any) -> set:
    probe = {h: "" for h in headers}
    return set(R.withheld_columns(probe)) | set(R.secret_named_columns(probe))


def stamp_like(rows: list[dict], col: str, now: datetime) -> str:
    """The time now in the shape the tab's own stamps take."""
    sample = next((gsjs.trim(str(r.get(col) or "")) for r in rows if gsjs.trim(str(r.get(col) or ""))), "")
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z", sample):
        return now.strftime("%Y-%m-%dT%H:%M:%SZ")
    if re.fullmatch(r"\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}", sample):
        return now.astimezone(gsjs.NY).strftime("%Y-%m-%d %H:%M:%S")
    return now.isoformat()


# ---- the copy -----------------------------------------------------------------------------------------------------

class Source:
    """One source tab, its columns mapped onto an entity tab's (target: header or (header, is_url))."""

    def __init__(self, label: str, ref: hubdb.TabRef | None, rows: list[dict], mapping: dict, book: str = "") -> None:
        self.label, self.ref, self.rows, self.book = label, ref, rows, book
        heads = list(ref.headers) if ref is not None else []
        self.cols: dict[str, tuple[str, bool]] = {}
        self.absent: list[str] = []
        for tgt, spec in mapping.items():
            name, url = (spec, False) if isinstance(spec, str) else spec
            h = next((x for x in heads if x == name), None) or \
                next((x for x in heads if gsjs.trim(x).lower() == name.strip().lower()), None)
            if h is None:
                self.absent.append(name)
            else:
                self.cols[tgt] = (h, url)
        self.held = withheld_of(heads) if heads else set()
        used = {h for h, _u in self.cols.values()}
        self.extra: Counter = Counter()
        for r in rows:
            for h in heads:
                if h not in used and h not in self.held and gsjs.trim(str(r.get(h) or "")):
                    self.extra[h] += 1

    @classmethod
    def made(cls, label: str, rows: list[dict], book: str = "") -> "Source":
        keys = sorted({k for r in rows for k in r if not k.startswith("_")})
        ref = hubdb.TabRef("", label, "", tuple(keys), None, len(rows))
        return cls(label, ref, rows, {k: k for k in keys}, book)

    def cand(self, r: dict) -> dict[str, str | None]:
        return {tgt: (None if h in self.held else val(r, h, url)) for tgt, (h, url) in self.cols.items()}

    def line(self) -> str:
        made = self.ref is None or not self.ref.sheet_id
        where = self.book if made else f"{self.book} › {self.ref.tab}"
        return f"{self.label} [{where}, {len(self.rows)} rows]" + \
            (f" — source lacks {', '.join(self.absent)}" if self.absent else "")


class Books:
    def __init__(self, db: hubdb.HubDb) -> None:
        self.db = db

    def sid(self, prop: str, fallback: str = "") -> str:
        try:
            got = self.db.prop(prop)
        except hubdb.Unreadable:
            got = ""
        return got or fallback

    def name(self, sid: str) -> str:
        b = self.db.book(sid) if sid else None
        return b.name if b is not None else (sid[:8] + "…" if sid else "?")

    def tab(self, sid: str, tab: str) -> tuple[hubdb.TabRef | None, list[dict]]:
        # a tab kept in its own table read there (house_tables.book_tab)
        ref = HT.book_tab(L.Reads(self.db, None), sid, tab) if sid else None
        if ref is None:
            return None, []
        return ref, [dict(raw, _rn=rn) for rn, raw in self.db.rows(ref)]

    def hub(self, name: str) -> tuple[hubdb.TabRef | None, list[dict], str]:
        res = self.db.resolve(name)
        if res.runtime or res.ref is None:
            return None, [], res.sheet_id
        return res.ref, [dict(raw, _rn=rn) for rn, raw in self.db.rows(res.ref)], res.sheet_id

    def source(self, label: str, sid: str, tab: str, mapping: dict) -> Source:
        ref, rows = self.tab(sid, tab)
        return Source(label, ref, rows, mapping, self.name(sid))

    def hub_source(self, label: str, name: str, mapping: dict) -> Source:
        ref, rows, sid = self.hub(name)
        return Source(label, ref, rows, mapping, self.name(sid))

    def tab_names(self, sid: str) -> list[str]:
        return sorted(t for (s, t) in self.db.catalog()["tabs"] if s == sid)


# ---- one entity tab -----------------------------------------------------------------------------------------------

Key = tuple[str, Callable[[dict], str]]


class Entity:
    """An entity tab as Python reads it, with the rows it gains and the blank cells filled, never a filled one."""

    def __init__(self, tab: str, ref: hubdb.TabRef, rows: list[dict], id_col: str, prefix: str, keys: list[Key],
                 stamps: dict[str, str] | None = None, near: Callable[[dict, list[dict]], list[dict]] | None = None,
                 book: str = "", mint: bool = True) -> None:
        self.tab, self.ref, self.rows, self.id_col, self.prefix = tab, ref, rows, id_col, prefix
        self.sid, self.book, self.mint = ref.sheet_id, book, mint
        self.heads = [gsjs.trim(gsjs.js_str(h)) for h in ref.headers if gsjs.trim(gsjs.js_str(h))]
        self.keys, self.stamps, self.near = keys, stamps or {}, near
        self.held = withheld_of(self.heads)
        self.fills: dict[str, dict[str, tuple[str, str]]] = {}
        self.added: list[dict] = []
        self.sources: list[str] = []
        self.add_by: Counter = Counter()
        self.fill_by: Counter = Counter()
        self.withheld: Counter = Counter()
        self.ambiguous: Counter = Counter()
        self.unkeyed: Counter = Counter()
        self.unmatched: Counter = Counter()
        self.no_id: Counter = Counter()
        self.agreed: dict[str, list[int]] = {}
        self.extra: dict[str, Counter] = {}
        self.index: dict[str, dict[str, list[dict]]] = {n: {} for n, _f in keys}
        pat = re.compile(re.escape(prefix) + r"(\d+)$")
        nums = [m.group(1) for r in rows if (m := pat.match(gsjs.trim(str(r.get(id_col) or ""))))]
        self.width = max((len(n) for n in nums), default=5)
        self.next = max((int(n) for n in nums), default=0) + 1
        self.first_new = self.next
        for r in rows:
            self._index(r)

    def view(self, row: dict) -> dict:
        if row.get("_new"):
            return row
        f = self.fills.get(gsjs.trim(str(row.get(self.id_col) or "")))
        return {**row, **{c: v for c, (v, _s) in f.items()}} if f else row

    def _index(self, row: dict) -> None:
        v = self.view(row)
        for n, fn in self.keys:
            k = fn(v)
            if k:
                got = self.index[n].setdefault(k, [])
                if not any(x is row for x in got):
                    got.append(row)

    def all_rows(self) -> list[dict]:
        return self.rows + self.added

    def _mint(self) -> str:
        rid = f"{self.prefix}{self.next:0{self.width}d}"
        self.next += 1
        return rid

    def see(self, src: Source) -> None:
        self.sources.append(src.line())
        if src.extra:
            self.extra[src.label] = src.extra

    def offer(self, cand: dict[str, str | None], label: str, append: bool = True) -> dict | None:
        vals: dict[str, str] = {}
        for col, v in cand.items():
            if col == self.id_col and self.mint:
                continue
            if v is None or (v and col in self.held):
                self.withheld[(label, col)] += 1
                continue
            if v and col in self.heads:
                vals[col] = v
        if not vals:
            return None
        hit, amb, keyed = None, False, False
        for n, fn in self.keys:
            k = fn(vals)
            if not k:
                continue
            keyed = True
            got = self.index[n].get(k) or []
            if len(got) == 1:
                hit = got[0]
                break
            if len(got) > 1:
                amb = True
        if hit is None and not amb and keyed and self.near is not None:
            got = self.near(vals, self.all_rows())
            if len(got) == 1:
                hit = got[0]
            elif len(got) > 1:
                amb = True
        if hit is None and amb:
            self.ambiguous[label] += 1
            return None
        if hit is not None:
            self.fill(hit, vals, label)
            return hit
        if not keyed:
            self.unkeyed[label] += 1
            return None
        rid = self._mint() if self.mint and append else vals.get(self.id_col, "")
        if not append or not rid:
            self.unmatched[label] += 1
            return None
        row = {"_new": True, **vals, self.id_col: rid}
        for col, stamp in self.stamps.items():
            if col in self.heads and not row.get(col):
                row[col] = stamp
        self.added.append(row)
        self.add_by[label] += 1
        self._index(row)
        return row

    def fill(self, row: dict, vals: dict[str, str], label: str) -> None:
        if row.get("_new"):
            for col, v in vals.items():
                if col in self.heads and col not in self.held and not row.get(col):
                    row[col] = v
            self._index(row)
            return
        rid = gsjs.trim(str(row.get(self.id_col) or ""))
        f = self.fills.setdefault(rid, {}) if rid else {}
        for col, v in vals.items():
            if col not in self.heads or col in self.held:
                continue
            have = gsjs.trim(str(row.get(col) or ""))
            if have:
                a = self.agreed.setdefault(col, [0, 0])
                a[0] += 1 if agree(have, v) else 0
                a[1] += 1
                continue
            if col in f:
                continue
            if not rid:
                self.no_id[label] += 1
                continue
            f[col] = (v, label)
            self.fill_by[(col, label)] += 1
        if rid and not f:
            self.fills.pop(rid, None)
        self._index(row)

    def derive(self, col: str, fn: Callable[[dict], str], label: str) -> None:
        """A blank cell another cell of the row names (a key the platform's own entities resolve)."""
        if col not in self.heads or col in self.held:
            return
        for row in self.all_rows():
            v = self.view(row)
            if gsjs.trim(str(v.get(col) or "")):
                continue
            got = fn(v)
            if got:
                self.fill(row, {col: got}, label)

    def records(self) -> list[dict]:
        match = W.COLS + self.id_col
        out: list[dict] = []
        for rid, cells in self.fills.items():
            if cells:
                out.append({"sheet_id": self.sid, "tab_name": self.tab, "kind": "edit", "match": match,
                            "keyed": "header", "row_key": rid, "house": "",
                            "cells": {c: v for c, (v, _s) in cells.items()}, "before": {c: "" for c in cells}})
        for row in self.added:
            cells = {c: row[c] for c in self.heads if gsjs.trim(str(row.get(c) or ""))}
            out.append({"sheet_id": self.sid, "tab_name": self.tab, "kind": "append", "match": match,
                        "keyed": "header", "row_key": row[self.id_col], "house": "", "cells": cells})
        return out

    def report(self) -> list[str]:
        cells = sum(len(c) for c in self.fills.values())
        new_cells = sum(len(r["cells"]) for r in self.records() if r["kind"] == "append")
        first = f"{self.prefix}{self.first_new:0{self.width}d}"
        ids = f"ids {first}…{self.prefix}{self.next - 1:0{self.width}d}" if self.mint else "ids: the client's own"
        out = [f"== {self.tab}  ({len(self.rows)} rows; key {self.id_col}; "
               + (f"next id {first})" if self.mint else "keyed by the entity_clients id)"),
               "   sources: " + ("; ".join(self.sources) if self.sources else "none")]
        out.append(f"   rows to append: {len(self.added)}" + (
            f" ({', '.join(f'{k}: {n}' for k, n in self.add_by.items())}; {ids}; {new_cells} cells)"
            if self.added else ""))
        out.append(f"   cells to fill: {cells} in {len([f for f in self.fills.values() if f])} existing rows")
        by_col: dict[str, list[str]] = {}
        for (col, label), n in sorted(self.fill_by.items()):
            by_col.setdefault(col, []).append(f"{n} from {label}")
        for col in self.heads:
            if col in by_col:
                out.append(f"      {col}: " + ", ".join(by_col[col]))
        blank_after = []
        for col in self.heads:
            if col in self.held:
                continue
            empty = sum(1 for r in self.all_rows() if not gsjs.trim(str(self.view(r).get(col) or "")))
            if empty:
                blank_after.append(f"{col} {empty}")
        if blank_after:
            out.append("   still blank after: " + ", ".join(blank_after))
        if self.held:
            out.append("   withheld columns (never written): " + ", ".join(sorted(self.held)))
        if self.withheld:
            out.append("   withheld source values skipped: " + ", ".join(
                f"{col} ← {label} ×{n}" for (label, col), n in self.withheld.items()))
        for label, extra in self.extra.items():
            out.append(f"   not carried (no column in the tab) from {label}: " + ", ".join(
                f"{h} ×{n}" for h, n in extra.most_common(14)) + (" …" if len(extra) > 14 else ""))
        for what, c in (("ambiguous (a key names several rows; skipped)", self.ambiguous),
                        ("unkeyed source rows (no key to match; skipped)", self.unkeyed),
                        ("unmatched fill-only rows", self.unmatched), ("matched rows without an id", self.no_id)):
            if c:
                out.append(f"   {what}: " + ", ".join(f"{k} ×{n}" for k, n in c.items()))
        low_agree = [f"{c} {a}/{n}" for c, (a, n) in self.agreed.items() if n and a < n]
        full = [c for c, (a, n) in self.agreed.items() if n and a == n]
        if self.agreed:
            out.append(f"   source vs tab on filled cells: {len(full)} column(s) agree fully"
                       + (f"; differ: {', '.join(low_agree)}" if low_agree else ""))
        ex_add = [{c: shape(r[c]) for c in self.heads if r.get(c)} for r in self.added[:2]]
        ex_fill = [{c: shape(v) for c, (v, _s) in f.items()} for f in list(self.fills.values())[:2] if f]
        for e in ex_add:
            out.append(f"   e.g. append {e}")
        for e in ex_fill:
            out.append(f"   e.g. fill {e}")
        return out


# ---- the tabs -----------------------------------------------------------------------------------------------------

class Plan:
    def __init__(self, db: hubdb.HubDb, now: datetime) -> None:
        self.db, self.now, self.bk = db, now, Books(db)
        self.sid = self.bk.sid(L.ENTITIES_PROP, L.ENTITIES_FALLBACK)
        self.ents: dict[str, Entity] = {}
        self.notes: list[str] = []
        self.client_ids: dict[str, str] = {}
        self.phys_raw: dict[str, str] = {}
        self.phys_ids: dict[str, str] = {}
        self.phys_sets: dict[str, str] = {}

    def entity(self, tab: str, id_col: str, prefix: str, keys: list[Key], stamps: tuple = (),
               near: Callable | None = None, mint: bool = True) -> Entity | None:
        ref, rows = self.bk.tab(self.sid, tab)
        if ref is None:
            self.notes.append(f"{tab}: not in the copy of {self.bk.name(self.sid)}; nothing planned")
            return None
        st = {}
        for col in stamps:
            st[col] = STAMP_BY if col == "updated_by" else stamp_like(rows, col, self.now)
        e = Entity(tab, ref, rows, id_col, prefix, keys, st, near, self.bk.name(self.sid), mint)
        self.ents[tab] = e
        return e

    @staticmethod
    def unique(rows: list[dict], key: Callable[[dict], str], value: Callable[[dict], str]) -> dict[str, str]:
        seen: dict[str, set] = {}
        for r in rows:
            k, v = key(r), value(r)
            if k and v:
                seen.setdefault(k, set()).add(v)
        return {k: next(iter(v)) for k, v in seen.items() if len(v) == 1}

    def homes(self) -> None:
        e = self.entity("entity_homes", "home_id", "HOM_",
                        [("code", lambda v: L.home_code(v.get("abbreviation"), v.get("home_name")))],
                        ("created_at", "updated_at"))
        if e is None:
            return
        s = self.bk.source("Common Data › Homes", self.bk.sid(L.COMMON_PROP, L.COMMON_FALLBACK), "Homes", {
            "home_name": "Name - Auto", "region": "Region - Auto", "address": "Address - Auto",
            "telephone": "Telephone - Auto", "abbreviation": "Abbreviation - Auto",
            "manager_name": "House Manager - Auto", "manager_phone": "Manager Phone - Auto"})
        e.see(s)
        for r in s.rows:
            e.offer(s.cand(r), s.label)
        hd_sid = self.bk.sid(*HOUSES_DATA)
        labels = []
        for t in self.bk.tab_names(hd_sid):
            m = _LABEL_TAB.match(gsjs.trim(t))
            if m:
                labels.append({"home_name": f"{gsjs.trim(m.group(2))} - {m.group(3)}", "abbreviation": m.group(3)})
        names = {L.home_code(r.get("abbreviation"), r.get("home_name")): low(r.get("home_name")) for r in e.rows}
        both = [x for x in labels if x["abbreviation"] in names]
        same = sum(1 for x in both if names[x["abbreviation"]] == low(x["home_name"]))
        # a house tab's label names a house as the registry does only when every house both carry agrees
        if not both or same < len(both):
            labels = [{"abbreviation": x["abbreviation"]} for x in labels]
        self.notes.append(f"entity_homes: the Houses Data label (without its city) equals the registry's home_name for "
                          f"{same} of {len(both)} houses both carry" + ("" if both and same == len(both) else
                                                                       "; only the house code is taken from it"))
        s = Source.made("Houses Data R3.1 › its house tabs", labels, self.bk.name(hd_sid))
        e.see(s)
        for x in labels:
            e.offer(x, s.label)
        codes = []
        for name, col in (("clients", "house"),):
            _ref, rows, _sid = self.bk.hub(name)
            codes += [r.get(col) for r in rows]
        _ref, rows = self.bk.tab(self.bk.sid(*CLIENT_DB), "Master")
        codes += [r.get("House") for r in rows]
        found = sorted({L.house_code(c) for c in codes if L.house_code(c)})
        s = Source.made("Client records › house codes", [{"abbreviation": c} for c in found], "Hub clients + Master")
        e.see(s)
        for c in found:
            e.offer({"abbreviation": c}, s.label)
        emp = self.employees()
        e.derive("house_manager_employee_id", lambda v: emp.get(nk(v.get("manager_name")), ""),
                 "Employee Entities › entity_employees (by manager name)")

    def employees(self) -> dict[str, str]:
        _ref, rows = self.bk.tab(self.bk.sid(*EMPLOYEES), "entity_employees")
        return self.unique(rows, lambda r: nk(r.get("employee_name")), lambda r: gsjs.trim(str(r.get("employee_id") or "")))

    def clients(self) -> None:
        e = self.entity("entity_clients", "client_id", "CLT_",
                        [("number", lambda v: d if len(d := digits(v.get("client_number"))) >= 4 else ""),
                         ("name", lambda v: canon_name(v.get("client_name")))], ("created_at", "updated_at"))
        if e is None:
            return
        hub = self.bk.hub_source("Hub clients", "clients", {
            "client_name": "name", "birthdate": "dob", "status": "status", "outcome": "outcome", "ama": "ama_date",
            "initials": "initials", "ssa_name": "ssa_name", "ssa_email": "ssa_email", "ssa_phone": "ssa_phone",
            "workshop": "workshop", "payee_rep_name": "payee_rep", "payee_rep_email": "payee_rep_email",
            "payee_rep_phone": "payee_rep_phone", "start_date": "start_date", "guardian_name": "guardianName",
            "address": "home_address", "client_number": "client_number", "media_release": "media_release",
            "guardian_email": "guardian_email", "guardian_phone": "guardian_phone", "medical_supply": "medical_supply",
            "transportation": "transportation", "workshop_phone": "workshop_phone",
            "guardian_address": "guardian_address", "tl_consent_form": "truelink_consent",
            "workshop_address": "workshop_address", "self_admin_expiration": "self_admin_expires",
            "transportation_phone": "transportation_phone", "guardian_relationship": "guardian_relationship",
            "self_admin_assessment": "self_admin_assessment", "isp_link": "isp_signed_date"})
        master = self.bk.source("Client DB › Master", self.bk.sid(*CLIENT_DB), "Master", {
            "client_name": "Client", "age": "Age", "ama": "AMA", "isp_link": "ISP", "ssa_name": "SSA",
            "ssa_phone": "SSA #", "status": "Status", "address": "Address", "outcome": "Outcome",
            "client_number": "Client #", "dc_pin": "DC PIN #", "guardian_name": "Guardian", "initials": "Initials",
            "workshop": "Workshop", "birthdate": "Birthdate", "payee_rep_name": "Payee Rep", "ssa_email": "SSA Email",
            "guardian_phone": "Guardian #", "start_date": "Start Date", "payee_rep_phone": "Payee Rep #",
            "media_release": "Media Release", "guardian_email": "Guardian Email", "medical_supply": "Medical Supply",
            "transportation": "Transportation", "workshop_phone": "Workshop Phone",
            "payee_rep_email": "Payee Rep Email", "guardian_address": "Guardian Address",
            "workshop_address": "Workshop Address", "guardian_relationship": "Guardian Relationship",
            "self_admin_assessment": "Self-Admin Assessment", "transportation_phone": "Transportation - Phone",
            "tl_consent_form": "True Link Consent Form", "self_admin_expiration": "Self-Admin Expiration Date"})
        for s in (hub, master):
            e.see(s)
            for r in s.rows:
                e.offer(s.cand(r), s.label)
        cid: Callable[[dict], str] = lambda v: gsjs.trim(str(v.get("client_id") or ""))  # noqa: E731
        views = [e.view(r) for r in e.all_rows()]
        self.client_ids = self.unique([{**v, "_k": k} for v in views for k in name_keys(v.get("client_name"))],
                                      lambda v: v["_k"], cid)
        commas = sum(1 for v in views if "," in str(v.get("client_name") or ""))
        if e.added:
            self.notes.append("entity_clients: appended rows by status — " + ", ".join(
                f"{k} {n}" for k, n in Counter(low(r.get("status")) or "(blank)" for r in e.added).items())
                + f"; {commas} client name(s) written 'Last, First' (matched both ways)")

    def client_id(self, name: Any) -> str:
        return next((self.client_ids[k] for k in name_keys(name) if k in self.client_ids), "")

    def isp(self) -> None:
        # one plan per client, under the client's own entity_clients id: a client it does not hold gets no row
        e = self.entity("entity_isp", "client_id", "CLT_",
                        [("client", lambda v: gsjs.trim(str(v.get("client_id") or ""))),
                         ("name", lambda v: canon_name(v.get("client_name")))], ("last_updated", "updated_by"), mint=False)
        if e is None:
            return
        s = self.bk.hub_source("Hub isps", "isps", {
            "client_name": "client_name", "important_to": "important_to", "important_for": "important_for",
            "medical_medications": "medications", "medical_supervision": "supervision_level",
            "medical_allergies": "allergies", "medical_diagnoses": "diagnoses", "known_risks": "safety_risks"})
        e.see(s)
        for r in s.rows:
            c = s.cand(r)
            c["client_id"] = self.client_id(c.get("client_name"))
            e.offer(c, s.label)

    def physicians(self) -> None:
        def near(vals: dict, rows: list[dict]) -> list[dict]:
            mine = pset(vals.get("name"))
            if not mine:
                return []
            out = []
            for r in rows:
                theirs = pset(r.get("name"))
                if theirs and (mine <= theirs or theirs <= mine) and any(len(t) >= 3 for t in mine & theirs):
                    out.append(r)
            return out

        # a doctor is first the text an appointment names it by (one physician per distinct name, as the tab was built)
        e = self.entity("entity_physicians", "physician_id", "PHY_",
                        [("raw", lambda v: gsjs.trim(str(v.get("name") or ""))),
                         ("exact", lambda v: pn(v.get("name"))),
                         ("tokens", lambda v: " ".join(sorted(pset(v.get("name")))))],
                        ("created_at", "updated_at"))
        if e is None:
            return
        dr = self.bk.sid("ESTATE_DR_ID")
        visits = self.bk.source("Dr Appt Archive (doctors named)", dr, "Dr Appt Archive",
                                {"name": "Dr Name", "address": "Appointment Address"})
        e.see(visits)
        for r in visits.rows:
            e.offer(visits.cand(r), visits.label)
        master = self.bk.source("Dr Master", dr, "Dr Master", {
            "name": "Dr Name", "phone": "Phone", "fax": "Fax", "address": "Address", "specialty": "Specialist"})
        e.see(master)
        # the doctors' list names a doctor more loosely than an appointment: one name inside the other is the same one
        e.near = near
        for r in master.rows:
            e.offer(master.cand(r), master.label)

        def part(col: str) -> Callable[[dict], str]:
            def got(v: dict) -> str:
                a = gsjs.trim(str(v.get("address") or ""))
                m = _ADDR_ZIP.search(a)
                if not m or m.group(1) not in _STATES:
                    return ""
                if col == "city":
                    c = _ADDR_CITY.search(a)
                    return gsjs.trim(c.group(1)) if c else ""
                return m.group(1) if col == "state" else m.group(2)
            return got
        for col in ("city", "state", "zip"):
            e.derive(col, part(col), "the row's own address (read off its tail)")
        views = [e.view(r) for r in e.all_rows()]
        pid: Callable[[dict], str] = lambda v: gsjs.trim(str(v.get("physician_id") or ""))  # noqa: E731
        self.phys_raw = self.unique(views, lambda v: gsjs.trim(str(v.get("name") or "")), pid)
        self.phys_ids = self.unique(views, lambda v: pn(v.get("name")), pid)
        self.phys_sets = self.unique(views, lambda v: " ".join(sorted(pset(v.get("name")))), pid)

    def physician_id(self, name: Any) -> str:
        return (self.phys_raw.get(gsjs.trim(str(name or ""))) or self.phys_ids.get(pn(name))
                or self.phys_sets.get(" ".join(sorted(pset(name))), ""))

    def appointments(self) -> None:
        def key(with_time: bool) -> Callable[[dict], str]:
            return lambda v: joined(nk(v.get("client_name")), day(v.get("appointment_date")),
                                    pn(v.get("physician_name")), hm(v.get("appointment_time")) if with_time else "-")
        e = self.entity("entity_appointments", "appointment_id", "APT_", [("full", key(True)), ("day", key(False))])
        if e is None:
            return
        s = self.bk.source("Dr Appt Archive", self.bk.sid("ESTATE_DR_ID"), "Dr Appt Archive", {
            "physician_name": "Dr Name", "client_name": "Client Name", "appointment_date": "Appointment Date",
            "appointment_time": "Appointment Start Time", "appointment_address": "Appointment Address",
            "wheelchair_van_required": "Wheelchair Van Required?"})
        e.see(s)
        for r in s.rows:
            e.offer(s.cand(r), s.label)
        e.derive("client_id", lambda v: self.client_id(v.get("client_name")), "entity_clients (by client name)")
        e.derive("physician_id", lambda v: self.physician_id(v.get("physician_name")),
                 "entity_physicians (by doctor name)")

    def daily_notes(self) -> None:
        e = self.entity("entity_daily_notes", "note_id", "NTE_", [
            ("call", lambda v: joined(gsjs.trim(str(v.get("twilio_call_sid") or "")), low(v.get("category")),
                                      tk(v.get("response"), 160))),
            ("text", lambda v: joined(low(v.get("category")), day(v.get("reporting_date")),
                                      tk(v.get("response"), 160)))])
        if e is None:
            return
        s = self.bk.source("Staff Daily Notes › Notes", self.bk.sid("ESTATE_NOTES_ID"), "Notes", {
            "twilio_call_sid": "call_id", "category": "category", "dsp_name": "dsp_name", "response": "response",
            "submitted_at": "timestamp", "client_name": "client_name", "caller_phone": "caller_phone",
            "reporting_date": "reporting_date"})
        e.see(s)
        for r in s.rows:
            e.offer(s.cand(r), s.label)
        e.derive("client_id", lambda v: self.client_id(v.get("client_name")), "entity_clients (by client name)")

    def incidents(self) -> None:
        e = self.entity("entity_incidents", "incident_id", "INC_", [
            ("filed", lambda v: joined(minute(v.get("submitted_at")), nk(v.get("client_name")))),
            ("what", lambda v: joined(nk(v.get("client_name")), day(v.get("incident_date")), tk(v.get("summary"), 120))),
            ("when", lambda v: joined(day(v.get("incident_date")), tk(v.get("summary"), 120)))])
        if e is None:
            return
        s = self.bk.source("UIs and MUIs", self.bk.sid("ESTATE_UI_ID"), "UIs and MUIs", {
            "submitted_at": "Timestamp", "reporter_name": "Your Name", "client_name": "Client Name",
            "incident_date": "Incident Date", "incident_time": "Incident Time", "prevention_plan": "Prevention Plan",
            "category": "Incident Category", "location": "Incident Location",
            "employees_involved": "Employees Involved", "summary": "Summary of Incident",
            "immediate_action": "Immediate Action Taken", "reported_date": "Incident Reported Date",
            "reported_time": "Incident Reported Time", "cause_factors": "Cause and Contributing Factors"})
        e.see(s)
        for r in s.rows:
            e.offer(s.cand(r), s.label)
        e.derive("client_id", lambda v: self.client_id(v.get("client_name")), "entity_clients (by client name)")

    def referrals(self) -> None:
        e = self.entity("entity_referrals", "referral_id", "REF_", [
            ("service", lambda v: joined(digits(v.get("source_client_id")), day(v.get("service_start_date")),
                                         tk(v.get("description_of_service"), 60))),
            ("named", lambda v: joined(nk(v.get("client_display_name")), day(v.get("expiration_date")),
                                       tk(v.get("description_of_service"), 60)))])
        if e is None:
            return
        legacy = self.bk.source("Potential_Clients › Data", self.bk.sid(*REFERRALS), "Data", {
            "race": "client.race", "email": "client.email", "gender": "client.gender", "language": "client.language",
            "diagnosis": "client.diagnosis", "ethnicity": "client.ethnicity", "frequency": "frequency",
            "client_age": "client_age", "home_phone": "client.home_phone", "provider_type": "provider_type",
            "residence_zip": "client_residence_postal_code", "marital_status": "client.marital_status",
            "residence_city": "client_residence_city", "expiration_date": "expiration_date_friendly",
            "client_last_name": "client.last_name", "source_client_id": "client_id",
            "client_first_name": "client.first_name", "funding_source_id": "funding_source_id",
            "service_start_date": "service_start_date", "client_display_name": "client_display_name",
            "description_of_service": "description_of_service"})
        leads = self.bk.hub_source("Hub potentialClients (Leads)", "potentialClients", {
            "client_display_name": "client_name", "email": "email", "diagnosis": "diagnosis", "frequency": "frequency",
            "client_age": "client_age", "residence_zip": "postal_code", "gender": "client_gender",
            "funding_source_id": "funding_source", "expiration_date": "expiration_date",
            "description_of_service": "description", "home_phone": "phone"})
        e.see(leads)
        e.see(legacy)
        id_head = next((h for h in (legacy.ref.headers if legacy.ref else ()) if h == "id"), None)
        bridge = {}
        for r in legacy.rows:
            k = digits(r.get(id_head)) if id_head else ""
            if k:
                bridge[k] = r
        ref_head = next((h for h in (leads.ref.headers if leads.ref else ()) if h == "referral_id"), None)
        bridged = 0
        for r in leads.rows:
            c = {k: v for k, v in leads.cand(r).items() if v != ""}
            old = bridge.get(digits(r.get(ref_head))) if ref_head else None
            if old is not None:
                bridged += 1
                c.update({k: v for k, v in legacy.cand(old).items() if v != ""})
            e.offer(c, leads.label)
        for r in legacy.rows:
            e.offer(legacy.cand(r), legacy.label)
        self.notes.append(f"entity_referrals: {bridged} of {len(leads.rows)} Leads rows carry a referral id the "
                          "Potential_Clients book holds (matched through it); the rest match by name, dates and service")

    def staff_off(self) -> None:
        ref = self.db.tab(self.sid, L.STAFF_OFF_TAB)
        if ref is not None:
            self.notes.append(f"{L.STAFF_OFF_TAB}: in {self.bk.name(self.sid)} ({ref.row_count} rows); nothing to create")
        else:
            self.notes.append(f"{L.STAFF_OFF_TAB}: not in {self.bk.name(self.sid)} — --apply --create-tabs makes it "
                              f"with the header ({', '.join(W.STAFF_OFF_HEADER)}); Locations reads and writes it there")

    def run(self, only: set[str] | None = None) -> "Plan":
        for tab, step in (("entity_homes", self.homes), ("entity_clients", self.clients), ("entity_isp", self.isp),
                          ("entity_physicians", self.physicians), ("entity_appointments", self.appointments),
                          ("entity_daily_notes", self.daily_notes), ("entity_incidents", self.incidents),
                          ("entity_referrals", self.referrals)):
            step()
            if only and tab not in only:
                self.ents.pop(tab, None)
        self.staff_off()
        return self

    def records(self) -> dict[str, list[dict]]:
        return {tab: e.records() for tab, e in self.ents.items()}


# ---- the runs -----------------------------------------------------------------------------------------------------

def kept_edits(query: Callable[[str], list[tuple]]) -> list[dict]:
    return [W._edit_row(r) for r in query(W.edits_sql())]


def build(db: hubdb.HubDb, edits: list[dict], only: set[str] | None) -> Plan:
    token = hubdb.OWN.set(W.Own([], edits=edits))
    try:
        return Plan(db, datetime.now(timezone.utc)).run(only)
    finally:
        hubdb.OWN.reset(token)


def print_plan(plan: Plan, mode: str, laid: str) -> None:
    b = plan.db.book(plan.sid)
    stale = plan.db.stale({plan.sid})
    print(f"fill-client-entities ({mode}) — {plan.bk.name(plan.sid)} [{plan.sid[:10]}…]; copy synced "
          f"{getattr(b, 'synced_at', None)}; book modified {getattr(b, 'modified_time', None)}"
          f"{' — STALE: the sheet changed after the copy' if stale else ''}; {laid}")
    total_rows = total_cells = 0
    for tab in TABS:
        e = plan.ents.get(tab)
        if e is None:
            continue
        for line in e.report():
            print(line)
        total_rows += len(e.added)
        total_cells += sum(len(c) for c in e.fills.values())
    recs = sum(len(r["cells"]) for rs in plan.records().values() for r in rs)
    print(f"== total: {total_rows} rows to append, {total_cells} cells to fill; {recs} app.edits rows")
    for n in plan.notes:
        print("   note: " + n)


def create_staff_off(sid: str) -> str:
    """house_staff_off made in the book with its header, as living-brain (the sync never makes a tab)."""
    import requests  # noqa: PLC0415
    import sheet_sync as S  # noqa: PLC0415
    token = S._sa_token(S.SA_FILE)
    http = requests.Session()

    def call(method: str, path: str, params: dict | None = None, body: dict | None = None) -> dict:
        r = http.request(method, S.API + path, params=params, json=body, timeout=60,
                         headers={"Authorization": "Bearer " + token()})
        if r.status_code != 200:
            raise RuntimeError(f"Google answered {r.status_code}: {str(r.text)[:200]}")
        return r.json()

    got = call("GET", f"/{sid}", {"fields": "sheets.properties.title"})
    if L.STAFF_OFF_TAB in [s["properties"]["title"] for s in got.get("sheets", [])]:
        return "already in the book"
    head = list(W.STAFF_OFF_HEADER)
    call("POST", f"/{sid}:batchUpdate", None, {"requests": [{"addSheet": {"properties": {
        "title": L.STAFF_OFF_TAB, "gridProperties": {"rowCount": 1000, "columnCount": len(head), "frozenRowCount": 1}}}}]})
    rng = f"'{L.STAFF_OFF_TAB}'!A1:{S.col_letter(len(head))}1"
    call("PUT", f"/{sid}/values/{urllib.parse.quote(rng, safe='')}", {"valueInputOption": "RAW"},
         {"values": [head], "majorDimension": "ROWS"})
    return "created with its header"


def apply(db: hubdb.HubDb, only: set[str] | None, create_tabs: bool) -> int:
    import psycopg  # noqa: PLC0415
    dsn = os.getenv("HUB_DB_WRITE_DSN", "").strip()
    if not dsn:
        print("HUB_DB_WRITE_DSN is not set: --apply records app.edits as the writer role (run it in asa-hub-sheet-sync)")
        return 2
    sid = Books(db).sid(L.ENTITIES_PROP, L.ENTITIES_FALLBACK)
    if db.stale({sid}):
        print("the copy of the Client Entities book is older than the sheet: wait for asa-hub-db-sync, then run again")
        return 3
    if create_tabs:
        print(f"{L.STAFF_OFF_TAB}: {create_staff_off(sid)}")
    c = psycopg.connect(dsn, autocommit=True, connect_timeout=5, application_name="fill-client-entities")
    c.execute("set statement_timeout = '120s'")
    for stmt in W.edits_ddl():
        c.execute(stmt)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    with c.transaction():
        cur = c.cursor()
        cur.execute("set local lock_timeout = '15s'")
        cur.execute("select pg_advisory_xact_lock(%s)", (W.LOCK_KEY,))
        cur.execute(W.edits_sql())
        edits = [W._edit_row(r) for r in cur.fetchall()]
        plan = build(db, edits, only)
        print_plan(plan, "apply", f"{len(edits)} kept edit cell(s) laid first")
        n = 0
        for tab, recs in plan.records().items():
            if not recs:
                continue
            wid = f"entities-fill:{tab}:{stamp}"
            rows = W.edit_rows(wid, APP, ACTION, W.Decision(None, edits=recs), AUTHOR)
            # a tab kept in its own table takes its records there (writes.into_tables), as every write does
            tabled = W.into_tables(cur, wid, recs, AUTHOR)
            rows = [r for r in rows if (r[3], r[4]) not in tabled]
            if not rows:
                continue
            cur.executemany(
                f"insert into {W.EDITS_TABLE} (write_id, app, action, sheet_id, tab_name, kind, match_by, keyed_by,"
                " row_key, field, value, before, author, edition)"
                " values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)", rows)
            n += len(rows)
    print(f"recorded {n} app.edits row(s) under write ids entities-fill:<tab>:{stamp}; asa-hub-sheet-sync writes them")
    return 0


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--dry-run", action="store_true", help="the default: plan and print, write nothing")
    ap.add_argument("--apply", action="store_true", help="record the plan as app.edits")
    ap.add_argument("--create-tabs", action="store_true", help="with --apply: make house_staff_off in the book")
    ap.add_argument("--only", default="", help="comma-separated entity tabs to plan (default: all)")
    a = ap.parse_args(argv)
    if R is None:
        print("server/redaction.py is not on the path: nothing is planned without the withholding rule")
        return 2
    if a.create_tabs and not a.apply:
        print("--create-tabs needs --apply")
        return 2
    only = {t.strip() for t in a.only.split(",") if t.strip()} or None
    if only and only - set(TABS):
        print("unknown tab(s): " + ", ".join(sorted(only - set(TABS))))
        return 2
    db = hubdb.HubDb()
    if a.apply and not a.dry_run:
        return apply(db, only, a.create_tabs)
    try:
        edits = kept_edits(db.query)
        laid = f"{len(edits)} kept edit cell(s) laid over the copy"
    except hubdb.Unreadable as exc:
        edits, laid = [], f"app.edits not read ({exc}); planned off the copy alone"
    print_plan(build(db, edits, only), "dry-run", laid)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
