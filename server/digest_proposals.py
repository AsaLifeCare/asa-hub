"""Decoder proposals counted from the readings, never guessed; a proposal is a row in the words book, never a rule."""
from __future__ import annotations

import json
import logging
import os
import re
from collections import Counter, defaultdict
from datetime import datetime, timezone
from typing import Any

log = logging.getLogger("hub.proposals")

BOOK_ID = os.getenv("HUB_GENERIC_CONFIG_ID", "1Ky7FPu876WavnMTzsO6zejDXtI1I4b2xebuMdsBMMgg")
TAB = "Digest Proposals"
KINDS_TAB = "Digest Kinds"
DRAWERS_TAB = "Digest Drawers"
HEADER = ["id", "created_at", "status", "type", "kind", "category", "needles",
          "file_hints", "family", "evidence_n", "coverage", "leak", "examples",
          "example_ids", "ledger", "decided_at", "decided_by", "notes"]

MIN_FAMILY = 3
LEAD = 300              # must match the decoder's letterhead zone
COVERAGE = 0.6
LEAK = 0.05
MAX_PHRASES = 6
MIN_PHRASE_CHARS = 10

STOP = set("""the a an and or of to in on at by for with from this that is are was were be
been it its as if then than so no not any all your you we our his her their they them
please date name page form""".split())
MONTHS = set("january february march april may june july august september october november "
             "december jan feb mar apr jun jul aug sep sept oct nov dec".split())


def _norm(s: str) -> str:
    s = (s or "").lower()
    s = re.sub(r"[‐-―−­]", "-", s)
    s = re.sub(r"[^a-z0-9'&/:.\-\s]", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def _title_tokens(title: str) -> list[str]:
    base = re.sub(r"\.[a-z0-9]{2,5}$", "", (title or "").lower())
    out = []
    for tok in re.split(r"[^a-z0-9']+", base):
        if not tok:
            continue
        if tok.isdigit() or tok in MONTHS or re.match(r"^\d", tok):
            break
        if len(tok) <= 2 and tok not in ("id", "tb"):
            continue
        out.append(tok)
        if len(out) == 3:
            break
    return out


def family_of(title: str) -> str:
    toks = _title_tokens(title)
    return " ".join(toks[:2]) if toks else ""


def _ngrams(text: str, lo: int = 2, hi: int = 5) -> set[str]:
    words = _norm((text or "")[:LEAD]).split()
    out: set[str] = set()
    for n in range(lo, hi + 1):
        for i in range(0, max(0, len(words) - n + 1)):
            g = words[i:i + n]
            if g[0] in STOP or g[-1] in STOP:
                continue
            if all(w in STOP or w.isdigit() for w in g):
                continue
            phrase = " ".join(g).strip(" -:/.")
            if len(phrase) >= MIN_PHRASE_CHARS and not re.search(r"\d{3,}", phrase):
                out.add(phrase)
    return out


def _snake(s: str) -> str:
    return re.sub(r"_+", "_", re.sub(r"[^a-z0-9]+", "_", (s or "").lower())).strip("_")


def _tight(toks: list[str]) -> str:
    return re.sub(r"[^a-z0-9]", "", "".join(toks))


def read_tab(sheets, tab: str) -> tuple[list[str], list[dict]]:
    got = sheets.spreadsheets().values().get(
        spreadsheetId=BOOK_ID, range=f"'{tab}'!A1:Z2000").execute().get("values") or []
    if not got:
        return [], []
    head = [re.sub(r"[^a-z0-9]+", "_", str(h).strip().lower()) for h in got[0]]
    rows = []
    for line in got[1:]:
        row = {head[i]: (str(line[i]).strip() if i < len(line) else "") for i in range(len(head)) if head[i]}
        if any(row.values()):
            rows.append(row)
    return head, rows


_TAB_KNOWN = {"ok": False}


def ensure_tab(sheets) -> None:
    """Asked of Google once per process: the read quota is shared with the site."""
    if _TAB_KNOWN["ok"]:
        return
    meta = sheets.spreadsheets().get(spreadsheetId=BOOK_ID, fields="sheets.properties.title").execute()
    titles = {s["properties"]["title"] for s in meta.get("sheets", [])}
    if TAB not in titles:
        sheets.spreadsheets().batchUpdate(
            spreadsheetId=BOOK_ID,
            body={"requests": [{"addSheet": {"properties": {"title": TAB}}}]}).execute()
        sheets.spreadsheets().values().update(
            spreadsheetId=BOOK_ID, range=f"'{TAB}'!A1",
            valueInputOption="RAW", body={"values": [HEADER]}).execute()
        log.info("proposals: tab created in the words book")
    _TAB_KNOWN["ok"] = True


def known_kinds(sheets) -> dict[str, dict]:
    _, rows = read_tab(sheets, KINDS_TAB)
    out = {}
    for r in rows:
        k = _snake(r.get("kind", ""))
        if not k:
            continue
        out[k] = {"category": r.get("category", ""),
                  "needles": [n.strip() for n in (r.get("needles") or "").split(",") if n.strip()],
                  "file_hints": [h.strip() for h in (r.get("file_hints") or "").split(",") if h.strip()]}
    return out


ISSUERS_TAB = "Digest Issuers"


def house_names(sheets) -> list[str]:
    """A phrase carrying one of these names a sender, not a kind."""
    _, rows = read_tab(sheets, ISSUERS_TAB)
    out = []
    for r in rows:
        n = (r.get("name") or "").strip().lower()
        if n and (r.get("is_organisation") or "").lower() in ("yes", "true", "1", "org", "organisation", "organization"):
            out.append(n)
    return out + ["asa lifecare", "a brighter dawn", "brighter dawn", "asa hub"]


def drawer_categories(sheets) -> list[tuple[str, str]]:
    _, rows = read_tab(sheets, DRAWERS_TAB)
    out = [((r.get("drawer_prefix") or "").lower(), r.get("category") or "") for r in rows
           if (r.get("drawer_prefix") or "").strip() and (r.get("active") or "yes").lower() not in ("no", "off", "false")]
    return sorted(out, key=lambda x: -len(x[0]))


CATEGORY_LEXICON = [
    ("medical", ["medication", "physician", "clinic", "patient", "pharmacy", "nurse",
                 "hospital", "health", "diagnosis", "vitals", "blood"]),
    ("receipt_invoice", ["transaction", "amount", "payment", "invoice", "receipt", "balance",
                         "funds", "deposit", "statement"]),
    ("identity", ["social security", "birth certificate", "passport", "license", "state id"]),
    ("certification_training", ["certificate", "certification", "training", "course"]),
    ("incident", ["incident", "injury", "mui"]),
    ("legal", ["agreement", "consent", "authorization", "waiver", "notice", "policy"]),
    ("care_plan", ["service plan", "isp", "plan of care", "goals", "outcomes"]),
]


def _category(folder_counts: Counter, phrases: list[str], drawers: list[tuple[str, str]]) -> tuple[str, str]:
    if folder_counts:
        top, _ = folder_counts.most_common(1)[0]
        for prefix, cat in drawers:
            if prefix and top.lower().startswith(prefix):
                return cat, f"drawer '{top}'"
    hay = " ".join(phrases)
    for cat, words in CATEGORY_LEXICON:
        if any(w in hay for w in words):
            return cat, "lexicon"
    return "other", "default"


def _clean_phrase(p: str, banned: list[str]) -> bool:
    if "@" in p or re.search(r"\.(com|org|net|gov)\b", p):
        return False
    if any(b in p for b in banned):
        return False
    return sum(1 for w in p.split() if len(w) >= 4) >= 1


def build(rows: list[dict], kinds: dict[str, dict], drawers: list[tuple[str, str]],
          decided: set[str], ledger: str, banned: list[str] | None = None) -> list[dict]:
    banned = banned or []
    drawer_words = {_snake(d) for d, _ in drawers} | {"med_documents", "documents", "funds", "misc"}
    hint_owner = {}
    for k, v in kinds.items():
        for h in v["file_hints"]:
            hint_owner[h] = k
    fam_rows: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        if (r.get("kind") or "").strip():
            continue
        if not (r.get("text") or "").strip() or "camscanner" in (r.get("text") or "")[:200].lower():
            continue
        f = family_of(r.get("title") or "")
        if f:
            fam_rows[f].append(r)
    grams = {r["id"]: _ngrams(r.get("text") or "") for r in rows if (r.get("text") or "").strip()}
    n_all = max(1, len(grams))
    corpus: Counter = Counter()
    for g in grams.values():
        corpus.update(g)
    out = []
    for fam, members in sorted(fam_rows.items(), key=lambda kv: -len(kv[1])):
        if len(members) < MIN_FAMILY:
            continue
        toks = _title_tokens(members[0].get("title") or "")
        name = _snake(fam)
        if not name or name in decided:
            continue
        # a word that names a folder does not name a document
        if name in drawer_words or _snake(toks[0] if toks else "") in drawer_words:
            continue
        hints = sorted({_tight(toks)} | {t for t in toks if len(t) >= 7})
        # a family whose title the book already reads extends that kind
        owner = next((hint_owner[h] for h in hints if h in hint_owner), None)
        if not owner:
            owner = next((hint_owner[h] for h in hint_owner if h in _tight(toks) and len(h) >= 7), None)
        if owner:
            name = owner
        fam_ids = {m["id"] for m in members}
        cnt: Counter = Counter()
        for m in members:
            cnt.update(grams.get(m["id"], set()))
        n = len(members)
        scored = []
        for phrase, c in cnt.items():
            cov = c / n
            if cov < COVERAGE or not _clean_phrase(phrase, banned):
                continue
            leak = (corpus[phrase] - c) / max(1, n_all - n)
            if leak > LEAK:
                continue
            scored.append((cov, -leak, len(phrase), phrase))
        scored.sort(reverse=True)
        phrases: list[str] = []
        for cov, nleak, ln, phrase in scored:
            if any(phrase in p or p in phrase for p in phrases):
                continue
            phrases.append(phrase)
            if len(phrases) >= MAX_PHRASES:
                break
        if not phrases:
            continue
        # a phrase the book already carries means the family is covered, not new
        covered = None
        for k, v in kinds.items():
            for nd in v["needles"]:
                if any(nd in p or p in nd for p in phrases):
                    covered = k
                    break
            if covered:
                break
        if covered and covered != name:
            continue
        coverage = round(min(cnt[p] for p in phrases) / n, 2)
        leak = round(max((corpus[p] - cnt[p]) / max(1, n_all - n) for p in phrases), 3)
        folders = Counter((m.get("folder") or "").strip() for m in members if (m.get("folder") or "").strip())
        category, why = _category(folders, phrases, drawers)
        ptype = "extend" if name in kinds else "new"
        if ptype == "extend":
            category = kinds[name]["category"] or category
            phrases = [p for p in phrases if p not in kinds[name]["needles"]]
            hints = [h for h in hints if h not in kinds[name]["file_hints"]]
            if not phrases and not hints:
                continue
        examples = [str(m.get("title") or "")[:60] for m in members[:3]]
        out.append({
            "id": f"P_{ledger[:1]}_{name}",
            "created_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "status": "proposed", "type": ptype, "kind": name, "category": category,
            "needles": ", ".join(phrases), "file_hints": ", ".join(hints),
            "family": fam, "evidence_n": str(n), "coverage": str(coverage), "leak": str(leak),
            "examples": " | ".join(examples), "example_ids": ",".join(sorted(fam_ids)[:12]),
            "ledger": ledger, "decided_at": "", "decided_by": "",
            "notes": f"category by {why}",
        })
    return out


def teach(row: dict, kind: str, all_rows: list[dict], kinds: dict[str, dict], ledger: str) -> dict | None:
    mine = _ngrams(row.get("text") or "")
    if not mine:
        return None
    corpus: Counter = Counter()
    for r in all_rows:
        if r["id"] == row["id"]:
            continue
        corpus.update(_ngrams(r.get("text") or ""))
    n_all = max(1, len(all_rows) - 1)
    scored = sorted(((corpus[p] / n_all, -len(p), p) for p in mine if corpus[p] / n_all <= LEAK))
    phrases: list[str] = []
    for leak, nl, p in scored:
        if any(p in q or q in p for q in phrases):
            continue
        phrases.append(p)
        if len(phrases) >= 4:
            break
    kind = _snake(kind)
    known = kinds.get(kind, {"needles": [], "file_hints": [], "category": ""})
    phrases = [p for p in phrases if p not in known["needles"]]
    if not phrases:
        return None
    return {
        "id": f"T_{ledger[:1]}_{row['id']}",
        "created_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "status": "proposed", "type": "extend" if kind in kinds else "new",
        "kind": kind, "category": known.get("category") or "other",
        "needles": ", ".join(phrases),
        "file_hints": ", ".join(t for t in _title_tokens(row.get("title") or "") if len(t) >= 7),
        "family": family_of(row.get("title") or ""), "evidence_n": "1", "coverage": "1.0",
        "leak": str(round(max((corpus[p] / n_all for p in phrases), default=0.0), 3)),
        "examples": str(row.get("title") or "")[:60], "example_ids": row["id"], "ledger": ledger,
        "decided_at": "", "decided_by": "", "notes": "taught by hand",
    }


def existing(sheets) -> dict[str, dict]:
    ensure_tab(sheets)
    _, rows = read_tab(sheets, TAB)
    return {r.get("id", ""): r for r in rows if r.get("id")}


def write(sheets, proposals: list[dict]) -> int:
    have = existing(sheets)
    fresh = [p for p in proposals if p["id"] not in have]
    if not fresh:
        return 0
    sheets.spreadsheets().values().append(
        spreadsheetId=BOOK_ID, range=f"'{TAB}'!A1:R1", valueInputOption="RAW",
        insertDataOption="INSERT_ROWS",
        body={"values": [[p.get(h, "") for h in HEADER] for p in fresh]}).execute()
    log.info("proposals: %d written to the words book", len(fresh))
    return len(fresh)


def _col(i: int) -> str:
    s, i = "", i + 1
    while i:
        i, r = divmod(i - 1, 26)
        s = chr(65 + r) + s
    return s


def decide(sheets, pid: str, action: str, who: str, category: str = "") -> dict:
    ensure_tab(sheets)
    head, rows = read_tab(sheets, TAB)
    idx = {r.get("id"): i for i, r in enumerate(rows)}
    if pid not in idx:
        return {"status": 404, "message": "no such proposal"}
    row = rows[idx[pid]]
    if row.get("status") in ("approved", "rejected"):
        return {"status": 200, "message": f"already {row['status']}", "proposal": row}
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    if action == "approve":
        cat = (category or row.get("category") or "other").strip()
        kinds = known_kinds(sheets)
        kind = row["kind"]
        add_n = [n.strip() for n in (row.get("needles") or "").split(",") if n.strip()]
        add_h = [h.strip() for h in (row.get("file_hints") or "").split(",") if h.strip()]
        if kind in kinds:
            khead, krows = read_tab(sheets, KINDS_TAB)
            for i, kr in enumerate(krows):
                if _snake(kr.get("kind", "")) == kind:
                    needles = [x.strip() for x in (kr.get("needles") or "").split(",") if x.strip()]
                    hints = [x.strip() for x in (kr.get("file_hints") or "").split(",") if x.strip()]
                    needles += [n for n in add_n if n not in needles]
                    hints += [h for h in add_h if h not in hints]
                    ni, hi = khead.index("needles"), khead.index("file_hints")
                    sheets.spreadsheets().values().batchUpdate(
                        spreadsheetId=BOOK_ID,
                        body={"valueInputOption": "RAW", "data": [
                            {"range": f"'{KINDS_TAB}'!{_col(ni)}{i + 2}", "values": [[", ".join(needles)]]},
                            {"range": f"'{KINDS_TAB}'!{_col(hi)}{i + 2}", "values": [[", ".join(hints)]]}]}).execute()
                    break
        else:
            sheets.spreadsheets().values().append(
                spreadsheetId=BOOK_ID, range=f"'{KINDS_TAB}'!A1:G1", valueInputOption="RAW",
                insertDataOption="INSERT_ROWS",
                body={"values": [[kind, cat, ", ".join(add_n), ", ".join(add_h), "", "yes",
                                  f"approved from {row.get('evidence_n')} reading(s) by {who} on {now[:10]} ({pid})"]]}).execute()
        row["category"] = cat
    row["status"] = "approved" if action == "approve" else "rejected"
    row["decided_at"], row["decided_by"] = now, who
    r = idx[pid] + 2
    sheets.spreadsheets().values().update(
        spreadsheetId=BOOK_ID, range=f"'{TAB}'!A{r}:R{r}", valueInputOption="RAW",
        body={"values": [[row.get(h, "") for h in HEADER]]}).execute()
    log.info("proposals: %s %s by %s", pid, row["status"], who)
    return {"status": 200, "proposal": row}


LEDGERS = {
    "client_files": ("1o7opeC1GR3J5Oj7iGEgYo0EKLPmkW_paGBtE8uMx3LY", "title"),
    "form_files": ("19OvLdtyF0iENHcesFFm_6DyGjnqTfrjStAQJjiyh6Ww", "file_name"),
}


def rows_from_mirror(dsn: str, ledger: str) -> list[dict]:
    """The ledger's rows from asa-hub-db's copy (asked of asa-hub-app), each with its id, title, text, kind and
    folder."""
    import hub_rows  # noqa: PLC0415
    sid, name_col = LEDGERS[ledger]
    got = hub_rows.rows(sid, ledger, fields=["id", name_col, "digest_text", "doc_kind", "folder"])
    c = hub_rows.cell
    return [{"id": c(d.get("id")), "title": c(d.get(name_col)), "text": c(d.get("digest_text")),
             "kind": c(d.get("doc_kind")), "folder": c(d.get("folder"))} for d in got if c(d.get("id")) or ""]


def scan(sheets, dsn: str) -> dict[str, Any]:
    kinds = known_kinds(sheets)
    drawers = drawer_categories(sheets)
    banned = house_names(sheets)
    have = existing(sheets)
    decided = {r["kind"] for r in have.values() if r.get("status") in ("approved", "rejected")}
    total, written = 0, 0
    for ledger in LEDGERS:
        rows = rows_from_mirror(dsn, ledger)
        props = build(rows, kinds, drawers, decided, ledger, banned)
        total += len(props)
        written += write(sheets, props)
    return {"proposed": total, "written": written, "kinds_known": len(kinds)}


if __name__ == "__main__":
    import sys
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    logging.basicConfig(level=logging.INFO)
    import form_digest as fd
    _, sheets = fd._clients()
    if "--dry" in sys.argv:
        kinds = known_kinds(sheets); drawers = drawer_categories(sheets); banned = house_names(sheets)
        for ledger in LEDGERS:
            rows = rows_from_mirror(os.environ["HUB_PG_DSN"], ledger)
            for p in build(rows, kinds, drawers, set(), ledger, banned):
                print(f"[{p['type']:<6}] {p['kind']:<26} {p['category']:<14} n={p['evidence_n']:<4} cov={p['coverage']} leak={p['leak']}")
                print(f"         needles: {p['needles']}")
                print(f"         hints: {p['file_hints']}  · e.g. {p['examples'][:80]}")
    else:
        print(json.dumps(scan(sheets, os.environ["HUB_PG_DSN"])))
