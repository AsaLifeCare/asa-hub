"""The Task Board (Main.gs RESOURCES.tasks) read from Postgres (app/resource_rows.py, uploaded from the tasks sheet): each
person's own cards (ownedBy ownerId, else assigneeId) through the generic list and get (sheet_resources), and a card's
attachment the server keeps (taskFileStore on Python) handed to the viewer by taskFile — its uploader's alone, as the
Drive file was shared with the uploader alone."""
from __future__ import annotations

import base64
from pathlib import Path
from typing import Any, Callable

import gsjs
import location_docs as LD
import locations as L
import resource_rows as RR
import sheet_resources as SR

APP_ID = "taskboard"
RESOURCE = "tasks"
FILES = "app.task_files"
APP_DIR = "tasks"
# what a kept attachment's url says: the platform's own copy, read through taskFile
KEPT = "hubfile:tasks/"
NO_FILE = "No such attachment — or it is not yours to open."

s_ = gsjs.str_


def base() -> Path:
    return LD.ROOT / APP_DIR


def tasks_list(sess: L.Session, payload: dict) -> dict[str, Any]:
    return SR.list_rows(sess, RESOURCE, payload)


def tasks_get(sess: L.Session, payload: dict) -> dict[str, Any]:
    return SR.get_row(sess, RESOURCE, payload)


def task_file(sess: L.Session, payload: dict) -> dict[str, Any]:
    """taskFile: a kept attachment's bytes for the viewer — its uploader's alone."""
    user = sess.user or {}
    if not user or user.get("is_service"):
        return {"status": 404, "message": NO_FILE}
    url = s_((payload or {}).get("url"))
    fid = url[len(KEPT):] if url.startswith(KEPT) else ""
    if not fid:
        return {"status": 400, "message": "url: an attachment kept by the platform."}
    got = RR._q(sess.reads, f"select name, mime, path, by_email from {FILES} where id = %s", (fid,))
    if not got or s_(got[0][3]).lower() != s_(user.get("email")).lower():
        return {"status": 404, "message": NO_FILE}
    name, mime, rel, _by = got[0]
    try:
        data = (base() / rel).read_bytes()
    except OSError:
        return {"status": 503, "message": "The kept copy could not be read from the server's disk just now."}
    return {"status": 200, "data": {"name": s_(name), "mime": s_(mime) or "application/octet-stream",
                                    "size": len(data), "b64": base64.b64encode(data).decode("ascii")}}


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {"tasksList": tasks_list, "tasksGet": tasks_get,
                                                                    "taskFile": task_file}
# the generic verbs declare no roles; the door's own gate decides
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
POLICY["taskFile"] = {"params": {"url": "string"}}
