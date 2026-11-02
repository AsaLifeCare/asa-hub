#!/usr/bin/env python3
"""The hotline book's call times read on its own clock (gsjs.book_zone, gsjs.parse_when): SSA activity against every
ssaPack the relay keeps (Apps Script's), every family member's activity, eight staff members' transcripts, each call
time against server/hotline_desk.py's parse_when on the same cells. Runs in asa-hub-db-sync; prints counts only."""
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
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "app"
MODULES = ("gsjs", "hubdb", "scope", "drive", "locations", "clients", "client_sources", "writes", "client_writes",
           "staff", "staff_comms", "ssa", "ssa_writes", "family", "family_writes")
RELAY = "asa-hub-snapshot"
RUNNER = "asa-hub-db-sync"
PACK_DIR = "/srv/app-packs"
DESK_COPY = "/srv/snapshot/mirror-first/hotline-desk.private.json"
CEILING = 900 << 20
STAFF_N = 8
DESK_NAMES = ("_SHEETS_EPOCH", "_MONTHS", "_MDY", "_JS_DATE", "_ISO_HEAD", "_zone", "serial_to_utc", "parse_when")

_spec = importlib.util.spec_from_file_location("clients_parity", ROOT / "tools" / "test-clients-parity.py")
P = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(P)
results = P.results
check = P.check


def docker(*args: str, data: bytes | None = None, timeout: int = 600) -> subprocess.CompletedProcess:
    return subprocess.run(["docker", *args], input=data, capture_output=True, timeout=timeout)


def relay_json(script: str) -> Any:
    got = docker("exec", "-i", RELAY, "python3", "-", data=script.encode(), timeout=180)
    if got.returncode != 0:
        raise RuntimeError(f"the relay could not be read ({got.stderr.decode()[-200:]})")
    return json.loads(got.stdout.decode() or "null")


def kept_packs() -> dict[str, dict[str, dict]]:
    """The relay's kept SSA and Families packs, in memory only."""
    apps = ("ssa-profiles", "family-index", "family-profiles")
    script = ("import json,os,re,sys\nd=%r\nout=[]\nfor n in os.listdir(d):\n"
              "    if not re.fullmatch(r'[0-9a-f]{64}\\.json', n): continue\n"
              "    try: b=json.load(open(os.path.join(d,n)))\n    except Exception: continue\n"
              "    if b.get('app') in %r: out.append(b)\nsys.stdout.write(json.dumps(out))\n") % (PACK_DIR, apps)
    out: dict[str, dict[str, dict]] = {a: {} for a in apps}
    for body in relay_json(script) or []:
        out[body["app"]][body["key"]] = body
    return out


def desk_copy() -> dict[str, Any]:
    """The hotline desk's kept transcripts copy: its zone, and each call id's first time cells."""
    script = ("import json,sys\nd=json.load(open(%r))\nv=((d.get('copies') or {}).get('transcripts') or {})"
              ".get('value') or {}\nrows={}\nfor r in v.get('rows') or []:\n"
              "    c=str(r.get('call_id') or '').strip()\n"
              "    if c and c not in rows: rows[c]=[r.get('event_at'), r.get('created')]\n"
              "sys.stdout.write(json.dumps({'zone': v.get('zone') or '', 'rows': rows}))\n") % DESK_COPY
    return relay_json(script) or {"zone": "", "rows": {}}


def desk_source() -> str:
    """server/hotline_desk.py's own time readers, lifted as written."""
    src = (ROOT / "server" / "hotline_desk.py").read_text(encoding="utf-8")
    parts = ["import math, re", "from datetime import datetime, timedelta, timezone", "from typing import Any",
             "try:\n    from zoneinfo import ZoneInfo\nexcept Exception:\n    ZoneInfo = None"]
    found = set()
    for node in ast.parse(src).body:
        name = node.name if isinstance(node, ast.FunctionDef) else (
            node.targets[0].id if isinstance(node, ast.Assign) and isinstance(node.targets[0], ast.Name) else "")
        if name in DESK_NAMES:
            parts.append(ast.get_source_segment(src, node))
            found.add(name)
    if found != set(DESK_NAMES):
        raise RuntimeError(f"hotline_desk.py no longer defines {sorted(set(DESK_NAMES) - found)}")
    return "\n\n".join(parts) + "\n"


DRIVER = r'''
import base64, json, os, sys, threading, time, types
from datetime import datetime, timezone
blob = json.loads(base64.b64decode(sys.stdin.readline()).decode())


def _watch():
    while True:
        try:
            cur = int(open("/sys/fs/cgroup/memory.current").read())
        except Exception:
            cur = 0
        if cur > int(blob["ceiling"]):
            sys.stdout.write(json.dumps({"aborted": cur >> 20}) + "\n")
            sys.stdout.flush()
            os._exit(3)
        time.sleep(0.1)


threading.Thread(target=_watch, daemon=True).start()
for name in blob["order"]:
    m = types.ModuleType(name); m.__file__ = name + ".py"; sys.modules[name] = m
for name in blob["order"]:
    exec(compile(blob["src"][name], name + ".py", "exec"), sys.modules[name].__dict__)
desk = {}
exec(compile(blob["desk"], "hotline_desk.py", "exec"), desk)
import gsjs, hubdb, locations as L, scope as sc, drive as dr, staff as SP, staff_comms as SC, ssa as S, family as F
job = blob["job"]
db = hubdb.HubDb()
drv = dr.Drive()
ZONE = job["zone"]
out = {"checks": [], "census": {}}


def check(name, ok, detail=""):
    out["checks"].append([name, bool(ok), "" if ok else str(detail)[:300]])


def soft(fn):
    try:
        return fn(), ""
    except (sc.Defer, hubdb.Unreadable) as e:
        return None, type(e).__name__ + ": " + str(e)[:160]


def stamp(dt):
    return None if dt is None else dt.timestamp()


def iso_s(iso):
    return datetime.strptime(iso[:19], "%Y-%m-%dT%H:%M:%S").replace(tzinfo=timezone.utc).timestamp() if iso else None


R0 = L.Reads(db, drv)
hot_id = gsjs.str_(db.prop("HOTLINE_TRANSCRIPTS_ID"))
hot = R0.tab_of(hot_id, SC.HOTLINE_TRANSCRIPTS_TAB, "the hotline transcripts")
out["book"] = {"zone_app": gsjs.book_zone(hot_id, db.prop), "zone_relay": ZONE,
               "declared": gsjs.DECLARED_ZONES.get(hot_id, ""), "quo_sync_is_it": db.prop("QUO_SYNC_SHEET_ID") == hot_id,
               "status": (db.book(hot_id).status if db.book(hot_id) else ""), "rows": hot.row_count if hot else 0}
cols = SC.HOTLINE_COLS
hd, rows = SC._read_columns(R0, hot, {
    "id": (("Call ID",), cols["CALL_ID"]), "created": (("Transcript Created",), 1),
    "event": (("Event Timestamp",), cols["EVENT_TS"]), "who": (("Participant(s)",), cols["PARTICIPANTS"])})
out["book"]["direct"] = hd

# every time cell of the book: the app's reading against the desk's, and against the old New York reading
cells = {"equal": 0, "differ": 0, "blank": 0, "moved_from_ny": 0}
for _rn, h in rows:
    for k in ("event", "created"):
        want = stamp(desk["parse_when"](h[k], ZONE)) if h[k] not in (None, "") else None
        got = SC._dated(h[k], hd, out["book"]["zone_app"])
        mine = got.at.timestamp() if isinstance(got, gsjs.SheetDate) else None
        old = SC._dated(h[k], hd)
        was = old.at.timestamp() if isinstance(old, gsjs.SheetDate) else None
        if want is None and mine is None:
            cells["blank"] += 1
        elif want is not None and mine is not None and abs(want - mine) < 0.001:
            cells["equal"] += 1
        else:
            cells["differ"] += 1
        if mine is not None and was is not None and mine != was:
            cells["moved_from_ny"] += 1
out["cells"] = cells
by_id = {}
for _rn, h in rows:
    c = gsjs.trim(gsjs.or_text(SC._typed(h["id"], hd)))
    if c:
        by_id.setdefault(c, []).append(h)


def desk_at(h):
    for k in ("event", "created"):
        if h[k] not in (None, ""):
            w = desk["parse_when"](h[k], ZONE)
            if w is not None:
                return w
    return None


def expected(cid, owned, since):
    """The time the port should take for this call: the first of its rows naming these phones, on the desk's reading."""
    for h in by_id.get(cid) or []:
        if not any(d in owned for d in SC._numbers(SC._js_text(h["who"], hd))):
            continue
        w = desk_at(h)
        if w is None:
            continue
        iso = w.strftime("%Y-%m-%dT%H:%M:%S")
        if since and iso[:10] < since:
            continue
        return w.timestamp()
    return None


def kept_desk(cid):
    got = (job["desk_rows"] or {}).get(cid)
    if not got:
        return None
    for v in got:
        if v not in (None, ""):
            w = desk["parse_when"](v, ZONE)
            if w is not None:
                return w.timestamp()
    return None


def tally(items, owned, since, into):
    for it in items:
        iid = str(it.get("id") or "")
        if not iid.startswith("call_") or iid[5:] not in by_id:
            continue
        cid = iid[5:]
        want = expected(cid, owned, since)
        if want is None:
            continue
        into["calls"] += 1
        mine = iso_s(it.get("at") or "")
        into["equal" if mine is not None and abs(mine - want) < 1 else "differ"] += 1
        k = kept_desk(cid)
        if k is not None:
            into["desk_kept"] += 1
            into["desk_kept_equal"] += int(mine is not None and abs(mine - k) < 1)


# ---- SSA: the activity door of every SSA the relay keeps ----
out["ssa"] = {}
ssa_calls = {"calls": 0, "equal": 0, "differ": 0, "desk_kept": 0, "desk_kept_equal": 0}
for key in job["ssa_keys"]:
    R = L.Reads(db, drv)
    t = time.monotonic()
    ctx, why = soft(lambda: S.ssa_ctx(R, key))
    env = None
    if ctx is not None and not ctx.get("refused"):
        env, why = soft(lambda: S.activity_door(R, ctx))
    since = gsjs.day_shift(R.today(), -S.ACTIVITY_DAYS)
    out["ssa"][key] = {"env": env, "why": why, "since": since, "s": round(time.monotonic() - t, 2)}
    if env and env.get("status") == 200:
        owned, _w = soft(lambda: S.own_phones(R, ctx)["mine"])
        tally((env.get("data") or {}).get("items") or [], owned or {}, since, ssa_calls)
out["ssa_calls"] = ssa_calls

# ---- Family: every family member's activity ----
fam_calls = {"calls": 0, "equal": 0, "differ": 0, "desk_kept": 0, "desk_kept_equal": 0}
R = L.Reads(db, drv)
fidx = F.index(R)
out["family_n"] = len(fidx["families"])
census = {}
fam_items = {}
for k in sorted(fidx["families"]):
    R = L.Reads(db, drv)
    ctx, why = soft(lambda: F.family_ctx(R, k))
    env = None
    if ctx is not None and not ctx.get("refused"):
        env, why = soft(lambda: F.activity_answer(R, ctx))
    if env and env.get("status") == 200:
        census["answered"] = census.get("answered", 0) + 1
        since = gsjs.day_shift(R.today(), -F.ACTIVITY_DAYS)
        owned, _w = soft(lambda: F.own_phones(R, ctx)["mine"])
        items = (env.get("data") or {}).get("items") or []
        tally(items, owned or {}, since, fam_calls)
        fam_items[k] = [{"id": i["id"], "at": i["at"]} for i in items if str(i.get("id") or "").startswith("call_")]
    else:
        refused = (ctx or {}).get("refused") or env or {}
        said = why or f"status {refused.get('status')}"
        census["left: " + said[:120]] = census.get("left: " + said[:120], 0) + 1
out["family_census"] = census
out["family_calls"] = fam_calls
out["family_items"] = fam_items

# ---- Staff: eight people whose own phones are on the hotline book ----
R = L.Reads(db, drv)
roster, why = soft(lambda: SP.roster_index(R))
hot_digits = {}
for _rn, h in rows:
    for d in SC._numbers(SC._js_text(h["who"], hd)):
        hot_digits[d] = hot_digits.get(d, 0) + 1
cands = []
for key, people in sorted(((roster or {}).get("by_key") or {}).items()):
    if len(people) != 1:
        continue
    n = sum(hot_digits.get(d, 0) for d in SP.phones_of(people[0]))
    if n:
        cands.append((-n, key))
staff = {"people": 0, "calls": 0, "equal": 0, "differ": 0, "desk_kept": 0, "desk_kept_equal": 0, "moved_from_ny": 0,
         "left": {}}
for _n, key in sorted(cands):
    if staff["people"] >= job["staff_n"]:
        break
    R = L.Reads(db, drv)
    ctx = SP.person(R, key)
    if ctx.get("refused"):
        continue
    got, why = soft(lambda: SC.transcripts_build(R, ctx))
    if got is None:
        staff["left"][why[:120]] = staff["left"].get(why[:120], 0) + 1
        continue
    owned, _w = soft(lambda: SC._own_phones(R, ctx)["mine"])
    before = staff["calls"]
    tally([{"id": "call_" + c["call_id"], "at": c["at"]} for c in got["calls"]], owned or {}, "", staff)
    if staff["calls"] == before:
        continue
    staff["people"] += 1
    for c in got["calls"]:
        for h in by_id.get(c["call_id"]) or []:
            if any(d in (owned or {}) for d in SC._numbers(SC._js_text(h["who"], hd))):
                old = SC._instant(h["event"], hd) or SC._instant(h["created"], hd)
                staff["moved_from_ny"] += int(bool(old) and old != c["at"])
                break
out["staff"] = staff
import resource
out["peak_mb"] = round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024)
print(json.dumps(out, default=str))
'''


def run_driver(src: dict[str, str], job: dict, desk: str) -> dict:
    blob = {"order": list(MODULES), "src": src, "job": job, "ceiling": CEILING, "desk": desk}
    got = docker("exec", "-i", "-e", "MALLOC_ARENA_MAX=2", RUNNER, "python", "-c", DRIVER,
                 data=base64.b64encode(json.dumps(blob).encode()) + b"\n", timeout=2400)
    lines = got.stdout.decode().strip().splitlines()
    last = json.loads(lines[-1]) if lines else {}
    if "aborted" in last:
        raise RuntimeError(f"the check stopped itself: {RUNNER} reached {last['aborted']} MiB")
    if got.returncode != 0 or not lines:
        raise RuntimeError(f"the check did not run in {RUNNER}: {got.stderr.decode()[-1500:]}")
    return last


def classify(found: list, read_at: float, since: str) -> list:
    """An item Apps Script could not have seen (newer than its read) or that left the window since: explained."""
    cut = datetime.fromtimestamp(read_at, timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")
    out = []
    for p, k, a, b in found:
        if k == "extra" and isinstance(a, dict) and str(a.get("at") or "") >= cut:
            k = "newer"
        elif k == "missing" and isinstance(b, dict) and str(b.get("at") or "")[:10] < since:
            k = "newer"
        out.append((p, k, a, b))
    news = sum(1 for _p, k, _a, _b in out if k == "newer")
    for i, (p, k, a, b) in enumerate(out):
        if k == "value" and p.endswith(".total") and isinstance(a, int) and isinstance(b, int) and news \
                and abs(a - b) <= news:
            out[i] = (p, "newer", a, b)
    return out


LEAVES: dict[str, int] = {}


def ssa_parity(kept: dict[str, dict], py: dict[str, dict], started: float) -> tuple[int, int, int, dict]:
    same = differ = left = 0
    reasons: dict[str, int] = {}
    LEAVES.clear()
    for n, key in enumerate(sorted(kept), start=1):
        body, mine = kept[key], py.get(key) or {}
        env = mine.get("env") or {}
        if env.get("status") != 200:
            left += 1
            why = re.sub(r"\(\d+\)|\b\d+\b", "#", mine.get("why") or env.get("message") or "?")
            reasons[why] = reasons.get(why, 0) + 1
            print(f"    s{n:02d}.activity: left — {why}")
            continue
        found: list = []
        when = {"read_day": datetime.fromtimestamp(float(body.get("read_at") or 0), P.NY).strftime("%Y-%m-%d"),
                "today": datetime.fromtimestamp(started, P.NY).strftime("%Y-%m-%d")}
        P.diff(env.get("data"), (body["data"]["parts"] or {}).get("activity"), f"s{n:02d}.activity", found, when)
        found = classify(found, float(body.get("read_at") or 0), mine.get("since") or "")
        for p, k, _a, _b in found:
            if k not in P.EXPLAINED:
                leaf = k if k != "value" else re.sub(r"\[[^\]]*\]", "[]", p).split(".", 1)[-1]
                LEAVES[leaf] = LEAVES.get(leaf, 0) + 1
        real = P.report(f"s{n:02d}.activity ({mine.get('s')}s)", found, 6, False) if found else 0
        if not found:
            print(f"    s{n:02d}.activity ({mine.get('s')}s): identical")
        if real:
            differ += 1
        else:
            same += 1
    return same, differ, left, reasons


def family_index_spot(kept: dict[str, dict], items: dict[str, list]) -> None:
    idx = next(iter(kept.get("family-index", {}).values()), None)
    packs = kept.get("family-profiles", {})
    if idx is None and not packs:
        print("    no familyIndexPack or familyPack is kept by the relay just now: nothing to spot-compare")
        return
    seen = equal = 0
    for key, body in packs.items():
        acts = ((body.get("data") or {}).get("parts") or {}).get("activity") or {}
        theirs = {i["id"]: i["at"] for i in acts.get("items") or [] if str(i.get("id") or "").startswith("call_")}
        for it in items.get(key) or []:
            if it["id"] in theirs:
                seen += 1
                equal += int(P.instant(it["at"]) is not None and P.instant(theirs[it["id"]]) is not None
                             and abs(P.instant(it["at"]) - P.instant(theirs[it["id"]])) < 1)
    print(f"    kept family packs: {len(packs)}; call times compared {seen}, equal {equal}")
    check("family: every kept call time equals Python's", equal == seen, f"{seen - equal} differ")


def run_once(label: str, src: dict[str, str], kept: dict, desk: dict, desk_src: str, started: float) -> dict:
    job = {"ssa_keys": sorted(kept["ssa-profiles"]), "zone": desk["zone"], "desk_rows": desk["rows"],
           "staff_n": STAFF_N}
    t = time.time()
    out = run_driver(src, job, desk_src)
    print(f"\n{label} — ran in {time.time() - t:.0f}s, peak {out.get('peak_mb')} MiB")
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--baseline", action="store_true", help="also run the committed modules (HEAD) for the before")
    args = ap.parse_args()
    if not shutil.which("docker"):
        print("test-hotline-zone: skipped — no docker here")
        return 0
    started = time.time()
    kept = kept_packs()
    desk = desk_copy()
    desk_src = desk_source()
    print(f"kept by the relay: {len(kept['ssa-profiles'])} ssaPack(s), {len(kept['family-index'])} familyIndexPack, "
          f"{len(kept['family-profiles'])} familyPack(s); the hotline desk's transcripts copy: zone "
          f"{desk['zone'] or '(none)'}, {len(desk['rows'])} call id(s)")
    check("the relay's hotline desk keeps the transcripts book on America/Sao_Paulo", desk["zone"] == "America/Sao_Paulo",
          desk["zone"])
    if args.baseline:
        head = {m: subprocess.run(["git", "-C", str(ROOT), "show", f"HEAD:app/{m}.py"], capture_output=True,
                                  text=True).stdout for m in MODULES}
        base = run_driver_before(head, kept)
        print(f"  before: identical {base[0]}, differing {base[1]}, left to Apps Script {base[2]}")
        for why, n in sorted(base[3].items(), key=lambda x: -x[1]):
            print(f"      {n}x left: {why}")
    src = {m: (APP / f"{m}.py").read_text(encoding="utf-8") for m in MODULES}
    out = run_once("NOW (working tree)", src, kept, desk, desk_src, started)
    for name, ok, detail in out.get("checks") or []:
        check(name, ok, detail)
    b = out["book"]
    print(f"  the book: {b['rows']} rows, copy status {b['status']}, straight read {b['direct']}; zone here "
          f"{b['zone_app']} (declared {b['declared']}), relay {b['zone_relay']}; QUO_SYNC_SHEET_ID names it "
          f"{b['quo_sync_is_it']}")
    check("the app reads the book on the zone the relay's desk keeps", b["zone_app"] == b["zone_relay"] == b["declared"],
          b)
    c = out["cells"]
    print(f"  every time cell: {c['equal']} equal to hotline_desk.parse_when, {c['differ']} differing, {c['blank']} "
          f"blank; {c['moved_from_ny']} moved from the old New York reading")
    check("every time cell reads as hotline_desk.parse_when reads it", c["differ"] == 0 and c["equal"] > 0, c)

    print("\nSSA — activity against every kept ssaPack (Apps Script's)")
    same, differ, left, reasons = ssa_parity(kept["ssa-profiles"], out["ssa"], started)
    print(f"  identical {same}, differing {differ}, left to Apps Script {left} (of {len(kept['ssa-profiles'])})")
    for why, n in sorted(reasons.items(), key=lambda x: -x[1]):
        print(f"      {n}x left: {why}")
    if LEAVES:
        print("  what differs: " + ", ".join(f"{n}x {leaf}" for leaf, n in sorted(LEAVES.items(), key=lambda x: -x[1])))
    check("every SSA activity part is answered here", left == 0, reasons)
    check("no SSA activity difference is a time, or an item one side lacks",
          not any(leaf.endswith(".at") or leaf in ("extra", "missing", "length", "order") for leaf in LEAVES), LEAVES)
    check("every SSA activity part equals Apps Script's (beyond rows newer than its read)", differ == 0,
          f"{differ} differ")
    sc_ = out["ssa_calls"]
    print(f"  hotline calls in those answers: {sc_['calls']}, equal to the desk's reading {sc_['equal']}; "
          f"in the desk's kept copy {sc_['desk_kept']}, equal {sc_['desk_kept_equal']}")
    check("SSA hotline call times equal the desk's", sc_["differ"] == 0, sc_)

    print(f"\nFAMILY — activity for all {out['family_n']} family members")
    for why, n in sorted(out["family_census"].items(), key=lambda x: -x[1]):
        print(f"      {n}x {why}")
    zone_left = sum(n for w, n in out["family_census"].items() if "clock" in w or "zone" in w)
    check("no family member's activity is left to Apps Script for the hotline clock", zone_left == 0,
          f"{zone_left} left")
    fc = out["family_calls"]
    print(f"  hotline calls in those answers: {fc['calls']}, equal to the desk's reading {fc['equal']}; "
          f"in the desk's kept copy {fc['desk_kept']}, equal {fc['desk_kept_equal']}")
    check("family hotline call times equal the desk's", fc["differ"] == 0, fc)
    family_index_spot(kept, out.get("family_items") or {})

    st = out["staff"]
    print(f"\nSTAFF — transcripts for {st['people']} staff members with calls on the hotline book")
    print(f"  hotline calls: {st['calls']}, equal to the desk's reading {st['equal']}; in the desk's kept copy "
          f"{st['desk_kept']}, equal {st['desk_kept_equal']}; {st['moved_from_ny']} moved from the old New York "
          "reading")
    for why, n in st["left"].items():
        print(f"      {n}x left: {why}")
    check(f"{STAFF_N} staff members read", st["people"] == STAFF_N, st["people"])
    check("staff hotline call times equal the desk's", st["differ"] == 0 and st["calls"] > 0, st)
    print(f"\ntest-hotline-zone: {results['ok']} ok, {len(results['failed'])} failed")
    return 1 if results["failed"] else 0


BEFORE_DRIVER = r'''
import base64, json, sys, types
blob = json.loads(base64.b64decode(sys.stdin.readline()).decode())
for name in blob["order"]:
    m = types.ModuleType(name); m.__file__ = name + ".py"; sys.modules[name] = m
for name in blob["order"]:
    exec(compile(blob["src"][name], name + ".py", "exec"), sys.modules[name].__dict__)
import gsjs, hubdb, locations as L, scope as sc, drive as dr, ssa as S
db = hubdb.HubDb()
drv = dr.Drive()
out = {}
for key in blob["job"]["ssa_keys"]:
    R = L.Reads(db, drv)
    try:
        ctx = S.ssa_ctx(R, key)
        out[key] = {"env": S.activity_door(R, ctx), "why": "", "since": gsjs.day_shift(R.today(), -S.ACTIVITY_DAYS)}
    except (sc.Defer, hubdb.Unreadable) as e:
        out[key] = {"env": None, "why": type(e).__name__ + ": " + str(e)[:160]}
print(json.dumps(out, default=str))
'''


def run_driver_before(src: dict[str, str], kept: dict) -> tuple:
    blob = {"order": list(MODULES), "src": src, "job": {"ssa_keys": sorted(kept["ssa-profiles"])}}
    got = docker("exec", "-i", "-e", "MALLOC_ARENA_MAX=2", RUNNER, "python", "-c", BEFORE_DRIVER,
                 data=base64.b64encode(json.dumps(blob).encode()) + b"\n", timeout=2400)
    lines = got.stdout.decode().strip().splitlines()
    if got.returncode != 0 or not lines:
        raise RuntimeError(f"the before did not run in {RUNNER}: {got.stderr.decode()[-1500:]}")
    print("\nBEFORE (HEAD) — SSA activity against every kept ssaPack")
    return ssa_parity(kept["ssa-profiles"], json.loads(lines[-1]), time.time())


if __name__ == "__main__":
    sys.exit(main())
