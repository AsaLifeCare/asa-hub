"""The Lead Scraper's Hub doors (apps-script/Scraper.gs) on Python: its settings (scraperConfig, kept in
app.resource_rows as `scraperConfig`), and the reads its outside calls are made in — the Brittco portal walked
(scraperRunPrepare) and the open referrals rated by the model (scraperScorePrepare). The referrals are Potential
Clients' rows: in app.resource_rows once that app is Python's, else on its sheet. Nothing of a referral's raw record
(it carries Medicaid numbers) is kept; the portal's password and the rating key are the service's own settings, never a
cell."""
from __future__ import annotations

import concurrent.futures
import json
import logging
import re
import time
from datetime import datetime
from typing import Any, Callable

import requests

import candidates as CND
import gsjs
import hubdb
import locations as L
import resource_rows as RR
import talent_pipeline as TP
from gsjs import NY

log = logging.getLogger("asa-hub-app")

CONFIG_TAB, CONFIG_RESOURCE = "scraper_config", "scraperConfig"
LEADS = "potentialClients"
PASSWORD_PROP, OPENAI_PROP, OPENPHONE_PROP = "BRITTCO_PASSWORD", "OPENAI_API_KEY", "OPENPHONE_API_KEY"
CONFIG_DEFAULT = (
    ("login_url", "https://starkdd.brittcosoftware.com/login", "POST target for the sign-in form"),
    ("referrals_url", "https://starkdd.brittcosoftware.com/providers/referrals", "Open referrals list"),
    ("email", "", "Portal account. The password is a Script Property, never a cell."),
    ("pages", "2", "How many pages to walk per run"),
    ("enabled", "no", "yes = the button and the schedule may run it"),
    ("home_zip", "44709", "Distance is scored against this ZIP"),
    ("score_batch_size", "50", "How many referrals to rate per pass"),
    ("score_threshold", "7", "Above this rating a referral is worth a text message"),
    ("score_model", "gpt-5.1", "Model used for the rating"),
    ("notify_enabled", "no", "yes = the Notify button may send text messages"),
    ("notify_from", "+13309195558", "Sending number (the Automations line, when it resolves)"),
    ("notify_recipients", "", "Comma-separated numbers in +1########## form"),
    ("score_system", "", "Instruction given to the model. Blank = the built-in default."),
    ("score_prompt", "",
     "The rating criteria. {{placeholders}} are filled per referral. Blank = the built-in default."))
LEAD_HEADER = ("id", "referral_id", "client_name", "client_age", "client_gender", "diagnosis", "frequency",
               "description", "postal_code", "phone", "email", "funding_source", "expiration_date", "ai_rating",
               "ai_notes", "sms_sent", "source", "scraped_at", "stage", "owner", "next_step", "notes")
SYSTEM_DEFAULT = ("You are an AI assistant specializing in client care analysis for a healthcare provider. "
                  "Always return responses in JSON format only.")
PROMPT_DEFAULT = "\n".join((
    "Analyze the following client data and assign a care rating (1-10) based on the following criteria:",
    "",
    "- Frequency of care (1-10 scale, 10 being 24/7 care) – Heavily weighted.",
    "- Distance to ZIP code {{home_zip}} (1-10 scale, 10 being closest) – Moderately weighted.",
    "- Gender (5 for male, 10 for female) – Less weighted.",
    "- Complexity of diagnosis and intellectual disability (1-10 scale, higher meaning more complex care required) – "
    "Moderately to heavily weighted.",
    "- Description of service needs.",
    "- Client age.",
    "- Client home phone (presence indicates contactability).",
    "- Client email (presence indicates contactability).",
    "",
    "Return ONLY a JSON object without explanations or additional text in this exact format:",
    '{"ai_rating": X, "ai_notes": "3-sentence summary of care needs."}',
    "",
    "Client details:",
    "- ID: {{referral_id}}",
    "- Name: {{client_name}}",
    "- Frequency: {{frequency}}",
    "- Service Description: {{description}}",
    "- Postal Code: {{postal_code}}",
    "- Gender: {{client_gender}}",
    "- Diagnosis: {{diagnosis}}",
    "- Age: {{client_age}}",
    "- Client home phone: {{phone}}",
    "- Client email: {{email}}"))
OPENAI_URL = "https://api.openai.com/v1/chat/completions"
HTTP_TIMEOUT_S = 30.0
# the walk and the rating stop starting new calls past this, inside the relay's wait for a prepare
PREPARE_DEADLINE_S = 90.0
RATE_WORKERS = 6

s_ = gsjs.str_


secret = TP.secret


def fill(template: str, values: dict[str, Any]) -> str:
    """scraperFillTemplate_: an unknown placeholder is left as written."""
    return re.sub(r"\{\{\s*([a-z0-9_]+)\s*\}\}",
                  lambda m: gsjs.or_blank(values[m.group(1)]) if m.group(1) in values else m.group(0),
                  template or "", flags=re.I)


# ---- the settings ------------------------------------------------------------------------------------------------

def config_rows(reads: L.Reads) -> list[tuple[str, str]]:
    """The settings tab's (key, value) rows as getValues() hands them; the shipped rows while it holds none."""
    got, why = CND.soft(lambda: reads.hub_rows(CONFIG_TAB))
    rows = [(gsjs.trim(gsjs.or_text(r.get("key"))), gsjs.trim(gsjs.or_blank(r.get("value"))))
            for r in (got or []) if not why]
    return rows or [(k, v) for k, v, _n in CONFIG_DEFAULT]


def config(reads: L.Reads) -> dict[str, str]:
    """scraperConfig_."""
    return reads.once("scraper_cfg", lambda: {k: v for k, v in config_rows(reads) if k})


def lead_date(v: Any) -> float | None:
    """scraperDate_: the instant, or None."""
    if isinstance(v, gsjs.SheetDate):
        return v.at.timestamp() * 1000.0
    return gsjs.date_parse(v)


def today_ms(reads: L.Reads) -> float:
    """new Date() with its hours set to 0, on the script's clock."""
    local = reads.now.astimezone(NY)
    return datetime(local.year, local.month, local.day, tzinfo=NY).timestamp() * 1000.0


def truthy(v: Any) -> bool:
    """scraperTruthy_."""
    if v is True:
        return True
    return gsjs.trim(gsjs.or_blank(v)).lower() in ("true", "yes", "y", "1", "sim")


def leads_owned(reads: L.Reads) -> bool:
    return reads.once("scraper_leads_owned", lambda: RR.uploaded(reads.db, LEADS))


def leads(reads: L.Reads) -> dict[str, Any]:
    """The referrals as the sheet hands them, each with where it is kept: {header, rows: [(key, cells, row)]} — the row
    key and stored cells of app.resource_rows once the app is Python's, else the id the sheet's row is found by."""
    if leads_owned(reads):
        cols = RR.columns(reads, LEADS)
        rows = []
        for k, cells in RR.table_rows(reads, LEADS):
            shown = RR.shown(cols, cells)
            if shown is not None:
                rows.append((k, cells, shown))
        return {"header": cols, "rows": rows, "owned": True}
    res = reads.db.resolve(LEADS)
    if res.ref is None and not res.book_known:
        raise hubdb.Unreadable("asa-hub-db holds no copy of the potentialClients book")
    header = [gsjs.trim(gsjs.js_str(h)) for h in (res.ref.headers if res.ref else ())]
    rows = [(s_(r.get("id")), None, r) for r in reads.db.sheetdb_rows(res.ref)]
    return {"header": header, "rows": rows, "owned": False}


def counts(reads: L.Reads, got: dict | None = None) -> dict[str, int]:
    """scraperCounts_: every referral, the open ones (not expired), the open ones not rated, the open ones rated at or
    over the threshold."""
    got = got or leads(reads)
    if not got["rows"]:
        return {"total": 0, "unrated": 0, "high": 0, "open": 0}
    has_exp = "expiration_date" in got["header"]
    threshold = TP.parse_int(config(reads).get("score_threshold")) or 7
    today = today_ms(reads)
    total = unrated = high = live_n = 0
    for _k, _c, r in got["rows"]:
        if not s_(r.get("id")):
            continue
        total += 1
        live = True
        if has_exp:
            d = lead_date(r.get("expiration_date"))
            live = d is not None and d >= today
        if live:
            live_n += 1
        rating = gsjs.trim(gsjs.or_text(r.get("ai_rating")))
        if live and not rating:
            unrated += 1
        if live and rating:
            n = CND.js_number(rating)
            if n == n and n >= threshold:
                high += 1
    return {"total": total, "unrated": unrated, "high": high, "open": live_n}


def scraper_config(sess: L.Session, payload: dict) -> dict[str, Any]:
    """scraperConfig: the settings, the referrals' counts and which secrets this service holds — never a value."""
    reads = sess.reads
    if not TP.writer(sess.user):
        return dict(TP.DENIED)
    cfg = config(reads)
    return {"status": 200, "data": {
        "config": cfg, "password_set": bool(secret(reads, PASSWORD_PROP)),
        "scoring_key_set": bool(secret(reads, OPENAI_PROP)), "notify_key_set": bool(secret(reads, OPENPHONE_PROP)),
        "leads_tab": LEADS, "counts": counts(reads),
        "effective_system": gsjs.trim(cfg.get("score_system", "")) or SYSTEM_DEFAULT,
        "effective_prompt": gsjs.trim(cfg.get("score_prompt", "")) or PROMPT_DEFAULT}}


# ---- the walk (scraperRun's reading) -----------------------------------------------------------------------------

def _unescape(s: Any) -> str:
    """scraperUnescape_."""
    return (gsjs.or_text(s).replace("&quot;", '"').replace("&#039;", "'").replace("&#39;", "'")
            .replace("&apos;", "'").replace("&lt;", "<").replace("&gt;", ">").replace("&amp;", "&"))


def parse_referrals(html: str) -> list:
    """scraperParseReferrals_: the attribute holds a paginated object (`.data`) or the bare array."""
    m = re.search(r':?initial-open-referrals="([^"]+)"', html or "")
    if not m:
        return []
    try:
        parsed = json.loads(_unescape(m.group(1)))
    except ValueError:
        return []
    if isinstance(parsed, dict):
        return parsed.get("data") if isinstance(parsed.get("data"), list) else []
    return parsed if isinstance(parsed, list) else []


def flatten(obj: dict, prefix: str = "") -> dict[str, Any]:
    """scraperFlatten_."""
    out: dict[str, Any] = {}
    for k, v in obj.items():
        key = prefix + "." + k if prefix else k
        if isinstance(v, dict):
            out.update(flatten(v, key))
        elif isinstance(v, list):
            out[key] = json.dumps(v, ensure_ascii=False, separators=(",", ":"))
        else:
            out[key] = v
    return out


def clean(value: Any) -> str:
    """scraperClean_: the portal's HTML as plain lines."""
    s = gsjs.or_blank(value)
    if not s:
        return ""
    s = re.sub(r"<\s*/?\s*br\s*/?\s*>", "\n", s, flags=re.I)
    s = re.sub(r"</(p|div|li|tr)\s*>", "\n", s, flags=re.I)
    s = re.sub(r"<[^>]*>", "", s)
    s = re.sub(r"&nbsp;", " ", _unescape(s), flags=re.I)
    s = re.sub(r"[ \t]+", " ", s)
    s = re.sub(r"\s*\n\s*", "\n", s)
    return gsjs.trim(re.sub(r"\n{2,}", "\n", s))


def lead_row(ref: dict) -> dict[str, str]:
    """scraperLeadRow_: the fields a referral is kept by, nothing of its raw record."""
    f = flatten(ref)
    first = gsjs.trim(gsjs.or_text(f.get("client.first_name")))
    last = gsjs.trim(gsjs.or_text(f.get("client.last_name")))
    return {"referral_id": gsjs.trim(gsjs.or_blank(ref.get("id"))), "client_name": gsjs.trim(first + " " + last),
            "client_age": gsjs.or_text(f.get("client_age")), "client_gender": gsjs.or_text(f.get("client.gender")),
            "frequency": clean(f.get("frequency")), "description": clean(f.get("description_of_service")),
            "diagnosis": clean(f.get("client.diagnosis")),
            "postal_code": gsjs.or_text(f.get("client_residence_postal_code")),
            "phone": gsjs.or_text(f.get("client.home_phone")), "email": gsjs.or_text(f.get("client.email")),
            "funding_source": gsjs.or_text(f.get("funding_source_id")),
            "expiration_date": gsjs.or_text(f.get("expiration_date_friendly"))}


def js_key_order(keys: list[str]) -> list[str]:
    """An object's keys as for-in walks them: the array indexes first, ascending, then the rest as they came."""
    index = [k for k in keys if re.fullmatch(r"0|[1-9]\d{0,9}", k) and int(k) < 4294967295]
    rest = [k for k in keys if k not in set(index)]
    return sorted(index, key=int) + rest


def run_prepare(sess: L.Session, payload: dict) -> dict[str, Any]:
    """scraperRun's reading: signed in to the portal, the configured pages walked, every open referral read — only the
    fields kept, by referral id; the write then appends the ones not seen before."""
    reads = sess.reads
    if not TP.writer(sess.user):
        return dict(TP.DENIED)
    cfg = config(reads)
    if s_(cfg.get("enabled")).lower() != "yes":
        return {"status": 400,
                "message": "The scraper is switched off. Set `enabled` to yes in the scraper_config tab."}
    password = secret(reads, PASSWORD_PROP)
    if not cfg.get("email") or not password:
        return {"status": 400, "message": "Missing credentials: set `email` in scraper_config and " + PASSWORD_PROP +
                                          " in Script Properties."}
    deadline = time.monotonic() + PREPARE_DEADLINE_S
    try:
        login = requests.post(cfg.get("login_url", ""), data={"email": cfg["email"], "password": password},
                              allow_redirects=False, timeout=HTTP_TIMEOUT_S)
    except requests.RequestException as exc:
        return {"status": 502, "message": f"Sign-in failed ({type(exc).__name__})."}
    if login.status_code not in (200, 302):
        return {"status": 502, "message": f"Sign-in failed (HTTP {login.status_code})."}
    cookies = "; ".join(f"{c.name}={c.value}" for c in login.cookies)
    if not cookies:
        return {"status": 502, "message": "Sign-in returned no session cookie."}
    pages = max(1, TP.parse_int(cfg.get("pages")) or 1)
    seen: dict[str, dict] = {}
    fetched = 0
    for p in range(1, pages + 1):
        if time.monotonic() >= deadline:
            break
        url = cfg.get("referrals_url", "") + "?open=1&client=&service=&status=" + (f"&page={p}" if p > 1 else "")
        try:
            res = requests.get(url, headers={"Cookie": cookies}, timeout=HTTP_TIMEOUT_S)
        except requests.RequestException:
            continue
        if res.status_code != 200:
            continue
        for ref in parse_referrals(res.text):
            if not isinstance(ref, dict):
                continue
            rid = gsjs.trim(gsjs.or_blank(ref.get("id")))
            if not rid:
                continue
            fetched += 1
            seen[rid] = lead_row(ref)
    return {"status": 200, "data": TP.seal("scraperRunPrepare", TP.actor(sess.user), {
        "pages": pages, "seen": fetched, "unique": len(seen),
        "leads": [seen[k] for k in js_key_order(list(seen))]})}


# ---- the rating (scraperScore's reading) -------------------------------------------------------------------------

def score_prompt(lead: dict, cfg: dict) -> str:
    """scraperScorePrompt_."""
    return fill(gsjs.trim(cfg.get("score_prompt", "")) or PROMPT_DEFAULT, {
        "home_zip": cfg.get("home_zip") or "44709", "referral_id": lead["referral_id"],
        "client_name": lead["client_name"], "frequency": lead["frequency"], "description": lead["description"],
        "postal_code": lead["postal_code"], "client_gender": lead["client_gender"], "diagnosis": lead["diagnosis"],
        "client_age": lead["client_age"], "phone": lead["phone"], "email": lead["email"]})


def parse_json(content: Any) -> dict | None:
    """scraperParseJson_: the first JSON object of the answer, fenced or not."""
    s = gsjs.trim(gsjs.or_text(content))
    m = re.search(r"```(?:json)?\s*(\{[\s\S]*?\})\s*```", s)
    if m:
        s = m.group(1)
    a, b = s.find("{"), s.rfind("}")
    if a == -1 or b <= a:
        return None
    try:
        got = json.loads(s[a:b + 1])
    except ValueError:
        return None
    return got if isinstance(got, dict) else None


def _rate(key: str, model: str, system: str, prompt: str, deadline: float) -> dict | None:
    """One referral rated: {rating, notes}, None when the model did not give one."""
    left = deadline - time.monotonic()
    if left <= 1:
        return None
    try:
        r = requests.post(OPENAI_URL, headers={"Authorization": "Bearer " + key}, timeout=min(HTTP_TIMEOUT_S, left),
                          json={"model": model, "messages": [{"role": "system", "content": system},
                                                             {"role": "user", "content": prompt}],
                                "max_completion_tokens": 600})
    except requests.RequestException:
        return None
    if r.status_code != 200:
        return None
    try:
        content = r.json()["choices"][0]["message"]["content"]
    except (ValueError, KeyError, IndexError, TypeError):
        return None
    parsed = parse_json(content)
    if not parsed:
        return None
    n = TP.parse_int(gsjs.or_blank(parsed.get("ai_rating")))
    if n is None:
        return None
    return {"rating": n, "notes": gsjs.or_blank(parsed.get("ai_notes"))}


def score_prepare(sess: L.Session, payload: dict) -> dict[str, Any]:
    """scraperScore's reading: the open referrals not rated yet, a batch of them, each rated by the model; the write
    then keeps each rating on a referral still unrated."""
    reads = sess.reads
    if not TP.writer(sess.user):
        return dict(TP.DENIED)
    key = secret(reads, OPENAI_PROP)
    if not key:
        return {"status": 400, "message": "Rating needs " + OPENAI_PROP + " in Script Properties."}
    cfg = config(reads)
    batch = max(1, TP.parse_int(cfg.get("score_batch_size")) or 50)
    model = cfg.get("score_model") or "gpt-5.1"
    got = leads(reads)
    if "ai_rating" not in got["header"] or "ai_notes" not in got["header"]:
        return {"status": 400, "message": "The sheet has no ai_rating / ai_notes columns."}
    today = today_ms(reads)
    picked = []
    for _k, _c, r in got["rows"]:
        if len(picked) >= batch:
            break
        if not s_(r.get("id")) or gsjs.trim(gsjs.or_text(r.get("ai_rating"))):
            continue
        exp = lead_date(r.get("expiration_date")) if "expiration_date" in got["header"] else None
        if exp is None or exp < today:
            continue
        picked.append({"id": s_(r.get("id")), **{f: gsjs.or_text(r.get(f)) for f in (
            "referral_id", "client_name", "client_age", "client_gender", "frequency", "description", "diagnosis",
            "postal_code", "phone", "email")}})
    system = gsjs.trim(cfg.get("score_system", "")) or SYSTEM_DEFAULT
    deadline = time.monotonic() + PREPARE_DEADLINE_S
    results: list[dict] = []
    failed = 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=RATE_WORKERS) as pool:
        futures = [(lead, pool.submit(_rate, key, model, system, score_prompt(lead, cfg), deadline))
                   for lead in picked]
        for lead, fut in futures:
            try:
                rated = fut.result()
            except Exception:  # noqa: BLE001 - one referral's failure is counted, never the batch's
                rated = None
            if rated is None:
                failed += 1
                continue
            results.append({"id": lead["id"], "ai_rating": rated["rating"],
                            "ai_notes": lead["client_name"] + " (" + lead["client_age"] + ", " +
                                        lead["client_gender"] + "); " + rated["notes"]})
    return {"status": 200, "data": TP.seal("scraperScorePrepare", TP.actor(sess.user), {
        "considered": len(picked), "failed": failed, "results": results})}


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {
    "scraperConfig": scraper_config, "scraperRunPrepare": run_prepare, "scraperScorePrepare": score_prepare}
POLICY: dict[str, dict[str, Any]] = {a: {"roles": ("admin", "manager")} for a in ACTIONS}
