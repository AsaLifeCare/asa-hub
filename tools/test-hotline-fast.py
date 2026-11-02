#!/usr/bin/env python3
"""
The hotline webhook's FAST PATH, asserted against the real functions.

WHAT IT PROVES. A 5558 call announced by Quo's `call.transcript.completed` is
verified by the hotline key, screened, answered at once and filed behind the
answer; an event that key did not sign takes the old door untouched. The
pieces a quiet day never exercises are taken one by one:

  signature   good / bad / stale / missing / non-ASCII / malformed, a key no
              file on disk holds refused, the messages webhook's own kept
  parity      team, participants and the speaker transcript exactly as the
              legacy receiver writes them for the real test call
  screening   a dialogue without the 5558, or a deepLink into another
              number's inbox, is `not_this_line`; other event types and bad
              call ids are ignored
  dedupe      the same call twice files once; a call that gave up may retry
  filing      kept, asked and filed on Python under one write id per call;
              every answer drawn: not kept, switched off, blocked, no words,
              refused, deferred, unanswered once and twice, `already_filed`
              drawn as not known; the lanes rebuilt on every filing
  health      /health names no call and no time
  overlay     insert, the index winning and evicting, the overlay speaking
              over `waiting`, the version moving, the 2 h and 200 bounds, and
              only states a bundle from before the webhook already knows
  generation  a desk build that lands after an invalidate is never fresh
  clock       the inbox pass files what nobody filed and rings the screens;
              the calls door says whether the fast path is armed
  streams     a `hotline:` name reaches only a stream whose session passed
              the Smart Comms gate; a failed gate stays shut; a tag expires
              with its verdict or a refused session, and is asked again; a
              tag turning on rings once; a refusal that may pass is retried

WHERE IT RUNS. The relay's dependencies live in its container, so this ships
ITS OWN checkout's server/snapshot_service.py and server/hotline_desk.py into
`asa-hub-snapshot` over stdin and imports them IN MEMORY ahead of /srv/app.
Nothing is written anywhere, the app is never started, asa-hub-app and Quo
are never called (Python's door is stubbed), and every key is a random one
made here — never a real one.

    python3 tools/test-hotline-fast.py
"""
import base64
import json
import os
import subprocess
import sys

CONTAINER = os.getenv("HUB_RELAY_CONTAINER", "asa-hub-snapshot")
MODULES = ("snapshot_service", "hotline_desk", "psi_anywhere", "quo_inbox", "quo_pull",
           "mirror_first",
           # the IST settings reader; its declaration rides in HUB_IST_CONFIG_DECLARATION_JSON
           "ist_config",
           # the gates the relay's own doors ask before they reach the world
           # (apps-script/SmartGate.gs resolves them; configLane carries them)
           "lane_gate",
           # imported at the top of snapshot_service; the checkout's, since a
           # relay not yet restarted on this code has none of them in /srv/app
           "psi_attendance", "psi_entries", "psi_reminders", "punch_board_slices",
           # the shift flow's house names and the notes it reads (imported
           # lazily by the lane and /shift/of) — the checkout's as well
           "house_directory", "daily_notes",
           # the master JSON and its hand-off journal, imported at the top of
           # snapshot_service — the checkout's, since /srv/app has none yet —
           # the calls door, which journals through it, and the one redaction
           # rule the master and the sheet keeper both write through
           "master_json", "comm_calls_feed", "redaction",
           # the full punch sheet's record, imported at the top of
           # snapshot_service, the staff-hours feed it spells with, and the
           # clients present its live rows are filled with
           "psi_punches_full", "psi_punches_feed", "psi_consumers",
           # one badge answered wherever another is asked for — read by
           # snapshot_service's badge fold AND by the desk's App Access gate
           "badge_follows",
           # the shift-requests lane and the two files it extends: the open-shift
           # windows, the applications and the house manager's decision — the
           # checkout's, since /srv/app has none of this version yet
           "shift_requests", "house_cal_live", "shift_handoff",
           # the rehearsal of staff answers, imported at the top of snapshot_service
           "shift_rehearsal",
           # newer than /srv/app's copies
           "calendar_builder_houses", "calendar_builder_write",
           "effective_roster", "shift_slices",
           # the pair rule: a punch in AND a punch out per shift, the warning
           # that climbs to a director, and the reply ear that hears RECEIVED
           "punch_pairs",
           "sms_ears",
           "web_notices", "web_gate", "web_push",
           "time_off",
           # live chat's half, whose written-behind sends snapshot_service builds at import
           "chat_live")


def _run_in_container() -> int:
    here = os.path.abspath(__file__)
    server = os.path.join(os.path.dirname(os.path.dirname(here)), "server")
    sources = {}
    for name in MODULES:
        with open(os.path.join(server, name + ".py"), encoding="utf-8") as fh:
            sources[name] = fh.read()
    with open(here, encoding="utf-8") as fh:
        body = fh.read()
    blob = base64.b64encode(json.dumps(sources).encode()).decode()
    script = f"HOTLINE_FAST_SOURCES = {blob!r}\n" + body
    try:
        proc = subprocess.run(["docker", "exec", "-i", "-e", "HUB_IST_CONFIG_DECLARATION_JSON="
                               + open(os.path.join(server, "ist_config_defaults.json"),
                                      encoding="utf-8").read(), CONTAINER, "python3", "-"],
                              input=script, capture_output=True, text=True, timeout=300)
    except FileNotFoundError:
        print("docker is not available here — nothing to test against.")
        return 2
    sys.stdout.write(proc.stdout)
    sys.stderr.write(proc.stderr)
    return proc.returncode


# ── The real test call (5558 answered by the agent, 4040 calling) ────────────
TEST_CALL_ID = "AC" + "ca11ca11ca11ca11ca11ca11ca11ca11"  # a made-up id in the provider's shape
LINE_A = ("+13309195558", "SYUafgiigss")
LINE_C = ("+13307544040", "UShxNtmmO8")
# (start, end, speaker, content) — A is the 5558's agent, C the 4040 calling
TEST_TURNS = [
    (1.4399999, 1.92, 'A', 'Hello.'),
    (1.92, 4.16, 'A', "I'm Asa Life Care's virtual support agent."),
    (4.16, 5.62, 'A', 'Who am I speaking with today?'),
    (16.025, 16.824999, 'A', 'Hi, Jonathan.'),
    (16.824999, 18.125, 'A', 'And what is your last name?'),
    (20.635, 21.455, 'C', "Please don't."),
    (23.145, 26.044998, 'A', 'Jonathan, I just need your last name to complete your check-in.'),
    (26.185, 27.724998, 'A', 'What would you like help with today?'),
    (31.51, 32.309998, 'A', 'Got it, Jonathan.'),
    (32.309998, 32.79, 'A', 'Passion.'),
    (32.79, 34.01, 'A', 'How can I help you today?'),
    (35.559998, 35.96, 'C', 'Question.'),
    (35.96, 39.34, 'C', 'I need a a new credit card from the company.'),
    (41.35, 42.809998, 'A', 'I can help with that, Jonathan.'),
    (43.025, 48.085, 'A', 'What is the reason for requesting a new company card, like whether it was lost, stolen, or expired?'),
    (49.355003, 53.855003, 'C', 'I lost the credit card, and I needed to visit the client.'),
    (55.550003, 56.77, 'A', 'I understand, Jonathan.'),
    (56.91, 58.77, 'A', "What's the best number to reach you at?"),
    (60.8, 63.379997, 'C', "This one, actually, that I'm calling."),
    (65.22781, 68.92781, 'A', "I've logged your request for a replacement company card due to a lost card."),
    (69.14781, 71.48781, 'A', 'Someone from the team will follow-up with you shortly.'),
    (71.78781, 73.142815, 'A', 'We hope you have a great day.'),
]
# The legacy receiver's own functions (buildUserIdToPhoneMap,
# extractTeamMemberPhones, extractExternalParticipants with no Quo number,
# formatTranscript) run over that payload in node — the live inbox row for this
# call carries the same team, and no participants.
EXPECTED_TEAM = "+13309195558, +13307544040"
EXPECTED_PARTICIPANTS = ""
EXPECTED_SEPARATED = "\n".join([
    '[0:01] +13309195558: Hello.',
    "[0:02] +13309195558: I'm Asa Life Care's virtual support agent.",
    '[0:04] +13309195558: Who am I speaking with today?',
    '[0:16] +13309195558: Hi, Jonathan.',
    '[0:17] +13309195558: And what is your last name?',
    "[0:21] +13307544040: Please don't.",
    '[0:23] +13309195558: Jonathan, I just need your last name to complete your check-in.',
    '[0:26] +13309195558: What would you like help with today?',
    '[0:32] +13309195558: Got it, Jonathan.',
    '[0:32] +13309195558: Passion.',
    '[0:33] +13309195558: How can I help you today?',
    '[0:36] +13307544040: Question.',
    '[0:36] +13307544040: I need a a new credit card from the company.',
    '[0:41] +13309195558: I can help with that, Jonathan.',
    '[0:43] +13309195558: What is the reason for requesting a new company card, like whether it was lost, stolen, or expired?',
    '[0:49] +13307544040: I lost the credit card, and I needed to visit the client.',
    '[0:56] +13309195558: I understand, Jonathan.',
    "[0:57] +13309195558: What's the best number to reach you at?",
    "[1:01] +13307544040: This one, actually, that I'm calling.",
    "[1:05] +13309195558: I've logged your request for a replacement company card due to a lost card.",
    '[1:09] +13309195558: Someone from the team will follow-up with you shortly.',
    '[1:12] +13309195558: We hope you have a great day.',
])
EXPECTED_PLAIN = " ".join(t[3] for t in TEST_TURNS)
# JavaScript's corners, run through the same legacy functions in node: a half
# rounds up, 0.49999999999999994 rounds down, a falsy content is '', a
# numeric-string start is a number, a turn with only a userId borrows the phone
# that id spoke from, and a number seen without a userId first stays a caller.
EDGE_TURNS = [
    {"identifier": "+13307544040", "content": "caller no uid", "start": 2.5},
    {"identifier": "", "userId": "USx", "content": "uid only", "start": 65},
    {"identifier": "+13309195558", "userId": "USx", "content": "map", "start": 0.49999999999999994},
    {"userId": "USy", "content": 0, "start": 119.5},
    {"identifier": "+13307544040", "userId": None, "content": "again", "start": None},
    {"identifier": "+15555550100", "content": "second caller", "start": "61.44"},
    {"identifier": "+13307544040", "userId": "USz", "content": "now with uid", "start": 3599.5},
]
EDGE_EXPECTED = {
    "team": "+13309195558, USy, +13307544040",
    "participants": "+13307544040, +15555550100",
    "participants_line": "+15555550100",
    "separated": "[0:03] +13307544040: caller no uid\n[1:05] +13309195558: uid only\n"
                 "[0:00] +13309195558: map\n[2:00] USy: \n[0:00] +13307544040: again\n"
                 "[1:01] +15555550100: second caller\n[60:00] +13307544040: now with uid",
    "plain": "caller no uid uid only map  again second caller now with uid",
}


def test_dialogue(turns=None):
    who = {"A": LINE_A, "C": LINE_C}
    return [{"end": end, "start": start, "userId": who[s][1], "content": text, "identifier": who[s][0]}
            for start, end, s, text in (turns or TEST_TURNS)]


def transcript_event(call_id=TEST_CALL_ID, dialogue=None, kind="call.transcript.completed", deep_link=None):
    event = {"id": "EVtest0000000000000000000000000000", "object": "event", "type": kind,
             "createdAt": "2026-09-17T15:50:31.718Z", "apiVersion": "v4",
             "data": {"object": {"callId": call_id, "object": "callTranscript", "status": "completed",
                                 "dialogue": test_dialogue() if dialogue is None else dialogue,
                                 "duration": 73.142815, "createdAt": "2026-09-17T15:50:31.109Z",
                                 "contactIds": []}}}
    if deep_link is not None:
        event["data"]["deepLink"] = deep_link
    return event


def main_inside() -> int:  # noqa: C901 - one flat list of assertions reads best
    import asyncio
    import hashlib
    import hmac
    import importlib.abc
    import importlib.util
    import logging
    import secrets
    import time
    import types

    sources = json.loads(base64.b64decode(HOTLINE_FAST_SOURCES))  # noqa: F821 - set by the host half

    class Checkout(importlib.abc.MetaPathFinder, importlib.abc.Loader):
        def find_spec(self, name, path, target=None):
            if name in sources:
                return importlib.util.spec_from_loader(name, self, origin="checkout:" + name)
            return None

        def create_module(self, spec):
            return None

        def exec_module(self, module):
            module.__file__ = "/srv/app/" + module.__name__ + ".py"
            exec(compile(sources[module.__name__], "checkout/" + module.__name__ + ".py", "exec"),
                 module.__dict__)

    # Never the seal mount, never a real env key.
    os.environ["QUO_HOTLINE_WEBHOOK_KEY_FILE"] = "/nonexistent/hotline-fast-test.key"
    # AND NO PSIANYWHERE PROBE FROM HERE. The fast path asks psi_anywhere
    # whether a call is about it; switched off, it asks nothing and reaches
    # nothing, so every filing below is the one this file has always asserted.
    # Its own suite is tools/test-psi-anywhere.py.
    os.environ["HUB_PSI_PROBE"] = "0"
    os.environ["HUB_PSI_SECRET_FILE"] = "/nonexistent/hotline-fast-test.json"
    os.environ["HUB_PSI_TY_SECRET_FILE"] = "/nonexistent/hotline-fast-test-ty.json"
    os.environ["HUB_PSI_FULL_DIR"] = "/tmp/hotline-fast-test-psi-full"
    os.environ.pop("QUO_HOTLINE_WEBHOOK_KEY", None)
    # NOR THE TEXT INBOX'S KEYS OR DISK: with no messages key every event here
    # passes the inbox's branch untouched, and nothing can land in the live
    # relay's inbox. Its own suite is tools/test-quo-inbox.py.
    os.environ["HUB_QUO_MESSAGES_KEY_FILE"] = "/nonexistent/hotline-fast-test-messages.key"
    os.environ["HUB_QUO_API_KEY_FILE"] = "/nonexistent/hotline-fast-test-api.key"
    os.environ["HUB_QUO_INBOX_DIR"] = "/nonexistent/hotline-fast-test-inbox"
    sys.meta_path.insert(0, Checkout())
    sys.path.insert(0, "/srv/app")
    import snapshot_service as service  # noqa: E402
    desk = service.hotline_desk
    # NOR ASA-HUB-APP. The relay keeps and files a hotline call on Python (hotlineCallKeep, hotlineFile, the shadow)
    # through _backend_call with this container's own address and token: asked from here, a made-up call lands in the
    # live app.hotline_calls and is filed into the live books. Every call to Python is refused here, unanswered.
    python_asked = []

    async def no_python(app_id, action, *_a, **_k):
        python_asked.append((app_id, action))
        return None
    service._backend_call = no_python
    service.HUB_APP_URL = "http://python.invalid"
    service.HUB_APP_TOKEN = ""

    results = {"ok": 0, "failed": []}

    def check(name, cond, detail=""):
        if cond:
            results["ok"] += 1
            print(f"ok   {name}")
        else:
            results["failed"].append(name)
            print(f"FAIL {name}{(' — ' + str(detail)[:300]) if detail else ''}")

    check("the checkout's modules are the ones imported",
          getattr(service.__spec__, "origin", "") == "checkout:snapshot_service"
          and desk is not None and getattr(desk.__spec__, "origin", "") == "checkout:hotline_desk")
    routes = {r.path for r in service.app.routes}
    check("/quo/webhook is routed", "/quo/webhook" in routes)

    # ── THE BADGE FOLD, ON THE RELAY'S OWN TWO CALL SITES ────────────────
    #
    # The equivalence that makes one badge currently reach what another
    # reaches is written three times, once per runtime, because none of the
    # three can call the others. tools/check-badges.mjs holds the three tables
    # in step and pins these two call sites as source text; what it cannot do
    # is run them. This does. Without it the relay's half of the feature was
    # the only half with no test at all: delete both calls and the SPA tests,
    # the Apps Script self-test and every lane test stayed green while a
    # supervisor lost, on this lane alone, everything the matrix grants a
    # director. A team lead stands in for nobody (the operator's rule,
    # 2026-10-29), and that is asserted here too.
    badges = service.badge_follows
    check("badges: the relay's fold answers the followed badge as both words",
          badges.with_followed({"SUPERVISOR"}) == {"SUPERVISOR", "DIRECTOR"},
          badges.with_followed({"SUPERVISOR"}))
    check("badges: ... and it goes ONE way — a director is never a supervisor",
          badges.with_followed({"DIRECTOR"}) == {"DIRECTOR"})
    check("badges: ... and never returns less than it was given",
          badges.with_followed({"HM", "STAFF"}) == {"HM", "STAFF"}
          and badges.with_followed(set()) == set()
          and badges.with_followed({"supervisor"}) == {"SUPERVISOR", "DIRECTOR"})
    check("badges: a team lead is folded into nothing",
          badges.with_followed({"TEAMLEAD"}) == {"TEAMLEAD"}
          and service._badges_of("staff", "TEAMLEAD") == {"TEAMLEAD", "STAFF"},
          badges.with_followed({"TEAMLEAD"}))
    check("badges: the snapshot lane folds a real account's row",
          service._badges_of("staff", "SUPERVISOR") == {"SUPERVISOR", "STAFF", "DIRECTOR"}
          and "SUPERVISOR" not in service._badges_of("staff", "DIRECTOR"),
          service._badges_of("staff", "SUPERVISOR"))
    # the platform lead, under the master and over the director: a director on this lane too, one way
    check("badges: the relay answers PLATFORMLEAD as a director, and never a director as PLATFORMLEAD",
          badges.with_followed({"PLATFORMLEAD"}) == {"PLATFORMLEAD", "DIRECTOR"}
          and "PLATFORMLEAD" not in badges.with_followed({"DIRECTOR"})
          and service._badges_of("staff", "PLATFORMLEAD") == {"PLATFORMLEAD", "STAFF", "DIRECTOR"},
          badges.with_followed({"PLATFORMLEAD"}))
    import shift_requests as _sr_pl
    check("badges: a platform lead decides in every house without being named in the deciders' sentence",
          bool(_sr_pl.badges_of("staff", "PLATFORMLEAD") & _sr_pl.REASON_BADGES)
          and "platform" not in _sr_pl.deciders_one() and "platform" not in _sr_pl.deciders_all(),
          (_sr_pl.deciders_one(), _sr_pl.deciders_all()))

    # and the App Access gate itself, over a mirror this test NAMES — the
    # rows a live relay compares against are the master's own spreadsheet, and
    # a verdict a keystroke in a spreadsheet can fail is not a verdict
    _gate_types = ["SUPERVISOR"]

    def _core_named(_dsn, _sheet, _uid, _app):
        return {"source": "mirror", "sync_ok": True, "age_s": 0.0,
                "rule": ["DIRECTOR"], "tenants": [],
                "user": {"role": "staff", "types": _gate_types[0], "active": "true",
                         "app_denials": "", "home_tenant": ""}}

    _core_real, _pg_real = desk._core_from_mirror, desk.psycopg2
    desk._core_from_mirror = _core_named
    desk.psycopg2 = desk.psycopg2 or object()   # the stub never reaches a driver
    try:
        got = desk.app_access("named-dsn", "named-book", "u-1", "staff", "leadership")
        check("badges: App Access opens a row written DIRECTOR for a supervisor",
              got["open"] is True and got["why"] == "badge", got)
        _gate_types[0] = "TEAMLEAD"
        got = desk.app_access("named-dsn", "named-book", "u-1", "staff", "leadership")
        check("badges: ... and refuses it to a team lead, who stands in for nobody",
              got["open"] is False and got["reason"] == "badge", got)
        _gate_types[0] = "DIRECTOR"
        got = desk.app_access("named-dsn", "named-book", "u-1", "staff", "leadership")
        check("badges: ... as it always did for a director", got["open"] is True, got)
        _gate_types[0] = "HM"
        got = desk.app_access("named-dsn", "named-book", "u-1", "staff", "leadership")
        check("badges: ... and still refuses a house manager",
              got["open"] is False and got["reason"] == "badge", got)
        _gate_types[0] = "PLATFORMLEAD"
        got = desk.app_access("named-dsn", "named-book", "u-1", "staff", "leadership")
        check("badges: App Access opens a row written DIRECTOR for a platform lead",
              got["open"] is True and got["why"] == "badge", got)

        # App Control just changed a grant: a copy read before that change cannot vouch for it
        _gate_types[0] = "DIRECTOR"
        _named_age = [0.0]
        desk._core_from_mirror = lambda d, s, u, a: {**_core_named(d, s, u, a), "age_s": _named_age[0]}
        _live_real = desk._core_live
        desk._core_live = lambda sheets, sheet_id, fresh_s: (None, "the live read is stood in for")
        try:
            desk.note_access_written()
            _named_age[0] = 30.0
            got = desk.app_access("named-dsn", "named-book", "u-1", "staff", "leadership")
            check("access: after an App Control write, a copy read before it no longer vouches",
                  got["open"] is False and got["reason"] in ("stale", "unreadable"), got)
            _named_age[0] = 0.0
            got = desk.app_access("named-dsn", "named-book", "u-1", "staff", "leadership")
            check("access: ... and a copy read after it vouches again", got["open"] is True, got)
        finally:
            desk._core_live = _live_real

        # Settings > My Work's app list: an app on it answers as one with no row, for everybody but the master
        _gate_types[0] = "DIRECTOR"
        _cut_held = list(desk._APP_CUT)
        try:
            desk.use_app_cut(lambda: ["leadership"])
            got = desk.app_access("named-dsn", "named-book", "u-1", "staff", "leadership")
            check("app list: a listed app is shut for a badge its row names, with the unreleased app's sentence",
                  got["open"] is False and got["reason"] == "badge"
                  and "No badge is written for" in got["why"] and "master's alone" in got["why"], got)
            got = desk.app_access("named-dsn", "named-book", "u-1", "admin", "leadership", is_master=None)
            check("app list: ... the admin floor does not open it", got["open"] is False, got)
            got = desk.app_access("named-dsn", "named-book", "u-1", "admin", "leadership", is_master=True)
            check("app list: ... the master's own session opens it", got["open"] is True, got)
            got = desk.app_access("named-dsn", "named-book", "u-1", "staff", "other-app")
            check("app list: ... and an app not on it is untouched", got["open"] is True, got)

            def _broken():
                raise RuntimeError("the lane could not be read")
            desk.use_app_cut(_broken)
            got = desk.app_access("named-dsn", "named-book", "u-1", "staff", "leadership")
            check("app list: a list that cannot be read cuts nothing (fail open)", got["open"] is True, got)
        finally:
            desk._APP_CUT[:] = _cut_held
    finally:
        desk._core_from_mirror, desk.psycopg2 = _core_real, _pg_real

    # the same list on the relay's own copies: the bundle's matrices and shelf, cut per viewer
    _lane_held = dict(service._CONFIG_LANE)
    try:
        service._CONFIG_LANE["data"] = {"place": "", "my_work_apps": ["st-quiet", " "]}
        check("app list: the relay reads the lane's list, blanks dropped",
              service._lane_app_cut() == frozenset({"st-quiet"}), service._lane_app_cut())
        service._CONFIG_LANE["data"] = {"place": "", "my_work_apps": "st-quiet"}
        check("app list: ... a lane whose list is not a list cuts nothing", service._lane_app_cut() == frozenset())
        service._CONFIG_LANE["data"] = None
        check("app list: ... and no lane cuts nothing", service._lane_app_cut() == frozenset())
    finally:
        service._CONFIG_LANE.clear()
        service._CONFIG_LANE.update(_lane_held)
    _held_map = {"st-quiet": ["STAFF"], "st-open": ["STAFF"]}
    _cut_map = service._app_cut_map(_held_map, frozenset({"st-quiet"}))
    check("app list: the matrix copy loses the listed app and the held map is untouched",
          _cut_map == {"st-open": ["STAFF"]} and "st-quiet" in _held_map, _cut_map)
    _shelf = {"sections": [{"id": "sec-a"}], "placement": {"st-quiet": "sec-a", "st-open": "sec-a"},
              "order": {"sec-a": ["st-quiet", "st-open"]}}
    _cut_shelf = service._app_cut_shelf(_shelf, frozenset({"st-quiet"}))
    check("app list: the shelf copy loses the listed app's placement and order, the held shelf is untouched",
          _cut_shelf["placement"] == {"st-open": "sec-a"} and _cut_shelf["order"] == {"sec-a": ["st-open"]}
          and _cut_shelf["sections"] == _shelf["sections"] and _shelf["placement"].get("st-quiet") == "sec-a",
          _cut_shelf)

    async def _bundle_as(token, master):
        service._auth_cache[token] = (time.time(), True, "staff", "u-" + token)
        service._auth_master.pop(token, None)
        if master is not None:
            service._auth_master[token] = master
        try:
            res = await service.bundle(authorization="Bearer " + token)
            return json.loads(res.body)
        finally:
            service._auth_cache.pop(token, None)
            service._auth_master.pop(token, None)

    _bundle_held = (service._bundle_access, service.load_manifest, service._config_kv, service._ist_config_block)
    _lane_held = dict(service._CONFIG_LANE)
    try:
        service._bundle_access = lambda tab, key, value, upper=False: (
            {"st-quiet": ["STAFF"], "st-open": ["STAFF"]} if tab != "config_badge_access" else {"access": ["ADMIN"]})
        service.load_manifest = lambda: []
        service._config_kv = lambda tab: {}
        service._ist_config_block = lambda role: None
        service._CONFIG_LANE["data"] = {"place": "", "my_work_apps": ["st-quiet"], "shelf": _shelf}
        b_staff = asyncio.run(_bundle_as("tok-b-staff", False))
        b_unseen = asyncio.run(_bundle_as("tok-b-unseen", None))
        b_master = asyncio.run(_bundle_as("tok-b-master", True))
        check("app list: a known non-master's bundle carries no badge, tenant or shelf entry for the listed app",
              set(b_staff["access"]["badges"]) == {"st-open"} and set(b_staff["access"]["tenants"]) == {"st-open"}
              and "st-quiet" not in json.dumps(b_staff), b_staff.get("access"))
        check("app list: ... a session whose flag was not seen yet is handed no badge or tenant matrix at all (its live "
              "reads decide, never a cut copy), its shelf kept whole",
              "badges" not in (b_unseen.get("access") or {}) and "tenants" not in (b_unseen.get("access") or {})
              and b_unseen["config"]["shelf"]["placement"].get("st-quiet") == "sec-a", b_unseen.get("access"))
        check("app list: ... and the master's bundle carries the whole matrix and shelf",
              set(b_master["access"]["badges"]) == {"st-quiet", "st-open"}
              and b_master["config"]["shelf"]["placement"].get("st-quiet") == "sec-a", b_master.get("access"))
    finally:
        (service._bundle_access, service.load_manifest, service._config_kv,
         service._ist_config_block) = _bundle_held
        service._CONFIG_LANE.clear()
        service._CONFIG_LANE.update(_lane_held)

    # Settings > My Work's world switch on the relay's own copy: a world's file reaches the master and the seen list
    # alone, refused before the mirror is even asked
    _lane_held = dict(service._CONFIG_LANE)
    _reach_held = service._place_reach
    _reach_asked = []

    def _reach(uid):
        _reach_asked.append(uid)
        return {"worlds": set(), "tenants": set(), "members": set(), "roles": {}}

    async def _place_as(token, uid, master, world):
        service._auth_cache[token] = (time.time(), True, "staff", uid)
        service._auth_master.pop(token, None)
        if master is not None:
            service._auth_master[token] = master
        try:
            res = await service.place_bundle(world=world, tenant="", member="", tab="",
                                             authorization="Bearer " + token)
            return res.status_code
        finally:
            service._auth_cache.pop(token, None)
            service._auth_master.pop(token, None)

    try:
        service._place_reach = _reach
        service._CONFIG_LANE["data"] = {"place": "", "my_world_hide": True, "my_world_seen": ["u-ann", " "]}
        check("my world: the relay reads the switch and the seen list, blanks dropped",
              service._lane_world_hide() is True and service._lane_world_seen() == frozenset({"u-ann"}),
              service._lane_world_seen())
        check("my world: ... kept from a known non-master and a session whose flag was not seen yet; never from the "
              "master's own session or a seen account",
              service._world_withheld("u-bob", False) is True and service._world_withheld("u-bob", None) is True
              and service._world_withheld("u-bob", True) is False and service._world_withheld("u-ann", False) is False)
        _reach_asked.clear()
        got = [asyncio.run(_place_as("tok-w-bob", "u-bob", False, "wld_bob")),
               asyncio.run(_place_as("tok-w-new", "u-new", None, "wld_new"))]
        check("my world: ... /place refuses their world as a place with no bundle, before the mirror is asked",
              got == [404, 404] and _reach_asked == [], (got, _reach_asked))
        _reach_asked.clear()
        asyncio.run(_place_as("tok-w-boss", "u-boss", True, "wld_boss"))
        asyncio.run(_place_as("tok-w-ann", "u-ann", False, "wld_ann"))
        check("my world: ... while the master's own session and a seen account go on to the mirror's proof",
              _reach_asked == ["u-boss", "u-ann"], _reach_asked)
        service._CONFIG_LANE["data"] = {"place": "", "my_world_hide": "yes", "my_world_seen": "u-ann"}
        check("my world: a switch that is not plainly true is off, and a list that is not a list lets nobody in",
              service._lane_world_hide() is False and service._lane_world_seen() == frozenset()
              and service._world_withheld("u-bob", False) is False)
        service._CONFIG_LANE["data"] = None
        _reach_asked.clear()
        asyncio.run(_place_as("tok-w-bob", "u-bob", False, "wld_bob"))
        check("my world: ... and no lane keeps nobody's world (fail open): the mirror decides as it shipped",
              service._lane_world_hide() is False and _reach_asked == ["u-bob"], _reach_asked)
    finally:
        service._place_reach = _reach_held
        service._CONFIG_LANE.clear()
        service._CONFIG_LANE.update(_lane_held)

    # ── what the log says, so a key can be proved absent from it ─────────
    said = []

    class Keep(logging.Handler):
        def emit(self, record):
            said.append(record.getMessage())

    for name in ("hub.snapshot", "hub.hotline"):
        lg = logging.getLogger(name)
        lg.addHandler(Keep())
        lg.setLevel(logging.INFO)
        lg.propagate = False

    service.SERVICE_SECRET = "test-service-secret"
    shipped_gate_retry = service.HOTLINE_STREAM_GATE_RETRY_S
    service.HOTLINE_STREAM_GATE_RETRY_S = 0.05

    hot_key = base64.b64encode(secrets.token_bytes(32)).decode()
    old_key = base64.b64encode(secrets.token_bytes(32)).decode()
    wrong_key = base64.b64encode(secrets.token_bytes(32)).decode()

    class KeyFile:
        """A key file that lives in memory: stat and read_text, nothing else."""
        def __init__(self):
            self.text, self.mtime = None, 1

        def stat(self):
            if self.text is None:
                raise FileNotFoundError("absent")
            return types.SimpleNamespace(st_mtime_ns=self.mtime, st_size=len(self.text))

        def read_text(self, encoding="utf-8"):
            if self.text is None:
                raise FileNotFoundError("absent")
            return self.text

    key_file = KeyFile()
    service.QUO_HOTLINE_KEY_FILE = key_file

    # ── Python's doors, stubbed: every call recorded, the filing's answers scripted ────
    python_calls = []
    # hotlineFile's answers to a filing, in order: an envelope, an Exception (unanswered) or "defer"
    answers = []
    model_says = []
    door_shipped = {"keep": 200, "ask": {"enabled": True, "ask": "the orders"},
                    "settle": {"no_words": {"state": "nothing_to_file"}, "blocked": {"state": "blocked", "tries": 3}},
                    "due": None}
    door = dict(door_shipped)
    words = '{"items": [{"kind": "Request"}, {"kind": "DailyNote"}]}'

    def answered(env):
        return json.dumps(env).encode(), time.time(), env, None, 0.0

    async def fake_python(app_id, action, payload, user, extra=None, timeout=None):
        python_calls.append({"app": app_id, "action": action, "payload": payload, "user": user,
                             "extra": extra or {}, "t": time.time()})
        if action == "hotlineCallKeep":
            return answered({"status": door["keep"], "data": {"kept": door["keep"] == 200}})
        if action == "hotlineShadowAsk":
            return answered({"status": 200, "data": door["ask"]})
        if action == "hotlineInboxDue":
            return None if door["due"] is None else answered({"status": 200, "data": {"calls": door["due"]}})
        if action == "hotlineFile" and "settle" in payload:
            return answered({"status": 200, "data": door["settle"][payload["settle"]]})
        if action == "hotlineFile":
            if not answers:
                raise AssertionError("a filing nobody scripted")
            got = answers.pop(0)
            if isinstance(got, Exception):
                raise got
            if got == "defer":
                service._BACKEND_UNANSWERED.set("it deferred 503: busy")
                return None
            return answered(got)
        return None

    async def fake_model(text):
        return model_says.pop(0) if model_says else (words, "groq")

    mirrored = []
    service._backend_call = fake_python
    service._hotline_model = fake_model
    service._lane_mirror_after_filing_kick = lambda: mirrored.append(time.time())

    def actions():
        return [c["action"] + ("/" + c["payload"]["settle"] if "settle" in (c["payload"] or {}) else "")
                for c in python_calls]

    def write_id(kind, call_id):
        return "W" + hashlib.sha256(f"{kind}|{call_id}".encode()).hexdigest()[:24]

    def sign(raw, key, stamp_ms):
        mac = hmac.new(base64.b64decode(key), str(stamp_ms).encode() + b"." + raw, hashlib.sha256).digest()
        return f"hmac;1;{stamp_ms};{base64.b64encode(mac).decode()}"

    def request(raw, header):
        from starlette.requests import Request
        sent = {"done": False}

        async def receive():
            if sent["done"]:
                return {"type": "http.disconnect"}
            sent["done"] = True
            return {"type": "http.request", "body": raw, "more_body": False}

        # bytes go as sent: a header past ASCII reaches the app as latin-1 text
        raw_header = header if isinstance(header, bytes) else (header or "").encode()
        headers = [(b"openphone-signature", raw_header)] if header else []
        return Request({"type": "http", "method": "POST", "path": "/quo/webhook",
                        "headers": headers, "query_string": b""}, receive)

    async def post(event, key=None, *, age_s=0.0, raw=None, header=None):
        body = raw if raw is not None else json.dumps(event, separators=(",", ":")).encode()
        if header is None and key is not None:
            header = sign(body, key, int((time.time() - age_s) * 1000))
        t0 = time.perf_counter()
        resp = await service.quo_webhook(request(body, header or ""))
        ms = (time.perf_counter() - t0) * 1000
        try:
            data = json.loads(resp.body)
        except ValueError:
            data = {}
        return resp.status_code, data, ms

    async def settle_tasks():
        for _ in range(50):
            await asyncio.sleep(0)
            pending = [t for t in list(service._BG_TASKS) if not t.done()]
            if not pending:
                await asyncio.sleep(0)
                return
            await asyncio.gather(*pending, return_exceptions=True)

    def reset_fast():
        service._HOTLINE_FAST.clear()
        desk._OVERLAY.clear()
        python_calls.clear()
        answers.clear()
        model_says.clear()
        mirrored.clear()
        door.clear()
        door.update(door_shipped)

    processed = {"status": 200, "data": {"state": "filed", "items": 2, "kinds": ["Request", "DailyNote"]}}

    async def run():
        loop = asyncio.get_running_loop()
        service._event_loop = loop

        # ── parity with the legacy receiver ───────────────────────────────
        dialogue = test_dialogue()
        check("parity: team", desk.team_phones(dialogue) == EXPECTED_TEAM, desk.team_phones(dialogue))
        check("parity: participants", desk.caller_phones(dialogue) == EXPECTED_PARTICIPANTS,
              desk.caller_phones(dialogue))
        check("parity: speaker transcript", desk.dialogue_text(dialogue) == EXPECTED_SEPARATED,
              desk.dialogue_text(dialogue))
        check("parity: full transcript", desk._format_dialogue(dialogue)[0] == EXPECTED_PLAIN)
        check("parity corners: team", desk.team_phones(EDGE_TURNS) == EDGE_EXPECTED["team"],
              desk.team_phones(EDGE_TURNS))
        check("parity corners: participants",
              desk.caller_phones(EDGE_TURNS) == EDGE_EXPECTED["participants"],
              desk.caller_phones(EDGE_TURNS))
        check("parity corners: participants without the line",
              desk.caller_phones(EDGE_TURNS, "+13307544040") == EDGE_EXPECTED["participants_line"])
        check("parity corners: speaker transcript",
              desk.dialogue_text(EDGE_TURNS) == EDGE_EXPECTED["separated"], desk.dialogue_text(EDGE_TURNS))
        check("parity corners: full transcript",
              desk._format_dialogue(EDGE_TURNS)[0] == EDGE_EXPECTED["plain"])
        screening_only = [{"identifier": "+13307544040", "userId": "UShxNtmmO8", "content": "hi", "start": 1},
                          {"identifier": "+15555550100", "content": "hello", "start": 2}]
        check("line: the test call is the hotline's", desk.is_hotline(dialogue))
        check("line: a 4040-only dialogue is not", not desk.is_hotline(screening_only))

        # ── the key reader ────────────────────────────────────────────────
        check("key: nothing armed with no file and no env", service._quo_hotline_keys() == [])
        os.environ["QUO_HOTLINE_WEBHOOK_KEY"] = wrong_key
        check("key: the env arms it", service._quo_hotline_keys() == [wrong_key]
              and service._quo_hotline_key_state["from"] == "env")
        key_file.text = hot_key + "\n"
        check("key: the file wins over the env", service._quo_hotline_keys() == [hot_key]
              and service._quo_hotline_key_state["from"] == "file")
        key_file.text, key_file.mtime = "not a key\n", 2
        check("key: a changed file is read again (garbage arms nothing)", service._quo_hotline_keys() == [])
        key_file.text, key_file.mtime = hot_key + "\n", 3
        check("key: and a good one arms it again", service._quo_hotline_keys() == [hot_key])
        os.environ.pop("QUO_HOTLINE_WEBHOOK_KEY", None)
        check("key: the log names a fingerprint",
              any(service._key_fingerprint(hot_key) in s for s in said))
        check("key: the log never carries a key",
              not any(k in s for s in said for k in (hot_key, wrong_key, old_key)))

        # ── the door: a good event ────────────────────────────────────────
        tagged, untagged, plain_q = asyncio.Queue(), asyncio.Queue(), asyncio.Queue()
        tagged.hotline, untagged.hotline = True, False
        tagged.hotline_until = time.time() + 3600
        for q in (tagged, untagged, plain_q):
            service._event_subs.add(q)
        reset_fast()
        answers.append(processed)
        gen0 = desk._DESK["gen"]
        status, data, ms = await post(transcript_event(), hot_key)
        check("accept: 200 with the call id", status == 200 and data.get("accepted") == TEST_CALL_ID,
              (status, data))
        check(f"accept: answered in {ms:.1f} ms (under 250)", ms < 250)
        entry = desk._OVERLAY.get(TEST_CALL_ID)
        check("accept: the overlay holds it as filing", bool(entry) and entry["stage"] == "filing")
        check("accept: the overlay's parties are the legacy's",
              bool(entry) and entry["team"] == EXPECTED_TEAM and entry["caller_phones"] == ""
              and entry["turns_text"] == EXPECTED_SEPARATED and entry["n_turns"] == 22
              and entry["duration"] == 73 and entry["at"] == "2026-09-17T15:50:32Z", entry)
        await asyncio.sleep(0)
        await asyncio.sleep(0)
        check("stream: a hotline stream heard hotline:calls",
              not tagged.empty() and tagged.get_nowait() == "hotline:calls")
        check("stream: an untagged stream did not", untagged.empty() and plain_q.empty())
        await settle_tasks()
        await asyncio.sleep(0)
        check("file: kept, its orders asked and filed on Python, once each and in that order",
              actions() == ["hotlineCallKeep", "hotlineShadowAsk", "hotlineFile"], actions())
        keep = python_calls[0] if python_calls else {"payload": {}, "extra": {}}
        call = keep["payload"] or {}
        check("file: the kept call's fields",
              set(call) == {"call_id", "event_at", "created", "duration", "dialogue", "caller_phones", "team"}
              and call["call_id"] == TEST_CALL_ID and call["event_at"] == "2026-09-17T15:50:31.718Z"
              and call["created"] == "2026-09-17T15:50:31.109Z" and call["duration"] == 73.142815
              and len(call["dialogue"]) == 22 and call["team"] == EXPECTED_TEAM
              and call["caller_phones"] == EXPECTED_PARTICIPANTS
              and all(set(t) == {"identifier", "userId", "content", "start"} for t in call["dialogue"]),
              {k: v for k, v in call.items() if k != "dialogue"})
        files = [c for c in python_calls if c["action"] == "hotlineFile"]
        check("file: every door asked as the service of the hotline app, keep and file under one write id per call",
              all(c["app"] == "hotline" and c["user"] == {"is_service": True} for c in python_calls)
              and keep["extra"].get("write_id") == write_id("hotline", TEST_CALL_ID)
              and bool(files) and files[0]["extra"].get("write_id") == write_id("hotline-file", TEST_CALL_ID),
              [c["extra"] for c in python_calls])
        check("file: the model's words are what is filed, with how they came",
              bool(files) and files[0]["payload"] == {"call_id": TEST_CALL_ID, "content": words, "via": "groq",
                                                      "psi": None}, files[:1])
        entry = desk._OVERLAY.get(TEST_CALL_ID)
        check("file: the overlay says filed, with what landed",
              bool(entry) and entry["stage"] == "filed" and entry["kinds"] == ["Request", "DailyNote"]
              and entry["items"] == 2, entry)
        check("file: the relay remembers it filed", service._HOTLINE_FAST[TEST_CALL_ID]["stage"] == "filed")
        check("file: one log line with the call, what it filed and how",
              any(s == f"hotline file: {TEST_CALL_ID} filed by Python (Request,DailyNote, groq)" for s in said),
              [s for s in said if TEST_CALL_ID in s])
        check("file: the desk was invalidated", desk._DESK["gen"] == gen0 + 1)
        check("file: the lane houses are copied after a filing with items", len(mirrored) == 1)
        known = {e["resource"] for e in service.load_manifest()}
        want = {r for r in service.HOTLINE_FAST_SLICES if r in known}
        check(f"file: the lanes are rebuilt ({', '.join(sorted(want)) or 'none in this manifest'})",
              want <= service._dirty)
        check("file: the screens were nudged again",
              not tagged.empty() and tagged.get_nowait() == "hotline:calls")
        health = service._hotline_fast_health()
        check("health: armed, and nothing that moves with a call", health == {"armed": True}, health)
        told = json.dumps(health)
        check("health: /health names no call, no time and no per-event count",
              TEST_CALL_ID not in told and not any(k in told for k in (
                  '"call_id"', '"at"', '"ms"', "event_age", "timing", "counts", "key_from")), told)

        # ── dedupe ────────────────────────────────────────────────────────
        python_calls.clear()
        status, data, _ = await post(transcript_event(), hot_key)
        await settle_tasks()
        check("dedupe: the same call again is a duplicate",
              status == 200 and data.get("duplicate") == TEST_CALL_ID and not python_calls, (status, data))

        # ── signatures ────────────────────────────────────────────────────
        reset_fast()
        status, data, _ = await post(transcript_event(), wrong_key)
        check("signature: a bad one takes the old door and is refused",
              status == 401 and data.get("message") == "Unverified." and not python_calls, (status, data))
        status, data, _ = await post(transcript_event(), None, header="")
        check("signature: a missing one takes the old door and is refused",
              status == 401 and not python_calls, (status, data))
        kept_by_inbox = []
        real_messages_event = service._quo_messages_event

        async def fake_messages_event(raw, header):
            kept_by_inbox.append(raw)
            return service._quo_answer(200, kept="added")

        service._quo_messages_event = fake_messages_event
        held_keys = service.quo_inbox.webhook_keys
        try:
            status, data, _ = await post(transcript_event(), old_key)
            check("signature: a key no file on disk holds is refused here, nothing kept, nobody asked for keys",
                  status == 401 and data.get("message") == "Unverified." and not kept_by_inbox and not python_calls,
                  (status, data))
            service.quo_inbox.webhook_keys = lambda: [old_key]
            status, data, _ = await post(transcript_event(), old_key)
        finally:
            service.quo_inbox.webhook_keys = held_keys
            service._quo_messages_event = real_messages_event
        check("signature: the messages webhook's own key (its file on disk) is kept in the inbox, never filed while Quo "
              "waits", status == 200 and len(kept_by_inbox) == 1 and not python_calls and not desk._OVERLAY,
              (status, data))
        python_calls.clear()
        status, data, _ = await post(transcript_event(), hot_key, age_s=301)
        check("signature: stamped 301 s ago is stale",
              status == 401 and data.get("reason") == "stale" and not desk._OVERLAY, (status, data))
        status, data, _ = await post(transcript_event(), hot_key, age_s=-301)
        check("signature: stamped 301 s ahead is stale", status == 401 and data.get("reason") == "stale")
        raw = b'{"not json'
        status, data, _ = await post(None, None, raw=raw, header=sign(raw, hot_key, int(time.time() * 1000)))
        check("signature: good, but not JSON, is a 400", status == 400)
        body = json.dumps(transcript_event(), separators=(",", ":")).encode()
        good = sign(body, hot_key, int(time.time() * 1000))
        stamp_field = good.split(";")[2]
        odd_headers = [
            ("a MAC past ASCII", "hmac;1;1;\xe9\xe9"),
            ("a stamp past ASCII", f"hmac;1;{stamp_field}\xe9;{good.split(';')[3]}"),
            ("Arabic-Indic digits for the stamp", "hmac;1;١٢٣;" + good.split(";")[3]),
            ("too few fields", "hmac;1;" + stamp_field),
            ("empty fields", ";;;"),
            ("a lone surrogate", "hmac;1;1;\ud800"),
            ("nothing at all", ""),
        ]
        for name, header in odd_headers:
            try:
                got = service._quo_signature_ok(body, header, [hot_key])
                check(f"signature: {name} is refused, never raised", got is False, got)
            except Exception as exc:  # noqa: BLE001
                check(f"signature: {name} is refused, never raised", False, repr(exc))
        try:
            got = service._quo_signature_ok(body, good, ["not base64 at all!", hot_key])
            check("signature: an unreadable key is passed over, the good one still verifies", got is True)
        except Exception as exc:  # noqa: BLE001
            check("signature: an unreadable key is passed over, the good one still verifies", False, repr(exc))
        python_calls.clear()
        try:
            status, data, _ = await post(transcript_event(), None, header=b"hmac;1;1;\xe9\xe9")
            check("signature: bytes past ASCII at the door are a 401, not a 500",
                  status == 401 and not desk._OVERLAY and not python_calls, (status, data))
        except Exception as exc:  # noqa: BLE001
            check("signature: bytes past ASCII at the door are a 401, not a 500", False, repr(exc))
        key_file.text = None
        status, data, _ = await post(transcript_event(), hot_key)
        check("signature: with the key file gone (and no messages key here) no key is on disk: the door says so (503), "
              "nothing verified or kept, nobody asked for keys",
              status == 503 and data.get("message") == "The webhook keys are not readable." and not python_calls
              and not desk._OVERLAY, (status, data))
        key_file.text, key_file.mtime = hot_key, 4

        # ── screening ─────────────────────────────────────────────────────
        reset_fast()
        status, data, _ = await post(transcript_event(dialogue=screening_only), hot_key)
        check("screen: a dialogue without the 5558 is not_this_line",
              status == 200 and data.get("ignored") == "not_this_line"
              and not desk._OVERLAY and not python_calls and not service._HOTLINE_FAST, (status, data))
        status, data, _ = await post(transcript_event(kind="call.summary.completed"), hot_key)
        check("screen: another event type is ignored", data.get("ignored") == "type")
        status, data, _ = await post(transcript_event(call_id="AC123"), hot_key)
        check("screen: a bad call id is ignored", data.get("ignored") == "call_id")
        status, data, _ = await post(transcript_event(dialogue=[]), hot_key)
        check("screen: no turns is ignored", data.get("ignored") == "no_turns")
        other_inbox = "https://my.quo.com/inbox/PNzzOtherLine/c/CN0000?at=" + TEST_CALL_ID
        status, data, _ = await post(transcript_event(deep_link=other_inbox), hot_key)
        check("screen: the 5558's agent on another number's inbox link is not_this_line",
              status == 200 and data.get("ignored") == "not_this_line"
              and not desk._OVERLAY and not service._HOTLINE_FAST, (status, data))
        await settle_tasks()
        check("screen: none of them asked Python", not python_calls)
        check("screen: the line id sits beside the line", desk.HOTLINE_LINE_ID == "PNPqYnvZUD")
        links = [
            ("the 5558's own inbox", "https://my.quo.com/inbox/PNPqYnvZUD/c/CN092859c2f45f497c97dd?at=AC1", False),
            ("another inbox", other_inbox, True),
            ("a prefix of the 5558's id", "https://my.quo.com/inbox/PNPqYnvZUDx/c/CN1", True),
            ("no link", None, False),
            ("an empty link", "", False),
            ("a link naming no inbox", "https://my.quo.com/calls/AC1", False),
            ("not text", 12345, False),
        ]
        for name, link, elsewhere in links:
            check(f"screen: deepLink {name} → {'elsewhere' if elsewhere else 'not elsewhere'}",
                  desk.link_names_another_line(link) is elsewhere)
        reset_fast()
        answers.append(processed)
        own = "https://my.quo.com/inbox/PNPqYnvZUD/c/CN092859c2f45f497c97dd?at=" + TEST_CALL_ID
        status, data, _ = await post(transcript_event(deep_link=own), hot_key)
        await settle_tasks()
        check("screen: the 5558's own inbox link is accepted",
              data.get("accepted") == TEST_CALL_ID and actions().count("hotlineFile") == 1, (status, data))
        reset_fast()
        answers.append(processed)
        status, data, _ = await post(transcript_event(), hot_key)
        await settle_tasks()
        check("screen: an event without a deepLink is still accepted",
              data.get("accepted") == TEST_CALL_ID and actions().count("hotlineFile") == 1, (status, data))
        reset_fast()

        # ── what Python answered ──────────────────────────────────────────
        async def file_with(call_id, script=(), model=None, **set_door):
            reset_fast()
            door.update(set_door)
            answers.extend(script)
            if model is not None:
                model_says.append(model)
            status, data, _ = await post(transcript_event(call_id=call_id), hot_key)
            await settle_tasks()
            return status, data

        def stage(call_id):
            return (service._HOTLINE_FAST.get(call_id) or {}).get("stage")

        cid = "AC" + "1" * 32
        await file_with(cid, keep=503)
        check("not kept: nothing asked or filed, the call left to the inbox pass, still drawn filing",
              actions() == ["hotlineCallKeep"] and stage(cid) == "failed"
              and (desk._OVERLAY.get(cid) or {}).get("stage") == "filing"
              and any(s.startswith(f"hotline file: {cid} not kept by Python") for s in said), actions())
        door["keep"] = 200
        answers.append(processed)
        status, data, _ = await post(transcript_event(call_id=cid), hot_key)
        await settle_tasks()
        check("not kept: a call that gave up is accepted again, and files",
              data.get("accepted") == cid and stage(cid) == "filed", data)

        cid = "AC" + "2" * 32
        await file_with(cid, ask={"enabled": False})
        check("switched off: the call is dropped, off the screen, no model asked and nothing filed",
              actions() == ["hotlineCallKeep", "hotlineShadowAsk"] and stage(cid) == "dropped"
              and cid not in desk._OVERLAY, actions())

        cid = "AC" + "3" * 32
        await file_with(cid, model=("", "groq refused: r_429"))
        entry = desk._OVERLAY.get(cid) or {}
        check("blocked: a model that would not answer is drawn blocked with why, settled once, nothing filed",
              actions() == ["hotlineCallKeep", "hotlineShadowAsk", "hotlineFile/blocked"]
              and stage(cid) == "blocked" and entry.get("stage") == "blocked" and "r_429" in entry.get("why", "")
              and python_calls[-1]["payload"] == {"call_id": cid, "settle": "blocked", "why": "groq refused: r_429"},
              (actions(), entry))
        check("blocked: the pass that leaves it blocked is said with its count",
              any(s.startswith(f"hotline file: {cid} blocked") and "after 3 passes" in s for s in said))

        cid = "AC" + "4" * 32
        await file_with(cid, ask={"enabled": True, "no_words": True})
        entry = desk._OVERLAY.get(cid) or {}
        check("no words: settled as nothing to file, no model asked, drawn filed with nothing",
              actions() == ["hotlineCallKeep", "hotlineShadowAsk", "hotlineFile/no_words"]
              and stage(cid) == "filed" and entry.get("stage") == "filed" and entry.get("items") == 0
              and entry.get("kinds") == [], (actions(), entry))

        cid = "AC" + "5" * 32
        await file_with(cid, [{"status": 409, "message": "held by another filing"}])
        check("refused: a filing Python refused is left to the inbox pass and said",
              actions().count("hotlineFile") == 1 and stage(cid) == "failed"
              and (desk._OVERLAY.get(cid) or {}).get("stage") == "filing"
              and any(s.startswith(f"hotline file: {cid} refused 409") for s in said))

        cid = "AC" + "6" * 32
        await file_with(cid, ["defer"])
        check("deferred: kept nothing, so it is never asked twice, and left to the inbox pass",
              actions().count("hotlineFile") == 1 and stage(cid) == "failed"
              and any(s.startswith(f"hotline file: {cid} deferred") for s in said))

        cid = "AC" + "7" * 32
        await file_with(cid, [RuntimeError("timed out"), processed])
        files = [c for c in python_calls if c["action"] == "hotlineFile"]
        check("unanswered: asked once more under the same write id, and filed",
              len(files) == 2 and files[0]["extra"] == files[1]["extra"]
              and files[0]["extra"].get("write_id") == write_id("hotline-file", cid) and stage(cid) == "filed")

        cid = "AC" + "8" * 32
        await file_with(cid, [RuntimeError("timed out"), RuntimeError("timed out")])
        check("unanswered twice: not known to be kept, left to the inbox pass",
              actions().count("hotlineFile") == 2 and stage(cid) == "failed"
              and any(s.startswith(f"hotline file: {cid} not known to be kept") for s in said))

        cid = "AC" + "b" * 32
        service._dirty.clear()
        await file_with(cid, [{"status": 200, "data": {"state": "already_filed"}}])
        entry = desk._OVERLAY.get(cid) or {}
        check("already filed: drawn filed with what it filed not known (items and kinds None), no lane copy",
              stage(cid) == "filed" and entry.get("stage") == "filed"
              and entry.get("items") is None and entry.get("kinds") is None and not mirrored, entry)
        row = (desk.overlay_apply([], "v0", {"company": {}, "roster": {}})[0] or [{}])[0]
        check("already filed: the row says waiting, stage filed, items None and kinds a list",
              row.get("hotline", {}).get("state") == "waiting" and row["hotline"].get("stage") == "filed"
              and row["hotline"].get("items") is None and row["hotline"].get("kinds") == [], row.get("hotline"))
        check(f"already filed: the lanes are rebuilt all the same ({', '.join(sorted(want)) or 'none known'})",
              want <= service._dirty and (bool(want) or not service._dirty))

        cid = "AC" + "f" * 32
        service._dirty.clear()
        await file_with(cid, [{"status": 200, "data": {"state": "filed", "items": 0, "kinds": []}}])
        check("filed with no items: the lanes are rebuilt all the same, the lane houses left alone",
              stage(cid) == "filed" and want <= service._dirty and not mirrored
              and (desk._OVERLAY.get(cid) or {}).get("items") == 0)

        # ── the inbox pass: what nobody filed, filed on the clock ─────────
        reset_fast()
        for q in (tagged, untagged, plain_q):
            while not q.empty():
                q.get_nowait()
        gen1 = desk._DESK["gen"]
        cid = "AC" + "c" * 32
        door["due"] = [{"call_id": cid, "event_at": "", "created": "", "duration": 12,
                        "dialogue": test_dialogue()[:4], "caller_phones": "", "team": EXPECTED_TEAM}]
        answers.append(processed)
        await service._hotline_python_inbox()
        await settle_tasks()
        check("inbox pass: the due calls read, then each kept, asked and filed as the webhook's are",
              actions() == ["hotlineInboxDue", "hotlineCallKeep", "hotlineShadowAsk", "hotlineFile"]
              and python_calls[1]["payload"]["call_id"] == cid, actions())
        check("inbox pass: a filing on the clock invalidates the desk and rings the screens",
              desk._DESK["gen"] == gen1 + 1 and not tagged.empty() and tagged.get_nowait() == "hotline:calls"
              and untagged.empty() and plain_q.empty())
        reset_fast()
        await service._hotline_python_inbox()
        check("inbox pass: an inbox Python could not read files nothing and is said",
              actions() == ["hotlineInboxDue"] and any(s.startswith("hotline inbox: not read") for s in said))
        reset_fast()

        # ── the overlay ───────────────────────────────────────────────────
        desk._OVERLAY.clear()
        t0 = time.time()
        desk.overlay_put(TEST_CALL_ID, at="2026-09-17T15:50:31.718Z", duration=73.142815,
                         dialogue=dialogue, now=t0)
        context = {"company": {}, "roster": {}}
        calls, version = desk.overlay_apply([], "v0", context, now=t0)
        row = calls[0] if calls else {}
        check("overlay: a call the index lacks is added whole",
              len(calls) == 1 and row["line_key"] == "hotline" and row["hotline"]["state"] == "waiting"
              and row["hotline"]["stage"] == "filing" and row["hotline"]["at"] == ""
              and row["hotline"]["kinds"] == [] and row["hotline"]["items"] is None
              and row["turns"] == 22 and row["has_transcript"] and row["summary"] is None
              and row["caller"]["phone"] == "+13307544040" and row["caller"]["who"] == "shared", row)
        check("overlay: the version moves", version != "v0" and len(version) == 16)
        check("overlay: the same overlay gives the same version",
              desk.overlay_apply([], "v0", context, now=t0)[1] == version)
        waiting = {"call_id": TEST_CALL_ID, "at": "2026-09-17T15:50:32Z", "line": "+13309195558",
                   "line_key": "hotline", "direction": "incoming", "duration_sec": 73, "turns": 22,
                   "caller": {"phone": "+13307544040", "kind": "company_line", "line_name": "",
                              "who": "shared", "name": ""},
                   "summary": {"text": "s", "next_steps": []},
                   "hotline": {"state": "waiting", "at": "", "kinds": [], "items": None, "via": "",
                               "why": "", "capped": None},
                   "has_transcript": True}
        older = {**waiting, "call_id": "AC" + "9" * 32, "at": "2026-09-16T10:00:00Z",
                 "hotline": {**waiting["hotline"], "state": "filed"}}
        index_calls = [waiting, older]
        snapshot = json.dumps(index_calls, sort_keys=True)
        calls, version = desk.overlay_apply(index_calls, "v1", context, now=t0)
        check("overlay: it speaks over waiting, keeping the index's row",
              calls[0]["hotline"]["state"] == "waiting" and calls[0]["hotline"]["stage"] == "filing"
              and calls[0]["summary"] == {"text": "s", "next_steps": []}
              and calls[0]["direction"] == "incoming" and version != "v1", calls[0])
        check("overlay: the index's rows are never mutated", json.dumps(index_calls, sort_keys=True) == snapshot)
        desk.overlay_stage(TEST_CALL_ID, "filed", kinds=["Request"], items=1, now=t0 + 1)
        calls, version2 = desk.overlay_apply(index_calls, "v1", context, now=t0 + 1)
        check("overlay: a stage change moves the version, the state a bundle knows staying waiting",
              calls[0]["hotline"]["state"] == "waiting" and calls[0]["hotline"]["stage"] == "filed"
              and calls[0]["hotline"]["kinds"] == ["Request"] and calls[0]["hotline"]["items"] == 1
              and calls[0]["hotline"]["at"] != "" and version2 not in ("v1", version))
        # Every state a bundle from before the webhook can draw (its HotlineState),
        # and the fields it walks without a guard (kinds as a list).
        base_states = {"filed", "blocked", "waiting", "held", "legacy", "no_words", "unlogged"}
        seen = []
        for stage_name, extra in (("filing", {}), ("filed", {"kinds": ["Request"], "items": 1}),
                                  ("filed", {"kinds": None, "items": None}), ("blocked", {"why": "r_429"})):
            desk.overlay_stage(TEST_CALL_ID, stage_name, now=t0 + 1, **extra)
            for drawn in (desk.overlay_apply([], "v0", context, now=t0 + 1)[0]
                          + desk.overlay_apply([waiting], "v0", context, now=t0 + 1)[0]):
                seen.append((stage_name, drawn["hotline"]["state"], drawn["hotline"]["stage"],
                             isinstance(drawn["hotline"]["kinds"], list), drawn["hotline"]["why"]))
        check("overlay: only states an older bundle knows, kinds always a list",
              all(state in base_states and is_list for _, state, _, is_list, _ in seen)
              and all(state == ("blocked" if st == "blocked" else "waiting") and stage == st
                      for st, state, stage, _, _ in seen)
              and any(state == "blocked" and why == "r_429" for _, state, _, _, why in seen), seen)
        desk.overlay_stage(TEST_CALL_ID, "filed", kinds=["Request"], items=1, now=t0 + 1)
        filed_row = {**waiting, "hotline": {**waiting["hotline"], "state": "filed", "kinds": ["Request"]}}
        calls, version3 = desk.overlay_apply([filed_row, older], "v2", context, now=t0 + 2)
        check("overlay: the index's filed wins, the entry goes, the version stays",
              version3 == "v2" and calls[0] is filed_row and TEST_CALL_ID not in desk._OVERLAY)
        desk.overlay_put(TEST_CALL_ID, at="2026-09-17T15:50:31.718Z", duration=73, dialogue=dialogue, now=t0)
        calls, version = desk.overlay_apply([], "v0", context, now=t0, exclude={TEST_CALL_ID})
        check("overlay: an excluded call is not added", calls == [] and version == "v0")
        screening_row = {**waiting, "line": "+13307544040", "line_key": "screening", "hotline": None}
        calls, version = desk.overlay_apply([screening_row], "v0", context, now=t0)
        check("overlay: a call the index placed on the 4040 is left as the index drew it",
              calls == [screening_row] and version == "v0")
        detail = desk.overlay_detail(TEST_CALL_ID) or {}
        turns = (detail.get("transcript") or {}).get("turns") or []
        check("overlay: the detail reads its words",
              detail.get("transcript", {}).get("source") == "webhook" and len(turns) == 22
              and turns[0] == {"at": "0:01", "speaker": "+13309195558", "role": "agent", "text": "Hello."}
              and turns[5]["role"] == "caller" and detail["transcript"]["plain"] == EXPECTED_PLAIN
              and detail.get("summary") is None, turns[:1])
        # An older bundle reads any source but calls_house as `transcripts`, and
        # draws turns of {at, speaker, role agent|caller|other, text}.
        check("overlay: the detail's turns are the shape every bundle draws",
              all(set(t) == {"at", "speaker", "role", "text"} and t["role"] in ("agent", "caller", "other")
                  and all(isinstance(t[k], str) for k in ("at", "speaker", "text")) for t in turns)
              and isinstance(detail["transcript"]["plain"], str))
        check("overlay: an unknown call has no detail", desk.overlay_detail("AC" + "0" * 32) is None)
        calls, _ = desk.overlay_apply([], "v0", context, now=t0 + desk.OVERLAY_FILING_TTL_S + 1)
        check("overlay: a call still filing after 10 min is left to the books",
              calls == [] and TEST_CALL_ID not in desk._OVERLAY)
        desk.overlay_put(TEST_CALL_ID, at="2026-09-17T15:50:31Z", duration=73, dialogue=dialogue, now=t0)
        desk.overlay_stage(TEST_CALL_ID, "filed", now=t0)
        calls, _ = desk.overlay_apply([], "v0", context, now=t0 + desk.OVERLAY_FILING_TTL_S + 1)
        check("overlay: a filed call outlives the filing limit", len(calls) == 1)
        calls, _ = desk.overlay_apply([], "v0", context, now=t0 + desk.OVERLAY_TTL_S + 1)
        check("overlay: nothing outlives 2 h", calls == [] and not desk._OVERLAY)
        for n in range(desk.OVERLAY_MAX + 5):
            desk.overlay_put(f"AC{n:032d}", at="2026-09-17T15:50:31Z", duration=1,
                             dialogue=dialogue[:1], now=t0 + n)
            desk.overlay_stage(f"AC{n:032d}", "filed", now=t0 + n)
        check("overlay: at most 200, the oldest go first",
              len(desk._OVERLAY) == desk.OVERLAY_MAX and f"AC{0:032d}" not in desk._OVERLAY
              and f"AC{desk.OVERLAY_MAX + 4:032d}" in desk._OVERLAY)
        desk._OVERLAY.clear()

        # ── the desk's generation ─────────────────────────────────────────
        saved = dict(desk._DESK)
        desk._DESK.update(index=None, at=0.0, task=None, failure="", failed_at=0.0, gen=0, task_gen=0)
        fut = loop.create_future()
        fut.set_result({"payload": {"calls": []}})
        desk.invalidate()
        desk._landed(fut, gen=0)
        check("generation: a build from before the invalidate lands stale",
              desk._DESK["index"] is not None and desk._DESK["at"] == 0.0)
        desk._landed(fut, gen=1)
        check("generation: a build from after it lands fresh", desk._DESK["at"] > 0.0)

        import threading
        gate = threading.Event()
        built = []

        def fake_build(sheets, pg_dsn, people_path, *, core_sheet_id=None, now=None):
            built.append(desk._DESK["gen"])
            gate.wait(10)
            return {"payload": {"calls": [], "n": len(built)}}

        real_build = desk.build_index
        desk.build_index = fake_build
        try:
            desk._DESK.update(index=None, at=0.0, task=None, failure="", gen=5, task_gen=5)
            waiter = asyncio.ensure_future(desk.current_index(None, "", "/nonexistent"))
            await asyncio.sleep(0.05)
            desk.invalidate()
            gate.set()
            got = await waiter
            check("generation: a request awaiting a build it joined still gets it",
                  got["payload"]["n"] == 1 and desk._DESK["at"] == 0.0)
            ok = await desk.settle(None, "", "/nonexistent", timeout_s=5)
            check("generation: settle waits for a build read after the invalidate",
                  ok and desk._DESK["at"] > 0.0 and desk._DESK["index"]["payload"]["n"] == 2
                  and desk._DESK["task_gen"] == desk._DESK["gen"] == 6)
        finally:
            desk.build_index = real_build
            desk._DESK.clear()
            desk._DESK.update(saved)

        async def spin(n=20):
            for _ in range(n):
                await asyncio.sleep(0)

        def heard(q):
            out = []
            while not q.empty():
                out.append(q.get_nowait())
            return out

        # ── the clock rings the screens ───────────────────────────────────
        for q in (tagged, untagged, plain_q):
            heard(q)
        loop_src = sources["snapshot_service"]
        at_loop = loop_src.index("async def _staff_sweep_loop")
        inbox = loop_src.find("await _hotline_python_inbox()", at_loop)
        check("clock: the loop's inbox pass files the hotline after the staff pass, before the support desk's clock",
              loop_src.find("staffAttendanceSweep", at_loop) < inbox
              < loop_src.find('"supportDeskClockDue"', at_loop) < loop_src.find("async def ", at_loop + 10))

        real_actor, real_index, real_clock = (service._hotline_actor, service._hotline_index,
                                              service._hotline_sweep_clock)

        async def door_actor(authorization, *args, **kwargs):
            return ("manager", "u-door")

        async def door_index():
            return {"payload": {"calls": [], "version": "v0", "sources": {}}, "version_without_screening": "v0",
                    "context": {"company": {}, "roster": {}}, "where": {}}

        async def door_clock():
            return {}

        async def armed_says():
            got = await service.lane_hotline_calls("Bearer door")
            return got.get("data", {}).get("fast_path_armed") if got.get("status") == 200 else got

        service._hotline_actor, service._hotline_index, service._hotline_sweep_clock = (door_actor, door_index,
                                                                                        door_clock)
        try:
            check("calls door: fast_path_armed with the key", await armed_says() is True)
            key_file.text = None
            check("calls door: not armed without the key", await armed_says() is False)
            key_file.text, key_file.mtime = hot_key, 5
            saved_secret, service.SERVICE_SECRET = service.SERVICE_SECRET, ""
            check("calls door: armed with no service credential and no exec door — Python files it",
                  await armed_says() is True and not hasattr(service, "EXEC_URL"))
            service.SERVICE_SECRET = saved_secret
        finally:
            service._hotline_actor, service._hotline_index, service._hotline_sweep_clock = (real_actor, real_index,
                                                                                            real_clock)

        # ── streams ───────────────────────────────────────────────────────
        for q in (tagged, untagged, plain_q):
            heard(q)
        service._publish_slice("supportQueue")
        await spin(2)
        check("stream: an ordinary slice name still reaches every stream",
              all((not q.empty()) and q.get_nowait() == "supportQueue" for q in (tagged, untagged, plain_q)))
        service._publish_slice("hotline:calls")
        await spin(2)
        check("stream: hotline:calls only the tagged one",
              heard(tagged) == ["hotline:calls"] and untagged.empty() and plain_q.empty())
        tagged.hotline_until = time.time() - 1
        service._publish_slice("hotline:calls")
        await spin(2)
        check("stream: a tag past its verdict hears nothing and is taken off",
              tagged.empty() and tagged.hotline is False)
        service._publish_slice("hotline:calls")
        await spin(2)
        check("stream: and stays off", tagged.empty())
        for q in (tagged, untagged, plain_q):
            service._event_subs.discard(q)

        verdicts = {}
        asked = []

        async def fake_actor(authorization, *args, **kwargs):
            asked.append(authorization)
            v = verdicts[authorization]
            if isinstance(v, list):
                v = v.pop(0) if len(v) > 1 else v[0]
            if isinstance(v, Exception):
                raise v
            return v

        service._hotline_actor = fake_actor

        async def open_stream(token, verdict):
            verdicts["Bearer " + token] = verdict
            service._auth_cache[token] = (time.time(), True, "manager", "u-" + token)
            before = set(service._event_subs)
            resp = await service.events("Bearer " + token)
            new = list(set(service._event_subs) - before)
            await spin()
            return resp, (new[0] if new else None)

        async def until_true(fn, timeout_s=1.0):
            end = time.time() + timeout_s
            while time.time() < end:
                if fn():
                    return True
                await asyncio.sleep(0.01)
            return fn()

        held_gate = service._HOTLINE_STREAM_GATE
        resp, q_open = await open_stream("tok-open", ("manager", "u-open"))
        check("events: the stream opens untagged, and the gate tags it until its verdict ends",
              resp.status_code == 200 and q_open is not None and q_open.hotline is True
              and abs(q_open.hotline_until - (held_gate["tok-open"][0] + service.HOTLINE_STREAM_GATE_TTL_S)) < 0.01)
        check("events: a tag turning on rings hotline:calls once on that stream",
              heard(q_open) == ["hotline:calls"])
        resp, q_shut = await open_stream("tok-shut", {"status": 403, "reason": "badge", "message": "no"})
        check("events: a refused session stays untagged, and is not rung",
              q_shut is not None and q_shut.hotline is False and heard(q_shut) == [])
        resp, q_err = await open_stream("tok-err", RuntimeError("gate threw"))
        check("events: a gate that throws stays shut", q_err is not None and q_err.hotline is False
              and heard(q_err) == [])
        resp, q_again = await open_stream("tok-open", ("manager", "u-open"))
        check("events: the verdict is held per token",
              asked.count("Bearer tok-open") == 1 and q_again.hotline is True
              and q_again.hotline_until == q_open.hotline_until)
        check("events: a transient refusal is held for less",
              held_gate["tok-err"][1] == "retry" and held_gate["tok-err"][2] == service.HOTLINE_STREAM_GATE_RETRY_S
              and held_gate["tok-shut"][1] == "shut" and held_gate["tok-shut"][2] == service.HOTLINE_STREAM_GATE_TTL_S)
        check("events: shipped to ask a refusal that may pass again after 30 s", shipped_gate_retry == 30.0)

        resp, q_flaky = await open_stream("tok-flaky", [{"status": 403, "reason": "stale", "message": "old"},
                                                        ("manager", "u-flaky")])
        check("events: a stale record leaves the stream untagged for now", q_flaky.hotline is False)
        tagged_later = await until_true(lambda: q_flaky.hotline is True)
        check("events: ... and the gate is asked again, tagging it and ringing once",
              tagged_later and asked.count("Bearer tok-flaky") == 2 and heard(q_flaky) == ["hotline:calls"])
        await asyncio.sleep(0.25)
        check("events: a refusal that may pass keeps being asked while the stream is open",
              asked.count("Bearer tok-err") >= 3, asked.count("Bearer tok-err"))
        check("events: a refusal that will not pass is never asked again", asked.count("Bearer tok-shut") == 1)
        service._event_subs.discard(q_err)
        stopped = await until_true(lambda: not q_err.hotline_checking)
        k = asked.count("Bearer tok-err")
        await asyncio.sleep(0.25)
        check("events: and no longer once the stream is gone",
              stopped and asked.count("Bearer tok-err") == k and q_err.hotline is False)

        # a tag past its verdict: withheld, taken off, asked again, and rung once as it opens again
        heard(q_open)
        heard(q_again)
        q_open.hotline_until = time.time() - 1
        held_gate.pop("tok-open", None)
        n_open = asked.count("Bearer tok-open")
        service._publish_slice("hotline:calls")
        service._publish_slice("hotline:calls")
        await asyncio.sleep(0)
        check("events: an expired tag is taken off before the name reaches it",
              q_open.hotline is False and q_open.empty() and q_open.hotline_checking is True)
        await spin()
        check("events: one check again for two rings, the tag back, and one ring for what was withheld",
              asked.count("Bearer tok-open") == n_open + 1 and q_open.hotline is True
              and q_open.hotline_until > time.time() and heard(q_open) == ["hotline:calls"])
        check("events: a stream still inside its verdict heard both rings", heard(q_again) == ["hotline:calls"] * 2)
        service._publish_slice("hotline:calls")
        await spin(2)
        check("events: the tag back on hears the next ring", heard(q_open) == ["hotline:calls"])

        # signed out elsewhere: the session cache refuses the token inside the verdict's time
        resp, q_out = await open_stream("tok-out", ("manager", "u-out"))
        heard(q_out)
        service._auth_cache["tok-out"] = (time.time(), False, "", "")
        verdicts["Bearer tok-out"] = {"status": 401, "reason": "session", "message": "sign in first"}
        n_out = asked.count("Bearer tok-out")
        service._publish_slice("hotline:calls")
        await spin()
        check("events: a session the cache now refuses hears nothing and loses its tag",
              heard(q_out) == [] and q_out.hotline is False)
        check("events: ... its held open verdict is not trusted: the gate is asked, and holds a retry",
              asked.count("Bearer tok-out") == n_out + 1 and held_gate["tok-out"][1] == "retry")
        # the refusal was the auth cache's brief busy-backend hold: vouched again, the stream hears again
        service._auth_cache["tok-out"] = (time.time(), True, "manager", "u-out")
        verdicts["Bearer tok-out"] = ("manager", "u-out")
        await asyncio.sleep(service.HOTLINE_STREAM_GATE_RETRY_S * 3)
        await spin()
        check("events: a session vouched again after a brief refusal is tagged and rung again",
              q_out.hotline is True and heard(q_out) == ["hotline:calls"])
        service._publish_slice("hotline:calls")
        await spin()
        check("events: ... and hears the next ring", heard(q_out) == ["hotline:calls"])

        held_gate["tok-gone"] = (time.time(), "open", service.HOTLINE_STREAM_GATE_TTL_S)
        verdicts["Bearer tok-gone"] = {"status": 401, "reason": "session", "message": "sign in first"}
        service._auth_cache.pop("tok-gone", None)
        got = await service._hotline_stream_allowed("Bearer tok-gone", "tok-gone")
        check("gate: a held open verdict with no session entry is asked again, and a session refusal may pass later",
              got[0] == "retry" and asked.count("Bearer tok-gone") == 1, got)
        service._auth_cache["tok-held"] = (time.time(), True, "manager", "u-held")
        held_gate["tok-held"] = (time.time() - 100, "open", service.HOTLINE_STREAM_GATE_TTL_S)
        got = await service._hotline_stream_allowed("Bearer tok-held", "tok-held")
        check("gate: a held open verdict on a passing session answers from the hold, until it ends",
              got[0] == "open" and "Bearer tok-held" not in asked
              and abs(got[1] - (held_gate["tok-held"][0] + service.HOTLINE_STREAM_GATE_TTL_S)) < 0.01, got)

        for q in (q_open, q_shut, q_err, q_again, q_flaky, q_out):
            service._event_subs.discard(q)
        for token in ("tok-open", "tok-shut", "tok-err", "tok-flaky", "tok-out", "tok-held"):
            service._auth_cache.pop(token, None)
        await asyncio.sleep(0.12)

        check("log: no key was ever said", not any(k in s for s in said for k in (hot_key, wrong_key, old_key)))

    asyncio.run(run())
    total = results["ok"] + len(results["failed"])
    if results["failed"]:
        print(f"\n{len(results['failed'])} of {total} failed: {', '.join(results['failed'])}")
        return 1
    print(f"\nall {total} passed")
    return 0


if __name__ == "__main__":
    if "HOTLINE_FAST_SOURCES" in globals():
        sys.exit(main_inside())
    sys.exit(_run_in_container())
