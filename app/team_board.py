"""Kanban (the teamboard app) read from Postgres (app/resource_rows.py, uploaded from the team_tasks and
project_work_items sheets): the company's shared board (`teamTasks`, held live and never mirrored) and the work items
its cards link to (`projectWorkItems`), through the generic list and get (sheet_resources). The board is for
employees: a client or a trainee is refused at the data."""
from __future__ import annotations

from typing import Any, Callable

import gsjs
import locations as L
import sheet_resources as SR

APP_ID = "teamboard"


def team_tasks_list(sess: L.Session, payload: dict) -> dict[str, Any]:
    return SR.list_rows(sess, "teamTasks", payload)


def team_tasks_get(sess: L.Session, payload: dict) -> dict[str, Any]:
    return SR.get_row(sess, "teamTasks", payload)


def work_items_list(sess: L.Session, payload: dict) -> dict[str, Any]:
    return SR.list_rows(sess, "projectWorkItems", payload)


def work_items_get(sess: L.Session, payload: dict) -> dict[str, Any]:
    return SR.get_row(sess, "projectWorkItems", payload)


# Files.gs libraryUpload: the Library Files folder under the platform's own, a stored file's name dated, 25MB at most
LIBRARY_FOLDER = "Library Files"
LIBRARY_MAX_BYTES = 25 * 1024 * 1024


def library_upload_plan(sess: L.Session, payload: dict) -> dict[str, Any]:
    """libraryUpload before Drive, for the relay: the writer's refusal, then where the file goes and its stored name."""
    import cert_docs as CD  # noqa: PLC0415 - the platform folder the papers are filed under
    user = sess.user or {}
    if gsjs.str_(user.get("role")) not in ("admin", "manager"):
        return {"status": 403, "message": "Requires an admin or manager account"}
    p = payload if isinstance(payload, dict) else {}
    chars = p.get("b64_chars")
    if not isinstance(chars, int) or isinstance(chars, bool) or chars <= 0:
        return {"status": 400, "message": "No file attached"}
    name = gsjs.str_(p.get("filename")) or "library-file"
    return {"status": 200, "data": {
        "platform_root": gsjs.trim(gsjs.or_text(sess.reads.db.prop("HUB_PLATFORM_FOLDER_ID"))) or CD.PLATFORM_ROOT,
        "folder": LIBRARY_FOLDER, "file_name": name, "drive_name": sess.reads.now.strftime("%Y-%m-%d") + "__" + name,
        "mime_type": gsjs.str_(p.get("mime_type")) or "application/octet-stream", "max_bytes": LIBRARY_MAX_BYTES}}


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {
    "teamTasksList": team_tasks_list, "teamTasksGet": team_tasks_get,
    "projectWorkItemsList": work_items_list, "projectWorkItemsGet": work_items_get,
    "libraryUploadPlan": library_upload_plan}
# the generic verbs declare no roles; each door's own gate decides; libraryUpload is for admins and managers
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
POLICY["libraryUploadPlan"] = {"roles": ("admin", "manager")}
