"""Docs' writes (route('documents', create | update | delete)): a document registered, its title, link or category
changed, or taken out of the library, in asa-hub-db's own app.resource_rows (sheet_resources' generic verbs), each
behind Docs' own gate: an admin, a manager, the service, or a holder of the docs.library edition."""
from __future__ import annotations

import json
from typing import Any, Callable

import docs as D
import locations as L
import resource_rows as RR
import writes as W
from writes import Decision

BUSY = "Somebody else is changing the library right now — try again."
DENIED = "Requires an admin or manager account"


def serialize(v: Any) -> str:
    """serialize_: what a cell holds once the row is written."""
    if v is None:
        return ""
    if isinstance(v, (dict, list)):
        return json.dumps(v, separators=(",", ":"), ensure_ascii=False)
    return W.sheet_text(v)


def _verb(sess: L.Session, payload: dict, run: Callable[..., Decision]) -> Decision:
    if not D.may_write(sess):
        return W.refuse(403, DENIED)
    return run(sess, D.RESOURCE, payload if isinstance(payload, dict) else {})


def docs_create(sess: L.Session, payload: dict) -> Decision:
    """route('documents', 'create'): createRow_ — the payload's fields, an id, createdAt and updatedAt."""
    import sheet_resources as SR  # noqa: PLC0415 - it imports the apps this module serves

    return _verb(sess, payload, SR.create_row)


def docs_update(sess: L.Session, payload: dict) -> Decision:
    """route('documents', 'update'): updateRowById_ — the row merged with the payload, updatedAt refreshed."""
    import sheet_resources as SR  # noqa: PLC0415

    return _verb(sess, payload, SR.update_row)


def docs_delete(sess: L.Session, payload: dict) -> Decision:
    """route('documents', 'delete'): a document taken out of the library."""
    import sheet_resources as SR  # noqa: PLC0415

    return _verb(sess, payload, SR.delete_row)


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {"docsCreate": docs_create, "docsUpdate": docs_update,
                                                             "docsDelete": docs_delete}
# the generic verbs declare no roles; each door's own gate decides (an edition lets its people in beside the writers)
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
BUSY_OF: dict[str, dict[str, Any]] = {a: {"status": 409, "message": BUSY} for a in ACTIONS}


class Store(RR.Store):
    """app.docs_writes and app.docs_receipts, beside the other apps' own; a void takes its rows' changes back."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="docs", label="Docs")
