#!/usr/bin/env python3
"""The four file-open doors on Python, in the running asa-hub-app: real files open as Apps Script answers them, and
a file of another house or client is refused. Prints sizes and types only, never a name, an id or a byte."""
from __future__ import annotations

import base64
import json
import re
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "app"
# exec order: each module after the ones it reads at import time
MODULES = ("gsjs", "hubdb", "scope", "drive", "locations", "clients", "client_meds", "client_sources", "client_app",
           "writes", "client_writes", "main")
RUNNER = "asa-hub-app"
DOORS = {"locationDocFile": ("Locations.gs", "locations"),
         "clientProfileDocFile": ("ClientProfiles.gs", "clients"),
         "clientSourceMarDocFile": ("ClientSourceMar.gs", "clients"),
         "clientSourceFinanceFile": ("ClientSourceFinance.gs", "clients")}
REFUSALS = {"locationDocFile": "This house names no such document.",
            "clientProfileDocFile": "This client names no such document.",
            "clientSourceMarDocFile": "This client names no such MARS paper.",
            "clientSourceFinanceFile": "This client's funds name no such document."}

results: dict[str, Any] = {"ok": 0, "failed": []}


def check(name: str, ok: bool, detail: Any = None) -> None:
    if ok:
        results["ok"] += 1
        print(f"  ok   {name}")
    else:
        results["failed"].append(name)
        print(f"  FAIL {name}" + (f" — {str(detail)[:300]}" if detail is not None else ""))


def gs_shape(gs_file: str, action: str, text_part: bool = False) -> dict[str, Any]:
    """The keys of the door's 200 answer, read off its .gs source: {key: None | {nested key: None}}."""
    src = (ROOT / "apps-script" / gs_file).read_text(encoding="utf-8")
    start = src.index(f"HUB_ACTIONS.{action} = function")
    if text_part:
        start = src.index("function csmPaperText_")
    at = src.index("{ status: 200, data: {", start) + len("{ status: 200, data: ")
    depth, end = 0, at
    for i in range(at, len(src)):
        depth += {"{": 1, "}": -1}.get(src[i], 0)
        if depth == 0:
            end = i + 1
            break
    body = re.sub(r"'[^']*'", "''", src[at:end])

    def keys(s: str) -> dict[str, Any]:
        out: dict[str, Any] = {}
        depth, i = 0, 1
        while i < len(s) - 1:
            if s[i] in "{(":
                depth += 1
            elif s[i] in "})":
                depth -= 1
            elif depth == 0:
                m = re.match(r"[\s,]*([A-Za-z_]\w*)\s*:", s[i:])
                if m:
                    k = m.group(1)
                    j = i + m.end()
                    rest = s[j:].lstrip()
                    if rest.startswith("{"):
                        k0 = j + (len(s[j:]) - len(rest))
                        d, e = 0, k0
                        for q in range(k0, len(s)):
                            d += {"{": 1, "}": -1}.get(s[q], 0)
                            if d == 0:
                                e = q + 1
                                break
                        out[k] = keys(s[k0:e])
                        i = e
                        continue
                    out[k] = None
                    i = j
                    continue
            i += 1
        return out

    return keys(body)


def shape_of(v: Any) -> Any:
    return {k: shape_of(x) if isinstance(x, dict) else None for k, x in v.items()} if isinstance(v, dict) else None


DRIVER = r'''
import base64, json, sys, time, types
blob = json.loads(base64.b64decode(sys.stdin.readline()).decode())
for name in blob["order"]:
    m = types.ModuleType(name); m.__file__ = name + ".py"; sys.modules[name] = m
for name in blob["order"]:
    exec(compile(blob["src"][name], name + ".py", "exec"), sys.modules[name].__dict__)
import main as M, gsjs, locations as L, scope as sc
# no laid write is read or settled from here
M.STORE = M.writes.Store(dsn="")
M.CLIENT_STORE = M.client_writes.Store(dsn="")
job = blob["job"]
users = L.Reads(M.DB, M.DRIVE).users()
boss = next((u for u in users if not gsjs.str_(u.get("mergedinto")) and sc.is_master_email(u.get("email"))
             and gsjs.str_(u.get("role")) == "admin"), None)
said = {"uid": gsjs.str_(boss.get("userid")) if boss else "", "role": "admin", "is_master": True}
MAGIC = {"application/pdf": lambda b: b[:5] == b"%PDF-", "image/png": lambda b: b[:8] == b"\x89PNG\r\n\x1a\n",
         "image/jpeg": lambda b: b[:3] == b"\xff\xd8\xff", "image/gif": lambda b: b[:4] == b"GIF8",
         "image/webp": lambda b: b[:4] == b"RIFF" and b[8:12] == b"WEBP",
         "image/heic": lambda b: b[4:8] == b"ftyp", "image/heif": lambda b: b[4:8] == b"ftyp"}

def call(app_id, action, payload):
    t = time.monotonic()
    res = M._run(M.APPS[app_id], action, said, payload)
    body = json.loads(res.body)
    return {"http": res.status_code, "env": body, "s": round(time.monotonic() - t, 2),
            "as_of": bool(res.headers.get("x-hub-as-of"))}

def opened(app_id, action, payload):
    """A door's answer, its bytes judged here and dropped: only sizes, types and the answer's keys leave."""
    got = call(app_id, action, payload)
    env = got["env"]
    out = {"http": got["http"], "s": got["s"], "as_of": got["as_of"], "status": env.get("status"),
           "message": env.get("message") or "", "defer": env.get("defer") or ""}
    data = env.get("data")
    if env.get("status") == 200 and isinstance(data, dict):
        out["shape"] = {k: ({kk: None for kk in v} if isinstance(v, dict) else None) for k, v in data.items()}
        if "b64" in data:
            raw = base64.b64decode(data["b64"])
            out.update(mime=data.get("mime"), size=data.get("size"), decoded=len(raw), exported=data.get("exported"),
                       magic=bool(MAGIC.get(data.get("mime"), lambda b: False)(raw)),
                       id_echo=data.get("id") == payload.get("id", payload.get("file_id")),
                       named=bool(gsjs.str_(data.get("name"))))
            if isinstance(data.get("digest"), dict):
                out["digest_chars"] = data["digest"].get("chars")
        if "text" in data:
            out.update(chars=data.get("chars"), truncated=data.get("truncated"),
                       text_ok=isinstance(data.get("text"), str))
    return out

def ids(rows, key="file_id"):
    return list(dict.fromkeys(r.get(key) for r in rows or [] if isinstance(r, dict) and r.get(key)))

out = {"master": bool(boss), "drive": M.DRIVE.available, "doors": {}}
# ---- Locations: a house's ISPs and the company policies, from its own Documents read
houses = {}
for h in L.Reads(M.DB, M.DRIVE).homes()[: job["houses"]]:
    got = call("locations", "locationDocuments", {"house": h["code"]})
    d = got["env"].get("data") if got["env"].get("status") == 200 else None
    if not d:
        continue
    gb = (d.get("guidebook") or {}).get("files") or []
    houses[h["code"]] = {"isps": ids(d.get("isps"), "isp_doc_id"), "other": ids(d.get("policies"), "drive_id") + ids(gb, "id")}
with_isp = [c for c, v in houses.items() if v["isps"]]
door = out["doors"]["locationDocFile"] = {"opened": [], "refusal": None}
if with_isp:
    a = with_isp[0]
    # a plan (a PDF) and a policy (often a Google file, exported)
    for fid in list(dict.fromkeys(houses[a]["isps"][:1] + houses[a]["other"] + houses[a]["isps"]))[: job["tries"]]:
        door["opened"].append(opened("locations", "locationDocFile", {"house": a, "id": fid}))
        if sum(1 for o in door["opened"] if o["status"] == 200) >= 2:
            break
    mine = set(houses[a]["isps"] + houses[a]["other"])
    other = next((f for c in with_isp[1:] for f in houses[c]["isps"] if f not in mine), "")
    if other:
        door["refusal"] = opened("locations", "locationDocFile", {"house": a, "id": other})
# ---- Clients: the plans, the MARS papers and the funds files, each from its own read
roster = call("clients", "clientProfileRoster", {})["env"].get("data") or {}
keys = [c.get("client_key") for c in roster.get("clients") or [] if c.get("client_key")]
found = {"clientProfileDocFile": {}, "clientSourceMarDocFile": {}, "clientSourceFinanceFile": {}}
text_paper = None
for key in keys[: job["clients"]]:
    if all(len(v) >= 3 for v in found.values()):
        break
    if len(found["clientProfileDocFile"]) < 3:
        d = call("clients", "clientProfileCare", {"client": key, "tab": "plans"})["env"].get("data") or {}
        got = ids(d.get("rows"))
        if got:
            found["clientProfileDocFile"][key] = got
    if len(found["clientSourceMarDocFile"]) < 3:
        d = call("clients", "clientSourceMar", {"client": key})["env"].get("data") or {}
        rows = ((d.get("tabs") or {}).get("papers") or {}).get("rows") or []
        got = ids(rows)
        if got:
            found["clientSourceMarDocFile"][key] = got
            if text_paper is None:
                text_paper = next(({"client": key, "file_id": r["file_id"], "part": "text"} for r in rows
                                   if r.get("file_id") and r.get("has_text")), None)
    if len(found["clientSourceFinanceFile"]) < 3:
        d = call("clients", "clientSourceFunds", {"client": key})["env"].get("data") or {}
        tabs = d.get("tabs") or {}
        got = ids((tabs.get("receipts") or {}).get("rows")) + ids((d.get("documents") or {}).get("rows")) + \
            [t["receipt"]["file_id"] for t in (tabs.get("transactions") or {}).get("rows") or []
             if isinstance(t.get("receipt"), dict) and t["receipt"].get("file_id")]
        if got:
            found["clientSourceFinanceFile"][key] = list(dict.fromkeys(got))
ID_FIELD = {"clientProfileDocFile": "file_id", "clientSourceMarDocFile": "file_id", "clientSourceFinanceFile": "id"}
for action, per in found.items():
    door = out["doors"][action] = {"opened": [], "refusal": None, "clients_with_files": len(per)}
    owners = list(per)
    tried = []
    for key in owners:
        for fid in per[key]:
            if len(tried) >= job["tries"] or sum(1 for o in door["opened"] if o["status"] == 200) >= 2:
                break
            if fid in tried:
                continue
            tried.append(fid)
            door["opened"].append(opened("clients", action, {"client": key, ID_FIELD[action]: fid}))
    if len(owners) >= 2:
        a = owners[0]
        other = next((f for k in owners[1:] for f in per[k] if f not in set(per[a])), "")
        if other:
            door["refusal"] = opened("clients", action, {"client": a, ID_FIELD[action]: other})
out["doors"]["clientSourceMarDocFile"]["text"] = opened("clients", "clientSourceMarDocFile", text_paper) if text_paper else None
# the doors' shared bytes on a Google file (getAs PDF), when no listed file above was one
out["export"] = None
admin = M.DB.prop("ADMIN_DOCS_FOLDER_ID")
if admin:
    q = ("'" + admin + "' in parents and trashed = false and mimeType contains 'application/vnd.google-apps.' "
         "and mimeType != 'application/vnd.google-apps.folder' and mimeType != 'application/vnd.google-apps.form'")
    hit = (M.DRIVE._get(M.drive.API, {"q": q, "fields": "files(id)", "pageSize": 1,
                                      "includeItemsFromAllDrives": "true"}).get("files") or [None])[0]
    if hit:
        t = time.monotonic()
        got = L.doc_file(L.Reads(M.DB, M.DRIVE), hit["id"])
        raw = base64.b64decode(got.get("b64") or "")
        out["export"] = {"mime": got.get("mime"), "exported": got.get("exported"), "size": got.get("size"),
                         "decoded": len(raw), "magic": raw[:5] == b"%PDF-", "s": round(time.monotonic() - t, 2)}
print(json.dumps(out))
'''


def run_python(job: dict) -> dict:
    blob = {"order": list(MODULES), "src": {n: (APP / f"{n}.py").read_text(encoding="utf-8") for n in MODULES},
            "job": job}
    payload = base64.b64encode(json.dumps(blob).encode()) + b"\n"
    got = subprocess.run(["docker", "exec", "-i", RUNNER, "python", "-c", DRIVER], input=payload, capture_output=True,
                         timeout=1800)
    if got.returncode != 0:
        raise RuntimeError(f"the Python side did not run in {RUNNER}: {got.stderr.decode()[-600:]}")
    return json.loads(got.stdout.decode().strip().splitlines()[-1])


def static() -> None:
    print("\nSTATIC — the relay carries the four doors as it carries Apps Script's")
    src = (ROOT / "server" / "snapshot_service.py").read_text(encoding="utf-8")
    no_receipt = src[src.index("RELAY_NO_RECEIPT_ACTIONS = frozenset("):src.index("RELAY_BYTE_READS = frozenset(")]
    backend = src[src.index("BACKEND_APPS: dict[str, dict[str, Any]] = {"):src.index("_BACKEND_ACTIONS: dict")]
    for action, (_gs, app_id) in DOORS.items():
        block = backend[backend.index(f'"{app_id}": {{'):]
        reads = block[block.index('"reads": frozenset({'):block.index("})")]
        check(f"{action}: no receipt, a byte read, and on {app_id}'s Python reads",
              f'"{action}"' in no_receipt and re.search(r"(DocFile|DocRead|File|Transcript)$", action) is not None
              and f'"{action}"' in reads)
    files = [str(p) for p in sorted(APP.glob("*.py"))] + [str(ROOT / "server" / "snapshot_service.py")]
    got = subprocess.run([sys.executable, "-m", "py_compile", *files], capture_output=True)
    check("py_compile app/*.py server/snapshot_service.py", got.returncode == 0, got.stderr.decode()[-300:])


def functional() -> None:
    print(f"\nFUNCTIONAL — the doors as master, in {RUNNER} (modules streamed in, nothing restarted)")
    started = time.time()
    py = run_python({"houses": 12, "clients": 80, "tries": 6})
    print(f"  ran in {time.time() - started:.0f}s; master on the users row: {py['master']}; Drive: {py['drive']}")
    check("the master and Drive are both there", py["master"] and py["drive"])
    for action, (gs_file, _app) in DOORS.items():
        want = gs_shape(gs_file, action)
        door = py["doors"].get(action) or {}
        print(f"\n  {action} — Apps Script's answer keys: {json.dumps(want)}")
        good = 0
        for i, o in enumerate(door.get("opened") or [], start=1):
            if o["status"] != 200:
                print(f"    file {i}: {o['status'] or o['http']} in {o['s']}s — "
                      f"{('left to Apps Script: ' + o['defer']) if o['defer'] else o['message']}")
                continue
            good += 1
            print(f"    file {i}: 200 in {o['s']}s — {o['mime']}, {o['size']} bytes"
                  f"{' (exported from a Google file)' if o['exported'] else ''}"
                  + (f", OCR digest {o['digest_chars']} chars" if "digest_chars" in o else ""))
            check(f"{action} file {i}: Apps Script's keys, the id echoed, a name", o["shape"] == want and o["id_echo"]
                  and o["named"], f"python={json.dumps(o['shape'])}")
            check(f"{action} file {i}: {o['size']} bytes that decode whole and are the {o['mime']} they say",
                  o["size"] > 0 and o["decoded"] == o["size"] and o["magic"] and o["as_of"])
        check(f"{action}: two real files opened by Python", good >= 2, f"{good} opened")
        ref = door.get("refusal")
        if ref is None:
            check(f"{action}: a refusal could be tried (another owner's file)", False, "no second owner with a file")
        else:
            check(f"{action}: another {'house' if action == 'locationDocFile' else 'client'}'s file is refused "
                  f"({ref['status']} '{ref['message']}')",
                  ref["status"] == 404 and ref["message"] == REFUSALS[action], ref.get("defer"))
    text = (py["doors"].get("clientSourceMarDocFile") or {}).get("text")
    if text is not None:
        want = gs_shape("ClientSourceMar.gs", "clientSourceMarDocFile", text_part=True)
        if text["status"] == 200:
            print(f"\n  clientSourceMarDocFile part=text: 200 in {text['s']}s — {text['chars']} chars"
                  f"{' (cut)' if text['truncated'] else ''}")
            check("part=text: Apps Script's keys", text["shape"] == want and text["text_ok"],
                  f"python={json.dumps(text['shape'])} apps_script={json.dumps(want)}")
        else:
            print(f"\n  clientSourceMarDocFile part=text: {text['status']} — {text['defer'] or text['message']}")
    exp = py.get("export")
    if exp is not None:
        print(f"\n  a Google file through the doors' bytes: {exp['mime']}, {exp['size']} bytes in {exp['s']}s")
        check("a Google file is exported to PDF (getAs)", exp["exported"] is True and exp["mime"] == "application/pdf"
              and exp["size"] > 0 and exp["decoded"] == exp["size"] and exp["magic"])


def main() -> int:
    static()
    functional()
    print(f"\n{results['ok']} ok, {len(results['failed'])} failed")
    for f in results["failed"]:
        print(f"  - {f}")
    return 1 if results["failed"] else 0


if __name__ == "__main__":
    sys.exit(main())
