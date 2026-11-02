"""What a clip or a paper actually carries, as facts only; Digest.gs stays the one decoder."""
from __future__ import annotations

import json
import logging
import os
import shutil
import subprocess
import tempfile
import threading
from pathlib import Path
from typing import Any

log = logging.getLogger(__name__)

SA_PATHS = [Path("/opt/docker/asa-hub/server/.service-account.json"),
            Path("/srv/service-account.json")]
SCOPES = ["https://www.googleapis.com/auth/drive.readonly"]

MAX_BYTES = 300 * 1024 * 1024
MAX_FRAMES = 8
FFPROBE_TIMEOUT = 60
FFMPEG_TIMEOUT = 90
TESSERACT_TIMEOUT = 60
DOWNLOAD_TIMEOUT = 300

# one at a time: ffmpeg eats every core, and this container also answers all /gas traffic
_LOCK = threading.Semaphore(1)


def _drive():
    """The credential may be a path, raw JSON or base64; its value must never reach an error string."""
    import base64                                        # noqa: PLC0415
    from google.oauth2 import service_account            # noqa: PLC0415
    from googleapiclient.discovery import build          # noqa: PLC0415
    raw = (os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON")
           or os.environ.get("SHEET_SYNC_SA")
           or os.environ.get("GOOGLE_APPLICATION_CREDENTIALS") or "").strip()
    info = None
    if raw.startswith("{"):
        info = json.loads(raw)
    elif raw and not raw.startswith("/") and len(raw) > 512:
        try:
            info = json.loads(base64.b64decode(raw))
        except Exception:  # noqa: BLE001 — not base64 after all; try it as a path
            info = None
    if info is None:
        path = Path(raw) if raw.startswith("/") else None
        if not path or not path.exists():
            path = next((p for p in SA_PATHS if p.exists()), None)
        if not path:
            raise RuntimeError("no service account json for the media probe "
                               "(GOOGLE_SERVICE_ACCOUNT_JSON is empty or unreadable)")
        cred = service_account.Credentials.from_service_account_file(str(path), scopes=SCOPES)
        return build("drive", "v3", credentials=cred, cache_discovery=False)
    cred = service_account.Credentials.from_service_account_info(info, scopes=SCOPES)
    return build("drive", "v3", credentials=cred, cache_discovery=False)


def _download(file_id: str, into: Path) -> dict[str, Any]:
    from googleapiclient.http import MediaIoBaseDownload  # noqa: PLC0415
    drv = _drive()
    meta = drv.files().get(fileId=file_id, supportsAllDrives=True,
                           fields="id,name,size,mimeType").execute()
    size = int(meta.get("size") or 0)
    if size > MAX_BYTES:
        raise RuntimeError(f"{size} bytes is past the {MAX_BYTES} ceiling for a probe")
    with open(into, "wb") as fh:
        dl = MediaIoBaseDownload(fh, drv.files().get_media(fileId=file_id),
                                 chunksize=8 * 1024 * 1024)
        done = False
        while not done:
            _status, done = dl.next_chunk(num_retries=2)
    return meta


def _ffprobe(path: Path) -> dict[str, Any]:
    out = subprocess.run(
        ["ffprobe", "-v", "quiet", "-print_format", "json",
         "-show_format", "-show_streams", str(path)],
        capture_output=True, text=True, timeout=FFPROBE_TIMEOUT)
    if out.returncode != 0:
        return {}
    try:
        raw = json.loads(out.stdout or "{}")
    except Exception:  # noqa: BLE001
        return {}
    fmt = raw.get("format") or {}
    facts: dict[str, Any] = {}
    try:
        facts["seconds"] = round(float(fmt.get("duration") or 0), 1)
    except Exception:  # noqa: BLE001
        facts["seconds"] = 0
    if fmt.get("bit_rate"):
        facts["kbps"] = int(int(fmt["bit_rate"]) / 1000)
    tags = fmt.get("tags") or {}
    for key in ("creation_time", "com.apple.quicktime.creationdate", "date"):
        if tags.get(key):
            facts["taken_at"] = str(tags[key])
            break
    for key in ("location", "com.apple.quicktime.location.ISO6709", "location-eng"):
        if tags.get(key):
            facts["gps"] = str(tags[key])
            break
    for key in ("com.apple.quicktime.make", "com.apple.quicktime.model"):
        if tags.get(key):
            facts.setdefault("device", "")
            facts["device"] = (facts["device"] + " " + str(tags[key])).strip()
    for stream in raw.get("streams") or []:
        if stream.get("codec_type") == "video" and "frame" not in facts:
            facts["codec"] = stream.get("codec_name")
            if stream.get("width") and stream.get("height"):
                facts["frame"] = f"{stream['width']}x{stream['height']}"
        if stream.get("codec_type") == "audio":
            facts["audio"] = stream.get("codec_name")
            facts["audio_channels"] = stream.get("channels")
    return facts


def _frame_text(path: Path, at: float, work: Path, index: int) -> str:
    png = work / f"frame{index}.png"
    grab = subprocess.run(
        ["ffmpeg", "-v", "quiet", "-ss", f"{at:.1f}", "-i", str(path),
         "-frames:v", "1", "-vf", "scale=960:-1", str(png)],
        capture_output=True, text=True, timeout=FFMPEG_TIMEOUT)
    if grab.returncode != 0 or not png.exists():
        return ""
    read = subprocess.run(["tesseract", str(png), "-", "--psm", "6"],
                          capture_output=True, text=True, timeout=TESSERACT_TIMEOUT)
    png.unlink(missing_ok=True)
    if read.returncode != 0:
        return ""
    lines = [ln.strip() for ln in (read.stdout or "").splitlines()]
    return "\n".join(ln for ln in lines if len(ln) > 1)


CACHE_DIR = Path("/srv/snapshot/media-probe")


PAGE_CAP = 8
PDF_DPI = 200


def _document_text(path: Path, mime: str, name: str) -> dict[str, Any]:
    ext = name.lower().rsplit(".", 1)[-1] if "." in name else ""
    if mime.startswith("image/") or ext in ("png", "jpg", "jpeg", "webp", "tif", "tiff", "bmp"):
        try:
            import pytesseract                              # noqa: PLC0415
            from PIL import Image                           # noqa: PLC0415
            words = pytesseract.image_to_string(Image.open(path))
            return {"text": (words or "").strip(), "pages": 1, "method": "tesseract"}
        except Exception as exc:  # noqa: BLE001
            return {"text": "", "pages": 0, "method": f"image failed: {type(exc).__name__}"}
    if mime == "application/pdf" or ext == "pdf":
        try:
            import pdf_gate                                 # noqa: PLC0415
            import pytesseract                              # noqa: PLC0415
            from PIL import Image                           # noqa: PLC0415
            import io                                       # noqa: PLC0415
            # through the gate: MuPDF is not safe across documents in parallel
            out, ocr_pages = [], 0
            with pdf_gate.pdf_document(path) as doc:
                for number in range(min(doc.page_count, PAGE_CAP)):
                    page = doc.load_page(number)
                    words = (page.get_text() or "").strip()
                    if len(words) < 40:
                        pix = page.get_pixmap(dpi=PDF_DPI)
                        img = Image.open(io.BytesIO(pix.tobytes("png")))
                        words = (pytesseract.image_to_string(img) or "").strip()
                        ocr_pages += 1
                    if words:
                        out.append(f"[page {number + 1}]\n{words}")
            return {"text": "\n\n".join(out).strip(),
                    "pages": len(out),
                    "method": f"pymupdf+tesseract ({ocr_pages} page(s) read as pictures)"}
        except Exception as exc:  # noqa: BLE001
            return {"text": "", "pages": 0, "method": f"pdf failed: {type(exc).__name__}"}
    return {"text": "", "pages": 0, "method": "not a document this path reads"}


def probe_document(file_id: str, pages: int = PAGE_CAP) -> dict[str, Any]:
    was = _cached("doc-" + file_id)
    if was:
        was["from_cache"] = True
        return was
    if not _LOCK.acquire(blocking=False):
        return {"ok": False, "reason": "another probe is running — try again shortly"}
    work = Path(tempfile.mkdtemp(prefix="docprobe-"))
    blob = work / "doc"
    try:
        meta = _download(file_id, blob)
        got = _document_text(blob, str(meta.get("mimeType") or ""), str(meta.get("name") or ""))
        out = {"ok": bool(got["text"]), "file_name": meta.get("name", ""),
               "mime": meta.get("mimeType", ""), "bytes": int(meta.get("size") or 0),
               "facts": {"pages_read": got["pages"], "how": got["method"]},
               "frames": [], "text": got["text"], "chars": len(got["text"])}
        if out["ok"]:
            _remember("doc-" + file_id, out)
        else:
            out["reason"] = got["method"]
        return out
    except Exception as exc:  # noqa: BLE001
        log.warning("[doc-probe] %s: %r", file_id, exc)
        return {"ok": False, "reason": f"{type(exc).__name__}: {str(exc)[:200]}"}
    finally:
        shutil.rmtree(work, ignore_errors=True)
        _LOCK.release()


def cached(file_id: str) -> dict[str, Any] | None:
    return _cached(file_id)


def _cached(file_id: str) -> dict[str, Any] | None:
    try:
        got = json.loads((CACHE_DIR / f"{file_id}.json").read_text())
        return got if got.get("ok") else None
    except Exception:  # noqa: BLE001
        return None


def _remember(file_id: str, got: dict[str, Any]) -> None:
    if not got.get("ok"):
        return
    try:
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        (CACHE_DIR / f"{file_id}.json").write_text(json.dumps(got))
    except Exception as exc:  # noqa: BLE001
        log.warning("[media-probe] could not remember %s: %r", file_id, exc)


_INFLIGHT: set[str] = set()


def start_background(file_id: str, frames: int = 6) -> bool:
    if file_id in _INFLIGHT or _cached(file_id):
        return False
    _INFLIGHT.add(file_id)

    def run() -> None:
        try:
            probe(file_id, frames)
        finally:
            _INFLIGHT.discard(file_id)

    threading.Thread(target=run, name=f"probe-{file_id[:8]}", daemon=True).start()
    return True


def waiting(file_id: str) -> bool:
    return file_id in _INFLIGHT


def probe(file_id: str, frames: int = 6) -> dict[str, Any]:
    frames = max(1, min(int(frames or 6), MAX_FRAMES))
    was = _cached(file_id)
    if was:
        was["from_cache"] = True
        return was
    if not _LOCK.acquire(blocking=False):
        return {"ok": False, "reason": "another probe is running — try again shortly"}
    work = Path(tempfile.mkdtemp(prefix="mediaprobe-"))
    clip = work / "clip"
    try:
        meta = _download(file_id, clip)
        facts = _ffprobe(clip)
        seconds = float(facts.get("seconds") or 0)
        shots: list[dict[str, Any]] = []
        seen: set[str] = set()
        if seconds > 0:
            # both ends first (title card, filled-in form); 5%, not 0, because a clip opens on black
            spread = [0.05, 0.95, 0.5, 0.25, 0.75, 0.12, 0.62, 0.88][:frames]
            marks = sorted(min(seconds * f, max(seconds - 0.5, 0.5)) for f in spread)
        else:
            marks = [1.0]
        for i, at in enumerate(marks):
            text = _frame_text(clip, at, work, i)
            if not text:
                continue
            key = "".join(sorted(set(text.lower().split())))[:400]
            if key in seen:
                continue
            seen.add(key)
            shots.append({"at": round(at, 1), "text": text})
        joined = "\n\n".join(f"[{s['at']}s]\n{s['text']}" for s in shots)
        got = {"ok": True, "file_name": meta.get("name", ""),
               "mime": meta.get("mimeType", ""), "bytes": int(meta.get("size") or 0),
               "facts": facts, "frames": shots, "text": joined,
               "chars": len(joined)}
        _remember(file_id, got)
        return got
    except Exception as exc:  # noqa: BLE001 — a tool reports, it does not crash the relay
        log.warning("[media-probe] %s: %r", file_id, exc)
        return {"ok": False, "reason": f"{type(exc).__name__}: {str(exc)[:200]}"}
    finally:
        shutil.rmtree(work, ignore_errors=True)
        _LOCK.release()


def available() -> dict[str, Any]:
    return {"ffmpeg": bool(shutil.which("ffmpeg")),
            "ffprobe": bool(shutil.which("ffprobe")),
            "tesseract": bool(shutil.which("tesseract"))}
