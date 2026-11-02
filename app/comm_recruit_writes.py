"""The recruiters' book's doors on Python (CommRecruit.gs), the relay's own: recruitBookIngest writes one changed tab of
their book into its house — in Postgres (app/resource_rows.py), the whole tab: the house then holds exactly that
header and those rows, each row by its id, only the cells that moved written; recruitTell says the texts the relay's
plan owes, each through the one send door (comms_rpc.call, rpcCall_'s answers under Apps Script's own idempotency keys)
and its ledger line written, or — the dial not handing over — written into the rehearsal book and the mock outbox. A
pass starts no text after its budget: those come back in `left`. recruitBookUpload makes the houses Postgres' on the
flip (the rows their copies hold), or hands them back."""
from __future__ import annotations

import json
import re
import time
from datetime import datetime, timezone
from typing import Any, Callable

import candidate_papers as CNDP
import comm_rehearsal as CRH
import comm_recruit as CRT
import comms_rpc as CRPC
import gsjs
import locations as L
import opt_outs as OO
import resource_rows as RR
import smart_comms as SC
import smart_comms_desk as SCD
import smart_comms_doors as SCO
import smart_comms_writes as SW
import staff_views
from writes import Decision

DENIED = {"status": 403, "message": "Requires an admin or manager account"}
BUSY = "Another write holds the platform's lock; the relay offers the recruiters' book again."
OPT_OUT_SCOPE = OO.scope_of_file("CommRecruit.gs")

t = CRT.t
s_ = gsjs.str_


def _admitted(sess: L.Session) -> bool:
    """The relay's service identity, or an admin."""
    user = sess.user or {}
    return bool(sess.user) and (user.get("is_service") is True or gsjs.js_str(user.get("role")) == "admin")


# ---- recruitBookIngest ---------------------------------------------------------------------------------------------

def _the_hubs(reads: L.Reads, resource: str) -> dict[str, str]:
    """row key → id of every row a person changed, made or removed in the Hub (its log names someone but the book's
    pass): the Hub's from then on, so the sheet's line never rewrites, re-makes or removes it."""
    got = RR._q(reads, f"select r.row_key, coalesce(r.cells->>'id', '') from {RR.rows_of(resource)} r"
                       " where r.resource = %s and exists (select 1 from " + RR.CHANGES + " c where"
                       " c.resource = r.resource and c.row_key = r.row_key and c.by_email <> %s)",
                (resource, CRT.PASS_BY))
    return {str(k): str(i) for k, i in got}


def _rewrite(reads: L.Reads, resource: str, header: list[str], grid: list[list[str]]) -> None:
    """clearContents and setValues over the house: its columns the header, each line's row by its id — a row whose
    cells moved patched (a cell gone blank written blank), a new id appended, an id the tab no longer holds removed;
    a row a person changed, made or removed in the Hub is the Hub's and never touched."""
    held = RR.table_rows(reads, resource)
    hubs = _the_hubs(reads, resource)
    theirs = set(hubs.values()) - {""}
    by_id: dict[str, tuple[str, dict]] = {}
    for key, cells in held:
        rid = RR.row_id_of(cells)
        if rid and rid not in by_id:
            by_id[rid] = (key, cells)
    used: set[str] = set()
    made: list[dict[str, str]] = []
    moved: list[tuple[str, dict, dict[str, str]]] = []
    for line in grid:
        cells = {h: v for h, v in zip(header, line) if h != "" and v != ""}
        rid = cells.get("id", "")
        if rid in theirs:
            continue
        was = by_id.get(rid) if rid else None
        if was is None or was[0] in used:
            made.append(cells)
            continue
        key, before = was
        used.add(key)
        changed = {k: v for k, v in cells.items() if gsjs.or_blank(before.get(k)) != v}
        changed.update({k: "" for k, v in before.items() if k not in cells and gsjs.or_blank(v) != ""})
        if changed:
            moved.append((key, before, changed))
    if moved:
        RR.update_many(reads, resource, moved, CRT.PASS_BY)
    if made:
        RR.create_many(reads, resource, made, CRT.PASS_BY)
    for key, cells in held:
        if key not in used and key not in hubs:
            RR.remove(reads, resource, key, cells, CRT.PASS_BY)
    # the header as written, after the writes that widen it
    RR._cur().execute(f"update {RR.COLUMNS} set columns = %s, updated_at = now() where resource = %s",
                      (json.dumps([h for h in header if h != ""]), resource))


def ingest_one(reads: L.Reads, d: dict) -> dict[str, Any]:
    """recruitIngestOne_: one tab of the copy, rewritten whole — the book has no trustworthy row key."""
    tab = t(d.get("tab"))
    out: dict[str, Any] = {"tab": tab, "state": "refused", "rows": 0, "columns": 0,
                           "fingerprint": t(d.get("fingerprint")), "why": ""}
    spec = CRT.HOUSES.get(tab)
    if spec is None:
        out["why"] = "not a house this door writes"
        return out
    header = ["" if h is None else gsjs.js_str(h) for h in d["header"]] if isinstance(d.get("header"), list) else []
    rows = d["rows"] if isinstance(d.get("rows"), list) else []
    if not header or header[0] != "id":
        out["why"] = "the copy carries no header led by `id` — nothing was written"
        return out
    if not rows:
        out["why"] = "the copy carries no rows — the house was left as it stands"
        return out
    if not RR.uploaded(reads.db, spec["resource"]):
        out["state"] = "no_house"
        out["why"] = (f"the house for {tab} is not in Postgres yet — the relay uploads it on the flip "
                      "(recruitBookUpload); the relay offers the copy again later")
        return out
    width = len(header)
    grid = []
    for r in rows:
        line = list(r[:width]) if isinstance(r, list) else []
        line += [""] * (width - len(line))
        grid.append(["" if c is None else gsjs.js_str(c) for c in line])
    try:
        _rewrite(reads, spec["resource"], header, grid)
    except Exception as exc:  # noqa: BLE001 - said; the relay offers the copy again
        out["state"] = "failed"
        out["why"] = "the house could not be written: " + type(exc).__name__
        return out
    out.update(state="written", rows=len(rows), columns=width,
               why=f"{len(rows)} row(s) of \"{spec['source_tab']}\", the whole tab")
    staff_views.record({"email": CRT.PASS_BY}, "recruit_house_written", tab + ": " + out["why"])
    return out


def ingest(sess: L.Session, payload: dict) -> Decision:
    """recruitBookIngest: the relay's copy of one tab into its house, unless the gate holds the feed."""
    if not _admitted(sess):
        return Decision(dict(DENIED))
    why = CNDP.gate_holds(sess.reads, CRT.INGEST_GATE)
    if why:
        return Decision({"status": 409, "message": why})
    return Decision({"status": 200, "data": ingest_one(sess.reads, payload if isinstance(payload, dict) else {})},
                    subject="", own=True)


# ---- recruitTell ---------------------------------------------------------------------------------------------------

def tell_one(reads: L.Reads, r: dict, env: dict, held: CRH.Held) -> dict[str, Any]:
    """recruitTellOne_: refused_quiet, dial_unknown, held and failed are retried; every other state is final."""
    res: dict[str, Any] = {"id": t(r.get("id")), "state": "", "why": "", "detail": "", "words": "", "words_chars": 0,
                           "to_masked": "", "line": "", "channel": ""}

    def done(state: str, why: Any) -> dict[str, Any]:
        res["state"], res["why"] = state, gsjs.or_text(why)
        return res

    sid = t(r.get("situation"))
    if not res["id"] or sid not in CRT.SITUATIONS:
        return done("refused", "not a row this door knows")
    if env["quiet"]:
        return done("refused_quiet", f"inside the quiet window ({SC.QUIET_WORDS}): nothing is said, and the relay "
                                     "offers it again after it")
    if not env["dial_readable"]:
        return done("dial_unknown", "the sending dial could not be read: nothing is said or written, and the relay "
                                    "asks again")
    if env["dial"] not in ("send", "record"):
        return done("dial_off", f"the sending dial stands at `{env['dial']}`: nothing is said or written")
    sit = env["sits"].get(sid)
    if not sit:
        return done("held", f"the situation {sid} is off on the Desk or has no text to send")
    if sid == CRT.BCI:
        pace = CRT.pacing(sit)
        res["max"], res["gap_days"] = pace["max"], pace["gap_days"]
    deadline = gsjs.date_parse(t(r.get("deadline")))
    if deadline is not None and env["now_ms"] >= deadline:
        return done("stale", "the screen has started — no reminder after it")
    num = CRT.number(reads, r.get("phone"))
    if not num["to"]:
        return done(num["state"], num["why"])
    vals = CRT.vars_of(r, sit)
    if sid == CRT.SCREEN and (not vals["time"] or not vals["location"] or not vals["screener"]):
        return done("refused", "the reminder cannot say the screen's time, place and house manager")
    body = SC.render(sit.get("sms_text"), vals)
    from_line = t(sit.get("from_line"))
    reason = "hiring book: " + sid
    person = vals["name"]
    intent = "RB|" + res["id"]
    line_name = from_line or SC.DEFAULT_LINE
    # the copy, answered back
    res["words"] = SW.js_slice(body, CRT.WORDS_MAX)
    res["words_chars"] = SCO.utf16_len(body)
    res["to_masked"] = SC.mask_to(num["to"])
    res["line"] = line_name
    res["channel"] = "sms"
    person_key = re.sub(r"\D", "", t(r.get("phone")))[-10:]
    if env["dial"] != "send":
        # this branch skips the door, so it asks the opt-out list itself
        try:
            stop = OO.opt_out_blocked(reads, num["to"], OPT_OUT_SCOPE)
        except Exception as exc:  # noqa: BLE001 - a list that cannot be asked refuses
            stop = "The opt-out list could not be checked: " + type(exc).__name__
        if stop:
            return done("opted_out", stop)
        why = CRH.dial_held_why(env["dial"], 1, "the candidate on the recruiters' book")
        try:
            noted = held.held({"situation": sid, "intent_key": intent, "person_key": person_key,
                               "person_name": person, "purpose": "hiring book · from " + line_name,
                               "verdict": "recorded", "pass_by": CRT.PASS_BY, "reasons": why, "channel": "sms",
                               "to": num["to"], "body": body, "sender_used": vals["sender"], "reason": reason,
                               "to_name": person})
        except Exception:  # noqa: BLE001 - said in the answer
            noted = ""
        return done("recorded", f"the sending dial stands at `{env['dial']}`: nobody was contacted"
                    + (" — the text is in the rehearsal book and the mock outbox" if noted
                       else " — and the rehearsal row could not be written"))
    slot = SCD.js_parse_int(r.get("slot")) or 1
    p = {"to": num["to"], "body": body, "reason": reason, "from_line": from_line}
    idem = "recruit_" + re.sub(r"[^A-Za-z0-9_\-]", "", res["id"])[:60] + "_" + str(slot)
    try:
        sms = CRPC.refused_contract("smsSend", p) or CRPC.call(reads, "smsSend", p,
                                                                {"idempotency_key": idem, "person": person})
    except Exception as exc:  # noqa: BLE001 - the transport's failure is the answer
        sms = {"ok": False, "sent": False, "error": "transport", "detail": type(exc).__name__}
    if sms.get("quiet"):
        return done("refused_quiet", "the send door's quiet window: nothing is said, and the relay offers it again "
                                     "after it")
    if sms.get("sent"):
        if not sms.get("redirected"):
            SC.record_ledger(intent, sid, person, t(r.get("date")), "sms", reads.db)
        return done("redirected" if sms.get("redirected") else "told",
                    "test mode sent it to the testers" if sms.get("redirected") else "")
    if sms.get("rehearsed"):
        return done("rehearsed", t(sms.get("detail")))
    if sms.get("recorded_to"):
        return done("recorded", "written into " + t(sms.get("recorded_to")))
    if sms.get("deduplicated"):
        return done("duplicate", "this exact text already went")
    if sms.get("reason") == "opted_out":
        return done("opted_out", t(sms.get("detail")))
    if sms.get("gated"):
        return done("held", t(sms.get("reason")) or "the send door held it")
    res["detail"] = t(sms.get("error"))
    return done("failed", t(sms.get("detail") or sms.get("error")) or "the send door gave no answer")


def tell(sess: L.Session, payload: dict) -> Decision:
    """recruitTell: the texts the relay's plan owes, one result for every row it starts; the rows this pass did not
    start come back in `left`."""
    if not _admitted(sess):
        return Decision(dict(DENIED))
    data = payload if isinstance(payload, dict) else {}
    rows = data["rows"][:CRT.MAX_ROWS] if isinstance(data.get("rows"), list) else []
    out: dict[str, Any] = {"results": [], "counts": {}, "dial": "", "left": []}
    if not rows:
        return Decision({"status": 200, "data": out})
    reads = sess.reads
    now = datetime.now(timezone.utc)
    # an unreadable dial is `dial_unknown`, never `off`
    try:
        dial = SCD.dial(reads.config())
    except Exception:  # noqa: BLE001
        dial = {"word": "off", "readable": False}
    try:
        situations: list[dict] | None = SC.read_situations(reads.db)
    except Exception:  # noqa: BLE001 - no situation is on
        situations = None
    sits = {}
    for sid in CRT.SITUATIONS:
        try:
            sits[sid] = CRT.situation(reads, situations, sid)
        except Exception:  # noqa: BLE001 - that one is off
            sits[sid] = None
    env = {"now_ms": now.timestamp() * 1000.0, "quiet": SC.quiet_at(time.time()),
           "dial": s_(dial.get("word")) or "off", "dial_readable": dial.get("readable") is not False, "sits": sits}
    out["dial"] = env["dial"] if env["dial_readable"] else "unknown"
    edits: list[dict] = []
    held = CRH.Held(reads, edits)
    begun = time.time()
    for i, raw in enumerate(rows):
        r = raw if isinstance(raw, dict) else {}
        if i and time.time() - begun > CRT.START_BUDGET_S:
            out["left"] = rows[i:]
            break
        try:
            res = tell_one(reads, r, env, held)
        except Exception as exc:  # noqa: BLE001 - the row answers failed and the relay offers it again
            res = {"id": t(r.get("id")), "state": "failed", "why": "the lane threw: " + type(exc).__name__}
        out["counts"][res["state"]] = out["counts"].get(res["state"], 0) + 1
        out["results"].append(res)
    held.say_capped()
    staff_views.record({"email": CRT.PASS_BY}, "recruit_tell",
                       f"{len(out['results'])} text(s): " + json.dumps(out["counts"], separators=(",", ":")))
    kept = [e for e in edits if e and e.get("cells")]
    return Decision({"status": 200, "data": out}, edits=kept or None, subject="", own=True)


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {
    "recruitBookIngest": ingest, "recruitTell": tell,
    "recruitBookUpload": RR.upload_door({r: {"tab": tab} for r, tab in CRT.RESOURCES.items()})}
# HUB_POLICY.recruitBookIngest / recruitTell: roles empty, the handlers admit the service or an admin
POLICY: dict[str, dict[str, Any]] = {"recruitBookIngest": {}, "recruitTell": {}, "recruitBookUpload": {}}
BUSY_OF: dict[str, dict[str, Any]] = {"recruitBookIngest": {"status": 409, "message": BUSY},
                                      "recruitTell": {"status": 409, "message": BUSY},
                                      "recruitBookUpload": {"status": 409, "message": BUSY}}


class Store(RR.Store):
    """app.comm_recruit_writes and _receipts; the houses app.resource_rows', the rehearsal book and the mock outbox
    app.edits', the messages Smart Comms' outbox's — a void takes a pass's rows back."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="comm_recruit", label="The recruiters' book")
