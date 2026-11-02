"""The Dashboard (opsdash, today's operation at a glance) on Python. It holds no data of its own: it reads the
company's lists, each read here off asa-hub-db exactly as Apps Script's generic list answered the relay's identity —
`people` (the roster merged, the plans' clients left out), `candidates` (the hiring board's cards), `clients` (the
derived directory) and `workOrders` (the house repair requests) — the relay filling those slices from these doors
(BACKEND_SLICE_DOORS) — and the certification tracker through certTrackerList (Certs.gs), every person's to the real
master and the caller's own to everyone else. Call-offs, UI reports and doctor visits are already their own apps'."""
from __future__ import annotations

from typing import Any, Callable

import candidates as CND
import client_sources as CS
import clients as C
import gsjs
import hubdb
import locations as L
import scheduling as SCH
import scope as sc
import staff as SP
from scope import Defer

APP_ID = "opsdash"
WITHHELD = "[withheld"
# Certs.gs CERT_MASTER_COLUMNS and CERT_TRAINING_KEYS: what the settings cells fall back to
MASTER_FLOOR = {"cpr_exp_date": "cpr", "dodd_8_hour_exp": "dodd", "med_1_exp_date": "med1", "med_2_exp_date": "med2",
                "med_3_exp_date": "med3", "money_mgt_date": "money", "mandt_exp_date": "mandt"}
TRAINING_FLOOR = {"cpr exp date": "cpr", "dodd 8-hour exp": "dodd", "dodd 8 hour exp": "dodd", "med 1 exp date": "med1",
                  "med 2 exp date": "med2", "med 3 exp date": "med3", "money mgt date": "money"}
TRACKER_UNREAD = ("The certification tracker could not be read just now — nothing is listed rather than an empty "
                  "tracker.")

s_ = gsjs.str_


def _withheld(rows: list[dict]) -> bool:
    for r in rows:
        for v in (r or {}).values():
            if isinstance(v, str) and v.startswith(WITHHELD):
                return True
    return False


def _service(sess: L.Session) -> dict[str, Any] | None:
    if (sess.user or {}).get("is_service") is not True:
        return {"status": 403, "message": "This is the relay's own read."}
    return None


def _answer(rows: list[dict]) -> dict[str, Any]:
    if _withheld(rows):
        raise Defer("the copy withholds a cell this list shows")
    return {"status": 200, "data": rows}


def people_slice(sess: L.Session, payload: dict) -> dict[str, Any]:
    """route('people', 'list'): listRows_ merged by the roster lens, and without the plans' clients."""
    refused = _service(sess)
    if refused:
        return refused
    reads = sess.reads
    return _answer(list(SP.without_isp_clients(reads, SP.people_merged(reads, SP._people(reads))) or []))


def candidates_slice(sess: L.Session, payload: dict) -> dict[str, Any]:
    """route('candidates', 'list'): talentCandidatesRead_'s cards."""
    refused = _service(sess)
    if refused:
        return refused
    return _answer(list(CND.board(sess.reads)["rows"]))


def clients_slice(sess: L.Session, payload: dict) -> dict[str, Any]:
    """route('clients', 'list'): clientsDerived_ for the relay's identity."""
    refused = _service(sess)
    if refused:
        return refused
    return _answer(list(C.derived(sess.reads) or []))


def work_orders_slice(sess: L.Session, payload: dict) -> dict[str, Any]:
    """route('workOrders', 'list'): estateRoute_ over the estate's House Repair Requests › Repairs."""
    refused = _service(sess)
    if refused:
        return refused
    return _answer([dict(r) for r in CS.estate_rows(sess.reads, "workOrders")])


# ---- the certification tracker (Certs.gs) ---------------------------------------------------------------------------

def _answerable(reads: L.Reads) -> set[str]:
    """certAnswerableKeys_: the courses some source can report on."""
    out: set[str] = set()
    master = SP.cfg_pairs(reads, "ist_cert_master_columns")
    for v in (master["map"] if master.get("order") else MASTER_FLOOR).values():
        if s_(v):
            out.add(s_(v))
    training = SP.cfg_pairs(reads, "ist_cert_training_keys")
    for v in (training["map"] if training.get("order") else TRAINING_FLOOR).values():
        if s_(v):
            out.add(s_(v))
    out.add(SP.CERT_MAIS_KEY)
    out.update(SP.CLEARANCE_CREDENTIALS)
    return out


def _cell(known: dict | None, key: str, answerable: set[str]) -> dict[str, Any]:
    """certMatrixCell_."""
    if known is not None and known.get(key):
        return {"status": s_(known[key].get("status")), "expires": known[key].get("expires") or "", "dated": True,
                "attention": 1 if known[key].get("status") != "valid" else 0}
    if key not in answerable:
        return {"status": "", "expires": "", "dated": False, "attention": 0}
    if known is not None:
        return {"status": "valid", "expires": "", "dated": False, "attention": 0}
    return {"status": "missing", "expires": "", "dated": False, "attention": 1}


def matrix_rows(reads: L.Reads, picture: dict[str, dict]) -> list[dict]:
    """certMatrixRows_: every active person on the roster, a cell per course, the ones needing attention first."""
    columns = SP.cert_matrix_columns(reads)
    answerable = _answerable(reads)
    rows = []
    for p in SP.without_isp_clients(reads, SP.people_merged(reads, SP._people(reads))) or []:
        if s_(p.get("status")).lower() != "active":
            continue
        k = gsjs.name_key(p.get("name"))
        known = picture[k]["certs"] if k and k in picture else None
        row: dict[str, Any] = {"id": "CERT_" + gsjs.js_str(p.get("id")), "name": gsjs.or_text(p.get("name")),
                               "role": gsjs.or_text(p.get("role"))}
        attention = 0
        for c in columns:
            cell = _cell(known, c, answerable)
            row[c] = cell["status"]
            if cell["dated"]:
                row[c + "_expires"] = cell["expires"]
            attention += cell["attention"]
        row["attention"] = attention
        rows.append(row)
    import functools  # noqa: PLC0415
    rows.sort(key=functools.cmp_to_key(lambda a, b: (b["attention"] - a["attention"])
                                       or gsjs.locale_cmp(a["name"], b["name"])))
    return rows


def cert_rows(reads: L.Reads, picture: dict[str, dict]) -> list[dict]:
    """staffCertRows_: one row per person's certificate, the soonest to expire first."""
    rows = []
    for k, p in picture.items():
        for c, cert in p["certs"].items():
            rows.append({"id": "SC_" + k + "_" + c, "personName": p["name"], "certId": "cert-" + c,
                         "certName": SP.cert_label(reads, c), "status": cert.get("status"),
                         "expiresAt": cert.get("expires") or ""})
    import functools  # noqa: PLC0415
    rows.sort(key=functools.cmp_to_key(lambda a, b: gsjs.locale_cmp(gsjs.js_str(a["expiresAt"]),
                                                                    gsjs.js_str(b["expiresAt"]))))
    return rows


def tracker_list(sess: L.Session, payload: dict) -> dict[str, Any]:
    """certTrackerList: the matrix, or one row per certificate — every person's to the real master, the caller's own to
    everyone else; a refusal carries the same scope."""
    user = sess.user or {}
    denied = {"status": 403, "message": "Requires an admin or manager account"}
    if not user or user.get("is_service") or s_(user.get("role")) not in ("admin", "manager", "staff"):
        return denied
    reads = sess.reads
    view = s_((payload or {}).get("view")) or "matrix"
    if view not in ("matrix", "certs"):
        return {"status": 400, "message": 'The tracker is read as "matrix" or "certs".'}
    everyone = sc.is_real_master(user)
    me = None if everyone else SP.compliance_self(reads, user)
    if me is not None and not me.get("key"):
        env = {"status": me["status"], "message": me["why"], "scope": "own"}
        if me.get("found"):
            env["self"] = me["found"]
        return env
    try:
        picture = SCH._cert_picture(reads)
        rows = matrix_rows(reads, picture) if view == "matrix" else cert_rows(reads, picture)
    except (hubdb.Unreadable, Defer):
        raise
    except Exception:  # noqa: BLE001 - nothing listed rather than an empty tracker
        return {"status": 503, "message": TRACKER_UNREAD, "scope": "all" if everyone else "own"}
    if me is not None:
        if view == "matrix":
            rows = [r for r in rows if SP.roster_id(gsjs.js_str(r.get("id"))[5:]) == me["id"]]
        else:
            rows = [r for r in rows if gsjs.name_key(r.get("personName")) == me["key"]]
    return {"status": 200, "data": {"rows": rows, "scope": "all" if everyone else "own",
                                    "self": me["name"] if me is not None else ""}}


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {
    "opsdashPeople": people_slice, "opsdashCandidates": candidates_slice, "opsdashClients": clients_slice,
    "opsdashWorkOrders": work_orders_slice, "certTrackerList": tracker_list}
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
POLICY["certTrackerList"] = {"roles": ("admin", "manager", "staff")}
