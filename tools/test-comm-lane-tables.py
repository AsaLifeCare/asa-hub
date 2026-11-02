"""The Smart Comms lane's record (comm_intents, comm_bindings, comm_observations, comm_contributions) on its own tables,
not on spreadsheets: every reader (the Desk's board rows, the replies ear's, the sweep's houses, the board and the
replies as the master sees them, the proposals' corpus through the tab door, the Activity page's count) answers what it
answered off the copies, each reply token the copy withholds made again by the rule every token it shows obeys; the
sweep's and the ear's kept records land in the tables alone (writes.into_tables), an append whose key the table holds
laid on that row, a house still on its copy keeping its records in app.edits in the same write; and a void takes it
all back. One transaction, rolled back.

From the repo root:

    RUNNER=<scratchpad> python3 tools/test-comm-lane-tables.py
"""
import json
import os
import subprocess
import sys

if not os.environ.get("COMM_LANE_TABLES_INPROC"):
    runner = os.environ["RUNNER"]
    here = os.path.join(runner, "test_comm_lane_tables.py")
    with open(here, "w", encoding="utf-8") as fh, open(__file__, encoding="utf-8") as me:
        fh.write(me.read())
    out = subprocess.run(["sh", os.path.join(runner, "run.sh"), os.path.abspath("app"), here,
                          json.dumps({"COMM_LANE_TABLES_INPROC": "1"})], capture_output=True, text=True,
                         timeout=900)
    sys.stdout.write(out.stdout[-5000:])
    sys.stderr.write(out.stderr[-2000:])
    sys.exit(1 if out.returncode or '"failed": []' not in out.stdout else 0)

import time  # noqa: E402

import psycopg  # noqa: E402

import client_writes  # noqa: E402
import comm_record as CREC  # noqa: E402
import comm_record_writes as CRECW  # noqa: E402
import comm_replies as CREP  # noqa: E402
import comm_replies_writes as CREPW  # noqa: E402
import comm_routes  # noqa: E402
import gsjs  # noqa: E402
import house_tables as HT  # noqa: E402
import hub_rows as HR  # noqa: E402
import hubdb  # noqa: E402
import locations as L  # noqa: E402
import resource_rows as RR  # noqa: E402
import scope as sc  # noqa: E402
import sheet_resources as SR  # noqa: E402
import smart_comms as SC  # noqa: E402
import smart_comms_desk as SCD  # noqa: E402
import staff_alerts  # noqa: E402
import writes as W  # noqa: E402

results: dict[str, str] = {}
facts: dict[str, object] = {}
HOUSES = {"comm_intents": "commIntents", "comm_bindings": "commBindings", "comm_observations": "commObservations",
          "comm_contributions": "commContributions"}


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


def unwithheld(v: object) -> object:
    """The copy's answer with each withheld reply token as the upload works it out (SR.intent_reply_token: proven on
    every token the copy shows), so the copy and the table compare by what a cell holds."""
    if isinstance(v, dict):
        out = {k: unwithheld(x) for k, x in v.items()}
        if isinstance(out.get("reply_token"), str) and out["reply_token"].startswith(RR.WITHHELD) \
                and "intent_key" in out:
            out["reply_token"] = SR.intent_reply_token(out)
        return out
    if isinstance(v, (list, tuple)):
        return [unwithheld(x) for x in v]
    return v


def first_diff(a: object, b: object, at: str = "") -> str:
    if type(a) is not type(b) and not (isinstance(a, (list, tuple)) and isinstance(b, (list, tuple))):
        return f"{at}: {str(a)[:80]} | {str(b)[:80]}"
    if isinstance(a, dict):
        for k in sorted(set(a) | set(b)):
            if plain(a.get(k)) != plain(b.get(k)):
                return first_diff(a.get(k), b.get(k), f"{at}.{k}")
    if isinstance(a, (list, tuple)):
        if len(a) != len(b):
            return f"{at}: {len(a)} vs {len(b)} items"
        for i, (x, y) in enumerate(zip(a, b)):
            if plain(x) != plain(y):
                return first_diff(x, y, f"{at}[{i}]")
    return f"{at}: {str(a)[:80]} | {str(b)[:80]}"


def door(tab: str) -> tuple:
    """The tab door's answer (the proposals' corpus reads it), as the worker sees its cells by header: a row a kept
    edit appended to the copy names only the cells written, the table every column, blank as a sheet's row is."""
    res = db.resolve(tab)
    ans = HR.read(res.sheet_id, tab, db=db)
    heads = [h for h in ans.get("headers") or [] if h]
    rows = [(int(rn), {h: str(HR.cell(raw.get(h)) or "") for h in heads}) for rn, raw in ans.get("rows") or []]
    return heads, rows


def sweep_house(r: L.Reads, tab: str) -> list:
    h = CRECW.House(r, tab, [])
    return [h.rows, h.by_id]


READERS = {
    **{f"{t}: the Desk's board rows": (lambda r, t=t: SCD.board_rows(r, t)) for t in HOUSES},
    **{f"{t}: the replies ear's rows": (lambda r, t=t: CREPW.Houses(r).board(t)) for t in HOUSES},
    **{f"{t}: the sweep's house": (lambda r, t=t: sweep_house(r, t)) for t in ("comm_intents", "comm_bindings")},
    **{f"{t}: the tab door's rows": (lambda _r, t=t: door(t)) for t in ("comm_observations", "comm_contributions")},
    "the board as the master sees it": lambda r: SCD.comm_board(L.Session(r, master), {}),
    "the replies as the master sees them": lambda r: SCD.replies(L.Session(r, master), {"all": True}),
    "the Activity page's rows": lambda r: {h["id"]: h["rows"] for h in SCD.houses(r) if h["id"] in HOUSES},
}
copies = {k: on_copy(f) for k, f in READERS.items()}
# the reply token rule, on every token the copy shows
shown = [raw for _rn, raw in db.rows(db.resolve("comm_intents").ref)
         if gsjs.or_blank(raw.get("reply_token")) and not str(raw.get("reply_token")).startswith(RR.WITHHELD)]
wrong = [(raw.get("intent_key"), raw.get("reply_token")) for raw in shown
         if SR.intent_reply_token(raw) != gsjs.or_blank(raw.get("reply_token"))]
facts["reply tokens the copy shows"] = len(shown)
check("the reply token rule makes every token the copy shows", shown and not wrong, wrong[:3])
# a thread's id and its token are made from one key in one row (commRecordRows_: CMI_ and CI- of commRecordId_): a
# withheld token's row whose id is its intent key's makes the token the rule does
hidden = [raw for _rn, raw in db.rows(db.resolve("comm_intents").ref)
          if str(raw.get("reply_token") or "").startswith(RR.WITHHELD)]
off = [raw.get("id") for raw in hidden if gsjs.or_blank(raw.get("id")) != "CMI_" + CREC.record_id(
    gsjs.or_blank(raw.get("intent_key"))) or SR.intent_reply_token(raw) != "CI-" + gsjs.or_blank(raw.get("id"))[4:10]]
facts["reply tokens the copy withholds"] = len(hidden)
check("each withheld token's thread was made from its intent key, as its token was", hidden and not off, off[:3])
facts["rows on the copies"] = {t: len(copies[f"{t}: the Desk's board rows"]) for t in HOUSES}
conn = psycopg.connect(owner, autocommit=False)
try:
    with conn.cursor() as cur:
        cur.execute("set local search_path to app, public")
        token = W.HELD.set(cur)
        for tab, res in HOUSES.items():
            if not RR.uploaded(db, res):
                RR.upload(L.Reads(db, None), res, tab, SR.DERIVE.get(res))
        cur.execute(f"select resource, count(*) from {RR.ROWS} where resource = any(%s) and exists (select 1 from"
                    " jsonb_each_text(cells) c where c.value like '[withheld%%') group by 1", (list(HOUSES.values()),))
        check("no cell of the tables is withheld", not cur.fetchall())
        for name, f in READERS.items():
            got = f(L.Reads(db, None))
            check(f"{name} answers the copy's", plain(got) == plain(unwithheld(copies[name])),
                  first_diff(got, unwithheld(copies[name])))
        r0 = L.Reads(db, None)
        check("the window ask finds its house minted", SCD.house_where(r0, CREC.INTENTS_HOUSE).ref is not None)
        check("staff alerts read the routes the routes' own reader does",
              plain(staff_alerts.record_routes(r0)) == plain(comm_routes.routes(r0)))
        tx = W.Tx(cur, "comm_replies")

        def kept_in_edits(wid: str) -> set:
            cur.execute(f"select distinct tab_name from {W.EDITS_TABLE} where write_id = %s", (wid,))
            return {t for (t,) in cur.fetchall()}

        # the sweep: a thread made, one changed, a binding settled; an attempt (its copy still) in the same write
        wid = "Wzzcommlanecheck0001"
        tok = SC._WRITE.set({"write_id": wid})
        edits: list[dict] = []
        intents, bindings = CRECW.House(r0, "comm_intents", edits), CRECW.House(r0, "comm_bindings", edits)
        some_i, some_b = gsjs.or_blank(intents.rows[0]["id"]), gsjs.or_blank(bindings.rows[0]["id"])
        intents.upsert({"id": "zzINTENT1", "intent_key": "zz@check|compliance.owed", "person_key": "zz@check",
                        "state": "planned"})
        intents.upsert({"id": some_i, "state": "zz-checked"})
        bindings.upsert({"id": some_b, "binding_state": "settled", "note": "zz check"})
        att = CRECW._target(r0, CREC.ATTEMPTS_HOUSE)
        edits.append(W.kept_record(att[0], att[1], "append", "id", "zzATT1", "", {"id": "zzATT1", "intent_key": "zz"}))
        tx.record(wid, "check", {"status": 200}, W.final({"status": 200}, edits, "check"), "check")
        r1 = L.Reads(db, None)
        i1 = {gsjs.or_blank(r.get("id")): r for r in SCD.board_rows(r1, "comm_intents")}
        b1 = {gsjs.or_blank(r.get("id")): r for r in SCD.board_rows(r1, "comm_bindings")}
        check("the sweep's thread is made in its table", gsjs.or_blank(i1.get("zzINTENT1", {}).get("state")) == "planned"
              and gsjs.or_blank(i1["zzINTENT1"].get("createdAt")) != "", i1.get("zzINTENT1"))
        check("the sweep's thread is changed there", gsjs.or_blank(i1[some_i].get("state")) == "zz-checked")
        check("the sweep's binding is settled there", gsjs.or_blank(b1[some_b].get("binding_state")) == "settled"
              and gsjs.or_blank(b1[some_b].get("note")) == "zz check")
        check("app.edits keeps only the house still on its copy", kept_in_edits(wid) == {att[1]}, kept_in_edits(wid))
        SC._WRITE.reset(tok)
        # the ear: a reply saved, one changed, the trail observed
        wid2 = "Wzzcommlanecheck0002"
        tok = SC._WRITE.set({"write_id": wid2})
        h = CREPW.Houses(L.Reads(db, None))
        some_c = gsjs.or_blank(h.board(CREP.CONTRIBUTIONS)[0]["id"])
        h.contribution_save({"id": "zzCMC1", "message_id": "zzmsg", "state": "awaiting_owner", "text": "zz"})
        h.upsert(CREP.CONTRIBUTIONS, {"id": some_c, "note": "zz check"})
        ev = h.observe("settled", None, {"zz": 1}, "check")
        tx.record(wid2, "check", {"status": 200}, W.final({"status": 200}, h.edits(), "replies"), "check")
        r2 = L.Reads(db, None)
        c2 = {gsjs.or_blank(r.get("id")): r for r in SCD.board_rows(r2, "comm_contributions")}
        o2 = [r for r in SCD.board_rows(r2, "comm_observations") if gsjs.or_blank(r.get("event_id")) == ev]
        check("the ear's reply is saved in its table", gsjs.or_blank(c2.get("zzCMC1", {}).get("state"))
              == "awaiting_owner", c2.get("zzCMC1"))
        check("the ear's change lands there", gsjs.or_blank(c2[some_c].get("note")) == "zz check")
        check("the trail's row is made there", ev != "" and len(o2) == 1 and o2[0].get("source") == "check", o2)
        check("app.edits keeps none of the ear's write", kept_in_edits(wid2) == set(), kept_in_edits(wid2))
        SC._WRITE.reset(tok)
        # an append whose key the table holds is laid on that row, never a second one
        wid3 = "Wzzcommlanecheck0003"
        trail = SCD.house_where(r2, "comm_observations")
        again = [W.kept_record(trail.sheet_id, trail.ref.tab, "append", W.COLS + "event_id", ev, "",
                               {"event_id": ev, "source": "zz again"})]
        tx.record(wid3, "check", {"status": 200}, W.final({"status": 200}, again, "replies"), "check")
        o3 = [r for r in SCD.board_rows(L.Reads(db, None), "comm_observations")
              if gsjs.or_blank(r.get("event_id")) == ev]
        check("an append of a key the table holds is laid on its row", len(o3) == 1 and o3[0].get("source")
              == "zz again", o3)
        for w in (wid, wid2, wid3):
            RR.void(cur, w)
        r4 = L.Reads(db, None)
        check("a void takes it all back", all(plain(SCD.board_rows(r4, t))
                                              == plain(unwithheld(copies[f"{t}: the Desk's board rows"]))
                                              for t in HOUSES))
        W.HELD.reset(token)
    conn.rollback()
finally:
    conn.close()

print(json.dumps({"facts": facts, "results": results, "failed": [k for k, v in results.items() if v != "ok"]},
                 indent=1, default=str))
