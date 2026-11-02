"""WHAT A CANDIDATE SAID ON A CALL — Staff Candidates › Interviews › Candidate preferences, heard once.
asa-hub-app owes this lane the calls a candidate's preferences are read on (app.candidate_call_prefs, naming the copies
that may hold the words); the lane reads the words from the relay's own copy, asks the platform's model (the /analyze
door's upstreams) what the candidate said, and keeps the checked answer — never the words themselves."""
from __future__ import annotations

import contextlib
import json
import logging
import os
import re
import sys
import time
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx
import psycopg2.extras

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import hub_rows  # noqa: E402
import mar_papers as mp  # noqa: E402 — the lanes' door into asa-hub-db and the relay's copy

log = logging.getLogger("hub.call_prefs")

PASS_S = float(os.getenv("HUB_CALL_PREFS_PASS_S", "60"))
BUDGET_S = float(os.getenv("HUB_CALL_PREFS_BUDGET_S", "120"))
BATCH = 10
RETRY_FIRST_S = 900.0
RETRY_MAX_S = 86400.0
WORDS_MAX = 24000
# the /analyze door's upstreams (snapshot_service ANALYZE_*): the pool first, the local model after
POOL_URL = os.getenv("HUB_ANALYZE_URL", "https://api.openai.com/v1/chat/completions")
# the pool's groups tried in turn: the door's own model, then the next group the gateway serves
POOL_MODELS = [m.strip() for m in os.getenv("HUB_CALL_PREFS_MODELS", os.getenv("HUB_ANALYZE_MODEL", "gpt-4o-mini")
                                            + ",ai-mistral").split(",") if m.strip()]
POOL_KEYS = [k for k in (os.getenv("LLM_API_KEY", ""), os.getenv("OPENAI_API_KEY", "")) if k]
LOCAL_URL = os.getenv("HUB_ANALYZE_LOCAL_URL", "http://local-cortex:8080/v1/chat/completions")
LOCAL_MODEL = os.getenv("HUB_ANALYZE_LOCAL_MODEL", "qwen2.5-7b-instruct")
ASK_TIMEOUT_S = float(os.getenv("HUB_CALL_PREFS_ASK_S", "45"))

YES_NO = ("shift_day", "shift_afternoon", "shift_night", "hours_ft", "hours_pt", "hours_prn", "every_other_weekend",
          "male_care", "behavioral_care", "has_dl", "has_vehicle", "has_insurance", "cert_dodd", "cert_cpr_first_aid",
          "cert_med_del")
TEXTS = ("availability", "earliest_start", "preferred_location")
# LineDirectory.gs LINE_ROLE_WORDS: the company's own lines, the agency's side of any call on them
COMPANY_LINES = ("3307544040", "3309195558", "3309195559", "3309197595", "3309197779", "9377166410")
_ERROR_CELL = re.compile(r"^#(ERROR!|REF!|NAME\?|VALUE!|DIV/0!|N/A|NULL!|NUM!)")
_PHONE = re.compile(r"\+?1?[\s().-]*\d{3}[\s().-]*\d{3}[\s.-]*\d{4}")
_TURN = re.compile(r"^(\s*\[[^\]]*\]\s*)([^:\n]{0,80}?)(\s*:)", re.M)

PROMPT = """You read the transcript of a phone call between a home-care agency (ASA Lifecare) and a job candidate for a \
Direct Support Professional position. Report ONLY what the CANDIDATE clearly stated about themselves. Never guess: \
when the call does not settle a question, answer "".

Answer one JSON object with exactly these keys:
- shift_day, shift_afternoon, shift_night: "Yes" when the candidate can work that shift, "No" when they cannot.
- hours_ft, hours_pt, hours_prn: "Yes" when they want full-time / part-time / PRN (as-needed) hours, "No" when not.
- every_other_weekend: "Yes" or "No" — can they work every other weekend.
- male_care: "Yes" or "No" — are they willing to provide personal care to male clients.
- behavioral_care: "Yes" or "No" — are they willing to work with clients with behavioral needs.
- has_dl: "Yes" or "No" — do they hold a valid driver's license.
- has_vehicle: "Yes" or "No" — do they have a reliable vehicle.
- has_insurance: "Yes" or "No" — do they have car insurance.
- cert_dodd, cert_cpr_first_aid, cert_med_del: "Yes" or "No" — do they hold the DODD certificate, CPR / First Aid, \
Medication Delegation.
- availability: their availability in a few words, as they said it ("" if not said).
- earliest_start: when they can start, as they said it ("" if not said).
- preferred_location: the city or area they want to work in ("" if not said).
Every value is a string. Answer the JSON object alone."""


def _t() -> str:
    return mp._t("candidate_call_prefs")


def words(sources: list[list[str]], call_id: str) -> str:
    """The call's words from the relay's copy of the inboxes the app named, the best copy (the dialogue counts
    double): the speakers named Agency (a company line) and Candidate, every other number left out."""
    rows: list[dict] = []
    for sheet_id, tab in (s for s in sources if isinstance(s, list) and len(s) == 2):
        got = hub_rows.tabs([{"sheet_id": str(sheet_id), "tab": str(tab), "where": {k: str(call_id)}}
                             for k in ("call_id", "Call ID")])
        hits = dict(rn_d for t in got for rn_d in t["rows"])
        rows += [hits[rn] for rn in sorted(hits)[:5] if isinstance(hits[rn], dict)]
    best, score = "", -1
    for d in rows:
        def cell(*keys: str) -> str:
            for k in keys:
                v = str(d.get(k) or "").strip()
                if v and not _ERROR_CELL.match(v):
                    return v
            return ""
        spoken = cell("speaker_transcript", "Speaker Transcript")
        full = cell("full_transcript", "Full Transcript")
        if len(spoken) * 2 + len(full) > score:
            best, score = spoken or full, len(spoken) * 2 + len(full)
    def who(m: re.Match) -> str:
        said = re.sub(r"\D", "", m.group(2))[-10:]
        name = "Agency" if said in COMPANY_LINES else ("Candidate" if len(said) == 10 else m.group(2))
        return m.group(1) + name + m.group(3)

    return _PHONE.sub("[number]", _TURN.sub(who, best))[:WORDS_MAX]


def ask(text: str) -> tuple[dict[str, Any], str]:
    """One completion from the first upstream that answers: (the parsed object, the upstream/model that gave it)."""
    ups = []
    if POOL_URL and POOL_KEYS:
        ups += [("pool", POOL_URL, model, POOL_KEYS) for model in dict.fromkeys(POOL_MODELS)]
    if LOCAL_URL:
        ups.append(("local-cortex", LOCAL_URL, LOCAL_MODEL, [""]))
    refusals = []
    deadline = time.monotonic() + ASK_TIMEOUT_S * 2
    for name, url, model, keys in ups:
        for key in keys:
            left = deadline - time.monotonic()
            if left <= 1:
                break
            body = {"model": model, "temperature": 0, "response_format": {"type": "json_object"},
                    "messages": [{"role": "system", "content": PROMPT}, {"role": "user", "content": text}]}
            try:
                r = httpx.post(url, json=body, headers={"Authorization": f"Bearer {key}"} if key else {},
                               timeout=min(ASK_TIMEOUT_S, left))
                if r.status_code >= 400:
                    refusals.append(f"{name}/{model} {r.status_code}")
                    continue
                content = (((r.json().get("choices") or [{}])[0].get("message") or {}).get("content")) or ""
                got = json.loads(re.sub(r"^```(?:json)?\s*|\s*```$", "", content.strip()))
                if isinstance(got, dict):
                    return got, f"{name}/{model}"
                refusals.append(f"{name}/{model} answered no object")
            except Exception as exc:  # noqa: BLE001 — the type only: a message may carry the words
                refusals.append(f"{name}/{model} {type(exc).__name__}")
    raise RuntimeError("no model answered (" + "; ".join(refusals or ["no upstream configured"]) + ")")


def checked(got: dict[str, Any]) -> dict[str, str]:
    """The answer as the screen may show it: Yes/No or blank for each question, a short text for the three others."""
    out: dict[str, str] = {}
    for k in YES_NO:
        v = str(got.get(k) or "").strip().lower()
        out[k] = v if v in ("yes", "no") else ""
    for k in TEXTS:
        v = re.sub(r"\s+", " ", str(got.get(k) or "")).strip()
        out[k] = "" if v.lower() in ("n/a", "none", "unknown", "not said", "not stated") else v[:160]
    return out


def _retry_s(attempts: int) -> float:
    return min(RETRY_MAX_S, RETRY_FIRST_S * (2 ** max(0, attempts - 1)))


def drain(conn, deadline: float) -> dict[str, int]:
    """The calls owed, oldest due first, until the deadline; a failure is kept with its retry, never 'read'."""
    got = {"read": 0, "failed": 0}
    while time.monotonic() < deadline:
        with conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(f"select call_id, sources, attempts from {_t()}"
                        " where state <> 'read' and next_try_at <= now() order by next_try_at, call_id limit %s",
                        (BATCH,))
            rows = [dict(r) for r in cur.fetchall()]
        if not rows:
            break
        for row in rows:
            if time.monotonic() >= deadline:
                break
            started, now = time.monotonic(), datetime.now(timezone.utc)
            try:
                text = words(row["sources"] if isinstance(row["sources"], list) else [], row["call_id"])
                if not text.strip():
                    raise RuntimeError("the copy holds no words for this call")
                answer, model = ask(text)
                prefs = checked(answer)
            except Exception as exc:  # noqa: BLE001
                why = str(exc) if isinstance(exc, RuntimeError) else f"the reading stopped ({type(exc).__name__})"
                attempts = int(row.get("attempts") or 0) + 1
                with conn, conn.cursor() as cur:
                    cur.execute(f"update {_t()} set state = 'failed', error = %s, attempts = %s, next_try_at = %s,"
                                " updated_at = %s where call_id = %s",
                                (why[:300], attempts, now + timedelta(seconds=_retry_s(attempts)), now,
                                 row["call_id"]))
                log.info("call prefs: %s not read (attempt %d): %s", row["call_id"], attempts, why[:160])
                got["failed"] += 1
                continue
            with conn, conn.cursor() as cur:
                cur.execute(f"update {_t()} set state = 'read', prefs = %s, model = %s, error = '',"
                            " attempts = attempts + 1, read_at = %s, seconds = %s, updated_at = %s where call_id = %s",
                            (psycopg2.extras.Json(prefs), model, now, round(time.monotonic() - started, 1), now,
                             row["call_id"]))
            got["read"] += 1
    return got


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    if not mp.DSN or os.getenv("HUB_CALL_PREFS", "on").strip().lower() in ("off", "0", "no"):
        log.warning("call prefs: no asa-hub-db door, or switched off — the lane is idle")
        while True:
            time.sleep(3600)
    log.info("call prefs keeper up (a pass every %.0fs)", PASS_S)
    conn = None
    while True:
        started = time.monotonic()
        try:
            if conn is None or conn.closed:
                conn = mp._connect(mp.DSN)
            said = drain(conn, started + BUDGET_S)
            if said["read"] or said["failed"]:
                log.info("call prefs pass: %s", json.dumps(said))
        except Exception as exc:  # noqa: BLE001 — never self-disables; the next pass retries
            log.warning("call prefs pass failed (%s: %.120s)", type(exc).__name__,
                        str(exc).splitlines()[0] if str(exc) else "")
            with contextlib.suppress(Exception):
                if conn is not None:
                    conn.close()
            conn = None
        time.sleep(max(15.0, PASS_S - (time.monotonic() - started)))


if __name__ == "__main__":
    main()
