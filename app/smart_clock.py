"""Smart Comms' clock on Python (SmartComms.gs smartEventSweep_, and smartCommsSweep_ with smartDue_ and
smartDigestSweep_): what Apps Script ran at the end of its hiring sweep, rung by the relay instead. Every event
situation the Desk has on, told about the rows its subject names; every credential reminder that is due; every digest
— each message through the one send door (comms_rpc.call, rpcCall_'s answers) under Apps Script's own idempotency
keys, and the ledger (smart_comms_sent) written as smartRecord_ wrote it. The look (smartClockDue) is a read and
plans each telling whole; smart_clock_writes carries the plans under the write lock, a few at a time."""
from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any, Callable

import candidates as CND
import gsjs
import house_tables as HT
import hubdb
import locations as L
import mail_designs as MD
import smart_comms as SC
import smart_comms_desk as SCD
import staff as SP
import system_logs as SL
import team_alerts as TA
from gsjs import NY, name_key

APP_ID = "smart-clock"
DENIED = {"status": 403, "message": "This is the relay's own door."}
ADMIN_ONLY = {"status": 403, "message": "Requires an admin account"}
# SmartComms.gs SMART_FREQUENCIES
FREQUENCIES = {"once": 0, "daily": 1, "every_other_day": 2, "weekly": 7, "monthly": 30}
# kinds smartDue_ never treats as a per-person reminder
NOT_REMINDERS = ("digest", "ai", "bundle", "window_ask", "call_off", "shift_clock", "letter", "gate")
DAY_MS = 86400000.0

s_ = gsjs.str_


def _ms(v: Any) -> float | None:
    """new Date(str_(v)).getTime(), None for NaN."""
    return gsjs.date_parse(s_(v))


def now_ms(reads: L.Reads) -> float:
    return reads.now.timestamp() * 1000.0


# ---- the ledger: who has already been told, and about which occasion -------------------------------------------

def ledger_key(sid: str, who: str, expires: Any, slot: str = "") -> str:
    """smartLedgerKey_."""
    return sid + "|" + who + "|" + s_(expires)[:10] + ("@" + slot if slot else "")


def rehearsal_key(key: str) -> str:
    """smartRehearsalKey_."""
    return "REHEARSAL|" + key


def ledger_stats(reads: L.Reads) -> dict[str, dict]:
    """smartLedgerStats_: every key written, and per key how many deliveries and the newest one's time."""
    got = SCD.ledger_rows(reads)
    sent: dict[str, bool] = {}
    attempts: dict[str, dict[str, float]] = {}
    if got is None:
        return {"sent": sent, "attempts": attempts}
    rows, heads = got
    for _rn, raw in rows:
        k = gsjs.trim(gsjs.or_blank(raw.get(heads["key"])))
        if not k:
            continue
        sent[k] = True
        if s_(raw.get(heads["channel"])).lower() == "rehearsal":
            continue
        at = _ms(raw.get(heads["at"])) or 0.0
        cur = attempts.get(k)
        if cur is None:
            attempts[k] = {"count": 1, "last": at}
        else:
            cur["count"] += 1
            cur["last"] = max(cur["last"], at)
    return {"sent": sent, "attempts": attempts}


def attempts_allow(attempts: dict[str, dict], sit: dict, who: str, expires: Any, now: float, slot: str = "") -> bool:
    """smartAttemptsAllow_: may this key be told now — not too many times, not too soon."""
    base = ledger_key(s_(sit.get("id")), who, expires)
    try:
        max_a = int(float(s_(sit.get("max_attempts")) or "x"))
    except ValueError:
        max_a = 1
    if max_a < 1:
        max_a = 1
    days = FREQUENCIES.get(s_(sit.get("frequency") or "once").strip().lower(), 0)
    hour_days: dict[str, bool] = {}
    last = 0.0
    for k, a in attempts.items():
        if k.startswith(base + "@"):
            hour_days[k[len(base) + 1:len(base) + 11]] = True
            last = max(last, a["last"])
    if slot:
        if ledger_key(s_(sit.get("id")), who, expires, slot) in attempts:
            return False
        today = slot[:10]
        slotless = attempts.get(base)
        undated = slotless["count"] if slotless else 0
        if slotless:
            last = max(last, slotless["last"])
        if hour_days.get(today):
            return True
        told = len(hour_days) + undated
        if not told:
            return True
        if told >= max_a or days == 0:
            return False
        newest = max(hour_days) if hour_days else ""
        newest_ms, today_ms = SP._cert_ms(newest) if newest else None, SP._cert_ms(today)
        if newest_ms is None or today_ms is None:
            return now - last >= days * DAY_MS
        return round((today_ms - newest_ms) / DAY_MS) >= days
    st = attempts.get(base)
    told = (st["count"] if st else 0) + len(hour_days)
    if st:
        last = max(last, st["last"])
    if not told:
        return True
    if told >= max_a or days == 0:
        return False
    return now - last >= days * DAY_MS


def _send(name: str, params: dict, key: str, role: str = "") -> dict[str, Any]:
    return {"name": name, "params": params, "opts": {"idempotency_key": key}, "role": role}


# ---- the event lane: the rows each subject names (SmartComms.gs subjectRows) -------------------------------------

def _hub(reads: L.Reads, tab: str) -> list[dict]:
    """listRows_ of a Hub resource by its tab, from Postgres once an app keeps it there."""
    return reads.hub_rows(tab)


def hotline_subjects(reads: L.Reads) -> list[dict]:
    """hotlineSmartSubjects_: the call-off queue's rows of the last two days."""
    floor = now_ms(reads) - 2 * DAY_MS
    out = []
    for r in CND.read_tab(reads, "hotline_calloff_queue"):
        t = _ms(r.get("queuedat"))
        if not t or t < floor:
            continue
        out.append({"id": s_(r.get("instance")), "instance": s_(r.get("instance")), "employee": s_(r.get("employee")),
                    "date": s_(r.get("date")), "reason": s_(r.get("reason")), "location": s_(r.get("location")),
                    "manager": s_(r.get("manager"))})
    return out


def onboarding_subjects(reads: L.Reads) -> list[dict]:
    """obReportSubjects_: each finished onboarding's report row — kept in Postgres (`onboardingReports`) where the
    onboarding writes it, its headers read as readTabNormalized_ names them."""
    import sheet_resources as SR  # noqa: PLC0415 - it imports this module's neighbours
    if "onboardingReports" in SR.SPECS:
        rows = [{re.sub(r"[^a-z0-9]", "", k.lower()): v for k, v in r.items()}
                for r in SR.rows(reads, "onboardingReports")]
    else:
        rows = CND.read_tab(reads, "onboarding_reports")
    out = []
    for r in rows:
        row = {"id": s_(r.get("id")), "instance": s_(r.get("createdat")), "name": s_(r.get("fullname")),
               "phone": s_(r.get("phone")), "email": s_(r.get("email")), "step1": s_(r.get("step1packet")),
               "step2": s_(r.get("step2background")), "step3": s_(r.get("step3documents")),
               "step4": s_(r.get("step4training")), "step5": s_(r.get("step5questionnaire")),
               "step6": s_(r.get("step6tutorials")), "report": s_(r.get("reporttext"))}
        if row["id"]:
            out.append(row)
    return out


def recon_subjects(reads: L.Reads) -> list[dict]:
    """reconSmartSubjects_: the runs of the last days that found errors."""
    import recon as RC  # noqa: PLC0415 - Time Reconciliation's own config
    cutoff = now_ms(reads) - float(RC.config(reads)["smartRunDays"]) * DAY_MS
    out = []
    for r in _hub(reads, "recon_runs"):
        t = _ms(r.get("createdAt"))
        try:
            total = float(s_(r.get("total")) or 0)
        except ValueError:
            total = 0.0
        if t is None or t < cutoff or total <= 0:
            continue
        out.append({"id": s_(r.get("id")), "name": "recon run " + s_(r.get("id"))[:8], "total": s_(r.get("total")),
                    "missing": s_(r.get("missing")), "noEnd": s_(r.get("noEnd")), "dupe": s_(r.get("dupe")),
                    "gap": s_(r.get("gap")), "overlap": s_(r.get("overlap")),
                    "period": s_(r.get("dateFrom")) + " – " + s_(r.get("dateTo"))})
    return out


def staff_subjects(reads: L.Reads) -> list[dict]:
    """reconReminderSubjects_: the punch reminders an error has queued (the IST notices are app/ist_writes.py's)."""
    out = []
    for r in _hub(reads, "recon_errors"):
        if not s_(r.get("reminderQueuedAt")) or s_(r.get("type")) not in ("missing", "noEnd"):
            continue
        out.append({"id": s_(r.get("id")), "name": s_(r.get("employeeName")), "phone": s_(r.get("reminderPhone")),
                    "email": "", "reminderQueuedAt": s_(r.get("reminderQueuedAt")), "date": s_(r.get("date")),
                    "location": s_(r.get("location")), "hours": s_(r.get("hours")),
                    "what": "no clock-out" if s_(r.get("type")) == "noEnd" else "no punch"})
    return out


def truelink_subjects(reads: L.Reads) -> list[dict]:
    """truelinkRunSubjects_: the card syncs of the last two days."""
    cutoff = now_ms(reads) - 2 * DAY_MS
    out = []
    for r in _hub(reads, "truelink_runs"):
        t = _ms(r.get("at"))
        if t is None or t < cutoff:
            continue
        out.append({k: s_(r.get(k)) for k in ("id", "mode", "verb", "found", "skipped", "unreadable", "tail")})
    return out


def _num(v: Any) -> float:
    """finNum_ / travelNum_: the number a cell writes, money signs and commas set aside."""
    t = re.sub(r"[$,\s]", "", s_(v))
    try:
        return float(t) if t else 0.0
    except ValueError:
        return 0.0


def _user_of(reads: L.Reads, pick: Callable[[dict], bool]) -> dict | None:
    hit = None
    for u in reads.users():
        if pick(u):
            hit = u
    return hit


def travel_subjects(reads: L.Reads) -> list[dict]:
    """travelSmartSubjects_: a trip that ended three days ago or more with no outcome written."""
    now = now_ms(reads)
    users = reads.users()
    out = []
    for t in _hub(reads, "travel_trips"):
        if s_(t.get("id")).startswith("EX_"):
            continue
        status = s_(t.get("status")) or "proposed"
        if status not in ("completed", "booked") or s_(t.get("outcome")) or not s_(t.get("endDate")):
            continue
        ended = _ms(s_(t.get("endDate")) + "T12:00:00")
        if ended is None or ended > now:
            continue
        days = int((now - ended) // DAY_MS)
        if days < 3:
            continue
        email, phone = s_(t.get("travellerEmail")), ""
        for u in users:
            uname = s_(u.get("displayname")).lower()
            if not email and uname and uname == s_(t.get("traveller")).lower():
                email = s_(u.get("email")).lower()
            if email and s_(u.get("email")).lower() == email:
                phone = s_(u.get("phone"))
        out.append({"id": s_(t.get("id")), "name": s_(t.get("traveller")) or s_(t.get("requestedBy")), "email": email,
                    "phone": phone, "destination": s_(t.get("destination")), "days": str(days),
                    "endDate": s_(t.get("endDate"))})
    return out


def shopper_subjects(reads: L.Reads) -> list[dict]:
    """shopSmartSubjects_: each owner with watched items whose best estimate beat its target."""
    best: dict[str, float] = {}
    for p in _hub(reads, "shopper_prices"):
        k, n = s_(p.get("itemId")), _num(p.get("estimate"))
        if n > 0 and (k not in best or n < best[k]):
            best[k] = n
    by: dict[str, dict] = {}
    for r in _hub(reads, "shopper_items"):
        if s_(r.get("status")) and s_(r.get("status")) != "watching":
            continue
        target, b = _num(r.get("targetPrice")), best.get(s_(r.get("id")), 0.0)
        owner = s_(r.get("ownerId"))
        if not (target > 0 and 0 < b <= target) or not owner:
            continue
        o = by.setdefault(owner, {"ownerId": owner, "name": "", "count": 0, "first": "", "best": 0.0})
        o["count"] += 1
        if not o["first"]:
            o["first"], o["best"] = s_(r.get("name")), b
    out = []
    for owner, o in by.items():
        u = _user_of(reads, lambda x, w=owner: s_(x.get("userid")) == w)
        out.append({**o, "name": (s_(u.get("displayname")) or s_(u.get("email"))) if u else owner,
                    "email": s_(u.get("email")) if u else "", "phone": s_(u.get("phone")) if u else "",
                    "count": str(o["count"]), "bestText": f"${o['best']:.2f}"})
    return out


def client_subjects(reads: L.Reads) -> list[dict]:
    """finSmartSubjects_."""
    import finance as FIN  # noqa: PLC0415 - Client Finances' own reading
    return FIN.missing_receipts(reads)


def _money(x: float) -> str:
    return f"${x:,.2f}"


def _day_words(iso: str) -> str:
    d = datetime.fromisoformat(iso)
    return f"{d.strftime('%b')} {d.day}"


def house_spending_subjects(reads: L.Reads) -> list[dict]:
    """Every house manager on the hotline calendar, once per house they manage, with that house's spending last week
    off Client Finances' ledger — a house nothing was spent at says so, it is never skipped."""
    import finance as FIN  # noqa: PLC0415 - Client Finances' own reading
    import support_desk_writes as SD  # noqa: PLC0415 - the account a manager's name folds to
    week = FIN.house_week(reads, reads.today())
    label = _day_words(week["start"]) + " – " + _day_words(week["end"])
    out, seen = [], set()
    for p in SCD.hotline_house_managers(reads)["people"]:
        code, name = L.code_of(p.get("house")), gsjs.trim(s_(p.get("name")))
        key = code + "|" + name_key(name)
        if not code or not name or key in seen:
            continue
        seen.add(key)
        h = week["houses"].get(code) or {"count": 0, "total": 0.0, "missing": 0, "categories": {}}
        top = sorted(h["categories"].items(), key=lambda kv: -kv[1])[:3]
        if h["count"]:
            summary = (f"{h['count']} purchase{'' if h['count'] == 1 else 's'} came to {_money(h['total'])}"
                       + (" (" + ", ".join(f"{c} {_money(v)}" for c, v in top) + ")." if top else "."))
        else:
            summary = "No spending was logged for the clients at " + code + "."
        receipts = ("Nothing is waiting for a receipt." if not h["missing"] else
                    f"{h['missing']} purchase{' is' if h['missing'] == 1 else 's are'} still waiting for a receipt.")
        u = SD.account_by_name(reads, name) or {}
        out.append({"id": key, "name": name, "house": code, "phone": s_(p.get("phone")), "email": s_(u.get("email")),
                    "instance": code + ":" + week["start"], "week": label, "total": _money(h["total"]),
                    "count": str(h["count"]), "missing": str(h["missing"]), "summary": summary,
                    "receipts": receipts})
    return out


# Guardian.gs GUARDIAN_EXPIRED_FLOOR, GUARDIAN_STALE_HOURS, GUARDIAN_CALL_LANE_ACTION
GUARDIAN_EXPIRED_FLOOR = 10
GUARDIAN_STALE_HOURS = 26
CALL_LANE_ACTION = "commCallsIngest"


def _write_ledger(reads: L.Reads) -> dict[str, Any]:
    """guardianLedger_: the write ledger's pending and dead letters."""
    try:
        sid = gsjs.trim(reads.db.prop("HUB_DB_ID"))
        ref = reads.db.tab(sid, "write_ledger") if sid else None
        if ref is None:
            return {"state": "unknown", "detail": "no ledger tab"}
        heads = [gsjs.trim(gsjs.js_str(h)) for h in ref.headers]
        if "status" not in heads:
            return {"state": "unknown",
                    "detail": 'the write ledger has no "status" column — the queue could not be counted'}
        col = ref.headers[heads.index("status")]
        pending = dead = 0
        for _rn, raw in reads.db.rows(ref):
            st = s_(raw.get(col)).lower()
            pending += st in ("pending", "held")
            dead += st == "dead"
        return {"state": "fail" if dead else "warn" if pending > 10 else "ok",
                "detail": f"{pending} pending, {dead} dead", "pending": pending, "dead": dead}
    except Exception as exc:  # noqa: BLE001 - not counted is said as such
        return {"state": "unknown", "detail": str(exc)[:200]}


def _call_lane_issue(reads: L.Reads) -> str:
    """guardianCallLane_ as far as it pages: the call hand-over's last logged pass failed, or its houses do not
    resolve."""
    try:
        ref = SL.logs_tab(reads)
        if ref is None:
            return ""
        got = reads.db.query(f'select _raw from {reads.db.from_sql(ref)} where _raw->>\'action\' = %s'  # noqa: S608
                             " order by row_number desc limit 1", (CALL_LANE_ACTION,))
    except Exception:  # noqa: BLE001 - a log not read is not known, and pages nothing
        return ""
    if not got:
        return ""
    row = SL._raw(got[0][0])
    at = _ms(row.get("timestamp"))
    mins = round(max(0.0, now_ms(reads) - at) / 60000) if at is not None else None
    if s_(row.get("ok")).lower() == "false":
        said = s_(row.get("detail"))[:160]
        return f"call hand-over: the last hand-over failed {mins} min ago" + (": " + said if said else "")
    if mins is None:
        return ""
    whys = []
    for tab, count in (("comm_calls", True), ("comm_work_items", False)):
        res = reads.db.resolve(tab)
        if not res.declared_house:
            whys.append(f"the {tab} house is not declared")
        elif count and res.ref is None and not res.book_known:
            whys.append(f"the {tab} house did not open: asa-hub-db holds no copy of it")
    if not whys:
        return ""
    why = "; ".join(whys)
    if "not declared" in why:
        why += " — the hand-over answers 503 until both are declared, and nothing can land"
    return f"call hand-over: the door opened {mins} min ago, but {why}"


def _matrix(reads: L.Reads) -> list[dict[str, Any]]:
    """The requirement states by column name, where they live: Postgres once Compliance keeps them, else the tab the
    router names (Guardian.gs opened HUB_DB, which holds none, and read the columns of an older header)."""
    import compliance_engine as CE  # noqa: PLC0415 - the requirement states' owner
    if CE.owned(reads.db):
        grid = CE.states_grid(reads)
        return [dict(zip(grid["hdr"], row)) for row in grid["values"]]
    res = reads.db.resolve("requirement_states")
    if res.ref is None:
        return []
    heads = [(gsjs.trim(gsjs.js_str(h)), h) for h in res.ref.headers]
    return [{k: raw.get(h) for k, h in heads} for _rn, raw in reads.db.rows(res.ref)]


def guardian_subjects(reads: L.Reads) -> list[dict]:
    """guardianSmartSubjects_: what the environment needs a person for, once a day."""
    issues: list[str] = []
    try:
        ledger = _write_ledger(reads)
        if ledger["state"] == "unknown":
            issues.append("the write ledger could not be counted: " + ledger["detail"])
        elif ledger.get("dead", 0) > 0:
            issues.append(f"{ledger['dead']} dead write(s) in the ledger")
        lane = _call_lane_issue(reads)
        if lane:
            issues.append(lane)
        values = _matrix(reads)
        if not values:
            issues.append("the requirement matrix is empty (never rebuilt)")
        else:
            expired = sum(1 for r in values if s_(r.get("state")) == "expired")
            newest = max((_ms(r.get("computed_at")) or 0.0 for r in values), default=0.0)
            if expired > GUARDIAN_EXPIRED_FLOOR:
                issues.append(f"{expired} expired requirements in the matrix")
            age_h = (now_ms(reads) - newest) / 3600000.0 if newest else 999
            if age_h > GUARDIAN_STALE_HOURS:
                issues.append(f"the matrix has not rebuilt in {round(age_h)}h")
    except Exception as exc:  # noqa: BLE001 - a check that broke is itself a thing to say
        issues.append("guardian checks failed: " + str(exc)[:120])
    if not issues:
        return []
    return [{"id": "guardian", "instance": reads.now.astimezone(timezone.utc).strftime("%Y-%m-%d"),
             "issues": "; ".join(issues)}]


def candidate_subjects(reads: L.Reads) -> list[dict]:
    """The talent candidates, as readTabNormalized_ hands them."""
    return CND.read_tab(reads, CND.TALENT_CANDIDATES_TAB)


SUBJECTS: dict[str, Callable[[L.Reads], list[dict]]] = {
    "sync": truelink_subjects, "recon": recon_subjects, "hotline": hotline_subjects, "travel": travel_subjects,
    "shopperOwners": shopper_subjects, "client": client_subjects, "onboarding": onboarding_subjects,
    "guardian": guardian_subjects, "staff": staff_subjects, "candidate": candidate_subjects,
    "houseSpending": house_spending_subjects}
# the subjects their own lanes send; named so they never fall through to the candidates
ELSEWHERE = ("psi", "incident", "broadcast", "open_shift", "recruit_book", "user")
# rows, not candidates: no stage, archive or rehearsal card applies
NOT_CANDIDATES = ("client", "sync", "staff", "recon", "onboarding", "hotline", "travel", "shopperOwners", "guardian",
                  "houseSpending")


# ---- SmartComms.gs SMART_EVENTS: what each event is about, and when a row fires -----------------------------------

def _fires(instance: Any, **vars: Any) -> dict[str, Any]:
    return {"fires": True, "instance": s_(instance), "vars": {k: s_(v) for k, v in vars.items()}}


def _hotline(r: dict, _reads: L.Reads) -> dict | None:
    if not r.get("id") or not r.get("employee"):
        return None
    return _fires(r.get("instance"), employee=r["employee"], date=r.get("date"), reason=r.get("reason"),
                  location=r.get("location"), manager=r.get("manager"))


def _travel(r: dict, _reads: L.Reads) -> dict | None:
    if not r.get("id") or not r.get("destination"):
        return None
    return _fires(s_(r["id"]) + ":" + s_(r.get("endDate")), name=r.get("name"), destination=r["destination"],
                  days=r.get("days"), end_date=r.get("endDate"))


def _shopper(r: dict, _reads: L.Reads) -> dict | None:
    if not r.get("ownerId") or not r.get("count"):
        return None
    return _fires(s_(r["ownerId"]) + ":" + s_(r["count"]) + ":" + s_(r.get("first")), name=r.get("name"),
                  first_name=s_(r.get("name")).split(" ")[0], count=r["count"], first=r.get("first"),
                  best=r.get("bestText"))


def _house_spending(r: dict, _reads: L.Reads) -> dict | None:
    if not r.get("id") or not r.get("house"):
        return None
    return _fires(r["instance"], house=r["house"], week=r.get("week"), total=r.get("total"), count=r.get("count"),
                  missing=r.get("missing"), summary=r.get("summary"), receipts=r.get("receipts"))


def _truelink(r: dict, _reads: L.Reads) -> dict | None:
    if not r.get("id"):
        return None
    return _fires(r["id"], **{k: r.get(k) for k in ("mode", "verb", "found", "skipped", "unreadable", "tail")})


def _ist(r: dict, _reads: L.Reads) -> dict | None:
    if not r.get("id") or not r.get("client"):
        return None
    return _fires(r.get("instance"), client=r["client"], house=r.get("house"), due=r.get("due"),
                  cert_note=r.get("certNote"))


def _questionnaire(r: dict, _reads: L.Reads) -> dict | None:
    if not r.get("id") or not r.get("questionnaire"):
        return None
    return _fires(r.get("instance"), questionnaire=r["questionnaire"], questions=r.get("questions"),
                  minutes=r.get("minutes"), link=r.get("link"), period=r.get("period"))


def _onboarding(r: dict, _reads: L.Reads) -> dict | None:
    if not r.get("id"):
        return None
    return _fires(r.get("instance"), name=r.get("name"), phone=TA.e164(r.get("phone")), email=r.get("email"),
                  **{f"step{i}": r.get(f"step{i}") for i in range(1, 7)}, report=r.get("report"))


def _receipts(c: dict, _reads: L.Reads) -> dict | None:
    if not c.get("missing"):
        return None
    return _fires(c.get("month"), count=str(c["missing"]), month=c.get("month"), oldest=c.get("oldest"),
                  total=c.get("total"))


def _recon_run(r: dict, _reads: L.Reads) -> dict | None:
    if not r.get("id") or not r.get("total"):
        return None
    return _fires(r["id"], runId=r["id"], **{k: r.get(k) for k in ("total", "missing", "noEnd", "dupe", "gap",
                                                                     "overlap", "period")})


def _punch(r: dict, _reads: L.Reads) -> dict | None:
    if not r.get("id") or not r.get("reminderQueuedAt"):
        return None
    return _fires(r["reminderQueuedAt"], date=r.get("date"), location=r.get("location"), hours=r.get("hours"),
                  what=r.get("what"))


def _packet_missing(c: dict, reads: L.Reads) -> dict | None:
    h, _w = CND.soft(lambda: CND.packet_hold(reads, c))
    if not h:
        return None
    return _fires(h["since"], since=s_(h["since"])[:10], day=s_(h["until"])[:10])


def _packet_day(c: dict, reads: L.Reads) -> dict | None:
    h, _w = CND.soft(lambda: CND.packet_hold(reads, c))
    if not h or h.get("escalate") is not True:
        return None
    return _fires(h["until"], since=s_(h["since"])[:10], day=s_(h["until"])[:10])


def _extended(c: dict, reads: L.Reads) -> dict | None:
    u, _w = CND.soft(lambda: CND.card_urgency(reads, c))
    if not u or u.get("level") != "red":
        return None
    return _fires(s_(c.get("onboardingaccessuntil")) or s_(u.get("why")), why=u.get("why"))


def _guardian(r: dict, _reads: L.Reads) -> dict | None:
    if not r.get("id"):
        return None
    return _fires(r.get("instance"), issues=r.get("issues"), name="Guardian")


EVENTS: dict[str, dict[str, Any]] = {
    "hotline_call_off": {"subject": "hotline", "applies": _hotline},
    "travel_outcome_missing": {"subject": "travel", "to_subject": True, "applies": _travel},
    # the operator's order (2026-10-28): each house's spending last week, to its house manager, every Monday — no
    # longer Smart Shopper's watched-item alert, which speaks through no situation now
    "shopper_worth_checking": {"subject": "houseSpending", "to_subject": True, "applies": _house_spending},
    "truelink_run": {"subject": "sync", "applies": _truelink},
    "ist_due": {"subject": "staff", "to_subject": True, "applies": _ist},
    "questionnaire_due": {"subject": "staff", "to_subject": True, "applies": _questionnaire},
    "onboarding_report": {"subject": "onboarding", "applies": _onboarding},
    "finance_receipts_missing": {"subject": "client", "applies": _receipts},
    "recon_errors_found": {"subject": "recon", "applies": _recon_run},
    "recon_punch_reminder": {"subject": "staff", "to_subject": True, "applies": _punch},
    "packet_missing": {"legacy": "packetamberalertedat", "applies": _packet_missing},
    "packet_day_elapsed": {"legacy": "packetoverduealertedat", "applies": _packet_day},
    "deadline_extended_expired": {"legacy": "packetredalertedat", "applies": _extended},
    "guardian_alert": {"subject": "guardian", "applies": _guardian},
}
# the events the clock never fires (their own lanes and doors do): declared so a row naming one is known
FIRED_ELSEWHERE = (
    "hiring_event_scheduled", "hiring_date_accepted", "hiring_hired_complete", "hiring_hired_missing",
    "hiring_packet_request", "hiring_ready_to_start", "hiring_phone_collect", "hiring_phone_confirm",
    "hiring_contact_failed", "hiring_referral_contact", "hiring_screen_report", "interview_slots_ask",
    "hiring_scorecard_report", "hiring_cjis_gate", "hiring_onboarding_finish", "hiring_onboarding_stalled",
    "hiring_hired_congrats", "interview_days_ask", "hiring_welcome", "hiring_ask", "hiring_shortlist", "hiring_outreach",
    "hiring_cjis_request", "hiring_decision_ask", "hiring_resume_request", "interview_candidate_confirmed",
    "hiring_screen_redo", "hiring_screen_call", "hiring_first_contact", "hiring_unreachable_archived",
    "referral_no_contact", "referral_already_known", "interview_invite", "interview_supervisor_ask",
    "interview_supervisor_slots_request", "interview_slots_offer", "interview_confirmed", "psyanywhere_false_message",
    "psyanywhere_true_message", "hotline_incident", "hotline_support_request", "pattern_scan_daily",
    "user_release_invite", "app_release_announced", "staff_broadcast", "open_shift_covered",
    "hiring_screen_day_reminder", "hiring_onboarding_start", "hiring_bci_howto")


def _cid(subj: str, c: dict) -> str:
    """The identity a ledger key is built on: a row's id, an owner, a client's name, a candidate's id."""
    if subj in ("sync", "staff", "recon", "onboarding", "hotline", "travel", "guardian", "houseSpending"):
        return s_(c.get("id"))
    if subj == "shopperOwners":
        return s_(c.get("ownerId"))
    return s_(c.get("name")) if subj in NOT_CANDIDATES else s_(c.get("candidateid"))


def _who(subj: str, c: dict, cid: str) -> str:
    if subj == "sync":
        return s_(c.get("mode"))
    if subj in ("staff", "houseSpending"):
        return s_(c.get("name"))
    if subj == "recon":
        return s_(c.get("name")) or s_(c.get("id"))
    return cid if subj in NOT_CANDIDATES else (s_(c.get("candidatename")) or cid)


def event_plans(reads: L.Reads, rows: list[dict], stats: dict) -> tuple[list[dict], dict[str, Any]]:
    """smartEventSweep_ up to the sending: each telling planned whole ({sit, key, rule, name, instance, sends,
    record}), and what was skipped."""
    sits = [s for s in rows if s_(s.get("kind")).lower() == "event" and SC.smart_on(s.get("enabled"))
            and gsjs.trim(s_(s.get("event"))) in EVENTS]
    out: dict[str, Any] = {"situations": len(sits), "skipped": 0, "unread": []}
    plans: list[dict] = []
    cache: dict[str, list[dict]] = {}
    attempts = stats["attempts"]
    now = now_ms(reads)
    for sit in sits:
        sid = s_(sit.get("id"))
        d = EVENTS[gsjs.trim(s_(sit.get("event")))]
        sched = SCD.schedule_now(sit, reads)
        if sched["holds"]:
            continue
        slot = sched.get("slot") or ""
        tag = "_" + slot if slot else ""
        stages = [x.lower() for x in SC.smart_list(sit.get("statuses"))]
        try:
            grace = max(int(float(s_(sit.get("days_before")) or "x")), 0)
        except ValueError:
            grace = 0
        subj = d.get("subject") or "candidate"
        if subj not in cache:
            try:
                cache[subj] = SUBJECTS[subj](reads)
            except Exception as exc:  # noqa: BLE001 - a subject that cannot be read sends nothing this pass
                cache[subj] = []
                out["unread"].append(f"{subj}: {type(exc).__name__}")
        is_client = subj in NOT_CANDIDATES
        for c in cache[subj]:
            cid = _cid(subj, c)
            if not cid:
                continue
            if not is_client and s_(c.get("archived")).lower() == "true":
                continue
            if not is_client and stages and s_(CND.stage_of(c.get("status")) or "").lower() not in stages:
                continue
            try:
                hit = d["applies"](c, reads)
            except Exception:  # noqa: BLE001 - a row the rule cannot read does not fire
                hit = None
            if not hit:
                continue
            inst = hit["instance"]
            if grace > 0:
                since = _ms(inst)
                if since is not None and now < since + grace * DAY_MS:
                    continue
            key = ledger_key(sid, cid, inst, slot)
            if not attempts_allow(attempts, sit, cid, inst, now, slot):
                continue
            if not is_client and d.get("legacy") and s_(c.get(d["legacy"])):
                continue
            if not is_client and TA.test_card(reads, c):
                out["skipped"] += 1
                continue
            name = _who(subj, c, cid)
            v = {"name": name, "first_name": name.split()[0] if name.split() else "",
                 "sender": s_(sit.get("sender")) or SC.SENDER_DEFAULT, **hit["vars"]}
            channels = SC.smart_list(sit.get("channels"))
            plan = {"lane": "event", "sit": sid, "key": key, "name": name, "instance": inst,
                    "record": {"key": key, "situation": sid, "person": name, "expires": inst,
                               "channel": "+".join(channels) or ("sms" if d.get("to_subject") else "team")},
                    "allow": {"who": cid, "expires": inst, "slot": slot}}
            # a value an event did not carry (an IST's cert note) leaves its sentence out of the letter, never a brace
            subject = SC.letter_subject(SC.render(sit.get("email_subject"), v))
            words = SC.prune_letter(SC.render(s_(sit.get("email_text")) or s_(sit.get("sms_text")), v))
            reason = "smart comms event: " + sid
            if d.get("to_subject"):
                sends = []
                if "sms" in channels:
                    num = SC.sendable(c.get("phone"))
                    if num:
                        sends.append(_send("smsSend", {"to": num, "body": SC.render(sit.get("sms_text"), v),
                                                       "reason": reason},
                                           f"smart_evt_sms_{sid}_{cid}_{inst[:24]}{tag}", "subject"))
                if "email" in channels and s_(c.get("email")):
                    sends.append(_send("emailSend", {"to": s_(c.get("email")), "subject": subject, "body": words,
                                                     "reason": reason},
                                       f"smart_evt_mail_{sid}_{cid}_{inst[:24]}{tag}", "subject"))
                for ci, dest in enumerate(SC.smart_list(sit.get("to"))):
                    if not dest:
                        continue
                    if "@" in dest:
                        sends.append(_send("emailSend", {"to": dest, "subject": subject, "body": words,
                                                         "reason": "smart comms cc: " + sid},
                                           f"smart_evt_cc{ci}_{sid}_{cid}_{inst[:20]}{tag}", "copy"))
                        continue
                    cn = SC.team_copy(dest)
                    if not cn:
                        out.setdefault("would", []).append(f"{sid} → copy {dest[:40]} (no address)")
                        continue
                    sends.append(_send("smsSend", {"to": cn, "body": SC.render(sit.get("sms_text"), v),
                                                   "reason": "smart comms cc: " + sid},
                                       f"smart_evt_ccs{ci}_{sid}_{cid}_{inst[:20]}{tag}", "copy"))
                plans.append({**plan, "rule": "subject", "sends": sends})
                continue
            html = ""
            if s_(sit.get("email_design")) == "guardian_alert":
                issues = [x for x in re.split(r";\s*", s_(v.get("issues")) or "something needs a person") if x]
                try:
                    html = MD.guardian_alert_email({"issues": issues}, reads.now)["html"]
                except Exception:  # noqa: BLE001 - the plain words carry the letter
                    html = ""
            params = {"to": ", ".join(SC.smart_list(sit.get("to"))), "subject": subject, "body": words,
                      "reason": reason}
            if html:
                params["html"] = html
            plans.append({**plan, "rule": "team",
                          "sends": [_send("teamAlert", params, f"smart_evt_{sid}_{cid}_{inst[:10]}{tag}", "team")]})
    return plans, out


# ---- the reminders: a credential about to expire (smartDue_, smartCommsSweep_) -----------------------------------

def raw_column(row: dict | None, label: Any) -> str:
    """smartRawColumn_: a Master row's cell under a column named in the row's own words."""
    if not row or not label:
        return ""
    want = hubdb.estate_key(s_(label))
    if row.get(want):
        return gsjs.js_str(row[want])
    k = re.sub(r"[^a-z0-9]+", "_", s_(label).strip().lower())
    return gsjs.js_str(row[k]) if row.get(k) else ""


def status_of(raw: dict | None, person: dict | None) -> str:
    """smartStatusOf_: the Master's Status, else the person's own."""
    from_master = raw_column(raw, "Status").strip() if raw else ""
    return (from_master or s_((person or {}).get("status"))).lower()


def credential_label(reads: L.Reads, sit: dict) -> str:
    """smartCredentialLabel_."""
    key = s_(sit.get("credential")).strip()
    if s_(sit.get("label")):
        return s_(sit.get("label"))
    labels = SCD.cert_labels(reads)
    if labels.get(key):
        return labels[key]
    return re.sub(r"\s+exp(iration)?\s*date$", "", key.replace("_", " "), flags=re.I).strip()


def _master_by_name(reads: L.Reads) -> dict[str, dict]:
    out: dict[str, dict] = {}
    try:
        field = SP.cert_source_field(reads, "master.name")
        for r in SP.cert_read_tab(reads, SP.cert_source_tab(reads, "master")):
            k = name_key(SP.master_name(r, field))
            if k and k not in out:
                out[k] = r
    except Exception:  # noqa: BLE001 - no raw rows, only the mapped certificates
        return {}
    return out


def _people(reads: L.Reads) -> list[dict]:
    return SP.without_isp_clients(reads, SP.people_merged(reads, SP._people(reads)))


def due(reads: L.Reads, rows: list[dict], stats: dict, only: str = "") -> dict[str, Any]:
    """smartDue_: everybody a reminder applies to right now, sending nothing."""
    sits = [s for s in rows if SC.smart_on(s.get("enabled")) and (not only or s_(s.get("id")) == only)
            and s_(s.get("kind") or "reminder").strip().lower() not in NOT_REMINDERS]
    if not sits:
        return {"situations": 0, "due": []}
    picture = SP.cert_pictures(reads)
    raw_by = _master_by_name(reads)
    sent, attempts = stats["sent"], stats["attempts"]
    now = now_ms(reads)
    found = []
    for p in _people(reads):
        nk = name_key(p.get("name"))
        if not nk:
            continue
        certs = (picture.get(nk) or {}).get("certs") or {}
        raw = raw_by.get(nk)
        rehearsal = TA.test_card(reads, {"candidatename": p.get("name"), "phone": p.get("phone"),
                                         "email": p.get("email")})
        for s in sits:
            statuses = [x.lower() for x in SC.smart_list(s.get("statuses"))]
            if statuses and status_of(raw, p) not in statuses:
                continue
            src = s_(s.get("credential")).strip()
            cell = certs.get(src)
            expires = s_(cell.get("expires")) if cell and cell.get("expires") else raw_column(raw, src)
            if not expires:
                continue
            ms = SP._cert_ms(expires)
            if ms is None:
                continue
            left = int((ms - now) // DAY_MS)
            try:
                before = int(float(s_(s.get("days_before")) or "x"))
            except ValueError:
                continue
            if left > before:
                continue
            sched = SCD.schedule_now(s, reads)
            if sched["holds"]:
                continue
            slot = sched.get("slot") or ""
            key = ledger_key(s_(s.get("id")), nk, expires, slot)
            if not attempts_allow(attempts, s, nk, expires, now, slot):
                continue
            found.append({"rehearsed": bool(sent.get(rehearsal_key(key))), "slot": slot,
                          "slot_label": sched.get("label") or "", "situation": s_(s.get("id")), "key": key,
                          "name": s_(p.get("name")), "name_key": nk, "phone": s_(p.get("phone")),
                          "email": s_(p.get("email")), "credential": s.get("credential"), "expires": expires[:10],
                          "days_left": left, "channels": SC.smart_list(s.get("channels")), "rehearsal": rehearsal,
                          "config": s})
    return {"situations": len(sits), "due": found}


def reminder_plans(reads: L.Reads, found: dict[str, Any]) -> list[dict]:
    """smartCommsSweep_ up to the sending: each reminder's texts, letters and copies, planned whole."""
    cfg = reads.config()
    rehearsal_to = SC.sendable(cfg.get("packet_rehearsal_number"))
    plans = []
    for d in found["due"]:
        s = d["config"]
        v = {"first_name": (d["name"].split() or [""])[0], "name": d["name"], "expires": d["expires"],
             "days_left": str(d["days_left"]), "credential": credential_label(reads, s),
             "sender": s_(s.get("sender")) or SC.SENDER_DEFAULT}
        cc = [] if d["rehearsal"] else SC.smart_list(s.get("cc"))
        cc_phones = [n for n in (SC.sendable(x) for x in cc if "@" not in x) if n]
        cc_emails = [x for x in cc if "@" in x]
        sends = []
        reason = "smart comms: " + d["situation"]
        if "sms" in d["channels"]:
            to = rehearsal_to if d["rehearsal"] else SC.sendable(d["phone"])
            if to:
                body = SC.render(s.get("sms_text"), v)
                if d["rehearsal"]:
                    body = f"[rehearsal for {d['name']}] {body}"
                sends.append(_send("smsSend", {"to": to, "body": body, "reason": reason}, "smart_" + d["key"], "sms"))
                for i, n in enumerate(cc_phones):
                    sends.append(_send("smsSend", {"to": n, "body": body, "reason": "smart comms cc: " + d["situation"]},
                                       f"smart_cc{i}_{d['key']}", "copy"))
        if "email" in d["channels"] and d["email"]:
            subject, words = SC.render(s.get("email_subject"), v), SC.render(s.get("email_text"), v)
            sends.append(_send("emailSend", {"to": TA.TEST_EMAIL if d["rehearsal"] else d["email"], "subject": subject,
                                             "body": words, "reason": reason}, "smart_mail_" + d["key"], "email"))
            for i, addr in enumerate(cc_emails):
                sends.append(_send("emailSend", {"to": addr, "subject": subject, "body": words,
                                                 "reason": "smart comms cc: " + d["situation"]},
                                   f"smart_mailcc{i}_{d['key']}", "copy"))
        plans.append({"lane": "reminder", "rule": "reminder", "sit": d["situation"], "key": d["key"], "name": d["name"],
                      "instance": d["expires"], "sends": sends,
                      "record": {"key": d["key"], "situation": d["situation"], "person": d["name"],
                                 "expires": d["expires"], "channel": "sms"},
                      "allow": {"who": d["name_key"], "expires": d["expires"], "slot": d["slot"]}})
    return plans


# ---- the digests: one letter a week (or an hour) per situation (smartDigestSweep_) -----------------------------

DIGEST_SEED = ({"id": "drivers_license_expiring", "credential": "Driver License Exp Date", "label": "driver's license"},
               {"id": "car_insurance_expiring", "credential": "Insurance Exp Date", "label": "car insurance"})


def _book_on(row: dict) -> bool:
    """hubBookOn_."""
    a = s_(row.get("active") if row.get("active") is not None else row.get("enabled") or "on").strip().lower()
    return a not in ("off", "false", "no", "0")


def extra_situations(reads: L.Reads) -> list[dict]:
    """smartExtraSituations_ as far as a digest reads it (the seeds that name a column), hubBookMerge_'d with the
    generic config book's Smart Situations rows."""
    out = [dict(s) for s in DIGEST_SEED]
    at = {s["id"]: i for i, s in enumerate(out)}
    try:
        sid = reads.db.prop("HUB_GENERIC_CONFIG_ID")
        ref = HT.tab_of(reads, sid, "Smart Situations", "the Smart Situations book") if sid else None
        rows = []
        if ref is not None:
            heads = [re.sub(r"[^a-z0-9]+", "_", s_(h).lower()) for h in ref.headers]
            rows = [{k: hubdb.typed(raw.get(h), "raw") for k, h in zip(heads, ref.headers) if k}
                    for _rn, raw in reads.db.rows(ref)]
    except Exception:  # noqa: BLE001 - no book, the seeds stand
        rows = []
    for r in rows:
        rid = s_(r.get("id")).strip()
        if not _book_on(r):
            if rid in at and out[at[rid]] is not None:
                out[at[rid]] = None  # type: ignore[call-overload]
            continue
        if not rid:
            continue
        cells = {k: v for k, v in r.items() if k not in ("active", "notes") and s_(v).strip() != ""}
        if rid in at and out[at[rid]] is not None:
            out[at[rid]].update(cells)
        else:
            at[rid] = len(out)
            out.append({**cells, "id": rid})
    return [s for s in out if s is not None]


def all_sources(reads: L.Reads) -> list[dict[str, str]]:
    """smartAllSources_: every mapped certification, then each extra situation's column."""
    out = [{"key": k, "label": v} for k, v in SCD.cert_labels(reads).items()]
    out += [{"key": s_(e.get("credential")), "label": s_(e.get("label"))} for e in extra_situations(reads)
            if s_(e.get("credential"))]
    return out


def digest_rows(reads: L.Reads, sit: dict) -> list[list[str]]:
    """smartDigestRows_: [name, type, date, days] for each credential in the situation's window."""
    picture = SP.cert_pictures(reads)
    raw_by = _master_by_name(reads)
    direction = s_(sit.get("direction") or "expiring").lower()
    try:
        win = int(float(s_(sit.get("days_before")) or "x"))
    except ValueError:
        return []
    statuses = [x.lower() for x in SC.smart_list(sit.get("statuses"))]
    named = SC.smart_list(sit.get("credential"))
    labels = SCD.cert_labels(reads)
    sources = [{"key": n, "label": labels.get(n) or n} for n in named] if named else all_sources(reads)
    ex_col = s_(sit.get("exclude_column"))
    ex_vals = [x.lower() for x in SC.smart_list(sit.get("exclude_values"))]
    now = now_ms(reads)
    rows = []
    for p in _people(reads):
        nk = name_key(p.get("name"))
        if not nk:
            continue
        certs = (picture.get(nk) or {}).get("certs") or {}
        raw = raw_by.get(nk)
        if statuses and status_of(raw, p) not in statuses:
            continue
        if ex_col and raw:
            got = raw_column(raw, ex_col).strip().lower()
            if got and got in ex_vals:
                continue
        for src in sources:
            cell = certs.get(src["key"])
            val = s_(cell.get("expires")) if cell and cell.get("expires") else raw_column(raw, src["key"])
            if not val:
                continue
            ms = SP._cert_ms(val)
            if ms is None:
                continue
            days = int((ms - now) // DAY_MS)
            days = -days if direction == "elapsed" else days
            if direction == "elapsed":
                if days <= win:
                    continue
            elif days <= 0 or days > win:
                continue
            rows.append([s_(p.get("name")), src["label"], val[:10], str(days)])
    return rows


def digest_table(header: list[str], rows: list[list[str]]) -> dict[str, str]:
    """smartTable_'s text."""
    return {"text": " | ".join(header) + "\n" + "\n".join(" | ".join(r) for r in rows)}


def digest_stamp(reads: L.Reads) -> str:
    """smartDigestStamp_: the week of the year, on the script's clock."""
    d = reads.now.astimezone(NY)
    jan = datetime(d.year, 1, 1, tzinfo=NY)
    jan_day = (jan.weekday() + 1) % 7
    return f"{d.year}w{int(((d - jan).total_seconds() / 86400 + jan_day) // 7)}"


def digest_plans(reads: L.Reads, rows: list[dict], stats: dict) -> tuple[list[dict], dict[str, Any]]:
    """smartDigestSweep_ up to the sending: one letter per address, recorded once per situation and week."""
    out: dict[str, Any] = {"digests": 0, "rows": 0, "skipped": []}
    plans = []
    for sit in rows:
        if s_(sit.get("kind")).strip().lower() != "digest" or not SC.smart_on(sit.get("enabled")):
            continue
        sid = s_(sit.get("id"))
        sched = SCD.schedule_now(sit, reads)
        if sched["holds"]:
            out["skipped"].append(f"{sid}: next at {sched.get('next')}")
            continue
        stamp = sched.get("slot") or digest_stamp(reads)
        out["digests"] += 1
        to = [x for x in SC.smart_list(sit.get("to")) if "@" in x]
        if not to:
            out["skipped"].append(sid + ": nobody in `to`")
            continue
        found = sorted(digest_rows(reads, sit), key=lambda r: float(r[3]))
        if not found:
            out["skipped"].append(sid + ": nothing due")
            continue
        out["rows"] += len(found)
        dkey = f"DIGEST|{sid}|{stamp}"
        if stats["sent"].get(dkey):
            out["skipped"].append(sid + (f": already sent at {sched.get('label')}" if sched.get("slot")
                                         else ": already sent this week"))
            continue
        table = digest_table(["Employee Name", "Type", "Date", "Days"], found)
        v = {"days_before": s_(sit.get("days_before")), "table": table["text"],
             "sender": s_(sit.get("sender")) or SC.SENDER_DEFAULT, "credential": credential_label(reads, sit),
             "expires": "", "days_left": "", "first_name": "", "name": ""}
        subject, words = SC.render(sit.get("email_subject"), v), SC.render(sit.get("email_text"), v)
        sends = [_send("emailSend", {"to": a, "subject": subject, "body": words,
                                     "reason": "smart comms digest: " + sid}, f"digest_{sid}_{stamp}_{i}", "digest")
                 for i, a in enumerate(to)]
        plans.append({"lane": "digest", "rule": "digest", "sit": sid, "key": dkey, "name": "digest", "instance": stamp,
                      "sends": sends, "record": {"key": dkey, "situation": sid, "person": "digest", "expires": stamp,
                                                 "channel": "email"}, "allow": {"digest": True}})
    return plans, out


# ---- the doors ----------------------------------------------------------------------------------------------------

def clock_due(sess: L.Session, payload: dict) -> dict[str, Any]:
    """smartClockDue: the relay's look before it rings smartClockSend — the events every time, the reminders and
    digests when it asks for them (`reminders`)."""
    if (sess.user or {}).get("is_service") is not True:
        return dict(DENIED)
    reads = sess.reads
    rows = SC.read_situations(reads.db)
    stats = ledger_stats(reads)
    plans, out = event_plans(reads, rows, stats)
    data: dict[str, Any] = {"events": out}
    if (payload or {}).get("reminders") is True:
        found = due(reads, rows, stats)
        plans += reminder_plans(reads, found)
        data["reminders"] = {"situations": found["situations"], "due": len(found["due"])}
        dplans, dout = digest_plans(reads, rows, stats)
        plans += dplans
        data["digests"] = dout
    data["plans"] = plans
    return {"status": 200, "data": data}


def preview(sess: L.Session, payload: dict) -> dict[str, Any]:
    """smartCommsPreview: who a reminder would reach right now, changing nothing (admins)."""
    user = sess.user or {}
    if s_(user.get("role")) != "admin" or user.get("is_service"):
        return dict(ADMIN_ONLY)
    reads = sess.reads
    found = due(reads, SC.read_situations(reads.db), ledger_stats(reads), s_((payload or {}).get("situation")))
    out = []
    for d in found["due"]:
        s = d["config"]
        text = SC.render(s.get("sms_text"), {"first_name": (d["name"].split() or [""])[0], "name": d["name"],
                                             "expires": d["expires"], "days_left": str(d["days_left"]),
                                             "credential": credential_label(reads, s),
                                             "sender": s_(s.get("sender")) or SC.SENDER_DEFAULT})
        out.append({"situation": d["situation"], "name": d["name"], "credential": d["credential"],
                    "expires": d["expires"], "days_left": d["days_left"], "channels": d["channels"],
                    "rehearsal": d["rehearsal"], "cc": [] if d["rehearsal"] else SC.smart_list(s.get("cc")),
                    "preview": text[:400]})
    return {"status": 200, "data": {"situations": found["situations"], "due": out}}


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {"smartClockDue": clock_due}
POLICY: dict[str, dict[str, Any]] = {"smartClockDue": {}}
DESK_ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {"smartCommsPreview": preview}
DESK_POLICY: dict[str, dict[str, Any]] = {"smartCommsPreview": {"roles": ("admin",)}}
