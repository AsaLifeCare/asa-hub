"""usersPhoneBackfill (apps-script/HubCore.gs usersPhoneFill_) on Python behind its own switch (`users-phone-fill`):
Settings › Contact sync's Fill phones — each account whose phone cell is blank given the phone of the one roster row
with exactly its name, else of the candidate row with its sign-in e-mail, at most a hundred a press. Only the users
tab's `phone` column is written, a blank cell alone, each as an app.edits kept record (as Staff's account phones are);
the sign-in matches on the e-mails and the password, never on it. Quo Enrich (it adds the e-mails the sign-in matches
on, off the phone provider's API) and the contact clock's trigger stay Apps Script's."""
from __future__ import annotations

import logging
from typing import Any, Callable

import candidates as CND
import gsjs
import hubdb
import locations as L
import writes as W
from scope import Defer
from writes import Decision

log = logging.getLogger("asa-hub-app")

APP_ID = "users-phone-fill"
USERS_TAB = "users"
CAP = 100
DENIED = {"status": 403, "message": "Requires an admin or manager account"}
SUBJECT = "users"

str_ = gsjs.str_


def roster_phones(reads: L.Reads) -> dict[str, dict[str, Any]]:
    """The roster by exact name key — a key seen twice is ambiguous and skipped; none when it cannot be read."""
    out: dict[str, dict[str, Any]] = {}
    try:
        for p in reads.hub_rows("people"):
            k = gsjs.name_key(str_(p.get("name")))
            if not k:
                continue
            out[k] = {"ambiguous": True} if k in out else {"phone": str_(p.get("phone"))}
    except (hubdb.Unreadable, Defer):
        raise
    except Exception:  # noqa: BLE001 - usersPhoneFill_ reads a roster it cannot read as none
        return {}
    return out


def candidate_phones(reads: L.Reads) -> dict[str, str]:
    """The candidates' phones by e-mail; none when the tab cannot be read."""
    out: dict[str, str] = {}
    try:
        for c in CND.read_tab(reads, CND.TALENT_CANDIDATES_TAB):
            em = str_(c.get("email")).lower()
            if em and str_(c.get("phone")):
                out[em] = str_(c.get("phone"))
    except (hubdb.Unreadable, Defer):
        raise
    except Exception:  # noqa: BLE001 - usersPhoneFill_ reads a tab it cannot read as none
        return {}
    return out


def phone_fill(reads: L.Reads, cap: int) -> tuple[dict[str, Any], list[dict]]:
    """usersPhoneFill_: the blanks filled, at most `cap`; a number somebody typed is never overwritten."""
    res = W.tab_of(reads, USERS_TAB)
    if res.ref is None:
        raise Defer("the users tab holds no rows in the copy")
    raw_heads = list(res.ref.headers)
    hdr = [hubdb.norm_key(h) for h in raw_heads]

    def at(name: str) -> int:
        return hdr.index(name) if name in hdr else -1

    i_name, i_phone, i_email, i_uid = at("displayname"), at("phone"), at("email"), at("userid")
    if i_phone == -1:
        return {"filled": 0, "examined": 0, "reason": "users tab has no phone column"}, []
    roster = roster_phones(reads)
    by_email = candidate_phones(reads)
    rows = reads.db.rows(res.ref)
    sid, tab = W.where_of(res)
    phone_head = gsjs.trim(gsjs.js_str(raw_heads[i_phone]))
    sets = [[raw_heads[i] for i in (i_uid,) if i != -1], [raw_heads[i] for i in (i_email,) if i != -1]]
    filled = 0
    edits: list[dict] = []

    def cell(raw: dict, i: int) -> Any:
        return hubdb.typed(raw.get(raw_heads[i]), "hub") if i != -1 else None

    for n, (_rn, raw) in enumerate(rows):
        if filled >= cap:
            break
        if str_(cell(raw, i_phone)):
            continue
        k2 = gsjs.name_key(str_(cell(raw, i_name)))
        hit = roster.get(k2) if k2 else None
        phone = str_(hit.get("phone")) if hit and not hit.get("ambiguous") and str_(hit.get("phone")) else ""
        if not phone and i_email != -1:
            phone = str_(by_email.get(str_(cell(raw, i_email)).lower()))
        if not phone:
            continue
        got = W.row_key_of(rows, n, sets)
        if got is None:
            # a row no key tells apart from another is never written by its position
            continue
        edits.append(W.kept_record(sid, tab, "edit", got[0], got[1], SUBJECT, {phone_head: phone},
                                   before={phone_head: ""}))
        filled += 1
    return {"filled": filled, "examined": len(rows)}, edits


def phone_backfill(sess: L.Session, payload: dict) -> Decision:
    """usersPhoneBackfill: a capped fill-blank pass; running it twice changes nothing."""
    user = sess.user or {}
    if not sess.user or user.get("is_service") or str_(user.get("role")) != "admin":
        return Decision(dict(DENIED))
    out, edits = phone_fill(sess.reads, CAP)
    log.info("usersPhoneBackfill: %s phone(s) filled from the roster/candidates", out["filled"])
    d = W.final({"status": 200, "data": out}, edits, SUBJECT)
    d.fresh = True
    return d


# Settings › Contact sync's Fill phones, the switch's one door
ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {"usersPhoneBackfill": phone_backfill}
# HUB_POLICY: HubCore.gs's roles; it takes no params
POLICY: dict[str, dict[str, Any]] = {"usersPhoneBackfill": {"roles": ("admin",)}}
BUSY_OF: dict[str, dict[str, Any]] = {a: {"status": 409, "message": W.BUSY} for a in ACTIONS}


class Store(W.Store):
    """app.users_phone_fill_writes and _receipts; the phone cells app.edits' over the users tab."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="users_phone_fill", label="Settings › Contact sync — Fill phones")
