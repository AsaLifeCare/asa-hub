"""HOUSE PHOTOS — a picture uploaded from Locations, kept in the project's own images folder as images/<house>/<time>.<ext>.
Never overwritten, never deleted; served only to a session this app's gate says may see the house (app/photo_doors.py).
People's photos live beside them, under images/people (app/person_photos.py)."""
from __future__ import annotations

import asyncio
import base64
import json
import os
import re
import tempfile
import time
from pathlib import Path
from typing import Any, Awaitable, Callable

# at the top, never inside mount(): with postponed annotations FastAPI reads a door's `request: Request` by its name
# in this module, and a name it cannot find there turns the parameter into a required query field (every POST a 422)
try:
    from fastapi import Header, Request, Response
except ImportError:  # the pure parts stay importable without it
    Header = Request = Response = None  # type: ignore[assignment,misc]

# asa-hub/images as this app sees it (bound in by its compose service), and as the server's own disk names it
ROOT = Path(os.getenv("HUB_IMAGES_DIR", "/srv/images"))
HOST_ROOT = os.getenv("HUB_IMAGES_HOST_DIR", "")
# the repository's own images/.gitkeep: only asa-hub/images carries it, so a photo never lands anywhere else
MARK = ".gitkeep"
MAX_BYTES = 5 * 1024 * 1024
PREFIX = "/hub-lanes/locations/image"
TYPES = {"jpg": "image/jpeg", "png": "image/png", "webp": "image/webp"}
_CODE = re.compile(r"^[A-Z]{2,4}\d{3,6}$")
_NAME = re.compile(r"^\d{8}T\d{9}Z\.(?:jpg|png|webp)$")
# the house registry's thumbnail_url for a photo kept here (Locations.gs LOCATION_IMAGE_RE)
URL_RE = re.compile(r"^https://[A-Za-z0-9.-]+(?::\d{1,5})?" + re.escape(PREFIX)
                    + r"/([A-Z]{2,4}\d{3,6})/(\d{8}T\d{9}Z\.(?:jpg|png|webp))$")


def kind_of(data: bytes) -> str:
    """What the picture's own bytes say it is: 'jpg', 'png', 'webp', or '' for anything else."""
    if data[:3] == b"\xff\xd8\xff":
        return "jpg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    return ""


def url_house(v: Any) -> str:
    """The house a stored photo URL names when it is one kept here; '' otherwise."""
    m = URL_RE.match(str(v or "").strip())
    return m.group(1) if m else ""


def path_of(code: str, name: str) -> str:
    return f"{PREFIX}/{code}/{name}"


def problem() -> str:
    """'' while asa-hub/images is mounted where the photos are kept; else why nothing can be kept."""
    try:
        return "" if (ROOT / MARK).is_file() else f"the images folder is not mounted at {ROOT}"
    except OSError as exc:
        return f"the images folder could not be read ({type(exc).__name__})"


def save(code: str, data: bytes, now: float | None = None) -> dict[str, Any]:
    """Keep one photo for the house under a new name; ValueError says a refusal, OSError a disk that took nothing."""
    if not _CODE.match(code or ""):
        raise ValueError("house: a house code, such as ABD1305.")
    name, ext = keep_in(ROOT / code, data, "A house photo is a JPEG, PNG or WebP picture.", now)
    return {"house": code, "name": name, "path": path_of(code, name), "type": TYPES[ext], "bytes": len(data)}


def keep_in(folder: Path, data: bytes, kind_said: str, now: float | None = None) -> tuple[str, str]:
    """One picture written into `folder` (made when missing, inside ROOT) under a new <time>.<ext> name, never over
    another: (its name, its kind). ValueError says a refusal, OSError a disk that took nothing."""
    if not data:
        raise ValueError("The picture arrived empty.")
    if len(data) > MAX_BYTES:
        raise ValueError("The picture is larger than 5 MB.")
    ext = kind_of(data)
    if not ext:
        raise ValueError(kind_said)
    why = problem()
    if why:
        raise OSError(why)
    folder.mkdir(mode=0o750, parents=True, exist_ok=True)
    stamp = int(round((time.time() if now is None else now) * 1000))
    fd, temp = tempfile.mkstemp(dir=str(folder), prefix=".up-")
    name = ""
    try:
        with os.fdopen(fd, "wb") as out:
            out.write(data)
            out.flush()
            os.fsync(out.fileno())
        os.chmod(temp, 0o640)
        for step in range(1000):
            ms = stamp + step
            candidate = time.strftime("%Y%m%dT%H%M%S", time.gmtime(ms // 1000)) + f"{ms % 1000:03d}Z.{ext}"
            try:
                # a link never replaces a file: an older photo is never written over
                os.link(temp, folder / candidate)
            except FileExistsError:
                continue
            name = candidate
            break
    finally:
        try:
            os.unlink(temp)
        except OSError:
            pass
    if not name:
        raise OSError("no free name for the photo")
    return name, ext


def read(code: str, name: str) -> tuple[bytes, str] | None:
    """A kept photo's bytes and type; None when the names are not a photo's or it is not on disk."""
    if not _CODE.match(code or "") or not _NAME.match(name or ""):
        return None
    try:
        data = (ROOT / code / name).read_bytes()
    except OSError:
        return None
    return data, TYPES[name.rsplit(".", 1)[1]]


def mount(app: Any, *, reader: Callable[[str, str], Awaitable[bool | None]],
          writer: Callable[[str], Awaitable[dict[str, Any] | None]], known: Callable[[str], Awaitable[bool | None]],
          log: Any) -> None:
    """The two doors: POST {PREFIX}/{code} keeps a photo, GET {PREFIX}/{code}/{name} hands one back."""
    cap = MAX_BYTES * 4 // 3 + 64 * 1024

    @app.post(PREFIX + "/{code}")
    async def house_image_upload(code: str, request: Request, response: Response,
                                 authorization: str = Header(default="")) -> dict[str, Any]:
        """One picture for the house: the master, or a person the house edition names; validated, then kept."""
        response.headers["Cache-Control"] = "no-store"
        code = str(code or "").strip().upper()
        if not _CODE.match(code):
            return {"status": 400, "reason": "request", "message": "house: a house code, such as ABD1305."}
        who = await writer(authorization)
        if not who:
            return {"status": 403, "reason": "edition", "message": "Replacing a house photo is not open to you."}
        listed = await known(code)
        if listed is None:
            return {"status": 503, "reason": "unreadable",
                    "message": "The houses list could not be read just now. Try again. Nothing was kept."}
        if not listed:
            return {"status": 404, "reason": "missing", "message": f"No house {code} is on the houses list."}
        why = problem()
        if why:
            log.warning("house images: a photo for %s was refused — %s", code, why)
            return {"status": 503, "reason": "unmounted", "message": f"The photo cannot be kept: {why}."}
        too_big = {"status": 413, "reason": "request", "message": "The picture is larger than 5 MB. Nothing was kept."}
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
            return {"status": 400, "reason": "request", "message": "Send {name, mime, b64}: one picture."}
        try:
            got = await asyncio.to_thread(save, code, data)
        except ValueError as exc:
            return {"status": 400, "reason": "request", "message": str(exc)}
        except OSError as exc:
            log.warning("house images: a photo for %s was not kept (%s)", code, exc)
            return {"status": 503, "reason": "unmounted", "message": f"The photo was not kept: {exc}."}
        log.info("house images: %s kept for %s (%d bytes)", got["name"], code, got["bytes"])
        return {"status": 200, "data": got}

    @app.get(PREFIX + "/{code}/{name}")
    async def house_image_read(code: str, name: str, authorization: str = Header(default="")) -> Any:
        """A kept photo, to a session that may see the house; anyone else is told no such photo."""
        def said(status: int, message: str) -> Any:
            return Response(json.dumps({"status": status, "message": message}), status_code=status,
                            media_type="application/json", headers={"Cache-Control": "no-store"})

        if not _CODE.match(code or "") or not _NAME.match(name or ""):
            return said(404, "No such photo.")
        seen = await reader(authorization, code)
        if seen is None:
            return said(503, "Who may see the house could not be checked just now. Try again.")
        if seen is not True:
            return said(404, "No such photo.")
        got = await asyncio.to_thread(read, code, name)
        if got is None:
            return said(404, "No such photo.")
        data, mime = got
        return Response(content=data, media_type=mime,
                        headers={"Cache-Control": "private, max-age=86400, immutable",
                                 "X-Content-Type-Options": "nosniff"})
