"""Support Requests › Incidents edits a report through Locations' own door (locationIncidentEdit, via "support-desk"),
on the live copy in asa-hub-db, App Control's rows laid in memory (the live rows are never asked):
- the master opens it, whatever the rows say; a badge opens it only where App Control names it on BOTH the Incidents
  page (support-desk.incidents) and its edit (support-desk.incidentsEdit) — the operator's "from ADMIN up";
- House Manager, Team Lead and DSP never open it; neither does a lead while either row is empty;
- the report is found by its row id, filed at its client's own house, and the Locations path is unchanged;
- a witness gone stale writes nothing.
Nothing is written: every edit sent here carries a stale witness, refused before a row is kept.

From the repo root:

    RUNNER=<scratchpad> python3 tools/test-support-incident-edit.py
"""
import json
import os
import subprocess
import sys

if not os.environ.get("SUPPORT_INCIDENT_EDIT_INPROC"):
    runner = os.environ["RUNNER"]
    here = os.path.join(runner, "test_support_incident_edit.py")
    with open(here, "w", encoding="utf-8") as fh, open(__file__, encoding="utf-8") as me:
        fh.write(me.read())
    env = {"SUPPORT_INCIDENT_EDIT_INPROC": "1"}
    with open(os.path.join("app", "ist_config_defaults.json"), encoding="utf-8") as fh:
        env["HUB_IST_CONFIG_DECLARATION_JSON"] = fh.read()
    out = subprocess.run(["sh", os.path.join(runner, "run.sh"), os.path.abspath("app"), here, json.dumps(env)],
                         capture_output=True, text=True, timeout=600)
    sys.stdout.write(out.stdout[-4000:])
    sys.stderr.write(out.stderr[-2000:])
    sys.exit(1 if out.returncode or '"failed": []' not in out.stdout else 0)

import time  # noqa: E402

import client_writes  # noqa: E402
import gsjs  # noqa: E402
import hubdb  # noqa: E402
import locations as L  # noqa: E402
import scope as sc  # noqa: E402
import writes as W  # noqa: E402

results: dict[str, str] = {}
facts: dict[str, object] = {}


def check(name: str, ok: bool, why: object = "") -> None:
    results[name] = "ok" if ok else f"FAIL {str(why)[:240]}"


LEADS = ["PLATFORMLEAD", "DIRECTOR", "SUPERVISOR", "ADMINISTRATOR", "ADMIN"]
BOTH = {W.SUPPORT_APP: LEADS, W.SUPPORT_INCIDENTS_PAGE: LEADS, W.SUPPORT_INCIDENTS_EDIT: LEADS}

db = hubdb.HubDb()
hubdb.OWN.set(client_writes.Own([], book=db.book, edits=W.Store(dsn=hubdb._dsn()).edits(), edits_at=time.time()))


def session(user: dict, rules: dict) -> L.Session:
    reads = L.Reads(db, None)
    got = {"rules": dict(rules), "tenants": {}}
    reads.app_rules = lambda: got
    return L.Session(reads, user)


def account(uid: str, types: str, role: str = "staff", denials: str = "") -> dict:
    return sc.user_from_row({"userid": uid, "email": f"{uid.lower()}@example.invalid", "displayname": "Test " + uid,
                             "role": role, "types": types, "appdenials": denials})


UNKNOWN = L.unknown()
reads = L.Reads(db, None)
rows = reads.estate("uiIncidents")
clients = reads.client_rows()
homes = reads.homes()


def house_of(row: dict) -> list[str]:
    k = gsjs.name_key(row.get("client_name"))
    named = [c for c in clients if k and gsjs.name_key(c.get("name")) == k]
    return L.viewer_houses_from([c.get("client_key") for c in named], clients, homes) or \
        sorted({L.house_code(c.get("house")) for c in named} - {""})


placed = next((r for r in reversed(rows) if r.get("timestamp") and len(house_of(r)) == 1), None)
loose = next((r for r in rows if r.get("timestamp") and r.get("client_name") and len(house_of(r)) != 1), None)
facts["reports"] = len(rows)
check("a report whose client is at one house", placed is not None)

raw_master = next((u for u in reads.users() if sc.is_master_email(u.get("email"))), None)
master = sc.user_from_row(raw_master) if raw_master else None
check("the master's account is on the copy", master is not None and sc.is_real_master(master))

def opened(r: dict) -> dict:
    """The call the panel makes for a report it opened: its row id, its filing instant and its client."""
    return {"id": r["id"], "filed": r.get("timestamp") or "", "named": r.get("client_name") or ""}


if placed and master:
    rid, code = placed["id"], house_of(placed)[0]
    ask = opened(placed)
    door = W.support_incident_door(session(master, {}), ask)
    check("the master opens it with no row written, at the report's own house",
          not door.get("refused") and door["ctx"]["code"] == code and door["master"] is True, door.get("refused"))
    for b in LEADS:
        d = W.support_incident_door(session(account(f"T-{b}", b), BOTH), ask)
        check(f"{b}: opens it where the three rows name the badge", not d.get("refused") and d["ctx"]["code"] == code,
              d.get("refused"))
    lead = account("T-ADMIN", "ADMIN", "admin")
    for gone, label in ((W.SUPPORT_INCIDENTS_PAGE, "the page's"), (W.SUPPORT_INCIDENTS_EDIT, "the edit's"),
                        (W.SUPPORT_APP, "Support Requests'")):
        rules = {k: v for k, v in BOTH.items() if k != gone}
        check(f"a lead while {label} row is empty: refused",
              W.support_incident_door(session(lead, rules), ask).get("refused") == UNKNOWN)
    denied = account("T-DENIED", "ADMIN", "admin", json.dumps([W.SUPPORT_APP]))
    check("a lead App Control removed Support Requests from: refused",
          W.support_incident_door(session(denied, BOTH), ask).get("refused") == UNKNOWN)
    for b in ("HM", "TEAMLEAD", "STAFF"):
        d = W.support_incident_door(session(account(f"T-{b}", b), BOTH), ask)
        check(f"{b}: never opens it", d.get("refused") == UNKNOWN, d.get("refused"))
    check("a row id that is not one: 400", W.support_incident_door(session(master, {}), {"id": "INC-1"})
          .get("refused", {}).get("status") == 400)
    check("a row the book does not hold: 404", W.support_incident_door(session(master, {}), {"id": "r999999"})
          .get("refused", {}).get("status") == 404)
    # the report the panel opened, witnessed: a row that moved under its number is refused, the master's too
    for label, bad in (("another filing instant", {**ask, "filed": "01/01/2001 00:00:00"}),
                       ("another client", {**ask, "named": "Not This Client"}), ("no witness", {"id": rid})):
        d = W.support_incident_door(session(master, {}), bad)
        check(f"a row that moved ({label}): 409, nothing written", d.get("refused", {}).get("status") == 409,
              d.get("refused"))
    if loose:
        d = W.support_incident_door(session(master, {}), opened(loose))
        check("a report whose client is at no single house: 409, nothing written",
              d.get("refused", {}).get("status") == 409, d.get("refused"))
    else:
        facts["no single house"] = "no such report on the copy"

    # the whole door, a stale witness: refused before anything is kept
    stale = {**ask, "via": "support-desk",
             "changes": [{"field": "summary_of_incident", "value": "x", "expected": "NOT WHAT THE ROW HOLDS"}]}
    try:
        out = W.incident_edit(session(lead, BOTH), stale)
        ans = out.answer
        check("a stale witness: 409 and nothing kept", ans.get("status") == 409 and not out.edits, ans)
    except W.GateHeld as held:
        facts["stale witness"] = f"the write funnel holds every write here: {held}"
    move = {**ask, "via": "support-desk",
            "changes": [{"field": "client_name", "value": "Someone Else", "expected": placed.get("client_name") or ""}]}
    try:
        out = W.incident_edit(session(lead, BOTH), move)
        said = (out.answer.get("data") or {}).get("refused") or []
        check("a client change from Support Requests: refused for that field, nothing kept",
              any(r.get("field") == "client_name" for r in said) and not out.edits, out.answer)
    except W.GateHeld as held:
        facts["client change"] = f"the write funnel holds every write here: {held}"
    hm = account("T-HM", "HM")
    out = W.incident_edit(session(hm, BOTH), stale)
    check("HM through the whole door: Unknown action, nothing kept", out.answer == UNKNOWN and not out.edits,
          out.answer)
    # the Locations path is Locations' own still: an HM with no Locations edition is refused there
    out = W.incident_edit(session(hm, BOTH), {**stale, "via": "", "house": code})
    check("the Locations path is unchanged (its own edition decides)", out.answer == UNKNOWN, out.answer)

print(json.dumps({"facts": facts, "results": results, "failed": [k for k, v in results.items() if v != "ok"]},
                 indent=1, default=str))
