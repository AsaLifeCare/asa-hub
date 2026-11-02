"""The relay's hub_db as the scheduling lanes call it: its own tables in asa-hub-db, the old platform's beside them,
over lanes_pg's connections."""
from __future__ import annotations

from lanes_pg import OwnConn as _Conn, beside, intel, own, own_connect as connect  # noqa: F401 - the lanes' names

SCHEMA = "app"


def on() -> bool:
    """The relay's own tables are asa-hub-db's."""
    return True


def schema() -> str:
    return SCHEMA
