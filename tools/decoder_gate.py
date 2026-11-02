#!/usr/bin/env python3
"""THE GATE — what a change to the decoder would do to everything already filed.

Every decoder change today is defended by a probe of forty-odd cases caught
by hand. That is a memory, not a measurement: it says "the
mistakes I know about did not come back", and says nothing about the four and
a half thousand documents this platform has already judged. Twice in one day
a change that passed the probe moved real rows — once for the
better (a do-not-resuscitate order stopped being a CPR card), once for the
worse (a folder's name made lab results read as prescriptions, 2% wrong to
12%), and only running the corpus showed the difference.

So: take the text ALREADY STORED on every row — no Drive, no OCR, no quota —
run today's classifier over it, and print what moved against the verdict the
row carries. Seconds, deterministic, and it can be run before a commit.

    python3 tools/decoder_gate.py                  # both ledgers, summary
    python3 tools/decoder_gate.py --save base.json # remember this state
    python3 tools/decoder_gate.py --against base.json   # what MY change did
    python3 tools/decoder_gate.py --kind isp --show 20  # the rows behind a number
    python3 tools/decoder_gate.py --engine /tmp/old.gs --save was.json   # a PAST decoder

WHAT IT IS NOT: it is not a truth. The stored verdict was produced by an
older decoder and is wrong in places — that is why `--against` exists, to
compare a change against the PREVIOUS RUN rather than against the past. A row
that moves is a row to look at, not a row to fear.
"""
from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import urllib.parse
import urllib.request
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ENV_PATH = Path("/opt/docker/asa-hub/server/.tools.env")
S = "https://sheets.googleapis.com/v4/spreadsheets/"
LEDGERS = [
    ("form_files", "19OvLdtyF0iENHcesFFm_6DyGjnqTfrjStAQJjiyh6Ww", "file_name"),
    ("client_files", "1o7opeC1GR3J5Oj7iGEgYo0EKLPmkW_paGBtE8uMx3LY", "title"),
]

EVAL_JS = r"""
const fs = require('node:fs'), vm = require('node:vm');
const ctx = { console, Date, Math, JSON, String, Number, Object, Array, RegExp,
              HUB_POLICY: {}, HUB_ACTIONS: {},
              str_: (v) => (v === null || v === undefined ? '' : String(v).trim()),
              randomHex_: (n) => 'x'.repeat(n), listRows_: () => [] };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(process.argv[2], 'utf8'), ctx);
const rows = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
const out = rows.map((r) => {
  const k = ctx.digestDocKind_(r.name, r.text) || {};
  let roles = ctx.digestDateRoles_(r.text);
  if (ctx.digestRolesFinish_) {
    roles = ctx.digestRolesFinish_(k.kind, roles, ctx.digestDates_(r.name, r.text), '');
  }
  return { id: r.id, name: r.name, kind: k.kind || '', score: k.score || 0,
           issued: roles.issued || '', expires: roles.expires || '',
           born: roles.born || '',
           person: ctx.digestNameFromText_ ? (ctx.digestNameFromText_(r.text, k.kind) || '') : '',
           missing: ctx.digestMissing_ ? ctx.digestMissing_(k.kind, {
             person: 'x', expires_on: roles.expires, issued_on: roles.issued,
             born_on: roles.born }) : [] };
});
process.stdout.write(JSON.stringify(out));
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
    req = urllib.request.Request("https://oauth2.googleapis.com/token", data=body, method="POST")
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)["access_token"]


def col_letter(i: int) -> str:
    out = ""
    i += 1
    while i:
        i, rem = divmod(i - 1, 26)
        out = chr(65 + rem) + out
    return out


def fetch(tok: str, house: str, tab: str, name_col: str) -> list[dict]:
    def api(url: str):
        req = urllib.request.Request(url)
        req.add_header("Authorization", "Bearer " + tok)
        with urllib.request.urlopen(req, timeout=300) as r:
            return json.load(r)

    head = (api(S + house + "/values/" + urllib.parse.quote(f"'{tab}'!A1:BZ1")).get("values") or [[]])[0]
    head = [str(h) for h in head]
    want = ["id", name_col, "digest_text", "doc_kind", "issued_on", "expires_on", "digest_state"]
    have = [w for w in want if w in head]
    ranges = "&".join("ranges=" + urllib.parse.quote(
        f"'{tab}'!{col_letter(head.index(w))}1:{col_letter(head.index(w))}8000") for w in have)
    got = api(S + house + "/values:batchGet?" + ranges + "&majorDimension=COLUMNS")
    cols = {}
    for w, vr in zip(have, got.get("valueRanges") or []):
        v = vr.get("values") or [[]]
        cols[w] = v[0] if v else []

    def cell(w, i):
        v = cols.get(w) or []
        return str(v[i]) if i < len(v) else ""

    n = max((len(v) for v in cols.values()), default=1)
    rows = []
    for i in range(1, n):
        text = cell("digest_text", i)
        if not text:
            continue
        rows.append({"id": cell("id", i) or f"{tab}#{i+1}", "name": cell(name_col, i),
                     "text": text, "was_kind": cell("doc_kind", i),
                     "was_issued": cell("issued_on", i), "was_expires": cell("expires_on", i),
                     "state": cell("digest_state", i)})
    return rows


def classify(rows: list[dict], engine: str = "") -> list[dict]:
    with tempfile.TemporaryDirectory() as tmp:
        js = Path(tmp) / "gate.cjs"
        js.write_text(EVAL_JS)
        payload = Path(tmp) / "in.json"
        payload.write_text(json.dumps([{"id": r["id"], "name": r["name"], "text": r["text"]}
                                       for r in rows]))
        gs = engine or str(ROOT / "apps-script/Digest.gs")
        run = subprocess.run(["node", str(js), gs, str(payload)],
                             capture_output=True, text=True, timeout=1800)
        if run.returncode != 0 or not run.stdout.strip():
            sys.exit(f"the classifier refused to run:\n{run.stderr[:600]}")
        return json.loads(run.stdout)


def main() -> None:
    args = sys.argv[1:]
    save = against = kind_filter = engine = ""
    show = 0
    for i, a in enumerate(args):
        if a == "--save" and i + 1 < len(args):
            save = args[i + 1]
        if a == "--against" and i + 1 < len(args):
            against = args[i + 1]
        if a == "--kind" and i + 1 < len(args):
            kind_filter = args[i + 1]
        if a == "--show" and i + 1 < len(args):
            show = int(args[i + 1])
        # A PAST DECODER, so "what did MY change do" is answerable without
        # waiting a day for a new baseline: git show <sha>:apps-script/Digest.gs
        if a == "--engine" and i + 1 < len(args):
            engine = args[i + 1]

    tok = bearer()
    now: dict[str, dict] = {}
    stored: dict[str, dict] = {}
    for tab, house, name_col in LEDGERS:
        rows = fetch(tok, house, tab, name_col)
        print(f"{tab}: {len(rows)} row(s) carrying text")
        for r, got in zip(rows, classify(rows, engine)):
            now[r["id"]] = got
            stored[r["id"]] = r

    # ── against the verdict on the row ──────────────────────────────────────
    agree = silent = moved = 0
    pairs: Counter = Counter()
    examples: dict[str, list] = {}
    for rid, got in now.items():
        was = stored[rid]["was_kind"]
        if not was:
            continue
        if not got["kind"]:
            silent += 1
        elif got["kind"] == was:
            agree += 1
        else:
            moved += 1
            key = f"{was} → {got['kind']}"
            pairs[key] += 1
            examples.setdefault(key, []).append((rid, stored[rid]["name"][:48]))
    total = agree + silent + moved
    print(f"\nagainst the verdict already on the row ({total} judged row(s)):")
    print(f"   agrees   {agree:>5}   says nothing {silent:>5}   moved {moved:>5}")
    for key, n in pairs.most_common(12 if not kind_filter else 40):
        if kind_filter and kind_filter not in key:
            continue
        print(f"   {key:<46} {n}")
        for rid, name in (examples[key][:show] if show else []):
            print(f"        {rid[:12]}  {name}")

    # ── dates and holes, which the kind alone does not show ────────────────
    with_exp = sum(1 for g in now.values() if g["expires"])
    with_iss = sum(1 for g in now.values() if g["issued"])
    with_born = sum(1 for g in now.values() if g["born"])
    holes = Counter(m for g in now.values() for m in (g.get("missing") or []))
    print(f"\nwhat the reading carries: issued {with_iss}   expires {with_exp}   born {with_born}")
    print("   holes the kind says are owed: " +
          (", ".join(f"{k} {v}" for k, v in holes.most_common(6)) or "none"))

    snap = {rid: {k: g[k] for k in ("kind", "issued", "expires", "born")}
            for rid, g in now.items()}
    if save:
        Path(save).write_text(json.dumps(snap))
        print(f"\nsaved {len(snap)} row(s) to {save} — run --against it after a change")

    if against:
        base = json.loads(Path(against).read_text())
        changed = []
        for rid, g in snap.items():
            b = base.get(rid)
            if not b:
                continue
            diff = [f for f in ("kind", "issued", "expires", "born") if b[f] != g[f]]
            if diff:
                changed.append((rid, stored[rid]["name"][:44], b, g, diff))
        print(f"\nagainst {against}: {len(changed)} row(s) MOVED "
              f"out of {len(base)} remembered")
        for rid, name, b, g, diff in changed[:show or 20]:
            for f in diff:
                print(f"   {name:<46} {f:<8} {b[f] or '—':<14} → {g[f] or '—'}")
        if len(changed) > (show or 20):
            print(f"   ... and {len(changed) - (show or 20)} more (--show N)")
        sys.exit(1 if changed else 0)


if __name__ == "__main__":
    main()
