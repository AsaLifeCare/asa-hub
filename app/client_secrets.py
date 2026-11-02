"""A client's SSN, TL debit card number, DC expiry date, DC security code and DC PIN, saved from Clients' Client
details by the master, a Platform Lead or a Director for a client they read (clientProfileSecretSet). Each save is the
whole value in its field's standard form (123-45-6789, the card in fours, 04/27, the code's and the PIN's digits):
written to the client's row of the Asa Client Database Master as asatech, and kept in Postgres (app.client_secrets,
db/client_secrets.sql) sealed to the platform's public key — the app holds no key to open it — with the SSN's and the
card's last four beside it. The Hub never shows it again: the panel draws the mask, and no read answers the value."""
from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Any

import client_writes as CW
import clients as C
import gsjs
import locations as L
import scope as sc
import smart_comms as SC
import staff_views
import writes as W
from gsjs import name_key
from scope import Defer
from writes import Decision

ACTION = "clientProfileSecretSet"
# who saves them: the master, and an account whose own badges name a Platform Lead or a Director — never a badge that
# only follows one (scope.BADGE_FOLLOWS stands a Supervisor for a Director elsewhere; a Team Lead follows nobody)
BADGES = frozenset({"PLATFORMLEAD", "DIRECTOR"})
KEY_FILE = Path(os.getenv("HUB_CLIENT_SECRETS_KEY") or Path(__file__).resolve().parent / "client_secrets.pub")
# each field and its Master column, folded as clients.BOOK_MASKED folds it
FIELDS = {"ssn": "ssn", "tl_card": "tldebitcardnumber", "dc_exp": "dcexpdate", "dc_security_code": "dcsecuritycode",
          "dc_pin": "dcpinno"}
TABLE = "app.client_secrets"


def may_save(user: dict[str, Any] | None) -> bool:
    if sc.is_real_master(user):
        return True
    if not user or user.get("is_service") or user.get("visiting_member"):
        return False
    return bool(BADGES & set(sc.types_from_raw(user.get("types"))))


def standard(field: str, raw: Any) -> tuple[str, str] | str:
    """(the value in its field's standard form, its last four) — or why it is not one."""
    s = gsjs.trim(gsjs.or_blank(raw))
    d = re.sub(r"\D", "", s)
    if field == "ssn":
        if not re.fullmatch(r"[\d\s-]+", s) or len(d) != 9:
            return "An SSN is nine digits, such as 123-45-6789."
        return f"{d[:3]}-{d[3:5]}-{d[5:]}", d[-4:]
    if field == "tl_card":
        if not re.fullmatch(r"[\d\s-]+", s) or not 13 <= len(d) <= 19:
            return "A card number is 13 to 19 digits."
        return " ".join(d[i:i + 4] for i in range(0, len(d), 4)), d[-4:]
    # a security code and a PIN keep no last four: every digit of them is the secret
    if field == "dc_security_code":
        if not re.fullmatch(r"\d{3,4}", s):
            return "A security code is 3 or 4 digits."
        return s, ""
    if field == "dc_pin":
        if not re.fullmatch(r"\d{4,6}", s):
            return "A PIN is 4 to 6 digits."
        return s, ""
    m = re.fullmatch(r"(\d{1,2})\s*/\s*(\d{2}|\d{4})", s) or re.fullmatch(r"(\d{2})(\d{2}|\d{4})", s)
    if not m or not 1 <= int(m.group(1)) <= 12:
        return "An expiry date is a month and a year, such as 04/27."
    return f"{int(m.group(1)):02d}/{m.group(2)[-2:]}", ""


def seal(value: str) -> bytes:
    """The value sealed to the platform's public key (RSA-OAEP, SHA-256): only the private key, off every container,
    opens it."""
    from cryptography.hazmat.primitives import hashes, serialization  # noqa: PLC0415 - only a save reaches here
    from cryptography.hazmat.primitives.asymmetric import padding  # noqa: PLC0415
    key = serialization.load_pem_public_key(KEY_FILE.read_bytes())
    return key.encrypt(value.encode(), padding.OAEP(mgf=padding.MGF1(hashes.SHA256()), algorithm=hashes.SHA256(),
                                                    label=None))  # type: ignore[union-attr]


def column(n: int) -> str:
    """A 0-based column index as its A1 letters."""
    out = ""
    n += 1
    while n:
        n, r = divmod(n - 1, 26)
        out = chr(65 + r) + out
    return out


def master_row(reads: L.Reads, ctx: dict) -> tuple[str, int] | str:
    """(the book, the client's row on the Master) as the copy finds it, or why it cannot be named."""
    sid = C.client_db_id(reads)
    ref = reads.tab_of(sid, C.MASTER_TAB, "the Asa Client Database")
    if ref is None:
        return "The Asa Client Database has no Master tab."
    names = [h for h in ref.headers if C.BOOK_FIELDS.get(C.fold(h)) == "name"]
    key = name_key(ctx["name"])

    def who(raw: dict) -> str:
        return next((t for t in (gsjs.text(gsjs.or_blank(raw.get(h))) for h in names) if t), "")

    hits = [rn for rn, raw in reads.db.rows(ref) if who(raw) and name_key(who(raw)) == key]
    if not hits:
        return "No row of the Asa Client Database Master names this client."
    if len(hits) > 1:
        return "Two rows of the Asa Client Database Master carry this name, so neither was written."
    return sid, hits[0]


def master_cell(reads: L.Reads, ctx: dict, field: str) -> tuple[str, str] | str:
    """(the book, the A1 of the client's cell for the field) once the sheet itself names the column on its header row
    and the client on that row; or why it does not."""
    found = master_row(reads, ctx)
    if isinstance(found, str):
        return found
    sid, rn = found
    drive = reads.need_drive()
    tab = "'" + C.MASTER_TAB.replace("'", "''") + "'"
    heads = (drive.sheet_values(sid, f"{tab}!1:1") or [[]])[0]
    col = next((j for j, h in enumerate(heads) if C.fold(h) == FIELDS[field]), None)
    names = [j for j, h in enumerate(heads) if C.BOOK_FIELDS.get(C.fold(h)) == "name"]
    if col is None or not names:
        return "The Asa Client Database Master's header row names no column for this field."
    row = (drive.sheet_values(sid, f"{tab}!{rn}:{rn}") or [[]])[0]
    on_row = next((row[j] for j in names if j < len(row) and gsjs.trim(row[j])), "")
    if name_key(on_row) != name_key(ctx["name"]):
        return "The client's row has moved on the Asa Client Database Master since it was read; nothing was written."
    return sid, f"{tab}!{column(col)}{rn}"


def write_master(reads: L.Reads, ctx: dict, field: str, value: str) -> str:
    """'' once the client's Master cell holds the value; else why not (the save is kept in Postgres all the same)."""
    try:
        cell = master_cell(reads, ctx, field)
        if isinstance(cell, str):
            return cell
        reads.need_drive().sheet_cell_put(cell[0], cell[1], value)
        return ""
    except Defer as exc:
        return f"The Asa Client Database could not be written ({str(exc)[:120]})."
    except Exception as exc:  # noqa: BLE001 - Google's words may quote the request: the kind only
        return f"The Asa Client Database could not be written ({type(exc).__name__})."


def latest(reads: L.Reads, key: str) -> dict[str, str]:
    """field → the last four (the expiry: '') of the newest save, for the mask; nothing ever opens the value."""
    got = reads.once("client_secrets:" + key, lambda: reads.db.query(
        f"select distinct on (field) field, last4 from {TABLE} where client_key = %s"  # noqa: S608
        " order by field, at desc, id desc", (key,)))
    return {str(f): str(l4 or "") for f, l4 in got}


def secret_set(sess: L.Session, payload: dict) -> Decision:
    """clientProfileSecretSet: one field's new value, in its standard form, written to the client's Master row and
    kept sealed in Postgres; the answer names its last four alone."""
    user = sess.user
    if not may_save(user):
        return Decision(C.unknown())
    reads = sess.reads
    ctx = CW.client_of(reads, payload.get("client"))
    if ctx.get("refused"):
        return CW.door_refused(ctx["refused"])
    rdr = C.reader_for(sess, ctx["key"])
    if not rdr or C.own_only(rdr):
        return Decision(C.unknown())
    field = gsjs.str_(payload.get("field"))
    if field not in FIELDS:
        return W.refuse(400, "field: ssn, tl_card, dc_exp, dc_security_code or dc_pin.")
    got = standard(field, payload.get("value"))
    if isinstance(got, str):
        return W.refuse(400, got)
    value, last4 = got
    sealed = seal(value)
    why = write_master(reads, ctx, field, value)
    cur = W.HELD.get()
    if cur is None:
        raise Defer("a client's secret is kept only under the platform's write lock")
    cur.execute(f"insert into {TABLE} (client_key, field, sealed, last4, by_email, sheet_written, sheet_why, write_id)"
                " values (%s, %s, %s, %s, %s, %s, %s, %s)",
                (ctx["key"], field, sealed, last4, gsjs.str_((user or {}).get("email")), not why, why, SC.write_id()))
    staff_views.record(user, ACTION, ctx["key"])
    return Decision({"status": 200, "data": {"saved": True, "field": field, "last4": last4,
                                             "sheet": "not_written" if why else "written", "why": why}},
                    subject=ctx["key"], own=True)


WRITE_ACTIONS = {ACTION: secret_set}
POLICY = {ACTION: {"roles": ("admin", "manager", "staff"), "params": {"client": "string", "field": "string",
                                                                     "value": "string"}}}
BUSY_OF = {ACTION: {"status": 409, "message": W.BUSY}}
