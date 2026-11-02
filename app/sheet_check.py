"""The daily check (asa-hub-sheet-sync): a record book read from Google once a day, or on demand for some of its tabs,
through the backup's own paced client. Every cell Postgres changed that Google has not acknowledged stays as Postgres
holds it, unless the sheet changed it too and later (the newer side wins, sheet_sync.TabMerge.newer, logged as a
conflict); every other cell someone edited in the sheet is brought in;
a row the sheet lost is lost here too unless a change to it is still owed. The read is staged, already through the
withholding rule, for asa-hub-db-sync to store as the book's copy (db/sync.py load_pulls), with the cells it hands to
the sheet and the kept edits the new copy makes redundant."""
from __future__ import annotations

import base64
import hashlib
import logging
import os
import re
import time
from dataclasses import dataclass, field
from typing import Any, Callable

import gsjs
import hubdb
import record_books as RB
import sheet_sync as SS

log = logging.getLogger("asa-hub-sheet-sync")

# server/hub_sheet_sync.py: the books no copy ever holds, whoever they are shared with
KEEP_OUT_TITLES = frozenset({"ASA Data — PsiPunchesFull", "ASA Data — MedDispenses", "ASA Data — MedPatients"})
KEEP_OUT_PROPS = ("HUB_HOUSE_PSI_PUNCHES_FULL_ID", "HUB_HOUSE_MED_DISPENSES_ID", "HUB_HOUSE_MED_PATIENTS_ID")
# the books whose copy keeps a repeated header's every column, in the sheet's order (the keeper's owned books)
OWNED_PROPS = ("CERT_SOURCE_ID",)
MISSING_MEDS_PROP = "HUB_MISSING_MEDS_SHEET_ID"
MISSING_MEDS_FALLBACK = "19Umc82evptvKj7GLG2RNdr6VhKDnX0Mp6C1paX6Gw1w"
# the Employee Database's SSN match (hub_sheet_sync._fingerprinted): the salted fingerprint beside the cell's marker
FINGERPRINT_SOURCE = "SSN#"
FINGERPRINT_KIND = "ssn9"
FINGERPRINT_COLUMN = "Hub SSNfingerprint"
# one read asks at most this many cells; a taller tab is read in windows of rows
CELLS_PER_READ = max(10000, int(os.getenv("HUB_CHECK_CELLS_PER_READ") or 300000))
# a book that could not be read is tried again this long after
RETRY_S = float(os.getenv("HUB_CHECK_RETRY_S") or 3600)

WHY_ROW_KEPT = "the row left the sheet while a change to it was owed; Postgres keeps it and writes it again"
WHY_TAB_KEPT = "the tab left the sheet while a change to it was owed; Postgres keeps it"
WHY_HAND = "edited in the sheet after the last backup; Postgres had not changed it since"
WHY_ROW_GONE = "the row left the sheet; Postgres had not changed it since"
WHY_TAB_GONE = "the tab left the sheet; Postgres had not changed it since"


def keep_out(hub: hubdb.HubDb | None, sid: str, name: str) -> bool:
    """A book no copy holds (client data the copies' readers may not hold): never read."""
    ids = {s.strip() for s in os.getenv("HUB_SHEET_SYNC_KEEP_OUT_IDS", "").split(",") if s.strip()}
    if hub is not None:
        for k in KEEP_OUT_PROPS:
            try:
                ids.add(hub.prop(k))
            except hubdb.Unreadable:
                return True
    return sid in ids or gsjs.trim(name) in KEEP_OUT_TITLES


def owned(hub: hubdb.HubDb | None, sid: str) -> bool:
    if hub is None:
        return False
    try:
        ids = {hub.prop(k) for k in OWNED_PROPS} | {hub.prop(MISSING_MEDS_PROP) or MISSING_MEDS_FALLBACK}
    except hubdb.Unreadable:
        return False
    return sid in ids


def _salt() -> str:
    salt = (os.getenv("HUB_PII_SALT") or os.getenv("HUB_APP_PROP_HUB_PII_SALT") or "").strip()
    return "" if len(salt) < 16 or salt.startswith("[withheld") else salt


def fingerprint_books() -> set[str]:
    if SS.R is None:
        return set()
    return {sid for sid, facts in getattr(SS.R, "BOOK_KEPT_FACTS", {}).items()
            if facts.get(FINGERPRINT_SOURCE) == FINGERPRINT_KIND}


def _fingerprinted(data: dict) -> None:
    """hub_sheet_sync._fingerprinted: the book's SSN# kept as a match fingerprint, never inside the marker."""
    if FINGERPRINT_SOURCE not in data or SS.R.kept_fact_kind(FINGERPRINT_SOURCE) != FINGERPRINT_KIND:
        return
    digits = re.sub(r"\D", "", str(data[FINGERPRINT_SOURCE] if data[FINGERPRINT_SOURCE] is not None else ""))
    salt = _salt()
    data[FINGERPRINT_COLUMN] = "" if len(digits) != 9 or not salt else base64.b64encode(
        hashlib.sha256((salt + ":" + digits).encode("utf-8")).digest()).decode("ascii")[:22]


def stored_rows(matrix: list[list], twins: bool) -> list[tuple[int, dict]]:
    """A tab's rows as the keeper keys them for a copy (its _parse_row): every header cell a row's text, a repeated
    name's last column winning unless the book keeps them all, a blank row left out, each through the rule."""
    if len(matrix) < 2:
        return []
    hi, header = SS.header_of(matrix)
    keys = SS.twin_keys(header) if twins else header
    out = []
    for rn, line in enumerate(matrix[hi + 1:], start=hi + 2):
        line = line or []
        data = {h: (str(line[i]) if i < len(line) and line[i] is not None else "") for i, h in enumerate(keys) if h}
        if not data or not any(v.strip() for v in data.values()):
            continue
        _fingerprinted(data)
        out.append((rn, SS.R.redact_row(data)[0]))
    return out


@dataclass
class Verdict:
    """What one check decided: states saved now, conflicts logged now, and the kept edits the new copy makes
    redundant — the ones Google acknowledged, and the ones it hands to the sheet (compacted once the copy has stood a
    while, record_books.compact: the sheet's value is read from then on)."""
    states: list[dict] = field(default_factory=list)
    conflicts: list[dict] = field(default_factory=list)
    compact: list[tuple[tuple, int]] = field(default_factory=list)
    acked: int = 0
    owed: int = 0
    hand: int = 0


class TabCheck(SS.TabMerge):
    """One tab of the check: each kept row found by its key in what Google holds, each cell decided."""

    def __init__(self, sid: str, tab: str, live: SS.Live | None, cells: list[SS.Cell], states: dict[tuple, dict],
                 copy: Callable[[], Any], now: float, verdict: Verdict,
                 modified: Callable[[], float | None] | None = None) -> None:
        super().__init__(sid, tab, live, cells, states, copy, now, modified=modified)
        self.v = verdict
        # (sheet row, column key) → an acknowledged edit's own text, kept by the copy there, and the edit it makes
        # redundant once it is
        self.texts: dict[tuple[int, str], tuple[str, tuple, int]] = {}
        self.carried: list[dict] = []

    def _base(self, c: SS.Cell) -> str:
        """The value Google last agreed with (the first edit's `before` while it never did)."""
        st = self.states.get(c.key)
        return st["base"] if st else c.first_before

    def _hand(self, c: SS.Cell, s: str, why: str) -> None:
        """The sheet's value comes in: the copy holding it lands first, the edit is compacted after it has stood a
        while — a newer edit than this one, should one come meanwhile, stays and wins."""
        self.v.compact.append((c.key, c.edit_id))
        self.v.hand += 1

    def run_check(self) -> None:
        groups: dict[tuple, list[SS.Cell]] = {}
        for c in self.cells:
            groups.setdefault((c.match, c.keyed, c.row_key), []).append(c)
        index: dict[str, dict[str, list[int]]] = {}
        for (match, _keyed, key), cells in groups.items():
            if self.live is None:
                continue
            if match not in index:
                index[match] = self._rows_by(match, self.live.rows, self.ref)
            at = index[match].get(key) or []
            if len(at) > 1:
                continue
            if not at:
                self._gone(cells)
                continue
            rn, raw = self.live.rows[at[0]]
            for c in cells:
                self._judge(c, rn, raw, self.live.withheld.get(rn, set()))

    def _gone(self, cells: list[SS.Cell]) -> None:
        # a row an edit (never an append) names stood in the copy when it was kept
        was_there = not any(c.appended for c in cells) or any(
            (self.states.get(c.key) or {}).get("state") in ("synced", "superseded") for c in cells)
        if not was_there:
            # a row Postgres made that the backup has not carried yet: owed, nothing to decide
            self.v.owed += sum(1 for c in cells if not self._settled(c))
            return
        owed = [c for c in cells if not self._settled(c) and self.changed(c)]
        raw = self._copy_row(cells[0]) if owed else None
        if owed and raw is not None and not self.removed(raw, cells):
            self.carried.append(raw)
            for c in owed:
                self.v.conflicts.append(SS._conflict(c, self._base(c), "", "postgres", WHY_ROW_KEPT, self.now))
            self.v.owed += len(owed)
            return
        # nothing owed; or a row Postgres' own book change took off, or one no copy holds any more: it stays gone,
        # and its kept edits with it
        for c in cells:
            if self._settled(c):
                self.v.compact.append((c.key, c.edit_id))
            else:
                self._hand(c, "", WHY_ROW_GONE)

    def _judge(self, c: SS.Cell, rn: int, raw: dict, withheld: set) -> None:
        col = self._column(c.field, c.keyed)
        if col is None:
            return
        key = self.live.keys[col]
        if key in withheld or key not in raw:
            return
        s = raw.get(key, "")
        b = self._base(c)
        if SS.marker(s) or SS.marker(c.value) or SS.marker(b):
            return
        if self._settled(c):
            # the sheet already took this cell: the copy now holds what it says
            self.v.compact.append((c.key, c.edit_id))
            return
        if SS.same(s, c.value, c.keyed):
            # acknowledged: the copy keeps Postgres' own text there, and then the edit is redundant
            self.v.states.append(SS._state(c, "synced", s, s, self.now, c.edit_id))
            self.texts[(rn, key)] = (c.value, c.key, c.edit_id)
            self.v.acked += 1
            return
        if self.changed(c):
            if SS.same(s, b, c.keyed):
                self.v.owed += 1
                return
            seen = self._seen(c, s)
            winner, why = self.newer(c, s, b, seen)
            self.v.conflicts.append(SS._conflict(c, b, s, winner, why, seen))
            if winner == "postgres":
                self.v.owed += 1
                return
            # the sheet's value comes in, and the backup leaves the cell to it
            self.v.states.append(SS._state(c, "superseded", s, s, seen, c.edit_id, why))
            self._hand(c, s, why)
            return
        self._hand(c, s, WHY_HAND)


class Check:
    """One book's check, start to staged; SS.Refused is raised for the round to back off."""

    def __init__(self, db: SS.Db, sheets: SS.Sheets, hub: hubdb.HubDb | None = None,
                 clock: Callable[[], float] = time.time) -> None:
        self.db, self.sheets, self.hub, self.clock = db, sheets, hub, clock

    def book(self, sid: str, tabs: list[str] | None = None) -> dict[str, Any]:
        """The book read (only `tabs` when named), decided and staged: what was found, or why it was not."""
        if SS.R is None:
            return {"ok": False, "why": "server/redaction.py is not mounted; nothing is read without it"}
        rw = self.db.rw()
        name = self.db.book_name(sid)
        if name is None:
            # a book the copy never held (kept out of every copy, or never shared with it) is never read here either
            RB.check_said(rw, sid, False, "the copy holds no such book: never read", retry_at=self.clock() + 86400)
            return {"ok": False, "why": "not in the copy"}
        if keep_out(self.hub, sid, name):
            RB.check_said(rw, sid, False, "a book no copy holds: never read", retry_at=self.clock() + 30 * 86400)
            return {"ok": False, "why": "kept out"}
        if sid in fingerprint_books() and not _salt():
            RB.check_said(rw, sid, False, "its SSN fingerprint needs HUB_PII_SALT, which this service lacks",
                          retry_at=self.clock() + RETRY_S)
            return {"ok": False, "why": "no salt"}
        try:
            title, props = self.sheets.book_props(sid)
        except SS.GoogleError as e:
            RB.check_said(rw, sid, False, f"the book could not be read ({e})", retry_at=self.clock() + RETRY_S)
            return {"ok": False, "why": str(e)}
        name = title or name
        RB.name_of(rw, sid, name)
        if keep_out(None, sid, name):
            RB.check_said(rw, sid, False, "a book no copy holds: never read", retry_at=self.clock() + 30 * 86400)
            return {"ok": False, "why": "kept out"}
        partial = tabs is not None
        cells = self.db.book_cells(sid)
        by_tab: dict[str, list[SS.Cell]] = {}
        states: dict[tuple, dict] = {}
        for c, st in cells:
            by_tab.setdefault(c.tab, []).append(c)
            if st is not None:
                states[c.key] = st
        held = self.db.copied_tabs(sid)
        wanted = [t for t in props if not partial or t in tabs]
        pid = self.db.pull_open(sid, name, partial)
        verdict = Verdict()
        staged_tabs: list[dict] = []
        twins = owned(self.hub, sid)
        try:
            for batch in self._batches(wanted, props):
                for tab, matrix in self._read(sid, batch, props).items():
                    staged = self._tab(sid, tab, matrix, by_tab.get(tab, []), states, twins, verdict, pid)
                    if staged is not None:
                        staged_tabs.append(staged)
            for tab in sorted((set(held) | set(by_tab)) - set(props)):
                if partial and tab not in tabs:
                    continue
                staged_tabs += self._gone_tab(tab, by_tab.get(tab, []), states, verdict)
        except BaseException as exc:
            self.db.pull_failed(pid, type(exc).__name__)
            if isinstance(exc, SS.Refused):
                RB.check_said(rw, sid, False, str(exc), retry_at=self.clock() + 600)
            elif isinstance(exc, SS.GoogleError):
                RB.check_said(rw, sid, False, f"the book could not be read ({exc})", retry_at=self.clock() + RETRY_S)
            raise
        self.db.save(verdict.states, verdict.conflicts)
        self.db.pull_staged(pid, staged_tabs, verdict.compact)
        sheet_won = sum(1 for k in verdict.conflicts if k["winner"] == "sheet")
        said = (f"{len(staged_tabs)} tab(s) staged: {verdict.acked} acknowledged, {verdict.owed} still owed,"
                f" {verdict.hand} brought in from the sheet, conflicts won by Postgres"
                f" {len(verdict.conflicts) - sheet_won}, by the sheet {sheet_won}")
        RB.check_said(rw, sid, True, said, pid, partial)
        log.info("check %s… (%s)%s: %s", sid[:8], name[:40], " partial" if partial else "", said)
        return {"ok": True, "pull_id": pid, "tabs": len(staged_tabs), "acked": verdict.acked, "owed": verdict.owed,
                "hand": verdict.hand, "conflicts": len(verdict.conflicts), "sheet_won": sheet_won, "partial": partial}

    @staticmethod
    def _batches(tabs: list[str], props: dict[str, dict]) -> list[list[str]]:
        """The tabs in reads of at most CELLS_PER_READ cells; a tab larger than that alone (read in windows)."""
        out: list[list[str]] = []
        cur: list[str] = []
        size = 0
        for t in tabs:
            n = max(1, int(props[t].get("rows") or 0)) * max(1, int(props[t].get("cols") or 0))
            if n > CELLS_PER_READ:
                out.append([t])
                continue
            if cur and size + n > CELLS_PER_READ:
                out.append(cur)
                cur, size = [], 0
            cur.append(t)
            size += n
        if cur:
            out.append(cur)
        return out

    def _read(self, sid: str, batch: list[str], props: dict[str, dict]) -> dict[str, list[list]]:
        t = batch[0]
        rows, cols = int(props[t].get("rows") or 0), max(1, int(props[t].get("cols") or 0))
        if len(batch) > 1 or rows * cols <= CELLS_PER_READ:
            return dict(zip(batch, self.sheets.batch_get(sid, [SS.quote(x) for x in batch])))
        step = max(1, CELLS_PER_READ // cols)
        matrix: list[list] = []
        for lo in range(1, rows + 1, step):
            hi = min(rows, lo + step - 1)
            got = self.sheets.batch_get(sid, [f"{SS.quote(t)}!{lo}:{hi}"])[0]
            matrix.extend(list(r) for r in got)
            matrix.extend([] for _ in range(hi - lo + 1 - len(got)))
        while matrix and not matrix[-1]:
            matrix.pop()
        return {t: matrix}

    def _tab(self, sid: str, tab: str, matrix: list[list], cells: list[SS.Cell], states: dict[tuple, dict],
             twins: bool, verdict: Verdict, pid: int) -> dict | None:
        """One tab: decided, its rows staged (Google's, an acknowledged edit's own text in its cell, the copy's text
        kept where Google says the same, the rows kept that the sheet lost); None when it holds no row."""
        with SS.R.reading(sid):
            rows = stored_rows(matrix, twins)
            live = SS.live_tab(matrix)
        copied = self.db.copy(sid, tab) or ((), [])
        check = TabCheck(sid, tab, live, cells, states, lambda: copied, self.clock(), verdict,
                         lambda: self.db.book_modified(sid))
        check.removing = SS.BO.removing(self.db.rw(), sid, tab)
        check.run_check()
        copy = {rn: raw for rn, raw, _i in copied[1]}
        out: list[tuple[int, dict]] = []
        for rn, data in rows:
            held = copy.get(rn) or {}
            for k, v in data.items():
                said = check.texts.get((rn, k))
                if said is not None and not SS.marker(v):
                    data[k] = said[0]
                    verdict.compact.append((said[1], said[2]))
                elif k in held and held[k] != v and SS.same(held[k], v):
                    # the same thing the copy already says: its text stands
                    data[k] = held[k]
            out.append((rn, data))
        last = max((rn for rn, _d in out), default=1)
        for raw in check.carried:
            last += 1
            out.append((last, raw))
        if not out:
            return None
        keys = list(dict.fromkeys(k for _rn, d in out for k in d))
        self.db.pull_rows(pid, tab, out)
        return {"tab": tab, "keys": keys, "exact": twins, "rows": len(out)}

    def _gone_tab(self, tab: str, cells: list[SS.Cell], states: dict[tuple, dict], verdict: Verdict) -> list[dict]:
        """A tab the copy or the edits hold that the sheet no longer has: kept while a change to it is owed."""
        check = TabCheck("", tab, None, cells, states, lambda: None, self.clock(), verdict)
        owed = [c for c in cells if not check._settled(c) and check.changed(c)]
        if owed:
            for c in owed:
                verdict.conflicts.append(SS._conflict(c, check._base(c), "", "postgres", WHY_TAB_KEPT, self.clock()))
            verdict.owed += len(owed)
            return [{"tab": tab, "kept": True}]
        for c in cells:
            if check._settled(c):
                verdict.compact.append((c.key, c.edit_id))
            else:
                check._hand(c, "", WHY_TAB_GONE)
        return []
