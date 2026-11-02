"""Bundle.gs's JSON lane on Python: each place's bundle built off asa-hub-db for the relay's own identity — every routed
tab as that place sees it (bundleReadAll_), a world whole off Postgres (bundleReadWorld_), the personal half by owner
(bundleReadOwned_) — each tab with the fingerprint the next build is handed back, so what did not move is named, not
sent. A whole build is filed in app.snapshot_bundles (the Snapshot Bundles folder's place), the newest kept per place
(bundleSweep_) and read back by snapshotBundleLatest; a build and a sweep are also the master's own, by hand, never a
visit's. A tab is read off the copy with Python's kept edits laid, from Postgres where its app keeps it, from the
depot's facts when dissolved; one past HUB_BUNDLE_TAB_MAX_ROWS rows or HUB_BUNDLE_TAB_MAX_BYTES bytes, or whose cells
the copy withholds, is named in `unreadable` and never carried, so the relay's own slice answers for it. configLane is
app/config_lane.py's."""
from __future__ import annotations

import base64
import gzip
import hashlib
import json
import logging
import os
import re
import threading
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Callable, NamedTuple

import app_builder as AB
import candidates as CND
import envelope as EN
import gsjs
import hubdb
import locations as L
import prefs_doors as PD
import resource_rows as RR
import scope as sc
import sheet_resources as SR
import sheet_tabs as STB
import world_store as WS
from client_rename import js_json
from scope import Defer

log = logging.getLogger("asa-hub-app")

APP_ID = "bundles"
# Bundle.gs BUNDLE_READER_VERSION, BUNDLE_KEEP_PER_PLACE, BUNDLE_SEP, BUNDLE_BOOK_REV, BUNDLE_LOCK_TTL_S
READER_VERSION = 2
KEEP_PER_PLACE = 2
SEP = "~"
BOOK_REV = "[book]"
LOCK_TTL_S = 360.0
TAB_MAX_ROWS = int(os.getenv("HUB_BUNDLE_TAB_MAX_ROWS", "20000"))
TAB_MAX_BYTES = int(os.getenv("HUB_BUNDLE_TAB_MAX_BYTES", str(8 << 20)))
# a filed bundle trashed this long ago is gone, as Drive empties its bin
TRASH_KEEP_S = 30 * 86400
TABLE = "app.snapshot_bundles"
PREFS_RESOURCE = "userPrefs"
WITHHELD = "[withheld"
# Main.gs RESOURCES: the personal tabs, each by its ownedBy and ownerFallback
OWNED: dict[str, tuple[str, str]] = {
    "sheetTasks": ("ownerId", "assigneeId"), "tasks": ("ownerId", "assigneeId"), "shopperItems": ("ownerId", ""),
    "shopperPrices": ("ownerId", ""), "mealProfile": ("ownerId", ""), "mealLog": ("ownerId", ""),
    "weekItems": ("ownerId", ""), "learnAttempts": ("ownerId", "")}
UNKNOWN = {"status": 404, "message": "Unknown action."}
NOT_FOUND = {"status": 404, "message": "Not found."}
NONE_YET = {"status": 404, "message": "No bundle has been built for that place yet."}
NOT_JSON = {"status": 500, "message": "The newest bundle is not readable JSON."}
SKIPPED = {"status": 200, "data": {"skipped": "another build is already running"}}

s_ = gsjs.str_


class NotCarried(Exception):
    """A tab the bundle names unreadable and never carries."""


class TooLarge(NotCarried):
    """Past what one bundle carries: its own slice answers for it."""


class Withheld(NotCarried):
    """The copy withholds some of its cells: a redacted tab is never mirrored."""


class Place(NamedTuple):
    """hubTenantId_ ('' at headquarters) and tenantSpreadsheetId_ ('' before tenantEnsure gives the place a book)."""
    here: str
    book: str


# ---- the filed bundles (the Snapshot Bundles folder) ----------------------------------------------------------------

_BOUND: dict[str, Any] = {}
_MADE = threading.Event()


def bind(store: Any) -> None:
    """The write store whose connection files and reads back the bundles (main.py's)."""
    _BOUND["store"] = store


def ddl() -> tuple[str, ...]:
    return (f"create table if not exists {TABLE} (file_id text primary key, name text not null, place text not null,"
            " built_at timestamptz not null, bytes integer not null, body bytea not null,"
            " filed_at timestamptz not null default now(), trashed_at timestamptz)",
            f"create index if not exists snapshot_bundles_name on {TABLE} (name)")


def _sql(text: str, params: tuple = ()) -> list[tuple]:
    store = _BOUND.get("store")
    if store is None or not store.available:
        raise hubdb.Unreadable("no write store is set, so no bundle is filed or read back")
    try:
        c = store.conn()
        if not _MADE.is_set():
            for stmt in ddl():
                c.execute(stmt)
            _MADE.set()
        cur = c.execute(text, params)
        return list(cur.fetchall()) if cur.description else []
    except Exception as exc:  # noqa: BLE001 - the store not answering is said, never an empty folder
        drop = getattr(store, "_drop", None)
        if callable(drop):
            drop()
        raise hubdb.Unreadable(f"the bundle store did not answer ({type(exc).__name__})") from exc


def name_of(place: Any, stamp: Any) -> str:
    """bundleName_: `bundle~<place>~<iso>.json`, so the sweep groups them without opening any."""
    return "bundle" + SEP + (s_(place) or "home") + SEP + re.sub(r"[:.]", "-", s_(stamp)) + ".json"


def place_of_name(name: Any) -> str:
    """bundlePlaceOf_."""
    parts = s_(name).split(SEP)
    return parts[1] if len(parts) >= 3 and parts[0] == "bundle" else ""


def ours(name: Any) -> bool:
    """bundleIsOurs_."""
    return s_(name).startswith("bundle" + SEP)


def file_bundle(place: str, built_at: str, body: str) -> str:
    """folder.createFile: the bundle's text filed under its name; its id."""
    fid = "SB_" + uuid.uuid4().hex[:24]
    _sql(f"insert into {TABLE} (file_id, name, place, built_at, bytes, body) values (%s, %s, %s, %s, %s, %s)",
         (fid, name_of(place, built_at), s_(place) or "home", built_at, PD.js_len(body),
          gzip.compress(body.encode("utf-8"))))
    return fid


def sweep(place: Any = None) -> int:
    """bundleSweep_: the newest KEEP_PER_PLACE of a place kept — of every place when none is named — the rest trashed;
    a bundle trashed TRASH_KEEP_S ago is gone."""
    want = s_(place)
    by: dict[str, list[tuple[str, str]]] = {}
    for fid, name in _sql(f"select file_id, name from {TABLE} where trashed_at is null"):
        if not ours(name):
            continue
        p = place_of_name(name)
        if want and p != want:
            continue
        by.setdefault(p, []).append((s_(name), s_(fid)))
    gone: list[str] = []
    for files in by.values():
        # the name carries an ISO stamp, so lexicographic IS chronological
        files.sort(reverse=True)
        gone += [fid for _name, fid in files[KEEP_PER_PLACE:]]
    if gone:
        _sql(f"update {TABLE} set trashed_at = now() where file_id = any(%s) and trashed_at is null", (gone,))
    _sql(f"delete from {TABLE} where trashed_at < now() - make_interval(secs => %s)", (TRASH_KEEP_S,))
    return len(gone)


def latest(place: Any) -> str:
    """bundleLatest_: the newest bundle filed for a place, as text; '' when there is none yet."""
    prefix = "bundle" + SEP + (s_(place) or "home") + SEP
    got = _sql(f"select body from {TABLE} where trashed_at is null and left(name, length(%s)) = %s"
               " order by name desc limit 1", (prefix, prefix))
    if not got:
        return ""
    return gzip.decompress(bytes(got[0][0])).decode("utf-8")


# ---- the build's own exclusion (bundleLockTake_, bundleLockDrop_) ----------------------------------------------------

_LOCK = threading.Lock()
_HELD = {"at": 0.0}


def lock_take() -> bool:
    """bundleLockTake_: one build at a time, the hold lapsing after LOCK_TTL_S."""
    with _LOCK:
        now = time.monotonic()
        if _HELD["at"] and now - _HELD["at"] < LOCK_TTL_S:
            return False
        _HELD["at"] = now
        return True


def lock_drop() -> None:
    with _LOCK:
        _HELD["at"] = 0.0


# ---- one tab, as one place sees it ----------------------------------------------------------------------------------

def now_iso() -> str:
    return gsjs.iso(datetime.now(timezone.utc))


def book_key(book: Any, scope: str = "") -> str:
    """bundleBookKey_."""
    return s_(book) + "::" + BOOK_REV + s_(scope)


def book_stamp(reads: L.Reads, sid: str) -> str:
    """bundleBookStamp_: when the workbook itself last changed, as Drive told the copy; '' when it cannot say."""
    b = reads.db.book(sid) if sid else None
    at = b.modified_time if b is not None else None
    if isinstance(at, datetime):
        return gsjs.iso(at if at.tzinfo else at.replace(tzinfo=timezone.utc))
    return ""


def db_stamp(reads: L.Reads) -> str:
    """serviceDbStamp_: when HUB_DB last changed."""
    return book_stamp(reads, reads.db.prop("HUB_DB_ID"))


def tenants(reads: L.Reads) -> list[dict]:
    """tenantsRows_: the tenants tab where readTabNormalized_ opens it (its house first); FAIL-CLOSED, none when
    unreadable."""
    try:
        return EN.tenants_rows(reads)
    except (Defer, hubdb.Unreadable):
        return []


def active_ids(rows: list[dict]) -> list[str]:
    """tenantActiveIdsFrom_."""
    return [i for i in (s_(t.get("tenantid")) for t in rows if s_(t.get("status")) != "archived") if i]


def place_for(reads: L.Reads, here: str) -> Place:
    if not here:
        return Place("", "")
    row = next((r for r in tenants(reads) if s_(r.get("tenantid")) == here), {})
    return Place(here, s_(row.get("spreadsheetid")))


def central(tab: str) -> bool:
    """hubTabIsCentral_."""
    return tab in AB.CENTRAL


def tab_book(reads: L.Reads, place: Place, tab: str) -> str:
    """hubTabWorkbook_(tab).getId(): the place's own book for a tab not central, none for a dissolved one, else where
    the router opens it."""
    if place.book and not central(tab):
        return place.book
    if reads.db.dissolved(tab):
        return ""
    return reads.db.resolve(tab).sheet_id


def narrow(place: Place, rows: list[dict]) -> list[dict]:
    """LAW 2, narrowed here: away from headquarters, only the rows whose tenant cell names the place."""
    if not place.here:
        return rows
    return [r for r in rows if s_((r or {}).get("tenant")) == place.here]


def _rows_cap(n: int) -> None:
    if n > TAB_MAX_ROWS:
        raise TooLarge(f"{n} rows, past the {TAB_MAX_ROWS} a bundle carries of one tab")


def _copy(reads: L.Reads, ref: hubdb.TabRef | None) -> tuple[list[dict], str]:
    """readAll_ of a tab the copy holds; ('absent') for none."""
    if ref is None:
        return [], "absent"
    _rows_cap(ref.row_count)
    return reads.db.sheetdb_rows(ref), ""


def _kept(reads: L.Reads, tab: str) -> list[dict] | None:
    """The rows an app keeps in Postgres for a Hub tab (sheet_resources.kept_rows), counted before they are read."""
    resource = SR.TAB_OF.get(tab)
    if not resource or not RR.uploaded(reads.db, resource):
        return None
    got = reads.db.query(f"select count(*) from {RR.rows_of(resource)} where resource = %s and removed_at is null",
                         (resource,))
    _rows_cap(int(got[0][0]) if got else 0)
    return SR.kept_rows(reads, tab)


def _routed(reads: L.Reads, tab: str) -> tuple[list[dict], str]:
    """The tab where the router opens it at headquarters (hubTabWorkbook_, then hubHouseTabIn_)."""
    kept = _kept(reads, tab)
    if kept is not None:
        return kept, ""
    res = reads.db.resolve(tab)
    if res.ref is None and res.sheet_id and not res.book_known:
        raise hubdb.Unreadable(f"asa-hub-db holds no copy of the book behind {tab}")
    return _copy(reads, res.ref)


def read_tab(reads: L.Reads, place: Place, tab: str, house_first: bool = True) -> tuple[list[dict], str]:
    """bundleReadAll_'s read of one routed tab (house_first) or bundleReadOwned_'s (hubTabSheet_): a dissolved tab from
    the depot's facts, a moved one from its house, one at a place with a book of its own from there, else where the
    router opens it — Postgres for a tab its app keeps there; the place narrowed. ('absent') when no tab answers."""
    db = reads.db
    own = bool(place.book) and not central(tab)
    if db.dissolved(tab):
        moved = STB.legacy_raw(reads, tab)
        if moved is not None:
            _rows_cap(len(moved))
            return narrow(place, moved), ""
        if not own:
            return [], "absent"
    if db.house_moved(tab) and (house_first or not own):
        rows, state = _routed(reads, tab)
        return narrow(place, rows), state
    if own:
        rows, state = _copy(reads, reads.tab_of(place.book, tab, tab))
        return narrow(place, rows), state
    rows, state = _routed(reads, tab)
    return narrow(place, rows), state


def fingerprint(rows: list[dict], state: str = "") -> tuple[str, int]:
    """bulkTabsRevs_'s `<rows>:<length of the last row>:<md5>` ('empty', 'absent'), taken over every row the bundle
    serves rather than the sheet's last alone, so a kept edit laid over the copy moves it too; and the rows' size."""
    if state == "absent":
        return "absent", 2
    if not rows:
        return "empty", 2
    text = json.dumps(rows, separators=(",", ":"), ensure_ascii=False, default=str).encode("utf-8")
    if len(text) > TAB_MAX_BYTES:
        raise TooLarge(f"{len(text)} bytes, past the {TAB_MAX_BYTES} a bundle carries of one tab")
    if b'"' + WITHHELD.encode() in text:
        raise Withheld("the copy withholds some of its cells, so it is not mirrored")
    last = json.dumps(rows[-1], separators=(",", ":"), ensure_ascii=False, default=str)
    digest = base64.b64encode(hashlib.md5(text, usedforsecurity=False).digest()).decode()[:12]
    return f"{len(rows) + 1}:{len(last)}:{digest}", len(text)


def _why(exc: BaseException) -> str:
    return s_(str(exc)) or type(exc).__name__


def _int(v: Any, fallback: int) -> int:
    """parseInt(v, 10) || fallback."""
    n = CND.js_parse_int(v)
    return int(n) if n == n and n else fallback


# ---- the three reads ------------------------------------------------------------------------------------------------

def read_all(reads: L.Reads, place: Place, have: dict, part: Any = 0, parts: Any = 1) -> dict[str, Any]:
    """bundleReadAll_: this part's share of the routed tabs (every nParts-th, by sorted name), each read as the place
    sees it; one whose fingerprint is what the caller holds is carried, named and not sent; one that cannot be read is
    REPORTED, never silently emptied, and its fingerprint is 'error' — never "unchanged"."""
    have = have if isinstance(have, dict) else {}
    n_parts = max(1, _int(parts, 1))
    i_part = max(0, _int(part, 0)) % n_parts
    order = sorted(AB.CODED)
    mine = {r for k, r in enumerate(order) if k % n_parts == i_part}
    # the database answering at all: no answer is no bundle, never one of empty tabs
    reads.db.catalog()
    out: dict[str, list[dict]] = {}
    skipped: list[str] = []
    carried: list[str] = []
    tab_revs: dict[str, str] = {}
    books: list[str] = []
    for resource, tab in AB.CODED.items():
        if resource not in mine:
            continue
        key = tab
        try:
            book = tab_book(reads, place, tab)
            key = f"{book}::{tab}" if book else tab
            if book and book not in books:
                books.append(book)
            rows, state = read_tab(reads, place, tab)
            fp, _size = fingerprint(rows, state)
        except (NotCarried, Defer, hubdb.Unreadable) as why:
            tab_revs[key] = "error"
            skipped.append(f"{resource}: {_why(why)}")
            continue
        tab_revs[key] = fp
        if have.get(key) == fp:
            carried.append(resource)
            continue
        out[resource] = rows
    if not out and not carried and skipped:
        raise hubdb.Unreadable("no routed tab could be read: " + skipped[0])
    scope = f"#{i_part}" if n_parts > 1 else ""
    revs: dict[str, str] = {}
    for book in books:
        stamp = book_stamp(reads, book)
        if stamp:
            revs[book_key(book, scope)] = stamp
    revs.update(tab_revs)
    empty = bool(tab_revs) and all(v == "error" for v in tab_revs.values())
    if empty:
        log.warning("bundle %s: no fingerprint could be taken of %d tab(s) — this place is read whole every cycle",
                    place.here or "home", len(tab_revs))
    return {"resources": out, "unreadable": skipped, "carried": carried, "revs": revs, "revs_empty": empty,
            "revs_error": "", "part": i_part, "parts": n_parts}


def read_world(reads: L.Reads, wid: str, have: dict) -> dict[str, Any]:
    """bundleReadWorld_: every tab of a world as My World keeps it in Postgres, its own header (readAll_, no place
    narrowing); carried forward like everywhere else."""
    have = have if isinstance(have, dict) else {}
    out: dict[str, list[dict]] = {}
    skipped: list[str] = []
    carried: list[str] = []
    revs: dict[str, str] = {}
    for v in WS.views(reads, wid):
        name = v.tab
        key = wid + "::" + name
        try:
            _rows_cap(len(v.rows))
            rows = AB.read_all(v)
            fp, _size = fingerprint(rows)
        except (NotCarried, Defer, hubdb.Unreadable) as why:
            revs[key] = "error"
            skipped.append(f"{name}: {_why(why)}")
            continue
        revs[key] = fp
        if have.get(key) == fp:
            carried.append(name)
            continue
        out[name] = rows
    return {"resources": out, "unreadable": skipped, "carried": carried, "revs": revs}


def prefs_rows(reads: L.Reads) -> tuple[dict[str, dict], int]:
    """bundleReadOwned_'s preferences: each person's last user_prefs row (prefsSheet_) as readAll_ hands it, with the
    cells their save queued laid; and how many the copy withholds."""
    got = PD.held_rows(reads, "")
    ref = got["ref"]
    heads = got["heads"]
    iu = heads.get("userid")
    uids: list[str] = []
    for _rn, raw in got["rows"]:
        uid = PD.cell(raw, iu)
        if uid and uid not in uids:
            uids.append(uid)
    out: dict[str, dict] = {}
    held = 0
    for uid in uids:
        mine = PD.held_rows(reads, uid)
        if not mine["mine"]:
            continue
        raw = mine["rows"][mine["mine"][-1]][1]
        header = list(ref.headers) if ref is not None else list(raw)
        vals = [hubdb.typed(raw.get(h), "hub") for h in header]
        if all(v == "" or v is None for v in vals):
            continue
        if any(isinstance(v, str) and v.startswith(WITHHELD) for v in vals):
            held += 1
            continue
        out[uid] = {h: hubdb.cell_text(v) for h, v in zip(header, vals) if h != ""}
    return out, held


def read_owned(reads: L.Reads, place: Place) -> dict[str, Any]:
    """bundleReadOwned_: the personal tabs' rows grouped by their owner (hubOwnerOf_), the place narrowed first; a row
    nobody owns is in nobody's file; then each person's preferences, theirs too."""
    by_user: dict[str, dict[str, list[dict]]] = {}
    skipped: list[str] = []
    revs: dict[str, str] = {}
    for resource, (owned_by, fallback) in OWNED.items():
        tab = AB.CODED[resource]
        try:
            book = tab_book(reads, place, tab)
            key = f"{book}::{tab}" if book else tab
            rows, state = read_tab(reads, place, tab, house_first=False)
            revs[key] = fingerprint(rows, state)[0]
        except (NotCarried, Defer, hubdb.Unreadable) as why:
            skipped.append(f"{resource}: {_why(why)}")
            continue
        for row in rows:
            owner = s_(row.get(owned_by)) or (s_(row.get(fallback)) if fallback else "")
            if owner:
                by_user.setdefault(owner, {}).setdefault(resource, []).append(row)
    try:
        prefs, held = prefs_rows(reads)
        for uid, row in prefs.items():
            by_user.setdefault(uid, {})[PREFS_RESOURCE] = [row]
        if held:
            skipped.append(f"{PREFS_RESOURCE}: the copy withholds {held} person(s)' preferences")
    except (Defer, hubdb.Unreadable) as why:
        skipped.append(f"{PREFS_RESOURCE}: {_why(why)}")
    return {"users": by_user, "unreadable": skipped, "revs": revs}


# ---- one build (bundleBuild_) ---------------------------------------------------------------------------------------

def build(reads: L.Reads, label: str, with_body: bool, have: dict, part: Any = 0, parts: Any = 1, *, here: str = "",
          world: str = "") -> dict[str, Any]:
    """bundleBuild_: the read, the bundle it makes — a piece (carried tabs, or one part of several) handed back, never
    filed; a whole one filed and its place swept — and the receipt, with the bundle when the caller asked."""
    place = s_(label) or here
    started = now_iso()
    read = read_world(reads, world, have) if world else read_all(reads, place_for(reads, here), have, part, parts)
    incremental = bool(read.get("carried")) or int(read.get("parts") or 1) > 1
    built = now_iso()
    payload = {"place": place or "home", "reader": READER_VERSION, "built_at": built, "read_started_at": started,
               "db_last_updated": "" if incremental else db_stamp(reads), "unreadable": read["unreadable"],
               "revs": read.get("revs") or {}, "revs_empty": bool(read.get("revs_empty")),
               "revs_error": read.get("revs_error") or "", "carried": read.get("carried") or [],
               "resources": read["resources"]}
    body = "" if incremental else js_json(payload)
    file_id = ""
    if not incremental:
        file_id = file_bundle(place, built, body)
        sweep(place)
    counts = {r: len(rows) for r, rows in read["resources"].items()}
    receipt: dict[str, Any] = {"place": payload["place"], "built_at": built, "file_id": file_id,
                               "incremental": incremental, "part": read.get("part") or 0,
                               "parts": read.get("parts") or 1, "read": counts, "carried": read.get("carried") or [],
                               "bytes": PD.js_len(body), "resources": counts, "unreadable": read["unreadable"]}
    if with_body:
        receipt["bundle"] = payload
    return receipt


# ---- the doors ------------------------------------------------------------------------------------------------------

def _payload(payload: Any) -> dict:
    return payload if isinstance(payload, dict) else {}


def _truthy(v: Any) -> bool:
    """!!v."""
    if isinstance(v, (dict, list)):
        return True
    if isinstance(v, float) and v != v:
        return False
    return bool(v)


def _service(user: dict | None) -> bool:
    return bool((user or {}).get("is_service"))


def _builder(user: dict | None) -> bool:
    """The builder's own lane: the relay's identity, or the master in its own session (never a visit)."""
    return _service(user) or sc.is_real_master(user)


def owned_door(sess: L.Session, payload: dict) -> dict[str, Any]:
    """snapshotBundleOwned: a place's personal half, by owner, for the relay's own identity alone."""
    if not _service(sess.user):
        return dict(UNKNOWN)
    reads = sess.reads
    wanted = s_(_payload(payload).get("place"))
    if wanted and wanted not in active_ids(tenants(reads)):
        return dict(NOT_FOUND)
    read = read_owned(reads, place_for(reads, wanted))
    counts = {u: sum(len(rows) for rows in res.values()) for u, res in read["users"].items()}
    return {"status": 200, "data": {"place": wanted or "home", "reader": READER_VERSION, "built_at": now_iso(),
                                    "unreadable": read["unreadable"], "revs": read["revs"], "counts": counts,
                                    "users": read["users"]}}


def build_door(sess: L.Session, payload: dict) -> dict[str, Any]:
    """snapshotBundleBuild: one place's bundle, or one world's — the world resolved against the registry, never taken
    from the payload — for the relay's identity (the body and what it holds are its alone) or the master's own
    session; one build at a time."""
    user = sess.user or {}
    if not _builder(user):
        return dict(UNKNOWN)
    reads = sess.reads
    p = _payload(payload)
    wanted, want_world = s_(p.get("place")), s_(p.get("world"))
    service = _service(user)
    with_body = _truthy(p.get("withBody")) and service
    have = p.get("have") if service and isinstance(p.get("have"), dict) else {}
    wid = ""
    if want_world:
        wid = next((w["world_id"] for w in EN.worlds_rows(reads) if w["world_id"] == want_world), "")
        if not wid:
            return dict(NOT_FOUND)
    elif wanted and wanted not in active_ids(tenants(reads)):
        return dict(NOT_FOUND)
    if not lock_take():
        return {"status": SKIPPED["status"], "data": dict(SKIPPED["data"])}
    try:
        if wid:
            # a world is nobody's company ground: no place travels into it
            return {"status": 200, "data": build(reads, "world_" + want_world, with_body, have, 0, 1, world=wid)}
        return {"status": 200, "data": build(reads, "", with_body, have, p.get("part") or 0, p.get("parts") or 1,
                                             here=wanted)}
    finally:
        lock_drop()


def places_door(sess: L.Session, payload: dict) -> dict[str, Any]:
    """snapshotBundlePlaces: headquarters ('') first, then every active place but home; and every world, with whose
    it is."""
    if not _service(sess.user):
        return dict(UNKNOWN)
    reads = sess.reads
    rows = tenants(reads)
    home = EN.home_from(rows)
    out = [""] + [i for i in active_ids(rows) if i != home]
    owners: dict[str, str] = {}
    try:
        for w in EN.worlds_rows(reads):
            if w["world_id"]:
                owners.setdefault(w["world_id"], w["owner_user_id"])
    except (Defer, hubdb.Unreadable):
        # no registry yet: the places still build
        owners = {}
    return {"status": 200, "data": {"places": out, "worlds": list(owners), "owners": owners}}


def latest_door(sess: L.Session, payload: dict) -> dict[str, Any]:
    """snapshotBundleLatest: the newest bundle filed for a place, for the relay's own identity alone."""
    if not _service(sess.user):
        return dict(UNKNOWN)
    text = latest(s_(_payload(payload).get("place")))
    if not text:
        return dict(NONE_YET)
    try:
        return {"status": 200, "data": json.loads(text)}
    except ValueError:
        return dict(NOT_JSON)


def sweep_door(sess: L.Session, payload: dict) -> dict[str, Any]:
    """snapshotBundleSweep: keep the last, drop the rest — of one place, or every place when none is named."""
    if not _builder(sess.user):
        return dict(UNKNOWN)
    return {"status": 200, "data": {"removed": sweep(s_(_payload(payload).get("place")))}}


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {
    "snapshotBundleOwned": owned_door, "snapshotBundleBuild": build_door, "snapshotBundlePlaces": places_door,
    "snapshotBundleLatest": latest_door, "snapshotBundleSweep": sweep_door}
# HUB_POLICY as Bundle.gs declares it
POLICY: dict[str, dict[str, Any]] = {a: {"roles": ("admin",)} for a in ACTIONS}
