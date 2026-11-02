"""A RÉSUMÉ THAT IS A SCAN, READ ONCE BY OCR — Staff Candidates › Resume.
asa-hub-app owes this lane the résumé files that read as a scan (a PDF with no text layer, or a picture) in
app.resume_texts; the lane takes each file from Drive as the platform's own account, reads its words with Tesseract (the
relay's reader) and keeps them there, where asa-hub-app parses them as it parses any résumé's text. A résumé the relay
files itself is kept read at once (keep_read). A failure is kept with its error and tried again, never 'read'."""
from __future__ import annotations

import contextlib
import json
import logging
import os
import re
import sys
import tempfile
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import psycopg2.extras

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import mar_papers as mp  # noqa: E402 — the lanes' door into asa-hub-db, and the drive's bytes

log = logging.getLogger("hub.resume_texts")

PASS_S = float(os.getenv("HUB_RESUME_TEXTS_PASS_S", "60"))
BUDGET_S = float(os.getenv("HUB_RESUME_TEXTS_BUDGET_S", "180"))
BATCH = 5
RETRY_FIRST_S = 900.0
RETRY_MAX_S = 86400.0
MAX_BYTES = 15 * 1024 * 1024
TEXT_MAX = 60000
EXT_OF = {"application/pdf": ".pdf", "image/png": ".png", "image/jpeg": ".jpg", "image/gif": ".gif",
          "image/webp": ".webp", "image/heic": ".heic", "image/heif": ".heif", "image/tiff": ".tif"}


def _t() -> str:
    return mp._t("resume_texts")


def _retry_s(attempts: int) -> float:
    return min(RETRY_MAX_S, RETRY_FIRST_S * (2 ** max(0, attempts - 1)))


def ocr(data: bytes, name: str, mime: str) -> tuple[str, int]:
    """The file's words by the relay's reader (a PDF's pages without words, and a picture, through Tesseract)."""
    import form_digest as fd  # noqa: PLC0415 — the relay's reader, loaded with the lane
    ext = Path(name).suffix.lower() or EXT_OF.get(mime, "")
    handle, path = tempfile.mkstemp(suffix=ext, prefix="resume_")
    try:
        with os.fdopen(handle, "wb") as fh:
            fh.write(data)
        kind = fd.digest_kind(path)
        if kind not in ("pdf", "image"):
            raise mp.Unread(f"a {ext or 'file'} of this kind is not read by OCR")
        text = re.sub(r"\n{3,}", "\n\n", (fd.extract_text(path) or "").replace("\x00", "")).strip()
        pages = 1
        if kind == "pdf":
            with contextlib.suppress(Exception):
                import fitz  # noqa: PLC0415
                with fitz.open(path) as doc:
                    pages = doc.page_count
        return text[:TEXT_MAX], pages
    finally:
        with contextlib.suppress(OSError):
            os.unlink(path)


def read_one(drive: Any, file_id: str) -> dict[str, Any]:
    """One owed file: its modified time, its words and its pages; Unread when it cannot be read now."""
    try:
        meta = drive.files().get(fileId=file_id, fields="id,name,mimeType,modifiedTime,size,trashed",
                                 supportsAllDrives=True).execute()
    except Exception as exc:  # noqa: BLE001
        code = getattr(getattr(exc, "resp", None), "status", 0)
        raise mp.Unread("the file is not in the drive the platform's account reads" if code == 404
                        else f"Drive did not answer ({type(exc).__name__})") from None
    if meta.get("trashed"):
        raise mp.Unread("the file is in the drive's trash")
    data = mp._bytes(drive, file_id, MAX_BYTES)
    text, pages = ocr(data, str(meta.get("name") or "resume"), str(meta.get("mimeType") or ""))
    if not text:
        raise mp.Unread("no words could be read from the scan")
    return {"modified_time": str(meta.get("modifiedTime") or ""), "text": text, "pages": pages}


def keep_read(file_id: str, modified_time: str, candidate: str, text: str, pages: int = 0) -> bool:
    """A résumé's words the relay already read (it filed the file itself), kept read at once; False when not kept."""
    if not mp.DSN or not file_id or not text.strip():
        return False
    now = datetime.now(timezone.utc)
    try:
        with contextlib.closing(mp._connect(mp.DSN)) as conn, conn, conn.cursor() as cur:
            cur.execute(f"insert into {_t()} (file_id, modified_time, candidate, state, text, chars, pages, attempts,"
                        " read_at, updated_at) values (%s, %s, %s, 'read', %s, %s, %s, 1, %s, %s)"
                        " on conflict (file_id) do update set modified_time = excluded.modified_time, state = 'read',"
                        " text = excluded.text, chars = excluded.chars, pages = excluded.pages, error = '',"
                        " read_at = excluded.read_at, updated_at = excluded.updated_at",
                        (file_id, modified_time, candidate, text[:TEXT_MAX], len(text[:TEXT_MAX]), pages, now, now))
        return True
    except Exception as exc:  # noqa: BLE001 — the lane reads it when the app owes it
        log.warning("resume texts: %s not kept (%s)", file_id, type(exc).__name__)
        return False


def drain(conn, drive: Any, deadline: float) -> dict[str, int]:
    """The files owed, oldest due first, until the deadline."""
    got = {"read": 0, "failed": 0}
    while time.monotonic() < deadline:
        with conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(f"select file_id, attempts from {_t()} where state <> 'read' and next_try_at <= now()"
                        " order by next_try_at, file_id limit %s", (BATCH,))
            rows = [dict(r) for r in cur.fetchall()]
        if not rows:
            break
        for row in rows:
            if time.monotonic() >= deadline:
                break
            started, now = time.monotonic(), datetime.now(timezone.utc)
            try:
                read = read_one(drive, row["file_id"])
            except Exception as exc:  # noqa: BLE001 — the type only: a message may carry the résumé's words
                why = str(exc) if isinstance(exc, mp.Unread) else f"the reading stopped ({type(exc).__name__})"
                attempts = int(row.get("attempts") or 0) + 1
                with conn, conn.cursor() as cur:
                    cur.execute(f"update {_t()} set state = 'failed', error = %s, attempts = %s, next_try_at = %s,"
                                " updated_at = %s where file_id = %s",
                                (why[:300], attempts, now + timedelta(seconds=_retry_s(attempts)), now,
                                 row["file_id"]))
                log.info("resume texts: %s not read (attempt %d): %s", row["file_id"], attempts, why[:160])
                got["failed"] += 1
                continue
            with conn, conn.cursor() as cur:
                cur.execute(f"update {_t()} set state = 'read', modified_time = %s, text = %s, chars = %s, pages = %s,"
                            " error = '', attempts = attempts + 1, read_at = %s, seconds = %s, updated_at = %s"
                            " where file_id = %s",
                            (read["modified_time"], read["text"], len(read["text"]), read["pages"], now,
                             round(time.monotonic() - started, 1), now, row["file_id"]))
            got["read"] += 1
    return got


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    if not mp.DSN or os.getenv("HUB_RESUME_TEXTS", "on").strip().lower() in ("off", "0", "no"):
        log.warning("resume texts: no asa-hub-db door, or switched off — the lane is idle")
        while True:
            time.sleep(3600)
    import cert_papers as CP  # noqa: PLC0415 — the platform account's Drive
    log.info("resume texts keeper up (a pass every %.0fs)", PASS_S)
    conn = None
    while True:
        started = time.monotonic()
        try:
            if conn is None or conn.closed:
                conn = mp._connect(mp.DSN)
            said = drain(conn, CP.owner_drive(), started + BUDGET_S)
            if said["read"] or said["failed"]:
                log.info("resume texts pass: %s", json.dumps(said))
        except Exception as exc:  # noqa: BLE001 — never self-disables; the next pass retries
            log.warning("resume texts pass failed (%s: %.120s)", type(exc).__name__,
                        str(exc).splitlines()[0] if str(exc) else "")
            with contextlib.suppress(Exception):
                if conn is not None:
                    conn.close()
            conn = None
        time.sleep(max(15.0, PASS_S - (time.monotonic() - started)))


if __name__ == "__main__":
    main()
