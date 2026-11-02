"""The opt-out index and the inbound log (OptOut.gs) read from Postgres: entity_opt_outs (app.resource_rows
`entityOptOuts`) and entity_inbound_messages (`entityInboundMessages`), each the asa-hub-db copy until uploaded. Here
are the keys, the phrase lists, the scope by line, the brakes every sender asks (optOutBlocked_, optOutIsSuppressed_),
the list's screen (optOutList) and the inbound sweep's reading half (commsInboundFetch: the Quo workbook's Messages
past the cursor, each message's intent, its person and whether it is filed). Every write is in app/opt_outs_writes.py;
the sweep's cursor and the automatic pass's throttle live in app.opt_out_state (db/opt_outs.sql)."""
from __future__ import annotations

import json
import re
import time
import types
from typing import Any, Callable

import gsjs
import hubdb
import locations as L
import resource_rows as RR
import staff_comms as SC
import writes as W
from gsjs import SheetDate
from scope import Defer

APP_ID = "smart-comms"

OPT_OUT_TAB = "entity_opt_outs"
OPT_OUT_RESOURCE = "entityOptOuts"
OPT_OUT_COLUMNS = ("target", "kind", "target_key", "person_name", "candidate_id", "source", "phrase", "message_id",
                   "at", "by", "released_at", "released_by", "scope")
INBOUND_TAB = "entity_inbound_messages"
INBOUND_RESOURCE = "entityInboundMessages"
INBOUND_COLUMNS = ("message_id", "received_at", "from_number", "from_key", "candidate_id", "person_name", "body",
                   "intent", "our_number", "seen_at", "seen_by", "recorded_at")
STATE = "app.opt_out_state"

# Short and unambiguous on purpose: a clever list suppresses people who never asked.
OPT_OUT_PHRASES_SHIPPED = ("stop, stopall, unsubscribe, cancel, end, quit, revoke, optout, opt out, remove me, pare, "
                           "parar, para, nao quero, não quero, remova, descadastrar, sair")
# Never "yes": an opt-in releases a suppression, and "yes" answers any question.
OPT_IN_PHRASES_SHIPPED = "start, unstop, resume, voltar, pode mandar"
WRONG_NUMBER_PHRASES_SHIPPED = ("wrong number, wrong person, you have the wrong number, sorry wrong number, "
                                "this is not me, not me, numero errado, número errado, nao sou eu, não sou eu, "
                                "pessoa errada")

# Only a wrong number is ever scoped; a stop is never narrowed, and an unscoped row or caller blocks.
OPT_OUT_SCOPES = ("hiring", "staff")
# OPT_OUT_SCOPE_BY_FILE: the conversation each file's actions hold; an unlisted file answers '' and blocks
SCOPE_BY_FILE = {
    "HiringOutreach.gs": "hiring", "Interview.gs": "hiring", "InterviewFlow.gs": "hiring", "Screening.gs": "hiring",
    "Hired.gs": "hiring", "Packet.gs": "hiring", "Invites.gs": "hiring", "TalentPipeline.gs": "hiring",
    "HiringFlow.gs": "hiring", "HiringWalk.gs": "hiring", "Onboarding.gs": "hiring", "Talent.gs": "hiring",
    "CommRecruit.gs": "hiring",
    "SmartComms.gs": "staff", "StaffAlerts.gs": "staff", "CommRecord.gs": "staff", "CommCallOff.gs": "staff",
    "CommIncident.gs": "staff", "CommSupport.gs": "staff", "CommPsi.gs": "staff", "CommQualify.gs": "staff",
    "CommInbound.gs": "staff", "MedDel.gs": "staff", "CommBroadcast.gs": "staff", "CommOpenShiftCovered.gs": "staff"}
OPT_OUT_HIRING_LINES = ("3309195559", "3307544040")
# Also the test-redirect target: in test mode a reply there could be about anything, so no scope.
OPT_OUT_OUTREACH_LINE = "3309195558"

# The Quo workbook's Messages tab: its `Direction` says `incoming` on every row, so trust `Status`.
QUO_MESSAGES_TAB = "Messages"
INBOUND_BATCH_ROWS = 1500
INBOUND_BATCH_RECORD = 300
# A row index, not a date: the tab is append-only.
INBOUND_CURSOR_PROP = "HUB_INBOUND_CURSOR"
# commsInboundSweepMaybe_'s script-cache key and how long it holds
INBOUND_THROTTLE_KEY = "inbound_sweep_ran"
INBOUND_THROTTLE_S = 900
# Last-resort floor only: is_ours asks the line directory first.
INBOUND_COMPANY_DIGITS = ("3309197595", "3309197779")
INBOUND_RECENT_DAYS = 45
AUTO_BY = "asa-hub:auto"
DECISIONS = ("opt-out", "opt-in", "wrong-number")

DENIED = {"status": 403, "message": "Requires an admin or manager account"}
NO_KEY = "not a number or an address we can key on"

s_ = gsjs.str_


def is_writer(user: dict | None) -> bool:
    """hubIsWriter_."""
    return bool(user) and gsjs.js_str(user.get("role")) in ("admin", "manager")


def js_cut(s: str, n: int) -> str:
    """String.prototype.slice(0, n), counted in UTF-16 units; a cut through a surrogate pair drops its lone half."""
    units = s.encode("utf-16-le", "surrogatepass")
    if len(units) <= 2 * n:
        return s
    cut = units[:2 * n]
    if 0xD800 <= int.from_bytes(cut[-2:], "little") <= 0xDBFF:
        cut = cut[:-2]
    return cut.decode("utf-16-le", "surrogatepass")


def _digits10(v: Any) -> str:
    """String(v).replace(/\\D/g, '').slice(-10)."""
    return re.sub(r"[^0-9]", "", gsjs.or_blank(v))[-10:]


# ---- the keys, the phrases, the scope ---------------------------------------------------------------------------

def opt_out_key(target: Any) -> str:
    """optOutKey_."""
    s = gsjs.trim(gsjs.or_text(target))
    if not s:
        return ""
    if "@" in s:
        return s.lower()
    d = re.sub(r"[^0-9]", "", s)
    return d[-10:] if len(d) >= 10 else ""


def opt_out_kind(target: Any) -> str:
    """optOutKind_."""
    return "email" if "@" in gsjs.or_text(target) else "phone"


def phrases(cfg: dict[str, Any] | None, key: str, shipped: str) -> list[str]:
    """optOutPhrases_: the Hiring alerts config's list for `key`, else the shipped one."""
    raw = gsjs.or_text((cfg or {}).get(key))
    got = [gsjs.trim(gsjs.js_str(s)).lower() for s in re.split(r"[,;\n]+", raw)]
    got = [s for s in got if s]
    if not got:
        got = [x for x in (gsjs.trim(s).lower() for s in re.split(r"[,;\n]+", shipped)) if x]
    return got


def intent_norm(body: Any) -> str:
    """What optOutIntent_ does to a body before it compares: lower case, anything else than a letter, a digit or a
    space made one, every run of spaces one, trimmed."""
    s = gsjs.or_text(body).lower()
    s = re.sub(r"[^a-zà-ú0-9" + L._JS_WS + r"]", " ", s, flags=re.I)
    return gsjs.trim(re.sub(r"[" + L._JS_WS + r"]+", " ", s))


def opt_out_intent(body: Any, cfg: dict[str, Any] | None = None) -> str:
    """optOutIntent_: the WHOLE message against each list — '' for an empty body, 'reply' for anything else."""
    s = intent_norm(body)
    if not s:
        return ""
    if s in phrases(cfg, "opt_out_phrases", OPT_OUT_PHRASES_SHIPPED):
        return "opt-out"
    if s in phrases(cfg, "opt_in_phrases", OPT_IN_PHRASES_SHIPPED):
        return "opt-in"
    if s in phrases(cfg, "wrong_number_phrases", WRONG_NUMBER_PHRASES_SHIPPED):
        return "wrong-number"
    return "reply"


def comm_test_mode(cfg: dict[str, Any] | None) -> bool:
    """commTestMode_: test mode on — or its switch unreadable, which holds as on."""
    if cfg is None:
        return True
    import smart_comms_desk as SCD  # noqa: PLC0415 - the brakes as the Desk resolves them
    try:
        return bool(SCD.test_mode_state(cfg)["on"])
    except Exception:  # noqa: BLE001 - an unreadable switch is test mode
        return True


def scope_for_line(our_number: Any, testing: bool) -> str:
    """optOutScopeForLine_: the conversation a wrong number on this line of ours narrows to."""
    d = _digits10(gsjs.or_text(our_number))
    if not d:
        return ""
    if d in OPT_OUT_HIRING_LINES:
        return "hiring"
    if d == OPT_OUT_OUTREACH_LINE:
        return "" if testing else "hiring"
    return ""


def scope_of_file(file: Any) -> str:
    """optOutScopeNow_ for the action of a file (HUB_POLICY[action].file); a sweep or an unlisted file is ''."""
    return SCOPE_BY_FILE.get(gsjs.or_blank(file), "")


def scoped(hit: dict | None) -> bool:
    """optOutScoped_."""
    if not hit:
        return False
    if "wrong" not in s_(hit.get("source")).lower():
        return False
    return s_(hit.get("scope")) in OPT_OUT_SCOPES


# ---- the two records --------------------------------------------------------------------------------------------

def _db(src: Any) -> hubdb.HubDb:
    return getattr(src, "db", src)


def _rr(src: Any) -> Any:
    """What resource_rows reads through (its `.db`), for a caller that holds the database alone."""
    return src if hasattr(src, "db") else types.SimpleNamespace(db=src)


def _once(src: Any, name: str, read: Callable[[], Any]) -> Any:
    """Once per request — never inside a write, which must see its own rows."""
    if hasattr(src, "once") and W.HELD.get() is None:
        return src.once(name, read)
    return read()


def _normalized_rr(src: Any, resource: str) -> list[dict]:
    """readTabNormalized_ of a resource Postgres holds: headers normKey_'d, Dates as cellText_, blank rows dropped."""
    r = _rr(src)
    cols = RR.columns(r, resource)
    keys = [hubdb.norm_key(h) for h in cols]
    out = []
    for _k, cells in RR.table_rows(r, resource):
        vals = [hubdb.typed(cells.get(h), "hub") for h in cols]
        if all(v == "" or v is None for v in vals):
            continue
        o: dict[str, Any] = {}
        for k, v in zip(keys, vals):
            if k:
                o[k] = hubdb.cell_text(v) if isinstance(v, (SheetDate, hubdb.SheetTime)) else v
        out.append(o)
    return out


def _rows(src: Any, resource: str, tab: str) -> list[dict]:
    """Postgres's rows once the resource is uploaded, else the copy of the tab where the router keeps it; an unborn tab
    holds none (optOutSheet_ makes it empty)."""
    db = _db(src)
    if RR.uploaded(db, resource):
        return _normalized_rr(src, resource)
    res = db.resolve(tab)
    if res.runtime:
        raise Defer(f"{tab} lives in the depot's facts")
    if res.ref is None:
        if not res.book_known:
            raise hubdb.Unreadable(f"asa-hub-db holds no copy of the book behind {tab}")
        return []
    return SC._normalized(_rr(src), res.ref, res.sheet_id == db.prop("HUB_DB_ID"))


def opt_out_rows(src: Any) -> list[dict]:
    """readTabNormalized_(entity_opt_outs): every row, released ones too. `src` is a request's Reads or the database."""
    return _once(src, "opt_outs:rows", lambda: _rows(src, OPT_OUT_RESOURCE, OPT_OUT_TAB))


def inbound_rows(src: Any) -> list[dict]:
    """readTabNormalized_(entity_inbound_messages): every message the sweep filed."""
    return _once(src, "opt_outs:inbound", lambda: _rows(src, INBOUND_RESOURCE, INBOUND_TAB))


def opt_out_index(src: Any) -> dict[str, Any]:
    """optOutIndex_: target key → its standing stop (a released row clears its key); an unreadable list is said in
    `error`, never an empty list."""
    try:
        rows = opt_out_rows(src)
    except Exception as e:  # noqa: BLE001 - optOutIndex_'s catch: the failure is the answer, said in words
        return {"by": {}, "error": "The opt-out list could not be read: " + (str(e) or type(e).__name__)}
    by: dict[str, dict] = {}
    for r in rows:
        key = s_(r.get("targetkey")) or opt_out_key(r.get("target"))
        if not key:
            continue
        if s_(r.get("releasedat")):
            by.pop(key, None)
            continue
        by[key] = {"target": s_(r.get("target")), "kind": s_(r.get("kind")), "name": s_(r.get("personname")),
                   "candidate_id": s_(r.get("candidateid")), "source": s_(r.get("source")),
                   "phrase": s_(r.get("phrase")), "at": s_(r.get("at")), "scope": s_(r.get("scope"))}
    return {"by": by, "error": ""}


def _hit(src: Any, target: Any, scope: str) -> tuple[dict | None, str]:
    """The standing stop on this target that holds for a caller of `scope` ('' is an unknown caller, held by any)."""
    key = opt_out_key(target)
    if not key:
        return None, ""
    idx = opt_out_index(src)
    if idx["error"]:
        return None, idx["error"]
    hit = idx["by"].get(key)
    if not hit:
        return None, ""
    mine = gsjs.or_text(scope)
    if mine and scoped(hit) and hit["scope"] != mine:
        return None, ""
    return hit, ""


def opt_out_blocked(src: Any, target: Any, scope: str = "") -> str:
    """optOutBlocked_: why this target may not be contacted, '' when it may; an unreadable list refuses. `scope` is the
    caller's file's (scope_of_file); '' — a sweep, an unlisted file — is held by every stop."""
    hit, error = _hit(src, target, scope)
    if error:
        return error
    if not hit:
        return ""
    return ("This person asked us to stop" + (" on " + hit["at"][:10] if hit["at"] else "")
            + (' ("' + hit["phrase"] + '")' if hit["phrase"] else "") + ".")


def opt_out_suppressed(src: Any, target: Any, scope: str = "") -> str:
    """optOutIsSuppressed_, for cards: unlike opt_out_blocked, an unreadable list is not a suppression here."""
    hit, _error = _hit(src, target, scope)
    if not hit:
        return ""
    return "Asked us to stop" + (" on " + hit["at"][:10] if hit["at"] else "") + "."


def inbound_index(src: Any) -> dict[str, Any]:
    """inboundIndex_: the message ids already filed; an unreadable record is said in `error`."""
    try:
        rows = inbound_rows(src)
    except Exception as e:  # noqa: BLE001 - inboundIndex_'s catch
        return {"have": set(), "error": str(e) or type(e).__name__}
    return {"have": {i for i in (s_(r.get("messageid")) for r in rows) if i}, "error": ""}


# ---- what Apps Script kept in Script Properties and the script cache -------------------------------------------

def state(src: Any, key: str) -> dict[str, Any]:
    """One key of app.opt_out_state: its value and whether it is still held (a cache key's expiry not passed)."""
    got = RR._q(_rr(src), f"select value, expires_at is not null and expires_at > now() from {STATE} where key = %s",
                (key,))
    return {"value": gsjs.or_blank(got[0][0]), "live": bool(got[0][1])} if got else {"value": "", "live": False}


def cursor(src: Any) -> int:
    """inboundCursor_: the last Messages row a pass reached."""
    m = re.match(r"^[+-]?\d+", gsjs.trim(state(src, INBOUND_CURSOR_PROP)["value"] or "0"))
    n = int(m.group(0)) if m else 0
    return n if n >= 0 else 0


# ---- the people and the lines -----------------------------------------------------------------------------------

def who_index(reads: L.Reads) -> dict[str, dict]:
    """inboundWhoIndex_: each candidate's ten digits → their id and name, the first row winning; a failure of its own
    is "nobody matches" and is not kept for the request."""
    if "opt_outs:who" in reads.memo:
        return reads.memo["opt_outs:who"]
    import candidates as CND  # noqa: PLC0415 - the Hiring app's own rows
    try:
        rows = CND.raw_rows(reads)
    except (hubdb.Unreadable, Defer):
        raise
    except Exception:  # noqa: BLE001 - inboundWhoIndex_'s catch
        return {}
    idx: dict[str, dict] = {}
    for r in rows:
        d = _digits10(s_(r.get("phone")))
        if not d or d in idx:
            continue
        idx[d] = {"id": s_(r.get("candidateid")), "name": s_(r.get("candidatename"))}
    reads.memo["opt_outs:who"] = idx
    return idx


def who(reads: L.Reads, digits: str) -> dict | None:
    """inboundWho_."""
    if not digits:
        return None
    return who_index(reads).get(digits)


def is_ours(reads: L.Reads, digits: str) -> bool:
    """inboundIsOurs_: true for a blank number on purpose, the careful direction."""
    if not digits:
        return True
    try:
        if SC._line_ours(reads, digits):
            return True
    except hubdb.Unreadable:
        raise
    except Exception:  # noqa: BLE001 - the floor below answers when the directory cannot
        pass
    if digits in SC.SHARED_LINE_DIGITS:
        return True
    return digits in INBOUND_COMPANY_DIGITS


def is_recent(when: Any, now_ms: float) -> bool:
    """inboundIsRecent_: undated counts as new, never as old."""
    s = s_(when)
    if not s:
        return True
    t = gsjs.date_parse(s)
    if t is None:
        at = gsjs.parse_when(s, "")
        t = at.timestamp() * 1000.0 if at is not None else None
    if t is None:
        return True
    return now_ms - t <= INBOUND_RECENT_DAYS * 86400000


# ---- the sweep's reading half -----------------------------------------------------------------------------------

def scan(window: dict[int, dict], first: int, count: int, col: Callable[[dict, str], str], seen: set,
         ours: Callable[[str], bool], person: Callable[[str], dict | None], intent_of: Callable[[str], str],
         scope_of: Callable[[str], str], recent: Callable[[str], bool]) -> dict[str, Any]:
    """commsInboundRun_'s loop up to its writes: rows first..first+count-1 (a row the copy lacks reads blank), each
    received message not filed yet decided — its intent, its person, whether it is filed — until a batch's worth is."""
    items: list[dict] = []
    n = {"outgoing": 0, "ours": 0, "passed_over": 0, "already": 0}
    reached = first - 1
    for i in range(count):
        if len(items) >= INBOUND_BATCH_RECORD:
            break
        reached = first + i
        r = window.get(reached) or {}
        # Status, never Direction (see QUO_MESSAGES_TAB).
        if col(r, "status").lower() != "received":
            n["outgoing"] += 1
            continue
        mid = col(r, "id")
        if not mid:
            continue
        if mid in seen:
            n["already"] += 1
            continue
        from_num = col(r, "from")
        digits = _digits10(from_num)
        if ours(digits):
            n["ours"] += 1
            continue
        body = col(r, "body")
        # An empty body is an attachment: a reply for a person to open, never silence.
        intent = intent_of(body) or "reply"
        w = person(digits)
        at = col(r, "at")
        # The mirror is the whole company's traffic: file decisions always, others only for a candidate or when recent.
        if intent in DECISIONS or w or recent(at):
            items.append({"message_id": mid, "received_at": at, "from_number": from_num, "from_key": digits,
                          "who": bool(w), "candidate_id": w["id"] if w else "", "person_name": w["name"] if w else "",
                          "body": js_cut(body, 900), "phrase": js_cut(body, 120), "intent": intent,
                          "our_number": col(r, "quo"),
                          "scope": scope_of(col(r, "quo")) if intent == "wrong-number" else ""})
        else:
            n["passed_over"] += 1
        seen.add(mid)
    return {"items": items, "reached": reached, **n}


def _window(reads: L.Reads, ref: hubdb.TabRef, first: int, last: int) -> dict[int, dict]:
    """getRange(first, 1, …).getValues() of the copy: sheet row → its cells as the copy keeps them."""
    if not re.fullmatch(r"[a-z0-9_]{1,63}", ref.table):
        raise hubdb.Unreadable(f"the catalog names an unusable table for {ref.tab}")
    reads.db.note_book(ref.sheet_id)
    out: dict[int, dict] = {}
    for rn, raw in reads.db.query(f'select row_number, _raw from {reads.db.from_sql(ref)}'  # noqa: S608
                                  " where row_number between %s and %s order by row_number", (first, last)):
        if isinstance(raw, str):
            raw = json.loads(raw)
        out[int(rn)] = raw if isinstance(raw, dict) else {}
    return out


def _last_row(reads: L.Reads, ref: hubdb.TabRef) -> int:
    """getLastRow() of the copy: its last sheet row, 1 when it holds none but the header."""
    if not re.fullmatch(r"[a-z0-9_]{1,63}", ref.table):
        raise hubdb.Unreadable(f"the catalog names an unusable table for {ref.tab}")
    got = reads.db.query(f'select max(row_number) from {reads.db.from_sql(ref)}')  # noqa: S608
    return int(got[0][0]) if got and got[0][0] is not None else 1


def run_read(reads: L.Reads, by: str, restart: bool) -> dict[str, Any]:
    """commsInboundRun_ up to its writes: `answer` when it ends before any (nothing to file), else the batch."""
    sid = gsjs.trim(gsjs.or_blank(reads.db.prop("QUO_SYNC_SHEET_ID")))
    book = reads.db.book(sid) if sid else None
    if book is None:
        why = "no QUO_SYNC_SHEET_ID is set" if not sid else "asa-hub-db holds no copy of the Quo workbook"
        return {"by": by, "answer": {"status": 503, "message": "The message mirror could not be opened (" + why +
                                     "). Nothing was swept."}}
    ref = reads.db.tab(sid, QUO_MESSAGES_TAB)
    if ref is None:
        return {"by": by, "answer": {"status": 503, "message": 'The Quo workbook has no "' + QUO_MESSAGES_TAB +
                                     '" tab. An absent source is not an empty inbox — nothing was swept.'}}
    last_row = _last_row(reads, ref)
    if last_row < 2:
        return {"by": by, "answer": {"status": 200, "data": {
            "recorded": 0, "stops": 0, "starts": 0, "wrongNumbers": 0, "alreadySeen": 0, "remaining": 0, "replies": [],
            "noFeed": True,
            "message": "No inbound feed. The message mirror is EMPTY — not \"no replies\". Until OpenPhone writes to "
                       "it again, a STOP sent by SMS cannot be seen."}}}
    header = [hubdb.norm_key(h) for h in ref.headers]

    def at(name: str) -> str | None:
        return ref.headers[header.index(name)] if name in header else None

    heads = {"id": at("messageid"), "at": at("messagecreated"), "status": at("status"),
             "from": at("externalparticipants"), "body": at("body"), "quo": at("quonumber")}
    if heads["id"] is None or heads["status"] is None or heads["body"] is None:
        return {"by": by, "answer": {"status": 503, "message": "The mirror is missing the columns this reads "
                                                               "(Message ID / Status / Body). Nothing was swept."}}
    seen = inbound_index(reads)
    if seen["error"]:
        return {"by": by, "answer": {"status": 503, "message": "The inbound record could not be read (" +
                                     seen["error"] + "). Nothing was swept, so nothing is double-counted."}}
    at_cursor = 0 if restart else cursor(reads)
    first = max(2, at_cursor + 1)
    if first > last_row:
        first = max(2, last_row - INBOUND_BATCH_ROWS + 1)
    count = min(INBOUND_BATCH_ROWS, last_row - first + 1)
    window = _window(reads, ref, first, first + count - 1)
    direct, zone = SC._direct(reads, sid), gsjs.book_zone(sid, reads.db.prop)

    def col(r: dict, name: str) -> str:
        h = heads[name]
        if h is None:
            return ""
        return s_(SC._dated(r.get(h), direct, zone) if name == "at" else SC._typed(r.get(h), direct))

    try:
        cfg: dict[str, Any] | None = reads.config()
    except Exception:  # noqa: BLE001 - hiringAlerts_ unreadable: the shipped lists, and test mode held as on
        cfg = None
    testing = comm_test_mode(cfg)
    now_ms = time.time() * 1000.0
    got = scan(window, first, count, col, set(seen["have"]), lambda d: is_ours(reads, d),
               lambda d: who(reads, d), lambda b: opt_out_intent(b, cfg), lambda q: scope_for_line(q, testing),
               lambda w: is_recent(w, now_ms))
    return {"by": by, "last_row": last_row, **got}


def inbound_fetch(sess: L.Session, payload: dict) -> dict[str, Any]:
    """commsInboundSweep's reading half (`mode` sweep, a person pressing; `restart` yes reads from the top again) and
    commsInboundSweepMaybe_'s (`mode` auto, the relay's own, held for INBOUND_THROTTLE_S after a pass). `data.run`
    goes to commsInboundKeep, whose answer is the sweep's; `data.answer` alone is the whole answer."""
    user = sess.user or {}
    p = payload if isinstance(payload, dict) else {}
    reads = sess.reads
    if s_(p.get("mode")) == "auto":
        if user.get("is_service") is not True:
            return {"status": 403, "message": "This is the relay's own read."}
        if state(reads, INBOUND_THROTTLE_KEY)["live"]:
            return {"status": 200, "data": {"answer": {"status": 200, "data": {"skipped": True}}}}
        try:
            run = run_read(reads, AUTO_BY, False)
        except Exception as e:  # noqa: BLE001 - commsInboundSweepMaybe_'s catch: the keep logs it
            run = {"by": AUTO_BY, "error": str(e) or type(e).__name__}
        return {"status": 200, "data": {"run": {**run, "mode": "auto"}}}
    if not is_writer(user):
        return dict(DENIED)
    run = run_read(reads, s_(user.get("email")) or "asa-hub", gsjs.or_text(p.get("restart")) == "yes")
    if run.get("answer") is not None:
        return {"status": 200, "data": {"answer": run["answer"]}}
    return {"status": 200, "data": {"run": {**run, "mode": "sweep"}}}


# ---- the list's screen ------------------------------------------------------------------------------------------

READ_ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {"commsInboundFetch": inbound_fetch}
ACTIONS = READ_ACTIONS
# HUB_POLICY: commsInboundSweep's roles for its reading half (the relay's own auto pass passes as service); the list's
# screen (optOutList) is the Desk's (smart_comms_desk), reading the rows opt_out_rows hands it
POLICY: dict[str, dict[str, Any]] = {
    "commsInboundFetch": {"roles": ("admin", "manager"), "params": {"restart": "string"}}}
