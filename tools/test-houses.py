#!/usr/bin/env python3
"""
THE HOUSES SLICE, asserted offline against a master JSON written to a temp dir.

  master     the rows come from the master JSON through read_book, the book
             ids through the Essencial's pointers, and every source carries
             its freshness (fresh, stale with why, unreadable with why)
  active     a house is active when the Client Database holds an active client
             there; the others are kept with the reason, and an unreadable
             Client Database fails the build instead of answering empty
  manager    whoever carries the house's ** rows in the two weeks ending on its
             latest ** day (a one-day cover left out), the same names every day;
             *** rows are leads only; the phone comes from People alone
  staff      PsiAnywhere punches first (a live punch placed by the place the
             stored punches name, never by a guess), counted as shifts and not
             as entries, the hotline calendar when the punches cannot answer
             for a house, and the list says which
  address    a house's street is its own registry row — a paired unit never
             borrows its neighbour's; an unreadable source is named as such
  client     a client or guardian gets exactly their own house, found by the
             exact key the clients slice pairs with that house, without staff,
             notes, client ids, the other residents or any source detail
  wiring     the door, the App Control gate, the employee-only lock, the
             audience and the check line
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
import types
from datetime import datetime, timezone
from pathlib import Path

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve()
ROOT = HERE.parent.parent
SERVER = ROOT / "server"

results = {"ok": 0, "failed": []}


def check(name: str, ok: bool, detail=None) -> None:
    if ok:
        results["ok"] += 1
        print(f"  ok   {name}")
    else:
        results["failed"].append(name)
        print(f"  FAIL {name}")
        if detail is not None:
            print(f"       {detail}")


if "psycopg2" not in sys.modules:  # pragma: no cover - the host has no driver
    fake = types.ModuleType("psycopg2")
    fake.connect = lambda *a, **k: (_ for _ in ()).throw(RuntimeError("no database in this test"))
    fake.Error = Exception
    extras = types.ModuleType("psycopg2.extras")
    extras.RealDictCursor = object
    fake.extras = extras
    sys.modules["psycopg2"] = fake
    sys.modules["psycopg2.extras"] = extras

TMP = Path(tempfile.mkdtemp(prefix="houses-test-"))
os.environ["HUB_SNAPSHOT_OUT"] = str(TMP / "snap")
sys.path.insert(0, str(SERVER))
import house_slices as hs  # noqa: E402
import master_json as mj  # noqa: E402

NOW = datetime(2026, 9, 23, 16, 0, tzinfo=timezone.utc).timestamp()
FRESH = "2026-09-23T15:00:00Z"
CAL_ID, PEOPLE_ID = "calbook1234567890", "peoplebook1234567"


def write_master(root: Path, books: list[dict], written_at: str = "2026-09-23T15:55:00Z") -> None:
    """books: {id, name, tabs: {tab: (header, rows)}, modified, read_at, owed, stale}."""
    (root / "books").mkdir(parents=True, exist_ok=True)
    manifest = {"format": mj.FORMAT, "round": "t", "written_at": written_at, "books": []}
    for b in books:
        tabs_index, tabs_manifest = [], []
        for tab, (header, rows) in b["tabs"].items():
            pf = mj.part_file(b["id"], tab, 0)
            (root / pf).write_text(json.dumps({
                "header": header,
                "rows": [[i + 2] + [r.get(h) for h in header] for i, r in enumerate(rows)]}))
            tabs_index.append({"tab": tab, "parts": [pf]})
            tabs_manifest.append({"tab": tab, "rows": len(rows), "read_at": b.get("read_at", FRESH),
                                  "stale": b.get("stale", False), "parts": [{"part": 0, "file": pf}]})
        (root / mj.book_file(b["id"])).write_text(json.dumps(
            {"format": mj.FORMAT, "id": b["id"], "name": b["name"], "tabs": tabs_index}))
        manifest["books"].append({"id": b["id"], "name": b["name"], "file": mj.book_file(b["id"]),
                                  "modified_time": b.get("modified", "2026-09-23T14:00:00Z"),
                                  "owed": b.get("owed", False), "status": "ok", "tabs": tabs_manifest})
    (root / "manifest.json").write_text(json.dumps(manifest))


def cal(loc, emp, mark, day, phone="(000) 000-0000"):
    return {"Location": loc, "Employee": emp, "Designation": mark, "Phone": phone, "Date": day}


CLIENT_DB = (["Client", "House", "Status"], [
    {"Client": "Eugene Williams", "House": "ABD1547", "Status": "active"},
    {"Client": "Mark Castilow", "House": "ABD1547", "Status": "Active "},
    {"Client": "Nakita Wade", "House": "NW4045", "Status": "active"},
    {"Client": "Sarina Bunting", "House": "SB4045", "Status": "active"},
    {"Client": "Lawson Davidson", "House": "LD4048", "Status": "active"},
    {"Client": "Zachary Kirby", "House": "ZK1109", "Status": ""},
])
CALENDAR = (["Location", "Employee", "Designation", "Phone", "Date"], [
    cal("CAN - 48TH (A) - ABD1547", "Tyrone Hamilton", "**", "08/02/2026", "(234) 449-0298"),
    cal("CAN - 48TH (A) - ABD1547", "Boyd Bailey", "**", "09/22/2026", "(999) 999-9999"),
    cal("CAN - 48TH (A) - ABD1547", "Future Person", "**", "10/05/2026"),
    cal("CAN - 48TH (A) - ABD1547", "Kimberly McCollum", "***", "09/10/2026"),
    cal("CAN - NW - NW4045", "Wanda McCollum-Dotson", "**", "09/08/2026"),
    cal("CAN - NW - NW4045", "Wanda McCollum-Dotson", "**", "09/12/2026"),
    cal("CAN - NW - NW4045", "Wanda McCollum-Dotson", "**", "09/17/2026"),
    cal("CAN - NW - NW4045", "Wanda McCollum-Dotson", "**", "09/22/2026"),
    cal("CAN - NW - NW4045", "Jordyn Walker", "**", "09/10/2026"),
    cal("CAN - NW - NW4045", "Jordyn Walker", "**", "09/14/2026"),
    cal("CAN - NW - NW4045", "Jordyn Walker", "**", "09/18/2026"),
    cal("CAN - NW - NW4045", "Marquea Kindell", "**", "09/16/2026"),
    cal("CAN - NW - NW4045", "Long Gone", "**", "08/20/2026"),
    cal("CAN - NW - NW4045", "Long Gone", "**", "08/21/2026"),
    cal("CAN - SB - SB4045", "Marquea Kindell", "**", "09/20/2026"),
    cal("CAN - LD - LD4048", "Cassy Majors", "**", "09/23/2026"),
    cal("CAN - LD - LD4048", "Kwabena Tontoh", "*", "09/19/2026"),
    cal("CAN - LD - LD4048", "Kwabena Tontoh", "*", "09/12/2026"),
    cal("CAN - LD - LD4048", "WORKSHOP (LD)", "", "09/12/2026"),
    cal("CAN - LD - LD4048", "OPEN", "", "09/13/2026"),
    cal("CAN - LD - LD4048", "Nurse", "", "09/13/2026"),
    cal("CAN - LD - LD4048", "Old Timer", "*", "03/01/2026"),
])
HOUSES_DATA = {
    "CAN - 48TH (A) - ABD1547": (["Mon", "$20 to TWI"], [{"Mon": "x"}]),
    "CAN - NW - NW4045": (["Tue"], []),
    "CAN - SB - SB4045": (["Wed"], []),
    "CAN - LD - LD4048": (["Dr (TC) @ 10A"], []),
}
REGISTRY = (["home_name", "abbreviation", "address", "region", "thumbnail_url", "manager_name"], [
    {"home_name": "48TH (A) - ABD1547", "abbreviation": "ABD1547", "address": "1547 48th St NW,  Canton",
     "region": "Canton", "thumbnail_url": "https://lh3.googleusercontent.com/d/abc [https://lh3.googleusercontent.com/d/abc]",
     "manager_name": "Tyrone Hamilton"},
    {"home_name": "NW - NW4045", "abbreviation": "NW4045", "address": "4045 Guilford Ave NW, Apt A, Canton",
     "region": "Canton", "thumbnail_url": "https://lh3.googleusercontent.com/d/nwthumb"},
    {"home_name": "SB - SB4045", "abbreviation": "SB4045", "address": "4045 Guilford Ave NW, Apt B, Canton",
     "region": "Canton", "thumbnail_url": ""},
    {"home_name": "ZK - ZK1109", "abbreviation": "ZK1109", "address": "1109 19th St NW", "region": "Canton"},
])
PEOPLE = (["name", "phone", "avatar", "status"], [
    {"name": "Boyd Bailey", "phone": "330-328-4610", "avatar": "/assets/boyd.jpg", "status": "active"},
    {"name": "Wanda McCollum-Dotson", "phone": "330-224-1560", "status": "active"},
    {"name": "Cassy Majors", "phone": "330-949-6899", "status": "active"},
    {"name": "Tyrone Hamilton", "phone": "111-111-1111", "status": "inactive"},
])
POLICIES = (["Title", "Link"], [
    {"Title": "Company Policies", "Link": "https://drive.google.com/file/d/1fKc3DsJclzQ_2rXZ/view"},
    {"Title": "Medical Policies and Procedures", "Link": "https://docs.google.com/document/d/1wdnD4BU64DRgXW/edit"},
    {"Title": "Med Del - Cat 1", "Link": "https://drive.google.com/file/d/13u8r8GZLJU_CjQ/view"},
    {"Title": "Bill of Rights - ER", "Link": "https://drive.google.com/file/d/1NNZxlaIQNgstf/view"},
    {"Title": "MUI Handbook", "Link": "https://drive.google.com/file/d/1712yRlCGhL4so/view"},
])
FACTS = (["Subject ID", "Value"], [
    {"Subject ID": "HOTLINE_CALENDAR_ID", "Value": "an-older-calendar-book"},
    {"Subject ID": "HUB_HOUSE_PEOPLE_ID", "Value": PEOPLE_ID},
    {"Subject ID": "HOTLINE_CALENDAR_ID", "Value": CAL_ID},
])


def estate(**over) -> list[dict]:
    books = {
        "client_db": {"id": hs.CLIENT_DB_ID, "name": "Asa Client Database", "tabs": {"Master": CLIENT_DB}},
        "calendar": {"id": CAL_ID, "name": "MASTER CALENDAR ARCHIVE", "tabs": {"Calendar Archive": CALENDAR}},
        "houses_data": {"id": hs.HOUSES_DATA_ID, "name": "Houses Data R3.1", "tabs": HOUSES_DATA},
        "registry": {"id": hs.ENTITIES_ID, "name": "MyLife OS — Client Entities", "tabs": {"entity_homes": REGISTRY}},
        "people": {"id": PEOPLE_ID, "name": "ASA Data — People", "tabs": {"Data": PEOPLE}},
        "policies": {"id": hs.COMMON_DATA_ID, "name": "Common Data R3.1", "tabs": {"Company Policies": POLICIES}},
        "essencial": {"id": hs.ESSENCIAL_ID, "name": "ASA — Essencial", "tabs": {"Facts": FACTS}},
    }
    for k, v in over.items():
        if v is None:
            books.pop(k, None)
        else:
            books[k] = {**books[k], **v}
    return list(books.values())


def psi(emp, day, house="", where="", start="", end="", consumer=""):
    return {"employee": emp, "date_service": day, "house": house, "location_name": where,
            "start_time": start, "end_time": end, "consumer_1": consumer}


PSI = [
    psi("Samuel Pinto", "08/10/2026", "ABD1547", "1547 48th St NW"),
    psi("Samuel Pinto", "08/11/2026", "ABD1547", "1547 48th St NW"),
    # one overnight shift, split at midnight and entered once per consumer served: 4 entries, 1 shift
    psi("Night Owl", "08/05/2026", "ABD1547", "1547 48th St NW", "10:00:00 PM", "11:59:59 PM", "Eugene Williams"),
    psi("Night Owl", "08/05/2026", "ABD1547", "1547 48th St NW", "10:00:00 PM", "11:59:59 PM", "Mark Castilow"),
    psi("Night Owl", "08/06/2026", "ABD1547", "1547 48th St NW", "12:00:00 AM", "08:19:00 AM", "Eugene Williams"),
    psi("Night Owl", "08/06/2026", "ABD1547", "1547 48th St NW", "12:00:00 AM", "08:19:00 AM", "Mark Castilow"),
    # one consumer left early: two entries, one start, one shift; then a second shift that evening
    psi("Split Ends", "08/07/2026", "ABD1547", "1547 48th St NW", "12:05:00 PM", "02:11:00 PM"),
    psi("Split Ends", "08/07/2026", "ABD1547", "1547 48th St NW", "12:05:00 PM", "08:00:00 PM"),
    psi("Split Ends", "08/07/2026", "ABD1547", "1547 48th St NW", "08:00:00 PM", "11:00:00 PM"),
    psi("Boyd Bailey", "08/12/2026", "ABD1547", "1547 48th St NW"),
    psi("Anissa Hall", "08/12/2026", "NW4045", "4045 Guildford Ave"),
    psi("Old Punch", "05/01/2026", "ABD1547", "1547 48th St NW"),
    psi("Jalesa Mclendon", "09/22/2026", "", "1547 48th St NW"),
    psi("Shaniya King", "09/21/2026", "", "4045 Guildford Ave NW"),
    psi("Twice Placed", "09/21/2026", "", "4060 orchard dale dr"),
    psi("Seeded A", "06/30/2026", "BM4060", "4060 orchard dale dr"),
    psi("Seeded B", "06/30/2026", "MS4060", "4060 orchard dale dr"),
    psi("Not Found Row", "08/01/2026", "Not Found", "General Admin"),
]


CLIENTS = [{"id": "c-1", "name": "Eugene Williams", "client_key": "eugene_williams", "house": "ABD1547",
             "avatar": "/assets/eugene.jpg"},
            {"id": "c-2", "name": "Nakita Wade", "client_key": "nakita_wade", "house": "NW4045"},
            {"id": "c-3", "name": "Sarina Bunting", "client_key": "sarina_bunting", "house": "sb4045 "},
            {"id": "c-9", "name": "Mark Castilow", "client_key": "mark_castilow"}]


def snapshot(snap: Path, psi_rows=PSI, drop: tuple = (), clients=CLIENTS, stamps: dict | None = None) -> Path:
    snap.mkdir(parents=True, exist_ok=True)
    stamps = stamps or {}
    files = {
        "photos.json": [{"kind": "scene", "title": "ABD1547", "src": "/assets/library/houses/a.png"},
                        {"kind": "scene", "title": "SB4045", "src": "/x.png", "hidden": "TRUE"}],
        "clients.json": clients,
        "policies.json": [{"doc_id": "pol-asa-lifecare-general-policies", "title": "Asa LifeCare General Policies",
                           "driveUrl": "https://docs.google.com/document/d/1tj2hQUqpPtAq/edit"},
                          {"doc_id": "pol-medical-policies-and-procedures", "title": "Medical Policies and Procedures",
                           "driveUrl": "https://docs.google.com/document/d/1wdnD4BU64DRgXW/edit"}],
    }
    for name, rows in files.items():
        if name not in drop:
            (snap / name).write_text(json.dumps({"built_at": stamps.get(name, FRESH), "rows": rows}))
    path = snap / "psi-rows.json"
    if psi_rows is not None:
        path.write_text(json.dumps({"generated_at": stamps.get("psi", FRESH), "rows": psi_rows}))
    return path


def run(case: str, books=None, psi_rows=PSI, drop=(), written_at="2026-09-23T15:55:00Z", now=NOW,
        clients=CLIENTS, stamps=None):
    base = TMP / case
    write_master(base / "master", books if books is not None else estate(), written_at)
    path = snapshot(base / "snap", psi_rows, drop, clients, stamps)
    hs.forget_pointers()
    rows, stamp = hs.build_rows(root=base / "master", snapshot_dir=base / "snap", psi_path=path, now=now)
    return {h["code"]: h for h in rows}, rows, stamp


def source(h, key):
    return next(s for s in h["sources"] if s["key"] == key)


print("\nmaster — the rows come from the master JSON, and every source says how fresh it is")
by, rows, stamp = run("base")
check("one row per house the Client Database, the registry or the house book names",
      sorted(by) == ["ABD1547", "LD4048", "NW4045", "SB4045", "ZK1109"], sorted(by))
check("the round the rows came from is the slice's stamp", stamp == "2026-09-23T15:55:00Z", stamp)
check("the title is 'LABEL - CODE', as the houses are listed",
      by["ABD1547"]["title"] == "48TH (A) - ABD1547" and by["LD4048"]["title"] == "LD - LD4048",
      [by["ABD1547"]["title"], by["LD4048"]["title"]])
check("the calendar book is the one the Essencial's NEWEST pointer names",
      source(by["ABD1547"], "calendar")["book"] == "MASTER CALENDAR ARCHIVE", source(by["ABD1547"], "calendar"))
check("every master source is fresh when the manifest says so",
      all(source(by["ABD1547"], k)["state"] == "fresh"
          for k in ("client_db", "calendar", "houses_data", "registry", "people", "policies")),
      [(s["key"], s["state"], s["why"]) for s in by["ABD1547"]["sources"]])
check("the week notes are the house book's pinned headers, weekdays dropped",
      by["ABD1547"]["week_notes"] == ["$20 to TWI"], by["ABD1547"]["week_notes"])
check("the calendar location is the house book's own tab name",
      by["ABD1547"]["calendar_location"] == "CAN - 48TH (A) - ABD1547", by["ABD1547"]["calendar_location"])

by_owed, _, _ = run("owed", estate(client_db={"owed": True}))
st = source(by_owed["ABD1547"], "client_db")
check("a book the mirror still owes is stale, and says why",
      st["state"] == "stale" and "not read yet" in st["why"], st)
by_changed, _, _ = run("changed", estate(calendar={"modified": "2026-09-23T15:30:00Z",
                                                   "read_at": "2026-09-23T15:00:00Z"}))
st = source(by_changed["ABD1547"], "calendar")
check("a sheet changed after its last read is stale", st["state"] == "stale" and "changed at" in st["why"], st)
by_quiet, _, _ = run("quiet", written_at="2026-09-23T10:00:00Z")
st = source(by_quiet["ABD1547"], "people")
check("a master JSON that stopped writing rounds makes every source stale",
      st["state"] == "stale" and "no round since" in st["why"], st)
by_nopeople, _, _ = run("nopeople", estate(people=None))
st = source(by_nopeople["ABD1547"], "people")
check("a book the master does not hold is unreadable, with the reason",
      st["state"] == "unreadable" and "holds no copy" in st["why"], st)
check("no reason ever carries a sheet id",
      not any(i in s["why"] for s in by_nopeople["ABD1547"]["sources"]
              for i in (PEOPLE_ID, CAL_ID, hs.CLIENT_DB_ID, hs.ENTITIES_ID)), by_nopeople["ABD1547"]["sources"])
m0 = by_nopeople["ABD1547"]["managers"][0]
check("an unreadable People leaves the phone unknown and says People could not be read — never 'no record'",
      m0["phone"] == "" and m0["phone_known"] is False and m0["phone_why"].startswith("People could not be read"),
      m0)
check("a readable People that lacks the name says so, and the phone is known to be absent",
      by["NW4045"]["managers"][1]["phone_known"] is True
      and by["NW4045"]["managers"][1]["phone_why"] == "no People record carries this name", by["NW4045"]["managers"])
by_noreg, _, _ = run("noregistry", estate(registry=None))
check("an unreadable registry says so on every street, never 'no registry row'",
      by_noreg["NW4045"]["address"] == ""
      and by_noreg["NW4045"]["address_why"].startswith("the registry could not be read"), by_noreg["NW4045"])

print("\nside files — a relay file is fresh only while its stamp is")
by_psiold, _, _ = run("psiold", stamps={"psi": "2026-09-21T10:00:00Z"})
st = source(by_psiold["ABD1547"], "psi")
check("a punch record unchanged for a day is stale, with its stamp",
      st["state"] == "stale" and "has not changed since 2026-09-21T10:00:00Z" in st["why"], st)
by_psiquiet, _, _ = run("psiquiet", psi_rows=[r for r in PSI if r["date_service"] < "09/21/2026"])
st = source(by_psiquiet["ABD1547"], "psi")
check("a punch record whose newest punch is days old is stale, even freshly written",
      st["state"] == "stale" and "newest punch on record is from 2026-08-12" in st["why"], st)
check("a live punch record (a punch yesterday, written this hour) is fresh",
      source(by["ABD1547"], "psi")["state"] == "fresh", source(by["ABD1547"], "psi"))
by_slow, _, _ = run("slowslice", stamps={"clients.json": "2026-09-23T11:00:00Z"})
st = source(by_slow["ABD1547"], "clients")
check("a relay slice not rebuilt for hours is stale", st["state"] == "stale" and "last built at" in st["why"], st)
try:
    run("nodb", estate(client_db=None))
    raised = ""
except RuntimeError as exc:
    raised = str(exc)
check("an unreadable Client Database fails the build — never an empty list of houses",
      "cannot be said" in raised, raised)

print("\nactive — at least one active client in the Asa Client Database")
check("a house with an active client is active (status read trimmed, any case)",
      by["ABD1547"]["active"] and by["ABD1547"]["client_count"] == 2, by["ABD1547"]["clients"])
check("a house whose client is not active is kept, inactive, with the reason",
      by["ZK1109"]["active"] is False and "no active client" in by["ZK1109"]["active_why"], by["ZK1109"])
check("LD, missing from the registry, is still a house (the Client Database and the house book name it)",
      by["LD4048"]["active"] is True, by["LD4048"])
check("the clients carry their id and portrait from the clients slice",
      by["ABD1547"]["clients"][0] == {"name": "Eugene Williams", "client_id": "c-1",
                                      "client_key": "eugene_williams", "avatar": "/assets/eugene.jpg"},
      by["ABD1547"]["clients"])
check("a client the clients slice does not hold stays a name, never a wrong link",
      by["ABD1547"]["clients"][1]["client_id"] == "", by["ABD1547"]["clients"][1])

print("\nmanager — who carries the ** rows of the last two weeks, the phone from People")
hm = by["ABD1547"]["managers"]
check("the latest ** row on or before today wins over an older one, and a future one is ignored",
      [m["name"] for m in hm] == ["Boyd Bailey"], hm)
check("the phone is People's, not the calendar row's nor the registry's",
      hm[0]["phone"] == "330-328-4610" and hm[0]["last_day"] == "2026-09-22", hm)
check("a co-managed house names both managers, most days first, each with their own last day",
      [(m["name"], m["last_day"]) for m in by["NW4045"]["managers"]]
      == [("Wanda McCollum-Dotson", "2026-09-22"), ("Jordyn Walker", "2026-09-18")], by["NW4045"]["managers"])
check("a one-day cover and a manager gone for weeks are not house managers",
      not ({"Marquea Kindell", "Long Gone"} & {m["name"] for m in by["NW4045"]["managers"]}), by["NW4045"]["managers"])
same = set()
for day in range(15, 24):
    at = datetime(2026, 9, day, 16, 0, tzinfo=timezone.utc).timestamp()
    same.add(tuple(sorted(m["name"] for m in run(f"nw-{day}", now=at)[0]["NW4045"]["managers"])))
check("the co-managed house names the same managers whichever day it is read",
      same == {("Jordyn Walker", "Wanda McCollum-Dotson")}, same)
check("a one-day ** row is still the manager when nobody else carries the house",
      [m["name"] for m in by["SB4045"]["managers"]] == ["Marquea Kindell"], by["SB4045"]["managers"])
check("a *** row is a lead, shown as such, never a manager",
      by["ABD1547"]["leads"] == [{"name": "Kimberly McCollum", "last_day": "2026-09-10"}],
      by["ABD1547"]["leads"])
check("a house with no ** row names nobody and says so (never the registry's stale name)",
      by["ZK1109"]["managers"] == [] and "no ** row" in by["ZK1109"]["managers_why"], by["ZK1109"])

print("\nstaff — PsiAnywhere punches first, the hotline calendar when they cannot answer")
a = by["ABD1547"]
check("a house with punches lists who WORKED, with the source named",
      a["staff_source"] == "psi" and a["staff_label"].startswith("Worked here"), a["staff_source"])
names = {s["name"]: s for s in a["staff"]}
check("counts and last day per person, inside the three-month window only",
      names["Samuel Pinto"]["shifts"] == 2 and names["Samuel Pinto"]["last_day"] == "2026-08-11"
      and "Old Punch" not in names, a["staff"])
check("an overnight shift split at midnight and entered once per consumer (4 entries) is one shift",
      names["Night Owl"]["shifts"] == 1 and names["Night Owl"]["last_day"] == "2026-08-06", names["Night Owl"])
check("entries sharing a start are one shift even when one consumer left early; a later start is another",
      names["Split Ends"]["shifts"] == 2, names["Split Ends"])
check("the clock reads PsiAnywhere's spelling",
      hs.clock_of("12:00:00 AM") == 0 and hs.clock_of("11:59:59 PM") == 86399
      and hs.clock_of("12:05 PM") == 43500 and hs.clock_of("") is None and hs.clock_of("13:00 PM") is None, None)
check("a live punch with no code is placed by the place the stored punches name",
      "Jalesa Mclendon" in names and names["Jalesa Mclendon"]["last_day"] == "2026-09-22", a["staff"])
check("the current manager is marked on the list", names["Boyd Bailey"]["hm"] is True, names["Boyd Bailey"])
check("nothing of the punch crosses but who, how many and when (no place, no client, no clock)",
      all(set(s) == {"name", "shifts", "last_day", "avatar", "hm", "lead"} for h in rows for s in h["staff"]),
      [sorted(s) for s in a["staff"]][:1])
check("a place the stored punches give two codes is never guessed",
      all("Twice Placed" not in {s["name"] for s in h["staff"]} for h in rows), None)
check("the stretch with no punch at all is named",
      {"from": "2026-08-13", "to": "2026-09-20"} in a["staff_gaps"], a["staff_gaps"])
ld = by["LD4048"]
check("a house the punches cannot answer for falls back to the calendar and says why",
      ld["staff_source"] == "calendar" and "no PsiAnywhere punch" in ld["staff_why"], ld["staff_why"])
check("the calendar list skips workshops, OPEN rows and non-people, and the window",
      [s["name"] for s in ld["staff"]] == ["Cassy Majors", "Kwabena Tontoh"]
      and ld["staff"][1]["shifts"] == 2, ld["staff"])
by_nopsi, _, _ = run("nopsi", psi_rows=None)
check("an unreadable punch record puts every house on the calendar, with the reason",
      by_nopsi["ABD1547"]["staff_source"] == "calendar"
      and "could not be read" in by_nopsi["ABD1547"]["staff_why"]
      and source(by_nopsi["ABD1547"], "psi")["state"] == "unreadable", by_nopsi["ABD1547"]["staff_why"])
check("an inactive house carries no staff list", by["ZK1109"]["staff"] == [], by["ZK1109"]["staff"])

print("\naddress and photo — each house's own row, never a neighbour's street")
check("SB4045 carries its OWN street (Apt B), not NW4045's",
      by["SB4045"]["address"] == "4045 Guilford Ave NW, Apt B, Canton"
      and by["NW4045"]["address"] == "4045 Guilford Ave NW, Apt A, Canton", [by["SB4045"]["address"]])
check("a house with no registry row has no street, and says so",
      by["LD4048"]["address"] == "" and by["LD4048"]["address_why"], by["LD4048"])
check("the Image Bank scene comes first", by["ABD1547"]["photo"] == {"src": "/assets/library/houses/a.png",
                                                                    "source": "image bank"}, by["ABD1547"]["photo"])
check("then the registry thumbnail", by["NW4045"]["photo"]["source"] == "registry"
      and by["NW4045"]["photo"]["src"] == "https://lh3.googleusercontent.com/d/nwthumb", by["NW4045"]["photo"])
check("a hidden scene is no photo, and nothing at all leaves the house icon",
      by["SB4045"]["photo"] == {"src": "", "source": ""}, by["SB4045"]["photo"])

print("\npolicies — the eight documents, the platform's own copy when it has one")
pol = {p["title"]: p for p in a["policies"]}
check("the Drive-id match finds the in-app Medical Policies",
      pol["Medical Policies and Procedures"]["in_app_doc"] == "pol-medical-policies-and-procedures", pol)
check("Company Policies opens the platform's General Policies",
      pol["Company Policies"]["in_app_doc"] == "pol-asa-lifecare-general-policies", pol)
check("the rest keep their existing link", pol["Med Del - Cat 1"]["in_app_doc"] == ""
      and pol["Med Del - Cat 1"]["url"].startswith("https://drive.google.com/"), pol["Med Del - Cat 1"])
check("only the resident-facing documents are for clients",
      sorted(t for t, p in pol.items() if p["audience"] == "all") == ["Bill of Rights - ER", "MUI Handbook"], pol)

print("\nclient — exactly their own house, cut on the server")
nw, why = hs.client_view(rows, "nakita_wade")
sb, _ = hs.client_view(rows, "sarina_bunting")
check("a client at NW4045 gets NW4045 and a client at SB4045 gets SB4045 — one house each",
      nw["code"] == "NW4045" and sb["code"] == "SB4045", [nw and nw["code"], sb and sb["code"]])
check("the view never carries staff, notes, client ids or the calendar location",
      not ({"staff", "staff_gaps", "week_notes", "clients", "calendar_location", "leads"} & set(nw)), sorted(nw))
eu, _ = hs.client_view(rows, "eugene_williams")
check("the only resident named is the account's own client",
      [p["name"] for p in eu["you"]] == ["Eugene Williams"] and eu["resident_count"] == 2, eu["you"])
check("the manager's name and phone reach the client",
      eu["managers"] == [{"name": "Boyd Bailey", "phone": "330-328-4610", "last_day": "2026-09-22",
                          "phone_known": True}], eu["managers"])
check("the client sees only the resident-facing documents",
      [p["title"] for p in eu["policies"]] == ["Bill of Rights - ER", "MUI Handbook"], eu["policies"])
check("the client is told only which part may be out of date — no book, no count, no reason",
      all(set(s) == {"key", "label", "state"} for s in eu["sources"])
      and {s["key"] for s in eu["sources"]} == {"client_db", "calendar", "registry", "people"}, eu["sources"])
nodb_view, _ = hs.client_view(run("client-nopeople", estate(people=None))[1], "eugene_williams")
blob = json.dumps(nodb_view)
check("no sheet id, book name or row count reaches a client even when a book is missing",
      not any(x in blob for x in (PEOPLE_ID, CAL_ID, hs.CLIENT_DB_ID, hs.ENTITIES_ID, "MASTER CALENDAR", '"rows"',
                                  "holds no copy")), blob)
check("and the client's page says the manager's phone is unknown, not absent",
      nodb_view["managers"][0]["phone_known"] is False, nodb_view["managers"])
check("a key the clients slice pairs with no house gets no house, though a resident carries that name",
      hs.client_view(rows, "mark_castilow")[0] is None, None)
check("the key is matched exactly, never folded", hs.client_view(rows, "Eugene-Williams")[0] is None
      and hs.client_view(rows, " eugene_williams ")[0]["code"] == "ABD1547", None)
namesake_db = (CLIENT_DB[0], CLIENT_DB[1] + [{"Client": "John Smith", "House": "LD4048", "Status": "active"},
                                            {"Client": "John Smith", "House": "ZK1109", "Status": "former"}])
_, namesake, _ = run("namesake", estate(client_db={"tabs": {"Master": namesake_db}}),
                     clients=CLIENTS + [{"id": "c-7", "name": "John Smith", "client_key": "john_smith", "house": "ZK1109"},
                                        {"id": "c-8", "name": "John Smith", "client_key": "john_smith_2",
                                         "house": "LD4048"}])
old, why_old = hs.client_view(namesake, "john_smith")
new, _ = hs.client_view(namesake, "john_smith_2")
check("a former resident never gets the house of a new resident with the same name",
      old is None and new is not None and new["code"] == "LD4048", [why_old, new and new["code"]])
dup = CLIENTS + [{"id": "c-5", "name": "Nakita Wade", "client_key": "nakita_wade", "house": "NW4045"}]
_, dup_rows, _ = run("dupkey", clients=dup)
check("a key two client rows carry opens no house", hs.client_view(dup_rows, "nakita_wade")[0] is None, None)
none, why = hs.client_view(rows, "zachary_kirby")
check("a client whose house is not active gets no house, and the reason", none is None and why, why)
none, why = hs.client_view(rows, "")
check("an account with no client key gets nothing", none is None and "no client key" in why, why)
none, why = hs.client_view(rows, "somebody_else")
check("an unknown key never lands on another house", none is None and why, why)
twice = [dict(rows[0], clients=[{"name": "X Y", "client_key": "x_y"}], active=True),
         dict(rows[1], clients=[{"name": "X Y", "client_key": "x_y"}], active=True)]
none, why = hs.client_view(twice, "x_y")
check("a client placed in two houses gets neither", none is None and "more than one" in why, why)
held = {"built_at": "2026-09-23T15:50:00Z", "rows": rows}
fine = hs.client_answer(held, "", "eugene_williams", now=NOW)["house"]
check("a copy built this hour, from a build that did not fail, adds no warning",
      "build" not in {s["key"] for s in fine["sources"]}, fine["sources"])
failed = hs.client_answer(held, "which houses are active cannot be said", "eugene_williams", now=NOW)["house"]
check("a failed last build tells the client the page may be behind, in no words of the error",
      {"key": "build", "label": "this page", "state": "stale"} in failed["sources"]
      and "cannot be said" not in json.dumps(failed), failed["sources"])
aged = hs.client_answer(dict(held, built_at="2026-09-23T09:00:00Z"), "", "eugene_williams", now=NOW)["house"]
check("a copy no build has replaced for hours is behind too", "build" in {s["key"] for s in aged["sources"]}, None)

print("\nwiring — the door, the lock, the audience, the check")
relay = (SERVER / "snapshot_service.py").read_text()
check("the relay serves the client door", '@app.get("/hub-lanes/houses/mine")' in relay)
door = relay[relay.index('@app.get("/hub-lanes/houses/mine")'):]
door = door[:door.index("\n@app.", 10)]
check("the door keys on the session's own client_key and cuts with client_answer",
      "_session_actor" in door and "client_key" in door and "house_slices.client_answer" in door, None)
check("the door answers only a client session",
      'if role != "client"' in door and '"onboarding", "interviewer"' in door, None)
gate = door.index('rules.get("houses")')
check("the App Control row gates the door before any house is read: no row, or no badge worn, is a 403",
      "_badge_rules" in door and "_badge_allows(rule, _badges_of(role" in door
      and '"status": 403' in door[gate:] and gate < door.index('"houses.json"'), None)
check("an unreadable matrix shuts the door rather than opening it",
      "if not rules:" in door and '"status": 503' in door, None)
snapshot_ts = (ROOT / "src/lib/snapshot.ts").read_text()
lock = snapshot_ts[snapshot_ts.index("export const EMPLOYEE_ONLY_SLICES"):]
lock = lock[:lock.index("]\n")]
check("the houses file is employee-only, so a client session is refused it", "'houses'" in lock)
registry_ts = (ROOT / "src/registry/apps-houses.ts").read_text()
check("the app is visible to the client role (the badge matrix still decides)",
      "'client'" in registry_ts, None)
manifest = json.loads((ROOT / "public/snapshot-manifest.json").read_text())
entry = next((e for e in manifest["resources"] if e["resource"] == "houses"), {})
check("the emitted manifest gives the houses file to no client or onboarding session",
      entry and not ({"client", "onboarding"} & set(entry.get("roles") or [])), entry)
pkg = json.loads((ROOT / "package.json").read_text())
check("`npm run check` runs this file", "npm run test:houses" in pkg["scripts"]["check"]
      and pkg["scripts"].get("test:houses") == "python3 tools/test-houses.py", None)

print("\ngrant tool — dry run by default, one row, additive")
sys.path.insert(0, str(ROOT / "tools"))
import importlib.util  # noqa: E402
spec = importlib.util.spec_from_file_location("grant", ROOT / "tools/grant_houses_client_access.py")
grant = importlib.util.module_from_spec(spec)
spec.loader.exec_module(grant)
header = ["app_id", "badges", "updated_at", "updated_by"]
grid = [header, ["crm", "ADMIN"], ["houses", "DIRECTOR, ADMIN, STAFF", "x", "y"]]
plan = grant.plan(grid, "2026-09-23T00:00:00Z")
check("the houses row gains CLIENT and GUARDIAN and keeps every badge it had",
      plan["row"] == 3 and plan["badges"] == "DIRECTOR, ADMIN, STAFF, CLIENT, GUARDIAN", plan)
done = grant.plan([header, ["houses", "STAFF, CLIENT, GUARDIAN"]], "t")
check("a row that already carries both is left alone", done["change"] is False, done)
fresh = grant.plan([header, ["crm", "ADMIN"]], "t")
check("no houses row: one is appended (no row would mean open to the audience, which is not the ask)",
      fresh["row"] is None and fresh["change"] is True, fresh)
check("the tool writes only with --apply", grant.parse([]).apply is False and grant.parse(["--apply"]).apply)

print(f"\n{results['ok']} ok, {len(results['failed'])} failed")
for name in results["failed"]:
    print("  FAILED:", name)
sys.exit(1 if results["failed"] else 0)
