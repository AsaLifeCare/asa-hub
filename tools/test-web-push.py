#!/usr/bin/env python3
"""The web switch, quiet window, mock rows and Web Push; nothing reaches a live table, push service or person."""
import ast
import base64
import json
import os
import stat
import subprocess
import sys
import tempfile
import types
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve()
ROOT = HERE.parent.parent
SERVER = ROOT / "server"
CONTAINER = os.getenv("HUB_RELAY_CONTAINER", "asa-hub-snapshot")
import lane_schema  # noqa: E402 — beside this file

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


if "psycopg2" not in sys.modules:  # pragma: no cover
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
os.environ.setdefault("HUB_SNAPSHOT_OUT", "/nonexistent/web-push-test")
import shift_requests as sr  # noqa: E402
import web_gate as wg  # noqa: E402
import web_notices as wn  # noqa: E402
import web_push as wp  # noqa: E402

UTC = timezone.utc
NOW = datetime(2026, 9, 22, 18, 0, tzinfo=UTC)
H1 = "CAN - 48TH (B) - ABD1711"


def lane(on, *, age_min=1, word=None, **extra):
    tm = {"on": on}
    if word:
        tm["word"] = word
    tm.update(extra)
    return {"place": "", "built_at": (NOW - timedelta(minutes=age_min)).isoformat(), "test_mode": tm}


print("\nG1 — the one switch, and any doubt is ON")

s = wg.switch_from(None, now=NOW)
check("no config lane read yet is ON, and says it could not read", s["on"] is True and not s["readable"], s)
s = wg.switch_from({"place": "", "built_at": NOW.isoformat()}, now=NOW)
check("a lane without the switch is ON, and names the missing part",
      s["on"] is True and not s["readable"] and "configLane" in s["why"], s)
s = wg.switch_from(lane(False, unreadable="Sheets said no"), now=NOW)
check("a lane in which Apps Script could not read the switch is ON", s["on"] is True and not s["readable"], s)
s = wg.switch_from(lane(False, age_min=16), now=NOW)
check("a lane older than fifteen minutes is ON — a lane that stopped coming is Apps Script down",
      s["on"] is True and not s["readable"] and "minutes old" in s["why"], s)
s = wg.switch_from(lane(False, age_min=11), now=NOW)
check("but a lane eleven minutes old is still believed: a slow build (420 s) plus the three-minute "
      "ask plus the ask itself is that long with nothing wrong, and must not flip the platform to ON",
      s["on"] is False and s["readable"] is True, s)
check("the staleness limit outlasts the builder's worst gap between two asks",
      wg.LANE_FRESH_S >= 420 + 180 + 45 + 45, wg.LANE_FRESH_S)
naive = wg.switch_from({"place": "", "built_at": NOW.astimezone(wn.OHIO).replace(tzinfo=None).isoformat(),
                        "test_mode": {"on": False}}, now=NOW)
check("a naive stamp is Ohio's wall clock on the gate as in the notices — one stamp, one instant",
      naive["on"] is False and naive["readable"] is True, naive)
s = wg.switch_from({"place": "", "test_mode": {"on": False}}, now=NOW)
check("a lane that says nothing of when it was read is ON", s["on"] is True, s)
s = wg.switch_from(lane("false"), now=NOW)
check("a word that is not a real boolean is ON — 'false' is not false", s["on"] is True and not s["readable"], s)
s = wg.switch_from(lane(True, word="sheet"), now=NOW)
check("test mode on, read fresh, is ON and readable, with its word",
      s == {"on": True, "readable": True, "word": "sheet", "why": ""}, s)
s = wg.switch_from(lane(False), now=NOW)
check("only a fresh, plain OFF is off", s["on"] is False and s["readable"] is True, s)
check("the mockup says on / off / unreadable",
      (wg.switch_word(wg.switch_from(lane(True), now=NOW)), wg.switch_word(s),
       wg.switch_word(wg.switch_from(None, now=NOW))) == ("on", "off", "unreadable"))
check("a hold made on an unreadable switch says so",
      wg.held_by_test(wg.switch_from(None, now=NOW)).startswith("held: test mode (unreadable")
      and wg.held_by_test(wg.switch_from(lane(True), now=NOW)) == "held: test mode")


print("\nG2 — the night is the relay's one copy of the window")

NY = sr.OHIO


def at_ny(h, m, sec=0):
    return datetime(2026, 9, 22, h, m, sec, tzinfo=NY)


check("21:30:59 is not quiet — the ask before a 22:00 shift lives in that minute",
      wg.quiet(at_ny(21, 30, 59)) is False)
check("21:31 is quiet", wg.quiet(at_ny(21, 31)) is True)
check("07:59:59 is quiet", wg.quiet(at_ny(7, 59, 59)) is True)
check("08:00 is not", wg.quiet(at_ny(8, 0)) is False)
check("the window as the rule states it", wg.quiet_words() == "21:31–07:59 New York", wg.quiet_words())
check("it ends at 08:00 New York", wg.quiet_ends(at_ny(23, 0)).astimezone(NY).strftime("%H:%M") == "08:00")


print("\nG3 — the mockup's rows")

check("a push is spelled as a clock — the device has no Time switch",
      wg.shift_words("930P-730A", "2026-09-23") == "9:30 PM – 7:30 AM", wg.shift_words("930P-730A", "2026-09-23"))
check("a cell with no hours is said as written, and nothing at all is 'a shift'",
      wg.shift_words("OPEN", "2026-09-23") == "OPEN" and wg.shift_words("", "2026-09-23") == "a shift")

HAL = sr.viewer("dsn", name="Hal Manager")
ADA = sr.viewer("dsn", name="Ada Admin", role="admin", types="ADMINISTRATOR")
ANN = sr.viewer("dsn", name="Ann Roe")
sr.house_managers = lambda dsn, fresh=False: {
    "readable": True, "why": "", "by_code": {"ABD1711": {"name": "Hal Manager", "phone": "", "house": H1}}}
HAL = sr.viewer("dsn", name="Hal Manager")
closes = (NOW + timedelta(hours=3)).isoformat()
co = {"id": 7, "key": "call_off:SPX", "kind": wn.K_CALL_OFF, "at": NOW.isoformat(), "location": H1,
      "col_iso": "2026-09-23", "ref": "SPX", "value": "930P-730A",
      "facts": {"caller": "Zed Caller", "reason": "sick kid", "house": "48TH (B)",
                "window": {"closes_at": closes, "state": "open"},
                "shift_start": (NOW + timedelta(days=1)).isoformat()},
      "published_at": NOW.isoformat()}
copies = [("Ann Roe", wn.shape(co, "invited", ANN)), ("Cy Far", wn.shape(co, "invited", sr.viewer("dsn", name="Cy Far"))),
          ("Hal Manager", wn.shape(co, "decider", HAL)), ("Ada Admin", wn.shape(co, "company", ADA))]
sw_on = wg.switch_from(lane(True), now=NOW)
rows = wg.mock_rows(wg.CH_NOTICE, co, copies, result="held", held_by=wg.held_by_test(sw_on),
                    reason="test mode is on", switch=sw_on, now=NOW)
header = set(wg.COMM_MOCK_HEADER) - {"createdAt", "updatedAt"}
check("every row carries every column of the mock outbox, and no other",
      all(set(r) == header for r in rows), [sorted(set(r) ^ header) for r in rows])
check("the mock outbox's header is the Apps Script one, column for column",
      list(wg.COMM_MOCK_HEADER) == [c.strip("'\" ") for c in
                                     (ROOT / "apps-script/CommMock.gs").read_text(encoding="utf-8")
                                     .split("var COMM_MOCK_HEADER = [")[1].split("];")[0]
                                     .replace("\n", "").split(",")])
by_role = {r["purpose"].split(" · ")[1]: r for r in rows}
check("one row per wording: the invited caregivers share one, the house manager and the company one each",
      len(rows) == 3 and by_role["the invited copy"]["audience"] == 2, [(r["purpose"], r["audience"]) for r in rows])
check("the audience is NAMED, in full — never only counted",
      by_role["the invited copy"]["to_masked"] == "Ann Roe, Cy Far", by_role["the invited copy"]["to_masked"])
check("channel, method, result and the hold use the mock outbox's words",
      all(r["channel"] == "web_notice" and r["method"] == "webNotice" and r["result"] == "held"
          and r["held_by"] == "held: test mode" and r["test_mode"] == "on" for r in rows))
check("no row carries the reason for a call-off", all("sick" not in json.dumps(r) for r in rows))
check("the caller is named only in the whole-company copy and the house manager's — a current ** row "
      "wears HM for their house — exactly as the bell cuts it; never to the invited caregivers",
      "Zed" not in json.dumps(by_role["the invited copy"]) and "Zed Caller" in by_role["the decider copy"]["body"]
      and "Zed Caller" in by_role["the company copy"]["body"])
check("the words are spelled for a reader with no Time switch",
      "9:30 PM – 7:30 AM" in by_role["the invited copy"]["body"], by_role["the invited copy"]["body"])
again = wg.mock_rows(wg.CH_NOTICE, co, copies, result="held", held_by="held: test mode", reason="x",
                     switch=sw_on, now=NOW + timedelta(minutes=3))
check("the same event held twice is the same row id — one row on the disk and in the book",
      sorted(r["id"] for r in rows) == sorted(r["id"] for r in again))
check("a row id is one the door can recognise", all(r["id"].startswith("web_") and len(r["id"]) == 24 for r in rows))

with tempfile.TemporaryDirectory(prefix="web-gate-test-") as tmp:
    root = Path(tmp) / "mock"
    kept = wg.record(rows, root=root, now=NOW)
    kept2 = wg.record(again, root=root, now=NOW)
    files = list(root.glob("*.jsonl"))
    check("rows are kept on the disk, once", kept == {"added": 3, "duplicate": 0}
          and kept2 == {"added": 0, "duplicate": 3}, (kept, kept2))
    check("PRIVATE: the folder is 0700 and every file 0600 — the rows name people",
          stat.S_IMODE(root.stat().st_mode) == 0o700
          and all(stat.S_IMODE(f.stat().st_mode) == 0o600 for f in files),
          [oct(stat.S_IMODE(p.stat().st_mode)) for p in [root, *files]])
    ids = [r["id"] for r in wg.pending(root=root)]
    check("what waits is handed over oldest first", len(ids) == 3)
    said = wg.after_handoff({"status": 400, "message": "Unknown action: commMockWebIngest"}, ids, root=root, now=NOW)
    check("a door that is not published takes nothing, and says why",
          said["handed"] == 0 and not said["ok"] and "Unknown action" in said["why"]
          and wg.waiting_count(root=root) == 3, said)
    said = wg.after_handoff({"status": 200, "data": {}}, ids, root=root, now=NOW)
    check("a 200 that names nothing took nothing", said["handed"] == 0 and wg.waiting_count(root=root) == 3, said)
    said = wg.after_handoff({"status": 200, "data": {"written": [ids[0], "web_not_offered"],
                                                     "refused": [{"id": ids[1], "why": "bad row"}]}},
                            ids[:2], root=root, now=NOW)
    lines = [json.loads(x) for f in root.glob("*.jsonl") for x in f.read_text().splitlines()]
    tried = {x["id"]: x for x in lines}
    check("ONLY what the door names as written is handed — and nothing it was not offered",
          said["handed"] == 1 and wg.waiting_count(root=root) == 2 and tried[ids[0]]["handed_at"], said)
    check("a refusal is a try with the door's reason; a row not named is a try too; one not offered is not",
          tried[ids[1]]["tries"] == 3 and tried[ids[1]]["last_error"] == "bad row"
          and tried[ids[2]]["tries"] == 2 and tried[ids[2]]["last_error"] == "not named in the door's answer",
          tried)
    check("the rows tried least go first", wg.pending(root=root)[0]["id"] == ids[2])
    with open(files[0], "a", encoding="utf-8") as fh:
        fh.write('{"id": "web_torn", "row": {"id"')
    check("a line torn by a crash is not a row, and breaks nothing", wg.waiting_count(root=root) == 2)
    wg.after_handoff({"status": 200, "data": {"written": ids[1:]}}, ids[1:], root=root, now=NOW)
    later = NOW + timedelta(days=2)
    rot = wg.rotate(root=root, now=later)
    check("a finished day whose every row the sheet took is zipped",
          rot["zipped"] == 1 and not list(root.glob("*.jsonl")) and list(root.glob("*.jsonl.gz")), rot)
    kept3 = wg.record(again, root=root, now=later)
    check("and its rows still count: the same row is not kept twice", kept3["added"] == 0, kept3)
    wg.record([{**rows[0], "id": "web_" + "f" * 20}], root=root, now=later)
    rot2 = wg.rotate(root=root, now=later + timedelta(days=1))
    check("a day with a row still waiting is never zipped", rot2["zipped"] == 0 and list(root.glob("*.jsonl")), rot2)


print("\nP1 — the keys")

with tempfile.TemporaryDirectory(prefix="web-push-keys-") as tmp:
    missing = wp.keys(Path(tmp) / "nope.json")
    check("no key file is no push, and says where it looked and what to run",
          missing["ok"] is False and "nope.json" in missing["why"] and "mint_vapid_keys" in missing["why"], missing)
    bad = Path(tmp) / "bad.json"
    bad.write_text("{not json")
    check("a file that is not JSON is no keys", wp.keys(bad)["ok"] is False)
    kpath = Path(tmp) / "k.json"
    tool = [sys.executable, str(ROOT / "tools/mint_vapid_keys.py"), "--path", str(kpath)]
    dry = subprocess.run(tool + ["--dry-run"], capture_output=True, text=True)
    check("a dry run writes nothing", dry.returncode == 0 and not kpath.exists(), dry.stdout + dry.stderr)
    first = subprocess.run(tool, capture_output=True, text=True)
    body = json.loads(kpath.read_text()) if kpath.exists() else {}
    check("the mint writes a pair", first.returncode == 0 and body.get("public_key") and body.get("private_key"),
          first.stdout + first.stderr)
    check("0600, from the first byte", stat.S_IMODE(kpath.stat().st_mode) == 0o600)
    check("the private key is NEVER printed",
          body.get("private_key", "x") not in first.stdout + first.stderr
          and body.get("public_key", "") in first.stdout)
    second = subprocess.run(tool, capture_output=True, text=True)
    check("run again, it keeps the pair — a new one would orphan every device",
          second.returncode == 0 and json.loads(kpath.read_text()) == body and "kept" in second.stdout
          and body["private_key"] not in second.stdout + second.stderr, second.stdout)
    broken = Path(tmp) / "broken.json"
    broken.write_text(json.dumps({"public_key": body["public_key"], "private_key": base64.urlsafe_b64encode(
        os.urandom(32)).decode().rstrip("="), "subject": "https://x"}))
    before = broken.read_text()
    third = subprocess.run([sys.executable, str(ROOT / "tools/mint_vapid_keys.py"), "--path", str(broken)],
                           capture_output=True, text=True)
    check("a file whose two halves do not belong together is refused, and left as it was",
          third.returncode == 2 and broken.read_text() == before and "does not belong" in third.stderr,
          third.stderr)
    got = wp.keys(kpath)
    check("the relay reads the minted file as usable keys",
          got["ok"] is True and got["public_key"] == body["public_key"] and got["subject"].startswith("https://"), got)
    check("the key the browser is handed is the public one", wp.public_key(kpath) == body["public_key"])
    kpath.write_text(json.dumps({**body, "subject": "ftp://x"}))
    check("a subject a push service cannot write to is no keys", wp.keys(kpath)["ok"] is False)


print("\nP2 — who gets a push, and when a held one still goes")

p256 = base64.urlsafe_b64encode(b"\x04" + os.urandom(64)).decode().rstrip("=")
auth = base64.urlsafe_b64encode(os.urandom(16)).decode().rstrip("=")
good = {"endpoint": "https://fcm.googleapis.com/fcm/send/abc", "keys": {"p256dh": p256, "auth": auth}}
check("a browser's subscription is believed only when it is one",
      wp.clean_subscription(good) == {"endpoint": good["endpoint"], "p256dh": p256, "auth": auth})
check("the push services browsers really hand out are believed — Firefox, Safari, Edge",
      all(wp.clean_subscription({**good, "endpoint": e}) for e in (
          "https://updates.push.services.mozilla.com/wpush/v2/x", "https://web.push.apple.com/QK",
          "https://wns2-par02p.notify.windows.com/w/?token=x")))
check("an endpoint on any other host is refused — the relay is never pointed at an address somebody chose",
      wp.clean_subscription({**good, "endpoint": "https://10.0.0.5/push"}) is None
      and wp.clean_subscription({**good, "endpoint": "https://asa-hub-snapshot:8080/hub-lanes/x"}) is None
      and wp.clean_subscription({**good, "endpoint": "https://fcm.googleapis.com.evil.example/x"}) is None
      and wp.clean_subscription({**good, "endpoint": "https://evilfcm.googleapis.com@x.example/x"}) is None)
# strings urllib and urllib3 would parse differently are refused
for bypass in ("https://asa-hub-snapshot:8080\\@fcm.googleapis.com/x",
               "https://127.0.0.1:8443\\@fcm.googleapis.com/fcm/send/x",
               "https://evil.example\\@fcm.googleapis.com/x",
               "https://user:pw@fcm.googleapis.com/x",
               "https://fcm.googleapis.com:8080/x",
               "https://fcm.googleapis.com/x#frag",
               "https://fcm.googleapis.com%2e/x",
               "https://fcm.googleapis.com:notaport/x"):
    check(f"an endpoint two parsers could read differently is refused: {bypass}",
          wp.clean_subscription({**good, "endpoint": bypass}) is None)
check("what is kept is rebuilt from its parts — the string the relay later POSTs to is the one checked",
      wp.clean_subscription({**good, "endpoint": "https://FCM.googleapis.com:443/fcm/send/abc?x=1"})["endpoint"]
      == "https://fcm.googleapis.com/fcm/send/abc?x=1")
check("an http endpoint, a short key or a missing secret is not a device",
      wp.clean_subscription({**good, "endpoint": "http://evil/x"}) is None
      and wp.clean_subscription({**good, "keys": {"p256dh": "abc", "auth": auth}}) is None
      and wp.clean_subscription({**good, "keys": {"p256dh": p256}}) is None
      and wp.clean_subscription("nope") is None)
inv, dec, com = copies[0][1], copies[2][1], copies[3][1]
app = wn.shape({**co, "kind": wn.K_APPLICATION, "key": "application:1", "facts": {"person": "Ann Roe"}},
               "decider", HAL)
dec_app = wn.shape({**co, "kind": wn.K_DECIDED, "key": "decided:1", "facts": {"person": "Ann Roe"}},
                   "company", ADA)
check("an urgent copy goes to everybody it is for, live or not",
      wp.wants_push(inv, live=True) and wp.wants_push(dec, live=True) and wp.wants_push(com, live=False))
check("a high copy that is not urgent goes only to somebody with no live tab",
      wp.wants_push(app, live=False) and not wp.wants_push(app, live=True))
check("a normal copy never interrupts — it waits in the bell", not wp.wants_push(dec_app, live=False))
check("a copy the relay holds is never pushed, and nothing is not a copy",
      not wp.wants_push({**inv, "held": True}, live=False) and not wp.wants_push(None, live=False))
staff_news = wn.shape(co, "staff", sr.viewer("dsn", name="Ben Left"))
check("the staff's news copy of a call-off is for the people online — never pushed to a phone",
      staff_news["priority"] == "high" and not wp.wants_push(staff_news, live=False)
      and not wp.wants_push(staff_news, live=True), staff_news)
check("a copy that could not be judged is not a copy", not wp.wants_push(wn.Unjudged("x"), live=False))
check("a push test mode held is not among what the release may send", wp.RELEASABLE_STATES == (wp.S_HELD_QUIET,))
check("an invitation whose window closed while it was held is not news",
      wp.still_news(co, {**inv, "expires_at": (NOW - timedelta(minutes=1)).isoformat()}, NOW)[0] is False)
check("a call-off whose shift started while it was held is not news",
      wp.still_news({**co, "facts": {**co["facts"], "shift_start": (NOW - timedelta(minutes=5)).isoformat()}},
                    dec, NOW)[0] is False)
check("anything older than a night is not news",
      wp.still_news({**co, "kind": wn.K_APPLICATION, "published_at": (NOW - timedelta(hours=15)).isoformat()},
                    app, NOW)[0] is False)
check("a fresh one still is", wp.still_news(co, inv, NOW) == (True, ""))
pay = wp.payload_of(co, inv)
check("what travels is the reader's words, tagged by the notice — the page's own tag",
      pay["tag"] == "srv-7" and pay["href"] == inv["href"] and pay["urgent"] is True
      and set(pay) == {"v", "id", "tag", "title", "body", "href", "urgent", "kind", "at"}, pay)
check("no reason and no caller in a caregiver's push",
      "sick" not in json.dumps(pay) and "Zed" not in json.dumps(pay), pay)
check("and the shift as a clock", "9:30 PM – 7:30 AM" in pay["body"], pay["body"])
check("an invitation's push lives until its window closes, within a minute and a day",
      abs(wp.ttl_of(co, inv, NOW) - 3 * 3600) <= 1 and wp.ttl_of(co, {**inv, "expires_at": ""}, NOW) == 86400
      and wp.ttl_of(co, {**inv, "expires_at": NOW.isoformat()}, NOW) == 60)


print("\nP3 — the wiring")

svc = (SERVER / "snapshot_service.py").read_text(encoding="utf-8")
tree = ast.parse(svc)


def body_of(name):
    node = next(n for n in ast.walk(tree) if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))
                and n.name == name)
    return ast.get_source_segment(svc, node)


check("the relay imports the gate and the pushes under a guard",
      "try:\n    import web_gate\nexcept Exception" in svc and "try:\n    import web_push\nexcept Exception" in svc)
check("a gate that did not import holds everything: the switch reads ON",
      '"on": True' in body_of("_web_switch") and "web_gate is None" in body_of("_web_switch"))
check("the switch is the config lane's resolved state — the lane the relay already asks for",
      'web_gate.switch_from(_config_lane_for(""))' in body_of("_web_switch"))
fan = body_of("_notice_fan")
check("a stored notice asks the switch BEFORE any frame is shaped, and holds everything when it is on",
      0 < fan.find("_web_switch()") < fan.find("_notice_frames") and fan.find("_notice_hold") < fan.find("_notice_frames")
      and "return" in fan[fan.find("_notice_hold"):fan.find("_notice_frames")])
check("the bell door tells the inbox it is held while the switch is on",
      "held=held" in body_of("lane_notices") and "_web_switch()" in body_of("lane_notices"))
for door in ("lane_push_key", "lane_push_subscribe", "lane_push_unsubscribe"):
    check(f"the door {door} needs a session", "await _session_actor(authorization)" in body_of(door))
sub_src = body_of("lane_push_subscribe")
check("a device is kept for the SESSION's account, never for an id the body names",
      "uid=actor[1]" in sub_src and "user_id" not in sub_src)
check("no device is kept while the relay has no key to push it with", "public_key" in sub_src and "409" in sub_src)
check("the notices' loop carries the web beat, in its own try",
      "await _web_beat()" in body_of("_notices_loop"))
check("the mockup is handed to Python's commMockWebIngest, needing no exec URL",
      '_backend_pass(COMM_MOCK_APP, "commMockWebIngest"' in body_of("_web_mock_handoff")
      and "EXEC_URL" not in body_of("_web_mock_handoff"))
routes = {n.args[0].value for n in ast.walk(tree) if isinstance(n, ast.Call)
          and getattr(n.func, "attr", "") in ("get", "post") and getattr(n.func, "value", None) is not None
          and getattr(n.func.value, "id", "") == "app" and n.args and isinstance(n.args[0], ast.Constant)}
check("the three device doors sit under /hub-lanes/, which nginx already sends to the relay",
      {"/hub-lanes/push/key", "/hub-lanes/push/subscribe", "/hub-lanes/push/unsubscribe"} <= routes)
for suite in ("test-psi-anywhere.py", "test-hotline-fast.py", "test-hotline-lanes.py"):
    src = (HERE.parent / suite).read_text(encoding="utf-8")
    mods = ast.literal_eval(next(n.value for n in ast.parse(src).body if isinstance(n, ast.Assign)
                                 and any(getattr(t, "id", "") == "MODULES" for t in n.targets)))
    check(f"{suite} ships the checkout's web_gate and web_push", {"web_gate", "web_push"} <= set(mods))
pkg = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
check("npm run check runs this file",
      "npm run test:web-push" in pkg["scripts"]["check"]
      and pkg["scripts"].get("test:web-push") == "python3 tools/test-web-push.py")
swjs = (ROOT / "public/sw.js").read_text(encoding="utf-8")
check("the service worker is a real file with a push and a click handler, and NO fetch handler",
      "addEventListener('push'" in swjs and "addEventListener('notificationclick'" in swjs
      and "addEventListener('fetch'" not in swjs and "showNotification" in swjs)
check("a click opens only the platform's own routes", "safeHref" in swjs and "startsWith('//')" in swjs)
manifest = json.loads((ROOT / "public/app-manifest.json").read_text(encoding="utf-8"))
check("the manifest is standalone, scoped to the platform, and every icon it names exists",
      manifest.get("display") == "standalone" and manifest.get("scope") == "./"
      and all((ROOT / "public" / i["src"]).is_file() for i in manifest.get("icons") or [])
      and {"192x192", "512x512"} <= {i["sizes"] for i in manifest["icons"]})
index = (ROOT / "index.html").read_text(encoding="utf-8")
check("index.html links the manifest and the Home Screen icon an iPhone reads",
      'rel="manifest" href="/app-manifest.json"' in index
      and 'rel="apple-touch-icon"' in index and (ROOT / "public/icons/apple-touch-icon.png").is_file())
check("the manifest is not one of the two names the web server refuses",
      not manifest.get("name", "").startswith("snapshot") and not (ROOT / "public/manifest.json").exists())


LANE = r'''
import asyncio, base64, json, os, shutil, sys, tempfile, threading, time
import importlib.abc, importlib.util
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer

SRC = json.loads(base64.b64decode(WEB_PUSH_SOURCES))  # noqa: F821 — set by the host half
# the shift, notice and push family: every table their SQL names must be the run's own
SCANNED = ("web_push", "web_notices", "web_gate", "shift_requests", "shift_handoff", "house_cal_live",
           "calendar_builder_houses", "calendar_builder_write", "effective_roster", "time_off",
           "open_shift_covered", "calloff_road", "psi_attendance", "sms_ears")


class Checkout(importlib.abc.MetaPathFinder, importlib.abc.Loader):
    def find_spec(self, name, path, target=None):
        if name in SRC:
            return importlib.util.spec_from_loader(name, self, origin="checkout:" + name)
        return None

    def create_module(self, spec):
        return None

    def exec_module(self, module):
        module.__file__ = "/srv/app/" + module.__name__ + ".py"
        exec(compile(SRC[module.__name__], "checkout/" + module.__name__ + ".py", "exec"), module.__dict__)


WORK = tempfile.mkdtemp(prefix="web-push-test-")
os.chmod(WORK, 0o700)
# NOTHING OF THE LIVE RELAY: its disk, its keys, its inbox, its clock probes.
os.environ["HUB_SNAPSHOT_OUT"] = WORK + "/out"
os.environ["HUB_WEB_MOCK_DIR"] = WORK + "/mock"
os.environ["HUB_WEBPUSH_VAPID_FILE"] = WORK + "/vapid.json"
os.environ["QUO_HOTLINE_WEBHOOK_KEY_FILE"] = "/nonexistent/web-push-test.key"
os.environ["HUB_QUO_MESSAGES_KEY_FILE"] = "/nonexistent/web-push-test-messages.key"
os.environ["HUB_QUO_API_KEY_FILE"] = "/nonexistent/web-push-test-api.key"
os.environ["HUB_QUO_INBOX_DIR"] = WORK + "/quo-inbox"
os.environ["HUB_PSI_PROBE"] = "0"
os.environ["HUB_PSI_SECRET_FILE"] = "/nonexistent/web-push-test.json"
os.environ["HUB_PSI_TY_SECRET_FILE"] = "/nonexistent/web-push-test-ty.json"
os.environ["HUB_PSI_FULL_DIR"] = WORK + "/psi-full"
os.environ.pop("QUO_HOTLINE_WEBHOOK_KEY", None)
os.makedirs(WORK + "/out", exist_ok=True)
sys.meta_path.insert(0, Checkout())
sys.path.insert(0, "/srv/app")

import psycopg2, psycopg2.extras  # noqa: E402
from cryptography.hazmat.primitives import serialization  # noqa: E402
from cryptography.hazmat.primitives.asymmetric import ec  # noqa: E402
import lane_schema  # noqa: E402
import snapshot_service as svc  # noqa: E402
import house_cal_live, shift_handoff  # noqa: E402
import calendar_builder_houses as cbh  # noqa: E402
import shift_requests as sr  # noqa: E402
import web_gate as wg  # noqa: E402
import web_notices as wn  # noqa: E402
import web_push as wp  # noqa: E402
import time_off  # noqa: E402
# no Time Off house: this schema's own mirror has no Essencial, and the verdict never reads the live one
time_off.use_house(time_off.NoHouse())

OUT = {"origin": [getattr(m.__spec__, "origin", "") for m in (svc, wg, wp, wn)]}
DSN = os.environ["HUB_SNAPSHOT_PG_DSN"]
ROOMS = lane_schema.Rooms(DSN, "web-push")
SCHEMA = ROOMS.name()
H1 = "CAN - 48TH (B) - ABD1711"
today = datetime.now(sr.OHIO).date()
OLD = (today - timedelta(days=3)).isoformat()
D1 = (today + timedelta(days=1)).isoformat()
D2 = (today + timedelta(days=2)).isoformat()
ISOS = [OLD, D1, D2]

# ── keys of this run's own, and a push service of this run's own ────────────
def b64(raw):
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")

vk = ec.generate_private_key(ec.SECP256R1())
fd = os.open(WORK + "/vapid.json", os.O_WRONLY | os.O_CREAT, 0o600)
with os.fdopen(fd, "w") as fh:
    json.dump({"public_key": b64(vk.public_key().public_bytes(serialization.Encoding.X962,
                                                               serialization.PublicFormat.UncompressedPoint)),
               "private_key": b64(vk.private_numbers().private_value.to_bytes(32, "big")),
               "subject": "https://asamylife.asalifecare.com"}, fh)

CODES = {"/a": [201] * 50, "/h": [201] * 50, "/c": [410] * 50, "/d": [500] * 50}
HITS = []


class Push(BaseHTTPRequestHandler):
    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(n)
        HITS.append({"path": self.path, "auth": self.headers.get("Authorization") or "",
                     "enc": self.headers.get("Content-Encoding") or "", "ttl": self.headers.get("TTL") or "",
                     "urgency": self.headers.get("Urgency") or "", "bytes": len(body)})
        self.send_response(CODES.get(self.path, [404]).pop(0))
        self.end_headers()

    def log_message(self, *a):
        pass


srv = HTTPServer(("127.0.0.1", 0), Push)
threading.Thread(target=srv.serve_forever, daemon=True).start()
BASE = f"http://127.0.0.1:{srv.server_port}"


def device(path):
    k = ec.generate_private_key(ec.SECP256R1())
    return {"endpoint": BASE + path, "p256dh": b64(k.public_key().public_bytes(
        serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)), "auth": b64(os.urandom(16))}


# ── the estate, the IST book and the managers, as test-web-notices holds them ─
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
sr._attendance_board = lambda: {"rows": []}

ACCOUNTS = [{"uid": "u-ann", "role": "staff", "types": "", "label": "Ann Roe"},
            {"uid": "u-cy", "role": "staff", "types": "", "label": "Cy Far"},
            {"uid": "u-hal", "role": "staff", "types": "", "label": "Hal Manager"},
            {"uid": "u-ada", "role": "admin", "types": "ADMINISTRATOR", "label": "Ada Admin"},
            {"uid": "u-zed", "role": "staff", "types": "", "label": "Zed Caller"},
            {"uid": "u-ben", "role": "staff", "types": "", "label": "Ben Left"}]
ROSTER = {"u-ann": "Ann Roe", "u-cy": "Cy Far", "u-hal": "Hal Manager", "u-ada": "Ada Admin",
          "u-zed": "Zed Caller", "u-ben": "Ben Left"}
CFG = {"lane": None}
QUIET = {"on": False}
REAL_ACCOUNTS = svc._notice_accounts
REAL_ROSTER = svc._roster_name_of
REAL_REQUESTS_VIEWER = svc._requests_viewer
REAL_SESSION_ACTOR = svc._session_actor
svc._notice_accounts = lambda: ACCOUNTS
FAIL_ROSTER = set()


def fake_roster(uid, **k):
    if uid in FAIL_ROSTER:
        raise RuntimeError("the users copy could not be read")
    return ROSTER.get(uid, "")


svc._roster_name_of = fake_roster
svc._config_lane_for = lambda place: CFG["lane"]
wg.quiet = lambda at: QUIET["on"]
svc._notice_viewers.clear()
# as the relay's own start does: a notice stored while the switch is on is held for good
wn.set_hold_probe(lambda: bool(svc._web_switch().get("on")))
# every notice kind's situation switched on: this lane is about the push, not the Desk's switches
wn.set_situation_probe(lambda kind: {"armed": True, "unreadable": "", "why": ""})


def set_switch(on):
    CFG["lane"] = None if on is None else {
        "place": "", "built_at": datetime.now(timezone.utc).isoformat(),
        "test_mode": {"on": on, "word": "sheet" if on else "off"}}


def live(uid):
    q = asyncio.Queue(maxsize=32)
    q.notices = True
    svc._chat_subs.setdefault(uid, set()).add(q)
    return q


def drain(q):
    got = []
    while not q.empty():
        got.append(json.loads(q.get_nowait()))
    return got


def grid(rows):
    return {"cols": [{"iso": i} for i in ISOS],
            "rows": [{"employee": e, "cells": [{"text": t} for t in cs]} for e, cs in rows]}


SEEN = set()


def fan_new():
    """Every notice stored since the last look, carried as the relay carries it."""
    with psycopg2.connect(T) as c, c.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("SELECT * FROM asa_hub_notices ORDER BY id")
        rows = [wn._row_notice(dict(r)) for r in cur.fetchall()]
    fresh = [n for n in rows if n["id"] not in SEEN]
    for n in fresh:
        SEEN.add(n["id"])
        asyncio.run(svc._notice_fan(n))
    return fresh


def outbox():
    with psycopg2.connect(T) as c, c.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("SELECT o.notice_id, o.user_id, o.state, o.tries, o.why, o.words, n.kind "
                    "FROM asa_hub_push_outbox o JOIN asa_hub_notices n ON n.id=o.notice_id ORDER BY 1, 2")
        return [dict(r) for r in cur.fetchall()]


def ledger():
    rows = []
    for name in sorted(os.listdir(WORK + "/mock")) if os.path.isdir(WORK + "/mock") else []:
        if name.endswith(".jsonl"):
            with open(os.path.join(WORK, "mock", name)) as fh:
                rows += [json.loads(x) for x in fh if x.strip()]
    return rows


class Req:
    def __init__(self, body):
        self._body = body
        self.headers = {"user-agent": "web-push-test"}

    async def json(self):
        return self._body


ROOMS.make()
T = ROOMS.path(SCHEMA)
svc.PG_DSN = T
try:
    with psycopg2.connect(T) as c, c.cursor() as cur:
        cur.execute("CREATE TABLE asa_house_calendar_live (location TEXT PRIMARY KEY, "
                    "grid JSONB, updated_at TIMESTAMPTZ DEFAULT now())")
        cur.execute(house_cal_live.OVERRIDES_DDL)
        cur.execute(house_cal_live.CLAIMS_DDL)
        cur.execute(shift_handoff.HANDOFFS_DDL)
        cur.execute(shift_handoff.OPEN_INDEX_DDL)
        for stmt in sr.DDL + wn.DDL + wp.DDL:
            cur.execute(stmt)
        H1_GRID = grid([
            ("OPEN", ["", "4P-12A", ""]),
            ("Ann Roe", ["8A-4P", "", "8A-4P"]),
            ("Ben Left", ["8A-4P", "", ""]),
            ("Zed Caller", ["8A-4P", "", "10P-8A"]),
            ("Cy Far", ["", "", ""]),
        ])
        cur.execute("INSERT INTO asa_house_calendar_live (location, grid) VALUES (%s,%s)",
                    (H1, psycopg2.extras.Json(H1_GRID)))
        c.commit()
    # every table the shift, notice and push code reads is the run's before its first read
    OUT["owned"] = lane_schema.own_shift_lane(T, SCHEMA, {k: SRC[k] for k in SCANNED if k in SRC})
    # a stand-in workbook: a test schema never reaches the live one
    cbh.use_workbook(cbh.MemoryWorkbook.from_grids({H1: H1_GRID}))
    sr.forget_estate()
    sr.sweep(T)
    now = datetime.now(timezone.utc)
    with psycopg2.connect(T) as c, c.cursor() as cur:
        cur.execute("UPDATE asa_shift_pool SET opened_at=%s", (now,))
        cur.execute(
            "INSERT INTO asa_shift_pool (location, open_row, col_iso, kind, value, opened_at, "
            "shift_start, shift_end, called_off_by, reason, ref) VALUES "
            "(%s,%s,%s,'call_off','10P-8A',%s,%s,%s,'Zed Caller','sick kid',%s)",
            (H1, "Zed Caller", D2, now, sr.span_of(D2, "10P-8A")[0], sr.span_of(D2, "10P-8A")[1],
             sr.ref_of(H1, "Zed Caller", D2)))
        c.commit()
    # L0: the accounts, from this run's own users copy
    with psycopg2.connect(T) as c, c.cursor() as cur:
        cur.execute("CREATE TABLE asa_drive_sheets_rows (sheet_id TEXT, tab_name TEXT, row_number INT, "
                    "data JSONB, ingested_at TIMESTAMPTZ DEFAULT now())")
        c.commit()
    svc._NOTICE_ACCOUNTS.update({"at": 0.0, "rows": None})
    try:
        REAL_ACCOUNTS()
        OUT["l0_empty"] = "answered"
    except Exception as exc:  # noqa: BLE001
        OUT["l0_empty"] = type(exc).__name__ + ": " + str(exc)
    with psycopg2.connect(T) as c, c.cursor() as cur:
        for i, row in enumerate([
                {"user_id": "USR_A", "role": "staff", "types": "STAFF", "active": "TRUE", "display_name": "Ann Roe",
                 "pass_hash": "never-read"},
                {"user_id": "USR_B", "role": "staff", "types": "", "active": "FALSE", "display_name": "Gone Person"},
                {"user_id": "USR_C", "role": "client", "types": "CLIENT", "active": "TRUE", "display_name": "A Client"},
                {"user_id": "USR_D", "role": "admin", "types": "ADMINISTRATOR", "active": "TRUE", "display_name": ""},
                {"user_id": "", "role": "staff", "active": "TRUE", "display_name": "No Id"}]):
            cur.execute("INSERT INTO asa_drive_sheets_rows (sheet_id, tab_name, row_number, data) VALUES "
                        "(%s, 'users', %s, %s)", (svc.HUB_DB_SHEET_ID, i + 2, psycopg2.extras.Json(row)))
        cur.execute("INSERT INTO asa_drive_sheets_rows (sheet_id, tab_name, row_number, data) VALUES "
                    "('another-book', 'users', 2, %s)", (psycopg2.extras.Json(
                        {"user_id": "USR_X", "role": "admin", "active": "TRUE"}),))
        c.commit()
    svc._NOTICE_ACCOUNTS.update({"at": 0.0, "rows": None})
    OUT["l0_accounts"] = REAL_ACCOUNTS()

    # L0b: the roster name of a `USR_…` session through the real reader
    OUT["l0_roster"] = [REAL_ROSTER("USR_A"), REAL_ROSTER("USR_B"), REAL_ROSTER("USR_NOBODY"),
                        REAL_ROSTER("USR_D")]
    svc._roster_name_of = REAL_ROSTER

    async def as_usr_a(_auth):
        return ("staff", "USR_A")
    svc._session_actor = as_usr_a
    got_viewer = asyncio.run(REAL_REQUESTS_VIEWER("Bearer t"))
    OUT["l0_viewer"] = got_viewer[0]["name"] if isinstance(got_viewer, tuple) else got_viewer
    with psycopg2.connect(T) as c, c.cursor() as cur:
        # a live namesake makes the name nobody's; a merged one does not
        cur.execute("INSERT INTO asa_drive_sheets_rows (sheet_id, tab_name, row_number, data) VALUES "
                    "(%s, 'users', 90, %s)", (svc.HUB_DB_SHEET_ID, psycopg2.extras.Json(
                        {"user_id": "USR_M", "role": "staff", "active": "TRUE", "display_name": "ANN ROE",
                         "merged_into": "USR_A"})))
        c.commit()
    OUT["l0_merged_namesake"] = REAL_ROSTER("USR_A")
    with psycopg2.connect(T) as c, c.cursor() as cur:
        cur.execute("INSERT INTO asa_drive_sheets_rows (sheet_id, tab_name, row_number, data) VALUES "
                    "(%s, 'users', 91, %s)", (svc.HUB_DB_SHEET_ID, psycopg2.extras.Json(
                        {"user_id": "USR_E", "role": "staff", "active": "TRUE", "display_name": "ann  roe"})))
        c.commit()
    OUT["l0_ambiguous"] = [REAL_ROSTER("USR_A"), REAL_ROSTER("USR_E")]
    good_dsn, svc.PG_DSN = svc.PG_DSN, "dbname=web_push_test_none host=/nonexistent-socket-dir"
    try:
        REAL_ROSTER("USR_A", strict=True)
        OUT["l0_strict"] = "answered"
    except Exception as exc:  # noqa: BLE001
        OUT["l0_strict"] = "raised " + type(exc).__name__
    OUT["l0_lenient"] = REAL_ROSTER("USR_A")
    OUT["l0_viewer_down"] = asyncio.run(REAL_REQUESTS_VIEWER("Bearer t"))
    svc.PG_DSN = good_dsn
    svc._roster_name_of = fake_roster
    svc._session_actor = REAL_SESSION_ACTOR

    for uid, path in (("u-ann", "/a"), ("u-hal", "/h"), ("u-cy", "/c"), ("u-ada", "/d")):
        wp.subscribe(T, uid=uid, role="staff", sub=device(path))
    ann_q = live("u-ann")

    # ── L1: TEST MODE ON — nothing reaches anybody ────────────────────────
    set_switch(True)
    wn.catch_up(T)
    stored = fan_new()
    OUT["l1_kinds"] = sorted(n["kind"] for n in stored)
    OUT["l1_frames_to_ann"] = len(drain(ann_q))
    OUT["l1_hits"] = len(HITS)
    OUT["l1_outbox"] = sorted({(o["user_id"], o["kind"], o["state"]) for o in outbox()})
    led = ledger()
    OUT["l1_ledger"] = [{k: l["row"][k] for k in ("channel", "situation", "to_masked", "audience", "result",
                                                  "held_by", "test_mode", "subject", "body", "purpose")}
                        for l in led]
    OUT["l1_ledger_text"] = json.dumps(led)
    ANN = sr.viewer(T, name="Ann Roe")

    async def ann_viewer(_auth):
        return ANN, ("staff", "u-ann")
    svc._requests_viewer = ann_viewer
    OUT["l1_inbox"] = asyncio.run(svc.lane_notices(since=0, limit=60, authorization="Bearer t"))

    # ── L2: THE SWITCH CANNOT BE READ — still nothing ─────────────────────
    set_switch(None)
    # a non-urgent notice is pushed only to a reader with no live tab
    wn.publish(wn.K_NOT_CHOSEN, key="not_chosen:T1", dsn=T, location=H1, col_iso=D1, ref="SPT1",
               value="4P-12A", facts={"person": "Ann Roe", "house": "48TH (B)"})
    wn.publish(wn.K_NOT_CHOSEN, key="not_chosen:T1b", dsn=T, location=H1, col_iso=D1, ref="SPT1b",
               value="4P-12A", facts={"person": "Hal Manager", "house": "48TH (B)"})
    fan_new()
    OUT["l2_frames_to_ann"] = len(drain(ann_q))
    OUT["l2_hits"] = len(HITS)
    OUT["l2_rows"] = [l["row"]["test_mode"] + "|" + l["row"]["held_by"] for l in ledger()
                      if "not_chosen:T1" in l["row"]["ledger_key"]]
    OUT["l2_inbox"] = asyncio.run(svc.lane_notices(since=0, limit=60, authorization="Bearer t"))
    OUT["l2_outbox"] = [(o["user_id"], o["state"]) for o in outbox() if o["kind"] == "not_chosen"]

    # L3: switched off by day — held pushes are let go, new ones delivered
    set_switch(False)
    svc._chat_subs.pop("u-ann", None)
    OUT["l3_release"] = svc._push_release(wg.switch_from(CFG["lane"]))
    OUT["l3_release_hits"] = len(HITS)
    OUT["l3_let_go"] = sorted({(o["state"], o["why"]) for o in outbox()})
    OUT["l3_inbox"] = asyncio.run(svc.lane_notices(since=0, limit=60, authorization="Bearer t"))
    now3 = datetime.now(timezone.utc)
    with psycopg2.connect(T) as c, c.cursor() as cur:
        cur.execute(
            "INSERT INTO asa_shift_pool (location, open_row, col_iso, kind, value, opened_at, "
            "shift_start, shift_end, called_off_by, reason, ref) VALUES "
            "(%s,%s,%s,'call_off','8A-4P',%s,%s,%s,'Ann Roe','sick kid',%s)",
            (H1, "Ann Roe", D2, now3, sr.span_of(D2, "8A-4P")[0], sr.span_of(D2, "8A-4P")[1],
             sr.ref_of(H1, "Ann Roe", D2)))
        c.commit()
    wn.catch_up(T)
    fresh3 = fan_new()
    NEW = next((n for n in fresh3 if n["kind"] == "call_off"), {"id": -1})
    OUT["l3_new_kinds"] = sorted(n["kind"] for n in fresh3)
    OUT["l3_new_held"] = NEW.get("held")
    OUT["l3_hits"] = sorted(h["path"] for h in HITS)
    OUT["l3_hit_shape"] = all(h["auth"].startswith("vapid t=") and h["enc"] == "aes128gcm"
                              and int(h["ttl"] or 0) > 0 and h["bytes"] > 0 for h in HITS)
    OUT["l3_urgent"] = sorted({h["urgency"] for h in HITS})
    OUT["l3_outbox"] = sorted({(o["user_id"], o["state"]) for o in outbox() if o["notice_id"] == NEW["id"]})
    with psycopg2.connect(T) as c, c.cursor() as cur:
        cur.execute("SELECT user_id FROM asa_hub_push_subs ORDER BY 1")
        OUT["l3_devices"] = [r[0] for r in cur.fetchall()]
    words = {o["user_id"]: json.dumps(o["words"]) for o in outbox() if o["notice_id"] == NEW["id"]}
    OUT["l3_words_cy"] = words.get("u-cy", "")
    OUT["l3_words_hal"] = words.get("u-hal", "")
    OUT["l3_sent_rows"] = [l["row"]["to_masked"] + "|" + l["row"]["reason"] for l in ledger()
                           if l["row"]["channel"] == "web_push" and l["row"]["result"] == "sent"]

    # L4: a refusal is retried three times; a stale `sending` claim never
    with psycopg2.connect(T) as c, c.cursor() as cur:
        cur.execute("INSERT INTO asa_hub_push_outbox (notice_id, user_id, state, updated_at) "
                    "VALUES (%s, 'u-ben', 'sending', now() - interval '20 minutes')", (stored[0]["id"],))
        c.commit()
    before_l4 = len(HITS)
    wp.RETRY_S = 0
    svc._WEB_SAID["released"] = 0
    for _ in range(3):
        svc._push_release(wg.switch_from(CFG["lane"]))
    OUT["l4_d_hits"] = sum(1 for h in HITS if h["path"] == "/d")
    OUT["l4_ada"] = [(o["state"], o["tries"]) for o in outbox()
                     if o["user_id"] == "u-ada" and o["notice_id"] == NEW["id"]]
    OUT["l4_stuck"] = [(o["state"], o["tries"], o["why"]) for o in outbox() if o["user_id"] == "u-ben"]
    OUT["l4_other_hits"] = [h["path"] for h in HITS[before_l4:] if h["path"] != "/d"]

    # ── L5: a live reader gets the frame; no push unless it is urgent ─────
    hal_q = live("u-hal")
    before = len(HITS)
    sr.apply_for(T, location=H1, open_row="OPEN", col_iso=D1, person="Ann Roe")
    wn.catch_up(T)
    fan_new()
    OUT["l5_hal_frames"] = [f["notice"]["kind"] + "|" + f["notice"]["role"] for f in drain(hal_q)]
    OUT["l5_new_hits"] = [h["path"] for h in HITS[before:]]
    svc._chat_subs.pop("u-hal", None)
    before = len(HITS)
    # the manager decides once applications have closed, never inside the window
    with psycopg2.connect(T) as c, c.cursor() as cur:
        cur.execute("UPDATE asa_shift_pool SET opened_at = now() - interval '6 hours' "
                    "WHERE open_row = 'OPEN'")
        c.commit()
    sr.decide(T, location=H1, open_row="OPEN", col_iso=D1, person="Ann Roe", by="Hal Manager")
    wn.catch_up(T)
    fan_new()
    OUT["l5_decided_hits"] = [h["path"] for h in HITS[before:]]
    OUT["l5_decided_outbox"] = sorted({(o["user_id"], o["state"]) for o in outbox() if o["kind"] == "decided"})

    # ── L6: the night holds a push; a notice read meanwhile is never sent ─
    QUIET["on"] = True
    before = len(HITS)
    for key in ("not_chosen:T2", "not_chosen:T3"):
        wn.publish(wn.K_NOT_CHOSEN, key=key, dsn=T, location=H1, col_iso=D1, ref="SP" + key[-2:],
                   value="4P-12A", facts={"person": "Ann Roe", "house": "48TH (B)"})
    fan_new()
    OUT["l6_night_hits"] = len(HITS) - before
    ob = {o["notice_id"]: o for o in outbox() if o["kind"] == "not_chosen" and o["user_id"] == "u-ann"}
    OUT["l6_night_states"] = sorted(o["state"] for o in ob.values())
    OUT["l6_quiet_rows"] = [l["row"]["held_by"] for l in ledger() if l["row"]["result"] == "held_quiet"]
    svc._WEB_SAID["released"] = 0
    OUT["l6_release_at_night"] = svc._push_release(wg.switch_from(CFG["lane"]))
    t3 = max(ob)
    wn.mark_read(T, uid="u-ann", ids=[t3])
    QUIET["on"] = False
    OUT["l6_morning"] = svc._push_release(wg.switch_from(CFG["lane"]))
    OUT["l6_morning_hits"] = [h["path"] for h in HITS[before:]]
    OUT["l6_after"] = sorted((o["state"], o["why"]) for o in outbox()
                             if o["notice_id"] in ob and o["user_id"] == "u-ann")

    # L9: a failed read during the morning release waits
    QUIET["on"] = True
    t9 = wn.publish(wn.K_NOT_CHOSEN, key="not_chosen:T9", dsn=T, location=H1, col_iso=D1, ref="SPT9",
                    value="4P-12A", facts={"person": "Hal Manager", "house": "48TH (B)"})["id"]
    fan_new()
    QUIET["on"] = False
    FAIL_ROSTER.add("u-hal")
    svc._notice_viewers.clear()
    OUT["l9_release"] = svc._push_release(wg.switch_from(CFG["lane"]))
    OUT["l9_state"] = [(o["state"], o["why"]) for o in outbox() if o["notice_id"] == t9]
    FAIL_ROSTER.discard("u-hal")
    svc._notice_viewers.clear()
    before = len(HITS)
    svc._push_release(wg.switch_from(CFG["lane"]))
    OUT["l9_state_after"] = [o["state"] for o in outbox() if o["notice_id"] == t9]
    OUT["l9_hits"] = [h["path"] for h in HITS[before:]]

    # ── L10: TEST MODE GOING ON HALFWAY THROUGH A RELEASE stops the rest ──
    QUIET["on"] = True
    ids10 = [wn.publish(wn.K_NOT_CHOSEN, key=f"not_chosen:T10{p}", dsn=T, location=H1, col_iso=D1,
                        ref=f"SPT10{p}", value="4P-12A", facts={"person": who, "house": "48TH (B)"})["id"]
             for p, who in (("a", "Ann Roe"), ("h", "Hal Manager"))]
    fan_new()
    QUIET["on"] = False
    asked = {"n": 0}
    real_switch = svc._web_switch

    def flips():
        asked["n"] += 1
        on = asked["n"] > 1
        return {"on": on, "readable": True, "word": "on" if on else "off", "why": ""}
    svc._web_switch = flips
    try:
        OUT["l10_release"] = svc._push_release(wg.switch_from(CFG["lane"]))
    finally:
        svc._web_switch = real_switch
    OUT["l10_states"] = sorted(o["state"] for o in outbox() if o["notice_id"] in ids10)

    # L11: an unjudged push is recorded and sent by the next beat that can judge it
    FAIL_ROSTER.add("u-hal")
    svc._notice_viewers.clear()
    t11 = wn.publish(wn.K_NOT_CHOSEN, key="not_chosen:T11", dsn=T, location=H1, col_iso=D1, ref="SPT11",
                     value="4P-12A", facts={"person": "Hal Manager", "house": "48TH (B)"})["id"]
    fan_new()
    OUT["l11_outbox"] = [(o["state"], o["tries"], o["why"]) for o in outbox() if o["notice_id"] == t11]
    OUT["l11_rows"] = [l["row"]["result"] + "|" + l["row"]["to_masked"] for l in ledger()
                       if "not_chosen:T11" in l["row"]["ledger_key"]]
    FAIL_ROSTER.discard("u-hal")
    svc._notice_viewers.clear()
    before = len(HITS)
    svc._push_release(wg.switch_from(CFG["lane"]))
    OUT["l11_after"] = [o["state"] for o in outbox() if o["notice_id"] == t11]
    OUT["l11_hits"] = [h["path"] for h in HITS[before:]]

    # ── L7: the device doors keep a device for the session's own account ──
    async def as_zed(_auth):
        return ("staff", "u-zed")
    svc._session_actor = as_zed
    zed = device("/z")
    # a real push host, never pushed to
    zed["endpoint"] = "https://fcm.googleapis.com/fcm/send/web-push-test-" + os.urandom(6).hex()
    OUT["l7_bad"] = asyncio.run(svc.lane_push_subscribe(Req({"subscription": {"endpoint": "http://x"}}),
                                                       authorization="Bearer t"))["status"]
    OUT["l7_ok"] = asyncio.run(svc.lane_push_subscribe(Req({"subscription": {
        "endpoint": zed["endpoint"], "keys": {"p256dh": zed["p256dh"], "auth": zed["auth"]}}, "user_id": "u-ada"}),
        authorization="Bearer t"))
    with psycopg2.connect(T) as c, c.cursor() as cur:
        cur.execute("SELECT user_id FROM asa_hub_push_subs WHERE endpoint=%s", (zed["endpoint"],))
        OUT["l7_owner"] = [r[0] for r in cur.fetchall()]
    OUT["l7_key"] = asyncio.run(svc.lane_push_key(authorization="Bearer t"))["data"]["key"] == wp.public_key()
    real = wp.VAPID_FILE
    wp.VAPID_FILE = type(real)(WORK + "/no-such-keys.json")
    OUT["l7_no_key"] = asyncio.run(svc.lane_push_subscribe(Req({"subscription": {
        "endpoint": zed["endpoint"] + "2", "keys": {"p256dh": zed["p256dh"], "auth": zed["auth"]}}}),
        authorization="Bearer t"))["status"]
    OUT["l7_key_door_no_key"] = asyncio.run(svc.lane_push_key(authorization="Bearer t"))["data"]
    wp.VAPID_FILE = real

    async def as_ann(_auth):
        return ("staff", "u-ann")
    svc._session_actor = as_ann
    OUT["l7_other"] = asyncio.run(svc.lane_push_unsubscribe(Req({"endpoint": zed["endpoint"]}),
                                                           authorization="Bearer t"))["data"]["removed"]
    svc._session_actor = as_zed
    OUT["l7_own"] = asyncio.run(svc.lane_push_unsubscribe(Req({"endpoint": zed["endpoint"]}),
                                                         authorization="Bearer t"))["data"]["removed"]

    async def nobody(_auth):
        return None
    svc._session_actor = nobody
    OUT["l7_anon"] = [asyncio.run(svc.lane_push_key(authorization=""))["status"],
                      asyncio.run(svc.lane_push_subscribe(Req({}), authorization=""))["status"]]

    # ── L8: the mockup, handed to Python's door in batches (never the live app: the door is a stand-in) ──
    POSTS = []

    async def door(app_id, action, payload):
        POSTS.append({"app": app_id, "action": action, "payload": payload})
        rows = payload["rows"]
        return {"status": 200, "data": {"written": [r["id"] for r in rows[:2]],
                                        "refused": [{"id": rows[2]["id"], "why": "test refusal"}]}}
    svc._backend_pass = door
    svc._WEB_SAID["mock_last"] = 0
    waiting0 = wg.waiting_count()
    asyncio.run(svc._web_mock_handoff())
    OUT["l8_posts"] = len(POSTS)
    p0 = POSTS[0] if POSTS else {}
    OUT["l8_action"] = p0.get("action")
    OUT["l8_credential"] = p0.get("app") == svc.COMM_MOCK_APP
    OUT["l8_rows"] = len((p0.get("payload") or {}).get("rows") or [])
    OUT["l8_keys_ok"] = all(set(r) == set(wg.COMM_MOCK_HEADER) - {"createdAt", "updatedAt"}
                            for r in (p0.get("payload") or {}).get("rows") or [])
    OUT["l8_housekeeping"] = True
    OUT["l8_waiting"] = [waiting0, wg.waiting_count()]
    asyncio.run(svc._web_mock_handoff())
    OUT["l8_rate"] = len(POSTS)

    async def unpublished(app_id, action, payload):
        POSTS.append({"payload": payload})
        return {"status": 503, "message": "Python did not answer"}
    svc._backend_pass = unpublished
    svc._WEB_SAID["mock_last"] = 0
    w1 = wg.waiting_count()
    asyncio.run(svc._web_mock_handoff())
    OUT["l8_unpublished"] = [w1, wg.waiting_count()]
    # a refusing door is paused until a new engine build
    svc._WEB_SAID["mock_last"] = time.time() - 300
    n0 = len(POSTS)
    asyncio.run(svc._web_mock_handoff())
    n1 = len(POSTS)
    svc._ENGINE_BUILD = "web-push-test-new-build"
    asyncio.run(svc._web_mock_handoff())
    OUT["l8_backoff"] = [n1 - n0, len(POSTS) - n1]
    mock_dir = WORK + "/mock"
    OUT["l8_private"] = [oct(os.stat(mock_dir).st_mode & 0o777)] + sorted(
        {oct(os.stat(os.path.join(mock_dir, f)).st_mode & 0o777) for f in os.listdir(mock_dir)})
    OUT["reason_anywhere"] = "sick kid" in json.dumps(ledger()) or any(
        "sick" in json.dumps(o["words"]) for o in outbox())
finally:
    srv.shutdown()
    OUT["rooms"] = ROOMS.close()
    shutil.rmtree(WORK, ignore_errors=True)
    OUT["cleaned"] = not os.path.exists(WORK)
print("LANE_RESULT " + json.dumps(OUT, default=str))
'''


def _modules() -> list[str]:
    src = (HERE.parent / "test-hotline-fast.py").read_text(encoding="utf-8")
    mods = list(ast.literal_eval(next(n.value for n in ast.parse(src).body if isinstance(n, ast.Assign)
                                      and any(getattr(t, "id", "") == "MODULES" for t in n.targets))))
    for extra in ("web_gate", "web_push", "web_notices", "shift_slices", "calendar_builder_slices"):
        if extra not in mods:
            mods.append(extra)
    return mods


def _lane_in_container() -> dict | None:
    # every module the roots reach, from this checkout, and the helper that owns the run's tables
    sources = {k: v for k, v in lane_schema.with_imports(SERVER, _modules()).items() if not k.endswith(".json")}
    sources["lane_schema"] = (HERE.parent / "lane_schema.py").read_text(encoding="utf-8")
    blob = base64.b64encode(json.dumps(sources).encode()).decode()
    script = f"WEB_PUSH_SOURCES = {blob!r}\n" + LANE
    return lane_schema.run_in(CONTAINER, script, timeout=600, env={
        "HUB_IST_CONFIG_DECLARATION_JSON": (SERVER / "ist_config_defaults.json").read_text(encoding="utf-8")})


print("\nL — the whole lane, in the relay's container")
got = _lane_in_container()
if got is None:
    print("  (skipped — no relay container to hold a database and a push service here)")
    print("  NOTE: the pure half above still ran; the lane half did not.")
elif got.get("crash"):
    check("the lane ran to its end", False, got.get("trace") or got["crash"])
else:
    L = got
    owned = (L.get("owned") or {}).get("lane") or {}
    check("every table the shift, notice and push code reads resolves in the run's own schema before the "
          "first read, never public's",
          {"asa_hub_notices", "asa_shift_pool"} <= set(owned)
          and all(str(s).startswith("hub_test_web_push_") for s in owned.values()), L.get("owned"))
    check("the checkout's modules are the ones imported, not /srv/app's",
          all(o.startswith("checkout:") for o in L["origin"]), L["origin"])
    check("L0: a users copy that holds nobody is an error, never 'nobody would have heard it'",
          L["l0_empty"].startswith("RuntimeError"), L["l0_empty"])
    check("L0: the accounts are the Core's active staff, managers and admins — not a client, not a "
          "closed account, not another book's — and no field beyond the four it needs and the mark that keeps "
          "the master's own row out of every list",
          L["l0_accounts"] == [{"uid": "USR_A", "role": "staff", "types": "STAFF", "label": "Ann Roe", "unlisted": ""},
                               {"uid": "USR_D", "role": "admin", "types": "ADMINISTRATOR", "label": "USR_D",
                                "unlisted": ""}],
          L["l0_accounts"])
    check("L1: the call-off and the open shift were stored — the store is the record, not a message",
          L["l1_kinds"] == ["call_off", "open_shift"], L["l1_kinds"])
    check("L1: test mode ON — the live reader's stream got NO frame", L["l1_frames_to_ann"] == 0)
    check("L1: test mode ON — NO push reached any device", L["l1_hits"] == 0, L["l1_hits"])
    states = {s for _, _, s in L["l1_outbox"]}
    check("L1: every push owed is held in the outbox as `held_test`, nothing sent",
          states == {"held_test"} and len(L["l1_outbox"]) >= 4, L["l1_outbox"])
    check("L1: an urgent call-off is held for everybody it is for — the invited, the house manager, the company",
          {("u-ann", "call_off"), ("u-hal", "call_off"), ("u-ada", "call_off"), ("u-cy", "call_off")}
          <= {(u, k) for u, k, _ in L["l1_outbox"]}, L["l1_outbox"])
    check("L1: the caller is not held a push for their own call-off",
          ("u-zed", "call_off") not in {(u, k) for u, k, _ in L["l1_outbox"]})
    notice_rows = [r for r in L["l1_ledger"] if r["channel"] == "web_notice"]
    push_rows = [r for r in L["l1_ledger"] if r["channel"] == "web_push"]
    check("L1: every notice became mockup rows for the bell (web_notice) and the push (web_push)",
          {r["situation"] for r in notice_rows} == {"call_off", "open_shift"}
          and {r["situation"] for r in push_rows} >= {"call_off"}, [(r["channel"], r["situation"]) for r in L["l1_ledger"]])
    check("L1: each row says 'held: test mode', result held, test mode on",
          all(r["held_by"] == "held: test mode" and r["result"] == "held" and r["test_mode"] == "on"
              for r in L["l1_ledger"]), [r["held_by"] for r in L["l1_ledger"]])
    invited = [r for r in notice_rows if r["situation"] == "call_off" and "the invited copy" in r["purpose"]]
    check("L1: the audience is named — the caregivers the call-off invites, never the caller",
          invited and "Ann Roe" in invited[0]["to_masked"] and "Cy Far" in invited[0]["to_masked"]
          and "Zed" not in invited[0]["to_masked"], invited)
    check("L1: no mockup row carries the reason", "sick kid" not in L["l1_ledger_text"])
    inbox = L["l1_inbox"]
    check("L1: the bell door answers HELD with not one notice in it",
          inbox["status"] == 200 and inbox["data"]["notices"] == [] and inbox["data"]["held"] == "test mode"
          and inbox["data"]["unread"] == 0, inbox)
    check("L2: a switch the relay cannot read holds exactly the same — no frame, no push",
          L["l2_frames_to_ann"] == 0 and L["l2_hits"] == 0, (L["l2_frames_to_ann"], L["l2_hits"]))
    check("L2: its rows say the switch was unreadable, and held as on",
          L["l2_rows"] and all(r.startswith("unreadable|held: test mode (unreadable") for r in L["l2_rows"]),
          L["l2_rows"])
    check("L2: the bell says held, and why",
          L["l2_inbox"]["data"]["notices"] == [] and L["l2_inbox"]["data"]["held"].startswith("test mode (unreadable"),
          L["l2_inbox"])
    check("L2: the push owed to the reader with no live tab waits in the outbox; the live reader is owed none",
          L["l2_outbox"] == [["u-hal", "held_test"]], L["l2_outbox"])
    check("L0b: a real Hub session's `USR_…` id resolves to its roster name from the users copy — the "
          "intelligence platform's integer-keyed table is not asked; an inactive or unknown account is nobody",
          L["l0_roster"] == ["Ann Roe", "", "", ""], L["l0_roster"])
    check("L0b: and the real Requests reader carries that name — invitations, decisions and the ** row "
          "can find the person", L["l0_viewer"] == "Ann Roe", L["l0_viewer"])
    check("L0b: an account merged into this one is the same person, not a rival for the name",
          L["l0_merged_namesake"] == "Ann Roe", L["l0_merged_namesake"])
    check("L0b: another LIVE account with the same name makes it nobody's — fail closed on ambiguity",
          L["l0_ambiguous"] == ["", ""], L["l0_ambiguous"])
    check("L0b: a users copy that cannot be read RAISES when asked strictly, and the Requests reader "
          "answers 502 — never 'this account is not on a roster'",
          L["l0_strict"].startswith("raised") and L["l0_lenient"] == ""
          and isinstance(L["l0_viewer_down"], dict) and L["l0_viewer_down"].get("status") == 502,
          (L["l0_strict"], L["l0_viewer_down"]))
    check("L3: switched off — every push test mode held is LET GO, with the reason, and not one is sent",
          L["l3_release_hits"] == 0 and L["l3_release"]["sent"] == 0 and L["l3_release"]["expired"] >= 5
          and L["l3_let_go"] == [["expired", "held by test mode — the mock row is its only delivery"]],
          (L["l3_release"], L["l3_let_go"]))
    check("L3: and no bell shows what was stored while it was on — the mock row was its delivery",
          L["l3_inbox"]["data"]["held"] == "" and L["l3_inbox"]["data"]["notices"] == [], L["l3_inbox"]["data"])
    out3 = dict((u, s) for u, s in L["l3_outbox"])
    check("L3: a call-off made with the switch off is stored free and pushed at once",
          L["l3_new_kinds"] == ["call_off"] and L["l3_new_held"] is False and out3.get("u-hal") == "sent",
          (L["l3_new_kinds"], L["l3_outbox"]))
    check("L3: it reached the push service signed (VAPID), encrypted (aes128gcm), with a lifetime",
          L["l3_hit_shape"] is True and "high" in L["l3_urgent"], L["l3_urgent"])
    check("L3: a device the service calls gone (410) is forgotten, and its person has no device left",
          out3.get("u-cy") == "no_device" and "u-cy" not in L["l3_devices"], (out3, L["l3_devices"]))
    check("L3: a refusal (500) is a failure, not a push", out3.get("u-ada") == "failed", out3)
    check("L3: the person who called off is pushed nothing about it", "u-ann" not in out3, out3)
    check("L3: no caregiver's push names the caller, and no push carries the reason — the house's own "
          "manager (the HM a ** row wears) is told who called off, as the bell tells them",
          L["l3_words_cy"] and "Ann Roe" not in L["l3_words_cy"] and "sick" not in L["l3_words_cy"]
          and "Ann Roe" in L["l3_words_hal"] and "sick" not in L["l3_words_hal"],
          (L["l3_words_cy"], L["l3_words_hal"]))
    check("L3: every push sent is a mockup row too, naming who it reached",
          any("Hal Manager" in r for r in L["l3_sent_rows"]), L["l3_sent_rows"])
    check("L4: a refusal is tried again — three times in all, never a fourth",
          L["l4_d_hits"] == 3 and L["l4_ada"] == [["failed", 3]], (L["l4_d_hits"], L["l4_ada"]))
    check("L4: a push a stopped relay left mid-send is never sent again, and never called sent",
          len(L["l4_stuck"]) == 1 and L["l4_stuck"][0][0] == "failed" and L["l4_stuck"][0][1] == 3
          and "not known" in L["l4_stuck"][0][2] and L["l4_other_hits"] == [], (L["l4_stuck"], L["l4_other_hits"]))
    check("L5: a reader with a live tab gets the frame",
          "application|decider" in L["l5_hal_frames"], L["l5_hal_frames"])
    check("L5: and no push for what is not urgent while their tab is live",
          "/h" not in L["l5_new_hits"], L["l5_new_hits"])
    check("L5: with no live tab, the decision reaches the person's device",
          L["l5_decided_hits"].count("/a") == 1 and ["u-ann", "sent"] in L["l5_decided_outbox"],
          (L["l5_decided_hits"], L["l5_decided_outbox"]))
    check("L6: at night no push leaves", L["l6_night_hits"] == 0, L["l6_night_hits"])
    check("L6: it is held for the night, and the mockup says so",
          L["l6_night_states"] == ["held_quiet", "held_quiet"]
          and any("quiet window (21:31–07:59 New York)" in r for r in L["l6_quiet_rows"]),
          (L["l6_night_states"], L["l6_quiet_rows"]))
    check("L6: nothing moves while it is still night", L["l6_release_at_night"]["why"] == "the quiet window",
          L["l6_release_at_night"])
    check("L6: at 08:00 the one still true goes, the one read in the bell meanwhile does not",
          # /d refuses every push here, so a prior failure may retry beside it
          L["l6_morning_hits"].count("/a") == 1 and set(L["l6_morning_hits"]) <= {"/a", "/d"}
          and sorted(s for s, _ in L["l6_after"]) == ["expired", "sent"]
          and any(w == "read in the bell before the hold ended" for _, w in L["l6_after"]),
          (L["l6_morning_hits"], L["l6_after"], L["l6_morning"]))
    check("L9: a reader that could not be read during the morning release WAITS — held, not let go",
          L["l9_state"] and L["l9_state"][0][0] == "held_quiet" and L["l9_release"]["waiting"] >= 1
          and not any("no longer theirs" in w for _, w in L["l9_state"]), (L["l9_state"], L["l9_release"]))
    check("L9: and goes the next beat that can judge it", L["l9_state_after"] == ["sent"] and "/h" in L["l9_hits"],
          (L["l9_state_after"], L["l9_hits"]))
    check("L10: test mode going on halfway through a release stops the rest where they are",
          L["l10_states"] == ["held_quiet", "sent"]
          and L["l10_release"]["why"] == "test mode went on during the release", (L["l10_states"], L["l10_release"]))
    check("L11: a push whose audience could not be judged is written down as a failure to retry, not dropped",
          L["l11_outbox"] and L["l11_outbox"][0][0] == "failed" and L["l11_outbox"][0][1] == 0
          and "could not be judged" in L["l11_outbox"][0][2], L["l11_outbox"])
    check("L11: and named in the mockup as unjudged",
          any(r.startswith("unjudged|") and "Hal Manager" in r for r in L["l11_rows"]), L["l11_rows"])
    check("L11: the next beat judges it again and sends it", L["l11_after"] == ["sent"] and "/h" in L["l11_hits"],
          (L["l11_after"], L["l11_hits"]))
    check("L8: a door that refused is left alone for the pause, whatever build is named",
          L["l8_backoff"] == [0, 0], L["l8_backoff"])
    check("L7: a subscription that is not one is refused", L["l7_bad"] == 400, L["l7_bad"])
    check("L7: a device is kept for the SESSION's account, whatever id the body names",
          L["l7_ok"]["status"] == 200 and L["l7_owner"] == ["u-zed"], (L["l7_ok"], L["l7_owner"]))
    check("L7: the key door hands the public key", L["l7_key"] is True)
    check("L7: with no keys, no device is kept and the key door says there is none",
          L["l7_no_key"] == 409 and L["l7_key_door_no_key"]["key"] is None
          and "no VAPID keys" in L["l7_key_door_no_key"]["why"], (L["l7_no_key"], L["l7_key_door_no_key"]))
    check("L7: one account cannot let another's device go; its own can",
          L["l7_other"] == 0 and L["l7_own"] == 1, (L["l7_other"], L["l7_own"]))
    check("L7: no session, no door", L["l7_anon"] == [401, 401], L["l7_anon"])
    check("L8: the mockup went to Python's commMockWebIngest, Smart Comms' mock door",
          L["l8_posts"] == 1 and L["l8_action"] == "commMockWebIngest" and L["l8_credential"]
          and L["l8_housekeeping"] is True, (L["l8_posts"], L["l8_action"]))
    check("L8: a batch of at most fifty rows, each in the mock outbox's shape",
          0 < L["l8_rows"] <= 50 and L["l8_keys_ok"], L["l8_rows"])
    check("L8: only the two rows the door named as written left the disk",
          L["l8_waiting"][0] - L["l8_waiting"][1] == 2, L["l8_waiting"])
    check("L8: one batch at a time — the next waits its turn", L["l8_rate"] == 1, L["l8_rate"])
    check("L8: a door not yet published takes nothing", L["l8_unpublished"][0] == L["l8_unpublished"][1],
          L["l8_unpublished"])
    check("L8: the kept rows are private — 0700 folder, 0600 files",
          L["l8_private"][0] == "0o700" and set(L["l8_private"][1:]) == {"0o600"}, L["l8_private"])
    check("no stored push and no mockup row, anywhere in the run, carries the reason",
          L["reason_anywhere"] is False)
    check("the run's schema and folder are gone", L["cleaned"] is True)


print(f"\n{results['ok']} ok, {len(results['failed'])} failed")
for name in results["failed"]:
    print("  FAILED:", name)
sys.exit(1 if results["failed"] else 0)
