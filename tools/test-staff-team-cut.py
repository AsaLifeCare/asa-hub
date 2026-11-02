"""Staff's Whole team row and its split tabs (App Control's staff-profiles.* rows), on the live copy in asa-hub-db, the
rows themselves laid in memory as the operator writes them before the release (the live rows are never asked):
- the master opens everything, whatever the rows say, before any row is read;
- a badge the Whole team row names (DIRECTOR, PLATFORMLEAD, ADMIN, ADMINISTRATOR, SUPERVISOR) reads every staff member;
- House Manager, Team Lead and DSP read their own profile alone: another staff member's key is refused with Staff's
  own 403 and words on Staff's doors, on Scheduling's via=staff shifts and on the vehicle calendar's staff trips, and
  their own key is not; the certificate ledger's review edition makes none of them a whole-ledger reader;
- Performance, HR Admin, Employee Pay and Activity are refused to HM, TL and DSP — their own profile's too — and open
  to DIRECTOR, ADMIN and SUPERVISOR; a staff.hr holder opens HR Admin alone; a payment on someone else's loan needs
  Employee Pay, the person's own loan does not;
- the team's Staff pack is the whole team's, and carries Activity's parts only where that row opens.
TEAMLEAD is read as following nobody (scope.BADGE_FOLLOWS, the operator's rule of 2026-10-29).
Nothing is written: the audited and logged reads are never asked open, and a payment is refused before a row is kept.

From the repo root:

    RUNNER=<scratchpad> python3 tools/test-staff-team-cut.py
"""
import json
import os
import subprocess
import sys

if not os.environ.get("STAFF_TEAM_CUT_INPROC"):
    runner = os.environ["RUNNER"]
    here = os.path.join(runner, "test_staff_team_cut.py")
    with open(here, "w", encoding="utf-8") as fh, open(__file__, encoding="utf-8") as me:
        fh.write(me.read())
    out = subprocess.run(["sh", os.path.join(runner, "run.sh"), os.path.abspath("app"), here,
                          json.dumps({"STAFF_TEAM_CUT_INPROC": "1"})], capture_output=True, text=True, timeout=600)
    sys.stdout.write(out.stdout[-4000:])
    sys.stderr.write(out.stderr[-2000:])
    sys.exit(1 if out.returncode or '"failed": []' not in out.stdout else 0)

import time  # noqa: E402

import cert_docs as CD  # noqa: E402
import client_writes  # noqa: E402
import editions as E  # noqa: E402
import employee_loans_writes as ELW  # noqa: E402
import gsjs  # noqa: E402
import hubdb  # noqa: E402
import locations as L  # noqa: E402
import scheduling as SCH  # noqa: E402
import scope as sc  # noqa: E402
import staff as SP  # noqa: E402
import staff_comms as SC  # noqa: E402
import staff_perf as SPF  # noqa: E402
import staff_writes as SW  # noqa: E402
import transportation as TR  # noqa: E402
import writes as W  # noqa: E402

results: dict[str, str] = {}
facts: dict[str, object] = {}


def check(name: str, ok: bool, why: object = "") -> None:
    results[name] = "ok" if ok else f"FAIL {str(why)[:240]}"


LEADS = ["DIRECTOR", "PLATFORMLEAD", "ADMIN", "ADMINISTRATOR", "SUPERVISOR"]
OWN_ONLY = ["HM", "TEAMLEAD", "STAFF"]
RULES = {
    SP.APP_ID: LEADS + OWN_ONLY,
    SP.TEAM_FEATURE: LEADS,
    SP.PERFORMANCE_FEATURE: LEADS, SP.HR_FEATURE: LEADS, SP.PAY_FEATURE: LEADS, SP.ACTIVITY_FEATURE: LEADS,
}
TABS = (SP.PERFORMANCE_FEATURE, SP.HR_FEATURE, SP.PAY_FEATURE, SP.ACTIVITY_FEATURE)
REFUSED = SP.unknown()
OWN_REFUSAL = {"status": 403, "message": SP.OWN_ONLY_WORDS}

db = hubdb.HubDb()
# the kept edits laid over the copy, as main._own lays them over every read
hubdb.OWN.set(client_writes.Own([], book=db.book, edits=W.Store(dsn=hubdb._dsn()).edits(), edits_at=time.time()))
config = dict(L.Reads(db, None).config())


def editions_cfg(*held: tuple[str, str]) -> dict:
    """The config with only these editions on, each listing one account by id."""
    return {**config, E.EDITIONS_KEY: json.dumps([{"id": eid, "on": True, "people": [uid], "badge": ""}
                                                   for eid, uid in held])}


def session(user: dict, rules: dict | None = None, cfg: dict | None = None) -> L.Session:
    """A fresh request's reads (every gate is read once per request), App Control's rows laid in memory."""
    reads = L.Reads(db, None)
    got = {"rules": dict(RULES if rules is None else rules), "tenants": {}}
    reads.app_rules = lambda: got
    if cfg is not None:
        reads.config = lambda: cfg
    return L.Session(reads, user)


def account(uid: str, name: str, types: str, role: str = "staff") -> dict:
    return sc.user_from_row({"userid": uid, "email": f"{uid.lower()}@example.invalid", "displayname": name,
                             "role": role, "types": types})


def status(fn, *args) -> object:
    """A door's status, or the name of what it raised (a read this copy cannot answer is no refusal)."""
    try:
        got = fn(*args)
    except Exception as exc:  # noqa: BLE001 - said as the result
        return type(exc).__name__
    got = got.answer if isinstance(got, W.Decision) else got
    return got.get("status") if isinstance(got, dict) else got


raw_master = next((u for u in L.Reads(db, None).users() if sc.is_master_email(u.get("email"))), None)
master = sc.user_from_row(raw_master) if raw_master else None
check("the master's account is on the copy", master is not None and sc.is_real_master(master), raw_master)

# ---- the people tried: two staff members whose roster key is their folded name ---------------------------------------
staff = []
if master:
    got = SP.staff_profile_roster(session(master), {})
    staff = [r for r in (got.get("data") or {}).get("staff") or []
             if r.get("status") == "active" and not r.get("ambiguous") and SP.fold(r.get("name")) == r.get("key")]
facts["active staff with a plain key"] = len(staff)
check("two staff members to try", len(staff) >= 2, len(staff))
mine, theirs = (staff[0], staff[1]) if len(staff) >= 2 else ({"key": "", "name": ""}, {"key": "", "name": ""})
own, other = mine["key"], theirs["key"]

# ---- the master ------------------------------------------------------------------------------------------------------
if master:
    ms = session(master)
    check("the master sees the team, every tab", SP.sees_team(ms) and SP.own_only(ms) is None
          and all(SP.tab_open(ms, f) for f in TABS))
    blind = L.Session(L.Reads(db, None), master)

    def unreadable() -> dict:
        raise hubdb.Unreadable("no row is read for the master")
    blind.reads.app_rules = unreadable
    check("… before any row is read", SP.sees_team(blind) and all(SP.tab_open(blind, f) for f in TABS))
    check("… and with no row written", all(SP.tab_open(session(master, rules={}), f) for f in TABS)
          and SP.sees_team(session(master, rules={})))

# ---- a badge on the Whole team row -----------------------------------------------------------------------------------
for badge in LEADS:
    lead = account(f"T-{badge}", "Test " + badge.title(), badge)
    ls = session(lead)
    got = SP.staff_profile_roster(ls, {})
    keys = [r.get("key") for r in (got.get("data") or {}).get("staff") or []]
    check(f"{badge}: the whole team", SP.own_only(ls) is None and own in keys and other in keys
          and not (got.get("data") or {}).get("may", {}).get("own_only"), keys[:5])
    check(f"{badge}: every tab", all(SP.tab_open(session(lead), f) for f in TABS))
    check(f"{badge}: another person's record opens", "refused" not in SP.person_for(session(lead), other))
    shut = session(lead, rules={**RULES, SP.TEAM_FEATURE: []})
    check(f"{badge}: with no Whole team row written, their own profile alone",
          SP.own_only(shut) == SP.fold(lead["display_name"]))

# ---- House Manager, Team Lead, DSP: their own profile alone --------------------------------------------------------
for badge in OWN_ONLY:
    me = account(f"T-{badge}", mine["name"], badge)
    s = session(me)
    check(f"{badge}: their own profile alone", SP.own_only(s) == own and not SP.sees_team(s), SP.own_only(s))
    got = SP.staff_profile_roster(session(me), {})
    rows = (got.get("data") or {}).get("staff") or []
    check(f"{badge}: the roster is their own row", [r.get("key") for r in rows] == [own]
          and (got.get("data") or {}).get("may", {}).get("own_only") is True, [r.get("key") for r in rows][:5])
    for door in (SP.staff_profile_overview, SP.staff_profile_compliance, SP.staff_profile_preferences,
                 SP.staff_profile_actions, SC.staff_profile_documents, SC.staff_profile_notes):
        check(f"{badge}: {door.__name__} refuses another's key in Staff's words",
              door(session(me), {"staff": other}) == OWN_REFUSAL)
    check(f"{badge}: their own overview opens", status(SP.staff_profile_overview, session(me), {"staff": own}) == 200)
    shifts = SCH.staff_shifts(session(me), {"via": "staff", "person": other})
    check(f"{badge}: Staff's Calendar shifts (via=staff) refuse another's key", shifts == OWN_REFUSAL, shifts)
    check(f"{badge}: … their own are read",
          status(SCH.staff_shifts, session(me), {"via": "staff", "person": own}) == 200)
    trips = TR.staff_trips(session(me), {"person": other})
    check(f"{badge}: Calendar's staff trips refuse another's key", trips == OWN_REFUSAL, trips)
    check(f"{badge}: … their own are read", status(TR.staff_trips, session(me), {"person": own}) == 200)
    review = editions_cfg((CD.EDITION, me["id"]))
    check(f"{badge}: the review edition makes no whole-ledger reader", not CD.holder(session(me, cfg=review))
          and not CD.sees_all(session(me, cfg=review)))
    lead = account("T-DIRECTOR", "Test Director", "DIRECTOR")
    check(f"… while the same review edition makes a Director one (the control for {badge})",
          CD.holder(session(lead, cfg=editions_cfg((CD.EDITION, lead["id"])))))
    # the split tabs, on their own profile too
    check(f"{badge}: no split tab opens", not any(SP.tab_open(session(me), f) for f in TABS))
    for door in (SP.staff_profile_hr, SP.staff_profile_activity, SC.staff_profile_shifts, SC.staff_profile_texts,
                 SC.staff_profile_transcripts, SPF.staff_profile_performance):
        check(f"{badge}: {door.__name__} refuses their own key", door(session(me), {"staff": own}) == REFUSED)
    check(f"{badge}: staffProfileTranscript refuses their own key",
          SC.staff_profile_transcript(session(me), {"staff": own, "call_id": "C1"}) == REFUSED)
    check(f"{badge}: employeeLoanList refuses their own key",
          SPF.employee_loan_list(session(me), {"staff": own}) == SPF.el_unknown())
    hr = session(me, cfg=editions_cfg(("staff.hr", me["id"])))
    check(f"{badge}: a staff.hr holder opens HR Admin, and only HR Admin",
          SP.tab_open(hr, SP.HR_FEATURE, SP.HR_EDITIONS)
          and not any(SP.tab_open(hr, f) for f in (SP.PERFORMANCE_FEATURE, SP.PAY_FEATURE, SP.ACTIVITY_FEATURE)))
    perf = session(me, cfg=editions_cfg(("staff.documentation", me["id"])))
    check(f"{badge}: a staff.documentation holder opens Performance, and only Performance",
          SP.tab_open(perf, SP.PERFORMANCE_FEATURE, SP.PERF_EDITIONS)
          and not any(SP.tab_open(perf, f) for f in (SP.HR_FEATURE, SP.PAY_FEATURE, SP.ACTIVITY_FEATURE)))
    # a note's state or text: the note's person as Staff opens them, refused before any row is read
    notes = session(me, cfg=editions_cfg((SP.EDITION_NOTES, me["id"]), (SP.EDITION_NOTES_EDIT, me["id"])))
    for door, body in ((SW.note_state, {"id": "SN_T", "state": "resolved", "staff": other}),
                       (SW.note_edit, {"id": "SN_T", "staff": other, "details": "x"})):
        got = status(door, notes, body)
        said = door(notes, body).answer if got == 403 else got
        check(f"{badge}: {door.__name__} refuses another's note in Staff's words", said == OWN_REFUSAL, said)

# ---- the split tabs open to the leads (only the doors that read; the audited and logged ones are never asked) -------
for badge in ("DIRECTOR", "ADMIN", "SUPERVISOR"):
    lead = account(f"T-{badge}", "Test " + badge.title(), badge)
    for door in (SP.staff_profile_activity, SC.staff_profile_shifts, SC.staff_profile_transcripts):
        got = status(door, session(lead), {"staff": other})
        check(f"{badge}: {door.__name__} opens another's record", got == 200, got)
    got = status(SPF.employee_loan_list, session(lead), {"staff": other})
    check(f"{badge}: employeeLoanList opens another's record", got == 200, got)
    if got == 200:
        pay = SPF.employee_loan_list(session(lead), {"staff": other})
        check(f"{badge}: … the whole record (the sheet opens Employee Pay whole)", pay["data"].get("full") is True, pay)
    # a badge none of them wears, nor follows (SUPERVISOR stands for DIRECTOR, never the other way)
    narrow = session(lead, rules={**RULES, SP.ACTIVITY_FEATURE: ["PLATFORMLEAD"]})
    check(f"{badge}: an Activity row that does not name them shuts Activity",
          SP.staff_profile_activity(narrow, {"staff": other}) == REFUSED)

# ---- a payment: someone else's loan needs Employee Pay, the person's own does not -----------------------------------
try:
    loans = [r for r in ELW._rows(L.Reads(db, None)) if r["kind"] == "loan" and r["staff_uid"]]
except Exception as exc:  # noqa: BLE001 - no loans house: said as a fact
    loans, facts["loans"] = [], type(exc).__name__
facts["loans with an account"] = len(loans)
if loans:
    ln = loans[0]
    # a staff key that is never the loan's: refused 409 past the gate, before any row is kept
    pay = {"loan_id": ln["id"], "amount": "1.00", "date": "2026-10-29", "method": "manual", "staff": "zzznotthisone"}
    hm = account("T-HM", mine["name"], "HM")
    got = ELW.payment(session(hm), dict(pay)).answer
    check("a house manager is refused a payment on someone else's loan", got == SPF.el_unknown(), got)
    got = ELW.payment(session(account("T-DIRECTOR", "Test Director", "DIRECTOR")), dict(pay)).answer
    check("a director passes the gate (refused only for the wrong staff key)", got.get("status") == 409, got)
    owner = sc.user_from_row({"userid": ln["staff_uid"], "email": "owner@example.invalid", "displayname": "Loan Owner",
                              "role": "staff", "types": "STAFF"})
    got = ELW.payment(session(owner), dict(pay)).answer
    check("the person's own loan passes the gate without Employee Pay (My Profile)", got.get("status") == 409, got)

# ---- the team's Staff pack ------------------------------------------------------------------------------------------
try:
    import app_packs as AP  # noqa: E402
except Exception as exc:  # noqa: BLE001 - the relay's lanes cannot load here: said as a fact
    AP, facts["app_packs"] = None, type(exc).__name__
if AP is not None:
    hm = account("T-HM", mine["name"], "HM")
    director = account("T-DIRECTOR", "Test Director", "DIRECTOR")
    check("the team pack: a house manager is refused", AP._app_pack_staff_view(session(hm))["team"] is False)
    check("the team pack: a director reads it whole, Activity's parts too",
          AP._app_pack_staff_view(session(director)) == {"team": True, "activity": True})
    cut = AP._app_pack_staff_view(session(director, rules={**RULES, SP.ACTIVITY_FEATURE: ["PLATFORMLEAD"]}))
    check("the team pack: Activity's parts withheld where its row does not name the reader",
          cut == {"team": True, "activity": False}, cut)
    pack = {"status": 200, "data": {"parts": {"overview": {}, "activity": {}, "shifts": {}, "notes": {}},
                                    "part_status": {p: {"status": 200} for p in ("overview", "activity", "shifts")}}}
    out = AP._app_pack_parts_out(pack, AP._APP_PACK_STAFF_ACTIVITY_PARTS)["data"]
    check("… withheld as parts and as their states", sorted(out["parts"]) == ["notes", "overview"]
          and sorted(out["part_status"]) == ["overview"], out)

print(json.dumps({"facts": facts, "results": results,
                  "failed": [k for k, v in results.items() if v != "ok"]}, indent=1, default=str))
