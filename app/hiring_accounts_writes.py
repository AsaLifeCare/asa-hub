"""The hiring lane's account writes (Hired.gs onboardingEnsureUser_, hubHiredGraduate_) kept as the Users app keeps
an account: the row in app.edits, a changed row's cells carried by a `cells` book op, the password by the sign-in's
credential store and never on the sheet; the card's facts and journey as the hiring rows' own. The login letter and
its text go through Smart Comms' one send door, the password withheld from every record."""
from __future__ import annotations

import logging
import time
from typing import Any, Callable

import auth as A
import candidates as CND
import comms_rpc as CR
import envelope as EV
import hiring_accounts as HA
import hiring_hired as HH
import hiring_hired_writes as HHW
import hiring_writes
import locations as L
import mail_designs as MD
import recon as R
import users_accounts as UA
import users_writes as UW
import writes as W
from scope import Defer
from writes import Decision

log = logging.getLogger("asa-hub-app")
s_ = HA.s_
MINTS_PER_PASS = 5
BY_MINT = "asa-hub:auto-onboard-user"
BY_GRADUATE = "auto-graduate"
STAFF_TITLE = "Direct Support Professional"
SMS_FLOOR = ("Your ASA LifeCare onboarding login: {email} — first-time password: {password} (you will choose your own "
             "at sign-in). Sign in at https://asamylife.asalifecare.com/")


def _done(answer: dict[str, Any], recs: list[dict], subject: str) -> Decision:
    kept = [e for e in recs if e and e.get("cells")]
    return Decision(answer, edits=kept, subject=subject) if kept else Decision(answer)


def welcome_letter(o: dict[str, str]) -> dict[str, str]:
    """onboardingWelcomeLoginEmail_ (MailTemplatesHiring.gs)."""
    name = o.get("name", "").strip()
    first = (name.split() or [name])[0]
    email, password, body = o.get("email", "").strip(), o.get("password", "").strip(), o.get("bodyText", "").strip()
    link = MD.mail_platform_url()
    blocks = MD.mail_body_blocks(body) if body else [MD.mail_para(
        ("Congratulations, " + MD.mail_esc(first) + "." if first else "Congratulations.") +
        " You are through the interview and starting your onboarding with <strong>ASA LifeCare</strong> — and you "
        "now have your own account on our platform.")]
    blocks.append(MD.mail_fact("Sign in with", email, True))
    if password:
        blocks.append(MD.mail_fact("First-time password", password, True))
        blocks.append(MD.mail_para(
            "<strong>This password is not yours and is not private.</strong> It is the one every new account starts "
            "on, so the platform asks you to choose your own the moment you sign in — you cannot reach a single "
            "screen until you do."))
    if not body:
        blocks.append(MD.mail_para(
            "Your account opens <strong>your onboarding</strong> — the New Hire Questionnaire, your tutorials and "
            "your documents. That is deliberate: the rest of the platform opens by itself the day your onboarding is "
            "complete."))
    blocks.append(MD.mail_steps(["Sign in and change the temporary password.",
                                 "Finish the <strong>New Hire Questionnaire</strong>.",
                                 "Watch the <strong>New Hire Tutorials</strong> and upload the documents we ask for."]))
    hello = ("Congratulations, " + first + ".") if first else "Congratulations."
    text = ((body or hello + "\n\nYou are through the interview and starting your onboarding with ASA LifeCare — and "
             "you now have your own account on our platform.") + "\n\nSign in with: " + email + "\n" +
            ("First-time password: " + password + "\n\nThis password is not yours and is not private: it is the one "
             "every new account starts on, so the platform will ask you to choose your own the moment you sign in.\n"
             if password else "") +
            ("\n" if body else "\nYour account opens your onboarding — the New Hire Questionnaire, your tutorials and "
             "your documents. The rest of the platform opens by itself the day your onboarding is complete.\n\n") +
            link + "\n")
    html = MD.mail_shell({
        "eyebrow": "ASA LifeCare · Onboarding", "title": "Welcome — your onboarding starts here",
        "preheader": "Your account is ready. It opens your onboarding.", "blocks": blocks,
        "cta": {"label": "Sign in and begin", "href": link},
        "footnote": "Change the temporary password the first time you sign in. If anything does not open yet, it is "
                    "not broken — the rest of the platform unlocks when your onboarding is done."})
    return {"subject": o.get("subject") or "Welcome to ASA LifeCare — your onboarding starts here", "text": text,
            "html": html}


def _rpc(reads: L.Reads, name: str, p: dict, key: str) -> dict[str, Any]:
    return CR.refused_contract(name, p) or CR.call(reads, name, p, {"idempotency_key": key})


def tell(reads: L.Reads, cid: str, cand: dict, name: str, email: str, pw: str) -> list[dict]:
    """onboardingEnsureUser_'s telling: the welcome letter and the login by text, each through Smart Comms under its
    own idempotency key, then the journey line."""
    first = HH.greet_first(name)

    def fill(t: str) -> str:
        return t.replace("{first_name}", first).replace("{name}", name)
    letter = welcome_letter({"name": name, "email": email, "password": pw,
                             "subject": fill(HH.sim_text(reads, "onboarding_subject")),
                             "bodyText": fill(HH.sim_text(reads, "onboarding_body"))})
    r_mail = _rpc(reads, "emailSend", {"to": email, "subject": letter["subject"], "body": letter["text"],
                                       "html": letter["html"], "withhold": [pw],
                                       "reason": "onboarding: the new hire is told about their own account"},
                  "onb_login_" + cid)
    told = bool(r_mail.get("ok") and r_mail.get("sent"))
    sms_told = False
    phone = HH.sendable_phone(reads, s_(cand.get("phone")))
    if phone:
        body = (HH.sim_text(reads, "onboarding_sms").replace("{first_name}", first).replace("{email}", email)
                .replace("{password}", pw)) or SMS_FLOOR.replace("{email}", email).replace("{password}", pw)
        r_sms = _rpc(reads, "smsSend", {"to": phone, "body": body, "withhold": [pw],
                                        "reason": "onboarding: the login by text too"}, "onb_login_sms_" + cid)
        sms_told = bool(r_sms.get("ok") and r_sms.get("sent"))
    why = s_(r_mail.get("reason") or r_mail.get("error")) or "send failed"
    owed = bool(r_mail.get("quiet"))
    return HH.journey(reads, cid, name, {
        "step": "onboarding_account", "channel": "email+sms" if sms_told or owed else "email", "to": email,
        "ok": told or owed, "rehearsal": bool(r_mail.get("redirected") or r_mail.get("rehearsed")), "by": BY_MINT,
        "detail": ("their onboarding login was sent" + (" — by letter AND by text" if sms_told else "")) if told
        else "the account exists; its letter and text are owed when the quiet window ends" if owed
        else "the account exists but the letter did not go — " + why})


def mint_sweep(sess: L.Session, payload: dict) -> Decision:
    """onboardingUserSweepMaybe_ on the relay's clock, after onboardingUserDue: each login minted (role onboarding, the
    ONBOARDING badge, the workspace default to be changed at the first sign-in) and told; a blank card address
    filled from the one picked; a card waiting on the CJIS report says so once."""
    if not HH.service(sess):
        return Decision(dict(HH.SERVICE_ONLY))
    p = payload if isinstance(payload, dict) else {}
    if p.get("prepared") is None:
        raise Defer("onboardingUserSweep is read by onboardingUserDue first")
    prep = R.unsealed(HA.MINT_DOOR, "service", p.get("prepared"))
    if prep is None:
        return W.refuse(409, HHW.STALE)
    reads = sess.reads
    by_id = HA.latest(reads)
    recs: list[dict] = []
    for cid in prep.get("waiting") or []:
        c = by_id.get(cid) or {}
        recs += HH.journey(reads, cid, s_(c.get("candidatename")) or cid, {
            "step": "onboarding", "channel": "record", "ok": False, "detail": HA.WAITS_CJIS, "by": BY_MINT})
    for f in prep.get("fills") or []:
        recs += HH.card_facts(reads, f["cid"], {"email": f["email"]}, BY_MINT, W.now_iso(reads))
        log.info("onboarding_email_filled: %s — e-mail found in %s", f["cid"], f["source"])
    made: list[str] = []
    mint = prep.get("mint") or []
    pw = HA.password(reads) if mint else ""
    if mint and pw and not UW.credentials_ready():
        return Decision(dict(UW.UNSURE))
    if mint and pw:
        acc = UW.Accounts(reads)
        users = reads.users()
        here = EV.place_of(sess.user)
        taken: set[str] = set()
        started = time.time()
        for m in mint[:MINTS_PER_PASS]:
            if time.time() - started > HHW.SWEEP_BUDGET_S:
                break
            cid, email = m["cid"], m["email"]
            cand = (CND.evidence(reads, cid).get("cand")) or by_id.get(cid)
            if not cand or CND.stage_of(cand.get("status")) != "onboarding" or email in taken \
                    or A.user_by_email(users, email):
                continue
            taken.add(email)
            name = s_(cand.get("candidatename")) or cid
            now = W.now_iso(reads)
            uid = UA.new_uid()
            recs.append(UA.new_row(acc, reads, here, uid, email, name, "onboarding",
                                   {"mustchange": "true", "types": "ONBOARDING"}))
            UW.credential_put(uid, pw, True)
            if m.get("fill"):
                recs += HH.card_facts(reads, cid, {"email": email}, BY_MINT, now)
                log.info("onboarding_email_filled: %s — %s: e-mail found in %s", cid, name, m.get("source"))
            log.info("onboarding_user_created: %s — %s can now sign in as %s (role onboarding)", cid, name, email)
            recs += tell(reads, cid, cand, name, email, pw)
            recs += HH.journey(reads, cid, name, {
                "step": "onboarding", "channel": "record", "ok": True, "by": "asa-hub:onboard-user-sweep",
                "detail": "the second piece landed — the onboarding login was minted by the sweep (signed packet + "
                          "CJIS report both on record)"})
            made.append(cid)
    elif mint:
        log.warning("onboarding_user_no_property: set ONBOARDING_USER_PASSWORD (or FIRST_USER_PASSWORD); no account "
                    "made")
    return _done({"status": 200, "data": {"minted": len(made), "waiting": len(prep.get("waiting") or []),
                                          "filled": len(prep.get("fills") or [])}}, recs,
                 UW.SUBJECT if made else "")


def graduate_pass(sess: L.Session) -> tuple[dict[str, Any], list[dict]]:
    """hubHiredSweep_'s graduations (hubHiredGraduate_): the onboarding account promoted to staff (same login, same
    password, the ONBOARDING badge swapped for STAFF), or a staff account made unarmed — armed by hand with a password
    — and remembered on the card; a skip said on the card as the hold it is."""
    reads = sess.reads
    plan = HA.graduate_plan(reads)
    by_id = HA.latest(reads)
    recs: list[dict] = []
    acc: UW.Accounts | None = None
    here = EV.place_of(sess.user)
    out = {"promoted": 0, "created": 0, "held": 0}
    started = time.time()
    for g in plan["graduating"]:
        if time.time() - started > HHW.SWEEP_BUDGET_S:
            break
        cid = g["cid"]
        c = by_id[cid]
        name = s_(c.get("candidatename"))
        now = W.now_iso(reads)
        if g["act"] == "held":
            recs += HH.card_facts(reads, cid, {"graduation_held": g["why"]}, BY_GRADUATE, now)
            log.info("hired_graduation_held: %s — %s: %s", cid, name, g["why"])
            out["held"] += 1
            continue
        acc = acc or UW.Accounts(reads)
        if g["act"] == "promote":
            at = acc.last(g["uid"])
            if at is None or acc.is_master(at) or acc.key(at) is None:
                log.warning("hired_graduation: %s — %s: the onboarding account's row cannot be told apart", cid, name)
                continue
            types = [t for t in UW.types_of(acc.cell(at, "types"))[0] if t != "ONBOARDING"]
            if "STAFF" not in types:
                types.append("STAFF")
            recs += UW.carried(sess, acc, [(at, {"role": "staff", "types": ", ".join(types)})], "hiredGraduateSweep")
            recs += HH.card_facts(reads, cid, {"staff_user_id": g["uid"]}, BY_GRADUATE, now)
            log.info("onboarding_user_promoted: %s — %s: the onboarding account became staff (same login, same "
                     "password)", cid, name)
            out["promoted"] += 1
        else:
            uid = UA.new_uid()
            recs.append(UA.new_row(acc, reads, here, uid, s_(c.get("email")).lower(), name, "staff",
                                   {"title": STAFF_TITLE, "phone": s_(c.get("phone")), "candidateid": cid,
                                    "types": "STAFF"}))
            recs += HH.card_facts(reads, cid, {"staff_user_id": uid}, BY_GRADUATE, now)
            out["created"] += 1
        log.info("hired_graduated: %s — %s%s; held in Hired until the account is armed and the Employee Database is "
                 "written", cid, name, "; staff account created (awaiting password)" if g["act"] == "create" else "")
    return out, recs


def graduate_sweep(sess: L.Session, payload: dict) -> Decision:
    """hiredGraduateSweep: the graduations on the relay's clock, after hiredGraduateDue."""
    if not HH.service(sess):
        return Decision(dict(HH.SERVICE_ONLY))
    out, recs = graduate_pass(sess)
    return _done({"status": 200, "data": out}, recs, UW.SUBJECT if out["promoted"] or out["created"] else "")


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {"onboardingUserSweep": mint_sweep,
                                                              "hiredGraduateSweep": graduate_sweep}
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
BUSY_OF: dict[str, dict[str, Any]] = {a: {"status": 409, "message": W.BUSY} for a in ACTIONS}


class Store(hiring_writes.Store):
    """The hiring store; a void also takes back what an account write kept under it (users_writes.void_cleanup): the
    password the sign-in's store set and the users cells still queued for the sheet."""

    def settle(self, write_id: str, state: str, why: str = "", fields: list[str] | None = None) -> bool:
        done = super().settle(write_id, state, why, fields)
        if state == "void" and done:
            try:
                with self.conn().transaction():
                    UW.void_cleanup(self.conn(), write_id)
            except Exception as exc:  # noqa: BLE001 - said, never raised into the relay's settle
                log.warning("hiring accounts: the void of %s was not taken back whole (%s)", write_id[:40],
                            type(exc).__name__)
        return done
