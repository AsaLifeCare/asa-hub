"""The Users app's account edits (apps-script/HubCore.gs userUpdate, userDelete, userMergeManual) decided and kept
off asa-hub-db: every gate and refusal in its own words; each changed users row's cells kept in app.edits (laid at once
for every Python read) and carried to the sheet at once by a `cells` book op; a removed row deleted from the sheet by a
`delete` book op and taken off every Python read until the copy no longer holds it; a password hashed as Auth.gs hashes
it and kept by the sign-in's credential store (CREDENTIALS), never on the sheet. The master's row answers the real
master alone; to anyone else it is an unknown id, exactly as one that does not exist. While the master signs in through
Apps Script (auth.MASTER_SIGN_IN_ON_APPS_SCRIPT), the master's own new password is the one write handed to it."""
from __future__ import annotations

import json
import math
import os
import re
from typing import Any, Callable

import auth as A
import auth_store as AS
import book_ops as BO
import envelope as EV
import gsjs
import house_tables as HT
import hubdb
import locations as L
import resource_rows as RR
import scope as sc
import smart_comms as SC
import staff as SP
import staff_views as SV
import studio as SD
import user_profiles as UP
import writes as W
from scope import Defer
from writes import Decision

APP_ID = "users-writes"
KIND = "users_account"
TAB = "users"
SUBJECT = "users"
# hubDenied_ (HubCore.gs)
DENIED = {"status": 403, "message": "Requires an admin or manager account"}
BUSY = "Another update is in progress — try again."
# what this side cannot be sure of is said, and nothing is written
UNSURE = {"status": 503, "message": "This change could not be saved just now, and nothing was written. "
                                    "Try again in a moment."}
ROLES = ("admin", "manager", "staff", "client", "interviewer")
# Profile.gs SYSTEM_USER_TYPES and HUB_MASTER_GRANTED_BADGES
SYSTEM_USER_TYPES = ("DIRECTOR", "ADMINISTRATOR", "FINANCES", "HR", "DIVISION SUPERVISOR", "QUALITY")
MASTER_GRANTED_BADGES = ("PLATFORMLEAD",)
# the salt randomHex_(32) gives hashPassword_, and the shortest password a hand may type
SALT_LEN = 32
PASSWORD_MIN = 8
# hubProp_ names of the workspace default (FIRST_USER_PASSWORD first, its older name second); this service's own
# setting first, as the copy of the properties withholds both
DEFAULT_PASSWORD_ENV = "HUB_FIRST_USER_PASSWORD"
DEFAULT_PASSWORD_PROPS = ("FIRST_USER_PASSWORD", "ONBOARDING_USER_PASSWORD")
_ADMIN: dict[str, Any] = {"roles": ("admin",)}
# HUB_POLICY (HubCore.gs, UsersBulk.gs, PeopleMerge.gs, ContactsSync.gs, Clients.gs, Profile.gs), asked by each door
# after the place law as doPost asks it
DECLARED: dict[str, dict[str, Any]] = {
    "userUpdate": _ADMIN, "userDelete": _ADMIN, "userCreate": _ADMIN, "usersArm": _ADMIN,
    "userMergeManual": {"roles": ("admin",), "params": {"keep_id": {"required": True, "type": "string"}}},
    "userActivate": {"roles": ("admin",), "params": {"user_id": {"required": True, "type": "string"}}},
    "userInvite": {"roles": ("admin",), "params": {"user_ids": {"required": True, "type": "array"}}},
    "peopleMergeApply": _ADMIN, "usersContactMergeApply": _ADMIN, "usersFromPeople": _ADMIN,
    "usersFromSigned": _ADMIN, "usersFromClients": _ADMIN, "usersFromGuardians": _ADMIN,
    "clientUserCreate": {"roles": ("admin",), "params": {"client_id": {"required": True, "type": "string"},
                                                         "kind": {"required": True, "type": "string"}}},
    "releaseUser": {"roles": ("admin",), "params": {"user_id": {"required": True, "type": "string"},
                                                    "anyway": {"type": "boolean"}, "press_id": {"type": "string"}}},
    "profileUpdate": {},
}
# the sign-in's credential store registers its two hooks: set(cursor, user_id, salt, pass_hash, write_id) in this
# write's transaction, and void(connection, write_id) when the relay voids the write; with no `set`, no password is
# written (UNSURE)
CREDENTIALS: dict[str, Callable[..., None]] = {}

s_ = gsjs.str_


def _js(v: Any) -> Any:
    """JSON.stringify's numbers: a whole float is written as an integer."""
    if isinstance(v, float):
        return int(v) if math.isfinite(v) and v == int(v) and abs(v) < 1e15 else v
    if isinstance(v, dict):
        return {k: _js(x) for k, x in v.items()}
    if isinstance(v, list):
        return [_js(x) for x in v]
    return v


def _json(v: Any) -> str:
    return W.json_text(_js(v))


def _typeof(v: Any) -> str:
    if isinstance(v, list):
        return "array"
    if isinstance(v, bool):
        return "boolean"
    if isinstance(v, (int, float)):
        return "number"
    return "string" if isinstance(v, str) else "object"


def js_len(s: str) -> int:
    """String.length: UTF-16 code units."""
    return len(s.encode("utf-16-le", "surrogatepass")) // 2


def default_password(reads: L.Reads) -> str:
    """str_(hubProp_('FIRST_USER_PASSWORD')) || str_(hubProp_('ONBOARDING_USER_PASSWORD')), as this service holds
    them (HUB_FIRST_USER_PASSWORD, else HUB_APP_PROP_<name>); a value the copy withholds is none."""
    own = s_(os.getenv(DEFAULT_PASSWORD_ENV, ""))
    if own:
        return own
    for key in DEFAULT_PASSWORD_PROPS:
        v = s_(reads.db.prop(key))
        if v and not v.startswith("[withheld"):
            return v
    return ""


def credentials_ready() -> bool:
    return "set" in CREDENTIALS


def credential_put(uid: str, password: str, must_change: bool | None) -> None:
    """The account's password kept by the sign-in's credential store, hashPassword_ under a fresh randomHex_(32) salt,
    in this write's transaction. The must-change flag is the users row's own cell (sign-in reads it there), which the
    door keeps beside it; a store that keeps one of its own is told it too (None: the blank cell)."""
    cur = W.HELD.get()
    if cur is None or not credentials_ready():
        raise W.NotKept("a password is kept only by the sign-in's store, under the platform's write lock")
    salt = A.random_hex(SALT_LEN)
    CREDENTIALS["set"](cur, uid, salt, A.hash_password(password, salt), SC.write_id())
    if "must_change" in CREDENTIALS:
        CREDENTIALS["must_change"](cur, uid, must_change)


def master_sign_in_elsewhere(email: Any) -> bool:
    """The master's account while its sign-in stays Apps Script's: a password Python keeps would not open it."""
    return A.handed_back({"email": s_(email)})


def types_of(raw: Any) -> tuple[list[str], list[str]]:
    """userTypesFromRaw_: the known badges once each, and every unknown word."""
    items = raw if isinstance(raw, list) else re.split(r"[,;|\n]+", gsjs.or_blank(raw))
    out: list[str] = []
    bad: list[str] = []
    for t in items:
        v = gsjs.trim(gsjs.or_text(t)).upper()
        if not v:
            continue
        if v not in sc.USER_TYPES:
            bad.append(v)
        elif v not in out:
            out.append(v)
    return out, bad


def grant_refused(user: dict, before_raw: Any, after_raw: Any) -> dict[str, Any] | None:
    """hubBadgeGrantRefused_: a master-granted badge added or removed by anyone but the real master."""
    before, after = types_of(before_raw)[0], types_of(after_raw)[0]
    moved = [b for b in MASTER_GRANTED_BADGES if (b in before) != (b in after)]
    if not moved or sc.is_real_master(user):
        return None
    return {"status": 403, "message": "Only the master grants or removes the " + ", ".join(moved) +
            " badge. Nothing was changed."}


def denials_normalize(items: Any) -> list[str]:
    """appDenialsNormalize_."""
    return [a for a in (s_(x)[:80] for x in (items if isinstance(items, list) else [])) if a][:200]


def denials_same(sent: Any, stored_cell: Any) -> bool:
    """appDenialsSame_: the sent list names exactly the apps the stored cell denies."""
    try:
        stored = json.loads(s_(stored_cell) or "[]")
    except ValueError:
        stored = []
    return set(denials_normalize(sent)) == set(denials_normalize(stored))


def place_refused(reads: L.Reads, wanted: list[str], user: dict) -> dict[str, Any] | None:
    """tenantPlaceableGate_: an id no active place has, or a place the caller cannot stand in; blank always passes."""
    reach = None if sc.is_real_master(user) or s_(user.get("role")) == "admin" else SD.tenant_reach_ids(reads, user)
    active = [i for i in (s_(t.get("tenantid")) for t in SD.tenants_rows(reads)
                          if s_(t.get("status")) != "archived") if i]
    for raw in wanted:
        tid = s_(raw)
        if not tid:
            continue
        if tid not in active:
            return {"status": 400, "message": 'There is no active place with the id "' + tid + '".'}
        if reach is not None and tid not in reach:
            return {"status": 403, "message": "You cannot place somebody where you cannot stand yourself."}
    return None


def door_gate(sess: L.Session, action: str, p: dict) -> tuple[Decision | None, str]:
    """doPost before the door: where the session stands (the place, the visit, the place law) was settled before it
    (envelope.settle); then hubPolicyGate_'s declared roles and params, in its words. Answers (refusal, place)."""
    user = sess.user
    here = EV.place_of(user)
    pol = DECLARED[action]
    roles = pol.get("roles") or ()
    if roles and user and not user.get("is_service") and gsjs.js_str(user.get("role")) not in roles:
        return Decision({"status": 403, "message": "This action is for " + " or ".join(roles) + "."}), here
    for key, rule in (pol.get("params") or {}).items():
        val = p.get(key)
        missing = val is None or val == ""
        if rule.get("required") and missing:
            return Decision({"status": 400, "message": "Missing required parameter: " + key + "."}), here
        if not missing and rule.get("type") and _typeof(val) != rule["type"]:
            return Decision({"status": 400, "message": f"{key} must be {rule['type']}, got {_typeof(val)}."}), here
    return None, here


class Accounts:
    """The users tab as one write reads it: its rows (Python's own writes laid), each header by its normKey_, and the
    key a kept edit names a row by."""

    def __init__(self, reads: L.Reads) -> None:
        # the users tab as it stands: its own table once kept there (its writes land there, no op for a sheet)
        res = HT.where(reads, TAB) if HT.tabled(TAB) else W.tab_of(reads, TAB)
        if res.ref is None:
            raise Defer("the users tab holds no rows in the copy")
        self.ref, self.kept = res.ref, isinstance(res.ref, HT.KeptRef)
        self.sid, self.tab = W.where_of(res)
        self.raw: dict[str, Any] = {}
        for h in self.ref.headers:
            self.raw.setdefault(hubdb.norm_key(h), h)
        self.rows = reads.db.rows(self.ref)

    def cell(self, at: int, name: str) -> str:
        """str_ of the cell getValues() hands back; '' for a column the tab lacks."""
        h = self.raw.get(name)
        return "" if h is None else s_(hubdb.typed(self.rows[at][1].get(h), "hub"))

    def text(self, at: int, name: str) -> str:
        """The cell as the copy holds its text: a kept edit's `before`."""
        h = self.raw.get(name)
        return "" if h is None else gsjs.or_blank(self.rows[at][1].get(h))

    def head(self, name: str) -> str | None:
        h = self.raw.get(name)
        return None if h is None else gsjs.trim(gsjs.js_str(h))

    def ids(self) -> list[str]:
        return [self.cell(i, "userid") for i in range(len(self.rows))]

    def first(self, uid: str) -> int | None:
        return next((i for i, rid in enumerate(self.ids()) if rid == uid), None)

    def last(self, uid: str) -> int | None:
        hits = [i for i, rid in enumerate(self.ids()) if rid == uid]
        return hits[-1] if hits else None

    def is_master(self, at: int) -> bool:
        """hubIsMasterRow_."""
        return sc.is_master_email(self.cell(at, "email"))

    def hidden(self, at: int, user: dict) -> bool:
        """The master's row is the real master's alone: to anyone else it is not there."""
        return self.is_master(at) and not sc.is_real_master(user)

    def key(self, at: int) -> tuple[str, str] | None:
        """The row named by its user_id alone; None when the id is on another row too."""
        h = self.raw.get("userid")
        return None if h is None else W.row_key_of(self.rows, at, [[h]])

    def lacks(self, names: Any) -> bool:
        """A column the cells name that the tab does not have (ensureUserProfileColumns_ adds it in Apps Script)."""
        return any(n not in self.raw for n in names)

    def armed(self, at: int) -> bool:
        """!!str_(pass_hash): the copy marks a hash it withholds; a password the sign-in's store keeps counts too."""
        if gsjs.trim(self.text(at, "passhash")):
            return True
        cur = W.HELD.get()
        if cur is None or not credentials_ready():
            return False
        got = AS.credential(cur, self.cell(at, "userid"))
        return bool(got and got["hash"])

    def append(self, uid: str, cells: dict[str, str]) -> dict[str, Any]:
        """A new account's row (appendRow), its cells by header, keyed by its user_id."""
        heads = {self.head(n): v for n, v in cells.items() if self.head(n) is not None and v != ""}
        return W.kept_record(self.sid, self.tab, "append", W.COLS + self.head("userid"), uid, SUBJECT, heads)


def carried(sess: L.Session, acc: Accounts, changes: list[tuple[int, dict[str, str]]], action: str) -> list[dict]:
    """Each row's changed cells: one kept edit (by the row's user_id) and one `cells` book op carrying them to the
    sheet at once."""
    edits: list[dict] = []
    ops: list[dict] = []
    match_head = acc.head("userid")
    for at, cells in changes:
        got = acc.key(at)
        after: dict[str, str] = {}
        before: dict[str, str] = {}
        for name, value in cells.items():
            if acc.cell(at, name) != value:
                after[acc.head(name)] = value
                before[acc.head(name)] = acc.text(at, name)
        if not after or got is None:
            continue
        edits.append(W.kept_record(acc.sid, acc.tab, "edit", got[0], got[1], SUBJECT, after, before))
        ops.append({"op": "cells", "sheet_id": acc.sid, "tab": acc.tab,
                    "spec": {"match": match_head, "key": acc.cell(at, "userid"), "cells": after, "before": before}})
    if not acc.kept:
        BO.queue(ops, SUBJECT, W.who(sess.user), action)
    return edits


def _guarded(fn: Callable[[], None]) -> None:
    """A side write in this write's transaction that may fail alone (a savepoint), never taking the write with it."""
    cur = W.HELD.get()
    if cur is None:
        return
    cur.execute("savepoint users_side")
    try:
        fn()
    except Exception:  # noqa: BLE001 - the side write is best effort, as its Apps Script twin
        cur.execute("rollback to savepoint users_side")
        return
    if int(getattr(cur.connection.info, "transaction_status", 0) or 0) == 3:
        cur.execute("rollback to savepoint users_side")
    else:
        cur.execute("release savepoint users_side")


def log_line(user: dict, action: str, detail: str, status: int = 200) -> None:
    """hubSysLog_."""
    _guarded(lambda: SV.record(user, action, detail, status))


def profile_stale(reads: L.Reads, uid: str) -> list[dict]:
    """profileStoreStale_: the account's stored profile read as stale, so the next userProfileDeep assembles it again —
    the Hub's own row in this transaction, each entity_user_profiles row a kept edit can name; a row none can name heals
    on its own six-hour clock, as the store's catch says."""
    def own() -> None:
        cur = W.HELD.get()
        cur.execute("select to_regclass(%s)", (UP.STORE_TABLE,))
        if cur.fetchone()[0] is not None:
            cur.execute(f"update {UP.STORE_TABLE} set updated_at = '' where user_id = %s", (uid,))
    _guarded(own)
    try:
        res = reads.db.resolve(UP.PROFILE_STORE_TAB)
    except (hubdb.Unreadable, Defer):
        return []
    if res.runtime or res.ref is None:
        return []
    heads: dict[str, Any] = {}
    for h in res.ref.headers:
        heads.setdefault(hubdb.norm_key(h), h)
    if "userid" not in heads or "updatedat" not in heads:
        return []
    rows = reads.db.rows(res.ref)
    sid, tab = W.where_of(res)
    at_head = gsjs.trim(gsjs.js_str(heads["updatedat"]))
    sets = [[heads["userid"]], [heads["userid"], heads.get("namekey")], [heads["userid"], heads.get("name")]]
    out: list[dict] = []
    for i, (_rn, raw) in enumerate(rows):
        if s_(hubdb.typed(raw.get(heads["userid"]), "hub")) != uid:
            continue
        stamped = gsjs.or_blank(raw.get(heads["updatedat"]))
        if not gsjs.trim(stamped):
            continue
        got = W.row_key_of(rows, i, [[h for h in hs if h] for hs in sets])
        if got is not None:
            out.append(W.kept_record(sid, tab, "edit", got[0], got[1], SUBJECT, {at_head: ""}, {at_head: stamped}))
    return out


# ---- userUpdate --------------------------------------------------------------------------------------------------

def fields_write(p: dict, cells: dict[str, str]) -> None:
    """hubUserFieldsWrite_: the contact cells, the fields present only; the sign-in e-mail is never among them."""
    if "display_name" in p:
        cells["displayname"] = s_(p.get("display_name"))
        cells["nameby"] = ""
    if "phone" in p:
        cells["phone"] = s_(p.get("phone"))[:40]
    if "phones" in p:
        phones = SP._clean_phones(p.get("phones"))
        cells["phones"] = _json(phones)
        if "phone" not in p:
            cells["phone"] = phones[0]["number"] if phones else ""
    if "emails" in p:
        cells["emails"] = _json(SP._clean_emails(p.get("emails")))
    if "avatar" in p:
        cells["avatar"] = s_(p.get("avatar"))[:500]


def interview_grant(stored: str) -> str | None:
    """Granting HM or INTERVIEWER grants the scorecard pen (hiring.interview) on the stored overrides; None when it is
    already granted."""
    try:
        now: Any = json.loads(stored or "{}")
    except ValueError:
        now = {}
    if gsjs.falsy(now):
        now = {}
    if isinstance(now, dict):
        if now.get("hiring.interview") is True:
            return None
        now = {**now, "hiring.interview": True}
    return _json(now)


def update(sess: L.Session, payload: dict) -> Decision:
    """userUpdate: one account's fields, those present in the payload only (admin). A refusal writes nothing."""
    p = payload if isinstance(payload, dict) else {}
    shut, here = door_gate(sess, "userUpdate", p)
    if shut is not None:
        return shut
    user = sess.user or {}
    if not sess.user or s_(user.get("role")) != "admin":
        return Decision(dict(DENIED))
    reads = sess.reads
    uid = s_(p.get("user_id"))
    acc = Accounts(reads)
    at = acc.first(uid)
    unknown = W.refuse(404, 'No user "' + uid + '".', fresh=(acc.sid,))
    if at is None or acc.hidden(at, user):
        return unknown
    if here and not acc.is_master(at) and here not in SD.tenant_ids_for_user(acc.cell(at, "hometenant"),
                                                                              acc.cell(at, "tenants")):
        # tenantUserVisible_: you may only edit somebody who is here
        return unknown
    if "app_denials" in p and not sc.is_real_master(user) and \
            not denials_same(p.get("app_denials"), acc.cell(at, "appdenials")):
        return W.refuse(403, "Per-person app access is the master's alone.")
    if "types" in p:
        bad = grant_refused(user, acc.cell(at, "types"), p.get("types"))
        if bad:
            return Decision(bad)
    if acc.key(at) is None:
        # an id on two rows: Apps Script wrote the first by its position, which no kept edit names
        return W.refuse(409, W.NOT_TOLD_APART, fresh=(acc.sid,))
    cells: dict[str, str] = {}
    if "display_name" in p:
        cells["displayname"] = s_(p.get("display_name"))
        cells["nameby"] = ""
    if "role" in p:
        role = s_(p.get("role"))
        if role not in ROLES:
            return W.refuse(400, "invalid role")
        cells["role"] = role
    if "active" in p:
        cells["active"] = "false" if gsjs.falsy(p.get("active")) else "true"
    if "system_hidden" in p:
        cells["systemhidden"] = "" if gsjs.falsy(p.get("system_hidden")) else "true"
    if "system_type" in p:
        st = s_(p.get("system_type")).upper()
        if st and st not in SYSTEM_USER_TYPES:
            return W.refuse(400, "system_type must be one of: " + ", ".join(SYSTEM_USER_TYPES) + " (or empty).")
        cells["systemtype"] = st
    if "types" in p:
        types, bad_words = types_of(p.get("types"))
        if bad_words:
            return W.refuse(400, "Unknown type: " + ", ".join(bad_words) + ". Types are: " +
                            ", ".join(sc.USER_TYPES) + ".")
        cells["types"] = ", ".join(types)
        if "INTERVIEWER" in types or "HM" in types:
            granted = interview_grant(acc.cell(at, "permoverrides"))
            if granted is not None:
                cells["permoverrides"] = granted
    if "home_tenant" in p or "tenants" in p:
        wanted: list[str] = []
        if "home_tenant" in p:
            wanted.append(s_(p.get("home_tenant")))
        extra: list[str] = []
        if "tenants" in p:
            raw = p.get("tenants")
            items = raw if isinstance(raw, list) else gsjs.or_text(raw).split(",")
            extra = [t for t in (gsjs.trim(gsjs.or_text(x)) for x in items) if t]
            wanted += extra
        bad = place_refused(reads, wanted, user)
        if bad:
            return Decision(bad)
        if "home_tenant" in p:
            cells["hometenant"] = s_(p.get("home_tenant"))
        if "tenants" in p:
            cells["tenants"] = ", ".join(extra)
    if "client_key" in p:
        cells["clientkey"] = s_(p.get("client_key"))[:120]
    if "title" in p:
        cells["title"] = s_(p.get("title"))[:120]
    fields_write(p, cells)
    if "perm_overrides" in p:
        ov = p.get("perm_overrides")
        cells["permoverrides"] = _json({} if gsjs.falsy(ov) else ov)
    if "app_denials" in p:
        cells["appdenials"] = _json(denials_normalize(p.get("app_denials")))
    pw = ""
    if "password" in p:
        pw = gsjs.or_text(p.get("password"))
        if js_len(pw) < PASSWORD_MIN:
            return W.refuse(400, "password must be at least 8 characters")
        if master_sign_in_elsewhere(acc.cell(at, "email")):
            # the real master's own sign-in reads the sheet's salt and hash, which only Apps Script writes
            return Decision(None, engine=True)
        if not credentials_ready():
            # no credential store to keep it in: nothing is written
            return Decision(dict(UNSURE))
        # a password chosen by a hand retires the one-use default
        cells["mustchange"] = ""
    if acc.lacks(cells):
        # Apps Script added the column before writing it; the copy has none to keep the cell in
        return Decision(dict(UNSURE))
    edits = carried(sess, acc, [(at, cells)], "userUpdate")
    if pw:
        credential_put(uid, pw, None)
    edits += profile_stale(reads, uid)
    d = W.final({"status": 200, "data": {"ok": True}}, edits, SUBJECT)
    if pw and not d.edits:
        # the credential alone was kept: the relay answers it final all the same
        d.own, d.subject = True, SUBJECT
    return d


# ---- userDelete --------------------------------------------------------------------------------------------------

def taken_off(sess: L.Session, acc: Accounts, at: int, action: str) -> None:
    """The row deleted from the sheet (a `delete` book op: the one row the id names, and only while it still holds
    the address and role this decision read) and taken off every Python read meanwhile (a `delete` the own-write layer
    lays until the copy no longer holds the row)."""
    got = acc.key(at)
    cur = W.HELD.get()
    if cur is None or got is None:
        raise W.NotKept("a removal is kept only under the platform's write lock")
    uid = acc.cell(at, "userid")
    if acc.kept:
        # its own table: the one row the id names taken out there, in this write
        hit = HT.find(sess.reads, TAB, acc.head("userid") or "user_id", uid)
        if hit is None:
            raise W.NotKept("the account's row is not in its table")
        RR.remove(sess.reads, HT.resource_of(TAB) or "", hit[0], hit[1], W.who(sess.user))
        return
    expect = {acc.head(n): acc.text(at, n) for n in ("email", "role") if acc.head(n) is not None}
    BO.queue([{"op": "delete", "sheet_id": acc.sid, "tab": acc.tab,
               "spec": {"match": acc.head("userid"), "key": uid, "which": "only", "expect": expect}}],
             SUBJECT, W.who(sess.user), action)
    cur.execute(f"insert into {own_table('writes')} (write_id, action, house, sheet_id, tab_name, kind, match_by,"
                " keyed_by, row_key, cells, author, state) values (%s, %s, %s, %s, %s, 'delete', %s, 'header', %s,"
                " '{}'::jsonb, %s, 'queued')",
                (SC.write_id(), action, SUBJECT, acc.sid, acc.tab, got[0], got[1], W.who(sess.user)))


def delete(sess: L.Session, payload: dict) -> Decision:
    """userDelete: back to roster — the ACCOUNT row is deleted (sheet.deleteRow), the person stays on the People
    roster. Refuses yourself, the last admin and an unknown id."""
    p = payload if isinstance(payload, dict) else {}
    shut, _here = door_gate(sess, "userDelete", p)
    if shut is not None:
        return shut
    user = sess.user or {}
    if not sess.user or s_(user.get("role")) != "admin":
        return Decision(dict(DENIED))
    uid = s_(p.get("user_id"))
    if not uid:
        return W.refuse(400, "user_id is required.")
    # the account at the keyboard (HUB_CALLER): during a visit, the caller the envelope kept, never the visited person
    if uid == s_(EV.caller_of(user).get("id")):
        return W.refuse(400, "You cannot delete your own account.")
    acc = Accounts(sess.reads)
    at = acc.first(uid)
    if at is None or acc.hidden(at, user):
        return W.refuse(404, 'No user "' + uid + '".', fresh=(acc.sid,))
    admins = sum(1 for i in range(len(acc.rows)) if acc.cell(i, "role") == "admin")
    if acc.cell(at, "role") == "admin" and admins <= 1:
        return W.refuse(400, "Refusing to delete the last admin account.", fresh=(acc.sid,))
    if acc.key(at) is None:
        return W.refuse(409, W.NOT_TOLD_APART, fresh=(acc.sid,))
    who = acc.cell(at, "displayname") or uid
    taken_off(sess, acc, at, "userDelete")
    log_line(user, "userDelete", who + " — account removed (person record untouched)")
    return Decision({"status": 200, "data": {"id": uid, "deleted": True}}, own=True, subject=SUBJECT)


# ---- userMergeManual ---------------------------------------------------------------------------------------------

def list_cell(acc: Accounts, at: int, name: str) -> list:
    """The merge's listCell: a JSON array, else the cell split on , ; | and new lines."""
    raw = acc.cell(at, name)
    try:
        got = json.loads(raw)
        return got if isinstance(got, list) else []
    except ValueError:
        pass
    return [t for t in (gsjs.trim(x) for x in re.split(r"[,;|\n]+", raw)) if t] if raw else []


def phone_num(q: Any) -> str:
    """str_(p && (p.number || p))."""
    if gsjs.falsy(q):
        return s_(q)
    got = q.get("number") if isinstance(q, dict) else None
    return s_(q if gsjs.falsy(got) else got)


def merge(sess: L.Session, payload: dict) -> Decision:
    """userMergeManual: the selected rows folded into the keeper — their sign-in e-mail and every phone and extra
    e-mail gathered onto it, the candidate link, types, title and phone filling its blanks; nothing deleted, each folded
    row stamped merged_into and deactivated."""
    p = payload if isinstance(payload, dict) else {}
    shut, _here = door_gate(sess, "userMergeManual", p)
    if shut is not None:
        return shut
    user = sess.user or {}
    if not sess.user or user.get("is_service") or s_(user.get("role")) != "admin":
        return Decision(dict(DENIED))
    keep_id = s_(p.get("keep_id"))
    raw_ids = p.get("fold_ids") if isinstance(p.get("fold_ids"), list) else []
    fold_ids = [x for x in (s_(i) for i in raw_ids) if x and x != keep_id]
    if not fold_ids:
        return W.refuse(400, "Pick at least one row to fold.")
    acc = Accounts(sess.reads)
    ids = acc.ids()
    keep_at = acc.last(keep_id)
    folds = [i for i, rid in enumerate(ids) if rid != keep_id and rid in fold_ids]
    if keep_at is None or acc.hidden(keep_at, user):
        return W.refuse(404, 'No user "' + keep_id + '".', fresh=(acc.sid,))
    if len(folds) != len(fold_ids) or any(acc.hidden(i, user) for i in folds):
        return W.refuse(404, "A selected row no longer exists.", fresh=(acc.sid,))
    emails = list_cell(acc, keep_at, "emails")
    phones = list_cell(acc, keep_at, "phones")
    keep_email = acc.cell(keep_at, "email").lower()
    candidate = acc.cell(keep_at, "candidateid")
    types = acc.cell(keep_at, "types")
    title = acc.cell(keep_at, "title")
    phone = acc.cell(keep_at, "phone")
    for fr in folds:
        fe = acc.cell(fr, "email").lower()
        if fe and fe != keep_email and fe not in [gsjs.js_str(x).lower() for x in emails]:
            emails.append(fe)
        for x in list_cell(acc, fr, "emails"):
            lx = gsjs.js_str(x).lower()
            if lx and lx != keep_email and lx not in [gsjs.js_str(y).lower() for y in emails]:
                emails.append(x)
        fp = acc.cell(fr, "phone")
        fold_phones = list_cell(acc, fr, "phones")
        if fp:
            fold_phones.append({"label": "Phone", "number": fp})
        for q in fold_phones:
            num = phone_num(q)
            if not num:
                continue
            if not any(phone_num(h) == num for h in phones) and num != phone:
                phones.append(q if isinstance(q, dict) and not gsjs.falsy(q.get("number"))
                              else {"label": "Phone", "number": num})
        candidate = candidate or acc.cell(fr, "candidateid")
        types = types or acc.cell(fr, "types")
        title = title or acc.cell(fr, "title")
        phone = phone or fp
    bad = grant_refused(user, acc.cell(keep_at, "types"), types)
    if bad:
        return Decision(bad)
    if acc.key(keep_at) is None or any(acc.key(i) is None for i in folds):
        return W.refuse(409, W.NOT_TOLD_APART, fresh=(acc.sid,))
    kept: dict[str, str] = {"emails": _json(SP._clean_emails(emails)), "phones": _json(SP._clean_phones(phones))}
    for name, v in (("candidateid", candidate), ("types", types), ("title", title), ("phone", phone)):
        if v and name in acc.raw:
            kept[name] = v
    stamp = {"mergedinto": keep_id, "active": "false"}
    if acc.lacks(kept) or acc.lacks(stamp):
        return Decision(dict(UNSURE))
    edits = carried(sess, acc, [(keep_at, kept)] + [(i, dict(stamp)) for i in folds], "userMergeManual")
    log_line(user, "user_merge_manual",
             keep_id + " ← " + ", ".join(fold_ids) + " (" + acc.cell(keep_at, "displayname") + ")")
    return W.final({"status": 200, "data": {"kept": keep_id, "folded": len(fold_ids)}}, edits, SUBJECT)


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {
    "userUpdate": update, "userDelete": delete, "userMergeManual": merge}
# the declared roles and params come after the place (doPost), so each door asks them itself (door_gate)
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
# every door reads where the session stands from envelope.place_of, never from the account's home; userCreate
# (app/users_accounts.py) is decided under this module too
PLACE_SAFE = frozenset(ACTIONS) | {"userCreate"}
# LockService's wait refused; userMergeManual takes no lock, and a write held by another is not its answer
BUSY_OF: dict[str, dict[str, Any]] = {"userUpdate": {"status": 503, "message": BUSY},
                                      "userDelete": {"status": 503, "message": BUSY}}


class Store(RR.Store):
    """app.users_account_writes and _receipts (a removal's read overlay); the account cells app.edits', carried to the
    sheet by app.book_ops; the People folds' rows people_types keeps in its table, taken back with a void."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind=KIND, label="Users › account edits")

    def settle(self, write_id: str, state: str, why: str = "", fields: list[str] | None = None) -> bool:
        done = super().settle(write_id, state, why, fields)
        if state != "void":
            return done
        try:
            with self.conn().transaction():
                void_cleanup(self.conn(), write_id)
        except Exception as exc:  # noqa: BLE001 - said, never raised into the relay's settle
            W.log.warning("users: the void of %s left its book ops queued (%s)", write_id[:40], type(exc).__name__)
        return True


def own_table(part: str) -> str:
    """app.users_account_<part>, or its stand-in beside a stand-in app.edits."""
    return W.beside(f"{KIND}_{part}")


def void_cleanup(c: Any, write_id: str) -> None:
    """A write the relay voided leaves nothing behind: its book ops not yet carried, a removal's read overlay, its
    receipt, and what the sign-in's store kept under it."""
    c.execute(f"update {BO.table()} set state = 'cancelled', done_at = now(), why = 'its write was void'"
              " where write_id = %s and state = 'pending'", (write_id,))
    c.execute(f"delete from {own_table('writes')} where write_id = %s and kind = 'delete'", (write_id,))
    c.execute(f"delete from {own_table('receipts')} where write_id = %s", (write_id,))
    if "void" in CREDENTIALS:
        CREDENTIALS["void"](c, write_id)
