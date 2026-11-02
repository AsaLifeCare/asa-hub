"""The people still added in Google, brought into the Hub's own lists by the essential sweep (the operator, 2026-10-28:
"quando alguém for adicionado subimos aqui também até as pessoas passarem a usar a plataforma com mais afinco").

The sweep lays the Asa Employee Database's and the Asa Client Database's Master tabs on their tables (empMaster,
bk1fTi78Master), but the Staff app lists the People house and the Clients app the clients house: a name added only in
Google stood in its book's table and in no list. Each sweep, after the tabs are laid and under the same write, every
Master row whose name (first and last) neither list holds yet is added to it, as the Hub's own doors add one — a People
row (roster_sync's id law) and a clients row (clientCreate's), with the book's status, house and contacts. A name the
Hub already holds is never touched, nothing is ever taken out, and a one-word name (the platform's own account) is no
person."""
from __future__ import annotations

import re
from typing import Any

import clients as C
import gsjs
import locations as L
import resource_rows as RR
import smart_comms as SC
import staff as SP
import writes as W

EMPLOYEES, CLIENTS = "empMaster", "bk1fTi78Master"
BY = "essential sheets sweep (new in the book)"
# the Employee Database's Status column, as the People house says it
EMP_STATUS = {"yes": "active", "no": "inactive", "admin": "admin", "pending": "pending", "other": "other"}

s_ = gsjs.str_


def _name(v: Any) -> str:
    return re.sub(r"\s+", " ", s_(v)).strip()


def _person(name: str) -> bool:
    """A first and a last name: the platform's own one-word account is no person."""
    return len(name.split(" ")) >= 2


def _fold(name: str) -> str:
    """roster_sync's id law: the name in lowercase, its spaces kept single."""
    return name.lower()


def _client_key(name: str) -> str:
    """The plan's way of keying a client: first_last."""
    return re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")


def _laid(reads: L.Reads, tab: str, rid: str, subject: str, rec: dict[str, Any], cur: Any) -> None:
    """One row appended to a house, as its own door appends it: kept as the house's record, laid on its table."""
    sid, where = W.where_of(W.tab_of(reads, tab))
    write_id = s_((SC._WRITE.get() or {}).get("write_id")) or "essential-sweep"
    W.into_tables(cur, write_id, [W.kept_record(sid, where, "append", "id", rid, subject, rec)], BY)


def new_people(reads: L.Reads) -> list[dict[str, Any]]:
    """The People rows the Employee Database's Master names and the People house does not hold yet."""
    held = {gsjs.name_key(p.get("name")) for p in SP._people(reads) if s_(p.get("name"))}
    now = W.now_iso(reads)
    out = []
    for _key, c in RR.table_rows(reads, EMPLOYEES):
        name = _name(c.get("Employee")) or _name(s_(c.get("First Name")) + " " + s_(c.get("Last Name")))
        k = gsjs.name_key(name)
        if not _person(name) or not k or k in held:
            continue
        held.add(k)
        parts = name.split(" ")
        out.append({"id": "PPL_" + _fold(name), "name": name,
                    "first_name": _name(c.get("First Name")) or parts[0],
                    "last_name": _name(c.get("Last Name")) or " ".join(parts[1:]), "role": "",
                    "status": EMP_STATUS.get(s_(c.get("Status")).strip().lower(), "unknown"),
                    "email": s_(c.get("Email")), "phone": s_(c.get("Phone Number")), "city": s_(c.get("City")),
                    "state": s_(c.get("State")), "employee_id": s_(c.get("Employee ID")),
                    "start_date": s_(c.get("Start Date (first day)")), "end_date": s_(c.get("End Date\n(last day)")),
                    "source": "Employee Database", "external_id": _fold(name), "updated_at": now})
    return out


def new_clients(reads: L.Reads) -> list[dict[str, Any]]:
    """The clients rows the Client Database's Master names and the clients house does not hold yet."""
    held: set[str] = set()
    for r in C._hub(reads, "clients"):
        held |= {gsjs.name_key(r.get("client_key")), gsjs.name_key(r.get("name"))}
    held.discard("")
    now = W.now_iso(reads)
    out = []
    for _key, c in RR.table_rows(reads, CLIENTS):
        name = _name(c.get("Client"))
        if not _person(name) or gsjs.name_key(name) in held:
            continue
        held.add(gsjs.name_key(name))
        key = _client_key(name)
        out.append({"id": "CLI_" + key, "client_key": key, "name": name, "house": s_(c.get("House")),
                    "houseName": s_(c.get("House")), "status": s_(c.get("Status")).strip().lower() or "active",
                    "start_date": s_(c.get("Start Date")), "client_number": s_(c.get("Client #")),
                    "clientNumber": s_(c.get("Client #")), "guardianName": s_(c.get("Guardian")),
                    "source_book": "Asa Client Database", "created_by": BY, "createdAt": now, "updatedAt": now})
    return out


def register(reads: L.Reads, cur: Any) -> dict[str, Any]:
    """Every name new in the two books added to its Hub list, under the sweep's write; who was added, by name."""
    out: dict[str, Any] = {"people": [], "clients": []}
    for rec in new_people(reads):
        _laid(reads, "people", rec["id"], gsjs.name_key(rec["name"]), rec, cur)
        out["people"].append(rec["name"])
    for rec in new_clients(reads):
        _laid(reads, "clients", rec["id"], rec["client_key"], rec, cur)
        out["clients"].append(rec["name"])
    return out
