"""SSA's admin notes, on the app's own modules and the live App Control rules:
- with no Notes row in App Control (ssa-profiles.notes): an ADMIN, a SUPERVISOR and a DIRECTOR read them, a STAFF or
  MANAGER uncut viewer never; a row naming badges decides instead; the master always, a cut viewer never;
- the notes door refuses who may not read them, the Activity loses its note lines for them, the roster says so;
- a note filed by a holder of the notes edition below the floor is refused.
Nothing is written.

From the repo root:

    RUNNER=<scratchpad> python3 tools/test-ssa-notes-floor.py
"""
import json
import os
import subprocess
import sys

if not os.environ.get("SSA_NOTES_FLOOR_INPROC"):
    runner = os.environ["RUNNER"]
    here = os.path.join(runner, "test_ssa_notes_floor.py")
    with open(here, "w", encoding="utf-8") as fh, open(__file__, encoding="utf-8") as me:
        fh.write(me.read())
    out = subprocess.run(["sh", os.path.join(runner, "run.sh"), os.path.abspath("app"), here,
                          json.dumps({"SSA_NOTES_FLOOR_INPROC": "1"})], capture_output=True, text=True, timeout=600)
    sys.stdout.write(out.stdout[-4000:])
    sys.stderr.write(out.stderr[-2000:])
    sys.exit(1 if out.returncode or '"failed": []' not in out.stdout else 0)

import hubdb  # noqa: E402
import locations as L  # noqa: E402
import scope as sc  # noqa: E402
import ssa as S  # noqa: E402
import ssa_writes as SW  # noqa: E402

results: dict[str, str] = {}


def check(name: str, ok: bool, why: object = "") -> None:
    results[name] = "ok" if ok else f"FAIL {str(why)[:240]}"


def person(role: str, *types: str) -> dict:
    return {"id": f"u-{role}-{'-'.join(types)}", "email": f"{role}@example.org", "role": role, "types": list(types)}


db = hubdb.HubDb()
master = {"id": "u-boss", "email": sc.MASTER_ACCOUNT, "role": "admin", "types": []}
admin, supervisor, director = person("admin", "ADMIN"), person("manager", "SUPERVISOR"), person("manager", "DIRECTOR")
staff, manager = person("staff", "STAFF"), person("manager", "MANAGER")
OPEN = {"open": True, "scope": {"kind": "all"}}


def sess_with(user: dict, rule: list | None = None) -> L.Session:
    reads = L.Reads(db, None)
    base = reads.app_rules()
    rules = {k: v for k, v in (base.get("rules") or {}).items() if k != S.NOTES_FEATURE}
    if rule:
        rules[S.NOTES_FEATURE] = rule
    reads.app_rules = lambda: {**base, "rules": rules}
    return L.Session(reads, user)


check("the master reads the notes", S.notes_open(sess_with(master)))
for who, u in (("an ADMIN", admin), ("a SUPERVISOR", supervisor), ("a DIRECTOR", director)):
    check(f"no App Control row: {who} reads the notes", S.notes_open(sess_with(u), OPEN), u)
for who, u in (("a STAFF account", staff), ("a MANAGER", manager)):
    check(f"no App Control row: {who} does not", not S.notes_open(sess_with(u), OPEN), u)
check("a cut viewer never, whatever it wears",
      not S.notes_open(sess_with(director), {"open": True, "scope": {"kind": "client", "client_keys": []}}))
named = ["SUPERVISOR", "DIRECTOR"]
check("App Control's Notes row decides: an ADMIN no longer reads them",
      S.notes_open(sess_with(supervisor, named), OPEN) and not S.notes_open(sess_with(admin, named), OPEN))

act = {"items": [{"id": "note_1", "kind": "note"}, {"id": "t1", "kind": "text"}], "total": 2, "why": []}
cut = S.notes_out(act)
check("the Activity without its note lines", [i["id"] for i in cut["items"]] == ["t1"] and cut["total"] == 1, cut)

real_gate = S.gate
S.gate = lambda sess: OPEN
try:
    got = S.ssa_profile_notes(sess_with(staff), {"ssa": "ssa_anyone"})
    check("the notes door refuses a STAFF uncut viewer", got.get("message") == "Unknown action.", got)
    s = sess_with(staff)
    s.reads.config = lambda: {"mywork_editions": json.dumps([{"id": "ssa.notes", "on": True, "people": [staff["id"]]}])}
    shut = SW.note_add(s, {"ssa": "ssa_anyone", "body": "x"})
    check("a note filed by a holder of the edition below the floor is refused",
          shut.answer.get("message") == "Unknown action.", shut.answer)
finally:
    S.gate = real_gate

print(json.dumps({"results": results, "failed": [k for k, v in results.items() if v != "ok"]}, indent=1, default=str))
