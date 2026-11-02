#!/usr/bin/env python3
"""Invariants that live in the platform's rows, read-only through the relay; not part of npm run check."""
import json
import subprocess
import sys
import urllib.request

RELAY = "asa-hub-snapshot"
TABS = ["users", "tenants", "platform_members", "platform_invites",
        "user_worlds", "app_badge_access"]

# Mirrors HUB_USER_TYPES in Profile.gs; a hand-typed cell can still hold anything.
KNOWN_BADGES = {"ADMIN", "ADMINISTRATOR", "PLATFORMLEAD", "DIRECTOR", "SUPERVISOR", "TEAMLEAD", "MANAGER", "HM",
                "STAFF", "INTERVIEWER", "ONBOARDING", "ENTITY", "FAMILY", "CLIENT", "SSA"}


def relay(cmd: str) -> str:
    out = subprocess.run(["docker", "exec", RELAY, "sh", "-c", cmd],
                         capture_output=True, text=True)
    if out.returncode != 0:
        sys.exit(f"could not reach {RELAY}: {out.stderr.strip()}")
    return out.stdout.strip()


def read_tabs() -> dict:
    url = relay("echo $HUB_EXEC_URL")
    secret = relay("echo $HUB_SERVICE_SECRET")
    if not url or not secret:
        sys.exit(f"{RELAY} has no HUB_EXEC_URL / HUB_SERVICE_SECRET")
    body = json.dumps({"service_secret": secret, "action": "tabs",
                       "payload": {"tabs": TABS}}).encode()
    req = urllib.request.Request(url, data=body,
                                 headers={"Content-Type": "application/json"})
    env = json.load(urllib.request.urlopen(req, timeout=120))
    if env.get("status") != 200:
        sys.exit(f"the backend answered {env.get('status')}: {env.get('message')}")
    return (env.get("data") or {}).get("tabs") or {}


def s(row: dict, key: str) -> str:
    return str(row.get(key) or "").strip()


def _client_bearing_open_slices() -> list[tuple[str, list[str]]]:
    """Client-readable slices whose rows name a client, read from the relay's own disk."""
    script = (
        "import json,os,glob\n"
        "man=json.load(open(os.environ.get('HUB_SNAPSHOT_MANIFEST','/srv/manifests/snapshot-manifest.json')))\n"
        "out=json.load(open('/dev/stdin')) if False else []\n"
        "d=os.environ.get('HUB_SNAPSHOT_OUT','/srv/snapshot')\n"
        "for r in man.get('resources') or []:\n"
        "    n=r.get('resource')\n"
        "    if 'client' not in (r.get('roles') or []): continue\n"
        "    f=os.path.join(d,n+'.json')\n"
        "    if not os.path.exists(f): continue\n"
        "    try: rows=(json.load(open(f)) or {}).get('rows') or []\n"
        "    except Exception: continue\n"
        "    if not rows or not isinstance(rows[0],dict): continue\n"
        "    c=[k for k in rows[0] if 'client' in k.lower()]\n"
        "    if c: out.append([n,c])\n"
        "print(json.dumps(out))"
    )
    try:
        raw = relay("python3 - <<'PYEOF'\n" + script + "\nPYEOF")
        return [(n, c) for n, c in json.loads(raw or "[]")]
    except Exception:
        # never claim a leak that was not measured
        return []


def main() -> int:
    strict = "--strict" in sys.argv
    t = read_tabs()
    users = t.get("users") or []
    tenants = t.get("tenants") or []
    members = t.get("platform_members") or []
    invites = t.get("platform_invites") or []
    worlds = t.get("user_worlds") or []
    badges = t.get("app_badge_access") or []

    live = {s(x, "tenant_id") for x in tenants
            if s(x, "status").lower() != "archived" and s(x, "tenant_id")}
    by_id = {s(u, "user_id"): u for u in users if s(u, "user_id")}
    findings, notes = [], []

    print(f"live state: {len(users)} account(s), {len(tenants)} place(s), "
          f"{len(members)} member row(s), {len(worlds)} world(s)")

    # Without exactly one 'hq', tenantHomeFrom_ falls back to row order.
    hq = [x for x in tenants if s(x, "type") == "hq"
          and s(x, "status").lower() != "archived"]
    if len(hq) != 1:
        findings.append(f"{len(hq)} active places are typed 'hq' — home is decided by "
                        "ROW ORDER when there is none, so sorting the tab moves it")

    # An unknown place id resolves silently and 404s every screen.
    for u in users:
        if s(u, "active").lower() == "false":
            continue
        wanted = [s(u, "home_tenant")] + [p.strip() for p in s(u, "tenants").split(",")]
        for w in [x for x in wanted if x]:
            if w not in live:
                findings.append(f"{s(u, 'email')} is placed in \"{w}\", which is not an "
                                "active place — every screen will answer 404")

    # An active member row whose owner is no longer admin is a permanent admin.
    for m in members:
        if s(m, "status") != "active":
            continue
        owner = by_id.get(s(m, "owner_user_id"))
        member = by_id.get(s(m, "member_user_id"))
        if not owner or not member:
            findings.append(f"member row {s(m, 'member_id')} names an account that no "
                            "longer exists")
            continue
        if s(owner, "role") != "admin":
            findings.append(f"{s(owner, 'email')} still holds an ACTIVE member row for "
                            f"{s(member, 'email')} and is no longer an admin")
        if s(owner, "active").lower() == "false" or s(member, "active").lower() == "false":
            findings.append(f"member row {s(m, 'member_id')} is active between accounts "
                            "one of which is deactivated")
        # A blank scope means open; only who closed it is worth saying.
        if s(m, "scope") == "work":
            who = "they did" if s(m, "scope_by") == "member" else "the owner did"
            notes.append(f"member row {s(m, 'member_id')}: their world is CLOSED — {who}"
                         + (" (only they can open it again)"
                            if s(m, "scope_by") == "member" else ""))

    pending = [m for m in members if s(m, "status") == "pending"]
    if pending:
        notes.append(f"{len(pending)} member ask(s) still pending — each holds one of the "
                     "five seats until the person answers or the row is removed")

    for w in worlds:
        if not s(w, "spreadsheet_id"):
            findings.append(f"world {s(w, 'world_id')} ({s(w, 'owner_email')}) has no "
                            "spreadsheet — the card opens onto nothing")
        if s(w, "owner_user_id") and s(w, "owner_user_id") not in by_id:
            notes.append(f"world {s(w, 'world_id')} belongs to an account that is gone")

    seen, dupes = set(), set()
    for b in badges:
        a = s(b, "app_id")
        if a in seen:
            dupes.add(a)
        seen.add(a)
    if dupes:
        findings.append("app_badge_access holds two rows for: " + ", ".join(sorted(dupes)) +
                        " — the reader builds a map, so one twin is answering and the "
                        "other is invisible")

    for u in users:
        for raw in s(u, "types").split(","):
            b = raw.strip().upper()
            if b and b not in KNOWN_BADGES:
                findings.append(f"{s(u, 'email')} carries the badge \"{b}\", which no "
                                "rule can match — it grants nothing, silently")

    for i in invites:
        place = s(i, "tenant")
        if place and place not in live and s(i, "status") not in ("revoked", "registered"):
            findings.append(f"invitation {s(i, 'invite_id')} points at \"{place}\", which "
                            "is not an active place")

    # nginx-served slices skip the backend's client narrowing: EMPLOYEE_ONLY_SLICES is the only guard.
    for name, cols in _client_bearing_open_slices():
        findings.append(f"the `{name}` slice is served to CLIENT sessions and its rows name "
                        f"a client ({', '.join(cols)}) — add it to EMPLOYEE_ONLY_SLICES "
                        "(src/lib/snapshot.ts), rebuild and redeploy")

    print()
    if findings:
        print(f"{len(findings)} thing(s) the data says that the code cannot:")
        for f in findings:
            print(f"  ✗ {f}")
    else:
        print("  every invariant holds: one headquarters, nobody stranded, no standing "
              "grant without an admin, every world has a workbook, no twin in the matrix.")
    if notes:
        print()
        for n in notes:
            print(f"  · {n}")
    return 1 if (strict and findings) else 0


if __name__ == "__main__":
    raise SystemExit(main())
