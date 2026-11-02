#!/usr/bin/env python3
"""API promotion of the serving deployment, only after a scratch deployment of the same version passes the probes."""
from __future__ import annotations

import json
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

ENV_PATH = Path("/opt/docker/asa-hub/server/.tools.env")
SCRIPT_ID = "1BUjxOKX6vqZFfhHW4aP2_qW5LFZ8dF0E9MBlHiBSFqrW9EEXOO0x5kPr"
API = "https://script.googleapis.com/v1/projects"
# must equal asa-hub-snapshot's HUB_EXEC_URL; the highest versionNumber is not the serving one
SERVING_EXEC = "https://script.google.com/macros/s/AKfycbz9ZHqh_XOhEMMRoj_kgcuLDjc53oKKFgmh8tOomj6FIuQVJp6Hl2tyq8RXSLwkwOQScA/exec"


def env(key: str) -> str:
    for line in ENV_PATH.read_text().splitlines():
        line = line.strip()
        if line.startswith(f"{key}="):
            return line.split("=", 1)[1].strip().strip("'\"")
    sys.exit(f"{key} not found in {ENV_PATH}")


def access_token() -> str:
    body = urllib.parse.urlencode({
        "client_id": env("GS_GOOGLE_CLIENT_ID"),
        "client_secret": env("GS_GOOGLE_CLIENT_SECRET"),
        "refresh_token": env("GS_GOOGLE_REFRESH_TOKEN"),
        "grant_type": "refresh_token",
    }).encode()
    req = urllib.request.Request("https://oauth2.googleapis.com/token", data=body, method="POST")
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)["access_token"]


def api(token: str, path: str, method: str = "GET", payload: dict | None = None) -> dict:
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(f"{API}/{path}", data=data, method=method)
    req.add_header("Authorization", f"Bearer {token}")
    req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, timeout=90) as r:
        raw = r.read()
        return json.loads(raw) if raw else {}


def call_exec(url: str, body: dict) -> dict:
    """Google sometimes answers an anonymous POST with an HTML interstitial or a 404; both are retried."""
    data = ("body=" + urllib.parse.quote(json.dumps(body))).encode()
    last = ""
    for attempt in range(5):
        req = urllib.request.Request(url, data=data, method="POST")
        req.add_header("Content-Type", "application/x-www-form-urlencoded;charset=UTF-8")
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                raw = r.read().decode("utf-8", "replace")
            return json.loads(raw)
        except json.JSONDecodeError:
            last = raw[:200]
        except urllib.error.HTTPError as e:
            last = f"HTTP {e.code}"
        time.sleep(3 + attempt * 3)
    sys.exit(f"exec answered wrong 5 times (interstitial/propagation?): {last!r}. ABORT.")


def probe(url: str, label: str) -> None:
    """needsBootstrap false proves the deployment identity reads the users tab; a wrong user reports True."""
    out = call_exec(url, {"action": "authStatus"})
    if out.get("status") != 200 or (out.get("data") or {}).get("needsBootstrap") is not False:
        sys.exit(f"{label}: authStatus answered {out} — expected needsBootstrap:false. ABORT.")
    print(f"  {label}: authStatus -> needsBootstrap:false (DB users tab readable, admins visible)")
    out = call_exec(url, {"resource": "clients", "action": "list"})
    if out.get("status") != 401:
        sys.exit(f"{label}: anonymous list answered {out} — expected 401. ABORT.")
    print(f"  {label}: anonymous list -> 401 (session gate intact)")


def main() -> None:
    token = access_token()

    print("1/5 versioning HEAD…")
    ver = api(token, f"{SCRIPT_ID}/versions", "POST",
              {"description": "clients cleanup + wellbeing image generation (2026-08-05, operator-authorized API promotion)"})
    version = ver["versionNumber"]
    print(f"  version {version}")

    print("2/5 scratch deployment of the new version…")
    dep = api(token, f"{SCRIPT_ID}/deployments", "POST", {
        "versionNumber": version,
        "manifestFileName": "appsscript",
        "description": "scratch pre-promotion probe — auto-deleted",
    })
    dep_id = dep["deploymentId"]
    try:
        url = ""
        for _ in range(10):
            got = api(token, f"{SCRIPT_ID}/deployments/{dep_id}")
            for ep in got.get("entryPoints", []):
                if ep.get("entryPointType") == "WEB_APP":
                    url = ep["webApp"]["url"]
            if url:
                break
            time.sleep(2)
        if not url:
            sys.exit("scratch deployment exposed no web app URL. ABORT (production untouched).")
        print("3/5 probing the scratch deployment…")
        probe(url, "scratch")
    finally:
        api(token, f"{SCRIPT_ID}/deployments/{dep_id}", "DELETE")
        print("  scratch deleted")

    print("4/5 pointing the SERVING deployment at the new version…")
    serving_id = ""
    deps = api(token, f"{SCRIPT_ID}/deployments")
    for d in deps.get("deployments", []):
        for ep in d.get("entryPoints", []):
            if ep.get("entryPointType") == "WEB_APP" and ep["webApp"]["url"] == SERVING_EXEC:
                serving_id = d["deploymentId"]
    if not serving_id:
        sys.exit("could not find the serving deployment by its /exec URL. ABORT.")
    old = api(token, f"{SCRIPT_ID}/deployments/{serving_id}")
    old_version = old.get("deploymentConfig", {}).get("versionNumber")
    print(f"  serving deployment {serving_id[:16]}… currently at version {old_version}")
    api(token, f"{SCRIPT_ID}/deployments/{serving_id}", "PUT", {
        "deploymentConfig": {
            "versionNumber": version,
            "manifestFileName": "appsscript",
            "description": old.get("deploymentConfig", {}).get("description", "") or "Hub web app",
        },
    })
    print(f"  now at version {version} (rollback: same PUT with versionNumber {old_version})")

    print("5/5 probing PRODUCTION…")
    probe(SERVING_EXEC, "production")

    print(f"\ndone — the platform serves version {version}. Previous version was {old_version}.")


if __name__ == "__main__":
    main()
