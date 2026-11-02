"""People's photos: the picture a page shows for a client, a staff member, an SSA, a family member or a candidate,
uploaded on that page and kept on the platform's server (app/person_photos.py, app/photo_doors.py). app.photos
(db/photos.sql) names every one kept, never removed; the newest per record is the avatar every read of that app draws,
ahead of whatever the books name. Who replaces a photo is each app's own edit door: the master always."""
from __future__ import annotations

import logging
import re
from typing import Any, Callable

import gsjs
import locations as L
import scope as sc
import writes as W
from scope import Defer
from writes import HELD, Decision

log = logging.getLogger("asa-hub-app")

TABLE = "app.photos"
# the backend app, its folder on the server (and in the photo's path), the payload field naming the record, the write
# that keeps it, and the edition that edits the record's details
APPS: dict[str, dict[str, str]] = {
    "clients": {"folder": "clients", "label": "Clients", "field": "client", "action": "clientProfilePhoto",
                "edition": "clients.profile"},
    "staff": {"folder": "staff", "label": "Staff", "field": "staff", "action": "staffProfilePhoto",
              "edition": "staff.profile"},
    "ssa": {"folder": "ssa", "label": "SSA", "field": "ssa", "action": "ssaProfilePhoto", "edition": "ssa.profile"},
    "family": {"folder": "families", "label": "Families & Guardians", "field": "family", "action": "familyProfilePhoto",
               "edition": "family.profile"},
    "candidates": {"folder": "staff-candidates", "label": "Staff Candidates", "field": "candidate",
                   "action": "candidateProfilePhoto", "edition": "candidates.information"},
    "client-candidates": {"folder": "client-candidates", "label": "Client Candidates", "field": "candidate",
                          "action": "clientCandidatePhoto", "edition": "clientCandidates.information"},
}
# a record key that names a folder: never a dot first, never two in a row
KEY_RE = re.compile(r"(?!.*\.\.)[A-Za-z0-9_][A-Za-z0-9_.\-]{0,119}")
# a kept photo's path (person_photos.PATH_RE)
PATH_RE = re.compile(r"/hub-lanes/photos/(clients|staff|ssa|families|staff-candidates|client-candidates)/"
                     r"((?!.*\.\.)[A-Za-z0-9_][A-Za-z0-9_.\-]{0,119})/(\d{8}T\d{9}Z\.(?:jpg|png|webp))")
TYPES = {"jpg": "image/jpeg", "png": "image/png", "webp": "image/webp"}
MAX_BYTES = 5 * 1024 * 1024
CACHES = "Every read of the app draws it at once; the record and the roster are read again."


def newest(reads: L.Reads, app: str) -> dict[str, str]:
    """The newest photo kept per record of `app`, once per request; {} (said in the log) when the table cannot be read:
    the pages then draw what the books name."""
    def read() -> dict[str, str]:
        try:
            rows = reads.db.query(f"select distinct on (record_key) record_key, path from {TABLE} where app = %s"
                                  " order by record_key, id desc", (app,))
        except Exception as exc:  # noqa: BLE001 - the books' photo still stands
            log.warning("photos: %s's kept photos not read (%s)", app, type(exc).__name__)
            return {}
        return {str(k): str(p) for k, p in rows}
    return reads.once("photos:" + app, read)


def of(reads: L.Reads, app: str, key: Any, fallback: Any = "") -> str:
    """The record's avatar: its newest kept photo, else `fallback`."""
    return newest(reads, app).get(gsjs.trim(gsjs.or_blank(key))) or gsjs.or_text(fallback)


# ---- each app's own door, and the record its key names ---------------------------------------------------------------

def _clients(sess: L.Session, key: Any) -> tuple[dict | None, dict]:
    import client_writes as CW  # noqa: PLC0415 - the app modules import this one
    import clients as C  # noqa: PLC0415
    shut = CW.edit_door(sess, {"client": key}, APPS["clients"]["edition"])
    return shut, ({} if shut else C.client_ctx(sess.reads, key))


def _staff(sess: L.Session, key: Any) -> tuple[dict | None, dict]:
    import staff as SP  # noqa: PLC0415
    import staff_writes as SW  # noqa: PLC0415
    shut = SW.edit_door(sess, (APPS["staff"]["edition"],))
    return (shut.answer, {}) if shut else (None, SP.person(sess.reads, key))


def _ssa(sess: L.Session, key: Any) -> tuple[dict | None, dict]:
    import ssa as S  # noqa: PLC0415
    shut = S.edit_door(sess, APPS["ssa"]["edition"])
    return shut, ({} if shut else S.ssa_ctx(sess.reads, key))


def _family(sess: L.Session, key: Any) -> tuple[dict | None, dict]:
    import family as F  # noqa: PLC0415
    shut = F.edition_door(sess, APPS["family"]["edition"])
    return shut, ({} if shut else F.family_ctx(sess.reads, key))


def _candidates(sess: L.Session, key: Any) -> tuple[dict | None, dict]:
    import candidate_writes as CDW  # noqa: PLC0415
    import candidates as CND  # noqa: PLC0415
    shut = CDW.edit_door(sess, APPS["candidates"]["edition"])
    return shut, ({} if shut else CND.candidate_of(sess.reads, key))


def _client_candidates(sess: L.Session, key: Any) -> tuple[dict | None, dict]:
    import client_candidate_writes as CCW  # noqa: PLC0415
    import client_candidates as CC  # noqa: PLC0415
    shut = CCW.edit_door(sess, APPS["client-candidates"]["edition"])
    return shut, ({} if shut else CC.candidate_of(sess.reads, key))


DOORS: dict[str, Callable[[L.Session, Any], tuple[dict | None, dict]]] = {
    "clients": _clients, "staff": _staff, "ssa": _ssa, "family": _family, "candidates": _candidates,
    "client-candidates": _client_candidates}


def _record(sess: L.Session, app: str, key: Any) -> tuple[dict | None, dict]:
    """(the refusal, the record): the app's door first, then the record; a record the books cannot say is a 503."""
    shut, ctx = DOORS[app](sess, key)
    if shut:
        return shut, {}
    if ctx.get("refused"):
        return ctx["refused"], {}
    if not KEY_RE.fullmatch(gsjs.js_str(ctx.get("key"))):
        return {"status": 400, "message": "This record's key cannot name a folder on the server."}, {}
    return None, ctx


# ---- the doors -------------------------------------------------------------------------------------------------------

def plan(sess: L.Session, payload: dict) -> dict[str, Any]:
    """photoPlan (asked before a picture is kept): the record and its folder, or the refusal."""
    app = gsjs.trim(gsjs.or_blank(payload.get("app")))
    spec = APPS.get(app)
    if spec is None:
        return {"status": 400, "message": "app: one of " + ", ".join(APPS) + "."}
    shut, ctx = _record(sess, app, payload.get("key"))
    if shut:
        return shut
    return {"status": 200, "data": {"app": app, "key": ctx["key"], "folder": spec["folder"],
                                    "name": gsjs.or_text(ctx.get("name")) or ctx["key"], "action": spec["action"],
                                    "field": spec["field"]}}


def keep(sess: L.Session, app: str, payload: dict) -> Decision:
    """<app>Photo: the picture just kept named as the record's photo — final, in app.photos."""
    spec = APPS[app]
    shut, ctx = _record(sess, app, payload.get(spec["field"]))
    if shut:
        if shut.get("status") == 503:
            raise Defer(str(shut.get("message") or "the record could not be read")[:160])
        return Decision(shut, fresh=True)
    key = ctx["key"]
    path = gsjs.trim(gsjs.or_blank(payload.get("path")))
    m = PATH_RE.fullmatch(path)
    if not m or m.group(1) != spec["folder"] or m.group(2) != key:
        return W.refuse(400, "path: the photo the server kept for this record.")
    size = payload.get("bytes")
    size = size if isinstance(size, int) and not isinstance(size, bool) and 0 < size <= MAX_BYTES else 0
    cur = HELD.get()
    if cur is None:
        raise Defer("a photo is named only under the platform's write lock")
    user = sess.user or {}
    edition = "" if sc.is_real_master(sess.user) else spec["edition"]
    cur.execute(f"insert into {TABLE} (app, record_key, path, mime_type, size_bytes, added_by, added_by_name, edition)"
                " values (%s, %s, %s, %s, %s, %s, %s, %s)",
                (app, key, path, TYPES[m.group(3).rsplit(".", 1)[1]], size,
                 gsjs.str_(user.get("id")) or W.who(user), W.who(user), edition))
    name = gsjs.or_text(ctx.get("name")) or key
    answer = {"status": 200, "data": {"app": app, "key": key, "photo": path,
                                      **W.pg_steps(f"{name}'s new photo", CACHES, app)}}
    return Decision(answer, subject=key, own=True, edition=edition)


def door(app: str) -> Callable[[L.Session, dict], Decision]:
    """The app's own write for its photo, as its write module lists it."""
    return lambda sess, payload: keep(sess, app, payload)


def policy(app: str) -> dict[str, Any]:
    return {"roles": sc.EDITION_ROLES, "params": {APPS[app]["field"]: "string", "path": "string", "bytes": "number"}}


ACTIONS: dict[str, Callable[[L.Session, dict], dict]] = {"photoPlan": plan}
POLICY: dict[str, dict[str, Any]] = {"photoPlan": {"roles": sc.EDITION_ROLES,
                                                   "params": {"app": "string", "key": "string"}}}
