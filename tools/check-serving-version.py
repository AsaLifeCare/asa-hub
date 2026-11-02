#!/usr/bin/env python3
"""What the Hub actually runs: the relay's deployment and its pinned version; neither HEAD nor the highest version is evidence."""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from push_apps_script import access_token, api_call, SCRIPT_ID, local_sources  # noqa: E402

RELAY_CONTAINER = "asa-hub-snapshot"


def relay_exec_url() -> str:
    """Asked of the running container, not compose.yaml: a container keeps the environment it was created with."""
    out = subprocess.run(
        ["docker", "exec", RELAY_CONTAINER, "sh", "-c", "echo $HUB_EXEC_URL"],
        capture_output=True, text=True, timeout=30)
    if out.returncode != 0:
        sys.exit(f"could not read HUB_EXEC_URL from {RELAY_CONTAINER}: {out.stderr.strip()}")
    url = out.stdout.strip()
    if "/macros/s/" not in url:
        sys.exit(f"{RELAY_CONTAINER} has no usable HUB_EXEC_URL: {url!r}")
    return url


def main() -> int:
    wanted = sys.argv[1:]
    url = relay_exec_url()
    dep_id = url.split("/macros/s/")[-1].split("/exec")[0]

    token = access_token()
    deployments = api_call(token, f"{SCRIPT_ID}/deployments").get("deployments", [])
    version = None
    others = []
    for d in deployments:
        cfg = d.get("deploymentConfig", {})
        if not any(e.get("entryPointType") == "WEB_APP" for e in (d.get("entryPoints") or [])):
            continue
        if d.get("deploymentId") == dep_id:
            version = cfg.get("versionNumber")
        else:
            others.append((cfg.get("versionNumber"), d.get("deploymentId", "")[-12:]))

    print(f"relay ({RELAY_CONTAINER})  ...{dep_id[-14:]}/exec")
    print(f"serving version        v{version}")
    if version is None:
        print("\nThe relay points at a deployment this project does not list, or at @HEAD.")
        return 1

    for v, tail in sorted(others, key=lambda x: -(x[0] or 0)):
        newer = "  <-- HIGHER, AND NOBODY CALLS IT" if (v or 0) > (version or 0) else ""
        print(f"   also deployed        v{v} ...{tail}{newer}")

    served = {f["name"]: f.get("source", "")
              for f in api_call(token, f"{SCRIPT_ID}/content?versionNumber={version}").get("files", [])}
    head = {f["name"]: f.get("source", "")
            for f in api_call(token, f"{SCRIPT_ID}/content").get("files", [])}
    local = local_sources()

    print(f"\nfiles served           {len(served)}    HEAD {len(head)}    local {len(local)}")
    drift_served = sorted(n for n, (_t, s) in local.items() if served.get(n, "") != s)
    drift_head = sorted(n for n, (_t, s) in local.items() if head.get(n, "") != s)
    print(f"local != served        {len(drift_served)}" + (f"  {', '.join(drift_served[:8])}" if drift_served else ""))
    print(f"local != HEAD          {len(drift_head)}" + (f"  {', '.join(drift_head[:8])}" if drift_head else ""))
    if drift_head and not drift_served:
        print("   (HEAD is BEHIND local — push before asking for a publish)")
    elif drift_served and not drift_head:
        print("   (pushed but not published — somebody still has to click in the editor)")

    missing = 0
    if wanted:
        blob = "\n".join(served.values())
        print("\nsymbols in what actually runs:")
        for name in wanted:
            ok = name in blob
            missing += 0 if ok else 1
            print(f"   {name:<40} {'yes' if ok else 'NO'}")

    print(f"\nverdict                {'live' if missing == 0 else str(missing) + ' missing'}")
    return 1 if missing else 0


if __name__ == "__main__":
    raise SystemExit(main())
