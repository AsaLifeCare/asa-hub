#!/usr/bin/env python3
"""usage: hub_config_set.py kv <book> <tab> <key> <value> | row <book> <tab> k=v... [--add-columns] | get <book> <tab> [key] | cell <book> <tab> <row_id> <column> <value>"""
import json
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ENV_PATH = Path("/opt/docker/asa-hub/server/.tools.env")
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
    req = urllib.request.Request("https://oauth2.googleapis.com/token", data=body, method="POST")
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)["access_token"]


TOK = bearer()


def api(url: str, payload: dict | None = None, method: str = "GET") -> dict:
    req = urllib.request.Request(url, method=method)
    req.add_header("Authorization", "Bearer " + TOK)
    if payload is not None:
        req.add_header("Content-Type", "application/json")
        req.data = json.dumps(payload).encode()
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        sys.exit(f"{method} {url.split('/v4/')[-1][:80]} -> {e.code}: {e.read().decode()[:300]}")


def col_letter(i: int) -> str:
    s = ""
    i += 1
    while i:
        i, r = divmod(i - 1, 26)
        s = chr(65 + r) + s
    return s


def read(book: str, tab: str) -> list[list[str]]:
    return api(S + book + "/values/" + urllib.parse.quote(f"'{tab}'!A1:AZ2000")).get("values") or []


def show(book: str, tab: str, key: str | None) -> None:
    rows = read(book, tab)
    if not rows:
        print(f"{tab}: empty")
        return
    hdr = rows[0]
    for r in rows[1:]:
        if key is None or (r and str(r[0]).strip() == key):
            print(" | ".join(f"{hdr[i] if i < len(hdr) else '?'}={r[i]}" for i in range(len(r)) if str(r[i]).strip()))


def set_kv(book: str, tab: str, key: str, value: str) -> None:
    rows = read(book, tab)
    if not rows or [str(c).strip().lower() for c in rows[0][:2]] != ["key", "value"]:
        sys.exit(f"{tab}: not a key/value tab (header {rows[0][:3] if rows else '?'})")
    hit = None
    for i, r in enumerate(rows[1:], start=2):
        if r and str(r[0]).strip() == key:
            hit = (i, r)
            break
    if hit:
        rownum, old = hit
        print(f"{tab}.{key}: '{old[1] if len(old) > 1 else ''}'  ->  '{value}'  (row {rownum})")
        api(S + book + "/values/" + urllib.parse.quote(f"'{tab}'!B{rownum}") + "?valueInputOption=RAW",
            {"values": [[value]]}, "PUT")
    else:
        print(f"{tab}.{key}: (absent)  ->  '{value}'  (appended)")
        api(S + book + "/values/" + urllib.parse.quote(f"'{tab}'!A1") + ":append?valueInputOption=RAW",
            {"values": [[key, value]]}, "POST")
    back = read(book, tab)
    got = [r for r in back[1:] if r and str(r[0]).strip() == key]
    if not got or (len(got[0]) > 1 and got[0][1] != value):
        sys.exit(f"{tab}.{key}: the book reads back {got} — stop.")
    print(f"   read back: {key} = {got[0][1] if len(got[0]) > 1 else ''}")


def append_row(book: str, tab: str, fields: dict[str, str], add_columns: bool = False) -> None:
    rows = read(book, tab)
    if not rows:
        sys.exit(f"{tab}: no header row — refusing to invent one")
    hdr = [str(h).strip() for h in rows[0]]
    unknown = [k for k in fields if k not in hdr]
    if unknown and add_columns:
        # only header-named tabs may grow a column: blank cells read as "keep what the code shipped"
        start = len(hdr)
        api(S + book + "/values/" + urllib.parse.quote(f"'{tab}'!{col_letter(start)}1") + "?valueInputOption=RAW",
            {"values": [unknown]}, "PUT")
        hdr = hdr + unknown
        print(f"{tab}: header grew {unknown} at column {col_letter(start)}")
    elif unknown:
        sys.exit(f"{tab}: the live header has no column(s) {unknown}; header is {hdr} (pass --add-columns for a header-named tab)")
    idcol = hdr.index("id") if "id" in hdr else 0
    if "id" in hdr and any(r and idcol < len(r) and str(r[idcol]).strip() == fields.get("id") for r in rows[1:]):
        print(f"{tab}: a row with id={fields.get('id')} already exists — left alone")
        return
    line = [fields.get(h, "") for h in hdr]
    api(S + book + "/values/" + urllib.parse.quote(f"'{tab}'!A1") + ":append?valueInputOption=RAW",
        {"values": [line]}, "POST")
    back = read(book, tab)
    got = [r for r in back[1:] if r and idcol < len(r) and str(r[idcol]).strip() == fields.get("id", line[idcol])]
    if not got:
        sys.exit(f"{tab}: the appended row does not read back — stop.")
    print(f"{tab}: appended id={fields.get('id')} under {len(hdr)} live columns; read back ok")


def set_cell(book: str, tab: str, row_id: str, column: str, value: str) -> None:
    """The column is found by live header name, never by position: the situations tab is positional."""
    rows = read(book, tab)
    if not rows:
        sys.exit(f"{tab}: no header row — refusing to write into a tab with no names")
    hdr = [str(h).strip() for h in rows[0]]
    if column not in hdr:
        sys.exit(f"{tab}: the live header has no column '{column}' — it carries {hdr}")
    col = hdr.index(column)
    at = None
    for i, r in enumerate(rows[1:], start=2):
        if r and str(r[0]).strip() == row_id:
            at = i
            was = r[col] if col < len(r) else ""
            break
    if at is None:
        sys.exit(f"{tab}: no row with id '{row_id}' — a row is edited here, never created")
    print(f"{tab}[{row_id}].{column}: '{str(was)[:70]}'  ->  '{value[:70]}'  (row {at})")
    api(S + book + "/values/" + urllib.parse.quote(f"'{tab}'!{col_letter(col)}{at}") + "?valueInputOption=RAW",
        {"values": [[value]]}, "PUT")
    back = read(book, tab)
    got = [r for r in back[1:] if r and str(r[0]).strip() == row_id]
    now = (got[0][col] if got and col < len(got[0]) else "")
    if now != value:
        sys.exit(f"{tab}[{row_id}].{column}: the book reads back '{now[:70]}' — stop.")
    print("   read back ok")


if __name__ == "__main__":
    a = sys.argv[1:]
    if len(a) == 6 and a[0] == "cell":
        set_cell(a[1], a[2], a[3], a[4], a[5])
    elif len(a) >= 3 and a[0] == "get":
        show(a[1], a[2], a[3] if len(a) > 3 else None)
    elif len(a) == 5 and a[0] == "kv":
        set_kv(a[1], a[2], a[3], a[4])
    elif len(a) >= 4 and a[0] == "row":
        add = "--add-columns" in a
        kvs = [x for x in a[3:] if x != "--add-columns"]
        append_row(a[1], a[2], dict(kv.split("=", 1) for kv in kvs), add_columns=add)
    else:
        sys.exit(__doc__)
