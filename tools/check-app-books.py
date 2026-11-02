#!/usr/bin/env python3
"""Watch a book judge a real person — the flip-day debugger.

    python3 tools/check-app-books.py <context> [subject_id] [--facts]

Prints every condition of that context's book with its verdict, and with
--facts the fact each rule asked and what it actually held. A wrong rule
and a missing fact look identical on a card; here they do not.
"""
import json, subprocess, sys, time, urllib.request

RELAY = "asa-hub-snapshot"


def relay(cmd: str) -> str:
    out = subprocess.run(["docker", "exec", RELAY, "sh", "-c", cmd],
                         capture_output=True, text=True)
    if out.returncode != 0:
        sys.exit(f"could not reach {RELAY}: {out.stderr.strip()}")
    return out.stdout.strip()


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None


def ask(action, payload):
    url, secret = relay("echo $HUB_EXEC_URL"), relay("echo $HUB_SERVICE_SECRET")
    body = json.dumps({"service_secret": secret, "action": action,
                       "payload": payload}).encode()
    opener = urllib.request.build_opener(NoRedirect)
    for attempt in range(4):
        req = urllib.request.Request(url, data=body,
                                     headers={"Content-Type": "application/json"})
        try:
            resp = opener.open(req, timeout=120)
        except urllib.error.HTTPError as e:
            if e.code not in (301, 302, 303, 307):
                raise
            try:
                resp = urllib.request.urlopen(e.headers["Location"], timeout=120)
            except urllib.error.HTTPError:
                time.sleep(3 * (attempt + 1))
                continue
        try:
            return json.loads(resp.read())
        except ValueError:
            time.sleep(3 * (attempt + 1))
    sys.exit("the echo answered nothing four times — try again")


def main() -> int:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if not args:
        sys.exit(__doc__)
    context, subject = args[0], (args[1] if len(args) > 1 else "")
    env = ask("hiringMatrixEval", {"context": context, "subject_id": subject})
    if env.get("status") != 200:
        sys.exit(f"{env.get('status')}: {env.get('message')}")
    d = env["data"]
    print(f"{context}  book {d['book'][:14]}…  switch {d['switch']}  "
          f"subject {subject or '(none)'}  facts known {d['facts_known']}")
    print("  " + " · ".join(f"{k}:{v}" for k, v in sorted(d["tally"].items())))
    print()
    for c in d["conditions"]:
        mark = {"satisfied": "OK ", "open": "-- ", "failed": "!! ",
                "terminal": "XX ", "not_applicable": ".. "}.get(c["status"], "?? ")
        print(f"{mark}{c['id'][:38]:40}{c['truth'][:70]}")
    if "--facts" in sys.argv:
        print("\nthe facts the rules asked:")
        for k, v in sorted((d.get("facts_asked") or {}).items()):
            print(f"   {k:44}{'<ABSENT>' if v is None else repr(v)[:50]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
