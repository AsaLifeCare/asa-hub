"""A client's name and status (ClientProfiles.gs clientProfileRename, clientProfileStatus) decided off asa-hub-db: the
rename's plan read from every Hub tab and outside book that names the client by name or key, each cell kept in app.edits
(the sheets follow through the sync), the resources Postgres keeps (app.resource_rows) re-keyed there, and a tab no
kept edit can carry (a header named for the client, rows no key tells apart) renamed on the sheet itself (book_ops);
the status' Hub row kept the same way, and the book row moved between the Master and the archive by book_ops."""
from __future__ import annotations

import json
import math
import re
from typing import Any, Callable

import book_ops as BO
import clients as C
import dr_book as DB
import gsjs
import hubdb
import locations as L
import resource_rows as RR
import sheet_resources as SR
import writes as W
from gsjs import name_key
from writes import Decision

# CP_RENAME_ELSEWHERE
ELSEWHERE = ("PsiAnywhere, DODD's billing reports and the forms that feed these books keep the names they hold until "
             "they are changed there.")
MED_PATIENTS_TAB = "med_patients"
# cpRenameHubTabs_: CP_REKEY_TABS, then every clientScoped RESOURCES sheet (Main.gs, in its order) neither read by house
# or address nor an estate book, then the PSI punches and the form answers
HUB_TABS: tuple[dict[str, Any], ...] = (
    {"tab": "clients", "key": ("client_key",), "name": ("name",)},
    {"tab": "isps", "key": ("client_key",), "name": ("client_name",)},
    {"tab": "client_files", "key": ("client_key",), "name": ("client_name",)},
    {"tab": "client_notes", "key": ("client_key",), "name": ("client_name",)},
    {"tab": "isp_contacts", "key": ("client_key",), "name": ("client_name",)},
    {"tab": "isp_sections", "key": ("client_key",), "ids": ("id",)},
    {"tab": "incident_reviews", "key": ("client_key",), "name": ("client_name",), "ids": ("id",)},
    {"tab": "client_overrides", "key": ("client_key",), "ids": ("target",)},
    {"tab": "house_notes", "key": ("client_key",)},
    {"tab": "family_notes", "key": ("client_key",)},
    {"tab": "vc_trips", "key": ("client_key",), "name": ("client_name",)},
    {"tab": "tasks", "key": ("client_key",), "name": ("client_name",)},
    {"tab": "users", "key": ("client_key",)},
    {"tab": "photos", "name": ("title",), "where": {"kind": "avatar"}},
    *({"tab": t, "any": True} for t in (
        "hydrationProfiles", "mealIdeals", "mealPlans", "sleepProfiles", "finance_transactions", "finance_balances",
        "ist_records", "ist_houses", "visits", "workoutPlans", "incidents", "mar_entries", "medications", "mar_errors",
        "missing_medications", "med_deliveries", "care_docs", "billing_claims")),
    {"tab": L.PSI_PUNCHES_FULL_TAB, "name": ("consumer_1", "consumer_2", "consumer_3"), "list": ("consumers",)},
    {"tab": "form_submissions", "json": ("answers",)},
)
_FORM_NAMES = (re.compile(r"^selectclient"), "clientname", "client")
_DR, _MM, _VAN = "Dr Appointments › ", "Missing Medications › ", "Van Calendar › "
_MM_BOOK = {"prop": "HUB_MISSING_MEDS_SHEET_ID", "fallback": "19Umc82evptvKj7GLG2RNdr6VhKDnX0Mp6C1paX6Gw1w"}
_VAN_BOOK = {"prop": "HUB_VAN_CALENDAR_SHEET_ID", "fallback": "15W2-gLb-Sn3ScLXxzdjZyDuVIZELNlhLK3C1rP21ngg"}
# cpRenameBooks_: the books outside the Hub tabs that match a client by name
BOOKS: tuple[dict[str, Any], ...] = (
    {"book": "Asa Client Database › " + C.MASTER_TAB, "master": True, "book_names": True, "one": True},
    {"book": "Master Data › " + C.MASTER_DATA_TAB, "prop": C.MASTER_DATA_PROP, "tab": C.MASTER_DATA_TAB,
     "book_names": True, "one": True},
    {"book": _DR + "Dr Appt Archive", "estate": "drVisits", "name": ("clientname",)},
    {"book": _DR + "Future Apts", "estate": "drVisits", "tab": "Future Apts", "name": ("clientname",)},
    {"book": _DR + "Dr Master", "estate": "drAppointments", "name": ("client",)},
    {"book": "UIs and MUIs", "estate": "uiIncidents", "name": ("clientname",)},
    {"book": "Staff Daily Notes", "estate": "dailyNotes", "name": ("clientname",)},
    {"book": _MM + "Form Responses 4", **_MM_BOOK, "tab": "Form Responses 4", "name": _FORM_NAMES,
     "heads": re.compile(r"^(.+?)\s*:\s*medications?\s*$", re.I)},
    {"book": _MM + "Form Responses 1", **_MM_BOOK, "tab": "Form Responses 1", "name": _FORM_NAMES,
     "heads": re.compile(r"^(.+?)\s*:\s*medications?\s*$", re.I)},
    {"book": _MM + "Low Refills", **_MM_BOOK, "tab": "Low Refills", "name": ("client", "clientname")},
    {"book": _MM + "Medication Control", **_MM_BOOK, "tab": "Medication Control", "name": ("client", "clientname")},
    {"book": _VAN + "Requests", **_VAN_BOOK, "tab": "Requests", "name": ("clientname",)},
    {"book": _VAN + "Conflicts", **_VAN_BOOK, "tab": "Conflicts", "list": (re.compile(r"^clients?inconflict"),)},
    {"book": "TrueLink Reconciliation › Transactions", "prop": "FIN_TRUELINK_SHEET_ID", "tab": "Transactions",
     "name": ("cardholdername",)},
    {"book": "PAWS Adjustments", "prop": "HUB_PAWS_BOOK_ID", "fallback": "1C81euMJk7rHL3DCymerYk0gG__5Rg9sNVwJFmxD5bIw",
     "tab": "Sheet1", "must": ("Name", "Span"), "name": ("name",)},
    {"book": "Asa Client Database › Sheet6", "prop": C.CLIENT_DB_PROP, "fallback": C.CLIENT_DB_FALLBACK,
     "tab": "Sheet6", "must": ("Client", "Span"), "name": ("client",)},
    {"book": "Billing Errors › EVV Fixes", "prop": "HUB_BILLING_ERRORS_BOOK_ID",
     "fallback": "1wEMjXy9LcOjsZgGY3Z8m6VbLcLTFNw-BCXQpIcZUKpA", "tab": "EVV Fixes", "must": ("Client", "Date"),
     "last": ("client",)},
)
ESTATE = {**C.ESTATE, **L.ESTATE_SOURCES}
_LIST_SPLIT = re.compile(r"(\s*[;,/&|\n]\s*|\s+and\s+)", re.I)
_INDEX_KEY = re.compile(r"0|[1-9][0-9]{0,9}")
_KEYISH = re.compile(r"(id|key|uuid)$")
_ID_NUMBERS = ("clientno", "clientnumber", "medicaidno", "medicaidnumber", "doddno")
_STAMPS = ("timestamp", "createdat", "submittedat")
# Python keeps an edit by a key that outlives it, where Apps Script wrote a row number: why a row is not carried
HEADER_CELL = "its column named for this client is a header, which a kept edit does not rename"
WITHHELD = "the copy withholds part of a cell the new name would be written into"
UNTOLD = "a row it would rewrite cannot be told apart from another one"
# what a kept edit cannot carry and the sheet itself takes (book_ops), as cpRenamePlan_ wrote every cell there
ON_SHEET = (HEADER_CELL, WITHHELD, UNTOLD)
NO_COPY = "asa-hub-db holds no copy of it"


# ---- the cells, as cpRenameName_, cpRenameList_ and cpRenameJson_ rewrite them ---------------------------------------

def fold(h: Any) -> str:
    """cpRenameScan_'s fold: cpFold_ with every '(…)' dropped."""
    return C.fold(re.sub(r"\([^)]*\)", " ", gsjs.or_blank(h)))


def rename_name(v: Any, rn: dict) -> str | None:
    """cpRenameName_: a whole-name cell renamed ("Last, First" kept so), or None when it names someone else."""
    s = gsjs.trim(gsjs.or_blank(v))
    if not s:
        return None
    if name_key(s) == rn["fold"]:
        return rn["new_name"]
    parts = s.split(",")
    if len(parts) == 2 and name_key(parts[1] + " " + parts[0]) == rn["fold"]:
        w = rn["new_name"].split(" ")
        return w[-1] + ", " + " ".join(w[:-1])
    return None


def rename_list(v: Any, rn: dict) -> str | None:
    """cpRenameList_: a cell that lists names, with this client's renamed; None when it does not list them."""
    parts = _LIST_SPLIT.split(gsjs.or_blank(v))
    hit = False
    for i in range(0, len(parts), 2):
        if gsjs.trim(parts[i]) and name_key(parts[i]) == rn["fold"]:
            parts[i] = rn["new_name"]
            hit = True
    return "".join(parts) if hit else None


def _no_constant(name: str) -> Any:
    raise ValueError(name)


def js_json(v: Any) -> str:
    """JSON.stringify: an object's index keys first, a whole number without its point, NaN and Infinity as null."""
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return gsjs.num_str(v) if math.isfinite(v) else "null"
    if isinstance(v, str):
        return json.dumps(v, ensure_ascii=False)
    if isinstance(v, list):
        return "[" + ",".join(js_json(x) for x in v) + "]"
    keys = list(v)
    first = sorted((k for k in keys if _INDEX_KEY.fullmatch(k) and int(k) < 2 ** 32 - 1), key=int)
    order = first + [k for k in keys if k not in first]
    return "{" + ",".join(json.dumps(k, ensure_ascii=False) + ":" + js_json(v[k]) for k in order) + "}"


def rename_json(v: Any, rn: dict) -> str | None:
    """cpRenameJson_: a JSON answers cell whose client fields name this client, renamed; None otherwise."""
    s = gsjs.trim(gsjs.or_blank(v))
    if s[:1] != "{":
        return None
    try:
        o = json.loads(s, parse_constant=_no_constant)
    except ValueError:
        return None
    if not isinstance(o, dict):
        return None
    hit = False
    for k in list(o):
        if "client" not in k.lower() or not isinstance(o[k], str):
            continue
        n = rename_name(o[k], rn)
        if n is not None:
            o[k] = n
            hit = True
    return js_json(o) if hit else None


def scan(spec: dict, values: list[list[Any]], rn: dict) -> dict[str, Any]:
    """cpRenameScan_: { cells: [(row, col, before, after)] (0-based), rows, why }."""
    out: dict[str, Any] = {"cells": [], "rows": 0, "why": ""}
    if not values:
        return out
    at = 0
    if spec.get("must"):
        want = [fold(m) for m in spec["must"]]
        at = next((i for i, line in enumerate(values) if all(w in [fold(h) for h in line] for w in want)), -1)
        if at == -1:
            return out
    head = [fold(h) for h in values[at]]

    def pick(names: Any = (), test: Callable[[str], bool] | None = None) -> list[int]:
        return [c for c, h in enumerate(head) if h and (test(h) if test else any(
            w.search(h) if isinstance(w, re.Pattern) else fold(w) == h for w in names or ()))]

    def keyish(h: str) -> bool:
        return "client" in h and bool(re.search(r"(key|id)$", h))

    key_cols = pick(test=keyish) if spec.get("any") else pick(spec.get("key"))
    if spec.get("any"):
        name_cols = pick(test=lambda h: "client" in h and not keyish(h))
    elif spec.get("book_names"):
        name_cols = pick(test=lambda h: C.BOOK_FIELDS.get(h) == "name")
    else:
        name_cols = pick(spec.get("name"))
    list_cols, json_cols, last_cols, id_cols = (pick(spec.get(k)) for k in ("list", "json", "last", "ids"))
    if spec.get("one") and not name_cols:
        out["why"] = "it has no client column"
        return out
    if spec.get("heads"):
        for c, h in enumerate(values[at]):
            m = spec["heads"].search(gsjs.trim(gsjs.or_blank(h)))
            if m and name_key(m.group(1)) == rn["fold"]:
                out["cells"].append((at, c, h, gsjs.or_blank(h).replace(m.group(1), rn["new_name"], 1)))
    where = [(head.index(fold(c)) if fold(c) in head else -1, v) for c, v in (spec.get("where") or {}).items()]
    moves = rn["old_key"] != rn["new_key"]
    last_moves = rn["old_last"] != rn["new_last"].lower()
    prefixes = (("IS_" + rn["old_key"] + "_", "IS_" + rn["new_key"] + "_"),
                ("isp_" + rn["old_key"] + "_", "isp_" + rn["new_key"] + "_"),
                (rn["old_key"] + "|", rn["new_key"] + "|"))
    named = 0
    for r in range(at + 1, len(values)):
        line = values[r]
        cell = (lambda c: line[c] if c < len(line) else None)
        if any(w[0] == -1 or gsjs.js_str(cell(w[0])) != w[1] for w in where):
            continue
        put: dict[int, str] = {}
        keys = [gsjs.trim(gsjs.or_blank(cell(c))) for c in key_cols]
        if moves:
            for c, k in zip(key_cols, keys):
                if k == rn["old_key"]:
                    put[c] = rn["new_key"]
        mine = not key_cols or rn["old_key"] in keys or all(not k for k in keys)
        if mine:
            hit = False
            for cols, how in ((name_cols, rename_name), (list_cols, rename_list), (json_cols, rename_json)):
                for c in cols:
                    v = how(cell(c), rn)
                    if v is not None:
                        put[c] = v
                        hit = True
            if hit:
                named += 1
            if last_moves:
                for c in last_cols:
                    if gsjs.trim(gsjs.or_blank(cell(c))).lower() != rn["old_last"]:
                        continue
                    if rn["last_shared"]:
                        out["why"] = "it names clients by last name alone, and another client shares this one"
                    put[c] = rn["new_last"]
        if not put:
            continue
        if moves:
            for c in id_cols:
                v = gsjs.or_blank(cell(c))
                for old, new in prefixes:
                    if v.startswith(old):
                        put[c] = new + v[len(old):]
        changed = False
        for c in sorted(put):
            if put[c] == gsjs.or_blank(cell(c)):
                continue
            out["cells"].append((r, c, cell(c), put[c]))
            changed = True
        if changed:
            out["rows"] += 1
    if spec.get("one") and named > 1:
        out["why"] = "two rows carry this name"
    return out


# ---- where each tab is read, and how its cells are kept ---------------------------------------------------------

def _cell(v: Any) -> Any:
    return "" if v is None else v


def copy_values(reads: L.Reads, ref: hubdb.TabRef) -> tuple[list[list[Any]], list[tuple[int, dict]]]:
    """getDataRange().getValues() off the copy, the kept edits laid: the header, then each row in the header's order."""
    rows = reads.db.rows(ref)
    heads = list(ref.headers)
    return [heads] + [[_cell(raw.get(h)) for h in heads] for _rn, raw in rows], rows


def _rank(h: str) -> int:
    """How well a column names a row: its id, an id or number of record, its timestamp, any other, a symbol."""
    t = gsjs.trim(gsjs.js_str(h))
    if t.lower() == "id":
        return 0
    f = C.fold(t)
    if _KEYISH.search(f) or f in _ID_NUMBERS:
        return 1
    if f in _STAMPS:
        return 2
    return 3 if f else 4


def id_counts(ref: hubdb.TabRef, rows: list[tuple[int, dict]]) -> tuple[str | None, dict[str, int]]:
    """The tab's id column and how many rows carry each id."""
    idh = next((h for h in ref.headers if gsjs.trim(gsjs.js_str(h)) == "id"), None)
    counts: dict[str, int] = {}
    if idh is not None:
        for _rn, raw in rows:
            rid = gsjs.trim(gsjs.or_blank(raw.get(idh)))
            counts[rid] = counts.get(rid, 0) + 1
    return idh, counts


def row_match(ref: hubdb.TabRef, rows: list[tuple[int, dict]], at: int, changed: set[str],
              ids: tuple[str | None, dict[str, int]]) -> tuple[str, str] | None:
    """A key that names rows[at] alone and outlives the edit: its id; else the first id-like column, those columns
    with one other, any single column, or every column the edit leaves, that tells it apart."""
    raw = rows[at][1]
    stable = [h for h in ref.headers if gsjs.trim(gsjs.js_str(h)) and h not in changed and not C._marked(raw.get(h))]
    idh, counts = ids
    if idh is not None and idh in stable:
        rid = gsjs.trim(gsjs.or_blank(raw.get(idh)))
        if rid and counts.get(rid) == 1:
            return "id", rid
    ordered = sorted(stable, key=_rank)
    firm = [h for h in ordered if _rank(h) < 3]
    rest = [h for h in ordered if _rank(h) >= 3]
    sets = [[h] for h in firm] + [firm + [h] for h in rest if firm] + [[h] for h in rest] + [ordered]
    return W.row_key_of(rows, at, sets)


def copy_records(ref: hubdb.TabRef, rows: list[tuple[int, dict]], cells: list[tuple], subject: str) \
        -> tuple[list[dict], str]:
    """The scan's cells as app.edits keeps them, one record per row; or why they cannot be kept."""
    by_row: dict[int, dict[str, tuple[Any, Any]]] = {}
    for r, c, before, after in cells:
        if r == 0:
            return [], HEADER_CELL
        if C._marked(before) or C._marked(after):
            return [], WITHHELD
        by_row.setdefault(r - 1, {})[ref.headers[c]] = (before, after)
    out = []
    ids = id_counts(ref, rows)
    for i, put in by_row.items():
        got = row_match(ref, rows, i, set(put), ids)
        if got is None:
            return [], UNTOLD
        heads = {gsjs.trim(gsjs.js_str(h)): v for h, v in put.items()}
        out.append(W.kept_record(ref.sheet_id, ref.tab, "edit", got[0], got[1], subject,
                                 {h: a for h, (_b, a) in heads.items()}, {h: _cell(b) for h, (b, _a) in heads.items()}))
    return out, ""


def kept_values(reads: L.Reads, resource: str) -> tuple[list[str], list[tuple[str, dict]], list[list[Any]]]:
    """A resource Postgres keeps, as getValues would hand its sheet: its columns, its rows, the grid."""
    cols = RR.columns(reads, resource)
    table = RR.table_rows(reads, resource)
    return cols, table, [list(cols)] + [[_cell(cells.get(h)) for h in cols] for _k, cells in table]


def kept_items(cols: list[str], table: list[tuple[str, dict]], cells: list[tuple]) \
        -> tuple[list[tuple[str, dict, dict]], str]:
    """The scan's cells as RR.update_many takes them: (row key, its cells, the changed ones)."""
    by_row: dict[int, dict[str, Any]] = {}
    for r, c, before, after in cells:
        if r == 0:
            return [], HEADER_CELL
        if C._marked(before) or C._marked(after):
            return [], WITHHELD
        by_row.setdefault(r - 1, {})[cols[c]] = after
    return [(table[i][0], table[i][1], ch) for i, ch in by_row.items()], ""


def book_ref(reads: L.Reads, spec: dict) -> tuple[hubdb.TabRef | None, str]:
    """cpRenameBookSheet_ off the copy: the book tab a rename follows, or why it cannot be read."""
    ref, why, _sid, _tab = book_where(reads, spec)
    return ref, why


def book_where(reads: L.Reads, spec: dict) -> tuple[hubdb.TabRef | None, str, str, str]:
    """book_ref, with the book and tab it names (a book the copy does not hold is still named)."""
    tab = spec.get("tab")
    if spec.get("master"):
        sid, tab = C.client_db_id(reads), C.MASTER_TAB
    elif spec.get("estate"):
        prop, src_tab = ESTATE[spec["estate"]]
        sid, tab = gsjs.trim(reads.db.prop(prop)), tab or src_tab
    elif spec.get("fallback"):
        sid = reads.prop_book(spec["prop"], spec["fallback"])
    else:
        sid = gsjs.trim(reads.db.prop(spec["prop"]))
    if not sid:
        return None, "the book is not configured", "", tab
    if reads.db.book(sid) is None:
        return None, NO_COPY, sid, tab
    import house_tables as HT  # noqa: PLC0415 - a book kept in Postgres is read from its table
    ref = HT.book_tab(reads, sid, tab)
    reads.db.note_book(sid)
    return (ref, "", sid, tab) if ref is not None else (None, f"the book has no {tab} tab", sid, tab)


# ---- the rename ------------------------------------------------------------------------------------------------

def _last(n: Any) -> str:
    return gsjs.text(n).split(" ")[-1]


def plan(reads: L.Reads, ctx: dict, new_key: str, new_name: str) -> dict[str, Any]:
    """cpRenamePlan_: { edits (app.edits), kept ({resource: items}), ops (book_ops), moved: { book: rows },
    cannot: [book], notes }."""
    old_last = _last(ctx["name"]).lower()
    rn = {"old_key": ctx["key"], "new_key": new_key, "fold": name_key(ctx["name"]), "new_name": new_name,
          "old_last": old_last, "new_last": _last(new_name),
          "last_shared": any((gsjs.trim(gsjs.or_text(c.get("client_key"))) or name_key(c.get("name"))) != ctx["key"]
                             and _last(c.get("name")).lower() == old_last for c in ctx.get("all") or [])}
    out: dict[str, Any] = {"edits": [], "kept": {}, "ops": [], "moved": {}, "cannot": [], "notes": []}

    def on_sheet(sid: str, tab: str, spec: dict) -> None:
        named = {"hub": spec["tab"]} if "book" not in spec else {"book": spec["book"]}
        out["ops"].append({"op": "rename", "sheet_id": sid, "tab": tab, "spec": {**named, "rn": rn}})

    def take(label: str, spec: dict, values: list[list[Any]], keep: Callable[[list[tuple]], str]) -> int:
        res = scan(spec, values, rn)
        if res["why"]:
            out["cannot"].append(f"{label} ({res['why']})")
            return -1
        why = keep(res["cells"]) if res["cells"] else ""
        if why:
            out["cannot"].append(f"{label} ({why})")
            return -1
        if res["rows"]:
            out["moved"][label] = res["rows"]
        return res["rows"]

    def on_copy(ref: hubdb.TabRef, rows: list[tuple[int, dict]], spec: dict) -> Callable[[list[tuple]], str]:
        def keep(cells: list[tuple]) -> str:
            got, why = copy_records(ref, rows, cells, new_key)
            if why in ON_SHEET:
                on_sheet(ref.sheet_id, ref.tab, spec)
                return ""
            out["edits"].extend(got)
            return why
        return keep

    def on_kept(resource: str, cols: list[str], table: list[tuple[str, dict]]) -> Callable[[list[tuple]], str]:
        def keep(cells: list[tuple]) -> str:
            got, why = kept_items(cols, table, cells)
            out["kept"].setdefault(resource, []).extend(got)
            return why
        return keep

    for spec in HUB_TABS:
        label = "the " + spec["tab"] + " tab"
        resource = SR.TAB_OF.get(spec["tab"])
        if resource and RR.uploaded(reads.db, resource):
            cols, table, values = kept_values(reads, resource)
            take(label, spec, values, on_kept(resource, cols, table))
            continue
        res = reads.db.resolve(spec["tab"])
        if res.runtime:
            out["cannot"].append(f"{label} (it lives in the depot's facts)")
            continue
        if res.ref is None:
            if not res.book_known:
                out["cannot"].append(f"{label} (asa-hub-db holds no copy of its book)")
            continue
        values, rows = copy_values(reads, res.ref)
        take(label, spec, values, on_copy(res.ref, rows, spec))
    for spec in BOOKS:
        if DB.held(reads, spec.get("estate") or ""):
            # the Dr Appointments book Postgres keeps; Future Apts is its view of the visits, which carry the name
            if spec.get("tab") != DB.FUTURE_TAB:
                cols, table, values = kept_values(reads, spec["estate"])
                take(spec["book"], spec, values, on_kept(spec["estate"], cols, table))
            continue
        ref, why, sid, tab = book_where(reads, spec)
        if ref is None and why == NO_COPY:
            # what it holds is read on the sheet itself, as cpRenamePlan_ read it
            on_sheet(sid, tab, spec)
            continue
        if ref is None:
            out["cannot"].append(f"{spec['book']} ({why})")
            continue
        values, rows = copy_values(reads, ref)
        n = take(spec["book"], spec, values, on_copy(ref, rows, spec))
        if n == 0 and spec.get("master"):
            out["notes"].append("The Asa Client Database Master has no row for this client, so only the other books "
                                "carry the new name.")
    if new_key != ctx["key"]:
        res = reads.db.resolve(MED_PATIENTS_TAB)
        if res.ref is not None and scan({"key": ("client_key",)}, copy_values(reads, res.ref)[0], rn)["cells"]:
            out["cannot"].append("the pharmacy's patient match (House Supplies), which the relay keeps by the old key")
    return out


def rename(sess: L.Session, ctx: dict, name: str, new_key: str, refused: list[dict]) -> Decision:
    """clientProfileRename past its refusals: nothing when a book cannot follow, or while the client's last change is
    still on its way into the books; else every cell at once."""
    reads = sess.reads
    by = gsjs.str_((sess.user or {}).get("email"))
    if BO.settling(reads, ctx["key"]):
        return W.refuse(409, BO.SETTLING, data={"written": [], "refused": refused})
    got = plan(reads, ctx, new_key, name)
    if got["cannot"]:
        return W.refuse(409, "Nothing was renamed: the new name cannot be carried into " + "; ".join(got["cannot"])
                        + ".", fresh=True, data={"written": [], "refused": refused, "cannot_follow": got["cannot"]})
    for resource, items in got["kept"].items():
        RR.update_many(reads, resource, items, by)
    BO.queue(got["ops"], new_key, by, "clientProfileRename")
    answer = {"status": 200, "data": {"written": ["name"], "refused": refused, "client_key": new_key,
                                      "notes": got["notes"] + [ELSEWHERE], "moved": got["moved"]}}
    if got["edits"]:
        return W.final(answer, got["edits"], new_key)
    return Decision(answer, subject=new_key, own=bool(got["kept"] or got["ops"]))


# ---- the status --------------------------------------------------------------------------------------------------

def book_row_of(values: list[list[Any]], name: str) -> dict[str, Any]:
    """cpBookRowOf_: { at } (0-based), { absent } or { twin }, with the client columns."""
    head = [C.fold(h) for h in (values[0] if values else [])]
    names = [i for i, h in enumerate(head) if C.BOOK_FIELDS.get(h) == "name"]
    key = name_key(name)
    rows = []
    for r in range(1, len(values)):
        who = next((t for t in (gsjs.text(values[r][i]) for i in names) if t), "")
        if who and name_key(who) == key:
            rows.append(r)
    if not names or not rows:
        return {"absent": True, "names": names}
    return {"twin": True, "names": names} if len(rows) > 1 else {"at": rows[0], "names": names}


def _field_of(h: str) -> str:
    return C.BOOK_FIELDS.get(h) or ("#" + C.BOOK_MASKED[h] if h in C.BOOK_MASKED else "")


def book_move(reads: L.Reads, name: str, frm: str, to: str) -> dict[str, Any]:
    """cpBookMove_ as far as the copy decides it: { why }, { absent }, { done }, or { move } when the row must go from
    one tab to the other (book_ops moves it on the sheet, the masked cells with it)."""
    sid = C.client_db_id(reads)
    grids = []
    for tab in (frm, to):
        ref = reads.tab_of(sid, tab, "the Asa Client Database")
        if ref is None:
            return {"why": f"The Asa Client Database could not be written (the book has no {tab} tab)."}
        grids.append(copy_values(reads, ref)[0])
    got = BO.move_plan(grids[0], grids[1], name, frm, to)
    if "at" not in got:
        return got
    return {"move": True}


def hub_row(reads: L.Reads, ctx: dict, status: str) -> tuple[dict | None, Decision | None]:
    """cpStatusHubRow_ kept in app.edits: the client's Hub row takes `status` (made when there is none)."""
    hub = C._hub(reads, "clients")
    target = next((r for r in hub
                   if (gsjs.trim(gsjs.or_text(r.get("client_key"))) or name_key(r.get("name"))) == ctx["key"]), None)
    sid, tab = W.where_of(W.tab_of(reads, "clients"))
    now = W.now_iso(reads)
    if target is None:
        rec = {"id": "CLI_" + ctx["key"], "client_key": ctx["key"], "name": ctx["name"], "status": status,
               "createdAt": now, "updatedAt": now}
        return W.kept_record(sid, tab, "append", "id", rec["id"], ctx["key"], rec), None
    if target.get("id") is None or target.get("id") == "":
        return None, W.refuse(400, 'Missing required "id" in payload.', fresh=True)
    tid = gsjs.js_str(target.get("id"))
    if sum(1 for r in hub if gsjs.js_str(r.get("id")) == tid) > 1:
        return None, W.refuse(409, "Two rows of the Hub clients tab carry this client's id, so neither was written — "
                                   "reload the client.", fresh=True)
    return W.kept_record(sid, tab, "edit", "id", tid, ctx["key"], {"status": status, "updatedAt": now},
                         {"status": gsjs.or_blank(target.get("status"))}), None


def status(sess: L.Session, ctx: dict, want: str, refused: list[dict]) -> Decision:
    """clientProfileStatus past its refusals: the book row moved by book_ops (a move the other way still waiting is
    called off instead), the Hub row kept in app.edits."""
    reads = sess.reads
    frm, to = (C.MASTER_TAB, C.ARCHIVE_TAB) if want == "Inactive" else (C.ARCHIVE_TAB, C.MASTER_TAB)
    sid = C.client_db_id(reads)

    def back(op: str, spec: dict, state: str) -> bool:
        return op == "move" and state == "pending" and spec.get("to") == frm

    if BO.settling(reads, ctx["key"], but=back):
        return W.refuse(409, BO.SETTLING)
    called = BO.cancel_move(ctx["key"], sid, frm, to)
    if called == "busy":
        return W.refuse(409, BO.SETTLING)
    # the row never left the tab it is now wanted in
    move = {"done": True} if called else book_move(reads, ctx["name"], frm, to)
    if move.get("why"):
        return W.refuse(409, move["why"], fresh=True)
    notes = ["Neither the Master nor the archive of old clients holds a row for this client; only the Hub record "
             "moved."] if move.get("absent") else []
    rec, shut = hub_row(reads, ctx, "active" if want == "Active" else "inactive")
    if shut is not None:
        return shut
    if move.get("move"):
        BO.queue([{"op": "move", "sheet_id": sid, "tab": frm, "spec": {"to": to, "name": ctx["name"]}}], ctx["key"],
                 gsjs.str_((sess.user or {}).get("email")), "clientProfileStatus")
    answer = {"status": 200, "data": {"written": ["status"], "refused": refused, "client_key": ctx["key"],
                                      "notes": notes}}
    return W.final(answer, [rec], ctx["key"])
