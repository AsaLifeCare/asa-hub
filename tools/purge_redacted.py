#!/usr/bin/env python3
"""
Take out of the two copies what the redaction will keep out from now on.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
# where the relay's uvicorn imports from, inside its container
RELAY_CODE = Path(os.getenv("HUB_RELAY_CODE_DIR", "/srv/app"))
BESIDE_ME = HERE.parent / "server"


def _code_dir(argv: list[str]) -> Path:
    """--code-dir, else the relay's own directory, else the one beside this script."""
    for i, arg in enumerate(argv):
        if arg == "--code-dir" and i + 1 < len(argv):
            return Path(argv[i + 1]).resolve()
        if arg.startswith("--code-dir="):
            return Path(arg.split("=", 1)[1]).resolve()
    return RELAY_CODE if (RELAY_CODE / "redaction.py").is_file() else BESIDE_ME


SERVER = _code_dir(sys.argv[1:])
sys.path.insert(0, str(SERVER))

# No rule to import is a refusal (exit 2), never a traceback.
try:
    import redaction  # noqa: E402
    NO_RULE = ""
except Exception as exc:  # noqa: BLE001
    redaction = None
    NO_RULE = (f"{SERVER}/redaction.py could not be imported ({type(exc).__name__})"
               " — there is no rule here to purge in front of")

DEFAULT_MASTER = Path(os.getenv(
    "HUB_MASTER_JSON_DIR",
    str(Path(os.getenv("HUB_SNAPSHOT_OUT", "/srv/snapshot")) / "master")))
MIRROR_TABLE = "asa_drive_sheets_rows"


def _process_start() -> float | None:
    """PID 1's start time, read as /proc/1's mtime; None without procfs."""
    try:
        return Path("/proc/1").stat().st_mtime
    except OSError:
        return None


def relay_loaded_it(dry: bool = False) -> list[str]:
    """Why the running relay has not imported the judged code.

    A RUN THAT CANNOT SEE THE RELAY CANNOT WRITE. The rule on disk and the rule
    the relay holds in memory are two different things: a purge in front of a
    relay that still imports the older module empties the copies, and the next
    keeper pass fills them again with the very cells that were taken out, with
    every check this tool prints green while it happens. Judging a freshly
    imported copy of the file proves nothing about the running process. So the
    order is restart first, purge second, and it is enforced here rather than
    remembered: inside the relay, the module files must be older than the
    relay's own process; from anywhere the relay is not visible, the only run
    allowed is --dry-run."""
    why: list[str] = []
    if not (RELAY_CODE / "redaction.py").is_file():
        if not dry:
            why.append(f"{RELAY_CODE}/redaction.py is not here, so this run cannot see"
                       " the relay it would purge in front of and cannot tell whether"
                       " that relay holds this rule or the one before it. Run it where"
                       " the relay's own code and process are (HUB_RELAY_CODE_DIR), or"
                       " pass --dry-run.")
        return why
    started = _process_start()
    if started is None:
        if not dry:
            why.append("/proc/1 could not be read, so the relay's start time is unknown"
                       " and restart-then-purge cannot be shown to have been kept."
                       " Pass --dry-run.")
        return why
    for name in ("redaction.py", "master_json.py", "hub_sheet_sync.py"):
        path = RELAY_CODE / name
        try:
            when = path.stat().st_mtime
        except OSError:
            continue           # code_can_redact already says it cannot read it
        if when > started:
            why.append(f"{path} was written {when - started:.0f}s AFTER this container's"
                       " process started — the running relay still holds the older"
                       " module. Restart it, then purge.")
    return why


def code_can_redact() -> list[str]:
    """An empty list is permission to run."""
    if NO_RULE:
        return [NO_RULE]
    why: list[str] = []
    rule = SERVER / "redaction.py"
    try:
        text = rule.read_text(encoding="utf-8")
    except OSError as exc:
        return [f"{rule} could not be read ({type(exc).__name__})"]
    if not redaction.redacts(text):
        why.append(f"{rule} is not a redaction that can withhold "
                   "(the markers, both rules and redact_row must all be in it)")
    for name in ("master_json.py", "hub_sheet_sync.py"):
        path = SERVER / name
        try:
            body = path.read_text(encoding="utf-8")
        except OSError as exc:
            why.append(f"{path} could not be read ({type(exc).__name__})")
            continue
        if "redaction.redact_row(" not in body:
            why.append(f"{path} does not call redaction.redact_row — the copy it "
                       "writes would carry the cells again on its next pass")
    # One probe per arm; every value is a placeholder.
    probes = (
        ("a prop key that names a credential", 1,
         {"Fact Key": "config.props.example", "Subject ID": "EXAMPLE_API_KEY",
          "Value": "not-a-real-value"}),
        ("a card column", 1, {"Customer": "somebody", "TL Debit Card Number": "0000"}),
        ("a column whose own name is a credential — the arm that reaches the ones with"
         " no key/value pair beside them", 1,
         {"Employee": "somebody", "Password": "not-a-real-value"}),
        ("a government identifier column, and the telephone column beside it that must"
         " survive", 1,
         {"Client": "somebody", "SSN": "000-00-0000", "Guardian #": "000-000-0000"}),
        ("the state-issued identifier a support professional is certified under,"
         " beside the certification columns that must survive", 1,
         {"Name": "somebody", "DD ID": "000000", "DODD": "Y", "Cert (DODD)": "Y",
          "DOB": "1970-01-01"}),
        ("the user half of a credential pair, and the sign-in timestamp beside it that"
         " must survive", 2,
         {"Owner": "somebody", "Username": "not-a-real-value",
          "Password": "not-a-real-value", "LastLoginAt": "1970-01-01"}),
        ("a bare expiry in a row that also carries a card — the row rule, not a header"
         " rule, because the same header is a training expiry elsewhere", 3,
         {"Client": "somebody", "CCV": "000", "PIN": "0000",
          "Expiration Date": "01/70", "Account Type": "checking"}),
        ("and the same bare expiry with no card in the row, which must survive", 0,
         {"Employee": "somebody", "Expiration Date": "01/70", "Training": "CPR"}),
        ("a column whose own NAME is the credential — the name is replaced, and what"
         " sits under it goes with it", 1,
         {"Owner": "somebody", "Placeholder7Name!x": "whatever"}),
        ("nothing at all, which is what an ordinary row must lose", 0,
         {"Employee": "somebody", "Shift": "day", "Cardholder name": "somebody",
          "Account (Last 4)": "0000", "Birthdate": "1970-01-01"}),
    )
    for what, want, row in probes:
        try:
            got = redaction.redact_row(row)[1]
        except Exception as exc:  # noqa: BLE001 — a rule that RAISES cannot be trusted either
            why.append(f"the rule raised {type(exc).__name__} on the probe for {what}")
            continue
        if got != want:
            why.append(f"the rule withheld {got} cell(s) where it must withhold {want}:"
                       f" {what}")
    # A count is not enough for the arm that rewrites a column NAME: the whole
    # point is that the name itself stops being in the copy, and a rule that
    # marked the cell and left the header would count the same and leak.
    name = "Placeholder7Name!x"
    try:
        left = redaction.redact_row({"Owner": "somebody", name: "whatever"})[0]
    except Exception as exc:  # noqa: BLE001
        why.append(f"the rule raised {type(exc).__name__} rewriting a credential header")
    else:
        if name in left:
            why.append("the rule left a column whose own NAME is a credential standing"
                       " as a column name — only the cell under it was marked, and the"
                       " header is the thing that has to go")
    return why


def _tree(root: Path) -> tuple[int, int]:
    files = total = 0
    if not root.exists():
        return 0, 0
    for path in root.rglob("*"):
        if path.is_file():
            files += 1
            try:
                total += path.stat().st_size
            except OSError:
                pass
    return files, total


def purge_master(root: Path, dry: bool) -> dict:
    """Deletes the tree, archive and manifest; the keeper rebuilds them, redacted, from the mirror."""
    out: dict = {"root": str(root), "existed": root.exists()}
    if not root.exists():
        print(f"master: nothing at {root} — nothing to remove")
        return out
    manifest = root / "manifest.json"
    held = 0
    if manifest.is_file():
        try:
            held = int(((json.loads(manifest.read_bytes()) or {})
                        .get("totals") or {}).get("withheld") or 0)
        except Exception:  # noqa: BLE001 — a manifest that will not parse is still going
            held = -1
    parts = {}
    for name in ("books", "archive", "handoff", ".tmp"):
        parts[name] = _tree(root / name)
    files, total = _tree(root)
    out.update(files=files, bytes=total, parts=parts, withheld_said=held)
    print(f"master: {root}")
    for name, (n, size) in parts.items():
        print(f"  {name+'/':<10} {n:6d} file(s)  {size / 2 ** 20:9.1f} MB")
    if manifest.is_file():
        print(f"  {'manifest':<10} {1:6d} file(s)  "
              f"{manifest.stat().st_size / 2 ** 20:9.1f} MB"
              + (f"  (it says {held} cell(s) withheld)" if held >= 0 else ""))
    print(f"  {'TOTAL':<10} {files:6d} file(s)  {total / 2 ** 20:9.1f} MB")

    # handoff/ stays: it is the only record of what crossed, not a copy of the sheets.
    doomed = [root / "books", root / "archive", root / ".tmp", manifest]
    if dry:
        print("  --dry-run: nothing was removed")
        return out
    # THE COUNT IS WHAT WENT, NOT WHAT WAS TRIED. `ignore_errors=True` beside a
    # counter that always stepped printed "removed 4 of 4" over a tree half of
    # which was still standing — and this tool's whole job is to be the proof
    # that a copy no longer holds the cells. So each path is looked at again
    # after the removal, only what is really gone is counted, and a survivor is
    # named and carried out of here as a failure.
    present = [p for p in doomed if p.exists()]
    gone, survivors = [], []
    for path in present:
        try:
            if path.is_dir():
                shutil.rmtree(path)
            else:
                path.unlink()
        except OSError as exc:
            print(f"  {path} could not be removed ({type(exc).__name__})", file=sys.stderr)
        (survivors if path.exists() else gone).append(path)
    print(f"  removed {len(gone)} of the {len(present)} that were there"
          f" (books/, archive/, .tmp/, manifest.json);"
          f" handoff/ kept — it is not a copy of the sheets")
    out["removed"], out["survivors"] = len(gone), [str(p) for p in survivors]
    if survivors:
        print("  BUT THESE ARE STILL THERE, and they are copies of the sheets:",
              file=sys.stderr)
        for path in survivors:
            print(f"    · {path}", file=sys.stderr)
        return out
    print("  the keeper's next pass rebuilds the tree from the mirror, redacted")
    return out


def purge_mirror(dsn: str, dry: bool) -> dict:
    """Rewrites withheld cells in place with the same rule; rows are never deleted."""
    import psycopg2
    import psycopg2.extras

    out: dict = {"rows_read": 0, "rows_rewritten": 0, "cells": 0, "books": 0, "tabs": 0}
    books: set = set()
    tabs: set = set()
    conn = psycopg2.connect(dsn, connect_timeout=10, application_name="hub-purge-redacted")
    try:
        conn.autocommit = False
        read = conn.cursor(name="purge_redacted_read")
        read.itersize = 2000
        read.execute(f"select id, sheet_id, tab_name, data from {MIRROR_TABLE} order by id")
        batch: list[tuple] = []
        write = conn.cursor()
        for row_id, sheet_id, tab_name, data in read:
            out["rows_read"] += 1
            if not isinstance(data, dict):
                continue
            fixed, withheld = redaction.redact_row(data)
            if not withheld:
                continue
            out["rows_rewritten"] += 1
            out["cells"] += withheld
            books.add(sheet_id)
            tabs.add((sheet_id, tab_name))
            batch.append((psycopg2.extras.Json(fixed), row_id))
            if len(batch) >= 500 and not dry:
                write.executemany(f"update {MIRROR_TABLE} set data = %s where id = %s", batch)
                batch = []
        if batch and not dry:
            write.executemany(f"update {MIRROR_TABLE} set data = %s where id = %s", batch)
        read.close()
        if dry:
            conn.rollback()
        else:
            conn.commit()
    finally:
        conn.close()
    out["books"], out["tabs"] = len(books), len(tabs)
    print(f"mirror: {out['rows_read']} row(s) read from {MIRROR_TABLE}")
    print(f"  {out['cells']} cell(s) to withhold, in {out['rows_rewritten']} row(s),"
          f" {out['tabs']} tab(s), {out['books']} book(s)")
    print("  --dry-run: nothing was written" if dry
          else f"  {out['rows_rewritten']} row(s) rewritten in place — the sheets still hold"
               " every value")
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[1],
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dry-run", action="store_true", help="say what would go, write nothing")
    ap.add_argument("--master-only", action="store_true")
    ap.add_argument("--mirror-only", action="store_true")
    ap.add_argument("--master-dir", default=str(DEFAULT_MASTER))
    ap.add_argument("--dsn", default=os.getenv("HUB_SNAPSHOT_PG_DSN")
                    or os.getenv("HUB_PG_DSN") or os.getenv("DATABASE_URL") or "")
    ap.add_argument("--code-dir", default=str(SERVER),
                    help="the server code to judge and import the rule from"
                         f" (default: {SERVER})")
    args = ap.parse_args()

    # The refusal has no bypass: land the redaction and restart the relay.
    why = code_can_redact() + relay_loaded_it(args.dry_run)
    if why:
        print(f"REFUSED — the code in {SERVER} cannot withhold, so a purge would "
              "clear copies that fill up again:", file=sys.stderr)
        for line in why:
            print(f"  · {line}", file=sys.stderr)
        print("  nothing was removed and nothing was rewritten.", file=sys.stderr)
        return 2
    print(f"the code in {SERVER} withholds: redaction.py, master_json.py "
          "and hub_sheet_sync.py all agree"
          + (" (and the relay has had them since it started)"
             if SERVER == RELAY_CODE else ""))

    do_master = not args.mirror_only
    do_mirror = not args.master_only
    if do_mirror and not args.dsn:
        print("no database is configured (HUB_SNAPSHOT_PG_DSN) — the mirror lane "
              "cannot run; pass --master-only or --dsn", file=sys.stderr)
        return 2
    # A LANE THAT DID NOTHING BECAUSE IT COULD NOT IS NOT A LANE THAT HAD
    # NOTHING. Asked for both copies and run where the master tree is not
    # mounted, this printed one line about a directory it could not find,
    # cleaned the mirror, and exited 0 — a half purge that reads exactly like a
    # whole one afterwards. Say which lane could not run, and say it BEFORE
    # touching the other copy, so the two copies never fall out of step.
    master_root = Path(args.master_dir)
    if do_master and not master_root.exists():
        print(f"REFUSED — the master lane was asked for but {master_root} is not here,"
              " so this run would clean one copy and leave the other standing."
              " Run it where the master tree is mounted, point --master-dir at it,"
              " or ask for --mirror-only.", file=sys.stderr)
        return 2
    bad = 0
    if do_master:
        if purge_master(master_root, args.dry_run).get("survivors"):
            bad = 1
    if do_mirror:
        purge_mirror(args.dsn, args.dry_run)
    if bad:
        print("the master lane did not finish — what it names above is still a copy"
              " of the sheets and is still there.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
