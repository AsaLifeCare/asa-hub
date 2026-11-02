"""The Clients incident editions, opened to a badge (Settings › Editions), on the live copy in asa-hub-db.
- An edition opened to a badge is made, while its key is on, by every employee wearing that badge or one above it; a
  badge below STAFF, an unknown one or the key off opens nothing, and the save refuses a badge it does not open to.
- A STAFF employee who reads a client, holding clients.incidents by the badge alone, passes the incident door from that
  client's Incidents at the client's house; at a house the client is not at, or without the edition, they do not.
- Their edit of that client's report reaches the row (a stale witness: nothing is written); one of another client's
  reports, or moving the report to another client, is refused.
Nothing is written: every write is refused or stale before a cell is kept.

From the repo root:

    RUNNER=<scratchpad> python3 tools/test-client-incidents-editions.py
"""
import json
import os
import subprocess
import sys

if not os.environ.get("CLIENT_INCIDENT_EDITIONS_INPROC"):
    runner = os.environ["RUNNER"]
    here = os.path.join(runner, "test_client_incidents_editions.py")
    with open(here, "w", encoding="utf-8") as fh, open(__file__, encoding="utf-8") as me:
        fh.write(me.read())
    out = subprocess.run(["sh", os.path.join(runner, "run.sh"), os.path.abspath("app"), here,
                          json.dumps({"CLIENT_INCIDENT_EDITIONS_INPROC": "1"})], capture_output=True, text=True,
                         timeout=600)
    sys.stdout.write(out.stdout[-4000:])
    sys.stderr.write(out.stderr[-2000:])
    sys.exit(1 if out.returncode or '"failed": []' not in out.stdout else 0)

import time  # noqa: E402

import client_writes  # noqa: E402
import clients as C  # noqa: E402
import editions as E  # noqa: E402
import gsjs  # noqa: E402
import hubdb  # noqa: E402
import locations as L  # noqa: E402
import scope as sc  # noqa: E402
import writes as W  # noqa: E402

results: dict[str, str] = {}
facts: dict[str, object] = {}


def check(name: str, ok: bool, why: object = "") -> None:
    results[name] = "ok" if ok else f"FAIL {str(why)[:240]}"


def opened(badge: str, on: bool = True, ids: tuple = ("clients.incidents", "clients.incidentsEdit")) -> dict:
    return {E.EDITIONS_KEY: json.dumps([{"id": i, "on": on, "people": [], "badge": badge} for i in ids])}


db = hubdb.HubDb()
# the kept edits laid over the copy, as main._own lays them over every read
hubdb.OWN.set(client_writes.Own([], book=db.book, edits=W.Store(dsn=hubdb._dsn()).edits(), edits_at=time.time()))
reads = L.Reads(db, None)
raw_users = reads.users()
master = next((u for u in raw_users if gsjs.str_(u.get("email")).lower() == sc.MASTER_ACCOUNT), None)

# ---- the rule, on its own --------------------------------------------------------------------------------------------
staffers = [u for u in (sc.user_from_row(r) for r in raw_users)
            if u["role"].lower() == "staff" and not sc.is_master_email(u["email"]) and sc.wears_from(u, "STAFF")
            and not sc.wears_from(u, "HM")]
facts["STAFF-only employees"] = len(staffers)
someone = staffers[0] if staffers else None
check("there is a STAFF employee to try", someone is not None)
if someone:
    check("a key on, opened to STAFF: a STAFF employee makes it", E.allows("clients.incidents", someone, opened("STAFF")))
    check("opened to HM: a STAFF employee does not", not E.allows("clients.incidents", someone, opened("HM")))
    check("the key off: nobody but the master", not E.allows("clients.incidents", someone, opened("STAFF", on=False)))
    check("a badge it never opens to is none", not E.allows("clients.incidents", someone, opened("CLIENT"))
          and E.parse(opened("CLIENT")[E.EDITIONS_KEY])["clients.incidents"]["badge"] == "")
    acct = {**someone, "role": "client", "types": ["CLIENT", "STAFF"]}
    check("a client's account never, whatever it wears", not E.allows("clients.incidents", acct, opened("STAFF")))
view = {e["id"]: e for e in E.view(E.parse(opened("STAFF")[E.EDITIONS_KEY]))}
check("the view carries the badge", view["clients.incidents"]["badge"] == "STAFF" and view["staff.hr"]["badge"] == "")
msess = L.Session(reads, master)
got = E.editions_set(msess, {"editions": [{"id": "clients.incidents", "on": True, "people": [], "badge": "GUARDIAN"}]})
check("the save refuses a badge below STAFF, nothing saved", got.answer.get("status") == 400 and not got.edits,
      got.answer)

# ---- the door, for a STAFF employee who reads a client ---------------------------------------------------------------
cfg_open, cfg_shut = opened("STAFF"), {E.EDITIONS_KEY: ""}
roster = [c for c in C.derived(reads) if gsjs.trim(gsjs.or_text(c.get("client_key")))]
pick = None
for u in staffers[:60]:
    sess = L.Session(reads, u)
    rdr = C.reader(sess)
    if not rdr or C.own_only(rdr):
        continue
    for c in roster:
        key = gsjs.trim(gsjs.or_text(c.get("client_key")))
        code = L.house_code(gsjs.text(c.get("house"))) or L.code_of(gsjs.text(c.get("house")))
        if not code or not C.reader_for(sess, key):
            continue
        rows = C.incidents_build(reads, C.client_ctx(reads, key)).get("rows") or []
        if rows:
            pick = (u, key, code.upper(), rows)
            break
    if pick:
        break
check("a STAFF employee reads a client with incidents", pick is not None)
if pick:
    u, key, code, rows = pick
    facts["the client's incidents"] = len(rows)
    sess = L.Session(reads, u)
    sess.reads.config = lambda: cfg_shut
    door = W.incident_door(sess, {"house": code, "client": key}, "clients.incidents")
    check("without the edition the door stays shut", "refused" in door, door.get("ctx") and "opened")
    sess.reads.config = lambda: cfg_open
    door = W.incident_door(sess, {"house": code, "client": key}, "clients.incidents")
    check("opened to STAFF, the door opens at the client's house for that client",
          "ctx" in door and gsjs.or_text((door.get("client") or {}).get("client_key")) == key
          and door.get("edition") == "clients.incidents", door.get("refused"))
    other_house = next((h["code"] for h in reads.homes() if h["code"] != code), "")
    door = W.incident_door(sess, {"house": other_house, "client": key}, "clients.incidents")
    check("at a house the client is not at it is refused", (door.get("refused") or {}).get("status") in (404, 409),
          door.get("refused"))
    sess.reads.config = lambda: opened("STAFF", ids=("clients.incidents",))
    r = rows[0]
    got = W.incident_edit(sess, {"house": code, "client": key, "id": r["id"], "changes": [
        {"field": "prevention_plan", "value": "x", "expected": r["row"].get("prevention_plan", "")}]})
    check("filing alone does not edit", got.answer.get("message") == "Unknown action." and not got.edits, got.answer)
    sess.reads.config = lambda: cfg_open
    try:
        got = W.incident_edit(sess, {"house": code, "client": key, "id": r["id"], "changes": [
            {"field": "prevention_plan", "value": "x", "expected": "⁣not the cell⁣"}]})
        data = got.answer.get("data") or {}
        check("their edit of the client's report reaches the row; a stale witness keeps nothing",
              got.answer.get("status") == 409 and "prevention_plan" in (data.get("current") or {}) and not got.edits,
              got.answer)
        house = L.house(reads, code)
        mates = [c for c in house["clients"] if gsjs.or_text(c.get("client_key")) != key]
        if mates:
            got = W.incident_edit(sess, {"house": code, "client": key, "id": r["id"], "changes": [
                {"field": "client_name", "value": mates[0]["name"], "expected": r["row"].get("client_name", "")}]})
            refused = (got.answer.get("data") or {}).get("refused") or []
            check("moving the report to another client is refused", not got.edits
                  and any(x.get("field") == "client_name" for x in refused), got.answer)
            theirs = next((x for x in L.incidents_for(reads.estate("uiIncidents"), mates)), None)
            if theirs:
                got = W.incident_edit(sess, {"house": code, "client": key, "id": theirs["id"], "changes": [
                    {"field": "prevention_plan", "value": "x", "expected": "⁣not the cell⁣"}]})
                check("another client's report is refused", got.answer.get("status") == 409 and not got.edits
                      and "moved" in str(got.answer.get("message")), got.answer)
        facts["clients at the house"] = len(house["clients"])
    except W.GateHeld as held:
        check("the book-write funnel lets an edit through", False, held)

print(json.dumps({"facts": facts, "results": results,
                  "failed": [k for k, v in results.items() if v != "ok"]}, indent=1, default=str))
