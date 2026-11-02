"""Families' own registry (db/families.sql): the family members a director or the master registers, the clients they
are family of, their papers and every step since — kept in the Hub's own tables, never in a sheet. Reads go through
asa-hub-db's reader; writes take the cursor of the write being decided (writes.HELD), so a refused or failed write
leaves none of its rows."""
from __future__ import annotations

import json
from datetime import datetime
from typing import Any

import gsjs
import hubdb
import locations as L
from writes import HELD

FAMILIES = "app.families"
CLIENTS = "app.family_clients"
DOCUMENTS = "app.family_documents"
EVENTS = "app.family_events"
SOURCE = "registry"


def _iso(v: Any) -> str:
    return gsjs.iso(v) if isinstance(v, datetime) else gsjs.or_text(v)


def _rows(reads: L.Reads, sql: str, params: tuple = ()) -> list[tuple]:
    cur = HELD.get()
    if cur is not None:
        cur.execute(sql, params)
        return list(cur.fetchall())
    return reads.db.query(sql, params)


def registry(reads: L.Reads) -> dict[str, dict[str, Any]]:
    """Every registered family member not removed, by key, each with the clients it is family of."""
    def read() -> dict[str, dict[str, Any]]:
        out: dict[str, dict[str, Any]] = {}
        for (key, name, rel, phone, mail, addr, pref, notes, folder, by, by_name, at) in _rows(
                reads, f"select family_key, name, relationship, phone, email, address, preferred_contact, notes,"
                       f" drive_folder_id, created_by, created_by_name, created_at from {FAMILIES}"
                       " where removed_at is null order by created_at"):
            out[key] = {"key": key, "name": name, "relationship": rel, "phone": phone, "email": mail, "address": addr,
                        "preferred_contact": pref, "notes": notes, "drive_folder_id": folder, "created_by": by,
                        "created_by_name": by_name, "created_at": _iso(at), "clients": []}
        for key, client, rel, guardian in _rows(
                reads, f"select family_key, client_key, relationship, is_guardian from {CLIENTS}"
                       " where removed_at is null order by created_at"):
            if key in out:
                out[key]["clients"].append({"client_key": client, "relationship": rel, "guardian": bool(guardian)})
        return out
    return reads.once("fam_registry", read)


def documents(reads: L.Reads, key: str) -> list[dict[str, Any]]:
    """One family member's papers in the registry, newest first."""
    return [{"id": str(i), "drive_id": fid, "name": name, "doc_type": kind, "mime": mime, "size": int(size or 0),
             "source": src, "added_by": by_name or by, "added_at": _iso(at)}
            for (i, fid, name, kind, mime, size, src, by, by_name, at) in _rows(
                reads, f"select id, drive_id, name, doc_type, mime_type, size_bytes, source, added_by, added_by_name,"
                       f" added_at from {DOCUMENTS} where family_key = %s and removed_at is null"
                       " order by added_at desc", (key,))]


def events(reads: L.Reads, key: str) -> list[dict[str, Any]]:
    """Every step since the family member was registered, newest first."""
    out = []
    for i, kind, ttl, detail, by_name, by, at in _rows(
            reads, f"select id, kind, title, detail, by_name, by_account, at from {EVENTS} where family_key = %s"
                   " order by at desc, id desc", (key,)):
        d = detail if isinstance(detail, dict) else json.loads(detail or "{}")
        out.append({"id": str(i), "kind": kind, "title": ttl, "body": gsjs.or_text(d.get("text")),
                    "client_key": gsjs.or_text(d.get("client_key")), "by": by_name or by, "at": _iso(at)})
    return out


def _cur() -> Any:
    cur = HELD.get()
    if cur is None:
        raise hubdb.Unreadable("a registry write is kept only under the platform's write lock")
    return cur


def exists(key: str) -> bool:
    """Whether this key is registered and not removed (under the write lock)."""
    cur = _cur()
    cur.execute(f"select 1 from {FAMILIES} where family_key = %s and removed_at is null", (key,))
    return cur.fetchone() is not None


def add_family(row: dict[str, Any], clients: list[dict[str, Any]], by: str, by_name: str) -> None:
    """The family member, and each client it is family of, kept under the write being decided."""
    cur = _cur()
    cur.execute(f"insert into {FAMILIES} (family_key, name, relationship, phone, email, address, preferred_contact,"
                " notes, created_by, created_by_name, updated_by) values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)"
                " on conflict (family_key) do update set name = excluded.name, relationship = excluded.relationship,"
                " phone = excluded.phone, email = excluded.email, address = excluded.address,"
                " preferred_contact = excluded.preferred_contact, notes = excluded.notes, updated_by = excluded.updated_by,"
                " updated_at = now(), removed_at = null, removed_by = ''",
                (row["key"], row["name"], row["relationship"], row["phone"], row["email"], row["address"],
                 row["preferred_contact"], row["notes"], by, by_name, by))
    for c in clients:
        cur.execute(f"insert into {CLIENTS} (family_key, client_key, relationship, is_guardian, created_by)"
                    " values (%s, %s, %s, %s, %s) on conflict (family_key, client_key) do update set"
                    " relationship = excluded.relationship, is_guardian = excluded.is_guardian, removed_at = null",
                    (row["key"], c["client_key"], c["relationship"], bool(c["guardian"]), by))


def add_document(key: str, doc: dict[str, Any], by: str, by_name: str) -> str:
    """One paper on the family member; its id."""
    cur = _cur()
    cur.execute(f"insert into {DOCUMENTS} (family_key, drive_id, name, doc_type, mime_type, size_bytes, source, added_by,"
                " added_by_name) values (%s, %s, %s, %s, %s, %s, %s, %s, %s) returning id",
                (key, doc["drive_id"], doc["name"], doc["doc_type"], doc["mime"], int(doc.get("size") or 0),
                 doc["source"], by, by_name))
    return str(cur.fetchone()[0])


def add_event(key: str, kind: str, ttl: str, detail: dict[str, Any], by: str, by_name: str) -> None:
    """One step on the family member's Activity."""
    _cur().execute(f"insert into {EVENTS} (family_key, kind, title, detail, by_account, by_name)"
                   " values (%s, %s, %s, %s::jsonb, %s, %s)", (key, kind, ttl, json.dumps(detail), by, by_name))
