#!/usr/bin/env python3
"""Plant the decoder's vocabulary in the words book, from the code itself.

WHERE IT GOES:
`ASA Hub — Generic Configuration` — the book that already holds Prompts,
Strings, Conditions and the Smart Comms rows — gains five tabs:

    Digest Kinds       kind · category · needles · file_hints · weight · active
    Digest Categories  category · needles · order · active
    Digest Labels      label · order · active
    Digest Issuers     name · is_organisation · active
    Digest Drawers     drawer_prefix · category · active

From then on a new document type is a ROW somebody adds, not a deploy.

THE SEED COMES FROM THE CODE, read out of Digest.gs itself rather than typed
here — two lists that must agree are one list that will not. Digest.gs keeps
its tables as the FLOOR the platform decodes with when the book cannot be
read; this tool only carries them across the first time.

IDEMPOTENT AND NEVER DESTRUCTIVE: a tab that already holds rows is left
exactly as it is and reported. The book belongs to whoever edits it; a tool
that overwrote those words would be worse than no tool.

    python3 tools/seed_digest_vocab.py --dry-run
    python3 tools/seed_digest_vocab.py
    python3 tools/seed_digest_vocab.py --force-tab "Digest Kinds"   # re-seed one
"""
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
BOOK_ID = "1Ky7FPu876WavnMTzsO6zejDXtI1I4b2xebuMdsBMMgg"   # HUB_GENERIC_CONFIG_ID
S = "https://sheets.googleapis.com/v4/spreadsheets/"

DUMP_JS = r"""
const fs = require('node:fs'), vm = require('node:vm');
const ctx = { console, Date, Math, JSON, String, Number, Object, Array, RegExp,
              HUB_POLICY: {}, HUB_ACTIONS: {} };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(process.argv[2], "utf8"), ctx);
try { vm.runInContext(fs.readFileSync(process.argv[3], "utf8"), ctx); } catch (e) {}
process.stdout.write(JSON.stringify({
  kinds: ctx.DIGEST_DOC_KINDS, categories: ctx.DIGEST_CATEGORIES,
  labels: ctx.DIGEST_NAME_LABELS, issuers: ctx.DIGEST_ISSUERS,
  drawers: ctx.DIGEST_DRAWERS, zip: Object.keys(ctx.DIGEST_ZIP_EXTS || {}),
  types: ctx.FORM_FILE_TYPES || {},
  answers: ctx.DIGEST_ANSWER_FACTS || [],
  credentials: ctx.DIGEST_CREDENTIALS || [],
  expects: ctx.DIGEST_EXPECTS || [],
  settings: {
    zip_min_kb: Math.round((ctx.DIGEST_ZIP_MIN_BYTES || 0) / 1024),
    confidence_floor: ctx.DIGEST_CONFIDENCE_FLOOR,
    max_retries: ctx.DIGEST_MAX_RETRIES,
    probe_frames: 4,
    reread_before_version: '',
    distribute: 'record',
    distribute_confidence: 85,
  },
}));
"""



def _carry_foreign_keys(rows, api, S, book_id, tab):
    """Keep rows this tool does not ship, so a re-seed is additive.

    Only meaningful for a key/value tab: the first column is the identity and
    the shipped rows win on a collision, because the shipped value is the one
    the code was written against. Anything else in the tab is somebody's
    deliberate setting and is put back untouched.
    """
    if not rows or (rows[0] and rows[0][0] != "key"):
        return rows
    try:
        have_rows = api(S + book_id + "/values/" +
                        urllib.parse.quote(f"'{tab}'!A1:Z1000")).get("values") or []
    except Exception:
        return rows                      # unreadable: the shipped set is the floor
    if len(have_rows) < 2:
        return rows
    shipped = {str(r[0]).strip() for r in rows[1:] if r}
    width = len(rows[0])
    kept = []
    for r in have_rows[1:]:
        if not r or not str(r[0]).strip() or str(r[0]).strip() in shipped:
            continue
        kept.append((list(r) + [""] * width)[:width])
    if kept:
        print(f"   {tab}: carrying {len(kept)} key(s) this tool does not ship "
              f"({', '.join(str(k[0]) for k in kept[:6])})")
    return rows + kept

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
    """The decoder's own tables, evaluated out of Digest.gs."""
    js = ROOT / "tools" / ".dump-digest-vocab.cjs"
    js.write_text(DUMP_JS)
    try:
        out = subprocess.run(
            ["node", str(js), str(ROOT / "apps-script/Digest.gs"),
             str(ROOT / "apps-script/FormFiles.gs")],
            capture_output=True, text=True, timeout=60)
        if out.returncode != 0 or not out.stdout.strip():
            sys.exit("could not read the tables out of Digest.gs:\n" +
                     (out.stderr or "(no error text)")[:600])
        return json.loads(out.stdout)
    finally:
        js.unlink(missing_ok=True)


def rows_for(name: str, t: dict) -> list[list[str]]:
    if name == "Digest Kinds":
        out = [["kind", "category", "needles", "file_hints", "weight", "active", "notes"]]
        for entry in t["kinds"]:
            kind, cat, needles = entry[0], entry[1], entry[2]
            opts = entry[3] if len(entry) > 3 and entry[3] else {}
            out.append([kind, cat, ", ".join(needles),
                        ", ".join(opts.get("file", [])),
                        str(opts.get("w", 1)), "on", ""])
        return out
    if name == "Digest Categories":
        out = [["category", "needles", "order", "active"]]
        for i, (cat, needles) in enumerate(t["categories"], start=1):
            out.append([cat, ", ".join(needles), str(i * 10), "on"])
        return out
    if name == "Digest Labels":
        out = [["label", "order", "active"]]
        for i, label in enumerate(t["labels"], start=1):
            out.append([label, str(i * 10), "on"])
        return out
    if name == "Digest Issuers":
        out = [["name", "is_organisation", "active"]]
        for name_ in t["issuers"]:
            out.append([name_, "yes", "on"])
        return out
    if name == "Digest Drawers":
        out = [["drawer_prefix", "category", "active"]]
        for pre, cat in t["drawers"]:
            out.append([pre, cat, "on"])
        return out
    if name == "Digest Zip":
        out = [["ext", "active", "notes"]]
        for ext in t["zip"]:
            out.append([ext, "on", ""])
        return out
    if name == "Digest Settings":
        # every one is clamped in code: a typo answers with the floor
        notes = {
            "zip_min_kb": "below this the zip header eats the gain (20-20000)",
            "confidence_floor": "at or above it a file is never read again (40-100)",
            "max_retries": "how many re-reads a low-confidence row may have (0-5)",
            "probe_frames": "frames the ffmpeg arm reads from a clip (1-8)",
            "distribute": ("off | record | write — whether a decoded document "
                           "hands its receipt in to candidate_documents and "
                           "staff_clearance, or only records what it WOULD settle"),
            "distribute_confidence": "never settle an obligation on a guess (50-100)",
            "reread_before_version": ("rows decoded BEFORE this decoder version "
                                      "get one more read, whatever their "
                                      "confidence — blank means nobody"),
        }
        out = [["key", "value", "active", "notes"]]
        for k, v in t["settings"].items():
            out.append([k, str(v), "on", notes.get(k, "")])
        return out
    if name == "Digest Credentials":
        # WHICH OBLIGATION A DOCUMENT SPEAKS FOR. Four vocabularies already
        # existed for the same seven papers; this is the translation.
        # FIVE COLUMNS NOW, and this tool still unpacked four —
        # which meant it had not been run since the day `expires` was added
        # ("does this paper exist BECAUSE of a date?"). A seeder that cannot
        # run is a book that cannot be edited.
        out = [["doc_kind", "doc_id", "credential", "requirement", "expires",
                "active", "notes"]]
        for row in (t.get("credentials") or []):
            kind, doc_id, credential, requirement = row[0], row[1], row[2], row[3]
            expires = row[4] if len(row) > 4 else ""
            out.append([kind, doc_id, credential, requirement, expires, "on", ""])
        return out
    if name == "Digest Expects":
        # WHAT A KIND OF PAPER OWES. `must` absent is a hole worth naming on
        # the row; `may` absent is silence, not a finding.
        out = [["doc_kind", "must", "may", "active", "notes"]]
        for kind, must, may in (t.get("expects") or []):
            out.append([kind, ", ".join(must), ", ".join(may), "on", ""])
        return out
    if name == "Digest Answer Facts":
        # ORDER IS THE MEANING: "expiration date" must reach expires_on
        # before the bare `date` row can claim it.
        out = [["fact", "needles", "order", "active", "notes"]]
        for i, (fact, needles) in enumerate(t.get("answers") or [], start=1):
            out.append([fact, ", ".join(needles), str(i * 10), "on", ""])
        return out
    if name == "Form File Types":
        # the DOOR's allow-list. Runnable extensions are refused in code
        # whatever a row here says (DIGEST_TYPE_NEVER).
        out = [["ext", "mime", "active", "notes"]]
        for ext, mime in (t.get("types") or {}).items():
            out.append([ext, mime, "on", ""])
        return out
    raise KeyError(name)


def main() -> None:
    dry = "--dry-run" in sys.argv
    force = ""
    if "--force-tab" in sys.argv:
        force = sys.argv[sys.argv.index("--force-tab") + 1]

    t = tables()
    print(f"the code carries: {len(t['kinds'])} kinds · {len(t['categories'])} categories · "
          f"{len(t['labels'])} labels · {len(t['issuers'])} issuers · {len(t['drawers'])} drawers")

    meta = api(S + BOOK_ID + "?fields=properties.title,sheets.properties.title")
    print(f"book: {meta['properties']['title']}")
    have = {s["properties"]["title"] for s in meta.get("sheets", [])}

    for tab in ("Digest Kinds", "Digest Categories", "Digest Labels",
                "Digest Issuers", "Digest Drawers", "Digest Zip",
                "Digest Settings", "Form File Types",
                "Digest Answer Facts", "Digest Credentials", "Digest Expects"):
        rows = rows_for(tab, t)
        if tab in have:
            got = api(S + BOOK_ID + "/values/" +
                      urllib.parse.quote(f"'{tab}'!A1:Z2")).get("values") or []
            if len(got) > 1 and tab != force:
                print(f"   {tab}: already carries rows — left alone")
                continue
        # A RE-SEED MUST NOT SILENTLY UNSET WHAT SOMEBODY SET BY HAND.
        #
        # The write below clears A1:Z1000 and puts back only the keys THIS
        # tool ships. `Digest Settings` is a shared tab: the comms lane keeps
        # `comm_dial` there and it was set to `record`, and a
        # --force-tab "Digest Settings" — the very command this file's own
        # docstring advertises — would have cleared it, dropping the lane back
        # to its `off` floor with nothing said and no row left to explain it.
        #
        # So every key the book already holds that this tool does not ship
        # rides across the clear. The tool owns its vocabulary; it does not
        # own the tab.
        rows = _carry_foreign_keys(rows, api, S, BOOK_ID, tab) if tab in have else rows
        if dry:
            print(f"   {tab}: would write {len(rows) - 1} row(s)")
            continue
        if tab not in have:
            api(S + BOOK_ID + ":batchUpdate",
                {"requests": [{"addSheet": {"properties": {
                    "title": tab,
                    "gridProperties": {"frozenRowCount": 1}}}}]}, "POST")
        api(S + BOOK_ID + "/values/" + urllib.parse.quote(f"'{tab}'!A1:Z1000") +
            ":clear", {}, "POST")
        api(S + BOOK_ID + "/values/" + urllib.parse.quote(f"'{tab}'!A1") +
            "?valueInputOption=RAW", {"values": rows}, "PUT")
        back = api(S + BOOK_ID + "/values/" +
                   urllib.parse.quote(f"'{tab}'!A1:Z1000")).get("values") or []
        if len(back) != len(rows):
            sys.exit(f"{tab}: wrote {len(rows)} row(s), the book reads back {len(back)} — stop.")
        print(f"   {tab}: {len(rows) - 1} row(s), read back and verified")

    if not dry:
        print("\nthe words are in the book. Digest.gs keeps its tables as the "
              "floor: if the book cannot be read, the platform decodes with "
              "them and says so in the log.")


if __name__ == "__main__":
    main()
