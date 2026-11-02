#!/usr/bin/env python3
"""The relay's mirror readers on asa-hub-db, functionally: app/hub_rows.py read in-process inside asa-hub-db-sync
against asa-hub-db live (read-only, no write anywhere) — a record book's tab with its word, a giant tab narrowed by
Postgres, counts, the books holding a tab, the action log's window, the relay's door answering its own identity
(and `same` for the signature it sent) and refusing anyone else; then, inside asa-hub-snapshot with this worktree's
server/ modules, server/hub_rows.py and the readers moved onto it against a stand-in of that door — the access gate
(open and closed), mirror_first's vouch and rows, the behavior board's people, houses, places and worlds, the CV
coverage, the calendar builder's rows and stamp, the comm-calls slice, the MAR papers' client files, and a door that
cannot answer said as unread.

    python3 tools/test-hub-rows.py
"""
from __future__ import annotations

import base64
import glob
import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

APP_DRIVER = r'''
import base64, importlib.abc, importlib.util, json, sys, time, logging
logging.disable(logging.CRITICAL)
blob = json.loads(sys.stdin.read())
SRC = {k: base64.b64decode(v).decode() for k, v in blob["app"].items()}
class Loader(importlib.abc.MetaPathFinder, importlib.abc.Loader):
    def find_spec(self, name, path, target=None):
        return importlib.util.spec_from_loader(name, self) if name in SRC else None
    def create_module(self, spec):
        return None
    def exec_module(self, module):
        module.__file__ = "/app/" + module.__name__ + ".py"
        exec(compile(SRC[module.__name__], module.__file__, "exec"), module.__dict__)
sys.meta_path.insert(0, Loader())
import hubdb, hub_rows as H, locations as L
results = []
def check(name, ok, detail=None):
    results.append(bool(ok))
    print(("  ok   " if ok else "  FAIL ") + name + ("" if ok or detail is None else f" — {detail}"))
CORE, ESS = "1ia6i0SFiVNhn4wi6bt6EDcGwReS0P7-L4Up2hRfIVPg", "1Y6UMJlCS5gHur52f0YrPsLSqwYlCA792I8gAiZsxsug"
db = hubdb.shared()
t = H.read(CORE, "users")
check("a record book's tab: its rows, its word ok and current now", t["tab_known"] and len(t["rows"]) > 50
      and t["book_status"] == "ok" and time.time() - t["as_of"] < 5, (len(t["rows"]), t["book_status"]))
check("each row as the mirror kept it: header -> text, in sheet order",
      all(isinstance(d, dict) for _r, d in t["rows"]) and [r for r, _d in t["rows"]] == sorted(r for r, _d in t["rows"])
      and "user_id" in t["rows"][0][1])
t0 = time.time()
f = H.rows(ESS, "Facts", where={"Source": ["switchboard:props.HUB_HOUSE_CLIENT_FILES_ID", "switchboard:props.HUB_DB_ID"]})
check("a giant tab narrowed by Postgres: only the facts asked, fast", f and all(d.get("Source") in (
      "switchboard:props.HUB_HOUSE_CLIENT_FILES_ID", "switchboard:props.HUB_DB_ID") for d in f)
      and time.time() - t0 < 5, (len(f), round(time.time() - t0, 2)))
c = H.counts("1NYomIa0DXh2bScsa9HB_ax400F-JaDHxzP_MnweU1Rs", "Calendar Archive", "Employee")
check("counts of one cell's texts", c and all(isinstance(n, int) and n > 0 for n in c.values()), len(c))
p = H.read("1NYomIa0DXh2bScsa9HB_ax400F-JaDHxzP_MnweU1Rs", "Calendar Archive", fields=["Employee", "Date"],
           sizes=["Location"])
row = p["rows"][0][1] if p["rows"] else {}
check("only the cells asked cross, a sized cell as its length", set(row) <= {"Employee", "Date", "Location"}
      and isinstance(row.get("Location"), int), row)
h = H.holders("tp_candidates")
check("the books holding a tab", "1" and len(h) >= 1 and all(isinstance(s, str) for s in h), h)
since = time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(time.time() - 2 * 86400))
t0 = time.time()
lines = H.log_lines(since, ["actor", "action", "timestamp", "area", "ok"])
check("the action log's window: the book's history and the Hub's own lines", lines and all(
      l["timestamp"] >= since for l in lines) and time.time() - t0 < 8, (len(lines), round(time.time() - t0, 2)))
w = H.book("no-such-book")
check("a book the copy does not hold says so", w["known"] is False and w["stale"] is True)
reads = L.Reads(db)
svc = L.Session(reads, {"is_service": True, "role": "admin", "id": "", "email": ""})
got = H.tab_rows(svc, {"asks": [{"sheet_id": CORE, "tab": "tenants"}]})
a = got["data"]["answers"][0]
check("the relay's door answers its own identity, with a signature", got["status"] == 200 and a["rows"] and a["sig"])
again = H.tab_rows(svc, {"asks": [{"sheet_id": CORE, "tab": "tenants", "sig": a["sig"]}]})["data"]["answers"][0]
check("the same signature sent back answers `same`, no rows", again.get("same") is True and "rows" not in again)
no = H.tab_rows(L.Session(reads, {"role": "admin", "id": "u1", "email": "a@b"}), {"asks": [{"sheet_id": CORE,
                                                                                          "tab": "users"}]})
check("anyone else is refused at the door", no == {"status": 403, "message": "This is the relay's own door."})
bad = H.tab_rows(svc, {"asks": [{"sheet_id": CORE}]})["data"]["answers"][0]
check("an ask the copy cannot read is said unread, never empty", "unread" in bad and "rows" not in bad)
print(json.dumps({"passed": sum(results), "total": len(results)}))
'''

RELAY_DRIVER = r'''
import base64, hashlib, importlib.abc, importlib.util, json, sys, time, logging
logging.disable(logging.CRITICAL)
blob = json.loads(sys.stdin.read())
SRC = {k: base64.b64decode(v).decode() for k, v in blob["server"].items()}
sys.path.append("/srv/app")
class Loader(importlib.abc.MetaPathFinder, importlib.abc.Loader):
    def find_spec(self, name, path, target=None):
        return importlib.util.spec_from_loader(name, self) if name in SRC else None
    def create_module(self, spec):
        return None
    def exec_module(self, module):
        module.__file__ = "/srv/app/" + module.__name__ + ".py"
        exec(compile(SRC[module.__name__], module.__file__, "exec"), module.__dict__)
sys.meta_path.insert(0, Loader())
import hub_rows
results = []
def check(name, ok, detail=None):
    results.append(bool(ok))
    print(("  ok   " if ok else "  FAIL ") + name + ("" if ok or detail is None else f" — {detail}"))
CORE, ESS = "1ia6i0SFiVNhn4wi6bt6EDcGwReS0P7-L4Up2hRfIVPg", "1Y6UMJlCS5gHur52f0YrPsLSqwYlCA792I8gAiZsxsug"
NOW = time.time()
TABS = {
    (CORE, "users"): [{"user_id": "u1", "display_name": "Ann Staff", "role": "staff", "types": "DSP", "email": "ann@x.org",
                       "phone": "(330) 555-0101", "active": "TRUE", "pass_hash": "[withheld: secret]"},
                      {"user_id": "u2", "display_name": "Bo Admin", "role": "admin", "types": "", "email": "bo@x.org"}],
    (CORE, "app_badge_access"): [{"app_id": "hotline", "badges": "MANAGER"}, {"app_id": "hotline", "badges": "DSP"}],
    (CORE, "app_tenant_access"): [{"app_id": "hotline", "tenants": "[]"}],
    (CORE, "tenants"): [{"tenant_id": "asa"}, {"tenant_id": "hq2"}],
    (ESS, "Facts"): [{"Subject ID": "HUB_HOUSE_PERF_TRAININGS_ID", "Source": "x", "Value": "old-house"},
                     {"Subject ID": "HUB_HOUSE_PERF_TRAININGS_ID", "Source": "x", "Value": "TRAIN-HOUSE"},
                     {"Subject ID": "", "Source": "switchboard:props.HUB_HOUSE_CLIENT_FILES_ID", "Value": "FILES-HOUSE"}],
    ("TRAIN-HOUSE", "Data"): [{"name": "Ann Staff", "course": "CPR"}],
    ("HIRE", "tp_candidates"): [{"name": "Cy Cand", "resume_link": "http://cv"}, {"name": "No Link", "resume_link": ""}],
    ("FORMS", "form_files"): [{"person": "Di Paper", "doc_kind": "Resume"}, {"person": "X", "doc_kind": "id"}],
    ("1_S62kl6hh0XG_3OK25X-AZYuYo3Apfm5oCAvvmdodfU", "Staff Requests"): [{"Your Name": "Ann"}],
    ("1ZMOjT2PokimmEraIWZE1k-XtQWZFpVGHPUaWZsEEcko", "comm_calls"): [
        {"call_at": "2026-10-01", "source_at": "2026-10-02T00:00:00Z"}, {"call_at": "", "source_at": ""},
        {"call_at": "2026-10-03", "source_at": "2026-10-04T00:00:00Z"}],
    ("FILES-HOUSE", "client_files"): [{"drive_id": "F1", "doc_kind": "MAR", "digest_text": "abcdef",
                                       "digest_text_chars": "6", "title": "t"}],
}
BOOKS = {CORE: "record", ESS: "record", "1_S62kl6hh0XG_3OK25X-AZYuYo3Apfm5oCAvvmdodfU": "ok"}
asked = []
def door(action, p):
    asked.append(action)
    if action == "tabRows":
        out = []
        for a in p["asks"]:
            rows = [[i + 2, d] for i, d in enumerate(TABS.get((a["sheet_id"], a["tab"]), []))]
            for h, v in (a.get("where") or {}).items():
                vals = v if isinstance(v, list) else [v]
                rows = [r for r in rows if r[1].get(h) in vals]
            if a.get("fields") or a.get("sizes"):
                keep = set(a.get("fields") or []) | set(a.get("sizes") or [])
                rows = [[rn, {**{k: v for k, v in d.items() if k in keep},
                              **{k: len(str(d.get(k) or "")) for k in a.get("sizes") or []}}] for rn, d in rows]
            sig = hashlib.sha1(json.dumps([a["sheet_id"], a["tab"], rows]).encode()).hexdigest()
            word = {"as_of": NOW - 30, "book_known": True, "book_status": "ok", "sig": sig,
                    "tab_known": (a["sheet_id"], a["tab"]) in TABS}
            if a.get("count"):
                cnt = {}
                for _rn, d in rows:
                    if d.get(a["count"]):
                        cnt[d[a["count"]]] = cnt.get(d[a["count"]], 0) + 1
                out.append({**word, "counts": cnt, "rows": []})
            elif a.get("sig") == sig:
                out.append({**word, "same": True})
            else:
                out.append({**word, "rows": rows, "headers": sorted({k for _r, d in rows for k in d})})
        return {"answers": out}
    if action == "bookWords":
        return {"books": {s: {"known": s in BOOKS, "status": "ok", "as_of": NOW - 30, "stale": False,
                              "modified_time": None, "synced_at": NOW - 60, "record": BOOKS.get(s) == "record"}
                          for s in p["sheet_ids"]}}
    if action == "tabHolders":
        return {"holders": [{"sheet_id": s} for (s, t) in TABS if t == p["tab"]]}
    if action == "worldOwners":
        return {"worlds": [{"world_id": "w1", "owner_user_id": "u1", "owner_email": "Ann@x.org"}]}
    if action == "logWindow":
        return {"lines": []}
    raise AssertionError(action)
hub_rows.ask = door

# the cache: a tab asked again past FRESH_S sends its signature and keeps its rows on `same`
hub_rows.FRESH_S = 0.0
first = hub_rows.rows(CORE, "users")
again = hub_rows.rows(CORE, "users")
check("a tab asked again crosses as `same` and keeps its rows", first == again and len(again) == 2)

import hotline_desk as HD
gate = HD._core_from_mirror("dsn", CORE, "u1", "hotline")
check("the access gate's copy: the account, the last badge row, the tenants, age and word",
      gate["user"]["user_id"] == "u1" and gate["rule"] == ["DSP"] and gate["tenants"] == [] and gate["sync_ok"]
      and 0 <= gate["age_s"] < 60, gate)
opened = HD.app_access("dsn", CORE, "u1", "staff", "hotline", fresh_s=7200.0)
check("a staff badge the App Access row names opens the hotline from the copy", opened["open"] and
      opened["via"] == "mirror", opened)
closed = HD.app_access("dsn", CORE, "u2", "admin", "hotline", fresh_s=7200.0, is_master=False)
check("an account whose badges the row does not name stays closed", not closed["open"] and
      closed["reason"] == "badge", closed)

import mirror_first as MF
v = MF.vouch("dsn", CORE, "users")
check("mirror_first vouches from the copy's word", v.has and v.fresh, v)
mr = MF.mirror_rows("dsn", CORE, "users", {"id": "user_id", "name": "display_name"})
check("mirror_first's rows: only the named cells, with their sheet row",
      [(r["id"], r["name"], r["_row"]) for r in mr] == [("u1", "Ann Staff", 2), ("u2", "Bo Admin", 3)], mr)

import behavior_slices as BS
people = BS._people(None)
check("the behavior board's people, with their login keys", set(people) == {"u1", "u2"} and
      "ann@x.org" in people["u1"]["keys"] and people["u1"]["armed"], people.get("u1"))
check("the newest declared house, from the depot's facts", BS._house_of(None, "perf_trainings") == "TRAIN-HOUSE")
rows, sid = BS._rows_for(None, "perf_trainings")
check("a declared house's Data rows", sid == "TRAIN-HOUSE" and rows == [{"name": "Ann Staff", "course": "CPR"}])
check("the places and My World's owners", BS._places(None) == ["asa", "hq2"] and
      BS._worlds(None) == {"u1": "w1", "ann@x.org": "w1"})

import resume_slices as RS
cv, stamp = RS.build("resumeCoverage", "dsn")
check("CV coverage from every book holding the sources", [r["person_key"] for r in cv] == ["cycand", "dipaper"]
      and stamp.endswith("Z"), cv)

import calendar_builder_slices as CB
got, st = CB._mirror_rows("dsn", "Staff Requests")
check("the calendar builder's rows, stamped by the copy's word", got == [{"Your Name": "Ann"}] and st
      and CB._verified_stamp("dsn", "fallback") != "fallback")

import comm_calls_slices as CC
calls, at = CC.build("commCalls", "dsn")
check("the comm-calls slice from the copy, blank rows left out, newest first",
      [c["call_at"] for c in calls] == ["2026-10-03", "2026-10-01"] and at == "2026-10-04T00:00:00Z", calls)

import mar_papers as MP
files = MP.client_files_rows()
check("the MAR papers' client files: the depot's house, the cells asked, the text's length",
      files == {"F1": {"drive_id": "F1", "doc_kind": "mar", "text_file": "", "title": "t", "mime_type": "",
                       "chars": 6, "cell": 6, "house": "FILES-HOUSE"}}, files)

def down(action, p):
    raise hub_rows.Unreadable("asa-hub-app could not be asked (ConnectionRefusedError)")
hub_rows.ask = down
hub_rows._HELD.clear()
try:
    hub_rows.rows(CORE, "users")
    said = False
except hub_rows.Unreadable:
    said = True
refused = HD.app_access("dsn", CORE, "u1", "staff", "hotline", fresh_s=7200.0, sheets=lambda: (_ for _ in ()).throw(
    RuntimeError("no live read here")))
check("a door that cannot answer is unread, and the gate stays shut", said and not refused["open"], refused)
print(json.dumps({"passed": sum(results), "total": len(results)}))
'''

SERVER = ("hub_rows", "mirror_first", "hotline_desk", "hotline_lanes", "daily_notes", "behavior_slices", "ist_config",
          "resume_slices", "calendar_builder_slices", "comm_calls_slices", "mar_papers", "cert_reads", "call_prefs",
          "digest_proposals")


def run(container: str, driver: str, blob: dict) -> tuple[int, int]:
    got = subprocess.run(["docker", "exec", "-i", container, "python", "-c", driver], input=json.dumps(blob).encode(),
                         capture_output=True, timeout=600)
    out = got.stdout.decode()
    print(out, end="")
    if got.returncode:
        print(got.stderr.decode()[-3000:])
    last = [ln for ln in out.splitlines() if ln.startswith("{")]
    tally = json.loads(last[-1]) if last else {"passed": 0, "total": 1}
    return tally["passed"], tally["total"]


def main() -> int:
    app = {os.path.basename(p)[:-3]: base64.b64encode(open(p, "rb").read()).decode()
           for p in glob.glob(str(ROOT / "app" / "*.py"))}
    server = {m: base64.b64encode((ROOT / "server" / f"{m}.py").read_bytes()).decode() for m in SERVER}
    print("app/hub_rows.py in asa-hub-db-sync, asa-hub-db live (read-only):")
    a = run("asa-hub-db-sync", APP_DRIVER, {"app": app})
    print("server/hub_rows.py and the readers in asa-hub-snapshot, against a stand-in door:")
    b = run("asa-hub-snapshot", RELAY_DRIVER, {"server": server})
    passed, total = a[0] + b[0], a[1] + b[1]
    print(f"{passed}/{total} ok")
    return 0 if passed == total else 1


if __name__ == "__main__":
    sys.exit(main())
