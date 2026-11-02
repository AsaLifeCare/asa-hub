#!/usr/bin/env python3
"""Push apps-script/ to the live project: always PUT the full file list, never deploy through the API."""
from __future__ import annotations

import argparse
import re
from datetime import datetime, timezone
import difflib
import json
import os
import subprocess
import sys
import urllib.parse
import urllib.request
from pathlib import Path

ENV_PATH = Path("/opt/docker/asa-hub/server/.tools.env")
SOURCE_DIR = Path(__file__).resolve().parent.parent / "apps-script"
# Reload any open editor tab after a push: saving a stale tab writes the old code back.
SCRIPT_ID = "1BUjxOKX6vqZFfhHW4aP2_qW5LFZ8dF0E9MBlHiBSFqrW9EEXOO0x5kPr"
TOKEN_URL = "https://oauth2.googleapis.com/token"
API = "https://script.googleapis.com/v1/projects"


def env(key: str) -> str:
    """Read one key from the old platform .env (no shell sourcing)."""
    if not ENV_PATH.exists():
        sys.exit(f"missing {ENV_PATH}")
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
    req = urllib.request.Request(TOKEN_URL, data=body, method="POST")
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)["access_token"]


def api_call(token: str, path: str, method: str = "GET", payload: dict | None = None) -> dict:
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(f"{API}/{path}", data=data, method=method)
    req.add_header("Authorization", f"Bearer {token}")
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        # Google's own words: which file and line it refused
        raise SystemExit(f"Apps Script API {e.code}: {e.read().decode(errors='replace')[:1500]}")


BUILD_FILE = "BulkRead"
BUILD_RE = re.compile(r"(var HUB_CODE_BUILD = ')([^']*)(';)")


def stamp_code_build() -> str:
    """Stamp HUB_CODE_BUILD on disk before upload so the snapshot builder sees a publish that moved no tab."""
    path = SOURCE_DIR / f"{BUILD_FILE}.gs"
    try:
        src = path.read_text()
    except OSError:
        return ""
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    new, n = BUILD_RE.subn(lambda m: m.group(1) + now + m.group(3), src, count=1)
    if not n:
        print(f"WARNING: HUB_CODE_BUILD not found in {BUILD_FILE}.gs — the "
              f"snapshot builder will not notice this publish on its own.")
        return ""
    if new != src:
        path.write_text(new)
    return now


def local_sources() -> dict[str, tuple[str, str]]:
    """{name: (type, source)} for every .gs / .html in apps-script/."""
    out: dict[str, tuple[str, str]] = {}
    for path in sorted(SOURCE_DIR.iterdir()):
        if path.suffix == ".gs":
            out[path.stem] = ("SERVER_JS", path.read_text())
        elif path.suffix == ".html":
            out[path.stem] = ("HTML", path.read_text())
    # the live project gets the code without comments (the repo keeps them); a file whose tokens would move ships as is
    keep = {"BeAnother"} | set(HANDS_OFF)
    names = [n for n, (t, _) in out.items() if t == "SERVER_JS" and n not in keep]
    stripped = json.loads(subprocess.run(
        ["node", str(SOURCE_DIR.parent / "tools" / "strip-gs-comments.mjs"), *[str(SOURCE_DIR / f"{n}.gs") for n in names]],
        check=True, capture_output=True, text=True).stdout)
    for n, src in stripped.items():
        out[n] = ("SERVER_JS", src)
    return out


def assert_load_order(files: list[dict]) -> None:
    """Refuse a file order where a global is extended or read at top level before its declaration."""
    import re

    server = [(i, f) for i, f in enumerate(files) if f.get("type") == "SERVER_JS"]
    # A new file is appended last, so a declaration moved into it would load after every extender.
    for var in ("HUB_ACTIONS", "HUB_POLICY"):
        decl_idx = next(
            (i for i, f in server
             if re.search(rf"^var\s+{var}\s*=", f.get("source", ""), re.M)),
            None,
        )
        early = [
            f["name"] for i, f in server
            if (decl_idx is None or i < decl_idx)
            and re.search(rf"^{var}\.\w+\s*=", f.get("source", ""), re.M)
        ]
        if early:
            sys.exit(
                f"REFUSING TO PUSH: these files extend {var} but would load "
                f"BEFORE the file that declares it: {', '.join(early)}. "
                "Fix the project order (HubCore first) or move the assignments."
            )
    names = [f["name"] for f in files]
    if "Main" in names and "Talent" in names and names.index("Main") > names.index("Talent"):
        sys.exit(
            "REFUSING TO PUSH: Main must load before Talent "
            "(Talent.gs reads HUB_DB_ID at top level)."
        )


# Editor-owned: pushed only when named on the command line.
HANDS_OFF = {"Main", "Onboarding"}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("only", nargs="*", help="file names to push (default: all changed)")
    ap.add_argument("--dry-run", action="store_true", help="show what would change and stop")
    args = ap.parse_args()
    # Project names carry no extension; a named file that matches nothing is refused below.
    args.only = [n[:-3] if n.endswith(".gs") else n for n in (args.only or [])]
    skipped_hands_off: list[str] = []

    token = access_token()
    remote = api_call(token, f"{SCRIPT_ID}/content")
    remote_files = {f["name"]: f for f in remote.get("files", [])}
    # Records the live file order for check-load-order.mjs; it is not alphabetical.
    try:
        (Path(__file__).resolve().parent / "project-order.json").write_text(
            json.dumps({
                "order": [f["name"] for f in remote.get("files", [])
                          if f.get("type") == "SERVER_JS"],
                "note": "the live project order, read from the Apps Script API on the last push",
            }, indent=1) + "\n")
    except Exception:  # noqa: BLE001 - recording is a bonus, never a blocker
        pass
    # Stamp before reading so disk and upload match; a dry run writes nothing.
    stamped = "" if args.dry_run else stamp_code_build()
    local = local_sources()
    # The manifest goes only when named: a scopes change forces re-authorization.
    if "appsscript" in (args.only or []):
        local["appsscript"] = ("JSON", (SOURCE_DIR / "appsscript.json").read_text())

    unknown = [n for n in (args.only or []) if n not in local]
    if unknown:
        sys.exit(f"named file(s) not found in apps-script/: {', '.join(unknown)} — nothing pushed.")

    changed: list[str] = []
    for name, (ftype, source) in local.items():
        # The stamp file always rides along, even on a named push.
        if args.only and name not in args.only and not (stamped and name == BUILD_FILE):
            continue
        # Main.gs carries an editor-side version probe that a default push would erase.
        if name in HANDS_OFF and name not in args.only:
            skipped_hands_off.append(name)
            continue
        current = remote_files.get(name, {}).get("source", "")
        if current == source:
            continue
        changed.append(name)
        print(f"\n=== {name} ({'new' if name not in remote_files else 'changed'}) ===")
        diff = difflib.unified_diff(
            current.splitlines(), source.splitlines(),
            fromfile=f"live/{name}", tofile=f"local/{name}", lineterm="", n=1,
        )
        shown = list(diff)[:40]
        print("\n".join(shown) or "(content differs only in whitespace)")

    if skipped_hands_off:
        print("\nheld back (these are owned in the editor and are never pushed): "
              + ", ".join(sorted(skipped_hands_off))
              + "\n  push one on purpose with:  python3 tools/push_apps_script.py "
              + " ".join(sorted(skipped_hands_off)))

    if not changed:
        print("nothing to push — the live project already matches apps-script/")
        return

    # The API replaces everything it receives: send the full file list.
    payload_files = []
    for name, f in remote_files.items():
        if name in changed and name in local:
            payload_files.append({"name": name, "type": local[name][0], "source": local[name][1]})
        else:
            payload_files.append({"name": name, "type": f["type"], "source": f.get("source", "")})
    for name in changed:
        if name not in remote_files:
            payload_files.append({"name": name, "type": local[name][0], "source": local[name][1]})

    assert_load_order(payload_files)

    if args.dry_run:
        print(f"\n--dry-run: {len(changed)} file(s) would be pushed: {', '.join(changed)}")
        print("--dry-run: load order OK (HUB_ACTIONS declared before every extension; Main before Talent)")
        return

    api_call(token, f"{SCRIPT_ID}/content", method="PUT", payload={"files": payload_files})
    print(f"\npushed {len(changed)} file(s): {', '.join(changed)}")
    if "Digest" in changed:
        # the relay reads with the decoder's Python translation, which a change here does not reach
        print("NOTE: Digest.gs changed — server/digest_engine.py is its Python translation; carry the change there "
              "and run tools/test-digest-engine.py")
    print("\nHEAD is updated. The serving web app still runs the OLD version until")
    print('somebody opens the editor and clicks "Implantar → Nova versão".')
    print("If an editor tab was already open, RELOAD it before saving anything.")


if __name__ == "__main__":
    main()
