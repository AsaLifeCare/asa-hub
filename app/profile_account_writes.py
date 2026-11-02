"""profileUpdate (apps-script/Profile.gs) kept off asa-hub-db whole: the signed-in account's own name, title, phones,
addresses and picture on its users row (kept and carried as users_writes keeps them), a self-chosen password kept by
the sign-in's credential store, and a place's profile as account_profile_writes keeps it. The master's own row stays
Apps Script's while the master signs in there: its session copy, held six hours, is dropped only by Apps Script."""
from __future__ import annotations

from typing import Any, Callable

import account_profile as AP
import account_profile_writes as APW
import gsjs
import locations as L
import staff as SP
import users_writes as UW
import writes as W
from writes import Decision

s_ = gsjs.str_
NOT_FOUND = {"status": 404, "message": "Your user row was not found."}
SHORT = {"status": 400, "message": "Your password needs at least 8 characters."}


def update(sess: L.Session, payload: dict) -> Decision:
    """profileUpdate: refused here in its words; the account's row, its password and a place's profile kept."""
    p = payload if isinstance(payload, dict) else {}
    shut, _here = UW.door_gate(sess, "profileUpdate", p)
    if shut is not None:
        return shut
    user = sess.user or {}
    uid = s_(user.get("id"))
    reads = sess.reads
    fields: dict[str, str] = {}
    if "display_name" in p:
        name = s_(p.get("display_name"))
        if not name:
            return W.refuse(400, APW.NAME_EMPTY)
        fields["display_name"] = name[:80]
        if not s_(p.get("place")):
            why = APW.self_name_refused(reads, uid, fields["display_name"])
            if why:
                return W.refuse(409, why)
            stored = next((s_(u.get("displayname")) for u in reads.users() if s_(u.get("userid")) == uid), "")
            if SP.fold(fields["display_name"]) != SP.fold(stored):
                # a name the account changes itself proves nothing to the certificate ledger (ComplianceDocs.gs)
                fields["name_by"] = "self"
    if "title" in p:
        fields["title"] = s_(p.get("title"))[:120]
    if "phone" in p:
        fields["phone"] = s_(p.get("phone"))[:40]
    if "phones" in p:
        phones = SP._clean_phones(p.get("phones"))
        fields["phones"] = W.json_text(phones)
        fields["phone"] = phones[0]["number"] if phones else ""
    if "emails" in p:
        fields["emails"] = W.json_text(SP._clean_emails(p.get("emails")))
    if "avatar" in p:
        fields["avatar"] = s_(p.get("avatar"))[:500]
    pw = ""
    if "password" in p:
        pw = gsjs.or_text(p.get("password"))
        if UW.js_len(pw) < UW.PASSWORD_MIN:
            return Decision(dict(SHORT))
        fields["must_change"] = ""
    if not fields:
        return W.refuse(400, APW.NOTHING)
    place = s_(p.get("place"))[:80]
    overlay = {k: fields.pop(k) for k in APW.OVERLAY if k in fields} if place else {}
    if fields and UW.master_sign_in_elsewhere(user.get("email")):
        # the master's own row: Apps Script writes it and drops the master's session copy
        return Decision(None, engine=True)
    edits: list[dict] = []
    if overlay:
        kept = APW.keep_place(sess, uid, gsjs.trim(place), overlay)
        edits += kept.edits or []
    me = next((u for u in reads.users() if s_(u.get("userid")) == uid), None)
    if fields:
        acc = UW.Accounts(reads)
        at = acc.first(uid)
        if at is None:
            return Decision(dict(NOT_FOUND))
        if acc.key(at) is None:
            return W.refuse(409, W.NOT_TOLD_APART)
        cells = {f.replace("_", ""): v for f, v in fields.items()}
        if acc.lacks(cells):
            return Decision(dict(UW.UNSURE))
        if pw and not UW.credentials_ready():
            return Decision(dict(UW.UNSURE))
        edits += UW.carried(sess, acc, [(at, cells)], "profileUpdate")
        if pw:
            UW.credential_put(uid, pw, None)
        if me is not None:
            me = {**me, **cells}
            if pw:
                # userPublic_'s `armed` reads the hash the store now keeps
                me["passhash"] = me.get("passhash") or "[withheld: secret]"
    d = W.final({"status": 200, "data": {"user": AP.public(reads, me) if me is not None else None}}, edits,
                UW.SUBJECT)
    if pw and not d.edits:
        d.own, d.subject = True, UW.SUBJECT
    return d


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {"profileUpdate": update}
POLICY: dict[str, dict[str, Any]] = {"profileUpdate": {}}
BUSY_OF: dict[str, dict[str, Any]] = {"profileUpdate": {"status": 503, "message": APW.BUSY}}
