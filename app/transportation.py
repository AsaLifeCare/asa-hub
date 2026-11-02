"""Transportation (apps-script/VehicleCalendar.gs) answered off asa-hub-db: the board, and the trips per client or staff member."""
from __future__ import annotations

import functools
import hashlib
import json
import re
from datetime import date, timedelta
from typing import Any, Callable

import client_writes as CW
import gsjs
import hubdb
import locations as L
import scope as sc
import transportation_writes as TW
from scope import Defer

APP_ID = "vehicle-calendar"
TABS = TW.TABS
STATES = ("requested", "scheduled", "needs_assignment", "declined", "cancelled")
AVAILABILITY = TW.AVAILABILITY
TINTS = TW.TINTS
STAFF_ROLES = ("admin", "director", "manager", "staff")
HISTORY_DAYS = 400
SETTING_DEFAULTS = {
    "directors": "ty.bond@asalifecare.com, brittfrench1316@gmail.com",
    "trip_types": '["Doctor appointment","Grocery shopping","Chores / errands","Social / outing","Day program","Work",'
                  '"Other"]',
    "text_to": "{}",
    "import_minutes": "120"}
CP_EDITION_TRANSPORT = "clients.transportation"
TRIPS_EDITION = TW.EDITION["trips"]
PERSON_STATES = frozenset({"requested", "needs_assignment", "scheduled"})
STAFF_KEY = re.compile(r"^[a-z0-9]{3,80}$")
UNKNOWN = "Unknown action."


# ---- small values ----------------------------------------------------------------------------------------------------

s_ = TW.s_
ms_of = TW.ms_of
yes = TW.yes


def err(e: BaseException) -> str:
    """vcErr_."""
    return (str(e) or "unknown error")[:240]


def soft(fn: Callable[[], Any]) -> tuple[Any, str]:
    """A try/catch of VehicleCalendar.gs: its own failures become words; the database's are never swallowed."""
    try:
        return fn(), ""
    except (hubdb.Unreadable, Defer):
        raise
    except Exception as e:  # noqa: BLE001 - the code being ported says why in words
        return None, err(e)


def closed() -> dict[str, Any]:
    return {"status": 404, "message": UNKNOWN}


def jparse(text: Any, fallback: Any) -> Any:
    """vcJson_."""
    if isinstance(text, (dict, list)):
        return text
    s = s_(text)
    if not s:
        return fallback
    try:
        v = json.loads(s)
    except ValueError:
        return fallback
    return fallback if v is None else v


def int_of(v: Any, fallback: int) -> int:
    """vcIntOf_."""
    n = TW.parse_int(v)
    return fallback if n is None else n


def now_ms(reads: L.Reads) -> float:
    return TW.now_ms(reads)


def iso_add(day: str, days: int) -> str:
    """vcIsoAdd_."""
    y, m, d = (int(x) for x in day.split("-"))
    return (date(y, m, d) + timedelta(days=days)).isoformat()


def stamp(ms: float) -> str:
    """vcStamp_."""
    day = TW.day_of(ms)
    return TW.day_words(day, False) + ", " + day[:4] + ", " + TW.clock_words(ms) + " Eastern"


def phone_words(e164: Any) -> str:
    """vcPhoneWords_."""
    d = re.sub(r"^1(?=\d{10}$)", "", re.sub(r"\D", "", s_(e164)))
    return f"{d[:3]}-{d[3:6]}-{d[6:]}" if len(d) == 10 else s_(e164)


def by_locale(key: Callable[[Any], Any]) -> Callable[[Any], Any]:
    return functools.cmp_to_key(lambda a, b: gsjs.locale_cmp(key(a), key(b)))


# ---- the houses ------------------------------------------------------------------------------------------------------

def load(reads: L.Reads, tab: str) -> list[dict]:
    """vcRead_ (transportation_writes.tab_rows: its own table, else the copy with Python's own edits laid); a house
    neither kept in a table nor declared throws its sentence."""
    if not TW.HT.tabled(tab) and not reads.db.house_moved(tab):
        raise RuntimeError(f'The Transportation house "{tab}" is not set up (no pointer, or moved.{tab} is not on).')
    return TW.tab_rows(reads, tab)


def rows(reads: L.Reads) -> dict[str, Any]:
    """vcRows_: { vehicles, trips, inbox, inbox_why }; the vehicles and trips must read, the items may not."""
    def read() -> dict[str, Any]:
        vehicles, trips = must(reads, TABS["vehicles"]), must(reads, TABS["trips"])
        inbox, why = soft(lambda: load(reads, TABS["inbox"]))
        return {"vehicles": vehicles, "trips": trips, "inbox": inbox, "inbox_why": why}
    return reads.once("vc:rows", read)


def must(reads: L.Reads, tab: str) -> list[dict]:
    """A house the answer cannot stand without: unreadable, Apps Script answers (and logs) its own failure."""
    got, why = soft(lambda: load(reads, tab))
    if got is None:
        raise Defer(why)
    return got


# ---- test mode -------------------------------------------------------------------------------------------------------

def test_mode(reads: L.Reads) -> dict[str, Any]:
    """vcTestMode_ over hubTestModeState_: anything unreadable or unknown is on."""
    import scheduling as SCH  # noqa: PLC0415 - Scheduling's port of the same switch
    return SCH.test_mode(reads)


def test_word(reads: L.Reads) -> str:
    """vcTestWord_."""
    return "no" if test_mode(reads).get("on") is False else "yes"


# ---- accounts --------------------------------------------------------------------------------------------------------

def live(u: dict | None) -> bool:
    """vcLive_."""
    off = s_((u or {}).get("active")).upper()
    return bool(u) and off not in ("FALSE", "0", "NO") and not s_(u.get("mergedinto"))


def account(reads: L.Reads, uid: Any) -> dict | None:
    """vcAccount_: the live account with this id."""
    i = s_(uid)
    if not i:
        return None
    return next((u for u in reads.users() if s_(u.get("userid")) == i and live(u)), None)


def sendable(raw: Any) -> str:
    """packetSendableNumber_."""
    import staff_comms as SC  # noqa: PLC0415 - the shared lines are named there
    d = re.sub(r"^1", "", re.sub(r"\D", "", gsjs.or_text(raw)))
    if len(d) != 10 or d in SC.SHARED_LINE_DIGITS:
        return ""
    return "+1" + d


def account_phones(u: dict | None) -> list[str]:
    """vcAccountPhones_: the account's own numbers, its sign-in phone first, each one this platform may text."""
    if not u:
        return []
    import staff as SP  # noqa: PLC0415 - the Staff core loads beside this module
    tries = [u.get("phone")]
    for p in SP._parse_phones(u.get("phones")):
        tries.append(p.get("number") if isinstance(p, dict) else p)
    out: list[str] = []
    for t in tries:
        n = sendable(t)
        if n and n not in out:
            out.append(n)
    return out


def phone_of(reads: L.Reads, uid: Any) -> str:
    """vcPhoneOf_: the settings' text_to, then the account's phone, then its phones."""
    i = s_(uid)
    if not i:
        return ""
    over = sendable(settings(reads)["text_to"].get(i))
    return over or (account_phones(account(reads, i)) or [""])[0]


def people(reads: L.Reads) -> dict[str, Any]:
    """vcPeople_: live staff-side accounts as pickers, {readable, why, rows, by_key, by_uid}."""
    def read() -> dict[str, Any]:
        out: dict[str, Any] = {"readable": False, "why": "", "rows": []}
        seen: dict[str, list[dict]] = {}
        for u in reads.users():
            # an SSA or a FAMILY is never a driver or a rider here, whatever its role says (scope.role_counts)
            if not live(u) or s_(u.get("role")).lower() not in STAFF_ROLES or not sc.role_counts(u.get("types"), u.get("role")):
                continue
            name, uid = s_(u.get("displayname")), s_(u.get("userid"))
            key = gsjs.name_key(name)
            if not key or not uid:
                continue
            row: dict[str, Any] = {"key": key, "uid": uid, "name": name}
            # kept for lookups, left out of the picker
            if sc.is_master_email(u.get("email")):
                row["unlisted"] = True
            seen.setdefault(key, []).append(row)
        dropped = 0
        for k in seen:
            if len(seen[k]) > 1:
                dropped += 1
                continue
            out["rows"].append(seen[k][0])
        out["rows"].sort(key=by_locale(lambda p: p["name"]))
        out["readable"] = True
        if dropped:
            out["why"] = (f"{dropped} name{' is' if dropped == 1 else 's are'} worn by two live accounts and left out of "
                          "the staff list")
        out["by_key"] = {p["key"]: p for p in out["rows"]}
        out["by_uid"] = {p["uid"]: p for p in out["rows"]}
        return out
    return reads.once("vc:people", read)


def clients(reads: L.Reads) -> dict[str, Any]:
    """vcClients_: the active client roster (cpRosterBuild_) as pickers, {readable, why, rows:[{key, name}]}."""
    def read() -> dict[str, Any]:
        import clients as C  # noqa: PLC0415 - the Clients core loads beside this module
        out: dict[str, Any] = {"readable": False, "why": "", "rows": []}
        data, why = soft(lambda: C.roster_build(reads, False))
        if why:
            out["why"] = f"the client roster could not be read ({why})"
            return out
        if not isinstance(data, dict) or not isinstance(data.get("clients"), list):
            out["why"] = "the client roster answered in a shape this app does not read"
            return out
        seen: set[str] = set()
        for c in data["clients"]:
            key, name = s_((c or {}).get("client_key")), s_((c or {}).get("name"))
            if not key or not name or key in seen:
                continue
            seen.add(key)
            out["rows"].append({"key": key, "name": name})
        out["rows"].sort(key=by_locale(lambda c: c["name"]))
        out["readable"] = True
        return out
    return reads.once("vc:clients", read)


def driver_word(d: dict | None) -> dict[str, Any]:
    """vcDriverWord_: may_drive true, false, or None when unknown."""
    if not d or d.get("ambiguous"):
        return {"may_drive": None, "word": "Two Employee Database rows carry this name"}
    if not d.get("found"):
        return {"may_drive": None, "word": "Driving record unreadable" if d.get("unread") else "No driving record"}
    if d.get("driver") is False:
        return {"may_drive": False, "word": "Not a driver"}
    ls = d.get("license_standing")
    if ls and ls.get("state") == "invalid":
        return {"may_drive": False, "word": gsjs.text(ls.get("word"), 60) or "Licence not valid"}
    if d.get("driver") is True:
        return {"may_drive": True, "word": "Cleared to drive"}
    return {"may_drive": None, "word": "No driving record"}


def _reading(read: dict, key: str, keep: bool) -> dict:
    """One driving tab read as Apps Script would, with this key's withheld licence there (keep) or no row at all."""
    idx = read.get("index") if read else None
    if not idx:
        return read
    rows_ = dict(idx["rows"])
    hit = rows_.get(key)
    if hit and hit.get("ambiguous") and key in idx["unsure"]:
        raise Defer("the copy withholds the licence number that decides which driving row is this person's")
    if hit and not hit.get("ambiguous"):
        if key in idx["unsure"] and not keep:
            rows_.pop(key)
        else:
            rows_[key] = {**hit, "fields": {**hit["fields"], "_dl_withheld": False}}
    return {**read, "index": {**idx, "rows": rows_, "unsure": set(idx["unsure"]) - {key}}}


def _word_of(key: str, main: dict, comp: dict, today: str) -> dict[str, Any]:
    """spDrivingFrom_ read into its word; a licence number the copy withholds counts only when it changes the word."""
    import staff as SP  # noqa: PLC0415 - the Staff core loads beside this module
    try:
        return driver_word(SP.driving_from(key, main, comp, today, 0))
    except Defer:
        pass
    words = [driver_word(SP.driving_from(key, _reading(main, key, k), _reading(comp, key, k), today, 0))
             for k in (True, False)]
    if words[0] != words[1]:
        raise Defer("the copy withholds the licence number that decides whether this person has a driving row")
    return words[0]


def drivers(reads: L.Reads, keys: list[str]) -> dict[str, Any]:
    """vcDrivers_: {readable, why, map:{key:{may_drive, word}}} from employee driver and Driver Compliance."""
    want = sorted(k for k in (keys or []) if k)
    tag = hashlib.sha256("|".join(want).encode("utf-8")).hexdigest()[:10]

    def read() -> dict[str, Any]:
        import staff as SP  # noqa: PLC0415 - the Staff core loads beside this module
        out: dict[str, Any] = {"readable": False, "why": "", "map": {}}

        def one(tab: str) -> dict[str, Any]:
            got, why = soft(lambda: SP.driver_index(reads, tab))
            return {"index": got, "why": ""} if got is not None else \
                {"index": None, "why": f"the {tab} tab could not be read ({why})"}
        main, comp = one(SP.DRIVER_TAB), one(SP.DRIVER_COMPLIANCE_TAB)
        if not main["index"] and not comp["index"]:
            out["why"] = "; ".join([main["why"], comp["why"]])
            return out
        today = TW.day_of(now_ms(reads))
        for k in want:
            got, why = soft(lambda k=k: _word_of(k, main, comp, today))
            out["map"][k] = got if got is not None else driver_word(None)
        out["readable"] = True
        out["why"] = "; ".join(w for w in (main["why"], comp["why"]) if w)
        return out
    return reads.once("vc:drivers:" + tag, read)


# ---- settings --------------------------------------------------------------------------------------------------------

def trip_types_of(raw: Any) -> list[str] | None:
    """vcTripTypesOf_."""
    items = jparse(raw, None)
    if not isinstance(items, list):
        return None
    out: list[str] = []
    for t in items:
        x = gsjs.text(t, 40)
        if x and x not in out:
            out.append(x)
    return out or None


def resolve_directors(reads: L.Reads, raw: Any) -> dict[str, Any]:
    """vcResolveDirectors_: each address through userByEmail_, kept only when the account is live."""
    import staff_perf as SPF  # noqa: PLC0415 - userByEmail_'s port
    out: dict[str, Any] = {"list": [], "missed": [], "why": ""}
    emails = [x for x in (gsjs.trim(t).lower() for t in re.split(r"[,;\s]+", s_(raw))) if x.find("@") > 0]
    for email in emails:
        u = SPF.user_by_email(reads, email)
        if u and live(u):
            uid = s_(u.get("userid"))
            if not any(d["uid"] == uid for d in out["list"]):
                out["list"].append({"email": email, "uid": uid, "name": s_(u.get("displayname")) or email})
        else:
            out["missed"].append(email)
    return out


def settings(reads: L.Reads) -> dict[str, Any]:
    """vcSettings_: the settings house over the shipped defaults."""
    def read() -> dict[str, Any]:
        out: dict[str, Any] = {"readable": True, "why": "", "directors": [], "directors_readable": False,
                               "directors_why": "", "trip_types": trip_types_of(SETTING_DEFAULTS["trip_types"]),
                               "text_to": {}, "import_minutes": 120, "seeded_at": "", "imported_at": "",
                               "import_report": None, "raw": {}}
        kv: dict[str, Any] = {}
        got, why = soft(lambda: load(reads, TABS["settings"]))
        if got is None:
            out["readable"], out["why"] = False, why
        else:
            for r in got:
                kv[r["key"]] = r.get("value")
        out["raw"] = kv
        out["trip_types"] = trip_types_of(kv.get("trip_types")) or out["trip_types"]
        tt = jparse(kv.get("text_to"), {})
        out["text_to"] = tt if isinstance(tt, dict) else {}
        mins = int_of(kv.get("import_minutes"), 120)
        out["import_minutes"] = mins if 15 <= mins <= 720 else 120
        out["seeded_at"] = s_(kv.get("seeded_at"))
        out["imported_at"] = s_(kv.get("imported_at"))
        out["import_report"] = jparse(kv.get("import_report"), None)
        raw = kv.get("directors") if out["readable"] and s_(kv.get("directors")) else SETTING_DEFAULTS["directors"]
        res = resolve_directors(reads, raw)
        out["directors"] = res["list"]
        out["directors_readable"] = len(res["list"]) > 0
        whys: list[str] = []
        if not out["readable"]:
            whys.append(f"The Transportation settings could not be read, so the shipped list is used ({out['why']}).")
        if res["why"]:
            whys.append(f"The {res['why']}.")
        if res["missed"]:
            whys.append("No live account answers " + ", ".join(res["missed"]) + ".")
        if not res["list"] and not res["missed"] and not res["why"]:
            whys.append("No directors are written in the Transportation settings.")
        out["directors_why"] = " ".join(whys)
        return out
    return reads.once("vc:settings", read)


def settings_public(reads: L.Reads) -> dict[str, Any]:
    """vcSettingsPublic_."""
    s = settings(reads)
    return {"readable": s["readable"], "why": s["why"],
            "directors": [{"uid": d["uid"], "name": d["name"], "email": d["email"]} for d in s["directors"]],
            "directors_readable": s["directors_readable"], "directors_why": s["directors_why"],
            "trip_types": s["trip_types"],
            "text_to": [{"uid": uid, "to": phone_words(to)} for uid, to in s["text_to"].items()],
            "import_minutes": s["import_minutes"], "seeded": bool(s["seeded_at"]), "seeded_at": s["seeded_at"],
            "imported_at": s["imported_at"]}


# ---- the gate --------------------------------------------------------------------------------------------------------

def visiting(user: dict | None) -> bool:
    """vcVisiting_."""
    return not user or bool(user.get("is_service")) or bool(user.get("visiting_member"))


def acting_id(user: dict | None) -> str:
    """hubActingUserId_."""
    return gsjs.str_(user.get("id")) if user and not user.get("is_service") else ""


def user_name(user: dict | None) -> str:
    """vcUserName_."""
    u = user or {}
    return s_(u.get("display_name") if u.get("display_name") is not None else u.get("displayname")) or s_(u.get("email"))


def gate(sess: L.Session) -> dict[str, Any]:
    """vcGate_: {open, uid, name, email, key, is_master, is_director, can_edit, visiting}; closed reads as Unknown action."""
    user = sess.user

    def read() -> dict[str, Any]:
        g: dict[str, Any] = {"open": False, "uid": "", "name": "", "email": "", "key": "", "is_master": False,
                             "is_director": False, "can_edit": False, "visiting": True}
        got = sc.profile_app_gate(APP_ID, user, sess.reads.scope_sources())
        if not got or not got.get("open"):
            return g
        g["open"] = True
        g["uid"] = acting_id(user)
        g["name"] = user_name(user)
        g["email"] = s_((user or {}).get("email")).lower()
        g["visiting"] = visiting(user)
        g["is_master"] = sc.is_real_master(user)
        g["is_director"] = bool(g["uid"]) and any(d["uid"] == g["uid"] for d in settings(sess.reads)["directors"])
        g["can_edit"] = g["is_master"] or g["is_director"]
        me = people(sess.reads)["by_uid"].get(g["uid"])
        g["key"] = me["key"] if me else ""
        return g
    return dict(sess.reads.once("vc:gate:" + acting_id(user), read))


def client_gate(sess: L.Session, g: dict, client_key: str) -> dict[str, Any]:
    """vcClientGate_, FAIL-CLOSED: a client's trips to the app's editors, and to a clients.transportation holder."""
    if not client_key:
        return g
    user = sess.user
    lent = False
    if not g.get("can_edit"):
        if CW.edit_door(sess, {"client": client_key}, CP_EDITION_TRANSPORT) is not None:
            return g
        lent = not g.get("open")
    h = dict(g)
    h["client"] = client_key
    if not lent:
        return h
    h["open"] = True
    h["lent"] = True
    h["uid"] = acting_id(user)
    h["name"] = user_name(user)
    h["email"] = s_((user or {}).get("email")).lower()
    h["visiting"] = visiting(user)
    me = people(sess.reads)["by_uid"].get(h["uid"])
    h["key"] = me["key"] if me else ""
    return h


# ---- vehicles and trips as the board shows them ----------------------------------------------------------------------

def vehicle_details(description: Any, seats: int, accessible: bool) -> str:
    """vcVehicleDetails_."""
    parts = []
    if s_(description):
        parts.append(s_(description))
    if seats:
        parts.append(f"{seats} seat{'' if seats == 1 else 's'}")
    if accessible:
        parts.append("Wheelchair accessible")
    return " · ".join(parts)


def vehicle_out(r: dict) -> dict[str, Any]:
    """vcVehicleOut_."""
    seats = int_of(r.get("seats"), 0)
    acc = yes(r.get("wheelchair_accessible"))
    tint = s_(r.get("tint"))
    return {"id": s_(r.get("id")), "name": s_(r.get("name")), "description": s_(r.get("description")), "seats": seats,
            "wheelchair_accessible": acc, "availability": TW.availability_of(r.get("availability")),
            "tint": tint if tint in TINTS else "blue", "order": TW.js_number(r.get("order")) or 0,
            "details": vehicle_details(r.get("description"), seats, acc), "note": s_(r.get("note"))}


def trip_out(t: dict, v_by: dict[str, dict]) -> dict[str, Any]:
    """vcTripOut_."""
    s, e = ms_of(t.get("start_at")), ms_of(t.get("end_at"))
    veh, req = v_by.get(t.get("vehicle_id")), v_by.get(t.get("requested_vehicle_id"))
    return {
        "id": t.get("id"), "state": t.get("state") if t.get("state") in STATES else "requested",
        "vehicle_id": t.get("vehicle_id"), "vehicle_name": s_(veh.get("name")) if veh else "",
        "requested_vehicle_id": t.get("requested_vehicle_id"), "requested_vehicle_name": s_(req.get("name")) if req else "",
        "start_at": t.get("start_at"), "end_at": t.get("end_at"), "day": t.get("day"),
        "start_label": "" if s is None else TW.hm_of(s), "end_label": "" if e is None else TW.hm_of(e),
        "end_known": t.get("end_known") != "no",
        "wheelchair_required": yes(t.get("wheelchair_required")), "trip_type": t.get("trip_type"),
        "purpose": t.get("purpose"), "destination": t.get("destination"), "details": t.get("details"),
        "client_key": t.get("client_key"), "client_name": t.get("client_name"), "staff_key": t.get("staff_key"),
        "staff_name": t.get("staff_name"), "driver_key": t.get("driver_key"), "driver_name": t.get("driver_name"),
        "requested_by": {"uid": t.get("requested_by_uid"), "name": t.get("requested_by_name")},
        "decided_by": t.get("decided_by_name"), "decided_at": t.get("decided_at"), "decision_note": t.get("decision_note"),
        "assign_note": t.get("assign_note"), "source": t.get("source"), "test_mode": t.get("test_mode") == "yes",
        "created_at": t.get("created_at"), "updated_at": t.get("updated_at")}


def trip_word(t: dict, at: float) -> dict[str, str]:
    """vcTripWord_: In use and Completed are read off a scheduled trip, never stored."""
    if t["state"] == "scheduled":
        s, e = TW.span_of(t)
        if e is not None and e <= at:
            return {"word": "Completed", "tone": "grey"}
        if s is not None and s <= at:
            return {"word": "In use", "tone": "mint"}
        return {"word": "Scheduled", "tone": "blue"}
    if t["state"] == "needs_assignment":
        return {"word": "Needs assignment", "tone": "peach"}
    if t["state"] == "declined":
        return {"word": "Declined", "tone": "rose"}
    if t["state"] == "cancelled":
        return {"word": "Cancelled", "tone": "grey"}
    return {"word": "Requested", "tone": "amber"}


def vehicle_status(v: dict, active: dict | None) -> dict[str, str]:
    """vcVehicleStatus_."""
    if v["availability"] == "maintenance":
        return {"word": "Maintenance", "tone": "peach"}
    if v["availability"] == "out_of_service":
        return {"word": "Out of service", "tone": "grey"}
    if active:
        return {"word": "In use", "tone": "amber"}
    return {"word": "Available", "tone": "mint"}


# ---- the board: the houses built once per request, cut per viewer ----------------------------------------------------

def source(key: str, state: bool, why: Any, count: int) -> dict[str, Any]:
    """vcSource_."""
    return {"key": key, "state": "ready" if state else "unreadable", "why": s_(why), "count": count}


def base_trips(reads: L.Reads) -> list[dict]:
    """The last 400 days of trips in the board's shape, in time order."""
    def read() -> list[dict]:
        got = rows(reads)
        v_by = TW.index(got["vehicles"])
        frm = iso_add(TW.day_of(now_ms(reads)), -HISTORY_DAYS)
        trips = [trip_out(t, v_by) for t in got["trips"] if not t.get("day") or t.get("day") >= frm]
        trips.sort(key=lambda t: gsjs.or_blank(t["start_at"]))
        return trips
    return reads.once("vc:base_trips", read)


def build_base(reads: L.Reads) -> dict[str, Any]:
    """vcBuildBase_: vehicles, trips, who each request waits on, the settings — what nobody's eyes change."""
    def read() -> dict[str, Any]:
        got = rows(reads)
        st = settings(reads)
        vehicles = [vehicle_out(r) for r in got["vehicles"]]
        vehicles.sort(key=functools.cmp_to_key(
            lambda a, b: (-1 if a["order"] < b["order"] else 1) if a["order"] != b["order"]
            else gsjs.locale_cmp(a["name"], b["name"])))
        trips = base_trips(reads)
        waiting = [{"id": r.get("id"), "trip_id": r.get("trip_id"), "seat": s_(r.get("seat")), "to_uid": r.get("to_uid"),
                    "to_name": r.get("to_name")}
                   for r in got["inbox"] or [] if r.get("box") == "work" and r.get("state") == "waiting"]
        return {
            "vehicles": vehicles, "trips": trips, "waiting": waiting,
            "settings": {"directors": [{"uid": d["uid"], "name": d["name"]} for d in st["directors"]],
                         "directors_readable": st["directors_readable"], "directors_why": st["directors_why"],
                         "trip_types": st["trip_types"], "seeded": bool(st["seeded_at"]), "imported_at": st["imported_at"]},
            "sources": [source("vehicles", True, "", len(vehicles)), source("trips", True, "", len(trips)),
                        source("inbox", got["inbox"] is not None, got["inbox_why"],
                               len(got["inbox"]) if got["inbox"] is not None else 0),
                        source("settings", st["readable"], st["why"], len(st["raw"] or {}))],
            "degraded": got["inbox"] is None or not st["readable"]}
    return reads.once("vc:base", read)


def trip_private(t: dict, w: dict) -> dict[str, Any]:
    """vcTripPrivate_: when and on what, never who or why."""
    return {"id": t["id"], "state": t["state"], "word": w["word"], "tone": w["tone"], "vehicle_id": t["vehicle_id"],
            "vehicle_name": t["vehicle_name"], "start_at": t["start_at"], "end_at": t["end_at"], "day": t["day"],
            "start_label": t["start_label"], "end_label": t["end_label"], "private": True, "mine": False}


def whole(g: dict) -> bool:
    """Who reads every trip whole: the directors and the master, and a holder of the trips edition."""
    return bool(g.get("can_edit") or g.get("trips_edition"))


def cut(base: dict, g: dict, at: float) -> dict[str, Any]:
    """vcCut_: the viewer's cut of the base — privacy, the waiting items, the KPIs and every word read at `at`."""
    wait_on: dict[str, list[dict]] = {}
    for w in base["waiting"]:
        wait_on.setdefault(w["trip_id"], []).append(w)
    trips = []
    for t in base["trips"]:
        w = trip_word(t, at)
        mine = bool(g.get("uid") and t["requested_by"] and t["requested_by"]["uid"] == g["uid"])
        if not whole(g) and not mine and not (g.get("client") and t["client_key"] == g["client"]):
            trips.append(trip_private(t, w))
            continue
        o = {**t, "requested_by": dict(t["requested_by"])}
        o["word"], o["tone"], o["mine"] = w["word"], w["tone"], mine
        if t["state"] == "requested":
            o["seats"] = [{"to": [x["to_name"] for x in wait_on.get(t["id"], [])], "state": "waiting", "by": "", "at": ""}]
        trips.append(o)
    vehicles = []
    for v in base["vehicles"]:
        o = {k: x for k, x in v.items() if k != "note"}
        active: dict | None = None
        nxt: dict | None = None
        for t in base["trips"]:
            if t["state"] != "scheduled" or t["vehicle_id"] != v["id"]:
                continue
            s, e = TW.span_of(t)
            if s is not None and e is not None and s <= at < e:
                active = active or t
            elif s is not None and s > at and (nxt is None or s < (ms_of(nxt["start_at"]) or 0)):
                nxt = t
        o["status"] = vehicle_status(v, active)
        if active:
            o["active_trip"] = {"id": active["id"], "start_at": active["start_at"], "end_at": active["end_at"]}
        if nxt:
            o["next_trip"] = {"id": nxt["id"], "start_at": nxt["start_at"], "end_at": nxt["end_at"]}
        vehicles.append(o)
    kpis = {"needs_assignment": 0, "scheduled": 0, "in_service": 0}
    for t in base["trips"]:
        e = ms_of(t["end_at"])
        if e is None or not e > at:
            continue
        if t["state"] in ("requested", "needs_assignment"):
            kpis["needs_assignment"] += 1
        elif t["state"] == "scheduled":
            kpis["scheduled"] += 1
    kpis["in_service"] = sum(1 for v in base["vehicles"] if v["availability"] == "available")
    wait_rows: list[dict] = []
    if g.get("uid"):
        held: dict[str, bool] = {}
        for w in base["waiting"]:
            if w["to_uid"] == g["uid"]:
                wait_rows.append(w)
                held[w["trip_id"]] = True
        # the master stands in on a director seat of every request the master did not file
        if g.get("is_master") and not g.get("visiting"):
            for t in base["trips"]:
                if t["requested_by"] and t["requested_by"]["uid"] == g["uid"]:
                    held[t["id"]] = True
            for w in base["waiting"]:
                if w["seat"] != "director" or held.get(w["trip_id"]):
                    continue
                held[w["trip_id"]] = True
                wait_rows.append(w)
    return {"trips": trips, "vehicles": vehicles, "kpis": kpis,
            "waiting": [{"item_id": w["id"], "trip_id": w["trip_id"]} for w in wait_rows]}


def board(reads: L.Reads, g: dict) -> dict[str, Any]:
    """vcBoard_: the base cut at this instant, plus the pickers."""
    at = now_ms(reads)
    base = build_base(reads)
    c = cut(base, g, at)
    ppl, cls = people(reads), clients(reads)
    sources = list(base["sources"])
    sources.append(source("people", ppl["readable"], ppl["why"], len(ppl["rows"] or [])))
    sources.append(source("clients", cls["readable"], cls["why"], len(cls["rows"] or [])))
    out: dict[str, Any] = {
        "ok": True, "now": TW.iso_of(at), "today": TW.day_of(at), "stamp": stamp(at),
        "viewer": {"uid": g["uid"], "name": g["name"], "is_master": g["is_master"], "is_director": g["is_director"],
                   "can_edit": g["can_edit"],
                   "can_request": bool(g["open"] and not g.get("lent") and not g["visiting"]
                                       and base["settings"]["directors_readable"]),
                   "visiting": g["visiting"], "client": g.get("client") or ""},
        "test_mode": test_mode(reads), "settings": base["settings"],
        "vehicles": c["vehicles"], "trips": c["trips"], "kpis": c["kpis"],
        "people": [{"key": p["key"], "uid": p["uid"], "name": p["name"]} for p in ppl["rows"] or []
                   if not p.get("unlisted")],
        # a holder's trip stays with its client: the picker names that client alone
        "clients": [x for x in cls["rows"] or [] if g["can_edit"] or not g.get("client") or x["key"] == g["client"]],
        "waiting": c["waiting"], "sources": sources, "note": ""}
    if whole(g) or g.get("client"):
        drv = drivers(reads, [p["key"] for p in ppl["rows"] or []])
        out["drivers"] = drv["map"] or {}
        sources.append(source("drivers", drv["readable"], drv["why"], len(drv["map"] or {})))
    down = [s for s in sources if s["state"] != "ready"]
    if down:
        out["note"] = "Not everything could be read: " + "; ".join(f"{s['key']} ({s['why']})" for s in down) + "."
    return out


# ---- Clients › Appointments and Staff › Calendar read the board's trips, by the platform's own keys ------------------

def person_trip_out(t: dict, at: float) -> dict[str, Any]:
    """vcPersonTripOut_: when, on what, who drives and rides, where to; never its notes."""
    w = trip_word(t, at)
    return {"id": t["id"], "state": t["state"], "word": w["word"], "tone": w["tone"], "day": t["day"],
            "start_at": t["start_at"], "end_at": t["end_at"], "start_label": t["start_label"],
            "end_label": t["end_label"] if t["end_known"] else "",
            "vehicle_name": t["vehicle_name"] if t["state"] == "scheduled" else "", "trip_type": t["trip_type"],
            "purpose": t["purpose"], "destination": t["destination"], "wheelchair_required": bool(t["wheelchair_required"]),
            "client_key": t["client_key"], "client_name": t["client_name"], "staff_name": t["staff_name"],
            "driver_name": t["driver_name"]}


def person_trips(reads: L.Reads, role_of: Callable[[dict], Any], frm: str) -> dict[str, Any]:
    """vcPersonTrips_: the live trips `role_of` names a role on, from `frm` on, in time order."""
    at = now_ms(reads)
    trips = []
    for t in base_trips(reads):
        if t["state"] not in PERSON_STATES or (frm and gsjs.or_blank(t["day"]) < frm):
            continue
        role = role_of(t)
        if not role:
            continue
        o = person_trip_out(t, at)
        if role is not True:
            o["role"] = role
        trips.append(o)
    return {"ok": True, "today": TW.day_of(at), "trips": trips}


# ---- the doors -------------------------------------------------------------------------------------------------------

def board_read(sess: L.Session, payload: dict) -> dict[str, Any]:
    """vehicleCalendarBoard: vehicles, trips, the viewer's waiting approvals and the pickers, cut per viewer. One
    client's board is Clients › Transportation's Calendar, shut where App Control's Transportation row shuts the tab."""
    import clients as C  # noqa: PLC0415 - the Transportation row is the Clients module's own
    p = payload if isinstance(payload, dict) else {}
    client = gsjs.text(p.get("client"), 120)
    if client and not C.transport_open(sess):
        return closed()
    g = client_gate(sess, gate(sess), client)
    if not g.get("open"):
        return closed()
    g["trips_edition"] = not g.get("can_edit") and TW.edition_holds(sess, g, TRIPS_EDITION)
    return {"status": 200, "data": board(sess.reads, g)}


def client_trips(sess: L.Session, payload: dict) -> dict[str, Any]:
    """vehicleCalendarClientTrips: one client's trips by key, for whoever Clients › Appointments opens it to and App
    Control's Transportation row names (the trips are that tab's data, shut to Family and the client alike)."""
    import clients as C  # noqa: PLC0415 - csApptGate_ is the Clients reader
    p = payload if isinstance(payload, dict) else {}
    key = gsjs.text(p.get("client"), 120)
    user = sess.user
    reader = C.reader_for(sess, key) if key and user and not user.get("is_service") else None
    if not reader or not C.transport_open(sess):
        return closed()
    data = person_trips(sess.reads, lambda t: t["client_key"] == key, "")
    data["client"] = key
    return {"status": 200, "data": data}


def staff_trips(sess: L.Session, payload: dict) -> dict[str, Any]:
    """vehicleCalendarStaffTrips: one staff member's trips as driver or companion, from last week on."""
    import staff as SP  # noqa: PLC0415 - spWholeGate_ is Staff's
    if not SP.whole_gate(sess):
        return closed()
    p = payload if isinstance(payload, dict) else {}
    key = s_(p.get("person"))
    if not STAFF_KEY.match(key):
        return {"status": 400, "message": "person: a staff key."}
    # Staff's own-profile rule: a viewer it opens to their own profile alone reads no one else's trips here
    own = SP.own_only(sess)
    if own is not None and key != own:
        return {"status": 403, "message": SP.OWN_ONLY_WORDS}
    frm = iso_add(TW.day_of(now_ms(sess.reads)), -7)
    data = person_trips(sess.reads, lambda t: "driver" if t["driver_key"] == key else
                        ("companion" if t["staff_key"] == key else ""), frm)
    data["person"] = key
    return {"status": 200, "data": data}


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {
    "vehicleCalendarBoard": board_read, "vehicleCalendarClientTrips": client_trips,
    "vehicleCalendarStaffTrips": staff_trips}
_READERS = ("admin", "director", "manager", "staff")
# HUB_POLICY: the roles each read is declared for, and its typed params
POLICY: dict[str, dict[str, Any]] = {
    "vehicleCalendarBoard": {"roles": _READERS, "params": {"client": "string"}},
    "vehicleCalendarClientTrips": {"roles": _READERS + ("client", "onboarding", "interviewer"),
                                   "params": {"client": "string"}},
    "vehicleCalendarStaffTrips": {"roles": _READERS + ("onboarding", "interviewer"), "params": {"person": "string"}}}
