"""My Inbox for a client-role account (server/my_inbox.py family_board): New staff from the family view's answer
(myFamily), the company notices at the houses it names (web_notices.house_news), and the read marks the relay keeps
for these accounts and for its own builder (asa_hub_inbox_reads, the relay's table in asa-hub-db's schema app, on
lanes_db). The relay's functions, copied; the small words, the heads, the items and the settling are my_inbox's own,
which are the relay's."""
from __future__ import annotations

import contextlib
import logging
import re
from datetime import datetime, timezone
from typing import Any, Callable

import lanes_db as hub_db
import lanes_pg as psycopg2
import my_inbox as mi
import my_work as mw

log = logging.getLogger("asa-hub-app.inbox")

UTC = timezone.utc
_text, item, head = mi._text, mi.item, mi.head  # noqa: SLF001 - the relay's own words, one copy
STATE_READY, STATE_UNREADABLE, STATE_NOT_ATTRIBUTABLE = mi.STATE_READY, mi.STATE_UNREADABLE, mi.STATE_NOT_ATTRIBUTABLE
STATE_HELD, STATE_CLOSED = mi.STATE_HELD, mi.STATE_CLOSED
Unreadable, NotAttributable, Closed, Held = mi.Unreadable, mi.NotAttributable, mi.Closed, mi.Held
KEY_RE, NOTICE_KEY_RE = mi.KEY_RE, mi.NOTICE_KEY_RE
READ_MAX = 500
HELD_WHY = mi.HELD_WHY
KEPT_WHY_ACTING = "Read marks are not kept in a switched session."
PRUNE_KINDS = ("punch", "move", "staff", "staffcount", "client", "prospects")
PRUNE_DAYS = 60


# ── the relay's store: read marks (additive, created on the first own read) ─────────────────────────────────────────

READS_DDL = (
    "CREATE TABLE IF NOT EXISTS asa_hub_inbox_reads ("
    "user_id TEXT NOT NULL, alert_key TEXT NOT NULL, "
    "read_at TIMESTAMPTZ NOT NULL DEFAULT now(), dismissed_at TIMESTAMPTZ, "
    "PRIMARY KEY (user_id, alert_key))"
)
SEEN_DDL = (
    "CREATE TABLE IF NOT EXISTS asa_hub_inbox_seen ("
    "kind TEXT NOT NULL, key TEXT NOT NULL, first_seen TIMESTAMPTZ NOT NULL DEFAULT now(), "
    "PRIMARY KEY (kind, key))"
)
DDL = (READS_DDL, SEEN_DDL)
_READY: set[str] = set()


def _connect(dsn: str):
    return hub_db.connect(dsn, connect_timeout=5)


def _ensure(cur, dsn: str) -> None:
    if dsn in _READY:
        return
    for statement in DDL:
        cur.execute(statement)
    _READY.add(dsn)


def _forget(dsn: str) -> None:
    _READY.discard(dsn)


def _table_here(cur, name: str) -> bool:
    cur.execute("SELECT to_regclass(%s) IS NOT NULL AS here", (name,))
    got = cur.fetchone()
    return bool(got["here"] if isinstance(got, dict) else (got or [False])[0])


def read_marks(dsn: str, uid: str, keys: list[str], *, ensure: bool) -> dict[str, dict[str, Any]]:
    """This account's marks on these keys. `ensure` False never writes: a table not made yet is no marks."""
    uid = str(uid or "").strip()
    if not uid or not keys:
        return {}
    try:
        with contextlib.closing(_connect(dsn)) as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                if ensure:
                    _ensure(cur, dsn)
                elif not _table_here(cur, "asa_hub_inbox_reads"):
                    return {}
                cur.execute("SELECT alert_key, read_at, dismissed_at FROM asa_hub_inbox_reads "
                            "WHERE user_id=%s AND alert_key = ANY(%s)", (uid, list(keys)))
                got = {str(r["alert_key"]): dict(r) for r in cur.fetchall()}
            conn.commit()
    except Exception:
        _forget(dsn)
        raise
    return got


def mark_read(dsn: str, *, uid: str, keys: Any, dismiss: bool = False) -> int:
    """Record this account's own read (or cleared) marks; a key that is not an alert key is never written."""
    uid = str(uid or "").strip()
    clean = sorted({k for k in list(keys or [])[:READ_MAX] if isinstance(k, str) and KEY_RE.fullmatch(k)})
    if not uid or not clean:
        return 0
    try:
        with contextlib.closing(_connect(dsn)) as conn:
            with conn.cursor() as cur:
                _ensure(cur, dsn)
                cur.execute(
                    "INSERT INTO asa_hub_inbox_reads (user_id, alert_key, read_at, dismissed_at) "
                    "SELECT %s, k, now(), %s FROM unnest(%s::text[]) AS k "
                    "ON CONFLICT (user_id, alert_key) DO UPDATE SET "
                    "dismissed_at = coalesce(asa_hub_inbox_reads.dismissed_at, EXCLUDED.dismissed_at)",
                    (uid, datetime.now(UTC) if dismiss else None, clean))
            conn.commit()
            _prune(conn, uid)
    except Exception:
        _forget(dsn)
        raise
    return len(clean)


def _prune(conn, uid: str) -> None:
    """Let go of this account's marks on alerts that have long left the list (PRUNE_KINDS only)."""
    try:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM asa_hub_inbox_reads WHERE user_id=%s "
                        "AND read_at < now() - make_interval(days => %s) "
                        "AND split_part(alert_key, ':', 1) = ANY(%s)", (uid, PRUNE_DAYS, list(PRUNE_KINDS)))
        conn.commit()
    except Exception as exc:  # noqa: BLE001 — the marks just written stand
        log.warning("my inbox: old read marks were not let go (%s)", type(exc).__name__)
        with contextlib.suppress(Exception):
            conn.rollback()


def handed_marks(dsn: str, uid: str) -> dict[str, Any]:
    """Blocking, read-only: this account's rows of asa_hub_inbox_reads and every asa_hub_inbox_seen row, each stamp as
    ISO text (snapshot_service._my_inbox_marks_read, the inbox_marks Python's read merges); a table not made yet holds
    none."""
    def iso(v: Any) -> Any:
        return v.isoformat() if isinstance(v, datetime) else v

    out: dict[str, Any] = {"user_id": uid, "reads": [], "seen": []}
    with contextlib.closing(_connect(dsn)) as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT to_regclass('asa_hub_inbox_reads') IS NOT NULL, "
                        "to_regclass('asa_hub_inbox_seen') IS NOT NULL")
            reads_here, seen_here = cur.fetchone() or (False, False)
            if reads_here and uid:
                cur.execute("SELECT user_id, alert_key, read_at, dismissed_at FROM asa_hub_inbox_reads "
                            "WHERE user_id = %s", (uid,))
                out["reads"] = [{"user_id": u, "alert_key": k, "read_at": iso(r), "dismissed_at": iso(d)}
                                for u, k, r, d in cur.fetchall()]
            if seen_here:
                cur.execute("SELECT kind, key, first_seen FROM asa_hub_inbox_seen")
                out["seen"] = [{"kind": k, "key": key, "first_seen": iso(f)} for k, key, f in cur.fetchall()]
        conn.commit()
    return out


class Store:
    def __init__(self, dsn: str) -> None:
        self.dsn = dsn

    def marks(self, uid: str, keys: list[str], *, ensure: bool) -> dict[str, dict[str, Any]]:
        return read_marks(self.dsn, uid, keys, ensure=ensure)

    def close(self) -> None:
        return None


class Ctx:
    """What the family sources ask of the relay's context: the access checks, the bell and test mode."""

    def __init__(self, *, access: dict[str, dict[str, Any]], notices: Callable[..., dict[str, Any]] | None,
                 held: str) -> None:
        self.access, self.notices, self.held = access or {}, notices, held

    def opens(self, app_id: str) -> bool:
        """FAIL-CLOSED: an app whose check is missing or failed is shut."""
        got = self.access.get(app_id)
        return bool(isinstance(got, dict) and got.get("open") is True)


def _run(ctx: Ctx, key: str, reader: Callable[[Ctx], tuple[dict, list[dict]]]) -> tuple[dict, list[dict]]:
    try:
        return reader(ctx)
    except Held as exc:
        return head(key, STATE_HELD, str(exc)), []
    except Closed as exc:
        return head(key, STATE_CLOSED, str(exc)), []
    except mw.NotAttributable as exc:
        return head(key, STATE_NOT_ATTRIBUTABLE, str(exc)), []
    except mw.Unreadable as exc:
        return head(key, STATE_UNREADABLE, str(exc)), []
    except Exception as exc:  # noqa: BLE001 — FAIL-CLOSED: one source that throws is said; the rest answer
        log.warning("my inbox: %s failed (%s)", key, type(exc).__name__)
        return head(key, STATE_UNREADABLE, f"it could not be read ({type(exc).__name__})"), []


def _marks_of(store: Any, subject: dict[str, Any], items: list[dict],
              readonly: bool) -> tuple[dict[str, dict[str, Any]], bool, str]:
    ours = [it["id"] for it in items if not NOTICE_KEY_RE.fullmatch(it["id"])]
    if not ours:
        return {}, True, ""
    try:
        return store.marks(str(subject.get("uid") or ""), ours, ensure=not readonly), True, ""
    except Exception as exc:  # noqa: BLE001 — every alert is said unread, and the answer says why
        log.warning("my inbox: the read marks could not be read (%s)", type(exc).__name__)
        return {}, False, f"what was read could not be read ({type(exc).__name__})"


# ── a client-role account: New staff, Company notices and the chat, nothing else ────────────────────────────────────

FAMILY_SOURCES = (("new_staff", "New staff"), ("notices", "Company notices"))
FAMILY_STAFF_APP = "staff-profiles"
FAMILY_STAFF_HREF = "/app/staff-profiles/profile"
FAMILY_APPS = (FAMILY_STAFF_APP,)
FAMILY_KEY_RE = re.compile(r"^fam:[a-z]{1,12}:[A-Za-z0-9._-]{1,120}$")
FAMILY_STAFF_KEY_RE = re.compile(r"[a-z0-9]{3,80}")
HOUSE_CODE_RE = re.compile(r"[A-Z]{2,4}\d{3,6}")
FAMILY_HOUSES_MAX = 12
FAMILY_STATES = {"ok": STATE_READY, "empty": STATE_READY, "not_applicable": STATE_CLOSED,
                 "unreadable": STATE_UNREADABLE}
FAMILY_VIEWERS = frozenset({"client", "guardian"})
FAMILY_UNLINKED = "This account is not linked to a client yet, so nothing on a client's record is listed."
FAMILY_STAFF_NOTE = "The staff who serve the house, whose first day there is in the last two weeks."
FAMILY_NOTICES_NOTE = "Who takes a shift at the house, from the company's notices."
FAMILY_NO_HOUSES = "the backend named no house for this account, so no notice can be tied to one"


def family_houses(family: dict[str, Any]) -> tuple[list[str], str]:
    """(the houses the backend names for the account, at most FAMILY_HOUSES_MAX codes; why none, or why they may be
    fewer)."""
    raw = family.get("house_codes")
    if not isinstance(raw, list):
        return [], FAMILY_NO_HOUSES
    codes = sorted({c for c in (str(x).strip().upper() for x in raw if isinstance(x, str))
                    if HOUSE_CODE_RE.fullmatch(c)})
    why = _text(family.get("houses_why"), 300)
    if not codes:
        return [], why or FAMILY_NO_HOUSES
    return codes[:FAMILY_HOUSES_MAX], why


def family_staff_head(family: dict[str, Any] | None, why: str = "") -> dict[str, Any]:
    """New staff as the backend said it, in this module's words: a head it did not send is unreadable."""
    if family is None:
        return head("new_staff", STATE_UNREADABLE, why or "the backend did not answer")
    if family.get("linked") is not True:
        return head("new_staff", STATE_NOT_ATTRIBUTABLE, _text(family.get("why"), 300) or FAMILY_UNLINKED)
    h = next((x for x in family.get("heads") or [] if isinstance(x, dict) and x.get("key") == "new_staff"), None)
    state = FAMILY_STATES.get(str(h.get("state") or ""), STATE_UNREADABLE) if h else STATE_UNREADABLE
    if state != STATE_READY:
        said = (_text(h.get("why"), 300) or "it could not be read") if h else "the backend did not answer for it"
        return head("new_staff", state, said)
    return head("new_staff", STATE_READY, count=0, note=FAMILY_STAFF_NOTE, gap=_text(h.get("gap"), 300),
                as_of=mw.when_of(family.get("read_at")) if family.get("read_at") else "")


def family_items(family: dict[str, Any] | None, ctx: Ctx) -> list[dict[str, Any]]:
    """The backend's new staff, field by field: a `fam:staff:` key, a readable day and its title."""
    if family is None or family.get("linked") is not True:
        return []
    staff_open = ctx.opens(FAMILY_STAFF_APP)
    out = []
    for raw in family.get("items") or []:
        if not isinstance(raw, dict) or raw.get("type") != "new_staff":
            continue
        key = str(raw.get("id") or "")
        if not key.startswith("fam:staff:") or not FAMILY_KEY_RE.fullmatch(key) or mw.day_of(raw.get("at")) is None:
            continue
        staff = str(raw.get("staff") or "")
        link = ({"href": f"{FAMILY_STAFF_HREF}?staff={staff}", "label": "Open in Staff"}
                if staff_open and FAMILY_STAFF_KEY_RE.fullmatch(staff) else None)
        out.append(item(key, "new_staff", title=_text(raw.get("title"), 200) or "New staff", at=raw.get("at"),
                        link=link))
    return out


def family_notices(ctx: Ctx, family: dict[str, Any] | None, why: str = "") -> tuple[dict, list[dict]]:
    """The company notices at the account's own houses (`ctx.notices(houses)`); held while test mode is on."""
    if family is None:
        raise Unreadable(why or "the backend did not answer, so no house is known")
    if family.get("linked") is not True:
        raise NotAttributable(_text(family.get("why"), 300) or FAMILY_UNLINKED)
    houses, houses_why = family_houses(family)
    if not houses:
        raise Unreadable(houses_why)
    if ctx.held:
        raise Held(HELD_WHY)
    if ctx.notices is None:
        raise Unreadable("the notices lane is not on this server")
    try:
        got = ctx.notices(houses)
    except Exception as exc:  # noqa: BLE001
        raise Unreadable(f"the notices could not be read ({type(exc).__name__})") from exc
    if not isinstance(got, dict):
        raise Unreadable("the notices lane gave no answer")
    if got.get("held"):
        raise Held(HELD_WHY)
    items = []
    for n in got.get("notices") or []:
        try:
            nid = int(n.get("id"))
        except (TypeError, ValueError, AttributeError):
            continue
        items.append(item(f"srv-{nid}", "notices", title=str(n.get("title") or "Company notice"),
                          body=str(n.get("body") or ""), at=n.get("published_at") or n.get("at"),
                          read=bool(n.get("read"))))
    gap = " ".join(g for g in (houses_why, "Only the newest notices were judged." if got.get("truncated") else "")
                   if g)
    return head("notices", STATE_READY, count=len(items), note=FAMILY_NOTICES_NOTE, gap=gap), items


def family_board(dsn: str, *, subject: dict[str, Any], family: dict[str, Any] | None,
                 access: dict[str, dict[str, Any]], family_why: str = "",
                 notices: Callable[[list[str]], dict[str, Any]] | None = None, held: str = "",
                 readonly: bool = False, readonly_why: str = "", store: Any = None,
                 now: datetime | None = None) -> dict[str, Any]:
    """A client-role account's whole answer, in board()'s shape: New staff (`family`, the myFamily read's data, or
    None when it did not answer) and the company notices at its houses."""
    now = now or datetime.now(UTC)
    if family is not None and not isinstance(family, dict):
        family = {}
    own_store = store is None
    store = store if store is not None else Store(dsn)
    try:
        ctx = Ctx(access=access, notices=notices, held=held)
        heads = [family_staff_head(family, family_why)]
        items = family_items(family, ctx)
        h, got = _run(ctx, "notices", lambda c: family_notices(c, family, family_why))
        heads.append(h)
        items.extend(got)
        mi._unique(items)  # noqa: SLF001
        marks, marks_ok, marks_why = _marks_of(store, subject, items, readonly)
    finally:
        if own_store:
            store.close()
    kept, unread, capped = mi._settled(heads, items, marks)  # noqa: SLF001
    known = family or {}
    viewer = str(known.get("viewer") or "")
    ward = known.get("ward") if isinstance(known.get("ward"), dict) else {}
    # None: the backend did not answer, so whether the account is linked is not known
    linked = (known.get("linked") is True) if family is not None else None
    unlinked = (_text(known.get("why"), 300) or FAMILY_UNLINKED) if linked is False else ""
    return {"family": True,
            "viewer": viewer if viewer in FAMILY_VIEWERS else "client",
            "ward": {"name": _text(ward.get("name"), 120)},
            "linked": linked,
            "why": unlinked,
            "subject": {"name": _text(ward.get("name"), 120), "key_why": unlinked},
            "heads": heads,
            "items": kept,
            "unread": unread,
            "capped": capped,
            "marks": {"readable": marks_ok, "why": marks_why, "kept": not readonly,
                      "kept_why": "" if not readonly else (readonly_why or KEPT_WHY_ACTING)},
            "read_at": now.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")}
