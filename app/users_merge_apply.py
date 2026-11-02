"""The two merges an admin signs (apps-script/ContactsSync.gs usersContactMergeApply, PeopleMerge.gs
peopleMergeApply) kept off asa-hub-db: the contact merge's planned cells on each account (contacts_sync.merge_plan,
the preview's own plan) kept and carried as users_writes keeps them; the People folds signed on people_types as kept
edits, and a Users row (no password) for each surviving person who has none. The master's row is the real master's
alone: another admin's merge plans nothing on it."""
from __future__ import annotations

from typing import Any, Callable

import account_profile as AP
import auth as A
import contacts_sync as CS
import gsjs
import house_tables as HT
import hubdb
import locations as L
import people_merge as PM
import resource_rows as RR
import scope as sc
import staff as SP
import users_accounts as UA
import users_writes as UW
import writes as W
from writes import Decision

s_ = gsjs.str_
# ContactsSync.gs CONTACTS_MERGE_CAP, CONTACTS_BLANK_ONLY
MERGE_CAP = 120
BLANK_ONLY = frozenset({"phone", "title", "employeeid", "startdate", "enddate"})
MERGE_RUNNING = {"status": 409, "message": "The merge is already running — check the platform log for its counts."}
MERGE_UNREAD = {"status": 503, "message": "The roster or the accounts could not be read — nothing was written."}
PEOPLE_BUSY = {"status": 503, "message": "Another merge is being applied — try again."}
# SHARED_LINE_DIGITS (Talent.gs): a household's phone that is one of the shared lines is never a fold
SHARED_LINE_DIGITS = CS.SHARED_LINE_DIGITS


# ---- usersContactMergeApply ---------------------------------------------------------------------------------------

def contact_apply(acc: UW.Accounts, plan: list[dict], cap: int) -> tuple[dict[str, Any], list[tuple[int, dict]]]:
    """contactsMergeApply_: each planned account's cells — phones and e-mails added as context, the planned fills
    where the column is there (a blank-only one only into a blank cell) — at most `cap` accounts a pass."""
    row_by_uid: dict[str, int] = {}
    for i in range(len(acc.rows)):
        uid = acc.cell(i, "userid")
        if uid and uid not in row_by_uid:
            row_by_uid[uid] = i
    out: dict[str, Any] = {"touched": 0, "cells": 0, "phonesAdded": 0, "emailsAdded": 0, "missing": [],
                           "remaining": max(0, len(plan) - cap)}
    changes: list[tuple[int, dict]] = []
    for item in plan[:cap]:
        at = row_by_uid.get(item["user_id"])
        if at is None:
            out["missing"].append(item["name"])
            continue
        fields: dict[str, str] = {}
        if item["phones_add"] and "phones" in acc.raw:
            lst = list(SP._parse_phones(acc.cell(at, "phones")))
            have = {d for d in (CS.bulk_phone_key(p.get("number") if isinstance(p, dict) else None) for p in lst) if d}
            d0 = CS.bulk_phone_key(acc.cell(at, "phone"))
            if d0:
                have.add(d0)
            added = 0
            for p in item["phones_add"]:
                d = CS.bulk_phone_key(p.get("number"))
                if not d or d in have or len(lst) >= 8:
                    continue
                have.add(d)
                lst.append({"label": CS.LABEL, "number": p.get("number")})
                added += 1
            if added:
                clean = SP._clean_phones(lst)
                fields["phones"] = W.json_text(clean)
                out["phonesAdded"] += added
                if not acc.cell(at, "phone") and clean:
                    fields["phone"] = clean[0]["number"]
        if item["emails_add"] and "emails" in acc.raw:
            mails = list(AP.parse_emails(acc.cell(at, "emails")))
            have_em = {s_(e).lower() for e in mails}
            login = acc.cell(at, "email").lower()
            if login:
                have_em.add(login)
            added = 0
            for e in item["emails_add"]:
                k = s_(e).lower()
                if not k or k in have_em or len(mails) >= 8:
                    continue
                have_em.add(k)
                mails.append(e)
                added += 1
            if added:
                fields["emails"] = W.json_text(SP._clean_emails(mails))
                out["emailsAdded"] += added
        for k, v in (item.get("set") or {}).items():
            nk = hubdb.norm_key(k)
            if nk not in acc.raw or nk in fields:
                continue
            if nk in BLANK_ONLY and acc.cell(at, nk):
                continue
            fields[nk] = v
        if not fields:
            continue
        out["cells"] += len(fields)
        out["touched"] += 1
        changes.append((at, fields))
    return out, changes


def sentence(planned: dict[str, Any], applied: dict[str, Any]) -> str:
    """contactsMergeSentence_."""
    return (f"{applied['touched']} account(s) updated of {len(planned['plan'])} planned ({applied['cells']} cell(s), "
            f"{applied['phonesAdded']} phone(s) and {applied['emailsAdded']} e-mail(s) kept as context), "
            f"{planned['examined']} examined, {len(planned['ambiguous'])} ambiguous, {len(planned['confirm'])} left "
            f"for an administrator to confirm, {len(planned['near'])} look like roster people, "
            f"{len(planned['unmatched'])} without a roster row, {planned['skipped_client']} client(s) left as they "
            "are" + (f", {applied['remaining']} left for the next pass" if applied["remaining"] else "")
            + (f", {planned['garbage_roles']} polluted role(s) refused" if planned["garbage_roles"] else ""))


def contact_merge_apply(sess: L.Session, payload: dict) -> Decision:
    """usersContactMergeApply: the contact merge signed by an admin — every planned account, or the ones named."""
    p = payload if isinstance(payload, dict) else {}
    shut, _here = UW.door_gate(sess, "usersContactMergeApply", p)
    if shut is not None:
        return shut
    user = sess.user or {}
    if not sess.user or user.get("is_service") or s_(user.get("role")) != "admin":
        return Decision(dict(UW.DENIED))
    reads = sess.reads
    try:
        inputs = CS.merge_inputs(reads)
        planned = CS.merge_plan(inputs["users"], inputs["people"], gsjs.iso(reads.now), inputs["on_staff"],
                                CS.Words(reads))
    except Exception:  # noqa: BLE001 - its catch: nothing is written
        return Decision(dict(MERGE_UNREAD))
    if not sc.is_real_master(user):
        masters = {s_(u.get("userid")) for u in inputs["users"] if sc.is_master_email(u.get("email"))}
        planned = {**planned, "plan": [it for it in planned["plan"] if it["user_id"] not in masters]}
    only = [gsjs.js_str(x) for x in p["user_ids"]] if isinstance(p.get("user_ids"), list) else None
    plan = [it for it in planned["plan"] if it["user_id"] in only] if only is not None else planned["plan"]
    acc = UW.Accounts(reads)
    applied, changes = contact_apply(acc, plan, MERGE_CAP)
    if any(acc.key(at) is None for at, _c in changes):
        return W.refuse(409, W.NOT_TOLD_APART, fresh=(acc.sid,))
    edits = UW.carried(sess, acc, changes, "usersContactMergeApply")
    for at, _c in changes:
        edits += UW.profile_stale(reads, acc.cell(at, "userid"))
    UW.log_line(user, "users_contact_merge", sentence(planned, applied))
    return W.final({"status": 200, "data": {
        "touched": applied["touched"], "cells": applied["cells"], "phones_added": applied["phonesAdded"],
        "emails_added": applied["emailsAdded"], "remaining": applied["remaining"], "missing": applied["missing"],
        "planned": len(plan), "examined": planned["examined"],
        "near": len(planned["near"]), "near_named": planned["near"][:80],
        "confirm": len(planned["confirm"]), "confirm_named": planned["confirm"][:80],
        "ambiguous": len(planned["ambiguous"]), "ambiguous_named": planned["ambiguous"][:80],
        "skipped_client": planned["skipped_client"], "garbage_roles": planned["garbage_roles"]}},
        edits, UW.SUBJECT)


# ---- peopleMergeApply -----------------------------------------------------------------------------------------------

class Types:
    """people_types as this signing reads and leaves it: each row's cells by its header, the first row of each person,
    and the kept edits the signatures make."""

    def __init__(self, reads: L.Reads) -> None:
        self.reads = reads
        # a row kept in the house's own table: (its key, its cells as kept), by index
        self.kept: list[tuple[str, dict]] | None = None
        if HT.tabled(PM.PEOPLE_TYPES_TAB):
            cols, placed = HT.placed(reads, PM.PEOPLE_TYPES_TAB)
            self.ref, self.sid, self.tab = None, "", PM.PEOPLE_TYPES_TAB
            self.raw = {h: h for h in cols}
            self.rows = [(p, cells) for _k, p, cells, _c in placed]
            self.kept = [(k, c) for k, _p, _cells, c in placed]
        else:
            res = reads.db.resolve(PM.PEOPLE_TYPES_TAB)
            self.ref = res.ref
            self.sid, self.tab = W.where_of(res)
            heads = [gsjs.trim(gsjs.js_str(h)) for h in (self.ref.headers if self.ref is not None else ())]
            self.raw = {h: self.ref.headers[i] for i, h in reversed(list(enumerate(heads)))} if self.ref else {}
            self.rows = reads.db.rows(self.ref) if self.ref is not None else []
        self.by_rn = {rn: i for i, (rn, _r) in enumerate(self.rows)}
        self.first: dict[str, int] = {}
        for i, (_rn, raw) in enumerate(self.rows):
            pid = gsjs.trim(gsjs.or_text(hubdb.typed(raw.get(self.raw.get("person_id")), "hub")))
            if pid and pid not in self.first:
                self.first[pid] = i
        self.edits: list[dict] = []

    def head(self, name: str) -> str | None:
        return name if name in self.raw else None

    def key(self, i: int) -> tuple[str, str] | None:
        sets = [[self.raw.get(h) for h in hs if self.raw.get(h)] for hs in
                (("person_id",), ("person_id", "duplicate_of"), ("person_id", "duplicate_of", "duplicate_score"),
                 ("person_id", "duplicate_of", "duplicate_score", "email"))]
        return W.row_key_of(self.rows, i, sets)

    def sign(self, i: int, cells: dict[str, str]) -> bool:
        """The row's cells kept; False when no key tells the row apart."""
        if self.kept is not None:
            key, was = self.kept[i]
            changed = {h: v for h, v in cells.items() if gsjs.or_blank(was.get(h)) != v}
            if changed:
                RR.update(self.reads, HT.resource_of(self.tab) or "", key, was, changed, UW.SUBJECT)
            return True
        got = self.key(i)
        if got is None:
            return False
        heads = {h: v for h, v in cells.items() if self.head(h)}
        before = {h: gsjs.or_blank(self.rows[i][1].get(self.raw[h])) for h in heads}
        self.edits.append(W.kept_record(self.sid, self.tab, "edit", got[0], got[1], UW.SUBJECT, heads, before))
        return True

    def append(self, pid: str, cells: dict[str, str]) -> None:
        if self.kept is not None:
            RR.create(self.reads, HT.resource_of(self.tab) or "", {h: v for h, v in cells.items() if v != ""},
                      UW.SUBJECT)
            return
        heads = {h: v for h, v in cells.items() if self.head(h)}
        self.edits.append(W.kept_record(self.sid, self.tab, "append", W.COLS + "person_id", pid, UW.SUBJECT, heads))


def people_merge_apply(sess: L.Session, payload: dict) -> Decision:
    """peopleMergeApply: the confirmed folds signed, then a Users row minted for each survivor (no password)."""
    p = payload if isinstance(payload, dict) else {}
    shut, _here = UW.door_gate(sess, "peopleMergeApply", p)
    if shut is not None:
        return shut
    user = sess.user or {}
    if not sess.user or s_(user.get("role")) != "admin":
        return Decision(dict(UW.DENIED))
    suggested = p.get("suggested") or p.get("alias_ids") or []
    detected = p.get("detected") or []
    households = p.get("households") or []
    suggested = suggested if isinstance(suggested, list) else []
    detected = detected if isinstance(detected, list) else []
    households = households if isinstance(households, list) else []
    if not suggested and not detected and not households:
        return W.refuse(400, "suggested, detected and/or households: which folds to sign.")
    reads = sess.reads
    src = PM.pending(reads)
    if src.get("error"):
        return Decision(src["error"])
    types = Types(reads)
    by_alias = {s["alias_id"]: s for s in src["pending"]}
    taken, targets = dict(src["taken"]), dict(src["targets"])
    by_id = {gsjs.js_str(x.get("id")): x for x in SP._people(reads)
             if isinstance(x, dict) and not gsjs.falsy(x.get("id"))}
    now = W.now_iso(reads)
    by = gsjs.or_text(user.get("email")) or "admin"
    signed: list[dict] = []
    refused: list[str] = []
    sign_cells = {"decision": "merge", "decided_by": by, "decided_at": now}

    def fold(alias: dict, primary: dict) -> None:
        aid, pid = gsjs.js_str(alias.get("id")), gsjs.js_str(primary.get("id"))
        dup = gsjs.js_str(primary.get("name") or primary.get("id")) + " (" + pid + ")"
        at = types.first.get(aid)
        if at is not None:
            if not types.sign(at, {"duplicate_of": dup, **sign_cells}):
                refused.append(aid + " (" + W.NOT_TOLD_APART + ")")
                return
        else:
            types.append(aid, {"person_id": aid, "duplicate_of": dup, **sign_cells})
        taken[aid] = True
        targets[aid] = pid
        signed.append({"alias_id": aid, "primary_id": pid})

    for d in suggested:
        alias_id = gsjs.or_text(d.get("alias_id") if isinstance(d, dict) else d)
        sent_primary = gsjs.or_text(d.get("primary_id")) if isinstance(d, dict) else ""
        s = by_alias.get(alias_id)
        if s is None:
            continue
        if sent_primary and s["primary_id"] != sent_primary:
            refused.append(alias_id + " (the suggestion changed while the modal was open)")
            continue
        if targets.get(s["primary_id"]) == s["alias_id"]:
            refused.append(alias_id + " (reverse fold already recorded)")
            continue
        at = types.by_rn.get(s["row"])
        if at is None or not types.sign(at, sign_cells):
            refused.append(alias_id + " (" + W.NOT_TOLD_APART + ")")
            continue
        targets[s["alias_id"]] = s["primary_id"]
        signed.append(s)
    for d in detected:
        d = d if isinstance(d, dict) else {}
        alias, primary = by_id.get(gsjs.or_text(d.get("alias_id"))), by_id.get(gsjs.or_text(d.get("primary_id")))
        if not alias or not primary or gsjs.js_str(alias.get("id")) == gsjs.js_str(primary.get("id")):
            continue
        if not PM.fold_key(alias.get("name")) or PM.fold_key(alias.get("name")) != PM.fold_key(primary.get("name")):
            continue
        if taken.get(gsjs.js_str(alias.get("id"))):
            continue
        if targets.get(gsjs.js_str(primary.get("id"))) == gsjs.js_str(alias.get("id")):
            refused.append(gsjs.js_str(alias.get("id")) + " (reverse fold already recorded)")
            continue
        fold(alias, primary)
    for h in households:
        h = h if isinstance(h, dict) else {}
        via = gsjs.or_text(h.get("via"))
        val = gsjs.trim(gsjs.or_text(h.get("value"))).lower()
        ids = h.get("ids") or []
        if not isinstance(ids, list) or len(ids) < 2 or not val or via not in ("email", "phone"):
            continue
        if via == "phone" and val in SHARED_LINE_DIGITS:
            continue
        group, seen = [], set()
        for raw_id in ids:
            person = by_id.get(gsjs.or_text(raw_id))
            if not person or gsjs.js_str(person.get("id")) in seen:
                continue
            seen.add(gsjs.js_str(person.get("id")))
            if taken.get(gsjs.js_str(person.get("id"))):
                continue
            still = (gsjs.trim(gsjs.or_text(person.get("email"))).lower() == val if via == "email"
                     else PM.phone_key(person.get("phone")) == val)
            if not still:
                refused.append(gsjs.js_str(person.get("id")) + f" (no longer shares that {via})")
                continue
            group.append(person)
        if len(group) < 2:
            continue
        group.sort(key=lambda x: (-PM.richness(x), gsjs.js_str(x.get("id"))))
        primary = group[0]
        for alias in group[1:]:
            if targets.get(gsjs.js_str(primary.get("id"))) == gsjs.js_str(alias.get("id")):
                refused.append(gsjs.js_str(alias.get("id")) + " (reverse fold already recorded)")
                continue
            fold(alias, primary)
    if not signed:
        return W.refuse(409, "Nothing left to sign — those folds are gone, already decided or refused: " +
                        ("; ".join(refused) or "none pending"))
    acc = UW.Accounts(reads)
    rows = reads.users()
    created, skipped, seen_t, made_mail = [], [], set(), set()
    for s in signed:
        target, hops, walked = s["primary_id"], 0, set()
        while targets.get(target) and target not in walked and hops < 5:
            hops += 1
            walked.add(target)
            target = targets[target]
        if target in seen_t:
            continue
        seen_t.add(target)
        primary = by_id.get(target)
        if not primary:
            continue
        name = gsjs.js_str(primary.get("name") or s["primary_id"])
        ptype = PM.type_of(primary.get("role"))
        if ptype == "Client":
            skipped.append(name + " (client — create the account by hand with the client role)")
            continue
        email = gsjs.trim(gsjs.or_text(primary.get("email"))).lower()
        if not email or "@" not in email:
            skipped.append(name + " (no email on the surviving record)")
            continue
        if email in made_mail or A.user_by_email(rows, email):
            skipped.append(name + " (already a user)")
            continue
        uid = UA.new_uid()
        types.edits.append(acc.append(uid, {"userid": uid, "email": email, "displayname": name, "role": "staff",
                                            "active": "true", "createdat": now, "title": ptype or "Staff"}))
        made_mail.add(email)
        created.append(name)
    UW.log_line(user, "people_merge", f"{len(signed)} fold(s) signed, {len(created)} user(s) created")
    return W.final({"status": 200, "data": {"merged": len(signed), "users_created": created, "skipped": skipped,
                                            "refused": refused}}, types.edits, UW.SUBJECT)


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {
    "usersContactMergeApply": contact_merge_apply, "peopleMergeApply": people_merge_apply}
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
BUSY_OF: dict[str, dict[str, Any]] = {"usersContactMergeApply": dict(MERGE_RUNNING),
                                      "peopleMergeApply": dict(PEOPLE_BUSY)}
