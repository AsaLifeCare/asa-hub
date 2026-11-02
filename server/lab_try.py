"""The Decoder lab's Try: one Drive document read both ways (the ordinary reading and the sharp one), each judged by the
engine, and nothing moved. Asked by the relay's POST /digest/try and by asa-hub-worker's (hub_worker.py), which the
app's /digest/try forwards to; both images carry tesseract."""
from __future__ import annotations

import importlib
import os
import time
from typing import Any


def read(file_id: str, name: str) -> dict[str, Any]:
    """Blocking: the lab's answer for one file, in the relay's words."""
    fd = importlib.import_module("form_digest")
    ev = importlib.import_module("engine_verdict")
    try:
        sr = importlib.import_module("sharp_read")
    except Exception:  # noqa: BLE001 — the ordinary reading still answers
        sr = None
    hr = importlib.import_module("hub_rows")
    drive, _sheets = fd._clients()
    # asa-hub-db's copy, never a sheet read from Google: one that cannot answer refuses the Try before any download
    try:
        roster = fd._roster_rows()
    except hr.Unreadable as exc:
        return {"status": 503, "message": f"the roster could not be read from asa-hub-db ({str(exc)[:160]})"}
    t0 = time.monotonic()
    path = fd._download(drive, file_id, name)
    kind = fd.digest_kind(path)
    plain = fd.extract_text(path) if kind != "unsupported" else ""
    t_plain = round(time.monotonic() - t0, 1)
    out: dict[str, Any] = {
        "status": 200, "file_id": file_id, "file_name": name,
        "kind": kind,
        "ordinary": {"chars": len(plain), "seconds": t_plain,
                     "text": plain[:20000]},
    }
    t1 = time.monotonic()
    out["ordinary"]["verdict"] = ev.verdict(name, plain, roster) or {}
    out["ordinary"]["verdict_seconds"] = round(time.monotonic() - t1, 1)
    if sr is not None and kind in ("image", "pdf"):
        t2 = time.monotonic()
        got = (sr.read_pdf_page_images(path, plain) if kind == "pdf"
               else sr.read_image(path, plain))
        out["sharp"] = {
            "chars": len(got.get("text") or ""), "pass": got.get("pass"),
            "psm": got.get("psm"), "score": got.get("score"),
            "seconds": got.get("seconds", round(time.monotonic() - t2, 1)),
            "tried": got.get("tried") or [],
            "text": (got.get("text") or "")[:20000],
        }
        if got.get("pass") != "floor":
            out["sharp"]["verdict"] = ev.verdict(name, got.get("text") or "", roster) or {}
    try:
        os.unlink(path)
    except OSError:
        pass
    return out
