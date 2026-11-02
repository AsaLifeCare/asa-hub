"""Staff Broadcast (CommBroadcast.gs) on Python: who a broadcast reaches — off the hotline calendar, the People house,
the Staff Preferences copy and the Desk's keywords — its words rendered as the page shows them, and the preview a send
is checked against (staffBroadcastPreview). The broadcasts are rows in Postgres (app/resource_rows.py, uploaded from
the comm_broadcasts house as the app is given to Python); comm_broadcast_writes.py sends, continues and withdraws them,
and carries in the morning what the quiet window held, the relay's clock asking which (staffBroadcastHeld)."""
from __future__ import annotations

import hashlib
import re
from typing import Any, Callable

import gsjs
import locations as L
import resource_rows as RR
import smart_comms as SC
import smart_comms_desk as SCD
import support_desk_writes as SDW

APP_ID = "broadcast"
RESOURCE = SCD.COMM_BROADCAST_RESOURCE
TAB = SCD.COMM_BROADCAST_HOUSE
SITUATION = SCD.COMM_BROADCAST_SITUATION
HEADER = ("id", "createdAt", "updatedAt", "client_id", "by_email", "by_name", "by_badges", "audience", "audience_label",
          "house", "meddel", "message", "signature", "body_sample", "state", "count", "sent", "recorded", "held",
          "refused", "failed", "pending", "withdrawn", "test_mode", "dial", "why", "warnings", "dropped", "recipients",
          "next_index", "audience_sha", "withdrawn_by", "withdrawn_at", "finished_at")
TEXT_MIN, TEXT_MAX, SIGNATURE_MAX = 2, 1400, 160
SMS_MAX = 1600
# a guard against a runaway resolver, not an audience limit
MAX = 200
# an open shift never says why or who; these words warn, never block
REASON_WORDS = ("emergency, hospital, hospitalized, sick, illness, family, injured, injury, accident, surgery, funeral, "
                "passed away, died, death, doctor, covid, car trouble, called off, call off, calling off, called out, "
                "call out, calling out, no call, no show")
# hm: a house manager may choose it; staff: the reason warning applies; cc: the Cc cell joins
AUDIENCES: dict[str, dict[str, Any]] = {
    "allstaff": {"label": "All staff", "hm": True, "staff": True, "cc": True},
    "meddel": {"label": "Only Med Del", "hm": True, "staff": True, "cc": True},
    "house": {"label": "One house", "hm": True, "staff": True, "cc": False},
    "leadership": {"label": "Leadership", "hm": False, "staff": False, "cc": True},
    "prn": {"label": "PRN", "hm": True, "staff": True, "cc": False}}
OPTIONAL = ("signature", "first_name", "name", "sender_name", "house")
DROP_WORDS = {
    "client": "is a client, never staff",
    "not_on_staff": "is not on staff in People (the status column)",
    "no_number": "carries no number",
    "not_textable": "carries a shared company line or a number we cannot text",
    "opted_out": "asked us to stop",
    "opt_out_unreadable": "the opt-out list could not be read, so nobody is texted rather than somebody who asked us to "
                          "stop",
    "not_found": "is on the PRN list and nowhere else we can find a number",
    "cc_address": "is an e-mail address in the Cc cell, and a broadcast is a text"}
# the master calendar's Staff Preferences: a note of exactly "PRN" counts, one that only mentions it is reported
PRN_SHEET = "1_S62kl6hh0XG_3OK25X-AZYuYo3Apfm5oCAvvmdodfU"
PRN_TAB = "Staff Preferences"
_PRN_WORD = re.compile(r"\bprn\b", re.IGNORECASE)
GAP = "\u0001"
HELD_STATES = ("held_quiet", "carrying")

s_ = gsjs.str_
text = SCD.text


def who(reads: L.Reads, user: dict | None) -> dict[str, Any]:
    return SCD.broadcast_who(reads, user)


def denied(w: dict[str, Any]) -> dict[str, Any]:
    """commBroadcastDenied_."""
    return {"status": 403, "message": w.get("why") or "Broadcasting is not open to this account."}


def required(payload: dict, keys: tuple[str, ...]) -> dict[str, Any] | None:
    """hubPolicyGate_'s params for these doors: each one required, and a string."""
    for k in keys:
        v = payload.get(k)
        if v is None or v == "":
            return {"status": 400, "message": f"Missing required parameter: {k}."}
        if not isinstance(v, str):
            got = ("array" if isinstance(v, list) else "boolean" if isinstance(v, bool)
                   else "number" if isinstance(v, (int, float)) else "object")
            return {"status": 400, "message": f"{k} must be string, got {got}."}
    return None


def _lines(v: Any) -> str:
    return re.sub(r"\r\n?", "\n", gsjs.js_str(v) if v is not None else "")


def spec_of(payload: dict) -> dict[str, Any]:
    """commBroadcastSpec_."""
    p = payload if isinstance(payload, dict) else {}
    audience = text(p.get("audience")).lower()
    house = audience == "house"
    md = p.get("meddel")
    meddel = house and (md is True or gsjs.or_text(md).lower() in ("yes", "true"))
    return {"audience": audience, "house": text(p.get("house")) if house else "", "meddel": meddel,
            "message": gsjs.trim(_lines(p.get("message"))), "signature": gsjs.trim(_lines(p.get("signature")))}


def audience_label(spec: dict) -> str:
    """commBroadcastAudienceLabel_."""
    d = AUDIENCES.get(spec["audience"])
    if d is None:
        return spec["audience"]
    if spec["audience"] == "house":
        return "One house — " + SCD.house_label(spec["house"]) + (", Med Del only" if spec["meddel"] else "")
    return d["label"]


def allowed(reads: L.Reads, spec: dict, w: dict, cal: dict | None, user: dict | None) -> str:
    """commBroadcastAllowed_."""
    d = AUDIENCES.get(spec["audience"])
    if d is None:
        return "Choose who the broadcast goes to: " + ", ".join(AUDIENCES) + "."
    if not w["ok"]:
        return w["why"]
    if spec["audience"] == "house":
        if not cal or not cal["readable"]:
            return ""
        if spec["house"] not in cal["houses"]:
            return "That house is not on the calendar in the window this lane reads — pick one of the houses listed."
    if w["above"]:
        return ""
    if not d["hm"]:
        return (d["label"] + " reaches the directors' group and every house manager, so it is sent by a director, team "
                "lead, administrator or the master.")
    if spec["audience"] == "house":
        own = SCD.own_houses(reads, user or {}, cal)
        if spec["house"] not in own["houses"]:
            return ("A house manager writes to the staff of their own house — the calendar names you as the manager of "
                    + (", ".join(SCD.house_label(h) for h in own["houses"]) if own["houses"]
                       else "no house in the window it reads") + ".")
    return ""


# ---- who it reaches ------------------------------------------------------------------------------------------------

def _out(spec: dict) -> dict[str, Any]:
    return {"readable": True, "why": [], "notes": [], "entries": [], "seen": {}, "dropped": {},
            "label": audience_label(spec), "counted": {"duplicate": 0}, "refused": ""}


def drop(out: dict, reason: str, name: Any, many: int | None = None) -> None:
    """commBroadcastDrop_."""
    d = out["dropped"].setdefault(reason, {"reason": reason, "label": DROP_WORDS.get(reason, reason), "count": 0,
                                           "names": []})
    d["count"] += 1 if many is None else int(many or 0)
    if len(d["names"]) < 60 and not gsjs.falsy(name):
        d["names"].append(gsjs.js_str(name))


def add(reads: L.Reads, out: dict, e: dict) -> None:
    """commBroadcastAdd_: one number once, never somebody who asked us to stop."""
    to = text(e.get("to"))
    key = SCD.digits(to)[-10:]
    if len(key) != 10:
        drop(out, "not_textable", e.get("name"))
        return
    if key in out["seen"]:
        out["counted"]["duplicate"] += 1
        return
    blocked = SCD.opt_out_blocked(reads, to, SCD.OPT_OUT_SCOPE_DESK)
    if blocked:
        # any answer other than a person's stop is the list failing, which refuses too
        drop(out, "opted_out" if blocked.startswith("This person asked us to stop") else "opt_out_unreadable",
             e.get("name"))
        return
    out["seen"][key] = True
    out["entries"].append({"name": text(e.get("name")), "to": "+1" + key, "key": key, "from": s_(e.get("from")),
                           "group": bool(e.get("group"))})


def people(reads: L.Reads) -> dict[str, Any]:
    """commBroadcastPeople_: the People house by folded name, the one on staff (and with a phone) kept."""
    out: dict[str, Any] = {"readable": False, "why": "", "by_key": {}, "on_staff": set()}
    rows, _why = SCD.attempt(lambda: SCD.broadcast_people_rows(reads))
    if rows is None:
        out["why"] = ("the People house could not be read — nobody was resolved, which is a refusal and not an empty "
                      "company")
        return out
    out["readable"] = True
    on = set(SDW.block_statuses(reads)) or {"active", "admin"}
    out["on_staff"] = on
    for p in rows:
        key = gsjs.name_key((p or {}).get("name"))
        if not key:
            continue
        mine = {"name": text(p.get("name")), "phone": text(p.get("phone")), "status": text(p.get("status")).lower()}
        cur = out["by_key"].get(key)
        if cur is None or (cur["status"] not in on and mine["status"] in on) or \
                ((cur["status"] in on) == (mine["status"] in on) and not cur["phone"] and mine["phone"]):
            out["by_key"][key] = mine
    return out


def client_keys(reads: L.Reads) -> set[str]:
    """ispClientNameKeys_: a name a plan carries is a client's; no plan list names nobody (a copy that cannot be read
    is never taken for none)."""
    import clients as C  # noqa: PLC0415 - the clients' own reads
    got, _why = SCD.attempt(lambda: C._hub(reads, "isps"))
    return {k for k in (gsjs.name_key((r or {}).get("client_name")) for r in got or []) if k}


def prn_from(rows: list[dict]) -> dict[str, Any]:
    """staff_broadcast.prn_from_staff: only a note of exactly "PRN" counts."""
    names: list[str] = []
    exact: set[str] = set()
    for r in rows:
        name, note = text(r.get("name")), text(r.get("note"))
        key = gsjs.name_key(name)
        if not key or key in exact or note.upper() != "PRN":
            continue
        exact.add(key)
        names.append(name)
    mentions: list[dict[str, str]] = []
    said: set[str] = set()
    for r in rows:
        name, note = text(r.get("name")), text(r.get("note"))
        key = gsjs.name_key(name)
        if not key or key in exact or key in said or not _PRN_WORD.search(note):
            continue
        said.add(key)
        mentions.append({"name": name, "note": note[:80]})
    return {"names": names, "mentions": mentions}


def prn(reads: L.Reads) -> dict[str, Any]:
    """commBroadcastPrn_: who is PRN, off the master calendar's Staff Preferences copy."""
    out: dict[str, Any] = {"readable": False, "names": [], "mentions": [], "why": "", "as_of": ""}
    try:
        ref = reads.tab_of(PRN_SHEET, PRN_TAB, "the master calendar")
        if ref is None:
            raise LookupError("the master calendar has no tab named " + PRN_TAB)
        heads = {gsjs.trim(gsjs.js_str(h)): h for h in ref.headers}
        name_h, note_h = heads.get("Select Your Name"), heads.get("NOTE")
        rows = [{"name": raw.get(name_h) if name_h else "", "note": raw.get(note_h) if note_h else ""}
                for _rn, raw in reads.db.rows(ref)]
    except Exception as exc:  # noqa: BLE001 - "we cannot see", never "nobody is PRN"
        out["why"] = ("the Staff Preferences mirror could not be read: " + (str(exc) or type(exc).__name__))[:200]
        return out
    got = prn_from([r for r in rows if text(r["name"])])
    out.update(readable=True, names=[n for n in got["names"] if n], mentions=got["mentions"][:20])
    return out


def from_calendar(reads: L.Reads, folks: list[dict], ctx: dict, out: dict) -> None:
    """commBroadcastFromCalendar_: People's number first, the calendar's when People carries none."""
    for cp in folks:
        key = cp.get("key") or gsjs.name_key(cp.get("name"))
        if not key:
            continue
        if key in ctx["clients"]:
            drop(out, "client", cp.get("name"))
            continue
        p = ctx["people"]["by_key"].get(key)
        if p is not None and p["status"] not in ctx["people"]["on_staff"]:
            drop(out, "not_on_staff", cp.get("name"))
            continue
        num = SCD.sendable(p["phone"]) if p is not None and p["phone"] else ""
        frm = "people"
        if not num and cp.get("phone"):
            num, frm = SCD.sendable(cp.get("phone")), "calendar"
        if not num:
            drop(out, "not_textable" if (p is not None and p["phone"]) or cp.get("phone") else "no_number",
                 cp.get("name"))
            continue
        add(reads, out, {"name": (p["name"] if p is not None and p["name"] else cp.get("name")), "to": num,
                         "from": frm})


def _keyword(reads: L.Reads, word: str) -> dict[str, Any]:
    """SMART_TO_KEYWORDS[word].resolve({})."""
    if word == "allstaff":
        return SCD.everyone_audience(reads, reads.config())
    if word == "housemanagers":
        return SCD.house_managers_audience(reads)
    return SCD.directors_audience()


def from_keyword(reads: L.Reads, word: str, out: dict, from_label: str = "") -> None:
    """commBroadcastFromKeyword_."""
    got, _why = SCD.attempt(lambda: _keyword(reads, word))
    if not got or not (got["readable"] if "readable" in got else got.get("ok")):
        out["readable"] = False
        out["why"].append("`" + word + "` could not be resolved: " + ((got or {}).get("why") or
                                                                     "the house behind it did not answer")
                          + " — that is \"we cannot see\", never \"this reaches nobody\"")
        return
    for p in got.get("people") or []:
        phone = gsjs.or_text((p or {}).get("phone"))
        add(reads, out, {"name": gsjs.or_text((p or {}).get("name")), "to": phone,
                         "from": from_label or "keyword:" + word,
                         "group": word == "directors" or SCD.shared_key(reads, phone)})
    counted = got.get("counted") or {}
    if counted.get("no_phone"):
        drop(out, "no_number", "", counted["no_phone"])
    if counted.get("refused"):
        drop(out, "opted_out", "", counted["refused"])


def from_cc(reads: L.Reads, sit: dict, out: dict) -> None:
    """commBroadcastFromCc_: the situation's Cc cell — a keyword, or a team line a copy may reach."""
    for entry in SCD.smart_list(sit.get("cc")):
        word = SCD.to_keyword(entry)
        if word:
            from_keyword(reads, word, out, "cc:" + word)
            continue
        if "@" in entry:
            drop(out, "cc_address", "")
            continue
        num = SCD.team_copy_number(entry)
        if not num:
            drop(out, "not_textable", "")
            continue
        add(reads, out, {"name": "", "to": num, "from": "cc"})


def resolve(reads: L.Reads, spec: dict, w: dict, user: dict | None, sit: dict | None) -> dict[str, Any]:
    """commBroadcastResolve_: `refused` and `readable: False` are never an empty list and never sent to."""
    out = _out(spec)
    cal = SCD.broadcast_calendar(reads) if spec["audience"] in ("house", "meddel", "prn") else None
    refused = allowed(reads, spec, w, cal, user)
    if refused:
        out["refused"], out["readable"] = refused, False
        return done(out)
    ctx: dict[str, Any] = {}

    def need_ctx() -> dict[str, Any]:
        if not ctx:
            ctx.update(people=people(reads), clients=client_keys(reads))
            if not ctx["people"]["readable"]:
                out["readable"] = False
                out["why"].append(ctx["people"]["why"])
        return ctx

    aud = spec["audience"]
    if aud == "allstaff":
        from_keyword(reads, "allstaff", out, "keyword:allstaff")
    elif aud == "leadership":
        from_keyword(reads, "housemanagers", out, "keyword:housemanagers")
        from_keyword(reads, "directors", out, "keyword:directors")
    elif aud in ("house", "meddel"):
        if not cal["readable"]:
            out["readable"] = False
            out["why"].append(cal["why"])
            return done(out)
        if not need_ctx()["people"]["readable"]:
            return done(out)
        if aud == "house":
            folks = [p for p in (cal["houses"].get(spec["house"]) or {"people": []})["people"]
                     if not spec["meddel"] or p["meddel"]]
        else:
            by_key: dict[str, dict] = {}
            for loc in cal["order"]:
                for p in cal["houses"][loc]["people"]:
                    if not p["meddel"]:
                        continue
                    if p["key"] not in by_key:
                        by_key[p["key"]] = {"name": p["name"], "key": p["key"], "phone": p["phone"]}
                    elif not by_key[p["key"]]["phone"] and p["phone"]:
                        by_key[p["key"]]["phone"] = p["phone"]
            folks = list(by_key.values())
        from_calendar(reads, folks, ctx, out)
    elif aud == "prn":
        listed = prn(reads)
        if not listed["readable"]:
            out["readable"] = False
            out["why"].append(listed["why"])
            return done(out)
        if not need_ctx()["people"]["readable"]:
            return done(out)
        cal_phones: dict[str, str] = {}
        if cal and cal["readable"]:
            for loc in cal["order"]:
                for p in cal["houses"][loc]["people"]:
                    if p["phone"] and p["key"] not in cal_phones:
                        cal_phones[p["key"]] = p["phone"]
        folks = []
        for n in listed["names"]:
            k = gsjs.name_key(n)
            if not k:
                continue
            if k not in ctx["people"]["by_key"] and k not in cal_phones:
                drop(out, "not_found", n)
                continue
            folks.append({"name": n, "key": k, "phone": cal_phones.get(k, "")})
        from_calendar(reads, folks, ctx, out)
        if listed["mentions"]:
            out["notes"].append(str(len(listed["mentions"])) + " Staff Preferences note(s) mention PRN beside other "
                                "words and were not counted: " + ", ".join(
                                    m["name"] + (' ("' + m["note"][:40] + '")' if m["note"] else "")
                                    for m in listed["mentions"]))
    if AUDIENCES[aud]["cc"] and sit:
        from_cc(reads, sit, out)
    return done(out)


def done(out: dict) -> dict[str, Any]:
    """commBroadcastAudienceDone_: names in order, the Cc cell after them."""
    main = sorted((e for e in out["entries"] if not e["from"].startswith("cc")), key=lambda e: e["name"].lower())
    cc = [e for e in out["entries"] if e["from"].startswith("cc")]
    out["entries"] = main + cc
    if out["counted"]["duplicate"]:
        out["notes"].append(str(out["counted"]["duplicate"]) + " number(s) appeared twice and are texted once")
    out["dropped"] = list(out["dropped"].values())
    out.pop("seen", None)
    return out


def sha(entries: list[dict]) -> str:
    """commBroadcastSha_: the send is refused if the list changed since the preview."""
    keys = ",".join(sorted(s_(e.get("key")) for e in entries))
    return hashlib.md5(keys.encode("utf-8")).hexdigest()[:20]


# ---- the words -----------------------------------------------------------------------------------------------------

def text_problem(message: str, signature: str) -> str:
    """commBroadcastTextProblem_."""
    m, s = gsjs.trim(message), gsjs.trim(signature)
    if len(re.sub(r"\s+", "", m)) < TEXT_MIN:
        return "Write the message first — an empty or one-character text is never sent to a group."
    if SC._len16(m) > TEXT_MAX:
        return (f"The message is {SC._len16(m)} characters; a broadcast carries at most {TEXT_MAX} so it arrives as one "
                "text.")
    if SC._len16(s) > SIGNATURE_MAX:
        return f"The signature is {SC._len16(s)} characters; it may be at most {SIGNATURE_MAX}."
    return ""


def reason_hits(reads: L.Reads, said: str) -> list[str]:
    """commBroadcastReasonHits_: the words of a reason, warned and never blocked."""
    def fold(v: str) -> str:
        return " " + re.sub(r"[^a-z0-9']+", " ", v.lower()).strip() + " "
    raw = SCD.digest_word(reads, "comm_broadcast_reason_words", REASON_WORDS)
    words = [x for x in (w.strip().lower() for w in re.split(r"[,;\n]+", raw)) if x]
    t = fold(said)
    hits: list[str] = []
    for w in words:
        ww = fold(w)
        if ww.strip() and ww in t and w not in hits:
            hits.append(w)
    return hits


_EDGE_START = re.compile("^[ \t]*" + GAP + "[ \t]*[,;:\\-–—]*[ \t]*")
_EDGE_END = re.compile("[ \t]*[,;:\\-–—]*[ \t]*" + GAP + "[ \t]*$")
_BEFORE_MARK = re.compile("[ \t]*" + GAP + "[ \t]*([,.;:!?])")
_INSIDE = re.compile("[ \t]*" + GAP + "[ \t]*")
_FIELD = re.compile(r"\{(\w+)\}")


def render(tpl: Any, v: dict[str, Any]) -> str:
    """commBroadcastRender_: an empty optional placeholder closes its own gap; typed text is never touched."""
    out: list[str] = []
    for line in _lines(tpl).split("\n"):
        emptied = [False]

        def sub(m: re.Match) -> str:
            k = m.group(1)
            val = v.get(k)
            if val is not None and gsjs.js_str(val) != "":
                return gsjs.js_str(val).replace(GAP, "")
            if k in OPTIONAL:
                emptied[0] = True
                return GAP
            return m.group(0)

        rendered = _FIELD.sub(sub, line)
        if emptied[0]:
            if not re.search(r"[A-Za-z0-9]", rendered.replace(GAP, "")):
                continue
            rendered = _EDGE_START.sub("", rendered, count=1)
            rendered = _EDGE_END.sub("", rendered, count=1)
            rendered = _BEFORE_MARK.sub(r"\1", rendered)
            rendered = _INSIDE.sub(" ", rendered).replace(GAP, "")
        out.append(rendered)
    joined = re.sub(r"\n{3,}", "\n\n", "\n".join(out))
    return re.sub(r"^\s+|\s+$", "", joined)


def vars_of(row: dict, r: dict | None) -> dict[str, Any]:
    """commBroadcastVars_."""
    name = text((r or {}).get("n")) if r and not r.get("g") else ""
    return {"message": gsjs.or_text(row.get("message")), "signature": gsjs.or_text(row.get("signature")),
            "first_name": (re.split(r"\s+", name)[0] if name else ""), "name": name,
            "sender_name": gsjs.or_text(row.get("by_name")), "sender": SC.SENDER_DEFAULT,
            "house": SCD.house_label(row["house"]) if row.get("house") else "",
            "audience": gsjs.or_text(row.get("audience_label"))}


def longest(sit: dict, row: dict, entries: list[dict]) -> str:
    """commBroadcastLongest_: the longest copy any recipient would get."""
    most = ""
    sample = entries[:MAX] or [{"n": ""}]
    for e in sample:
        said = render(sit.get("sms_text"), vars_of(row, {"n": e.get("name") or e.get("n"),
                                                         "g": e.get("group") or e.get("g")}))
        if SC._len16(said) > SC._len16(most):
            most = said
    return most


def situation(reads: L.Reads) -> dict | None:
    """commBroadcastSituation_: on, naming sms, and its words still carrying {message}."""
    sit = SCD.situation_on(SCD.situations(reads), SITUATION)
    if sit is None or "sms" not in SCD.smart_list(sit.get("channels")):
        return None
    return sit if "{message}" in gsjs.or_text(sit.get("sms_text")) else None


def preview_out(reads: L.Reads, spec: dict, aud: dict, sit: dict | None, w: dict) -> dict[str, Any]:
    """commBroadcastPreviewOut_."""
    d = AUDIENCES.get(spec["audience"]) or {}
    sample_row = {"message": spec["message"], "signature": spec["signature"], "by_name": w["name"],
                  "house": spec["house"], "audience_label": aud["label"]}
    first = aud["entries"][0] if aud["entries"] else None
    sample = render(sit.get("sms_text"), vars_of(sample_row, {"n": first["name"], "g": first["group"]} if first
                                                  else {"n": ""})) if sit else ""
    most = longest(sit, sample_row, aud["entries"]) if sit else ""
    return {
        "audience": spec["audience"], "audience_label": aud["label"], "house": spec["house"],
        "house_label": SCD.house_label(spec["house"]) if spec["house"] else "", "meddel": spec["meddel"],
        "readable": bool(aud["readable"]), "refused": aud["refused"], "why": aud["why"], "notes": aud["notes"],
        "count": len(aud["entries"]), "cap": MAX, "over_cap": len(aud["entries"]) > MAX,
        "recipients": [{"name": e["name"] or ("Cc cell" if e["from"].startswith("cc") else ""),
                        "to": SCD.mask(e["to"]), "from": e["from"]} for e in aud["entries"]],
        "dropped": aud["dropped"], "audience_sha": sha(aud["entries"]), "sample": sample, "chars": SC._len16(most),
        "too_long": SC._len16(most) > SMS_MAX,
        "reason_words": reason_hits(reads, spec["message"] + "\n" + spec["signature"]) if d.get("staff") else [],
        "situation": SCD.broadcast_situation_state(reads), "mode": SCD.broadcast_mode(reads)}


# ---- the doors -----------------------------------------------------------------------------------------------------

def preview(sess: L.Session, payload: dict) -> dict[str, Any]:
    """staffBroadcastPreview: recipients, exclusions, the rendered message, warnings."""
    reads = sess.reads
    p = payload if isinstance(payload, dict) else {}
    bad = required(p, ("audience", "message"))
    if bad:
        return bad
    w = who(reads, sess.user)
    if not w["ok"]:
        return denied(w)
    spec = spec_of(p)
    problem = text_problem(spec["message"], spec["signature"])
    if problem:
        return {"status": 400, "message": problem}
    sit = situation(reads)
    aud = resolve(reads, spec, w, sess.user, sit)
    if aud["refused"]:
        return {"status": 403, "message": aud["refused"]}
    return {"status": 200, "data": preview_out(reads, spec, aud, sit, w)}


def held(sess: L.Session, payload: dict) -> dict[str, Any]:
    """The relay's clock asks which broadcasts the quiet window held (none while it still holds them)."""
    if (sess.user or {}).get("is_service") is not True:
        return {"status": 403, "message": "This is the relay's own read."}
    quiet = SCD.quiet_now(sess.reads)
    ids: list[str] = []
    if not quiet and RR.uploaded(sess.reads.db, RESOURCE):
        ids = [gsjs.js_str(r["id"]) for r in SCD.broadcast_rows(sess.reads) if s_(r.get("state")) in HELD_STATES]
    return {"status": 200, "data": {"quiet": quiet, "ids": ids}}


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {"staffBroadcastPreview": preview,
                                                                    "staffBroadcastHeld": held}
# every signed-in session may ask; the door decides by badge
POLICY: dict[str, dict[str, Any]] = {"staffBroadcastPreview": {}, "staffBroadcastHeld": {}}
