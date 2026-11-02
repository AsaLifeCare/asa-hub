"""The lanes' tables in asa-hub-db's schema app. The lanes write their statements with the names those tables had in the
old platform's database (`asa_users`, `public.asa_alerts`, `ops.employees`); since 2026-10-27 those records are the
Hub's own (db/lane_tables.sql, filled once by tools/take-lane-tables.py), beside the relay's tables moved before them.
`here` names each of them in schema app, so every statement runs on asa-hub-db. Text inside quotes is never touched."""
from __future__ import annotations

import re

# the records taken in, in app.* under the same names
TAKEN = frozenset({
    "asa_alerts", "asa_client_financial_txns", "asa_client_meds", "asa_cortex_dialog_messages", "asa_entity_aliases",
    "asa_entity_facts", "asa_entity_relationships", "asa_finance_doc", "asa_finance_summary", "asa_invoice_catalog",
    "asa_isp_chat", "asa_med_deliveries", "asa_med_pictures", "asa_psi_time_entries", "asa_users",
    "asa_workforce_analysis", "asa_workforce_insights"})
# ops.<name> as the statements name them, app.ops_<name> here
OPS = frozenset({"employees", "identity_overrides"})

_QUOTED = re.compile(r"('(?:[^']|'')*'|\"[^\"]*\")")
# any asa_* table, bare or under public. (the relay's own and the kept copies live in app.* too); app. stays as it is
_ASA = re.compile(r"(?<![\w.$])(?:public\.)?(asa_[a-z0-9_]+)\b(?!\s*\()", re.I)
_OPS = re.compile(r"(?<![\w.$])ops\.(" + "|".join(sorted(OPS)) + r")\b", re.I)


def here(sql: str) -> str:
    """The statement with every asa_* table and ops.employees / ops.identity_overrides named in asa-hub-db's app."""
    parts = _QUOTED.split(sql)
    for i in range(0, len(parts), 2):
        parts[i] = _OPS.sub(lambda m: f"app.ops_{m.group(1).lower()}", _ASA.sub(r"app.\1", parts[i]))
    return "".join(parts)
