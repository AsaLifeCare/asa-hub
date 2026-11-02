"""Docs (the library's `documents` resource): the documents the Library lists and Settings › Docs registers, kept in
asa-hub-db's own app.resource_rows and read there alone (sheet_resources)."""
from __future__ import annotations

from typing import Any, Callable

import client_writes as CW
import locations as L
import scope as sc

APP_ID = "docs"
RESOURCE = TAB = "documents"
# Settings › Editions: who else, beside the admins, the managers and the master, registers the library's documents
EDITION = "docs.library"


def rows(reads: L.Reads) -> list[dict]:
    """Every document of the library, as the table keeps it."""
    import sheet_resources as SR  # noqa: PLC0415 - it imports the apps this module serves

    return SR.rows(reads, RESOURCE)


def edition_holds(sess: L.Session) -> bool:
    """A person docs.library lists, Docs open to them, from their own account."""
    user = sess.user or {}
    if user.get("is_service") is True or user.get("visiting_member"):
        return False
    if not sc.profile_app_gate(APP_ID, user, sess.reads.scope_sources()).get("open"):
        return False
    return sc.edition_allows(EDITION, user, sess.reads.config())


def may_write(sess: L.Session) -> bool:
    """An admin, a manager, the service, or a person the edition lists."""
    user = sess.user or {}
    return user.get("is_service") is True or CW.writer(user) or edition_holds(sess)


def by_edition(sess: L.Session) -> str:
    """The edition that let a write in, '' for an admin, a manager or the service."""
    user = sess.user or {}
    return EDITION if user.get("is_service") is not True and not CW.writer(user) and edition_holds(sess) else ""


def docs_list(sess: L.Session, payload: dict) -> dict[str, Any]:
    """route('documents', 'list'): listRows_ (its q, offset and limit), then a client's narrowing."""
    import sheet_resources as SR  # noqa: PLC0415

    return SR.list_rows(sess, RESOURCE, payload)


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {"docsList": docs_list}
# the generic list declares no roles; the door's own gate decides
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
