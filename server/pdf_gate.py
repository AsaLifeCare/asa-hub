"""The one door into MuPDF: threads parsing PDFs in parallel corrupt its per-process heap, so every open goes here."""
from __future__ import annotations

import contextlib
import logging
import threading
from typing import Any, Iterator

log = logging.getLogger("hub.pdfgate")

# re-entrant: a decoder may open a page inside an outer document read
_MUPDF = threading.RLock()

ACQUIRE_TIMEOUT_S = 120.0


class PdfBusy(RuntimeError):
    """The door did not open in time; retry the item later."""


@contextlib.contextmanager
def pdf_lock(what: str = "") -> Iterator[None]:
    got = _MUPDF.acquire(timeout=ACQUIRE_TIMEOUT_S)
    if not got:
        raise PdfBusy(f"MuPDF was busy for {ACQUIRE_TIMEOUT_S:.0f}s{' · ' + what if what else ''}")
    try:
        yield
    finally:
        _MUPDF.release()


@contextlib.contextmanager
def pdf_document(src: Any, **kw: Any) -> Iterator[Any]:
    """The document must not escape the block: an open document shares the same heap."""
    import fitz

    # fitz.open takes only a path positionally; bytes and file objects go in as a stream
    if isinstance(src, (bytes, bytearray, memoryview)):
        kw.setdefault("filetype", "pdf")
        opened = {"stream": bytes(src)}
    elif hasattr(src, "read"):
        kw.setdefault("filetype", "pdf")
        opened = {"stream": src.read()}
    else:
        opened = {"filename": str(src)}

    with pdf_lock(str(src)[:80]):
        doc = fitz.open(**opened, **kw)
        try:
            yield doc
        finally:
            try:
                doc.close()
            except Exception:  # noqa: BLE001
                log.debug("pdf close failed for %.80s", str(src))
