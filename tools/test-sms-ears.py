#!/usr/bin/env python3
"""The reply ear: words, inbox, the never-guess ladder, the pass and the lane; nothing is sent."""
import ast
import gzip
import hashlib
import json
import os
import re
import sys
import tempfile
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


if "psycopg2" not in sys.modules:  # pragma: no cover
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
os.environ.setdefault("HUB_SNAPSHOT_OUT", tempfile.mkdtemp(prefix="sms-ears-"))
import psi_reminders as pr  # noqa: E402
import shift_handoff as sh  # noqa: E402
import shift_requests as sr  # noqa: E402
import sms_ears as se  # noqa: E402


def src(name: str) -> str:
    return (SERVER / f"{name}.py").read_text(encoding="utf-8")


def fn_source(source: str, name: str) -> str:
    tree = ast.parse(source)
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)) \
                and node.name == name:
            return ast.get_source_segment(source, node) or ""
    return ""


UTC = timezone.utc
T0 = datetime(2026, 9, 23, 16, 0, tzinfo=UTC)


def quo(mid, frm, sent, text="yes", to="+13309195558", kind="message.received",
        direction="incoming", pull=False, pn=None):
    obj = {"id": mid, "object": "message", "from": frm, "to": to, "direction": direction,
           "text": text, "createdAt": sent.isoformat().replace("+00:00", "Z")}
    if pn:
        obj["phoneNumberId"] = pn
    return json.dumps({"id": mid, "type": kind, "received_at": (sent + timedelta(minutes=1)).isoformat(),
                       "source": "pull" if pull else "webhook",
                       "event": {"id": f"pull:{mid}" if pull else f"EV{mid}", "type": kind,
                                 "data": {"object": obj}}})


print("THE WORDS — the platform's yes/no reader, widened for how people take a shift")
words = {t: sh.read_word(t) for t in (
    "yes", "YES!", "Y", "ok", "I can take it", "I'll take it", "I can cover", "Can do", "count me in",
    "I'm available", "sure thing", "I can't take it", "I cannot cover it", "I'm not available",
    "Yes but I can't take it", "no", "Nope", "can't make it", "who can take it?", "Not sure",
    "I will think about it", "approve", "not approved", "running late")}
check("the ways people accept a shift by text are a yes",
      all(words[t] == "yes" for t in ("yes", "YES!", "Y", "ok", "I can take it", "I'll take it",
                                      "I can cover", "Can do", "count me in", "I'm available",
                                      "sure thing", "approve")), words)
check("a refusal wins over the words of an acceptance — 'I can't take it' is a no",
      all(words[t] == "no" for t in ("I can't take it", "I cannot cover it", "I'm not available",
                                     "Yes but I can't take it", "no", "Nope", "can't make it",
                                     "not approved")), words)
check("a question is not an answer, 'not sure' is not 'sure', and a late call is no answer to a swap",
      all(words[t] == "other" for t in ("who can take it?", "Not sure", "I will think about it",
                                        "running late")), words)
t = se.read_text("YES ref SP3F9A2B1C4D")
check("an open shift's ref is found, and the words around it read as the yes they are",
      t["sp"] == ["SP3F9A2B1C4D"] and t["ho"] == [] and t["word"] == "yes" and t["reply"], t)
t = se.read_text("sp3f9a2b1c4d yes")
check("the ref is found in any case, before or after the word", t["sp"] == ["SP3F9A2B1C4D"]
      and t["word"] == "yes", t)
t = se.read_text("I can't take it HO4F2A9C1B88")
check("a handoff's ref is found and a refusal beside it is a no",
      t["ho"] == ["HO4F2A9C1B88"] and t["word"] == "no", t)
t = se.read_text("APPROVE")
check("APPROVE is a yes and a manager's word", t["word"] == "yes" and t["manager"] is True, t)
t = se.read_text("running late, be there at 8:15")
check("a late call is read as late, not as a yes", t["late"] and t["word"] == "other" and t["reply"], t)
t = se.read_text("SP3F9A2B1C4D2")
check("eleven hex digits is not a ref — the pattern is the ref_of shape exactly",
      t["sp"] == [], t)
# RECEIVED WITHOUT A REF IS THE WORD ALONE: ordinary English that holds it is
# not a reply at all, so nothing answers it and nobody is asked for a ref.
_said = {x: se.read_text(x) for x in ("I never received the schedule",
                                      "I received my paycheck but it is short",
                                      "Received the schedule, see you Monday")}
check("a sentence that merely holds 'received' is not a reply, and not a RECEIVED",
      all(not v["received"] and not v["reply"] for v in _said.values()), _said)
check("the word alone is a RECEIVED, and so is the word beside a punch warning's ref",
      se.read_text("Received.")["received"] and se.read_text("ack")["received"]
      and se.read_text("got it, received PW0123456789")["received"]
      and se.read_text("got it, received PW0123456789")["pw"] == ["PW0123456789"])
# BESIDE THE REF THE WORD MUST STILL BE THE ANSWER: a no, a not or a question
# quotes the warning without answering it, so nothing is opened.
_neg = {x: se.read_text(x) for x in ("PW0123456789 not received?",
                                     "No, do not open it, received PW0123456789")}
check("a negated or questioning RECEIVED beside a ref is not a RECEIVED — it is asked for a plain one",
      all(not v["received"] and v["pw"] == ["PW0123456789"] and v["reply"] for v in _neg.values()), _neg)
check("the patterns agree with the handles the lanes mint",
      sr.REF_RE.fullmatch(sr.ref_of("CAN - BM - BM4060", "OPEN", "2026-10-01")) is not None
      and sh.REF_RE.fullmatch(sh.handoff_id("CAN - BM - BM4060", "2026-10-01", "Ann", "x")) is not None
      and pr.ELSEWHERE_RE.fullmatch(sr.ref_of("A", "B", "C")) is not None
      and pr.ELSEWHERE_RE.fullmatch(sh.handoff_id("A", "B", "C", "D")) is not None)
_gs =(ROOT / "apps-script" / "SmartComms.gs").read_text(encoding="utf-8")
_line = re.search(r"var SMART_URGENT_LINK_LINE = '([^']*)';", _gs)
_ref = sr.ref_of("CAN - BM - BM4060", "Zed Caller", "2026-10-01")
_path = sr.deep_link(_ref, "CAN - BM - BM4060")
_gs_ref = re.search(r"/\^SP\[0-9A-F\]\{(\d+)\}\$/", (ROOT / "apps-script" / "CommCallOff.gs")
                    .read_text(encoding="utf-8"))
check("the URGENT OPEN SHIFT's line asks for the reply this ear reads: 'YES <ref>' in any case finds the "
      "shift, and the link is the House Calendars square",
      _line is not None and "YES {ref}" in _line.group(1) and "{link}" in _line.group(1)
      and se.read_text(_line.group(1).split(" - ")[0].replace("To apply, reply ", "")
                       .replace("{ref}", _ref))["sp"] == [_ref]
      and se.read_text(f"yes {_ref.lower()}")["sp"] == [_ref]
      and se.read_text(f"yes {_ref.lower()}")["word"] == "yes"
      and _path.startswith("/#/app/calendarbuilder/house-cal") and f"ref={_ref}" in _path
      and _gs_ref is not None and int(_gs_ref.group(1)) == len(_ref) - 2,
      [_line.group(1) if _line else None, _ref, _path])
check("the ref stays short enough to type — twelve characters — and keyed, never a plain hash of the "
      "caller's row",
      len(_ref) == 12 and _ref != "SP" + hashlib.sha256(
          "CAN - BM - BM4060|Zed Caller|2026-10-01".encode()).hexdigest()[:10].upper(), _ref)

print("\nTHE INBOX — texts received on the lines people answer, and nothing else")
h = se.heard_text(quo("m1", "+13305550101", T0, text="Yes"))
check("a text received on the 5558 is heard: its Quo id, the line, the sender, when it was SENT",
      h and h["id"] == "m1" and h["line"] == "3309195558" and h["from"] == "+13305550101"
      and h["sent_at"] == T0 and h["text"] == "Yes" and h["group"] is False, h)
check("a text received on the 4040 is heard too",
      (se.heard_text(quo("m2", "+13305550101", T0, to="+13307544040")) or {}).get("line") == "3307544040")
check("the pull's copy is keyed by the same Quo message id as the webhook's",
      (se.heard_text(quo("m3", "+13305550101", T0, pull=True)) or {}).get("id") == "m3")
check("an outgoing text and a delivery receipt are never replies",
      se.heard_text(quo("m4", "+13305550101", T0, direction="outgoing")) is None
      and se.heard_text(quo("m5", "+13305550101", T0, kind="message.delivered",
                             direction="outgoing")) is None)
check("a text to another company line is not this ear's",
      se.heard_text(quo("m6", "+13305550101", T0, to="+13309197744")) is None)
check("a line named only by its Quo id is still heard",
      (se.heard_text(quo("m7", "+13305550101", T0, to="", pn="PNadbCL4lS")) or {}).get("line")
      == "3307544040")
check("a group text (several recipients) is heard but flagged",
      (se.heard_text(quo("m8", "+13305550101", T0, to=["+13309195558", "+13305550999"])) or {})
      .get("group") is True)
check("a line the parser cannot read is not a text", se.heard_text("not json") is None
      and se.heard_text(json.dumps({"id": "x"})) is None)

box = Path(tempfile.mkdtemp(prefix="sms-ears-inbox-"))
(box / "2026-09-23.jsonl").write_text("\n".join([
    quo("b2", "+13305550102", T0 - timedelta(minutes=2)),
    quo("b1", "+13305550101", T0 - timedelta(minutes=9), pull=True),   # pulled late, sent earlier
    "torn half a li",
]) + "\n", encoding="utf-8")
(box / "2026-09-22.jsonl.gz").write_bytes(gzip.compress((
    quo("b0", "+13305550103", T0 - timedelta(hours=20)) + "\n"
    + quo("b2", "+13305550102", T0 - timedelta(minutes=2), pull=True) + "\n").encode()))
(box / "2026-09-20.jsonl").write_text(quo("old", "+13305550101", T0 - timedelta(days=3)) + "\n",
                                      encoding="utf-8")
os.utime(box / "2026-09-20.jsonl", ((T0 - timedelta(days=3)).timestamp(),) * 2)
(box / "2026-09-21.jsonl.gz").write_bytes(b"not gzip at all")
texts, bad = se.inbox_texts(box, T0)
check("every file over the lookback, zipped and plain, in the order the texts were SENT",
      [x["id"] for x in texts] == ["b0", "b1", "b2"], [x["id"] for x in texts])
check("the webhook's copy and the pull's copy of one text are one text", len(texts) == 3)
check("a file that cannot be read is NAMED, never read as empty", bad == ["2026-09-21.jsonl.gz"], bad)
_texts2, bad2 = se.inbox_texts(box, T0)
check("…and named again on the next pass without being parsed again — remembered by its stamp, so a "
      "corrupt archive is not a log line every minute",
      bad2 == ["2026-09-21.jsonl.gz"]
      and se._FILES.get(str(box / "2026-09-21.jsonl.gz"), (None, 1))[1] is None, bad2)

print("\nNEVER GUESS — the ladder a text with no ref climbs (pure)")
BM, JH = "CAN - BM - BM4060", "CAN - JH - ABD2704"


def offer(ref, loc=JH, value="8P-8A", code="ok", iso="2026-09-24"):
    return {"kind": sr.KIND_CALLOFF, "ref": ref, "location": loc, "col_iso": iso, "value": value,
            "open_row": "Ben Left", "standing": {"code": code, "why": f"verdict {code}"}}


HAND_S = {"id": "HO0000000001", "side": "staff", "location": JH, "col_iso": "2026-09-25",
          "value": "9A-5P"}
HAND_M = dict(HAND_S, id="HO0000000002", side="manager")
ASK = {"shift_code": "7A-3P", "house": "BM4060", "house_name": "BM", "shift_at": "2026-09-23T07:00:00-04:00"}


def plan(word="yes", late=False, manager=False, handoffs=(), offers=(), ask=None, recent=(), on_grid=True,
         weak=False):
    return se.plan_bare(word=word, late=late, manager=manager, handoffs=list(handoffs),
                        offers=list(offers), ask=ask, recent=list(recent), on_grid=on_grid, weak=weak)


p = plan(offers=[offer("SP0000000001")])
check("exactly ONE call-off open to them and nothing else waiting: the bare YES applies",
      p.get("act") == "apply" and p["target"]["ref"] == "SP0000000001", p)
p = plan(offers=[offer("SP0000000001"), offer("SP0000000002", loc=BM)])
check("two call-offs open to them: AMBIGUOUS, both named, nothing done",
      p.get("outcome") == se.AMBIGUOUS and [c["ref"] for c in p["candidates"]]
      == ["SP0000000001", "SP0000000002"] and "act" not in p, p)
p = plan(offers=[offer("SP0000000001")], handoffs=[HAND_S])
check("a call-off and a swap waiting on them: AMBIGUOUS across the two roads",
      p.get("outcome") == se.AMBIGUOUS and {c["road"] for c in p["candidates"]}
      == {se.ROAD_CALL_OFF, se.ROAD_HANDOFF}, p)
p = plan(offers=[offer("SP0000000001")], ask=ASK)
check("a call-off and the shift flow's own ask in front of them: AMBIGUOUS — the application is not made",
      p.get("outcome") == se.AMBIGUOUS and {c["road"] for c in p["candidates"]}
      == {se.ROAD_CALL_OFF, se.ROAD_SHIFT_ASK}, p)
p = plan(ask=ASK)
check("only the shift flow's ask: its own ear takes the YES, and this one says so",
      p.get("outcome") == se.SHIFT_ASK and "7A-3P" in p["why"], p)
p = plan(handoffs=[HAND_S])
check("only a swap waiting on them: the YES answers it", p.get("act") == "answer"
      and p["target"]["id"] == "HO0000000001", p)
p = plan(word="no", handoffs=[HAND_S], offers=[offer("SP0000000001")])
check("a NO answers the one swap — a NO applies for nothing", p.get("act") == "answer", p)
p = plan(word="no", handoffs=[HAND_S], ask=ASK)
check("a NO with a swap AND a shift ask waiting, the swap's ask never texted to that phone: "
      "the shift flow's ask is what reached them, so it is the flow's — the swap is untouched",
      p.get("outcome") == se.SHIFT_ASK and "act" not in p, p)
ASK_AT = dict(ASK, asked_at="2026-09-23T10:30:00Z")
SWAP_NEWER = dict(HAND_S, asked_here=True, asked_at="2026-09-23T10:45:00Z")
SWAP_OLDER = dict(HAND_S, asked_here=True, asked_at="2026-09-21T15:00:00Z")
p = plan(word="yes", handoffs=[SWAP_NEWER], ask=ASK_AT)
check("…and when the swap's ask reached that phone AFTER the shift flow's ask, the swap comes first "
      "— the flow's ask is never the one to swallow a person taking a shift",
      p.get("act") == "answer" and p["target"]["id"] == "HO0000000001", p)
p = plan(word="yes", handoffs=[SWAP_OLDER], ask=ASK_AT)
check("NEVER A GUESS BY AGE: Monday's swap ask ignored, Tuesday's 'all set?' answered YES — the YES "
      "is the shift flow's, and the old transfer is NOT accepted",
      p.get("outcome") == se.SHIFT_ASK and "act" not in p, p)
p = plan(word="yes", handoffs=[dict(HAND_S, asked_here=True, asked_at="2026-09-23T10:30:00Z")],
         ask=ASK_AT)
check("two asks that cannot be told apart in time: AMBIGUOUS, nothing done",
      p.get("outcome") == se.AMBIGUOUS and {c["road"] for c in p["candidates"]}
      == {se.ROAD_HANDOFF, se.ROAD_SHIFT_ASK}, p)
p = plan(word="yes", handoffs=[dict(HAND_S, asked_here=True, asked_at="2026-09-23T10:45:00Z")],
         ask=ASK)
check("…and a shift ask whose time is not known is never read as the older one: AMBIGUOUS",
      p.get("outcome") == se.AMBIGUOUS, p)
p = plan(word="yes", handoffs=[SWAP_NEWER], ask=ASK_AT, offers=[offer("SP0000000001")])
check("…but a call-off open to them as well is still two things: AMBIGUOUS",
      p.get("outcome") == se.AMBIGUOUS and {c["road"] for c in p["candidates"]}
      == {se.ROAD_CALL_OFF, se.ROAD_HANDOFF}, p)
HAND_M_ASKED = dict(HAND_M, asked_here=True, asked_at="2026-09-23T10:45:00Z")
p = plan(manager=True, handoffs=[HAND_S, HAND_M_ASKED], offers=[offer("SP0000000001")], ask=ASK_AT)
check("APPROVE answers only an approval: the manager's side, never an application or a shift ask",
      p.get("act") == "answer" and p["target"]["id"] == "HO0000000002", p)
p = plan(word="yes", handoffs=[HAND_M_ASKED])
check("the house manager's bare YES answers the approval whose ask reached her phone",
      p.get("act") == "answer" and p["target"]["id"] == "HO0000000002", p)
p = plan(word="yes", handoffs=[HAND_M])
check("THE MANAGER'S CONSENT IS NEVER READ OFF A STRAY WORD: a YES from a phone the approval ask "
      "was not seen reaching gives nothing — AMBIGUOUS, with the ref that would give it",
      p.get("outcome") == se.AMBIGUOUS and p["code"] == "approval_needs_ref" and "act" not in p
      and [c["handoff_id"] for c in p["candidates"]] == ["HO0000000002"], p)
p = plan(word="no", handoffs=[HAND_M])
check("…nor does a stray NO kill the transfer", p.get("outcome") == se.AMBIGUOUS and "act" not in p, p)
p = plan(word="yes", weak=True, handoffs=[HAND_M_ASKED])
check("an OK acknowledges — it never gives the house manager's consent, even to an ask that reached her",
      p.get("outcome") == se.NOT_A_REPLY and "act" not in p, p)
ABOVE_M = dict(HAND_M, approval="above", asked_here=False)
p = plan(word="yes", handoffs=[ABOVE_M])
check("a director's bare YES never approves a swap asked of the directors' group — and is not "
      "answered with its ref either", p.get("outcome") == se.UNMATCHED and "act" not in p, p)
p = plan(word="yes", weak=True, handoffs=[ABOVE_M])
check("…nor a director's 'ok thanks'", p.get("outcome") == se.NOT_A_REPLY and "act" not in p, p)
p = plan(manager=True, handoffs=[HAND_S])
check("APPROVE with no approval waiting on them answers nothing", p.get("outcome") == se.UNMATCHED, p)
p = plan(word="other", late=True, ask=ASK)
check("a late call is the shift flow's answer when its ask is open", p.get("outcome") == se.SHIFT_ASK, p)
p = plan(word="other", late=True)
check("…and not a reply to anything here when it is not", p.get("outcome") == se.NOT_A_REPLY, p)
p = plan(offers=[offer("SP0000000001", code="applied")])
check("the one open call-off is one they already applied for: the plan names it (already on file)",
      p.get("act") == "apply" and p["target"]["standing"]["code"] == "applied", p)
p = plan(recent=[offer("SP0000000001", code="window_closed")])
check("nothing open, and one call-off of the last hours closed to them: REFUSED with its own reason",
      p.get("outcome") == se.REFUSED and p["code"] == "window_closed"
      and "verdict window_closed" in p["why"], p)
p = plan(recent=[offer("SP0000000001", code=""), offer("SP0000000002")], on_grid=False)
check("a name on no house calendar: REFUSED not_on_a_grid, never applied under a display name",
      p.get("outcome") == se.REFUSED and p["code"] == "not_on_a_grid", p)
p = plan()
check("nothing waiting at all: UNMATCHED, and nothing done", p.get("outcome") == se.UNMATCHED, p)
check("AN OK ACKNOWLEDGES: 'ok', 'Okay thanks' are a weak yes; 'ok I can take it' and 'yes' are not",
      se.read_text("ok")["weak"] and se.read_text("Okay thanks!")["weak"]
      and not se.read_text("ok I can take it")["weak"] and not se.read_text("yes")["weak"]
      and not se.read_text("no")["weak"])
p = plan(weak=True, offers=[offer("SP0000000001")])
check("…so an OK with one call-off open applies for nothing — it is written down as an acknowledgement",
      p.get("outcome") == se.NOT_A_REPLY and p["code"] == "acknowledgement" and "act" not in p, p)
check("…while an OK still answers the one swap waiting on them, and the shift flow's own ask",
      plan(weak=True, handoffs=[HAND_S]).get("act") == "answer"
      and plan(weak=True, ask=ASK, offers=[offer("SP0000000001")]).get("outcome") == se.SHIFT_ASK)
p = plan(word="other")
check("neither a yes nor a no: not a reply", p.get("outcome") == se.NOT_A_REPLY, p)
cand_blob = json.dumps(plan(offers=[offer("SP0000000001"), offer("SP0000000002")])["candidates"])
check("the candidates written down never carry the roster row — a call-off's row is the caller's name",
      "Ben Left" not in cand_blob and "open_row" not in cand_blob, cand_blob)
choices = se.choices_text([
    {"road": se.ROAD_CALL_OFF, "ref": "SP0000000001", "location": JH, "col_iso": "2026-09-24", "value": "8P-8A"},
    {"road": se.ROAD_HANDOFF, "handoff_id": "HO0000000001", "location": JH, "col_iso": "2026-09-25",
     "value": "9A-5P"},
    {"road": se.ROAD_SHIFT_ASK, "house": "BM", "value": "7A-3P"}])
check("the sender is told each thing it could have meant, with the ref that names it (ASCII only)",
      "reply YES SP0000000001" in choices and "reply YES HO0000000001 or NO HO0000000001" in choices
      and "your 7A-3P shift at BM" in choices and all(ord(c) < 128 for c in choices), choices)
check("a staff member is told the rule in their own words — and never who has the shift",
      se.staff_why("filled") == "somebody already has it"
      and "called off" in se.staff_why("called_off")
      and "house manager decides" in se.staff_why("window_closed")
      and se.staff_why("overlap", {"clash": {"location": BM, "value": "7A-3P", "col_iso": "2026-09-24"}})
      == "it overlaps the 7A-3P shift at BM on Thu 9/24 you already hold"
      and se.staff_why("anything else").startswith("it could not be taken"))
check("a refusal names the shift it was about when one is known, and never renders an empty one",
      se.staff_refusal({"location": JH, "col_iso": "2026-09-24", "value": "8P-8A"}, "filled")
      == "the 8P-8A shift at JH on Thu 9/24: somebody already has it"
      and se.staff_refusal({"location": ""}, "no_such_shift") == "no open shift carries that reference")
check("an applicant by text is told the house manager decides — never that the shift is theirs",
      se.applied_words(False) == "The house manager decides who takes it."
      and "approve your training" in se.applied_words(True)
      and "yours" not in se.applied_words(True) + se.applied_words(False))
row = {"id": "HO0000000009", "state": sh.DONE, "to_staff": "Fay Free", "house_manager": "Hana Boss"}
check("a swap answered by text, said to the one who answered and about them",
      se.handoff_words(row, "staff", "yes", second=True).startswith("you accepted the swap HO0000000009")
      and "the shift is yours" in se.handoff_words(row, "staff", "yes", second=True)
      and se.handoff_words(row, "manager", "yes", second=False).startswith("Hana Boss approved")
      and "waits on Fay Free" in se.handoff_words(dict(row, state=sh.PENDING), "manager", "yes",
                                                   second=True))

print("\nWHO SENT IT — the platform's own contact resolution, never a guess")
import hotline_desk  # noqa: E402

contacts = se.Contacts(company={"3309195558": "Automations", "3307544040": "Wellington"},
                       floor=hotline_desk.shared_floor(),
                       roster={"3305550101": {"annroe": "Ann Roe"},
                               "3305550199": {"annroe": "Ann Roe", "benleft": "Ben Left"}})
check("a number exactly one person holds is that person",
      contacts.who("3309195558", "+1 330 555 0101") == {"sender": "named", "name": "Ann Roe"})
check("a number two people share is `shared`, never a name",
      contacts.who("3309195558", "+13305550199") == {"sender": "shared", "name": ""})
check("the 5558 group itself (a company line) is `shared`, never a name",
      contacts.who("3307544040", "+13309195558") == {"sender": "shared", "name": ""})
check("a number nobody holds is `unknown`", contacts.who("3309195558", "+13305550777")
      == {"sender": "unknown", "name": ""})
view = {"people": {JH: ["Ann Roe", "OPEN", "OPEN · call-off"], BM: ["ann roe", "Dee Off"]}}
check("the name is spelled as the house calendars spell it; a name no calendar draws is ''",
      se.grid_name(view, "ANN ROE") in ("Ann Roe", "ann roe") and se.grid_name(view, "Zed Nobody") == ""
      and se.grid_name(view, "OPEN") == "")

print("\nTHE PASS — order, exactly once, and a read that failed is never an answer")


class _Lock:
    def __init__(self, dsn):
        self.held = True

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return None


LEDGER: dict = {}
HEARD: list = []
BEHAVIOUR: dict = {}


def fake_hear(dsn, t, ctx):
    HEARD.append(t["id"])
    how = BEHAVIOUR.get(t["id"], "ok")
    if how == "wait":
        raise se._Wait("the contacts could not be read")
    if how == "boom":
        raise RuntimeError("a bug")
    return {**se._base(t), "outcome": se.APPLIED if how == "ok" else how, "why": "test"}


saved = {k: getattr(se, k) for k in ("_EarLock", "_ensure", "_since", "_handled", "_record", "_hear")}
se._EarLock = _Lock
se._ensure = lambda dsn: None
se._since = lambda dsn: T0 - timedelta(hours=10)
se._handled = lambda dsn, ids: {i for i in ids if i in LEDGER}
se._record = lambda dsn, row: LEDGER.setdefault(row["id"], row) is row
try:
    se._hear = fake_hear
    pbox = Path(tempfile.mkdtemp(prefix="sms-ears-pass-"))
    (pbox / "2026-09-23.jsonl").write_text("\n".join([
        quo("p3", "+13305550103", T0 - timedelta(minutes=1)),
        quo("p1", "+13305550101", T0 - timedelta(minutes=30)),
        quo("p2", "+13305550102", T0 - timedelta(minutes=20)),
        quo("p0", "+13305550109", T0 - timedelta(hours=11)),          # before the ear listened
        quo("pw", "+13305550105", T0 - timedelta(minutes=15)),         # its answer cannot be read
        quo("pw2", "+13305550105", T0 - timedelta(minutes=5)),
        quo("pb", "+13305550106", T0 - timedelta(minutes=12)),         # a bug in the ear
    ]) + "\n", encoding="utf-8")
    BEHAVIOUR.update({"pw": "wait", "pb": "boom"})
    said = se.listen("dsn", inbox=pbox, now=T0)
    check("the texts are heard in the order they were SENT, whatever order the file holds them in",
          HEARD == ["p1", "p2", "pw", "pb", "p3"], HEARD)
    check("a text sent before the ear first listened is history — neither heard nor written down",
          said["before"] == 1 and "p0" not in LEDGER, said)
    check("a text whose answer could not be read WAITS — nothing is written down about it",
          "pw" not in LEDGER and "pb" not in LEDGER and said["waiting"] == 3
          and said["why"] == "the contacts could not be read", said)
    check("…and a later text from the same phone waits behind it, so one person is heard in order",
          "pw2" not in HEARD and "pw2" not in LEDGER, HEARD)
    check("the others are written down, once each, and counted by what they came to",
          set(LEDGER) == {"p1", "p2", "p3"} and said["heard"] == 3 and said["acted"] == 3
          and said["outcomes"] == {"applied": 3}, said)
    HEARD.clear()
    said2 = se.listen("dsn", inbox=pbox, now=T0 + timedelta(minutes=1))
    check("EXACTLY ONCE: a second pass hears only what is still waiting",
          HEARD == ["pw", "pb"] and said2["heard"] == 0, (HEARD, said2))
    HEARD.clear()
    said3 = se.listen("dsn", inbox=pbox, now=T0 + timedelta(hours=se.HOLD_H, minutes=1))
    check("past HOLD_H a text that still cannot be heard is written down UNHEARD, with the reason",
          LEDGER.get("pw", {}).get("outcome") == se.UNHEARD
          and "could not be heard for" in LEDGER["pw"]["why"]
          and "the contacts could not be read" in LEDGER["pw"]["why"]
          and LEDGER.get("pb", {}).get("outcome") == se.UNHEARD and "a bug" in LEDGER["pb"]["why"], LEDGER)
    check("…and the text waiting behind it is heard in its turn", "pw2" in HEARD and "pw2" in LEDGER, HEARD)

    class _Busy(_Lock):
        def __init__(self, dsn):
            self.held = False
    se._EarLock = _Busy
    (pbox / "2026-09-23.jsonl").write_text(quo("q1", "+13305550101", T0) + "\n", encoding="utf-8")
    said4 = se.listen("dsn", inbox=pbox, now=T0)
    check("ONE PASS AT A TIME: a pass that finds the lock held does nothing and says so",
          said4["state"] == "busy" and "q1" not in LEDGER, said4)
finally:
    for k, v in saved.items():
        setattr(se, k, v)
said5 = se.listen("dsn", inbox=Path(tempfile.mkdtemp(prefix="sms-ears-empty-")), now=T0)
check("an inbox with nothing in it asks the database nothing", said5["heard"] == 0
      and said5["state"] == "ok", said5)

d = se.door_row({"id": "m9", "ack": se.ACK_REFUSED, "person": "Ann Roe", "location": JH,
                 "col_iso": "2026-09-24", "value": "8P-8A", "ref": "SP0000000001",
                 "ack_why": "somebody already has it", "handoff_id": ""})
check("an acknowledgement rides the shift door by the sender's name, with the sentence composed here",
      d["id"] == "SMS|m9:sms_reply_refused" and d["kind"] == "sms_reply_refused"
      and d["person"] == "Ann Roe" and d["house"] == "ABD2704" and d["reply"] == "somebody already has it"
      and d["ref"] == "SP0000000001" and d["shift_at"].startswith("2026-09-24T20:00"), d)
check("…and never carries a call-off's roster row or its reason",
      not ({"open_row", "called_off_by", "reason"} & set(d)), sorted(d))

print("\nTHE WIRING — read where it cannot be imported")
SS = src("snapshot_service")
event_door = fn_source(SS, "_quo_messages_event")
check("the webhook wakes the ear the moment a text is kept — and never waits on it",
      "_sms_ears_wake()" in event_door and "sms_ears.listen" not in event_door)
check("the pull wakes it when it finds a text", "_sms_ears_wake()" in fn_source(SS, "_quo_pull_loop"))
loop = fn_source(SS, "_sms_ears_loop")
check("the ear's own beat: listen in a worker thread, ring the calendars when it acted, then the "
      "acknowledgements",
      "asyncio.to_thread(sms_ears.listen, PG_DSN)" in loop and '_housecal_rang()' in loop
      and "await _sms_replies_post()" in loop and "SMS_EARS_EVERY_S" in loop)
post = fn_source(SS, "_sms_replies_post")
check("the acknowledgements ride staffShiftReminder (Staff attendance's own lane, Python's or Apps Script's), and only "
      "what the door said is written down",
      '_staff_door("staffShiftReminder"' in post and "sms_ears.owed" in post
      and "sms_ears.mark_said" in post)
check("the ear is started with the relay, after the inbox", "_sms_ears_loop()" in fn_source(SS, "_start")
      and fn_source(SS, "_start").index("quo_inbox.prepare()") < fn_source(SS, "_start").index("_sms_ears_loop()"))
SE = src("sms_ears")
check("the road is set by the ear, never read from the words the person sent: 'sms' on the "
      "application and the answer, and 'rehearsal:sms' when the LINE ITSELF says it was played "
      "by the staff-answers rehearsal",
      'REHEARSAL_VIA if played(t) else "sms"' in fn_source(SE, "_apply")
      and 'REHEARSAL_VIA if rehearsed else "sms"' in fn_source(SE, "_answer")
      and se.REHEARSAL_VIA == "rehearsal:sms"
      and se.played({"source": "rehearsal"}) is True
      and se.played({"source": ""}) is False and se.played({}) is False)
check("a rehearsed line's application is marked AT THE DOOR, in the same statement that makes the "
      "row — there is no moment in which it is on file looking real",
      'REHEARSAL: {"text": t["id"], "line": t["line"]}' in fn_source(SE, "_apply")
      and "**mark}" in fn_source(SE, "_apply"))
check("and a rehearsed line may answer only a rehearsed transfer: the swap door is told which it is",
      'rehearsal={"text": row["id"]} if rehearsed else None' in fn_source(SE, "_answer"))
# the time off road, with the lane stood in for: a rehearsed line never reaches its door
_to_calls: list[str] = []
_fake_to = types.ModuleType("time_off")
_fake_to.Unreadable = type("Unreadable", (Exception,), {})
_fake_to.Refused = type("Refused", (Exception,), {})
_fake_to.match_reply = lambda *a, **k: _to_calls.append("match") or {"leg": "director"}
_fake_to.decide = lambda *a, **k: _to_calls.append("decide") or {"leg": "director"}
_fake_to.note_from_text = lambda text, ref: ""
_fake_to.answered_words = lambda got, leg, how: "approved as the director"
_kept_to = sys.modules.get("time_off")
sys.modules["time_off"] = _fake_to
try:
    _t = {"id": "REH0123456789AB", "line": "3309195558", "sent_at": T0, "from": "+13305550101",
          "text": "YES TO1234ABCD", "source": "rehearsal"}
    _p = {"to": ["TO1234ABCD"], "word": "yes"}
    _ctx = types.SimpleNamespace(who=lambda n: {"name": n})
    _played_row = se._by_time_off_ref("dbname=never", _t, _p, se._base(_t), "Ann Roe", "Ann Roe",
                                      _ctx)
    _played_calls = list(_to_calls)
    _to_calls.clear()
    _real_t = {**_t, "source": "pull"}
    _real_row = se._by_time_off_ref("dbname=never", _real_t, _p, se._base(_real_t), "Ann Roe",
                                    "Ann Roe", _ctx)
    _real_calls = list(_to_calls)
finally:
    if _kept_to is None:
        sys.modules.pop("time_off", None)
    else:
        sys.modules["time_off"] = _kept_to
check("a line the staff-answers rehearsal wrote never decides a time off request: the time off "
      "road refuses it before the lane is asked, owes no acknowledgement, and marks the row",
      _played_row["outcome"] == se.REFUSED and _played_row["code"] == "rehearsal"
      and _played_calls == [] and not _played_row["ack"] and _played_row["rehearsal"] is True,
      [_played_row.get("outcome"), _played_row.get("code"), _played_calls])
check("…while a real line on the same road still goes to the time off lane's own door",
      _real_calls == ["match", "decide"] and _real_row["outcome"] == se.ANSWERED
      and _real_row["rehearsal"] is False, [_real_row.get("outcome"), _real_calls])
check("a handoff's reply reaches match_reply with the words the person sent, and their badges "
      "only when the name alone does not settle it",
      'shift_handoff.match_reply(dsn, text=t["text"], name=n,' in fn_source(SE, "_by_handoff_ref")
      and "who=lambda n=n: ctx.who(n)" in fn_source(SE, "_by_handoff_ref"))
check("the application is shift_requests' own path — the windows, the overlap law, the IST, the HM decides",
      "shift_requests.apply_for(" in fn_source(SE, "_apply")
      and "house_cal_live.claim_open_shift" not in SE and "take_open_shift" not in SE)
check("the application is dated by when the text was SENT", 'now=t["sent_at"]' in fn_source(SE, "_apply")
      and "created_at" in fn_source(src("shift_requests"), "_apply_locked"))
check("the shift flow's ear hears the same lines (psi_reminders.REPLY_LINES)",
      "psi_reminders.REPLY_LINES" in fn_source(SE, "heard_text"))
check("the house managers' list is the Requests panels' own (shift_requests.panels)",
      "sms_ears.replies(dsn, mine=mine, everywhere=everywhere" in fn_source(src("shift_requests"), "panels"))
pkg = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
check("npm run check runs this file",
      "npm run test:sms-ears" in pkg["scripts"]["check"]
      and pkg["scripts"].get("test:sms-ears") == "python3 tools/test-sms-ears.py")
for suite in ("test-psi-anywhere.py", "test-hotline-fast.py", "test-hotline-lanes.py"):
    s2 = (HERE.parent / suite).read_text(encoding="utf-8")
    mods = ast.literal_eval(next(n.value for n in ast.parse(s2).body if isinstance(n, ast.Assign)
                                 and any(getattr(t, "id", "") == "MODULES" for t in n.targets)))
    check(f"{suite} ships the ear snapshot_service now imports", "sms_ears" in mods)



LANE = r'''
import json, os, sys, tempfile, time
from datetime import datetime, timedelta, timezone
from pathlib import Path
sys.path.insert(0, LANE_DIR)
import psycopg2, psycopg2.extras
import lane_schema
import house_cal_live as hcl, shift_handoff, psi_reminders as pr
import shift_requests as sr
import calendar_builder_houses as cbh
import hotline_desk
import sms_ears as se
import effective_roster
import time_off
# an unregistered switch holds; this lane writes the stand-in workbook
effective_roster.use_switch(lambda: {"on": False, "readable": True, "word": "off", "why": ""})
# no Time Off house: the verdict never reads the live one
time_off.use_house(time_off.NoHouse())
# …so the swap's directors are stood in; the list itself is held by test-shift-transfer
shift_handoff.directors_for = lambda dsn: {"readable": True, "names": ["Dee Direct"],
                                           "why": "the director Dee Direct approves"}

DSN = os.environ["HUB_SNAPSHOT_PG_DSN"]
ROOMS = lane_schema.Rooms(DSN, "sms-ears")
SCHEMA = ROOMS.name()
OUT = {}
UTC = timezone.utc
JH, BM = "CAN - JH - ABD2704", "CAN - BM - BM4060"
today = datetime.now(sr.OHIO).date()
PAST = (today - timedelta(days=1)).isoformat()
D0 = today.isoformat()
D1 = (today + timedelta(days=1)).isoformat()
D2 = (today + timedelta(days=2)).isoformat()
ISOS = [PAST, D0, D1, D2]
NOW = datetime.now(UTC)

MANAGERS = {"readable": True, "why": "", "by_code": {
    "ABD2704": {"name": "Hana Boss", "names": ["Hana Boss"], "phone": "", "house": JH},
    "BM4060": {"name": "Rita Lead", "names": ["Rita Lead"], "phone": "", "house": BM}}}
sr.house_managers = lambda dsn, **k: MANAGERS
PEOPLE = ("Ann Roe", "Ben Left", "Cy Taker", "Fay Free", "Eve Both", "Gus Ask", "Ian Idle",
          "Jo Late", "Lu Wait", "Mo Crash", "Dee Off", "Hana Boss", "Rita Lead")
# the IST settings as a read that landed, holding the shipped values
import ist_config
ist_config.pin(dict(ist_config.SHIPPED))
EVERY = {"done": 1, "owed": 0, "clients": [], "owed_for": []}
sr.ist_index = lambda dsn, **k: {
    "readable": True, "why": "", "rows": 0, "source": "test",
    "by_person": {sr.fold(n): {c: dict(EVERY) for c in ("ABD2704", "BM4060")} for n in PEOPLE}}
sr.call_off_shifts = lambda dsn, **k: []


def grid(rows):
    return {"cols": [{"iso": i} for i in ISOS],
            "rows": [{"employee": e, "cells": [{"text": t} for t in cs]} for e, cs in rows]}


GRIDS = {
    JH: grid([("Ann Roe", ["8A-4P", "", "7A-3P", "9A-5P"]),
              ("Ben Left", ["8A-4P", "", "8P-8A", ""]),
              ("Cy Taker", ["8A-4P", "", "", ""]),
              ("Fay Free", ["8A-4P", "", "", ""]),
              ("Eve Both", ["8A-4P", "", "", ""]),
              ("Ian Idle", ["8A-4P", "", "", ""]),
              ("Jo Late", ["8A-4P", "", "", ""]),
              ("Lu Wait", ["8A-4P", "", "", ""]),
              ("Mo Crash", ["8A-4P", "", "", ""])]),
    BM: grid([("Dee Off", ["8A-4P", "", "9A-9P", ""]),
              ("Gus Ask", ["8A-4P", "", "", ""])]),
}
PHONE = {"Ann Roe": "3305550101", "Ben Left": "3305550102", "Cy Taker": "3305550103",
         "Fay Free": "3305550104", "Eve Both": "3305550105", "Gus Ask": "3305550106",
         "Ian Idle": "3305550107", "Jo Late": "3305550108", "Hana Boss": "3305550109",
         "Kim Nogrid": "3305550110", "Lu Wait": "3305550111", "Mo Crash": "3305550112",
         # the swap's director: on the staff roster, on no house calendar
         "Dee Direct": "3305550113"}
ROSTER = {d: {sr.fold(n): n} for n, d in PHONE.items()}
ROSTER["3305550199"] = {"annroe": "Ann Roe", "benleft": "Ben Left"}
CONTACTS = se.Contacts(company={"3309195558": "Automations", "3307544040": "Wellington"},
                       floor=hotline_desk.shared_floor(), roster=ROSTER)
OK_CONTACTS = lambda: CONTACTS


def broken():
    raise hotline_desk.SourceError("The staff roster could not be read (OSError).")


WORK = Path(tempfile.mkdtemp(prefix="sms-ears-lane-"))
INBOX = WORK / "inbox"
INBOX.mkdir()
pr.STATE_FILE = WORK / ".psi-reminders.json"
LINES = []
N = [0]


def text(who_phone, words, ago_min, to="+13309195558", mid=None):
    N[0] += 1
    mid = mid or f"L{N[0]:03d}"
    sent = NOW - timedelta(minutes=ago_min)
    LINES.append(json.dumps({"id": mid, "type": "message.received", "received_at": NOW.isoformat(),
                             "source": "webhook", "event": {"type": "message.received", "data": {"object": {
                                 "id": mid, "from": "+1" + who_phone, "to": to, "direction": "incoming",
                                 "text": words, "createdAt": sent.isoformat()}}}}))
    (INBOX / f"{D0}.jsonl").write_text("\n".join(LINES) + "\n", encoding="utf-8")
    return mid


def listen(now=None, contacts=OK_CONTACTS):
    sr.forget_estate()
    return se.listen(T, inbox=INBOX, now=now or datetime.now(UTC), contacts=contacts)


def ledger(mid):
    with psycopg2.connect(T) as c, c.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("SELECT * FROM asa_sms_replies WHERE id=%s", (mid,))
        got = cur.fetchone()
    return dict(got) if got else None


def brief(mid):
    r = ledger(mid) or {}
    return [r.get("outcome"), r.get("code"), r.get("person"), r.get("ack"), r.get("ack_why")]


def rows(sql, args=()):
    with psycopg2.connect(T) as c, c.cursor() as cur:
        cur.execute(sql, args)
        return [list(r) for r in cur.fetchall()]


ROOMS.make()
T = ROOMS.path(SCHEMA)

try:
    with psycopg2.connect(T) as c, c.cursor() as cur:
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
    # every table the code reads is the lane's before its first read, the replies ledger included
    OUT["owned"] = lane_schema.own_shift_lane(T, SCHEMA, LANE_DIR)
    book = cbh.MemoryWorkbook.from_grids(GRIDS)
    cbh.use_workbook(book)
    se.forget()
    # the ear listened from two hours ago (texts older are history)
    se._ensure(T)
    with psycopg2.connect(T) as c, c.cursor() as cur:
        cur.execute("UPDATE asa_sms_reply_start SET since = now() - interval '2 hours'")
        c.commit()

    # ── C. THE SHIFT FLOW'S ASK — before any call-off is open ──────────────
    start = NOW + timedelta(minutes=20)
    ohio = lambda d: d.astimezone(sr.OHIO).isoformat()
    pr.STATE_FILE.write_text(json.dumps({
        "phones": {"gusask": {"key": pr.phone_key(PHONE["Gus Ask"])}},
        "ledger": {f"confirm|gusask|{start.strftime('%Y-%m-%dT%H:%M:%SZ')}|a0": {
            "state": "told", "at": (NOW - timedelta(minutes=10)).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "kind": "confirm_ask", "shift_id": "sid-gus"}},
        "shifts": {"sid-gus": {"person": "Gus Ask", "house": "BM4060", "house_name": "BM",
                               "shift_at": ohio(start), "shift_end": ohio(start + timedelta(hours=8)),
                               "shift_code": "8A-4P"}},
        "stopped": {}, "answers": {}, "post_after": 0}), encoding="utf-8")
    pr.forget()
    c1 = text(PHONE["Gus Ask"], "YES", 8)
    c2 = text(PHONE["Gus Ask"], "Running late, 10 min", 7, to="+13307544040")
    c3 = text(PHONE["Ian Idle"], "Yes", 6)
    c4 = text(PHONE["Gus Ask"], "hello, is this the office?", 5)
    OUT["c_pass"] = listen()
    OUT["c_gus_yes"] = brief(c1)
    OUT["c_gus_late"] = brief(c2)
    OUT["c_ian_nothing"] = brief(c3)
    OUT["c_not_reply"] = [brief(c4), (ledger(c4) or {}).get("words")]

    # ── A. A CALL-OFF IN THE POOL: Ben Left called off JH D1 8P-8A ─────────
    def pool(loc, row, iso, value, start_h, end_h):
        day = sr.day_of(iso)
        with psycopg2.connect(T) as c, c.cursor() as cur:
            cur.execute("INSERT INTO asa_shift_pool (location, open_row, col_iso, kind, value, opened_at, "
                        "shift_start, shift_end, called_off_by, reason, ref) "
                        "VALUES (%s,%s,%s,'call_off',%s, now() - interval '30 minutes', %s, %s, %s, "
                        "'sick — directors only', %s)",
                        (loc, row, iso, value, sr.at_hour(day, start_h), sr.at_hour(day, end_h), row,
                         sr.ref_of(loc, row, iso)))
            c.commit()
        return sr.ref_of(loc, row, iso)
    P1 = pool(JH, "Ben Left", D1, "8P-8A", 20, 32)
    OUT["p1"] = P1
    a1 = text(PHONE["Ann Roe"], "Yes", 20)
    a2 = text(PHONE["Ann Roe"], "YES I can", 19)
    a3 = text("3305550777", "yes", 18)
    a4 = text("3309195558", "YES", 17, to="+13307544040")
    a5 = text(PHONE["Ben Left"], f"YES {P1}", 16)
    a6 = text(PHONE["Kim Nogrid"], "yes", 15)
    a6b = text(PHONE["Lu Wait"], "Ok thanks", 14)
    OUT["a_pass"] = listen()
    OUT["a_ok_thanks"] = brief(a6b)
    OUT["a_ann"] = brief(a1)
    req = rows("SELECT via, created_at, extra->'sms'->>'id', state FROM asa_shift_requests "
               "WHERE kind='call_off' AND person='Ann Roe'")
    sent = NOW - timedelta(minutes=20)
    OUT["a_ann_request"] = [req[0][0], abs((req[0][1] - sent).total_seconds()) < 1, req[0][2], req[0][3]] \
        if req else None
    OUT["a_ann_again"] = brief(a2)
    OUT["a_unknown"] = brief(a3)
    OUT["a_company_line"] = brief(a4)
    OUT["a_caller"] = brief(a5)
    OUT["a_nogrid"] = brief(a6)
    OUT["a_requests"] = rows("SELECT person FROM asa_shift_requests ORDER BY created_at")

    # ORDER: Cy's text is heard first; Jo's, SENT earlier, arrives a pass later
    a7 = text(PHONE["Cy Taker"], f"I can take it {P1}", 3, to="+13307544040")
    listen()
    a8 = text(PHONE["Jo Late"], "yes", 6)
    listen()
    OUT["a_cy"] = brief(a7)
    OUT["a_jo"] = brief(a8)
    OUT["a_order"] = [a["person"] for a in sr.applicants(T, location=JH, open_row="Ben Left",
                                                         col_iso=D1)]
    OUT["a_again_nothing"] = listen()["heard"]

    # ── two call-offs: a bare YES is ambiguous, the ref resolves it ────────
    P2 = pool(BM, "Dee Off", D1, "9A-9P", 9, 21)
    OUT["p2"] = P2
    a9 = text(PHONE["Eve Both"], "yes", 2)
    listen()
    OUT["a_eve_bare"] = brief(a9)
    OUT["a_eve_cands"] = sorted(c.get("ref") for c in (ledger(a9) or {}).get("candidates") or [])
    OUT["a_eve_no_request"] = rows("SELECT count(*) FROM asa_shift_requests WHERE person='Eve Both'")[0][0]
    a10 = text(PHONE["Eve Both"], f"yes {P2}", 1)
    listen()
    OUT["a_eve_ref"] = brief(a10)
    OUT["a_eve_request"] = rows("SELECT location, via FROM asa_shift_requests WHERE person='Eve Both'")

    # ── B. A SWAP: Ann gives her D2 9A-5P to Fay; Hana approves ────────────
    ho = shift_handoff.offer(T, location=JH, col_iso=D2, from_staff="Ann Roe", to_staff="Fay Free",
                             created_by="test")
    HO = ho["id"]
    # the third consent; the ear's own paths are the two below it
    shift_handoff.answer(T, HO, side="director", word="yes", by="Dee Direct")
    b1 = text(PHONE["Fay Free"], "yes", 1)
    listen()
    OUT["b_fay_bare"] = brief(b1)
    OUT["b_fay_cands"] = sorted(c.get("road") for c in (ledger(b1) or {}).get("candidates") or [])
    b2 = text(PHONE["Fay Free"], f"YES {HO}", 1)
    listen()
    OUT["b_fay_ref"] = brief(b2)
    h = shift_handoff.handoff(T, HO)
    OUT["b_after_fay"] = [h["staff_state"], h["staff_via"], h["state"]]
    # a stray YES before the approval ask reached her phone gives nothing
    b_stray = text(PHONE["Hana Boss"], "yes", 3)
    listen()
    OUT["b_hana_stray"] = brief(b_stray)
    h = shift_handoff.handoff(T, HO)
    OUT["b_after_stray"] = [h["manager_state"], h["state"]]
    # once the ask reaches her phone, a bare APPROVE answers it
    with psycopg2.connect(T) as c, c.cursor() as cur:
        cur.execute("UPDATE asa_shift_handoffs SET said = said || jsonb_build_object("
                    "'handoff_ask_manager', %s::jsonb) WHERE id=%s",
                    (json.dumps({"state": "told", "why": "", "dial": "send", "test_mode": "off",
                                 "tries": 1, "phone_key": pr.phone_key(PHONE["Hana Boss"]),
                                 "at": (NOW - timedelta(minutes=1)).isoformat()}), HO))
        c.commit()
    b3 = text(PHONE["Hana Boss"], "APPROVE", 0)
    listen()
    OUT["b_hana"] = brief(b3)
    h = shift_handoff.handoff(T, HO)
    OUT["b_after_hana"] = [h["manager_state"], h["manager_via"], h["state"]]
    OUT["b_book"] = [book.cell(JH, "Fay Free", D2), book.cell(JH, "Ann Roe", D2)]
    b4 = text(PHONE["Fay Free"], f"yes {HO}", 0)
    b5 = text(PHONE["Ian Idle"], "NO HO0000000000", 0)
    listen()
    OUT["b_closed"] = brief(b4)
    OUT["b_unknown"] = brief(b5)

    # ── E. AN UNKNOWN REF waits, then is refused ───────────────────────────
    e1 = text(PHONE["Ian Idle"], "YES SP00000000AA", 1)
    OUT["e_wait"] = listen()
    OUT["e_wait_row"] = ledger(e1)
    OUT["e_later"] = listen(now=datetime.now(UTC) + timedelta(minutes=se.REF_WAIT_MIN + 1))
    OUT["e_refused"] = brief(e1)

    # ── D. UNREADABLE CONTACTS: the text waits, then is unheard ───────────
    se.forget()
    d1 = text(PHONE["Lu Wait"], "yes", 1)
    d2 = text(PHONE["Lu Wait"], "hi there", 0)
    OUT["d_wait"] = listen(contacts=broken)
    OUT["d_rows"] = [ledger(d1), ledger(d2)]
    OUT["d_later"] = listen(now=datetime.now(UTC) + timedelta(hours=se.HOLD_H, minutes=5),
                            contacts=broken)
    OUT["d_unheard"] = [brief(d1), (ledger(d1) or {}).get("why"), brief(d2), (ledger(d2) or {}).get("sender")]

    # ── G. BEFORE THE EAR ──────────────────────────────────────────────────
    with psycopg2.connect(T) as c, c.cursor() as cur:
        cur.execute("UPDATE asa_sms_reply_start SET since = now() + interval '1 minute'")
        c.commit()
    g1 = text(PHONE["Ian Idle"], "yes", 0)
    OUT["g_before"] = [listen()["before"] >= 1, ledger(g1)]
    with psycopg2.connect(T) as c, c.cursor() as cur:
        cur.execute("UPDATE asa_sms_reply_start SET since = now() - interval '2 hours'")
        c.commit()

    # ── H. A PASS THAT STOPPED between the application and its row ─────────
    sr.apply_for(T, location=JH, open_row="Ben Left", col_iso=D1, person="Mo Crash", via="sms",
                 now=NOW - timedelta(minutes=1), evidence={"sms": {"id": "L-CRASH", "line": "3309195558"}})
    text(PHONE["Mo Crash"], f"YES {P1}", 1, mid="L-CRASH")
    listen()
    OUT["h_crash"] = brief("L-CRASH")

    # I. the acknowledgements (quiet window stood in; checked for real below)
    real_quiet = pr.quiet
    pr.quiet = lambda at: False
    now = datetime.now(UTC)
    ack_now = now
    owed = se.owed(T, now=ack_now, limit=50)
    OUT["i_owed"] = sorted([r["kind"], r["person"]] for r in owed)
    OUT["i_blob_clean"] = "Ben Left" not in json.dumps([r for r in owed if r["person"] != "Ben Left"]) \
        and "sick" not in json.dumps(owed)
    ann_row = next((r for r in owed if r["person"] == "Ann Roe"), None)
    OUT["i_ann_row"] = ann_row
    quiet_at = datetime.combine(today, datetime.min.time(), tzinfo=sr.OHIO).replace(hour=23)
    pr.quiet = real_quiet
    OUT["i_quiet"] = se.owed(T, now=quiet_at)
    pr.quiet = lambda at: False
    # a recorded acknowledgement is not said, and is owed again when the dial moves
    ben_row = next((r for r in owed if r["person"] == "Ben Left"), None)
    shift_handoff.note_dial("record", "off")
    OUT["i_recorded_wrote"] = se.mark_said(T, [ben_row["id"]], {"dial": "record", "results": [
        {"id": ben_row["id"], "state": "recorded", "why": "written to the rehearsal book"}]})
    OUT["i_recorded_owed_at_record"] = [r["person"] for r in se.owed(T, now=ack_now, limit=50)].count(
        "Ben Left")
    ben_mid = ben_row["id"][len(se.ACK_ID_PREFIX):].rpartition(":")[0]
    OUT["i_recorded_state"] = [se._ack_state(ledger(ben_mid), ack_now), se._ack_note(ledger(ben_mid))]
    shift_handoff.note_dial("send", "off")
    OUT["i_recorded_owed_at_send"] = [r["person"] for r in se.owed(T, now=ack_now, limit=50)].count(
        "Ben Left")
    se.mark_said(T, [ben_row["id"]], {"dial": "send", "results": [
        {"id": ben_row["id"], "state": "no_contact", "why": "no number we may text"}]})
    OUT["i_no_contact"] = [se._ack_state(ledger(ben_mid), ack_now),
                           [r["person"] for r in se.owed(T, now=ack_now, limit=50)].count("Ben Left"),
                           [r["person"] for r in se.owed(
                               T, now=ack_now + timedelta(minutes=shift_handoff.RETRY_MIN + 1),
                               limit=50)].count("Ben Left")]
    se.mark_said(T, [ben_row["id"]], {"dial": "send", "results": [{"id": ben_row["id"], "state": "told"}]})
    wrote = se.mark_said(T, [ann_row["id"]], {"results": [{"id": ann_row["id"], "state": "told"}]})
    OUT["i_marked"] = [wrote, [r["person"] for r in se.owed(T, now=ack_now, limit=50)].count("Ann Roe")]
    cy_req = rows("SELECT id FROM asa_shift_requests WHERE person='Cy Taker' AND kind='call_off'")[0][0]
    sr.withdraw(T, request_id_=cy_req)
    left = se.owed(T, now=ack_now, limit=50)
    OUT["i_cy_expired"] = [("Cy Taker" in [r["person"] for r in left]),
                           ((ledger(a7) or {}).get("said") or {}).get("expired")]
    unknown_ids = [r["id"] for r in left]
    OUT["i_unknown_door"] = [se.mark_said(T, unknown_ids, {"results": [
        {"id": i, "state": "refused", "why": "not a row this door knows"} for i in unknown_ids]}),
        se.owed(T, now=ack_now, limit=50)]
    se._ACK_PAUSE["until"] = 0.0
    OUT["i_no_results"] = [se.mark_said(T, unknown_ids, {"status": "ok"}), se.owed(T, now=ack_now)]
    se._ACK_PAUSE["until"] = 0.0
    # six hours on, the windows are closed and the question expires
    se.owed(T, now=now + timedelta(hours=6), limit=50)
    OUT["i_unclear_later"] = rows("SELECT person, said->>'expired' FROM asa_sms_replies "
                                  "WHERE ack='sms_reply_unclear' AND person IN ('Eve Both', 'Fay Free') "
                                  "ORDER BY person")
    pr.quiet = real_quiet

    # ── J. THE HOUSE MANAGERS' LIST ───────────────────────────────────────
    everywhere = se.replies(T, mine=lambda h: True, everywhere=True)
    jh_only = se.replies(T, mine=lambda h: (sr.house_directory.code_of(h) or h) == "ABD2704",
                         everywhere=False)
    OUT["j_everywhere"] = sorted({r["outcome"] for r in everywhere["rows"]})
    OUT["j_jh"] = [everywhere["readable"], len(everywhere["rows"]), len(jh_only["rows"]),
                   sorted({r["outcome"] for r in jh_only["rows"]}),
                   any(r["person"] == "Eve Both" and r["outcome"] == "applied" for r in jh_only["rows"]),
                   any(r["outcome"] == "unknown_sender" for r in jh_only["rows"])]
    OUT["j_no_row_key"] = "open_row" not in json.dumps(everywhere) and "sick" not in json.dumps(everywhere)
    OUT["j_ack_states"] = sorted({r["ack_state"] for r in everywhere["rows"]})
    OUT["j_cy_ack"] = next((r["ack_state"] for r in everywhere["rows"] if r["id"] == a7), None)
    who = sr.viewer(T, name="Dan Director", role="staff", types="DIRECTOR")
    panel = sr.panels(T, who=who)
    OUT["k_panel"] = [panel.get("replies_readable"), len(panel.get("replies") or []) > 5,
                      panel.get("replies_why")]
    feed = sr.feed(T, who=who)
    OUT["l_feed_via"] = sorted({r.get("via") for r in feed["rows"] if r.get("person") == "Ann Roe"
                                and r.get("kind") == "call_off"})

    # ── M. THE DIRECTOR ANSWERS BY A BARE TEXT ─────────────────────────────
    # The director's ask is kept per seat (handoff_ask_director:<name>); the phone it reached
    # is what lets a bare APPROVE or YES answer it.
    def director_asked(hid, ago_min=1):
        with psycopg2.connect(T) as c, c.cursor() as cur:
            cur.execute("UPDATE asa_shift_handoffs SET said = said || jsonb_build_object("
                        "%s, %s::jsonb) WHERE id=%s",
                        (shift_handoff._seat(shift_handoff.KIND_ASK_DIRECTOR, "Dee Direct"),
                         json.dumps({"state": "told", "why": "", "dial": "send", "test_mode": "off",
                                     "tries": 1, "phone_key": pr.phone_key(PHONE["Dee Direct"]),
                                     "at": (NOW - timedelta(minutes=ago_min)).isoformat()}), hid))
            c.commit()

    def two_yeses(hid, taker):
        shift_handoff.answer(T, hid, side="staff", word="yes", by=taker)
        shift_handoff.answer(T, hid, side="manager", word="yes", by="Hana Boss")

    m1 = shift_handoff.offer(T, location=JH, col_iso=D1, from_staff="Ann Roe", to_staff="Ian Idle",
                             created_by="test")["id"]
    two_yeses(m1, "Ian Idle")
    # before the ask reached the director's phone, a bare word gives nothing
    m_stray = text(PHONE["Dee Direct"], "APPROVE", 2)
    listen()
    OUT["m_stray"] = brief(m_stray)
    OUT["m_after_stray"] = shift_handoff.handoff(T, m1)["director_state"]
    director_asked(m1)
    m_approve = text(PHONE["Dee Direct"], "APPROVE", 0)
    listen()
    OUT["m_approve"] = brief(m_approve)
    h = shift_handoff.handoff(T, m1)
    OUT["m_after_approve"] = [h["director_state"], h["director_via"], h["director_by"], h["state"]]
    m2 = shift_handoff.offer(T, location=JH, col_iso=D2, from_staff="Fay Free", to_staff="Jo Late",
                             created_by="test")["id"]
    two_yeses(m2, "Jo Late")
    director_asked(m2)
    m_yes = text(PHONE["Dee Direct"], "yes", 0)
    listen()
    OUT["m_yes"] = brief(m_yes)
    h = shift_handoff.handoff(T, m2)
    OUT["m_after_yes"] = [h["director_state"], h["director_via"], h["director_by"], h["state"]]
except Exception as exc:  # noqa: BLE001
    OUT["crash"] = f"{type(exc).__name__}: {exc}"
    import traceback
    OUT["trace"] = traceback.format_exc()[-3000:]
finally:
    cbh.use_workbook(None)
    OUT["rooms"] = ROOMS.close()
print("LANE_RESULT " + json.dumps(OUT, default=str))
'''

MODULES = ("sms_ears", "shift_requests", "shift_handoff", "psi_reminders", "quo_inbox",
           "hotline_desk", "mirror_first", "calendar_builder_houses", "calendar_builder_write",
           "calendar_builder_slices", "house_cal_live", "shift_slices", "house_directory",
           "badge_follows", "effective_roster", "time_off", "redaction", "web_notices",
           # the punch pair rule, whose RECEIVED the ear hears and
           # acknowledges through situations of its own
           "punch_pairs", "psi_attendance")


def _lane_in_container(script_body: str = LANE) -> dict | None:
    # every module the roots reach, and the IST settings reader's declaration, in a folder of this run's own
    sources = lane_schema.with_imports(SERVER, (*MODULES, "ist_config"))
    return lane_schema.run_in(CONTAINER, lane_schema.script(sources, script_body, "sms-ears"))


print("\nTHE LANE — every road, against a real database")
lane = _lane_in_container()
if lane is None:
    print("  (skipped — no docker here to reach a relay container)")
    print("  NOTE: the pure half above still ran; the lane half did not.")
else:
    if lane.get("crash"):
        check("the lane ran to its end", False, lane.get("trace") or lane["crash"])
    L = lane.get
    owned = (L("owned") or {}).get("lane") or {}
    check("every table the lane reads resolves in its own schema before the first read — the replies "
          "ledger included, never public's",
          "asa_sms_replies" in owned and all(str(s).startswith("hub_test_sms_ears_") for s in owned.values()),
          L("owned"))
    P1, P2 = L("p1") or "", L("p2") or ""
    check("a bare YES while the shift flow's ask is open is the flow's answer — nothing else is done",
          (L("c_gus_yes") or [None])[0] == "shift_ask", L("c_gus_yes"))
    check("a late call (to the 4040) is the flow's too", (L("c_gus_late") or [None])[0] == "shift_ask",
          L("c_gus_late"))
    check("a YES with nothing waiting on it is written down as unmatched", (L("c_ian_nothing") or [None])[0]
          == "unmatched", L("c_ian_nothing"))
    nr = L("c_not_reply") or [[None], None]
    check("a text that is not a reply is written down as such, with who sent it — and its words are NOT kept",
          nr[0][0] == "not_a_reply" and nr[0][2] == "Gus Ask" and nr[1] == "", nr)
    check("a bare YES with exactly one call-off open to her APPLIES — and the house manager decides",
          (L("a_ann") or [None])[:4] == ["applied", "ok", "Ann Roe", "sms_reply_applied"]
          and (L("a_ann") or [None] * 5)[4] == "The house manager decides who takes it.", L("a_ann"))
    check("the application is by sms, dated by when the text was SENT, carrying the text's id, waiting",
          (L("a_ann_request") or [None])[:2] == ["sms", True] and (L("a_ann_request") or [0] * 4)[3]
          == "applied", L("a_ann_request"))
    check("a second YES is already on file — no second application, no second acknowledgement",
          (L("a_ann_again") or [None])[:4] == ["already", "already_applied", "Ann Roe", ""],
          L("a_ann_again"))
    check("a number nobody holds is never named and does nothing",
          (L("a_unknown") or [None])[:3] == ["unknown_sender", "unknown", ""], L("a_unknown"))
    check("the 5558 texting the 4040 — a company line — is `shared`, never a name",
          (L("a_company_line") or [None])[:3] == ["unknown_sender", "shared", ""], L("a_company_line"))
    r = L("a_caller") or [None] * 5
    check("the person who called off is refused their own shift, and told in their own words",
          r[0] == "refused" and r[1] == "called_off" and r[3] == "sms_reply_refused"
          and str(r[4]).startswith("the 8P-8A shift at JH on ")
          and "the shift you called off" in str(r[4]), r)
    r = L("a_nogrid") or [None] * 5
    check("a roster name no house calendar draws is refused — never applied under a display name",
          r[0] == "refused" and r[1] == "not_on_a_grid" and "house calendars" in str(r[4]), r)
    check("'Ok thanks' with one call-off open to him applies for nothing — an acknowledgement",
          (L("a_ok_thanks") or [None])[:4] == ["not_a_reply", "acknowledgement", "Lu Wait", ""],
          L("a_ok_thanks"))
    check("only Ann applied in that pass", L("a_requests") == [["Ann Roe"]], L("a_requests"))
    check("'I can take it' with the shift's ref, to the 4040, applies",
          (L("a_cy") or [None])[:2] == ["applied", "ok"], L("a_cy"))
    check("a bare YES pulled a pass later applies too", (L("a_jo") or [None])[:2] == ["applied", "ok"],
          L("a_jo"))
    check("ORDER BY WHEN IT WAS SENT: Jo, heard after Cy but sent before, stands ahead of Cy",
          L("a_order") == ["Ann Roe", "Jo Late", "Cy Taker"], L("a_order"))
    check("EXACTLY ONCE: a pass over texts already heard writes nothing", L("a_again_nothing") == 0,
          L("a_again_nothing"))
    r = L("a_eve_bare") or [None] * 5
    check("two call-offs open to her: a bare YES is AMBIGUOUS, and she is told both refs",
          r[0] == "ambiguous" and r[3] == "sms_reply_unclear" and P1 in str(r[4]) and P2 in str(r[4])
          and str(r[4]).startswith("we could not tell which it was for: ")
          and L("a_eve_cands") == sorted([P1, P2]), [r, L("a_eve_cands")])
    check("…and nothing was applied for", L("a_eve_no_request") == 0, L("a_eve_no_request"))
    check("her YES with the second ref applies to that shift", (L("a_eve_ref") or [None])[0] == "applied"
          and L("a_eve_request") == [["CAN - BM - BM4060", "sms"]], [L("a_eve_ref"), L("a_eve_request")])
    check("a bare YES from somebody a swap AND call-offs are waiting on is AMBIGUOUS — no swap accepted",
          (L("b_fay_bare") or [None])[0] == "ambiguous" and "handoff" in (L("b_fay_cands") or [])
          and "call_off" in (L("b_fay_cands") or []), [L("b_fay_bare"), L("b_fay_cands")])
    check("her YES with the swap's ref accepts it — by sms — and it waits on the house manager",
          (L("b_fay_ref") or [None])[:2] == ["answered", "staff_yes"]
          and L("b_after_fay") == ["accepted", "sms", "pending"]
          and "waits on the house manager" in str((L("b_fay_ref") or [""] * 5)[4]),
          [L("b_fay_ref"), L("b_after_fay")])
    check("a house manager's stray YES, from a phone the approval ask was not seen reaching, gives "
          "NOTHING — ambiguous, told the ref, the swap still waiting on her",
          (L("b_hana_stray") or [None])[:4] == ["ambiguous", "approval_needs_ref", "Hana Boss",
                                                "sms_reply_unclear"]
          and "reply YES HO" in str((L("b_hana_stray") or [""] * 5)[4])
          and L("b_after_stray") == ["pending", "pending"], [L("b_hana_stray"), L("b_after_stray")])
    check("the house manager's bare APPROVE answers the one approval waiting on her, and the swap is done",
          (L("b_hana") or [None])[:3] == ["answered", "manager_yes", "Hana Boss"]
          and L("b_after_hana") == ["approved", "sms", "done"], [L("b_hana"), L("b_after_hana")])
    check("the shift moved in the workbook", L("b_book") == ["9A-5P", ""], L("b_book"))
    check("a YES to a swap already done is refused, saying so",
          (L("b_closed") or [None])[:2] == ["refused", "swap_closed"], L("b_closed"))
    check("a ref no swap carries is refused", (L("b_unknown") or [None])[:2] == ["refused", "no_such_swap"],
          L("b_unknown"))
    check("a shift's ref the pool does not know WAITS (the sweep may not have met the call-off yet)",
          (L("e_wait") or {}).get("waiting") == 1 and L("e_wait_row") is None
          and "no open shift carries" in str((L("e_wait") or {}).get("why")), [L("e_wait"), L("e_wait_row")])
    check("…and past the wait it is refused, and the sender told",
          (L("e_refused") or [None])[:2] == ["refused", "no_such_shift"]
          and (L("e_refused") or [None] * 4)[3] == "sms_reply_refused", L("e_refused"))
    dw = L("d_wait") or {}
    check("contacts that cannot be read: a reply WAITS, never 'unknown' — and nothing is written down",
          dw.get("waiting", 0) >= 1 and (L("d_rows") or [1])[0] is None
          and "could not be read" in str(dw.get("why")), [dw, L("d_rows")])
    du = L("d_unheard") or [[None]] * 4
    check("past HOLD_H it is written down UNHEARD with the reason",
          du[0][0] == "unheard" and "roster could not be read" in str(du[1]), du)
    check("…and the text behind it from the same phone is written down after it, its sender said to be unread",
          du[2][0] == "not_a_reply" and du[3] == "unread", du)
    check("a text sent before the ear first listened is neither acted on nor written down",
          (L("g_before") or [False])[0] is True and (L("g_before") or [0, 1])[1] is None, L("g_before"))
    check("a pass that stopped between the application and its row finds the application carries THIS "
          "text's id: applied, not 'already'", (L("h_crash") or [None])[0] == "applied", L("h_crash"))
    owed = L("i_owed") or []
    check("the acknowledgements owed: the applications, the refusals, the ambiguities and the swap's answers",
          ["sms_reply_applied", "Ann Roe"] in owed and ["sms_reply_refused", "Ben Left"] in owed
          and ["sms_reply_unclear", "Eve Both"] in owed and ["sms_reply_answered", "Hana Boss"] in owed
          and ["sms_reply_answered", "Fay Free"] in owed, owed)
    check("…never to a number nobody holds, and never carrying the caller's name or the reason",
          all(p for _k, p in owed) and L("i_blob_clean") is True, owed)
    ar = L("i_ann_row") or {}
    check("the row names the shift and its ref, the house by code, and the sentence composed here",
          ar.get("kind") == "sms_reply_applied" and ar.get("house") == "ABD2704" and ar.get("ref") == P1
          and ar.get("value") == "8P-8A" and str(ar.get("id", "")).startswith("SMS|"), ar)
    check("nothing is offered inside the quiet window", L("i_quiet") == [], L("i_quiet"))
    check("what the door said is written down, and never offered again", L("i_marked") == [1, 0],
          L("i_marked"))
    check("'OK' IS NOT 'SENT': an acknowledgement only recorded (dial at record) is written down as "
          "recorded — never 'said' — and not offered again while the dial stays there",
          L("i_recorded_wrote") == 1 and L("i_recorded_owed_at_record") == 0
          and (L("i_recorded_state") or [None])[0] == "rehearsal"
          and "rehearsal book" in str((L("i_recorded_state") or ["", ""])[1]),
          [L("i_recorded_wrote"), L("i_recorded_owed_at_record"), L("i_recorded_state")])
    check("…and it is owed again the moment the dial moves to send", L("i_recorded_owed_at_send") == 1,
          L("i_recorded_owed_at_send"))
    check("one the door could not text (no phone) says so, and is tried again after the retry pause — "
          "never dropped for good", L("i_no_contact") == ["not_sent", 0, 1], L("i_no_contact"))
    ce = L("i_cy_expired") or [True, None]
    check("an acknowledgement no longer true (the application was withdrawn) is not said — written down as "
          "expired, with why", ce[0] is False and "no longer open" in str(ce[1]), ce)
    ud = L("i_unknown_door") or [1, [1]]
    check("a door that does not know these situations yet said nothing: nothing written down, asked again "
          "later", ud[0] == 0 and ud[1] == [], ud)
    nr2 = L("i_no_results") or [1, [1]]
    check("an answer with no word per row says nothing was said", nr2[0] == 0 and nr2[1] == [], nr2)
    ul = L("i_unclear_later") or []
    check("an ambiguity asked about later is dropped once nothing it could have meant is open — said only "
          "if still true",
          [x[0] for x in ul] == ["Eve Both", "Fay Free"]
          and all("nothing the text could have meant was still open" in str(x[1]) for x in ul), ul)
    je = L("j_everywhere") or []
    check("the list names every outcome the texts came to",
          {"applied", "already", "ambiguous", "refused", "answered", "shift_ask", "unmatched",
           "not_a_reply", "unknown_sender", "unheard"} <= set(je), je)
    jj = L("j_jh") or [False, 0, 0, [], True, True]
    check("the badges that decide everywhere read every text; a house's reader reads that house's",
          jj[0] is True and jj[1] > jj[2] > 0 and jj[4] is False and jj[5] is False, jj)
    check("the list never carries a call-off's roster row or its reason", L("j_no_row_key") is True)
    check("each acknowledgement's state is said: said, waiting, expired",
          {"said", "waiting", "expired"} <= set(L("j_ack_states") or []) and L("j_cy_ack") == "expired",
          [L("j_ack_states"), L("j_cy_ack")])
    kp = L("k_panel") or [False, False, "x"]
    check("the Requests panels carry the texts for a director", kp[0] is True and kp[1] is True, kp)
    check("an application made by text reads 'sms' as its road on the Requests list",
          L("l_feed_via") == ["sms"], L("l_feed_via"))
    check("a director's bare APPROVE before their ask was seen reaching the phone gives NOTHING — "
          "ambiguous, told the ref, the director's seat still waiting",
          (L("m_stray") or [None])[:3] == ["ambiguous", "approval_needs_ref", "Dee Direct"]
          and L("m_after_stray") == "pending", [L("m_stray"), L("m_after_stray")])
    check("THE THIRD CONSENT BY TEXT: once the director's own ask reached their phone, a bare "
          "APPROVE answers it — by sms, in their name — and the swap goes through",
          (L("m_approve") or [None])[:3] == ["answered", "director_yes", "Dee Direct"]
          and L("m_after_approve") == ["approved", "sms", "Dee Direct", "done"],
          [L("m_approve"), L("m_after_approve")])
    check("…and a bare YES does the same",
          (L("m_yes") or [None])[:3] == ["answered", "director_yes", "Dee Direct"]
          and L("m_after_yes") == ["approved", "sms", "Dee Direct", "done"],
          [L("m_yes"), L("m_after_yes")])


print(f"\n{results['ok']} ok, {len(results['failed'])} failed")
for name in results["failed"]:
    print("  FAILED:", name)
sys.exit(1 if results["failed"] else 0)
