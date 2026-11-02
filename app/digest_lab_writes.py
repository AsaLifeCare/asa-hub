"""The Decoder lab's writes (server/digest_proposals.py and the relay's /digest routes) decided off asa-hub-db and kept
in app.edits: a scan's new proposals, a proposal approved (its kind extended or made in the words book) or rejected,
a paper taught (its row sealed with the kind a person chose, its phrases proposed), and the digest keeper's own cells
on the ledgers (its claim, its verdict, its release), asked by the keeper alone."""
from __future__ import annotations

import json
from typing import Any, Callable

import digest_lab as D
import gsjs
import locations as L
import resource_rows as RR
import writes as W
from writes import Decision

BUSY = "Somebody else is changing the decoder lab right now — try again."


def _record(reads: L.Reads, sid: str, tab: str, kind: str, match: str, key: str, cells: dict,
            before: dict | None = None) -> dict:
    ref = D.tab_ref(reads, sid, tab)
    missing = [h for h in cells if h not in ref.headers]
    if missing:
        raise D.Defer(f"{tab} has no column {missing[0]}")
    return W.kept_record(sid, tab, kind, match, key, key, cells, before=before)


def _appends(reads: L.Reads, proposals: list[dict]) -> list[dict]:
    """write(): the proposals the tab does not hold yet, each appended whole."""
    sid = D.book_id(reads)
    return [_record(reads, sid, D.TAB, "append", "id", p["id"], {h: p.get(h, "") for h in D.HEADER})
            for p in proposals]


def _final(answer: dict[str, Any], edits: list[dict], subject: str, reads: L.Reads, *sids: str) -> Decision:
    d = W.final(answer, edits, subject)
    d.fresh = tuple(s for s in sids if s)
    return d


def digest_scan(sess: L.Session, payload: dict) -> Decision:
    """GET /digest/proposals?scan=1: every ledger read again, its new proposals appended, then the list."""
    if not D.lab_open(sess):
        return Decision(dict(D.REFUSED))
    reads = sess.reads
    kinds = D.known_kinds(reads)
    drawers = D.drawer_categories(reads)
    banned = D.house_names(reads)
    have = D.existing(reads)
    decided = {r["kind"] for r in have.values() if r.get("status") in ("approved", "rejected")}
    total = 0
    fresh: list[dict] = []
    for ledger in D.LEDGERS:
        props = D.build(D.ledger_rows(reads, ledger), kinds, drawers, decided, ledger, banned)
        total += len(props)
        held = set(have) | {p["id"] for p in fresh}
        fresh += [p for p in props if p["id"] not in held]
    summary = {"proposed": total, "written": len(fresh), "kinds_known": len(kinds)}
    W.gate(reads)
    answer = D.listing(reads, summary, fresh)
    sids = [D.book_id(reads)] + [s for s, _n, _f in D.LEDGERS.values()]
    return _final(answer, _appends(reads, fresh), "proposals", reads, *sids)


def digest_decide(sess: L.Session, payload: dict) -> Decision:
    """POST /digest/proposals/decide: approve (one row in Digest Kinds, made or extended) or reject; never twice."""
    if not D.lab_open(sess):
        return Decision(dict(D.REFUSED))
    p = payload if isinstance(payload, dict) else {}
    pid = gsjs.trim(gsjs.or_blank(p.get("id")))
    action = gsjs.trim(gsjs.or_blank(p.get("action"))).lower()
    category = gsjs.trim(gsjs.or_blank(p.get("category")))
    if not pid or action not in ("approve", "reject"):
        return Decision({"status": 400, "message": "id and action (approve|reject) are required"})
    reads = sess.reads
    sid = D.book_id(reads)
    row = D.existing(reads).get(pid)
    if row is None:
        return Decision({"status": 404, "message": "no such proposal"}, fresh=(sid,))
    if row.get("status") in ("approved", "rejected"):
        return Decision({"status": 200, "message": f"already {row['status']}", "proposal": row}, fresh=(sid,))
    now = D.now_stamp()
    by = D.who(sess)
    edits: list[dict] = []
    if action == "approve":
        cat = (category or row.get("category") or "other").strip()
        kinds = D.known_kinds(reads)
        kind = row["kind"]
        add_n = [n.strip() for n in (row.get("needles") or "").split(",") if n.strip()]
        add_h = [h.strip() for h in (row.get("file_hints") or "").split(",") if h.strip()]
        if kind in kinds:
            krow = next((kr for kr in D.read_tab(reads, D.KINDS_TAB)[1] if D.snake(kr.get("kind", "")) == kind), None)
            if krow is not None:
                needles = [x.strip() for x in (krow.get("needles") or "").split(",") if x.strip()]
                hints = [x.strip() for x in (krow.get("file_hints") or "").split(",") if x.strip()]
                needles += [n for n in add_n if n not in needles]
                hints += [h for h in add_h if h not in hints]
                cells = {"needles": ", ".join(needles), "file_hints": ", ".join(hints)}
                edits.append(_record(reads, sid, D.KINDS_TAB, "edit", W.COLS + "kind", krow.get("kind", ""), cells,
                                     before={"needles": krow.get("needles", ""),
                                             "file_hints": krow.get("file_hints", "")}))
        else:
            note = f"approved from {row.get('evidence_n')} reading(s) by {by} on {now[:10]} ({pid})"
            edits.append(_record(reads, sid, D.KINDS_TAB, "append", W.COLS + "kind", kind,
                                 {"kind": kind, "category": cat, "needles": ", ".join(add_n),
                                  "file_hints": ", ".join(add_h), "weight": "", "active": "yes", "notes": note}))
        row["category"] = cat
    row["status"] = "approved" if action == "approve" else "rejected"
    row["decided_at"], row["decided_by"] = now, by
    cells = {k: row.get(k, "") for k in ("status", "category", "decided_at", "decided_by")}
    edits.append(_record(reads, sid, D.TAB, "edit", "id", pid, cells))
    W.gate(reads)
    return _final({"status": 200, "proposal": row}, edits, pid, reads, sid)


def digest_teach(sess: L.Session, payload: dict) -> Decision:
    """POST /digest/teach: a person corrects one paper — its row sealed with the kind, its phrases proposed."""
    if not D.lab_open(sess):
        return Decision(dict(D.REFUSED))
    p = payload if isinstance(payload, dict) else {}
    ledger = gsjs.trim(gsjs.or_blank(p.get("ledger") or "client_files"))
    rid = gsjs.trim(gsjs.or_blank(p.get("row_id")))
    kind = gsjs.trim(gsjs.or_blank(p.get("kind")))
    if not rid or not kind:
        return Decision({"status": 400, "message": "row_id and kind are required"})
    if ledger not in D.LEDGERS:
        return Decision({"status": 400, "message": "unknown ledger"})
    reads = sess.reads
    lsid = D.LEDGERS[ledger][0]
    rows = D.ledger_rows(reads, ledger)
    row = next((r for r in rows if r["id"] == rid), None)
    if row is None:
        return Decision({"status": 404, "message": "row not in the mirror yet"}, fresh=(lsid,))
    kinds = D.known_kinds(reads)
    prop = D.teach(row, kind, rows, kinds, ledger)
    fresh_props = [prop] if prop and prop["id"] not in D.existing(reads) else []
    edits = _appends(reads, fresh_props)
    raw = next((r for _rn, r in D.ledger_raw(reads, ledger) if D._text(r.get("id")) == rid), {})
    try:
        meta = json.loads(D._text(raw.get("digest_json")) or "{}")
    except ValueError:
        meta = {}
    if not isinstance(meta, dict):
        meta = {}
    filed = D.snake(kind)
    meta.update({"taught": D.who(sess), "taught_at": D.now_stamp(), "taught_kind": filed, "final": True})
    edits.append(_record(reads, lsid, ledger, "edit", "id", rid,
                         {"doc_kind": filed, "digest_json": json.dumps(meta)},
                         before={"doc_kind": D._text(raw.get("doc_kind")),
                                 "digest_json": D._text(raw.get("digest_json"))}))
    W.gate(reads)
    answer = {"status": 200, "filed": filed, "proposal": prop, "written": len(fresh_props)}
    return _final(answer, edits, rid, reads, lsid, D.book_id(reads))


# the cells the digest keeper (server/form_digest.py) writes on a ledger row: its claim, its verdict, its release
KEEPER_COLS = ("digest_state", "digest_kind", "digest_category", "digest_dates", "digest_names", "digest_text_chars",
               "digest_text", "digest_json", "digest_error", "digested_at", "doc_kind", "person", "person_id",
               "subject_type", "subject", "person_seen", "person_agree", "mentions", "issued_on", "expires_on",
               "confidence")
KEEP_MAX_ROWS = 200


def digest_keep(sess: L.Session, payload: dict) -> Decision:
    """digestKeep (the digest keeper's own, never a person's): its cells on ledger rows kept in app.edits, carried to
    the sheet by the queue — a row found by its id in the copy as every read lays it; a cell already holding its value
    is not kept again."""
    if (sess.user or {}).get("is_service") is not True:
        return Decision({"status": 403, "message": "This is the digest keeper's own write."})
    p = payload if isinstance(payload, dict) else {}
    ledger = gsjs.trim(gsjs.or_blank(p.get("ledger")))
    rows = p.get("rows")
    if ledger not in D.LEDGERS:
        return Decision({"status": 400, "message": "unknown ledger"})
    lsid = D.LEDGERS[ledger][0]
    house = gsjs.trim(gsjs.or_blank(p.get("house")))
    if house and house != lsid:
        return Decision({"status": 409, "message": f"the keeper's {ledger} house is not the one this door writes"})
    if not isinstance(rows, list) or not rows or len(rows) > KEEP_MAX_ROWS:
        return Decision({"status": 400, "message": f"rows is a list of 1 to {KEEP_MAX_ROWS}"})
    reads = sess.reads
    held = {D._text(raw.get("id")): raw for _rn, raw in D.ledger_raw(reads, ledger) if D._text(raw.get("id"))}
    table = D.TABLED.get(ledger)
    edits: list[dict] = []
    tabled = 0
    missing: list[str] = []
    same = 0
    for item in rows:
        rid = gsjs.trim(gsjs.or_blank((item or {}).get("id"))) if isinstance(item, dict) else ""
        cells = (item or {}).get("cells") if isinstance(item, dict) else None
        if not rid or not isinstance(cells, dict) or not cells:
            return Decision({"status": 400, "message": "each row is {id, cells}"})
        outside = [k for k in cells if k not in KEEPER_COLS]
        if outside:
            return Decision({"status": 400, "message": f"{outside[0]} is not a cell the keeper writes"})
        raw = held.get(rid)
        if raw is None:
            missing.append(rid)
            continue
        changed = {k: gsjs.or_blank(v) for k, v in cells.items() if D._text(raw.get(k)) != D._text(v)}
        if not changed:
            same += 1
            continue
        if table:
            hit = RR.find(reads, table, rid)
            if hit is None:
                missing.append(rid)
                continue
            RR.update(reads, table, hit[0], hit[1], changed, "digest keeper")
            tabled += 1
            continue
        edits.append(_record(reads, lsid, ledger, "edit", "id", rid, changed,
                             before={k: D._text(raw.get(k)) for k in changed}))
    if edits:
        W.gate(reads)
    answer = {"status": 200, "data": {"kept": len(edits) + tabled, "same": same, "missing": missing}}
    if table:
        return Decision(answer, subject=ledger, own=True)
    # cells set by id whatever the copy's age: never deferred on a book Google moved since its copy
    return W.final(answer, edits, ledger)


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {
    "digestScan": digest_scan, "digestDecide": digest_decide, "digestTeach": digest_teach,
    "digestKeep": digest_keep,
}
# the lab's own door decides (_lab_open)
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
BUSY_OF: dict[str, dict[str, Any]] = {a: {"status": 409, "message": BUSY} for a in ACTIONS}


class Store(RR.Store):
    """app.digestlab_writes and app.digestlab_receipts, beside the other apps' own."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="digestlab", label="Decoder lab")
