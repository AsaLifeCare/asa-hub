"""The company's phone lines, derived from the platform's own copy.
WHY THIS FILE EXISTS -------------------- Apps Script answered three different phone-line questions out of one…"""

from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path
from typing import Any

try:
    import psycopg2
    import psycopg2.extras
except Exception:  # pragma: no cover - the caller is told, never guessed at
    psycopg2 = None  # type: ignore[assignment]


LINES_TABLE = os.getenv("HUB_LINES_TABLE", "public.asa_openphone_lines")

#: The transcript mirror.  Measured there: 1630 rows, 49 with no usable line.
TRANSCRIPTS_TABLE = os.getenv(
    "HUB_LINES_TRANSCRIPTS_TABLE",
    "public.asa_sheet_c_1nkyz24etg4woyishmkouj__transcripts_4db256",
)

#: Never a line, whatever any source says — a person's own number.
NEVER_A_LINE = {"3303440430"}

# : Provider seats that are logins, not people.
SERVICE_SEATS = {"abd documents", "asa tech", "asatech", "automations", "api", "integration"}

# : Where the Apps Script declaration lives.
TALENT_GS = Path(
    os.getenv("HUB_TALENT_GS")
    or (Path(__file__).resolve().parent.parent / "apps-script" / "Talent.gs")
)


class LinesUnavailable(RuntimeError):
    """The source could not be read.  NOT an empty directory."""


def _dsn() -> str:
    dsn = os.getenv("HUB_SNAPSHOT_PG_DSN") or os.getenv("DATABASE_URL") or ""
    if not dsn:
        raise LinesUnavailable("HUB_SNAPSHOT_PG_DSN is not set — the lines were not read")
    return dsn


def _connect():
    if psycopg2 is None:
        raise LinesUnavailable("psycopg2 is not importable in this process")
    return psycopg2.connect(_dsn())


def digits(value: Any) -> str:
    """Last ten digits — the key every reader of a number in this platform computes, so a line typed "+1 (330)…"""
    d = re.sub(r"\D+", "", str(value or ""))
    if len(d) >= 11 and d.startswith("1"):
        d = d[1:]
    d = d[-10:]
    return d if len(d) == 10 else ""


def is_provider_id(value: Any) -> bool:
    return bool(re.fullmatch(r"PN[A-Za-z0-9]{6,}", str(value or "").strip()))


def declared_shared_floor() -> dict[str, Any]:
    """The digits Talent.gs declares, read out of the file itself."""
    try:
        src = TALENT_GS.read_text(encoding="utf-8")
    except OSError as exc:
        return {"known": False, "digits": [], "why": f"{TALENT_GS} could not be read ({exc})"}
    m = re.search(r"var\s+SHARED_LINE_DIGITS\s*=\s*\[([^\]]*)\]", src)
    if not m:
        return {"known": False, "digits": [], "why": "SHARED_LINE_DIGITS is not declared in Talent.gs"}
    out = [digits(x) for x in re.findall(r"'([^']*)'", m.group(1))]
    return {"known": True, "digits": [d for d in out if d], "why": ""}


def _rows_from_db() -> list[dict[str, Any]]:
    with _connect() as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            f"select id, name, number, assigned_users, forward_to, synced_at "
            f"from {LINES_TABLE} order by number"  # noqa: S608 - table name is config, not input
        )
        rows = [dict(r) for r in cur.fetchall()]
    if not rows:
        # A table with no rows is not a company with no lines.
        raise LinesUnavailable(f"{LINES_TABLE} holds no rows — refused rather than answered as 'we own none'")
    return rows


def _people(assigned: Any) -> list[dict[str, Any]]:
    if isinstance(assigned, str):
        try:
            assigned = json.loads(assigned)
        except ValueError:
            assigned = []
    out: list[dict[str, Any]] = []
    for u in assigned or []:
        if not isinstance(u, dict):
            continue
        name = str(u.get("name") or u.get("email") or "").strip()
        if not name:
            continue
        out.append(
            {
                "name": name,
                "role": str(u.get("role") or "").lower(),
                "service": name.lower() in SERVICE_SEATS,
            }
        )
    return out


def build() -> dict[str, Any]:
    """The directory.  Raises LinesUnavailable rather than answering empty."""
    raw = _rows_from_db()
    declared = declared_shared_floor()
    floor = declared["digits"]

    lines: list[dict[str, Any]] = []
    for r in raw:
        d = digits(r.get("number"))
        if not d or d in NEVER_A_LINE:
            continue
        people = _people(r.get("assigned_users"))
        humans = [p for p in people if not p["service"]]
        owner_named = next((p["name"] for p in humans if p["role"] == "owner"), "")
        lines.append(
            {
                "digits": d,
                "e164": "+1" + d,
                "id": str(r.get("id") or ""),
                "name": str(r.get("name") or ""),
                # The provider's own word, or nothing.
                "owner": owner_named or (humans[0]["name"] if len(humans) == 1 else ""),
                "people": people,
                "seats": len(people),
                "humans": len(humans),
                "forward_to": digits(r.get("forward_to")),
                "forwards_from": "",
                # The role is a human's word and lives in the Hub.
                "role": "",
                "role_home": "apps-script/LineDirectory.gs LINE_ROLE_WORDS",
                "shared": False,
                "shared_why": "",
                "synced_at": str(r.get("synced_at") or ""),
            }
        )

    forward_targets = {ln["forward_to"]: ln["digits"] for ln in lines if ln["forward_to"]}
    for ln in lines:
        why = []
        if ln["humans"] > 1:
            why.append(f"{ln['humans']} people hold it")
        if ln["digits"] in forward_targets:
            ln["forwards_from"] = forward_targets[ln["digits"]]
            why.append(f"+1{forward_targets[ln['digits']]} forwards to it")
        if ln["digits"] in floor:
            why.append("declared a shared line")
        ln["shared"] = bool(why)
        ln["shared_why"] = " · ".join(why)

    return {
        "ok": True,
        "source": LINES_TABLE,
        "lines": lines,
        "shared_floor": floor,
        "shared_floor_known": declared["known"],
        "shared_floor_why": declared["why"],
        "never": sorted(NEVER_A_LINE),
    }


def census(directory: dict[str, Any] | None = None) -> dict[str, Any]:
    """Calls with no usable line, counted and NAMED."""
    directory = directory or build()
    by_id = {ln["id"]: ln for ln in directory["lines"] if ln["id"]}
    by_digits = {ln["digits"]: ln for ln in directory["lines"]}

    with _connect() as conn, conn.cursor() as cur:
        cur.execute(f"select coalesce(quo_number, '') from {TRANSCRIPTS_TABLE}")  # noqa: S608
        cells = [row[0] for row in cur.fetchall()]

    total = len(cells)
    per_line: dict[str, int] = {}
    empty = 0
    by_provider_id: dict[str, dict[str, Any]] = {}
    for cell in cells:
        d = digits(cell)
        if not d:
            raw = str(cell).strip()
            if is_provider_id(raw):
                seen = by_provider_id.setdefault(
                    raw,
                    {
                        "calls": 0,
                        "resolves_to": by_id[raw]["e164"] if raw in by_id else "",
                        "named": (by_id[raw]["name"] or by_id[raw]["owner"]) if raw in by_id else "",
                    },
                )
                seen["calls"] += 1
                if raw in by_id:
                    d = by_id[raw]["digits"]
            else:
                empty += 1
        if d:
            per_line[d] = per_line.get(d, 0) + 1

    repaired = sum(v["calls"] for v in by_provider_id.values() if v["resolves_to"])
    return {
        "ok": True,
        "source": TRANSCRIPTS_TABLE,
        "calls": total,
        "by_line": [
            {
                "e164": "+1" + d,
                "calls": n,
                "name": by_digits[d]["name"] if d in by_digits else "",
                "owner": by_digits[d]["owner"] if d in by_digits else "",
                "ours": d in by_digits,
                "shared": bool(by_digits[d]["shared"]) if d in by_digits else False,
            }
            for d, n in sorted(per_line.items(), key=lambda kv: -kv[1])
        ],
        "no_line": {
            "calls": empty + sum(v["calls"] for v in by_provider_id.values()),
            "empty": empty,
            "carrying_a_provider_id": by_provider_id,
            "repaired": repaired,
        },
    }


def payload() -> dict[str, Any]:
    """What ``lineDirectorySync`` accepts: RAW rows, plus when they were read."""
    raw = _rows_from_db()
    rows = []
    newest = ""
    for r in raw:
        d = digits(r.get("number"))
        if not d or d in NEVER_A_LINE:
            continue
        at = str(r.get("synced_at") or "")
        newest = max(newest, at)
        rows.append(
            {
                "id": str(r.get("id") or ""),
                "number": str(r.get("number") or ""),
                "name": str(r.get("name") or ""),
                "assigned_users": r.get("assigned_users") or [],
                "forward_to": str(r.get("forward_to") or ""),
            }
        )
    return {"action": "lineDirectorySync", "payload": {"rows": rows, "source_at": newest}}


def check_declaration() -> dict[str, Any]:
    """Does the derivation still reproduce the hand-typed declaration?"""
    d = build()
    derived = sorted(ln["digits"] for ln in d["lines"] if ln["shared"])
    # THE CHECK MUST NOT ASK A QUESTION WHOSE ANSWER IT HAS ALREADY SUPPLIED.
    independent = sorted(ln["digits"] for ln in d["lines"]
                         if ln["humans"] > 1 or ln["forwards_from"])
    floor = sorted(d["shared_floor"])
    if not d["shared_floor_known"]:
        # Not "they agree" and not "they differ": the question could not be asked, and that is its own answer.
        return {
            "derived_shared": derived,
            "derived_without_the_declaration": independent,
            "declared_shared": [],
            "reproduces_declaration": None,
            "why": d["shared_floor_why"],
            "added_by_derivation": [],
            "lost_by_derivation": [],
        }
    return {
        # what the platform actually answers with (the floor included)
        "derived_shared": derived,
        # what the data alone says — the only number the claim can be tested on
        "derived_without_the_declaration": independent,
        "declared_shared": floor,
        "reproduces_declaration": independent == floor,
        "why": "",
        "added_by_derivation": sorted(set(independent) - set(floor)),
        "lost_by_derivation": sorted(set(floor) - set(independent)),
    }


def _report() -> int:
    try:
        d = build()
    except LinesUnavailable as exc:
        # The failure is the answer.  It is never printed as an empty list.
        print(f"COULD NOT READ THE LINES: {exc}", file=sys.stderr)
        return 2
    print(f"THE LINES — {len(d['lines'])} from {d['source']}")
    if not d["shared_floor_known"]:
        # THE FLOOR IS THE ONE RULE THIS MODULE CALLS UNCONDITIONAL, AND IN THE RELAY CONTAINER IT IS ABSENT BY…
        print("  !! THE DECLARED FLOOR WAS NOT APPLIED: " + d["shared_floor_why"])
        print("     Every verdict below is the derivation ALONE. The Hub keeps its own "
              "compiled floor (SHARED_LINE_DIGITS) and re-derives on the rows this "
              "module sends, so the identity law is not what is at risk here — this "
              "report is. Set HUB_TALENT_GS to check it from inside the container.")
    for ln in d["lines"]:
        role = "role lives in the Hub (LINE_ROLE_WORDS)"
        who = ln["owner"] or f"{ln['humans']} people, no single owner"
        verdict = f"SHARED — {ln['shared_why']}" if ln["shared"] else "personal"
        print(
            f"  {ln['e164']}  {ln['name']:<20} {who:<28} "
            f"seats={ln['seats']} humans={ln['humans']}  {verdict}"
        )
    print(f"  never a line: {', '.join(d['never'])} (a person's own number)")

    chk = check_declaration()
    if chk["reproduces_declaration"] is None:
        print(f"\nAGREEMENT WITH Talent.gs: NOT CHECKED — {chk['why']}")
        print(f"  derived={','.join(chk['derived_shared'])} (the declaration could not be read)")
    else:
        print(
            f"\nAGREEMENT WITH Talent.gs: derived={','.join(chk['derived_without_the_declaration'])} "
            f"(from the data alone, the declaration excluded) "
            f"declared={','.join(chk['declared_shared'])} "
            f"reproduces={chk['reproduces_declaration']}"
        )
    if chk["added_by_derivation"]:
        print(f"  the derivation ADDS: {', '.join(chk['added_by_derivation'])}")
    if chk["lost_by_derivation"]:
        print(f"  !! the derivation LOSES: {', '.join(chk['lost_by_derivation'])} — the floor must hold it")

    try:
        c = census(d)
    except LinesUnavailable as exc:
        print(f"\nCOULD NOT READ THE CALLS: {exc}", file=sys.stderr)
        return 3
    print(f"\nTHE CALLS — {c['calls']} rows in {c['source']}")
    for row in c["by_line"]:
        tag = "shared" if row["shared"] else ("personal" if row["ours"] else "NOT ONE OF OURS")
        print(f"  {row['e164']}  {row['calls']:>5}  {row['name'] or '—':<20} {tag}")
    nl = c["no_line"]
    print(f"\n  CALLS CARRYING NO LINE: {nl['calls']} — and they are not one thing:")
    print(f"    {nl['empty']} rows carry nothing at all: nobody can say which line they arrived on")
    for pid, seen in sorted(nl["carrying_a_provider_id"].items()):
        where = f"{seen['resolves_to']} {seen['named']}" if seen["resolves_to"] else "resolves to no line we know"
        print(f"    {seen['calls']} row(s) carry the provider line id {pid} → {where}")
    print(f"    {nl['repaired']} of them are repaired by the directory; the rest stay counted, never zeroed")
    return 0


if __name__ == "__main__":
    if "--payload" in sys.argv:
        try:
            print(json.dumps(payload(), indent=2, default=str))
        except LinesUnavailable as exc:
            print(f"COULD NOT BUILD THE PAYLOAD: {exc}", file=sys.stderr)
            raise SystemExit(2)
        raise SystemExit(0)
    raise SystemExit(_report())
