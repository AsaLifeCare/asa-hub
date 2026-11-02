"""The JSON lane: the bang (/bundle, the whole site's data in one JSON, cut per role), a place's own bundle (/place,
and one tab out of it), and the bundle loop that keeps a deposit per place in /srv/bundles off the bundles doors
(app/bundles.py) while HUB_BUNDLE_LANE is on. The sheet rows these doors read (the access matrices, the accounts, the
members) come from asa-hub-db's copy of the Core book with the kept edits laid, never from Google."""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import time
from pathlib import Path
from typing import Any

from fastapi import Request
from fastapi.responses import Response

import house_tables as HT
import hubdb
import locations as L
import slice_gate

log = logging.getLogger("asa-hub-app.live-bundle")

CORE_ID = os.getenv("HUB_DB_SHEET_ID", "1ia6i0SFiVNhn4wi6bt6EDcGwReS0P7-L4Up2hRfIVPg")
ESSENCIAL_SHEET_ID = os.getenv("HUB_ESSENCIAL_SHEET_ID", "1Y6UMJlCS5gHur52f0YrPsLSqwYlCA792I8gAiZsxsug")
BUNDLE_LANE = os.getenv("HUB_BUNDLE_LANE", "") not in ("", "0", "false", "no")
BUNDLE_DIR = Path(os.getenv("HUB_BUNDLE_DIR", "/srv/bundles"))
BUNDLE_MAX_AGE_S = int(os.getenv("HUB_BUNDLE_MAX_AGE_S", "900"))
BUNDLE_MIN_INTERVAL_S = int(os.getenv("HUB_BUNDLE_MIN_INTERVAL_S", "300"))
BUNDLE_READER_MIN = int(os.getenv("HUB_BUNDLE_READER_MIN", "2"))
BUNDLE_FULL_EVERY = int(os.getenv("HUB_BUNDLE_FULL_EVERY", "10"))
BUNDLE_PARTS = max(1, int(os.getenv("HUB_BUNDLE_PARTS", "2")))
BUNDLE_CYCLE_TIMEOUT_S = float(os.getenv("HUB_BUNDLE_CYCLE_TIMEOUT_S", "900"))
BUNDLE_CYCLE_BUDGET_S = float(os.getenv("HUB_BUNDLE_CYCLE_BUDGET_S", "600"))
BUNDLE_BUILD_TIMEOUT_S = min(600.0, max(10.0, float(os.getenv("HUB_BUNDLE_BUILD_TIMEOUT_S", "300"))))
BUNDLE_TAB_MAX_BYTES = int(os.getenv("HUB_BUNDLE_TAB_MAX_BYTES", str(2 * 1024 * 1024)))
PLACE_BADGE_GATE = os.getenv("HUB_PLACE_BADGE_GATE", "0") == "1"
BUNDLE_APP = "bundles"
SERVICE = {"is_service": True}
PLACE_MEMBERS_TAB = "platform_members"
PLACE_MEMBERS_HOUSE = "switchboard:props.HUB_HOUSE_PLATFORM_MEMBERS_ID"
PLACE_MEMBERS_MOVED = "switchboard:moved." + PLACE_MEMBERS_TAB
CALENDAR_BADGE_APPS = frozenset({"calendarbuilder", "shiftboard"})
CALENDAR_BADGES_TTL_S = float(os.getenv("HUB_CALENDAR_BADGES_TTL_S", "60"))
CALENDAR_BUILDER_APP = "calendarbuilder"

# set by live_plane: main.py (DB, _own), the front door (sessions, in-process doors), the slices
M: Any = None
FD: Any = None
SLICES: Any = None

LAST_BUILD = {"at": 0.0}
REVS: dict[str, dict[str, str]] = {}
OWNED_REVS: dict[str, dict[str, str]] = {}
OWNED_AT: dict[str, int] = {}
HELD: dict[str, dict[str, Any]] = {}
WORLD_OWNERS: dict[str, str] = {}
CYCLES = {"n": 0}
CURSOR = {"i": 0}
BUDGET = {"overruns": 0, "at": 0.0}
FULL_OWED: set[str] = set()
LAST: dict[str, Any] = {"at": 0.0, "built_at": "", "resources": {}}
_RESOURCE_APPS: dict[str, list[str]] = {}
_RESOURCE_GATES: dict[str, dict[str, list[str]] | None] = {}
_BUNDLE_ACCESS: dict[str, tuple[float, dict[str, list[str]]]] = {}
_CALENDAR_BADGES: dict[str, tuple[float, frozenset[str]]] = {}


def _iso(ts: str | None) -> Any:
    if not ts:
        return None
    try:
        from datetime import datetime
        return datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
    except ValueError:
        return None


# ---- the Core book's rows off asa-hub-db --------------------------------------------------------------------------

def core_rows(tab: str, sheet_id: str = CORE_ID) -> list[dict[str, Any]]:
    """Blocking: one tab's rows ({header: text}, in sheet order) with the kept edits laid; [] when not copied."""
    db = M.DB
    token = hubdb.OWN.set(M._own())
    try:
        ref = HT.book_tab(L.Reads(db, None), sheet_id, tab)
        if ref is None:
            return []
        return [{k: ("" if v is None else str(v)) for k, v in raw.items()} for _rn, raw in db.rows(ref)]
    finally:
        hubdb.OWN.reset(token)


def bundle_access(tab: str, key_field: str, value_field: str, upper: bool = False) -> dict[str, list[str]]:
    """One Core access matrix for the bang; an unread one is left out, never sent empty."""
    hit = _BUNDLE_ACCESS.get(tab)
    if hit and time.time() - hit[0] < 60:
        return hit[1]
    out: dict[str, list[str]] = {}
    try:
        for r in core_rows(tab):
            key = str(r.get(key_field) or "").strip()
            if not key:
                continue
            words = [w.strip() for w in str(r.get(value_field) or "").split(",") if w.strip()]
            out[key] = [w.upper() for w in words] if upper else words
    except Exception as exc:  # noqa: BLE001
        log.warning("bundle access %s unreadable: %s", tab, exc)
        return {}
    if out:
        _BUNDLE_ACCESS[tab] = (time.time(), out)
    return out


def user_badges(uid: str) -> str:
    """The badge column of this person's row."""
    if not uid:
        return ""
    try:
        return next((str(r.get("types") or "") for r in core_rows("users") if r.get("user_id") == str(uid)), "")
    except Exception as exc:  # noqa: BLE001 - the role still answers
        log.warning("badge column unavailable for %s: %s", uid, exc)
        return ""


def badges_of(role: str, types: Any) -> set[str]:
    worn: set[str] = set()
    if isinstance(types, str):
        worn |= {t.strip().upper() for t in types.split(",") if t.strip()}
    elif isinstance(types, list):
        worn |= {str(t).strip().upper() for t in types if str(t).strip()}
    if role:
        worn.add(str(role).strip().upper())
    import scope as sc

    out = {str(w).strip().upper() for w in worn if str(w).strip()}
    for word in list(out):
        stands = sc.BADGE_FOLLOWS.get(word)
        if stands:
            out.add(stands)
    return out


def badge_allows(rule: list[str] | None, worn: set[str]) -> bool:
    if not rule:
        return True
    return any(b in worn for b in rule)


def badge_rules() -> dict[str, list[str]]:
    """The relay's reader of the badge matrix answers from no copy any more: no matrix narrows nothing."""
    return {}


def _roster_name(uid: str) -> str:
    rows = core_rows("users")
    import mw_shifts

    def live(row: dict[str, Any]) -> bool:
        return (str(row.get("active") or "").strip().upper() not in ("FALSE", "0", "NO")
                and not str(row.get("merged_into") or "").strip())

    me = next((r for r in rows if r.get("user_id") == str(uid)), None)
    if me is None or not live(me):
        return ""
    name = str(me.get("display_name") or "").strip()
    key = mw_shifts.sr.fold(name)
    if not key:
        return ""
    others = {str(r.get("user_id") or "") for r in rows if mw_shifts.sr.fold(r.get("display_name")) == key
              and live(r) and str(r.get("user_id") or "") != str(uid)}
    return "" if others - {""} else name


def calendar_badges(uid: str) -> set[str]:
    """{'HM'} for a current house manager, derived per read; a failed read wears nothing extra."""
    if not uid:
        return set()
    held = _CALENDAR_BADGES.get(uid)
    if held and time.time() - held[0] < CALENDAR_BADGES_TTL_S:
        return set(held[1])
    try:
        import mw_shifts

        name = _roster_name(uid)
        worn = {mw_shifts.sr.CALENDAR_BADGE} if name and mw_shifts.sr.houses_managed(M.DB, name) else set()
    except Exception as exc:  # noqa: BLE001
        log.warning("calendar badge unavailable for %s (%s)", uid, type(exc).__name__)
        worn = set()
    _CALENDAR_BADGES[uid] = (time.time(), frozenset(worn))
    if len(_CALENDAR_BADGES) > 4000:
        cutoff = time.time() - CALENDAR_BADGES_TTL_S
        for u, (at, _w) in list(_CALENDAR_BADGES.items()):
            if at < cutoff:
                _CALENDAR_BADGES.pop(u, None)
    return worn


def note_gates(entry: dict[str, Any]) -> None:
    gates = entry.get("gates")
    _RESOURCE_GATES[str(entry.get("resource") or "")] = gates if isinstance(gates, dict) else None


def app_feeds(app: str, role: str, worn: set[str], resource: str = "") -> bool:
    import mw_shifts

    sr = mw_shifts.sr
    gates = _RESOURCE_GATES.get(resource)
    gated = (app == CALENDAR_BUILDER_APP) if gates is None else bool(gates.get(app))
    if not gated:
        return True
    if "no-client" in ((gates or {}).get(app) or []) and str(role or "").strip().lower() not in sr.CALENDAR_REFUSED_ROLES:
        return True
    return bool(worn & sr.REASON_BADGES) or str(role or "").strip().lower() in sr.CALENDAR_EDIT_ROLES


def apps_open(resource: str, role: str, worn: set[str], derived: set[str] | frozenset[str] = frozenset()) -> bool:
    rules = badge_rules()
    apps = _RESOURCE_APPS.get(resource)
    if not apps:
        return True
    return any(badge_allows(rules.get(a), (worn | derived) if a in CALENDAR_BADGE_APPS else worn)
               and app_feeds(a, role, worn, resource) for a in apps)


def place_reach(uid: str) -> dict[str, Any]:
    """Which worlds and which company faces this account may be handed."""
    worlds: set[str] = set()
    tenants: set[str] = set()
    members: set[str] = set()
    member_roles: dict[str, str] = {}
    if not uid:
        return {"worlds": worlds, "tenants": tenants, "members": members, "roles": member_roles}
    try:
        worlds |= {w for w, o in WORLD_OWNERS.items() if o == uid}
        facts = core_rows("Facts", ESSENCIAL_SHEET_ID)
        said = {str(r.get("Source")): str(r.get("Value") or "").strip() for r in facts
                if str(r.get("Source") or "") in (PLACE_MEMBERS_HOUSE, PLACE_MEMBERS_MOVED)}
        house = said.get(PLACE_MEMBERS_HOUSE, "")
        if house and said.get(PLACE_MEMBERS_MOVED, "").lower() in ("on", "true", "1", "yes"):
            listed = core_rows(PLACE_MEMBERS_TAB, house) or core_rows("Data", house)
        else:
            listed = core_rows(PLACE_MEMBERS_TAB)
        owned_ids = {str(m.get("member_user_id") or "") for m in listed
                     if str(m.get("owner_user_id") or "") == uid and str(m.get("status") or "") == "active"
                     and str(m.get("scope") or "") in ("", "work_world")}
        members |= owned_ids
        users = core_rows("users")
        if owned_ids:
            worlds |= {w for w, o in WORLD_OWNERS.items() if o in owned_ids}
            for u in users:
                if str(u.get("user_id") or "") in owned_ids:
                    member_roles[str(u.get("user_id"))] = str(u.get("role") or "")
        for u in users:
            if str(u.get("user_id") or "") != uid:
                continue
            home = str(u.get("home_tenant") or "").strip()
            if home:
                tenants.add(home)
            for t in str(u.get("tenant_ids") or "").replace(";", ",").split(","):
                if t.strip():
                    tenants.add(t.strip())
            break
    except Exception as exc:  # noqa: BLE001 - no place, no bundle
        log.warning("place reach unavailable: %s", exc)
    worlds.discard("")
    members.discard("")
    return {"worlds": worlds, "tenants": tenants, "members": members, "roles": member_roles}


def world_withheld(uid: str, master_flag: Any) -> bool:
    """Is a world kept from this session? Never from the master's own; never from an account on the seen list."""
    if master_flag is True or (SLICES.lane_for("") or {}).get("my_world_hide") is not True:
        return False
    return not (uid and uid in SLICES.lane_list("my_world_seen"))


def app_cut_map(block: dict[str, Any], cut: frozenset[str]) -> dict[str, Any]:
    return {k: v for k, v in block.items() if k not in cut} if cut else block


def app_cut_shelf(shelf: dict[str, Any], cut: frozenset[str]) -> dict[str, Any]:
    if not cut or not isinstance(shelf, dict):
        return shelf
    out = dict(shelf)
    if isinstance(shelf.get("placement"), dict):
        out["placement"] = app_cut_map(shelf["placement"], cut)
    if isinstance(shelf.get("order"), dict):
        out["order"] = {k: [a for a in (v or []) if a not in cut] if isinstance(v, list) else v
                        for k, v in shelf["order"].items()}
    return out


def read_slice_file(resource: str) -> dict[str, Any] | None:
    try:
        return json.loads((SLICES.OUT_DIR / f"{resource}.json").read_text())
    except Exception:  # noqa: BLE001 - never built, or being written right now
        return None


# ---- the held bundle --------------------------------------------------------------------------------------------

def bundle_fresh() -> bool:
    held = LAST
    if not held["resources"]:
        return False
    if time.time() - float(held["at"] or 0) > BUNDLE_MAX_AGE_S:
        return False
    from datetime import datetime, timezone
    made = _iso(held.get("built_at"))
    if made is None:
        return False
    if made.tzinfo is None:
        made = made.replace(tzinfo=timezone.utc)
    return (datetime.now(timezone.utc) - made).total_seconds() <= BUNDLE_MAX_AGE_S


def bundle_answers(resource: str) -> bool:
    return bundle_fresh() and LAST["resources"].get(resource) is not None


def bundle_rows(resource: str) -> tuple[list[dict], str | None] | None:
    held = LAST
    if not held["resources"]:
        return None
    if time.time() - float(held["at"] or 0) > BUNDLE_MAX_AGE_S:
        return None
    from datetime import datetime, timezone
    made = _iso(held.get("built_at"))
    if made is not None:
        if made.tzinfo is None:
            made = made.replace(tzinfo=timezone.utc)
        if (datetime.now(timezone.utc) - made).total_seconds() > BUNDLE_MAX_AGE_S:
            return None
    rows = held["resources"].get(resource)
    if rows is None:
        return None
    return list(rows), (held["built_at"] or None)


def deposit(place: str, data: dict[str, Any]) -> None:
    if not BUNDLE_DIR:
        return
    try:
        BUNDLE_DIR.mkdir(parents=True, exist_ok=True)
        name = (place or "home").replace("/", "_")
        target = BUNDLE_DIR / f"{name}.json"
        tmp = BUNDLE_DIR / f".{name}.json.writing"
        tmp.write_text(json.dumps(data, separators=(",", ":")))
        tmp.replace(target)
    except Exception as exc:  # noqa: BLE001
        log.warning("bundle lane: could not deposit %s: %s", place or "home", exc)


def rev_rows(rev: Any) -> int:
    try:
        return int(str(rev).split(":", 1)[0])
    except (TypeError, ValueError, IndexError):
        return -1


def poisoned_resources(resources: dict, revs: dict) -> list[str]:
    tabs = {e.get("sheet"): e["resource"] for e in SLICES.load_manifest() if e.get("sheet") and e.get("resource")}
    bad = []
    for key, rev in (revs or {}).items():
        if rev_rows(rev) <= 0:
            continue
        resource = tabs.get(str(key).rsplit("::", 1)[-1])
        if resource and len(resources.get(resource) or []) == 0:
            bad.append(resource)
    return bad


def adopt_disk() -> None:
    """Take up the bundles last deposited, fingerprints and all."""
    if not BUNDLE_DIR:
        return
    taken = 0
    try:
        for path in sorted(BUNDLE_DIR.glob("*.json")):
            if "~" in path.stem:
                continue
            try:
                data = json.loads(path.read_text())
            except Exception:  # noqa: BLE001 - a half-written file is not a bundle
                continue
            if not isinstance(data.get("resources"), dict):
                continue
            if not data.get("revs"):
                log.warning("bundle lane: %s was deposited WITHOUT fingerprints — it will be read whole every cycle "
                            "until the backend sends them", path.stem)
            if int(data.get("reader") or 0) < BUNDLE_READER_MIN:
                continue
            key = "" if path.stem == "home" else path.stem
            HELD[key] = data
            revs = data.get("revs") or {}
            for resource in poisoned_resources(data["resources"], revs):
                log.warning("bundle lane: %s claims rows for %s the deposit does not hold — the fingerprint is "
                            "dropped, never adopted, and the next cycle re-reads it", path.stem, resource)
                sheets = {e.get("sheet") for e in SLICES.load_manifest() if e.get("resource") == str(resource)}
                revs = {rk: rv for rk, rv in revs.items() if str(rk).rsplit("::", 1)[-1] not in sheets}
            REVS[key] = revs
            if key == "":
                LAST.update({"at": time.time(), "built_at": str(data.get("built_at") or ""),
                             "resources": data["resources"]})
            taken += 1
    except Exception as exc:  # noqa: BLE001 - an empty start is a valid start
        log.warning("bundle lane: could not adopt the deposit: %s", exc)
    if taken:
        log.info("bundle lane: adopted %d bundle(s) from disk — the first cycle asks only for what moved", taken)


# ---- the bundle loop (HUB_BUNDLE_LANE) -------------------------------------------------------------------------

async def ask(action: str, payload: dict[str, Any]) -> dict[str, Any] | None:
    if not BUNDLE_LANE:
        return None
    got = await FD.call_app(BUNDLE_APP, action, dict(SERVICE), payload)
    if got is None:
        log.warning("bundle lane: %s not answered by Python", action)
        return None
    return got[2]


async def fetch(place: str = "", *, hold: bool = True) -> dict[str, Any] | None:
    env = await ask("snapshotBundleLatest", {"place": place})
    if env is None:
        return None
    if env.get("status") != 200:
        if env.get("status") != 404:
            log.warning("bundle lane: backend said %s", env.get("status"))
        return None
    data = env.get("data") or {}
    if not isinstance(data.get("resources"), dict):
        log.warning("bundle lane: a bundle without resources is not a bundle")
        return None
    if int(data.get("reader") or 0) < BUNDLE_READER_MIN:
        log.warning("bundle lane: %s was built by reader %s, this service serves %s+ — falling back to the tab reads",
                    place or "home", data.get("reader"), BUNDLE_READER_MIN)
        return None
    if hold:
        LAST.update({"at": time.time(), "built_at": str(data.get("built_at") or ""), "resources": data["resources"]})
    held = HELD.get(place)
    theirs, ours = _iso(data.get("built_at")), _iso((held or {}).get("built_at"))
    if held and ours and theirs and theirs <= ours:
        log.info("bundle lane: the file for %s is not newer than what we hold (%s vs %s) — keeping ours",
                 place or "home", data.get("built_at"), held.get("built_at"))
        return held
    HELD[place] = data
    REVS[place] = data.get("revs") or {}
    deposit(place, data)
    return data


async def targets() -> list[dict[str, str]]:
    env = await ask("snapshotBundlePlaces", {})
    if env is not None and env.get("status") == 200:
        data = env.get("data") or {}
        if isinstance(data.get("owners"), dict):
            WORLD_OWNERS.clear()
            WORLD_OWNERS.update({str(w): str(o or "") for w, o in data["owners"].items()})
        out = [{"key": str(p or ""), "place": str(p or "")} for p in (data.get("places") or [""])]
        for w in (data.get("worlds") or []):
            wid = str(w or "")
            if wid:
                out.append({"key": f"world_{wid}", "world": wid})
        return out
    if env is not None:
        log.warning("bundle lane: target list unavailable: %s", env.get("status"))
    return [{"key": "", "place": ""}]


def evict(alive: set[str]) -> None:
    for key in [k for k in HELD if k not in alive]:
        HELD.pop(key, None)
        REVS.pop(key, None)
        OWNED_REVS.pop(key, None)
        OWNED_AT.pop(key, None)
        FULL_OWED.discard(key)
        log.info("bundle lane: let go of %s — the backend no longer lists it", key or "home")


def have(key: str) -> dict[str, str]:
    if CYCLES["n"] % max(1, BUNDLE_FULL_EVERY) == 0:
        FULL_OWED.add(key)
    if key in FULL_OWED or key not in HELD:
        return {}
    return REVS.get(key) or {}


def merge(key: str, body: dict[str, Any]) -> dict[str, Any]:
    carried = body.get("carried") or []
    if not carried:
        return body
    held = HELD.get(key)
    if not held or not isinstance(held.get("resources"), dict):
        log.warning("bundle lane: %s answered with %d carried resources and we hold none — asking for a full read "
                    "next cycle", key or "home", len(carried))
        REVS.pop(key, None)
        return {}
    merged = dict(body)
    resources = dict(held["resources"])
    resources.update(body.get("resources") or {})
    merged["resources"] = resources
    revs_now = dict(REVS.get(key) or {})
    revs_now.update(body.get("revs") or {})
    for resource in poisoned_resources(resources, revs_now):
        log.warning("bundle lane: %s carried %s over a fingerprint vouching rows the held copy does not have — "
                    "dropping the fingerprint so the next cycle re-reads it whole", key or "home", resource)
        sheets = {e.get("sheet") for e in SLICES.load_manifest() if e.get("resource") == resource}
        for rk in list((REVS.get(key) or {}).keys()):
            if str(rk).rsplit("::", 1)[-1] in sheets:
                (REVS.get(key) or {}).pop(rk, None)
    return merged


async def build(target: dict[str, str], part: int = 0, parts: int = 1) -> dict[str, Any] | None:
    if not BUNDLE_LANE:
        return None
    payload: dict[str, Any] = ({"world": target["world"]} if target.get("world")
                               else {"place": target.get("place") or ""})
    payload["withBody"] = True
    held = have(target["key"])
    if held:
        payload["have"] = held
    if parts > 1:
        payload["part"], payload["parts"] = part, parts
    log.info("bundle %s: asking with %d fingerprint(s) (cycle %d, held=%s)", target["key"] or "home", len(held),
             CYCLES["n"], sorted(HELD.keys())[:4])
    if not held and target["key"] in HELD and target["key"] not in FULL_OWED:
        log.warning("bundle %s: held but carrying NO fingerprints — this place is rebuilt from nothing every cycle",
                    target["key"] or "home")
    env = await ask("snapshotBundleBuild", payload)
    if env is None:
        return None
    if env.get("status") != 200:
        log.warning("bundle lane: build said %s", env.get("status"))
        return None
    return env.get("data") or {}


def body_of(built: dict[str, Any] | None) -> dict[str, Any] | None:
    body = (built or {}).get("bundle")
    if not isinstance(body, dict) or not isinstance(body.get("resources"), dict):
        return None
    if int(body.get("reader") or 0) < BUNDLE_READER_MIN:
        log.warning("bundle lane: the build answered with reader %s, this service serves %s+", body.get("reader"),
                    BUNDLE_READER_MIN)
        return None
    return body


async def owned(place: str = "") -> int:
    if not BUNDLE_LANE:
        return 0
    tag = place or "home"
    known = OWNED_REVS.get(place) or {}
    due = (CYCLES["n"] - OWNED_AT.get(place, -10 ** 9)) >= max(1, BUNDLE_FULL_EVERY)
    if known and not due:
        fresh = REVS.get(place) or {}
        if all(k in fresh and fresh[k] == v and v != "error" for k, v in known.items()):
            log.info("bundle %s: personal half unchanged (%d owned tab(s)) — not asked", tag, len(known))
            return 0
    env = await ask("snapshotBundleOwned", {"place": place})
    if env is None or env.get("status") != 200:
        return 0
    data = env.get("data") or {}
    owned_revs = data.get("revs")
    if isinstance(owned_revs, dict) and owned_revs:
        OWNED_REVS[place] = {k: v for k, v in owned_revs.items() if v != "error"}
    else:
        OWNED_REVS.pop(place, None)
    OWNED_AT[place] = CYCLES["n"]
    users = data.get("users") or {}
    if not isinstance(users, dict):
        return 0
    n = 0
    for user_id, resources in users.items():
        uid = str(user_id or "").strip()
        if not uid:
            continue
        deposit(f"{tag}~{uid}", {"place": tag, "user_id": uid,
                                 "reader": int(data.get("reader") or BUNDLE_READER_MIN),
                                 "built_at": data.get("built_at"), "resources": resources})
        n += 1
    return n


async def cycle() -> None:
    """Refresh every place's bundle, once."""
    CYCLES["n"] += 1
    listed = await targets()
    alive = {t["key"] for t in listed}
    rest = sorted([t for t in listed if t["key"] != ""], key=lambda t: t["key"])
    cursor = CURSOR.get("i") or 0
    if cursor >= len(rest):
        cursor = 0
    ordered = [t for t in listed if t["key"] == ""] + rest[cursor:] + rest[:cursor]
    examined = 0
    deadline = time.monotonic() + BUNDLE_CYCLE_BUDGET_S
    for target in ordered:
        if target["key"] != "":
            if time.monotonic() > deadline:
                BUDGET["overruns"] += 1
                BUDGET["at"] = time.time()
                log.info("bundle lane: budget spent after %d of %d target(s) — the next cycle resumes at %s",
                         examined, len(rest), rest[(cursor + examined) % max(1, len(rest))]["key"] if rest else "home")
                break
            examined += 1
            CURSOR["i"] = (cursor + examined) % max(1, len(rest))
        n = BUNDLE_PARTS if "world" not in target else 1
        built = None
        pieces: list[dict[str, Any]] = []
        for piece in range(n):
            got = await build(target, piece, n)
            body_piece = body_of(got)
            if body_piece is None:
                log.warning("bundle %s: piece %d of %d did not come back — the cycle falls back",
                            target["key"] or "home", piece + 1, n)
                pieces = []
                break
            pieces.append(body_piece)
            built = got
            if int((got or {}).get("parts") or 1) < 2 and n > 1:
                break
        body = None
        if pieces:
            body = pieces[0]
            if len(pieces) > 1:
                joined = dict(body)
                res: dict[str, Any] = {}
                revs: dict[str, str] = {}
                carried: list[str] = []
                for pc in pieces:
                    res.update(pc.get("resources") or {})
                    revs.update(pc.get("revs") or {})
                    carried.extend(pc.get("carried") or [])
                joined["resources"], joined["revs"], joined["carried"] = res, revs, carried
                body = joined
        if body is not None:
            body = merge(target["key"], body) or None
        if body is not None:
            if not (built or {}).get("carried"):
                FULL_OWED.discard(target["key"])
            HELD[target["key"]] = body
            evict(alive)
            REVS[target["key"]] = body.get("revs") or {}
            read_now = len((built or {}).get("read") or {})
            carried_now = len((built or {}).get("carried") or [])
            if carried_now:
                log.info("bundle %s: %d tab(s) changed, %d carried forward", target["key"] or "home", read_now,
                         carried_now)
            if target["key"] == "":
                LAST.update({"at": time.time(), "built_at": str(body.get("built_at") or ""),
                             "resources": body["resources"]})
            deposit(target["key"], body)
        else:
            await fetch(target["key"], hold=(target["key"] == ""))
        if "world" not in target:
            await owned(target.get("place") or "")


async def loop() -> None:
    """The bundle's own clock."""
    while True:
        await asyncio.sleep(5)
        if not BUNDLE_LANE:
            continue
        if time.time() - LAST_BUILD["at"] < BUNDLE_MIN_INTERVAL_S:
            continue
        LAST_BUILD["at"] = time.time()
        try:
            await asyncio.wait_for(cycle(), timeout=BUNDLE_CYCLE_TIMEOUT_S)
        except asyncio.TimeoutError:
            log.error("bundle lane: cycle exceeded %ss and was abandoned — the previous bundles stay served",
                      BUNDLE_CYCLE_TIMEOUT_S)
        except Exception as exc:  # noqa: BLE001 - the loop must not die
            log.exception("bundle lane: %s", exc)


# ---- one tab out of the deposit -------------------------------------------------------------------------------

_TAB_CHUNK = 1 << 20
_TAB_STRUCT = re.compile(rb'[\[\]{}"]')
_TAB_MEMO: dict[str, Any] = {"key": None, "cuts": {}}
_TAB_MEMO_MAX = 32


def _json_string_end(buf: bytes, i: int) -> int:
    j = i + 1
    while True:
        k = buf.find(b'"', j)
        if k < 0:
            return -1
        b = k - 1
        slashes = 0
        while b >= i and buf[b] == 0x5C:
            slashes += 1
            b -= 1
        if slashes % 2 == 0:
            return k + 1
        j = k + 1


def _json_value_end(buf: bytes, i: int) -> int:
    c = buf[i:i + 1]
    if c == b'"':
        return _json_string_end(buf, i)
    if c not in (b"[", b"{"):
        j, n = i, len(buf)
        while j < n and buf[j:j + 1] not in (b",", b"]", b"}"):
            j += 1
        return j if j < n else -1
    depth, pos, n = 0, i, len(buf)
    while pos < n:
        m = _TAB_STRUCT.search(buf, pos)
        if not m:
            return -1
        ch, k = m.group(), m.start()
        if ch == b'"':
            e = _json_string_end(buf, k)
            if e < 0:
                return -1
            pos = e
            continue
        if ch in (b"[", b"{"):
            depth += 1
            pos = k + 1
            continue
        depth -= 1
        if depth == 0:
            return k + 1
        pos = k + 1
    return -1


def _resources_open(fh: Any) -> int:
    fh.seek(0)
    needle = b'"resources":'
    keep = len(needle) - 1
    pos, tail = 0, b""
    while True:
        chunk = fh.read(_TAB_CHUNK)
        if not chunk:
            return -1
        buf = tail + chunk
        i = buf.find(needle)
        if i >= 0:
            j = i + len(needle)
            return pos + j if buf[j:j + 1] == b"{" else -1
        pos += len(buf) - keep
        tail = buf[-keep:]


def deposit_tab(path: Path, resource: str) -> dict[str, Any]:
    """ONE tab out of one deposit, with the deposit's own stamp on it."""
    out: dict[str, Any] = {"state": "unreadable", "built_at": "", "read_started_at": "", "unreadable": None,
                           "count": None, "bytes": 0, "carried": None}
    try:
        with path.open("rb") as fh:
            head = fh.read(1 << 16)
            if not head.startswith(b"{"):
                return out
            stop = head.find(b',"revs":')
            if stop > 0:
                try:
                    top = json.loads(head[:stop] + b"}")
                    out["built_at"] = str(top.get("built_at") or "")
                    out["read_started_at"] = str(top.get("read_started_at") or "")
                    u = top.get("unreadable")
                    out["unreadable"] = u if isinstance(u, list) else None
                except Exception:  # noqa: BLE001
                    pass
            cpos = head.find(b',"carried":[')
            if cpos > 0:
                cend = head.find(b"]", cpos)
                if cend > 0:
                    try:
                        names = json.loads(head[cpos + len(b',"carried":'):cend + 1])
                        if isinstance(names, list):
                            out["carried"] = resource in names
                    except Exception:  # noqa: BLE001
                        pass
            if not out["built_at"]:
                m = re.search(rb'"built_at":"([^"]*)"', head)
                if m:
                    out["built_at"] = m.group(1).decode()
            ob = _resources_open(fh)
            if ob < 0:
                return out
            key = resource.encode()
            fh.seek(ob)
            at = -1
            if fh.read(len(key) + 4).startswith(b'{"' + key + b'":'):
                at = ob + len(key) + 4
            else:
                needle = b'],"' + key + b'":'
                keep = len(needle) - 1
                base, tail = ob, b""
                fh.seek(ob)
                while True:
                    chunk = fh.read(_TAB_CHUNK)
                    if not chunk:
                        break
                    buf = tail + chunk
                    i = buf.find(needle)
                    if i >= 0:
                        at = base + i + len(needle)
                        break
                    base += len(buf) - keep
                    tail = buf[-keep:]
            if at < 0:
                out["state"] = "absent"
                return out
            fh.seek(at)
            buf, end = b"", -1
            while True:
                chunk = fh.read(_TAB_CHUNK)
                if not chunk:
                    break
                buf += chunk
                end = _json_value_end(buf, 0)
                if end >= 0:
                    break
                if len(buf) > BUNDLE_TAB_MAX_BYTES:
                    out["state"] = "too-large"
                    out["bytes"] = len(buf)
                    return out
            if end < 0:
                return out
            if end > BUNDLE_TAB_MAX_BYTES:
                out["state"] = "too-large"
                out["bytes"] = end
                return out
            rows = json.loads(buf[:end])
            if not isinstance(rows, list):
                return out
            out.update(state="rows", rows=rows, count=len(rows), bytes=end)
            return out
    except FileNotFoundError:
        out["state"] = "no-deposit"
        return out
    except Exception as exc:  # noqa: BLE001 - a cut never takes the route down
        log.warning("deposit cut: %s out of %s: %s", resource, path.name, exc)
        return out


def deposit_tab_memo(path: Path, resource: str) -> dict[str, Any]:
    try:
        st = path.stat()
        key: tuple | None = (str(path), st.st_dev, st.st_ino, st.st_size, st.st_mtime_ns)
    except FileNotFoundError:
        return {"state": "no-deposit", "built_at": "", "read_started_at": "", "unreadable": None, "count": None,
                "bytes": 0, "carried": None}
    except Exception:  # noqa: BLE001
        key = None
    if key is None:
        return deposit_tab(path, resource)
    held = _TAB_MEMO["cuts"].get(resource)
    if held is not None and held[0] == key:
        return held[1]
    if _TAB_MEMO["key"] != key:
        _TAB_MEMO["key"], _TAB_MEMO["cuts"] = key, {}
    cut = deposit_tab(path, resource)
    if len(_TAB_MEMO["cuts"]) < _TAB_MEMO_MAX:
        _TAB_MEMO["cuts"][resource] = (key, cut)
    return cut


def deposit_age_s(built_at: str) -> float | None:
    from datetime import datetime, timezone
    if not built_at:
        return None
    try:
        when = datetime.fromisoformat(str(built_at).replace("Z", "+00:00"))
        if when.tzinfo is None:
            when = when.replace(tzinfo=timezone.utc)
        return (datetime.now(timezone.utc) - when).total_seconds()
    except Exception:  # noqa: BLE001
        return None


# ---- the doors ----------------------------------------------------------------------------------------------------

async def _session(request: Request) -> Any:
    authorization = str(request.headers.get("authorization") or "")
    token = authorization[7:].strip() if authorization.lower().startswith("bearer ") else ""
    s = await FD.session(token) if token else None
    return s if s is not None and s.ok else None


async def bundle(request: Request) -> Response:
    """GET /bundle — the bang: the whole site's data in one JSON."""
    from starlette.concurrency import run_in_threadpool

    s = await _session(request)
    if s is None:
        return Response(status_code=401)
    # an SSA's or a FAMILY's slices are matched by slice_gate.FAMILY_ROLE, whatever its role says
    role = await run_in_threadpool(slice_gate.slice_role, s)
    out: dict[str, Any] = {"built_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "slices": {}}
    master_flag = s.is_master
    uid = str(s.uid or "").strip()
    app_cut = frozenset() if master_flag is True or (uid and uid in SLICES.lane_list("my_work_apps_seen")) \
        else SLICES.lane_list("my_work_apps")
    withhold = bool(app_cut) and master_flag is None
    badges = await run_in_threadpool(bundle_access, "app_badge_access", "app_id", "badges", True)
    tenants = await run_in_threadpool(bundle_access, "app_tenant_access", "app_id", "tenants")
    sections = await run_in_threadpool(bundle_access, "config_badge_access", "section_id", "badges")
    access = {"badges": {} if withhold else app_cut_map(badges, app_cut),
              "tenants": {} if withhold else app_cut_map(tenants, app_cut), "sections": sections}
    access = {k: v for k, v in access.items() if v}
    if access:
        out["access"] = access
    log.info("bundle access: badges=%d tenants=%d sections=%d", len(access.get("badges", {})),
             len(access.get("tenants", {})), len(access.get("sections", {})))
    lane = SLICES.lane_for("")
    out["config"] = {"shelf": app_cut_shelf((lane or {}).get("shelf") or {"sections": [], "placement": {}, "order": {}},
                                            app_cut if master_flag is False else frozenset()),
                     "source": "backend" if lane else "mirror"}
    for key in ("hiringViews", "clientViews", "potClientsViews", "menuLinks", "appsBuilt"):
        if lane and isinstance(lane.get(key), dict):
            out["config"][key] = lane[key]
    if role == "admin":
        out["config"]["alertsRaw"] = {}
    ist_block = await run_in_threadpool(ist_config_block, role)
    if ist_block:
        out["config"]["ist"] = ist_block
    manifest = SLICES.load_manifest()
    # the slices App Control decides (app/slice_gate.py), left out as /snapshot/<resource>.json refuses them
    shut = await run_in_threadpool(slice_gate.shut, s, manifest)
    for entry in manifest:
        roles = entry.get("roles") or []
        if roles and role not in roles:
            continue
        if entry["resource"] in shut:
            continue
        try:
            out["slices"][entry["resource"]] = json.loads((SLICES.OUT_DIR / f"{entry['resource']}.json").read_text())
        except Exception:  # noqa: BLE001 - a missing slice is simply not in the bang
            continue
    return Response(json.dumps(out), media_type="application/json")


def ist_config_block(role: str) -> dict[str, Any] | None:
    """The IST copy as the bundle ships it (ist_config.bundle_block), off asa-hub-db (mw_shifts.ist)."""
    try:
        import mw_shifts

        ist = mw_shifts.ist
        ist.rules(M.DB)
        held = ist.state()
    except Exception as exc:  # noqa: BLE001 - no copy is not a wrong copy
        log.warning("ist settings unavailable to the bundle: %s", exc)
        return None
    if held["source"] != "sheet":
        return None
    block: dict[str, Any] = {"values": held["values"], "source": "mirror", "tab": ist.TAB}
    if role in ("admin", "manager"):
        block["problems"] = held["problems"]
        block["unknown"] = held["unknown"]
    return block


async def place(request: Request) -> Response:
    """GET /place — the JSON lane, for the place the caller is standing in (one tab of it with ?tab=)."""
    from starlette.concurrency import run_in_threadpool

    q = request.query_params
    world, tenant, member, tab = (str(q.get(k) or "") for k in ("world", "tenant", "member", "tab"))
    s = await _session(request)
    if s is None:
        return Response(status_code=401)
    uid = s.uid
    if not uid:
        return Response(status_code=404)
    visited_role = ""
    if member:
        reach = await run_in_threadpool(place_reach, uid)
        if member not in reach.get("members", set()):
            return Response(status_code=404)
        visited_role = str((reach.get("roles") or {}).get(member) or "")
        if not visited_role:
            return Response(status_code=404)
        name = "home.json"
    elif world:
        if world_withheld(uid, s.is_master):
            return Response(status_code=404)
        reach = await run_in_threadpool(place_reach, uid)
        if world not in reach["worlds"]:
            return Response(status_code=404)
        name = f"world_{world}.json"
    elif tenant:
        reach = await run_in_threadpool(place_reach, uid)
        if tenant not in reach["tenants"]:
            return Response(status_code=404)
        name = f"ten_{tenant}.json"
    else:
        name = "home.json"
    if "/" in name + (member or uid):
        return Response(status_code=404)
    role = visited_role or await run_in_threadpool(slice_gate.slice_role, s)
    if tab:
        if not re.fullmatch(r"[A-Za-z0-9_]{1,64}", tab):
            return Response(status_code=400)
        badges_worn = badges_of(role, await run_in_threadpool(user_badges, member or uid))
        badges_derived = await run_in_threadpool(calendar_badges, member or uid)
        cut: dict[str, Any] | None = None
        if not world and not tenant:
            try:
                mine = json.loads((BUNDLE_DIR / f"home~{member or uid}.json").read_text())
                rows_ = (mine.get("resources") or {}).get(tab)
                if isinstance(rows_, list):
                    cut = {"state": "rows", "rows": rows_, "count": len(rows_), "bytes": 0,
                           "built_at": str(mine.get("built_at") or ""),
                           "read_started_at": str(mine.get("read_started_at") or ""),
                           "unreadable": mine.get("unreadable"), "carried": None}
            except Exception:  # noqa: BLE001 - nothing of their own: the gate decides
                cut = None
        withheld_answer = Response(json.dumps({"place": world or tenant or "home", "resource": tab,
                                               "state": "withheld", "source": "deposit"}),
                                   status_code=403, media_type="application/json")
        entry = next((e for e in SLICES.load_manifest() if str(e.get("resource") or "") == tab), None)
        if cut is None:
            if entry is None:
                return withheld_answer
            roles = entry.get("roles") or []
            if roles and role not in roles:
                return withheld_answer
            if tab in slice_gate.OWNERS and tab in await run_in_threadpool(slice_gate.shut, s,
                                                                           SLICES.load_manifest()):
                return withheld_answer
            if PLACE_BADGE_GATE:
                _RESOURCE_APPS[tab] = entry.get("apps") or []
                note_gates(entry)
                if not apps_open(tab, role, badges_worn, badges_derived):
                    return withheld_answer
            cut = await asyncio.to_thread(deposit_tab_memo, BUNDLE_DIR / name, tab)
            if cut.get("state") in ("rows", "absent", "too-large"):
                derived = bool(entry and entry.get("mode") == "derived")
                if derived or not cut.get("rows"):
                    ours = read_slice_file(tab)
                    if ours is not None and isinstance(ours.get("rows"), list):
                        cut = {"state": "rows", "rows": ours["rows"], "count": len(ours["rows"]), "bytes": 0,
                               "built_at": str(ours.get("built_at") or ""),
                               "read_started_at": str(ours.get("source_at") or ""), "unreadable": None,
                               "carried": False, "source": "slice"}
        age = deposit_age_s(str(cut.get("built_at") or ""))
        answer: dict[str, Any] = {
            "place": world or tenant or "home", "resource": tab, "source": str(cut.get("source") or "deposit"),
            "state": cut["state"], "built_at": cut.get("built_at") or "",
            "read_started_at": cut.get("read_started_at") or "", "age_s": None if age is None else round(age, 1),
            "max_age_s": BUNDLE_MAX_AGE_S, "stale": None if age is None else age > BUNDLE_MAX_AGE_S,
            "bytes": cut.get("bytes") or 0}
        if isinstance(cut.get("unreadable"), list):
            answer["deposit_unreadable"] = cut["unreadable"]
        if isinstance(cut.get("carried"), bool):
            answer["carried"] = cut["carried"]
        if cut["state"] == "rows":
            answer["rows"] = cut["rows"]
            answer["count"] = cut["count"]
        SLICES.traffic_note("slice_reads")
        return Response(json.dumps(answer), media_type="application/json")
    try:
        payload = json.loads((BUNDLE_DIR / name).read_text())
    except Exception:  # noqa: BLE001 - no bundle for this place yet
        return Response(status_code=404)
    own: dict[str, list] = {}
    if not world and not tenant:
        try:
            mine = json.loads((BUNDLE_DIR / f"home~{member or uid}.json").read_text())
            for k, v in (mine.get("resources") or {}).items():
                if isinstance(v, list):
                    own[k] = v
        except Exception:  # noqa: BLE001 - nothing of their own yet
            own = {}
    badges_worn = badges_of(role, await run_in_threadpool(user_badges, member or uid))
    badges_derived = await run_in_threadpool(calendar_badges, member or uid)
    withheld: list[str] = []
    allowed: dict[str, list[str]] = {}
    mine_to_build: set[str] = set()
    _RESOURCE_APPS.clear()
    _RESOURCE_GATES.clear()
    manifest = SLICES.load_manifest()
    # the slices App Control decides (app/slice_gate.py), left out as /snapshot/<resource>.json refuses them
    shut = await run_in_threadpool(slice_gate.shut, s, manifest)
    for entry in manifest:
        allowed[str(entry.get("resource") or "")] = entry.get("roles") or []
        _RESOURCE_APPS[str(entry.get("resource") or "")] = entry.get("apps") or []
        note_gates(entry)
        if entry.get("mode") == "derived":
            mine_to_build.add(str(entry.get("resource") or ""))
    out = {"built_at": payload.get("built_at") or "", "slices": {}}
    shadow: list[str] = []
    for resource, rows_ in (payload.get("resources") or {}).items():
        if not isinstance(rows_, list):
            continue
        roles = allowed.get(resource)
        if roles is None or (roles and role not in roles) or resource in shut:
            continue
        if PLACE_BADGE_GATE and not apps_open(resource, role, badges_worn, badges_derived):
            withheld.append(resource)
            continue
        if not PLACE_BADGE_GATE and not apps_open(resource, role, badges_worn, badges_derived):
            shadow.append(resource)
        out["slices"][resource] = {"rows": rows_, "built_at": out["built_at"]}
    if shadow or withheld:
        log.info("place %s (%s): %d resource(s) %s by the badge matrix — %s", (world or tenant or "home"),
                 role or "?", len(withheld or shadow), "withheld" if withheld else "would be withheld",
                 ", ".join(sorted(withheld or shadow)[:10]))
    for resource, rows_ in own.items():
        out["slices"][resource] = {"rows": rows_, "built_at": out["built_at"]}
    for entry in manifest:
        resource = str(entry.get("resource") or "")
        if not resource:
            continue
        roles = entry.get("roles") or []
        if (roles and role not in roles) or resource in shut:
            continue
        held = out["slices"].get(resource)
        mine = read_slice_file(resource)
        if mine is None:
            continue
        if held is None or not held.get("rows") or resource in mine_to_build:
            out["slices"][resource] = mine
    SLICES.traffic_note("slice_reads")
    return Response(json.dumps(out), media_type="application/json")


def install(app: Any) -> None:
    app.get("/bundle")(bundle)
    app.get("/place")(place)
