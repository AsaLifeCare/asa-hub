"""The People merge's preview (apps-script/PeopleMerge.gs peopleMergePreview) answered off asa-hub-db: every fold an
admin could sign — the suggested pairs people_types holds undecided, the detected pairs (one name on several roster
rows) and the shared lines (one e-mail or phone under different names) — nothing written. Signing them
(peopleMergeApply) mints a Users row for each survivor, an account with its sign-in e-mail, and stays Apps Script's."""
from __future__ import annotations

import functools
import re
from typing import Any, Callable

import client_writes as CW
import contacts_sync as CS
import gsjs
import house_tables as HT
import hubdb
import locations as L
import staff as SP
from scope import Defer

APP_ID = "people-merge"
PEOPLE_TYPES_TAB = "people_types"
DIRECTORS_TAB = "directors"
DIRECTORY_PROP = "HUB_DIRECTORY_ID"
DENIED = {"status": 403, "message": "Requires an admin or manager account"}
RICH_FIELDS = ("email", "phone", "role", "first_name", "avatar", "start_date")

s_ = gsjs.str_


def text(v: Any) -> str:
    """String(v || '').trim()."""
    return gsjs.trim(gsjs.or_text(v))


def fold_key(v: Any) -> str:
    """peopleFoldKey_."""
    return re.sub(r"[^a-z0-9]+", "", gsjs.or_text(v).lower())


def phone_key(v: Any) -> str:
    """peoplePhoneKey_."""
    return SP._phone_key(v)


def type_of(role: Any) -> str:
    """peopleTypeOf_."""
    s = gsjs.or_text(role).lower()
    if not s:
        return ""
    if "dsp" in s or "direct support" in s:
        return "DSP"
    return "Client" if "client" in s else "Staff"


def pending(reads: L.Reads) -> dict[str, Any]:
    """peopleMergePending_: the undecided suggestions (the newest per alias), every alias already taken, and the
    targets the recorded folds point at."""
    if HT.tabled(PEOPLE_TYPES_TAB):
        heads, rows = HT.raw(reads, PEOPLE_TYPES_TAB)
    else:
        res = reads.db.resolve(PEOPLE_TYPES_TAB)
        if res.ref is None:
            if not res.book_known:
                raise hubdb.Unreadable("asa-hub-db holds no copy of the book behind people_types")
            return {"error": {"status": 404, "message": f"No {PEOPLE_TYPES_TAB} tab."}}
        heads, rows = list(res.ref.headers), reads.db.rows(res.ref)
    hdr = [gsjs.trim(gsjs.js_str(h)) for h in heads]

    def at(name: str) -> int:
        return hdr.index(name) if name in hdr else -1

    col = {"id": at("person_id"), "dup": at("duplicate_of"), "dec": at("decision"), "score": at("duplicate_score"),
           "email": at("email")}
    if col["id"] == -1 or col["dup"] == -1 or col["dec"] == -1:
        return {"error": {"status": 400, "message": f"{PEOPLE_TYPES_TAB} is missing person_id/duplicate_of/decision."}}
    out: list[dict] = []
    taken: dict[str, bool] = {}
    targets: dict[str, str] = {}
    by_alias: dict[str, int] = {}

    def cell(raw: dict, i: int) -> str:
        return text(hubdb.typed(raw.get(heads[i]), "hub"))

    for rn, raw in rows:
        pid = cell(raw, col["id"])
        dup = cell(raw, col["dup"])
        if not dup:
            continue
        taken[pid] = True
        m = re.search(r"\(([^)]+)\)\s*$", dup)
        target = gsjs.trim(m.group(1)) if m else ""
        if target:
            targets[pid] = target
        if cell(raw, col["dec"]):
            continue
        entry = {"row": rn, "alias_id": pid, "primary_id": target,
                 "types_email": "" if col["email"] == -1 else cell(raw, col["email"]),
                 "score": "" if col["score"] == -1 else cell(raw, col["score"])}
        # the types pass appends a row per fingerprint change: only the newest per alias
        if pid in by_alias:
            out[by_alias[pid]] = entry
        else:
            by_alias[pid] = len(out)
            out.append(entry)
    return {"pending": out, "taken": taken, "targets": targets}


def system_identity(reads: L.Reads) -> dict[str, dict[str, bool]]:
    """peopleSystemIdentity_: the directors' names, and every account above staff by its name and e-mail."""
    names: dict[str, bool] = {}
    emails: dict[str, bool] = {}
    try:
        if HT.tabled(DIRECTORS_TAB):
            directors = hubdb.normalize(*HT.raw(reads, DIRECTORS_TAB))
        else:
            sid = reads.db.prop(DIRECTORY_PROP)
            directors = reads.db.normalized_rows(reads.tab_of(sid, DIRECTORS_TAB, "the directory") if sid else None)
        for d in directors:
            if not s_(d.get("id")) or not s_(d.get("name")):
                continue
            n = gsjs.trim(s_(d.get("name"))).lower()
            if n:
                names[n] = True
    except (hubdb.Unreadable, Defer):
        raise
    except Exception:  # noqa: BLE001 - nobody from the directory, as Apps Script's catch has it
        pass
    try:
        for u in reads.users():
            if s_(u.get("role")).lower() in ("staff", "client"):
                continue
            n = s_(u.get("displayname")).lower()
            if n:
                names[n] = True
            em = s_(u.get("email")).lower()
            if em:
                emails[em] = True
    except (hubdb.Unreadable, Defer):
        raise
    except Exception:  # noqa: BLE001 - no account, as Apps Script's catch has it
        pass
    return {"names": names, "emails": emails}


def is_system(identity: dict, pair_names: list, pair_emails: list, roles: list) -> bool:
    """peopleIsSystem_: an entity role, a system e-mail, or a name a system name begins (or that begins it)."""
    if any(gsjs.or_text(r).lower() == "entity" for r in roles):
        return True
    if any(text(e).lower() and identity["emails"].get(text(e).lower()) for e in pair_emails):
        return True
    systems = [fold_key(n) for n in CS.js_keys(identity["names"])]
    for nm in pair_names:
        name = fold_key(nm)
        if not name:
            continue
        if any(sys and (name == sys or name.startswith(sys) or sys.startswith(name)) for sys in systems):
            return True
    return False


def richness(row: dict) -> int:
    """peopleRichness_."""
    score = sum(1 for f in RICH_FIELDS if text(row.get(f)))
    return score + (2 if gsjs.or_text(row.get("status")).lower() == "active" else 0)


def _richer(a: dict, b: dict) -> int:
    d = richness(b) - richness(a)
    return d if d != 0 else (-1 if gsjs.js_str(a.get("id")) < gsjs.js_str(b.get("id")) else 1)


def pair_info(reads: L.Reads, alias: dict, primary: dict, extra: dict, identity: dict) -> dict[str, Any]:
    """peoplePairInfo_: what folding the alias into the primary adds; differing e-mails or phones suggest two humans,
    so such a pair is never pre-checked. The sign-in e-mail is only ever the survivor's own."""
    have = {gsjs.or_text(primary.get("email")).lower()}
    add_emails = []
    for e in (alias.get("email"), extra.get("types_email")):
        k = text(e).lower()
        if k and k not in have:
            have.add(k)
            add_emails.append(gsjs.trim(gsjs.js_str(e)))
    add_phones = []
    if phone_key(alias.get("phone")) and phone_key(alias.get("phone")) != phone_key(primary.get("phone")):
        add_phones.append(gsjs.trim(gsjs.js_str(alias.get("phone"))))
    email = text(primary.get("email"))
    alias_email, primary_email = text(alias.get("email")).lower(), email.lower()
    conflict = bool((alias_email and primary_email and alias_email != primary_email)
                    or (phone_key(alias.get("phone")) and phone_key(primary.get("phone"))
                        and phone_key(alias.get("phone")) != phone_key(primary.get("phone"))))
    return {"alias_id": gsjs.js_str(alias.get("id")),
            "alias_name": gsjs.js_str(SP._or(alias.get("name"), alias.get("id"))),
            "primary_id": gsjs.js_str(primary.get("id")),
            "primary_name": gsjs.js_str(SP._or(primary.get("name"), primary.get("id"))),
            "add_emails": add_emails, "add_phones": add_phones,
            "person_type": type_of(primary.get("role")) or type_of(alias.get("role")),
            "system": is_system(identity, [alias.get("name"), primary.get("name")],
                                [alias.get("email"), primary.get("email"), extra.get("types_email")],
                                [alias.get("role"), primary.get("role")]),
            "detected": bool(extra.get("detected")), "conflict": conflict,
            "score": extra.get("score") or "",
            "user_email": email, "already_user": bool(CW.user_by_email(reads, primary_email)) if email else False}


def shared_groups(people: list[dict], taken: dict) -> list[dict]:
    """peopleSharedGroups_: different names sharing an e-mail or a phone, never folded automatically; a company line
    identifies nobody."""
    by_email: dict[str, list[dict]] = {}
    by_phone: dict[str, list[dict]] = {}
    for p in people:
        if not isinstance(p, dict) or gsjs.falsy(p.get("id")) or taken.get(gsjs.js_str(p.get("id"))):
            continue
        em = text(p.get("email")).lower()
        if em:
            by_email.setdefault(em, []).append(p)
        ph = phone_key(p.get("phone"))
        if len(ph) == 10 and ph not in CS.SHARED_LINE_DIGITS:
            by_phone.setdefault(ph, []).append(p)
    shared = []
    for idx, via in ((by_email, "email"), (by_phone, "phone")):
        for k in CS.js_keys(idx):
            group = idx[k]
            if len(group) < 2 or len({fold_key(p.get("name")) for p in group}) < 2:
                continue
            shared.append({"via": via, "value": k,
                           "people": [{"id": gsjs.js_str(p.get("id")),
                                       "name": gsjs.js_str(SP._or(p.get("name"), p.get("id")))} for p in group]})
    return shared


def preview(sess: L.Session, payload: dict) -> dict[str, Any]:
    """peopleMergePreview: every fold an admin could sign — suggested pairs, detected pairs and shared lines; nothing
    is written."""
    user = sess.user
    if not user or user.get("role") != "admin":
        return dict(DENIED)
    reads = sess.reads
    src = pending(reads)
    if src.get("error"):
        return src["error"]
    scope = gsjs.or_text((payload or {}).get("scope")) if isinstance(payload, dict) else ""
    identity = system_identity(reads)
    # raw: the lens must not hide the rows being judged
    people = SP._people(reads)
    by_id = {gsjs.js_str(p.get("id")): p for p in people if isinstance(p, dict) and not gsjs.falsy(p.get("id"))}
    pairs = []
    for s in src["pending"]:
        alias, primary = by_id.get(s["alias_id"]), by_id.get(s["primary_id"])
        if alias is None or primary is None:
            continue
        pair = pair_info(reads, alias, primary, s, identity)
        if scope == "system" and not pair["system"]:
            continue
        pairs.append(pair)
    key_idx: dict[str, list[dict]] = {}
    for p in people:
        if not isinstance(p, dict) or gsjs.falsy(p.get("id")) or src["taken"].get(gsjs.js_str(p.get("id"))):
            continue
        k = fold_key(p.get("name"))
        if k:
            key_idx.setdefault(k, []).append(p)
    for k in CS.js_keys(key_idx):
        group = key_idx[k]
        if len(group) < 2:
            continue
        group = sorted(group, key=functools.cmp_to_key(_richer))
        for alias in group[1:]:
            pair = pair_info(reads, alias, group[0], {"detected": True}, identity)
            if scope == "system" and not pair["system"]:
                continue
            pairs.append(pair)
    shared = shared_groups(people, src["taken"])
    if scope == "system":
        shared = [g for g in shared if any(is_system(identity, [x["name"]], [], []) for x in g["people"])]
    return {"status": 200, "data": {"pairs": pairs, "shared": shared}}


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {"peopleMergePreview": preview}
POLICY: dict[str, dict[str, Any]] = {"peopleMergePreview": {"roles": ("admin",)}}
