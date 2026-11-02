"""Learning's competencies and attempts (learn_skills, learn_attempts) on their own tables (learnSkills, learnAttempts),
not on a spreadsheet: Learning's readers and the generic resource rows answer what they answered off the copy; a
person's attempt and a competency made and changed land in the tables alone as the write's own; and a void takes them
back. One transaction, rolled back.

From the repo root:

    RUNNER=<scratchpad> python3 tools/test-learning-tables.py
"""
import json
import os
import subprocess
import sys

if not os.environ.get("LEARNING_TABLES_INPROC"):
    runner = os.environ["RUNNER"]
    here = os.path.join(runner, "test_learning_tables.py")
    with open(here, "w", encoding="utf-8") as fh, open(__file__, encoding="utf-8") as me:
        fh.write(me.read())
    out = subprocess.run(["sh", os.path.join(runner, "run.sh"), os.path.abspath("app"), here,
                          json.dumps({"LEARNING_TABLES_INPROC": "1"})], capture_output=True, text=True, timeout=600)
    sys.stdout.write(out.stdout[-4000:])
    sys.stderr.write(out.stderr[-2000:])
    sys.exit(1 if out.returncode or '"failed": []' not in out.stdout else 0)

import time  # noqa: E402

import psycopg  # noqa: E402

import client_writes  # noqa: E402
import gsjs  # noqa: E402
import house_tables as HT  # noqa: E402
import hubdb  # noqa: E402
import learning as LR  # noqa: E402
import learning_writes as LW  # noqa: E402
import locations as L  # noqa: E402
import ops_stragglers as OS  # noqa: E402
import resource_rows as RR  # noqa: E402
import scope as sc  # noqa: E402
import sheet_resources as SR  # noqa: E402
import smart_comms as SC  # noqa: E402
import writes as W  # noqa: E402

results: dict[str, str] = {}
facts: dict[str, object] = {}
TABS = {LR.SKILLS_TAB: "learnSkills", LR.ATTEMPTS_TAB: "learnAttempts"}


def check(name: str, ok: bool, why: object = "") -> None:
    results[name] = "ok" if ok else f"FAIL {str(why)[:300]}"


owner = (f"host={os.environ['HUB_DB_HOST']} dbname={os.environ['POSTGRES_DB']} user={os.environ['POSTGRES_USER']} "
         f"password={os.environ['POSTGRES_PASSWORD']}")
db = hubdb.HubDb()
hubdb.OWN.set(client_writes.Own([], book=db.book, edits=W.Store(dsn=hubdb._dsn()).edits(), edits_at=time.time()))
boss = next((u for u in L.Reads(db, None).users() if not gsjs.str_(u.get("mergedinto"))
             and sc.is_master_email(u.get("email")) and gsjs.str_(u.get("role")) == "admin"), None)
master = sc.user_from_row(boss)


def on_copy(read):
    """What a reader answered off the copy: the same code, with no house kept in a table."""
    tabled = HT.tabled
    HT.tabled = lambda _tab: False
    try:
        return read(L.Reads(db, None))
    finally:
        HT.tabled = tabled


def plain(v: object) -> str:
    return json.dumps(v, sort_keys=True, default=str)


learner = next((a.get("ownerId") for a in on_copy(lambda r: LR.rows(r, LR.ATTEMPTS_TAB)) if a.get("ownerId")), "")
someone = {**master, "id": learner} if learner else master
READERS = {
    **{f"{t}: Learning's rows": (lambda r, t=t: LR.rows(r, t)) for t in TABS},
    **{f"{t}: their cells as kept": (lambda r, t=t: LR.raw_rows(r, t)) for t in TABS},
    "a learner's state": lambda r: LR.state(r, someone),
}
copies = {k: on_copy(f) for k, f in READERS.items()}
copy_generic = {t: on_copy(lambda r, t=t: OS.rows(r, t)) for t in TABS}
facts["rows on the copy"] = {t: len(copies[f"{t}: Learning's rows"]) for t in TABS}
conn = psycopg.connect(owner, autocommit=False)
try:
    with conn.cursor() as cur:
        cur.execute("set local search_path to app, public")
        token = W.HELD.set(cur)
        # Learning's rules read the shared finance settings, kept in their own table beside these
        for t, res in {**TABS, "finance_config": "financeConfig"}.items():
            if not RR.uploaded(db, res):
                RR.upload(L.Reads(db, None), res, t)
        for name, f in READERS.items():
            got = f(L.Reads(db, None))
            check(f"{name} answers the copy's", plain(got) == plain(copies[name]),
                  (len(got) if isinstance(got, list) else "", len(copies[name]) if isinstance(got, list) else ""))
        for t, res in TABS.items():
            check(f"{t}: the generic rows answer the copy's", plain(SR.rows(L.Reads(db, None), res))
                  == plain(copy_generic[t]))
        wid = "Wzzlearningcheck000001"
        tok = SC._WRITE.set({"write_id": wid})
        skill = next(s for s in LR.rows(L.Reads(db, None), LR.SKILLS_TAB))
        mine = {**master, "id": "zzLearner"}
        d = LW.learn_attempt(L.Session(L.Reads(db, None), mine), {"skillId": skill["id"], "correct": True})
        got = [a for a in LR.rows(L.Reads(db, None), LR.ATTEMPTS_TAB) if a.get("ownerId") == "zzLearner"]
        check("an attempt lands in its table as the write's own, and the state counts it",
              d.answer.get("status") == 200 and d.own and not d.edits and len(got) == 1, (d.answer, d.edits, got))
        made = LW.learn_skill_save(L.Session(L.Reads(db, None), master), {"name": "Zz check skill", "area": "check"})
        rid = (made.answer.get("data") or {}).get("id", "")
        changed = LW.learn_skill_save(L.Session(L.Reads(db, None), master),
                                      {"id": rid, "name": "Zz check skill 2", "area": "check"})
        hit = next((s for s in LR.rows(L.Reads(db, None), LR.SKILLS_TAB) if s.get("id") == rid), {})
        check("a competency made and changed lands in its table", made.own and changed.own and not made.edits
              and hit.get("name") == "Zz check skill 2" and hit.get("area") == "check", (made.answer, hit))
        SC._WRITE.reset(tok)
        RR.void(cur, wid)
        check("a void takes them back", all(plain(LR.rows(L.Reads(db, None), t))
                                            == plain(copies[f"{t}: Learning's rows"]) for t in TABS))
        W.HELD.reset(token)
    conn.rollback()
finally:
    conn.close()

print(json.dumps({"facts": facts, "results": results, "failed": [k for k, v in results.items() if v != "ok"]},
                 indent=1, default=str))
