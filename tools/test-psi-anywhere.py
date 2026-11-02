#!/usr/bin/env python3
"""
The PSIANYWHERE PROOF, asserted against the real functions.

WHAT IT PROVES. A caller who says PsiAnywhere is not working gets an answer
that was MEASURED, and the three ways that answer can be wrong are each taken
one by one: saying "up" when nothing was proved, saying "down" when the fault
was ours, and saying anything at all about an account.

  rungs       the login page with its own marks and without them; the service
              answering its own refusal, answering 5xx, answering something
              that is not its own, and refusing us with 401; a 4xx that is
              neither of those; and the third rung, which runs only when the
              cheap two are inconclusive AND the host answered at least once
  attributed  a 401 or a 403 aimed at us is `up` only when something attributes
              it to them — their own stack in the headers, or a rung in the same
              check that answered in their voice. A stranger's 401, a proxy
              403 on both rungs and a captive portal are each `unknown`, because
              an answer nobody can attribute is not a verdict in EITHER
              direction, and `up` is the one that tells a caller to stop worrying
  OUR CLOCK   the whole of the rule that `down` costs a phone call: a rung that
  IS NOT      ran out of OUR time, a name our resolver could not answer, a TLS
  THEIR       handshake that failed here, a 5xx nothing attributes to them and a
  OUTAGE      stranger answering 200 are each `unknown`; a slow but healthy
              answer is `up`; and `down` is left to a refused, reset or
              unroutable connection and to a failure that carries their own
              marks or comes off the host that just served their login page
  reading     every pair of rung words mapped to up / down / unknown, and
              which rung decided it
  parity      the sentence a screen prints, the note a queue row carries, the
              `why` Apps Script reads and the machine-readable state never
              disagree; an `unknown` note SAYS the check could not decide
  contract    the verdict object's exact field set, and that the three fields
              Apps Script reads (`at`, `why`, `cached`) carry the same values
              as the three this module's own doors read
  cache       a second caller inside the hold takes the held verdict; the hold
              is shorter for `down` than for `up`; `force` skips it
  one flight  ten callers at once are ONE probe, and the nine that waited get
              the answer the one made
  budget      a rung with no time left is skipped, not run; the whole check
              stays inside PSI_BUDGET_S even when every rung stalls
  the ration  the one rung that is a real login runs at most once in its gap,
              is never retried, is rested after tries that settle nothing, and
              cannot be bought by `force` or by dropping the held verdict
  accounts    the ADM line and Ty's each carry their own refusal latch on the
              one clock; the rung signs in as the ACTIVE account; Ty is tried
              at most twice a New York day; DOWN (the lane's failed read and
              failed login) holds the rung too, survives a dropped verdict and
              a restart
  sockets     a port nothing listens on is REFUSED and that is `down`; a plain
              socket answering an https:// request fails the handshake and that
              is `unknown`; an unroutable address times out and that is
              `unknown`; a name that does not resolve is `unknown`
  secret      no file, an unreadable file, a file that is not JSON, a file
              missing either half: `unknown`, never a crash, and the third
              rung simply does not exist
  silence     no credential, no password, no hash and no md5 appears in any
              log line, any sentence, any note or any door answer
  doors       /hub-lanes/psi/health refuses a closed gate with its `reason`,
              /psi/health refuses a wrong service secret, both answer 503
              rather than throwing when the module did not load, and NO refusal
              either door makes can be read as an outage
  /health     says exactly {armed, held, credential} and never a verdict
  fast path   a hotline call whose words mention PsiAnywhere carries the verdict
              in the same hotlineSweep payload; one that does not carries none;
              the verdict is taken ONCE for all retries; and a probe that is not
              ready by PSI_FAST_WAIT_S does not hold the ring up — the call
              files with no proof note rather than late

WHERE IT RUNS. The relay's dependencies live in its container, so this ships
ITS OWN checkout's server/psi_anywhere.py and server/snapshot_service.py into
`asa-hub-snapshot` over stdin and imports them IN MEMORY ahead of /srv/app.
Nothing is written anywhere, the app is never started, Apps Script is never
called (the exec door is stubbed), and the real PsiAnywhere service is never
asked for anything — the only socket opened is to an unroutable address and to
a name that does not resolve. No real credential is read: the secret file is
pointed at a path that does not exist and then at fakes made here.

    python3 tools/test-psi-anywhere.py
"""
import base64
import json
import os
import subprocess
import sys

CONTAINER = os.getenv("HUB_RELAY_CONTAINER", "asa-hub-snapshot")
MODULES = ("psi_anywhere", "psi_attendance", "snapshot_service", "hotline_desk", "hotline_lanes",
           "quo_inbox", "quo_pull", "mirror_first",
           # the IST settings reader; its declaration rides in HUB_IST_CONFIG_DECLARATION_JSON
           "ist_config",
           # the gates the relay's own doors ask before they reach the world
           # (apps-script/SmartGate.gs resolves them; configLane carries them)
           "lane_gate",
           # the attendance lane's own new halves: the entry history, the rule-13
           # planner and the punch board's slice — the checkout's, never /srv/app's
           "psi_entries", "psi_reminders", "punch_board_slices",
           "psi_punches_feed", "psi_punches_slices",
           # the shift flow's house names and the notes it reads — the
           # checkout's, since /srv/app has neither version yet
           "house_directory", "daily_notes",
           # the master JSON and its hand-off journal, imported at the top of
           # snapshot_service — the checkout's, since /srv/app has none yet —
           # the calls door, which journals through it, and the one redaction
           # rule the master and the sheet keeper both write through
           "master_json", "comm_calls_feed", "redaction",
           # the full punch sheet's record (every field, client data included),
           # and the clients present its live rows are filled with
           "psi_punches_full", "psi_consumers",
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
# Reserved by the IETF for documentation and routed nowhere: a connection to it
# times out instead of being refused, which is the shape of a service that is
# down rather than a machine that said no.
UNROUTABLE = "https://192.0.2.1"
NO_SUCH_NAME = "https://psianywhere.invalid"


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
    script = f"PSI_SOURCES = {blob!r}\n" + body
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


# ── the fake service ────────────────────────────────────────────────────────
# The real login page's marks and the real getLogIn refusal, both copied from
# what the live service answered when this was measured. Nothing here is
# invented: an assertion against a body nobody ever saw proves nothing.
PAGE_BODY = ('<!DOCTYPE html><html><head><title>Anywhere</title></head><body>'
             '<input id="username"><input id="password">'
             '<button id="loginBtn">Log In</button><a id="resetPassword">Forgot?</a>'
             '<span id="ver">6.1</span></body></html>')
REFUSAL_BODY = ('{"getLogInResult":"<results><permissions><window_name>Invalid username<\\/window_name>'
                '<permission><\\/permission><special_data>652<\\/special_data><\\/permissions><\\/results>"}')
IIS_ERROR_BODY = "<html><head><title>500 - Internal server error.</title></head><body></body></html>"
# A login the account accepted: the same envelope, with the word the service
# answers a real sign-in with (`Token`) and a session value where the refusal
# carries its count.
TOKEN_BODY = REFUSAL_BODY.replace("Invalid username", "Token").replace(">652<", ">A1B2C3<")


def main_inside() -> int:  # noqa: C901 - one flat list of assertions reads best
    import asyncio
    import hashlib
    import importlib.abc
    import importlib.util
    import logging
    import socket
    import threading
    import time
    import types

    import httpx

    sources = json.loads(base64.b64decode(PSI_SOURCES))  # noqa: F821 - set by the host half

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

    # NEVER THE SEAL MOUNT. The real /srv/secrets/psianywhere.json is not read
    # by this test at any point, and this is the line that guarantees it.
    os.environ["HUB_PSI_SECRET_FILE"] = "/nonexistent/psi-anywhere-test.json"
    # Nor the Ty file the second account will be written to.
    os.environ["HUB_PSI_TY_SECRET_FILE"] = "/nonexistent/psi-anywhere-ty-test.json"
    # And the full punch sheet's locked JSON goes nowhere near /srv/snapshot.
    os.environ["HUB_PSI_FULL_DIR"] = "/tmp/psi-full-test"
    os.environ["QUO_HOTLINE_WEBHOOK_KEY_FILE"] = "/nonexistent/psi-test-hotline.key"
    os.environ.pop("QUO_HOTLINE_WEBHOOK_KEY", None)
    # nor the text inbox's keys or disk (tools/test-quo-inbox.py is its suite)
    os.environ["HUB_QUO_MESSAGES_KEY_FILE"] = "/nonexistent/psi-test-messages.key"
    os.environ["HUB_QUO_API_KEY_FILE"] = "/nonexistent/psi-test-api.key"
    os.environ["HUB_QUO_INBOX_DIR"] = "/nonexistent/psi-test-inbox"
    # NEVER THE LIVE LANE'S STATE. The attendance lane keeps its login clock
    # in /srv/snapshot; a test that wrote there would hand the running relay a
    # refusal it never heard.
    os.environ["HUB_PSI_ATTENDANCE_STATE"] = "/tmp/psi-attendance-test.json"
    os.environ["HUB_PSI_LOGIN_CLOCK_FILE"] = "/tmp/psi-login-clock-test.json"
    # AND NONE OF THE LANE'S OTHER FILES: the punch board, the entry history,
    # the reminders' ledger and the SMS inbox all live in /srv/snapshot too.
    os.environ["HUB_PSI_PUNCH_BOARD"] = "/tmp/psi-punch-board-test.json"
    os.environ["HUB_PSI_REMINDERS_STATE"] = "/tmp/psi-reminders-test.json"
    os.environ["HUB_PSI_ENTRIES_DIR"] = "/tmp/psi-entries-test"
    os.environ["HUB_QUO_INBOX_DIR"] = "/tmp/quo-inbox-test"
    # THE WIRE'S BREATH, shortened the way the lane's own suites shorten it:
    # the checks below run credentialed probes back to back, and the probe's
    # login stands aside inside the breath (tools/test-psi-reminders.py holds
    # that). One at a time is unchanged.
    os.environ["HUB_PSI_WIRE_GAP_S"] = "0"
    for leftover in ("/tmp/psi-attendance-test.json", "/tmp/psi-login-clock-test.json"):
        try:
            os.remove(leftover)
        except OSError:
            pass
    sys.meta_path.insert(0, Checkout())
    sys.path.insert(0, "/srv/app")
    import psi_anywhere as psi  # noqa: E402
    import snapshot_service as service  # noqa: E402

    results = {"ok": 0, "failed": []}

    def check(name, cond, detail=""):
        if cond:
            results["ok"] += 1
            print(f"ok   {name}")
        else:
            results["failed"].append(name)
            print(f"FAIL {name}{(' — ' + str(detail)[:400]) if detail else ''}")

    check("the checkout's modules are the ones imported",
          getattr(psi.__spec__, "origin", "") == "checkout:psi_anywhere"
          and getattr(service.__spec__, "origin", "") == "checkout:snapshot_service"
          and service.psi_anywhere is psi)
    check("the secret file is not the seal mount",
          str(psi.PSI_SECRET_FILE) == "/nonexistent/psi-anywhere-test.json")

    # ── everything the log said, so a secret can be proved absent from it ──
    said = []

    class Keep(logging.Handler):
        def emit(self, record):
            said.append(record.getMessage())

    for name in ("hub.psi", "hub.snapshot"):
        lg = logging.getLogger(name)
        lg.addHandler(Keep())
        lg.setLevel(logging.INFO)
        lg.propagate = False

    # ── a service made of scripted answers ───────────────────────────────
    # The real httpx, driven through its own MockTransport, so status codes,
    # bodies, timeouts and exceptions all behave as they do in production.
    script = {"page": None, "service": None, "stalls": 0.0, "calls": []}

    def handler(request):
        leg = "page" if request.method == "GET" else "service"
        script["calls"].append({"leg": leg, "url": str(request.url),
                                "body": request.content.decode() or "",
                                "headers": dict(request.headers)})
        answer = script[leg]
        if isinstance(answer, list):
            # A scripted SEQUENCE: each call takes the next, the last repeats.
            # The third rung exists because a door can answer an empty body and
            # a real one differently, and that is only testable in sequence.
            answer = answer.pop(0) if len(answer) > 1 else answer[0]
        if isinstance(answer, Exception):
            raise answer
        # (status, body) or (status, body, headers) — the headers matter because
        # a 5xx off their own stack is theirs and a 5xx off anything else is not.
        status, body, headers = (list(answer) + [None, None])[:3]
        return httpx.Response(status, text=body, headers=headers or {})

    class Stubbed(httpx.AsyncClient):
        """The module's own client, with the network replaced and a stall the
        budget tests can turn on. Every other behaviour is real httpx."""
        def __init__(self, **kw):
            kw["transport"] = httpx.MockTransport(handler)
            super().__init__(**kw)

        async def request(self, *a, **kw):
            if script["stalls"]:
                await asyncio.sleep(script["stalls"])
            return await super().request(*a, **kw)

    psi.httpx = types.SimpleNamespace(
        AsyncClient=Stubbed, Timeout=httpx.Timeout, MockTransport=httpx.MockTransport,
        TimeoutException=httpx.TimeoutException, ConnectError=httpx.ConnectError,
        ProtocolError=httpx.ProtocolError, TransportError=httpx.TransportError)

    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)

    def run(page, svc, *, stalls=0.0, force=False):
        script.update(page=page, service=svc, stalls=stalls, calls=[])
        psi.forget()
        return loop.run_until_complete(psi.verdict(force=force))

    UP_PAGE, UP_SVC = (200, PAGE_BODY), (200, REFUSAL_BODY)

    # ── rung by rung ──────────────────────────────────────────────────────
    v = run(UP_PAGE, UP_SVC)
    check("both rungs answer: up, by the service",
          v["state"] == "up" and v["decided_by"] == "service"
          and [r["word"] for r in v["rungs"]] == ["up", "up"], v)
    check("the service is asked with an EMPTY body and no credential",
          script["calls"][-1]["body"] == "{}"
          and script["calls"][-1]["headers"].get("x-requested-with") == "XMLHttpRequest", script["calls"])
    check("only the two cheap rungs ran", len(script["calls"]) == 2, script["calls"])

    v = run((200, "<html>hello from a proxy</html>"), UP_SVC)
    check("a page that is not theirs is retried at /webroot/ and the service still decides",
          v["state"] == "up" and v["decided_by"] == "service"
          and any(c["url"].endswith("/webroot/") for c in script["calls"]), script["calls"])

    v = run(UP_PAGE, (200, IIS_ERROR_BODY))
    check("the page serves and the service answers its own error page: down",
          v["state"] == "down" and v["decided_by"] == "service"
          and v["rungs"][1]["word"] == "failing", v)

    v = run(UP_PAGE, (503, ""))
    check("the page serves and the service answers 503: down, by the service",
          v["state"] == "down" and v["decided_by"] == "service", v)

    v = run(UP_PAGE, (401, ""))
    check("the service refusing US with 401 is the service answering: up",
          v["state"] == "up" and v["decided_by"] == "service", v)
    check("and it is `up` because THEIR OWN PAGE answered in the same check — the rung says so",
          v["rungs"][1]["theirs"] is True
          and "in this same check" in v["rungs"][1]["why"], v["rungs"])
    # AND THE SENTENCE SAYS WHAT HAPPENED, NOT WHAT WOULD HAVE BEEN NICER. The
    # service did not answer here: it refused us, and only their page's own
    # marks made that refusal theirs. A caller who rang to report an outage is
    # shown that, because it is the one fact that lets a reader doubt the
    # verdict — and it is the rung's own sentence, not a clause built here.
    check("a promoted refusal never prints as `the service answered`",
          v["why"] == v["rungs"][1]["why"]
          and "refused us in its own words" in v["why"]
          and "both answered" not in v["why"]
          and "both answered" not in v["sentence"]
          and v["sentence"].startswith("PsiAnywhere is up — the service refused us"), v)
    v2 = run(UP_PAGE, UP_SVC)
    check("and the rung that really answered still says so",
          v2["why"] == "the login page and the service both answered", v2)
    # The same rule where the refusal needed nobody's help: their own stack
    # behind it, their login page serving beside it. Still a refusal.
    v2 = run(UP_PAGE, (403, "", {"Server": "Microsoft-IIS/10.0", "X-Powered-By": "ASP.NET"}))
    check("a refusal in their own voice, beside a page that served, is still a refusal",
          v2["state"] == "up" and v2["decided_by"] == "service"
          and v2["why"] == "the service refused us in its own words"
          and "both answered" not in v2["sentence"], v2)

    # ── AND THE SAME RULE ON THE WORD THAT REASSURES (the `up` half) ──────
    # A 401 or a 403 carries no name. Their application sends it, and so does
    # every WAF, proxy, geo block and expired allow-list entry in front of
    # them — which is the exact scenario the credentialed rung exists for. With
    # nothing attributing the refusal to them, `up` would tell the person who
    # rang to report an outage that there is no outage.
    v = run((200, "<html>a captive portal</html>"), (401, ""))
    check("a 401 nobody can attribute is NOT `up` — a stranger answered the page",
          v["state"] == "unknown" and v["rungs"][1]["word"] == "unknown"
          and v["rungs"][1]["theirs"] is False
          and "nothing here attributes" in v["rungs"][1]["why"]
          and "is up" not in v["sentence"], v)
    v = run((403, ""), (403, ""))
    check("a proxy refusing OUR egress with 403 on both rungs is unknown, never up",
          v["state"] == "unknown" and v["decided_by"] == "none"
          and all(r["word"] == "unknown" and r["theirs"] is False for r in v["rungs"])
          and "is up" not in v["sentence"], v)
    v = run((200, "<html>a captive portal</html>"), (200, "<html>a captive portal</html>"))
    check("a captive portal answering 200 to both rungs is unknown, and the sentence says so",
          v["state"] == "unknown" and "could not be checked from here" in v["sentence"]
          and "is up" not in v["sentence"], v)
    their_403 = {"Server": "Microsoft-IIS/10.0", "X-Powered-By": "ASP.NET"}
    v = run((404, "x"), (403, "", their_403))
    check("a 403 off THEIR OWN stack is their own refusal: up, with no page to lean on",
          v["state"] == "up" and v["decided_by"] == "service"
          and v["rungs"][1]["theirs"] is True
          and "refused us in its own words" in v["why"], v)
    v = run(UP_PAGE, UP_SVC)
    check("an `up` sentence is the deciding rung's own words, never a clause rebuilt from the state",
          v["why"] in [str(r["why"]) for r in v["rungs"]] or
          v["why"] == "the login page and the service both answered", v)

    # ── OUR CLOCK NEVER CONVICTS THEM (the whole of the `down` rule) ──────
    # Reviewed and measured: a single 4.01 s request produced a `down` while
    # three raw POSTs to the same endpoint a minute later answered in 0.20 s.
    # Everything below decides what may cost a caller a false "it is down".

    v = run(UP_PAGE, httpx.ReadTimeout("timed out"))
    check("their page serves and the service runs out of OUR time: unknown, never down",
          v["state"] == "unknown" and v["rungs"][0]["word"] == "up"
          and v["rungs"][1]["word"] == "unknown"
          and "our own time" in v["rungs"][1]["why"], v)

    v = run(httpx.ConnectTimeout("timed out"), httpx.ConnectTimeout("timed out"))
    check("a check that timed out on both rungs is OURS: unknown, never their outage",
          v["state"] == "unknown" and len(v["rungs"]) == 2
          and all(r["word"] == "unknown" for r in v["rungs"]), v)

    ssl_error = httpx.ConnectError("handshake failed")
    ssl_error.__cause__ = __import__("ssl").SSLError("WRONG_VERSION_NUMBER")
    v = run(ssl_error, ssl_error)
    check("a TLS handshake that failed HERE is unknown, never their outage",
          v["state"] == "unknown" and all(r["word"] == "unknown" for r in v["rungs"])
          and "secure connection" in v["rungs"][0]["why"], v)

    v = run((500, IIS_ERROR_BODY), (500, IIS_ERROR_BODY))
    check("a 5xx nothing attributes to them is unknown — it may be anything between us",
          v["state"] == "unknown" and v["decided_by"] == "none"
          and all(r["word"] == "failing" and r["theirs"] is False for r in v["rungs"]), v)

    their_stack = {"Server": "Microsoft-IIS/10.0", "X-Powered-By": "ASP.NET"}
    v = run((503, IIS_ERROR_BODY, their_stack), (503, IIS_ERROR_BODY, their_stack))
    check("the same 5xx off THEIR OWN stack is theirs: down",
          v["state"] == "down" and v["rungs"][0]["theirs"] is True, v)

    v = run((200, "<html>a captive portal</html>"), (200, "<html>a captive portal</html>"))
    check("a stranger answering 200 is never their outage: unknown",
          v["state"] == "unknown" and v["rungs"][-1]["word"] == "stranger", v)

    refused = httpx.ConnectError("connection failed")
    refused.__cause__ = ConnectionRefusedError(111, "Connection refused")
    v = run(refused, refused)
    check("a connection the far side REFUSED is down, and no third rung is reached for",
          v["state"] == "down" and len(v["rungs"]) == 2
          and all(r["word"] == "refused" for r in v["rungs"]), v)

    v = run((404, "nope"), (404, "nope"))
    check("a 4xx that is nobody's refusal is unknown, never an outage",
          v["state"] == "unknown" and v["decided_by"] == "none", v)

    v = run(UP_PAGE, UP_SVC, stalls=0.35)
    check("a healthy service that answered SLOWLY is up, and the note says how long",
          v["state"] == "up" and v["ms"] >= 700 and "in 0." in v["note"], [v["ms"], v["note"]])

    # ── the third rung ────────────────────────────────────────────────────
    class Secret:
        """A secret file that lives in memory: stat and read_text, nothing else."""
        def __init__(self, text=None):
            self.text, self.mtime = text, 1

        def stat(self):
            if self.text is None:
                raise FileNotFoundError("absent")
            return types.SimpleNamespace(st_mtime_ns=self.mtime, st_size=len(self.text))

        def read_text(self, encoding="utf-8"):
            if self.text is None:
                raise FileNotFoundError("absent")
            return self.text

    def with_secret(text):
        psi.PSI_SECRET_FILE = Secret(text)
        psi._secret_state["adm"].update(stamp=None, user="", hash="", said=None)
        # Every case below is about WHAT the rung does, not how often: the
        # ration has its own block further down, and it is cleared here so one
        # test's attempt cannot silence the next one's.
        psi.forget_login()

    # THE CASE THE THIRD RUNG EXISTS FOR: their page serves, and something in
    # front of the service refuses the EMPTY body it would accept with a real
    # one. The two cheap rungs cannot tell that from an outage; the third can.
    with_secret(None)
    v = run(UP_PAGE, (400, ""))
    check("inconclusive with no credential: unknown, and nothing crashed",
          v["state"] == "unknown" and len(v["rungs"]) == 2 and psi.credential_present() is False, v)
    check("a page that serves is never on its own an `up`",
          v["rungs"][0]["word"] == "up" and v["state"] == "unknown", v)

    with_secret('{"user": "probe-user", "pass": "probe-pass"}')
    v = run(UP_PAGE, [(400, ""), (200, REFUSAL_BODY)])
    check("inconclusive with a credential: the third rung runs and decides up",
          v["state"] == "up" and v["decided_by"] == "login" and len(v["rungs"]) == 3
          and v["rungs"][2]["rung"] == "login", v)
    sent = json.loads(script["calls"][-1]["body"])
    check("the third rung sends the documented md5 hash and never the password",
          sent["userId"] == "probe-user"
          and sent["hash"] == hashlib.md5(b"probe-pass").hexdigest()
          and "probe-pass" not in script["calls"][-1]["body"], sent)

    with_secret('{"user": "probe-user", "pass": "probe-pass"}')
    v = run(UP_PAGE, [(400, ""), (503, "")])
    check("a third rung that meets their own failure says down",
          v["state"] == "down" and v["decided_by"] == "login" and len(v["rungs"]) == 3, v)

    with_secret('not json at all')
    v = run(UP_PAGE, (400, ""))
    check("a secret file that is not JSON: unknown, no third rung, no crash",
          v["state"] == "unknown" and len(v["rungs"]) == 2, v)

    with_secret('{"user": "probe-user"}')
    v = run(UP_PAGE, (400, ""))
    check("a secret file missing half of itself: unknown, no third rung",
          v["state"] == "unknown" and len(v["rungs"]) == 2, v)

    with_secret('{"user": "probe-user", "pass": "probe-pass"}')
    v = run(httpx.ConnectTimeout("t"), httpx.ConnectTimeout("t"))
    check("a credential is never posted to a host that never answered",
          len(v["rungs"]) == 2 and v["state"] == "unknown", v)

    # ── THE RATION ON THE RUNG THAT IS A REAL LOGIN ───────────────────────
    # The account behind it is the one the legacy scraper uses and the service
    # counts failed attempts (measured: a probe without the hash was answered
    # "Failed attempts: 1"). A cheap-rung stalemate — a WAF, a proxy, a geo
    # block — must therefore NOT mint one login per hotline call.
    with_secret('{"user": "probe-user", "pass": "probe-pass"}')
    gap, brake_after, brake_s = psi.PSI_LOGIN_GAP_S, psi.PSI_LOGIN_BRAKE_AFTER, psi.PSI_LOGIN_BRAKE_S
    psi.PSI_LOGIN_GAP_S, psi.PSI_LOGIN_BRAKE_AFTER, psi.PSI_LOGIN_BRAKE_S = 300.0, 2, 1800.0
    v = run(UP_PAGE, [(400, ""), (200, TOKEN_BODY)])
    check("the first inconclusive check spends one login attempt and decides",
          v["state"] == "up" and v["decided_by"] == "login" and len(script["calls"]) == 3, v)
    v = run(UP_PAGE, (400, ""))
    check("the very next inconclusive check does NOT log in again",
          v["state"] == "unknown" and len(script["calls"]) == 2
          and v["rungs"][-1]["rung"] == "login" and v["rungs"][-1].get("skipped") is True
          and "once every few minutes" in v["rungs"][-1]["why"], [len(script["calls"]), v["rungs"]])
    v = loop.run_until_complete(psi.verdict(force=True))
    check("`check it now` cannot buy a login attempt either",
          not any(c["body"] and "hash" in c["body"] for c in script["calls"]), script["calls"])
    psi.forget()
    v = run(UP_PAGE, (400, ""))
    check("dropping the held verdict does not drop the ration",
          v["rungs"][-1].get("skipped") is True, v["rungs"])
    check("the ration is counted outside the verdict cache",
          psi._login_state["at"] > 0 and psi._held["verdict"] is not None)

    # The brake: tries that settle nothing are not a password's fault, and no
    # number of them will fix a proxy. Two in a row and the rung rests.
    psi.forget_login()
    psi.PSI_LOGIN_GAP_S = 0.0
    run(UP_PAGE, [(400, ""), (404, "")])
    run(UP_PAGE, [(400, ""), (404, "")])
    check("two credentialed tries that settle nothing rest the rung",
          psi._login_state["rested_until"] > time.time() + 1000, psi._login_state)
    v = run(UP_PAGE, (400, ""))
    check("while it rests, an inconclusive check just answers unknown",
          v["state"] == "unknown" and len(script["calls"]) == 2
          and "resting" in v["rungs"][-1]["why"], v["rungs"])
    check("the rung is never retried inside one check",
          sum(1 for r in v["rungs"] if r["rung"] == "login") == 1, v["rungs"])

    # The account's own no. "Invalid username", "Failed attempts", "Not
    # active" are the application answering (up) AND the account refusing,
    # and only the second decides whether anybody may log in again.
    psi.forget_login()
    v = run(UP_PAGE, [(400, ""), (200, REFUSAL_BODY)])
    check("a refused login still reads the service as up",
          v["state"] == "up" and v["decided_by"] == "login", v)
    v = run(UP_PAGE, (400, ""))
    check("an account that refused holds the next login even with no gap",
          len(script["calls"]) == 2 and v["rungs"][-1].get("skipped") is True
          and "refused" in v["rungs"][-1]["why"], v["rungs"])
    ok_att, _why_att = psi.login_claim("attendance")
    check("and it holds the attendance lane's login too", not ok_att, _why_att)

    # ── TWO ACCOUNTS ON ONE CLOCK, AND DOWN ──────────────────────────────
    # The ADM line is refused just above. Ty has its own file and its own
    # latch; the spacing, the brake and DOWN are the one host's.
    real_ty = psi.PSI_TY_SECRET_FILE
    psi.PSI_TY_SECRET_FILE = Secret('{"user": "ty-user", "pass": "ty-pass"}')
    psi._secret_state["ty"].update(stamp=None, user="", hash="", said=None)
    check("TWO ACCOUNTS: the ADM refusal does not hold Ty — each account has its own latch",
          psi.login_would_allow(account="ty", purpose="ty_try")[0]
          and not psi.login_would_allow(account="adm")[0])
    check("TWO ACCOUNTS: while ADM is the line, a login on Ty is a counted try or nothing — the probe, the "
          "attendance lane or a caller naming no purpose is refused by the clock itself",
          not any(psi.login_would_allow(account="ty", purpose=p)[0] for p in ("", "probe", "attendance"))
          and "twice-daily tries" in psi.login_would_allow(account="ty", purpose="attendance")[1])
    check("TWO ACCOUNTS: the active account is ADM until a Ty try signs in",
          psi.active_account() == "adm")
    psi.set_active("ty")
    v = run(UP_PAGE, [(400, ""), (200, TOKEN_BODY)])
    sent_ty = json.loads(script["calls"][-1]["body"]) if script["calls"] else {}
    check("TWO ACCOUNTS: the probe's credentialed rung signs in as the ACTIVE account — Ty's user, Ty's md5",
          v["decided_by"] == "login" and sent_ty.get("userId") == "ty-user"
          and sent_ty.get("hash") == hashlib.md5(b"ty-pass").hexdigest(), sent_ty)
    t0 = time.time()
    psi.forget_login()
    claims = [psi.login_claim("ty_try", now=t0 + i * 400, account="ty")[0] for i in range(3)]
    check("TWO ACCOUNTS: at most two Ty tries a New York day, counted on the clock",
          claims == [True, True, False] and psi.ty_status(t0)["tries_today"] == 2, claims)
    psi.login_settle("up", "Not active", now=t0 + 900, account="ty")
    check("TWO ACCOUNTS: a Ty refusal lands on Ty's latch, never on the ADM line",
          psi.login_snapshot()["refused_by"]["ty"] and not psi.login_snapshot()["refused_by"]["adm"])
    psi.forget_login()
    psi.mark_down("a test outage")
    v = run(UP_PAGE, (400, ""))
    check("DOWN: while PsiAnywhere is down the probe's credentialed rung sends nothing — held like every login",
          v["rungs"][-1].get("skipped") is True and "down" in v["rungs"][-1]["why"]
          and len(script["calls"]) == 2, v["rungs"])
    psi.forget()
    check("DOWN: dropping the held verdict does not drop DOWN", psi.down_state() is not None)
    psi._login_state["down"] = None
    psi._login_load()
    check("DOWN: on disk — a restart comes back down, with the active account and Ty's day beside it",
          psi.down_state() is not None and psi.active_account() == "adm")
    psi.PSI_TY_SECRET_FILE = real_ty
    psi._secret_state["ty"].update(stamp=None, user="", hash="", said=None)
    psi.forget_login()
    psi.PSI_LOGIN_GAP_S, psi.PSI_LOGIN_BRAKE_AFTER, psi.PSI_LOGIN_BRAKE_S = gap, brake_after, brake_s
    check("the shipped ration is minutes, not seconds",
          psi.PSI_LOGIN_GAP_S >= 120 and psi.PSI_LOGIN_BRAKE_S >= psi.PSI_LOGIN_GAP_S
          and psi.PSI_LOGIN_BRAKE_AFTER <= 3)
    psi.forget_login()
    with_secret(None)

    # ── the sentence, the note and the state are one verdict ──────────────
    for page, svc, want in ((UP_PAGE, UP_SVC, "up"),
                            (UP_PAGE, (503, ""), "down"),
                            ((404, "x"), (404, "x"), "unknown")):
        v = run(page, svc)
        printed = (v["sentence"] + " " + v["note"]).lower()
        others = {"up", "down", "unknown"} - {want}
        check(f"the sentence and the note say {want} and nothing else",
              v["state"] == want and f": {want}" in v["note"].lower()
              and not any(f": {o}" in v["note"].lower() for o in others)
              and ("is up" in printed if want == "up" else "is up" not in printed), v)
        check(f"the {want} sentence is one line a screen can print",
              "\n" not in v["sentence"] and "\n" not in v["note"]
              and v["sentence"].endswith(".") and 20 < len(v["sentence"]) < 200, v)
    v = run(UP_PAGE, UP_SVC)
    check("the verdict names its rung and its milliseconds",
          v["decided_by"] in ("page", "service", "login") and isinstance(v["ms"], int)
          and v["checked_at"].endswith("Z") and v["host"] == psi.PSI_BASE, v)

    v = run((404, "x"), (404, "x"))
    check("an `unknown` note says in words that the check could not decide",
          v["state"] == "unknown" and "could not decide" in v["note"]
          and "could not be checked from here" in v["sentence"], v)
    check("the `why` is the one clause the sentence and the note are both built on",
          v["why"] and v["why"] in v["sentence"] and v["why"] in v["note"], v)

    # ── THE CONTRACT: the exact object payload.psi carries ────────────────
    # Two halves that cannot read each other is how the first pass of this lane
    # shipped a verdict nobody consumed. The names Apps Script reads (`at`,
    # `why`, `cached`) are carried here BESIDE the names the doors and the
    # screen read, built from the same values, so neither side translates and
    # neither side prints `undefined`.
    v = run(UP_PAGE, UP_SVC)
    check("the verdict object is exactly the agreed field set",
          set(v) == {"state", "decided_by", "checked_at", "at", "ms", "why", "sentence",
                     "note", "rungs", "held", "cached", "armed", "source", "host"}, sorted(v))
    check("the Apps Script names carry the same values as the relay's own",
          v["at"] == v["checked_at"] and v["cached"] == v["held"] is False
          and v["state"] in ("up", "down", "unknown") and v["source"] == "relay", v)
    check("a rung says what it was, what it answered and how long it took",
          all({"rung", "word", "status", "ms", "why", "theirs"} <= set(r) for r in v["rungs"])
          and all(r["word"] in ("up", "refused", "failing", "stranger", "unknown")
                  for r in v["rungs"]), v["rungs"])

    # ── the cache ─────────────────────────────────────────────────────────
    first = run(UP_PAGE, UP_SVC)
    calls_after_first = len(script["calls"])
    again = loop.run_until_complete(psi.verdict())
    check("a second caller inside the hold takes the held verdict and probes nothing",
          again["held"] is True and again["cached"] is True and again["state"] == first["state"]
          and again["checked_at"] == first["checked_at"] and again["at"] == first["at"]
          and len(script["calls"]) == calls_after_first, script["calls"])
    forced = loop.run_until_complete(psi.verdict(force=True))
    check("force skips the held copy", forced["held"] is False
          and len(script["calls"]) > calls_after_first)
    check("a fresh verdict is not marked held", first["held"] is False)
    script.update(page=UP_PAGE, service=UP_SVC, stalls=0.05, calls=[])
    two = loop.run_until_complete(asyncio.gather(psi.verdict(force=True), psi.verdict(force=True)))
    check("two forces at once are still one check",
          len(script["calls"]) == 2 and two[0]["checked_at"] == two[1]["checked_at"],
          [len(script["calls"]), [v["held"] for v in two]])
    script["stalls"] = 0.0

    held_up, held_down = psi.PSI_HOLD_UP_S, psi.PSI_HOLD_DOWN_S
    psi.PSI_HOLD_UP_S, psi.PSI_HOLD_DOWN_S = 0.05, 0.05
    run(UP_PAGE, UP_SVC)
    time.sleep(0.08)
    after = loop.run_until_complete(psi.verdict())
    check("a verdict past its hold is measured again", after["held"] is False)
    psi.PSI_HOLD_UP_S, psi.PSI_HOLD_DOWN_S = held_up, held_down
    check("down is held for less time than up", psi.PSI_HOLD_DOWN_S < psi.PSI_HOLD_UP_S
          and psi.PSI_HOLD_UNKNOWN_S < psi.PSI_HOLD_DOWN_S)

    # ── one flight ────────────────────────────────────────────────────────
    script.update(page=UP_PAGE, service=UP_SVC, stalls=0.05, calls=[])
    psi.forget()
    many = loop.run_until_complete(asyncio.gather(*[psi.verdict() for _ in range(10)]))
    check("ten callers at once are one probe",
          len(script["calls"]) == 2 and len({v["checked_at"] for v in many}) == 1,
          [len(script["calls"]), [v["held"] for v in many]])
    check("the nine that waited got the answer the one made",
          all(v["state"] == many[0]["state"] for v in many))
    script["stalls"] = 0.0

    # ── the budget ────────────────────────────────────────────────────────
    budget = psi.PSI_BUDGET_S
    psi.PSI_BUDGET_S = 0.45
    started = time.monotonic()
    v = run(UP_PAGE, UP_SVC, stalls=0.3)
    spent = time.monotonic() - started
    check("a rung with no time left is skipped, not run",
          any(r.get("skipped") for r in v["rungs"]) and spent < 1.0, [spent, v])
    check("a check that ran out of time is unknown, never down",
          v["state"] in ("up", "unknown"), v)
    psi.PSI_BUDGET_S = budget
    check("the shipped budget is two seconds, and the filing's ceiling is no larger",
          psi.PSI_BUDGET_S <= 2.5 and psi.PSI_RUNG_TIMEOUT_S <= psi.PSI_BUDGET_S
          and psi.PSI_FAST_WAIT_S <= 2.5 and psi.PSI_CONNECT_TIMEOUT_S <= psi.PSI_RUNG_TIMEOUT_S,
          [psi.PSI_BUDGET_S, psi.PSI_RUNG_TIMEOUT_S, psi.PSI_FAST_WAIT_S])

    # ── the switch ────────────────────────────────────────────────────────
    psi.PSI_ARMED = False
    v = run(UP_PAGE, UP_SVC)
    check("switched off: unknown, and nothing is fetched",
          v["state"] == "unknown" and v["armed"] is False and not script["calls"], v)
    # AND THE ROW SAYS WHICH KIND OF UNKNOWN IT IS. "The check could not
    # decide" over a check that never ran reads as a lane that keeps failing,
    # and the queue row is the only place anybody will ever see this happened.
    check("switched off: the row carries the reason it was never running, not a shrug",
          "switched off" in v["why"] and "switched off" in v["note"]
          and "nothing was checked" in v["note"]
          and "could not decide" not in v["note"], [v["why"], v["note"]])
    check("/health says armed and never says what was found",
          psi.health() == {"armed": False, "held": True, "credential": False}, psi.health())
    psi.PSI_ARMED = True
    check("/health armed again", psi.health()["armed"] is True)

    # ── REAL SOCKETS: the four transport failures, told apart for real ─────
    # Nothing here leaves this machine except the two addresses that cannot be
    # reached by design: a port on loopback with nothing behind it, a loopback
    # port speaking plain text at an https:// request, an address the IETF
    # routes nowhere, and a name that does not resolve.
    base = psi.PSI_BASE
    psi.httpx = httpx  # the real client, the real network, for these four only

    shut = socket.socket()
    shut.bind(("127.0.0.1", 0))
    shut_port = shut.getsockname()[1]
    shut.close()
    psi.PSI_BASE = f"https://127.0.0.1:{shut_port}"
    psi.forget()
    started = time.monotonic()
    v = loop.run_until_complete(psi.verdict())
    spent = time.monotonic() - started
    check("a port that REFUSES the connection is down, and at once",
          v["state"] == "down" and spent < 1.0
          and all(r["word"] == "refused" for r in v["rungs"] if not r.get("skipped")),
          [round(spent, 3), v])
    check("the down sentence says down and nothing about an account",
          "down" in v["sentence"].lower() and "password" not in v["sentence"].lower(), v["sentence"])

    plain = socket.socket()
    plain.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    plain.bind(("127.0.0.1", 0))
    plain.listen(8)
    plain_port = plain.getsockname()[1]

    def speak_plain_text():
        """A server that answers an https:// request in clear HTTP: the
        handshake fails HERE, which is our trust and their certificate both,
        and never evidence of an outage."""
        for _ in range(6):
            try:
                conn, _addr = plain.accept()
            except OSError:
                return
            try:
                conn.sendall(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nhi")
                time.sleep(0.05)
            except OSError:
                pass
            finally:
                conn.close()

    threading.Thread(target=speak_plain_text, daemon=True).start()
    psi.PSI_BASE = f"https://127.0.0.1:{plain_port}"
    psi.forget()
    v = loop.run_until_complete(psi.verdict())
    check("a TLS handshake that fails here is unknown, never their outage",
          v["state"] == "unknown"
          and all(r["word"] == "unknown" for r in v["rungs"] if not r.get("skipped")), v)
    plain.close()

    psi.PSI_BASE = UNROUTABLE
    psi.forget()
    started = time.monotonic()
    v = loop.run_until_complete(psi.verdict())
    spent = time.monotonic() - started
    check("an address routed nowhere times out on OUR clock: unknown, inside the budget",
          v["state"] == "unknown" and spent <= psi.PSI_BUDGET_S + 1.0
          and all(r["word"] == "unknown" for r in v["rungs"] if not r.get("skipped")),
          [round(spent, 2), v])

    psi.PSI_BASE = NO_SUCH_NAME
    psi.forget()
    v = loop.run_until_complete(psi.verdict())
    check("a name that does not resolve is OURS: unknown, never their outage",
          v["state"] == "unknown"
          and all(r["word"] == "unknown" for r in v["rungs"]), v)
    psi.PSI_BASE = base
    psi.httpx = types.SimpleNamespace(
        AsyncClient=Stubbed, Timeout=httpx.Timeout, MockTransport=httpx.MockTransport,
        TimeoutException=httpx.TimeoutException, ConnectError=httpx.ConnectError,
        ProtocolError=httpx.ProtocolError, TransportError=httpx.TransportError)

    # ── Gate A, the one thing this module says about a call's words ────────
    check("the sniff catches the ways people say it",
          all(psi.sniff(t) for t in (
              "my psi anywhere is not working", "PSIAnywhere won't load",
              "I can't get into psy anywhere", "my time entries are missing",
              "the PSI system is down", "anywhere is not letting me log in",
              "send me the anywhere thing so I am able to clock in")))
    check("the sniff leaves an unrelated call alone",
          not any(psi.sniff(t) for t in (
              "I need a new company credit card", "I am calling off my shift tomorrow",
              "there was an incident at the house last night", "")))
    # MEASURED, over 1,678 real hotline transcripts: the bare word `anywhere`
    # fired on 97 calls and 67 of them were ordinary speech. Every one of those
    # would have started a probe on the path that files a call, so the word is
    # kept only where a login or a clock word stands beside it.
    check("the sniff does not fire on `anywhere` in ordinary speech",
          not any(psi.sniff(t) for t in (
              "he's not going anywhere", "if you drove anywhere document the mileage",
              "I can work anywhere anyway, so it doesn't matter",
              "they're not taking them anywhere other than the grocery store")))
    check("the sniff reads a dialogue's words and nothing else",
          psi.sniff(psi.dialogue_text([{"identifier": "+13309195558", "content": "hello"},
                                       {"identifier": "+13307544040", "content": "psi is down"}]))
          and psi.dialogue_text([{"identifier": "psi", "content": "hello"}]) == "hello"
          and psi.dialogue_text(None) == "" and psi.dialogue_text("psi") == "")

    # ── the doors ─────────────────────────────────────────────────────────
    # the relay's doors and its fast path ask asa-hub-app's POST /psi/health (app/attendance_loop.py), which answers
    # this module's own verdict: played here by the module itself
    async def app_door(force=False):
        return await service.psi_anywhere.verdict(force=force)

    service._psi_app_verdict = app_door

    async def gate_shut(authorization, app_id="smartcomms", **kw):
        return {"status": 403, "reason": "badge", "message": "This app is not open to you."}

    async def gate_open(authorization, app_id="smartcomms", **kw):
        return ("admin", "U1")

    service._hotline_actor = gate_shut
    answer = loop.run_until_complete(service.lane_psi_health("", "Bearer t"))
    check("the screen's door refuses a shut gate with its reason",
          answer["status"] == 403 and answer["reason"] == "badge" and "data" not in answer, answer)
    service._hotline_actor = gate_open
    psi.forget()
    script.update(page=UP_PAGE, service=UP_SVC, calls=[])
    answer = loop.run_until_complete(service.lane_psi_health("", "Bearer t"))
    check("the screen's door serves the verdict behind an open gate",
          answer["status"] == 200 and answer["data"]["state"] == "up"
          and answer["data"]["sentence"], answer)
    answer = loop.run_until_complete(service.lane_psi_health("1", "Bearer t"))
    check("?fresh=1 measures again", answer["data"]["held"] is False)

    class Body:
        def __init__(self, obj):
            self.obj = obj

        async def json(self):
            if self.obj is None:
                raise ValueError("not JSON")
            return self.obj

    service.SERVICE_SECRET = "test-service-secret"
    answer = loop.run_until_complete(service.psi_health(Body({"service_secret": "wrong"})))
    check("Apps Script's door refuses a wrong service secret",
          answer["status"] == 401 and "data" not in answer, answer)
    answer = loop.run_until_complete(service.psi_health(Body(None)))
    check("Apps Script's door refuses a body that is not JSON", answer["status"] == 401, answer)
    answer = loop.run_until_complete(service.psi_health(Body({"service_secret": "test-service-secret"})))
    check("Apps Script's door serves the verdict to the service identity",
          answer["status"] == 200 and answer["data"]["state"] in ("up", "down", "unknown"), answer)
    routes = {r.path for r in service.app.routes}
    check("both doors are routed",
          "/hub-lanes/psi/health" in routes and "/psi/health" in routes, sorted(routes)[:5])

    service.psi_anywhere = None
    answer = loop.run_until_complete(service.psi_health(Body({"service_secret": "test-service-secret"})))
    closed = loop.run_until_complete(service.lane_psi_health("", "Bearer t"))
    check("a module that did not load answers 503 at both doors, and throws at neither",
          answer["status"] == 503 and closed["status"] == 503
          and closed["reason"] == "unreadable", [answer, closed])
    service.psi_anywhere = psi

    # A DOOR THAT WILL NOT TALK TO US SAYS NOTHING ABOUT PSIANYWHERE. A reader
    # that squeezed a verdict out of a 401 or a 503 would be reading its own bad
    # luck as somebody else's outage — and this lane's 503 is the ordinary state
    # of the world between a relay restart and the module loading.
    service._hotline_actor = gate_shut
    refusals = [loop.run_until_complete(service.lane_psi_health("", "Bearer t")),
                loop.run_until_complete(service.psi_health(Body({"service_secret": "wrong"}))),
                loop.run_until_complete(service.psi_health(Body(None))),
                service._psi_shut("The PsiAnywhere check is not loaded on this server.")]
    service._hotline_actor = gate_open
    check("no refusal either door makes can be read as an outage",
          all("data" not in a and "state" not in a and "down" not in json.dumps(a).lower()
              and a["status"] in (401, 403, 503) for a in refusals), refusals)

    # /health: the three words it may say, and not one more. The lanes that
    # would read Postgres for their own vitals are stubbed — this is a test
    # about one field of that answer, and it opens no connection to anything.
    for _name, _fake in (("_ledger_depth", lambda: (0, 0, 0)),
                         ("_sheet_sync_health", lambda: {}),
                         ("_form_digest_health", lambda: {}),
                         ("_resolver_table", lambda: {}),
                         ("_traffic_snapshot", lambda: {})):
        setattr(service, _name, _fake)
    psi.forget()
    script.update(page=UP_PAGE, service=UP_SVC, calls=[])
    loop.run_until_complete(psi.verdict())
    told = loop.run_until_complete(service.health())
    check("/health says exactly {armed, held, credential} and never the verdict",
          set(told["psi"]) == {"armed", "held", "credential"}
          and told["psi"]["armed"] is True and told["psi"]["held"] is True
          and "up" not in json.dumps(told["psi"]).lower(), told["psi"])
    service.psi_anywhere = None
    told = loop.run_until_complete(service.health())
    check("/health says the same three words when the module is not loaded",
          set(told["psi"]) == {"armed", "held", "credential"}
          and told["psi"] == {"armed": False, "held": False, "credential": False}, told["psi"])
    service.psi_anywhere = psi

    class Sulk:
        armed = staticmethod(lambda: True)
        sniff = staticmethod(lambda text: True)
        dialogue_text = staticmethod(lambda turns: "psi")

        @staticmethod
        async def verdict(force=False):
            raise RuntimeError("the check itself broke")

    service.psi_anywhere = Sulk
    answer = loop.run_until_complete(service.psi_health(Body({"service_secret": "test-service-secret"})))
    check("a check that throws is a 503, never an outage", answer["status"] == 503, answer)
    got = loop.run_until_complete(service._hotline_psi_verdict({"dialogue": []}))
    check("a check that throws lets the call file with no verdict", got is None, got)
    service.psi_anywhere = psi

    # ── the fast path ─────────────────────────────────────────────────────
    psi.forget()
    script.update(page=UP_PAGE, service=UP_SVC, calls=[])
    call_psi = {"call_id": "AC" + "0" * 32, "dialogue": [
        {"identifier": "+13307544040", "content": "I cannot log into psi anywhere, it is down"}]}
    call_other = {"call_id": "AC" + "1" * 32, "dialogue": [
        {"identifier": "+13307544040", "content": "I need a replacement company card"}]}
    got = loop.run_until_complete(service._hotline_psi_verdict(call_psi))
    check("a PSI call carries a verdict", isinstance(got, dict) and got["state"] == "up", got)
    check("the fast path's verdict is the same object the doors serve",
          set(got) == {"state", "decided_by", "checked_at", "at", "ms", "why", "sentence",
                       "note", "rungs", "held", "cached", "armed", "source", "host"}, sorted(got))
    got = loop.run_until_complete(service._hotline_psi_verdict(call_other))
    check("a call about something else carries none, and costs no probe",
          got is None and len(script["calls"]) == 2, [got, script["calls"]])
    psi.PSI_ARMED = False
    got = loop.run_until_complete(service._hotline_psi_verdict(call_psi))
    check("the switch reaches the fast path too", got is None, got)
    check("the switch is read before a task is ever started",
          service._hotline_psi_start(call_psi) is None)
    psi.PSI_ARMED = True

    # THE VERDICT IS TAKEN ONCE, beside the orders: Python's filing starts the
    # check before it asks for them, and takes it once, before its one write.
    source = sources["snapshot_service"]
    filer = source[source.index("async def _hotline_python_file"):
                   source.index("async def _hotline_python_inbox")]
    check("Python's filing starts the check once, before the orders are asked of the model",
          filer.count("_hotline_psi_start(") == 1
          and filer.index("_hotline_psi_start(") < filer.index('"hotlineShadowAsk"'), filer[:200])
    check("and takes it at most once, handing it to the one write that files the call",
          filer.count("_psi_within(") == 1
          and filer.index("_psi_within(") < filer.index("_hotline_file_once(call_id, content, via, psi)"), filer[:200])

    # AND THE WEBHOOK'S OWN ANSWER IS AHEAD OF ALL OF IT. The handler puts the
    # call on the screen and answers OpenPhone with nothing awaited after the
    # filing task is scheduled — `ensure_future` only schedules, so no line of
    # the probe can run before the 200 is out.
    handler_src = source[source.index("async def _quo_hotline_event"):
                         source.index("async def _hotline_keep_call")]
    tail = handler_src[handler_src.index("_keep_task(_hotline_python_file("):]
    check("nothing the filing does can delay the webhook's own answer",
          "await" not in tail and "_publish_slice(\"hotline:calls\")" in tail
          and "return _quo_answer(200, accepted=call_id)" in tail, tail[-200:])


    # ── silence ───────────────────────────────────────────────────────────
    with_secret('{"user": "probe-user", "pass": "sup3r-s3cret-pass"}')
    v = run(UP_PAGE, [(400, ""), (200, REFUSAL_BODY)])
    hashed = hashlib.md5(b"sup3r-s3cret-pass").hexdigest()
    spoken = " ".join(said) + " " + json.dumps(v) + " " + json.dumps(psi.health())
    check("no password, no hash and no user id is in any log line, sentence, note or answer",
          "sup3r-s3cret-pass" not in spoken and hashed not in spoken
          and "probe-user" not in spoken, [s for s in said if "psi" in s.lower()][:4])
    check("the log says only whether a credential exists",
          any("has a credential" in s or "has no credential" in s for s in said),
          [s for s in said if "credential" in s])
    check("no rung's `why` ever names an account",
          not any(w in (r["why"] or "").lower() for r in v["rungs"]
                  for w in ("password", "username", "invalid user", "account")), v["rungs"])
    with_secret(None)

    print(f"\n{results['ok']} ok, {len(results['failed'])} failed")
    for name in results["failed"]:
        print("  FAILED:", name)
    return 1 if results["failed"] else 0


if __name__ == "__main__":
    if "PSI_SOURCES" in globals():
        sys.exit(main_inside())
    sys.exit(_run_in_container())
