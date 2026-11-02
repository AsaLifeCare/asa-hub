"""The Hub's houses kept in their own tables (sheet_resources.SPECS, by house name): read there, a row found by its
key column (id, or key for a settings house), changed or made there, for the apps whose writers name a house
(Scheduling, Transportation). A house not listed here is still its spreadsheet's copy."""
from __future__ import annotations

import re
from typing import Any

import gsjs
import hubdb
import locations as L
import resource_rows as RR


def resource_of(tab: str) -> str | None:
    """The table a house lives in, or None while it is its copy."""
    import sheet_resources as SR  # noqa: PLC0415 - it imports the apps this module serves

    return SR.TAB_OF.get(tab)


def tabled(tab: str) -> bool:
    return resource_of(tab) is not None


def data_home(db: Any, sheet_id: str, kept: dict[str, str]) -> str | None:
    """The house a book's Data tab keeps, among the houses kept in tables whose upload named that book ({tab:
    resource}): its pointer names the book, which holds no tab of the house's own name (writes.where_of)."""
    homes = [r for t, r in kept.items()
             if db.house_moved(t) and db.house_id(t) == sheet_id and db.tab(sheet_id, t) is None]
    if len(homes) > 1:
        raise hubdb.Unreadable("two houses kept in tables name one Data tab")
    return homes[0] if homes else None


def rows(reads: L.Reads, tab: str) -> list[dict]:
    """Every row of the house's table, each cell its text as kept (JSON stays text, as the house's copy held it)."""
    resource = resource_of(tab) or ""

    def read() -> list[dict]:
        cols = RR.columns(reads, resource)
        out = []
        for _k, cells in RR.table_rows(reads, resource):
            row = {h: gsjs.or_blank(cells.get(h)) for h in cols if h}
            if any(v != "" for v in row.values()):
                out.append(row)
        return out
    return [dict(r) for r in reads.once("house_tables:" + resource, read)]


def placed(reads: L.Reads, tab: str, resource: str | None = None
           ) -> tuple[list[str], list[tuple[str, int, dict, dict]]]:
    """(headers, (row key, row number, cells by header, cells as kept)) of every row: the table's columns, each row
    numbered by its position (an uploaded row keeps its sheet row), its cells the text as kept. `resource` names the
    house when its tab name is not its own (sheet_resources.BOOKED)."""
    resource = resource or resource_of(tab) or ""
    cols = [h for h in RR.columns(reads, resource) if h]
    return cols, [(k, p, {h: gsjs.or_blank(c.get(h)) for h in cols}, c) for k, p, c in RR.placed_rows(reads, resource)]


def raw(reads: L.Reads, tab: str, resource: str | None = None) -> tuple[list[str], list[tuple[int, dict]]]:
    """(headers, (row number, cells)) as a copy's tab and rows were read."""
    cols, rows = placed(reads, tab, resource)
    return cols, [(p, cells) for _k, p, cells, _c in rows]


def resource_in(reads: L.Reads, sheet_id: str, tab: str) -> str | None:
    """The house a book's tab is kept as: one that names its book and tab, else the one its tab names when its upload
    named this book; None while the copy is the record."""
    import sheet_resources as SR  # noqa: PLC0415

    for r, spec in SR.BOOKED.items():
        if spec["tab"] == tab and SR.book_of(reads.db, r) == sheet_id:
            return r if uploaded(reads, r) else None
    if tab == hubdb.HOUSE_DATA_TAB and sheet_id:
        # a house book's Data tab: the house it keeps (data_home)
        kept = reads.once("house_tables:data:" + sheet_id, lambda: {str(t): str(r) for r, t in RR._q(
            reads, f"select resource, tab_name from {RR.COLUMNS} where sheet_id = %s and uploaded_at is not null",
            (sheet_id,))})
        return data_home(reads.db, sheet_id, kept)
    resource = resource_of(tab)
    if resource is None:
        return None
    book = reads.once("house_tables:book:" + resource, lambda: next(iter(
        r[0] for r in RR._q(reads, f"select sheet_id from {RR.COLUMNS} where resource = %s"
                                   " and uploaded_at is not null", (resource,))), ""))
    return resource if book and book == sheet_id else None


class KeptRef:
    """A house kept in its own table, where a reader holds a copy's tab: its headers, and a stamp (`table`,
    `loaded_at`, `row_count`) that moves whenever a row is made, changed or removed. It names no book."""

    def __init__(self, reads: L.Reads, tab: str, resource: str | None = None) -> None:
        self.tab, self.resource, self.sheet_id = tab, resource or resource_of(tab) or "", ""
        self.headers = [h for h in RR.columns(reads, self.resource) if h]
        got = RR._q(reads, f"select count(*) filter (where removed_at is null), max(updated_at), max(created_at),"
                           f" max(removed_at) from {RR.rows_of(self.resource)} where resource = %s", (self.resource,))
        n, *marks = got[0] if got else (0, None, None, None)
        self.table, self.row_count = hubdb.KEPT_TABLE + self.resource, int(n or 0)
        self.loaded_at = "|".join(map(str, marks))


def kept_ref(reads: L.Reads, tab: str, resource: str | None = None) -> KeptRef:
    resource = resource or resource_of(tab) or ""
    return reads.once("house_tables:ref:" + resource, lambda: KeptRef(reads, tab, resource))


def book_tab(reads: L.Reads, sheet_id: str, tab: str) -> Any:
    """reads.db.tab (a book's tab, None when the copy has none), the house's own table once that book's tab is kept in
    one."""
    resource = resource_in(reads, sheet_id, tab)
    return _in_book(kept_ref(reads, tab, resource), sheet_id) if resource is not None else reads.db.tab(sheet_id, tab)


def tab_of(reads: L.Reads, sheet_id: str, tab: str, label: str) -> Any:
    """reads.tab_of (a book's tab, by its id), the house's own table (a KeptRef) once that book's tab is kept in one."""
    resource = resource_in(reads, sheet_id, tab)
    if resource is not None:
        return _in_book(kept_ref(reads, tab, resource), sheet_id)
    return reads.tab_of(sheet_id, tab, label)


def _in_book(ref: KeptRef, sheet_id: str) -> KeptRef:
    """A table found by its book and tab names that book, as the copy's tab did: a write taking its book off the ref
    (ref.sheet_id) names the (book, tab) writes.into_tables lays on the table."""
    ref.sheet_id = ref.sheet_id or sheet_id
    return ref


def uploaded(reads: L.Reads, resource: str) -> bool:
    """Whether the house's table holds it yet (declared before its upload, its copy still answers)."""
    return reads.once("house_tables:up:" + resource, lambda: RR.uploaded(reads.db, resource))


def where(reads: L.Reads, tab: str) -> hubdb.Resolved:
    """reads.db.resolve(tab), its tab the house's own table once it is kept there (a KeptRef, which tab_rows and
    normalized read). A write still names the book and the tab where_of gives it; writes.into_tables lays it there."""
    res = reads.db.resolve(tab)
    resource = resource_of(tab)
    return res._replace(ref=kept_ref(reads, tab)) if resource and uploaded(reads, resource) else res


def tab_rows(reads: L.Reads, ref: Any) -> list[tuple[int, dict]]:
    """(row number, cells) of a house's tab: its table's rows, else the copy's with the kept edits laid."""
    if isinstance(ref, KeptRef):
        return raw(reads, ref.tab, ref.resource)[1]
    return reads.db.rows(ref) if ref is not None else []


def normalized(reads: L.Reads, ref: Any) -> list[dict]:
    """readTabNormalized_ (hubdb.normalized_rows) of a house's tab, read from its table once it is kept there."""
    return hubdb.normalize(ref.headers, tab_rows(reads, ref)) if ref is not None else []


def project(reads: L.Reads, ref: KeptRef, headers: list[str],
            near: tuple[str, list[str], list[str]] | None = None) -> list[tuple[int, dict]]:
    """(row number, {header: text}) of a few columns of a kept house, as staff_comms._project reads a copy's: near =
    (how, headers, values) narrows the rows in the database — "digits" a row whose digits in those columns hold one of
    the ten-digit values, "contains" a row whose cell holds one of the values, "sides" a row one of whose cells, its
    digits alone, holds one of the values (as the SSA's texts are narrowed)."""
    want = [h for h in headers if h in ref.headers]
    # a blank cell is text, as the copy's columns hand it back
    sel = "".join(", coalesce(cells->>%s, '')" for _h in want)
    params: list[Any] = list(want) + [ref.resource]
    cond = ""
    how, heads, values = near or ("", [], [])
    cols = [h for h in heads if h in ref.headers]
    if cols and values and how == "digits" and all(re.fullmatch(r"\d{10}", v, re.A) for v in values):
        cond = " and regexp_replace(" + " || ' ' || ".join("coalesce(cells->>%s, '')" for _c in cols) + \
               ", '[^0-9]+', '', 'g') ~ %s"
        params += cols + ["|".join(values)]
    elif cols and values and how == "contains":
        cond = " and (" + " or ".join("strpos(coalesce(cells->>%s, ''), %s) > 0" for _c in cols for _v in values) + ")"
        params += [x for c in cols for v in values for x in (c, v)]
    elif cols and values and how == "sides":
        cond = " and (" + " or ".join("regexp_replace(coalesce(cells->>%s, ''), '[^0-9]', '', 'g') like %s"
                                      for _c in cols for _v in values) + ")"
        params += [x for c in cols for v in values for x in (c, f"%{v}%")]
    elif how == "sides":
        return []
    got = RR._q(reads, f"select position{sel} from {RR.rows_of(ref.resource)} where resource = %s"  # noqa: S608
                       f" and removed_at is null{cond} order by position, created_at, row_key", tuple(params))
    return [(int(r[0] or 0), {h: r[i + 1] for i, h in enumerate(want)}) for r in got]


def rewrite(reads: L.Reads, tab: str, lines: list[dict[str, Any]], by: str) -> int:
    """A whole-tab rewrite (clearContent under the header, then setValues) of a house kept in its own table: its rows,
    in order, become the lines — each standing row given the line's cells (a column the line names none of emptied),
    the rows past the last line removed, the lines past the last row made; how many rows it changed, made or
    removed."""
    resource = resource_of(tab)
    if resource is None:
        raise KeyError(f"{tab} is not kept in a table")
    held = RR.table_rows(reads, resource)
    want = [{str(h): gsjs.or_blank(v) for h, v in line.items()} for line in lines]
    changed = []
    for (key, cells), line in zip(held, want):
        after = {**{h: "" for h in cells}, **line}
        if any(gsjs.or_blank(cells.get(h)) != v for h, v in after.items()):
            changed.append((key, cells, after))
    RR.update_many(reads, resource, changed, by)
    for key, cells in held[len(want):]:
        RR.remove(reads, resource, key, cells, by)
    made = [{h: v for h, v in line.items() if v != ""} for line in want[len(held):]]
    RR.create_many(reads, resource, made, by)
    return len(changed) + max(0, len(held) - len(want)) + len(made)


def find(reads: L.Reads, tab: str, col: str, key: str) -> tuple[str, dict] | None:
    """(row key, cells) of the first row whose `col` holds `key`."""
    for k, c in RR.table_rows(reads, resource_of(tab) or ""):
        if gsjs.trim(gsjs.or_blank(c.get(col))) == key:
            return k, c
    return None


def put(reads: L.Reads, tab: str, col: str, key: str, cells: dict[str, Any], by: str) -> None:
    """The row whose `col` is `key`: its changed cells written, else the row made with its non-empty cells."""
    resource = resource_of(tab)
    if resource is None:
        raise KeyError(f"{tab} is not kept in a table")
    clean = {h: gsjs.or_blank(v) for h, v in cells.items()}
    hit = find(reads, tab, col, key)
    if hit is None:
        RR.create(reads, resource, {h: v for h, v in clean.items() if v != ""}, by)
        return
    changed = {h: v for h, v in clean.items() if gsjs.or_blank(hit[1].get(h)) != v}
    if changed:
        RR.update(reads, resource, hit[0], hit[1], changed, by)
