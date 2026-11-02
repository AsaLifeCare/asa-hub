#!/usr/bin/env python3
"""The working-tree Digest.gs decoder over the corpus's stored text, run in the relay container; it measures disagreement, not truth."""
import json, os, re, subprocess, sys, tempfile
from collections import Counter, defaultdict
from pathlib import Path
import psycopg2, psycopg2.extras

ROOT = Path("/opt/docker/asa-hub")
GS = Path(os.environ.get("BENCH_GS", "/tmp/bench/Digest.gs"))
DSN = os.environ["HUB_PG_DSN"]
CORPUS = "1o7opeC1GR3J5Oj7iGEgYo0EKLPmkW_paGBtE8uMx3LY"
FORMS = "19OvLdtyF0iENHcesFFm_6DyGjnqTfrjStAQJjiyh6Ww"

EVAL_JS = r"""
const fs = require('node:fs'), vm = require('node:vm');
const ctx = { console, Date, Math, JSON, String, Number, Object, Array, RegExp,
              HUB_POLICY: {}, HUB_ACTIONS: {},
              str_: (v) => (v === null || v === undefined ? '' : String(v).trim()),
              randomHex_: (n) => 'x'.repeat(n), listRows_: () => [] };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(process.argv[2], 'utf8'), ctx);
const rows = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
const hints = {};
for (const e of ctx.DIGEST_DOC_KINDS) {
  const f = (e[3] && e[3].file) || [];
  hints[e[0]] = { words: e[2] || [], file: f, category: e[1] };
}
const out = rows.map((r) => {
  const k = ctx.digestDocKind_(r.name, r.text) || {};
  const tk = ctx.digestDocKind_(r.name, '') || {};
  let roles = ctx.digestDateRoles_(r.text);
  if (ctx.digestRolesFinish_) roles = ctx.digestRolesFinish_(k.kind, roles, ctx.digestDates_(r.name, r.text), '');
  return { id: r.id, name: r.name, kind: k.kind || '', score: k.score || 0, alt: k.alt || '',
           title_kind: tk.kind || '',
           issued: roles.issued || '', expires: roles.expires || '', born: roles.born || '',
           missing: ctx.digestMissing_ ? ctx.digestMissing_(k.kind, {person: 'x', expires_on: roles.expires,
             issued_on: roles.issued, born_on: roles.born}) : [] };
});
process.stdout.write(JSON.stringify({ hints, out }));
"""


def rows(limit: int | None, ledger: str) -> list[dict]:
    sid, col, tab = (CORPUS, "title", "client_files") if ledger == "corpus" else (FORMS, "file_name", "form_files")
    with psycopg2.connect(DSN) as c, c.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(f"""select data->>'id' id, data->>%s name, data->>'digest_text' text,
                               data->>'doc_kind' filed_kind, data->>'confidence' filed_conf,
                               data->>'client_name' client
                        from asa_drive_sheets_rows
                        where sheet_id=%s and tab_name=%s and coalesce(data->>'digest_text','')<>''
                        order by row_number {('limit %s' if limit else '')}""",
                    (col, sid, tab) + ((limit,) if limit else ()))
        return [dict(r) for r in cur.fetchall()]


def run(rs: list[dict]) -> tuple[dict, list[dict]]:
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
        json.dump([{"id": r["id"], "name": r["name"] or "", "text": r["text"] or ""} for r in rs], f)
        rows_path = f.name
    with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False) as f:
        f.write(EVAL_JS); js = f.name
    got = subprocess.run(["node", js, str(GS), rows_path], capture_output=True, text=True, timeout=900)
    if got.returncode != 0:
        sys.exit("node failed:\n" + got.stderr[-2000:])
    d = json.loads(got.stdout)
    by = {r["id"]: r for r in rs}
    for o in d["out"]:
        o["filed_kind"] = by[o["id"]].get("filed_kind") or ""
        o["client"] = by[o["id"]].get("client") or ""
    return d["hints"], d["out"]


def norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (s or "").lower())


def title_kinds(name: str, hints: dict) -> list[str]:
    t = norm(name)
    tight = re.sub(r"\s+", "", t)
    hit = []
    for kind, h in hints.items():
        if any(w and w in tight for w in h["file"]) or any(w and (" " + w + " ") in (" " + t + " ") for w in h["words"] if len(w) > 3):
            hit.append(kind)
    return hit


def report(hints: dict, out: list[dict], show: tuple | None = None) -> None:
    n = len(out)
    kinds = Counter(o["kind"] or "(blank)" for o in out)
    print(f"rows: {n} · kinds given: {n - kinds['(blank)']} ({(n - kinds['(blank)']) * 100 // n}%) · blank: {kinds['(blank)']}")
    print("top kinds:", kinds.most_common(12))
    blank_titled = defaultdict(list)
    contra = defaultdict(list)
    for o in out:
        tk = [o.get("title_kind")] if o.get("title_kind") else []
        if not o["kind"] and tk:
            blank_titled[tk[0]].append(o["name"])
        elif o["kind"] and tk and o["kind"] not in tk:
            contra[(tk[0], o["kind"])].append(o["name"])
    print(f"\n[A] title names a kind, decoder gave NONE: {sum(len(v) for v in blank_titled.values())} rows")
    for k, names in sorted(blank_titled.items(), key=lambda kv: -len(kv[1]))[:10]:
        print(f"   {len(names):4d}  title says {k:<22} e.g. {names[0][:50]!r}")
    print(f"\n[B] title says A, decoder said B: {sum(len(v) for v in contra.values())} rows")
    for (a, b), names in sorted(contra.items(), key=lambda kv: -len(kv[1]))[:12]:
        print(f"   {len(names):4d}  title {a:<20} → decoder {b:<20} e.g. {names[0][:46]!r}")
    fam = Counter()
    for o in out:
        if not o["kind"]:
            words = [w for w in norm(o["name"]).split() if not w.isdigit() and len(w) > 2][:2]
            fam[" ".join(words)] += 1
    print(f"\n[C] blank kinds by title family (top 15 of {len(fam)}):")
    for f, c in fam.most_common(15):
        print(f"   {c:4d}  {f}")
    owed = Counter(); owed_n = Counter()
    for o in out:
        if o["kind"]:
            owed_n[o["kind"]] += 1
            for m in o["missing"] or []:
                owed[(o["kind"], m)] += 1
    print("\n[D] what kinds owe and did not get (top 10):")
    for (k, m), c in owed.most_common(10):
        print(f"   {c:4d}/{owed_n[k]:<4d} {k:<22} missing {m}")
    if show:
        what = show[0]
        if what == "blank":
            fam_w, lim = show[1], int(show[2])
            for o in [o for o in out if not o["kind"] and norm(o["name"]).startswith(fam_w)][:lim]:
                print(f"   - {o['name'][:60]!r}")
        elif what == "kind":
            k, lim = show[1], int(show[2])
            for o in [o for o in out if o["kind"] == k][:lim]:
                print(f"   - {o['name'][:52]!r:<56} score={o['score']} alt={o['alt']}")


def main() -> None:
    a = sys.argv[1:]
    limit = int(a[a.index("--limit") + 1]) if "--limit" in a else None
    ledger = a[a.index("--ledger") + 1] if "--ledger" in a else "corpus"
    rs = rows(limit, ledger)
    hints, out = run(rs)
    if "--save" in a:
        Path(a[a.index("--save") + 1]).write_text(json.dumps({"out": out}))
    show = None
    if "--show" in a:
        i = a.index("--show"); show = tuple(a[i + 1:i + 4])
    report(hints, out, show)
    if "--against" in a:
        was = {o["id"]: o for o in json.loads(Path(a[a.index("--against") + 1]).read_text())["out"]}
        ch = Counter(); ex = defaultdict(list)
        for o in out:
            w = was.get(o["id"])
            if not w: continue
            for f in ("kind", "issued", "expires", "born"):
                if (w.get(f) or "") != (o.get(f) or ""):
                    key = (f, w.get(f) or "∅", o.get(f) or "∅") if f == "kind" else (f, "∅" if not w.get(f) else "set", "∅" if not o.get(f) else "set")
                    ch[key] += 1; ex[key].append(o["name"])
        print(f"\n[Δ] against the saved run: {sum(ch.values())} field changes")
        for key, c in ch.most_common(20):
            print(f"   {c:4d}  {key[0]:<8} {key[1]:<22} → {key[2]:<22} e.g. {ex[key][0][:44]!r}")


if __name__ == "__main__":
    main()
