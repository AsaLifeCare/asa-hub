#!/usr/bin/env python3
"""Mask SSNs already filed in the text_file archives; the mask keeps the width so text offsets stay valid."""
from __future__ import annotations

import hashlib
import io
import logging
import os
import re
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import form_digest as fd  # noqa: E402
from googleapiclient.http import MediaIoBaseDownload, MediaIoBaseUpload  # noqa: E402

log = logging.getLogger("hub.maskfiled")

STRICT = re.compile(r"\b\d{3}[\s\-.]\d{2}[\s\-.]\d{4}\b")
LOOSE = re.compile(r"\b\d{3}[\s\-.]\d{3}[\s\-.]\d{4}\b")
NEAR = re.compile(r"(social\s*security|\bssn\b|soc\.?\s*sec|"
                  r"this\s+number\s+has\s+been\s+established)", re.I)
PHONE = re.compile(r"(phone|tel|fax|call|contact|cell)", re.I)
TOLL_FREE = {"800", "888", "877", "866", "855", "844", "833", "822"}


def never_issued(raw: str) -> bool:
    area = re.sub(r"\D", "", raw)[:3]
    return area in TOLL_FREE or area in ("000", "666") or area >= "900"


def hide(raw: str) -> str:
    return re.sub(r"\d", "*", raw[:-4]) + raw[-4:]


def mask(text: str) -> tuple[str, list[str]]:
    hit: list[str] = []

    def strict(m: re.Match) -> str:
        if never_issued(m.group(0)):
            return m.group(0)
        hit.append(m.group(0))
        return hide(m.group(0))

    out = STRICT.sub(strict, text)

    def loose(m: re.Match) -> str:
        if never_issued(m.group(0)):
            return m.group(0)
        near = out[max(0, m.start() - 70):m.end() + 70]
        if not NEAR.search(near):
            return m.group(0)
        if PHONE.search(out[max(0, m.start() - 30):m.start()]):
            return m.group(0)
        hit.append(m.group(0))
        return hide(m.group(0))

    return LOOSE.sub(loose, out), hit


def _archive_ids(sheets) -> list[tuple[str, str]]:
    out: list[tuple[str, str]] = []
    for led in fd.LEDGERS:
        house = fd._house_id(led["ptr"])
        if not house:
            log.warning("%s: no house pointer", led["res"])
            continue
        head = (sheets.spreadsheets().values().get(
            spreadsheetId=house, range=f"'{led['tab']}'!A1:BZ1"
        ).execute().get("values") or [[]])[0]
        head = [str(h) for h in head]
        if "text_file" not in head:
            continue
        col = fd._col_letter(head.index("text_file")) if hasattr(fd, "_col_letter") else None
        if not col:
            i = head.index("text_file") + 1
            col = ""
            while i:
                i, r = divmod(i - 1, 26)
                col = chr(65 + r) + col
        got = sheets.spreadsheets().values().get(
            spreadsheetId=house, range=f"'{led['tab']}'!{col}1:{col}20000",
            majorDimension="COLUMNS").execute().get("values") or [[]]
        for fid in (got[0][1:] if got else []):
            fid = str(fid).strip()
            if fid:
                out.append((led["res"], fid))
    seen: set[str] = set()
    return [(r, f) for r, f in out if not (f in seen or seen.add(f))]


def _read(drive, fid: str) -> str:
    buf = io.BytesIO()
    dl = MediaIoBaseDownload(buf, drive.files().get_media(fileId=fid))
    done = False
    while not done:
        _, done = dl.next_chunk()
    return buf.getvalue().decode("utf-8", "replace")


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    dry = "--dry-run" in sys.argv
    limit = 0
    if "--limit" in sys.argv:
        limit = int(sys.argv[sys.argv.index("--limit") + 1])
    drive, sheets = fd._clients()
    files = _archive_ids(sheets)
    if limit:
        files = files[:limit]
    log.info("%d archive file(s) to walk%s", len(files), " (dry run)" if dry else "")
    changed = numbers = unreadable = refused = 0
    for n, (res, fid) in enumerate(files, start=1):
        try:
            text = _read(drive, fid)
        except Exception as exc:  # noqa: BLE001
            unreadable += 1
            log.warning("%s: unreadable (%.80s)", fid, str(exc))
            continue
        out, hit = mask(text)
        if not hit:
            continue
        if len(out) != len(text):
            refused += 1
            log.warning("%s: the mask would change the width — refused", fid)
            continue
        numbers += len(hit)
        changed += 1
        log.info("%s (%s): %d number(s)", fid, res, len(hit))
        if dry:
            continue
        raw = out.encode("utf-8")
        # verified by Drive's md5 of the write: an immediate re-read can serve the old bytes
        got = drive.files().update(
            fileId=fid,
            media_body=MediaIoBaseUpload(io.BytesIO(raw),
                                         mimetype="text/markdown", resumable=False),
            fields="md5Checksum,size").execute()
        if str(got.get("md5Checksum") or "") != hashlib.md5(raw).hexdigest():
            log.error("%s: what Drive stored is not what was sent — stopping", fid)
            raise SystemExit(1)
        time.sleep(0.1)
        if n % 200 == 0:
            log.info("... %d/%d walked, %d file(s) changed", n, len(files), changed)
    log.info("done: %d file(s) walked, %d changed, %d number(s) masked, "
             "%d unreadable, %d refused", len(files), changed, numbers, unreadable, refused)


if __name__ == "__main__":
    main()
