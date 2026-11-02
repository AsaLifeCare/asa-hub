"""COMPLIANCE DOCUMENTS — EVERY FILED CERTIFICATE READ HERE, NEVER BY APPS SCRIPT.
A paper on the cert_uploads ledger still to read is taken from the drive, its words read with Tesseract, and the
decoder's reading, translated to Python (digest_engine), tells its kind and dates; the reading is kept in asa-hub-db
(app.cert_reads), and asa-hub-app lays the verdict over the ledger row (app/cert_reads.py)."""
from __future__ import annotations

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

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import hub_rows  # noqa: E402
import mar_papers as MP  # noqa: E402 — the drive, the bytes and the store's door, shared with the MARS lane

log = logging.getLogger("hub.cert_reads")

DSN = MP.DSN
MIRROR_DSN = MP.MIRROR_DSN
SCHEMA = os.getenv("HUB_CERT_READS_SCHEMA", "app").strip() or "app"
# hubTabEnsure_('cert_uploads') files the ledger in HUB_DB; the requirements live in their own book's Data tab
LEDGER_BOOK = os.getenv("HUB_CERT_LEDGER_BOOK", "1SGC3fDFJsraqLXzHgUGRARe5n_IkguyBsTD4bze36ts").strip()
LEDGER_TAB = "cert_uploads"
# db/cert_uploads_ledger.sql: the ledger's rows once kept in app.resource_rows (certUploads)
LEDGER_VIEW = "cert_uploads_ledger"
REQUIREMENTS_BOOK = os.getenv("HUB_REQUIREMENTS_BOOK", "1L-e5lnt1gSHCmVUgamLlH1gH9jV2nxZw3Pnf7OQmEb8").strip()
REQUIREMENTS_TAB = "Data"
VOCAB_BOOK = os.getenv("HUB_GENERIC_CONFIG_ID", "1Ky7FPu876WavnMTzsO6zejDXtI1I4b2xebuMdsBMMgg").strip()
VOCAB_TABS = ("Digest Kinds", "Digest Categories", "Digest Expects", "Digest Labels", "Digest Issuers",
              "Digest Drawers", "Digest Zip", "Digest Settings", "Form File Types", "Digest Answer Facts",
              "Digest Credentials")
FOLDER = "Compliance Docs"
MAX_BYTES = 15 * 1024 * 1024
PASS_S = float(os.getenv("HUB_CERT_READS_PASS_S", "60"))
BUDGET_S = float(os.getenv("HUB_CERT_READS_BUDGET_S", "120"))
# ComplianceDocs.gs CERT_READ_KINDS: the paper each requirement is, whose seed words the reading adds to the book's
CERT_READ_KINDS = {
    "dodd": ["dodd_certification"], "cpr": ["cpr_first_aid"],
    "med1": ["med_admin_cert"], "med2": ["med_admin_cert"], "med3": ["med_admin_cert"],
    "mandt": ["crisis_prevention"], "driver_license": ["drivers_licence", "state_id"],
    "car_insurance": ["auto_insurance"], "drive_abstract": ["driver_abstract"],
    "i9_type_1": ["drivers_licence", "state_id", "passport", "work_authorization", "ssn_card", "birth_certificate"],
    "i9_type_2": ["drivers_licence", "state_id", "passport", "work_authorization", "ssn_card", "birth_certificate"],
}
HEIC = re.compile(r"(^image/hei[cf]$)|(\.hei[cf]$)", re.I)

# test hooks: the ledger, the requirements and the words book as the mirror holds them; the paper's words
MIRROR_READER: Callable[[], dict[str, Any]] | None = None
TEXT_READER: Callable[[Any, str, str, str], str] | None = None

# the paper could not be read now: the row says why and is tried again later (the MARS lane's own, so its bytes count)
Unread = MP.Unread


def _t(name: str) -> str:
    if not re.fullmatch(r"[a-z_][a-z0-9_]{0,62}", SCHEMA):
        raise RuntimeError("the certificate reads schema is not a plain name")
    return f"{SCHEMA}.{name}"


def _fold(v: Any) -> str:
    """hubNameFold_."""
    return re.sub(r"[^a-z0-9]+", "", str(v or "").lower())


def _file_id(row: dict[str, Any]) -> str:
    """complianceDocsFileIdOf_."""
    own = str(row.get("file_id") or row.get("fileid") or "").strip()
    if own:
        return own
    m = re.search(r"/file/d/([A-Za-z0-9_-]{10,})", str(row.get("url") or ""))
    return m.group(1) if m else ""


# ── the books, as the relay's copy holds them ─────────────────────────────────────────────────────────────────────

def _tab(sheet_id: str, tab: str) -> list[dict[str, Any]]:
    return [d for d in hub_rows.rows(sheet_id, tab) if isinstance(d, dict)]


def _vocab_rows(rows: list[dict[str, Any]]) -> list[dict[str, str]]:
    """digestVocabRows_: each header folded to a_b, each cell trimmed text, rows of nothing dropped."""
    out = []
    for r in rows:
        row = {re.sub(r"[^a-z0-9]+", "_", str(h).strip().lower()): str("" if v is None else v).strip()
               for h, v in r.items() if str(h).strip()}
        if any(row.values()):
            out.append(row)
    return out


def _ledger(conn: Any) -> list[dict[str, Any]]:
    """The ledger's rows: its own table in asa-hub-db once kept there (the view this role may read, nothing else of
    app.resource_rows — one row with no key while it holds none), else the relay's copy."""
    if conn is None:
        return _tab(LEDGER_BOOK, LEDGER_TAB)
    with conn, conn.cursor() as cur:
        cur.execute(f"select row_key, cells from {_t(LEDGER_VIEW)} order by position, created_at, row_key")
        got = cur.fetchall()
    if not got:
        return _tab(LEDGER_BOOK, LEDGER_TAB)
    return [c if isinstance(c, dict) else json.loads(c or "{}") for k, c in got if k is not None]


def books(conn: Any = None) -> dict[str, Any]:
    """The ledger (its own table once kept there), the requirements and the words book, from the relay's own copy of
    the sheets."""
    if MIRROR_READER is not None:
        return MIRROR_READER()
    ledger = _ledger(conn)
    reqs = _tab(REQUIREMENTS_BOOK, REQUIREMENTS_TAB)
    vocab: dict[str, Any] = {t: _vocab_rows(_tab(VOCAB_BOOK, t)) for t in VOCAB_TABS}
    vocab["__v"] = "mirror"
    return {"ledger": ledger, "requirements": reqs, "vocab": vocab}


def expected(row: dict[str, Any], reqs: list[dict[str, Any]]) -> list[str]:
    """CERT_READ_KINDS of the row's requirement: its own id, else the one enabled requirement its label folds to."""
    rid = str(row.get("req_id") or "").strip()
    if not rid:
        key = _fold(row.get("cert"))
        hits = [r for r in reqs if str(r.get("enabled") or "").strip().lower() == "yes" and _fold(r.get("label")) == key]
        rid = str(hits[0].get("req_id") or "").strip() if key and len(hits) == 1 else ""
    return list(CERT_READ_KINDS.get(rid, []))


# ── the reading ───────────────────────────────────────────────────────────────────────────────────────────────────

def filed_here(drive: Any, meta: dict[str, Any]) -> bool:
    """complianceDocsFiledHere_: the file sits in Compliance Docs/<cert>."""
    for parent in meta.get("parents") or []:
        try:
            up = drive.files().get(fileId=parent, fields="parents", supportsAllDrives=True).execute()
        except Exception as exc:  # noqa: BLE001 — a lookup that failed reads again
            raise Unread(f"the folder could not be checked ({type(exc).__name__})") from None
        for grand in up.get("parents") or []:
            try:
                g = drive.files().get(fileId=grand, fields="name", supportsAllDrives=True).execute()
            except Exception as exc:  # noqa: BLE001
                raise Unread(f"the folder could not be checked ({type(exc).__name__})") from None
            if str(g.get("name") or "").strip() == FOLDER:
                return True
    return False


def paper_text(drive: Any, file_id: str, name: str, mime: str) -> str:
    """The paper's words: its own where it has them, Tesseract where it is a scan (form_digest's reader)."""
    if TEXT_READER is not None:
        return TEXT_READER(drive, file_id, name, mime)
    import form_digest as fd  # noqa: PLC0415 — the relay's reader, loaded with the lane
    raw = MP._bytes(drive, file_id, MAX_BYTES)
    ext = Path(name).suffix.lower() or MP.MIME_EXT.get(mime, "")
    handle, path = tempfile.mkstemp(suffix=ext, prefix="cert_")
    try:
        with os.fdopen(handle, "wb") as fh:
            fh.write(raw)
        if fd.digest_kind(path) in ("unsupported", "unknown"):
            raise Unread(f"a {ext or 'file'} of this kind cannot be read")
        return fd.extract_text(path)
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass


def engine_paper(text: str, name: str, expect: list[str], vocab: dict | None, roster: dict | None,
                 today: str) -> dict[str, Any]:
    """digestPaperFromText_ under certReadVocab_ (ComplianceDocs.gs), and what the verdict's confidence needs from
    that same book — read by the decoder's Python translation (digest_engine), never by Node."""
    try:
        import digest_engine as DE  # noqa: PLC0415 — the decoder, loaded with the lane
        return DE.cert_reading(text, name, today, expect, vocab, roster or {})
    except Exception as exc:  # noqa: BLE001 — the type only: a message may carry the paper's words
        raise Unread(f"the engine did not read the words ({type(exc).__name__})") from None


def read_one(drive: Any, row: dict[str, Any], held: dict[str, Any], roster: dict | None) -> dict[str, Any]:
    """One ledger row's reading: a paper outside the folder or a HEIC photo says so; else its words, then the engine."""
    started = time.monotonic()
    file_id = _file_id(row)
    try:
        meta = drive.files().get(fileId=file_id, fields="id,name,mimeType,size,trashed,parents",
                                 supportsAllDrives=True).execute()
    except Exception as exc:  # noqa: BLE001
        if getattr(getattr(exc, "resp", None), "status", 0) == 404:
            raise Unread("the file is no longer in the drive") from None
        raise Unread(f"Drive did not answer ({type(exc).__name__})") from None
    name = str(row.get("name") or meta.get("name") or "file")
    mime = str(meta.get("mimeType") or "")
    if meta.get("trashed"):
        raise Unread("the file is in the drive's trash")
    if not filed_here(drive, meta):
        reading = {"paper": {"state": "stray", "chars": 0}}
    elif HEIC.search(mime) or HEIC.search(name):
        # complianceDocsReadRow_: a HEIC photo gives the decoder no words
        reading = {"paper": {"state": "heic", "chars": 0}}
    else:
        text = re.sub(r"\n{3,}", "\n\n", (paper_text(drive, file_id, name, mime) or "").replace("\x00", "")).strip()
        today = datetime.now(timezone(timedelta(hours=-4))).strftime("%Y-%m-%d")
        reading = engine_paper(text, name, expected(row, held["requirements"]), held["vocab"], roster, today)
    reading["seconds"] = round(time.monotonic() - started, 1)
    return reading


# ── the lane ──────────────────────────────────────────────────────────────────────────────────────────────────────

def due_rows(ledger: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """The ledger's papers still to read (complianceDocsReadRow_ reads what is not read or unread), with a file."""
    return [r for r in ledger if str(r.get("read_state") or "").strip().lower() in ("", "pending")
            and str(r.get("id") or "").strip() and _file_id(r)]


def queue(conn, rows: list[dict[str, Any]], now: datetime) -> int:
    with conn, conn.cursor() as cur:
        for r in rows:
            cur.execute(
                f"insert into {_t('cert_reads')} (row_id, file_id, next_try_at, updated_at) values (%s, %s, %s, %s)"
                " on conflict (row_id) do update set file_id = excluded.file_id, state = 'pending', reading = null,"
                " attempts = 0, error = '', next_try_at = excluded.next_try_at, updated_at = excluded.updated_at"
                f" where {_t('cert_reads')}.file_id <> excluded.file_id",
                (str(r["id"]).strip(), _file_id(r), now, now))
    return len(rows)


def drain(conn, drive: Any, held: dict[str, Any], roster: dict | None, deadline: float) -> dict[str, int]:
    """The papers owed a reading until the deadline; a failure is kept with its error and tried again, never read."""
    by_id = {str(r.get("id") or "").strip(): r for r in held["ledger"]}
    got = {"read": 0, "failed": 0}
    with conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(f"select row_id, file_id, attempts, reading from {_t('cert_reads')}"
                    " where state <> 'read' and next_try_at <= now() order by next_try_at, row_id limit 50")
        rows = [dict(r) for r in cur.fetchall()]
    for row in rows:
        if time.monotonic() >= deadline:
            break
        now = datetime.now(timezone.utc)
        # a paper Python filed is on the ledger Python keeps, not on this copy: its own line was kept with it
        kept = row.pop("reading", None)
        line = by_id.get(row["row_id"]) or (kept.get("line") if isinstance(kept, dict) else None)
        try:
            if line is None or _file_id(line) != row["file_id"]:
                raise Unread("the ledger no longer files this paper")
            reading = read_one(drive, line, held, roster)
        except Unread as why:
            _failed(conn, row, str(why), now)
            got["failed"] += 1
            continue
        except Exception as exc:  # noqa: BLE001 — the type only: a message may carry the paper's words
            _failed(conn, row, f"the reading stopped ({type(exc).__name__})", now)
            got["failed"] += 1
            continue
        with conn, conn.cursor() as cur:
            cur.execute(f"update {_t('cert_reads')} set state = 'read', reading = %s, error = '',"
                        " attempts = attempts + 1, read_at = %s, seconds = %s, updated_at = %s"
                        " where row_id = %s and file_id = %s",
                        (psycopg2.extras.Json(reading), now, reading.get("seconds"), now, row["row_id"],
                         row["file_id"]))
        got["read"] += 1
    return got


def _failed(conn, row: dict[str, Any], why: str, now: datetime) -> None:
    attempts = int(row.get("attempts") or 0) + 1
    with conn, conn.cursor() as cur:
        cur.execute(f"update {_t('cert_reads')} set state = 'failed', error = %s, attempts = %s, next_try_at = %s,"
                    " updated_at = %s where row_id = %s and file_id = %s",
                    (why[:300], attempts, now + timedelta(seconds=MP._retry_s(attempts)), now, row["row_id"],
                     row["file_id"]))
    log.info("cert reads: %s not read (attempt %d): %s", row["row_id"], attempts, why[:120])


def _due(conn) -> bool:
    with conn, conn.cursor() as cur:
        cur.execute(f"select 1 from {_t('cert_reads')} where state <> 'read' and next_try_at <= now() limit 1")
        return cur.fetchone() is not None


def one_pass(conn) -> dict[str, Any]:
    started = time.monotonic()
    held = books(conn)
    owed = due_rows(held["ledger"])
    said: dict[str, Any] = {"ledger": len(held["ledger"]), "owed": len(owed)}
    if owed:
        queue(conn, owed, datetime.now(timezone.utc))
    elif not _due(conn):
        # nothing on this copy, and no paper Python filed waits to be read again
        return said
    roster = None
    try:
        import form_digest as fd  # noqa: PLC0415 — the roster the decoder's who-is reads, from the relay's copy
        fd.PG_DSN = fd.PG_DSN or MIRROR_DSN
        roster = fd._roster_rows(None)
    except Exception as exc:  # noqa: BLE001 — a nameless reading still reads; the verdict anchors to the ledger
        log.warning("cert reads: the roster could not be read (%s)", type(exc).__name__)
    said.update(drain(conn, MP._held_drive(), held, roster, started + BUDGET_S))
    return said


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    if not DSN or os.getenv("HUB_CERT_READS", "on").strip().lower() in ("off", "0", "no"):
        log.warning("cert reads: no asa-hub-db door (HUB_HOUSE_MEDS_DSN) or switched off — the lane is idle")
        while True:
            time.sleep(3600)
    log.info("cert reads keeper up (every %.0fs)", PASS_S)
    conn = None
    while True:
        started = time.monotonic()
        try:
            if conn is None or conn.closed:
                conn = MP._connect(DSN)
            said = one_pass(conn)
            if said.get("read") or said.get("failed"):
                log.info("cert reads pass: %s", json.dumps(said))
        except Exception as exc:  # noqa: BLE001 — never self-disables; the next pass retries
            log.warning("cert reads pass failed (%s: %.120s)", type(exc).__name__,
                        str(exc).splitlines()[0] if str(exc) else "")
            try:
                if conn is not None:
                    conn.close()
            except Exception:  # noqa: BLE001
                pass
            conn = None
        time.sleep(max(15.0, PASS_S - (time.monotonic() - started)))


if __name__ == "__main__":
    main()
