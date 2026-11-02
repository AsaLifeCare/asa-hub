#!/usr/bin/env python3
"""
MINT THE PHARMACY HOUSES — three `ASA Data — …` books, one tab each.

The relay decides every pharmacy report (server/house_meds.py) and hands the
rows to `houseMedsIngest` (apps-script/HouseMeds.gs) after its own commit.
This mints the three houses that door writes, and STOPS:

  ASA Data — MedImports    med_imports    the ledger: file names, periods,
                                          counts — no names, no drugs
  ASA Data — MedDispenses  med_dispenses  every imported line (PatID + drug)
  ASA Data — MedPatients   med_patients   PatID → name → client

For each: the book minted as the platform account (the GS_GOOGLE_* token), the
header stamped on row 1 (the relay's own HOUSE_HEADERS, read out of
server/house_meds.py), frozen, and its depot facts —
  switchboard:props.HUB_HOUSE_<TAB>_ID → the house id
  switchboard:moved.<tab>              → on   (MedImports only)
  schema:<tab>.header                  → the header JSON
— and ONE Registry row, `data.med_imports`. The two clinical books get no
Registry row: a `data.*` context is a book the runtime engine walks every hour.

THE CLINICAL BOOKS STAY PRIVATE TO THE PLATFORM ACCOUNT. MedDispenses and
MedPatients are never gathered into `ASA Hub - Source/Database`: that folder is
shared, and two jobs copy every spreadsheet jarvis@ can read into Postgres (the
relay's keeper, and the intelligence platform's drive_sheet_backup, which has
no keep-out for them). So:
  - no `switchboard:moved.*` fact for them (the door finds a house by its
    pointer alone, apps-script/HouseMeds.gs), and runGatherDatabaseMove skips
    their pointers (apps-script/GatherDatabase.gs GATHER_KEEP_APART);
  - the real run REFUSES to declare either one unless the platform account
    is its only reader — no user, group, domain or anyone permission — and
    stops before any fact is written, naming the book to fix;
  - the relay's keeper still refuses them by title and pointer
    (server/hub_sheet_sync.py KEEP_OUT_TITLES / KEEP_OUT_POINTERS), a second
    belt. Keep the titles and pointer names in step; tools/test-house-meds.py
    holds them. The keep-out lines and the gather's keep-apart ship BEFORE
    this runs.

WHO CAN OPEN MEDIMPORTS IN DRIVE. The ledger joins the gather and inherits the
folder's permissions; it carries no name, drug or PatID. `--dry-run` prints how
many principals and domains can read the folder, and whether each clinical book
already declared is private.

`--share` shares MedImports (only) with the service account. The lane does not
need it: the relay serves from its own tables.

Re-runnable: an existing pointer reuses its house, and a live header is never
re-stamped.

    python3 tools/mint_house_meds_houses.py --dry-run
    python3 tools/mint_house_meds_houses.py            [--share]
"""
from __future__ import annotations

import ast
import base64
import json
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve()
ROOT = HERE.parent.parent
ENV_PATH = Path("/opt/docker/asa-hub/server/.tools.env")
ESSENCIAL_ID = "1Y6UMJlCS5gHur52f0YrPsLSqwYlCA792I8gAiZsxsug"
SA_JSON_PATHS = [Path("/opt/docker/asa-hub/server/.service-account.json")]
GATHER_SOURCE_FOLDER_ID = "1kNOcvchYhIAgItXUlfOjA6Gb7k5KxPJZ"   # GatherDatabase.gs, ASA Hub - Source
RECORDED_BY = "mint-house-meds"
ROW_COUNT = 5000

S = "https://sheets.googleapis.com/v4/spreadsheets/"
D = "https://www.googleapis.com/drive/v3/files/"


def relay_headers() -> dict[str, list[str]]:
    """HOUSE_HEADERS out of the relay's module, read as a literal — never a
    second copy typed here, and no database driver needed to read it."""
    tree = ast.parse((ROOT / "server" / "house_meds.py").read_text(encoding="utf-8"))
    for node in tree.body:
        if isinstance(node, ast.Assign) and any(getattr(t, "id", "") == "HOUSE_HEADERS" for t in node.targets):
            return ast.literal_eval(node.value)
    sys.exit("server/house_meds.py: HOUSE_HEADERS is gone")


HEADERS = relay_headers()
HOUSES = [
    {"tab": "med_imports", "title": "ASA Data — MedImports", "prop": "HUB_HOUSE_MED_IMPORTS_ID",
     "registry": True, "clinical": False,
     "note": "data: med_imports (the pharmacy reports' ledger — every file decided, imported or refused; "
             "file names, periods and counts only)"},
    {"tab": "med_dispenses", "title": "ASA Data — MedDispenses", "prop": "HUB_HOUSE_MED_DISPENSES_ID",
     "registry": False, "clinical": True, "note": ""},
    {"tab": "med_patients", "title": "ASA Data — MedPatients", "prop": "HUB_HOUSE_MED_PATIENTS_ID",
     "registry": False, "clinical": True, "note": ""},
]


def env(k: str) -> str:
    for line in ENV_PATH.read_text().splitlines():
        line = line.strip()
        if line.startswith(f"{k}="):
            return line.split("=", 1)[1].strip().strip("'\"")
    sys.exit(f"{k} not found in {ENV_PATH}")


def token() -> str:
    body = urllib.parse.urlencode({
        "client_id": env("GS_GOOGLE_CLIENT_ID"),
        "client_secret": env("GS_GOOGLE_CLIENT_SECRET"),
        "refresh_token": env("GS_GOOGLE_REFRESH_TOKEN"),
        "grant_type": "refresh_token"}).encode()
    req = urllib.request.Request("https://oauth2.googleapis.com/token", data=body, method="POST")
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)["access_token"]


def api(tok: str, url: str, payload: dict | None = None, method: str = "GET", tries: int = 6) -> dict:
    for a in range(tries):
        req = urllib.request.Request(url, method=method)
        req.add_header("Authorization", "Bearer " + tok)
        body = json.dumps(payload).encode() if payload is not None else None
        if body:
            req.add_header("Content-Type", "application/json")
        try:
            with urllib.request.urlopen(req, body, timeout=120) as resp:
                raw = resp.read()
                return json.loads(raw) if raw else {}
        except Exception as err:  # noqa: BLE001
            if getattr(err, "code", 0) in (400, 403, 404):
                raise
            if a < tries - 1:
                time.sleep(5 * (a + 1))
                continue
            raise
    return {}


def depot_state(tok: str) -> dict[str, str]:
    """Facts, last row wins per Source — the depot's own reading law."""
    rows = api(tok, S + ESSENCIAL_ID + "/values/" + urllib.parse.quote("'Facts'!A2:I999999")).get("values") or []
    state: dict[str, str] = {}
    for row in rows:
        if len(row) > 4 and row[4]:
            state[str(row[4])] = str(row[2]) if len(row) > 2 else ""
    return state


def sa_email() -> str:
    for p in SA_JSON_PATHS:
        try:
            raw = p.read_text().strip()
            info = json.loads(base64.b64decode(raw)) if not raw.startswith("{") else json.loads(raw)
            if info.get("client_email"):
                return str(info["client_email"])
        except Exception:  # noqa: BLE001
            continue
    return ""


def _body_of(exc: Exception) -> str:
    try:
        return exc.read().decode("utf-8", "replace")  # type: ignore[attr-defined]
    except Exception:  # noqa: BLE001
        return ""


def arg_pairs(name: str) -> dict[str, str]:
    """--use=med_dispenses=<id>,med_patients=<id> → {tab: id}."""
    for a in sys.argv:
        if a.startswith(f"--{name}="):
            return dict(p.split("=", 1) for p in a.split("=", 1)[1].split(",") if "=" in p)
    return {}


def readers_of(tok: str, folder_id: str) -> str:
    """How many principals and domains can open a folder — counts only."""
    try:
        perms = api(tok, D + folder_id + "/permissions?supportsAllDrives=true&fields=permissions(type,role)")
    except Exception as exc:  # noqa: BLE001
        return f"could not be read ({type(exc).__name__})"
    kinds: dict[str, int] = {}
    for p in perms.get("permissions") or []:
        kinds[p.get("type") or "?"] = kinds.get(p.get("type") or "?", 0) + 1
    return ", ".join(f"{n} {k}" for k, n in sorted(kinds.items())) or "nobody listed"


def private_to_owner(tok: str, sid: str) -> tuple[bool, str]:
    """(only the owner can open it, what else can) — counts only. A list that
    cannot be read is NOT private: the answer is never guessed. The one
    exception is --private-confirmed when the token carries no Drive scope at
    all (403 insufficient scopes): the sharing was set by hand, and the output
    says it was that word, not a reading."""
    try:
        perms = api(tok, D + sid + "/permissions?supportsAllDrives=true&fields=permissions(type,role)")
    except Exception as exc:  # noqa: BLE001
        scope = getattr(exc, "code", 0) == 403 and "insufficient" in _body_of(exc).lower()
        if scope and "--private-confirmed" in sys.argv:
            return True, "confirmed by hand: the token has no Drive scope, the sharing was set in Drive"
        return False, f"its permissions could not be read ({type(exc).__name__}{', no Drive scope' if scope else ''})"
    others: dict[str, int] = {}
    for p in perms.get("permissions") or []:
        if p.get("role") == "owner" and p.get("type") == "user":
            continue
        k = f"{p.get('type') or '?'} {p.get('role') or '?'}"
        others[k] = others.get(k, 0) + 1
    return (not others), (", ".join(f"{n} {k}" for k, n in sorted(others.items())) or "the owner only")


def database_folder(tok: str) -> str:
    q = (f"'{GATHER_SOURCE_FOLDER_ID}' in parents and name = 'Database' and "
         "mimeType = 'application/vnd.google-apps.folder' and trashed = false")
    try:
        got = api(tok, D + "?" + urllib.parse.urlencode({"q": q, "fields": "files(id)", "supportsAllDrives": "true",
                                                         "includeItemsFromAllDrives": "true"}))
    except Exception:  # noqa: BLE001
        return ""
    files = got.get("files") or []
    return str(files[0]["id"]) if files else ""


def mint(tok: str, house: dict, have: dict[str, str], now: str, dry: bool) -> str:
    tab, title, prop = house["tab"], house["title"], house["prop"]
    header = list(HEADERS[tab])
    src_ptr = f"switchboard:props.{prop}"
    # --use names a book that already exists, so a run never mints a second one
    sid = arg_pairs("use").get(tab) or have.get(src_ptr, "")
    clinical = bool(house["clinical"])
    print(f"\n{title}: pointer {'in the depot (' + sid[:14] + '…) — reusing the house' if sid else 'absent'}")
    if clinical and sid:
        private, said = private_to_owner(tok, sid)
        print(f"  who else can open it: {said}{'' if private else ' — NOT private'}")
        if not private and not dry:
            sys.exit(f"REFUSED: {title} ({sid}) can be opened by more than the platform account. "
                     "Remove every other permission, then run this again. Nothing more was written.")
    if dry:
        print(f"  --dry-run: would {'reuse' if sid else 'create'} \"{title}\" ({len(header)} columns, "
              f"{ROW_COUNT} rows), append its depot facts"
              f"{' (no moved switch: it stays out of the gather, private)' if clinical else ''}"
              f"{' and the Registry row data.' + tab if house['registry'] else ''}.")
        return sid or "(would create)"
    live_header = None
    if sid:
        got = api(tok, S + sid + "/values/" + urllib.parse.quote(f"'{tab}'!1:1")).get("values") or []
        live_header = [str(h) for h in (got[0] if got else []) if str(h).strip()]
        if live_header:
            header = live_header
            print(f"  live header kept ({len(header)} columns); the declaration follows it")
    if not sid:
        sid = api(tok, S, {"properties": {"title": title},
                           "sheets": [{"properties": {
                               "title": tab,
                               "gridProperties": {"rowCount": ROW_COUNT, "columnCount": len(header) + 3,
                                                  "frozenRowCount": 1}}}]}, "POST")["spreadsheetId"]
        print(f"  house created as the platform account: {title} = {sid}")
        if clinical:
            private, said = private_to_owner(tok, sid)
            if not private:
                sys.exit(f"REFUSED: the new {title} ({sid}) can be opened by {said} — the domain shares new "
                         "files. Remove every other permission (or delete the book), then run this again. "
                         "No depot fact was written, so nothing reads or fills it.")
    if not live_header:
        api(tok, S + sid + "/values/" + urllib.parse.quote(f"'{tab}'!A1") + "?valueInputOption=RAW",
            {"values": [header]}, "PUT")
        print(f"  header stamped ({len(header)} columns)")
    facts = []
    if have.get(src_ptr) != sid:
        facts.append(["config.props." + prop.lower().replace("_", ""), prop, sid, "", src_ptr, "", now,
                      RECORDED_BY, ""])
    if not clinical and have.get(f"switchboard:moved.{tab}") != "on":
        facts.append([f"config.moved.{tab}", f"moved.{tab}", "on", "", f"switchboard:moved.{tab}", "", now,
                      RECORDED_BY, ""])
    schema_val = json.dumps(header, separators=(",", ":"))
    if have.get(f"schema:{tab}.header") != schema_val:
        facts.append([f"schema.{tab}.header", "__schema", schema_val, "", f"schema:{tab}.header", "", now,
                      RECORDED_BY, ""])
    if facts:
        api(tok, S + ESSENCIAL_ID + "/values/" + urllib.parse.quote("'Facts'!A1") +
            ":append?valueInputOption=RAW&insertDataOption=INSERT_ROWS", {"values": facts}, "POST")
    fresh = depot_state(tok)
    assert fresh.get(src_ptr) == sid, f"{tab}: pointer did not land"
    print(f"  declared: {prop} → {sid[:14]}… · {'private, never gathered' if clinical else f'moved.{tab}=on'}"
          f" · schema ({len(header)} columns)")
    if house["registry"]:
        reg = api(tok, S + ESSENCIAL_ID + "/values/" + urllib.parse.quote("'Registry'!A2:D9999")).get("values") or []
        if any(len(r) > 0 and str(r[0]).strip().lower() == f"data.{tab}" for r in reg):
            print("  Registry row already present (context)")
        elif any(len(r) > 1 and str(r[1]).strip() == sid for r in reg):
            print("  Registry row already present (spreadsheet)")
        else:
            api(tok, S + ESSENCIAL_ID + "/values/" + urllib.parse.quote("'Registry'!A1") +
                ":append?valueInputOption=RAW&insertDataOption=INSERT_ROWS",
                {"values": [[f"data.{tab}", sid, "on", house["note"]]]}, "POST")
            print("  Registry row appended")
    return sid


def main() -> None:
    dry = "--dry-run" in sys.argv
    share = "--share" in sys.argv
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    tok = token()
    have = depot_state(tok)
    db = database_folder(tok)
    print("WHO CAN OPEN THE GATHERED BOOKS IN DRIVE (MedImports inherits this; the clinical books never do):")
    print(f"  ASA Hub - Source: {readers_of(tok, GATHER_SOURCE_FOLDER_ID)}")
    print(f"  ASA Hub - Source/Database: {readers_of(tok, db) if db else 'no Database folder found'}")
    only = [t for a in sys.argv if a.startswith("--only=") for t in a.split("=", 1)[1].split(",")]
    made = {h["tab"]: mint(tok, h, have, now, dry) for h in HOUSES if not only or h["tab"] in only}
    if dry:
        print("\n--dry-run: nothing was written.")
        return
    if share:
        sa = sa_email()
        if sa:
            try:
                api(tok, D + made["med_imports"] + "/permissions?sendNotificationEmail=false&supportsAllDrives=true",
                    {"role": "writer", "type": "user", "emailAddress": sa}, "POST")
                print(f"\n  MedImports shared with {sa} (writer); the clinical books are not shared")
            except Exception as exc:  # noqa: BLE001
                print(f"\n  WARNING: share failed ({type(exc).__name__})")
    print("\nTHE HOUSES ARE DECLARED, and EMPTY:")
    for tab, sid in made.items():
        print(f"  {tab} → {sid}")
    print("The relay fills them after each commit (house state reads `pending` until the door is published).")


if __name__ == "__main__":
    main()
