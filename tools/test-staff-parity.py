#!/usr/bin/env python3
"""Staff on Python against Staff on Apps Script: the relay's kept Staff packs part by part, then staffPack, the doors
and the gates on real staff in the running asa-hub-app (app/staff_app.py). Nothing is written; no restart."""
from __future__ import annotations

import argparse
import base64
import importlib.util
import json
import re
import shutil
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "app"
MODULES = ("gsjs", "hubdb", "scope", "drive", "locations", "clients", "client_meds", "client_sources", "client_app",
           "writes", "client_writes", "staff", "staff_comms", "staff_perf", "staff_app", "staff_writes", "ssa",
           "ssa_writes", "family", "family_writes", "main")
# staffClientPack's copies (a client's own view) and staffPack's (one staff member whole)
CLIENT_PACK_APP = "staff-profiles"
TEAM_PACK_APP = "staff-team"
PACK_PARTS = ("overview", "edit_profile", "notes", "actions", "activity", "preferences", "shifts", "compliance",
              "documents", "employment", "edit_employment")
# the pack part each door answers, as a whole viewer reads it (the master's own answer adds `edit`)
DOOR_OF_PART = {"overview": "staffProfileOverview", "notes": "staffProfileNotes", "actions": "staffProfileActions",
                "activity": "staffProfileActivity", "preferences": "staffProfilePreferences",
                "shifts": "staffProfileShifts", "compliance": "staffProfileCompliance",
                "documents": "staffProfileDocuments", "employment": "staffProfileEmployment"}
READS = ("staffProfileRoster", "staffProfileOverview", "staffProfileActions", "staffProfileActivity",
         "staffProfilePreferences", "staffProfileNotes", "staffProfileShifts", "staffProfileDocuments",
         "staffProfileEmployment", "staffProfileCompliance", "staffProfileTexts", "staffProfileTranscripts",
         "staffProfileHr", "staffProfilePerformance", "employeeLoanList")

_spec = importlib.util.spec_from_file_location("clients_parity", ROOT / "tools" / "test-clients-parity.py")
P = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(P)
results = P.results
check = P.check

DRIVER = r'''
import base64, json, sys, time, types
blob = json.loads(base64.b64decode(sys.stdin.readline()).decode())
for name in blob["order"]:
    m = types.ModuleType(name); m.__file__ = name + ".py"; sys.modules[name] = m
for name in blob["order"]:
    exec(compile(blob["src"][name], name + ".py", "exec"), sys.modules[name].__dict__)
import hubdb, locations as L, scope as sc, drive as dr, staff as SP, staff_app as SA, main
job = blob["job"]
db = hubdb.HubDb()
drv = dr.Drive()
service = {"is_service": True, "role": "admin", "id": "", "email": ""}
why = {}
def wrap(name, fn):
    def run(*a):
        try:
            return fn(*a)
        except (sc.Defer, hubdb.Unreadable) as e:
            why[name] = type(e).__name__ + ": " + str(e)[:160]
            raise
    return run
SA.PACK_DOORS = {n: wrap(n, f) for n, f in SA.PACK_DOORS.items()}
def sess(user):
    return L.Session(L.Reads(db, drv), user)
def timed(fn):
    t = time.monotonic()
    try:
        env = fn()
    except (sc.Defer, hubdb.Unreadable) as e:
        env = {"deferred": type(e).__name__ + ": " + str(e)[:200]}
    except Exception as e:
        env = {"crashed": type(e).__name__ + ": " + str(e)[:200]}
    return env, round(time.monotonic() - t, 2)
out = {"drive": drv.available, "client_packs": {}, "team_packs": {}, "doors": {}, "gates": {}, "shifts": {}}
for key in job["clients"]:
    why.clear()
    env, s = timed(lambda: SA.staff_client_pack(sess(service), {"client": key}))
    out["client_packs"][key] = {"env": env, "s": s}
users = L.Reads(db, drv).users()
boss = next((u for u in users if not sc.gsjs.str_(u.get("mergedinto")) and sc.is_master_email(u.get("email"))
             and sc.gsjs.str_(u.get("role")) == "admin"), None)
master = sc.user_from_row(boss) if boss else None
roster, _s = timed(lambda: SA.ACTIONS["staffProfileRoster"](sess(master), {}))
keys = list(job["staff"])
for r in ((roster.get("data") or {}).get("staff") or []):
    if len(keys) >= job["n"]:
        break
    if r.get("status") == "active" and not r.get("ambiguous") and r["key"] not in keys:
        keys.append(r["key"])
out["roster"] = {"status": roster.get("status"), "view": (roster.get("data") or {}).get("view"),
                 "n": len((roster.get("data") or {}).get("staff") or []), "s": _s}
for key in keys:
    why.clear()
    env, s = timed(lambda: SA.staff_pack(sess(service), {"staff": key}))
    out["team_packs"][key] = {"env": env, "why": dict(why), "s": s}
    doors = {}
    for action in job["reads"]:
        if action == "staffProfileRoster":
            continue
        got, s = timed(lambda: SA.ACTIONS[action](sess(master), {"staff": key}))
        doors[action] = {"env": got, "s": s}
    out["doors"][key] = doors
    reads = L.Reads(db, drv)
    ctx = SP.person(reads, key)
    if not ctx.get("refused"):
        a, _ = timed(lambda: {"status": 200, "data": SP.shift_facts(reads, ctx)["shifts"]})
        b, _ = timed(lambda: SA.PACK_DOORS["shifts"](reads, ctx))
        out["shifts"][key] = {"core": a, "comms": b}
g = out["gates"]
one = keys[0] if keys else "nobodyzz"
g["pack_refused_to_a_person"] = SA.ACTIONS["staffPack"](sess(master), {"staff": one})
g["client_pack_refused_to_a_person"] = SA.ACTIONS["staffClientPack"](sess(master), {"client": "x"})
g["pack_unknown_staff"] = SA.staff_pack(sess(service), {"staff": "nobodyzzqq"})
g["pack_malformed_staff"] = SA.staff_pack(sess(service), {"staff": "A B"})
g["client_pack_malformed"] = SA.staff_client_pack(sess(service), {"client": "a b"})
g["service_roster"] = SA.ACTIONS["staffProfileRoster"](sess(service), {})
for action in ("staffProfileHr", "staffProfilePerformance"):
    g["audited_" + action], _ = timed(lambda: SA.ACTIONS[action](sess(master), {"staff": one}))
    g["audited_unknown_" + action] = SA.ACTIONS[action](sess(master), {"staff": "nobodyzzqq"})
said = {"uid": master["id"], "role": "admin", "is_master": True} if master else {}
# the Staff store's tables are made when the service starts, never by a check
main.STAFF_STORE = main.staff_writes.Store(dsn="")
main.SSA_STORE, main.FAMILY_STORE = main.ssa_writes.Store(dsn=""), main.family_writes.Store(dsn="")
res = main._run(main.APPS["staff"], "staffProfileRoster", said, {})
body = json.loads(res.body)
g["lane_roster"] = {"code": res.status_code, "as_of": "x-hub-as-of" in res.headers, "status": body.get("status"),
                    "view": (body.get("data") or {}).get("view")}
res = main._run(main.APPS["staff"], "staffProfileHr", said, {"staff": one})
g["lane_hr"] = {"code": res.status_code}
g["lane_registered"] = {"staff": main.APPS.get("staff") is SA, "writes": "staff" in main.WRITES}
import resource
out["peak_mb"] = round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024)
print(json.dumps(out, default=str))
'''


def run_python(runner: str, job: dict) -> dict:
    blob = {"order": list(MODULES), "src": {n: (APP / f"{n}.py").read_text(encoding="utf-8") for n in MODULES},
            "job": job}
    payload = base64.b64encode(json.dumps(blob).encode()) + b"\n"
    got = P.docker("exec", "-i", runner, "python", "-c", DRIVER, data=payload, timeout=3600)
    if got.returncode != 0:
        raise RuntimeError(f"the Python side did not run in {runner}: {got.stderr.decode()[-800:]}")
    return json.loads(got.stdout.decode().strip().splitlines()[-1])


def kept(app: str) -> dict[str, dict]:
    """The relay's kept packs of one app (Apps Script's answers), keyed by their key."""
    out: dict[str, dict] = {}
    listing = P.docker("exec", P.RELAY, "sh", "-c", f"ls {P.PACK_DIR}", timeout=60)
    for name in listing.stdout.decode().split():
        if not re.fullmatch(r"[0-9a-f]{64}\.json", name):
            continue
        got = P.docker("exec", P.RELAY, "cat", f"{P.PACK_DIR}/{name}", timeout=60)
        try:
            body = json.loads(got.stdout)
        except ValueError:
            continue
        if body.get("app") == app:
            out[body["key"]] = body
    return out


def compare(label: str, kept_packs: dict[str, dict], built: dict[str, dict], args: argparse.Namespace,
            started: float) -> None:
    tally = {"parts compared": 0, "parts equal": 0, "parts differing": 0, "parts left to Apps Script": 0,
             "parts Apps Script did not answer": 0}
    reasons: dict[str, int] = {}
    unexplained = 0
    for n, key in enumerate(sorted(kept_packs), start=1):
        body = kept_packs[key]
        gs = body["data"]
        read_at = float(body.get("read_at") or 0)
        when = {"read_day": datetime.fromtimestamp(read_at, P.NY).strftime("%Y-%m-%d"),
                "today": datetime.fromtimestamp(started, P.NY).strftime("%Y-%m-%d")}
        mine = built.get(key) or {}
        env = mine.get("env") or {}
        tag = f"{label}{n:02d}"
        print(f"  {tag} (Apps Script read it {(time.time() - read_at) / 60:.0f} min ago; Python built it in "
              f"{mine.get('s')}s)")
        if env.get("status") != 200:
            check(f"{tag}: Python builds the pack", False, said_of(env))
            continue
        data = env["data"]
        if "week" in gs:
            check(f"{tag}: the same week", data.get("week") == gs.get("week"), (data.get("week"), gs.get("week")))
        check(f"{tag}: the same subject and every part", set(data["part_status"]) == set(gs["part_status"]),
              sorted(set(gs["part_status"]) ^ set(data["part_status"]))[:6])
        for part in gs["part_status"]:
            short = "roster" if part == "roster" else re.sub(r"^profile_.*", "profile", part)
            st, ours = gs["part_status"].get(part) or {}, data["part_status"].get(part) or {}
            if st.get("status") != 200:
                tally["parts Apps Script did not answer"] += 1
                check(f"{tag} {short}: the same refusal", ours.get("status") == st.get("status"), (ours, st))
                continue
            if ours.get("status") != 200:
                why = re.sub(r"\(\d+\)|\b\d+\b", "#", (mine.get("why") or {}).get(part) or ours.get("message") or "?")
                reasons[f"{short}: {why}"] = reasons.get(f"{short}: {why}", 0) + 1
                tally["parts left to Apps Script"] += 1
                continue
            out: list = []
            P.diff(data["parts"].get(part), gs["parts"].get(part), short, out, when)
            tally["parts compared"] += 1
            real = P.report(short, out, args.show, args.values) if out else 0
            unexplained += real
            tally["parts differing" if real else "parts equal"] += 1
    if reasons:
        print("  why a part was left to Apps Script:")
        for why, n in sorted(reasons.items(), key=lambda x: (-x[1], x[0])):
            print(f"    {n:3d}x {why}")
    print("  in all: " + ", ".join(f"{k} {n}" for k, n in tally.items()))
    check(f"{label}: no difference beyond a timestamp's milliseconds and the read's own clock", unexplained == 0,
          f"{unexplained} difference(s) above")


def said_of(env: dict) -> str:
    return str(env.get("deferred") or env.get("crashed") or env.get("message") or "")


def status_of(env: dict) -> str:
    if "deferred" in env:
        return "defer"
    if "crashed" in env:
        return "CRASH"
    return str(env.get("status"))


def functional(py: dict) -> None:
    print("\nSTAFFPACK — every part, against the doors that answer it alone (as the master)")
    tally: dict[str, dict[str, int]] = {}
    left: dict[str, int] = {}
    seconds = []
    for n, (key, got) in enumerate(py["team_packs"].items(), start=1):
        env = got["env"]
        tag = f"s{n:02d}"
        seconds.append(got["s"])
        if env.get("status") != 200:
            print(f"  {tag}: staffPack {status_of(env)} {said_of(env)} ({got['s']}s)")
            check(f"{tag}: staffPack never crashes", "crashed" not in env, env.get("crashed"))
            continue
        data = env["data"]
        check(f"{tag}: the pack names the person and every part", data.get("staff") == key
              and tuple(data["part_status"]) == PACK_PARTS, list(data["part_status"]))
        check(f"{tag}: the pack is plain JSON", json.loads(json.dumps(data)) == data)
        doors = py["doors"].get(key) or {}
        for part in PACK_PARTS:
            row = tally.setdefault(part, {"200": 0, "left": 0, "other": 0})
            st = data["part_status"][part]
            if st.get("status") == 200:
                row["200"] += 1
            elif st.get("message", "").startswith("This part was not gathered"):
                row["left"] += 1
                w = re.sub(r"\(\d+\)|\b\d+\b", "#", (got.get("why") or {}).get(part) or "?")
                left[f"{part}: {w}"] = left.get(f"{part}: {w}", 0) + 1
            else:
                row["other"] += 1
                print(f"    {tag} {part}: {st}")
            door = DOOR_OF_PART.get(part)
            if not door or door not in doors or st.get("status") != 200:
                continue
            alone = doors[door]["env"]
            if alone.get("status") != 200:
                check(f"{tag} {part}: the door answers what the pack answers", False, status_of(alone))
                continue
            mine = {k: v for k, v in (alone.get("data") or {}).items() if k != "edit"} \
                if isinstance(alone.get("data"), dict) else alone.get("data")
            out: list = []
            P.diff(data["parts"][part], mine, part, out, {"read_day": "", "today": ""})
            real = [d for d in out if d[1] not in P.EXPLAINED]
            check(f"{tag} {part}: the pack part is the door's answer", not real, real[:2])
        print(f"  {tag}: " + ", ".join(f"{p}={data['part_status'][p].get('status')}" for p in PACK_PARTS)
              + f" ({got['s']}s)")
    print("\n  per part (answered / left to Apps Script / other):")
    for part in PACK_PARTS:
        row = tally.get(part) or {"200": 0, "left": 0, "other": 0}
        print(f"    {part:16s} {row['200']:3d} / {row['left']:3d} / {row['other']:3d}")
    print("  why a part was left to Apps Script:")
    for why, n in sorted(left.items(), key=lambda x: (-x[1], x[0])):
        print(f"    {n:3d}x {why}")
    if seconds:
        median = sorted(seconds)[len(seconds) // 2]
        print(f"  staffPack took {min(seconds):.1f}s to {max(seconds):.1f}s (median {median:.1f}s)")
        check("every staffPack inside the relay's 60 s", max(seconds) < 60, max(seconds))
    print("\nTHE DOORS — each read as the master (answered / deferred / refused), slowest")
    per: dict[str, dict[str, Any]] = {}
    for key, doors in py["doors"].items():
        for action, got in doors.items():
            row = per.setdefault(action, {"200": 0, "defer": 0, "other": 0, "s": 0.0, "why": {}, "crashed": []})
            st = status_of(got["env"])
            row["200" if st == "200" else "defer" if st == "defer" else "other"] += 1
            row["s"] = max(row["s"], got["s"])
            if st == "defer":
                w = re.sub(r"\(\d+\)|\b\d+\b", "#", got["env"]["deferred"])[:110]
                row["why"][w] = row["why"].get(w, 0) + 1
            if st == "CRASH":
                row["crashed"].append(got["env"].get("crashed"))
    for action, row in per.items():
        print(f"  {action:26s} {row['200']:3d} / {row['defer']:3d} / {row['other']:3d}  {row['s']:.1f}s")
        for w, n in sorted(row["why"].items(), key=lambda x: -x[1])[:3]:
            print(f"      {n}x {w}")
    for action, row in per.items():
        check(f"{action}: never crashes, and answers inside the relay's 10 s", not row["crashed"] and row["s"] < 10,
              row["crashed"][:2] or row["s"])
    print("\nSHIFTS — the shifts part against the facts the overview and the activity read (one spShiftsBuild_)")
    same = differ = 0
    for key, pair in py["shifts"].items():
        a, b = pair["core"], pair["comms"]
        if a.get("status") != 200 or b.get("status") != 200:
            continue
        out: list = []
        P.diff(b["data"], a["data"], "shifts", out, {"read_day": "", "today": ""})
        real = [d for d in out if d[1] not in P.EXPLAINED]
        if real:
            differ += 1
            P.report("shifts", real, 4, False)
        else:
            same += 1
    print(f"  equal {same}, differing {differ}")
    check("the shifts part is the facts the other sections read", differ == 0, differ)


def gates(py: dict) -> None:
    print("\nTHE GATES AND THE LANE")
    g = py["gates"]
    unknown = {"status": 404, "message": "Unknown action."}
    check("a person (even the master) is refused staffPack as Unknown action", g["pack_refused_to_a_person"] == unknown,
          g["pack_refused_to_a_person"])
    check("a person is refused staffClientPack as Unknown action", g["client_pack_refused_to_a_person"] == unknown,
          g["client_pack_refused_to_a_person"])
    check("an unknown staff key is a 404 in the pack", (g["pack_unknown_staff"] or {}).get("status") == 404,
          g["pack_unknown_staff"])
    check("a malformed staff key is a 400 in the pack", (g["pack_malformed_staff"] or {}).get("status") == 400,
          g["pack_malformed_staff"])
    check("a malformed client key is a 400 in the client pack", (g["client_pack_malformed"] or {}).get("status") == 400,
          g["client_pack_malformed"])
    check("the service identity is refused the roster", g["service_roster"] == unknown, g["service_roster"])
    for action in ("staffProfileHr", "staffProfilePerformance"):
        check(f"{action}: an answer is left to Apps Script (it is audited)", "deferred" in g["audited_" + action],
              g["audited_" + action])
        check(f"{action}: an unknown key is refused here", (g["audited_unknown_" + action] or {}).get("status") == 404,
              g["audited_unknown_" + action])
    check("main.py serves the Staff app and its write door", g["lane_registered"] == {"staff": True, "writes": True},
          g["lane_registered"])
    check("/v1/staff/staffProfileRoster answers the master in full", g["lane_roster"].get("code") == 200
          and g["lane_roster"].get("status") == 200 and g["lane_roster"].get("view") == "full"
          and g["lane_roster"].get("as_of"), g["lane_roster"])
    check("/v1/staff/staffProfileHr defers (503) to Apps Script", g["lane_hr"].get("code") == 503, g["lane_hr"])
    roster = py.get("roster") or {}
    check("the master reads the whole roster", roster.get("status") == 200 and roster.get("view") == "full",
          roster)


def main_() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--runner", default="asa-hub-app", help="the container that runs the Python side")
    ap.add_argument("--staff", type=int, default=8, help="how many active staff staffPack and the doors are run for")
    ap.add_argument("--clients", type=int, default=-1, help="compare only the first N kept client packs")
    ap.add_argument("--show", type=int, default=6, help="difference shapes shown per part")
    ap.add_argument("--values", action="store_true", help="print the differing values (they hold staff records)")
    args = ap.parse_args()
    if not shutil.which("docker") or not P.running(args.runner):
        print("test-staff-parity: skipped — no running asa-hub-app to read asa-hub-db")
        return 0
    client_packs, team_packs = kept(CLIENT_PACK_APP), kept(TEAM_PACK_APP)
    print(f"kept packs: {len(client_packs)} staffClientPack, {len(team_packs)} staffPack")
    if args.clients >= 0:
        client_packs = {k: client_packs[k] for k in sorted(client_packs)[:args.clients]}
    job = {"clients": sorted(client_packs), "staff": sorted(team_packs), "n": max(args.staff, len(team_packs)),
           "reads": list(READS)}
    started = time.time()
    py = run_python(args.runner, job)
    print(f"Python ran in {args.runner} in {time.time() - started:.1f}s (peak {py.get('peak_mb')} MB); Drive "
          f"credentials {'present' if py['drive'] else 'absent'}")
    print("\nPARITY — Python's staffClientPack against the relay's kept copies (Apps Script's)")
    compare("c", client_packs, py["client_packs"], args, started)
    print("\nPARITY — Python's staffPack against the relay's kept copies (Apps Script's)")
    if team_packs:
        compare("t", team_packs, py["team_packs"], args, started)
    else:
        print("  the relay keeps no staffPack copy yet: staffPack is checked against the doors below")
    functional(py)
    gates(py)
    print(f"\ntest-staff-parity: {results['ok']} ok, {len(results['failed'])} failed")
    return 1 if results["failed"] else 0


if __name__ == "__main__":
    sys.exit(main_())
