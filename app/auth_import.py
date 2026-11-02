"""The sign-in's import (run at deploy, again at will, through the relay's service door `_import`): the salt and
pass_hash cells of the users tab and the live temporary passwords — credentials every copy withholds
(server/redaction.py), so they alone are read from the sheet itself, as asatech, through the Sheets API — and the
Sessions tab's live rows, which the copy holds (their token hashes, never a token). Nothing read is printed or logged:
only how many rows each part carried. A credential a Python door already set is never overwritten, a session already
here never brought back, and the master's own rows stay Apps Script's while the master signs in there."""
from __future__ import annotations

import json
import logging
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from typing import Any

import auth as A
import auth_store as AS
import gsjs
import hubdb
import locations as L

log = logging.getLogger("asa-hub-app.auth")

API = "https://sheets.googleapis.com/v4/spreadsheets"
TIMEOUT_S = 30.0
USERS_TAB = "users"
SESSIONS_TAB = "hub_sessions"
TEMPS_TAB = "temp_passwords"

s_ = gsjs.str_


def _quote(tab: str) -> str:
    return "'" + tab.replace("'", "''") + "'"


def _col(n: int) -> str:
    out = ""
    n += 1
    while n:
        n, r = divmod(n - 1, 26)
        out = chr(65 + r) + out
    return out


def _get(drive: Any, sheet_id: str, path: str, params: list[tuple[str, str]]) -> dict[str, Any]:
    """One Sheets API read as asatech (its own token, checked to be asatech's, as Drive writes use it)."""
    auth = drive._owner_write("the sign-in's credentials are read")
    q = urllib.parse.urlencode(params)
    req = urllib.request.Request(f"{API}/{urllib.parse.quote(sheet_id)}/{path}?{q}", headers=auth)
    with urllib.request.urlopen(req, timeout=TIMEOUT_S) as res:
        return json.loads(res.read() or b"{}")


def _columns(drive: Any, sheet_id: str, tab: str, wanted: tuple[str, ...]) -> list[list[Any]] | None:
    """The tab's columns named `wanted` (normKey_'d headers), each from row 2 down; None when one is missing."""
    head = _get(drive, sheet_id, f"values/{urllib.parse.quote(_quote(tab) + '!1:1')}", [])
    names = [hubdb.norm_key(h) for h in ((head.get("values") or [[]])[0])]
    at = [names.index(w) if w in names else -1 for w in wanted]
    if -1 in at:
        return None
    ranges = [("ranges", f"{_quote(tab)}!{_col(i)}2:{_col(i)}") for i in at]
    got = _get(drive, sheet_id, "values:batchGet",
               ranges + [("majorDimension", "COLUMNS"), ("valueRenderOption", "UNFORMATTED_VALUE"),
                         ("dateTimeRenderOption", "FORMATTED_STRING")])
    out = []
    for vr in got.get("valueRanges") or []:
        vals = vr.get("values") or [[]]
        out.append(vals[0] if vals else [])
    return out if len(out) == len(wanted) else None


def _cell(v: Any) -> str:
    if isinstance(v, bool):
        return "true" if v else "false"
    return s_(v)


def _at(v: Any) -> datetime | None:
    """An instant as a cell holds it: ISO text, or a date the sheet shows (read as the copy reads one)."""
    typed = hubdb.typed(v, "hub") if isinstance(v, str) else v
    if isinstance(typed, gsjs.SheetDate):
        return typed.at
    s = s_(v)
    if not s:
        return None
    try:
        t = datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None
    return t if t.tzinfo else t.replace(tzinfo=timezone.utc)


def core(reads: L.Reads) -> tuple[str, str]:
    """The book and tab Apps Script's users tab lives in (its HUB_DB, where the Sessions and reset tabs live too)."""
    res = reads.db.resolve(USERS_TAB)
    if res.ref is None:
        raise hubdb.Unreadable("asa-hub-db holds no copy of the users tab")
    return res.sheet_id, res.ref.tab


def run(cur: Any, reads: L.Reads, drive: Any) -> dict[str, Any]:
    """One import, in the caller's transaction: the counts of what it carried, never a value."""
    sid, tab = core(reads)
    users = reads.users()
    masters = sorted({s_(u.get("userid")) for u in users if A.master_row(u) and s_(u.get("userid"))})
    AS.state_put(cur, AS.MASTER_UIDS, ",".join(masters))
    held = set(masters) if A.MASTER_SIGN_IN_ON_APPS_SCRIPT else set()
    out: dict[str, Any] = {"masters": len(masters)}

    cols = _columns(drive, sid, tab, ("userid", "salt", "passhash"))
    if cols is None:
        raise hubdb.Unreadable("the users tab names no user_id, salt or pass_hash column")
    ids, salts, hashes = cols
    seen: dict[str, int] = {}
    rows: list[tuple[str, str, str]] = []
    for i, raw in enumerate(ids):
        uid = _cell(raw)
        if uid:
            seen[uid] = seen.get(uid, 0) + 1
            rows.append((uid, _cell(salts[i] if i < len(salts) else ""), _cell(hashes[i] if i < len(hashes) else "")))
    carried = blank = 0
    for uid, salt, pass_hash in rows:
        if uid in held:
            continue
        if seen[uid] > 1 or not salt or not pass_hash:
            # an id two rows share proves neither password; a row with none signs in with nothing
            salt, pass_hash = "", ""
            blank += 1
        cur.execute(f"insert into {AS.CREDENTIALS} (user_id, salt, pass_hash, origin, updated_at)"
                    " values (%s, %s, %s, 'sheet', now()) on conflict (user_id) do update set salt = excluded.salt,"
                    f" pass_hash = excluded.pass_hash, updated_at = now() where {AS.CREDENTIALS}.origin = 'sheet'",
                    (uid, salt, pass_hash))
        carried += int(getattr(cur, "rowcount", 0) or 0)
    out.update(credentials=carried, credentials_blank=blank, credential_rows=len(rows))

    now = AS.now()
    temps = 0
    if reads.db.tab(sid, TEMPS_TAB) is not None:
        got = _columns(drive, sid, TEMPS_TAB, ("userid", "salt", "passhash", "channel", "createdat", "expiresat",
                                               "usedat"))
        if got is not None:
            for i, raw in enumerate(got[0]):
                vals = [_cell(c[i]) if i < len(c) else "" for c in got]
                uid, salt, pass_hash, channel, created, expires, used = vals
                exp, made = _at(expires), _at(created)
                if not uid or uid in held or used or not salt or not pass_hash or exp is None or exp <= now:
                    continue
                cur.execute(f"insert into {AS.TEMPS} (user_id, salt, pass_hash, channel, created_at, expires_at,"
                            " origin) select %s, %s, %s, %s, %s, %s, 'sheet' where not exists"
                            f" (select 1 from {AS.TEMPS} where user_id = %s and pass_hash = %s)",
                            (uid, salt, pass_hash, channel, made or now, exp, uid, pass_hash))
                temps += int(getattr(cur, "rowcount", 0) or 0)
    out["temp_passwords"] = temps

    sessions = 0
    ref = reads.db.tab(sid, SESSIONS_TAB)
    for _rn, raw in reads.db.rows(ref) if ref is not None else []:
        r = {hubdb.norm_key(k): v for k, v in raw.items()}
        th, uid = s_(r.get("tokenhash")), s_(r.get("userid"))
        real, parent = s_(r.get("actingrealuserid")), s_(r.get("parenttokenhash"))
        exp = _at(r.get("expiresat"))
        # the master's rows, and those minted from a master's session, stay Apps Script's while the master does
        if not th or not uid or uid in held or ((real or parent) and A.MASTER_SIGN_IN_ON_APPS_SCRIPT):
            continue
        if exp is None or exp <= now:
            continue
        made, seen_at = _at(r.get("createdat")), _at(r.get("lastseen")) or now
        if made is None and (real or parent):
            # a minted session's two hours count from its created_at: one without it resolves as nobody
            continue
        cur.execute(f"insert into {AS.SESSIONS} (token_hash, user_id, created_at, expires_at, last_seen, origin,"
                    " real_user_id, parent_token_hash) values (%s, %s, %s, %s, %s, 'sheet', %s, %s)"
                    " on conflict (token_hash) do nothing", (th, uid, made or now, exp, seen_at, real, parent))
        sessions += int(getattr(cur, "rowcount", 0) or 0)
    out["sessions"] = sessions
    AS.state_put(cur, "import", json.dumps(out, separators=(",", ":")))
    log.info("sign-in import: %s", json.dumps(out, separators=(",", ":")))
    return out
