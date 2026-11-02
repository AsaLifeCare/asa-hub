#!/usr/bin/env python3
"""
THE TECHNOLOGY FOLDER, WALKED AGAINST A DRIVE THAT FAILS — server/technology_docs.py.

WHAT WENT WRONG. The relay walks the technology Drive folder and hands the
screen one meta row and the file rows. A `files().list` that threw was logged
and skipped, and the walk that followed was cached as the last good listing
for fifteen minutes with `configured: true` and no reason. The header then
printed it as a measured count: an undercount when one subfolder failed, and
"0 documents" when the root's own listing failed.

WHAT IT PROVES, driving the module's real build() over a stand-in Drive:

  whole    a complete walk lists every file, carries no reason and no partial
           mark, and holds the window shut
  partial  a subfolder that does not answer marks the listing partial, says
           how many listings failed, keeps every file it did list, and is NOT
           held — the next build walks again
  root     a root whose own listing does not answer is a failed read with a
           reason and no files, never an empty folder, and is not held
  get      a root that does not answer files().get keeps its existing reason

Nothing reaches Drive, a table, Apps Script or a person: the module is
imported from the checkout with its text folder in a temporary directory.

    python3 tools/test-technology-docs.py
"""
import importlib.util
import os
import sys
import tempfile
from pathlib import Path

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parent.parent

results = {"ok": 0, "failed": []}


def check(name: str, ok: bool, detail=None) -> None:
    if ok:
        results["ok"] += 1
        print(f"  ok   {name}")
    else:
        results["failed"].append(name)
        print(f"  FAIL {name}")
        if detail is not None:
            print(f"       {str(detail)[:600]}")


TMP = tempfile.mkdtemp(prefix="techdocs-test-")
os.environ["TECH_DOCS_TEXT_DIR"] = TMP
os.environ["TECH_DRIVE_FOLDER_ID"] = "ROOT"
spec = importlib.util.spec_from_file_location("technology_docs_under_test", ROOT / "server" / "technology_docs.py")
docs = importlib.util.module_from_spec(spec)
spec.loader.exec_module(docs)


class HttpError(Exception):
    """Named like the client library's own, since the reason carries the class name."""


FOLDER = "application/vnd.google-apps.folder"
TREE = {
    "ROOT": [{"id": "A", "name": "Alpha", "mimeType": FOLDER},
             {"id": "B", "name": "Beta", "mimeType": FOLDER},
             {"id": "r1", "name": "root.pdf", "mimeType": "application/pdf", "size": "10"}],
    "A": [{"id": "a1", "name": "a1.pdf", "mimeType": "application/pdf", "size": "20"},
          {"id": "a2", "name": "a2.pdf", "mimeType": "application/pdf", "size": "30"}],
    "B": [{"id": "b1", "name": "b1.pdf", "mimeType": "application/pdf", "size": "40"}],
}


class Drive:
    """files().get / files().list over TREE; `fail` names folders whose listing throws."""

    def __init__(self, fail=(), get_fails=False):
        self.fail = set(fail)
        self.get_fails = get_fails
        self.lists = 0

    def files(self):
        return self

    def get(self, fileId, fields, supportsAllDrives):  # noqa: N803 — the client's own names
        def run():
            if self.get_fails:
                raise HttpError("404")
            return {"id": fileId, "name": "Technology", "webViewLink": "https://drive/tech"}
        return _Req(run)

    def list(self, q, fields, pageSize, pageToken, supportsAllDrives, includeItemsFromAllDrives):  # noqa: N803
        folder = q.split("'")[1]

        def run():
            self.lists += 1
            if folder in self.fail:
                raise HttpError("500 backend error")
            return {"files": TREE.get(folder, [])}
        return _Req(run)


class _Req:
    def __init__(self, fn):
        self.fn = fn

    def execute(self):
        return self.fn()


def walk(drive: Drive, fresh: bool = True):
    if fresh:
        docs._LAST_GOOD.update({"rows": None, "at": 0.0, "read_at": ""})
        docs._LATEST = None
    docs._drive_service = lambda: drive
    rows, _ = docs.build("techDocs", "")
    meta = next(r for r in rows if r.get("kind") == "meta")
    files = [r for r in rows if r.get("kind") == "file"]
    return meta, files


print("A COMPLETE WALK")
drive = Drive()
meta, files = walk(drive)
check("whole: every file is listed", sorted(f["name"] for f in files) == ["a1.pdf", "a2.pdf", "b1.pdf", "root.pdf"],
      [f["name"] for f in files])
check("whole: no reason and no partial mark", "reason" not in meta and not meta.get("partial"), meta)
check("whole: the listing is held for the window", docs._LAST_GOOD.get("rows") is not None)
before = drive.lists
walk(drive, fresh=False)
check("whole: the next build inside the window lists nothing again", drive.lists == before, drive.lists - before)

print("A SUBFOLDER THAT DOES NOT ANSWER")
drive = Drive(fail={"A"})
meta, files = walk(drive)
check("partial: the listing is marked partial and says how many listings failed",
      meta.get("partial") is True and "1 of 3 folder listing(s) failed (HttpError)" in str(meta.get("partial_reason")),
      meta)
check("partial: it is not a failed read — the files it did list are real",
      "reason" not in meta and sorted(f["name"] for f in files) == ["b1.pdf", "root.pdf"], [f["name"] for f in files])
check("partial: it is not held — the window stays open", docs._LAST_GOOD.get("rows") is None, docs._LAST_GOOD)
before = drive.lists
drive.fail = set()
meta, files = walk(drive, fresh=False)
check("partial: the next build walks again and finds everything",
      drive.lists > before and len(files) == 4 and not meta.get("partial"), (drive.lists - before, meta))

print("A ROOT WHOSE OWN LISTING DOES NOT ANSWER")
drive = Drive(fail={"ROOT"})
meta, files = walk(drive)
check("root: a failed read with a reason, never an empty folder",
      meta.get("reason") == "the folder listing failed (HttpError)" and files == [], (meta, files))
check("root: and not held", docs._LAST_GOOD.get("rows") is None, docs._LAST_GOOD)

print("A ROOT THAT DOES NOT ANSWER files().get")
meta, files = walk(Drive(get_fails=True))
check("get: the existing reason stands", "did not answer (HttpError)" in str(meta.get("reason")) and files == [], meta)

print(f"\n{results['ok']} ok, {len(results['failed'])} failed")
for f in results["failed"]:
    print(f"  FAILED: {f}")
sys.exit(1 if results["failed"] else 0)
