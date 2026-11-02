"""Families & Guardians' admin notes, on the app's own modules and the live App Control rules:
- with no Notes row in App Control (family-profiles.notes): an ADMIN, a SUPERVISOR and a DIRECTOR read them, a STAFF,
  MANAGER or house manager never; a row naming badges decides instead; the master always, a narrowed viewer never;
- the notes door refuses who may not read them, and the Activity loses its note lines for them alone;
- a note filed by a holder of the notes edition below the floor is refused.
Nothing is written: every write is refused before a cell is kept.

From the repo root:

    RUNNER=<scratchpad> python3 tools/test-family-notes-floor.py
"""
import json
import os
import subprocess
import sys

if not os.environ.get("FAMILY_NOTES_FLOOR_INPROC"):
    runner = os.environ["RUNNER"]
    here = os.path.join(runner, "test_family_notes_floor.py")
    with open(here, "w", encoding="utf-8") as fh, open(__file__, encoding="utf-8") as me:
        fh.write(me.read())
    out = subprocess.run(["sh", os.path.join(runner, "run.sh"), os.path.abspath("app"), here,
                          json.dumps({"FAMILY_NOTES_FLOOR_INPROC": "1"})], capture_output=True, text=True, timeout=600)
    sys.stdout.write(out.stdout[-4000:])
    sys.stderr.write(out.stderr[-2000:])
    sys.exit(1 if out.returncode or '"failed": []' not in out.stdout else 0)

import family as F  # noqa: E402
import family_writes as FW  # noqa: E402
import hubdb  # noqa: E402
import locations as L  # noqa: E402
import scope as sc  # noqa: E402

results: dict[str, str] = {}


def check(name: str, ok: bool, why: object = "") -> None:
    results[name] = "ok" if ok else f"FAIL {str(why)[:240]}"


def person(role: str, *types: str) -> dict:
    return {"id": f"u-{role}-{'-'.join(types) or 'none'}", "email": f"{role}@example.org", "role": role,
            "types": list(types)}


master = {"id": "u-boss", "email": sc.MASTER_ACCOUNT, "role": "admin", "types": []}
admin, supervisor, director = person("admin", "ADMIN"), person("manager", "SUPERVISOR"), person("manager", "DIRECTOR")
staff, manager, hm = person("staff", "STAFF"), person("manager", "MANAGER"), person("staff", "HM")
db = hubdb.HubDb()


def src_with(rule: list | None) -> sc.ScopeSources:
    """The live sources, App Control's Notes row set to `rule` (none: no row)."""
    reads = L.Reads(db, None)
    base = reads.app_rules()
    rules = {k: v for k, v in (base.get("rules") or {}).items() if k != F.NOTES_FEATURE}
    if rule:
        rules[F.NOTES_FEATURE] = rule
    reads.app_rules = lambda: {**base, "rules": rules}
    return reads.scope_sources()


# with no row in App Control: a badge from ADMIN up
bare = src_with(None)
for who, u in (("an ADMIN", admin), ("a SUPERVISOR", supervisor), ("a DIRECTOR", director)):
    check(f"no App Control row: {who} reads the notes", F.notes_open(bare, u), u)
for who, u in (("a STAFF account", staff), ("a MANAGER", manager), ("a house manager", hm)):
    check(f"no App Control row: {who} does not", not F.notes_open(bare, u), u)
# a row naming badges decides instead
named = src_with(["SUPERVISOR", "DIRECTOR"])
check("App Control's Notes row decides: SUPERVISOR and DIRECTOR named, an ADMIN no longer reads them",
      F.notes_open(named, supervisor) and F.notes_open(named, director) and not F.notes_open(named, admin),
      [F.notes_open(named, u) for u in (supervisor, director, admin)])
check("a row never opens them to a badge it does not name", not F.notes_open(named, staff))

whole = lambda u, notes: {"kind": "all", "scope": None, "user": u, "notes": notes}  # noqa: E731
check("the master reads the notes", F.notes_seen({"kind": "master", "scope": None, "user": master}))
check("a whole viewer reads them when the view says so", F.notes_seen(whole(director, True))
      and not F.notes_seen(whole(staff, False)))
check("a narrowed viewer never, whatever the view says",
      not F.notes_seen({"kind": "client", "scope": {}, "user": director, "notes": True}))
check("the roster tells each viewer whether the notes are open",
      F.view_words(whole(staff, False))["notes"] is False and F.view_words(whole(director, True))["notes"] is True)

act = {"items": [{"id": "note_1", "kind": "note"}, {"id": "sms_1", "kind": "sms"}, {"id": "note_2", "kind": "note"}],
       "total": 5, "why": [], "degraded": False}
cut = F.notes_out(act)
check("the Activity without its note lines", [i["id"] for i in cut["items"]] == ["sms_1"] and cut["total"] == 3, cut)

reads = L.Reads(db, None)
real_view_of = F.view_of
F.view_of = lambda sess: whole(sess.user, False)
try:
    got = F.family_profile_notes(L.Session(reads, staff), {"family": "fam_anyone"})
    check("the notes door refuses a STAFF whole viewer", got.get("message") == "Unknown action.", got)
    reads.config = lambda: {"mywork_editions": json.dumps([{"id": "family.notes", "on": True, "people": [staff["id"]]}])}
    shut = FW.notes_shut(L.Session(reads, staff))
    check("a note filed by a holder of the edition below the floor is refused",
          shut is not None and shut.answer.get("message") == "Unknown action.", shut and shut.answer)
finally:
    F.view_of = real_view_of

print(json.dumps({"results": results, "failed": [k for k, v in results.items() if v != "ok"]}, indent=1, default=str))
