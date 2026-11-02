"""MARS PAPERS — EVERY CLIENT'S MONTHLY MEDICATION RECORD, FOUND IN THE CLIENTS DRIVE AND READ ONCE.
The list Clients › Medication › Administration draws is client_files' MARS rows plus what this lane finds in the drive;
every one of them is read here, once, and its text kept in asa-hub-db (app.mar_paper_texts) for the screen to open."""
from __future__ import annotations

import base64
import hashlib
import json
import logging
import os
import re
import sys
import tempfile
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable

import psycopg2
import psycopg2.extras

import hub_rows

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

log = logging.getLogger("hub.mar_papers")

# the medication lane's door into asa-hub-db (role asa_hub_meds, search_path app); unset, the lane stays off
DSN = (os.getenv("HUB_MAR_PAPERS_DSN") or os.getenv("HUB_HOUSE_MEDS_DSN") or "").strip()
# the relay's own copy of the sheets: the depot's pointer and client_files, as form_digest reads them
MIRROR_DSN = os.getenv("HUB_PG_DSN") or os.getenv("HUB_SNAPSHOT_PG_DSN") or ""
SCHEMA = os.getenv("HUB_MAR_PAPERS_SCHEMA", "app").strip() or "app"
ESSENCIAL_ID = "1Y6UMJlCS5gHur52f0YrPsLSqwYlCA792I8gAiZsxsug"
CLIENT_FILES_PTR = "switchboard:props.HUB_HOUSE_CLIENT_FILES_ID"
CLIENT_FILES_TAB = "client_files"
# ClientSourceMar.gs CSM_FOLDER_FALLBACK
CLIENTS_FOLDER = os.getenv("HUB_CLIENTS_FOLDER_ID", "1sm8RbpmYWlRCD6cVjRCTePZW8F5721xQ").strip()
SA_PATH = os.getenv("GOOGLE_SERVICE_ACCOUNT_JSON", "/app/service-account.json")
IMPERSONATE = os.getenv("GOOGLE_IMPERSONATE_USER", "jarvis@asalifecare.com")
DRIVE_SCOPES = ["https://www.googleapis.com/auth/drive.readonly"]

# the places listed every SWEEP_S; the whole drive walked again every WALK_S (a new client, a new MARS folder)
SWEEP_S = float(os.getenv("HUB_MAR_SWEEP_S", "600"))
WALK_S = float(os.getenv("HUB_MAR_WALK_S", "21600"))
PASS_S = float(os.getenv("HUB_MAR_PASS_S", "60"))
# a pass reads until this many seconds have gone, then lists the drive again if it is due
BUDGET_S = float(os.getenv("HUB_MAR_BUDGET_S", "240"))
BATCH = 40
MAX_BYTES = 80 * 1024 * 1024
TEXT_MAX = 1_000_000
RETRY_FIRST_S = 600.0
RETRY_MAX_S = 86400.0

# ClientSourceMar.gs: the tops that are not a person, the inactive clients one level deeper, the MAR name, the folder
SYSTEM_TOP = re.compile(r"^(0 - |Templates|Leases|Pictures|House Documentation|Potential New Clients)", re.I)
INACTIVE_TOP = re.compile(r"^0 - Client Inactive", re.I)
MAR_NAME = re.compile(r"(^|[^a-z])mars?([^a-z]|$)", re.I)
MARS_FOLDER = re.compile(r"^mars?$", re.I)
FOLDER_MIME = "application/vnd.google-apps.folder"
GOOGLE_NATIVE = "application/vnd.google-apps."
# the scratch copy Digest.gs converts a paper through, left behind when its delete failed: never a paper
SCRATCH_NAME = "digest-tmp"
# the head Digest.gs writes over an archived text (row_id, ledger, file_id … between two --- lines)
ARCHIVE_HEAD = re.compile(r"\A---\r?\n(?=row_id:)(?:.*?\r?\n)*?---\r?\n")
MIME_EXT = {"application/pdf": ".pdf", "image/heif": ".heif", "image/heic": ".heic", "image/jpeg": ".jpg",
            "image/png": ".png", "image/tiff": ".tif",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx"}

# test hooks: the Drive client, the mirror's client_files rows, the paper reader
DRIVE_FACTORY: Callable[[], Any] | None = None
MIRROR_READER: Callable[[], dict[str, dict[str, Any]]] | None = None
PAPER_READER: Callable[[Any, str, str, str], tuple[str, int, str]] | None = None


class Unread(RuntimeError):
    """The paper could not be read now; the row says why and is tried again later."""


class DriveUnavailable(RuntimeError):
    """The drive could not be listed: never "nothing new"."""


# ── the stores ────────────────────────────────────────────────────────────────────────────────────────────────────

def _connect(dsn: str):
    return psycopg2.connect(dsn, connect_timeout=5)


def _t(name: str) -> str:
    if not re.fullmatch(r"[a-z_][a-z0-9_]{0,62}", SCHEMA):
        raise RuntimeError("the MARS papers schema is not a plain name")
    return f"{SCHEMA}.{name}"


def client_files_rows() -> dict[str, dict[str, Any]]:
    """client_files by drive_id, every kind (a file the platform holds is never found again), from the relay's copy."""
    if MIRROR_READER is not None:
        return MIRROR_READER()
    ptr = hub_rows.rows(ESSENCIAL_ID, "Facts", where={"Source": CLIENT_FILES_PTR})
    house = str(hub_rows.cell(ptr[-1].get("Value")) or "").strip() if ptr else ""
    if not house:
        raise RuntimeError("the depot names no client_files house")
    got = hub_rows.rows(house, CLIENT_FILES_TAB, fields=["drive_id", "doc_kind", "text_file", "title", "mime_type",
                                                        "digest_text_chars"], sizes=["digest_text"])
    out: dict[str, dict[str, Any]] = {}
    for d in got:
        def text(k: str) -> str:
            return str(hub_rows.cell(d.get(k)) or "")
        fid = text("drive_id").strip()
        if fid:
            out[fid] = {"drive_id": fid, "doc_kind": text("doc_kind").lower(), "text_file": text("text_file").strip(),
                        "title": text("title"), "mime_type": text("mime_type"), "chars": _int(text("digest_text_chars")),
                        "cell": int(d.get("digest_text") or 0), "house": house}
    return out


def _cell_text(drive_id: str, house: str) -> str:
    """A paper's whole text where Digest.gs left it in the cell (no archive: it fitted)."""
    got = hub_rows.rows(house, CLIENT_FILES_TAB, where={"drive_id": drive_id}, fields=["digest_text"])
    return str(hub_rows.cell(got[0].get("digest_text")) or "") if got else ""


def _int(v: Any) -> int:
    try:
        return int(float(str(v).strip()))
    except (TypeError, ValueError):
        return 0


# ── the drive ─────────────────────────────────────────────────────────────────────────────────────────────────────

def _drive() -> Any:
    """Drive, read-only, as the identity the relay is configured with (house_meds._drive's shape)."""
    if DRIVE_FACTORY is not None:
        return DRIVE_FACTORY()
    try:
        from google.oauth2 import service_account  # noqa: PLC0415
        from googleapiclient.discovery import build  # noqa: PLC0415
        raw = (SA_PATH or "").strip()
        info = None
        if raw.startswith("{"):
            info = json.loads(raw)
        elif not raw.startswith("/") and len(raw) > 512:
            info = json.loads(base64.b64decode(raw))
        base = (service_account.Credentials.from_service_account_info(info, scopes=DRIVE_SCOPES)
                if info is not None else
                service_account.Credentials.from_service_account_file(raw, scopes=DRIVE_SCOPES))
        subject = (IMPERSONATE or "").strip()
        creds = base.with_subject(subject) if subject else base
        return build("drive", "v3", credentials=creds, cache_discovery=False)
    except Exception as exc:  # noqa: BLE001 — the type only: a message may carry the key
        raise DriveUnavailable(f"the Drive credential could not be used ({type(exc).__name__})") from None


_DRIVE: dict[str, Any] = {"at": 0.0, "v": None}


def _held_drive() -> Any:
    """One Drive client for half an hour: a pass a minute need not build one each time."""
    if _DRIVE["v"] is None or time.monotonic() - _DRIVE["at"] > 1800 or DRIVE_FACTORY is not None:
        _DRIVE.update(v=_drive(), at=time.monotonic())
    return _DRIVE["v"]


def _children(drive: Any, folder_id: str) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    token = None
    while True:
        try:
            got = drive.files().list(
                q=f"'{folder_id}' in parents and trashed = false", pageSize=1000, pageToken=token,
                fields="nextPageToken,files(id,name,mimeType,size,createdTime,modifiedTime)",
                supportsAllDrives=True, includeItemsFromAllDrives=True).execute()
        except Exception as exc:  # noqa: BLE001 — a listing that failed is never an empty folder
            raise DriveUnavailable(f"a folder could not be listed ({type(exc).__name__})") from None
        out += got.get("files") or []
        token = got.get("nextPageToken")
        if not token:
            return out


def walk(drive: Any) -> list[dict[str, Any]]:
    """csmScan_'s places: each client folder (its MAR-named files) and every MARS folder in it, two levels deep."""
    clients: list[tuple[dict, str]] = []
    for top in _children(drive, CLIENTS_FOLDER):
        if top.get("mimeType") != FOLDER_MIME:
            continue
        name = str(top.get("name") or "").strip()
        if INACTIVE_TOP.match(name):
            clients += [(f, "inactive") for f in _children(drive, top["id"]) if f.get("mimeType") == FOLDER_MIME]
        elif not SYSTEM_TOP.match(name):
            clients.append((top, "active"))
    places: list[dict[str, Any]] = []
    for folder, area in clients:
        who = str(folder.get("name") or "").strip()
        places.append({"id": folder["id"], "client_folder": who, "area": area, "path": "", "named_only": True})
        queue = [(folder["id"], "", 0)]
        while queue:
            fid, path, depth = queue.pop(0)
            for kid in _children(drive, fid):
                if kid.get("mimeType") != FOLDER_MIME:
                    continue
                kn = str(kid.get("name") or "").strip()
                at = f"{path}/{kn}" if path else kn
                if MARS_FOLDER.match(kn):
                    places.append({"id": kid["id"], "client_folder": who, "area": area, "path": at,
                                   "named_only": False})
                elif depth < 1:
                    queue.append((kid["id"], at, depth + 1))
    return places


def _paper(f: dict[str, Any], place: dict[str, Any]) -> dict[str, Any] | None:
    name = str(f.get("name") or "")
    mime = str(f.get("mimeType") or "")
    if mime == FOLDER_MIME or mime.startswith(GOOGLE_NATIVE) or name.strip() == SCRATCH_NAME:
        return None
    if place["named_only"] and not MAR_NAME.search(name):
        return None
    return {"drive_id": str(f["id"]), "client_folder": place["client_folder"], "area": place["area"],
            "folder": place["path"], "title": name[:250], "mime_type": mime, "size_bytes": _int(f.get("size")),
            "file_date": file_date(name), "created_time": f.get("createdTime") or None,
            "modified_time": f.get("modifiedTime") or None,
            "mark": f"{f.get('modifiedTime') or ''}|{_int(f.get('size'))}"}


def listing(drive: Any, places: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for place in places:
        for f in _children(drive, place["id"]):
            p = _paper(f, place)
            if p is not None:
                out.setdefault(p["drive_id"], p)
    return list(out.values())


_MONTHS = {m: i for i, m in enumerate(("january", "february", "march", "april", "may", "june", "july", "august",
                                       "september", "october", "november", "december"), start=1)}
for _m in list(_MONTHS):
    _MONTHS[_m[:3]] = _MONTHS[_m]


def file_date(name: str) -> str:
    """csmFileDate_: the day the file name states, ISO; never invented."""
    def ok(y: int, mo: int, d: int) -> str:
        if not (2000 <= y <= 2100 and 1 <= mo <= 12 and 1 <= d <= 31):
            return ""
        d = min(d, 28) if mo == 2 else d
        try:
            return datetime(y, mo, d).strftime("%Y-%m-%d")
        except ValueError:
            return ""
    s = str(name or "")
    m = re.search(r"\b(\d{1,2})[_\-/.](\d{1,2})[_\-/.](20\d{2})\b", s)
    if m:
        return ok(int(m[3]), int(m[1]), int(m[2]))
    m = re.search(r"\b(\d{1,2})\.(\d{1,2})\.(\d{2})\b", s)
    if m:
        return ok(2000 + int(m[3]), int(m[1]), int(m[2]))
    m = re.search(r"\b(20\d{2})[-_](\d{1,2})[-_](\d{1,2})\b", s)
    if m:
        return ok(int(m[1]), int(m[2]), int(m[3]))
    m = re.search(r"(20\d{2})\s+([A-Za-z]+)", s)
    if m and m[2].lower() in _MONTHS:
        return ok(int(m[1]), _MONTHS[m[2].lower()], 1)
    m = re.search(r"([A-Za-z]+)\s+(20\d{2})", s)
    if m and m[1].lower() in _MONTHS:
        return ok(int(m[2]), _MONTHS[m[1].lower()], 1)
    return ""


# ── the reading ───────────────────────────────────────────────────────────────────────────────────────────────────

def _bytes(drive: Any, file_id: str, cap: int = MAX_BYTES) -> bytes:
    try:
        meta = drive.files().get(fileId=file_id, fields="id,size,trashed", supportsAllDrives=True).execute()
    except Exception as exc:  # noqa: BLE001
        if getattr(getattr(exc, "resp", None), "status", 0) == 404:
            raise Unread("the file is no longer in the drive") from None
        raise Unread(f"Drive did not answer ({type(exc).__name__})") from None
    if meta.get("trashed"):
        raise Unread("the file is in the drive's trash")
    if _int(meta.get("size")) > cap:
        raise Unread(f"the file is larger than {cap // (1024 * 1024)} MB")
    try:
        return drive.files().get_media(fileId=file_id, supportsAllDrives=True).execute()
    except Exception as exc:  # noqa: BLE001
        raise Unread(f"Drive did not hand the file over ({type(exc).__name__})") from None


def read_paper(drive: Any, file_id: str, name: str, mime: str) -> tuple[str, int, str]:
    """The paper's own text: its words where it has them, Tesseract where it is a scan (form_digest's reader)."""
    if PAPER_READER is not None:
        return PAPER_READER(drive, file_id, name, mime)
    import form_digest as fd  # noqa: PLC0415 — the relay's reader, loaded with the lane
    raw = _bytes(drive, file_id)
    ext = Path(name).suffix.lower() or MIME_EXT.get(mime, "")
    fd_, path = tempfile.mkstemp(suffix=ext, prefix="mars_")
    try:
        with os.fdopen(fd_, "wb") as fh:
            fh.write(raw)
        kind = fd.digest_kind(path)
        if kind in ("unsupported", "unknown"):
            raise Unread(f"a {ext or 'file'} of this kind cannot be read")
        pages = 0
        if kind == "pdf":
            try:
                import fitz  # noqa: PLC0415
                with fitz.open(path) as doc:
                    pages = doc.page_count
            except Exception:  # noqa: BLE001 — the count is a fact, never a condition
                pages = 0
        text = fd.extract_text(path)
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass
    return text, pages, "tesseract" if kind in ("pdf", "image") else kind


def read_archive(drive: Any, archive_id: str) -> str:
    """The whole text Digest.gs archived beside the paper, without the head it wrote over it."""
    raw = _bytes(drive, archive_id, 32 * 1024 * 1024)
    return ARCHIVE_HEAD.sub("", raw.decode("utf-8", "replace"), count=1)


def _mask(text: str) -> tuple[str, int]:
    """The SSN mask the archives were swept with (mask_filed_numbers): the width kept, the last four shown."""
    import mask_filed_numbers as mfn  # noqa: PLC0415
    out, hit = mfn.mask(text)
    return (out, len(hit)) if len(out) == len(text) else (text, 0)


def read_one(drive: Any, row: dict[str, Any], held: dict[str, Any] | None) -> dict[str, Any]:
    """One paper's text: the archive or the cell Digest.gs left, else the paper itself read here."""
    started = time.monotonic()
    pages, engine, text = None, "", ""
    if row["source"] == "client_files":
        if held is None:
            raise Unread("client_files no longer holds this paper")
        if held["text_file"]:
            try:
                text, engine = read_archive(drive, held["text_file"]), "archive"
            except Unread as why:
                log.info("mar papers: %s archive unread (%s), reading the paper", row["drive_id"], why)
        elif held["cell"] and held["cell"] >= held["chars"] > 0:
            text = held["cell_text"] if "cell_text" in held else _cell_text(row["drive_id"], held["house"])
            engine = "sheet"
        name, mime = held["title"], held["mime_type"]
    else:
        name, mime = row.get("title") or "", row.get("mime_type") or ""
    if not text.strip():
        text, pages, engine = read_paper(drive, row["drive_id"], name, mime)
    text = re.sub(r"\n{3,}", "\n\n", (text or "").replace("\x00", "")).strip()
    if not text:
        raise Unread("the reading saw no words on the paper")
    text, masked = _mask(text[:TEXT_MAX])
    return {"text": text, "chars": len(text), "pages": pages, "engine": engine, "masked": masked,
            "seconds": round(time.monotonic() - started, 1)}


# ── the lane ──────────────────────────────────────────────────────────────────────────────────────────────────────

def _beat(cur) -> dict[str, Any]:
    cur.execute(f"insert into {_t('mar_papers_beat')} (id) values (1) on conflict (id) do nothing")
    cur.execute(f"select swept_at, walked_at, places from {_t('mar_papers_beat')} where id = 1")
    swept, walked, places = cur.fetchone()
    return {"swept_at": swept, "walked_at": walked,
            "places": places if isinstance(places, list) else json.loads(places or "[]")}


def _due(at: datetime | None, every: float, now: datetime) -> bool:
    return at is None or (now - at).total_seconds() >= every


def sweep(conn, drive: Any, held: dict[str, dict[str, Any]], beat: dict[str, Any], now: datetime) -> dict[str, Any]:
    """The places listed (walked first when due), each paper client_files does not hold kept and queued to read."""
    full = _due(beat["walked_at"], WALK_S, now) or not beat["places"]
    places = walk(drive) if full else beat["places"]
    papers = [p for p in listing(drive, places) if p["drive_id"] not in held]
    new = 0
    with conn, conn.cursor() as cur:
        for p in papers:
            cur.execute(
                f"insert into {_t('mar_papers')} (drive_id, client_folder, area, folder, title, mime_type, size_bytes,"
                " file_date, created_time, modified_time, found_at, seen_at)"
                " values (%(drive_id)s, %(client_folder)s, %(area)s, %(folder)s, %(title)s, %(mime_type)s,"
                " %(size_bytes)s, %(file_date)s, %(created_time)s, %(modified_time)s, %(now)s, %(now)s)"
                " on conflict (drive_id) do update set client_folder = excluded.client_folder, area = excluded.area,"
                " folder = excluded.folder, title = excluded.title, mime_type = excluded.mime_type,"
                " size_bytes = excluded.size_bytes, file_date = excluded.file_date,"
                " modified_time = excluded.modified_time, seen_at = excluded.seen_at, gone_at = null"
                " returning (xmax = 0)", {**p, "now": now})
            new += 1 if cur.fetchone()[0] else 0
            _queue(cur, p["drive_id"], "drive", p["mark"], now)
        if full:
            # a whole walk that answered: what it no longer saw has left the drive (the row stays, marked)
            cur.execute(f"update {_t('mar_papers')} set gone_at = %s where gone_at is null and seen_at < %s",
                        (now, now))
        cur.execute(f"update {_t('mar_papers_beat')} set swept_at = %s, walked_at = coalesce(%s, walked_at),"
                    " places = %s, found = %s, note = '', updated_at = %s where id = 1",
                    (now, now if full else None, psycopg2.extras.Json(places), len(papers), now))
    return {"places": len(places), "walked": full, "papers": len(papers), "new": new}


def _queue(cur, drive_id: str, source: str, mark: str, now: datetime) -> None:
    """A paper owed a reading: a new row, or one whose file (or archive) changed since it was read."""
    cur.execute(
        f"insert into {_t('mar_paper_texts')} (drive_id, source, mark, next_try_at, updated_at)"
        " values (%s, %s, %s, %s, %s) on conflict (drive_id) do update set mark = excluded.mark, state = 'pending',"
        " attempts = 0, error = '', next_try_at = excluded.next_try_at, updated_at = excluded.updated_at"
        f" where {_t('mar_paper_texts')}.source = excluded.source and {_t('mar_paper_texts')}.mark <> excluded.mark",
        (drive_id, source, mark, now, now))


def _mark_of(h: dict[str, Any]) -> str:
    return f"archive:{h['text_file']}" if h["text_file"] else f"cell:{h['chars']}:{h['cell']}"


def seed(conn, held: dict[str, dict[str, Any]], now: datetime) -> int:
    """client_files' MARS rows, each owed a reading in the store."""
    mars = [h for h in held.values() if h["doc_kind"] == "mar"]
    with conn, conn.cursor() as cur:
        for h in mars:
            _queue(cur, h["drive_id"], "client_files", _mark_of(h), now)
    return len(mars)


def _retry_s(attempts: int) -> float:
    return min(RETRY_MAX_S, RETRY_FIRST_S * (2 ** max(0, attempts - 1)))


def drain(conn, drive: Any, held: dict[str, dict[str, Any]], deadline: float) -> dict[str, int]:
    """The papers owed a reading, the sweep's new ones first, until the deadline; a failure is kept, never 'read'."""
    got = {"read": 0, "failed": 0}
    while time.monotonic() < deadline:
        with conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                f"select t.drive_id, t.source, t.mark, t.attempts, p.title, p.mime_type"
                f" from {_t('mar_paper_texts')} t left join {_t('mar_papers')} p on p.drive_id = t.drive_id"
                " where t.state <> 'read' and t.next_try_at <= now()"
                " order by (t.source = 'drive') desc, t.next_try_at, t.drive_id limit %s", (BATCH,))
            rows = [dict(r) for r in cur.fetchall()]
        if not rows:
            break
        for row in rows:
            if time.monotonic() >= deadline:
                break
            now = datetime.now(timezone.utc)
            try:
                out = read_one(drive, row, held.get(row["drive_id"]))
            except Unread as why:
                _failed(conn, row, str(why), now)
                got["failed"] += 1
                continue
            except Exception as exc:  # noqa: BLE001 — the type only: a message may carry the paper's words
                _failed(conn, row, f"the reading stopped ({type(exc).__name__})", now)
                got["failed"] += 1
                continue
            with conn, conn.cursor() as cur:
                cur.execute(
                    f"update {_t('mar_paper_texts')} set state = 'read', engine = %s, text = %s, chars = %s,"
                    " pages = %s, masked = %s, error = '', attempts = attempts + 1, read_at = %s, seconds = %s,"
                    " updated_at = %s where drive_id = %s and mark = %s",
                    (out["engine"], out["text"], out["chars"], out["pages"], out["masked"], now, out["seconds"], now,
                     row["drive_id"], row["mark"]))
            got["read"] += 1
    return got


def _failed(conn, row: dict[str, Any], why: str, now: datetime) -> None:
    attempts = int(row.get("attempts") or 0) + 1
    with conn, conn.cursor() as cur:
        cur.execute(
            f"update {_t('mar_paper_texts')} set state = 'failed', error = %s, attempts = %s, next_try_at = %s,"
            " updated_at = %s where drive_id = %s and mark = %s",
            (why[:300], attempts, now + timedelta(seconds=_retry_s(attempts)), now, row["drive_id"], row["mark"]))
    log.info("mar papers: %s not read (attempt %d): %s", row["drive_id"], attempts, why[:120])


_SEEDED: dict[str, str] = {"hash": ""}


def one_pass(conn) -> dict[str, Any]:
    """The drive listed when due, client_files' rows queued when they changed, then the readings owed."""
    started = time.monotonic()
    now = datetime.now(timezone.utc)
    held = client_files_rows()
    said: dict[str, Any] = {}
    drive = _held_drive()
    with conn, conn.cursor() as cur:
        beat = _beat(cur)
    if _due(beat["swept_at"], SWEEP_S, now):
        try:
            said["sweep"] = sweep(conn, drive, held, beat, now)
        except DriveUnavailable as why:
            said["sweep_error"] = str(why)
            with conn, conn.cursor() as cur:
                cur.execute(f"update {_t('mar_papers_beat')} set note = %s, updated_at = %s where id = 1",
                            (f"the drive could not be listed: {why}"[:300], now))
    marks = hashlib.sha256(json.dumps(sorted((k, _mark_of(h)) for k, h in held.items() if h["doc_kind"] == "mar"))
                           .encode()).hexdigest()
    if marks != _SEEDED["hash"]:
        said["seeded"] = seed(conn, held, now)
        _SEEDED["hash"] = marks
    said.update(drain(conn, drive, held, started + BUDGET_S))
    with conn, conn.cursor() as cur:
        cur.execute(f"select count(*) filter (where state = 'read'), count(*) filter (where state = 'failed'),"
                    f" count(*) filter (where state = 'pending') from {_t('mar_paper_texts')}")
        read, failed, pending = cur.fetchone()
        cur.execute(f"update {_t('mar_papers_beat')} set read = %s, failed = %s, updated_at = now() where id = 1",
                    (read, failed))
    said.update({"stored_read": read, "stored_failed": failed, "stored_pending": pending})
    return said


# ── the scratch copies ────────────────────────────────────────────────────────────────────────────────────────────
TIDY_S = float(os.getenv("HUB_SCRATCH_TIDY_S", "3600"))
TIDY_BUDGET_S = float(os.getenv("HUB_SCRATCH_TIDY_BUDGET_S", "300"))
SCRATCH_KINDS = ("application/vnd.google-apps.document", "application/vnd.google-apps.spreadsheet")
# test hook: the read-write Drive client the tidy trashes with
WRITE_FACTORY: Callable[[], Any] | None = None


def tidy_scratch(budget_s: float = TIDY_BUDGET_S) -> dict[str, int]:
    """The "digest-tmp" Docs and Sheets Drive's conversion left behind, an hour old or more, put in the trash — a
    batch at a time, nothing named otherwise and no Form ever touched (it is recoverable from the trash)."""
    if WRITE_FACTORY is not None:
        write = WRITE_FACTORY()
    else:
        import form_digest as fd  # noqa: PLC0415 — the relay's read-write Drive identity
        write, _ = fd._clients()
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M:%S")
    deadline = time.monotonic() + budget_s
    got = {"trashed": 0, "failed": 0}
    tried: set[str] = set()
    while time.monotonic() < deadline:
        r = write.files().list(q=f"name = '{SCRATCH_NAME}' and trashed = false and modifiedTime < '{cutoff}'",
                               corpora="allDrives", pageSize=100, fields="files(id,name,mimeType)",
                               supportsAllDrives=True, includeItemsFromAllDrives=True).execute()
        files = [f for f in r.get("files") or [] if f.get("name") == SCRATCH_NAME
                 and f.get("mimeType") in SCRATCH_KINDS and f["id"] not in tried]
        if not files:
            break
        answers: dict[str, Any] = {}

        def heard(rid: str, response: Any, exc: Any, answers: dict = answers) -> None:
            answers[rid] = (response, exc)

        batch = write.new_batch_http_request(callback=heard)
        for n, f in enumerate(files):
            tried.add(f["id"])
            batch.add(write.files().update(fileId=f["id"], body={"trashed": True}, supportsAllDrives=True,
                                           fields="id,name,trashed"), request_id=str(n))
        batch.execute()
        for n, _f in enumerate(files):
            response, exc = answers.get(str(n), (None, None))
            ok = exc is None and bool(response) and response.get("trashed") is True
            got["trashed" if ok else "failed"] += 1
        time.sleep(0.5)
    return got


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    if not DSN or os.getenv("HUB_MAR_PAPERS", "on").strip().lower() in ("off", "0", "no"):
        log.warning("mar papers: no asa-hub-db door (HUB_HOUSE_MEDS_DSN) or switched off — the lane is idle")
        while True:
            time.sleep(3600)
    log.info("mar papers keeper up (drive listed every %.0fs, walked every %.0fs)", SWEEP_S, WALK_S)
    conn = None
    # the first pass tidies at once: the monotonic clock counts from the machine's boot, not from this start
    tidied = -TIDY_S
    while True:
        started = time.monotonic()
        more = False
        if started - tidied >= TIDY_S:
            tidied = started
            try:
                swept = tidy_scratch()
                if swept["trashed"] or swept["failed"]:
                    log.info("scratch tidy: %s", json.dumps(swept))
            except Exception as exc:  # noqa: BLE001 — the next hour tries again
                log.warning("scratch tidy failed (%s)", type(exc).__name__)
        try:
            if conn is None or conn.closed:
                conn = _connect(DSN)
            said = one_pass(conn)
            more = bool(said.get("stored_pending")) and time.monotonic() - started >= BUDGET_S - 1
            if said.get("sweep") or said.get("read") or said.get("failed") or said.get("seeded") or \
                    said.get("sweep_error"):
                log.info("mar papers pass: %s", json.dumps({k: v for k, v in said.items()}, default=str))
        except Exception as exc:  # noqa: BLE001 — never self-disables; the next pass retries
            log.warning("mar papers pass failed (%s: %.120s)", type(exc).__name__,
                        str(exc).splitlines()[0] if str(exc) else "")
            try:
                if conn is not None:
                    conn.close()
            except Exception:  # noqa: BLE001
                pass
            conn = None
        time.sleep(1.0 if more else max(15.0, PASS_S - (time.monotonic() - started)))


if __name__ == "__main__":
    main()
