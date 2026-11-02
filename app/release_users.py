"""Release Users' read on Python: releaseUserStatus (ReleaseUsers.gs), the card a release is pressed from — the
person's row in the users tab, their welcome marks in the preferences book, test mode, and whether the invite would
reach them (commReleaseInviteReach_, CommRelease.gs). The release itself, releaseUser, rearms the credential in the
users tab sign-in reads and ends the sessions sign-in keeps, so it stays where sign-in lives; after one lands the
relay reads this card from there until the copy holds it. The announcement is the app-release app's."""
from __future__ import annotations

import json
import re
from typing import Any, Callable

import gsjs
import house_tables as HT
import hubdb
import locations as L
import scope as sc
import smart_comms as SC
import smart_comms_desk as SCD
from scope import Defer

APP_ID = "release-users"
FIRST_LOGIN_MARKS = ("asa-tour-seen", "asa-playground-intro-seen", "asa-myworld-intro-seen")
PREFS_BOOK = "HUB_PREFS_ID"
PREFS_TAB = "user_prefs"
INVITE_SITUATION = "user_release_invite"
INVITE_AUTH_SITUATION = "auth_invitation"
OPT_OUT_UNREAD = re.compile(r"opt-out list could not be (read|checked)", re.I)
WITHHELD = "[withheld"
# the cells the card shows: a copy that withholds one leaves the card to Apps Script
SHOWN = ("email", "displayname", "role", "types", "active", "mustchange", "lastlogin", "releasedat")
WILL_CLEAR = [
    "password reset to a new random temporary password, named only in the letter",
    "the password-change gate armed for the next sign-in",
    "the last-login record, so sign-in is treated as the first one",
    "every session they have open — ended at the backend, so their next action asks them to sign in",
    "the welcome-tour mark — the tour runs again",
    "the playground-intro mark — the explainer runs again",
    "the my-world welcome mark — its sequence runs again"]

s_ = gsjs.str_


def master_only(user: dict | None) -> bool:
    """releaseMasterOnly_: admin is not enough — only the master's own session, never a visit, resets a password."""
    return not sc.is_real_master(user)


def find_user(reads: L.Reads, uid: str) -> dict | None:
    """releaseFindUser_: the first users row with this id."""
    for r in reads.users():
        if s_(r.get("userid")) == uid:
            return r
    return None


def prefs_for(reads: L.Reads, uid: str) -> dict[str, Any]:
    """releasePrefsFor_: the person's last preference row, parsed; unreadable when it does not parse."""
    db = reads.db
    if HT.tabled(PREFS_TAB):
        rows = HT.tab_rows(reads, HT.kept_ref(reads, PREFS_TAB))
    else:
        sid = db.prop(PREFS_BOOK)
        if not sid or db.book(sid) is None:
            raise hubdb.Unreadable("asa-hub-db holds no copy of the preferences book")
        db.note_book(sid)
        ref = db.tab(sid, PREFS_TAB)
        rows = list(db.rows(ref)) if ref is not None else []
    for _rn, raw in reversed(rows):
        if s_(raw.get("user_id")) != uid:
            continue
        cell = s_(raw.get("prefs"))
        if cell.startswith(WITHHELD):
            raise Defer("the copy withholds this person's preference row")
        try:
            parsed = json.loads(cell or "{}")
        except ValueError:
            parsed = None
        if isinstance(parsed, dict):
            return {"prefs": parsed, "unreadable": False}
        return {"prefs": {}, "unreadable": True}
    return {"prefs": {}, "unreadable": False}


def mark_list(v: Any) -> list[str]:
    """releaseMarkList_: every mark is a list of user ids, never a yes."""
    if isinstance(v, list):
        return [s_(x) for x in v]
    raw = s_(v) if not isinstance(v, (dict, bool)) else ""
    if not raw:
        return []
    try:
        parsed = json.loads(raw)
    except ValueError:
        return []
    return [s_(x) for x in parsed] if isinstance(parsed, list) else []


def marks(prefs: dict, uid: str) -> dict[str, bool]:
    """releaseMarks_: true only when THIS person's id is in the list the browser pushed up."""
    who = s_(uid)
    return {k: (who in mark_list(prefs.get(k))) if who else False for k in FIRST_LOGIN_MARKS}


def test_mode(reads: L.Reads) -> dict[str, Any]:
    """releaseTestMode_: on, off, or unknown."""
    try:
        st = SCD.test_mode_state(reads.config())
    except hubdb.Unreadable:
        raise
    except Exception as exc:  # noqa: BLE001 - said, never a yes
        return {"word": "unknown", "readable": False, "error": str(exc) or type(exc).__name__}
    if st.get("unrecognized"):
        return {"word": "unknown", "readable": False,
                "error": 'test_mode reads "' + s_(st["unrecognized"])[:40] + '", a word the switch does not know '
                         "(on or off) — held as on until it is saved as one of them"}
    return {"word": "on" if st["on"] else "off", "readable": True, "error": ""}


def _channels(sit: dict) -> list[str]:
    """commReleaseChannels_."""
    named = SC.smart_list(sit.get("channels"))
    out = []
    if "sms" in named and s_(sit.get("sms_text")):
        out.append("sms")
    if "email" in named and (s_(sit.get("email_text")) or s_(sit.get("sms_text"))):
        out.append("email")
    return out


def invite_reach(reads: L.Reads, email: str) -> dict[str, Any]:
    """commReleaseInviteReach_: would the release invite reach this mailbox, and if not, which brake."""
    sid = INVITE_SITUATION
    try:
        rows = SC.read_situations(reads.db)
    except Exception as exc:  # noqa: BLE001 - an unread book is never a yes
        return {"goes": False, "blocked_by": "situation_unreadable",
                "why": [f"the Smart Comms situations could not be read ({str(exc) or 'no answer'}) — nobody was "
                        "written to"]}
    sit = SC.situation_row(rows, sid)
    if sit is None:
        return {"goes": False, "blocked_by": "situation_absent",
                "why": [f"the situation `{sid}` does not exist in Smart Comms — nobody was written to"]}
    if not SC.smart_on(sit.get("enabled")):
        return {"goes": False, "blocked_by": "situation_off",
                "why": [f"the situation `{sid}` is switched off in Smart Comms — nobody was written to"]}
    if not _channels(sit):
        return {"goes": False, "blocked_by": "situation_wordless",
                "why": [f"the situation `{sid}` has no written words on a channel it names — nobody was written to"]}
    # hubAuthLetterAllowed_('invitation'): a row absent is on, a row switched off stops every invitation
    auth = SC.situation_row(rows, INVITE_AUTH_SITUATION)
    if auth is not None and not SC.smart_on(auth.get("enabled")):
        return {"goes": False, "blocked_by": "situation_invitation_off",
                "why": [f"the invitation situation ({INVITE_AUTH_SITUATION}) is switched off in Smart Comms, and it "
                        "stops every invitation, the release invite too — nobody was written to"]}
    if "email" not in _channels(sit):
        return {"goes": False, "blocked_by": "situation_wordless",
                "why": [f"the situation `{sid}` writes no letter — only a text, which test mode and the sending "
                        "switch still hold"]}
    stopped = SC.opt_out_blocked(reads.db, email)
    if stopped:
        return {"goes": False, "blocked_by": "opt_out_unreadable" if OPT_OUT_UNREAD.search(stopped) else "opted_out",
                "why": ["email: " + stopped]}
    return {"goes": True, "blocked_by": "", "why": []}


def status(sess: L.Session, payload: dict) -> dict[str, Any]:
    """releaseUserStatus: the person's situation in the users tab, what a release would clear, and whether the
    letter would reach them — said on the card, before the press."""
    if master_only(sess.user):
        return {"status": 403, "message": "Requires an admin or manager account"}
    reads = sess.reads
    uid = s_((payload or {}).get("user_id"))
    row = find_user(reads, uid)
    if row is None:
        return {"status": 404, "message": 'No user "' + uid + '".'}
    if any(s_(row.get(k)).startswith(WITHHELD) for k in SHOWN):
        raise Defer("the copy withholds a cell this card shows")

    def at(name: str) -> str:
        return s_(row.get(name))

    types = sc.types_from_raw(at("types"))
    prefs = prefs_for(reads, uid)
    inactive = at("active").lower() != "true"
    must_change = at("mustchange").lower() == "true"
    email = at("email")
    mode = test_mode(reads)
    if not mode["readable"]:
        reach = {"goes": False, "blocked_by": "test_mode_unreadable",
                 "why": ["the test-mode switch could not be read (" + mode["error"] + ") — nothing may be sent "
                         "until it can, so a release is refused"]}
    elif "@" not in email:
        reach = {"goes": False, "blocked_by": "no_mailbox",
                 "why": ["the account signs in with a number, so there is no mailbox for the letter"]}
    else:
        reach = invite_reach(reads, email)
    will_clear = list(WILL_CLEAR)
    if inactive:
        will_clear.insert(0, "the account is reactivated — a blocked sign-in works again")
    armed = bool(at("passhash"))
    return {"status": 200, "data": {
        "user_id": uid,
        "email": email,
        "display_name": at("displayname"),
        "role": at("role"),
        "types": types,
        "director": "DIRECTOR" in sc.badges_worn(at("types"), ""),
        "active": not inactive,
        "armed": armed,
        "must_change": must_change,
        "last_login": at("lastlogin"),
        "released_at": at("releasedat"),
        "signed_in_before": bool(at("lastlogin")) or (armed and not must_change),
        "marks": None if prefs["unreadable"] else marks(prefs["prefs"], uid),
        "marks_error": "their preference row does not parse" if prefs["unreadable"] else "",
        "test_mode": mode["word"],
        "test_mode_error": mode["error"],
        "sending_holds": not reach["goes"],
        "blocked_by": reach["blocked_by"],
        "hold_why": reach["why"],
        "will_clear": will_clear}}


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {"releaseUserStatus": status}
POLICY: dict[str, dict[str, Any]] = {"releaseUserStatus": {"roles": ("admin",), "params": {"user_id": "string"}}}
