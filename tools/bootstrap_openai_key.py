#!/usr/bin/env python3
"""One-time: set OPENAI_API_KEY in Script properties via a scratch deployment; the serving one is never touched."""
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
    data = ("body=" + urllib.parse.quote(json.dumps(body))).encode()
    req = urllib.request.Request(url, data=data, method="POST")
    req.add_header("Content-Type", "application/x-www-form-urlencoded;charset=UTF-8")
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def main() -> None:
    openai_key = env("OPENAI_API_KEY")
    token = access_token()

    print("creating version of HEAD…")
    ver = api(token, f"{SCRIPT_ID}/versions", "POST",
              {"description": "scratch: one-time OPENAI_API_KEY bootstrap (2026-08-05)"})
    version = ver["versionNumber"]
    print(f"  version {version}")

    print("creating SCRATCH deployment (the serving one is untouched)…")
    dep = api(token, f"{SCRIPT_ID}/deployments", "POST", {
        "versionNumber": version,
        "manifestFileName": "appsscript",
        "description": "scratch bootstrap — auto-deleted by tools/bootstrap_openai_key.py",
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
            sys.exit("scratch deployment exposed no web app URL")
        print(f"  scratch /exec ready")

        print("writing OPENAI_API_KEY into Script properties…")
        out = call_exec(url, {"action": "bootstrapOpenAiKey", "payload": {"value": openai_key}})
        print(f"  answer: {out}")
        if out.get("status") != 200:
            sys.exit("the write was refused — nothing changed")

        check = call_exec(url, {"action": "bootstrapOpenAiKey", "payload": {"value": openai_key}})
        if check.get("status") == 409:
            print(f"  verified: {check.get('message')}")
        else:
            print(f"  UNEXPECTED verify answer: {check}")
    finally:
        print("deleting the scratch deployment…")
        api(token, f"{SCRIPT_ID}/deployments/{dep_id}", "DELETE")
        print("  deleted")

    print("\ndone — the key lives in Script properties now.")


if __name__ == "__main__":
    main()
