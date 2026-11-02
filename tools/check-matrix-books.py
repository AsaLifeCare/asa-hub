#!/usr/bin/env python3
"""Matrix book usage from the live Registry; a context with no Last Read stamp is read by nothing."""
import json, subprocess, sys, time, urllib.request

RELAY = "asa-hub-snapshot"


def relay(cmd: str) -> str:
    out = subprocess.run(["docker", "exec", RELAY, "sh", "-c", cmd],
                         capture_output=True, text=True)
    if out.returncode != 0:
        sys.exit(f"could not reach {RELAY}: {out.stderr.strip()}")
    return out.stdout.strip()


def main() -> int:
    url = relay("echo $HUB_EXEC_URL")
    secret = relay("echo $HUB_SERVICE_SECRET")
    if not url or not secret:
        sys.exit(f"{RELAY} has no HUB_EXEC_URL / HUB_SERVICE_SECRET")
    deep = "--deep" in sys.argv
    body = json.dumps({"service_secret": secret, "action": "hiringMatrixStatus",
                       "payload": {"deep": deep}}).encode()
    # urllib re-POSTs Apps Script's 302 and the echo URL answers 404: follow by hand, retry empty bodies.
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *a, **k):
            return None
    opener = urllib.request.build_opener(NoRedirect)
    env = None
    for attempt in range(4):
        req = urllib.request.Request(url, data=body,
                                     headers={"Content-Type": "application/json"})
        try:
            resp = opener.open(req, timeout=120)
        except urllib.error.HTTPError as e:
            if e.code not in (301, 302, 303, 307):
                raise
            resp = urllib.request.urlopen(e.headers["Location"], timeout=120)
        raw = resp.read()
        try:
            env = json.loads(raw)
            break
        except ValueError:
            time.sleep(3 * (attempt + 1))
    if env is None:
        sys.exit("the echo answered an empty body four times — try again")
    if env.get("status") != 200:
        sys.exit(f"the backend answered {env.get('status')}: {env.get('message')}")
    data = env.get("data") or {}
    rows = data.get("rows") or []
    print(f"runtime book        {data.get('runtime', '')}")
    print(f"{'context':<16} {'switch':<7} {'last read':<26} "
          + ("tabs" if deep else ""))
    on = used = 0
    for r in rows:
        if r.get("status") == "on":
            on += 1
        if str(r.get("last_read") or "").strip():
            used += 1
        extra = ""
        if deep:
            extra = str(r.get("tabs", "")) if r.get("opens", True) else "DOES NOT OPEN"
        print(f"{r.get('context', ''):<16} {r.get('status', ''):<7} "
              f"{str(r.get('last_read') or '—'):<26} {extra}")
    print(f"\n{len(rows)} contexts · {on} on · {used} ever read by the engine")
    return 0


if __name__ == "__main__":
    sys.exit(main())
