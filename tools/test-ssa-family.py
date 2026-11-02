#!/usr/bin/env python3
"""SSA Profiles and Family Profiles on Python (app/ssa*.py, app/family*.py) against Apps Script: the relay's kept
packs part by part, every door as the master on three real subjects, one refusal per door, every write decided
(refused and handed on) with nothing written, the lane (app/main.py) and the relay's routing over fakes.
Prints shapes and counts only; no sheet is touched and the store's SQL is rolled back."""
from __future__ import annotations

import argparse
import ast
import base64
import importlib.util
import json
import re
import shutil
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "app"
DB_MODULES = ("gsjs", "hubdb", "scope", "drive", "locations", "clients", "client_sources", "writes", "client_writes",
              "staff", "staff_comms", "ssa", "ssa_writes", "family", "family_writes")
APP_MODULES = ("gsjs", "hubdb", "scope", "drive", "locations", "clients", "client_meds", "client_sources", "client_app",
               "writes", "client_writes", "staff", "staff_comms", "staff_perf", "staff_app", "staff_writes", "ssa",
               "ssa_writes", "family", "family_writes", "main")
RELAY = "asa-hub-snapshot"
APP_RUNNER = "asa-hub-app"
DB_RUNNER = "asa-hub-db-sync"
PACK_DIR = "/srv/app-packs"
MiB = 1 << 20
# a driver stops itself before its container nears its limit (the live service shares it)
APP_CEILING = 640 * MiB
DB_CEILING = 900 * MiB
NY = ZoneInfo("America/New_York")

results = {"ok": 0, "failed": []}


def check(name: str, ok: bool, detail: Any = None) -> None:
    if ok:
        results["ok"] += 1
        print(f"  ok   {name}")
    else:
        results["failed"].append(name)
        print(f"  FAIL {name}")
        if detail not in (None, ""):
            print(f"       {str(detail)[:400]}")


def parity_tools() -> Any:
    """test-clients-parity.py's comparison, reused as it stands."""
    spec = importlib.util.spec_from_file_location("clients_parity", ROOT / "tools" / "test-clients-parity.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


P = parity_tools()


def docker(*args: str, data: bytes | None = None, timeout: int = 600) -> subprocess.CompletedProcess:
    return subprocess.run(["docker", *args], input=data, capture_output=True, timeout=timeout)


def running(name: str) -> bool:
    got = docker("ps", "--filter", f"name=^{name}$", "--format", "{{.Names}}", timeout=30)
    return got.returncode == 0 and name in got.stdout.decode().split()


def mem_now(name: str) -> int:
    got = docker("exec", name, "cat", "/sys/fs/cgroup/memory.current", timeout=30)
    return int(got.stdout.decode().strip() or 0) if got.returncode == 0 else 0


def kept_packs() -> dict[str, dict[str, dict]]:
    """The relay's kept SSA and Families index packs — Apps Script's own answers — read into memory only."""
    out: dict[str, dict[str, dict]] = {"ssa-profiles": {}, "family-index": {}, "family-profiles": {}}
    script = ("import json,os,re,sys\nd=%r\nout=[]\nfor n in os.listdir(d):\n"
              "    if not re.fullmatch(r'[0-9a-f]{64}\\.json', n): continue\n"
              "    try: b=json.load(open(os.path.join(d,n)))\n    except Exception: continue\n"
              "    if b.get('app') in %r: out.append(b)\nsys.stdout.write(json.dumps(out))\n") % (PACK_DIR, tuple(out))
    got = docker("exec", "-i", RELAY, "python3", "-", data=script.encode(), timeout=120)
    if got.returncode != 0:
        raise RuntimeError(f"the relay's kept packs could not be read ({got.stderr.decode()[-200:]})")
    for body in json.loads(got.stdout.decode() or "[]"):
        out[body["app"]][body["key"]] = body
    return out


COMMON = r'''
import base64, json, os, sys, threading, time, types
blob = json.loads(base64.b64decode(sys.stdin.readline()).decode())
CEILING = int(blob["ceiling"])


def _watch():
    while True:
        try:
            cur = int(open("/sys/fs/cgroup/memory.current").read())
        except Exception:
            cur = 0
        if CEILING and cur > CEILING:
            sys.stdout.write(json.dumps({"aborted": cur >> 20}) + "\n")
            sys.stdout.flush()
            os._exit(3)
        time.sleep(0.1)


threading.Thread(target=_watch, daemon=True).start()
for name in blob["order"]:
    m = types.ModuleType(name); m.__file__ = name + ".py"; sys.modules[name] = m
for name in blob["order"]:
    exec(compile(blob["src"][name], name + ".py", "exec"), sys.modules[name].__dict__)
import gsjs, hubdb, locations as L, scope as sc, drive as dr, clients as C, writes as W, client_writes as CW
import ssa as S, ssa_writes as SW, family as F, family_writes as FW
job = blob["job"]
db = hubdb.HubDb()
drv = dr.Drive()
MARK = C.COPY_MARKER + ":"
UNKNOWN = {"status": 404, "message": "Unknown action."}
SERVICE = {"is_service": True, "role": "admin", "id": "", "email": ""}
out = {"drive": drv.available, "checks": [], "timing": {}}
SECRET = []


def mask(s):
    s = str(s)
    for word in sorted(SECRET, key=len, reverse=True):
        if word and len(word) > 2:
            s = s.replace(word, "<subject>")
    return s[:300]


def check(name, ok, detail=""):
    out["checks"].append([name, bool(ok), "" if ok else mask(detail)])


def sess(user):
    return L.Session(L.Reads(db, drv), user)


def timed(label, fn):
    t = time.monotonic()
    try:
        got = fn()
    except (sc.Defer, hubdb.Unreadable) as e:
        got = {"deferred": type(e).__name__ + ": " + str(e)[:160]}
    out["timing"].setdefault(label, []).append(round(time.monotonic() - t, 2))
    return got


def brief(env):
    """An answer without what it says: its status, message and the keys of its data."""
    if not isinstance(env, dict):
        return {"shape": type(env).__name__}
    if "deferred" in env:
        return {"deferred": env["deferred"]}
    data = env.get("data")
    return {"status": env.get("status"), "message": env.get("message") or "",
            "keys": sorted(data) if isinstance(data, dict) else type(data).__name__}


users = L.Reads(db, drv).users()
boss = next((u for u in users if not gsjs.str_(u.get("mergedinto")) and sc.is_master_email(u.get("email"))
             and gsjs.str_(u.get("role")) == "admin"), None)
MASTER = sc.user_from_row(boss) if boss else None
BASE = {"display_name": "Check Person", "types": [], "client_key": "", "home_tenant": "", "app_denials": [],
        "visiting_member": "", "is_service": False}
ADMIN = {**BASE, "id": "u-check-admin", "email": "admin.check@example.org", "role": "admin"}
'''

DB_DRIVER = COMMON + r'''
check("the master's users row is in asa-hub-db", MASTER is not None)


def wrap(module, name, fn, why):
    def run(*a):
        try:
            return fn(*a)
        except (sc.Defer, hubdb.Unreadable) as e:
            why[name] = type(e).__name__ + ": " + str(e)[:160]
            raise
    return run


# ---- the packs: every SSA the relay keeps, the Families index, three family members ----
packs = {"ssa": {}, "family": {}, "index": None}
held_ssa = dict(S.PACK_DOORS)
for key in job["ssa_keys"]:
    why = {}
    S.PACK_DOORS = {n: wrap(S, n, f, why) for n, f in held_ssa.items()}
    t = time.monotonic()
    try:
        env = S.ssa_pack(sess(SERVICE), {"ssa": key})
    except (sc.Defer, hubdb.Unreadable) as e:
        env = {"deferred": str(e)[:200]}
    packs["ssa"][key] = {"env": env, "why": dict(why), "s": round(time.monotonic() - t, 2)}
S.PACK_DOORS = held_ssa
t = time.monotonic()
try:
    packs["index"] = {"env": F.family_index_pack(sess(SERVICE), {}), "s": 0}
except (sc.Defer, hubdb.Unreadable) as e:
    packs["index"] = {"env": {"deferred": str(e)[:200]}, "s": 0}
packs["index"]["s"] = round(time.monotonic() - t, 2)

R = L.Reads(db, drv)
fidx = F.index(R)
fam_keys = [k for k in sorted(fidx["families"]) if fidx["families"][k]["clients"]
            and F.edit_of(R, F.family_ctx(R, k))["records"]][:3]
ssa_keys = [k for k in job["ssa_keys"] if k in S.index(R)["ssas"]][:3]
for k in ssa_keys:
    SECRET.extend([k, S.index(R)["ssas"][k]["name"]])
for k in fam_keys:
    SECRET.extend([k, fidx["families"][k]["name"]] + [c["client_key"] for c in fidx["families"][k]["clients"]])
out["subjects"] = {"ssa": ssa_keys, "family": fam_keys}
check("three SSAs the relay keeps and three family members whose own records name them",
      len(ssa_keys) == 3 and len(fam_keys) == 3, f"{len(ssa_keys)} SSA, {len(fam_keys)} family")
held_fam = dict(F.PACK_DOORS)
for key in fam_keys:
    why = {}
    F.PACK_DOORS = {n: wrap(F, n, f, why) for n, f in held_fam.items()}
    t = time.monotonic()
    try:
        env = F.family_pack(sess(SERVICE), {"family": key})
    except (sc.Defer, hubdb.Unreadable) as e:
        env = {"deferred": str(e)[:200]}
    packs["family"][key] = {"env": env, "why": dict(why), "s": round(time.monotonic() - t, 2)}
F.PACK_DOORS = held_fam
out["packs"] = packs

# ---- every door as the master, three subjects each (documents and files read where Drive is: the app run) ----
doors = {"ssa": {}, "family": {}}


def door(app, action, fn, payload, user=None):
    got = timed(action, lambda: fn(sess(user or MASTER), payload))
    marked = MARK in json.dumps(got, default=str)
    return got, marked


got, marked = door("ssa", "ssaProfileRoster", S.ssa_profile_roster, {})
check("ssaProfileRoster as the master: 200, the master's view, every SSA, no withheld cell",
      got.get("status") == 200 and (got.get("data") or {}).get("viewer") == "master"
      and len((got.get("data") or {}).get("ssas") or []) == len(S.index(R)["ssas"]) and not marked, brief(got))
for i, k in enumerate(ssa_keys):
    for action, fn in (("ssaProfileOverview", S.ssa_profile_overview), ("ssaProfileActivity", S.ssa_profile_activity),
                       ("ssaProfileNotes", S.ssa_profile_notes)):
        got, marked = door("ssa", action, fn, {"ssa": k})
        ok = got.get("status") == 200 and not marked
        # the activity defers whole where the hotline book's own clock decides a time (the pack says the same)
        if action == "ssaProfileActivity" and "deferred" in got:
            ok = "clock" in got["deferred"] or "zone" in got["deferred"]
        check(f"{action} as the master, SSA {i + 1}: 200 (or left to Apps Script for the hotline clock), no withheld cell",
              ok, brief(got))
        doors["ssa"].setdefault(k, {})[action] = got
got, marked = door("family", "familyProfileRoster", F.family_profile_roster, {})
check("familyProfileRoster as the master: 200, the master's view, every family member, no withheld cell",
      got.get("status") == 200 and ((got.get("data") or {}).get("view") or {}).get("kind") == "master"
      and len((got.get("data") or {}).get("families") or []) == len(fidx["families"]) and not marked, brief(got))
for i, k in enumerate(fam_keys):
    for action, fn, extra in (("familyProfileOverview", F.family_profile_overview, {}),
                              ("familyProfileOverview", F.family_profile_overview, {"edit": True}),
                              ("familyProfileActivity", F.family_profile_activity, {}),
                              ("familyProfileNotes", F.family_profile_notes, {})):
        got, marked = door("family", action, fn, {"family": k, **extra})
        label = action + (" (edit)" if extra else "")
        ok = got.get("status") == 200 and not marked
        if extra:
            ok = ok and isinstance((got.get("data") or {}).get("edit"), dict)
        if action == "familyProfileActivity" and "deferred" in got:
            ok = "clock" in got["deferred"]
        check(f"{label} as the master, family member {i + 1}: 200 (or left to Apps Script for the hotline clock), "
              "no withheld cell", ok, brief(got))
        doors["family"].setdefault(k, {})[label] = got
out["doors"] = doors
# every family member's activity: answered here, or left whole to Apps Script, and why
census = {}
for k in sorted(fidx["families"]):
    got = timed("familyProfileActivity", lambda: F.family_profile_activity(sess(MASTER), {"family": k}))
    said_why = "200" if got.get("status") == 200 else (
        "left: the hotline clock" if "clock" in str(got.get("deferred") or "") else
        "left: " + mask(got.get("deferred") or got.get("message") or "?")[:80])
    census[said_why] = census.get(said_why, 0) + 1
out["census"] = census

# ---- one refusal per door ----
k, fk = ssa_keys[0], fam_keys[0]
said = lambda env, status, msg=None: env.get("status") == status and (msg is None or env.get("message") == msg)
check("ssaProfileRoster: the service identity is told Unknown action", S.ssa_profile_roster(sess(SERVICE), {}) == UNKNOWN)
check("ssaProfileOverview: a malformed key is the door's 400",
      said(S.ssa_profile_overview(sess(MASTER), {"ssa": "A B"}), 400, 'No SSA "A B" is on file.'))
check("ssaProfileDocuments: a well-formed key nobody names is the door's 400",
      said(S.ssa_profile_documents(sess(MASTER), {"ssa": "ssa_zzcheckzz"}), 400, 'No SSA "ssa_zzcheckzz" is on file.'))
check("ssaProfileActivity: the service identity is told Unknown action",
      S.ssa_profile_activity(sess(SERVICE), {"ssa": k}) == UNKNOWN)
check("ssaProfileNotes: the service identity is told Unknown action",
      S.ssa_profile_notes(sess(SERVICE), {"ssa": k}) == UNKNOWN)
check("ssaProfileDocFile: a file id that is not one is the door's 400",
      said(S.ssa_profile_doc_file(sess(MASTER), {"ssa": k, "file_id": "x/y"}), 400, "file_id: a Drive file id."))
check("ssaPack: a person who is not the master is told Unknown action",
      S.ssa_pack(sess(ADMIN), {"ssa": k}) == UNKNOWN)
check("familyProfileRoster: the service identity is told Unknown action",
      F.family_profile_roster(sess(SERVICE), {}) == UNKNOWN)
check("familyProfileOverview: a malformed key is the door's 400",
      said(F.family_profile_overview(sess(MASTER), {"family": "A B"}), 400, 'No family member "A B" is on file.'))
check("familyProfileDocuments: a well-formed key nobody names is the door's 400",
      said(F.family_profile_documents(sess(MASTER), {"family": "fam_zzcheckzz"}), 400,
           'No family member "fam_zzcheckzz" is on file.'))
check("familyProfileActivity: the service identity is told Unknown action",
      F.family_profile_activity(sess(SERVICE), {"family": fk}) == UNKNOWN)
check("familyProfileNotes: the service identity is told Unknown action",
      F.family_profile_notes(sess(SERVICE), {"family": fk}) == UNKNOWN)
check("familyProfileDocFile: a file id that is not one is the door's 400",
      said(F.family_profile_doc_file(sess(MASTER), {"family": fk, "file_id": "x/y"}), 400, "file_id: a Drive file id."))
check("familyPack and familyIndexPack: the master is told Unknown action (the relay's identity alone)",
      F.family_pack(sess(MASTER), {"family": fk}) == UNKNOWN and F.family_index_pack(sess(MASTER), {}) == UNKNOWN)


# ---- every write decided: refused in the .gs's words, or handed to Apps Script with nothing laid ----
def decide(mod, action, payload, user):
    t = time.monotonic()
    try:
        d = mod.ACTIONS[action](sess(user), payload)
    except (sc.Defer, hubdb.Unreadable) as e:
        d = "deferred: " + str(e)[:160]
    out["timing"].setdefault(action, []).append(round(time.monotonic() - t, 2))
    return d


def env(d):
    return d.answer if isinstance(d, W.Decision) else {"deferred": d}


def refused(d, status, message, fresh=None):
    e = env(d) or {}
    ok = e.get("status") == status and e.get("message") == message and d.lay is None and not d.engine
    return ok and (fresh is None or d.fresh == fresh)


def handed(d):
    return isinstance(d, W.Decision) and d.engine and d.answer is None and d.record is None and d.lay is None


def shown_d(d):
    if not isinstance(d, W.Decision):
        return {"deferred": d}
    return {"answer": brief(d.answer or {}), "engine": d.engine, "lay": d.lay is not None,
            "record": d.record is not None, "fresh": d.fresh}


ADD = "ssaProfileNoteAdd"
d = decide(SW, ADD, {"ssa": k, "body": "x"}, ADMIN)
check("SSA note: anyone but the master is told Unknown action", env(d) == UNKNOWN and not d.fresh, shown_d(d))
d = decide(SW, ADD, {"ssa": "A B", "body": "x"}, MASTER)
check("SSA note: a malformed key is the door's 400, resting on nothing", refused(d, 400, 'No SSA "A B" is on file.', False),
      shown_d(d))
d = decide(SW, ADD, {"ssa": "ssa_zzcheckzz", "body": "x"}, MASTER)
check("SSA note: a key nobody names is the door's 400, resting on the copy being current",
      refused(d, 400, 'No SSA "ssa_zzcheckzz" is on file.', True), shown_d(d))
d = decide(SW, ADD, {"ssa": k, "body": "  "}, MASTER)
check("SSA note: no body is a 400", refused(d, 400, "body: what the note says."), shown_d(d))
d = decide(SW, ADD, {"ssa": k, "body": "y" * 4001}, MASTER)
check("SSA note: past 4000 characters is a 400", refused(d, 400, "body: up to 4000 characters."), shown_d(d))
d = decide(SW, ADD, {"ssa": k, "body": "😀" * 2001}, MASTER)
check("SSA note: 4000 counted as JavaScript counts (UTF-16 units)", refused(d, 400, "body: up to 4000 characters."),
      shown_d(d))
d = decide(SW, ADD, {"ssa": k, "body": "Check note"}, MASTER)
check("SSA note: a good note is Apps Script's to file (it mints the id and the time), nothing laid before",
      handed(d), shown_d(d))

fctx = F.family_ctx(R, fk)
client = fctx["family"]["clients"][0]["client_key"]
NOTE, TIE, CALL, SAVE = "familyProfileNoteAdd", "familyProfileIncidentTie", "familyProfileCallSchedule", "familyProfileSave"
for action in (NOTE, TIE, CALL, SAVE):
    d = decide(FW, action, {"family": fk, "body": "x", "client_key": client, "changes": []}, ADMIN)
    check(f"{action}: anyone but the master is told Unknown action", env(d) == UNKNOWN, shown_d(d))
d = decide(FW, NOTE, {"family": "A B", "body": "x"}, MASTER)
check("family note: a malformed key is the door's 400", refused(d, 400, 'No family member "A B" is on file.'), shown_d(d))
d = decide(FW, NOTE, {"family": "fam_zzcheckzz", "body": "x"}, MASTER)
check("family note: a key nobody names is the door's 400, resting on the copy being current",
      refused(d, 400, 'No family member "fam_zzcheckzz" is on file.', True), shown_d(d))
check("family note: no body is a 400", refused(decide(FW, NOTE, {"family": fk, "body": " "}, MASTER), 400,
                                                "body: what the note says."))
check("family note: past 4000 characters is a 400", refused(decide(FW, NOTE, {"family": fk, "body": "y" * 4001}, MASTER),
                                                             400, "body: up to 4000 characters."))
d = decide(FW, NOTE, {"family": fk, "body": "Check note"}, MASTER)
check("family note: a good note is Apps Script's to file, nothing laid before", handed(d), shown_d(d))
TIE_BAD_CLIENT = "client_key: one of this family member's clients."
d = decide(FW, TIE, {"family": fk, "client_key": "zz_nobody", "incident_ts": "2026-01-02T10:00:00"}, MASTER)
check("incident tie: a client not theirs is a 400 resting on the copy", refused(d, 400, TIE_BAD_CLIENT, True), shown_d(d))
d = decide(FW, TIE, {"family": fk, "client_key": client, "incident_ts": "yesterday"}, MASTER)
check("incident tie: a timestamp not as filed is a 400",
      refused(d, 400, "incident_ts: the report's timestamp, as it was filed."), shown_d(d))
d = decide(FW, TIE, {"family": fk, "client_key": client, "incident_ts": "2026-01-02T10:00:00"}, MASTER)
check("incident tie: a good tie is Apps Script's (it finds it there or mints it)", handed(d), shown_d(d))
day = lambda n: gsjs.day_shift(R.today(), n)
cb = lambda **kw: {"family": fk, "client_key": client, "date": day(3), "priority": "high", "details": "Check", **kw}
check("call: a client not theirs is a 400", refused(decide(FW, CALL, cb(client_key="zz_nobody"), MASTER), 400, TIE_BAD_CLIENT))
check("call: a day that is no day is a 400", refused(decide(FW, CALL, cb(date="2026-02-30"), MASTER), 400,
                                                     "date: a day, yyyy-mm-dd."))
check("call: a day past is a 400", refused(decide(FW, CALL, cb(date=day(-1)), MASTER), 400, "date: today or later."))
check("call: an unknown priority is a 400", refused(decide(FW, CALL, cb(priority="panic"), MASTER), 400,
                                                    "priority: one of normal, high, urgent."))
check("call: details past 4000 characters are a 400", refused(decide(FW, CALL, cb(details="y" * 4001), MASTER), 400,
                                                              "details: up to 4000 characters."))
d = decide(FW, CALL, cb(priority=""), MASTER)
check("call: a good call (priority blank is normal) is Apps Script's to file on the Task Board", handed(d), shown_d(d))
check("call: today is a good day", handed(decide(FW, CALL, cb(date=day(0)), MASTER)))

edit = F.edit_of(R, fctx)
raw = edit["raw"]
ro = [{"client_key": t["client_key"], "name": t["name"], "why": t["why"]} for t in edit["ties"] if t["why"]]
d = decide(FW, SAVE, {"family": fk, "changes": "x"}, MASTER)
check("save: changes that are not a list are a 400",
      refused(d, 400, "changes: one or more { field, value, expected }."), shown_d(d))
d = decide(FW, SAVE, {"family": fk, "changes": [{"field": "zz_field", "value": "x", "expected": ""}]}, MASTER)
want = {"status": 200, "data": {"written": [], "refused": [{"field": "zz_field", "why": "Not a field this app edits."}],
                                "family": fctx["key"], "client_keys": [], "readonly": ro}}
check("save: a field this app does not edit is refused in the .gs's words, its answer whole, nothing written",
      isinstance(d, W.Decision) and d.answer == want and not d.engine and d.fresh is True, shown_d(d))
phone = gsjs.str_(raw.get("phone"))
d = decide(FW, SAVE, {"family": fk, "changes": [{"field": "phone", "value": "3305550100", "expected": phone + "9"}]},
           MASTER)
want = {"status": 409, "data": {"written": [], "refused": [], "family": fctx["key"], "client_keys": [], "readonly": ro,
                                "current": {"phone": phone}},
        "message": "Changed since the panel was opened — reloaded, nothing was written."}
check("save: a witness gone stale is the 409 carrying what the record holds now, nothing written",
      isinstance(d, W.Decision) and d.answer == want and not d.engine, shown_d(d))
d = decide(FW, SAVE, {"family": fk, "changes": [{"field": "phone", "value": "12", "expected": phone}]}, MASTER)
check("save: a phone of two digits is refused in the .gs's words",
      isinstance(d, W.Decision) and (d.answer or {}).get("status") == 200
      and (d.answer or {}).get("data", {}).get("refused") == [{"field": "phone", "why": "A phone number has ten digits."}],
      shown_d(d))
d = decide(FW, SAVE, {"family": fk, "changes": [{"field": "email", "value": "not mail", "expected": gsjs.str_(raw.get("email"))}]},
           MASTER)
check("save: an email that is none is refused in the .gs's words",
      isinstance(d, W.Decision) and (d.answer or {}).get("data", {}).get("refused") == [{"field": "email",
                                                                                          "why": "Not an email address."}],
      shown_d(d))
locked = next(iter(sorted(edit["locked"])), "")
if locked:
    d = decide(FW, SAVE, {"family": fk, "changes": [{"field": locked, "value": "x", "expected": ""}]}, MASTER)
    check("save: a field edited elsewhere is refused with its own why",
          isinstance(d, W.Decision) and (d.answer or {}).get("data", {}).get("refused")
          == [{"field": locked, "why": edit["locked"][locked]["why"]}], shown_d(d))
d = decide(FW, SAVE, {"family": fk, "changes": [{"field": "phone", "value": phone or "3305550100", "expected": phone}]},
           MASTER)
check("save: a field that would be written is Apps Script's (records, directory and notes under its locks)",
      handed(d), shown_d(d))
import resource
out["peak_mb"] = round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024)
print(json.dumps(out, default=str))
'''

APP_DRIVER = COMMON + r'''
import contextlib, main
subjects = job["subjects"]
for k in subjects["ssa"] + subjects["family"]:
    SECRET.append(k)


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


# no store of the live service is read, made or settled from here
main.STORE, main.CLIENT_STORE, main.STAFF_STORE = FakeStore(), FakeStore(), FakeStore()
main.SSA_STORE, main.FAMILY_STORE = FakeStore(), FakeStore()

# ---- documents, their files and the SSA client views, where Drive answers ----
def no_activity(reads, ctx, parts=None):
    raise sc.Defer("read in the database run")


S.PACK_DOORS = {**S.PACK_DOORS, "activity": no_activity}
packs, files = {}, []
for i, k in enumerate(subjects["ssa"]):
    t = time.monotonic()
    try:
        env = S.ssa_pack(sess(SERVICE), {"ssa": k})
    except (sc.Defer, hubdb.Unreadable) as e:
        env = {"deferred": str(e)[:200]}
    packs[k] = {"env": env, "s": round(time.monotonic() - t, 2)}
    got = timed("ssaProfileDocuments", lambda: S.ssa_profile_documents(sess(MASTER), {"ssa": k}))
    docs = (got.get("data") or {}).get("docs") or []
    check(f"ssaProfileDocuments as the master, SSA {i + 1}: 200, no withheld cell",
          got.get("status") == 200 and MARK not in json.dumps(got), brief(got))
    fid = next((d["file_id"] for d in docs if d.get("file_id")), "")
    if fid:
        got = timed("ssaProfileDocFile", lambda: S.ssa_profile_doc_file(sess(MASTER), {"ssa": k, "file_id": fid}))
        data = got.get("data") or {}
        files.append({"door": "ssa", "status": got.get("status"), "mime": data.get("mime"), "size": data.get("size"),
                      "b64": bool(data.get("b64")), "message": got.get("message") or ""})
        check(f"ssaProfileDocFile as the master, SSA {i + 1}: a listed file comes back as bytes (or Drive's own refusal)",
              (got.get("status") == 200 and data.get("id") == fid and data.get("b64") and data.get("size"))
              or got.get("status") in (400, 404, 415), brief(got))
    got = S.ssa_profile_doc_file(sess(MASTER), {"ssa": k, "file_id": "zzCheckNotListed0001"})
    check(f"ssaProfileDocFile, SSA {i + 1}: a file the SSA's list does not name is the door's 404",
          got == {"status": 404, "message": "This SSA names no such document."}, brief(got))
out["packs"] = packs
for i, k in enumerate(subjects["family"]):
    got = timed("familyProfileDocuments", lambda: F.family_profile_documents(sess(MASTER), {"family": k}))
    docs = (got.get("data") or {}).get("docs") or []
    check(f"familyProfileDocuments as the master, family member {i + 1}: 200, no withheld cell",
          got.get("status") == 200 and MARK not in json.dumps(got), brief(got))
    fid = next((d["file_id"] for d in docs if d.get("file_id")), "")
    if fid:
        got = timed("familyProfileDocFile", lambda: F.family_profile_doc_file(sess(MASTER), {"family": k, "file_id": fid}))
        data = got.get("data") or {}
        files.append({"door": "family", "status": got.get("status"), "mime": data.get("mime"), "size": data.get("size"),
                      "b64": bool(data.get("b64")), "message": got.get("message") or ""})
        check(f"familyProfileDocFile as the master, family member {i + 1}: a listed file comes back as bytes",
              (got.get("status") == 200 and data.get("id") == fid and data.get("b64") and data.get("size"))
              or got.get("status") in (400, 404, 415), brief(got))
    got = F.family_profile_doc_file(sess(MASTER), {"family": k, "file_id": "zzCheckNotListed0001"})
    check(f"familyProfileDocFile, family member {i + 1}: a file not on the member's list is the door's 404",
          got == {"status": 404, "message": "This family member names no such document."}, brief(got))
out["files"] = files

# ---- the lane (app/main.py) ----
check("lane: SSA and Families are registered beside Locations, Clients and Staff, each with its own store",
      main.APPS.get("ssa") is S and main.APPS.get("family") is F and main.WRITES.get("ssa") is SW
      and main.WRITES.get("family") is FW
      and set(main.stores()) == {"locations", "clients", "staff", "ssa", "family", "scheduling", "transportation"})
staff_u = {**BASE, "id": "u-check-staff", "email": "staff.check@example.org", "role": "staff"}
manager = {**BASE, "id": "u-check-mgr", "email": "mgr.check@example.org", "role": "manager"}
check("lane: the resolver's roles and types, as it says them",
      main.policy_gate(S, "ssaPack", {}, staff_u) == {"status": 403, "message": "This action is for admin."}
      and main.policy_gate(F, "familyPack", {}, manager) == {"status": 403, "message": "This action is for admin."}
      and main.policy_gate(F, "familyProfileOverview", {"edit": "yes"}, MASTER)
      == {"status": 400, "message": "edit must be boolean, got string."}
      and main.policy_gate(FW, "familyProfileSave", {"changes": "x"}, MASTER)
      == {"status": 400, "message": "changes must be array, got string."}
      and main.policy_gate(S, "ssaProfileRoster", {}, staff_u) is None)
said = {"uid": MASTER["id"], "role": "admin", "is_master": True}
res = main._run(main.APPS["ssa"], "ssaProfileRoster", said, {})
body = json.loads(res.body)
check("lane: the SSA roster is answered for the master with the copy's age", res.status_code == 200
      and body.get("status") == 200 and (body.get("data") or {}).get("viewer") == "master"
      and bool(res.headers.get("x-hub-as-of")), {"code": res.status_code, "status": body.get("status")})
res = main._run(main.APPS["family"], "familyProfileRoster", said, {})
body = json.loads(res.body)
check("lane: the Families roster is answered for the master", res.status_code == 200 and body.get("status") == 200
      and ((body.get("data") or {}).get("view") or {}).get("kind") == "master", {"code": res.status_code})
k = subjects["ssa"][0]
res = main._run_write(SW, "ssaProfileNoteAdd", said, {"ssa": k, "body": ""}, "Wcheck-ssa-lane-01")
body = json.loads(res.body)
check("lane: an SSA refusal is the door's envelope, kept once in the SSA store's receipts alone",
      res.status_code == 200 and body == {"status": 400, "message": "body: what the note says."}
      and "Wcheck-ssa-lane-01" in main.SSA_STORE.receipts and not main.STAFF_STORE.receipts
      and not main.FAMILY_STORE.receipts, body)
res = main._run_write(SW, "ssaProfileNoteAdd", said, {"ssa": k, "body": "Check"}, "Wcheck-ssa-lane-02")
plan = json.loads(res.body).get("_write") or {}
check("lane: a good SSA note is handed on with nothing to lay (the relay keys it by the payload's ssa)",
      plan == {"write_id": "Wcheck-ssa-lane-02", "engine": True, "settle": False, "house": ""}
      and not main.SSA_STORE.records, plan)
fk = subjects["family"][0]
res = main._run_write(FW, "familyProfileNoteAdd", said, {"family": fk, "body": "Check"}, "Wcheck-fam-lane-01")
plan = json.loads(res.body).get("_write") or {}
check("lane: a good family note is handed on, its receipt in the Families store",
      plan == {"write_id": "Wcheck-fam-lane-01", "engine": True, "settle": False, "house": ""}
      and "Wcheck-fam-lane-01" in main.FAMILY_STORE.receipts and not main.FAMILY_STORE.records, plan)
res = main._run_write(FW, "familyProfileNoteAdd", said, {"family": fk, "body": "Check"}, "Wcheck-fam-lane-01")
plan = json.loads(res.body).get("_write") or {}
check("lane: the same write id again is the receipt replayed", plan.get("replay") is True, plan)

# ---- the store's SQL: made and recorded inside one transaction rolled back ----
import psycopg
dsn = os.environ.get("HUB_DB_WRITE_DSN", "")
if dsn:
    conn = psycopg.connect(dsn, autocommit=True, connect_timeout=5)
    q = ("select to_regclass('app.ssa_writes') is not null, to_regclass('app.family_writes') is not null,"
         " (select count(*) from pg_tables where schemaname = 'app')")
    before = conn.execute(q).fetchone()
    seen = {}
    try:
        with conn.transaction():
            for kind, mod, action, payload in (("ssa", SW, "ssaProfileNoteAdd", {"ssa": k, "body": "Check"}),
                                               ("family", FW, "familyProfileNoteAdd", {"family": fk, "body": "Check"})):
                st = mod.Store(dsn="", connect=lambda: conn)
                seen[kind + "_ensure"] = st.ensure()
                dec = mod.ACTIONS[action](sess(MASTER), payload)
                tx = W.Tx(conn.cursor(), kind)
                envl = W.envelope(dec, "Wcheck-sql-" + kind, MASTER)
                tx.record("Wcheck-sql-" + kind, action, envl, dec, W.who(MASTER))
                seen[kind + "_receipt"] = tx.receipt("Wcheck-sql-" + kind) == json.loads(json.dumps(envl))
                seen[kind + "_rows"] = conn.execute(f"select count(*) from app.{kind}_writes").fetchone()[0]
                seen[kind + "_live"] = st.live()
            raise psycopg.Rollback()
    finally:
        after = conn.execute(q).fetchone()
        conn.close()
    for kind in ("ssa", "family"):
        check(f"store: app.{kind}_writes and app.{kind}_receipts are made by the writer role",
              seen.get(kind + "_ensure") == "", seen.get(kind + "_ensure"))
        check(f"store: a handed {kind} write is kept as a receipt alone, nothing laid",
              seen.get(kind + "_receipt") is True and seen.get(kind + "_rows") == 0 and seen.get(kind + "_live") == [],
              {x: seen.get(kind + x) for x in ("_receipt", "_rows")})
    check("store: rolled back — app.* holds what it held before", tuple(before) == tuple(after), [before, after])
else:
    check("store: HUB_DB_WRITE_DSN is set in the runner", False, "unset")
import resource
out["peak_mb"] = round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024)
print(json.dumps(out, default=str))
'''


def run_driver(runner: str, driver: str, modules: tuple, job: dict, ceiling: int) -> dict:
    blob = {"order": list(modules), "src": {n: (APP / f"{n}.py").read_text(encoding="utf-8") for n in modules},
            "job": job, "ceiling": ceiling}
    got = docker("exec", "-i", "-e", "MALLOC_ARENA_MAX=2", runner, "python", "-c", driver,
                 data=base64.b64encode(json.dumps(blob).encode()) + b"\n", timeout=2400)
    lines = got.stdout.decode().strip().splitlines()
    last = json.loads(lines[-1]) if lines else {}
    if "aborted" in last:
        raise RuntimeError(f"the check stopped itself in {runner}: the container reached {last['aborted']} MiB")
    if got.returncode != 0 or not lines:
        raise RuntimeError(f"the check did not run in {runner}: {got.stderr.decode()[-1200:]}")
    return last


def said_checks(out: dict) -> None:
    for name, ok, detail in out.get("checks") or []:
        check(name, ok, detail)


def compare(label: str, ours: Any, theirs: Any, when: dict[str, str], show: int = 4) -> int:
    found: list = []
    P.diff(ours, theirs, label, found, when)
    return P.report(label, found, show, False) if found else 0


def when_of(read_at: float, started: float) -> dict[str, str]:
    return {"read_day": datetime.fromtimestamp(read_at, NY).strftime("%Y-%m-%d"),
            "today": datetime.fromtimestamp(started, NY).strftime("%Y-%m-%d")}


def ssa_parity(kept: dict[str, dict], py: dict[str, dict], parts: tuple[str, ...], started: float) -> int:
    """Each kept SSA pack's parts against Python's; a part Python left to Apps Script is counted with its reason."""
    per: dict[str, list[int]] = {}
    reasons: dict[str, int] = {}
    unexplained = 0
    for n, key in enumerate(sorted(py), start=1):
        body = kept[key]
        gs = body["data"]
        mine = py[key]
        env = mine.get("env") or {}
        if env.get("status") != 200:
            check(f"s{n:02d}: Python builds the SSA pack", False, env.get("deferred") or env.get("message"))
            continue
        data = env["data"]
        check(f"s{n:02d}: the pack names the same SSA and every part (built in {mine.get('s')}s)",
              data.get("ssa") == gs.get("ssa") and set(data["part_status"]) == set(gs["part_status"]))
        when = when_of(float(body.get("read_at") or 0), started)
        for part in parts:
            row = per.setdefault(part, [0, 0, 0])
            st = data["part_status"].get(part) or {}
            if st.get("status") != 200:
                why = (mine.get("why") or {}).get(part) or st.get("message") or "?"
                why = re.sub(r"\(\d+\)|\b\d+\b", "#", why)
                reasons[f"{part}: {why}"] = reasons.get(f"{part}: {why}", 0) + 1
                row[2] += 1
                continue
            real = compare(f"s{n:02d}.{part}", data["parts"].get(part), gs["parts"].get(part), when)
            unexplained += real
            row[1 if real else 0] += 1
    print("    per part (equal / differing / left to Apps Script):")
    for part, (a, b, c) in sorted(per.items()):
        print(f"      {part:13s} {a:3d} / {b:3d} / {c:3d}")
    for why, n in sorted(reasons.items(), key=lambda x: (-x[1], x[0])):
        print(f"      {n:3d}x left: {why}")
    return unexplained


def relay_checks() -> None:
    """BACKEND_APPS beside what was committed, and the overlay's file untouched."""
    now = (ROOT / "server" / "snapshot_service.py").read_text(encoding="utf-8")
    head = subprocess.run(["git", "-C", str(ROOT), "show", "HEAD:server/snapshot_service.py"], capture_output=True,
                          text=True).stdout

    def apps(source: str) -> dict[str, Any]:
        for node in ast.parse(source).body:
            if isinstance(node, ast.AnnAssign) and getattr(node.target, "id", "") == "BACKEND_APPS":
                return {k.value: v for k, v in zip(node.value.keys, node.value.values)}
        return {}

    cur, was = apps(now), apps(head)
    check("relay: Locations', Clients' and Staff's BACKEND_APPS entries are as committed",
          bool(was) and all(k in cur and ast.dump(cur[k]) == ast.dump(was[k]) for k in ("locations", "clients", "staff")))
    check("relay: SSA and Families are switchable apps of their own", {"ssa", "family"} <= set(cur))
    same = subprocess.run(["git", "-C", str(ROOT), "diff", "--quiet", "HEAD", "--", "server/edit_overlay.py"])
    check("relay: the edit overlay is as committed (neither app lays an edit there)", same.returncode == 0)


RELAY_DRIVER = r'''
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
os.environ["QUO_HOTLINE_WEBHOOK_KEY_FILE"] = "/nonexistent/ssa-family-test.key"
os.environ["HUB_PSI_PROBE"] = "0"
os.environ["HUB_PSI_SECRET_FILE"] = "/nonexistent/ssa-family-test.json"
os.environ["HUB_PSI_TY_SECRET_FILE"] = "/nonexistent/ssa-family-test-ty.json"
os.environ["HUB_PSI_FULL_DIR"] = "/tmp/ssa-family-test-psi-full"
os.environ.pop("QUO_HOTLINE_WEBHOOK_KEY", None)
os.environ["HUB_QUO_MESSAGES_KEY_FILE"] = "/nonexistent/ssa-family-test-messages.key"
os.environ["HUB_QUO_API_KEY_FILE"] = "/nonexistent/ssa-family-test-api.key"
os.environ["HUB_QUO_INBOX_DIR"] = "/nonexistent/ssa-family-test-inbox"
sys.meta_path.insert(0, Checkout())
sys.path.insert(0, "/srv/app")
import snapshot_service as S

checks, settled, keyed, answers, calls, packs = [], [], [], {}, [], []


def check(name, ok, detail=""):
    checks.append([name, bool(ok), "" if ok else str(detail)[:300]])


async def yes(_a):
    return True


async def actor(_a):
    return ("admin", "u-check")


async def master(_a):
    return (True, "")


async def call(app_id, action, payload, user, extra=None, timeout=None):
    calls.append((app_id, action, payload, user, timeout))
    env = json.loads(json.dumps(answers[action]))
    return json.dumps(env).encode(), time.time() + 5, env, frozenset(), 0.0


real_after = S._backend_written_after


def after(app_id, key, as_of, held=None, *, any_key=False, pack="", edits_at=0.0):
    keyed.append((app_id, key, any_key, pack))
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


SSA_READS = {"ssaProfileRoster", "ssaProfileOverview", "ssaProfileDocuments", "ssaProfileActivity", "ssaProfileNotes",
             "ssaProfileDocFile"}
FAM_READS = {"familyProfileRoster", "familyProfileOverview", "familyProfileDocuments", "familyProfileActivity",
             "familyProfileNotes", "familyProfileDocFile"}
FAM_WRITES = {"familyProfileNoteAdd", "familyProfileIncidentTie", "familyProfileCallSchedule", "familyProfileSave"}


async def go():
    check("relay: the SSA and Families reads go to Python under their own switch, each a no-receipt read",
          {a for a, app in S._BACKEND_ACTIONS.items() if app == "ssa"} == SSA_READS
          and {a for a, app in S._BACKEND_ACTIONS.items() if app == "family"} == FAM_READS
          and (SSA_READS | FAM_READS) <= S.RELAY_NO_RECEIPT_ACTIONS
          and {"ssaProfileDocFile", "familyProfileDocFile"} <= S.RELAY_BYTE_READS)
    check("relay: the SSA note and edit and the four Families writes go to Python, never as no-receipt reads",
          {a for a, app in S._BACKEND_WRITES.items() if app == "ssa"} == {"ssaProfileNoteAdd", "ssaProfileEdit"}
          and {a for a, app in S._BACKEND_WRITES.items() if app == "family"} == FAM_WRITES
          and not ({"ssaProfileNoteAdd", "ssaProfileEdit"} | FAM_WRITES) & S.RELAY_NO_RECEIPT_ACTIONS)
    check("relay: the packs' kept-copy keys fold the payload's ssa and family",
          S._backend_key("ssa", {"ssa": " ssa_abc "}) == "ssa_abc" and S._backend_key("family", {"family": "fam_abc"}) == "fam_abc"
          and S._backend_key("ssa", {"ssa": "A B"}) == "" and S._BACKEND_OF_PACK.get("ssa-profiles") == "ssa"
          and S._BACKEND_OF_PACK.get("family-profiles") == "family")
    answers["ssaProfileNoteAdd"] = {"status": 200, "_write": {"write_id": "Wcheck-relay-ssaProfileNoteAdd",
                                                               "engine": True, "settle": False, "house": ""}}
    keyed.clear()
    res, _raw, settle = await S._backend_write("ssaProfileNoteAdd", raw_of("ssaProfileNoteAdd", {"ssa": "ssa_abc", "body": "x"}))
    check("relay: a good SSA note goes on to Apps Script, keyed by the payload's ssa, nothing laid or settled",
          res is None and settle is None and keyed == [("ssa", "ssa_abc", False, "")] and not settled, [keyed, settled])
    answers["familyProfileSave"] = {"status": 200, "data": {"written": [], "refused": [{"field": "zz", "why": "x"}],
                                                            "family": "fam_abc", "client_keys": [], "readonly": []}}
    keyed.clear()
    res, _raw, settle = await S._backend_write("familyProfileSave", raw_of("familyProfileSave", {"family": "fam_abc", "changes": []}))
    check("relay: a Families save that writes nothing is Python's answer, keyed by the payload's family",
          res is not None and json.loads(res.body) == answers["familyProfileSave"] and settle is None
          and keyed == [("family", "fam_abc", False, "")], [keyed, getattr(res, "body", None)])
    answers["familyProfileCallSchedule"] = {"status": 200, "_write": {"write_id": "Wcheck-relay-familyProfileCallSchedule",
                                                                       "engine": True, "settle": False, "house": ""}}
    res, _raw, settle = await S._backend_write("familyProfileCallSchedule",
                                               raw_of("familyProfileCallSchedule", {"family": "fam_abc", "client_key": "x"}))
    check("relay: a call Python hands on goes to Apps Script", res is None and settle is None and not settled, settled)
    answers["clientProfileSave"] = {"status": 200, "data": {"written": [], "refused": [{"field": "ssn", "why": "x"}]}}
    keyed.clear()
    res, _raw, _settle = await S._backend_write("clientProfileSave", raw_of("clientProfileSave", {"client": "x_y", "ssa": "ssa_q"}))
    check("relay: a Clients write is keyed by its client as before", res is not None and keyed == [("clients", "x_y", False, "")], keyed)
    answers["ssaProfileRoster"] = {"status": 200, "data": {"ssas": [], "viewer": "master"}}
    keyed.clear()
    got = await S._backend_answer("ssaProfileRoster", raw_of("ssaProfileRoster", {}))
    check("relay: the SSA roster names no key, so it is as old as the newest write to any SSA",
          got is not None and keyed == [("ssa", "", True, "")], keyed)
    answers["familyProfileOverview"] = {"status": 200, "data": {}}
    keyed.clear()
    calls.clear()
    got = await S._backend_answer("familyProfileOverview", raw_of("familyProfileOverview", {"family": "fam_abc", "edit": True}))
    check("relay: a Families read is keyed by its family member", got is not None and keyed == [("family", "fam_abc", False, "")]
          and calls[0][3] == {"uid": "u-check", "role": "admin", "is_master": True}, [keyed, calls[:1]])

    # the fills: Python first, Apps Script when Python leaves it
    answers["ssaPack"] = {"status": 200, "data": {"ssa": "ssa_abc", "parts": {}, "part_status": {}}}
    answers["familyPack"] = {"status": 200, "data": {"family": "fam_abc", "parts": {}, "part_status": {}}}
    answers["familyIndexPack"] = {"status": 200, "data": {"parts": {}, "part_status": {}}}
    keyed.clear()
    calls.clear()
    got = await S._app_pack_exec_ssas("ssa_abc")
    check("relay: the SSA pack is filled by Python for the relay's own identity, under its key",
          got.get("status") == 200 and calls[0][:4] == ("ssa", "ssaPack", {"ssa": "ssa_abc"}, {"is_service": True})
          and keyed == [("ssa", "ssa_abc", False, "")] and isinstance(got.get("as_of"), float), [calls[:1], keyed])
    S._app_pack_family_refused["fam_abc"] = (time.time(), "x")
    keyed.clear()
    calls.clear()
    got = await S._app_pack_exec_families("fam_abc")
    check("relay: a family member's pack is filled by Python, and a refusal kept for that key is forgotten",
          got.get("status") == 200 and calls[0][:3] == ("family", "familyPack", {"family": "fam_abc"})
          and "fam_abc" not in S._app_pack_family_refused, calls[:1])
    answers["familyPack"] = {"status": 200, "data": {"family": "fam_other", "parts": {}, "part_status": {}}}
    await S._app_pack_exec_families("fam_abc")
    check("relay: Python answering under another key rests that key, as Apps Script's answer does",
          "fam_abc" in S._app_pack_family_refused)
    S._app_pack_family_refused.pop("fam_abc", None)
    keyed.clear()
    calls.clear()
    got = await S._app_pack_exec_family_index("all")
    check("relay: the Families index is filled by Python, its writes read off the index's own kept copy",
          got.get("status") == 200 and calls[0][:2] == ("family", "familyIndexPack")
          and keyed == [("family", "all", False, "family-index")], [calls[:1], keyed])
    answers["familyIndexPack"] = {"status": 404, "message": "Unknown action."}
    S._app_pack_credential = lambda: None
    try:
        await S._app_pack_exec_family_index("all")
        fell = False
    except RuntimeError as e:
        fell = "service identity" in str(e)
    check("relay: a fill Python refuses goes on to Apps Script", fell)


asyncio.run(go())
print("RELAY-CHECKS " + json.dumps(checks))
'''


def run_relay() -> None:
    src = {p.stem: p.read_text(encoding="utf-8") for p in (ROOT / "server").glob("*.py")}
    script = f"RELAY_SOURCES = {base64.b64encode(json.dumps(src).encode()).decode()!r}\n" + RELAY_DRIVER
    decl = (ROOT / "server" / "ist_config_defaults.json").read_text(encoding="utf-8")
    got = subprocess.run(["docker", "exec", "-i", "-e", "HUB_IST_CONFIG_DECLARATION_JSON=" + decl, RELAY, "python3", "-"],
                         input=script, capture_output=True, text=True, timeout=600)
    line = next((x for x in got.stdout.splitlines() if x.startswith("RELAY-CHECKS ")), "")
    if not line:
        check("relay: the write path ran over fakes", False, got.stderr[-600:])
        return
    for name, ok, detail in json.loads(line[len("RELAY-CHECKS "):]):
        check(name, ok, detail)


def timing(out: dict, label: str) -> None:
    slow = {a: max(t) for a, t in (out.get("timing") or {}).items() if t}
    if slow:
        print(f"\n  slowest per door ({label}, s): " + ", ".join(f"{a} {t}" for a, t in sorted(slow.items())))


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--skip-app", action="store_true", help="leave out the run in asa-hub-app (Drive and the lane)")
    args = ap.parse_args()
    if not shutil.which("docker"):
        print("test-ssa-family: skipped — no docker here")
        return 0
    started = time.time()
    kept = kept_packs()
    print(f"kept by the relay: {len(kept['ssa-profiles'])} SSA pack(s), {len(kept['family-index'])} Families index, "
          f"{len(kept['family-profiles'])} family pack(s)")
    runner = DB_RUNNER if running(DB_RUNNER) else ""
    if not runner:
        check(f"{DB_RUNNER} runs the database checks", False, "not running; asa-hub-app is never loaded with them")
        return 1
    print(f"\nTHE DATABASE RUN — {runner} ({mem_now(runner) >> 20} MiB in use before)")
    db_out = run_driver(runner, DB_DRIVER, DB_MODULES, {"ssa_keys": sorted(kept["ssa-profiles"])}, DB_CEILING)
    print(f"  Python ran in {time.time() - started:.0f}s, peak {db_out.get('peak_mb')} MiB; Drive "
          f"{'present' if db_out.get('drive') else 'absent'} there")
    said_checks(db_out)
    timing(db_out, runner)
    print("  every family member's activity as the master: " +
          ", ".join(f"{n}x {w}" for w, n in sorted((db_out.get("census") or {}).items())))

    print("\nPARITY — Python's ssaPack against the relay's kept ssaPack answers (Apps Script's)")
    py_packs = db_out["packs"]
    unexplained = ssa_parity(kept["ssa-profiles"], py_packs["ssa"],
                             ("overview", "activity", "notes", "documents", "client_views"), started)
    print("\nPARITY — Python's familyIndexPack against the relay's kept one")
    idx_kept = next(iter(kept["family-index"].values()), None)
    idx_py = (py_packs.get("index") or {}).get("env") or {}
    if idx_kept is None:
        print("  no kept Families index to compare against")
    elif idx_py.get("status") != 200:
        check("Python builds the Families index", False, idx_py.get("deferred") or idx_py.get("message"))
    else:
        when = when_of(float(idx_kept.get("read_at") or 0), started)
        for part in sorted(idx_kept["data"]["parts"]):
            unexplained += compare(f"index.{part}", idx_py["data"]["parts"].get(part), idx_kept["data"]["parts"][part],
                                   when) if part in idx_py["data"]["parts"] else 0
        check("the index carries the same parts and statuses", idx_py["data"]["part_status"] == idx_kept["data"]["part_status"],
              [idx_py["data"]["part_status"], idx_kept["data"]["part_status"]])
        print(f"    Python built it in {py_packs['index']['s']}s")
    print("\nPARITY — three family members' packs against the kept index (no family pack is kept by the relay)")
    compared = 0
    for n, (key, mine) in enumerate(sorted(py_packs["family"].items()), start=1):
        env = mine.get("env") or {}
        st = (env.get("data") or {}).get("part_status") or {}
        check(f"f{n}: Python builds the family pack in {mine.get('s')}s — " +
              ", ".join(f"{p} {s.get('status')}" for p, s in sorted(st.items())), env.get("status") == 200,
              env.get("deferred") or env.get("message"))
        if idx_kept is None or env.get("status") != 200:
            continue
        when = when_of(float(idx_kept.get("read_at") or 0), started)
        kept_parts = idx_kept["data"]["parts"]
        ov = (env["data"]["parts"].get("overview") or {})
        unexplained += compare(f"f{n}.overview", {k: v for k, v in ov.items() if k != "display"},
                               (kept_parts.get("overviews") or {}).get(key), when)
        unexplained += compare(f"f{n}.notes", env["data"]["parts"].get("notes"), (kept_parts.get("notes") or {}).get(key),
                               when)
        compared += 2
    print(f"    {compared} part(s) compared")
    print("\nPARITY — the master's doors against the kept packs")
    compared = 0
    subjects = db_out.get("subjects") or {"ssa": [], "family": []}
    for n, key in enumerate(subjects["ssa"], start=1):
        body = kept["ssa-profiles"].get(key)
        doors = (db_out.get("doors") or {}).get("ssa", {}).get(key, {})
        if body is None:
            continue
        when = when_of(float(body.get("read_at") or 0), started)
        for action, part in (("ssaProfileOverview", "overview"), ("ssaProfileNotes", "notes")):
            got = doors.get(action) or {}
            if got.get("status") == 200 and part in body["data"]["parts"]:
                unexplained += compare(f"d{n}.{action}", got.get("data"), body["data"]["parts"][part], when)
                compared += 1
    for n, key in enumerate(subjects["family"], start=1):
        doors = (db_out.get("doors") or {}).get("family", {}).get(key, {})
        if idx_kept is None:
            continue
        when = when_of(float(idx_kept.get("read_at") or 0), started)
        got = doors.get("familyProfileNotes") or {}
        if got.get("status") == 200:
            unexplained += compare(f"g{n}.familyProfileNotes", {k: v for k, v in got["data"].items() if k != "display"},
                                   (idx_kept["data"]["parts"].get("notes") or {}).get(key), when)
            compared += 1
        got = doors.get("familyProfileOverview") or {}
        if got.get("status") == 200:
            unexplained += compare(f"g{n}.familyProfileOverview", got["data"],
                                   (idx_kept["data"]["parts"].get("overviews") or {}).get(key), when)
            compared += 1
    print(f"    {compared} answer(s) compared")

    if not args.skip_app:
        used = mem_now(APP_RUNNER)
        print(f"\nTHE APP RUN — {APP_RUNNER} ({used >> 20} MiB in use before; the check stops itself at "
              f"{APP_CEILING >> 20} MiB)")
        if not used or used > APP_CEILING - 220 * MiB:
            check(f"{APP_RUNNER} has room for the check", False, f"{used >> 20} MiB in use")
        else:
            app_out = run_driver(APP_RUNNER, APP_DRIVER, APP_MODULES, {"subjects": subjects}, APP_CEILING)
            print(f"  peak {app_out.get('peak_mb')} MiB; Drive {'present' if app_out.get('drive') else 'absent'}; "
                  f"files opened: " + ", ".join(f"{f['door']} {f['status']} {f['mime']} {f['size']}B"
                                                for f in app_out.get("files") or []))
            said_checks(app_out)
            timing(app_out, APP_RUNNER)
            print("\nPARITY — documents and the client views, where Drive answers")
            unexplained += ssa_parity(kept["ssa-profiles"], app_out.get("packs") or {}, ("documents", "client_views"),
                                      started)
    print("\nTHE RELAY — its routing over fakes, in its own container, never started")
    relay_checks()
    run_relay()
    check("no difference beyond a timestamp's milliseconds and the read's own clock", unexplained == 0,
          f"{unexplained} difference(s) above")
    print(f"\ntest-ssa-family: {results['ok']} ok, {len(results['failed'])} failed")
    return 1 if results["failed"] else 0


if __name__ == "__main__":
    sys.exit(main())
