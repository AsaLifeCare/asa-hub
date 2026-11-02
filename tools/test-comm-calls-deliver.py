#!/usr/bin/env python3
"""deliver() against real Postgres in a throwaway schema; only the door is stubbed. Runs inside the relay."""
import json
import os
import subprocess
import sys

CONTAINER = os.getenv("HUB_RELAY_CONTAINER", "asa-hub-snapshot")
# The checkout's feed, shipped with the run with everything it imports; HUB_RELAY_SOURCE names another file.
SOURCE = os.getenv("HUB_RELAY_SOURCE", "")
SCHEMA = ""  # this run's room, from lane_schema.Rooms in main()

fails = [0]


def chk(what: str, ok: bool) -> None:
    fails[0] += 0 if ok else 1
    print(("  ok   " if ok else "  FAIL ") + what)


def door(answers):
    seen = []

    def post(body):
        seen.append(body)
        got = answers[min(len(seen) - 1, len(answers) - 1)]
        if isinstance(got, Exception):
            raise got
        return got(body) if callable(got) else got

    post.seen = seen  # type: ignore[attr-defined]
    return post


def kept(body):
    payload = body.get("payload") or {}
    return {"status": 200, "data": {
        "received_calls": len(payload.get("calls") or []),
        "received_items": len(payload.get("items") or []),
        "kept_calls": len(payload.get("calls") or []),
        "kept_items": len(payload.get("items") or []),
        "refused": 0, "overflow": 0, "converged": False}}


def fact(call_id, items=1, read_state="read"):
    return {"call": {"call_id": call_id, "read_state": read_state,
                     "who_state": "unresolved", "items": str(items)},
            "items": [{"call_id": call_id, "item_no": str(n + 1),
                       "work_type": "Request"} for n in range(items)]}


def main() -> int:
    global SCHEMA
    import importlib.util
    import psycopg2
    import lane_schema

    dsn = os.environ["HUB_SNAPSHOT_PG_DSN"]
    rooms = lane_schema.Rooms(dsn, "comm-calls-deliver")
    SCHEMA = rooms.make()
    source = SOURCE or os.path.join(LANE_DIR, "comm_calls_feed.py")  # noqa: F821 — the shipped preamble's
    spec = importlib.util.spec_from_file_location("feed_under_test", source)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)

    # The module's table names point at this test's schema, never the live ledger.
    conn = psycopg2.connect(dsn)
    conn.autocommit = True
    with conn.cursor() as cur:
        cur.execute(f"""create table {SCHEMA}.comm_call_reads (
            call_id text primary key, state text not null default 'reading',
            run_id text, attempts integer not null default 1,
            claimed_at timestamptz not null default now(),
            read_at timestamptz, landed_at timestamptz, model_via text,
            items integer, error text, facts jsonb)""")
    m.LEDGER = f"{SCHEMA}.comm_call_reads"
    m.SEALS = f"{SCHEMA}.comm_call_seals"
    m.CONTROL = f"{SCHEMA}.comm_call_catchup"
    m._HAND_COLUMNS = None
    m.BATCH = 3
    m.ITEM_BATCH = 4
    m.HAND_MAX = 2
    quiet = lambda _m: None

    def park(call_id, items=1, read_state="read", state="read"):
        with conn.cursor() as cur:
            cur.execute(f"insert into {m.LEDGER} (call_id, state, read_at, facts) "
                        f"values (%s, %s, now(), %s)",
                        (call_id, state, json.dumps(fact(call_id, items, read_state))))

    def row(call_id):
        with conn.cursor() as cur:
            cur.execute(f"select state, landed_at, facts is not null, "
                        f"coalesce(hand_attempts,0), coalesce(hand_error,'') "
                        f"from {m.LEDGER} where call_id = %s", (call_id,))
            return cur.fetchone()

    def wipe():
        with conn.cursor() as cur:
            cur.execute(f"truncate {m.LEDGER}")

    print("\nTHE THREE COLUMNS")
    chk("the ledger gains hand_attempts/hand_at/hand_error on first use",
        m._hand_columns(dsn) is True)

    print("\nMISSING IS NOT ZERO — the zeroes are told apart")
    wipe()
    got = m.deliver(dsn, None, say=quiet)
    chk("nothing parked is its own outcome", got["outcome"] == "nothing-parked")
    chk("  and it says so", "already in the house" in got["why"])
    park("c1")
    got = m.deliver(dsn, None, say=quiet)
    chk("no credential is 'no-door', never 'landed 0'", got["outcome"] == "no-door")
    chk("  it names the rows as waiting, not missing", "waiting, not missing" in got["why"])
    chk("  and it spent no execution", got["batches"] == 0 and got["attempted"] is False)
    chk("  the row is untouched", row("c1")[:3] == ("read", None, True))

    p = door([RuntimeError("Connection timed out")])
    got = m.deliver(dsn, p, say=quiet)
    chk("a door that cannot be reached is 'unreachable'", got["outcome"] == "unreachable")
    chk("  it was attempted but not answered",
        got["attempted"] is True and got["answered"] is False)
    chk("  the row stays parked", row("c1")[:3] == ("read", None, True))
    chk("  and a silence counts NOTHING against the quarantine", row("c1")[3] == 0)

    p = door([{"status": 503, "message": "The comm_calls houses are not declared"}])
    got = m.deliver(dsn, p, say=quiet)
    chk("a door that answers no is 'refused'", got["outcome"] == "refused")
    chk("  with its status", got["status"] == 503)
    chk("  and its words", "not declared" in got["refused"])
    chk("  an ANSWER counts against the quarantine", row("c1")[3] == 1)
    chk("  the facts are still parked", row("c1")[2] is True)

    print("\nA ROW LANDS, AND ONLY WHAT THE DOOR PROVES IT KEPT")
    wipe()
    park("c1")
    park("c2")
    honest = door([kept])
    got = m.deliver(dsn, honest, say=quiet)
    chk("both calls land in one execution", got["landed"] == 2 and got["batches"] == 1)
    chk("  outcome is 'landed'", got["outcome"] == "landed")
    chk("  the ledger says landed and the facts are dropped",
        row("c1")[1] is not None and row("c1")[2] is False)
    chk("  nothing is left parked", got["remaining"] == 0)
    got = m.deliver(dsn, honest, say=quiet)
    chk("a second pass has nothing to do", got["outcome"] == "nothing-parked")

    print("\nA 200 THAT KEPT FEWER IS NOT A LANDING")
    wipe()
    park("c1")
    park("c2")
    short = lambda body: {"status": 200, "data": {
        "received_calls": 2, "received_items": 2, "kept_calls": 1, "kept_items": 1,
        "refused": 1, "overflow": 0}}
    got = m.deliver(dsn, short, say=quiet)
    chk("the pass is a 'mismatch'", got["outcome"] == "mismatch")
    chk("  NOTHING is stamped landed", got["landed"] == 0)
    chk("  c1 keeps its facts", row("c1")[2] is True and row("c1")[1] is None)
    chk("  c2 keeps its facts", row("c2")[2] is True and row("c2")[1] is None)
    chk("  the door's own count is in the reason", "kept 1 of 2" in got["why"])
    chk("  and it counts against the quarantine", row("c1")[3] == 1)
    got = m.deliver(dsn, short, say=quiet)
    chk("at HAND_MAX the rows are held, not carried for ever",
        row("c1")[0] == "refused" and got["quarantined"] == 2)
    chk("  their facts are KEPT — the ledger holds the only copy",
        row("c1")[2] is True)
    got = m.deliver(dsn, short, say=quiet)
    chk("a held row is no longer offered", got["outcome"] == "nothing-parked")
    chk("  and it is not counted as a queue", m.parked_count(dsn) == 0)
    chk("  it is counted by its own name", m.held_count(dsn)["refused"] == 2)
    chk("  but `seen` still refuses to read it again", set(m.seen(dsn)) == {"c1", "c2"})

    print("\nA ROW THE DOOR WOULD NEVER ACCEPT IS NAMED HERE, NOT DISCOVERED THERE")
    wipe()
    park("c1")
    park("c2", read_state="garbled")
    strict = door([kept])
    got = m.deliver(dsn, strict, say=quiet)
    chk("the good row lands", got["landed"] == 1 and row("c1")[1] is not None)
    chk("the bad row is filed 'unusable'", row("c2")[0] == "unusable")
    chk("  with the reason on the row", "read_state" in row("c2")[4])
    chk("  its facts are kept", row("c2")[2] is True)
    chk("  it was never carried to the door", got["unusable"] == 1
        and [c["call_id"] for c in strict.seen[0]["payload"]["calls"]] == ["c1"])
    chk("  and it will not be read again", "c2" in m.seen(dsn))
    chk("usable() refuses a call with no id",
        "no call_id" in m.usable({"call": {"read_state": "read"}}))
    chk("usable() refuses a matter with no number",
        "no item number" in m.usable({"call": {"call_id": "x", "read_state": "read"},
                                      "items": [{"call_id": "x", "work_type": "Request"}]}))
    chk("usable() accepts what the reading actually produces", m.usable(fact("x", 2)) == "")

    print("\nBATCHES — the door is the scarce thing")
    chk("plan() fills to BATCH", [len(b) for b in m.plan([fact(f"c{n}", 0) for n in range(7)])]
        == [3, 3, 1])
    chk("plan() also stops at the matters ceiling",
        [len(b) for b in m.plan([fact(f"c{n}", 2) for n in range(4)])] == [2, 2])
    chk("plan() never drops a row",
        sum(len(b) for b in m.plan([fact(f"c{n}", 3) for n in range(5)])) == 5)
    wipe()
    for n in range(7):
        park(f"c{n}", items=0)
    counted = door([kept, kept, kept])
    got = m.deliver(dsn, counted, say=quiet, max_batches=2)
    chk("a pass spends at most the executions it was given", got["batches"] == 2)
    chk("  and carries BATCH calls in each", got["landed"] == 6)
    chk("  the rest stay parked and are named", got["remaining"] == 1)
    chk("  one execution carried many calls",
        len((counted.seen[0]["payload"] or {})["calls"]) == 3)
    chk("  the payload declares exactly three parameters",
        sorted(counted.seen[0]["payload"].keys()) == ["calls", "items", "source_at"])
    chk("  and the action is the door's own name",
        counted.seen[0]["action"] == "commCallsIngest")

    print("\nTHE SWITCH STOPS THE READING AND NOTHING ELSE")
    wipe()
    with conn.cursor() as cur:
        cur.execute(f"""create table if not exists {SCHEMA}.comm_call_seals (
            seal_id text, call_id text, field text)""")
        cur.execute(f"""create table if not exists {SCHEMA}.comm_call_catchup (
            id integer primary key default 1, enabled boolean not null default false,
            updated_at timestamptz not null default now(), updated_by text, note text)""")
        cur.execute(f"insert into {SCHEMA}.comm_call_catchup (id, enabled) values (1, false) "
                    f"on conflict (id) do update set enabled = false")
    park("c1")
    switched_off = door([kept])
    try:
        m.run(dsn, 1, post=switched_off, say=quiet)
        chk("a switched-off lane refuses to read", False)
    except m.LaneUnavailable as exc:
        chk("a switched-off lane refuses to read", "switch is off" in str(exc))
    chk("  but the facts it had already paid for LANDED anyway",
        row("c1")[1] is not None and row("c1")[2] is False)

    print("\nIT NEVER RAISES — the promise its caller relies on")
    got = m.deliver("postgresql://nobody@127.0.0.1:1/none", lambda b: kept(b), say=quiet)
    chk("a ledger that will not answer is an outcome, not an exception",
        got["outcome"] == "no-ledger")
    chk("  and it says what is unknown rather than none",
        "not the same as nothing" in got["why"] or "not zero" in got["why"])

    print("\nA CLAIM NOBODY IS HOLDING COMES BACK")
    wipe()
    with conn.cursor() as cur:
        cur.execute(f"insert into {m.LEDGER} (call_id, state, claimed_at) "
                    f"values ('fresh', 'reading', now()), "
                    f"       ('stale', 'reading', now() - interval '3 hours')")
    chk("a claim in flight is not offered", "fresh" in m.seen(dsn))
    chk("an abandoned claim is offered again", "stale" not in m.seen(dsn))
    chk("  and it can actually be re-taken", m.claim(dsn, "stale", "r2") is True)
    chk("  while the one in flight cannot", m.claim(dsn, "fresh", "r2") is False)

    print("\nA CALL IS NEVER PAID FOR TWICE AND THEN BURIED")
    # `pending` wants landed_at null, so a retry claim must drop the landing.
    wipe()
    park("u1", read_state="unreadable", state="unreadable")
    with conn.cursor() as cur:
        cur.execute(f"update {m.LEDGER} set attempts = 1 where call_id = 'u1'")
    got = m.deliver(dsn, door([kept]), say=quiet)
    chk("an unreadable call lands like any other", got["landed"] == 1)
    chk("  and the house holds it", row("u1")[1] is not None)
    chk("a landed unreadable row is still offered for a retry", "u1" not in m.seen(dsn))
    chk("  and claiming it is what drops the landing",
        m.claim(dsn, "u1", "r3") is True and row("u1")[1] is None)
    m.park(dsn, "u1", fact("u1"), "read", "local", 1)
    chk("  so the second reading's facts are deliverable", "u1" in
        [r["call_id"] for r in m.pending(dsn)])
    chk("  and they are counted as parked, never as nothing", m.parked_count(dsn) == 1)
    got = m.deliver(dsn, door([kept]), say=quiet)
    chk("  and they actually reach the house", got["landed"] == 1)

    print("\nREADING STOPPED IS NOT THE HAND-OVER STOPPED")
    # `run` delivers before its gates, so the raise must carry that hand-over.
    wipe()
    park("s1")
    try:
        m.run(dsn, 1, post=door([RuntimeError("Connection timed out")]), say=quiet)
        chk("the switch still stops the reading", False)
    except m.LaneUnavailable as exc:
        chk("the switch still stops the reading", "switch is off" in str(exc))
        chk("  and the raise carries the hand-over that just happened",
            (exc.delivery or {}).get("outcome") == "unreachable")
        chk("  and the sentence names the door beside the zero",
            "unreachable" in m.say_line(exc.delivery)
            and "Connection timed out" in m.say_line(exc.delivery))
    chk("  and the row is still parked for the next pass", row("s1")[:3] == ("read", None, True))

    print("\nA TAIL HAND-OVER KEEPS ITS VERDICT")
    # LIVE_MAX is below BATCH, so newly read calls are handed over only by the tail `_flush`.
    wipe()
    park("t1")
    tail = m._flush(dsn, door([RuntimeError("Connection timed out")]), quiet)
    chk("_flush answers with the verdict, not a count", isinstance(tail, dict))
    chk("  and it names why nothing landed", tail["outcome"] == "unreachable")
    chk("no credential is still not a zero", m._flush(dsn, None, quiet)["outcome"] == "no-door")
    chk("a failure is what a pass reports, even after a later success",
        m._worse(tail, {"outcome": "landed"})["outcome"] == "unreachable")
    chk("  and two clean passes report the latest",
        m._worse({"outcome": "nothing-parked"}, {"outcome": "landed"})["outcome"] == "landed")

    conn.close()
    chk("the run's room is dropped", rooms.close()["left"] == [])
    print(f"\ncomm calls delivery: {fails[0]} failed\n")
    return 1 if fails[0] else 0


if __name__ == "__main__":
    if os.getenv("HUB_IN_CONTAINER") == "1":
        sys.exit(main())
    from pathlib import Path

    here = os.path.abspath(__file__)
    sys.path.insert(0, os.path.dirname(here))
    import lane_schema  # beside this file; shipped with the run so its rooms come from the test base
    # the working directory in the relay is the live checkout and the preamble takes it off the path
    shipped = lane_schema.with_imports(Path(here).parent.parent / "server", ["comm_calls_feed"])
    body = "os.environ['HUB_IN_CONTAINER'] = '1'\n" + open(here, encoding="utf-8").read()
    sys.exit(subprocess.run(["docker", "exec", "-i", CONTAINER, "python3", "-"],
                            input=lane_schema.script(shipped, body, "comm-calls-deliver"), text=True).returncode)
