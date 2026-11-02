"""The last route of the app: every path nginx sends asa-hub-app that no route before it answers. It once carried the
request to the relay (asa-hub-snapshot); the relay is retired, so the path is answered here as one nobody serves: 404,
said once an hour per path so a page still asking for it shows in the log. The route stays, last, so a path the app
does not answer never falls through to anything else."""
from __future__ import annotations

import logging
import time
from typing import Any

from fastapi import Request
from fastapi.responses import Response

log = logging.getLogger("asa-hub-app.relay-carrier")

METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"]
MISSING = b'{"status": 404, "reason": "missing", "message": "Not found."}'
SAID_EVERY_S = 3600.0
_SAID: dict[str, float] = {}


async def carry(request: Request) -> Response:
    """No route of the app answers this path: 404, as nginx says a path it does not know."""
    key = f"{request.method} {request.url.path}"
    now = time.monotonic()
    if now - _SAID.get(key, -SAID_EVERY_S) >= SAID_EVERY_S:
        if len(_SAID) > 2000:
            _SAID.clear()
        _SAID[key] = now
        log.warning("no route answers %s — 404", key)
    return Response(MISSING, status_code=404, media_type="application/json", headers={"Cache-Control": "no-store"})


def install(app: Any) -> None:
    """The last route of main.py's app: whatever none before it matched."""
    app.api_route("/{path:path}", methods=METHODS, include_in_schema=False)(carry)
