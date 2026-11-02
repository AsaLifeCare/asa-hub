"""Accounts made and armed (apps-script/HubCore.gs userCreate, userActivate, usersArm; Clients.gs clientUserCreate;
UsersBulk.gs usersFromPeople, usersFromSigned, usersFromClients, usersFromGuardians) off asa-hub-db: each new
account's row kept in app.edits as Apps Script appended it; its password — a typed one, or the workspace default
flagged to be changed at the first sign-in — kept by the sign-in's credential store, never on the sheet; an existing
row's cells kept and carried as users_writes keeps them; every refusal and every skip in its own words. The master's
row is the real master's alone, as in users_writes."""
from __future__ import annotations

import json
import math
import re
from typing import Any, Callable

import auth as A
import client_writes as CLW
import clients as C
import contacts_sync as CS
import gsjs
import locations as L
import staff as SP
import staff_comms as STC
import users_writes as UW
import writes as W
from scope import Defer
from writes import Decision

s_ = gsjs.str_
# UsersBulk.gs BULK_NEAR_RATIO: close enough to be worth a human's eye, not close enough to act on
NEAR_RATIO = 0.88
ROLES = UW.ROLES
PASS_RUNNING = {"status": 409, "message": "The pass is already running — check the platform log for its counts."}
NO_DEFAULT = "Set the FIRST_USER_PASSWORD Script Property first — "
CLIENTS_UNREAD = {"status": 503, "message": "The clients could not be read — nothing was made."}
ROSTER_UNREAD = {"status": 503, "message": "The roster could not be read — nothing was made."}
CONTRACTS_UNREAD = {"status": 503, "message": "The contracts mirror could not be read — nothing was made."}
CONTRACTS_TAB = "recruitment_contracts"
SHARED_LINE_DIGITS = CS.SHARED_LINE_DIGITS


def _no_default(why: str) -> Decision:
    return Decision({"status": 500, "message": NO_DEFAULT + why})


def js_round(x: float) -> int:
    """Math.round."""
    return int(math.floor(x + 0.5))


def new_uid() -> str:
    """'USR_' + randomHex_(12).toUpperCase()."""
    return "USR_" + A.random_hex(12).upper()


def _admin(sess: L.Session, service_too: bool = True) -> bool:
    user = sess.user or {}
    return bool(sess.user) and (service_too or not user.get("is_service")) and s_(user.get("role")) == "admin"


# ---- the identity gate (UsersBulk.gs) -----------------------------------------------------------------------------

def identity_index(rows: list[dict]) -> dict[str, Any]:
    """bulkIdentityIndex_."""
    idx: dict[str, Any] = {"login": {}, "name": {}, "no_middle": {}, "phone": {}, "names": []}
    for u in rows or ():
        mail = s_(u.get("email")).lower()
        if mail:
            idx["login"][mail] = s_(u.get("displayname")) or mail
        disp = s_(u.get("displayname"))
        if disp:
            k, nm = CS.bulk_name_key(disp), CS.bulk_name_key_no_middle(disp)
            if k:
                idx["name"][k] = disp
                idx["names"].append((k, disp))
            if nm:
                idx["no_middle"][nm] = disp
        ph = CS.bulk_phone_key(u.get("phone"))
        if ph:
            idx["phone"][ph] = disp or ph
    return idx


def index_add(idx: dict[str, Any], name: str, login: str, phone: Any) -> None:
    """A row made in this pass joins the index: two roster lines for one human must not both land."""
    nk, nmk, pk = CS.bulk_name_key(name), CS.bulk_name_key_no_middle(name), CS.bulk_phone_key(phone)
    idx["login"][gsjs.or_text(login).lower()] = name
    if nk:
        idx["name"][nk] = name
        idx["names"].append((nk, name))
    if nmk:
        idx["no_middle"][nmk] = name
    if pk:
        idx["phone"][pk] = name


def already_has(idx: dict[str, Any], name: Any, login: Any, phone: Any) -> dict[str, Any] | None:
    """bulkAlreadyHas_: the account this person already has, `how` it was matched; `near` is a question, never a
    match."""
    mail = gsjs.or_text(login).lower()
    if mail and idx["login"].get(mail):
        return {"how": "login", "who": idx["login"][mail]}
    ph = CS.bulk_phone_key(phone)
    if ph and idx["phone"].get(ph):
        return {"how": "phone", "who": idx["phone"][ph]}
    k = CS.bulk_name_key(name)
    if k and idx["name"].get(k):
        return {"how": "name", "who": idx["name"][k]}
    nm = CS.bulk_name_key_no_middle(name)
    if nm and idx["no_middle"].get(nm):
        return {"how": "name", "who": idx["no_middle"][nm]}
    best, best_r = None, 0.0
    for key, disp in idx["names"]:
        r = CS.bulk_name_ratio(k, key)
        if r > best_r:
            best_r, best = r, disp
    if best and best_r >= NEAR_RATIO:
        return {"how": "near", "who": best, "ratio": best_r}
    return None


def identity_conflict(reads: L.Reads, name: str, email: str, phone: str) -> dict[str, Any] | None:
    """userIdentityConflict_: an unreadable users tab refuses nothing."""
    try:
        rows = reads.users()
    except Exception:  # noqa: BLE001 - its catch: a transient read failure never refuses a creation
        return None
    return already_has(identity_index(rows), s_(name), s_(email).lower(), s_(phone))


def status_wanted(status: Any) -> bool:
    """bulkStatusWanted_."""
    return gsjs.trim(gsjs.or_text(status)).lower() not in ("on leave", "offboarding", "archived", "away", "off")


def phone_login(raw: Any) -> str:
    """A sign-in made from a phone: the whole number with its country code (the operator, 10-30: "use o telefone
    completo como login"), 1 + the ten US digits; never the bare ten an older account may already sign in with."""
    digits = re.sub(r"\D+", "", gsjs.or_text(raw))
    if len(digits) == 10:
        return "1" + digits
    return digits if len(digits) >= 7 else ""


def login_of(email: Any, phone: Any) -> str:
    """bulkLoginOf_."""
    login = gsjs.trim(gsjs.or_text(email)).lower()
    if "@" in login:
        return login
    return phone_login(phone)


def new_row(acc: UW.Accounts, reads: L.Reads, here: str, uid: str, login: str, name: str, role: str,
            extra: dict[str, str]) -> dict[str, Any]:
    """The appended row: the sign-in, the name, the role, active, born now; the place it was made in."""
    cells = {"userid": uid, "email": login, "displayname": name, "role": role, "active": "true",
             "createdat": W.now_iso(reads), **extra}
    if here:
        cells["hometenant"] = here
    return acc.append(uid, cells)


# ---- userCreate ---------------------------------------------------------------------------------------------------

def user_create(sess: L.Session, payload: dict) -> Decision:
    """userCreate: an account (admin), active at once; no typed password arms it with the workspace default."""
    p = payload if isinstance(payload, dict) else {}
    shut, here = UW.door_gate(sess, "userCreate", p)
    if shut is not None:
        return shut
    if not _admin(sess):
        return Decision(dict(UW.DENIED))
    reads = sess.reads
    email = s_(p.get("email")).lower()
    name, pw = s_(p.get("display_name")), gsjs.or_text(p.get("password"))
    role = s_(p.get("role")) or "staff"
    if role not in ROLES:
        return W.refuse(400, "role must be admin, manager, staff or client")
    # no e-mail: the whole phone is the sign-in (phone_login)
    if "@" not in email:
        email = phone_login(p.get("phone") or email)
    if not name or not email:
        return W.refuse(400, "Name and a valid email or phone are required.")
    defaulted = False
    if not pw:
        pw = UW.default_password(reads)
        if not pw:
            return _no_default("new accounts are armed with that default.")
        defaulted = True
    elif UW.js_len(pw) < UW.PASSWORD_MIN:
        return W.refuse(400, "A typed password needs at least 8 characters.")
    if A.user_by_email(reads.users(), email):
        return W.refuse(409, "A user with this email already exists.")
    clash = identity_conflict(reads, name, email, s_(p.get("phone")))
    if clash and clash["how"] == "near" and p.get("confirm_distinct") is not True:
        return W.refuse(409, f'"{name}" looks like "{clash["who"]}" ({js_round((clash.get("ratio") or 0) * 100)}% '
                             "alike), who already has an account. If they are different people, send "
                             "confirm_distinct to create it anyway.")
    if clash and clash["how"] != "near":
        return W.refuse(409, f'"{clash["who"]}" already has an account — matched by {clash["how"]}. Edit that '
                             "account instead of making a second one.")
    if not UW.credentials_ready():
        return Decision(dict(UW.UNSURE))
    acc = UW.Accounts(reads)
    uid = new_uid()
    edit = new_row(acc, reads, here, uid, email, name, role, {"mustchange": "true"} if defaulted else {})
    UW.credential_put(uid, pw, True if defaulted else None)
    return W.final({"status": 200, "data": {"id": uid, "email": email, "display_name": name, "role": role}},
                   [edit], UW.SUBJECT)


# ---- userActivate, usersArm -----------------------------------------------------------------------------------------

def user_activate(sess: L.Session, payload: dict) -> Decision:
    """userActivate: the account turned active; an unarmed one receives the workspace default, an armed one keeps its
    own password."""
    p = payload if isinstance(payload, dict) else {}
    shut, _here = UW.door_gate(sess, "userActivate", p)
    if shut is not None:
        return shut
    user = sess.user or {}
    if not _admin(sess, service_too=False):
        return Decision(dict(UW.DENIED))
    reads = sess.reads
    uid = s_(p.get("user_id"))
    acc = UW.Accounts(reads)
    at = acc.last(uid)
    if at is None or acc.hidden(at, user):
        return W.refuse(404, 'No user "' + uid + '".', fresh=(acc.sid,))
    if acc.key(at) is None:
        return W.refuse(409, W.NOT_TOLD_APART, fresh=(acc.sid,))
    cells = {"active": "true"}
    pw = ""
    if not acc.armed(at):
        pw = UW.default_password(reads)
        if not pw:
            return _no_default("activation hands every unarmed account that default.")
        if not UW.credentials_ready():
            return Decision(dict(UW.UNSURE))
        cells["mustchange"] = "true"
    edits = UW.carried(sess, acc, [(at, cells)], "userActivate")
    if pw:
        UW.credential_put(uid, pw, True)
    UW.log_line(user, "user_activate",
                uid + (" — default password set, active" if pw else " — reactivated, own password kept"))
    d = W.final({"status": 200, "data": {"activated": True, "defaulted": bool(pw)}}, edits, UW.SUBJECT)
    if not d.edits and pw:
        d.own, d.subject = True, UW.SUBJECT
    return d


def users_arm(sess: L.Session, payload: dict) -> Decision:
    """usersArm: every selected account active; an unarmed one receives the workspace default, an armed one keeps its
    own password. Another admin's selection never reaches the master's row."""
    p = payload if isinstance(payload, dict) else {}
    shut, _here = UW.door_gate(sess, "usersArm", p)
    if shut is not None:
        return shut
    user = sess.user or {}
    if not _admin(sess):
        return Decision(dict(UW.DENIED))
    ids = p.get("user_ids") or []
    if not isinstance(ids, list) or not ids:
        return W.refuse(400, "user_ids: which accounts to arm.")
    reads = sess.reads
    pw = UW.default_password(reads)
    if not pw:
        return _no_default("arming hands every unarmed account that default.")
    acc = UW.Accounts(reads)
    wanted = {i for i in ids if isinstance(i, str)}
    rows = [i for i in range(len(acc.rows)) if acc.cell(i, "userid") in wanted and not acc.hidden(i, user)]
    if any(acc.key(i) is None for i in rows):
        return W.refuse(409, W.NOT_TOLD_APART, fresh=(acc.sid,))
    defaulted, kept, changes, owed = 0, 0, [], []
    for i in rows:
        cells = {"active": "true"}
        if not acc.armed(i):
            cells["mustchange"] = "true"
            owed.append(acc.cell(i, "userid"))
            defaulted += 1
        else:
            kept += 1
        changes.append((i, cells))
    if owed and not UW.credentials_ready():
        return Decision(dict(UW.UNSURE))
    edits = UW.carried(sess, acc, changes, "usersArm")
    for uid in owed:
        UW.credential_put(uid, pw, True)
    UW.log_line(user, "users_arm", f"{len(rows)} account(s) activated — {defaulted} with the default password, "
                                   f"{kept} keeping their own")
    d = W.final({"status": 200, "data": {"armed": len(rows), "defaulted": defaulted, "kept": kept}}, edits,
                UW.SUBJECT)
    if not d.edits and owed:
        d.own, d.subject = True, UW.SUBJECT
    return d


# ---- clientUserCreate and the passes over the clients --------------------------------------------------------------

class Made:
    """The accounts this decision makes: their rows, their passwords owed, and their logins (userByEmail_ reads them
    as Apps Script's next call would)."""

    def __init__(self, reads: L.Reads, here: str) -> None:
        self.reads, self.here = reads, here
        self.acc = UW.Accounts(reads)
        self.edits: list[dict] = []
        self.owed: list[str] = []
        self.logins: dict[str, dict[str, str]] = {}
        self.rows: list[dict] | None = None

    def by_login(self, login: str) -> dict[str, str] | None:
        """userByEmail_ over the copy and what this decision made."""
        hit = self.logins.get(gsjs.trim(login).lower())
        if hit is not None:
            return hit
        if self.rows is None:
            self.rows = self.reads.users()
        u = A.user_by_email(self.rows, login)
        return None if u is None else {"userid": s_(u.get("userid")), "clientkey": s_(u.get("clientkey"))}

    def add(self, login: str, name: str, role: str, extra: dict[str, str], client_key: str = "") -> str:
        uid = new_uid()
        self.edits.append(new_row(self.acc, self.reads, self.here, uid, login, name, role, extra))
        self.owed.append(uid)
        self.logins[gsjs.trim(login).lower()] = {"userid": uid, "clientkey": client_key}
        return uid


def client_account(made: Made, user: dict, rec: dict, kind: str, pw: str) -> dict[str, Any]:
    """clientUserCreate's body for one client record: the answer, the account kept in `made`."""
    if kind == "client":
        CLW.marked(rec.get("name"), rec.get("client_email"), rec.get("client_phone"))
        display, phone = s_(rec.get("name")), s_(rec.get("client_phone"))
        login = gsjs.trim(s_(rec.get("client_email"))).lower() or phone_login(rec.get("client_phone"))
        title = "Client"
        if not login:
            return {"status": 422, "message": f"The plan holds no e-mail and no phone for {display} — there is nothing "
                                              "to sign in with. Fill one on the record first."}
    else:
        CLW.marked(rec.get("name"), rec.get("guardianName"), rec.get("guardian_name"), rec.get("guardian_email"),
                   rec.get("guardian_phone"))
        display = s_(rec.get("guardianName")) or s_(rec.get("guardian_name"))
        if not display or display.lower() == "self":
            return {"status": 422, "message": f"The plan names no separate guardian for {s_(rec.get('name'))} — no "
                                              "guardian account can be made."}
        phone = s_(rec.get("guardian_phone"))
        login = gsjs.trim(s_(rec.get("guardian_email"))).lower() or phone_login(rec.get("guardian_phone"))
        title = "Family of " + s_(rec.get("name"))
        if not login:
            return {"status": 422, "message": f"The plan holds no e-mail and no phone for guardian {display} — there "
                                              "is nothing to sign in with. Fill one on the record first."}
    existing = made.by_login(login)
    if existing is not None:
        if existing["clientkey"] == s_(rec.get("client_key")):
            return {"status": 200, "data": {"already": True, "id": existing["userid"], "login": login}}
        return {"status": 409, "message": f'The login "{login}" already belongs to another account.'}
    if not pw:
        return {"status": 500, "message": NO_DEFAULT + "client accounts are armed with that default."}
    if not UW.credentials_ready():
        return dict(UW.UNSURE)
    extra = {"title": title, "phone": s_(phone), "clientkey": s_(rec.get("client_key")), "mustchange": "true",
             "types": "FAMILY" if kind == "guardian" else "CLIENT"}
    if kind == "client" and s_(rec.get("avatar")):
        extra["avatar"] = s_(rec.get("avatar"))[:500]
    uid = made.add(login, display, "client", extra, s_(rec.get("client_key")))
    UW.log_line(user, "client_user_create",
                f"{kind} account for {s_(rec.get('name'))} — signs in as {login} (default password)")
    return {"status": 200, "data": {"id": uid, "login": login, "kind": kind, "defaulted": True}}


def _clients(reads: L.Reads) -> list[dict] | None:
    try:
        return C.derived(reads)
    except Exception:  # noqa: BLE001 - its catch: the clients could not be read
        return None


def _finish(made: Made, answer: dict[str, Any], pw: str) -> Decision:
    """The rows made kept and their default passwords kept by the sign-in's store."""
    for uid in made.owed:
        UW.credential_put(uid, pw, True)
    return W.final(answer, made.edits, UW.SUBJECT)


def client_user_create(sess: L.Session, payload: dict) -> Decision:
    """clientUserCreate: a login for a client or their guardian, the FAMILY badge (e-mail, else the whole phone,
    phone_login); the same client twice answers already, another account's login is 409."""
    p = payload if isinstance(payload, dict) else {}
    shut, here = UW.door_gate(sess, "clientUserCreate", p)
    if shut is not None:
        return shut
    user = sess.user or {}
    if not _admin(sess, service_too=False):
        return Decision(dict(UW.DENIED))
    kind = s_(p.get("kind")).lower()
    if kind not in ("client", "guardian"):
        return W.refuse(400, "kind must be client or guardian.")
    cid = s_(p.get("client_id"))
    rows = _clients(sess.reads)
    if rows is None:
        return W.refuse(503, "The clients could not be read — no account was made.")
    rec = next((r for r in rows if s_(r.get("id")) == cid), None)
    if rec is None:
        return W.refuse(404, f'No client "{cid}".', fresh=True)
    pw = UW.default_password(sess.reads)
    made = Made(sess.reads, here)
    answer = client_account(made, user, rec, kind, pw)
    if answer.get("status") != 200:
        return Decision(answer, fresh=answer.get("status") in (404, 409, 422))
    return _finish(made, answer, pw)


def _from_clients(sess: L.Session, payload: dict, action: str, guardians: bool) -> Decision:
    """usersFromClients / usersFromGuardians: every client (or guardian) through clientUserCreate."""
    p = payload if isinstance(payload, dict) else {}
    shut, here = UW.door_gate(sess, action, p)
    if shut is not None:
        return shut
    user = sess.user or {}
    if not _admin(sess, service_too=False):
        return Decision(dict(UW.DENIED))
    reads = sess.reads
    rows = _clients(reads)
    if rows is None:
        return Decision(dict(CLIENTS_UNREAD))
    roster: dict[str, str] = {}
    if guardians:
        try:
            for person in SP.without_isp_clients(reads, SP.people_merged(reads, SP._people(reads))) or ():
                key = gsjs.trim(gsjs.or_text(person.get("name"))).lower()
                if key:
                    roster[key] = gsjs.or_text(person.get("status"))
        except Exception:  # noqa: BLE001 - its catch: no roster, no guardian skipped for it
            roster = {}
    pw = UW.default_password(reads)
    made = Made(reads, here)
    created, already, skipped = [], 0, []
    for r in rows:
        if guardians:
            label = s_(r.get("guardianName")) or s_(r.get("guardian_name"))
            if not label or label.lower() == "self":
                continue
            known = roster.get(gsjs.trim(label).lower())
            if known is not None and not status_wanted(known):
                skipped.append(f"{label} (roster says {known})")
                continue
        else:
            label = s_(r.get("name"))
        try:
            out = client_account(made, user, r, "guardian" if guardians else "client", pw)
        except Defer:
            out = {"status": 503, "message": "the copy withholds a cell this account rests on"}
        if out.get("status") == 200 and (out.get("data") or {}).get("already"):
            already += 1
        elif out.get("status") == 200:
            created.append(f"{label} → {s_((out.get('data') or {}).get('login'))}")
        else:
            skipped.append(f"{label} ({s_(out.get('message'))[:90]})")
    UW.log_line(user, "users_from_guardians" if guardians else "users_from_clients",
                f"{len(created)} created, {already} already, {len(skipped)} skipped")
    return _finish(made, {"status": 200, "data": {"created": len(created), "already": already,
                                                  "skipped": len(skipped), "created_named": created[:60],
                                                  "skipped_named": skipped[:60]}}, pw)


def users_from_clients(sess: L.Session, payload: dict) -> Decision:
    """usersFromClients: every client becomes a user; idempotent, every skip reported by name."""
    return _from_clients(sess, payload, "usersFromClients", False)


def users_from_guardians(sess: L.Session, payload: dict) -> Decision:
    """usersFromGuardians: every Active guardian becomes a user; one the roster marks otherwise is skipped by name."""
    return _from_clients(sess, payload, "usersFromGuardians", True)


# ---- usersFromPeople, usersFromSigned -------------------------------------------------------------------------------

def fill_blanks(acc: UW.Accounts, pending: dict[int, dict[str, str]], at: int, person: dict) -> tuple[int, int]:
    """bulkFillBlanks_: blank cells only (phone, title), a different number added to phones, a new address to
    emails; the sign-in column is never touched. Reads the row as this pass has left it."""
    def now(name: str) -> str:
        cur = pending.get(at, {})
        return cur[name] if name in cur else acc.cell(at, name)

    cells = pending.setdefault(at, {})
    filled = added = 0
    want: dict[str, str] = {}
    if "phone" in acc.raw and s_(person.get("phone")):
        want["phone"] = s_(person.get("phone"))
    if "title" in acc.raw and s_(person.get("role")):
        want["title"] = s_(person.get("role"))
    for k, v in want.items():
        if now(k):
            continue
        cells[k] = v
        filled += 1
    if "phones" in acc.raw and s_(person.get("phone")):
        incoming = CS.bulk_phone_key(person.get("phone"))
        if incoming and CS.bulk_phone_key(now("phone") if "phone" in acc.raw else "") != incoming:
            try:
                got = json_list(now("phones"))
            except ValueError:
                got = []
            if not any(CS.bulk_phone_key((x or {}).get("number") if isinstance(x, dict) else None) == incoming
                       for x in got) and len(got) < 8:
                got.append({"label": "Roster", "number": s_(person.get("phone"))[:40]})
                cells["phones"] = W.json_text(got)
                added += 1
    if "emails" in acc.raw:
        mail = s_(person.get("email"))
        if mail and "@" in mail and mail.lower() != now("email").lower():
            try:
                mails = json_list(now("emails"))
            except ValueError:
                mails = []
            if not any(s_(m).lower() == mail.lower() for m in mails) and len(mails) < 8:
                mails.append(mail[:120])
                cells["emails"] = W.json_text(mails)
                added += 1
    return filled, added


def json_list(raw: str) -> list:
    """JSON.parse(str_(cell) || '[]'), not an array read as none; ValueError when it does not parse."""
    got = json.loads(raw or "[]")
    return got if isinstance(got, list) else []


def users_from_people(sess: L.Session, payload: dict) -> Decision:
    """usersFromPeople: the General roster's people become users, armed with the workspace default; one already
    known has its blank cells filled; a near name is reported, never made."""
    p = payload if isinstance(payload, dict) else {}
    shut, here = UW.door_gate(sess, "usersFromPeople", p)
    if shut is not None:
        return shut
    user = sess.user or {}
    if not _admin(sess, service_too=False):
        return Decision(dict(UW.DENIED))
    reads = sess.reads
    pw = UW.default_password(reads)
    if not pw:
        return _no_default("bulk accounts are armed with that default.")
    try:
        people = SP.without_isp_clients(reads, SP.people_merged(reads, SP._people(reads))) or []
    except Exception:  # noqa: BLE001 - its catch: the roster could not be read
        return Decision(dict(ROSTER_UNREAD))
    if not UW.credentials_ready():
        return Decision(dict(UW.UNSURE))
    made = Made(reads, here)
    acc = made.acc
    existing = reads.users()
    taken = {s_(u.get("email")).lower() for u in existing if s_(u.get("email"))}
    idx = identity_index(existing)
    row_at: dict[str, int] = {}
    for i in range(len(acc.rows)):
        k = CS.bulk_name_key(acc.cell(i, "displayname"))
        if k and k not in row_at:
            row_at[k] = i
    pending: dict[int, dict[str, str]] = {}
    created, already, skipped, near = [], 0, [], []
    filled = added = 0
    for person in people:
        name = gsjs.trim(gsjs.or_text(person.get("name")))
        if not name or not status_wanted(person.get("status")):
            continue
        login = login_of(person.get("email"), person.get("phone"))
        have = already_has(idx, name, login, person.get("phone"))
        if have and have["how"] == "near":
            near.append(f"{name} ~ {have['who']} ({js_round(have['ratio'] * 100)}%)")
            continue
        if have:
            already += 1
            at = row_at.get(CS.bulk_name_key(have["who"]))
            if at is not None and not acc.hidden(at, user) and acc.key(at) is not None:
                f, a = fill_blanks(acc, pending, at, person)
                filled, added = filled + f, added + a
            continue
        if not login:
            skipped.append(f"{name} (no e-mail and no phone on the roster)")
            continue
        if login in taken:
            skipped.append(f'{name} (login "{login}" belongs to another account)')
            continue
        made.add(login, name, "staff", {"title": gsjs.trim(gsjs.or_text(person.get("role"))),
                                        "phone": gsjs.trim(gsjs.or_text(person.get("phone"))),
                                        "mustchange": "true", "types": "STAFF"})
        taken.add(login)
        index_add(idx, name, login, person.get("phone"))
        created.append(f"{name} → {login}")
    made.edits += UW.carried(sess, acc, sorted((at, c) for at, c in pending.items() if c), "usersFromPeople")
    UW.log_line(user, "users_from_people",
                f"{len(created)} created, {already} already ({filled} blank cell(s) filled, {added} extra contact(s) "
                f"kept), {len(near)} look like existing people, {len(skipped)} skipped")
    return _finish(made, {"status": 200, "data": {"created": len(created), "already": already, "near": len(near),
                                                  "filled": filled, "added": added, "skipped": len(skipped),
                                                  "created_named": created[:80], "near_named": near[:80],
                                                  "skipped_named": skipped[:80]}}, pw)


def users_from_signed(sess: L.Session, payload: dict) -> Decision:
    """usersFromSigned: signed applicants become users; a hit on any known name, login, e-mail or phone reads as
    already."""
    p = payload if isinstance(payload, dict) else {}
    shut, here = UW.door_gate(sess, "usersFromSigned", p)
    if shut is not None:
        return shut
    user = sess.user or {}
    if not _admin(sess, service_too=False):
        return Decision(dict(UW.DENIED))
    reads = sess.reads
    pw = UW.default_password(reads)
    if not pw:
        return _no_default("bulk accounts are armed with that default.")
    try:
        ref = reads.db.tab(reads.db.prop("HUB_DB_ID"), CONTRACTS_TAB)
        rows = [r for r in reads.db.normalized_rows(ref) if s_(r.get("status")).lower() == "signed"]
    except Exception:  # noqa: BLE001 - its catch: the contracts mirror could not be read
        return Decision(dict(CONTRACTS_UNREAD))
    if not UW.credentials_ready():
        return Decision(dict(UW.UNSURE))
    made = Made(reads, here)
    taken: set[str] = set()
    names: set[str] = set()
    email_keys: set[str] = set()
    phone_keys: set[str] = set()
    for u in reads.users():
        if s_(u.get("email")):
            taken.add(s_(u.get("email")).lower())
            email_keys.update(STC._email_keys(u.get("email")))
        if s_(u.get("displayname")):
            names.add(gsjs.trim(s_(u.get("displayname"))).lower())
        upk = W.phone_key(u.get("phone"))
        if upk and upk not in SHARED_LINE_DIGITS:
            phone_keys.add(upk)
    created, already, skipped = [], 0, []
    for r in rows:
        name = s_(r.get("candidate"))
        label = name or s_(r.get("email")) or ("envelope " + s_(r.get("signaturerequestid")))
        if name and name.lower() in names:
            already += 1
            continue
        hit = any(k in email_keys for e in [s_(r.get("email"))] + s_(r.get("signeremails")).split("|")
                  for k in STC._email_keys(e))
        pk = W.phone_key(r.get("phone"))
        if pk and pk not in SHARED_LINE_DIGITS and pk in phone_keys:
            hit = True
        login = login_of(r.get("email"), r.get("phone"))
        if login and login in taken:
            hit = True
        if hit:
            already += 1
            continue
        if not name:
            skipped.append(f"{label} (no signer name on the contract)")
            continue
        if not login:
            skipped.append(f"{label} (no e-mail and no phone on the signed contract)")
            continue
        made.add(login, name, "staff", {"title": s_(r.get("title")), "phone": s_(r.get("phone")),
                                        "mustchange": "true", "types": "STAFF"})
        taken.add(login)
        names.add(name.lower())
        email_keys.update(STC._email_keys(r.get("email")))
        if pk and pk not in SHARED_LINE_DIGITS:
            phone_keys.add(pk)
        created.append(f"{name} → {login}")
    UW.log_line(user, "users_from_signed", f"{len(created)} created, {already} already, {len(skipped)} skipped")
    return _finish(made, {"status": 200, "data": {"created": len(created), "already": already,
                                                  "skipped": len(skipped), "created_named": created[:80],
                                                  "skipped_named": skipped[:80]}}, pw)


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {
    "userCreate": user_create, "userActivate": user_activate, "usersArm": users_arm,
    "clientUserCreate": client_user_create, "usersFromClients": users_from_clients,
    "usersFromGuardians": users_from_guardians, "usersFromPeople": users_from_people,
    "usersFromSigned": users_from_signed}
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
# usersArm waits for the script lock; the two roster passes try it and say the pass is running
BUSY_OF: dict[str, dict[str, Any]] = {"usersArm": {"status": 503, "message": UW.BUSY},
                                      "usersFromPeople": dict(PASS_RUNNING), "usersFromSigned": dict(PASS_RUNNING)}
