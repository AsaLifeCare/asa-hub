"""The house calendars' live copy and the company lines read off asa-hub-db's own tables, and the call reading the
Hub's own module, on the live copy in asa-hub-db.
- A statement naming app.asa_house_calendar_live or app.asa_openphone_lines, sent on the connection the lanes open for
  the old platform, answers asa-hub-db's rows (lanes_pg._HUB_KEPT), and My Work's reader of the live copy does too.
- Every reader of the company lines answers off app.asa_openphone_lines: the Hotline's, the reply ear's and the Line
  Directory's hand-off.
- The call reading is app/comm_calls_reading.py: its pile is read off the Transcripts copy, and the lane's status
  counts what is left there.
Only reads are run; no word of a call is printed.

From the repo root:

    RUNNER=<scratchpad> python3 tools/test-hub-kept-tables.py
"""
import json
import os
import subprocess
import sys

if not os.environ.get("HUB_KEPT_INPROC"):
    runner = os.environ["RUNNER"]
    here = os.path.join(runner, "test_hub_kept_tables.py")
    with open(here, "w", encoding="utf-8") as fh, open(__file__, encoding="utf-8") as me:
        fh.write(me.read())
    with open("app/front_door_routes.json", encoding="utf-8") as fh:
        routes = fh.read()
    out = subprocess.run(["sh", os.path.join(runner, "run.sh"), os.path.abspath("app"), here,
                          json.dumps({"HUB_KEPT_INPROC": "1", "FD_ROUTES": routes})], capture_output=True, text=True,
                         timeout=600)
    sys.stdout.write(out.stdout[-4000:])
    sys.stderr.write(out.stderr[-2000:])
    sys.exit(1 if out.returncode or '"failed": []' not in out.stdout else 0)

import tempfile  # noqa: E402
import types  # noqa: E402

import psycopg  # noqa: E402

# the front door's routes the clocks load, handed in from the tree
_WORK = tempfile.mkdtemp(prefix="hub-kept-")
with open(_WORK + "/routes.json", "w", encoding="utf-8") as _fh:
    _fh.write(os.environ.pop("FD_ROUTES"))
os.environ["HUB_FRONT_DOOR_ROUTES"] = _WORK + "/routes.json"

# the web framework the clocks import, which this container does not carry: only names, never served
_fa, _fr, _sc = (types.ModuleType(n) for n in ("fastapi", "fastapi.responses", "starlette.concurrency"))
_fa.Request = _fr.JSONResponse = _fr.Response = object
_sc.run_in_threadpool = None
sys.modules.update({"fastapi": _fa, "fastapi.responses": _fr, "starlette": types.ModuleType("starlette"),
                    "starlette.concurrency": _sc})

import comm_calls_feed as CCF  # noqa: E402
import hotline_calls  # noqa: E402
import hubdb  # noqa: E402
import lanes_pg  # noqa: E402
import mw_relay_state  # noqa: E402
import sms_contacts  # noqa: E402
import staff_feeds  # noqa: E402

results: dict[str, str] = {}
facts: dict[str, object] = {}


def check(name: str, ok: bool, why: object = "") -> None:
    results[name] = "ok" if ok else f"FAIL {str(why)[:240]}"


# the lanes' own connection on asa-hub-db, read-only here: the runner holds no writer's door
lanes_pg.CONNECT["own"] = lanes_pg.CONNECT["spare"] = lambda: psycopg.connect(hubdb._dsn(), autocommit=True)  # noqa: SLF001
db = hubdb.shared()
live = db.dict_rows("select location, updated_at from app.asa_house_calendar_live order by location")
lines = db.dict_rows("select id, number from app.asa_openphone_lines order by id")
facts["houses in the live copy"], facts["company lines"] = len(live), len(lines)
check("asa-hub-db holds the live copy and the lines", bool(live) and bool(lines))

with lanes_pg.connect("the old platform") as conn, conn.cursor(cursor_factory=lanes_pg.RealDictCursor) as cur:
    cur.execute("SELECT location, updated_at FROM asa_house_calendar_live ORDER BY location")
    got = [dict(r) for r in cur.fetchall()]
    cur.execute("SELECT to_regclass('asa_house_calendar_live') IS NOT NULL AS ok")
    there = cur.fetchone()["ok"]
    cur.execute("SELECT id, number FROM public.asa_openphone_lines ORDER BY id")
    got_lines = [dict(r) for r in cur.fetchall()]
check("the lanes' the old platform connection reads the live copy off asa-hub-db",
      [(r["location"], r["updated_at"]) for r in got] == [(r["location"], r["updated_at"]) for r in live] and there)
check("and the lines", [(r["id"], r["number"]) for r in got_lines] == [(r["id"], r["number"]) for r in lines])
mine = mw_relay_state.rows("asa_house_calendar_live", columns=("location", "updated_at"))
check("My Work's reader of the live copy reads asa-hub-db's",
      sorted((r["location"], r["updated_at"]) for r in mine) == [(r["location"], r["updated_at"]) for r in live])

(names, ids), n = hotline_calls._read_directory()  # noqa: SLF001
check("the Hotline's line directory reads the kept lines", n == len(lines) and bool(names), n)
(names2, _ids2), n2 = sms_contacts._read_directory("")  # noqa: SLF001
check("the reply ear's too", n2 == len(lines) and names2 == names, n2)
body = staff_feeds.lines_payload()
facts["lines handed to the Line Directory"] = len(body["rows"])
check("the Line Directory's hand-off reads them (the provider's refresh is the app's own key)",
      0 < len(body["rows"]) <= len(lines) and bool(body["source_at"]), body.get("source_at"))

reading = CCF.reading()
check("the call reading is the Hub's own module", reading.__name__ == "comm_calls_reading"
      and all(hasattr(reading, a) for a in ("ask", "parse", "project", "unreadable", "window", "fits", "stamp")))
check("nothing of it reads the old platform", not hasattr(reading, "pile") and not hasattr(reading, "MIRROR"))
piled = CCF.pile(limit=3)
facts["calls the pile offers (of 3 asked)"] = len(piled)
check("its pile is read off the Transcripts copy", isinstance(piled, list)
      and all(set(p) >= {"call_id", "full_transcript"} for p in piled))
del piled
status = CCF.status("")
facts["calls left to read"] = status.get("remaining")
check("the lane's status counts what is left on the Transcripts copy", "error" not in status
      and isinstance(status.get("remaining"), int), status.get("error"))

print(json.dumps({"facts": facts, "results": results,
                  "failed": [k for k, v in results.items() if v != "ok"]}, indent=1, default=str))
