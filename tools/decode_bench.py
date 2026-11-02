#!/usr/bin/env python3
"""Usage: decode_bench.py --dir DIR | --drive FOLDER_ID | --ledger formFiles|clientFiles | --ids FILE [--json OUT]"""
from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path("/opt/docker/asa-hub")
ENV_PATH = Path("/opt/docker/asa-hub/server/.tools.env")
DRIVE = "https://www.googleapis.com/drive/v3/files"

EVAL_JS = r"""
const fs = require('node:fs'), vm = require('node:vm');
/* THE HELPERS DIGEST.GS DOES NOT DEFINE. str_ lives in Talent.gs and
   listRows_ in SheetDb.gs; both are one-liners in spirit, and stubbing them
   here is what lets the REAL digestWhoIs_ run against the REAL roster
   instead of the bench inventing a second way to recognise a person. */
const roster = JSON.parse(fs.readFileSync(process.argv[4] || '/dev/null', 'utf8') || '{}');
const ctx = { console, Date, Math, JSON, String, Number, Object, Array, RegExp,
              HUB_POLICY: {}, HUB_ACTIONS: {},
              str_: (v) => (v === null || v === undefined ? '' : String(v).trim()),
              randomHex_: (n) => 'x'.repeat(n),
              listRows_: (res) => roster[res] || [] };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(process.argv[2], 'utf8'), ctx);
const items = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
const out = [];
for (const it of items) {
  const name = it.name, text = it.text || '';
  const kind = ctx.digestDocKind_(name, text);
  const roles = ctx.digestDateRoles_(text);
  const pairs = ctx.digestPairs_(text);
  // THE SAME LADDER digestOne_ WALKS, roster first — an id the roster gives
  // is proof, and it is the difference between 76 and 85 on a short card.
  const whoGot = ctx.digestWhoIs_(text, name);
  let who = whoGot ? whoGot.id : '';
  let person = whoGot ? (whoGot.display || '') : '';
  let source = person ? 'roster' : '';
  if (!person) { person = ctx.digestNameFromTitle_(name) || ''; source = person ? 'title' : ''; }
  if (!person) { person = ctx.digestNameFromText_(text) || ctx.digestNameFromPairs_(pairs) || ''; source = person ? 'field' : ''; }
  if (!person && kind.kind === 'application_resume') { person = ctx.digestNameFromHead_(text) || ''; source = person ? 'head' : ''; }
  if (person && source === 'title' && !ctx.DIGEST_PERSON_KINDS[kind.kind] &&
      !text.toLowerCase().includes(person.toLowerCase())) { person = ''; source = ''; }
  const cred = ctx.digestCredentialFor_(kind.kind);
  const facts = { doc_kind: kind.kind, category: kind.category, category_source: 'doc_kind',
                  issued_on: roles.issued, expires_on: roles.expires,
                  issuer: ctx.digestIssuer_(text), who: who, person: person,
                  person_source: source, dates: ctx.digestDates_(name, text),
                  pairs: pairs, numbers: ctx.digestNumbers_(text),
                  kind_score: kind.score || 0, chars: text.length };
  out.push({ file: name, chars: text.length, method: it.method || '', who: who,
             kind: kind.kind || '', score: kind.score || 0, alt: kind.alt || '',
             category: kind.category || '', person: person, person_source: source,
             issued_on: roles.issued || '', expires_on: roles.expires || '',
             issuer: facts.issuer || '', numbers: facts.numbers,
             settles: cred ? cred.doc_id : '', credential: cred ? cred.credential : '',
             confidence: ctx.digestConfidence_(facts),
             head: text.slice(0, 160).replace(/\s+/g, ' ') });
}
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


def drive_files(folder: str, tok: str) -> list[dict]:
    out, page = [], ""
    while True:
        q = urllib.parse.urlencode({
            "q": f"'{folder}' in parents and trashed=false",
            "fields": "nextPageToken,files(id,name,mimeType,size)",
            "pageSize": "200", "supportsAllDrives": "true",
            "includeItemsFromAllDrives": "true",
            **({"pageToken": page} if page else {})})
        req = urllib.request.Request(f"{DRIVE}?{q}")
        req.add_header("Authorization", "Bearer " + tok)
        with urllib.request.urlopen(req, timeout=60) as r:
            got = json.load(r)
        out.extend(got.get("files", []))
        page = got.get("nextPageToken", "")
        if not page:
            break
    return out


def drive_bytes(fid: str, tok: str, dest: Path) -> None:
    req = urllib.request.Request(f"{DRIVE}/{fid}?alt=media&supportsAllDrives=true")
    req.add_header("Authorization", "Bearer " + tok)
    with urllib.request.urlopen(req, timeout=300) as r:
        dest.write_bytes(r.read())


PLAIN = (".txt", ".md", ".csv", ".json", ".html", ".htm", ".xml", ".tsv",
         ".js", ".mjs", ".ts", ".tsx", ".jsx", ".css", ".py", ".sql",
         ".yml", ".yaml", ".log", ".srt", ".vtt")


def text_of(path: Path, mime: str, name: str) -> dict:
    """The relay's own reader, imported; plain text is read here because that reader answers empty for it."""
    if name.lower().endswith(PLAIN):
        try:
            return {"text": path.read_text(errors="replace"), "method": "plain"}
        except Exception as e:                         # noqa: BLE001
            return {"text": "", "method": f"unreadable: {str(e)[:60]}"}
    sys.path.insert(0, str(ROOT / "server"))
    try:
        from media_probe import _document_text        # noqa: PLC0415
        got = _document_text(path, mime, name)
        if (got or {}).get("text"):
            return got
        return {"text": "", "method": (got or {}).get("method", "") or "no text"}
    except Exception as e:                             # noqa: BLE001
        return {"text": "", "method": f"unreadable: {str(e)[:60]}"}


LEDGERS = {
    "formFiles": ("19OvLdtyF0iENHcesFFm_6DyGjnqTfrjStAQJjiyh6Ww", "form_files",
                  "file_id", "file_name"),
    "clientFiles": ("1o7opeC1GR3J5Oj7iGEgYo0EKLPmkW_paGBtE8uMx3LY", "client_files",
                    "drive_id", "title"),
}
PROBE_URL = "https://asamylife.asalifecare.com/media-probe"
PROBE_KEY_PATHS = ("/srv/snapshot/.media-probe-key",
                   "/opt/docker/asa-hub/web/snapshot/"
                   ".media-probe-key")


def sheet_rows(sid: str, tab: str, tok: str) -> list[dict]:
    q = urllib.parse.quote(f"'{tab}'!A1:BZ6000")
    req = urllib.request.Request(
        f"https://sheets.googleapis.com/v4/spreadsheets/{sid}/values/{q}")
    req.add_header("Authorization", "Bearer " + tok)
    with urllib.request.urlopen(req, timeout=300) as r:
        grid = json.load(r).get("values") or []
    if not grid:
        return []
    head = [str(h).strip() for h in grid[0]]
    out = []
    for row in grid[1:]:
        out.append({head[i]: (str(row[i]) if i < len(row) else "")
                    for i in range(len(head))})
    return out


MEDIA_EXT = (".mp4", ".mov", ".m4v", ".webm", ".3gp", ".avi", ".mkv",
             ".m4a", ".mp3", ".wav", ".aac", ".ogg")


def is_media(mime: str, name: str) -> bool:
    m = str(mime or "").lower()
    return m.startswith(("video/", "audio/")) or name.lower().endswith(MEDIA_EXT)


def probe_text(file_id: str, mime: str = "", name: str = "") -> dict:
    """The relay's probe door: `document: true` for paper, the bare call for clips, as Digest.gs routes."""
    key = ""
    for p in PROBE_KEY_PATHS:
        try:
            key = Path(p).read_text().strip()
            if key:
                break
        except Exception:                              # noqa: BLE001
            continue
    if not key:
        return {"text": "", "method": "no probe key on this host"}
    clip = is_media(mime, name)
    body = json.dumps({"file_id": file_id, "frames": 8,
                       **({} if clip else {"document": True})}).encode()
    # Through nginx: the relay container publishes no port to the host.
    req = urllib.request.Request(PROBE_URL, data=body, method="POST")
    req.add_header("Content-Type", "application/json")
    req.add_header("X-Media-Key", key)
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            got = json.load(r)
    except Exception as e:                             # noqa: BLE001
        return {"text": "", "method": f"probe refused: {str(e)[:70]}"}
    if not got.get("ok"):
        if got.get("queued"):
            return {"text": "", "method": "queued — a big clip took the second channel"}
        return {"text": "", "method": f"probe: {got.get('reason', 'no')}"}
    return {"text": got.get("text") or "",
            "method": got.get("method") or ("frames" if clip else "probe"),
            "facts": got.get("facts") or {},
            "frames": len(got.get("frames") or [])}


def main() -> None:
    args = sys.argv[1:]
    folder = local = out_json = ledger = ids_file = ""
    for i, a in enumerate(args):
        if a == "--drive" and i + 1 < len(args): folder = args[i + 1]
        if a == "--dir" and i + 1 < len(args): local = args[i + 1]
        if a == "--ledger" and i + 1 < len(args): ledger = args[i + 1]
        if a == "--ids" and i + 1 < len(args): ids_file = args[i + 1]
        if a == "--json" and i + 1 < len(args): out_json = args[i + 1]
    if not folder and not local and not ledger and not ids_file:
        sys.exit(__doc__)

    work = Path(tempfile.mkdtemp(prefix="bench-"))
    items = []
    stored = {}
    roster = {"people": [], "clients": []}
    if ids_file:
        want = json.loads(Path(ids_file).read_text())
        print(f"{len(want)} file(s) by id\n")
        for f in want:
            got = probe_text(f["id"], f.get("mime", ""), f.get("name", ""))
            items.append({"name": f.get("name", f["id"]), "text": got.get("text", ""),
                          "method": got.get("method", "")})
    elif ledger:
        if ledger not in LEDGERS:
            sys.exit(f"unknown ledger {ledger!r} — one of: {', '.join(LEDGERS)}")
        sid, tab, idcol, namecol = LEDGERS[ledger]
        tok = bearer()
        rows = sheet_rows(sid, tab, tok)
        print(f"{len(rows)} row(s) in {tab}\n")
        for row in rows:
            fid, name = row.get(idcol, ""), row.get(namecol, "")
            if not fid:
                continue
            got = probe_text(fid, row.get("mime_type", ""), name)
            items.append({"name": name, "text": got.get("text", ""),
                          "method": got.get("method", ""),
                          "frames": got.get("frames", 0)})
            try:
                meta = json.loads(row.get("digest_json") or "{}")
            except Exception:                          # noqa: BLE001
                meta = {}
            stored[name] = {"kind": row.get("doc_kind", ""),
                            "conf": row.get("confidence", ""),
                            "person": row.get("person", ""),
                            "settles": row.get("settles", ""),
                            "score": meta.get("kind_score", ""),
                            "v": meta.get("v", "")}
    elif folder:
        tok = bearer()
        files = drive_files(folder, tok)
        print(f"{len(files)} file(s) in the folder\n")
        for f in files:
            if f["mimeType"].endswith(".folder"):
                continue
            dest = work / f["name"].replace("/", "_")
            try:
                drive_bytes(f["id"], tok, dest)
            except Exception as e:                     # noqa: BLE001
                print(f"   ! {f['name']}: {str(e)[:70]}")
                continue
            got = text_of(dest, f["mimeType"], f["name"])
            items.append({"name": f["name"], "text": got.get("text", ""),
                          "method": got.get("method", "")})
    else:
        for p in sorted(Path(local).iterdir()):
            if p.is_dir():
                continue
            got = text_of(p, "", p.name)
            items.append({"name": p.name, "text": got.get("text", ""),
                          "method": got.get("method", "")})
        print(f"{len(items)} file(s) in {local}\n")

    payload = work / "items.json"
    payload.write_text(json.dumps(items))
    rost = work / "roster.json"
    rost.write_text(json.dumps(roster))
    js = work / "eval.cjs"
    js.write_text(EVAL_JS)
    run = subprocess.run(["node", str(js), str(ROOT / "apps-script/Digest.gs"),
                          str(payload), str(rost)],
                         capture_output=True, text=True, timeout=300)
    if run.returncode != 0 or not run.stdout.strip():
        sys.exit("the classifier would not run:\n" + (run.stderr or "")[:800])
    rows = json.loads(run.stdout)

    if stored:
        print("%-38s %-19s %-19s %-9s %s" %
              ("file", "production", "bench", "conf", "what changed"))
        print("-" * 122)
        diffs = 0
        for r in rows:
            was = stored.get(r["file"], {})
            note = []
            if was.get("kind", "") != r["kind"]:
                note.append(f"kind {was.get('kind') or '—'} → {r['kind'] or '—'}")
            try:
                dc = int(r["confidence"]) - int(was.get("conf") or 0)
            except Exception:                          # noqa: BLE001
                dc = 0
            if abs(dc) >= 3:
                note.append(f"conf {dc:+d}")
            if (was.get("person") or "") != (r["person"] or ""):
                note.append(f"person {was.get('person') or '—'} → {r['person'] or '—'}")
            if note:
                diffs += 1
            print("%-38s %-19s %-19s %-9s %s" % (
                r["file"][:38], (was.get("kind") or "—")[:19], (r["kind"] or "—")[:19],
                f"{was.get('conf') or '—'}→{r['confidence']}",
                " · ".join(note) or "same"))
        print(f"\n{len(rows)} compared · {diffs} differ from what the platform recorded")
    else:
        print("%-42s %-20s %-5s %-22s %-4s %-16s %s" %
              ("file", "kind", "score", "person", "conf", "settles", "chars"))
        print("-" * 132)
        for r in rows:
            print("%-42s %-20s %-5s %-22s %-4s %-16s %s" % (
                r["file"][:42], r["kind"] or "—", r["score"], (r["person"] or "—")[:22],
                r["confidence"], r["settles"] or "—", r["chars"]))

    unknown = [r for r in rows if not r["kind"]]
    noText = [r for r in rows if r["chars"] == 0]
    weak = [r for r in rows if r["kind"] and r["score"] < 10]
    print(f"\n{len(rows)} read · {len(unknown)} with NO kind · {len(weak)} on a whisper "
          f"(score < 10) · {len(noText)} yielded no text at all")
    if out_json:
        Path(out_json).write_text(json.dumps(rows, indent=1))
        print(f"full verdicts → {out_json}")


if __name__ == "__main__":
    main()
