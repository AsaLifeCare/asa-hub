#!/usr/bin/env python3
"""Transportation's flow doors (app/transportation_flows.py) run through main's write path in asa-hub-db-sync with the
modules streamed in, and VehicleCalendarFlows.gs run in node over the same inputs: the request, the answer, the
withdraw and TripSave's two former hand-offs (a waiting request, a requester's cancel), step by step. Each step's answer,
the texts handed to Smart Comms (situation, number, words' values, key, person, clock), and the trips, items and log
lines it leaves are compared; what Apps Script would keep owed on a trip's told is compared with what Smart Comms'
outbox owes. The fixtures are made up (no real person); Smart Comms decides on the live brakes and situations. The
houses are the real ones (vc_inbox has no tab in the copy), the rows are the fixtures, every write lands in temporary
tables inside one transaction rolled back, a socket guard proves no connection opens. The B4 wiring
(app/transportation_writes.py, app/hubdb.py, app/main.py) is applied in memory when the tree does not carry it yet.
Prints names, counts and states only."""
from __future__ import annotations

import base64
import hashlib
import json
import py_compile
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RUNNER = "asa-hub-db-sync"

# the wiring this check runs with when the tree does not carry it yet (the patch file's blocks, each new text as the
# tree carries it: no hand-off is left, the master's settings included)
TW_PATCH = [
    ('''# why a path stays Apps Script's: what it says or starts there that a final write here could not
WHY_WAITING = ("a waiting request's row is the answer door's (My Work, Support Requests decide on the sheet): "
               "Apps Script's while it waits")
WHY_TOLD = ("cancelling a requester's trip texts them at once and posts their My Inbox item; the clock that says an "
            "owed text looks only when Apps Script lowers its stamp: Apps Script's")
WHY_ACCESS = ("who approves resolves through the accounts' e-mail rules and a text number through the shared-line "
              "list: the master's change is Apps Script's")
WAITING_HELD = "This request is still waiting on the directors — it can be changed here once they answer it."
TOLD_HELD = "Cancelling this trip texts the person who asked for it, so the directors cancel it."
''', r'''EMAIL = re.compile(r"[^@\s]+@[^@\s]+\.[^@\s]+")
'''),
    ('''def _part(name: str) -> Callable[..., Any]:
''', '''def _TF() -> Any:
    import transportation_flows as TF  # noqa: PLC0415 - the flows module imports this one
    return TF


def _part(name: str) -> Callable[..., Any]:
'''),
    ('''@handed
def trip_save(sess: L.Session, payload: dict) -> Decision:
    """vehicleCalendarTripSave: refused, kept in app.edits, or (a waiting request, a requester's cancel) Apps Script's."""
''', '''def trip_save(sess: L.Session, payload: dict) -> Decision:
    """vehicleCalendarTripSave: refused, or kept in app.edits; a requester's cancel is told through Smart Comms."""
'''),
    ('''    editor = bool(g.get("can_edit")) or by_edition
    client = s_(g.get("client"))
    # what Apps Script's own door lets this person change: the directors, the master, a holder of the client's trip
    wide = bool(g.get("can_edit")) or bool(client)
    if not editor and not client:
''', '''    editor = bool(g.get("can_edit")) or by_edition
    client = s_(g.get("client"))
    if not editor and not client:
'''),
    ('''    if t.get("state") == "requested" and status:
        return W.refuse(400, "A waiting request is approved or declined by the directors — not set here.", fresh=fresh)
    if t.get("state") == "requested":
        if not wide:
            return W.refuse(403, WAITING_HELD, fresh=fresh)
        raise Handed(WHY_WAITING)
    was = dict(t)
    warnings: list[str] = []
''', '''    if t.get("state") == "requested" and status:
        return W.refuse(400, "A waiting request is approved or declined by the directors — not set here.", fresh=fresh)
    was = dict(t)
    warnings: list[str] = []
    informed: list[tuple[dict | None, dict]] = []
'''),
    ('''    elif target == "cancelled":
        if s_(t.get("requested_by_uid")):
            if not wide:
                return W.refuse(403, TOLD_HELD, fresh=fresh)
            raise Handed(WHY_TOLD)
        t["state"], t["vehicle_id"] = "cancelled", ""
        if note is not None:
            t["assign_note"] = note
        via, said = "cancel", "Cancelled."
''', '''    elif target == "cancelled":
        t["state"], t["vehicle_id"] = "cancelled", ""
        if note is not None:
            t["assign_note"] = note
        via, said = "cancel", "Cancelled."
        if s_(t.get("requested_by_uid")):
            told = _TF().requester_cancelled(sess, g, t, was, vehicles, note)
            said, informed = told["said"], told["rows"]
            warnings += told["warnings"]
            fresh = fresh + tuple(b for b in told["books"] if b not in fresh)
'''),
    ('''    edits = [row_record(sid, tab, HEADERS["vc_trips"], trip_id, trip_id, was, t, edition),
             log_record(reads, log_row(g, trip_id, t.get("vehicle_id") or t.get("requested_vehicle_id") or "", via, a, b,
                                       note or "", stamp), trip_id, edition)]
''', '''    edits = [row_record(sid, tab, HEADERS["vc_trips"], trip_id, trip_id, was, t, edition),
             log_record(reads, log_row(g, trip_id, t.get("vehicle_id") or t.get("requested_vehicle_id") or "", via, a, b,
                                       note or "", stamp), trip_id, edition)]
    edits += _TF().inbox_records(reads, informed, trip_id, edition)
'''),
]
HUBDB_PATCH = [
    ('''        ref = next((r for r in (self.tab(sid, n) for n in names) if r is not None), None)
        virtual = getattr(OWN.get(), "virtual", None)
        if ref is None and sid and virtual is not None:
            ref = virtual(sid, names[0])
''', '''        ref = next((r for r in (self.tab(sid, n) for n in names) if r is not None), None)
        virtual = getattr(OWN.get(), "virtual", None)
        if ref is None and sid and virtual is not None:
            # rows Python appended before any copy of the tab: under the name the house keeps them in (its Data tab)
            ref = next((r for r in (virtual(sid, n) for n in names) if r is not None), None)
'''),
]


def wired(src: str, pairs: list[tuple[str, str]], label: str) -> tuple[str, str]:
    """The source with the wiring, and how it came to carry it."""
    if all(new in src for _old, new in pairs):
        return src, f"{label}: the tree carries the wiring"
    for old, new in pairs:
        if src.count(old) != 1:
            raise SystemExit(f"FAIL {label}: a wiring block does not apply once ({old.splitlines()[0][:70]}…)")
        src = src.replace(old, new)
    return src, f"{label}: wiring applied in memory"


# ---- the made-up subjects: nobody real -------------------------------------------------------------------------------

def users() -> dict[str, dict]:
    def u(uid: str, name: str, email: str, role: str, phone: str = "", phones: str = "") -> dict:
        return {"userid": uid, "displayname": name, "email": email, "role": role, "active": "TRUE", "phone": phone,
                "phones": phones, "mergedinto": "", "clientkey": "", "hometenant": "", "types": "", "appdenials": ""}
    return {"M": u("USR_TRF_M", "Check Master", "@MASTER", "admin"),
            "D1": u("USR_TRF_D1", "Check Director One", "dir1@check.invalid", "director", "(216) 555-0101"),
            "D2": u("USR_TRF_D2", "Check Director Two", "dir2@check.invalid", "director", "216-555-0102"),
            "R": u("USR_TRF_R", "Check Requester", "req@check.invalid", "staff", "+1 216 555 0103"),
            "S": u("USR_TRF_S", "Check Staff", "staff@check.invalid", "staff"),
            "Q": u("USR_TRF_Q", "Check Quiet", "q@check.invalid", "staff", "", '[{"label":"Cell","number":"2165550105"}]'),
            "X": u("USR_TRF_X", "Check Closed", "x@check.invalid", "staff", "216 555 0106")}


VC_HEADERS = {
    "vc_vehicles": ("id", "name", "description", "seats", "wheelchair_accessible", "availability", "aliases", "tint",
                    "order", "note", "created_at", "updated_at", "updated_by"),
    "vc_trips": ("id", "state", "vehicle_id", "requested_vehicle_id", "start_at", "end_at", "day", "end_known",
                 "wheelchair_required", "trip_type", "purpose", "destination", "details", "client_key", "client_name",
                 "staff_key", "staff_uid", "staff_name", "driver_key", "driver_uid", "driver_name", "requested_by_uid",
                 "requested_by_name", "decided_by_uid", "decided_by_name", "decided_at", "decision_note", "assign_note",
                 "appointment_ref", "source", "source_ref", "told", "test_mode", "created_at", "created_by",
                 "updated_at", "updated_by"),
    "vc_inbox": ("id", "trip_id", "box", "kind", "seat", "to_uid", "to_email", "to_name", "title", "body", "facts",
                 "date", "when", "state", "answered_by", "answered_at", "note", "link", "test_mode", "created_at"),
    "vc_log": ("id", "at", "by_uid", "by_name", "trip_id", "vehicle_id", "via", "was", "now", "note"),
    "vc_settings": ("key", "value", "note", "updated_at", "updated_by"),
}
VAN, CAR, BUS = "VV00000000A1", "VV00000000A2", "VV00000000A3"


def row(tab: str, **cells: str) -> dict[str, str]:
    out = {h: "" for h in VC_HEADERS[tab]}
    out.update(cells)
    return out


def trip(tid: str, state: str, vehicle: str, start: str, end: str, staff: str, staff_uid: str, staff_name: str,
         by: dict | None = None, told: str = "{}") -> dict[str, str]:
    return row("vc_trips", id=tid, state=state, vehicle_id=vehicle if state == "scheduled" else "",
               requested_vehicle_id=vehicle, start_at=start, end_at=end, day=start[:10], end_known="yes",
               wheelchair_required="no", trip_type="Work", purpose="Work", staff_key=staff, staff_uid=staff_uid,
               staff_name=staff_name, driver_key=staff, driver_uid=staff_uid, driver_name=staff_name,
               requested_by_uid=(by or {}).get("userid", ""), requested_by_name=(by or {}).get("displayname", ""),
               source="platform", told=told, test_mode="yes", created_at="2026-10-01T12:00:00.000Z",
               created_by="USR_TRF_M", updated_at="2026-10-01T12:00:00.000Z", updated_by="USR_TRF_M")


def sha10(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:10].upper()


def fixtures(apps_script_born: bool) -> dict:
    U = users()
    tabs = {
        "vc_vehicles": [row("vc_vehicles", id=VAN, name="Van", description="Check van", seats="6",
                            wheelchair_accessible="yes", availability="available", aliases="Van", tint="blue", order="1"),
                        row("vc_vehicles", id=CAR, name="Car", description="Check car", seats="5",
                            wheelchair_accessible="no", availability="available", aliases="Car", tint="mint", order="2"),
                        row("vc_vehicles", id=BUS, name="Bus", description="Check bus", seats="12",
                            wheelchair_accessible="yes", availability="maintenance", aliases="Bus", tint="peach",
                            order="3")],
        "vc_trips": [trip("VT0000000F01", "scheduled", CAR, "2026-10-15T10:00:00-04:00", "2026-10-15T11:00:00-04:00",
                          "checkother", "", "Check Other"),
                     trip("VT0000000F02", "scheduled", VAN, "2026-10-19T09:00:00-04:00", "2026-10-19T10:00:00-04:00",
                          "checkstaff", U["S"]["userid"], "Check Staff", U["R"])],
        "vc_settings": [row("vc_settings", key="directors", value="dir1@check.invalid, dir2@check.invalid"),
                        row("vc_settings", key="trip_types", value='["Doctor appointment","Work","Other"]'),
                        row("vc_settings", key="text_to", value='{"USR_TRF_D2":"216 555 0112"}'),
                        row("vc_settings", key="import_minutes", value="120")],
        "vc_log": [],
        "vc_inbox": [],
    }
    if apps_script_born:
        def owed(tid: str, d: str) -> dict:
            return {"sit": "transport_request_ask", "bucket": "ask", "uid": U[d]["userid"], "name": U[d]["displayname"],
                    "key": f"vc|transport_request_ask|{tid}|{U[d]['userid']}", "vars": {"vehicle": "Van"},
                    "while": "requested"}
        held = {"state": "held", "held": "quiet", "why": "inside the quiet window — owed at 08:00",
                "at": "2026-10-14T02:00:00.000Z"}
        for tid, veh, start, by in (("VT0000000F03", VAN, "2026-10-23", "R"), ("VT0000000F04", CAR, "2026-10-24", "Q")):
            told = {"owed": [owed(tid, "D1"), owed(tid, "D2")],
                    "ask": {U["D1"]["userid"]: held, U["D2"]["userid"]: held}}
            tabs["vc_trips"].append(trip(tid, "requested", veh, start + "T09:00:00-04:00", start + "T10:00:00-04:00",
                                         "checkstaff", U["S"]["userid"], "Check Staff", U[by],
                                         json.dumps(told, separators=(",", ":"))))
            for d in ("D1", "D2"):
                tabs["vc_inbox"].append(row(
                    "vc_inbox", id="VI" + sha10(f"{tid}|work|approval|{U[d]['userid']}"), trip_id=tid, box="work",
                    kind="approval", seat="director", to_uid=U[d]["userid"], to_email=U[d]["email"],
                    to_name=U[d]["displayname"], title="Vehicle request — " + U[by]["displayname"],
                    body="Check · request", facts="[]", date=start, when="Check when", state="waiting",
                    link="/app/my-work", test_mode="yes", created_at="2026-10-14T02:00:00.000Z"))
    return {"tabs": tabs, "users": U, "closed": [U["X"]["userid"]],
            "roster": [{"client_key": "check-client", "name": "Check Client"}]}


DAY = "2026-10-14T18:00:00.000Z"      # 14:00 New York
NIGHT = "2026-10-15T02:30:00.000Z"    # 22:30 New York


def req(who: str, vehicle: str, start: str, end: str, **kw: object) -> dict:
    p = {"vehicle_id": vehicle, "staff_key": kw.pop("staff", "checkstaff"), "start": start, "end": end,
         "trip_type": kw.pop("trip_type", "Doctor appointment"), "details": kw.pop("details", "Check details"),
         "wheelchair_required": kw.pop("wheelchair", False)}
    p.update(kw)
    return {"action": "vehicleCalendarRequest", "who": who, "payload": p}


def ans(who: str, trip_step: str, seat: str, word: str, note: str = "") -> dict:
    p = {"item_id": f"$item:{trip_step}:{seat}", "word": word}
    if note:
        p["note"] = note
    return {"action": "vehicleCalendarAnswer", "who": who, "payload": p}


def wd(who: str, trip_step: str) -> dict:
    """A step's own trip, or (=VT…) a fixture's."""
    tid = trip_step[1:] if trip_step.startswith("=") else f"$trip:{trip_step}"
    return {"action": "vehicleCalendarWithdraw", "who": who, "payload": {"trip_id": tid}}


def save(who: str, trip_ref: str, **p: object) -> dict:
    return {"action": "vehicleCalendarTripSave", "who": who, "payload": {"trip_id": trip_ref, **p}}


def steps_live() -> list[dict]:
    """The flows on houses no copy holds a vc_inbox tab of (as today): each item Python's own append."""
    s = [
        ("req1", req("R", VAN, "2026-10-15T10:00", "2026-10-15T12:00", wheelchair=True, details="Check  details\nline")),
        ("ans1_not_theirs", ans("R", "req1", "D1", "approve")),
        ("ans1", ans("D1", "req1", "D1", "approve")),
        ("ans1_late", ans("D2", "req1", "D2", "decline")),
        ("rq_booked", req("R", CAR, "2026-10-15T10:30", "2026-10-15T11:30")),
        ("rq_mine", req("R", CAR, "2026-10-15T11:00", "2026-10-15T11:30")),
        ("req3", req("R", CAR, "2026-10-16T09:00", "2026-10-16T10:00", client_key="check-client")),
        ("wd3_not_theirs", wd("D1", "req3")),
        ("wd3", wd("R", "req3")),
        ("ans3_late", ans("D2", "req3", "D2", "approve")),
        ("req4", req("D1", VAN, "2026-10-17T13:00", "2026-10-17T14:00", trip_type="Work")),
        ("ans4_not_theirs", ans("D1", "req4", "D2", "approve")),
        ("ans4_master", ans("M", "req4", "D2", "decline", "Check  note")),
        ("req6", req("R", VAN, "2026-10-18T09:00", "2026-10-18T10:00")),
        ("req7", req("Q", VAN, "2026-10-18T09:30", "2026-10-18T10:30", staff="checkquiet")),
        ("ans6", ans("D1", "req6", "D1", "approve")),
        ("ans7", ans("D2", "req7", "D2", "approve")),
        ("wd6_scheduled", wd("R", "req6")),
        ("rq_vehicle", req("R", "VV9999999999", "2026-10-20T09:00", "2026-10-20T10:00")),
        ("rq_staff", req("R", CAR, "2026-10-20T09:00", "2026-10-20T10:00", staff="nobody")),
        ("rq_type", req("R", CAR, "2026-10-20T09:00", "2026-10-20T10:00", trip_type="Spaceflight")),
        ("rq_start", req("R", CAR, "2026-13-01T09:00", "2026-10-20T10:00")),
        ("rq_gap", req("R", CAR, "2027-03-14T02:30", "2027-03-14T04:00")),
        ("rq_order", req("R", CAR, "2026-10-20T10:00", "2026-10-20T09:00")),
        ("rq_long", req("R", CAR, "2026-10-20T09:00", "2026-11-05T09:00")),
        ("rq_past", req("R", CAR, "2026-10-14T10:00", "2026-10-14T11:00")),
        ("rq_maint", req("R", BUS, "2026-10-20T09:00", "2026-10-20T10:00")),
        ("rq_wheel", req("R", CAR, "2026-10-20T09:00", "2026-10-20T10:00", wheelchair=True)),
        ("rq_client", req("R", CAR, "2026-10-20T09:00", "2026-10-20T10:00", client_key="nope")),
        ("rq_details", req("R", CAR, "2026-10-20T09:00", "2026-10-20T10:00", details="x" * 1001)),
        ("rq_closed", req("X", CAR, "2026-10-20T09:00", "2026-10-20T10:00")),
        ("ans_bad_id", {"action": "vehicleCalendarAnswer", "who": "D1", "payload": {"item_id": "VIX", "word": "approve"}}),
        ("ans_bad_word", ans("D1", "req1", "D1", "maybe")),
        ("ans_long_note", ans("D1", "req1", "D1", "approve", "n" * 501)),
        ("wd_bad_id", {"action": "vehicleCalendarWithdraw", "who": "R", "payload": {"trip_id": "VTX"}}),
        ("wd_gone", {"action": "vehicleCalendarWithdraw", "who": "R", "payload": {"trip_id": "VT0000000BAD"}}),
        ("req9_night", req("R", CAR, "2026-10-20T09:00", "2026-10-20T10:00")),
        ("wd9_night", wd("R", "req9_night")),
        ("req10_night", req("R", CAR, "2026-10-21T09:00", "2026-10-21T10:00")),
        ("ans10_night", ans("D1", "req10_night", "D1", "approve")),
        ("cancel_f02", save("D1", "VT0000000F02", status="cancelled", note="Check cancel note")),
        ("cancel_req1", save("D2", "$trip:req1", status="cancelled")),
        ("req11", req("R", CAR, "2026-10-22T09:00", "2026-10-22T10:00")),
        ("edit11", save("D1", "$trip:req11", purpose="Check purpose", note="Check assign note", vehicle_id=VAN)),
        ("status11", save("D1", "$trip:req11", status="scheduled")),
        ("ans11", ans("D2", "req11", "D2", "approve")),
        ("req12", req("R", CAR, "2026-10-26T09:00", "2026-10-26T10:00")),
    ]
    out = []
    for name, st in s:
        out.append({"name": name, "at": NIGHT if name.endswith("_night") else DAY, **st})
    return out


def steps_born() -> list[dict]:
    """The flows over items Apps Script wrote and the keeper copied, its trips owing their asks on told.owed."""
    s = [
        ("ans_f03", ans("D2", "=VT0000000F03", "D2", "approve")),
        ("wd_f04", wd("Q", "=VT0000000F04")),
        ("req_b", req("R", CAR, "2026-10-25T09:00", "2026-10-25T10:00")),
        ("ans_f03_late", ans("D1", "=VT0000000F03", "D1", "decline")),
        ("ans_b", ans("D1", "req_b", "D1", "decline", "Check note")),
    ]
    return [{"name": n, "at": DAY, **st} for n, st in s]


def ids(prefix: str, base: int) -> list[str]:
    return [f"{prefix}{base + i:010X}" for i in range(60)]


DRIVER = r'''
import base64, contextlib, importlib.abc, importlib.util, json, os, re, socket, sys, time, types, uuid
from datetime import datetime, timezone
blob = json.loads(base64.b64decode(sys.stdin.readline()).decode())
SRC = blob["app"]


class Checkout(importlib.abc.MetaPathFinder, importlib.abc.Loader):
    def find_spec(self, name, path, target=None):
        return importlib.util.spec_from_loader(name, self, origin="checkout:" + name) if name in SRC else None

    def create_module(self, spec):
        return None

    def exec_module(self, module):
        module.__file__ = module.__name__ + ".py"
        exec(compile(SRC[module.__name__], module.__name__ + ".py", "exec"), module.__dict__)


sys.meta_path.insert(0, Checkout())
os.environ.pop("HUB_SMART_COMMS_KEY_FILE", None)
fake = types.ModuleType("fastapi")


class Resp:
    def __init__(self, content=b"", status_code=200, media_type="", headers=None):
        self.body = content if isinstance(content, (bytes, str)) else json.dumps(content)
        self.status_code, self.headers = status_code, dict(headers or {})


class App:
    def __init__(self, **_kw):
        pass

    def _route(self, *_a, **_kw):
        return lambda fn: fn
    get = post = _route


fake.FastAPI, fake.Request = App, object
responses = types.ModuleType("fastapi.responses")
responses.JSONResponse = lambda content, status_code=200, headers=None: Resp(content, status_code, "", headers)
responses.Response = Resp
conc = types.ModuleType("starlette.concurrency")


async def run_in_threadpool(fn, *a, **kw):
    return fn(*a, **kw)
conc.run_in_threadpool = run_in_threadpool
sys.modules.update({"fastapi": fake, "fastapi.responses": responses, "starlette": types.ModuleType("starlette"),
                    "starlette.concurrency": conc})

import psycopg
import gsjs, hubdb, scope as sc, locations as L, writes as W, client_writes as CW
import smart_comms as SC
import transportation as TR, transportation_writes as TW, transportation_flows as TF
import my_work as MW
import main as M

out, facts, runs_out = [], {}, []


def check(name, ok, detail=""):
    out.append([name, bool(ok), "" if ok else str(detail)[:400]])


# the stores and the locks the check's own: nothing it holds can stall a live write
SC.OUTBOX, SC.ARM = "pg_temp.trf_outbox", "pg_temp.trf_arm"
W.EDITS_TABLE = "pg_temp.trf_edits"
W.LOCK_KEY = 0x5452464C4F43
SC.DRAIN_LOCK = 0x545246445241
# main.py's wiring for the flows (the patch file's section 3)
TW.ACTIONS.update(TF.ACTIONS)
TW.POLICY.update(TF.POLICY)
TW.BUSY_OF.update(TF.BUSY_OF)


def rw(sql):
    return sql.replace("app.trfc_", "pg_temp.trfc_") if isinstance(sql, str) else sql


class Cur:
    def __init__(self, cur):
        self.c = cur

    def execute(self, sql, params=None):
        self.c.execute(rw(sql), params)
        return self

    def executemany(self, sql, rows):
        self.c.executemany(rw(sql), rows)
        return self

    def fetchone(self):
        return self.c.fetchone()

    def fetchall(self):
        return self.c.fetchall()

    @property
    def rowcount(self):
        return self.c.rowcount

    @property
    def description(self):
        return self.c.description


class Conn:
    def __init__(self, real):
        self.real = real

    @property
    def closed(self):
        return self.real.closed

    @property
    def broken(self):
        return self.real.broken

    def execute(self, sql, params=None):
        return Cur(self.real.cursor()).execute(sql, params)

    def cursor(self):
        return Cur(self.real.cursor())

    def transaction(self):
        return self.real.transaction()

    def close(self):
        pass


CURRENT = {"wid": "", "action": ""}


class CheckStore(W.Store):
    """main's write store, the door's decision under smart_comms.deciding as main.py names it."""

    @contextlib.contextmanager
    def locked(self):
        with super().locked() as tx:
            with SC.deciding(tx, CURRENT["wid"], CURRENT["action"]):
                yield tx


db = hubdb.HubDb()
db.catalog()
db.facts()
real = psycopg.connect(hubdb._dsn(), autocommit=False, connect_timeout=5, application_name="transportation-flows-check")
proxy = Conn(real)
store = CheckStore(connect=lambda: proxy, kind="trfc", label="Check")
facts["wiring"] = blob["wiring"]

# ---- the socket guard, armed once every connection is open ----
OPENED = []
_orig = (socket.socket.connect, socket.socket.connect_ex, socket.create_connection, socket.getaddrinfo)


def _refuse(kind):
    def f(*a, **kw):
        OPENED.append(kind)
        raise OSError("the check opens no connection")
    return f


socket.socket.connect = _refuse("connect")
socket.socket.connect_ex = _refuse("connect_ex")
socket.create_connection = _refuse("create_connection")
socket.getaddrinfo = _refuse("getaddrinfo")
try:
    socket.create_connection(("127.0.0.1", 9), timeout=1)
except OSError:
    pass
check("the socket guard refuses and records an attempt", OPENED == ["create_connection"], OPENED)
OPENED.clear()
SENT = []
SC.TRANSPORT = lambda *a, **kw: SENT.append(1) or {"ok": False, "error": "the check sends nothing"}

# ---- the real houses, the made-up rows ----
HOUSES = {}
for tab in ("vc_vehicles", "vc_trips", "vc_settings", "vc_log", "vc_inbox"):
    res = db.resolve(tab)
    HOUSES[tab] = {"sid": res.sheet_id, "tab": res.ref.tab if res.ref is not None else "", "declared": res.declared_house}
facts["houses"] = ", ".join(f"{t}: {'declared' if h['declared'] else 'NOT declared'}, copy tab {h['tab'] or 'none'}"
                            for t, h in HOUSES.items())
check("vc_inbox is a declared house the copy holds no tab of (the live leaf)",
      HOUSES["vc_inbox"]["declared"] and not HOUSES["vc_inbox"]["tab"], facts["houses"])
check("the other four houses are copied as their Data tab", all(HOUSES[t]["tab"] == "Data" for t in
                                                                 ("vc_vehicles", "vc_trips", "vc_settings", "vc_log")))
INBOX_SID = HOUSES["vc_inbox"]["sid"]
FIX = {}
RUN = {"born": False}
real_rows, real_tab = db.rows, db.tab
FAKE_INBOX = hubdb.TabRef(INBOX_SID, "Data", "trf_fake_inbox", tuple(TF.INBOX_HEADER), None, 4)


def rows(ref):
    key = (ref.sheet_id, ref.tab)
    if key in FIX:
        got = [(i + 2, dict(r)) for i, r in enumerate(FIX[key])]
        own = hubdb.OWN.get()
        return own.merge(ref, got) if own is not None else got
    return real_rows(ref)


def tab(sid, name):
    if RUN["born"] and (sid, name) == (INBOX_SID, "Data"):
        own = hubdb.OWN.get()
        return own.widen(FAKE_INBOX) if own is not None else FAKE_INBOX
    return real_tab(sid, name)


db.rows, db.tab = rows, tab
db.stale = lambda books: False
SC.bind(db)
M.DB = db
M.stores = lambda: {"transportation": store}
M.WRITES["transportation"] = TW
M.WRITE_BUDGET_S = 600.0
USERS = []
CLOCK = {"dt": datetime.now(timezone.utc)}
L.Reads.users = lambda self: self.once("users", lambda: [dict(u) for u in USERS])
_init = L.Reads.__init__


def _reads_init(self, db_, drive=None, now=None):
    _init(self, db_, drive, now or CLOCK["dt"])


L.Reads.__init__ = _reads_init
CLOSED = set()
base_gate = sc.profile_app_gate


def gate(app_id, user, src):
    uid = gsjs.str_((user or {}).get("id"))
    if uid and uid in CLOSED:
        return {"open": False, "scope": sc.scope_of("none", "closed by the check")}
    if uid.startswith("USR_TRF_"):
        return {"open": True, "scope": sc.scope_of("all")}
    return base_gate(app_id, user, src)


sc.profile_app_gate = gate
ROSTER = {"rows": []}
TR.clients = lambda reads: {"readable": True, "why": "", "rows": [dict(r) for r in ROSTER["rows"]]}
IDS = {}
_new_id = TW.new_id


def new_id(prefix):
    q = IDS.get(prefix)
    return q.pop(0) if q else _new_id(prefix)


TW.new_id = new_id
ASKS = []
_raise = SC.raise_situation


def raise_rec(tx_or_conn, **kw):
    kw.setdefault("now", CLOCK["dt"].timestamp())
    res = _raise(tx_or_conn, **kw)
    ASKS.append({"ask": {k: kw.get(k) for k in ("situation", "to", "vars", "key", "person", "lane", "at_ms", "prune")},
                 "res": res})
    return res


SC.raise_situation = raise_rec


def q(sql, params=None):
    with real.cursor() as c:
        c.execute(sql, params)
        return c.fetchall() if c.description else []


def own_now():
    return CW.Own([], book=db.book, edits=store.edits(), edits_at=time.time())


def state():
    tok = hubdb.OWN.set(own_now())
    try:
        reads = L.Reads(db, None)
        return {"trips": TW.tab_rows(reads, "vc_trips"), "inbox": TF.inbox_rows(reads),
                "log": TW.tab_rows(reads, "vc_log")}
    finally:
        hubdb.OWN.reset(tok)


def owed_keys():
    return sorted(k for (k,) in q(f"select idem_key from {SC.OUTBOX} where state = 'owed'"))


def resolve(v, done, U):
    if not isinstance(v, str):
        return v
    m = re.fullmatch(r"\$trip:(\w+)", v)
    if m:
        return done.get(m.group(1), "")
    m = re.fullmatch(r"\$item:([=\w]+):(\w+)", v)
    if m:
        tid = m.group(1)[1:] if m.group(1).startswith("=") else done.get(m.group(1), "")
        return "VI" + TF.sha10(f"{tid}|work|approval|{U[m.group(2)]['userid']}")
    return v


def run(spec):
    """One run: the fixtures laid, every step through main's write path, what each left behind."""
    fx = spec["fixtures"]
    U = {k: {**u, "email": sc.MASTER_ACCOUNT if u["email"] == "@MASTER" else u["email"]} for k, u in fx["users"].items()}
    USERS[:] = list(U.values())
    CLOSED.clear()
    CLOSED.update(fx["closed"])
    ROSTER["rows"] = [{"key": r["client_key"], "name": r["name"]} for r in fx["roster"]]
    FIX.clear()
    for t in ("vc_vehicles", "vc_trips", "vc_settings", "vc_log"):
        FIX[(HOUSES[t]["sid"], HOUSES[t]["tab"])] = fx["tabs"][t]
    RUN["born"] = spec["born"]
    if spec["born"]:
        FIX[(INBOX_SID, "Data")] = fx["tabs"]["vc_inbox"]
    IDS.clear()
    IDS.update({k: list(v) for k, v in spec["ids"].items()})
    done, steps = {}, []
    for st in spec["steps"]:
        CLOCK["dt"] = datetime.fromisoformat(st["at"].replace("Z", "+00:00"))
        payload = {k: resolve(v, done, U) for k, v in st["payload"].items()}
        who = U[st["who"]]
        said = {"uid": who["userid"], "role": who["role"], "is_master": who["email"] == sc.MASTER_ACCOUNT}
        wid = f"Wcheck-trf-{st['name']}-{uuid.uuid4().hex[:8]}"
        CURRENT.update({"wid": wid, "action": st["action"]})
        n_asks = len(ASKS)
        res = M._run_write(TW, st["action"], said, payload, wid)
        env = json.loads(res.body)
        plan = env.pop("_write", None) or {}
        if st["action"] == "vehicleCalendarRequest" and env.get("status") == 200:
            done[st["name"]] = env["data"]["trip_id"]
        cells = q(f"select tab_name, kind, match_by, row_key, field, value from {W.EDITS_TABLE} where write_id = %s"
                  " order by id", (wid,))
        steps.append({"name": st["name"], "action": st["action"], "at": st["at"], "payload": payload,
                      "user": sc.user_from_row(who), "code": res.status_code, "env": env, "plan": plan,
                      "asks": [a["ask"] for a in ASKS[n_asks:]], "outcomes": {a["ask"]["key"]: a["res"] for a in ASKS[n_asks:]},
                      "cells": [list(c) for c in cells], "owed": owed_keys(), "state": state()})
    return {"name": spec["name"], "steps": steps, "users": U, "fixtures": fx, "done": done}


def checks_live(r):
    steps = {s["name"]: s for s in r["steps"]}
    inbox_tab = HOUSES["vc_inbox"]
    req1 = steps["req1"]
    check("a request is final in Postgres (plan final, 200)", req1["env"].get("status") == 200 and req1["plan"].get("final"),
          req1["env"])
    check("a request raises one text per director, only through raise_situation, under 'vc|<sit>|<trip>|<uid>'",
          [a["key"] for a in req1["asks"]] == [f"vc|transport_request_ask|{r['done']['req1']}|{r['users'][d]['userid']}"
                                              for d in ("D1", "D2")] and all(a["lane"] == "transportation"
                                                                             for a in req1["asks"]), req1["asks"])
    items = [c for c in req1["cells"] if c[3].startswith("VI")]
    check("its items land in the inbox house's Data tab (never a tab named vc_inbox), appended whole",
          items and all(c[0] == "Data" and c[1] == "append" and c[2] == "id" for c in items)
          and {c[4] for c in items} == set(TF.INBOX_HEADER), sorted({(c[0], c[1]) for c in items}))
    tok = hubdb.OWN.set(own_now())
    try:
        own = hubdb.OWN.get()
        check("the house's own name finds nothing of Python's (the leaf hubdb.resolve's wiring fixes)",
              own.virtual(INBOX_SID, "vc_inbox") is None and own.virtual(INBOX_SID, "Data") is not None)
        reads = L.Reads(db, None)
        mw_rows, total, _at = MW.HubBooks(reads).tab(INBOX_SID, "Data")
        waiting = [x for x in mw_rows if x.get("box") == "work" and x.get("state") == "waiting"
                   and x.get("trip_id") == r["done"]["req12"]]
        check("My Work's reader sees a waiting request's items at once, before any copy of the tab",
              len(waiting) == 2, f"{len(waiting)} of {total}")
        base = TR.build_base(reads)
        check("the Transportation board sees them too (hubdb wiring)",
              sum(1 for w in base["waiting"] if w["trip_id"] == r["done"]["req12"]) == 2, len(base["waiting"]))
    finally:
        hubdb.OWN.reset(tok)
    told_cells = q(f"select value from {W.EDITS_TABLE} where tab_name = 'Data' and field = 'told' and sheet_id = %s",
                   (HOUSES["vc_trips"]["sid"],))
    bad = [v for (v,) in told_cells if isinstance(json.loads(v or "{}"), dict) and json.loads(v or "{}").get("owed")]
    check("no trip row Python keeps ever carries an owed text on told (Apps Script's clock has nothing to say)",
          told_cells and not bad, f"{len(bad)} of {len(told_cells)}")
    night = steps["req9_night"]
    check("at night the asks are held quiet and owed in Smart Comms' outbox, never on told",
          all(o["held"] == "quiet" for o in night["outcomes"].values()) and len(night["owed"]) >= 2, night["owed"])
    check("a withdraw at night withdraws the owed asks (cancelled, not sent)",
          not any(k.startswith(f"vc|transport_request_ask|{r['done']['req9_night']}|") for k in steps["wd9_night"]["owed"]))
    a10 = steps["ans10_night"]
    check("an answer withdraws the request's owed asks and owes the requester's text for 08:00",
          a10["owed"] and all(not k.startswith(f"vc|transport_request_ask|{r['done']['req10_night']}|") for k in a10["owed"])
          and f"vc|transport_request_decided|{r['done']['req10_night']}|{r['users']['R']['userid']}" in a10["owed"],
          a10["owed"])
    c2 = steps["cancel_f02"]
    check("cancelling a requester's trip from TripSave is final, texts them through Smart Comms, posts their item",
          c2["env"].get("status") == 200 and c2["plan"].get("final") and [a["situation"] for a in c2["asks"]] ==
          ["transport_trip_cancelled"] and any(c[3].startswith("VI") and c[0] == "Data" for c in c2["cells"]), c2["env"])
    e11 = steps["edit11"]
    check("editing a waiting request from TripSave is final and texts nobody",
          e11["env"].get("status") == 200 and e11["plan"].get("final") and not e11["asks"], e11["env"])
    states = dict(q(f"select state, count(*) from {SC.OUTBOX} group by state"))
    facts["outbox after the live run"] = ", ".join(f"{k} {v}" for k, v in sorted(states.items()))
    check("nothing left the outbox: no row sending or sent", not states.get("sending") and not states.get("sent"),
          states)
    by_sit = {}
    for s in r["steps"]:
        for k, o in s["outcomes"].items():
            by_sit.setdefault(k.split("|")[1], set()).add(f"{o['state']}/{o['held'] or '-'}")
    facts["outcomes by situation"] = "; ".join(f"{k}: {', '.join(sorted(v))}" for k, v in sorted(by_sit.items()))
    proof = q(f"select tab_name, count(distinct row_key) from {W.EDITS_TABLE} where app = 'smart-comms'"
              " group by tab_name order by tab_name")
    facts["proof rows Smart Comms appended (temp)"] = ", ".join(f"{t} {n}" for t, n in proof) or "none"


def checks_born(r):
    steps = {s["name"]: s for s in r["steps"]}
    a = steps["ans_f03"]
    edits = [c for c in a["cells"] if c[3].startswith("VI")]
    check("over items the keeper copied, the answer edits them in place (no append), in the Data tab",
          edits and all(c[0] == "Data" and c[1] == "edit" for c in edits if c[3] != "VI" + TF.sha10(
              f"VT0000000F03|inbox|info|{r['users']['R']['userid']}")), sorted({(c[0], c[1]) for c in edits}))
    told = next(json.loads(c[5]) for c in a["cells"] if c[4] == "told")
    check("Apps Script's owed asks on told are dropped as Apps Script drops them, nothing added",
          told.get("owed") == [] and "decided" in told, list(told))
    w = steps["wd_f04"]
    told = next((json.loads(c[5]) for c in w["cells"] if c[4] == "told"), {})
    check("withdrawing a request Apps Script made: its items closed in place, its owed asks dropped from told",
          w["env"].get("status") == 200 and told.get("owed") == [] and
          sum(1 for c in w["cells"] if c[3].startswith("VI") and c[1] == "edit" and c[4] == "state") == 2, w["env"])


def outside():
    """A door that would text, called with no write being decided: Apps Script answers."""
    U = runs_out[0]["users"]
    tok = hubdb.OWN.set(own_now())
    try:
        reads = L.Reads(db, None)
        sess = L.Session(reads, sc.user_from_row(U["R"]))
        try:
            TF.request(sess, {"vehicle_id": blob["van"], "staff_key": "checkstaff", "start": "2026-11-02T09:00",
                              "end": "2026-11-02T10:00", "trip_type": "Work"})
            check("outside smart_comms.deciding a texting door defers", False, "it answered")
        except sc.Defer as exc:
            check("outside smart_comms.deciding a texting door defers, so a text is never lost",
                  "Smart Comms is not deciding" in str(exc), str(exc))
    finally:
        hubdb.OWN.reset(tok)


try:
    with real.transaction():
        why = SC.ensure(proxy)
        check("the outbox, the arm and app.edits are made in temp tables", why == "", why)
        store.ensure()
        check("the write store is made in temp tables", store.ready(), store.why)
        for spec in blob["runs"]:
            try:
                with real.transaction():
                    got = run(spec)
                    runs_out.append(got)
                    (checks_live if not spec["born"] else checks_born)(got)
                    if not spec["born"]:
                        outside()
                    raise psycopg.Rollback()
            except psycopg.Rollback:
                pass
            except Exception as exc:  # noqa: BLE001 - said as a failed check, never a value
                import traceback
                check(f"run {spec['name']} ran to the end", False, type(exc).__name__ + ": " + str(exc)[:200] +
                      " @ " + traceback.format_exc()[-600:])
        check("no message reached a transport", not SENT, len(SENT))
        raise psycopg.Rollback()
except psycopg.Rollback:
    pass
finally:
    socket.socket.connect, socket.socket.connect_ex, socket.create_connection, socket.getaddrinfo = _orig
    try:
        real.close()
    except Exception:
        pass
check("the socket guard saw no connection attempt during the run", not OPENED, OPENED)
print(json.dumps({"checks": out, "facts": facts, "runs": runs_out, "master": sc.MASTER_ACCOUNT}, default=str))
'''

# VehicleCalendar.gs and VehicleCalendarFlows.gs themselves, in node, over the same steps
NODE = r'''
const fs = require('fs'), vm = require('vm'), path = require('path'), crypto = require('crypto');
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
const read = f => fs.readFileSync(path.join(input.dir, f), 'utf8');
function pick(file, name) {
  const s = read(file), at = s.indexOf('function ' + name + '(');
  if (at < 0) throw new Error(name + ' is not in ' + file);
  let i = s.indexOf('{', at), depth = 0;
  for (; i < s.length; i++) { if (s[i] === '{') depth++; else if (s[i] === '}' && --depth === 0) break; }
  return s.slice(at, i + 1);
}
const shared = /var SHARED_LINE_DIGITS\s*=\s*\[[^\]]*\];/.exec(read('Talent.gs'))[0];
function fmt(ms, tz, f) {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms));
  const g = t => p.find(x => x.type === t).value;
  if (f === 'yyyy-MM-dd') return g('year') + '-' + g('month') + '-' + g('day');
  if (f === 'HH:mm') return g('hour') + ':' + g('minute');
  if (f === 'h:mm a') { const h = +g('hour'); return ((h % 12) || 12) + ':' + g('minute') + ' ' + (h < 12 ? 'AM' : 'PM'); }
  throw new Error('no format ' + f);
}
const STUBS = `
var IN = JSON.parse(__IN);
var MASTER = IN.master;
var __cache = {}, __n = 0, __idq = JSON.parse(JSON.stringify(IN.ids)), __calls = [], __outcomes = {};
var CacheService = { getScriptCache: function () { return {
  get: function (k) { return Object.prototype.hasOwnProperty.call(__cache, k) ? __cache[k] : null; },
  put: function (k, v) { __cache[k] = String(v); }, remove: function (k) { delete __cache[k]; } }; } };
var LockService = { getScriptLock: function () { return { tryLock: function () { return true; }, releaseLock: function () {} }; } };
var SpreadsheetApp = { flush: function () {} };
var PropertiesService = { getScriptProperties: function () { return { getProperty: function () { return '1'; }, setProperty: function () {} }; } };
var Utilities = { DigestAlgorithm: { SHA_256: 'SHA_256' }, Charset: { UTF_8: 'UTF_8' },
  computeDigest: function (a, text) { return JSON.parse(__sha(String(text))); },
  formatDate: function (d, tz, f) { return __fmt(d.getTime(), tz, f); } };
function hubSysLog_() {}
function houseMoved_() { return true; }
function sheetDbGateHolds_() { return null; }
function hubCellSafe_(v) { return v; }
function cellText_(v) { return String(v); }
function Sheet(header, rows) {
  this.data = [header.slice()].concat(rows.map(function (r) { return header.map(function (h) { return r[h] == null ? '' : String(r[h]); }); }));
}
Sheet.prototype.getDataRange = function () { var s = this; return { getValues: function () { return s.data.map(function (r) { return r.slice(); }); } }; };
Sheet.prototype.getLastRow = function () { return this.data.length; };
Sheet.prototype.getMaxRows = function () { return this.data.length + 1000; };
Sheet.prototype.insertRowsAfter = function () {};
Sheet.prototype.getRange = function (r, c, nr, nc) { var s = this; return {
  getValues: function () { var out = []; for (var i = 0; i < nr; i++) { var row = s.data[r - 1 + i] || [], o = [];
    for (var j = 0; j < nc; j++) o.push(row[c - 1 + j] == null ? '' : row[c - 1 + j]); out.push(o); } return out; },
  setValues: function (vals) { for (var i = 0; i < vals.length; i++) { var k = r - 1 + i; while (s.data.length <= k) s.data.push([]);
    for (var j = 0; j < vals[i].length; j++) s.data[k][c - 1 + j] = vals[i][j]; } },
  setNumberFormat: function () {} }; };
function ensureHeader_(sheet) { return sheet.data[0].slice(); }
var __sheets = {};
Object.keys(VC_HEADERS).forEach(function (t) { __sheets[t] = new Sheet(VC_HEADERS[t], IN.tabs[t] || []); });
function hubTabEnsure_(tab) { return __sheets[tab]; }
var __users = Object.keys(IN.users).map(function (k) { var u = JSON.parse(JSON.stringify(IN.users[k])); if (u.email === '@MASTER') u.email = MASTER; return u; });
function usersAll_() { return __users; }
function userByEmail_(email) { var n = String(email || '').trim().toLowerCase(); if (!n) return null;
  for (var i = 0; i < __users.length; i++) { if (str_(__users[i].mergedinto)) continue; if (str_(__users[i].email).toLowerCase() === n) return __users[i]; } return null; }
function hubIsMasterRow_(row) { return !!row && str_(row.email).toLowerCase() === MASTER; }
function hubIsRealMaster_(user) { return !!user && !user.is_service && !user.visiting_member && str_(user.role) === 'admin' && str_(user.email).toLowerCase() === MASTER; }
function hubActingUserId_(user) { return str_(user && !user.is_service ? user.id : ''); }
function hubProfileAppGate_(app, user) { return { open: IN.closed.indexOf(str_(user && user.id)) === -1 }; }
function cpRosterBuild_() { return { clients: IN.roster }; }
function hubTestModeState_() { return { on: IN.test_on }; }
function houseIdFor_() { return 'INBOX'; }
function hubGrantReader_() { return true; }
var smartTell_ = function (w) { __calls.push(JSON.parse(JSON.stringify(w))); var o = __outcomes[w.key];
  return o ? JSON.parse(JSON.stringify(o)) : { state: 'failed', held: '', why: 'the check holds no outcome for this key' }; };
vcInboxShareMaybe_ = function () { return null; };
vcBoard_ = function () { return { stub: true }; };
vcDrivers_ = function () { return { readable: false, why: 'the check reads no driving record', map: {} }; };
vcNewId_ = function (prefix) { var q = __idq[prefix]; return q && q.length ? q.shift() : prefix + 'Z' + (++__n); };
function __rows(t) { var d = __sheets[t].data, h = d[0]; return d.slice(1).map(function (r) { var o = {}; h.forEach(function (k, i) { o[k] = r[i] == null ? '' : String(r[i]); }); return o; }); }
function __step(i) {
  var st = IN.steps[i];
  __cache = {}; VC_MEMO = {}; VC_ROWS_MEMO = {}; VC_BOARD_MEMO = {}; VC_DIRTY = false; VC_INBOX_TOUCHED = false;
  VC_NOW = st.at; __calls = []; __outcomes = st.outcomes || {};
  var res;
  try { res = HUB_ACTIONS[st.action](JSON.parse(JSON.stringify(st.payload)), JSON.parse(JSON.stringify(st.user))); }
  catch (e) { res = { thrown: String(e && e.stack || e) }; }
  return JSON.stringify({ answer: res, calls: __calls, state: { trips: __rows('vc_trips'), inbox: __rows('vc_inbox'), log: __rows('vc_log') } });
}
`;
const out = {};
for (const run of input.runs) {
  const ctx = { console };
  vm.createContext(ctx);
  ctx.__IN = JSON.stringify(run);
  ctx.__sha = s => JSON.stringify(Array.from(crypto.createHash('sha256').update(s, 'utf8').digest()).map(b => b > 127 ? b - 256 : b));
  ctx.__fmt = fmt;
  vm.runInContext('var HUB_POLICY = {}, HUB_ACTIONS = {};', ctx);
  vm.runInContext(read('VehicleCalendar.gs'), ctx, { filename: 'VehicleCalendar.gs' });
  vm.runInContext(read('VehicleCalendarFlows.gs'), ctx, { filename: 'VehicleCalendarFlows.gs' });
  vm.runInContext(shared + '\n' + pick('Talent.gs', 'str_') + '\n' + pick('Packet.gs', 'packetSendableNumber_') + '\n' +
                  pick('Clients.gs', 'clientNameKey_') + '\n' + pick('Profile.gs', 'profileParsePhones_') + '\n' +
                  pick('MailTemplates.gs', 'mailPlatformUrl_'), ctx);
  vm.runInContext(STUBS, ctx, { filename: 'stubs.js' });
  out[run.name] = run.steps.map((_s, i) => JSON.parse(vm.runInContext('__step(' + i + ')', ctx)));
}
process.stdout.write(JSON.stringify(out));
'''


def norm_trips(rows: list[dict]) -> tuple[dict, set]:
    """Trips by id, each told without its owed list; and every key an owed entry names."""
    by, owed = {}, set()
    for r in rows:
        r = dict(r)
        try:
            told = json.loads(r.get("told") or "{}")
        except ValueError:
            told = r.get("told")
        if isinstance(told, dict):
            for o in told.pop("owed", None) or []:
                owed.add(o.get("key"))
        r["told"] = told
        by[r["id"]] = r
    return by, owed


def first_diff(a: dict, b: dict) -> str:
    for k in sorted(set(a) | set(b)):
        if a.get(k) != b.get(k):
            if isinstance(a.get(k), dict) and isinstance(b.get(k), dict):
                return f"{k}." + first_diff(a[k], b[k])
            return f"{k}: py {str(a.get(k))[:90]!r} vs gs {str(b.get(k))[:90]!r}"
    return ""


def compare(run: dict, gs_steps: list[dict]) -> list[list]:
    checks = []
    # what Apps Script itself left owed stays its own clock's: never in Python's outbox
    _, born = norm_trips(run["fixtures"]["tabs"]["vc_trips"])
    for py, gs in zip(run["steps"], gs_steps):
        name = f"{run['name']} · {py['name']}"
        theirs = gs["answer"] if isinstance(gs.get("answer"), dict) else {"answer": gs.get("answer")}
        theirs = json.loads(json.dumps(theirs))
        if isinstance(theirs.get("data"), dict):
            theirs["data"].pop("board", None)
            theirs["data"].pop("reread", None)
        checks.append([f"{name}: the answer is Apps Script's", py["env"] == theirs, first_diff(py["env"], theirs)])
        asks = [{k: a.get(k) for k in ("situation", "to", "vars", "key", "person", "lane", "at_ms", "prune")}
                for a in gs["calls"]]
        checks.append([f"{name}: the texts handed to Smart Comms are smartTell_'s", py["asks"] == asks,
                       f"{len(py['asks'])} vs {len(asks)}" + (" · " + first_diff(
                           {str(i): a for i, a in enumerate(py["asks"])}, {str(i): a for i, a in enumerate(asks)})
                           if len(py["asks"]) == len(asks) else "")])
        pt, _ = norm_trips(py["state"]["trips"])
        gt, gowed = norm_trips(gs["state"]["trips"])
        checks.append([f"{name}: the trips are Apps Script's (told without its owed list)", pt == gt,
                       first_diff(pt, gt)])
        checks.append([f"{name}: what told.owed would hold is what the outbox owes", set(py["owed"]) == gowed - born,
                       f"py {len(py['owed'])} owed vs gs {len(gowed - born)}"])
        pi = {r["id"]: r for r in py["state"]["inbox"]}
        gi = {r["id"]: r for r in gs["state"]["inbox"]}
        checks.append([f"{name}: the items are Apps Script's", pi == gi, first_diff(pi, gi)])
        pl = {r["id"]: r for r in py["state"]["log"]}
        gl = {r["id"]: r for r in gs["state"]["log"]}
        checks.append([f"{name}: the log lines are Apps Script's", pl == gl, first_diff(pl, gl)])
    return checks


def main() -> int:
    py_compile.compile(str(ROOT / "app" / "transportation_flows.py"), doraise=True)
    print("ok   app/transportation_flows.py compiles")
    app = {p.stem: p.read_text(encoding="utf-8") for p in (ROOT / "app").glob("*.py")}
    app["transportation_writes"], w1 = wired(app["transportation_writes"], TW_PATCH, "app/transportation_writes.py")
    app["hubdb"], w2 = wired(app["hubdb"], HUBDB_PATCH, "app/hubdb.py")
    runs = [{"name": "live", "born": False, "fixtures": fixtures(False), "steps": steps_live(),
             "ids": {"VT": ids("VT", 0xA00), "VL": ids("VL", 0xB00)}},
            {"name": "copied", "born": True, "fixtures": fixtures(True), "steps": steps_born(),
             "ids": {"VT": ids("VT", 0xC00), "VL": ids("VL", 0xD00)}}]
    blob = {"app": app, "runs": runs, "wiring": f"{w1}; {w2}; app/main.py: ACTIONS/POLICY/BUSY_OF updated here",
            "van": VAN}
    got = subprocess.run(["docker", "exec", "-i", "-e", "MALLOC_ARENA_MAX=2", RUNNER, "python", "-c", DRIVER],
                         input=base64.b64encode(json.dumps(blob).encode()) + b"\n", capture_output=True, timeout=900)
    lines = got.stdout.decode().strip().splitlines()
    if got.returncode != 0 or not lines:
        print("FAIL the driver ran in asa-hub-db-sync")
        print(got.stderr.decode()[-2500:])
        return 1
    res = json.loads(lines[-1])
    checks = list(res["checks"])
    node_in = {"dir": str(ROOT / "apps-script"), "runs": []}
    for r in res["runs"]:
        # vcTestWord_ as Python read it on the live switch
        word = next((t["test_mode"] for s in r["steps"] for t in s["state"]["trips"]
                     if s["action"] == "vehicleCalendarRequest" and s["env"].get("status") == 200
                     and t["id"] == s["env"]["data"]["trip_id"]), "yes")
        node_in["runs"].append({
            "name": r["name"], "master": res["master"], "test_on": word != "no",
            "users": r["fixtures"]["users"], "closed": r["fixtures"]["closed"], "roster": r["fixtures"]["roster"],
            "tabs": r["fixtures"]["tabs"],
            "ids": next(x["ids"] for x in runs if x["name"] == r["name"]),
            "steps": [{"name": s["name"], "action": s["action"], "payload": s["payload"], "user": s["user"],
                       "at": s["at"], "outcomes": s["outcomes"]} for s in r["steps"]]})
    ran = subprocess.run(["node", "-e", NODE], input=json.dumps(node_in).encode(), capture_output=True, timeout=300)
    try:
        gs = json.loads(ran.stdout.decode() or "{}")
    except ValueError:
        gs = {}
    if not gs:
        checks.append(["VehicleCalendarFlows.gs ran in node", False, ran.stderr.decode()[-600:]])
    for r in res["runs"]:
        theirs = gs.get(r["name"])
        if not theirs:
            continue
        thrown = [s["name"] for s, t in zip(r["steps"], theirs) if isinstance(t.get("answer"), dict)
                  and t["answer"].get("thrown")]
        checks.append([f"{r['name']}: every step ran in node", not thrown and len(theirs) == len(r["steps"]),
                       thrown[:3] and next(t["answer"]["thrown"][:300] for t in theirs if t["answer"].get("thrown"))])
        checks += compare(r, theirs)
    failed = 0
    for name, ok, detail in checks:
        print(("ok   " if ok else "FAIL ") + name + ("" if ok else f"\n       {detail}"))
        failed += 0 if ok else 1
    for k, v in res["facts"].items():
        print(f"fact {k}: {v}")
    for r in res["runs"]:
        said = {}
        for s in r["steps"]:
            said[s["env"].get("status", s["code"])] = said.get(s["env"].get("status", s["code"]), 0) + 1
        print(f"fact run {r['name']}: {len(r['steps'])} steps, answers by status "
              + ", ".join(f"{k} ×{v}" for k, v in sorted(said.items(), key=lambda kv: str(kv[0]))))
    print(f"{len(checks) - failed} ok, {failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
