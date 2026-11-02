#!/usr/bin/env python3
"""A first shift in a house is the house manager's training: who trains, every path that asks, the commitment after."""
import ast
import json
import os
import sys
import types
from datetime import datetime, timezone
from pathlib import Path

sys.dont_write_bytecode = True
import lane_schema  # noqa: E402 — beside this file
HERE = Path(__file__).resolve()
ROOT = HERE.parent.parent
SERVER = ROOT / "server"
CONTAINER = os.getenv("HUB_RELAY_CONTAINER", "asa-hub-snapshot")

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
    extras.Json = lambda v: v
    errors = types.ModuleType("psycopg2.errors")
    errors.UniqueViolation = type("UniqueViolation", (Exception,), {})
    fake.extras, fake.errors = extras, errors
    sys.modules["psycopg2"] = fake
    sys.modules["psycopg2.extras"] = extras
    sys.modules["psycopg2.errors"] = errors

sys.path.insert(0, str(SERVER))
os.environ.setdefault("HUB_SNAPSHOT_OUT", "/tmp")
import ist_config  # noqa: E402
import shift_requests as sr  # noqa: E402

# The IST settings as a read that landed, holding the shipped values: an unread house decides nothing.
ist_config.pin(dict(ist_config.SHIPPED))


def src(name: str) -> str:
    return (SERVER / f"{name}.py").read_text(encoding="utf-8")


def fn_source(source: str, name: str) -> str:
    tree = ast.parse(source)
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)) \
                and node.name == name:
            return ast.get_source_segment(source, node) or ""
    return ""


BM, MK, NW = "CAN - BM - BM4060", "CAN - MK - MK11787", "CAN - NW - NW4045"
DAY = "2026-10-01"
MANAGERS = {"readable": True, "why": "", "by_code": {
    "BM4060": {"name": "Hana Boss", "names": ["Hana Boss"]},
    "NW4045": {"name": "Nia Day", "names": ["Nia Day", "Nat Night"]},
}}


def clash(value, loc=BM, source="roster", trainee=""):
    return {"location": loc, "col_iso": DAY, "value": value, "source": source,
            "trainee": trainee}


def verdict(location=BM, value="8A-4P", trainee="Zoe New", busy=None, approver="", prefer="",
            managers=MANAGERS, raises=()):
    busy = busy or {}

    def busy_of(name):
        if name in raises:
            raise RuntimeError("unreadable")
        return busy.get(name)
    return sr.training_verdict(location=location, col_iso=DAY, value=value, trainee=trainee,
                               managers=managers, busy_of=busy_of, approver=approver,
                               prefer=prefer)


print("WHO TRAINS — the house manager, free then, or APPROVE is refused")
v = verdict()
check("a house manager free then trains, and the training may be approved",
      v["state"] == "free" and v["trains"] == "Hana Boss" and v["may_approve"] is True
      and v["code"] == "ok", v)
check("…and the row says so", "the house manager Hana Boss is free then and trains" in v["why"],
      v["why"])
v = verdict(busy={"Hana Boss": clash("7A-3P")})
check("the house manager working then REFUSES approve, with code trainer_busy",
      v["state"] == "busy" and v["may_approve"] is False and v["code"] == "trainer_busy", v)
check("the sentence: the house manager is working <shift> then",
      "the house manager Hana Boss is working 7A-3P at BM then (2026-10-01)" in v["why"]
      and "first shift in a house is the house manager's training" in v["why"], v["why"])
check("the busy manager is named with the shift, the house and the day",
      v["busy"] and v["busy"][0]["name"] == "Hana Boss" and v["busy"][0]["value"] == "7A-3P"
      and v["busy"][0]["house"] == "BM", v["busy"])
v = verdict(location=NW, busy={"Nia Day": clash("8A-8P", NW)})
check("two current managers (NW): one working, the other free — the free one trains",
      v["state"] == "free" and v["trains"] == "Nat Night" and v["may_approve"] is True, v)
check("and the row names the one who is working, and who trains instead",
      "Nia Day is working 8A-8P at NW then" in v["why"] and "Nat Night" in v["why"], v["why"])
v = verdict(location=NW, busy={"Nia Day": clash("8A-8P", NW), "Nat Night": clash("8P-8A", NW)})
check("both NW managers working then refuses approve and names both",
      v["state"] == "busy" and v["may_approve"] is False
      and "the house managers are all working then" in v["why"]
      and "Nia Day" in v["why"] and "Nat Night" in v["why"], v["why"])
v = verdict(location=NW, approver="Nat Night")
check("the approver trains when they are one of the managers and free",
      v["trains"] == "Nat Night", v)
v = verdict(location=NW, approver="Nat Night", prefer="Nia Day")
check("…but the trainer an earlier approval named comes first",
      v["trains"] == "Nia Day", v)
v = verdict(trainee="Hana Boss")
check("the person being trained never trains themselves — with nobody else, it goes above",
      v["state"] == "above" and "the only house manager of BM is the person being trained"
      in v["why"], v)

print("\nNO MANAGER ON FILE (MK) — the badge holder who approves trains")
v = verdict(location=MK)
check("with nobody named to approve yet, the row says whoever approves trains",
      v["state"] == "above" and v["may_approve"] is False and v["code"] == "trainer_unnamed"
      and "no house manager is on file for MK" in v["why"]
      and "whoever approves trains" in v["why"], v)
v = verdict(location=MK, approver="Dan Director")
check("a director who is free then approves — and trains",
      v["state"] == "above_free" and v["trains"] == "Dan Director" and v["may_approve"] is True
      and "so Dan Director trains" in v["why"], v)
v = verdict(location=MK, approver="Rae Director", busy={"Rae Director": clash("8A-4P", BM)})
check("a director working then is refused — they would be the one training",
      v["state"] == "above_busy" and v["may_approve"] is False and v["code"] == "trainer_busy"
      and "Rae Director is working 8A-4P at BM then" in v["why"], v)
v = verdict(location=MK, approver="Dan Director", prefer="Rae Director",
            busy={"Rae Director": clash("8A-4P", BM)})
check("the director an earlier approval named is working now — the one approving trains",
      v["state"] == "above_free" and v["trains"] == "Dan Director", v)

print("\nUNREADABLE IS NEVER FREE")
v = verdict(managers={"readable": False, "why": "the mirror is down"})
check("an unreadable manager list refuses approve, with the reason",
      v["state"] == "unreadable" and v["may_approve"] is False
      and v["code"] == "trainer_unreadable" and "the mirror is down" in v["why"], v)
v = verdict(managers=None)
check("no manager list at all is unreadable too", v["state"] == "unreadable", v)
v = verdict(raises=("Hana Boss",))
check("a manager whose shifts could not be read is not free — refused",
      v["state"] == "unreadable" and v["may_approve"] is False and "Hana Boss" in v["why"], v)
v = verdict(location=NW, raises=("Nia Day",))
check("…but the other current manager, read and free, trains",
      v["state"] == "free" and v["trains"] == "Nat Night", v)
v = verdict(location=MK, approver="Dan Director", raises=("Dan Director",))
check("at MK an approver whose shifts could not be read is refused",
      v["state"] == "unreadable" and v["may_approve"] is False, v)
v = verdict(value="ADMIN")
check("a cell with no hours has no training time to weigh",
      v["state"] == "not_a_shift" and v["may_approve"] is True, v)

print("\nTHE SENTENCES — which road a commitment is theirs by")
for source, word in (("application", "a shift they have applied for"),
                     ("claim", "a shift they were given"),
                     ("draft", "drafted on Calendar Builder"),
                     ("handoff", "a shift being handed to them"),
                     ("training", "training Yan First")):
    v = verdict(busy={"Hana Boss": clash("7A-3P", source=source, trainee="Yan First")})
    check(f"a {source} is said as '{word}'", word in v["why"], v["why"])
check("the overlap law names a training as the training they give",
      "(the training they give Zoe New on a first shift there)"
      in sr.clash_sentence(clash("8A-4P", source="training", trainee="Zoe New")))

print("\nTHE TRAINERS — each manager read once, a shift never clashing with its own training")
calls = []
held_real = sr.held_by
try:
    def fake_held(dsn, person, **k):
        calls.append(person)
        span = sr.span_of(DAY, "8A-4P")
        return [{"location": BM, "employee": person, "col_iso": DAY, "value": "8A-4P",
                 "span": span, "open_row": "OPEN", "trainee": "Zoe New", "source": "training"}]
    sr.held_by = fake_held
    view = {"people": {BM: ["Hana Boss"], NW: ["Hana Boss"]},
            "isos": {BM: [DAY], NW: ["2026-09-01"]}, "spans": {}}
    book = sr.Trainers("dsn", view=view, managers=MANAGERS)
    same = book.verdict(location=BM, col_iso=DAY, value="8A-4P", trainee="Zoe New")
    other = book.verdict(location=BM, col_iso=DAY, value="9A-1P", trainee="Yan First")
    check("the training of this very shift is not a clash with itself",
          same["state"] == "free" and same["trains"] == "Hana Boss", same)
    check("but a training they give somebody else at that hour is",
          other["state"] == "busy" and "training Zoe New" in other["why"], other["why"])
    check("the manager's commitments were read once for both shifts", calls == ["Hana Boss"], calls)
    check("a house carrying the trainer that does not draw the day is NAMED, never counted free",
          same["unseen"] == ["NW"] and "NW does not" in same["why"], same)
finally:
    sr.held_by = held_real
view = {"spans": {sr.fold("Zoe New"): [{"location": BM, "col_iso": DAY,
                                        "span": sr.span_of(DAY, "8A-4P")}]}}
check("a training commits the trainer while the trainee still holds that shift",
      sr._still_holds(view, "Zoe New", BM, DAY, sr.span_of(DAY, "10A-2P")))
check("…and not once the shift is somebody else's",
      not sr._still_holds(view, "Yan First", BM, DAY, sr.span_of(DAY, "10A-2P"))
      and not sr._still_holds(view, "Zoe New", BM, DAY, sr.span_of(DAY, "5P-9P")))
g = sr.person_gates("dsn", ["Zoe New", "hana boss", "Hana Boss", "", "Ann Roe"])
check("several gates are taken in ONE order, one per person",
      [x.person for x in g.gates] == ["Ann Roe", "hana boss", "Zoe New"],
      [x.person for x in g.gates])
check("the trainer names of a house are its managers, or the approver where none is on file",
      sr.trainer_names("dsn", NW, managers=MANAGERS) == ["Nia Day", "Nat Night"]
      and sr.trainer_names("dsn", MK, approver="Dan Director", managers=MANAGERS)
      == ["Dan Director"])
rec = sr.trainer_record({"trains": "Hana Boss", "state": "free", "why": "w", "managers": ["x"]},
                        by="Rita Lead")
check("an approval writes down who trains, and who approved",
      rec == {"name": "Hana Boss", "state": "free", "why": "w", "approved_by": "Rita Lead",
              "managers": ["x"]}, rec)
check("and a row's recorded trainer is read back from its extra",
      sr._recorded_trainer({"extra": json.dumps({"trainer": {"name": "Nat Night"}})}) == "Nat Night"
      and sr._recorded_trainer({"extra": {}}) == "" and sr._recorded_trainer(None) == "")

print("\nEVERY PATH THAT RAISES OR DECIDES A TRAINING ASKS WHO TRAINS")
SR = src("shift_requests")
approve = fn_source(SR, "approve_training")
check("the training door weighs the trainer before it answers, and refuses on it",
      "training_for(" in approve and 'if not verdict["may_approve"]' in approve
      and approve.index("training_for(") < approve.index("_answer_training(")
      and "person_gates(" in approve, approve[:200])
check("…and only APPROVE is weighed — 'not approved' needs nobody free",
      'if word == "yes":' in approve)
decide = fn_source(SR, "decide")
check("the decision weighs the trainer under the trainer's gate, before the claim",
      "person_gates(dsn, [person, *trainers])" in decide
      and decide.index("training_for(") < decide.index("claim_open_shift(")
      and 'if not training["may_approve"]' in decide, "")
check("and writes the training down before the gates open",
      decide.index("raise_training(") < decide.index("UPDATE asa_shift_pool SET closed_at"), "")
guard = fn_source(SR, "guard_assignment")
check("the one gate refuses an assignment nobody is free to train, and says it moved nothing",
      'if not training["may_approve"]' in guard and "Nothing has moved" in guard
      and "approver=actor if actor_may_decide" in guard)
check("a training approved earlier stands, while its trainer is free",
      "on_file" in guard and '"training_approved"' in guard)
check("a trainer who could not be read is 'ask again', never a no or a yes",
      '"guard_unreadable" if training.get("state") == TRAINING_UNREADABLE'
      in fn_source(SR, "_guard_code"))
check("the check-only gate carries the trainer beside the IST",
      '"training": training' in fn_source(SR, "check_assignment"))
held = fn_source(SR, "_held_of")
check("held_by counts the trainings a person gives as their commitments",
      "extra->'trainer'->>'name'" in held and "source\": TRAINING" in held
      and "_still_holds(" in held)
check("…and never a waiting training approval as a shift the trainee holds",
      "AND state = ANY(%s) AND kind <> %s" in held)
record = fn_source(SR, "_record_training")
check("a training already approved for that person, house and day is kept, not written twice",
      "state=%s \"\n            \"ORDER BY decided_at DESC" in record or "LIMIT 1) RETURNING id" in record)
check("the apply answer says whether the manager is free (never refused for it), as the applicant "
      "may read it", 'out["training"] = training_for_reader(LazyTrainers(dsn).verdict('
      in fn_source(SR, "_apply_locked"))
v = sr.training_for_reader({"state": "busy", "may_approve": False, "trains": "",
                            "busy": [{"line": "Hana is working 7A-3P at BM then (x, a shift they "
                                              "have applied for)"}],
                            "why": "the house manager Hana is working 7A-3P at BM then (x, training "
                                   "Zed) — …"})
check("a trainer verdict read by somebody who does not decide there carries no commitment of the "
      "house manager's — no busy lines, no trainee's name, no shift",
      v["busy"] == [] and "Zed" not in v["why"] and "7A-3P" not in v["why"]
      and v["may_approve"] is False and v["state"] == "busy", v)
rows = fn_source(SR, "_training_rows")
check("the Requests feed carries training and may_approve, weighed with the reader as approver",
      'row["training"] = trainers.verdict(' in rows and 'approver=me if decides else ""' in rows
      and 'row["may_approve"] = decides and' in rows and 'row["trainer"] = _recorded_trainer(r)'
      in rows)
feed = fn_source(SR, "feed")
check("an application from somebody with no IST carries the trainer too",
      'row["training"] = trainers.verdict(' in feed and "LazyTrainers(dsn, view=view)" in feed)
check("the Houses list marks every applicant with no IST for the reader who decides",
      'a["training"] = trainers.verdict(' in fn_source(SR, "_shift_row"))
check("an offer to a person with no IST says who would train them",
      'offer["training"]' in fn_source(SR, "_available"))
deco = fn_source(SR, "decorate_open_shifts")
check("the House Calendars panel carries training on the shift and on each applicant",
      'extra["training"] = book.verdict(' in deco and 'entry["training"] = book.verdict(' in deco
      and 'entry["ist_ok"]' in deco)
check("the one-house grid weighs it; the estate-wide Desk list does not pay for it",
      "trainers=who is not None" in fn_source(SR, "calendar_grid")
      and "trainers=" not in fn_source(SR, "calendar_open_shifts"))
CB = src("calendar_builder_houses")
pub = fn_source(CB, "publish_house")
check("a Calendar Builder publish refuses a first shift nobody is free to train",
      'if not trains.get("may_approve"):' in pub and "refusals.append(" in pub
      and "trainer=shift_requests.trainer_record(trains, by=actor)" in pub)
check("…weighed with the house's own drafts laid on, and the trainers' gates taken",
      'drafts="none", picture=picture,' in pub and "shift_requests.trainer_names(" in pub
      and "person_gates(" in pub)
check("a draft says who would train it (the IST line carries the trainer)",
      'training.get("why")' in fn_source(CB, "_ist_line")
      and "approver=actor" in fn_source(CB, "stage_cell")
      and fn_source(CB, "stage_move").count("approver=actor") == 2
      and "approver=actor" in fn_source(CB, "undo"))
SS = src("snapshot_service")
door = fn_source(SS, "lane_shift_requests_training")
check("the training door returns the trainer's refusal with its data",
      '"data": exc.extra' in door)
check("the swap asks the same gate, and its approval takes the training on through the same door",
      "sr.check_assignment(" in src("shift_handoff")
      and "sr.approve_training(dsn, request_id_=rid" in fn_source(src("shift_handoff"), "answer"))


LANE = r'''
import json, os, sys
from datetime import datetime, timedelta, timezone
sys.path.insert(0, LANE_DIR)
import psycopg2, psycopg2.extras
import lane_schema
import house_cal_live as hcl, shift_handoff
import shift_requests as sr
import calendar_builder_houses as cbh
import effective_roster
# an unregistered switch holds; this lane writes the stand-in workbook
effective_roster.use_switch(lambda: {"on": False, "readable": True, "word": "off", "why": ""})
# the swap's directors are stood in; the list itself is held by test-shift-transfer
shift_handoff.directors_for = lambda dsn: {"readable": True, "names": ["Dee Direct"],
                                           "why": "the director Dee Direct approves"}

DSN = os.environ["HUB_SNAPSHOT_PG_DSN"]
ROOMS = lane_schema.Rooms(DSN, "hm-training")
SCHEMA = ROOMS.name()
OUT = {}
BM, JH, MK, NW = ("CAN - BM - BM4060", "CAN - JH - ABD2704", "CAN - MK - MK11787",
                  "CAN - NW - NW4045")
today = datetime.now(sr.OHIO).date()
PAST = (today - timedelta(days=1)).isoformat()
D1 = (today + timedelta(days=1)).isoformat()
D2 = (today + timedelta(days=2)).isoformat()
D3 = (today + timedelta(days=3)).isoformat()
ISOS = [PAST, D1, D2, D3]
ADMIT = lambda name: True

# house managers stood in: BM and JH one each, NW two, MK none
MANAGERS = {"readable": True, "why": "", "by_code": {
    "BM4060": {"name": "Hana Boss", "names": ["Hana Boss"], "phone": "", "house": BM},
    "ABD2704": {"name": "Rita Lead", "names": ["Rita Lead"], "phone": "", "house": JH},
    "NW4045": {"name": "Nia Day", "names": ["Nia Day", "Nat Night"], "phone": "", "house": NW},
}}
sr.house_managers = lambda dsn, **k: MANAGERS
# IST book stood in: everybody trained except Zoe New and Yan First
EVERY = {"done": 1, "owed": 0, "clients": [], "owed_for": []}
TRAINED = ("Ann Roe", "Dee Way", "Eve Near", "Hana Boss", "Rita Lead", "Nia Day", "Nat Night",
           "Rae Director", "Mo Staff")
CODES = ("BM4060", "ABD2704", "MK11787", "NW4045")
sr.ist_index = lambda dsn, **k: {
    "readable": True, "why": "", "rows": 0, "source": "test",
    "by_person": {sr.fold(n): {c: dict(EVERY) for c in CODES} for n in TRAINED}}
# The IST settings as a read that landed, holding the shipped values: an unread house decides nothing.
import ist_config
ist_config.pin(dict(ist_config.SHIPPED))
# No call-off book is read: the call-offs here are marked on the Builder.
sr.call_off_shifts = lambda dsn, **k: []


def grid(rows):
    return {"cols": [{"iso": i} for i in ISOS],
            "rows": [{"employee": e, "cells": [{"text": t} for t in cs]} for e, cs in rows]}


GRIDS = {
    BM: grid([("OPEN", ["", "8A-4P", "", ""]),
              ("Hana Boss", ["", "7A-3P", "", "8A-2P"]),
              ("Zoe New", ["8A-4P", "", "", ""]),
              ("Ann Roe", ["", "", "", "8A-4P"])]),
    JH: grid([("OPEN", ["", "9A-1P", "", ""]),
              ("Rita Lead", ["", "", "8A-8P", "7A-7P"]),
              ("Dee Way", ["", "", "9A-5P", ""]),
              ("Rae Director", ["", "8A-4P", "", ""]),
              ("Yan First", ["8A-4P", "", "", ""])]),
    MK: grid([("OPEN", ["", "9A-5P", "", ""]),
              ("Mo Staff", ["8A-4P", "", "", ""])]),
    NW: grid([("Nia Day", ["", "", "8A-8P", ""]),
              ("Nat Night", ["", "", "8P-8A", ""]),
              ("Eve Near", ["", "", "2P-10P", ""])]),
}

ROOMS.make()
T = ROOMS.path(SCHEMA)


def rows(sql, args=()):
    with psycopg2.connect(T) as c, c.cursor() as cur:
        cur.execute(sql, args)
        return [list(r) for r in cur.fetchall()]


def refused(fn):
    try:
        return ["allowed", fn()]
    except (sr.Refused, shift_handoff.Refused) as exc:
        return ["refused", exc.code, exc.why,
                exc.extra.get("training") or exc.extra.get("blocked")]
    except hcl.WorkbookRefused as exc:
        return ["workbook", exc.code, exc.blocked]
    except ValueError as exc:
        return ["value", str(exc)]


def viewer(name, types="STAFF"):
    return sr.viewer(T, name=name, role="staff", types=types)


def training_row(location, person, state=None):
    q = ("SELECT id, state, decided_by, extra FROM asa_shift_requests WHERE kind=%s "
         "AND location=%s AND person=%s")
    args = [sr.KIND_IST, location, person]
    if state:
        q += " AND state=%s"
        args.append(state)
    got = rows(q + " ORDER BY created_at", tuple(args))
    return [[r[0], r[1], r[2], ((r[3] or {}).get("trainer") or {}).get("name", "")] for r in got]


def held_sources(person):
    sr.forget_estate()
    return sorted([h["source"], h["location"], h["col_iso"], h.get("trainee", "")]
                  for h in sr.held_by(T, person))


def feed_row(who, kind, person, location):
    f = sr.feed(T, who=who)
    return next((r for r in f["rows"] if r["kind"] == kind and r["person"] == person
                 and r["location"] == location), None)


try:
    with psycopg2.connect(T) as c, c.cursor() as cur:
        # the mirror, stamped a minute ago: a publish now is newer than it
        cur.execute("CREATE TABLE asa_house_calendar_live (location TEXT PRIMARY KEY, "
                    "grid JSONB, updated_at TIMESTAMPTZ DEFAULT now() - interval '1 minute')")
        cur.execute(hcl.CLAIMS_DDL)
        cur.execute(shift_handoff.HANDOFFS_DDL)
        cur.execute(shift_handoff.OPEN_INDEX_DDL)
        for stmt in sr.DDL:
            cur.execute(stmt)
        for loc, g in GRIDS.items():
            cur.execute("INSERT INTO asa_house_calendar_live (location, grid) VALUES (%s,%s)",
                        (loc, psycopg2.extras.Json(g)))
        c.commit()
    # every table the code reads is the lane's before its first read
    OUT["owned"] = lane_schema.own_shift_lane(T, SCHEMA, LANE_DIR)
    book = cbh.MemoryWorkbook.from_grids(GRIDS)
    cbh.use_workbook(book)
    sr.forget_estate()

    # D. an assignment at MK (no manager on file), before any sweep
    OUT["mk_busy_director"] = refused(lambda: sr.take_open_shift(
        T, location=MK, open_row="OPEN", col_iso=D1, person="Yan First", by="Rae Director",
        may_decide=True))
    OUT["mk_busy_nothing_claimed"] = rows("SELECT count(*) FROM asa_house_calendar_claims")[0][0]
    took = sr.take_open_shift(T, location=MK, open_row="OPEN", col_iso=D1, person="Yan First",
                              by="Dan Director", may_decide=True)
    OUT["mk_free_director"] = [took.get("decided"), (took.get("training") or {}).get("state"),
                               (took.get("training") or {}).get("trains")]
    OUT["mk_training_row"] = training_row(MK, "Yan First")
    OUT["mk_tab"] = book.cell(MK, "Yan First", D1)
    # the director who trains Yan is committed at that hour now
    OUT["dan_holds"] = held_sources("Dan Director")

    # ── A. AN OPEN SHIFT: apply, the training door, the decision ────────────
    sr.forget_estate()
    sr.sweep(T)
    now = datetime.now(timezone.utc)
    with psycopg2.connect(T) as c, c.cursor() as cur:
        cur.execute("UPDATE asa_shift_pool SET opened_at=%s", (now,))
        c.commit()
    a = sr.apply_for(T, location=BM, open_row="OPEN", col_iso=D1, person="Zoe New")
    OUT["apply"] = [a["applied"], a["state"], (a.get("training") or {}).get("state"),
                    (a.get("training") or {}).get("why", "")]
    hana = viewer("Hana Boss", "HM")
    zoe = viewer("Zoe New")
    t_row = feed_row(hana, sr.KIND_IST, "Zoe New", BM)
    OUT["feed_hm_training"] = [t_row and t_row["training"]["state"], t_row and t_row["may_approve"]]
    app_row = feed_row(hana, sr.KIND_OPEN, "Zoe New", BM)
    OUT["feed_hm_application"] = [app_row and (app_row.get("training") or {}).get("state"),
                                  app_row and app_row.get("may_approve")]
    z_row = feed_row(zoe, sr.KIND_IST, "Zoe New", BM)
    OUT["feed_trainee"] = [z_row and z_row["training"]["state"], z_row and z_row["may_approve"]]
    houses = sr.feed(T, who=hana)["open_shifts"]
    here = next(s for s in houses if s["location"] == BM and s["col_iso"] == D1)
    OUT["houses_applicant"] = [[x.get("ist_ok"), (x.get("training") or {}).get("state")]
                               for x in here["applicants"]]
    g = sr.calendar_grid(T, BM, hana)
    shift = next(s for s in g["computed"]["open_shifts"] if s["col_iso"] == D1)
    OUT["panel_editor"] = [(shift.get("training") or {}).get("state"),
                           [[x.get("ist_ok"), (x.get("training") or {}).get("state")]
                            for x in shift.get("applicant_list") or []]]
    g = sr.calendar_grid(T, BM, zoe)
    shift = next(s for s in g["computed"]["open_shifts"] if s["col_iso"] == D1)
    OUT["panel_staff"] = [shift["mine"]["code"], (shift.get("training") or {}).get("state"),
                          "applicant_list" in shift]

    rid = a["training_request"]
    OUT["approve_busy"] = refused(lambda: sr.approve_training(T, request_id_=rid, by="Hana Boss"))
    OUT["approve_busy_still_waiting"] = training_row(BM, "Zoe New")
    # THE WINDOW RUNS TO ITS END: a decision inside it is refused (rules 1-2)
    OUT["decide_in_window"] = refused(lambda: sr.decide(T, location=BM, open_row="OPEN", col_iso=D1,
                                                        person="Zoe New", by="Hana Boss"))
    with psycopg2.connect(T) as c, c.cursor() as cur:
        cur.execute("UPDATE asa_shift_pool SET opened_at = now() - interval '1 hour'")
        c.commit()
    OUT["decide_busy"] = refused(lambda: sr.decide(T, location=BM, open_row="OPEN", col_iso=D1,
                                                   person="Zoe New", by="Hana Boss"))
    OUT["decide_busy_nothing"] = [book.cell(BM, "Zoe New", D1),
                                  rows("SELECT count(*) FROM asa_house_calendar_claims "
                                       "WHERE location=%s", (BM,))[0][0]]
    # a Builder publish frees the manager at once, before the mirror reads it back
    cbh.stage_cell(T, location=BM, employee="Hana Boss", col_iso=D1, value="", actor="Hana Boss")
    cbh.publish_house(T, location=BM, actor="Hana Boss")
    ok = sr.approve_training(T, request_id_=rid, by="Hana Boss")
    OUT["approve_free"] = [ok["state"], ok["released"], (ok.get("trainer") or {}).get("name")]
    got = sr.decide(T, location=BM, open_row="OPEN", col_iso=D1, person="Zoe New", by="Hana Boss")
    OUT["decide_free"] = [got["decided"], (got.get("trainer") or {}).get("name"),
                          book.cell(BM, "Zoe New", D1)]
    OUT["one_training_row"] = training_row(BM, "Zoe New")
    OUT["hana_holds"] = held_sources("Hana Boss")
    OUT["feed_trainer"] = (feed_row(hana, sr.KIND_IST, "Zoe New", BM) or {}).get("trainer")

    # ── G. …AND FROM THEN ON IT IS HANA'S COMMITMENT ────────────────────────
    sr.forget_estate()
    sr.sweep(T)
    OUT["hana_given_overlap"] = refused(lambda: sr.decide(
        T, location=JH, open_row="OPEN", col_iso=D1, person="Hana Boss", by="Rita Lead"))
    OUT["hana_drafted_overlap"] = refused(lambda: cbh.stage_cell(
        T, location=JH, employee="Hana Boss", col_iso=D1, value="10A-2P", actor="Rita Lead",
        admits=ADMIT))

    # ── B. A CALL-OFF: Rita manages JH and works that day ───────────────────
    co = cbh.mark_call_off(T, location=JH, employee="Dee Way", col_iso=D2, actor="Rita Lead")
    # its five hours of applications have run (the house manager decides after them)
    with psycopg2.connect(T) as c, c.cursor() as cur:
        cur.execute("UPDATE asa_shift_pool SET opened_at = now() - interval '6 hours' "
                    "WHERE open_row='Dee Way'")
        c.commit()
    OUT["calloff_busy"] = refused(lambda: sr.decide(
        T, location=JH, open_row="Dee Way", col_iso=D2, person="Yan First", by="Rita Lead"))
    OUT["calloff_trained_unaffected"] = refused(lambda: sr.decide(
        T, location=JH, open_row="Dee Way", col_iso=D2, person="Ann Roe", by="Rita Lead")["decided"])

    # C. a swap to a receiver with no IST at NW: offered, marked as training
    off = shift_handoff.offer(T, location=NW, col_iso=D2, from_staff="Eve Near",
                              to_staff="Zoe New")
    # the third consent; the director's own rules are held by test-shift-transfer
    shift_handoff.answer(T, off["id"], side="director", word="yes", by="Dee Direct")
    swap_training = training_row(NW, "Zoe New", sr.NEEDS_TRAINING)
    OUT["swap_offer_made"] = [off["state"], bool(off["training_request"]), off["approval"],
                              json.loads(off["approvers"]) if isinstance(off["approvers"], str)
                              else off["approvers"]]
    OUT["swap_training_raised"] = len(swap_training)
    # a second offer is refused; the training approval stays one
    OUT["swap_reoffer_waiting"] = refused(lambda: shift_handoff.offer(
        T, location=NW, col_iso=D2, from_staff="Eve Near", to_staff="Zoe New"))
    OUT["swap_training_still_one"] = len(training_row(NW, "Zoe New", sr.NEEDS_TRAINING))
    srid = swap_training[0][0] if swap_training else ""
    # APPROVE takes the training on — refused while both NW managers work then
    OUT["swap_approve_busy"] = refused(lambda: shift_handoff.answer(
        T, off["id"], side="manager", word="yes", by="Nia Day"))
    OUT["swap_still_pending"] = [shift_handoff.handoff(T, off["id"])["manager_state"],
                                 len(training_row(NW, "Zoe New", sr.NEEDS_TRAINING))]
    cbh.stage_cell(T, location=NW, employee="Nat Night", col_iso=D2, value="", actor="Nat Night")
    cbh.publish_house(T, location=NW, actor="Nat Night")
    ok = shift_handoff.answer(T, off["id"], side="manager", word="yes", by="Nia Day")
    got_training = sr.request_row(T, srid) or {}
    OUT["swap_approve_other_free"] = [got_training.get("state"),
                                      sr._recorded_trainer(got_training), ok["manager_state"]]
    OUT["nat_before_swap"] = held_sources("Nat Night")
    done = shift_handoff.answer(T, off["id"], side="staff", word="yes", by="Zoe New")
    OUT["swap_done"] = [done["state"], done.get("why") or "", book.cell(NW, "Zoe New", D2),
                        book.cell(NW, "Eve Near", D2)]
    OUT["swap_training_rows"] = training_row(NW, "Zoe New")
    OUT["nat_after_swap"] = held_sources("Nat Night")

    # ── E. A CALENDAR BUILDER PUBLISH: Zoe's first night at JH ─────────────
    cbh.stage_cell(T, location=JH, employee="Zoe New", col_iso=D3, value="8A-4P",
                   actor="Rita Lead", admits=ADMIT)
    OUT["draft_says"] = rows("SELECT ist_missing FROM asa_cal_builder_house_draft "
                             "WHERE location=%s AND employee='Zoe New'", (JH,))
    OUT["publish_busy"] = refused(lambda: cbh.publish_house(T, location=JH, actor="Rita Lead"))
    OUT["publish_busy_tab"] = book.cell(JH, "Zoe New", D3)
    cbh.stage_cell(T, location=JH, employee="Rita Lead", col_iso=D3, value="", actor="Rita Lead")
    pub = cbh.publish_house(T, location=JH, actor="Rita Lead")
    OUT["publish_free"] = [len(pub["training"]), book.cell(JH, "Zoe New", D3),
                           book.cell(JH, "Rita Lead", D3)]
    OUT["publish_training"] = training_row(JH, "Zoe New")

    # ── A DRAG on Calendar Builder puts Yan on his first BM shift ──────────
    mv = cbh.stage_move(T, location=BM, src_employee="Ann Roe", src_iso=D3,
                        dst_employee="Yan First", dst_iso=D3, actor="Hana Boss", admits=ADMIT)
    OUT["drag"] = [mv["moved"], mv["value"]]
    OUT["drag_says"] = rows("SELECT ist_missing FROM asa_cal_builder_house_draft "
                            "WHERE location=%s AND employee='Yan First'", (BM,))
    OUT["drag_publish_busy"] = refused(lambda: cbh.publish_house(T, location=BM,
                                                                 actor="Hana Boss"))
    OUT["drag_wrote_nothing"] = [book.cell(BM, "Ann Roe", D3), book.cell(BM, "Yan First", D3)]
    cbh.discard(T, location=BM, actor="Hana Boss")

    # ── MK on Requests: the row says who trains ────────────────────────────
    mrid = sr.raise_training(T, kind=sr.KIND_OPEN, location=MK, open_row="OPEN", col_iso=D3,
                             value="9A-5P", person="Zoe New",
                             verdict={"ok": False, "state": "missing", "why": "no IST for MK"})
    rae = viewer("Rae Director", "DIRECTOR")
    r = feed_row(rae, sr.KIND_IST, "Zoe New", MK)
    OUT["mk_feed_director"] = [r and r["training"]["state"], r and r["training"]["trains"],
                               r and r["may_approve"]]
    r = feed_row(zoe, sr.KIND_IST, "Zoe New", MK)
    OUT["mk_feed_trainee"] = [r and r["training"]["state"], r and r["may_approve"]]
    ok = sr.approve_training(T, request_id_=mrid, by="Rae Director")
    OUT["mk_approved"] = [ok["state"], (ok.get("trainer") or {}).get("name")]
    # Zoe does not hold that MK shift, so the training commits Rae to nothing
    OUT["rae_holds"] = held_sources("Rae Director")

    # ── F. UNREADABLE MANAGERS: nobody can be shown free ───────────────────
    frid = sr.raise_training(T, kind=sr.KIND_OPEN, location=BM, open_row="OPEN 2", col_iso=D2,
                             value="8P-8A", person="Yan First",
                             verdict={"ok": False, "state": "missing", "why": "no IST for BM"})
    sr.house_managers = lambda dsn, **k: {"readable": False, "why": "the mirror is down",
                                          "by_code": {}}
    OUT["unreadable_approve"] = refused(lambda: sr.approve_training(T, request_id_=frid,
                                                                    by="Hana Boss"))
    OUT["unreadable_guard"] = sr.guard_assignment(
        T, person="Yan First", location=BM, col_iso=D2, value="8P-8A", actor="Hana Boss",
        actor_may_decide=True)["code"]
    OUT["not_approved_needs_nobody"] = sr.approve_training(T, request_id_=frid, by="Hana Boss",
                                                           word="no")["state"]
    sr.house_managers = lambda dsn, **k: MANAGERS
except Exception as exc:  # noqa: BLE001
    OUT["crash"] = f"{type(exc).__name__}: {exc}"
    import traceback
    OUT["trace"] = traceback.format_exc()[-3000:]
finally:
    cbh.use_workbook(None)
    OUT["rooms"] = ROOMS.close()
print("LANE_RESULT " + json.dumps(OUT, default=str))
'''

MODULES = ("calloff_road", "shift_requests", "calendar_builder_houses", "calendar_builder_write",
           "calendar_builder_slices", "house_cal_live", "shift_handoff", "shift_slices",
           "house_directory", "psi_reminders", "badge_follows", "effective_roster", "time_off",
           "redaction")


def _lane_in_container(script_body: str = LANE) -> dict | None:
    # every module the roots reach, and the IST settings reader's declaration, in a folder of this run's own
    sources = lane_schema.with_imports(SERVER, (*MODULES, "ist_config"))
    return lane_schema.run_in(CONTAINER, lane_schema.script(sources, script_body, "hm-training"))


def code_of(r):
    return (r or [None, None])[1] if isinstance(r, list) else None


print("\nTHE LANE — every path, against a real database")
lane = _lane_in_container()
if lane is None:
    print("  (skipped — no docker here to reach a relay container)")
    print("  NOTE: the pure half above still ran; the lane half did not.")
else:
    if lane.get("crash"):
        check("the lane ran to its end", False, lane.get("trace") or lane["crash"])
    L = lane.get
    owned = (L("owned") or {}).get("lane") or {}
    check("every table the lane reads resolves in its own schema before the first read, never public",
          bool(owned) and all(str(s).startswith("hub_test_hm_training_") for s in owned.values()), L("owned"))
    r = L("mk_busy_director") or []
    check("MK (no manager on file): a director working then cannot assign a first shift there",
          code_of(r) == "trainer_busy" and "no house manager is on file for MK" in str(r[2:3])
          and "Rae Director is working 8A-4P at JH then" in str(r[2:3]), r)
    check("…and nothing was claimed", L("mk_busy_nothing_claimed") == 0, L("mk_busy_nothing_claimed"))
    check("a director free then assigns it — and trains",
          L("mk_free_director") == [False, "above_free", "Dan Director"], L("mk_free_director"))
    check("the row says who trains: approved by the director, the director named to train",
          L("mk_training_row") and L("mk_training_row")[0][1:] == ["approved", "Dan Director",
                                                                  "Dan Director"],
          L("mk_training_row"))
    check("the first shift is written into the house's calendar", L("mk_tab") == "9A-5P",
          L("mk_tab"))
    check("and the director is committed at that hour — a training, at MK, of Yan",
          any(x[0] == "training" and x[1] == "CAN - MK - MK11787" and x[3] == "Yan First"
              for x in L("dan_holds") or []), L("dan_holds"))
    ap = L("apply") or [None] * 4
    check("an application with no IST is taken, as a training approval",
          ap[:2] == [True, "needs_training_approval"], ap)
    check("and its answer says the house manager is working then — to the applicant, without WHAT "
          "the house manager is working (their applications, drafts and trainings are not the "
          "applicant's to read)",
          ap[2] == "busy" and ap[3].startswith("the house manager is working then")
          and "7A-3P" not in ap[3], ap)
    check("the house manager's Requests row shows it, and Approve is not theirs to press yet",
          L("feed_hm_training") == ["busy", False], L("feed_hm_training"))
    check("the application row beside it says the same",
          L("feed_hm_application") == ["busy", False], L("feed_hm_application"))
    check("the person applying reads the same sentence about their own row, and approves nothing",
          L("feed_trainee") == ["busy", False], L("feed_trainee"))
    check("the Houses list marks the applicant with no IST, and who would train them",
          L("houses_applicant") == [[False, "busy"]], L("houses_applicant"))
    check("the right-side panel shows the editor the shift's trainer and each applicant's",
          L("panel_editor") == ["busy", [[False, "busy"]]], L("panel_editor"))
    check("and shows the applicant their standing and the trainer, never the applicant list",
          L("panel_staff") == ["applied", "busy", False], L("panel_staff"))
    r = L("approve_busy") or []
    check("APPROVE on the training door is refused while the house manager works then",
          code_of(r) == "trainer_busy" and (r[3] or {}).get("state") == "busy", r)
    check("…and the approval is still waiting", (L("approve_busy_still_waiting") or [[0, 0]])[0][1]
          == "needs_training_approval", L("approve_busy_still_waiting"))
    r = L("decide_in_window") or []
    check("THE WINDOW RUNS TO ITS END: the house manager's decision is refused while applications "
          "are open, saying until when", code_of(r) == "window_open" and "open until" in str(r[2:3]), r)
    r = L("decide_busy") or []
    check("the house manager's decision is refused too, with the shift in the way",
          code_of(r) == "trainer_busy" and "is working 7A-3P at BM then" in str(r[2:3])
          and "The shift was not given" in str(r[2:3]), r)
    check("…and nothing was given — no cell, no claim", L("decide_busy_nothing") == ["", 0],
          L("decide_busy_nothing"))
    check("once a published calendar frees her, APPROVE goes through and names her to train",
          L("approve_free") == ["approved", 1, "Hana Boss"], L("approve_free"))
    check("and the decision gives the shift, with her as the trainer",
          L("decide_free") == [True, "Hana Boss", "8A-4P"], L("decide_free"))
    check("one first shift, ONE approved training row — the decision kept the approval",
          len(L("one_training_row") or []) == 1
          and L("one_training_row")[0][1:] == ["approved", "Hana Boss", "Hana Boss"],
          L("one_training_row"))
    check("the training is now Hana's commitment", any(
        x[0] == "training" and x[3] == "Zoe New" for x in L("hana_holds") or []), L("hana_holds"))
    check("an approved row on Requests says who trains", L("feed_trainer") == "Hana Boss",
          L("feed_trainer"))
    r = L("hana_given_overlap") or []
    check("nobody can give the house manager an overlapping shift while she trains",
          code_of(r) == "overlap" and "the training they give Zoe New" in str(r[2:3]), r)
    r = L("hana_drafted_overlap") or []
    check("…nor draft her onto one on Calendar Builder",
          code_of(r) == "overlap" and "the training they give Zoe New" in str(r[2:3]), r)
    r = L("calloff_busy") or []
    check("a call-off decision for somebody with no IST is refused while the manager works",
          code_of(r) == "trainer_busy" and "Rita Lead is working 8A-8P at JH then" in str(r[2:3]),
          r)
    check("a trained person is given the same call-off — the rule is about first shifts only",
          L("calloff_trained_unaffected") == ["allowed", True], L("calloff_trained_unaffected"))
    check("a swap to a receiver with no IST is MADE, marked as the house manager's training, "
          "with both NW managers as its approvers",
          L("swap_offer_made") == ["pending", True, "house_manager", ["Nia Day", "Nat Night"]]
          and L("swap_training_raised") == 1, [L("swap_offer_made"), L("swap_training_raised")])
    r = L("swap_reoffer_waiting") or []
    check("offered again while it waits, the cell already has an offer — and the training stays one",
          code_of(r) == "already_offered" and "applied for" not in str(r)
          and L("swap_training_still_one") == 1, [r, L("swap_training_still_one")])
    r = L("swap_approve_busy") or []
    check("APPROVE on the swap takes the training on, and is refused while both NW managers work",
          code_of(r) == "trainer_busy" and "all working then" in str(r), r)
    check("…and nothing changed: the manager's side and the training both still wait",
          L("swap_still_pending") == ["pending", 1], L("swap_still_pending"))
    check("once one is free, the other's approval takes the training on, naming the free one",
          L("swap_approve_other_free") == ["approved", "Nat Night", "approved"],
          L("swap_approve_other_free"))
    check("the training commits nobody until the receiver holds the shift",
          not any(x[0] == "training" for x in L("nat_before_swap") or []), L("nat_before_swap"))
    check("the receiver's yes completes it: the shift moves in the workbook",
          (L("swap_done") or [None])[0] == "done" and L("swap_done")[2:] == ["2P-10P", ""],
          L("swap_done"))
    check("with one training row, approved, Nat Night named",
          len(L("swap_training_rows") or []) == 1
          and L("swap_training_rows")[0][1] == "approved"
          and L("swap_training_rows")[0][3] == "Nat Night", L("swap_training_rows"))
    check("and from then on the training is Nat's commitment",
          any(x[0] == "training" and x[3] == "Zoe New" for x in L("nat_after_swap") or []),
          L("nat_after_swap"))
    said = str(L("draft_says"))
    check("a draft of a first shift says the house manager is working then",
          "the house manager Rita Lead is working 7A-7P at JH then" in said, said)
    r = L("publish_busy") or []
    cells = (r[3] if len(r) > 3 else None) or []
    check("the publish is blocked, naming the training nobody is free for, and writes nothing",
          code_of(r) == "blocked" and L("publish_busy_tab") in ("", None)
          and any(c.get("employee") == "Zoe New" and "Rita Lead is working 7A-7P at JH then"
                  in str(c.get("reason")) for c in cells),
          [r, L("publish_busy_tab")])
    check("with her own night drafted off in the same publish, it goes through",
          L("publish_free") == [1, "8A-4P", ""], L("publish_free"))
    check("the training recorded in the publisher's name, with her as trainer",
          (L("publish_training") or [[0, 0, 0, 0]])[-1][1:] == ["approved", "Rita Lead",
                                                                "Rita Lead"],
          L("publish_training"))
    check("a drag onto somebody with no IST is a draft — and the draft says the manager works then",
          L("drag") == [True, "8A-4P"]
          and "the house manager Hana Boss is working 8A-2P at BM then" in str(L("drag_says")),
          [L("drag"), L("drag_says")])
    r = L("drag_publish_busy") or []
    cells = (r[3] if len(r) > 3 else None) or []
    check("its publish is blocked on the training, and nothing is written",
          code_of(r) == "blocked"
          and any(c.get("employee") == "Yan First" and "Hana Boss is working 8A-2P" in
                  str(c.get("reason")) for c in cells)
          and L("drag_wrote_nothing") == ["8A-4P", None], [r, L("drag_wrote_nothing")])
    check("MK on Requests: a director reading the row is the one who would train, and is free",
          L("mk_feed_director") == ["above_free", "Rae Director", True], L("mk_feed_director"))
    check("…while the trainee reads that whoever approves trains, and approves nothing",
          L("mk_feed_trainee") == ["above", False], L("mk_feed_trainee"))
    check("the director approves, and is named to train",
          L("mk_approved") == ["approved", "Rae Director"], L("mk_approved"))
    check("a training whose shift the trainee does not hold commits nobody",
          not any(x[0] == "training" and x[1] == "CAN - MK - MK11787"
                  for x in L("rae_holds") or []), L("rae_holds"))
    r = L("unreadable_approve") or []
    check("an unreadable manager list refuses APPROVE — never a free house manager",
          code_of(r) == "trainer_unreadable" and "the mirror is down" in str(r[2:3]), r)
    check("…and the one gate says 'ask again' for it", L("unreadable_guard") == "guard_unreadable",
          L("unreadable_guard"))
    check("'Not approved' needs nobody to be free", L("not_approved_needs_nobody") == "refused",
          L("not_approved_needs_nobody"))


print(f"\n{results['ok']} ok, {len(results['failed'])} failed")
for name in results["failed"]:
    print("  FAILED:", name)
sys.exit(1 if results["failed"] else 0)
