"""The company's own phone lines (the old platform's openphone_contacts._upsert_lines, translated): the provider's
listing (GET /v1/phone-numbers, through the Quo pull's own door and key) kept in asa-hub-db's app.asa_openphone_lines,
each line upserted as it is listed. Every reader of the lines reads that table (staff_feeds, hotline_calls,
sms_contacts, comm_calls_door, comm_when_reading)."""
from __future__ import annotations

import json
import logging
from typing import Any

import lanes_db as hub_db
import quo_pull

log = logging.getLogger("asa-hub-app")

TABLE = "app.asa_openphone_lines"


def listed() -> list[dict[str, Any]]:
    """The provider's lines as it lists them, every page. Raises when it cannot be asked or lists none: a list with no
    lines in it is not a company with no lines."""
    lines = [p for p in quo_pull._pages("/phone-numbers", []) if str(p.get("id") or "")]  # noqa: SLF001
    if not lines:
        raise RuntimeError("the provider listed no lines — refused rather than kept as 'we own none'")
    return lines


def row_of(line: dict[str, Any]) -> tuple[str, str, str, str, str, str]:
    """(id, name, number, formatted number, assigned users as JSON, forward) as the table keeps a line."""
    users = [{"id": u.get("id", ""), "name": f"{u.get('firstName', '')} {u.get('lastName', '')}".strip(),
              "email": u.get("email", ""), "role": u.get("role", "")}
             for u in line.get("users") or [] if isinstance(u, dict)]
    forward = line.get("forward") or ""
    return (str(line.get("id") or ""), str(line.get("name") or ""), str(line.get("number") or ""),
            str(line.get("formattedNumber") or ""), json.dumps(users),
            forward if isinstance(forward, str) else json.dumps(forward))


def refresh() -> int:
    """Blocking: every listed line upserted in one commit; how many."""
    lines = listed()
    with hub_db.connect() as conn, conn.cursor() as cur:
        for line in lines:
            cur.execute(f"insert into {TABLE} (id, name, number, formatted_number, assigned_users, forward_to,"  # noqa: S608
                        " synced_at) values (%s, %s, %s, %s, %s::jsonb, %s, now()) on conflict (id) do update set"
                        " name = excluded.name, number = excluded.number,"
                        " formatted_number = excluded.formatted_number, assigned_users = excluded.assigned_users,"
                        " forward_to = excluded.forward_to, synced_at = now()", row_of(line))
    log.info("company lines: %d line(s) kept from the provider", len(lines))
    return len(lines)
