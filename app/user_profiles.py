"""Users › a person's profile, the admin's reads (apps-script/Profile.gs userConversations and userComms,
apps-script/ProfileDeep.gs userDriveDocs and userProfileDeep), the same answers off asa-hub-db and Drive.

The deep profile is kept, as ProfileDeep.gs keeps it in entity_user_profiles, in the Hub's own table
(app.user_profile_store, made by the bound write store): one row per account, read back while it is under
PROFILE_STALE_HOURS old; a row Apps Script stored on the tab is read too, the newer of the two answering."""
from __future__ import annotations

import functools
import json
import logging
import re
import threading
import time
from datetime import datetime, timezone
from typing import Any, Callable

import candidates as CND
import client_care_sweeps as CCS
import clients as C
import gsjs
import house_tables as HT
import hubdb
import line_directory as LD
import locations as L
import opt_outs as OO
import smart_comms_desk as SCD
import staff as SP
import staff_comms as STC
import staff_views
from scope import Defer

log = logging.getLogger("asa-hub-app")

APP_ID = "user-profiles"
DENIED = {"status": 403, "message": "Requires an admin or manager account"}
_CID = re.compile(r"^CAN_[A-Za-z0-9]{6,}\Z")
CONVERSATIONS_CAP = 50
# userComms: the Quo Webhook Log read from its tail, and the caps of each list
WEBHOOK_TAB = "Webhook Log"
WEBHOOK_TAIL = 4000
WEBHOOK_MESSAGES_CAP = 200
# ProfileDeep.gs
PROFILE_DRIVE_ROOT_PROPS = ("COMPLIANCE_SHARED_FOLDER_ID", "PENDING_DOCS_FOLDER_ID")
USER_DOCS_ROOT_PROP = "PROFILE_USER_DOCS_ROOT"
PROFILE_STORE_TAB = "entity_user_profiles"
PROFILE_STALE_HOURS = 6
PROFILE_STORE_MAX = 45000
PROFILE_DOC_SNIPPET_CHARS = 3000
PROFILE_DOC_SNIPPET_FILES = 4
PROFILE_FILES_CAP = 40
USER_DOCS_LOOSE_CAP = 500
USER_DOCS_CATEGORY_ORDER = ("Background Checks", "Medical", "Driving", "Training", "Other")
GOOGLE_DOC = "application/vnd.google-apps.document"
SNIPPET_BYTES = 1 << 20
# the model's answer is waited on this long after the door opens: the relay waits BACKEND_LONG_READS (110 s)
PROFILE_MODEL_BUDGET_S = 95.0
FOLDER_URL = "https://drive.google.com/drive/folders/"
STORE_TABLE = "app.user_profile_store"
_BOUND: dict[str, Any] = {}
_MADE = threading.Event()

s_ = gsjs.str_


def bind(store: Any) -> None:
    """The write store whose connection keeps the stored profiles (main.py's Staff store, as staff_views)."""
    _BOUND["store"] = store


def ddl() -> tuple[str, ...]:
    return (f"create table if not exists {STORE_TABLE} (user_id text primary key, name text not null default '',"
            " name_key text not null default '', updated_at text not null default '', summary text not null default '',"
            " payload text not null default '', kept_at timestamptz not null default now())",)


def _conn() -> Any:
    store = _BOUND.get("store")
    if store is None or not store.available:
        raise RuntimeError("no write store keeps the stored profiles")
    c = store.conn()
    if not _MADE.is_set():
        for stmt in ddl():
            c.execute(stmt)
        _MADE.set()
    return c


# ---- what JavaScript does --------------------------------------------------------------------------------------------

def _or(*vals: Any) -> Any:
    """a || b || …: the first truthy value, else the last."""
    for v in vals[:-1]:
        if not gsjs.falsy(v):
            return v
    return vals[-1]


def _cut(s: str, n: int) -> str:
    """String.prototype.slice(0, n) in UTF-16 units; a pair the cut splits loses its lone half (JSON carries none)."""
    units = s.encode("utf-16-le", "surrogatepass")
    if len(units) <= 2 * n:
        return s
    cut = units[:2 * n]
    if 0xD800 <= int.from_bytes(cut[-2:], "little") <= 0xDBFF:
        cut = cut[:-2]
    return cut.decode("utf-16-le", "surrogatepass")


def _js_len(s: str) -> int:
    return len(s.encode("utf-16-le", "surrogatepass")) // 2


def _newest_first(field: str) -> Callable[[Any], Any]:
    """sort(a.f < b.f ? 1 : -1)."""
    return functools.cmp_to_key(lambda a, b: 1 if a[field] < b[field] else -1)


def _json(v: Any) -> str:
    """JSON.stringify."""
    return json.dumps(v, ensure_ascii=False, separators=(",", ":"))


def _digits(v: Any) -> str:
    """commsDigits_."""
    return re.sub(r"\D+", "", gsjs.or_text(v))


def _quiet(fn: Callable[[], Any]) -> Any:
    """A try/catch of Apps Script's that answers nothing: what this side cannot read is never taken for nothing."""
    try:
        return fn()
    except (Defer, hubdb.Unreadable):
        raise
    except Exception:  # noqa: BLE001 - the port's own catch
        return None


def _tried(fn: Callable[[], None]) -> bool:
    """_quiet for a step whose catch says it failed: False when it threw."""
    try:
        fn()
        return True
    except (Defer, hubdb.Unreadable):
        raise
    except Exception:  # noqa: BLE001 - the port's own catch, said by the caller
        return False


def _js_length(v: Any) -> Any:
    """v.length of a parsed JSON value: an array's or a string's, an object's own `length`, else undefined."""
    if isinstance(v, (list, str)):
        return len(v)
    return v.get("length") if isinstance(v, dict) else None


# ---- the doors' shared halves ----------------------------------------------------------------------------------------

def _admin(user: dict | None) -> bool:
    """!user || user.is_service || user.role !== 'admin' → hubDenied_."""
    u = user or {}
    return bool(u) and not u.get("is_service") and s_(u.get("role")) == "admin"


def user_row(reads: L.Reads, uid: str) -> dict | None:
    """tenantUserRow_ at headquarters: the users row of this id, the first one the tab holds."""
    if not uid:
        return None
    return next((u for u in reads.users() if s_(u.get("userid")) == uid), None)


def _missing(uid: str) -> dict[str, Any]:
    return {"status": 404, "message": 'No user "' + uid + '".'}


# ---- userConversations -----------------------------------------------------------------------------------------------

def _ledger_sends(reads: L.Reads, cid: str) -> list[dict[str, str]]:
    """smartLedgerSheet_'s rows for the candidate: its own sends and those under it (`<cid>:…`)."""
    got = SCD.ledger_rows(reads)
    if got is None:
        return []
    rows, heads = got
    out = []
    for _rn, raw in rows:
        cell = {h: s_(hubdb.typed(raw.get(heads[h]), "hub")) for h in SCD.SMART_LEDGER_HEADER}
        person = cell["person"]
        if person != cid and not person.startswith(cid + ":"):
            continue
        out.append({"situation": cell["situation"], "channel": cell["channel"], "at": cell["at"]})
    return out


def user_conversations(sess: L.Session, payload: dict) -> dict[str, Any]:
    """userConversations: what the platform heard from the candidate an account is linked to — the inbound messages,
    the phone screen's transcript and every Smart Comms send."""
    if not _admin(sess.user):
        return dict(DENIED)
    reads = sess.reads
    cid = s_((payload or {}).get("candidate_id"))
    if not _CID.match(cid):
        return {"status": 200, "data": {"messages": [], "transcript": None, "sends": []}}

    def inbound() -> list[dict]:
        return [{"at": s_(m.get("receivedat")), "body": _cut(s_(m.get("body")), 500), "intent": s_(m.get("intent"))}
                for m in OO.inbound_rows(reads) if s_(m.get("candidateid")) == cid]
    messages = _quiet(inbound) or []
    messages.sort(key=_newest_first("at"))

    def screen() -> dict | None:
        ev = CND.evidence(reads, cid)
        sc = ev.get("screen")
        if not sc:
            return None
        t = {"url": s_(sc.get("transcripturl")), "text": _cut(s_(sc.get("transcripttext")), 2000),
             "at": s_(sc.get("updatedat")) or s_(sc.get("createdat"))}
        return t if t["url"] or t["text"] else None
    transcript = _quiet(screen)
    sends = _quiet(lambda: _ledger_sends(reads, cid)) or []
    sends.sort(key=_newest_first("at"))
    return {"status": 200, "data": {"messages": messages[:CONVERSATIONS_CAP], "transcript": transcript,
                                    "sends": sends[:CONVERSATIONS_CAP]}}


# ---- userComms -------------------------------------------------------------------------------------------------------

def _comms_rows(reads: L.Reads, sid: str, tab: str) -> list[dict]:
    """readTabNormalized_(comms, tab): none for a tab the book does not hold (its catch)."""
    ref = HT.tab_of(reads, sid, tab, f"the comms mirror's {tab}")
    if ref is None:
        return []
    return STC._normalized(reads, ref, STC._is_hub_db(reads, sid))


def _webhook_tail(reads: L.Reads, sid: str) -> tuple[list[tuple[int, dict]], int] | None:
    """The Webhook Log's last WEBHOOK_TAIL rows (getRange of its tail, its 2nd and 5th columns by place) and how many
    rows that range spans; None when the book has no such tab or it holds no row."""
    ref = reads.db.tab(sid, WEBHOOK_TAB)
    if ref is None:
        return None
    if not re.fullmatch(r"[a-z0-9_]{1,63}", ref.table):
        raise hubdb.Unreadable(f"the catalog names an unusable table for {WEBHOOK_TAB}")
    reads.db.note_book(sid)
    got = reads.db.query(f'select max(row_number) from {reads.db.from_sql(ref)}')  # noqa: S608
    last = int(got[0][0]) if got and got[0][0] is not None else 1
    if last < 2:
        return None
    start = max(2, last - WEBHOOK_TAIL + 1)
    heads = list(ref.headers)
    typ_h = heads[1] if len(heads) > 1 else None
    body_h = heads[4] if len(heads) > 4 else None
    rows = []
    for rn, raw in reads.db.query(f'select row_number, _raw from {reads.db.from_sql(ref)}'  # noqa: S608
                                  " where row_number >= %s order by row_number", (start,)):
        if isinstance(raw, str):
            raw = json.loads(raw)
        raw = raw if isinstance(raw, dict) else {}
        rows.append((int(rn), {"type": raw.get(typ_h) if typ_h is not None else None,
                               "body": raw.get(body_h) if body_h is not None else None}))
    return rows, last - start + 1


def _field(o: Any, key: str) -> Any:
    """o[key] of a parsed JSON value: undefined for anything that is not an object."""
    return o.get(key) if isinstance(o, dict) else None


def user_comms(sess: L.Session, payload: dict) -> dict[str, Any]:
    """userComms: the transcripts, messages and summaries in the comms mirror that carry one of the account's numbers,
    and the webhook log's texts beyond the mirror's window."""
    if not _admin(sess.user):
        return dict(DENIED)
    reads = sess.reads
    uid = s_((payload or {}).get("user_id"))
    if not uid:
        return {"status": 400, "message": "user_id is required"}
    row = user_row(reads, uid)
    if row is None:
        return _missing(uid)
    digits: dict[str, bool] = {}

    def take(p: Any) -> None:
        d = _digits(p)[-10:]
        if len(d) >= 7:
            digits[d] = True
    for p in [s_(row.get("phone"))] + re.split(r"[,;|]", gsjs.or_text(row.get("phones"))):
        take(p)

    def roster() -> None:
        key = gsjs.name_key(s_(row.get("displayname")))
        if not key:
            return
        matches = [p for p in reads.hub_rows("people") if gsjs.name_key(s_(p.get("name"))) == key]
        if len(matches) == 1:
            take(s_(matches[0].get("phone")))
    _quiet(roster)

    def candidate() -> None:
        cid = s_(row.get("candidateid"))
        if cid:
            for c in CND.read_tab(reads, CND.TALENT_CANDIDATES_TAB):
                if s_(c.get("candidateid")) == cid:
                    take(s_(c.get("phone")))
    _quiet(candidate)
    d_list = list(digits)

    def hits(v: Any) -> bool:
        if not d_list:
            return False
        s = _digits(v)
        return any(d in s for d in d_list)

    out: dict[str, Any] = {"transcripts": [], "messages": [], "summaries": [], "window_days": LD.COMMS_WINDOW_DAYS,
                           "numbers": len(d_list)}
    if not d_list:
        return {"status": 200, "data": out}
    sid = gsjs.trim(gsjs.or_blank(reads.db.prop("HUB_COMMS_ID")))
    if not sid or reads.db.book(sid) is None:
        raise hubdb.Unreadable("asa-hub-db holds no copy of the comms mirror (HUB_COMMS_ID)")
    my_calls: dict[str, bool] = {}

    def transcripts() -> None:
        for t in _comms_rows(reads, sid, "transcripts"):
            as_participant = hits(t.get("participants"))
            as_team = not as_participant and hits(t.get("teammembers"))
            if not as_participant and not as_team:
                continue
            my_calls[s_(t.get("callid"))] = True
            out["transcripts"].append({
                "call_id": s_(t.get("callid")), "at": s_(t.get("transcriptcreated")), "secs": s_(t.get("durationsec")),
                "turns": s_(t.get("turns")), "line": s_(t.get("quonumber")), "participant": s_(t.get("participants")),
                "direction": s_(t.get("direction")), "status": s_(t.get("status")),
                "as": "participant" if as_participant else "team"})
    _quiet(transcripts)

    def messages() -> None:
        for m in _comms_rows(reads, sid, "messages"):
            as_participant = hits(m.get("externalparticipants"))
            as_team = not as_participant and hits(m.get("teammember"))
            if not as_participant and not as_team:
                continue
            out["messages"].append({
                "id": s_(m.get("messageid")), "at": s_(m.get("messagecreated")), "direction": s_(m.get("direction")),
                "type": s_(m.get("messagetype")), "status": s_(m.get("status")), "body": _cut(s_(m.get("body")), 400),
                "with_number": s_(m.get("externalparticipants")), "as": "participant" if as_participant else "team"})
    _quiet(messages)

    def webhook() -> None:
        quo = gsjs.trim(gsjs.or_blank(reads.db.prop("QUO_SYNC_SHEET_ID")))
        if not quo:
            return
        if reads.db.book(quo) is None:
            raise hubdb.Unreadable("asa-hub-db holds no copy of the Quo workbook (QUO_SYNC_SHEET_ID)")
        tail = _webhook_tail(reads, quo)
        if tail is None:
            return
        log_rows, spanned = tail
        needle = gsjs.text(s_(row.get("displayname"))).lower()
        if _js_len(needle) < 5:
            needle = ""
        have = {m["id"]: True for m in out["messages"]}
        for _rn, cells in reversed(log_rows):
            typ = gsjs.or_text(hubdb.typed(cells["type"], "raw"))
            if typ not in ("message.received", "message.delivered"):
                continue
            try:
                parsed = json.loads(gsjs.or_text(hubdb.typed(cells["body"], "raw")))
            except ValueError:
                continue
            # JSON.parse(…).data.object: a missing `data` throws inside the try; a missing `object` throws after it
            data = parsed.get("data") if isinstance(parsed, dict) else None
            if data is None:
                continue
            o = data.get("object") if isinstance(data, dict) else None
            if o is None:
                return
            mid = gsjs.or_text(_field(o, "id"))
            if not mid or have.get(mid):
                continue
            body = gsjs.or_text(_field(o, "body"))
            num_hit = hits(gsjs.or_text(_field(o, "from")) + " " + gsjs.or_text(_field(o, "to")))
            name_hit = bool(needle) and needle in body.lower()
            if not num_hit and not name_hit:
                continue
            have[mid] = True
            direction = _field(o, "direction")
            outgoing = direction is not None and gsjs.js_str(direction) == "outgoing"
            media = _field(o, "media")
            out["messages"].append({
                "id": mid, "at": gsjs.or_text(_field(o, "createdAt")), "direction": gsjs.or_text(direction),
                "type": "mms" if not gsjs.falsy(media) and not gsjs.falsy(_js_length(media)) else "sms",
                "status": gsjs.or_text(_field(o, "status")), "body": _cut(body, 400),
                "with_number": gsjs.or_text(_field(o, "to")) if outgoing else gsjs.or_text(_field(o, "from")),
                "as": "participant" if num_hit else "named", "source": "webhook"})
            if len(out["messages"]) >= WEBHOOK_MESSAGES_CAP:
                break
        out["webhook_scanned"] = spanned
    _quiet(webhook)

    def summaries() -> None:
        for s in _comms_rows(reads, sid, "summaries"):
            if not hits(s.get("participants")) and not my_calls.get(s_(s.get("callid"))):
                continue
            out["summaries"].append({"call_id": s_(s.get("callid")), "at": s_(s.get("created")),
                                     "direction": s_(s.get("direction")), "secs": s_(s.get("durationsec")),
                                     "summary": s_(s.get("summary"))})
    _quiet(summaries)
    for k in ("transcripts", "messages", "summaries"):
        out[k].sort(key=_newest_first("at"))
    out["transcripts"] = out["transcripts"][:50]
    out["messages"] = out["messages"][:100]
    out["summaries"] = out["summaries"][:50]
    return {"status": 200, "data": out}


# ---- the Drive folders (profileDriveIndex_, userDocsIndex_, userDocsLooseAll_, profileDriveFiles_) -------------------

def _drive_day(f: dict) -> str:
    """file.getLastUpdated().toISOString().slice(0, 10)."""
    return STC._drive_utc_day(f.get("modifiedTime"))


def _file_out(f: dict) -> dict[str, str]:
    return {"name": gsjs.or_blank(f.get("name")), "id": gsjs.or_blank(f.get("id")),
            "url": gsjs.or_blank(f.get("webViewLink")), "mime": gsjs.or_blank(f.get("mimeType")),
            "updated": _drive_day(f)}


def folder_files(drv: Any, folder_id: str, what: str) -> list[dict[str, str]]:
    """profileDriveFiles_: the folder's first files as DriveApp hands them (40), newest first; a folder holding more,
    or a trashed one DriveApp may count, is Apps Script's to read in its own order."""
    got = STC._drive_query(drv, f"'{folder_id}' in parents and mimeType != '{STC.FOLDER_MIME}'",
                           "id,name,mimeType,modifiedTime,trashed,webViewLink", what)
    if any(f.get("trashed") for f in got):
        raise Defer(f"{what} holds a trashed file, which DriveApp's own listing may count")
    if len(got) > PROFILE_FILES_CAP:
        raise Defer(f"{what} holds more files than the read takes, in DriveApp's own order")
    out = [_file_out(f) for f in got]
    out.sort(key=_newest_first("updated"))
    return out


def _loose_all(drv: Any, root: str, needle: str) -> list[dict[str, str]]:
    """userDocsLooseAll_: the files lying directly in the staff documents room (500 at most, held six hours)."""
    what = "the staff documents room"

    files = f"'{root}' in parents and mimeType != '{STC.FOLDER_MIME}'"

    def read() -> dict[str, list[dict]]:
        live, gone = STC._together([
            lambda: STC._drive_query(drv, files + " and trashed = false", "id,name,mimeType,modifiedTime,webViewLink",
                                     what),
            lambda: STC._drive_query(drv, files + " and trashed = true", "id,name", what)])
        return {"live": live, "gone": gone}
    held = STC._held("user-docs-loose:" + root, STC.DRIVE_INDEX_TTL_S, read)
    if len(held["live"]) + len(held["gone"]) > USER_DOCS_LOOSE_CAP or \
            any(needle in gsjs.or_text(f.get("name")).lower() for f in held["gone"]):
        raise Defer("the staff documents room's loose files are not all read, or a trashed one carries this name")
    return [_file_out(f) for f in held["live"]]


def _room_index(drv: Any, root: str) -> dict[str, Any]:
    """userDocsIndex_: the staff documents room's folders by folded name; `unreadable` when it cannot be opened."""
    if not root:
        return {"folders": {}, "unreadable": True, "trashed": set()}
    idx = STC._folder_index(drv, [root], "the staff documents room")
    return {"folders": idx["folders"], "unreadable": bool(idx["unreadable"]), "trashed": idx["trashed"]}


# ---- userDriveDocs ---------------------------------------------------------------------------------------------------

def user_drive_docs(sess: L.Session, payload: dict) -> dict[str, Any]:
    """userDriveDocs: the person's folder in the staff documents room by category, and the loose files there whose name
    holds theirs (a plain contains, never a fuzzy match)."""
    if not _admin(sess.user):
        return dict(DENIED)
    reads = sess.reads
    uid = s_((payload or {}).get("user_id"))
    if not uid:
        return {"status": 400, "message": "user_id is required"}
    row = user_row(reads, uid)
    if row is None:
        return _missing(uid)
    name = s_(row.get("displayname")) or s_(row.get("email"))
    key = gsjs.name_key(name)
    out: dict[str, Any] = {"name": name, "folder": None, "groups": [], "loose": [], "ambiguous": False,
                           "root_unreadable": False}
    drv = reads.need_drive()
    root = gsjs.trim(gsjs.or_blank(reads.db.prop(USER_DOCS_ROOT_PROP)))
    idx = _room_index(drv, root)
    out["root_unreadable"] = idx["unreadable"]
    hit = STC._hit(idx, key) if key else None
    if hit and hit.get("ambiguous"):
        out["ambiguous"] = True
        hit = None
    if hit:
        out["folder"] = {"id": hit["id"], "name": hit["name"], "url": FOLDER_URL + hit["id"]}
        subs = STC._drive_list(drv, hit["id"], True, "the person's folder")
        listed = STC._together([functools.partial(folder_files, drv, gsjs.or_blank(s.get("id")), "a category folder")
                                for s in subs])
        groups: dict[str, list] = {}
        for sub, files in zip(subs, listed):
            if not files:
                continue
            nm = gsjs.or_blank(sub.get("name"))
            if nm in groups:
                raise Defer("two category folders carry one name, and DriveApp's own order decides which is shown")
            groups[nm] = files
        for cat in USER_DOCS_CATEGORY_ORDER:
            if cat in groups:
                out["groups"].append({"name": cat, "files": groups[cat]})
        for cat in sorted(groups, key=lambda c: c.encode("utf-16-be", "surrogatepass")):
            if cat not in USER_DOCS_CATEGORY_ORDER:
                out["groups"].append({"name": cat, "files": groups[cat]})
    needle = gsjs.text(name).lower()
    if _js_len(needle) >= 5 and root:
        out["loose"] = [f for f in _loose_all(drv, root, needle) if needle in f["name"].lower()]
        out["loose"].sort(key=_newest_first("updated"))
    return {"status": 200, "data": out}


# ---- the stored profile (profileStoreGet_ / profileStorePut_) --------------------------------------------------------

def _age_hours(at: str) -> float:
    if not at:
        return 9999.0
    ms = gsjs.date_parse(at)
    return float("nan") if ms is None else (time.time() * 1000.0 - ms) / 3600000.0


def _parsed(blob: str) -> dict | None:
    try:
        got = json.loads(blob)
    except ValueError:
        return None
    return got if isinstance(got, dict) and got else None


def _kept_own(uid: str) -> tuple[str, str] | None:
    """(updated_at, payload) of the Hub's own row for the account."""
    got = _conn().execute(f"select updated_at, payload from {STORE_TABLE} where user_id = %s", (uid,)).fetchone()
    return (str(got[0] or ""), str(got[1] or "")) if got else None


def _kept_tab(reads: L.Reads, uid: str) -> tuple[str, str] | None:
    """(updated_at, payload) of the last row for the account on entity_user_profiles, as Apps Script stored it."""
    res = reads.db.resolve(PROFILE_STORE_TAB)
    if res.ref is None:
        return None
    heads = {hubdb.norm_key(h): h for h in reversed(res.ref.headers)}
    if "userid" not in heads:
        return None
    for _rn, raw in reversed(reads.db.rows(res.ref)):
        if s_(hubdb.typed(raw.get(heads["userid"]), "hub")) != uid:
            continue
        at = s_(hubdb.typed(raw.get(heads["updatedat"]), "hub")) if "updatedat" in heads else ""
        blob = gsjs.or_blank(raw.get(heads["payload"])) if "payload" in heads else ""
        return at, blob
    return None


def stored(reads: L.Reads, uid: str) -> dict[str, Any] | None:
    """profileStoreGet_: the account's stored profile and its age in hours; of the Hub's own row and the tab's, the
    one stored last answers. A store that cannot be read stores nothing (its catch)."""
    picks = []
    for read in (lambda: _kept_own(uid), lambda: _kept_tab(reads, uid)):
        try:
            got = read()
        except Exception as exc:  # noqa: BLE001 - profileStoreGet_'s catch: no stored profile
            log.info("user profiles: a stored profile was not read (%s)", type(exc).__name__)
            got = None
        if got is not None:
            picks.append(got)
    if not picks:
        return None
    at, blob = max(picks, key=lambda p: gsjs.date_parse(p[0]) or float("-inf"))
    payload = _parsed(blob)
    if payload is None:
        return None
    payload["stored_at"] = at
    return {"payload": payload, "age_hours": _age_hours(at)}


def store(uid: str, out: dict[str, Any]) -> str:
    """profileStorePut_: the profile kept without its snippets (a cell's limit, as on the tab); when it was kept."""
    slim = {k: v for k, v in out.items() if k != "snippets"}
    at = gsjs.iso(datetime.now(timezone.utc))
    blob = _json(slim)
    if _js_len(blob) > PROFILE_STORE_MAX:
        slim["files"] = list(slim.get("files") or [])[:15]
        blob = _json(slim)
        if _js_len(blob) > PROFILE_STORE_MAX:
            blob = _cut(blob, PROFILE_STORE_MAX)
    _conn().execute(
        f"insert into {STORE_TABLE} (user_id, name, name_key, updated_at, summary, payload) values (%s, %s, %s, %s, %s,"
        " %s) on conflict (user_id) do update set name = excluded.name, name_key = excluded.name_key,"
        " updated_at = excluded.updated_at, summary = excluded.summary, payload = excluded.payload, kept_at = now()",
        (uid, s_(out.get("name")), gsjs.or_text(out.get("name_key")), at, _cut(s_(out.get("summary")), 2000), blob))
    return at


def mark_stale(uid: str) -> None:
    """profileStoreStale_: a save never redraws from the store; the next read assembles the profile again."""
    try:
        _conn().execute(f"update {STORE_TABLE} set updated_at = '' where user_id = %s", (s_(uid),))
    except Exception as exc:  # noqa: BLE001 - the store heals on its own clock
        log.info("user profiles: %s not marked stale (%s)", s_(uid), type(exc).__name__)


# ---- userProfileDeep -------------------------------------------------------------------------------------------------

def _snippets(drv: Any, files: list[dict]) -> list[dict[str, str]]:
    """profileDocSnippets_: the text of the first Google Docs and text files (PDFs and pictures are never read)."""
    out: list[dict[str, str]] = []
    for f in files:
        if len(out) >= PROFILE_DOC_SNIPPET_FILES:
            break
        text = ""
        try:
            if f["mime"] == GOOGLE_DOC:
                text = drv.export(f["id"], "text/plain", SNIPPET_BYTES).decode("utf-8", "replace")
            elif f["mime"].startswith("text/"):
                text = drv.media(f["id"], SNIPPET_BYTES).decode("utf-8", "replace")
        except Exception:  # noqa: BLE001 - its catch: a file Drive will not hand over is read as nothing
            text = ""
        text = gsjs.text(text)
        if text:
            out.append({"file": f["name"], "text": _cut(text, PROFILE_DOC_SNIPPET_CHARS)})
    return out


def synthesize(reads: L.Reads, name: str, facts: dict[str, Any], deadline: float) -> dict[str, Any]:
    """profileSynthesize_: the model's summary and highlights from these facts only; empty when it gave none."""
    empty = {"summary": "", "highlights": [], "via": ""}
    prompt = ("Write a work profile of " + name + " for their manager, from THESE FACTS ONLY — never invent, never "
              "guess dates. Facts: " + _cut(_json(facts), 9000) + '. Answer with JSON: {"summary": "4-6 sentences, '
              'plain and useful", "highlights": ["up to 6 short bullet facts worth a glance"]}.')
    try:
        chat = CCS.ai_chat(reads, prompt, 0.2, "ai_profile_summary", deadline)
        try:
            parsed = json.loads(s_(chat.get("content")))
        except ValueError:
            parsed = None
        summary = s_(parsed.get("summary")) if isinstance(parsed, dict) else ""
        if chat.get("ok") and summary:
            got = parsed.get("highlights")
            lines = [_cut(s_(h), 160) for h in (got if isinstance(got, list) else [])]
            return {"summary": _cut(summary, 2000), "highlights": [h for h in lines if h][:6],
                    "via": s_(chat.get("via"))}
    except (Defer, hubdb.Unreadable):
        raise
    except Exception:  # noqa: BLE001 - its catch: no summary
        return empty
    return empty


def _client_profile(sess: L.Session, uid: str, row: dict, out: dict[str, Any], deadline: float) -> dict[str, Any]:
    """userProfileDeep for a client-linked account: its ISP, never the staff sources."""
    reads = sess.reads
    ck = s_(row.get("clientkey"))
    try:
        rec = next((c for c in C.derived(reads) if s_(c.get("client_key")) == ck), None)
        if rec is not None:
            out["sources"].append("client record (ISP)")
            out["client_key"] = ck
            out["summary"] = s_(rec.get("summary"))
            out["ai_via"] = "isp"
            hl = []
            if s_(rec.get("dob")):
                hl.append("DOB " + s_(rec.get("dob")))
            gname = s_(rec.get("guardianName")) or s_(rec.get("guardian_name"))
            if gname and gname.lower() != "self":
                hl.append("Guardian: " + gname)
            if s_(rec.get("funding_source")):
                hl.append("Funding: " + s_(rec.get("funding_source")))
            if s_(rec.get("supervision_level")):
                hl.append(s_(rec.get("supervision_level")))
            out["highlights"] = hl
            out["files"] = [{"name": s_(rec.get("isp_doc_name")) or ("ISP — " + s_(rec.get("name"))), "id": "",
                             "url": s_(rec.get("isp_doc_url")), "mime": "application/pdf",
                             "updated": s_(rec.get("isp_year"))}] if s_(rec.get("isp_doc_url")) else []
            try:
                ck_name = gsjs.name_key(s_(rec.get("name")))
                for ih in reads.hub_rows("ist_houses"):
                    ih_name = s_(_or(ih.get("clientName"), ih.get("clientname")))
                    ih_active = s_(_or(ih.get("active"), ih.get("Active"))).lower()
                    if not ih_name or ih_active == "no":
                        continue
                    if gsjs.name_key(ih_name) != ck_name:
                        continue
                    out["house"] = {"code": s_(_or(ih.get("house"), ih.get("House"))),
                                    "name": s_(_or(ih.get("houseName"), ih.get("housename")))}
                    break
            except (Defer, hubdb.Unreadable):
                raise
            except Exception:  # noqa: BLE001 - its catch
                out["unreadable"].append("ist_houses")
            if s_(rec.get("home_address")):
                out["house"] = out.get("house") or {"code": "", "name": ""}
                out["house"]["address"] = s_(rec.get("home_address"))
            if out.get("house") and out["house"].get("code"):
                def photo() -> None:
                    for ph in reads.hub_rows("photos"):
                        if gsjs.trim(s_(ph.get("title"))).upper() == out["house"]["code"].upper() and \
                                s_(ph.get("hidden")).lower() != "true":
                            out["house"]["photo"] = s_(ph.get("src"))
                            break
                _quiet(photo)
            cf = {"isp_summary": _cut(s_(rec.get("summary")), 1500), "dob": s_(rec.get("dob")), "guardian": gname or "",
                  "funding": s_(rec.get("funding_source")), "supervision": s_(rec.get("supervision_level")),
                  "house": out.get("house") or None}
            cai = synthesize(reads, s_(rec.get("name")), cf, deadline)
            if s_(cai.get("summary")):
                out["summary"] = cai["summary"]
                if cai.get("highlights"):
                    out["highlights"] = cai["highlights"]
                out["ai_via"] = cai.get("via") or "ai"
        else:
            out["unreadable"].append("client record (key " + ck + " not on the clients slice)")
    except (Defer, hubdb.Unreadable):
        raise
    except Exception as exc:  # noqa: BLE001 - its catch, said
        out["unreadable"].append("client record (" + (str(exc) or type(exc).__name__) + ")")
    try:
        out["stored_at"] = store(uid, out)
    except Exception as exc:  # noqa: BLE001 - assembled, said unsaved
        log.warning("user profiles: %s not stored (%s)", uid, type(exc).__name__)
        out["stored_at"] = ""
        out["store_note"] = "assembled but NOT saved"
    return {"status": 200, "data": out}


def user_profile_deep(sess: L.Session, payload: dict) -> dict[str, Any]:
    """userProfileDeep: one person's work profile assembled from the roster, the certifications, the shifts and their
    Drive folder, summarised by the model — the stored one while it is fresh, unless Refresh asks again."""
    started = time.monotonic()
    if not _admin(sess.user):
        return dict(DENIED)
    reads = sess.reads
    p = payload if isinstance(payload, dict) else {}
    uid = s_(p.get("user_id"))
    if not uid:
        return {"status": 400, "message": "user_id is required"}
    row = user_row(reads, uid)
    if row is None:
        return _missing(uid)
    name = s_(row.get("displayname")) or s_(row.get("email"))
    key = gsjs.name_key(name)
    kept = stored(reads, uid)
    if p.get("refresh") is not True and kept and kept["age_hours"] < PROFILE_STALE_HOURS:
        return {"status": 200, "data": kept["payload"]}
    deadline = started + PROFILE_MODEL_BUDGET_S
    out: dict[str, Any] = {"name": name, "sources": [], "unreadable": []}
    if s_(row.get("clientkey")):
        return _client_profile(sess, uid, row, out, deadline)

    def roster() -> None:
        found = [{"name": s_(r.get("name")), "email": s_(r.get("email")), "phone": s_(r.get("phone")),
                  "role": s_(r.get("role")), "department": s_(r.get("department")), "location": s_(r.get("location"))}
                 for r in reads.hub_rows("people") if key and gsjs.name_key(s_(r.get("name"))) == key]
        if found:
            out["roster"] = found[0]
            out["sources"].append("People roster")
        # the missing phone stamped onto the users row is a sheet write: never made from a read here
    if not _tried(roster):
        out["unreadable"].append("people roster")

    def certs() -> None:
        pic = SP.cert_picture(reads, key) if key else None
        if pic and pic.get("certs"):
            got = []
            for ck, cv in pic["certs"].items():
                got.append({"cert": ck, "date": s_(_or(cv.get("date"), cv.get("expires"), cv) if cv else cv)})
            if got:
                out["certs"] = got
                out["sources"].append("estate certifications")
    if not _tried(certs):
        out["unreadable"].append("certifications")

    def shifts() -> None:
        houses: dict[str, bool] = {}
        count, first, last = 0, "", ""
        for s in reads.hub_rows("shifts"):
            sk = gsjs.name_key(s_(s.get("staff")))
            if not sk or sk != key:
                continue
            count += 1
            houses[s_(s.get("house"))] = True
            d = s_(s.get("date"))
            if d and (not first or d < first):
                first = d
            if d and (not last or d > last):
                last = d
        if count:
            out["shifts"] = {"count": count, "houses": STC._js_keys(houses), "first": first, "last": last}
            out["sources"].append("shift roster")
    if not _tried(shifts):
        out["unreadable"].append("shifts")
    # listRows_('ist') names no resource, so its catch answers there: no IST records are ever added
    drv = reads.need_drive()
    roots = [r for r in (gsjs.trim(gsjs.or_blank(reads.db.prop(k))) for k in PROFILE_DRIVE_ROOT_PROPS) if r]
    idx = STC._folder_index(drv, roots, "the compliance folders")
    for u in idx["unreadable"]:
        out["unreadable"].append("drive root " + u)
    hit = STC._hit(idx, key) if key else None
    if hit and hit.get("ambiguous"):
        out["unreadable"].append("drive folder (two folders carry this name — not guessing)")
    elif hit:
        out["folder"] = {"name": hit["name"], "url": FOLDER_URL + hit["id"]}
        out["files"] = folder_files(drv, hit["id"], "the person's compliance folder")
        out["sources"].append("Drive folder (" + str(len(out["files"])) + " files)")
        snips = _snippets(drv, out["files"])
        if snips:
            out["snippets"] = snips
            out["sources"].append("document text (" + str(len(snips)) + " read)")
    facts: dict[str, Any] = {}
    for k, v in (("roster", out.get("roster")), ("certs", out.get("certs")), ("shifts", out.get("shifts")),
                 ("ist", out.get("ist")), ("files", [f["name"] for f in out.get("files") or []]),
                 ("document_excerpts", out.get("snippets"))):
        if v is not None:
            facts[k] = v
    ai = synthesize(reads, name, facts, deadline)
    out["summary"] = ai["summary"]
    out["highlights"] = ai["highlights"]
    out["ai_via"] = ai["via"]
    out["name_key"] = key
    try:
        out["stored_at"] = store(uid, out)
    except Exception as exc:  # noqa: BLE001 - assembled, said unsaved, and its line kept
        out["unreadable"].append("profile store (assembled but NOT saved)")
        staff_views.record({"email": "asa-hub:profile-deep"}, "profile_store_failed",
                           uid + " — " + (str(exc) or type(exc).__name__), 500)
    return {"status": 200, "data": out}


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {
    "userConversations": user_conversations, "userComms": user_comms, "userDriveDocs": user_drive_docs,
    "userProfileDeep": user_profile_deep}
POLICY: dict[str, dict[str, Any]] = {
    "userConversations": {"roles": ("admin",)},
    "userComms": {"roles": ("admin",), "params": {"user_id": "string"}},
    "userDriveDocs": {"roles": ("admin",), "params": {"user_id": "string"}},
    "userProfileDeep": {"roles": ("admin",)}}
