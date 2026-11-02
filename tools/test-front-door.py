#!/usr/bin/env python3
"""asa-hub-app's front door (app/front_door.py) against the relay it stands in front of (server/snapshot_service.py),
lifted and run side by side: the routes read off the relay are current and keep every relay rung on the relay; the
guards answer word for word as the relay's on the same bodies, in both shapes and at any size; the session gate holds
Python's verdict briefly and never past a switched session's end; the identity is the relay's _backend_user and
_acting_user; reads, writes and the sign-in are dispatched with the relay's receipts, write ids, voids and finish; what
is not owned goes to the relay unchanged; and the relay's finish (server/front_door_finish.py) runs _backend_answer's,
_backend_write's and _auth_py_answer's tails and gas_relay's observers in their order."""
import ast
import asyncio
import contextvars
import importlib.util
import json
import re
import sys
import tempfile
import time
import types
import urllib.parse
from pathlib import Path
from typing import Any

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parent.parent
RELAY_SRC = (ROOT / "server" / "snapshot_service.py").read_text(encoding="utf-8")
FINISH_SRC = (ROOT / "server" / "front_door_finish.py").read_text(encoding="utf-8")
results = {"ok": 0, "failed": []}


def check(name: str, ok: bool, detail: Any = None) -> None:
    if ok:
        results["ok"] += 1
        print(f"  ok   {name}")
    else:
        results["failed"].append(name)
        print(f"  FAIL {name}")
        if detail is not None:
            print(f"       {str(detail)[:600]}")


def load(name: str, path: Path) -> Any:
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


def run(coro: Any) -> Any:
    return asyncio.run(coro)


class _Log:
    def __init__(self) -> None:
        self.lines: list[str] = []

    def info(self, msg: str, *a: Any) -> None:
        self.lines.append(msg % a if a else msg)

    warning = info
    exception = info


# ---- the stand-ins the two modules import ---------------------------------------------------------------------------

class Resp:
    """fastapi's Response as both modules build it."""

    def __init__(self, content: Any = None, status_code: int = 200, media_type: str | None = None,
                 headers: dict | None = None) -> None:
        self.body = content if isinstance(content, bytes) else (content or b"")
        self.status_code, self.media_type, self.headers = status_code, media_type, dict(headers or {})


class Defer(Exception):
    pass


class Unreadable(Exception):
    pass


class HandBack(Defer):
    pass


async def _threadpool(fn: Any, *a: Any, **k: Any) -> Any:
    return fn(*a, **k)


def _mod(name: str, **attrs: Any) -> types.ModuleType:
    m = types.ModuleType(name)
    m.__dict__.update(attrs)
    sys.modules[name] = m
    return m


MASTER = "asatech@asalifecare.com"
_mod("fastapi", Request=object, FastAPI=object)
_mod("fastapi.responses", Response=Resp, JSONResponse=Resp)
_mod("starlette", )
_mod("starlette.concurrency", run_in_threadpool=_threadpool)
gsjs = load("gsjs", ROOT / "app" / "gsjs.py")
_mod("hubdb", Unreadable=Unreadable, OWN=contextvars.ContextVar("own", default=None))
_mod("scope", Defer=Defer, MASTER_ACCOUNT=MASTER,
     is_master_email=lambda e: str(e or "").strip().lower() == MASTER)
_mod("locations", Reads=lambda *a, **k: types.SimpleNamespace(users=lambda: USERS))
_mod("app_control", delegates_read=lambda reads: DELEGATES)
_mod("smart_comms", void_write=lambda conn, wid: VOIDED.append(("texts", wid)))
_mod("sys_log", void=lambda store, wid: VOIDED.append(("lines", wid)))
_mod("auth_doors", SESSION=frozenset({"beAnotherList", "beAnotherStart", "beAnotherStop"}), HandBack=HandBack,
     Context=lambda *a: None, run=lambda action, body, ctx: VERDICTS[body["token"]]())
USERS: list[dict] = [{"userid": "u-master", "email": MASTER}, {"userid": "u-other", "email": "o@x.org"}]
DELEGATES: list[dict] = [{"id": "u-writer", "may_change": True, "apps": ["staff"]}]
VOIDED: list[tuple] = []
VERDICTS: dict[str, Any] = {}

tmp = Path(tempfile.mkdtemp())
import os  # noqa: E402

os.environ.update(HUB_APP_PACK_DIR=str(tmp), HUB_SNAPSHOT_MANIFEST=str(tmp / "manifest.json"))
fd = load("front_door", ROOT / "app" / "front_door.py")
fd.log = _Log()
fd.M = types.SimpleNamespace(DB=None, DRIVE=None, TOKEN="t")
gen = load("emit_front_door_routes", ROOT / "tools" / "emit-front-door-routes.py")
tree, rns = gen.relay_namespace(RELAY_SRC)
rlog = _Log()
rns.update(log=rlog, asyncio=asyncio, urllib=urllib, Request=Any)

# ---- the routes ----------------------------------------------------------------------------------------------------
print("the routes, read off the relay")
built = gen.build(RELAY_SRC)
check("front_door_routes.json is the relay's as it stands (tools/emit-front-door-routes.py)",
      gen.dump(built) == (ROOT / "app" / "front_door_routes.json").read_text(encoding="utf-8"))
apps = rns["BACKEND_APPS"]
lane_reads = {a for s in apps.values() if s.get("lane") for a in s.get("lane_reads", s["reads"])}
lane_writes = {a for s in apps.values() for a in s.get("lane_writes", ())}
check("no lane read is answered from a screen's envelope", not lane_reads & fd.HERE_READS, lane_reads & fd.HERE_READS)
check("no lane write is answered from a screen's envelope", not lane_writes & fd.HERE_WRITES)
here = fd.HERE_READS | fd.HERE_WRITES | fd.HERE_AUTH
check("no relay rung is answered here", not here & fd.RELAY_FIRST, here & fd.RELAY_FIRST)
check("no door the relay follows is answered here",
      not here & (fd.RELAY_SHAPED - set(fd.PREPARE) - set(fd.PREREAD)))
check("the writes a preparation alone shapes are answered here, the world's and the place's among them",
      {"worldEnsure", "tenantEnsure"} <= fd.HERE_WRITES and {a for a in fd.PREPARE if a in fd.FINAL} <= fd.HERE_WRITES)
check("the writes a preread alone shapes are answered here, the finance receipts",
      {"finSubmitTransaction", "finAttachReceipt"} <= fd.HERE_WRITES & set(fd.PREREAD)
      and set(fd.PREREAD.values()) == {"finReceiptRead"}, fd.PREREAD)
check("every write answered here is final", fd.HERE_WRITES <= fd.FINAL)
check("the held doors stay the relay's", not here & set(fd.HOLD))
check("the relay's own rungs are all read (chat, editions, bundles, uploads, public doors)",
      {"chatSend", "editionsSet", "snapshotBundleBuild", "certDocUpload", "formPublicGet", "candidateProfileDoor",
       "hiringAlertsSet", "masterOverview", "smartCommsRun"} <= fd.RELAY_FIRST)
check("no write hands itself to Apps Script any more: the account writes are Python's, answered here",
      not any(s.get("hands") for s in apps.values())
      and {"profileUpdate", "userUpdate", "releaseUser"} <= fd.HERE_WRITES - fd.RELAY_SHAPED)
check("the sign-in is answered here but its two endings",
      fd.HERE_AUTH == fd.AUTH_DOORS - {"authLogout", "beAnotherStop"})
print(f"       {len(fd.HERE_READS)} reads, {len(fd.HERE_WRITES)} writes and {len(fd.HERE_AUTH)} sign-in doors here; "
      f"{len(fd.RELAY_FIRST)} relay rungs and {len(fd.RELAY_SHAPED)} relay-shaped doors carried")
finish_mod = load("front_door_finish", ROOT / "server" / "front_door_finish.py")
loop_calls: list[str] = []
gas_fn = next(n for n in tree.body if isinstance(n, ast.AsyncFunctionDef) and n.name == "gas_relay")
for node in ast.walk(gas_fn):
    if isinstance(node, ast.Try):
        names = [s.value.func.id for s in node.body if isinstance(s, ast.Expr) and isinstance(s.value, ast.Call)
                 and isinstance(s.value.func, ast.Name)]
        if "_relay_observe_auth" in names and "_relay_observe_scheduling" in names and len(names) > len(loop_calls):
            loop_calls = names
finish_src = (ROOT / "server" / "front_door_finish.py").read_text(encoding="utf-8")
asked = {n.slice.value for n in ast.walk(ast.parse(finish_src)) if isinstance(n, ast.Subscript)
         and isinstance(n.value, ast.Name) and n.value.id == "ns" and isinstance(n.slice, ast.Constant)}
asked |= {name for name, _ in finish_mod.LOOP} | {"HUB_APP_TOKEN"}
defined = {n.name for n in tree.body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))}
defined |= {t.id for n in tree.body if isinstance(n, ast.Assign) for t in n.targets if isinstance(t, ast.Name)}
defined |= {n.target.id for n in tree.body if isinstance(n, ast.AnnAssign) and isinstance(n.target, ast.Name)}
defined |= {(a.asname or a.name).split(".")[0] for n in tree.body if isinstance(n, (ast.Import, ast.ImportFrom))
            for a in n.names}
check("every name the finish reads off the relay is one the relay defines", asked <= defined, sorted(asked - defined))
check("the finish runs gas_relay's answer observers in their order, but the master's sign-in tries",
      [n for n in loop_calls if n not in finish_mod.LOOP_LEFT_OUT] == [n for n, _ in finish_mod.LOOP]
      and set(loop_calls) - {n for n, _ in finish_mod.LOOP} == set(finish_mod.LOOP_LEFT_OUT), loop_calls)


# ---- the envelopes --------------------------------------------------------------------------------------------------

def form(action: str, payload: Any, token: str = "tok", **extra: Any) -> bytes:
    return urllib.parse.urlencode({"body": json.dumps({"token": token, "action": action, "payload": payload,
                                                       **extra})}).encode()


def plain(action: str, payload: Any, token: str = "tok", **extra: Any) -> bytes:
    return json.dumps({"token": token, "action": action, "payload": payload, **extra}).encode()


def env_of(raw: bytes) -> dict:
    return fd.read_envelope(raw)[0] or {}


# ---- the session stand-ins, one table for both sides ----------------------------------------------------------------
SESS = {
    "master-tok": fd.Session(ok=True, role="admin", uid="u-master", is_master=True),
    "admin-tok": fd.Session(ok=True, role="admin", uid="u-admin"),
    "writer-tok": fd.Session(ok=True, role="manager", uid="u-writer"),
    "tok": fd.Session(ok=True, role="staff", uid="u-staff"),
    "child": fd.Session(ok=True, role="staff", uid="u-t", acting=True, worn="Ana Lima", until=time.time() + 3600),
    "dead": fd.Session(ok=False),
}


async def fake_session(token: str) -> Any:
    return SESS.get(token)


fd.session = fake_session
fd.master_account_ids = lambda: frozenset({"u-master"})


async def relay_master(authorization: str) -> tuple[bool, str]:
    s = SESS.get(authorization[7:])
    return bool(s and s.master), ""


rns["_app_pack_master"] = relay_master
rns["_master_account_ids"] = lambda: frozenset({"u-master"})
rns["_acting"] = {t: (s.until, "u-master", s.uid) for t, s in SESS.items() if s.acting}
rns["_token_user"] = {t: (0.0, s.uid, s.worn) for t, s in SESS.items() if s.acting}
rns["_auth_cache"] = {t: (time.time(), s.ok, s.role, s.uid) for t, s in SESS.items()}
masters = {t: s.is_master for t, s in SESS.items() if s.ok}

print("the guards answer as the relay's, on the same bodies")
cases = [("userUpdate", {"user_id": "u-master", "role": "staff"}), ("userDelete", {"user_id": "u-master"}),
         ("userActivate", {"user_id": "  u-master "}), ("releaseUser", {"user_id": "u-master"}),
         ("usersArm", {"user_ids": ["u-other", "u-master"]}), ("userInvite", {"user_ids": ["u-master"]}),
         ("usersContactMergeApply", {"user_ids": ["u-master"]}),
         ("userMergeManual", {"keep_id": "u-other", "fold_ids": ["u-master"]}),
         ("userUpdate", {"user_id": "u-other"}), ("usersArm", {"user_ids": []}), ("prefsSet", {"x": 1}),
         ("platformMemberAsk", {"email": " ASATECH@asalifecare.com "}), ("platformMemberAsk", {"email": "a@b.co"})]
same = []
for action, payload in cases:
    for token, extra in (("tok", {}), ("master-tok", {}), ("master-tok", {"member": "mem_1"}), ("admin-tok", {})):
        for build in (form, plain):
            raw = build(action, payload, token, **extra)
            relay = run(rns["_master_account_refusal"](raw))
            mine = run(fd.master_account_refusal(env_of(raw)))
            same.append((action, token, extra, build.__name__, relay == mine, relay, mine))
bad = [s for s in same if not s[4]]
check(f"the master's account writes and the ask: {len(same)} bodies answered alike", not bad, bad[:3])
padded = form("userDelete", {"user_id": "u-master", "pad": "x" * 300_000})
check("a padded body is read whole and refused alike",
      run(rns["_master_account_refusal"](padded)) == run(fd.master_account_refusal(env_of(padded)))
      == {"status": 404, "message": 'No user "u-master".'})
fd.master_account_ids = lambda: (_ for _ in ()).throw(RuntimeError("down"))
check("an unreadable users copy holds the write, in the relay's words",
      run(fd.master_account_refusal(env_of(form("userDelete", {"user_id": "u-other"})))) == fd.ACCOUNTS_UNREAD
      == {"status": 503, "message": "The accounts could not be read — try again."})
fd.master_account_ids = lambda: frozenset({"u-master"})
escaped = form("userDelete", {"user_id": "u-master"}).replace(b"userDelete", b"%5Cu0075serDelete")
check("an action spelt with a JSON escape is still read as doPost reads it, by the app and by the relay alike",
      run(fd.master_account_refusal(env_of(escaped))) is not None
      and run(rns["_master_account_refusal"](escaped)) is not None)

same = []
for action, payload, resource in (("prefsSet", {}, ""), ("questionnaireSubmit", {}, ""), ("smartCommsSet", {}, ""),
                                  ("userUpdate", {}, ""), ("masterOverview", {}, ""), ("beAnotherStart", {}, ""),
                                  ("create", {}, "marEntries"), ("update", {}, "policyAcks"),
                                  ("list", {}, "marEntries"),
                                  ("beAnotherStop", {}, ""), ("taskBoardSave", {}, ""), ("chatSend", {}, ""),
                                  ("certDocUpload", {"file": "x" * 200_000}, "")):
    for token in ("child", "master-tok", "tok"):
        for build in (form, plain):
            raw = build(action, payload, token, **({"resource": resource} if resource else {}))
            relay = rns["_acting_refusal"](raw)
            mine = run(fd.switched_refusal(env_of(raw)))
            same.append((action, token, build.__name__, relay == mine, relay, mine))
bad = [s for s in same if not s[3]]
check(f"a switched session's refusals: {len(same)} bodies answered alike, word for word", not bad, bad[:3])
check("a switched session is refused in Apps Script's words",
      run(fd.switched_refusal(env_of(form("prefsSet", {}, "child")))) ==
      {"status": 409, "code": "be_another_refused",
       "message": "Not while acting as Ana Lima: saving their preferences. Press Be Back to do this as yourself."})

same = []
for action, payload in (("appBadgeAccessSet", {"x": 1}), ("appTenantAccessSet", {}),
                        ("appAccessSetBulk", {"rules": {}}), ("appAccessSetBulk", {"rules": {"a": 1}}),
                        ("appAccessSetBulk", {"tenants": [1]}),
                        ("prefsSet", {})):
    for token in ("tok", "master-tok", "writer-tok", "child", "dead", "nobody"):
        raw = form(action, payload, token)
        relay = rns["_relay_app_access_refusal"](raw, masters, lambda t: t == "writer-tok")
        mine = run(fd.app_access_refusal(env_of(raw)))
        same.append((action, token, relay == mine, relay, mine))
bad = [s for s in same if not s[2]]
check(f"App Control's writes: {len(same)} bodies answered alike", not bad, bad[:3])


class Req:
    def __init__(self, raw: bytes = b"", headers: dict | None = None) -> None:
        self._raw, self.headers = raw, {k.lower(): v for k, v in (headers or {}).items()}

    async def body(self) -> bytes:
        return self._raw


print("the master's sign-in tries, step by step as the relay's")
rns["MASTER_SIGN_IN_PATH"] = tmp / "relay-sign-in.json"
fd.MASTER_SIGN_IN_PATH = tmp / "door-sign-in.json"
rns["_write_atomic"] = lambda path, payload, overlay=True: path.write_text(json.dumps(payload))
WRONG = json.dumps({"status": 401, "message": "Invalid credentials"}).encode()
RIGHT = json.dumps({"status": 200}).encode()
steps = ([("203.0.113.7", RIGHT)] + [("198.51.100.1", WRONG)] * 4 + [(f"198.51.100.{n}", WRONG) for n in range(2, 6)]
         + [("203.0.113.7", WRONG), ("203.0.113.7", RIGHT), ("", WRONG)])
pairs = []
for ip, answer in steps:
    raw = form("authLogin", {"identifier": MASTER, "password": "p"}, token="")
    req = Req(raw, {"X-Real-IP": ip} if ip else {})
    addr_r, addr_d = rns["_master_sign_in_addr"](req), fd.sign_in_addr(req)
    rns["_MASTER_SIGN_IN_ADDR"].set(addr_r)
    held_r, held_d = rns["_master_sign_in_refusal"](raw, addr_r), fd.sign_in_refusal(env_of(raw), addr_d)
    if held_r is None:
        rns["_master_sign_in_observed"](raw, answer)
    if held_d is None:
        fd.sign_in_observed(env_of(raw), answer, addr_d)
    pairs.append((ip, addr_r == addr_d, held_r == held_d, held_d))
check("the same address keys, the same holds, the same known places",
      all(p[1] and p[2] for p in pairs) and set(json.loads(rns["MASTER_SIGN_IN_PATH"].read_text())["known"])
      == set(json.loads(fd.MASTER_SIGN_IN_PATH.read_text())["known"]), pairs)
check("the held answer is the backend's own 429", any(p[3] == {"status": 429, "message": "Too many attempts — try "
                                                                "again in a few minutes."} for p in pairs))
check("no address is written down", "203.0.113.7" not in fd.MASTER_SIGN_IN_PATH.read_text())

# ---- the session gate -----------------------------------------------------------------------------------------------
print("the session gate")
# a fresh copy of the door, its own gate and verdict untouched by the stand-ins above
gate_mod = load("front_door_gate", ROOT / "app" / "front_door.py")
gate_mod.log = _Log()
gate_mod.M = types.SimpleNamespace(DB=None, DRIVE=None, AUTH_STORE=None, _own=None, _own_locked=None)
calls = {"n": 0}


def verdict_of(answer: Any) -> Any:
    def go() -> Any:
        calls["n"] += 1
        if isinstance(answer, Exception):
            raise answer
        return answer
    return go


VERDICTS.update({
    "py.live": verdict_of({"ok": True, "role": "Staff", "uid": "u-1", "is_master": False}),
    "py.master": verdict_of({"ok": True, "role": "admin", "uid": "u-m", "is_master": True}),
    "py.child": verdict_of({"ok": True, "role": "staff", "uid": "u-t", "is_master": False,
                            "be_another": {"real": {"id": "u-m"}, "acting": {
                                "id": "u-t", "display_name": "Ana Lima",
                                "until": gsjs.iso(__import__("datetime").datetime.fromtimestamp(
                                    time.time() + 5, __import__("datetime").timezone.utc))}}}),
    "py.odd": verdict_of({"ok": True, "role": "staff", "uid": "u-o", "be_another": {"acting": None}}),
    "py.dead": verdict_of({"ok": False, "role": "", "uid": ""}),
    "py.down": verdict_of(Unreadable("db")),
    "py.boom": verdict_of(RuntimeError("x")),
})
g = gate_mod
live = run(g.session("py.live"))
check("Python's verdict, held", live.ok and live.role == "Staff" and live.uid == "u-1" and not live.master)
n = calls["n"]
run(g.session("py.live"))
check("asked once while it is held", calls["n"] == n)
g._SESSIONS["py.live"] = (time.time() - 1, live)
run(g.session("py.live"))
check("asked again once it is past SESSION_TTL_S", calls["n"] == n + 1 and g.SESSION_TTL_S <= 60)
m = run(g.session("py.master"))
check("the master: admin, named the master by the sign-in", m.master)
c = run(g.session("py.child"))
check("a switched session: acting, the worn name, never the master", c.acting and c.worn == "Ana Lima" and not c.master)
check("held no longer than the switched session lives", g._SESSIONS["py.child"][0] <= time.time() + 5.5)
check("a block naming nobody worn is no switched session", not run(g.session("py.odd")).acting)
check("an ended session is a refusal, held", run(g.session("py.dead")).ok is False and "py.dead" in g._SESSIONS)
check("an unreadable verdict is no verdict, never held",
      run(g.session("py.down")) is None and run(g.session("py.boom")) is None and "py.down" not in g._SESSIONS)
manifest = {"resources": [{"resource": "clients", "roles": ["admin", "manager"]},
                          {"resource": "houses", "roles": ["staff"], "mode": "live"},
                          {"resource": "staff", "roles": ["admin"]}]}
Path(os.environ["HUB_SNAPSHOT_MANIFEST"]).write_text(json.dumps(manifest))
rns["MANIFEST_PATH"] = Path(os.environ["HUB_SNAPSHOT_MANIFEST"])
rns["_note_held_live"] = lambda live: None
uris = ["/snapshot/clients.json", "/snapshot/clients.json?x=1", "/snapshot/houses.json", "/snapshot/staff.json",
        "/snapshot/index.json", "/snapshot/all.json", "/snapshot/events", "/snapshot/place", "/cortex/health",
        "/digest/try", "/snapshot/x%2e.json", "/snapshot/clients.json#a", "/snapshot/a\\b.json", "/snapshot/nope.json",
        "/snapshot/clients.txt", "/snapshot/chat-ticket", "/cortex/mesh/live"]
bad = [(r, u) for r in ("admin", "manager", "staff", "client", "") for u in uris
       if rns["_role_may_read"](r, u) != g.role_may_read(r, u)]
check(f"_role_may_read: {5 * len(uris)} role and file pairs judged alike", not bad, bad[:5])


def gate(token: str | None, uri: str = "/snapshot/clients.json") -> int:
    headers = {"X-Original-URI": uri, **({"Authorization": f"Bearer {token}"} if token is not None else {})}
    return run(g.gate(Req(b"", headers))).status_code


check("/auth: no session is 401", gate(None) == 401 and gate("") == 401)
check("/auth: a live session reads what its role may (200), not what it may not (403)",
      gate("py.master") == 200 and gate("py.live", "/snapshot/staff.json") == 403)
check("/auth: an ended session is 401", gate("py.dead") == 401)
check("/auth: no verdict is 401, held a little while without asking again",
      gate("py.down") == 401 and g._GATE_UNSURE.get("py.down", 0) > time.time() + 15)
resp = run(g.gate(Req(b"", {"Authorization": "Bearer py.master", "X-Original-URI": "/snapshot/clients.json"})))
check("/auth sets no body and no header of its own", resp.body == b"" and resp.headers == {})

# ---- the identity -------------------------------------------------------------------------------------------------
print("the identity Python is told, as the relay's _backend_user and _acting_user")
bad = []
for token in ("tok", "admin-tok", "master-tok", "child"):
    s = SESS[token]
    for env in ({"action": "staffList"}, {"action": "list", "resource": "clients", "tenant": " t-1 "},
                {"action": "x", "member": "m" * 300, "world": 7}, {"action": "", "tenant": None}):
        rns["_SESSION_ACTING"].set(s.acting)
        relay = rns["_acting_user"](rns["_backend_user"]((s.role, s.uid), s.master, env, "door"))
        mine = fd.said(s, env, "door")
        if relay != mine:
            bad.append((token, env, relay, mine))
check("16 sessions and places told alike", not bad, bad[:2])
check("a switched session is never the master and leaves no line",
      fd.said(SESS["child"], {}, "a") == {"uid": "u-t", "role": "staff", "is_master": False,
                                                "place": {"tenant": "", "member": "", "world": "", "resource": ""},
                                                "asked": "a", "acting": True, "unlogged": True})

# ---- the routing --------------------------------------------------------------------------------------------------
print("the routing, in gas_relay's order")
bad = []
for env in ({"action": "list", "resource": "documents"}, {"action": "get", "resource": "clients"},
            {"action": "create", "resource": "books"}, {"action": "update", "resource": "nobodyKnows"},
            {"action": "delete", "world": "w1", "resource": "documents"}, {"action": "list", "world": "  "},
            {"action": "staffList"}, {"action": "create", "resource": "hiringCadences"}):
    relay = rns["_backend_generic_door"](env["action"], form(env["action"], {}, **{k: v for k, v in env.items()
                                                                                   if k != "action"}))
    if relay != fd.generic_door(env["action"], env):
        bad.append((env, relay))
check("the generic verbs name the relay's door", not bad, bad)
kinds = {a: fd.route({"action": a, "token": "t"}, b"")[0] for a in set(fd.READS) | set(fd.WRITES) | fd.AUTH_DOORS}
check("every relay rung is carried", all(kinds.get(a, "relay") == "relay" for a in fd.RELAY_FIRST))
check("every door the relay shapes is carried", all(kinds[a] == "relay" for a in fd.RELAY_SHAPED - set(fd.PREPARE)
                                                     - set(fd.PREREAD) if a in kinds))
check("the final writes are answered here", all(kinds[a] == "write" for a in fd.HERE_WRITES))
check("the reads are answered here", all(kinds[a] == "read" for a in fd.HERE_READS if a not in fd.WRITES))
check("the sign-in is answered here, its endings carried",
      kinds["authLogin"] == "auth" and kinds["authLogout"] == "relay" and kinds["beAnotherStop"] == "relay")
check("the machine identity is carried", fd.route({"action": "staffList", "service_secret": "s"},
                                                  b'{"service_secret":"s","action":"staffList"}')[0] == "relay")
check("an envelope naming no action is carried",
      fd.route({}, b"{}")[0] == "relay" and fd.route(None, b"x")[0] == "relay")
check("the asking rhythm's generic verbs are the relay's own rung",
      fd.route({"action": "create", "resource": "hiringCadences"}, b"")[0] == "relay"
      and fd.route({"action": "create", "resource": "hiringCadences", "world": "w"}, b"")[0] != "relay")
check("App Studio's door is told its resource",
      fd.builder_payload("builderList", {"resource": "r"}, {"_envelope": {"a": 1}}) ==
      rns["_builder_payload"]("builderList", {"resource": "r"}, {"_envelope": {"a": 1}}))

# ---- the doors, dispatched -------------------------------------------------------------------------------------------
print("the doors, dispatched with the relay's receipts, write ids, voids and finish")
FIN: list[tuple] = []
FIN_ANSWER: dict[str, Any] = {"value": None}
APP_CALLS: list[tuple] = []
APP_ANSWER: dict[str, Any] = {}


async def fake_finish(meta: dict, raw: bytes, content: bytes) -> Any:
    FIN.append((meta, raw, content))
    return FIN_ANSWER["value"]


async def fake_call_app(app_id: str, action: str, user: dict, payload: dict, write_id: str = "", at: float = 0.0):
    APP_CALLS.append((app_id, action, user, payload, write_id, at))
    got = APP_ANSWER.get("value")
    if got is None:
        return None
    env = json.loads(json.dumps(got))
    return json.dumps(env).encode(), 1000.0, env, frozenset({"Wb", "Wa"}), 1001.5


fd.finish = fake_finish
fd.call_app = fake_call_app
fd.settle_void_soon = lambda app_id, wid: VOIDED.append(("void", app_id, wid))
staff = SESS["tok"]
door = sorted(a for a in fd.HERE_WRITES if fd.WRITES[a] == "staff")[0]


def write(env: dict, s: Any = staff) -> Any:
    env = {"action": door, "token": "tok", **env}
    raw = form(door, env.get("payload"), env["token"], **{k: v for k, v in env.items()
                                                          if k not in ("action", "payload", "token")})
    return run(fd.write(door, "staff", env, raw, s))


def body(r: Any) -> dict:
    return json.loads(r.body)


check("a write with no session is 503, nothing written", body(write({"payload": {}, "token": ""})) == fd.UNWRITTEN)
check("a write with no payload is 503", body(write({"payload": "x"})) == fd.UNWRITTEN)
check("a write whose session is not live is 503", body(write({"payload": {}}, SESS["dead"])) == fd.UNWRITTEN
      and body(write({"payload": {}}, None)) == fd.UNWRITTEN)
check("an unusable write id is 503", body(write({"payload": {}, "write_id": "bad id!"})) == fd.UNWRITTEN)
APP_ANSWER["value"] = None
VOIDED.clear()
r = write({"payload": {"a": 1}})
wid = APP_CALLS[-1][4]
check("a write id is stamped as the exactly-once lane stamps one",
      len(wid) == 25 and wid.startswith("W") and all(ch in "0123456789abcdef" for ch in wid[1:]))
check("Python not answering: 503, and its write voided", body(r) == fd.UNWRITTEN and VOIDED == [("void", "staff", wid)])
APP_ANSWER["value"] = {"status": 200, "data": {"written": ["x"]}, "_write": {"final": True, "house": "AB123"}}
FIN.clear()
FIN_ANSWER["value"] = fd.Finished(None, None, "ready")
r = write({"payload": {"a": 1}, "write_id": "Wgiven000001"})
meta = FIN[-1][0]
check("a kept write is finished by the relay with its receipt's facts",
      meta["kind"] == "write" and meta["write_id"] == "Wgiven000001"
      and meta["plan"] == {"final": True, "house": "AB123"}
      and meta["held"] == ["Wa", "Wb"] and meta["as_of"] == 1000.0 and meta["edits_at"] == 1001.5)
check("the browser gets the door's answer without its plan, as json.dumps writes it",
      r.body == json.dumps({"status": 200, "data": {"written": ["x"]}}).encode()
      and r.headers == {"X-Hub-Phase": "ready"})
check("the session the door is told is the relay's identity",
      APP_CALLS[-1][2] == fd.said(staff, {"action": door, "write_id": "Wgiven000001"}, door))
FIN_ANSWER["value"] = fd.Finished(json.dumps({"status": 409, "message": "taken back"}).encode(), None)
check("a write the relay takes back is answered in the relay's words",
      body(write({"payload": {}, "write_id": "Wgiven000002"})) == {"status": 409, "message": "taken back"})
FIN_ANSWER["value"] = None
check("a relay that cannot be told leaves the kept write's answer standing",
      body(write({"payload": {}, "write_id": "Wgiven000003"})) == {"status": 200, "data": {"written": ["x"]}})
FIN.clear()
APP_ANSWER["value"] = {"status": 403, "message": "no"}
check("a refusal is the door's own words, never finished", body(write({"payload": {}})) == {"status": 403,
                                                                                           "message": "no"} and not FIN)
APP_ANSWER["value"] = {"status": 200, "data": {}, "_write": {"final": True, "replay": True}}
check("a replay is answered from its receipt, never finished again", body(write({"payload": {}})) ==
      {"status": 200, "data": {}} and not FIN)
VOIDED.clear()
APP_ANSWER["value"] = {"status": 200, "_write": {"engine": True}}
r = write({"payload": {}, "write_id": "Wgiven000004"})
check("a final door answering a sheet write: voided, 503", body(r) == fd.UNWRITTEN
      and VOIDED == [("void", "staff", "Wgiven000004")])
master = SESS["master-tok"]
fd.people_at = lambda: 1234.0
APP_ANSWER["value"] = {"status": 200}
write({"payload": {}}, master)
check("the master's final writes are not held by who-reads-what settling", APP_CALLS[-1][5] == 0.0)
write({"payload": {}})
check("anybody else's are", APP_CALLS[-1][5] == 1234.0)
APP_ANSWER["value"] = {"status": 200, "data": {"handed": [{"action": "x"}]}, "_write": {"final": True}}
FIN.clear()
run(fd.write("hiringX", "hiring", {"action": "hiringX", "payload": {}, "token": "tok", "write_id": "Wgiven000005"},
             form("hiringX", {}, write_id="Wgiven000005"), staff))
check("the hiring presses a write hands back go with its finish", FIN[-1][0]["handed"] == [{"action": "x"}])

# a write a preparation alone shapes: the preparation asked here first, then the write told what it made
PREP_ANSWERS: dict[str, Any] = {}


async def prep_call_app(app_id: str, action: str, user: dict, payload: dict, write_id: str = "", at: float = 0.0):
    APP_CALLS.append((app_id, action, user, payload, write_id, at))
    got = PREP_ANSWERS.get(action)
    if got is None:
        return None
    env = json.loads(json.dumps(got))
    return json.dumps(env).encode(), 1000.0, env, frozenset(), 0.0


def ensure(payload: dict, wid: str, action: str = "tenantEnsure") -> Any:
    env = {"action": action, "payload": payload, "token": "tok", "write_id": wid}
    return run(fd.write(action, fd.WRITES[action], env, form(action, payload, write_id=wid), staff))


fd.call_app = prep_call_app
check("a place's preparation is its prepare door, no file", fd.PREPARE["tenantEnsure"] == ("tenantEnsurePrepare", ""))
PREP_ANSWERS.update({"tenantEnsurePrepare": {"status": 200, "data": {"minted": {"spreadsheet_id": "S1", "name": "W"}}},
                     "tenantEnsure": {"status": 200, "data": {"created": True}, "_write": {"final": True}}})
APP_CALLS.clear()
FIN.clear()
FIN_ANSWER["value"] = fd.Finished(None, None, "ready")
r = ensure({"x": 1}, "Wensure00001")
check("the preparation is asked first, then the write with what it made, and the write is finished",
      [c[1] for c in APP_CALLS] == ["tenantEnsurePrepare", "tenantEnsure"]
      and APP_CALLS[0][3] == {"x": 1} and APP_CALLS[0][4] == "" and APP_CALLS[0][5] == 0.0
      and APP_CALLS[1][3] == {"x": 1, "prepared": {"minted": {"spreadsheet_id": "S1", "name": "W"}}}
      and APP_CALLS[1][4] == "Wensure00001" and FIN[-1][0]["door"] == "tenantEnsure"
      and body(r) == {"status": 200, "data": {"created": True}})
PREP_ANSWERS["tenantEnsurePrepare"] = {"status": 409, "message": "A place is being made already."}
APP_CALLS.clear()
check("the preparation's refusal is the answer, nothing written",
      body(ensure({}, "Wensure00002")) == {"status": 409, "message": "A place is being made already."}
      and [c[1] for c in APP_CALLS] == ["tenantEnsurePrepare"])
PREP_ANSWERS["tenantEnsurePrepare"] = None
APP_CALLS.clear()
check("a preparation Python did not answer: 503, nothing written, never handed on",
      body(ensure({}, "Wensure00003")) == fd.UNWRITTEN and [c[1] for c in APP_CALLS] == ["tenantEnsurePrepare"])
PREP_ANSWERS.update({"worldEnsure": {"status": 200, "data": {"created": True}, "_write": {"final": True}}})
APP_CALLS.clear()
r = ensure({}, "Wensure00006", "worldEnsure")
check("a world is made by its write alone: no preparation, nothing in Drive, the write final here",
      "worldEnsure" not in fd.PREPARE and "worldEnsure" in fd.HERE_WRITES
      and [c[1] for c in APP_CALLS] == ["worldEnsure"] and APP_CALLS[0][3] == {}
      and body(r) == {"status": 200, "data": {"created": True}})
filed = next(a for a, (_d, f) in fd.PREPARE.items() if f and a in fd.HERE_WRITES)
field = fd.PREPARE[filed][1]
PREP_ANSWERS.update({fd.PREPARE[filed][0]: {"status": 200, "data": {"id": "F1"}}, filed: {"status": 200, "data": {}}})
APP_CALLS.clear()
app_of = fd.WRITES[filed]
run(fd.write(filed, app_of, {"action": filed, "payload": {field: "QUJD"}, "token": "tok", "write_id": "Wensure00004"},
             form(filed, {field: "QUJD"}, write_id="Wensure00004"), staff))
check("a preparation that reads a file takes it, the write told it was kept",
      APP_CALLS[0][3] == {field: "QUJD"} and APP_CALLS[1][3] == {field: "kept", "prepared": {"id": "F1"}})
APP_CALLS.clear()
run(fd.write(filed, app_of, {"action": filed, "payload": {}, "token": "tok", "write_id": "Wensure00005"},
             form(filed, {}, write_id="Wensure00005"), staff))
check("with no file the preparation is not asked", [c[1] for c in APP_CALLS] == [filed])
fd.call_app = fake_call_app

APP_ANSWER["value"] = {"status": 200, "data": {"rows": []}}
FIN.clear()
FIN_ANSWER["value"] = fd.Finished(None, "ring:staff", "ready")
rd = sorted(fd.HERE_READS)[0]
r = run(fd.read(rd, fd.READS[rd], {"action": rd, "payload": {"q": 1}}, form(rd, {"q": 1}), staff))
check("a read is Python's answer, finished by the relay, its ring said",
      body(r) == {"status": 200, "data": {"rows": []}} and r.headers == {"X-Kept-Ring": "ring:staff",
                                                                         "X-Hub-Phase": "ready"}
      and FIN[-1][0]["kind"] == "read" and FIN[-1][0]["held"] == ["Wa", "Wb"])
check("the read is told who reads what's settling moment", APP_CALLS[-1][5] == 1234.0 and APP_CALLS[-1][4] == "")
FIN_ANSWER["value"] = fd.Finished(json.dumps(fd.UNREAD).encode(), None)
check("a read the relay judges older than a write it saw: its 503",
      body(run(fd.read(rd, fd.READS[rd], {"action": rd}, form(rd, {}), staff))) == fd.UNREAD)
APP_ANSWER["value"] = None
FIN_ANSWER["value"] = None
check("a read Python did not answer: its 503, never handed on",
      body(run(fd.read(rd, fd.READS[rd], {"action": rd}, form(rd, {}), staff))) == fd.UNREAD and FIN[-1][0].get("said"))

PROXIED: list[tuple] = []
RELAY_GAS: dict[str, Any] = {"status": 200, "body": b'{"status":200,"data":"relay"}',
                             "headers": {"Content-Type": "application/json", "X-Kept-Ring": "r1",
                                         "X-Hub-Phase": "ready"}}


class RelayRes:
    def __init__(self, status: int, content: bytes, headers: dict) -> None:
        self.status_code, self.content = status, content
        self.headers = {k.lower(): v for k, v in headers.items()}
        self.headers = type("H", (dict,), {"get": lambda s, k, d=None: dict.get(s, k.lower(), d),
                                           "__getitem__": lambda s, k: dict.__getitem__(s, k.lower())})(self.headers)


def fake_post(path: str, body: bytes, headers: dict, timeout: float) -> Any:
    PROXIED.append((path, body, headers, timeout))
    if RELAY_GAS.get("down"):
        raise ConnectionError("down")
    return RelayRes(RELAY_GAS["status"], RELAY_GAS["body"], RELAY_GAS["headers"])


fd.post_relay = fake_post
AUTH_ANSWERS: dict[str, Any] = {}
fd.M = types.SimpleNamespace(_run_auth=lambda action, b: AUTH_ANSWERS[action](b), TOKEN="t")
FIN.clear()
FIN_ANSWER["value"] = fd.Finished(None, None, "ready")
AUTH_ANSWERS["authMe"] = lambda b: Resp(json.dumps({"status": 200, "data": {"user": {"id": "u"}}, "_slid": True,
                                                    "_also_apps_script": True}).encode())
r = run(fd.auth("authMe", {"action": "authMe", "token": "py.t"}, form("authMe", {}, "py.t"), form("authMe", {}, "py.t"),
                Req(), ""))
check("the sign-in's old marks reach neither the browser nor the relay: nothing is carried to Apps Script",
      body(r) == {"status": 200, "data": {"user": {"id": "u"}}} and "slid" not in FIN[-1][0]
      and "also_apps_script" not in FIN[-1][0] and FIN[-1][0]["token"] == "py.t")
AUTH_ANSWERS["authLogin"] = lambda b: Resp(b'{"defer":"x"}', 503)
check("the sign-in not answering is said, never handed on",
      body(run(fd.auth("authLogin", {"action": "authLogin"}, b"", b"", Req(), ""))) == fd.AUTH_UNAVAILABLE)
AUTH_ANSWERS["authForgot"] = lambda b: Resp(b'{"defer":"x"}', 500)
check("the forgot door answers its one generic yes whatever happens",
      body(run(fd.auth("authForgot", {"action": "authForgot"}, b"", b"", Req(), ""))) == {"status": 200,
                                                                                        "data": {"sent": True}})
PROXIED.clear()
AUTH_ANSWERS["authBootstrap"] = lambda b: Resp(b'{"defer":"first account"}', 409)
raw = form("authBootstrap", {"email": "a@b"}, "")
r = run(fd.auth("authBootstrap", env_of(raw), raw, raw, Req(raw, {"Content-Type": "x/y"}), ""))
check("Python's hand-back goes to the relay unchanged",
      PROXIED and PROXIED[-1][1] == raw and body(r)["data"] == "relay")

# ---- the relay as the fallback ----------------------------------------------------------------------------------
print("what is not owned goes to the relay unchanged")
PROXIED.clear()
raw = plain("chatSend", {"text": "hi"}, "tok")
r = run(fd.gas(Req(raw, {"Content-Type": "application/json", "X-Real-IP": "203.0.113.9"})))
check("the original bytes, its content type and nginx's X-Real-IP go to the relay's /gas",
      PROXIED[-1][0] == "/gas" and PROXIED[-1][1] == raw and PROXIED[-1][2] == {"Content-Type": "application/json",
                                                                                "X-Real-IP": "203.0.113.9"})
check("the relay's answer comes back whole, its ring and phase with it",
      r.body == RELAY_GAS["body"] and r.status_code == 200
      and r.headers == {"X-Kept-Ring": "r1", "X-Hub-Phase": "ready"})
RELAY_GAS["down"] = True
r = run(fd.gas(Req(raw)))
check("a relay that is not there: 502, as nginx says it", r.status_code == 502 and body(r) == fd.RELAY_UNREACHED)
RELAY_GAS["down"] = False
SESS["py.ended"] = fd.Session(ok=False)
SESS["a" * 48] = fd.Session(ok=False)
PROXIED.clear()
check("a read on a session the sign-in ended is refused here",
      body(run(fd.gas(Req(form(rd, {}, "py.ended"))))) == fd.AUTH_ENDED and not PROXIED)
check("an ended token carried over from the sheet is refused here too, on Python's verdict alone",
      body(run(fd.gas(Req(form(rd, {}, "a" * 48))))) == fd.AUTH_ENDED and not PROXIED)
check("a session nobody can vouch for just now is Python's 503 here, never carried",
      body(run(fd.gas(Req(form(rd, {}, "nobody"))))) == fd.UNREAD and not PROXIED)
check("no session at all is Python's 401 here, never carried",
      body(run(fd.gas(Req(form(rd, {}, ""))))) == fd.AUTH_ENDED and not PROXIED)
fd._SESSIONS["x"] = (time.time() + 60, SESS["tok"])
run(fd.gas(Req(form("authLogout", {}, "tok"))))
check("a sign-out carried to the relay lets every held verdict go", not fd._SESSIONS and len(PROXIED) == 1)
check("a guard answers before any door, carried or not",
      body(run(fd.gas(Req(form("userDelete", {"user_id": "u-master"}, "tok"))))) ==
      {"status": 404, "message": 'No user "u-master".'} and len(PROXIED) == 1)

# ---- upload size -------------------------------------------------------------------------------------------------
print("upload size")
big_door = "inventorySupplyAdd"
check("the big write answered here is a big write of the relay's", big_door in fd.HERE_WRITES and big_door in
      set(fd.ROUTES["big_writes"]))
blob = "A" * (30 * 1024 * 1024)
raw = form(big_door, {"house": "AB123", "base64": blob}, "tok", write_id="Wbigwrite0001")
APP_ANSWER["value"] = {"status": 200, "_write": {"final": True}}
APP_CALLS.clear()
PROXIED.clear()
t0 = time.time()
run(fd.gas(Req(raw)))
check(f"a {len(raw) // (1024 * 1024)} MB upload is read whole and answered here, every byte handed to its door "
      f"({time.time() - t0:.1f}s)", APP_CALLS and APP_CALLS[-1][1] == big_door and
      len(APP_CALLS[-1][3]["base64"]) == len(blob) and not PROXIED)
check("its finish carries the envelope as the relay's readers take it", FIN[-1][1] == raw)
over = form(big_door, {"base64": "A" * (33 * 1024 * 1024)}, "tok")
run(fd.gas(Req(over)))
check("past doPost's own cap it goes to the relay, unchanged", PROXIED and PROXIED[-1][1] == over)
check("a padded switched-session body is read whole and refused",
      (run(fd.gas(Req(form("prefsSet", {"pad": "x" * 2_000_000}, "child"))))).body.find(b"be_another_refused") > 0)
PROXIED.clear()
raw = plain(rd, {}, "tok")
FIN.clear()
APP_ANSWER["value"] = {"status": 200}
FIN_ANSWER["value"] = fd.Finished(None, None)
run(fd.gas(Req(raw, {"Content-Type": "application/json"})))
check("a raw JSON envelope is answered here and handed to the relay's readers as a form",
      not PROXIED and FIN[-1][1].startswith(b"body=") and json.loads(urllib.parse.parse_qs(FIN[-1][1].decode())
                                                                     ["body"][0])["action"] == rd)

# ---- the relay's finish ------------------------------------------------------------------------------------------
print("the relay's finish (server/front_door_finish.py)")
CALLED: list[tuple] = []


def rec(name: str) -> Any:
    def go(*a: Any, **k: Any) -> Any:
        CALLED.append((name, a, k))
    return go


class Said:
    def __init__(self, content: bytes) -> None:
        self.content = content


async def backend_final(*a: Any) -> Any:
    CALLED.append(("_backend_final", a, {}))
    return Resp(b'{"status":200,"final":true}')


async def editions_cut(action: str, content: bytes) -> bytes:
    CALLED.append(("_backend_editions_cut", (action,), {}))
    return content


written_after = {"value": False}
ns = {n: rec(n) for n, _ in finish_mod.LOOP}
ns.update(_relay_envelope=rns["_relay_envelope"], _cert_papers_envelope=rns["_cert_papers_envelope"],
          _builder_payload=rns["_builder_payload"], BACKEND_APPS=apps, _APP_PACK_HOUSE_RE=rns["_APP_PACK_HOUSE_RE"],
          _backend_key=lambda app_id, payload: f"{app_id}:{sorted(payload.items())}",
          _backend_written_after=lambda *a, **k: written_after["value"],
          _backend_said_unread=lambda door, why: (Said(json.dumps(fd.UNREAD).encode()), 1.0),
          _backend_copy_at=lambda *a, **k: 2000.0, _traffic_note=rec("_traffic_note"), _backend_final=backend_final,
          _keep_task=lambda coro: CALLED.append(("_keep_task", (coro,), {})),
          _hiring_handed=lambda handed: ("handed", handed),
          _viewer_cache_key=lambda action, raw, req: {"k": 1} if action == "kept" else None,
          _viewer_cache_ring_of=lambda action: "ring:x", _viewer_cache_take=rec("_viewer_cache_take"),
          _backend_editions_cut=editions_cut, HUB_APP_TOKEN="t", log=_Log())
blob = finish_mod.unframe(fd.framed({"kind": "read"}, b"raw", b"content"))
check("the frame reads back as written", blob == ({"kind": "read"}, b"raw", b"content"))
refused = 0
for broken in (b"", b"\x00" * 15, __import__("struct").pack(">QQ", 100, 100) + b"x", fd.framed({}, b"r", b"")[:17]):
    try:
        finish_mod.unframe(broken)
    except ValueError:
        refused += 1
check("a broken frame is refused", refused == 4)
CALLED.clear()
out, ring = run(finish_mod.finish(ns, {"kind": "read", "action": "kept", "door": "kept", "app_id": "staff",
                                       "as_of": 100.0, "edits_at": 0, "held": None},
                                  form("kept", {"staff": "s1"}), b'{"status":200}'))
names = [c[0] for c in CALLED]
check("a fresh read stands (204), its kept ring said", out is None and ring == "ring:x")
check("gas_relay's observers ran in its order on it, then the kept copy, then the editions' cut",
      [n for n in names if n in {x for x, _ in finish_mod.LOOP}] == [x for x, _ in finish_mod.LOOP]
      and names[-2:] == ["_viewer_cache_take", "_backend_editions_cut"])
check("the packs hear it as Python's answer", next(c for c in CALLED if c[0] == "_relay_observe_app_pack")[2] ==
      {"python": True})
written_after["value"] = True
out, ring = run(finish_mod.finish(ns, {"kind": "read", "action": "x", "door": "x", "app_id": "staff", "as_of": 1.0},
                                  form("x", {}), b'{"status":200}'))
check("a read older than a write the relay saw: the relay's 503 in its place", json.loads(out) == fd.UNREAD
      and ring is None)
written_after["value"] = False
CALLED.clear()
out, _ = run(finish_mod.finish(ns, {"kind": "write", "action": "w", "door": "locWrite", "app_id": "locations",
                                    "write_id": "Wfin0000001", "as_of": 5.0, "held": ["Wb"], "edits_at": 6.0,
                                    "plan": {"final": True}, "handed": [{"action": "h"}]},
                               form("locWrite", {"house": " ab123 "}), b'{"status":200}'))
fin = next(c for c in CALLED if c[0] == "_backend_final")[1]
check("a kept write: its hiring presses first, then _backend_final with the house as its key",
      CALLED[0][0] == "_keep_task" and fin[0:5] == ("locations", "locWrite", form("locWrite", {"house": " ab123 "}),
                                                    "Wfin0000001", {"status": 200})
      and fin[5] == "AB123" and fin[7] == frozenset({"Wb"}) and fin[9] is False
      and out == b'{"status":200,"final":true}')
CALLED.clear()
run(finish_mod.finish(ns, {"kind": "write", "door": "staffW", "app_id": "staff", "write_id": "Wfin0000002",
                           "as_of": 5.0, "plan": {"house": "S-9"}}, form("staffW", {}), b'{"status":200}'))
fin = next(c for c in CALLED if c[0] == "_backend_final")[1]
check("another app's key: the plan's subject, folded as its pack folds it",
      fin[5] == "staff:" + str([(apps["staff"].get("key", "house"), "S-9")]))
CALLED.clear()
run(finish_mod.finish(ns, {"kind": "auth", "action": "authLogin", "door": "authLogin", "token": "py.t",
                           "also_apps_script": True, "slid": True}, form("authLogin", {}), b'{"status":200}'))
check("a sign-in's finish asks nothing of Apps Script, whatever its meta still says",
      not [c for c in CALLED if c[0] == "_keep_task"] and "_auth_gas" not in FINISH_SRC
      and not re.search(r"\b_auth_gas_\w+|\b_auth_twin_landing\b", RELAY_SRC))
check("the gate learns from the sign-in's answer", any(c[0] == "_relay_observe_auth" for c in CALLED))


class FakeApp:
    def __init__(self) -> None:
        self.routes: dict[str, Any] = {}

    def post(self, path: str) -> Any:
        def deco(fn: Any) -> Any:
            self.routes[path] = fn
            return fn
        return deco


fa = FakeApp()
finish_mod.install(fa, ns)
door_fn = fa.routes[finish_mod.FINISH_PATH]
check("the finish is asa-hub-app's alone", run(door_fn(Req(b"", {"X-Hub-Token": "nope"}))).status_code == 401)
check("a broken body is 400", run(door_fn(Req(b"x", {"X-Hub-Token": "t"}))).status_code == 400)
r = run(door_fn(Req(fd.framed({"kind": "read", "action": "kept", "door": "kept", "app_id": "staff", "as_of": 1.0},
                              form("kept", {}), b'{"status":200}'), {"X-Hub-Token": "t"})))
check("a standing answer is 204 with its ring", r.status_code == 204 and r.headers == {"X-Front-Door-Ring": "ring:x"})

print(f"\n{results['ok']} ok, {len(results['failed'])} failed")
sys.exit(1 if results["failed"] else 0)
