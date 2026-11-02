#!/usr/bin/env python3
"""A paper filed by Python: certDocUploadPlan's refusals and plan, and certDocUpload's ledger row decided (never kept),
on this branch's modules in asa-hub-db-sync; then, in the relay, the asatech Drive token proved and a paper decoded.
Nothing is written to Drive or to the ledger.

    python3 tools/test-cert-filing.py
"""
from __future__ import annotations

import base64
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "app"
MODULES = ("gsjs", "hubdb", "editions", "scope", "drive", "locations", "clients", "staff_views", "cert_reads", "staff",
           "writes", "client_writes", "cert_docs")
results = {"ok": 0, "failed": []}


def check(name: str, ok: bool, detail=None) -> None:
    if ok:
        results["ok"] += 1
        print(f"  ok   {name}")
    else:
        results["failed"].append(name)
        print(f"  FAIL {name}" + (f"\n       {json.dumps(detail, default=str)[:700]}" if detail is not None else ""))


DRIVER = r'''
import base64, json, sys, types
blob = json.loads(base64.b64decode(sys.stdin.readline()).decode())
for name in blob["order"]:
    m = types.ModuleType(name); m.__file__ = name + ".py"; sys.modules[name] = m
for name in blob["order"]:
    exec(compile(blob["src"][name], name + ".py", "exec"), sys.modules[name].__dict__)
# the Smart Comms desk's whole import closure is not streamed: its test-mode switch reads as on
desk = types.ModuleType("smart_comms_desk"); desk.test_mode_state = lambda cfg: {"on": True}
sys.modules["smart_comms_desk"] = desk
import hubdb, gsjs, locations as L, scope as sc, drive as dr, cert_docs as CD
db = hubdb.HubDb(); drv = dr.Drive()
users = L.Reads(db, drv).users()
boss = next((u for u in users if not gsjs.str_(u.get("mergedinto")) and sc.is_master_email(u.get("email"))
             and gsjs.str_(u.get("role")) == "admin"), None)
master = sc.user_from_row(boss)
def sess(): return L.Session(L.Reads(db, drv), master)
base = {"person": "Adrianna Williams", "req_id": "cpr", "filename": "cpr card.pdf", "mime": "application/pdf",
        "b64_chars": 1000}
out = {}
out["plan"] = CD.upload_plan(sess(), base)
out["nobody"] = CD.upload_plan(sess(), {**base, "person": ""})
out["no_req"] = CD.upload_plan(sess(), {**base, "req_id": "nope"})
out["bad_type"] = CD.upload_plan(sess(), {**base, "filename": "x.docx", "mime": "application/msword"})
out["no_file"] = CD.upload_plan(sess(), {**base, "b64_chars": 0})
out["too_big"] = CD.upload_plan(sess(), {**base, "b64_chars": 21000001})
out["onboarding"] = CD.upload_plan(sess(), {**base, "req_id": "w4_form"})
d = CD.upload(sess(), {**base, "filed": {"file_id": "1AbCdEfGhIjKlMnOpQrStUv", "shared": False}})
out["upload"] = {"status": (d.answer or {}).get("status"), "edits": [{"tab": e.get("tab_name"), "kind": e.get("kind"),
                 "cells": e.get("cells")} for e in (d.edits or [])], "data": (d.answer or {}).get("data")}
d2 = CD.upload(sess(), {**base, "filed": {}})
out["upload_nofile"] = (d2.answer or {}).get("status")
# My Requirements: a person files their own onboarding form under its label, with no requirement id
import staff as SP
reads = L.Reads(db, drv)
form = next(r for r in SP.requirements(reads) if gsjs.str_(r.get("category")).lower() == "onboarding"
            and gsjs.str_(r.get("enabled")).lower() == "yes")
staffer = None
for u in users:
    if gsjs.str_(u.get("mergedinto")) or gsjs.str_(u.get("role")) != "staff":
        continue
    cand = sc.user_from_row(u)
    if SP.compliance_self(reads, cand)["key"]:
        staffer = cand
        break
own = {"person": "", "req_id": "", "cert": gsjs.str_(form.get("label")), "filename": "form.pdf",
       "mime": "application/pdf", "b64_chars": 1000}
mine = CD.upload_plan(L.Session(L.Reads(db, drv), staffer), own)
d3 = CD.upload(L.Session(L.Reads(db, drv), staffer), {**own, "filed": {"file_id": "1AbCdEfGhIjKlMnOpQrStUv"}})
cells3 = ((d3.edits or [{}])[0].get("cells") or {})
out["own_form"] = {"plan": mine, "upload": (d3.answer or {}).get("status"), "read_state": cells3.get("read_state"),
                   "cert": cells3.get("cert"), "label": gsjs.str_(form.get("label"))}
print(json.dumps(out, default=str))
'''

RELAY = r'''
import base64, sys
sys.path.insert(0, "/srv/app")
import cert_papers as P
d = P.owner_drive()
who = d.about().get(fields="user(emailAddress)").execute()["user"]["emailAddress"]
pdf = base64.b64encode(b"%PDF-1.4\n%test\n").decode()
ok = P.decode(pdf, "application/pdf") == b"%PDF-1.4\n%test\n"
refusals = []
for b64, mime in ((pdf, "application/msword"), ("", "application/pdf"), ("!!!", "application/pdf")):
    try:
        P.decode(b64, mime)
        refusals.append("taken")
    except P.Refused:
        refusals.append("refused")
print(who, ok, ",".join(refusals))
'''


def main() -> int:
    blob = {"order": list(MODULES), "src": {m: (APP / f"{m}.py").read_text(encoding="utf-8") for m in MODULES}}
    got = subprocess.run(["docker", "exec", "-i", "asa-hub-db-sync", "python", "-c", DRIVER],
                         input=base64.b64encode(json.dumps(blob).encode()) + b"\n", capture_output=True, timeout=600)
    if got.returncode != 0:
        print(got.stderr.decode()[-2500:])
        return 1
    py = json.loads(got.stdout.decode().strip().splitlines()[-1])
    p = py["plan"]
    print(json.dumps(p)[:600])
    check("the plan names the roster's person, the requirement's label and folder, and owes a reading",
          p["status"] == 200 and p["data"]["person"] == "Adrianna Williams" and p["data"]["req_id"] == "cpr"
          and p["data"]["read_owed"] and p["data"]["folder"] == p["data"]["cert"] and p["data"]["platform_root"], p)
    check("the master names nobody: refused, nothing filed", py["nobody"]["status"] == 400, py["nobody"])
    check("a requirement not in the catalogue is refused", py["no_req"]["status"] == 400, py["no_req"])
    check("a Word file is refused", py["bad_type"]["status"] == 400, py["bad_type"])
    check("no file, or one over 15MB, is refused",
          py["no_file"]["status"] == 400 and py["too_big"]["status"] == 400, [py["no_file"], py["too_big"]])
    check("an onboarding form is HR's: refused", py["onboarding"]["status"] == 400, py["onboarding"])
    u = py["upload"]
    cells = (u["edits"] or [{}])[0].get("cells") or {}
    check("the filing's ledger row is one appended cert_uploads row with all 23 columns, pending its reading",
          u["status"] == 200 and len(u["edits"]) == 1 and u["edits"][0]["tab"] == "cert_uploads"
          and u["edits"][0]["kind"] == "append" and len(cells) == 23 and cells.get("read_state") == "pending"
          and cells.get("file_id") == "1AbCdEfGhIjKlMnOpQrStUv", u)
    check("the answer carries what the screens read: id, url, read_state", u["data"]["id"] and u["data"]["url"]
          and u["data"]["read_state"] == "pending", u["data"])
    check("a filing that names no file is refused", py["upload_nofile"] == 400, py["upload_nofile"])
    own = py["own_form"]
    check("a person's own onboarding form, filed by its label with no id, is filed on their record and owes no reading",
          own["plan"]["status"] == 200 and own["plan"]["data"]["read_owed"] is False and own["upload"] == 200
          and own["read_state"] == "" and own["cert"] == own["label"], own)
    src = (ROOT / "server" / "cert_papers.py").read_text(encoding="utf-8")
    got = subprocess.run(["docker", "exec", "-i", "asa-hub-snapshot", "python3", "-c",
                          "import sys; exec(sys.stdin.read())"],
                         input=(f"import types, sys; m = types.ModuleType('cert_papers'); "
                                f"m.__file__ = '/srv/app/cert_papers.py'; "
                                f"exec(compile({src!r}, 'cert_papers.py', 'exec'), m.__dict__); "
                                f"sys.modules['cert_papers'] = m\n" + RELAY).encode(), capture_output=True, timeout=120)
    line = got.stdout.decode().strip().splitlines()[-1] if got.stdout.strip() else got.stderr.decode()[-600:]
    print("relay:", line)
    who, ok, refusals = (line.split(" ") + ["", "", ""])[:3]
    check("in the relay the Drive token acts as asatech@asalifecare.com", who == "asatech@asalifecare.com", line)
    check("a paper is decoded; a wrong type, no bytes and bad base64 are refused",
          ok == "True" and refusals == "refused,refused,refused", line)
    print(f"\ntest-cert-filing: {results['ok']} ok, {len(results['failed'])} failed")
    return 1 if results["failed"] else 0


if __name__ == "__main__":
    sys.exit(main())
