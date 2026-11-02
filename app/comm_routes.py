"""What the cortex knows about reaching each person (CommCortex.gs, the comm_routes house): the hours their own shifts
say they are awake and the supervisor the graph suggests, never a contact value. While the relay's hourly hand-off is
Apps Script's the house is the tab's copy; once it is Python's (comm_routes_writes.py, commRoutesIngest) the house lives
in Postgres (app/resource_rows.py `commRoutesHouse`, uploaded from that copy on the flip). routes and route_of are
commRecordRoutes_ and commRouteOf_ for the sweeps that narrow a window or name a supervisor by it, read from wherever
the house is now."""
from __future__ import annotations

from typing import Any, Callable

import gsjs
import hubdb
import locations as L
import resource_rows as RR

APP_ID = "comm-routes"
RESOURCE = "commRoutesHouse"
TAB = "comm_routes"
# CommCortex.gs COMM_ROUTES_HEADER
HEADER = ("id", "createdAt", "updatedAt", "person_key", "name", "window_from", "window_to", "window_why",
          "supervisor", "supervisor_key", "supervisor_confidence", "source_at")
# COMM_ROUTES_RETIRED: the columns this house no longer carries, held empty on every pass
RETIRED = ("phone", "email", "phones_known", "emails_known")


def kept(reads: L.Reads) -> bool:
    """The house is Postgres' (uploaded on the flip, not handed back since)."""
    return reads.once("comm_routes_kept", lambda: RR.uploaded(reads.db, RESOURCE))


def board_rows(reads: L.Reads) -> list[dict[str, Any]]:
    """commBoardRows_(COMM_ROUTES_TAB): every row with anything in it, header-keyed, each cell as getValues hands it
    back; none when the house has no tab."""
    if kept(reads):
        cols = RR.columns(reads, RESOURCE)
        got = [{h: hubdb.typed(c.get(h), "hub") for h in cols} for _k, c in RR.table_rows(reads, RESOURCE)]
    else:
        res = reads.db.resolve(TAB)
        if res.runtime or res.ref is None:
            return []
        heads = [h for h in res.ref.headers if h != ""]
        got = [{h: hubdb.typed(raw.get(h), "hub") for h in heads} for _rn, raw in reads.db.rows(res.ref)]
    return [r for r in got if any(v != "" and v is not None for v in r.values())]


def routes(reads: L.Reads) -> dict[str, dict[str, Any]]:
    """commRecordRoutes_: the cortex's route rows by person_key (trimmed, lower case), the first row of each — read
    once per request."""
    def read() -> dict[str, dict[str, Any]]:
        out: dict[str, dict[str, Any]] = {}
        for r in board_rows(reads):
            k = gsjs.trim(gsjs.or_text(r.get("person_key"))).lower()
            if k and k not in out:
                out[k] = r
        return out
    return reads.once("comm_routes", read)


def route_of(reads: L.Reads, person_key: Any) -> dict[str, Any] | None:
    """commRouteOf_: what the cortex offers for one person — their window and their suggested supervisor — or None."""
    who = gsjs.trim(gsjs.or_text(person_key)).lower()
    return routes(reads).get(who) if who else None


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {}
POLICY: dict[str, dict[str, Any]] = {}
