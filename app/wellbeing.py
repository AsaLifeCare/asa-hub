"""Hydration, Workout and Ideal Meals on Python (Wellbeing.gs hydrationProfilesDerived_, workoutPlansDerived_,
mealIdealsDerived_): each client's profile, movement and four plates worked out from their service plan (isps, off
asa-hub-db) on every read — no tab of their own, a client reading only their own plan's rows. A plate's or a movement's
picture is today's row of wellbeing_images, the platform's nightly fill writes, served from the server's own
/wellbeing-images/; nothing here calls an image model (wellbeingGenerateImage answers today's picture, or that it is
paused)."""
from __future__ import annotations

import math
import re
from datetime import datetime
from typing import Any, Callable
from zoneinfo import ZoneInfo

import clients as C
import gsjs
import locations as L
import sleep as SL

PERIODS = (("Breakfast", 0.25, "Breakfast"), ("Lunch", 0.35, "Lunch"), ("Snack", 0.10, "Afternoon snack"),
           ("Dinner", 0.30, "Dinner"))
IMAGES_TAB = "wellbeing_images"
NY = ZoneInfo("America/New_York")
PAUSED = ("Hub Generate is paused (OpenAI quota). Illustrations are produced nightly by the old platform (Cloudflare) "
          "into wellbeing_images — refresh after the 04:00 America/New_York job, or ask an operator to run a fill. "
          "Cache hits for today still return instantly.")
DENIED = {"status": 403, "message": "Requires an admin or manager account"}

s_ = gsjs.str_


def js_round(x: float) -> int:
    """Math.round."""
    return int(math.floor(x + 0.5))


def client_id(isp: dict) -> str:
    return "CLI_" + s_(isp.get("client_key")).strip()


# ---- meals --------------------------------------------------------------------------------------------------------

def daily_kcal(text: Any) -> int:
    """wbParseDailyKcal_."""
    s = s_(text)
    m = re.search(r"(\d{3,4})\s*(?:kcal|calories?|cal\b)", s, re.I) or \
        re.search(r"(?:caloric|calories?)[^0-9]{0,24}(\d{3,4})", s, re.I)
    if m:
        return max(1200, min(4000, int(m.group(1))))
    if re.search(r"iddsi|pureed|minced|dysphagia|nectar|honey.?thick", s, re.I):
        return 1800
    if re.search(r"diabetic|diabetes", s, re.I):
        return 1900
    return 2000


def _allergy_parts(isp: dict) -> list[str]:
    return [a.strip() for a in re.split(r"[,;\n·]", s_(isp.get("allergies")))]


def dietary_tags(isp: dict) -> list[str]:
    """wbDietaryTags_."""
    tags: list[str] = []

    def add(t: str) -> None:
        t = t.strip().lower()
        if t and t not in tags:
            tags.append(t)
    diet = s_(isp.get("diet_nutrition"))
    for pattern, tag in ((r"low.?sodium", "low-sodium"), (r"diabetic|diabetes", "diabetic-friendly"),
                         (r"lactose|dairy.?free", "lactose-free"), (r"gluten", "gluten-free"),
                         (r"peanut|tree.?nut", "peanut-free"), (r"pureed|iddsi", "pureed"),
                         (r"minced|mechanical", "minced"), (r"soft|easy.?chew", "easy-chew")):
        if re.search(pattern, diet, re.I):
            add(tag)
    for a in _allergy_parts(isp):
        if 2 < len(a) < 40:
            add(a)
    return tags[:6]


def allergens(isp: dict) -> list[str]:
    """wbAllergenList_."""
    return [a for a in _allergy_parts(isp) if len(a) > 2][:8]


def meal_description(isp: dict, label: str, kcal: int) -> str:
    diet = s_(isp.get("diet_nutrition")).strip()
    return f"{label} target ~{kcal} kcal — drawn from the ISP diet profile. " + \
        (diet[:220] if diet else "No specific dietary notes on file.")


def meal_ingredients(isp: dict, ptype: str, label: str, kcal: int) -> list[str]:
    base = [f"Portions sized for ~{kcal} kcal at {label.lower()}", "Texture and fluid consistency per the ISP diet order"]
    diet = s_(isp.get("diet_nutrition"))
    if re.search(r"protein|meat|chicken|fish", diet, re.I):
        base.append("Lean protein per the texture order")
    if re.search(r"vegetable|fruit|fiber", diet, re.I):
        base.append("Soft vegetables or fruit as tolerated")
    if ptype == "Snack":
        base.append("Small, easy-to-swallow snack portion")
    return base[:8]


def meal_steps(isp: dict, label: str) -> list[str]:
    return ["Read the ISP diet & nutrition section for this client before plating.",
            f"Prepare {label.lower()} to the ordered texture (IDDSI level if stated).",
            "Check allergens: " + (", ".join(allergens(isp)) or "none listed") + ".",
            f"Plate at ~{label.lower()} time; offer fluids per the hydration plan.",
            "Document intake if the house protocol requires it."]


# ---- the pictures -------------------------------------------------------------------------------------------------

def today() -> str:
    return datetime.now(NY).strftime("%Y-%m-%d")


def day_of(v: Any) -> str:
    """wbDayOf_."""
    if isinstance(v, datetime):
        return v.astimezone(NY).strftime("%Y-%m-%d")
    s = s_(v).strip()
    m = re.match(r"^(\d{4}-\d{2}-\d{2})", s)
    return m.group(1) if m else s


def cache_key(kind: str, key: str, period: str = "") -> str:
    day = today()
    if kind == "meal":
        return f"meal|{key}|{period}|{day}"
    return f"{kind}|{key}|{day}"


def image_map(sess: L.Session) -> dict[str, dict]:
    """wbImageMapForToday_: today's rows of the nightly fill, the last one of a key winning."""
    day = today()
    out: dict[str, dict] = {}
    for r in C._hub(sess.reads, IMAGES_TAB):
        if day_of(r.get("day")) == day and s_(r.get("cache_key")):
            out[s_(r.get("cache_key"))] = r
    return out


def public_url(row: dict) -> str:
    """wbPublicImageUrl_: the server's own static path, else Drive's image link."""
    url = s_(row.get("image_url")).strip()
    if url.startswith("/wellbeing-images/"):
        return url
    fid = s_(row.get("file_id")).strip()
    if fid and re.search(r"\.(jpe?g|png|webp)$", fid, re.I):
        return "/wellbeing-images/" + re.sub(r"^.*/", "", fid)
    if fid:
        return f"https://lh3.googleusercontent.com/d/{fid}=w1000"
    m = re.search(r"[?&]id=([^&]+)", url) or re.search(r"/d/([^/=]+)", url)
    return f"https://lh3.googleusercontent.com/d/{m.group(1)}=w1000" if m else url


def meals(sess: L.Session) -> list[dict[str, Any]]:
    """mealIdealsDerived_: four plates per plan."""
    imgs = image_map(sess)
    out = []
    for isp in SL._isps(sess):
        key = s_(isp.get("client_key"))
        if not key.strip():
            continue
        daily = daily_kcal(isp.get("diet_nutrition"))
        tags, alg = dietary_tags(isp), allergens(isp)
        for ptype, share, label in PERIODS:
            kcal = js_round(daily * share)
            cached = imgs.get(cache_key("meal", key, ptype))
            out.append({"id": f"meal-{key}-{ptype.lower()}", "clientId": client_id(isp), "client_key": isp.get("client_key"),
                        "clientName": s_(isp.get("client_name") or key), "dishName": f"{label} · ~{kcal} kcal",
                        "description": meal_description(isp, label, kcal),
                        "image": public_url(cached) if cached else "", "status": "ready" if cached else "pending",
                        "dietaryTags": tags, "mealType": ptype, "kcalTarget": kcal, "kcalDaily": daily,
                        "recipe": {"ingredients": meal_ingredients(isp, ptype, label, kcal),
                                   "steps": meal_steps(isp, label), "allergens": alg, "prepMin": 20, "servings": 1}})
    return out


# ---- movement -----------------------------------------------------------------------------------------------------

def pick_activity(mobility: str) -> dict[str, Any]:
    """wbPickActivity_."""
    m = mobility.lower()
    if re.search(r"wheelchair|non.?amb|bedbound|lift", m, re.I):
        return {"title": "Seated Stretch", "desc": mobility, "mins": 15, "intensity": "gentle"}
    if re.search(r"walker|gait|ambulat", m, re.I):
        return {"title": "Gentle Walking", "desc": mobility, "mins": 20, "intensity": "gentle"}
    if re.search(r"balance|fall", m, re.I):
        return {"title": "Balance Practice", "desc": mobility, "mins": 10, "intensity": "moderate"}
    if re.search(r"transfer|sit.?to.?stand", m, re.I):
        return {"title": "Sit-to-Stand Reps", "desc": mobility, "mins": 10, "intensity": "moderate"}
    if len(m) > 20:
        return {"title": "Therapy Movement", "desc": mobility[:280], "mins": 15, "intensity": "gentle"}
    return {"title": "Gentle Movement", "desc": "Light activity per the ISP mobility section.", "mins": 12,
            "intensity": "gentle"}


def workouts(sess: L.Session) -> list[dict[str, Any]]:
    """workoutPlansDerived_: one movement per plan."""
    imgs = image_map(sess)
    out = []
    for isp in SL._isps(sess):
        key = s_(isp.get("client_key"))
        if not key.strip():
            continue
        pick = pick_activity(s_(isp.get("mobility")))
        cached = imgs.get(cache_key("workout", key))
        out.append({"id": f"wo-{key}", "clientId": client_id(isp), "client_key": isp.get("client_key"),
                    "clientName": s_(isp.get("client_name") or key), "activity": pick["title"],
                    "description": pick["desc"], "durationMin": pick["mins"], "intensity": pick["intensity"],
                    "status": "ready" if cached else "pending", "image": public_url(cached) if cached else ""})
    return out


# ---- hydration ----------------------------------------------------------------------------------------------------

def hydration_oz(text: str) -> int:
    """wbParseHydrationOz_."""
    oz = re.search(r"(\d{2,3})\s*(?:fl\.?\s*oz|ounces?|oz)\b", text, re.I)
    if oz:
        return max(32, min(96, int(oz.group(1))))
    ml = re.search(r"(\d{3,4})\s*ml\b", text, re.I)
    if ml:
        return js_round(int(ml.group(1)) / 29.57)
    cups = re.search(r"(\d)\s*cups?\b", text, re.I)
    if cups:
        return int(cups.group(1)) * 8
    if re.search(r"fluid.?restrict|limit", text, re.I):
        return 48
    return 64


def hydration_notes(text: str, target: int) -> str:
    s = text.strip()
    if re.search(r"nectar|honey.?thick|thickened", s, re.I):
        return f"Thickened liquids per the swallowing order — target {target} oz equivalent."
    if len(s) > 20:
        return f"Daily target {target} oz. " + s[:160]
    return f"Daily fluid target {target} oz per the ISP diet profile."


def hydration(sess: L.Session) -> list[dict[str, Any]]:
    """hydrationProfilesDerived_: the targets from the plan; the averages derived from them, not logged intake."""
    out = []
    for isp in SL._isps(sess):
        key = s_(isp.get("client_key"))
        if not key.strip():
            continue
        text = s_(isp.get("diet_nutrition")) + " " + s_(isp.get("personal_care"))
        target = hydration_oz(text)
        avg = target - 4 + (SL.js_hash(key) % 9)
        out.append({"id": f"hyd-{key}", "client_key": isp.get("client_key"), "clientId": client_id(isp),
                    "clientName": s_(isp.get("client_name") or key), "targetOz": target, "avgOz": avg,
                    "glasses": max(0, min(12, js_round(avg / 8))), "lastLogged": "today",
                    "notes": hydration_notes(text, target),
                    "trend": "up" if avg >= target else ("down" if avg < target - 8 else "flat")})
    return out


# ---- the doors ----------------------------------------------------------------------------------------------------

DERIVED: dict[str, Callable[[L.Session], list[dict]]] = {"mealIdeals": meals, "workoutPlans": workouts,
                                                         "hydrationProfiles": hydration}


def _list(resource: str) -> Callable[[L.Session, dict], dict[str, Any]]:
    def door(sess: L.Session, payload: dict) -> dict[str, Any]:
        """route(<resource>, 'list'): the derived rows."""
        SL._away(sess.user or {})
        return {"status": 200, "data": DERIVED[resource](sess)}
    return door


def _get(resource: str) -> Callable[[L.Session, dict], dict[str, Any]]:
    def door(sess: L.Session, payload: dict) -> dict[str, Any]:
        """route(<resource>, 'get'): one derived row by its id."""
        SL._away(sess.user or {})
        want = gsjs.js_str((payload or {}).get("id")) if isinstance(payload, dict) else ""
        hit = next((r for r in DERIVED[resource](sess) if gsjs.js_str(r["id"]) == want), None)
        if hit is None:
            return {"status": 404, "message": f'No row "{want}" in {resource}.'}
        return {"status": 200, "data": hit}
    return door


def parse_row_id(row_id: str) -> dict[str, str] | None:
    """wbParseRowId_."""
    m = re.match(r"^meal-(.+)-(breakfast|lunch|snack|dinner)$", row_id, re.I)
    if m:
        return {"kind": "meal", "client_key": m.group(1), "period": m.group(2).capitalize()}
    m = re.match(r"^wo-(.+)$", row_id)
    return {"kind": "workout", "client_key": m.group(1), "period": ""} if m else None


def generate_image(sess: L.Session, payload: dict) -> dict[str, Any]:
    """wellbeingGenerateImage: today's picture when the nightly fill made one; else paused — no image model is called
    from the platform."""
    user = sess.user or {}
    if not user or user.get("is_service") or s_(user.get("role")) not in ("admin", "manager", "staff", "director"):
        return dict(DENIED)
    p = payload if isinstance(payload, dict) else {}
    row_id = s_(p.get("row_id") or p.get("id"))
    if not row_id:
        return {"status": 400, "message": "row_id is required"}
    parsed = parse_row_id(row_id)
    if parsed is None:
        return {"status": 400, "message": "Unknown wellbeing row id"}
    if not any(s_(r.get("client_key")) == parsed["client_key"] for r in C._hub(sess.reads, "isps")):
        return {"status": 404, "message": "No ISP found for this client"}
    hit = image_map(sess).get(cache_key(parsed["kind"], parsed["client_key"], parsed["period"]))
    if hit and (s_(hit.get("image_url")) or s_(hit.get("file_id"))):
        return {"status": 200, "data": {"id": row_id, "image": public_url(hit), "status": "ready", "cached": True}}
    return {"status": 503, "message": PAUSED}


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {
    "mealIdealsList": _list("mealIdeals"), "mealIdealsGet": _get("mealIdeals"),
    "workoutPlansList": _list("workoutPlans"), "workoutPlansGet": _get("workoutPlans"),
    "hydrationProfilesList": _list("hydrationProfiles"), "hydrationProfilesGet": _get("hydrationProfiles"),
    "wellbeingGenerateImage": generate_image}
# the generic verbs declare no roles; the door's own reading decides
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
POLICY["wellbeingGenerateImage"] = {"roles": ("admin", "director", "manager", "staff")}
