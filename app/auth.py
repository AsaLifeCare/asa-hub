"""The sign-in's rules (apps-script/Auth.gs, PasswordReset.gs, Invites.gs) with no store and no network: the password
hash, the tokens, which account an address signs in, the lanes, every refusal in its own words, and the account as
authLogin and authMe hand it to the session (userPublic_ and what the two doors add). The doors are app/auth_doors.py,
the tables app/auth_store.py (db/auth.sql)."""
from __future__ import annotations

import base64
import hashlib
import hmac
import re
import secrets
from typing import Any

import account_profile as AP
import alerts_config as AC
import app_control as ACL
import gsjs
import locations as L
import scope as sc
import staff as SP

# The one master signs in through Apps Script while this holds: a master's row, a master's session and any token this
# store never minted are handed back to it. False, the master signs in here like everyone else.
MASTER_SIGN_IN_ON_APPS_SCRIPT = False

# Main.gs SESSION_DAYS; Auth.gs slides a session at most once a day
SESSION_DAYS = 30
SLIDE_S = 86400
# a session minted here; an Apps Script one keeps its 48 hex characters
TOKEN_PREFIX = "py."
TOKEN_RE = re.compile(r"^py\.[0-9a-f]{64}$")
# Auth.gs authLogin: 8 failures per identifier, the count kept 15 minutes past the last one
LOGIN_FAIL_MAX = 8
LOGIN_FAIL_TTL_S = 900
HASH_ROUNDS = 5000
# Auth.gs TEMP_PASSWORD_ALPHABET / TEMP_PASSWORD_LENGTH: no 0/O/o, no 1/I/l/i
TEMP_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789"
TEMP_LENGTH = 12
# Auth.gs ROLE_LANE / LANE_ROLES: empty, so every role signs in through the normal form
ROLE_LANE: dict[str, str] = {}
LANE_ROLES: dict[str, list[str]] = {}

REQUIRED = {"status": 400, "message": "Email and password are required."}
TOO_MANY = {"status": 429, "message": "Too many attempts — try again in a few minutes."}
INVALID = {"status": 401, "message": "Invalid credentials"}
BLOCKED = {"status": 423, "code": "account_blocked", "message": "This account is blocked. Contact asa-hub@asaop.org."}
AUTH_REQUIRED = {"status": 401, "message": "Authentication required."}
SETUP_DONE = {"status": 409, "message": "Setup already completed — sign in instead."}
SETUP_WANTS = {"status": 400, "message": "Name, a valid email and a password of at least 8 characters are required."}

# Settings > My Work's switches the two doors hand every session (AlertsConfig.gs)
STAMPS_KEY = "mywork_hide_ssa_updated"
RECORD_NOTES_KEY = "mywork_hide_record_notes"
# Settings › My Work's Clients switch: a client's Activity tab without its three figures and its Action column
CLIENT_ACTIVITY_KEY = "mywork_hide_client_activity"
# Settings › My Work's Clients switch: a client's Client details without the titles over its groups
CLIENT_GROUP_TITLES_KEY = "mywork_hide_client_group_titles"
# Settings › My Work's Staff switch: a person's Documents without the line counting them
STAFF_DOC_COUNTS_KEY = "mywork_hide_staff_doc_counts"
# Settings › My Work's Families & Guardians switch: the details' source lines, counts, side pencils and edit notices
FAMILY_DETAILS_KEY = "mywork_hide_family_details"
WORLD_KEY, WORLD_SEEN_KEY = "mywork_hide_world", "mywork_hide_world_seen"
MYASA_KEY, MYASA_SEEN_KEY = "mywork_hide_myasa", "mywork_hide_myasa_seen"
YES = ("yes", "on", "true", "1")

s_ = gsjs.str_


def _utf8(s: str) -> bytes:
    """Utilities.Charset.UTF_8: a lone surrogate is written as '?'."""
    return s.encode("utf-8", errors="replace")


def sha256_hex(s: str) -> str:
    """sha256Hex_."""
    return hashlib.sha256(_utf8(s)).hexdigest()


def hash_password(password: str, salt: str) -> str:
    """hashPassword_: salt + ':' + password, then sha256 hex of (h + salt) 5000 times."""
    h = f"{salt}:{password}"
    for _ in range(HASH_ROUNDS):
        h = hashlib.sha256(_utf8(h + salt)).hexdigest()
    return h


def same(a: Any, b: Any) -> bool:
    """resetHashMatches_: equal and non-empty, compared in constant time."""
    x, y = str(a or ""), str(b or "")
    return bool(x) and len(x) == len(y) and hmac.compare_digest(_utf8(x), _utf8(y))


def random_hex(n: int) -> str:
    """randomHex_."""
    return secrets.token_hex((n + 1) // 2)[:n]


def temp_password(n: int = TEMP_LENGTH) -> str:
    """tempPassword_: a fresh random password, every character equally likely."""
    return "".join(secrets.choice(TEMP_ALPHABET) for _ in range(max(10, n or TEMP_LENGTH)))


def mint_token() -> str:
    return TOKEN_PREFIX + secrets.token_hex(32)


def token_hash(token: Any) -> str:
    """The session's key: sha256Hex_(String(token)), as the Sessions tab keys it."""
    return sha256_hex(gsjs.or_blank(token))


def ident_hash(ident: str) -> str:
    """The counters' key ('lf_' + sha256Hex_(identifier))."""
    return sha256_hex(ident)


def parse_extras(raw: Any) -> list[str]:
    """profileParseEmails_, each entry trimmed and lower-cased as userByEmail_ compares it."""
    return [s_(e).lower() for e in AP.parse_emails(raw if isinstance(raw, list) else s_(raw))]


def user_by_email(rows: list[dict], email: Any) -> dict | None:
    """userByEmail_: the first live row whose own address it is; else the one row whose extra addresses hold it —
    an address two accounts hold signs in neither."""
    needle = gsjs.trim(gsjs.or_text(email)).lower()
    if not needle:
        return None
    for u in rows:
        if s_(u.get("mergedinto")):
            continue
        if s_(u.get("email")).lower() == needle:
            return u
    hit, hits = None, 0
    for u in rows:
        if s_(u.get("mergedinto")):
            continue
        if needle in parse_extras(u.get("emails")):
            hit, hits = u, hits + 1
    return hit if hits == 1 else None


def user_by_id(rows: list[dict], uid: str) -> dict | None:
    """sessionUser_'s lookup: the first row with this user_id."""
    return next((u for u in rows if s_(u.get("userid")) == uid), None)


def inactive(u: dict) -> bool:
    return s_(u.get("active")).lower() == "false"


def lane_check(role: Any, lane: Any) -> dict | None:
    """authLaneCheck_: None when the sign-in is allowed, otherwise the refusal."""
    role = gsjs.or_text(role) or "staff"
    lane = gsjs.or_text(lane)
    required = ROLE_LANE.get(role)
    if required and lane != required:
        return {"status": 403, "message": f"This account signs in through the {required.upper()} link at the bottom "
                                          "of the page."}
    if lane and lane in LANE_ROLES and role not in LANE_ROLES[lane]:
        return {"status": 403, "message": f"That link is for the {lane} account — use the normal form."}
    return None


def master_row(u: dict | None) -> bool:
    """hubIsMasterRow_."""
    return bool(u) and sc.is_master_email(s_(u.get("email")))


def handed_back(u: dict | None, ident: Any = "") -> bool:
    """The master's sign-in while it stays on Apps Script: by the row, and by the typed address."""
    return MASTER_SIGN_IN_ON_APPS_SCRIPT and (master_row(u) or sc.is_master_email(ident))


# ---- the account as the session is handed it ----------------------------------------------------------------------

def _hide_default(reads: L.Reads, key: str) -> str:
    """hubMyWorkHideDefaults_: the catalogue's value; the shipped one when the catalogue cannot answer."""
    try:
        rows = AC.catalog_rows(reads)
    except Exception:  # noqa: BLE001 - the shipped copy, as Apps Script falls back to it
        rows = list(AC.SHIPPED)
    for d in rows or ():
        if d and gsjs.or_blank(d.get("key")) == key:
            return gsjs.or_blank(d.get("value"))
    return ""


def hide_on(reads: L.Reads, key: str) -> bool:
    """hubStampsHidden_ / hubRecordNotesHidden_ (FAIL-CLOSED): a switch that cannot be read hides."""
    try:
        cfg = reads.config()
        raw = cfg[key] if key in cfg else _hide_default(reads, key)
        return gsjs.trim(gsjs.or_blank(raw)).lower() in YES
    except Exception:  # noqa: BLE001 - as `!== false` over a read that threw
        return True


def _list_cell(raw: Any) -> list[str]:
    out: list[str] = []
    for x in re.split(r"[,;\s]+", gsjs.or_blank(raw)):
        i = gsjs.trim(x)[:80]
        if i and i not in out:
            out.append(i)
    return out


def kept_from(reads: L.Reads, user: dict, key: str, seen_key: str) -> bool:
    """hubMyWorldHiddenFor_ / hubMyAsaHiddenFor_ for a session at home (FAIL-OPEN)."""
    try:
        if user.get("is_service") is True or sc.is_real_master(user):
            return False
        if gsjs.or_text(user.get("role")) == "admin" and sc.is_master_email(user.get("email")):
            return False
        cfg = reads.config()
        if gsjs.trim(gsjs.or_blank(cfg.get(key))).lower() not in YES:
            return False
        uid = gsjs.trim(gsjs.or_text(user.get("id")))
        return not (uid and uid in _list_cell(cfg.get(seen_key)))
    except Exception:  # noqa: BLE001 - as Apps Script: a switch that cannot be read keeps nothing from anyone
        return False


def session_user(reads: L.Reads, u: dict, must_change: bool) -> dict[str, Any]:
    """userPublic_ and what authLogin and authMe add to it: the badges the calendar gives, the two My Work switches,
    My world and My asa., and App Control shared with the account; the master's own flags from its row alone."""
    me = AP.public(reads, u)
    me["is_master"] = sc.is_master_email(me.get("email"))
    me["must_change_password"] = bool(must_change)
    me["derived_types"] = SP.calendar_badges(reads, me)
    me["stamps_hidden"] = hide_on(reads, STAMPS_KEY)
    me["record_notes_hidden"] = hide_on(reads, RECORD_NOTES_KEY)
    me["client_activity_hidden"] = hide_on(reads, CLIENT_ACTIVITY_KEY)
    me["client_group_titles_hidden"] = hide_on(reads, CLIENT_GROUP_TITLES_KEY)
    me["staff_doc_counts_hidden"] = hide_on(reads, STAFF_DOC_COUNTS_KEY)
    me["family_details_hidden"] = hide_on(reads, FAMILY_DETAILS_KEY)
    me["my_world"] = not kept_from(reads, me, WORLD_KEY, WORLD_SEEN_KEY)
    me["my_asa"] = not kept_from(reads, me, MYASA_KEY, MYASA_SEEN_KEY)
    # the apps an edition opens to this person by name (Settings › Editions), on top of their badge (app/editions.py)
    import editions as ED  # noqa: PLC0415
    try:
        me["edition_apps"] = ED.opened_apps(me, reads.config())
    except Exception:  # noqa: BLE001 - FAIL-CLOSED: a config that cannot be read opens no extra app
        me["edition_apps"] = []
    grant = ACL.delegate_for(reads, me)
    if grant:
        me["app_control"] = {"apps": list(grant["apps"]), "may_change": grant["may_change"] is True}
    return me


# ---- the letters a reset and an invitation send -------------------------------------------------------------------

def fill(text: Any, vars_: dict[str, Any]) -> str:
    """resetFill_: each {name} replaced by its value."""
    out = gsjs.or_blank(text)
    for k, v in vars_.items():
        out = out.replace("{" + k + "}", str(v))
    return out


def letter_html(text: str, link: str) -> str:
    """resetLetterHtml_: paragraphs, and the link as a link."""
    def esc(s: Any) -> str:
        return gsjs.or_blank(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")
    href = esc(link)
    out = []
    for para in re.split(r"\n{2,}", gsjs.or_blank(text)):
        inner = esc(para).replace("\n", "<br>")
        if href and href in inner:
            inner = inner.replace(href, f'<a href="{href}">{href}</a>')
        out.append(f"<p>{inner}</p>")
    return "".join(out)


def b64url(data: bytes) -> str:
    """Utilities.base64EncodeWebSafe without its padding."""
    return base64.urlsafe_b64encode(data).decode().rstrip("=")


def invite_sig(secret: str, invite_id: str) -> str:
    """inviteSig_: HMAC-SHA256 of the id under INTERVIEW_LINK_SECRET; '' without a secret."""
    if not secret:
        return ""
    return b64url(hmac.new(_utf8(secret), _utf8(invite_id), hashlib.sha256).digest())


def invite_token(secret: str, invite_id: str) -> str:
    sig = invite_sig(secret, invite_id)
    return f"{invite_id}.{sig}" if sig else ""


def invite_id_of(secret: str, token: Any) -> str:
    """inviteByToken_'s check: the id when the token is one this platform signed, else ''."""
    raw = s_(token)
    if not raw or "." not in raw:
        return ""
    parts = raw.split(".")
    iid, sig = parts[0], parts[1]
    if not re.fullmatch(r"inv_[A-Za-z0-9]{8,}", iid):
        return ""
    expect = invite_sig(secret, iid)
    return iid if expect and same(expect, sig) else ""
