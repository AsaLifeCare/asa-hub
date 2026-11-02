"""hotlineSweep's one-call path (Hotline.gs) for a call kept in app.hotline_calls: the support queue's rows, the Call
Offs, the incidents and the daily notes the model's answer reads into, the audit line, the inbox's Processed cell, the
call-off queue Smart Comms speaks from, the request types the call coins and the pages it owes (hotline_comms) — every
row kept in app.edits under one write, each page raised in it, the call marked filed in the same transaction.
`filing` builds it all and keeps nothing (the shadow shows it)."""
from __future__ import annotations

import json
import os
import re
from typing import Any

import call_offs as CO
import call_offs_writes as COW
import gsjs
import hotline as H
import hotline_calloff as HCO
import hotline_comms as HC
import house_tables as HT
import hubdb
import locations as L
import names as N
import smart_comms_desk as SCD
import writes as W
from writes import HELD, Decision

CALLS = H.CALLS
SEP = "\x1f"
# the passes a call no model would answer is asked again before it stays blocked on the desk
BLOCKED_TRIES = max(1, int(os.getenv("HUB_HOTLINE_BLOCKED_TRIES") or 6))
NO_WORDS_WHY = "no words past a greeting"
LEARN_MAX_PER_PASS = 3
TYPE_FILLER = frozenset({"request", "for", "of", "the", "a", "an", "to", "and"})
LOG_TAB = "hotline_log"
CALLOFF_QUEUE_TAB = "hotline_calloff_queue"
TRANSCRIPTS_TAB = "Transcripts"
TRANSCRIPT_ID_HEAD = "Call ID"
TRANSCRIPT_DONE_HEAD = "Processed"
# Estate.gs ESTATE_SOURCES for the three lanes the sweep appends to, and the columns that find each row again
ESTATE = {"supportQueue": ("EMP360_WORK_QUEUE_ID", "Requests", ("notes", "type_of_request", "description_of_request")),
          "uiIncidents": ("ESTATE_UI_ID", "UIs and MUIs", ("timestamp", "your_name", "summary_of_incident")),
          "dailyNotes": ("ESTATE_NOTES_ID", "Notes", ("call_id", "client_name", "category"))}
DENIED = {"status": 403, "message": "The hotline's calls are filed by the relay alone."}

s_ = H.s_


# ---- learning a request type (hotlineRequestTypeLearn_ and its checks) ---------------------------------------------

def type_shape(raw: Any) -> bool:
    """hotlineRequestTypeShape_: 'Area - Label', short, in plain words, neither half a placeholder."""
    text = "" if raw is None else str(raw)
    if re.search(r"[\r\n]", text):
        return False
    t = H.type_norm(text)
    if not t or len(t) > H.REQUEST_TYPE_MAX or not re.fullmatch(r"[A-Za-z0-9 &/'(),.+-]+", t):
        return False
    parts = t.split(" - ")
    if len(parts) != 2:
        return False
    area, label = parts
    if not re.fullmatch(r"[A-Za-z][A-Za-z0-9&/]*(?: [A-Za-z0-9&/]+){0,2}", area) or \
            not re.search(r"[A-Za-z]{2}", label):
        return False
    if area.lower() != "other" and H._PLACEHOLDER.search(area):
        return False
    return not H._PLACEHOLDER.search(label)


def _type_words(label: str, area: str) -> list[str]:
    area_words = [H._type_word(w) for w in re.split(r"[^a-z0-9]+", area.lower()) if w]
    return [w for w in (H._type_word(x) for x in re.split(r"[^a-z0-9]+", label.lower()) if x)
            if w not in TYPE_FILLER and w not in area_words]


def type_near(a: Any, b: Any) -> bool:
    """hotlineRequestTypeNear_: the same area, and labels a word or a typo apart."""
    ta, tb = H.type_norm(a), H.type_norm(b)
    ca, cb = ta.find(" - "), tb.find(" - ")
    if ca == -1 or cb == -1:
        return False
    area_a, area_b = ta[:ca], tb[:cb]
    wa, wb = _type_words(ta[ca + 3:], area_a), _type_words(tb[cb + 3:], area_b)
    if not wa or not wb or H._type_half(area_a.lower()) != H._type_half(area_b.lower()):
        return False
    ja, jb = "".join(wa), "".join(wb)
    if ja == jb:
        return True
    if abs(len(wa) - len(wb)) == 1:
        longer, shorter = (wa, wb) if len(wa) > len(wb) else (wb, wa)
        if any(" ".join(longer[:i] + longer[i + 1:]) == " ".join(shorter) for i in range(len(longer))):
            return True
    if re.sub(r"[^0-9]", "", ja) != re.sub(r"[^0-9]", "", jb):
        return False
    shortest = min(len(ja), len(jb))
    allowed = 2 if shortest >= 8 else 1 if shortest >= 5 else 0
    return allowed > 0 and N.lev(ja, jb) <= allowed


def learn(coined: list[dict], book: list[dict]) -> dict[str, Any]:
    """hotlineLearnAfterPass_: at most three coined types become vocabulary; a known one, a call-off look-alike, a
    bad shape or a near twin of one already there is filed as written and never learned."""
    out: dict[str, Any] = {"learned": [], "refused": [], "capped": 0}
    have = list(H.REQUEST_TYPES_FLOOR) + [s_(r.get("type")) for r in book]
    for i, c in enumerate(coined):
        if len(out["learned"]) >= LEARN_MAX_PER_PASS:
            out["capped"] = len(coined) - i
            break
        t = H.type_norm(c["type"])
        k = H.type_key(t)
        why = ""
        if not t:
            why = "empty"
        elif any(H.type_key(x) == k for x in have):
            why = "known"
        elif H.call_offish(t):
            why = "call_off_twin"
        elif not type_shape(c["type"]):
            why = "shape"
        else:
            twin = next((x for x in have if x and type_near(t, x)), "")
            if twin:
                why = "near_known: " + H.type_norm(twin)
        if why:
            out["refused"].append({"type": t, "why": why})
            continue
        out["learned"].append({"type": t, "call_id": c["call_id"]})
        have.append(t)
    return out


# ---- where each row goes ------------------------------------------------------------------------------------------

def _estate(reads: L.Reads, resource: str) -> tuple[str, str, tuple]:
    prop, tab, _match = ESTATE[resource]
    sid = gsjs.trim(reads.db.prop(prop))
    if not sid:
        raise hubdb.Unreadable(f"no {prop} is declared in the depot")
    ref = reads.tab_of(sid, tab, f"the estate's {tab}")
    if ref is None:
        raise W.Defer(f"the estate book behind {resource} holds no {tab} tab in the copy")
    return sid, ref.tab, ref.headers


def _estate_rows(reads: L.Reads, resource: str, objs: list[dict], subject: str) -> list[dict]:
    """hotlineEstateAppendRows_: each object's keys laid on the tab's headers by estateKey_, one append each."""
    if not objs:
        return []
    sid, tab, headers = _estate(reads, resource)
    head_of = {hubdb.estate_key(h): h for h in headers if h}
    match_keys = ESTATE[resource][2]
    if any(k not in head_of for k in match_keys):
        raise W.Defer(f"the {tab} tab lost a column its rows are found by")
    match = W.COLS + W.COLS_SEP.join(head_of[k] for k in match_keys)
    out = []
    for o in objs:
        cells = {head_of[k]: v for k, v in o.items() if k in head_of and not k.startswith("_")}
        key = SEP.join(W.sheet_text(cells.get(head_of[k], "")) for k in match_keys)
        out.append(W.kept_record(sid, tab, "append", match, key, subject, cells))
    return out


def _hub_tab(reads: L.Reads, tab: str) -> tuple[str, str, tuple]:
    # a house kept in its own table: its columns, and its writes laid there (writes.into_tables)
    res = HT.where(reads, tab) if HT.tabled(tab) else W.tab_of(reads, tab)
    if res.ref is None:
        raise W.Defer(f"the copy holds no {tab} tab")
    sid, name = W.where_of(res)
    return sid, name, res.ref.headers


def _hub_append(reads: L.Reads, tab: str, rec: dict, match_heads: tuple[str, ...], subject: str) -> dict:
    sid, name, headers = _hub_tab(reads, tab)
    if any(h not in headers for h in match_heads) or any(k not in headers for k in rec):
        raise W.Defer(f"{tab} lacks a column the hotline writes; Apps Script grows the header")
    key = SEP.join(W.sheet_text(rec.get(h, "")) for h in match_heads)
    return W.kept_record(sid, name, "append", W.COLS + W.COLS_SEP.join(match_heads), key, subject, rec)


def _team_match(cells: list[str], want: Any) -> bool:
    """hotlineTeamMatch_."""
    w = re.sub(r"\D", "", s_(want))
    return bool(w) and any(re.sub(r"\D", "", p) == w for c in cells for p in re.split(r"[,;|/]+", s_(c)))


def _e164(v: Any) -> str:
    """hubPhoneE164_."""
    s = s_(v)
    d = re.sub(r"\D", "", s)
    return "+1" + d if len(d) == 10 else "+" + d if len(d) == 11 and d[0] == "1" else s


def house_manager(reads: L.Reads, location: str) -> dict[str, str] | None:
    """hotlineHouseManager_: the most recent ** row of the location on the hotline calendar."""
    if not location:
        return None
    try:
        sid = gsjs.trim(reads.db.prop("HOTLINE_CALENDAR_ID"))
        ref = reads.tab_of(sid, H.CALENDAR_TAB, "the hotline calendar") if sid else None
        got = L.managers_by_house(reads.db.grid(ref), reads.today()).get(location) if ref is not None else None
    except Exception:  # noqa: BLE001 - no manager found is an honest answer
        return None
    return {"name": s_(got["anchor"]["name"]), "phone": s_(got["anchor"]["phone"])} if got else None


def _filed_by_apps_script(reads: L.Reads, call_id: str) -> bool:
    """hotlineFiledCallIds_: the audit holds the call as processed."""
    res = HT.where(reads, LOG_TAB)
    rows = HT.normalized(reads, res.ref)
    return any(s_(r.get("callid")) == call_id and s_(r.get("status")).lower() == "processed" for r in rows)


def _inbox_marks(reads: L.Reads, call_id: str, subject: str) -> list[dict]:
    """hotlineInboxMark_: the inbox row of the call, its Processed cell still empty, marked Yes."""
    sid = gsjs.trim(reads.db.prop("HOTLINE_TRANSCRIPTS_ID"))
    ref = reads.tab_of(sid, TRANSCRIPTS_TAB, "the hotline's transcripts") if sid else None
    if ref is None or TRANSCRIPT_ID_HEAD not in ref.headers or TRANSCRIPT_DONE_HEAD not in ref.headers:
        return []
    for _rn, raw in reads.db.rows(ref):
        if s_(hubdb.typed(raw.get(TRANSCRIPT_ID_HEAD), "raw")) != call_id:
            continue
        if s_(hubdb.typed(raw.get(TRANSCRIPT_DONE_HEAD), "raw")):
            return []
        return [W.kept_record(sid, ref.tab, "edit", W.COLS + TRANSCRIPT_ID_HEAD, call_id, subject,
                              {TRANSCRIPT_DONE_HEAD: "Yes"}, before={TRANSCRIPT_DONE_HEAD: ""})]
    return []


# ---- the filing -----------------------------------------------------------------------------------------------------

def filing(reads: L.Reads, call: dict[str, Any], content: Any, via: Any, psi: Any = None,
           speak: bool = False) -> dict[str, Any]:
    """Everything the sweep files for one call, as app.edits records, and what it would say about it."""
    call_id = s_(call.get("call_id"))
    cfg = H.config(reads)
    out: dict[str, Any] = {"call_id": call_id, "edits": [], "kinds": [], "items": 0, "state": "",
                           "config_from": cfg["config_from"], "prompt_from": cfg["prompt_from"]}
    if s_(cfg.get("enabled")).lower() != "on":
        out["state"] = "disabled"
        return out
    if not _team_match(call.get("team") or [], cfg.get("team_phone")):
        out["state"] = "not_this_line"
        return out
    ctx = H.context(reads)
    items = H.parse(content)
    call_ts = H._instant(call.get("event_at"))
    facts = {"call_ts": call_ts, "caller_phone": ", ".join(call.get("caller_phones") or []),
             "reporting_date": H.reporting_day(call_ts), "psi": H.psi_verdict(psi)}
    plan = H.plan(reads, call, items, facts, ctx)
    now = W.now_iso(reads)
    edits: list[dict] = []
    edits += _estate_rows(reads, "supportQueue", plan["requests"], call_id)
    queue: list[dict] = []
    for i, co in enumerate(plan["call_offs"]):
        rec = dict(co["row"], timestamp=now, id=W.mint(), createdAt=now, updatedAt=now)
        res = W.tab_of(reads, CO.TAB)
        if res.ref is None:
            raise W.Defer("the Call Offs house holds no tab in the copy")
        sid, tab = W.where_of(res)
        if any(k not in res.ref.headers for k in rec):
            raise W.Defer("a call-off naming a column the Call Offs tab does not have")
        edits.append(W.kept_record(sid, tab, "append", "id", rec["id"], call_id,
                                   {h: COW.serialize(rec.get(h)) for h in res.ref.headers if h and h in rec}))
        mgr = house_manager(reads, co["location"])
        manager = (mgr["name"] + (" " + _e164(mgr["phone"]) if mgr["phone"] else "")) if mgr else ""
        co["manager"] = manager
        queue.append({"instance": co["instance"],
                      "employee": (co["row"]["employee_name"] if co["row"]["name_from"] else "") or "Unknown employee",
                      "date": co["row"]["date"], "reason": (co["row"]["notes"] or "No reason given")[:300],
                      "location": co["location"] or "unknown location", "manager": manager, "queued_at": now})
    for q in queue:
        edits.append(_hub_append(reads, CALLOFF_QUEUE_TAB, q, ("instance",), call_id))
    # each call-off answered and heard by Scheduling (hotline_calloff); its pages raised only when `speak`
    token = HCO.SPEAK.set(speak)
    try:
        for co in plan["call_offs"]:
            notes = co["row"]["notes"]
            call_day = SCD.call_off_date(co["row"]["date"])
            place = {"manager": co.get("manager", ""), "house": co["location"], "reason": notes,
                     "shift_day": HCO.shift_day_from(notes, call_day), "day_from_call": True}
            rec = HCO.recorded(reads, co["row"], co["instance"], place, call_day, call_id)
            edits += rec["edits"]
            co["said"] = rec["said"]
    finally:
        HCO.SPEAK.reset(token)
    edits += _estate_rows(reads, "uiIncidents", plan["incidents"], call_id)
    edits += _estate_rows(reads, "dailyNotes", plan["daily_notes"], call_id)
    kinds = list(plan["kinds"])
    if plan["notes_capped"]:
        kinds.append(f"+{plan['notes_capped']} capped")
    edits.append(_hub_append(reads, LOG_TAB, {
        "call_id": call_id, "at": now, "caller": facts["caller_phone"], "items": str(len(items)),
        "kinds": ",".join(kinds), "status": "processed", "via": s_(via)}, ("call_id", "status"), call_id))
    # a type nobody listed is learned once the rows are kept: the queue's own spelling, never a call-off's
    offered = {H.type_key(t) for t in ctx["request_types"]}
    coined: list[dict] = []
    for r in plan["requests"]:
        k = H.type_key(r["type_of_request"])
        if r["type_of_request"] == H.CALL_OFF_TYPE or not k or k in offered:
            continue
        offered.add(k)
        coined.append({"type": H.type_norm(r["type_of_request"]), "call_id": call_id})
    grown = learn(coined, H._types_book(reads)) if coined else {"learned": [], "refused": [], "capped": 0}
    if grown["learned"]:
        sid = gsjs.trim(reads.db.prop("HUB_GENERIC_CONFIG_ID"))
        ref = HT.tab_of(reads, sid, H.REQUEST_TYPES_TAB, "the CommRequestTypes book") if sid else None
        if ref is None or any(h not in ref.headers for h in ("type", "source", "added_at", "call_id")):
            grown["refused"] += [{"type": g["type"], "why": "no_tab"} for g in grown["learned"]]
            grown["learned"] = []
        else:
            for g in grown["learned"]:
                edits.append(W.kept_record(sid, ref.tab, "append", W.COLS + "type", g["type"], call_id,
                                           {"type": g["type"], "source": "hotline", "added_at": now,
                                            "call_id": g["call_id"]}))
    marks = _inbox_marks(reads, call_id, call_id)
    edits += marks
    owed = HC.pages(reads, call_id, plan["requests"], plan["incidents"], lambda loc: house_manager(reads, loc))
    out.update(state="filed", edits=edits, kinds=kinds, items=len(items), plan=plan, call_off_queue=queue,
               types=grown, inbox_marked=bool(marks), reporting_date=facts["reporting_date"], at=now, pages=owed,
               psi=HC.psi_plan(reads, call_id, plan["requests"]))
    return out


def preview(f: dict[str, Any]) -> dict[str, Any]:
    """A filing as the shadow keeps it: each row's lane and cells, nothing kept."""
    return {"state": f["state"], "kinds": f["kinds"], "items": f["items"], "types": f.get("types"),
            "inbox_marked": f.get("inbox_marked", False), "call_offs": (f.get("plan") or {}).get("call_offs", []),
            "rows": [{"tab": e["tab_name"], "kind": e["kind"], "cells": e["cells"]} for e in f["edits"]],
            "pages": HC.preview(f["pages"]) if f.get("pages") else None,
            "psi": HC.psi_preview(f.get("psi") or [])}


def _cur() -> Any:
    cur = HELD.get()
    if cur is None:
        raise W.NotKept("a call is filed only under the platform's write lock")
    return cur


def _settle(reads: L.Reads, cur: Any, call_id: str, settle: str, why: str, filing_was: Any) -> Decision:
    """A call no model is asked about (no words past a greeting) is filed with nothing in it; a call no model would
    answer counts its passes and, at BLOCKED_TRIES, stays blocked — both written to the audit as the desk reads it,
    and marked so the inbox pass leaves them."""
    call = H.call_of(reads, call_id) or {}
    if settle == "no_words":
        if not H.no_words(call):
            return W.refuse(409, f"{call_id} holds words past a greeting: the model reads it.")
        kept, status, via = {"state": "nothing_to_file", "why": NO_WORDS_WHY}, "processed", NO_WORDS_WHY
    else:
        was = filing_was if isinstance(filing_was, dict) else json.loads(filing_was or "{}")
        tries = int(was.get("tries") or 0) + 1 if was.get("state") == "retrying" else 1
        if tries < BLOCKED_TRIES:
            cur.execute(f"update {CALLS} set filing = %s::jsonb where call_id = %s",
                        (json.dumps({"state": "retrying", "tries": tries, "why": why}), call_id))
            return Decision({"status": 200, "data": {"call_id": call_id, "state": "retrying", "tries": tries}},
                            subject=call_id, own=True)
        kept, status, via = {"state": "blocked", "tries": tries, "why": why}, "blocked", why
    cur.execute(f"update {CALLS} set filed_at = now(), filing = %s::jsonb where call_id = %s",
                (json.dumps(kept), call_id))
    caller = ", ".join(call.get("caller_phones") or [])
    edit = _hub_append(reads, LOG_TAB, {"call_id": call_id, "at": W.now_iso(reads), "caller": caller, "items": "0",
                                        "kinds": "",
                                        "status": status, "via": via}, ("call_id", "status"), call_id)
    return W.final({"status": 200, "data": {"call_id": call_id, **kept}}, [edit], call_id)


def file(sess: L.Session, payload: dict) -> Decision:
    """hotlineFile: one kept call filed from the model's answer — its rows in app.edits and the call marked filed in
    the same transaction; a call already filed (here or by Apps Script's audit) files nothing."""
    if (sess.user or {}).get("is_service") is not True:
        return Decision(DENIED)
    p = payload if isinstance(payload, dict) else {}
    call_id = s_(p.get("call_id"))
    if not H.CALL_ID.fullmatch(call_id):
        return W.refuse(400, "call_id: an AC call id.")
    settle = s_(p.get("settle"))
    if settle not in ("", "no_words", "blocked"):
        return W.refuse(400, "settle: no_words or blocked.")
    if not settle and not s_(p.get("content")):
        return W.refuse(400, "content: the model's answer.")
    reads = sess.reads
    cur = _cur()
    cur.execute(f"select filed_at, filing from {CALLS} where call_id = %s for update", (call_id,))
    got = cur.fetchone()
    if got is None:
        return W.refuse(404, f"No call {call_id} is kept.")
    if got[0] is not None:
        return Decision({"status": 200, "data": {"call_id": call_id, "state": "already_filed"}}, subject=call_id,
                        own=True)
    if settle:
        return _settle(reads, cur, call_id, settle, s_(p.get("why")), got[1])
    if _filed_by_apps_script(reads, call_id):
        cur.execute(f"update {CALLS} set filed_at = now(), filing = %s::jsonb where call_id = %s",
                    (json.dumps({"state": "filed_by_apps_script"}), call_id))
        return Decision({"status": 200, "data": {"call_id": call_id, "state": "filed_by_apps_script"}},
                        subject=call_id, own=True)
    W.gate(reads)
    f = filing(reads, H.call_of(reads, call_id) or {}, p.get("content"), p.get("via"), p.get("psi"), speak=True)
    # each page decided in this write (smart_comms.deciding): a filing that is not kept sends nothing
    at_ms = int(reads.now.timestamp() * 1000)
    told = HC.say(f["pages"], at_ms) if f.get("pages") else []
    # what each PSI caller and the outage list were told; the outage hour is read back off these
    psi = HC.psi_say(f.get("psi") or [], at_ms)
    kept = {"state": f["state"], "kinds": f["kinds"], "items": f["items"], "via": s_(p.get("via")),
            "types": f.get("types"), "inbox_marked": f.get("inbox_marked", False), "told": told, "psi": psi,
            "not_told": (f.get("pages") or {}).get("why", []),
            "call_offs": [{"instance": c["instance"], "location": c["location"], "manager": c.get("manager", ""),
                           "said": c.get("said")}
                          for c in (f.get("plan") or {}).get("call_offs", [])]}
    cur.execute(f"update {CALLS} set filed_at = now(), filing = %s::jsonb where call_id = %s",
                (json.dumps(kept), call_id))
    answer = {"status": 200, "data": {"call_id": call_id, **kept}}
    if not f["edits"]:
        return Decision(answer, subject=call_id, own=True)
    return W.final(answer, f["edits"], call_id)
