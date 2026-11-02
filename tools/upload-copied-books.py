"""Every tab the Hub's code can still reach in a frozen sheets.* copy (the keeper's mirror is off since 10-27) moved onto
a house of its own: the books its code names (the props it asks for, hubdb's fallbacks and router homes, the depot's
house pointers, the ids it writes out, the depot itself), each tab not kept yet uploaded from its copy — by the database
itself past UPLOAD_IN_DB_ROWS — proved row for row against it, then the kept edits the copy does not carry laid as each
write lays them now (resource_rows.lay_kept_edits). From then on hubdb.HubDb.tab hands every reader of that book and
tab its table. The master's own session twin (Core's hub_sessions) is never touched. A rehearsal, rolled back, unless
UPLOAD=1.

From the repo root:

    RUNNER=<scratchpad> [UPLOAD=1] python3 tools/upload-copied-books.py
"""
import json
import os
import re
import subprocess
import sys

if not os.environ.get("COPIED_BOOKS_INPROC"):
    runner = os.environ["RUNNER"]
    here = os.path.join(runner, "upload_copied_books.py")
    with open(here, "w", encoding="utf-8") as fh, open(__file__, encoding="utf-8") as me:
        fh.write(me.read())
    src = "".join(open(os.path.join("app", f), encoding="utf-8").read() for f in os.listdir("app") if f.endswith(".py"))
    src += "".join(open(os.path.join("server", f), encoding="utf-8").read()
                   for f in os.listdir("server") if f.endswith(".py"))
    ids = sorted(set(re.findall(r"\b1[A-Za-z0-9_-]{43}\b", src)))
    props = sorted(set(re.findall(r'prop\("([A-Z][A-Z0-9_]+)"\)|_PROP = "([A-Z][A-Z0-9_]+)"', src)))
    props = sorted({p for pair in props for p in pair if p} | set(re.findall(
        r'"((?:HUB|ESTATE|CERT|LEGACY|PRIOR|STAFF|RECRUIT|QUO)[A-Z0-9_]*(?:_ID|_SHEET_ID))"', src)))
    env = {"COPIED_BOOKS_INPROC": "1", "UPLOAD": os.environ.get("UPLOAD", ""),
           "NAMED": json.dumps({"ids": ids, "props": props})}
    out = subprocess.run(["sh", os.path.join(runner, "run_long.sh"), os.path.abspath("app"), here, json.dumps(env)],
                         capture_output=True, text=True, timeout=2500)
    sys.stdout.write(out.stdout[-12000:])
    sys.stderr.write(out.stderr[-3000:])
    sys.exit(1 if out.returncode or '"failed": []' not in out.stdout else 0)

import time  # noqa: E402

import psycopg  # noqa: E402

import hubdb  # noqa: E402
import locations as L  # noqa: E402
import resource_rows as RR  # noqa: E402
import smart_comms as SC  # noqa: E402
import writes as W  # noqa: E402

UPLOAD_IN_DB_ROWS = 5000
CORE_ID = "1ia6i0SFiVNhn4wi6bt6EDcGwReS0P7-L4Up2hRfIVPg"
RECRUIT_ID = "1zUuZP2IBAO0YbPrJzlkuHi7-pR97tL_gQMJ1A7Fg8l8"
CREDENTIALS_ID = "1w4jEKZyn6JqxFyJ7k7m9tcntptWQp-ufNIRz0VvHEUQ"
# never: the master's own session twin; the recruiters' two tabs the Hub keeps as houses of their own (recruitPipeline,
# recruitOnboarding, fed from Google by recruit_book) — a second, frozen copy of them would be a second truth; the
# credentials book's Ty tab, whose header is itself a login
NEVER = {(CORE_ID, "hub_sessions"), (RECRUIT_ID, "Talent Pipeline"), (RECRUIT_ID, "Onboarding Checklist"),
         (CREDENTIALS_ID, "Ty")}
keep = os.environ.get("UPLOAD") == "1"
named = json.loads(os.environ["NAMED"])
db = hubdb.HubDb()
copy_token = hubdb.COPY.set(True)


def reached() -> dict[str, set[str]]:
    books: dict[str, set[str]] = {}

    def add(sid: object, why: str) -> None:
        s = str(sid or "").strip()
        if len(s) >= 40 and s.startswith("1") and db.book(s) is not None:
            books.setdefault(s, set()).add(why)
    for p in set(named["props"]) | set(hubdb.PROP_FALLBACKS) | set(hubdb.HUB_TAB_HOME.values()):
        add(db.prop(p), "prop " + p)
    for k, v in (db.facts()["areas"].get("props") or {}).items():
        if str(k).startswith("HUB_HOUSE_"):
            add(v, "house " + str(k))
    for i in named["ids"]:
        add(i, "named")
    add(hubdb.ESSENCIAL_ID, "depot")
    return books


def name_of(sid: str, tab: str, taken: set[str]) -> str:
    camel = "".join(w[:1].upper() + w[1:] for w in re.split(r"[^A-Za-z0-9]+", tab) if w)[:48] or "Tab"
    base = "bk" + re.sub(r"[^A-Za-z0-9]", "", sid)[:6] + camel
    out, n = base, 2
    while out in taken:
        out, n = f"{base}{n}", n + 1
    taken.add(out)
    return out


books = reached()
up = {(s, t) for s, t in db.query("select sheet_id, tab_name from app.resource_columns where uploaded_at is not null")}
taken = {r for (r,) in db.query("select resource from app.resource_columns")}
todo = []
for sid in sorted(books):
    for tab, n in db.query("select tab_name, row_count from catalog.tabs where sheet_id = %s and gone_at is null"
                           " order by tab_name", (sid,)):
        if (sid, tab) in up or (sid, tab) in NEVER or (tab == hubdb.HOUSE_DATA_TAB and any(s == sid for s, _ in up)):
            continue
        if sid == hubdb.ESSENCIAL_ID and tab == hubdb.FACTS_TAB:
            continue
        todo.append((sid, tab, int(n or 0), name_of(sid, tab, taken)))
done: dict[str, dict] = {}
failed: list[str] = []
owner = (f"host={os.environ['HUB_DB_HOST']} dbname={os.environ['POSTGRES_DB']} user={os.environ['POSTGRES_USER']} "
         f"password={os.environ['POSTGRES_PASSWORD']}")
conn = psycopg.connect(owner, autocommit=False)
t0 = time.time()
try:
    with conn.cursor() as cur:
        cur.execute("set local search_path to app, public")
        cur.execute("set local statement_timeout = 0")
        token = W.HELD.set(cur)
        wtok = SC._WRITE.set({"write_id": "upload:copied-books"})
        for sid, tab, n, res in todo:
            ref = db.tab(sid, tab)
            if ref is None:
                continue
            try:
                if n > UPLOAD_IN_DB_ROWS:
                    RR.upload_in_db(res, tab, ref)
                else:
                    heads = [h for h in ref.headers if h != ""]
                    rows = [(rn, {h: raw.get(h) for h in heads if raw.get(h) not in (None, "")})
                            for rn, raw in db.rows(ref)]
                    RR.upload_rows(res, sid, tab, heads, rows)
                unlike = RR.unlike_copy(res, ref)
                if unlike["missing"] or unlike["differ"]:
                    failed.append(f"{res} ({tab}): {unlike['missing']} missing, {unlike['differ']} unlike the copy")
                    continue
                laid = RR.lay_kept_edits(sid, [tab], "1970-01-01T00:00:00Z")
                book = db.book(sid)
                done[res] = {"book": getattr(book, "name", sid)[:50], "status": getattr(book, "status", ""), "tab": tab,
                             "rows": n, "edits laid": laid}
            except Exception as exc:  # noqa: BLE001 - said, and nothing is kept
                failed.append(f"{res} ({tab}): {type(exc).__name__}: {str(exc)[:160]}")
        SC._WRITE.reset(wtok)
        W.HELD.reset(token)
    if keep and not failed:
        conn.commit()
    else:
        conn.rollback()
finally:
    conn.close()
hubdb.COPY.reset(copy_token)

by_book: dict[str, list] = {}
for res, d in done.items():
    by_book.setdefault(f'{d["book"]} [{d["status"]}]', []).append((d["tab"], res, d["rows"]))
print(json.dumps({"books": len(by_book), "tabs": len(done), "rows": sum(d["rows"] for d in done.values()),
                  "seconds": round(time.time() - t0), "committed": keep and not failed, "failed": failed}, indent=0))
for b, tabs in sorted(by_book.items()):
    print(f"{b}: " + "; ".join(f"{t} → {r} ({n})" for t, r, n in tabs)[:900])
