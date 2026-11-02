"""Emergency Contacts answered by Python alone: the directory kept in the Hub's database (its own tables, every change
audited), read by whoever the app opens to and changed by the master or a holder of its edition."""
from __future__ import annotations

import contextlib
import contextvars
import json
import logging
import re
import types
import uuid
from typing import Any, Callable, Iterator

import gsjs
import hubdb
import locations as L
import scope as sc
import writes as W
from scope import Defer

log = logging.getLogger("asa-hub-app")

APP_ID = "emergency-contacts"
EDITION = "emergencyContacts.directory"
UNKNOWN = "Unknown action."
# the directory's own tables in schema app, named here so a check can point them at stand-ins
GROUPS_TABLE = "app.emergency_contact_groups"
CONTACTS_TABLE = "app.emergency_contacts"
AUDIT_TABLE = "app.emergency_contacts_audit"
AUTHOR = "asa-hub-app"
NAME_MAX, NOTE_MAX, LABEL_MAX, PHONE_MAX, ICON_MAX = 120, 120, 60, 40, 40
GROUPS_MAX, CONTACTS_MAX = 20, 50
# the colour chips a lane wears (the SPA's CHIP_CHOICES carries the same classes, literally)
CHIPS = ("bg-tint-pink text-tint-fg-pink", "bg-tint-blue text-tint-fg-blue", "bg-tint-amber text-tint-fg-amber",
         "bg-tint-mint text-tint-fg-mint", "bg-tint-lavender text-tint-fg-lavender",
         "bg-tint-peach text-tint-fg-peach", "bg-tint-violet text-tint-fg-violet", "bg-tint-slate text-tint-fg-slate")
DEFAULT_CHIP = "bg-tint-slate text-tint-fg-slate"
DEFAULT_ICON = "phone"
_ICON = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
_ORDER = re.compile(r"^\d{1,4}$")
_EXT = re.compile(r"\s*(?:x|ext\.?|extension|#)\s*([0-9]{1,6})\s*$", re.I)
_SHORT = re.compile(r"^[0-9]{3,6}$")
OPS = ("contact.add", "contact.edit", "contact.remove", "group.add", "group.edit", "group.remove")
CONTACT_FIELDS = ("name", "phone", "note", "group", "order")
GROUP_FIELDS = ("label", "icon", "chip", "order")
GROUP_COLS = ("id", "label", "icon", "chip", "sort_order")
CONTACT_COLS = ("id", "group_id", "name", "note", "phone", "sort_order")
CACHES = "Every open Emergency Contacts page reads the directory again."
STALE_ALL = "Changed since the panel was opened — reloaded, nothing was written."
GONE_CONTACT = "That contact is not in the directory any more — reloaded, nothing was written."
GONE_GROUP = "That lane is not in the directory any more — reloaded, nothing was written."

# the compiled directory the page drew before (DEFAULT_GROUPS of src/pages/features/suggestions/HelpfulContacts.tsx)
DEFAULT_GROUPS: tuple[dict[str, Any], ...] = (
    {"id": "emergency", "label": "Emergency", "icon": "siren", "chip": "bg-tint-pink text-tint-fg-pink",
     "contacts": ({"name": "Police, Fire, Medical", "note": "", "phone": "911"},
                  {"name": "Canton Police", "note": "Non-Emergency", "phone": "(330) 649-5800"},
                  {"name": "Crisis Center", "note": "Coleman", "phone": "(330) 452-6000"},
                  {"name": "Stark County UI/MUI Reporting Line", "note": "", "phone": "(330) 477-4477"},
                  {"name": "Stark County UI/MUI Reporting Line", "note": "", "phone": "(330) 489-3400"})},
    {"id": "hospitals", "label": "Hospitals", "icon": "hospital", "chip": "bg-tint-blue text-tint-fg-blue",
     "contacts": ({"name": "Aultman Hospital", "note": "", "phone": "(330) 452-9911"},
                  {"name": "Cleveland Clinic Mercy Hospital", "note": "", "phone": "(330) 489-1000"})},
    {"id": "agencies", "label": "Stark County agencies", "icon": "building-2", "chip": "bg-tint-amber text-tint-fg-amber",
     "contacts": ({"name": "Stark County Board of DD", "note": "", "phone": "(330) 477-5200"},
                  {"name": "Stark County Health Department", "note": "", "phone": "(330) 493-9904"},
                  {"name": "Stark County Job and Family Services", "note": "", "phone": "(330) 452-4661"})},
    {"id": "team", "label": "ASA team", "icon": "users", "chip": "bg-tint-mint text-tint-fg-mint",
     "contacts": ({"name": "Ty Bond", "note": "Administrator", "phone": "(330) 919-7779"},
                  {"name": "Brittany Anderson", "note": "HR / Administration", "phone": "(330) 919-7595"},
                  {"name": "Natalie Darnell", "note": "Finance", "phone": "(330) 605-6497"},
                  {"name": "Stephanie Inman", "note": "Division Supervisor", "phone": "(330) 639-8665"},
                  {"name": "Tieara Kennemore", "note": "Division Supervisor", "phone": "(330) 344-0430"})},
)

# the locked transaction's cursor while a save is decided: the door reads the directory under the lock it writes in
HELD: contextvars.ContextVar[Any] = contextvars.ContextVar("emergency_contacts_held", default=None)
_BOUND: dict[str, Any] = {"store": None}


def bind(store: "Store") -> None:
    """The store the read door reads through (main.py's own)."""
    _BOUND["store"] = store


# ---- the tables --------------------------------------------------------------------------------------------------

def ddl() -> tuple[str, ...]:
    g, c, a = GROUPS_TABLE, CONTACTS_TABLE, AUDIT_TABLE
    return (
        f"create table if not exists {g} (id text primary key, label text not null, icon text not null default 'phone',"
        " chip text not null default '', sort_order integer not null default 0, updated_by text not null default '',"
        " updated_at timestamptz not null default now())",
        f"create table if not exists {c} (id text primary key, group_id text not null references {g} (id),"
        " name text not null, note text not null default '', phone text not null,"
        " sort_order integer not null default 0, updated_by text not null default '',"
        " updated_at timestamptz not null default now())",
        f"create index if not exists emergency_contacts_lane on {c} (group_id, sort_order)",
        f"create table if not exists {a} (id bigserial primary key, write_id text not null default '',"
        " author text not null default '', edition text not null default '', op text not null,"
        " entity text not null, entity_id text not null default '', before jsonb, after jsonb,"
        " at timestamptz not null default now())",
        f"create index if not exists emergency_contacts_audit_write on {a} (write_id)",
    )


def _jsonb(v: Any) -> str | None:
    return None if v is None else json.dumps(v, ensure_ascii=False)


def _loaded(v: Any) -> Any:
    return json.loads(v) if isinstance(v, str) else v


def seed(cur: Any) -> bool:
    """DEFAULT_GROUPS into empty tables, once: a seed row on the audit says it was done, whatever happened since."""
    cur.execute(f"select 1 from {AUDIT_TABLE} where op = 'seed' limit 1")
    if cur.fetchone():
        return False
    cur.execute(f"select count(*) from {GROUPS_TABLE}")
    if int(cur.fetchone()[0] or 0):
        return False
    state = default_state()
    for entity, rid, _before, after in diff({"groups": [], "contacts": {}}, state):
        _put(cur, entity, rid, None, after, AUTHOR)
    cur.execute(f"insert into {AUDIT_TABLE} (write_id, author, edition, op, entity, entity_id, before, after)"
                " values ('', %s, '', 'seed', 'directory', '', null, %s::jsonb)", (AUTHOR, _jsonb(view(state))))
    return True


def default_state() -> dict[str, Any]:
    """DEFAULT_GROUPS as the directory's state, each contact named by its lane and place."""
    return {"groups": [{k: g[k] for k in ("id", "label", "icon", "chip")} for g in DEFAULT_GROUPS],
            "contacts": {g["id"]: [{"id": f"{g['id']}-{i + 1}", **c} for i, c in enumerate(g["contacts"])]
                         for g in DEFAULT_GROUPS}}


def _fetch(sql: str, params: tuple = ()) -> list[tuple]:
    """Rows of the directory: under the save's lock while one is decided, else on the store's own connection."""
    cur = HELD.get()
    if cur is not None:
        cur.execute(sql, params)
        return list(cur.fetchall())
    store = _BOUND["store"]
    if store is None or not store.ready():
        raise hubdb.Unreadable("the directory's tables are not ready" + (f" ({store.why})" if store and store.why else ""))
    try:
        return list(store.conn().execute(sql, params).fetchall())
    except Exception as exc:  # noqa: BLE001 - never read as an empty directory
        store._drop()
        raise hubdb.Unreadable(f"the directory could not be read ({type(exc).__name__})") from exc


def load() -> dict[str, Any]:
    """The directory as kept: the lanes in order, each lane's contacts in order."""
    groups = [{"id": r[0], "label": r[1], "icon": r[2], "chip": r[3]}
              for r in _fetch(f"select id, label, icon, chip from {GROUPS_TABLE} order by sort_order, id")]
    contacts: dict[str, list[dict]] = {g["id"]: [] for g in groups}
    for r in _fetch(f"select id, group_id, name, note, phone from {CONTACTS_TABLE} order by sort_order, id"):
        if r[1] in contacts:
            contacts[r[1]].append({"id": r[0], "name": r[2], "note": r[3] or "", "phone": r[4]})
    return {"groups": groups, "contacts": contacts}


def view(state: dict[str, Any]) -> list[dict[str, Any]]:
    """The lanes as the page draws them, each place counted from 1."""
    return [{**g, "order": i + 1, "contacts": [{**c, "order": j + 1} for j, c in enumerate(state["contacts"].get(g["id"], []))]}
            for i, g in enumerate(state["groups"])]


def rows_of(state: dict[str, Any]) -> tuple[dict[str, dict], dict[str, dict]]:
    groups: dict[str, dict] = {}
    contacts: dict[str, dict] = {}
    for i, g in enumerate(state["groups"]):
        groups[g["id"]] = {"id": g["id"], "label": g["label"], "icon": g["icon"], "chip": g["chip"], "sort_order": i + 1}
        for j, c in enumerate(state["contacts"].get(g["id"], [])):
            contacts[c["id"]] = {"id": c["id"], "group_id": g["id"], "name": c["name"], "note": c["note"],
                                 "phone": c["phone"], "sort_order": j + 1}
    return groups, contacts


def diff(old: dict[str, Any], new: dict[str, Any]) -> list[tuple[str, str, dict | None, dict | None]]:
    """(entity, id, before, after) of every row that changed, in the order the tables take them."""
    og, oc = rows_of(old)
    ng, nc = rows_of(new)
    return ([("group", i, None, r) for i, r in ng.items() if i not in og]
            + [("group", i, og[i], r) for i, r in ng.items() if i in og and og[i] != r]
            + [("contact", i, None, r) for i, r in nc.items() if i not in oc]
            + [("contact", i, oc[i], r) for i, r in nc.items() if i in oc and oc[i] != r]
            + [("contact", i, r, None) for i, r in oc.items() if i not in nc]
            + [("group", i, r, None) for i, r in og.items() if i not in ng])


def _table(entity: str) -> tuple[str, tuple[str, ...]]:
    return (GROUPS_TABLE, GROUP_COLS) if entity == "group" else (CONTACTS_TABLE, CONTACT_COLS)


def _row(cur: Any, entity: str, rid: str) -> dict | None:
    table, cols = _table(entity)
    cur.execute(f"select {', '.join(cols)} from {table} where id = %s", (rid,))
    got = cur.fetchone()
    return None if got is None else dict(zip(cols, got))


def _put(cur: Any, entity: str, rid: str, before: dict | None, after: dict | None, author: str) -> None:
    """One row made what `after` says: inserted, changed or (None) deleted."""
    table, cols = _table(entity)
    if after is None:
        cur.execute(f"delete from {table} where id = %s", (rid,))
    elif before is None:
        cur.execute(f"insert into {table} ({', '.join(cols)}, updated_by) values ({', '.join(['%s'] * len(cols))}, %s)",
                    tuple(after[k] for k in cols) + (author,))
    else:
        sets = ", ".join(f"{k} = %s" for k in cols if k != "id")
        cur.execute(f"update {table} set {sets}, updated_by = %s, updated_at = now() where id = %s",
                    tuple(after[k] for k in cols if k != "id") + (author, rid))


def apply(cur: Any, changes: list[tuple], write_id: str, author: str, edition: str, op: str) -> None:
    """A decided change kept: each row as it now stands, and its before and after on the audit."""
    for entity, rid, before, after in changes:
        _put(cur, entity, rid, before, after, author)
        cur.execute(f"insert into {AUDIT_TABLE} (write_id, author, edition, op, entity, entity_id, before, after)"
                    " values (%s, %s, %s, %s, %s, %s, %s::jsonb, %s::jsonb)",
                    (write_id, author, edition, op, entity, rid, _jsonb(before), _jsonb(after)))


def revert(cur: Any, write_id: str) -> int:
    """A save the relay never answered as written, taken back row by row; a row changed since stays as it stands."""
    cur.execute(f"select 1 from {AUDIT_TABLE} where write_id = %s and op = 'void' limit 1", (write_id,))
    if cur.fetchone():
        return 0
    cur.execute(f"select entity, entity_id, before, after from {AUDIT_TABLE} where write_id = %s order by id desc",
                (write_id,))
    rows = cur.fetchall()
    n = 0
    for entity, rid, before, after in rows:
        before, after = _loaded(before), _loaded(after)
        if _row(cur, entity, rid) != after:
            continue
        _put(cur, entity, rid, after, before, AUTHOR)
        n += 1
    if rows:
        cur.execute(f"insert into {AUDIT_TABLE} (write_id, author, edition, op, entity, entity_id, before, after)"
                    " values (%s, %s, '', 'void', 'directory', %s, null, %s::jsonb)",
                    (write_id, AUTHOR, write_id, _jsonb({"reverted": n, "rows": len(rows)})))
    return n


# ---- the values ----------------------------------------------------------------------------------------------------

def _us_ten(body: str) -> str:
    """The ten national digits of a US number, or '' (formatPhoneDisplay's usTen)."""
    if not re.fullmatch(r"\+?[0-9\s().-]+", body):
        return ""
    d = re.sub(r"[^0-9]", "", body)
    if len(d) == 11 and d.startswith("1"):
        return d[1:]
    if len(d) == 10 and not body.startswith("+"):
        return d
    return ""


def phone_display(raw: Any) -> str:
    """formatPhoneDisplay (src/lib/phoneFormat.ts): "(xxx) xxx-xxxx" for a US number, " x123" kept; else as it came."""
    s = gsjs.trim(gsjs.or_blank(raw))
    if not s:
        return s
    ext = _EXT.search(s)
    ten = _us_ten(gsjs.trim(s[:ext.start()]) if ext else s)
    if not ten:
        return s
    out = f"({ten[:3]}) {ten[3:6]}-{ten[6:]}"
    return f"{out} x{ext.group(1)}" if ext else out


def phone_check(raw: Any) -> tuple[str, str]:
    """(the phone as the directory keeps it, why not): a US number formatted, or a short code like 911."""
    s = gsjs.text(raw)
    if not s:
        return "", "A contact keeps a phone number."
    if len(s) > PHONE_MAX:
        return "", f"A phone number is up to {PHONE_MAX} characters."
    if _SHORT.fullmatch(s):
        return s, ""
    ext = _EXT.search(s)
    if not _us_ten(gsjs.trim(s[:ext.start()]) if ext else s):
        return "", "A phone is a 10-digit US number (an extension may follow, like x12) or a short code like 911."
    return phone_display(s), ""


def _words(raw: Any, most: int, what: str, required: bool) -> tuple[str, str]:
    s = gsjs.text(raw)
    if required and not s:
        return "", f"A {what} is needed."
    if len(s) > most:
        return "", f"A {what} is up to {most} characters."
    return s, ""


def icon_check(raw: Any) -> tuple[str, str]:
    s = gsjs.text(raw).lower() or DEFAULT_ICON
    if len(s) > ICON_MAX or not _ICON.fullmatch(s):
        return "", "An icon is one of the platform's icon names, like siren or users."
    return s, ""


def chip_check(raw: Any) -> tuple[str, str]:
    s = gsjs.text(raw) or DEFAULT_CHIP
    return (s, "") if s in CHIPS else ("", "Not one of the lane colours.")


def place(raw: Any, most: int) -> int | None:
    """A place counted from 1, kept within the list it goes in; None for anything else."""
    s = gsjs.text(W.edit_text(raw))
    if not _ORDER.fullmatch(s) or int(s) < 1:
        return None
    return min(int(s), most)


def _copy(state: dict[str, Any]) -> dict[str, Any]:
    return {"groups": [dict(g) for g in state["groups"]],
            "contacts": {k: [dict(c) for c in v] for k, v in state["contacts"].items()}}


def _find_contact(state: dict[str, Any], cid: str) -> tuple[str, int] | None:
    for gid, lane in state["contacts"].items():
        for i, c in enumerate(lane):
            if c["id"] == cid:
                return gid, i
    return None


def _find_group(state: dict[str, Any], gid: str) -> int | None:
    return next((i for i, g in enumerate(state["groups"]) if g["id"] == gid), None)


def _label_taken(state: dict[str, Any], label: str, but: str = "") -> bool:
    return any(g["id"] != but and g["label"].lower() == label.lower() for g in state["groups"])


# ---- the gate ------------------------------------------------------------------------------------------------------

def opens(sess: L.Session) -> bool:
    """hubProfileAppGate_ for the app: App Control's row and the viewer's badges; the directory is not cut by scope."""
    user = sess.user
    src = sess.reads.scope_sources()
    try:
        got = sc.profile_app_gate(APP_ID, user, src)
    except Defer:
        # a guardian's scope is matched on the SSA records; the directory is the same for whoever the app opens to,
        # and a family account opens it by its badges, never by a role word naming another column (scope.role_counts)
        if not user or user.get("visiting_member"):
            raise
        words = sc.badges_matched(user.get("types"), user.get("role"))
        rule = list(((src.rules().get("rules") or {}).get(APP_ID)) or [])
        if not any(t in words for t in sc.FAMILY_TICKS) or not any(w in rule for w in words):
            raise
        return True
    return bool(got.get("open"))


def may_edit(sess: L.Session) -> bool:
    """The master always; else a person the edition lists while its key is on, who opens the app. FAIL-CLOSED."""
    if sc.is_real_master(sess.user):
        return True
    return sc.edition_allows(EDITION, sess.user or {}, sess.reads.config()) and opens(sess)


def directory_of(state: dict[str, Any], can_edit: bool) -> dict[str, Any]:
    return {"groups": view(state), "can_edit": can_edit, "source": "python"}


# ---- the doors -----------------------------------------------------------------------------------------------------

def directory_read(sess: L.Session, payload: dict) -> dict[str, Any]:
    """emergencyContactsRead: every lane and contact, and whether this viewer may change them."""
    if not opens(sess):
        return {"status": 404, "message": UNKNOWN}
    try:
        can_edit = may_edit(sess)
    except (hubdb.Unreadable, Defer) as exc:
        log.warning("emergencyContactsRead: who edits could not be read (%s)", type(exc).__name__)
        can_edit = False
    return {"status": 200, "data": directory_of(load(), can_edit)}


class Kept(W.Decision):
    """A save decided: its answer, and the rows it changes (kept by Tx.record under the same lock)."""

    def __init__(self, answer: dict[str, Any], changes: list[tuple], op: str, edition: str) -> None:
        super().__init__(answer, edition=edition)
        self.changes = changes
        self.op = op


def _said(words: str) -> dict[str, Any]:
    return W.pg_steps(words + ", kept in the Hub's database.", CACHES, APP_ID)


def _stale(state: dict[str, Any], message: str, current: dict | None = None) -> dict[str, Any]:
    data: dict[str, Any] = {"directory": directory_of(state, True)}
    if current:
        data["current"] = current
    return {"status": 409, "data": data, "message": message}


def _witnessed(expected: Any, current: dict[str, str]) -> dict[str, str]:
    """The fields of a removal's witness the directory no longer holds, with what it holds now."""
    sent = expected if isinstance(expected, dict) else {}
    return {f: current[f] for f, v in sent.items() if f in current and W.edit_text(v) != current[f]}


def contact_add(state: dict[str, Any], p: dict) -> tuple[dict[str, Any], dict | None, str]:
    c = p.get("contact") if isinstance(p.get("contact"), dict) else None
    if c is None:
        return W.refuse(400, "contact: the new contact's lane, name and phone.").answer, None, ""
    gid = gsjs.text(W.edit_text(c.get("group")), 80)
    if _find_group(state, gid) is None:
        return _stale(state, GONE_GROUP), None, ""
    name, why = _words(c.get("name"), NAME_MAX, "name", True)
    phone, why_p = phone_check(c.get("phone"))
    note, why_n = _words(c.get("note"), NOTE_MAX, "note", False)
    for field, said in (("name", why), ("phone", why_p), ("note", why_n)):
        if said:
            return {"status": 400, "message": f"{field}: {said} Nothing was saved."}, None, ""
    lane = state["contacts"][gid]
    if len(lane) >= CONTACTS_MAX:
        return {"status": 400, "message": f"A lane holds up to {CONTACTS_MAX} contacts. Nothing was saved."}, None, ""
    at = len(lane) + 1 if c.get("order") in (None, "") else place(c.get("order"), len(lane) + 1)
    if at is None:
        return {"status": 400, "message": "order: a place in the lane, 1 or more. Nothing was saved."}, None, ""
    new = _copy(state)
    made = {"id": "c" + uuid.uuid4().hex[:12], "name": name, "note": note, "phone": phone}
    new["contacts"][gid].insert(at - 1, made)
    label = state["groups"][_find_group(state, gid)]["label"]
    return {"status": 200, "data": {"contact": {**made, "group": gid, "order": at}, **_said(
        f"A new contact in {label}")}}, new, made["id"]


def contact_edit(state: dict[str, Any], p: dict) -> tuple[dict[str, Any], dict | None, str]:
    cid = gsjs.text(W.edit_text(p.get("id")), 80)
    where = _find_contact(state, cid)
    if where is None:
        return _stale(state, GONE_CONTACT), None, ""
    changes, bad = W.edit_changes(p)
    if bad:
        return bad, None, ""
    gid, at = where
    row = state["contacts"][gid][at]
    current = {"name": row["name"], "phone": row["phone"], "note": row["note"], "group": gid, "order": str(at + 1)}
    written: list[dict] = []
    refused: list[dict] = []
    stale: dict[str, str] = {}
    take: dict[str, Any] = {}
    for ch in changes:
        f = ch["field"]
        if f not in CONTACT_FIELDS:
            refused.append({"field": f, "why": "Not a field of a contact."})
            continue
        if ch["expected"] != current[f]:
            stale[f] = current[f]
            continue
        if f == "name":
            value, why = _words(ch["value"], NAME_MAX, "name", True)
        elif f == "note":
            value, why = _words(ch["value"], NOTE_MAX, "note", False)
        elif f == "phone":
            value, why = phone_check(ch["value"])
        elif f == "group":
            value, why = (ch["value"], "") if _find_group(state, ch["value"]) is not None \
                else ("", "Not a lane of the directory.")
        else:
            got = place(ch["value"], 10000)
            value, why = (str(got), "") if got is not None else ("", "A place in the lane, 1 or more.")
        if why:
            refused.append({"field": f, "why": why})
            continue
        take[f] = value
        written.append({"field": f, "before": current[f], "after": value})
    new = None
    if written:
        new = _copy(state)
        moved = dict(row, **{k: v for k, v in take.items() if k in ("name", "phone", "note")})
        new["contacts"][gid].pop(at)
        to = take.get("group", gid)
        lane = new["contacts"][to]
        spot = int(take["order"]) if "order" in take else (at + 1 if to == gid else len(lane) + 1)
        lane.insert(min(spot, len(lane) + 1) - 1, moved)
    answer = W.edit_answer(written, refused, stale, _said(f"{len(written)} field(s) of {row['name']}"))
    answer["data"]["directory"] = directory_of(new or state, True)
    return answer, new, cid


def contact_remove(state: dict[str, Any], p: dict) -> tuple[dict[str, Any], dict | None, str]:
    cid = gsjs.text(W.edit_text(p.get("id")), 80)
    where = _find_contact(state, cid)
    if where is None:
        return _stale(state, GONE_CONTACT), None, ""
    gid, at = where
    row = state["contacts"][gid][at]
    current = {"name": row["name"], "phone": row["phone"], "note": row["note"], "group": gid, "order": str(at + 1)}
    stale = _witnessed(p.get("expected"), current)
    if stale:
        return _stale(state, STALE_ALL, stale), None, ""
    new = _copy(state)
    new["contacts"][gid].pop(at)
    return {"status": 200, "data": {"removed": {"contact": cid}, **_said(f"{row['name']} taken off the directory")}}, \
        new, cid


def group_add(state: dict[str, Any], p: dict) -> tuple[dict[str, Any], dict | None, str]:
    g = p.get("group") if isinstance(p.get("group"), dict) else None
    if g is None:
        return {"status": 400, "message": "group: the new lane's label, icon and colour."}, None, ""
    label, why = _words(g.get("label"), LABEL_MAX, "label", True)
    icon, why_i = icon_check(g.get("icon"))
    chip, why_c = chip_check(g.get("chip"))
    for field, said in (("label", why), ("icon", why_i), ("chip", why_c)):
        if said:
            return {"status": 400, "message": f"{field}: {said} Nothing was saved."}, None, ""
    if _label_taken(state, label):
        return {"status": 400, "message": f'There is already a lane called "{label}". Nothing was saved.'}, None, ""
    if len(state["groups"]) >= GROUPS_MAX:
        return {"status": 400, "message": f"The directory holds up to {GROUPS_MAX} lanes. Nothing was saved."}, None, ""
    n = len(state["groups"])
    at = n + 1 if g.get("order") in (None, "") else place(g.get("order"), n + 1)
    if at is None:
        return {"status": 400, "message": "order: a place among the lanes, 1 or more. Nothing was saved."}, None, ""
    new = _copy(state)
    made = {"id": "g" + uuid.uuid4().hex[:10], "label": label, "icon": icon, "chip": chip}
    new["groups"].insert(at - 1, made)
    new["contacts"][made["id"]] = []
    return {"status": 200, "data": {"group": {**made, "order": at}, **_said(f"A new lane, {label}")}}, new, made["id"]


def group_edit(state: dict[str, Any], p: dict) -> tuple[dict[str, Any], dict | None, str]:
    gid = gsjs.text(W.edit_text(p.get("id")), 80)
    at = _find_group(state, gid)
    if at is None:
        return _stale(state, GONE_GROUP), None, ""
    changes, bad = W.edit_changes(p)
    if bad:
        return bad, None, ""
    row = state["groups"][at]
    current = {"label": row["label"], "icon": row["icon"], "chip": row["chip"], "order": str(at + 1)}
    written: list[dict] = []
    refused: list[dict] = []
    stale: dict[str, str] = {}
    take: dict[str, Any] = {}
    for ch in changes:
        f = ch["field"]
        if f not in GROUP_FIELDS:
            refused.append({"field": f, "why": "Not a field of a lane."})
            continue
        if ch["expected"] != current[f]:
            stale[f] = current[f]
            continue
        if f == "label":
            value, why = _words(ch["value"], LABEL_MAX, "label", True)
            if not why and _label_taken(state, value, gid):
                why = f'There is already a lane called "{value}".'
        elif f == "icon":
            value, why = icon_check(ch["value"])
        elif f == "chip":
            value, why = chip_check(ch["value"])
        else:
            got = place(ch["value"], len(state["groups"]))
            value, why = (str(got), "") if got is not None else ("", "A place among the lanes, 1 or more.")
        if why:
            refused.append({"field": f, "why": why})
            continue
        take[f] = value
        written.append({"field": f, "before": current[f], "after": value})
    new = None
    if written:
        new = _copy(state)
        moved = dict(row, **{k: v for k, v in take.items() if k != "order"})
        new["groups"].pop(at)
        spot = int(take["order"]) if "order" in take else at + 1
        new["groups"].insert(spot - 1, moved)
    answer = W.edit_answer(written, refused, stale, _said(f"{len(written)} field(s) of the {row['label']} lane"))
    answer["data"]["directory"] = directory_of(new or state, True)
    return answer, new, gid


def group_remove(state: dict[str, Any], p: dict) -> tuple[dict[str, Any], dict | None, str]:
    gid = gsjs.text(W.edit_text(p.get("id")), 80)
    at = _find_group(state, gid)
    if at is None:
        return _stale(state, GONE_GROUP), None, ""
    row = state["groups"][at]
    lane = state["contacts"].get(gid, [])
    current = {"label": row["label"], "icon": row["icon"], "chip": row["chip"], "order": str(at + 1),
               "contacts": str(len(lane))}
    stale = _witnessed(p.get("expected"), current)
    if stale:
        return _stale(state, STALE_ALL, stale), None, ""
    n = len(lane)
    if n and p.get("with_contacts") is not True:
        return {"status": 400, "message": f'The lane "{row["label"]}" still has {n} contact{"" if n == 1 else "s"}. '
                                          "Remove them with it, or move them to another lane first. Nothing was "
                                          "saved."}, None, ""
    new = _copy(state)
    new["groups"].pop(at)
    new["contacts"].pop(gid, None)
    words = f"The {row['label']} lane" + (f" and its {n} contact{'' if n == 1 else 's'}" if n else "") + " taken off"
    return {"status": 200, "data": {"removed": {"group": gid, "contacts": n}, **_said(words)}}, new, gid


DOORS: dict[str, Callable[[dict[str, Any], dict], tuple[dict[str, Any], dict | None, str]]] = {
    "contact.add": contact_add, "contact.edit": contact_edit, "contact.remove": contact_remove,
    "group.add": group_add, "group.edit": group_edit, "group.remove": group_remove}


def directory_save(sess: L.Session, payload: dict) -> W.Decision:
    """emergencyContactsSave: one change to the directory, kept in the Hub's database as the truth — final."""
    if not may_edit(sess):
        return W.Decision({"status": 404, "message": UNKNOWN})
    op = gsjs.text(W.edit_text(payload.get("op")))
    if op not in DOORS:
        return W.refuse(400, "op: one of " + ", ".join(OPS) + ".")
    state = load()
    answer, new, _id = DOORS[op](state, payload)
    if answer.get("status") == 200 and isinstance(answer.get("data"), dict) and "directory" not in answer["data"]:
        answer["data"]["directory"] = directory_of(new or state, True)
    changes = diff(state, new) if new is not None else []
    if not changes:
        return W.Decision(answer)
    edition = "" if sc.is_real_master(sess.user) else EDITION
    return Kept(answer, changes, op, edition)


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {"emergencyContactsRead": directory_read}
# HUB_POLICY: the roles each door is declared for, and its typed params
POLICY: dict[str, dict[str, Any]] = {
    "emergencyContactsRead": {"roles": ("admin", "director", "manager", "staff", "client", "guardian", "onboarding",
                                        "interviewer")}}
# the save, decided under the write lock and kept in the directory's own tables (main.WRITES)
WRITE = types.SimpleNamespace(
    ACTIONS={"emergencyContactsSave": directory_save},
    POLICY={"emergencyContactsSave": {"roles": sc.EDITION_ROLES, "params": {
        "op": "string", "id": "string", "changes": "array", "contact": "object", "group": "object",
        "expected": "object", "with_contacts": "boolean"}}})


class Tx(W.Tx):
    """The save's locked transaction: its receipt, then the directory's rows and their audit."""

    def record(self, write_id: str, action: str, env: dict[str, Any], decision: W.Decision, author: str) -> None:
        super().record(write_id, action, env, decision, author)
        changes = getattr(decision, "changes", None)
        if not changes:
            return
        try:
            apply(self.cur, changes, write_id, author, decision.edition, getattr(decision, "op", action))
        except Exception as exc:  # noqa: BLE001 - the whole transaction rolls back with it
            raise W.NotKept(f"the directory refused the change ({type(exc).__name__})") from exc


class Store(W.Store):
    """app.emergency_contacts_receipts beside the other apps' own, and the directory's tables, seeded once."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="emergency_contacts", label="Emergency Contacts")
        self._own = False

    def ensure(self) -> str:
        why = super().ensure()
        if why or self._own:
            return why
        with self._lock:
            if self._own:
                return ""
            try:
                c = self.conn()
                with c.transaction():
                    cur = c.cursor()
                    for stmt in ddl():
                        cur.execute(stmt)
                    cur.execute("select pg_advisory_xact_lock(%s)", (W.LOCK_KEY,))
                    if seed(cur):
                        log.info("emergency contacts: the directory seeded from the compiled one")
                self._own = True
            except Exception as exc:  # noqa: BLE001 - said on /healthz; the page draws its compiled directory meanwhile
                self._drop()
                self._ready = False
                self.why = f"the directory's tables are not ready ({type(exc).__name__}: {str(exc)[:120]})"
        return self.why

    @contextlib.contextmanager
    def locked(self) -> Iterator[W.Tx]:
        with super().locked() as tx:
            token = HELD.set(tx.cur)
            try:
                yield Tx(tx.cur, self.kind)
            finally:
                HELD.reset(token)

    def settle(self, write_id: str, state: str, why: str = "", fields: list[str] | None = None) -> bool:
        if state == "void":
            try:
                c = self.conn()
                with c.transaction():
                    cur = c.cursor()
                    cur.execute(f"set local lock_timeout = '{W.LOCK_WAIT}'")
                    cur.execute("select pg_advisory_xact_lock(%s)", (W.LOCK_KEY,))
                    n = revert(cur, write_id)
                if n:
                    log.info("emergency contacts: write %s taken back (%d row(s))", write_id, n)
            except Exception as exc:  # noqa: BLE001
                self._drop()
                raise hubdb.Unreadable(f"the directory did not answer ({type(exc).__name__})") from exc
        return super().settle(write_id, state, why, fields)
