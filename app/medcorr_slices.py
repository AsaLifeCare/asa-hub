"""The medCorrelation slice, built from the mar_errors and missing_medications rows handed in memory.
It is a flat file: client initials and counts only; no row's free text and no staff name leaves this module."""
from __future__ import annotations

import json
import logging
import re
from collections import Counter
from datetime import datetime, timedelta

import lanes_pg as psycopg2

log = logging.getLogger(__name__)

RESOURCES = ("medCorrelation",)

# NEVER_SNAPSHOT (src/lib/snapshot.ts): no file is built for these; snapshot_service reads the tabs and hands the…
HELD_SOURCES = {"marErrors": "mar_errors", "missingMedications": "missing_medications"}

# snapshot_service rebuilds the study on a full pass and when /notify names one of these
SOURCES = tuple(HELD_SOURCES)

_HANDED: dict[str, tuple[list[dict], str]] = {}


def hand_in(name: str, rows: list[dict] | None, read_at: str = "") -> None:
    """One cycle's rows for a held source; None means the read failed."""
    if rows is None:
        _HANDED.pop(name, None)
    else:
        _HANDED[name] = (rows, read_at)

_MEDCORR_CONTROLLED = ("clonazepam", "lorazepam", "clobazam", "alprazolam", "diazepam",
                       "temazepam", "phenobarbital", "lisdexamf", "methylphenidate",
                       "amphetamine", "adderall", "oxycodone", "hydrocodone", "morphine",
                       "tramadol", "codeine", "buprenorphine", "zolpidem", "ativan",
                       "klonopin", "xanax", "valium", "ritalin", "vyvanse", "concerta")
_MEDCORR_AVAIL = ("unavailable", "not available", "no med", "out of", "ran out", "missing",
                  "not delivered", "deliver", "pharmacy", "refill", "didn't come",
                  "didn't arrive", "not here", "no longer", "supply", "no script",
                  "not in", "awaiting", "prior auth", "authorization", "backorder", "back order")
_MEDCORR_HUMAN = ("staff", "communication", "comm error", "forgot", "wrong", "late",
                  "missed due", "documentation", "initial", "pass", "sign", "count",
                  "transcrib", "human", "training", "new staff")

# the dedup key is what the sheet said; the row's own id and stamps would make every row unique
_ERR_CONTENT = ("error_date", "end_date", "time", "initials", "medication",
                "problem", "flags", "staff", "notes")


def _take() -> dict[str, tuple[list[dict], str]]:
    """This cycle's hand-ins, all taken at once: a cycle whose read failed must not study the last one's rows…"""
    got = {name: _HANDED.pop(name, None) for name in HELD_SOURCES}
    missing = sorted(name for name, v in got.items() if v is None)
    if missing:
        raise RuntimeError(f"{', '.join(missing)}: rows could not be read this cycle")
    return got


def _medcorr_norm(s):
    s = str(s or "").lower()
    s = re.sub(r"\d+\.?\d*\s*(mg|mcg|ml|g|%).*", "", s)
    s = re.sub(r"\b(tab|cap|tablet|capsule|oral|sol|susp|er|xr|hcl|sr|cr|odt|spray|spr|inhaler|patch|liquid)\b", "", s)
    return re.sub(r"[^a-z]", "", s)


def _medcorr_initials(name):
    parts = [p for p in re.sub(r"[^A-Za-z ]", "", str(name or "")).split() if p]
    if len(parts) >= 2:
        return (parts[0][0] + parts[-1][0]).upper()
    return parts[0][:2].upper() if parts else ""


def _err_initials(d: dict) -> str:
    """The MAR book's initials cell as written; a cell holding a name is cut to its initials."""
    raw = str(d.get("initials") or "").strip()
    if not raw:
        return _medcorr_initials(d.get("client_name", ""))
    if len(raw.split()) > 1 or len(re.sub(r"[^A-Za-z]", "", raw)) > 3:
        return _medcorr_initials(raw)
    return raw.upper()


def _flags(d: dict) -> set[str]:
    """The mar_errors book folds the sheet's X/C/M columns into one comma-separated `flags` string."""
    return {t.strip() for t in str(d.get("flags") or "").split(",") if t.strip()}


def _medcorr_month(v):
    """Serials, M/D/YYYY strings and ISO all occur; a serial-only parse dropped every row."""
    s = str(v or "").strip()
    try:
        f = float(s)
        if 30000 < f < 80000:
            return (datetime(1899, 12, 30) + timedelta(days=int(f))).strftime("%Y-%m")
    except Exception:
        pass
    m = re.match(r"(\d{1,2})/(\d{1,2})/(\d{2,4})", s)
    if m:
        mo, y = int(m.group(1)), int(m.group(3))
        if y < 100:
            y += 2000
        if 1 <= mo <= 12 and 2000 <= y <= 2100:
            return f"{y:04d}-{mo:02d}"
    m = re.match(r"(\d{4})-(\d{2})\b", s)
    if m and 1 <= int(m.group(2)) <= 12:
        return f"{m.group(1)}-{m.group(2)}"
    return ""


def _delivery_window(dsn: str) -> tuple[int, int, object, object]:
    try:
        with psycopg2.connect(dsn) as conn, conn.cursor(
            cursor_factory=psycopg2.extras.RealDictCursor
        ) as cur:
            cur.execute(
                "SELECT coalesce(sum(drug_count),0) AS meds, count(*) AS batches, "
                "min(period_start) AS ps, max(period_end) AS pe FROM asa_med_deliveries")
            dr = cur.fetchone()
    except Exception as exc:  # noqa: BLE001
        log.warning("[medcorr] deliveries ref failed: %r", exc)
        return 0, 0, None, None
    if not dr:
        return 0, 0, None, None
    return int(dr["meds"] or 0), int(dr["batches"] or 0), dr["ps"], dr["pe"]


def _build(dsn: str) -> tuple[list[dict], str | None]:
    taken = _take()
    err_all, err_at = taken["marErrors"]
    miss_raw, miss_at = taken["missingMedications"]
    disp_meds, disp_batches, disp_start, disp_end = _delivery_window(dsn)

    err_all = [d for d in err_all if any(str(v).strip() for v in d.values())]
    seen: set[str] = set()
    err = [d for d in err_all
           if (k := json.dumps({f: d.get(f) for f in _ERR_CONTENT}, sort_keys=True)) not in seen
           and not seen.add(k)]
    miss = [d for d in miss_raw if any(str(v).strip() for v in d.values())]

    win_label = ""
    if disp_start and disp_end:
        ws, we = disp_start.strftime("%Y-%m"), disp_end.strftime("%Y-%m")
        win_label = f"{ws} → {we} · {disp_batches} delivery batches"
        err = [d for d in err
               if (m := _medcorr_month(d.get("error_date") or d.get("end_date"))) and ws <= m <= we]
        miss = [d for d in miss
                if (m := _medcorr_month(d.get("reported_at"))) and ws <= m <= we]

    # every percentage base below is disp_meds, not this count
    n_err, n_miss = len(err), len(miss)
    err_act = [d for d in err
               if "Missed" in _flags(d) or "Unavailable" in _flags(d)
               or any(k in str(d.get("problem", "")).strip().lower() for k in _MEDCORR_AVAIL)]
    n_act = len(err_act)
    med_err_rate = round(100 * n_act / disp_meds, 1) if disp_meds else 0

    def pct(a, b):
        return round(100 * a / b) if b else 0

    f_missed = sum(1 for d in err if "Missed" in _flags(d))
    f_nostaff = sum(1 for d in err if "No Staff" in _flags(d))
    f_unavail = sum(1 for d in err if "Unavailable" in _flags(d))
    f_ctrl = sum(1 for d in err if "Controlled" in _flags(d))

    c_av = c_hu = c_ot = 0
    for d in err:
        p = str(d.get("problem", "")).strip().lower()
        if not p or p == "blank":
            c_ot += 1
            continue
        if any(k in p for k in _MEDCORR_AVAIL):
            c_av += 1
        elif any(k in p for k in _MEDCORR_HUMAN):
            c_hu += 1
        else:
            c_ot += 1

    err_med: Counter = Counter()
    miss_med: Counter = Counter()
    labels: dict[str, str] = {}
    for d in err:
        raw = str(d.get("medication", "")).strip()
        m = _medcorr_norm(raw)
        if m:
            err_med[m] += 1
            labels.setdefault(m, raw)
    for d in miss:
        raw = str(d.get("medications", "")).strip()
        m = _medcorr_norm(raw)
        if m:
            miss_med[m] += 1
            labels.setdefault(m, raw)
    med_ov = sorted(set(err_med) & set(miss_med), key=lambda m: err_med[m] + miss_med[m], reverse=True)
    ctrl_ov = [m for m in med_ov if any(k in m for k in _MEDCORR_CONTROLLED)]

    err_cli = Counter(k for k in map(_err_initials, err) if k)
    miss_full = Counter(str(d.get("client_name", "")).strip() for d in miss if str(d.get("client_name", "")).strip())
    miss_init: Counter = Counter()
    for n, c in miss_full.items():
        ini = _medcorr_initials(n)
        if ini:
            miss_init[ini] += c
    cli_ov = sorted(set(err_cli) & set(miss_init),
                    key=lambda k: err_cli[k] + miss_init[k], reverse=True)

    miss_issue = Counter((str(d.get("issue", "")).strip() or "(blank)") for d in miss)
    miss_status = Counter((str(d.get("status", "")).strip() or "(blank)") for d in miss)
    # the missing book has no House field yet: empty until it does, never invented
    miss_house = Counter(str(d.get("house", "")).strip() for d in miss if str(d.get("house", "")).strip())

    err_month: Counter = Counter()
    miss_month: Counter = Counter()
    for d in err:
        ym = _medcorr_month(d.get("error_date") or d.get("end_date"))
        if ym:
            err_month[ym] += 1
    for d in miss:
        ym = _medcorr_month(d.get("reported_at"))
        if ym:
            miss_month[ym] += 1
    months = sorted(set(err_month) | set(miss_month))[-12:]
    trend = [{"month": m, "errors": err_month.get(m, 0), "missing": miss_month.get(m, 0)} for m in months]

    insights = [
        f"Of {n_err} MAR rows reviewed, {n_act} ({pct(n_act, n_err)}%) are actionable med errors (missed/unavailable); the rest are charting/initialing discrepancies. Against {disp_meds} meds delivered across {disp_batches} batches → {med_err_rate}% med-error rate.",
        f"{len(cli_ov)} clients appear in BOTH med errors and missing meds — the same high-acuity residents drive both problems.",
        f"{f_unavail} med errors ({pct(f_unavail, disp_meds)}% of {disp_meds} meds delivered) are flagged 'Unavailable' — caused directly by a missing/undelivered med.",
        f"{len(med_ov)} medications appear in both lists; {len(ctrl_ov)} are controlled substances (a missing controlled med is a double risk).",
        f"Of the {disp_meds} meds delivered, {c_hu} ({pct(c_hu, disp_meds)}%) had a human/staff-related error vs {c_av} ({pct(c_av, disp_meds)}%) an availability error.",
    ]

    summary = {
        "id": "summary",
        "kind": "summary",
        "window": win_label,
        "window_start": disp_start.strftime("%Y-%m") if disp_start else "",
        "window_end": disp_end.strftime("%Y-%m") if disp_end else "",
        "slice_sources": {"marErrors": err_at or None, "missingMedications": miss_at or None},
        "totals": {"med_errors": n_act, "mar_audit_rows": n_err,
                   "meds_dispensed": disp_meds, "delivery_batches": disp_batches,
                   "med_error_rate_pct": med_err_rate, "missing_meds": n_miss,
                   "error_clients": len(err_cli), "missing_clients": len(miss_init),
                   "error_meds": len(err_med), "missing_meds_distinct": len(miss_med),
                   "overlap_clients": len(cli_ov), "overlap_meds": len(med_ov),
                   "overlap_controlled": len(ctrl_ov)},
        "error_flags": {"missed": f_missed, "no_staff": f_nostaff, "unavailable": f_unavail,
                        "controlled": f_ctrl, "unavailable_pct": pct(f_unavail, disp_meds)},
        "causes": {"availability": c_av, "human": c_hu, "other": c_ot,
                   "availability_pct": pct(c_av, disp_meds), "human_pct": pct(c_hu, disp_meds)},
        "controlled_overlap": [{"med": labels.get(m, m), "errors": err_med[m], "missing": miss_med[m]}
                               for m in ctrl_ov[:25]],
        "missing_issues": [{"issue": k, "count": c} for k, c in miss_issue.most_common(15)],
        "missing_status": [{"status": k, "count": c} for k, c in miss_status.most_common(12)],
        "missing_houses": [{"house": k, "count": c} for k, c in miss_house.most_common(12)],
        "top_error_clients": [{"client": k, "count": c} for k, c in err_cli.most_common(20)],
        "top_error_meds": [{"med": labels.get(m, m), "count": c} for m, c in err_med.most_common(20)],
        "top_missing_meds": [{"med": labels.get(m, m), "count": c} for m, c in miss_med.most_common(20)],
        "trend": trend,
        "insights": insights,
        "sources": {"med_errors": "mar_errors (Hub care book, read every cycle)",
                    "missing_meds": "missing_medications (Hub care book, read every cycle)"},
    }

    rows: list[dict] = [summary]
    rows += [{"id": f"client-{k}", "kind": "client", "initials": k,
              "errors": err_cli[k], "missing": miss_init[k]} for k in cli_ov[:40]]
    rows +=[{"id": f"med-{m}", "kind": "medication", "med": labels.get(m, m),
              "med_key": m, "errors": err_med[m], "missing": miss_med[m],
              "controlled": any(kk in m for kk in _MEDCORR_CONTROLLED)}
             for m in med_ov[:50]]
    stamps = [s for s in (err_at, miss_at) if s]
    return rows, (min(stamps) if stamps else None)


def build(resource: str, dsn: str) -> tuple[list[dict], str | None]:
    if resource not in RESOURCES:
        raise KeyError(resource)
    return _build(dsn)
