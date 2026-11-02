"""The Guardian on Python (Guardian.gs, what is left of it once Apps Script is not the platform): the checks the
platform runs against itself, answered from Postgres and the platform's own services — the core copies in asa-hub-db,
Smart Comms' outbox (the queue that only grows when a send is failing), the relay's link, the log's newest failures —
and every Drive id the configuration names, opened. Apps Script's engines, its script properties and its own self-test
have no Python counterpart and are not asked."""
from __future__ import annotations

import json
import os
import re
import time
from datetime import datetime, timezone
from typing import Any, Callable

import drive as dr
import gsjs
import hubdb
import locations as L
import system_logs as SL
from scope import Defer

APP_ID = "guardian"
DENIED = {"status": 403, "message": "Requires an admin account"}
# a core copy older than this is a keeper that stopped
COPY_STALE_S = float(os.getenv("HUB_GUARDIAN_COPY_STALE_S", str(3 * 3600)))
FAILURES = 20
IDS_BUDGET_S = 40.0
ID_KEY = re.compile(r"(_ID|_ROOT|_FOLDER|FOLDER_ID|ROOT_ID)$")
CORE = (("users", "HUB_DB_ID"), ("hub_sessions", "HUB_DB_ID"), ("system_logs", "HUB_LOGS_ID"))

s_ = gsjs.str_


def _admin(user: dict | None) -> bool:
    u = user or {}
    return not u.get("is_service") and s_(u.get("role")) == "admin"


def check(cid: str, label: str, state: str, detail: str, meta: dict | None = None) -> dict[str, Any]:
    """guardianCheck_: ok | warn | fail | unknown, never absent."""
    return {"id": cid, "label": label, "state": state, "detail": detail or "", "meta": meta or {}}


def _age_s(stamp: Any) -> float | None:
    try:
        when = stamp if isinstance(stamp, datetime) else datetime.fromisoformat(s_(stamp).replace("Z", "+00:00"))
        return (datetime.now(timezone.utc) - when.astimezone(timezone.utc)).total_seconds()
    except (TypeError, ValueError):
        return None


def core_copies(reads: L.Reads) -> dict[str, Any]:
    """The core tabs' copies in asa-hub-db: there, and kept recently."""
    problems, stale = [], []
    for tab, book in CORE:
        sid = s_(reads.db.prop(book))
        ref = reads.db.tab(sid, tab) if sid else None
        if ref is None:
            problems.append(f"{tab} has no copy in asa-hub-db")
            continue
        # the moment the keeper last knew the book held what Google holds
        age = time.time() - reads.db.as_of({sid})
        if age > COPY_STALE_S:
            stale.append(f"{tab} ({int(age // 60)} min old)")
    if problems:
        return {"state": "fail", "detail": "; ".join(problems)}
    if stale:
        return {"state": "warn", "detail": "copies not kept lately: " + ", ".join(stale)}
    return {"state": "ok", "detail": f"{len(CORE)} core copies in asa-hub-db, kept lately"}


def outbox(reads: L.Reads) -> dict[str, Any]:
    """Smart Comms' outbox: owed is waiting its time, failed is a send that did not leave."""
    try:
        got = reads.db.query("select state, count(*) from app.smart_comms_outbox"
                             " where updated_at > now() - interval '1 day' group by state")
    except Exception as exc:  # noqa: BLE001 - an unread queue is unknown, never empty
        return {"state": "unknown", "detail": f"the outbox could not be read ({type(exc).__name__})"}
    n = {s_(k): int(v) for k, v in got}
    failed, owed = n.get("failed", 0), n.get("owed", 0)
    return {"state": "fail" if failed else ("warn" if owed > 50 else "ok"),
            "detail": f"{owed} owed, {failed} failed in the last day", "owed": owed, "failed": failed}


RELAY_RETIRED = "Retired — stopped on purpose; asa-hub-app answers every route, clock and signal itself"


def relay_link() -> dict[str, Any]:
    """The retired relay: nothing asks it anything, this check included."""
    return {"state": "retired", "detail": RELAY_RETIRED, "code": None}


def failures(reads: L.Reads) -> dict[str, Any]:
    """The log's newest failed actions (its `ok` column false), off asa-hub-db."""
    try:
        ref = SL.logs_tab(reads)
    except (Defer, hubdb.Unreadable) as exc:
        return {"state": "unknown", "detail": str(exc)[:160], "rows": []}
    if ref is None:
        return {"state": "unknown", "detail": "the log holds no rows — it can report no failure and prove no pass",
                "rows": []}
    got = reads.db.query(
        f'select _raw from {reads.db.from_sql(ref)} where lower(coalesce(_raw->>\'ok\', \'\')) in (\'false\', \'no\', \'0\')'  # noqa: S608
        " order by row_number desc limit %s", (FAILURES,))
    rows = []
    for (raw,) in got:
        r = raw if isinstance(raw, dict) else json.loads(raw or "{}")
        rows.append({k: r.get(k) for k in ("timestamp", "action", "actor", "actor_name", "summary", "area", "detail")})
    return {"state": "warn" if rows else "ok",
            "detail": f"{len(rows)} failed or denied action(s) among the newest" if rows else "no failure logged",
            "rows": rows}


def status(sess: L.Session, payload: dict) -> dict[str, Any]:
    """guardianStatus: the whole picture in one call."""
    if not _admin(sess.user):
        return dict(DENIED)
    reads = sess.reads
    core, box, relay, fails = core_copies(reads), outbox(reads), relay_link(), failures(reads)
    checks = [check("sheets", "Core data", core["state"], core["detail"]),
              check("ledger", "Smart Comms outbox", box["state"], box["detail"],
                    {"pending": box.get("owed"), "dead": box.get("failed")}),
              check("relay", "Relay", relay["state"], relay["detail"], {"code": relay.get("code")}),
              check("log", "Recent failures", fails["state"], fails["detail"], {"count": len(fails["rows"])})]
    worst = "ok"
    for c in checks:
        if c["state"] == "fail":
            worst = "fail"
        elif c["state"] == "warn" and worst != "fail":
            worst = "warn"
        elif c["state"] == "unknown" and worst == "ok":
            worst = "unknown"
    return {"status": 200, "data": {"overall": worst, "checks": checks, "engines": {}, "relayLanes": {},
                                    "recentFailures": fails["rows"],
                                    "at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")}}


def _prop_keys(reads: L.Reads) -> list[str]:
    facts = reads.db.facts()
    keys = set((facts["areas"].get("props") or {}).keys()) | set(hubdb.PROP_FALLBACKS)
    keys |= {k for k in facts["subjects"] if ID_KEY.search(k)}
    return sorted(k for k in keys if ID_KEY.search(k))


def ids(sess: L.Session, payload: dict) -> dict[str, Any]:
    """guardianIds: does every id the configuration names still open in Drive?"""
    if not _admin(sess.user):
        return dict(DENIED)
    reads = sess.reads
    drv = reads.need_drive()
    started = time.monotonic()
    ok, failed, skipped, truncated = [], [], [], False
    for key in _prop_keys(reads):
        fid = s_(reads.db.prop(key)).strip()
        if not fid:
            skipped.append({"key": key, "why": "not set"})
            continue
        if time.monotonic() - started > IDS_BUDGET_S:
            truncated = True
            break
        try:
            meta = drv.file_meta(fid, "id,name,mimeType,trashed")
        except (Defer, dr.Gone) as exc:
            failed.append({"key": key, "id": fid, "why": str(exc)[:140]})
            continue
        except Exception as exc:  # noqa: BLE001 - one id that will not answer is that id's verdict
            failed.append({"key": key, "id": fid, "why": type(exc).__name__})
            continue
        name, mime = s_(meta.get("name")), s_(meta.get("mimeType"))
        if meta.get("trashed"):
            failed.append({"key": key, "id": fid, "why": "in the trash: " + name})
            continue
        kind = "folder" if mime.endswith(".folder") else "spreadsheet" if "spreadsheet" in mime else "file"
        ok.append({"key": key, "kind": kind, "name": name})
    return {"status": 200, "data": {
        "ok": ok, "failed": failed, "skipped": skipped, "truncated": truncated, "checked": len(ok) + len(failed),
        "state": "fail" if failed else ("unknown" if truncated else "ok"),
        "detail": (f"{len(failed)} id(s) did not open: " + ", ".join(f["key"] for f in failed)) if failed
        else f"{len(ok)} id(s) open" + (" — ran out of time before the rest" if truncated else ""),
        "at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")}}


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {"guardianStatus": status, "guardianIds": ids}
POLICY: dict[str, dict[str, Any]] = {a: {"roles": ("admin",)} for a in ACTIONS}
