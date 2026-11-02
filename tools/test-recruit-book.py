#!/usr/bin/env python3
"""The recruiters' book relay half, offline; the Apps Script half is its own self-test section."""
import json
import os
import re
import stat
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve()
REPO = HERE.parent.parent
SERVER = REPO / "server"
GS = REPO / "apps-script"
sys.path.insert(0, str(SERVER))
sys.path.insert(0, str(HERE.parent))

import recruit_book as rb  # noqa: E402

results = {"ok": 0, "failed": []}


def check(name, cond, detail=None):
    if cond:
        results["ok"] += 1
        print(f"  ok   {name}")
    else:
        results["failed"].append(name)
        print(f"  FAIL {name}")
        if detail is not None:
            print(f"       {str(detail)[:900]}")


def at(iso):
    return datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp()


# names are New York times; the fixture's week is under daylight saving (UTC-4)
WED_0805 = at("2026-09-23T12:05:00Z")
WED_0730 = at("2026-09-23T11:30:00Z")
WED_1130 = at("2026-09-23T15:30:00Z")
WED_1000 = at("2026-09-23T14:00:00Z")
WED_1800 = at("2026-09-23T22:00:00Z")
SAT_1000 = at("2026-09-26T14:00:00Z")
MON_1000 = at("2026-09-21T14:00:00Z")
FRI_1000 = at("2026-09-25T14:00:00Z")

PIPE_HEADER = ["DL", "Hire ?", "Status", "Candidate Name", "First Name", "Phone", "Screener",
               "Screen Date", "Screen Time", "Screen Location", "CJIS Findings", "PS Notes", "Hire?"]
ONB_HEADER = ["Status", "Candidate Name", "First Name", "Phone", "Email", "Background Check", "Notes"]


def pipe(row, **kw):
    base = {"_row": row, "Hire ?": "", "Status": "3 - In Person", "Candidate Name": f"Cand {row}",
            "First Name": f"First{row}", "Phone": f"330-555-{row:04d}", "Screener": "Tieara",
            "Screen Date": "Wednesday, September 23, 2026", "Screen Time": "11AM",
            "Screen Location": "1305 49th St, NW, Canton.", "CJIS Findings": "SECRET FINDING",
            "PS Notes": "private note", "DL": "y", "Hire?": ""}
    base.update(kw)
    return base


def onb(row, **kw):
    base = {"_row": row, "Status": "Pending", "Candidate Name": f"New {row}", "First Name": f"New{row}",
            "Phone": f"330-555-{row:04d}", "Email": f"n{row}@example.org", "Background Check": "",
            "Notes": "private"}
    base.update(kw)
    return base


def master_dir(pipe_rows, onb_rows, *, written_at=None, status="ok", drop_tab=None, book=True):
    root = Path(tempfile.mkdtemp(prefix="rb-master-"))
    (root / "books").mkdir()
    bid = rb.SOURCE_BOOK_ID
    tabs_index, tabs_manifest = [], []
    for name, header, rows in (("Talent Pipeline", PIPE_HEADER, pipe_rows),
                               ("Onboarding Checklist", ONB_HEADER, onb_rows)):
        if name == drop_tab:
            continue
        f = f"books/{bid}.{abs(hash(name)) % 10**12:012d}.0.json"
        part = {"format": "hub-master-json/1", "id": bid, "tab": name, "part": 0,
                "header": header, "count": len(rows),
                "rows": [[r["_row"]] + [r.get(h) for h in header] for r in rows]}
        (root / f).write_text(json.dumps(part))
        tabs_index.append({"tab": name, "parts": [f]})
        tabs_manifest.append({"tab": name, "rows": len(rows), "stale": False})
    (root / f"books/{bid}.json").write_text(json.dumps(
        {"format": "hub-master-json/1", "id": bid, "name": "0 - New Hire and Candidate Portal",
         "tabs": tabs_index}))
    books = []
    if book:
        books.append({"id": bid, "name": "0 - New Hire and Candidate Portal", "file": f"books/{bid}.json",
                      "synced_at": "2026-09-23T11:00:00Z", "modified_time": "2026-09-23T10:55:00Z",
                      "status": status, "tabs": tabs_manifest})
    (root / "manifest.json").write_text(json.dumps(
        {"format": "hub-master-json/1", "written_at": written_at or rb._iso(time.time()), "books": books}))
    return root


def cards_file(phones, built_at=None):
    p = Path(tempfile.mkdtemp(prefix="rb-cards-")) / "candidates.json"
    p.write_text(json.dumps({"resource": "candidates", "built_at": built_at or rb._iso(time.time()),
                             "rows": [{"id": f"C{i}", "phone": ph} for i, ph in enumerate(phones)]}))
    return p


def copy_of(pipe_rows, onb_rows, now=None):
    src = rb.read_source(master_dir(pipe_rows, onb_rows, written_at=rb._iso(now or time.time())),
                         now=now or time.time())
    assert src["ok"], src["why"]
    return rb.build_copy(src, now)


def cards(phones):
    return {"ok": True, "why": "", "at": "x", "phones": {rb.phone10(p) for p in phones}}


def fresh_state():
    return rb.load_state(Path(tempfile.mkdtemp(prefix="rb-state-")) / "state.json")


def prove(st, d):
    for h in rb.TABS:
        st["houses"][h] = {"proved": d["tabs"][h]["fingerprint"], "state": "written"}
    return st


def ready(d, birth=True):
    """Past its birth and its houses hold `d`: every rule may speak."""
    st = prove(fresh_state(), d)
    if birth:
        st["birth"] = {"at": "x", "baseline": 0}
    return st


print("the book's own spellings")
check("the Screen Date is read in every shape the book types it, and nothing else is a date",
      rb.parse_day("Wednesday, September 23, 2026").isoformat() == "2026-09-23" and
      rb.parse_day("9/23/26").isoformat() == "2026-09-23" and rb.parse_day("09/03/2026").isoformat() == "2026-09-03"
      and rb.parse_day("Sept 3, 2026").isoformat() == "2026-09-03" and rb.parse_day("#N/A") is None
      and rb.parse_day("") is None and rb.parse_day("13/40/26") is None)
check("the Screen Time is read as the book types it, and a word is not a time",
      rb.parse_time("11AM") == (11, 0) and rb.parse_time("4:30 PM") == (16, 30) and
      rb.parse_time("11:00 AM") == (11, 0) and rb.parse_time("12PM") == (12, 0) and
      rb.parse_time("12AM") == (0, 0) and rb.parse_time("13:30") == (13, 30) and rb.parse_time("noon") is None)
check("…and the spellings the recruiters really type: no colon, seconds, a stray quote",
      rb.parse_time("230PM") == (14, 30) and rb.parse_time("930AM") == (9, 30) and
      rb.parse_time("1130AM") == (11, 30) and rb.parse_time("1230PM") == (12, 30) and
      rb.parse_time("130PM") == (13, 30) and rb.parse_time("330PM") == (15, 30) and
      rb.parse_time("11AM'") == (11, 0) and rb.parse_time("10:00:00 AM") == (10, 0) and
      rb.parse_time("1 p.m.") == (13, 0) and rb.parse_time("1330") is None and rb.parse_time("1260PM") is None
      and rb.parse_time("13PM") is None)
check("an hour is written back the way the book and Arthur write one",
      rb.time_words((16, 30)) == "4:30PM" and rb.time_words((11, 0)) == "11AM" and rb.time_words((12, 0)) == "12PM")
check("a place loses its closing full stop, and #N/A is no place",
      rb.clean_place("1305 49th St, NW, Canton.") == "1305 49th St, NW, Canton" and rb.clean_place("#N/A") == ""
      and rb.clean_place("  ") == "")
check("a phone is ten digits or nothing — a leading country 1 dropped",
      rb.phone10("(330) 555-0101") == "3305550101" and rb.phone10("+1 330 555 0101") == "3305550101" and
      rb.phone10("555-0101") == "" and rb.phone10("Yes") == "")

print("their book, from the platform's own copy")
now = time.time()
good = rb.read_source(master_dir([pipe(2), pipe(3)], [onb(4)]), now=now)
check("a book the keeper holds reads ok, both tabs, every row with its sheet row",
      good["ok"] and len(good["tabs"]["recruit_pipeline"]["rows"]) == 2 and
      good["tabs"]["recruit_onboarding"]["rows"][0]["_row"] == 4 and good["name"].startswith("0 - New Hire"),
      good.get("why"))
empty_root = Path(tempfile.mkdtemp())
bad = {
    "no manifest": rb.read_source(empty_root, now=now),
    "keeper stopped": rb.read_source(master_dir([pipe(2)], [onb(4)],
                                                written_at=rb._iso(now - rb.MASTER_MAX_AGE_S - 600)), now=now),
    "book not held": rb.read_source(master_dir([pipe(2)], [onb(4)], book=False), now=now),
    "book failed": rb.read_source(master_dir([pipe(2)], [onb(4)], status="failed"), now=now),
    "tab gone": rb.read_source(master_dir([pipe(2)], [onb(4)], drop_tab="Onboarding Checklist"), now=now),
    "tab empty": rb.read_source(master_dir([], [onb(4)]), now=now),
}
check("every way the read could be WRONG is ok:False with its reason — never an empty success",
      all(not v["ok"] and v["why"] and not v["tabs"] for v in bad.values()),
      {k: (v["ok"], v["why"][:60]) for k, v in bad.items()})
check("the reasons say what could not be seen, in words",
      "not on this disk" in bad["no manifest"]["why"] and "not written a round" in bad["keeper stopped"]["why"]
      and "cannot see it" in bad["book not held"]["why"] and "no rows" in bad["tab empty"]["why"], None)

print("our copy — JSON first")
doc = rb.build_copy(good, now)
hp = doc["tabs"]["recruit_pipeline"]
check("the copy leads with our own id, then the book's columns in the BOOK's order, never the mirror's",
      hp["header"][:6] == ["id", "Hire ?", "Status", "Candidate Name", "First Name", "Phone"] and
      hp["header"].index("DL") > hp["header"].index("Screen Location"), hp["header"])
check("each row's id is the tab and the book's own row — its mark of origin",
      [r[0] for r in hp["rows"]] == ["TP-2", "TP-3"] and doc["tabs"]["recruit_onboarding"]["rows"][0][0] == "OC-4")
again = rb.build_copy(good, now + 60)
check("the fingerprint is the content's: the same book twice is the same print",
      again["tabs"]["recruit_pipeline"]["fingerprint"] == hp["fingerprint"])
moved_src = rb.read_source(master_dir([pipe(2), pipe(3, Status="4 - Not Hiring")], [onb(4)]), now=now)
check("…and one cell changed is a different one",
      rb.build_copy(moved_src, now)["tabs"]["recruit_pipeline"]["fingerprint"] != hp["fingerprint"])
check("a column the book grew later is kept, after the ones named — never dropped",
      rb.house_header("recruit_pipeline", ["Status", "Brand New", "Hire ?"]) == ["id", "Hire ?", "Status", "Brand New"])

out_dir = Path(tempfile.mkdtemp(prefix="rb-out-")) / "recruit"
root_ok = master_dir([pipe(2), pipe(3)], [onb(4)])
old_master = rb.MASTER_ROOT
s1 = rb.sync(now, root=root_ok, out_dir=out_dir)
copy_file = out_dir / rb.COPY_FILE
mode_dir = stat.S_IMODE(os.stat(out_dir).st_mode)
mode_file = stat.S_IMODE(os.stat(copy_file).st_mode)
check("the first readable pass writes our copy, 0600 in a 0700 folder", s1["read"] and s1["changed"] and
      mode_dir == 0o700 and mode_file == 0o600, (s1, oct(mode_dir), oct(mode_file)))
s2 = rb.sync(now + 300, root=root_ok, out_dir=out_dir)
check("a pass over the same book writes nothing new", s2["read"] and not s2["changed"], s2)
kept = json.loads(copy_file.read_text())
s3 = rb.sync(now + 600, root=empty_root, out_dir=out_dir)
st3 = rb.load_state(out_dir / rb.STATE_FILE)
check("a pass that cannot read the book KEEPS the copy that stands and says why",
      not s3["read"] and json.loads(copy_file.read_text()) == kept and st3["source"]["state"] == "unread" and
      "not on this disk" in st3["source"]["why"], st3["source"])

print("the houses — the sheet after the JSON")
offers = rb.house_offer(now, out_dir=out_dir)
check("a house not proved to hold the copy is offered it, both tabs, header and rows",
      sorted(o["tab"] for o in offers) == ["recruit_onboarding", "recruit_pipeline"] and
      all(o["header"][0] == "id" and o["rows"] and o["fingerprint"] for o in offers), [o["tab"] for o in offers])
pip = [o for o in offers if o["tab"] == "recruit_pipeline"][0]
check("the offer never carries the ledger or our state — only the copy and where it came from",
      set(pip) == {"tab", "source_tab", "header", "rows", "fingerprint", "source"}, sorted(pip))
rb.house_mark(pip, {"state": "written", "rows": len(pip["rows"]), "fingerprint": pip["fingerprint"]}, "",
              now, out_dir=out_dir)
onbo = [o for o in offers if o["tab"] == "recruit_onboarding"][0]
rb.house_mark(onbo, {"state": "written", "rows": 99, "fingerprint": onbo["fingerprint"]}, "", now, out_dir=out_dir)
st = rb.load_state(out_dir / rb.STATE_FILE)
check("`written` with the same rows and print is proof; a door that wrote a different count proves nothing",
      st["houses"]["recruit_pipeline"]["proved"] == pip["fingerprint"] and
      st["houses"]["recruit_onboarding"].get("proved") is None and
      st["houses"]["recruit_onboarding"]["state"] == "failed", st["houses"])
check("a proved house is not offered again, and an unproved one waits out HOUSE_EVERY_S",
      rb.house_offer(now + 60, out_dir=out_dir) == [] and
      [o["tab"] for o in rb.house_offer(now + rb.HOUSE_EVERY_S + 1, out_dir=out_dir)] == ["recruit_onboarding"])
rb.sync(now + 700, root=master_dir([pipe(2), pipe(3, Status="4 - Not Hiring")], [onb(4)]), out_dir=out_dir)
check("a copy that changed after a PROVED write is offered on the next pass — the texts wait for the house",
      [o["tab"] for o in rb.house_offer(now + 710, out_dir=out_dir)] == ["recruit_pipeline"])
rb.house_mark(onbo, {}, "the door could not be reached (TimeoutError)", now, out_dir=out_dir)
check("a door that could not be reached is written down as failed, with the reason",
      "could not be reached" in rb.load_state(out_dir / rb.STATE_FILE)["houses"]["recruit_onboarding"]["why"])
empty_copy_dir = Path(tempfile.mkdtemp(prefix="rb-empty-"))
rb._write(empty_copy_dir / rb.COPY_FILE, {"tabs": {"recruit_pipeline": {"rows": [], "header": ["id"],
                                                                         "fingerprint": "x"}}})
check("an empty copy is never offered — a house is never emptied by a bad read",
      rb.house_offer(now, out_dir=empty_copy_dir) == [])

print("the screen on the day")
pipes = [pipe(10), pipe(11, **{"Screen Time": "2:30 PM"}),
         pipe(12, Status="4 - Not Hiring"), pipe(13, **{"Hire ?": "Yes"}),
         pipe(14, Phone=""), pipe(15, **{"Screen Time": "whenever"}), pipe(16, **{"Screen Location": "#N/A"}),
         pipe(17, Screener=""), pipe(18, **{"Screen Date": "Thursday, September 24, 2026"}),
         pipe(19, Phone="330-555-0010"),                   # the same screen as row 10, typed twice
         pipe(20, **{"Screen Date": "9/22/26"})]
d = copy_of(pipes, [onb(90, Status="No")], WED_0805)
st = ready(d)
got = rb.plan(d, st, cards([]), WED_0805, fresh_read=True)
offered = {r["source"]: r for r in got["rows"] if r["situation"] == rb.SCREEN}
check("at 08:05 the screens of today still at 3 - In Person with a phone, time, place and screener are owed",
      sorted(offered) == ["TP-10", "TP-11"], sorted(offered))
r10 = offered.get("TP-10", {})
check("the offer says the hour as the book does, the place without its full stop, the screener, and the start",
      r10.get("time") == "11AM" and r10.get("location") == "1305 49th St, NW, Canton" and
      r10.get("screener") == "Tieara" and r10.get("deadline") == "2026-09-23T15:00:00Z" and
      r10.get("phone") == "+13305550010" and offered.get("TP-11", {}).get("time") == "2:30PM", r10)
view = {s["source"]: s for s in rb.screens(d, cards([]), WED_0805, days=2)}
check("every screen not owed says why, in words",
      "only a screen still at 3 - In Person" in view["TP-12"]["why"] and "already decided" in view["TP-13"]["why"]
      and "no phone" in view["TP-14"]["why"] and "no screen time" in view["TP-15"]["why"]
      and "no screen location" in view["TP-16"]["why"] and "no screener" in view["TP-17"]["why"]
      and "another row" in view["TP-19"]["why"] and view["TP-18"]["verdict"] == "waiting"
      and "TP-20" not in view, {k: v["why"][:40] for k, v in view.items()})
check("the same screen typed on two rows is offered once", "TP-19" not in offered)
st_q = ready(d)
q = rb.plan(d, st_q, cards([]), WED_0730, fresh_read=True)
check("inside the quiet window nothing is offered, and the page says the screen waits for 08:00",
      q["rows"] == [] and "quiet window" in q["held_why"] and
      {s["source"]: s for s in rb.screens(d, cards([]), WED_0730)}["TP-10"]["verdict"] == "waiting", q["held_why"])
late = rb.plan(d, ready(d), cards([]), WED_1130, fresh_read=True)
check("a screen that has started is not reminded (the 2:30 one still is)",
      [r["source"] for r in late["rows"] if r["situation"] == rb.SCREEN] == ["TP-11"] and
      {s["source"]: s for s in rb.screens(d, cards([]), WED_1130)}["TP-10"]["verdict"] == "passed")
hub = rb.plan(d, ready(d), cards(["+1 330 555 0010"]), WED_0805, fresh_read=True)
check("a Hub card is never texted from the book — matched by phone",
      "TP-10" not in [r["source"] for r in hub["rows"]] and
      {s["source"]: s for s in rb.screens(d, cards(["3305550010"]), WED_0805)}["TP-10"]["verdict"] == "hub_card")
blind = rb.plan(d, ready(d), {"ok": False, "why": "the hiring board's file is too old", "phones": set()},
                WED_0805, fresh_read=True)
check("a hiring board nobody can read offers NOTHING, and says so",
      blind["rows"] == [] and "too old" in blind["held_why"], blind["held_why"])
check("no copy yet is nothing offered, said", "no copy" in rb.plan(None, fresh_state(), cards([]), WED_0805, True)["held_why"])
st_unread = ready(d)
st_unread["source"] = {"state": "unread", "why": "the sheet keeper has not written a round since Monday"}
unread = rb.plan(d, st_unread, cards([]), WED_0805, fresh_read=False)
check("a book that could not be read this pass offers NOTHING from the copy that stands, and says why",
      unread["rows"] == [] and "could not be read" in unread["held_why"] and "old copy" in unread["held_why"]
      and "keeper" in unread["held_why"], unread)
never = rb.plan(d, fresh_state(), cards([]), WED_0805, fresh_read=True)
behind = ready(d)
behind["houses"]["recruit_pipeline"]["proved"] = "an-older-copy"
lag = rb.plan(d, behind, cards([]), WED_0805, fresh_read=True)
check("nothing is texted until both houses of ours hold THIS copy — never minted, or holding an older one",
      never["rows"] == [] and "never been written" in never["held_why"] and
      lag["rows"] == [] and "does not hold this copy" in lag["held_why"], (never["held_why"], lag["held_why"]))

print("the onboarding start — a transition, never a state")
p_yes = [pipe(30, **{"Hire ?": "Yes", "Screen Date": "", "Status": "5 - Onboarding", "Screener": "Joan"}),
         pipe(31, **{"Hire ?": "Yes", "Screen Date": ""}), pipe(32, **{"Hire ?": "No", "Screen Date": ""})]
o_pend = [onb(40), onb(41, Status="Yes"), onb(42, Phone="330-555-0030")]    # 42 is row 30's person
d0 = copy_of(p_yes, o_pend, WED_1000)
st = prove(fresh_state(), d0)
born = rb.plan(d0, st, cards([]), WED_1000, fresh_read=True)
check("the first readable pass writes everybody already passed down as `baseline` and tells none of them",
      [r for r in born["rows"] if r["situation"] == rb.ONBOARD] == [] and st["birth"]["baseline"] == 3 and
      sum(1 for e in st["ledger"].values() if e["state"] == "baseline") == 3, st["birth"])
d1 = copy_of(p_yes + [pipe(33, **{"Hire ?": "Yes", "Screen Date": "", "Screener": "George"})],
             o_pend + [onb(43), onb(44, Phone="330-555-0033")], WED_1000 + 600)
nxt = rb.plan(d1, prove(st, d1), cards([]), WED_1000 + 600, fresh_read=True)
ob = [r for r in nxt["rows"] if r["situation"] == rb.ONBOARD]
check("a candidate who passes after the birth is owed once — the same person on both tabs is one text",
      sorted(r["phone"] for r in ob) == ["+13305550033", "+13305550043"], [r["phone"] for r in ob])
check("the onboarding text names the Talent Pipeline's screener for that phone",
      [r["screener"] for r in ob if r["phone"] == "+13305550033"] == ["George"], ob)
st_stale = prove(fresh_state(), d0)
rb.plan(d0, st_stale, cards([]), WED_1000, fresh_read=True)
rb.plan(d1, prove(st_stale, d1), cards(["3305550043"]), WED_1000 + 600, fresh_read=True)
rb.plan(d1, st_stale, cards([]), WED_1000 + 600 + rb.ONBOARD_FRESH_S + 60, fresh_read=True)
states = {k.split("|")[1]: e["state"] for k, e in st_stale["ledger"].items() if e["situation"] == rb.ONBOARD}
check("told within 72 hours of the book saying so or never (never a week late); a Hub card is closed as one",
      states.get("3305550033") == "stale" and states.get("3305550043") == "hub_card", states)
st_nf = prove(fresh_state(), d0)
rb.plan(d0, st_nf, cards([]), WED_1000, fresh_read=True)
nf = rb.plan(d1, prove(st_nf, d1), cards([]), WED_1000 + 600, fresh_read=False)
check("a pass that did not read the book this time sees no transition", [r for r in nf["rows"]
                                                                            if r["situation"] == rb.ONBOARD] == [])
st_nb = fresh_state()
rb.plan(d1, st_nb, cards([]), WED_1000, fresh_read=False)
check("no birth from a copy this pass did not read", st_nb.get("birth") is None)
st_gap = prove(fresh_state(), d0)
rb.plan(d0, st_gap, cards([]), WED_1000, fresh_read=True)
gap = rb.plan(d1, prove(st_gap, d1), cards([]), WED_1000 + 5 * 86400, fresh_read=True)
gap_states = {k.split("|")[1]: e for k, e in st_gap["ledger"].items() if e["situation"] == rb.ONBOARD}
check("after five days the lane could not read the book, a candidate first seen now is closed as stale — "
      "their 72 hours started at the last read, never told days late",
      [r for r in gap["rows"] if r["situation"] == rb.ONBOARD] == [] and
      gap_states.get("3305550033", {}).get("state") == "stale" and
      gap_states.get("3305550033", {}).get("first_seen") == rb._iso(WED_1000), gap_states.get("3305550033"))
st_night = prove(fresh_state(), d0)
rb.plan(d0, st_night, cards([]), WED_1000, fresh_read=True)
rb.plan(d1, prove(st_night, d1), cards([]), WED_1800 + 4 * 3600, fresh_read=True)
morning = rb.plan(d1, st_night, cards([]), WED_1800 + 14 * 3600 + 300, fresh_read=True)
check("a candidate who passes at night is written down at night and told in the morning",
      sorted(r["phone"] for r in morning["rows"] if r["situation"] == rb.ONBOARD) ==
      ["+13305550033", "+13305550043"], [r["phone"] for r in morning["rows"]])

print("the True Hire how-to")
o_bci = [onb(50, **{"Background Check": "n"}), onb(51, Status="Yes", **{"Background Check": " N "}),
         onb(52, **{"Background Check": "y"}), onb(53, Status="No", **{"Background Check": "n"}),
         onb(54, Phone="")]
db = copy_of([pipe(5, **{"Screen Date": ""})], o_bci, MON_1000)
st = prove(fresh_state(), db)
first = rb.plan(db, st, cards([]), MON_1000, fresh_read=True)
tue = rb.plan(db, st, cards([]), MON_1000 + 86400, fresh_read=True)
g = rb.plan(db, st, cards([]), WED_1000, fresh_read=True)
bci_rows = [r for r in g["rows"] if r["situation"] == rb.BCI]
check("the how-to is written down the day the book first shows the check undone, and waits — its words say "
      "\"still not completed\"",
      [r for r in first["rows"] + tue["rows"] if r["situation"] == rb.BCI] == [] and
      st["ledger"].get(f"{rb.BCI}|3305550050", {}).get("first_seen") == rb._iso(MON_1000),
      [r["source"] for r in first["rows"] + tue["rows"]])
check("on a weekday in True Hire's hours, BCI_AFTER_DAYS business days on, Pending or Yes with Background Check n "
      "is owed — y, No and no phone are not",
      sorted(r["source"] for r in bci_rows) == ["OC-50", "OC-51"] and all(r["slot"] == 1 for r in bci_rows),
      [r["source"] for r in bci_rows])
check("the business days skip the weekend: first seen on a Friday, two business days is the Tuesday",
      rb.business_days_since(rb._iso(FRI_1000), FRI_1000 + 3 * 86400) == 1 and
      rb.business_days_since(rb._iso(FRI_1000), FRI_1000 + 4 * 86400) == 2)
db_new = copy_of([pipe(5, **{"Screen Date": ""})], o_bci, WED_1000)
st_new = ready(db_new)
g_new = rb.plan(db_new, st_new, cards([]), WED_1000, fresh_read=True)
g_new2 = rb.plan(db_new, st_new, cards([]), WED_1000 + rb.PASS_EVERY_S, fresh_read=True)
check("a Pending row that just arrived hears the onboarding start — and the how-to is NOT the next pass's text",
      [(r["situation"], r["source"]) for r in g_new["rows"] if r["phone"] == "+13305550050"] ==
      [(rb.ONBOARD, "OC-50")] and [r for r in g_new2["rows"] if r["situation"] == rb.BCI] == [],
      [(r["situation"], r["source"]) for r in g_new["rows"] + g_new2["rows"]])
st_sat = prove(fresh_state(), db)
rb.plan(db, st_sat, cards([]), MON_1000, True)
st_eve = prove(fresh_state(), db)
rb.plan(db, st_eve, cards([]), MON_1000, True)
check("on a Saturday, or at six in the evening, it waits",
      [r for r in rb.plan(db, st_sat, cards([]), SAT_1000, True)["rows"] if r["situation"] == rb.BCI] == [] and
      [r for r in rb.plan(db, st_eve, cards([]), WED_1800, True)["rows"] if r["situation"] == rb.BCI] == [])
db_gone = copy_of([pipe(5, **{"Screen Date": ""})], [onb(50, **{"Background Check": "y"})], MON_1000)
st_gone = prove(fresh_state(), db)
rb.plan(db, st_gone, cards([]), MON_1000, True)
rb.plan(db_gone, prove(st_gone, db_gone), cards([]), MON_1000 + 3600, True)
check("a how-to that was only waiting is forgotten once the book shows the check done — never left on the page "
      "as owed", f"{rb.BCI}|3305550050" not in st_gone["ledger"], sorted(st_gone["ledger"]))
rb.mark_offered(st, bci_rows, WED_1000)
rb.posted(st, bci_rows, {"results": [{"id": bci_rows[0]["id"], "state": "told", "max": 1, "gap_days": 0},
                                     {"id": bci_rows[1]["id"], "state": "recorded", "max": 3, "gap_days": 2}]},
          "", WED_1000 + 5)
g2 = rb.plan(db, st, cards([]), WED_1000 + 3600, True)
check("told once with the Desk at `once` is never asked again; a row asking for repeats waits out its gap",
      [r for r in g2["rows"] if r["situation"] == rb.BCI] == [], [r["source"] for r in g2["rows"]])
g3 = rb.plan(db, st, cards([]), WED_1000 + 2 * 86400 + 60, True)
rep = [r for r in g3["rows"] if r["situation"] == rb.BCI]
check("…and after the gap only the row that asked for repeats is owed again, as its second telling",
      [(r["source"], r["slot"]) for r in rep] == [("OC-51", 2)] and rep[0]["id"] != bci_rows[1]["id"],
      [(r["source"], r["slot"]) for r in rep])
db_done = copy_of([pipe(5, **{"Screen Date": ""})], [onb(51, Status="Yes", **{"Background Check": "y"})], WED_1000)
check("once the book says the check is done, nobody is asked again",
      [r for r in rb.plan(db_done, prove(st, db_done), cards([]), WED_1000 + 4 * 86400, True)["rows"]
       if r["situation"] == rb.BCI] == [])

print("one person, one text a pass")
both = copy_of([pipe(60, **{"Hire ?": ""})], [onb(60, **{"Background Check": "n"})], WED_1000)
st = ready(both)
st["ledger"][f"{rb.BCI}|3305550060"] = {"situation": rb.BCI, "state": "owed", "first_seen": rb._iso(MON_1000),
                                         "offers": 0, "count": 0}
g = rb.plan(both, st, cards([]), WED_1000, True)
check("a person owed the screen reminder and the how-to hears the reminder this pass, the how-to after",
      [r["situation"] for r in g["rows"] if r["phone"] == "+13305550060"] == [rb.SCREEN])
many = copy_of([pipe(100 + i) for i in range(30)], [onb(9, Status="No")], WED_0805)
st = ready(many)
check("one post carries at most MAX_PER_POST texts; the rest wait for the next pass",
      len(rb.plan(many, st, cards([]), WED_0805, True)["rows"]) == rb.MAX_PER_POST)

print("what the door said")
st = fresh_state()
row = {"id": "RB-x", "key": "k1", "situation": rb.SCREEN, "slot": 1}
rb.mark_offered(st, [row], 1000.0)
check("the offer is written down BEFORE the post leaves", st["ledger"]["k1"]["state"] == "offered" and
      st["ledger"]["k1"]["offers"] == 1)
check("an offer never answered is offered again after RETRY_S — the door's key makes that safe",
      not rb.due(st["ledger"]["k1"], 1000.0 + 10) and rb.due(st["ledger"]["k1"], 1000.0 + rb.RETRY_S + 1))
for state_, later, want in (("refused_quiet", 1, True), ("dial_unknown", rb.DIAL_RETRY_S - 5, False),
                            ("dial_unknown", rb.DIAL_RETRY_S + 5, True), ("held", 3600, False),
                            ("held", rb.HELD_RETRY_S + 5, True), ("told", 10 ** 7, False),
                            ("recorded", 10 ** 7, False), ("stale", 10 ** 7, False)):
    e = {"state": state_, "said_at": rb._iso(1000.0)}
    check(f"`{state_}` {'is' if want else 'is not'} offered again {later}s later", rb.due(e, 1000.0 + later) is want)
st = fresh_state()
for i in range(rb.FAILED_OFFERS):
    rb.posted(st, [row], None, "the door could not be reached (ConnectionError)", 1000.0 + i)
check(f"a door that fails {rb.FAILED_OFFERS} times gives up, and says how often",
      st["ledger"]["k1"]["state"] == "gave_up" and "failed 3 times" in st["ledger"]["k1"]["why"],
      st["ledger"]["k1"])
st = fresh_state()
rb.posted(st, [row], {"results": [{"id": "RB-x", "state": "sparkled", "why": "?"}]}, "", 1000.0)
check("an answer this lane does not know is `failed`, never taken as done", st["ledger"]["k1"]["state"] == "failed")
st = fresh_state()
rb.posted(st, [row], {"results": []}, "", 1000.0)
check("a door that answered and said nothing about a row is `failed` for that row",
      st["ledger"]["k1"]["state"] == "failed")
st = fresh_state()
rb.posted(st, [row], {"results": [{"id": "RB-x", "state": "recorded", "why": "nobody was contacted",
                                   "words": "W" * 4000, "words_chars": 4600, "to_masked": "•••0101",
                                   "line": "Administration", "channel": "sms"}]}, "", 1000.0)
e1 = st["ledger"]["k1"]
check("a held text keeps the copy the door answered — the words, their whole length, the masked number, the "
      "line and the channel",
      e1["state"] == "recorded" and e1["words"] == "W" * 4000 and e1["words_chars"] == 4600
      and e1["to_masked"] == "•••0101" and e1["line"] == "Administration" and e1["channel"] == "sms",
      {k: e1.get(k) for k in rb.MESSAGE_FIELDS if k in e1})
rb.posted(st, [row], {"results": [{"id": "RB-x", "state": "recorded", "why": "nobody was contacted",
                                   "words": "W" * 4500, "channel": "sms"}]}, "", 1500.0)
check("words past the cut are cut here as the mock outbox cuts them, and their whole length is kept, so the page "
      "says the copy is the first part — never a whole-looking text",
      st["ledger"]["k1"]["words"] == "W" * 4000 and st["ledger"]["k1"]["words_chars"] == 4500,
      {"words": len(st["ledger"]["k1"]["words"]), "chars": st["ledger"]["k1"]["words_chars"]})
rb.posted(st, [row], {"results": [{"id": "RB-x", "state": "dial_off", "why": "the dial is off"}]}, "", 2000.0)
check("an answer taken before the words were composed leaves none behind — never the copy of an older one",
      all(st["ledger"]["k1"][f] == "" for f, _ in rb.COPY_FIELDS) and st["ledger"]["k1"]["words_chars"] == 0,
      st["ledger"]["k1"])
OLD_COPY = {"words": "OLD WORDS", "words_chars": 9, "to_masked": "•••0101", "line": "Administration",
            "channel": "sms"}


def copy_gone(entry):
    return all(entry.get(f) == "" for f, _ in rb.COPY_FIELDS) and entry.get("words_chars") == 0


st = fresh_state()
rb.posted(st, [row], {"results": [dict(OLD_COPY, id="RB-x", state="recorded", why="nobody was contacted")]},
          "", 1000.0)
rb.mark_offered(st, [row], 2000.0)
check("an offer carries no copy — the words of the telling before it never stand under `Waiting for the door`",
      st["ledger"]["k1"]["state"] == "offered" and copy_gone(st["ledger"]["k1"]), st["ledger"]["k1"])
st_cc = prove(fresh_state(), d0)
rb.plan(d0, st_cc, cards([]), WED_1000, fresh_read=True)
rb.plan(d1, prove(st_cc, d1), cards([]), WED_1000 + 600, fresh_read=True)
for p in ("3305550033", "3305550043"):
    st_cc["ledger"][f"{rb.ONBOARD}|{p}"].update(dict(OLD_COPY, state="held", said_at=rb._iso(WED_1000 + 600)))
rb.plan(d1, st_cc, cards(["3305550043"]), WED_1000 + 1200, fresh_read=True)
rb.plan(d1, st_cc, cards([]), WED_1000 + 600 + rb.ONBOARD_FRESH_S + 60, fresh_read=True)
e_stale = st_cc["ledger"][f"{rb.ONBOARD}|3305550033"]
e_card = st_cc["ledger"][f"{rb.ONBOARD}|3305550043"]
check("a text closed as too late, or handed to the hiring board, carries no copy of the attempt before it",
      e_stale["state"] == "stale" and copy_gone(e_stale) and e_card["state"] == "hub_card" and copy_gone(e_card),
      {"stale": e_stale, "card": e_card})
st_bh = prove(fresh_state(), db)
st_bh["ledger"][f"{rb.BCI}|3305550050"] = dict(OLD_COPY, situation=rb.BCI, state="failed",
                                               first_seen=rb._iso(MON_1000), offers=1, count=0)
rb.plan(db, st_bh, cards(["3305550050"]), WED_1000, True)
e_bh = st_bh["ledger"][f"{rb.BCI}|3305550050"]
check("a how-to handed to the hiring board carries no copy of the attempt before it",
      e_bh["state"] == "hub_card" and copy_gone(e_bh), e_bh)
gs = (GS / "CommRecruit.gs").read_text(encoding="utf-8")
check("the door answers the copy for every state it decides after the words exist, with its whole length, and "
      "the number it names is masked",
      "res.words = String(body).slice(0, RECRUIT_WORDS_MAX)" in gs and "rpcMaskTo_(num.to)" in gs
      and "res.words_chars = String(body).length" in gs
      and gs.find("res.words =") < gs.find("commDialHandsOver_(env.dial)")
      and gs.find("res.words =") > gs.find("var body = smartRender_"))
mock_gs = (GS / "CommMock.gs").read_text(encoding="utf-8")
door_cut = re.search(r"var RECRUIT_WORDS_MAX = (\d+);", gs)
mock_cut = re.search(r"body: body\.slice\(0, (\d+)\),\s*body_chars: body\.length", mock_gs)
check("the door, the relay and the mock outbox cut a body at the same length, so the page's copy is the mock's",
      door_cut and mock_cut and int(door_cut.group(1)) == int(mock_cut.group(1)) == dict(rb.COPY_FIELDS)["words"],
      {"door": door_cut and door_cut.group(1), "mock": mock_cut and mock_cut.group(1),
       "relay": dict(rb.COPY_FIELDS)["words"]})
door_states = set(re.findall(r"done\('([a-z_]+)'", gs)) | set(re.findall(r"state: '([a-z_]+)'", gs))
unknown = sorted(s for s in door_states if s not in rb.FINAL and s not in rb.NOT_NOW)
check("every answer CommRecruit.gs can give is one this ledger knows", door_states and not unknown,
      {"door": sorted(door_states), "unknown": unknown})
check("what crosses to the door never carries the ledger key (it spells the phone)",
      all("key" not in r for r in rb.door_rows([{"id": "a", "key": "hiring|3305550101", "phone": "+1"}])))

print("the page's slice")
page_dir = Path(tempfile.mkdtemp(prefix="rb-page-")) / "recruit"
rb.sync(WED_0805, root=master_dir(pipes, [onb(90, Status="No")], written_at=rb._iso(WED_0805)), out_dir=page_dir)
for o in rb.house_offer(WED_0805, out_dir=page_dir):
    rb.house_mark(o, {"state": "written", "rows": len(o["rows"]), "fingerprint": o["fingerprint"]}, "",
                  WED_0805, out_dir=page_dir)
cf = cards_file([], built_at=rb._iso(WED_0805))
got = rb.pending(WED_0805, out_dir=page_dir, cards_path=cf)
SAID_WORDS = "Hello, this is Arthur from Asa Life Care."
rb.mark(got["rows"], {"results": [{"id": r["id"], "state": "recorded", "why": "nobody was contacted",
                                   "words": SAID_WORDS, "words_chars": len(SAID_WORDS),
                                   "to_masked": "•••0101", "line": "Administration", "channel": "sms"}
                                  for r in got["rows"]]}, "", WED_0805 + 5, out_dir=page_dir)
rows, source_at = rb.build_slice(out_dir=page_dir, cards_path=cf, now=WED_0805 + 10)
blob = json.dumps(rows)
check("the first row is the lane's own state, and a screen the door recorded says so",
      rows[0]["row_kind"] == "status" and rows[0]["source_state"] == "read" and
      any(r["row_kind"] == "screen" and r["source"] == "TP-10" and r["verdict"] == "recorded" for r in rows),
      rows[:2])
# ids are keyed hex digests (asserted below), so only the other values are scanned
blob_values = json.dumps([{k: v for k, v in r.items() if k != "id"} for r in rows])
check("the slice carries no phone number, no note and no finding — only the last four digits",
      not re.search(r"\d{3}\D?\d{3}\D?\d{4}", blob_values) and "SECRET FINDING" not in blob and "private note" not in blob
      and "@example.org" not in blob and all(len(r.get("last4", "")) in (0, 4) for r in rows), blob[:400])
check("every row carries only the fields its kind allows",
      all(set(r) <= set({"status": rb.STATUS_FIELDS, "screen": rb.SCREEN_FIELDS,
                         "message": rb.MESSAGE_FIELDS}[r["row_kind"]]) for r in rows))
check("the slice is dated by the lane's last plan", source_at == rb._iso(WED_0805))
held_rows = [r for r in rows if r["row_kind"] == "message" and r["state"] == "recorded"]
check("a message row carries what the held text said, to whom and from which line — the page shows the "
      "mock outbox's copy without reading that book",
      held_rows and all(r["words"] == SAID_WORDS and r["words_chars"] == len(SAID_WORDS)
                        and r["to_masked"] == "•••0101" and r["line"] == "Administration" and r["channel"] == "sms"
                        for r in held_rows),
      held_rows[:1])
msg_rows = [r for r in rows if r["row_kind"] == "message"]
led_keys = list(rb.load_state(page_dir / rb.STATE_FILE)["ledger"])
plain = {rb.occasion_id(k) for k in led_keys}
key_mode = stat.S_IMODE(os.stat(page_dir / rb.KEY_FILE).st_mode)
check("the slice's ids are keyed by the relay's own secret — never the plain hash of a key that spells the phone "
      "— and the secret is 0600 beside the ledger",
      msg_rows and not any(r["id"] in plain for r in rows) and key_mode == 0o600 and
      rb.view_id(led_keys[0], page_dir) == rb.view_id(led_keys[0], page_dir), (msg_rows[:1], oct(key_mode)))

print("the joins")
relay = (SERVER / "snapshot_service.py").read_text(encoding="utf-8")
beat = relay[relay.find("async def _psi_attendance_loop"):relay.find("async def _psi_attendance_loop") + 4000]
check("the minute beat rings the lane right after the covered follow-up",
      "await _open_shift_covered_post()\n        await _recruit_book_post()" in beat)
fn = relay[relay.find("async def _recruit_book_post"):relay.find("async def _psi_reminders_post")]
check("the lane posts to Python's doors by their literal names",
      '_backend_pass(COMM_RECRUIT_APP, "recruitBookIngest", offer)' in fn
      and '_backend_row_passes(COMM_RECRUIT_APP, "recruitTell"' in fn, None)
check("the lane is imported lazily, so the in-container suites need no new module",
      "import recruit_book  # noqa: PLC0415" in fn and "\nimport recruit_book" not in relay)
check("JSON first: the copy is written before the houses are offered, and the texts after",
      fn.find("recruit_book.sync") < fn.find("recruit_book.house_offer") < fn.find("recruit_book.pending"))
check("the texts cross without the ledger key", "recruit_book.door_rows(rows)" in fn)
check("the slice has its own branch, built from the lane's files",
      'elif resource == "recruitBook":' in relay and "recruit_book.build_slice" in relay)
svc = (GS / "ServiceIdentity.gs").read_text(encoding="utf-8")
check("both doors are on the relay's service list", "'recruitBookIngest', 'recruitTell'" in svc)

import mint_recruit_houses as mint  # noqa: E402
check("importing the mint tool reaches no network — the token is only fetched when it is run", mint.TOK == "")
m = re.search(r"var RECRUIT_HOUSES = \{([\s\S]*?)\};", gs)
door_tabs = re.findall(r"(\w+): \{ source_tab: '([^']+)'", m.group(1)) if m else []
check("the mint's houses are the door's houses, tab for tab and source for source",
      sorted(door_tabs) == sorted((h["tab"], h["source_tab"]) for h in mint.HOUSES) ==
      sorted((t, s["source_tab"]) for t, s in rb.TABS.items()), door_tabs)
check("each house is declared the way the door resolves it (HUB_HOUSE_<TAB>_ID, moved.<tab>)",
      all(h["prop"] == "HUB_HOUSE_" + h["tab"].upper() + "_ID" for h in mint.HOUSES))
check("the mint lays the header out with the relay's own function — one authority for a column",
      "recruit_book.house_header(tab, book_header(" in (HERE.parent / "mint_recruit_houses.py").read_text())
check("the mint declares where the foreign book lives, and never writes into it",
      mint.SOURCE_PROP == "RECRUIT_BOOK_ID" and mint.SOURCE_ID == rb.SOURCE_BOOK_ID and
      "values/\" + urllib.parse.quote(f\"'{source_tab}'!1:1\")" in (HERE.parent / "mint_recruit_houses.py").read_text())
emitter = (REPO / "tools" / "emit-snapshot-manifest.mjs").read_text(encoding="utf-8")
check("the manifest builds the slice here (derived) and narrows it to the hiring team",
      "'recruitBook'" in emitter and re.search(r"resource === 'recruitBook'\)[\s\S]{0,80}\['admin', 'manager'\]",
                                                emitter) is not None, None)

print()
print(f"{results['ok']} ok, {len(results['failed'])} failed")
sys.exit(1 if results["failed"] else 0)
