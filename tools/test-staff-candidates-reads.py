#!/usr/bin/env python3
"""Staff Candidates' reads (app/candidates.py) on real candidates in asa-hub-db-sync, against the relay's kept
candidatePack copies (Apps Script's answers): the roster, every door as the master, the pack as the relay's service,
the gates (a released narrowed reader, an unreleased account), and Python's own facts laid over the copy. Nothing is
written: the laid facts live in this process only. Prints shapes, counts and paths, never a candidate's values."""
from __future__ import annotations

import base64
import json
import py_compile
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DB_RUNNER = "asa-hub-db-sync"
RELAY = "asa-hub-snapshot"

KEPT = r'''
import json, os
out = {}
for f in os.listdir("/srv/app-packs"):
    try:
        d = json.load(open("/srv/app-packs/" + f))
    except Exception:
        continue
    if isinstance(d, dict) and d.get("app") == "staff-candidates":
        out[d["key"]] = {"data": d["data"], "filled_at": d.get("filled_at")}
print(json.dumps(out))
'''

DRIVER = r'''
import base64, importlib.abc, importlib.util, json, os, sys, time, types, uuid
blob = json.loads(base64.b64decode(sys.stdin.readline()).decode())
SRC = blob["app"]


class Checkout(importlib.abc.MetaPathFinder, importlib.abc.Loader):
    def find_spec(self, name, path, target=None):
        return importlib.util.spec_from_loader(name, self, origin="checkout:" + name) if name in SRC else None

    def create_module(self, spec):
        return None

    def exec_module(self, module):
        module.__file__ = module.__name__ + ".py"
        exec(compile(SRC[module.__name__], module.__name__ + ".py", "exec"), module.__dict__)


sys.meta_path.insert(0, Checkout())
fake = types.ModuleType("fastapi")


class App:
    def __init__(self, **_kw):
        pass

    def _route(self, *_a, **_kw):
        return lambda fn: fn
    get = post = _route


fake.FastAPI, fake.Request = App, object
responses = types.ModuleType("fastapi.responses")
responses.JSONResponse = responses.Response = object
conc = types.ModuleType("starlette.concurrency")
conc.run_in_threadpool = None
sys.modules.update({"fastapi": fake, "fastapi.responses": responses, "starlette": types.ModuleType("starlette"),
                    "starlette.concurrency": conc})
os.environ.setdefault("HUB_DB_DSN", "host=%s dbname=%s user=%s password=%s" % (
    os.environ.get("HUB_DB_HOST", "asa-hub-db"), os.environ["POSTGRES_DB"], os.environ["POSTGRES_USER"],
    os.environ["POSTGRES_PASSWORD"]))

import gsjs, hubdb, locations as L, scope as sc, writes as W
import candidates as CND
from main import js_json

checks, facts = [], {}
kept = blob["kept"]


def check(name, ok, detail=""):
    checks.append([name, bool(ok), detail])


def norm(v):
    return json.loads(json.dumps(js_json(v), ensure_ascii=False))


def diff(a, b, path="", out=None):
    out = [] if out is None else out
    if isinstance(a, dict) and isinstance(b, dict):
        if list(a) != list(b):
            out.append(path + ": keys")
        for k in a:
            if k in b:
                diff(a[k], b[k], path + "." + k, out)
    elif isinstance(a, list) and isinstance(b, list):
        if len(a) != len(b):
            out.append(path + ": length")
        for i, (x, y) in enumerate(zip(a, b)):
            diff(x, y, f"{path}[{i}]", out)
    elif a != b:
        out.append(path)
    return out


def explained(path, a_pack, key):
    """A difference the copy cannot carry: a call's milliseconds, or the read's own clock (days at stage)."""
    import re
    if re.fullmatch(r"transcripts\.calls\[\d+\]\.at", path):
        return True
    if path.endswith("days_at_stage"):
        return True
    return False


def run(fn, sess, payload):
    try:
        return fn(sess, payload)
    except sc.Defer as e:
        return {"deferred": str(e)}


db = hubdb.HubDb()
reads0 = L.Reads(db)
row = next(u for u in reads0.users() if gsjs.str_(u.get("email")).lower() == sc.MASTER_ACCOUNT
           and not gsjs.str_(u.get("mergedinto")))
master = sc.user_from_row(row)
service = {"is_service": True, "role": "admin", "id": "", "email": ""}
check("the master's users row is the real master", sc.is_real_master(master))


def msess(user=None):
    return L.Session(L.Reads(db), user or master)


# the roster, as the master
t0 = time.time()
roster = CND.ACTIONS["candidateProfileRoster"](msess(), {})
facts["roster"] = f"{roster.get('status')} · {len((roster.get('data') or {}).get('candidates') or [])} candidates · " \
                  f"{time.time() - t0:.2f}s"
check("roster answers 200 with every stage counted", roster.get("status") == 200
      and [s["id"] for s in roster["data"]["stages"]] == list(CND.TALENT_STAGE_ORDER))
cands = roster["data"]["candidates"]
check("roster keys are the kept packs' candidates", {c["key"] for c in cands} >= set(kept) and bool(kept),
      f"roster {len(cands)}, kept {len(kept)}")
facts["roster stages"] = ", ".join(f"{s['id']}={s['count']}" for s in roster["data"]["stages"])

# three candidates at different stages, every door as the master, against the kept pack
by_stage = {}
for c in cands:
    if c["key"] in kept:
        by_stage.setdefault(c["stage"], c["key"])
picked = list(by_stage.values())[:3]
facts["picked stages"] = ", ".join(c["stage"] for c in cands if c["key"] in picked)
DOORS = {"overview": "candidateProfileOverview", "actions": "candidateProfileActions",
         "interviews": "candidateProfileInterviews", "documents": "candidateProfileDocuments",
         "activity": "candidateProfileActivity", "transcripts": "candidateProfileTranscripts",
         "texts": "candidateProfileTexts"}
unexplained = 0
for key in picked:
    gs = kept[key]["data"]["parts"]
    for part, action in DOORS.items():
        got = run(CND.ACTIONS[action], msess(), {"candidate": key})
        if part == "texts":
            ok = got.get("status") == 200 and not got["data"]["counterparts"] or "deferred" in got
            check(f"{key[:8]} texts answer only without a company line to name, else defer", ok)
            continue
        if got.get("status") != 200:
            check(f"{key[:8]} {action} answers 200", False, str(got)[:160])
            continue
        d = [p for p in diff(norm(got["data"]), gs.get(part), part) if not explained(p, gs, key)]
        unexplained += len(d)
        check(f"{key[:8]} {action} equals Apps Script's kept answer", not d, "; ".join(d[:6]))
    res = run(CND.ACTIONS["candidateProfileResume"], msess(), {"candidate": key})
    check(f"{key[:8]} résumé answers from the analysis, or defers to read the file",
          res.get("status") == 200 or "deferred" in res, str(res)[:120])
    bad = run(CND.ACTIONS["candidateProfileDocFile"], msess(), {"candidate": key, "file_id": "x"})
    unknown = run(CND.ACTIONS["candidateProfileDocFile"], msess(), {"candidate": key, "file_id": "A" * 33})
    check(f"{key[:8]} doc file refuses a malformed id (400) and an unlisted one (404)",
          bad.get("status") == 400 and unknown.get("status") == 404)
    tr = run(CND.ACTIONS["candidateProfileTranscript"], msess(), {"candidate": key, "id": "no-such-call"})
    check(f"{key[:8]} transcript refuses a call the list does not name (404)", tr.get("status") == 404)
facts["unexplained differences"] = unexplained

# the relay's pack, every kept candidate
packs_equal = 0
for key, k in kept.items():
    got = run(CND.ACTIONS["candidatePack"], L.Session(L.Reads(db), service), {"candidate": key})
    if got.get("status") != 200:
        check(f"{key[:8]} candidatePack answers 200", False, str(got)[:160])
        continue
    data = norm(got["data"])
    d = []
    for part, mine in data["parts"].items():
        d += [p for p in diff(mine, k["data"]["parts"].get(part), part) if not explained(p, k, key)]
    left = [p for p, s in data["part_status"].items() if s["status"] != 200]
    packs_equal += 0 if d else 1
    if d or set(left) - {"texts"}:
        check(f"{key[:8]} candidatePack equals the kept pack (texts may be left)", False, "; ".join(d[:6]) + str(left))
check("every kept pack equals Python's, part by part", packs_equal == len(kept), f"{packs_equal}/{len(kept)}")

# the gates
not_master = next((sc.user_from_row(u) for u in reads0.users() if gsjs.str_(u.get("role")) == "manager"
                   and not gsjs.str_(u.get("mergedinto")) and not sc.is_master_email(u.get("email"))), None)
if not_master:
    r = run(CND.ACTIONS["candidateProfileRoster"], msess(not_master), {})
    check("an account App Control has not opened it to reads the 404", r.get("status") == 404, str(r)[:120])
    p = run(CND.ACTIONS["candidatePack"], msess(not_master), {"candidate": picked[0]})
    check("the pack is the relay's service's and the master's alone", p.get("status") == 404)
g = CND.gate(msess())
check("the writes' gate: the master opens the whole app", g["open"] and g["is_master"] and g["wide"])
if not_master:
    g2 = CND.gate(msess(not_master))
    check("the writes' gate: an unreleased account is closed and not the master", not g2["open"]
          and not g2["is_master"])
ctx = CND.candidate(msess(), picked[0])
check("the writes' candidate: the board row, its stage and checklist", ctx.get("key") == picked[0]
      and isinstance(ctx["row"].get("checklist"), list) and not ctx["archived"])
new_one = next((c["key"] for c in cands if c["stage"] == "new"), None)
if new_one:
    before = CND.stage_gate(L.Reads(db), CND.evidence(L.Reads(db), new_one))
    after = CND.gate_after(msess(), new_one, {CND.TALENT_RESUME_TAB: {"decision_status": "Advance"}})
    check("the writes' gate after a résumé Advance: New opens to Phone Screen on the board's own book",
          after["to"] == "phone-screen" and after["ok"] is True and (before["ok"] is False or before == after),
          f"before ok={before['ok']} after ok={after['ok']} to={after['to']}")
built = CND.actions_build(msess(), ctx)
check("the writes' actions (a session handed in): every step and every move", len(built["items"]) ==
      len(ctx["row"]["checklist"]) and len(built["stages"]) == len(CND.TALENT_STAGE_ORDER) + 1)
bad = run(CND.ACTIONS["candidateProfileOverview"], msess(), {"candidate": "CAN_nope"})
check("a malformed or unknown candidate is a 400", bad.get("status") == 400)

# a narrowed reader released in App Control (simulated): the basic card, its houses' candidates only
client_row = next((u for u in reads0.users() if gsjs.str_(u.get("role")).lower() == "client"
                   and gsjs.str_(u.get("clientkey")) and not gsjs.str_(u.get("mergedinto"))), None)
if client_row:
    reads = L.Reads(db)
    src = reads.scope_sources()
    rules = src.rules()
    released = {"rules": {**rules["rules"], CND.APP_ID: ["CLIENT"]}, "tenants": rules["tenants"]}
    reads.memo["app_rules"] = released
    user = sc.user_from_row(client_row)
    nr = run(CND.ACTIONS["candidateProfileRoster"], L.Session(reads, user), {})
    shape_ok = nr.get("status") == 200 and nr["data"].get("viewer") == "client" and all(
        set(c) == {"key", "name", "position", "stage", "stage_label", "avatar"} for c in nr["data"]["candidates"])
    check("a released client reads the narrowed roster (basic card only)", shape_ok or "deferred" in nr, str(nr)[:160])
    facts["narrowed roster"] = (f"{len(nr['data']['candidates'])} candidate(s), degraded={nr['data']['degraded']}"
                                if nr.get("status") == 200 else nr)
    acts = run(CND.ACTIONS["candidateProfileActions"], L.Session(reads, user), {"candidate": picked[0]})
    check("a narrowed reader is refused the whole-app reads (404)", acts.get("status") == 404 or "deferred" in acts)

# Python's own facts, laid over the copy until the copy holds them
key = picked[0]
reads = L.Reads(db)
evidence = CND.FACT_EVIDENCE + "candidateProfileNoteAdd " + str(uuid.uuid4())
jid = "JRN_" + uuid.uuid4().hex[:8].upper()
recs = CND.fact_edits(reads, CND.HIRING_JOURNEY_TAB, jid,
                      {"journey_id": jid, "candidate_id": key, "step": "note", "title": "Note", "channel": "note",
                       "ok": "yes", "detail": "laid only in this check", "at": "2099-01-01T00:00:00.000Z",
                       "by": "check"}, "check", evidence, "2099-01-01T00:00:00.000Z")
rows, n = [], 0
for rec in recs:
    for f, v in rec["cells"].items():
        n += 1
        rows.append({"sheet_id": rec["sheet_id"], "tab_name": rec["tab_name"], "match": rec["match"],
                     "keyed": rec["keyed"], "row_key": rec["row_key"], "appended": True, "field": f, "id": n,
                     "value": v, "born": n})
own = W.Own([], book=db.book, edits=rows, edits_at=time.time())
tok = hubdb.OWN.set(own)
try:
    act = CND.ACTIONS["candidateProfileActivity"](L.Session(reads, master), {"candidate": key})
finally:
    hubdb.OWN.reset(tok)
top = (act.get("data") or {}).get("items") or [{}]
check("a fact Python kept is laid over the copy: the note leads the activity", top[0].get("id") == "jrn_" + jid
      and top[0].get("kind") == "note", str(top[0])[:120])
held_reads = L.Reads(db)
CND._EVIDENCE_HELD.update(key=None)
orig = CND._evidence_held
CND._evidence_held = lambda r, ref, wanted: frozenset(wanted)
tok = hubdb.OWN.set(own)
try:
    act2 = CND.ACTIONS["candidateProfileActivity"](L.Session(held_reads, master), {"candidate": key})
finally:
    hubdb.OWN.reset(tok)
    CND._evidence_held = orig
check("once the copy holds that write, the copy's own row answers (laid once)",
      all(i.get("id") != "jrn_" + jid for i in act2["data"]["items"]))
check("an appended day reads as Apps Script reads the Date cell Sheets made of it",
      CND.iso_day(CND.entered_text("2026-09-11")) == "2026-09-10" and CND.entered_text("x 1") == "x 1"
      and CND.entered_text("2026-10-12T16:29:59.000Z") == "2026-10-12T16:29:59.000Z")
print(json.dumps({"checks": checks, "facts": facts}))
'''


def main() -> int:
    py_compile.compile(str(ROOT / "app" / "candidates.py"), doraise=True)
    print("ok   app/candidates.py compiles")
    got = subprocess.run(["docker", "exec", "-i", RELAY, "python3", "-c", KEPT], capture_output=True, timeout=120)
    if got.returncode != 0:
        print("FAIL the relay's kept packs could not be read")
        return 1
    kept = json.loads(got.stdout.decode() or "{}")
    app = {p.stem: p.read_text(encoding="utf-8") for p in (ROOT / "app").glob("*.py")}
    blob = {"app": app, "kept": kept}
    got = subprocess.run(["docker", "exec", "-i", "-e", "MALLOC_ARENA_MAX=2", DB_RUNNER, "python", "-c", DRIVER],
                         input=base64.b64encode(json.dumps(blob).encode()) + b"\n", capture_output=True, timeout=900)
    lines = got.stdout.decode().strip().splitlines()
    if got.returncode != 0 or not lines:
        print("FAIL the driver ran in asa-hub-db-sync")
        print(got.stderr.decode()[-2500:])
        return 1
    res = json.loads(lines[-1])
    failed = 0
    for name, ok, detail in res["checks"]:
        print(("ok   " if ok else "FAIL ") + name + ("" if ok else f"\n       {detail}"))
        failed += 0 if ok else 1
    for k, v in res["facts"].items():
        print(f"fact {k}: {v}")
    print(f"{len(res['checks']) - failed} ok, {failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
