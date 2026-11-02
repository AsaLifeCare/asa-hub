"""The Line Directory (LineDirectory.gs) on Python: the company's own phone lines — each one's owner, role and whether
it names a person — from the provider's listing (OpenPhone GET /v1/phone-numbers, through Smart Comms' own key) or
from the platform's copy the relay hands over (lineDirectorySync). The last good directory and a refusal of the
provider remembered for fifteen minutes are kept in app.line_directory (db/line_directory.sql), where Apps Script kept
the HUB_LINE_DIRECTORY property and its CacheService marker; the six-hour shared cache is held in this process."""
from __future__ import annotations

import json
import logging
import re
import threading
import time
from typing import Any, Callable

import gsjs
import house_tables as HT
import hubdb
import locations as L
import resource_rows as RR
import smart_comms as SC
import writes as W
from writes import Decision

log = logging.getLogger("asa-hub-app")

TABLE = "app.line_directory"
# LINE_DIR_PROP: the row the last good directory is kept in
STORED_KEY = "HUB_LINE_DIRECTORY"
# LINE_DIR_FAIL_KEY, LINE_DIR_FAIL_SECONDS: how long a shut road stays shut before anybody knocks again
SHUT_KEY = "hub_line_directory_shut_v1"
SHUT_SECONDS = 900
# LINE_DIR_CACHE_SECONDS: CacheService's own ceiling, kept by the memo here
CACHE_SECONDS = 21600
# LINE_DIR_STALE_HOURS: past this, the stored copy still answers and says it is old
STALE_HOURS = 72
# LINE_DIR_NEVER: never a line, whatever any source says
NEVER = ("3303440430",)
# LINE_DIR_SERVICE_SEATS: seats that are not people
SERVICE_SEATS = ("abd documents", "asa tech", "asatech", "automations", "api", "integration")
# LINE_ROLE_WORDS: the declared roles, the half no database knows
ROLE_WORDS = SC.LINE_ROLE_WORDS
# Comms.gs COMMS_WINDOW_DAYS: the days the comms book's transcripts tab holds
COMMS_WINDOW_DAYS = 7
COMMS_PROP, COMMS_TAB = "HUB_COMMS_ID", "transcripts"
DENIED = {"status": 403, "message": "Requires an admin or manager account"}
MEMO = "line_directory"
# a stored row's keys in the order hubLineRowBuild_ and hubLineDeriveShared_ make them (jsonb keeps its own order)
ROW_KEYS = ("digits", "e164", "id", "name", "owner", "people", "seats", "humans", "forward_to", "role", "role_known",
            "shared", "shared_why", "forwards_from")
PERSON_KEYS = ("name", "role", "service")
_UPSERT = (f"insert into {TABLE} (key, directory, write_id, updated_at) values (%s, %s::jsonb, %s, now())"
           " on conflict (key) do update set directory = excluded.directory, write_id = excluded.write_id,"
           " updated_at = now()")
_ARRAY_INDEX = re.compile(r"0|[1-9][0-9]*")

# the shared read cache: the directory's JSON, until when, and the write that put it there until Postgres shows it
_CACHE: dict[str, Any] = {}
_CACHE_LOCK = threading.Lock()
_BOUND: dict[str, Any] = {}

s_ = gsjs.str_
line_key = SC.line_key


def bind(store: Any) -> None:
    """The write store whose connection keeps what a read stores: the provider's directory and a refusal."""
    _BOUND["store"] = store


# ---- JavaScript's view of a value ----------------------------------------------------------------------------------

def _or(*vals: Any) -> Any:
    """a || b || …: the first truthy operand, else the last."""
    for v in vals[:-1]:
        if not gsjs.falsy(v):
            return v
    return vals[-1]


def _get(o: Any, key: str) -> Any:
    """o.key, undefined (None) on anything that is not an object."""
    return o.get(key) if isinstance(o, dict) else None


def _json(v: Any) -> Any:
    return json.loads(v) if isinstance(v, str) else v


def _text(v: Any) -> str:
    return json.dumps(v, ensure_ascii=False, separators=(",", ":"))


def _has_lines(d: Any) -> bool:
    """d && d.lines && d.lines.length."""
    got = _get(d, "lines")
    return isinstance(got, list) and len(got) > 0


def _ordered(r: Any) -> Any:
    """A stored row with its keys in the order the directory made them."""
    if not isinstance(r, dict):
        return r
    out = {k: r[k] for k in ROW_KEYS if k in r}
    out.update((k, v) for k, v in r.items() if k not in out)
    if isinstance(out.get("people"), list):
        out["people"] = [{**{k: p[k] for k in PERSON_KEYS if k in p}, **p} if isinstance(p, dict) else p
                         for p in out["people"]]
    return out


def _js_order(obj: dict) -> dict:
    """A JavaScript object's own key order: the array-index keys ascending, then the rest as they were made."""
    idx = sorted((k for k in obj if _ARRAY_INDEX.fullmatch(k) and int(k) < 4294967295), key=int)
    seen = set(idx)
    return {**{k: obj[k] for k in idx}, **{k: v for k, v in obj.items() if k not in seen}}


# ---- keys -----------------------------------------------------------------------------------------------------------

def is_provider_id(v: Any) -> bool:
    """hubLineIsProviderId_: a provider line id ('PNmUmHyA17')."""
    return re.fullmatch(r"PN[A-Za-z0-9]{6,}", gsjs.trim(gsjs.or_blank(v))) is not None


def shared_floor() -> list[str]:
    """hubLineSharedFloor_ (hubSharedLineDigits_): the declared shared lines, asked and never copied."""
    out: list[str] = []
    for d in SC.SHARED_LINE_DIGITS:
        k = re.sub(r"[^0-9]", "", gsjs.or_blank(d))[-10:]
        if len(k) == 10 and k not in out:
            out.append(k)
    return out


# ---- the two shapes -------------------------------------------------------------------------------------------------

def row_build(pid: Any, number: Any, name: Any, users: Any, forward_to: Any) -> dict[str, Any] | None:
    """hubLineRowBuild_: one row, from whichever source produced it; the owner is the provider's own word, or the one
    human on the line, or nobody."""
    digits = line_key(number)
    if not digits or digits in NEVER:
        return None
    if not gsjs.falsy(users) and not isinstance(users, list):
        raise TypeError("users.forEach is not a function")
    seats = humans = 0
    owner_named = first_human = ""
    people: list[dict[str, Any]] = []
    for u in users or []:
        whole = gsjs.trim(gsjs.or_text(_get(u, "firstName")) + " " + gsjs.or_text(_get(u, "lastName")))
        nm = gsjs.trim(gsjs.or_text(u if gsjs.falsy(u) else _or(_get(u, "name"), whole, _get(u, "email"))))
        seats += 1
        if not nm:
            continue
        is_seat = nm.lower() in SERVICE_SEATS
        role = gsjs.or_text(_get(u, "role")).lower()
        people.append({"name": nm, "role": role, "service": is_seat})
        if is_seat:
            continue
        humans += 1
        if not first_human:
            first_human = nm
        if role == "owner" and not owner_named:
            owner_named = nm
    owner = owner_named or (first_human if humans == 1 else "")
    return {"digits": digits, "e164": "+1" + digits, "id": gsjs.or_text(pid), "name": gsjs.or_text(name),
            "owner": owner, "people": people, "seats": seats, "humans": humans, "forward_to": line_key(forward_to),
            "role": "", "role_known": False, "shared": False, "shared_why": ""}


def forward(p: Any) -> str:
    """hubLineForward_: the forward, whatever shape it arrives in."""
    if gsjs.falsy(p):
        return ""
    v = _or(_get(p, "forwardTo"), _get(p, "forward"), _get(p, "forwarding"), "")
    if not gsjs.falsy(v) and isinstance(v, (dict, list)):
        v = _or(_get(v, "to"), _get(v, "number"), _get(v, "phoneNumber"), "")
    return gsjs.or_text(v)


def from_provider(data: Any) -> list[dict[str, Any]]:
    """hubLineFromProvider_: the provider's /v1/phone-numbers payload → rows."""
    listed = _or(_get(data, "data"), [])
    if not isinstance(listed, list):
        raise TypeError("data.data.forEach is not a function")
    out = []
    for p in listed:
        row = row_build(_get(p, "id"), _get(p, "number"), _get(p, "name"), _or(_get(p, "users"), []), forward(p))
        if row:
            out.append(row)
    return out


def from_platform(rows: Any) -> list[dict[str, Any]]:
    """hubLineFromPlatform_: the platform's asa_openphone_lines rows → the same shape."""
    out = []
    for r in rows or []:
        users = _or(_get(r, "assigned_users"), _get(r, "users"), [])
        if isinstance(users, str):
            try:
                users = json.loads(users)
            except ValueError:
                users = []
        row = row_build(_get(r, "id"), _get(r, "number"), _get(r, "name"), users,
                        _or(_get(r, "forward_to"), forward(r)))
        if row:
            out.append(row)
    return out


# ---- the verdict ----------------------------------------------------------------------------------------------------

def derive_shared(rows: list) -> list:
    """hubLineDeriveShared_: shared from three facts — more than one person holds it, another line forwards to it, it
    is declared — and the declared role; the rows themselves are changed and handed back."""
    floor = shared_floor()
    targets: dict[str, Any] = {}
    for r in rows or []:
        if not gsjs.falsy(r.get("forward_to")):
            targets[gsjs.js_str(r["forward_to"])] = r.get("digits")
    for r in rows or []:
        d = gsjs.or_blank(r.get("digits"))
        why = []
        h = r.get("humans")
        if isinstance(h, (int, float)) and not isinstance(h, bool) and h > 1:
            why.append(gsjs.js_str(h) + " people hold it")
        src = targets.get(d)
        if not gsjs.falsy(src):
            why.append("+1" + gsjs.js_str(src) + " forwards to it")
        if d in floor:
            why.append("declared a shared line")
        r["shared"] = len(why) > 0
        r["shared_why"] = " · ".join(why)
        r["forwards_from"] = _or(src, "")
        word = ROLE_WORDS.get(d)
        r["role"] = gsjs.js_str(word) if word else ""
        r["role_known"] = bool(word)
    return rows


# ---- the store ------------------------------------------------------------------------------------------------------

def _exec(sql: str, params: tuple) -> bool:
    """Through the write's own cursor inside a write, else the bound store's connection; False when neither is had."""
    cur = W.HELD.get()
    if cur is not None:
        cur.execute(sql, params)
        return True
    store = _BOUND.get("store")
    if store is None or not store.available:
        return False
    store.conn().execute(sql, params)
    return True


def _cache_put(text: str, write: str = "") -> None:
    with _CACHE_LOCK:
        _CACHE.clear()
        _CACHE.update(text=text, until=time.time() + CACHE_SECONDS, write=write)


def _cache_get(reads: L.Reads) -> str:
    """The cached directory's JSON, or ''. One a write put there is served once Postgres holds that write's row, and
    dropped when it does not (the write was rolled back)."""
    with _CACHE_LOCK:
        held = dict(_CACHE)
    if not held or held["until"] <= time.time():
        return ""
    if held["write"]:
        try:
            kept = bool(RR._q(reads, f"select 1 from {TABLE} where key = %s and write_id = %s",
                              (STORED_KEY, held["write"])))
        except Exception:  # noqa: BLE001 - an unread cache entry is simply not a cache entry
            return ""
        with _CACHE_LOCK:
            if _CACHE.get("write") == held["write"]:
                if kept:
                    _CACHE["write"] = ""
                else:
                    _CACHE.clear()
        if not kept:
            return ""
    return held["text"]


def stored(reads: L.Reads) -> dict[str, Any] | None:
    """hubLineStored_: the last good directory, or None."""
    try:
        got = RR._q(reads, f"select directory from {TABLE} where key = %s", (STORED_KEY,))
    except Exception as exc:  # noqa: BLE001 - hubProp_ failing reads as nothing stored
        log.warning("line directory: the stored copy was not read (%s)", type(exc).__name__)
        return None
    held = _json(got[0][0]) if got else None
    if not isinstance(held, dict) or not _has_lines(held):
        return None
    held["lines"] = [_ordered(r) for r in held["lines"]]
    return held


def store(directory: dict[str, Any], *, held: bool = False) -> None:
    """hubLineStore_: the directory kept and cached, and the road open again. `held`: inside the write that hands the
    directory over, under its lock — kept there or not at all; otherwise each step that fails is let go, as Apps
    Script lets the property or the cache go."""
    text = _text(directory)
    if held:
        cur = RR._cur()
        cur.execute(_UPSERT, (STORED_KEY, text, SC.write_id()))
        cur.execute(f"delete from {TABLE} where key = %s", (SHUT_KEY,))
        _cache_put(text, SC.write_id())
        return
    try:
        if not _exec(_UPSERT, (STORED_KEY, text, SC.write_id())):
            log.warning("line directory: no write store, the directory was not kept")
    except Exception as exc:  # noqa: BLE001 - the cache still answers
        log.warning("line directory: the directory was not kept (%s)", type(exc).__name__)
    _cache_put(text)
    try:
        _exec(f"delete from {TABLE} where key = %s", (SHUT_KEY,))
    except Exception as exc:  # noqa: BLE001 - it expires anyway
        log.warning("line directory: the shut road was not opened (%s)", type(exc).__name__)


def road_shut_why(reads: L.Reads) -> str:
    """hubLineRoadShut_ and hubLineRoadShutWhy_: the refusal remembered, '' when the road is open."""
    try:
        got = RR._q(reads, f"select directory ->> 'why' from {TABLE} where key = %s"
                           f" and updated_at > now() - interval '{SHUT_SECONDS} seconds'", (SHUT_KEY,))
    except Exception:  # noqa: BLE001 - unread is open: we simply knock again
        return ""
    return gsjs.or_text(got[0][0]) if got else ""


def road_shut_note(why: Any) -> None:
    """hubLineRoadShutNote_: the refusal remembered for SHUT_SECONDS."""
    try:
        _exec(_UPSERT, (SHUT_KEY, _text({"why": gsjs.js_str(_or(why, "shut"))[:200]}), SC.write_id()))
    except Exception as exc:  # noqa: BLE001 - no note: we simply knock again
        log.warning("line directory: the refusal was not remembered (%s)", type(exc).__name__)


def age_hours(reads: L.Reads, at: Any) -> float:
    """hubLineAgeHours_: how old the copy is, in hours, or -1 when it cannot be told."""
    t = gsjs.date_parse(gsjs.or_text(at))
    if t is None:
        return -1
    return max(0, gsjs.js_round((reads.now.timestamp() * 1000.0 - t) / 36000) / 100)


# ---- the fetch ------------------------------------------------------------------------------------------------------

def provider_fetch() -> dict[str, Any]:
    """hubLineProviderFetch_: the provider, once. Never logs or returns the key."""
    key = SC._key()
    if not key:
        return {"ok": False, "why": f"no OpenPhone key in the file {SC.KEY_FILE_ENV} names"}
    try:
        code, text = SC._http("GET", SC.PROVIDER + "/phone-numbers", key)
    except Exception as exc:  # noqa: BLE001 - said, never raised
        return {"ok": False, "why": "the provider was unreachable: " + (str(exc) or type(exc).__name__)}
    if code != 200:
        return {"ok": False, "why": f"the provider answered {code}"}
    try:
        got = json.loads(text or "{}")
    except ValueError:
        return {"ok": False, "why": "the provider answered something that is not JSON"}
    rows = from_provider(got)
    if not rows:
        # a list with no lines in it is not a company with no lines
        return {"ok": False, "why": 'the provider listed no lines — refused rather than stored as "we own none"'}
    return {"ok": True, "rows": rows}


# ---- the answer -----------------------------------------------------------------------------------------------------

def lines(reads: L.Reads, force: bool = False) -> dict[str, Any]:
    """hubLines_: the directory — this request's, the cache, the stored copy inside the refresh window, the stored copy
    while the road is shut, the provider, the stored copy however old, and last the declared shared lines alone."""
    memo = reads.memo.get(MEMO)
    if not force and memo is not None:
        return memo

    if not force:
        hit = _cache_get(reads)
        if hit:
            try:
                cached = json.loads(hit)
            except ValueError:
                cached = None
            if _has_lines(cached):
                reads.memo[MEMO] = cached
                return cached

        held = stored(reads)
        if held:
            held_age = age_hours(reads, held.get("at"))
            if 0 <= held_age <= CACHE_SECONDS / 3600:
                # `source` is where this answer came from, not where the facts were born
                warm = {"ok": True, "at": held.get("at"), "source": "stored",
                        "stored_from": _or(held.get("source"), ""), "stale": False,
                        "why": f"the copy stored {gsjs.num_str(held_age)} hour(s) ago, inside the refresh window",
                        "lines": derive_shared(held["lines"])}
                _cache_put(_text(warm))
                reads.memo[MEMO] = warm
                return warm

        # and we do not knock on a door that just refused
        shut = road_shut_why(reads) if held else ""
        if held and shut:
            shut_age = age_hours(reads, held.get("at"))
            when = "at an unreadable time" if shut_age < 0 else f"{gsjs.num_str(shut_age)} hour(s) ago"
            shut_out = {"ok": False, "at": held.get("at"), "source": "stored",
                        "stored_from": _or(held.get("source"), ""), "stale": shut_age < 0 or shut_age > STALE_HOURS,
                        "why": f"{shut or 'the provider refused'} — not asked again for {SHUT_SECONDS}s; answering "
                               f"with the copy stored {when}",
                        "lines": derive_shared(held["lines"])}
            reads.memo[MEMO] = shut_out
            return shut_out

    got = provider_fetch()
    if got["ok"]:
        fresh = {"ok": True, "at": W.now_iso(reads), "source": "provider", "stale": False, "why": "",
                 "lines": derive_shared(got["rows"])}
        store(fresh)
        reads.memo[MEMO] = fresh
        return fresh

    # the road was shut
    road_shut_note(got["why"])
    kept = stored(reads)
    if kept:
        age = age_hours(reads, kept.get("at"))
        when = "at an unreadable time" if age < 0 else f"{gsjs.num_str(age)} hour(s) ago"
        out = {"ok": False, "at": kept.get("at"), "source": "stored", "stale": age < 0 or age > STALE_HOURS,
               "why": f"{got['why']} — answering with the copy stored {when}", "lines": derive_shared(kept["lines"])}
        reads.memo[MEMO] = out
        return out

    # nothing stored either
    floor_rows = [{"digits": d, "e164": "+1" + d, "id": "", "name": "", "owner": "", "people": [], "seats": 0,
                   "humans": 0, "forward_to": "", "forwards_from": "",
                   "role": gsjs.js_str(ROLE_WORDS[d]) if ROLE_WORDS.get(d) else "",
                   "role_known": bool(ROLE_WORDS.get(d)), "shared": True, "shared_why": "declared a shared line"}
                  for d in shared_floor()]
    floor_out = {"ok": False, "at": "", "source": "declaration", "stale": True,
                 "why": got["why"] + " — and nothing was stored, so only the declared shared lines answer. This is "
                                     "NOT the list of lines we own.",
                 "lines": floor_rows}
    reads.memo[MEMO] = floor_out
    return floor_out


# ---- the readers ----------------------------------------------------------------------------------------------------

def line_row(reads: L.Reads, v: Any) -> dict[str, Any] | None:
    """hubLineRow_: one line, by its digits or by its provider id."""
    raw = gsjs.trim(gsjs.or_blank(v))
    if not raw:
        return None
    key = line_key(raw)
    for r in lines(reads)["lines"]:
        if key and r.get("digits") == key:
            return r
        if not key and not gsjs.falsy(r.get("id")) and r.get("id") == raw:
            return r
    return None


def line_ours(reads: L.Reads, v: Any) -> bool:
    """hubLineOurs_: one of our own lines, shared or personal."""
    key = line_key(v)
    return bool(key) and any(r.get("digits") == key for r in lines(reads)["lines"])


def shared_for_identity(reads: L.Reads, v: Any) -> bool:
    """hubLineSharedForIdentity_: true when the number does NOT name a person."""
    key = line_key(v)
    if not key:
        return False
    if key in shared_floor():
        return True
    try:
        row = line_row(reads, key)
    except Exception:  # noqa: BLE001 - an unread directory names nobody shared
        row = None
    return bool(row and row.get("shared"))


def line_label(reads: L.Reads, v: Any) -> str:
    """hubLineLabel_: how a human reads a line in a report; a failed look is not a negative finding."""
    raw = gsjs.trim(gsjs.or_blank(v))
    row = line_row(reads, raw)
    if not row:
        if is_provider_id(raw):
            return raw + " · a provider line id we could not resolve"
        if not raw:
            return "(no line)"
        key = line_key(raw)
        if not key:
            return raw
        try:
            d = lines(reads)
        except Exception:  # noqa: BLE001 - said as nothing answered
            d = None
        if not d or gsjs.falsy(d.get("ok")):
            seen = gsjs.or_text(_or(_get(d, "source"), "nothing answered"))
            return f"+1{key} · not in the copy we could read ({seen}) — NOT a line we know we do not own"
        return f"+1{key} · not one of our lines"
    bits = [row["e164"]]
    if row.get("name"):
        bits.append(row["name"])
    if row.get("role"):
        bits.append(row["role"])
    elif row.get("owner"):
        bits.append(f"owner {row['owner']} · role not named")
    if row.get("shared"):
        bits.append(f"shared — {row.get('shared_why')}")
    return " · ".join(bits)


# ---- the census -----------------------------------------------------------------------------------------------------

def _transcripts(reads: L.Reads) -> list[dict]:
    """readTabNormalized_(ssOpen_(hubId_('HUB_COMMS_ID')), 'transcripts'), off asa-hub-db's copy of that book."""
    sid = reads.db.prop(COMMS_PROP)
    if not sid:
        raise hubdb.Unreadable(f"{COMMS_PROP} names no book")
    ref = HT.tab_of(reads, sid, COMMS_TAB, f"{COMMS_PROP} {COMMS_TAB}")
    if ref is None:
        raise hubdb.Unreadable(f"Talent tab missing: {COMMS_TAB}")
    return reads.db.normalized_rows(ref)


def census(reads: L.Reads) -> dict[str, Any]:
    """hubLineCallCensus_: the calls that carry no line, counted and named; missing is not zero."""
    try:
        rows = _transcripts(reads)
    except Exception as exc:  # noqa: BLE001 - a census that could not read is not a census of nothing
        return {"ok": False, "why": "the comms mirror could not be read: " + (str(exc) or type(exc).__name__),
                "calls": 0, "by_line": {}, "no_line": None}
    by_line: dict[str, dict[str, Any]] = {}
    no_line: dict[str, Any] = {"calls": 0, "empty": 0, "by_provider_id": {}, "resolved": 0}
    for t in rows:
        raw = gsjs.trim(gsjs.or_text(_get(t, "quonumber")))
        key = line_key(raw)
        if not key:
            no_line["calls"] += 1
            if is_provider_id(raw):
                row = line_row(reads, raw)
                seen = no_line["by_provider_id"].get(raw)
                if seen is None:
                    seen = no_line["by_provider_id"][raw] = {
                        "calls": 0, "resolves_to": row["e164"] if row else "",
                        "named": _or(row.get("name"), row.get("owner")) if row else ""}
                seen["calls"] += 1
                if row:
                    no_line["resolved"] += 1
                    key = row["digits"]
            else:
                no_line["empty"] += 1
            if not key:
                continue
        got = by_line.get(key)
        if got is None:
            got = by_line[key] = {"calls": 0, "label": line_label(reads, key),
                                  "shared": shared_for_identity(reads, key), "ours": line_ours(reads, key)}
        got["calls"] += 1
    return {"ok": True, "why": "", "window_days": COMMS_WINDOW_DAYS, "calls": len(rows), "by_line": _js_order(by_line),
            "no_line": no_line}


# ---- the doors ------------------------------------------------------------------------------------------------------

def line_directory(sess: L.Session, payload: dict) -> dict[str, Any]:
    """lineDirectory: the directory, asked again of the provider on `refresh`, with the census on `census`."""
    user = sess.user
    if not user or not gsjs.falsy(user.get("is_service")):
        return dict(DENIED)
    if s_(user.get("role")) not in ("admin", "manager"):
        return dict(DENIED)
    p = payload if isinstance(payload, dict) else {}
    d = lines(sess.reads, not gsjs.falsy(p.get("refresh")))
    out: dict[str, Any] = {"ok": d.get("ok"), "source": d.get("source"), "at": d.get("at"),
                           "stale": not gsjs.falsy(d.get("stale")), "why": d.get("why"), "lines": d.get("lines"),
                           "shared_floor": shared_floor(), "never": list(NEVER)}
    if not gsjs.falsy(p.get("census")):
        out["census"] = census(sess.reads)
    return {"status": 200, "data": out}


def line_directory_sync(sess: L.Session, payload: dict) -> Decision:
    """lineDirectorySync: the platform's copy handed over — asa_openphone_lines rows, the ones server/line_directory.py
    builds — stored as the directory, by an admin or the relay's own identity."""
    user = sess.user
    machine = bool(user) and not gsjs.falsy(user.get("is_service"))
    if not machine and (not user or s_(user.get("role")) != "admin"):
        return Decision(dict(DENIED))
    p = payload if isinstance(payload, dict) else {}
    rows = p.get("rows")
    if not isinstance(rows, list) or not rows:
        return W.refuse(400, "No rows — the line directory is left as it is.")
    built = from_platform(rows)
    if not built:
        return W.refuse(400, "No row carried a usable number — nothing was stored.")
    d = {"ok": True, "at": W.now_iso(sess.reads), "source": "platform", "stale": False, "why": "",
         "lines": derive_shared(built)}
    store(d, held=True)
    sess.reads.memo[MEMO] = d
    shared = sum(1 for r in d["lines"] if r["shared"])
    half = sum(1 for r in d["lines"] if not r["role_known"])
    source_at = s_(p.get("source_at"))
    log.info("line_directory_sync by %s: %s", "asa-hub:lines" if machine else s_(user.get("email")),
             f"{len(d['lines'])} line(s) from the platform · {shared} shared · {half} with an owner and no role"
             + (f" · list as of {source_at}" if source_at else ""))
    return Decision({"status": 200, "data": {"stored": len(d["lines"]), "shared": shared, "role_missing": half,
                                             "received": len(rows)}}, subject="", own=True)


READ_ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {"lineDirectory": line_directory}
WRITE_ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {"lineDirectorySync": line_directory_sync}
ACTIONS = READ_ACTIONS
# HUB_POLICY: the roles each action is declared for, and its typed params
POLICY: dict[str, dict[str, Any]] = {
    "lineDirectory": {"roles": ("admin", "manager"), "params": {"refresh": "boolean", "census": "boolean"}},
    "lineDirectorySync": {"roles": ("admin",), "params": {"rows": "array"}}}
