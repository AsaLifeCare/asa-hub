"""asa-hub-db's copy of the sheets for the relay's readers, where they read the old platform's mirror: asked of
asa-hub-app (app/hub_rows.py, the same reads in-process) — a tab's rows as every read shows them (its copy with
Python's kept edits laid), a book's word on how current its copy is, the books holding a tab, My World's owners and
the action log. A tab's answer is kept with its signature and asked again with it, so an unchanged tab crosses as one
word; one the copy cannot read raises Unreadable, never an empty answer."""
from __future__ import annotations

import json
import os
import threading
import time
import urllib.error
import urllib.request
from collections import OrderedDict
from pathlib import Path
from typing import Any, Callable

URL = (os.getenv("HUB_APP_URL") or "http://asa-hub-app:8080").rstrip("/")
DOOR = "/v1/hub-rows/"
TIMEOUT_S = float(os.getenv("HUB_ROWS_TIMEOUT_S") or 20)
# a tab asked again this soon is answered from what is held, unasked
FRESH_S = float(os.getenv("HUB_ROWS_FRESH_S") or 2)
HELD_MAX = 128
# mirror_first.VOUCH_MARGIN_S: a vouch reads the moment a book is current back out of the listing it is handed
VOUCH_MARGIN_S = 60.0
# a stand-in for the door (the checks): (action, payload) -> the answer's data
ask: Callable[[str, dict], dict] | None = None


class Unreadable(RuntimeError):
    """asa-hub-app could not say what the copy holds: not reached, refused, or the copy unread."""


def _token() -> str:
    """The relay's token for asa-hub-app: the env, else the private file beside the relay's code."""
    held = Path(__file__).with_name(".hub-app-token")
    return os.getenv("HUB_APP_TOKEN", "") or (held.read_text().strip() if held.is_file() else "")


def _post(action: str, payload: dict[str, Any]) -> dict[str, Any]:
    if ask is not None:
        return ask(action, payload)
    token = _token()
    if not token:
        raise Unreadable("the relay holds no token for asa-hub-app")
    req = urllib.request.Request(URL + DOOR + action, data=json.dumps({"payload": payload}).encode("utf-8"),
                                 method="POST", headers={"Content-Type": "application/json", "X-Hub-Token": token,
                                                         "X-Hub-User": json.dumps({"is_service": True})})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_S) as res:
            env = json.loads(res.read())
    except urllib.error.HTTPError as exc:
        try:
            why = str((json.loads(exc.read() or b"{}") or {}).get("defer") or "")
        except ValueError:
            why = ""
        raise Unreadable(f"asa-hub-app answered {exc.code}" + (f" ({why[:160]})" if why else "")) from exc
    except Exception as exc:  # noqa: BLE001 - not reached, said as unread
        raise Unreadable(f"asa-hub-app could not be asked ({type(exc).__name__})") from exc
    if not isinstance(env, dict) or env.get("status") != 200:
        raise Unreadable(f"asa-hub-app answered {env.get('status') if isinstance(env, dict) else '?'}"
                         f" ({str((env or {}).get('message') or '')[:160]})")
    return env.get("data") or {}


# ---- the tabs ------------------------------------------------------------------------------------------------------

_HELD: OrderedDict[str, dict[str, Any]] = OrderedDict()
_LOCK = threading.Lock()


def _key(a: dict[str, Any]) -> str:
    return json.dumps([a["sheet_id"], a["tab"], a.get("where") or None, a.get("fields") or None,
                       a.get("sizes") or None, a.get("count") or ""], sort_keys=True)


def _answer(g: dict[str, Any]) -> dict[str, Any]:
    return {"rows": [(int(rn), d if isinstance(d, dict) else {}) for rn, d in g.get("rows") or []],
            "counts": {str(k): int(v) for k, v in (g.get("counts") or {}).items()},
            "headers": [str(h) for h in g.get("headers") or []], "as_of": float(g.get("as_of") or 0.0),
            "tab_known": bool(g.get("tab_known")), "book_known": bool(g.get("book_known")),
            "book_status": str(g.get("book_status") or "")}


def tabs(asks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Each ask ({sheet_id, tab, where?, fields?, sizes?, count?}) answered: its rows [(sheet row, {header: text})] in
    sheet order (only the cells in `fields`; of each cell in `sizes`, its length) or its counts, its headers, the
    moment its book is known current (as_of, epoch seconds), whether the copy knows the tab and the book, and the
    book's word (book_status, "ok" for a copy that holds it)."""
    now = time.monotonic()
    out: list[dict[str, Any] | None] = [None] * len(asks)
    send: list[tuple[int, dict[str, Any], dict[str, Any] | None]] = []
    with _LOCK:
        for i, a in enumerate(asks):
            held = _HELD.get(_key(a))
            if held is not None and now - held["at"] < FRESH_S:
                out[i] = held["answer"]
            else:
                send.append((i, a, held))
    if send:
        got = _post("tabRows", {"asks": [{**a, "sig": held["sig"] if held else ""} for _i, a, held in send]})
        answers = got.get("answers") or []
        if len(answers) != len(send):
            raise Unreadable("asa-hub-app answered another number of tabs than were asked")
        for (i, a, held), g in zip(send, answers):
            g = g if isinstance(g, dict) else {}
            if g.get("unread"):
                raise Unreadable(f"{a['tab']}: {g['unread']}")
            if g.get("same") and held is not None:
                answer = {**held["answer"], "as_of": float(g.get("as_of") or 0.0),
                          "book_status": str(g.get("book_status") or "")}
            elif g.get("same"):
                raise Unreadable(f"{a['tab']}: asa-hub-app answered for rows the relay no longer holds")
            else:
                answer = _answer(g)
            with _LOCK:
                k = _key(a)
                _HELD[k] = {"sig": str(g.get("sig") or ""), "at": time.monotonic(), "answer": answer}
                _HELD.move_to_end(k)
                while len(_HELD) > HELD_MAX:
                    _HELD.popitem(last=False)
            out[i] = answer
    return [o or {} for o in out]


def read(sheet_id: str, tab: str, where: dict[str, Any] | None = None, *, fields: list[str] | None = None,
         sizes: list[str] | None = None) -> dict[str, Any]:
    ask_: dict[str, Any] = {"sheet_id": str(sheet_id), "tab": str(tab)}
    for k, v in (("where", where), ("fields", fields), ("sizes", sizes)):
        if v:
            ask_[k] = v
    return tabs([ask_])[0]


def numbered(sheet_id: str, tab: str, where: dict[str, Any] | None = None, *, fields: list[str] | None = None,
             sizes: list[str] | None = None) -> list[tuple[int, dict]]:
    """(sheet row, {header: text}) in sheet order, as every read shows the tab; with `where` ({header: value or
    [values]}), only the rows whose cells equal one of them."""
    return list(read(sheet_id, tab, where, fields=fields, sizes=sizes)["rows"])


def rows(sheet_id: str, tab: str, where: dict[str, Any] | None = None, *, fields: list[str] | None = None,
         sizes: list[str] | None = None) -> list[dict]:
    return [d for _rn, d in read(sheet_id, tab, where, fields=fields, sizes=sizes)["rows"]]


def counts(sheet_id: str, tab: str, column: str) -> dict[str, int]:
    """How many rows carry each non-blank text of one cell."""
    return dict(tabs([{"sheet_id": str(sheet_id), "tab": str(tab), "count": str(column)}])[0]["counts"])


# ---- the books, the log, the worlds ------------------------------------------------------------------------------

def books(sheet_ids: list[str]) -> dict[str, dict[str, Any]]:
    """Each book as asa_drive_sheets_meta spoke of it: known, name, status ("ok" for a copy that holds it),
    modified_time and synced_at (epoch seconds or None), as_of, stale (Drive changed it after the copy) and record."""
    got = _post("bookWords", {"sheet_ids": [str(s) for s in sheet_ids]}).get("books") or {}
    return {str(s): dict(got.get(str(s)) or {"known": False, "status": "", "as_of": 0.0, "stale": True})
            for s in sheet_ids}


def book(sheet_id: str) -> dict[str, Any]:
    return books([sheet_id])[str(sheet_id)]


def holders(tab: str) -> list[str]:
    """The books whose copy holds a tab of that name, the newest load first."""
    return [str(h.get("sheet_id")) for h in _post("tabHolders", {"tab": str(tab)}).get("holders") or []
            if h.get("sheet_id")]


def worlds() -> list[dict[str, str]]:
    """My World's registry: each world_id with its owner_user_id and owner_email."""
    return [dict(w) for w in _post("worldOwners", {}).get("worlds") or [] if isinstance(w, dict)]


def log_lines(since: str, fields: list[str]) -> list[dict[str, str]]:
    """The action log's lines at or after `since` (ISO text): the logs book's history and the Hub's own lines."""
    return [dict(r) for r in _post("logWindow", {"since": str(since), "fields": list(fields)}).get("lines") or []
            if isinstance(r, dict)]


# ---- mirror_first's backend --------------------------------------------------------------------------------------

def cell(v: Any) -> Any:
    """What data->>key gave: text as is, any other JSON value as its JSON text, an absent key as None."""
    if v is None or isinstance(v, str):
        return v
    return json.dumps(v, ensure_ascii=False)


class MirrorBackend:
    """mirror_first's backend over asa-hub-db's copy: a book's vouch from its catalog word, a tab's keys from its
    first row, and only the named cells of each row."""

    def __init__(self, dsn: str = "") -> None:
        self.dsn = dsn

    def vouch_row(self, sheet_id: str, tab: str) -> dict[str, Any]:
        b = book(sheet_id)
        t = read(sheet_id, tab)
        at = float(b.get("as_of") or 0.0)
        return {"known": bool(b.get("known")), "status": str(b.get("status") or ""),
                "modified_time": b.get("modified_time"), "synced_at": b.get("synced_at"),
                "has_rows": bool(t["rows"]), "listed_at": at + VOUCH_MARGIN_S if at else None,
                "pending": [sheet_id] if b.get("stale") else [], "dirty": False, "whole_at": None}

    def tab_keys(self, sheet_id: str, tab: str) -> set[str]:
        got = read(sheet_id, tab)["rows"]
        return set(got[0][1]) if got else set()

    def tab_rows(self, sheet_id: str, tab: str,
                 headers: list[str]) -> tuple[set[str], list[tuple[int, list[Any]]]]:
        got = read(sheet_id, tab)["rows"]
        keys = set(got[0][1]) if got else set()
        return keys, [(int(rn), [cell(d.get(h)) for h in headers]) for rn, d in got]
