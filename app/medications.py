"""The Medications app on Python (Meds.gs, Main.gs RESOURCES.medications / medCatalog): the eMAR medication list (a
clinical tab — a trainee reads none, a client only the rows that name them) and the medicine catalogue, in Postgres
(app.resource_rows, uploaded from medications and med_catalog as the app is given to Python) and read and written there
alone; the Clients page reads the same rows through clients._hub once they are kept here. clientMedsIsp merges each
plan's medication narrative with its active chart rows."""
from __future__ import annotations

import re
from typing import Any, Callable

import clients as C
import gsjs
import locations as L
import resource_rows as RR
import sheet_resources as SR

APP_ID = "medications"
MEDS = "medications"
CATALOG = "medCatalog"
DENIED = {"status": 403, "message": "Requires an admin or manager account"}

s_ = gsjs.str_


def norm(row: dict) -> dict[str, Any]:
    """readTabNormalized_'s keys: lower case, letters and digits only ('Id - Auto' → idauto)."""
    return {re.sub(r"[^a-z0-9]", "", str(k).lower()): v for k, v in row.items()}


def first_url(v: Any) -> str:
    """medsFirstUrl_."""
    m = re.search(r"https://\S+", s_(v))
    return re.sub(r"\]$", "", m.group(0)) if m else ""


def _key(name: Any) -> str:
    return re.sub(r"\s+", " ", s_(name)).strip().lower()


def chart_rows(reads: L.Reads) -> list[dict]:
    """The eMAR list as readTabNormalized_ hands it, out of Postgres."""
    return [norm(r) for r in RR.read_all(reads, MEDS)]


def meds_isp(sess: L.Session, payload: dict) -> dict[str, Any]:
    """clientMedsIsp: each plan's medication narrative, and the chart's active rows under it."""
    user = sess.user or {}
    if not user or user.get("is_service") or s_(user.get("role")) not in ("admin", "manager", "staff", "client"):
        return dict(DENIED)
    reads = sess.reads
    clients: dict[str, dict] = {}
    for r in C._hub(reads, "isps"):
        k = _key(r.get("client_name"))
        if k:
            clients[k] = {"client": s_(r.get("client_name")).strip(), "isp_year": s_(r.get("isp_year")),
                          "isp_text": s_(r.get("medications"))[:4000], "meds": []}
    for r in chart_rows(reads):
        if s_(r.get("discountinued")):
            continue
        k = _key(r.get("client"))
        if not k:
            continue
        c = clients.setdefault(k, {"client": s_(r.get("client")).strip(), "isp_year": "", "isp_text": "", "meds": []})
        name = s_(r.get("prescriptionname")).strip()
        if not name:
            continue
        times = re.findall(r"\d{3,4}", s_(r.get("administrationtimes")))
        prn = s_(r.get("prn"))
        c["meds"].append({"id": s_(r.get("idauto")), "name": name, "dose": s_(r.get("dosage")).strip(),
                          "route": s_(r.get("medtype")).strip(),
                          "times": [t.zfill(4)[-4:][:2] + ":" + t.zfill(4)[-4:][2:] for t in times],
                          "prn": bool(re.search(r"prn|as needed", prn, re.I)), "freq": prn.strip(),
                          "image": first_url(r.get("medpictures")), "source": "emar"})
    out = sorted(clients.values(), key=lambda c: c["client"].lower())
    # a client, or an SSA or a FAMILY whatever its role says: its own clients alone (sheet_resources.own_keys)
    if SR._client(user):
        names: set[str] = set()
        for ck in SR.own_keys(sess):
            names |= SR._client_names(reads, ck)
        out = [c for c in out if gsjs.name_key(c["client"]) in names]
    return {"status": 200, "data": {"clients": out}}


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {
    "medicationsList": lambda s, p: SR.list_rows(s, MEDS, p), "medicationsGet": lambda s, p: SR.get_row(s, MEDS, p),
    "medCatalogList": lambda s, p: SR.list_rows(s, CATALOG, p), "medCatalogGet": lambda s, p: SR.get_row(s, CATALOG, p),
    "clientMedsIsp": meds_isp}
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
POLICY["clientMedsIsp"] = {"roles": ("admin", "manager", "staff", "client")}
