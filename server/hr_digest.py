"""THE DIGEST — the tracker says what it is sure of, and says when it is not.
THE LINE THIS MODULE WALKS, AND IT IS THE WHOLE DESIGN."""
from __future__ import annotations

import hashlib
import json
import os
import re
import threading
import time
from pathlib import Path
from typing import Any

try:  # the relay has it; a terminal census may not
    import psycopg2
    import psycopg2.extras
except Exception:  # noqa: BLE001
    psycopg2 = None  # type: ignore[assignment]

# --------------------------------------------------------------------------- THE CLOSED VOCABULARY…
VERDICTS = ("ended", "suspended", "open_concern", "resolved", "unclear")

# What the row means when the model is not asked at all.
UNSURE = "unclear"

# THE SHEET'S OWN CLOSED DROPDOWN, and the only verdict allowed to travel.
SETTLED = {"terminated": "ended", "quit": "ended"}

# Bump this when the prompt or the vocabulary changes: it is part of every cache key, so a contract change re-asks…
CONTRACT = "hr-digest-v2"

# The cells read.
PROSE_FIELDS = ("situation", "follow_up", "result")
CONTEXT_FIELDS = ("date", "employees_involved", "disciplinary_action",
                  "termination_summary")

PROMPT = (
    "You read one row of an HR tracker kept by a company running group homes for adults "
    "with developmental disabilities. A row records a workplace situation involving one or "
    "more staff, what was done about it, and where it landed.\n\n"
    "You receive a JSON payload with the row's own cells.\n\n"
    "Answer with ONE JSON object and nothing else. No markdown, no commentary, no array.\n\n"
    "  verdict   one of: " + " | ".join(VERDICTS) + "\n"
    "  note      one short sentence, in plain English, saying what the row records\n\n"
    "WHAT THE VERDICTS MEAN:\n"
    "  ended          the row SAYS this employment is over — fired, terminated, quit, resigned\n"
    "  suspended      the row SAYS the person is suspended from work right now\n"
    "  open_concern   the row SAYS the matter is still live — being monitored, still being\n"
    "                 handled, waiting on something, or with a next step named\n"
    "  resolved       the row SAYS the matter was dealt with and is finished\n"
    "  unclear        the row does not say where it landed. This is the DEFAULT answer.\n\n"
    "RULES THAT OUTRANK EVERYTHING:\n"
    "- Use ONLY what the row says. Never infer, never assume, never fill a gap.\n"
    "- \"unclear\" IS THE DEFAULT. Start there and move off it only when a sentence in "
    "the row plainly states where the matter landed. Most rows of this book are unclear, "
    "and answering \"unclear\" is never a mistake.\n"
    "- A row that describes WHAT HAPPENED and WHAT WAS DONE, and then stops, is "
    "\"unclear\". A write-up, a warning, a conversation and a meeting are things that were "
    "DONE — none of them says whether the matter is still live or finished.\n"
    "- Choose \"open_concern\" only if the row names something still outstanding. Choose "
    "\"resolved\" only if the row says the matter is closed, settled, dropped, or that no "
    "further action is being taken.\n"
    "- NEVER write a person's name into the note. Not the employee's, not a manager's, not "
    "a client's. Write \"the employee\", \"a manager\", \"a client\".\n"
    "- NEVER write a note longer than the text you were given. If you cannot say what the "
    "row records in fewer characters than the row used, you are inventing it.\n"
    "- Do not judge the person, do not rate them, do not say whether they are reliable or "
    "a risk. Say what the row records and stop.\n"
    "- A row can be about a warning and still be \"unclear\": a warning is not an outcome.\n"
    "Use the verdict words EXACTLY as spelled above. A verdict not on the list is refused."
)

# --------------------------------------------------------------------------- THE MODEL DOOR — one rung, and it is…
LOCAL_URL = os.getenv("HUB_HR_DIGEST_URL") or os.getenv(
    "HUB_ANALYZE_LOCAL_URL", "http://local-cortex:8080/v1/chat/completions")
LOCAL_MODEL = os.getenv("HUB_HR_DIGEST_MODEL") or os.getenv(
    "HUB_ANALYZE_LOCAL_MODEL", "qwen2.5-7b-instruct")

# The longest row this door can take.
LOCAL_WINDOW = int(os.getenv("HUB_HR_DIGEST_WINDOW", "6000"))

# --------------------------------------------------------------------------- THE PACE — chosen from a measurement…
ROWS_PER_PASS = int(os.getenv("HUB_HR_DIGEST_ROWS", "3"))
GAP_S = float(os.getenv("HUB_HR_DIGEST_GAP_S", "2.0"))
ROW_TIMEOUT_S = float(os.getenv("HUB_HR_DIGEST_ROW_TIMEOUT_S", "120"))
PASS_BUDGET_S = float(os.getenv("HUB_HR_DIGEST_PASS_BUDGET_S", "300"))
MIN_PASS_GAP_S = float(os.getenv("HUB_HR_DIGEST_PASS_GAP_S", "600"))

# A row the door refused comes back, because a refusal is a DOOR being down rather than a row being unreadable in…
RETRY_MAX = int(os.getenv("HUB_HR_DIGEST_RETRY_MAX", "3"))

CACHE_PATH = Path(os.getenv("HUB_HR_DIGEST_CACHE") or
                  (Path(os.getenv("HUB_SNAPSHOT_OUT", "/srv/snapshot")) /
                   "hr_digest_cache.json"))

_LOCK = threading.Lock()
_PASS_LOCK = threading.Lock()
_LAST_PASS = {"at": 0.0}


class Refused(RuntimeError):
    """No door answered. The row stays unread — never marked, never emptied."""


# --------------------------------------------------------------------------- SHAPING…
def key(v: Any) -> str:
    """The platform's own flattened name key — `clientNameKey_` in Clients.gs, the same one…"""
    return re.sub(r"[^a-z0-9]+", "", str(v or "").strip().lower())


def text(v: Any, cap: int = 0) -> str:
    if v is None or v is False:
        return ""
    s = " ".join(str(v).split())
    return s[:cap] if cap and len(s) > cap else s


def stamp() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def names_in(raw: Any) -> list[str]:
    """'Jenna and Dominic', 'Smith, Jones / 48th' -> the tokens."""
    return [t for t in (s.strip() for s in re.split(r"[,/&]|\band\b", str(raw or ""), flags=re.I))
            if t]


def content_key(row: dict) -> str:
    """The cache key: this row's content, not its row number."""
    payload = json.dumps(
        [CONTRACT] + [text(row.get(f)) for f in (CONTEXT_FIELDS + PROSE_FIELDS)],
        ensure_ascii=False, sort_keys=True)
    return hashlib.sha1(payload.encode("utf-8")).hexdigest()[:20]


def prose_of(row: dict) -> str:
    """The text the model is asked to read, and the yardstick its note is measured against."""
    return text(" ".join(text(row.get(f)) for f in PROSE_FIELDS))


# --------------------------------------------------------------------------- THE ROSTER — one exact match, or none…
def roster(dsn: str) -> dict[str, list[dict]]:
    """Every person the platform knows, by flattened key."""
    if psycopg2 is None:
        raise Refused("psycopg2 is not importable in this process")
    out: dict[str, list[dict]] = {}
    with psycopg2.connect(dsn) as conn, conn.cursor() as cur:
        cur.execute("select display_name, coalesce(status,'') from ops.employees")
        for display, status in cur.fetchall():
            k = key(display)
            if not k:
                continue
            out.setdefault(k, []).append(
                {"name": text(display, 120), "status": text(status, 40)})
    return out


def identify(raw: Any, people: dict[str, list[dict]]) -> list[dict]:
    """The row's names, each with how well it is known."""
    out = []
    for token in names_in(raw):
        k = key(token)
        hits = people.get(k) or []
        if len(hits) == 1:
            out.append({"name": token, "match": "exact",
                        "roster_name": hits[0]["name"], "status": hits[0]["status"]})
        elif len(hits) > 1:
            out.append({"name": token, "match": "ambiguous", "roster_name": "",
                        "status": "",
                        "why": f"{len(hits)} people on the roster flatten to this name"})
        else:
            out.append({"name": token, "match": "unmatched", "roster_name": "",
                        "status": "", "why": "no roster person carries this name"})
    return out


def roster_words(people: dict[str, list[dict]]) -> set[str]:
    """Every first and last name on the roster, flattened, four letters or more."""
    out: set[str] = set()
    for hits in people.values():
        for person in hits:
            for part in person["name"].split():
                p = key(part)
                if len(p) >= 4:
                    out.add(p)
    return out


def strangers(note: str, row: dict, people: dict[str, list[dict]]) -> str:
    """A roster person named in the note whom this row does not name."""
    known = roster_words(people)
    mine = set()
    for cell in (CONTEXT_FIELDS + PROSE_FIELDS):
        for word in re.findall(r"[A-Za-z']+", text(row.get(cell))):
            mine.add(key(word))
    for word in re.findall(r"\b[A-Z][a-z']+", note):
        k = key(word)
        if k in known and k not in mine:
            return word
    return ""


# --------------------------------------------------------------------------- THE ANSWER…
def verdict(raw: Any) -> tuple[str, bool]:
    """A verdict from the closed list, and whether it had to be coerced."""
    got = key(raw)
    for allowed in VERDICTS:
        if key(allowed) == got:
            return allowed, False
    return UNSURE, bool(got)


def parse(raw: str) -> dict:
    """One object, whether it arrives bare, fenced, or first in a list."""
    body = re.sub(r"^```(?:json)?\s*", "", str(raw or "").strip(), flags=re.I)
    body = re.sub(r"\s*```$", "", body).strip()
    if not body:
        return {}
    try:
        got = json.loads(body)
    except ValueError:
        m = re.search(r"\{.*\}", body, re.S)
        if not m:
            return {}
        try:
            got = json.loads(m.group(0))
        except ValueError:
            return {}
    if isinstance(got, list):
        got = next((o for o in got if isinstance(o, dict)), {})
    return got if isinstance(got, dict) else {}


def ask(row: dict, http: Any = None) -> dict:
    """One row in, the model's raw answer out."""
    if http is None:
        import httpx
        http = httpx
    payload = {f: text(row.get(f), 2000) for f in (CONTEXT_FIELDS + PROSE_FIELDS)}
    body = json.dumps(payload, ensure_ascii=False)
    if len(body) > LOCAL_WINDOW:
        # NOT CLAIMED, NOT FILED UNREADABLE.
        raise Refused("local_too_long")
    tried: list[str] = []
    ask_body = {"model": LOCAL_MODEL, "temperature": 0.1,
                "response_format": {"type": "json_object"},
                "messages": [{"role": "system", "content": PROMPT},
                             {"role": "user", "content": body}]}
    try:
        with http.Client(timeout=ROW_TIMEOUT_S) as client:
            r = client.post(LOCAL_URL, json=ask_body)
        if r.status_code >= 400:
            tried.append(f"local_{r.status_code}")
        else:
            data = r.json()
            content = (((data.get("choices") or [{}])[0].get("message") or {})
                       .get("content"))
            if not content:
                # A 200 CARRYING NO COMPLETION IS NOT AN ANSWER.
                tried.append("local_empty")
            else:
                return {"content": content,
                        "via": "local:" + (text(data.get("model")) or LOCAL_MODEL)}
    except Exception as exc:  # noqa: BLE001 — the rung's failure is a reason
        tried.append(f"local_{type(exc).__name__}")
    raise Refused("+".join(tried) or "no door is configured")


def settled_of(row: dict) -> str:
    """The sheet's own verdict, or '' when the dropdown is empty."""
    return SETTLED.get(key(row.get("disciplinary_action")), "")


def read_one(row: dict, people: dict[str, list[dict]], http: Any = None) -> dict:
    """One row, digested."""
    answer = ask(row, http=http)          # may raise Refused — the caller files it
    got = parse(answer["content"])
    value, coerced = verdict(got.get("verdict"))
    note = text(got.get("note"), 300)
    source_len = len(prose_of(row))
    refused = ""
    if not note:
        refused = "the model gave a verdict with nothing behind it"
    elif len(note) > source_len:
        refused = "the note is longer than the row it summarises"
    else:
        stranger = strangers(note, row, people)
        if stranger:
            refused = f"the note names {stranger}, whom this row does not name"
    if refused:
        # THE VERDICT FALLS WITH THE NOTE.
        return {"verdict": UNSURE, "state": "read", "from": "model",
                "note": "", "why": refused, "via": answer["via"],
                "at": stamp(), "coerced": int(coerced), "invented": 1, "named": 0}
    # A NAME THE ROW ITSELF CARRIES IS COUNTED, NOT REFUSED — and the count is here because the difference had to be…
    named = any(key(w) in roster_words(people)
                for w in re.findall(r"\b[A-Z][a-z']+", note))
    return {"verdict": value, "state": "read", "from": "model",
            "note": note, "why": "", "via": answer["via"],
            "at": stamp(), "coerced": int(coerced), "invented": 0,
            "named": int(named)}


def unreadable(why: str, attempts: int) -> dict:
    """A row this lane opened and could not read."""
    return {"verdict": UNSURE, "state": "unreadable", "from": "",
            "note": "", "why": text(why, 160), "via": "", "at": stamp(),
            "attempts": attempts, "coerced": 0, "invented": 0, "named": 0}


# --------------------------------------------------------------------------- THE CACHE…
def load() -> dict:
    """What has been digested so far."""
    try:
        got = json.loads(CACHE_PATH.read_text())
    except Exception:  # noqa: BLE001 — no file yet is the normal first state
        return {}
    return got if isinstance(got, dict) else {}


def save(update: dict) -> None:
    """Merge and write atomically, under the lock."""
    with _LOCK:
        held = load()
        held.update(update)
        CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
        tmp = CACHE_PATH.with_suffix(".tmp")
        tmp.write_text(json.dumps(held, ensure_ascii=False, sort_keys=True))
        tmp.replace(CACHE_PATH)


# --------------------------------------------------------------------------- ATTACHING — what the page is handed…
def attach(rows: list[dict], dsn: str) -> list[dict]:
    """Every tracker row, carrying whatever the digest is sure of."""
    try:
        people = roster(dsn)
        roster_why = ""
    except Exception as exc:  # noqa: BLE001
        # A ROSTER THAT WILL NOT ANSWER NAMES NOBODY, and says that on every row — the same law…
        people, roster_why = {}, f"{type(exc).__name__}: {str(exc)[:120]}"
    held = load()
    for row in rows:
        ck = content_key(row)
        sheet = settled_of(row)
        if roster_why:
            found = [{"name": t, "match": "unknown", "roster_name": "",
                      "status": "", "why": "the roster could not be read"}
                     for t in names_in(row.get("employees_involved"))]
        else:
            found = identify(row.get("employees_involved"), people)
        row["digest_people"] = found
        row["digest_key"] = ck
        if sheet:
            # THE SHEET SETTLED IT.
            row["digest_verdict"] = sheet
            row["digest_state"] = "settled"
            row["digest_from"] = "sheet"
            row["digest_note"] = ""
            row["digest_why"] = text(row.get("disciplinary_action"), 40)
            row["digest_via"] = ""
            row["digest_at"] = ""
            if sheet == "ended":
                # WHY NO FACT LEFT THIS ROW, on the row, in words.
                _person, _why = attributable(row)
                row["digest_hold_why"] = _why
            continue
        got = held.get(ck)
        if not isinstance(got, dict):
            row["digest_verdict"] = ""
            row["digest_state"] = "pending"
            row["digest_from"] = ""
            row["digest_note"] = ""
            row["digest_why"] = ""
            row["digest_via"] = ""
            row["digest_at"] = ""
            continue
        value, _ = verdict(got.get("verdict"))
        row["digest_verdict"] = value
        row["digest_state"] = text(got.get("state"), 20) or "read"
        row["digest_from"] = text(got.get("from"), 20)
        # THE PROSE STAYS HERE.
        row["digest_note"] = text(got.get("note"), 300)
        row["digest_why"] = text(got.get("why"), 160)
        row["digest_via"] = text(got.get("via"), 60)
        row["digest_at"] = text(got.get("at"), 40)
    if roster_why:
        for row in rows:
            row["digest_roster_why"] = roster_why
    return rows


def attributable(row: dict) -> tuple[dict | None, str]:
    """The ONE person this row's one dropdown cell can be about, or nobody."""
    people = row.get("digest_people") or []
    if not people:
        return None, "this row names nobody, so it settles nothing about anybody"
    if len(people) > 1:
        return None, (f"this row names {len(people)} people and Disciplinary "
                      "Action is one cell — it cannot say which of them it is "
                      "about, so it is not applied to any of them")
    person = people[0]
    match = person.get("match")
    if match == "exact":
        return person, ""
    if match == "ambiguous":
        return None, ("two people on the roster flatten to this name, and "
                      "picking one would hand one person's record to another")
    if match == "unknown":
        return None, "the roster could not be read, so this name was not checked"
    return None, "no roster person carries this name"


def availability(rows: list[dict]) -> list[dict]:
    """THE ONLY THING THAT MAY LEAVE THIS MODULE."""
    out = []
    for row in rows:
        if row.get("digest_state") != "settled" or row.get("digest_verdict") != "ended":
            continue
        person, _why = attributable(row)
        if person is None:
            continue
        name = person.get("roster_name")
        out.append({"person_key": key(name),
                    "name": name,
                    "verdict": "employment_ended",
                    # A literal boolean.
                    "confident": True,
                    "effective_on": "",
                    "suspended_from": "",
                    "suspended_to": "",
                    "identity": "exact"})
    return out


# --------------------------------------------------------------------------- THE PASS — small, slow, and stoppable…
def due(rows: list[dict], held: dict) -> list[dict]:
    """The rows worth asking about, in the order they are worth asking."""
    want = []
    for row in rows:
        if settled_of(row):
            continue
        ck = content_key(row)
        got = held.get(ck)
        if isinstance(got, dict):
            if got.get("state") != "unreadable":
                continue
            if int(got.get("attempts") or 0) >= RETRY_MAX:
                continue
        want.append(row)
    return want


def run_pass(rows: list[dict], dsn: str, limit: int = 0, http: Any = None) -> dict:
    """Ask about a few rows."""
    out = {"asked": 0, "read": 0, "unreadable": 0, "no_text": 0, "coerced": 0,
           "invented": 0, "named": 0, "left": 0, "why": "", "at": stamp()}
    if not _PASS_LOCK.acquire(blocking=False):
        out["why"] = "a pass is already running"
        return out
    try:
        cap = limit or ROWS_PER_PASS
        if cap <= 0:
            out["why"] = "the digest pass is switched off (HUB_HR_DIGEST_ROWS=0)"
            return out
        try:
            people = roster(dsn)
        except Exception as exc:  # noqa: BLE001
            # WITHOUT THE ROSTER THE STRANGER CHECK CANNOT RUN, and that check is the one standing between this…
            out["why"] = f"the roster could not be read ({type(exc).__name__}) — nothing asked"
            return out
        held = load()
        queue = due(rows, held)
        started = time.time()
        update: dict[str, dict] = {}
        done = 0
        for row in queue[:cap]:
            if time.time() - started > PASS_BUDGET_S:
                out["why"] = "the pass ran out of its wall-clock budget"
                break
            done += 1
            ck = content_key(row)
            if not prose_of(row):
                # NOTHING TO READ IS NOT A MODEL CALL.
                update[ck] = {"verdict": UNSURE, "state": "read", "from": "row",
                              "note": "", "why": "the row carries no situation, "
                                                 "follow up or result to read",
                              "via": "", "at": stamp(), "coerced": 0,
                              "invented": 0, "named": 0}
                save({ck: update[ck]})
                out["no_text"] += 1
                continue
            out["asked"] += 1
            try:
                got = read_one(row, people, http=http)
                out["read"] += 1
            except Refused as exc:
                attempts = int((held.get(ck) or {}).get("attempts") or 0) + 1
                got = unreadable(str(exc), attempts)
                out["unreadable"] += 1
            out["coerced"] += int(got.get("coerced") or 0)
            out["invented"] += int(got.get("invented") or 0)
            out["named"] += int(got.get("named") or 0)
            update[ck] = got
            # WRITTEN THE MOMENT IT IS PAID FOR.
            save({ck: got})
            if GAP_S:
                time.sleep(GAP_S)
        # WHAT IS LEFT IS WHAT WAS NOT REACHED, counted from the queue this pass actually saw — never "cap minus…
        out["left"] = max(0, len(queue) - done)
        if update:
            # A CONTRACT BUMP LEAVES ITS PREDECESSOR'S VERDICTS BEHIND — they are keyed under a question nobody asks…
            if len(rows) > 1:
                live = {content_key(r) for r in rows}
                with _LOCK:
                    held = load()
                    keep = {k: v for k, v in held.items() if k in live}
                    if len(keep) != len(held):
                        tmp = CACHE_PATH.with_suffix(".tmp")
                        tmp.write_text(json.dumps(keep, ensure_ascii=False,
                                                  sort_keys=True))
                        tmp.replace(CACHE_PATH)
        return out
    finally:
        _PASS_LOCK.release()


def top_up(rows: list[dict], dsn: str) -> None:
    """Fill the cache in the background, a sip at a time, and never from the thread a page is waiting on."""
    if ROWS_PER_PASS <= 0:
        return
    if time.time() - _LAST_PASS["at"] < MIN_PASS_GAP_S:
        return
    if _PASS_LOCK.locked():
        return
    _LAST_PASS["at"] = time.time()
    snapshot = [dict(r) for r in rows]

    def work() -> None:
        try:
            run_pass(snapshot, dsn)
        except Exception:  # noqa: BLE001 — a top-up never breaks a build
            pass

    threading.Thread(target=work, name="hr-digest-top-up", daemon=True).start()


def census(rows: list[dict]) -> dict:
    """What the digest knows, counted from the rows it just shaped."""
    got: dict[str, Any] = {"rows": len(rows), "verdicts": {}, "states": {},
                           "names": {}, "travels": 0}
    for row in rows:
        v = row.get("digest_verdict") or "(pending)"
        s = row.get("digest_state") or "(none)"
        got["verdicts"][v] = got["verdicts"].get(v, 0) + 1
        got["states"][s] = got["states"].get(s, 0) + 1
        for person in row.get("digest_people") or []:
            m = person.get("match") or "?"
            got["names"][m] = got["names"].get(m, 0) + 1
    got["travels"] = len(availability(rows))
    return got


if __name__ == "__main__":  # the manual pass: reads, counts, names nobody
    import sys

    _dsn = os.getenv("HUB_SNAPSHOT_PG_DSN") or os.getenv("DATABASE_URL") or ""
    if not _dsn:
        sys.exit("HUB_SNAPSHOT_PG_DSN is not set")
    _n = int(sys.argv[1]) if len(sys.argv) > 1 else ROWS_PER_PASS
    # THE MANUAL PASS IS THE ONLY ONE IN THIS PROCESS.
    os.environ["HUB_HR_DIGEST_ROWS"] = "0"
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import hr_slices  # noqa: E402 — the rows come from the one builder

    _rows, _ = hr_slices.build("staffIssues", _dsn)
    _did = run_pass(_rows, _dsn, limit=_n)
    # Re-shaped AFTER the pass, so the census counts what the cache now holds rather than what it held when the rows…
    _after, _ = hr_slices.build("staffIssues", _dsn)
    print(json.dumps({"pass": _did, "cache": str(CACHE_PATH),
                      "census": census(_after)}, indent=2, sort_keys=True))
