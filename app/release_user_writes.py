"""releaseUser (apps-script/ReleaseUsers.gs, CommRelease.gs) kept off asa-hub-db: the master hands an account back to
its owner — the letter first, only through Smart Comms as the authentication letter `invitation` (HUB_AUTH_LETTERS),
naming a fresh temporary password; the account rearmed only when a leg that left names it, or on the deliberate second
answer (`anyway`). The temporary password kept by the sign-in's credential store (users_writes.CREDENTIALS); the
users row's must-change, last-login, release and active cells kept and carried as users_writes keeps them; every
session the account holds, and every one minted from them, ended in the same transaction (auth_store), its rows on the
Sessions tab deleted by `delete` book ops; the welcome marks cleared and the release stamped on the preference row
(app.edits under cols:user_id, where the Prefs reads find it). The master's own account stays Apps Script's while the
master signs in there."""
from __future__ import annotations

import re
import time
from typing import Any, Callable

import auth as A
import auth_invites_writes as AIW
import auth_store as AS
import auth_twin as AT
import book_ops as BO
import gsjs
import house_tables as HT
import locations as L
import mail_designs as MD
import prefs_doors as PD
import release_users as RU
import resource_rows as RR
import scope as sc
import smart_clock as SK
import smart_comms as SC
import smart_comms_desk as SCD
import staff as SP
import users_writes as UW
import writes as W
from writes import Decision

s_ = gsjs.str_
# ReleaseUsers.gs RELEASE_REQUIRED_COLUMNS; CommRelease.gs COMM_RELEASE_INVITE_SITUATION / _AUTH_KIND
REQUIRED = ("salt", "passhash", "mustchange", "lastlogin")
SITUATION = RU.INVITE_SITUATION
AUTH_KIND = "invitation"
LANE = "release"
SESSIONS_TAB = "hub_sessions"
# MailTemplates.gs mailPlatformUrl_
PLATFORM_URL = "https://asamylife.asalifecare.com"
FOOTNOTE = ("This temporary password was made for you alone, and the platform asks you to choose your own the first "
            "time you sign in with it.")
# commReleaseHeldReason_'s word for each brake raise_situation names
BRAKE = {"quiet": "quiet_hours", "test_mode": "rehearsal", "recorded": "recorded_to"}


def denied(user: dict | None) -> bool:
    """releaseMasterOnly_: admin is not enough — the real master's own session alone."""
    return not sc.is_real_master(user)


def phone_at(acc: UW.Accounts, at: int) -> str:
    """releasePhoneAt_: the phone cell, else the first number the labelled phones hold."""
    raw = acc.cell(at, "phone")
    if not raw and "phones" in acc.raw:
        for p in SP._parse_phones(acc.cell(at, "phones")):
            raw = s_(p.get("number")) if isinstance(p, dict) else ""
            if raw:
                break
    return gsjs.trim(s_(raw))


# ---- the letter (CommRelease.gs) ----------------------------------------------------------------------------------

def situation_read(reads: L.Reads, sid: str) -> dict[str, Any]:
    """commReleaseSituationRead_: the row, and which absence it is."""
    try:
        rows = SC.read_situations(reads.db)
    except Exception as exc:  # noqa: BLE001 - an unread book is never a yes
        return {"sit": None, "state": "unreadable", "error": str(exc) or type(exc).__name__}
    sit = SC.situation_row(rows, sid)
    if sit is None:
        return {"sit": None, "state": "absent", "error": ""}
    if not SC.smart_on(sit.get("enabled")):
        return {"sit": None, "state": "off", "error": ""}
    if not RU._channels(sit):
        return {"sit": None, "state": "wordless", "error": ""}
    return {"sit": sit, "state": "on", "error": ""}


def situation_why(sid: str, read: dict[str, Any]) -> str:
    """commReleaseSituationWhy_."""
    state = read.get("state")
    if state == "unreadable":
        return (f"the Smart Comms situations could not be read ({read.get('error') or 'no answer'}) — nobody was "
                "written to")
    if state == "absent":
        return f"the situation `{sid}` does not exist in Smart Comms — nobody was written to"
    if state == "off":
        return f"the situation `{sid}` is switched off in Smart Comms — nobody was written to"
    return f"the situation `{sid}` has no written words on a channel it names — nobody was written to"


def auth_gate(reads: L.Reads) -> dict[str, str] | None:
    """commReleaseInviteAuthGate_: one switch stops every invitation."""
    gate = AIW.gate(reads)
    if gate["on"]:
        return None
    sid = AIW.SITUATION
    if gate["unreadable"]:
        return {"state": "unreadable", "why": f"the invitation situation ({sid}) could not be read — nobody was "
                                               "written to"}
    return {"state": "invitation_off",
            "why": f"the invitation situation ({sid}) is switched off in Smart Comms, and it stops every invitation, "
                   "the release invite too — nobody was written to"}


def _names(secret: str, *words: str) -> bool:
    if not secret:
        return False
    esc = MD.mail_esc(secret)
    return any(secret in w or (esc and esc in w) for w in words)


def _held_reason(got: dict[str, Any]) -> str:
    held = s_(got.get("held"))
    if s_(got.get("state")) == "refused":
        return "opt_out_unreadable" if RU.OPT_OUT_UNREAD.search(s_(got.get("why"))) else "opted_out"
    return BRAKE.get(held, "send_switch_off" if held == SC.SWITCH_OFF else held or "held")


def tell(sit: dict, chans: list[str], vars_: dict[str, str], email: str, phone: str, idem: str, html: str,
         secret: str, ledger: str, person: str) -> dict[str, Any]:
    """commReleaseTell_: each leg raised in Smart Comms; `named_*` count only the legs whose words carry the secret."""
    out: dict[str, Any] = {"sent": 0, "held": 0, "deduplicated": 0, "legs": [], "why": [], "held_reason": "",
                           "held_dial": 0, "held_quiet": 0, "declined": 0, "unchecked": 0, "named_sent": 0,
                           "named_deduplicated": 0}

    def land(channel: str, got: dict[str, Any], named: bool) -> None:
        state = s_(got.get("state"))
        if state == "sent":
            out["sent"] += 1
            out["legs"].append(channel)
            if named:
                out["named_sent"] += 1
            elif secret:
                out["why"].append(channel + ": it left, but its words do not name the password")
            return
        if state == "already":
            out["deduplicated"] += 1
            out["legs"].append(channel + " (already sent)")
            if named:
                out["named_deduplicated"] += 1
            out["why"].append(channel + ": this exact letter already went out — not sent again")
            return
        if state in ("held", "refused"):
            out["held"] += 1
            out["legs"].append(channel + " (held)")
            reason = _held_reason(got)
            if not out["held_reason"]:
                out["held_reason"] = reason
            kind = {"opted_out": "declined", "opt_out_unreadable": "unchecked",
                    "quiet_hours": "held_quiet"}.get(reason, "held_dial")
            out[kind] += 1
            out["why"].append(channel + ": " + (s_(got.get("why")) or "held by a brake"))
            return
        out["why"].append(channel + ": " + (s_(got.get("why")) or "the send door refused"))

    if email and "@" in email and "email" in chans:
        subject = SC.render(s_(sit.get("email_subject")), vars_)
        body = SC.render(gsjs.or_blank(sit.get("email_text") or sit.get("sms_text")), vars_)
        got = SC.raise_situation(None, situation=SITUATION, to=email, vars={}, key=idem + "_email", lane=LANE,
                                 ledger_key=ledger, ledger_person=person, channel="email", subject=subject,
                                 body=body, html=html, transport=True, auth_letter=AUTH_KIND, withhold=[secret],
                                 quiet_exempt=True)
        land("email", got, _names(secret, body, html))
    elif "email" not in chans:
        out["why"].append("email: this row has no written letter")
    else:
        out["why"].append("email: the account signs in with a number, so there is no mailbox")
    if "sms" not in chans:
        out["why"].append("sms: this row has no written text")
    elif not phone:
        out["why"].append("sms: no number on the account")
    elif secret and SCD.shared_line(phone):
        out["why"].append("sms: that number is a shared line — a temporary password is not texted there")
    else:
        num = SC.team_copy(phone)
        if not num:
            out["why"].append("sms: " + phone[:20] + " is not a number we may text")
        else:
            text = SC.render(s_(sit.get("sms_text")), vars_)
            got = SC.raise_situation(None, situation=SITUATION, to=num, vars={}, key=idem + "_sms", lane=LANE,
                                     ledger_key=ledger, ledger_person=person, channel="sms", body=text,
                                     transport=True, withhold=[secret], quiet_exempt=True)
            land("sms", got, _names(secret, text))
    return out


def invite_tell(reads: L.Reads, person: dict[str, str], idem: str) -> dict[str, Any]:
    """commReleaseInviteTell_ / commReleaseInviteBuild_: the release invite, built in the row's words."""
    out: dict[str, Any] = {"sent": 0, "held": 0, "deduplicated": 0, "legs": [], "why": [], "state": "quiet",
                           "held_reason": "", "situation_state": ""}
    read = situation_read(reads, SITUATION)
    sit = read["sit"]
    out["situation_state"] = read["state"]
    if sit is None:
        out["state"] = "wordless"
        out["why"].append(situation_why(SITUATION, read))
        return out
    stop = auth_gate(reads)
    if stop:
        out["state"], out["situation_state"] = "wordless", stop["state"]
        out["why"].append(stop["why"])
        return out
    chans = RU._channels(sit)
    full = gsjs.trim(person.get("name", ""))
    url = person.get("url", "")
    vars_ = {"first_name": (re.split(r"\s+", full)[0] if full else ""), "name": full,
             "login": person.get("login", ""), "password": person.get("password", ""), "url": url,
             "sender": SC.SENDER_DEFAULT}
    blocks = [MD.mail_para(MD.mail_esc(x).replace("\n", "<br>"))
              for x in (gsjs.trim(p) for p in re.split(r"\n{2,}", SC.render(
                  gsjs.or_blank(sit.get("email_text") or sit.get("sms_text")), vars_))) if x]
    if vars_["login"]:
        blocks.insert(1, MD.mail_fact("Your sign-in", vars_["login"], True))
    if vars_["password"]:
        blocks.insert(2, MD.mail_fact("Temporary password", vars_["password"], True))
    html = MD.mail_shell({"eyebrow": "ASA Hub", "title": SC.render(s_(sit.get("email_subject")), vars_),
                          "preheader": "Your account is ready to use.", "blocks": blocks,
                          "cta": {"label": "Open the platform", "href": url} if url else None, "footnote": FOOTNOTE})
    ledger = SK.ledger_key(SITUATION, person.get("login") or full, W.now_iso(reads)[:10])
    told = tell(sit, chans, vars_, person.get("email", ""), person.get("phone", ""), idem, html,
                vars_["password"], ledger, full)
    out.update({k: told[k] for k in ("sent", "held", "legs", "why", "deduplicated", "named_sent",
                                     "named_deduplicated", "held_reason")})
    out["state"] = "told" if out["sent"] else ("held" if out["held"] else ("already" if out["deduplicated"]
                                                                         else "quiet"))
    return out


def brake_of(told: dict[str, Any]) -> str:
    """releaseBrakeOf_: which brake stopped the letter, in one word the screen has a sentence for."""
    if told.get("state") == "not_asked":
        return "test_mode_unreadable"
    if (told.get("sent", 0) > 0 or told.get("deduplicated", 0) > 0) and \
            not (told.get("named_sent", 0) > 0 or told.get("named_deduplicated", 0) > 0):
        return "password_not_named"
    if told.get("state") == "wordless":
        return "situation_" + (s_(told.get("situation_state")) or "off")
    if told.get("held"):
        return s_(told.get("held_reason")) or "held"
    if told.get("state") == "no_door":
        return "no_door"
    return "not_delivered"


# ---- what a release leaves after the rearm --------------------------------------------------------------------------

def sessions_store_end(uid: str) -> set[str]:
    """releaseEndSessions_ in the sign-in's store: every session of the account and every one minted from them ended,
    the ops of their rows not yet landed taken back (the relay's _end_account, in this write)."""
    cur = W.HELD.get()
    ended = AS.account_sessions_end(cur, uid)
    for _th, twin in ended:
        AT.cancel(cur, twin)
    return {th for th, _twin in ended}


def sessions_rows_end(reads: L.Reads, uid: str, action: str, who: str) -> set[str]:
    """releaseEndSessions_ on the Sessions tab: each row of the account deleted (a `delete` book op by its token hash,
    only while it still names this account)."""
    res = W.tab_of(reads, SESSIONS_TAB)
    if res.ref is None:
        return set()
    heads = PD.heads_of(res.ref.headers)
    iu, it = heads.get("userid"), heads.get("tokenhash")
    if not iu or not it:
        raise ValueError("the sessions tab has no token_hash / user_id column")
    sid, tab = W.where_of(res)
    hashes: set[str] = set()
    ops = []
    for _rn, raw in reads.db.rows(res.ref):
        th = PD.cell(raw, it)
        if PD.cell(raw, iu) != uid or not th or th in hashes:
            continue
        hashes.add(th)
        ops.append({"op": "delete", "sheet_id": sid, "tab": tab,
                    "spec": {"match": gsjs.trim(gsjs.js_str(it)), "key": th, "which": "only",
                             "expect": {gsjs.trim(gsjs.js_str(iu)): uid}}})
    BO.queue(ops, UW.SUBJECT, who, action)
    return hashes


def clear_marks(prefs: dict[str, Any], uid: str) -> list[str]:
    """releaseClearMarks_: this person's id taken out of each first-login mark; a mark is rewritten, never deleted."""
    touched = []
    for k in RU.FIRST_LOGIN_MARKS:
        lst = RU.mark_list(prefs.get(k))
        if k not in prefs and not lst:
            continue
        kept = [x for x in lst if x != uid]
        if len(kept) == len(lst) and k in prefs and gsjs.str_(prefs.get(k)) == PD.js_stringify(kept):
            continue
        prefs[k] = PD.js_stringify(kept)
        touched.append(k)
    return touched


def marks_and_stamp(reads: L.Reads, uid: str, stamp: str, who: str, action: str) -> tuple[list[str], list[dict]]:
    """releaseClearMarksFor_: the marks taken off this person and the release stamped into their preference row, kept
    in app.edits by their id (cols:user_id); a row no key tells apart from another of theirs is written on the last
    by a `cells` op, as prefsSet writes it. Raises with the sentence the warning carries."""
    got = PD.held_rows(reads, uid)
    sid, ref, tab, rows, heads, mine = got["sid"], got["ref"], got["tab"], got["rows"], got["heads"], got["mine"]
    if ref is None:
        raise ValueError("the copy holds no preferences tab")
    iu, ip, it = heads.get("userid"), heads.get("prefs"), heads.get("updatedat")
    stored = PD.cell(rows[mine[-1]][1], ip) if mine else ""
    if stored.startswith(PD.WITHHELD):
        raise ValueError("the copy withholds their preference row")
    prefs: Any = {}
    if mine:
        try:
            prefs = PD.parse(stored or "{}")
        except (ValueError, RecursionError):
            prefs = None
        if not isinstance(prefs, dict):
            raise ValueError("their preference row does not parse, so it was left exactly as it is")
    touched = clear_marks(prefs, uid)
    prefs[PD.RELEASED_KEY] = stamp
    raw_text = PD.js_stringify(prefs)
    if mine and not ip:
        raise ValueError('the preferences tab has no "prefs" column')
    field = {h: gsjs.trim(gsjs.js_str(h)) for h in (iu, ip, it) if h}
    if isinstance(ref, HT.KeptRef):
        # its own table: the stamp on the person's last row, else their row made, in a savepoint of its own
        resource = HT.resource_of(PD.PREFS_TAB) or ""
        if not (ip and (mine or iu)):
            raise ValueError("the preferences tab has no user_id or prefs column")
        cells = {field[ip]: raw_text, **({field[it]: stamp} if it else {})}
        if mine:
            key, held = RR.table_rows(reads, resource)[mine[-1]]
            UW._guarded(lambda: RR.update(reads, resource, key, held, cells, who))
        else:
            UW._guarded(lambda: RR.create(reads, resource, {field[iu]: uid, **cells}, who))
        return touched, []
    if not mine:
        cells = {field[iu]: uid, field[ip]: raw_text} if iu and ip else {}
        if it:
            cells[field[it]] = stamp
        if not cells:
            raise ValueError("the preferences tab has no user_id or prefs column")
        return touched, [W.kept_record(sid, tab, "append", W.COLS + field[iu], gsjs.trim(uid), UW.SUBJECT, cells)]
    at = mine[-1]
    cells = {field[ip]: raw_text}
    before = {field[ip]: stored}
    if it:
        cells[field[it]] = stamp
        before[field[it]] = PD.cell(rows[at][1], it)
    key = W.row_key_of(rows, at, [[iu]])
    if key is None:
        BO.queue([{"op": PD.CELLS_OP, "sheet_id": sid, "tab": tab,
                   "spec": {"match": field[iu], "key": uid, "cells": cells, "before": before}}],
                 PD.cells_subject(uid), who, action)
        return touched, []
    return touched, [W.kept_record(sid, tab, "edit", key[0], key[1], UW.SUBJECT, cells, before)]


# ---- releaseUser ----------------------------------------------------------------------------------------------------

def release_user(sess: L.Session, payload: dict) -> Decision:
    """releaseUser: the letter first, the credential after; refused (409) with nothing changed unless a leg that left
    names the new password, or the press says `anyway`."""
    p = payload if isinstance(payload, dict) else {}
    shut, _here = UW.door_gate(sess, "releaseUser", p)
    if shut is not None:
        return shut
    user = sess.user or {}
    if denied(sess.user):
        return Decision(dict(UW.DENIED))
    reads = sess.reads
    uid = s_(p.get("user_id"))
    acc = UW.Accounts(reads)
    at = acc.first(uid)
    if at is None:
        return W.refuse(404, 'No user "' + uid + '".', fresh=(acc.sid,))
    if UW.master_sign_in_elsewhere(acc.cell(at, "email")):
        # the master's own sign-in reads the sheet's salt and hash, which only Apps Script writes
        return Decision(None, engine=True)
    absent = [c for c in REQUIRED if c not in acc.raw]
    if absent:
        return W.refuse(500, f'The users tab has no "{absent[0]}" column, so a release cannot rearm this account. '
                             "Nothing was changed.")
    email = acc.cell(at, "email")
    who = acc.cell(at, "displayname") or email
    if "@" not in email:
        return W.refuse(400, f'"{who}" signs in with a number, not an address — there is no mailbox to send the '
                             "invite to.")
    if acc.key(at) is None:
        return W.refuse(409, W.NOT_TOLD_APART, fresh=(acc.sid,))
    if not UW.credentials_ready():
        # the letter would name a password nothing could keep
        return Decision(dict(UW.UNSURE))
    anyway = p.get("anyway") is True
    press_id = re.sub(r"[^A-Za-z0-9_-]", "", s_(p.get("press_id")))[:64] or str(int(time.time() * 1000))
    mode = RU.test_mode(reads)
    author = W.who(user)

    def refuse(brake: str, why: list[str], told: dict[str, Any] | None) -> Decision:
        t = told or {"held": 0, "held_reason": "", "legs": []}
        lead = (f'The password did not reach "{who}"' if brake == "password_not_named"
                else f'This press already went to "{who}"' if brake == "already_sent"
                else f'Nothing reached "{who}"')
        UW.log_line(user, "release_user_refused", f"{uid} — nothing changed; {lead}: " + " · ".join(why[:2]))
        return Decision({"status": 409, "message": lead + ": " + " · ".join(why[:2]) + (
            ". Nothing was changed by this repeat." if brake == "already_sent"
            else ". Nothing was changed — their own password still works."),
            "data": {"user_id": uid, "email": email, "display_name": who, "cleared": [], "emailed": False,
                     "held": t["held"] > 0, "held_reason": s_(t["held_reason"]), "outcome": "refused",
                     "test_mode": mode["word"], "blocked_by": brake, "legs": t.get("legs") or [], "why": why}})

    if not mode["readable"] and not anyway:
        return refuse("test_mode_unreadable",
                      [f"the test-mode switch could not be read ({mode['error']}), so nothing may be sent"], None)
    temp_pw = A.temp_password()
    if mode["readable"]:
        try:
            told = invite_tell(reads, {"email": email, "phone": phone_at(acc, at), "name": who, "login": email,
                                       "password": temp_pw, "url": PLATFORM_URL}, f"release_{uid}_{press_id}")
        except Exception as exc:  # noqa: BLE001 - commReleaseInviteTell_ never throws: nothing left
            told = {"sent": 0, "held": 0, "deduplicated": 0, "legs": [], "held_reason": "", "situation_state": "",
                    "why": [f"the invite could not be built: {exc}"], "state": "no_door"}
    else:
        told = {"sent": 0, "held": 0, "deduplicated": 0, "legs": [], "held_reason": "", "situation_state": "",
                "why": ["nothing was asked of the send door: the test-mode switch could not be read ("
                        + s_(mode["error"]) + ")"],
                "state": "not_asked"}
    reached = told.get("named_sent", 0) > 0
    if not reached and not anyway:
        if told.get("named_deduplicated", 0) > 0:
            return refuse("already_sent", ["its letter left before, naming the password that press made — every "
                                           "press makes a new one, so press again to send a fresh letter"], told)
        return refuse(brake_of(told), told["why"] or ["the send door answered nothing"], told)

    now = W.now_iso(reads)
    inactive = acc.cell(at, "active").lower() != "true"
    cells = {"mustchange": "true", "lastlogin": "", "releasedat": now}
    if inactive:
        cells["active"] = "true"
    if acc.lacks(cells):
        return Decision(dict(UW.UNSURE))
    edits = UW.carried(sess, acc, [(at, cells)], "releaseUser")
    UW.credential_put(uid, temp_pw, True)
    cleared = ["account reactivated — a blocked sign-in works again"] if inactive else []
    cleared.append("password reset to a new random temporary password, named only in the letter; password-change "
                   "gate armed" if reached else
                   "password reset to a new random password nobody was told — they get in with Forgot password on "
                   "the sign-in page; password-change gate armed")
    cleared.append("last-login record cleared")
    warnings: list[str] = []
    ended: int | None = None
    held: dict[str, set[str]] = {}
    # after the rearm nothing may throw: each part in a savepoint of its own, a part that fails said
    UW._guarded(lambda: held.__setitem__("store", sessions_store_end(uid)))
    UW._guarded(lambda: held.__setitem__("rows", sessions_rows_end(reads, uid, "releaseUser", author)))
    if "store" in held and "rows" in held:
        ended = len(held["store"] | held["rows"])
        cleared.append(f"{ended} open session(s) ended at the backend — their next action asks them to sign in; a "
                       "copy the relay cached may keep serving read-only views until it expires" if ended else
                       "no open session to end — the next sign-in is the first one")
    else:
        done = len(held.get("store", set()) | held.get("rows", set()))
        warnings.append("the open sessions could not be " + (f"all ended ({done} were)" if done else "read")
                        + " — any session they hold may still be live")
    try:
        touched, more = marks_and_stamp(reads, uid, now, author, "releaseUser")
        edits += more
        if touched:
            cleared.append(f"welcome marks cleared ({', '.join(touched)}) — the sequences run again")
    except Exception as exc:  # noqa: BLE001 - the release stands; the tour may not run again
        warnings.append(f"the welcome marks could not be cleared — the tour may not run again: {exc}")
    outcome = ("sent" if told["sent"] else "already_sent" if told.get("deduplicated") else
               "held" if told["held"] else "nothing_sent")
    UW.log_line(user, "release_user",
                f"{uid} — rearmed, {told['sent']} sent · {told['held']} held ({who})"
                + (" · rearmed anyway" if anyway and not reached else "")
                + (" · " + " · ".join(told["why"][:2]) if told["why"] else "")
                + (" · " + " · ".join(warnings) if warnings else ""))
    answer = {"status": 200,
              "message": "" if reached else (
                  f'The account was rearmed as you chose, and nothing reached "{who}": '
                  + (" · ".join(told["why"][:2]) or "the send door answered nothing")
                  + ". Nobody knows the new password — they get in with Forgot password on the sign-in page."),
              "data": {"user_id": uid, "email": email, "display_name": who, "cleared": cleared, "emailed": reached,
                       "held": told["held"] > 0, "held_reason": s_(told.get("held_reason")), "outcome": outcome,
                       "test_mode": mode["word"], "released_anyway": bool(anyway and not reached),
                       "sessions_ended": ended, "warnings": warnings, "legs": told["legs"], "why": told["why"]}}
    d = W.final(answer, edits, UW.SUBJECT)
    if not d.edits:
        d.own, d.subject = True, UW.SUBJECT
    return d


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {"releaseUser": release_user}
POLICY: dict[str, dict[str, Any]] = {"releaseUser": {}}
