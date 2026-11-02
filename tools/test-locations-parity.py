#!/usr/bin/env python3
"""Locations on Python against Locations on Apps Script: scope.py's rules here, then each house of the relay's kept packs."""
from __future__ import annotations

import argparse
import base64
import json
import re
import shutil
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "app"
MODULES = ("gsjs", "hubdb", "scope", "drive", "locations", "writes")
PACK_DIR = "/srv/app-packs"
RELAY = "asa-hub-snapshot"
RUNNERS = ("asa-hub-app", "asa-hub-db-sync")
# the parts no Drive read stands behind; guidebook and documents need the asatech credentials
DB_PARTS = ("overview", "staff", "notes", "supplies", "repairs", "incidents")
VIEW_PARTS = ("scope", "overview", "staff", "incidents")
ISO = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$")
NY = ZoneInfo("America/New_York")
# precision: the copy keeps a date-time cell to the second; count and newer: punches and calendar rows since the read
EXPLAINED = ("precision", "count", "newer")

results = {"ok": 0, "failed": []}


def check(name: str, ok: bool, detail: Any = None) -> None:
    if ok:
        results["ok"] += 1
        print(f"  ok   {name}")
    else:
        results["failed"].append(name)
        print(f"  FAIL {name}")
        if detail is not None:
            print(f"       {str(detail)[:400]}")


# ---- scope.py, without a database -----------------------------------------------------------------------------

def unit_scope() -> None:
    sys.path.insert(0, str(APP))
    import gsjs  # noqa: PLC0415
    import locations as loc  # noqa: PLC0415
    import scope as sc  # noqa: PLC0415

    print("scope.py — badges")
    check("badges are the known words once, in the order written; the role is worn as one",
          sc.types_from_raw("staff, ADMIN; nope|staff") == ["STAFF", "ADMIN"]
          and sc.badges_worn("STAFF", "manager") == ["STAFF", "MANAGER"])
    followers = [b for b, stands in sc.BADGE_FOLLOWS.items() if stands == "DIRECTOR"]
    check("each badge HUB_BADGE_FOLLOWS stands for DIRECTOR also wears DIRECTOR, once",
          sc.badges_worn(", ".join(followers), "") == [*followers, "DIRECTOR"] if followers else True)

    master = {"id": "u-boss", "email": " ASATECH@asalifecare.com ", "role": "admin", "types": [], "app_denials": []}
    print("scope.py — the master")
    check("the master is the admin session of the one account", sc.is_real_master(master))
    check("…never during a visit, never the service, never another role",
          not sc.is_real_master({**master, "visiting_member": "m1"}) and not sc.is_real_master({**master, "is_service": True})
          and not sc.is_real_master({**master, "role": "manager"}))

    def sources(rules: dict, tenants: dict | None = None, config: dict | None = None, houses: dict | None = None):
        return sc.ScopeSources(users=lambda: [], rules=lambda: {"rules": rules, "tenants": tenants or {}},
                               config=lambda: config or {},
                               houses_of=lambda keys: houses or {"codes": ["ABD1305"], "why": []})

    released = {"locations": ["STAFF", "CLIENT", "GUARDIAN", "MANAGER"]}
    staff = {"id": "u-ann", "email": "ann@example.org", "role": "staff", "types": ["STAFF"], "app_denials": [],
             "client_key": "", "home_tenant": ""}
    client = {"id": "u-kay", "email": "kay@example.org", "role": "client", "types": ["CLIENT"], "app_denials": [],
              "client_key": "kay_test", "home_tenant": ""}
    print("scope.py — hubProfileAppGate_('locations')")
    gate = sc.profile_app_gate("locations", master, sources({}))
    check("the master opens it with no row at all", gate["open"] and gate["scope"]["kind"] == "master")
    gate = sc.profile_app_gate("locations", staff, sources(released))
    check("a released wide badge reads every house", gate["open"] and gate["scope"]["kind"] == "all")
    gate = sc.profile_app_gate("locations", staff, sources({}))
    check("no row: the master's alone, said so",
          not gate["open"] and "master's alone" in gate["scope"]["why"])
    gate = sc.profile_app_gate("locations", {**staff, "app_denials": ["locations"]}, sources(released))
    check("an app App Control took off this account stays shut", not gate["open"] and "removed" in gate["scope"]["why"])
    cut = {"mywork_hide_apps": "houses, locations", "mywork_hide_apps_seen": ""}
    check("the master's app list keeps it to the master's own session…",
          not sc.profile_app_gate("locations", staff, sources(released, config=cut))["open"])
    check("…unless the account is on the seen list",
          sc.profile_app_gate("locations", staff, sources(released, config={**cut, "mywork_hide_apps_seen": "u-ann"}))["open"])
    check("an account whose home tenant the app is not installed for is refused",
          not sc.profile_app_gate("locations", {**staff, "home_tenant": "fr-1"},
                                  sources(released, tenants={"locations": ["hq"]}))["open"])
    check("a badge the row does not release is not open",
          not sc.profile_app_gate("locations", {**staff, "types": ["INTERVIEWER"], "role": "interviewer"},
                                  sources(released))["open"])
    gate = sc.profile_app_gate("locations", client, sources(released))
    check("a CLIENT reads its own record's houses alone",
          gate["open"] and gate["scope"]["kind"] == "client" and gate["scope"]["client_keys"] == ["kay_test"]
          and gate["scope"]["house_codes"] == ["ABD1305"], gate)
    gate = sc.profile_app_gate("locations", {**client, "types": ["CLIENT", "STAFF"]}, sources(released))
    check("…and a client account stays narrowed whatever else it wears", gate["scope"]["kind"] == "client", gate)
    gate = sc.profile_app_gate("locations", {**client, "client_key": ""}, sources(released))
    check("a client account linked to no client is shown nothing, said so",
          not gate["open"] and "not linked to a client" in gate["scope"]["why"])
    try:
        sc.profile_app_gate("locations", {**staff, "types": ["GUARDIAN"], "role": "staff"}, sources(released))
        deferred = False
    except sc.Defer:
        deferred = True
    check("an SSA or a family member is Apps Script's to scope (the SSA records are not ported)", deferred)
    gate = sc.profile_app_gate("locations", {**staff, "types": ["GUARDIAN", "STAFF"]}, sources(released))
    check("…but a staff member who also wears GUARDIAN reads every house first, as ViewerScope.gs orders it",
          gate["scope"]["kind"] == "all")

    print("scope.py — editions")
    stored = json.dumps([{"id": "locations.house", "on": True, "people": ["u-ann", "u-ann"]},
                         {"id": "locations.notesAny", "on": False, "people": ["u-ann"]},
                         {"id": "nope", "on": True, "people": ["u-ann"]}])
    cfg = {sc.EDITIONS_KEY: stored}
    check("the master makes every one", len(sc.editions_for(master, "locations", cfg)) == 6)
    check("a person makes an edition whose key is on and whose list names them",
          sc.editions_for(staff, "locations", cfg) == ["locations.house"])
    check("a client makes none, whatever a list says",
          sc.editions_for({**client, "id": "u-ann"}, "locations", cfg) == [])
    check("a stored list that is not a list opens nothing", sc.editions_for(staff, "locations", {sc.EDITIONS_KEY: "{x"}) == [])
    check("the viewer window is the property when it is 1 to 366, else 30",
          sc.viewer_days("45") == 45 and sc.viewer_days("0") == 30 and sc.viewer_days("abc") == 30)

    print("locations.py and gsjs.py — the port's pure rules")
    check("a house code, and the code a label ends in",
          loc.house_code(" abd1305 ") == "ABD1305" and loc.code_of("CAN - 47TH - ABD4708 ") == "ABD4708"
          and loc.house_code("ABD1305x") == "")
    a = loc.addr("4060 Orchard Dale Dr NW, Apt B, Canton")
    check("an address is its street key, unit and house number", a == {"key": "4060orcharddaledrnw", "unit": "b", "num": "4060"}, a)
    index = {"MS4060": [loc.addr("4060 Orchard Dale Dr NW")], "MS4061": [loc.addr("4061 Orchard Dale Dr NW")]}
    shared = {**index, "EC4060": [loc.addr("4060 Mill St")]}
    check("a repair's street finds its one house, a lone house number falls back to it, a shared one finds none",
          loc.addr_owner(index, "4060 Orchard Dale Dr NW, Canton")["code"] == "MS4060"
          and loc.addr_owner(index, "4060 Elsewhere")["how"] == "street_number"
          and loc.addr_owner(shared, "4060 Elsewhere")["code"] == "")
    check("categories split on commas outside parentheses",
          loc.categories("Fall, Injury (minor, bruise), Other") == ["Fall", "Injury (minor, bruise)", "Other"])
    fig = loc.supply_item([{"kind": "delivery", "qty": 10.0, "on_hand_after": 12.0, "at": "2026-10-01T00:00:00Z"},
                           {"kind": "count", "qty": 6.0, "on_hand_after": None, "at": "2026-10-04T00:00:00Z"},
                           {"kind": "par", "qty": 8.0, "on_hand_after": None, "at": "2026-09-01T00:00:00Z"}], 7)
    check("a consumable's figures: 6 used over 3 days, 3 days of cover, order now",
          fig["consumption"] == 6 and fig["rate_per_day"] == 2 and fig["days_of_cover"] == 3 and fig["status"] == "order_now", fig)
    check("Date.parse and toISOString as Apps Script's V8 does them",
          gsjs.date_parse("2026-10-07") == 1791331200000.0 and gsjs.when("not a date") == 0.0
          and gsjs.iso(datetime(2026, 10, 7, 4, tzinfo=timezone.utc)) == "2026-10-07T04:00:00.000Z")
    names = sorted(["de Lima", "Davis", "Álvaro", "adams", "Zed"], key=loc.by_name(lambda x: x))
    check("names sort as localeCompare does: case and accents only break ties", names == ["adams", "Álvaro", "Davis", "de Lima", "Zed"], names)

    import hubdb  # noqa: PLC0415
    print("hubdb.py — the copy's text back to what getValues() hands Apps Script")
    est = lambda s: hubdb.estate_cell(hubdb.typed(s, "estate"))  # noqa: E731
    check("a form's timestamp and a date cell are instants (to the second the copy keeps)",
          est("8/26/2026 8:59:16") == "2026-08-26T12:59:16.000Z" and est("08/24/2026") == "2026-08-24T04:00:00.000Z"
          and est("9/25/25") == "2025-09-25T04:00:00.000Z" and est("2026-10-07") == "2026-10-07T04:00:00.000Z")
    check("a time-only cell, and a date before 1900, read as the clock", est("9:00:00 AM") == "09:00"
          and est("15:26:26") == "15:26" and est("7/31/0025") == "00:00")
    check("a linked cell is its text; a money cell its number; words stay words",
          est("1305 49th St [https://maps.example/x]") == "1305 49th St" and est("$1,200.00") == "1200"
          and est("after 11:00") == "after 11:00" and est("2026-10-07T15:26:26.663Z") == "2026-10-07T15:26:26.663Z")
    check("a Hub tab keeps a typed day as text, and booleans as the words String() makes",
          hubdb.cell_text(hubdb.typed("2025-11-01", "hub")) == "2025-11-01" and gsjs.cell(hubdb.typed("TRUE", "hub")) == "true"
          and hubdb.cell_text(hubdb.typed('["a"]', "hub")) == ["a"])

    import writes as wr  # noqa: PLC0415
    print("writes.py — the write doors' pure rules (tools/test-python-writes.py decides every door over a fake copy)")
    changes, bad = wr.edit_changes({"changes": [{"field": "region", "value": "  Akron ", "expected": 7}]})
    check("hubEditChanges_: values trimmed, a witness as String() makes it",
          bad is None and changes == [{"field": "region", "value": "Akron", "expected": "7"}])
    check("…a field named twice, or malformed, is the door's 400",
          wr.edit_changes({"changes": [{"field": "a"}, {"field": "a"}]})[1]
          == {"status": 400, "message": 'changes: "a" is named twice.'}
          and wr.edit_changes({"changes": [{"field": "Region"}]})[1]["message"] == "changes: a field name is malformed.")
    mint = "HN_" + "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed"
    check("locationsMinted_: the relay's prefix and a v4 uuid, nothing else",
          wr.minted(mint, "HN_") == mint and wr.minted("HN_1", "HN_") == "" and wr.minted(mint, "LS_") == "")
    check("contactPhoneKey_: ten digits, a leading 1 dropped",
          wr.phone_key("+1 (330) 555-0101") == "3305550101" and wr.phone_key("555-0101") == "")
    answer = wr.edit_answer([{"field": "region", "before": "a", "after": "b"}], [], {"telephone": "1"},
                            wr.steps("1 cell(s).", "Read again."))
    check("locationsEditAnswer_: some written, some stale — 409 with the steps and what the row holds",
          answer["status"] == 409 and answer["data"]["written"] == ["region"] and answer["data"]["current"] == {"telephone": "1"}
          and answer["data"]["steps"][0]["id"] == "sheet" and answer["message"].startswith("Some fields changed"), answer)

    import drive as dr  # noqa: PLC0415
    print("drive.py — DriveApp's listings, over a fake Drive")

    class FakeDrive(dr.Drive):
        def __init__(self, tree: dict, files: dict) -> None:
            super().__init__("id", "secret", "refresh")
            self.tree, self.files = tree, files

        def file(self, file_id: str, fields: str = "") -> dict:
            return {"id": file_id, "trashed": False, "parents": ["family"]}

        def children(self, folder_id: str, folders: bool, fields: str = "", cap: int = 0) -> list[dict]:
            got = (self.tree if folders else self.files).get(folder_id, [])
            return got[:cap] if cap else got

    class FakeDb:
        def __init__(self, props: dict) -> None:
            self.props = props

        def prop(self, key: str) -> str:
            return self.props.get(key, "")

    reads = type("R", (), {})()
    reads.db = FakeDb({"ISP_DOCS_FOLDER_ID": "isp", "ADMIN_DOCS_FOLDER_ID": "admin"})
    isp = FakeDrive({}, {"isp": [{"id": "f1", "name": "ISP - Kristin Hedrick 2026.pdf"}, {"id": "f2", "name": "Doe Mary.pdf"},
                                 {"id": "f3", "name": "Ann Lee ISP.pdf"}, {"id": "f4", "name": "ann lee old.pdf"}]})
    check("an ISP is the one file whose folded name holds the client's",
          isp.isp_doc_for(reads, "Kristin Hedrick") == {"id": "f1", "name": "ISP - Kristin Hedrick 2026.pdf",
                                                         "url": "https://drive.google.com/file/d/f1/view"})
    check("…else the one whose every word is in the client's name; two files are no link",
          isp.isp_doc_for(reads, "Mary Jane Doe")["id"] == "f2" and isp.isp_doc_for(reads, "Ann Lee")["id"] == "")
    room = FakeDrive({"family": [{"id": "other", "name": "Invoices"}]}, {})
    got = room.guidebook(reads, "ABD1305")
    check("no houses room: the port's own sentence",
          got == {"guidebook": None, "why": 'The "houses" folder is not configured and could not be found beside the '
                                            'Administration folder — set the HOUSE_DOCS_FOLDER_ID property.'}, got)
    tree = {"family": [{"id": "room", "name": " House _ Client Books "}],
            "room": [{"id": "canton", "name": "Canton"}], "canton": [{"id": "h1", "name": "49TH - ABD1305"}],
            "h1": [{"id": "sub", "name": "Old"}]}
    files = {"h1": [{"id": "x1", "name": "Zeta.pdf", "mimeType": "application/pdf", "modifiedTime": "2026-01-01T00:00:00.000Z",
                     "webViewLink": "u1"}, {"id": "x2", "name": "House Guide.pdf", "mimeType": "application/pdf",
                                            "modifiedTime": "2026-01-02T00:00:00.000Z", "webViewLink": "u2"}],
             "sub": [{"id": "x3", "name": "alpha.docx", "mimeType": "x", "modifiedTime": "t", "webViewLink": "u3"}]}
    got = FakeDrive(tree, files).guidebook(reads, "ABD1305")
    check("the house's folder is found two levels down, its files and its subfolders' with the guide first",
          got["why"] == "" and got["guidebook"]["folder_name"] == "49TH - ABD1305"
          and [f["id"] for f in got["guidebook"]["files"]] == ["x2", "x3", "x1"], got)


# ---- parity against the relay's kept packs ----------------------------------------------------------------------

def docker(*args: str, data: bytes | None = None, timeout: int = 600) -> subprocess.CompletedProcess:
    return subprocess.run(["docker", *args], input=data, capture_output=True, timeout=timeout)


def running(name: str) -> bool:
    got = docker("ps", "--filter", f"name=^{name}$", "--format", "{{.Names}}", timeout=30)
    return got.returncode == 0 and name in got.stdout.decode().split()


def kept_packs(fixtures: Path | None, save: Path | None) -> dict[str, dict]:
    """The relay's kept Locations packs — Apps Script's own answers — from its folder, or from a saved copy of it."""
    out: dict[str, dict] = {}
    if fixtures:
        for f in sorted(fixtures.glob("*.json")):
            body = json.loads(f.read_text(encoding="utf-8"))
            if body.get("app") == "locations":
                out[body["key"]] = body
        return out
    listing = docker("exec", RELAY, "sh", "-c", f"ls {PACK_DIR}", timeout=60)
    if listing.returncode != 0:
        raise RuntimeError(f"the relay's kept packs could not be listed ({listing.stderr.decode()[:200]})")
    for name in listing.stdout.decode().split():
        if not re.fullmatch(r"[0-9a-f]{64}\.json", name):
            continue
        got = docker("exec", RELAY, "cat", f"{PACK_DIR}/{name}", timeout=60)
        try:
            body = json.loads(got.stdout)
        except ValueError:
            continue
        if body.get("app") != "locations":
            continue
        out[body["key"]] = body
        if save:
            save.mkdir(parents=True, exist_ok=True)
            (save / name).write_bytes(got.stdout)
            (save / name).chmod(0o600)
    return out


DRIVER = r'''
import base64, json, sys, types
blob = json.loads(base64.b64decode(sys.stdin.readline()).decode())
for name in blob["order"]:
    m = types.ModuleType(name); m.__file__ = name + ".py"; sys.modules[name] = m
for name in blob["order"]:
    exec(compile(blob["src"][name], name + ".py", "exec"), sys.modules[name].__dict__)
import hubdb, locations as L, scope as sc, drive as dr, writes as WR
job = blob["job"]
db = hubdb.HubDb()
drv = dr.Drive()
out = {"drive": drv.available, "houses": {}, "people": {}}
for code, keys in job["houses"].items():
    reads = L.Reads(db, drv)
    ctx = L.house(reads, code)
    got = {"refused": ctx.get("refused")}
    if not ctx.get("refused"):
        parts = {}
        for name, fn in (("overview", L.overview_part), ("staff", L.staff_part), ("notes", L.notes_part),
                         ("supplies", L.supplies_part), ("repairs", L.repairs_part), ("incidents", L.incidents_part)):
            parts[name] = fn(reads, ctx)
        views = {}
        for key in keys:
            s = {"kind": "client", "client_keys": [key], "house_codes": [code], "ssa_keys": [], "family_keys": [], "why": ""}
            if ",".join(L.viewer_houses_from([key], ctx["all_clients"], ctx["homes"])) != code:
                views[key] = None
                continue
            views[key] = {"scope": {"kind": "client", "writes": False, "editions": [], "cut": True,
                                    "houses": [L.scope_house(code, ctx["homes"], ctx["all_clients"], s)], "why": ""},
                          "overview": L.overview_cut(parts["overview"], s), "staff": L.staff_cut(reads, parts["staff"], s, code),
                          "incidents": L.incidents_cut(parts["incidents"], s)}
        if drv.available:
            parts["guidebook"] = L.guidebook_part(reads, ctx)
        got.update(parts=parts, views=views)
    out["houses"][code] = got
users = L.Reads(db, drv).users()
def live(u):
    return not sc.gsjs.str_(u.get("mergedinto")) and sc.gsjs.str_(u.get("active")).upper() not in ("FALSE", "0", "NO")
by_key = {}
for u in users:
    if live(u) and sc.gsjs.str_(u.get("role")) == "client" and sc.gsjs.str_(u.get("clientkey")):
        by_key.setdefault(sc.gsjs.str_(u.get("clientkey")), u)
wide = next((u for u in users if live(u) and sc.gsjs.str_(u.get("role")) == "staff"
             and "STAFF" in sc.types_from_raw(u.get("types")) and not sc.is_master_email(u.get("email"))), None)
boss = next((u for u in users if live(u) and sc.is_master_email(u.get("email")) and sc.gsjs.str_(u.get("role")) == "admin"), None)
def ask(user, action, payload):
    try:
        return L.ACTIONS[action](L.Session(L.Reads(db, drv), user), payload)
    except sc.Defer as e:
        return {"deferred": str(e)}
for key in job["client_keys"]:
    row = by_key.get(key)
    if row is None:
        continue
    user = sc.user_from_row(row)
    out["people"]["client:" + key] = {"house": job["client_house"][key], "scope": ask(user, "locationScope", {}),
        "overview": ask(user, "locationOverview", {"house": job["client_house"][key]}),
        "notes": ask(user, "locationNotes", {"house": job["client_house"][key]}),
        "other": ask(user, "locationOverview", {"house": job["other_house"].get(key) or "ZZ9999"})}
if wide is not None:
    any_house = next(iter(job["houses"]))
    out["people"]["wide"] = {"house": any_house, "scope": ask(sc.user_from_row(wide), "locationScope", {}),
                             "overview": ask(sc.user_from_row(wide), "locationOverview", {"house": any_house})}
if boss is not None:
    out["people"]["master"] = {"scope": ask(sc.user_from_row(boss), "locationScope", {})}
class Seeded(dr.Drive):
    """Drive stood in by the ISP files Apps Script linked, and a houses room nobody configured."""
    def __init__(self, files):
        super().__init__("id", "secret", "refresh"); self.seed = files
    def isp_files(self, reads):
        return self.seed
    def file(self, file_id, fields=""):
        return {"id": file_id, "trashed": False, "parents": ["family"]}
    def children(self, folder_id, folders, fields="", cap=0):
        return []
seeded = drv if drv.available else Seeded(job["isp_files"])
out["packs"] = {code: L.location_pack(L.Session(L.Reads(db, seeded), {"is_service": True}), {"house": code})
                for code in job["houses"]}
out["writes"] = []
for case in job.get("writes") or []:
    if boss is None:
        out["writes"].append({"deferred": "no master account in the users copy"})
        continue
    try:
        d = WR.ACTIONS[case["action"]](L.Session(L.Reads(db, drv), sc.user_from_row(boss)), case["payload"])
        out["writes"].append({"answer": d.answer, "engine": d.engine, "lay": bool(d.lay)})
    except (sc.Defer, hubdb.Unreadable) as e:
        out["writes"].append({"deferred": str(e)})
print(json.dumps(out))
'''


def run_python(runner: str, job: dict) -> dict:
    blob = {"order": list(MODULES), "src": {n: (APP / f"{n}.py").read_text(encoding="utf-8") for n in MODULES},
            "job": job}
    payload = base64.b64encode(json.dumps(blob).encode()) + b"\n"
    got = docker("exec", "-i", runner, "python", "-c", DRIVER, data=payload, timeout=900)
    if got.returncode != 0:
        raise RuntimeError(f"the Python side did not run in {runner}: {got.stderr.decode()[-600:]}")
    return json.loads(got.stdout.decode().strip().splitlines()[-1])


def instant(v: Any) -> float | None:
    if isinstance(v, str) and ISO.match(v):
        return datetime.strptime(v, "%Y-%m-%dT%H:%M:%S.%fZ").replace(tzinfo=timezone.utc).timestamp()
    return None


LIST_KEYS = ("key", "id", "client_key", "item")
# a staff member's timeline moves as punches and calendar rows arrive: these fields follow the newest one
TIMELINE = ("last_day", "last_source", "shifts", "first_day", "first_source", "name", "sources")


def key_of(items: list) -> str:
    """The field that names each element of a list once ('' when none does)."""
    if not items or not all(isinstance(x, dict) for x in items):
        return ""
    for k in LIST_KEYS:
        vals = [x.get(k) for x in items]
        if all(isinstance(v, str) and v for v in vals) and len(set(vals)) == len(vals):
            return k
    return ""


def newer(a: dict, b: dict) -> bool:
    """Python's staff entry saw activity Apps Script's copy had not seen yet."""
    same_day = a.get("last_day") == b.get("last_day")
    return (str(a.get("last_day") or "") > str(b.get("last_day") or "")
            or (same_day and (a.get("shifts") or 0) > (b.get("shifts") or 0))
            # a punch landed on a day the calendar already had: punches win the tie (locationsStaffMerge_)
            or (same_day and a.get("last_source") == "punches" and b.get("last_source") == "archive"))


def diff(a: Any, b: Any, path: str, out: list[tuple[str, str, Any, Any]], read_day: str = "") -> None:
    """Python's answer `a` against Apps Script's `b`: each difference with its class; named lists compared by name."""
    if isinstance(a, dict) and isinstance(b, dict):
        timeline = "staff.staff[" in path and newer(a, b)
        for k in sorted(set(a) | set(b)):
            if k not in a:
                out.append((f"{path}.{k}", "missing", None, b[k]))
            elif k not in b:
                out.append((f"{path}.{k}", "extra", a[k], None))
            elif timeline and k in TIMELINE and a[k] != b[k]:
                out.append((f"{path}.{k}", "newer", a[k], b[k]))
            else:
                diff(a[k], b[k], f"{path}.{k}", out, read_day)
        return
    if isinstance(a, list) and isinstance(b, list):
        k = key_of(a) or key_of(b)
        if k and (not a or key_of(a) == k) and (not b or key_of(b) == k):
            am, bm = {x[k]: x for x in a}, {x[k]: x for x in b}
            label = (lambda v: v[:3] + "…") if k in ("key", "client_key") else (lambda v: v)
            moved = False
            for name, x in am.items():
                if name not in bm:
                    fresh = "staff.staff" in path and str(x.get("first_day") or "") >= read_day
                    moved = moved or fresh
                    out.append((f"{path}[{k}={label(name)}]", "newer" if fresh else "extra", x, None))
            for name, y in bm.items():
                if name not in am:
                    out.append((f"{path}[{k}={label(name)}]", "missing", None, y))
            for name in am:
                if name in bm:
                    before = len(out)
                    diff(am[name], bm[name], f"{path}[{k}={label(name)}]", out, read_day)
                    moved = moved or any(d[1] == "newer" for d in out[before:])
            ours, theirs = [n for n in am if n in bm], [n for n in bm if n in am]
            if ours != theirs:
                out.append((path, "newer" if moved else "order", ours[:3], theirs[:3]))
            return
        if len(a) != len(b):
            out.append((path, "length", len(a), len(b)))
        for i, (x, y) in enumerate(zip(a, b)):
            diff(x, y, f"{path}[{i}]", out, read_day)
        return
    if a == b or (isinstance(a, (int, float)) and isinstance(b, (int, float)) and float(a) == float(b)):
        return
    ia, ib = instant(a), instant(b)
    if ia is not None and ib is not None and abs(ia - ib) < 1.0:
        out.append((path, "precision", a, b))
        return
    if path.endswith((".sources.archive.rows", ".sources.punches.rows")):
        out.append((path, "count", a, b))
        return
    out.append((path, "value", a, b))


def report(label: str, out: list[tuple[str, str, Any, Any]], show: int) -> int:
    kinds: dict[str, int] = {}
    for _p, k, _a, _b in out:
        kinds[k] = kinds.get(k, 0) + 1
    real = [d for d in out if d[1] not in EXPLAINED]
    said = ", ".join(f"{n} {k}" for k, n in sorted(kinds.items())) or "identical"
    print(f"    {label}: {said}")
    shapes: dict[str, list] = {}
    for p, k, a, b in real:
        shapes.setdefault(re.sub(r"\[\d+\]", "[]", p) + " " + k, []).append((p, a, b))
    for shape, items in sorted(shapes.items(), key=lambda x: -len(x[1]))[:show]:
        p, a, b = items[0]
        print(f"      {len(items)}× {shape}  e.g. {p}: python={json.dumps(a)[:70]} apps_script={json.dumps(b)[:70]}")
    return len(real)


STALE = "zz-parity-stale"
NOTHING = "Changed since the panel was opened — reloaded, nothing was written."


def num_text(v: Any) -> str:
    """String(Number) of a pack's figure."""
    f = float(v)
    return str(int(f)) if f == int(f) else repr(f)


def write_cases(packs: dict[str, dict]) -> list[dict]:
    """Write calls whose Apps Script answer the kept pack makes certain (Locations.gs's own order), as the master."""
    out: list[dict] = []

    def case(code: str, what: str, action: str, payload: dict, status: int, message: str,
             current: dict | None = None, data: dict | None = None) -> None:
        out.append({"code": code, "what": what, "action": action, "payload": payload, "status": status,
                    "message": message, "current": current, "data": data})

    for code, body in sorted(packs.items()):
        parts = body["data"]["parts"]
        case(code, "a priority no note has", "locationNoteAdd", {"house": code, "details": "parity", "priority": "parity"},
             400, "priority: one of low, normal, high, urgent.")
        case(code, "a state no note has", "locationNoteState", {"id": "HN_parity", "state": "parity"}, 400,
             "state: open or resolved.")
        case(code, "a note nobody filed", "locationNoteEdit", {"house": code, "id": "HN_parity-missing", "changes": [
            {"field": "details", "value": "parity", "expected": ""}]}, 404, 'No house note "HN_parity-missing".')
        note = next(iter(((parts.get("notes") or {}).get("notes") or [])), None)
        if note:
            case(code, "a note's stale details", "locationNoteEdit", {"house": code, "id": note["id"], "changes": [
                {"field": "details", "value": "parity", "expected": STALE}]}, 409, NOTHING, {"details": note["details"]})
        on_registry = bool(((parts.get("overview") or {}).get("house") or {}).get("on_registry"))
        case(code, "a house row opened on another name", "locationHouseSave",
             {"house": code, "home_name": STALE, "changes": [{"field": "region", "value": "x", "expected": "y"}]},
             *((409, "That house row has changed since it was opened — reload the house.") if on_registry
               else (404, f"The registry has no row for {code}.")))
        supplies = parts.get("supplies") or {}
        entry = next((e for c in supplies.get("consumables") or [] for e in c.get("entries") or [] if e.get("id")), None)
        if supplies.get("ledger_ready") and entry:
            case(code, "a supplies entry's stale count", "locationSupplyEdit", {"house": code, "id": entry["id"],
                 "changes": [{"field": "qty", "value": "1", "expected": STALE}]}, 409, NOTHING,
                 {"qty": num_text(entry["qty"])})
        repair = next(iter((parts.get("repairs") or {}).get("rows") or []), None)
        if repair:
            case(code, "a repair's stale status", "locationRepairEdit", {"house": code, "id": repair["id"], "changes": [
                {"field": "status", "value": "x", "expected": STALE}]}, 409, NOTHING, {"status": repair["status"]})
        incident = next(iter((parts.get("incidents") or {}).get("rows") or []), None)
        if incident:
            case(code, "an incident's stale category", "locationIncidentEdit", {"house": code, "id": incident["id"],
                 "changes": [{"field": "incident_category", "value": "x", "expected": STALE}]}, 409, NOTHING,
                 {"incident_category": incident["row"]["incident_category"]})
        if not (parts.get("staff") or {}).get("removed_why"):
            case(code, "somebody no Staff list carries", "locationStaffRemove", {"house": code, "staff": "Zz Parity Nobody"},
                 404, f"Zz Parity Nobody is not on {code}'s Staff list.")
        client = next(iter((parts.get("overview") or {}).get("clients") or []), None)
        if client:
            why = f"{client['name']} is already a client of {code}."
            case(code, "a client already of the house", "locationClientsAdd", {"house": code,
                 "clients": [client["client_key"]]}, 409, why + " Nothing was written.",
                 data={"house": code, "added": [], "refused": [{"client_key": client["client_key"], "why": why}],
                       "client_keys": []})
    return out


def parity_writes(cases: list[dict], got: list[dict]) -> None:
    """Python's dry decisions against the answers the packs make certain; a newer copy's value is said, not failed."""
    print("\nPARITY — write decisions, as the master, against the answers Apps Script's packs make certain (dry)")
    if len(got) != len(cases):
        check("Python decided every write case", False, f"{len(got)} answers for {len(cases)} cases")
        return
    tally = {"same": 0, "deferred": 0, "newer": 0, "different": 0}
    for c, g in zip(cases, got):
        label = f"{c['code']}: {c['what']} ({c['action']})"
        if "deferred" in g:
            tally["deferred"] += 1
            print(f"    {label}: deferred to Apps Script — {g['deferred'][:120]}")
            continue
        ans = g.get("answer") or {}
        if ans.get("status") != c["status"] or ans.get("message") != c["message"] or g.get("lay"):
            tally["different"] += 1
            check(label, False, {"python": ans, "apps_script": {"status": c["status"], "message": c["message"]}})
            continue
        data = ans.get("data") or {}
        if c["data"] is not None and data != c["data"]:
            tally["different"] += 1
            check(label, False, {"python": data, "apps_script": c["data"]})
            continue
        if c["current"] is not None and data.get("current") != c["current"]:
            tally["newer"] += 1
            print(f"    {label}: the copy holds {json.dumps(data.get('current'))[:90]}, the pack "
                  f"{json.dumps(c['current'])[:90]} — newer than Apps Script's read?")
            continue
        tally["same"] += 1
    print("  in all: " + ", ".join(f"{k} {n}" for k, n in tally.items()))
    check("every write decision Python made is the one Apps Script's door makes", tally["different"] == 0, tally)


def parity(args: argparse.Namespace) -> None:
    if not shutil.which("docker"):
        print("\nparity: skipped — no docker here, so neither the kept packs nor asa-hub-db can be reached")
        return
    print("\nPARITY — Python's parts against the relay's kept locationPack answers (Apps Script's)")
    packs = kept_packs(Path(args.fixtures) if args.fixtures else None, Path(args.save) if args.save else None)
    if not packs:
        print("  no kept Locations pack to compare against")
        return
    runner = args.runner or next((r for r in RUNNERS if running(r)), "")
    if not runner:
        print("  skipped — neither asa-hub-app nor asa-hub-db-sync is running to read asa-hub-db")
        return
    houses = {code: sorted((body["data"]["parts"].get("client_views") or {}).keys()) for code, body in packs.items()}
    client_house = {k: code for code, keys in houses.items() for k in keys}
    other = {k: next((c for c in houses if c != code), "") for k, code in client_house.items()}
    isp_files = {}
    for body in packs.values():
        for view in (body["data"]["parts"].get("client_views") or {}).values():
            for d in ((view.get("documents") or {}).get("isps") or []):
                if d.get("isp_doc_id"):
                    isp_files[d["isp_doc_id"]] = {"id": d["isp_doc_id"], "name": d.get("isp_doc_name") or ""}
    started = time.time()
    cases = write_cases(packs)
    py = run_python(runner, {"houses": houses, "client_keys": sorted(client_house), "client_house": client_house,
                             "other_house": other, "isp_files": list(isp_files.values()),
                             "writes": [{"action": c["action"], "payload": c["payload"]} for c in cases]})
    print(f"  Python ran in {runner} in {time.time() - started:.1f}s; Drive {'read' if py['drive'] else 'not reachable'}")
    unexplained = 0
    tally: dict[str, int] = {}
    for code, body in sorted(packs.items()):
        gs = body["data"]["parts"]
        read_at = float(body.get("read_at") or 0)
        read_day = datetime.fromtimestamp(read_at, NY).strftime("%Y-%m-%d")
        print(f"  {code} (Apps Script read it {(time.time() - read_at) / 60:.0f} min ago, engine {body.get('engine') or '?'})")
        mine = py["houses"].get(code) or {}
        if mine.get("refused"):
            check(f"{code}: Python opens the house", False, mine["refused"])
            continue
        for part in DB_PARTS + (("guidebook",) if py["drive"] else ()):
            out: list = []
            diff(mine["parts"].get(part), gs.get(part), part, out, read_day)
            unexplained += report(part, out, args.show)
            for d in out:
                tally[d[1]] = tally.get(d[1], 0) + 1
            tally["compared parts"] = tally.get("compared parts", 0) + 1
        for key, view in sorted((gs.get("client_views") or {}).items()):
            got = (mine.get("views") or {}).get(key)
            if got is None:
                check(f"{code}: client view {key[:3]}… is cut", False, "Python finds this client in another house")
                continue
            out = []
            for part in VIEW_PARTS:
                diff(got.get(part), view.get(part), f"client_views.{key[:3]}….{part}", out, read_day)
            unexplained += report(f"client view {key[:3]}…", out, args.show)
            for d in out:
                tally[d[1]] = tally.get(d[1], 0) + 1
            tally["compared client views"] = tally.get("compared client views", 0) + 1
    print("  in all: " + ", ".join(f"{k} {n}" for k, n in sorted(tally.items())))
    print("\nPARITY — the whole locationPack, as the relay's fill asks it" +
          ("" if py["drive"] else " (Drive stood in by the ISP files Apps Script linked; no houses room)"))
    for code, body in sorted(packs.items()):
        env = py["packs"].get(code) or {}
        if env.get("status") != 200:
            check(f"{code}: Python builds the pack", False, env)
            continue
        read_day = datetime.fromtimestamp(float(body.get("read_at") or 0), NY).strftime("%Y-%m-%d")
        out = []
        data, gs = env["data"], body["data"]
        diff({k: data[k] for k in ("house", "part_status")}, {k: gs[k] for k in ("house", "part_status")}, "pack", out)
        for part in sorted(set(data["parts"]) | set(gs["parts"])):
            diff(data["parts"].get(part), gs["parts"].get(part), part, out, read_day)
        unexplained += report(f"{code} pack", out, args.show)
    print("\nPARITY — whole calls as real accounts, through the gate (App Control, the users row, the scope)")
    for who, said in sorted(py["people"].items()):
        if who == "master":
            s = said["scope"].get("data") or {}
            check("the master reads every house and makes every edition",
                  s.get("kind") == "master" and s.get("writes") is True and len(s.get("editions") or []) == 6, said["scope"])
            continue
        if who == "wide":
            s = said["scope"].get("data") or {}
            check("a STAFF account (released wide) reads every house, uncut",
                  s.get("kind") == "all" and s.get("houses") is None and said["overview"].get("status") == 200, said["scope"])
            continue
        code = said["house"]
        view = (packs[code]["data"]["parts"].get("client_views") or {}).get(who.split(":", 1)[1]) or {}
        if "deferred" in said["scope"]:
            print(f"    a client of {code}: deferred to Apps Script — {said['scope']['deferred']}")
            continue
        out: list = []
        read_day = datetime.fromtimestamp(float(packs[code].get("read_at") or 0), NY).strftime("%Y-%m-%d")
        diff(said["scope"].get("data"), view.get("scope"), "scope", out, read_day)
        diff(said["overview"].get("data"), view.get("overview"), "overview", out, read_day)
        unexplained += report(f"a client of {code}, signed in", out, args.show)
        check(f"a client of {code} is refused another house and the house notes, as Unknown action",
              said["other"] == {"status": 404, "message": "Unknown action."}
              and said["notes"] == {"status": 404, "message": "Unknown action."}, [said["other"], said["notes"]])
    check("no difference beyond a timestamp's milliseconds and activity newer than Apps Script's copy", unexplained == 0,
          f"{unexplained} difference(s) above")
    parity_writes(cases, py.get("writes") or [])


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--fixtures", help="a folder of kept packs saved earlier (else read from the relay container)")
    ap.add_argument("--save", help="save the kept packs read from the relay here (0600 files; they hold names)")
    ap.add_argument("--runner", help="the container that runs the Python side (default: asa-hub-app, else asa-hub-db-sync)")
    ap.add_argument("--show", type=int, default=6, help="difference shapes shown per part")
    ap.add_argument("--unit-only", action="store_true", help="scope.py's rules alone, no docker")
    args = ap.parse_args()
    unit_scope()
    if not args.unit_only:
        parity(args)
    print(f"\ntest-locations-parity: {results['ok']} ok, {len(results['failed'])} failed")
    return 1 if results["failed"] else 0


if __name__ == "__main__":
    sys.exit(main())
