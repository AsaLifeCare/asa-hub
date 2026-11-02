"""Staff Performance's metric definitions and reviews off asa-hub-db: Performance.gs perfMetricsList, perfReviewsList
and perfReviewSave translated, beside app/performance.py's board and under its store.

The reads are the copy of perf_metrics and perf_reviews with the kept edits laid over them; a review is a kept edit
(app.edits) appended to perf_reviews, final in Postgres, so the next read of the tab carries it."""
from __future__ import annotations

import math
import secrets
from typing import Any

import candidates as CND
import gsjs
import locations as L
import performance as P
import staff_perf as SPF
import staff_views
import writes as W
from writes import Decision

PERF_REVIEWS_TAB = "perf_reviews"
PERF_REVIEWS_HEADER = ("review_id", "person_id", "person_name", "period", "score", "strengths", "watch", "comments",
                       "reviewer", "created_at")
REVIEW_MATCH = W.COLS + "review_id"
SIGN_IN = {"status": 401, "message": "Sign in first"}


def _s(v: Any) -> str:
    return gsjs.str_(v)


def _number(v: Any) -> float:
    """Number(v) for a payload's value: null is 0."""
    return 0.0 if v is None else P._num(v)


def metrics_list(sess: L.Session, payload: dict) -> dict[str, Any]:
    """perfMetricsList: the metric definitions, for the settings screen."""
    if not sess.user:
        return dict(SIGN_IN)
    shown = [{**m, "target": P._out(m["target"]), "weight": P._out(m["weight"])} for m in P.perf_metrics(sess.reads)]
    return {"status": 200, "data": {"metrics": shown}}


def reviews_list(sess: L.Session, payload: dict) -> dict[str, Any]:
    """perfReviewsList: the reviews on file, newest first, one person's when the payload names one."""
    if not P._writer(sess.user):
        return dict(P.DENIED)
    rows = SPF._perf_rows(sess.reads, PERF_REVIEWS_TAB)
    pid = _s((payload or {}).get("person_id"))
    out = []
    for r in reversed(rows):
        if pid and _s(r.get("personid")) != pid:
            continue
        score = r.get("score")
        created = _s(r.get("createdat"))
        out.append({"person_id": _s(r.get("personid")), "person_name": _s(r.get("personname")),
                    "period": _s(r.get("period")), "score": None if score == "" else P._out(P._num(score)),
                    "strengths": _s(r.get("strengths")), "watch": _s(r.get("watch")),
                    "comments": _s(r.get("comments")), "reviewer": _s(r.get("reviewer")),
                    "created_at": created, "when": CND.when_label(created)})
    return {"status": 200, "data": {"reviews": out}}


def review_save(sess: L.Session, payload: dict) -> Decision:
    """perfReviewSave: one review filed for one person, a new perf_reviews row each time."""
    if not P._writer(sess.user):
        return W.refuse(403, P.DENIED["message"])
    reads = sess.reads
    pid = _s(payload.get("person_id"))
    if not pid:
        return W.refuse(400, "person_id is required")
    score: Any = ""
    if "score" in payload:
        n = _number(payload.get("score"))
        score = "NaN" if math.isnan(n) else n
    cells = {"review_id": "PFR_" + secrets.token_hex(7).upper(), "person_id": pid,
             "person_name": _s(payload.get("person_name")),
             "period": _s(payload.get("period")) or P.current_period(reads), "score": score,
             "strengths": _s(payload.get("strengths")), "watch": _s(payload.get("watch")),
             "comments": _s(payload.get("comments")),
             "reviewer": _s(payload.get("reviewer")) or "asa-hub:" + P._by(sess.user), "created_at": P._now(reads)}
    sid, name = W.where_of(W.tab_of(reads, PERF_REVIEWS_TAB))
    rec = W.kept_record(sid, name, "append", REVIEW_MATCH, cells["review_id"], pid,
                        {h: cells[h] for h in PERF_REVIEWS_HEADER})
    staff_views.record(sess.user, "perfReviewSave", pid)
    return W.final({"status": 200, "data": {"saved": True}}, [rec], pid)


# ---- the doors -----------------------------------------------------------------------------------------------------

READS: dict[str, Any] = {"perfMetricsList": metrics_list, "perfReviewsList": reviews_list}
READ_POLICY = {"perfMetricsList": {"roles": (), "params": {}},
               "perfReviewsList": {"roles": P.ROLES, "params": {}}}
ACTIONS: dict[str, Any] = {"perfReviewSave": review_save}
POLICY = {"perfReviewSave": {"roles": P.ROLES, "params": {}}}
