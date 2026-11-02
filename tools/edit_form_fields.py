#!/usr/bin/env python3
"""Change the questions of a form the platform owns — by key, never by hand.

A form is a ROW and its questions are one cell of JSON, so "remove the
description box" is a cell edit. Doing it in the spreadsheet by hand is how a
definition ends up unparseable and the mask draws nothing; this does it with
the row read first, the change named, and the result read back.

    python3 tools/edit_form_fields.py <slug> --show
    python3 tools/edit_form_fields.py <slug> --drop notes[,other_key]
    python3 tools/edit_form_fields.py <slug> --json path/to/fields.json
    (add --dry-run to any of them)

REFUSALS, all of them deliberate: an unknown slug, an archived row, a key the
form does not ask, a definition that would leave no real question behind, and
any JSON that is not a list of questions. A form that collects nothing is not
a smaller form, it is a broken link somebody already sent out.
"""
from __future__ import annotations

import json
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

ENV_PATH = Path("/opt/docker/asa-hub/server/.tools.env")
FORMS_HOUSE = "1yMFlXYlcS-bBImucBfULgMv3XSFzqeNPvkefG-j7IdQ"   # ASA Data — Forms
TAB = "Data"
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


def api(url: str, payload: dict | None = None, method: str = "GET") -> dict:
    for attempt in range(5):
        req = urllib.request.Request(url, method=method)
        req.add_header("Authorization", "Bearer " + TOK)
        if payload is not None:
            req.add_header("Content-Type", "application/json")
            req.data = json.dumps(payload).encode()
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 503) and attempt < 4:
                time.sleep(2 ** attempt)
                continue
            sys.exit(f"{e.code} {e.reason} — {e.read()[:300]!r}")
    return {}


def col_letter(i: int) -> str:
    out = ""
    i += 1
    while i:
        i, rem = divmod(i - 1, 26)
        out = chr(65 + rem) + out
    return out


def main() -> None:
    args = sys.argv[1:]
    if not args:
        sys.exit(__doc__)
    slug = args[0].strip().lower()
    dry = "--dry-run" in args
    drop = ""
    replace = ""
    for i, a in enumerate(args):
        if a == "--drop" and i + 1 < len(args):
            drop = args[i + 1]
        if a == "--json" and i + 1 < len(args):
            replace = args[i + 1]

    grid = api(S + FORMS_HOUSE + "/values/" +
               urllib.parse.quote(f"'{TAB}'!A1:Z999")).get("values") or []
    header = [str(h) for h in grid[0]]
    at = {h: i for i, h in enumerate(header)}
    row_n, row = 0, None
    for n, r in enumerate(grid[1:], start=2):
        got = str(r[at["slug"]]) if at["slug"] < len(r) else ""
        if got.strip().lower() == slug:
            row_n, row = n, r
            break
    if not row:
        sys.exit(f"no form called {slug!r} in the house.")

    def cell(name: str) -> str:
        i = at.get(name, -1)
        return str(row[i]) if 0 <= i < len(row) else ""

    if cell("archived").strip().lower() == "true":
        sys.exit(f"{slug} is archived — restore it before editing its questions.")

    fields = json.loads(cell("fields") or "[]")
    print(f"{slug}: {len(fields)} question(s)")
    for f in fields:
        print(f"   {f.get('key'):<16} {f.get('kind'):<8} {f.get('label', '')}")
    if not drop and not replace:
        return

    if replace:
        fresh = json.loads(Path(replace).read_text())
    else:
        keys = [k.strip() for k in drop.split(",") if k.strip()]
        have = {str(f.get("key")) for f in fields}
        unknown = [k for k in keys if k not in have]
        if unknown:
            sys.exit(f"this form does not ask {', '.join(unknown)} — nothing changed.")
        fresh = [f for f in fields if str(f.get("key")) not in keys]

    if not isinstance(fresh, list):
        sys.exit("the questions must be a list.")
    real = [f for f in fresh if str(f.get("kind")) != "heading"]
    if not real:
        sys.exit("that would leave a form with no question in it — refused.")
    print(f"\n{'would write' if dry else 'writing'}: {len(fresh)} question(s) "
          f"({', '.join(str(f.get('key')) for f in fresh)})")
    if dry:
        return

    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    body = {"valueInputOption": "RAW", "data": [
        {"range": f"'{TAB}'!{col_letter(at['fields'])}{row_n}",
         "values": [[json.dumps(fresh, ensure_ascii=False, separators=(",", ":"))]]},
        {"range": f"'{TAB}'!{col_letter(at['updatedAt'])}{row_n}",
         "values": [[now]]},
    ]}
    api(S + FORMS_HOUSE + "/values:batchUpdate", body, "POST")

    back = api(S + FORMS_HOUSE + "/values/" +
               urllib.parse.quote(f"'{TAB}'!{col_letter(at['fields'])}{row_n}")).get("values")
    landed = json.loads(back[0][0]) if back else []
    if [str(f.get("key")) for f in landed] != [str(f.get("key")) for f in fresh]:
        sys.exit("VERIFY FAILED: the cell does not read back as written.")
    print(f"landed — {len(landed)} question(s), the house re-read and agrees.")
    # THE ENGINE CACHES A TAB FOR TEN MINUTES (Cache.gs, CACHE_TTL_SECONDS),
    # and this tool writes to the SHEET, not through a platform door — so
    # nothing bumps the cache version. The mask keeps drawing the old
    # questions for up to ten minutes, which looks exactly like a write that
    # did not land — it reads as "json dont load" with the sheet already
    # holding json. Any write through the Forms screen — the testing flask,
    # a rename — bumps it at once.
    print("the mask may keep the OLD questions for up to 10 minutes: the "
          "engine caches each tab. Press the testing flask on the Forms "
          "screen (twice, to leave it as it was) to bump it now.")


if __name__ == "__main__":
    main()
