"""Production Actions on Python: the go-live runbook (ProductionActions.gs). Its actions and its history live in
Postgres (app.resource_rows `productionActions` and `productionActionRuns`, uploaded from the two houses as the app is
given to Python), and every automatic banner is planned, run and undone on the server's own copy of its book — kept in
the project's documents folder, never written in Google:

    <root>/production-actions/<book id>.xlsx    the book as Google exported it, the banners laid on it here
    <root>/production-actions/<book id>.json    its tabs as the Sheets API named them (the tab ids and grids the
                                                export does not carry), and when it was brought

productionActionBooksFetch (the relay's own, after the upload) brings each banner's book that is not on the server yet.
A form is closed in Google Forms, which nothing here opens: a form_close action is refused at its preview. The doors
answer only the real master, everyone else as an unknown action."""
from __future__ import annotations

import hashlib
import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

import gsjs
import hubdb
import location_docs as LD
import locations as L
import resource_rows as RR
import scope as sc
import smart_comms_desk as SCD
from scope import Defer

APP_ID = "production-actions"
DEFS_RES, RUNS_RES = "productionActions", "productionActionRuns"
ACTIONS_TAB, RUNS_TAB = "production_actions", "production_action_runs"
APP_DIR = "production-actions"
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
BOOK_MAX_BYTES = 40 * 1024 * 1024
ACTIONS_HEADER = ["id", "createdAt", "updatedAt", "updated_by", "number", "phase", "title", "system", "kind", "handler",
                  "params", "how", "link", "requires", "effect", "enabled"]
RUNS_HEADER = ["id", "createdAt", "updatedAt", "action_id", "number", "title", "act", "result", "expect", "test_mode",
               "dial", "by_email", "by_name", "client_id", "def_sha", "preview_sha", "target", "detail", "before",
               "after", "undoes", "mock_row_id", "tenant"]
EDITABLE = ["number", "phase", "title", "system", "kind", "handler", "params", "how", "link", "requires", "effect",
            "enabled"]
PHASES = ["before", "at", "after"]
KINDS = ["automatic", "manual"]
HANDLER_IDS = ["banner", "link", "form_close"]
PREVIEW_MAX = 12
RUNS_CAP = 500
FORM_OWN = "That form, or the book its answers land in, is one of the platform's own — close an outside form only."
FORM_OFF_SERVER = ("A form is closed in Google Forms, and the runbook no longer opens Google — close it there by hand "
                   "and mark the action done.")
DRIVE_ID = re.compile(r"^[A-Za-z0-9_-]{20,80}$")
HEX = re.compile(r"^#[0-9A-Fa-f]{6}$")
COLOUR_WORDS = {"#8B0000": "blood red", "#FFFFFF": "white", "#000000": "black"}
_DIGITS = re.compile(r"(\d+)")

s_ = gsjs.str_


def denied(name: str) -> dict[str, Any]:
    return {"status": 404, "message": 'Unknown action: "' + name + '".'}


def gate(user: dict | None, name: str) -> dict[str, Any] | None:
    """paGate_: the real master at home, everyone else an unknown action."""
    return None if sc.is_real_master(user) else denied(name)


def now_iso() -> str:
    now = datetime.now(timezone.utc)
    return now.strftime("%Y-%m-%dT%H:%M:%S.") + f"{now.microsecond // 1000:03d}Z"


def err(exc: BaseException) -> str:
    return (str(exc) or type(exc).__name__)[:200]


def enabled_word(v: Any) -> str:
    return "no" if s_(v).lower() in ("no", "false", "0", "off") else "yes"


def sha16(text: str) -> str:
    return hashlib.sha256(str(text).encode("utf-8")).hexdigest()[:16]


def def_sha(d: dict) -> str:
    return sha16("\n".join([s_(d.get("id")), s_(d.get("kind")), s_(d.get("handler")), s_(d.get("phase")),
                            enabled_word(d.get("enabled")), s_(d.get("params"))]))


def params_of(d: dict) -> tuple[dict | None, str]:
    raw = s_(d.get("params"))
    if not raw:
        return {}, ""
    try:
        v = json.loads(raw)
    except ValueError:
        return None, "The params are not valid JSON."
    if not isinstance(v, dict):
        return None, "The params are not a JSON object."
    return v, ""


def col_num(letters: str) -> int:
    n = 0
    for ch in letters:
        n = n * 26 + (ord(ch) - 64)
    return n


def col_name(n: int) -> str:
    out = ""
    while n > 0:
        m = (n - 1) % 26
        out = chr(65 + m) + out
        n = (n - 1) // 26
    return out


def a1_of(a1: Any) -> dict[str, int] | None:
    m = re.match(r"^([A-Z]{1,3})(\d{1,7})(?::([A-Z]{1,3})(\d{1,7}))?$", s_(a1).upper())
    if not m:
        return None
    out = {"col": col_num(m.group(1)), "row": int(m.group(2))}
    out["col2"] = col_num(m.group(3)) if m.group(3) else out["col"]
    out["row2"] = int(m.group(4)) if m.group(4) else out["row"]
    if out["row"] < 1 or out["col"] < 1 or out["col2"] < out["col"] or out["row2"] < out["row"]:
        return None
    return out


def a1_text(row: int, col: int, col2: int) -> str:
    return col_name(col) + str(row) + (":" + col_name(col2) + str(row) if col2 > col else "")


def url_in(text: str) -> str:
    m = re.search(r"https?://\S+", text or "")
    return m.group(0) if m else ""


def form_id(v: Any) -> dict[str, Any]:
    s = s_(v)
    if not s:
        return {"id": "", "published": False}
    m = re.search(r"/forms/d/(e/)?([A-Za-z0-9_-]{20,})", s)
    if m:
        return {"id": "", "published": True} if m.group(1) else {"id": m.group(2), "published": False}
    if s.startswith("1FAIpQL"):
        return {"id": "", "published": True}
    return {"id": s, "published": False} if DRIVE_ID.match(s) else {"id": "", "published": False}


def _digits(v: Any) -> bool:
    return bool(re.match(r"^\d{1,12}$", s_(v)))


def handler_problems(handler: str, p: dict) -> list[dict[str, str]]:
    """paHandlerProblems_."""
    out: list[dict[str, str]] = []

    def say(field: str, words: str) -> None:
        out.append({"field": "params." + field, "words": words})

    if handler == "banner":
        if not DRIVE_ID.match(s_(p.get("book"))):
            say("book", "The book is a Drive id.")
        if not _digits(p.get("gid")):
            say("gid", "The tab id (gid) is a whole number.")
        r = a1_of(p.get("range"))
        if not r:
            say("range", "The cells are one A1 range, like G1:N1.")
        elif r["row"] != r["row2"]:
            say("range", "The cells are one row.")
        text = s_(p.get("text"))
        if len(text) < 3 or len(text) > 500:
            say("text", "The text is 3–500 characters.")
        for k in ("background", "color", "tab_color"):
            if s_(p.get(k)) and not HEX.match(s_(p.get(k))):
                say(k, "A colour is #RRGGBB.")
        if "bold" in p and p["bold"] is not None and not isinstance(p["bold"], bool):
            say("bold", "Bold is true or false.")
    elif handler == "link":
        if not re.match(r"^https://\S+$", s_(p.get("url"))):
            say("url", "The link is https://…")
    elif handler == "form_close":
        has_form, has_tab = bool(s_(p.get("form"))), bool(s_(p.get("book"))) or bool(s_(p.get("gid")))
        if has_form == has_tab:
            say("form", "Name the form (its edit id or edit link), or the book and tab id its answers land on — one of "
                        "the two.")
        if has_form:
            f = form_id(p.get("form"))
            if f["published"]:
                say("form", "That is the published id (/e/…) — a form opens by its edit id.")
            elif not f["id"]:
                say("form", "The form is its edit id or its edit link.")
        if has_tab:
            if not DRIVE_ID.match(s_(p.get("book"))):
                say("book", "The book is a Drive id.")
            if not _digits(p.get("gid")):
                say("gid", "The tab id (gid) is a whole number.")
        msg = s_(p.get("message"))
        if len(msg) < 3 or len(msg) > 500:
            say("message", "The closed message is 3–500 characters.")
    return out


def validate(d: dict) -> list[dict[str, str]]:
    """paValidate_."""
    problems: list[dict[str, str]] = []

    def say(field: str, words: str) -> None:
        problems.append({"field": field, "words": words})

    if not re.match(r"^[a-z0-9_]{2,40}$", s_(d.get("id"))):
        say("id", "The id is 2–40 lowercase letters, digits or _.")
    number = s_(d.get("number"))
    if not number or len(number) > 6:
        say("number", "The number is 1–6 characters.")
    if s_(d.get("phase")) not in PHASES:
        say("phase", "The phase is before, at or after.")
    title = s_(d.get("title"))
    if len(title) < 3 or len(title) > 120:
        say("title", "The title is 3–120 characters.")
    kind, handler = s_(d.get("kind")), s_(d.get("handler"))
    if kind not in KINDS:
        say("kind", "The kind is automatic or manual.")
    elif kind == "automatic" and handler not in HANDLER_IDS:
        say("handler", "An automatic action needs a handler: " + ", ".join(HANDLER_IDS) + ".")
    elif kind == "manual" and handler:
        say("handler", "A manual action has no handler — make it automatic to use one.")
    link = s_(d.get("link"))
    if link and not re.match(r"^https://\S+$", link) and not re.match(r"^/apps?(/\S*)?$", link):
        say("link", "The link is https://… or an in-app /app/… path.")
    if kind == "automatic" and handler in HANDLER_IDS:
        p, why = params_of(d)
        if p is None:
            say("params", why)
        else:
            problems += handler_problems(handler, p)
    return problems


def def_out(d: dict) -> dict[str, Any]:
    """paDefOut_ (the relay's action_out)."""
    out: dict[str, Any] = {h: s_(d.get(h)) for h in ACTIONS_HEADER}
    p, why = params_of(d)
    out["params_obj"] = p
    if why:
        out["params_error"] = why
    out["def_sha"] = def_sha(d)
    return out


def run_out(r: dict) -> dict[str, Any]:
    """paRunOut_."""
    out: dict[str, Any] = {}
    for h in RUNS_HEADER:
        if h in ("before", "after"):
            continue
        v = r.get(h)
        out[h] = json.dumps(v, separators=(",", ":")) if isinstance(v, (dict, list)) else s_(v)
    b = r.get("before")
    kept = (len(b) > 0) if isinstance(b, dict) else bool(s_(b))
    out["has_undo"] = s_(r.get("act")) == "run" and s_(r.get("result")) == "ok" and kept
    return out


def jsonish(v: Any) -> dict:
    """paJson_."""
    if isinstance(v, dict):
        return v
    try:
        got = json.loads(s_(v) or "{}")
    except ValueError:
        return {}
    return got if isinstance(got, dict) else {}


# ---- the two houses in Postgres -----------------------------------------------------------------------------------

def cell_text(v: Any) -> str:
    """paCellText_: a Date as the text it means, anything else its trimmed text — JSON kept as the text it is."""
    typed = hubdb.typed(v, "hub")
    t = hubdb.cell_text(typed)
    return gsjs.trim(gsjs.js_str(typed)) if isinstance(t, (dict, list)) else s_(t)


def house_rows(reads: L.Reads, resource: str) -> list[dict]:
    """paRows_: every row with an id, header-keyed, each with its place (_row)."""
    cols = RR.columns(reads, resource)
    out = []
    for i, (_k, cells) in enumerate(RR.table_rows(reads, resource)):
        r = {h: cell_text(cells.get(h)) for h in cols if h}
        if r.get("id"):
            out.append({**r, "_row": i + 2})
    return out


def defs(reads: L.Reads) -> list[dict]:
    return house_rows(reads, DEFS_RES)


def runs(reads: L.Reads) -> list[dict]:
    """The history in the order its rows were written."""
    return house_rows(reads, RUNS_RES)


def def_find(ds: list[dict], did: Any) -> dict | None:
    return next((d for d in ds if s_(d.get("id")) == s_(did)), None)


def by_client(rs: list[dict], client_id: str) -> dict | None:
    return next((r for r in rs if s_(r.get("client_id")) == client_id), None)


def test_mode(reads: L.Reads) -> str:
    """paTestMode_: on, off, or unreadable (which rehearses)."""
    try:
        st = SCD.test_mode_state(reads.config())
    except Exception:  # noqa: BLE001 - an unread switch rehearses
        return "unreadable"
    if st.get("unrecognized"):
        return "unreadable"
    return "on" if st["on"] else "off"


def dial_word(reads: L.Reads) -> str:
    """paDialWord_."""
    try:
        d = SCD.dial(reads.config())
    except Exception:  # noqa: BLE001
        return "unreadable"
    return "unreadable" if not d.get("readable") else s_(d.get("word"))


def platform_books(reads: L.Reads) -> dict[str, Any]:
    """paPlatformBooks_: the platform's own books (FAIL-CLOSED: unlisted, no outside book is written)."""
    ids: dict[str, str] = {}
    db = reads.db

    def add(v: Any, why: str) -> None:
        if s_(v):
            ids[s_(v)] = why

    core = s_(db.prop("HUB_DB_ID"))
    if not core:
        return {"ids": ids, "error": "the core book id could not be read"}
    add(core, "the core workbook")
    add(db.prop("HUB_APPS_RUNTIME_ID"), "the Essencial")
    add(db.prop("HUB_HIRING_RUNTIME_ID"), "the hiring runtime")
    facts = db.facts()
    props = ((facts.get("areas") or {}).get("props") or {}) if isinstance(facts, dict) else {}
    if not props:
        return {"ids": ids, "error": "the switchboard props could not be read"}
    for k, v in props.items():
        add(v, "switchboard:props." + str(k))
    for k, v in ((facts.get("subjects") or {}) if isinstance(facts, dict) else {}).items():
        if str(k).endswith("_ID"):
            add(v, "Script Property " + str(k))
    return {"ids": ids, "error": ""}


# ---- the books on the server ----------------------------------------------------------------------------------------

def books_dir() -> Path:
    return LD.ROOT / APP_DIR


def book_paths(book: str) -> tuple[Path, Path]:
    return books_dir() / f"{book}.xlsx", books_dir() / f"{book}.json"


def book_side(book: str) -> dict | None:
    _x, side = book_paths(book)
    try:
        got = json.loads(side.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return got if isinstance(got, dict) else None


def _hex(color: Any, fallback: str) -> str:
    rgb = getattr(color, "rgb", None) if color is not None else None
    if isinstance(rgb, str) and re.match(r"^[0-9A-Fa-f]{6,8}$", rgb):
        return "#" + rgb[-6:].upper()
    return fallback


def fill_of(cell: Any) -> str:
    f = cell.fill
    if f is None or not getattr(f, "fill_type", None):
        return "#FFFFFF"
    return _hex(f.fgColor, "")


def font_color_of(cell: Any) -> str:
    return _hex(cell.font.color if cell.font is not None else None, "#000000")


def weight_of(cell: Any) -> str:
    return "bold" if (cell.font is not None and cell.font.b) else "normal"


def tab_color_of(ws: Any) -> str:
    return _hex(ws.sheet_properties.tabColor, "")


def last_row(ws: Any) -> int:
    last = 0
    for i, line in enumerate(ws.iter_rows(values_only=True), start=1):
        if any(v not in (None, "") for v in line):
            last = i
    return last


def last_col(ws: Any) -> int:
    last = 0
    for line in ws.iter_rows(values_only=True):
        for j in range(len(line) - 1, -1, -1):
            if line[j] not in (None, ""):
                last = max(last, j + 1)
                break
    return last


def xl_text(v: Any) -> str:
    """A cell of the server's copy as its text (getValues, trimmed)."""
    return s_(v)


def colour_word(h: str) -> str:
    u = s_(h).upper()
    return COLOUR_WORDS.get(u, u.lower())


def plan_base(handler: str) -> dict[str, Any]:
    return {"handler": handler, "ok": False, "state": "", "target": "", "words": [], "untouched": [],
            "invariants": [], "problems": [], "key": []}


def open_book(book: str) -> tuple[Any, dict]:
    """The server's copy of a book and its tabs; Defer-free: a missing copy is the plan's problem to say."""
    from openpyxl import load_workbook  # noqa: PLC0415 - loaded only where a book is opened
    path, _side = book_paths(book)
    side = book_side(book)
    if side is None or not path.is_file():
        raise FileNotFoundError("the book is not on the server yet — it is brought when the runbook is given to "
                                "Python")
    return load_workbook(path), side


def tab_of(wb: Any, side: dict, gid: int) -> tuple[Any, dict] | None:
    t = (side.get("tabs") or {}).get(str(gid))
    if not isinstance(t, dict) or t.get("title") not in wb.sheetnames:
        return None
    return wb[t["title"]], t


def banner_plan(reads: L.Reads, p: dict) -> dict[str, Any]:
    """paBannerPlan_ on the server's copy of the book."""
    plan = plan_base("banner")

    def check(cid: str, ok: bool, words: str) -> bool:
        plan["invariants"].append({"id": cid, "ok": bool(ok), "words": words})
        if not ok:
            plan["problems"].append(words)
        return bool(ok)

    book, gid, a1, text = s_(p.get("book")), int(s_(p.get("gid")) or 0), a1_of(p.get("range")), s_(p.get("text"))
    own = platform_books(reads)
    if own["error"]:
        check("B1", False, "The platform's own books could not be listed (" + own["error"] + "), so no book is written.")
        return plan
    if not check("B1", book not in own["ids"], "That is one of the platform's own books — a banner is for an outside "
                 "book." if book in own["ids"] else "An outside book, not one of the platform's own."):
        return plan
    try:
        wb, side = open_book(book)
    except Exception as exc:  # noqa: BLE001 - said as the plan's own problem
        plan["problems"].append("The book could not be opened (" + err(exc) + ").")
        return plan
    found = tab_of(wb, side, gid)
    if not check("B2", found is not None, f"Tab found by its id {gid}." if found else f"No tab with id {gid} in this "
                 "book."):
        return plan
    ws, tab = found
    if not a1 or a1["row"] != a1["row2"]:
        plan["problems"].append("The cells are not one row.")
        return plan
    grid = tab.get("grid") or {}
    frozen = int(grid.get("frozenRowCount") or 0)
    band = max(1, frozen)
    check("B3", a1["row"] <= band, f"Row {a1['row']} is in the frozen header band." if a1["row"] <= band else
          f"Row {a1['row']} is below the frozen header band — appended rows would meet it.")
    last = last_row(ws)
    width = last_col(ws)
    head = [ws.cell(row=a1["row"], column=c).value for c in range(1, width + 1)] if width else []
    header_end = 0
    for c, v in enumerate(head):
        cell = xl_text(v)
        if not cell:
            continue
        if c + 1 == a1["col"] and cell == text:
            continue
        header_end = c + 1
    span = "A–" + col_name(header_end) if header_end else ""
    check("B4", a1["col"] > header_end, f"Column {col_name(a1['col'])} is right of the header"
          + (f" ({span})." if span else ".") if a1["col"] > header_end else
          f"Column {col_name(a1['col'])} is inside the header ({span}).")
    bg, fg = s_(p.get("background")) or "#8B0000", s_(p.get("color")) or "#FFFFFF"
    bold = p.get("bold") is not False
    tab_colour = "#8B0000" if "tab_color" not in p else s_(p.get("tab_color"))
    max_cols = int(grid.get("columnCount") or 0) or max(ws.max_column, width)
    col2 = min(a1["col2"], max_cols)
    fits = a1["col"] <= max_cols
    clipped = a1_text(a1["row"], a1["col"], col2) if fits else ""
    if fits:
        cells = [ws.cell(row=a1["row"], column=c) for c in range(a1["col"], col2 + 1)]
        vals = [xl_text(c.value) for c in cells]
        empty = all(not v for v in vals)
        worded = vals[0] == text and all(not v for v in vals[1:])
        dressed = worded and all(fill_of(c).upper() == bg.upper() for c in cells) and \
            all(font_color_of(c).upper() == fg.upper() for c in cells) and \
            all(weight_of(c) == ("bold" if bold else "normal") for c in cells) and \
            (not tab_colour or tab_color_of(ws).upper() == tab_colour.upper())
        plan["state"] = "empty" if empty else ("already" if dressed else "partial") if worded else "blocked"
        busy = next((i for i, v in enumerate(vals) if v and not (i == 0 and worded)), -1)
        check("B5", empty or worded, f"Every cell of {clipped} is empty." if empty else
              f"{clipped} already holds exactly this banner — a run changes nothing." if dressed else
              f"{clipped} holds this banner's text but not all its colours — a run applies them." if worded else
              f"{col_name(a1['col'] + busy)}{a1['row']} is not empty ('{vals[busy][:40]}').")
        merged = [m for m in ws.merged_cells.ranges if m.min_row <= a1["row"] <= m.max_row
                  and not (m.max_col < a1["col"] or m.min_col > col2)]
        check("B6", not merged, f"{clipped} crosses a merged range." if merged else
              f"No merged range touches {clipped}.")
    check("B7", a1["row"] <= last, f"Row {a1['row']} is above the last row ({last}), so the last row cannot move."
          if a1["row"] <= last else f"The tab is empty, so row {a1['row']} would become its last row.")
    check("B8", fits, (f"The grid ends at {col_name(max_cols)}, so the cells are {clipped}." if col2 < a1["col2"] else
                       f"The cells {clipped} are inside the grid.") if fits else "No free column right of the header.")
    path, _side = book_paths(book)
    writable = os.access(path, os.W_OK)
    check("B9", writable, "The server's copy of this book can be written." if writable else
          "The server's copy of this book cannot be written just now.")
    plan["invariants"].sort(key=lambda x: x["id"])
    url = url_in(text)
    tab_name, book_name = s_(ws.title), s_(side.get("name"))
    first = col_name(a1["col"]) + str(a1["row"])
    plan["target"] = f"{book_name} › {tab_name} › {clipped or s_(p.get('range'))}"
    plan["words"].append(
        f"{book_name} › {tab_name} (tab id {gid}) · cells {clipped or s_(p.get('range'))} — row {a1['row']}"
        + (", the frozen header row" if a1["row"] <= frozen else "") + f" · text in {first}"
        + (" · link on the address" if url else "") + f" · {colour_word(bg)}, {colour_word(fg)}"
        + (" bold" if bold else "") + (f" · tab colour {colour_word(tab_colour)}" if tab_colour else "")
        + " · on the server's copy of the book.")
    note, script = s_(p.get("note")), s_(p.get("script"))
    plan["untouched"].append(
        "Untouched: " + (f"columns {span}" + (f" ({note})" if note else "") if header_end else
                         f"every column left of {col_name(a1['col'])}")
        + f" and every row below {a1['row']}. The last row stays {last}, so "
        + ("the script's last-row read still finds the newest submission" if script else
           "a last-row read still finds the newest row")
        + f", and the next appended row lands on row {last + 1}.")
    plan["untouched"].append("The Google book itself is not opened: the banner is laid on the server's copy.")
    plan["key"] = [book, gid, clipped, plan["state"], header_end]
    plan["ok"] = not plan["problems"]
    plan["_h"] = {"book": book, "gid": gid, "a1": clipped, "text": text, "url": url, "background": bg,
                  "color": fg, "bold": bold, "tab_color": tab_colour, "last": last}
    return plan


def link_plan(p: dict) -> dict[str, Any]:
    """paLinkPlan_."""
    plan = plan_base("link")
    url = s_(p.get("url"))
    ok = bool(re.match(r"^https://\S+$", url))
    plan["invariants"].append({"id": "L1", "ok": ok, "words": "The link is https." if ok else "The link is not https."})
    if not ok:
        plan["problems"].append("The link is not https.")
    plan.update(state="open", target=url, key=[url], ok=ok, _h={"url": url})
    plan["words"].append(f"Opens {url} in a new tab.")
    plan["untouched"].append("Nothing is written anywhere.")
    return plan


def form_plan(reads: L.Reads, p: dict) -> dict[str, Any]:
    """paFormPlan_: the platform's own books still refused first; any other form is Google's to close."""
    plan = plan_base("form_close")
    own = platform_books(reads)
    if own["error"]:
        plan["invariants"].append({"id": "F2", "ok": False, "words": "The platform's own books could not be listed ("
                                   + own["error"] + "), so no form is closed."})
        plan["problems"].append(plan["invariants"][-1]["words"])
        return plan
    if s_(p.get("book")) and s_(p.get("book")) in own["ids"]:
        plan["invariants"].append({"id": "F2", "ok": False, "words": FORM_OWN})
        plan["problems"].append(FORM_OWN)
        return plan
    plan["invariants"].append({"id": "F1", "ok": False, "words": FORM_OFF_SERVER})
    plan["problems"].append(FORM_OFF_SERVER)
    return plan


def plan_for(reads: L.Reads, d: dict) -> dict[str, Any]:
    """paPlanFor_."""
    problems = validate(d)
    if problems:
        bad = plan_base(s_(d.get("handler")))
        bad["problems"] = [x["words"] for x in problems]
        return bad
    p, _why = params_of(d)
    handler = s_(d.get("handler"))
    plan = banner_plan(reads, p or {}) if handler == "banner" else link_plan(p or {}) if handler == "link" else \
        form_plan(reads, p or {})
    plan["def_sha"] = def_sha(d)
    plan["preview_sha"] = sha16("|".join([plan["def_sha"]] + [str(k) for k in plan["key"]]))
    return plan


def rehearse_text(plan: dict) -> str:
    return "\n".join(plan["words"] + plan["untouched"])


def preview_out(d: dict, plan: dict | None, mode: str) -> dict[str, Any]:
    """paPreviewOut_."""
    out: dict[str, Any] = {"action_id": s_(d.get("id")), "number": s_(d.get("number")), "title": s_(d.get("title")),
                           "kind": s_(d.get("kind")), "handler": s_(d.get("handler")), "def_sha": def_sha(d),
                           "test_mode": mode, "mode": "real" if mode == "off" else "rehearse"}
    if s_(d.get("kind")) != "automatic":
        out.update(how=s_(d.get("how")), link=s_(d.get("link")), requires=s_(d.get("requires")), problems=[])
        return out
    for k in ("preview_sha", "state", "target", "words", "untouched", "invariants", "problems"):
        out[k] = (plan or {}).get(k, "")
    out["ok"] = bool((plan or {}).get("ok"))
    return out


# ---- the doors ------------------------------------------------------------------------------------------------------

def preview(sess: L.Session, payload: dict) -> dict[str, Any]:
    """productionActionPreview: what each action would write, where, and every check — read-only."""
    no = gate(sess.user, "productionActionPreview")
    if no:
        return no
    reads = sess.reads
    ids = (payload or {}).get("action_ids") or []
    if not isinstance(ids, list) or not ids or len(ids) > PREVIEW_MAX:
        return {"status": 400, "message": f"Preview 1–{PREVIEW_MAX} actions at a time."}
    ds = defs(reads)
    mode = test_mode(reads)
    items: dict[str, Any] = {}
    for raw in ids:
        did = s_(raw)
        d = def_find(ds, did)
        if d is None:
            items[did] = {"action_id": did, "problems": [f'No action "{did}".']}
            continue
        plan = None
        if s_(d.get("kind")) == "automatic":
            try:
                plan = plan_for(reads, d)
            except Defer:
                raise
            except Exception as exc:  # noqa: BLE001 - said on the item
                plan = plan_base(s_(d.get("handler")))
                plan["problems"] = ["The preview failed (" + err(exc) + ")."]
        items[did] = preview_out(d, plan, mode)
    return {"status": 200, "data": {"test_mode": mode, "mode": "real" if mode == "off" else "rehearse",
                                    "items": items}}


def natural_key(number: Any) -> list[Any]:
    parts = _DIGITS.split(s_(number).lower())
    return [(0, int(x), "") if x.isdigit() else (1, 0, x) for x in parts if x != ""]


def view(sess: L.Session, payload: dict) -> dict[str, Any]:
    """productionActionsView: both houses out of Postgres, for the relay's /hub-lanes/production-actions."""
    no = gate(sess.user, "productionActionsView")
    if no:
        return no
    reads = sess.reads
    ds, rs = defs(reads), runs(reads)
    stamp = now_iso()

    def house(key: str, label: str, tab: str, n: int) -> dict[str, Any]:
        return {"key": key, "label": label, "book": "Postgres", "tab": tab, "rows": n, "read_at": stamp,
                "state": "fresh", "why": ""}

    actions = [def_out(d) for d in ds]
    actions.sort(key=lambda a: (PHASES.index(a["phase"]) if a["phase"] in PHASES else len(PHASES),
                                natural_key(a["number"]), a["id"]))
    keyed = sorted(rs, key=lambda r: (s_(r.get("createdAt")), int(r.get("_row") or 0)), reverse=True)
    return {"status": 200, "data": {
        "house": {"actions": house("actions", "Runbook", ACTIONS_TAB, len(ds)),
                  "runs": house("runs", "Runbook history", RUNS_TAB, len(rs))},
        "as_of": stamp, "actions": actions, "runs": [run_out(r) for r in keyed[:RUNS_CAP]], "runs_total": len(keyed)}}


def books_fetch(sess: L.Session, payload: dict) -> dict[str, Any]:
    """productionActionBooksFetch (the relay's own): every banner's book that is not on the server yet brought —
    its Office export, and its tabs as the Sheets API names them."""
    if (sess.user or {}).get("is_service") is not True:
        return {"status": 403, "message": "This is the relay's own read."}
    reads = sess.reads
    wanted: list[str] = []
    for d in defs(reads):
        if s_(d.get("kind")) == "automatic" and s_(d.get("handler")) == "banner":
            p, _why = params_of(d)
            book = s_((p or {}).get("book"))
            if DRIVE_ID.match(book) and book not in wanted:
                wanted.append(book)
    drv = reads.need_drive()
    out = {"wanted": len(wanted), "brought": [], "kept": 0, "left": []}
    for book in wanted:
        path, side = book_paths(book)
        if path.is_file() and book_side(book) is not None:
            out["kept"] += 1
            continue
        try:
            meta = drv.file_meta(book, "id,name,mimeType,modifiedTime")
            data = drv.export(book, XLSX, BOOK_MAX_BYTES)
            if len(data) > BOOK_MAX_BYTES:
                raise ValueError("the export is past the size limit")
            tabs = drv.sheet_tabs(book)
        except Exception as exc:  # noqa: BLE001 - one book Google will not hand over leaves the others
            out["left"].append(f"{book[:12]}… ({type(exc).__name__})")
            continue
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_name(path.name + ".part")
        tmp.write_bytes(data)
        os.replace(tmp, path)
        doc = {"book": book, "name": s_(meta.get("name")), "modified": s_(meta.get("modifiedTime")),
               "brought_at": now_iso(),
               "tabs": {str(t.get("sheetId")): {"title": str(t.get("title") or ""), "index": t.get("index"),
                                                "grid": t.get("gridProperties") or {}} for t in tabs}}
        stmp = side.with_name(side.name + ".part")
        stmp.write_text(json.dumps(doc, ensure_ascii=False, indent=1), encoding="utf-8")
        os.replace(stmp, side)
        out["brought"].append(s_(meta.get("name")))
    return {"status": 200, "data": out}


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {
    "productionActionPreview": preview, "productionActionsView": view, "productionActionBooksFetch": books_fetch}
POLICY: dict[str, dict[str, Any]] = {"productionActionPreview": {"roles": ("admin",), "params": {"action_ids": "array"}},
                                     "productionActionsView": {"roles": ("admin",)},
                                     "productionActionBooksFetch": {}}
