"""POST /analyze — the relay's analysis fallback, here: one chat completion for the Hub when its own provider refused,
asked of the pool (HUB_ANALYZE_URL with LLM_API_KEY or OPENAI_API_KEY) and then local-cortex, every door within one
budget; the caller's service secret is its gate. The AI lane test's leg asks it in-process (door_rungs)."""
from __future__ import annotations

import hmac
import json
import logging
import os
import time
from typing import Any

from fastapi.responses import Response

log = logging.getLogger("asa-hub-app.analyze")

SERVICE_SECRET = os.getenv("HUB_SERVICE_SECRET", "")
ANALYZE_KEYS = [k for k in (os.getenv("LLM_API_KEY", ""), os.getenv("OPENAI_API_KEY", "")) if k]
ANALYZE_URL = os.getenv("HUB_ANALYZE_URL", "https://api.openai.com/v1/chat/completions")
ANALYZE_MODEL = os.getenv("HUB_ANALYZE_MODEL", "gpt-4o-mini")
ANALYZE_LOCAL_URL = os.getenv("HUB_ANALYZE_LOCAL_URL", "http://local-cortex:8080/v1/chat/completions")
ANALYZE_LOCAL_MODEL = os.getenv("HUB_ANALYZE_LOCAL_MODEL", "qwen2.5-7b-instruct")
ANALYZE_BUDGET_S = float(os.getenv("HUB_ANALYZE_BUDGET_S", "45"))


def _analyze_upstreams(asked_model: str) -> list[dict[str, Any]]:
    """The doors to try, in order; one skipped for want of a key is still named."""
    ups: list[dict[str, Any]] = []
    if ANALYZE_URL:
        ups.append({"name": "pool", "url": ANALYZE_URL, "model": asked_model or ANALYZE_MODEL,
                    "keys": ANALYZE_KEYS if ANALYZE_KEYS else []})
    if ANALYZE_LOCAL_URL:
        ups.append({"name": "local-cortex", "url": ANALYZE_LOCAL_URL, "model": ANALYZE_LOCAL_MODEL, "keys": [""]})
    return ups


async def _post(url: str, body: dict[str, Any], headers: dict[str, str], timeout: float) -> Any:
    """One upstream asked; its response."""
    import httpx  # noqa: PLC0415 - the test runner has none

    async with httpx.AsyncClient(timeout=timeout) as client:
        return await client.post(url, json=body, headers=headers)


async def answer(body: dict[str, Any]) -> dict[str, Any]:
    """The route's answer to a body already read."""
    given = str(body.get("service_secret") or "")
    if not SERVICE_SECRET or not hmac.compare_digest(given, SERVICE_SECRET):
        log.warning("analyze: refused, bad or missing service secret")
        return {"status": 401, "message": "service identity required"}
    messages = body.get("messages")
    if not isinstance(messages, list) or not messages:
        return {"status": 400, "message": "messages: a non-empty list is required"}
    upstreams = _analyze_upstreams(str(body.get("model") or ""))
    if not upstreams:
        return {"status": 503, "message": "no model upstream configured on the server"}
    payload: dict[str, Any] = {"temperature": float(body.get("temperature", 0)), "messages": messages}
    if body.get("response_format"):
        payload["response_format"] = body["response_format"]
    # the pool is not one model: the strict shape first, then the same question bare
    attempts = [payload]
    if payload.get("response_format"):
        bare = dict(payload)
        bare.pop("response_format")
        attempts.append(bare)
    refusals: list[str] = []
    deadline = time.monotonic() + ANALYZE_BUDGET_S
    for up in upstreams:
        if not up["keys"]:
            refusals.append(f"{up['name']}/{up['model']} not tried (no key configured)")
            continue
        for attempt in attempts:
            shaped = dict(attempt)
            shaped["model"] = up["model"]
            for key in up["keys"]:
                left = deadline - time.monotonic()
                if left <= 1.0:
                    refusals.append(f"{up['name']}/{up['model']} not tried (budget spent)")
                    break
                try:
                    headers = {"Authorization": f"Bearer {key}"} if key else {}
                    r = await _post(up["url"], shaped, headers, min(90.0, left))
                    if r.status_code >= 400:
                        refusals.append(f"{up['name']}/{up['model']} {r.status_code}: {r.text[:100]}")
                        continue
                    data = r.json()
                    content = (((data.get("choices") or [{}])[0].get("message") or {}).get("content"))
                    if not content:
                        refusals.append(f"{up['name']}/{up['model']} empty completion")
                        continue
                    log.info("analyze: answered for the Hub by %s/%s (%d chars, format=%s)", up["name"], up["model"],
                             len(content), "strict" if shaped.get("response_format") else "free")
                    return {"status": 200, "data": {"choices": [{"message": {"content": content}}]}}
                except Exception as exc:  # noqa: BLE001 - every door that refused is named
                    refusals.append(f"{up['name']}/{up['model']} {type(exc).__name__}: {str(exc)[:80]}")
                    continue
    said = " | ".join(dict.fromkeys(refusals)) or "no upstream was tried"
    log.warning("analyze: nothing answered — %s", said[:600])
    return {"status": 502, "message": f"no model answered: {said[:300]}"}


def rendered(env: dict[str, Any]) -> bytes:
    """A returned dict as FastAPI renders it."""
    return json.dumps(env, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode("utf-8")


async def analyze(request: Any) -> Response:
    """POST /analyze."""
    try:
        body = json.loads(await request.body())
    except Exception:  # noqa: BLE001
        body = None
    if not isinstance(body, dict):
        return Response(content=rendered({"status": 400, "message": "invalid body"}), media_type="application/json")
    return Response(content=rendered(await answer(body)), media_type="application/json")


def install(app: Any) -> None:
    app.post("/analyze", include_in_schema=False)(analyze)
