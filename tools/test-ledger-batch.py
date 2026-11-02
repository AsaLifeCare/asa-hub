#!/usr/bin/env python3
"""
The write ledger's BATCH, asserted against the real functions.

WHY THIS EXISTS. `_ledger_batch` and `_ledger_deliver_batch` decide two things
nothing else can undo: which writes ride one execution together, and what
happens to each of them when the answer comes back. Get the grouping wrong and
one company's write is aimed at another's workbook — `HUB_WORLD_CTX` and
`HUB_TENANT_CTX` are per-EXECUTION globals on the backend. Get the settlement
wrong and an edit is either lost or executed twice.

Those are exactly the failures a quiet afternoon never shows you. The batch
lane was switched on and did not fire for hours, because writes only reach the
ledger when the queue backs up. So the proof is taken here instead.

WHAT IT DOES NOT DO: mock the ledger. The entries are real files in a real
LEDGER_DIR (pointed at a temp directory), read back by the real code. Only the
HTTP client is stubbed, and it is stubbed to return the ENVELOPE SHAPES the
backend actually answers with — including the shape an OLD deployment answers
when it has never heard of `bulkWrite`, which is the case that decides whether
this was safe to switch on at all.

WHERE IT RUNS. The relay's dependencies (fastapi, psycopg2) live in the
container, not on the host, so this re-execs itself inside `asa-hub-snapshot`
against the same bind-mounted source the service runs. Stubbing those imports
to run on the host would be asserting the stub.

    python3 tools/test-ledger-batch.py
"""
import os
import subprocess
import sys

CONTAINER = os.getenv("HUB_RELAY_CONTAINER", "asa-hub-snapshot")
# Overridable so a mutation run can point at a COPY: the real file is
# bind-mounted into a RUNNING service, and editing it in place to see whether a
# test bites would mean a crash in that window restarts the relay on mutated
# code. A test suite must not be able to break the thing it is testing.
SOURCE = os.getenv("HUB_RELAY_SOURCE", "/srv/app/snapshot_service.py")


def _inside() -> bool:
    return os.path.exists(SOURCE)


def _reexec_in_container() -> int:
    """Run this very file inside the relay, where the imports exist."""
    here = os.path.abspath(__file__)
    try:
        proc = subprocess.run(
            ["docker", "exec", "-e", "HUB_SNAPSHOT_OUT=/tmp/ledger-batch-test",
             "-e", "HUB_LEDGER_BATCH=0", "-e", f"HUB_RELAY_SOURCE={SOURCE}",
             "-i", CONTAINER, "python3", "-"],
            stdin=open(here, "rb"), capture_output=True, text=True, timeout=180)
    except FileNotFoundError:
        print(f"docker is not available, and {SOURCE} is not here either — "
              f"nothing to test against.")
        return 2
    sys.stdout.write(proc.stdout)
    sys.stderr.write(proc.stderr)
    return proc.returncode


def main() -> int:
    if not _inside():
        return _reexec_in_container()

    import asyncio
    import base64
    import importlib.util
    import json
    import shutil
    import time
    import types
    import urllib.parse

    spec = importlib.util.spec_from_file_location("relay", SOURCE)
    m = importlib.util.module_from_spec(spec)
    sys.modules["relay"] = m
    spec.loader.exec_module(m)

    D = m.LEDGER_DIR
    fails = [0]

    def chk(label: str, cond: bool, detail: str = "") -> None:
        print(("  OK    " if cond else "  FAIL  ") + label + ("" if cond else f"\n          {detail}"))
        if not cond:
            fails[0] += 1

    # ---------------------------------------------------------------- fixtures
    n = [0]

    def put(action="setDecision", token="T1", world=None, tenant=None, member=None,
            wid="auto", held=None, resource="candidates"):
        n[0] += 1
        body = {"token": token, "resource": resource, "action": action,
                "payload": {"id": f"r{n[0]}"}}
        if wid == "auto":
            body["write_id"] = f"W{n[0]}"
        elif wid:
            body["write_id"] = wid
        for k, v in (("world", world), ("tenant", tenant), ("member", member)):
            if v:
                body[k] = v
        raw = urllib.parse.urlencode({"body": json.dumps(body)}).encode()
        entry = {"action": action, "raw_b64": base64.b64encode(raw).decode(),
                 "content_type": "application/x-www-form-urlencoded",
                 "klass": "idempotent"}
        if held:
            entry["held_until"] = time.time() + held
        path = D / f"{time.time_ns() + n[0]:020d}.json"
        path.write_text(json.dumps(entry))
        return path

    def clear():
        shutil.rmtree(D, ignore_errors=True)
        D.mkdir(parents=True, exist_ok=True)
        (D / "dead").mkdir(exist_ok=True)

    def alive():
        return sorted(p.name for p in D.glob("*.json"))

    def dead():
        return sorted(p.name for p in (D / "dead").glob("*.json"))

    # ------------------------------------------------ 1. who may share a batch
    print("\nGROUPING — a batch is one person, one place, and a PREFIX")

    def grouped(label, expect):
        got = len(m._ledger_batch(sorted(D.glob("*.json"))))
        chk(f"{label} → {expect}", got == expect, f"got {got}")
        clear()

    clear()
    put(); put(); put()
    grouped("three writes, same person and place", 3)
    put(); put(); put(token="T2")
    grouped("the third is another PERSON — cut before it", 2)
    # (the tenant and world axes are no longer GROUPED by — they are refused
    #  outright; see "company ground only" below. What remains here is the
    #  token and the member axis.)
    put(); put(); put(member="m9")
    grouped("the third is a VISIT to someone else — cut", 2)
    put(); put(held=90); put()
    grouped("the second is HELD (a twin may still be running) — cut at it", 1)
    put(); put(wid=None); put()
    grouped("the second has no write_id (nothing to dedup a re-send) — cut", 1)
    put(); put(action="authLogout"); put()
    grouped("an auth action in the middle — cut", 1)
    put(); put(action="list"); put()
    grouped("a READ in the middle — cut", 1)
    put(); put(action="bulkWrite"); put()
    grouped("an already-batched entry — cut", 1)
    for _ in range(m.LEDGER_BATCH_MAX + 5):
        put()
    grouped(f"more than the ceiling of {m.LEDGER_BATCH_MAX}", m.LEDGER_BATCH_MAX)
    put(action="moveStage"); put(action="setDecision"); put(action="screenSave")
    grouped("different ACTIONS, same person and place — they ride together", 3)
    # PREFIX, NOT SELECTION. With the mismatch in the MIDDLE, a batch that
    # merely FILTERED would pick the first and the third and leave the second
    # behind — and the second is an EARLIER edit than the third. Ordering would
    # break for exactly the entry that was skipped. Every fixture above puts the
    # mismatch last, where `continue` and `break` are indistinguishable; this is
    # the one that tells them apart, and it was added because a mutation that
    # turned the break into a continue survived without it.
    put(token="T1"); put(token="T2"); put(token="T1")
    grouped("a mismatch in the MIDDLE ends the batch — it is a prefix, not a filter", 1)
    put(token="T1"); put(tenant="akron"); put(token="T1"); put(token="T1")
    grouped("another branch mid-queue ends it, even with three of ours behind", 1)

    # COMPANY GROUND ONLY — the two the adversarial review found,
    # AFTER the lane had been switched on. Both live on the backend side:
    # doPost never establishes HUB_WORLD_CTX for a NAMED action, so a batched
    # world write would land in the COMPANY tables; and bulkWrite is not in
    # HUB_TENANT_SAFE_ACTIONS, so away from home the whole batch is 404. The
    # first is misdirection and the second is waste, and neither can be fixed
    # from this side of the door.
    put(world="w1"); put(world="w1")
    grouped("a WORLD write never batches — not even with another of its own", 0)
    put(tenant="akron"); put(tenant="akron")
    grouped("a FRANCHISE write never batches", 0)
    put(); put(world="w1"); put()
    grouped("a world write mid-queue ends the batch at it", 1)
    put(); put(tenant="akron"); put()
    grouped("a franchise write mid-queue ends the batch at it", 1)
    put(member="m9"); put(member="m9")
    grouped("a VISIT still batches — the member axis is carried, not refused", 2)

    k = m._ledger_batch_key
    chk("the key still carries all four axes — company ground is a FILTER, not "
        "a reason to stop distinguishing places",
        k({"token": "T", "world": "w", "tenant": "t", "member": "m"}) == ("T", "w", "t", "m"))
    chk("a missing axis is '' and never collides with a set one",
        k({"token": "T"}) == ("T", "", "", "") and k({"token": "T", "tenant": "akron"}) != k({"token": "T"}))
    chk("an unparseable body can never join a batch",
        len(m._ledger_batch([])) == 0)

    # ------------------------------------------- 2. what each receipt settles
    print("\nSETTLEMENT — every entry answers for itself")

    class FakeRes:
        def __init__(self, payload):
            self.content = json.dumps(payload).encode()

    class FakeClient:
        payload = None
        sent = []

        def __init__(self, **kw):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, url, headers=None, content=None):
            FakeClient.sent.append(content)
            if isinstance(FakeClient.payload, Exception):
                raise FakeClient.payload
            return FakeRes(FakeClient.payload)

    m.httpx = types.SimpleNamespace(AsyncClient=FakeClient)
    m._ledger_mark_delivered = lambda *a, **kw: None
    m._ledger_tell_author = lambda *a, **kw: None

    def fresh(count=3):
        """A queue of `count` entries, with the write_ids they actually carry —
        read back from the files rather than assumed, because the ids come from
        a counter this file shares with the grouping fixtures above."""
        clear()
        paths = [put() for _ in range(count)]
        ids = [m._relay_body(base64.b64decode(json.loads(p.read_text())["raw_b64"]))["write_id"]
               for p in paths]
        return paths, ids

    def deliver():
        """Never lets an exception escape: a settlement that THROWS is a defect
        to be reported, not a crash that hides the checks after it. (A mutation
        that removed the missing-receipt guard blew up here instead of failing
        an assertion, which read as 'undetected' until this was wrapped.)"""
        try:
            return asyncio.run(m._ledger_deliver_batch(m._ledger_batch(sorted(D.glob("*.json")))))
        except Exception as exc:  # noqa: BLE001
            chk(f"settlement raised: {str(exc)[:80]}", False,
                "the drain must settle every entry or leave it queued — never throw")
            return "raised"

    def receipts(*pairs):
        return {"status": 200, "data": {"receipts": [
            {"write_id": w, "status": s, **({"message": msg} if msg else {})}
            for w, s, msg in pairs]}}

    ps, ids = fresh(3)
    FakeClient.sent.clear()
    FakeClient.payload = receipts((ids[0], 200, ""), (ids[1], 200, ""), (ids[2], 200, ""))
    ok = deliver()
    chk("three accepted → the queue empties and nothing is buried",
        ok and alive() == [] and dead() == [], f"alive={alive()} dead={dead()}")

    sent = json.loads(urllib.parse.parse_qs(FakeClient.sent[-1].decode())["body"][0])
    chk("what went out is ONE bulkWrite carrying the person's token",
        sent["action"] == "bulkWrite" and sent["token"] == "T1" and len(sent["payload"]["writes"]) == 3,
        json.dumps(sent)[:200])
    chk("the entries keep the order they were queued in",
        [w["write_id"] for w in sent["payload"]["writes"]] == ids,
        str([w["write_id"] for w in sent["payload"]["writes"]]))
    chk("every entry carries its own write_id, resource, action and payload",
        all(set(w) == {"write_id", "resource", "action", "payload"} for w in sent["payload"]["writes"]))

    ps, ids = fresh(3)
    FakeClient.payload = receipts((ids[0], 200, ""), (ids[1], 400, "decision must be Advance or Decline"),
                                  (ids[2], 200, ""))
    ok = deliver()
    chk("a validation refusal buries THAT entry and delivers the others",
        ok and alive() == [] and dead() == [ps[1].name], f"alive={alive()} dead={dead()}")

    # A 409 IS A CLOSED DOOR BY THIS PLATFORM'S OWN RULE (LEDGER_TRANSIENT_STATUS)
    # — kept and counted, buried at LEDGER_TRANSIENT_TRIES. This case used to
    # expect the burial on the first 409, which the rule stopped doing; and the
    # refusal is now KEPT on the entry, because the one-at-a-time path must not
    # read a later echo of it as a delivery (the echo section below).
    ps, ids = fresh(3)
    FakeClient.payload = receipts((ids[0], 200, ""), (ids[1], 409, "No phone screen recorded"), (ids[2], 200, ""))
    ok = deliver()
    kept = json.loads(ps[1].read_text()) if ps[1].exists() else {}
    chk("a 409 stays QUEUED with its attempt counted and its refusal kept on the entry",
        ok and alive() == [ps[1].name] and dead() == [] and kept.get("attempts") == 1 and
        (kept.get("last_refusal") or {}).get("status") == 409,
        f"alive={alive()} dead={dead()} entry={json.dumps(kept)[:200]}")

    ps, ids = fresh(3)
    FakeClient.payload = receipts((ids[0], 200, ""), (ids[1], 500, "choked"), (ids[2], 200, ""))
    ok = deliver()
    chk("a 5xx leaves that entry QUEUED for retry and buries nothing",
        ok and alive() == [ps[1].name] and dead() == [], f"alive={alive()} dead={dead()}")
    # AND IT COUNTS THE ATTEMPT. Without this the batch path settles the entry
    # every pass without ever advancing it, `settled > 0` keeps the drain from
    # falling through to the single path, and a head that answers 5xx forever
    # never reaches LEDGER_MAX_ATTEMPTS — it retries for ever and nobody is
    # told. Found by an adversarial review, not by the suite.
    chk("and the failed attempt is COUNTED, so the ceiling still applies",
        json.loads(ps[1].read_text()).get("attempts") == 1,
        f"attempts={json.loads(ps[1].read_text()).get('attempts')}")

    ps, ids = fresh(2)
    doomed = json.loads(ps[0].read_text())
    doomed["attempts"] = m.LEDGER_MAX_ATTEMPTS
    ps[0].write_text(json.dumps(doomed))
    FakeClient.payload = receipts((ids[0], 500, "still choking"), (ids[1], 200, ""))
    ok = deliver()
    chk("an entry past the attempts ceiling is buried where a person can see it",
        dead() == [ps[0].name] and alive() == [],
        f"alive={alive()} dead={dead()}")

    ps, ids = fresh(3)
    FakeClient.payload = receipts((ids[0], 200, ""), (ids[2], 200, ""))
    ok = deliver()
    chk("an entry with NO receipt stays queued — it never ran",
        ok and alive() == [ps[1].name], f"alive={alive()}")

    ps, ids = fresh(2)
    FakeClient.payload = receipts((ids[0], 401, "Authentication required"), (ids[1], 200, ""))
    ok = deliver()
    chk("401 is buried as a refusal, not retried forever",
        ok and dead() == [ps[0].name], f"dead={dead()}")

    # ------------------------------------- 3. nothing is lost by switching on
    print("\nSAFETY — the cases that decided whether this could be switched on")

    ps, ids = fresh(3)
    FakeClient.payload = {"status": 404, "message": 'Unknown action: "bulkWrite".'}
    ok = deliver()
    chk("an OLD deployment that never heard of bulkWrite loses NOTHING",
        ok is False and len(alive()) == 3 and dead() == [],
        f"returned {ok}, alive={len(alive())}, dead={dead()}")

    ps, ids = fresh(3)
    FakeClient.payload = RuntimeError("connection lost")
    ok = deliver()
    chk("a dead transport loses NOTHING and falls back to one at a time",
        ok is False and len(alive()) == 3 and dead() == [],
        f"returned {ok}, alive={len(alive())}")

    ps, ids = fresh(3)
    FakeClient.payload = {"status": 500, "message": "backend choked"}
    ok = deliver()
    chk("a 5xx on the BATCH ITSELF loses nothing",
        ok is False and len(alive()) == 3 and dead() == [])

    ps, ids = fresh(3)
    FakeClient.payload = {"status": 200, "data": {}}
    ok = deliver()
    chk("an answer with no receipts at all leaves every entry queued",
        ok is False and len(alive()) == 3 and dead() == [])

    # A FAILED BATCH'S RECEIPTS ARE NOT RECEIPTS. This is the only case where
    # the envelope-status guard actually bites: without it, a backend that
    # answered 500 while still emitting a partial receipt list would have those
    # entries deleted and buried on the strength of a batch that failed. With
    # a well-behaved backend the guard is behaviour-neutral — which is exactly
    # why a mutation removing it survived until this case was written down.
    ps, ids = fresh(3)
    FakeClient.payload = {"status": 500, "message": "choked",
                          "data": {"receipts": [{"write_id": ids[0], "status": 200},
                                                {"write_id": ids[1], "status": 409,
                                                 "message": "would have been buried"}]}}
    ok = deliver()
    chk("a FAILED batch's receipts settle nothing — not one delete, not one burial",
        ok is False and len(alive()) == 3 and dead() == [],
        f"returned {ok}, alive={len(alive())}, dead={dead()}")

    # ------------------------------------- 3b. the echo after a refusal
    print("\nTHE ECHO AFTER A REFUSAL — the one-at-a-time drain")
    # A refused Accept (setDecision, 409 "No phone screen recorded") was logged
    # "delivered, receipt lost to the echo" and dropped: doPost answers a seen
    # write_id with its RECORDED receipt, refusals included, so the echo on a
    # re-send was the refusal coming back. The real _ledger_drain runs here over
    # the real files; only the transport answers, in the two shapes it has.

    class EchoRes:
        """Google's echo host: doPost ran, the receipt did not come back."""
        content = b"<html><body>echo</body></html>"
        history = [object()]
        url = "https://script.googleusercontent.com/macros/echo?user_content_key=x"

    answers = []

    class SeqClient(FakeClient):
        async def post(self, url, headers=None, content=None):
            return answers.pop(0) if answers else EchoRes()

    def drain_until_settled():
        async def run():
            m._ledger_wake = asyncio.Event()
            task = asyncio.ensure_future(m._ledger_drain())
            for _ in range(300):
                await asyncio.sleep(0.05)
                if not alive():
                    break
            task.cancel()
            try:
                await task
            except BaseException:  # noqa: BLE001 — the cancel is the point
                pass
        asyncio.run(run())

    m.httpx = types.SimpleNamespace(AsyncClient=SeqClient)
    clear()
    p = put()
    answers[:] = [FakeRes({"status": 409, "message": "No phone screen recorded for this candidate yet."}),
                  EchoRes()]
    drain_until_settled()
    buried = json.loads((D / "dead" / p.name).read_text()) if (D / "dead" / p.name).exists() else {}
    chk("an echo after a 409 is the recorded refusal coming back — BURIED, never 'delivered'",
        alive() == [] and dead() == [p.name], f"alive={alive()} dead={dead()}")
    chk("and the burial names the refusal it carried",
        "No phone screen recorded" in str(buried.get("dead_reason") or ""),
        str(buried.get("dead_reason"))[:200])

    clear()
    p = put()
    answers[:] = [EchoRes()]
    drain_until_settled()
    chk("an echo with no refusal before it is still a delivery with its receipt lost",
        alive() == [] and dead() == [], f"alive={alive()} dead={dead()}")
    m.httpx = types.SimpleNamespace(AsyncClient=FakeClient)

    # ------------------------------------------------------------ 4. the switch
    print("\nTHE SWITCH — a file, so it needs no restart")
    on = m.LEDGER_BATCH_FLAG
    off = m.OUT_DIR / "ledger-batch.off"
    m.OUT_DIR.mkdir(parents=True, exist_ok=True)
    for p in (on, off):
        p.unlink(missing_ok=True)
    chk("with no file at all it follows the environment", m._ledger_batch_on() == m.LEDGER_BATCH_ENV)
    on.touch()
    chk("ledger-batch.on turns it ON", m._ledger_batch_on() is True)
    off.touch()
    chk(".on wins when both exist", m._ledger_batch_on() is True)
    on.unlink()
    chk(".off alone turns it OFF", m._ledger_batch_on() is False)
    off.unlink()
    chk("removing both returns to the environment", m._ledger_batch_on() == m.LEDGER_BATCH_ENV)

    shutil.rmtree(D, ignore_errors=True)
    print(f"\nledger batch: {fails[0]} failed\n")
    return 1 if fails[0] else 0


if __name__ == "__main__":
    sys.exit(main())
