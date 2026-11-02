#!/usr/bin/env python3
"""The texts (and, with --calls, the call transcripts) Quo kept and no Hub store holds.

Lists the company lines, asks Quo for every thread active in the window and
its messages — with --calls, its calls and their transcripts — and counts, per
line and month, what Quo holds, what a store already holds (the texts house's
message_id column, the calls house's call_id column, every day the relay's
inbox keeps, any spool not fed yet) and what would be added.

DRY-RUN BY DEFAULT: it only reads. --apply writes the missing events, in the
webhook's shape (quo_pull.wrap), to ONE spool file in the inbox's .backfill
directory and stops. The relay, the one process that owns the inbox, feeds it
through quo_inbox.append_many behind the live queue (quo_inbox.feed_backfill),
so the hand-off files each event exactly as it files a pulled text, as source
`relay:backfill`. It never touches a day file, the inbox state, a house row or
a phone: nothing is deleted, rewritten or sent.

    python3 tools/quo_backfill.py --since YYYY-MM-DD --until YYYY-MM-DD \
        [--line PN…] [--calls] [--apply] [--json counts.json]

--until is a whole day, included. Months are UTC. Stdlib only.
"""
from __future__ import annotations

import argparse
import gzip
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Iterator

HERE = Path(__file__).resolve()
sys.path.insert(0, str(HERE.parent.parent / "server"))

LIVE_INBOX = (Path("/srv/snapshot/quo-inbox"),
              Path("/opt/docker/asa-hub/web/snapshot/quo-inbox"))
KEY_FILES = (Path("/srv/secrets/quo-api.key"), Path("/opt/docker/secrets/seal/quo-api.key"))


def _first(paths: tuple[Path, ...]) -> Path:
    return next((p for p in paths if p.exists()), paths[-1])


os.environ.setdefault("HUB_QUO_API_KEY_FILE", str(_first(KEY_FILES)))
os.environ.setdefault("HUB_QUO_INBOX_DIR", str(_first(LIVE_INBOX)))

import quo_inbox  # noqa: E402
import quo_pull  # noqa: E402

UTC = timezone.utc
GOOGLE_ENV = Path(os.getenv("HUB_BACKFILL_GOOGLE_ENV", "/opt/docker/asa-hub/server/.tools.env"))
TEXTS_HOUSE = os.getenv("HUB_HOUSE_QUO_MESSAGES_ID", "1iah-NnxyheBhiiAi2GwfqO-MXjfTxRhBkXo0UjZJEMg")
CALLS_HOUSE = os.getenv("HUB_HOUSE_QUO_TRANSCRIPTS_ID", "1bLSxXOzmNS8gURKpDP9cnhPzk2qquPNqUS7CGd0og50")
HOUSE_TAB = "Data"
TRANSCRIPT = quo_pull.TRANSCRIPT
RETRIES = 8
SPOOL = ".backfill"


# ── Quo, through the pull's own door ───────────────────────────────────────

class Quo:
    """quo_pull._get with a patient answer to 429: back off and ask again."""

    def __init__(self, get: Callable[[str, list], dict] | None = None,
                 sleep: Callable[[float], None] = time.sleep):
        self._get = get or quo_pull._get
        self._sleep = sleep
        self.asked = 0
        self.limited = 0

    def ask(self, path: str, params: list[tuple[str, str]]) -> dict:
        for attempt in range(RETRIES):
            self.asked += 1
            try:
                got = self._get(path, params)
            except quo_pull.RateLimited:
                self.limited += 1
                self._sleep(min(60.0, 2.0 ** attempt))
                continue
            self._sleep(quo_pull.GAP_S)
            return got
        raise quo_pull.PullError(f"still rate-limited on {path} after {RETRIES} tries", 429)

    def listing(self, path: str, params: list[tuple[str, str]]) -> Iterator[dict]:
        token = ""
        for _ in range(quo_pull.MAX_PAGES):
            got = self.ask(path, params + ([("pageToken", token)] if token else []))
            items = got.get("data")
            for item in items if isinstance(items, list) else []:
                if isinstance(item, dict):
                    yield item
            token = str(got.get("nextPageToken") or "")
            if not token or not items:
                return
        raise quo_pull.PullError(f"{path} was still paging after {quo_pull.MAX_PAGES} pages")


# The live pull's own wrapper: history and today are the one event shape.
wrap_transcript = quo_pull.wrap_transcript


# ── what the stores already hold ───────────────────────────────────────────

class Sheets:
    """Read-only: one column of a house, by its header."""

    def __init__(self, env_path: Path = GOOGLE_ENV):
        self.env_path = env_path
        self._token = ""

    def _env(self, key: str) -> str:
        for line in self.env_path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line.startswith(key + "="):
                return line.split("=", 1)[1].strip().strip("'\"")
        raise SystemExit(f"{key} is not in {self.env_path}")

    def _get(self, url: str) -> dict:
        if not self._token:
            body = urllib.parse.urlencode({
                "client_id": self._env("GS_GOOGLE_CLIENT_ID"),
                "client_secret": self._env("GS_GOOGLE_CLIENT_SECRET"),
                "refresh_token": self._env("GS_GOOGLE_REFRESH_TOKEN"),
                "grant_type": "refresh_token"}).encode()
            req = urllib.request.Request("https://oauth2.googleapis.com/token", data=body, method="POST")
            with urllib.request.urlopen(req, timeout=30) as res:
                self._token = json.load(res)["access_token"]
        req = urllib.request.Request(url, headers={"Authorization": "Bearer " + self._token})
        with urllib.request.urlopen(req, timeout=300) as res:
            return json.load(res)

    def column(self, sheet_id: str, tab: str, header: str) -> list[str]:
        base = f"https://sheets.googleapis.com/v4/spreadsheets/{sheet_id}/values/"
        head = (self._get(base + urllib.parse.quote(f"'{tab}'!1:1")).get("values") or [[]])[0]
        names = [str(h).strip() for h in head]
        if header not in names:
            raise SystemExit(f"{sheet_id}/{tab} has no column {header}")
        n, letter = names.index(header) + 1, ""
        while n:
            n, r = divmod(n - 1, 26)
            letter = chr(65 + r) + letter
        got = self._get(base + urllib.parse.quote(f"'{tab}'!{letter}2:{letter}")).get("values") or []
        return [str(r[0]).strip() for r in got if r and str(r[0]).strip()]


def inbox_keys(inbox: Path) -> tuple[set[str], set[str], int]:
    """(keys every kept day holds, keys an unfinished spool holds, lines read) — read only."""
    kept: set[str] = set()
    lines = 0
    for path in sorted(inbox.glob("*.jsonl.gz")) + sorted(inbox.glob("*.jsonl")):
        raw = path.read_bytes()
        if path.name.endswith(".gz"):
            raw = gzip.decompress(raw)
        for one in raw.split(b"\n"):
            line = quo_inbox._parse(one) if one.strip() else None
            if line is not None:
                kept.add(quo_inbox._k(line["id"], line["type"]))
                lines += 1
    queued: set[str] = set()
    for path in sorted((inbox / SPOOL).glob("*.jsonl")):
        for one in path.read_bytes().split(b"\n"):
            try:
                key = quo_inbox.event_key(json.loads(one)) if one.strip() else None
            except ValueError:
                key = None
            if key:
                queued.add(quo_inbox._k(*key))
    return kept, queued, lines


# ── the window ─────────────────────────────────────────────────────────────

def bound(text: str, end: bool = False) -> datetime:
    """A day (its start; with `end`, the start of the next) or an ISO instant, in UTC."""
    s = str(text).strip()
    if len(s) == 10:
        d = date.fromisoformat(s)
        at = datetime(d.year, d.month, d.day, tzinfo=UTC)
        return at + timedelta(days=1) if end else at
    at = datetime.fromisoformat(s.replace("Z", "+00:00"))
    return at if at.tzinfo else at.replace(tzinfo=UTC)


def _when(v: Any) -> datetime | None:
    ts = quo_inbox._ts(v) if v else None
    return datetime.fromtimestamp(ts, UTC) if ts is not None else None


# ── the plan ───────────────────────────────────────────────────────────────

def plan(quo: Quo, since: datetime, until: datetime, *, only: set[str], calls: bool,
         house_texts: set[str], house_calls: set[str], kept: set[str], queued: set[str],
         say: Callable[[str], None] = lambda s: None) -> dict[str, Any]:
    """Counts per (line, month) and the events no store holds; reads only."""
    after, before = quo_inbox._iso(since.timestamp()), quo_inbox._iso(until.timestamp())
    texts: dict[tuple[str, str], dict[str, int]] = defaultdict(
        lambda: {"quo": 0, "not_delivered": 0, "stored": 0, "add": 0})
    rings: dict[tuple[str, str], dict[str, int]] = defaultdict(
        lambda: {"calls": 0, "stored": 0, "no_transcript": 0, "add": 0})
    adds: list[dict] = []
    failures: list[str] = []
    seen: set[str] = set()
    lines = [p for p in quo.listing("/phone-numbers", []) if str(p.get("id") or "")]
    names = {str(p["id"]): f"{p.get('number') or ''} {p.get('name') or ''}".strip() for p in lines}
    if only - set(names):
        failures.append(f"not a company line: {', '.join(sorted(only - set(names)))}")
    for pid in [str(p["id"]) for p in lines if not only or str(p["id"]) in only]:
        try:
            threads = list(quo.listing("/conversations", [("phoneNumbers[]", pid), ("updatedAfter", after),
                                                          ("maxResults", str(quo_pull.PAGE))]))
        except quo_pull.PullError as exc:
            failures.append(f"line {pid}: its threads could not be listed ({exc})")
            continue
        # updatedAfter also lists threads only their metadata touched; one quiet since before the window holds nothing in it
        quiet = [c for c in threads if (_when(c.get("lastActivityAt")) or since) < since]
        say(f"{pid} {names.get(pid, '')}: {len(threads)} threads updated since {after[:10]}, "
            f"{len(quiet)} of them quiet since before it")
        for conv in threads:
            cid = str(conv.get("id") or "")
            parts = [str(p) for p in (conv.get("participants") or []) if p]
            if not parts or not cid or conv in quiet:
                continue
            try:
                for msg in quo.listing("/messages", [("phoneNumberId", pid)]
                                       + [("participants[]", p) for p in parts]
                                       + [("createdAfter", after), ("createdBefore", before),
                                          ("maxResults", str(quo_pull.PAGE))]):
                    at = _when(msg.get("createdAt"))
                    mid = str(msg.get("id") or "").strip()
                    if at is None or not (since <= at < until) or not mid:
                        continue
                    row = texts[(pid, at.strftime("%Y-%m"))]
                    ev = quo_pull.wrap(msg, pid)
                    key = quo_inbox.event_key(ev) if ev else None
                    if key is None:
                        row["not_delivered"] += 1
                        continue
                    k = quo_inbox._k(*key)
                    if k in seen:
                        continue
                    seen.add(k)
                    row["quo"] += 1
                    if mid in house_texts or k in kept or k in queued:
                        row["stored"] += 1
                    else:
                        row["add"] += 1
                        adds.append(ev)
            except quo_pull.PullError as exc:
                failures.append(f"line {pid} thread {cid}: its messages could not be read ({exc})")
            if not calls or len(parts) != 1:
                continue
            try:
                found = list(quo.listing("/calls", [("phoneNumberId", pid), ("participants[]", parts[0]),
                                                    ("createdAfter", after), ("createdBefore", before),
                                                    ("maxResults", str(quo_pull.PAGE))]))
            except quo_pull.PullError as exc:
                failures.append(f"line {pid} thread {cid}: its calls could not be read ({exc})")
                continue
            for call in found:
                at = _when(call.get("createdAt"))
                call_id = str(call.get("id") or "").strip()
                if at is None or not (since <= at < until) or not call_id:
                    continue
                k = quo_inbox._k(call_id, TRANSCRIPT)
                if k in seen:
                    continue
                seen.add(k)
                row = rings[(pid, at.strftime("%Y-%m"))]
                row["calls"] += 1
                if call_id in house_calls or k in kept or k in queued:
                    row["stored"] += 1
                    continue
                if str(call.get("status") or "").lower() != "completed" or not call.get("duration"):
                    row["no_transcript"] += 1
                    continue
                try:
                    got = quo.ask("/call-transcripts/" + urllib.parse.quote(call_id, safe=""), [])
                except quo_pull.PullError as exc:
                    if exc.code == 404:
                        row["no_transcript"] += 1
                        continue
                    failures.append(f"line {pid} call {call_id}: its transcript could not be read ({exc})")
                    continue
                ev = wrap_transcript(got.get("data") if isinstance(got.get("data"), dict) else {}, call, pid)
                if ev is None:
                    row["no_transcript"] += 1
                    continue
                row["add"] += 1
                adds.append(ev)
    adds.sort(key=lambda e: str(((e.get("data") or {}).get("object") or {}).get("createdAt") or ""))
    return {"texts": dict(texts), "calls": dict(rings), "adds": adds, "failures": failures, "names": names}


def write_spool(inbox: Path, events: list[dict], since: datetime, until: datetime, now: float) -> Path:
    """One spool file, whole and 0600, beside nothing it could overwrite; refused while one waits."""
    spool = inbox / SPOOL
    spool.mkdir(mode=0o700, exist_ok=True)
    os.chmod(spool, 0o700)
    waiting = sorted(spool.glob("*.jsonl"))
    if waiting:
        raise SystemExit(f"refused: {waiting[0].name} is still being fed — apply again when it is done")
    stamp = datetime.fromtimestamp(now, UTC).strftime("%Y%m%dT%H%M%SZ")
    path = spool / f"{stamp}-{since:%Y%m%d}-{(until - timedelta(seconds=1)):%Y%m%d}.jsonl"
    quo_inbox._write_atomic(path, b"".join(quo_inbox._encode(ev) for ev in events))
    return path


# ── saying it ──────────────────────────────────────────────────────────────

def table(title: str, rows: dict[tuple[str, str], dict[str, int]], cols: list[str],
          names: dict[str, str]) -> list[str]:
    out = [title, "  " + f"{'line':<40} {'month':<8} " + " ".join(f"{c:>14}" for c in cols)]
    total = {c: 0 for c in cols}
    per_month: dict[str, dict[str, int]] = defaultdict(lambda: {c: 0 for c in cols})
    for (pid, month) in sorted(rows):
        r = rows[(pid, month)]
        out.append("  " + f"{(pid + ' ' + names.get(pid, ''))[:40]:<40} {month:<8} "
                   + " ".join(f"{r[c]:>14,}" for c in cols))
        for c in cols:
            total[c] += r[c]
            per_month[month][c] += r[c]
    for month in sorted(per_month):
        out.append("  " + f"{'all lines':<40} {month:<8} " + " ".join(f"{per_month[month][c]:>14,}" for c in cols))
    out.append("  " + f"{'TOTAL':<40} {'':<8} " + " ".join(f"{total[c]:>14,}" for c in cols))
    return out


def main(argv: list[str] | None = None, *, quo: Quo | None = None, sheets: Sheets | None = None,
         now: float | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--since", required=True)
    ap.add_argument("--until", required=True)
    ap.add_argument("--line", action="append", default=[])
    ap.add_argument("--calls", action="store_true", help="the call transcripts too")
    ap.add_argument("--apply", action="store_true", help="write the spool the relay feeds (default: dry-run)")
    ap.add_argument("--inbox-dir", default=str(quo_inbox.INBOX_DIR))
    ap.add_argument("--texts-house", default=TEXTS_HOUSE)
    ap.add_argument("--calls-house", default=CALLS_HOUSE)
    ap.add_argument("--json", default="", help="write the counts (never a text or a number) here")
    args = ap.parse_args(argv)
    since, until = bound(args.since), bound(args.until, end=True)
    if until <= since:
        raise SystemExit("--until must come after --since")
    inbox = Path(args.inbox_dir)
    if not inbox.is_dir():
        raise SystemExit(f"no inbox at {inbox}")
    quo = quo or Quo()
    sheets = sheets or Sheets()
    started = time.time()
    say = lambda s: print(s, file=sys.stderr, flush=True)  # noqa: E731
    house_texts = set(sheets.column(args.texts_house, HOUSE_TAB, "message_id"))
    house_calls = set(sheets.column(args.calls_house, HOUSE_TAB, "call_id")) if args.calls else set()
    kept, queued, inbox_lines = inbox_keys(inbox)
    say(f"stores: texts house {len(house_texts):,} ids · calls house {len(house_calls):,} ids · "
        f"inbox {inbox_lines:,} lines · spools {len(queued):,} queued")
    got = plan(quo, since, until, only=set(args.line), calls=args.calls, house_texts=house_texts,
               house_calls=house_calls, kept=kept, queued=queued, say=say)
    out = [f"Quo backfill {'APPLY' if args.apply else 'DRY-RUN'} — "
           f"{quo_inbox._iso(since.timestamp())} → {quo_inbox._iso(until.timestamp())} (end excluded, months UTC)"]
    out += table("TEXTS (quo = what the webhook would have delivered; not_delivered = sent, never delivered, "
                 "skipped exactly as the live pull skips them)",
                 got["texts"], ["quo", "not_delivered", "stored", "add"], got["names"])
    if args.calls:
        out += table("CALL TRANSCRIPTS", got["calls"], ["calls", "stored", "no_transcript", "add"], got["names"])
    out.append(f"Quo requests: {quo.asked:,} ({quo.limited} answered 429) · {time.time() - started:,.0f}s")
    for why in got["failures"]:
        out.append("FAILED " + why)
    adds = got["adds"]
    if args.apply:
        if got["failures"]:
            out.append(f"NOT APPLIED: {len(got['failures'])} read(s) failed — a plan with holes is not written")
            print("\n".join(out))
            return 2
        if adds:
            path = write_spool(inbox, adds, since, until, time.time() if now is None else now)
            out.append(f"APPLIED: {len(adds):,} events written to {path} — the relay feeds them "
                       f"{quo_inbox.SPOOL_FEED} at a time behind the live queue")
        else:
            out.append("APPLIED: nothing to add")
    else:
        out.append(f"DRY-RUN: nothing was written; --apply would spool {len(adds):,} events")
    print("\n".join(out))
    if args.json:
        Path(args.json).write_text(json.dumps({
            "since": quo_inbox._iso(since.timestamp()), "until": quo_inbox._iso(until.timestamp()),
            "texts": {f"{p}|{m}": r for (p, m), r in sorted(got["texts"].items())},
            "calls": {f"{p}|{m}": r for (p, m), r in sorted(got["calls"].items())},
            "would_add": len(adds), "failures": got["failures"], "requests": quo.asked,
            "rate_limited": quo.limited}, indent=1), encoding="utf-8")
    return 1 if got["failures"] else 0


if __name__ == "__main__":
    sys.exit(main())
