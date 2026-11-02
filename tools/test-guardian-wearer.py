"""The SSA/FAMILY-wearer rule (the operator's FIX BADGES sheet of 2026-10-30, over his access sheet of 10-29: the SSA
and Family columns are shut on My Inbox › Chat, Locations, Staff, Emergency Contacts, Scheduling, Time Off and
Transportation, where DSP is open; SSA opens the SSA app and never Families & Guardians, FAMILY the reverse), on the
live users copy in asa-hub-db with App Control's rows laid in memory (the live rows are never asked):
- there is no GUARDIAN badge: a cell written before 10-30 (every live one, the users' and App Control's alike) reads
  FAMILY, and the guardian's account clientUserCreate writes on a client role wears SSA;
- an account whose ticked badges include SSA or FAMILY is matched on its badges alone, its role word never counting:
  the two live accounts on role `staff` (Denise Hollenbach and the Guardian test persona, GUARDIAN cells) and an SSA
  and a FAMILY on role staff are refused by every app_access copy (lane_gate, the Scheduling lanes, My Inbox, the
  hotline gate) wherever the row names STAFF and not their badge, and let in where it names it; a client-role SSA is
  never opened by a CLIENT row;
- Emergency Contacts opens to an SSA or a FAMILY only by a row naming its badge, and only on the clients the records
  give it — never the whole directory on the role's STAFF;
- the chat narrows them to the office as it narrows a client, the rail and the live chat's people index alike;
- a DSP, a staff login with no tick, a STAFF tick beside FAMILY and the master answer as before.
Nothing is written: the chat's store is stood in for and answers no rows.

From the repo root:

    RUNNER=<scratchpad> python3 tools/test-guardian-wearer.py
"""
import json
import os
import subprocess
import sys

if not os.environ.get("GUARDIAN_WEARER_INPROC"):
    runner = os.environ["RUNNER"]
    here = os.path.join(runner, "test_guardian_wearer.py")
    with open(here, "w", encoding="utf-8") as fh, open(__file__, encoding="utf-8") as me:
        fh.write(me.read())
    env = {"GUARDIAN_WEARER_INPROC": "1"}
    with open(os.path.join("app", "ist_config_defaults.json"), encoding="utf-8") as fh:
        env["HUB_IST_CONFIG_DECLARATION_JSON"] = fh.read()
    with open(os.path.join("app", "front_door_routes.json"), encoding="utf-8") as fh:
        env["FD_ROUTES"] = fh.read()
    # the routes alone pass the 128 KiB an argument holds
    with open(os.path.join(runner, "guardian_wearer_env.json"), "w", encoding="utf-8") as fh:
        json.dump(env, fh)
    out = subprocess.run(["sh", os.path.join(runner, "run.sh"), os.path.abspath("app"), here,
                          "@" + os.path.join(runner, "guardian_wearer_env.json")],
                         capture_output=True, text=True, timeout=600)
    sys.stdout.write(out.stdout[-6000:])
    sys.stderr.write(out.stderr[-2000:])
    sys.exit(1 if out.returncode or '"failed": []' not in out.stdout else 0)

import logging  # noqa: E402
import tempfile  # noqa: E402
import types  # noqa: E402

logging.disable(logging.CRITICAL)


class _Resp:
    def __init__(self, content=None, status_code=200, media_type=None, headers=None):
        self.body, self.status_code, self.media_type, self.headers = content, status_code, media_type, dict(headers or {})


async def _threadpool(fn, *a, **k):
    return fn(*a, **k)


# the runner has neither fastapi nor starlette; the gates import them at module level
_fa = types.ModuleType("fastapi")
_fa.Request, _fa.FastAPI = object, object
_fr = types.ModuleType("fastapi.responses")
_fr.JSONResponse = _fr.Response = _Resp
_sc = types.ModuleType("starlette.concurrency")
_sc.run_in_threadpool = _threadpool
sys.modules.update({"fastapi": _fa, "fastapi.responses": _fr, "starlette": types.ModuleType("starlette"),
                    "starlette.concurrency": _sc})
_work = tempfile.mkdtemp(prefix="guardian-wearer-")
with open(_work + "/routes.json", "w", encoding="utf-8") as _fh:
    _fh.write(os.environ["FD_ROUTES"])
os.environ.update(HUB_FRONT_DOOR_ROUTES=_work + "/routes.json", HUB_APP_PACK_DIR=_work, HUB_SERVICE_SECRET="")

import chat as C  # noqa: E402
import chat_live as CL  # noqa: E402
import clients as CB  # noqa: E402
import emergency_contacts as EC  # noqa: E402
import hotline_gate as HG  # noqa: E402
import hubdb  # noqa: E402
import lane_gate as LG  # noqa: E402
import locations as L  # noqa: E402
import my_inbox as MI  # noqa: E402
import sched_lanes as SL  # noqa: E402
import scope as sc  # noqa: E402

results: dict[str, str] = {}


def check(name: str, ok: bool, why: object = "") -> None:
    results[name] = "ok" if ok else f"FAIL {str(why)[:240]}"


def words(cell: str) -> list[str]:
    return [w.strip() for w in cell.split(",")]


# App Control's rows as the app read them on 2026-10-29/30, less the two badges that stand in for DIRECTOR; the live
# rows still say GUARDIAN for the Family column (chat), and Families & Guardians' row is laid as App Control writes it
# since the rename (FAMILY)
RULES = {
    "emergency-contacts": words("DIRECTOR, TEAMLEAD, ADMINISTRATOR, ADMIN, ENTITY, MANAGER, HM, STAFF"),
    "my-inbox.liveChat": words("DIRECTOR, TEAMLEAD, ADMINISTRATOR, ADMIN, ENTITY, MANAGER, HM, INTERVIEWER, STAFF, "
                               "ONBOARDING"),
    "locations": words("DIRECTOR, ADMIN, ADMINISTRATOR, HM, TEAMLEAD, STAFF, INTERVIEWER, MANAGER, ENTITY"),
    "staff-profiles": words("DIRECTOR, ADMIN, ADMINISTRATOR, HM, TEAMLEAD, STAFF"),
    "scheduling": words("STAFF, INTERVIEWER, HM, DIRECTOR, MANAGER, ENTITY, ADMIN, ADMINISTRATOR, TEAMLEAD"),
    "timeoff": words("STAFF, HM, MANAGER, ENTITY, DIRECTOR, ADMINISTRATOR, ADMIN, TEAMLEAD"),
    "vehicle-calendar": words("DIRECTOR, ADMIN, ADMINISTRATOR, HM, TEAMLEAD, STAFF, ENTITY"),
    "chat": words("DIRECTOR, GUARDIAN, ADMINISTRATOR, ADMIN, ENTITY, MANAGER, HM, STAFF, CLIENT, TEAMLEAD"),
    "house-repair": words("DIRECTOR, ADMINISTRATOR, ADMIN, ENTITY, MANAGER, HM, STAFF, CLIENT"),
    "ssa-profiles": words("DIRECTOR, ADMIN, ADMINISTRATOR, HM, TEAMLEAD, STAFF, INTERVIEWER, MANAGER, ENTITY, SSA"),
    "family-profiles": words("DIRECTOR, ADMIN, ADMINISTRATOR, HM, TEAMLEAD, STAFF, FAMILY, CLIENT, INTERVIEWER"),
}
FAMILY_SHUT = ["emergency-contacts", "my-inbox.liveChat", "locations", "staff-profiles", "scheduling", "timeoff",
               "vehicle-calendar"]
# the sheet's two columns: each opens its own app, never the other's
OWN_ROW = {"SSA": "ssa-profiles", "FAMILY": "family-profiles"}
OTHER_ROW = {"SSA": "family-profiles", "FAMILY": "ssa-profiles"}

db = hubdb.HubDb()
live = L.Reads(db, None)
copy = {str(u.get("userid") or ""): u for u in live.users()}
DENISE, PERSONA = "USR_B857E8E79019", "USR_23CC28626DE6"
master_row = next((u for u in copy.values() if sc.is_master_email(u.get("email"))), None)
dsp_row = next((u for u in copy.values() if str(u.get("role") or "").lower() == "staff"
                and sc.types_from_raw(u.get("types")) == ["STAFF"] and str(u.get("active")).lower() == "true"
                and not u.get("mergedinto")), None)
live_clients = {str(c.get("client_key") or "") for c in CB.derived(live) or [] if CB.client_live(c)}
# a client-role account the records' guardian signs in with, linked to its one live ward (Jennifer Williams's shape)
ward_row = next((u for u in copy.values() if str(u.get("role") or "").lower() == "client"
                 and set(sc.types_from_raw(u.get("types"))) & set(sc.FAMILY_TICKS)
                 and str(u.get("clientkey") or "") in live_clients and str(u.get("active")).lower() == "true"
                 and not u.get("mergedinto")), None)
check("the copy holds both staff-role family-column accounts, a client-role one on a live ward, a DSP and the master",
      DENISE in copy and PERSONA in copy and ward_row is not None and dsp_row is not None and master_row is not None)
for uid in (DENISE, PERSONA):
    row = copy.get(uid) or {}
    ticked = sc.types_from_raw(row.get("types"))
    check(f"{uid}: role staff, its cell read as FAMILY or SSA, never GUARDIAN",
          str(row.get("role")).lower() == "staff" and bool(set(ticked) & set(sc.FAMILY_TICKS))
          and "GUARDIAN" not in ticked, {k: row.get(k) for k in ("role", "types")} | {"read": ticked})


def synthetic(uid: str, role: str, types_cell: str) -> dict:
    return {"userid": uid, "email": f"{uid.lower()}@example.invalid", "displayname": "Test " + uid, "role": role,
            "types": types_cell, "active": "True", "appdenials": "", "hometenant": "", "clientkey": "",
            "mergedinto": "", "isservice": ""}


ROWS = dict(copy)
ROWS.update({u["userid"]: u for u in (synthetic("T-BOTH", "staff", "FAMILY, STAFF"),
                                      synthetic("T-BARE", "staff", ""),
                                      synthetic("T-STAFF-SSA", "staff", "SSA"),
                                      synthetic("T-STAFF-FAMILY", "staff", "FAMILY"),
                                      synthetic("T-CLIENT-SSA", "client", "SSA"),
                                      synthetic("T-CLIENT", "client", "CLIENT"))})
MASTER = str((master_row or {}).get("userid") or "")
DSP = str((dsp_row or {}).get("userid") or "")
LIVE_WEARERS = (DENISE, PERSONA)
WEARERS = LIVE_WEARERS + ("T-STAFF-SSA", "T-STAFF-FAMILY")
OTHERS = (DSP, "T-BOTH", "T-BARE")


def own(uid: str) -> str:
    """The family-column badge an account's cell reads: SSA, else FAMILY (a GUARDIAN cell is FAMILY)."""
    return "SSA" if "SSA" in sc.types_from_raw(ROWS[uid].get("types")) else "FAMILY"


# ---- the rule itself -------------------------------------------------------------------------------------------------
check("types_from_raw: no GUARDIAN badge — a cell written before 10-30 reads FAMILY, once",
      sc.types_from_raw("GUARDIAN") == ["FAMILY"] and sc.types_from_raw(" guardian , FAMILY") == ["FAMILY"]
      and sc.types_from_raw("GUARDIAN, SSA") == ["FAMILY", "SSA"] and sc.types_from_raw(["SSA"]) == ["SSA"]
      and "GUARDIAN" not in sc.USER_TYPES and "GUARDIAN" not in sc.BADGE_ORDER
      and set(sc.FAMILY_TICKS) == {"SSA", "FAMILY"})
check("role_counts: an SSA or FAMILY tick (or a GUARDIAN cell) stops the role word, in any case or spacing",
      sc.role_counts("FAMILY", "staff") is False and sc.role_counts(" family ", "STAFF") is False
      and sc.role_counts("SSA", "staff") is False and sc.role_counts(["STAFF", "SSA"], "staff") is False
      and sc.role_counts("GUARDIAN", "staff") is False and sc.role_counts(" guardian ", "STAFF") is False
      and sc.role_counts("FAMILY", "admin") is False)
check("role_counts: an SSA's or a FAMILY's role word never counts, client included (neither is CLIENT or DSP by it)",
      sc.role_counts("SSA", "client") is False and sc.role_counts("FAMILY", "client") is False
      and sc.role_counts("GUARDIAN", "client") is False)
check("role_counts: no SSA or FAMILY tick, the role word counts", sc.role_counts("STAFF", "staff") is True
      and sc.role_counts("", "staff") is True and sc.role_counts(None, "staff") is True
      and sc.role_counts(["CLIENT"], "client") is True)
check("badges_matched: an SSA or a FAMILY wears its own badge alone whatever its role, the DSP its role too",
      sc.badges_matched("GUARDIAN", "staff") == ["FAMILY"] and sc.badges_matched("FAMILY", "staff") == ["FAMILY"]
      and sc.badges_matched("SSA", "staff") == ["SSA"] and sc.badges_matched("SSA", "client") == ["SSA"]
      and sc.badges_matched("", "staff") == ["STAFF"] and sc.badges_matched("CLIENT", "client") == ["CLIENT"],
      [sc.badges_matched(t, r) for t, r in (("GUARDIAN", "staff"), ("SSA", "client"), ("", "staff"))])

# ---- lane_gate.app_access (the live chat ticket, the lanes) -----------------------------------------------------------
stub_reads = types.SimpleNamespace(users=lambda: list(ROWS.values()), config=lambda: {})
LG._last_of = lambda _reads, tab, app_id, _col: (",".join(RULES.get(app_id, [])) if tab == "app_badge_access"
                                                  else None)
LG._cut = lambda *_a: False


def lane(uid: str, app_id: str, master: bool = False) -> dict:
    role = str(ROWS[uid].get("role") or "")
    return LG.app_access(stub_reads, uid, role, app_id, master=master)


for uid in WEARERS:
    shut = [a for a in FAMILY_SHUT if lane(uid, a).get("reason") != "badge"]
    check(f"lane_gate, {uid}: every Family-shut row refuses", not shut, shut)
    check(f"lane_gate, {uid}: the row naming {own(uid)} opens", lane(uid, OWN_ROW[own(uid)])["open"] is True,
          lane(uid, OWN_ROW[own(uid)]))
    check(f"lane_gate, {uid}: the other column's row refuses, its STAFF never counting",
          lane(uid, OTHER_ROW[own(uid)]).get("reason") == "badge", lane(uid, OTHER_ROW[own(uid)]))
    check(f"lane_gate, {uid}: the refusal says badge", lane(uid, "my-inbox.liveChat").get("reason") == "badge",
          lane(uid, "my-inbox.liveChat"))
    if own(uid) == "FAMILY":
        check(f"lane_gate, {uid}: a row still saying GUARDIAN opens a FAMILY", lane(uid, "chat")["open"] is True,
              lane(uid, "chat"))
for uid in OTHERS:
    shut = [a for a in FAMILY_SHUT + list(OWN_ROW.values()) if not lane(uid, a)["open"]]
    check(f"lane_gate, {uid}: every Family-shut row, and both columns' rows, still open", not shut, shut)
check("lane_gate, the master: open with no row and on every row", lane(MASTER, "nothing-written", True)["open"]
      and all(lane(MASTER, a, True)["open"] for a in FAMILY_SHUT))
check("lane_gate, a client-role SSA: opened by the SSA row, never by a CLIENT row, the Families row or a DSP row",
      lane("T-CLIENT-SSA", "ssa-profiles")["open"] is True and lane("T-CLIENT-SSA", "house-repair")["open"] is False
      and lane("T-CLIENT-SSA", "family-profiles")["open"] is False
      and not any(lane("T-CLIENT-SSA", a)["open"] for a in FAMILY_SHUT),
      {a: lane("T-CLIENT-SSA", a).get("reason") for a in ("ssa-profiles", "house-repair", "family-profiles")})
check("lane_gate, a client account with no SSA or FAMILY tick: as before",
      lane("T-CLIENT", "house-repair")["open"] is True)


# ---- the Scheduling lanes' copy (sched_lanes.app_access) --------------------------------------------------------------
def raw_of(u: dict) -> dict:
    return {"user_id": u.get("userid"), "role": u.get("role"), "types": u.get("types"), "active": u.get("active"),
            "app_denials": u.get("appdenials") or "", "home_tenant": u.get("hometenant") or ""}


SL.lanes_sheets = types.SimpleNamespace(
    text=SL.lanes_sheets.text,
    user_row=lambda _sid, uid: raw_of(ROWS[uid]) if uid in ROWS else None,
    data=lambda _sid, tab: ([{"app_id": a, "badges": ",".join(b)} for a, b in RULES.items()]
                            if tab == "app_badge_access" else []))
SL._cut_lists = lambda: (frozenset(), frozenset())


def sched(uid: str, app_id: str, master: bool = False) -> dict:
    return SL.app_access(uid, str(ROWS[uid].get("role") or ""), app_id, is_master=master)


for uid in WEARERS:
    # refused for the badge, never because the record went unread
    shut = [a for a in ("scheduling", "timeoff", "vehicle-calendar") if sched(uid, a).get("reason") != "badge"]
    check(f"sched_lanes, {uid}: Scheduling, Time Off and the vehicle calendar refuse", not shut, shut)
    check(f"sched_lanes, {uid}: the row naming {own(uid)} opens", sched(uid, OWN_ROW[own(uid)])["open"] is True,
          sched(uid, OWN_ROW[own(uid)]))
    check(f"sched_lanes, {uid}: the other column's row refuses", sched(uid, OTHER_ROW[own(uid)]).get("reason")
          == "badge", sched(uid, OTHER_ROW[own(uid)]))
    if own(uid) == "FAMILY":
        check(f"sched_lanes, {uid}: a row still saying GUARDIAN opens a FAMILY", sched(uid, "chat")["open"] is True,
              sched(uid, "chat"))
for uid in OTHERS:
    check(f"sched_lanes, {uid}: Scheduling and Time Off open", sched(uid, "scheduling")["open"]
          and sched(uid, "timeoff")["open"], sched(uid, "scheduling"))
check("sched_lanes, the master: never narrowed", sched(MASTER, "scheduling", True)["open"]
      and sched(MASTER, "nothing-written", True)["open"])

# ---- My Inbox's copy (my_inbox.app_access, pure) ---------------------------------------------------------------------


def inbox(uid: str, app_id: str, master: bool = False) -> dict:
    return MI.app_access(app_id, uid=uid, role=str(ROWS[uid].get("role") or ""), is_master=master,
                         user=raw_of(ROWS[uid]), rules=RULES, tenants={}, cut=frozenset(), seen=frozenset())


for uid in WEARERS:
    shut = [a for a in FAMILY_SHUT + [OTHER_ROW[own(uid)]]
            if "not open to this account's badges" not in inbox(uid, a)["why"]]
    check(f"my_inbox, {uid}: no source of a Family-shut app, nor of the other column's", not shut, shut)
    check(f"my_inbox, {uid}: the row naming {own(uid)} opens", inbox(uid, OWN_ROW[own(uid)])["open"] is True,
          inbox(uid, OWN_ROW[own(uid)]))
    if own(uid) == "FAMILY":
        check(f"my_inbox, {uid}: a row still saying GUARDIAN opens a FAMILY", inbox(uid, "chat")["open"] is True,
              inbox(uid, "chat"))
for uid in OTHERS:
    shut = [a for a in FAMILY_SHUT if not inbox(uid, a)["open"]]
    check(f"my_inbox, {uid}: as before", not shut, shut)
check("my_inbox, the master: never narrowed", all(inbox(MASTER, a, True)["open"] for a in FAMILY_SHUT))

# ---- the hotline gate's copy (hotline_gate.app_access) ---------------------------------------------------------------
HG.core = lambda uid, app_id: {"source": "mirror", "user": ({k: str(v or "") for k, v in raw_of(ROWS[uid]).items()}
                                                            if uid in ROWS else None),
                               "rule": list(RULES.get(app_id, [])), "tenants": [], "age_s": 0.0, "sync_ok": True}
HG.ACCESS_WRITTEN_AT[0] = 0.0
HG.APP_CUT[:] = []


def hotline(uid: str, app_id: str, master: bool = False) -> dict:
    return HG.app_access(uid, str(ROWS[uid].get("role") or ""), app_id, is_master=master)


for uid in WEARERS:
    shut = [a for a in FAMILY_SHUT + [OTHER_ROW[own(uid)]] if hotline(uid, a).get("reason") != "badge"]
    check(f"hotline_gate, {uid}: every Family-shut row refuses, and the other column's", not shut, shut)
    check(f"hotline_gate, {uid}: the row naming {own(uid)} opens", hotline(uid, OWN_ROW[own(uid)])["open"] is True,
          hotline(uid, OWN_ROW[own(uid)]))
    if own(uid) == "FAMILY":
        check(f"hotline_gate, {uid}: a row still saying GUARDIAN opens a FAMILY", hotline(uid, "chat")["open"] is True,
              hotline(uid, "chat"))
for uid in OTHERS:
    shut = [a for a in FAMILY_SHUT if not hotline(uid, a)["open"]]
    check(f"hotline_gate, {uid}: as before", not shut, shut)
check("hotline_gate, the master: never narrowed", all(hotline(MASTER, a, True)["open"] for a in FAMILY_SHUT))


# ---- Emergency Contacts (its own gate on the viewer's scope) ---------------------------------------------------------
def session(row: dict, rules: dict) -> L.Session:
    reads = L.Reads(db, None)
    # App Control's rows as the app reads them (scope.app_rules: a GUARDIAN word reads FAMILY)
    got = sc.app_rules([{"appid": a, "badges": ",".join(b)} for a, b in rules.items()], [])
    reads.app_rules = lambda: got
    return L.Session(reads, sc.user_from_row(row))


def outcome(fn, *args) -> object:
    try:
        got = fn(*args)
    except Exception as exc:  # noqa: BLE001 - said as the result
        return type(exc).__name__
    return got.get("status") if isinstance(got, dict) else got


def naming(*badges: str) -> dict:
    return {**RULES, "emergency-contacts": RULES["emergency-contacts"] + list(badges)}


for uid in LIVE_WEARERS:
    check(f"emergency_contacts, {uid}: the row names STAFF only — refused, never the directory on the role's STAFF",
          outcome(EC.opens, session(ROWS[uid], RULES)) is False, outcome(EC.opens, session(ROWS[uid], RULES)))
    check(f"emergency_contacts, {uid}: the directory read never reaches the store",
          outcome(EC.directory_read, session(ROWS[uid], RULES), {}) == 404,
          outcome(EC.directory_read, session(ROWS[uid], RULES), {}))
# Denise as the sheet names her: an SSA, the guardian the records name, on role staff with no client linked
SHEET_SSA = dict(ROWS[DENISE], types="SSA")
check("emergency_contacts, Denise as an SSA: a row naming SSA opens the directory (her wards, by their guardian's "
      "e-mail)", outcome(EC.opens, session(SHEET_SSA, naming("SSA"))) is True,
      outcome(EC.opens, session(SHEET_SSA, naming("SSA"))))
check("emergency_contacts, Denise as an SSA: a row naming FAMILY alone never opens it",
      outcome(EC.opens, session(SHEET_SSA, naming("FAMILY"))) is False,
      outcome(EC.opens, session(SHEET_SSA, naming("FAMILY"))))
WARD_SSA = dict(ward_row or {}, types="SSA")
check("emergency_contacts, a client-role SSA on its ward: a row naming SSA opens, its role's CLIENT never",
      outcome(EC.opens, session(WARD_SSA, naming("SSA"))) is True
      and outcome(EC.opens, session(WARD_SSA, naming("CLIENT"))) is False,
      [outcome(EC.opens, session(WARD_SSA, naming(b))) for b in ("SSA", "CLIENT")])
WARD_OLD = dict(ward_row or {}, types="GUARDIAN")
check("emergency_contacts, a GUARDIAN cell on a linked ward (FAMILY): a row still saying GUARDIAN opens",
      outcome(EC.opens, session(WARD_OLD, naming("GUARDIAN"))) is True,
      outcome(EC.opens, session(WARD_OLD, naming("GUARDIAN"))))
check("emergency_contacts, the DSP: opens", outcome(EC.opens, session(ROWS[DSP], RULES)) is True,
      outcome(EC.opens, session(ROWS[DSP], RULES)))
check("emergency_contacts, the master: opens with no row at all", outcome(EC.opens, session(ROWS[MASTER], {})) is True,
      outcome(EC.opens, session(ROWS[MASTER], {})))


# ---- the chat: narrowed to the office, as a client is ----------------------------------------------------------------
class _Cur:
    def fetchall(self) -> list:
        return []

    def fetchone(self) -> None:
        return None


class _Conn:
    def execute(self, *_a, **_k) -> _Cur:
        return _Cur()


class _Store:
    """The chat's tables stood in for: every read answers no rows, every write lands nowhere."""

    def run(self, fn):
        return fn(_Conn())


def ctx(row: dict) -> C.Ctx:
    return C.Ctx(_Store(), L.Reads(db, None), sc.user_from_row(row))


check("narrowed_account: an SSA or FAMILY tick (or a GUARDIAN cell) narrows whatever the role, never the master",
      C.narrowed_account("staff", "FAMILY", "a@b.c") is True and C.narrowed_account("staff", "SSA", "a@b.c") is True
      and C.narrowed_account("staff", "GUARDIAN", "a@b.c") is True and C.narrowed_account("client", "SSA", "") is True
      and C.narrowed_account("client", "", "") is True
      and C.narrowed_account("staff", "STAFF", "a@b.c") is False and C.narrowed_account("staff", "", "") is False
      and C.narrowed_account("admin", "SSA", sc.MASTER_ACCOUNT) is False
      and C.narrowed_account("admin", "FAMILY", sc.MASTER_ACCOUNT) is False)
office = {u for u, r in copy.items() if str(r.get("role")).lower() == "admin" and not r.get("mergedinto")}
wide = ctx(ROWS[DSP])
wide_rail = C.overview(wide, {})
check("chat, the DSP: not narrowed, the whole rail", wide.narrowed is False and wide_rail.get("status") == 200
      and "circle" not in (wide_rail.get("data") or {}), wide_rail.get("status"))
wide_people = {p["user_id"] for p in (wide_rail.get("data") or {}).get("people") or []}
for label, row in [(u, ROWS[u]) for u in LIVE_WEARERS] + [("Denise as an SSA", SHEET_SSA)]:
    c = ctx(row)
    rail = C.overview(c, {})
    data = rail.get("data") or {}
    people = {p["user_id"] for p in data.get("people") or []}
    check(f"chat, {label}: narrowed", c.narrowed is True)
    check(f"chat, {label}: the rail is the circle's, marked", rail.get("status") == 200 and "circle" in data, rail)
    check(f"chat, {label}: it lists the office alone, not the staff",
          people <= office and len(people) < len(wide_people), sorted(people - office)[:5])
    check(f"chat, {label}: a DSP's thread is not found", C.messages(c, {"with_user": DSP}) == C.NOT_FOUND)
    check(f"chat, {label}: counted a family-column account in the people index",
          C.accounts_index(c)["by_person"].get(c.me, {}).get("client") is True)
check("chat, the master: never narrowed", ctx(ROWS[MASTER]).narrowed is False)

rows = list(copy.values()) + [ROWS[u] for u in ("T-STAFF-SSA", "T-STAFF-FAMILY", "T-CLIENT-SSA")]
folds = CL.fold_index(rows)
narrowed = CL.narrowed_index(rows, folds)
check("live chat's people index: both live family-column accounts, an SSA and a FAMILY, neither the DSP nor the master",
      all(CL.person_of(folds, u) in narrowed for u in LIVE_WEARERS + ("T-STAFF-SSA", "T-STAFF-FAMILY", "T-CLIENT-SSA"))
      and CL.person_of(folds, DSP) not in narrowed and CL.person_of(folds, MASTER) not in narrowed)

print(json.dumps({"results": results, "failed": [k for k, v in results.items() if v != "ok"]}, indent=1, default=str))
