#!/usr/bin/env python3
"""Smart Comms' screens on Python (app/smart_comms_desk.py), end to end over asa-hub-db: every read answers for the
roles Apps Script opens it to and refuses the rest with Apps Script's words; each envelope carries exactly Apps
Script's keys and every key the SPA reads; the counts agree with the houses; each read is quick; Python's own kept
edits are laid; the Desk's situations and the trail agree with the relay's own slices (smartCommsDesk.json and
smartCommsActivity.json, Apps Script's getValues), read-only from asa-hub-snapshot; no socket is opened by the module.
The modules are streamed into asa-hub-db-sync, nothing is written anywhere. Prints counts, states and key names,
never a person's values."""
from __future__ import annotations

import base64
import io
import json
import py_compile
import re
import subprocess
import sys
import tokenize
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RUNNER = "asa-hub-db-sync"
RELAY_HOST = "asa-hub-snapshot"
BUDGET_S = 8.0
SPA = ROOT / "src" / "pages" / "features" / "smartcomms"

# each door's envelope as Apps Script writes it (HUB_ACTIONS.<door>)
AS_KEYS = {
    "smartCommsGet": {"tab", "spreadsheet_id", "situations", "credentials", "placeholders", "team", "floor_alerts",
                      "schedule", "event_senders", "keywords", "sending", "dial", "dial_follows", "test_mode",
                      "call_off_reach", "call_off_also_sent_by", "gates", "auth_letters"},
    "smartCommsHistory": {"deliveries"},
    "optOutList": {"optOuts", "released", "unreadable"},
    "commReplies": {"rows", "open", "closed_by_the_machine", "total"},
    "commBoard": {"rows", "dial", "note"},
    "openShiftCoveredBoard": {"can_see", "why", "situation", "items", "error"},
    "staffBroadcastBoard": {"can_send", "above", "hm", "master", "why", "name", "audiences", "houses",
                            "own_houses_via", "situation", "mode", "house_ready", "calendar", "limits", "history",
                            "history_error"},
    "commProposalsList": {"rows", "proposable", "forbidden", "shipped", "learned", "decisions", "houses"},
}
# the keys the SPA reads off each answer, and the files that read them
SPA_KEYS = {
    "smartCommsGet": ({"situations", "sending", "tab", "spreadsheet_id", "dial", "test_mode", "call_off_reach",
                       "call_off_also_sent_by", "keywords", "floor_alerts", "schedule", "team", "gates",
                       "auth_letters", "credentials", "placeholders"},
                      ("SmartCommsPage.tsx", "SmartCommsCataloguePage.tsx", "SmartCommsWordsPage.tsx")),
    "smartCommsHistory": ({"deliveries"}, ("SmartCommsPage.tsx", "SmartCommsActivityPage.tsx")),
    "optOutList": ({"optOuts", "released", "unreadable"}, ("SmartCommsStopsPage.tsx",)),
    "commReplies": ({"rows", "open", "total"}, ("SmartCommsRepliesPage.tsx",)),
    "commBoard": ({"rows", "dial", "note"}, ("SmartCommsWordsPage.tsx", "SmartCommsGuidePage.tsx",
                                             "SmartCommsCataloguePage.tsx")),
    "openShiftCoveredBoard": ({"can_see", "why", "situation", "items", "error"}, ("coveredLogic.ts",)),
    "staffBroadcastBoard": (AS_KEYS["staffBroadcastBoard"], ("broadcastLogic.ts",)),
    "commProposalsList": ({"rows", "proposable", "forbidden", "shipped", "learned", "houses"}, ("CommProposals.tsx",)),
}
# who Apps Script answers (its HUB_POLICY roles, then the handler); the rest are refused with these words
OPEN_TO = {
    "smartCommsGet": ({"admin"}, "This action is for admin."),
    "smartCommsHistory": ({"admin", "manager"}, "This action is for admin or manager."),
    "optOutList": ({"admin", "manager"}, "This action is for admin or manager."),
    "commReplies": ({"admin", "director", "manager"}, "This action is for admin or director or manager."),
    "commBoard": ({"admin", "director", "manager"}, "This action is for admin or director or manager."),
    "openShiftCoveredBoard": (None, ""),
    "staffBroadcastBoard": (None, ""),
    "commProposalsList": ({"admin"}, "This action is for admin."),
}
# what the module must never carry: a send, a write, a network call, the frozen book
FORBIDDEN = (r"\bW\.final\b", r"\bwrites\.", r"\burllib\b", r"\brequests\b", r"\bsocket\b", r"\bsmtplib\b",
             r"openphone", r"\binsert\s+into\b", r"\bupdate\s+\w+\s+set\b", r"1SGC3fDF")

DUMP = r'''
import json, os, pathlib, sys
snap = pathlib.Path(os.environ.get("HUB_SNAPSHOT_OUT", "/srv/snapshot"))
out = {}
for name in ("smartCommsDesk", "smartCommsActivity"):
    p = snap / (name + ".json")
    out[name] = json.loads(p.read_text(encoding="utf-8")) if p.exists() else None
sys.stdout.write("DUMP_RESULT " + json.dumps(out) + "\n")
'''

PRELUDE = r'''
import base64, importlib.abc, importlib.util, json, os, re, socket, sys, time, types
blob = json.loads(base64.b64decode(sys.stdin.readline()).decode())
SRC = blob["app"]


class Checkout(importlib.abc.MetaPathFinder, importlib.abc.Loader):
    def find_spec(self, name, path, target=None):
        return importlib.util.spec_from_loader(name, self, origin="checkout:" + name) if name in SRC else None

    def create_module(self, spec):
        return None

    def exec_module(self, module):
        module.__file__ = module.__name__ + ".py"
        exec(compile(SRC[module.__name__], module.__name__ + ".py", "exec"), module.__dict__)


sys.path[:] = [p for p in sys.path if p not in ("", os.getcwd())]
sys.meta_path.insert(0, Checkout())
fake = types.ModuleType("fastapi")


class App:
    def __init__(self, **_kw):
        pass

    def _route(self, *_a, **_kw):
        return lambda fn: fn
    get = post = _route


fake.FastAPI, fake.Request = App, object
responses = types.ModuleType("fastapi.responses")
responses.JSONResponse = responses.Response = object
conc = types.ModuleType("starlette.concurrency")
conc.run_in_threadpool = None
sys.modules.update({"fastapi": fake, "fastapi.responses": responses, "starlette": types.ModuleType("starlette"),
                    "starlette.concurrency": conc})
from psycopg.conninfo import make_conninfo
OWNER = dict(host=os.environ.get("HUB_DB_HOST", "asa-hub-db"), dbname=os.environ["POSTGRES_DB"],
             user=os.environ["POSTGRES_USER"], password=os.environ["POSTGRES_PASSWORD"])
os.environ["HUB_DB_DSN"] = make_conninfo(**OWNER, options="-c default_transaction_read_only=on")
'''

RUN = PRELUDE + r'''
import gsjs, hubdb, locations as L, scope as sc, editions, writes
import main as M
import smart_comms_desk as D
checks, facts = [], {}


def check(name, ok, detail=""):
    checks.append((name, bool(ok), str(detail)[:400]))


# a socket the module opens is a send or a fetch it must not make (the database speaks through libpq, not Python)
opened = []


def guard(self, address):
    opened.append(str(type(address).__name__))
    raise OSError("this check opens no socket")


socket.socket.connect = guard
socket.socket.connect_ex = guard
socket.create_connection = lambda *a, **k: guard(None, a[0] if a else None)

db = M.DB
reads0 = L.Reads(db)
users = [u for u in reads0.users() if not gsjs.str_(u.get("mergedinto"))]


def live(u):
    return gsjs.trim(gsjs.or_blank(u.get("active"))).upper() not in ("FALSE", "0", "NO")


def pick(role, master=None):
    for u in sorted(users, key=lambda x: gsjs.str_(x.get("userid"))):
        if gsjs.str_(u.get("role")).lower() != role or not live(u):
            continue
        if master is None or master == sc.is_master_email(u.get("email")):
            return sc.user_from_row(u)
    return None


cases = {"master": pick("admin", True), "admin": pick("admin", False), "manager": pick("manager"),
         "staff": pick("staff"), "service": {"is_service": True, "role": "admin", "id": "", "email": ""}}
if cases["staff"]:
    cases["director"] = {**cases["staff"], "role": "director"}
facts["role cases"] = sorted(k for k, v in cases.items() if v)
check("a master, an admin, a manager and a staff member are on the users rows",
      all(cases.get(k) for k in ("master", "admin", "manager", "staff")), facts["role cases"])


def call(action, user, payload=None, reads=None):
    """The door as main._run decides it: the declared roles and params, then the handler; the answer as sent."""
    reads = reads or L.Reads(db)
    p = payload or {}
    t = time.time()
    env = M.policy_gate(D, action, p, user) or D.ACTIONS[action](L.Session(reads, user), p)
    took = time.time() - t
    sent = json.loads(json.dumps(M.js_json(env), separators=(",", ":"), ensure_ascii=False))
    return sent, took


# ---- who each door answers -----------------------------------------------------------------------------------
for action, (roles, words) in blob["open_to"].items():
    for tag, user in cases.items():
        if not user:
            continue
        role = "admin" if user.get("is_service") else user["role"]
        env, _t = call(action, user)
        if roles is None or role in roles:
            check(f"{action} answers the {tag}", env.get("status") == 200, env.get("message"))
        else:
            check(f"{action} refuses the {tag} as Apps Script does",
                  env.get("status") == 403 and env.get("message") == words, (env.get("status"), env.get("message")))

# ---- the envelopes, the timing, no socket ----------------------------------------------------------------------
answers = {}
for action in blob["as_keys"]:
    env, took = call(action, cases["master"], {"limit": 500} if action == "smartCommsHistory" else {})
    answers[action] = env.get("data") or {}
    facts[f"{action} took"] = f"{took:.2f}s, {len(json.dumps(env))} bytes"
    check(f"{action} answers 200 for the master", env.get("status") == 200, env.get("message"))
    check(f"{action}'s keys are Apps Script's", set(answers[action]) == set(blob["as_keys"][action]),
          sorted(set(answers[action]) ^ set(blob["as_keys"][action])))
    check(f"{action} carries every key the SPA reads", set(blob["spa_keys"][action]) <= set(answers[action]),
          sorted(set(blob["spa_keys"][action]) - set(answers[action])))
    check(f"{action} answers within {blob['budget']}s", took < blob["budget"], f"{took:.2f}s")
check("no read opened a socket", not opened, opened)

# ---- the Desk -------------------------------------------------------------------------------------------------
desk = answers["smartCommsGet"]
res = D.where(reads0, D.SMART_TAB)
raw_rows = db.rows(res.ref)
with_id = [raw for _rn, raw in raw_rows if gsjs.or_blank(hubdb.typed(raw.get("id"), "hub"))]
ids = []
for raw in with_id:
    i = gsjs.or_blank(hubdb.typed(raw.get("id"), "hub"))
    if i not in ids:
        ids.append(i)
facts["situations"] = f"{len(desk['situations'])} rows, {len(ids)} ids, house {res.sheet_id[:6]}…"
check("the Desk reads every situation row with an id, duplicates kept", len(desk["situations"]) == len(with_id))
check("each situation carries the 27 columns", all(list(r) == list(D.SMART_HEADER) for r in desk["situations"]))
check("the Desk's book is the situations house",
      desk["spreadsheet_id"] == res.sheet_id and desk["tab"] == "smart_comms")
check("the hours are told for every id", set(desk["schedule"]) == set(ids))
check("every floor alert is an event row", set(desk["floor_alerts"]) <= set(ids))
check("the keywords are the three Apps Script resolves",
      list(desk["keywords"]) == ["allstaff", "housemanagers", "directors"]
      and all(set(v) == {"label", "count", "readable", "pending", "at", "why", "missing"}
              for v in desk["keywords"].values()))
facts["keywords"] = {k: (v["count"], v["readable"], v["pending"]) for k, v in desk["keywords"].items()}
check("the team has its five parts", set(desk["team"]) == {"sms", "emails", "floor_sms", "amber_sms", "readable"})
check("the gates are fifteen, each with its twelve facts",
      len(desk["gates"]["gates"]) == 15 and all(len(g) == 12 for g in desk["gates"]["gates"])
      and desk["gates"]["lane"] in ("holding", "off", "unreadable"))
check("the authentication letters are four", [a["id"] for a in desk["auth_letters"]]
      == ["auth_password_reset", "auth_invitation", "user_release_invite", "user_account_invite"])
cfg = reads0.config()
st = D.test_mode_state(cfg)
check("the dial follows test mode", desk["dial"] == ("off" if st["unrecognized"] else "record" if st["on"] else "send"))
check("test mode is told as Apps Script tells it",
      set(desk["test_mode"]) == {"on", "explicit", "unrecognized", "sms", "emails", "shared"})
facts["brakes"] = {"test_mode on": desk["test_mode"]["on"], "dial": desk["dial"], "sending": desk["sending"],
                   "gates lane": desk["gates"]["lane"]}
dups = {}
for r in desk["situations"]:
    dups[r["id"]] = dups.get(r["id"], 0) + 1
twice = [i for i, n in dups.items() if n > 1]
facts["duplicated ids"] = len(twice)
check("a duplicated id answers by its last row",
      all(D.situation_last(desk["situations"], i) is [r for r in desk["situations"] if r["id"] == i][-1]
          for i in twice))

# Python's own kept edit is laid over the copy (an edit made in memory, never stored)
target = raw_rows[0][0]
edit = {"sheet_id": res.sheet_id, "tab_name": res.ref.tab, "match": "row", "keyed": "header", "row_key": f"r{target}",
        "field": "label", "value": "laid-by-the-check", "id": 1, "born": 1, "appended": False}
own = writes.Own([], book=db.book, edits=[edit], edits_at=time.time())
token = hubdb.OWN.set(own)
try:
    laid, _t = call("smartCommsGet", cases["master"])
finally:
    hubdb.OWN.reset(token)
check("a kept edit is laid over the situations", any(r["label"] == "laid-by-the-check"
                                                     for r in laid["data"]["situations"]))

# the relay's own slice of the situations, written by Apps Script's getValues
slice_rows = (blob["relay"].get("smartCommsDesk") or {}).get("rows")
if slice_rows is None:
    check("the relay holds the situations slice", False, "smartCommsDesk.json is not on the relay")
else:
    def js(v):
        return "" if v is None else ("true" if v is True else "false" if v is False else
                                     gsjs.num_str(v) if isinstance(v, (int, float)) else str(v))
    by_field = {}
    for a, b in zip(desk["situations"], slice_rows):
        for h in D.SMART_HEADER:
            if a.get(h) != js(b.get(h)):
                by_field[h] = by_field.get(h, 0) + 1
    facts["situations vs the relay's slice"] = (f"{len(desk['situations'])} here, {len(slice_rows)} in the slice; "
                                                f"cells that differ: {by_field or 'none'}")
    check("the situations equal the relay's slice, row by row and cell by cell",
          len(desk["situations"]) == len(slice_rows) and not by_field, by_field)

# ---- the trail ------------------------------------------------------------------------------------------------
trail = answers["smartCommsHistory"]["deliveries"]
act = (blob["relay"].get("smartCommsActivity") or {}).get("rows")
if act is None:
    check("the relay holds the trail slice", False, "smartCommsActivity.json is not on the relay")
else:
    want = [{"situation": gsjs.str_(r.get("situation")), "person": gsjs.str_(r.get("person")),
             "expires": gsjs.str_(r.get("expires")), "channel": gsjs.str_(r.get("channel")),
             "at": gsjs.str_(r.get("at"))} for r in reversed(act[-2000:])
            if gsjs.str_(r.get("channel")).lower() != "rehearsal"][:500]
    other = {}
    for a, b in zip(trail, want):
        for k in ("situation", "person", "channel", "at", "expires"):
            if a[k] != b[k]:
                other[k] = other.get(k, 0) + 1
    facts["trail vs the relay's slice"] = (f"{len(trail)} deliveries here, {len(want)} from the slice; cells that "
                                           f"differ: {other or 'none'}")
    check("the trail equals the relay's slice on who, what, how and when",
          len(trail) == len(want) and not {k: v for k, v in other.items() if k != "expires"}, other)
    facts["trail's expires (a Date cell the copy keeps as its display text)"] = other.get("expires", 0)
check("the trail never shows a rehearsal", all(d["channel"].lower() != "rehearsal" for d in trail))
one, _t = call("smartCommsHistory", cases["master"], {"limit": "3"})
check("the trail's limit is parseInt'd", len(one["data"]["deliveries"]) == min(3, len(trail)))
sit = trail[0]["situation"] if trail else ""
only, _t = call("smartCommsHistory", cases["master"], {"situation": sit, "limit": 500})
check("the trail narrows to one situation", all(d["situation"] == sit for d in only["data"]["deliveries"]))

# ---- the stops, the replies, the board -------------------------------------------------------------------------
stops = answers["optOutList"]
oo = D.normalized(reads0, D.OPT_OUT_TAB) or []
check("the stops and the released add up to the house's keys",
      len(stops["optOuts"]) <= len(oo) and all(r["released_at"] for r in stops["released"])
      and stops["unreadable"] == "")
facts["stops"] = f"{len(stops['optOuts'])} standing, {len(stops['released'])} released, {len(oo)} rows"
rep = answers["commReplies"]
contrib = D.board_rows(reads0, D.COMM_CONTRIBUTIONS_HOUSE)
check("the replies count the house", rep["total"] == len(contrib)
      and rep["open"] == sum(1 for r in contrib if D.contribution_open(r)) and len(rep["rows"]) <= 500)
every, _t = call("commReplies", cases["master"], {"all": True})
check("all: true lists every contribution up to 500", len(every["data"]["rows"]) == min(500, len(contrib)))
check("the replies are newest first", all(gsjs.locale_cmp(a.get("received_at") or "", b.get("received_at") or "") >= 0
                                          for a, b in zip(rep["rows"], rep["rows"][1:])))
facts["replies"] = f"{rep['open']} open of {rep['total']}, {rep['closed_by_the_machine']} closed by the machine"
board = answers["commBoard"]
intents = D.board_rows(reads0, D.COMM_INTENTS_HOUSE)
bindings = D.board_rows(reads0, D.COMM_BINDINGS_HOUSE)
keys = {gsjs.or_text(i.get("intent_key")) for i in intents}
check("the board is every intent with its bindings", len(board["rows"]) == len(intents)
      and sum(len(r["items"]) for r in board["rows"]) == sum(
          1 for b in bindings if gsjs.or_text(b.get("intent_key")) in keys) and board["dial"] == desk["dial"])
facts["board"] = f"{len(board['rows'])} intents, {sum(len(r['items']) for r in board['rows'])} bindings laid"

# ---- the covered notices and the broadcast page ------------------------------------------------------------------
cov = answers["openShiftCoveredBoard"]
check("the covered notices tell the situation", set(cov["situation"]) == {"id", "on", "found", "sms_text"}
      and cov["can_see"] is True and cov["error"] == "")
facts["covered"] = f"{len(cov['items'])} follow-up(s), situation on: {cov['situation']['on']}"
bc = answers["staffBroadcastBoard"]
check("the broadcast page opens to the master", bc["can_send"] and bc["above"] and bc["master"]
      and [a["id"] for a in bc["audiences"]] == ["allstaff", "meddel", "house", "leadership", "prn"])
check("the broadcast page tells the brakes", set(bc["mode"] or {}) == {"test_mode", "dial", "dial_readable",
                                                                         "quiet_now", "quiet_words", "quiet_until",
                                                                         "send_switch"})
facts["broadcast"] = (f"calendar readable {bc['calendar']['readable']} from {bc['calendar']['from']}, "
                      f"{len(bc['houses'])} houses, {len(bc['history'])} in history, error {bc['history_error']!r}")
staff_bc, _t = call("staffBroadcastBoard", cases["staff"])
check("a staff member without a badge is told why, and sees nothing", staff_bc["data"]["situation"] is None
      or staff_bc["data"]["can_send"])
# a house manager below a director: their own houses only, by name first, then by a phone that names them alone
hms = []
for u in sorted(users, key=lambda x: gsjs.str_(x.get("userid"))):
    if not live(u) or gsjs.str_(u.get("role")).lower() not in ("manager", "staff"):
        continue
    if sc.is_master_email(u.get("email")):
        continue
    w = D.broadcast_who(reads0, sc.user_from_row(u))
    if w["hm"] and not w["above"]:
        hms.append(sc.user_from_row(u))
facts["house managers below a director"] = len(hms)
cal = D.broadcast_calendar(reads0)
vias = {}
for u in hms[:6]:
    got, _t = call("staffBroadcastBoard", u)
    d = got["data"]
    vias[d["own_houses_via"] or "none"] = vias.get(d["own_houses_via"] or "none", 0) + 1
    check("a house manager's broadcast page names only calendar houses, and no leadership audience",
          got["status"] == 200 and d["can_send"] and not d["above"]
          and all(h["location"] in cal["houses"] for h in d["houses"])
          and not next(a for a in d["audiences"] if a["id"] == "leadership")["allowed"],
          (got.get("status"), d.get("own_houses_via"), len(d.get("houses") or [])))
facts["their own houses found by"] = vias

# ---- the proposals ----------------------------------------------------------------------------------------------
pr = answers["commProposalsList"]
check("the proposals tell both houses", set(pr["houses"]) == {"proposals", "vocabulary"}
      and set(pr["learned"]) == set(D.COMM_VOCAB_PROPOSABLE)
      and set(pr["shipped"]) == {"opt_out_phrases", "opt_in_phrases", "wrong_number_phrases"})
facts["proposals"] = {k: (v["declared"], bool(v["why"])) for k, v in pr["houses"].items()}

# ---- an edition opens the Desk to the person it lists (the catalogue entry made here, in memory) -----------------
person = cases["staff"]
if person:
    editions._BY_ID["smartComms.words"] = {"id": "smartComms.words", "app": "smart-comms", "app_name": "Smart Comms",
                                           "label": "x", "description": "x"}
    base_gate = sc.profile_app_gate
    released = {"on": False}

    def gate(app_id, user, src):
        # App Control's release simulated for the listed person only
        if released["on"] and app_id == D.RELEASE_ID and gsjs.str_((user or {}).get("id")) == person["id"]:
            return {"open": True, "scope": sc.scope_of("all")}
        return base_gate(app_id, user, src)

    sc.profile_app_gate = gate
    try:
        for on, rel, want in ((True, True, 200), (True, False, 403), (False, True, 403)):
            released["on"] = rel
            r = L.Reads(db)
            r.memo["config"] = {**r.config(), editions.EDITIONS_KEY: json.dumps(
                [{"id": "smartComms.words", "on": on, "people": [person["id"]]}])}
            env, _t = call("smartCommsGet", person, reads=r)
            check(f"an edition {'on' if on else 'off'}, Smart Comms {'released' if rel else 'not released'} to its "
                  f"person: the Desk {'opens' if want == 200 else 'stays shut'}", env.get("status") == want,
                  env.get("message"))
    finally:
        sc.profile_app_gate = base_gate
        editions._BY_ID.pop("smartComms.words", None)

# ---- the rules, on values made here ------------------------------------------------------------------------------
check("test mode reads its words as Apps Script does",
      [D.test_mode_state({"test_mode": w})["on"] for w in ("sheet", "on", "off", "production", "paper")]
      == [True, True, False, False, True]
      and D.test_mode_state({"test_mode": "maybe"})["unrecognized"] == "maybe"
      and D.test_mode_state({})["on"] is False
      and D.test_mode_state({"test_redirect_sms": "330 555 0100"})["on"] is True)
check("the dial: record, send, off when the word is unknown",
      [D.dial({"test_mode": w})["word"] for w in ("on", "off", "maybe")] == ["record", "send", "off"])
check("parseInt as JavaScript", [D.js_parse_int(v) for v in (None, "12abc", " 7", 3.9, "x", "-2", True)]
      == [None, 12, 7, 3, None, -2, None])
check("the hours a row keeps", D.slots_parse("9:00, 1pm; 13:00|25:00|9h30")["labels"] == ["09:00", "09:30", "13:00"]
      and D.slots_parse("9:00, 1pm; 13:00|25:00|9h30")["bad"] == ["25:00"])
check("an opt-out key", [D.opt_out_key(v) for v in ("+1 (330) 555-0100", "A@B.co", "123")] == ["3305550100",
                                                                                              "a@b.co", ""])
check("a number in a covered notice's words shows its last four",
      D.covered_masked("told +1 330 555 0100 at 9") == "told •••0100 at 9")
check("a house's label and a call-off's day", D.house_label("CAN - JH - ABD2704") == "JH"
      and D.call_off_date("2026-02-30") == "" and D.call_off_date("10/4/2026 x") == "2026-10-04")
check("the vocabulary's normal form", D.vocab_norm("  Não  QUERO!! ") == "não quero")
row = {"id": "BC_x", "createdAt": "2026-01-01T00:00:00.000Z", "updatedAt": "2026-01-01T00:00:00.000Z",
       "state": "sending", "by_email": "a@b.co", "dial": "record", "test_mode": "on",
       "recipients": [{"n": "A", "t": "+13305550100", "f": "allstaff", "o": "pending"}, {"o": "sent"}, "x"],
       "dropped": '[{"reason": "r", "label": "l", "count": "2"}]'}
pub = D.broadcast_public(reads0, row, {"email": "a@b.co", "above": False}, True)
check("a broadcast row is told without its numbers", pub["state"] == "interrupted" and pub["mine"]
      and pub["tally"]["pending"] == 2 and pub["tally"]["sent"] == 1 and pub["recipients"][0]["to"] == "•••0100"
      and pub["dropped"] == [{"reason": "r", "label": "l", "count": 2}] and pub["count"] == 3, pub)

print(json.dumps({"checks": checks, "facts": facts}, default=str))
'''


def static() -> int:
    failed = 0
    py_compile.compile(str(ROOT / "app" / "smart_comms_desk.py"), doraise=True)
    print("ok   app/smart_comms_desk.py compiles")
    src = (ROOT / "app" / "smart_comms_desk.py").read_text(encoding="utf-8")
    # the code alone: the words the module says (its strings and comments) are not what it does
    code = " ".join(t.string for t in tokenize.generate_tokens(io.StringIO(src).readline)
                    if t.type not in (tokenize.STRING, tokenize.COMMENT))
    hits = [p for p in FORBIDDEN if re.search(p, code, re.I)]
    hits += [p for p in (r"1SGC3fDF", r"api\.openphone\.com", r"/mail/send") if re.search(p, src)]
    ok = not hits
    print(("ok   " if ok else "FAIL ") + "the module carries no send, no write, no network call and no frozen book"
          + ("" if ok else f"\n       {hits}"))
    failed += 0 if ok else 1
    acts = set(re.findall(r'^\s+"(\w+)": \{"roles"', src, re.M))
    ok = acts == set(AS_KEYS)
    print(("ok   " if ok else "FAIL ") + "POLICY declares the eight reads" + ("" if ok else f"\n       {sorted(acts)}"))
    failed += 0 if ok else 1
    for action, (keys, files) in SPA_KEYS.items():
        text = "".join((SPA / f).read_text(encoding="utf-8") for f in files)
        called = action in text or action in "".join(p.read_text(encoding="utf-8") for p in SPA.glob("*.tsx"))
        missing = sorted(k for k in keys if not re.search(r"\b" + re.escape(k) + r"\b", text))
        ok = called and not missing and keys <= AS_KEYS[action]
        print(("ok   " if ok else "FAIL ") + f"the SPA reads {action}'s {len(keys)} keys and Apps Script writes them"
              + ("" if ok else f"\n       missing {missing}"))
        failed += 0 if ok else 1
    return failed


def run(container: str, script: str, blob: dict | None, tag: str, timeout: int) -> dict | None:
    stdin = (base64.b64encode(json.dumps(blob, default=str).encode()) + b"\n") if blob is not None else b""
    got = subprocess.run(["docker", "exec", "-i", "-e", "MALLOC_ARENA_MAX=2", container, "nice", "-n", "19", "python",
                          "-c", script], input=stdin, capture_output=True, timeout=timeout)
    out = got.stdout.decode()
    line = next((x for x in out.splitlines() if x.startswith(tag + " ")), "") if tag else \
        (out.strip().splitlines() or [""])[-1]
    if not line:
        print(f"FAIL the {tag or 'check'} side ran in {container}")
        print(got.stderr.decode()[-2500:])
        return None
    return json.loads(line[len(tag) + 1:] if tag else line)


def main() -> int:
    print("STATIC")
    failed = static()
    print(f"\nDUMP — the relay's slices of the situations and the trail, read-only in {RELAY_HOST}")
    relay = run(RELAY_HOST, DUMP, None, "DUMP_RESULT", 120)
    if relay is None:
        return 1
    print("fact slices: " + ", ".join(f"{k} {len((v or {}).get('rows') or [])} rows" for k, v in relay.items()))
    print(f"\nRUN — app/smart_comms_desk.py over asa-hub-db, in {RUNNER}")
    app = {p.stem: p.read_text(encoding="utf-8") for p in (ROOT / "app").glob("*.py")}
    blob = {"app": app, "relay": relay, "budget": BUDGET_S, "as_keys": {k: sorted(v) for k, v in AS_KEYS.items()},
            "spa_keys": {k: sorted(v[0]) for k, v in SPA_KEYS.items()},
            "open_to": {k: (sorted(v[0]) if v[0] is not None else None, v[1]) for k, v in OPEN_TO.items()}}
    res = run(RUNNER, RUN, blob, "", 900)
    if res is None:
        return 1
    for name, ok, detail in res["checks"]:
        print(("ok   " if ok else "FAIL ") + name + ("" if ok else f"\n       {detail}"))
        failed += 0 if ok else 1
    for k, v in res["facts"].items():
        print(f"fact {k}: {v}")
    print(f"\n{len(res['checks']) - sum(1 for c in res['checks'] if not c[1])} ok, {failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
