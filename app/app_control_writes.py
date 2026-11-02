"""App Control's saves on Python behind its switch (`app-control`), Apps Script no longer asked: which badges reach an
app (Prefs.gs appBadgeAccessSet), which places it is installed in (appTenantAccessSet), who reaches a settings section
(configBadgeAccessSet), the whole matrix applied in one pass (appAccessSetBulk) and the accounts App Control is shared
with (AppControlDelegates.gs appControlDelegatesSet). Where the session stands — the place, the visit, the default deny
away from home — is settled before any door (app/envelope.py); then each gate as Apps Script asks it.

A changed or new row is kept in app.edits under its key (cols:<key header>) and carried to the sheet at once by a book
op in the same transaction (app/book_ops.py): the changed cells, or the tab rewritten whole (`mirror`) when a row is
added, a key stands on two rows (the first written, the others emptied, so the gate reads the rule written) or a row
has no key. A rule taken away leaves its row cleared, which every reader of the matrix takes for no rule. The relay
hands what a save opened to the release announcement (app/app_release.py) and marks who reads what."""
from __future__ import annotations

import re
from typing import Any, Callable

import alerts_config as AC
import alerts_config_writes as ACW
import app_control as APC
import book_ops as BO
import door_gate as DG
import envelope as EV
import gsjs
import house_tables as HT
import hubdb
import locations as L
import scope as sc
import writes as W
from scope import Defer
from writes import Decision

# Prefs.gs APP_BADGE_HEADER, APP_TENANT_HEADER, CONFIG_BADGE_HEADER: the key, the rule, the stamps
APP_BADGE_HEADER = ("app_id", "badges", "updated_at", "updated_by")
APP_TENANT_HEADER = ("app_id", "tenants", "updated_at", "updated_by")
CONFIG_BADGE_HEADER = ("section_id", "badges", "updated_at", "updated_by")
BUSY = "Another update is in progress — try again."
SHARED_TO_VIEW = "App Control is shared with you to view. Changing it is the master's to allow. Nothing was saved."
ADMIN_ONLY = {"status": 403, "message": "This action is for admin."}
# a book op's subject: one access tab
SUBJECT = "app-control:"
_INDEX = re.compile(r"^(0|[1-9][0-9]*)$")

s_ = gsjs.str_


def okeys(v: Any) -> list[str]:
    """(v && typeof v === 'object') ? Object.keys(v) : [] — an object's own keys, array-index keys first ascending,
    an array's indices."""
    if isinstance(v, list):
        return [str(i) for i in range(len(v))]
    if not isinstance(v, dict):
        return []
    keys = [str(k) for k in v]
    index = sorted((k for k in keys if _INDEX.match(k) and int(k) < 2 ** 32 - 1), key=int)
    taken = set(index)
    return index + [k for k in keys if k not in taken]


def _member(lane: Any, key: str) -> Any:
    """lane[key] for an object's key or an array's index."""
    if isinstance(lane, list):
        return lane[int(key)]
    return lane.get(key) if isinstance(lane, dict) else None


# ---- where the session stands (Main.gs doPost, app/envelope.py) ---------------------------------------------------

def _policy(action: str, payload: dict, user: dict[str, Any]) -> dict[str, Any] | None:
    """hubPolicyGate_ with the declaration Prefs.gs and AppControlDelegates.gs make: the roles, then the parameters."""
    pol = GS_POLICY.get(action) or {}
    roles = tuple(pol.get("roles") or ())
    if roles and not user.get("is_service") and gsjs.js_str(user.get("role")) not in roles:
        return {"status": 403, "message": "This action is for " + " or ".join(roles) + "."}
    for key, rule in (pol.get("params") or {}).items():
        val = payload.get(key)
        missing = val is None or (isinstance(val, str) and val == "")
        if rule.get("required") and missing:
            return {"status": 400, "message": f"Missing required parameter: {key}."}
        if not missing and rule.get("type") and DG._type_of(val) != rule["type"]:
            return {"status": 400, "message": f"{key} must be {rule['type']}, got {DG._type_of(val)}."}
    return None


def standing(sess: L.Session, action: str, payload: dict) -> tuple[dict[str, Any], bool, dict[str, Any] | None]:
    """doPost before the door: the place, the visit and the default deny away from home were settled before it
    (envelope.settle), so the session is whom the door answers for; then HUB_POLICY. (who acts, away from home, the
    refusal)"""
    user = sess.user or {}
    return user, bool(EV.place_of(user)), _policy(action, payload, user)


# ---- who may write (Prefs.gs, AppControlDelegates.gs) ---------------------------------------------------------------

def may_edit(user: dict[str, Any] | None) -> bool:
    """appAccessMayEdit_ (FAIL-CLOSED): which apps a badge or a tenant reaches is the master's pen alone."""
    return sc.is_real_master(user)


def matrix_may_edit(reads: L.Reads, user: dict[str, Any] | None) -> bool:
    """accessMatrixMayEdit_: an admin at home — the master, or one wearing a badge the settings-sections matrix's
    `access` row names; no row written, the master alone."""
    if not user or user.get("is_service") or user.get("visiting_member"):
        return False
    if s_(user.get("role")) != "admin":
        return False
    if sc.is_real_master(user):
        return True
    worn = sc.badges_worn(user.get("types"), user.get("role"))
    for r in APC.tab_rows(reads, APC.CONFIG_BADGE_TAB):
        if s_(r.get("sectionid")) != "access":
            continue
        # a rule exists: it names somebody here, or nobody
        return any(b in worn for b in sc.types_from_raw(r.get("badges")))
    return False


def admin_door(reads: L.Reads, user: dict[str, Any] | None) -> dict[str, Any] | None:
    """hubAcAdminDoor_: an admin, or an account App Control is shared with; everybody else the declared 403."""
    if not user or user.get("is_service"):
        return None
    if gsjs.or_text(user.get("role")) == "admin":
        return None
    if APC.delegate_for(reads, user):
        return None
    return dict(ADMIN_ONLY)


def write_refusal(reads: L.Reads, user: dict[str, Any] | None, rule_ids: Any, away: bool) -> dict[str, Any] | None:
    """hubAcDelegateWriteRefusal_: why this session may not write these matrix rows; None when it may, as a delegate
    at home (hubAcDelegateAtHome_)."""
    g = None if away else APC.delegate_for(reads, user)
    if not g:
        return dict(DG.UNKNOWN)
    if not g["may_change"]:
        return {"status": 403, "message": SHARED_TO_VIEW}
    ids = rule_ids if isinstance(rule_ids, list) else []
    outside = [gsjs.or_blank(i)[:80] or "(no app named)" for i in ids if not APC.delegate_covers(g, i)]
    if not ids or outside:
        return {"status": 403, "message": "Outside the apps the master shared with you: "
                + (", ".join(outside) or "no app named") + ". Nothing was saved."}
    return None


def bulk_refusal(reads: L.Reads, payload: dict, user: dict[str, Any] | None, away: bool) -> dict[str, Any] | None:
    """hubAcDelegateBulkRefusal_: a delegate's Apply writes badge rows of its own apps and nothing else."""
    g = None if away else APC.delegate_for(reads, user)
    if not g:
        return dict(DG.UNKNOWN)
    if g["may_change"] and (okeys(payload.get("tenants")) or okeys(payload.get("sections"))):
        return {"status": 403, "message": "Which places an app belongs to and who reaches a settings section are the "
                                          "master's alone. Nothing was saved."}
    return write_refusal(reads, user, okeys(payload.get("rules")), away)


def touches_apps(payload: dict) -> bool:
    """appAccessBulkTouchesApps_: a badge or a tenant lane in the payload."""
    return any(okeys(payload.get(k)) for k in ("rules", "tenants"))


def master_only_cleared(lane: Any) -> Any:
    """appAccessMasterOnlyCleared_: an object lane with every master-only app's list emptied; anything else as sent."""
    if not isinstance(lane, dict):
        return lane
    return {k: ([] if APC.master_only(k) else v) for k, v in lane.items()}


# ---- one access tab, as the write leaves it ------------------------------------------------------------------------

def _text(v: Any) -> str:
    """str_ of the cell getValues() hands back."""
    return s_(hubdb.typed(v, "hub"))


class Lane:
    """One access tab as the copy holds it, Python's kept edits laid: every line in sheet order (cells by the copy's
    headers, a column the sheet lacks after them, as ensureHeader_ adds it) and where each key stands."""

    def __init__(self, reads: L.Reads, tab: str, header: tuple[str, ...]) -> None:
        # the tab as it stands: its own table once kept there
        res = HT.where(reads, tab) if HT.tabled(tab) else W.tab_of(reads, tab)
        if res.ref is None:
            raise Defer(f"the {tab} tab is not in the copy yet")
        self.reads, self.tab = reads, tab
        self.sid, self.name = W.where_of(res)
        self.header = header
        self.key, self.value = header[0], header[1]
        found = [W.header_of(res.ref, h, norm=True) for h in header]
        self.heads = {g: (h or g) for g, h in zip(header, found)}
        self.match = W.COLS + self.heads[self.key]
        own = [gsjs.trim(gsjs.js_str(h)) for h in res.ref.headers]
        self.cols = own + [g for g, h in zip(header, found) if not h]
        self.widened = len(self.cols) > len(own)
        self.lines: list[dict[str, str]] = []
        self.rows: list[dict[str, str]] = []
        self.at: dict[str, list[int]] = {}
        for _rn, raw in reads.db.rows(res.ref):
            line = {c: _text(raw.get(h)) for c, h in zip(own, res.ref.headers)}
            cells = {g: line.get(self.heads[g], "") for g in header}
            if cells[self.key]:
                self.at.setdefault(cells[self.key], []).append(len(self.lines))
                self.rows.append(cells)
            self.lines.append(line)

    def _cells(self, cells: dict[str, str]) -> dict[str, str]:
        return {self.heads[g]: v for g, v in cells.items()}

    def _blank(self) -> dict[str, str]:
        return {c: "" for c in self.cols}

    def change(self, rules: dict[str, str], subject: str, now: str, by: str, collapse: bool = False
               ) -> tuple[list[dict], list[dict]]:
        """Each key's rule as the save leaves it ('' takes it away, its row left cleared and stamped), on the first
        row the key names, the others emptied; a key no row holds appended, a key left blank on a row of its own.
        `collapse` (appAccessRewrite_): every key on one row, the first's place and the last's cells, and a row with
        no key emptied. (the kept records, the book ops: each changed row's cells, or the tab rewritten whole)"""
        lines = [dict(line) for line in self.lines]
        recs: list[dict] = []
        cells_ops: list[dict] = []
        whole = self.widened
        if collapse:
            for key, at in self.at.items():
                if len(at) < 2:
                    continue
                first, last = lines[at[0]], lines[at[-1]]
                if key not in rules:
                    cells = {h: last.get(h, "") for h in self.cols if h != self.heads[self.key]}
                    changed = {h: v for h, v in cells.items() if v != first.get(h, "")}
                    if changed:
                        recs.append(W.kept_record(self.sid, self.name, "edit", self.match, key, subject, changed,
                                                  before={h: first.get(h, "") for h in changed}))
                    first.update(cells)
                for i in at[1:]:
                    lines[i] = self._blank()
                whole = True
            for i, line in enumerate(lines):
                if not line.get(self.heads[self.key]) and any(line.values()):
                    lines[i] = self._blank()
                    whole = True
        for key, value in rules.items():
            stamp = {self.value: value, self.header[2]: now, self.header[3]: by}
            at = self.at.get(key) or []
            if not key or not at:
                if not value:
                    continue
                row = self._cells({self.key: key, **stamp})
                if key:
                    recs.append(W.kept_record(self.sid, self.name, "append", self.match, key, subject, row))
                lines.append({c: row.get(c, "") for c in self.cols})
                whole = True
                continue
            for i in at[1:]:
                # the gate reads the last row a key names: the rule written is the only one left
                lines[i] = self._blank()
                whole = True
            line = lines[at[0]]
            was = {g: line.get(self.heads[g], "") for g in self.header}
            if not value and not was[self.value]:
                continue
            changed = self._cells({g: v for g, v in stamp.items() if v != was[g]})
            if not changed:
                continue
            recs.append(W.kept_record(self.sid, self.name, "edit", self.match, key, subject, changed,
                                      before={h: line.get(h, "") for h in changed}))
            line.update(changed)
            cells_ops.append({"op": "cells", "sheet_id": self.sid, "tab": self.name,
                              "spec": {"match": self.heads[self.key], "key": key, "cells": changed, "which": "first"}})
        if not whole:
            return recs, cells_ops
        rewrite_op = {"op": "mirror", "sheet_id": self.sid, "tab": self.name,
                      "spec": {"resource": self.tab, "header": self.cols,
                               "rows": [[line.get(c, "") for c in self.cols] for line in lines]}}
        return recs, [rewrite_op]


def rewrite(rows: list[dict[str, str]], key: str) -> list[dict[str, str]]:
    """appAccessRewrite_: one row per id, the first's place and the last's cells; a row with no id goes."""
    out: list[dict[str, str]] = []
    at: dict[str, int] = {}
    for r in rows:
        i = r[key]
        if not i:
            continue
        if i in at:
            out[at[i]] = r
            continue
        at[i] = len(out)
        out.append(r)
    return out


def bulk_lane(lane: Lane, sent: Any, values: Callable[[Any], str], now: str, by: str
              ) -> tuple[dict[str, str], int, dict[str, str]]:
    """appAccessSetBulk's pass over one tab: every row the payload does not name kept verbatim, each named one written
    again (an empty list: no rule) — (what each id now holds, the rules written, each changed id's rule)."""
    keys = okeys(sent)
    named = set(keys)
    echo: dict[str, str] = {}
    keep: list[dict[str, str]] = []
    for r in lane.rows:
        if r[lane.key] in named:
            continue
        keep.append(dict(r))
        echo[r[lane.key]] = r[lane.value]
    wrote = 0
    for k in keys:
        v = values(_member(sent, k))
        if not v:
            echo[k] = ""
            continue
        keep.append({lane.key: s_(k)[:80], lane.value: v, lane.header[2]: now, lane.header[3]: by, "_sent": "1"})
        echo[k] = v
        wrote += 1
    final = rewrite(keep, lane.key)
    held = {r[lane.key] for r in final}
    # a row the payload wrote again is written; one it took away is cleared; the rest stand as they are
    rules = {r[lane.key]: "" for r in lane.rows if r[lane.key] not in held}
    rules.update({r[lane.key]: r[lane.value] for r in final if r.get("_sent")})
    return echo, wrote, rules


def _badges(v: Any) -> str:
    return ", ".join(sc.types_from_raw(v))


def _tenant_list(v: Any) -> str:
    """(tenants[id] || []).map(str_ sliced to 80).filter(String).join(', '); anything but a list throws there too."""
    if gsjs.falsy(v):
        return ""
    if not isinstance(v, list):
        raise TypeError("a tenant lane's value is not a list")
    return ", ".join(t for t in (s_(x)[:80] for x in v) if t)


def _kept(answer: dict[str, Any], lanes: list[tuple[Lane, tuple[list[dict], list[dict]]]], by: str,
          action: str) -> Decision:
    """The save final: its rows kept in app.edits, and each tab's book ops queued in this write's transaction, so the
    sheet holds it at once (asa-hub-sheet-sync carries them on their notice; the cells follow at its cycle)."""
    recs: list[dict] = []
    for lane, (kept, ops) in lanes:
        recs += kept
        if HT.tabled(lane.tab):
            # its own table: the rows laid there by their kept records (writes.into_tables), a whole rewrite done there
            for op in ops:
                if op.get("op") == "mirror":
                    HT.rewrite(lane.reads, lane.tab, [dict(zip(op["spec"]["header"], r)) for r in op["spec"]["rows"]],
                               by)
            continue
        BO.queue(ops, SUBJECT + lane.tab, by, action)
    return W.final(answer, recs, lanes[0][0].tab if lanes else APC.APP_BADGE_TAB)


# ---- the doors -----------------------------------------------------------------------------------------------------

def badge_set(sess: L.Session, payload: dict) -> Decision:
    """appBadgeAccessSet: the master's matrix, one app's row — or, for an account App Control is shared with and may
    change, a row of its own apps."""
    p = payload if isinstance(payload, dict) else {}
    user, away, refused = standing(sess, "appBadgeAccessSet", p)
    if refused:
        return Decision(refused)
    reads = sess.reads
    door = admin_door(reads, user)
    if door:
        return Decision(door)
    app_id = s_(p.get("app_id"))[:80]
    delegated = not may_edit(user)
    if delegated:
        refusal = write_refusal(reads, user, [app_id], away)
        if refusal:
            return Decision(refusal)
    badges = sc.types_from_raw(p.get("badges"))
    if badges and APC.master_only(app_id):
        return W.refuse(400, "This app is the master's alone — no badge opens it, so it takes no badge rule.")
    now, by = W.now_iso(reads), s_(user.get("email"))
    lane = Lane(reads, APC.APP_BADGE_TAB, APP_BADGE_HEADER)
    got = lane.change({app_id: ", ".join(badges)}, APC.APP_BADGE_TAB, now, by)
    AC.log_line(user, "app_badge_access_set", app_id + " → " + (", ".join(badges) if badges else "open to everyone")
                + (" (App Control access)" if delegated else ""))
    return _kept({"status": 200, "data": {"app_id": app_id, "badges": badges}}, [(lane, got)], by,
                 "appBadgeAccessSet")


def tenant_set(sess: L.Session, payload: dict) -> Decision:
    """appTenantAccessSet: the places one app is installed in — no row, every place; the master's alone."""
    p = payload if isinstance(payload, dict) else {}
    user, _away, refused = standing(sess, "appTenantAccessSet", p)
    if refused:
        return Decision(refused)
    reads = sess.reads
    if not may_edit(user):
        return Decision(dict(DG.UNKNOWN))
    app_id = s_(p.get("app_id"))[:80]
    if not app_id:
        return W.refuse(400, "app_id: which app.")
    tenants: list[str] = []
    for x in p.get("tenants") if isinstance(p.get("tenants"), list) else []:
        t = s_(x)[:80]
        if t and t not in tenants:
            tenants.append(t)
    if tenants and APC.master_only(app_id):
        return W.refuse(400, "This app is the master's alone in every place — it takes no tenant rule.")
    now, by = W.now_iso(reads), s_(user.get("email"))
    lane = Lane(reads, APC.APP_TENANT_TAB, APP_TENANT_HEADER)
    got = lane.change({app_id: ", ".join(tenants)}, APC.APP_TENANT_TAB, now, by)
    AC.log_line(user, "app_tenant_access_set", app_id + " → " + (", ".join(tenants) if tenants else "every tenant"))
    return _kept({"status": 200, "data": {"app_id": app_id, "tenants": tenants}}, [(lane, got)], by,
                 "appTenantAccessSet")


def config_set(sess: L.Session, payload: dict) -> Decision:
    """configBadgeAccessSet: who reaches one settings section — no row, the section's own gate."""
    p = payload if isinstance(payload, dict) else {}
    user, _away, refused = standing(sess, "configBadgeAccessSet", p)
    if refused:
        return Decision(refused)
    reads = sess.reads
    if not matrix_may_edit(reads, user):
        return Decision(dict(DG.UNKNOWN))
    section_id = s_(p.get("section_id"))[:80]
    if not section_id:
        return W.refuse(400, "section_id: which settings section.")
    badges = sc.types_from_raw(p.get("badges"))
    now, by = W.now_iso(reads), s_(user.get("email"))
    lane = Lane(reads, APC.CONFIG_BADGE_TAB, CONFIG_BADGE_HEADER)
    got = lane.change({section_id: ", ".join(badges)}, APC.CONFIG_BADGE_TAB, now, by)
    AC.log_line(user, "config_badge_access_set", section_id + " → " + (", ".join(badges) if badges else "its own gate"))
    return _kept({"status": 200, "data": {"section_id": section_id, "badges": badges}}, [(lane, got)], by,
                 "configBadgeAccessSet")


def bulk_set(sess: L.Session, payload: dict) -> Decision:
    """appAccessSetBulk: the whole matrix in one pass — the badge, tenant and settings-section lanes, each untouched
    when the payload names none of it; an account App Control is shared with writes badge rows of its own apps."""
    p = payload if isinstance(payload, dict) else {}
    user, away, refused = standing(sess, "appAccessSetBulk", p)
    if refused:
        return Decision(refused)
    reads = sess.reads
    door = admin_door(reads, user)
    if door:
        return Decision(door)
    delegated = False
    if touches_apps(p) and not may_edit(user):
        refusal = bulk_refusal(reads, p, user, away)
        if refusal:
            return Decision(refusal)
        delegated = True
    if not delegated and not matrix_may_edit(reads, user):
        return Decision(dict(DG.UNKNOWN))
    rules = master_only_cleared({} if gsjs.falsy(p.get("rules")) else p.get("rules"))
    tenants = master_only_cleared({} if gsjs.falsy(p.get("tenants")) else p.get("tenants"))
    sections = {} if gsjs.falsy(p.get("sections")) else p.get("sections")
    now, by = W.now_iso(reads), s_(user.get("email"))
    lanes: list[tuple[Lane, tuple[list[dict], list[dict]]]] = []
    out: dict[str, dict[str, str]] = {"badges": {}, "tenants": {}, "sections": {}}
    wrote = {"badges": 0, "tenants": 0, "sections": 0}
    for name, sent, tab, header, values in (
            ("badges", rules, APC.APP_BADGE_TAB, APP_BADGE_HEADER, _badges),
            ("tenants", tenants, APC.APP_TENANT_TAB, APP_TENANT_HEADER, _tenant_list),
            ("sections", sections, APC.CONFIG_BADGE_TAB, CONFIG_BADGE_HEADER, _badges)):
        # an empty key set is untouched, and untouched is free
        if not okeys(sent):
            continue
        lane = Lane(reads, tab, header)
        try:
            out[name], wrote[name], changed = bulk_lane(lane, sent, values, now, by)
        except TypeError as exc:
            # doPost's catch: the lock released, nothing written
            return W.refuse(500, "Internal error: " + str(exc))
        lanes.append((lane, lane.change(changed, tab, now, by, collapse=True)))
    AC.log_line(user, "app_access_set_bulk", f"{wrote['badges']} badge rule(s), {wrote['tenants']} tenant rule(s), "
                f"{wrote['sections']} section rule(s) in one pass" + (" (App Control access)" if delegated else ""))
    # a delegate's echo holds its own apps' rows alone: the rest of the tab is not its to read
    grant = APC.delegate_for(reads, user) if delegated else None
    badges = {k: v for k, v in out["badges"].items() if APC.delegate_covers(grant, k)} if delegated else out["badges"]
    answer = {"status": 200, "data": {"badges": badges, "tenants": {} if delegated else out["tenants"],
                                      "sections": {} if delegated else out["sections"], "wrote": wrote}}
    return _kept(answer, lanes, by, "appAccessSetBulk")


def delegates_set(sess: L.Session, payload: dict) -> Decision:
    """appControlDelegatesSet: the master saves the whole list of accounts App Control is shared with — each an
    employee, never the master, with at least one whole app — kept as the config's key through hiringAlertsSet."""
    p = payload if isinstance(payload, dict) else {}
    user, _away, refused = standing(sess, "appControlDelegatesSet", p)
    if refused:
        return Decision(refused)
    reads = sess.reads
    if not may_edit(user):
        return Decision(dict(DG.UNKNOWN))
    sent = p.get("delegates")
    if not isinstance(sent, list):
        return W.refuse(400, "delegates: the whole list, one entry per person.")
    if len(sent) > APC.DELEGATE_MAX:
        return W.refuse(400, f"At most {APC.DELEGATE_MAX} people may be on the list.")
    by_id: dict[str, dict] = {}
    for u in reads.users():
        uid = s_(u.get("userid"))
        if uid:
            by_id[uid] = u
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in sent:
        d = item if isinstance(item, dict) else {}
        i = s_(d.get("id"))[:80]
        if not i:
            return W.refuse(400, "Every entry names an account. Nothing was saved.")
        if i in seen:
            return W.refuse(400, "The same account is on the list twice. Nothing was saved.")
        seen.add(i)
        row = by_id.get(i)
        if row is None:
            return W.refuse(400, 'No account "' + i + '". Nothing was saved.')
        name = s_(row.get("displayname")) or s_(row.get("email")) or i
        if sc.is_master_email(s_(row.get("email"))):
            return W.refuse(400, "The master account holds App Control whole; it is never put on this list. "
                                 "Nothing was saved.")
        role = (s_(row.get("role")) or "staff").lower()
        if role not in APC.DELEGATE_ROLES:
            return W.refuse(400, "App Control is shared with employees only (admin, manager or staff); " + name
                            + " is " + role + ". Nothing was saved.")
        raw_apps = d.get("apps") if isinstance(d.get("apps"), list) else []
        for a in raw_apps:
            aid = s_(a)
            if APC.master_only(aid):
                return W.refuse(400, "App Control itself is the master's alone and is never shared. Nothing was saved.")
            if "." in aid:
                return W.refuse(400, "An app is shared whole, never one control of it (" + aid[:80]
                                + "). Nothing was saved.")
        apps = APC.delegate_apps(raw_apps)
        if not apps:
            return W.refuse(400, "Choose at least one app for " + name + ", or take them off the list. "
                                 "Nothing was saved.")
        out.append({"id": i, "apps": apps, "may_change": d.get("may_change") is True})
    saved = ACW.hiring_alerts_set(L.Session(reads, user), {"values": {APC.DELEGATES_KEY: W.json_text(out) if out
                                                                      else ""}})
    if not saved.answer or saved.answer.get("status") != 200:
        return saved if saved.answer else W.refuse(500, "The config door gave no answer.")
    AC.log_line(user, "app_control_access_set", f"{len(out)} account(s) on the list")
    return Decision({"status": 200, "data": {"delegates": out}}, edits=saved.edits, edition=saved.edition,
                    subject=saved.subject)


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {
    "appBadgeAccessSet": badge_set, "appTenantAccessSet": tenant_set, "configBadgeAccessSet": config_set,
    "appAccessSetBulk": bulk_set, "appControlDelegatesSet": delegates_set}
# HUB_POLICY as Prefs.gs and AppControlDelegates.gs declare it, asked after the place and the visit, as doPost asks it
GS_POLICY: dict[str, dict[str, Any]] = {
    "appBadgeAccessSet": {"params": {"app_id": {"required": True, "type": "string"}}},
    "appTenantAccessSet": {"roles": ("admin",), "params": {"app_id": {"required": True, "type": "string"}}},
    "configBadgeAccessSet": {"roles": ("admin",), "params": {"section_id": {"required": True, "type": "string"}}},
    "appAccessSetBulk": {},
    "appControlDelegatesSet": {"roles": ("admin",), "params": {"delegates": {"required": True, "type": "array"}}}}
# main.policy_gate asks nothing: each door asks its declaration itself (standing)
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
# every door reads where the session stands from envelope.place_of, never from the account's home
PLACE_SAFE = frozenset(ACTIONS)
# LockService's own sentence when its lock is not had
BUSY_OF: dict[str, dict[str, Any]] = {a: {"status": 503, "message": BUSY} for a in ACTIONS}


class Store(W.Store):
    """app.app_control_writes and app.app_control_receipts; the rows themselves kept in app.edits, their carriage to
    the sheet app.book_ops'."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="app_control", label="App Control")

    def settle(self, write_id: str, state: str, why: str = "", fields: list[str] | None = None) -> bool:
        done = super().settle(write_id, state, why, fields)
        if state == "void" and done:
            try:
                with self.conn().transaction():
                    self.conn().execute(f"update {BO.table()} set state = 'cancelled', done_at = now(),"
                                        " why = 'its write was void' where write_id = %s and state = 'pending'",
                                        (write_id,))
            except Exception as exc:  # noqa: BLE001 - said, never raised into the relay's settle
                W.log.warning("app control: the void of %s left its book ops queued (%s)", write_id[:40],
                              type(exc).__name__)
        return done
