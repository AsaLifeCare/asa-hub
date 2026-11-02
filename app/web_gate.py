"""Test mode and the night for the relay's own web voice (notices, pushes), and the mock rows it holds back.
The switch is the resolved `configLane` test_mode (hubTestModeState_); anything unreadable or stale reads ON…

The relay's server/web_gate.py in asa-hub-app, for the notices' clock (app/notice_clock.py). The ledger on
/srv/snapshot is kept by both processes (the relay still keeps its roster holds and chat pushes there), so every read
and write of it holds the lock file beside it as well as this process's lock."""
from __future__ import annotations

import fcntl
import gzip
import hashlib
import json
import logging
import os
import threading
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable, Iterator
from zoneinfo import ZoneInfo

log = logging.getLogger("asa-hub-app.webgate")

OHIO = ZoneInfo("America/New_York")
UTC = timezone.utc

OUT = Path(os.getenv("HUB_SNAPSHOT_OUT", "/srv/snapshot"))
MOCK_DIR = Path(os.getenv("HUB_WEB_MOCK_DIR", str(OUT / "comm-mock-web")))

# past the longest normal gap between config-lane reads (a slow slice build plus the tick)
LANE_FRESH_S = float(os.getenv("HUB_TEST_SWITCH_FRESH_S", "900"))
# How many rows one hand-off carries — the door's own ceiling.
HANDOFF_ROWS = int(os.getenv("HUB_WEB_MOCK_BATCH", "50"))
# How long a day's file is kept once every row in it was taken, zipped.
KEEP_DAYS = int(os.getenv("HUB_WEB_MOCK_KEEP_DAYS", "30"))
# A body is cut where the mock outbox cuts one.
BODY_MAX = 4000

CH_NOTICE = "web_notice"
CH_PUSH = "web_push"
# a roster write test mode held is a mock row too
CH_ROSTER = "roster_write"
CHANNELS = (CH_NOTICE, CH_PUSH, CH_ROSTER)
_METHOD = {CH_NOTICE: "webNotice", CH_PUSH: "webPush", CH_ROSTER: "rosterWrite"}
HELD_ROSTER_REASON = ("test mode holds roster writes — recorded on the platform, not written "
                      "to the house calendars workbook")

# CommMock.gs COMM_MOCK_HEADER, in the mint's order; the door stamps createdAt/updatedAt
COMM_MOCK_HEADER = (
    "id", "createdAt", "updatedAt",
    "at", "day", "hour", "pass_id", "seq",
    "situation", "purpose", "method", "send_at",
    "person_name", "to_masked", "audience",
    "channel", "subject", "body", "body_chars",
    "result", "held_by", "reason",
    "dial", "test_mode", "send_switch",
    "ledger_key", "tenant",
)

HELD_TEST = "held: test mode"


# the switch

def _instant(raw: Any) -> datetime | None:
    """An instant as web_notices._at reads it, with a local fallback if that module did not import."""
    try:
        import web_notices  # noqa: PLC0415 — one reader of a stamp on this relay
    except Exception:  # noqa: BLE001
        try:
            got = raw if isinstance(raw, datetime) else datetime.fromisoformat(
                str(raw or "").replace("Z", "+00:00"))
        except ValueError:
            return None
        return got if got.tzinfo else got.replace(tzinfo=OHIO)
    return web_notices._at(raw)  # noqa: SLF001


def switch_from(lane: Any, *, now: datetime | None = None) -> dict[str, Any]:
    """{on, readable, word, why}: `on` unless a fresh lane plainly says off."""
    now = now or datetime.now(UTC)

    def held(why: str) -> dict[str, Any]:
        return {"on": True, "readable": False, "word": "unreadable", "why": why}

    if not isinstance(lane, dict):
        return held("the relay has not read the platform's configuration yet")
    tm = lane.get("test_mode")
    if not isinstance(tm, dict):
        return held("the configuration the relay reads does not carry test mode "
                    "(Bundle.gs configLane has no test_mode part)")
    if tm.get("unreadable"):
        return held(f"the platform could not read test mode ({str(tm.get('unreadable'))[:120]})")
    built = _instant(lane.get("built_at"))
    if built is None:
        return held("the configuration the relay holds says nothing of when it was read")
    age = (now - built).total_seconds()
    if age > LANE_FRESH_S:
        return held(f"the configuration the relay holds is {int(age // 60)} minutes old")
    on = tm.get("on")
    if on is not True and on is not False:
        return held(f"test mode came back as {on!r}, which is neither on nor off")
    word = str(tm.get("word") or ("on" if on else "off")).strip() or ("on" if on else "off")
    return {"on": on, "readable": True, "word": word, "why": ""}


def switch_word(switch: dict[str, Any]) -> str:
    """What the mock's `test_mode` column says: on, off, or unreadable."""
    if not switch.get("readable"):
        return "unreadable"
    return "on" if switch.get("on") else "off"


def held_by_test(switch: dict[str, Any]) -> str:
    return HELD_TEST if switch.get("readable") else f"{HELD_TEST} (unreadable, so treated as on)"


# the night (psi_reminders.quiet)

def quiet(at: datetime) -> bool:
    import psi_reminders  # noqa: PLC0415 — the window has one home on this relay
    return psi_reminders.quiet(at)


def quiet_ends(at: datetime) -> datetime:
    import psi_reminders  # noqa: PLC0415
    return psi_reminders.quiet_ends(at)


def quiet_words() -> str:
    import psi_reminders  # noqa: PLC0415
    start = psi_reminders.QUIET_FROM
    end_h, end_m = (int(p) for p in str(psi_reminders.QUIET_TO).split(":"))
    last = (datetime(2000, 1, 1, end_h, end_m) - timedelta(minutes=1)).strftime("%H:%M")
    return f"{start}–{last} New York"


# the words of a row

def _clock(at: datetime) -> str:
    """'3:45 PM' — the notices' own clock (web_notices.clock_label)."""
    import web_notices  # noqa: PLC0415
    return web_notices.clock_label(at)


def shift_words(value: str, col_iso: str) -> str:
    """`930P-730A` as 9:30 PM – 7:30 AM by the estate's grammar; unreadable cells as written."""
    text = str(value or "").strip()
    if not text:
        return "a shift"
    try:
        import shift_requests  # noqa: PLC0415 — heavy, and only needed here
        span = shift_requests.span_of(str(col_iso or ""), text)
    except Exception:  # noqa: BLE001 — the code is still the shift
        span = None
    if not span:
        return text
    return f"{_clock(span[0])} – {_clock(span[1])}"


def spelled(text: str, value: str, col_iso: str) -> str:
    return str(text or "").replace("{shift}", shift_words(value, col_iso))


# the mock rows

def _digest(*parts: Any, n: int = 20) -> str:
    return hashlib.sha1("|".join(str(p) for p in parts).encode("utf-8")).hexdigest()[:n]


def row_id(ledger_key: str) -> str:
    """The ledger key's digest, so one event is one row."""
    return "web_" + _digest(ledger_key)


def mock_rows(channel: str, notice: dict[str, Any], copies: Iterable[tuple[str, dict[str, Any]]], *,
              result: str, held_by: str, reason: str, switch: dict[str, Any],
              now: datetime | None = None) -> list[dict[str, Any]]:
    """Mock rows for one notice on one channel: one per distinct wording, the audience named in full."""
    if channel not in CHANNELS:
        raise ValueError(f"not a web channel: {channel}")
    now = now or datetime.now(UTC)
    local = now.astimezone(OHIO)
    facts = notice.get("facts") or {}
    value, col_iso = str(notice.get("value") or ""), str(notice.get("col_iso") or "")
    groups: dict[tuple[str, str, str], list[str]] = {}
    for name, copy in copies:
        if not copy:
            continue
        title = spelled(copy.get("title") or "", value, col_iso)
        body = spelled(copy.get("body") or "", value, col_iso)
        groups.setdefault((str(copy.get("role") or ""), title, body), []).append(str(name or "").strip())
    rows = []
    for seq, ((role, title, body), names) in enumerate(sorted(groups.items()), start=1):
        named = sorted({n for n in names if n})
        unnamed = len(names) - len([n for n in names if n])
        audience = ", ".join(named) + (f" and {unnamed} account(s) with no name on file"
                                       if unnamed else "")
        key = (f"{notice.get('key')}|{channel}|{result}|{role}|"
               f"{_digest(title, body, *sorted(names), n=10)}")
        rows.append({
            "id": row_id(key),
            "at": now.astimezone(UTC).isoformat(),
            "day": local.date().isoformat(),
            "hour": local.strftime("%H:%M"),
            "pass_id": "web_" + local.strftime("%Y%m%d%H%M"),
            "seq": seq,
            "situation": str(notice.get("kind") or ""),
            "purpose": f"{channel.replace('_', ' ')} · the {role or 'reader'} copy · {notice.get('key')}",
            "method": _METHOD[channel],
            "send_at": "",
            "person_name": str(facts.get("person") or ""),
            "to_masked": audience,
            "audience": len(names),
            "channel": channel,
            "subject": title,
            "body": body[:BODY_MAX],
            "body_chars": len(body),
            "result": result,
            "held_by": held_by,
            "reason": reason,
            "dial": "",
            "test_mode": switch_word(switch),
            "send_switch": "",
            "ledger_key": key,
            "tenant": "",
        })
    return rows


def roster_rows(location: str, cells: Iterable[dict[str, Any]], *, via: str, actor: str,
                act: str, switch: dict[str, Any],
                now: datetime | None = None) -> list[dict[str, Any]]:
    """One mock row per held roster act, naming every cell and what it said before."""
    cells = [c for c in cells if isinstance(c, dict)]
    if not cells:
        return []
    now = now or datetime.now(UTC)
    local = now.astimezone(OHIO)
    house = str(location or "").split(" - ")[1].strip() if " - " in str(location or "") \
        else str(location or "")
    lines = [f"{c.get('employee') or 'a row'} · {c.get('col_iso') or ''}: "
             f"{c.get('value') or '(empty)'} (was {c.get('was') or c.get('live') or '(empty)'})"
             for c in cells]
    body = "\n".join(lines)
    key = f"roster|{location}|{act or _digest(body, via, actor, n=12)}"
    return [{
        "id": row_id(key),
        "at": now.astimezone(UTC).isoformat(),
        "day": local.date().isoformat(),
        "hour": local.strftime("%H:%M"),
        "pass_id": "web_" + local.strftime("%Y%m%d%H%M"),
        "seq": 1,
        "situation": "roster_write",
        "purpose": f"roster write · {via} · {location}",
        "method": _METHOD[CH_ROSTER],
        "send_at": "",
        "person_name": str(actor or ""),
        "to_masked": house,
        "audience": len(cells),
        "channel": CH_ROSTER,
        "subject": f"{house}: {len(cells)} cell{'' if len(cells) == 1 else 's'} held by test mode",
        "body": body[:BODY_MAX],
        "body_chars": len(body),
        "result": "held",
        "held_by": held_by_test(switch),
        "reason": HELD_ROSTER_REASON,
        "dial": "",
        "test_mode": switch_word(switch),
        "send_switch": "",
        "ledger_key": key,
        "tenant": "",
    }]


# The ledger: one JSON-lines file per New York day, fsync'd appends and whole-file rewrites; 0700/0600.

_LOCK = threading.RLock()


def _root(root: Path | str | None) -> Path:
    return Path(root) if root is not None else MOCK_DIR


def _ensure_dir(root: Path) -> None:
    root.mkdir(parents=True, exist_ok=True)
    try:
        os.chmod(root, 0o700)
    except OSError:
        pass


# the relay and asa-hub-app both keep rows in one ledger: one process at a time, as one thread at a time
LEDGER_LOCK = ".ledger.lock"


@contextmanager
def _ledger(root: Path) -> Iterator[None]:
    with _LOCK:
        _ensure_dir(root)
        fd = os.open(root / LEDGER_LOCK, os.O_RDWR | os.O_CREAT, 0o600)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX)
            yield
        finally:
            os.close(fd)


def _day_files(root: Path) -> list[Path]:
    if not root.is_dir():
        return []
    return sorted(p for p in root.iterdir() if p.suffix == ".jsonl" and p.stem[:4].isdigit())


def _read_lines(path: Path) -> list[dict[str, Any]]:
    out = []
    try:
        text = path.read_text(encoding="utf-8")
    except FileNotFoundError:
        return out
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            got = json.loads(line)
        except ValueError:
            continue  # a line torn by a crash mid-append was never acknowledged
        if isinstance(got, dict) and got.get("id"):
            out.append(got)
    return out


def _rewrite(path: Path, lines: list[dict[str, Any]]) -> None:
    tmp = path.with_suffix(".jsonl.tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        for line in lines:
            fh.write(json.dumps(line, ensure_ascii=False, separators=(",", ":"), default=str) + "\n")
        fh.flush()
        os.fsync(fh.fileno())
    os.replace(tmp, path)


def _known_ids(root: Path) -> set[str]:
    ids: set[str] = set()
    for path in _day_files(root):
        ids |= {str(line["id"]) for line in _read_lines(path)}
    for gz in root.glob("*.jsonl.gz") if root.is_dir() else ():
        try:
            with gzip.open(gz, "rt", encoding="utf-8") as fh:
                for raw in fh:
                    try:
                        ids.add(str(json.loads(raw).get("id") or ""))
                    except ValueError:
                        continue
        except OSError:
            continue
    ids.discard("")
    return ids


def record(rows: Iterable[dict[str, Any]], *, root: Path | str | None = None,
           now: datetime | None = None) -> dict[str, int]:
    """Keep these rows on the disk — {added, duplicate}; raises when the disk refused."""
    base = _root(root)
    now = now or datetime.now(UTC)
    rows = [r for r in rows if isinstance(r, dict) and r.get("id")]
    if not rows:
        return {"added": 0, "duplicate": 0}
    with _ledger(base):
        known = _known_ids(base)
        fresh = []
        for r in rows:
            if r["id"] in known:
                continue
            known.add(r["id"])
            fresh.append({"id": r["id"], "row": r, "kept_at": now.astimezone(UTC).isoformat(),
                          "handed_at": "", "tries": 0, "last_error": ""})
        if fresh:
            path = base / f"{now.astimezone(OHIO).date().isoformat()}.jsonl"
            fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
            with os.fdopen(fd, "a", encoding="utf-8") as fh:
                for line in fresh:
                    fh.write(json.dumps(line, ensure_ascii=False, separators=(",", ":"), default=str) + "\n")
                fh.flush()
                os.fsync(fh.fileno())
    return {"added": len(fresh), "duplicate": len(rows) - len(fresh)}


def pending(*, root: Path | str | None = None, limit: int | None = None) -> list[dict[str, Any]]:
    """Rows not yet taken, fewest tries first, then oldest."""
    base = _root(root)
    limit = HANDOFF_ROWS if limit is None else limit
    with _ledger(base):
        waiting = [line for path in _day_files(base) for line in _read_lines(path)
                   if not line.get("handed_at")]
    waiting.sort(key=lambda line: (int(line.get("tries") or 0), str(line.get("kept_at") or "")))
    return [line["row"] for line in waiting[:max(0, limit)] if isinstance(line.get("row"), dict)]


def waiting_count(*, root: Path | str | None = None) -> int:
    base = _root(root)
    with _ledger(base):
        return sum(1 for path in _day_files(base) for line in _read_lines(path)
                   if not line.get("handed_at"))


def mark(*, taken: Iterable[str] = (), refused: dict[str, str] | None = None,
         offered: Iterable[str] = (), root: Path | str | None = None,
         now: datetime | None = None) -> int:
    """Mark `taken` ids handed; other offered ids count a try with the reason. Returns how many were handed."""
    base = _root(root)
    now = now or datetime.now(UTC)
    taken_set = {str(i) for i in taken}
    refused = {str(k): str(v) for k, v in (refused or {}).items()}
    offered_set = {str(i) for i in offered} | set(refused)
    handed = 0
    with _ledger(base):
        for path in _day_files(base):
            lines = _read_lines(path)
            changed = False
            for line in lines:
                lid = str(line.get("id"))
                if line.get("handed_at"):
                    continue
                if lid in taken_set:
                    line["handed_at"] = now.astimezone(UTC).isoformat()
                    line["last_error"] = ""
                    handed += 1
                    changed = True
                elif lid in offered_set:
                    line["tries"] = int(line.get("tries") or 0) + 1
                    line["last_error"] = refused.get(lid) or "not named in the door's answer"
                    changed = True
            if changed:
                _rewrite(path, lines)
    return handed


def rotate(*, root: Path | str | None = None, now: datetime | None = None) -> dict[str, int]:
    """Zip fully taken days and drop zips past KEEP_DAYS; a day with a waiting row is never zipped."""
    base = _root(root)
    now = now or datetime.now(UTC)
    today = now.astimezone(OHIO).date().isoformat()
    zipped = dropped = 0
    with _ledger(base):
        for path in _day_files(base):
            if path.stem >= today:
                continue
            lines = _read_lines(path)
            if any(not line.get("handed_at") for line in lines):
                continue
            gz = path.with_suffix(".jsonl.gz")
            fd = os.open(gz, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            with os.fdopen(fd, "wb") as raw, gzip.GzipFile(fileobj=raw, mode="wb") as fh:
                for line in lines:
                    fh.write((json.dumps(line, ensure_ascii=False, default=str) + "\n").encode("utf-8"))
            path.unlink()
            zipped += 1
        horizon = (now.astimezone(OHIO).date() - timedelta(days=KEEP_DAYS)).isoformat()
        for gz in (base.glob("*.jsonl.gz") if base.is_dir() else ()):
            if gz.name[:10] < horizon:
                gz.unlink()
                dropped += 1
    return {"zipped": zipped, "dropped": dropped}


def after_handoff(env: Any, offered: list[str], *, root: Path | str | None = None,
                  now: datetime | None = None) -> dict[str, Any]:
    """Mark the ledger from the door's answer — {handed, refused, ok, why}; only ids it names as written are taken."""
    env = env if isinstance(env, dict) else {}
    if env.get("status") != 200 or not isinstance(env.get("data"), dict):
        why = str(env.get("message") or env.get("status") or "no answer")[:200]
        mark(offered=offered, refused={i: why for i in offered}, root=root, now=now)
        return {"handed": 0, "refused": len(offered), "ok": False, "why": why}
    data = env["data"]
    written = [str(i) for i in (data.get("written") or []) if str(i) in set(offered)]
    refused = {}
    for item in data.get("refused") or []:
        if isinstance(item, dict) and str(item.get("id") or "") in set(offered):
            refused[str(item["id"])] = str(item.get("why") or "refused")[:200]
    handed = mark(taken=written, refused=refused, offered=offered, root=root, now=now)
    return {"handed": handed, "refused": len(offered) - len(written), "ok": True, "why": ""}
