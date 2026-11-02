"""The mock outbox's web rows (CommMock.gs commMockWebIngest): what the relay's web gate held — a notice on a screen, a
push, a roster write (server/web_gate.py mock_rows) — kept on the relay's disk until the mock outbox (comm_mock) takes
them. app/comm_mock_writes.py keeps them in its table (app.comm_mock), each id once; here, which rows it takes."""
from __future__ import annotations

import re
from typing import Any, Callable

import gsjs
import locations as L
import smart_comms as SC
import smart_comms_writes as SW

APP_ID = "comm-mock"
TAB = SC.MOCK_TAB
HEADER = SC.MOCK_HEADER
WEB_CHANNELS = {"web_notice": "webNotice", "web_push": "webPush", "roster_write": "rosterWrite"}
WEB_MAX = 50
BODY_MAX = 4000
_WEB_ID = re.compile(r"^web_[0-9a-f]{20}$")


def web_rows(rows: Any) -> dict[str, list]:
    """commMockWebRows_: a relay row id and a web channel, every header cell carried, the method named."""
    out: dict[str, list] = {"rows": [], "refused": []}
    for r in (rows if isinstance(rows, list) else [])[:WEB_MAX]:
        r = r if isinstance(r, dict) else {}
        rid = gsjs.or_text(r.get("id"))
        if not _WEB_ID.match(rid):
            out["refused"].append({"id": rid, "why": "not a relay row id"})
            continue
        channel = gsjs.or_text(r.get("channel"))
        if channel not in WEB_CHANNELS:
            out["refused"].append({"id": rid, "why": "not a web channel: " + channel})
            continue
        row = {h: "" if r.get(h) is None else r.get(h) for h in HEADER}
        row["id"] = rid
        row["method"] = WEB_CHANNELS[channel]
        row["body"] = SW.js_slice(gsjs.js_str(row["body"]), BODY_MAX)
        out["rows"].append(row)
    return out


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {}
POLICY: dict[str, dict[str, Any]] = {}
