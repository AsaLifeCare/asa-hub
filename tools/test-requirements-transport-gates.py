"""My Requirements and Clients › Transportation under their own App Control rows (my-profile.requirements,
client-profiles.transportation), on the live copy in asa-hub-db, the rows laid in memory as the operator writes them
before the release (the live rows are never asked):
- the master opens both, whatever the rows say, before any row is read;
- every staff badge the rows name (DIRECTOR, PLATFORMLEAD, ADMIN, ADMINISTRATOR, SUPERVISOR, HM, TEAMLEAD, STAFF) opens
  both; with no row written, only the master does; a family member (role client wearing GUARDIAN), a client, and a
  staff-role account wearing GUARDIAN alone (matched only on the SSA records) open neither;
- My Profile's answer keeps My Details and its shape where My Requirements is shut: the requirements part is said
  (not_applicable, in App Control's words) and never read;
- clientSourceTransport answers Unknown action where Transportation is shut; one client's Van Calendar board is
  refused before its lending is asked; the board with no client is untouched; Appointments' trips card
  (vehicleCalendarClientTrips) follows the row, never a family member's; a holder of clients.transportation keeps the
  tab (an edition only ever adds people);
- the Clients pack hands the transport parts only where the row opens.
TEAMLEAD is read as following nobody (scope.BADGE_FOLLOWS, the operator's rule of 2026-10-29).
Nothing is written: every door asked here is a read.

From the repo root:

    RUNNER=<scratchpad> python3 tools/test-requirements-transport-gates.py
"""
import json
import os
import subprocess
import sys

if not os.environ.get("REQS_TRANSPORT_GATES_INPROC"):
    runner = os.environ["RUNNER"]
    here = os.path.join(runner, "test_requirements_transport_gates.py")
    with open(here, "w", encoding="utf-8") as fh, open(__file__, encoding="utf-8") as me:
        fh.write(me.read())
    out = subprocess.run(["sh", os.path.join(runner, "run.sh"), os.path.abspath("app"), here,
                          json.dumps({"REQS_TRANSPORT_GATES_INPROC": "1"})], capture_output=True, text=True,
                         timeout=600)
    sys.stdout.write(out.stdout[-4000:])
    sys.stderr.write(out.stderr[-2000:])
    sys.exit(1 if out.returncode or '"failed": []' not in out.stdout else 0)

import time  # noqa: E402

import client_sources as CS  # noqa: E402
import client_writes  # noqa: E402
import clients as C  # noqa: E402
import editions as E  # noqa: E402
import gsjs  # noqa: E402
import hubdb  # noqa: E402
import locations as L  # noqa: E402
import my_profile as MP  # noqa: E402
import scope as sc  # noqa: E402
import transportation as TR  # noqa: E402
import writes as W  # noqa: E402

results: dict[str, str] = {}
facts: dict[str, object] = {}


def check(name: str, ok: bool, why: object = "") -> None:
    results[name] = "ok" if ok else f"FAIL {str(why)[:240]}"


# the sheet's lead columns: Admin and every badge above it, read off the order of access rather than spelled, so a badge
# that stands in for another (scope.BADGE_FOLLOWS) is never copied here
LEADS = list(sc.BADGE_ORDER[1:sc.BADGE_ORDER.index("ADMIN") + 1])
STAFF_SIDE = LEADS + ["HM", "TEAMLEAD", "STAFF"]
REQS_ROW = STAFF_SIDE + ["ENTITY", "MANAGER", "INTERVIEWER", "ONBOARDING"]
TRANSPORT_ROW = STAFF_SIDE + ["ENTITY", "MANAGER", "INTERVIEWER"]
RULES = {
    MP.APP_ID: REQS_ROW + ["CLIENT", "GUARDIAN"], MP.REQS_FEATURE: REQS_ROW,
    C.APP_ID: TRANSPORT_ROW + ["CLIENT", "GUARDIAN"], C.TRANSPORT_FEATURE: TRANSPORT_ROW,
}
UNRELEASED = {MP.APP_ID: RULES[MP.APP_ID], C.APP_ID: RULES[C.APP_ID]}
# the role each column's accounts sign in on
ROLE = {**{b: "admin" for b in LEADS}, "HM": "staff", "TEAMLEAD": "staff", "STAFF": "staff"}

db = hubdb.HubDb()
# the kept edits laid over the copy, as main._own lays them over every read
hubdb.OWN.set(client_writes.Own([], book=db.book, edits=W.Store(dsn=hubdb._dsn()).edits(), edits_at=time.time()))
config = dict(L.Reads(db, None).config())


def session(user: dict, rules: dict | None = None, cfg: dict | None = None) -> L.Session:
    """A fresh request's reads (every gate is read once per request), App Control's rows laid in memory."""
    reads = L.Reads(db, None)
    got = {"rules": dict(RULES if rules is None else rules), "tenants": {}}
    reads.app_rules = lambda: got
    if cfg is not None:
        reads.config = lambda: cfg
    return L.Session(reads, user)


def account(uid: str, types: str, role: str = "staff", name: str = "Test Person") -> dict:
    return sc.user_from_row({"userid": uid, "email": f"{uid.lower()}@example.invalid", "displayname": name,
                             "role": role, "types": types})


def holding(eid: str, uid: str) -> dict:
    """The config with only this edition on, listing one account by id."""
    return {**config, E.EDITIONS_KEY: json.dumps([{"id": eid, "on": True, "people": [uid], "badge": ""}])}


def unreadable() -> dict:
    raise hubdb.Unreadable("no row is read for the master")


def answer(fn, *args) -> dict:
    """A door's answer, or the name of what it raised (a read this copy cannot answer is no refusal)."""
    try:
        got = fn(*args)
    except Exception as exc:  # noqa: BLE001 - said as the result
        return {"raised": type(exc).__name__, "message": str(exc)[:160]}
    return got if isinstance(got, dict) else {"raised": type(got).__name__}


raw_users = L.Reads(db, None).users()
raw_master = next((u for u in raw_users if sc.is_master_email(u.get("email"))), None)
master = sc.user_from_row(raw_master) if raw_master else None
check("the master's account is on the copy", master is not None and sc.is_real_master(master), raw_master)
check("the sheet's five lead columns", len(LEADS) == 5 and {"DIRECTOR", "ADMINISTRATOR", "ADMIN"} <= set(LEADS), LEADS)
FAMILY = account("T-FAMILY", "GUARDIAN", "client")
CLIENT = account("T-CLIENT", "CLIENT", "client")
STAFF_GUARDIAN = account("T-SSA", "GUARDIAN", "staff")

# ---- the rules, on their own -----------------------------------------------------------------------------------------
if master:
    for name, ask in (("My Requirements", lambda s: MP.requirements_open(s.user, s.reads)),
                      ("Transportation", C.transport_open)):
        blind = L.Session(L.Reads(db, None), master)
        blind.reads.app_rules = unreadable
        check(f"{name}: the master, before any row is read", ask(blind) is True)
        check(f"{name}: the master, with no row written", ask(session(master, rules={})) is True)
for badge in STAFF_SIDE:
    who = account(f"T-{badge}", badge, ROLE[badge])
    check(f"{badge}: My Requirements opens", MP.requirements_open(who, session(who).reads) is True)
    check(f"{badge}: Transportation opens", C.transport_open(session(who)) is True)
    check(f"{badge}: before the rows are written, neither",
          not MP.requirements_open(who, session(who, rules=UNRELEASED).reads)
          and not C.transport_open(session(who, rules=UNRELEASED)))
for label, who in (("a family member", FAMILY), ("a client", CLIENT), ("a staff-role GUARDIAN wearer", STAFF_GUARDIAN)):
    check(f"{label}: neither opens", not MP.requirements_open(who, session(who).reads)
          and not C.transport_open(session(who)))
dsp = account("T-STAFF", "STAFF")
check("a holder of clients.transportation keeps Transportation with no row written",
      C.transport_open(session(dsp, rules=UNRELEASED, cfg=holding(C.TRANSPORT_EDITION, dsp["id"]))) is True)
check("… another edition opens nothing",
      not C.transport_open(session(dsp, rules=UNRELEASED, cfg=holding("clients.profile", dsp["id"]))))
check("… never a family member's", not C.transport_open(
    session(FAMILY, rules=UNRELEASED, cfg=holding(C.TRANSPORT_EDITION, FAMILY["id"]))))

# ---- My Profile's answer ---------------------------------------------------------------------------------------------
# a real staff account (its own users row, so its roster identity is read), worn with each column's badge
real = next((sc.user_from_row(u) for u in raw_users if gsjs.str_(u.get("role")).lower() == "staff"
             and "GUARDIAN" not in sc.types_from_raw(u.get("types")) and not sc.is_master_email(u.get("email"))
             and not gsjs.str_(u.get("mergedinto"))), None)
check("a staff account to read My Profile as", real is not None)


def view(user: dict, rules: dict | None = None) -> dict:
    got = answer(MP.my_profile_view, session(user, rules=rules), {})
    return got.get("data") if got.get("status") == 200 and isinstance(got.get("data"), dict) else {"refused": got}


if real:
    try:
        import my_lanes as ML  # noqa: E402
        keys = ML.PROFILE_KEYS
    except Exception as exc:  # noqa: BLE001 - the lanes cannot load here: the shape is the one they check
        keys, facts["my_lanes"] = ("scope", "person", "details", "requirements", "read_at"), type(exc).__name__
    asked: list[str] = []
    real_part = MP.requirements_part

    def counted(*args, **kw):
        asked.append("read")
        return real_part(*args, **kw)
    MP.requirements_part = counted
    try:
        for badge in ("DIRECTOR", "HM", "STAFF"):
            who = {**real, "types": [badge], "role": ROLE[badge]}
            asked.clear()
            got = view(who)
            reqs = got.get("requirements") or {}
            check(f"{badge}: My Requirements is read", asked == ["read"] and reqs.get("why") != MP.REQS_SHUT,
                  got.get("refused") or reqs.get("why"))
            asked.clear()
            got = view(who, rules=UNRELEASED)
            reqs = got.get("requirements") or {}
            check(f"{badge}: with no row written it is said, never read",
                  not asked and reqs.get("state") == MP.STATE_NOT_APPLICABLE and reqs.get("why") == MP.REQS_SHUT
                  and reqs.get("rows") == [], got.get("refused") or reqs)
            check(f"{badge}: … My Details answers, in the shape the lane checks",
                  all(k in got for k in keys) and isinstance(got.get("details"), dict), sorted(got))
        if master:
            asked.clear()
            got = view(master, rules={MP.APP_ID: RULES[MP.APP_ID]})
            check("the master's own profile reads its requirements with no row written", asked == ["read"]
                  and (got.get("requirements") or {}).get("why") != MP.REQS_SHUT, got.get("refused"))
    finally:
        MP.requirements_part = real_part

# ---- Clients › Transportation's doors --------------------------------------------------------------------------------
client_key = ""
if master:
    got = C.client_profile_roster(session(master), {})
    client_key = next((gsjs.str_(c.get("client_key")) for c in (got.get("data") or {}).get("clients") or []
                       if gsjs.str_(c.get("client_key"))), "")
check("a client to read", bool(client_key))
if client_key:
    hm = account("T-HM", "HM, STAFF")
    shut = {"status": 404, "message": "Unknown action."}
    got = answer(CS.client_source_transport, session(hm), {"client": client_key})
    check("HM: clientSourceTransport is not refused", got != shut, got)
    facts["HM's clientSourceTransport"] = got.get("status") or got.get("raised")
    got = answer(CS.client_source_transport, session(hm, rules=UNRELEASED), {"client": client_key})
    check("HM with no row written: clientSourceTransport is Unknown action", got == shut, got)
    holder = session(hm, rules=UNRELEASED, cfg=holding(C.TRANSPORT_EDITION, hm["id"]))
    got = answer(CS.client_source_transport, holder, {"client": client_key})
    check("… a holder of clients.transportation is not refused", got != shut, got)
    if master:
        got = answer(CS.client_source_transport, session(master, rules={}), {"client": client_key})
        check("the master is not refused with no row written", got != shut, got)

    lent: list[str] = []
    real_gate = TR.client_gate
    TR.client_gate = lambda sess, g, client: lent.append(client) or dict(g, open=False)
    try:
        director = account("T-DIRECTOR", "DIRECTOR", "admin")
        got = answer(TR.board_read, session(director, rules=UNRELEASED), {"client": client_key})
        check("one client's board, the row not written: refused before its lending is asked",
              got == TR.closed() and not lent, (got, lent))
        answer(TR.board_read, session(director), {"client": client_key})
        check("… the row naming the badge: its lending is asked", lent == [client_key], lent)
        lent.clear()
        answer(TR.board_read, session(director, rules=UNRELEASED), {})
        check("the board with no client is not Transportation's tab", lent == [""], lent)
    finally:
        TR.client_gate = real_gate

    got = answer(TR.client_trips, session(hm, rules=UNRELEASED), {"client": client_key})
    check("Appointments' trips card (vehicleCalendarClientTrips), the row not written: closed", got == TR.closed(), got)
    got = answer(TR.client_trips, session(hm), {"client": client_key})
    check("… the row naming the badge: the client's trips", (got or {}).get("status") == 200, got)
    real_reader = C.reader_for
    C.reader_for = lambda sess, key: {"kind": "own"}
    try:
        got = answer(TR.client_trips, session(FAMILY), {"client": client_key})
        check("… never a family member's, even on a record the Clients reader opens", got == TR.closed(), got)
    finally:
        C.reader_for = real_reader

# ---- the Clients pack ------------------------------------------------------------------------------------------------
try:
    import app_packs as AP  # noqa: E402
except Exception as exc:  # noqa: BLE001 - the relay's lanes cannot load here: said as a fact
    AP, facts["app_packs"] = None, type(exc).__name__
if AP is not None:
    hm = account("T-HM", "HM, STAFF")
    check("the pack: HM is handed the transport parts", AP._app_pack_client_transport(session(hm)) is True)
    check("the pack: with no row written they are withheld",
          AP._app_pack_client_transport(session(hm, rules=UNRELEASED)) is False)
    parts = ("details", "transport", "transport_own", "appointments")
    pack = {"status": 200, "data": {"client": "x", "parts": {p: {} for p in parts},
                                    "part_status": {p: {"status": 200} for p in parts}}}
    out = AP._app_pack_parts_out(pack, AP._APP_PACK_CLIENT_TRANSPORT_PARTS)["data"]
    kept = ["appointments", "details"]
    check("… withheld as parts and as their states, Appointments kept",
          sorted(out["parts"]) == kept and sorted(out["part_status"]) == kept, out)

print(json.dumps({"facts": facts, "results": results,
                  "failed": [k for k, v in results.items() if v != "ok"]}, indent=1, default=str))
