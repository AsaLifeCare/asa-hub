"""My Profile's own address (apps-script/StaffProfiles.gs staffProfileAddress, staffProfileAddressEdit) decided off
asa-hub-db: the read laid with the kept edits, the save kept in app.edits on the Employee Database Master row, final."""
from __future__ import annotations

from typing import Any, Callable

import client_writes as CW
import gsjs
import locations as L
import staff as SP
import staff_writes as SW
import writes as W
from scope import Defer
from writes import Decision

APP_ID = "my-profile"
APP_NAME = "My Profile"
ADDRESS_WORDS = SW.ADDRESS_WORDS
WORDS = "The address on the Employee Database Master, kept in the Hub's database."
CACHES = "My Profile reads it from Postgres at once; the relay read this person again."
# the refusals that rest on the field or the value alone, never on a record
_STATIC = frozenset(ADDRESS_WORDS.values()) | SW._STATIC
_ROLES = ("admin", "director", "manager", "staff")


def address_read(sess: L.Session, payload: dict) -> dict[str, Any]:
    """staffProfileAddress: the caller's own address; another person's read is audited, which Apps Script keeps."""
    who = SP.address_subject(sess, payload)
    if who.get("refused"):
        if who["refused"].get("status") == 503:
            raise Defer(str(who["refused"].get("message") or "the staff sources could not be read")[:160])
        return who["refused"]
    if not who["own"]:
        raise Defer("a read of another person's address is written to the audit history, which Apps Script keeps")
    return {"status": 200, "data": SP._shown(SP.scrub(SP.address_answer(who["ctx"], True)))}


def address_edit(sess: L.Session, payload: dict) -> Decision:
    """staffProfileAddressEdit: street, city, state and zip, each against the raw cell the panel opened on."""
    who = SP.address_subject(sess, payload)
    if who.get("refused"):
        return SW.refused(who["refused"])
    ctx = who["ctx"]
    changes, bad = W.edit_changes(payload)
    if bad:
        return Decision(bad)
    out: list[dict] = []
    stale: dict[str, str] = {}
    written: list[dict] = []
    edits: list[dict] = []
    tgt: dict[str, Any] | None = None
    live_all = ctx.get("master_edit") or {}
    for c in changes:
        f = c["field"]
        if f not in SP.ADDRESS_FIELDS:
            out.append({"field": f, "why": ADDRESS_WORDS["only"]})
            continue
        value = c["value"].upper() if f == "state" else c["value"]
        why = SW.address_bad(f, value) or SP.edit_refusal(ctx, f)
        if why:
            if SW.unread(why, ctx):
                raise Defer("a source this refusal names could not be read here")
            out.append({"field": f, "why": why})
            continue
        if tgt is None:
            tgt = SW.master_target(sess.reads, ctx)
        if tgt.get("why"):
            out.append({"field": f, "why": tgt["why"]})
            continue
        if f in (ctx.get("_unsure") or ()):
            raise Defer("the copy folds this Employee Database Master column with its scorecard twin")
        live = live_all.get(f, "")
        SW.marked(live)
        now = CW.witness(c["expected"], live)
        if now is not None:
            stale[f] = now
            continue
        head = gsjs.trim(gsjs.js_str(ctx["master_cols"][f]["head"]))
        edits.append(W.kept_record(tgt["sid"], tgt["tab"], "edit", tgt["match"], tgt["key"], ctx["key"],
                                   {head: value}, {head: live}))
        written.append({"field": f, "before": c["expected"], "after": value})
    answer = W.edit_answer(written, out, stale, W.pg_steps(WORDS, CACHES, APP_ID))
    answer["data"]["staff_key"] = ctx["key"]
    if edits:
        return W.final(answer, edits, ctx["key"])
    return Decision(answer, fresh=bool(stale) or any(r["why"] not in _STATIC for r in out))


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {"staffProfileAddressEdit": address_edit}
# HUB_POLICY: the roles each write is declared for, and its typed params
POLICY: dict[str, dict[str, Any]] = {
    "staffProfileAddressEdit": {"roles": _ROLES, "params": {"key": "string", "changes": "array"}}}
# the read the address panel opens on: answered by the read module's door (main.APPS), never under the write lock
READS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {"staffProfileAddress": address_read}
READ_POLICY: dict[str, dict[str, Any]] = {"staffProfileAddress": {"roles": _ROLES, "params": {"key": "string"}}}
# the platform's write lock held by another write: Python's own sentence, never a hand-off
BUSY_OF: dict[str, dict[str, Any]] = {a: {"status": 409, "message": W.BUSY} for a in ACTIONS}


class Store(W.Store):
    """app.my_profile_writes and app.my_profile_receipts, beside the other apps' own."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="my_profile", label=APP_NAME)
