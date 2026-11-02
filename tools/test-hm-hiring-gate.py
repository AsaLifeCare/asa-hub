"""The HM badge and the candidates (the operator's sheet of 2026-10-29: Staff Candidates is shut to House Managers), on
the live copy in asa-hub-db, App Control's rows laid in memory (the live rows are never asked):
- an HM-badge account (role staff) is no hiring team, records no interview and reads no candidate while App Control's
  Staff Candidates row does not name HM: candidateProfileGet answers the door's 403, candidatesList the Talent 403, and
  My Inbox names no candidate;
- the same account counts again where the row names HM (App Control decides, as for every other badge);
- the INTERVIEWER badge, the hiring roles and the master are untouched.
Nothing is written: every door asked here is a read.

From the repo root:

    RUNNER=<scratchpad> python3 tools/test-hm-hiring-gate.py
"""
import json
import os
import subprocess
import sys

if not os.environ.get("HM_HIRING_GATE_INPROC"):
    runner = os.environ["RUNNER"]
    here = os.path.join(runner, "test_hm_hiring_gate.py")
    with open(here, "w", encoding="utf-8") as fh, open(__file__, encoding="utf-8") as me:
        fh.write(me.read())
    env = {"HM_HIRING_GATE_INPROC": "1"}
    with open(os.path.join("app", "ist_config_defaults.json"), encoding="utf-8") as fh:
        env["HUB_IST_CONFIG_DECLARATION_JSON"] = fh.read()
    out = subprocess.run(["sh", os.path.join(runner, "run.sh"), os.path.abspath("app"), here, json.dumps(env)],
                         capture_output=True, text=True, timeout=600)
    sys.stdout.write(out.stdout[-4000:])
    sys.stderr.write(out.stderr[-2000:])
    sys.exit(1 if out.returncode or '"failed": []' not in out.stdout else 0)

import hiring_lists as HL  # noqa: E402
import hubdb  # noqa: E402
import interviews as IV  # noqa: E402
import locations as L  # noqa: E402
import my_inbox as MI  # noqa: E402
import scope as sc  # noqa: E402

results: dict[str, str] = {}


def check(name: str, ok: bool, why: object = "") -> None:
    results[name] = "ok" if ok else f"FAIL {str(why)[:240]}"


LEADS = ["DIRECTOR", "PLATFORMLEAD", "ADMIN", "ADMINISTRATOR", "SUPERVISOR"]
# the row as step 2 writes it (the sheet's rows 54-68), and one that names HM
SHEET = {IV.HIRING_APP: LEADS + ["INTERVIEWER"]}
NAMED = {IV.HIRING_APP: LEADS + ["INTERVIEWER", "HM"]}

db = hubdb.HubDb()


def session(user: dict, rules: dict) -> L.Session:
    reads = L.Reads(db, None)
    got = {"rules": dict(rules), "tenants": {}}
    reads.app_rules = lambda: got
    return L.Session(reads, user)


def account(uid: str, types: str, role: str = "staff") -> dict:
    return sc.user_from_row({"userid": uid, "email": f"{uid.lower()}@example.invalid", "displayname": "Test " + uid,
                             "role": role, "types": types, "permoverrides": "{}"})


def status(fn, *args) -> object:
    try:
        got = fn(*args)
    except Exception as exc:  # noqa: BLE001 - said as the result
        return type(exc).__name__
    return got.get("status") if isinstance(got, dict) else got


hm = account("T-HM", "HM")
s = session(hm, SHEET)
check("HM, row without HM: no hiring team", IV.hiring_team(hm, s.reads) is False)
check("… records no interview", IV.can_record(s.reads, hm) is False)
check("… candidateProfileGet is the door's 403", IV.candidate_profile_get(s, {"candidate_id": "CAN_TEST01"})
      == IV.DENIED, IV.candidate_profile_get(s, {"candidate_id": "CAN_TEST01"}))
check("… candidatesList is refused", status(HL.candidates_list, session(hm, SHEET), {}) == 403,
      status(HL.candidates_list, session(hm, SHEET), {}))
check("… with no reads to ask App Control, never a hiring team", IV.hiring_team(hm) is False)
check("… My Inbox names no candidate", MI.candidates_admitted("staff", "HM", False) is False)

n = session(hm, NAMED)
check("HM, row naming HM: a hiring team again", IV.hiring_team(hm, n.reads) is True)
check("… and records interviews", IV.can_record(n.reads, hm) is True)
check("… My Inbox names candidates", MI.candidates_admitted("staff", "HM", True) is True)

iv = account("T-IV", "INTERVIEWER")
check("INTERVIEWER badge: untouched by the row", IV.hiring_team(iv, session(iv, SHEET).reads) is True
      and IV.can_record(session(iv, SHEET).reads, iv) is True)
for role in ("admin", "director", "manager", "interviewer"):
    who = account(f"T-{role.upper()}", "", role)
    check(f"role {role}: a hiring team, whatever the row says", IV.hiring_team(who, session(who, {}).reads) is True)

raw_master = next((u for u in L.Reads(db, None).users() if sc.is_master_email(u.get("email"))), None)
master = sc.user_from_row(raw_master) if raw_master else None
check("the master's account is on the copy", master is not None and sc.is_real_master(master))
if master:
    got = IV.candidate_profile_get(session(master, {}), {"candidate_id": "CAN_TEST01"})
    check("the master: candidateProfileGet is never the door's 403, even with no row written",
          got != IV.DENIED, got)

print(json.dumps({"results": results, "failed": [k for k, v in results.items() if v != "ok"]}, indent=1, default=str))
