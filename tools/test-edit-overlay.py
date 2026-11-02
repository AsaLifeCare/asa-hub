#!/usr/bin/env python3
"""THE EDIT OVERLAY, asserted against the real module (server/edit_overlay.py): the plan, the store on disk, every
reader's layer, the door's answer settling it, the retirement, and the pace the queue keeps with the sheets."""
from __future__ import annotations

import json
import os
import shutil
import stat
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "server"))

import edit_overlay as eo  # noqa: E402

FAILED: list[str] = []
PASSED = 0


def check(name: str, ok: bool, detail: object = "") -> None:
    global PASSED
    if ok:
        PASSED += 1
    else:
        FAILED.append(f"{name} — {detail}")


class Clock:
    def __init__(self, t: float = 1_800_000_000.0) -> None:
        self.t = t

    def __call__(self) -> float:
        return self.t


AUTHOR = {"uid": "u-ann", "name": "Ann Lee"}
EDIT = {"home_name": "CAN - JH - ABD2704", "address": "12 Elm St NW, Canton", "region": "Canton", "telephone": "",
        "manager_name": "", "manager_phone": "", "calendar_link": "", "abbreviation": "ABD2704", "thumbnail_url": ""}
NOTES = [{"id": "HN_1", "house": "ABD2704", "client_key": "", "priority": "normal", "details": "Fix the door",
          "state": "open", "by": "Ann Lee", "at": "2026-10-01T10:00:00Z", "state_by": "", "state_at": ""},
         {"id": "HN_2", "house": "ABD2704", "client_key": "", "priority": "high", "details": "Bob's note",
          "state": "open", "by": "Bob Ray", "at": "2026-10-02T10:00:00Z", "state_by": "", "state_at": ""}]
CLIENTS = [{"client_key": "kmarsh", "name": "Kenny Marsh"}]
SUPPLIES = {"house": "ABD2704", "ledger_ready": True, "order_days": 7, "consumables": [
    {"item": "Gloves", "category": "Care", "in_stock": 50, "entries": [
        {"id": "LS_d", "kind": "delivery", "qty": 40, "on_hand_after": 50, "at": "2026-10-01T00:00:00Z", "by": "Ann",
         "category": "Care", "note": ""}]}]}


def house_save(changes: list[dict], home_name: str = "CAN - JH - ABD2704") -> dict:
    return {"house": "ABD2704", "home_name": home_name, "changes": changes}


# a client's profile as clientProfileDetails draws it (cpDetailsBuild_), its edit map the door's witness
KAY_EDIT = {**{f: "" for f in eo.CLIENT_FIELDS}, "house": "ZZ9999", "outcome": "Community living",
            "guardian_name": "Gail Guard", "initials": "KT", "dob": "1980-03-04", "ssa_name": "Sam Ssa",
            "medicaid_id": "M1", "client_number": "C1", "name": "Kay Test", "status": "Active"}
KAY = {"client": {"client_key": "kay_test", "name": "Kay Test", "status": "active", "initials": "KT",
                  "dob": "1980-03-04", "age": 46, "client_number": "C1"},
       "identity": {"ssn_last4": "4544", "ssn_on_file": True, "medicaid_id": "M1"},
       "home": {"house_code": "ZZ9999", "home_address": "", "house_manager": "", "house_manager_phone": ""},
       "guardian": {"name": "Gail Guard", "person_id": "PPL_guardian_gailguard", "phone": "", "ssa_name": "Sam Ssa",
                    "ssa_person_id": "P9"},
       "services": {"outcome": "Community living", "ama_date": ""}, "day": {"workshop_phone": ""},
       "financial": {"tl_card_last4": "4812", "payee_rep": ""}, "degraded": False, "why": "", "edit": KAY_EDIT}


def cp_save(changes: list[dict], client: str = "kay_test") -> dict:
    return {"client": client, "changes": changes}


def clients_profile(tmp: Path, clock: Clock) -> None:
    """Clients' profile pencil (clients.profile): planned, laid over the pack, the read and the slice, settled."""
    ov = eo.Overlay(tmp / "client-overlay", clock=clock)
    view = {"details": KAY}
    got = eo.plan("clientProfileSave", cp_save([
        {"field": "guardian_phone", "value": "330.555.0101", "expected": ""},
        {"field": "outcome", "value": "Work", "expected": "Community living"},
        {"field": "dob", "value": "2000-01-15", "expected": "1980-03-04"},
        {"field": "guardian_name", "value": "Jo   Doe", "expected": "Gail Guard"}]), view, author=AUTHOR)
    check("clients: a profile save lays the fields as the door files them, on the pack and the clients slice",
          isinstance(got, tuple) and got[0][0]["fields"] == {"guardian_phone": "330.555.0101", "outcome": "Work",
                                                               "dob": "2000-01-15", "guardian_name": "Jo Doe"}
          and got[0][0]["key"] == "kay_test" and got[0][0]["app"] == eo.CLIENT_APP
          and got[0][0]["surfaces"] == ["pack", "slice:clients"]
          and got[1] == {"written": ["guardian_phone", "outcome", "dob", "guardian_name"], "refused": []}, got)
    door = {f: eo.plan("clientProfileSave", cp_save([{"field": f, "value": "1", "expected": ""}]), view, author=AUTHOR)
            for f in ("ssn", "tl_card", "dc_exp", "dc_security_code", "dc_pin", "social_security")}
    door.update({name: eo.plan("clientProfileSave", payload, v, author=AUTHOR) for name, payload, v in (
        ("name", cp_save([{"field": "name", "value": "Kay Other", "expected": "Kay Test"}]), view),
        ("status", cp_save([{"field": "status", "value": "Inactive", "expected": "Active"}]), view),
        ("house", cp_save([{"field": "house", "value": "QQ1000", "expected": "ZZ9999"}]), view),
        ("unknown", cp_save([{"field": "favorite", "value": "x", "expected": ""}]), view),
        ("stale", cp_save([{"field": "outcome", "value": "Work", "expected": "Day program"}]), view),
        ("formula", cp_save([{"field": "outcome", "value": "=cmd()", "expected": "Community living"}]), view),
        ("ssn-shape", cp_save([{"field": "outcome", "value": "see 123-45-6789", "expected": "Community living"}]), view),
        ("long-run", cp_save([{"field": "client_number", "value": "123456789", "expected": "C1"}]), view),
        ("free date", cp_save([{"field": "ama_date", "value": "March 4", "expected": ""}]), view),
        ("labelled guardian", cp_save([{"field": "guardian_name", "value": "Guardian: Jo Doe",
                                        "expected": "Gail Guard"}]), view),
        ("odd space", cp_save([{"field": "outcome", "value": "Work\N{ZERO WIDTH NO-BREAK SPACE}", "expected": "Community living"}]), view),
        ("old shape", {"client": "kay_test", "fields": {"outcome": "Work"}}, view),
        ("bad key", cp_save([{"field": "outcome", "value": "Work", "expected": "Community living"}], "a b"), view),
        ("inactive", cp_save([{"field": "outcome", "value": "W", "expected": "Community living"}]),
         {"details": {**KAY, "edit": {**KAY_EDIT, "status": "Inactive"}}}),
        ("degraded", cp_save([{"field": "outcome", "value": "W", "expected": "Community living"}]),
         {"details": {**KAY, "degraded": True}}),
        ("another client", cp_save([{"field": "outcome", "value": "W", "expected": "Community living"}], "lee_other"),
         view),
        ("no copy", cp_save([{"field": "outcome", "value": "W", "expected": "Community living"}]), {"details": {}}))})
    check("clients: SSN, card, DC and PIN, the name, the status, a house move, an unknown field, a stale witness, a "
          "formula, an SSN or card shape, a free date, a labelled guardian, an odd space, the old fields shape, an "
          "inactive or half-read client, another client's copy or none: each goes to its door",
          len(door) == 23 and all(isinstance(v, str) for v in door.values()),
          {k: v for k, v in door.items() if not isinstance(v, str)})
    check("clients: the house moves the client in Locations too, so the overlay never carries it",
          "house" not in eo.CLIENT_FIELDS and not any(eo._NEVER_WRITTEN.search(f.replace("_", ""))
                                                      for f in eo.CLIENT_FIELDS))

    laid = ov.add(got[0], AUTHOR)[0]
    shown = eo.patch_details(KAY, ov.layer(eo.CLIENTS_TAB, eo.PACK, key="kay_test"), today="2026-10-08")
    check("clients: the profile shows the edit as its read draws it — the phone in its one shape, the day, the age "
          "on today, the guardian's name with its old link dropped — and its edit map witnesses the new values",
          shown["guardian"]["phone"] == "(330) 555-0101" and shown["services"]["outcome"] == "Work"
          and shown["client"]["dob"] == "2000-01-15" and shown["client"]["age"] == 26
          and shown["guardian"]["name"] == "Jo Doe" and shown["guardian"]["person_id"] == ""
          and shown["guardian"]["ssa_person_id"] == "P9" and shown["edit"]["guardian_name"] == "Jo Doe"
          and shown["edit"]["dob"] == "2000-01-15" and shown["identity"] == KAY["identity"]
          and KAY["services"]["outcome"] == "Community living", shown)
    pack = {"client": "kay_test", "parts": {"details": KAY, "meds": {"rows": []}}}
    other = {"client": "lee_other", "parts": {"details": KAY}}
    check("clients: the pack's details carry it; another client's pack, or a pack asked by another key, is untouched",
          eo.patch_client_pack(pack, ov, "kay_test")["parts"]["details"]["services"]["outcome"] == "Work"
          and eo.patch_client_pack(other, ov, "lee_other")["parts"]["details"] is KAY
          and eo.patch_client_pack(other, ov, "kay_test") is other
          and eo.patch_client_pack(pack, ov, "kay_test")["parts"]["meds"] is pack["parts"]["meds"])
    ans = eo.patch_answer("clientProfileDetails", {"client": "kay_test"}, KAY, ov)
    check("clients: clientProfileDetails's answer carries it, and that read is the Clients app's",
          ans["services"]["outcome"] == "Work" and eo.READ_APPS["clientProfileDetails"] == eo.CLIENT_APP
          and eo.subject_of("clientProfileSave", {"client": "kay_test", "house": "ABD2704"}) == "kay_test", ans)
    second = eo.plan("clientProfileSave", cp_save([{"field": "outcome", "value": "Retired", "expected": "Work"}]),
                     {"details": ans}, author=AUTHOR)
    check("clients: a second edit witnesses the first one still queued", isinstance(second, tuple), second)

    rows = [{"client_key": "kay_test", "name": "Kay Test", "guardianName": "Gail Guard", "outcome": "Community living",
             "guardian_phone": "", "medicaid_id": "[withheld: identifier]"},
            {"client_key": "kay_test", "name": "Kay Test", "guardianName": "Twin Row", "outcome": "x"},
            {"client_key": "", "name": "Lee Other", "outcome": "Day program"}]
    sl = eo.patch_slice("clients", {"resource": "clients", "rows": rows, "source_at": eo.iso(clock.t - 60)}, ov)
    check("clients slice: the client's first row takes the columns the door writes (the guardian's own column); a "
          "second row of the key and another client are untouched",
          sl["rows"][0]["guardianName"] == "Jo Doe" and sl["rows"][0]["outcome"] == "Work"
          and sl["rows"][0]["guardian_phone"] == "330.555.0101" and "dob" not in sl["rows"][0]
          and sl["rows"][1] is rows[1] and sl["rows"][2] is rows[2], sl["rows"])
    mid = eo.plan("clientProfileSave", cp_save([{"field": "medicaid_id", "value": "M2", "expected": "M1"}]), view,
                  author=AUTHOR)
    mid_laid = ov.add(mid[0], AUTHOR)[0]
    withheld = eo.patch_slice("clients", {"resource": "clients", "rows": rows}, ov, observe=False)
    check("clients slice: a column the copies withhold keeps its marker, never the value",
          withheld["rows"][0]["medicaid_id"] == "[withheld: identifier]"
          and eo.patch_details(KAY, [mid_laid])["identity"]["medicaid_id"] == "M2", withheld["rows"][0])
    ov.refuse([mid_laid["id"]], "validation 409")

    done, lost = ov.written([laid["id"]], {"written": ["guardian_phone", "outcome", "dob", "guardian_name"],
                                           "refused": []})
    clock.t += 5
    eo.patch_client_part(KAY, ov, "kay_test", source_at=clock.t)
    check("clients: written, then Apps Script's own read after it confirms the pack; the slice waits for the mirror",
          len(done) == 1 and not lost and ov.get(laid["id"])["confirmed"] == [eo.PACK]
          and ov.get(laid["id"])["state"] == "written")
    caught = [dict(rows[0], guardianName="Jo Doe", outcome="Work", guardian_phone="330.555.0101")]
    eo.patch_slice("clients", {"rows": caught, "source_at": eo.iso(clock.t + 1)}, ov)
    check("clients: the mirror's copy holding the values retires the edit", ov.get(laid["id"])["state"] == "retired")

    stale = ov.add(eo.plan("clientProfileSave", cp_save([{"field": "outcome", "value": "Retired",
                                                         "expected": "Community living"}]), view, author=AUTHOR)[0],
                   AUTHOR)[0]
    laid_rows = eo.patch_slice("clients", {"rows": rows}, ov, observe=False)["rows"]
    _done, lost = ov.written([stale["id"]], {"written": [], "refused": [], "current": {"outcome": "Day program"}})
    undone = eo.undo_slice("clients", {"rows": laid_rows}, lost, ov)
    check("clients: a 409's stale field leaves the overlay with the door's words, and the slice gets its prior back",
          laid_rows[0]["outcome"] == "Retired" and lost and "changed since" in lost[0]["why"]
          and undone["rows"][0]["outcome"] == "Community living" and ov.get(stale["id"])["state"] == "refused",
          [lost, undone["rows"][0]])

    eds = eo.parse_editions(json.dumps([{"id": "clients.profile", "on": True, "people": ["u-ann"]},
                                        {"id": "locations.house", "on": False, "people": ["u-ann"]}]))
    check("editions: clients.profile is read from Settings like the Locations ones, fail-closed",
          eo.holds(eds, "clients.profile", "u-ann", "staff") and not eo.holds(eds, "clients.profile", "u-bo", "staff")
          and not eo.holds(eds, "clients.profile", "u-ann", "guardian")
          and eo.DOORS["clientProfileSave"]["edition"] == "clients.profile"
          and eo.CLIENT_APP in eo.PACK_APPS, eds)


# a client's Daily care tab as clientProfileCare draws it (cpCareBuild_ then cpCareOverridden_)
DAILY = {"tab": "daily", "statuses": ["Past plan"], "absent": [], "why": "", "rows": [
    {"id": "sec_1", "record": "Personal care", "date": "2025-01-02", "details": "Needs prompts.", "status": "Past plan",
     "source": "ISP 2025", "text": "Needs prompts.\n- brush teeth", "edit": {"record": "Personal care", "removed": ""}},
    {"id": "sec_2", "record": "Meals", "date": "2025-01-02", "details": "Cuts food.", "status": "Past plan",
     "source": "ISP 2025", "text": "Cuts food.", "edit": {"record": "Meals", "removed": ""}}]}
HEALTH = {"tab": "health", "statuses": [], "absent": [], "why": "", "rows": [
    {"id": "sec_9", "record": "Seizures", "date": "", "details": "", "status": "Current", "source": "",
     "text": "None known.", "edit": {"record": "Seizures", "removed": ""}}]}
HOME = {"tab": "home", "statuses": ["Current"], "absent": [], "why": "", "rows": [
    {"id": "home_kay_test", "record": "Home", "date": "", "details": "ZZ9999", "status": "Current",
     "source": "Client record", "text": ""}]}


def care_save(changes: list[dict], target: str = "sec_1", tab: str = "daily", kind: str = "care",
              client: str = "kay_test") -> dict:
    return {"client": client, "kind": kind, "tab": tab, "target": target, "changes": changes}


def clients_care(tmp: Path, clock: Clock) -> None:
    """Clients' care rows (clients.care): planned, laid over the care tab's read and the pack's part, settled."""
    ov = eo.Overlay(tmp / "care-overlay", clock=clock)
    view = {"care": DAILY}
    was = DAILY["rows"][0]["text"]
    got = eo.plan("clientProfileOverride", care_save([
        {"field": "record", "value": "Personal   care routine", "expected": "Personal care"},
        {"field": "text", "value": "  - Brushes with one reminder.\r\nShaves alone.  ", "expected": was}]),
        view, author=AUTHOR)
    check("care: a care row's edit lays the cells as the door files them, on the client's own tab of the pack",
          isinstance(got, tuple) and got[0][0]["fields"] == {"record": "Personal care routine",
                                                               "text": "- Brushes with one reminder.\nShaves alone."}
          and got[0][0]["key"] == "kay_test|daily" and got[0][0]["tab"] == eo.OVERRIDES_TAB
          and got[0][0]["target"] == "sec_1" and got[0][0]["app"] == eo.CLIENT_APP and got[0][0]["surfaces"] == ["pack"]
          and got[0][0]["prior"] == {"record": "Personal care", "text": DAILY["rows"][0]["text"]}
          and got[1] == {"written": ["record", "text"], "refused": []}, got)
    rec = lambda v, e="Personal care": [{"field": "record", "value": v, "expected": e}]  # noqa: E731
    door = {name: eo.plan("clientProfileOverride", payload, v, author=AUTHOR) for name, payload, v in (
        ("family", care_save([{"field": "relationship", "value": "SSA", "expected": ""}], "m1", "", "family"), view),
        ("plans", care_save(rec("x"), "isp_kay_test", "plans"), {"care": {**DAILY, "tab": "plans"}}),
        ("team", care_save(rec("x"), "p1", "team"), view),
        ("new row", care_save(rec("Swim", ""), ""), view),
        ("unknown field", care_save([{"field": "name", "value": "x", "expected": ""}]), view),
        ("stale", care_save(rec("Hygiene", "Grooming")), view),
        ("no copy", care_save(rec("Hygiene")), {"care": {}}),
        ("another tab's copy", care_save(rec("Hygiene")), {"care": HEALTH}),
        ("gone row", care_save(rec("Hygiene"), "sec_404"), view),
        ("home row", care_save(rec("House", "Home"), "home_kay_test", "home"), {"care": HOME}),
        ("title cleared", care_save(rec("")), view),
        ("number title", care_save(rec("12")), view),
        ("date title", care_save(rec("March 4")), view),
        ("time title", care_save(rec("10 am")), view),
        ("truth title", care_save(rec("TRUE")), view),
        ("ssn shape", care_save([{"field": "text", "value": "see 123-45-6789", "expected": was}]), view),
        ("long run", care_save([{"field": "text", "value": "card 4111111111111111", "expected": was}]), view),
        ("odd space", care_save(rec("Hygiene\N{ZERO WIDTH NO-BREAK SPACE}")), view),
        ("astral", care_save(rec("Hygiene \N{GRINNING FACE}")), view),
        ("too long", care_save([{"field": "text", "value": "x" * 30001, "expected": was}]), view),
        ("bad client", care_save(rec("Hygiene"), client="a b"), view),
        ("not well formed", {**care_save([]), "changes": []}, view))}
    check("care: a family member, Care plans and the team, a new row (its id is the door's), an unknown field, a stale "
          "witness, no copy or another tab's, a gone or home row, a cleared title, a value the sheet would take as a "
          "number, date, time or truth, an SSN or card shape, an odd space, a character JavaScript counts twice, an "
          "over-long text, a bad client and no changes: each goes to its door",
          len(door) == 22 and all(isinstance(v, str) for v in door.values()),
          {k: v for k, v in door.items() if not isinstance(v, str)})
    hide = eo.plan("clientProfileOverride", care_save([{"field": "removed", "value": "yes", "expected": ""}], "sec_2"),
                   view, author=AUTHOR)
    check("care: hiding a row lays removed Yes, as the door files it",
          isinstance(hide, tuple) and hide[0][0]["fields"] == {"removed": "Yes"}, hide)

    laid = ov.add(got[0], AUTHOR)[0]
    gone = ov.add(hide[0], AUTHOR)[0]
    ans = eo.patch_answer("clientProfileCare", {"client": "kay_test", "tab": "daily"}, DAILY, ov)
    day = eo.iso(clock.t)[:10]
    row = ans["rows"][0] if ans["rows"] else {}
    check("care: the Daily care read draws the edited row as the door's read does — its title, its text verbatim, "
          "the first line for details, Current, Edited in the Hub, today — and the hidden row is gone",
          len(ans["rows"]) == 1 and row == {"id": "sec_1", "record": "Personal care routine", "date": day,
                                             "details": "Brushes with one reminder.", "status": "Current",
                                             "source": "Edited in the Hub",
                                             "text": "- Brushes with one reminder.\nShaves alone.",
                                             "edit": {"record": "Personal care routine", "removed": ""}}
          and ans["statuses"] == ["Current"] and DAILY["rows"][0]["record"] == "Personal care"
          and len(DAILY["rows"]) == 2, ans)
    other = eo.patch_answer("clientProfileCare", {"client": "kay_test", "tab": "health"}, HEALTH, ov)
    lee = eo.patch_answer("clientProfileCare", {"client": "lee_other", "tab": "daily"}, DAILY, ov)
    check("care: another tab's read, and another client's, are untouched; the read is the Clients app's",
          other is HEALTH and lee is DAILY and eo.READ_APPS["clientProfileCare"] == eo.CLIENT_APP
          and eo.subject_of("clientProfileOverride", {"client": "kay_test", "kind": "care"}) == "kay_test")
    pack = {"client": "kay_test", "parts": {"details": KAY, "care_daily": DAILY, "care_health": HEALTH}}
    lp = eo.patch_client_pack(pack, ov, "kay_test")["parts"]
    check("care: the pack's Daily care part carries it; its other parts are untouched",
          lp["care_daily"]["rows"] == ans["rows"] and lp["care_health"] is HEALTH and lp["details"] is KAY, lp)
    second = eo.plan("clientProfileOverride", care_save([{"field": "text", "value": "Shaves alone.",
                                                         "expected": "- Brushes with one reminder.\nShaves alone."}]),
                     {"care": ans}, author=AUTHOR)
    check("care: a second edit witnesses the first one still queued", isinstance(second, tuple), second)

    done, lost = ov.written([laid["id"], gone["id"]], {"written": ["record", "text"], "refused": []})
    clock.t += 5
    eo.patch_care_part(HEALTH, ov, "kay_test", "health", source_at=clock.t)
    check("care: written, a read of another tab confirms nothing of Daily care",
          len(done) == 2 and not lost and ov.get(laid["id"])["state"] == "written"
          and ov.get(laid["id"])["confirmed"] == [])
    eo.patch_care_part(DAILY, ov, "kay_test", "daily", source_at=clock.t)
    check("care: Apps Script's own read of Daily care after the write retires both edits",
          ov.get(laid["id"])["state"] == "retired" and ov.get(gone["id"])["state"] == "retired")

    stale = ov.add(eo.plan("clientProfileOverride", care_save(rec("Hygiene")), view, author=AUTHOR)[0], AUTHOR)[0]
    _done, lost = ov.written([stale["id"]], {"written": [], "refused": [], "current": {"record": "Grooming"}})
    check("care: a 409's stale title leaves the overlay with the door's words; the read shows the plan again",
          lost and "changed since" in lost[0]["why"] and ov.get(stale["id"])["state"] == "refused"
          and eo.patch_answer("clientProfileCare", {"client": "kay_test", "tab": "daily"}, DAILY, ov) is DAILY, lost)

    eds = eo.parse_editions(json.dumps([{"id": "clients.care", "on": True, "people": ["u-ann"]},
                                        {"id": "clients.profile", "on": True, "people": ["u-bo"]}]))
    check("editions: clients.care is read from Settings like the others, fail-closed, and opens the care door alone",
          eo.holds(eds, "clients.care", "u-ann", "staff") and not eo.holds(eds, "clients.care", "u-bo", "manager")
          and not eo.holds(eds, "clients.care", "u-ann", "client")
          and eo.DOORS["clientProfileOverride"]["edition"] == "clients.care"
          and eo.DOORS["clientProfileOverride"]["app"] == eo.CLIENT_APP, eds)


# a client's Medications tab as clientProfileMeds draws it (cpMedsBuild_): row 8's times cell has colons, so its
# details carry no times; row 9 is discontinued
def med_row(mid: str, name: str, details: str, status: str, **edit: str) -> dict:
    cells = {"name": name, "dose": "", "times": "", "route": "", "freq": "", "discontinued": "", **edit}
    return {"id": mid, "record": name, "date": "2026-01-02", "details": details, "status": status, "source": "eMAR",
            "text": "", "edit": cells}


MEDS = {"tab": "meds", "statuses": ["Active", "Discontinued"], "as_of": "2026-09-01", "why": "", "rows": [
    med_row("7", "Gabapentin 300mg", "1 cap · Capsule · Daily · 08:00 20:00", "Active", dose="1 cap",
            times="08:00 20:00", route="Capsule", freq="Daily"),
    med_row("8", "Metformin", "500 mg · Tablet", "Active", dose="500 mg", times="08:00", route="Tablet"),
    med_row("9", "Zyrtec", "", "Discontinued", discontinued="Yes")]}


def med_save(changes: list[dict], mid: str = "7", client: str = "kay_test") -> dict:
    return {"client": client, "id": mid, "changes": changes}


def clients_meds(tmp: Path, clock: Clock) -> None:
    """Clients' chart rows (clients.medication): planned, laid over the Medications read and the pack's part, settled."""
    ov = eo.Overlay(tmp / "meds-overlay", clock=clock)
    view = {"meds": MEDS}
    got = eo.plan("emarMedUpdate", med_save([{"field": "dose", "value": "2   caps", "expected": "1 cap"},
                                             {"field": "times", "value": "9:00, 2100", "expected": "08:00 20:00"}]),
                  view, author=AUTHOR)
    check("meds: a chart row's change lays the cells as the read draws them back, on the client's chart in the pack",
          isinstance(got, tuple) and got[0][0]["fields"] == {"dose": "2 caps", "times": "09:00 21:00"}
          and got[0][0]["key"] == "kay_test" and got[0][0]["tab"] == eo.MEDS_TAB and got[0][0]["target"] == "7"
          and got[0][0]["book"] == "hub:medications" and got[0][0]["app"] == eo.CLIENT_APP
          and got[0][0]["surfaces"] == ["pack"] and got[0][0]["prior"] == {"dose": "1 cap", "times": "08:00 20:00"}
          and got[1] == {"written": ["dose", "times"], "refused": []}, got)
    dose = lambda v, e="1 cap": [{"field": "dose", "value": v, "expected": e}]  # noqa: E731
    odd = {**MEDS, "rows": [{**MEDS["rows"][0], "details": "drawn its own way"}] + MEDS["rows"][1:]}
    twice = {**MEDS, "rows": MEDS["rows"] + [MEDS["rows"][0]]}
    bare = {**MEDS, "rows": [{**MEDS["rows"][1], "id": "8x", "edit": {}}] + MEDS["rows"]}
    door = {name: eo.plan(action, payload, v, author=AUTHOR) for name, action, payload, v in (
        ("unknown field", "emarMedUpdate", med_save([{"field": "dr", "value": "x", "expected": ""}]), view),
        ("stale", "emarMedUpdate", med_save(dose("2 caps", "3 caps")), view),
        ("no copy", "emarMedUpdate", med_save(dose("2 caps")), {"meds": {}}),
        ("gone row", "emarMedUpdate", med_save(dose("2 caps"), "404"), view),
        ("row without an id", "emarMedUpdate", med_save(dose("2 caps"), "8x"), {"meds": bare}),
        ("odd id", "emarMedDelete", {"client": "kay_test", "id": " 7"}, view),
        ("twice in the copy", "emarMedUpdate", med_save(dose("2 caps")), {"meds": twice}),
        ("details drawn its own way", "emarMedUpdate", med_save(dose("2 caps")), {"meds": odd}),
        ("name cleared", "emarMedUpdate", med_save([{"field": "name", "value": "", "expected": "Gabapentin 300mg"}]), view),
        ("number dose", "emarMedUpdate", med_save(dose("10")), view),
        ("date dose", "emarMedUpdate", med_save(dose("May 5")), view),
        ("formula lead", "emarMedUpdate", med_save(dose("-5 mg")), view),
        ("json cell", "emarMedUpdate", med_save(dose("[2 caps]")), view),
        ("ssn shape", "emarMedUpdate", med_save(dose("see 123-45-6789")), view),
        ("long run", "emarMedUpdate", med_save(dose("lot 4111111111111111")), view),
        ("odd space", "emarMedUpdate", med_save(dose("2 caps\N{ZERO WIDTH NO-BREAK SPACE}")), view),
        ("astral", "emarMedUpdate", med_save(dose("2 caps \N{GRINNING FACE}")), view),
        ("too long", "emarMedUpdate", med_save(dose("caps " * 101)), view),
        ("too many times", "emarMedUpdate",
         med_save([{"field": "times", "value": " ".join(["0800"] * 72), "expected": "08:00 20:00"}]), view),
        ("bad client", "emarMedUpdate", med_save(dose("2 caps"), client="a b"), view),
        ("not well formed", "emarMedUpdate", {**med_save([]), "changes": []}, view),
        ("the last row", "emarMedDelete", {"client": "kay_test", "id": "7"}, {"meds": {**MEDS, "rows": MEDS["rows"][:1]}}))}
    check("meds: an unknown field, a stale witness, no copy, a gone row or one without its id, an odd id, an id twice, a "
          "row whose details the relay cannot draw, a cleared name, a value the sheet would take as a number or a date, a "
          "formula lead or JSON, an SSN or card shape, an odd space, a character JavaScript counts twice, an over-long "
          "cell or times list, a bad client, no changes and the chart's last row: each goes to its door",
          len(door) == 22 and all(isinstance(v, str) for v in door.values()),
          {k: v for k, v in door.items() if not isinstance(v, str)})
    check("meds: the Medications app's removal (no client) is its door's; the doors are clients.medication's",
          eo.subject_of("emarMedDelete", {"id": "8"}) == "" and eo.subject_of("emarMedDelete", {"client": "kay_test"}) ==
          "kay_test" and all(eo.DOORS[a]["edition"] == "clients.medication" and eo.DOORS[a]["app"] == eo.CLIENT_APP
                             for a in ("emarMedUpdate", "emarMedDelete"))
          and eo.READ_APPS["clientProfileMeds"] == eo.CLIENT_APP)
    gone = eo.plan("emarMedDelete", {"client": "kay_test", "id": "9"}, view, author=AUTHOR)
    check("meds: taking a row off lays removed, answered as the door answers",
          isinstance(gone, tuple) and gone[0][0]["fields"] == {"removed": "Yes"} and gone[0][0]["target"] == "9"
          and gone[1] == {"removed": "9", "written": ["removed"], "refused": []}, gone)

    laid = ov.add(got[0], AUTHOR)[0]
    off = ov.add(gone[0], AUTHOR)[0]
    ans = eo.patch_answer("clientProfileMeds", {"client": "kay_test", "tab": "meds"}, MEDS, ov)
    check("meds: the Medications read draws the changed row as its read does — dose and times in the details, the edit "
          "cells the panel opens on — and the row taken off is gone; the copy itself is untouched",
          [r["id"] for r in ans["rows"]] == ["7", "8"]
          and ans["rows"][0]["details"] == "2 caps · Capsule · Daily · 09:00 21:00"
          and ans["rows"][0]["edit"] == {**MEDS["rows"][0]["edit"], "dose": "2 caps", "times": "09:00 21:00"}
          and ans["rows"][0]["status"] == "Active" and ans["rows"][0]["record"] == "Gabapentin 300mg"
          and ans["statuses"] == ["Active"] and len(MEDS["rows"]) == 3 and MEDS["rows"][0]["edit"]["dose"] == "1 cap", ans)
    lee = eo.patch_answer("clientProfileMeds", {"client": "lee_other", "tab": "meds"}, MEDS, ov)
    pack = {"client": "kay_test", "parts": {"details": KAY, "meds": MEDS, "care_daily": DAILY}}
    lp = eo.patch_client_pack(pack, ov, "kay_test")["parts"]
    check("meds: another client's chart is untouched; the pack's chart carries it, its other parts untouched",
          lee is MEDS and lp["meds"]["rows"] == ans["rows"] and lp["details"] is KAY and lp["care_daily"] is DAILY, lp)
    second = eo.plan("emarMedUpdate", med_save(dose("3 caps", "2 caps")), {"meds": ans}, author=AUTHOR)
    check("meds: a second change witnesses the first one still queued", isinstance(second, tuple), second)

    moved = eo.patch_meds(MEDS, [{"target": "8", "fields": {"name": "Aspirin"}},
                                 {"target": "7", "fields": {"discontinued": "Yes"}}])
    check("meds: a renamed row keeps its times-less details and takes its place by name; a discontinued one goes after "
          "the active ones",
          [(r["id"], r["record"], r["status"]) for r in moved["rows"]] ==
          [("8", "Aspirin", "Active"), ("7", "Gabapentin 300mg", "Discontinued"), ("9", "Zyrtec", "Discontinued")]
          and moved["rows"][0]["details"] == "500 mg · Tablet" and moved["statuses"] == ["Active", "Discontinued"], moved)

    done, lost = ov.written([laid["id"]], {"written": ["dose", "times"], "refused": []})
    done2, lost2 = ov.written([off["id"]], {"removed": "9", "written": ["removed"], "refused": []})
    clock.t += 5
    eo.patch_meds_part(MEDS, ov, "lee_other", source_at=clock.t)
    check("meds: written, another client's read confirms nothing",
          len(done) == len(done2) == 1 and not lost and not lost2 and ov.get(laid["id"])["state"] == "written"
          and ov.get(laid["id"])["confirmed"] == [])
    eo.patch_answer("clientProfileMeds", {"client": "kay_test", "tab": "meds"}, MEDS, ov, source_at=clock.t)
    check("meds: Apps Script's own read of the chart after the write retires both edits",
          ov.get(laid["id"])["state"] == "retired" and ov.get(off["id"])["state"] == "retired")

    stale = ov.add(eo.plan("emarMedUpdate", med_save(dose("2 caps")), view, author=AUTHOR)[0], AUTHOR)[0]
    _done, lost = ov.written([stale["id"]], {"written": [], "refused": [], "current": {"dose": "3 caps"}})
    check("meds: a 409's stale dose leaves the overlay with the door's words; the read shows the chart again",
          lost and "changed since" in lost[0]["why"] and ov.get(stale["id"])["state"] == "refused"
          and eo.patch_answer("clientProfileMeds", {"client": "kay_test", "tab": "meds"}, MEDS, ov) is MEDS, lost)

    eds = eo.parse_editions(json.dumps([{"id": "clients.medication", "on": True, "people": ["u-ann"]},
                                        {"id": "clients.care", "on": True, "people": ["u-bo"]}]))
    check("editions: clients.medication is read from Settings like the others, fail-closed, and opens the chart doors alone",
          eo.holds(eds, "clients.medication", "u-ann", "staff") and not eo.holds(eds, "clients.medication", "u-bo", "manager")
          and not eo.holds(eds, "clients.medication", "u-ann", "client"), eds)


def clients_transport() -> None:
    """Clients' trips (clients.transportation): read from Settings, yet no overlay door — the trip save stays direct."""
    eds = eo.parse_editions(json.dumps([{"id": "clients.transportation", "on": True, "people": ["u-ann"]}]))
    check("editions: clients.transportation is read from Settings like the others, fail-closed",
          eo.holds(eds, "clients.transportation", "u-ann", "staff") and not eo.holds(eds, "clients.transportation", "u-bo", "staff")
          and not eo.holds(eds, "clients.transportation", "u-ann", "client"), eds)
    # the trip save writes three houses under a lock, owes a text on cancel and answers with a fresh board: never laid
    check("trips: no overlay door is the Transportation app's, so a trip save goes to its door",
          not any(d.get("edition") == "clients.transportation" for d in eo.DOORS.values())
          and "vehicleCalendarTripSave" not in eo.DOORS
          and isinstance(eo.plan("vehicleCalendarTripSave", {"client": "kay_test", "trip_id": "VT0000000001"}, {},
                                 author=AUTHOR), str))


def python_plans(tmp: Path, clock: Clock) -> None:
    """A Locations write Python decided (asa-hub-app): its plan checked here and laid by the overlay's own rules."""
    ov = eo.Overlay(tmp / "python-overlay", clock=clock)
    house = eo.python_entries("locationHouseSave", {"kind": "edit", "key": "ABD2704", "house": "ABD2704",
                                                    "fields": {"telephone": "(330) 555-0101", "region": "Akron"},
                                                    "prior": {"telephone": "", "region": "Canton", "x": "y"}})
    check("python: a house save is laid over the pack, and into the houses slice for a field it draws",
          isinstance(house, list) and house[0]["surfaces"] == ["pack", "slice:houses"] and house[0]["tab"] == eo.HOUSE_TAB
          and house[0]["book"] == eo.ENTITIES_BOOK and house[0]["prior"] == {"telephone": "", "region": "Canton"}, house)
    row = eo.python_entries("locationRepairEdit", {"kind": "edit", "key": "r12", "house": "ABD2704",
                                                   "fields": {"status": "Completed"}, "prior": {"status": "Open"}})
    check("python: an estate row is laid over the pack and its slice",
          isinstance(row, list) and row[0]["surfaces"] == ["pack", "slice:workOrders"] and row[0]["key"] == "r12", row)
    note = {"id": "HN_" + "0" * 36, "house": "ABD2704", "client_key": "", "client_name": "", "priority": "low",
            "details": "x", "state": "open", "by": "Ann Lee", "at": "2026-10-08T15:00:00.000Z", "state_by": "",
            "state_at": ""}
    add = eo.python_entries("locationNoteAdd", {"kind": "append", "key": note["id"], "house": "ABD2704", "row": note})
    check("python: a new note is an append keyed by its minted id", isinstance(add, list) and add[0]["kind"] == "append"
          and add[0]["row"]["details"] == "x" and add[0]["surfaces"] == ["pack"], add)
    refused = {
        "a field the door does not write": ("locationNoteEdit", {"kind": "edit", "key": "HN_1", "house": "ABD2704",
                                                                 "fields": {"house": "XX9999"}}),
        "a client_name on an incident": ("locationIncidentEdit", {"kind": "edit", "key": "r2", "house": "ABD2704",
                                                                  "fields": {"client_name": "Somebody"}}),
        "a house row keyed by another code": ("locationHouseSave", {"kind": "edit", "key": "ABD9999",
                                                                    "house": "ABD2704", "fields": {"region": "x"}}),
        "a row id that is not r<n>": ("locationRepairEdit", {"kind": "edit", "key": "7", "house": "ABD2704",
                                                             "fields": {"status": "x"}}),
        "a new row of another house": ("locationNoteAdd", {"kind": "append", "key": note["id"], "house": "ABD9999",
                                                           "row": note}),
        "a new row under another prefix": ("locationNoteAdd", {"kind": "append", "key": "LS_1", "house": "ABD2704",
                                                               "row": {**note, "id": "LS_1"}}),
        "a new row with a column the tab has not": ("locationSupplyEntry", {
            "kind": "append", "key": "LS_1", "house": "ABD2704", "row": {"id": "LS_1", "house": "ABD2704", "pin": "1"}}),
        "a value that is not a cell": ("locationNoteEdit", {"kind": "edit", "key": "HN_1", "house": "ABD2704",
                                                            "fields": {"details": {"x": 1}}}),
        "no house": ("locationNoteState", {"kind": "edit", "key": "HN_1", "house": "",
                                           "fields": {"state": "open"}}),
        "a door the overlay does not carry": ("locationStaffRemove", {"kind": "append", "key": "HS_1",
                                                                      "house": "ABD2704", "row": {}}),
        "a Clients door": ("clientProfileSave", {"kind": "edit", "key": "kay", "house": "ABD2704",
                                                 "fields": {"dob": "1980-01-01"}}),
    }
    for words, (action, lay) in refused.items():
        got = eo.python_entries(action, lay)
        check(f"python: refused — {words}", isinstance(got, str), got)
    laid = ov.add([{**house[0], "engine": "python"}], AUTHOR)
    ov.bind([laid[0]["id"]], "led-1", "Wpython00001")
    done, lost = ov.written([laid[0]["id"]], {"written": ["telephone"], "refused": [{"field": "region", "why": "no"}]})
    check("python: the entry keeps who decided it and its write id through the door's answer, so Python is told",
          done and done[0]["engine"] == "python" and done[0]["write_id"] == "Wpython00001"
          and done[0]["fields"] == {"telephone": "(330) 555-0101"} and lost and lost[0]["partial"] is True, [done, lost])


def main() -> int:
    tmp = Path(tempfile.mkdtemp(prefix="edit-overlay-test-"))
    clock = Clock()
    ov = eo.Overlay(tmp / "edit-overlay", clock=clock)

    # ---- the plan: what the door would write, or why the door must answer it ----
    got = eo.plan("locationHouseSave", house_save([{"field": "telephone", "value": "1-330-555-0101", "expected": ""},
                                                   {"field": "home_name", "value": "CAN - Elm - ABD2704",
                                                    "expected": EDIT["home_name"]}]),
                  {"edit": EDIT}, author=AUTHOR)
    check("plan: a house save lays the registry cells as the door writes them (a phone in its one shape)",
          isinstance(got, tuple) and got[0][0]["fields"] == {"telephone": "(330) 555-0101",
                                                             "home_name": "CAN - Elm - ABD2704"}
          and got[0][0]["surfaces"] == ["pack", "slice:houses"] and got[1] == {"written": ["telephone", "home_name"],
                                                                              "refused": []}, got)
    stale = eo.plan("locationHouseSave", house_save([{"field": "region", "value": "Akron", "expected": "Massillon"}]),
                    {"edit": EDIT}, author=AUTHOR)
    witness = eo.plan("locationHouseSave", house_save([{"field": "region", "value": "Akron", "expected": "Canton"}],
                                                      home_name="Somewhere else"), {"edit": EDIT}, author=AUTHOR)
    bad = [eo.plan("locationHouseSave", house_save([c]), {"edit": EDIT}, author=AUTHOR) for c in (
        {"field": "telephone", "value": "555", "expected": ""},
        {"field": "calendar_link", "value": "http://x.test", "expected": ""},
        {"field": "abbreviation", "value": "XX1", "expected": "ABD2704"},
        {"field": "home_name", "value": "", "expected": EDIT["home_name"]})]
    none = eo.plan("locationHouseSave", house_save([{"field": "region", "value": "Akron", "expected": "Canton"}]),
                   {"edit": None}, author=AUTHOR)
    check("plan: a stale witness, a moved row, a refusal the door would make or no copy of the row go to the door",
          all(isinstance(x, str) for x in [stale, witness, none, *bad]), [stale, witness, none, bad])
    check("plan: a malformed house or an action the overlay does not carry goes to the door",
          isinstance(eo.plan("locationHouseSave", {"house": "nope"}, {}, author=AUTHOR), str)
          and isinstance(eo.plan("locationDocUpload", {"house": "ABD2704"}, {}, author=AUTHOR), str))

    own = eo.plan("locationNoteEdit", {"house": "ABD2704", "id": "HN_2", "changes": [
        {"field": "details", "value": "x", "expected": "Bob's note"}]}, {"notes": NOTES, "clients": CLIENTS},
        author=AUTHOR, any_note=False)
    anyone = eo.plan("locationNoteEdit", {"house": "ABD2704", "id": "HN_2", "changes": [
        {"field": "priority", "value": "URGENT", "expected": "HIGH"}]}, {"notes": NOTES, "clients": CLIENTS},
        author=AUTHOR, any_note=True)
    check("plan: somebody else's note is its door's unless the edition says anyone's; a priority folds as the door folds",
          isinstance(own, str) and isinstance(anyone, tuple) and anyone[0][0]["fields"] == {"priority": "urgent"}, [own, anyone])

    added = eo.plan("locationNoteAdd", {"house": "ABD2704", "details": "  New note ", "priority": "High",
                                        "client_key": "kmarsh"}, {"notes": NOTES, "clients": CLIENTS}, author=AUTHOR,
                    now=clock.t)
    check("plan: a new note is an append with an id minted here, the door's shape and the client's name",
          isinstance(added, tuple) and added[0][0]["kind"] == "append" and added[0][0]["key"].startswith("HN_")
          and len(added[0][0]["key"]) == 39 and added[1]["note"]["details"] == "New note"
          and added[1]["note"]["priority"] == "high" and added[1]["note"]["client_name"] == "Kenny Marsh", added)
    check("plan: a client of no house's note goes to the door",
          isinstance(eo.plan("locationNoteAdd", {"house": "ABD2704", "details": "x", "client_key": "zed"},
                             {"clients": CLIENTS}, author=AUTHOR), str))

    # ---- the store: on the disk first, 0600, read back whole ----
    house_entries, _answer = got
    laid = ov.add(house_entries, AUTHOR)
    state = tmp / "edit-overlay" / eo.STATE_FILE
    check("store: the edit is on the disk before anything else, the file 0600 in a 0700 folder",
          state.is_file() and stat.S_IMODE(state.stat().st_mode) == 0o600
          and stat.S_IMODE(state.parent.stat().st_mode) == 0o700, oct(state.stat().st_mode))
    again = eo.Overlay(tmp / "edit-overlay", clock=clock)
    check("store: a restart reads the queued edit back", again.busy() and again.get(laid[0]["id"])["state"] == "queued")
    check("store: no parent volume, no overlay — every edit goes to its door",
          not eo.Overlay(tmp / "missing" / "edit-overlay").ready())
    ov.bind([laid[0]["id"]], "00000000000000000001.json", "Wabc")

    # ---- every reader's layer ----
    rows = [{"code": "ABD2704", "label": "JH", "title": "JH - ABD2704", "city": "Canton", "address": "12 Elm St NW",
             "sources": [{"key": "registry", "read_at": "2026-10-07T00:00:00+00:00"}]},
            {"code": "QQ1000", "label": "Q", "title": "Q - QQ1000", "city": "Akron", "address": "1 Main"}]
    sl = eo.patch_slice("houses", {"resource": "houses", "rows": rows}, ov)
    check("houses slice: the label and the title follow the new name; another house is untouched",
          sl["rows"][0]["label"] == "Elm" and sl["rows"][0]["title"] == "Elm - ABD2704" and sl["rows"][1] is rows[1],
          sl["rows"])
    pack = {"house": "ABD2704", "parts": {"overview": {"house": {"code": "ABD2704", "home_name": EDIT["home_name"],
                                                                 "phone": ""},
                                                       "edit": dict(EDIT), "registry_manager": {"name": "", "phone": ""}}}}
    pk = eo.patch_pack(pack, ov, "ABD2704")
    check("pack: the overview shows the phone and the name at once, and its edit form witnesses the new values",
          pk["parts"]["overview"]["house"]["phone"] == "(330) 555-0101"
          and pk["parts"]["overview"]["edit"]["home_name"] == "CAN - Elm - ABD2704"
          and pack["parts"]["overview"]["house"]["phone"] == "", pk)
    second = eo.plan("locationHouseSave", house_save([{"field": "region", "value": "Akron", "expected": "Canton"}],
                                                     home_name="CAN - Elm - ABD2704"),
                     {"edit": pk["parts"]["overview"]["edit"]}, author=AUTHOR)
    check("plan: a second edit witnesses the first one still queued (the screen saw it)", isinstance(second, tuple), second)

    # ---- the door's answer settles it ----
    done, lost = ov.written([laid[0]["id"]], {"written": ["telephone", "home_name"], "refused": []})
    check("settle: the door wrote both cells — written, still laid until a source holds it",
          len(done) == 1 and not lost and ov.get(laid[0]["id"])["state"] == "written"
          and ov.layer(eo.HOUSE_TAB, eo.PACK, "ABD2704"), [done, lost])
    clock.t += 10
    eo.patch_part("overview", pack["parts"]["overview"], ov, "ABD2704", source_at=clock.t - 20)
    check("retire: a pack read before the write confirms nothing", eo.PACK not in ov.get(laid[0]["id"])["confirmed"])
    eo.patch_part("overview", pack["parts"]["overview"], ov, "ABD2704", source_at=clock.t)
    check("retire: Apps Script's own read after the write confirms the pack; the slice still waits for the mirror",
          ov.get(laid[0]["id"])["confirmed"] == [eo.PACK] and ov.get(laid[0]["id"])["state"] == "written")
    lagging = [dict(rows[0], sources=[{"key": "registry", "read_at": eo.iso(clock.t + 5)}])]
    eo.patch_slice("houses", {"rows": lagging}, ov)
    check("retire: a mirror copy read after the write that still holds the old name confirms nothing (it lags)",
          ov.get(laid[0]["id"])["state"] == "written")
    caught = [dict(rows[0], label="Elm", sources=[{"key": "registry", "read_at": eo.iso(clock.t + 6)}])]
    eo.patch_slice("houses", {"rows": caught}, ov)
    check("retire: the mirror's copy holding the value retires the edit everywhere",
          ov.get(laid[0]["id"])["state"] == "retired" and not ov.busy())

    # ---- partial refusals and rollback ----
    n_entries, _ = anyone
    note = ov.add(n_entries, AUTHOR)[0]
    rm = eo.plan("locationNoteEdit", {"house": "ABD2704", "id": "HN_1", "changes": [
        {"field": "state", "value": "removed", "expected": "open"}, {"field": "details", "value": "Door fixed",
                                                                      "expected": "Fix the door"}]},
        {"notes": NOTES, "clients": CLIENTS}, author=AUTHOR, now=clock.t)
    rme = ov.add(rm[0], AUTHOR)[0]
    notes = eo.patch_part("notes", {"house": "ABD2704", "exists": True, "notes": NOTES, "open_count": 2}, ov, "ABD2704")
    check("notes: a removed note leaves the list, an edit shows at once, the open count follows",
          [n["id"] for n in notes["notes"]] == ["HN_2"] and notes["notes"][0]["priority"] == "urgent"
          and notes["open_count"] == 1, notes)
    done, lost = ov.written([rme["id"]], {"written": ["details"], "current": {"state": "resolved"}})
    check("settle: a 409's stale field leaves the overlay with the door's words, the written one stays",
          ov.get(rme["id"])["fields"] == {"details": "Door fixed"} and lost and lost[0]["partial"]
          and set(lost[0]["fields"]) == {"state", "state_by", "state_at"} and "changed since" in lost[0]["why"], lost)
    gone = ov.refuse([note["id"]], "validation 403: Somebody else wrote this note.")
    check("refuse: a buried write's edit leaves every reader", gone and not ov.layer(eo.NOTES_TAB, eo.PACK, "QQ1000")
          and all(e["id"] != note["id"] for e in ov.layer(eo.NOTES_TAB, eo.PACK, "ABD2704")))

    # ---- the appends: a row named before the sheet holds it ----
    a = ov.add(added[0], AUTHOR)[0]
    shown = eo.patch_part("notes", {"house": "ABD2704", "exists": False, "notes": [], "open_count": 0}, ov, "ABD2704")
    check("append: the new note shows at once, the notes tab now said to exist",
          shown["exists"] and any(n["id"] == a["key"] for n in shown["notes"]), shown)
    ov.written([a["id"]], {"note": {"id": "HN_engine-own"}})
    check("append: an engine that mints its own id re-keys the edit to the sheet's row",
          ov.get(a["id"])["key"] == "HN_engine-own" and ov.get(a["id"])["state"] == "written")

    sup = eo.plan("locationSupplyEntry", {"house": "ABD2704", "item": "gloves", "kind": "count", "qty": "30"},
                  {"supplies": SUPPLIES}, author=AUTHOR, now=eo.epoch_of("2026-10-05T00:00:00Z"))
    s_entry = ov.add(sup[0], AUTHOR)[0]
    fixed = eo.plan("locationSupplyEdit", {"house": "ABD2704", "id": "LS_d", "changes": [
        {"field": "qty", "value": "45", "expected": "40"}]}, {"supplies": SUPPLIES}, author=AUTHOR)
    ov.add(fixed[0], AUTHOR)
    figures = eo.patch_part("supplies", SUPPLIES, ov, "ABD2704")["consumables"][0]
    check("supplies: a count and a corrected delivery recompute the figures as the door does (folded item, newest first)",
          len(figures["entries"]) == 2 and figures["entries"][0]["id"] == s_entry["key"] and figures["in_stock"] == 30
          and figures["consumption"] == 20 and figures["measured"] is True and figures["entries"][1]["qty"] == 45,
          figures)
    check("supplies: the door's own figures for a delivery with no count after it",
          eo.supply_figures([{"kind": "delivery", "qty": 40, "on_hand_after": 50, "at": "2026-10-01"}])["in_stock"] == 50)

    # ---- the estate rows: slices, the pack, a read's answer ----
    rep = eo.plan("locationRepairEdit", {"house": "ABD2704", "id": "r7", "changes": [
        {"field": "status", "value": "Completed", "expected": "Open"}]},
        {"row": {"id": "r7", "status": "Open"}}, author=AUTHOR)
    ov.add(rep[0], AUTHOR)
    open_only = {"house": "ABD2704", "resolved": False, "open_count": 2, "resolved_count": 1,
                 "rows": [{"id": "r7", "status": "Open", "resolved": False}, {"id": "r8", "status": "Open", "resolved": False}]}
    ans = eo.patch_answer("locationRepairs", {"house": "ABD2704"}, open_only, ov)
    check("repairs: a request completed leaves the open list and the counts move with it",
          [r["id"] for r in ans["rows"]] == ["r8"] and ans["open_count"] == 1 and ans["resolved_count"] == 2, ans)
    est = eo.patch_slice("workOrders", {"rows": [{"id": "r7", "status": "Open"}], "source_at": eo.iso(clock.t - 999)}, ov)
    check("workOrders slice: the row shows the new status", est["rows"][0]["status"] == "Completed", est)
    inc = eo.plan("locationIncidentEdit", {"house": "ABD2704", "id": "r3", "changes": [
        {"field": "incident_category", "value": "Fall, Medication (missed, late)", "expected": "Fall"}]},
        {"row": {"id": "r3", "incident_category": "Fall"}}, author=AUTHOR)
    moved = eo.plan("locationIncidentEdit", {"house": "ABD2704", "id": "r3", "changes": [
        {"field": "client_name", "value": "Someone", "expected": "Kenny Marsh"}]},
        {"row": {"id": "r3", "client_name": "Kenny Marsh"}}, author=AUTHOR)
    ov.add(inc[0], AUTHOR)
    incs = eo.patch_answer("locationIncidents", {"house": "ABD2704"}, {"categories": ["Fall"], "rows": [
        {"id": "r3", "incident_category": "Fall", "categories": ["Fall"], "row": {"id": "r3", "incident_category": "Fall"}}]},
        ov)
    check("incidents: the categories split as the door splits them; a client change goes to its door",
          incs["rows"][0]["categories"] == ["Fall", "Medication (missed, late)"]
          and incs["categories"] == ["Fall", "Medication (missed, late)"] and isinstance(moved, str), incs)
    undone = eo.undo_slice("workOrders", est, ov.refuse([e["id"] for e in ov.layer("workOrders", "slice:workOrders")],
                                                        "validation 400"), ov)
    check("rollback: a refused edit's prior value goes back into the slice it was laid into",
          undone["rows"][0]["status"] == "Open", undone)

    # ---- the sweep ----
    stray = ov.add(rep[0], AUTHOR)[0]
    clock.t += eo.UNBOUND_S + 1
    swept = ov.sweep()
    check("sweep: an edit that never reached the queue is refused, not laid forever",
          any(e["id"] == stray["id"] for e in swept["unbound"]) and ov.get(stray["id"])["state"] == "refused")
    clock.t += eo.RETIRE_AFTER_S + 1
    ov.sweep()
    check("sweep: a written edit no source confirmed stops being laid after its time",
          ov.get(a["id"])["state"] == "retired")
    clock.t += eo.KEEP_SETTLED_S + 1
    ov.sweep()
    check("sweep: the long settled are dropped from the disk", ov.get(a["id"]) is None)
    summary = ov.summary()
    check("summary: counts and the pending edits, never a cell's value",
          "Door fixed" not in json.dumps(summary) and "(330)" not in json.dumps(summary), summary)

    # ---- the editions, fail-closed ----
    listed = json.dumps([{"id": "locations.house", "on": True, "people": ["u-ann"]},
                         {"id": "locations.incidents", "on": False, "people": ["u-ann"]},
                         {"id": "made.up", "on": True, "people": ["u-ann"]}])
    eds = eo.parse_editions(listed)
    check("editions: on and named is held; off, unknown, malformed, a client role or no list is not",
          eo.holds(eds, "locations.house", "u-ann", "staff") and not eo.holds(eds, "locations.incidents", "u-ann", "staff")
          and "made.up" not in eds and eo.parse_editions("{bad") == {} and not eo.holds(eds, "locations.house", "u-ann",
                                                                                        "client")
          and not eo.holds(None, "locations.house", "u-ann", "staff"), eds)
    ov.note_editions(eds, clock.t)
    check("editions: the save the relay saw is kept across a restart",
          eo.Overlay(tmp / "edit-overlay", clock=clock).editions_seen()[0] == eds)

    # ---- the pace ----
    mono = Clock(100.0)
    pacer = eo.Pacer(per_min=60, burst_s=10, clock=mono)
    check("pace: ten seconds of writes may leave at once, then one a second", pacer.room() == 10 and pacer.wait_s(10) == 0)
    pacer.take(10)
    check("pace: an emptied bucket waits for the next write", abs(pacer.wait_s(1) - 1.0) < 1e-6, pacer.wait_s(1))
    mono.t += 1
    check("pace: and a second later it may leave", pacer.wait_s(1) == 0)
    held = pacer.pressure("429 Rate Limit Exceeded")
    check("pace: Google's pushback pauses the queue and halves the pace, twice as long the next time",
          held == eo.PAUSE_FIRST_S and pacer.wait_s(1) >= held - 1 and pacer.rate == 30 and pacer.pressure("x") == 60)
    for _ in range(100):
        pacer.relief()
    check("pace: deliveries Google takes bring the pace back to its ceiling, never past it", pacer.rate == 60)
    check("quota: a 429 or Google's quota sentence is a pushback; a door's own refusal is not",
          eo.quota_said(429) and eo.quota_said(500, "Service invoked too many times for one day: urlfetch")
          and not eo.quota_said(409, "Another write is in progress — try again in a moment.")
          and not eo.quota_said(400, "details: what the note says."))

    clients_profile(tmp, clock)
    clients_care(tmp, clock)
    clients_meds(tmp, clock)
    clients_transport()
    python_plans(tmp, clock)

    shutil.rmtree(tmp, ignore_errors=True)
    for f in FAILED:
        print("FAIL", f)
    print(f"edit overlay: {PASSED} passed, {len(FAILED)} failed")
    return 1 if FAILED else 0


if __name__ == "__main__":
    os.umask(0o022)
    sys.exit(main())
