"""SSA's writes (apps-script/SsaProfiles.gs) decided off asa-hub-db and kept in app.edits as the truth."""
from __future__ import annotations

from typing import Any, Callable

import client_writes as CW
import clients as C
import gsjs
import hubdb
import locations as L
import photos as P
import scope as sc
import ssa as S
import staff_comms as SC
import writes as W
from scope import Defer
from writes import Decision

APP_ID = S.APP_ID
UNKNOWN = "Unknown action."
CACHES = "SSA reads it from Postgres at once; the relay read the SSA and those clients again."
CACHES_OWN = "SSA reads it from Postgres at once; the relay read the SSA again."
OWN_WORDS = {"agency": "agency", "office_address": "office address"}
LIST_WORDS = {"documents": ("document", "Documents list"), "activity": ("entry", "Activity")}
WITHHELD = "It holds a number the platform withholds (an SSN or a card number), so it is not kept."


def refused(env: dict[str, Any], keyed: bool) -> Decision:
    """A door's refusal: what this side could not read is Apps Script's; one resting on the records is fresh."""
    if env.get("status") == 503:
        raise Defer(str(env.get("message") or "the client records could not be read")[:160])
    return Decision(env, fresh=keyed and env.get("message") != UNKNOWN)


def keyed(payload: dict) -> bool:
    return bool(S._KEY.fullmatch(gsjs.trim(gsjs.or_blank(payload.get("ssa")))))


def edition_of(sess: L.Session, edition: str) -> str:
    """The edition a person's write came in by; the master's names none."""
    return "" if sc.is_real_master(sess.user) else edition


def details_record(sess: L.Session, ctx: dict, cells: dict[str, str], edition: str) -> dict:
    """The SSA's own row on ssa_details: appended the first time, its changed cells after, with who and when."""
    reads = sess.reads
    W.gate(reads)
    res = W.tab_of(reads, S.DETAILS_TAB)
    rid = S.details_id(ctx["key"])
    row = S.details_all(reads).get(rid)
    stamp = {"by": W.who(sess.user), "at": W.now_iso(reads)}
    if row is None:
        rec = W.append_record(res, S.DETAILS_HEADER, {"id": rid, "ssa_key": ctx["key"], "ssa_name": ctx["name"],
                                                      **cells, **stamp}, ctx["key"])
    else:
        sid, tab = W.where_of(res)
        before = {f: gsjs.or_text(row.get(f)) for f in (*cells, *stamp)}
        rec = W.kept_record(sid, tab, "edit", "id", rid, ctx["key"], {**cells, **stamp}, before)
    if edition:
        rec["edition"] = edition
    return rec


def note_add(sess: L.Session, payload: dict) -> Decision:
    """ssaProfileNoteAdd: refused here, or the note (its id and time minted here) kept in app.edits."""
    shut = S.edit_door(sess, S.EDITION_NOTES)
    if shut:
        return Decision(shut)
    if not S.notes_open(sess):
        return Decision(S.unknown())
    reads = sess.reads
    ctx = S.ssa_ctx(reads, payload.get("ssa"))
    if ctx.get("refused"):
        return refused(ctx["refused"], keyed(payload))
    body = gsjs.trim(gsjs.or_text(payload.get("body")))
    if not body:
        return W.refuse(400, "body: what the note says.")
    if CW.utf16_len(body) > S.NOTE_MAX:
        return W.refuse(400, f"body: up to {S.NOTE_MAX} characters.")
    W.gate(reads)
    res = W.tab_of(reads, S.NOTES_TAB)
    note = {"id": W.mint("SSAN_"), "ssa_key": ctx["key"], "ssa_name": ctx["name"], "body": body,
            "by": W.who(sess.user), "at": W.now_iso(reads)}
    rec = W.append_record(res, S.NOTES_HEADER, note, ctx["key"])
    edition = edition_of(sess, S.EDITION_NOTES)
    if edition:
        rec["edition"] = edition
    answer = {"status": 200, "data": {"note": {k: note[k] for k in ("id", "at", "by", "body")}}}
    return W.final(answer, [rec], ctx["key"])


def edit(sess: L.Session, payload: dict) -> Decision:
    """ssaProfileEdit: per field refused or stale, or kept — phone and e-mail on the client records, the rest own."""
    shut = S.edit_door(sess)
    if shut:
        return Decision(shut)
    reads = sess.reads
    ctx = S.ssa_ctx(reads, payload.get("ssa"))
    if ctx.get("refused"):
        return refused(ctx["refused"], keyed(payload))
    changes, bad = W.edit_changes(payload)
    if bad:
        return Decision(bad)
    if ctx["degraded"]:
        raise Defer("not every client record could be read here")
    e = S.edit_of(reads, ctx)
    out: list[dict] = []
    stale: dict[str, str] = {}
    written: list[dict] = []
    fields: dict[str, str] = {}
    own: dict[str, str] = {}
    for c in changes:
        f = c["field"]
        if f not in e["raw"]:
            out.append({"field": f, "why": "Not a field this app edits."})
            continue
        if f in e["locked"]:
            out.append({"field": f, "why": e["locked"][f]["why"]})
            continue
        if C._marked(e["raw"][f]):
            raise Defer("the copy withholds a cell this field's witness rests on")
        now = CW.witness(c["expected"], e["raw"][f])
        if now is not None:
            stale[f] = now
            continue
        value = SC._js_slice(CW.fold_ws(c["value"]), 500)
        why = S.edit_check(f, value)
        if why:
            out.append({"field": f, "why": why})
            continue
        if f == "name" and S.key_of(value) != ctx["key"] and S.key_of(value) in (ctx["index"].get("ssas") or {}):
            out.append({"field": f, "why": "Another SSA already carries this name; nothing was renamed."})
            continue
        if f in S.EDIT_OWN:
            own[f] = value
        else:
            fields[S.EDIT_COLUMNS[f]] = value
        written.append({"field": f, "before": c["expected"], "after": value})
    edits: list[dict] = []
    failed: dict[str, str] = {}
    client_keys: list[str] = []
    names = {c["client_key"]: c["name"] for c in ctx["ssa"]["clients"]}
    field_of = {col: f for f, col in S.EDIT_COLUMNS.items()}
    edition = edition_of(sess, S.EDITION)
    for ck in (e["records"] if fields else []):
        def fail(cols: list[str], why: str, ck: str = ck) -> None:
            for col in cols:
                f = field_of.get(col, "")
                if f and f not in failed:
                    failed[f] = "Not saved on " + (names.get(ck) or ck) + "'s record: " + why

        cols = list(fields)
        checked = CW.save_fields(dict(fields))
        if checked.get("refused"):
            fail(cols, gsjs.or_text(checked["refused"].get("message")))
            continue
        cctx = CW.client_of(reads, ck)
        if cctx.get("refused") or cctx.get("archived"):
            fail(cols, gsjs.or_text(cctx["refused"].get("message")) if cctx.get("refused")
                 else "the client is in the archive of old clients.")
            continue
        got = CW.profile_write(sess, cctx, checked["fields"])
        if got.get("refused"):
            fail(cols, gsjs.or_text((got["refused"].answer or {}).get("message")))
            continue
        rec = dict(got["record"])
        rec["edition"] = edition
        edits.append(rec)
        client_keys.append(ck)
    renamed = next((w["after"] for w in written if w["field"] == "name" and "name" not in failed), "")
    new_key = S.key_of(renamed) if renamed else ctx["key"]
    if renamed and new_key != ctx["key"]:
        # the SSA's own rows follow the new name: its details, its notes and its entries' edits
        edits.extend(rekeyed(sess, ctx, new_key, renamed, own, edition))
        own = {}
    if own:
        edits.append(details_record(sess, ctx, own, edition))
    for w in [w for w in written if w["field"] in failed]:
        written.remove(w)
        out.append({"field": w["field"], "why": failed[w["field"]]})
    if not written:
        edits = []
        client_keys = []
        own = {}
    data: dict[str, Any] = {"written": [w["field"] for w in written], "refused": out,
                            "ssa": new_key if any(w["field"] == "name" for w in written) else ctx["key"],
                            "client_keys": client_keys,
                            "readonly": [{"client_key": t["client_key"], "name": t["name"], "why": t["why"]}
                                         for t in e["ties"] if t["why"]]}
    if written:
        n = len(client_keys)
        parts = [f"The phone and e-mail on {n} client record{'' if n == 1 else 's'} that name the SSA"] if n else []
        if own:
            parts.append(("the" if parts else "The") + " SSA's own " + " and ".join(OWN_WORDS[f] for f in own))
        data = W.with_steps(data, W.pg_steps(" and ".join(parts) + ", kept in the Hub's database.",
                                             CACHES if n else CACHES_OWN, APP_ID))
    if stale:
        data["current"] = stale
        answer = {"status": 409, "data": data, "message": CW.STALE_SOME if written else CW.STALE_ALL}
    else:
        answer = {"status": 200, "data": data}
    if edits:
        return W.final(answer, edits, ctx["key"])
    return Decision(answer, fresh=True)


def rekeyed(sess: L.Session, ctx: dict, new_key: str, name: str, own: dict[str, str], edition: str) -> list[dict]:
    """A renamed SSA's own rows under its new key: its details (what it held, with this write's own changes), each of
    its notes and each of its entries' edit rows — every one changed in place, nothing dropped."""
    reads = sess.reads
    W.gate(reads)
    out: list[dict] = []
    held = S.details_all(reads).get(S.details_id(ctx["key"])) or {}
    carried = {f: gsjs.or_text(held.get(f)) for f in S.EDIT_OWN if gsjs.or_text(held.get(f))}
    if carried or own:
        out.append(details_record(sess, {**ctx, "key": new_key, "name": name}, {**carried, **own}, edition))
    cells = {"ssa_key": new_key, "ssa_name": name}
    before = {"ssa_key": ctx["key"], "ssa_name": ctx["name"]}
    for tab in (S.NOTES_TAB, S.LIST_TAB):
        res = W.tab_of(reads, tab)
        if res.ref is None:
            continue
        sid, name_of_tab = W.where_of(res)
        for r in reads.db.locations_rows(res.ref):
            rid = gsjs.trim(gsjs.or_text(r.get("id")))
            if rid and gsjs.trim(gsjs.or_text(r.get("ssa_key"))) == ctx["key"]:
                rec = W.kept_record(sid, name_of_tab, "edit", "id", rid, new_key, cells, before)
                if edition:
                    rec["edition"] = edition
                out.append(rec)
    return out


def clients_set(sess: L.Session, payload: dict) -> Decision:
    """ssaProfileClients: the SSA named on the Hub record of each active client ticked (its name, phone and e-mail),
    and taken off each one unticked whose Hub record names it; a tie only the Master holds is not touched."""
    shut = S.edit_door(sess)
    if shut:
        return Decision(shut)
    reads = sess.reads
    ctx = S.ssa_ctx(reads, payload.get("ssa"))
    if ctx.get("refused"):
        return refused(ctx["refused"], keyed(payload))
    if ctx["degraded"]:
        raise Defer("not every client record could be read here")

    def keys(v: Any) -> list[str]:
        return [gsjs.trim(gsjs.or_text(k))[:120] for k in (v if isinstance(v, list) else [])
                if gsjs.trim(gsjs.or_text(k))]

    add, remove = keys(payload.get("add")), keys(payload.get("remove"))
    if not add and not remove:
        return W.refuse(400, "add or remove: the clients to tick or untick.")
    rows = S.edit_rows(reads)
    listed = {c["client_key"]: c for c in S.association(reads, ctx, rows)}
    s = ctx["ssa"]
    named = {"ssa_name": ctx["name"], "ssa_email": s["email"], "ssa_phone": s["phone"]}
    blank = {"ssa_name": "", "ssa_email": "", "ssa_phone": ""}
    edition = edition_of(sess, S.EDITION)
    edits: list[dict] = []
    done: dict[str, list[str]] = {"added": [], "removed": []}
    out: list[dict] = []
    for ck, cells, kind in [(k, named, "added") for k in add] + [(k, blank, "removed") for k in remove]:
        c = listed.get(ck)
        if c is None:
            out.append({"client": ck, "why": "Not an active client."})
            continue
        if kind == "removed" and c["why"]:
            out.append({"client": ck, "why": c["why"]})
            continue
        if (kind == "added") == (c["on"] and not c["why"]):
            continue
        checked = CW.save_fields(dict(cells))
        cctx = CW.client_of(reads, ck)
        if checked.get("refused") or cctx.get("refused") or cctx.get("archived"):
            out.append({"client": ck, "why": "The client's record could not take it."})
            continue
        got = CW.profile_write(sess, cctx, checked["fields"])
        if got.get("refused"):
            out.append({"client": ck, "why": gsjs.or_text((got["refused"].answer or {}).get("message"))})
            continue
        rec = dict(got["record"])
        if edition:
            rec["edition"] = edition
        edits.append(rec)
        done[kind].append(ck)
    answer = {"status": 200, "data": {**done, "refused": out, "ssa": ctx["key"]}}
    return W.final(answer, edits, ctx["key"]) if edits else Decision(answer, fresh=True)


def list_entry(reads: L.Reads, ctx: dict, lst: str, iid: str) -> dict[str, Any]:
    """The entry as its list shows it now (`live`, the witnesses), or the refusal: an admin note's text is its own."""
    data = (S.documents_data if lst == "documents" else S.activity_data)(reads, ctx)
    entry = next((d for d in data.get("docs" if lst == "documents" else "items") or [] if d.get("id") == iid), None)
    if entry is None:
        if data.get("degraded"):
            return {"refused": W.refuse(503, f"{S.LISTS[lst]['what']} could not all be read just now, so nothing was "
                                             "changed. Try again in a minute.")}
        word, where = LIST_WORDS[lst]
        return {"refused": W.refuse(404, f"No such {word} in {ctx['name']}'s {where}: it may have been removed.")}
    live = {f: gsjs.or_text(entry.get(f)) for f in S.LISTS[lst]["fields"]}
    live["state"] = "shown"
    note = None
    if lst == "activity" and entry.get("kind") == "note" and iid.startswith(S.NOTE_ITEM):
        note = next((n for n in S.notes_for(reads, ctx["key"]) if S.NOTE_ITEM + n["id"] == iid), None)
        if note is not None:
            live["body"] = gsjs.or_text(S.scrub(note["body"]))
    return {"entry": entry, "live": live, "note": note}


def list_value(field: str, value: str, note: dict | None) -> tuple[str, str]:
    """The value kept for a field, or why it is refused."""
    if field == "title":
        value = gsjs.text(value)
        if not value:
            return "", "A title says what it is; remove the entry instead."
        if CW.utf16_len(value) > S.LIST_TITLE_MAX:
            return "", f"Up to {S.LIST_TITLE_MAX} characters."
    elif field == "date":
        if value and (not S._ISO_DAY.fullmatch(value) or gsjs.day_shift(gsjs.day_shift(value, 1), -1) != value):
            return "", "A day, yyyy-mm-dd, or blank."
    elif field == "body":
        if note is not None and not value:
            return "", "A note says something; remove the note instead."
        if CW.utf16_len(value) > S.NOTE_MAX:
            return "", f"Up to {S.NOTE_MAX} characters."
    else:
        value = value.lower()
        if value not in S.LIST_STATES:
            return "", "One of " + ", ".join(S.LIST_STATES) + "."
        return value, ""
    if S.scrub(value) != value or C._marked(value):
        return "", WITHHELD
    return value, ""


def list_edit(sess: L.Session, payload: dict, lst: str) -> Decision:
    """ssaProfileDocEdit / ssaProfileActivityEdit: an entry's fields or its removal, each refused or stale here, or
    kept in app.edits; what this side cannot read is its own 503, never Apps Script's to decide."""
    try:
        return _list_edit(sess, payload, lst)
    except (Defer, hubdb.Unreadable) as e:
        return W.refuse(503, f"{S.LISTS[lst]['what']} could not be read just now ({str(e)[:160]}), so nothing was "
                             "changed. Try again in a minute.")


def _list_edit(sess: L.Session, payload: dict, lst: str) -> Decision:
    spec = S.LISTS[lst]
    shut = S.edit_door(sess, spec["edition"])
    if shut:
        return Decision(shut)
    reads = sess.reads
    ctx = S.ssa_ctx(reads, payload.get("ssa"))
    if ctx.get("refused"):
        return Decision(ctx["refused"])
    iid = gsjs.text(payload.get("id"), 200)
    if not iid:
        return W.refuse(400, "id: which entry.")
    if iid.startswith(S.NOTE_ITEM) and not S.notes_open(sess):
        return Decision(S.unknown())
    changes, bad = W.edit_changes(payload)
    if bad:
        return Decision(bad)
    got = list_entry(reads, ctx, lst, iid)
    if got.get("refused"):
        return got["refused"]
    live, note = got["live"], got["note"]
    written: list[dict] = []
    out: list[dict] = []
    stale: dict[str, str] = {}
    cells: dict[str, str] = {}
    for c in changes:
        f = c["field"]
        if f not in (*spec["fields"], "state"):
            out.append({"field": f, "why": "Not a field of this list's entries."})
            continue
        if f == "body" and note is not None and S.scrub(note["body"]) != note["body"]:
            out.append({"field": f, "why": "The note holds a number the platform withholds, so its text is not "
                                           "edited here."})
            continue
        now = CW.witness(c["expected"].lower() if f == "state" else c["expected"], live[f])
        if now is not None:
            stale[f] = now
            continue
        value, why = list_value(f, c["value"], note)
        if why:
            out.append({"field": f, "why": why})
            continue
        if value == live[f]:
            continue
        cells[f] = value
        written.append({"field": f, "before": live[f], "after": value})
    removed = cells.get("state") == S.LIST_REMOVED
    word, where = LIST_WORDS[lst]
    said = (f"The {word} taken off {ctx['name']}'s {where}" if removed
            else f"{len(written)} field(s) of the {word} in {ctx['name']}'s {where}")
    answer = W.edit_answer(written, out, stale, W.pg_steps(said + ", kept in the Hub's database.", CACHES_OWN, APP_ID))
    if not written:
        return Decision(answer)
    W.gate(reads)
    res = W.tab_of(reads, S.LIST_TAB)
    prior = S.list_laid(reads, ctx["key"], lst).get(iid)
    edited = [f for f in spec["fields"] if f in cells or f in S.list_fields(prior)]
    if any(f in cells for f in spec["fields"]):
        cells["fields"] = ",".join(edited)
    cells.update(by=W.who(sess.user), at=W.now_iso(reads))
    rid = S.list_id(ctx["key"], lst, iid)
    if prior is None:
        rec = W.append_record(res, S.LIST_HEADER, {"id": rid, "ssa_key": ctx["key"], "ssa_name": ctx["name"],
                                                   "list": lst, "item": iid, "state": "shown", **cells}, ctx["key"])
    else:
        sid, tab = W.where_of(res)
        rec = W.kept_record(sid, tab, "edit", "id", rid, ctx["key"], cells,
                            {f: gsjs.or_text(prior.get(f)) for f in cells})
    edition = edition_of(sess, spec["edition"])
    if edition:
        rec["edition"] = edition
    return W.final(answer, [rec], ctx["key"])


def doc_edit(sess: L.Session, payload: dict) -> Decision:
    """ssaProfileDocEdit: a Documents entry's title or date, or its removal."""
    return list_edit(sess, payload, "documents")


def activity_edit(sess: L.Session, payload: dict) -> Decision:
    """ssaProfileActivityEdit: an Activity entry's title or text, or its removal."""
    return list_edit(sess, payload, "activity")


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {"ssaProfileNoteAdd": note_add, "ssaProfileEdit": edit,
                                                              "ssaProfileDocEdit": doc_edit,
                                                              "ssaProfileActivityEdit": activity_edit,
                                                              "ssaProfileClients": clients_set,
                                                              "ssaProfilePhoto": P.door("ssa")}
# HUB_POLICY: the roles each write is declared for, and its typed params
POLICY: dict[str, dict[str, Any]] = {
    "ssaProfilePhoto": P.policy("ssa"),
    "ssaProfileNoteAdd":{"roles": sc.EDITION_ROLES, "params": {"ssa": "string", "body": "string"}},
    "ssaProfileEdit": {"roles": ("admin", "manager", "staff"), "params": {"ssa": "string", "changes": "array"}},
    "ssaProfileClients": {"roles": ("admin", "manager", "staff"),
                          "params": {"ssa": "string", "add": "array", "remove": "array"}},
    "ssaProfileDocEdit": {"roles": sc.EDITION_ROLES, "params": {"ssa": "string", "id": "string", "changes": "array"}},
    "ssaProfileActivityEdit": {"roles": sc.EDITION_ROLES,
                               "params": {"ssa": "string", "id": "string", "changes": "array"}}}
# the door takes its lock after refusals this side cannot order: a held lock is Apps Script's to answer
BUSY_OF: dict[str, dict[str, Any]] = {}


class Store(W.Store):
    """app.ssa_writes and app.ssa_receipts, beside the other apps' own."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="ssa", label="SSA")
