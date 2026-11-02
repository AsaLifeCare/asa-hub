#!/usr/bin/env python3
"""Client Candidates' reads (app/client_candidates.py) on real referrals in asa-hub-db-sync, against the relay's kept
clientCandidatePack copies (Apps Script's answers): the roster, every door as the master, the pack as the relay's
service, the gates, the writes' contract, and Python's own edits laid over the copy. Nothing is written: the laid
edits live in this process only. Prints shapes, counts and paths, never a referral's values."""
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
    if isinstance(d, dict) and d.get("app") == "client-candidates":
        out[d["key"]] = {"data": d["data"], "filled_at": d.get("filled_at")}
print(json.dumps(out))
'''

DRIVER = r'''
import base64, importlib.abc, importlib.util, json, os, re, sys, time, types
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

import gsjs, hubdb, locations as L, scope as sc, writes as W, clients as CP
import client_candidates as CC
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


def explained(path):
    """A difference the copy cannot carry: a call's milliseconds."""
    return bool(re.fullmatch(r"transcripts\.calls\[\d+\]\.at", path))


def run(fn, sess, payload):
    try:
        return fn(sess, payload)
    except sc.Defer as e:
        return {"deferred": str(e)}


# no Drive here: the plans folder is read as listing no plan (the kept packs say which referral a plan names)
def _docs(v):
    return (v["data"]["parts"].get("documents") or {}).get("docs") or []


plan_named = [k for k, v in kept.items() if any(d.get("id") == "isp" or (d.get("id") == "assessment"
              and d.get("status") == "on_file") for d in _docs(v))]
facts["kept referrals a plan names"] = len(plan_named)
CP.isp_files = lambda reads: []

db = hubdb.HubDb()
reads0 = L.Reads(db)
row = next(u for u in reads0.users() if gsjs.str_(u.get("email")).lower() == sc.MASTER_ACCOUNT
           and not gsjs.str_(u.get("mergedinto")))
master = sc.user_from_row(row)
service = {"is_service": True, "role": "admin", "id": "", "email": ""}
check("the master's users row is the real master", sc.is_real_master(master))


def msess(user=None, reads=None):
    return L.Session(reads or L.Reads(db), user or master)


t0 = time.time()
roster = CC.ACTIONS["clientCandidateRoster"](msess(), {})
cands = (roster.get("data") or {}).get("candidates") or []
facts["roster"] = f"{roster.get('status')} · {len(cands)} referrals · {time.time() - t0:.2f}s"
check("roster answers 200 with the six intake stages first", roster.get("status") == 200
      and [s["id"] for s in roster["data"]["stages"]][:6] == [s["id"] for s in CC.STAGES])
check("roster keys hold the kept packs' referrals", {c["key"] for c in cands} >= set(kept) and bool(kept),
      f"roster {len(cands)}, kept {len(kept)}")
facts["roster stages"] = ", ".join(f"{s['id']}={s['count']}" for s in roster["data"]["stages"])

# three referrals: one with a phone, one the team was alerted about, one neither
by_kind = {}
for c in cands:
    if c["key"] not in kept or c["key"] in plan_named:
        continue
    kind = "phone" if c["phone"] else ("alerted" if c["alerted"] else "plain")
    by_kind.setdefault(kind, c["key"])
picked = list(by_kind.values())[:3]
facts["picked"] = ", ".join(by_kind)
DOORS = {"overview": "clientCandidateOverview", "actions": "clientCandidateActions", "intake": "clientCandidateIntake",
         "documents": "clientCandidateDocuments", "activity": "clientCandidateActivity",
         "transcripts": "clientCandidateTranscripts", "texts": "clientCandidateTexts"}
unexplained = 0
for key in picked:
    gs = kept[key]["data"]["parts"]
    for part, action in DOORS.items():
        got = run(CC.ACTIONS[action], msess(), {"candidate": key})
        if "deferred" in got:
            ok = part == "texts" and bool((gs.get("texts") or {}).get("counterparts"))
            check(f"{key[:7]} {action} defers only where Apps Script names a company line", ok, got["deferred"])
            continue
        if got.get("status") != 200:
            check(f"{key[:7]} {action} answers 200", False, str(got)[:160])
            continue
        d = [p for p in diff(norm(got["data"]), gs.get(part), part) if not explained(p)]
        unexplained += len(d)
        check(f"{key[:7]} {action} equals Apps Script's kept answer", not d, "; ".join(d[:6]))
    bad = run(CC.ACTIONS["clientCandidateDocFile"], msess(), {"candidate": key, "file_id": "x"})
    unknown = run(CC.ACTIONS["clientCandidateDocFile"], msess(), {"candidate": key, "file_id": "A" * 33})
    rendered = run(CC.ACTIONS["clientCandidateDocFile"], msess(), {"candidate": key, "doc": "referral"})
    check(f"{key[:7]} doc file: a malformed id 400, an unlisted one 404, a rendered paper to Apps Script",
          bad.get("status") == 400 and unknown.get("status") == 404 and "deferred" in rendered)
    tr = run(CC.ACTIONS["clientCandidateTranscript"], msess(), {"candidate": key, "id": "no-such-call"})
    check(f"{key[:7]} transcript refuses a call the list does not name (404)", tr.get("status") == 404)
facts["unexplained differences"] = unexplained

# the referrals no kept pack covers: a phone, an e-mail or a team alert (texts, calls, the outbox, the opt-out list)
reached = [c["key"] for c in cands if c["phone"] or c["email"] or c["alerted"]][:8]
shapes = {"texts deferred": 0, "texts answered": 0, "alerts": 0, "calls": 0, "alert lines": 0, "opened": 0}
for key in reached:
    for part, action in DOORS.items():
        got = run(CC.ACTIONS[action], msess(), {"candidate": key})
        if "deferred" in got:
            ok = part == "texts" and "company line" in got["deferred"]
            shapes["texts deferred"] += ok
            check(f"{key[:7]} {action} answers here or defers only to name a company line", ok, got["deferred"])
            continue
        check(f"{key[:7]} {action} answers 200", got.get("status") == 200, f"status {got.get('status')}")
        d = got.get("data") or {}
        if part == "texts":
            shapes["texts answered"] += 1
            shapes["alerts"] += len(d.get("alerts") or [])
        if part == "transcripts":
            shapes["calls"] += len(d.get("calls") or [])
        if part == "activity":
            shapes["alert lines"] += sum(1 for i in d.get("items") or [] if i.get("kind") == "alert")
        if part == "overview":
            shapes["opened"] += 1 if d.get("opened") else 0
facts["referrals with a phone, an e-mail or an alert"] = f"{len(reached)} · " + ", ".join(
    f"{k} {v}" for k, v in shapes.items())

# the relay's pack, every kept referral
packs_equal, slow = 0, 0.0
for key, k in kept.items():
    if key in plan_named:
        continue
    t1 = time.time()
    got = run(CC.ACTIONS["clientCandidatePack"], L.Session(L.Reads(db), service), {"candidate": key})
    slow = max(slow, time.time() - t1)
    if got.get("status") != 200:
        check(f"{key[:7]} clientCandidatePack answers 200", False, str(got)[:160])
        continue
    data = norm(got["data"])
    d = []
    for part, mine in data["parts"].items():
        d += [p for p in diff(mine, k["data"]["parts"].get(part), part) if not explained(p)]
    left = [p for p, s in data["part_status"].items() if s["status"] != 200]
    packs_equal += 0 if d else 1
    if d or set(left) - {"texts"}:
        check(f"{key[:7]} clientCandidatePack equals the kept pack (texts may be left)", False,
              "; ".join(d[:6]) + str(left))
n_packs = len([k for k in kept if k not in plan_named])
check("every kept pack equals Python's, part by part", packs_equal == n_packs, f"{packs_equal}/{n_packs}")
facts["slowest pack"] = f"{slow:.2f}s"

# the gates
not_master = next((sc.user_from_row(u) for u in reads0.users() if gsjs.str_(u.get("role")) == "manager"
                   and not gsjs.str_(u.get("mergedinto")) and not sc.is_master_email(u.get("email"))), None)
facts["App Control's release of the app"] = (reads0.scope_sources().rules()["rules"].get(CC.APP_ID) or "none")
if not_master:
    g2 = CC.gate(msess(not_master))
    r = run(CC.ACTIONS["clientCandidateRoster"], msess(not_master), {})
    check("a manager reads the roster exactly when App Control opens the whole app to that badge",
          r.get("status") == (200 if g2["open"] else 404) and not g2["is_master"], f"status {r.get('status')}")
    p = run(CC.ACTIONS["clientCandidatePack"], msess(not_master), {"candidate": picked[0]})
    check("the pack is the relay's service's and the master's alone", p.get("status") == 404)
    reads_c = L.Reads(db)
    rules = reads_c.scope_sources().rules()
    reads_c.memo["app_rules"] = {"rules": {**rules["rules"], CC.APP_ID: []}, "tenants": rules["tenants"]}
    g3 = CC.gate(msess(not_master, reads_c))
    r3 = run(CC.ACTIONS["clientCandidateRoster"], msess(not_master, reads_c), {})
    check("with the app released to nobody, a manager is closed: 404 and the writes' gate shut",
          r3.get("status") == 404 and not g3["open"], f"status {r3.get('status')}")
g = CC.gate(msess())
check("the writes' gate: the master opens the whole app", g["open"] and g["is_master"] and g["wide"])
bad = run(CC.ACTIONS["clientCandidateOverview"], msess(), {"candidate": "no such/key"})
none = run(CC.ACTIONS["clientCandidateOverview"], msess(), {"candidate": "LEAD_NOPE_000"})
check("a malformed or unknown referral is a 400", bad.get("status") == 400 and none.get("status") == 400)

# the writes' contract
ctx = CC.candidate(msess(), picked[0])
check("the writes' candidate: the row, its stage, and the book and tab it lives in", ctx.get("key") == picked[0]
      and isinstance(ctx["row"], dict) and ctx["tab"] == CC.CC_LEADS and bool(ctx["book"]))
built = CC.actions_build(msess(), ctx)
check("the writes' actions (a session handed in): three phases, six stages, the note door",
      len(built["items"]) == 3 and len(built["stages"]) == 6 and built["note"]["kind"] == "note")
nxt = built["next"]
plan = CC.write_plan(ctx, "complete", {"item": nxt["id"]}) if nxt else {}
check("write_plan: completing the next phase moves the stage to the phase's done stage",
      bool(nxt) and plan.get("fields", {}).get("stage") == nxt["complete"]["fields"]["stage"], str(plan)[:160])
here = CC.stage_meta(CC.stage_of(ctx["stage"]))["label"]
check("write_plan: a stage it already stands at is 409, an unknown one 400",
      CC.write_plan(ctx, "stage", {"stage": here})["refused"]["status"] == 409
      and CC.write_plan(ctx, "stage", {"stage": "nowhere"})["refused"]["status"] == 400)

# Python's own edits laid over the copy: the stage moved and a press logged, as app.edits keeps them
key = picked[0]
entry = {"at": "2099-01-01T00:00:00.000Z", "by": "check", "kind": "step",
         "text": "Completed action: " + CC.PHASES[0]["label"]}
cells = {"stage": "Discovery", CC.LOG_FIELD: json.dumps(CC.log_with(ctx["row"].get(CC.LOG_FIELD), entry))}
rows, n = [], 0
for f, v in cells.items():
    n += 1
    rows.append({"sheet_id": ctx["book"], "tab_name": ctx["tab"], "match": "id", "keyed": "header", "row_key": key,
                 "appended": False, "field": f, "id": n, "value": v, "born": n})
own = W.Own([], book=db.book, edits=rows, edits_at=time.time())
tok = hubdb.OWN.set(own)
try:
    r2 = L.Reads(db)
    ro = CC.ACTIONS["clientCandidateRoster"](msess(reads=r2), {})
    it = CC.ACTIONS["clientCandidateIntake"](msess(reads=r2), {"candidate": key})
    ac = CC.ACTIONS["clientCandidateActivity"](msess(reads=r2), {"candidate": key})
finally:
    hubdb.OWN.reset(tok)
other = next(c["key"] for c in cands if c["key"] != key)
moved = {"sheet_id": ctx["book"], "tab_name": ctx["tab"], "match": "id", "keyed": "header", "row_key": other,
         "appended": False, "field": "stage", "id": 1, "value": "Ready for Intake", "born": 1}
own2 = W.Own([], book=db.book, edits=[moved], edits_at=time.time())
tok = hubdb.OWN.set(own2)
try:
    r3 = L.Reads(db)
    ov = CC.ACTIONS["clientCandidateOverview"](msess(reads=r3), {"candidate": other})
    dc = CC.ACTIONS["clientCandidateDocuments"](msess(reads=r3), {"candidate": other})
    act3 = CC.ACTIONS["clientCandidateActions"](msess(reads=r3), {"candidate": other})
finally:
    hubdb.OWN.reset(tok)
check("a referral moved to Ready for Intake: the client it became is looked up, the plan listed as pending, closed",
      ov.get("status") == 200 and any("client record" in w for w in ov["data"]["why"])
      and [d["id"] for d in dc["data"]["docs"]][-1] == "isp" and act3["data"]["closed"] is True
      and all(i["status"] == "done" for i in act3["data"]["items"]), f"status {ov.get('status')}")
mine = next((c for c in ro["data"]["candidates"] if c["key"] == key), {})
check("a kept edit is laid over the copy: the roster shows the stage Python wrote",
      mine.get("intake_stage") == "discovery", mine.get("stage"))
check("the kept log dates the phase it completed, and leads the activity",
      it["data"]["plan"][0]["date"] == entry["at"] and ac["data"]["items"][0]["id"].startswith("log_"))
print(json.dumps({"checks": checks, "facts": facts}))
'''


def main() -> int:
    py_compile.compile(str(ROOT / "app" / "client_candidates.py"), doraise=True)
    print("ok   app/client_candidates.py compiles")
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
