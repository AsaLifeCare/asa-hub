"""The universal file digester — every uploaded form file becomes text + structure.
THE REQUIREMENT: one extensive, well-made engine able to digest ANY kind of file."""
from __future__ import annotations

import base64
import hashlib
import io
import concurrent.futures as cf
import json
import logging
import os
import re
import threading
import tempfile
import time
import urllib.error
import urllib.request
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Optional

import hub_db
import hub_rows

log = logging.getLogger("hub.formdigest")

PG_DSN = os.getenv("HUB_PG_DSN") or os.getenv("PG_DSN") or ""
SA_BLOB = os.getenv("GOOGLE_SERVICE_ACCOUNT_JSON", "/app/service-account.json")
IMPERSONATE = os.getenv("GOOGLE_IMPERSONATE_USER", "jarvis@asalifecare.com")
# drive is READ-WRITE on purpose: the decoder IS the tracker — the tracking belongs to the decoder, because that is…
SCOPES = ["https://www.googleapis.com/auth/drive",
          "https://www.googleapis.com/auth/spreadsheets"]
ESSENCIAL_ID = "1Y6UMJlCS5gHur52f0YrPsLSqwYlCA792I8gAiZsxsug"
HOUSE_PTR = "switchboard:props.HUB_HOUSE_FORM_FILES_ID"

# THE LEDGERS THIS LANE DRAINS — the reads in the factory have to be fast.
LEDGERS = [
    {"res": "formFiles", "tab": "form_files",
     "ptr": "switchboard:props.HUB_HOUSE_FORM_FILES_ID",
     "file_id": "file_id", "name": "file_name", "mime": "mime_type",
     "route": True},
    {"res": "clientFiles", "tab": "client_files",
     "ptr": "switchboard:props.HUB_HOUSE_CLIENT_FILES_ID",
     "file_id": "drive_id", "name": "title", "mime": "mime_type",
     "route": False,
     # the row already knows whose file it is — an anchor the platform wrote itself outranks anything a title says
     "anchor_key": "client_key", "anchor_name": "client_name",
     "anchor_kind": "client"},
]
# A FACTORY PACE, SLOWED TO WHAT THE QUOTA CAN CARRY.
PASS_EVERY_S = float(os.getenv("HUB_FORM_DIGEST_EVERY_S", "60"))
ITEMS_PER_PASS = int(os.getenv("HUB_FORM_DIGEST_ITEMS", "12"))
PER_REQUEST_DELAY_S = float(os.getenv("HUB_FORM_DIGEST_DELAY_S", "0.2"))
# HOW MANY FILES THIS LANE READS AT ONCE — ONE, AND MEASURED.
LANE_WIDTH = max(1, min(int(os.getenv("HUB_FORM_DIGEST_WIDTH", "1")), 8))
# The better eye costs seconds; a dial so it can be turned off from outside.
SHARP_ON = os.getenv("HUB_SHARP_READ", "on").strip().lower() not in ("off", "0", "no")
TEXT_CAP = 20_000          # inline sheet cell cap; true length in digest_text_chars
MAX_ATTEMPTS = 5           # then the verdict is 'error' for good (still visible)

ANALYZE_URL = os.getenv("HUB_ANALYZE_URL", "")
ANALYZE_MODEL = os.getenv("HUB_ANALYZE_MODEL", "ai-all")
ANALYZE_KEYS = [k for k in (os.getenv("LLM_API_KEY", ""), os.getenv("OPENAI_API_KEY", "")) if k]

# THE COLUMNS THIS LANE MAY WRITE.
try:
    from engine_verdict import verdict as engine_verdict   # noqa: PLC0415
except Exception:                                          # noqa: BLE001
    def engine_verdict(_n, _t, _r=None, _v=None):          # type: ignore[misc]
        return None

DIGEST_COLS = ["digest_state", "digest_kind", "digest_category", "digest_dates",
               "digest_names", "digest_text_chars", "digest_text", "digest_json",
               "digest_error", "digested_at",
               "doc_kind", "person", "person_id", "subject_type", "subject",
               "person_seen", "person_agree", "mentions",
               "issued_on", "expires_on", "confidence"]

# ── extraction core — copied VERBATIM from the old platform app/analytics/doc_ocr.py; do not "improve" here without…


def extract_text_pdf(path: str, text_only: bool = False) -> str:
    """PDF text via PyMuPDF; OCR (Tesseract) pages with no embedded text."""
    try:
        import pdf_gate
    except Exception as e:  # noqa: BLE001
        log.warning("pdf gate unavailable (%s) — refusing to parse %s unguarded", e, path)
        return ""
    parts = []
    try:
        with pdf_gate.pdf_document(path) as doc:
            for page in doc:
                t = page.get_text("text") or ""
                if not text_only and _page_words(t) < 25:  # scanned, or only the scanner spoke → OCR
                    try:
                        import pytesseract
                        from PIL import Image
                        pix = page.get_pixmap(dpi=180)
                        img = Image.open(io.BytesIO(pix.tobytes("png")))
                        t = pytesseract.image_to_string(img) or t
                    except Exception as e:  # noqa: BLE001
                        log.debug("tesseract failed %s: %s", path, e)
                parts.append(t)
    except pdf_gate.PdfBusy as e:
        # The door never opened.
        log.warning("pdf gate busy for %s: %s", path, e)
        return ""
    except Exception as e:  # noqa: BLE001
        log.debug("open failed %s: %s", path, e)
        return ""
    return "\n".join(parts)


def extract_text_docx(path: str) -> str:
    """DOCX text (paragraphs + tables) via python-docx."""
    try:
        import docx  # python-docx — lazy
    except Exception as e:  # noqa: BLE001
        log.warning("python-docx unavailable (%s) — cannot parse %s", e, path)
        return ""
    try:
        d = docx.Document(path)
    except Exception as e:  # noqa: BLE001
        log.debug("docx open failed %s: %s", path, e)
        return ""
    parts = [p.text for p in d.paragraphs if p.text and p.text.strip()]
    for table in getattr(d, "tables", []):
        for row in table.rows:
            cells = [c.text.strip() for c in row.cells if c.text and c.text.strip()]
            if cells:
                parts.append(" | ".join(cells))
    return "\n".join(parts)


def extract_text_xlsx(path: str) -> str:
    """XLSX text (all sheets, row-major) via openpyxl."""
    try:
        import openpyxl  # lazy
    except Exception as e:  # noqa: BLE001
        log.warning("openpyxl unavailable (%s) — cannot parse %s", e, path)
        return ""
    try:
        wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    except Exception as e:  # noqa: BLE001
        log.debug("xlsx open failed %s: %s", path, e)
        return ""
    parts = []
    for ws in wb.worksheets:
        parts.append(f"# Sheet: {ws.title}")
        for row in ws.iter_rows(values_only=True):
            vals = [str(v).strip() for v in row if v is not None and str(v).strip()]
            if vals:
                parts.append(" | ".join(vals))
    return "\n".join(parts)


def extract_text_image(path: str, text_only: bool = False) -> str:
    """Standalone image → text via Tesseract OCR."""
    if text_only:
        return ""
    _heic_ready()          # teaches PIL the iPhone's format, once
    try:
        import pytesseract
        from PIL import Image, ImageOps
    except Exception as e:  # noqa: BLE001
        log.warning("pytesseract/PIL unavailable (%s) — cannot OCR image %s", e, path)
        return ""
    try:
        with Image.open(path) as im:
            im = ImageOps.exif_transpose(im)
            if im.mode not in ("L", "RGB"):
                im = im.convert("RGB")
            return pytesseract.image_to_string(im) or ""
    except Exception as e:  # noqa: BLE001
        log.debug("image OCR failed %s: %s", path, e)
        return ""


_MAX_TEXT_BYTES = 25_000_000


def _read_text_capped(path: str) -> str:
    try:
        with open(path, "rb") as fh:
            return fh.read(_MAX_TEXT_BYTES).decode("utf-8", errors="ignore")
    except Exception:  # noqa: BLE001
        return ""


def _sniff_kind(path: str) -> str:
    """File-type by MAGIC BYTES for missing/wrong extensions."""
    try:
        with open(path, "rb") as fh:
            head = fh.read(16)
    except Exception:  # noqa: BLE001
        return ""
    if not head:
        return ""
    if head[:4] == b"%PDF":
        return "pdf"
    if head[:2] == b"PK" and head[2:4] in (b"\x03\x04", b"\x05\x06", b"\x07\x08"):
        try:
            import zipfile
            with zipfile.ZipFile(path) as z:
                names = z.namelist()
            if any(n.startswith("word/") for n in names):
                return "docx"
            if any(n.startswith("xl/") for n in names):
                return "xlsx"
        except Exception:  # noqa: BLE001
            return ""
        return ""
    # A HEIC WITH NO EXTENSION IS STILL A HEIC.
    if head[4:8] == b"ftyp" and head[8:12] in (b"heic", b"heix", b"hevc",
                                               b"heim", b"heis", b"mif1",
                                               b"msf1", b"hevx"):
        return "image" if _heic_ready() else "unsupported"
    if head[:8] == b"\x89PNG\r\n\x1a\n" or head[:3] == b"\xff\xd8\xff" \
            or head[:2] == b"BM" or head[:4] in (b"II*\x00", b"MM\x00*") \
            or head[:4] == b"GIF8" or head[:4] == b"RIFF":
        return "image"
    if all(b in (9, 10, 13) or 32 <= b < 127 for b in head):
        return "text"
    return ""


# WHETHER THIS CONTAINER CAN OPEN A HEIC, asked once.
def _heic_ready() -> bool:
    global _HEIC
    if _HEIC is None:
        try:
            import pillow_heif  # noqa: PLC0415
            pillow_heif.register_heif_opener()
            _HEIC = True
            log.info("HEIC: pillow-heif registered — iPhone photographs are readable")
        except Exception:  # noqa: BLE001
            _HEIC = False
    return _HEIC


_HEIC: bool | None = None

UNSUPPORTED_EXTS = {".doc", ".ppt", ".pptx"}
HEIC_EXTS = {".heic", ".heif"}
HEIC_MAGIC = (b"heic", b"heix", b"hevc", b"heim", b"heis", b"mif1", b"msf1", b"hevx")


def _heic_shaped(name: str = "", mime: str = "", path: str = "") -> bool:
    """Is this an iPhone photograph — by any of the three things we know?"""
    if Path(name or "").suffix.lower() in HEIC_EXTS:
        return True
    mime = (mime or "").strip().lower()
    if "heif" in mime or "heic" in mime:
        return True
    if path:
        try:
            with open(path, "rb") as fh:
                head = fh.read(16)
            return head[4:8] == b"ftyp" and head[8:12] in HEIC_MAGIC
        except Exception:  # noqa: BLE001
            return False
    return False


# THE REFUSAL NAMES WHAT IT IS WAITING FOR.
HEIC_OWED = "heic: this image has no HEIC decoder yet"


def _unsupported_why(name: str, mime: str, path: str) -> str:
    if _heic_shaped(name, mime, path) and not _heic_ready():
        return HEIC_OWED
    return f"{Path(name).suffix or 'this type'} is not digestible yet"


def _led_for(tab: str) -> dict:
    """The ledger that owns a tab — the column names live there, not here."""
    for L in LEDGERS:
        if L["tab"] == tab:
            return L
    return LEDGERS[0]


# THE SCANNER'S WATERMARK IS NOT THE PAGE.
SCANNER_NOISE = re.compile(
    r"camscanner|https?://\S+|device_id=\S+|\bsid=\S+|\bpid=\S+|\d{1,2}/\d{1,2}/\d{2,4},?\s*\d{1,2}:\d{2}\s*(?:am|pm)?",
    re.I)


def _page_words(t: str) -> int:
    """How much of a page's text is the paper's own, not the scanner's."""
    return len(SCANNER_NOISE.sub(" ", t or "").strip())


def _scanner_only(text: str) -> bool:
    """A reading that is nothing but the scanner's watermark."""
    t = (text or "").strip()
    return bool(t) and "camscanner" in t.lower() and _page_words(t) < 40


def _scan_owed(row: dict) -> bool:
    """A row filed with the scanner's watermark as its whole reading is owed a real one — once, by a lane that…"""
    if row.get("digest_state") not in ("done", "empty"):
        return False
    if not _scanner_only(str(row.get("digest_text") or "")):
        return False
    meta = row.get("digest_json") or ""
    if isinstance(meta, str):
        try:
            meta = json.loads(meta or "{}")
        except Exception:  # noqa: BLE001
            meta = {}
    return not (isinstance(meta, dict) and meta.get("scan_ocr"))


def _heic_owed(row: dict, led: dict) -> bool:
    """Is this row waiting on a HEIC decoder?"""
    if row.get("digest_state") not in ("unsupported", "empty"):
        return False
    if not _heic_shaped(str(row.get(led["name"]) or ""),
                        str(row.get(led["mime"]) or "")):
        return False
    meta = row.get("digest_json") or ""
    if isinstance(meta, str):
        try:
            meta = json.loads(meta or "{}")
        except Exception:  # noqa: BLE001
            meta = {}
    return not (isinstance(meta, dict) and meta.get("heic_decoder"))


def _stamp_scan(verdict: dict, row: dict) -> dict:
    """A row re-read past the scanner's watermark says so, and stops asking."""
    if not _scanner_only(str(row.get("digest_text") or "")):
        return verdict
    try:
        meta = json.loads(verdict.get("digest_json") or "{}")
    except Exception:  # noqa: BLE001
        meta = {}
    if not isinstance(meta, dict):
        meta = {}
    meta["scan_ocr"] = True
    return dict(verdict, digest_json=json.dumps(meta))


def _reopens(row: dict, led: dict) -> bool:
    """A row refused for a missing part reopens once the part is here."""
    return _heic_ready() and _heic_owed(row, led)

_CENSUS: dict[str, Any] = {}


def _heic_census(tab: str, n: int) -> None:
    """THE COUNT IS THE ARGUMENT."""
    was = _CENSUS.get(tab)
    if was and was[0] == n and time.monotonic() - was[1] < 600:
        return
    _CENSUS[tab] = (n, time.monotonic())
    if not n:
        return
    if _heic_ready():
        log.info("%s: %d HEIC rows were refused before the decoder arrived — reopening",
                 tab, n)
    else:
        log.warning("%s: %d iPhone photographs refused for want of pillow-heif in this "
                    "image — one pip line and a rebuild reads them", tab, n)


def digest_kind(path: str) -> str:
    """The honest kind verdict: pdf|docx|xlsx|image|text|csv|unsupported|unknown."""
    ext = Path(path).suffix.lower()
    if ext in UNSUPPORTED_EXTS:
        return "unsupported"
    if ext in HEIC_EXTS:
        return "image" if _heic_ready() else "unsupported"
    if ext == ".pdf":
        return "pdf"
    if ext == ".docx":
        return "docx"
    if ext in (".xlsx", ".xlsm"):
        return "xlsx"
    if ext in (".png", ".jpg", ".jpeg", ".tiff", ".tif", ".bmp", ".webp", ".gif"):
        return "image"
    if ext == ".csv":
        return "csv"
    if ext in (".txt", ".md"):
        return "text"
    return _sniff_kind(path) or "unknown"


def extract_text(path: str) -> str:
    """Dispatch by the honest kind. '' on unknown/failed — never raises."""
    kind = digest_kind(path)
    if kind == "pdf":
        return extract_text_pdf(path)
    if kind == "docx":
        return extract_text_docx(path)
    if kind == "xlsx":
        return extract_text_xlsx(path)
    if kind == "image":
        return extract_text_image(path)
    if kind in ("text", "csv"):
        return _read_text_capped(path)
    return ""


# ── structure: category, dates, names ────────────────────────────────────

# first-hit-wins, the client_docintel._category shape with the Hub's own categories — deterministic and free; the…
CATEGORY_LEXICON = [
    ("medical", ["mars", "medication", "med document", "prescription", "pharmacy",
                 "mar ", "controlled drug", "physician", "diagnosis", "immunization"]),
    ("receipt_invoice", ["receipt", "invoice", "purchase", "order total", "subtotal",
                         "amount due", "payment", "billed"]),
    ("identity", ["social security", "ssn", "passport", "driver's license",
                  "drivers license", "state id", "birth certificate", "medicaid"]),
    ("certification_training", ["certificate", "certification", "training",
                                "cpr", "first aid", "completion", "course"]),
    ("incident", ["incident", "mui", "unusual incident", "injury report"]),
    ("legal", ["agreement", "contract", "consent", "authorization", "waiver",
               "policy", "court"]),
    ("timesheet", ["timesheet", "time sheet", "clock in", "hours worked",
                   "pay period"]),
]


def categorize(filename: str, text: str) -> tuple[str, str]:
    """(category, source) — lexicon first over filename+text head."""
    hay = (filename + " " + text[:4000]).lower()
    for cat, needles in CATEGORY_LEXICON:
        for n in needles:
            if n in hay:
                return cat, "lexicon"
    got = _llm_category(filename, text)
    if got:
        return got, "model"
    return "other", "none"


_LLM_CATS = [c for c, _ in CATEGORY_LEXICON] + ["other"]


def _llm_category(filename: str, text: str) -> str:
    """The Finance receipt doctrine: the model is asked ONLY when the lexicon saw nothing, reads TEXT it is…"""
    if not ANALYZE_URL or not ANALYZE_KEYS or not text.strip():
        return ""
    body = {
        "model": ANALYZE_MODEL, "temperature": 0,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content":
                "Classify the document. Answer JSON {\"category\": <one of " +
                ", ".join(_LLM_CATS) + ">}. If unsure, use \"other\"."},
            {"role": "user", "content": (filename + "\n\n" + text[:6000])},
        ],
    }
    import urllib.request
    # strict then bare — some fanned-out providers 400 on response_format
    for payload in (body, {k: v for k, v in body.items() if k != "response_format"}):
        for key in ANALYZE_KEYS:
            try:
                req = urllib.request.Request(ANALYZE_URL, method="POST",
                                             data=json.dumps(payload).encode())
                req.add_header("Content-Type", "application/json")
                req.add_header("Authorization", f"Bearer {key}")
                with urllib.request.urlopen(req, timeout=45) as r:
                    out = json.load(r)
                content = ((out.get("choices") or [{}])[0].get("message") or {}).get("content") or ""
                cat = str(json.loads(content).get("category") or "").strip().lower()
                return cat if cat in _LLM_CATS else ""
            except Exception:  # noqa: BLE001 — next key / bare shape
                continue
    return ""


_MONTHS = {m.lower(): i for i, m in enumerate(
    ["January", "February", "March", "April", "May", "June", "July",
     "August", "September", "October", "November", "December"], start=1)}
for _m in list(_MONTHS):
    _MONTHS[_m[:3]] = _MONTHS[_m]


def _safe_date(y: int, mo: int, d: int) -> Optional[date]:
    try:
        if 1 <= mo <= 12 and 1 <= d <= 31:
            return date(y, mo, min(d, 28) if mo == 2 else d)
    except Exception:  # noqa: BLE001
        return None
    return None


def _dates_in(s: str) -> list[date]:
    """Filename-shape dates (the client_docintel parser) + ISO/US content dates."""
    out: list[date] = []
    m = re.search(r"(20\d{2})\s+([A-Za-z]+)", s)
    if m and m.group(2).lower() in _MONTHS:
        out.append(_safe_date(int(m.group(1)), _MONTHS[m.group(2).lower()], 1))
    m = re.search(r"([A-Za-z]+)\s+(20\d{2})", s)
    if m and m.group(1).lower() in _MONTHS:
        out.append(_safe_date(int(m.group(2)), _MONTHS[m.group(1).lower()], 1))
    for m in re.finditer(r"\b(\d{1,2})[_\-/.](\d{1,2})[_\-/.](20\d{2})\b", s):
        out.append(_safe_date(int(m.group(3)), int(m.group(1)), int(m.group(2))))
    for m in re.finditer(r"\b(\d{1,2})\.(\d{1,2})\.(\d{2})\b", s):
        out.append(_safe_date(2000 + int(m.group(3)), int(m.group(1)), int(m.group(2))))
    for m in re.finditer(r"\b(20\d{2})[-_](\d{1,2})[-_](\d{1,2})\b", s):
        out.append(_safe_date(int(m.group(1)), int(m.group(2)), int(m.group(3))))
    seen: set[str] = set()
    uniq: list[date] = []
    for d in out:
        if d and d.isoformat() not in seen:
            seen.add(d.isoformat())
            uniq.append(d)
    return uniq[:12]


def detect_dates(filename: str, text: str) -> list[str]:
    return [d.isoformat() for d in _dates_in(filename + "\n" + text[:8000])]


def _roster() -> set[str]:
    """Staff + client names, the never-guess wall: a name the platform does not know is…"""
    """(cont.) The roster's own people and clients (_roster_rows, asa-hub-db's copy): a copy that cannot answer raises
    hub_rows.Unreadable."""
    rows = _roster_rows()
    return {nm for nm in (str(r.get("name") or "").strip() for r in rows["people"] + rows["clients"])
            if len(nm.split()) >= 2}


PEOPLE_PTR = "switchboard:props.HUB_HOUSE_PEOPLE_ID"
CLIENTS_PTR = "switchboard:props.HUB_HOUSE_CLIENTS_ID"
# A HOUSE CALLS ITS TAB `Data`, not the resource's name — the resource name is what the ENGINE calls it, and asking…
HOUSE_TAB = "Data"


_ROSTER_MEMO: dict[str, Any] = {"at": 0.0, "rows": None}
ROSTER_MEMO_S = 300.0


def _roster_rows(_sheets=None) -> dict:
    """THE ROSTER AS THE ENGINE READS IT — `people` and `clients` rows, so digestWhoIs_ can answer with an ID…"""
    """(cont.) Read once every few minutes, not once per ledger per pass: a
    pass walks two ledgers and the roster does not change between them.
    Read off asa-hub-db's copy alone (hub_rows: the depot's pointers, then each house's Data tab), never Google and
    never the old platform's mirror: a copy that cannot answer raises hub_rows.Unreadable."""
    memo = _ROSTER_MEMO
    if memo["rows"] is not None and time.monotonic() - memo["at"] < ROSTER_MEMO_S:
        return memo["rows"]
    facts = hub_rows.rows(ESSENCIAL_ID, "Facts", where={"Source": [PEOPLE_PTR, CLIENTS_PTR]},
                          fields=["Source", "Value"])
    houses: dict[str, str] = {}
    for d in facts:  # sheet order: the last pointer row stands
        houses[str(hub_rows.cell(d.get("Source")) or "")] = str(hub_rows.cell(d.get("Value")) or "").strip()
    named = {"people": houses.get(PEOPLE_PTR, ""), "clients": houses.get(CLIENTS_PTR, "")}
    unnamed = [kind for kind, house in named.items() if not house]
    if unnamed:
        raise hub_rows.Unreadable("the depot's copy names no " + " or ".join(unnamed) + " house")
    people, clients = hub_rows.tabs([
        {"sheet_id": named["people"], "tab": HOUSE_TAB, "fields": ["id", "name"]},
        {"sheet_id": named["clients"], "tab": HOUSE_TAB, "fields": ["client_key", "id", "name"]}])
    for kind, got in (("people", people), ("clients", clients)):
        if not got.get("tab_known"):
            raise hub_rows.Unreadable(f"{kind}: asa-hub-db's copy holds no {HOUSE_TAB} tab in its house")

    def text(d: dict, key: str) -> str:
        return str(hub_rows.cell(d.get(key)) or "")
    out: dict[str, list] = {"people": [], "clients": []}
    for _rn, d in people["rows"]:
        if text(d, "id") and text(d, "name"):
            out["people"].append({"id": text(d, "id"), "name": text(d, "name")})
    for _rn, d in clients["rows"]:
        if text(d, "name"):
            out["clients"].append({"client_key": text(d, "client_key"), "id": text(d, "id"),
                                   "name": text(d, "name")})
    log.info("roster: %d people, %d clients (asa-hub-db)", len(out["people"]), len(out["clients"]))
    memo["rows"], memo["at"] = out, time.monotonic()
    return out


def detect_names(text: str, roster: set[str]) -> list[str]:
    if not roster or not text:
        return []
    hay = text[:30000].lower()
    hits = [nm for nm in roster if nm.lower() in hay]
    return sorted(hits)[:20]


# ── the keeper: state, queue, Drive, writeback ───────────────────────────


def _own():
    """The lane's own state and items: asa-hub-db once the relay's tables moved, else beside the mirror."""
    return hub_db.connect(PG_DSN)


def _state_ensure() -> None:
    with _own() as conn, conn.cursor() as cur:
        cur.execute(
            "create table if not exists hub_form_digest_state ("
            " id int primary key default 1,"
            " last_pass_at timestamptz,"
            " last_pass_items int not null default 0,"
            " last_pass_errors int not null default 0)")
        cur.execute("insert into hub_form_digest_state (id) values (1) on conflict do nothing")
        cur.execute(
            "create table if not exists hub_form_digest_items ("
            " row_id text primary key,"
            " state text not null default 'working',"
            " attempts int not null default 0,"
            " error text not null default '',"
            " updated_at timestamptz not null default now())")


def _house_id(ptr: str = HOUSE_PTR) -> str:
    """The depot pointer off asa-hub-db's copy (hub_rows), the last row standing; '' when the depot names none, and
    hub_rows.Unreadable when the copy cannot say. Env overrides for tests."""
    override = os.getenv("FORM_FILES_HOUSE_ID", "").strip()
    if override:
        return override
    got = hub_rows.rows(ESSENCIAL_ID, "Facts", where={"Source": ptr}, fields=["Source", "Value"])
    return str(hub_rows.cell(got[-1].get("Value")) or "").strip() if got else ""


# ── the keeper's cells reach the ledgers through asa-hub-app's record path (app/digest_lab_writes.py digestKeep),
# carried to the sheet by its queue; the hourly proposals scan is the app's own digestScan

APP_URL = (os.getenv("HUB_APP_URL") or "http://asa-hub-app:8080").rstrip("/")
DOOR_APP = "digestlab"
KEEP_TIMEOUT_S = float(os.getenv("HUB_FORM_DIGEST_KEEP_TIMEOUT_S", "60"))
KEEP_TRIES = 3
KEEP_ROWS = 200
# a stand-in for the door (the checks): (action, payload) -> the answer
APP_DOOR = None


class NotKept(RuntimeError):
    """asa-hub-app did not keep what the keeper asked: not reached, refused, deferred or busy."""


def _app_write(action: str, payload: dict[str, Any]) -> dict[str, Any]:
    """One of the Decoder lab's writes, asked of asa-hub-app as the service under a write id; a busy lock is asked
    again; anything but 200 raises NotKept."""
    env: Any = None
    for attempt in range(KEEP_TRIES):
        if APP_DOOR is not None:
            env = APP_DOOR(action, payload)
        else:
            token = hub_rows._token()
            if not token:
                raise NotKept("the keeper holds no token for asa-hub-app")
            write_id = "W" + hashlib.sha256(f"form-digest|{action}|{time.time_ns()}".encode()).hexdigest()[:24]
            req = urllib.request.Request(
                f"{APP_URL}/v1/{DOOR_APP}/{action}", method="POST",
                data=json.dumps({"payload": payload, "write_id": write_id}).encode("utf-8"),
                headers={"Content-Type": "application/json", "X-Hub-Token": token,
                         "X-Hub-User": json.dumps({"is_service": True})})
            try:
                with urllib.request.urlopen(req, timeout=KEEP_TIMEOUT_S) as res:
                    env = json.loads(res.read())
            except urllib.error.HTTPError as exc:
                raise NotKept(f"asa-hub-app answered {exc.code}") from exc
            except Exception as exc:  # noqa: BLE001 - not reached, said as not kept
                raise NotKept(f"asa-hub-app could not be asked ({type(exc).__name__})") from exc
        if not (isinstance(env, dict) and env.get("status") == 409) or attempt + 1 == KEEP_TRIES:
            break
        time.sleep(1.0 + attempt)
    if not isinstance(env, dict) or env.get("status") != 200:
        raise NotKept(f"asa-hub-app answered {env.get('status') if isinstance(env, dict) else '?'}"
                      f" ({str((env or {}).get('message') or '')[:160]})")
    return env


def _keep(tab: str, house: str, cells_of: dict[str, dict[str, Any]]) -> dict[str, Any]:
    """The keeper's cells on ledger rows by id, kept as the record: {kept, same, missing}; NotKept when refused."""
    items = [{"id": rid, "cells": {k: "" if v is None else str(v) for k, v in cells.items()}}
             for rid, cells in cells_of.items() if rid and cells]
    out: dict[str, Any] = {"kept": 0, "same": 0, "missing": []}
    for i in range(0, len(items), KEEP_ROWS):
        got = _app_write("digestKeep", {"ledger": tab, "house": house, "rows": items[i:i + KEEP_ROWS]}).get("data") or {}
        out["kept"] += int(got.get("kept") or 0)
        out["same"] += int(got.get("same") or 0)
        out["missing"] += [str(m) for m in got.get("missing") or []]
    return out


def _clients():
    """Drive + Sheets on the SA (content or path, DWD-first) — the hub_sheet_sync credential shape, never a raw…"""
    from google.oauth2 import service_account
    from googleapiclient.discovery import build
    raw = (SA_BLOB or "").strip()
    info = None
    if raw.startswith("{"):
        info = json.loads(raw)
    elif not raw.startswith("/") and len(raw) > 512:
        try:
            info = json.loads(base64.b64decode(raw))
        except Exception:  # noqa: BLE001
            info = None
    if info is not None:
        base = service_account.Credentials.from_service_account_info(info, scopes=SCOPES)
    else:
        base = service_account.Credentials.from_service_account_file(raw, scopes=SCOPES)
    creds = base
    try:
        probe = base.with_subject(IMPERSONATE)
        import google.auth.transport.requests as gtr
        probe.refresh(gtr.Request())
        creds = probe
    except Exception:  # noqa: BLE001 — plain SA sees what was shared with it
        pass
    drive = build("drive", "v3", credentials=creds, cache_discovery=False)
    sheets = build("sheets", "v4", credentials=creds, cache_discovery=False)
    return drive, sheets


_FLOOR_MEMO: dict[str, Any] = {"at": 0.0, "v": None}
_VOCAB_MEMO: dict[str, Any] = {"at": 0.0, "v": None}
VOCAB_TABS = ["Digest Kinds", "Digest Categories", "Digest Labels", "Digest Issuers", "Digest Drawers"]


def _copy_tab(sheet_id: str, tab: str) -> tuple[list[str], list[tuple[int, dict[str, str]]]]:
    """One tab of asa-hub-db's copy as every read lays it (hub_rows): its header, and each row (sheet row, {header:
    text}) in sheet order; hub_rows.Unreadable when the copy cannot say, or holds no such tab."""
    got = hub_rows.read(sheet_id, tab)
    if not got.get("tab_known"):
        raise hub_rows.Unreadable(f"asa-hub-db's copy holds no {tab} tab in {sheet_id}")
    rows = got["rows"]
    head = [str(h).strip() for h in got.get("headers") or []] or (list(rows[0][1]) if rows else [])
    return head, [(int(rn), {h: str(hub_rows.cell(d.get(h)) or "") for h in head}) for rn, d in rows]


def _vocab_rows(_sheets=None) -> dict:
    """THE WORDS BOOK, FOR THIS LANE'S ENGINE."""
    """(cont.) Off asa-hub-db's copy (a record book: hub_rows lays its kept edits); a copy that cannot answer raises
    hub_rows.Unreadable and nothing is kept."""
    memo = _VOCAB_MEMO
    if memo["v"] is not None and time.monotonic() - memo["at"] < 600:
        return memo["v"]
    out: dict[str, Any] = {}
    for tab in VOCAB_TABS:
        head_raw, lines = _copy_tab(BOOK_ID, tab)
        head = [re.sub(r"[^a-z0-9]+", "_", h.lower()) for h in head_raw]
        rows = []
        for _rn, line in lines:
            row = {head[i]: line.get(h, "").strip() for i, h in enumerate(head_raw) if head[i]}
            if any(row.values()):
                rows.append(row)
        out[tab] = rows
    out["__v"] = "book:" + time.strftime("%Y-%m-%dT%H:%M", time.gmtime())
    memo["v"], memo["at"] = out, time.monotonic()
    log.info("vocabulary: %d kinds from the words book", len(out.get("Digest Kinds") or []))
    return out
BOOK_ID = os.getenv("HUB_GENERIC_CONFIG_ID", "1Ky7FPu876WavnMTzsO6zejDXtI1I4b2xebuMdsBMMgg")


def _reread_floor(_sheets=None) -> str:
    """THE DIAL THE ENGINE ALREADY OBEYS, OBEYED ON THIS SIDE TOO."""
    """(cont.) Digest Settings off asa-hub-db's copy; a copy that cannot answer raises hub_rows.Unreadable."""
    memo = _FLOOR_MEMO
    if memo["v"] is not None and time.monotonic() - memo["at"] < 300:
        return memo["v"]
    out = ""
    head, lines = _copy_tab(BOOK_ID, "Digest Settings")
    if "key" in head and "value" in head:
        for _rn, line in lines:
            if line.get("key", "").strip() != "reread_before_version":
                continue
            on = line.get("active", "on").strip().lower() if "active" in head else "on"
            if on in ("", "on", "yes", "true"):
                out = line.get("value", "").strip()
    memo["v"], memo["at"] = out, time.monotonic()
    if out:
        log.info("re-read floor: anything stamped before %s", out)
    return out


def _stale(row: dict, floor: str) -> bool:
    """Was this row judged by a decoder older than the floor?"""
    if not floor or row.get("digest_state") != "done":
        return False
    meta = row.get("digest_json") or ""
    if isinstance(meta, str):
        try:
            meta = json.loads(meta or "{}")
        except Exception:  # noqa: BLE001
            return False
    return isinstance(meta, dict) and str(meta.get("v") or "") < floor


def _pending(house: str, limit: int, _sheets=None, tab: str = "form_files") -> list[dict]:
    """THE QUEUE IS READ FROM THE RECORD: asa-hub-db's copy of the ledger as every read lays it (hub_rows), the cells
    Python keeps laid on it; a copy that cannot answer raises hub_rows.Unreadable."""
    head, lines = _copy_tab(house, tab)
    done = _items_finished()
    out = []
    floor = _reread_floor()
    led_cols = _led_for(tab)
    heic_waiting, full_scan = 0, True
    stale: list[dict] = []
    reopen: list[dict] = []
    # THE ROW NUMBER RIDES ALONG.
    for n, row in lines:
        if not row.get("id"):
            continue
        if _heic_owed(row, led_cols):
            heic_waiting += 1
        if row.get("digest_state") == "pending":
            # THE LEDGER'S MEMORY APPLIES TO PENDING ONLY.
            if row["id"] in done:
                continue
            row["_row_number"] = n
            out.append(row)
            if len(out) >= limit:
                full_scan = False
                break
        elif len(reopen) < limit and (_reopens(row, led_cols) or _scan_owed(row)):
            row["_row_number"] = n
            row["_reread"] = True
            reopen.append(row)
        elif len(stale) < limit and _stale(row, floor):
            row["_row_number"] = n
            row["_reread"] = True
            stale.append(row)
    # THE CENSUS ONLY COUNTS WHEN IT COUNTED EVERYTHING: a pass that filled its budget on people who are…
    if full_scan:
        _heic_census(tab, heic_waiting)
    # A PERSON WAITING BEATS A BACKLOG, ALWAYS: the second-hand rows take only the room the pending ones…
    if len(out) < limit and (reopen or stale):
        took = (reopen + stale)[:limit - len(out)]
        back = sum(1 for r in took
                   if r.get("digest_state") != "done")
        log.info("%s: %d pending + %d re-read (stamped before %s)%s",
                 tab, len(out), len(took), floor,
                 " · %d reopened, the format is readable now" % back
                 if back else "")
        out += took
    return out


def _settled() -> set[str]:
    """Row ids this lane has already settled; raises when they cannot be read."""
    with _own() as conn, conn.cursor() as cur:
        cur.execute("select row_id from hub_form_digest_items"
                    " where state in ('done', 'error')")
        return {str(r[0]) for r in cur.fetchall()}


def _items_finished() -> set[str]:
    """Row ids this lane has already settled, so a live read skips them."""
    try:
        return _settled()
    except Exception:  # noqa: BLE001 — an empty set only costs a re-read
        return set()


def _a1_col(n: int) -> str:
    out = ""
    while n:
        n, rem = divmod(n - 1, 26)
        out = chr(65 + rem) + out
    return out


def _claim(house: str, rows: list[dict], tab: str = "form_files") -> int:
    """Reserve the pass's rows on the RECORD by keeping `working` in digest_state; how many were kept."""
    try:
        got = _keep(tab, house, {str(r.get("id") or ""): {"digest_state": "working"} for r in rows})
        return int(got["kept"]) + int(got["same"])
    except NotKept as exc:  # an unclaimed row is still read
        log.warning("%s: claim not kept for %d row(s): %.120s", tab, len(rows), str(exc))
    return 0


def _item_mark(row_id: str, state: str, error: str = "") -> None:
    with _own() as conn, conn.cursor() as cur:
        cur.execute(
            "insert into hub_form_digest_items (row_id, state, attempts, error, updated_at)"
            " values (%s, %s, 1, %s, now())"
            " on conflict (row_id) do update set state = excluded.state,"
            " attempts = hub_form_digest_items.attempts + 1,"
            " error = excluded.error, updated_at = now()",
            (row_id, state, error[:400]))


def _item_attempts(row_id: str) -> int:
    with _own() as conn, conn.cursor() as cur:
        cur.execute("select attempts from hub_form_digest_items where row_id = %s", (row_id,))
        row = cur.fetchone()
        return int(row[0]) if row else 0


def _download(drive, file_id: str, name: str) -> str:
    """The bytes, to a temp file named like the original (extension matters)."""
    from googleapiclient.http import MediaIoBaseDownload
    ext = Path(name).suffix or ""
    fd, path = tempfile.mkstemp(suffix=ext, prefix="digest_")
    os.close(fd)
    with open(path, "wb") as fh:
        req = drive.files().get_media(fileId=file_id)
        dl = MediaIoBaseDownload(fh, req)
        done = False
        while not done:
            _st, done = dl.next_chunk()
    return path


def digest_one(row: dict, drive, roster: set[str],
               roster_rows: dict | None = None,
               led: dict | None = None) -> dict[str, str]:
    """One file → the digest_* column values."""
    L = led or LEDGERS[0]
    name = str(row.get(L["name"]) or "file")
    path = ""
    try:
        path = _download(drive, str(row.get(L["file_id"]) or ""), name)
        kind = digest_kind(path)
        if kind == "unsupported":
            return {"digest_state": "unsupported", "digest_kind": kind,
                    "digest_error": _unsupported_why(
                        name, str(row.get(L["mime"]) or ""), path)}
        text = extract_text(path)
        text = re.sub(r"\n{3,}", "\n\n", text or "").strip()
        if not text:
            note = {"note": "extraction ran and saw nothing"}
            if _heic_ready() and _heic_shaped(name, str(row.get(L["mime"]) or ""), path):
                # THE DECODER WAS HERE AND THE PAGE REALLY IS BLANK.
                note["heic_decoder"] = True
            return {"digest_state": "empty", "digest_kind": kind,
                    "digest_json": json.dumps(note)}
        # ── ONE DECODER, TWO RUNNERS ──────────────────────────────────── The Python JSON must come out equal to…
        eng = engine_verdict(name, text, roster_rows or {}, _VOCAB_MEMO.get("v"))
        # ── THE BETTER EYE, AND ONLY WHERE IT IS OWED ──────────────────── What Python can do aggressively and Apps…
        try:
            owes = list((eng or {}).get("meta", {}).get("missing") or [])
            if owes and kind in ("image", "pdf") and SHARP_ON:
                import sharp_read as _sharp
                sharper = (_sharp.read_pdf_page_images(path, text)
                           if kind == "pdf" else _sharp.read_image(path, text))
                if sharper.get("pass") != "floor" and sharper.get("text"):
                    again = engine_verdict(name, sharper["text"], roster_rows or {}, _VOCAB_MEMO.get("v"))
                    left = list((again or {}).get("meta", {}).get("missing") or [])
                    if again and len(left) < len(owes):
                        log.info("sharp read paid on %s: %s → %s [%s psm %s, %ss]",
                                 name[:40], owes, left, sharper.get("pass"),
                                 sharper.get("psm"), sharper.get("seconds"))
                        text = sharper["text"]
                        eng = again
                        eng.setdefault("meta", {})["read_pass"] = sharper.get("pass")
                        eng["meta"]["read_score"] = sharper.get("score")
                        eng["meta"]["read_filled"] = [o for o in owes if o not in left]
        except Exception as exc:  # noqa: BLE001 — the ordinary reading still stands
            log.warning("sharp read skipped on %s: %.90s", name[:40], str(exc))
        if eng:
            # THE ROW'S OWN ANCHOR OUTRANKS ANY READING.
            if L.get("anchor_key") and str(row.get(L["anchor_key"]) or "").strip():
                eng["person_id"] = (L.get("anchor_kind") or "client") + ":" + \
                    str(row[L["anchor_key"]]).strip()
                eng["person"] = str(row.get(L.get("anchor_name") or "") or "")
                eng["subject_type"] = L.get("anchor_kind") or "client"
                eng["subject"] = eng["person"]
            meta = dict(eng.get("meta") or {})
            meta["text_truncated"] = len(text) > TEXT_CAP
            meta["ocr_kind"] = kind
            out = {
                "digest_state": "done",
                "digest_kind": kind,
                "digest_text_chars": str(len(text)),
                "digest_text": text[:TEXT_CAP],
                "digest_json": json.dumps(meta),
                "digest_error": "",
            }
            for col in ("doc_kind", "digest_category", "digest_dates", "digest_names",
                        "person", "person_id", "subject_type", "subject",
                        "person_seen", "person_agree", "mentions",
                        "issued_on", "expires_on", "confidence"):
                if col in eng:
                    out[col] = eng[col]
            return out

        cat, cat_src = categorize(name, text)
        dates = detect_dates(name, text)
        names = detect_names(text, roster)
        meta = {"category_source": cat_src,
                "ocr_kind": kind,
                "lane": "python:floor",
                "text_truncated": len(text) > TEXT_CAP}
        return {
            "digest_state": "done", "digest_kind": kind,
            "digest_category": cat,
            "digest_dates": json.dumps(dates),
            "digest_names": json.dumps(names),
            "digest_text_chars": str(len(text)),
            "digest_text": text[:TEXT_CAP],
            "digest_json": json.dumps(meta),
            "digest_error": "",
        }
    finally:
        if path:
            try:
                os.unlink(path)
            except OSError:
                pass


def _route_file(drive, row: dict, verdict: dict[str, str]) -> str:
    """THE DECODER'S OWN FILING (best-effort, never blocks the verdict): rename to `[category] date name…"""
    if verdict.get("digest_state") != "done":
        return ""
    fid = str(row.get("file_id") or "")
    if not fid:
        return ""
    try:
        cat = verdict.get("digest_category") or "other"
        dates = json.loads(verdict.get("digest_dates") or "[]")
        names = json.loads(verdict.get("digest_names") or "[]")
        original = str(row.get("file_name") or "file")
        label = "[" + cat + "]" + (" " + dates[0] if dates else "") + \
                (" " + names[0] if names else "")
        new_name = (label + " — " + original)[:180]
        meta = drive.files().get(fileId=fid, fields="parents,name").execute()
        parents = meta.get("parents") or []
        body: dict[str, Any] = {"name": new_name}
        kwargs: dict[str, Any] = {"fileId": fid, "body": body, "fields": "id"}
        if parents:
            # the category folder lives beside the file, inside its purpose
            q = ("'" + parents[0] + "' in parents and trashed=false and "
                 "mimeType='application/vnd.google-apps.folder' and name='" + cat + "'")
            hit = (drive.files().list(q=q, fields="files(id)", pageSize=1)
                   .execute().get("files") or [])
            sub = hit[0]["id"] if hit else drive.files().create(
                body={"name": cat, "mimeType": "application/vnd.google-apps.folder",
                      "parents": [parents[0]]}, fields="id").execute()["id"]
            kwargs["addParents"] = sub
            kwargs["removeParents"] = parents[0]
        drive.files().update(**kwargs).execute()
        return "filed as " + new_name[:80]
    except Exception as exc:  # noqa: BLE001 — the sheet row is the record
        log.debug("routing skipped for %s: %.120s", fid[:10], str(exc))
        return ""


def _write_verdicts(house: str, verdicts: dict[str, dict[str, str]], tab: str = "form_files") -> set[str]:
    """The digest_* columns of each verdict's row, found by its id, kept as the record (digestKeep) and carried to the
    sheet by the queue; the ids the record holds them for. NotKept when refused: nothing is marked done then."""
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    got = _keep(tab, house, {rid: {c: dict(v, digested_at=stamp).get(c, "") for c in DIGEST_COLS}
                             for rid, v in verdicts.items()})
    if got["missing"]:
        log.warning("%s: %d verdict(s) for rows the record does not hold — left for the next pass",
                    tab, len(got["missing"]))
    return set(verdicts) - set(got["missing"])


def _beat(items: int, errors: int) -> None:
    """The heartbeat lands on EVERY pass — a quiet intake is not a dead worker, and the Guardian must be able to…"""
    with _own() as conn, conn.cursor() as cur:
        cur.execute(
            "update hub_form_digest_state set last_pass_at = now(),"
            " last_pass_items = %s, last_pass_errors = %s where id = 1",
            (items, errors))


# Said once per process: an unreadable lane is one fact, not one per pass.
_GATE_SAID: dict[str, bool] = {}


def _gates_from_the_relay() -> bool:
    """Hand the gates the lane the relay publishes (lane_gate.publish), and the switch read from it."""
    try:
        import effective_roster  # noqa: PLC0415
        import lane_gate  # noqa: PLC0415
        import web_gate  # noqa: PLC0415
    except Exception as exc:  # noqa: BLE001 — said, and the pass then runs as it always has
        log.warning("digest gate: the gate modules could not be loaded (%s)", type(exc).__name__)
        return False
    reader = lane_gate.file_lane()
    lane_gate.use_lane(reader)

    def switch() -> dict[str, Any]:
        return web_gate.switch_from(reader())

    effective_roster.use_switch(switch)
    return True


def _unread(exc: Exception, items: int = 0, errors: int = 0) -> dict[str, Any]:
    """A pass refused before it claims anything: asa-hub-db's copy could not answer."""
    log.warning("digest pass held: asa-hub-db's copy could not be read (%.140s)", str(exc))
    _beat(items, errors + 1)
    return {"items": items, "errors": errors + 1, "note": "copy unread"}


def _one_pass() -> dict[str, Any]:
    """One pass over every ledger this lane drains."""
    # THE GATE, BEFORE A SINGLE CELL IS CLAIMED.
    try:
        import lane_gate  # noqa: PLC0415 — one reader of the gates in this module
        held = lane_gate.holds(lane_gate.DIGEST)
    except Exception as exc:  # noqa: BLE001 — a gate module that will not load arms nothing
        log.warning("digest gate could not be asked (%s) — the pass runs", type(exc).__name__)
        held = {"held": False, "why": ""}
    if held["held"]:
        return {"items": 0, "errors": 0, "note": held["why"]}
    if held.get("unreadable") and not _GATE_SAID.get("unreadable"):
        _GATE_SAID["unreadable"] = True
        log.warning("digest gate: the relay's published lane could not be read — the digest gate "
                    "writes the Hub's own books, so the pass runs; an armed gate is not honoured "
                    "until the lane is readable again")
    # THE RECORD BEFORE A SINGLE CELL IS CLAIMED: the roster, its names, the words book and the re-read dial off
    # asa-hub-db's copy, or this pass does not run
    try:
        roster_rows = _roster_rows()
        names = _roster()
        _vocab_rows()
        _reread_floor()
    except hub_rows.Unreadable as exc:
        return _unread(exc)

    drive = None
    total, total_err, per = 0, 0, {}
    for led in LEDGERS:
        left = ITEMS_PER_PASS - total
        if left <= 0:
            break
        try:
            house = _house_id(led["ptr"])
            pending = _pending(house, left, tab=led["tab"]) if house else []
        except hub_rows.Unreadable as exc:
            return _unread(exc, total, total_err)
        if not pending:
            continue
        # DRIVE ONLY WHEN THERE IS A PAPER TO READ: the queue and the cells are the record's, never the sheet's
        if drive is None:
            try:
                drive, _sheets = _clients()
            except Exception as exc:  # noqa: BLE001 — no credential, no lane
                log.warning("no Google client: %.140s", str(exc))
                _beat(total, total_err + 1)
                return {"items": total, "errors": total_err + 1, "note": "no google client"}
        got = _pass_over(led, house, drive, pending, roster_rows, names)
        total += got["items"]
        total_err += got["errors"]
        if got["items"]:
            per[led["res"]] = got["items"]
    if per:
        log.info("form-digest pass: %s", " · ".join(
            f"{v} {k}" for k, v in per.items()))
    _beat(total, total_err)
    return {"items": total, "errors": total_err, "per": per}


CLAIM_MINUTES = float(os.getenv("HUB_FORM_DIGEST_CLAIM_MIN", "20"))


def _seal_for_engine(verdict: dict, row: dict, led: dict) -> dict:
    """A VERDICT ON A FILE THE ENGINE CANNOT OPEN IS FINAL — FOR THE ENGINE."""
    if not _heic_shaped(str(row.get(led["name"]) or ""), str(row.get(led["mime"]) or "")):
        return verdict
    try:
        meta = json.loads(verdict.get("digest_json") or "{}")
    except Exception:  # noqa: BLE001
        meta = {}
    if not isinstance(meta, dict):
        meta = {}
    meta["final"] = True
    meta["final_why"] = "heic: the engine's reader cannot open this format"
    return dict(verdict, digest_json=json.dumps(meta))


def _release(house: str, rows: list[dict], tab: str) -> int:
    """Hand back a claim this pass did not settle, restoring what was there (kept as the record)."""
    back = {str(r.get("id") or ""): {"digest_state": str(r.get("digest_state") or "pending")} for r in rows}
    if not any(back):
        return 0
    try:
        got = _keep(tab, house, back)
        log.info("%s: %d claim(s) handed back (unsettled this pass)", tab, got["kept"] + got["same"])
        return got["kept"] + got["same"]
    except NotKept as exc:  # the stalled-claim sweep at the next start is the floor
        log.warning("%s: release not kept, leaving %d claimed: %.120s", tab, len(back), str(exc))
        return 0


def _release_stalled(house: str, tab: str) -> int:
    """At start-up, free the rows a lane that no longer exists still holds: read off the record, handed back to it."""
    try:
        head, lines = _copy_tab(house, tab)
    except hub_rows.Unreadable as exc:
        log.warning("%s: stalled-claim sweep could not read the record: %.120s", tab, str(exc))
        return 0
    if "digest_state" not in head:
        return 0
    cutoff = time.time() - CLAIM_MINUTES * 60
    back: dict[str, dict[str, str]] = {}
    for _n, line in lines:
        if line.get("digest_state") != "working" or not line.get("id"):
            continue
        stamp = ""
        for col in ("updatedAt", "createdAt"):
            if line.get(col, "").strip():
                stamp = line[col].strip()
                break
        if stamp:
            try:
                when = datetime.fromisoformat(stamp.replace("Z", "+00:00")).timestamp()
            except Exception:  # noqa: BLE001 — an unreadable stamp is an old one
                when = 0.0
            if when > cutoff:
                continue          # somebody may still be holding this one
        back[line["id"]] = {"digest_state": "pending"}
    if not back:
        return 0
    try:
        got = _keep(tab, house, back)
        log.warning("%s: %d row(s) were reserved by a lane that no longer exists — "
                    "handed back to pending", tab, got["kept"])
        return got["kept"]
    except NotKept as exc:
        log.warning("%s: stalled-claim sweep not kept: %.120s", tab, str(exc))
        return 0


def _pass_over(led: dict, house: str, drive, pending: list[dict], roster_rows: dict,
               roster: set[str]) -> dict[str, Any]:
    """SEVERAL AT ONCE, BECAUSE THE WAITING IS NOT OURS."""
    verdicts: dict[str, dict[str, str]] = {}
    errors = 0
    lock = threading.Lock()
    mine = threading.local()

    def my_drive():
        """A CLIENT PER THREAD, because googleapiclient is not thread-safe."""
        got = getattr(mine, "drive", None)
        if got is None:
            got = _clients()[0]
            mine.drive = got
        return got

    # THE SAME RESERVATION, FROM THIS SIDE: the pass's rows claimed on the record at once
    _claim(house, pending, led["tab"])

    def one(row: dict) -> None:
        nonlocal errors
        rid = str(row.get("id") or "")
        time.sleep(PER_REQUEST_DELAY_S)
        try:
            got = _seal_for_engine(digest_one(row, my_drive(), roster, roster_rows, led),
                                   row, led)
            got = _stamp_scan(got, row)
            with lock:
                verdicts[rid] = got
            # THE CORPUS IS READ-ONLY TO THIS LANE.
            routed = _route_file(my_drive(), row, got) if led.get("route") else ""
            if routed:
                try:
                    meta2 = json.loads(got.get("digest_json") or "{}")
                    meta2["routed"] = routed
                    with lock:
                        verdicts[rid]["digest_json"] = json.dumps(meta2)
                except Exception:  # noqa: BLE001
                    pass
            _item_mark(rid, "working")
        except Exception as exc:  # noqa: BLE001 — one broken file never stops the pass
            with lock:
                errors += 1
            msg = f"{type(exc).__name__}: {str(exc)[:200]}"
            if "403" in msg or "404" in msg:
                msg += " — share the upload folder with the service account (viewer)"
            attempts = _item_attempts(rid) + 1
            if attempts >= MAX_ATTEMPTS:
                with lock:
                    verdicts[rid] = {"digest_state": "error", "digest_error": msg[:380]}
                _item_mark(rid, "working", msg)
            else:
                _item_mark(rid, "retry", msg)
            log.warning("digest %s (%s) failed: %.160s",
                        str(row.get(led["name"]) or "?")[:40], rid[:8], msg)

    if pending:
        width = max(1, min(LANE_WIDTH, len(pending)))
        if width == 1:
            for row in pending:
                one(row)
        else:
            # A PASS THAT NEVER ENDS IS WORSE THAN A SLOW ONE.
            cap = float(os.getenv("HUB_FORM_DIGEST_ITEM_S", "180"))
            with cf.ThreadPoolExecutor(max_workers=width) as pool:
                futures = {pool.submit(one, r): r for r in pending}
                try:
                    for fut in cf.as_completed(futures, timeout=cap * 2):
                        fut.result()
                except cf.TimeoutError:
                    late = [r for f, r in futures.items() if not f.done()]
                    with lock:
                        errors += len(late)
                    log.warning("%d file(s) past %.0fs — left for the next pass",
                                len(late), cap * 2)
                    for f in futures:
                        f.cancel()
    landed: set[str] = set()
    if verdicts:
        # THE QUEUE NEVER PASSES A FAILED WRITE: only a landed verdict marks the item done; a writeback failure…
        landed = _write_verdicts(house, verdicts, led['tab'])
        for rid in landed:
            v = verdicts[rid]
            _item_mark(rid, "error" if v.get("digest_state") == "error" else "done",
                       v.get("digest_error", ""))
    # A CLAIM THIS PASS DID NOT SETTLE GOES BACK, NOW.
    unsettled = [r for r in pending if str(r.get("id") or "") not in landed]
    if unsettled:
        _release(house, unsettled, led["tab"])
    return {"items": len(landed), "errors": errors}


def _proposals_pass() -> dict[str, Any]:
    """The hourly proposals scan, behind the digest gate: {held, why}."""
    try:
        import lane_gate  # noqa: PLC0415 — one reader of the gates in this module
        held = lane_gate.holds(lane_gate.DIGEST)
    except Exception as exc:  # noqa: BLE001 — a gate module that will not load arms nothing
        log.warning("digest gate could not be asked (%s) — the proposals scan runs", type(exc).__name__)
        held = {"held": False, "why": ""}
    if held["held"]:
        if not _GATE_SAID.get("proposals"):
            _GATE_SAID["proposals"] = True
            log.info("proposals scan held: %s", held["why"])
        return {"held": True, "why": held["why"]}
    _GATE_SAID.pop("proposals", None)
    # the Decoder lab's own scan (app/digest_lab_writes.py digestScan): the ledgers and the words book read off the
    # record, the new proposals kept there and carried to the sheet by the queue
    got = _app_write("digestScan", {})
    log.info("proposals: %s", json.dumps(got.get("scan") or {}))
    return {"held": False, "why": ""}


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    try:
        _state_ensure()
    except Exception as exc:  # noqa: BLE001
        log.warning("state ensure failed: %s", exc)
    log.info("form-digest keeper up (every %.0fs, %d items/pass)", PASS_EVERY_S, ITEMS_PER_PASS)
    # THE FIRST THING A NEW LANE DOES IS FREE WHAT THE OLD ONE HELD.
    _gates_from_the_relay()
    try:
        import lane_gate  # noqa: PLC0415
        _startup_held = lane_gate.holds(lane_gate.DIGEST)["held"]
    except Exception:  # noqa: BLE001
        _startup_held = False
    if _startup_held:
        log.info("stalled-claim sweep held: the digest gate is armed and the send switch is on")
    else:
        try:
            for _led in LEDGERS:
                _house = _house_id(_led["ptr"])
                if _house:
                    _release_stalled(_house, _led["tab"])
        except Exception as exc:  # noqa: BLE001 — a lane that cannot sweep still reads
            log.warning("stalled-claim sweep skipped: %.140s", str(exc))
    last_scan = 0.0
    while True:
        started = time.monotonic()
        # THE READINGS PROPOSE, ONCE AN HOUR.
        if time.monotonic() - last_scan > 3600:
            try:
                if not _proposals_pass()["held"]:
                    last_scan = time.monotonic()
            except Exception as exc:  # noqa: BLE001 — a lane that cannot propose still reads
                last_scan = time.monotonic()
                log.warning("proposals scan failed: %.140s", str(exc))
        try:
            out = _one_pass()
            if out.get("items") or out.get("errors"):
                log.info("digest pass: %d item(s), %d error(s) in %.1fs",
                         out["items"], out["errors"], time.monotonic() - started)
        except Exception as exc:  # noqa: BLE001 — never self-disables
            log.warning("digest pass failed (%s: %.120s) — next pass retries",
                        type(exc).__name__, str(exc).splitlines()[0] if str(exc) else "")
        time.sleep(max(15.0, PASS_EVERY_S - (time.monotonic() - started)))


if __name__ == "__main__":
    main()
