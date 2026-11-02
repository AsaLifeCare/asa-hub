"""Settings › Platform users and every door around a member row (Members.gs), wherever the caller stands: the roster of
the caller's platform, the platforms the caller stands on, whether an address may be invited, who may open the caller's
world, and the reply sweep's reading of the mailbox — read off asa-hub-db, Python's kept edits laid. doPost's place is
settled here as Main.gs settles it, off the place the relay hands on: the tenant, then the member visited, each refused
with a 404; these doors answer for the account holding the session (HUB_CALLER_OWN_ACTIONS). The owner's doors are the
master's in its own session alone; no visit ever reaches the master's account. The rows they change are
app/members_writes.py's."""
from __future__ import annotations

import json
import re
import time
from typing import Any, Callable

import client_care_sweeps as CCS
import gsjs
import hubdb
import locations as L
import mail_designs as MD
import mail_server as MB
import scope as sc
import studio as ST
from scope import Defer

APP_ID = "members"
TAB = "platform_members"
HEADER = ("member_id", "owner_user_id", "member_user_id", "member_email", "status", "added_at", "added_by",
          "removed_at", "scope", "authorized_at", "authorized_by", "scope_by")
SCOPES = ("work", "work_world")
LIMIT = 5
# AlertsConfig.gs MYWORK_WORLD_KEY / MYWORK_WORLD_SEEN_KEY
WORLD_KEY = "mywork_hide_world"
WORLD_SEEN_KEY = "mywork_hide_world_seen"
# HubCore.gs hubDenied_
DENIED = {"status": 403, "message": "Requires an admin or manager account"}
NOT_FOUND = {"status": 404, "message": "Not found."}
NO_EMAIL = {"status": 400, "message": "An e-mail address is required."}
NO_ACCOUNT = "No account with that e-mail exists yet — send them an invite to register first."
DEACTIVATED = "That account is deactivated."
NEVER_SIGNED_IN = "That person has an account but has never signed in — once they log in they can be added."
# Members.gs and Tenant.gs HUB_POLICY: each door's declared roles (none: any session)
ROLES: dict[str, tuple[str, ...]] = {
    "platformMembersList": ("admin",), "platformMemberAsk": ("admin",), "platformMemberAuthorize": ("admin",),
    "platformMemberRemove": ("admin",), "platformMemberLeave": (), "platformMemberMine": (),
    "platformMemberCheck": ("admin",), "platformMemberSweep": ("admin",),
    "myWorldAccessList": ("admin", "manager", "staff", "client"),
    "myWorldAccessSet": ("admin", "manager", "staff", "client"), "tenantEnsure": ("admin",)}
# Main.gs HUB_CALLER_OWN_ACTIONS: during a visit these answer for the account holding the session
CALLER_OWN = frozenset(ROLES) - {"tenantEnsure"}
# Members.gs HUB_ROLE_RANK
ROLE_RANK = {"admin": 4, "manager": 3, "staff": 2, "onboarding": 1, "client": 1}
# the letter's situation (smart_comms.SEEDS) and rpcCall_'s reason for it
SITUATION = "platform_member_ask"
REASON = "platform member authorization"
INBOX_LIMIT = 50
REPLY_REQUEST = "ai_member_reply"
REPLY_TEMPERATURE = 0.1
REPLY_DEADLINE_S = 90.0
_FLAT_NO = re.compile(r"\bSTOP\b|\bNO\b|\bNAO\b|\bNÃO\b", re.ASCII)
_FLAT_EITHER = re.compile(r"\bBOTH\b|\bWORK\b", re.ASCII)
_FLAT_BOTH = re.compile(r"\bBOTH\b|\bAMBOS\b", re.ASCII)
_FLAT_WORK = re.compile(r"\bWORK\b|\bTRABALHO\b", re.ASCII)

s_ = gsjs.str_


# ---- the row and the people ---------------------------------------------------------------------------------------

def scope_of(row: dict | None) -> str:
    """memberScopeOf_: blank reads as work_world, the door born open."""
    return "work" if s_((row or {}).get("scope")).lower() == "work" else "work_world"


def scope_by_of(row: dict | None) -> str:
    """memberScopeByOf_."""
    return s_((row or {}).get("scopeby")).lower()


def world_locked_by_owner(row: dict | None) -> bool:
    """memberWorldLockedByOwner_: a door the person shut is not the owner's to re-open."""
    return scope_of(row) == "work" and scope_by_of(row) == "member"


def members_tab(reads: L.Reads) -> hubdb.Resolved:
    """membersSheet_'s book (hubTabWorkbook_), as the router names it; a book the copy does not hold is unreadable."""
    res = reads.db.resolve(TAB)
    if res.runtime:
        raise Defer("the platform members tab lives in the depot's facts")
    if res.ref is None and not res.book_known:
        raise hubdb.Unreadable("asa-hub-db holds no copy of the book behind the platform members tab")
    return res


def members_rows(reads: L.Reads) -> list[dict]:
    """membersRows_: readTabNormalized_ of the tab, Python's kept edits laid; a tab not made yet holds nobody."""
    return [dict(r) for r in reads.once("members:rows", lambda: reads.db.normalized_rows(members_tab(reads).ref))]


def members_of(reads: L.Reads, owner_uid: str) -> list[dict]:
    """membersOf_: the owner's rows not removed."""
    return [m for m in members_rows(reads)
            if s_(m.get("owneruserid")) == s_(owner_uid) and s_(m.get("status")) != "removed"]


def users_by_id(reads: L.Reads) -> dict[str, dict]:
    """usersAll_ keyed by user_id, the last row of an id kept (as the .gs's forEach assigns)."""
    out: dict[str, dict] = {}
    for u in reads.users():
        out[s_(u.get("userid"))] = u
    return out


def master_row(row: dict | None) -> bool:
    """hubIsMasterRow_: the master account is never a row in a list of users."""
    return bool(row) and sc.is_master_email(s_((row or {}).get("email")))


def eligible(u: dict | None) -> tuple[bool, str]:
    """memberEligible_: only an account that already signed in on its own may be invited."""
    if not u:
        return False, NO_ACCOUNT
    if s_(u.get("active")).lower() == "false":
        return False, DEACTIVATED
    if not s_(u.get("lastlogin")):
        return False, NEVER_SIGNED_IN
    return True, ""


def tenant_user_visible(here: str, u: dict | None) -> bool:
    """tenantUserVisible_: everybody at headquarters; away, the master (present in every place) and the place's own."""
    if not here:
        return True
    if sc.is_master_email(s_((u or {}).get("email"))):
        return True
    return here in ST.tenant_ids_for_user((u or {}).get("hometenant"), (u or {}).get("tenants"))


def visible_by_email(reads: L.Reads, here: str, email: str) -> dict | None:
    """The first users row of this address, when this place may name it (a person of another place is nobody) and it
    is not the master's: no visit ever reaches the master's account, so its address is nobody's to invite."""
    for u in reads.users():
        if s_(u.get("email")).lower() != email:
            continue
        return u if tenant_user_visible(here, u) and not master_row(u) else None
    return None


def asked_email(payload: dict | None) -> str:
    """str_(payload.email).trim().toLowerCase()."""
    return gsjs.trim(s_((payload or {}).get("email"))).lower()


def owner_gate(user: dict | None) -> dict[str, Any] | None:
    """The owner's doors (Settings › Platform users): an admin, as Members.gs asks, and the master in its own session,
    as the section is the master's; anybody else hubDenied_."""
    u = user or {}
    if not u or u.get("is_service") or s_(u.get("role")) != "admin" or not sc.is_real_master(u):
        return dict(DENIED)
    return None


# ---- where the caller stands (Main.gs doPost: the tenant, then the member) ------------------------------------------

def tenant_context(reads: L.Reads, raw: Any, user: dict | None) -> dict[str, Any] | None:
    """tenantContext_ / tenantResolve_: None at headquarters, {tenant_id} where the caller stands, {error} (404, so
    probes cannot enumerate) where it may not; membership from the account, never the envelope."""
    u = user or {}
    if not u or u.get("is_service"):
        return None
    wanted, mine = s_(raw), s_(u.get("home_tenant"))
    if not wanted and not mine:
        return None
    rows = ST.tenants_rows(reads)
    home = ST.tenant_home_from(rows)
    master = sc.is_real_master(u)
    allowed = [s_(t.get("tenantid")) for t in rows if s_(t.get("status")) != "archived" and s_(t.get("tenantid"))] \
        if master else ST.tenant_ids_for_user(mine, ",".join(ST.user_tenants(reads, u)))
    if not wanted:
        wanted = "" if master else mine
    deny = {"error": dict(NOT_FOUND)}
    if not wanted or (home and wanted == home):
        if master or not allowed:
            return None
        return None if home in allowed else deny
    if wanted not in allowed:
        return deny
    return {"tenant_id": wanted}


def member_context(reads: L.Reads, raw: Any, user: dict | None) -> dict[str, Any] | None:
    """memberContext_ / memberResolve_: the person visited, on an active row the caller owns; every refusal a 404
    (a 403 admits the row exists), and never the master's account."""
    wanted = s_(raw)
    u = user or {}
    if not wanted or not u or u.get("is_service"):
        return None
    for m in members_rows(reads):
        if s_(m.get("memberid")) != wanted:
            continue
        if s_(m.get("status")) != "active" or s_(m.get("owneruserid")) != s_(u.get("id")):
            break
        row = next((x for x in reads.users() if s_(x.get("userid")) == s_(m.get("memberuserid"))), None)
        if row is None or master_row(row):
            break
        return {"member_id": wanted, "user_id": s_(row.get("userid")), "email": s_(row.get("email")),
                "name": s_(row.get("displayname")), "role": s_(row.get("role")) or "staff",
                "types": s_(row.get("types")), "scope": scope_of(m)}
    return {"error": dict(NOT_FOUND)}


def clamp_role(caller: Any, visited: Any) -> str:
    """memberClampRole_: a visit narrows, never widens — the weaker of the two roles."""
    return s_(visited) if ROLE_RANK.get(s_(visited).lower(), 0) <= ROLE_RANK.get(s_(caller).lower(), 0) else s_(caller)


def stand(sess: L.Session, action: str) -> tuple[dict[str, Any] | None, dict[str, Any]]:
    """doPost before the door: the place settled (its refusal), then the declared roles asked of whom the door answers
    for — (refusal, {actor, here, visit})."""
    user = sess.user or {}
    place = user.get("place") if isinstance(user.get("place"), dict) else {}
    reads = sess.reads
    t = tenant_context(reads, place.get("tenant"), user)
    if t and t.get("error"):
        return t["error"], {}
    here = t["tenant_id"] if t else ""
    actor, visit = user, None
    if s_(place.get("member")):
        visit = member_context(reads, place.get("member"), user)
        if visit and visit.get("error"):
            return visit["error"], {}
        if visit and action not in CALLER_OWN:
            actor = {"id": visit["user_id"], "email": visit["email"], "display_name": visit["name"],
                     "role": clamp_role(user.get("role"), visit["role"]), "home_tenant": user.get("home_tenant"),
                     "types": [], "client_key": "", "app_denials": [], "is_service": False,
                     "visiting_member": visit["member_id"]}
    roles = ROLES.get(action) or ()
    if roles and not actor.get("is_service") and gsjs.js_str(actor.get("role")) not in roles:
        return {"status": 403, "message": "This action is for " + " or ".join(roles) + "."}, {}
    return None, {"actor": actor, "here": here, "visit": visit}


# ---- the worlds (World.gs, AlertsConfig.gs) ----------------------------------------------------------------------

def _cfg_on(v: Any) -> bool:
    """hubCfgOn_."""
    return gsjs.trim(gsjs.or_blank(v)).lower() in ("on", "true", "1", "yes")


def world_withheld(reads: L.Reads, user: dict | None) -> bool:
    """worldWithheld_ (hubMyWorldHiddenFor_): My World kept from this caller — never the service or the master in its
    own session, nobody while the switch is off, never an account on its seen list; FAIL-OPEN."""
    try:
        u = user or {}
        if u.get("is_service") is True or sc.is_real_master(u):
            return False
        if not u:
            return False
        if not u.get("visiting_member") and gsjs.or_text(u.get("role")) == "admin" \
                and sc.is_master_email(u.get("email")):
            return False
        cfg = reads.config()
        if not _cfg_on(cfg.get(WORLD_KEY)):
            return False
        if u.get("visiting_member"):
            return True
        uid = gsjs.trim(gsjs.or_text(u.get("id")))
        return not (uid and uid in sc.list_cell(cfg.get(WORLD_SEEN_KEY)))
    except Exception:  # noqa: BLE001 - the .gs's own catch: unreadable keeps nothing from anybody
        return False


def world_ids(reads: L.Reads) -> dict[str, str] | None:
    """worldRows_ by owner: each owner's first world id; None when the registry cannot be read (no door, honestly)."""
    import world_store as WS  # noqa: PLC0415 - the store reaches back into the doors' modules
    try:
        out: dict[str, str] = {}
        for r in WS.registry_rows(reads):
            out.setdefault(r["owner_user_id"], r["world_id"])
        return out
    except Exception:  # noqa: BLE001 - the .gs's own catch around worldRows_
        return None


# ---- the reads ----------------------------------------------------------------------------------------------------

def members_list(sess: L.Session, payload: dict) -> dict[str, Any]:
    """platformMembersList: the caller's roster, the people who could be added, and each member's world while its door
    is open."""
    refused, ctx = stand(sess, "platformMembersList")
    if refused:
        return refused
    who = ctx["actor"]
    refused = owner_gate(who)
    if refused:
        return refused
    reads = sess.reads
    no_worlds = world_withheld(reads, who)
    me = s_(who.get("id"))
    mine = members_of(reads, me)
    by_id = users_by_id(reads)
    taken = {s_(m.get("memberuserid")) for m in mine}
    candidates = []
    for u in reads.users():
        uid = s_(u.get("userid"))
        if uid == me or uid in taken:
            continue
        if not tenant_user_visible(ctx["here"], u) or master_row(u) or not eligible(u)[0]:
            continue
        candidates.append({"user_id": uid, "email": s_(u.get("email")), "name": s_(u.get("displayname")),
                           "avatar": s_(u.get("avatar"))})
    candidates.sort(key=lambda c: c["email"])
    worlds = None
    members = []
    for m in mine:
        held = by_id.get(s_(m.get("memberuserid")))
        if master_row(held or {"email": m.get("memberemail")}):
            continue
        u = held or {}
        scope = scope_of(m)
        world_id = ""
        if not no_worlds and scope == "work_world":
            if worlds is None:
                worlds = world_ids(reads) or {}
            world_id = worlds.get(s_(m.get("memberuserid")), "")
        members.append({"member_id": s_(m.get("memberid")), "user_id": s_(m.get("memberuserid")),
                        "email": s_(m.get("memberemail")) or s_(u.get("email")), "name": s_(u.get("displayname")),
                        "avatar": s_(u.get("avatar")), "title": s_(u.get("title")), "added_at": s_(m.get("addedat")),
                        "role": s_(u.get("role")) or "staff", "types": sc.types_from_raw(u.get("types")),
                        "status": s_(m.get("status")) or "active", "scope": scope, "world_role": "owner",
                        "world_id": world_id})
    return {"status": 200, "data": {"limit": LIMIT, "used": len(mine), "candidates": candidates, "members": members}}


def member_mine(sess: L.Session, payload: dict) -> dict[str, Any]:
    """platformMemberMine: the platforms the caller stands on, each read as work alone while worlds are kept from
    them."""
    refused, ctx = stand(sess, "platformMemberMine")
    if refused:
        return refused
    user = ctx["actor"]
    if not user or user.get("is_service"):
        return dict(DENIED)
    reads = sess.reads
    me = s_(user.get("id"))
    no_worlds = world_withheld(reads, user)
    by_id = users_by_id(reads)
    out = []
    for r in members_rows(reads):
        if s_(r.get("memberuserid")) != me or s_(r.get("status")) != "active":
            continue
        o = by_id.get(s_(r.get("owneruserid"))) or {}
        out.append({"member_id": s_(r.get("memberid")), "owner_name": s_(o.get("displayname")) or s_(o.get("email")),
                    "owner_email": s_(o.get("email")), "owner_avatar": s_(o.get("avatar")),
                    "added_at": s_(r.get("addedat")), "scope": "work" if no_worlds else scope_of(r)})
    return {"status": 200, "data": {"platforms": out}}


def member_check(sess: L.Session, payload: dict) -> dict[str, Any]:
    """platformMemberCheck: can this address be invited — somebody of another place is somebody never heard of."""
    refused, ctx = stand(sess, "platformMemberCheck")
    if refused:
        return refused
    refused = owner_gate(ctx["actor"])
    if refused:
        return refused
    email = asked_email(payload)
    if not email:
        return dict(NO_EMAIL)
    row = visible_by_email(sess.reads, ctx["here"], email)
    ok, why = eligible(row)
    return {"status": 200, "data": {"eligible": ok, "reason": why, "name": s_(row.get("displayname")) if row else "",
                                    "avatar": s_(row.get("avatar")) if row else ""}}


def world_access_list(sess: L.Session, payload: dict) -> dict[str, Any]:
    """myWorldAccessList: who can reach the caller's world, and whether the answer on file is the caller's own."""
    refused, ctx = stand(sess, "myWorldAccessList")
    if refused:
        return refused
    user = ctx["actor"]
    if not user or user.get("is_service"):
        return dict(DENIED)
    reads = sess.reads
    if world_withheld(reads, user):
        return {"status": 200, "data": {"rows": []}}
    me = s_(user.get("id"))
    by_id = users_by_id(reads)
    rows = []
    for m in members_rows(reads):
        if s_(m.get("memberuserid")) != me or s_(m.get("status")) == "removed":
            continue
        owner = by_id.get(s_(m.get("owneruserid"))) or {}
        rows.append({"member_id": s_(m.get("memberid")),
                     "owner_name": s_(owner.get("displayname")) or s_(owner.get("email")),
                     "owner_email": s_(owner.get("email")), "status": s_(m.get("status")) or "active",
                     "world_open": scope_of(m) == "work_world",
                     "closed_by_me": scope_by_of(m) == "member" and scope_of(m) == "work"})
    return {"status": 200, "data": {"rows": rows}}


# ---- the letter (MailTemplates.gs) ---------------------------------------------------------------------------------

def auth_email(o: dict | None) -> dict[str, str]:
    """memberAuthEmail_: the letter asking a person to share their account, read-only, answered WORK, BOTH or NO."""
    opts = o or {}
    name = gsjs.trim(gsjs.or_text(opts.get("name")))
    owner = gsjs.trim(gsjs.or_text(opts.get("ownerName"))) or "The platform owner"
    greeting = "Hi " + name + "," if name else "Hello,"
    blocks = [
        MD.mail_para(MD.mail_esc(greeting) + " " + MD.mail_esc(owner) + " is asking to bring your account into their "
                     "workspace on the ASA platform, temporarily."),
        MD.mail_para("Nothing happens until you answer. <strong>Reply to this e-mail with one word:</strong>"),
        MD.mail_fact("WORK", "they see the work registered under your name — your cards, notes and activity", False),
        MD.mail_fact("BOTH", "your work AND your My world workbook", False),
        MD.mail_fact("NO", "nothing is shared, and the request is closed", False),
        MD.mail_para("Whatever you choose, it is <strong>read-only</strong>: nobody writes anything in your name, "
                     "your password is never shared, and you can end it at any time by replying STOP."),
        MD.mail_para("If you do not answer, nothing is shared."),
    ]
    return {"subject": owner + " is asking to bring your account into their workspace",
            "html": MD.mail_shell({"title": "A request to join your account",
                                   "preheader": "Reply WORK, BOTH or NO — nothing happens until you answer.",
                                   "blocks": blocks}),
            "text": greeting + " " + owner + " is asking to bring your account into their workspace on the ASA "
                    "platform, temporarily.\n\nReply to this e-mail with one word:\n"
                    "  WORK — they see the work registered under your name (cards, notes, activity)\n"
                    "  BOTH — your work AND your My world workbook\n"
                    "  NO   — nothing is shared\n\n"
                    "Whatever you choose it is READ-ONLY: nobody writes in your name, your password is never shared, "
                    "and you can end it any time by replying STOP.\n\nIf you do not answer, nothing is shared.",
            "greeting": greeting, "owner": owner}


# ---- the reply sweep's reading (memberAuthSweepRun_ up to its verdicts) -----------------------------------------

def reply_address(raw: Any) -> str:
    """memberReplyAddress_: the sender's own address, the brackets first and only then the comma."""
    v = gsjs.trim(gsjs.or_blank(raw).lower())
    m = re.search(r"<([^>]*)>", v)
    v = m.group(1) if m else v.split(",")[0]
    return gsjs.trim(re.sub(r"[\s\"']+$", "", re.sub(r"^[\s\"']+", "", v)))


def read_reply(reads: L.Reads, thread: dict, deadline: float) -> str:
    """memberAuthReadReply_: the plain words first, then one model read; '' when the message does not clearly say."""
    text = ("SUBJECT: " + s_(thread.get("subject")) + "\n" + s_(thread.get("snippet")))[:1200]
    flat = text.upper()
    if _FLAT_NO.search(flat) and not _FLAT_EITHER.search(flat):
        return "no"
    if _FLAT_BOTH.search(flat):
        return "work_world"
    if _FLAT_WORK.search(flat):
        return "work"
    ask = ("Somebody was asked to authorize temporarily sharing their account with a colleague. "
           "They could answer WORK (their work only), BOTH (work and their personal world), or NO.\n\n"
           "MESSAGE:\n" + text + "\n\n"
           "Which did they answer? If the message does not clearly say, answer none.\n"
           'Reply with JSON only: {"answer":"work"|"work_world"|"no"|"none"}')
    try:
        res = CCS.ai_chat(reads, ask, REPLY_TEMPERATURE, REPLY_REQUEST, deadline)
    except Exception:  # noqa: BLE001 - the .gs's own catch: no verdict
        return ""
    if not res or not res.get("ok"):
        return ""
    try:
        parsed = json.loads(s_(res.get("content")))
    except ValueError:
        parsed = None
    a = s_(parsed.get("answer")) if isinstance(parsed, dict) else ""
    return a if a in ("work", "work_world", "no") else ""


def sweep_gate(sess: L.Session) -> tuple[dict[str, Any] | None, dict[str, Any]]:
    """platformMemberSweep's door: a person sweeps what they asked for, the master in its own session."""
    refused, ctx = stand(sess, "platformMemberSweep")
    if refused:
        return refused, ctx
    user = ctx["actor"]
    if not user:
        return dict(DENIED), ctx
    return (None if user.get("is_service") else owner_gate(user)), ctx


def sweep_prepare(sess: L.Session, payload: dict) -> dict[str, Any]:
    """platformMemberSweep's reading, outside the write lock (BACKEND_WRITE_PREPARE): the caller's pending rows, the
    mailbox read once, each reply from the very address asked read for its word — {read, verdicts} or {why}."""
    refused, ctx = sweep_gate(sess)
    if refused:
        return refused
    user = ctx["actor"]
    owner = "" if user.get("is_service") else s_(user.get("id"))
    pending = [m for m in members_rows(sess.reads) if s_(m.get("status")) == "pending"
               and (not owner or s_(m.get("owneruserid")) == owner)]
    if not pending:
        return {"status": 200, "data": {"read": 0, "verdicts": []}}
    box = MB.creds(None)
    threads = None
    if box is not None:
        try:
            threads = MB.inbox(box["user"], box["password"], INBOX_LIMIT).get("threads") or []
        except Exception:  # noqa: BLE001 - the class of the failure is the mailbox's, said below
            threads = None
    if threads is None:
        return {"status": 200, "data": {"read": 0, "verdicts": [], "why": "the mailbox could not be read"}}
    by_email: dict[str, dict] = {}
    for m in pending:
        by_email[s_(m.get("memberemail")).lower()] = m
    deadline = time.monotonic() + REPLY_DEADLINE_S
    read, verdicts = 0, []
    for th in threads:
        frm = reply_address((th or {}).get("from_addr"))
        hit = by_email.get(frm) if frm else None
        if hit is None:
            continue
        read += 1
        verdict = read_reply(sess.reads, th, deadline)
        if not verdict:
            continue
        verdicts.append({"member_id": s_(hit.get("memberid")), "verdict": verdict})
        by_email.pop(s_(hit.get("memberemail")).lower(), None)
    return {"status": 200, "data": {"read": read, "verdicts": verdicts}}


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {
    "platformMembersList": members_list, "platformMemberMine": member_mine, "platformMemberCheck": member_check,
    "myWorldAccessList": world_access_list, "platformMemberSweepPrepare": sweep_prepare}
# main.policy_gate asks nothing: each door settles the place first and asks its declared roles then (stand)
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
