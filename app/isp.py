"""The ISP Library (Main.gs RESOURCES.isps) read from Postgres (app/resource_rows.py, uploaded from the isps sheet): every
client's plan for staff and above, a client their own (clientScoped), through the generic list and get
(sheet_resources) — the slice the screen paints from first is this list too. ispPlanPdf files a plan as a PDF on the
server's disk (documents/isp-plans, one file per plan per day, today's older copy replaced) and hands it over."""
from __future__ import annotations

import base64
import io
import logging
import re
from pathlib import Path
from typing import Any, Callable

import gsjs
import isp_intake as II
import isp_pdf as IP
import location_docs as LD
import locations as L
import sheet_resources as SR
import staff_views

log = logging.getLogger("asa-hub-app")

APP_ID = "isp"
RESOURCE = "isps"
APP_DIR = "isp-plans"
ROLES = ("admin", "manager", "staff")
_UNSAFE = re.compile(r"[\\/\x00-\x1f]+")

s_ = gsjs.str_


def base() -> Path:
    return LD.ROOT / APP_DIR


def isps_list(sess: L.Session, payload: dict) -> dict[str, Any]:
    return SR.list_rows(sess, RESOURCE, payload)


def isps_get(sess: L.Session, payload: dict) -> dict[str, Any]:
    return SR.get_row(sess, RESOURCE, payload)


def _render(html: str) -> bytes:
    """The plan's HTML as a PDF, rendered here."""
    from xhtml2pdf import pisa  # noqa: PLC0415 - loaded only when a plan is filed
    out = io.BytesIO()
    # a half of a character the cut left behind prints as "?", as Google's converter prints it
    done = pisa.CreatePDF(html.encode("utf-8", "replace"), dest=out, encoding="utf-8")
    if done.err:
        raise ValueError(f"{done.err} rendering error(s)")
    return out.getvalue()


def plan_pdf(sess: L.Session, payload: dict) -> dict[str, Any]:
    """ispPlanPdf: the plan filed as a PDF on the server and handed to the screen."""
    user = sess.user or {}
    if not user or s_(user.get("role")) not in ROLES:
        return {"status": 403, "message": "Denied."}
    key = s_((payload or {}).get("client_key"))
    if not key:
        return {"status": 400, "message": "client_key: which plan."}
    reads = sess.reads
    row = IP.find_row(SR.rows(reads, RESOURCE), key)
    if row is None:
        return {"status": 404, "message": f'No service plan for "{key}".'}
    try:
        block = row.get("contact_block")
        demo = IP.demographics("" if block is None else str(block), s_(row.get("client_name")))
    except Exception:  # noqa: BLE001 - the plan prints without the facts block
        demo = {}
    today = IP.stamp_day()
    name = IP.pdf_name(row, today)
    try:
        data = _render(IP.plan_html(row, demo, today))
    except Exception as exc:  # noqa: BLE001 - said, nothing filed
        log.warning("ispPlanPdf: %s was not rendered (%s)", s_(row.get("client_name")), type(exc).__name__)
        return {"status": 503, "message": "The PDF could not be made just now — try again in a moment."}
    target = base() / (_UNSAFE.sub("_", s_(row.get("client_name"))).strip(" .") or "plan") / _UNSAFE.sub("_", name)
    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        tmp = target.with_name(target.name + ".part")
        tmp.write_bytes(data)
        tmp.replace(target)
    except OSError as exc:
        return {"status": 503, "message": f"The server's documents folder is not writable ({type(exc).__name__})."}
    staff_views.record(user, "isp_plan_pdf", f"{s_(row.get('client_name'))} → {name}")
    return {"status": 200, "data": {"name": name, "folder": IP.ISP_PDF_FOLDER, "kept": True,
                                    "mime": "application/pdf", "b64": base64.b64encode(data).decode("ascii")}}


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {"ispsList": isps_list, "ispsGet": isps_get,
                                                                    "ispPlanPdf": plan_pdf, **II.ACTIONS_READ}
# the generic verbs declare no roles; the door's own gate decides
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
POLICY["ispPlanPdf"] = {"roles": ROLES, "params": {"client_key": "string"}}
