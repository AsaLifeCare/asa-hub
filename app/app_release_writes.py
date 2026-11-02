"""An app's release announcement's writes (app/app_release.py): the master's own Announce on Release Users
(appReleaseAnnounce), what an App Control save just opened (appReleaseNoticed, the relay's word after the save
landed) and the clock's pass over the announcements owed for later (appReleaseSweep). Inside the quiet window nobody is
written to: the announcement is owed in app.app_release_pending, and the clock's first pass after it tells them."""
from __future__ import annotations

import time
from typing import Any, Callable

import app_release as AR
import gsjs
import locations as L
import resource_rows as RR
import scope as sc
import smart_comms_desk as SCD
import writes as W
from writes import Decision

s_ = gsjs.str_


def _owe(app_id: str, badges: list[str], name: str, tagline: str, whole: bool) -> None:
    """appReleaseOweMorning_ and its fold: one entry per app, its badges joined, its first moment kept."""
    cur = RR._cur()
    cur.execute(f"select badges from {AR.PENDING} where app_id = %s for update", (app_id,))
    got = cur.fetchall()
    merged = list(dict.fromkeys(sc.types_from_raw(got[0][0]) + badges)) if got else badges
    RR._cur().execute(
        f"insert into {AR.PENDING} (app_id, badges, name, tagline, whole) values (%s, %s, %s, %s, %s)"
        " on conflict (app_id) do update set badges = excluded.badges, name = coalesce(nullif(excluded.name, ''),"
        f" {AR.PENDING}.name), tagline = coalesce(nullif(excluded.tagline, ''), {AR.PENDING}.tagline),"
        f" whole = {AR.PENDING}.whole or excluded.whole",
        (app_id, ", ".join(merged), name, tagline, whole))


def _num(v: Any) -> float:
    """Number(v) || 0."""
    n = SCD.js_number(v) if v not in (None, "") else 0.0
    return 0.0 if n != n or n in (float("inf"), float("-inf")) else n


def _stamp(app_id: str) -> None:
    RR._cur().execute(f"insert into {AR.STAMP} (app_id) values (%s) on conflict (app_id) do update set at = now()",
                      (app_id,))


def _carry(reads: L.Reads, started: float) -> dict[str, Any]:
    """appReleaseQuietCarry_ for every announcement owed: still open to its badges, told to whom it can reach."""
    out: dict[str, Any] = {}
    sit = AR.situation(reads)
    if sit["state"] != "on":
        return {"_": sit["why"]}
    now_access = AR.access(reads)
    cut = AR.masters_only(reads)
    for p in AR.pending(reads):
        app_id = p["app_id"]
        since = p["since"]
        since_ms = since.timestamp() * 1000.0 if hasattr(since, "timestamp") else AR._at_ms(since)
        gone = ""
        if since_ms and time.time() * 1000.0 - since_ms > AR.HORIZON_S * 1000.0:
            gone = "owed for more than a day and a half — let go"
        now = now_access.get(app_id) or []
        still = now if p["whole"] else [b for b in p["badges"] if b in now]
        if not gone and app_id in cut:
            gone = "kept to the master's own session — announced to nobody"
        if not gone and not still:
            gone = "no longer opens to anybody" if p["whole"] else "no longer opens to the badges it was owed to"
        if gone:
            RR._cur().execute(f"delete from {AR.PENDING} where app_id = %s", (app_id,))
            out[app_id] = {"let_go": gone}
            continue
        app = {"id": app_id, "title": p["name"] or app_id, "objective": p["tagline"]}
        got = AR.run(reads, sit["sit"], app, still, mode="auto", since_ms=since_ms, most=AR.AUTO_MAX, started=started)
        t = got["tally"]
        if not got["unwritten"]:
            RR._cur().execute(f"delete from {AR.PENDING} where app_id = %s", (app_id,))
            if AR.complete(t, got["already_told"]):
                _stamp(app_id)
        out[app_id] = {**t, "unwritten": got["unwritten"], "already_told": got["already_told"]}
    return out


def announce(sess: L.Session, payload: dict) -> Decision:
    """appReleaseAnnounce: the master's own press — every released account the app's badges reach, told once."""
    started = time.monotonic()
    reads, user = sess.reads, sess.user or {}
    if not sc.is_real_master(user):
        return W.refuse(403, "Requires an admin or manager account")
    p = payload if isinstance(payload, dict) else {}
    app_id = s_(p.get("app_id"))
    if not app_id:
        return W.refuse(400, "Which app? app_id is required.")
    title = s_(p.get("title")) or app_id
    objective = s_(p.get("objective"))
    resume = int(max(0.0, _num(p.get("resume"))))
    again = p.get("again") is True
    outstanding = max(0.0, _num(p.get("outstanding")))
    told_before = max(0.0, _num(p.get("told_before")))
    announced_before = AR.stamped(reads, app_id)
    badges = AR.access(reads).get(app_id) or []
    if not badges:
        return W.refuse(400, "The " + title + " app has no badges on the access matrix — nobody but the master can "
                             "open it yet. Give it badges first; the release then announces itself.")
    sit = AR.situation(reads)

    def not_run(why: str, brake: str) -> Decision:
        return W.refuse(409, "The " + title + " announcement was not sent: " + why + ".",
                        data={"app_id": app_id, "title": title, "situation_state": sit["state"], "blocked_by": brake})

    if sit["state"] not in ("on", "unreadable"):
        return not_run(sit["why"], "situation_" + sit["state"])
    if SCD.quiet_now(reads):
        if again:
            return W.refuse(409, "Inside the quiet window (" + SCD.quiet_words() + ") nothing reaches a person, and a "
                                 "second sending to everybody cannot wait for the morning. Nobody was written to — "
                                 "send it again after " + SCD.QUIET_TO + ".")
        _owe(app_id, badges, title, objective, True)
        return Decision({"status": 200, "data": {"app_id": app_id, "title": title, "quiet_owed": True, "sent": 0,
                                                 "held": 0, "failed": 0, "done": True, "resume": 0}},
                        subject="", own=True)
    if sit["state"] == "unreadable":
        return not_run(sit["why"], "situation_unreadable")
    if not SCD.dial(reads.config())["readable"]:
        return not_run("the test-mode switch could not be read, so nobody may be written to — press again once it "
                       "reads", "test_mode_unreadable")
    got = AR.run(reads, sit["sit"], {"id": app_id, "title": title, "objective": objective}, badges, mode="manual",
                 again=again, resume=resume, started=started)
    t = got["tally"]
    done = not got["stopped_at"]
    if done and not outstanding and AR.complete(t, got["already_told"] + int(told_before)):
        _stamp(app_id)
    return Decision({"status": 200, "data": {
        "app_id": app_id, "title": title, "eligible": got["eligible"], "matched": got["matched"],
        "not_released": got["not_released"], "already_told": got["already_told"], "already_sent": t["already_sent"],
        "sent": t["sent"], "held": t["held_dial"], "held_by": got["held_by"], "held_quiet": t["held_quiet"],
        "quiet_owed": False, "declined": t["declined"], "unchecked": t["unchecked"], "failed": t["failed"],
        "stopped": t["silenced"], "announced_before": announced_before, "log_written": True, "done": done,
        "resume": got["stopped_at"] or 0}}, subject="", own=True)


def noticed(sess: L.Session, payload: dict) -> Decision:
    """An App Control save that landed: the badges each app's rule now holds against the ones it held, and whatever
    was added announced — at once outside the quiet window, owed for the morning inside it."""
    started = time.monotonic()
    if (sess.user or {}).get("is_service") is not True:
        return W.refuse(403, "This is the relay's own write.")
    reads = sess.reads
    p = payload if isinstance(payload, dict) else {}
    rules = p.get("rules") if isinstance(p.get("rules"), dict) else {}
    meta = p.get("meta") if isinstance(p.get("meta"), dict) else {}
    before = AR.access(reads)
    cut = AR.masters_only(reads)
    added_by: dict[str, list[str]] = {}
    for app_id, raw in rules.items():
        app_id = s_(app_id)[:80]
        if not app_id:
            continue
        now = sc.types_from_raw(raw)
        added = [b for b in now if b not in (before.get(app_id) or [])]
        RR._cur().execute(f"insert into {AR.ACCESS} (app_id, badges) values (%s, %s) on conflict (app_id) do update"
                          " set badges = excluded.badges, at = now()", (app_id, ", ".join(now)))
        if added and app_id not in cut:
            added_by[app_id] = added
    for app_id, added in added_by.items():
        m = meta.get(app_id) if isinstance(meta.get(app_id), dict) else {}
        _owe(app_id, added, s_(m.get("name")) or app_id, s_(m.get("tagline")), False)
    out: dict[str, Any] = {"added": added_by}
    if added_by and not SCD.quiet_now(reads):
        out["told"] = _carry(reads, started)
    return Decision({"status": 200, "data": out}, subject="", own=True)


def sweep(sess: L.Session, payload: dict) -> Decision:
    """The clock's pass over the announcements owed, once the quiet window is over."""
    started = time.monotonic()
    if (sess.user or {}).get("is_service") is not True:
        return W.refuse(403, "This is the relay's own write.")
    if SCD.quiet_now(sess.reads):
        return Decision({"status": 200, "data": {"quiet": True}}, subject="", own=True)
    return Decision({"status": 200, "data": {"told": _carry(sess.reads, started)}}, subject="", own=True)


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {
    "appReleaseAnnounce": announce, "appReleaseNoticed": noticed, "appReleaseSweep": sweep}
POLICY: dict[str, dict[str, Any]] = {"appReleaseAnnounce": {"roles": ("admin",)}, "appReleaseNoticed": {},
                                     "appReleaseSweep": {}}
BUSY_OF: dict[str, dict[str, Any]] = {a: {"status": 503, "message": "Another update is in progress — try again."}
                                      for a in ACTIONS}


class Store(W.Store):
    """app.app_release_writes and app.app_release_receipts, beside the other apps' own."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="app_release", label="App release")
