#!/usr/bin/env python3
"""Clients on Python against Clients on Apps Script: each client of the relay's kept clientPack copies, part by part."""
from __future__ import annotations

import argparse
import base64
import json
import re
import shutil
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "app"
MODULES = ("gsjs", "hubdb", "scope", "drive", "locations", "clients", "client_meds", "client_sources", "client_app")
PACK_APP = "client-profiles"
PACK_DIR = "/srv/app-packs"
RELAY = "asa-hub-snapshot"
RUNNERS = ("asa-hub-app", "asa-hub-db-sync")
ISO = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$")
DAY = re.compile(r"^\d{4}-\d{2}-\d{2}$")
NY = ZoneInfo("America/New_York")
# the pack's own clock, never its data
META = ("built_at", "read_age_s", "age_s")
# precision: the copy keeps a date-time cell to the second; clock: the read's own day or instant; newer: rows since
EXPLAINED = ("precision", "clock", "newer")

results = {"ok": 0, "failed": []}


def check(name: str, ok: bool, detail: Any = None) -> None:
    if ok:
        results["ok"] += 1
        print(f"  ok   {name}")
    else:
        results["failed"].append(name)
        print(f"  FAIL {name}")
        if detail is not None:
            print(f"       {str(detail)[:400]}")


def docker(*args: str, data: bytes | None = None, timeout: int = 600) -> subprocess.CompletedProcess:
    return subprocess.run(["docker", *args], input=data, capture_output=True, timeout=timeout)


def running(name: str) -> bool:
    got = docker("ps", "--filter", f"name=^{name}$", "--format", "{{.Names}}", timeout=30)
    return got.returncode == 0 and name in got.stdout.decode().split()


def kept_packs(fixtures: Path | None, save: Path | None) -> dict[str, dict]:
    """The relay's kept Clients packs — Apps Script's own answers — from its folder, or from a saved copy of it."""
    out: dict[str, dict] = {}
    if fixtures:
        for f in sorted(fixtures.glob("*.json")):
            body = json.loads(f.read_text(encoding="utf-8"))
            if body.get("app") == PACK_APP:
                out[body["key"]] = body
        return out
    listing = docker("exec", RELAY, "sh", "-c", f"ls {PACK_DIR}", timeout=60)
    if listing.returncode != 0:
        raise RuntimeError(f"the relay's kept packs could not be listed ({listing.stderr.decode()[:200]})")
    for name in listing.stdout.decode().split():
        if not re.fullmatch(r"[0-9a-f]{64}\.json", name):
            continue
        got = docker("exec", RELAY, "cat", f"{PACK_DIR}/{name}", timeout=60)
        try:
            body = json.loads(got.stdout)
        except ValueError:
            continue
        if body.get("app") != PACK_APP:
            continue
        out[body["key"]] = body
        if save:
            save.mkdir(parents=True, exist_ok=True)
            (save / name).write_bytes(got.stdout)
            (save / name).chmod(0o600)
    return out


DRIVER = r'''
import base64, json, sys, time, types
blob = json.loads(base64.b64decode(sys.stdin.readline()).decode())
for name in blob["order"]:
    m = types.ModuleType(name); m.__file__ = name + ".py"; sys.modules[name] = m
for name in blob["order"]:
    exec(compile(blob["src"][name], name + ".py", "exec"), sys.modules[name].__dict__)
import hubdb, locations as L, scope as sc, drive as dr, clients as C, client_app as CA
job = blob["job"]
db = hubdb.HubDb()
drv = dr.Drive()
why = {}
def wrap(name, fn):
    def run(*a):
        try:
            return fn(*a)
        except (sc.Defer, hubdb.Unreadable) as e:
            why[name] = type(e).__name__ + ": " + str(e)[:160]
            raise
    return run
CA.PACK_DOORS = {n: wrap(n, f) for n, f in CA.PACK_DOORS.items()}
out = {"drive": drv.available, "packs": {}, "gates": {}}
service = {"is_service": True, "role": "admin", "id": "", "email": ""}
for key in job["keys"]:
    why.clear()
    started = time.monotonic()
    try:
        env = CA.client_pack(L.Session(L.Reads(db, drv), service), {"client": key})
    except (sc.Defer, hubdb.Unreadable) as e:
        env = {"deferred": str(e)[:200]}
    out["packs"][key] = {"env": env, "why": dict(why), "s": round(time.monotonic() - started, 2)}
users = L.Reads(db, drv).users()
boss = next((u for u in users if not sc.gsjs.str_(u.get("mergedinto")) and sc.is_master_email(u.get("email"))
             and sc.gsjs.str_(u.get("role")) == "admin"), None)
one = job["keys"][0]
out["gates"]["pack_refused_to_a_person"] = CA.ACTIONS["clientPack"](
    L.Session(L.Reads(db, drv), sc.user_from_row(boss) if boss else None), {"client": one})
out["gates"]["pack_unknown_client"] = CA.client_pack(L.Session(L.Reads(db, drv), service), {"client": "nobody_here_zz"})
out["gates"]["pack_malformed_client"] = CA.client_pack(L.Session(L.Reads(db, drv), service), {"client": "a b"})
if boss is not None:
    got = CA.ACTIONS["clientProfileRoster"](L.Session(L.Reads(db, drv), sc.user_from_row(boss)), {})
    out["gates"]["master_roster"] = {"status": got.get("status"), "viewer": (got.get("data") or {}).get("viewer"),
                                     "n": len((got.get("data") or {}).get("clients") or [])}
print(json.dumps(out))
'''


def run_python(runner: str, job: dict) -> dict:
    blob = {"order": list(MODULES), "src": {n: (APP / f"{n}.py").read_text(encoding="utf-8") for n in MODULES},
            "job": job}
    payload = base64.b64encode(json.dumps(blob).encode()) + b"\n"
    got = docker("exec", "-i", runner, "python", "-c", DRIVER, data=payload, timeout=1800)
    if got.returncode != 0:
        raise RuntimeError(f"the Python side did not run in {runner}: {got.stderr.decode()[-600:]}")
    return json.loads(got.stdout.decode().strip().splitlines()[-1])


def instant(v: Any) -> float | None:
    if isinstance(v, str) and ISO.match(v):
        s = v if "." in v else v[:-1] + ".000Z"
        return datetime.strptime(s, "%Y-%m-%dT%H:%M:%S.%fZ").replace(tzinfo=timezone.utc).timestamp()
    return None


LIST_KEYS = ("id", "key", "client_key", "name", "record")


def key_of(items: list) -> str:
    """The field that names each element of a list once ('' when none does)."""
    if not items or not all(isinstance(x, dict) for x in items):
        return ""
    for k in LIST_KEYS:
        vals = [x.get(k) for x in items]
        if all(isinstance(v, str) and v for v in vals) and len(set(vals)) == len(vals):
            return k
    return ""


def masked(v: str) -> str:
    """A list element's name in a path: never a whole name."""
    return v[:3] + "…" if len(v) > 4 else v


def diff(a: Any, b: Any, path: str, out: list[tuple[str, str, Any, Any]], when: dict[str, str]) -> None:
    """Python's answer `a` against Apps Script's `b`: each difference with its class; named lists compared by name."""
    if isinstance(a, dict) and isinstance(b, dict):
        for k in sorted(set(a) | set(b)):
            if k in META:
                continue
            if k not in a:
                out.append((f"{path}.{k}", "missing", None, b[k]))
            elif k not in b:
                out.append((f"{path}.{k}", "extra", a[k], None))
            else:
                diff(a[k], b[k], f"{path}.{k}", out, when)
        return
    if isinstance(a, list) and isinstance(b, list):
        k = key_of(a) or key_of(b)
        if k and (not a or key_of(a) == k) and (not b or key_of(b) == k):
            am, bm = {x[k]: x for x in a}, {x[k]: x for x in b}
            for name, x in am.items():
                if name not in bm:
                    out.append((f"{path}[{k}={masked(name)}]", "extra", x, None))
            for name, y in bm.items():
                if name not in am:
                    out.append((f"{path}[{k}={masked(name)}]", "missing", None, y))
            for name in am:
                if name in bm:
                    diff(am[name], bm[name], f"{path}[{k}={masked(name)}]", out, when)
            ours, theirs = [n for n in am if n in bm], [n for n in bm if n in am]
            if ours != theirs:
                out.append((path, "order", len(ours), len(theirs)))
            return
        if len(a) != len(b):
            out.append((path, "length", len(a), len(b)))
        for i, (x, y) in enumerate(zip(a, b)):
            diff(x, y, f"{path}[{i}]", out, when)
        return
    if a == b or (isinstance(a, (int, float)) and isinstance(b, (int, float)) and not isinstance(a, bool)
                  and not isinstance(b, bool) and float(a) == float(b)):
        return
    ia, ib = instant(a), instant(b)
    if ia is not None and ib is not None and abs(ia - ib) < 1.0:
        out.append((path, "precision", a, b))
        return
    leaf = path.rsplit(".", 1)[-1]
    days = isinstance(a, str) and isinstance(b, str) and bool(DAY.match(a)) and bool(DAY.match(b))
    # the day each read ran, or the instant it read at
    if (leaf in ("today", "date") and days and b == when["read_day"] and a == when["today"]) or \
            (leaf == "as_of" and ia is not None and ib is not None):
        out.append((path, "clock", a, b))
        return
    # rows that arrived after Apps Script's read: a newer newest day, a larger count of a source's rows
    if (leaf == "as_of" and days and a > b and a >= when["read_day"]) or \
            (re.search(r"\.sources\[[^\]]*\]\.rows$", path) and isinstance(a, int) and isinstance(b, int) and a > b):
        out.append((path, "newer", a, b))
        return
    out.append((path, "value", a, b))


def shape(v: Any) -> str:
    """What a value is, without what it says."""
    if v is None:
        return "none"
    if isinstance(v, bool):
        return "bool"
    if isinstance(v, (int, float)):
        return "number"
    if isinstance(v, str):
        return f"text({len(v)})" if v else "''"
    if isinstance(v, list):
        return f"list({len(v)})"
    if isinstance(v, dict):
        return f"object({len(v)})"
    return type(v).__name__


def report(label: str, out: list[tuple[str, str, Any, Any]], show: int, values: bool) -> int:
    kinds: dict[str, int] = {}
    for _p, k, _a, _b in out:
        kinds[k] = kinds.get(k, 0) + 1
    real = [d for d in out if d[1] not in EXPLAINED]
    said = ", ".join(f"{n} {k}" for k, n in sorted(kinds.items())) or "identical"
    print(f"    {label}: {said}")
    shapes: dict[str, list] = {}
    for p, k, a, b in real:
        shapes.setdefault(re.sub(r"\[[^\]]*\]", "[]", p) + " " + k, []).append((p, a, b))
    for sh, items in sorted(shapes.items(), key=lambda x: -len(x[1]))[:show]:
        p, a, b = items[0]
        seen = (f"python={json.dumps(a)[:70]} apps_script={json.dumps(b)[:70]}" if values
                else f"python={shape(a)} apps_script={shape(b)}")
        print(f"      {len(items)}x {sh}  e.g. {p}: {seen}")
    return len(real)


def parity(args: argparse.Namespace) -> None:
    if not shutil.which("docker"):
        print("\nparity: skipped — no docker here, so neither the kept packs nor asa-hub-db can be reached")
        return
    print("\nPARITY — Python's clientPack against the relay's kept clientPack answers (Apps Script's)")
    packs = kept_packs(Path(args.fixtures) if args.fixtures else None, Path(args.save) if args.save else None)
    if not packs:
        print("  no kept Clients pack to compare against")
        return
    runner = args.runner or next((r for r in RUNNERS if running(r)), "")
    if not runner:
        print("  skipped — neither asa-hub-app nor asa-hub-db-sync is running to read asa-hub-db")
        return
    keys = sorted(packs)[:args.limit] if args.limit else sorted(packs)
    started = time.time()
    py = run_python(runner, {"keys": keys})
    print(f"  Python ran in {runner} in {time.time() - started:.1f}s; Drive credentials "
          f"{'present' if py['drive'] else 'absent'}")
    tally: dict[str, int] = {"parts compared": 0, "parts equal": 0, "parts differing": 0, "parts left to Apps Script": 0}
    reasons: dict[str, int] = {}
    per_part: dict[str, dict[str, int]] = {}
    unexplained = 0
    seconds: list[float] = []
    for n, key in enumerate(keys, start=1):
        body = packs[key]
        gs = body["data"]
        read_at = float(body.get("read_at") or 0)
        when = {"read_day": datetime.fromtimestamp(read_at, NY).strftime("%Y-%m-%d"),
                "today": datetime.fromtimestamp(started, NY).strftime("%Y-%m-%d")}
        mine = py["packs"].get(key) or {}
        env = mine.get("env") or {}
        label = f"c{n:02d} {key[:2]}…"
        seconds.append(float(mine.get("s") or 0))
        print(f"  {label} (Apps Script read it {(time.time() - read_at) / 60:.0f} min ago; Python built it in "
              f"{mine.get('s')}s)")
        if env.get("status") != 200:
            check(f"{label}: Python builds the pack", False, env.get("deferred") or env.get("message"))
            continue
        data = env["data"]
        check(f"{label}: the pack names the same client and every part", data.get("client") == gs.get("client")
              and set(data["part_status"]) == set(gs["part_status"]), sorted(set(gs["part_status"]) ^ set(data["part_status"])))
        for part in sorted(gs["part_status"]):
            row = per_part.setdefault(part, {"equal": 0, "differing": 0, "left": 0})
            st = data["part_status"].get(part) or {}
            if st.get("status") != 200:
                why = (mine.get("why") or {}).get(part) or st.get("message") or "?"
                why = re.sub(r"\(\d+\)|\b\d+\b", "#", why)
                reasons[f"{part}: {why}"] = reasons.get(f"{part}: {why}", 0) + 1
                tally["parts left to Apps Script"] += 1
                row["left"] += 1
                continue
            out: list = []
            diff(data["parts"].get(part), gs["parts"].get(part), part, out, when)
            tally["parts compared"] += 1
            real = report(part, out, args.show, args.values) if out else 0
            unexplained += real
            if real:
                tally["parts differing"] += 1
                row["differing"] += 1
            else:
                tally["parts equal"] += 1
                row["equal"] += 1
    print("\n  per part (equal / differing / left to Apps Script):")
    for part, row in sorted(per_part.items()):
        print(f"    {part:14s} {row['equal']:3d} / {row['differing']:3d} / {row['left']:3d}")
    print("\n  why a part was left to Apps Script:")
    for why, n in sorted(reasons.items(), key=lambda x: (-x[1], x[0])):
        print(f"    {n:3d}x {why}")
    if seconds:
        print(f"\n  Python's pack took {min(seconds):.1f}s to {max(seconds):.1f}s (median "
              f"{sorted(seconds)[len(seconds) // 2]:.1f}s)")
    print("  in all: " + ", ".join(f"{k} {n}" for k, n in tally.items()))
    print("\nPARITY — the gates")
    g = py.get("gates") or {}
    check("a person (even the master) is refused clientPack as Unknown action",
          g.get("pack_refused_to_a_person") == {"status": 404, "message": "Unknown action."}, g.get("pack_refused_to_a_person"))
    check("an unknown client is a 404 in the pack", (g.get("pack_unknown_client") or {}).get("status") == 404,
          g.get("pack_unknown_client"))
    check("a malformed client key is a 400 in the pack", (g.get("pack_malformed_client") or {}).get("status") == 400,
          g.get("pack_malformed_client"))
    if "master_roster" in g:
        check("the master reads the roster as master", g["master_roster"].get("status") == 200
              and g["master_roster"].get("viewer") == "master", g["master_roster"])
    check("no difference beyond a timestamp's milliseconds and the read's own clock", unexplained == 0,
          f"{unexplained} difference(s) above")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--fixtures", help="a folder of kept packs saved earlier (else read from the relay container)")
    ap.add_argument("--save", help="save the kept packs read from the relay here (0600 files; they hold client records)")
    ap.add_argument("--runner", help="the container that runs the Python side (default: asa-hub-app, else asa-hub-db-sync)")
    ap.add_argument("--limit", type=int, default=0, help="compare only the first N clients")
    ap.add_argument("--show", type=int, default=6, help="difference shapes shown per part")
    ap.add_argument("--values", action="store_true", help="print the differing values (they hold client records)")
    args = ap.parse_args()
    parity(args)
    print(f"\ntest-clients-parity: {results['ok']} ok, {len(results['failed'])} failed")
    return 1 if results["failed"] else 0


if __name__ == "__main__":
    sys.exit(main())
