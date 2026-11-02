"""Employee 360's edit door (apps-script/Emp360.gs emp360EditField, emp360WriteCell_) decided off asa-hub-db: one
editable Employee Database Master cell kept in app.edits as the truth, final — the row named by cells the edit does not
write (never its number), the cell as the copy holds it the witness. The editable columns are the Master's typed data
block, written here as staff_writes and cert_docs write it; a column the copy cannot place, or a cell it withholds, is
Apps Script's."""
from __future__ import annotations

from typing import Any, Callable

import cert_docs as CD
import emp360 as E
import gsjs
import hubdb
import locations as L
import resource_rows as RR
import staff as SP
import staff_views
import writes as W
from scope import Defer
from writes import Decision

BUSY = "The sheet is busy — try again in a moment."
# the Master's own columns a row is named by, the first set that tells it apart
KEY_SETS = (("employee_id",), ("first_name", "last_name", "employee"), ("first_name", "last_name"), ("email",),
            ("phone_number",))

s_ = gsjs.str_


def _bare(ref: hubdb.TabRef, key: str) -> str | None:
    """The column a key names as the copy keeps it whole: the last of a repeated name."""
    heads = [h for h in ref.headers if not SP.TWIN_KEY.fullmatch(h) and hubdb.estate_key(h) == key]
    return heads[-1] if heads else None


def first_head(ref: hubdb.TabRef, field: str) -> str | None:
    """header.indexOf(field): the first column carrying the key; '' when the copy cannot tell which one is first."""
    heads = [h for h in ref.headers if hubdb.estate_key(hubdb.twin_base(h)) == field]
    if not heads:
        return None
    if len(heads) == 1:
        return heads[0]
    if len({hubdb.twin_base(h) for h in heads}) == 1:
        # one repeated name: its earlier columns are numbered, the bare one is the last
        def place(h: str) -> int:
            m = SP.TWIN_KEY.fullmatch(h)
            return int(m.group(2)) if m else 1 << 30
        return min(heads, key=place)
    return heads[0] if hubdb.in_sheet_order(list(ref.headers)) else ""


def edit_field(sess: L.Session, payload: dict) -> Decision:
    """emp360EditField: the screen's edit door — editability is decided by the column list, the cell must still hold
    what the panel opened on."""
    user = sess.user or {}
    if not E.is_writer(sess.user):
        return Decision(dict(E.DENIED))
    p = payload if isinstance(payload, dict) else {}
    field = hubdb.estate_key(gsjs.or_text(p.get("field")))
    if CD.pii(field):
        return W.refuse(403, f'"{field}" is protected — it is never read or written here.')
    if not E.editable(field):
        return W.refuse(400, f'"{field}" is not an editable Employee 360 field.')
    reads = sess.reads
    got = E.resolve(reads, p)
    if got.get("error"):
        return Decision(got["error"])
    if not got["master"]:
        return W.refuse(404, "No row in the Employee Database matches this person — nothing to write to.")
    sheet = CD.master_sheet(reads)
    ref = sheet["ref"]
    if ref is None:
        return W.refuse(500, "The Master tab could not be opened.")
    head = first_head(ref, field)
    if head is None:
        return W.refuse(400, f'The Master tab has no "{field}" column — the estate renamed it.')
    if not head:
        raise Defer(f'the copy keeps no order among the Master\'s "{field}" columns')
    rn, raw = sheet["raw"][got["at"]]
    if SP.TWIN_KEY.fullmatch(head) and head not in raw:
        raise Defer("the copy holds only the last of the Master's repeated columns")
    current = hubdb.estate_cell(hubdb.typed(raw.get(head), "estate"))
    if SP._marker(current):
        raise Defer("the copy withholds the Master cell this edit rests on")
    sid = ref.sheet_id
    if current != s_(p.get("expected")):
        return W.refuse(409, "Someone changed this row since you opened it — reloaded.", fresh=(sid,),
                        data={"current": current})
    sets = [[_bare(ref, k) for k in ks] for ks in KEY_SETS if field not in ks]
    sets = [hs for hs in sets if all(hs)]
    named = W.row_key_of(sheet["raw"], got["at"], sets)
    if named is None:
        return W.refuse(409, W.NOT_TOLD_APART, fresh=(sid,))
    name = got["person"]["name"]
    value = s_(p.get("value"))
    cell = gsjs.trim(gsjs.js_str(head))
    rec = W.kept_record(sid, ref.tab, "edit", named[0], named[1], gsjs.name_key(name), {cell: value}, {cell: current})
    staff_views.record(user, "emp360WriteCell", f"{name}: {field} (row {rn})")
    out = W.final({"status": 200, "data": {"field": field, "value": value, "row": got["id"]}}, [rec],
                  gsjs.name_key(name))
    # the estate's forms and its people write this sheet too: a witness off a copy the sheet has moved past waits
    out.fresh = (sid,)
    return out


ACTIONS: dict[str, Callable[[L.Session, dict], Decision]] = {"emp360EditField": edit_field}
POLICY: dict[str, dict[str, Any]] = {"emp360EditField": {"roles": ("admin", "manager")}}
BUSY_OF: dict[str, dict[str, Any]] = {"emp360EditField": {"status": 503, "message": BUSY}}


class Store(RR.Store):
    """app.emp360_writes and _receipts; the Master's cells app.edits'."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="emp360", label="Employee 360")
