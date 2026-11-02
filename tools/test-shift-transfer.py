#!/usr/bin/env python3
"""
Shift transfers end to end: who approves, the picker, the offer, the asks, the consents, the reply ear, the doors.
Pure half on the host; lane half in the relay container, in its own schema with stand-ins for every live source.

    python3 tools/test-shift-transfer.py
"""
import ast
import json
import os
import sys
import types
from datetime import datetime, timedelta, timezone
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
import shift_requests as sr  # noqa: E402
import shift_handoff as sh  # noqa: E402
import psi_reminders as pr  # noqa: E402


def src(name: str) -> str:
    return (SERVER / f"{name}.py").read_text(encoding="utf-8")


def fn_source(source: str, name: str) -> str:
    """One top-level function's source, found by the parser."""
    tree = ast.parse(source)
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)) \
                and node.name == name:
            return ast.get_source_segment(source, node) or ""
    return ""


BM, JH, MK, NW = ("CAN - BM - BM4060", "CAN - JH - ABD2704", "CAN - MK - MK11787",
                  "CAN - NW - NW4045")
MANAGERS = {"readable": True, "why": "", "by_code": {
    "BM4060": {"name": "Hana Boss", "names": ["Hana Boss"], "phone": "3305550101"},
    "ABD2704": {"name": "Rita Lead", "names": ["Rita Lead"], "phone": ""},
    "NW4045": {"name": "Nia Day", "names": ["Nia Day", "Nat Night"], "phone": "3305550102"},
}}


def viewer(name, badges=("STAFF",), manages=(), everywhere=False, role="staff"):
    return {"name": name, "badges": list(badges), "manages": list(manages),
            "decides": list(manages), "decides_everywhere": everywhere,
            "whole_company": everywhere or bool(manages), "role": role}


HANA = viewer("Hana Boss", ("HM",), ["BM4060"])
DIRECTOR = viewer("Dan Director", ("DIRECTOR",), everywhere=True)
BEN = viewer("Ben Left")
ANN = viewer("Ann Roe")
OTHER = viewer("Oz Other")

# ═══════════════════════════════════════════════════════════════════════════
print("\nWHO APPROVES — the relay works it out, and nobody approves their own swap")
# ═══════════════════════════════════════════════════════════════════════════
a = sh.approval_for(location=BM, giver="Ann Roe", receiver="Ben Left", managers=MANAGERS)
check("the house manager of the house approves, named, with the ** row's number",
      a["readable"] and a["mode"] == "house_manager" and a["names"] == ["Hana Boss"]
      and a["house_manager"] == "Hana Boss" and a["phone"] == "3305550101"
      and a["why"] == "the house manager Hana Boss approves", a)
a = sh.approval_for(location=NW, giver="Nia Day", receiver="Ben Left", managers=MANAGERS)
check("NW's two managers: the one giving the shift is out, the other approves (no borrowed number)",
      a["mode"] == "house_manager" and a["names"] == ["Nat Night"]
      and a["house_manager"] == "Nat Night" and a["phone"] == "", a)
a = sh.approval_for(location=BM, giver="Hana Boss", receiver="Ben Left", managers=MANAGERS)
check("the house manager giving their own shift: a director, team lead or administrator approves",
      a["mode"] == "above" and a["names"] == [] and a["house_manager"] == ""
      and "Hana Boss manages BM and is part of this swap" in a["why"]
      and "nobody approves their own swap" in a["why"], a)
a = sh.approval_for(location=BM, giver="Ann Roe", receiver="hana  boss", managers=MANAGERS)
check("…and taking one there, spelled any way", a["mode"] == "above", a)
a = sh.approval_for(location=NW, giver="Nia Day", receiver="Nat Night", managers=MANAGERS)
check("both NW managers in the swap: above", a["mode"] == "above" and "Nia Day and Nat Night manage NW"
      in a["why"], a)
a = sh.approval_for(location=MK, giver="Mo Staff", receiver="Ben Left", managers=MANAGERS)
check("a house with no manager on file: above, said so",
      a["mode"] == "above" and a["why"] == ("no house manager is on file for MK, so a director, "
                                           "team lead or administrator approves"), a)
a = sh.approval_for(location=BM, giver="Ann Roe", receiver="Ben Left",
                    managers={"readable": False, "why": "the mirror is down", "by_code": {}})
check("an unreadable manager list is unreadable — never 'no manager', never handed upwards",
      a["readable"] is False and a["mode"] == "" and "the mirror is down" in a["why"], a)

ROW = {"id": "HO0000000001", "location": BM, "col_iso": "2026-10-01", "value": "8A-4P",
       "from_staff": "Ann Roe", "to_staff": "Ben Left", "house_manager": "Hana Boss",
       "approvers": ["Hana Boss"], "approval": "house_manager", "state": "pending",
       "staff_state": "pending", "manager_state": "pending", "offered_by": "Ann Roe",
       "said": {}, "training": {}}
ABOVE = dict(ROW, from_staff="Hana Boss", house_manager="", approvers=[], approval="above",
             offered_by="Hana Boss")
SH = src("shift_handoff")
check("the house manager may approve; a director too (the platform's decider law)",
      sh.may_approve(HANA, ROW) and sh.may_approve(DIRECTOR, ROW))
check("the giver never approves their own offer, the receiver never gives both consents, "
      "a member of staff never approves",
      not sh.may_approve(ANN, ROW) and not sh.may_approve(BEN, ROW) and not sh.may_approve(OTHER, ROW))
check("a director who is the receiver is the receiver — never the approver of it",
      not sh.may_approve(viewer("Ben Left", ("DIRECTOR",), everywhere=True), ROW))
check("an approval asked above is the badges' alone — the house manager in the swap cannot",
      not sh.may_approve(HANA, ABOVE) and sh.may_approve(DIRECTOR, ABOVE)
      and not sh.may_approve(viewer("Rita Lead", ("HM",), ["BM4060"]), ABOVE))
check("the side is the SESSION'S: the receiver accepts, the approver approves, the giver has none",
      sh.side_for(BEN, ROW) == "staff" and sh.side_for(HANA, ROW) == "manager"
      and sh.side_for(DIRECTOR, ROW) == "manager" and sh.side_for(ANN, ROW) == ""
      and sh.side_for(OTHER, ROW) == "")
check("the giver, whoever pressed Transfer for them, and the house's manager may withdraw; "
      "a role word alone is not a house",
      sh.may_withdraw(ANN, ROW) and sh.may_withdraw(HANA, ROW)
      and sh.may_withdraw(viewer("Pip Press"), dict(ROW, offered_by="Pip Press"))
      and sh.may_withdraw(DIRECTOR, ROW)
      and not sh.may_withdraw(BEN, ROW) and not sh.may_withdraw(OTHER, ROW)
      and not sh.may_withdraw(viewer("Moe Manager", ("MANAGER",), role="manager"), ROW)
      and "sr.may_edit_calendar(" not in fn_source(SH, "may_withdraw"))

# ═══════════════════════════════════════════════════════════════════════════
print("\nTHE DIRECTOR — a third consent, from the list, with its own field")
# ═══════════════════════════════════════════════════════════════════════════
DIR_ROW = dict(ROW, directors=["Ty Bond", "Lisa B. Bright"], director_state="pending")
_NOW = datetime.now(timezone.utc)
TY = viewer("Ty Bond", ("DIRECTOR",), everywhere=True)
LISA = viewer("Lisa B. Bright")
check("a name on the list gives the director's approval, whatever badge it wears; nobody else does",
      sh.may_approve_director(TY, DIR_ROW) and sh.may_approve_director(LISA, DIR_ROW)
      and not sh.may_approve_director(HANA, DIR_ROW)
      and not sh.may_approve_director(DIRECTOR, DIR_ROW))
check("a director inside the swap is inside the swap — never its director",
      not sh.may_approve_director(viewer("Ty Bond"), dict(DIR_ROW, to_staff="Ty Bond"))
      and not sh.may_approve_director(viewer("Ty Bond"), dict(DIR_ROW, from_staff="Ty Bond"))
      and not sh.may_approve_director(viewer("Ty Bond"), dict(DIR_ROW, offered_by="Ty Bond")))
check("a swap with no directors written on it has no director's approval to give",
      not sh.may_approve_director(TY, ROW) and sh.director_names(ROW) == [])
check("the side follows what is still waiting: the director's while it is pending",
      sh.side_for(LISA, DIR_ROW) == "director" and sh.side_for(BEN, DIR_ROW) == "staff"
      and sh.side_for(HANA, DIR_ROW) == "manager" and sh.side_for(ANN, DIR_ROW) == ""
      and sh.side_for(OTHER, DIR_ROW) == "")

# ── ONE HUMAN NEVER FILLS TWO SEATS ────────────────────────────────────────
check("A SWAP TAKES THREE PEOPLE: a director is offered the DIRECTOR'S seat, never the house "
      "manager's, so a badge cannot answer for the house manager and then for itself",
      sh.side_for(TY, DIR_ROW) == "director"
      and not sh.may_approve(TY, DIR_ROW)
      and sh.side_for(HANA, DIR_ROW) == "manager")
check("…and once that director has given the manager's consent on a house with no manager, "
      "the director's consent is somebody else's to give",
      sh.may_approve(TY, dict(ABOVE, directors=["Ty Bond"], director_state="pending"))
      and not sh.may_approve_director(
          TY, dict(ABOVE, directors=["Ty Bond"], director_state="pending",
                   manager_state="approved", manager_by="Ty Bond"))
      and sh.side_for(TY, dict(ABOVE, directors=["Ty Bond"], director_state="pending",
                               manager_state="approved", manager_by="Ty Bond")) == ""
      and sh.may_approve_director(
          LISA, dict(ABOVE, directors=["Ty Bond", "Lisa B. Bright"],
                     manager_state="approved", manager_by="Ty Bond")))
check("…and the name that gave the director's consent never gives the house manager's either",
      not sh.may_approve(TY, dict(ABOVE, directors=["Ty Bond"], director_state="approved",
                                  director_by="Ty Bond")))
check("the house manager's seat stays the house manager's even while nobody has answered",
      sh.side_for(viewer("Hana Boss", ("HM",), ["BM4060"]),
                  dict(DIR_ROW, directors=["Hana Boss"], house_manager="Rita Lead",
                       approvers=["Rita Lead"])) == "director"
      and sh.side_for(viewer("Rita Lead", ("HM",), ["BM4060"]),
                      dict(DIR_ROW, directors=["Hana Boss"], house_manager="Rita Lead",
                           approvers=["Rita Lead"])) == "manager")
check("the text door reads the same seats the screen does — it never guesses 'manager'",
      "side_for(" in fn_source(SH, "match_reply")
      and 'or "manager"' not in fn_source(SH, "match_reply"))
check("and the swaps waiting on a name leave out the seat they already filled",
      sh.waits_on(dict(DIR_ROW, directors=["Ty Bond"]), "Ty Bond")
      and not sh.waits_on(dict(ABOVE, directors=["Ty Bond"], manager_state="approved",
                               manager_by="Ty Bond"), "Ty Bond")
      and not sh.waits_on(dict(ABOVE, directors=["Ty Bond"], director_state="approved",
                               director_by="Ty Bond"), "Ty Bond", above=True)
      and sh.waits_on(dict(ABOVE, directors=["Ty Bond"]), "Dan Director", above=True)
      and "waits_on(r, name" in fn_source(SH, "waiting_on"))

# ── THE HOUSE MANAGER WHO IS ALSO ON THE DIRECTORS LIST ────────────────────
HM_DIR_ROW = dict(DIR_ROW, directors=["Hana Boss", "Ty Bond"])
HANA_AS_HM = viewer("Hana Boss", ("HM", "DIRECTOR"), ["BM4060"], everywhere=True)
check("A NAMED HOUSE MANAGER ON THE DIRECTORS LIST ANSWERS AS THE HOUSE MANAGER: that seat is "
      "theirs, and the director's goes to another name on the list",
      sh.side_for(HANA_AS_HM, HM_DIR_ROW) == "manager"
      and sh.side_for(TY, HM_DIR_ROW) == "director")
_hana_gave = dict(HM_DIR_ROW, manager_state="approved", manager_by="Hana Boss")
check("…and once they have, the director's approval is still open to the others — the swap "
      "never stalls on one person holding both seats",
      sh.side_for(HANA_AS_HM, _hana_gave) == "" and sh.side_for(TY, _hana_gave) == "director"
      and sh.may_approve_director(TY, _hana_gave)
      and not sh.may_approve_director(HANA_AS_HM, _hana_gave))
check("…and the offer and the in-flight board both take the named house manager off the "
      "directors while another director remains, and refuse when none does",
      '"directors_manage_the_house"' in fn_source(SH, "offer")
      and '_board_without(named, approval["names"])' in fn_source(SH, "offer")
      and "_board_without(named, manager_names(row))" in fn_source(SH, "adopt_directors")
      and sh._board_without(["Hana Boss", "Ty Bond"], ["Hana Boss"]) == ["Ty Bond"]
      and sh._board_without(["Lisa B. Bright"], ["Lisa Bright"]) == [])

# ── A LISTED NAME MAY DROP ITS MIDDLE INITIAL ─────────────────────────────
LISA_PLAIN = viewer("Lisa Bright")
check("THE DIRECTORS LIST IS MATCHED AS TIME OFF MATCHES IT: 'Lisa B. Bright' on the list is the "
      "account 'Lisa Bright' — and never 'Lisa C. Bright'",
      sh.may_approve_director(LISA_PLAIN, DIR_ROW)
      and sh.side_for(LISA_PLAIN, DIR_ROW) == "director"
      and not sh.may_approve_director(viewer("Lisa C. Bright"), DIR_ROW)
      and sh.waits_on(DIR_ROW, "Lisa Bright")
      and sh.describe(DIR_ROW, LISA_PLAIN)["may_approve_director"]
      and sh.describe(DIR_ROW, LISA_PLAIN)["mine"])
_answer_src = fn_source(SH, "answer")
check("…and the door's director checks read the same rule, never a spelling compared by hand — the row's "
      "list is read bare only to ask whether it names anybody yet",
      _answer_src.count("listed_director(who, row)") == 2
      and _answer_src.count("director_names(") == _answer_src.count("not director_names(row)") == 1)
check("…and a director inside the swap under another spelling is still inside it",
      not sh.may_approve_director(LISA_PLAIN, dict(DIR_ROW, to_staff="Lisa B. Bright")))

# ── THE MASTER'S OWN SESSION ──────────────────────────────────────────────
MASTER_V = dict(viewer("Main Account", ("ADMIN", "MASTER"), everywhere=True, role="admin"), is_master=True)
check("THE MASTER'S OWN SESSION IS AN ELIGIBLE DIRECTOR: offered the director's seat as a listed name is",
      sh.may_approve_director(MASTER_V, DIR_ROW) and sh.side_for(MASTER_V, DIR_ROW) == "director"
      and sh.describe(DIR_ROW, MASTER_V)["may_approve_director"]
      and not sh.may_approve_director(dict(MASTER_V, is_master=False), DIR_ROW)
      and not sh.may_approve_director(dict(MASTER_V, is_master="yes"), DIR_ROW))
check("…but THREE PEOPLE still: never inside the swap, never after giving the house manager's consent, never "
      "without a name the seat is recorded by",
      not sh.may_approve_director(MASTER_V, dict(DIR_ROW, to_staff="Main Account"))
      and not sh.may_approve_director(MASTER_V, dict(ABOVE, directors=["Ty Bond"], director_state="pending",
                                                     manager_state="approved", manager_by="Main Account"))
      and not sh.may_approve_director(dict(MASTER_V, name=""), DIR_ROW))
check("…and the door lifts only the list's two refusals for the master, as the session's flag says, never a text",
      "if side == \"director\" and who and not master and not director_names(row):" in _answer_src
      and "if side == \"director\" and who and not master and not listed_director(who, row):" in _answer_src
      and "master: bool = False" in _answer_src
      and 'master=who.get("is_master") is True' in fn_source(src("snapshot_service"), "lane_handoff_answer")
      and "master=" not in fn_source(SH, "match_reply"))
_door = sh.door_row(DIR_ROW, "handoff_ask_director:lisabbright",
                    people=[{"name": "Lisa Bright"}, {"name": "Ty Bond"}])
check("THE DOOR IS HANDED THE PEOPLE HOUSE'S SPELLING, so it can find them — the seat stays "
      "keyed on the listed name",
      _door["person"] == "Lisa Bright" and _door["to_name"] == "Lisa Bright"
      and _door["director"] == "Lisa Bright"
      and _door["id"].endswith(":handoff_ask_director:lisabbright")
      and sh.door_row(DIR_ROW, "handoff_ask_director:lisabbright")["person"] == "Lisa B. Bright"
      and sh.door_row(ROW, "handoff_ask_manager",
                      people=[{"name": "Hana  Boss"}])["person"] == "Hana Boss", _door)

# ── A BARE REPLY FROM THE PHONE A DIRECTOR'S ASK REACHED ──────────────────
_t = datetime(2026, 9, 30, 14, 0, tzinfo=timezone.utc)
_seat_said = {"said": {"handoff_ask_director:tybond": {"state": "told", "phone_key": "kty",
                                                       "at": _t.isoformat()},
                       "handoff_ask_director:lisabbright": {"state": "told", "phone_key": "kli",
                                                            "at": (_t + timedelta(minutes=2))
                                                            .isoformat()}}}
check("A DIRECTOR'S ASK IS KEPT PER SEAT, AND ITS BARE KIND READS EVERY SEAT BY PHONE — so a "
      "bare YES from the phone it reached answers it",
      sh.asked_at(_seat_said, "kty", _t + timedelta(minutes=5), sh.KIND_ASK_DIRECTOR) == _t
      and sh.asked_at(_seat_said, "kli", _t + timedelta(minutes=5), sh.KIND_ASK_DIRECTOR)
      == _t + timedelta(minutes=2)
      and sh.asked_at(_seat_said, "kli", _t + timedelta(minutes=5),
                      "handoff_ask_director:lisabbright") == _t + timedelta(minutes=2))
check("…never from another phone, never before it reached them, never a rehearsal row",
      sh.asked_at(_seat_said, "kzz", _t + timedelta(minutes=5), sh.KIND_ASK_DIRECTOR) is None
      and sh.asked_at(_seat_said, "kli", _t + timedelta(minutes=1), sh.KIND_ASK_DIRECTOR) is None
      and sh.asked_at({"said": {"handoff_ask_director:tybond": {
          "state": "recorded", "phone_key": "kty", "at": _t.isoformat()}}},
          "kty", _t + timedelta(minutes=5), sh.KIND_ASK_DIRECTOR) is None
      and sh.asked_at(_seat_said, "kty", _t + timedelta(minutes=5), sh.KIND_ASK_STAFF) is None)
SE = src("sms_ears")
check("…and the text door asks for the director's ask by its kind, and never invents a seat",
      "shift_handoff.KIND_ASK_DIRECTOR" in fn_source(SE, "_bare")
      and 'side = "manager"' not in fn_source(SE, "_bare")
      and "continue" in fn_source(SE, "_bare"))

# ── WHO IS OWED WHICH DIRECTOR MESSAGE ─────────────────────────────────────
check("the director who already gave the house manager's consent is not asked for the "
      "director's too — the door would refuse them",
      sh._wanted(dict(ABOVE, directors=["Ty Bond", "Lisa B. Bright"], manager_state="approved",
                      manager_by="Ty Bond"), {})
      == ["handoff_ask_staff", "handoff_ask_director:lisabbright"])
_reached_both = {"handoff_ask_director:tybond": {"state": "told"},
                 "handoff_ask_director:lisabbright": {"state": "told"}}
check("one director's NO closes the swap: every other director the ask reached is told, and "
      "never the one who said it",
      sh._wanted(dict(DIR_ROW, state="dead", director_state="declined", director_by="Ty Bond",
                      closed_by="Ty Bond"), _reached_both)
      == ["handoff_declined", "handoff_declined_director:lisabbright"])
check("a director who answered on the Hub under the account's spelling is told how it ended",
      sh._wanted(dict(DIR_ROW, state="done", director_state="approved",
                      director_by="Lisa Bright"), {})[-1] == "handoff_done_director:lisabbright")
check("A SWAP CLOSED BEFORE A DIRECTOR WAS ASKED says so — never 'director · waiting'",
      sh.describe(dict(ROW, state="done", director_state="pending", directors=[]),
                  HANA)["director_state"] == "not_asked"
      and sh.describe(dict(ROW, state="pending", director_state="pending", directors=[]),
                      HANA)["director_state"] == "pending"
      and sh.describe(dict(DIR_ROW, state="dead"), HANA)["director_state"] == "pending")

# ── ONE PERSON'S CALL-OFF IS NOT EVERY SHIFT AT THAT HOUSE THAT DAY ────────
_span = (datetime(2026, 10, 1, 12, 0, tzinfo=timezone.utc),
         datetime(2026, 10, 1, 20, 0, tzinfo=timezone.utc))
_held = [{"employee": "Ann Roe", "col_iso": "2026-10-01", "value": "8A-4P", "span": _span},
         {"employee": "Ben Left", "col_iso": "2026-10-01", "value": "8A-4P", "span": _span}]
_hs = {h["employee"]: h for h in sh.house_shifts(
    "dsn", BM, HANA, held=_held, now=_span[0] - timedelta(days=1),
    offers=({}, {}, {(BM, "2026-10-01", "annroe")}))}
check("A CALL-OFF IS KEYED BY THE PERSON WHO CALLED OFF: their shift is given from its red cell, "
      "and a colleague's shift that day may still be handed over",
      _hs["Ann Roe"]["may_transfer"] is False and "called off" in _hs["Ann Roe"]["why"]
      and _hs["Ben Left"]["may_transfer"] is True and _hs["Ben Left"]["why"] == ""
      and "open_row" in fn_source(SH, "_offered_and_called"), _hs)
check("BOTH REFUSALS ARE THE DOOR'S TOO, so a text cannot do what the screen will not",
      all(w in fn_source(SH, "answer") for w in ('"two_seats"', '"not_the_managers_seat"')))
check("THE THREE CONSENTS ARE READ FROM THEIR OWN FIELDS — none is inferred from another",
      not sh.all_agreed(dict(DIR_ROW, staff_state="accepted", manager_state="approved"))
      and not sh.all_agreed(dict(DIR_ROW, staff_state="accepted", director_state="approved"))
      and not sh.all_agreed(dict(DIR_ROW, manager_state="approved", director_state="approved"))
      and sh.all_agreed(dict(DIR_ROW, staff_state="accepted", manager_state="approved",
                             director_state="approved")))
check("…and the minute beat only looks at swaps all three have agreed",
      "AND director_state=%s" in fn_source(SH, "complete_ready"))
check("a second answer on a side cannot overwrite the first: the UPDATE is conditional on pending",
      fn_source(SH, "_answer_locked").count("AND state=%s AND") == 3
      and "director_state=%s RETURNING" in fn_source(SH, "_answer_locked"))
check("the screens are told each answer's own door and its own time",
      all(k in fn_source(SH, "describe") for k in ('"director_via"', '"director_at"',
                                                   '"director_by"', '"may_approve_director"')))
check("pending: the receiver, the house manager and EVERY director are asked, each their own ask",
      sh._wanted(DIR_ROW, {}) == ["handoff_ask_staff", "handoff_ask_manager",
                                  "handoff_ask_director:tybond",
                                  "handoff_ask_director:lisabbright"]
      and sh._recipient(DIR_ROW, "handoff_ask_director") == "Ty Bond"
      and sh._recipient(DIR_ROW, "handoff_ask_director:lisabbright") == "Lisa B. Bright")
check("…and each director's ask is recorded under its own seat, so one answered is not all answered",
      sh.door_row(DIR_ROW, "handoff_ask_director:lisabbright")["id"]
      .endswith(":handoff_ask_director:lisabbright")
      and sh.door_row(DIR_ROW, "handoff_ask_director:lisabbright")["kind"] == "handoff_ask_director"
      and sh.door_row(DIR_ROW, "handoff_ask_director:lisabbright")["person"] == "Lisa B. Bright"
      # the first seat told is not the second seat told: each is owed on its own record
      and sh._owed_again({"state": "told", "at": _NOW.isoformat()}, _NOW) is False
      and sh._owed_again(None, _NOW) is True)
check("done: the director who ANSWERED is told, by name, and a director nobody asked is not",
      sh._wanted(dict(DIR_ROW, state="done", director_state="approved",
                      director_by="Lisa B. Bright"), {})
      == ["handoff_done", "handoff_done_taker", "handoff_done_manager",
          "handoff_done_director:lisabbright"])
check("a director who said no is not told their own no; one who was never asked is told nothing",
      sh._wanted(dict(DIR_ROW, state="dead", director_state="declined", closed_by="Ty Bond"), {})
      == ["handoff_declined"]
      and "handoff_declined_director" not in sh._wanted(dict(DIR_ROW, state="dead"), {}))
check("the ask carries the directors it names",
      sh.door_row(DIR_ROW, "handoff_ask_director")["directors"] == ["Ty Bond", "Lisa B. Bright"]
      and sh.door_row(DIR_ROW, "handoff_ask_director")["person"] == "Ty Bond")
off_src = fn_source(SH, "offer")
check("THE DIRECTORS COME FROM THE LIST, NEVER FROM CODE, and are read before anything is written",
      "time_off.directors_declared(dsn)" in fn_source(SH, "directors_for")
      and "directors_for(dsn)" in off_src
      and off_src.index("directors_for(dsn)") < off_src.index("INSERT INTO asa_shift_handoffs")
      and "Ty Bond" not in src("shift_handoff"))
check("a list that could not be read refuses the swap — nobody is asked about a swap nobody can approve",
      '"directors_unreadable"' in off_src and '"directors_in_the_swap"' in off_src)
check("…while a list that names nobody opens the swap as time off is filed: no refusal at the door, the row "
      "says the director's approval waits, and a director's answer is refused until one is asked",
      '"no_directors"' not in off_src and "_NO_NAMED" in off_src
      and '"no_directors"' in fn_source(SH, "answer"))

# ── AN EMPTY LIST IS NOT A BOARD, AND NEITHER IS A CONSTANT ────────────────
import time_off as to  # noqa: E402


def _unread_of(fn):
    try:
        fn()
    except to.Unreadable as exc:
        return str(exc)
    return None


check("the declared board is the CELL's: a blank cell names nobody, a missing row is unreadable, and no "
      "list falls back to names in the source",
      to.directors_of({"directors": "A One, B Two"}) == ["A One", "B Two"]
      and to.directors_of({"directors": "  "}) == []
      and "could not be read" in str(_unread_of(lambda: to.directors_of({})))
      and not hasattr(to, "DIRECTORS_DEFAULT") and "directors" not in to.SETTINGS_DEFAULTS)
_held_view = to.view
try:
    to.view = lambda dsn, **k: {"minted": True, "settings": {**to.SETTINGS_DEFAULTS, "directors": ""},
                                "settings_rows": [{"key": "directors", "value": ""}]}
    empty = sh.directors_for("dsn")
    to.view = lambda dsn, **k: {"minted": True, "settings": dict(to.SETTINGS_DEFAULTS), "settings_rows": []}
    norow = sh.directors_for("dsn")
    to.view = lambda dsn, **k: {"minted": False, "settings": dict(to.SETTINGS_DEFAULTS)}
    nohouse = sh.directors_for("dsn")

    def _raise(dsn, **k):
        raise to.Unreadable("the mirror is down")

    to.view = _raise
    down = sh.directors_for("dsn")

    # the Settings screen says which it is: named, blank, or not landed
    _held_people, _held_accounts = to.people_rows, to._accounts
    to.people_rows, to._accounts = (lambda: []), (lambda dsn: [])
    try:
        to.view = lambda dsn, **k: {"minted": True, "id": "", "rows": [],
                                    "settings": {**to.SETTINGS_DEFAULTS, "directors": ""},
                                    "settings_rows": [{"key": "directors", "value": ""}]}
        st_empty = to.settings_state("dsn")
        to.view = lambda dsn, **k: {"minted": True, "id": "", "rows": [],
                                    "settings": {**to.SETTINGS_DEFAULTS, "directors": "A One"},
                                    "settings_rows": [{"key": "directors", "value": "A One"}]}
        st_named = to.settings_state("dsn")
        to.view = lambda dsn, **k: {"minted": True, "id": "", "rows": [],
                                    "settings": dict(to.SETTINGS_DEFAULTS), "settings_rows": []}
        st_unread = to.settings_state("dsn")
    finally:
        to.people_rows, to._accounts = _held_people, _held_accounts
finally:
    to.view = _held_view
check("THE SETTINGS SCREEN SAYS WHICH IT IS — named, a blank cell that names nobody, or a list that did "
      "not land — and there is no fallback list to show",
      st_empty["directors_declared"] is False and st_empty["directors_readable"] is True
      and "names no director" in st_empty["directors_why"]
      and st_named["directors_declared"] is True and st_named["directors"] == ["A One"]
      and st_named["directors_why"] == ""
      and st_unread["directors_readable"] is False and st_unread["directors"] == []
      and "could not be read" in st_unread["directors_why"],
      [st_empty, st_named, st_unread])
check("A BLANK DIRECTORS CELL NAMES NOBODY — read, never the names in the source, and said as blank",
      empty["readable"] is True and empty["names"] == []
      and "name no director" in empty["why"] and "Settings tab" in empty["why"], empty)
check("a Settings tab with no directors row is unreadable, not a blank one",
      norow["readable"] is False and not norow["names"] and "could not be read" in norow["why"], norow)
check("no Time Off house declared is unreadable, not an empty board",
      nohouse["readable"] is False and not nohouse["names"]
      and "could not be read" in nohouse["why"], nohouse)
check("a list that could not be read is UNREADABLE, loudly, carrying its own sentence, and never an empty one",
      down["readable"] is False and not down["names"]
      and "the mirror is down" in down["why"], down)
check("a row of the estate that is not a house is never offered as one",
      "house_directory.read(dsn)" in fn_source(SH, "swaps_feed")
      and "in houses" in fn_source(SH, "swaps_feed"))
check("who may open a swap is the server's question: the person whose shift it is, or that "
      "house's manager — never a role word, and never a badge that decides every house",
      "sr.manages" in fn_source(SH, "may_open")
      and "sr.may_decide(" not in fn_source(SH, "may_open")
      and "decides_everywhere" not in fn_source(SH, "may_open")
      and "sr.may_edit_calendar(" not in fn_source(SH, "may_open"))
check("…and the Swaps tab offers a badge's reader only the houses they manage",
      "decides_everywhere" not in fn_source(SH, "swaps_feed")
      and "sr.houses_managed(dsn, me)" in fn_source(SH, "swaps_feed"))
check("A READ THAT FAILED IS SAID ON THE SWAPS TAB — never an empty list of houses",
      "the house directory could not be read" in fn_source(SH, "swaps_feed")
      and "who manages which house could not be read" in fn_source(SH, "swaps_feed"))

print("\nREAL PEOPLE ONLY")
check("OPEN rows, WORKSHOP rows, FAMILY and Nurse are rows, not people",
      all(sh.placeholder(n, BM) for n in ("OPEN", "OPEN 2", "WORKSHOP (JH)", "FAMILY", "Nurse",
                                          "  nurse ", "")))
check("a one-word row is a person only when the staff roster holds a phone for it",
      sh.placeholder("Solo", BM) and sh.placeholder("Solo", BM, reachable={"annroe"})
      and not sh.placeholder("Solo", BM, reachable={"solo"}))
check("a first and last name is a person", not sh.placeholder("Ann Roe", BM, reachable=set()))
bar = sh._receiver_bar("Eve Cell", location=BM, col_iso="2026-10-01", own="5P-11P", reachable=None)
check("their own cell that day at this house must be free — one shift per person per day",
      bar[0] == "cell_taken" and "Eve Cell already has 5P-11P at BM on 2026-10-01" in bar[1], bar)
check("OFF is a free cell",
      sh._receiver_bar("Eve Cell", location=BM, col_iso="2026-10-01", own="OFF",
                       reachable=None)[0] == "ok")
bar = sh._receiver_bar("Pat Nophone", location=BM, col_iso="2026-10-01", own="",
                       reachable={"annroe"})
check("nobody without a phone on the staff roster or an account is offered",
      bar[0] == "no_contact" and "could not be asked" in bar[1], bar)
check("…and when the roster could not be read, nobody is refused for it",
      sh._receiver_bar("Pat Nophone", location=BM, col_iso="2026-10-01", own="",
                       reachable=None)[0] == "ok")

print("\nONLY A REAL OUTCOME CLOSES AN ASK")
NOW = datetime(2026, 9, 30, 15, 0, tzinfo=timezone.utc)


def entry(state, dial="send", test_mode="", ago_min=5):
    return {"state": state, "dial": dial, "test_mode": test_mode,
            "at": (NOW - timedelta(minutes=ago_min)).isoformat()}


held_dial = dict(sh._DIAL)
try:
    sh._DIAL.update(word="", test_mode="", at="")
    check("never asked: owed", sh._owed_again(None, NOW))
    check("told, duplicate and opted out are final",
          not any(sh._owed_again(entry(s), NOW) for s in ("told", "duplicate", "opted_out")))
    check("the ledger's first shape (a bare stamp) is final", not sh._owed_again("2026-09-30", NOW))
    check("a rehearsal row after a restart, the dial not heard yet: NOT re-recorded",
          not sh._owed_again(entry("recorded", dial="record"), NOW))
    sh.note_dial("record")
    check("the dial still at record: the rehearsal row is not written again, pass after pass",
          not sh._owed_again(entry("recorded", dial="record"), NOW)
          and not sh._owed_again(entry("rehearsed", dial="record"), NOW))
    sh.note_dial("send")
    check("the dial moved to send: the ask that reached nobody is owed again",
          sh._owed_again(entry("recorded", dial="record"), NOW))
    check("recorded AT send (test mode held it): owed again only once the door says test mode is off",
          not sh._owed_again(entry("recorded", dial="send"), NOW)
          and not sh._owed_again(entry("redirected", dial="send", test_mode="on"), NOW))
    sh.note_dial("send", "off")
    check("…and then it is", sh._owed_again(entry("redirected", dial="send", test_mode="on"), NOW))
    sh.note_dial("off")
    check("the dial at off: owed again once it is not", not sh._owed_again(entry("dial_off"), NOW))
    sh.note_dial("record")
    check("…and it moved", sh._owed_again(entry("dial_off", dial="off"), NOW))
    sh.note_dial("unknown")
    check("a dial the door could not read changes nothing", sh._DIAL["word"] == "record")
    check("held, no manager, nobody to text, not on staff, refused, failed: owed again after "
          "RETRY_MIN, not every minute",
          all(not sh._owed_again(entry(s, ago_min=10), NOW) and sh._owed_again(
              entry(s, ago_min=sh.RETRY_MIN + 1), NOW)
              for s in ("held", "no_manager", "no_contact", "not_staff", "refused", "failed")))
finally:
    sh._DIAL.update(held_dial)

print("\nWHO IS TOLD WHAT")
reached = {"state": "told", "phone_key": "k1", "at": "2026-09-30T14:00:00+00:00"}
check("pending: the receiver and the house manager are asked",
      sh._wanted(ROW, {}) == ["handoff_ask_staff", "handoff_ask_manager"])
check("an approval asked above goes to the directors, not a house manager",
      sh._wanted(ABOVE, {}) == ["handoff_ask_staff", "handoff_ask_above"])
check("done: the giver, the receiver and the house manager are told",
      sh._wanted(dict(ROW, state="done"), {}) == ["handoff_done", "handoff_done_taker",
                                                  "handoff_done_manager"])
check("done above: no house manager to tell",
      sh._wanted(dict(ABOVE, state="done"), {}) == ["handoff_done", "handoff_done_taker"])
dead = dict(ROW, state="dead", closed_by="Ann Roe", staff_state="accepted")
check("withdrawn by the giver: the giver is not told what they did; the receiver who accepted is",
      sh._wanted(dead, {}) == ["handoff_declined_taker"])
dead = dict(ROW, state="dead", closed_by="Ben Left", staff_state="declined")
check("the receiver passed: they are not told, the giver is — and the house manager only if asked",
      sh._wanted(dead, {}) == ["handoff_declined"]
      and sh._wanted(dead, {"handoff_ask_manager": reached}) == ["handoff_declined",
                                                                 "handoff_declined_manager"])
dead = dict(ROW, state="dead", manager_state="declined")
check("the house manager said no: the giver is told, the house manager is not",
      sh._wanted(dead, {"handoff_ask_staff": reached}) == ["handoff_declined",
                                                           "handoff_declined_taker"])
check("a receiver the ask never reached, who never accepted, is not told of an offer they never saw",
      sh._wanted(dict(ROW, state="dead"), {"handoff_ask_staff": {"state": "recorded"}})
      == ["handoff_declined"])

door = sh.door_row({**ROW, "shift_start": datetime(2026, 10, 1, 12, 0, tzinfo=timezone.utc),
                    "manager_phone": "3305550101", "why": "the shift changed — X → Y"},
                   "handoff_ask_manager", {"BM4060": "BM home"})
check("the row carries every word the door renders: house code and name, day, start, shift",
      door["house"] == "BM4060" and door["house_name"] == "BM home" and door["day"] == "2026-10-01"
      and door["shift_at"] == "2026-10-01T08:00:00-04:00" and door["shift_code"] == "8A-4P", door)
check("…the giver, the taker, the recipient, and the house manager this relay resolved",
      door["from_staff"] == "Ann Roe" and door["taker"] == "Ben Left"
      and door["person"] == "Hana Boss" and door["to_name"] == "Hana Boss"
      and door["house_manager"] == "Hana Boss" and door["manager_phone"] == "3305550101"
      and door["approvers"] == ["Hana Boss"] and door["id"] == "HO0000000001:handoff_ask_manager",
      door)
check("each kind is written to the right half of the pair",
      sh._recipient(ROW, "handoff_ask_staff") == "Ben Left"
      and sh._recipient(ROW, "handoff_done") == "Ann Roe"
      and sh._recipient(ROW, "handoff_done_taker") == "Ben Left"
      and sh._recipient(ROW, "handoff_declined_manager") == "Hana Boss"
      and sh._recipient(ABOVE, "handoff_ask_above") == "")
check("a reason is folded to ASCII before it is written — one em dash makes a text UCS-2",
      sh._plain("the shift changed — X → Y") == "the shift changed - X -> Y"
      and sh._plain("it’s done…") == "it's done...")

print("\nA BARE YES FROM THE PHONE THE ASK REACHED")
row = {"said": {"handoff_ask_staff": reached}}
t0 = datetime(2026, 9, 30, 14, 0, tzinfo=timezone.utc)
check("the receiver's ask reached this phone before the text: it answers the swap",
      sh.asked_by_text(row, "k1", t0 + timedelta(minutes=1)))
check("…not before it reached them, not from another phone, not a rehearsal row",
      not sh.asked_by_text(row, "k1", t0 - timedelta(minutes=1))
      and not sh.asked_by_text(row, "k2", t0 + timedelta(minutes=1))
      and not sh.asked_by_text({"said": {"handoff_ask_staff": dict(reached, state="recorded")}},
                               "k1", t0 + timedelta(minutes=1)))
heard = {"k1": [(t0, "yes"), (t0 + timedelta(minutes=5), "other")], "k2": [(t0, "no")]}
held_hook = pr.CLAIMED_ELSEWHERE
try:
    pr.CLAIMED_ELSEWHERE = None
    check("no swap lane: every reply is the shift flow's, as before", pr._unclaimed(heard) is heard)
    asked = []
    pr.CLAIMED_ELSEWHERE = lambda pairs: (asked.append(sorted(pairs)) or {("k1", t0)})
    got = pr._unclaimed(heard)
    check("a YES a swap claims is left to the swap; its other replies and other phones stay",
          got == {"k1": [(t0 + timedelta(minutes=5), "other")], "k2": [(t0, "no")]}, got)
    check("…and only yes and no are ever asked about — each with when the flow's own newest ask "
          "reached that phone (none here)",
          asked == [[("k1", t0, None), ("k2", t0, None)]], asked)

    def broken(pairs):
        raise RuntimeError("down")
    pr.CLAIMED_ELSEWHERE = broken
    check("claims that cannot be read remove nothing — never every yes on the platform",
          pr._unclaimed(heard) is heard)
finally:
    pr.CLAIMED_ELSEWHERE = held_hook

print("\nWHAT THE SCREENS ARE TOLD")
d = sh.describe({**ROW, "said": {"handoff_ask_staff": reached,
                                 "handoff_ask_manager": {"state": "no_manager", "why": "none"}}},
                HANA)
check("the approver sees Approve, and what became of each text",
      d["may_approve"] and not d["may_accept"] and d["may_withdraw"]
      and d["asks"]["staff"]["reached"] and d["asks"]["manager"]["state"] == "no_manager"
      and not d["asks"]["manager"]["reached"], d)
d = sh.describe(ROW, BEN)
check("the receiver sees Accept, never Approve", d["may_accept"] and not d["may_approve"]
      and not d["may_withdraw"] and d["mine"], d)
d = sh.describe(ROW, ANN)
check("the giver sees Withdraw", d["may_withdraw"] and not d["may_accept"] and not d["may_approve"]
      and d["mine"], d)
d = sh.describe(ROW, OTHER)
check("anybody else sees nothing to do, and is not part of it",
      not (d["may_accept"] or d["may_approve"] or d["may_withdraw"] or d["mine"]), d)
d = sh.describe(dict(ROW, state="done"), HANA)
check("a closed offer offers nothing to anybody", not (d["may_approve"] or d["may_withdraw"]), d)
d = sh.describe(ABOVE, HANA)
check("the approval asked above names why, and whose ask it is",
      d["approval"]["mode"] == "above" and not d["may_approve"], d)

# ═══════════════════════════════════════════════════════════════════════════
print("\nTHE DOORS — every one decides from the session")
# ═══════════════════════════════════════════════════════════════════════════
SS = src("snapshot_service")
offer_door = fn_source(SS, "lane_handoff_offer")
check("the offer door never reads a house manager, and asks the relay who may open a swap — "
      "a hidden button is not a gate",
      'body.get("house_manager")' not in offer_door and "house_manager=" not in offer_door
      and "_handoff_may_open(who, location, giver" in offer_door
      and "shift_handoff.may_open" in fn_source(SS, "_handoff_may_open")
      and "shift_requests.fold(giver) != shift_requests.fold(me)" not in offer_door
      and "_housecal_viewer(authorization)" in offer_door, offer_door[:300])
check("the candidates door asks the same question before it names anybody",
      "_handoff_may_open(who, location, giver" in fn_source(SS, "lane_handoff_candidates"))
may_open_door = fn_source(SS, "_handoff_may_open")
check("WHO MANAGES THE HOUSE COULD NOT BE READ is a 503 that says so, never the 403 that tells a house "
      "manager the shift is not theirs — and neither door names a door that does not exist",
      "except shift_handoff.Refused" in may_open_door and '"status": 503' in may_open_door
      and "taken by phone" not in fn_source(SS, "lane_handoff_candidates")
      and "taken by phone" not in offer_door)
_mgr_calls = []


def _mgr_down(dsn, **k):
    _mgr_calls.append(bool(k.get("fresh")))
    return {"readable": False, "why": "the hotline calendar mirror could not be read", "by_code": {}}


_held_mgrs = sr.house_managers
sr.house_managers = _mgr_down
try:
    _own = sh.may_open("dsn", {"name": "Gia Give"}, location=NW, giver="Gia Give")
    _own_reads = list(_mgr_calls)
    try:
        sh.may_open("dsn", {"name": "Nia Day"}, location=NW, giver="Gia Give")
        _other = None
    except sh.Refused as exc:
        _other = [exc.code, exc.why]
finally:
    sr.house_managers = _held_mgrs
check("the giver opens their own swap without the managers list being read at all",
      _own is True and _own_reads == [], _own_reads)
check("somebody else's swap, with who manages the house unreadable, is REFUSED AS UNREADABLE after one fresh "
      "read — not 'not this house's manager'",
      _other is not None and _other[0] == "managers_unreadable" and "could not be read" in _other[1]
      and _mgr_calls == [False, True], [_other, _mgr_calls])
check("the Swaps tab has a door of its own, and it reads the session like every other",
      "shift_handoff.swaps_feed" in fn_source(SS, "lane_handoff_swaps")
      and "_requests_viewer(authorization)" in fn_source(SS, "lane_handoff_swaps"))
answer_door = fn_source(SS, "lane_handoff_answer")
check("the answer door works the side out from the session, never from the body",
      "shift_handoff.side_for(who, row)" in answer_door and 'body.get("side")' not in answer_door
      and "match_reply" not in answer_door)
for name in ("lane_handoff_list", "lane_handoff_offer", "lane_handoff_answer", "lane_handoff_withdraw",
             "lane_handoff_candidates"):
    text = fn_source(SS, name)
    check(f"{name}: no role word decides anything", text and "actor[0]" not in text
          and '"admin", "manager"' not in text, text[:160])
check("the withdraw door asks may_withdraw", "shift_handoff.may_withdraw(who, row)"
      in fn_source(SS, "lane_handoff_withdraw"))
cand = fn_source(SS, "lane_handoff_candidates")
check("the names come from the server, with who can be reached",
      "shift_handoff.candidates" in cand and "_reachable_names" in cand
      and "detail=shift_requests.may_edit_calendar(who, location)" in cand)
check("the Requests training door releases the swap its approval was raised for",
      "shift_handoff.training_answered" in fn_source(SS, "lane_shift_requests_training"))
check("the House Calendars grid carries the transfers waiting there, and says when it could not",
      "shift_handoff.for_house" in fn_source(SS, "_housecal_grid_for")
      and 'grid["handoffs_why"]' in fn_source(SS, "_housecal_grid_for"))
check("the shift flow is told which replies a swap claims, at startup",
      "psi_reminders.CLAIMED_ELSEWHERE" in fn_source(SS, "_start")
      and "shift_handoff.claimed_replies" in fn_source(SS, "_start"))
check("every post of the shift door says where the dial stands",
      all("note_dial" in fn_source(SS, n) for n in ("_psi_reminders_post", "_sms_replies_post",
                                                    "_shift_requests_post"))
      and "shift_handoff.mark_said" in fn_source(SS, "_shift_handoff_post"))
SH = src("shift_handoff")
_ensure = fn_source(SH, "ensure_tables")
check("ONE OPEN OFFER PER GIVER'S SHIFT, NOT PER HOUSE-DAY: the unique index keys whose shift it is, the "
      "house-day index is dropped only after the giver's stands and only in its table's own schema, and every "
      "offered map keys the giver",
      "regexp_replace(lower(from_staff)" in sh.OPEN_INDEX_DDL and "(location, col_iso)" not in sh.OPEN_INDEX_DDL
      and sh.RETIRED_OPEN_INDEX == "asa_shift_handoffs_open"
      and "DROP INDEX IF EXISTS asa_shift_handoffs_open" not in SH
      and 0 < _ensure.index("cur.execute(OPEN_INDEX_DDL)") < _ensure.index("_retire_open_index(cur)")
      and all("_offer_key(" in fn_source(SH, f) for f in ("_offered_and_called", "my_shifts", "house_shifts"))
      and "sr.fold(giver)" in fn_source(SH, "_giver_shift")
      and "AlreadyOffered(location, col_iso, from_staff)" in fn_source(SH, "offer"))
_retire = fn_source(SH, "_retire_open_index")
check("the house-day index is dropped only beside the table this connection resolves — qualified by "
      "that table's own schema, so a test's room or the rehearsal's sandbox never drops an index of "
      "that name further down its search path",
      "to_regclass('asa_shift_handoffs')" in sh.TABLE_SCHEMA_SQL
      and "pgsql.Identifier(str(got[0]), RETIRED_OPEN_INDEX)" in _retire
      and "RETIRED_OPEN_INDEX_DDL" not in _ensure, _retire)
check("NO UNQUALIFIED DROP OF THE RETIRED INDEX IS LEFT: it would resolve on the search path and drop the "
      "one in the next schema along, and the rehearsal's wall refuses a DO block",
      "DROP INDEX IF EXISTS asa_shift_handoffs_open" not in SH and "DO $$" not in SH)
off = fn_source(SH, "offer")
check("every refusal comes before anything is written; the training row rides the offer's own "
      "transaction", off.index("sr.check_assignment(") < off.index("INSERT INTO asa_shift_handoffs")
      and off.index("approval_for(") < off.index("INSERT INTO asa_shift_handoffs")
      and off.index("INSERT INTO asa_shift_handoffs") < off.index("sr._record_training(cur,")
      and "conn.commit()" in off.split("sr._record_training(cur,", 1)[1])
comp = fn_source(SH, "_complete")
check("the completion writes through the one writer and never records a training on its own guess",
      "calendar_builder_houses.publish_cells(" in comp and "guard_assignment" not in comp
      and "ignore_handoff=row[\"id\"]" in comp)
check("an overlap check that could not run pauses — never kills — an agreed swap; an unreadable IST "
      "is a missing one and raises the training approval (rule 7)",
      comp.count("return _pause(") >= 4 and '"unreadable"' not in comp
      and "sr.raise_training(" in comp)
check("completions run under both people's gates and the row's own lock",
      "sr.person_gates(dsn, [got[\"from_staff\"], got[\"to_staff\"]])" in fn_source(SH, "complete_ready")
      and "FOR UPDATE SKIP LOCKED" in fn_source(SH, "complete_ready")
      and "expire(dsn" in fn_source(SH, "complete_ready"))
ans = fn_source(SH, "answer")
check("an answer takes the giver's, the receiver's and the trainers' gates in one order, and "
      "forgets the estate once the shift moved",
      "sr.person_gates(dsn, [row[\"from_staff\"], row[\"to_staff\"], *trainers]" in ans
      and "gated=False" in ans and "sr.forget_estate()" in ans)
check("a dead offer closes the training approval it carried",
      "sr.WITHDRAWN" in fn_source(SH, "_close") and "sr.NEEDS_TRAINING" in fn_source(SH, "_close"))
check("nothing is offered inside the quiet window", "psi_reminders.quiet(now)" in fn_source(SH, "owed"))
pkg = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
check("this suite runs in `npm run check`",
      pkg["scripts"].get("test:shift-transfer") == "python3 tools/test-shift-transfer.py"
      and "npm run test:shift-transfer" in pkg["scripts"].get("check", ""))

# the lane — against a real database, in a schema of its own


LANE = r'''
import json, os, sys
from datetime import datetime, timedelta, timezone
sys.path.insert(0, LANE_DIR)
import psycopg2, psycopg2.extras
import lane_schema
import house_cal_live as hcl, shift_handoff as sh
import shift_requests as sr
import calendar_builder_houses as cbh
import psi_reminders as pr
import house_directory as hd
import effective_roster
# an unregistered switch holds; this lane writes the stand-in workbook
effective_roster.use_switch(lambda: {"on": False, "readable": True, "word": "off", "why": ""})

DSN = os.environ["HUB_SNAPSHOT_PG_DSN"]
ROOMS = lane_schema.Rooms(DSN, "shift-transfer")
SCHEMA = ROOMS.name()
OUT = {}
BM, JH, MK = "CAN - BM - BM4060", "CAN - JH - ABD2704", "CAN - MK - MK11787"
SW = "CAN - SW - SW9090"
today = datetime.now(sr.OHIO).date()
PAST = (today - timedelta(days=1)).isoformat()
TODAY = today.isoformat()
D1 = (today + timedelta(days=1)).isoformat()
D2 = (today + timedelta(days=2)).isoformat()
D3 = (today + timedelta(days=3)).isoformat()
ISOS = [PAST, TODAY, D1, D2, D3]
ADMIT = lambda name: True

MANAGERS = {"readable": True, "why": "", "by_code": {
    "BM4060": {"name": "Hana Boss", "names": ["Hana Boss"], "phone": "3305550101", "house": BM},
    "ABD2704": {"name": "Rita Lead", "names": ["Rita Lead"], "phone": "", "house": JH},
    "SW9090": {"name": "Sam Boss", "names": ["Sam Boss"], "phone": "3305550103", "house": SW},
}}
sr.house_managers = lambda dsn, **k: MANAGERS
# The directors come from the Time Off house's settings; here they are stood in.
DIRECTORS = ["Dee Direct", "Val Vice"]
sh.directors_for = lambda dsn: {"readable": True, "names": list(DIRECTORS),
                                "why": "the director Dee Direct or Val Vice approves"}
# the People house, stood in: the door is handed its spelling of a director
sh._people_rows = lambda: [{"name": "Dee Direct"}, {"name": "Val Vice"}]
hd.read = lambda dsn, now=None: {
    "BM4060": {"code": "BM4060", "label": "BM", "name": "BM home", "address": "", "region": ""},
    "ABD2704": {"code": "ABD2704", "label": "JH", "name": "JH home", "address": "", "region": ""},
    "MK11787": {"code": "MK11787", "label": "MK", "name": "MK home", "address": "", "region": ""},
    "SW9090": {"code": "SW9090", "label": "SW", "name": "SW home", "address": "", "region": ""}}
# the IST settings as a read that landed, holding the shipped values
import ist_config
ist_config.pin(dict(ist_config.SHIPPED))
EVERY = {"done": 1, "owed": 0, "clients": [], "owed_for": []}
TRAINED = ("Ann Roe", "Ben Left", "Cy Far", "Dee Busy", "Eve Cell", "Hana Boss", "Rita Lead",
           "Kim Give", "Mo Staff", "Pat Nophone", "Lou Late", "Gia Give", "Tak Er", "Sam Boss")
IST = {"readable": True, "why": "", "rows": 0, "source": "test",
       "by_person": {sr.fold(n): {c: dict(EVERY)
                                  for c in ("BM4060", "ABD2704", "MK11787", "SW9090")}
                     for n in TRAINED}}
sr.ist_index = lambda dsn, **k: IST
sr.call_off_shifts = lambda dsn, **k: []
# the quiet window is stood in (a night run would owe nothing); it is checked for real below
REAL_QUIET = pr.quiet
pr.quiet = lambda at: False
REACHABLE = {sr.fold(n) for n in TRAINED + ("Zoe New", "Yan First") if n != "Pat Nophone"}


def grid(rows):
    return {"cols": [{"iso": i} for i in ISOS],
            "rows": [{"employee": e, "cells": [{"text": t} for t in cs]} for e, cs in rows]}


GRIDS = {
    #            PAST      TODAY     D1        D2        D3
    BM: grid([("OPEN", ["", "", "", "9A-1P", ""]),
              ("Hana Boss", ["", "", "", "", "8A-2P"]),
              ("Ann Roe", ["", "12A-8A", "8A-4P", "9A-5P", "10A-6P"]),
              ("Ben Left", ["8A-4P", "", "", "", ""]),
              ("Eve Cell", ["", "", "5P-11P", "", ""]),
              ("Lou Late", ["", "", "", "", "9A-5P"]),
              ("FAMILY", ["", "", "8A-4P", "", ""]),
              ("Nurse", ["", "", "", "9A-1P", ""]),
              ("Solo", ["8A-4P", "", "", "", ""]),
              ("Pat Nophone", ["8A-4P", "", "", "", ""])]),
    JH: grid([("Rita Lead", ["", "", "", "8A-8P", "7A-7P"]),
              ("Kim Give", ["", "", "", "9A-5P", "10A-2P"]),
              ("Dee Busy", ["", "", "9A-5P", "", ""]),
              ("Cy Far", ["8A-4P", "", "", "", ""]),
              ("Zoe New", ["8A-4P", "", "", "", ""]),
              ("Yan First", ["8A-4P", "", "", "", ""])]),
    MK: grid([("Mo Staff", ["", "", "", "9A-5P", ""]),
              ("Ann Roe", ["", "", "", "", "8A-12P"])]),
    SW: grid([("Sam Boss", ["", "", "", "", ""]),
              ("Gia Give", ["", "", "8A-4P", "9A-5P", ""]),
              ("Tak Er", ["", "", "", "", ""])]),
}

ROOMS.make()
T = ROOMS.path(SCHEMA)


def rows(sql, args=()):
    with psycopg2.connect(T) as c, c.cursor() as cur:
        cur.execute(sql, args)
        return [list(r) for r in cur.fetchall()]


def run(sql, args=()):
    with psycopg2.connect(T) as c, c.cursor() as cur:
        cur.execute(sql, args)
        c.commit()


def refused(fn):
    try:
        return ["allowed", fn()]
    except (sh.Refused, sr.Refused) as exc:
        return ["refused", exc.code, exc.why]
    except hcl.WorkbookRefused as exc:
        return ["workbook", exc.code, exc.why]
    except (ValueError, LookupError) as exc:
        return ["value", str(exc)]


def viewer(name, types="STAFF"):
    return sr.viewer(T, name=name, role="staff", types=types)


def offers():
    return rows("SELECT count(*) FROM asa_shift_handoffs")[0][0]


def trainings(person=None, state=None):
    q = "SELECT id, state, ref, extra->'trainer'->>'name' FROM asa_shift_requests WHERE kind=%s"
    args = [sr.KIND_IST]
    if person:
        q += " AND person=%s"
        args.append(person)
    if state:
        q += " AND state=%s"
        args.append(state)
    return rows(q + " ORDER BY created_at", tuple(args))


def owed_kinds(hid):
    return sorted([r["kind"], r["person"]] for r in sh.owed(T, limit=200)
                  if r["handoff_id"] == hid)


def dir_yes(hid, by="Dee Direct", via="app"):
    """The third consent. Every swap below needs it before the shift can move."""
    return sh.answer(T, hid, side="director", word="yes", by=by, via=via)


def said_answer(hid, kind, state, dial="send", phone_key=""):
    res = {"id": f"{hid}:{kind}", "state": state, "why": f"door said {state}"}
    if phone_key:
        res["phone_key"] = phone_key
    return sh.mark_said(T, [f"{hid}:{kind}"], {"dial": dial, "results": [res]})


try:
    with psycopg2.connect(T) as c, c.cursor() as cur:
        cur.execute("CREATE TABLE asa_house_calendar_live (location TEXT PRIMARY KEY, "
                    "grid JSONB, updated_at TIMESTAMPTZ DEFAULT now() - interval '1 minute')")
        cur.execute(hcl.CLAIMS_DDL)
        cur.execute(sh.HANDOFFS_DDL)
        cur.execute(sh.OPEN_INDEX_DDL)
        for stmt in sr.DDL:
            cur.execute(stmt)
        for loc, g in GRIDS.items():
            cur.execute("INSERT INTO asa_house_calendar_live (location, grid) VALUES (%s,%s)",
                        (loc, psycopg2.extras.Json(g)))
        c.commit()
    # every table the code reads is the lane's before its first read
    OUT["owned"] = lane_schema.own_shift_lane(T, SCHEMA, LANE_DIR)

    # the retired house-day index goes beside the table this connection writes, and nowhere else on
    # its search path (read only, for the schema that is not the lane's)
    def _retired_where():
        with psycopg2.connect(T) as c, c.cursor() as cur:
            cur.execute("SELECT to_regclass(%s) IS NOT NULL, to_regclass(%s) IS NOT NULL",
                        (SCHEMA + ".asa_shift_handoffs_open", "public.asa_shift_handoffs_open"))
            return list(cur.fetchone())
    with psycopg2.connect(T) as c, c.cursor() as cur:
        cur.execute("CREATE INDEX asa_shift_handoffs_open ON asa_shift_handoffs (location)")
        c.commit()
    retired_before = _retired_where()
    sh._TABLES_READY.discard(T)
    sh.ensure_tables(T)
    OUT["retired_index"] = [retired_before, _retired_where()]
    book = cbh.MemoryWorkbook.from_grids(GRIDS)
    cbh.use_workbook(book)
    sr.forget_estate()

    # ── A. THE NAMES THE TRANSFER BUTTON SHOWS ──────────────────────────────
    got = sh.candidates(T, location=BM, col_iso=D1, giver="Ann Roe", reachable=REACHABLE)
    by = {c["name"]: c for c in got["candidates"]}
    OUT["cand_names"] = sorted(by)
    OUT["cand_order"] = [c["name"] for c in got["candidates"]]
    OUT["cand_approval"] = [got["approval"]["mode"], got["approval"]["names"], got["value"]]
    OUT["cand_ben"] = [by.get("Ben Left", {}).get(k) for k in ("ok", "regular", "here")]
    OUT["cand_cy"] = [by.get("Cy Far", {}).get(k) for k in ("ok", "here", "houses")]
    OUT["cand_dee"] = [by.get("Dee Busy", {}).get("ok"), by.get("Dee Busy", {}).get("code"),
                       by.get("Dee Busy", {}).get("why")]
    OUT["cand_eve"] = [by.get("Eve Cell", {}).get("ok"), by.get("Eve Cell", {}).get("code")]
    OUT["cand_pat"] = [by.get("Pat Nophone", {}).get("ok"), by.get("Pat Nophone", {}).get("code")]
    OUT["cand_zoe"] = [by.get("Zoe New", {}).get("ok"), by.get("Zoe New", {}).get("needs_training"),
                       (by.get("Zoe New", {}).get("training") or {}).get("trains")]
    OUT["cand_started"] = refused(lambda: sh.candidates(T, location=BM, col_iso=TODAY,
                                                        giver="Ann Roe"))
    # a staff picker (detail=False) never says why a coworker cannot
    staff_view = sh.candidates(T, location=BM, col_iso=D1, giver="Ann Roe", reachable=REACHABLE,
                               detail=False)
    sby = {c["name"]: c for c in staff_view["candidates"]}
    OUT["cand_staff"] = [sby["Dee Busy"]["code"], sby["Dee Busy"]["why"], sby["Dee Busy"]["ist"],
                         sby["Dee Busy"]["reachable"], sby["Pat Nophone"]["code"],
                         (sby["Zoe New"].get("training") or {}).get("busy"),
                         sby["Zoe New"]["needs_training"]]
    # the giver resolves to the grid's spelling
    OUT["cand_spelling"] = refused(lambda: sh.candidates(T, location=BM, col_iso=D1,
                                                         giver="ANN  ROE", reachable=REACHABLE)["giver"])
    blind = sh.candidates(T, location=BM, col_iso=D1, giver="Ann Roe", reachable=None,
                          reachable_why="the roster is down")
    OUT["cand_blind"] = [blind["reachable_known"], blind["reachable_why"],
                         next((c["ok"] for c in blind["candidates"] if c["name"] == "Pat Nophone"),
                              None)]

    # ── B. EVERY REFUSAL LEAVES NOTHING BEHIND ──────────────────────────────
    OUT["ref_open"] = refused(lambda: sh.offer(T, location=BM, col_iso=D2, from_staff="OPEN",
                                               to_staff="Ben Left"))
    OUT["ref_family"] = refused(lambda: sh.offer(T, location=BM, col_iso=D1, from_staff="Ann Roe",
                                                 to_staff="FAMILY", reachable=REACHABLE))
    OUT["ref_open_receiver"] = refused(lambda: sh.offer(T, location=BM, col_iso=D1,
                                                        from_staff="Ann Roe", to_staff="OPEN"))
    OUT["ref_nobody"] = refused(lambda: sh.offer(T, location=BM, col_iso=D1, from_staff="Ann Roe",
                                                 to_staff="Nobody Here"))
    OUT["ref_cell"] = refused(lambda: sh.offer(T, location=BM, col_iso=D1, from_staff="Ann Roe",
                                               to_staff="Eve Cell"))
    OUT["ref_overlap"] = refused(lambda: sh.offer(T, location=BM, col_iso=D1, from_staff="Ann Roe",
                                                  to_staff="Dee Busy"))
    OUT["ref_started"] = refused(lambda: sh.offer(T, location=BM, col_iso=TODAY,
                                                  from_staff="Ann Roe", to_staff="Ben Left"))
    OUT["ref_nophone"] = refused(lambda: sh.offer(T, location=BM, col_iso=D1, from_staff="Ann Roe",
                                                  to_staff="Pat Nophone", reachable=REACHABLE))
    held = sr.house_managers
    sr.house_managers = lambda dsn, **k: {"readable": False, "why": "the mirror is down",
                                          "by_code": {}}
    OUT["ref_managers"] = refused(lambda: sh.offer(T, location=BM, col_iso=D1, from_staff="Ann Roe",
                                                   to_staff="Ben Left"))
    sr.house_managers = held
    OUT["ref_nothing_left"] = [offers(), len(trainings())]

    # ── C. THE OFFER: the approver resolved and written on it ──────────────
    o1 = sh.offer(T, location=BM, col_iso=D1, from_staff="Ann Roe", to_staff="ben left",
                  offered_by="Ann Roe", reachable=REACHABLE)
    H1 = o1["id"]
    dir_yes(H1)
    OUT["o1"] = [o1["state"], o1["to_staff"], o1["house_manager"], o1["approval"],
                 o1["approvers"], o1["manager_phone"], o1["offered_by"], bool(o1["shift_start"]),
                 o1["training_request"]]
    OUT["o1_again"] = refused(lambda: sh.offer(T, location=BM, col_iso=D1, from_staff="Ann Roe",
                                               to_staff="Cy Far"))
    OUT["o1_cands_again"] = refused(lambda: sh.candidates(T, location=BM, col_iso=D1,
                                                          giver="Ann Roe"))
    OUT["o1_owed"] = owed_kinds(H1)
    ask = next(r for r in sh.owed(T) if r["id"] == f"{H1}:handoff_ask_manager")
    OUT["o1_ask_row"] = [ask["house"], bool(ask["house_name"]), ask["day"], ask["shift_at"][:10],
                         ask["shift_code"], ask["taker"], ask["person"], ask["manager_phone"]]
    # the consents are the right people's
    OUT["c_giver_approves"] = refused(lambda: sh.answer(T, H1, side="manager", word="yes",
                                                        by="Ann Roe"))
    OUT["c_receiver_approves"] = refused(lambda: sh.answer(T, H1, side="manager", word="yes",
                                                           by="Ben Left"))
    OUT["c_hm_accepts"] = refused(lambda: sh.answer(T, H1, side="staff", word="yes",
                                                    by="Hana Boss"))
    row1 = sh.handoff(T, H1)
    OUT["c_sides"] = [sh.side_for(viewer("Ben Left"), row1),
                      sh.side_for(viewer("Hana Boss", "HM"), row1),
                      sh.side_for(viewer("Dan Director", "DIRECTOR"), row1),
                      sh.side_for(viewer("Ann Roe"), row1), sh.side_for(viewer("Cy Far"), row1)]

    # ── D. THE ASK LEDGER: only a real outcome closes an ask ───────────────
    sh.note_dial("record")
    OUT["d_blank_post"] = sh.mark_said(T, [f"{H1}:handoff_ask_staff"], {"dial": "record",
                                                                         "results": []})
    OUT["d_quiet_post"] = said_answer(H1, "handoff_ask_staff", "refused_quiet")
    OUT["d_after_nothing"] = owed_kinds(H1)
    said_answer(H1, "handoff_ask_staff", "recorded", dial="record")
    said_answer(H1, "handoff_ask_manager", "no_manager", dial="record")
    OUT["d_after_recorded"] = owed_kinds(H1)
    run("UPDATE asa_shift_handoffs SET said = jsonb_set(said, '{handoff_ask_manager,at}', "
        "to_jsonb((now() - interval '2 hours')::text)) WHERE id=%s", (H1,))
    OUT["d_retry_later"] = owed_kinds(H1)
    sh.note_dial("send")
    OUT["d_dial_moved"] = owed_kinds(H1)
    said_answer(H1, "handoff_ask_staff", "told", phone_key="phonekeyben")
    said_answer(H1, "handoff_ask_manager", "told")
    OUT["d_after_told"] = owed_kinds(H1)
    OUT["d_ledger"] = sh.handoff(T, H1)["said"]["handoff_ask_staff"]
    # the REAL quiet window: at 23:00 in Ohio nothing is offered, whatever is owed
    pr.quiet = REAL_QUIET
    late = datetime(today.year, today.month, today.day, 23, 0, tzinfo=sr.OHIO)
    run("UPDATE asa_shift_handoffs SET said = said - 'handoff_ask_staff' WHERE id=%s", (H1,))
    OUT["d_quiet_window"] = [len(sh.owed(T, now=late)),
                             len(sh.owed(T, now=late.replace(hour=12)))]
    run("UPDATE asa_shift_handoffs SET said = jsonb_set(said, '{handoff_ask_staff}', %s::jsonb) "
        "WHERE id=%s", (json.dumps(OUT["d_ledger"]), H1))
    pr.quiet = lambda at: False

    # the shift flow leaves Ben's YES alone while the swap waits on him
    t_told = datetime.fromisoformat(OUT["d_ledger"]["at"])
    OUT["p_claimed"] = sorted(str(w) == str(t_told + timedelta(minutes=1)) for _k, w in
                              sh.claimed_replies(T, [("phonekeyben", t_told + timedelta(minutes=1)),
                                                     ("phonekeyben", t_told - timedelta(minutes=1)),
                                                     ("otherphone", t_told + timedelta(minutes=1))]))
    # a YES after the flow's newer ask is the flow's
    when = t_told + timedelta(minutes=2)
    OUT["p_recency"] = [
        len(sh.claimed_replies(T, [("phonekeyben", when, t_told + timedelta(minutes=1))])),
        len(sh.claimed_replies(T, [("phonekeyben", when, t_told - timedelta(minutes=1))])),
        len(sh.claimed_replies(T, [("phonekeyben", when, t_told)]))]
    # match_reply: by the ref, by the name, never the giver
    OUT["m_ref_receiver"] = (sh.match_reply(T, text=f"YES {H1}", name="Ben Left") or {}).get("side")
    OUT["m_ref_hm"] = (sh.match_reply(T, text=f"approve {H1}", name="Hana Boss") or {}).get("side")
    OUT["m_ref_giver"] = sh.match_reply(T, text=f"yes {H1}", name="Ann Roe")
    OUT["m_bare_receiver"] = (sh.match_reply(T, text="yes", name="Ben Left") or {}).get("id") == H1

    # ── E. BOTH SAY YES: the shift moves, and every reader follows ─────────
    first = sh.answer(T, H1, side="manager", word="yes", by="Hana Boss")
    OUT["e_first"] = [first["state"], first["manager_state"], first["manager_by"], first["changed"]]
    OUT["e_twice"] = sh.answer(T, H1, side="manager", word="yes", by="Hana Boss")["changed"]
    done = sh.answer(T, H1, side="staff", word="yes", by="Ben Left")
    OUT["e_done"] = [done["state"], done["staff_by"], book.cell(BM, "Ben Left", D1),
                     book.cell(BM, "Ann Roe", D1)]
    view = sr.estate(T)
    OUT["e_estate"] = [view["cells"][BM].get(("Ben Left", D1), ""),
                       view["cells"][BM].get(("Ann Roe", D1), "")]
    OUT["e_ben_holds"] = sorted(h["source"] for h in sr.held_by(T, "Ben Left")
                                if h["col_iso"] == D1)
    OUT["e_owed"] = owed_kinds(H1)
    OUT["p_after_answer"] = len(sh.claimed_replies(T, [("phonekeyben",
                                                        datetime.now(timezone.utc)
                                                        + timedelta(minutes=5))]))

    # ── F. THE HOUSE MANAGER GIVING THEIR OWN SHIFT: approved above ────────
    f = sh.offer(T, location=BM, col_iso=D3, from_staff="Hana Boss", to_staff="Cy Far")
    OUT["f_offer"] = [f["approval"], f["house_manager"], f["approvers"], "part of this swap" in
                      f["approval_why"]]
    OUT["f_owed"] = owed_kinds(f["id"])
    frow = sh.handoff(T, f["id"])
    OUT["f_may"] = [sh.may_approve(viewer("Hana Boss", "HM"), frow),
                    sh.may_approve(viewer("Dan Director", "DIRECTOR"), frow)]
    OUT["f_hm_approves"] = refused(lambda: sh.answer(T, f["id"], side="manager", word="yes",
                                                     by="Hana Boss"))
    OUT["f_waiting_director"] = [h["id"] == f["id"] for h in
                                 sh.waiting_on(T, "Dan Director", above=True)]
    OUT["f_waiting_staff"] = len(sh.waiting_on(T, "Dan Director", above=False))
    OUT["f_match_director"] = (sh.match_reply(T, text=f"APPROVE {f['id']}", name="Dan Director",
                                              who=lambda: viewer("Dan Director", "DIRECTOR"))
                               or {}).get("side")
    # …and Cy has no row at BM: the writer gives them one when it completes
    dir_yes(f["id"])
    sh.answer(T, f["id"], side="manager", word="yes", by="Dan Director")
    fd = sh.answer(T, f["id"], side="staff", word="yes", by="Cy Far")
    OUT["f_done"] = [fd["state"], book.cell(BM, "Cy Far", D3), book.cell(BM, "Hana Boss", D3)]

    # ── G. NO MANAGER ON FILE (MK) ─────────────────────────────────────────
    g = sh.offer(T, location=MK, col_iso=D2, from_staff="Mo Staff", to_staff="Lou Late")
    OUT["g_offer"] = [g["approval"], g["approval_why"]]
    sh.withdraw(T, g["id"], by="Mo Staff")

    # ── H. A FIRST SHIFT THERE: the offer carries the house manager's training ─
    h = sh.offer(T, location=JH, col_iso=D2, from_staff="Kim Give", to_staff="Zoe New")
    OUT["h_offer"] = [h["state"], bool(h["training_request"]), trainings("Zoe New")[0][1:3]
                      if trainings("Zoe New") else None,
                      (h["training"] if isinstance(h["training"], dict)
                       else json.loads(h["training"])).get("needed")]
    dir_yes(h["id"])
    OUT["h_busy"] = refused(lambda: sh.answer(T, h["id"], side="manager", word="yes",
                                              by="Rita Lead"))
    OUT["h_busy_nothing"] = [sh.handoff(T, h["id"])["manager_state"],
                             [x[1] for x in trainings("Zoe New")]]
    cbh.stage_cell(T, location=JH, employee="Rita Lead", col_iso=D2, value="", actor="Rita Lead")
    cbh.publish_house(T, location=JH, actor="Rita Lead")
    hok = sh.answer(T, h["id"], side="manager", word="yes", by="Rita Lead")
    OUT["h_free"] = [hok["manager_state"], [x[1:] for x in trainings("Zoe New")]]
    hd = sh.answer(T, h["id"], side="staff", word="yes", by="Zoe New")
    OUT["h_done"] = [hd["state"], book.cell(JH, "Zoe New", D2), book.cell(JH, "Kim Give", D2),
                     len(trainings("Zoe New"))]

    # ── H2. THE REQUESTS TRAINING DOOR releases the swap / ends it ────────
    h2 = sh.offer(T, location=JH, col_iso=D3, from_staff="Kim Give", to_staff="Zoe New")
    rid2 = h2["training_request"]
    dir_yes(h2["id"])
    cbh.stage_cell(T, location=JH, employee="Rita Lead", col_iso=D3, value="", actor="Rita Lead")
    cbh.publish_house(T, location=JH, actor="Rita Lead")
    sr.approve_training(T, request_id_=rid2, by="Rita Lead")
    rel = sh.training_answered(T, rid2, who=viewer("Rita Lead", "HM"), word="yes")
    OUT["h2_released"] = [rel["manager_state"], rel["manager_by"], rel["state"]]
    ok2 = sh.answer(T, h2["id"], side="staff", word="yes", by="Zoe New")
    OUT["h2_done"] = [ok2["state"], book.cell(JH, "Zoe New", D3)]

    # ── I. WITHDRAW: the cell and the receiver released, the training closed ─
    w = sh.offer(T, location=BM, col_iso=D2, from_staff="Ann Roe", to_staff="Yan First")
    OUT["w_training"] = [x[1] for x in trainings("Yan First", sr.NEEDS_TRAINING)]
    wd = sh.withdraw(T, w["id"], by="Ann Roe")
    OUT["w_done"] = [wd["state"], wd["closed_by"], wd["why"]]
    OUT["w_training_after"] = [x[1] for x in trainings("Yan First")
                               if x[0] == w["training_request"]]
    OUT["w_owed"] = owed_kinds(w["id"])
    OUT["w_again"] = refused(lambda: sh.withdraw(T, w["id"], by="Ann Roe"))
    OUT["w_zoe_free"] = [x["source"] for x in sr.held_by(T, "Yan First") if x["col_iso"] == D2
                         and x["location"] == BM]

    # ── J. EXPIRY AT THE SHIFT'S START, AND A CALL-OFF ─────────────────────
    j = sh.offer(T, location=BM, col_iso=D2, from_staff="Ann Roe", to_staff="Ben Left")
    run("UPDATE asa_shift_handoffs SET shift_start = now() - interval '1 minute' WHERE id=%s",
        (j["id"],))
    fin = sh.complete_ready(T)
    jr = sh.handoff(T, j["id"])
    OUT["j_expired"] = [fin["expired"], jr["state"], "began before all three answered" in jr["why"]]
    j2 = sh.offer(T, location=BM, col_iso=D2, from_staff="Ann Roe", to_staff="Ben Left")
    run("INSERT INTO asa_shift_pool (location, open_row, col_iso, kind, value) "
        "VALUES (%s,%s,%s,%s,%s)", (BM, "Ann Roe", D2, sr.KIND_CALLOFF, "9A-5P"))
    fin2 = sh.complete_ready(T)
    j2r = sh.handoff(T, j2["id"])
    OUT["j_called_off"] = [fin2["called_off"], j2r["state"], "called off" in j2r["why"]]
    OUT["j_offer_called_off"] = refused(lambda: sh.offer(T, location=BM, col_iso=D2,
                                                         from_staff="Ann Roe", to_staff="Ben Left"))
    run("DELETE FROM asa_shift_pool WHERE location=%s AND open_row=%s", (BM, "Ann Roe"))

    # ── K. A RULE THAT COULD NOT BE ASKED PAUSES AN AGREED SWAP ────────────
    k = sh.offer(T, location=BM, col_iso=D3, from_staff="Ann Roe", to_staff="Kim Give")
    dir_yes(k["id"])
    sh.answer(T, k["id"], side="manager", word="yes", by="Hana Boss")
    sr.ist_index = lambda dsn, **kw: {"readable": False, "why": "the book is down", "by_person": {},
                                      "rows": 0, "source": ""}
    kp = sh.answer(T, k["id"], side="staff", word="yes", by="Kim Give")
    OUT["k_paused"] = [kp["state"], "could not be read" in kp["why"], book.cell(BM, "Ann Roe", D3),
                       len(trainings("Kim Give"))]
    OUT["k_still_paused"] = sh.complete_ready(T)["waiting"]
    OUT["k_one_training"] = len(trainings("Kim Give"))
    sr.ist_index = lambda dsn, **kw: IST
    fin3 = sh.complete_ready(T)
    OUT["k_done"] = [fin3["done"], sh.handoff(T, k["id"])["state"], book.cell(BM, "Kim Give", D3)]
    OUT["k_training_closed"] = [t[1] if len(t) > 1 else t for t in trainings("Kim Give")]

    # ── L. THE RECEIVER'S OWN CELL IS NEVER WRITTEN OVER ──────────────────
    lo = sh.offer(T, location=BM, col_iso=D3, from_staff="Lou Late", to_staff="Eve Cell")
    dir_yes(lo["id"])
    cbh.stage_cell(T, location=BM, employee="Eve Cell", col_iso=D3, value="6P-10P",
                   actor="Hana Boss")
    cbh.publish_house(T, location=BM, actor="Hana Boss")
    sh.answer(T, lo["id"], side="manager", word="yes", by="Hana Boss")
    ld = sh.answer(T, lo["id"], side="staff", word="yes", by="Eve Cell")
    OUT["l_dead"] = [ld["state"], "nothing was written over it" in ld["why"],
                     book.cell(BM, "Eve Cell", D3), book.cell(BM, "Lou Late", D3)]

    # ── M. WHAT THE SCREENS ARE TOLD ───────────────────────────────────────
    m = sh.offer(T, location=BM, col_iso=D2, from_staff="Ann Roe", to_staff="Ben Left")
    hana, ben, ann, cy = (viewer("Hana Boss", "HM"), viewer("Ben Left"), viewer("Ann Roe"),
                          viewer("Cy Far"))
    b_h, b_b, b_a = sh.board(T, hana), sh.board(T, ben), sh.board(T, ann)
    OUT["m_board"] = [[x["id"] == m["id"] and x["may_approve"] for x in b_h["waiting_on_me"]],
                      [x["id"] == m["id"] and x["may_accept"] for x in b_b["waiting_on_me"]],
                      [x["id"] == m["id"] and x["may_withdraw"] for x in b_a["mine"]]]
    OUT["m_house"] = [len(sh.for_house(T, BM, hana)), len(sh.for_house(T, BM, cy))]
    mine = sh.my_shifts(T, ann)
    OUT["m_my_shifts"] = sorted([s["col_iso"], s["may_transfer"], bool(s["offer"])] for s in mine)
    f_ben = sr.feed(T, who=ben)
    swaps = [r for r in f_ben["rows"] if r["kind"] == "swap"]
    OUT["m_feed_ben"] = [len(swaps), all(r["mine"] for r in swaps),
                         any(r["id"] == m["id"] and r["may_accept"] for r in swaps)]
    f_cy = sr.feed(T, who=cy)
    OUT["m_feed_cy"] = [r["id"] for r in f_cy["rows"] if r["kind"] == "swap" and r["state"] == "pending"]
    f_hana = sr.feed(T, who=hana)
    OUT["m_feed_hana"] = any(r["id"] == m["id"] and r["may_approve"] for r in f_hana["rows"])
    OUT["m_feed_my_shifts"] = [len(f_ben["my_shifts"]), f_ben["my_shifts_why"],
                               len(sr.feed(T, who=ann)["my_shifts"]) > 0]
    sh.withdraw(T, m["id"], by="Hana Boss")
    OUT["m_withdrawn_by_hm"] = sh.handoff(T, m["id"])["closed_by"]

    # ── N. THE HOUSE MANAGER WHO STARTS A TRANSFER DOES NOT APPROVE IT ─────
    n = sh.offer(T, location=BM, col_iso=D2, from_staff="Ann Roe", to_staff="Ben Left",
                 offered_by="Hana Boss")
    nrow = sh.handoff(T, n["id"])
    OUT["n_offer"] = [n["approval"], n["house_manager"], "started this transfer" in n["approval_why"]]
    OUT["n_may"] = [sh.may_approve(viewer("Hana Boss", "HM"), nrow),
                    sh.may_approve(viewer("Dan Director", "DIRECTOR"), nrow)]
    OUT["n_self_approve"] = refused(lambda: sh.answer(T, n["id"], side="manager", word="yes",
                                                      by="Hana Boss"))
    OUT["n_owed"] = owed_kinds(n["id"])
    sh.withdraw(T, n["id"], by="Hana Boss")

    # O. a house manager handing their own shift to a first-timer trains it (the trainer's skip)
    cbh.stage_cell(T, location=JH, employee="Rita Lead", col_iso=D1, value="9A-5P",
                   actor="Rita Lead")
    cbh.publish_house(T, location=JH, actor="Rita Lead")
    sr.forget_estate()
    o = sh.offer(T, location=JH, col_iso=D1, from_staff="Rita Lead", to_staff="Yan First")
    otr = (o["training"] if isinstance(o["training"], dict) else json.loads(o["training"]))
    OUT["o_offer"] = [o["approval"], bool(o["training_request"]),
                      (otr.get("trainer") or {}).get("may_approve"),
                      (otr.get("trainer") or {}).get("trains")]
    dir_yes(o["id"])
    oa = refused(lambda: sh.answer(T, o["id"], side="manager", word="yes", by="Dan Director"))
    OUT["o_approved"] = [oa[0], (oa[1] or {}).get("manager_state") if oa[0] == "allowed" else oa]
    od = sh.answer(T, o["id"], side="staff", word="yes", by="Yan First")
    OUT["o_done"] = [od["state"], book.cell(JH, "Yan First", D1), book.cell(JH, "Rita Lead", D1),
                     [x[1:] for x in trainings("Yan First") if x[0] == o["training_request"]]]

    # ── P. WHO MAY OPEN A SWAP ─────────────────────────────────────────────
    OUT["p_open"] = [sh.may_open(T, viewer("Gia Give"), location=SW, giver="Gia Give"),
                     sh.may_open(T, viewer("Tak Er"), location=SW, giver="Gia Give"),
                     sh.may_open(T, viewer("Sam Boss", "HM"), location=SW, giver="Gia Give"),
                     sh.may_open(T, viewer("Hana Boss", "HM"), location=SW, giver="Gia Give"),
                     sh.may_open(T, sr.viewer(T, name="Moe Manager", role="manager"),
                                 location=SW, giver="Gia Give")]
    # a badge that decides every house still opens only its own shift, or its own house's
    OUT["p_badges"] = [sh.may_open(T, viewer("Dan Director", "DIRECTOR"), location=SW,
                                   giver="Gia Give"),
                       sh.may_open(T, viewer("Tia Lead", "TEAM LEAD"), location=SW,
                                   giver="Gia Give"),
                       sh.may_open(T, viewer("Ada Admin", "ADMINISTRATOR"), location=SW,
                                   giver="Gia Give"),
                       viewer("Dan Director", "DIRECTOR")["decides_everywhere"]]
    OUT["p_badge_feed"] = (lambda f: [[h["location"] for h in f["houses"]], f["house_shifts"]]
                           )(sh.swaps_feed(T, viewer("Dan Director", "DIRECTOR")))

    # ── Q. THE DIRECTOR IS A THIRD CONSENT, AND IT BLOCKS ──────────────────
    held_dirs = sh.directors_for
    sh.directors_for = lambda dsn: {"readable": False, "names": [],
                                    "why": "the Time Off house could not be read"}
    OUT["q_no_directors"] = refused(lambda: sh.offer(T, location=SW, col_iso=D2,
                                                     from_staff="Gia Give", to_staff="Tak Er"))
    sh.directors_for = held_dirs
    OUT["q_nothing_left"] = rows("SELECT count(*) FROM asa_shift_handoffs WHERE location=%s",
                                 (SW,))[0][0]

    def _dirs(h):
        got = (h or {}).get("directors")
        return got if isinstance(got, list) else json.loads(got or "[]")

    # a blank cell is read and names nobody: the swap opens as time off is filed — the receiver and
    # the house manager asked now, the director's approval waiting on the row until a name is saved
    sh.directors_for = lambda dsn: {"readable": True, "names": [],
                                    "why": "the Time Off house's settings name no director"}
    try:
        qb = sh.offer(T, location=SW, col_iso=D2, from_staff="Gia Give", to_staff="Tak Er")
        QB = qb["id"]
        OUT["q_blank_offer"] = [qb["state"], _dirs(qb), qb["director_state"], qb["why"]]
        OUT["q_blank_owed"] = owed_kinds(QB)
        sh.answer(T, QB, side="manager", word="yes", by="Sam Boss")
        sh.answer(T, QB, side="staff", word="yes", by="Tak Er")
        OUT["q_blank_dir"] = refused(lambda: sh.answer(T, QB, side="director", word="yes",
                                                       by="Dee Direct"))
        OUT["q_blank_beat"] = sh.adopt_directors(T)["adopted"]
        qbrow = sh.handoff(T, QB) or {}
        OUT["q_blank_held"] = [qbrow.get("state"), _dirs(qbrow), book.cell(SW, "Tak Er", D2),
                               book.cell(SW, "Gia Give", D2), qbrow.get("why"),
                               sh.describe(qbrow, viewer("Dee Direct"))["may_approve_director"]]
    finally:
        sh.directors_for = held_dirs
    # the list names somebody again: the next beat gives the swap its board, the waiting sentence
    # goes, and the directors are asked
    OUT["q_blank_adopted"] = sh.adopt_directors(T)["adopted"]
    qbrow = sh.handoff(T, QB) or {}
    OUT["q_blank_named"] = [_dirs(qbrow), qbrow.get("why"),
                            [k for k in owed_kinds(QB) if k[0] == "handoff_ask_director"]]
    sh.withdraw(T, QB, by="Gia Give")

    # a list that names only somebody who may not be asked writes that on the row; once another name
    # is saved and the swap is given its board, that sentence goes too
    sh.directors_for = lambda dsn: {"readable": True, "names": [],
                                    "why": "the Time Off house's settings name no director"}
    try:
        qs = sh.offer(T, location=SW, col_iso=D2, from_staff="Gia Give", to_staff="Tak Er")
    finally:
        sh.directors_for = held_dirs
    QS = qs["id"]
    only_hm = {"readable": True, "names": ["Sam Boss"], "why": "the director Sam Boss approves"}
    OUT["q_stuck_hm"] = [sh.adopt_directors(T, board=only_hm), (sh.handoff(T, QS) or {}).get("why")]
    sh.answer(T, QS, side="manager", word="yes", by="Sam Boss")
    OUT["q_stuck_gave"] = [sh.adopt_directors(T, board=only_hm), (sh.handoff(T, QS) or {}).get("why")]
    OUT["q_stuck_named"] = sh.adopt_directors(T, board={"readable": True, "names": ["Sam Boss", "Dee Direct"],
                                                        "why": "the director Sam Boss or Dee Direct approves"})
    qsrow = sh.handoff(T, QS) or {}
    OUT["q_stuck_row"] = [_dirs(qsrow), qsrow.get("why"), qsrow.get("state")]
    sh.withdraw(T, QS, by="Gia Give")

    q = sh.offer(T, location=SW, col_iso=D1, from_staff="Gia Give", to_staff="Tak Er")
    Q = q["id"]
    OUT["q_offer"] = [q["directors"] if isinstance(q["directors"], list)
                      else json.loads(q["directors"]), q["director_state"]]
    OUT["q_owed"] = owed_kinds(Q)
    # a director is not the house manager: that seat is the one the row named
    OUT["q_dir_not_hm"] = refused(lambda: sh.answer(T, Q, side="manager", word="yes",
                                                    by="Dee Direct"))
    sh.answer(T, Q, side="manager", word="yes", by="Sam Boss", via="app")
    qa = sh.answer(T, Q, side="staff", word="yes", by="Tak Er", via="sms")
    OUT["q_blocked"] = [qa["state"], book.cell(SW, "Tak Er", D1), book.cell(SW, "Gia Give", D1)]
    OUT["q_beat"] = sh.complete_ready(T)["looked_at"]
    OUT["q_in_swap"] = refused(lambda: sh.answer(T, Q, side="director", word="yes",
                                                 by="Gia Give"))
    OUT["q_not_listed"] = refused(lambda: sh.answer(T, Q, side="director", word="yes",
                                                    by="Sam Boss"))
    qrow = sh.handoff(T, Q)
    OUT["q_sides"] = [sh.side_for(viewer("Dee Direct"), qrow),
                      sh.side_for(viewer("Sam Boss", "HM"), qrow),
                      sh.side_for(viewer("Tak Er"), qrow),
                      sh.side_for(viewer("Gia Give"), qrow)]
    OUT["q_described"] = [sh.describe(qrow, viewer("Val Vice"))["may_approve_director"],
                          sh.describe(qrow, viewer("Sam Boss", "HM"))["may_approve_director"],
                          sh.describe(qrow, viewer("Val Vice"))["mine"]]
    OUT["q_waiting"] = Q in [x["id"] for x in sh.waiting_on(T, "Val Vice")]
    OUT["q_match"] = (sh.match_reply(T, text=f"APPROVE {Q}", name="Dee Direct") or {}).get("side")
    qd = sh.answer(T, Q, side="director", word="yes", by="Dee Direct", via="sms")
    OUT["q_done"] = [qd["state"], qd["director_state"], qd["director_by"],
                     book.cell(SW, "Tak Er", D1), book.cell(SW, "Gia Give", D1)]
    OUT["q_doors"] = [qd["staff_via"], qd["manager_via"], qd["director_via"]]
    again = sh.answer(T, Q, side="director", word="yes", by="Val Vice", via="app")
    OUT["q_second"] = [again["changed"], again["director_by"], again["director_via"]]

    # a director's NO ends the swap, and the shift stays where it was
    r = sh.offer(T, location=SW, col_iso=D2, from_staff="Gia Give", to_staff="Tak Er")
    sh.answer(T, r["id"], side="manager", word="yes", by="Sam Boss")
    sh.answer(T, r["id"], side="staff", word="yes", by="Tak Er")
    rn = sh.answer(T, r["id"], side="director", word="no", by="Val Vice")
    OUT["q_no"] = [rn["state"], "the director did not approve" in (rn["why"] or ""),
                   book.cell(SW, "Gia Give", D2), book.cell(SW, "Tak Er", D2)]

    # ── R. THE SWAPS ALREADY IN FLIGHT WHEN THE THIRD CONSENT LANDED ───────
    # The columns arrive with no board on the rows that were already waiting: nobody is asked,
    # nobody may answer, and the gate wants an approval that can never come.
    cbh.stage_cell(T, location=SW, employee="Gia Give", col_iso=D3, value="8A-4P",
                   actor="Sam Boss")
    cbh.publish_house(T, location=SW, actor="Sam Boss")
    sr.forget_estate()
    rr = sh.offer(T, location=SW, col_iso=D3, from_staff="Gia Give", to_staff="Tak Er")
    RR = rr["id"]
    sh.answer(T, RR, side="manager", word="yes", by="Sam Boss")
    sh.answer(T, RR, side="staff", word="yes", by="Tak Er")
    run("UPDATE asa_shift_handoffs SET directors='[]'::jsonb, director_state='pending', "
        "said='{}'::jsonb WHERE id=%s", (RR,))
    r_before = owed_kinds(RR)
    r_beat = sh.complete_ready(T)["looked_at"]
    r_row = sh.handoff(T, RR) or {}
    OUT["r_inflight"] = [r_before, r_beat,
                         r_row.get("directors") if isinstance(r_row.get("directors"), list)
                         else json.loads(r_row.get("directors") or "[]"),
                         owed_kinds(RR)]
    r_done = dir_yes(RR, by="Val Vice")
    OUT["r_moved"] = [r_done["state"], book.cell(SW, "Tak Er", D3), book.cell(SW, "Gia Give", D3)]

    # …and one whose board cannot be read waits, saying so, instead of silently
    cbh.stage_cell(T, location=JH, employee="Kim Give", col_iso=D1, value="7A-3P",
                   actor="Rita Lead")
    cbh.publish_house(T, location=JH, actor="Rita Lead")
    sr.forget_estate()
    rs = sh.offer(T, location=JH, col_iso=D1, from_staff="Kim Give", to_staff="Cy Far")
    run("UPDATE asa_shift_handoffs SET directors='[]'::jsonb WHERE id=%s", (rs["id"],))
    held_dirs = sh.directors_for
    sh.directors_for = lambda dsn: {"readable": False, "names": [],
                                    "why": "the Time Off house could not be read"}
    sh.complete_ready(T)
    sh.directors_for = held_dirs
    rs_row = sh.handoff(T, rs["id"]) or {}
    OUT["r_unreadable"] = [rs_row.get("state"), rs_row.get("why"),
                           rs_row.get("directors") if isinstance(rs_row.get("directors"), list)
                           else json.loads(rs_row.get("directors") or "[]")]
    # …and a list that names nobody leaves it waiting too, saying that a name is what it waits for
    sh.directors_for = lambda dsn: {"readable": True, "names": [],
                                    "why": "the Time Off house's settings name no director"}
    sh.complete_ready(T)
    sh.directors_for = held_dirs
    rb_row = sh.handoff(T, rs["id"]) or {}
    OUT["r_blank"] = [rb_row.get("state"), rb_row.get("why"),
                      rb_row.get("directors") if isinstance(rb_row.get("directors"), list)
                      else json.loads(rb_row.get("directors") or "[]")]
    sh.withdraw(T, rs["id"], by="Kim Give")

    # ── S. ONE HUMAN, ONE SEAT — over the app and over a text ──────────────
    # A house with no manager on file asks the badges for the house manager's consent. The
    # director who gives it has spent their say: the third consent is another human's.
    s = sh.offer(T, location=MK, col_iso=D3, from_staff="Ann Roe", to_staff="Mo Staff")
    S = s["id"]
    sh.answer(T, S, side="staff", word="yes", by="Mo Staff")
    sh.answer(T, S, side="manager", word="yes", by="Dee Direct", via="app")
    OUT["s_owed"] = owed_kinds(S)
    OUT["s_app"] = refused(lambda: sh.answer(T, S, side="director", word="yes", by="Dee Direct"))
    srow = sh.handoff(T, S)
    OUT["s_text"] = [(sh.match_reply(T, text=f"APPROVE {S}", name="Dee Direct") or {}).get("side"),
                     S in [x["id"] for x in sh.waiting_on(T, "Dee Direct", above=True)],
                     (sh.match_reply(T, text=f"APPROVE {S}", name="Val Vice") or {}).get("side")]
    OUT["s_screen"] = [sh.describe(srow, viewer("Dee Direct"))["may_approve_director"],
                       sh.describe(srow, viewer("Val Vice"))["may_approve_director"],
                       sh.side_for(viewer("Dee Direct"), srow)]
    sd = sh.answer(T, S, side="director", word="yes", by="Val Vice", via="sms")
    OUT["s_done"] = [sd["state"], sd["manager_by"], sd["director_by"],
                     book.cell(MK, "Mo Staff", D3), book.cell(MK, "Ann Roe", D3)]

    # ── T. THE HOUSE MANAGER WHO IS ALSO ON THE DIRECTORS LIST ─────────────
    # Their seat is the house manager's; the director's goes to another name on the list.
    held_dirs = sh.directors_for
    sh.directors_for = lambda dsn: {"readable": True, "names": ["Sam Boss", "Val Vice"],
                                    "why": "the director Sam Boss or Val Vice approves"}
    t = sh.offer(T, location=SW, col_iso=D2, from_staff="Gia Give", to_staff="Tak Er")
    trow = sh.handoff(T, t["id"])
    OUT["t_board"] = [sh.director_names(trow), trow["house_manager"],
                      sh.side_for(viewer("Sam Boss", "HM"), trow),
                      sh.side_for(viewer("Val Vice"), trow)]
    sh.withdraw(T, t["id"], by="Gia Give")
    sh.directors_for = lambda dsn: {"readable": True, "names": ["Sam Boss"],
                                    "why": "the director Sam Boss approves"}
    OUT["t_only_hm"] = refused(lambda: sh.offer(T, location=SW, col_iso=D2, from_staff="Gia Give",
                                                to_staff="Tak Er"))
    OUT["t_nothing_left"] = rows("SELECT count(*) FROM asa_shift_handoffs WHERE location=%s "
                                 "AND state='pending'", (SW,))[0][0]

    # ── U. A LISTED NAME WITH A MIDDLE INITIAL, AN ACCOUNT WITHOUT IT ──────
    sh.directors_for = lambda dsn: {"readable": True, "names": ["Val Q. Vice"],
                                    "why": "the director Val Q. Vice approves"}
    u = sh.offer(T, location=SW, col_iso=D2, from_staff="Gia Give", to_staff="Tak Er")
    U = u["id"]
    urow = sh.handoff(T, U)
    OUT["u_owed"] = owed_kinds(U)
    OUT["u_seat"] = [r["id"].split(":", 1)[1] for r in sh.owed(T, limit=200)
                     if r["handoff_id"] == U and r["kind"] == "handoff_ask_director"]
    OUT["u_other_middle"] = refused(lambda: sh.answer(T, U, side="director", word="yes",
                                                      by="Val X. Vice"))
    OUT["u_found"] = [sh.side_for(viewer("Val Vice"), urow),
                      U in [x["id"] for x in sh.waiting_on(T, "Val Vice")],
                      (sh.match_reply(T, text=f"APPROVE {U}", name="Val Vice") or {}).get("side")]
    uy = sh.answer(T, U, side="director", word="yes", by="Val Vice", via="app")
    OUT["u_yes"] = [uy["changed"], uy["director_state"], uy["director_by"]]
    sh.withdraw(T, U, by="Gia Give")
    sh.directors_for = held_dirs

    # ── V. A READ THAT FAILED IS SAID ON THE SWAPS TAB ─────────────────────
    # the module by its own name: `hd` is a result further up this lane
    import house_directory as hdir
    held_read, held_mgrs = hdir.read, sr.house_managers

    def _down(dsn, now=None):
        raise RuntimeError("the directory is down")

    hdir.read = _down
    v_dir = sh.swaps_feed(T, viewer("Sam Boss", "HM"))
    hdir.read = held_read
    sr.house_managers = lambda dsn, **k: {"readable": False, "why": "the mirror is down",
                                          "by_code": {}}
    v_mgr = sh.swaps_feed(T, viewer("Sam Boss", "HM"))
    sr.house_managers = held_mgrs
    OUT["v_unread"] = [v_dir["houses"], v_dir["house_shifts_why"],
                       v_mgr["houses"], v_mgr["house_shifts_why"]]

    # the Swaps tab's own read
    OUT["q_feed_hm"] = (lambda f: [[h["location"] for h in f["houses"]],
                                   sorted({s["employee"] for s in f["house_shifts"]}),
                                   f["directors"]["names"], Q in [x["id"] for x in f["history"]]]
                        )(sh.swaps_feed(T, viewer("Sam Boss", "HM")))
    OUT["q_feed_staff"] = (lambda f: [[h["location"] for h in f["houses"]],
                                      sorted(s["col_iso"] for s in f["my_shifts"]),
                                      [x["id"] for x in f["history"]] == [] or "some"]
                           )(sh.swaps_feed(T, viewer("Gia Give")))

    # ── W. A HOUSE-DAY HOLDS SEVERAL PEOPLE'S SHIFTS ───────────────────────
    # Tak picks up an evening at SW on D2 beside Gia's day shift; each is its own to offer.
    cbh.stage_cell(T, location=SW, employee="Tak Er", col_iso=D2, value="6P-11P", actor="Sam Boss")
    cbh.publish_house(T, location=SW, actor="Sam Boss")
    sr.forget_estate()
    w1 = sh.offer(T, location=SW, col_iso=D2, from_staff="Gia Give", to_staff="Kim Give",
                  reachable=REACHABLE)
    w2 = refused(lambda: sh.offer(T, location=SW, col_iso=D2, from_staff="Tak Er", to_staff="Lou Late",
                                  reachable=REACHABLE))
    w_again = refused(lambda: sh.offer(T, location=SW, col_iso=D2, from_staff="TAK  ER", to_staff="Cy Far",
                                       reachable=REACHABLE))
    w_picker = {s["employee"]: [s["may_transfer"], ((s.get("offer") or {}).get("to_staff") or "")]
                for s in sh.house_shifts(T, SW, viewer("Sam Boss", "HM"), now=datetime.now(timezone.utc))
                if s["col_iso"] == D2}
    OUT["w_two_givers"] = [w1["state"], w2[0], (w2[1] or {}).get("from_staff") if w2[0] == "allowed" else w2,
                           w_again[:2], "Tak Er" in str(w_again[2:]), w_picker]
    for hid in (w1["id"], (w2[1] or {}).get("id") if w2[0] == "allowed" else None):
        if hid:
            sh.withdraw(T, hid, by="Sam Boss")
except Exception as exc:  # noqa: BLE001
    OUT["crash"] = f"{type(exc).__name__}: {exc}"
    import traceback
    OUT["trace"] = traceback.format_exc()[-3000:]
finally:
    cbh.use_workbook(None)
    OUT["rooms"] = ROOMS.close()
print("LANE_RESULT " + json.dumps(OUT, default=str))
'''

# the checkout's modules shipped into the container
MODULES = ("shift_handoff", "shift_requests", "calendar_builder_houses", "calendar_builder_write",
           "calendar_builder_slices", "house_cal_live", "shift_slices", "house_directory",
           "psi_reminders", "badge_follows", "effective_roster", "time_off", "redaction")


def _lane_in_container(script_body: str = LANE) -> dict | None:
    # every module the roots reach, and the IST settings reader's declaration, in a folder of this run's own
    sources = lane_schema.with_imports(SERVER, (*MODULES, "ist_config"))
    return lane_schema.run_in(CONTAINER, lane_schema.script(sources, script_body, "shift-transfer"))


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
          bool(owned) and all(str(s).startswith("hub_test_shift_transfer_") for s in owned.values()), L("owned"))
    ri = L("retired_index") or [[None, None], [None, None]]
    check("THE RETIRED HOUSE-DAY INDEX IS DROPPED ONLY BESIDE ITS OWN TABLE: the lane's copy goes, and the "
          "same name in another schema on the search path is left exactly as it was",
          ri[0][0] is True and ri[1][0] is False and ri[1][1] == ri[0][1], ri)
    # A — the names
    names = L("cand_names") or []
    check("the names are people: no OPEN, FAMILY, Nurse, one-word row, nor the giver",
          not {"OPEN", "FAMILY", "Nurse", "Solo", "Ann Roe"} & set(names)
          and {"Ben Left", "Cy Far", "Zoe New", "Hana Boss"} <= set(names), names)
    check("the approver is said before anybody presses Transfer",
          L("cand_approval") == ["house_manager", ["Hana Boss"], "8A-4P"], L("cand_approval"))
    check("this house's regular comes first, and is free",
          (L("cand_order") or [None])[0] == "Ben Left" and L("cand_ben") == [True, True, True],
          [L("cand_order"), L("cand_ben")])
    check("people from other houses are offered too", L("cand_cy") == [True, False, ["JH"]],
          L("cand_cy"))
    check("somebody working then is named with the shift in the way, never offered",
          (L("cand_dee") or [None])[:2] == [False, "overlap"]
          and "9A-5P shift at JH" in str((L("cand_dee") or [""] * 3)[2]), L("cand_dee"))
    check("somebody whose own cell that day is taken, and somebody with no phone, are not offered",
          L("cand_eve") == [False, "cell_taken"] and L("cand_pat") == [False, "no_contact"],
          [L("cand_eve"), L("cand_pat")])
    check("a first shift there is marked as the house manager's training, with who would train",
          L("cand_zoe") == [True, True, "Hana Boss"], L("cand_zoe"))
    check("a shift that has started has no names — it cannot be handed over",
          code_of(L("cand_started")) == "started", L("cand_started"))
    check("a roster that could not be read refuses nobody, and says so",
          L("cand_blind") == [False, "the roster is down", True], L("cand_blind"))
    # B — refusals
    for key, code in (("ref_open", "open_shift"), ("ref_family", "not_a_person"),
                      ("ref_open_receiver", "not_a_person"), ("ref_nobody", "not_on_a_grid"),
                      ("ref_cell", "cell_taken"), ("ref_overlap", "overlap"),
                      ("ref_started", "started"), ("ref_nophone", "no_contact"),
                      ("ref_managers", "managers_unreadable")):
        check(f"refused: {code}", code_of(L(key)) == code, L(key))
    check("an unreadable manager list says why, and nothing was offered",
          "the mirror is down" in str(L("ref_managers")), L("ref_managers"))
    check("…and every refusal left nothing behind — no offer, no training row",
          L("ref_nothing_left") == [0, 0], L("ref_nothing_left"))
    # C — the offer
    o1 = L("o1") or []
    check("the offer names the receiver as the calendars spell them, and the house manager the "
          "relay resolved — with the ** row's number",
          o1[:6] == ["pending", "Ben Left", "Hana Boss", "house_manager", ["Hana Boss"], "3305550101"]
          and o1[6] == "Ann Roe" and o1[7] is True and o1[8] == "", o1)
    check("the same shift cannot be offered twice, nor listed again, while it waits",
          code_of(L("o1_again")) == "already_offered"
          and code_of(L("o1_cands_again")) == "already_offered", [L("o1_again"), L("o1_cands_again")])
    check("the receiver and the house manager are asked at once",
          L("o1_owed") == [["handoff_ask_manager", "Hana Boss"], ["handoff_ask_staff", "Ben Left"]],
          L("o1_owed"))
    check("the house manager's ask carries the house, its name, the day, the start, the shift, "
          "the taker and the number",
          (L("o1_ask_row") or [None])[0] == "BM4060" and L("o1_ask_row")[1] is True
          and L("o1_ask_row")[4:] == ["8A-4P", "Ben Left", "Hana Boss", "3305550101"],
          L("o1_ask_row"))
    check("the giver cannot approve, the receiver cannot approve, the house manager cannot accept",
          code_of(L("c_giver_approves")) == "own_swap"
          and code_of(L("c_receiver_approves")) == "own_swap"
          and code_of(L("c_hm_accepts")) == "not_the_receiver",
          [L("c_giver_approves"), L("c_receiver_approves"), L("c_hm_accepts")])
    check("the side is the session's: Ben accepts, Hana and a director approve, Ann and Cy have none",
          L("c_sides") == ["staff", "manager", "manager", "", ""], L("c_sides"))
    # D — the asks
    check("a post that answered nothing, and a 'not now', write nothing",
          L("d_blank_post") == 0 and L("d_quiet_post") == 0
          and L("d_after_nothing") == L("o1_owed"), [L("d_blank_post"), L("d_quiet_post")])
    check("a rehearsal row is not written again while the dial stays; nobody-to-text waits for "
          "its retry", L("d_after_recorded") == [], L("d_after_recorded"))
    check("…the house manager's ask with nobody to text is offered again later",
          L("d_retry_later") == [["handoff_ask_manager", "Hana Boss"]], L("d_retry_later"))
    check("…and once the dial moves to send, the receiver's ask that reached nobody goes again",
          L("d_dial_moved") == [["handoff_ask_manager", "Hana Boss"],
                                ["handoff_ask_staff", "Ben Left"]], L("d_dial_moved"))
    check("a text that reached them closes the ask, with the phone it used written down",
          L("d_after_told") == [] and (L("d_ledger") or {}).get("phone_key") == "phonekeyben"
          and (L("d_ledger") or {}).get("state") == "told" and (L("d_ledger") or {}).get("tries") == 2,
          [L("d_after_told"), L("d_ledger")])
    check("nothing is offered inside the quiet window; at noon the same ask is owed",
          L("d_quiet_window") == [0, 1], L("d_quiet_window"))
    check("the shift flow leaves Ben's YES alone — only the one sent after his ask reached him",
          L("p_claimed") == [True], L("p_claimed"))
    check("NEVER A GUESS BY AGE: a YES after the shift flow's NEWER ask is the flow's (not claimed); "
          "after an older one it is the swap's; at the same instant it is claimed — nobody acts on it",
          L("p_recency") == [0, 1, 1], L("p_recency"))
    check("…and once he answered, his later texts are the shift flow's again",
          L("p_after_answer") == 0, L("p_after_answer"))
    check("a reply quoting the ref: the receiver's side, the approver's side, never the giver's",
          L("m_ref_receiver") == "staff" and L("m_ref_hm") == "manager" and L("m_ref_giver") is None,
          [L("m_ref_receiver"), L("m_ref_hm"), L("m_ref_giver")])
    check("a bare YES from somebody with exactly one offer waiting names it",
          L("m_bare_receiver") is True)
    # E — completion
    check("the house manager's yes is written with who gave it, once",
          L("e_first") == ["pending", "approved", "Hana Boss", True] and L("e_twice") is False,
          [L("e_first"), L("e_twice")])
    check("the receiver's yes moves the shift in the workbook",
          L("e_done") == ["done", "Ben Left", "8A-4P", ""], L("e_done"))
    check("every reader follows at once — the estate, forgotten and read again",
          L("e_estate") == ["8A-4P", ""], L("e_estate"))
    check("Ben holds it as a shift of his, not as a swap still being handed",
          L("e_ben_holds") == ["roster"], L("e_ben_holds"))
    check("the giver, the receiver, the house manager and the director are told it went through",
          L("e_owed") == [["handoff_done", "Ann Roe"], ["handoff_done_director", "Dee Direct"],
                          ["handoff_done_manager", "Hana Boss"],
                          ["handoff_done_taker", "Ben Left"]], L("e_owed"))
    # F — the house manager's own shift
    check("the house manager giving their own shift: approved above, said so",
          L("f_offer") == ["above", "", [], True], L("f_offer"))
    check("…the directors are asked, each by name, and no house manager",
          L("f_owed") == [["handoff_ask_above", ""], ["handoff_ask_director", "Dee Direct"],
                          ["handoff_ask_director", "Val Vice"],
                          ["handoff_ask_staff", "Cy Far"]], L("f_owed"))
    check("…she may not approve it; a director may",
          L("f_may") == [False, True] and code_of(L("f_hm_approves")) == "own_swap",
          [L("f_may"), L("f_hm_approves")])
    check("…it waits on a director by text, and on nobody without the badge",
          L("f_waiting_director") == [True] and L("f_waiting_staff") == 0
          and L("f_match_director") == "manager",
          [L("f_waiting_director"), L("f_waiting_staff"), L("f_match_director")])
    check("…and a receiver with no row at the house is given one when it completes",
          L("f_done") == ["done", "8A-2P", ""], L("f_done"))
    check("no house manager on file (MK): approved above, said so",
          (L("g_offer") or [None])[0] == "above"
          and "no house manager is on file for MK" in str(L("g_offer")), L("g_offer"))
    # H — a first shift
    check("a receiver with no IST is OFFERED, carrying one training approval for the swap",
          L("h_offer") == ["pending", True, ["needs_training_approval", "swap"], True], L("h_offer"))
    check("APPROVE takes the training on — refused while the house manager works then",
          code_of(L("h_busy")) == "trainer_busy" and "Rita Lead is working 8A-8P at JH then"
          in str(L("h_busy")), L("h_busy"))
    check("…and nothing changed", L("h_busy_nothing") == ["pending", ["needs_training_approval"]],
          L("h_busy_nothing"))
    check("once she is free, her approval approves the training too, naming her to train",
          L("h_free") == ["approved", [["approved", "swap", "Rita Lead"]]], L("h_free"))
    check("the receiver's yes completes it, with one training row in all",
          L("h_done") == ["done", "9A-5P", "", 1], L("h_done"))
    check("the Requests training door's approval releases the swap as the house manager's consent",
          L("h2_released") == ["approved", "Rita Lead", "pending"]
          and L("h2_done") == ["done", "10A-2P"], [L("h2_released"), L("h2_done")])
    # I — withdraw
    check("an offer to somebody untrained carries its training approval…",
          L("w_training") == ["needs_training_approval"], L("w_training"))
    check("…the giver withdraws it: dead, said who, and the training approval closes with it",
          (L("w_done") or [None])[:2] == ["dead", "Ann Roe"]
          and "withdrawn by Ann Roe" in str(L("w_done"))
          and L("w_training_after") == ["withdrawn"], [L("w_done"), L("w_training_after")])
    check("…the giver is not told what she did, nor the receiver of an offer they never saw",
          L("w_owed") == [], L("w_owed"))
    check("…a withdrawn offer cannot be withdrawn again, and the receiver is free again",
          code_of(L("w_again")) == "not_pending" and L("w_zoe_free") == [],
          [L("w_again"), L("w_zoe_free")])
    # J — expiry
    check("an offer still waiting when the shift starts ends, and says why",
          L("j_expired") == [1, "dead", True], L("j_expired"))
    check("an offer whose shift was called off ends, and a called-off shift cannot be offered",
          L("j_called_off") == [1, "dead", True]
          and code_of(L("j_offer_called_off")) == "called_off",
          [L("j_called_off"), L("j_offer_called_off")])
    # A (staff) — the picker a member of staff reads
    check("A MEMBER OF STAFF'S PICKER says who cannot take it, never why: no application, draft or "
          "source named, no IST state or phone for anybody else, the trainer without the house "
          "manager's commitments",
          L("cand_staff") == ["unavailable", "Dee Busy cannot take this shift", "", None,
                              "unavailable", [], True], L("cand_staff"))
    check("the giver is resolved to the grid's own spelling — a Transfer shown is a Transfer that works",
          L("cand_spelling") == ["allowed", "Ann Roe"], L("cand_spelling"))
    # N — the one who starts it does not approve it
    check("A HOUSE MANAGER WHO STARTS A TRANSFER FOR SOMEBODY ELSE DOES NOT APPROVE IT: it goes above, "
          "saying why, she may not approve it and her approval is refused",
          L("n_offer") == ["above", "", True] and L("n_may") == [False, True]
          and code_of(L("n_self_approve")) == "own_swap"
          and not any(k == "handoff_ask_manager" for k, _p in L("n_owed") or []),
          [L("n_offer"), L("n_may"), L("n_self_approve"), L("n_owed")])
    # O — the trainer's skip
    check("A HOUSE MANAGER HANDING THEIR OWN SHIFT TO A FIRST-TIMER is free to train it — the shift "
          "being given is not counted as their commitment",
          (L("o_offer") or [None])[:4] == ["above", True, True, "Rita Lead"], L("o_offer"))
    check("…the approval takes the training on instead of refusing it as trainer_busy",
          L("o_approved") == ["allowed", "approved"], L("o_approved"))
    check("…and the swap completes: the shift moves, the training names her",
          (L("o_done") or [None])[:3] == ["done", "9A-5P", ""]
          and (L("o_done") or [None] * 4)[3] == [["approved", "swap", "Rita Lead"]], L("o_done"))
    # K — pause
    check("AN IST RECORD THAT CANNOT BE READ IS A MISSING IST: the agreed swap waits, nothing moved, and "
          "ONE training approval is raised for the house manager (rule 7)",
          L("k_paused") == ["pending", True, "10A-6P", 1], L("k_paused"))
    check("…it stays waiting while the record is unreadable, with still one approval, never a second",
          L("k_still_paused") == 1 and L("k_one_training") == 1,
          [L("k_still_paused"), L("k_one_training")])
    check("…and completes on the next beat once it can be read",
          L("k_done") == [1, "done", "10A-6P"], L("k_done"))
    check("…and the approval it raised is taken off the house manager's list — no training was needed",
          L("k_training_closed") == ["withdrawn"], L("k_training_closed"))
    check("the receiver's own cell that day is never written over — the swap ends, the cells stand",
          L("l_dead") == ["dead", True, "6P-10P", "9A-5P"], L("l_dead"))
    # M — screens
    check("the board: the approver's waiting list, the receiver's, and the giver's own",
          L("m_board") == [[True], [True], [True]], L("m_board"))
    check("the panel's list shows the offer to the house manager, and to nobody outside it",
          L("m_house") == [1, 0], L("m_house"))
    check("the giver's own upcoming shifts: the offered one is marked, the others may be transferred",
          any(x[1] is False and x[2] is True for x in L("m_my_shifts") or [])
          and any(x[1] is True for x in L("m_my_shifts") or []), L("m_my_shifts"))
    check("Requests: the receiver's copy carries only his swaps, with Accept on the waiting one",
          (L("m_feed_ben") or [0])[0] > 0 and L("m_feed_ben")[1:] == [True, True], L("m_feed_ben"))
    check("…a member of staff outside a swap is not sent it", L("m_feed_cy") == [], L("m_feed_cy"))
    check("…and the house manager's copy carries Approve", L("m_feed_hana") is True,
          L("m_feed_hana"))
    check("Requests carries the reader's own upcoming shifts to transfer",
          (L("m_feed_my_shifts") or [None, None, None])[1:] == ["", True], L("m_feed_my_shifts"))
    check("the house's manager may withdraw a transfer at her house, and is named",
          L("m_withdrawn_by_hm") == "Hana Boss", L("m_withdrawn_by_hm"))
    # P — who may open a swap
    check("A SWAP IS OPENED BY THE PERSON WHOSE SHIFT IT IS, OR THAT HOUSE'S MANAGER, AND NOBODY "
          "ELSE: not a colleague, not another house's manager, and not a role word alone",
          L("p_open") == [True, False, True, False, False], L("p_open"))
    check("…and not a director, team lead or administrator badge either: deciding every house is "
          "not opening a swap on somebody else's shift",
          L("p_badges") == [False, False, False, True], L("p_badges"))
    check("…so the Swaps tab offers such a badge no house of shifts to pick from",
          L("p_badge_feed") == [[], []], L("p_badge_feed"))
    # Q — the director
    check("the directors list is read before anybody is asked: unreadable refuses the swap and "
          "leaves nothing behind",
          code_of(L("q_no_directors")) == "directors_unreadable"
          and "could not be read" in str(L("q_no_directors")) and L("q_nothing_left") == 0,
          [L("q_no_directors"), L("q_nothing_left")])
    qbo = L("q_blank_offer") or [None, None, None, ""]
    check("A LIST THAT NAMES NOBODY OPENS THE SWAP AND SAYS THE DIRECTOR WAITS, as time off is filed: no "
          "director on the row, their approval pending, and the row's sentence names the cure",
          qbo[:3] == ["pending", [], "pending"] and "names nobody" in str(qbo[3])
          and "Settings -> Time Off" in str(qbo[3]) and "could not be read" not in str(qbo[3]), qbo)
    check("…the receiver and the house manager are asked now, and no director is asked for a seat nobody holds",
          L("q_blank_owed") == [["handoff_ask_manager", "Sam Boss"], ["handoff_ask_staff", "Tak Er"]],
          L("q_blank_owed"))
    qbh = L("q_blank_held") or [None] * 6
    check("THE DIRECTOR STILL BLOCKS: with the receiver and the house manager at yes the shift has not moved, "
          "a director's answer is refused as 'nobody asked yet' — never 'not a director' — and no screen "
          "offers the director's Approve",
          code_of(L("q_blank_dir")) == "no_directors" and "Settings → Time Off" in str(L("q_blank_dir"))
          and L("q_blank_beat") == 0 and qbh[:4] == ["pending", [], "", "9A-5P"]
          and "names nobody" in str(qbh[4]) and qbh[5] is False,
          [L("q_blank_dir"), L("q_blank_beat"), qbh])
    qbn = L("q_blank_named") or [None, None, None]
    check("…and once the list names somebody the next beat gives it the board, the waiting sentence goes, and "
          "every director left for it is asked",
          L("q_blank_adopted") == 1 and qbn[0] == ["Dee Direct", "Val Vice"] and qbn[1] == ""
          and qbn[2] == [["handoff_ask_director", "Dee Direct"], ["handoff_ask_director", "Val Vice"]],
          [L("q_blank_adopted"), qbn])
    qsh, qsg = L("q_stuck_hm") or [{}, ""], L("q_stuck_gave") or [{}, ""]
    check("a list naming only the swap's house manager is said on the row, and once that house manager has "
          "approved, the row says every name on it already gave a consent — each sentence naming the cure",
          (qsh[0] or {}).get("waiting") == 1 and "is its house manager" in str(qsh[1])
          and (qsg[0] or {}).get("waiting") == 1 and "already gave its house manager's approval" in str(qsg[1])
          and "Settings -> Time Off" in str(qsg[1]), [qsh, qsg])
    qsn, qsr = L("q_stuck_named") or {}, L("q_stuck_row") or [None, None, None]
    check("…and once another name is saved the swap is given its board and THAT sentence goes too — a pending "
          "row never says no director was asked beside the director it asked",
          qsn.get("adopted") == 1 and qsr == [["Dee Direct"], "", "pending"], [qsn, qsr])
    check("the offer writes the directors it will ask, from the list, and their consent starts pending",
          L("q_offer") == [["Dee Direct", "Val Vice"], "pending"], L("q_offer"))
    check("the receiver, the house manager AND EVERY DIRECTOR ON THE LIST are asked at once — "
          "a swap never waits on one director being at their phone",
          L("q_owed") == [["handoff_ask_director", "Dee Direct"],
                          ["handoff_ask_director", "Val Vice"],
                          ["handoff_ask_manager", "Sam Boss"],
                          ["handoff_ask_staff", "Tak Er"]], L("q_owed"))
    check("THE DIRECTOR BLOCKS: the receiver and the house manager have both said yes and the "
          "shift has not moved, on the answer or on the minute beat",
          L("q_blocked") == ["pending", "", "8A-4P"] and L("q_beat") == 0,
          [L("q_blocked"), L("q_beat")])
    check("a director inside the swap cannot approve it, and somebody off the list is not its director",
          code_of(L("q_in_swap")) == "own_swap" and code_of(L("q_not_listed")) == "not_a_director",
          [L("q_in_swap"), L("q_not_listed")])
    check("the side is the session's: a listed director gives the director's approval, the house "
          "manager who already answered is waited on for nothing, and the two in the swap have none",
          L("q_sides") == ["director", "", "staff", ""], L("q_sides"))
    check("…and the screens are told the same: only the listed director sees the director's Approve",
          L("q_described") == [True, False, True], L("q_described"))
    check("a director's own phone finds the swap by a bare name and by its ref",
          L("q_waiting") is True and L("q_match") == "director",
          [L("q_waiting"), L("q_match")])
    check("the director's yes is the last of the three, and the shift moves then",
          L("q_done") == ["done", "approved", "Dee Direct", "8A-4P", ""], L("q_done"))
    check("EACH APPROVAL RECORDS THE DOOR IT CAME THROUGH: the platform, a text, and the platform "
          "again — one field each, none read off another",
          L("q_doors") == ["sms", "app", "sms"], L("q_doors"))
    check("A SECOND ANSWER FROM THE SAME SIDE NEVER OVERWRITES THE FIRST",
          L("q_second") == [False, "Dee Direct", "sms"], L("q_second"))
    check("a director's no ends the swap and the shift stays where it was",
          L("q_no") == ["dead", True, "9A-5P", ""], L("q_no"))
    check("the Swaps tab reads the houses this manager may open a swap for, their shifts, the "
          "directors and the company's swaps",
          (L("q_feed_hm") or [None])[0] == ["CAN - SW - SW9090"]
          and L("q_feed_hm")[1] == ["Gia Give", "Tak Er"]
          and L("q_feed_hm")[2] == ["Dee Direct", "Val Vice"] and L("q_feed_hm")[3] is True,
          L("q_feed_hm"))
    check("…and a member of staff's copy offers no house of somebody else's, only their own shifts",
          (L("q_feed_staff") or [None])[0] == [] and L("q_feed_staff")[1], L("q_feed_staff"))
    # R — the swaps already in flight when the third consent landed
    check("A SWAP ALREADY IN FLIGHT IS NOT DEAD-LOCKED: with no board on it nobody is asked and "
          "the beat passes it by, so the beat gives it the board it is owed and the asks go out",
          L("r_inflight") == [[], 0, ["Dee Direct", "Val Vice"],
                              [["handoff_ask_director", "Dee Direct"],
                               ["handoff_ask_director", "Val Vice"]]], L("r_inflight"))
    check("…and the director's yes then moves the shift, as on any other swap",
          L("r_moved") == ["done", "8A-4P", ""], L("r_moved"))
    check("…while a board that could not be read leaves the row waiting AND SAYS SO, never "
          "adopting a list nobody could read",
          (L("r_unreadable") or [None])[0] == "pending"
          and "could not be read" in str(L("r_unreadable")[1])
          and L("r_unreadable")[2] == [], L("r_unreadable"))
    check("…and a list that names nobody leaves it waiting too, saying a name saved on Settings → Time "
          "Off is what it waits for — never that the list could not be read",
          (L("r_blank") or [None])[0] == "pending"
          and "names nobody" in str(L("r_blank")[1]) and "could not be read" not in str(L("r_blank")[1])
          and L("r_blank")[2] == [], L("r_blank"))
    # S — one human never fills two of the three seats
    check("A DIRECTOR IS NOT THE HOUSE MANAGER: on a swap whose row names one, that seat is "
          "refused them",
          code_of(L("q_dir_not_hm")) == "not_the_managers_seat", L("q_dir_not_hm"))
    check("ONE HUMAN NEVER FILLS TWO SEATS: the director who gave the house manager's consent "
          "is REFUSED the director's, on the app",
          code_of(L("s_app")) == "two_seats" and "three people" in str(L("s_app")), L("s_app"))
    check("…and over a text: their phone finds nothing of theirs waiting, while the other "
          "director's does",
          L("s_text") == [None, False, "director"], L("s_text"))
    check("…and the screen draws them no Approve either",
          L("s_screen") == [False, True, ""], L("s_screen"))
    check("…so the third consent is another human's, and the shift moves on three names",
          L("s_done") == ["done", "Dee Direct", "Val Vice", "8A-12P", ""], L("s_done"))
    check("…and the director who gave the house manager's consent is not asked for the "
          "director's: only the other director is",
          L("s_owed") == [["handoff_ask_director", "Val Vice"]], L("s_owed"))
    # T — the house manager on the directors list
    check("A HOUSE MANAGER ON THE DIRECTORS LIST KEEPS THE HOUSE MANAGER'S SEAT: the swap's "
          "directors leave them off, and each of the two answers their own seat",
          L("t_board") == [["Val Vice"], "Sam Boss", "manager", "director"], L("t_board"))
    check("…and when the house manager is the only director left, the swap is refused — "
          "saying why — and nothing is written",
          code_of(L("t_only_hm")) == "directors_manage_the_house"
          and "two of the three consents" in str(L("t_only_hm")) and L("t_nothing_left") == 0,
          [L("t_only_hm"), L("t_nothing_left")])
    # U — a middle initial on the list
    check("A DIRECTOR LISTED WITH A MIDDLE INITIAL IS ASKED BY THE PEOPLE HOUSE'S SPELLING, "
          "under a seat keyed on the listed name",
          L("u_owed") == [["handoff_ask_director", "Val Vice"], ["handoff_ask_manager", "Sam Boss"],
                          ["handoff_ask_staff", "Tak Er"]]
          and L("u_seat") == ["handoff_ask_director:valqvice"], [L("u_owed"), L("u_seat")])
    check("…never answered by another middle",
          code_of(L("u_other_middle")) == "not_a_director", L("u_other_middle"))
    check("…and their account, without the initial, is found on the screen, on a bare text and "
          "on a quoted ref — and its yes is recorded",
          L("u_found") == ["director", True, "director"]
          and L("u_yes") == [True, "approved", "Val Vice"], [L("u_found"), L("u_yes")])
    # V — a failed read on the Swaps tab
    vu = L("v_unread") or [None] * 4
    check("A DIRECTORY THAT COULD NOT BE READ offers no house and SAYS SO on the Swaps tab",
          vu[0] == [] and "the house directory could not be read" in str(vu[1]), vu)
    check("…and so does a managers list that could not be read — never an empty list in silence",
          vu[2] == [] and "who manages which house could not be read" in str(vu[3])
          and "the mirror is down" in str(vu[3]), vu)
    # W — two people's shifts on one house-day
    w = L("w_two_givers") or [None] * 6
    check("A HOUSE-DAY HOLDS SEVERAL SHIFTS: while Gia's day shift waits, Tak's evening at the same house "
          "that day is offered too — each person's cell is its own",
          w[0] == "pending" and w[1] == "allowed" and w[2] == "Tak Er", w)
    check("…the same person's cell still takes one offer at a time, under any spelling, and the refusal "
          "names whose shift it is",
          w[3] == ["refused", "already_offered"] and w[4] is True, w)
    check("…and the Swaps picker ties each offer to its own giver's row",
          w[5] == {"Gia Give": [False, "Kim Give"], "Tak Er": [False, "Lou Late"]}, w)


print(f"\n{results['ok']} ok, {len(results['failed'])} failed")
for name in results["failed"]:
    print("  FAILED:", name)
sys.exit(1 if results["failed"] else 0)
