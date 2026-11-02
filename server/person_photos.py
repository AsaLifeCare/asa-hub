"""PEOPLE'S PHOTOS — a picture uploaded on a person's page in Clients, Staff, SSA, Families, Staff Candidates or Client
Candidates, kept in the project's images folder beside the house photos, as people/<app>/<record key>/<time>.<ext>.
Never overwritten, never deleted; served only to a session one of the apps that show that person is open to. Who may
replace a photo, and which one a page draws, is asa-hub-app's (app/photos.py): this side keeps and hands back bytes."""
from __future__ import annotations

import asyncio
import base64
import json
import os
import re
from pathlib import Path
from typing import Any, Awaitable, Callable

import house_images as H
from house_images import Header, Request, Response

PREFIX = "/hub-lanes/photos"
PEOPLE = "people"
# each folder: the backend app that decides on it, its name on screen, and the apps whose opening lets a session see it
APPS: dict[str, dict[str, Any]] = {
    "clients": {"app": "clients", "label": "Clients",
                "seen_in": ("client-profiles", "ssa-profiles", "family-profiles", "locations", "staff-profiles")},
    "staff": {"app": "staff", "label": "Staff", "seen_in": ("staff-profiles", "locations", "scheduling")},
    "ssa": {"app": "ssa", "label": "SSA", "seen_in": ("ssa-profiles",)},
    "families": {"app": "family", "label": "Families", "seen_in": ("family-profiles",)},
    "staff-candidates": {"app": "candidates", "label": "Staff Candidates", "seen_in": ("staff-candidates",)},
    "client-candidates": {"app": "client-candidates", "label": "Client Candidates", "seen_in": ("client-candidates",)},
}
# a record key that names a folder: never a dot first, never two in a row (app/photos.py KEY_RE)
KEY_RE = re.compile(r"(?!.*\.\.)[A-Za-z0-9_][A-Za-z0-9_.\-]{0,119}")
NAME_RE = re.compile(r"\d{8}T\d{9}Z\.(?:jpg|png|webp)")


def path_of(folder: str, key: str, name: str) -> str:
    return f"{PREFIX}/{folder}/{key}/{name}"


def _dir(folder: str, key: str) -> Path:
    return H.ROOT / PEOPLE / folder / key


def save(folder: str, key: str, data: bytes) -> dict[str, Any]:
    """Keep one photo for the record under a new name; ValueError says a refusal, OSError a disk that took nothing."""
    if folder not in APPS or not KEY_RE.fullmatch(key or ""):
        raise ValueError("No such record folder.")
    name, ext = H.keep_in(_dir(folder, key), data, "A photo is a JPEG, PNG or WebP picture.")
    return {"folder": folder, "key": key, "name": name, "path": path_of(folder, key, name), "type": H.TYPES[ext],
            "bytes": len(data)}


def read(folder: str, key: str, name: str) -> tuple[bytes, str] | None:
    """A kept photo's bytes and type; None when the names are not a photo's or it is not on disk."""
    if folder not in APPS or not KEY_RE.fullmatch(key or "") or not NAME_RE.fullmatch(name or ""):
        return None
    try:
        data = (_dir(folder, key) / name).read_bytes()
    except OSError:
        return None
    return data, H.TYPES[name.rsplit(".", 1)[1]]


def _tally(folders: list[Path]) -> dict[str, int]:
    """How many records hold photos, how many photos and their bytes, across these folders."""
    out = {"records": 0, "photos": 0, "bytes": 0}
    for d in folders:
        try:
            names = [e for e in os.scandir(d) if e.is_file() and NAME_RE.fullmatch(e.name)]
        except OSError:
            continue
        if names:
            out["records"] += 1
            out["photos"] += len(names)
            out["bytes"] += sum(e.stat().st_size for e in names)
    return out


def where() -> dict[str, Any]:
    """The images folder as the server's disk names it, and what each app keeps in it (Settings, the master's alone)."""
    host = H.HOST_ROOT.rstrip("/") or str(H.ROOT)

    def subdirs(p: Path, pattern: re.Pattern[str] | None = None) -> list[Path]:
        try:
            return [Path(e.path) for e in os.scandir(p) if e.is_dir() and (pattern is None or pattern.fullmatch(e.name))]
        except OSError:
            return []

    houses = {"app": "locations", "label": "Locations", "folder": f"{host}/<HOUSE CODE>",
              **_tally(subdirs(H.ROOT, re.compile(r"[A-Z]{2,4}\d{3,6}")))}
    people = [{"app": spec["app"], "label": spec["label"], "folder": f"{host}/{PEOPLE}/{folder}/<record key>",
               **_tally(subdirs(H.ROOT / PEOPLE / folder))} for folder, spec in APPS.items()]
    why = H.problem()
    return {"root": host, "inside": str(H.ROOT), "mounted": not why, "why": why, "apps": [houses, *people]}


def mount(app: Any, *, plan: Callable[[str, str, str], Awaitable[Any]],
          keep: Callable[[str, dict[str, Any], dict[str, Any], dict[str, Any]], Awaitable[dict[str, Any]]],
          reader: Callable[[str, str], Awaitable[bool | None]], master: Callable[[str], Awaitable[bool]],
          log: Any) -> None:
    """The doors: POST {PREFIX}/{folder}/{key} keeps a photo and names it, GET {PREFIX}/{folder}/{key}/{name} hands
    one back, GET {PREFIX}/where says where they are (the master's alone)."""
    cap = H.MAX_BYTES * 4 // 3 + 64 * 1024

    def said(status: int, message: str, reason: str = "") -> dict[str, Any]:
        return {"status": status, "reason": reason or "request", "message": message}

    @app.get(PREFIX + "/where")
    async def person_photo_where(response: Response, authorization: str = Header(default="")) -> dict[str, Any]:
        """Where the platform keeps its pictures, for Settings: the master's own session alone."""
        response.headers["Cache-Control"] = "no-store"
        if not await master(authorization):
            return said(404, "Not found.", "missing")
        return {"status": 200, "data": await asyncio.to_thread(where)}

    @app.post(PREFIX + "/{folder}/{key}")
    async def person_photo_upload(folder: str, key: str, request: Request, response: Response,
                                  authorization: str = Header(default="")) -> dict[str, Any]:
        """One picture for the record: asa-hub-app says who may and which record; then kept here, then named there."""
        response.headers["Cache-Control"] = "no-store"
        spec = APPS.get(folder)
        if spec is None or not KEY_RE.fullmatch(key or ""):
            return said(404, "No such record.", "missing")
        why = H.problem()
        if why:
            log.warning("people's photos: a photo for %s/%s was refused — %s", folder, key, why)
            return said(503, f"The photo cannot be kept: {why}.", "unmounted")
        too_big = said(413, "The picture is larger than 5 MB. Nothing was kept.")
        declared = str(request.headers.get("content-length") or "").strip()
        if declared.isdigit() and int(declared) > cap:
            return too_big
        held = bytearray()
        async for chunk in request.stream():
            held += chunk
            if len(held) > cap:
                return too_big
        try:
            body = json.loads(bytes(held))
            data = base64.b64decode(str((body or {}).get("b64") or ""), validate=True)
        except Exception:  # noqa: BLE001
            return said(400, "Send {name, mime, b64}: one picture.")
        if not data:
            return said(400, "The picture arrived empty.")
        if len(data) > H.MAX_BYTES:
            return too_big
        if not H.kind_of(data):
            return said(400, "A photo is a JPEG, PNG or WebP picture.")
        got = await plan(authorization, spec["app"], key)
        if not isinstance(got, tuple):
            return got
        decided, user = got
        if decided.get("folder") != folder:
            return said(400, "That record is not one of this app's.")
        try:
            kept = await asyncio.to_thread(save, folder, str(decided["key"]), data)
        except ValueError as exc:
            return said(400, str(exc))
        except OSError as exc:
            log.warning("people's photos: a photo for %s/%s was not kept (%s)", folder, key, exc)
            return said(503, f"The photo was not kept: {exc}.", "unmounted")
        log.info("people's photos: %s kept for %s/%s (%d bytes)", kept["name"], folder, decided["key"], kept["bytes"])
        return await keep(authorization, user, decided, kept)

    @app.get(PREFIX + "/{folder}/{key}/{name}")
    async def person_photo_read(folder: str, key: str, name: str, authorization: str = Header(default="")) -> Any:
        """A kept photo, to a session an app that shows the person is open to; anyone else is told no such photo."""
        def no(status: int, message: str) -> Any:
            return Response(json.dumps({"status": status, "message": message}), status_code=status,
                            media_type="application/json", headers={"Cache-Control": "no-store"})

        if folder not in APPS or not KEY_RE.fullmatch(key or "") or not NAME_RE.fullmatch(name or ""):
            return no(404, "No such photo.")
        seen = await reader(authorization, folder)
        if seen is None:
            return no(503, "Who may see the photo could not be checked just now. Try again.")
        if seen is not True:
            return no(404, "No such photo.")
        got = await asyncio.to_thread(read, folder, key, name)
        if got is None:
            return no(404, "No such photo.")
        data, mime = got
        return Response(content=data, media_type=mime,
                        headers={"Cache-Control": "private, max-age=86400, immutable",
                                 "X-Content-Type-Options": "nosniff"})
