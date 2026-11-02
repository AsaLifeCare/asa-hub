"""Smart Shopper's writes (Shopper.gs) kept in Postgres alone (app/resource_rows.py): an item saved or removed and its
estimates replaced, each the person's own (hubOwnedGate_ stamps and checks the owner, as the resource gate declares
it); the extra categories kept in the shared finance_config tab's shopCategories row through app.edits. shopEstimate
keeps what its prepare read (shopEstimatePrepare) asked the model; shopperUpload brings shopper_items and shopper_prices
into Postgres as the app is given to Python."""
from __future__ import annotations

import re
from typing import Any, Callable

import finance as FIN
import gsjs
import locations as L
import recon as R
import resource_rows as RR
import sheet_resources as SR
import shopper as SH
import smart_comms as SC
import staff_views
import writes as W
from scope import Defer
from writes import Decision

BUSY = "Somebody else is saving right now — try again."
STALE = "What was read for this change is out of date or was not read here, so nothing was written. Try again."

s_ = gsjs.str_


def _owned(reads: L.Reads) -> None:
    for r in (SH.ITEMS, SH.PRICES):
        if not RR.uploaded(reads.db, r):
            raise Defer(f"{r} is not uploaded to Postgres yet")


def _ok(d: Decision) -> bool:
    return (d.answer or {}).get("status") == 200


def _js_keys(d: dict) -> list[str]:
    """Object.keys order: array-index keys ascending first, then the rest as written."""
    idx = sorted((k for k in d if re.fullmatch(r"0|[1-9][0-9]{0,9}", k) and int(k) < 4294967295), key=int)
    return idx + [k for k in d if k not in idx]


def save(sess: L.Session, payload: dict) -> Decision:
    """shopSave: an item made or edited, its category and status from the lists; what was actually paid kept in its
    own columns, never mixed into an estimate."""
    user = sess.user or {}
    if not SH.may_use(user):
        return Decision(dict(SH.DENIED))
    reads = sess.reads
    _owned(reads)
    p = payload if isinstance(payload, dict) else {}
    name = s_(p.get("name"))
    if not name:
        return W.refuse(400, "What is it you want to buy?")
    category = s_(p.get("category")) if s_(p.get("category")) in SH.categories(reads) else "Other"
    status = s_(p.get("status")) if s_(p.get("status")) in SH.STATUSES else "watching"
    target = FIN.num(p.get("targetPrice"))
    if target < 0:
        return W.refuse(400, "A target price cannot be negative.")
    fields: dict[str, Any] = {"name": name, "category": category, "targetPrice": target, "notes": s_(p.get("notes")),
                              "status": status}
    paid = FIN.num(p.get("paidPrice"))
    if paid > 0:
        fields["paidPrice"] = paid
    if s_(p.get("paidVendor")):
        fields["paidVendor"] = SC._cut16(s_(p.get("paidVendor")), 80)
    if status == "bought":
        fields["boughtAt"] = W.now_iso(reads)
    if s_(p.get("id")):
        rid = s_(p.get("id"))
        done = SR.update_row(sess, SH.ITEMS, {"id": rid, **fields})
        if not _ok(done):
            return done
        return Decision({"status": 200, "data": {"id": rid}}, subject="", own=True)
    made = SR.create_row(sess, SH.ITEMS, fields)
    if not _ok(made):
        return made
    return Decision({"status": 200, "data": {"id": s_(((made.answer or {}).get("data") or {}).get("id"))}},
                    subject="", own=True)


def _drop_prices(sess: L.Session, rid: str) -> None:
    """The person's own estimates of one item removed, each as deleteRowById_ removes it."""
    me = s_((sess.user or {}).get("id"))
    for r in RR.read_all(sess.reads, SH.PRICES):
        if s_(r.get("itemId")) == rid and s_(r.get("ownerId")) == me:
            SR.delete_row(sess, SH.PRICES, {"id": s_(r.get("id"))})


def remove(sess: L.Session, payload: dict) -> Decision:
    """shopRemove: an item and its estimates removed."""
    if not SH.may_use(sess.user):
        return Decision(dict(SH.DENIED))
    _owned(sess.reads)
    rid = s_((payload or {}).get("id")) if isinstance(payload, dict) else ""
    if not rid:
        return W.refuse(400, "Which item?")
    _drop_prices(sess, rid)
    out = SR.delete_row(sess, SH.ITEMS, {"id": rid})
    if not _ok(out):
        return out
    return Decision({"status": 200, "data": {"removed": True}}, subject="", own=True)


def estimate(sess: L.Session, payload: dict) -> Decision:
    """shopEstimate: the typical prices the model named (asked by shopEstimatePrepare, handed in as `prepared`) replace
    the item's old ones — never accumulated, old and new side by side cannot be told apart — and the item is stamped
    checkedAt. Model prices are only ever `estimate`, never `price`, and no URL is kept: none of it was looked up."""
    user = sess.user or {}
    if not SH.may_use(user):
        return Decision(dict(SH.DENIED))
    reads = sess.reads
    _owned(reads)
    p = payload if isinstance(payload, dict) else {}
    rid = s_(p.get("id"))
    if not rid:
        return W.refuse(400, "Which item?")
    row, refused = SH.own_item(reads, user, rid)
    if refused:
        return W.refuse(refused["status"], refused["message"])
    if p.get("prepared") is None:
        raise Defer("shopEstimate is read by its prepare door first")
    got = R.unsealed("shopEstimate", R.actor(user), p.get("prepared"))
    if got is None or s_(got.get("id")) != rid:
        return W.refuse(409, STALE)
    _drop_prices(sess, rid)
    now = W.now_iso(reads)
    via = s_(got.get("via"))
    kept = 0
    for e in got.get("estimates") or []:
        made = SR.create_row(sess, SH.PRICES, {"itemId": rid, "source": s_(e.get("source")),
                                               "estimate": FIN.num(e.get("estimate")), "title": s_(e.get("title")),
                                               "model": via, "foundAt": now})
        # only an estimate that landed is counted as kept
        if _ok(made):
            kept += 1
    SR.update_row(sess, SH.ITEMS, {"id": rid, "checkedAt": now})
    staff_views.record(user, "shopEstimate", s_((row or {}).get("name")))
    return Decision({"status": 200, "data": {"kept": kept, "via": via, "advice": s_(got.get("advice")),
                                             "items": SH.state(reads, user)}}, subject="", own=True)


def settings_set(sess: L.Session, payload: dict) -> Decision:
    """shopSettingsSet (admins): the built-in categories are a floor, and a category still in use cannot be removed;
    the extra ones kept in finance_config's shopCategories row (createRow_ / updateRowById_) through app.edits."""
    user = sess.user or {}
    if not user or user.get("is_service") or s_(user.get("role")) != "admin":
        return Decision(dict(SH.DENIED))
    reads = sess.reads
    _owned(reads)
    p = payload if isinstance(payload, dict) else {}
    wanted: list[str] = []
    for v in p.get("categories") if isinstance(p.get("categories"), list) else []:
        t = gsjs.trim(gsjs.js_str(v))
        if t and t not in wanted:
            wanted.append(t)
    lost = [c for c in SH.CATEGORIES if c not in wanted]
    if lost:
        return W.refuse(400, "These are built in and cannot be removed: " + ", ".join(lost) + ".")
    in_use: dict[str, int] = {}
    for r in RR.read_all(reads, SH.ITEMS):
        c = s_(r.get("category"))
        if c:
            in_use[c] = in_use.get(c, 0) + 1
    orphaned = [c for c in _js_keys(in_use) if c not in wanted]
    if orphaned:
        return W.refuse(409, "Still in use: " + ", ".join(f"{c} ({in_use[c]})" for c in orphaned) + ".")
    value = "|".join(c for c in wanted if c not in SH.CATEGORIES)
    rows = FIN.config_rows(reads)
    row = None
    for r in rows:
        if s_(r.get("key")) == SH.CONFIG_KEY:
            row = r
    res = W.tab_of(reads, FIN.CONFIG_TAB)
    if res.ref is None:
        raise Defer("finance_config holds no tab in the copy")
    now = W.now_iso(reads)
    if row is not None:
        if row.get("id") is None or row.get("id") == "":
            return W.refuse(400, 'Missing required "id" in payload.')
        rid = gsjs.js_str(row.get("id"))
        cells: dict[str, Any] = {"value": value, "updatedAt": now}
        after = [{**r, "value": value} if r is row else r for r in rows]
    else:
        rid = W.mint()
        cells = {"key": SH.CONFIG_KEY, "value": value, "id": rid, "createdAt": now, "updatedAt": now}
        after = rows + [cells]
    if any(k not in res.ref.headers for k in cells):
        raise Defer("a config row naming a column finance_config does not have")
    W.gate(reads)
    sid, tab = W.where_of(res)
    rec = (W.kept_record(sid, tab, "edit", "id", rid, "", cells, before={k: row.get(k, "") for k in cells})
           if row is not None else
           W.kept_record(sid, tab, "append", "id", rid, "", {h: cells.get(h, "") for h in res.ref.headers if h}))
    done = W.final({"status": 200, "data": {"categories": SH.categories_of(after)}}, [rec], "")
    done.fresh = (res.sheet_id,)
    return done


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {
    "shopSave": save, "shopRemove": remove, "shopEstimate": estimate, "shopSettingsSet": settings_set,
    "shopperUpload": RR.upload_door({r: SR.SPECS.get(r) or {"tab": SH.TABS[r]} for r in (SH.ITEMS, SH.PRICES)})}
# per-person: no roles but the settings', each door's own gate decides
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
POLICY["shopSettingsSet"] = {"roles": ("admin",)}
BUSY_OF: dict[str, dict[str, Any]] = {a: {"status": 409, "message": BUSY} for a in ACTIONS}


class Store(RR.Store):
    """app.shopper_writes and _receipts; the items and the estimates app.resource_rows, the categories' cells
    app.edits'."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="shopper", label="Smart Shopper")
