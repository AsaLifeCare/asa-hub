"""Settings' platform configuration saved off asa-hub-db (AlertsConfig.gs hiringAlertsSet): each edited cell kept in
app.edits as the runtime book's newest fact, in Settings › Editions' own shape (editions.config_facts) — a key the
config holds gets its value, a key it does not is appended with its note — final, carried to the depot's Facts by the
Hub's sync. My Work's display keys are the master's alone, a *_badges key whoever the access rule names, and the whole
result is validated as test mode reads it."""
from __future__ import annotations

import json
import re
import uuid
from typing import Any, Callable

import alerts_config as AC
import editions
import gsjs
import house_tables as HT
import hubdb
import locations as L
import resource_rows as RR
import smart_comms_desk as SCD
import smart_comms_writes as SW
import writes as W
from scope import Defer
from writes import Decision

EVIDENCE = "asa-hub-app hiringAlertsSet "
# hiringLegacyWrite_'s names for a fact of the dissolved tab; the value's are editions.CONFIG_FACT_KEY / CONFIG_SOURCE
FACT_PREFIX = "legacy." + AC.CONFIG_TAB + "."
SOURCE_PREFIX = "dissolution:" + AC.CONFIG_TAB + "."
# hiringLegacyHeader_: the tab's raw header, captured into the depot at dissolution time
HEADER_SOURCE = "schema:" + AC.CONFIG_TAB + ".header"
_INDEX = re.compile(r"^(0|[1-9][0-9]*)$")
TEST_MODE_SAID = {True: ("TEST MODE ON — nothing leaves the platform: every message is written as a row in the mock "
                         "outbox, and the sending dial follows (record)"),
                  False: ("PRODUCTION — messages now reach their real recipients, and the sending dial follows "
                          "(send)")}
# the Desk's situations that wait for production: switched on by the same save that turns test mode off, never before
# (the operator, 2026-10-29: recon_errors_found, off since the recon was rebuilt, goes back on with production mode)
ON_WITH_PRODUCTION = ("recon_errors_found",)


def _values(payload: Any) -> dict[str, Any]:
    """(payload && payload.values) || {}: an object's own keys, an array's or a string's by index."""
    raw = payload.get("values") if isinstance(payload, dict) else None
    if isinstance(raw, dict):
        return {str(k): v for k, v in raw.items()}
    if isinstance(raw, list):
        return {str(i): v for i, v in enumerate(raw)}
    if isinstance(raw, str):
        return {str(i): ch for i, ch in enumerate(raw)}
    return {}


def _keys(values: dict[str, Any]) -> list[str]:
    """Object.keys: the array-index keys first, ascending, then the rest as written."""
    index = sorted((k for k in values if _INDEX.match(k) and int(k) < 2 ** 32 - 1), key=int)
    taken = set(index)
    return index + [k for k in values if k not in taken]


def _header(reads: L.Reads, ref: hubdb.TabRef) -> list[str]:
    """runtimeSheetHeader_'s columns as hiringLegacyWrite_ names their facts: the tab's raw header (its first schema
    fact), each column once by normKey_; a header that keys the rows and holds the value, or this save is not ours."""
    def read() -> list[str]:
        if not re.fullmatch(r"[a-z0-9_]{1,63}", ref.table):
            raise hubdb.Unreadable("the catalog names an unusable table for the depot's Facts")
        got = reads.db.query(f'select value from {reads.db.from_sql(ref)} where source = %s'  # noqa: S608
                             " order by row_number limit 1", (HEADER_SOURCE,))
        try:
            raw = json.loads(gsjs.str_(got[0][0])) if got else None
        except (ValueError, RecursionError):
            raw = None
        cols: list[str] = []
        for h in raw if isinstance(raw, list) else []:
            k = hubdb.norm_key(gsjs.js_str(h))
            if k and k not in cols:
                cols.append(k)
        if cols[:2] != ["key", "value"]:
            raise Defer("the config's raw header is not key, value in the depot's facts")
        return cols
    return reads.once("alerts_config_header", read)


def production_on(reads: L.Reads, by: str) -> list[str]:
    """The Desk's ON_WITH_PRODUCTION situations switched on (enabled → yes) inside this save's own write, each logged
    in app.resource_changes as a Desk save is; one already on, or not on the Desk, is left as it stands. The ids
    switched."""
    if not HT.tabled(SW.TAB):
        return []
    keys = SW.situation_keys(reads)
    resource = HT.resource_of(SW.TAB) or ""
    switched = []
    for sid in ON_WITH_PRODUCTION:
        got = keys.get(sid)
        if got is None or SCD.smart_on(got[1].get("enabled")):
            continue
        RR.update(reads, resource, got[0], got[1], {"enabled": "yes"}, by)
        switched.append(sid)
    return switched


def _fact(sid: str, ref: hubdb.TabRef, subject: str, col: str, value: str, now: str) -> dict[str, Any]:
    """hiringLegacyWrite_'s one fact as app.edits keeps it, the shape editions.editions_set keeps a config cell in."""
    source = SOURCE_PREFIX + col
    evidence = EVIDENCE + str(uuid.uuid4())
    cells = {"Fact Key": FACT_PREFIX + col, "Subject ID": subject, "Value": value, "Source": source,
             "Evidence": evidence, "Recorded At": now, "Recorded By": editions.RECORDED_BY}
    return W.kept_record(sid, ref.tab, "append", editions.KEY_MATCH, "\x1f".join((subject, source, evidence)),
                         subject, cells)


def hiring_alerts_set(sess: L.Session, payload: dict) -> Decision:
    """hiringAlertsSet: an admin saves edited cells — every row with the key gets its value, a key the config does not
    hold yet is appended with its note; an unknown key is refused out loud, never created. Kept in app.edits as the
    config's newest facts, final."""
    user = sess.user or {}
    if not sess.user or user.get("role") != "admin":
        return Decision(dict(AC.DENIED))
    values = _values(payload)
    keys = _keys(values)
    # WHAT MY WORK SHOWS EVERYBODY ELSE IS THE MASTER'S ALONE
    my_work = [k for k in keys if AC.my_work_key(k)]
    if my_work and not AC.my_work_master(user):
        AC.log_line(user, "hiring_alerts_refused", "my work display keys refused: " + ", ".join(my_work), 403)
        return Decision({"status": 403, "message": "What My Work and My Inbox show is set by the master account alone ("
                         + ", ".join(my_work) + "). Nothing was saved."})
    # FEATURE ACCESS IS THE ACCESS MATRIX'S
    grants = [k for k in keys if k.endswith("_badges")]
    if grants:
        try:
            may = AC.access_matrix_may_edit(sess.reads, user)
        except (hubdb.Unreadable, Defer):
            raise
        except Exception:  # noqa: BLE001 - the .gs's own catch: unreadable grants nothing
            may = False
        if not may:
            AC.log_line(user, "hiring_alerts_refused", "feature access keys refused: " + ", ".join(grants), 403)
            return Decision({"status": 403, "message": "Feature access is changed only by whoever the access rule "
                             "names (" + ", ".join(grants) + "). Nothing was saved."})
    reads = sess.reads
    AC.dissolved(reads)
    sid, ref = editions.config_facts(reads)
    known = {d["key"]: d for d in AC.catalog_rows(reads)}
    # VALIDATE THE WHOLE RESULT, NOT THE EDIT
    before = reads.config()
    nxt = dict(before)
    for k in keys:
        if k in known:
            nxt[k] = gsjs.or_blank(values[k])
    refusal = AC.test_mode_refusal(nxt, values)
    if refusal:
        AC.log_line(user, "hiring_alerts_refused", refusal, 400)
        return Decision({"status": 400, "error": refusal})
    unknown = [k for k in keys if k not in known]
    if unknown:
        return Decision({"status": 400, "message": "The configuration catalogue does not know: " + ", ".join(unknown)
                         + " - add the key to the catalogue, or wait for the platform release that carries it, "
                           "and save again."})
    cols = _header(reads, ref)
    now = W.now_iso(reads)
    recs: list[dict[str, Any]] = []
    changed = 0
    for k in keys:
        v = gsjs.or_blank(values[k])
        if k in before:
            recs.append(_fact(sid, ref, k, cols[1], v, now))
        else:
            # APPEND WITH ITS NOTE: the note is the only place that says what the cell does
            for col, cell in zip(cols, (k, v, known[k]["note"])):
                recs.append(_fact(sid, ref, k, col, cell, now))
        changed += 1
    AC.log_line(user, "hiring_alerts_set", f"{changed} key(s) updated")
    # GOING BACK TO PRODUCTION IS AN EVENT
    after = SCD.test_mode_state(nxt)
    warning = AC.shared_warning(after)
    switched: list[str] = []
    if after["on"] != SCD.test_mode_state(before)["on"]:
        AC.log_line(user, "test_mode_" + ("on" if after["on"] else "off"), TEST_MODE_SAID[after["on"]])
        if not after["on"]:
            switched = production_on(reads, W.who(user) + " (test mode off: on with production)")
            if switched:
                AC.log_line(user, "production_on", "switched on with production: " + ", ".join(switched))
    if after["on"] and warning:
        AC.log_line(user, "test_redirect_shared_line", warning)
    answer = {"status": 200, "data": {"saved": changed, "test_mode": {"on": after["on"], "shared": after["shared"]},
                                      "warning": warning, "switchedOn": switched}}
    return W.final(answer, recs, AC.CONFIG_TAB)


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {"hiringAlertsSet": hiring_alerts_set}
# HUB_POLICY: the roles each door is declared for
POLICY: dict[str, dict[str, Any]] = {"hiringAlertsSet": {"roles": ("admin",)}}


class Store(RR.Store):
    """app.alerts_config_writes and _receipts; the cells themselves kept in app.edits."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="alerts_config", label="the platform configuration")
