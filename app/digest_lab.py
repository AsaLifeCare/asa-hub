"""The Decoder lab (server/digest_proposals.py and the relay's /digest routes) read off asa-hub-db: the proposals the
readings taught, the words book's kinds and categories, and the shelf of everything already filed. Its Try (a Drive
file read and OCR'd) stays the relay's."""
from __future__ import annotations

import json
import re
from collections import Counter, defaultdict
from datetime import datetime, timezone
from typing import Any, Callable

import gsjs
import house_tables as HT
import hubdb
import locations as L
import scope as sc
from scope import Defer

APP_ID = "digestlab"
# the words book (HUB_GENERIC_CONFIG_ID) and its tabs
BOOK_DEFAULT = "1Ky7FPu876WavnMTzsO6zejDXtI1I4b2xebuMdsBMMgg"
TAB = "Digest Proposals"
KINDS_TAB = "Digest Kinds"
DRAWERS_TAB = "Digest Drawers"
ISSUERS_TAB = "Digest Issuers"
CATEGORIES_TAB = "Digest Categories"
HEADER = ["id", "created_at", "status", "type", "kind", "category", "needles",
          "file_hints", "family", "evidence_n", "coverage", "leak", "examples",
          "example_ids", "ledger", "decided_at", "decided_by", "notes"]
# the ledgers the readings land in: (sheet, the column naming the file, the column naming the Drive file)
LEDGERS = {
    "client_files": ("1o7opeC1GR3J5Oj7iGEgYo0EKLPmkW_paGBtE8uMx3LY", "title", "drive_id"),
    "form_files": ("19OvLdtyF0iENHcesFFm_6DyGjnqTfrjStAQJjiyh6Ww", "file_name", "file_id"),
}
# the ledgers kept in their own table (sheet_resources.SPECS), by ledger: read and written there alone
TABLED = {"form_files": "formFiles", "client_files": "clientFiles"}
LAB_ROLES = ("admin", "administrator", "director", "manager")
REFUSED = {"status": 403, "message": "the decoder lab is for admins and managers"}

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


# ---- the readings' own arithmetic (digest_proposals.py, unchanged) ----------------------------------------------

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


def snake(s: str) -> str:
    return re.sub(r"_+", "_", re.sub(r"[^a-z0-9]+", "_", (s or "").lower())).strip("_")


def _tight(toks: list[str]) -> str:
    return re.sub(r"[^a-z0-9]", "", "".join(toks))


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


def now_stamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def build(rows: list[dict], kinds: dict[str, dict], drawers: list[tuple[str, str]],
          decided: set[str], ledger: str, banned: list[str] | None = None) -> list[dict]:
    banned = banned or []
    drawer_words = {snake(d) for d, _ in drawers} | {"med_documents", "documents", "funds", "misc"}
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
        name = snake(fam)
        if not name or name in decided:
            continue
        # a word that names a folder does not name a document
        if name in drawer_words or snake(toks[0] if toks else "") in drawer_words:
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
            "created_at": now_stamp(),
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
    kind = snake(kind)
    known = kinds.get(kind, {"needles": [], "file_hints": [], "category": ""})
    phrases = [p for p in phrases if p not in known["needles"]]
    if not phrases:
        return None
    return {
        "id": f"T_{ledger[:1]}_{row['id']}",
        "created_at": now_stamp(),
        "status": "proposed", "type": "extend" if kind in kinds else "new",
        "kind": kind, "category": known.get("category") or "other",
        "needles": ", ".join(phrases),
        "file_hints": ", ".join(t for t in _title_tokens(row.get("title") or "") if len(t) >= 7),
        "family": family_of(row.get("title") or ""), "evidence_n": "1", "coverage": "1.0",
        "leak": str(round(max((corpus[p] / n_all for p in phrases), default=0.0), 3)),
        "examples": str(row.get("title") or "")[:60], "example_ids": row["id"], "ledger": ledger,
        "decided_at": "", "decided_by": "", "notes": "taught by hand",
    }


# ---- the words book and the ledgers, off the copy -----------------------------------------------------------------

def book_id(reads: L.Reads) -> str:
    return reads.db.prop("HUB_GENERIC_CONFIG_ID") or BOOK_DEFAULT


def tab_ref(reads: L.Reads, sid: str, tab: str) -> hubdb.TabRef:
    ref = HT.book_tab(reads, sid, tab)
    if ref is None:
        raise Defer(f"the copy holds no {tab} tab")
    return ref


def _text(v: Any) -> str:
    return gsjs.trim(gsjs.or_blank(hubdb.typed(v, "raw")))


def read_tab(reads: L.Reads, tab: str) -> tuple[list[str], list[dict]]:
    """read_tab: the tab's headers normalised and every row that holds anything, as the cells' text."""
    def read() -> tuple[list[str], list[dict]]:
        ref = tab_ref(reads, book_id(reads), tab)
        head = [re.sub(r"[^a-z0-9]+", "_", str(h).strip().lower()) for h in ref.headers]
        rows = []
        for _rn, raw in reads.db.rows(ref):
            row = {head[i]: _text(raw.get(h)) for i, h in enumerate(ref.headers) if head[i]}
            if any(row.values()):
                rows.append(row)
        return head, rows
    head, rows = reads.once("digest:" + tab, read)
    return list(head), [dict(r) for r in rows]


def known_kinds(reads: L.Reads) -> dict[str, dict]:
    out = {}
    for r in read_tab(reads, KINDS_TAB)[1]:
        k = snake(r.get("kind", ""))
        if not k:
            continue
        out[k] = {"category": r.get("category", ""),
                  "needles": [n.strip() for n in (r.get("needles") or "").split(",") if n.strip()],
                  "file_hints": [h.strip() for h in (r.get("file_hints") or "").split(",") if h.strip()]}
    return out


def house_names(reads: L.Reads) -> list[str]:
    """A phrase carrying one of these names a sender, not a kind."""
    out = []
    for r in read_tab(reads, ISSUERS_TAB)[1]:
        n = (r.get("name") or "").strip().lower()
        if n and (r.get("is_organisation") or "").lower() in ("yes", "true", "1", "org", "organisation", "organization"):
            out.append(n)
    return out + ["asa lifecare", "a brighter dawn", "brighter dawn", "asa hub"]


def drawer_categories(reads: L.Reads) -> list[tuple[str, str]]:
    rows = read_tab(reads, DRAWERS_TAB)[1]
    out = [((r.get("drawer_prefix") or "").lower(), r.get("category") or "") for r in rows
           if (r.get("drawer_prefix") or "").strip() and (r.get("active") or "yes").lower() not in ("no", "off", "false")]
    return sorted(out, key=lambda x: -len(x[0]))


def existing(reads: L.Reads) -> dict[str, dict]:
    return {r.get("id", ""): r for r in read_tab(reads, TAB)[1] if r.get("id")}


def ledger_raw(reads: L.Reads, ledger: str) -> list[tuple[int, dict]]:
    """A ledger's rows in order: Forms' own table for the form files (TABLED), the copy for the others."""
    if ledger in TABLED:
        import resource_rows as RR  # noqa: PLC0415

        return reads.once("digest_ledger:" + ledger, lambda: list(enumerate(
            (cells for _key, cells in RR.table_rows(reads, TABLED[ledger])), start=2)))
    sid, _name, _fid = LEDGERS[ledger]
    return reads.once("digest_ledger:" + ledger, lambda: reads.db.rows(tab_ref(reads, sid, ledger)))


def ledger_rows(reads: L.Reads, ledger: str) -> list[dict]:
    """rows_from_mirror: each row with an id — its title, its text, its kind and its folder."""
    _sid, name_col, _fid = LEDGERS[ledger]
    out = []
    for _rn, raw in ledger_raw(reads, ledger):
        rid = _text(raw.get("id"))
        if rid:
            out.append({"id": rid, "title": _text(raw.get(name_col)), "text": _text(raw.get("digest_text")),
                        "kind": _text(raw.get("doc_kind")), "folder": _text(raw.get("folder"))})
    return out


def lab_open(sess: L.Session) -> bool:
    """_lab_open: the role badge, else the lab's App Control rule."""
    user = sess.user or {}
    if user.get("is_service") is True:
        return True
    if gsjs.js_str(user.get("role")).lower() in LAB_ROLES:
        return True
    return bool(sc.profile_app_gate(APP_ID, user, sess.reads.scope_sources()).get("open"))


def who(sess: L.Session) -> str:
    return gsjs.str_((sess.user or {}).get("id")) or "lab"


def listing(reads: L.Reads, scan: dict | None, extra: list[dict] | None = None) -> dict[str, Any]:
    """The proposals list: proposed, then approved, then rejected; the kinds and the categories."""
    have = existing(reads)
    for p in extra or []:
        have.setdefault(p["id"], p)
    kinds = known_kinds(reads)
    cats = read_tab(reads, CATEGORIES_TAB)[1]
    rows = list(have.values())
    order = {"proposed": 0, "approved": 1, "rejected": 2}
    rows.sort(key=lambda r: (order.get(r.get("status", ""), 9), r.get("created_at", "")), reverse=False)
    rows.sort(key=lambda r: order.get(r.get("status", ""), 9))
    return {"status": 200, "proposals": rows[:200], "kinds": sorted(kinds.keys()),
            "categories": [c.get("category") for c in cats if c.get("category")], "scan": scan}


# ---- the reads ----------------------------------------------------------------------------------------------------

def digest_proposals(sess: L.Session, payload: dict) -> dict[str, Any]:
    """GET /digest/proposals: what the readings taught."""
    if not lab_open(sess):
        return dict(REFUSED)
    return listing(sess.reads, None)


def digest_shelf(sess: L.Session, payload: dict) -> dict[str, Any]:
    """GET /digest/shelf: everything this platform has already filed, as folders."""
    if not lab_open(sess):
        return dict(REFUSED)
    p = payload if isinstance(payload, dict) else {}
    folder = gsjs.trim(gsjs.or_blank(p.get("folder")))
    q = gsjs.trim(gsjs.or_blank(p.get("q"))).lower()
    try:
        limit = max(1, min(int(p.get("limit") or 200), 500))
    except (TypeError, ValueError):
        raise Defer("a limit that is not a number") from None
    folders: dict[str, int] = {}
    special = {"· read by the decoder": 0, "· it could not read": 0, "· still owes something": 0}
    files: list[dict[str, Any]] = []
    for tab, (_sid, name_col, id_col) in LEDGERS.items():
        for _rn, raw in reversed(ledger_raw(sess.reads, tab)):
            name = _text(raw.get(name_col))
            if not name:
                continue
            state = _text(raw.get("digest_state"))
            meta: Any = _text(raw.get("digest_json"))
            try:
                meta = json.loads(meta or "{}")
            except ValueError:
                meta = {}
            missing = (meta or {}).get("missing") if isinstance(meta, dict) else None
            missing = missing or []
            fold = _text(raw.get("folder")) or ("Form uploads" if tab == "form_files" else "(no folder)")
            folders[fold] = folders.get(fold, 0) + 1
            if state == "done":
                special["· read by the decoder"] += 1
            if state in ("empty", "unsupported", "stalled"):
                special["· it could not read"] += 1
            if missing:
                special["· still owes something"] += 1
            if folder:
                keep = (fold == folder
                        or (folder == "· read by the decoder" and state == "done")
                        or (folder == "· it could not read" and state in ("empty", "unsupported", "stalled"))
                        or (folder == "· still owes something" and missing))
                if not keep:
                    continue
            elif not q:
                continue
            if q and q not in name.lower() and q not in _text(raw.get("person")).lower():
                continue
            if len(files) < limit:
                files.append({"id": _text(raw.get("id")), "name": name, "folder": fold, "ledger": tab,
                              "file_id": _text(raw.get(id_col)), "doc_kind": _text(raw.get("doc_kind")),
                              "person": _text(raw.get("person")), "state": state,
                              "confidence": _text(raw.get("confidence")), "missing": missing,
                              "decoder": str((meta or {}).get("v") or "") if isinstance(meta, dict) else ""})
    shelf = [{"name": k, "count": v} for k, v in sorted(folders.items(), key=lambda kv: (-kv[1], kv[0]))]
    return {"status": 200, "folders": shelf, "special": [{"name": k, "count": v} for k, v in special.items()],
            "files": files, "total": sum(folders.values())}


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {
    "digestProposals": digest_proposals, "digestShelf": digest_shelf,
}
# the lab's own door decides (_lab_open)
POLICY: dict[str, dict[str, Any]] = {a: {} for a in ACTIONS}
