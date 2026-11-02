#!/usr/bin/env python3
"""
Write app/live_plane.json from server/snapshot_service.py and the relay's slice modules: the tables asa-hub-app's live
plane (app/live_slices.py, app/live_finish.py) routes and judges by, read off the relay so the two never disagree.

  slice_doors     BACKEND_SLICE_DOORS: the shaped resources Python's doors fill
  relay_built     the slices only the relay's own lane modules shape (build_one's module branches, the HR tracker's
                  digest, the roster's events): built there on the app's word
  app_built       the module-shaped slices asa-hub-app builds itself, with its copy of the module (APP_BUILT)
  app_finished    the door-filled slices asa-hub-app finishes itself (APP_FINISHED: the events' roster)
  late            the analyses built from other slices (hiring, medcorr, coverage): their resources and sources
  app_late        the late analyses asa-hub-app builds itself (APP_LATE: key -> module)
  apps, packs     BACKEND_APPS' pack and key, and each pack's key pattern and fold (_backend_key)
  viewer_cache    the reads a viewer's copy is kept of and the names they re-read on (_viewer_cache_ring_of)
  edition_only    _BACKEND_EDITION_ONLY (_backend_editions_cut)
  app_packs       _APP_PACKS' tables (each pack's writes, sweeps, resources, warm order…) and the tables around them
                  (APP PACKS), for app/app_packs.py
  finish          what the answer observers of gas_relay and _backend_final_landed ring, sweep and mark dirty, for
                  app/live_finish.py

Nothing of the relay is imported or run but its constants (tools/emit-front-door-routes.py's namespace).

    python3 tools/emit-live-plane.py            # writes the file
    python3 tools/emit-live-plane.py --check    # exit 1 when the file differs from the relay
"""
from __future__ import annotations

import ast
import importlib.util
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SERVER = ROOT / "server"
OUT = ROOT / "app" / "live_plane.json"
MODULES = ("shift_slices", "calendar_builder_slices", "invoice_slices", "finance_slices", "house_slices", "hr_slices",
           "alert_slices", "contacts_slices", "behavior_slices", "comm_cortex", "attendance_slices",
           "comm_calls_slices", "comm_when_slices", "psi_punches_slices", "punch_board_slices", "coverage_slices",
           "resume_slices", "technology_docs", "technology_slices", "recruit_book")
LATE = {"hiring": "hiring_slices", "medcorr": "medcorr_slices", "coverage": "coverage_slices"}
# the late analyses asa-hub-app builds itself, with app/<module>.py (APP_LATE); the rest stay the relay's
APP_LATE = ("hiring", "medcorr", "coverage")
# the shaped resources build_one finishes with a relay module (none left); the ones asa-hub-app finishes itself, with
# its copy of the module (APP_FINISHED: resource -> module, whose finish(resource, rows) lays the rest on the door's:
# the events' roster, the HR tracker's digest)
FINISHED_THERE: tuple[str, ...] = ()
APP_FINISHED = {"events": "shift_slices", "staffIssues": "hr_digest"}
# module -> its resources asa-hub-app builds with app/<module>.py; the rest of the module's stay the relay's
APP_BUILT = {
    "calendar_builder_slices": ("calendarConflicts", "calendarGrid", "calendarHours", "calendarHouses",
                                "calendarRequests", "calendarShifts", "calendarStaff"),
    "punch_board_slices": ("commPunchBoard",),
    "shift_slices": ("shiftCards", "shiftMatrix", "shiftTimeline", "shifts"),
    "invoice_slices": ("invoices",),
    "finance_slices": ("financeSummary", "finances"),
    "resume_slices": ("resumeCoverage",),
    "alert_slices": ("alertsTriage", "workforceForecast"),
    "contacts_slices": ("cortexContacts",),
    "comm_cortex": ("commRoutes",),
    "psi_punches_slices": ("psiPunches",),
    "behavior_slices": ("behaviorBoard",),
    "recruit_book": ("recruitBook",),
    "attendance_slices": ("commAttendance",),
    "comm_when_slices": ("commWhen", "commWhenMoments"),
}


def _namespace() -> dict:
    spec = importlib.util.spec_from_file_location("emit_front_door_routes", ROOT / "tools" / "emit-front-door-routes.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)  # type: ignore[union-attr]
    return mod.relay_namespace((SERVER / "snapshot_service.py").read_text())[1]


def _module_names(name: str) -> dict[str, list[str]]:
    out: dict[str, list[str]] = {}
    held: dict[str, object] = {}
    for node in ast.parse((SERVER / f"{name}.py").read_text()).body:
        target = node.targets[0] if isinstance(node, ast.Assign) else node.target if isinstance(node, ast.AnnAssign) \
            else None
        if not isinstance(target, ast.Name) or node.value is None:
            continue
        try:
            held[target.id] = eval(compile(ast.Expression(node.value), name, "eval"),  # noqa: S307 - its constants
                                   {"tuple": tuple, "frozenset": frozenset, "set": set, "sorted": sorted}, held)
        except Exception:  # noqa: BLE001 - one that needs the running module
            continue
    for k in ("RESOURCES", "SOURCES", "HELD_SOURCES"):
        v = held.get(k)
        if isinstance(v, (list, tuple, set, frozenset, dict)):
            out[k] = sorted(v)
    return out


def build() -> dict:
    ns = _namespace()
    doors = {k: list(v) for k, v in sorted(ns["BACKEND_SLICE_DOORS"].items())}
    shaped_there: set[str] = set()
    app_built: dict[str, str] = {}
    for name in MODULES:
        held = set(_module_names(name).get("RESOURCES") or [])
        shaped_there |= held
        here = set(APP_BUILT.get(name) or ())
        if here - held or (here and not (ROOT / "app" / f"{name}.py").exists()):
            raise SystemExit(f"APP_BUILT names {name} resources it does not serve, or app/{name}.py is missing")
        app_built.update({r: name for r in here})
    late = {}
    for key, name in LATE.items():
        got = _module_names(name)
        late[key] = {"resources": got.get("RESOURCES") or [], "sources": got.get("SOURCES") or []}
    app_late: dict[str, str] = {}
    for key in APP_LATE:
        if not (ROOT / "app" / f"{LATE[key]}.py").exists():
            raise SystemExit(f"APP_LATE names {key}, and app/{LATE[key]}.py is missing")
        app_late[key] = LATE[key]
    late_here = {r for key in app_late for r in late[key]["resources"]}
    relay_built = sorted((shaped_there - set(doors) - set(app_built) - late_here)
                         | {r for r in FINISHED_THERE if r in doors})
    apps = {}
    for app_id, spec in sorted(ns["BACKEND_APPS"].items()):
        apps[app_id] = {k: (sorted(spec[k]) if isinstance(spec[k], (set, frozenset, tuple, list)) else spec[k])
                        for k in ("pack", "key", "keys", "any_key") if k in spec}
    packs = {}
    for pack, spec in sorted(ns["_APP_PACKS"].items()):
        packs[pack] = {"key_re": spec["key_re"], "fold": _fold(spec["fold"])}
    opt_out_re = ns["_VIEWER_CACHE_OPT_OUT_RE"]
    return {
        "_": "written by tools/emit-live-plane.py from server/snapshot_service.py — never edited by hand",
        "slice_doors": doors,
        "relay_built": relay_built,
        "app_built": dict(sorted(app_built.items())),
        "app_finished": {r: m for r, m in sorted(APP_FINISHED.items()) if r in doors},
        "late": late,
        "app_late": app_late,
        "medcorr_sources": late["medcorr"]["sources"],
        "apps": apps,
        "packs": packs,
        "house_re": ns["_APP_PACK_HOUSE_RE"],
        "app_control_writes": sorted(ns["APP_CONTROL_WRITES"]),
        "viewer_cache": {
            "reads": dict(sorted(ns["_VIEWER_CACHE_READS"].items())),
            "lanes": sorted(ns["_VIEWER_CACHE_LANES"]),
            "file_ring": ns["_VIEWER_CACHE_FILE_RING"],
            "opt_out": sorted(ns["_VIEWER_CACHE_OPT_OUT"]),
            "opt_out_re": opt_out_re.pattern,
            "no_receipt": sorted(ns["RELAY_NO_RECEIPT_ACTIONS"]),
            "byte_reads": sorted(ns["RELAY_BYTE_READS"]),
        },
        "edition_only": dict(sorted(ns["_BACKEND_EDITION_ONLY"].items())),
        "write_prepare": {k: list(v) for k, v in sorted(ns["BACKEND_WRITE_PREPARE"].items())},
        "app_packs": _app_packs(ns),
        "finish": _finish(ns),
    }


def _fold(fn: object) -> str:
    """A pack's fold by what it makes of a key: upper-cased, lower-cased or only stripped."""
    said = fn(" aB ")  # type: ignore[operator]
    return "upper" if said == "AB" else "lower" if said == "ab" else "strip"


def _plain(value: object) -> object:
    if isinstance(value, (set, frozenset)):
        return sorted(value)
    if isinstance(value, tuple):
        return list(value)
    if isinstance(value, dict):
        return {str(k): _plain(v) for k, v in sorted(value.items())}
    return value


PACK_FIELDS = ("key_re", "writes", "elsewhere", "sweeps", "resources", "verbs", "query_key", "warm_order", "view",
               "own_only", "warm_every_s")


def _app_packs(ns: dict) -> dict:
    specs = {}
    for pack, spec in sorted(ns["_APP_PACKS"].items()):
        specs[pack] = {"fold": _fold(spec["fold"]), **{k: _plain(spec[k]) for k in PACK_FIELDS if k in spec}}
    return {
        "specs": specs,
        "verbs": sorted(ns["_APP_PACK_VERBS"]),
        "door_resources": _plain(ns["_APP_PACK_DOOR_RESOURCES"]),
        "events": _plain(ns["_APP_PACK_EVENTS"]),
        "doors": _plain(ns["_APP_PACK_DOORS"]),
        "gates": _plain(ns["_APP_PACK_GATES"]),
        "prefixes": _plain(ns["_APP_PACK_PREFIXES"]),
        "python_behind": _plain(ns["_APP_PACK_PYTHON_BEHIND"]),
        "people_writes": sorted(ns["_APP_PACK_PEOPLE_WRITES"]),
        "people_resources": sorted(ns["_APP_PACK_PEOPLE_RESOURCES"]),
        "hidden_parts": _plain(ns["_APP_PACK_HIDDEN_PARTS"]),
        "own_apps": list(ns["_APP_PACK_OWN_APPS"]),
        "own_client_parts": _plain(ns["_APP_PACK_OWN_CLIENT_PARTS"]),
        "own_view_parts": _plain(ns["_APP_PACK_OWN_VIEW_PARTS"]),
        "own_house_parts": list(ns["_APP_PACK_OWN_HOUSE_PARTS"]),
    }


def _finish(ns: dict) -> dict:
    return {
        "access_actions": sorted(ns["_RELAY_APP_ACCESS_ACTIONS"]),
        "generic_verbs": sorted(ns["_GENERIC_VERBS"]),
        "rings": _plain(ns["_VIEWER_CACHE_RINGS"]),
        "lane_writes": _plain(ns["_VIEWER_CACHE_LANE_WRITES"]),
        "scheduling": {"event": ns["SCHEDULING_EVENT"], "reads": sorted(ns["_SCHEDULING_READS"])},
        "vehicle_calendar": {"event": ns["VEHICLE_CALENDAR_EVENT"], "writes": sorted(ns["VEHICLE_CALENDAR_WRITES"])},
        "staff_profiles": {"event": ns["STAFF_PROFILES_EVENT"], "writes": sorted(ns["STAFF_PROFILES_WRITES"])},
        "smart_comms": {"event": ns["SMART_COMMS_EVENT"], "writes": sorted(ns["SMART_COMMS_WRITES"])},
        "forms": {"app": ns["FORMS_APP"], "writes": sorted(ns["FORMS_WRITES"])},
        "support_desk": {"event": ns["SUPPORT_DESK_EVENT"], "writes": sorted(ns["_SUPPORT_DESK_WRITES"]),
                         "sched_writes": sorted(ns["_SUPPORT_DESK_SCHED_WRITES"])},
        "docs": {"app": ns["DOCS_APP"], "resource": ns["DOCS_RESOURCE"]},
        "learning": {"app": ns["LEARNING_APP"], "writes": sorted(ns["LEARNING_WRITES"]),
                     "resources": sorted(ns["LEARNING_RESOURCES"])},
        "recon": {"app": ns["RECON_APP"], "writes": sorted(ns["RECON_WRITES"])},
        "slice_resources": {"call_offs": ns["CALL_OFFS_RESOURCE"],
                            "questionnaires": ns["QUESTIONNAIRE_RESPONSES_RESOURCE"],
                            "support_requests": ns["SUPPORT_REQUESTS_RESOURCE"],
                            "staff_issues": ns["STAFF_ISSUES_RESOURCE"]},
        "sheet_resource_doors": _plain(ns["SHEET_RESOURCE_DOORS"]),
        "generic_rings": sorted(ns["GENERIC_RINGS"]),
    }


def dump(tables: dict) -> str:
    return json.dumps(tables, indent=1, sort_keys=False) + "\n"


def main(argv: list[str]) -> int:
    text = dump(build())
    if "--check" in argv:
        same = OUT.exists() and OUT.read_text() == text
        print("live plane tables match the relay" if same else f"{OUT} differs from the relay")
        return 0 if same else 1
    OUT.write_text(text)
    print(f"wrote {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
