"""Questionnaires (Questionnaire.gs; the `questionnaires` and `questionnaireResponses` resources, Main.gs routes) off
asa-hub-db: the questions as the questionnaires tab of the Hub's book carries them, and the responses — every one sent
since the app came to Python, kept in app.questionnaire_responses (db/questionnaire_responses.sql), and the ones the
questionnaireResponses tab held before. A client reads neither: neither resource names a client. A response is scored
here from the weights in the tab (questionnaireScore_ / questionnaireResult_), never by the browser."""
from __future__ import annotations

import json
import math
import re
import time
from typing import Any, Callable

import gsjs
import hubdb
import locations as L
import scope as sc
from candidates import js_parse_float

APP_ID = "questionnaires"
TAB = "questionnaires"
RESPONSES_TAB = "questionnaireResponses"
TABLE = "app.questionnaire_responses"
CLIENTS = ("client", "guardian")
# the tab's own columns, in its order: what a response reads as, wherever it is kept
RESPONSE_COLUMNS = ("response_id", "questionnaire_id", "questionnaire_title", "respondent", "respondent_email", "role",
                    "submitted_at", "answered", "total", "score", "score_max", "status", "answers_json")
_SELECT = ("select response_id, questionnaire_id, questionnaire_title, respondent, respondent_email, role,"
           " to_char(submitted_at at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"'), answered, total, score,"
           f" score_max, status, answers_json from {TABLE} order by submitted_at, response_id")
MONTH_MS = 30.44 * 86400000


def _ref(reads: L.Reads, tab: str) -> hubdb.TabRef | None:
    res = reads.db.resolve(tab)
    if res.runtime:
        raise hubdb.Unreadable(f"{tab} lives in the depot's facts")
    if res.ref is None and not res.book_known:
        raise hubdb.Unreadable(f"asa-hub-db holds no copy of the book behind {tab}")
    return res.ref


def question_rows(reads: L.Reads) -> list[dict]:
    """listRows_('questionnaires'): every question row as the tab carries it, Python's own kept edits laid."""
    return [dict(r) for r in reads.once("questionnaires:rows", lambda: reads.db.sheetdb_rows(_ref(reads, TAB)))]


def questionnaire_all(reads: L.Reads) -> list[dict[str, Any]]:
    """questionnaireAll_: the questionnaires, each with its questions in their number's order."""
    rows = reads.once("questionnaires:norm", lambda: reads.db.normalized_rows(_ref(reads, TAB)))
    by: dict[str, dict[str, Any]] = {}
    for r in rows:
        qid, prompt = gsjs.str_(r.get("questionnaireid")), gsjs.str_(r.get("prompt"))
        if not qid or not prompt:
            continue
        q = by.get(qid)
        if q is None:
            q = by[qid] = {"id": qid, "title": gsjs.str_(r.get("questionnairetitle")) or qid,
                           "audience": gsjs.str_(r.get("audience")) or "all-staff",
                           "source_sheet": gsjs.str_(r.get("sourcesheet")), "questions": []}
        weight = js_parse_float(str(gsjs.or_blank(r.get("weight"))).replace(",", ".", 1))
        n = len(q["questions"])
        number = js_parse_float(gsjs.str_(r.get("qnumber")))
        q["questions"].append({
            "id": gsjs.str_(r.get("questionid")) or f"{qid}-q{n + 1}",
            "number": int(number) if number and math.isfinite(number) else n + 1,
            "kind": gsjs.str_(r.get("kind")) or "text", "prompt": prompt, "metric": gsjs.str_(r.get("metric")),
            "weight": weight if weight is not None and math.isfinite(weight) else 0.0,
            "yes_is": gsjs.str_(r.get("yesis")), "unit": gsjs.str_(r.get("unit")),
            "purpose": gsjs.str_(r.get("purpose"))})
    for q in by.values():
        q["questions"].sort(key=lambda x: x["number"])
    return list(by.values())


def score_of(q: dict[str, Any], raw: Any, now_ms: float | None = None) -> float | None:
    """questionnaireScore_: 1–5 for a scored answer; None for open text, a diagnostic and anything unreadable."""
    v = gsjs.str_(raw)
    if not v:
        return None
    k = str(q.get("kind") or "").lower()
    if k == "text" or not q.get("metric") or q.get("metric") == "Diagnostic Only":
        return None
    if k == "scale":
        n = js_parse_float(v)
        return None if n is None else max(1.0, min(5.0, n))
    if k == "yesno":
        said = v.strip().lower()
        if said not in ("yes", "no"):
            return None
        return 5.0 if said == str(q.get("yes_is") or "yes").lower() else 1.0
    if k == "number":
        num = js_parse_float(re.sub(r"[^0-9.\-]", "", v))
        if num is None:
            return None
        # banded, not scaled: a count has no ceiling of its own
        if str(q.get("unit")) == "%":
            return 5.0 if num >= 90 else 4.0 if num >= 80 else 3.0 if num >= 70 else 2.0 if num >= 60 else 1.0
        return 5.0 if num >= 4 else 4.0 if num >= 3 else 3.0 if num >= 2 else 2.0 if num >= 1 else 1.0
    if k == "date":
        t = gsjs.date_parse(v)
        if t is None:
            return None
        months = ((time.time() * 1000 if now_ms is None else now_ms) - t) / MONTH_MS
        return 5.0 if months <= 6 else 4.0 if months <= 12 else 3.0 if months <= 18 else 2.0 if months <= 24 else 1.0
    return None


def result_of(questions: list[dict[str, Any]], answers: dict[str, Any]) -> dict[str, Any]:
    """questionnaireResult_: the weighted score out of 5 (one decimal), and how many answers it rests on."""
    got = top = 0.0
    scored = 0
    for q in questions:
        s = score_of(q, answers.get(q["id"]))
        if s is None:
            continue
        w = q.get("weight") or 0.0
        got += s * w
        top += 5 * w
        scored += 1
    return {"scored": scored, "score": gsjs.js_round((got / top) * 5 * 10) / 10 if top > 0 else None}


def _number(v: Any) -> Any:
    if v is None:
        return None
    f = float(v)
    return int(f) if f.is_integer() else f


def response_rows(reads: L.Reads) -> list[dict[str, Any]]:
    """Every response: the tab's own rows first, then the ones Python kept, oldest first."""
    def read() -> list[dict[str, Any]]:
        ref = _ref(reads, RESPONSES_TAB)
        sheet = reads.db.sheetdb_rows(ref)
        # the answers exactly as the cell holds their JSON text, by response
        texts = {gsjs.trim(gsjs.or_blank(hubdb.typed(raw.get("response_id"), "raw"))):
                 gsjs.or_blank(hubdb.typed(raw.get("answers_json"), "raw"))
                 for _rn, raw in (reads.db.rows(ref) if ref is not None else [])}
        try:
            kept = reads.db.query(_SELECT)
        except Exception as exc:  # noqa: BLE001 - FAIL-CLOSED: a response unread is never drawn as none
            raise hubdb.Unreadable(f"the questionnaire responses could not be read ({type(exc).__name__})") from exc
        mine = []
        for r in kept:
            row = dict(zip(RESPONSE_COLUMNS, r))
            for c in ("answered", "total", "score", "score_max"):
                row[c] = _number(row[c])
            if row["score"] is None:
                row["score"] = ""
            mine.append(row)
        held = {str(r["response_id"]) for r in mine}
        old = []
        for r in sheet:
            if gsjs.str_(r.get("response_id")) in held:
                continue
            r = dict(r)
            # the screen reads the answers as the cell's JSON text (JSON.parse), never as an object
            if isinstance(r.get("answers_json"), (dict, list)):
                r["answers_json"] = texts.get(gsjs.str_(r.get("response_id"))) or \
                    json.dumps(r["answers_json"], ensure_ascii=False, separators=(",", ":"))
            old.append(r)
        return old + mine
    return [dict(r) for r in reads.once("questionnaires:responses", read)]


def _client(sess: L.Session) -> bool:
    """A client, or an SSA or a FAMILY whatever its role says (scope.role_counts)."""
    user = sess.user or {}
    return user.get("is_service") is not True and (gsjs.js_str(user.get("role")).lower() in CLIENTS
                                                   or not sc.role_counts(user.get("types"), user.get("role")))


def _listed(rows: list[dict], p: dict) -> list[dict]:
    """listRows_'s q (any cell), offset and limit."""
    q = gsjs.trim(gsjs.or_blank(p.get("q"))).lower()
    if q:
        rows = [r for r in rows if any(q in (gsjs.js_str(v) if not isinstance(v, (dict, list)) else str(v)).lower()
                                       for v in r.values() if v is not None)]
    off = js_parse_float(gsjs.or_blank(p.get("offset")))
    off = int(off) if off is not None and math.isfinite(off) and off > 0 else 0
    lim = js_parse_float(gsjs.or_blank(p.get("limit")))
    if lim is None or not math.isfinite(lim) or lim < 0:
        return rows[off:]
    return rows[off:off + int(lim)]


def _door(rows_of: Callable[[L.Reads], list[dict]], key: str, resource: str
          ) -> tuple[Callable[[L.Session, dict], dict], Callable[[L.Session, dict], dict]]:
    def list_(sess: L.Session, payload: dict) -> dict[str, Any]:
        """route(resource, 'list'): every row; a client's narrowing names nothing, so a client reads none."""
        if _client(sess):
            return {"status": 200, "data": []}
        return {"status": 200, "data": _listed(rows_of(sess.reads), payload if isinstance(payload, dict) else {})}

    def get(sess: L.Session, payload: dict) -> dict[str, Any]:
        """route(resource, 'get'): one row by its id; "not yours" reads as "not here" for a client."""
        rid = gsjs.trim(gsjs.or_blank((payload or {}).get("id")))
        missing = {"status": 404, "message": f'No "{resource}" record with id "{rid}".'}
        if not rid:
            return {"status": 400, "message": 'Missing required "id" in payload.'}
        if _client(sess):
            return missing
        hit = next((r for r in rows_of(sess.reads) if gsjs.str_(r.get("id") or r.get(key)) == rid), None)
        return missing if hit is None else {"status": 200, "data": hit}

    return list_, get


questionnaires_list, questionnaires_get = _door(question_rows, "question_id", TAB)
responses_list, responses_get = _door(response_rows, "response_id", RESPONSES_TAB)

ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {
    "questionnairesList": questionnaires_list, "questionnairesGet": questionnaires_get,
    "questionnaireResponsesList": responses_list, "questionnaireResponsesGet": responses_get}
# the generic verbs declare no roles; each door's own gate decides
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
