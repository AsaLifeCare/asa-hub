#!/usr/bin/env python3
"""Does every house's SHEET still match what the depot DECLARES about it?

THE DECLARATION IS THE PROTOCOL. A fact left stale — a header declared for a
tab that has since grown a column — breaks every reader that trusts it, which
is everyone.

A data house is addressed by `switchboard:props.HUB_HOUSE_<TAB>_ID`, switched
on by `switchboard:moved.<tab>`, and DESCRIBED by `schema:<tab>.header`. Every
reader that does not open the spreadsheet — the bulk bridge, the flow engine,
the python side — believes that third fact. And a header can grow behind its
back: ensureHeader_ appends a column the moment code writes a key the sheet
does not have, which is exactly how a declaration goes stale without anybody
touching it.

So this walks EVERY switched-on tab, opens its house, reads row 1, and
compares. Drift is printed as ADDED / MISSING / REORDERED, per house.

    python3 tools/audit_schema_facts.py             # audit, change nothing
    python3 tools/audit_schema_facts.py --apply     # re-declare what drifted

--apply only ever appends a corrected `schema:<tab>.header` fact (the depot's
own shape: last row wins). It NEVER touches a sheet: the sheet is the truth
about itself, the fact is the platform's memory of it, and memory is what
gets corrected.
"""
from __future__ import annotations

import json
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

ENV_PATH = Path("/opt/docker/asa-hub/server/.tools.env")
ESSENCIAL_ID = "1Y6UMJlCS5gHur52f0YrPsLSqwYlCA792I8gAiZsxsug"
S = "https://sheets.googleapis.com/v4/spreadsheets/"


def env(k: str) -> str:
    for line in ENV_PATH.read_text().splitlines():
        line = line.strip()
        if line.startswith(f"{k}="):
            return line.split("=", 1)[1].strip().strip("'\"")
    sys.exit(f"{k} not found in {ENV_PATH}")


def bearer() -> str:
    body = urllib.parse.urlencode({
        "client_id": env("GS_GOOGLE_CLIENT_ID"),
        "client_secret": env("GS_GOOGLE_CLIENT_SECRET"),
        "refresh_token": env("GS_GOOGLE_REFRESH_TOKEN"),
        "grant_type": "refresh_token"}).encode()
    req = urllib.request.Request("https://oauth2.googleapis.com/token",
                                 data=body, method="POST")
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)["access_token"]


TOK = bearer()


def api(url: str, payload: dict | None = None, method: str = "GET"):
    for attempt in range(5):
        req = urllib.request.Request(url, method=method)
        req.add_header("Authorization", "Bearer " + TOK)
        if payload is not None:
            req.add_header("Content-Type", "application/json")
            req.data = json.dumps(payload).encode()
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 503) and attempt < 4:
                time.sleep(2 ** attempt)
                continue
            return {"__error": f"{e.code} {e.reason}"}
        except Exception as e:  # noqa: BLE001 — a slow house is a REPORT, not a crash
            if attempt < 4:
                time.sleep(1 + attempt)
                continue
            return {"__error": type(e).__name__}
    return {}


def depot() -> dict[str, str]:
    rows = api(S + ESSENCIAL_ID + "/values/" +
               urllib.parse.quote("'Facts'!A2:I999999")).get("values") or []
    have: dict[str, str] = {}
    for r in rows:
        src = str(r[4]) if len(r) > 4 else ""
        if src:
            have[src] = str(r[2]) if len(r) > 2 else ""
    return have


def main() -> None:
    apply = "--apply" in sys.argv
    state = depot()
    tabs = sorted(k.split(".", 1)[1] for k in state
                  if k.startswith("switchboard:moved.") and state[k] == "on")
    print(f"{len(tabs)} tab(s) switched on in the depot\n")

    facts, drifted, unreachable, undeclared = [], [], [], []
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

    for tab in tabs:
        prop = "HUB_HOUSE_" + tab.upper().replace("-", "_") + "_ID"
        sid = state.get(f"switchboard:props.{prop}", "")
        if not sid:
            undeclared.append(tab)
            continue
        meta = api(S + sid + "?fields=properties.title,sheets.properties.title")
        if "__error" in meta:
            unreachable.append(f"{tab} ({meta['__error']})")
            continue
        names = [s["properties"]["title"] for s in meta.get("sheets", [])]
        # the tab is named for the resource, or the house has exactly one
        sheet = tab if tab in names else (names[0] if names else "")
        if not sheet:
            unreachable.append(f"{tab} (no sheet)")
            continue
        got = api(S + sid + "/values/" + urllib.parse.quote(f"'{sheet}'!1:1"))
        header = [str(h) for h in (got.get("values") or [[]])[0]]
        declared_raw = state.get(f"schema:{tab}.header", "")
        try:
            declared = json.loads(declared_raw) if declared_raw else []
        except Exception:
            declared = []
        if header == declared:
            continue
        added = [c for c in header if c not in declared]
        missing = [c for c in declared if c not in header]
        drifted.append(tab)
        print(f"{tab}  ({meta.get('properties', {}).get('title', '?')} · {sheet})")
        print(f"   sheet {len(header)} col(s) · declared {len(declared)}")
        if added:
            print(f"   ADDED (sheet has, depot does not): {', '.join(added)}")
        if missing:
            print(f"   MISSING (depot has, sheet does not): {', '.join(missing)}")
        if not added and not missing:
            print("   REORDERED — same columns, different order")
        if not declared:
            print("   NOTHING DECLARED — the depot has no schema for this tab")
        if not header:
            # NEVER DECLARE A HOUSE EMPTY. A blank first row is a question — a
            # tab renamed, a house minted and never filled, a copy that did not
            # land — and answering it by erasing the declaration would take
            # every reader down with it.
            print("   REFUSED: the sheet's first row is EMPTY — declaration kept, "
                  "look at the house before anything is written")
            continue
        facts.append([f"schema.{tab}.header", "__schema",
                      json.dumps(header, separators=(",", ":")), "",
                      f"schema:{tab}.header", "", now, "audit-schema-facts", ""])

    print(f"\n{len(drifted)} drifted · {len(unreachable)} unreachable · "
          f"{len(undeclared)} with no house pointer")
    if unreachable:
        print("   unreachable: " + ", ".join(unreachable[:12]))
    if undeclared:
        print("   no pointer:  " + ", ".join(undeclared[:12]))
    if not facts:
        print("\nevery declaration matches its sheet.")
        return
    if not apply:
        print("\n--apply would re-declare the drifted tabs (append only).")
        return
    for i in range(0, len(facts), 200):
        api(S + ESSENCIAL_ID + "/values/" + urllib.parse.quote("'Facts'!A1") +
            ":append?valueInputOption=RAW&insertDataOption=INSERT_ROWS",
            {"values": facts[i:i + 200]}, "POST")
    fresh = depot()
    bad = [f[4] for f in facts if fresh.get(f[4]) != f[2]]
    if bad:
        sys.exit(f"VERIFY FAILED for: {', '.join(bad[:8])}")
    print(f"\n{len(facts)} declaration(s) corrected — the depot agrees with the sheets.")


if __name__ == "__main__":
    main()
