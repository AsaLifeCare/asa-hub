"""The AI lane test (KeyStress.gs aiKeyStress) on Python: every key of the phone screen's provider ladder
(client_care_sweeps.providers) asked the same small question a few rounds over, each graded ok, dead, throttled, sick
or wrong_model. The relay's own leg — its /analyze fleet, whose secret only the relay holds — is asked by the relay and
handed in as each round's answer, graded here the same way. The ladder's keys live in this service's environment, so
nothing is retired here."""
from __future__ import annotations

import json
import re
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Callable

import requests

import client_care_sweeps as CCS
import gsjs
import locations as L
import staff_views

ACTION = "aiKeyStress"
DENIED = {"status": 403, "message": "Requires an admin or manager account"}
# two rounds is the floor that makes n_ok * 2 >= rounds a majority
ROUNDS_DEFAULT = 2
ROUNDS_MAX = 5
GAP_S = 1.2
CALL_TIMEOUT_S = 20.0
# must name JSON: OpenAI and Groq refuse json_object mode otherwise, grading every key sick
PROMPT = 'Reply as JSON: {"what": "one short sentence on what an API rate limit is"}'
DEAD_SIGNATURES = ("invalid api key", "invalid_api_key", "incorrect api key", "api key not valid", "unauthorized",
                   "no auth credentials")
MODEL_SIGNATURES = ("model_not_found", "model not found", "does not exist", "decommissioned", "unknown model",
                    "invalid model", "no such model", "end of life", "no longer available", "has been retired",
                    "sunset")
QUOTA_SIGNATURES = ("rate limit", "rate_limit", "quota", "insufficient_quota", "too many requests", "billing")
RELAY = "relay"
RELAY_PROP = "HUB_SERVICE_SECRET"
RELAY_MODEL = "(the relay decides — HUB_ANALYZE_MODEL)"
MODELS_LISTED = 40
_SPACES = re.compile(r"\s+")


def has(text: Any, words: tuple[str, ...]) -> bool:
    t = gsjs.or_blank(text).lower()
    return any(w in t for w in words)


def mask(key: str) -> str:
    """keyStressMask_."""
    if len(key) <= 10:
        return "••••" if key else ""
    return key[:4] + "…" + key[-4:]


def new_rec() -> dict[str, Any]:
    return {"n_ok": 0, "n_auth": 0, "n_429": 0, "n_5xx": 0, "n_timeout": 0, "n_empty": 0, "n_model": 0, "tokens": 0,
            "sample": "", "lat": []}


def verdict_of(t: dict[str, Any], rounds: int) -> str:
    """keyStressVerdict_: dead first, wrong_model before sick, throttled only when nothing else failed."""
    if t["n_auth"] > 0:
        return "dead"
    if t["n_model"] > 0 and t["n_ok"] == 0:
        return "wrong_model"
    if t["n_ok"] * 2 >= rounds:
        return "ok"
    if t["n_429"] > 0 and (t["n_5xx"] + t["n_timeout"] + t["n_empty"] + t["n_model"]) == 0:
        return "throttled"
    return "sick"


def relay_unwrap(body: str) -> tuple[int, str]:
    """keyStressRelayUnwrap_: the relay answers 200 carrying its own status; (code, body to grade)."""
    try:
        env = json.loads(body)
    except ValueError:
        env = None
    if not isinstance(env, dict):
        return 502, gsjs.or_blank(body)[:140]
    inner = env.get("status") or 0
    inner = inner if isinstance(inner, (int, float)) else 0
    if inner >= 400:
        # never cut: the model signatures are matched against the whole message
        return int(inner), gsjs.or_text(env.get("message"))
    data = env.get("data") or env
    try:
        content = ((data.get("choices") or [{}])[0].get("message") or {}).get("content") or ""
        tokens = (data.get("usage") or {}).get("completion_tokens") or 0
    except (AttributeError, IndexError, TypeError):
        content, tokens = "", 0
    if not content and isinstance(data.get("error"), dict):
        return int(data["error"].get("code") or 502) or 502, gsjs.or_text(data["error"].get("message"))
    if not content:
        return 200, ""
    return 200, json.dumps({"choices": [{"message": {"content": content}}], "usage": {"completion_tokens": tokens}})


def score(rec: dict[str, Any], code: int, body: str) -> None:
    """keyStressScore_: one round's answer counted on its key."""
    short = _SPACES.sub(" ", gsjs.or_blank(body)[:140]).strip()
    if not code:
        rec["n_5xx"] += 1
        rec["sample"] = rec["sample"] or "no response"
        return
    if code < 400:
        try:
            env = json.loads(body)
            text = ((env.get("choices") or [{}])[0].get("message") or {}).get("content") or ""
            toks = (env.get("usage") or {}).get("completion_tokens") or 0
            toks = toks if isinstance(toks, (int, float)) else 0
        except (ValueError, AttributeError, IndexError, TypeError):
            text, toks = "", 0
        # a 200 carrying nothing is not an answer
        if text or toks > 0:
            rec["n_ok"] += 1
            rec["tokens"] += int(toks)
        else:
            rec["n_empty"] += 1
            rec["sample"] = rec["sample"] or "2xx but empty output"
        return
    said = f"HTTP {code}: {short}"
    if code in (401, 403) or (code == 400 and has(body, DEAD_SIGNATURES)):
        rec["n_auth"] += 1
    elif code == 404 or has(body, MODEL_SIGNATURES):
        # a refused model arrives as 404, 400 or the relay's 502; only the words are constant
        rec["n_model"] += 1
    elif code in (429, 402) or has(body, QUOTA_SIGNATURES):
        rec["n_429"] += 1
    else:
        rec["n_5xx"] += 1
    rec["sample"] = rec["sample"] or said


def ask(p: dict[str, Any], model: str) -> tuple[int, str, int, str]:
    """One round on one key: (code, body, milliseconds, why it never answered)."""
    started = time.monotonic()
    body = {"model": model, "temperature": 0.2, "messages": [{"role": "user", "content": PROMPT}],
            "response_format": {"type": "json_object"}}
    try:
        r = requests.post(p["url"], json=body, headers={"Authorization": "Bearer " + p["key"]},
                          timeout=CALL_TIMEOUT_S)
        return r.status_code, r.text, int((time.monotonic() - started) * 1000), ""
    except Exception as exc:  # noqa: BLE001 - a round that never answered is counted, never raised
        return 0, "", int((time.monotonic() - started) * 1000), str(exc) or type(exc).__name__


def models_offered(p: dict[str, Any]) -> list[str]:
    """keyStressModelsOffered_: what the provider serves today, for a refused model's line."""
    try:
        r = requests.get(re.sub(r"/chat/completions\s*$", "", p["url"]) + "/models",
                         headers={"Authorization": "Bearer " + p["key"]}, timeout=CALL_TIMEOUT_S)
        if r.status_code >= 400:
            return []
        data = (r.json() or {}).get("data") or []
    except Exception:  # noqa: BLE001 - nothing offered is an answer
        return []
    out = [gsjs.trim(gsjs.or_text((d or {}).get("id"))) for d in data[:MODELS_LISTED] if isinstance(d, dict)]
    return sorted(x for x in out if x)


def verdict_line(totals: dict[str, int], offered: dict[str, list[str]]) -> str:
    working = totals["ok"] + totals["throttled"]
    if totals["wrong_model"] > 0 and totals["ok"] == 0:
        names = [n for u in offered.values() for n in (u or [])[:8]]
        return (f"{totals['wrong_model']} key(s) authenticate but the MODEL is refused — the keys are valid, the "
                f"model name is not. Set GROQ_MODEL / OPENAI_MODEL" +
                (". The provider currently serves: " + ", ".join(names) if names else "."))
    if working == 0:
        return (f"No provider can answer: {totals['dead']} dead, {totals['sick']} sick, {totals['throttled']} "
                f"throttled. The phone screen has no AI.")
    if totals["ok"] == 0:
        return (f"Nothing generated, but {totals['throttled']} key(s) are merely capped — valid keys waiting on "
                f"quota, not garbage. Do not remove them.")
    return (f"{totals['ok']} key(s) answering" + (f", {totals['throttled']} capped" if totals["throttled"] else "") +
            (f", {totals['dead']} dead" if totals["dead"] else "") +
            (f", {totals['wrong_model']} on a refused model" if totals["wrong_model"] else "") +
            (f", {totals['sick']} sick" if totals["sick"] else "") + ".")


def rounds_of(p: dict[str, Any]) -> int:
    n = p.get("rounds")
    try:
        n = float(n) if n not in (None, "", 0) else ROUNDS_DEFAULT
    except (TypeError, ValueError):
        n = ROUNDS_DEFAULT
    if not n >= 1:
        n = ROUNDS_DEFAULT
    return int(min(round(n), ROUNDS_MAX))


def ai_key_stress(sess: L.Session, payload: dict) -> dict[str, Any]:
    """aiKeyStress: the ladder's keys measured, the relay's leg graded from what it handed in, one line saying it."""
    user = sess.user or {}
    if gsjs.js_str(user.get("role")) != "admin" or user.get("is_service"):
        return dict(DENIED)
    p = payload if isinstance(payload, dict) else {}
    rounds = rounds_of(p)
    t0 = time.monotonic()
    cfg = CCS.ai_config(sess.reads, "")
    cast: list[dict[str, Any]] = []
    skipped: list[dict[str, str]] = []
    for prov in CCS.providers():
        if not prov["key"]:
            skipped.append({"provider": prov["name"], "why": "no key in " + prov["prop"]})
            continue
        cast.append({"p": prov, "model": CCS._model(sess.reads, prov, cfg), "rec": new_rec()})
    leg = p.get("relay_leg")
    if isinstance(leg, list) and leg:
        cast.append({"p": {"name": RELAY, "prop": RELAY_PROP, "url": gsjs.or_text(p.get("relay_url")), "key": ""},
                     "model": RELAY_MODEL, "rec": new_rec(), "leg": leg[:rounds]})
    else:
        skipped.append({"provider": RELAY, "why": gsjs.or_text(p.get("relay_why")) or "the relay did not ask its leg"})
    if not cast:
        return {"status": 200, "data": {"ok": False, "rounds": rounds, "tested": 0, "skipped": skipped,
                                        "verdict_line": "No provider has a key — nothing to test.", "providers": [],
                                        "totals": {"ok": 0, "dead": 0, "throttled": 0, "sick": 0, "wrong_model": 0,
                                                   "tokens": 0}}}
    keyed = [it for it in cast if "leg" not in it]
    with ThreadPoolExecutor(max_workers=max(1, len(keyed))) as pool:
        for r in range(rounds):
            for it, (code, body, ms, why) in zip(keyed, pool.map(lambda it: ask(it["p"], it["model"]), keyed)):
                it["rec"]["lat"].append(ms)
                if why:
                    it["rec"]["n_timeout"] += 1
                    it["rec"]["sample"] = it["rec"]["sample"] or "unreachable: " + why[:90]
                    continue
                score(it["rec"], code, body)
            if r < rounds - 1:
                time.sleep(GAP_S)
    for it in cast:
        for got in it.get("leg") or ():
            got = got if isinstance(got, dict) else {}
            it["rec"]["lat"].append(int(got.get("ms") or 0))
            if got.get("error"):
                it["rec"]["n_timeout"] += 1
                it["rec"]["sample"] = it["rec"]["sample"] or "unreachable: " + gsjs.or_text(got["error"])[:90]
                continue
            code, body = int(got.get("code") or 0), gsjs.or_text(got.get("body"))
            if code and code < 400:
                code, body = relay_unwrap(body)
            score(it["rec"], code, body)

    totals = {"ok": 0, "dead": 0, "throttled": 0, "sick": 0, "wrong_model": 0, "tokens": 0}
    rows: list[dict[str, Any]] = []
    offered: dict[str, list[str]] = {}
    for it in cast:
        rec, prov = it["rec"], it["p"]
        v = verdict_of(rec, rounds)
        totals[v] += 1
        totals["tokens"] += rec["tokens"]
        avg = round(sum(rec["lat"]) / len(rec["lat"])) if rec["lat"] else 0
        if v == "wrong_model" and prov["key"] and prov["url"] not in offered:
            offered[prov["url"]] = models_offered(prov)
        # a verdict that survived failures says how many, or ok beside a failed sample reads as a lie
        bad = rec["n_model"] + rec["n_5xx"] + rec["n_timeout"] + rec["n_empty"] + rec["n_429"]
        sample = rec["sample"]
        if rec["n_ok"] > 0 and bad > 0:
            sample = f"answered {rec['n_ok']} of {rounds} — the other round(s) failed: {rec['sample'] or 'no detail'}"
        rows.append({"provider": prov["name"], "host": gsjs.or_text(prov["url"]), "retired": False,
                     "key_prop": prov["prop"], "key_masked": mask(prov["key"]) if prov["key"] else "",
                     "model": it["model"], "verdict": v, "n_ok": rec["n_ok"], "n_auth": rec["n_auth"],
                     "n_429": rec["n_429"], "n_5xx": rec["n_5xx"], "n_timeout": rec["n_timeout"],
                     "n_empty": rec["n_empty"], "n_model": rec["n_model"], "tokens": rec["tokens"], "avg_ms": avg,
                     "sample": sample})
    line = verdict_line(totals, offered)
    ms = int((time.monotonic() - t0) * 1000)
    staff_views.record(user, "ai_key_stress", f"{line} ({rounds} rounds, {len(cast)} keys, {ms}ms)",
                       200 if totals["ok"] > 0 else 502)
    return {"status": 200, "data": {"ok": totals["ok"] > 0, "rounds": rounds, "tested": len(cast), "skipped": skipped,
                                    "ms": ms, "totals": totals, "rows": rows, "models_offered": offered,
                                    "verdict_line": line}}


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {ACTION: ai_key_stress}
# HUB_POLICY names admin alone; the door answers it in Apps Script's words
POLICY: dict[str, dict[str, Any]] = {ACTION: {}}
