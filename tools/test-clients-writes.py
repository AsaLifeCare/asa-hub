#!/usr/bin/env python3
"""Clients' writes decided in Python (app/client_writes.py) against what the .gs doors answer, on real clients in the
running asa-hub-app: refusals and their words, the cells each write files, the own-write layer over the reads, the
lane (app/main.py) and the store's SQL. Nothing is written: no sheet is touched and the store's rows are rolled back."""
from __future__ import annotations

import argparse
import base64
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "app"
sys.path.insert(0, str(ROOT / "server"))
MODULES = ("gsjs", "hubdb", "scope", "drive", "locations", "clients", "client_meds", "client_sources", "client_app",
           "writes", "client_writes", "staff", "staff_comms", "staff_perf", "staff_app", "staff_writes", "ssa",
           "ssa_writes", "family", "family_writes", "main")
RUNNER = "asa-hub-app"

DRIVER = r'''
import base64, contextlib, json, os, re, sys, time, types
ISO = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$")
blob = json.loads(base64.b64decode(sys.stdin.readline()).decode())
for name in blob["order"]:
    m = types.ModuleType(name); m.__file__ = name + ".py"; sys.modules[name] = m
for name in blob["order"]:
    exec(compile(blob["src"][name], name + ".py", "exec"), sys.modules[name].__dict__)
import gsjs, hubdb, locations as L, scope as sc, drive as dr, clients as C, writes as W, client_writes as CW, main
from gsjs import name_key

db = hubdb.HubDb()
drv = dr.Drive()
out = {"checks": [], "lays": [], "timing": {}}
SECRET = []


def mask(s):
    s = str(s)
    for word in sorted(SECRET, key=len, reverse=True):
        if word:
            s = s.replace(word, "<client>")
    return s[:300]


def check(name, ok, detail=""):
    out["checks"].append([name, bool(ok), "" if ok else mask(detail)])


def decide(action, payload, user, reads=None):
    t = time.monotonic()
    try:
        d = CW.ACTIONS[action](L.Session(reads or L.Reads(db, drv), user), payload)
    except (sc.Defer, hubdb.Unreadable) as e:
        d = "deferred: " + str(e)[:160]
    out["timing"].setdefault(action, []).append(round(time.monotonic() - t, 2))
    return d


def env(d):
    return d.answer if isinstance(d, W.Decision) else {"deferred": d}


def said(d, status, message):
    e = env(d) or {}
    return e.get("status") == status and e.get("message") == message


def handed(d):
    return isinstance(d, W.Decision) and d.engine and d.answer is None


def lay_out(name, d, key):
    """The lay Python hands the relay, its client and prior values masked, for the overlay's own rules on the host."""
    lay = json.loads(json.dumps(d.lay))
    swap = lambda v: v.replace(key, "client_x") if isinstance(v, str) else v
    lay["house"], lay["key"], lay["target"] = swap(lay["house"]), swap(lay["key"]), swap(lay.get("target"))
    lay["prior"] = {f: "" for f in lay.get("prior") or {}}
    out["lays"].append([name, ACTION_OF[name], lay])


ACTION_OF = {}
users = L.Reads(db, drv).users()
boss = next(u for u in users if not gsjs.str_(u.get("mergedinto")) and sc.is_master_email(u.get("email"))
            and gsjs.str_(u.get("role")) == "admin")
master = sc.user_from_row(boss)
base = {"display_name": "Check Person", "types": [], "client_key": "", "home_tenant": "", "app_denials": [],
        "visiting_member": "", "is_service": False}
staff = {**base, "id": "u-check-staff", "email": "staff.check@example.org", "role": "staff"}
admin = {**base, "id": "u-check-admin", "email": "admin.check@example.org", "role": "admin"}
manager = {**base, "id": "u-check-mgr", "email": "mgr.check@example.org", "role": "manager"}
WHO = W.who(master)

# ---- the clients: two with a Hub row and a chart, one with no Hub row ----
R = L.Reads(db, drv)
rows = C.derived(R)
hub = C._hub(R, "clients")
hub_of = {}
for r in hub:
    hub_of.setdefault(gsjs.trim(gsjs.or_text(r.get("client_key"))) or name_key(r.get("name")), r)
picked, bare = [], None
for c in rows:
    k = gsjs.trim(gsjs.or_text(c.get("client_key"))) or name_key(c.get("name"))
    if not C.client_live(c):
        continue
    ctx = C.client_ctx(R, k)
    chart = C.meds_build(R, ctx, "meds")["rows"]
    if k in hub_of and len([m for m in chart if m.get("edit")]) >= 2 and len(picked) < 2:
        picked.append((k, ctx, chart))
    elif k not in hub_of and bare is None:
        bare = (k, ctx, chart)
for k, ctx, _ch in picked + ([bare] if bare else []):
    SECRET.extend([k, ctx["name"], gsjs.text(ctx["name"])])
check("two clients with a Hub row and a chart, and one with no Hub row, to decide on", len(picked) == 2 and bare,
      f"{len(picked)} with a row, bare {bool(bare)}")
sid_clients = db.resolve("clients").sheet_id
sid_meds = db.resolve("medications").sheet_id
sid_over = db.resolve("client_overrides").sheet_id

# ---- the gates ----
k1, ctx1, chart1 = picked[0]
k2, ctx2, chart2 = picked[1]
ok_payload = {"client": k1, "changes": [{"field": "workshop", "value": "x", "expected": "y"}]}
check("profile: a staff account the edition does not list is told Unknown action",
      env(decide("clientProfileSave", ok_payload, staff)) == {"status": 404, "message": "Unknown action."},
      env(decide("clientProfileSave", ok_payload, staff)))
check("rename: anyone but the master is told Unknown action (even an admin)",
      env(decide("clientProfileRename", {"client": k1, "changes": []}, admin)) == {"status": 404, "message": "Unknown action."})
check("status: anyone but the master is told Unknown action",
      env(decide("clientProfileStatus", {"client": k1, "changes": []}, staff)) == {"status": 404, "message": "Unknown action."})
check("family member: the master's alone (Unknown action for staff)",
      env(decide("clientProfileOverride", {"client": k1, "kind": "family", "target": "", "changes": []}, staff))
      == {"status": 404, "message": "Unknown action."})
check("an unknown client is a 404 in the door's words",
      said(decide("clientProfileSave", {"client": "nobody_here_zz", "changes": []}, master), 404,
           'No client "nobody_here_zz" is on file.'))
check("a malformed client key is a 400",
      said(decide("clientProfileSave", {"client": "a b", "changes": []}, master), 400,
           "client: the client key the roster gives."))
d = decide("emarMedDelete", {"id": "1"}, manager)
check("the eMAR list's own removal (no client) is Apps Script's", isinstance(d, str) and "names no client" in d, d)
check("clientCreate: a staff account is denied",
      said(decide("clientCreate", {"name": "Check Name"}, staff), 403, "Requires an admin or manager account"))
check("clientCreate: a one-word name is a 400",
      said(decide("clientCreate", {"name": "Bob"}, master), 400, "A full name (first and last) is required."))
# the door folds both the row's client_key and its name before matching the new name's fold
dup = next((gsjs.str_(r.get("name")) for r in hub if gsjs.str_(r.get("name")) and " " in gsjs.str_(r.get("name"))
            and (gsjs.trim(gsjs.or_text(r.get("client_key"))) or name_key(r.get("name"))) == name_key(gsjs.str_(r.get("name")))), "")
plan_keyed = next((gsjs.str_(r.get("name")) for r in hub if gsjs.str_(r.get("name")) and " " in gsjs.str_(r.get("name"))
                   and gsjs.trim(gsjs.or_text(r.get("client_key"))) not in ("", name_key(r.get("name")))
                   and not any((gsjs.trim(gsjs.or_text(x.get("client_key"))) or name_key(x.get("name"))) == name_key(r.get("name"))
                               for x in hub)), "")
SECRET.extend([dup, plan_keyed])
if dup:
    check("clientCreate: a name a Hub row is keyed by is a 409 in its words",
          said(decide("clientCreate", {"name": dup}, master), 409, '"' + dup + '" is already on the directory.'))
if plan_keyed:
    check("clientCreate: a name whose row is keyed by its plan key (first_last) is the same client: a 409",
          said(decide("clientCreate", {"name": plan_keyed}, master), 409, '"' + plan_keyed + '" is already on the directory.'))
d = decide("clientCreate", {"name": "Checkname Zzyzx", "clientNumber": "CL-0000", "houseName": "", "guardianName": "",
                            "status": "active"}, master)
cells = (d.record or {}).get("cells", {}) if isinstance(d, W.Decision) else {}
check("clientCreate: a new name is Apps Script's to file, its row laid once it is (cells as createRow_ files them)",
      handed(d) and d.record["kind"] == "append" and d.record["match"] == "client" and d.record["sheet_id"] == sid_clients
      and {k: v for k, v in cells.items() if k not in ("createdAt", "updatedAt")} == {
          "id": "CLI_checknamezzyzx", "client_key": "checknamezzyzx", "name": "Checkname Zzyzx", "clientNumber": "CL-0000",
          "client_number": "CL-0000", "houseName": "", "house": "", "guardianName": "", "status": "active",
          "created_by": gsjs.str_(master.get("email"))} and cells.get("createdAt") == cells.get("updatedAt"), env(d))
if handed(d):
    pend = {"write_id": "Wcheck-create", "house": "checknamezzyzx", "sheet_id": d.record["sheet_id"],
            "tab_name": d.record["tab_name"], "kind": "append", "match": "client", "keyed": "header",
            "row_key": "checknamezzyzx", "cells": d.record["cells"], "state": "written", "accepted_at": time.time() - 3,
            "written_at": time.time() - 1}
    tok = hubdb.OWN.set(CW.Own([pend], book=db.book))
    try:
        check("clientCreate: the same name again, while the first is laid, is the door's 409",
              said(decide("clientCreate", {"name": "Checkname  Zzyzx"}, master), 409, '"Checkname  Zzyzx" is already on the directory.'))
    finally:
        hubdb.OWN.reset(tok)
# a client's sign-in is Users' account doors' whole (users_accounts.client_user_create, tools/test-no-gas-fallbacks-app.py)
check("clientUserCreate is no door of the Clients' writes: Users' account doors make the login whole",
      "clientUserCreate" not in CW.ACTIONS and "clientUserCreate" not in CW.POLICY)

# ---- the profile pencil (clientProfileSave) ----
def edit_map(k):
    """cpEditLive_: each field's witness as the profile's read hands it, and the fields only Master Data fills."""
    r = L.Reads(db, drv)
    ctx = C.client_ctx(r, k)
    src = C.sources_of(r, ctx)
    edit = C.scrub(C.edit_raw(C.picker(ctx.get("row") or {}, src["mf"], src["tf"])))
    rests = set()
    for f, col in C.edit_columns().items():
        fell = []
        C.picker(ctx.get("row") or {}, src["mf"], src["tf"], fell)(*C.FIELD_NAMES.get(col, (col,)))
        if fell:
            rests.add(f)
    return edit, (rests if src["tstale"] else set())


TEXTS = ("workshop", "outcome", "transportation", "house_manager", "payee_rep", "food_stamp", "spending_limit",
         "guardian_relationship", "workshop_address", "medical_supply")
for label, (k, ctx, chart) in (("c1", picked[0]), ("c2", picked[1])) + ((("c3", bare),) if bare else ()):
    edit, rests = edit_map(k)
    row = hub_of.get(k)
    marker = sorted(C.edit_cleared(row.get("cleared_fields")) if row else {})
    f = next((x for x in TEXTS if edit.get(x) and x not in rests), None) or next(x for x in TEXTS if x not in rests)
    if rests:
        r = next(iter(sorted(rests)))
        d = decide("clientProfileSave", {"client": k, "changes": [{"field": r, "value": "x", "expected": edit.get(r, "")}]}, master)
        check(f"{label} profile: a field only Master Data fills, while its copy is past two weeks, is Apps Script's",
              isinstance(d, str) and "Master Data" in d, d)
    pay = lambda changes: {"client": k, "changes": changes}
    check(f"{label} profile: changes that are not a list are a 400",
          said(decide("clientProfileSave", {"client": k, "changes": None}, master), 400,
               "changes: one or more { field, value, expected }."))
    e = env(decide("clientProfileSave", pay([{"field": "ssn", "value": "1", "expected": ""},
                                              {"field": "name", "value": "X Y", "expected": ""},
                                              {"field": "status", "value": "Inactive", "expected": ""},
                                              {"field": "favorite", "value": "x", "expected": ""}]), master))
    check(f"{label} profile: SSN, the name, the status and an unknown field each refused in the door's words",
          e == {"status": 200, "data": {"written": [], "refused": [
              {"field": "ssn", "why": "Protected: never written from the Hub."},
              {"field": "name", "why": CW.EDIT_LOCKED["name"]}, {"field": "status", "why": CW.EDIT_LOCKED["status"]},
              {"field": "favorite", "why": "Not a field this app edits."}]}}, e)
    e = env(decide("clientProfileSave", pay([{"field": f, "value": "Check Value", "expected": "zz-not-it"}]), master))
    check(f"{label} profile: a stale witness is the 409 carrying what the record holds",
          e.get("status") == 409 and e.get("message") == CW.STALE_ALL and e["data"]["current"] == {f: edit.get(f, "")}
          and e["data"]["written"] == [], e)
    d = decide("clientProfileSave", pay([{"field": f, "value": "Check Value", "expected": edit.get(f, "")}]), master)
    ACTION_OF[label + " profile"] = "clientProfileSave"
    want_cells = {f if f != "guardian_name" else "guardianName": "Check Value"}
    if f in marker:
        want_cells["cleared_fields"] = ",".join(x for x in marker if x != f)
    rec = d.record if isinstance(d, W.Decision) else None
    if row is not None:
        cells_ok = rec and rec["kind"] == "edit" and rec["match"] == "client" and rec["cells"] == want_cells
    else:
        cells_ok = rec and rec["kind"] == "append" and {k2: v for k2, v in rec["cells"].items() if k2 not in ("createdAt", "updatedAt")} \
            == {"id": "CLI_" + k, "client_key": k, "name": ctx["name"], **want_cells}
    a = env(d) if isinstance(d, W.Decision) and d.answer else None
    check(f"{label} profile: an allowed change files {'its cell on the client row' if row else 'a new Hub row (createRow_)'}"
          f" and answers as cpEditSteps_", bool(cells_ok) and rec["sheet_id"] == sid_clients and rec["row_key"] == k and (
              handed(d) or (a["status"] == 200 and a["data"]["written"] == [f] and a["data"]["refused"] == []
                            and a["data"]["slices"] == ["clients"] and a["data"]["mirror"] == [] and a["data"]["app"] == "client-profiles"
                            and a["data"]["steps"][0]["words"] == CW.EDIT_WORDS["profile"][0]
                            and d.lay["fields"] == {f: "Check Value"} and d.deliver["changes"] == pay(
                                [{"field": f, "value": "Check Value", "expected": edit.get(f, "")}])["changes"])),
          [env(d), rec and rec["cells"]])
    if isinstance(d, W.Decision) and d.lay:
        lay_out(label + " profile", d, k)
        out.setdefault("profile_records", {})[label] = rec
    if edit.get(f) and row is not None:
        d = decide("clientProfileSave", pay([{"field": f, "value": "", "expected": edit.get(f)}]), master)
        want = {f: "", "cleared_fields": ",".join(sorted(set(marker) | {f}))} if f not in marker else {f: ""}
        check(f"{label} profile: a cleared field joins the row's cleared_fields marker",
              isinstance(d, W.Decision) and d.record and d.record["cells"] == want, d.record if isinstance(d, W.Decision) else d)
    e = env(decide("clientProfileSave", pay([{"field": "house", "value": "zz999", "expected": edit.get("house", "")}]), master))
    check(f"{label} profile: a house the registry does not hold is refused in its words",
          e == {"status": 200, "data": {"written": [], "refused": [{"field": "house", "why": "Not a house on the Locations registry."}]}}, e)
    homes = L.Reads(db, drv).homes()
    other = next((h["code"] for h in homes if h["code"] != (edit.get("house") or "").upper()), "")
    check(f"{label} profile: a house move (the Master write-through) is Apps Script's",
          handed(decide("clientProfileSave", pay([{"field": "house", "value": other.lower(), "expected": edit.get("house", "")}]), master)))
    for fields, status, message in (({"ssn": "1"}, 422, "SSN, card, DC and PIN are never written here (ssn)."),
                                    ({"favorite": "x"}, 422, "Not a profile field: favorite."),
                                    ({}, 400, "fields: nothing to save."), ("x", 400, "fields: the profile fields to save, by name.")):
        check(f"{label} profile (fields): {message}", said(decide("clientProfileSave", {"client": k, "fields": fields}, master),
                                                          status, message))
    d = decide("clientProfileSave", {"client": k, "fields": {f: "  Check   Value "}}, master)
    check(f"{label} profile (fields): an allowed save is Apps Script's to answer, its cells laid once written",
          handed(d) and d.record["cells"].get(f if f != "guardian_name" else "guardianName") == "Check Value", env(d))

# ---- rename and status (the master's) ----
for label, (k, ctx, _chart) in (("c1", picked[0]), ("c2", picked[1])):
    name = gsjs.text(ctx["name"])
    one = lambda field, value, expected: {"client": k, "changes": [{"field": field, "value": value, "expected": expected}]}
    check(f"{label} rename: a change that is not the name is a 400",
          said(decide("clientProfileRename", one("status", "x", ""), master), 400, 'changes: one { field: "name", value, expected }.'))
    check(f"{label} rename: a name that is not a full name in letters is a 400",
          said(decide("clientProfileRename", one("name", "x1", name), master), 400, "name: a full name, first and last, in letters."))
    e = env(decide("clientProfileRename", one("name", "Checkname Zzyzx", "Zz Wrong"), master))
    check(f"{label} rename: a stale witness is the 409 carrying the name now",
          e == {"status": 409, "message": CW.WITNESS_STALE, "data": {"written": [], "refused": [], "current": {"name": name}}}, e)
    e = env(decide("clientProfileRename", one("name", name, name), master))
    check(f"{label} rename: the same name writes nothing", e == {"status": 200, "data": {"written": [], "refused": [], "client_key": k}}, e)
    other_name = gsjs.text((picked[1] if label == "c1" else picked[0])[1]["name"])
    if CW.clean_name(other_name):
        check(f"{label} rename: another client's name is refused",
              said(decide("clientProfileRename", one("name", other_name, name), master), 409,
                   "Another client already carries that name, so nothing was renamed."))
    d = decide("clientProfileRename", one("name", "Checkname Zzyzx", name), master)
    e = env(d)
    check(f"{label} rename: a new name is carried into every book and Hub tab, or refused naming what cannot follow",
          not handed(d) and ((e or {}).get("status") == 200
                             and e["data"].get("client_key") == CW.rename_key(k, name, "Checkname Zzyzx")
                             or (e or {}).get("status") == 409 and bool(e["data"].get("cannot_follow"))),
          {"status": (e or {}).get("status"), "keys": sorted((e or {}).get("data") or {})})
    now = C.status_word(ctx)
    flip = "Inactive" if now == "Active" else "Active"
    check(f"{label} status: a word that is not a status is a 400",
          said(decide("clientProfileStatus", one("status", "maybe", now), master), 400, "status: Active or Inactive."))
    e = env(decide("clientProfileStatus", one("status", flip, flip), master))
    check(f"{label} status: a stale witness is the 409 carrying the status now",
          e == {"status": 409, "message": CW.WITNESS_STALE, "data": {"written": [], "refused": [], "current": {"status": now}}}, e)
    e = env(decide("clientProfileStatus", one("status", now.lower(), now), master))
    check(f"{label} status: the same status writes nothing", e == {"status": 200, "data": {"written": [], "refused": [], "client_key": k}}, e)
    d = decide("clientProfileStatus", one("status", flip, now), master)
    e = env(d)
    check(f"{label} status: the Hub row kept, a refusal of the archive's own, or a book row's move left to Apps Script",
          handed(d) or isinstance(d, W.Decision) and (e or {}).get("status") == 200 and bool(d.edits)
          or (e or {}).get("status") == 409, {"status": (e or {}).get("status"), "edits": bool(getattr(d, "edits", None))})

# ---- a care row over the plan (clientProfileOverride) ----
k, ctx, _chart = picked[0]
target = tab = None
for t in C.OVERRIDE_TABS:
    got = C.scrub(C.care_build(L.Reads(db, drv), ctx, t))
    target = next((r for r in got["rows"] if isinstance(r.get("edit"), dict) and r.get("id")), None)
    if target:
        tab = t
        break
check("c1 care: a care row with an edit to correct", target is not None)
if target is None:
    target, tab = {"id": "none", "edit": {"record": ""}, "text": ""}, "daily"
ov = lambda changes, **kw: {"client": k, "kind": "care", "tab": tab, "target": target["id"], "changes": changes, **kw}
check("c1 care: a kind that is not care or family is a 400",
      said(decide("clientProfileOverride", ov([], kind="bogus"), master), 400, "kind: care or family."))
check("c1 care: the plans tab is not corrected here",
      said(decide("clientProfileOverride", ov([], tab="plans"), master), 400, "tab: one of daily, health, goals, home."))
check("c1 care: a row no longer on the profile is a 404",
      said(decide("clientProfileOverride", ov([{"field": "record", "value": "x", "expected": ""}], target="nope_zz"), master),
           404, "That record is no longer on this client's profile — reload it."))
e = env(decide("clientProfileOverride", ov([{"field": "record", "value": "Check title", "expected": "zz"}]), master))
check("c1 care: a stale witness is the 409 (nothing written)",
      e == {"status": 409, "message": CW.STALE_ALL, "data": {"written": [], "refused": [], "id": "", "current": {"record": target["edit"]["record"]}}}, e)
e = env(decide("clientProfileOverride", ov([{"field": "record", "value": "", "expected": target["edit"]["record"]}]), master))
check("c1 care: a record left without its title is refused, nothing written",
      e == {"status": 200, "data": {"written": [], "refused": [{"field": "record", "why": "A care record needs its record."}], "id": ""}}, e)
d = decide("clientProfileOverride", ov([{"field": "record", "value": "Check   title", "expected": target["edit"]["record"]}]), master)
want = {"client_key": k, "kind": "care", "tab": tab, "target": target["id"], "record": "Check title",
        "text": gsjs.or_text(target.get("text")), "name": "", "relationship": "", "phone": "", "email": "", "state": "", "by": WHO}
rec = d.record if isinstance(d, W.Decision) else None
check("c1 care: the first correction of a plan row is Apps Script's (it mints the row's id); its row laid by its key",
      handed(d) and rec["kind"] == "append" and rec["match"] == "override" and rec["sheet_id"] == sid_over
      and rec["row_key"] == "|".join((k, "care", tab, target["id"])) and {x: v for x, v in rec["cells"].items() if x != "at"} == want
      and ISO.match(rec["cells"]["at"]), [env(d), rec and {x: (v if x != "text" else len(v)) for x, v in rec["cells"].items()}])
first = rec
# the same row once filed (a written override, laid on a tab the copy has not made yet): an edit in place, laid now
filed = {"write_id": "Wcheck-filed", "action": "clientProfileOverride", "house": k, "sheet_id": first["sheet_id"],
         "tab_name": first["tab_name"], "kind": "append", "match": "override", "keyed": "header", "row_key": first["row_key"],
         "cells": {**first["cells"], "id": "CO_" + k + "_care_check000001"}, "state": "written",
         "accepted_at": time.time() - 5, "written_at": time.time() - 2}
own = CW.Own([filed], book=db.book)
tok = hubdb.OWN.set(own)
try:
    read = C.ACTIONS["clientProfileCare"](L.Session(L.Reads(db, drv), master), {"client": k, "tab": tab})
    shown = next((r for r in (read.get("data") or {}).get("rows") or [] if r.get("id") == target["id"]), {})
    check("own layer: a first override, on a tab the copy does not hold yet, shows in the care read at once",
          read.get("status") == 200 and shown.get("record") == "Check title" and shown.get("source") == "Edited in the Hub"
          and "Wcheck-filed" in own.held, [read.get("status"), shown.get("record"), shown.get("source")])
    d = decide("clientProfileOverride", ov([{"field": "record", "value": "Check title two", "expected": "Check title"}]), master)
    rec = d.record if isinstance(d, W.Decision) else None
    ACTION_OF["c1 care"] = "clientProfileOverride"
    a = env(d) if isinstance(d, W.Decision) and d.answer else {}
    check("c1 care: the filed override is corrected in place by its id, laid at once, answered as the door does",
          isinstance(d, W.Decision) and rec and rec["kind"] == "edit" and rec["match"] == "id"
          and rec["row_key"] == "CO_" + k + "_care_check000001" and rec["cells"]["record"] == "Check title two"
          and rec["cells"]["id"] == rec["row_key"] and (handed(d) or (
              a["status"] == 200 and a["data"]["written"] == ["record"] and a["data"]["id"] == rec["row_key"]
              and a["data"]["steps"][0]["words"] == CW.EDIT_WORDS["care"][0] and a["data"]["slices"] == []
              and d.lay["fields"] == {"record": "Check title two"} and d.lay["key"] == k + "|" + tab)),
          [env(d), rec and rec["kind"]])
    if isinstance(d, W.Decision) and d.lay:
        lay_out("c1 care", d, k)
finally:
    hubdb.OWN.reset(tok)
fam = C.family_of(L.Reads(db, drv), ctx, C.isp_row(L.Reads(db, drv), k), None)
if fam:
    m = C.scrub(fam[0])
    d = decide("clientProfileOverride", {"client": k, "kind": "family", "target": m["key"],
                                         "changes": [{"field": "relationship", "value": "Check kin", "expected": m["edit"]["relationship"]}]}, master)
    check("c1 family: a family member corrected is Apps Script's to file, laid by its key once it is",
          handed(d) and d.record["cells"]["relationship"] == "Check kin" and d.record["cells"]["kind"] == "family", env(d))

# ---- the chart (emarMedUpdate, emarMedDelete) ----
mine = [r for r in C.scrub(C.meds_build(L.Reads(db, drv), ctx1, "meds"))["rows"] if r.get("edit")]
med = mine[0]
theirs = next(r for r in chart2 if r.get("edit"))
mu = lambda changes, mid=None, client=None: {"client": client or k1, "id": mid or med["id"], "changes": changes}
check("chart: a malformed id is a 400", said(decide("emarMedUpdate", mu([], mid="bad id!"), master), 400, "id: the medicine's chart id."))
check("chart: an id no row carries is a 404",
      said(decide("emarMedUpdate", mu([{"field": "dose", "value": "1", "expected": ""}], mid="nope999zz"), master), 404,
           "No medicine with this id is on the chart."))
check("chart: another client's medicine is a 409 (moved)",
      said(decide("emarMedUpdate", mu([{"field": "dose", "value": "1", "expected": ""}], mid=theirs["id"]), master), 409,
           "This medicine is not on this client's chart (it has moved) — nothing was written."))
e = env(decide("emarMedUpdate", mu([{"field": "dose", "value": "1", "expected": "zz"}, {"field": "bogus", "value": "x", "expected": ""},
                                    {"field": "name", "value": "", "expected": med["edit"]["name"]}]), master))
check("chart: a stale cell, a field the panel does not edit and a blank name, each in the door's words",
      e == {"status": 409, "message": CW.STALE_ALL, "data": {"written": [], "refused": [
          {"field": "bogus", "why": "Not a field this panel edits."}, {"field": "name", "why": "The medicine needs a name."}],
          "current": {"dose": med["edit"]["dose"]}}}, e)
d = decide("emarMedUpdate", mu([{"field": "dose", "value": "Check  5 mg", "expected": med["edit"]["dose"]},
                                {"field": "times", "value": "800, 13:00", "expected": med["edit"]["times"]}]), master)
rec = d.record if isinstance(d, W.Decision) else None
a = env(d) if isinstance(d, W.Decision) and d.answer else {}
ACTION_OF["chart edit"] = "emarMedUpdate"
check("chart: a dose and the times filed as the door files them ('\"0800\" \"1300\"'), answered as cpEditSteps_ meds",
      rec and rec["kind"] == "edit" and rec["match"] == "medid" and rec["row_key"] == med["id"] and rec["sheet_id"] == sid_meds
      and rec["cells"] == {"Dosage": "Check 5 mg", "AdministrationTimes": '"0800" "1300"'} and (handed(d) or (
          a["status"] == 200 and a["data"]["written"] == ["dose", "times"] and a["data"]["slices"] == []
          and a["data"]["steps"][0]["words"] == CW.EDIT_WORDS["meds"][0]
          and d.lay["fields"] == {"dose": "Check 5 mg", "times": "08:00 13:00"} and d.lay["target"] == med["id"])),
      [env(d), rec and rec["cells"]])
if isinstance(d, W.Decision) and d.lay:
    lay_out("chart edit", d, k1)
edit_rec = rec
check("chart removal: no id is a 400", said(decide("emarMedDelete", {"client": k1}, master), 400, "Which medicine?"))
check("chart removal: an id no row carries is a 404",
      said(decide("emarMedDelete", {"client": k1, "id": "nope999zz"}, master), 404, 'No medicine with id "nope999zz" on the chart.'))
check("chart removal: another client's medicine is a 409 (moved)",
      said(decide("emarMedDelete", {"client": k1, "id": theirs["id"]}, master), 409,
           "This medicine is not on this client's chart (it has moved) — nothing was removed."))
d = decide("emarMedDelete", {"client": k1, "id": med["id"]}, manager)
rec = d.record if isinstance(d, W.Decision) else None
a = env(d) if isinstance(d, W.Decision) and d.answer else {}
ACTION_OF["chart removal"] = "emarMedDelete"
check("chart removal: the chart's writer takes the row off, answered as the door does",
      rec and rec["kind"] == "delete" and rec["cells"] == {"Id - Auto": med["id"]} and (handed(d) or (
          a["status"] == 200 and a["data"]["removed"] == med["id"] and a["data"]["written"] == ["removed"]
          and a["data"]["refused"] == [] and d.lay["fields"] == {"removed": "Yes"})), [env(d), rec])
if isinstance(d, W.Decision) and d.lay:
    lay_out("chart removal", d, k1)
del_rec = rec

# ---- the own-write layer over the reads ----
def item(wid, rec, state="accepted"):
    return {"write_id": wid, "action": "", "house": rec["house"], "sheet_id": rec["sheet_id"], "tab_name": rec["tab_name"],
            "kind": rec["kind"], "match": rec["match"], "keyed": rec["keyed"], "row_key": rec["row_key"], "cells": rec["cells"],
            "state": state, "accepted_at": time.time() - 3, "written_at": time.time() - 1 if state == "written" else 0}


def laid_read(items, action, payload):
    own = CW.Own(items, book=db.book)
    tok = hubdb.OWN.set(own)
    try:
        return C.ACTIONS[action](L.Session(L.Reads(db, drv), master), payload), own
    finally:
        hubdb.OWN.reset(tok)


prof = (out.get("profile_records") or {}).get("c1")
if prof:
    own = CW.Own([item("Wcheck-prof", prof)], book=db.book)
    tok = hubdb.OWN.set(own)
    try:
        shown, _rests = edit_map(k1)
    finally:
        hubdb.OWN.reset(tok)
    f = next(iter(x for x in prof["cells"] if x != "cleared_fields"))
    f = "guardian_name" if f == "guardianName" else f
    check("own layer: a profile edit Python accepted shows in the profile at once",
          shown.get(f) == "Check Value" and "Wcheck-prof" in own.held, [f, shown.get(f) == "Check Value"])
read, own = laid_read([item("Wcheck-meds", edit_rec), item("Wcheck-del", del_rec)], "clientProfileMeds", {"client": k1})
ids = [r.get("id") for r in (read.get("data") or {}).get("rows") or []]
check("own layer: a chart row taken off leaves the chart at once (and its pending edit with it)",
      read.get("status") == 200 and med["id"] not in ids and "Wcheck-del" in own.held, [read.get("status"), len(ids)])
read, own = laid_read([item("Wcheck-meds", edit_rec)], "clientProfileMeds", {"client": k1})
row = next((r for r in (read.get("data") or {}).get("rows") or [] if r.get("id") == med["id"]), {})
check("own layer: a chart edit shows at once, its times as the read draws them",
      (row.get("edit") or {}).get("dose") == "Check 5 mg" and (row.get("edit") or {}).get("times") == "08:00 13:00", row.get("edit"))
old = item("Wcheck-old", edit_rec, "written")
old["written_at"] = time.time() - 7200
read, own = laid_read([old], "clientProfileMeds", {"client": k1})
row = next((r for r in (read.get("data") or {}).get("rows") or [] if r.get("id") == med["id"]), {})
check("own layer: a write no source confirmed in an hour is retired, not laid",
      (row.get("edit") or {}).get("dose") == med["edit"]["dose"] and own.done.get("Wcheck-old") == "retired")
rv = {"write_id": "Wcheck-rev", "house": k1, "sheet_id": db.resolve("incident_reviews").sheet_id, "tab_name": "incident_reviews",
      "kind": "append", "match": "id", "keyed": "header", "row_key": k1 + "|2026-01-01T00:00:00.000Z",
      "cells": {"id": k1 + "|2026-01-01T00:00:00.000Z", "client_key": k1, "client_name": ctx1["name"],
                "incident_ts": "2026-01-01T00:00:00.000Z", "status": "Closed", "by": WHO, "at": "2026-10-09T00:00:00.000Z"},
      "state": "queued", "accepted_at": time.time() - 3, "written_at": 0}
own = CW.Own([rv], book=db.book)
tok = hubdb.OWN.set(own)
try:
    got = C.reviews_door(L.Reads(db, drv), C.client_ctx(L.Reads(db, drv), k1))
finally:
    hubdb.OWN.reset(tok)
check("own layer: a first incident review, on a tab the copy has not made, reads back from Postgres",
      (((got.get("data") or {}).get("reviews") or {}).get(k1 + "|2026-01-01T00:00:00.000Z") or {}).get("status") == "Closed", got.get("status"))

# ---- the lane (app/main.py), its store stood in ----
class FakeTx:
    def __init__(self, s): self.s = s
    def receipt(self, wid): return self.s.receipts.get(wid)
    def live(self): return []
    def edits(self): return []
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
    def edits(self): return []
    def finish(self, done): pass
    @contextlib.contextmanager
    def locked(self):
        yield FakeTx(self)


main.STORE, main.CLIENT_STORE, main.STAFF_STORE = FakeStore(), FakeStore(), FakeStore()
main.SSA_STORE, main.FAMILY_STORE = FakeStore(), FakeStore()
boss_said = {"uid": master["id"], "role": "admin", "is_master": True}
res = main._run_write(CW, "clientProfileSave", boss_said, {"client": k1, "changes": [{"field": "ssn", "value": "1", "expected": ""}]}, "Wcheck-lane-01")
body = json.loads(res.body)
check("lane: a refusal is the door's envelope, kept once in the Clients store's receipts",
      res.status_code == 200 and body["data"]["refused"][0]["field"] == "ssn" and "_write" not in body
      and "Wcheck-lane-01" in main.CLIENT_STORE.receipts and not main.STORE.receipts, body)
res = main._run_write(CW, "emarMedDelete", boss_said, {"client": k1, "id": med["id"]}, "Wcheck-lane-02")
body = json.loads(res.body)
plan = body.get("_write") or {}
check("lane: an accepted write names its client to the relay and records the cells it files",
      res.status_code == 200 and plan.get("house") == k1 and main.CLIENT_STORE.records.get("Wcheck-lane-02", {}).get("kind") == "delete"
      and (plan.get("engine") or plan.get("lay", {}).get("target") == med["id"]), plan)
check("lane: the policy gate's roles and types, as the resolver says them",
      main.policy_gate(CW, "clientProfileRename", {}, staff) == {"status": 403, "message": "This action is for admin or manager."}
      and main.policy_gate(CW, "emarMedUpdate", {"id": 5}, staff) == {"status": 400, "message": "id must be string, got number."})

# ---- the store's SQL: made, recorded, settled — inside one transaction rolled back ----
import psycopg
dsn = os.environ.get("HUB_DB_WRITE_DSN", "")
if dsn:
    conn = psycopg.connect(dsn, autocommit=True, connect_timeout=5)
    q = "select to_regclass('app.client_writes') is not null, to_regclass('app.client_receipts') is not null, (select count(*) from pg_tables where schemaname = 'app')"
    before = conn.execute(q).fetchone()
    seen = {}
    try:
        with conn.transaction():
            st = CW.Store(dsn="", connect=lambda: conn)
            seen["ensure"] = st.ensure()
            tx = W.Tx(conn.cursor(), "client")
            pd = decide("emarMedUpdate", mu([{"field": "dose", "value": "Check 5 mg", "expected": med["edit"]["dose"]},
                                             {"field": "times", "value": "800 1300", "expected": med["edit"]["times"]}]), master)
            dd = decide("emarMedDelete", {"client": k1, "id": med["id"]}, master)
            for wid, dec in (("Wcheck-sql-01", pd), ("Wcheck-sql-02", dd), ("Wcheck-sql-03", pd)):
                tx.record(wid, "emarMedUpdate", W.envelope(dec, wid, master), dec, WHO)
            seen["receipt"] = tx.receipt("Wcheck-sql-01") == json.loads(json.dumps(W.envelope(pd, "Wcheck-sql-01", master)))
            seen["live"] = sorted(w["write_id"] for w in st.live())
            st.settle("Wcheck-sql-01", "queued")
            st.settle("Wcheck-sql-01", "written", fields=["dose"])
            st.settle("Wcheck-sql-02", "written")
            st.settle("Wcheck-sql-03", "written", fields=["route"])
            got = {r[0]: (r[1], r[2] if isinstance(r[2], dict) else json.loads(r[2])) for r in conn.execute(
                "select write_id, state, cells from app.client_writes where write_id like 'Wcheck-sql-%'").fetchall()}
            seen["states"] = {w: s for w, (s, _c) in got.items()}
            seen["kept"] = got["Wcheck-sql-01"][1]
            st.finish({"Wcheck-sql-01": "retired"})
            seen["retired"] = conn.execute("select state from app.client_writes where write_id = 'Wcheck-sql-01'").fetchone()[0]
            seen["void"] = st.settle("Wcheck-sql-03", "void")
            raise psycopg.Rollback()
    finally:
        after = conn.execute(q).fetchone()
        conn.close()
    laid = sorted(w for w, dec in (("Wcheck-sql-01", pd), ("Wcheck-sql-02", dd), ("Wcheck-sql-03", pd))
                  if isinstance(dec, W.Decision) and not dec.engine)
    check("store: the Clients tables are made by the writer role (db/app-writer.sql owns schema app)", seen.get("ensure") == "", seen.get("ensure"))
    check("store: each decision kept once under its write id, laid while accepted (Apps Script's own: decided)",
          seen.get("receipt") is True and seen.get("live") == laid, seen)
    check("store: written keeps the cells the door wrote (dose → Dosage), a delete stands, none kept is refused",
          seen.get("states") == {"Wcheck-sql-01": "written", "Wcheck-sql-02": "written", "Wcheck-sql-03": "refused"}
          and seen.get("kept") == {"Dosage": "Check 5 mg"}, seen)
    check("store: retired by a read, and a settled write is never voided", seen.get("retired") == "retired" and seen.get("void") is False, seen)
    check("store: rolled back — app.* holds what it held before", tuple(before) == tuple(after), [before, after])
else:
    check("store: HUB_DB_WRITE_DSN is set in the runner", False, "unset")

print(json.dumps(out, default=str))
'''

def run(runner: str) -> dict[str, Any]:
    src = {n: (APP / f"{n}.py").read_text(encoding="utf-8") for n in MODULES}
    blob = {"order": list(MODULES), "src": src}
    got = subprocess.run(["docker", "exec", "-i", runner, "python", "-c", DRIVER],
                         input=base64.b64encode(json.dumps(blob).encode()) + b"\n", capture_output=True, timeout=1800)
    if got.returncode != 0:
        raise RuntimeError(f"the check did not run in {runner}: {got.stderr.decode()[-1500:]}")
    return json.loads(got.stdout.decode().strip().splitlines()[-1])


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--runner", default=RUNNER)
    args = ap.parse_args()
    if not shutil.which("docker"):
        print("test-clients-writes: skipped — no docker here")
        return 0
    out = run(args.runner)
    import edit_overlay  # noqa: PLC0415 - the relay's own rules, run here on the lays Python handed it
    for name, action, lay in out["lays"]:
        got = edit_overlay.python_entries(action, lay)
        out["checks"].append([f"relay: the overlay lays Python's {name} by its own rules", isinstance(got, list)
                              and got[0]["app"] == edit_overlay.CLIENT_APP and got[0]["key"].split("|")[0] == "client_x",
                              "" if isinstance(got, list) else got])
    bad = edit_overlay.python_entries("clientProfileSave", {"kind": "edit", "house": "client_x", "key": "client_x",
                                                            "fields": {"dob": "next tuesday"}, "prior": {}})
    out["checks"].append(["relay: a value the profile's read draws its own way is not laid (fail-closed)",
                          isinstance(bad, str), bad])
    failed = 0
    for name, ok, detail in out["checks"]:
        print(f"  {'ok  ' if ok else 'FAIL'} {name}")
        if not ok:
            failed += 1
            print(f"       {detail}")
    slow = {a: max(t) for a, t in out["timing"].items()}
    print("\n  slowest decision per door (s): " + ", ".join(f"{a} {t}" for a, t in sorted(slow.items())))
    print(f"\ntest-clients-writes: {len(out['checks']) - failed} ok, {failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
