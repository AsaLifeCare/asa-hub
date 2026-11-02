#!/usr/bin/env python3
"""Seed the six named lists into the words book from the code; a tab that already has rows is left alone."""
from __future__ import annotations

import json
import subprocess
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ENV_PATH = Path("/opt/docker/asa-hub/server/.tools.env")
BOOK_ID = "1Ky7FPu876WavnMTzsO6zejDXtI1I4b2xebuMdsBMMgg"
S = "https://sheets.googleapis.com/v4/spreadsheets/"

DUMP_JS = r"""
const fs = require('node:fs'), vm = require('node:vm');
const ctx = { console, Date, Math, JSON, String, Number, Object, Array, RegExp,
              HUB_POLICY: {}, HUB_ACTIONS: {} };
vm.createContext(ctx);
for (const f of process.argv.slice(2)) {
  try { vm.runInContext(fs.readFileSync(f, 'utf8'), ctx); } catch (e) {}
}
process.stdout.write(JSON.stringify({
  statuses: ctx.CONTACTS_STATUS_VOCAB_SEED || [],
  roles: ctx.CONTACTS_ROLE_VOCAB_SEED || [],
  institutional: ctx.CONTACTS_INSTITUTIONAL_SEED || [],
  header: ctx.SMART_HEADER || [],
  mailbox: ctx.SMART_MAILBOX_EVENTS_SEED || [],
  ai: ctx.SMART_AI_REQUESTS_SEED || [],
  situations: ctx.SMART_EXTRA_SITUATIONS_SEED || [],
  generic: ctx.SMART_GENERIC_SEED || {},
  dodd: ctx.SMART_DODD_SMS_SEED || '',
}));
"""


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


def tables() -> dict:
    js = ROOT / "tools" / ".dump-hub-book.cjs"
    js.write_text(DUMP_JS)
    try:
        out = subprocess.run(
            ["node", str(js),
             str(ROOT / "apps-script/HubCore.gs"),
             str(ROOT / "apps-script/ContactsSync.gs"),
             str(ROOT / "apps-script/SmartComms.gs")],
            capture_output=True, text=True, timeout=60)
        if out.returncode != 0 or not out.stdout.strip():
            sys.exit("could not read the tables:\n" + (out.stderr or "")[:600])
        return json.loads(out.stdout)
    finally:
        js.unlink(missing_ok=True)


def records(rows: list[dict], keys: list[str]) -> list[list[str]]:
    out = [keys + ["active", "notes"]]
    for r in rows:
        out.append([str(r.get(k, "") or "") for k in keys] + ["on", ""])
    return out


def rows_for(name: str, t: dict) -> list[list[str]]:
    if name == "Contacts Statuses":
        return [["status", "active", "notes"]] + [[w, "on", ""] for w in t["statuses"]]
    if name == "Contacts Roles":
        return [["role", "active", "notes"]] + [[w, "on", ""] for w in t["roles"]]
    if name == "Contacts Institutional":
        return [["prefix", "active", "notes"]] + [[w, "on", ""] for w in t["institutional"]]
    if name == "Smart Header":
        # the reader refuses a book that does not begin with the compiled list, in this order
        return ([["column", "order", "notes"]] +
                [[c, str((i + 1) * 10), ""] for i, c in enumerate(t["header"])])
    if name == "Smart Mailbox Events":
        keys = ["id", "kind", "event", "enabled", "channels", "days_before",
                "statuses", "to", "label", "sender", "sms_text",
                "email_subject", "email_text", "note"]
        return records(t["mailbox"], keys)
    if name == "Smart AI Requests":
        keys = ["id", "enabled", "kind", "label", "ai_model", "ai_providers", "note"]
        return records(t["ai"], keys)
    if name == "Smart Situations":
        keys = ["id", "credential", "label", "days_before", "sms_text",
                "email_subject", "email_text", "note"]
        return records(t["situations"], keys)
    if name == "Smart Letters":
        g = t["generic"]
        return [["key", "value", "active", "notes"],
                ["generic_sms", g.get("sms_text", ""), "on",
                 "every expiring credential that has no wording of its own"],
                ["generic_email_subject", g.get("email_subject", ""), "on", ""],
                ["generic_email_text", g.get("email_text", ""), "on", ""],
                ["dodd_sms", t["dodd"], "on",
                 "DODD keeps its own: the State's renewal link and all 8 hours"]]
    raise KeyError(name)


TABS = ["Contacts Statuses", "Contacts Roles", "Contacts Institutional",
        "Smart Header", "Smart Mailbox Events", "Smart AI Requests",
        "Smart Situations", "Smart Letters"]


def main() -> None:
    dry = "--dry-run" in sys.argv
    t = tables()
    print(f"the code carries: {len(t['statuses'])} statuses · {len(t['roles'])} roles · "
          f"{len(t['institutional'])} institutional · {len(t['header'])} header columns · "
          f"{len(t['mailbox'])} mailbox events · {len(t['ai'])} ai requests · "
          f"{len(t['situations'])} situations")
    meta = api(S + BOOK_ID + "?fields=properties.title,sheets.properties.title")
    print(f"book: {meta['properties']['title']}")
    have = {s["properties"]["title"] for s in meta.get("sheets", [])}

    for tab in TABS:
        rows = rows_for(tab, t)
        if tab in have:
            got = api(S + BOOK_ID + "/values/" +
                      urllib.parse.quote(f"'{tab}'!A1:Z2")).get("values") or []
            if len(got) > 1:
                print(f"   {tab}: already carries rows — left alone")
                continue
        if dry:
            print(f"   {tab}: would write {len(rows) - 1} row(s)")
            continue
        if tab not in have:
            api(S + BOOK_ID + ":batchUpdate",
                {"requests": [{"addSheet": {"properties": {
                    "title": tab, "gridProperties": {"frozenRowCount": 1}}}}]}, "POST")
        api(S + BOOK_ID + "/values/" + urllib.parse.quote(f"'{tab}'!A1:Z2000") +
            ":clear", {}, "POST")
        api(S + BOOK_ID + "/values/" + urllib.parse.quote(f"'{tab}'!A1") +
            "?valueInputOption=RAW", {"values": rows}, "PUT")
        back = api(S + BOOK_ID + "/values/" +
                   urllib.parse.quote(f"'{tab}'!A1:Z2000")).get("values") or []
        if len(back) != len(rows):
            sys.exit(f"VERIFY FAILED on {tab}: wrote {len(rows)}, read back {len(back)}")
        print(f"   {tab}: {len(rows) - 1} row(s), read back and verified")

    print("\nthe words are in the book. The code keeps its tables as the FLOOR: "
          "if the book cannot be read, the platform behaves exactly as it did "
          "before this move, and says so in the log.")


if __name__ == "__main__":
    main()
