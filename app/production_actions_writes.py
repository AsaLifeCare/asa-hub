"""Production Actions' writes on Python (ProductionActions.gs): a run, a mark, an undo and an edit of the runbook, each
answered once per click (client_id) and written to the history in Postgres; a rehearsal kept as a CommMock row through
Smart Comms; a real banner laid on the server's copy of its book (production_actions), the copy as it stood kept until
the relay settles the write, so a void puts it back. productionActionsUpload brings both houses into Postgres as the
runbook is given to Python."""
from __future__ import annotations

import json
import os
import random
import re
from typing import Any, Callable

import gsjs
import locations as L
import production_actions as PA
import resource_rows as RR
import smart_comms as SC
import writes as W
from writes import Decision

BUSY = "Another production action is running — try again in a moment."
VOID_DIR = ".void"

s_ = gsjs.str_


def _cell(v: Any) -> str:
    return json.dumps(v, separators=(",", ":")) if isinstance(v, (dict, list)) else s_(v)


def run_id() -> str:
    return "PR-" + re.sub(r"[^0-9]", "", PA.now_iso())[:17] + "-" + str(random.randint(1000, 9999))


def run_row(reads: L.Reads, d: dict, user: dict, client_id: str, act: str, expect: str, mode: str) -> dict[str, Any]:
    """paRunRow_."""
    now = PA.now_iso()
    return {"id": run_id(), "createdAt": now, "updatedAt": now, "action_id": s_(d.get("id")),
            "number": s_(d.get("number")), "title": s_(d.get("title")), "act": act, "result": "", "expect": expect or "",
            "test_mode": mode, "dial": PA.dial_word(reads), "by_email": s_(user.get("email")),
            "by_name": s_(user.get("display_name") or user.get("name")) or s_(user.get("email")),
            "client_id": client_id, "def_sha": PA.def_sha(d) if "kind" in d else "", "preview_sha": "", "target": "",
            "detail": "", "before": "", "after": "", "undoes": "", "mock_row_id": "", "tenant": ""}


def answer(reads: L.Reads, row: dict, user: dict, extra: dict | None = None) -> Decision:
    """paAnswer_: the history row written, then the answer that names it."""
    RR.create(reads, PA.RUNS_RES, {h: _cell(row.get(h)) for h in PA.RUNS_HEADER}, s_(user.get("email")))
    data: dict[str, Any] = {"run": PA.run_out(row)}
    data.update(extra or {})
    return Decision({"status": 200, "data": data}, subject=s_(row.get("action_id")), own=True)


def repeat(prior: dict, extra: dict | None = None) -> Decision:
    return Decision({"status": 200, "data": {"run": PA.run_out(prior), **(extra or {}), "repeat": True}},
                    subject=s_(prior.get("action_id")), own=True)


def _gate(sess: L.Session, name: str) -> Decision | None:
    no = PA.gate(sess.user, name)
    return Decision(no) if no else None


def _send_word(reads: L.Reads) -> str:
    try:
        b = SC.brakes(reads.db, RR._cur())
    except Exception:  # noqa: BLE001 - said as unknown
        return ""
    return "on" if b.get("rpc_send") and not b.get("paused") else "off"


def mock(reads: L.Reads, d: dict, plan: dict, row: dict, held: str) -> dict[str, Any]:
    """paMock_."""
    body = PA.rehearse_text(plan)
    at = PA.now_iso()
    return {"id": row["id"] + ".mock", "at": at, "day": at[:10], "hour": at[11:16], "pass_id": "production-actions",
            "seq": 1, "situation": "production_action",
            "purpose": "production action #" + s_(d.get("number")) + " · " + s_(d.get("handler")),
            "method": "productionAction", "send_at": "", "person_name": "", "to_masked": plan["target"], "audience": 1,
            "channel": "production_action", "subject": "#" + s_(d.get("number")) + " " + s_(d.get("title"))
            + " (rehearsal)", "body": body[:4000], "body_chars": len(body), "result": "rehearsed", "held_by": held,
            "reason": "Nothing outside the platform's own houses was opened for writing.", "dial": row["dial"],
            "test_mode": row["test_mode"], "send_switch": _send_word(reads), "ledger_key": row["id"],
            "tenant": row["tenant"]}


# ---- the banner on the server's copy ------------------------------------------------------------------------------

def _hex6(h: str) -> str:
    return s_(h).lstrip("#").upper()


def _keep_for_void(book: str) -> None:
    """The book as it stands before this write lays anything on it, for the relay's void."""
    path, _side = PA.book_paths(book)
    wid = SC.write_id()
    if not wid or not path.is_file():
        return
    keep = PA.books_dir() / VOID_DIR / f"{wid}__{book}.xlsx"
    keep.parent.mkdir(parents=True, exist_ok=True)
    if not keep.exists():
        keep.write_bytes(path.read_bytes())


def _save(wb: Any, book: str) -> None:
    path, _side = PA.book_paths(book)
    tmp = path.with_name(path.name + ".part")
    wb.save(tmp)
    os.replace(tmp, path)


def _cells(ws: Any, a1: dict) -> list:
    return [ws.cell(row=a1["row"], column=c) for c in range(a1["col"], a1["col2"] + 1)]


def _dress(ws: Any, cells: list, text: str, url: str, bg: str, fg: str, bold: bool, tab: str) -> None:
    """The banner's line, colours and weight on its cells, its first cell left to overflow, and the tab's colour."""
    from openpyxl.styles import Alignment, Font, PatternFill  # noqa: PLC0415
    first = cells[0]
    first.value = text
    if url:
        first.hyperlink = url
    for c in cells:
        c.fill = PatternFill(fill_type="solid", fgColor=_hex6(bg))
        f = c.font
        c.font = Font(name=f.name, size=f.size, italic=f.i, underline=f.u, bold=bold, color=_hex6(fg) or None)
    a = first.alignment
    first.alignment = Alignment(horizontal=a.horizontal, vertical=a.vertical, wrap_text=False)
    if tab:
        ws.sheet_properties.tabColor = _hex6(tab)


def banner_run(plan: dict) -> dict[str, Any]:
    """paBannerRun_ on the server's copy: written whole or not at all, and never when the last row would move."""
    h = plan["_h"]
    wb, side = PA.open_book(h["book"])
    ws, _tab = PA.tab_of(wb, side, h["gid"])
    a1 = PA.a1_of(h["a1"])
    cells = _cells(ws, a1)
    first = cells[0]
    before = {"backgrounds": [PA.fill_of(c) for c in cells], "font_colors": [PA.font_color_of(c) for c in cells],
              "font_weights": [PA.weight_of(c) for c in cells],
              "wrap": "WRAP" if first.alignment.wrap_text else "OVERFLOW", "tab_color": PA.tab_color_of(ws)}
    after = {"handler": "banner", "book": h["book"], "gid": h["gid"], "a1": h["a1"], "text": h["text"]}
    last_before = PA.last_row(ws)
    try:
        _dress(ws, cells, h["text"], h["url"], h["background"], h["color"], h["bold"], h["tab_color"])
    except Exception as exc:  # noqa: BLE001 - nothing was saved, so nothing moved
        return {"result": "failed", "before": before, "after": after,
                "detail": "The write failed (" + PA.err(exc) + "); the cells were put back as they were."}
    last_after = PA.last_row(ws)
    if last_after != last_before:
        return {"result": "failed", "before": before, "after": after,
                "detail": f"The last row would have moved from {last_before} to {last_after}, so the cells were put "
                          "back as they were."}
    _keep_for_void(h["book"])
    _save(wb, h["book"])
    return {"result": "ok", "before": before, "after": after,
            "detail": "Wrote the line in " + h["a1"] + " of " + " › ".join(plan["target"].split(" › ")[:2])
                      + f" on the server's copy; the last row stayed {last_before}."}


def refused(words: str) -> dict[str, Any]:
    return {"result": "refused", "detail": s_(words).rstrip(".") + " — nothing was put back."}


def undo_bound(reads: L.Reads, after: dict, d: dict | None) -> str:
    """paUndoBound_."""
    if not d or s_(d.get("kind")) != "automatic" or s_(d.get("handler")) != s_(after.get("handler")):
        return "The action no longer names this change"
    p, _why = PA.params_of(d)
    if p is None:
        return "The action's params do not parse"
    if s_(after.get("handler")) != "banner":
        return ""
    a, dd = PA.a1_of(after.get("a1")), PA.a1_of(p.get("range"))
    if s_(after.get("book")) != s_(p.get("book")) or s_(after.get("gid")) != s_(p.get("gid")) or not a or not dd or \
            a["row"] != dd["row"] or a["col"] != dd["col"] or a["col2"] > dd["col2"]:
        return "The run's cells are not the ones the action names now"
    own = PA.platform_books(reads)
    if own["error"]:
        return "The platform's own books could not be listed (" + own["error"] + ")"
    if s_(after.get("book")) in own["ids"]:
        return "That is one of the platform's own books"
    return ""


def banner_undo(reads: L.Reads, run: dict, d: dict | None) -> dict[str, Any]:
    """paBannerUndo_ on the server's copy."""
    after, before = PA.jsonish(run.get("after")), PA.jsonish(run.get("before"))
    bound = undo_bound(reads, after, d)
    if bound:
        return refused(bound)
    wb, side = PA.open_book(s_(after.get("book")))
    found = PA.tab_of(wb, side, int(s_(after.get("gid")) or 0))
    if found is None:
        return refused(f"The tab with id {s_(after.get('gid'))} is gone")
    ws, _tab = found
    a1 = PA.a1_of(after.get("a1"))
    cells = _cells(ws, a1)
    vals = [PA.xl_text(c.value) for c in cells]
    if not (vals[0] == s_(after.get("text")) and all(not v for v in vals[1:])):
        return refused(s_(after.get("a1")) + " no longer holds exactly the line the run wrote")
    last_before = PA.last_row(ws)
    from openpyxl.styles import Alignment, Font, PatternFill  # noqa: PLC0415
    first = cells[0]
    first.value = None
    first.hyperlink = None
    bgs, fgs, ws_ = before.get("backgrounds") or [], before.get("font_colors") or [], before.get("font_weights") or []
    for i, c in enumerate(cells):
        bg = s_(bgs[i]) if i < len(bgs) else ""
        c.fill = PatternFill(fill_type=None) if not bg or bg.upper() == "#FFFFFF" else \
            PatternFill(fill_type="solid", fgColor=_hex6(bg))
        f = c.font
        c.font = Font(name=f.name, size=f.size, italic=f.i, underline=f.u,
                      bold=(s_(ws_[i]) == "bold") if i < len(ws_) else False,
                      color=_hex6(fgs[i]) if i < len(fgs) and s_(fgs[i]) else None)
    a = first.alignment
    first.alignment = Alignment(horizontal=a.horizontal, vertical=a.vertical,
                                wrap_text=s_(before.get("wrap")) == "WRAP")
    ws.sheet_properties.tabColor = _hex6(s_(before.get("tab_color"))) or None
    last_after = PA.last_row(ws)
    if last_after == last_before:
        _keep_for_void(s_(after.get("book")))
        _save(wb, s_(after.get("book")))
        return {"result": "ok", "detail": "Put back " + s_(after.get("a1")) + " as it was: empty, its colours, and the "
                                          "tab colour, on the server's copy."}
    return {"result": "failed", "detail": "Put back " + s_(after.get("a1")) + f", but the last row would have moved "
                                          f"from {last_before} to {last_after}, so nothing was saved."}


# ---- the doors ------------------------------------------------------------------------------------------------------

def run(sess: L.Session, payload: dict) -> Decision:
    """productionActionRun: a rehearsal unless test mode reads off and the click asked for a real run."""
    no = _gate(sess, "productionActionRun")
    if no:
        return no
    reads, user = sess.reads, sess.user or {}
    p = payload or {}
    aid, client, sha = s_(p.get("action_id")), s_(p.get("client_id")), s_(p.get("preview_sha"))
    expect = "real" if s_(p.get("expect")) == "real" else "rehearse"
    if not aid or not client:
        return W.refuse(400, "An action and a client id are required.")
    prior = PA.by_client(PA.runs(reads), client)
    if prior:
        return repeat(prior)
    d = PA.def_find(PA.defs(reads), aid)
    if d is None:
        return W.refuse(404, f'No action "{aid}".')
    if s_(d.get("kind")) != "automatic":
        return W.refuse(400, "A manual action is marked done, not run.")
    if PA.enabled_word(d.get("enabled")) == "no":
        return W.refuse(400, "That action is switched off.")
    mode = PA.test_mode(reads)
    real = mode == "off" and expect == "real"
    row = run_row(reads, d, user, client, "run" if real else "rehearse", expect, mode)
    try:
        plan = PA.plan_for(reads, d)
    except Exception as exc:  # noqa: BLE001 - said in the history
        row.update(result="failed", detail="The target could not be read (" + PA.err(exc) + ").")
        return answer(reads, row, user)
    row.update(preview_sha=s_(plan.get("preview_sha")), target=plan["target"])
    if not plan["ok"]:
        row.update(result="refused", detail=(plan["problems"] or ["The checks did not hold."])[0])
        return answer(reads, row, user)
    if sha != plan["preview_sha"]:
        row.update(result="refused", detail="Changed since the preview — preview again.")
        return answer(reads, row, user)
    if not real:
        held = "the click asked for a rehearsal" if expect == "rehearse" else \
            "test mode could not be read, so it counts as on — a production action only rehearses" \
            if mode == "unreadable" else "test mode is on — a production action only rehearses"
        rec = mock(reads, d, plan, row, held)
        ctx = SC._WRITE.get()
        kept = bool(ctx) and SC.keep_test_row(RR._cur(), ctx, SC.comm_logs.MOCK, rec)
        if kept:
            row.update(result="ok", mock_row_id=rec["id"],
                       detail="Rehearsed as CommMock row " + rec["id"] + "; nothing outside was written.")
        else:
            row.update(result="failed", detail="The CommMock row could not be written, so the rehearsal did not "
                                               "happen.")
        return answer(reads, row, user)
    if plan["state"] == "already":
        row.update(result="noop", detail="Already in place — nothing was written.")
        return answer(reads, row, user)
    handler = s_(d.get("handler"))
    try:
        if handler == "banner":
            got = banner_run(plan)
        elif handler == "link":
            got = {"result": "ok", "before": "", "after": {"handler": "link", "url": plan["_h"]["url"]},
                   "detail": "Opened " + plan["_h"]["url"] + "."}
        else:
            got = {"result": "refused", "detail": PA.FORM_OFF_SERVER}
        row.update(result=got["result"], before=got.get("before") or "", after=got.get("after") or "",
                   detail=got["detail"])
    except Exception as exc:  # noqa: BLE001 - said in the history
        row.update(result="failed", detail="The write failed (" + PA.err(exc) + ").")
    extra = {"open": plan["_h"]["url"]} if handler == "link" and row["result"] == "ok" else None
    return answer(reads, row, user, extra)


def mark(sess: L.Session, payload: dict) -> Decision:
    """productionActionMark: an action marked done or reopened — a record of what a person did."""
    no = _gate(sess, "productionActionMark")
    if no:
        return no
    reads, user = sess.reads, sess.user or {}
    p = payload or {}
    aid, client, done = s_(p.get("action_id")), s_(p.get("client_id")), p.get("done") is True
    if not aid or not client:
        return W.refuse(400, "An action and a client id are required.")
    prior = PA.by_client(PA.runs(reads), client)
    if prior:
        return repeat(prior)
    d = PA.def_find(PA.defs(reads), aid)
    if d is None:
        return W.refuse(404, f'No action "{aid}".')
    row = run_row(reads, d, user, client, "mark" if done else "unmark", "", PA.test_mode(reads))
    row.update(result="ok", detail="Marked done." if done else "Reopened.")
    return answer(reads, row, user)


def undo(sess: L.Session, payload: dict) -> Decision:
    """productionActionUndo: the newest real run of an action undone, once, while its target holds what it wrote."""
    no = _gate(sess, "productionActionUndo")
    if no:
        return no
    reads, user = sess.reads, sess.user or {}
    p = payload or {}
    rid, client = s_(p.get("run_id")), s_(p.get("client_id"))
    if not rid or not client:
        return W.refuse(400, "A run and a client id are required.")
    rs = PA.runs(reads)
    prior = PA.by_client(rs, client)
    if prior:
        return repeat(prior)
    target = None
    for r in rs:
        if s_(r.get("id")) == rid:
            target = r
    if not target or s_(target.get("act")) != "run" or s_(target.get("result")) != "ok":
        return W.refuse(400, "Only a real run that wrote something can be undone.")
    newest = None
    for r in rs:
        if s_(r.get("action_id")) != s_(target.get("action_id")) or s_(r.get("act")) != "run" or \
                s_(r.get("result")) != "ok":
            continue
        if newest is None or s_(r.get("createdAt")) > s_(newest.get("createdAt")) or (
                s_(r.get("createdAt")) == s_(newest.get("createdAt")) and r["_row"] > newest["_row"]):
            newest = r
    if newest is None or s_(newest.get("id")) != rid:
        return W.refuse(409, "Only the newest real run of this action can be undone.")
    if any(s_(r.get("act")) == "undo" and s_(r.get("result")) == "ok" and s_(r.get("undoes")) == rid for r in rs):
        return W.refuse(409, "That run is already undone.")
    handler = s_(PA.jsonish(target.get("after")).get("handler"))
    if handler not in ("banner", "form_close"):
        return W.refuse(400, "This action has nothing to put back.")
    d = PA.def_find(PA.defs(reads), target.get("action_id"))
    row = run_row(reads, d or {"id": s_(target.get("action_id")), "number": s_(target.get("number")),
                               "title": s_(target.get("title"))}, user, client, "undo", "", PA.test_mode(reads))
    row.update(undoes=rid, target=s_(target.get("target")))
    try:
        got = banner_undo(reads, target, d) if handler == "banner" else refused(PA.FORM_OFF_SERVER)
        row.update(result=got["result"], detail=got["detail"])
    except Exception as exc:  # noqa: BLE001 - said in the history
        row.update(result="failed", detail="The undo failed (" + PA.err(exc) + ").")
    return answer(reads, row, user)


def new_id(title: Any, ds: list[dict]) -> str:
    """paNewId_."""
    base = re.sub(r"^_+|_+$", "", re.sub(r"[^a-z0-9]+", "_", s_(title).lower()))[:36] or "action"
    if len(base) < 2:
        base = "action_" + base
    did, n = base, 2
    while PA.def_find(ds, did):
        did = f"{base}_{n}"
        n += 1
    return did


def save(sess: L.Session, payload: dict) -> Decision:
    """productionActionSave: one runbook action added or edited; nothing is ever deleted — enabled "no" retires it."""
    no = _gate(sess, "productionActionSave")
    if no:
        return no
    reads, user = sess.reads, sess.user or {}
    p = payload or {}
    client, given = s_(p.get("client_id")), p.get("action")
    if not client or not isinstance(given, dict):
        return W.refuse(400, "An action and a client id are required.")
    ds = PA.defs(reads)
    prior = PA.by_client(PA.runs(reads), client)
    if prior:
        had = PA.def_find(ds, prior.get("action_id"))
        return repeat(prior, {"action": PA.def_out(had) if had else None})
    did = s_(given.get("id"))
    existing = PA.def_find(ds, did) if did else None
    if not did:
        did = new_id(given.get("title"), ds)
    row = {h: s_(existing.get(h)) if existing else "" for h in PA.ACTIONS_HEADER}
    for k in PA.EDITABLE:
        if k in given:
            v = given[k]
            row[k] = json.dumps(v, separators=(",", ":")) if k == "params" and isinstance(v, (dict, list)) else s_(v)
    now = PA.now_iso()
    row["id"] = did
    row["enabled"] = PA.enabled_word(row["enabled"])
    if not existing:
        row["createdAt"] = now
    row["updatedAt"] = now
    row["updated_by"] = s_(user.get("email"))
    problems = PA.validate(row)
    if problems:
        return Decision({"status": 400, "message": problems[0]["words"], "problems": problems})
    found = RR.find(reads, PA.DEFS_RES, did)
    if found:
        key, cells = found
        RR.update(reads, PA.DEFS_RES, key, cells, {h: row[h] for h in PA.ACTIONS_HEADER}, s_(user.get("email")))
    else:
        RR.create(reads, PA.DEFS_RES, {h: row[h] for h in PA.ACTIONS_HEADER}, s_(user.get("email")))
    ledger = run_row(reads, row, user, client, "save", "", PA.test_mode(reads))
    ledger.update(result="ok", detail=("Edited" if existing else "Added") + " #" + s_(row["number"]) + " "
                  + s_(row["title"]) + ".")
    return answer(reads, ledger, user, {"action": PA.def_out(row)})


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {
    "productionActionRun": run, "productionActionMark": mark, "productionActionUndo": undo,
    "productionActionSave": save,
    "productionActionsUpload": RR.upload_door({PA.DEFS_RES: {"tab": PA.ACTIONS_TAB}, PA.RUNS_RES: {"tab": PA.RUNS_TAB}})}
POLICY: dict[str, dict[str, Any]] = {
    "productionActionRun": {"roles": ("admin",), "params": {"action_id": "string", "client_id": "string",
                                                            "preview_sha": "string", "expect": "string"}},
    "productionActionMark": {"roles": ("admin",), "params": {"action_id": "string", "client_id": "string",
                                                             "done": "boolean"}},
    "productionActionUndo": {"roles": ("admin",), "params": {"run_id": "string", "client_id": "string"}},
    "productionActionSave": {"roles": ("admin",), "params": {"client_id": "string", "action": "object"}},
    "productionActionsUpload": {}}
BUSY_OF: dict[str, dict[str, Any]] = {a: {"status": 409, "message": BUSY} for a in ACTIONS}


class Store(RR.Store):
    """app.production_actions_writes and app.production_actions_receipts, beside the other apps' own; the runbook and
    its history app.resource_rows'. A void takes each row back and puts the book a banner was laid on as it stood."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="production_actions", label="Production Actions")

    def settle(self, write_id: str, state: str, why: str = "", fields: list[str] | None = None) -> bool:
        done = super().settle(write_id, state, why, fields)
        try:
            for kept in (PA.books_dir() / VOID_DIR).glob(f"{write_id}__*.xlsx"):
                book = kept.name.split("__", 1)[1][:-5]
                if state == "void" and done:
                    os.replace(kept, PA.book_paths(book)[0])
                elif state != "void":
                    kept.unlink(missing_ok=True)
        except Exception as exc:  # noqa: BLE001 - said, never raised into the relay's settle
            W.log.warning("production actions: the book of %s was not settled (%s)", write_id[:40],
                          type(exc).__name__)
        return done
