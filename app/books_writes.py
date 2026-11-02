"""Books' writes (Books.gs) kept in Postgres alone (app/resource_rows.py): the catalogue planted (booksSeed), each
fetch's outcome on its row (booksFetch), the model's titles added (booksMine), the text of the books still missing a
copy stored (booksHarvest), a file uploaded by hand and its text (booksFileUpload) — each after the read the relay asks
first (app/books.py) — and the generic create, update and delete on `books`. booksUpload brings the books and
books_text sheets into Postgres as the app is given to Python, and hands them back as it returns to Apps Script."""
from __future__ import annotations

import json
import logging
from typing import Any, Callable

import books as B
import drive_files as DF
import gsjs
import locations as L
import resource_rows as RR
import sheet_resources as SR
import smart_comms as SC
import staff_views
import writes as W
from writes import Decision

log = logging.getLogger("asa-hub-app")

BUSY = "Somebody else is changing the shelf right now — try again."
UNPREPARED = "The books could not be read just now — nothing was written. Try again in a minute."
NOT_FILED = "The file could not be filed just now — nothing was written. Try again in a minute."

s_ = gsjs.str_


def _refused(d: Decision) -> dict[str, Any] | None:
    a = d.answer or {}
    return None if a.get("status") == 200 else a


def row_from(entry: dict[str, str], now: str) -> dict[str, str]:
    """booksRowFrom_."""
    return {"title": s_(entry.get("title")), "author": s_(entry.get("author")), "subject": s_(entry.get("subject")),
            "licence": s_(entry.get("licence")), "source": s_(entry.get("source")), "home": s_(entry.get("home")),
            "summary": s_(entry.get("summary")), "why": s_(entry.get("why")), "driveUrl": "", "fileSize": "",
            "fetchNote": "", "addedAt": now}


def _prepared(p: dict) -> dict[str, Any] | None:
    prep = p.get("prepared")
    return prep if isinstance(prep, dict) else None


def _line(user: dict | None, action: str, said: str) -> None:
    """hubSysLog_."""
    staff_views.record(user, action, said)


# ---- booksTextReplace_ ----------------------------------------------------------------------------------------------

def _remove_many(reads: L.Reads, items: list[tuple[str, dict]], by: str) -> None:
    """RR.remove for many rows in one go, each logged for a void."""
    if not items:
        return
    cur = RR._cur()
    cur.executemany(f"update {RR.ROWS} set removed_at = now(), removed_by = %s, origin = 'postgres', write_id = %s"
                    " where resource = %s and row_key = %s", [(by, SC.write_id(), B.TEXT, k) for k, _c in items])
    cur.executemany(f"insert into {RR.CHANGES} (write_id, resource, row_key, kind, before, after, by_email)"
                    " values (%s, %s, %s, 'delete', %s, null, %s)",
                    [(SC.write_id(), B.TEXT, k, json.dumps(c), by) for k, c in items])


def text_replace(sess: L.Session, bid: str, title: str, via: str, paras: list[str]) -> None:
    """booksTextReplace_: the book's stored text taken off whole and written again, in order; its reader's cache
    cleared."""
    reads = sess.reads
    by = s_((sess.user or {}).get("email"))
    col = B._text_col(reads, "bookId")
    got = RR._q(reads, f"select row_key, cells from {RR.ROWS} where resource = %s and removed_at is null"
                       " and btrim(cells->>%s) = %s", (B.TEXT, col, bid))
    _remove_many(reads, [(k, RR._json(c) or {}) for k, c in got], by)
    names = {n: B._text_col(reads, n) for n in B.TEXT_HEADER}
    RR.create_many(reads, B.TEXT, [{names["bookId"]: bid, names["title"]: s_(title), names["via"]: s_(via),
                                    names["ord"]: str(k), names["text"]: str(p)[:B.TEXT_MAX]}
                                   for k, p in enumerate(paras)], by)
    B.cache_clear(bid)


# ---- the doors ------------------------------------------------------------------------------------------------------

def seed(sess: L.Session, payload: dict) -> Decision:
    """booksSeed: the catalogue planted, matched by source URL — a title gets edited, the URL is the publication; a row
    already there takes the catalogue's description, never what a fetch wrote on it."""
    if not B.writer(sess.user):
        return Decision(dict(B.DENIED))
    reads = sess.reads
    B.owned(reads)
    by_source: dict[str, dict] = {}
    for r in B.shelf(reads):
        if s_(r.get("source")):
            by_source[s_(r.get("source"))] = r
    now = W.now_iso(reads)
    added = updated = 0
    for entry in B.CATALOGUE:
        row = row_from(entry, now)
        hit = by_source.get(row["source"])
        if hit is None:
            no = _refused(SR.create_row(sess, B.RESOURCE, row))
            if no:
                return Decision({"status": no.get("status"), "message": s_(no.get("message")) +
                                 f" — {added} added and {updated} updated before the refusal."},
                                own=bool(added or updated))
            added += 1
            continue
        for k in ("driveUrl", "fileSize", "fetchNote", "addedAt"):
            row.pop(k)
        SR.update_row(sess, B.RESOURCE, {"id": s_(hit.get("id")), **row})
        updated += 1
    return Decision({"status": 200, "data": {"added": added, "updated": updated, "total": len(B.CATALOGUE)}},
                    subject="", own=True)


def fetch(sess: L.Session, payload: dict) -> Decision:
    """booksFetch: what the relay's read fetched recorded on each row — a link only for a file that provably arrived
    (filed in Drive and kept on the server), else the reason on its fetchNote."""
    user = sess.user
    if not B.writer(user):
        return Decision(dict(B.DENIED))
    reads = sess.reads
    B.owned(reads)
    prep = _prepared(payload if isinstance(payload, dict) else {})
    if prep is None:
        return W.refuse(503, UNPREPARED)
    for r in prep.get("results") or []:
        rid = s_((r or {}).get("id")) if isinstance(r, dict) else ""
        if not rid or SR._found(reads, B.RESOURCE, rid) is None:
            continue
        url = s_(r.get("driveUrl"))
        if url and DF.kept(B.KEPT_DIR, DF.file_id_of(url)) is None:
            log.warning("books: %s's file is not on the server — its link is not written", rid)
            continue
        SR.update_row(sess, B.RESOURCE, {"id": rid, "driveUrl": url, "fileSize": s_(r.get("fileSize")), "fetchNote": ""}
                      if url else {"id": rid, "fetchNote": s_(r.get("fetchNote")), "driveUrl": ""})
    fetched = int(prep.get("fetched") or 0)
    _line(user, "books_fetch", f"{fetched} fetched")
    return Decision({"status": 200, "data": {"fetched": fetched, "failed": int(prep.get("failed") or 0),
                                             "skipped": int(prep.get("skipped") or 0),
                                             "stopped_early": bool(prep.get("stopped_early")),
                                             "folder": s_(prep.get("folder")), "index": s_(prep.get("index"))}},
                    subject="", own=True)


def mine(sess: L.Session, payload: dict) -> Decision:
    """booksMine: the model's titles the relay's read gathered, each through the tests again against the shelf as it
    stands, added with the model that named them."""
    user = sess.user
    if not B.writer(user):
        return Decision(dict(B.DENIED))
    reads = sess.reads
    B.owned(reads)
    prep = _prepared(payload if isinstance(payload, dict) else {})
    if prep is None:
        return W.refuse(503, UNPREPARED)
    shelf = B.shelf(reads)
    have_src = {s_(r.get("source")) for r in shelf if s_(r.get("source"))}
    have_title = {s_(r.get("title")).lower() for r in shelf if s_(r.get("title"))}
    refused = int(prep.get("refused") or 0)
    named = [s_(n) for n in prep.get("refused_named") or []][:6]
    via, now = s_(prep.get("via")), W.now_iso(reads)
    added = 0
    for b in prep.get("rows") or []:
        row, why = B.judged(b, have_src, have_title)
        if row is None:
            refused += 1
            if why and len(named) < 6:
                named.append(why)
            continue
        no = _refused(SR.create_row(sess, B.RESOURCE, {**row, "driveUrl": "", "fileSize": "", "fetchNote": "",
                                                       "via": via, "addedAt": now}))
        if no:
            return Decision({"status": no.get("status"), "message": s_(no.get("message")) +
                             f" — {added} book(s) were added before the refusal."}, own=bool(added))
        have_src.add(row["source"])
        have_title.add(row["title"].lower())
        added += 1
    _line(user, "books_mine", f"{added} added, {refused} refused")
    return Decision({"status": 200, "data": {"added": added, "refused": refused, "refused_named": named, "via": via,
                                             "rounds": prep.get("rounds")}}, subject="", own=True)


def harvest(sess: L.Session, payload: dict) -> Decision:
    """booksHarvest: the text the relay's read harvested stored for each book (three a press)."""
    user = sess.user
    if not B.writer(user):
        return Decision(dict(B.DENIED))
    reads = sess.reads
    B.owned(reads)
    prep = _prepared(payload if isinstance(payload, dict) else {})
    if prep is None:
        return W.refuse(503, UNPREPARED)
    done: list[str] = []
    for h in prep.get("harvested") or []:
        bid = s_((h or {}).get("id")) if isinstance(h, dict) else ""
        paras = h.get("paragraphs") if bid else None
        if not isinstance(paras, list) or len(paras) < 3 or B.row_of(reads, bid) is None:
            continue
        text_replace(sess, bid, s_(h.get("title")), "harvest", [s_(x) for x in paras])
        done.append(s_(h.get("title")))
    failed = [f for f in prep.get("failed") or [] if isinstance(f, dict)]
    _line(user, "books_harvest", f"{len(done)} harvested, {len(failed)} failed")
    return Decision({"status": 200, "data": {"harvested": done, "failed": failed,
                                             "remaining": int(prep.get("remaining") or 0)}}, subject="", own=True)


def file_upload(sess: L.Session, payload: dict) -> Decision:
    """booksFileUpload: the file the relay's read filed (in Drive and on the server) linked on the book's row, and its
    text stored in the same press when three paragraphs or more came out of it."""
    user = sess.user
    if not B.writer(user):
        return Decision(dict(B.DENIED))
    reads = sess.reads
    B.owned(reads)
    p = payload if isinstance(payload, dict) else {}
    row, refused = B.upload_refused(reads, p)
    if refused:
        return Decision(refused)
    bid = s_(p.get("id"))
    prep = _prepared(p)
    if s_(p.get("base64")) != "kept" or prep is None or s_(prep.get("id")) != bid or \
            DF.kept(B.KEPT_DIR, s_(prep.get("drive_id"))) is None:
        return W.refuse(503, NOT_FILED)
    size = int(prep.get("size") or 0)
    url = DF.file_url(s_(prep.get("drive_id")))
    SR.update_row(sess, B.RESOURCE, {"id": bid, "driveUrl": url, "fileSize": B.human_size(size), "fetchNote": ""})
    paras = [s_(x) for x in prep.get("paragraphs") or []]
    note, stored = "", 0
    if len(paras) >= 3:
        text_replace(sess, bid, s_((row or {}).get("title")), "upload", paras)
        stored = len(paras)
    else:
        reason = s_(prep.get("reason"))
        note = "The file is held on the shelf, but its text could not be stored" + (
            " — " + reason if reason else (" — too little readable text came out." if prep.get("had_text") else "."))
    saved = s_(prep.get("saved"))
    _line(user, "books_upload", f"{saved} ({stored} paragraphs)")
    return Decision({"status": 200, "data": {"saved": saved, "driveUrl": url, "fileSize": B.human_size(size),
                                             "paragraphs": stored, "note": note}}, subject=bid, own=True)


def create(sess: L.Session, payload: dict) -> Decision:
    return SR.create_row(sess, B.RESOURCE, payload)


def update(sess: L.Session, payload: dict) -> Decision:
    return SR.update_row(sess, B.RESOURCE, payload)


def delete(sess: L.Session, payload: dict) -> Decision:
    return SR.delete_row(sess, B.RESOURCE, payload)


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {
    "booksSeed": seed, "booksFetch": fetch, "booksMine": mine, "booksHarvest": harvest, "booksFileUpload": file_upload,
    "booksCreate": create, "booksUpdate": update, "booksDelete": delete,
    "booksUpload": RR.upload_door({r: SR.SPECS[r] for r in (B.RESOURCE, B.TEXT)})}
_WRITERS = ("admin", "manager")
# the generic verbs declare no roles; each door's own gate decides
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
POLICY.update({"booksSeed": {"roles": _WRITERS}, "booksFetch": {"roles": _WRITERS}, "booksMine": {"roles": _WRITERS},
               "booksHarvest": {"roles": _WRITERS},
               "booksFileUpload": {"roles": _WRITERS, "params": {"id": "string"}}})
BUSY_OF: dict[str, dict[str, Any]] = {a: {"status": 409, "message": BUSY} for a in ACTIONS}


class Store(RR.Store):
    """app.books_writes and app.books_receipts; the shelf and its text app.resource_rows'."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="books", label="Books")
