"""profileUpdate's place half (apps-script/Profile.gs placeProfileSet_) off asa-hub-db: the account's profile for a place
kept in app.edits over user_place_profiles, and the refusals profile_account_writes.update shares (its words, the name
a rostered person is known by). The door itself, the account's row and its password with it, is
profile_account_writes.update."""
from __future__ import annotations

import re
from typing import Any, Callable

import account_profile as AP
import gsjs
import hubdb
import locations as L
import smart_comms_desk as SCD
import staff as SP
import writes as W
from scope import Defer
from writes import Decision

BUSY = "Another update is in progress — try again."
NAME_EMPTY = "Name cannot be empty."
NOTHING = "Nothing to update — send display_name, title, phone, phones, emails, password and/or avatar."
NAME_TAKEN = "That name belongs to another account — an administrator can change it."
ROSTER_UNREAD = "The staff roster could not be checked just now — try again in a minute."
NAME_ROSTERED = "That name is on the staff roster — an administrator sets the name a rostered person is known by."
# the fields a save for a place keeps on that place's row; every other field is the account's own
OVERLAY = ("display_name", "title", "avatar")
NOT_LIVE = ("FALSE", "0", "NO")

s_ = gsjs.str_


def _people_id(v: Any) -> str:
    return gsjs.trim(re.sub(r"^people:", "", v))


def self_name_refused(reads: L.Reads, uid: str, name: str) -> str:
    """hubSelfNameRefused_: why the account may not take this name itself, '' when it may — another live account's
    name, or a name on the staff roster that is not proved the account's own."""
    key = SP.fold(name)
    if not key:
        return ""
    users = reads.users()
    mine = next((u for u in users if s_((u or {}).get("userid")) == s_(uid)), None)
    if mine is not None and SP.fold(mine.get("displayname")) == key:
        return ""
    for o in users:
        o = o or {}
        if s_(o.get("userid")) == s_(uid):
            continue
        if s_(o.get("active")).upper() in NOT_LIVE or s_(o.get("mergedinto")):
            continue
        if SP.fold(o.get("displayname")) == key:
            return NAME_TAKEN
    people, _why = SCD.attempt(lambda: SCD.broadcast_people_rows(reads))
    try:
        cal, _why_c = SCD.attempt(lambda: SCD.broadcast_calendar(reads))
    except Defer:
        # no hotline calendar is declared: commBroadcastCalendar_ cannot read one either
        cal = None
    if people is None or cal is None or not cal.get("readable"):
        return ROSTER_UNREAD
    linked = _people_id(s_((mine or {}).get("peopleid")))
    proved = bool(linked) and bool(SP._link_proof(mine))
    sign_in = s_((mine or {}).get("email")).lower()
    on_roster = is_mine = False
    for p in people:
        if SP.fold((p or {}).get("name")) != key:
            continue
        on_roster = True
        if not linked or _people_id(gsjs.or_text((p or {}).get("id"))) != linked:
            continue
        row_mail = "@" in sign_in and sign_in in SP.roster_mails(p)
        if proved or row_mail:
            is_mine = True
    for house in (cal.get("houses") or {}).values():
        if any(p and p.get("key") == key for p in house.get("people") or []):
            on_roster = True
    return NAME_ROSTERED if on_roster and not is_mine else ""


def _raw_head(ref: hubdb.TabRef | None, name: str) -> str:
    """The tab's own header for one of PLACE_HEADERS (normKey_ alike), else the name hubTabEnsure_ gives it."""
    for h in ref.headers if ref is not None else ():
        if hubdb.norm_key(h) == hubdb.norm_key(name):
            return h
    return name


def keep_place(sess: L.Session, uid: str, place: str, overlay: dict[str, str]) -> Decision:
    """placeProfileSet_: the sent cells and when on the account's row for the place, a new row when it has none; the
    answer, as profileUpdate's, the account as it stands."""
    reads = sess.reads
    res = AP.place_tab(reads)
    ref = res.ref
    sid, tab = W.where_of(res)
    raw = {h: _raw_head(ref, h) for h in AP.PLACE_HEADERS}
    head = {h: gsjs.trim(gsjs.js_str(raw[h])) for h in AP.PLACE_HEADERS}
    now = W.now_iso(reads)
    rows = reads.db.rows(ref) if ref is not None else []

    def cell(r: dict, h: str) -> str:
        return s_(hubdb.typed(r.get(raw[h]), "hub"))

    at = next((i for i, (_rn, r) in enumerate(rows) if cell(r, "user_id") == uid and cell(r, "place") == place), None)
    if at is not None:
        # the first of the rows this account keeps for the place, named by the cells this save leaves as well
        left = [raw[k] for k in ("display_name", "title", "avatar") if k not in overlay]
        got = W.row_key_of(rows, at, [[raw["user_id"], raw["place"]], [raw["user_id"], raw["place"], *left]])
        if got is None:
            # alike in every one of them: the first, as Apps Script writes it — a kept edit names the first row its key
            # matches
            heads = [raw["user_id"], raw["place"]]
            got = (W.COLS + W.COLS_SEP.join(gsjs.trim(h) for h in heads), W.cols_key(rows[at][1], heads))
        cells = {head[k]: v for k, v in overlay.items()}
        cells[head["updated_at"]] = now
        before = {head[k]: s_(rows[at][1].get(raw[k])) for k in (*overlay, "updated_at")}
        rec = W.kept_record(sid, tab, "edit", got[0], got[1], uid, cells, before)
    else:
        line = {"user_id": uid, "place": place, "display_name": overlay.get("display_name", ""),
                "title": overlay.get("title", ""), "avatar": overlay.get("avatar", ""), "updated_at": now}
        rec = W.kept_record(sid, tab, "append", W.COLS + W.COLS_SEP.join((head["user_id"], head["place"])),
                            gsjs.trim(uid) + "\x1f" + gsjs.trim(place), uid, {head[k]: v for k, v in line.items()})
    me = None
    for u in reads.users():
        if s_((u or {}).get("userid")) == s_(uid):
            me = u
    answer = {"status": 200, "data": {"user": AP.public(reads, me) if me is not None else None}}
    return W.final(answer, [rec], uid)


# profileUpdate is decided whole by profile_account_writes.update (the account's row, its password and a place's
# profile), set here by main.py
ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {}
POLICY: dict[str, dict[str, Any]] = {"profileUpdate": {}}
BUSY_OF: dict[str, dict[str, Any]] = {"profileUpdate": {"status": 503, "message": BUSY}}


class Store(W.Store):
    """app.account_profile_writes and _receipts; a place's profile kept in app.edits."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="account_profile", label="Account profile")
