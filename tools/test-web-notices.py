#!/usr/bin/env python3
"""Company notices (N1–N7): audiences, privacy, once per event, derived events, the bell, the wiring, the links."""
import ast
import json
import os
import re
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
    errors = types.ModuleType("psycopg2.errors")
    errors.UniqueViolation = type("UniqueViolation", (Exception,), {})
    fake.extras, fake.errors = extras, errors
    sys.modules["psycopg2"] = fake
    sys.modules["psycopg2.extras"] = extras
    sys.modules["psycopg2.errors"] = errors

sys.path.insert(0, str(SERVER))
os.environ.setdefault("HUB_SNAPSHOT_OUT", "/tmp")
import shift_requests as sr  # noqa: E402
import web_notices as wn  # noqa: E402

H1 = "CAN - 48TH (B) - ABD1711"
H2 = "CAN - JH - ABD2704"
NOW = datetime(2026, 9, 22, 18, 0, tzinfo=timezone.utc)
SPAN = timedelta(minutes=120)

sr.house_managers = lambda dsn, fresh=False: {
    "readable": True, "why": "", "by_code": {"ABD1711": {"name": "Hal Manager", "phone": "", "house": H1}}}


def viewer(name, role="staff", types_=""):
    return sr.viewer("dsn", name=name, role=role, types=types_)


ADMIN = viewer("Ada Admin", "admin", "ADMINISTRATOR")
import badge_follows  # noqa: E402
FOLLOWER = next((w for w, stands in badge_follows.BADGE_FOLLOWS.items() if stands == "DIRECTOR"), "")
TL = viewer("Tia Lead", "staff", FOLLOWER or "DIRECTOR")
HAL = viewer("Hal Manager")
ANN = viewer("Ann Roe")
BEN = viewer("Ben Left")
ZED = viewer("Zed Caller")
NOBODY = viewer("")


def notice(kind, facts=None, *, location=H1, ref="SPABC", value="10P-8A", nid=1):
    return {"id": nid, "key": f"{kind}:{ref}", "kind": kind, "at": NOW.isoformat(),
            "location": location, "col_iso": "2026-09-23", "ref": ref, "value": value,
            "facts": facts or {}, "published_at": NOW.isoformat()}


def role(n, who, open_to=()):
    return wn.audience(n, who, eligible=lambda _n, person: sr.fold(person) in {sr.fold(p) for p in open_to})


print("\nN1 — who hears what is Requests' question")

check("the catalogue names an audience for every kind it announces, and only known audiences",
      all(set(v["who"]) <= {"company", "decider", "theirs", "invited", "staff", "approver"} and v["who"]
          for v in wn.CATALOGUE.values()), wn.CATALOGUE)
check("only a call-off is told to all staff — everyone online",
      [k for k, v in wn.CATALOGUE.items() if "staff" in v["who"]] == [wn.K_CALL_OFF])
check("only time off names its approvers as an audience",
      sorted(k for k, v in wn.CATALOGUE.items() if "approver" in v["who"]) == sorted(wn.TIME_OFF_KINDS))
TO_FACTS = {"person": "Ann Roe", "start": "2026-09-24", "end": "2026-09-25", "houses": ["ABD1711"],
            "approvers": ["Lisa B. Bright", "Ty Bond"]}
to_ask = notice(wn.K_TO_ASKED, dict(TO_FACTS), ref="TO0123456789")
check("TIME OFF: an ask reaches the approvers it names, a middle initial aside — not the person, not the house, "
      "not the badges above",
      [role(to_ask, viewer("Lisa Bright")), role(to_ask, viewer("Ty Bond")), role(to_ask, ANN), role(to_ask, HAL),
       role(to_ask, ADMIN), role(to_ask, BEN)] == ["approver", "approver", "", "", "", ""],
      [role(to_ask, viewer("Lisa Bright")), role(to_ask, ANN), role(to_ask, HAL), role(to_ask, ADMIN)])
to_done = notice(wn.K_TO_SCHEDULED, dict(TO_FACTS), ref="TO0123456789")
check("…scheduling tells the person, the approvers and whoever decides the house — nobody else",
      [role(to_done, ANN), role(to_done, viewer("Ty Bond")), role(to_done, HAL), role(to_done, BEN)]
      == ["theirs", "approver", "decider", ""],
      [role(to_done, ANN), role(to_done, viewer("Ty Bond")), role(to_done, HAL), role(to_done, BEN)])
MASTER_R = sr.viewer("dsn", name="Main Account", role="admin", types="ADMINISTRATOR", is_master=True)
NOT_MASTER = sr.viewer("dsn", name="Main Account", role="admin", types="ADMINISTRATOR MASTER", is_master=False)
check("…the master's own session reads every time off notice an approver reads; the badge word alone does not",
      MASTER_R["is_master"] is True and NOT_MASTER["is_master"] is False
      and [role(notice(k, dict(TO_FACTS), ref="TO0123456789"), MASTER_R) for k in sorted(wn.TIME_OFF_KINDS)]
      == ["approver"] * len(wn.TIME_OFF_KINDS)
      and role(to_ask, NOT_MASTER) == "",
      [role(notice(k, dict(TO_FACTS), ref="TO0123456789"), MASTER_R) for k in sorted(wn.TIME_OFF_KINDS)])
co = notice(wn.K_CALL_OFF, {"caller": "Zed Caller", "open_row": "Zed Caller",
                            "window": {"closes_at": (NOW + timedelta(hours=3)).isoformat(), "state": "open"}})
check("a call-off reaches the whole-company badges", role(co, ADMIN) == "company" or role(co, ADMIN) == "decider")
check(f"the badge that stands in for a director ({FOLLOWER or 'none today — a director'}) reaches "
      "the whole company",
      TL["whole_company"] is True and TL["sees_reasons"] is True and role(co, TL) in ("company", "decider"), TL)
check("the house's own ** row hears it as the one who decides, badge STAFF or not",
      role(co, HAL) == "decider", role(co, HAL))
check("a caregiver it is open to is INVITED", role(co, ANN, open_to=["Ann Roe"]) == "invited")
check("a caregiver it is NOT open to is told the news, never invited — no invitation the door would refuse",
      role(co, BEN, open_to=["Ann Roe"]) == "staff", role(co, BEN, open_to=["Ann Roe"]))
check("an account on no roster is never invited to anything", role(co, NOBODY, open_to=[""]) != "invited")
check("the person who called off is never invited to their own shift, even if the door would say yes — "
      "nor told the news of it", role(co, ZED, open_to=["Zed Caller"]) == "")
check("JH's call-off does not reach 48TH's manager as a decider",
      role(notice(wn.K_CALL_OFF, {"caller": "Zed"}, location=H2), HAL) != "decider")
CLIENT = viewer("", "client", "CLIENT")
check("a client or guardian account hears no call-off at all — it is staff news",
      role(co, CLIENT) == "" and role(co, viewer("", "guardian", "GUARDIAN")) == "")
check("an open shift is NOT told to all staff: inside its ten minutes it is only the regulars'",
      role(notice(wn.K_OPEN_SHIFT, {"window": {"state": "open"}}), BEN) == "")
HANA = viewer("Hana Badge", "staff", "HM")
check("a team lead who is a regular of the house is INVITED, not merely told — the door would take them",
      role(co, TL, open_to=["Tia Lead"]) == "invited", role(co, TL, open_to=["Tia Lead"]))
check("so is a whole-company HM badge who works shifts there",
      role(co, HANA, open_to=["Hana Badge"]) == "invited"
      and role(notice(wn.K_OPEN_SHIFT, {"window": {"state": "open"}}), HANA, open_to=["Hana Badge"]) == "invited")
check("and the house's own ** row, when it is open to them",
      role(co, HAL, open_to=["Hal Manager"]) == "invited")
tl_inv = wn.shape(co, "invited", TL)
check("the invitation still names the caller to a badge that reads it, and says they decide the house",
      "Zed Caller called off" in tl_inv["body"] and "you decide when applications close" in tl_inv["body"]
      and tl_inv["href"].startswith("/app/calendarbuilder/requests?tab=me") and tl_inv["tone"] == "urgent", tl_inv)
check("a caregiver's invitation neither names the caller nor claims they decide",
      "Zed" not in wn.shape(co, "invited", ANN)["body"]
      and "you decide" not in wn.shape(co, "invited", ANN)["body"])

app = notice(wn.K_APPLICATION, {"person": "Ann Roe", "open_row": "OPEN", "state": "applied"})
check("an application reaches the house manager of that house", role(app, HAL) == "decider")
check("and the whole company's list, as Requests shows every row to it", role(app, ADMIN) in ("decider", "company"))
check("but never another caregiver — other people's rows do not travel", role(app, BEN) == "")
dec = notice(wn.K_DECIDED, {"person": "Ann Roe", "by": "Hal Manager", "how": "approved"})
check("a decision reaches the applicant, in the second person", role(dec, ANN) == "theirs")
check("and the house manager", role(dec, HAL) == "decider")
check("and nobody else without the badge", role(dec, BEN) == "")
check("a passed-over applicant hears it went elsewhere, and only they do",
      role(notice(wn.K_NOT_CHOSEN, {"person": "Ben Left"}), BEN) == "theirs"
      and role(notice(wn.K_NOT_CHOSEN, {"person": "Ben Left"}), ANN) == "")
tr = notice(wn.K_TRAINING, {"person": "Ben Left", "why": "no IST for 48TH (B)"})
check("a training approval reaches the house manager and the person it is about",
      role(tr, HAL) == "decider" and role(tr, BEN) == "theirs" and role(tr, ANN) == "")
ns = notice(wn.K_NO_SHOW, {"person": "Ben Left", "minutes": 75}, location=H1)
check("a no-call no-show reaches the house manager of that house",
      role(ns, HAL) == "decider")
check("and the badges that decide everywhere", role(ns, ADMIN) == "decider" and role(ns, TL) == "decider")
check("never a caregiver — not even the one it is about", role(ns, BEN) == "" and role(ns, ANN) == "")
check("ALERTS I RECEIVE: a reader who turned No Call No Show off for themselves never hears it, whatever role they "
      "had; every other reader, and every other kind, are judged as before",
      wn.RECEIVE_PART == {wn.K_NO_SHOW: "no_call"}
      and role(ns, {**ADMIN, "alerts_off": ["no_call"]}) == "" and role(ns, {**HAL, "alerts_off": ["no_call"]}) == ""
      and role(ns, {**ADMIN, "alerts_off": ["punch", "incident"]}) == "decider"
      and role(ns, {**HAL, "alerts_off": []}) == "decider"
      and role(notice(wn.K_LATE_CALL, {"person": "Ben Left"}), {**HAL, "alerts_off": ["no_call"]}) == "decider"
      and role(co, {**HAL, "alerts_off": ["no_call"]}) == "decider",
      [role(ns, {**ADMIN, "alerts_off": ["no_call"]}), role(ns, {**ADMIN, "alerts_off": ["punch"]})])
check("a whole-company badge that decides nowhere does not get the attendance panel's notices "
      "(Requests shows it only for houses they decide in)",
      role(ns, viewer("Hana Badge", "staff", "HM")) == "", role(ns, viewer("Hana Badge", "staff", "HM")))
sw = notice(wn.K_SWAP_OFFERED, {"from": "Ann Roe", "to": "Ben Left", "manager": ""}, ref="HO123")
check("a swap reaches its two people and the house manager, and no third caregiver",
      role(sw, ANN) == "theirs" and role(sw, BEN) == "theirs" and role(sw, HAL) == "decider"
      and role(sw, ZED) == "")
fl = notice(wn.K_FILLED, {"person": "Ann Roe", "how": "approved"})
check("who took a shift is the deciders' panel, and a decision already told its person",
      role(fl, HAL) == "decider" and role(fl, ANN) == "")
check("but a desk placing somebody straight on an OPEN row tells them here",
      role(notice(wn.K_FILLED, {"person": "Ann Roe", "how": "app"}), ANN) == "theirs")


print("\nN2 — the reason never travels; the caller only to the whole company and the house's own managers")

invited = wn.shape(co, "invited", ANN)
company = wn.shape(co, "company", ADMIN)
decider_staff_badge = wn.shape(co, "decider", HAL)
check("the caregiver's copy does not name who called off", "Zed" not in json.dumps(invited), invited)
check("the ** row's copy names who called off at THEIR house — a current ** manager wears HM there, "
      "whatever the badge column says, and Requests shows them the caller too; never the reason",
      "Zed Caller" in decider_staff_badge["body"] and "sick" not in json.dumps(decider_staff_badge)
      and "HM" in HAL["badges"] and HAL["whole_company"] is False, decider_staff_badge)
check("…and at a house they do not manage their copy is a caregiver's: no caller",
      "Zed" not in json.dumps(wn.shape(notice(wn.K_CALL_OFF, {"caller": "Zed Caller"}, location=H2),
                                       "staff", HAL)))
check("the whole-company copy does", "Zed Caller" in company["body"], company)
check("no copy carries the facts, the open row or any field beyond the words",
      all("facts" not in c and "open_row" not in c for c in (invited, company, decider_staff_badge)))
check("the invitation goes where the caregiver applies", invited["href"].startswith(
    "/app/calendarbuilder/requests?tab=me") and "ref=SPABC" in invited["href"], invited["href"])
check("the shift rides as the calendar writes it, and the words leave room for the Time switch",
      invited["shift"] == "10P-8A" and "{shift}" in invited["body"], invited)
check("the notices keep no second speller of the shift — the push spells it through web_gate",
      not hasattr(wn, "spelled"))
manager_only = notice(wn.K_CALL_OFF, {"caller": "Zed Caller", "window": {"state": "manager_only"}})
MIA = viewer("Mia Manager", "manager")
check("a call-off inside the floor asks a reader the calendar doors admit to assign it now",
      "assign it now" in wn.shape(manager_only, "decider", MIA)["title"]
      and "assign it now" in wn.shape(manager_only, "decider", ADMIN)["title"])
hal_floor = wn.shape(manager_only, "decider", HAL)
check("a ** row with badge STAFF is admitted by the calendar doors and assigns there, so it is asked too",
      "assign it now" in hal_floor["title"], hal_floor)
shut_floor = wn.shape(manager_only, "decider", viewer("Gil Guardian", "guardian"))
check("and promises nothing to a reader whose session has no door to assign through — it is told the news "
      "and where the assignment is made",
      "assign it now" not in shut_floor["title"] and "Calendar Builder → Live" in shut_floor["body"]
      and "House Calendars" not in shut_floor["body"]
      and "too soon for applications" in shut_floor["title"], shut_floor)
staff_copy = wn.shape(co, "staff", BEN)
check("the staff's copy of a call-off: the news, no caller, no invitation, a toast and not the red pin",
      staff_copy["title"] == "Call-off at 48TH (B)" and "Zed" not in json.dumps(staff_copy)
      and "apply" not in staff_copy["body"] and staff_copy["tone"] == "" and staff_copy["priority"] == "high"
      and staff_copy["expires_at"] == "" and "tab=calloffs" in staff_copy["href"], staff_copy)
check("a reader is never linked to a tab their copy of Requests does not draw: Houses and Attendance are "
      "the whole company's and every house manager's — the ** row's included, a caregiver's never",
      "tab=attendance" in wn.shape(fl, "decider", HAL)["href"]
      and "tab=houses" not in wn.shape(notice(wn.K_OPEN_SHIFT), "decider", HAL)["href"]
      and "tab=attendance" not in wn.shape(fl, "decider", viewer("Una Ward"))["href"]
      and "tab=houses" not in wn.shape(notice(wn.K_OPEN_SHIFT), "staff", BEN)["href"])


print("\nN7 — what the screen does with it: urgent, until when, and where a click lands")

closes = (NOW + timedelta(hours=3)).isoformat()
os_n = notice(wn.K_OPEN_SHIFT, {"open_row": "OPEN 2", "window": {"closes_at": closes, "state": "open"}})
check("an open shift is URGENT to the caregiver it is open to — ten minutes to apply",
      wn.shape(os_n, "invited", ANN)["tone"] == "urgent" and wn.shape(os_n, "invited", ANN)["priority"] == "high")
check("and a quiet published day to the people who decide it",
      wn.shape(os_n, "decider", HAL)["tone"] == "" and wn.shape(os_n, "company", ADMIN)["priority"] == "normal")
check("a call-off is urgent to every reader it reaches",
      {wn.shape(co, r, w)["tone"] for r, w in (("invited", ANN), ("decider", HAL), ("company", ADMIN))} == {"urgent"})
check("an invitation says when it ends — the window's own close",
      wn.shape(co, "invited", ANN)["expires_at"] == closes and wn.shape(os_n, "invited", ANN)["expires_at"] == closes)
check("nobody else's copy ends — the house manager still has to decide after the window",
      wn.shape(co, "decider", HAL)["expires_at"] == "" and wn.shape(co, "company", ADMIN)["expires_at"] == ""
      and wn.shape(app, "decider", HAL)["expires_at"] == "")
cal = wn.shape(co, "company", ADMIN)["href"]
check("a reader the House Calendars doors admit is sent to the cell: that house, that day, that ref",
      cal.startswith("/app/calendarbuilder/house-cal?") and "ref=SPABC" in cal and "day=2026-09-23" in cal
      and "house=CAN%20-%2048TH%20%28B%29%20-%20ABD1711" in cal, cal)
check("the calendar link never carries the row it came from — the caller's name",
      "Zed" not in cal and "open_row" not in cal, cal)
import hashlib  # noqa: E402
_plain = "SP" + hashlib.sha256(f"{H1}|Zed Caller|2026-09-23".encode()).hexdigest()[:10].upper()
_saved_key = sr._REF_KEY
try:
    sr._REF_KEY = hashlib.sha256(b"test key").digest()
    keyed = sr.ref_of(H1, "Zed Caller", "2026-09-23")
    check("a keyed ref is not the plain hash of the cell — guessing names at the house finds nothing",
          keyed != _plain and keyed.startswith("SP") and len(keyed) == 12, (keyed, _plain))
    check("and it is stable: the same cell is the same ref, another cell another",
          keyed == sr.ref_of(H1, "Zed Caller", "2026-09-23") and keyed != sr.ref_of(H1, "Ann Roe", "2026-09-23"))
    sr._REF_KEY = hashlib.sha256(b"another key").digest()
    check("a different secret, a different ref — the secret is what makes it opaque",
          sr.ref_of(H1, "Zed Caller", "2026-09-23") != keyed)
finally:
    sr._REF_KEY = _saved_key
_env = {k: os.environ.pop(k, None)
        for k in ("HUB_SHIFT_REF_KEY", "HUB_SERVICE_SECRET", "HUB_SERVICE_TOKEN")}
try:
    check("with no secret on the relay the configured key is empty — and the relay says so at import",
          sr._ref_key() == b"")
    check("yet the handle is still keyed: the process keys with a secret of its own",
          len(sr._REF_KEY) == 32
          and sr.ref_of(H1, "Zed Caller", "2026-09-23") != _plain)
    os.environ["HUB_SERVICE_SECRET"] = "s1"
    from_service = sr._ref_key()
    os.environ["HUB_SHIFT_REF_KEY"] = "r1"
    check("the key comes from the relay's service secret, and an explicit key wins over it",
          from_service and sr._ref_key() and sr._ref_key() != from_service)
finally:
    for k, v in _env.items():
        os.environ.pop(k, None)
        if v is not None:
            os.environ[k] = v
check("no arithmetic of the ref ships to the browser any more",
      not (ROOT / "src/pages/features/shifts/poolRef.ts").exists())
check("the open shift's deciders are sent to the cell as well",
      wn.shape(os_n, "decider", ADMIN)["href"].startswith("/app/calendarbuilder/house-cal?"))
check("a ** row the calendar doors admit is sent to the cell it decides",
      wn.shape(co, "decider", HAL)["href"].startswith("/app/calendarbuilder/house-cal?"),
      wn.shape(co, "decider", HAL)["href"])
check("a reader the calendar doors refuse is sent to Requests, not to a 403",
      wn.shape(co, "decider", viewer("Gil Guardian", "guardian"))["href"].startswith(
          "/app/calendarbuilder/requests?tab=calloffs"),
      wn.shape(co, "decider", viewer("Gil Guardian", "guardian"))["href"])
check("the caregiver it is open to applies on Requests, whatever their role",
      wn.shape(co, "invited", viewer("Mia Manager", "manager"))["href"].startswith("/app/calendarbuilder/requests?tab=me"))
check("an application is decided on Requests, where the applicants are",
      wn.shape(app, "decider", ADMIN)["href"].startswith("/app/calendarbuilder/requests?"))
_readers = [ADMIN, viewer("Mia Manager", "manager"), HAL, TL, ANN,
            viewer("Cal Client", "client"), viewer("Gil Guardian", "guardian")]
check("the link's line is the calendar doors' own (shift_requests.may_view_calendars), for every reader",
      all(wn.reads_calendars(v) == sr.may_view_calendars(v) for v in _readers)
      and wn.reads_calendars(ADMIN) and wn.reads_calendars(HAL) and wn.reads_calendars(TL)
      and not wn.reads_calendars(viewer("Cal Client", "client"))
      and not wn.reads_calendars(viewer("Gil Guardian", "guardian")))
BADGED = viewer("Sam Staff", "staff", "ADMIN, MANAGER")
check("a staff account the calendar doors admit is sent to the cell, never to a screen that answers it 403",
      wn.reads_calendars(BADGED)
      and wn.shape(co, "company", BADGED)["href"].startswith("/app/calendarbuilder/house-cal?"),
      wn.shape(co, "company", BADGED)["href"])
check("a notice nothing holds back says so, so the browser draws it",
      wn.shape(co, "invited", ANN)["held"] is False and wn.shape(app, "decider", HAL)["held"] is False)
check("a notice marked HELD carries the mark to every reader's copy — the browser never draws it",
      all(wn.shape({**co, "held": True}, r, w)["held"] is True
          for r, w in (("invited", ANN), ("decider", HAL), ("company", ADMIN))))
check("and the mark is the row's own: a notice stored while test mode was on reads back held",
      wn._row_notice({"id": 1, "key": "k", "kind": wn.K_CALL_OFF, "held_test": True})["held"] is True
      and wn._row_notice({"id": 1, "key": "k", "kind": wn.K_CALL_OFF})["held"] is False)

print("\nN9 — a swap asks the manager named on it; a failed read is never 'not theirs'; the night")

sw_named = notice(wn.K_SWAP_OFFERED, {"from": "Ann Roe", "to": "Ben Left", "manager": "Hal Manager"}, ref="HO9")
hal_sw, ada_sw = wn.shape(sw_named, "theirs", HAL), wn.shape(sw_named, "decider", ADMIN)
check("the house manager named on the swap is asked for their approval",
      "your approval" in hal_sw["body"] and hal_sw["priority"] == "high" and "tab=mine" in hal_sw["href"], hal_sw)
check("an administrator who decides the house is TOLD, not asked for an approval Requests will not let them give",
      "your approval" not in ada_sw["body"] and ada_sw["priority"] == "normal" and "tab=all" in ada_sw["href"],
      ada_sw)
acc = notice(wn.K_SWAP_ANSWERED, {"from": "Ann Roe", "to": "Ben Left", "manager": "Hal Manager",
                                  "side": "staff", "word": "accepted"}, ref="HO9")
check("and the same for the receiver's yes: 'approve it?' only to the named manager",
      "approve it?" in wn.shape(acc, "theirs", HAL)["title"]
      and "approve it?" not in wn.shape(acc, "decider", ADMIN)["title"])


class _Ctx:
    def __init__(self, now, fail=None):
        self.now, self.fail = now, fail

    def eligible(self, n, person):
        if self.fail:
            raise self.fail
        return False


DAY = datetime(2026, 9, 22, 18, 0, tzinfo=timezone.utc)
NIGHT = datetime(2026, 9, 23, 3, 30, tzinfo=timezone.utc)
got = wn.for_viewers("dsn", co, [ANN, HAL], ctx=_Ctx(DAY, RuntimeError("pool unreadable")))
check("an eligibility read that failed is UNJUDGED — never a 'not theirs' a release would let go",
      isinstance(got[0], wn.Unjudged) and not got[0] and "RuntimeError" in got[0].why, got)
check("and one reader's failure never silences another's answer",
      isinstance(got[1], dict) and got[1]["role"] == "decider", got)
blind = {**HAL, "managers_readable": False}
got = wn.for_viewers("dsn", co, [blind, ADMIN], ctx=_Ctx(DAY))
check("a reader built while the ** rows could not be read is unjudged for what a house manager hears",
      isinstance(got[0], wn.Unjudged) and isinstance(got[1], dict), got)
check("but not for a notice no house manager hears",
      wn.for_viewers("dsn", notice(wn.K_NOT_CHOSEN, {"person": "Hal Manager"}), [blind],
                     ctx=_Ctx(DAY))[0]["role"] == "theirs")
check("the reader says whether the ** rows could be read, and carries the session's role on its own",
      HAL["managers_readable"] is True and HAL["role"] == "staff" and ADMIN["role"] == "admin")
_saved_hm = sr.house_managers
sr.house_managers = lambda dsn, fresh=False: {"readable": False, "why": "mirror down", "by_code": {}}
check("a reader whose ** rows could not be read says so, rather than managing nothing",
      viewer("Hal Manager")["managers_readable"] is False and viewer("")["managers_readable"] is True)
sr.house_managers = _saved_hm
check("a copy shaped in the quiet window carries `quiet` — the page keeps it off the operating system",
      wn.for_viewers("dsn", co, [HAL], ctx=_Ctx(NIGHT))[0]["quiet"] is True
      and wn.for_viewers("dsn", co, [HAL], ctx=_Ctx(DAY))[0]["quiet"] is False)
check("the bell's own read asks the same window",
      wn.for_viewer("dsn", [co], HAL, ctx=_Ctx(NIGHT))[0]["quiet"] is True)

captured = {}


class _Cur:
    def __init__(self):
        self.row = None

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def execute(self, sql, args=None):
        if sql.startswith("INSERT INTO asa_hub_notices"):
            captured["args"] = args
            self.row = {"id": 7, "key": args[0], "kind": args[1], "at": args[2], "location": args[3],
                        "col_iso": args[4], "ref": args[5], "value": args[6], "facts": args[7],
                        "created_at": NOW}

    def fetchone(self):
        return self.row


class _Conn:
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def cursor(self, **k):
        return _Cur()

    def commit(self):
        pass


heard = []
real_connect = wn._connect
wn._connect = lambda dsn: _Conn()
wn.on_publish(heard.append)
# EVERY NOTICE IS A SMART COMMS MESSAGE: its kind's own situation decides whether it is stored at all.
wn.set_situation_probe(None)
unprobed = wn.publish(wn.K_CALL_OFF, key="call_off:SPQ0", dsn="dsn")
wn.set_situation_probe(lambda kind: {"armed": False, "unreadable": "",
                                     "why": f"the situation web_notice_{kind} is switched off in Smart Comms"})
switched_off = wn.publish(wn.K_CALL_OFF, key="call_off:SPQ1", dsn="dsn")
wn.set_situation_probe(lambda kind: (_ for _ in ()).throw(RuntimeError("the lane is away")))
probe_down = wn.publish(wn.K_CALL_OFF, key="call_off:SPQ2", dsn="dsn")
check("A NOTICE KIND IS A SITUATION: a process handed no switch, a kind switched off and a switch that "
      "cannot be read all store nothing — no bell, no device — and say why",
      unprobed["stored"] is False and unprobed.get("off") is True
      and switched_off["stored"] is False and "switched off" in switched_off["why"]
      and probe_down["stored"] is False and "could not be read" in probe_down["why"]
      and "args" not in captured and not heard, [unprobed, switched_off, probe_down])
check("…and the key is not remembered, so catch-up offers the event again once the kind is switched on",
      "call_off:SPQ1" not in wn._SEEN)
wn.set_situation_probe(lambda kind: {"armed": True, "unreadable": "", "why": ""})
got = wn.publish(wn.K_CALL_OFF, key="call_off:SPX", dsn="dsn", location=H1, col_iso="2026-09-23",
                 ref="SPX", value="10P-8A", facts={"caller": "Zed Caller", "reason": "sick kid"})
stored_facts = json.loads(captured["args"][7])
check("publish stores the notice and says so", got.get("stored") is True and got.get("id") == 7, got)
check("A REASON HANDED IN IS DROPPED ON THE WAY IN — it is never stored",
      "reason" not in stored_facts and "sick kid" not in captured["args"][7], stored_facts)
check("the listeners hear the stored notice, once", len(heard) == 1 and heard[0]["key"] == "call_off:SPX")
check("and the newest id moves with it, for the cheap beat", wn.latest_id() == 7)
check("an unknown kind is refused, not rung for everybody",
      wn.publish("gossip", key="g:1", dsn="dsn").get("stored") is False)
check("a notice with no event key is refused", wn.publish(wn.K_CALL_OFF, key="", dsn="dsn").get("stored") is False)
wn._connect = lambda dsn: (_ for _ in ()).throw(RuntimeError("database away"))
down = wn.publish(wn.K_CALL_OFF, key="call_off:SPY", dsn="dsn")
check("a database that is away is a notice NOT STORED, said — never a raise into the act it reports",
      down.get("stored") is False and "not stored" in down.get("why", ""), down)
wn._connect = real_connect
wn._LISTENERS.clear()


print("\nN3/N4 — the events, derived from the rows the relay keeps")

future = (NOW + timedelta(hours=10)).isoformat()
pool_rows = [
    {"ref": "SP1", "kind": "open_shift", "location": H1, "col_iso": "2026-09-23", "value": "8A-4P",
     "house": "48TH (B)", "open_row": "OPEN", "filled_by": "", "state": "closed", "applicants": [],
     "window": {"state": "closed", "opens_at": "2025-08-18T00:00:00+00:00",
                "closes_at": "2025-08-18T00:10:00+00:00"}, "shift_start": future, "called_off_by": ""},
    {"ref": "SP2", "kind": "open_shift", "location": H1, "col_iso": "2026-09-23", "value": "4P-12A",
     "house": "48TH (B)", "open_row": "OPEN 2", "filled_by": "", "state": "open", "applicants": [],
     "window": {"state": "open", "opens_at": NOW.isoformat(),
                "closes_at": (NOW + timedelta(minutes=10)).isoformat()}, "shift_start": future,
     "called_off_by": ""},
    {"ref": "SP3", "kind": "call_off", "location": H1, "col_iso": "2026-09-23", "value": "10P-8A",
     "house": "48TH (B)", "open_row": "Zed Caller", "filled_by": "", "state": "open", "applicants": [],
     "window": {"state": "open", "opens_at": NOW.isoformat(),
                "closes_at": (NOW + timedelta(hours=5)).isoformat()}, "shift_start": future,
     "called_off_by": "Zed Caller", "reason": "sick kid"},
    {"ref": "SP4", "kind": "call_off", "location": H1, "col_iso": "2026-09-21", "value": "10P-8A",
     "house": "48TH (B)", "open_row": "Old Caller", "filled_by": "", "state": "closed", "applicants": [],
     "window": {"state": "closed"}, "shift_start": (NOW - timedelta(days=1)).isoformat(),
     "called_off_by": "Old Caller"},
    {"ref": "SP5", "kind": "open_shift", "location": H1, "col_iso": "2026-09-23", "value": "8A-4P",
     "house": "48TH (B)", "open_row": "OPEN 3", "filled_by": "", "state": "closed",
     "applicants": [{"person": "Ann Roe"}],
     "window": {"state": "closed", "closes_at": (NOW - timedelta(minutes=3)).isoformat()},
     "shift_start": future, "called_off_by": ""},
    {"ref": "SP6", "kind": "open_shift", "location": H1, "col_iso": "2026-09-23", "value": "8A-4P",
     "house": "48TH (B)", "open_row": "OPEN 4", "filled_by": "Ann Roe", "filled_how": "approved",
     "decided_by": "Hal Manager", "state": "filled", "applicants": [],
     "closed_at": (NOW - timedelta(minutes=2)).isoformat(),
     "window": {"state": "closed"}, "shift_start": future, "called_off_by": ""},
]
ev = {e["key"]: e for e in wn.events_from_pool(pool_rows, now=NOW, lookback=SPAN)}
check("a backfilled roster opens nothing and says nothing", "open_shift:SP1" not in ev, sorted(ev))
check("an open shift whose window is open is announced", "open_shift:SP2" in ev)
check("a call-off whose shift is still ahead is announced, with the caller kept for the badges",
      ev.get("call_off:SP3", {}).get("facts", {}).get("caller") == "Zed Caller")
check("and the pool's reason is not carried into the event at all",
      "reason" not in ev.get("call_off:SP3", {}).get("facts", {}) and "sick kid" not in json.dumps(ev))
check("a call-off whose shift has already started is not news", "call_off:SP4" not in ev)
check("a window that closed with somebody on it asks the house manager",
      ev.get("window_closed:SP5", {}).get("facts", {}).get("applicants") == 1)
check("a filled shift is who took it, with how", ev.get("filled:SP6", {}).get("facts", {}).get("how") == "approved")
check("the same pool read twice yields the same keys — one notice per event",
      sorted(e["key"] for e in wn.events_from_pool(pool_rows, now=NOW, lookback=SPAN)) == sorted(ev))

req_rows = [
    {"id": "SRA", "kind": "open_shift", "location": H1, "open_row": "OPEN 2", "col_iso": "2026-09-23",
     "value": "4P-12A", "person": "Ann Roe", "state": "applied", "why": "", "via": "app",
     "created_at": NOW - timedelta(minutes=1), "decided_at": None, "decided_by": "", "ref": ""},
    {"id": "SRB", "kind": "open_shift", "location": H1, "open_row": "OPEN 4", "col_iso": "2026-09-23",
     "value": "8A-4P", "person": "Cy Far", "state": "approved", "why": "assigned by the house manager",
     "via": "assigned", "created_at": NOW - timedelta(minutes=1),
     "decided_at": NOW - timedelta(minutes=1), "decided_by": "Hal Manager", "ref": ""},
    {"id": "SRC", "kind": "ist_approval", "location": H1, "open_row": "Cy Far", "col_iso": "2026-09-23",
     "value": "8A-4P", "person": "Cy Far", "state": "approved", "why": "no IST", "via": "app",
     "created_at": NOW - timedelta(minutes=1), "decided_at": NOW - timedelta(minutes=1),
     "decided_by": "Hal Manager", "ref": "open_shift"},
    {"id": "SRD", "kind": "ist_approval", "location": H1, "open_row": "OPEN 2", "col_iso": "2026-09-23",
     "value": "4P-12A", "person": "Ben Left", "state": "approved", "why": "no IST for 48TH (B)",
     "via": "app", "created_at": NOW - timedelta(minutes=30), "decided_at": NOW - timedelta(minutes=2),
     "decided_by": "Hal Manager", "ref": "open_shift"},
    {"id": "SRE", "kind": "call_off", "location": H1, "open_row": "Zed Caller", "col_iso": "2026-09-23",
     "value": "10P-8A", "person": "Dee Way", "state": "not_chosen", "why": "", "via": "app",
     "created_at": NOW - timedelta(days=1), "decided_at": NOW - timedelta(minutes=1),
     "decided_by": "Hal Manager", "ref": ""},
]
rev = {e["key"]: e for e in wn.events_from_requests(req_rows, now=NOW, lookback=SPAN, ref_of=sr.ref_of)}
check("an application is announced", "application:SRA" in rev)
check("an assignment is NOT an application nobody made", "application:SRB" not in rev, sorted(rev))
check("it is the decision it is, said as assigned", rev.get("decided:SRB", {}).get("facts", {}).get("how") == "assigned")
check("a training row a manager's own act wrote already approved was never waiting on anybody",
      "training:SRC" not in rev and "training_decided:SRC" not in rev)
check("a training row that waited is announced, and so is its answer",
      "training:SRD" in rev and "training_decided:SRD" in rev)
check("an application made yesterday is not re-announced; its decision today is",
      "application:SRE" not in rev and "not_chosen:SRE" in rev)
check("the shift is named by the pool's own ref, which carries no name",
      rev["not_chosen:SRE"]["ref"] == sr.ref_of(H1, "Zed Caller", "2026-09-23")
      and "Zed" not in rev["not_chosen:SRE"]["ref"])
check("and the roster row a call-off came from is not stored with any event at all",
      all("open_row" not in e["facts"] and "Zed" not in json.dumps(e["facts"])
          for e in list(rev.values()) if e["kind"] != wn.K_CALL_OFF)
      and all("open_row" not in e["facts"] for e in ev.values()), sorted(rev))

hand = [
    {"id": "HO1", "location": H1, "col_iso": "2026-09-23", "value": "8A-4P", "from_staff": "Ann Roe",
     "to_staff": "Ben Left", "house_manager": "Hal Manager", "created_at": NOW - timedelta(minutes=5),
     "staff_state": "declined", "staff_at": NOW - timedelta(minutes=1), "manager_state": "pending",
     "manager_at": None, "state": "dead", "why": "the staff member declined",
     "closed_at": NOW - timedelta(minutes=1)},
    {"id": "HO2", "location": H1, "col_iso": "2026-09-24", "value": "8A-4P", "from_staff": "Ann Roe",
     "to_staff": "Ben Left", "house_manager": "", "created_at": NOW - timedelta(days=2),
     "staff_state": "accepted", "staff_at": NOW - timedelta(days=2), "manager_state": "approved",
     "manager_at": NOW - timedelta(minutes=1), "state": "dead",
     "why": "the shift changed while it was being agreed (8A-4P → 9A-5P)",
     "closed_at": NOW - timedelta(minutes=1)},
]
hev = {e["key"]: e for e in wn.events_from_handoffs(hand, now=NOW, lookback=SPAN)}
check("a swap offered, and its answer, are two notices", "swap_offered:HO1" in hev and "swap_staff:HO1" in hev)
check("a swap that died of a NO is announced by the no, not twice", "swap_ended:HO1" not in hev, sorted(hev))
check("a swap that died for another reason says why",
      "changed while it was being agreed" in hev.get("swap_ended:HO2", {}).get("facts", {}).get("why", ""))
check("an offer made two days ago is not re-announced", "swap_offered:HO2" not in hev)
reworded = [
    {**hand[0], "id": "HO3", "why": "Ben Left passed"},
    {**hand[0], "id": "HO4", "staff_state": "accepted", "manager_state": "declined",
     "manager_at": NOW - timedelta(minutes=1), "why": "the house manager did not approve (Hal Manager)"},
]
rev_no = {e["key"] for e in wn.events_from_handoffs(reworded, now=NOW, lookback=SPAN)}
check("a no in the transfer's own words is still announced once, by the answer",
      {"swap_staff:HO3", "swap_manager:HO4"} <= rev_no
      and "swap_ended:HO3" not in rev_no and "swap_ended:HO4" not in rev_no, sorted(rev_no))
third = [
    {**hand[0], "id": "HO5", "staff_state": "accepted", "manager_state": "approved",
     "manager_at": NOW - timedelta(minutes=3), "director_state": "approved",
     "director_at": NOW - timedelta(minutes=1), "director_by": "Dee Direct", "state": "done",
     "why": "", "closed_at": NOW - timedelta(minutes=1)},
    {**hand[0], "id": "HO6", "staff_state": "accepted", "manager_state": "approved",
     "manager_at": NOW - timedelta(minutes=3), "director_state": "declined",
     "director_at": NOW - timedelta(minutes=1), "director_by": "Dee Direct", "state": "dead",
     "why": "the director did not approve (Dee Direct)", "closed_at": NOW - timedelta(minutes=1)},
]
tev = {e["key"]: e for e in wn.events_from_handoffs(third, now=NOW, lookback=SPAN)}
check("THE THIRD CONSENT IS A NOTICE LIKE THE OTHER TWO: the director's answer, by name",
      tev.get("swap_director:HO5", {}).get("facts", {}).get("side") == "director"
      and tev["swap_director:HO5"]["facts"].get("by") == "Dee Direct"
      and tev["swap_director:HO5"]["facts"].get("word") == "approved"
      and "swap_director:HO6" in tev, sorted(tev))
check("…and a swap a director said no to is announced by that no, not twice",
      "swap_ended:HO6" not in tev and "swap_done:HO5" in tev, sorted(tev))
shaped_dir = wn.shape({**tev["swap_director:HO5"], "id": 1, "published_at": ""}, "company", ADMIN)
shaped_no = wn.shape({**tev["swap_director:HO6"], "id": 2, "published_at": ""}, "company", ADMIN)
check("…and it reads as the director's answer, never as the house manager's",
      shaped_dir["title"].startswith("Dee Direct approved Ann Roe → Ben Left")
      and "as director" in shaped_dir["title"] and "house manager" not in shaped_dir["title"]
      and shaped_no["title"].startswith("Dee Direct did not approve"),
      [shaped_dir["title"], shaped_no["title"]])
check("the minute's read picks up a swap whose director answered since the last one",
      "OR director_at > %s" in (SERVER / "web_notices.py").read_text(encoding="utf-8"))

board = [
    {"row_kind": "shift", "id": "S1", "person": "Ben Left", "house": "ABD1711", "day": "2026-09-22",
     "shift_code": "2P-10P", "verdict": "no_punch", "minutes": 75, "checked_at": NOW.isoformat(),
     "shift_at": (NOW - timedelta(minutes=75)).isoformat(), "shift_end": future, "late_call": False},
    {"row_kind": "shift", "id": "S2", "person": "Cy Far", "house": "ABD1711", "day": "2026-09-22",
     "shift_code": "6A-2P", "verdict": "not_entered_yet", "checked_at": NOW.isoformat(),
     "shift_at": (NOW - timedelta(hours=8)).isoformat(), "shift_end": NOW.isoformat(), "late_call": False},
    {"row_kind": "shift", "id": "S3", "person": "Dee Way", "house": "ABD1711", "day": "2026-09-22",
     "shift_code": "8P-8A", "verdict": "upcoming", "told_at": NOW.isoformat(),
     "shift_at": (NOW + timedelta(hours=2)).isoformat(), "shift_end": future, "late_call": True},
]
bev = {e["key"]: e for e in wn.events_from_board(board, now=NOW, lookback=SPAN)}
check("the board's no_punch is a no-call no-show", "no_show:S1" in bev)
check("`not_entered_yet` is NOT a no-call — most entries are typed after the shift", "no_show:S2" not in bev)
check("a late call is news while its shift has not ended", "late_call:S3" in bev)
claims = [{"location": H1, "open_row": "OPEN 4", "col_iso": "2026-09-23", "value": "8A-4P",
           "claimed_by": "Ann Roe", "claimed_via": "approved", "claimed_at": NOW - timedelta(minutes=2)}]
cev = wn.events_from_claims(claims, now=NOW, lookback=SPAN, ref_of=sr.ref_of)
check("the claims ledger and the pool name one filled shift by one key",
      cev and cev[0]["key"] == f"filled:{sr.ref_of(H1, 'OPEN 4', '2026-09-23')}", cev)


print("\nN6 — the wiring")

svc = (SERVER / "snapshot_service.py").read_text(encoding="utf-8")
tree = ast.parse(svc)
check("the relay imports the notices under a guard — a broken module answers 503, it never takes "
      "the relay down",
      "try:\n    import web_notices\nexcept Exception" in svc)
check("a stream is tagged for notices only when the tab says it reads them",
      'queue.notices = x_hub_notices.strip() == "1"' in svc)
fn = next(n for n in ast.walk(tree) if isinstance(n, ast.FunctionDef) and n.name == "_publish_notice_frame")
check("and a notice frame is handed only to such a tab",
      'getattr(q, "notices", False)' in ast.get_source_segment(svc, fn))
check("the cheap beat carries the newest notice id", '"notices": web_notices.latest_id()' in svc)
check("the bell's two doors exist, behind the Requests reader",
      '@app.get("/hub-lanes/notices")' in svc and '@app.post("/hub-lanes/notices/read")' in svc
      and "await _requests_viewer(authorization)" in ast.get_source_segment(
          svc, next(n for n in ast.walk(tree) if isinstance(n, ast.AsyncFunctionDef)
                    and n.name == "lane_notices")))
check("the notices' loop is asa-hub-app's (app/notice_clock.py): the relay starts none, and hands a notice its own "
      "clocks store to the app to carry",
      "asyncio.create_task(_notices_loop())" not in svc and "web_notices.on_publish(_notice_fanout)" in svc
      and '_live_forward("/live/wake", {"notice_ids"' in svc)
def _body_of(name):
    return ast.get_source_segment(svc, next(n for n in ast.walk(tree)
                                            if isinstance(n, (ast.AsyncFunctionDef, ast.FunctionDef))
                                            and n.name == name))


check("every reader the relay builds for a notice carries the alerts they turned off in Settings, from the config "
      "lane — the stream, the pushes and the bell alike",
      all('who["alerts_off"] = _lane_alerts_off(uid)' in _body_of(f) for f in ("_notice_viewer", "_account_viewer"))
      and '"alerts_off": _lane_alerts_off(actor[1])' in _body_of("lane_notices")
      and '"alert_receive_off"' in _body_of("_lane_alerts_off") and '_config_lane_for("")' in _body_of("_lane_alerts_off"))


for door in ("lane_shift_requests_apply", "lane_shift_requests_withdraw", "lane_shift_requests_decide",
             "lane_shift_requests_training", "lane_housecal_claim", "lane_handoff_offer",
             "lane_handoff_answer", "lane_handoff_withdraw", "lane_cal_builder_call_off",
             "lane_cal_builder_house_publish"):
    body = _body_of(door)
    check(f"the door {door} wakes the notices at once, exactly once", body.count("_notices_wake()") == 1)
    check(f"the door {door} rings the calendars' name, so an open grid redraws without a refresh",
          "_housecal_rang()" in body)
check("the master's push into the house tabs wakes them once, and not on a dry run",
      _body_of("lane_cal_builder_publish_houses").count("_notices_wake()") == 1
      and "if not dry_run:" in _body_of("lane_cal_builder_publish_houses"))
for door in ("lane_housecal_cell", "lane_housecal_move"):
    check(f"the closed door {door} writes nothing, so it wakes nothing",
          "_housecal_edits_moved(" in _body_of(door) and "_notices_wake()" not in _body_of(door))
check("the reply ear wakes them after a pass that acted — an application or a consent by text",
      _body_of("_sms_ears_loop").count("_notices_wake()") == 1)
check("the pool's sweep wakes them after the swaps it finished and after the shifts it opened",
      _body_of("_shift_pool_sweep").count("_notices_wake()") == 2)
check("the calendars ring by ONE name — no second helper rings another",
      "_housecal_changed" not in svc and svc.count('HOUSECAL_EVENT = "housecal"') == 1)
check("the relay reads the switch at the moment a notice is stored",
      "web_notices.set_hold_probe(" in svc)
check("the hold probe's word is the switch's word", "set_hold_probe(lambda: bool(_web_switch().get(\"on\")))" in svc)
check("the relay asks each kind's own situation, carried on the config lane, before it stores a notice",
      "web_notices.set_situation_probe(lane_gate.notice_state)" in svc)
_seeds_gs = (ROOT / "apps-script" / "NoticeSituations.gs").read_text(encoding="utf-8")
_seeded = set(re.findall(r"^\s*\['([a-z_]+)',", _seeds_gs, re.M))
check("ONE SITUATION PER NOTICE KIND: every kind the relay's catalogue declares is seeded in Smart Comms, "
      "and nothing else is",
      _seeded == set(wn.CATALOGUE), sorted(_seeded ^ set(wn.CATALOGUE)))
check("…and every one arrives OFF, and the config lane carries their switches beside the gates",
      "enabled: 'no'" in _seeds_gs and "enabled: 'yes'" not in _seeds_gs
      and "notice_situations" in (ROOT / "apps-script" / "Bundle.gs").read_text(encoding="utf-8")
      and "hubNoticeSeeds_()" in (ROOT / "apps-script" / "SmartComms.gs").read_text(encoding="utf-8"))
for suite in ("test-psi-anywhere.py", "test-hotline-fast.py", "test-hotline-lanes.py"):
    src = (HERE.parent / suite).read_text(encoding="utf-8")
    mods = ast.literal_eval(next(n.value for n in ast.parse(src).body if isinstance(n, ast.Assign)
                                 and any(getattr(t, "id", "") == "MODULES" for t in n.targets)))
    check(f"{suite} ships the checkout's web_notices into the container", "web_notices" in mods)
pkg = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
check("npm run check runs this file",
      "npm run test:web-notices" in pkg["scripts"]["check"]
      and pkg["scripts"].get("test:web-notices") == "python3 tools/test-web-notices.py")
chat = (ROOT / "src/lib/chatPresence.ts").read_text(encoding="utf-8")
frames = (ROOT / "src/lib/streamFrames.ts").read_text(encoding="utf-8")
check("the browser says it reads notices, and takes a notice frame BEFORE the chat listeners",
      "'X-Hub-Notices': '1'" in chat
      and 0 < chat.find("route === 'notice'") < chat.find("for (const fn of listeners) fn(msg)")
      and 0 < chat.find("if (route !== 'chat') continue") < chat.find("for (const fn of listeners) fn(msg)")
      and "if (kind === 'notice') return 'notice'" in frames)
store = (ROOT / "src/stores/useNotificationStore.ts").read_text(encoding="utf-8")
check("the bell no longer reads the unscoped `notifications` sheet", "api.list" not in store)


print("\nN8 — test mode is over the bell too: nothing reaches a person")

wn_src = (SERVER / "web_notices.py").read_text(encoding="utf-8")
check("the module no longer says in-app notices escape the switch",
      "not governed by the sending dial or the quiet window" not in wn_src
      and "AND NOT held_test" in wn_src)
fan_src = ast.get_source_segment(svc, next(n for n in ast.walk(tree) if isinstance(n, ast.AsyncFunctionDef)
                                           and n.name == "_notice_fan"))
check("a stored notice is judged against the switch before a single frame is shaped",
      0 < fan_src.find("_web_switch()") < fan_src.find("_notice_frames"))
check("while it is on the notice goes to the mockup, and the function returns before any frame",
      fan_src.find("_notice_hold") < fan_src.find("_notice_frames")
      and "return" in fan_src[fan_src.find("_notice_hold"):fan_src.find("_notice_frames")])
inbox_door = ast.get_source_segment(svc, next(n for n in ast.walk(tree) if isinstance(n, ast.AsyncFunctionDef)
                                              and n.name == "lane_notices"))
check("the bell door asks the switch and tells the inbox it is held",
      "_web_switch()" in inbox_door and "held=held" in inbox_door)
check("the inbox takes `held` and, holding, answers with no notice at all",
      "held: str = \"\"" in wn_src and '"notices": [], "unread": 0' in wn_src)
check("the browser drops every company row, toast and operating-system copy when the bell says held",
      "hold: (why) =>" in store and "closeWorkerNotices('all')" in store and "if (box.held)" in store)


LANE = '''
import json, os, sys
from datetime import datetime, timedelta, timezone
sys.path.insert(0, HERE_DIR)
import psycopg2, psycopg2.extras
import lane_schema
import house_cal_live, shift_handoff
import calendar_builder_houses as cbh
import shift_requests as sr
import web_notices as wn
import time_off
# every notice kind's situation switched on: this lane is about who hears what
wn.set_situation_probe(lambda kind: {"armed": True, "unreadable": "", "why": ""})
# no Time Off house: the verdict never reads the live one
time_off.use_house(time_off.NoHouse())
# …so a swap's directors are stood in; the list itself is held by test-shift-transfer
shift_handoff.directors_for = lambda dsn: {"readable": True, "names": ["Dee Direct"],
                                           "why": "the director Dee Direct approves"}

DSN = os.environ["HUB_SNAPSHOT_PG_DSN"]
# a schema per run, so concurrent checkouts never collide
ROOMS = lane_schema.Rooms(DSN, "web-notices")
SCHEMA = ROOMS.name()
OUT = {}
H1 = "CAN - 48TH (B) - ABD1711"
H2 = "CAN - JH - ABD2704"
today = datetime.now(sr.OHIO).date()
OLD = (today - timedelta(days=3)).isoformat()
D1 = (today + timedelta(days=1)).isoformat()
D2 = (today + timedelta(days=2)).isoformat()
ISOS = [OLD, D1, D2]

# IST and managers stood in (everybody trained, Hal manages 48TH (B)), so only the rule decides
# the IST settings as a read that landed, holding the shipped values
import ist_config
ist_config.pin(dict(ist_config.SHIPPED))
EVERY = {"done": 1, "owed": 0, "clients": [], "owed_for": []}
NAMES = ("Ann Roe", "Ben Left", "Cy Far", "Dee Way", "Zed Caller", "Hal Manager")
sr.ist_index = lambda dsn, **k: {
    "readable": True, "why": "", "rows": 0, "source": "test",
    "by_person": {sr.fold(n): {"ABD1711": dict(EVERY), "ABD2704": dict(EVERY)} for n in NAMES}}
sr.house_managers = lambda dsn, fresh=False: {
    "readable": True, "why": "", "by_code": {"ABD1711": {"name": "Hal Manager", "phone": "", "house": H1}}}
sr.call_off_shifts = lambda dsn, **k: []
BOARD = {"rows": []}
sr._attendance_board = lambda: BOARD


def grid(rows):
    return {"cols": [{"iso": i} for i in ISOS],
            "rows": [{"employee": e, "cells": [{"text": t} for t in cs]} for e, cs in rows]}


def viewer(name, role="staff", types_=""):
    return sr.viewer(T, name=name, role=role, types=types_)


def titles(who, uid):
    box = wn.inbox(T, who=who, uid=uid)
    return [(n["kind"], n["role"], n["title"] + " | " + n["body"]) for n in box["notices"]], box


ROOMS.make()
T = ROOMS.path(SCHEMA)
try:
    with psycopg2.connect(T) as c, c.cursor() as cur:
        cur.execute("CREATE TABLE asa_house_calendar_live (location TEXT PRIMARY KEY, "
                    "grid JSONB, updated_at TIMESTAMPTZ DEFAULT now())")
        cur.execute(house_cal_live.OVERRIDES_DDL)
        cur.execute(house_cal_live.CLAIMS_DDL)
        cur.execute(shift_handoff.HANDOFFS_DDL)
        cur.execute(shift_handoff.OPEN_INDEX_DDL)
        for stmt in sr.DDL:
            cur.execute(stmt)
        for stmt in wn.DDL:
            cur.execute(stmt)
        # Ann, Ben and Zed are 48TH (B)'s regulars; Ben already works JH on D1.
        GRIDS = {
            H1: grid([
                ("OPEN", ["", "4P-12A", ""]),
                ("Ann Roe", ["8A-4P", "", "8A-4P"]),
                ("Ben Left", ["8A-4P", "", ""]),
                ("Zed Caller", ["8A-4P", "", "10P-8A"]),
                ("Cy Far", ["", "", ""]),
            ]),
            H2: grid([
                ("Ben Left", ["", "3P-11P", ""]),
            ]),
        }
        for loc, g in GRIDS.items():
            cur.execute("INSERT INTO asa_house_calendar_live (location, grid) VALUES (%s,%s)",
                        (loc, psycopg2.extras.Json(g)))
        c.commit()
    # every table the code reads is the lane's before its first read, the notices included
    OUT["owned"] = lane_schema.own_shift_lane(T, SCHEMA, HERE_DIR)
    # a stand-in workbook: a test schema never reaches the live one
    cbh.use_workbook(cbh.MemoryWorkbook.from_grids(GRIDS))

    sr.forget_estate()
    sr.sweep(T)
    now = datetime.now(timezone.utc)
    with psycopg2.connect(T) as c, c.cursor() as cur:
        # a day published NOW: its OPEN row's ten minutes are running
        cur.execute("UPDATE asa_shift_pool SET opened_at=%s", (now,))
        # and Zed called off tomorrow-but-one's night, with a reason for the 5558
        cur.execute(
            "INSERT INTO asa_shift_pool (location, open_row, col_iso, kind, value, opened_at, "
            "shift_start, shift_end, called_off_by, reason, ref) VALUES "
            "(%s,%s,%s,'call_off','10P-8A',%s,%s,%s,'Zed Caller','sick kid',%s)",
            (H1, "Zed Caller", D2, now, sr.span_of(D2, "10P-8A")[0], sr.span_of(D2, "10P-8A")[1],
             sr.ref_of(H1, "Zed Caller", D2)))
        c.commit()

    first = wn.catch_up(T)
    OUT["first_kinds"] = first["by_kind"]
    OUT["first_unreadable"] = first["unreadable"]
    OUT["second_published"] = wn.catch_up(T)["published"]
    with psycopg2.connect(T) as c, c.cursor() as cur:
        cur.execute("SELECT count(*) FROM asa_hub_notices WHERE facts ? 'reason' "
                    "OR facts::text LIKE '%%sick kid%%'")
        OUT["reason_rows"] = cur.fetchone()[0]
    OUT["dup"] = wn.publish(wn.K_OPEN_SHIFT, key=f"open_shift:{sr.ref_of(H1, 'OPEN', D1)}", dsn=T)

    ADMIN, HAL = viewer("Ada Admin", "admin", "ADMINISTRATOR"), viewer("Hal Manager")
    ANN, BEN, CY, ZED = viewer("Ann Roe"), viewer("Ben Left"), viewer("Cy Far"), viewer("Zed Caller")
    OUT["ann"], box = titles(ANN, "u-ann")
    OUT["ann_unread"] = box["unread"]
    OUT["seq_matches"] = box["seq"] == wn.latest_id()
    # test mode on: the same bell, held — not one notice in the answer
    OUT["ann_held"] = wn.inbox(T, who=ANN, uid="u-ann", held="test mode")
    OUT["admin_held"] = wn.inbox(T, who=viewer("Ada Admin", "admin", "ADMINISTRATOR"), uid="u-admin",
                                 held="test mode")
    OUT["ben"], _ = titles(BEN, "u-ben")
    OUT["cy"], _ = titles(CY, "u-cy")
    OUT["zed"], _ = titles(ZED, "u-zed")
    OUT["hal"], _ = titles(HAL, "u-hal")
    OUT["admin"], _ = titles(ADMIN, "u-admin")

    # an application reaches the manager; the applicant is no longer invited
    sr.apply_for(T, location=H1, open_row="OPEN", col_iso=D1, person="Ann Roe")
    OUT["after_apply"] = wn.catch_up(T)["by_kind"]
    OUT["hal_after_apply"], _ = titles(HAL, "u-hal")
    OUT["ben_after_apply"], _ = titles(BEN, "u-ben")
    OUT["ann_after_apply"], _ = titles(ANN, "u-ann")

    # the manager decides after the window closes
    with psycopg2.connect(T) as c, c.cursor() as cur:
        cur.execute("UPDATE asa_shift_pool SET opened_at = now() - interval '6 hours' "
                    "WHERE open_row = 'OPEN'")
        c.commit()
    sr.decide(T, location=H1, open_row="OPEN", col_iso=D1, person="Ann Roe", by="Hal Manager")
    OUT["after_decide"] = wn.catch_up(T)["by_kind"]
    OUT["ann_after_decide"], _ = titles(ANN, "u-ann")

    # a swap: Ann offers her D2 shift to Cy
    shift_handoff.offer(T, location=H1, col_iso=D2, from_staff="Ann Roe", to_staff="Cy Far",
                        offered_by="Ann Roe")
    OUT["after_swap"] = wn.catch_up(T)["by_kind"]
    OUT["cy_after_swap"], _ = titles(CY, "u-cy")
    OUT["ben_after_swap"], _ = titles(BEN, "u-ben")

    # the punch board sees Ben missing at 48TH (B)
    BOARD["rows"] = [{"row_kind": "shift", "id": "S-BEN", "person": "Ben Left", "house": "ABD1711",
                      "day": today.isoformat(), "shift_code": "8A-4P", "verdict": "no_punch",
                      "minutes": 70, "checked_at": now.isoformat(),
                      "shift_at": (now - timedelta(minutes=70)).isoformat(),
                      "shift_end": (now + timedelta(hours=6)).isoformat(), "late_call": False}]
    OUT["after_board"] = wn.catch_up(T)["by_kind"]
    OUT["hal_board"] = [t for t in titles(HAL, "u-hal")[0] if t[0] == "no_call_no_show"]
    OUT["ben_board"] = [t for t in titles(BEN, "u-ben")[0] if t[0] == "no_call_no_show"]

    # one notice fanned out to several readers at once, as the stream does
    shaped = wn.for_viewers(T, {"id": 0, "key": "x", "kind": wn.K_NO_SHOW, "at": "", "location": H1,
                                "col_iso": today.isoformat(), "ref": "", "value": "8A-4P",
                                "facts": {"person": "Ben Left"}, "published_at": ""},
                            [HAL, BEN, ADMIN])
    OUT["fan"] = [None if s is None else s["role"] for s in shaped]

    # reads: Ann reads one, clears another
    ann_box = wn.inbox(T, who=ANN, uid="u-ann")
    ids = [n["id"] for n in ann_box["notices"]]
    OUT["ann_before_marks"] = [ann_box["unread"], len(ids)]
    wn.mark_read(T, uid="u-ann", ids=ids[:1])
    wn.mark_read(T, uid="u-ann", ids=ids[1:2], dismiss=True)
    after = wn.inbox(T, who=ANN, uid="u-ann")
    OUT["ann_after_marks"] = [after["unread"], len(after["notices"]),
                              ids[1] in [n["id"] for n in after["notices"]]]
    OUT["ben_untouched"] = wn.inbox(T, who=BEN, uid="u-ben")["unread"]
    OUT["since"] = len(wn.inbox(T, who=ANN, uid="u-ann", since=wn.latest_id())["notices"])

    # paging finds exactly what one read does; a cut scan says `truncated`
    whole = wn.inbox(T, who=ANN, uid="u-ann")
    wn.INBOX_PAGE = 2
    paged = wn.inbox(T, who=ANN, uid="u-ann")
    OUT["paged_same"] = [n["id"] for n in paged["notices"]] == [n["id"] for n in whole["notices"]] \
        and paged["unread"] == whole["unread"] and paged["truncated"] is False and len(whole["notices"]) >= 2
    wn.INBOX_SCAN_MAX = 2
    OUT["truncated"] = wn.inbox(T, who=ADMIN, uid="u-admin")["truncated"]
    wn.INBOX_PAGE, wn.INBOX_SCAN_MAX = 400, 6000

    # a notice stored under test mode never enters a bell; an unreadable probe is on
    wn.set_hold_probe(lambda: True)
    held_one = wn.publish(wn.K_NOT_CHOSEN, key="not_chosen:HELD1", dsn=T, location=H1, col_iso=D1,
                          ref="SPHELD1", value="4P-12A", facts={"person": "Ann Roe"})
    wn.set_hold_probe(lambda: (_ for _ in ()).throw(RuntimeError("lane unreadable")))
    held_two = wn.publish(wn.K_NOT_CHOSEN, key="not_chosen:HELD2", dsn=T, location=H1, col_iso=D1,
                          ref="SPHELD2", value="4P-12A", facts={"person": "Ann Roe"})
    wn.set_hold_probe(lambda: False)
    free_one = wn.publish(wn.K_NOT_CHOSEN, key="not_chosen:FREE1", dsn=T, location=H1, col_iso=D1,
                          ref="SPFREE1", value="4P-12A", facts={"person": "Ann Roe"})
    wn.set_hold_probe(None)
    ids = [n["id"] for n in wn.inbox(T, who=ANN, uid="u-ann")["notices"]]
    OUT["held_out"] = [held_one.get("id") in ids, held_two.get("id") in ids, free_one.get("id") in ids]
    with psycopg2.connect(T) as c, c.cursor() as cur:
        cur.execute("SELECT key, held_test FROM asa_hub_notices WHERE key LIKE 'not_chosen:%%' ORDER BY key")
        OUT["held_rows"] = [list(r) for r in cur.fetchall()]
finally:
    OUT["rooms"] = ROOMS.close()
print("LANE_RESULT " + json.dumps(OUT, default=str))
'''


def _lane_in_container() -> dict | None:
    # every module the roots reach, and the IST settings reader's declaration, in a folder of this run's own
    sources = lane_schema.with_imports(SERVER, (
        "web_notices", "shift_requests", "shift_handoff", "house_cal_live", "shift_slices",
        "calendar_builder_slices", "house_directory", "psi_reminders", "badge_follows", "effective_roster",
        "calendar_builder_houses", "calendar_builder_write", "ist_config", "time_off", "redaction"))
    return lane_schema.run_in(CONTAINER, lane_schema.script(sources, "HERE_DIR = LANE_DIR\n" + LANE, "web-notices"))


def kinds(rows):
    return sorted({r[0] for r in rows})


def said(rows, kind):
    return " ".join(r[2] for r in rows if r[0] == kind)


print("\nN1/N2/N3/N5 — the whole lane, against a real database")
lane = _lane_in_container()
if lane is None:
    print("  (skipped — no docker here to reach a relay container)")
    print("  NOTE: the pure half above still ran; the database half did not.")
elif lane.get("crash"):
    check("the lane ran to its end", False, lane.get("trace") or lane["crash"])
else:
    owned = (lane.get("owned") or {}).get("lane") or {}
    check("every table the lane reads resolves in its own schema before the first read — the notices "
          "and their reads included, never public's",
          {"asa_hub_notices", "asa_hub_notice_reads"} <= set(owned)
          and all(str(s).startswith("hub_test_web_notices_") for s in owned.values()), lane.get("owned"))
    check("the minute's catch-up announced the open shift and the call-off, reading every source",
          lane["first_kinds"].get("open_shift") == 1 and lane["first_kinds"].get("call_off") == 1
          and lane["first_unreadable"] == [], lane["first_kinds"])
    check("N3: the second minute announces nothing again", lane["second_published"] == 0, lane)
    check("N3: another road announcing the same event is the same notice",
          lane["dup"].get("duplicate") is True, lane["dup"])
    check("N2: no stored notice carries the call-off's reason", lane["reason_rows"] == 0, lane["reason_rows"])
    check("N1: a regular with nothing in the way is invited to both",
          kinds(lane["ann"]) == ["call_off", "open_shift"]
          and {r[1] for r in lane["ann"]} == {"invited"}, lane["ann"])
    check("N1: a regular whose other shift crosses the open one is not invited to it",
          "open_shift" not in kinds(lane["ben"]), lane["ben"])
    check("N1: somebody who is not a regular is not invited inside the ten minutes",
          "open_shift" not in kinds(lane["cy"]), lane["cy"])
    check("N1: but the call-off is open to all staff, and reaches them",
          "call_off" in kinds(lane["cy"]), lane["cy"])
    check("N2: the person who called off is never invited to their own shift",
          "call_off" not in kinds(lane["zed"]), lane["zed"])
    check("N2: no caregiver's copy names who called off, nor why",
          all("Zed" not in r[2] and "sick" not in r[2] for who in ("ann", "ben", "cy") for r in lane[who]),
          [lane["ann"], lane["cy"]])
    check("N2: the house manager with a STAFF badge wears HM for his house: told it is his to decide, "
          "with the caller's name — and never the reason",
          any(r[0] == "call_off" and r[1] in ("decider", "invited") and "Zed" in r[2] and "sick" not in r[2]
              and ("then you decide" in r[2] or "you decide when applications close" in r[2])
              for r in lane["hal"]), lane["hal"])
    check("N2: the whole-company badge reads who called off — and still never why",
          "Zed Caller" in said(lane["admin"], "call_off") and "sick" not in said(lane["admin"], "call_off"),
          lane["admin"])
    check("N5: the bell counts what is unread, and its seq is the relay's own",
          lane["ann_unread"] == 2 and lane["seq_matches"] is True, lane)
    for who in ("ann_held", "admin_held"):
        held = lane[who]
        check(f"N8: test mode on — {who.split('_')[0]}'s bell carries NO notice, says held, and still "
              "tells the number a polling tab needs",
              held["notices"] == [] and held["unread"] == 0 and held["held"] == "test mode"
              and held["seq"] >= 1, held)

    check("an application is announced", lane["after_apply"].get("application") == 1, lane["after_apply"])
    check("N1: the house manager hears it, by name, as the one who decides",
          any(r[0] == "application" and r[1] == "decider" and "Ann Roe" in r[2]
              for r in lane["hal_after_apply"]), lane["hal_after_apply"])
    check("N1: another caregiver does not", "application" not in kinds(lane["ben_after_apply"]),
          lane["ben_after_apply"])
    check("N1: and Ann is no longer invited to a shift she is already on",
          "open_shift" not in kinds(lane["ann_after_apply"]), lane["ann_after_apply"])
    check("the decision is announced, and the shift it filled",
          lane["after_decide"].get("decided") == 1, lane["after_decide"])
    check("N1: Ann is told, in the second person, that the shift is hers",
          any(r[0] == "decided" and r[1] == "theirs" and "You have the shift" in r[2]
              for r in lane["ann_after_decide"]), lane["ann_after_decide"])
    check("a swap offered is announced", lane["after_swap"].get("swap_offered") == 1, lane["after_swap"])
    check("N1: the receiver is asked, by the giver's name",
          any(r[0] == "swap_offered" and "Ann Roe wants to give you a shift" in r[2]
              for r in lane["cy_after_swap"]), lane["cy_after_swap"])
    check("N1: a third caregiver hears nothing of it", "swap_offered" not in kinds(lane["ben_after_swap"]))
    check("the punch board's no-call is announced, placed at its house by the code",
          lane["after_board"].get("no_call_no_show") == 1, lane["after_board"])
    check("N1: the house manager hears the no-call", len(lane["hal_board"]) == 1, lane["hal_board"])
    check("N1: the caregiver it is about does not", lane["ben_board"] == [], lane["ben_board"])
    check("one notice fanned out: the house manager and the admin hear it, the caregiver does not",
          lane["fan"] == ["decider", None, "decider"], lane["fan"])
    before, after = lane["ann_before_marks"], lane["ann_after_marks"]
    check("N5: one notice read and one cleared leave two fewer unread — the cleared one is not "
          "counted as waiting either",
          before[0] >= 2 and after[0] == before[0] - 2, (before, after))
    check("N5: a cleared notice leaves the bell for good",
          after[1] == before[1] - 1 and after[2] is False, (before, after))
    check("N5: one person's marks are not another's", lane["ben_untouched"] >= 1, lane["ben_untouched"])
    check("N5: asking only for what is newer than the newest returns nothing", lane["since"] == 0)
    check("N5: a bell judged a page at a time finds exactly what one big read finds",
          lane["paged_same"] is True, lane.get("paged_same"))
    check("N5: a scan cut short says `truncated`, never passing a part off as the whole",
          lane["truncated"] is True, lane.get("truncated"))
    check("N8: a notice stored while test mode was on — or while the switch could not be read — never "
          "enters a bell afterwards; one stored with it off does",
          lane["held_out"] == [False, False, True], lane.get("held_out"))
    check("N8: the store keeps the mark on the row itself",
          lane["held_rows"] == [["not_chosen:FREE1", False], ["not_chosen:HELD1", True],
                                ["not_chosen:HELD2", True]], lane.get("held_rows"))


print(f"\n{results['ok']} ok, {len(results['failed'])} failed")
for name in results["failed"]:
    print("  FAILED:", name)
sys.exit(1 if results["failed"] else 0)
