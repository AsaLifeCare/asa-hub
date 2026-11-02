"""hiringAnalysis, derived from the candidates, talentPool and recruitment slices on disk."""
from __future__ import annotations

import json
import os
import re
from pathlib import Path

RESOURCES = ("hiringAnalysis",)

# snapshot_service rebuilds this slice whenever one of these is written.
SOURCES = ("candidates", "talentPool", "recruitment")

# Read off the env, not imported: snapshot_service imports this module.
_SNAPSHOT_DIR = Path(os.getenv("HUB_SNAPSHOT_OUT", "/srv/snapshot"))

# Mirrors STAGES in src/pages/features/hiring/flow/shared.ts.
_STAGES: list[tuple[str, str]] = [
    ("new", "New"),
    ("phone-screen", "Phone Screen"),
    ("interview", "Interview"),
    ("onboarding", "Onboarding"),
    ("hired", "Hired"),
    ("ready", "Ready to start"),
]


def _slice(name: str) -> tuple[list[dict], str]:
    """A slice's rows and built_at, or ([], '') if absent."""
    try:
        doc = json.loads((_SNAPSHOT_DIR / f"{name}.json").read_text())
    except Exception:  # noqa: BLE001 — no file, bad JSON: the same honest empty
        return [], ""
    rows = doc.get("rows")
    return (rows if isinstance(rows, list) else []), str(doc.get("built_at") or "")


def _digits(value: object) -> str:
    """The last ten digits of a phone — the platform's own contact key."""
    d = re.sub(r"\D", "", str(value or ""))
    return d[-10:] if len(d) >= 10 else ""


def _mail(value: object) -> str:
    return str(value or "").strip().lower()


def _int(value: object) -> int | None:
    try:
        if value is None or value == "":
            return None
        return int(float(value))
    except (TypeError, ValueError):
        return None


def _median(values: list[int]) -> int | None:
    if not values:
        return None
    ordered = sorted(values)
    mid = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[mid]
    return (ordered[mid - 1] + ordered[mid]) // 2


def _process(cards: list[dict]) -> dict:
    """A card with no arrival is counted in its stage but left out of the ageing maths, never zeroed."""
    by_stage: dict[str, dict] = {}
    for sid, label in _STAGES:
        by_stage[sid] = {"id": sid, "label": label, "count": 0, "waiting": [],
                         "median_days": None, "longest_days": None, "longest_who": "",
                         "no_arrival": 0}
    other = {"id": "other", "label": "Elsewhere", "count": 0, "waiting": [],
             "median_days": None, "longest_days": None, "longest_who": "", "no_arrival": 0}

    for c in cards:
        stage = str(c.get("stage") or "").strip()
        bucket = by_stage.get(stage, other)
        bucket["count"] += 1
        days = _int(c.get("daysAtStage"))
        if days is None:
            bucket["no_arrival"] += 1
            continue
        bucket["waiting"].append(days)
        if bucket["longest_days"] is None or days > bucket["longest_days"]:
            bucket["longest_days"] = days
            bucket["longest_who"] = str(c.get("name") or "")

    stages = []
    for bucket in list(by_stage.values()) + [other]:
        bucket["median_days"] = _median(bucket["waiting"])
        bucket.pop("waiting")
        if bucket["id"] != "other" or bucket["count"]:
            stages.append(bucket)
    return {"stages": stages, "total": len(cards)}


def _conditions(cards: list[dict]) -> list[dict]:
    seen: dict[str, dict] = {}
    for c in cards:
        items = c.get("checklist")
        if not isinstance(items, list):
            continue
        for item in items:
            if not isinstance(item, dict):
                continue
            cid = str(item.get("id") or "")
            if not cid:
                continue
            row = seen.setdefault(cid, {
                "id": cid, "label": str(item.get("label") or cid),
                "owner": str(item.get("owner") or ""), "stage": str(item.get("stage") or ""),
                "done": 0, "pending": 0, "missing": 0, "people": 0, "waiting_names": [],
            })
            row["people"] += 1
            status = str(item.get("status") or "").lower()
            if status in ("done", "auto"):
                row["done"] += 1
            elif status == "pending":
                row["pending"] += 1
                if len(row["waiting_names"]) < 6:
                    row["waiting_names"].append(str(c.get("name") or ""))
            else:
                row["missing"] += 1
                if len(row["waiting_names"]) < 6:
                    row["waiting_names"].append(str(c.get("name") or ""))
    return sorted(seen.values(),
                  key=lambda r: (-(r["missing"] + r["pending"]), r["label"]))


def _parked(cards: list[dict]) -> dict:
    standing, told = [], []
    for c in cards:
        if str(c.get("stage") or "") != "ready":
            continue
        entry = {"name": str(c.get("name") or ""), "days": _int(c.get("daysAtStage")),
                 "notices": 0, "of": 0, "last_at": ""}
        parked = c.get("parked")
        if isinstance(parked, dict):
            entry["notices"] = _int(parked.get("notices")) or 0
            entry["of"] = _int(parked.get("of")) or 0
            entry["last_at"] = str(parked.get("lastAt") or "")
            told.append(entry)
        standing.append(entry)
    standing.sort(key=lambda e: (e["days"] is None, -(e["days"] or 0)))
    return {"standing": standing, "told": len(told)}


def _books(cards: list[dict], pool: list[dict], envelopes: list[dict],
           pool_at: str, book_at: str) -> dict:
    """The overlap only describes; who may cross into hiring is tpCrossable_'s decision alone."""
    board_mail = {_mail(c.get("email")) for c in cards if _mail(c.get("email"))}
    board_phone = {_digits(c.get("phone")) for c in cards if _digits(c.get("phone"))}
    pool_mail = {_mail(p.get("email")) for p in pool if _mail(p.get("email"))}
    pool_phone = {_digits(p.get("phone")) for p in pool if _digits(p.get("phone"))}

    signed = pending = declined = other_status = 0
    on_board = in_store = strangers = 0
    unfinished: list[dict] = []
    for e in envelopes:
        status = str(e.get("status") or "").lower()
        if status == "signed":
            signed += 1
        elif status == "pending":
            pending += 1
        elif status == "declined":
            declined += 1
        else:
            other_status += 1

        if status != "signed":
            # the crossing queue offers only signed envelopes, so these show nowhere else
            unfinished.append({
                "srid": str(e.get("srid") or e.get("id") or ""),
                "name": str(e.get("name") or ""),
                "email": _mail(e.get("email")),
                "phone": str(e.get("phone") or ""),
                "status": status,
                "applied": str(e.get("applied") or ""),
                "location": str(e.get("location") or ""),
            })
            continue

        mail, phone = _mail(e.get("email")), _digits(e.get("phone"))
        if (mail and mail in board_mail) or (phone and phone in board_phone):
            on_board += 1
        elif (mail and mail in pool_mail) or (phone and phone in pool_phone):
            in_store += 1
        else:
            strangers += 1

    unfinished.sort(key=lambda u: (u["status"] != "pending", u["applied"] or "9999", u["name"]))

    pool_status: dict[str, int] = {}
    for p in pool:
        key = str(p.get("status") or "—").strip() or "—"
        pool_status[key] = pool_status.get(key, 0) + 1

    return {
        "process": {"count": len(cards)},
        "store": {
            "count": len(pool),
            "source": pool_at,
            "by_status": sorted(({"status": k, "count": v} for k, v in pool_status.items()),
                                key=lambda r: (-r["count"], r["status"])),
        },
        "book": {
            "count": len(envelopes), "signed": signed, "pending": pending,
            "declined": declined, "other": other_status, "source": book_at,
            "signed_on_board": on_board, "signed_in_store": in_store,
            "signed_strangers": strangers,
        },
        "unfinished": unfinished,
    }


def _build() -> tuple[list[dict], str | None]:
    cards, cards_at = _slice("candidates")
    pool, pool_at = _slice("talentPool")
    envelopes, book_at = _slice("recruitment")

    analysis = {
        "id": "hiring",
        # a missing source file is null, never zero, or an empty chart reads as an empty company
        "sources": {
            "candidates": cards_at or None,
            "talentPool": pool_at or None,
            "recruitment": book_at or None,
        },
        "process": _process(cards),
        "conditions": _conditions(cards),
        "parked": _parked(cards),
        "books": _books(cards, pool, envelopes, pool_at, book_at),
        "notas": _notas(pool),
    }
    # The oldest input is how fresh the whole screen is.
    stamps = [s for s in (cards_at, pool_at, book_at) if s]
    return [analysis], (min(stamps) if stamps else None)


def _notas(pool: list[dict]) -> dict:
    """Same buckets as the roster chip; unscored rows are counted apart, never as zero."""
    scored: list[float] = []
    for p in pool:
        raw = p.get("nota", p.get("composite_score"))
        try:
            value = float(raw)
        except (TypeError, ValueError):
            continue
        # The legacy composite is out of 12; the platform's nota is out of 10.
        if value > 10:
            value = round(min(10.0, max(0.0, value / 12 * 10)), 1)
        scored.append(value)
    strong = sum(1 for v in scored if v >= 8)
    middle = sum(1 for v in scored if 6 <= v < 8)
    weak = sum(1 for v in scored if v < 6)
    return {
        "scored": len(scored), "unscored": max(0, len(pool) - len(scored)),
        "average": round(sum(scored) / len(scored), 1) if scored else None,
        "strong": strong, "middle": middle, "weak": weak,
    }


def build(resource: str, dsn: str) -> tuple[list[dict], str | None]:
    """dsn is unused: the sources are other slices, not Postgres."""
    if resource not in RESOURCES:
        raise KeyError(resource)
    return _build()
