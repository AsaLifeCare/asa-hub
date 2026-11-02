#!/usr/bin/env python3
"""The one master's account is the master's: every account write that names it is answered as for an account that
does not exist unless the master's own session (no visit) sends it, in either body shape doPost reads and at any size;
nobody can ask the master in as a platform member; and failed sign-ins with the master's address from places the master
never signed in from stop at the relay before the backend's own lock is reached, while a place the master signed in
from goes through as before."""
import ast
import asyncio
import contextvars
import hashlib
import hmac
import json
import sys
import tempfile
import time
import urllib.parse
from pathlib import Path
from typing import Any

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parent.parent
SOURCE = (ROOT / "server" / "snapshot_service.py").read_text(encoding="utf-8")

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


def segment(name: str) -> str:
    """One top-level definition or assignment, as written in the relay."""
    for node in ast.parse(SOURCE).body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == name:
            return ast.get_source_segment(SOURCE, node) or ""
        if isinstance(node, ast.Assign) and any(getattr(t, "id", "") == name for t in node.targets):
            return ast.get_source_segment(SOURCE, node) or ""
        if isinstance(node, ast.AnnAssign) and getattr(node.target, "id", "") == name:
            return ast.get_source_segment(SOURCE, node) or ""
    return ""


class _Log:
    def info(self, *a: Any) -> None:
        pass

    warning = info


MASTER_ID, OTHER_ID = "u-master", "u-other"
MASTER_TOKENS = {"master-tok"}
store = Path(tempfile.mkdtemp()) / "master-sign-in.json"
written: list[dict] = []


async def _app_pack_master(authorization: str) -> tuple[bool, str]:
    return authorization[7:] in MASTER_TOKENS, ""


def _write_atomic(path: Path, payload: dict, *, overlay: bool = True) -> None:
    written.append(payload)
    path.write_text(json.dumps(payload))


ns: dict[str, Any] = {"json": json, "urllib": urllib, "Any": Any, "asyncio": asyncio, "time": time, "hmac": hmac,
                      "hashlib": hashlib, "contextvars": contextvars, "Path": Path, "os": __import__("os"),
                      "log": _Log(), "Request": Any, "HUB_MASTER_ACCOUNT": "asatech@asalifecare.com",
                      "SERVICE_SECRET": "test-secret", "_app_pack_master": _app_pack_master,
                      "_write_atomic": _write_atomic}
for name in ("_relay_json_constant", "_GUARD_ESCAPES", "_relay_action", "_relay_envelope", "MASTER_ROW_TARGETS", "MASTER_ASK_REFUSED",
             "_master_row_named", "_master_guard_envelope", "_master_account_refusal", "MASTER_SIGN_IN_WINDOW_S",
             "MASTER_SIGN_IN_PER_IP", "MASTER_SIGN_IN_STRANGERS", "MASTER_SIGN_IN_KNOWN_S", "MASTER_SIGN_IN_REFUSED",
             "_MASTER_SIGN_IN_ADDR", "_MASTER_SIGN_IN", "_master_sign_in_addr", "_master_sign_in_known",
             "_master_sign_in_identifier", "_master_sign_in_refusal", "_master_sign_in_observed"):
    code = segment(name)
    check(f"the relay declares {name}", bool(code))
    exec(code, ns)  # noqa: S102 — the relay's own source
ns["MASTER_SIGN_IN_PATH"] = store
ns["_master_account_ids"] = lambda: frozenset({MASTER_ID})
refusal = ns["_master_account_refusal"]


def form(action: str, payload: Any, token: str = "tok", **extra: Any) -> bytes:
    body = json.dumps({"token": token, "action": action, "payload": payload, **extra})
    return urllib.parse.urlencode({"body": body}).encode()


def plain(action: str, payload: Any, token: str = "tok", **extra: Any) -> bytes:
    return json.dumps({"token": token, "action": action, "payload": payload, **extra}).encode()


def ask(raw: bytes) -> Any:
    return asyncio.run(refusal(raw))


print("account writes naming the master")
for action, payload in (("userUpdate", {"user_id": MASTER_ID, "role": "staff"}), ("userDelete", {"user_id": MASTER_ID}),
                        ("userActivate", {"user_id": f"  {MASTER_ID} "}), ("releaseUser", {"user_id": MASTER_ID}),
                        ("usersArm", {"user_ids": [OTHER_ID, MASTER_ID]}), ("userInvite", {"user_ids": [MASTER_ID]}),
                        ("usersContactMergeApply", {"user_ids": [MASTER_ID]}),
                        ("userMergeManual", {"keep_id": OTHER_ID, "fold_ids": [MASTER_ID]}),
                        ("userMergeManual", {"keep_id": MASTER_ID, "fold_ids": [OTHER_ID]})):
    for shape, build in (("form", form), ("raw JSON", plain)):
        got = ask(build(action, payload))
        check(f"{action} ({shape}) from another admin is answered as no such user",
              got == {"status": 404, "message": f'No user "{MASTER_ID}".'}, got)
    check(f"{action} from the master's own session goes on", ask(form(action, payload, "master-tok")) is None)
    check(f"{action} from the master during a visit is refused",
          ask(form(action, payload, "master-tok", member="mem_1")) is not None)
padded = form("userUpdate", {"user_id": MASTER_ID, "pad": "x" * 200_000})
check("a body padded past the 100 KB readers is still read and refused", ask(padded) is not None)
check("the short reader would have missed it", ns["_relay_action"](padded) == "")
for action, payload in (("userUpdate", {"user_id": OTHER_ID}), ("usersArm", {"user_ids": [OTHER_ID]}),
                        ("userInvite", {"user_ids": []}), ("usersContactMergeApply", {}), ("prefsSet", {"x": 1})):
    check(f"{action} not naming the master goes on", ask(form(action, payload)) is None)
ns["_master_account_ids"] = lambda: (_ for _ in ()).throw(RuntimeError("down"))
check("an unreadable users copy holds the write", (ask(form("userDelete", {"user_id": OTHER_ID})) or {}).get("status")
      == 503)
ns["_master_account_ids"] = lambda: frozenset({MASTER_ID})

escaped = json.dumps({"token": "tok", "action": "userUpd\\u0061te", "payload": {"user_id": MASTER_ID}})
check("an action name spelled with a JSON escape is still read and refused (raw JSON)",
      ask(escaped.replace("\\\\u", "\\u").encode()) is not None)
check("…and form-encoded", ask(urllib.parse.urlencode({"body": escaped.replace("\\\\u", "\\u")}).encode()) is not None)

print("asking the master in as a platform member")
for email in ("asatech@asalifecare.com", "  ASATECH@asalifecare.com "):
    check(f"platformMemberAsk for {email.strip()!r} is answered as no account",
          ask(form("platformMemberAsk", {"email": email})) == ns["MASTER_ASK_REFUSED"])
check("platformMemberAsk for anyone else goes on", ask(form("platformMemberAsk", {"email": "a@b.co"})) is None)

print("failed sign-ins with the master's address")


class _Req:
    def __init__(self, ip: str) -> None:
        self.headers = {"x-real-ip": ip} if ip else {}


addr_of = ns["_master_sign_in_addr"]
held, observed = ns["_master_sign_in_refusal"], ns["_master_sign_in_observed"]
WRONG, RIGHT = json.dumps({"status": 401, "message": "Invalid credentials"}).encode(), json.dumps({"status": 200}).encode()


def attempt(ip: str, answer: bytes, ident: str = "asatech@asalifecare.com") -> Any:
    raw = form("authLogin", {"identifier": ident, "password": "p"}, token="")
    addr = addr_of(_Req(ip))
    ns["_MASTER_SIGN_IN_ADDR"].set(addr)
    stop = held(raw, addr)
    if stop is None:
        observed(raw, answer)
    return stop


home = addr_of(_Req("203.0.113.7"))
check("no address is kept in the clear", "203.0.113.7" not in home and len(home) == 32)
check("the master signs in from home", attempt("203.0.113.7", RIGHT) is None)
check("home is remembered on disk", home in json.loads(store.read_text())["known"])
PER_IP, STRANGERS = ns["MASTER_SIGN_IN_PER_IP"], ns["MASTER_SIGN_IN_STRANGERS"]
check(f"a stranger's first {PER_IP} failures are carried",
      [attempt("198.51.100.1", WRONG) for _ in range(PER_IP)] == [None] * PER_IP)
check("the stranger's next is held with the backend's own words",
      attempt("198.51.100.1", WRONG) == ns["MASTER_SIGN_IN_REFUSED"])
others = [f"198.51.100.{n}" for n in range(2, 2 + STRANGERS - PER_IP)]
check("other strangers are carried once each", [attempt(ip, WRONG) for ip in others] == [None] * len(others))
check(f"all strangers together stop at {STRANGERS} carried failures",
      attempt("198.51.100.99", WRONG) == ns["MASTER_SIGN_IN_REFUSED"] and len(ns["_MASTER_SIGN_IN"]["fails"]) == STRANGERS)
check("they stay under the backend's lock of eight, leaving the master tries", STRANGERS < 8)
check("the master at home still goes through", attempt("203.0.113.7", WRONG) is None)
check("and signs in", attempt("203.0.113.7", RIGHT) is None)
check("another address is never held", attempt("198.51.100.1", WRONG, "someone@else.org") is None)
ns["_MASTER_SIGN_IN"].update({"known": None, "fails": []})
check("a restarted relay still knows home", attempt("203.0.113.7", WRONG) is None and not ns["_MASTER_SIGN_IN"]["fails"])
big = form("authLogin", {"identifier": "asatech@asalifecare.com", "password": "p", "pad": "x" * 200_000}, token="")
check("a padded sign-in is still read as the master's", ns["_master_sign_in_identifier"](big))

print("a switched session")
for name in ("ACTING_REFUSED", "ACTING_REFUSED_RESOURCES", "CHAT_PYTHON_ACTIONS", "_acting_refusal"):
    code = segment(name)
    check(f"the relay declares {name}", bool(code))
    exec(code, ns)  # noqa: S102 — the relay's own source
ns["_acting"] = {}
ns["_token_user"] = {"child": (0.0, "u-t", "Ana Lima")}
ns["_my_work_acting"] = lambda token: token in ns["_acting"]
acting = ns["_acting_refusal"]
check("nothing is refused while nobody is switched", acting(form("prefsSet", {}, "child")) is None)
ns["_acting"]["child"] = (time.time() + 3600, "u-m", "u-t")
got = acting(form("prefsSet", {}, "child"))
check("a refused action answers Apps Script's words",
      got == {"status": 409, "code": "be_another_refused",
              "message": "Not while acting as Ana Lima: saving their preferences. Press Be Back to do this as yourself."},
      got)
for action in ("questionnaireSubmit", "smartCommsSet", "userUpdate", "masterOverview", "beAnotherStart"):
    check(f"{action} is refused while switched", (acting(plain(action, {}, "child")) or {}).get("status") == 409)
check("a big upload is read whole and refused",
      acting(form("certDocUpload", {"file": "x" * 200_000}, "child")) is not None)
check("a signed medication record is refused on the generic lane",
      (acting(form("create", {}, "child", resource="marEntries")) or {}).get("code") == "be_another_refused")
check("a read of the same resource goes on", acting(form("list", {}, "child", resource="marEntries")) is None)
check("Be Back goes on", acting(form("beAnotherStop", {}, "child")) is None)
check("an action off the list goes on", acting(form("taskBoardSave", {}, "child")) is None)
check("the chat keeps its own answer", acting(form("chatSend", {}, "child")) is None)
check("the master's own session is not switched", acting(form("prefsSet", {}, "master-tok")) is None)
ns["_token_user"] = {}
check("an unnamed target reads as another account",
      "acting as another account:" in (acting(form("prefsSet", {}, "child")) or {}).get("message", ""))

print(f"\n{results['ok']} ok, {len(results['failed'])} failed")
sys.exit(1 if results["failed"] else 0)
