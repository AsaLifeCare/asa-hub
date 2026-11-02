#!/usr/bin/env python3
"""Time off against the real functions: the pure half on the host, the lane in the relay's container."""
import ast
import base64
import contextlib
import importlib.util
import json
import os
import subprocess
import sys
import time
import types
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve()
ROOT = HERE.parent.parent
SERVER = ROOT / "server"
CONTAINER = os.getenv("HUB_RELAY_CONTAINER", "asa-hub-snapshot")
LANE_BUDGET_S = 300

results = {"ok": 0, "failed": []}


def check(name: str, ok: bool, detail=None) -> None:
    if ok:
        results["ok"] += 1
        print(f"  ok   {name}")
    else:
        results["failed"].append(name)
        print(f"  FAIL {name}")
        if detail is not None:
            print(f"       {str(detail)[:600]}")


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
import lane_schema  # noqa: E402 — beside this file
import redaction  # noqa: E402
import shift_requests as sr  # noqa: E402
import time_off as to  # noqa: E402

TODAY = to.today()
D = lambda n: (TODAY + timedelta(days=n)).isoformat()  # noqa: E731

print("\nthe declaration")
spec = importlib.util.spec_from_file_location("mint_time_off_house", ROOT / "tools" / "mint_time_off_house.py")
mint = importlib.util.module_from_spec(spec)
real_urlopen = urllib.request.urlopen
urllib.request.urlopen = lambda *a, **k: (_ for _ in ()).throw(AssertionError("an import reached the network"))
try:
    spec.loader.exec_module(mint)
    imported = []
    for name in ("grant_timeoff_access", "migrate_time_off"):
        s2 = importlib.util.spec_from_file_location(name, ROOT / "tools" / f"{name}.py")
        m2 = importlib.util.module_from_spec(s2)
        s2.loader.exec_module(m2)
        imported.append(name)
    network_free = True
except AssertionError:
    network_free = False
finally:
    urllib.request.urlopen = real_urlopen
check("the mint, the grant and the migration import without reaching the network", network_free)
check("the mint stamps the relay's own header (one declaration, read from server/time_off.py)",
      mint.declared("HEADER") == to.HEADER and mint.declared("SETTINGS_HEADER") == to.SETTINGS_HEADER)
check("the mint seeds an empty directors cell and never names anybody: the board is typed on Settings",
      mint.settings_seed()[0][:2] == ["directors", ""])
ref = to.new_ref()
check("a ref is TO and ten upper-case hex characters", bool(to.REF_RE.fullmatch(ref)) and len(ref) == 12, ref)
check("the same person across a middle initial, and not across a different first name",
      to.same_person("Lisa B. Bright", "Lisa Bright") and to.same_person("lisa  bright", "LISA B BRIGHT")
      and not to.same_person("Ty Bond", "Tyler Bond") and not to.same_person("", "Ty Bond"))

print("\nthe reason stays out of both copies")
row = {"id": "TO0000000001", "time_off_reason": "a surgery", "person": "Ann Roe"}
red, n = redaction.redact_row(row)
check("the mirror and the master JSON withhold time_off_reason as [withheld: private]",
      red["time_off_reason"] == "[withheld: private]" and n == 1 and red["person"] == "Ann Roe", red)
check("an empty reason stays empty, so no marker says who gave one",
      redaction.redact_row({"time_off_reason": "", "id": "x"})[1] == 0)
check("the purge's own check still recognises the rule", redaction.redacts((SERVER / "redaction.py").read_text()))

print("\nwho reads what")
H1, H2 = "CAN - 48TH (B) - ABD1711", "CAN - JH - ABD2704"
EST = {"locations": [H1, H2], "by_code": {"ABD1711": H1, "ABD2704": H2},
       "people": {H1: ["OPEN", "Ann Roe", "Mia Manager"], H2: ["OPEN", "Ben Left"]},
       "cells": {H1: {("Ann Roe", D(2)): "8A-4P", ("Mia Manager", D(2)): "8A-4P"},
                 H2: {("Ben Left", D(3)): "8A-4P"}},
       "isos": {H1: [D(i) for i in range(6)], H2: [D(i) for i in range(6)]}, "worked": {}, "spans": {}}
MANAGERS = {"readable": True, "why": "", "by_code": {
    "ABD1711": {"name": "Mia Manager", "names": ["Mia Manager"], "phone": "", "house": H1, "last_day": ""}}}
# The board as a house's Settings cell would name it: the relay itself carries no names.
DIRS = ["Ty Bond", "Lisa B. Bright"]


def who(name, role="staff", badges=("STAFF",), manages=(), everywhere=False):
    return {"name": name, "role": role, "badges": list(badges), "manages": list(manages),
            "decides_everywhere": everywhere, "whole_company": everywhere}


ANN, MIA = who("Ann Roe"), who("Mia Manager", badges=("STAFF", "HM"), manages=("ABD1711",))
TY, LISA = who("Ty Bond", badges=("STAFF",)), who("Lisa Bright")
BOSS = who("Shylah Walker", role="admin", badges=("ADMIN",), everywhere=True)
ROLE_MGR = who("Rob Role", role="manager", badges=("MANAGER",))
CLIENT, GUARD = who("Cal Client", role="client", badges=("CLIENT",)), who("Gus Guard", role="guardian", badges=())
check("client and guardian are refused before any row is read",
      to.scope_of(CLIENT, DIRS) == "refused" and to.scope_of(GUARD, DIRS) == "refused"
      and to.scope_of(who("Ina Int", role="interviewer"), DIRS) == "refused"
      and to.scope_of(who("On Board", role="onboarding"), DIRS) == "refused")
check("staff read their own; a current ** manager their houses; the role manager, the directors on the "
      "list and the every-house badges read all",
      [to.scope_of(x, DIRS) for x in (ANN, MIA, ROLE_MGR, TY, LISA, BOSS)]
      == ["own", "houses", "all", "all", "all", "all"])
check("the director list is the only thing that makes a director — a DIRECTOR badge reads all as a badge, "
      "but a name off the list decides no director half",
      not to.is_director(who("Dana Dir", badges=("DIRECTOR",), everywhere=True), DIRS)
      and to.is_director(LISA, DIRS))

print("\nfiling: every refusal in words")
PEND = {"id": "TO00000000AA", "person": "Ann Roe", "status": "pending", "start_date": D(10), "end_date": D(11),
        "hm_state": "waiting", "dir_state": "waiting"}


def refusals(w, person, a, b, existing=(), reason=""):
    return to.validate(who=w, person=person, start=a, end=b, reason=reason, existing=list(existing),
                       est=EST, dirs=DIRS)


t = lambda n: TODAY + timedelta(days=n)  # noqa: E731
r1 = refusals(ANN, "Ann Roe", t(5), t(3))
r2 = refusals(MIA, "Other", t(5), t(6))
r3 = refusals(ANN, "Ann Roe", t(-2), t(1))
r4 = refusals(ANN, "Ben Left", t(5), t(6))
r4b = refusals(MIA, "Ben Left", t(5), t(6))
r5 = refusals(ANN, "Ann Roe", t(11), t(12), existing=[PEND])
r6 = refusals(ANN, "Ann Roe", t(5), t(6), reason="x" * 501)
check("an end before the start", r1 == ["the end date is before the start date"], r1)
check("'Other' is not a person", any("'Other' and blank are not a person" in r for r in r2), r2)
check("time off already started is filed by a director or an administrator, not by staff",
      any("already started" in r for r in r3) and not refusals(BOSS, "Ann Roe", t(-2), t(1)), r3)
check("staff file for themselves only; a house manager for the people drawn on their houses",
      any("for yourself only" in r for r in r4) and any("not drawn on a house you manage" in r for r in r4b), [r4, r4b])
check("overlapping one's own request says which one and what it waits on",
      any("TO00000000AA" in r and "waiting on the house manager and a director" in r for r in r5), r5)
check("a reason over 500 characters is refused", any("500 characters" in r for r in r6), r6)
check("a clean request has no refusal", refusals(ANN, "Ann Roe", t(20), t(22)) == [])

print("\nwho approves")
a1 = to.approvers(est=EST, managers=MANAGERS, person="Ann Roe", houses=["ABD1711"], filed_by="Ann Roe", dirs=DIRS)
a2 = to.approvers(est=EST, managers=MANAGERS, person="Ann Roe", houses=["ABD1711"], filed_by="Mia Manager",
                  dirs=DIRS)
a3 = to.approvers(est=EST, managers=MANAGERS, person="Mia Manager", houses=["ABD1711"], filed_by="Mia Manager",
                  dirs=DIRS)
a4 = to.approvers(est=EST, managers={"readable": False, "why": "mirror down"}, person="Ann Roe",
                  houses=["ABD1711"], filed_by="Ann Roe", dirs=DIRS)
a5 = to.approvers(est=EST, managers=MANAGERS, person="Ty Bond", houses=["ABD2704"], filed_by="Ty Bond", dirs=DIRS)
check("the house-manager half goes to the house's current ** manager",
      a1["hm_mode"] == "house_manager" and a1["hm_names"] == ["Mia Manager"] and "48TH (B)" in a1["hm_why"], a1)
check("…never to whoever filed it, which hands it above",
      a2["hm_mode"] == "above" and a2["hm_names"] == [], a2)
check("…nor to the person themselves (a house manager's own request goes above)",
      a3["hm_mode"] == "above", a3)
check("managers that cannot be read hand nothing upward — the request waits for the next pass",
      a4["readable"] is False and a4["hm_mode"] == "" and "could not be read" in a4["hm_why"], a4)
check("the director half is the list, never derived — and never the person themselves",
      a1["dir_names"] == DIRS and a5["dir_names"] == ["Lisa B. Bright"], a5)
a6 = to.approvers(est=EST, managers=MANAGERS, person="Ty Bond", houses=["ABD2704"], filed_by="Lisa B. Bright",
                  dirs=DIRS)
a7 = to.approvers(est=EST, managers=MANAGERS, person="Ann Roe", houses=["ABD2704"], filed_by="Ann Roe", dirs=[])
a8 = to.approvers(est=EST, managers=MANAGERS, person="Ann Roe", houses=["ABD2704"], filed_by="Ann Roe", dirs=DIRS)
check("A LIST WHOSE EVERY NAME IS IN THE REQUEST IS NOT A LIST THAT NAMES NOBODY: the whole list is handed "
      "on, nobody may answer, and the sentence says why",
      a6["dir_listed"] == DIRS and a6["dir_names"] == [] and "every director on the Time Off list" in a6["dir_why"]
      and "names no director" not in a6["dir_why"], a6)
check("…while a blank list says it names nobody, and hands on an empty list",
      a7["dir_listed"] == [] and a7["dir_names"] == [] and a7["dir_why"] == to.NO_DIRECTORS, a7)
check("THE ABOVE SENTENCE IS WORDED FROM THE LIST: a listed director is named as a way only while one may "
      "answer, never while the list is blank or every name is in the request",
      a8["hm_mode"] == "above" and "a director on the Time Off list approves in their place" in a8["hm_why"]
      and a7["hm_mode"] == "above" and "Time Off list" not in a7["hm_why"]
      and a6["hm_mode"] == "above" and "Time Off list" not in a6["hm_why"], [a6["hm_why"], a7["hm_why"], a8["hm_why"]])

print("\nthe two legs")
ROW = {"id": "TO00000000B1", "person": "Ann Roe", "filed_by": "Ann Roe", "status": "pending",
       "houses": "ABD1711", "hm_mode": "house_manager", "hm_asked": "Mia Manager", "hm_state": "waiting",
       "dir_state": "waiting", "start_date": D(10), "end_date": D(12)}
leg = lambda w, r=ROW, m=MANAGERS: to.leg_for(w, r, DIRS, m)  # noqa: E731
check("the house manager fills the house-manager half, a listed director the director half",
      leg(MIA)[0] == "hm" and leg(TY)[0] == "dir" and leg(LISA)[0] == "dir")
check("nobody decides their own time off", leg(ANN)[:2] == ("", "you cannot decide your own time off"))
filed = {**ROW, "filed_by": "Mia Manager", "person": "Ben Left", "hm_mode": "above", "hm_asked": ""}
check("nobody decides a request they filed", leg(MIA, filed)[1] == "you filed this request — the other half is "
                                                                      "somebody else's")
both = {**ROW, "hm_state": "approved", "hm_by": "Ty Bond"}
check("one person fills one half at most",
      leg(TY, both)[1] == "Ty Bond already approved as house manager — a director approves the other half")
check("only the directors on the list approve the director half",
      "only the directors on the Time Off list" in leg(BOSS, {**ROW, "hm_state": "approved", "hm_by": "Mia Manager"})[1])
MASTER_READER = {**who("Main Account", role="admin", badges=("ADMIN", "MASTER"), everywhere=True), "is_master": True}
hm_done = {**ROW, "hm_state": "approved", "hm_by": "Mia Manager"}
check("the master's own session is an eligible director: it fills the director half as a director would",
      leg(MASTER_READER, hm_done)[0] == "dir" and leg(MASTER_READER)[0] == "dir")
check("…but never the other half too, never the master's own request, and never without a name the half is "
      "recorded by",
      leg(MASTER_READER, {**ROW, "hm_mode": "above", "hm_asked": "", "hm_state": "approved",
                          "hm_by": "Main Account"})[2] == "one_leg"
      and leg(MASTER_READER, {**ROW, "person": "Main Account"})[2] == "own"
      and leg({**MASTER_READER, "name": ""}, hm_done)[0] == "")
check("…while the flag is the session's alone: a MASTER badge word without it is not a director",
      leg({**MASTER_READER, "is_master": False}, hm_done)[0] == ""
      and leg({**MASTER_READER, "is_master": "yes"}, hm_done)[0] == "")
unread = {**ROW, "hm_mode": ""}
check("who manages the house could not be read — nothing is decided on that half",
      "could not be read — nothing was decided" in leg(BOSS, unread, {"readable": False})[1])
src_to = (SERVER / "time_off.py").read_text(encoding="utf-8")


def _raises_unreadable(fn):
    try:
        fn()
    except to.Unreadable as exc:
        return str(exc)
    return None


check("NO NAME IN CODE IS A BOARD: the relay declares no default directors, the settings defaults carry no "
      "directors key at all, a blank cell names nobody, and a missing row is UNREADABLE — never an empty board",
      "DIRECTORS_DEFAULT" not in src_to and "Ty Bond" not in src_to and "Lisa B" not in src_to
      and "directors" not in to.SETTINGS_DEFAULTS and to.directors_of({"directors": ""}) == []
      and to.directors_of({"directors": "A One, B Two"}) == ["A One", "B Two"]
      and "could not be read" in str(_raises_unreadable(lambda: to.directors_of({}))))
b_blank = to.board({"minted": True, "settings": {"directors": ""}})
b_unread = to.board({"minted": True, "settings": {}})
b_none = to.board({"minted": False, "settings": {}})
check("the board says which it is: blank is readable with nobody named and the half waits; a missing row and "
      "an unminted house are unreadable, each with its sentence",
      b_blank == {"readable": True, "names": [], "why": to.NO_DIRECTORS} and "waits" in to.NO_DIRECTORS
      and b_unread["readable"] is False and b_unread["names"] == [] and "could not be read" in b_unread["why"]
      and b_none["readable"] is False and "not set up" in b_none["why"], [b_blank, b_unread, b_none])

# the house's own Settings tab, read through view(): a blank row and no row are two different answers
_held_overlay, _held_retire = to._overlay, to._retire
to._overlay, to._retire = (lambda dsn: []), (lambda dsn, gone: None)
try:
    h_blank = to.MemoryHouse()
    h_blank.tabs["settings"].append(["directors", "", "the director half", to.stamp()])
    h_blank.sync()
    to.use_house(h_blank)
    v_blank = to.view("dsn", fresh=True)
    h_none = to.MemoryHouse()
    h_none.tabs["settings"].append(["form_sync", "on", "", to.stamp()])
    h_none.sync()
    to.use_house(h_none)
    v_none = to.view("dsn", fresh=True)
finally:
    to.use_house(None)
    to._overlay, to._retire = _held_overlay, _held_retire
check("view(): a blank directors row is present and blank; a tab with no directors row leaves the key out, "
      "so every reader raises Unreadable instead of reading nobody",
      v_blank["settings"].get("directors") == "" and "directors" not in v_none["settings"]
      and to.board(v_blank)["readable"] is True and to.board(v_none)["readable"] is False,
      [v_blank["settings"], v_none["settings"]])

_held_view, _held_lock, _held_update = to.view, to.id_lock, to.update_row
_held_managers, _held_estate = sr.house_managers, sr.estate
writes = []
to.id_lock = lambda dsn, ref: contextlib.nullcontext()
to.update_row = lambda dsn, tab, new, prev: writes.append(dict(new)) or dict(new)
sr.house_managers = lambda dsn, **k: MANAGERS
sr.estate = lambda dsn, **k: EST
try:
    to.view = lambda dsn, fresh=False: {"minted": True, "id": "house", "as_of": "", "settings": {"directors": ""},
                                        "settings_rows": [{"key": "directors", "value": ""}], "rows": [dict(ROW)]}
    no_board_reply = to.match_reply("dsn", ref=ROW["id"], name="Ty Bond", who={"name": "Ty Bond"})
    no_board_decide = None
    try:
        to.decide("dsn", TY, ROW["id"], "approve")
    except to.Refused as exc:
        no_board_decide = [exc.code, exc.why]
    refused_writes = len(writes)
    hm_blank = to.decide("dsn", MIA, ROW["id"], "approve")
    blank_preview = to.preview("dsn", ANN, {"start": D(20), "end": D(21)})
    blank_board = to.board(to.view("dsn"))
    blank_feed = to.feed("dsn", MIA)
    blank_shape = to.shape(hm_blank, MIA, [], MANAGERS, EST, brd=blank_board)
    named_shape = to.shape(hm_blank, MIA, DIRS, MANAGERS, EST, brd={"readable": True, "names": DIRS, "why": ""})
    own_shape = to.shape({**hm_blank, "person": "Ty Bond", "filed_by": "Ty Bond"}, MIA, ["Ty Bond"], MANAGERS, EST,
                         brd={"readable": True, "names": ["Ty Bond"], "why": ""})
    settle_notes = []
    _held_notice = to._notice
    to._notice = lambda dsn, kind, key, row, approvers_of, extra=None: settle_notes.append(
        [kind, key, list(approvers_of)])
    try:
        writes.clear()
        blank_settle = to.settle("dsn")
        blank_settle_writes = len(writes)
        ROW_TY = {**ROW, "id": "TO00000000B2", "person": "Ty Bond", "filed_by": "Ty Bond"}
        to.view = lambda dsn, fresh=False: {"minted": True, "id": "house", "as_of": "",
                                            "settings": {"directors": ", ".join(DIRS)},
                                            "settings_rows": [], "rows": [dict(ROW), dict(ROW_TY)]}
        named_feed = to.feed("dsn", MIA)
        writes.clear()
        named_settle = to.settle("dsn")
        named_settle_writes = [[w["id"], w["dir_asked"]] for w in writes]
        # filed while the only name on the list was the request's own person: asked, but nobody who may
        # answer; a second name saved later is written on the row and rung like a blank list's
        ROW_OWN = {**ROW, "id": "TO00000000B3", "person": "Ty Bond", "filed_by": "Ty Bond", "dir_asked": "Ty Bond"}
        ROW_ASKED = {**ROW, "id": "TO00000000B4", "dir_asked": "Lisa B. Bright"}
        own_rows = [dict(ROW_OWN), dict(ROW_ASKED)]
        to.view = lambda dsn, fresh=False: {"minted": True, "id": "house", "as_of": "",
                                            "settings": {"directors": ", ".join(DIRS)},
                                            "settings_rows": [], "rows": [dict(r) for r in own_rows]}
        writes.clear()
        notes_before = len(settle_notes)
        own_settle = to.settle("dsn")
        own_settle_writes = [[w["id"], w["dir_asked"]] for w in writes]
        own_settle_notes = settle_notes[notes_before:]
        del settle_notes[notes_before:]
        own_rows = [dict(writes[0]) if writes else dict(ROW_OWN), dict(ROW_ASKED)]
        writes.clear()
        own_again = to.settle("dsn")
        own_again_writes = len(writes)
        own_rows = [dict(ROW_OWN), dict(ROW_ASKED),
                    {**ROW, "id": "TO00000000B5", "person": "Ty Bond", "filed_by": "Ty Bond"}]
        to.view = lambda dsn, fresh=False: {"minted": True, "id": "house", "as_of": "",
                                            "settings": {"directors": "Ty Bond"},
                                            "settings_rows": [], "rows": [dict(r) for r in own_rows]}
        writes.clear()
        own_alone = to.settle("dsn")
        own_alone_writes = len(writes)
    finally:
        to._notice = _held_notice

    to.view = lambda dsn, fresh=False: {"minted": True, "id": "house", "as_of": "", "settings": {},
                                        "settings_rows": [], "rows": [dict(ROW)]}
    writes.clear()
    unread_reply = _raises_unreadable(
        lambda: to.match_reply("dsn", ref=ROW["id"], name="Mia Manager", who={"name": "Mia Manager"}))
    unread_decide = _raises_unreadable(lambda: to.decide("dsn", MIA, ROW["id"], "approve"))
    unread_writes = len(writes)
    unread_preview = to.preview("dsn", ANN, {"start": D(20), "end": D(21)})
    unread_request = None
    try:
        to.request("dsn", ANN, {"start": D(20), "end": D(21)})
    except to.Unreadable as exc:
        unread_request = ["Unreadable", str(exc)]
    except to.Refused as exc:
        unread_request = ["Refused", exc.code]
    unread_feed_mia, unread_feed_ann = to.feed("dsn", MIA), to.feed("dsn", ANN)
    unread_tab = to.requests_tab("dsn", MIA, EST)
    unread_settle_writes = len(writes)
    to.settle("dsn")
    unread_settle_writes = len(writes) - unread_settle_writes
    to.view = lambda dsn, fresh=False: {"minted": True, "id": "house", "as_of": "", "rows": [],
                                        "settings": {"form_sync": "on", "form_cutover_at": to.stamp()},
                                        "settings_rows": []}
    unread_form = to.form_sync("dsn", force=True)
finally:
    to.view, to.id_lock, to.update_row = _held_view, _held_lock, _held_update
    sr.house_managers, sr.estate = _held_managers, _held_estate
check("while the cell is blank, a text answering the director half is refused with the reason, never read as "
      "'not waiting on you'",
      no_board_reply["leg"] == "" and no_board_reply["code"] == "no_directors"
      and "names no director" in no_board_reply["why"] and "waits" in no_board_reply["why"], no_board_reply)
check("…and a director's decision on the screen is refused the same way, before any write",
      no_board_decide is not None and no_board_decide[0] == "no_directors" and refused_writes == 0,
      [no_board_decide, refused_writes])
check("A BLANK CELL IS NOT A STOP: the house manager still decides the house manager half, and the request "
      "stays pending with the director half waiting, said on the row as it is read",
      hm_blank["status"] == "pending" and hm_blank["hm_state"] == "approved" and hm_blank["hm_by"] == "Mia Manager"
      and hm_blank["dir_state"] == "waiting" and "names no director" in blank_shape["status_why"]
      and "waits" in blank_shape["status_why"], [hm_blank, blank_shape["status_why"]])
check("THE ROW NEVER STORES WHAT THE LIST SAID: once a name is saved the same row reads plainly, never "
      "'names no director' beside an Approve button",
      "names no director" not in hm_blank["status_why"] and named_shape["status_why"] == hm_blank["status_why"]
      and "waiting on the director" in named_shape["status_why"], [hm_blank["status_why"], named_shape["status_why"]])
check("…and a list whose every name is the request's own person says that, never that it names nobody",
      "every director on the Time Off list (Ty Bond) is part of this request" in own_shape["status_why"]
      and "names no director" not in own_shape["status_why"], own_shape["status_why"])
bw, nw = blank_feed["hero"]["waiting"], named_feed["hero"]["waiting"]
check("a blank list and a named one both give the house manager a count they can vouch for — every request "
      "waiting on their half is counted",
      bw["on_me"] == 1 and bw["count"] == 1 and nw["on_me"] == 2 and nw["count"] == 2
      and blank_feed["me"]["waiting_on_me"] == 1
      and blank_feed["directors_readable"] is True and "names no director" in blank_feed["directors_why"],
      [bw, nw, blank_feed["directors_why"]])
check("A NAME SAVED LATER IS WRITTEN ON THE ROW: the next pass records the directors asked on a request filed "
      "while the list named nobody, and tells them on the bell — never the person themselves",
      blank_settle.get("directors_asked") == 0 and blank_settle_writes == 0
      and named_settle.get("directors_asked") == 2
      and sorted(named_settle_writes) == sorted([[ROW["id"], ", ".join(DIRS)], ["TO00000000B2", ", ".join(DIRS)]])
      and sorted(settle_notes) == sorted([["time_off_asked", f"time_off_asked:{ROW['id']}:directors", DIRS],
                                          ["time_off_asked", "time_off_asked:TO00000000B2:directors",
                                           ["Lisa B. Bright"]]]),
      [blank_settle, named_settle, named_settle_writes, settle_notes])
check("A LIST THAT ASKED NOBODY WHO MAY ANSWER IS ADOPTED LIKE A BLANK ONE: a request filed while its own person "
      "was the whole list gets the name saved later on the row and on the bell, a row that already asked a "
      "director who may answer is left alone, and the pass does it once",
      own_settle.get("directors_asked") == 1 and own_settle_writes == [["TO00000000B3", ", ".join(DIRS)]]
      and own_settle_notes == [["time_off_asked", "time_off_asked:TO00000000B3:directors", ["Lisa B. Bright"]]]
      and own_again.get("directors_asked") == 0 and own_again_writes == 0,
      [own_settle, own_settle_writes, own_settle_notes, own_again, own_again_writes])
check("…and while the list still names nobody who may answer, the row is not rewritten to ask them",
      own_alone.get("directors_asked") == 0 and own_alone_writes == 0, [own_alone, own_alone_writes])
uw_mia, uw_ann = unread_feed_mia["hero"]["waiting"], unread_feed_ann["hero"]["waiting"]
check("AN UNREADABLE LIST IS NEVER 'NONE WAITING ON YOU': the house manager's count is unknown (None), the row "
      "says unknown, and the feed carries the sentence",
      uw_mia["on_me"] is None and uw_mia["soon_on_me"] is None and unread_feed_mia["me"]["waiting_on_me"] is None
      and unread_feed_mia["rows"][0]["waiting_on_me"] is None and unread_feed_mia["rows"][0]["leg"] == ""
      and unread_feed_mia["directors_readable"] is False and "could not be read" in unread_feed_mia["directors_why"]
      and "could not be read" in unread_feed_mia["rows"][0]["status_why"],
      [uw_mia, unread_feed_mia["me"], unread_feed_mia["rows"][:1]])
check("…while the person's own request is still known not to wait on them",
      uw_ann["on_me"] == 0 and unread_feed_ann["rows"][0]["waiting_on_me"] is False, [uw_ann, unread_feed_ann["rows"][:1]])
check("…and Calendar Builder's Requests tab carries the same sentence beside its rows",
      unread_tab["readable"] is True and unread_tab["directors_readable"] is False
      and "could not be read" in unread_tab["directors_why"]
      and "could not be read" in unread_tab["rows"][0]["decided_why"], unread_tab)
check("…and a request filed against it is a read that failed (Unreadable, 503), never 'invalid' input",
      unread_request is not None and unread_request[0] == "Unreadable" and "could not be read" in unread_request[1],
      unread_request)
check("…and the pass that records directors asked writes nothing while the list cannot be read",
      unread_settle_writes == 0, unread_settle_writes)
check("…and filing is not refused for it: the preview is clean and says the director half waits",
      blank_preview["ok"] is True and "waits" in blank_preview["directors_why"]
      and "waits" in (blank_preview.get("asked") or {}).get("dir_why", ""), blank_preview)
check("AN UNREADABLE LIST DECIDES NOTHING: a text waits (Unreadable, which the ear holds), a decision raises "
      "before any write — the house manager half included",
      "could not be read" in str(unread_reply) and "could not be read" in str(unread_decide)
      and unread_writes == 0, [unread_reply, unread_decide, unread_writes])
check("…a request is not filed against it, and the preview says why",
      unread_preview["ok"] is False and any("could not be read" in r and "nothing can be filed" in r
                                            for r in unread_preview["refusals"]), unread_preview)
check("…and the form sync waits behind its watermark, saying why",
      unread_form.get("skipped") == "directors unreadable" and "could not be read" in unread_form.get("why", ""),
      unread_form)
above = {**ROW, "hm_mode": "above", "hm_asked": ""}
check("in `above` mode a listed director or an every-house badge fills the house-manager half",
      leg(BOSS, above)[0] == "hm" and leg(TY, above)[0] == "dir" and leg(MIA, above)[0] == "")
check("the second approval schedules; a denial ends it; one approval alone waits",
      to.next_status({**ROW, "dir_state": "approved"}, "hm", "approve") == "scheduled"
      and to.next_status(ROW, "hm", "approve") == "pending"
      and to.next_status(ROW, "dir", "deny") == "denied"
      and to.next_status({**ROW, "hm_state": "migrated"}, "dir", "approve") == "scheduled")
sched = {**ROW, "status": "scheduled", "start_date": D(3)}
check("withdraw: the person or the filer, while pending or before the first day of scheduled time off",
      to.may_withdraw(ANN, ROW) and to.may_withdraw(ANN, sched) and not to.may_withdraw(MIA, ROW)
      and not to.may_withdraw(ANN, {**sched, "start_date": D(0)}))
check("cancel: scheduled rows only, by a listed director, an every-house badge or the house's manager",
      to.may_cancel(TY, sched, DIRS) and to.may_cancel(MIA, sched, DIRS) and to.may_cancel(BOSS, sched, DIRS)
      and not to.may_cancel(ANN, sched, DIRS) and not to.may_cancel(TY, ROW, DIRS))
check("the reason is read by the person, whoever filed it, its approvers and the badges above — not by staff",
      to.reason_visible(ANN, ROW, DIRS) and to.reason_visible(MIA, ROW, DIRS) and to.reason_visible(TY, ROW, DIRS)
      and to.reason_visible(BOSS, ROW, DIRS) and not to.reason_visible(who("Ben Left"), ROW, DIRS))
check("rows are cut per reader: staff see their own, a manager their houses, the directors all",
      to.sees_row(ANN, ROW, "own") and not to.sees_row(who("Ben Left"), ROW, "own")
      and to.sees_row(MIA, ROW, "houses", set()) and to.sees_row(TY, ROW, "all"))

print("\nwhat is owed, by state")
now = datetime.now(timezone.utc)
fresh = to.stamp(now)
w_p = to.wanted(ROW, DIRS, MANAGERS, now)
w_above = to.wanted({**ROW, "hm_mode": "above", "hm_asked": ""}, DIRS, MANAGERS, now)
w_s = to.wanted({**ROW, "status": "scheduled", "updatedAt": fresh,
                 "effects": json.dumps({"staged": [{"house": "ABD1711"}]})}, DIRS, MANAGERS, now)
w_d = to.wanted({**ROW, "status": "denied", "updatedAt": fresh}, DIRS, MANAGERS, now)
w_old = to.wanted({**ROW, "status": "denied", "updatedAt": to.stamp(now - timedelta(days=9))}, DIRS, MANAGERS, now)
w_mig = to.wanted({**ROW, "status": "scheduled", "filed_via": "migration", "updatedAt": fresh}, DIRS, MANAGERS, now)
check("pending: the named house manager and each listed director are asked",
      w_p == [("timeoff_ask_manager", "Mia Manager"), ("timeoff_ask_director", "Ty Bond"),
              ("timeoff_ask_director", "Lisa B. Bright")], w_p)
check("above: each listed director is asked once — two of them fill the two halves",
      [k for k, _ in w_above] == ["timeoff_ask_above", "timeoff_ask_above"], w_above)
check("scheduled: the person and the manager of a house that got open drafts",
      w_s == [("timeoff_scheduled", "Ann Roe"), ("timeoff_scheduled_manager", "Mia Manager")], w_s)
check("denied: the person; an old closed row owes nothing; a migrated row owes nothing ever",
      w_d == [("timeoff_denied", "Ann Roe")] and w_old == [] and w_mig == [], [w_d, w_old, w_mig])
drow = to.door_row({**ROW, "reason_given": "yes", "days": "3"}, "timeoff_ask_manager", "Mia Manager", [], EST)
check("the door row carries the ref, the link and a reason LINE — never the reason itself",
      drow["ref"] == "TO00000000B1" and drow["link_path"].endswith("?ref=TO00000000B1")
      and drow["reason_line"].startswith("A reason was given") and "time_off_reason" not in json.dumps(drow)
      and drow["id"] == "TO00000000B1:timeoff_ask_manager:miamanager", drow)

print("\nthe Builder's slice keeps its fields")
to_view = to.view
to.view = lambda dsn, fresh=False: {"minted": True, "id": "", "as_of": "", "settings": {}, "rows": [
    {**ROW, "status": "scheduled", "createdAt": "2026-09-01T10:00:00.000Z", "calendar_name": "ANN R"},
    {**ROW, "id": "TO00000000B2", "status": "history"}]}
try:
    b_rows, _stamp = to.for_builder("dsn")
finally:
    to.view = to_view
check("calendarRequests keeps name, startDate, endDate, pending and timestamp, and adds the state and ref",
      len(b_rows) == 1 and {"name", "startDate", "endDate", "pending", "timestamp", "calendarName", "state", "ref"}
      <= set(b_rows[0]) and b_rows[0]["pending"] is True and b_rows[0]["state"] == "scheduled", b_rows)

print("\nthe migration plan")
FORM = [
    (2, {"Timestamp": "1/2/2026 9:00:00", "Your Name": "Ann Roe", "Time off (start date)": t(10).strftime("%m/%d/%Y"),
         "Time off (end date) ": t(12).strftime("%m/%d/%Y"), "Calendar Name": "ANN R"}),
    (3, {"Timestamp": "1/3/2026 9:00:00", "Your Name": "ANN  ROE", "Time off (start date)": t(10).strftime("%m/%d/%Y"),
         "Time off (end date) ": t(12).strftime("%m/%d/%Y"), "Calendar Name": ""}),
    (4, {"Timestamp": "1/4/2026 9:00:00", "Your Name": "Ben Left", "Time off (start date)": "1/5/2025",
         "Time off (end date) ": "1/6/2025", "Calendar Name": "Not Found"}),
    (5, {"Timestamp": "1/5/2026 9:00:00", "Your Name": "Other", "Time off (start date)": t(4).strftime("%m/%d/%Y"),
         "Time off (end date) ": t(4).strftime("%m/%d/%Y"), "Calendar Name": ""}),
    (6, {"Timestamp": "1/6/2026 9:00:00", "Your Name": "Ann Roe", "Time off (start date)": t(40).strftime("%m/%d/%Y"),
         "Time off (end date) ": t(30).strftime("%m/%d/%Y"), "Calendar Name": ""}),
    (7, {"Timestamp": "1/7/2026 9:00:00", "Your Name": "Nobody Known", "Time off (start date)": t(4).strftime("%m/%d/%Y"),
         "Time off (end date) ": t(5).strftime("%m/%d/%Y"), "Calendar Name": ""}),
]
DETAILS = "Please provide the details of your request make sure to include names, dates, and shift times."
ARCH = [
    (2, {"Timestamp": "3/1/2024 8:00:00", "Your Name": "Ben Left", "Request Type": "Vacation Request",
         DETAILS: "May 27-28, June 3-5, July 7-11"}),
    (3, {"Timestamp": "12/20/2024 8:00:00", "Your Name": "Ben Left", "Request Type": "Vacation",
         DETAILS: "12-23-24 to 12-26-24 and 1/2-1/3"}),
    (4, {"Timestamp": "4/1/2024 8:00:00", "Your Name": "Ann Roe", "Request Type": "Vacation Request",
         DETAILS: "4/6-4/8"}),
    (5, {"Timestamp": "4/2/2024 8:00:00", "Your Name": "Ann Roe", "Request Type": "Vacation Request",
         DETAILS: "the week my sister visits"}),
    (6, {"Timestamp": "4/3/2024 8:00:00", "Your Name": "Ann Roe", "Request Type": "Call Offs / Sick Days",
         DETAILS: "4/9"}),
]
p = to.plan_migration({"staff_requests": FORM, "requests_archive": ARCH}, [], grid_names=["Ann Roe", "Ben Left"],
                      accounts=[], today=TODAY)
rows_ = p["rows"]
by_status = {}
for r in rows_:
    by_status.setdefault(r["status"], []).append(r)
ann = [r for r in by_status.get("scheduled", []) if r["person"] == "Ann Roe"]
check("an upcoming form row with a known name is SCHEDULED, both halves `migrated`",
      len(ann) == 1 and ann[0]["hm_state"] == "migrated" and ann[0]["dir_state"] == "migrated"
      and ann[0]["filed_via"] == "migration" and ann[0]["calendar_name"] == "ANN R", ann)
check("the same person and dates twice fold into ONE row, both sheet rows listed and flagged",
      ann and ann[0]["source_rows"] == "2, 3" and "duplicate" in ann[0]["flags"] and p["counts"]["duplicate"] == 1, ann)
review = {tuple(sorted(to._list(r["flags"]))) for r in by_status.get("needs_review", [])}
check("'Other', reversed dates and a name nobody holds wait for review when upcoming",
      ("name_other",) in review and ("reversed_dates",) in review and ("no_calendar_row",) in review, review)
check("a past form row is history", any(r["person"] == "Ben Left" and r["start_date"] == "2025-01-05"
                                        for r in by_status.get("history", [])))
legacy = sorted((r["start_date"], r["end_date"]) for r in rows_ if r["source"] == "legacy:requests_archive"
                and r["start_date"])
check("the old form's free text becomes ranges: several per row, a month named once, and the year rolled",
      ("2024-05-27", "2024-05-28") in legacy and ("2024-06-03", "2024-06-05") in legacy
      and ("2024-07-07", "2024-07-11") in legacy and ("2024-12-23", "2024-12-26") in legacy
      and ("2025-01-02", "2025-01-03") in legacy and ("2024-04-06", "2024-04-08") in legacy, legacy)
unparsed = [r for r in rows_ if "dates_unparsed" in r["flags"]]
check("a vacation row with no date is history with the flag; other request types are not migrated",
      len(unparsed) == 1 and unparsed[0]["status"] == "history"
      and not any(r["source_rows"] == "6" and r["source"].startswith("legacy") for r in rows_), unparsed)
check("the old form's details go to the withheld reason column, never elsewhere",
      all(r["time_off_reason"] and r["reason_given"] == "yes" for r in rows_ if r["source"].startswith("legacy"))
      and not any("sister" in json.dumps({k: v for k, v in r.items() if k != "time_off_reason"}) for r in rows_))
again = to.plan_migration({"staff_requests": FORM, "requests_archive": ARCH}, [r["source_key"] for r in rows_],
                          grid_names=["Ann Roe", "Ben Left"], accounts=[], today=TODAY)
check("a second plan against its own output appends 0", again["rows"] == [], again["counts"])
check("every planned row has a unique natural key", len({r["source_key"] for r in rows_}) == len(rows_))

print("\nthe SMS ear reads a TO ref")
try:
    import sms_ears  # noqa: E402
    got = sms_ears.read_text("yes TO1A2B3C4D5E thanks")
    two = sms_ears.read_text("YES TO1A2B3C4D5E SP0123456789")
    check("a TO ref is taken out before the word is read, so YES TO… is a yes",
          got["to"] == ["TO1A2B3C4D5E"] and got["word"] == "yes" and got["reply"], got)
    check("a text quoting two refs is two refs (the ear calls that ambiguous)",
          len(two["to"]) + len(two["sp"]) == 2, two)
    check("staff are told time off in their own words",
          sms_ears.staff_why("time_off") == "you are on approved time off that day")
except Exception as exc:  # noqa: BLE001
    check("the SMS ear imports on the host", False, repr(exc))

print("\nthe overlap law learns time off")
clash = {"source": "time_off", "col_iso": D(2), "until": D(4), "location": "", "value": "time off",
         "ref": "TO00000000B1"}
code, why = sr.clash_verdict("Jane Doe", clash)
check("a time-off clash is its own code and its own sentence",
      code == "time_off" and why.startswith("Jane Doe is on approved time off from ") and "TO0" not in why, why)
check("the clash that leaves the server carries the end day, never the ref",
      sr.clash_out(clash).get("until") == D(4) and "ref" not in sr.clash_out(clash))
check("a trainer on time off is said to be so",
      "is on time off then" in sr._working_line("Mia Manager", clash))
span = sr.span_of(D(1), "10P-8A")
interval = to._interval({"start_date": D(2), "end_date": D(2), "person": "Jane Doe", "id": "TO00000000B1"})
check("whole days: an overnight that runs into the first day off is refused",
      sr.clash_for(span, [interval]) is not None and sr.clash_for(sr.span_of(D(1), "8A-4P"), [interval]) is None)

print("\nwho is a director, and one person one half")
check("a director is the listed name, or it without its middle initial — never another middle or first name",
      to.is_director(who("Lisa Bright"), DIRS) and to.is_director(who("Lisa B Bright"), DIRS)
      and to.is_director(who("Ty Bond"), DIRS) and not to.is_director(who("Lisa Ann Bright"), DIRS)
      and not to.is_director(who("Lisa C. Bright"), DIRS) and not to.is_director(who("Ty X. Bond"), DIRS))
spelled_hm = {**ROW, "hm_state": "approved", "hm_by": "Ty Bond"}
check("the half one spelling approved is refused to every spelling of that person",
      leg(who("Ty M. Bond"), spelled_hm)[2] == "one_leg" and leg(TY, spelled_hm)[2] == "one_leg",
      [leg(who("Ty M. Bond"), spelled_hm), leg(TY, spelled_hm)])

print("\nreview, reach and the houses a request names")
nohouse = {**ROW, "status": "needs_review", "houses": ""}
check("a row with no house is reviewed by the badges above, never by any house manager",
      not to.may_review(MIA, nohouse, DIRS) and to.may_review(BOSS, nohouse, DIRS)
      and to.may_review(MIA, {**nohouse, "houses": "ABD1711"}, DIRS))
mig = {"filed_by": "Jon Smith", "start_date": D(12), "end_date": D(10)}
check("a migrated row keeps its form approval only for the form's own name and days",
      to.as_the_form_said(mig, "Jon A. Smith", t(10), t(12)) and not to.as_the_form_said(mig, "Bob Smith", t(10), t(12))
      and not to.as_the_form_said(mig, "Jon Smith", t(10), t(60))
      and not to.as_the_form_said({**mig, "filed_by": "Other"}, "Jon Smith", t(10), t(12)))
check("a ticked house counts only where the person has a calendar row, so it never widens who approves",
      to.houses_for(EST, "Ann Roe", t(20), t(21), ["ABD1711", "ABD2704"]) == ["ABD1711"],
      to.houses_for(EST, "Ann Roe", t(20), t(21), ["ABD1711", "ABD2704"]))
check("the reach refusal: staff for themselves, a house manager for the people drawn on their houses",
      to.reach_refusal(ANN, "Ben Left", EST, DIRS) and to.reach_refusal(MIA, "Ben Left", EST, DIRS)
      and not to.reach_refusal(MIA, "Ann Roe", EST, DIRS) and not to.reach_refusal(BOSS, "Ben Left", EST, DIRS))
check("the Builder reads the house only once the migration has set its cutover",
      not to.migrated({"minted": True, "settings": {}}) and not to.migrated({"minted": False, "settings": {
          "form_cutover_at": "x"}}) and to.migrated({"minted": True, "settings": {"form_cutover_at": to.stamp()}}))

print("\nthe book, the form and the migration")
old_w = datetime.now(timezone.utc) - timedelta(hours=1)
ov = [{"tab": "time_off", "id": "TO00000000D1", "row": {"id": "TO00000000D1", "updatedAt": to.stamp(old_w)},
       "row_number": 5, "written_at": old_w}]
kept, gone = to.lay([], ov, "time_off", as_of=old_w + timedelta(minutes=2))
kept2, gone2 = to.lay([], ov, "time_off", as_of=datetime.now(timezone.utc))
check("a row written here stays drawn until a copy made well after the write lacks it — then it is gone",
      len(kept) == 1 and not gone and not kept2 and gone2 == [("time_off", "TO00000000D1")], [kept, gone, kept2, gone2])
fr = {"person": "Ann Roe", "start_date": D(10), "end_date": D(11)}
check("a form row the platform would refuse waits for review, and says why",
      "overlaps TO00000000AA" in " ".join(to.form_problems(fr, [PEND], TODAY))
      and to.form_problems({**fr, "start_date": D(-1)}, [], TODAY) == ["it had already started when it was filed"]
      and to.form_problems({**fr, "end_date": D(10 + to.MAX_DAYS)}, [], TODAY)[0].startswith("it covers more than")
      and to.form_problems(fr, [], TODAY) == [])
one = [(9, {"Timestamp": "1/2/2026 9:00:00", "Your Name": "Jon Smith", "Time off (start date)": t(10).strftime("%m/%d/%Y"),
            "Time off (end date) ": t(12).strftime("%m/%d/%Y"), "Calendar Name": ""})]
k1 = to.plan_migration({"staff_requests": one}, [], grid_names=[], accounts=[], today=TODAY)["rows"][0]["source_key"]
k2 = to.plan_migration({"staff_requests": one}, [], grid_names=["Jon A. Smith"], accounts=["Jon B Smith"],
                       today=TODAY)["rows"][0]["source_key"]
k3 = to.plan_migration({"staff_requests": one}, [], grid_names=[], accounts=["Jon A. Smith"], today=TODAY,
                       live=True)["rows"][0]["source_key"]
check("a form row keys the same whoever the grid and the accounts name, in the migration and the form sync",
      k1 == k2 == k3, [k1, k2, k3])
late = to.plan_migration({"staff_requests": one}, [], grid_names=[], accounts=[], today=TODAY,
                         until=datetime(2026, 1, 1, tzinfo=timezone.utc))
check("the migration leaves form rows after its cutover to the form sync, which asks both approvers",
      late["rows"] == [] and late["counts"]["after_cutover"] == 1, late["counts"])
check("an ask says '1 day' and '3 days', never '1 days'",
      to.door_row({**ROW, "days": "1"}, "timeoff_ask_manager", "Mia Manager", [], EST)["days"] == "1 day"
      and to.door_row({**ROW, "days": "3"}, "timeoff_ask_manager", "Mia Manager", [], EST)["days"] == "3 days")

print("\nthe span law, read the same everywhere")
check("the eve's overnight clashes with the first day off; the eve's day shift and the day after do not",
      to.clashes(D(1), "11P-7A", t(2), t(3)) and not to.clashes(D(1), "7A-3P", t(2), t(3))
      and to.clashes(D(3), "7A-3P", t(2), t(3)) and not to.clashes(D(4), "7A-3P", t(2), t(3)))
eve_est = {**EST, "cells": {H1: {("Ann Roe", D(1)): "11P-7A", ("Ann Roe", D(0)): "11P-7A"}, H2: {}}}
check("…so what approving does lists the eve's overnight",
      [x["col_iso"] for x in to.touches(eve_est, "Ann Roe", t(2), t(3))] == [D(1)])
now_ = datetime.now(timezone.utc)
base = {**ROW, "status": "scheduled", "start_date": D(2), "end_date": D(3)}
est_s = {**EST, "cells": {H1: {("Ann Roe", D(2)): "8A-4P"}, H2: {}}}
no_claims = lambda k, a, b: []  # noqa: E731
seen_all = json.dumps({"state": "done", "staged": [{"location": H1, "col_iso": D(2)}], "unplaced": [],
                       "at": to.stamp(now_)})
unseen = json.dumps({"state": "done", "staged": [], "unplaced": [], "at": to.stamp(now_)})
unpl = json.dumps({"state": "done", "staged": [], "unplaced": [{"location": H1, "col_iso": D(2)}], "at": to.stamp(now_)})
check("the minute's pass owes nothing once the effects saw every cell, though the published grid still names them",
      not to.settle_owed({**base, "effects": seen_all}, est_s, TODAY, now_, claims_of=no_claims))
check("…owes a cell it never saw, at once",
      to.settle_owed({**base, "effects": unseen}, est_s, TODAY, now_, claims_of=no_claims))
check("…retries an unplaced shift only every ten minutes",
      not to.settle_owed({**base, "effects": unpl}, est_s, TODAY, now_, claims_of=no_claims)
      and to.settle_owed({**base, "effects": unpl}, est_s, TODAY, now_ + timedelta(minutes=11), claims_of=no_claims)
      and not to.settle_owed({**base, "effects": unpl}, est_s, TODAY, now_ + timedelta(minutes=11),
                             claims_of=no_claims, tried_at=now_ + timedelta(minutes=5)))
held_claim = [{"location": H2, "open_row": "OPEN", "col_iso": D(3), "value": "8A-4P"}]
check("…and owes a shift held only through a claim",
      to.settle_owed({**base, "effects": seen_all}, est_s, TODAY, now_, claims_of=lambda k, a, b: held_claim)
      and to.claimed_only(est_s, "Ann Roe", held_claim, t(2), t(3), TODAY)[0]["claim"] is True)

print("\nthe doors, called")
import __future__  # noqa: E402
import asyncio  # noqa: E402
import logging  # noqa: E402
import hotline_desk  # noqa: E402

svc = (SERVER / "snapshot_service.py").read_text(encoding="utf-8")
tree = ast.parse(svc)
first = next(i for i, n in enumerate(tree.body) if isinstance(n, ast.Assign)
             and any(getattr(t, "id", "") == "_TIME_OFF_DOWN" for t in n.targets))
# the slice ends where the time-off doors end: the viewer cache after them needs the whole relay
last = next((i for i, n in enumerate(tree.body) if i > first and isinstance(n, ast.Assign)
             and any(getattr(t, "id", "") == "VIEWER_CACHE_FRESH_S" for t in n.targets)), len(tree.body))
wanted_defs = {"_hotline_actor", "_daily_refusal", "_DAILY_REASONS"}
nodes = [n for n in tree.body[:first] if getattr(n, "name", "") in wanted_defs
         or (isinstance(n, ast.Assign) and any(getattr(t, "id", "") in wanted_defs for t in n.targets))]
routes: list[tuple[str, str]] = []


class _App:
    def _route(self, method):
        def deco(path):
            routes.append((method, path))
            return lambda f: f
        return deco

    get, post = property(lambda self: self._route("GET")), property(lambda self: self._route("POST"))


ACTORS = {"client": ("client", "u-client"), "guardian": ("guardian", "u-guardian"), "staff": ("staff", "u-staff"),
          "admin": ("admin", "u-admin")}
calls: list[str] = []


async def _session_actor(authorization):
    return ACTORS.get(authorization)


async def _requests_viewer(authorization):
    calls.append("viewer")
    role, uid = ACTORS[authorization]
    return {"name": "Ann Roe", "role": role, "badges": [role.upper()], "manages": []}, (role, uid)


class _Body:
    def __init__(self, body):
        self.body = body

    async def json(self):
        return self.body


stub_to = types.SimpleNamespace(**{k: getattr(to, k) for k in ("Refused", "Unreadable", "REF_RE", "refused_reader",
                                                                 "day_of", "shape")})
stub_to.feed = lambda dsn, who, house="": calls.append("feed") or {"rows": []}
stub_to.away = lambda dsn, names=(): calls.append("away") or {}
stub_to.settings_state = lambda dsn, probe=False: calls.append(f"settings probe={probe}") or {"minted": True}
stub_to.discard_test_rows = lambda dsn, who, note: calls.append("discard") or {"discarded": [], "failed": []}
ns = {"app": _App(), "Header": lambda default="": default, "Request": object, "Response": object, "Any": object,
      "asyncio": asyncio, "os": os,
      "SCHEDULING_EVENT": "scheduling", "SUPPORT_DESK_EVENT": "support-desk", "VEHICLE_CALENDAR_EVENT": "vehicle-calendar", "Path": Path, "log": logging.getLogger("test"), "time_off": stub_to, "PG_DSN": "postgresql://nowhere",
      "HUB_DB_SHEET_ID": "core", "MIRROR_TRUST_MAX_S": 60, "hotline_desk": hotline_desk,
      # the matrix is not the question here: staff and admin pass the gate as the backend's master would
      "_auth_master": {"staff": True, "admin": True},
      "_hotline_token": lambda a: a, "_session_actor": _session_actor, "_requests_viewer": _requests_viewer,
      "_mail_auth_ok": lambda body: body.get("service_secret") == "s", "build_all": None,
      "_notices_wake": lambda: None, "_housecal_rang": lambda: None}
# the relay's own `from __future__ import annotations` is not in the slice: its annotations stay unevaluated here too
exec(compile(ast.Module(body=nodes + tree.body[first:last], type_ignores=[]), "snapshot_service.time_off", "exec",
             flags=__future__.annotations.compiler_flag, dont_inherit=True), ns)
resp = types.SimpleNamespace(headers={})
paths = {p for _m, p in routes}
check("every Time Off door is declared, the test-row discard among them",
      {"/hub-lanes/time-off", "/hub-lanes/time-off/detail", "/hub-lanes/time-off/request", "/hub-lanes/time-off/decide",
       "/hub-lanes/time-off/withdraw", "/hub-lanes/time-off/cancel", "/hub-lanes/time-off/review",
       "/hub-lanes/time-off/settings", "/hub-lanes/time-off/away", "/hub-lanes/time-off/discard-test"} <= paths,
      sorted(paths))
refusals_ = {}
for role in ("client", "guardian"):
    calls.clear()
    got_ = asyncio.run(ns["lane_time_off"](resp, house="", authorization=role))
    refusals_[role] = [got_.get("status"), list(calls)]
check("a client's and a guardian's session are refused at the gate — no reader built, no row read",
      refusals_ == {"client": [403, []], "guardian": [403, []]}, refusals_)
calls.clear()
check("the away door refuses without the service secret and reads nothing",
      asyncio.run(ns["lane_time_off_away"](_Body({"from": D(1), "to": D(1)})))["status"] == 401 and calls == [], calls)
calls.clear()
check("…and answers with it", asyncio.run(ns["lane_time_off_away"](
    _Body({"from": D(1), "to": D(1), "service_secret": "s"})))["status"] == 200 and calls == ["away"], calls)
calls.clear()
staff_discard = asyncio.run(ns["lane_time_off_discard_test"](_Body({}), authorization="staff"))["status"]
admin_discard = asyncio.run(ns["lane_time_off_discard_test"](_Body({}), authorization="admin"))["status"]
check("discarding the test rows is the administrators' door", [staff_discard, admin_discard] == [403, 200]
      and calls.count("discard") == 1, [staff_discard, admin_discard, calls])
calls.clear()
asyncio.run(ns["lane_time_off_settings"](authorization="admin"))
check("reading the settings page writes nothing to the book (no probe)", calls == ["viewer", "settings probe=False"],
      calls)
check("the beats ride the attendance beat and the pool sweep",
      "await _time_off_post()" in svc and "await _time_off_sweep()" in svc)


# ── the lane: a real database, a stand-in house ─────────────────────────────

LANE = r'''
import json, os, threading, time
from datetime import datetime, timedelta, timezone
import psycopg2, psycopg2.extras
import house_cal_live, shift_handoff
import shift_requests as sr
import calendar_builder_houses as cbh
import effective_roster
import time_off as to
import web_notices
effective_roster.use_switch(lambda: {"on": False, "readable": True, "word": "off", "why": ""})
# every notice kind's situation switched on: the notices below are about what is stored, not the Desk
web_notices.set_situation_probe(lambda kind: {"armed": True, "unreadable": "", "why": ""})

DSN = os.environ["HUB_SNAPSHOT_PG_DSN"]
import lane_schema
ROOMS = lane_schema.Rooms(DSN, "time-off")
SCHEMA = ROOMS.name()
OUT = {}
H1 = "CAN - 48TH (B) - ABD1711"
H2 = "CAN - JH - ABD2704"
today = datetime.now(sr.OHIO).date()
ISOS = [(today + timedelta(days=i)).isoformat() for i in range(8)]
D = lambda n: ISOS[n]
NAMES = ("Ann Roe", "Ben Left", "Cy Far", "Dee Way", "Eve Gone", "Mia Manager")
# the IST settings as a read that landed, holding the shipped values
import ist_config
ist_config.pin(dict(ist_config.SHIPPED))
EVERY = {"done": 1, "owed": 0, "clients": [], "owed_for": []}
sr.ist_index = lambda dsn, **k: {"readable": True, "why": "", "rows": 0, "source": "test",
    "by_person": {sr.fold(n): {"ABD1711": dict(EVERY), "ABD2704": dict(EVERY)} for n in NAMES}}
MANAGERS = {"readable": True, "why": "", "by_code": {
    "ABD1711": {"name": "Mia Manager", "names": ["Mia Manager"], "phone": "", "house": H1, "last_day": ""}}}
sr.house_managers = lambda dsn, **k: MANAGERS


def grid(rows):
    return {"cols": [{"iso": i} for i in ISOS],
            "rows": [{"employee": e, "cells": [{"text": t} for t in cs]} for e, cs in rows]}


ROOMS.make()
T = ROOMS.path(SCHEMA)
HOUSE = to.MemoryHouse()
to.use_house(HOUSE)


def v(name, role="staff", types="STAFF"):
    return sr.viewer(T, name=name, role=role, types=types)


def refused(fn):
    try:
        got = fn()
        return ["allowed", got.get("code") if isinstance(got, dict) else got]
    except (sr.Refused, to.Refused) as exc:
        return ["refused", exc.code, getattr(exc, "why", "")]
    except Exception as exc:
        return ["raised", type(exc).__name__, str(exc)[:200]]


def drafts(loc=None):
    with psycopg2.connect(T) as c, c.cursor() as cur:
        cur.execute("SELECT location, employee, col_iso, value FROM asa_cal_builder_house_draft "
                    + ("WHERE location=%s " if loc else "") + "ORDER BY location, col_iso, employee",
                    (loc,) if loc else ())
        return [list(r) for r in cur.fetchall()]


def overlay_rows():
    with psycopg2.connect(T) as c, c.cursor() as cur:
        cur.execute("SELECT count(*) FROM asa_time_off_writes WHERE tab='time_off'")
        return cur.fetchone()[0]


try:
    GRIDS = {
        H1: grid([("OPEN", [""] * 8), ("OPEN 2", [""] * 8), ("Ann Roe", ["", "", "8A-4P", "", "", "", "", ""]),
                  ("Mia Manager", [""] * 8), ("Dee Way", ["", "", "4P-12A", "", "", "", "", ""]),
                  ("Cy Far", [""] * 8)]),
        H2: grid([("OPEN", ["", "", "8A-4P", "", "", "", "", ""]), ("Ben Left", ["", "", "", "8A-4P", "", "", "", ""]),
                  ("Eve Gone", ["", "", "8A-4P", "", "", "", "11P-7A", ""]), ("Cy Far", [""] * 8)]),
    }
    with psycopg2.connect(T) as c, c.cursor() as cur:
        cur.execute("CREATE TABLE asa_house_calendar_live (location TEXT PRIMARY KEY, grid JSONB, "
                    "updated_at TIMESTAMPTZ DEFAULT now())")
        cur.execute(house_cal_live.OVERRIDES_DDL)
        cur.execute(house_cal_live.CLAIMS_DDL)
        cur.execute(shift_handoff.HANDOFFS_DDL)
        cur.execute(shift_handoff.OPEN_INDEX_DDL)
        for stmt in sr.DDL:
            cur.execute(stmt)
        for loc, g in GRIDS.items():
            cur.execute("INSERT INTO asa_house_calendar_live (location, grid) VALUES (%s,%s)",
                        (loc, psycopg2.extras.Json(g)))
        c.commit()
    # every table the code reads is the lane's before its first read; the Call Off Tracker a stand-in
    import lane_schema
    OUT["owned"] = lane_schema.own_shift_lane(T, SCHEMA, LANE_DIR)
    cbh.use_workbook(cbh.MemoryWorkbook.from_grids(GRIDS))
    sr.forget_estate()
    cbh.ensure_tables(T)
    ann, mia, ty, lisa = v("Ann Roe"), v("Mia Manager"), v("Ty Bond", types="DIRECTOR"), v("Lisa Bright")
    OUT["builder_before_cutover"] = to.migrated(to.view(T, fresh=True))
    to.write_setting(T, "form_cutover_at", to.stamp(), "the lane's migration")
    OUT["builder_after_cutover"] = to.migrated(to.view(T, fresh=True))

    # ── the directors list: a missing row is unreadable, a blank cell waits, no name comes from code ──
    held_people, held_accounts = to.people_rows, to._accounts
    to.people_rows, to._accounts = (lambda: []), (lambda dsn: [])
    try:
        state_of = lambda st: [st["directors"], st["directors_readable"], st["directors_declared"],  # noqa: E731
                               st["directors_why"]]
        OUT["unread_filed"] = refused(lambda: to.request(T, ann, {"start": D(2), "end": D(3), "houses": []}))
        OUT["unread_state"] = state_of(to.settings_state(T))
        OUT["unread_rows"] = len(to.view(T, fresh=True)["rows"])
        to.write_setting(T, "directors", "", "the director half of every time off request")
        dee_v = v("Dee Way")
        OUT["blank_preview"] = (lambda p: [p["ok"], p["directors_why"], p["asked"]["dir_why"]])(
            to.preview(T, dee_v, {"start": D(6), "end": D(6), "houses": ["ABD1711"]}))
        waiting = to.request(T, dee_v, {"start": D(6), "end": D(6), "houses": ["ABD1711"]})
        wref = waiting["ref"]
        wrow = to.find(to.view(T, fresh=True), wref)
        OUT["blank_filed"] = [wrow["status"], wrow["dir_asked"], wrow["dir_state"], wrow["status_why"],
                              waiting["asked"]["directors"], waiting["asked"]["directors_why"]]
        OUT["blank_state"] = state_of(to.settings_state(T))
        OUT["blank_dir_refused"] = refused(lambda: to.decide(T, ty, wref, "approve"))
        OUT["blank_hm"] = (lambda r: [r["status"], r["hm_state"], r["dir_state"], r["status_why"]])(
            to.decide(T, mia, wref, "approve"))
        OUT["blank_detail"] = (lambda d: [d["may"]["approve"], d["why_not"], d["directors"],
                                          d["directors_readable"], d["status_why"]])(to.detail(T, ty, wref))
        midday = datetime.now(sr.OHIO).replace(hour=12, minute=0, second=0, microsecond=0)
        OUT["blank_owed"] = [o["kind"] for o in to.owed(T, now=midday) if o["ref"] == wref]
        OUT["blank_settle"] = to.settle(T).get("directors_asked")
    finally:
        to.people_rows, to._accounts = held_people, held_accounts
    to.write_setting(T, "directors", "Ty Bond, Lisa B. Bright", "the lane's board")
    OUT["named_owed"] = sorted(o["person"] for o in to.owed(T, now=midday)
                               if o["ref"] == wref and o["kind"] == "timeoff_ask_director")
    OUT["named_settle"] = to.settle(T).get("directors_asked")
    OUT["named_detail"] = (lambda d: [d["may"]["approve"], d["leg"], d["dir"]["asked"], d["status_why"]])(
        to.detail(T, ty, wref))
    with psycopg2.connect(T) as c, c.cursor() as cur:
        cur.execute("SELECT facts FROM asa_hub_notices WHERE key=%s", (f"time_off_asked:{wref}:directors",))
        got_note = cur.fetchone()
    OUT["named_notice"] = sorted((got_note[0] or {}).get("approvers") or []) if got_note else None
    # withdrawn, so nothing it holds reaches the flows below
    OUT["blank_withdrawn"] = to.withdraw(T, dee_v, wref)["status"]

    # ── request → pending → both halves → scheduled ─────────────────────
    filed = to.request(T, ann, {"start": D(2), "end": D(3), "houses": [], "reason": "a surgery"})
    ref = filed["ref"]
    row = to.find(to.view(T, fresh=True), ref)
    OUT["filed"] = [row["status"], row["hm_mode"], row["hm_asked"], row["dir_asked"], row["houses"],
                    next(r for r in HOUSE.tabs["time_off"][1:] if r[0] == ref)[
                        HOUSE.tabs["time_off"][0].index("time_off_reason")]]
    OUT["overlay_reason"] = row.get("time_off_reason", "")
    OUT["refiled"] = refused(lambda: to.request(T, ann, {"start": D(3), "end": D(4)}))
    OUT["staff_refused_other"] = refused(lambda: to.request(T, ann, {"person": "Ben Left", "start": D(5), "end": D(5)}))
    OUT["own"] = refused(lambda: to.decide(T, ann, ref, "approve"))
    hm = to.decide(T, mia, ref, "approve")
    OUT["after_hm"] = [hm["status"], hm["hm_state"], hm["hm_by"], hm["dir_state"]]
    OUT["hm_twice"] = refused(lambda: to.decide(T, mia, ref, "approve"))
    OUT["deny_needs_words"] = refused(lambda: to.decide(T, lisa, ref, "deny"))
    OUT["held_before"] = [c.get("source") for c in sr.held_by(T, "Ann Roe")]
    done = to.decide(T, ty, ref, "approve")
    OUT["scheduled"] = [done["status"], done["dir_by"], bool(done.get("decided_at"))]

    # ── the telephone is a door of its own ──────────────────────────────
    # Order matters: both refusals run on the day the accepted one then takes,
    # so each is proved to refuse on its own rule and not on an overlap.
    OUT["door_unknown"] = refused(lambda: to.request(
        T, mia, {"person": "Ann Roe", "start": D(4), "end": D(4), "filed_via": "carrier pigeon"}))
    OUT["phone_for_self"] = refused(lambda: to.request(
        T, ann, {"start": D(4), "end": D(4), "filed_via": "phone"}))
    took = to.request(T, mia, {"person": "Ann Roe", "start": D(4), "end": D(4),
                               "filed_via": "phone", "reason": "a funeral"})
    phoned = to.find(to.view(T, fresh=True), took["ref"])
    OUT["phoned"] = [phoned["filed_via"], phoned["filed_by"], phoned["status_why"],
                     phoned["dir_state"], phoned["dir_asked"]]

    # ── enforcement at once, through the overlay, before the keeper's copy ──
    OUT["mirror_rows_before_sync"] = len(HOUSE.mirrored["time_off"])
    OUT["check_h2"] = sr.check_assignment(T, person="Ann Roe", location=H2, col_iso=D(3), value="8A-4P")
    OUT["overnight_into_day_one"] = sr.check_assignment(T, person="Ann Roe", location=H2, col_iso=D(1),
                                                        value="10P-8A")["code"]
    OUT["day_after"] = sr.check_assignment(T, person="Ann Roe", location=H2, col_iso=D(4), value="8A-4P")["code"]
    OUT["stage_refused"] = refused(lambda: cbh.stage_cell(T, location=H1, employee="Ann Roe", col_iso=D(3),
                                                          value="8A-4P", actor="Mia Manager"))
    OUT["overlay_before"] = overlay_rows()
    HOUSE.sync()
    to.forget()
    to.view(T, fresh=True)
    OUT["overlay_after"] = overlay_rows()
    OUT["mirrored_reason"] = next(d.get("time_off_reason") for _n, d in HOUSE.mirrored["time_off"] if d["id"] == ref)
    OUT["still_blocked"] = sr.check_assignment(T, person="Ann Roe", location=H2, col_iso=D(3), value="8A-4P")["code"]
    # effects: the published shift became an OPEN draft and R/O
    eff = json.loads(to.find(to.view(T, fresh=True), ref)["effects"] or "{}")
    OUT["effects"] = [eff.get("state"), [(s["col_iso"], s["value"], s["moved_to"]) for s in eff.get("staged") or []
                                        if s.get("value")]]
    OUT["drafts_h1"] = drafts(H1)
    # the reason, live, for its readers only
    d_ann = to.detail(T, ann, ref)
    d_mia = to.detail(T, mia, ref)
    OUT["reason"] = [d_ann["reason"], d_ann["reason_visible"], d_mia["reason"]]
    OUT["ben_detail"] = refused(lambda: to.detail(T, v("Ben Left"), ref))

    # ── a pending request only warns ─────────────────────────────────────
    ben = to.request(T, v("Ben Left"), {"start": D(3), "end": D(3)})
    warn = cbh.stage_cell(T, location=H2, employee="Ben Left", col_iso=D(3), value="10A-6P", actor="Mia Manager")
    OUT["pending_warns"] = [warn.get("changed"), warn.get("warning", "")]
    marks_editor = {**to.grid_marks(T, H1, True), **to.grid_marks(T, H2, True)}
    marks_staff = {**to.grid_marks(T, H1, False), **to.grid_marks(T, H2, False)}
    OUT["marks"] = [sorted({m["state"] for m in marks_editor.values()}),
                    sorted({m["state"] for m in marks_staff.values()})]

    # ── two halves in the same second: one transition, effects once ─────
    dee = to.request(T, v("Dee Way"), {"start": D(2), "end": D(2)})
    with psycopg2.connect(T) as c, c.cursor() as cur:
        cur.execute("INSERT INTO asa_shift_requests (id, kind, location, open_row, col_iso, value, person, state) "
                    "VALUES ('SRDEE0000001', 'open_shift', %s, 'OPEN', %s, '8A-4P', 'Dee Way', 'applied')",
                    (H2, D(2)))
        cur.execute("INSERT INTO asa_shift_handoffs (id, location, col_iso, value, from_staff, to_staff) "
                    "VALUES ('HODEE0000001', %s, %s, '8A-4P', 'Eve Gone', 'Dee Way')", (H2, D(2)))
        c.commit()
    got = {}

    def go(key, w):
        try:
            got[key] = to.decide(T, w, dee["ref"], "approve")["status"]
        except Exception as exc:
            got[key] = f"{type(exc).__name__}: {getattr(exc, 'why', exc)}"

    th = [threading.Thread(target=go, args=("hm", mia)), threading.Thread(target=go, args=("dir", lisa))]
    [x.start() for x in th]
    [x.join(60) for x in th]
    drow = to.find(to.view(T, fresh=True), dee["ref"])
    deff = json.loads(drow["effects"] or "{}")
    OUT["race"] = [sorted(got.values()), drow["status"], len([s for s in deff.get("staged") or [] if s.get("value")])]
    OUT["race_side_effects"] = [deff.get("withdrawn_applications"), deff.get("ended_handoffs")]
    before = drafts()
    to.settle(T)
    to.settle(T)
    OUT["settle_twice_same"] = drafts() == before

    # ── no free OPEN row: unplaced, and the time off still scheduled ─────
    eve = to.request(T, v("Eve Gone"), {"start": D(2), "end": D(2)})
    boss = v("Shylah Walker", role="admin", types="ADMIN")
    to.decide(T, v("Lisa Bright"), eve["ref"], "approve")
    er = to.decide(T, boss, eve["ref"], "approve")
    eeff = json.loads(to.find(to.view(T, fresh=True), eve["ref"])["effects"] or "{}")
    OUT["unplaced"] = [er["status"], len(eeff.get("unplaced") or []), eeff.get("state"),
                       to.find(to.view(T), eve["ref"])["hm_mode"]]

    # ── an approval racing an assignment of the same person ─────────────
    cy = to.request(T, v("Cy Far"), {"start": D(4), "end": D(4)})
    OUT["cy_mode"] = to.find(to.view(T, fresh=True), cy["ref"])["hm_mode"]
    to.decide(T, boss, cy["ref"], "approve")
    race = {}

    def approve():
        try:
            race["approve"] = to.decide(T, ty, cy["ref"], "approve")["status"]
        except Exception as exc:
            race["approve"] = f"{type(exc).__name__}"

    def assign():
        try:
            race["assign"] = cbh.stage_cell(T, location=H2, employee="Cy Far", col_iso=D(4), value="8A-4P",
                                            actor="Mia Manager").get("changed")
        except Exception as exc:
            race["assign"] = getattr(exc, "code", type(exc).__name__)

    th = [threading.Thread(target=approve), threading.Thread(target=assign)]
    [x.start() for x in th]
    [x.join(60) for x in th]
    cy_cell = [d for d in drafts(H2) if d[1] == "Cy Far" and d[2] == D(4)]
    OUT["assign_race"] = [race.get("approve"), race.get("assign"),
                          any(sr.span_of(D(4), d[3]) is not None for d in cy_cell)]

    # ── pending past its end → expired ───────────────────────────────────
    old = {h: "" for h in to.HEADER}
    old.update(id="TO0000000EXP", person="Ben Left", person_key="benleft", start_date=(today - timedelta(days=3)).isoformat(),
               end_date=(today - timedelta(days=2)).isoformat(), status="pending", hm_state="waiting",
               dir_state="waiting", hm_mode="house_manager", createdAt=to.stamp(), updatedAt=to.stamp())
    HOUSE.tabs["time_off"].append([old[h] for h in to.HEADER])
    HOUSE.sync()
    to.forget()
    to.settle(T)
    OUT["expired"] = to.find(to.view(T, fresh=True), "TO0000000EXP")["status"]

    # ── what is owed, and what the door said closes it ──────────────────
    noon = datetime.now(sr.OHIO).replace(hour=12, minute=0, second=0, microsecond=0).astimezone(timezone.utc)
    owed = to.owed(T, now=noon)
    mine = [o for o in owed if o["ref"] == ben["ref"]]
    OUT["owed_kinds"] = sorted((o["kind"], o["to_name"]) for o in mine)
    to.mark_said(T, [o["id"] for o in mine], {"results": [{"id": o["id"], "state": "told"} for o in mine]}, mine)
    OUT["owed_after"] = [o["id"] for o in to.owed(T, now=noon) if o["ref"] == ben["ref"]]
    to.mark_said(T, [o["id"] for o in owed if o["ref"] == dee["ref"]],
                 {"results": [{"id": o["id"], "state": "refused_quiet"} for o in owed if o["ref"] == dee["ref"]]})
    OUT["quiet_stays_owed"] = len([o for o in to.owed(T, now=noon) if o["ref"] == dee["ref"]]) == len(
        [o for o in owed if o["ref"] == dee["ref"]])

    # ── the feed, cut per reader ─────────────────────────────────────────
    f_ann, f_mia, f_ty = to.feed(T, ann), to.feed(T, mia), to.feed(T, ty)
    OUT["feed"] = [sorted({r["person"] for r in f_ann["rows"]}), f_ann["me"]["scope"], f_mia["me"]["scope"],
                   f_ty["me"]["scope"], len(f_ty["rows"]) >= len(f_mia["rows"]) >= len(f_ann["rows"]),
                   "time_off_reason" not in json.dumps(f_ty), "a surgery" not in json.dumps(f_ty)]
    OUT["hero_off"] = [e["person"] for e in f_ty["hero"]["off_now"]] + [e["person"] for e in f_ty["hero"]["upcoming"]]
    tab = sr.time_off(T, who=ann, view=sr.estate(T), pooled=[])
    OUT["requests_tab"] = [tab["readable"], sorted({r["person"] for r in tab["rows"]}),
                           all(r.get("link", "").startswith("/app/timeoff/requests?ref=") for r in tab["rows"])]

    # ── notices: stored per event, never a reason or a note ─────────────
    with psycopg2.connect(T) as c, c.cursor() as cur:
        cur.execute("SELECT kind, key, facts FROM asa_hub_notices WHERE kind LIKE 'time_off_%%' ORDER BY id")
        notes = cur.fetchall()
    OUT["notices"] = [sorted({k for k, _key, _f in notes}),
                      any(k.startswith(f"time_off_asked:{ref}") for _k, k, _f in notes),
                      not any("surgery" in json.dumps(f) or "note" in f for _k, _key, f in notes)]

    # ── the House Builder's publish and the master's push refuse a scheduled day ──
    with psycopg2.connect(T) as c, c.cursor() as cur:
        cur.execute("INSERT INTO asa_cal_builder_house_draft (location, employee, col_iso, value, base_value, "
                    "updated_by) VALUES (%s,'Ann Roe',%s,'8A-4P','R/O','test') ON CONFLICT (location, employee, "
                    "col_iso) DO UPDATE SET value=EXCLUDED.value", (H1, D(3)))
        c.commit()
    def blocked_off(fn):
        try:
            fn()
            return ["allowed"]
        except sr.Refused as exc:
            return ["refused", exc.code, sorted(f"{b.get('employee')} {b.get('col_iso')}"
                                                for b in exc.extra.get("blocked") or []
                                                if "approved time off" in str(b.get("reason")))]
        except Exception as exc:
            return ["raised", type(exc).__name__, str(exc)[:200]]

    OUT["publish_refused"] = blocked_off(lambda: cbh.publish_house(T, location=H1, actor="Mia Manager"))
    with psycopg2.connect(T) as c, c.cursor() as cur:
        cur.execute("DELETE FROM asa_cal_builder_house_draft WHERE location=%s AND employee='Ann Roe' AND col_iso=%s",
                    (H1, D(3)))
        c.commit()
    OUT["push_refused"] = blocked_off(lambda: cbh.push_house(
        T, location=H1, cells=[{"employee": "Ann Roe", "col_iso": D(3), "value": "8A-4P", "base": ""}],
        actor="Mia Manager", dry_run=True))
    OUT["want_off"] = f"Ann Roe {D(3)}"

    # ── the master grid: a cell refused, and Apply time-off counts R/O and moves ──
    import calendar_builder_write as cbw
    COLS = [{"iso": D(i), "index": 3 + i} for i in range(6)]
    MROWS = [
        {"sheetRow": 10, "rowType": "staff", "house": "48TH (B)", "employee": "Ann Roe", "designation": "",
         "cells": [{"date": D(i), "text": ("8A-4P" if i == 2 else "")} for i in range(6)]},
        {"sheetRow": 11, "rowType": "open", "house": "48TH (B)", "employee": "OPEN", "designation": "",
         "cells": [{"date": D(i), "text": ""} for i in range(6)]},
    ]
    cbw._grid_context = lambda: {"cols": COLS, "rows": MROWS, "by_row": {r["sheetRow"]: r for r in MROWS},
                                 "period_start": D(0)}
    got = cbw.set_cell(T, "Mia Manager", 10, D(3), "8A-4P")
    OUT["master_refused"] = [got.get("status"), "approved time off" in str(got.get("message"))]
    OUT["master_eve_refused"] = cbw.set_cell(T, "Mia Manager", 10, D(1), "11P-7A").get("status")
    applied = cbw.apply_requests(T, "Mia Manager")
    OUT["apply_counts"] = [applied.get("status"), (applied.get("data") or {}).get("staged_ro"),
                           (applied.get("data") or {}).get("moved"), (applied.get("data") or {}).get("applied")]
    # a draft made before the approval is refused at publish, before anything is written
    with psycopg2.connect(T) as c, c.cursor() as cur:
        cur.execute(cbw.DRAFT_DDL)
        cur.execute("INSERT INTO asa_cal_builder_draft (period_start, sheet_row, date_iso, house, employee, value, "
                    "base_value, updated_by) VALUES (%s, 10, %s, '48TH (B)', 'Ann Roe', '11P-7A', '', 'test')",
                    (D(0), D(1)))
        c.commit()
    cbw._sheets_write_service = lambda: (_ for _ in ()).throw(AssertionError("the sheet was reached"))
    pub = cbw.publish(T, "Mia Manager")
    OUT["master_publish"] = [pub.get("status"), [b.get("date") for b in (pub.get("data") or {}).get("blocked") or []
                                                 if "approved time off" in str(b.get("reason"))]]
    import calendar_builder_slices as cbs
    d1 = datetime.strptime(D(1), "%Y-%m-%d")
    clash_rows = cbs._time_off_conflicts(T, [{"Staff": "Ann Roe", "House": "48TH (B)",
                                              "Date": d1.strftime("%m/%d/%Y"), "Start": "23:00", "End": "07:00"},
                                             {"Staff": "Ann Roe", "House": "48TH (B)",
                                              "Date": d1.strftime("%m/%d/%Y"), "Start": "07:00", "End": "15:00"}])
    OUT["conflict_rows"] = [(r.get("kind"), r.get("houseB"), r.get("startA")) for r in clash_rows]

    # ── answers by text: YES TO… / NO TO… words / a stranger / a bare YES / two refs ──
    import shutil
    import tempfile
    from pathlib import Path
    import hotline_desk
    import psi_reminders as pr
    import sms_ears as se
    r1 = to.request(T, v("Dee Way"), {"start": D(5), "end": D(5), "houses": ["ABD1711"]})["ref"]
    r2 = to.request(T, v("Mia Manager"), {"start": D(6), "end": D(6)})["ref"]
    PHONES = {"Mia Manager": "3305550301", "Ty Bond": "3305550302", "Ben Left": "3305550303"}
    ROSTER = {d: {sr.fold(n): n} for n, d in PHONES.items()}
    CONTACTS = se.Contacts(company={"3309195558": "Automations"}, floor=hotline_desk.shared_floor(), roster=ROSTER)
    work = Path(tempfile.mkdtemp(prefix="time-off-sms-"))
    inbox = work / "inbox"
    inbox.mkdir()
    pr.STATE_FILE = work / ".psi-reminders.json"
    lines = []
    now_utc = datetime.now(timezone.utc)

    def text(who, words, ago):
        mid = f"TOSMS{len(lines):03d}"
        sent = now_utc - timedelta(minutes=ago)
        lines.append(json.dumps({"id": mid, "type": "message.received", "received_at": now_utc.isoformat(),
                                 "source": "webhook", "event": {"type": "message.received", "data": {"object": {
                                     "id": mid, "from": "+1" + PHONES[who], "to": "+13309195558",
                                     "direction": "incoming", "text": words, "createdAt": sent.isoformat()}}}}))
        (inbox / f"{today.isoformat()}.jsonl").write_text("\n".join(lines) + "\n", encoding="utf-8")
        return mid

    call_offs = sr.call_off_shifts
    sr.call_off_shifts = lambda dsn, **k: []
    se.forget()
    se._ensure(T)
    with psycopg2.connect(T) as c, c.cursor() as cur:
        cur.execute("UPDATE asa_sms_reply_start SET since = now() - interval '2 hours'")
        c.commit()
    t1 = text("Mia Manager", f"YES {r1}", 9)
    t2 = text("Ty Bond", f"NO {r2} short staffed that week", 8)
    t3 = text("Ben Left", f"yes {r1}", 7)
    t4 = text("Ben Left", f"YES {r1} SP0123456789", 6)
    sr.forget_estate()
    OUT["sms_pass"] = se.listen(T, inbox=inbox, now=now_utc, contacts=lambda: CONTACTS)

    def heard(mid):
        with psycopg2.connect(T) as c, c.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("SELECT outcome, code, road, ack, ack_why, why FROM asa_sms_replies WHERE id=%s", (mid,))
            got = cur.fetchone()
        return dict(got or {})

    to.forget()
    row1, row2 = to.find(to.view(T, fresh=True), r1), to.find(to.view(T), r2)
    OUT["sms_row1"] = {k: row1.get(k) for k in ("hm_mode", "hm_asked", "hm_why", "houses", "hm_state", "dir_state")}
    OUT["sms"] = {"yes": [heard(t1).get("outcome"), heard(t1).get("road"), row1.get("hm_state"), row1.get("hm_via"),
                          heard(t1).get("ack_why")],
                  "no": [heard(t2).get("outcome"), row2.get("status"),
                         (row2.get("hm_note") or "") + (row2.get("dir_note") or ""),
                         (row2.get("hm_via") or "") + (row2.get("dir_via") or "")],
                  "stranger": [heard(t3).get("outcome"), heard(t3).get("ack"), heard(t3).get("ack_why")],
                  "two_refs": [heard(t4).get("outcome"), heard(t4).get("code")]}
    t5 = text("Mia Manager", "YES", 5)
    sr.forget_estate()
    se.listen(T, inbox=inbox, now=now_utc, contacts=lambda: CONTACTS)
    to.forget()
    OUT["sms"]["bare"] = [heard(t5).get("outcome"), heard(t5).get("road"),
                          to.find(to.view(T, fresh=True), r1).get("dir_state")]
    sr.call_off_shifts = call_offs
    shutil.rmtree(work, ignore_errors=True)

    # ── the eve's overnight is released; a shift held only through a claim is given back ──
    evr = to.request(T, v("Eve Gone"), {"start": D(7), "end": D(7)})["ref"]
    to.decide(T, boss, evr, "approve")
    to.decide(T, lisa, evr, "approve")
    eve_eff = json.loads(to.find(to.view(T, fresh=True), evr)["effects"] or "{}")
    OUT["eve_released"] = [(s["col_iso"], s["value"], bool(s.get("moved_to"))) for s in eve_eff.get("staged") or []
                           if s.get("value")]
    with psycopg2.connect(T) as c, c.cursor() as cur:
        cur.execute("INSERT INTO asa_house_calendar_claims (location, open_row, col_iso, value, claimed_by) "
                    "VALUES (%s, 'OPEN 2', %s, '8A-4P', 'Cy Far')", (H1, D(5)))
        c.commit()
    cyr = to.request(T, v("Cy Far"), {"start": D(5), "end": D(5)})["ref"]
    OUT["claim_listed"] = [s.get("claim") for s in to.detail(T, boss, cyr)["does"]["shifts"]]
    to.decide(T, boss, cyr, "approve")
    to.decide(T, ty, cyr, "approve")
    with psycopg2.connect(T) as c, c.cursor() as cur:
        cur.execute("SELECT count(*) FROM asa_house_calendar_claims WHERE claimed_by='Cy Far' AND col_iso=%s", (D(5),))
        left = cur.fetchone()[0]
    cy_eff = json.loads(to.find(to.view(T, fresh=True), cyr)["effects"] or "{}")
    OUT["claim_released"] = [left, [(s["col_iso"], s["open_row"]) for s in cy_eff.get("released_claims") or []]]

    # ── review: a houseless row is the badges' above; confirm runs the filing rules ──
    def review_row(rid, filed_by, houses, a, b):
        r = {h: "" for h in to.HEADER}
        r.update(id=rid, person=filed_by, person_key=to.fold(filed_by), filed_by=filed_by, filed_via="migration",
                 status="needs_review", start_date=a, end_date=b, houses=houses, source="form:staff_requests",
                 createdAt=to.stamp(), updatedAt=to.stamp())
        HOUSE.tabs["time_off"].append([r[h] for h in to.HEADER])

    review_row("TO00000000R1", "Other", "", D(7), D(7))
    review_row("TO00000000R2", "Ann  Roe", "ABD1711", D(7), D(7))
    HOUSE.sync()
    to.forget()
    OUT["review_hm_houseless"] = refused(lambda: to.review(T, mia, "TO00000000R1", "confirm", person="Mia Manager"))
    OUT["review_own"] = refused(lambda: to.review(T, boss, "TO00000000R1", "confirm", person="Shylah Walker"))
    OUT["review_too_long"] = refused(lambda: to.review(T, boss, "TO00000000R1", "confirm", person="Ben Left",
                                                       end=(today + timedelta(days=400)).isoformat()))
    other = to.review(T, boss, "TO00000000R1", "confirm", person="Ben Left")
    OUT["review_other"] = [other["status"], other["hm_state"], other["dir_state"], other["filed_by"]]
    OUT["review_other_self_approve"] = refused(lambda: to.decide(T, boss, "TO00000000R1", "approve"))
    named = to.review(T, mia, "TO00000000R2", "confirm", person="Ann Roe")
    OUT["review_named"] = [named["status"], named["hm_state"]]

    # ── a refused preview says nothing about the person; an HM reads only their own houses' others ──
    peek = to.preview(T, ann, {"person": "Ben Left", "start": D(5), "end": D(6)})
    OUT["peek"] = [peek["ok"], sorted(k for k in ("touches", "asked", "houses", "drawn_houses") if k in peek)]
    both = to.request(T, boss, {"person": "Cy Far", "start": D(3), "end": D(3), "houses": ["ABD1711", "ABD2704"]})
    OUT["both_houses"] = to.find(to.view(T, fresh=True), both["ref"])["houses"]
    OUT["others_off_hm"] = sorted(o["person"] for o in to.detail(T, mia, both["ref"]).get("others_off") or [])
    OUT["others_off_boss"] = sorted(o["person"] for o in to.detail(T, boss, both["ref"]).get("others_off") or [])

    # ── test rows: never asked once test mode is off, and discarded in one go ──
    effective_roster.use_switch(lambda: {"on": True, "readable": True, "word": "on", "why": ""})
    rehearsal = to.request(T, v("Ben Left"), {"start": D(6), "end": D(6)})["ref"]
    effective_roster.use_switch(lambda: {"on": False, "readable": True, "word": "off", "why": ""})
    OUT["test_row_owed"] = [o["ref"] for o in to.owed(T, now=noon) if o["ref"] == rehearsal]
    OUT["test_rows_state"] = [r["id"] for r in to.test_rows(to.view(T, fresh=True))]
    OUT["discard_staff"] = refused(lambda: to.discard_test_rows(T, ann, ""))
    OUT["discarded"] = to.discard_test_rows(T, boss, "")["discarded"]
    OUT["discarded_status"] = to.find(to.view(T, fresh=True), rehearsal)["status"]

    # ── the house down: the overlap law refuses, never allows ───────────
    HOUSE.fail = True
    to.forget()
    OUT["down_check"] = refused(lambda: sr.check_assignment(T, person="Ben Left", location=H2, col_iso=D(5),
                                                            value="8A-4P"))
    OUT["down_stage"] = refused(lambda: cbh.stage_cell(T, location=H2, employee="Ben Left", col_iso=D(5),
                                                       value="8A-4P", actor="Mia Manager"))
    HOUSE.fail = False
    to.forget()
finally:
    to.use_house(None)
    cbh.use_workbook(None)
    OUT["rooms"] = ROOMS.close()
print("LANE_RESULT " + json.dumps(OUT, default=str))
'''


_LANE_BROKEN: list[str] = []


def _lane_in_container() -> dict | None:
    # the roots, every module they reach, the IST declaration, and the helper that owns the lane's tables
    sources = lane_schema.with_imports(SERVER, (
        "time_off", "shift_requests", "shift_handoff", "house_cal_live", "shift_slices",
        "calendar_builder_houses", "calendar_builder_write", "calendar_builder_slices",
        "house_directory", "psi_reminders", "badge_follows", "effective_roster",
        "web_notices", "redaction", "open_shift_covered", "psi_attendance", "calloff_road",
        "sms_ears", "hotline_desk"))
    sources["lane_schema"] = (HERE.parent / "lane_schema.py").read_text(encoding="utf-8")
    stamp = f"{os.getpid()}-{int(time.time() * 1000) % 100000}"
    here = f"/tmp/time-off-test-{stamp}"
    script = (
        "import base64, json, os, pathlib, shutil, signal, sys\n"
        f"SRC = json.loads(base64.b64decode({base64.b64encode(json.dumps(sources).encode())!r}))\n"
        f"d = pathlib.Path({here!r}); d.mkdir(parents=True, exist_ok=True)\n"
        "for k, v in SRC.items(): (d / (k if k.endswith('.json') else k + '.py')).write_text(v)\n"
        "sys.path[:] = [p for p in sys.path if p not in ('', os.getcwd())]\n"
        f"sys.path.insert(0, {here!r})\n"
        f"LANE_DIR = {here!r}\n"
        f"signal.signal(signal.SIGALRM, lambda *_: (_ for _ in ()).throw("
        f"TimeoutError('the lane ran past {LANE_BUDGET_S - 60}s and stopped itself')))\n"
        f"signal.alarm({LANE_BUDGET_S - 60})\n"
        "try:\n"
        + "".join("    " + line + "\n" for line in LANE.splitlines())
        + "finally:\n"
        f"    shutil.rmtree({here!r}, ignore_errors=True)\n")
    try:
        proc = subprocess.run(["docker", "exec", "-i", CONTAINER, "python3", "-"],
                              input=script, capture_output=True, text=True, timeout=LANE_BUDGET_S)
    except FileNotFoundError:
        return None
    except subprocess.TimeoutExpired:
        _LANE_BROKEN.append("timeout")
        check("THE LANE RAN inside its budget", False, f"killed after {LANE_BUDGET_S}s")
        return None
    for line in (proc.stdout or "").splitlines():
        if line.startswith("LANE_RESULT "):
            return json.loads(line[len("LANE_RESULT "):])
    absent = subprocess.run(["docker", "inspect", "-f", "{{.State.Running}}", CONTAINER],
                            capture_output=True, text=True).stdout.strip() != "true"
    if absent:
        return None
    _LANE_BROKEN.append("no result")
    check("THE LANE RAN and produced a result", False, ((proc.stdout or "") + (proc.stderr or ""))[-2500:])
    return None


print("\nthe lane — a real database, a stand-in house")
lane = _lane_in_container()
if lane is None:
    print("  (no relay container here — the lane did not run)" if not _LANE_BROKEN
          else "  THE LANE BROKE — counted as a failure above, never as a skip.")
else:
    owned = (lane.get("owned") or {}).get("lane") or {}
    check("every table the lane reads resolves in its own schema before the first read — the time-off "
          "overlay and the tracker stand-in included, never public's",
          {"asa_time_off_writes", "lane_tracker"} <= set(owned)
          and all(str(s).startswith("hub_test_time_off_") for s in owned.values()), lane.get("owned"))
    us = lane["unread_state"]
    check("A SETTINGS TAB WITH NO DIRECTORS ROW IS UNREADABLE, NEVER AN EMPTY BOARD: the request is refused as a "
          "read that failed (Unreadable, 503 — never 'invalid' input), the settings say the list did not land, and "
          "nothing was written",
          lane["unread_filed"][:2] == ["raised", "Unreadable"]
          and "could not be read" in str(lane["unread_filed"][2])
          and us[:3] == [[], False, False] and "could not be read" in us[3] and lane["unread_rows"] == 0,
          [lane["unread_filed"], us, lane["unread_rows"]])
    bp, bf, bs = lane["blank_preview"], lane["blank_filed"], lane["blank_state"]
    check("A BLANK CELL NAMES NOBODY AND THE REQUEST WAITS: the preview is clean and says so, the request is "
          "filed pending with no director asked, and the filing answer says the director half waits",
          bp[0] is True and "waits" in bp[1] and "waits" in bp[2]
          and bf[:3] == ["pending", "", "waiting"] and bf[3] == "waiting on the house manager and a director"
          and bf[4] == [] and "waits" in bf[5], [bp, bf])
    check("…the settings say the cell is readable and names nobody, with the sentence",
          bs[:3] == [[], True, False] and "names no director" in bs[3], bs)
    check("…a director off the list is refused with that reason, while the house manager still decides the "
          "house manager half and the request stays pending",
          lane["blank_dir_refused"][:2] == ["refused", "no_directors"]
          and lane["blank_hm"][:3] == ["pending", "approved", "waiting"]
          and lane["blank_hm"][3] == "waiting on the director",
          [lane["blank_dir_refused"], lane["blank_hm"]])
    check("…the detail offers the director nothing and says why on its status line too, and nobody is asked for "
          "the director half",
          lane["blank_detail"][0] is False and "names no director" in lane["blank_detail"][1]
          and lane["blank_detail"][2:4] == [[], True] and "names no director" in lane["blank_detail"][4]
          and lane["blank_owed"] == [] and lane["blank_settle"] == 0,
          [lane["blank_detail"], lane["blank_owed"], lane["blank_settle"]])
    nd = lane["named_detail"]
    check("ONCE A NAME IS SAVED, the waiting half is asked of each listed director and they may decide it",
          len(lane["named_owed"]) == 2 and "Ty Bond" in lane["named_owed"]
          and any(to.same_person(n, "Lisa B. Bright") for n in lane["named_owed"])
          and nd[:2] == [True, "dir"]
          and lane["blank_withdrawn"] == "withdrawn",
          [lane["named_owed"], nd, lane["blank_withdrawn"]])
    check("…the pass writes the directors asked on the row, the status line stops saying nobody is named, and "
          "the directors hear it on the bell",
          lane["named_settle"] == 1 and nd[2] == ["Ty Bond", "Lisa B. Bright"]
          and "names no director" not in nd[3] and "waiting on the director" in nd[3]
          and lane["named_notice"] == ["Lisa B. Bright", "Ty Bond"],
          [lane["named_settle"], nd, lane["named_notice"]])
    f = lane["filed"]
    check("a request is filed pending, its house manager named from the ** rows and the directors from the list",
          f[:5] == ["pending", "house_manager", "Mia Manager", "Ty Bond, Lisa B. Bright", "ABD1711"], f)
    check("the reason is written to the house and nowhere else — the overlay holds it blank",
          f[5] == "a surgery" and lane["overlay_reason"] == "", [f[5], lane["overlay_reason"]])
    check("an overlapping request of one's own is refused in words",
          lane["refiled"][0] == "refused" and "already asked for" in lane["refiled"][2], lane["refiled"])
    check("staff cannot file for somebody else", lane["staff_refused_other"][0] == "refused", lane["staff_refused_other"])
    check("nobody decides their own", lane["own"][:2] == ["refused", "own"], lane["own"])
    check("A DOOR NOBODY KNOWS IS REFUSED, never quietly rewritten as the platform",
          lane["door_unknown"][0] == "refused" and "not a door" in lane["door_unknown"][2],
          lane["door_unknown"])
    check("…and a telephone request is filed by whoever took the call, never by the person who is off",
          lane["phone_for_self"][0] == "refused" and "took the call" in lane["phone_for_self"][2],
          lane["phone_for_self"])
    check("A REQUEST TAKEN BY TELEPHONE keeps its door, names who took the call, and still waits on a "
          "director — the origin survives and the approval is never inferred",
          lane["phoned"][0] == "phone" and lane["phoned"][1] == "Mia Manager"
          and "taken by telephone by Mia Manager" in lane["phoned"][2]
          and lane["phoned"][3] == "waiting" and lane["phoned"][4], lane["phoned"])
    check("the house manager's approval is half: it waits on a director",
          lane["after_hm"] == ["pending", "approved", "Mia Manager", "waiting"], lane["after_hm"])
    check("the same half twice is refused", lane["hm_twice"][0] == "refused", lane["hm_twice"])
    check("a denial needs words", lane["deny_needs_words"][:2] == ["refused", "words_needed"], lane["deny_needs_words"])
    check("pending time off holds nothing", "time_off" not in lane["held_before"], lane["held_before"])
    check("the director's approval schedules it", lane["scheduled"] == ["scheduled", "Ty Bond", True], lane["scheduled"])
    ch = lane["check_h2"]
    check("the second approval blocks at once, through the overlay, before the keeper's copy exists",
          lane["mirror_rows_before_sync"] == 0 and ch["ok"] is False and ch["code"] == "time_off"
          and "on approved time off" in ch["why"], ch)
    check("an overnight that runs into the first day off is refused; the day after is free",
          lane["overnight_into_day_one"] == "time_off" and lane["day_after"] in ("ok", "no_ist"),
          [lane["overnight_into_day_one"], lane["day_after"]])
    check("the House Builder refuses the draft with the time-off code",
          lane["stage_refused"][:2] == ["refused", "time_off"], lane["stage_refused"])
    check("the overlay retires once the keeper's copy carries the row, and the block stays",
          lane["overlay_before"] >= 1 and lane["overlay_after"] == 0 and lane["still_blocked"] == "time_off",
          [lane["overlay_before"], lane["overlay_after"], lane["still_blocked"]])
    check("the keeper's copy withholds the reason", lane["mirrored_reason"] == "[withheld: private]",
          lane["mirrored_reason"])
    eff = lane["effects"]
    check("the published shift became an OPEN draft, and the days R/O — nothing assigned to anybody",
          eff[0] == "done" and len(eff[1]) == 1 and eff[1][0][1:] == ["8A-4P", "OPEN"]
          and sum(1 for d in lane["drafts_h1"] if d[1] == "Ann Roe" and d[3] == "R/O") == 2
          and any(d[1] == "OPEN" and d[3] == "8A-4P" for d in lane["drafts_h1"]), [eff, lane["drafts_h1"]])
    check("the reason is read live for the person and the approver",
          lane["reason"] == ["a surgery", True, "a surgery"], lane["reason"])
    check("somebody else's request is not theirs to open", lane["ben_detail"][:2] == ["refused", "missing"],
          lane["ben_detail"])
    check("a pending request only warns in the Builder",
          lane["pending_warns"][0] is True and "asked for time off" in lane["pending_warns"][1], lane["pending_warns"])
    check("the calendar marks: scheduled for every reader, pending for the house's editors only",
          lane["marks"][0] == ["pending", "scheduled"] and lane["marks"][1] == ["scheduled"], lane["marks"])
    race = lane["race"]
    check("two halves in the same second: exactly one scheduled transition, and the effects once",
          race[1] == "scheduled" and "scheduled" in race[0] and race[2] == 1, race)
    check("scheduling withdrew the person's live application and ended the transfer coming to them",
          lane["race_side_effects"] == [["SRDEE0000001"], ["HODEE0000001"]], lane["race_side_effects"])
    check("settle twice is no second draft", lane["settle_twice_same"] is True)
    check("no free OPEN row: the shift is listed unplaced and the time off is still scheduled",
          lane["unplaced"][:3] == ["scheduled", 1, "done"] and lane["unplaced"][3] == "above", lane["unplaced"])
    ar = lane["assign_race"]
    check("an approval racing an assignment of the same person: never both",
          lane["cy_mode"] == "above" and ar[0] == "scheduled" and ar[2] is False, [lane["cy_mode"], ar])
    check("a pending request past its end expires", lane["expired"] == "expired", lane["expired"])
    check("a house with no manager on file asks each listed director once, for the house-manager half",
          [k for k, _n in lane["owed_kinds"]] == ["timeoff_ask_above", "timeoff_ask_above"], lane["owed_kinds"])
    check("`told` closes an ask; `refused_quiet` keeps it owed",
          lane["owed_after"] == [] and lane["quiet_stays_owed"] is True, [lane["owed_after"], lane["quiet_stays_owed"]])
    fd = lane["feed"]
    check("the feed: staff see their own rows only, and the reason never leaves in any feed",
          fd[0] == ["Ann Roe"] and fd[1:4] == ["own", "houses", "all"] and fd[4] and fd[5] and fd[6], fd)
    check("the black band names who is off now and who is off soon", "Ann Roe" in lane["hero_off"], lane["hero_off"])
    check("Calendar Builder's Requests tab reads the house, with the link to the app",
          lane["requests_tab"][0] is True and lane["requests_tab"][1] == ["Ann Roe"] and lane["requests_tab"][2],
          lane["requests_tab"])
    nt = lane["notices"]
    check("the bell hears asks, halves and scheduling — never a reason or a note",
          {"time_off_asked", "time_off_decided", "time_off_scheduled"} <= set(nt[0]) and nt[1] and nt[2], nt)
    want = lane["want_off"]
    check("the House Builder's publish refuses a drafted shift on approved time off",
          lane["publish_refused"][:2] == ["refused", "blocked"] and want in lane["publish_refused"][2],
          lane["publish_refused"])
    check("the master grid's push into a house refuses it too",
          lane["push_refused"][:2] == ["refused", "blocked"] and want in lane["push_refused"][2], lane["push_refused"])
    check("the master grid refuses hours on a scheduled day", lane["master_refused"] == [409, True],
          lane["master_refused"])
    check("Apply time off counts the R/O it stages and the shift it moves",
          lane["apply_counts"] == [200, 2, 1, 3], lane["apply_counts"])
    sms = lane["sms"]
    check("YES TO… from the house manager fills the house-manager half, by text",
          sms["yes"][:4] == ["answered", "time_off", "approved", "sms"] and "half is approved" in sms["yes"][4],
          [sms, lane.get("sms_row1"), lane.get("sms_pass")])
    check("NO TO… with words denies, and the words are kept as the note",
          sms["no"][:2] == ["answered", "denied"] and sms["no"][2] == "short staffed that week"
          and "sms" in sms["no"][3], sms["no"])
    check("YES TO… from somebody who is not asked is refused, and told so",
          sms["stranger"][:2] == ["refused", "sms_reply_refused"] and bool(sms["stranger"][2]), sms["stranger"])
    check("two refs in one text decide nothing", sms["two_refs"] == ["ambiguous", "several_refs"], sms["two_refs"])
    check("a bare YES never decides time off", sms["bare"][1] != "time_off" and sms["bare"][2] == "waiting",
          sms["bare"])
    check("the Builder keeps reading the form until the migration sets the cutover",
          lane["builder_before_cutover"] is False and lane["builder_after_cutover"] is True,
          [lane["builder_before_cutover"], lane["builder_after_cutover"]])
    check("the master grid refuses the eve's overnight too — the span law, not the day",
          lane["master_eve_refused"] == 409, lane["master_eve_refused"])
    check("a master-grid draft made before the approval is refused at publish, and the sheet is never reached",
          lane["master_publish"] == [409, [D(1)]], lane["master_publish"])
    check("the Conflicts rows name approved time off in their own words, and only the shift that clashes",
          lane["conflict_rows"] == [["time_off", "Approved time off", "23:00"]], lane["conflict_rows"])
    check("approving releases the eve's overnight into an open draft",
          lane["eve_released"][:1] and lane["eve_released"][0][1:] == ["11P-7A", True], lane["eve_released"])
    check("a shift held only through a claim is listed before approving and given back after",
          lane["claim_listed"] == [True] and lane["claim_released"][0] == 0
          and len(lane["claim_released"][1]) == 1 and lane["claim_released"][1][0][1] == "OPEN 2",
          [lane["claim_listed"], lane["claim_released"]])
    check("a house manager cannot review a row with no house",
          lane["review_hm_houseless"][:2] == ["refused", "not_allowed"], lane["review_hm_houseless"])
    check("nobody confirms their own time off, and a confirm obeys the filing rules",
          lane["review_own"][:2] == ["refused", "own"] and lane["review_too_long"][:2] == ["refused", "invalid"],
          [lane["review_own"], lane["review_too_long"]])
    check("a migrated row confirmed for somebody the form did not name waits for both approvals, and whoever "
          "confirmed it decides neither half",
          lane["review_other"] == ["pending", "waiting", "waiting", "Shylah Walker"]
          and lane["review_other_self_approve"][:2] == ["refused", "filed"],
          [lane["review_other"], lane["review_other_self_approve"]])
    check("…and one confirmed for the form's own name and days keeps the form's approval",
          lane["review_named"] == ["scheduled", "migrated"], lane["review_named"])
    check("a refused preview says nothing about the person's shifts, houses or approvers",
          lane["peek"] == [False, []], lane["peek"])
    check("the other people off at the same time are cut to what the reader may see",
          lane["both_houses"] == "ABD1711, ABD2704" and lane["others_off_hm"] == ["Ann Roe"]
          and lane["others_off_boss"] == ["Ann Roe", "Ben Left"],
          [lane["both_houses"], lane["others_off_hm"], lane["others_off_boss"]])
    check("a request filed in test mode is never asked once test mode is off, and is discarded at go-live",
          lane["test_row_owed"] == [] and len(lane["test_rows_state"]) == 1
          and lane["discard_staff"][:2] == ["refused", "not_allowed"]
          and lane["discarded"] == lane["test_rows_state"] and lane["discarded_status"] == "withdrawn",
          [lane["test_row_owed"], lane["test_rows_state"], lane["discard_staff"], lane["discarded"],
           lane["discarded_status"]])
    check("the house unreadable: the overlap law raises, never allows",
          lane["down_check"][:2] == ["raised", "Unreadable"], lane["down_check"])
    check("…and the House Builder says the check could not run", lane["down_stage"][:2] == ["refused",
                                                                                              "guard_unreadable"],
          lane["down_stage"])

print(f"\n{results['ok']} ok, {len(results['failed'])} failed")
for name in results["failed"]:
    print("  FAILED:", name)
sys.exit(1 if results["failed"] else 0)
