"""Who a number belongs to, as the relay's hotline desk reads it (server/hotline_desk.py) for the reply ear: the
company's own lines kept in asa-hub-db (app/company_lines.py), the staff roster from the people slice and asa-hub-db's
copy of the accounts, the declared shared lines, and the one rule that names a caller."""
from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Any

import hub_rows
import lanes_pg as psycopg2

LINES_TABLE = os.getenv("HUB_LINES_TABLE", "app.asa_openphone_lines")
PEOPLE_PATH = os.getenv("HUB_HOTLINE_PEOPLE", "/srv/snapshot/people.json")
CORE_SHEET_ID = os.getenv("HUB_DB_SHEET_ID", "1ia6i0SFiVNhn4wi6bt6EDcGwReS0P7-L4Up2hRfIVPg")

# THE SHARED-LINE FLOOR.
DECLARED_SHARED_FLOOR = ("3307544040", "3309195558", "3309195559", "3330919558")
TALENT_GS = Path(os.getenv("HUB_TALENT_GS")
                 or (Path(__file__).resolve().parent.parent / "apps-script" / "Talent.gs"))

# Accounts that are not staff: contact guard's staffContactIndex_ skips them.
_NOT_STAFF_ROLES = frozenset({"client", "onboarding", "interviewer"})


class SourceError(RuntimeError):
    """A source could not be read. The message is a sentence for a person."""


def digits(value: Any) -> str:
    """Last ten digits — the key every reader of a number on this platform computes."""
    d = re.sub(r"\D+", "", str(value if value is not None else ""))
    if len(d) >= 11 and d.startswith("1"):
        d = d[1:]
    d = d[-10:]
    return d if len(d) == 10 else ""


def e164(value: Any) -> str:
    """A number as E.164."""
    raw = str(value if value is not None else "").strip()
    d = re.sub(r"\D+", "", raw)
    if len(d) == 10:
        return "+1" + d
    if len(d) == 11 and d.startswith("1"):
        return "+" + d
    if raw.startswith("+") and 11 <= len(d) <= 15:
        return "+" + d
    return ""


def split_phones(cell: Any) -> list[str]:
    """A parties cell ("+13309195558, +13307544040") as its entries, in order."""
    return [p.strip() for p in re.split(r"[,;|/\n]+", str(cell if cell is not None else ""))
            if p.strip()]


def shared_floor() -> set[str]:
    """The declared shared lines: Talent.gs when it is on disk, unioned with the copy above."""
    out = set(DECLARED_SHARED_FLOOR)
    try:
        src = TALENT_GS.read_text(encoding="utf-8")
        m = re.search(r"var\s+SHARED_LINE_DIGITS\s*=\s*\[([^\]]*)\]", src)
        if m:
            out |= {digits(x) for x in re.findall(r"'([^']*)'", m.group(1)) if digits(x)}
    except OSError:
        pass
    return out


def resolve_caller(line: str, participants: Any, team: Any, *,
                   company: dict[str, str] | None, floor: set[str],
                   roster: dict[str, dict[str, str]] | None) -> dict[str, str]:
    """The other party on a call, and whether a name may be said."""
    line_digits = digits(line)
    phone_raw = ""
    for cell in (participants, team):
        for p in split_phones(cell):
            d = digits(p)
            if d and d != line_digits:
                phone_raw = p
                break
        if phone_raw:
            break
    d = digits(phone_raw)
    out = {"phone": e164(phone_raw) if d else "", "kind": "unknown", "line_name": "",
           "who": "unknown", "name": ""}
    if not d:
        return out
    if d in floor or (company is not None and d in company):
        out.update(kind="company_line", who="shared", line_name=(company or {}).get(d, ""))
        return out
    if company is None:
        # Not provably outside: the list of our own lines was not seen.
        return out
    out["kind"] = "outside"
    if roster is None:
        return out
    people = roster.get(d) or {}
    if len(people) == 1:
        out.update(who="sole", name=next(iter(people.values())))
    elif len(people) > 1:
        out["who"] = "shared"
    return out


def _read_directory(pg_dsn: str) -> tuple[tuple[dict[str, str], dict[str, str]], int]:
    """((digits → OpenPhone name, provider id → digits), rows) from the company lines kept in asa-hub-db
    (app/company_lines.py); `pg_dsn` is kept for the caller's signature."""
    import lanes_db  # noqa: PLC0415

    try:
        with lanes_db.connect() as conn, conn.cursor() as cur:
            cur.execute(f"select id, number, name from {LINES_TABLE}")  # noqa: S608 - config, not input
            got = cur.fetchall()
    except Exception as exc:  # noqa: BLE001
        raise SourceError(f"The company line directory could not be read ({type(exc).__name__}).") from exc
    if not got:
        raise SourceError(f"The company line directory ({LINES_TABLE}) holds no rows.")
    names: dict[str, str] = {}
    ids: dict[str, str] = {}
    for pid, number, name in got:
        d = digits(number)
        if not d:
            continue
        names[d] = str(name or "").strip()
        if pid:
            ids[str(pid).strip()] = d
    return (names, ids), len(got)


def _phone_entries(cell: Any) -> list[Any]:
    """A phones cell or list as its entries: a list as given, JSON text, or "label: number" pieces."""
    if isinstance(cell, list):
        return cell
    text = str(cell if cell is not None else "").strip()
    if not text:
        return []
    try:
        got = json.loads(text)
        return got if isinstance(got, list) else []
    except ValueError:
        parts = [p for p in re.split(r"\s*[;,]\s*", text) if p]
        return [p.split(":", 1)[1].strip() if ":" in p else p.strip() for p in parts]


def _phone_of(entry: Any) -> str:
    if isinstance(entry, dict):
        return str(entry.get("number") or entry.get("value") or "")
    return str(entry if entry is not None else "")


def _read_roster(people_path: str, pg_dsn: str = "",
                 core_sheet_id: str = CORE_SHEET_ID) -> tuple[dict[str, dict[str, str]], int]:
    """digits → {name key → display name}, built the way the contact guard builds its index."""
    try:
        with open(people_path, encoding="utf-8") as fh:
            data = json.load(fh)
    except Exception as exc:  # noqa: BLE001
        raise SourceError(f"The staff roster could not be read ({type(exc).__name__}).") from exc
    rows = data.get("rows") if isinstance(data, dict) else None
    if not isinstance(rows, list) or not rows:
        raise SourceError("The staff roster file carries no rows.")
    try:
        accounts = hub_rows.rows(core_sheet_id, "users")
    except Exception as exc:  # noqa: BLE001
        raise SourceError(f"The staff accounts could not be read ({type(exc).__name__}), "
                          "so no caller is named.") from exc
    if not accounts:
        raise SourceError("The staff accounts copy holds no rows, so no caller is named.")

    out: dict[str, dict[str, str]] = {}

    def add(name_cell: Any, phone: Any) -> None:
        d = digits(_phone_of(phone))
        name = " ".join(str(name_cell or "").split())
        key = re.sub(r"[^a-z0-9]", "", name.lower())
        if d and key:
            out.setdefault(d, {}).setdefault(key, name)

    for r in rows:
        if not isinstance(r, dict):
            continue
        add(r.get("name"), r.get("phone"))
        for entry in _phone_entries(r.get("phones")):
            add(r.get("name"), entry)
    for u in accounts:
        if not isinstance(u, dict):
            continue
        if str(u.get("role") or "").strip().lower() in _NOT_STAFF_ROLES:
            continue
        if str(u.get("system_type") or "").strip():
            continue
        add(u.get("display_name"), u.get("phone"))
        for entry in _phone_entries(u.get("phones")):
            add(u.get("display_name"), entry)
    return out, len(rows) + len(accounts)
