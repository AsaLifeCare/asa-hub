"""The phone-call lane's writes (comm_calls reads and plans), on the two houses Postgres keeps (app/resource_rows.py:
commCalls, commWorkItems). commCallsIngest is the hand-over the relay's live half delivers its read calls to, and
commCallsSweepKeep files what commCallsSweepFetch read through that same ingest: under the platform's write lock, the
door's cleaners and line-refusals, then commCallsUpsert_ (a new id made whole, a moved one patched, nothing else
touched), the feed's stamp in app.comm_calls_state; a pass stops in time and hands what is left back to the relay.
commCallsAttribute is an admin naming the caller of a call and its matters. commCallsUpload brings both houses' copies
into Postgres as the lane is given to Python, and hands them back as it returns to Apps Script."""
from __future__ import annotations

import time
from typing import Any, Callable

import comm_calls as CC
import gsjs
import hubdb
import locations as L
import resource_rows as RR
import sheet_resources as SR
import writes as W
from writes import Decision

PASS_S = 4.0
# the rows one pass makes or changes at most
PASS_ROWS = 500
BUSY = "The calls feed is already running."
ATTRIBUTE_BUSY = "another write is in flight"
NOT_DECLARED = ("The comm_calls houses are not declared — run tools/mint_comm_calls_house.py first. "
                "Nothing was written.")
SERVICE_ONLY = {"status": 403, "message": "This is the relay's own write."}
ADMIN_ONLY = {"status": 403, "message": "Requires an admin or manager account"}
BY = "asa-hub:comm"

s_ = gsjs.str_


class House:
    """One house as commCallsRead_ hands it to commCallsUpsert_, from the rows Postgres keeps, held for the whole
    write: its header, its rows by id, and what this write made and changed so far."""

    def __init__(self, reads: L.Reads, resource: str, header: tuple) -> None:
        self.reads, self.resource = reads, resource
        self.header = [h for h in RR.columns(reads, resource) if h] or list(header)
        self.col = set(self.header)
        self.rows: list[tuple[str, dict]] = []
        self.at: dict[str, int] = {}
        for k, cells in RR.table_rows(reads, resource):
            rid = CC.text(hubdb.typed(cells.get("id"), "raw"))
            if rid and rid not in self.at:
                self.at[rid] = len(self.rows)
            self.rows.append((k, dict(cells)))

    def upsert(self, incoming: list[dict], now: str, started: float | None, budget: list[int]
               ) -> tuple[dict[str, Any], list[dict]]:
        """commCallsUpsert_: (the counts, what this pass left); `started` None runs unbounded, else the pass stops at
        PASS_S or once `budget` (the rows left to it) is spent."""
        if "id" not in self.col:
            return {"error": 'the house lacks an "id" column'}, []
        out = {"inserted": 0, "updated": 0, "unchanged": 0, "writes": 0}
        new: dict[str, dict[str, Any]] = {}
        patched: dict[int, tuple[dict, dict]] = {}
        rest: list[dict] = []
        for i, item in enumerate(incoming):
            if started is not None and (time.monotonic() - started > PASS_S or budget[0] <= 0):
                rest = incoming[i:]
                break
            rid = CC.text(item.get("id"))
            if not rid:
                continue
            if rid in new:
                # a key handed over twice in one payload patches its own new line rather than appending a second one
                for k, v in item.items():
                    if k not in ("id", "createdAt") and k in self.col:
                        new[rid][k] = "" if v is None else v
                continue
            pos = self.at.get(rid)
            if pos is None:
                line = {h: "" for h in self.header}
                line["id"] = rid
                for stamp in ("createdAt", "updatedAt"):
                    if stamp in self.col:
                        line[stamp] = now
                for k, v in item.items():
                    if k != "id" and k in self.col:
                        line[k] = v
                new[rid] = line
                out["inserted"] += 1
                budget[0] -= 1
                continue
            cur = self.rows[pos][1]
            changed, before = patched.get(pos, ({}, dict(cur)))
            touched = False
            for k, v in item.items():
                # the day this call first landed is not this pass's to forget
                if k in ("id", "createdAt") or k not in self.col:
                    continue
                v = "" if v is None else v
                if CC.text(cur.get(k)) != CC.text(v):
                    cur[k] = changed[k] = v
                    touched = True
            if touched:
                if "updatedAt" in self.col:
                    cur["updatedAt"] = changed["updatedAt"] = now
                patched[pos] = (changed, before)
                out["updated"] += 1
                budget[0] -= 1
            else:
                out["unchanged"] += 1
        runs = sorted(patched)
        out["writes"] = sum(1 for j, p in enumerate(runs) if j == 0 or runs[j - 1] != p - 1) + (1 if new else 0)
        RR.update_many(self.reads, self.resource,
                       [(self.rows[p][0], before, {k: W.sheet_text(v) for k, v in changed.items()})
                        for p, (changed, before) in sorted(patched.items())], BY)
        lines = [{k: W.sheet_text(v) for k, v in line.items()} for line in new.values()]
        for rid, k, line in zip(new, RR.create_many(self.reads, self.resource, lines, BY), lines):
            self.at[rid] = len(self.rows)
            self.rows.append((k, line))
        return out, rest


def _house(reads: L.Reads, held: dict[str, House], resource: str) -> House:
    if resource not in held:
        held[resource] = House(reads, resource, CC.CALLS_HEADER if resource == CC.CALLS_RES else CC.ITEMS_HEADER)
    return held[resource]


def _counts(v: Any) -> dict[str, int]:
    t = v if isinstance(v, dict) else {}
    out = {}
    for k in ("inserted", "updated", "unchanged", "writes"):
        try:
            out[k] = max(0, int(t.get(k) or 0))
        except (TypeError, ValueError):
            out[k] = 0
    return out


def _tally(v: dict) -> dict[str, Any]:
    """The hand-over's counts as a later pass of it is handed them."""
    out: dict[str, Any] = {}
    for k in ("received_calls", "received_items", "kept_calls", "kept_items", "refused", "overflow", "rows"):
        try:
            out[k] = max(0, int(v.get(k) or 0))
        except (TypeError, ValueError):
            out[k] = 0
    out["calls"], out["items"] = _counts(v.get("calls")), _counts(v.get("items"))
    out["dropped_columns"] = [s_(c) for c in (v.get("dropped_columns") or []) if isinstance(c, str)]
    out["at"] = CC.instant(v.get("at")) or CC.now_iso()
    return out


def _stamp(at: str, rows: int) -> None:
    """hubPropSet_ of the feed's stamp and row count: a convenience, never the write's failure."""
    cur = W.HELD.get()
    if cur is None:
        return
    cur.execute("select to_regclass(%s)", (CC.STATE,))
    got = cur.fetchone()
    if not got or got[0] is None:
        return
    cur.execute(f"insert into {CC.STATE} (key, value) values (%s, %s), (%s, %s) on conflict (key) do update"
                " set value = excluded.value, updated_at = now()", (CC.FEED_STAMP, at, CC.FEED_ROWS, str(rows)))


def _moved(t: dict[str, Any]) -> int:
    return t["calls"]["inserted"] + t["calls"]["updated"] + t["items"]["inserted"] + t["items"]["updated"]


def _said(t: dict[str, Any]) -> None:
    """The hand-over's log lines: the refused names, loud and by name only; what moved."""
    if t["dropped_columns"]:
        CC.log_line("comm_calls_columns_refused", ", ".join(t["dropped_columns"]))
    if _moved(t) or t["overflow"]:
        refused = t["refused"]
        CC.log_line("comm_calls_ingested",
                    f"{t['calls']['inserted']} call(s) added, {t['calls']['updated']} patched · "
                    f"{t['items']['inserted']} matter(s) added, {t['items']['updated']} patched · "
                    f"{t['calls']['writes'] + t['items']['writes']} write(s)"
                    + (f" · {refused} row(s) refused" if refused else "")
                    + (f" · {t['overflow']} past the cap, not seen" if t["overflow"] else ""))


def _answer(t: dict[str, Any]) -> dict[str, Any]:
    return {"received_calls": t["received_calls"], "received_items": t["received_items"],
            "kept_calls": t["kept_calls"], "kept_items": t["kept_items"], "refused": t["refused"],
            "overflow": t["overflow"], "calls": t["calls"], "items": t["items"], "converged": _moved(t) == 0,
            "dropped_columns": t["dropped_columns"], "at": t["at"]}


def ingest_pass(reads: L.Reads, held: dict[str, House], payload: dict, bounded: bool) -> dict[str, Any]:
    """commCallsIngest's body. A first pass cleans and counts the whole hand-over; one the relay hands back (`tally`)
    carries on with the rows already cleaned. `left` in the answer while rows remain."""
    p = payload if isinstance(payload, dict) else {}
    calls = p.get("calls") if isinstance(p.get("calls"), list) else []
    items = p.get("items") if isinstance(p.get("items"), list) else []
    if not calls and not items:
        return {"status": 200, "data": {"wrote": 0, "converged": True, "note": "nothing was handed over"}}
    # the pointer is the permission
    if not CC.declared(reads, CC.CALLS_TAB) or not CC.declared(reads, CC.ITEMS_TAB):
        return {"status": 503, "message": NOT_DECLARED}
    if isinstance(p.get("tally"), dict):
        t = _tally(p["tally"])
        at = t["at"]
        clean_calls = [c for c in (CC.clean_call(r, at) for r in calls) if c]
        clean_items = [c for c in (CC.clean_item(r, at) for r in items) if c]
    else:
        # the line, checked before anything is shaped
        dropped = CC.crossed(calls) + CC.crossed(items)
        at = CC.instant(p.get("source_at")) or CC.now_iso()
        clean_calls, seen, refused_calls = [], set(), 0
        for r in calls:
            if len(clean_calls) >= CC.CALLS_INGEST_CAP:
                break
            c = CC.clean_call(r, at)
            if not c or c["id"] in seen:
                refused_calls += 1
                continue
            seen.add(c["id"])
            clean_calls.append(c)
        clean_items, seen, refused_items = [], set(), 0
        for r in items:
            if len(clean_items) >= CC.ITEMS_INGEST_CAP:
                break
            c = CC.clean_item(r, at)
            if not c or c["id"] in seen:
                refused_items += 1
                continue
            seen.add(c["id"])
            clean_items.append(c)
        overflow = max(0, len(calls) - refused_calls - len(clean_calls)) + \
            max(0, len(items) - refused_items - len(clean_items))
        if not clean_calls and not clean_items:
            return {"status": 400, "message": "No usable row — a call needs an id and a read state."}
        t = _tally({"received_calls": len(calls), "received_items": len(items), "kept_calls": len(clean_calls),
                    "kept_items": len(clean_items), "refused": refused_calls + refused_items, "overflow": overflow,
                    "dropped_columns": dropped, "at": at})
    now = CC.now_iso()
    started = time.monotonic() if bounded else None
    budget = [PASS_ROWS]
    left_calls: list[dict] = []
    left_items = clean_items
    if clean_calls:
        house = _house(reads, held, CC.CALLS_RES)
        got, left_calls = house.upsert(clean_calls, now, started, budget)
        if got.get("error"):
            return {"status": 400, "message": got["error"]}
        t["calls"] = {k: t["calls"][k] + got[k] for k in t["calls"]}
        t["rows"] = len(house.rows)
    if clean_items and not left_calls:
        got, left_items = _house(reads, held, CC.ITEMS_RES).upsert(clean_items, now, started, budget)
        if got.get("error"):
            return {"status": 400, "message": got["error"]}
        t["items"] = {k: t["items"][k] + got[k] for k in t["items"]}
    _stamp(at, t["rows"])
    if left_calls or left_items:
        return {"status": 200, "data": {**_answer(t), "left": {"calls": left_calls, "items": left_items,
                                                                "source_at": at, "tally": t}}}
    _said(t)
    return {"status": 200, "data": _answer(t)}


def ingest(sess: L.Session, payload: dict) -> Decision:
    """commCallsIngest: the hand-over, the relay's (or an admin's), a pass at a time."""
    user = sess.user or {}
    if not user.get("is_service") and s_(user.get("role")) != "admin":
        return Decision(dict(CC.DENIED))
    CC.owned(sess.reads)
    env = ingest_pass(sess.reads, {}, payload, True)
    return Decision(env, subject="", own=env.get("status") == 200)


def sweep_keep(sess: L.Session, payload: dict) -> Decision:
    """commCallsSweep_'s filing half (the relay's own): each call commCallsSweepFetch read handed to the ingest as
    commCallsClassifyNow_ hands it, a few at a time; the sweep's answer and its log line once none is left."""
    if (sess.user or {}).get("is_service") is not True:
        return Decision(dict(SERVICE_ONLY))
    reads = sess.reads
    CC.owned(reads)
    p = payload if isinstance(payload, dict) else {}
    plans = [x for x in (p.get("plans") or []) if isinstance(x, dict) and isinstance(x.get("ingest"), dict)]
    tally = CC.sweep_tally(p.get("tally"))
    held: dict[str, House] = {}
    left: list[dict] = []
    started = time.monotonic()
    for i, plan in enumerate(plans):
        if time.monotonic() - started > PASS_S:
            left = plans[i:]
            break
        if ingest_pass(reads, held, plan["ingest"], False).get("status") == 200:
            tally["classified"] += 1
            try:
                tally["items"] += max(0, int(plan.get("items") or 0))
            except (TypeError, ValueError):
                pass
        else:
            tally["failed"] += 1
            tally["failures"].append(CC.cut(s_(plan.get("call_id")), 12) + ": ")
    data: dict[str, Any] = CC.sweep_answer(tally)
    if left:
        data.update(left=left, tally=tally)
    else:
        CC.sweep_said(tally)
    return Decision({"status": 200, "data": data}, subject="", own=True)


def attribute(sess: L.Session, payload: dict) -> Decision:
    """commCallsAttribute: an admin names the caller — a person's decision, written as one, on the call and on every
    matter it carried."""
    user = sess.user or {}
    if user.get("is_service") or s_(user.get("role")) != "admin":
        return Decision(dict(ADMIN_ONLY))
    p = payload if isinstance(payload, dict) else {}
    call_id = CC.cut(CC.text(p.get("call_id")), 60)
    name = CC.cut(CC.text(p.get("name")), 120)
    if not call_id or not name:
        return Decision({"status": 400, "message": "call_id and name are required"})
    reads = sess.reads
    if not CC.declared(reads, CC.CALLS_TAB) or not CC.declared(reads, CC.ITEMS_TAB):
        return Decision({"status": 503, "message": "The comm_calls houses are not declared."})
    CC.owned(reads)
    who = s_(gsjs.or_text(user.get("email")) or gsjs.or_text(user.get("id")) or "admin")
    at = CC.now_iso()
    pk = CC.key(name)

    def patch(resource: str, rid: str, fields: dict[str, str]) -> bool:
        """patchRow_: the first row with this id, only the fields its header holds."""
        hit = RR.find(reads, resource, rid)
        if hit is None:
            return False
        cols = set(RR.columns(reads, resource))
        RR.update(reads, resource, hit[0], hit[1], {f: v for f, v in fields.items() if f in cols}, who)
        return True

    if not patch(CC.CALLS_RES, "CC_" + call_id, {"name": name, "person_key": pk, "name_from": "manual",
                                                  "name_why": f"chosen by {who} at {at}", "updatedAt": at}):
        return Decision({"status": 404, "message": "no call row for that call_id"})
    cols = RR.columns(reads, CC.ITEMS_RES)
    mine = [s_(r.get("id")) for r in (RR.shown(cols, c) for _k, c in RR.table_rows(reads, CC.ITEMS_RES))
            if r is not None and s_(r.get("call_id")) == call_id]
    patched = sum(1 for rid in mine if patch(CC.ITEMS_RES, rid, {"concerns_name": name, "concerns_person_key": pk,
                                                                  "name_from": "manual", "updatedAt": at}))
    CC.log_line("comm_calls_attributed", f"{call_id} named {name} by {who}")
    return Decision({"status": 200, "data": {"call_id": call_id, "name": name, "name_from": "manual",
                                             "items_patched": patched, "at": at}}, subject="", own=True)


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {
    "commCallsIngest": ingest, "commCallsSweepKeep": sweep_keep, "commCallsAttribute": attribute,
    "commCallsUpload": RR.upload_door({CC.CALLS_RES: SR.SPECS.get(CC.CALLS_RES) or {"tab": CC.CALLS_TAB},
                                       CC.ITEMS_RES: SR.SPECS.get(CC.ITEMS_RES) or {"tab": CC.ITEMS_TAB}})}
# HUB_POLICY.commCallsIngest (admins, the relay) and commCallsAttribute (admins); the keep and the upload: the relay's
POLICY: dict[str, dict[str, Any]] = {
    "commCallsIngest": {"roles": ("admin",), "params": {"calls": "array", "items": "array", "source_at": "string"}},
    "commCallsAttribute": {"roles": ("admin",), "params": {"call_id": "string", "name": "string"}},
    "commCallsSweepKeep": {}, "commCallsUpload": {}}
BUSY_OF: dict[str, dict[str, Any]] = {"commCallsIngest": {"status": 409, "message": BUSY},
                                      "commCallsSweepKeep": {"status": 409, "message": BUSY},
                                      "commCallsAttribute": {"status": 409, "message": ATTRIBUTE_BUSY},
                                      "commCallsUpload": {"status": 409, "message": BUSY}}


class Store(RR.Store):
    """app.comm_calls_writes and _receipts; the houses app.resource_rows', the feed's stamp app.comm_calls_state."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="comm_calls", label="The phone-call lane")
