#!/usr/bin/env python3
"""
Copy the Calendar Builder's `Staff Preferences` tab into `ASA Data — Staff Preferences`, as asatech. One row per
staff member, keyed like clientNameKey_ (Clients.gs); a staff key that already has a row in the house is never
touched. The Builder is read live through the Sheets API, the Postgres mirror only when that read fails.

    python3 tools/copy_builder_prefs.py --dry-run     # reads both books, writes nothing (also the default)
    python3 tools/copy_builder_prefs.py --apply       # appends the new rows (and any missing header columns)
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

ENV_PATH = Path("/opt/docker/asa-hub/server/.tools.env")
ESSENCIAL_ID = "1Y6UMJlCS5gHur52f0YrPsLSqwYlCA792I8gAiZsxsug"
BUILDER_ID = "1_S62kl6hh0XG_3OK25X-AZYuYo3Apfm5oCAvvmdodfU"
BUILDER_TAB = "Staff Preferences"
HOUSE_PROP = "HUB_HOUSE_STAFF_PREFS_ID"
HOUSE_TAB = "Data"
MODULE = Path(__file__).resolve().parent.parent / "apps-script" / "StaffProfiles.gs"
UPDATED_BY = "Calendar Builder import"

S = "https://sheets.googleapis.com/v4/spreadsheets/"
TOK = ""

SHIFT_WORDS = [
    ("nights", r"\b(mid ?nights?|nights?|over ?nights?|overnights?|3rd|third)\b"),
    # am/pm after a number is a clock time ("off at 7 am"), not a shift
    ("morning", r"\b(mornings?|days?|1st|first)\b|(?<![0-9] )\bam\b"),
    ("afternoon", r"\b(afternoons?|evenings?|2nd|second)\b|(?<![0-9] )\bpm\b"),
]
SHIFT_ALL = r"\b(any|anything|all)\b"
SHIFT_ORDER = ["morning", "afternoon", "nights"]
ALLERGY_WORDS = [
    ("cats", r"\b(cats?|kittens?)\b"), ("dogs", r"\b(dogs?|pupp(y|ies))\b"), ("birds", r"\bbirds?\b"),
    ("dust", r"\bdust\b"), ("mold", r"\b(mold|mould)s?\b"),
    ("fragrances", r"\b(fragrances?|perfumes?|scents?|scented)\b"),
]
ALLERGY_FILLER = r"\b(and|or|of|to|fear|afraid|allergic|allerg(y|ies)|both)\b|[,&/+.;]"
NOTHING = {"", "na", "n/a", "none", "no", "nothing", "-"}


def env(k: str) -> str:
    for line in ENV_PATH.read_text().splitlines():
        line = line.strip()
        if line.startswith(f"{k}="):
            return line.split("=", 1)[1].strip().strip("'\"")
    sys.exit(f"{k} not found in {ENV_PATH}")


def token() -> str:
    body = urllib.parse.urlencode({
        "client_id": env("GS_GOOGLE_CLIENT_ID"), "client_secret": env("GS_GOOGLE_CLIENT_SECRET"),
        "refresh_token": env("GS_GOOGLE_REFRESH_TOKEN"), "grant_type": "refresh_token"}).encode()
    req = urllib.request.Request("https://oauth2.googleapis.com/token", data=body, method="POST")
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)["access_token"]


def api(url: str, payload: dict | None = None, method: str = "GET") -> dict:
    req = urllib.request.Request(url, method=method)
    req.add_header("Authorization", "Bearer " + TOK)
    body = json.dumps(payload).encode() if payload is not None else None
    if body:
        req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, body, timeout=120) as resp:
        raw = resp.read()
        return json.loads(raw) if raw else {}


def values(sid: str, rng: str) -> list[list[str]]:
    return api(S + sid + "/values/" + urllib.parse.quote(rng) + "?valueRenderOption=FORMATTED_VALUE").get("values") or []


def declared_header() -> list[str]:
    block = re.search(r"var SP_PREFS_HEADER = \[(.*?)\];", MODULE.read_text(encoding="utf-8"), re.S)
    cols = re.findall(r"'([^']*)'", block.group(1)) if block else []
    if not cols or cols[0] != "staff_key":
        sys.exit(f"SP_PREFS_HEADER is not declared (staff_key first) in {MODULE}")
    return cols


def house_id() -> str:
    """The depot's pointer, last row wins per Source."""
    sid = ""
    for row in values(ESSENCIAL_ID, "'Facts'!A2:I999999"):
        if len(row) > 4 and row[4] == f"switchboard:props.{HOUSE_PROP}":
            sid = str(row[2]).strip() if len(row) > 2 else ""
    if not sid:
        sys.exit(f"{HOUSE_PROP} is not in the depot: the house is not minted (tools/mint_staff_prefs_house.py)")
    return sid


def builder_live() -> list[dict]:
    grid = values(BUILDER_ID, f"'{BUILDER_TAB}'!A1:Z")
    at = next((i for i, r in enumerate(grid) if any(str(c).strip().lower() == "select your name" for c in r)), -1)
    if at < 0:
        raise RuntimeError("no 'Select Your Name' header row")
    head = [str(c).strip() for c in grid[at]]
    return [{h: (r[i] if i < len(r) else "") for i, h in enumerate(head) if h} for r in grid[at + 1:]]


def builder_mirror() -> list[dict]:
    sql = ("SELECT coalesce(json_agg(data ORDER BY row_number), '[]') FROM asa_drive_sheets_rows "
           f"WHERE sheet_id = '{BUILDER_ID}' AND tab_name = '{BUILDER_TAB}'")
    out = subprocess.run(["docker", "exec", "asa-hub-db", "psql", "-U", "asa_hub", "-d", "asa_hub",
                          "-tA", "-c", sql], capture_output=True, text=True, timeout=120)
    if out.returncode != 0:
        sys.exit(f"postgres refused: {out.stderr.strip()[:200]}")
    return json.loads(out.stdout.strip() or "[]")


def col(r: dict, name: str) -> str:
    want = re.sub(r"\s+", " ", name).strip().lower()
    for k, v in r.items():
        if re.sub(r"\s+", " ", str(k)).strip().lower() == want:
            return re.sub(r"\s+", " ", str(v if v is not None else "")).strip()
    return ""


def name_key(v: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", str(v or "").lower())


def shifts_of(text: str) -> list[str]:
    t = text.lower()
    if re.search(SHIFT_ALL, t):
        return list(SHIFT_ORDER)
    got = {s for s, rx in SHIFT_WORDS if re.search(rx, t)}
    return [s for s in SHIFT_ORDER if s in got]


def allergies_of(text: str) -> tuple[list[str], str]:
    t = text.lower().strip()
    if t in NOTHING:
        return [], ""
    got = [a for a, rx in ALLERGY_WORDS if re.search(rx, t)]
    rest = t
    for _a, rx in ALLERGY_WORDS:
        rest = re.sub(rx, " ", rest)
    rest = re.sub(ALLERGY_FILLER, " ", rest).strip()
    if re.search(r"[a-z0-9]", rest):
        return got + ["other"], text[:200]
    return got, ""


def pickup_of(text: str) -> str:
    t = text.strip().lower()
    return "yes" if t in ("y", "yes") else "no" if t in ("n", "no") else ""


def compact(v) -> str:
    return json.dumps(v, separators=(",", ":"))


def main() -> None:
    global TOK
    apply = "--apply" in sys.argv
    if apply and "--dry-run" in sys.argv:
        sys.exit("--apply and --dry-run: one or the other")
    declared = declared_header()
    TOK = token()

    try:
        source, rows = "live Sheets API", builder_live()
    except Exception as exc:  # noqa: BLE001 — the mirror answers instead, and says so
        print(f"live read refused ({str(exc)[:120]}) — reading the Postgres mirror")
        source, rows = "Postgres mirror", builder_mirror()

    sid = house_id()
    house = values(sid, f"'{HOUSE_TAB}'!A1:ZZ")
    live_head = [str(h).strip() for h in (house[0] if house else [])]
    if not live_head or live_head[0] != "staff_key":
        sys.exit(f"the house {sid[:14]}… has no staff_key header in '{HOUSE_TAB}'")
    have = {str(r[0]).strip() for r in house[1:] if r and str(r[0]).strip()}
    missing = [h for h in declared if h not in live_head]
    head = live_head + missing

    now = time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime())
    out, lines, seen = [], [], set()
    for r in rows:
        name = col(r, "Select Your Name")
        if not name:
            continue
        key = name_key(name)
        shifts_text, allergy_text = col(r, "SHIFTS"), col(r, "ALLERGY/FEAR")
        shifts = shifts_of(shifts_text)
        allergies, other = allergies_of(allergy_text)
        rec = {"staff_key": key, "staff_name": name, "shifts": compact(shifts),
               "unavailable_days": compact({"a": [], "b": []}), "unavailable_locations": "[]",
               "other_locations": "[]", "allergies": compact(allergies), "allergy_other": other,
               "pickup": pickup_of(col(r, "PICK UP Y/N")), "weekend_work": col(r, "WEEKEND WORK")[:200],
               "note": col(r, "NOTE")[:500], "shifts_note": shifts_text[:200],
               "updated_at": now, "updated_by": UPDATED_BY}
        why = ""
        if not re.fullmatch(r"[a-z0-9]{3,80}", key):
            why = "key is not a staff key"
        elif key in have:
            why = "already in the house"
        elif key in seen:
            why = "duplicate in the Builder"
        seen.add(key)
        lines.append((name, key, rec, why))
        if not why:
            out.append([rec.get(h, "") for h in head])

    print(f"source: {source} · Builder rows with a name: {len(lines)} · house {sid[:14]}… rows: {len(have)}")
    if missing:
        print(f"house header lacks {', '.join(missing)} — appended to row 1 on --apply")
    print(f"{'name':<28} {'key':<26} {'shifts':<26} {'pickup':<6} {'weekend':<14} {'allergies':<22} {'note':<18} status")
    for name, key, rec, why in lines:
        al = ",".join(json.loads(rec["allergies"])) + (f" ({rec['allergy_other'][:12]})" if rec["allergy_other"] else "")
        print(f"{name[:28]:<28} {key[:26]:<26} {','.join(json.loads(rec['shifts'])) or '-':<26} {rec['pickup'] or '-':<6} "
              f"{rec['weekend_work'][:14] or '-':<14} {al[:22] or '-':<22} {rec['note'][:18] or '-':<18} "
              f"{'SKIP: ' + why if why else 'write'}")
    skipped = len(lines) - len(out)
    print(f"\nwould write {len(out)} · skipped {skipped}")

    if not apply:
        print("dry run: nothing was written. Re-run with --apply to append.")
        return
    if not out:
        print("nothing to write.")
        return
    if missing:
        meta = api(S + sid + "?fields=sheets.properties")
        props = next(s["properties"] for s in meta["sheets"] if s["properties"]["title"] == HOUSE_TAB)
        short = len(head) - int(props["gridProperties"].get("columnCount", 0))
        if short > 0:
            api(S + sid + ":batchUpdate", {"requests": [{"appendDimension": {
                "sheetId": props["sheetId"], "dimension": "COLUMNS", "length": short}}]}, "POST")
        api(S + sid + "/values/" + urllib.parse.quote(f"'{HOUSE_TAB}'!A1") + "?valueInputOption=RAW",
            {"values": [head]}, "PUT")
        print(f"header extended ({len(head)} cols)")
    api(S + sid + "/values/" + urllib.parse.quote(f"'{HOUSE_TAB}'!A1") +
        ":append?valueInputOption=RAW&insertDataOption=INSERT_ROWS", {"values": out}, "POST")
    print(f"appended {len(out)} rows to {sid[:14]}…")


if __name__ == "__main__":
    main()
