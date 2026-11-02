"""A client's SSN, TL card number and DC expiry saved from the Hub (app/client_secrets.py), and Locations' New Incident
edition (locations.incidentsNew), on the app's own modules and asa-hub-db read live:
- each field's standard form, and what is refused;
- the master, a Platform Lead and a Director save them; a Supervisor, an Admin, a staff member never;
- the client's cell on the Asa Client Database Master is named off the sheet itself (read, never written here);
- a save keeps the value sealed — never as text — with its last four, and the profile's mask draws that last four;
- a holder of locations.incidentsNew alone opens Locations' New Incident, and never edits a report.
Nothing is written to Google, and the transaction is rolled back. The sealed sample (a test value, no client's) is printed
for the host to open with the private key, which no container holds.

From the repo root:

    RUNNER=<scratchpad> python3 tools/test-client-secrets.py
"""
import json
import os
import subprocess
import sys

if not os.environ.get("CLIENT_SECRETS_INPROC"):
    runner = os.environ["RUNNER"]
    here = os.path.join(runner, "test_client_secrets.py")
    with open(here, "w", encoding="utf-8") as fh, open(__file__, encoding="utf-8") as me:
        fh.write(me.read())
    pub = open("app/client_secrets.pub", encoding="utf-8").read()
    out = subprocess.run(["sh", os.path.join(runner, "run.sh"), os.path.abspath("app"), here,
                          json.dumps({"CLIENT_SECRETS_INPROC": "1", "CLIENT_SECRETS_PUB": pub})],
                         capture_output=True, text=True, timeout=600)
    sys.stdout.write(out.stdout[-5000:])
    sys.stderr.write(out.stderr[-2000:])
    sys.exit(1 if out.returncode or '"failed": []' not in out.stdout else 0)

import tempfile  # noqa: E402
import time  # noqa: E402
from pathlib import Path  # noqa: E402

import psycopg  # noqa: E402

import client_secrets as CSE  # noqa: E402
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


# the public key, as the app reads it beside its modules
key_file = Path(tempfile.mkdtemp()) / "client_secrets.pub"
key_file.write_text(os.environ["CLIENT_SECRETS_PUB"], encoding="utf-8")
CSE.KEY_FILE = key_file

check("an SSN in its standard form", CSE.standard("ssn", "123 45 6789") == ("123-45-6789", "6789"))
check("a card in fours", CSE.standard("tl_card", "4111-1111-1111-1111") == ("4111 1111 1111 1111", "1111"))
check("an expiry as MM/YY", CSE.standard("dc_exp", "4/2027") == ("04/27", "") and CSE.standard("dc_exp", "1129")
      == ("11/29", ""))
check("a security code and a PIN as their digits, no last four kept", CSE.standard("dc_security_code", " 123 ")
      == ("123", "") and CSE.standard("dc_pin", "0420") == ("0420", ""))
check("what is not one is refused", all(isinstance(CSE.standard(f, v), str) for f, v in (
    ("ssn", "12345678"), ("ssn", "123-45-678x"), ("tl_card", "4111"), ("dc_exp", "13/27"), ("dc_exp", "april"),
    ("dc_security_code", "12"), ("dc_security_code", "12a4"), ("dc_pin", "123"), ("dc_pin", "1234567"))))
sealed = CSE.seal("TEST-VALUE-0000")
check("a value is sealed, never kept as text", isinstance(sealed, bytes) and b"TEST-VALUE" not in sealed
      and len(sealed) == 384)
facts["sealed sample (base64, a test value)"] = __import__("base64").b64encode(sealed).decode()


def person(role: str, *types: str) -> dict:
    return {"id": f"u-{role}-{'-'.join(types)}", "email": f"{role}@example.org", "role": role, "types": list(types)}


master = {"id": "u-boss", "email": sc.MASTER_ACCOUNT, "role": "admin", "types": []}
check("the master, a Platform Lead and a Director save them",
      CSE.may_save(master) and CSE.may_save(person("admin", "PLATFORMLEAD")) and CSE.may_save(person("manager", "DIRECTOR")))
check("a Supervisor, an Admin and a staff member never", not any(CSE.may_save(u) for u in (
    person("manager", "SUPERVISOR"), person("admin", "ADMIN"), person("staff", "STAFF"))))

db = hubdb.HubDb()
hubdb.OWN.set(client_writes.Own([], book=db.book, edits=W.Store(dsn=hubdb._dsn()).edits(), edits_at=time.time()))
reads = L.Reads(db, None)
# asatech's own token, as the app holds it (/run/secrets/asatech-drive.json): the runner's credentials (drv.py CREDS)
import drive as drive_mod  # noqa: E402
owner_file = Path(tempfile.mkdtemp()) / "owner.json"
owner_file.write_text(json.dumps(CREDS), encoding="utf-8")  # noqa: F821 - drv.py's own global
owner_file.chmod(0o600)
drive_mod.OWNER_FILE = str(owner_file)
reads.drive = drive_mod.Drive()
owner_file.unlink()
pick = next((c for c in C.derived(reads) if gsjs.trim(gsjs.or_text(c.get("client_key")))
             and isinstance(CSE.master_row(reads, client_writes.client_of(reads, c["client_key"])), tuple)), None)
check("a client on the Asa Client Database Master", pick is not None)
ctx = client_writes.client_of(reads, pick["client_key"]) if pick else {}
if pick:
    for field in CSE.FIELDS:
        cell = CSE.master_cell(reads, ctx, field)
        check(f"{field}: its cell is named off the sheet itself", isinstance(cell, tuple)
              and cell[1].startswith("'Master'!"), cell)
    facts["the client's row"] = CSE.master_row(reads, ctx)[1]

owner = (f"host={os.environ['HUB_DB_HOST']} dbname={os.environ['POSTGRES_DB']} user={os.environ['POSTGRES_USER']} "
         f"password={os.environ['POSTGRES_PASSWORD']}")
conn = psycopg.connect(owner, autocommit=False)
try:
    with conn.cursor() as cur:
        cur.execute("set local search_path to app, public")
        token = W.HELD.set(cur)
        written: list = []
        real_write = CSE.write_master
        CSE.write_master = lambda r, c, f, v: written.append((f, len(v))) or ""
        try:
            sess = L.Session(L.Reads(db, None), master)
            got = CSE.secret_set(sess, {"client": pick["client_key"], "field": "ssn", "value": "987654321"})
            check("the master's save answers its last four alone", got.answer.get("status") == 200 and got.own
                  and got.answer["data"]["last4"] == "4321" and "987" not in json.dumps(got.answer), got.answer)
            cur.execute("select last4, sealed, sheet_written from app.client_secrets where client_key = %s"
                        " order by id desc limit 1", (pick["client_key"],))
            last4, kept, sheet = cur.fetchone()
            check("the table keeps it sealed with its last four", last4 == "4321" and b"987-65-4321" not in bytes(kept)
                  and len(bytes(kept)) == 384 and sheet is True)
            check("the Master's cell is written once, the value in its standard form", written == [("ssn", 11)], written)
            staff = person("staff", "STAFF")
            no = CSE.secret_set(L.Session(L.Reads(db, None), staff), {"client": pick["client_key"], "field": "ssn",
                                                                       "value": "111223333"})
            check("a staff member is refused", no.answer.get("message") == "Unknown action." and not no.own, no.answer)
        finally:
            CSE.write_master = real_write
        real_latest = CSE.latest
        CSE.latest = lambda r, k: {"ssn": "4321", "tl_card": "9999", "dc_exp": ""}
        try:
            prof = C.details_build(L.Reads(db, None), C.client_ctx(L.Reads(db, None), pick["client_key"]), strict=False)
            check("the profile's mask draws the saved last four", prof["identity"]["ssn_last4"] == "4321"
                  and prof["financial"]["tl_card_last4"] == "9999" and prof["financial"]["dc_exp_on_file"] is True,
                  [prof["identity"], prof["financial"].get("tl_card_last4")])
        finally:
            CSE.latest = real_latest
        W.HELD.reset(token)
    conn.rollback()
finally:
    conn.close()

# Locations' New Incident alone
ed = {e["id"]: e for e in E.CATALOGUE}
check("the catalogue carries locations.incidentsNew under Locations",
      ed.get("locations.incidentsNew", {}).get("app") == "locations")
house = next((h["code"] for h in reads.homes()), "")
staffer = person("staff", "STAFF")


def door_for(ids: list[str], filing: bool) -> dict:
    r = L.Reads(db, None)
    r.config = lambda: {E.EDITIONS_KEY: json.dumps([{"id": i, "on": True, "people": [staffer["id"]]} for i in ids])}
    s = L.Session(r, staffer)
    s.read_door = lambda payload: {"ctx": L.house(r, house), "scope": {"kind": "all"}}
    return W.incident_door(s, {"house": house}, W.CLIENT_INCIDENT_EDITION["file" if filing else "edit"], filing=filing)


opened = door_for(["locations.incidentsNew"], True)
check("New Incident alone opens Locations' New Incident", "ctx" in opened
      and opened.get("edition") == "locations.incidentsNew", opened.get("refused"))
check("New Incident alone never edits a report", "refused" in door_for(["locations.incidentsNew"], False))
check("no edition, no New Incident", "refused" in door_for([], True))
both = door_for(["locations.incidents"], True)
check("the open-and-edit edition still opens it, named as before", "ctx" in both and not both.get("edition"),
      both.get("refused"))

# an incident's Employees involved: every active employee, to whom its door is open
def staff_for(user: dict, ids: list[str], kind: str) -> dict:
    r = L.Reads(db, None)
    r.config = lambda: {E.EDITIONS_KEY: json.dumps([{"id": i, "on": True, "people": [user["id"]]} for i in ids])}
    s = L.Session(r, user)
    s.viewer = lambda: {"kind": kind, "house_codes": [house]}
    return L.location_incident_staff(s, {})


boss = staff_for(master, [], "master")
names = (boss.get("data") or {}).get("employees") or []
facts["active employees"] = len(names)
check("the master is answered every active employee, by name", boss.get("status") == 200 and len(names) > 5
      and all(isinstance(n, str) and n for n in names), boss)
check("a narrowed staff member who files incidents is answered the same list",
      (staff_for(staffer, ["locations.incidentsNew"], "house").get("data") or {}).get("employees") == names
      and (staff_for(staffer, [W.CLIENT_INCIDENT_EDITION["file"]], "house").get("data") or {}).get("employees") == names)
check("a narrowed staff member who files none is answered nothing",
      staff_for(staffer, [], "house").get("message") == "Unknown action.")
check("a viewer of every house is answered it", staff_for(staffer, [], "all").get("status") == 200)

print(json.dumps({"facts": facts, "results": results, "failed": [k for k, v in results.items() if v != "ok"]},
                 indent=1, default=str))
