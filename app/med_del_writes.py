"""Med Delegation's writes on Python (MedDel.gs): a flow started from the employee Master (medDelSeed, medDelStart),
advanced by hand (medDelAdvance), cancelled (medDelCancel) or moved by the daily sweep (medDelDailySweep) — each in
app.resource_rows (`medDelFlows`), its transitions appended, never edited. The sweep's letter goes through Smart Comms;
the StarkDD and MAIS steps wait while the browser automation's secret is withheld from this server."""
from __future__ import annotations

import json
import time
import urllib.error
import urllib.request
import uuid
from typing import Any, Callable

import gsjs
import house_tables as HT
import hubdb
import locations as L
import med_del as MD
import resource_rows as RR
import sheet_resources as SR
import smart_comms as SC
import staff as SP
import writes as W
from writes import Decision

RESOURCE = MD.RESOURCE
BUSY = "Somebody else is changing the Med Del renewals right now — try again."
SKILLS_SITUATION = "med_del_skills_check"
# one browser run per sweep, and no longer than this: a write is decided in seconds
BOT_TIMEOUT_S = 4.0
BOT_WAITS = ("StarkDD submissions and MAIS scrapes wait: the browser automation's secret is withheld from this "
             "server's copy of the Script Properties")

s_ = gsjs.str_


def _cell(v: Any) -> str:
    return "" if v is None else gsjs.js_str(v)


def _by(user: dict | None) -> str:
    return s_((user or {}).get("email"))


def actives(every: list[dict]) -> dict[str, str]:
    """nameKey|level → the first active flow's id."""
    out: dict[str, str] = {}
    for f in every:
        if f.get("overallStatus") == "active":
            out.setdefault(f.get("nameKey", "") + "|" + f.get("medLevel", ""), s_(f.get("id")))
    return out


def create_flow(reads: L.Reads, fields: dict[str, Any], by: str, active: dict[str, str],
                author: str) -> tuple[dict | None, dict | None]:
    """medDelCreateFlow_: refused while an active flow holds the same person and level."""
    key = s_(fields.get("nameKey")) + "|" + s_(fields.get("medLevel"))
    if key in active:
        return None, {"status": 409, "message": "An active flow already exists for " + _cell(fields.get("employeeName"))
                                                 + " " + _cell(fields.get("medLevel")) + ".", "flowId": active[key]}
    now = W.now_iso(reads)
    record: dict[str, str] = {"phase": "1", "overallStatus": "active", "phase1Status": "pending", "phase2Status": "",
                              "phase3Status": "", "phase4Status": "", "phase5Status": "", "phase2SmsCount": "0",
                              "phase3SmsCount": "0", "createdAt": now}
    for k, v in fields.items():
        record[k] = _cell(v)
    record["id"] = "md_" + str(uuid.uuid4())[:12]
    record["transitions"] = json.dumps([MD.transition({
        "at": now, "by": by, "from": "", "to": "phase 1",
        "note": "Flow created — " + record.get("medLevel", "") + " expires " + record.get("certExpDate", "")})],
        separators=(",", ":"), ensure_ascii=False)
    RR.create(reads, RESOURCE, {h: record.get(h, "") for h in MD.HEADER}, author)
    active[key] = record["id"]
    return {**record, "transitions": json.loads(record["transitions"])}, None


def patch_flow(reads: L.Reads, flow_id: str, patch: dict[str, Any], step: dict | None, author: str) -> dict:
    """medDelPatchFlow_: the flow's cells with the patch over them (never its id or createdAt), updatedAt stamped,
    the transition appended."""
    hit = RR.find(reads, RESOURCE, flow_id)
    if hit is None:
        return {"error": {"status": 404, "message": f'No med del flow with id "{flow_id}".'}}
    key, cells = hit
    changed = {k: _cell(v) for k, v in patch.items() if k not in ("id", "createdAt")}
    changed["updatedAt"] = W.now_iso(reads)
    if step:
        was = MD.trail(MD._cell(hubdb.typed(cells.get("transitions"), "hub")))
        changed["transitions"] = json.dumps(was + [MD.transition(step)], separators=(",", ":"), ensure_ascii=False)
    RR.update(reads, RESOURCE, key, cells, changed, author)
    return {"ok": True}


# ---- the doors a person presses ---------------------------------------------------------------------------------

def seed(sess: L.Session, payload: dict) -> Decision:
    """medDelSeed: a flow for every Master certification inside the window, from the Master's own dates."""
    user = sess.user or {}
    if not MD.writer(user):
        return Decision(dict(MD.DENIED))
    reads = sess.reads
    cat = MD.catalog(reads)
    cfg = cat["settings"]
    now = MD.now_ms(reads)
    people = MD.people_by_key(reads, merged=False)
    active = actives(MD.flows(reads))
    out: dict[str, Any] = {"started": 0, "already_active": 0, "outside_window": 0, "no_dates": 0, "people": []}
    for emp in MD.master_rows(reads, cat):
        k = gsjs.name_key(emp["_displayName"])
        if not k:
            continue
        person = people.get(k)
        for level in cat["levels"]:
            ms = MD.date_ms(emp.get(cat["levelColumns"].get(level)))
            if ms is None:
                out["no_dates"] += 1
                continue
            d = MD.days(ms, now)
            if d > cfg["windowDays"] or d < -cfg["windowDays"]:
                out["outside_window"] += 1
                continue
            name = gsjs.or_text((person or {}).get("name")) or emp["_displayName"]
            _made, err = create_flow(reads, {
                "employeeId": s_(person.get("id")) if person else "", "employeeName": name, "nameKey": k,
                "medLevel": level, "certExpDate": MD.iso_day(ms),
                "phone": gsjs.or_text((person or {}).get("phone")) or gsjs.or_text(emp.get("phone_number")),
                "email": gsjs.or_text((person or {}).get("email")) or gsjs.or_text(emp.get("email"))},
                "asa-hub:seed:" + _by(user), active, _by(user))
            if err:
                out["already_active"] += 1
                continue
            out["started"] += 1
            if len(out["people"]) < 40:
                out["people"].append(name + " (" + level + ")")
    out["catalogue"] = MD.catalog_state(cat)
    return Decision({"status": 200, "data": out}, subject="", own=True)


def start(sess: L.Session, payload: dict) -> Decision:
    """medDelStart: one person's flows, from their Master row's dates — a level named is started even outside the
    window."""
    user = sess.user or {}
    if not MD.writer(user):
        return Decision(dict(MD.DENIED))
    reads = sess.reads
    p = payload if isinstance(payload, dict) else {}
    employee_id = s_(p.get("employeeId"))
    try:
        person = next((x for x in MD.people_rows(reads) if gsjs.js_str(x.get("id")) == employee_id), None)
    except Exception:  # noqa: BLE001 - as the port: an unread list finds nobody
        person = None
    if person is None:
        return W.refuse(404, f'No person with id "{employee_id}".')
    name_key = gsjs.name_key(person.get("name"))
    if not name_key:
        return W.refuse(422, "That person has no usable name key.")
    cat = MD.catalog(reads)
    master = next((e for e in MD.master_rows(reads, cat) if gsjs.name_key(e["_displayName"]) == name_key), None)
    if master is None:
        return W.refuse(404, '"' + gsjs.js_str(person.get("name")) + '" was not found on the employee Master — the cert '
                             "dates live there, and a flow without them would be invented paperwork.")
    cfg = cat["settings"]
    now = MD.now_ms(reads)
    wanted = s_(p.get("medLevel"))
    active = actives(MD.flows(reads))
    created: list[dict] = []
    refused: list[str] = []
    for level in [wanted] if wanted else cat["levels"]:
        if level not in cat["levels"]:
            refused.append(level + ": unknown med level")
            continue
        ms = MD.date_ms(master.get(cat["levelColumns"].get(level)))
        if ms is None:
            refused.append(level + ": no expiration on the Master")
            continue
        d = MD.days(ms, now)
        if not wanted and (d > cfg["windowDays"] or d < -cfg["windowDays"]):
            continue
        made, err = create_flow(reads, {
            "employeeId": employee_id, "employeeName": gsjs.or_text(person.get("name")) or master["_displayName"],
            "nameKey": name_key, "medLevel": level, "certExpDate": MD.iso_day(ms),
            "phone": s_(person.get("phone")) or gsjs.or_text(master.get("phone_number")),
            "email": s_(person.get("email")) or gsjs.or_text(master.get("email"))},
            "asa-hub:" + _by(user), active, _by(user))
        if err:
            refused.append(err["message"])
        else:
            created.append({"flowId": made["id"], "medLevel": level})
    if not created:
        return W.refuse(409, "; ".join(refused) if refused else "No " + (wanted or "Med Del") + " certification inside "
                        "the ±" + MD.num(cfg["windowDays"]) + "-day window — nothing to renew yet.")
    return Decision({"status": 200, "data": {"created": created, "refused": refused}}, subject="", own=True)


def _one(reads: L.Reads, flow_id: str) -> dict | None:
    return next((f for f in MD.flows(reads) if f.get("id") == flow_id), None)


def advance(sess: L.Session, payload: dict) -> Decision:
    """medDelAdvance: the human milestones, each refused outside its phase."""
    user = sess.user or {}
    if not MD.writer(user):
        return Decision(dict(MD.DENIED))
    reads = sess.reads
    p = payload if isinstance(payload, dict) else {}
    flow_id, milestone, note = s_(p.get("flowId")), s_(p.get("milestone")), s_(p.get("note"))
    by = "asa-hub:" + _by(user)
    now = W.now_iso(reads)
    flow = _one(reads, flow_id)
    if flow is None:
        return W.refuse(404, f'No med del flow with id "{flow_id}".')
    if flow.get("overallStatus") != "active":
        return W.refuse(409, "That flow is " + flow.get("overallStatus", "") + " — only an active flow advances.")
    n = SP.js_number(flow.get("phase"))
    phase = 1 if n != n or n == 0 else n

    def moved(patch: dict, frm: str, to: str, said: str, data: dict) -> Decision:
        patch_flow(reads, flow_id, patch, {"at": now, "by": by, "from": frm, "to": to, "note": said}, _by(user))
        return Decision({"status": 200, "data": data}, subject="", own=True)

    if milestone == "application_received":
        if phase != 2 or flow.get("phase2Status") != "employee_confirmed":
            return W.refuse(409, "The employee has not confirmed yet — the application is marked received after their "
                                 "confirmation (phase 2).")
        return moved({"phase2Status": "application_received", "phase2ReceivedDate": now[:10], "phase": "3",
                      "phase3Status": "registration_pending"}, "phase 2", "phase 3",
                     note or "Final application received — online course window opened", {"advanced": True, "phase": 3})
    if milestone == "training_complete":
        if phase != 3:
            return W.refuse(409, "That flow is not in phase 3.")
        return moved({"phase3Status": "training_complete", "phase": "4", "phase4Status": "pending"}, "phase 3",
                     "phase 4", note or "Online Relias course complete — scheduling the skills check",
                     {"advanced": True, "phase": 4})
    if milestone == "skills_scheduled":
        if phase != 4:
            return W.refuse(409, "That flow is not in phase 4.")
        ms = MD.date_ms(p.get("date"))
        if ms is None:
            return W.refuse(400, "A skills check date is required (date: yyyy-MM-dd).")
        day = MD.iso_day(ms)
        return moved({"phase4Status": "date_scheduled", "phase4ScheduledDate": day, "phase4ReminderSent": ""},
                     "phase 4", "phase 4", (note + " — " if note else "") + "Skills check scheduled for " + day,
                     {"advanced": True, "scheduled": day})
    if milestone == "skills_done":
        if phase != 4:
            return W.refuse(409, "That flow is not in phase 4.")
        ms = MD.date_ms(p.get("date"))
        day = now[:10] if ms is None else MD.iso_day(ms)
        return moved({"phase4Status": "done", "skillsDoneDate": day, "phase": "5", "phase5Status": "pending"},
                     "phase 4", "phase 5",
                     (note + " — " if note else "") + "Skills check done on " + day + " — MAIS verification follows",
                     {"advanced": True, "phase": 5})
    return W.refuse(400, f'Unknown milestone "{milestone}". Valid: application_received, training_complete, '
                         "skills_scheduled, skills_done.")


def cancel(sess: L.Session, payload: dict) -> Decision:
    """medDelCancel: an open flow cancelled with its reason; a finished renewal never is."""
    user = sess.user or {}
    if not MD.writer(user):
        return Decision(dict(MD.DENIED))
    reads = sess.reads
    p = payload if isinstance(payload, dict) else {}
    flow_id, reason = s_(p.get("flowId")), s_(p.get("reason"))
    flow = _one(reads, flow_id)
    if flow is None:
        return W.refuse(404, f'No med del flow with id "{flow_id}".')
    if flow.get("overallStatus") == "cancelled":
        return Decision({"status": 200, "data": {"cancelled": True, "already": True}}, subject="", own=True)
    if flow.get("overallStatus") == "complete":
        return W.refuse(409, "That flow is complete — a finished renewal is not cancelled.")
    patch_flow(reads, flow_id, {"overallStatus": "cancelled", "cancelReason": reason or "cancelled by " + _by(user)},
               {"at": W.now_iso(reads), "by": "asa-hub:" + _by(user), "from": "phase " + flow.get("phase", ""),
                "to": "cancelled", "note": reason or "Cancelled by hand"}, _by(user))
    return Decision({"status": 200, "data": {"cancelled": True}}, subject="", own=True)


# ---- the sweep ----------------------------------------------------------------------------------------------------

def run_task(reads: L.Reads, task: str, params: dict, ran: list[int]) -> dict[str, Any]:
    """medDelRunTask_: one task to the browser automation service; a missing property is a refusal that names it, a
    secret this server cannot read is a wait."""
    url, secret = s_(reads.db.prop("BROWSER_AUTOMATION_URL")), s_(reads.db.prop("BROWSER_AUTOMATION_BOT_SECRET"))
    if not url:
        return {"ok": False, "error": "BROWSER_AUTOMATION_URL is not set in Script Properties"}
    if not secret:
        return {"ok": False, "error": "BROWSER_AUTOMATION_BOT_SECRET is not set in Script Properties"}
    if secret.startswith(RR.WITHHELD):
        return {"ok": False, "wait": BOT_WAITS}
    if ran[0] >= 1:
        return {"ok": False, "wait": "one browser run per sweep — the next sweep runs the next one"}
    ran[0] += 1
    req = urllib.request.Request(url, data=json.dumps({"task": task, "params": params or {}}).encode(),
                                 headers={"Content-Type": "application/json", "Authorization": "Bearer " + secret},
                                 method="POST")
    try:
        with urllib.request.urlopen(req, timeout=BOT_TIMEOUT_S) as res:
            code, text = res.status, res.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        code, text = e.code, e.read().decode("utf-8", "replace")
    except Exception as e:  # noqa: BLE001 - said, as UrlFetchApp's throw
        return {"ok": False, "error": "the automation service could not be reached: " + type(e).__name__}
    try:
        body = json.loads(text)
    except ValueError:
        body = None
    if code != 200 or not isinstance(body, dict):
        return {"ok": False, "error": f"the service answered {code}: " + text[:200]}
    if body.get("ok") is False:
        return {"ok": False, "error": gsjs.or_text(body.get("error") or body.get("err") or "task failed")[:300]}
    return {"ok": True, "result": body.get("result") or {}}


def master_write_exp(reads: L.Reads, cat: dict, employee: str, level: str,
                     new_exp: str) -> tuple[dict[str, Any], dict | None]:
    """medDelMasterWriteExp_: the renewed date under the level's header on the employee Master, one cell, the row
    found by its first column — kept in app.edits."""
    header = cat["levelHeaders"].get(level)
    if not header or not new_exp:
        return {"ok": False, "error": "unknown med level or empty date"}, None
    try:
        sid = reads.db.prop(SP.CERT_SOURCE_PROP)
        ref = HT.tab_of(reads, sid, SP.cert_source_tab(reads, "master"), "the employee Master") if sid else None
        if ref is None:
            return {"ok": False, "error": "the employee Master tab could not be opened"}, None
        copy = reads.db.rows(ref)
        if not copy:
            return {"ok": False, "error": "the employee Master tab is empty"}, None
        first = ref.headers[0]
        target = gsjs.trim(employee).lower()
        at = next((i for i, (_rn, raw) in enumerate(copy)
                   if gsjs.trim(gsjs.or_blank(hubdb.estate_cell(hubdb.typed(raw.get(first), "estate")))).lower()
                   == target), None)
        if at is None:
            return {"ok": False, "error": f'no row named "{employee}" in the Master'}, None
        col = next((h for h in ref.headers if gsjs.trim(gsjs.js_str(h)) == header), None)
        if col is None:
            return {"ok": False, "error": f'the Master has no "{header}" column'}, None
        got = W.row_key_of(copy, at, [[first]])
        if got is None:
            return {"ok": False, "error": "the Master row is not told apart from another — nothing was written"}, None
        raw = copy[at][1]
        rec = W.kept_record(sid, ref.tab, "edit", got[0], got[1], "", {header: new_exp}, {header: raw.get(col)})
        return {"ok": True, "row": copy[at][0], "column": header}, rec
    except Exception as exc:  # noqa: BLE001 - said, as the port's catch
        return {"ok": False, "error": type(exc).__name__}, None


def _skills_letter(reads: L.Reads, flow: dict, cfg: dict) -> dict[str, Any]:
    """The skills check scheduling e-mail through Smart Comms (med_del_skills_check): off, the flow waits."""
    try:
        sit = SC.situation_row(SC.read_situations(reads.db), SKILLS_SITUATION)
    except Exception:  # noqa: BLE001 - an unread Desk is off
        sit = None
    if sit is None or not SC.smart_on(sit.get("enabled")) or "email" not in SC.smart_list(sit.get("channels")):
        return {"state": "off"}
    v = {"employee": flow.get("employeeName", ""), "level": flow.get("medLevel", ""),
         "address": cfg["skillsCheckAddress"], "employer": cfg["employer"]}
    subject = SC.render(sit.get("email_subject"), v) or ("Med Del Skills Check — " + v["employee"] + " ("
                                                         + v["level"] + ")")
    body = SC.render(sit.get("email_text"), v) or (
        "Hi,\n\nWe need to schedule an in-person Med Del skills check for " + v["employee"] + " (" + v["level"]
        + ").\n\nLocation: " + cfg["skillsCheckAddress"] + "\n\nPlease reply with available dates.\n\nThank you,\n"
        + cfg["employer"])
    return SC.raise_situation(None, situation=SKILLS_SITUATION, to=cfg["skillsCheckEmail"], vars=v,
                              key="meddel_skills_" + flow.get("id", ""), channel="email", subject=subject, body=body,
                              lane="med del", at_ms=int(MD.now_ms(reads)))


def sweep(sess: L.Session, by: str) -> tuple[dict[str, Any], list[dict]]:
    """medDelSweep_: new flows for the Master's certifications inside the window, then every active flow moved as its
    phase says — idempotent, each outside step guarded by the phase it leaves."""
    reads = sess.reads
    author = _by(sess.user) or by
    cat = MD.catalog(reads)
    cfg = cat["settings"]
    now = MD.now_ms(reads)
    out: dict[str, Any] = {"created": 0, "processed": 0, "cancelled": 0, "commsStamped": 0, "scrapeChecked": 0,
                           "masterUpdated": 0, "errors": [], "catalogue": MD.catalog_state(cat)}
    edits: list[dict] = []
    ran = [0]
    master = MD.master_rows(reads, cat)
    people = MD.people_by_key(reads, merged=True)
    transcripts = MD.transcript_rows(reads, cfg)
    active = actives(MD.flows(reads))

    def waits(why: str) -> None:
        if why not in out["errors"]:
            out["errors"].append(why)

    for emp in master:
        if gsjs.trim(gsjs.or_text(emp.get("status"))).lower() not in cat["activeStatuses"]:
            continue
        name_key = gsjs.name_key(emp["_displayName"])
        if not name_key:
            continue
        for level in cat["levels"]:
            ms = MD.date_ms(emp.get(cat["levelColumns"].get(level)))
            if ms is None:
                continue
            d = MD.days(ms, now)
            if d > cfg["windowDays"] or d < -cfg["windowDays"] or (name_key + "|" + level) in active:
                continue
            person = people.get(name_key)
            _made, err = create_flow(reads, {
                "employeeId": s_(person.get("id")) if person else "", "employeeName": emp["_displayName"],
                "nameKey": name_key, "medLevel": level, "certExpDate": MD.iso_day(ms),
                "phone": gsjs.or_text((person or {}).get("phone") or emp.get("phone_number")),
                "email": gsjs.or_text((person or {}).get("email") or emp.get("email"))}, by, active, author)
            if err:
                out["errors"].append(err["message"])
                continue
            out["created"] += 1

    by_name = {gsjs.or_text(e["_displayName"]).lower(): e for e in master}
    for flow in MD.flows(reads):
        if flow.get("overallStatus") != "active":
            continue
        fid = flow["id"]
        emp = by_name.get(flow.get("employeeName", "").lower())
        person = people.get(flow.get("nameKey", ""))
        phone = gsjs.or_text((person or {}).get("phone") or (emp or {}).get("phone_number") or flow.get("phone"))
        email = gsjs.or_text((person or {}).get("email") or (emp or {}).get("email") or flow.get("email"))
        first = (flow.get("employeeName", "").replace(",", " ").split() or [""])[0]
        tail = MD.phone_tail(phone)
        exp = MD.date_ms(flow.get("certExpDate"))
        to_exp = 0 if exp is None else MD.days(exp, now)
        stamp = W.now_iso(reads)

        def step(frm: str, to: str, note: str) -> dict[str, str]:
            return {"at": stamp, "by": by, "from": frm, "to": to, "note": note}

        emp_status = gsjs.trim(gsjs.or_text((emp or {}).get("status") or (person or {}).get("status"))).lower()
        if emp_status and emp_status not in cat["activeStatuses"]:
            patch_flow(reads, fid, {"overallStatus": "cancelled", "cancelReason": "employee inactive"},
                       step("phase " + flow.get("phase", ""), "cancelled",
                            "Auto-cancelled: the employee is no longer active"), author)
            out["cancelled"] += 1
            continue
        n = SP.js_number(flow.get("phase"))
        phase = 1 if n != n or n == 0 else n

        if phase == 1 and flow.get("phase1Status") == "pending":
            t1 = run_task(reads, "starkdd", MD.starkdd_params(emp or {}, flow.get("medLevel"), cfg["employer"]), ran)
            if t1.get("wait"):
                waits(t1["wait"])
                continue
            patch_flow(reads, fid, {
                "phase1Status": "done" if t1["ok"] else "error", "phase1Date": stamp[:10],
                "phase1Notes": "Auto-submitted" if t1["ok"] else "Error: " + t1["error"], "phone": phone,
                "email": email, "phase": "2", "phase2Status": "awaiting_response", "phase2LastSMS": stamp,
                "phase2SmsCount": "1", "commsStartedAt": stamp},
                step("phase 1", "phase 2", "StarkDD renewal application submitted; employee asked to sign and confirm"
                     if t1["ok"] else "StarkDD submission failed (" + t1["error"] + "); employee asked to confirm "
                                      "anyway"), author)
            out["processed"] += 1
            out["commsStamped"] += 1
            continue

        if phase == 2 and flow.get("phase2Status") == "awaiting_response":
            if to_exp < -cfg["cancelAfterDays"]:
                patch_flow(reads, fid, {"overallStatus": "cancelled", "cancelReason": "60d past expiration"},
                           step("phase 2", "cancelled", "Auto-cancelled: " + MD.num(cfg["cancelAfterDays"])
                                + " days past expiration with no confirmation"), author)
                out["cancelled"] += 1
                out["processed"] += 1
                continue
            last_ask = MD.date_ms(flow.get("commsResendAt") or flow.get("phase2LastSMS")) or 0
            if tail and MD.transcript_reply(transcripts, tail, last_ask):
                patch_flow(reads, fid, {"phase2Status": "employee_confirmed"},
                           step("phase 2", "phase 2", "The employee confirmed by message — waiting on the final "
                                                      "application"), author)
            elif MD.days(now, last_ask) >= cfg["phase2ResendDays"]:
                asks = MD._int(flow.get("phase2SmsCount")) + 1
                patch_flow(reads, fid, {"commsResendAt": stamp, "phase2LastSMS": stamp, "phase2SmsCount": str(asks)},
                           step("phase 2", "phase 2", f"Re-asked the employee to confirm ({asks}. ask)"), author)
                out["commsStamped"] += 1
            out["processed"] += 1
            continue

        if phase == 3:
            anchor = MD.date_ms(flow.get("phase2ReceivedDate")) or 0
            since = MD.days(now, anchor) if anchor else 0
            if cfg["phase3WindowStart"] <= since <= cfg["phase3WindowEnd"]:
                last = MD.date_ms(flow.get("commsReliasAt") or flow.get("phase3LastSMS")) or 0
                if MD.days(now, last) >= cfg["phase3EveryDays"]:
                    patch_flow(reads, fid, {"commsReliasAt": stamp, "phase3LastSMS": stamp,
                                            "phase3SmsCount": str(MD._int(flow.get("phase3SmsCount")) + 1)},
                               step("phase 3", "phase 3", f"Relias course reminder sent (day {since} of the window)"),
                               author)
                    out["commsStamped"] += 1
                if flow.get("phase3Status") == "registration_pending" and tail and MD.transcript_reply(
                        transcripts, tail, MD.date_ms(flow.get("phase3LastSMS")) or anchor):
                    patch_flow(reads, fid, {"phase3Status": "registration_confirmed"},
                               step("phase 3", "phase 3", "The employee confirmed starting the online course"), author)
            out["processed"] += 1
            continue

        if phase == 4:
            p4 = flow.get("phase4Status", "")
            if p4 == "pending":
                sent = _skills_letter(reads, flow, cfg)
                if sent.get("state") == "off" or (sent.get("state") == "held" and sent.get("held") == "quiet"):
                    out["processed"] += 1
                    continue
                mailed = sent.get("state") == "sent"
                patch_flow(reads, fid, {
                    "phase4Status": "email_sent", "skillsEmailSentAt": stamp if mailed else "",
                    "notes": flow.get("notes", "") + ("" if mailed else " | Skills e-mail NOT sent: "
                                                      + (gsjs.or_text(sent.get("why") or sent.get("held")) or "gated"))},
                    step("phase 4", "phase 4", "Scheduling e-mail sent to " + cfg["skillsCheckEmail"] if mailed
                         else "Scheduling e-mail could not be sent — see notes"), author)
            elif p4 == "date_scheduled":
                sched = MD.date_ms(flow.get("phase4ScheduledDate"))
                if sched is not None:
                    until = MD.days(sched, now)
                    if until in (0, 1) and flow.get("phase4ReminderSent") != "yes":
                        patch_flow(reads, fid, {"commsSkillsAt": stamp, "phase4ReminderSent": "yes"},
                                   step("phase 4", "phase 4", "Skills check reminder queued for the employee ("
                                        + ("today" if until == 0 else "tomorrow") + ")"), author)
                        out["commsStamped"] += 1
                    if until < 0:
                        patch_flow(reads, fid, {"phase4Status": "done", "phase": "5", "phase5Status": "pending"},
                                   step("phase 4", "phase 5", "The scheduled date passed — MAIS verification in "
                                        + MD.num(cfg["scrapeAfterDays"]) + " days"), author)
            out["processed"] += 1
            continue

        if phase == 5 and flow.get("phase5Status") not in ("cert_found", "cert_not_found"):
            anchor = MD.date_ms(flow.get("skillsDoneDate") or flow.get("phase4ScheduledDate")) or 0
            if anchor and MD.days(now, anchor) >= cfg["scrapeAfterDays"]:
                t5 = run_task(reads, "dodd", {
                    "first_name": gsjs.or_text((emp or {}).get("first_name") or first),
                    "last_name": gsjs.or_text((emp or {}).get("last_name")
                                              or " ".join(flow.get("employeeName", "").split()[1:]))}, ran)
                if t5.get("wait"):
                    waits(t5["wait"])
                elif not t5["ok"]:
                    patch_flow(reads, fid, {"phase5Status": "scrape_error", "phase5ScrapeDate": stamp[:10]},
                               step("phase 5", "phase 5", "MAIS scrape failed (" + t5["error"]
                                    + ") — retried on the next sweep"), author)
                else:
                    cert = MD.mais_cert(t5["result"])
                    out["scrapeChecked"] += 1
                    if cert["certFound"]:
                        write, rec = (master_write_exp(reads, cat, flow.get("employeeName", ""),
                                                       flow.get("medLevel", ""), cert["newExpDate"])
                                      if cert["newExpDate"] else ({"ok": False, "error": "no expiration in the scrape"},
                                                                  None))
                        if write["ok"]:
                            out["masterUpdated"] += 1
                            edits.append(rec)
                        held = bool(cert["newExpDate"]) and not write["ok"]
                        patch_flow(reads, fid, {
                            "phase5Status": "master_write_failed" if held else "cert_found",
                            "phase5ScrapeDate": stamp[:10], "newExpDate": cert["newExpDate"],
                            "overallStatus": "active" if held else "complete"},
                            step("phase 5", "phase 5" if held else "complete", "Certification found in MAIS"
                                 + (" — new expiration " + cert["newExpDate"] if cert["newExpDate"] else "")
                                 + ("; the Master was updated" if write["ok"] else "; Master write FAILED: "
                                    + write["error"] + (" — the flow stays open and is retried on the next sweep"
                                                        if held else ""))), author)
                    else:
                        patch_flow(reads, fid, {"phase5Status": "cert_not_found", "phase5ScrapeDate": stamp[:10],
                                                "commsScrapeAlertAt": stamp},
                                   step("phase 5", "phase 5", "No certification in MAIS "
                                        + MD.num(cfg["scrapeAfterDays"])
                                        + " days after the skills check — the team was alerted"), author)
                        out["commsStamped"] += 1
            out["processed"] += 1
    return out, edits


def daily_sweep(sess: L.Session, payload: dict) -> Decision:
    """medDelDailySweep: the relay's own identity or an admin or manager."""
    user = sess.user or {}
    if not user or (not user.get("is_service") and not MD.writer(user)):
        return Decision(dict(MD.DENIED))
    started = time.time()
    out, edits = sweep(sess, "asa-hub:" + (s_(user.get("email")) or "meddel-sweep"))
    W.log.info("med del sweep: created %s, processed %s, cancelled %s in %.2fs", out["created"], out["processed"],
               out["cancelled"], time.time() - started)
    return Decision({"status": 200, "data": out}, edits=[e for e in edits if e] or None, subject="", own=True)


# ---- the generic verbs on medDelFlows (read-only: create and delete refused, update the admin's) ----------------

def generic_create(sess: L.Session, payload: dict) -> Decision:
    return SR.create_row(sess, RESOURCE, payload)


def generic_update(sess: L.Session, payload: dict) -> Decision:
    return SR.update_row(sess, RESOURCE, payload)


def generic_delete(sess: L.Session, payload: dict) -> Decision:
    return SR.delete_row(sess, RESOURCE, payload)


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {
    "medDelSeed": seed, "medDelStart": start, "medDelAdvance": advance, "medDelCancel": cancel,
    "medDelDailySweep": daily_sweep, "medDelFlowsCreate": generic_create, "medDelFlowsUpdate": generic_update,
    "medDelFlowsDelete": generic_delete,
    "medDelFlowsUpload": RR.upload_door({RESOURCE: {"tab": MD.TAB}})}
_ROLES = ("admin", "manager")
POLICY: dict[str, dict[str, Any]] = {"medDelSeed": {"roles": _ROLES}, "medDelStart": {"roles": _ROLES},
                                     "medDelAdvance": {"roles": _ROLES}, "medDelCancel": {"roles": _ROLES},
                                     "medDelDailySweep": {}, "medDelFlowsCreate": {}, "medDelFlowsUpdate": {},
                                     "medDelFlowsDelete": {}, "medDelFlowsUpload": {}}
BUSY_OF: dict[str, dict[str, Any]] = {a: {"status": 409, "message": BUSY} for a in ACTIONS}


class Store(RR.Store):
    """app.med_del_writes and app.med_del_receipts, beside the other apps' own; the flows app.resource_rows'."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="med_del", label="Med Delegation")
