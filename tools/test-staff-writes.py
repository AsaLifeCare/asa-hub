#!/usr/bin/env python3
"""Staff's writes decided in Python (app/staff_writes.py) against what the .gs doors answer, on real staff in the
running asa-hub-app: refusals and their words, the cells a write files, the own-write layer over the reads, the lane
(app/main.py), the store's SQL and the relay's routing. Nothing is written: no sheet is touched, the SQL is rolled back."""
from __future__ import annotations

import argparse
import ast
import base64
import json
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "app"
MODULES = ("gsjs", "hubdb", "scope", "drive", "locations", "clients", "client_meds", "client_sources", "client_app",
           "writes", "client_writes", "staff", "staff_comms", "staff_perf", "staff_app", "staff_writes", "ssa",
           "ssa_writes", "family", "family_writes", "main")
RUNNER = "asa-hub-app"
RELAY_CONTAINER = "asa-hub-snapshot"

DRIVER = r'''
import base64, contextlib, json, os, re, sys, time, types
ISO = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$")
blob = json.loads(base64.b64decode(sys.stdin.readline()).decode())
for name in blob["order"]:
    m = types.ModuleType(name); m.__file__ = name + ".py"; sys.modules[name] = m
for name in blob["order"]:
    exec(compile(blob["src"][name], name + ".py", "exec"), sys.modules[name].__dict__)
import gsjs, hubdb, locations as L, scope as sc, drive as dr, staff as SP, staff_comms as SC, writes as W
import client_writes as CW, staff_writes as SW, main
from gsjs import name_key

db = hubdb.HubDb()
drv = dr.Drive()
out = {"checks": [], "timing": {}}
SECRET = []
UNKNOWN = {"status": 404, "message": "Unknown action."}


def mask(s):
    s = str(s)
    for word in sorted(SECRET, key=len, reverse=True):
        if word and len(word) > 2:
            s = s.replace(word, "<staff>")
    return s[:300]


def check(name, ok, detail=""):
    out["checks"].append([name, bool(ok), "" if ok else mask(detail)])


def decide(action, payload, user, reads=None):
    t = time.monotonic()
    try:
        d = SW.ACTIONS[action](L.Session(reads or L.Reads(db, drv), user), payload)
    except (sc.Defer, hubdb.Unreadable) as e:
        d = "deferred: " + str(e)[:160]
    out["timing"].setdefault(action, []).append(round(time.monotonic() - t, 2))
    return d


def env(d):
    return d.answer if isinstance(d, W.Decision) else {"deferred": d}


def said(d, status, message):
    e = env(d) or {}
    return e.get("status") == status and e.get("message") == message


def handed(d, record=False):
    return isinstance(d, W.Decision) and d.engine and d.answer is None and (d.record is not None) == record


def refusals(d):
    e = env(d) or {}
    return e.get("status"), (e.get("data") or {}).get("written"), (e.get("data") or {}).get("refused")


users = L.Reads(db, drv).users()
boss = next(u for u in users if not gsjs.str_(u.get("mergedinto")) and sc.is_master_email(u.get("email"))
            and gsjs.str_(u.get("role")) == "admin")
master = sc.user_from_row(boss)
base = {"display_name": "Check Person", "types": [], "client_key": "", "home_tenant": "", "app_denials": [],
        "visiting_member": "", "is_service": False}
staff_u = {**base, "id": "u-check-staff", "email": "staff.check@example.org", "role": "staff"}
admin = {**base, "id": "u-check-admin", "email": "admin.check@example.org", "role": "admin"}
manager = {**base, "id": "u-check-mgr", "email": "mgr.check@example.org", "role": "manager"}
WHO = W.who(master)

# ---- the staff: three on the roster and the Master with IST records, preferences, a driving row and a MAIS line ----
R = L.Reads(db, drv)
roster, mi = SP.roster_index(R), SP.master_index(R)
drv_idx, comp_idx = SP.driver_index(R, SP.DRIVER_TAB), SP.driver_index(R, SP.DRIVER_COMPLIANCE_TAB)
mais_tab = SP.cert_source_tab(R, "mais")
mais_rows = SP.cert_read_tab(R, mais_tab)
prefs_ref = db.resolve(SP.PREFS_TAB).ref
with_prefs = {gsjs.trim(gsjs.or_text(r.get("staff_key"))) for r in db.locations_rows(prefs_ref)}
ist = SP.ist_rows(R)
picked, bare = [], None
for k in roster["by_key"]:
    m = mi["rows"].get(k)
    if len(roster["by_key"][k]) != 1 or not m or m.get("ambiguous"):
        continue
    ctx = SP.person(R, k)
    raw = ctx.get("master_edit") or {}
    d = drv_idx["rows"].get(k)
    if not d and k not in drv_idx["unsure"] and bare is None and ctx.get("master"):
        bare = (k, ctx)
    if len(picked) >= 3 or not d or d["ambiguous"] or k not in with_prefs or not comp_idx["rows"].get(k):
        continue
    if name_key(gsjs.text(raw.get("first_name", "") + " " + raw.get("last_name", ""))) != k:
        continue
    try:
        mais = SP.mais_from(R, mais_rows, k, R.today(), 0)
    except sc.Defer:
        continue
    mine = [r for r in ist if name_key(r.get("staffName")) == k]
    if mais["certs"] and not mais["ambiguous"] and mine and ctx.get("account") and ctx["master"].get("employee_id"):
        picked.append((k, ctx, mine, mais))
for k, ctx, mine, _m in picked + ([(bare[0], bare[1], [], None)] if bare else []):
    SECRET.extend([k, ctx["name"], gsjs.text(ctx["name"])] + [gsjs.or_text(r.get("id")) for r in mine])
check("three staff with IST records, preferences, a driving row and a MAIS line, and one with no driving row",
      len(picked) == 3 and bare, f"{len(picked)} picked, bare {bool(bare)}")
(k1, ctx1, ist1, mais1), (k2, ctx2, ist2, _m2), (k3, ctx3, ist3, mais3) = picked[:3]
notes_sid = db.resolve(SP.NOTES_TAB).sheet_id
ist_sid = db.resolve(SW.IST_TAB).sheet_id

# ---- the gates ----
check("note: an admin who is not the master is told Unknown action",
      env(decide("staffProfileNoteAdd", {"staff": k1, "details": "x"}, admin)) == UNKNOWN)
check("note state: a manager is told Unknown action",
      env(decide("staffProfileNoteState", {"id": "SN_x", "state": "resolved", "staff": k1}, manager)) == UNKNOWN)
for action in ("staffProfileEdit", "staffProfileRename", "staffProfileDrivingEdit", "staffProfileMaisEdit",
               "staffProfileIstEdit", "staffProfilePreferencesSave"):
    check(f"{action}: anyone but the master is told Unknown action",
          env(decide(action, {"key": k1, "staff": k1, "changes": []}, admin)) == UNKNOWN)
whole = SP.whole_gate(L.Session(L.Reads(db, drv), staff_u))
check("training: a staff account assigning someone else is told Unknown action",
      env(decide("staffProfileAssignTraining", {"staff": k1, "details": "x"}, staff_u)) == UNKNOWN)
check("lane: the resolver's roles and types, as it says them",
      main.policy_gate(SW, "staffProfileNoteAdd", {}, staff_u) == {"status": 403, "message": "This action is for admin or manager."}
      and main.policy_gate(SW, "staffProfilePreferencesSave", {"prefs": []}, master) == {"status": 400, "message": "prefs must be object, got array."}
      and main.policy_gate(SW, "staffProfileEdit", {"changes": "x"}, master) == {"status": 400, "message": "changes must be array, got string."}
      and main.policy_gate(SW, "staffProfileEdit", {"confirm_login_email": "yes"}, master) == {"status": 400, "message": "confirm_login_email must be boolean, got string."})
check("a malformed staff key is the door's 400", said(decide("staffProfileNoteAdd", {"staff": "A B", "details": "x"}, master),
                                                      400, "staff: a staff key."))
d = decide("staffProfileNoteAdd", {"staff": "zzzcheckzz", "details": "x"}, master)
check("an unknown staff key is the door's 404, resting on the copy being current",
      said(d, 404, "No staff member with that key.") and d.fresh is True, env(d))

# ---- notes ----
nb = lambda **kw: {"staff": k1, **kw}
check("note: no details is a 400", said(decide("staffProfileNoteAdd", nb(details="  "), master), 400, "details: what the note says."))
check("note: past 4000 characters is a 400", said(decide("staffProfileNoteAdd", nb(details="y" * 4001), master), 400,
                                                  "details: up to 4000 characters."))
check("note: an unknown category is a 400", said(decide("staffProfileNoteAdd", nb(details="x", category="gossip"), master), 400,
                                                 "category: one of general, performance, training, scheduling, hr."))
check("note: an unknown priority is a 400", said(decide("staffProfileNoteAdd", nb(details="x", priority="panic"), master), 400,
                                                 "priority: one of low, normal, high, urgent."))
check("note: a good note is Apps Script's to file (it mints the id and the time), nothing laid before",
      handed(decide("staffProfileNoteAdd", nb(details="Check note", category="Training", priority="HIGH"), master)))
ns = lambda **kw: {"id": "SN_check-0001", "state": "resolved", "staff": k1, **kw}
check("note state: no id is a 400", said(decide("staffProfileNoteState", ns(id=" "), master), 400, "id: which note."))
check("note state: an unknown state is a 400", said(decide("staffProfileNoteState", ns(state="deleted"), master), 400,
                                                    "state: open or resolved."))
check("note state: a witness that is not a staff key is a 400", said(decide("staffProfileNoteState", ns(staff="A"), master), 400,
                                                                     "staff: a staff key."))
d = decide("staffProfileNoteState", ns(id="SN_nope"), master)
check("note state: a note the tab does not hold is a 404, resting on the notes book",
      said(d, 404, 'No staff note "SN_nope".') and d.fresh == (notes_sid,), env(d))


class NotesOwn(CW.Own):
    """The own layer with the staff_notes tab a first note makes, as Apps Script's hubTabEnsure_ does."""

    def virtual(self, sheet_id, tab):
        if tab == SP.NOTES_TAB and any(w.get("tab_name") == tab and w.get("kind") == "append" for w in self.items):
            return hubdb.TabRef(sheet_id, tab, "", ("id", "staff_key", "staff_name", "category", "priority", "details",
                                                    "state", "by", "at", "state_by", "state_at"), None, -1)
        return super().virtual(sheet_id, tab)


note = {"id": "SN_check-0001", "staff_key": k1, "staff_name": ctx1["name"], "category": "general", "priority": "normal",
        "details": "Check note", "state": "open", "by": WHO, "at": "2026-10-09T00:00:00.000Z", "state_by": "",
        "state_at": ""}
filed = {"write_id": "Wcheck-note", "house": k1, "sheet_id": notes_sid, "tab_name": SP.NOTES_TAB, "kind": "append",
         "match": "id", "keyed": "header", "row_key": note["id"], "cells": note, "state": "written",
         "accepted_at": time.time() - 5, "written_at": time.time() - 2}
tok = hubdb.OWN.set(NotesOwn([filed], book=db.book))
try:
    check("note state: a note of another staff member is a 409",
          said(decide("staffProfileNoteState", ns(staff=k2), master), 409,
               "That note belongs to another staff member — reload the profile."))
    d = decide("staffProfileNoteState", ns(), master)
finally:
    hubdb.OWN.reset(tok)
rec = d.record if isinstance(d, W.Decision) else None
check("note state: Apps Script writes the three cells; they are laid by the note's id once it answers",
      handed(d, record=True) and rec["kind"] == "edit" and rec["match"] == "id" and rec["row_key"] == note["id"]
      and rec["house"] == k1 and rec["sheet_id"] == notes_sid and rec["tab_name"] == SP.NOTES_TAB
      and set(rec["cells"]) == {"state", "state_by", "state_at"} and rec["cells"]["state"] == "resolved"
      and rec["cells"]["state_by"] == WHO and ISO.match(rec["cells"]["state_at"]), [env(d), rec])
if rec:
    state = {**filed, "write_id": "Wcheck-state", "kind": "edit", "cells": rec["cells"], "accepted_at": time.time() - 1}
    own = NotesOwn([filed, state], book=db.book)
    tok = hubdb.OWN.set(own)
    try:
        read = SC.ACTIONS["staffProfileNotes"](L.Session(L.Reads(db, drv), master), {"staff": k1})
    finally:
        hubdb.OWN.reset(tok)
    got = next((n for n in (read.get("data") or {}).get("notes") or [] if n.get("id") == note["id"]), {})
    check("own layer: the note and its state Python laid show in the notes read at once",
          read.get("status") == 200 and got.get("state") == "resolved" and got.get("state_by") == WHO
          and {"Wcheck-note", "Wcheck-state"} <= own.held, [read.get("status"), got.get("state")])

# ---- an IST record ----
shown1 = SP.ist_cell(ist1[0], {})
iid = shown1["id"]
ie = lambda changes, **kw: {"key": k1, "id": iid, "changes": changes, **kw}
check("IST: no id is a 400", said(decide("staffProfileIstEdit", ie([{"field": "status", "value": "done", "expected": ""}], id=""), master),
                                  400, "id: which IST record."))
e = env(decide("staffProfileIstEdit", ie([{"field": "bogus", "value": "x", "expected": ""},
                                          {"field": "status", "value": "maybe", "expected": shown1["status"]},
                                          {"field": "due", "value": "soon", "expected": shown1["due"]}]), master))
check("IST: a field it does not edit, a status that is not owed or done and a due that is not a date, each refused",
      e == {"status": 200, "data": {"written": [], "refused": [
          {"field": "bogus", "why": "Not a field the IST record edits."}, {"field": "status", "why": "Owed or done."},
          {"field": "due", "why": "A date."}]}}, e)
d = decide("staffProfileIstEdit", ie([{"field": "status", "value": "done", "expected": ""}], id="IST_nope_zz"), master)
check("IST: a record the tab does not hold is a 404, resting on the IST book",
      said(d, 404, 'No IST record "IST_nope_zz".') and d.fresh == (ist_sid,), env(d))
other = SP.ist_cell(ist2[0], {})["id"]
check("IST: another staff member's record is a 409",
      said(decide("staffProfileIstEdit", ie([{"field": "status", "value": "done", "expected": ""}], id=other), master), 409,
           "That IST record names another staff member — reload the profile."))
e = env(decide("staffProfileIstEdit", ie([{"field": "due", "value": "2026-12-01", "expected": "zz"}]), master))
check("IST: a stale witness is the 409 carrying what the record holds",
      e == {"status": 409, "data": {"written": [], "refused": [], "current": {"due": shown1["due"]}},
            "message": CW.STALE_ALL}, e)
flip = "owed" if shown1["status"] == "done" else "done"
d = decide("staffProfileIstEdit", ie([{"field": "status", "value": flip, "expected": shown1["status"]},
                                      {"field": "due", "value": "2026-12-01", "expected": shown1["due"]},
                                      {"field": "trained_at", "value": "zz", "expected": shown1["trained_at"]}]), master)
rec = d.record if isinstance(d, W.Decision) else None
check("IST: Apps Script updates the record (its own checks first); the cells laid by its id once it answers",
      handed(d, record=True) and rec["kind"] == "edit" and rec["match"] == "id" and rec["row_key"] == iid
      and rec["house"] == k1 and rec["sheet_id"] == ist_sid and rec["cells"] == {"status": flip, "dueDate": "2026-12-01"},
      [env(d), rec and rec["cells"]])
if rec:
    item = {"write_id": "Wcheck-ist", "house": k1, "sheet_id": rec["sheet_id"], "tab_name": rec["tab_name"], "kind": "edit",
            "match": "id", "keyed": "header", "row_key": iid, "cells": rec["cells"], "state": "written",
            "accepted_at": time.time() - 3, "written_at": time.time() - 1}
    own = CW.Own([item], book=db.book)
    tok = hubdb.OWN.set(own)
    try:
        laid = next((SP.ist_cell(r, {}) for r in SP.ist_mine(L.Reads(db, drv), ctx1) if gsjs.or_text(r.get("id")) == iid), {})
    finally:
        hubdb.OWN.reset(tok)
    check("own layer: the IST edit shows in the person's IST records at once",
          laid.get("status") == flip and laid.get("due") == "2026-12-01" and "Wcheck-ist" in own.held, laid)

# ---- the record edit ----
ed = lambda changes, key=k1: {"key": key, "changes": changes}
check("edit: changes that are not a list are a 400",
      said(decide("staffProfileEdit", {"key": k1, "changes": None}, master), 400, "changes: one or more { field, value, expected }."))
e = env(decide("staffProfileEdit", ed([{"field": "ssn", "value": "1", "expected": ""}, {"field": "first_name", "value": "X", "expected": ""},
                                        {"field": "employee_id", "value": "1", "expected": ""},
                                        {"field": "favorite", "value": "x", "expected": ""}]), master))
check("edit: SSN, the name, the payroll id and an unknown field each refused in the door's words",
      e == {"status": 200, "data": {"written": [], "refused": [
          {"field": "ssn", "why": SP.EDIT_PROTECTED}, {"field": "first_name", "why": SP.EDIT_RENAME},
          {"field": "employee_id", "why": "The payroll id: read-only here."},
          {"field": "favorite", "why": "Not a field this app edits."}]}}, e)
check("edit: a Master field is Apps Script's to witness on the live row and write",
      SP.edit_refusal(ctx1, "status") == "" and handed(decide("staffProfileEdit", ed([{"field": "status", "value": "Active",
                                                                                         "expected": "x"}]), master)))
check("edit: an account field is Apps Script's (the sign-in account)",
      handed(decide("staffProfileEdit", ed([{"field": "account_emails", "value": "", "expected": ""}]), master)))
bk, bctx = bare
d = decide("staffProfileEdit", ed([{"field": "phone", "value": "1", "expected": ""}], key=bk), master)
want = SP.edit_refusal(bctx, "phone")
check("edit: a field the person's record cannot take is refused as spEditRefusal_ says, or handed when it can",
      handed(d) if not want else (env(d) == {"status": 200, "data": {"written": [], "refused": [{"field": "phone", "why": want}]}}),
      [want, env(d)])

# ---- the address (My Profile's door, decided alike) ----
ad = lambda changes: {"key": k1, "changes": changes}
e = env(decide("staffProfileAddressEdit", ad([{"field": "phone", "value": "1", "expected": ""},
                                               {"field": "state", "value": "zz", "expected": ""},
                                               {"field": "zip", "value": "4430", "expected": ""},
                                               {"field": "city", "value": "Akron1", "expected": ""},
                                               {"field": "address", "value": "123", "expected": ""}]), master))
check("address: a field it does not change, a state, a zip, a city and a street each refused in the door's words",
      e == {"status": 200, "data": {"written": [], "refused": [
          {"field": "phone", "why": SW.ADDRESS_WORDS["only"]}, {"field": "state", "why": SW.ADDRESS_WORDS["state"]},
          {"field": "zip", "why": SW.ADDRESS_WORDS["zip"]}, {"field": "city", "why": SW.ADDRESS_WORDS["city"]},
          {"field": "address", "why": SW.ADDRESS_WORDS["address"]}], "staff_key": k1}}, e)
check("address: a good city is Apps Script's to witness and write",
      SP.edit_refusal(ctx1, "city") != "" or handed(decide("staffProfileAddressEdit", ad([{"field": "city", "value": "Akron",
                                                                                            "expected": "x"}]), master)))
d = decide("staffProfileAddressEdit", {"changes": [{"field": "city", "value": "Akron", "expected": ""}]}, staff_u)
check("address: an account with no users row of its own is refused from its own session (never another's)",
      (env(d) or {}).get("status") in (403, 409) or isinstance(d, str), env(d))

# ---- the rename ----
rn = lambda changes: {"key": k1, "changes": changes}
raw1 = ctx1["master_edit"]
check("rename: no name field is a 400", said(decide("staffProfileRename", rn([{"field": "status", "value": "x", "expected": ""}]), master),
                                         400, "changes: first_name or last_name."))
check("rename: a blank first name is a 400",
      said(decide("staffProfileRename", rn([{"field": "first_name", "value": "", "expected": raw1["first_name"]}]), master), 400,
           "A first and a last name are required."))
raw2 = ctx2["master_edit"]
d = decide("staffProfileRename", rn([{"field": "first_name", "value": raw2["first_name"], "expected": raw1["first_name"]},
                                     {"field": "last_name", "value": raw2["last_name"], "expected": raw1["last_name"]}]), master)
check("rename: another staff record's name is a 409", said(d, 409, "Another staff record already carries that name — nothing was renamed.")
      and d.fresh is True, env(d))
check("rename: the same name is Apps Script's to write (no other record checked)",
      handed(decide("staffProfileRename", rn([{"field": "first_name", "value": raw1["first_name"], "expected": raw1["first_name"]}]), master)))
check("rename: a new name is carried by Apps Script into the Master, the account and every tab of ours",
      handed(decide("staffProfileRename", rn([{"field": "first_name", "value": "Checkname", "expected": raw1["first_name"]},
                                              {"field": "last_name", "value": "Zzyzx", "expected": raw1["last_name"]}]), master)))

# ---- the driving record ----
dv = lambda changes, key=k1: {"key": key, "changes": changes}
e = env(decide("staffProfileDrivingEdit", dv([{"field": "dl", "value": "1", "expected": ""},
                                               {"field": "favorite", "value": "x", "expected": ""}]), master))
check("driving: the licence number and an unknown field each refused", e == {"status": 200, "data": {"written": [], "refused": [
    {"field": "dl", "why": SP.EDIT_PROTECTED}, {"field": "favorite", "why": "Not a field the driving record edits."}]}}, e)
fields1 = drv_idx["rows"][k1]["fields"]
comp1 = comp_idx["rows"][k1]["fields"]
d = decide("staffProfileDrivingEdit", dv([{"field": "points", "value": "3", "expected": "zz"},
                                           {"field": "standing", "value": "Valid", "expected": "zz"}]), master)
check("driving: stale witnesses on both tabs are the 409 carrying what each row shows",
      env(d) == {"status": 409, "data": {"written": [], "refused": [], "current": {
          "points": SW.driving_shown(fields1, "points"), "standing": SW.driving_shown(comp1, "driver")}}, "message": CW.STALE_ALL}
      and d.fresh == (SP.emp_db_id(R),), env(d))
check("driving: a field whose witness holds is Apps Script's (it checks the cell does not compute itself, then writes)",
      handed(decide("staffProfileDrivingEdit", dv([{"field": "driver", "value": "Yes",
                                                    "expected": SW.driving_shown(fields1, "driver")}]), master)))
e = env(decide("staffProfileDrivingEdit", dv([{"field": "license_exp", "value": "2030-01-01", "expected": ""}], key=bk), master))
check("driving: a person no row of the tab names is refused in its words",
      e == {"status": 200, "data": {"written": [], "refused": [
          {"field": "license_exp", "why": "No row of the employee driver tab names this person."}]}}, e)

# ---- the MAIS line ----
ma = lambda changes, level: {"key": k1, "level": level, "changes": changes}
cert1 = mais1["certs"][0]
check("MAIS: no level is a 400", said(decide("staffProfileMaisEdit", ma([{"field": "status", "value": "x", "expected": ""}], " "), master),
                                      400, "level: which Cat level."))
e = env(decide("staffProfileMaisEdit", ma([{"field": "bogus", "value": "x", "expected": ""}], cert1["level"]), master))
check("MAIS: a field it does not edit is refused", e == {"status": 200, "data": {"written": [], "refused": [
    {"field": "bogus", "why": "Not a field the MAIS line edits."}]}}, e)
e = env(decide("staffProfileMaisEdit", ma([{"field": "status", "value": "x", "expected": ""}], "Cat - Zz"), master))
check("MAIS: a Cat level no line names is refused", e == {"status": 200, "data": {"written": [], "refused": [
    {"field": "status", "why": "No MAIS line of that Cat level names this person."}]}}, e)
e = env(decide("staffProfileMaisEdit", ma([{"field": "status", "value": "Certified", "expected": "zz"},
                                           {"field": "expires", "value": "2027-01-01", "expected": "zz"}], cert1["level"]), master))
check("MAIS: stale witnesses are the 409 carrying what the line shows",
      e == {"status": 409, "data": {"written": [], "refused": [], "current": {"status": cert1["word"], "expires": cert1["expires"]}},
            "message": CW.STALE_ALL}, e)
check("MAIS: a field whose witness holds is Apps Script's to check and write",
      handed(decide("staffProfileMaisEdit", ma([{"field": "expires", "value": "2027-01-01", "expected": cert1["expires"]}],
                                               cert1["level"]), master)))

# ---- preferences ----
built = SP.prefs_build(L.Reads(db, drv), ctx1)
pr = lambda **kw: {"staff": k1, "prefs": built.get("prefs") or {}, **kw}
check("preferences: prefs that are not an object are the door's 400",
      said(decide("staffProfilePreferencesSave", pr(prefs="x"), master), 400, "prefs: the preferences."))
d = decide("staffProfilePreferencesSave", pr(expected="2001-01-01T00:00:00.000Z"), master)
check("preferences: a stale stamp is the 409 carrying the row as the read shows it",
      env(d) == {"status": 409, "message": SW.PREFS_STALE, "data": {"current": {
          "prefs": built["prefs"], "updated_at": built["updated_at"], "updated_by": built["updated_by"]}}}
      and d.fresh == (db.resolve(SP.PREFS_TAB).sheet_id,), env(d))
check("preferences: the stamp the section opened on is Apps Script's to save (it stamps the row anew)",
      handed(decide("staffProfilePreferencesSave", pr(expected=built["updated_at"]), master)))

# ---- training ----
at = lambda **kw: {"staff": k1, **kw}
check("training: a request with no details is a 400", said(decide("staffProfileAssignTraining", at(details=""), master), 400,
                                                           "details: the training and its instructions."))
check("training: a request with an unknown priority is a 400",
      said(decide("staffProfileAssignTraining", at(details="x", priority="panic"), master), 400,
           "priority: one of low, normal, high, urgent."))
check("training: a request is Apps Script's to file as a training note",
      handed(decide("staffProfileAssignTraining", at(details="Check training", priority="high"), master)))
check("training: a due day that is not yyyy-MM-dd is a 400",
      said(decide("staffProfileAssignTraining", at(house="ABD1305", due_date="soon"), master), 400, "due_date: a day as yyyy-MM-dd."))
check("training: a malformed house is a 400", said(decide("staffProfileAssignTraining", at(house="nope"), master), 400,
                                                   "house: a house code, such as ABD1305."))
d = decide("staffProfileAssignTraining", at(house="ZZZ999"), master)
check("training: a house no one carries is a 404", said(d, 404, 'No house "ZZZ999" is on the registry or on a client.'), env(d))
code = L.house_code(ist1[0].get("house"))
d = decide("staffProfileAssignTraining", at(house=code, due_date="2026-12-01"), master)
check("training: an IST at a house with clients is Apps Script's to file (it mints the rows), or the door's 409 when none map",
      handed(d) or (said(d, 409, (env(d) or {}).get("message")) and str((env(d) or {}).get("message")).startswith(code + " has no clients mapped")),
      env(d))
me = {**staff_u, "display_name": ctx1["name"]}
role = SP.training_assigner(L.Reads(db, drv), me, k1)
if role == "self":
    check("training: the person themselves files a request, never an IST at a house",
          handed(decide("staffProfileAssignTraining", at(details="Check"), me))
          and said(decide("staffProfileAssignTraining", at(house=code), me), 403, "An IST at a house is assigned by a manager."))

# ---- an HR issue ----
today = L.Reads(db, drv).today()
ok_issue = {"staff": k1, "date": today, "severity": "coaching", "category": "CONDUCT", "summary": "Check summary",
            "details": "Check details", "action": "", "next_review": ""}
for patch, message in (({"date": "x"}, "date: the incident day as yyyy-MM-dd."),
                       ({"date": "2999-01-01"}, "date: the day it happened, never a later one."),
                       ({"severity": "x"}, "severity: one of Coaching, Verbal warning, Written warning, Final warning."),
                       ({"category": "x"}, "category: one of Conflict, Dress code, Attendance, Conduct, Documentation, Other compliance."),
                       ({"summary": " "}, "summary: one line naming the concern."),
                       ({"summary": "s" * 201}, "summary: up to 200 characters."),
                       ({"details": ""}, "details: what was reported."),
                       ({"details": "d" * 4001}, "details: up to 4000 characters."),
                       ({"action": "a" * 2001}, "action: up to 2000 characters."),
                       ({"next_review": "soon"}, "next_review: a day as yyyy-MM-dd."),
                       ({"date": "2026-02-30"}, "The date must be a calendar day (yyyy-mm-dd) — the tracker keeps them as "
                                                "M/D/YYYY and sorts on that shape.")):
    check(f"HR issue: {message}", said(decide("staffProfileHrIssueAdd", {**ok_issue, **patch}, master), 400, message))
check("HR issue: a good issue is Apps Script's to append to the HR tracker",
      handed(decide("staffProfileHrIssueAdd", ok_issue, master)))
d = decide("staffProfileHrIssueAdd", ok_issue, staff_u)
check("HR issue: a staff account Staff is released to whole is denied by the tracker's door; one it is not, Unknown action",
      env(d) == ({"status": 403, "message": "Requires an admin or manager account"} if whole else UNKNOWN), [whole, env(d)])


# ---- the lane (app/main.py), its store stood in ----
class FakeTx:
    def __init__(self, s): self.s = s
    def receipt(self, wid): return self.s.receipts.get(wid)
    def live(self): return []
    def record(self, wid, action, env_, decision, author):
        self.s.receipts.setdefault(wid, env_)
        if decision.record is not None:
            self.s.records[wid] = decision.record


class FakeStore:
    available = True
    why = ""
    def __init__(self): self.receipts, self.records = {}, {}
    def ready(self): return True
    def live(self): return []
    def finish(self, done): pass
    @contextlib.contextmanager
    def locked(self):
        yield FakeTx(self)


main.STORE, main.CLIENT_STORE, main.STAFF_STORE = FakeStore(), FakeStore(), FakeStore()
main.SSA_STORE, main.FAMILY_STORE = FakeStore(), FakeStore()
boss_said = {"uid": master["id"], "role": "admin", "is_master": True}
res = main._run_write(SW, "staffProfileNoteAdd", boss_said, {"staff": k1, "details": ""}, "Wcheck-lane-01")
body = json.loads(res.body)
check("lane: a refusal is the door's envelope, kept once in the Staff store's receipts",
      res.status_code == 200 and body == {"status": 400, "message": "details: what the note says."}
      and "Wcheck-lane-01" in main.STAFF_STORE.receipts and not main.STORE.receipts and not main.CLIENT_STORE.receipts, body)
res = main._run_write(SW, "staffProfileIstEdit", boss_said, ie([{"field": "status", "value": flip, "expected": shown1["status"]}]),
                      "Wcheck-lane-02")
body = json.loads(res.body)
plan = body.get("_write") or {}
check("lane: an IST edit is handed to Apps Script, names its staff member and records the cells it files",
      res.status_code == 200 and plan.get("engine") is True and plan.get("settle") is True and plan.get("house") == k1
      and main.STAFF_STORE.records.get("Wcheck-lane-02", {}).get("cells") == {"status": flip}, body)
res = main._run_write(SW, "staffProfileNoteAdd", boss_said, {"staff": k1, "details": "Check"}, "Wcheck-lane-03")
plan = json.loads(res.body).get("_write") or {}
check("lane: a note is handed on with nothing to lay (the relay keys it by the payload's staff)",
      plan.get("engine") is True and plan.get("settle") is False and plan.get("house") == ""
      and "Wcheck-lane-03" not in main.STAFF_STORE.records, plan)

# ---- the store's SQL: made, recorded, settled — inside one transaction rolled back ----
import psycopg
dsn = os.environ.get("HUB_DB_WRITE_DSN", "")
if dsn:
    conn = psycopg.connect(dsn, autocommit=True, connect_timeout=5)
    q = "select to_regclass('app.staff_writes') is not null, to_regclass('app.staff_receipts') is not null, (select count(*) from pg_tables where schemaname = 'app')"
    before = conn.execute(q).fetchone()
    seen = {}
    try:
        with conn.transaction():
            st = SW.Store(dsn="", connect=lambda: conn)
            seen["ensure"] = st.ensure()
            tx = W.Tx(conn.cursor(), "staff")
            idec = decide("staffProfileIstEdit", ie([{"field": "status", "value": flip, "expected": shown1["status"]}]), master)
            ndec = decide("staffProfileNoteAdd", nb(details="Check"), master)
            tx.record("Wcheck-sql-01", "staffProfileIstEdit", W.envelope(idec, "Wcheck-sql-01", master), idec, WHO)
            tx.record("Wcheck-sql-02", "staffProfileNoteAdd", W.envelope(ndec, "Wcheck-sql-02", master), ndec, WHO)
            seen["receipt"] = tx.receipt("Wcheck-sql-02") == json.loads(json.dumps(W.envelope(ndec, "Wcheck-sql-02", master)))
            seen["rows"] = conn.execute("select write_id, state from app.staff_writes order by write_id").fetchall()
            seen["live_before"] = [w["write_id"] for w in st.live()]
            seen["settled"] = st.settle("Wcheck-sql-01", "written")
            seen["live_after"] = [(w["write_id"], w["cells"], w["match"]) for w in st.live()]
            st.finish({"Wcheck-sql-01": "retired"})
            seen["retired"] = conn.execute("select state from app.staff_writes where write_id = 'Wcheck-sql-01'").fetchone()[0]
            seen["void"] = st.settle("Wcheck-sql-01", "void")
            raise psycopg.Rollback()
    finally:
        after = conn.execute(q).fetchone()
        conn.close()
    check("store: the Staff tables are made by the writer role (db/app-writer.sql owns schema app)", seen.get("ensure") == "", seen.get("ensure"))
    check("store: a handed write with cells is kept as decided, one with none as a receipt alone",
          seen.get("receipt") is True and [tuple(r) for r in seen.get("rows") or []] == [("Wcheck-sql-01", "decided")], seen)
    check("store: laid only once Apps Script answered it (written), with its cells",
          seen.get("live_before") == [] and seen.get("settled") is True
          and seen.get("live_after") == [("Wcheck-sql-01", {"status": flip}, "id")], seen)
    check("store: retired by a read, and a settled write is never voided", seen.get("retired") == "retired" and seen.get("void") is False, seen)
    check("store: rolled back — app.* holds what it held before", tuple(before) == tuple(after), [before, after])
else:
    check("store: HUB_DB_WRITE_DSN is set in the runner", False, "unset")

print(json.dumps(out, default=str))
'''


RELAY = r'''
import asyncio, base64, importlib.abc, importlib.util, json, os, sys, time, urllib.parse
sources = json.loads(base64.b64decode(RELAY_SOURCES))


class Checkout(importlib.abc.MetaPathFinder, importlib.abc.Loader):
    def find_spec(self, name, path, target=None):
        return importlib.util.spec_from_loader(name, self, origin="checkout:" + name) if name in sources else None

    def create_module(self, spec):
        return None

    def exec_module(self, module):
        module.__file__ = "/srv/app/" + module.__name__ + ".py"
        exec(compile(sources[module.__name__], "checkout/" + module.__name__ + ".py", "exec"), module.__dict__)


# no key, no probe, no disk of the live relay: the module is imported, never started
os.environ["QUO_HOTLINE_WEBHOOK_KEY_FILE"] = "/nonexistent/staff-writes-test.key"
os.environ["HUB_PSI_PROBE"] = "0"
os.environ["HUB_PSI_SECRET_FILE"] = "/nonexistent/staff-writes-test.json"
os.environ["HUB_PSI_TY_SECRET_FILE"] = "/nonexistent/staff-writes-test-ty.json"
os.environ["HUB_PSI_FULL_DIR"] = "/tmp/staff-writes-test-psi-full"
os.environ.pop("QUO_HOTLINE_WEBHOOK_KEY", None)
os.environ["HUB_QUO_MESSAGES_KEY_FILE"] = "/nonexistent/staff-writes-test-messages.key"
os.environ["HUB_QUO_API_KEY_FILE"] = "/nonexistent/staff-writes-test-api.key"
os.environ["HUB_QUO_INBOX_DIR"] = "/nonexistent/staff-writes-test-inbox"
sys.meta_path.insert(0, Checkout())
sys.path.insert(0, "/srv/app")
import snapshot_service as S

checks, settled, keyed, answers = [], [], [], {}


def check(name, ok, detail=""):
    checks.append([name, bool(ok), "" if ok else str(detail)[:300]])


async def yes(_a):
    return True


async def actor(_a):
    return ("admin", "u-check")


async def master(_a):
    return (True, "")


async def call(app_id, action, payload, user, extra=None, timeout=None):
    env = json.loads(json.dumps(answers[action]))
    return json.dumps(env).encode(), time.time() + 5, env, frozenset(), 0.0


real_after = S._backend_written_after


def after(app_id, key, as_of, held=None, *, any_key=False, pack="", edits_at=0.0):
    keyed.append((app_id, key, any_key))
    return real_after(app_id, key, as_of, held, any_key=any_key, pack=pack, edits_at=edits_at)


S.EXEC_URL = S.EXEC_URL or "https://stub.invalid/exec"
S.HUB_APP_TOKEN = "check-token"
S._backend_wanted, S._session_actor, S._app_pack_master, S._backend_call = yes, actor, master, call
S._relay_is_service = lambda raw: False
S._backend_settling = lambda: False
S._backend_written_after = after
S._backend_settle_soon = lambda app_id, wid, state, why="", fields=None, house="": settled.append((app_id, wid, state))
S._traffic_note = lambda *a, **k: None


def raw_of(action, payload):
    return urllib.parse.urlencode({"body": json.dumps({"action": action, "token": "tok-check", "payload": payload,
                                                       "write_id": "Wcheck-relay-" + action})}).encode()


async def go():
    check("relay: the ten Staff writes go to Python under the Staff switch; a visit does not, and My Profile's address "
          "rides My Profile's switch",
          {a for a, app in S._BACKEND_WRITES.items() if app == "staff"} == set(STAFF_ROUTED)
          and S._BACKEND_WRITES.get("staffProfileAddressEdit") == "my-profile"
          and "staffProfileVisit" not in S._BACKEND_WRITES)
    answers["staffProfileEdit"] = {"status": 200, "data": {"written": [], "refused": [{"field": "ssn", "why": "x"}]}}
    keyed.clear()
    res, _raw, settle = await S._backend_write("staffProfileEdit", raw_of("staffProfileEdit", {"key": "annlee", "changes": []}))
    check("relay: a Staff refusal is Python's answer, keyed by the payload's `key`",
          res is not None and json.loads(res.body) == answers["staffProfileEdit"] and settle is None
          and keyed == [("staff", "annlee", False)], [keyed, getattr(res, "body", None)])
    answers["staffProfileNoteAdd"] = {"status": 200, "_write": {"write_id": "Wcheck-relay-staffProfileNoteAdd",
                                                                 "engine": True, "settle": False, "house": ""}}
    keyed.clear()
    res, _raw, settle = await S._backend_write("staffProfileNoteAdd", raw_of("staffProfileNoteAdd", {"staff": "annlee", "details": "x"}))
    check("relay: a Staff write Python hands on goes to Apps Script, keyed by the payload's `staff`, nothing to lay",
          res is None and settle is None and keyed == [("staff", "annlee", False)] and not settled, [keyed, settled])
    answers["staffProfileIstEdit"] = {"status": 200, "_write": {"write_id": "Wcheck-relay-staffProfileIstEdit",
                                                                 "engine": True, "settle": True, "house": "annlee"}}
    res, _raw, settle = await S._backend_write("staffProfileIstEdit", raw_of("staffProfileIstEdit", {"key": "AnnLee", "id": "x"}))
    check("relay: a Staff write with cells is settled by the staff member it names once Apps Script answers",
          res is None and settle == {"app": "staff", "write_id": "Wcheck-relay-staffProfileIstEdit", "house": "annlee"}, settle)
    settled.clear()
    S._backend_engine_answered(settle, json.dumps({"status": 200, "data": {"written": [], "refused": [{"field": "status"}]}}).encode())
    S._backend_engine_answered(settle, json.dumps({"status": 200, "data": {"written": ["status"], "refused": []}}).encode())
    S._backend_engine_answered({"app": "clients", "write_id": "Wcheck-c", "house": "x_y"},
                               json.dumps({"status": 200, "data": {"written": [], "refused": []}}).encode())
    check("relay: a Staff door's 200 that wrote nothing is not laid; one that wrote is; Clients' as before",
          settled == [("staff", "Wcheck-relay-staffProfileIstEdit", "refused"),
                      ("staff", "Wcheck-relay-staffProfileIstEdit", "written"), ("clients", "Wcheck-c", "written")], settled)
    answers["clientProfileSave"] = {"status": 200, "data": {"written": [], "refused": [{"field": "ssn", "why": "x"}]}}
    keyed.clear()
    res, _raw, _settle = await S._backend_write("clientProfileSave", raw_of("clientProfileSave", {"client": "x_y", "key": "zzz"}))
    check("relay: a Clients write is keyed by its client as before (no other field read)",
          res is not None and keyed == [("clients", "x_y", False)], keyed)


asyncio.run(go())
print("RELAY-CHECKS " + json.dumps(checks))
'''


def run_relay(container: str) -> list[list[Any]]:
    """The relay's write path over fakes: its module imported from this checkout in its own container, never started."""
    sys.path.insert(0, str(APP))
    import staff_writes as SW  # noqa: PLC0415 - the module under test, on the host for its names alone
    src = {p.stem: p.read_text(encoding="utf-8") for p in (ROOT / "server").glob("*.py")}
    script = (f"RELAY_SOURCES = {base64.b64encode(json.dumps(src).encode()).decode()!r}\n"
              f"STAFF_ROUTED = {sorted(SW.ROUTED)!r}\n" + RELAY)
    decl = (ROOT / "server" / "ist_config_defaults.json").read_text(encoding="utf-8")
    got = subprocess.run(["docker", "exec", "-i", "-e", "HUB_IST_CONFIG_DECLARATION_JSON=" + decl, container, "python3", "-"],
                         input=script, capture_output=True, text=True, timeout=600)
    line = next((x for x in got.stdout.splitlines() if x.startswith("RELAY-CHECKS ")), "")
    if not line:
        return [["relay: the write path ran over fakes", False, got.stderr[-600:]]]
    return json.loads(line[len("RELAY-CHECKS "):])


def run(runner: str) -> dict[str, Any]:
    src = {n: (APP / f"{n}.py").read_text(encoding="utf-8") for n in MODULES}
    blob = {"order": list(MODULES), "src": src}
    got = subprocess.run(["docker", "exec", "-i", runner, "python", "-c", DRIVER],
                         input=base64.b64encode(json.dumps(blob).encode()) + b"\n", capture_output=True, timeout=1800)
    if got.returncode != 0:
        raise RuntimeError(f"the check did not run in {runner}: {got.stderr.decode()[-1500:]}")
    return json.loads(got.stdout.decode().strip().splitlines()[-1])


def backend_apps(source: str) -> dict[str, str]:
    """BACKEND_APPS's entries in the relay's source, each as its syntax tree says it."""
    for node in ast.parse(source).body:
        if isinstance(node, ast.AnnAssign) and getattr(node.target, "id", "") == "BACKEND_APPS":
            return {k.value: v for k, v in zip(node.value.keys, node.value.values)}
    return {}


def relay_checks() -> list[list[Any]]:
    """Locations' and Clients' entries in BACKEND_APPS are as committed."""
    now = (ROOT / "server" / "snapshot_service.py").read_text(encoding="utf-8")
    head = subprocess.run(["git", "-C", str(ROOT), "show", "HEAD:server/snapshot_service.py"], capture_output=True,
                          text=True).stdout
    cur, was = backend_apps(now), backend_apps(head)
    same = bool(was) and all(k in cur and ast.dump(cur[k]) == ast.dump(was[k]) for k in ("locations", "clients"))
    return [["relay: Locations' and Clients' entries are as committed", same, ""]]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--runner", default=RUNNER)
    ap.add_argument("--relay", default=RELAY_CONTAINER)
    args = ap.parse_args()
    if not shutil.which("docker"):
        print("test-staff-writes: skipped — no docker here")
        return 0
    out = run(args.runner)
    out["checks"].extend(relay_checks() + run_relay(args.relay))
    failed = 0
    for name, ok, detail in out["checks"]:
        print(f"  {'ok  ' if ok else 'FAIL'} {name}")
        if not ok:
            failed += 1
            print(f"       {detail}")
    slow = {a: max(t) for a, t in out["timing"].items()}
    print("\n  slowest decision per door (s): " + ", ".join(f"{a} {t}" for a, t in sorted(slow.items())))
    print(f"\ntest-staff-writes: {len(out['checks']) - failed} ok, {failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
