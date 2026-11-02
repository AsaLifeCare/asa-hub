"""House Supplies' import desk in the app (app/house_meds_import.py): a dropped report previewed, judged and staged or
recorded, the pharmacy's Drive folder read through a stand-in Drive, and the six-hourly sweep importing only the next
trusted report, on asa-hub-db's real engine — every table a
temp copy of the lane's (HM.SCHEMA = pg_temp) inside one transaction rolled back at the end, the reports synthetic
(a period years ahead), the lane's real lock keys never taken. Prints verdicts and counts only.

Run inside asa-hub-db-sync by the in-process runner (openpyxl unpacked at /tmp/oxl there, which drv.py adds):

    RUNNER=$(mktemp -d) && cp tools/inprocess/run.sh tools/inprocess/drv.py "$RUNNER"/
    cp tools/test-house-meds-import.py "$RUNNER/test_house_meds_import.py"
    sh "$RUNNER/run.sh" "$PWD/app" "$RUNNER/test_house_meds_import.py"
"""
import logging

logging.disable(logging.CRITICAL)
import hashlib  # noqa: E402
import io  # noqa: E402
import json  # noqa: E402
import sys  # noqa: E402
import types  # noqa: E402
from datetime import date, timedelta  # noqa: E402

out: dict = {}
fails: list = []


def check(name, cond, got=None):
    out[name] = "ok" if cond else {"FAILED": got}
    if not cond:
        fails.append(name)


def report(start: date, rows: int, *, salt: str = "") -> bytes:
    """A synthetic Key Data Points workbook: one 15-day period, `rows` lines for two made-up patients."""
    import openpyxl
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "KDP"
    ws.append(list(HMI.HEADER))
    end = start + timedelta(days=14)
    for i in range(rows):
        ws.append([start, end, "Testlast", "Pat" + str(i % 2), "Dr Test", f"TESTDRUG{salt} {i} MG", 30,
                   start + timedelta(days=i % 14), start - timedelta(days=40 + i), end + timedelta(days=200), 90,
                   60, 30, "TAKE ONE", "", "", "TESTFAC", 900000 + (i % 2)])
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def kdp_name(start: date) -> str:
    return f"Key Data Points, A Brighter Dawn, {(start + timedelta(days=15)).isoformat()}_101500.xlsx"


class FakeDrive:
    def __init__(self, files, blobs, fail_list=None):
        self.files, self.blobs, self.fail_list, self.downloads = files, blobs, fail_list, []

    def list_folder(self):
        if self.fail_list:
            raise self.fail_list
        return [dict(f) for f in self.files]

    def download(self, f):
        self.downloads.append(f["id"])
        return self.blobs[f["id"]]


def folder_file(fid, name, data, rev="2031-02-01T00:00:00.000Z", md5=None):
    return {"id": fid, "name": name, "mimeType": HMI.XLSX_MIME, "size": str(len(data)),
            "md5Checksum": md5 or hashlib.md5(data).hexdigest(), "modifiedTime": rev,
            "lastModifyingUser": {"emailAddress": "pharmacy@example.org"}}


try:
    import psycopg
    from psycopg.rows import tuple_row

    import hubdb
    import house_meds as HM
    import house_meds_import as HMI

    HM.SCHEMA = "pg_temp"
    real = psycopg.connect(hubdb._dsn(), autocommit=False, connect_timeout=5, application_name="house-meds-import-check")
    other = psycopg.connect(hubdb._dsn(), autocommit=True, connect_timeout=5, application_name="house-meds-import-held")

    def count(table, where="TRUE"):
        return real.cursor(row_factory=tuple_row).execute(f"SELECT count(*) FROM pg_temp.{table} WHERE {where}").fetchone()[0]

    ACTOR = {"uid": "u-check", "label": "the check"}
    A0, B0 = date(2031, 1, 1), date(2031, 1, 16)
    a_bytes, b_bytes = report(A0, 6), report(B0, 4, salt="B")
    try:
        with real.transaction():
            with real.transaction():
                HM.make_tables(real.cursor())
            check("the lane's tables made as temp copies, empty",
                  [count(t) for t in ("hub_med_imports", "hub_med_staged", "hub_med_dispenses")] == [0, 0, 0])
            env = HMI.parse(a_bytes)
            check("the synthetic report parses: one period, six lines, two patients",
                  env.get("ok") and env["counts"] == {"lines": 6, "patients": 2, "prescriptions": 6}
                  and env["period"] == {"start": "2031-01-01", "end": "2031-01-15"}, env.get("reason"))

            # ---- a dropped file ------------------------------------------------------------------------------------
            got = HMI.preview_upload(real, name="notes.csv", data=b"a,b", actor=ACTOR)
            check("a file not named .xlsx is answered and never recorded",
                  got.get("verdict") == "invalid" and got.get("recorded") is False and got.get("layers") == ["name"]
                  and count("hub_med_imports") == 0, got)
            got = HMI.preview_upload(real, name=kdp_name(A0), data=a_bytes, actor=ACTOR)
            check("a new report is staged: verdict new, its lines and patients, nothing imported",
                  got.get("verdict") == "new" and got.get("pill") == "New" and got.get("lines") == 6
                  and got.get("patients") == 2 and got.get("stage_id", "").startswith("MS-")
                  and count("hub_med_staged") == 1 and count("hub_med_imports") == 0, got)
            staged_a = got.get("stage_id")
            got = HMI.preview_upload(real, name="Copy of " + kdp_name(A0), data=a_bytes, actor=ACTOR)
            check("the same bytes dropped again: a duplicate of the waiting file, recorded, still one staged",
                  got.get("verdict") == "duplicate" and "batch" in (got.get("layers") or [])
                  and got.get("duplicate_of") == staged_a and count("hub_med_staged") == 1
                  and count("hub_med_imports", "outcome = 'duplicate'") == 1, got)
            got = HMI.preview_upload(real, name="broken.xlsx", data=b"not a workbook", actor=ACTOR)
            check("a file that is no workbook: invalid, recorded with its reason",
                  got.get("verdict") == "invalid" and "not an .xlsx workbook" in got.get("reason", "")
                  and count("hub_med_imports", "outcome = 'invalid'") == 1, got)

            # ---- the folder ----------------------------------------------------------------------------------------
            files = [folder_file("F-A", kdp_name(A0), a_bytes), folder_file("F-B", kdp_name(B0), b_bytes),
                     {"id": "F-R", "name": "README.txt", "mimeType": "text/plain", "size": "3",
                      "modifiedTime": "2031-02-01T00:00:00.000Z"}]
            drive = FakeDrive(files, {"F-A": a_bytes, "F-B": b_bytes})
            HMI.DRIVE_FACTORY = lambda: drive
            got = HMI.folder_read(real, actor=ACTOR)
            check("the folder read: three listed, two reports, the dropped twin adopted without a download, "
                  "the new one downloaded and staged",
                  got.get("busy") is False and got.get("error") == "" and got.get("listed") == 3
                  and got.get("reports") == 2 and got.get("ignored") == 1 and got.get("staged") == 2
                  and got.get("downloaded") == 1 and drive.downloads == ["F-B"] and len(got.get("previews")) == 2
                  and count("hub_med_staged", "drive_file_id <> ''") == 2,
                  {k: got.get(k) for k in ("listed", "reports", "ignored", "staged", "downloaded", "error")})
            state = real.cursor(row_factory=tuple_row).execute(
                "SELECT value FROM pg_temp.hub_med_state WHERE key = 'folder'").fetchone()
            check("the folder footer is kept in hub_med_state",
                  state and state[0].get("listed") == 3 and state[0].get("by") == "the check", state)
            drive.downloads.clear()
            got = HMI.folder_read(real, actor=ACTOR)
            check("read again: both already staged, nothing downloaded",
                  got.get("staged") == 2 and got.get("downloaded") == 0 and not drive.downloads, got.get("staged"))
            drive.files.append(folder_file("F-C", kdp_name(date(2031, 1, 31)), b"short", md5="0" * 32))
            drive.blobs["F-C"] = b"other bytes"
            got = HMI.folder_read(real, actor=ACTOR)
            failed = real.cursor(row_factory=tuple_row).execute(
                "SELECT outcome, retry_at IS NOT NULL FROM pg_temp.hub_med_imports WHERE drive_file_id = 'F-C'"
            ).fetchall()
            check("a download whose size or md5 differs is failed, kept for a retry, never invalid",
                  got.get("failed") == 1 and failed == [("failed", False)] and drive.downloads == ["F-C"], failed)

            # ---- one reader at a time ------------------------------------------------------------------------------
            key = ("SELECT pg_try_advisory_lock(%s, hashtext('house_meds|' || %s || '|' || %s))",
                   (HM.LOCK_NS, HMI.FOLDER_KEY, HM.SCHEMA))
            held = other.execute(*key).fetchone()[0]
            got = HMI.folder_read(real, actor=ACTOR)
            check("while another session holds the folder: busy, nothing listed",
                  held is True and got == {"busy": True, "by": "another reader"}, got)
            other.execute("SELECT pg_advisory_unlock(%s, hashtext('house_meds|' || %s || '|' || %s))",
                          (HM.LOCK_NS, HMI.FOLDER_KEY, HM.SCHEMA))
            mine = other.execute(*key).fetchone()[0]
            other.execute("SELECT pg_advisory_unlock(%s, hashtext('house_meds|' || %s || '|' || %s))",
                          (HM.LOCK_NS, HMI.FOLDER_KEY, HM.SCHEMA))
            check("a finished read lets the folder go", mine is True, mine)
            with real.transaction():
                cur = real.cursor(row_factory=tuple_row)
                cur.execute("SET LOCAL search_path TO app")
                same = cur.execute("SELECT hashtext('house_meds|folder|' || current_schema()) = "
                                   "hashtext('house_meds|folder|' || %s)", ("app",)).fetchone()[0]
            check("the folder key is the relay's own (its role's schema is app): the sweep and the app exclude "
                  "each other", same is True)

            # ---- the six-hourly sweep (app/clocks.py house_meds_loop) ---------------------------------------------
            from psycopg.rows import dict_row
            HM.CLIENTS_READER = lambda: ([], "")
            with real.transaction():
                cur = real.cursor(row_factory=dict_row)
                HM._lane(cur)
                res = HM.commit(cur, [staged_a], actor=ACTOR)
            check("a person imports the first report (a folder file): the pharmacy's uploader is trusted",
                  res["results"][0].get("verdict") == "imported"
                  and count("hub_med_imports", "outcome = 'imported' AND source = 'folder'") == 1, res["results"])
            check("the sweep is due: it never ran", HMI.sweep_due(real) is True)
            drive.downloads.clear()
            got = HMI.sweep(real, None)
            check("the sweep reads the folder as the sweep and imports the next trusted report, nothing else",
                  len(got.get("imported") or []) == 1 and got["read"].get("busy") is False
                  and count("hub_med_imports", "outcome = 'imported' AND source = 'sweep'") == 1
                  and count("hub_med_staged", "drive_file_id = 'F-B'") == 0
                  and count("hub_med_dispenses") == 10, got)
            check("the sweep's footer is kept, and it is not due again for six hours",
                  HMI.sweep_due(real) is False and HMI.sweep_due(real, now=__import__("time").time() + HMI.SWEEP_S + 1)
                  is True, HMI.SWEEP_S)
            check("prepare: the expired drops let go, no PatID matched without a client",
                  HMI.prepare(real, None) == 0)
            HM.CLIENTS_READER = None

            # ---- Drive that cannot be read -------------------------------------------------------------------------
            HMI.DRIVE_FACTORY = lambda: FakeDrive([], {}, fail_list=RuntimeError("down"))
            got = HMI.folder_read(real, actor=ACTOR)
            check("a listing that fails is said as an error, never as nothing new",
                  got.get("error") == "the folder could not be listed (RuntimeError)" and got.get("listed") == 0, got)

            # ---- the doors' blocking halves, through the bound store -----------------------------------------------
            saved = HM._BOUND["store"]
            HM._BOUND["store"] = types.SimpleNamespace(ready=lambda: True, conn=lambda: real)
            HMI.DRIVE_FACTORY = lambda: drive
            got = HMI.preview_now(name=kdp_name(B0), data=b_bytes, actor=ACTOR)
            check("preview through the store: the report the sweep imported answers it, nothing new staged",
                  got.get("verdict") == "duplicate" and count("hub_med_staged") == 0, got.get("verdict"))
            got = HMI.folder_now(actor=ACTOR)
            check("folder through the store", got.get("busy") is False and got.get("listed") == 4, got.get("listed"))
            check("ready() follows the store", HMI.ready() is True)
            HM._BOUND["store"] = saved
            raise psycopg.Rollback()
    finally:
        real.close()
        other.close()
    check("nothing kept: the transaction rolled back", True)
except Exception as exc:  # noqa: BLE001
    import traceback
    check("the test ran to the end", False, type(exc).__name__ + ": " + str(exc)[:300] + traceback.format_exc()[-600:])

print(json.dumps({"ok": not fails, "checks": len(out), "failed": fails, "out": out}, indent=1, default=str))
sys.exit(1 if fails else 0)
