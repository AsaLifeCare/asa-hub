"""Questionnaires' one write (Questionnaire.gs questionnaireSubmit): a person's answers scored here from the weights the
questionnaires tab carries and kept in app.questionnaire_responses — the Hub's database alone, never a sheet. Any
signed-in person may send one (the new hire's onboarding flow too), as the Apps Script door let them."""
from __future__ import annotations

import json
import secrets
from typing import Any, Callable

import gsjs
import locations as L
import questionnaires as Q
import smart_comms as SC
import writes as W
from scope import Defer

ACTION = "questionnaireSubmit"
ANSWERS_MAX = 45000
VISIT = "A questionnaire is sent from the signed-in account's own session; not inside a visit."


def submit(sess: L.Session, payload: dict) -> W.Decision:
    """questionnaireSubmit: the answers to one questionnaire, scored and kept; the answer says how many were answered
    and the score out of 5 (none when no answer is scored)."""
    user = sess.user or {}
    if not user or user.get("is_service"):
        return W.Decision({"status": 403, "message": "A questionnaire is answered by a person."})
    if user.get("visiting_member") or gsjs.trim(gsjs.or_blank((payload or {}).get("member"))):
        return W.Decision({"status": 403, "message": VISIT})
    qid = gsjs.str_((payload or {}).get("questionnaire_id"))
    mine = next((q for q in Q.questionnaire_all(sess.reads) if q["id"] == qid), None)
    if mine is None:
        return W.Decision({"status": 404, "message": f'No questionnaire "{qid}".'})
    try:
        answers = json.loads(gsjs.str_((payload or {}).get("answers")) or "{}") or {}
    except ValueError:
        answers = None
    if not isinstance(answers, dict):
        return W.Decision({"status": 400, "message": "The answers were not readable."})
    questions = mine["questions"]
    answered = sum(1 for q in questions if gsjs.str_(answers.get(q["id"])))
    result = Q.result_of(questions, answers)
    cur = W.HELD.get()
    if cur is None:
        raise Defer("a response is kept only under the platform's write lock")
    rid = "QR_" + secrets.token_hex(8).upper()
    cur.execute(f"insert into {Q.TABLE} (response_id, questionnaire_id, questionnaire_title, respondent,"
                " respondent_email, respondent_uid, role, answered, total, score, score_max, status, answers_json,"
                " write_id) values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 5, 'submitted', %s, %s)",
                (rid, qid, mine["title"],
                 gsjs.str_(user.get("display_name")) or gsjs.str_(user.get("name")) or gsjs.str_(user.get("email")),
                 gsjs.str_(user.get("email")), gsjs.str_(user.get("id")), gsjs.str_(user.get("role")) or "staff",
                 answered, len(questions), result["score"],
                 json.dumps(answers, ensure_ascii=False, separators=(",", ":"))[:ANSWERS_MAX], SC.write_id()))
    score = result["score"]
    said = f"{answered} of {len(questions)} answered" + ("." if score is None else f", scored {gsjs.num_str(score)}/5.")
    return W.Decision({"status": 200, "data": {"response_id": rid, "answered": answered, "total": len(questions),
                                               "score": score, "scored": result["scored"], "message": said}},
                      subject=qid, own=True)


ACTIONS: dict[str, Callable[[L.Session, dict], W.Decision]] = {ACTION: submit}
# HUB_POLICY: no roles (any signed-in person); the body is read by the door
POLICY: dict[str, dict[str, Any]] = {ACTION: {"params": {"questionnaire_id": "string", "answers": "string"}}}
# the platform's write lock held by another write: Python's own sentence, never a hand-off
BUSY_OF: dict[str, dict[str, Any]] = {a: {"status": 409, "message": W.BUSY} for a in ACTIONS}


class Store(W.Store):
    """app.questionnaires_writes and app.questionnaires_receipts beside the other apps' own; the responses are
    app.questionnaire_responses'."""

    def __init__(self, dsn: str | None = None, connect: Callable[[], Any] | None = None) -> None:
        super().__init__(dsn, connect, kind="questionnaires", label="Questionnaires")

    def settle(self, write_id: str, state: str, why: str = "", fields: list[str] | None = None) -> bool:
        """The relay's word on a write; a void also takes back the response kept under it."""
        done = super().settle(write_id, state, why, fields)
        if state == "void" and done:
            try:
                with self.conn().transaction():
                    self.conn().execute(f"delete from {Q.TABLE} where write_id = %s", (write_id,))
            except Exception as exc:  # noqa: BLE001 - said, never raised into the relay's settle
                W.log.warning("questionnaires: the void of %s was not applied (%s)", write_id[:40], type(exc).__name__)
        return done
