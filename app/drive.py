"""The Drive half of Locations' Documents read: the ISP folder, the houses room and a house's guidebook, as…"""
from __future__ import annotations

import json
import logging
import os
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

import gsjs
from scope import Defer

log = logging.getLogger("hub.drive")

API = "https://www.googleapis.com/drive/v3/files"
SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets"
TOKEN_URL = "https://oauth2.googleapis.com/token"
FOLDER_MIME = "application/vnd.google-apps.folder"
ISP_INDEX_TTL_S = 21600.0
ROOM_TTL_S = 21600.0
LOOK_CAP = 400
FILE_CAP = 100
# DocFolders.gs DOC_ROOMS.houses
HOUSES_ROOM = {"prop": "HOUSE_DOCS_FOLDER_ID", "sibling": "house _ client books"}
# the service-account keys beside the app (0600, gitignored), tried in this order
SA_FILES = tuple(p.strip() for p in os.getenv("HUB_APP_GOOGLE_SA_FILES",
                                              "/app/.sa-living-brain.json,/app/.sa-jarvis.json").split(",") if p.strip())
DRIVE_SCOPES = ["https://www.googleapis.com/auth/drive.readonly"]
# the account Apps Script runs as: a service account the domain delegates to reads Drive as it, before anything else
DRIVE_SUBJECT = os.getenv("HUB_APP_GOOGLE_SUBJECT", "asatech@asalifecare.com").strip()
# asatech's own Drive token, the one the relay files papers with (server/.asatech-drive.json, mounted read-only): the
# first credential, used only while Drive says it is asatech's
OWNER_FILE = os.getenv("HUB_APP_GOOGLE_OWNER_FILE", "/run/secrets/asatech-drive.json").strip()
OWNER_RETRY_S = 300.0
ABOUT_URL = "https://www.googleapis.com/drive/v3/about"
GOOGLE_NATIVE = "application/vnd.google-apps."
BYTES_TIMEOUT_S = 15.0
# Drive converting an Office file into a Google one, and exporting that, takes longer than a read
CONVERT_TIMEOUT_S = 60.0


class Gone(Exception):
    """Drive says no such file to the account Apps Script reads as (the token, last), never only to a service account."""


def _reason_of(e: urllib.error.HTTPError) -> str:
    """Drive's reason word for a refusal (insufficientFilePermissions, cannotDownloadFile, …), or ''."""
    try:
        err = json.loads(e.read(4096) or b"{}").get("error") or {}
        return str(((err.get("errors") or [{}])[0] or {}).get("reason") or "")[:60]
    except Exception:  # noqa: BLE001 - no word is no word
        return ""


def _owner_fields(path: str) -> dict[str, str] | None:
    """The owner token file's three fields, or None when there is none to read; never logged."""
    try:
        with open(path, encoding="utf-8") as f:
            c = json.load(f)
        got = {k: str(c.get(k) or "") for k in ("client_id", "client_secret", "refresh_token")}
    except (OSError, ValueError, AttributeError):
        return None
    return got if all(got.values()) else None


def _service_account(path: str, subject: str = "") -> Any:
    try:
        from google.oauth2 import service_account
        cred = service_account.Credentials.from_service_account_file(path, scopes=DRIVE_SCOPES)
        return cred.with_subject(subject) if subject else cred
    except Exception:  # noqa: BLE001 - a missing or unreadable key is one credential fewer
        return None


class Drive:
    """Drive as the account Apps Script runs as — asatech's own Drive token first, then a service account the domain
    delegates to as asatech — then the platform's service accounts themselves (living-brain first), then the asatech
    refresh token of the environment."""

    def __init__(self, client_id: str = "", client_secret: str = "", refresh_token: str = "") -> None:
        self.client_id = client_id or os.getenv("HUB_APP_GOOGLE_CLIENT_ID", "")
        self.client_secret = client_secret or os.getenv("HUB_APP_GOOGLE_CLIENT_SECRET", "")
        self.refresh_token = refresh_token or os.getenv("HUB_APP_GOOGLE_REFRESH_TOKEN", "")
        self._owner = _owner_fields(OWNER_FILE) if OWNER_FILE else None
        self._owner_token: tuple[str, float] = ("", 0.0)
        # a failed owner token is asked again after a pause, never on every read
        self._owner_retry_at = 0.0
        delegated = [c for c in (_service_account(p, DRIVE_SUBJECT) for p in SA_FILES if DRIVE_SUBJECT) if c is not None]
        # the service accounts themselves still follow: a file shared with one of them alone stays read
        self._creds: list[Any] = (["owner"] if self._owner else []) + delegated + [
            c for c in (_service_account(p) for p in SA_FILES) if c is not None]
        if self.client_id and self.client_secret and self.refresh_token:
            self._creds.append(None)
        # a delegation the domain does not grant is one credential fewer, never asked again
        self._dead: set[int] = set()
        self.available = bool(self._creds)
        self._lock = threading.Lock()
        self._token: tuple[str, float] = ("", 0.0)
        self._isp: tuple[float, list[dict]] | None = None
        self._room: tuple[float, str] | None = None

    def _refresh_token_access(self) -> str:
        tok, until = self._token
        if tok and time.time() < until - 60:
            return tok
        body = urllib.parse.urlencode({"client_id": self.client_id, "client_secret": self.client_secret,
                                       "refresh_token": self.refresh_token, "grant_type": "refresh_token"}).encode()
        with urllib.request.urlopen(urllib.request.Request(TOKEN_URL, data=body), timeout=10) as res:
            got = json.loads(res.read())
        self._token = (str(got["access_token"]), time.time() + float(got.get("expires_in") or 3000))
        return self._token[0]

    def _owner_access(self) -> str:
        """asatech's own Drive token, used only while Drive answers that it is asatech's (as the relay checks it)."""
        tok, until = self._owner_token
        if tok and time.time() < until - 60:
            return tok
        try:
            body = urllib.parse.urlencode({**self._owner, "grant_type": "refresh_token"}).encode()
            with urllib.request.urlopen(urllib.request.Request(TOKEN_URL, data=body), timeout=10) as res:
                got = json.loads(res.read())
            tok = str(got["access_token"])
            req = urllib.request.Request(f"{ABOUT_URL}?fields=user(emailAddress)",
                                         headers={"Authorization": f"Bearer {tok}"})
            with urllib.request.urlopen(req, timeout=10) as res:
                who = str((json.loads(res.read()).get("user") or {}).get("emailAddress") or "").strip().lower()
            if who != DRIVE_SUBJECT.lower():
                raise PermissionError("the owner token answers as another account")
        except Exception as e:
            # the exception's type alone: its words may carry the token
            self._owner_retry_at = time.time() + OWNER_RETRY_S
            log.warning("drive: asatech's own Drive token gives none (%s), asked again in %.0f s", type(e).__name__,
                        OWNER_RETRY_S)
            raise
        self._owner_token = (tok, time.time() + float(got.get("expires_in") or 3000))
        return tok

    def _access(self, which: int = 0) -> str:
        with self._lock:
            cred = self._creds[which]
            if cred == "owner":
                return self._owner_access()
            if cred is None:
                return self._refresh_token_access()
            if not cred.valid:
                from google.auth.exceptions import RefreshError
                from google.auth.transport.requests import Request
                try:
                    cred.refresh(Request())
                except RefreshError as e:
                    # the domain refuses this delegation (or the key): skipped from now on, said once
                    self._dead.add(which)
                    log.warning("drive: %s as %s gives no token (%s), passed over from now on",
                                getattr(cred, "service_account_email", "?"), getattr(cred, "_subject", None) or "itself",
                                str(e).split(":", 1)[0][:80])
                    raise
            return str(cred.token)

    def _usable(self) -> list[int]:
        resting = time.time() < self._owner_retry_at
        return [w for w in range(len(self._creds))
                if w not in self._dead and not (resting and self._creds[w] == "owner")]

    def _token_or_none(self, which: int) -> str:
        try:
            return self._access(which)
        except Exception:  # noqa: BLE001 - a credential that gives no token is passed over
            if which in self._dead or self._creds[which] == "owner":
                return ""
            raise

    def _get(self, url: str, params: dict[str, Any]) -> dict[str, Any]:
        q = urllib.parse.urlencode({**params, "supportsAllDrives": "true"})
        refused = 0
        for which in self._usable():
            tok = self._token_or_none(which)
            if not tok:
                continue
            req = urllib.request.Request(f"{url}?{q}", headers={"Authorization": f"Bearer {tok}"})
            try:
                with urllib.request.urlopen(req, timeout=15) as res:
                    return json.loads(res.read())
            except urllib.error.HTTPError as e:
                if e.code not in (401, 403):
                    raise
                refused = e.code
        # Drive refusing every credential is Apps Script's to answer, never an empty folder
        raise Defer(f"Drive refused the credentials ({refused or 'none configured'})")

    def file(self, file_id: str, fields: str = "id,name,mimeType,trashed,parents") -> dict[str, Any]:
        return self._get(f"{API}/{urllib.parse.quote(file_id)}", {"fields": fields})

    # -- a file's bytes (DriveApp getBlob / getAs) --
    def _bytes(self, url: str, params: dict[str, Any], cap: int) -> bytes:
        """One answer read whole, at most cap + 1 bytes; a service account not seeing the file passes it down the chain."""
        q = urllib.parse.urlencode(params)
        refused = 0
        # Google's own word for the first refusal (the account Apps Script reads as, when it is first): never a secret
        reason = ""
        for which in self._usable():
            cred = self._creds[which]
            tok = self._token_or_none(which)
            if not tok:
                continue
            req = urllib.request.Request(f"{url}?{q}", headers={"Authorization": f"Bearer {tok}"})
            try:
                with urllib.request.urlopen(req, timeout=BYTES_TIMEOUT_S) as res:
                    return res.read(cap + 1)
            except urllib.error.HTTPError as e:
                if e.code == 404 and cred is None:
                    raise Gone("No item with the given ID could be found.") from e
                if e.code not in (401, 403, 404):
                    raise
                refused = e.code
                if not reason:
                    reason = _reason_of(e)
        raise Defer(f"Drive refused the credentials ({refused or 'none configured'}{', ' + reason if reason else ''})")

    def sheet_tabs(self, book_id: str) -> list[dict[str, Any]]:
        """A Google Sheet's tabs (sheetId, title, index, gridProperties) as the Sheets API lists them: the tab ids and
        the grid an Office export of the book does not carry."""
        url = f"https://sheets.googleapis.com/v4/spreadsheets/{urllib.parse.quote(book_id)}"
        got = json.loads(self._bytes(url, {"fields": "sheets.properties(sheetId,title,index,gridProperties)"}, 4 << 20))
        return [s.get("properties") or {} for s in got.get("sheets") or []]

    def file_meta(self, file_id: str, fields: str = "id,name,mimeType,trashed,size") -> dict[str, Any]:
        url = f"{API}/{urllib.parse.quote(file_id)}"
        return json.loads(self._bytes(url, {"fields": fields, "supportsAllDrives": "true"}, 1 << 20))

    def media(self, file_id: str, cap: int) -> bytes:
        return self._bytes(f"{API}/{urllib.parse.quote(file_id)}", {"alt": "media", "supportsAllDrives": "true"}, cap)

    def export(self, file_id: str, mime: str, cap: int) -> bytes:
        """A Google Docs Editors file in another type (getAs); Drive's export ceiling refuses with 403, so it defers."""
        return self._bytes(f"{API}/{urllib.parse.quote(file_id)}/export", {"mimeType": mime}, cap)

    def office_pdf(self, file_id: str, target: str, cap: int) -> bytes | None:
        """Locations.gs locationsOfficePdf_: an Office file as PDF through a converted copy, exported, then trashed;
        None when Drive will not convert it. Only asatech's own token may write that copy."""
        owner = next((w for w in self._usable() if self._creds[w] == "owner"), None)
        tok = self._token_or_none(owner) if owner is not None else ""
        if not tok:
            raise Defer("an Office file is converted only with asatech's own Drive token, and it gives none")
        auth = {"Authorization": f"Bearer {tok}"}
        req = urllib.request.Request(f"{API}/{urllib.parse.quote(file_id)}/copy?supportsAllDrives=true",
                                     data=json.dumps({"mimeType": target, "name": "locations-preview-tmp"}).encode(),
                                     headers={**auth, "Content-Type": "application/json"}, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=CONVERT_TIMEOUT_S) as res:
                tmp = str(json.loads(res.read()).get("id") or "")
        except urllib.error.HTTPError as e:
            log.info("drive: an Office file was not converted (%s %s)", e.code, _reason_of(e))
            return None
        if not tmp:
            return None
        try:
            req = urllib.request.Request(f"{API}/{urllib.parse.quote(tmp)}/export?mimeType=application%2Fpdf",
                                         headers=auth)
            try:
                with urllib.request.urlopen(req, timeout=CONVERT_TIMEOUT_S) as res:
                    return res.read(cap + 1)
            except urllib.error.HTTPError as e:
                log.info("drive: a converted copy was not exported (%s %s)", e.code, _reason_of(e))
                return None
        finally:
            trash = urllib.request.Request(f"{API}/{urllib.parse.quote(tmp)}?supportsAllDrives=true",
                                           data=json.dumps({"trashed": True}).encode(),
                                           headers={**auth, "Content-Type": "application/json"}, method="PATCH")
            try:
                urllib.request.urlopen(trash, timeout=BYTES_TIMEOUT_S).close()
            except Exception as e:  # noqa: BLE001 - the copy stays; nothing reads it
                log.warning("drive: a converted copy was not trashed (%s)", type(e).__name__)

    def converted_text(self, file_id: str, cap: int) -> str:
        """Policies.gs policyText_ for a file that is not a Google Doc: a copy converted into one, its text exported,
        the copy trashed; '' when Drive will not convert it. Only asatech's own token may write that copy."""
        owner = next((w for w in self._usable() if self._creds[w] == "owner"), None)
        tok = self._token_or_none(owner) if owner is not None else ""
        if not tok:
            raise Defer("a document is converted only with asatech's own Drive token, and it gives none")
        auth = {"Authorization": f"Bearer {tok}"}
        req = urllib.request.Request(f"{API}/{urllib.parse.quote(file_id)}/copy?supportsAllDrives=true",
                                     data=json.dumps({"mimeType": "application/vnd.google-apps.document",
                                                      "name": "tmp-policy-" + file_id}).encode(),
                                     headers={**auth, "Content-Type": "application/json"}, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=CONVERT_TIMEOUT_S) as res:
                tmp = str(json.loads(res.read()).get("id") or "")
        except urllib.error.HTTPError as e:
            log.info("drive: a document was not converted (%s %s)", e.code, _reason_of(e))
            return ""
        if not tmp:
            return ""
        try:
            req = urllib.request.Request(f"{API}/{urllib.parse.quote(tmp)}/export?mimeType=text%2Fplain", headers=auth)
            try:
                with urllib.request.urlopen(req, timeout=CONVERT_TIMEOUT_S) as res:
                    return res.read(cap + 1).decode("utf-8", "replace")
            except urllib.error.HTTPError as e:
                log.info("drive: a converted copy's text was not exported (%s %s)", e.code, _reason_of(e))
                return ""
        finally:
            trash = urllib.request.Request(f"{API}/{urllib.parse.quote(tmp)}?supportsAllDrives=true",
                                           data=json.dumps({"trashed": True}).encode(),
                                           headers={**auth, "Content-Type": "application/json"}, method="PATCH")
            try:
                urllib.request.urlopen(trash, timeout=BYTES_TIMEOUT_S).close()
            except Exception as e:  # noqa: BLE001 - the copy stays; nothing reads it
                log.warning("drive: a converted copy was not trashed (%s)", type(e).__name__)

    def ocr_text(self, data: bytes, mime: str, cap: int = 4 << 20) -> str:
        """Finance.gs finReceiptText_ for bytes the server keeps: uploaded once as a Google Doc (Drive reads the image
        or the PDF), its text exported, the copy deleted; '' when Drive will not read it. asatech's own token only."""
        owner = next((w for w in self._usable() if self._creds[w] == "owner"), None)
        tok = self._token_or_none(owner) if owner is not None else ""
        if not tok:
            raise Defer("a receipt is read only with asatech's own Drive token, and it gives none")
        auth = {"Authorization": f"Bearer {tok}"}
        boundary = "hub" + os.urandom(12).hex()
        meta = json.dumps({"name": "fin-ocr-tmp", "mimeType": "application/vnd.google-apps.document"}).encode()
        body = (f"--{boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n".encode() + meta +
                f"\r\n--{boundary}\r\nContent-Type: {mime or 'application/octet-stream'}\r\n\r\n".encode() + data +
                f"\r\n--{boundary}--\r\n".encode())
        req = urllib.request.Request("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart", data=body,
                                     headers={**auth, "Content-Type": f"multipart/related; boundary={boundary}"},
                                     method="POST")
        try:
            with urllib.request.urlopen(req, timeout=CONVERT_TIMEOUT_S) as res:
                tmp = str(json.loads(res.read()).get("id") or "")
        except urllib.error.HTTPError as e:
            log.info("drive: a receipt was not read (%s %s)", e.code, _reason_of(e))
            return ""
        if not tmp:
            return ""
        try:
            req = urllib.request.Request(f"{API}/{urllib.parse.quote(tmp)}/export?mimeType=text%2Fplain", headers=auth)
            try:
                with urllib.request.urlopen(req, timeout=CONVERT_TIMEOUT_S) as res:
                    return res.read(cap + 1).decode("utf-8", "replace")
            except urllib.error.HTTPError as e:
                log.info("drive: a receipt's text was not exported (%s %s)", e.code, _reason_of(e))
                return ""
        finally:
            gone = urllib.request.Request(f"{API}/{urllib.parse.quote(tmp)}", headers=auth, method="DELETE")
            try:
                urllib.request.urlopen(gone, timeout=BYTES_TIMEOUT_S).close()
            except Exception as e:  # noqa: BLE001 - the copy stays; nothing reads it
                log.warning("drive: a receipt's reading copy was not deleted (%s)", type(e).__name__)

    def children(self, folder_id: str, folders: bool, fields: str = "id,name,mimeType,modifiedTime,webViewLink",
                 cap: int = 0) -> list[dict]:
        kind = "=" if folders else "!="
        q = f"'{folder_id}' in parents and trashed = false and mimeType {kind} '{FOLDER_MIME}'"
        out: list[dict] = []
        page = ""
        while True:
            params = {"q": q, "fields": f"nextPageToken,files({fields})", "pageSize": 1000,
                      "includeItemsFromAllDrives": "true"}
            if page:
                params["pageToken"] = page
            got = self._get(API, params)
            out.extend(got.get("files") or [])
            page = got.get("nextPageToken") or ""
            if not page or (cap and len(out) >= cap):
                return out[:cap] if cap else out

    # -- writing as asatech (DriveApp createFile / createFolder / makeCopy / setTrashed) --
    def _owner_write(self, what: str) -> dict[str, str]:
        """The Authorization header of asatech's own token: only it files into the platform's folders."""
        owner = next((w for w in self._usable() if self._creds[w] == "owner"), None)
        tok = self._token_or_none(owner) if owner is not None else ""
        if not tok:
            raise Defer(what + " only with asatech's own Drive token, and it gives none")
        return {"Authorization": f"Bearer {tok}"}

    def _send(self, req: urllib.request.Request) -> dict[str, Any]:
        with urllib.request.urlopen(req, timeout=CONVERT_TIMEOUT_S) as res:
            return json.loads(res.read() or b"{}")

    # -- a sheet's cells as asatech, the platform books' owner (Sheets values.get / values.update) --
    def sheet_values(self, book_id: str, a1: str) -> list[list[str]]:
        """A range as the sheet shows it, row by row."""
        auth = self._owner_write("a sheet is read as its owner")
        q = urllib.parse.urlencode({"valueRenderOption": "FORMATTED_VALUE", "majorDimension": "ROWS"})
        url = f"{SHEETS_API}/{urllib.parse.quote(book_id)}/values/{urllib.parse.quote(a1, safe='')}"
        req = urllib.request.Request(f"{url}?{q}", headers=auth)
        return [[str(c) for c in r] for r in self._send(req).get("values") or []]

    def sheet_cell_put(self, book_id: str, a1: str, value: str) -> None:
        """One cell written as typed text (RAW: a card number or a date stays the text it was given)."""
        auth = self._owner_write("a sheet is written as its owner")
        body = json.dumps({"range": a1, "majorDimension": "ROWS", "values": [[value]]}).encode()
        q = urllib.parse.urlencode({"valueInputOption": "RAW"})
        url = f"{SHEETS_API}/{urllib.parse.quote(book_id)}/values/{urllib.parse.quote(a1, safe='')}"
        req = urllib.request.Request(f"{url}?{q}", data=body, headers={**auth, "Content-Type": "application/json"},
                                     method="PUT")
        self._send(req)

    def upload_into(self, folder_id: str, name: str, mime: str, data: bytes) -> dict[str, Any]:
        """folder.createFile(blob): the bytes filed in the folder under this name; {id, name, mimeType, size}."""
        auth = self._owner_write("a file is filed in Drive")
        boundary = "hub" + os.urandom(12).hex()
        meta = json.dumps({"name": name, "parents": [folder_id]}).encode()
        body = (f"--{boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n".encode() + meta +
                f"\r\n--{boundary}\r\nContent-Type: {mime or 'application/octet-stream'}\r\n\r\n".encode() + data +
                f"\r\n--{boundary}--\r\n".encode())
        q = urllib.parse.urlencode({"uploadType": "multipart", "supportsAllDrives": "true",
                                    "fields": "id,name,mimeType,size"})
        req = urllib.request.Request(f"https://www.googleapis.com/upload/drive/v3/files?{q}", data=body,
                                     headers={**auth, "Content-Type": f"multipart/related; boundary={boundary}"},
                                     method="POST")
        got = self._send(req)
        if not got.get("id"):
            raise ValueError("Drive named no file for the upload")
        return got

    def copy_into(self, file_id: str, folder_id: str, name: str) -> str:
        """file.makeCopy(name, folder): the copy's id."""
        auth = self._owner_write("a file is copied in Drive")
        req = urllib.request.Request(f"{API}/{urllib.parse.quote(file_id)}/copy?supportsAllDrives=true&fields=id",
                                     data=json.dumps({"name": name, "parents": [folder_id]}).encode(),
                                     headers={**auth, "Content-Type": "application/json"}, method="POST")
        return str(self._send(req).get("id") or "")

    def trash(self, file_id: str) -> None:
        """file.setTrashed(true): to the bin, never erased."""
        auth = self._owner_write("a file is put in Drive's bin")
        req = urllib.request.Request(f"{API}/{urllib.parse.quote(file_id)}?supportsAllDrives=true&fields=id",
                                     data=json.dumps({"trashed": True}).encode(),
                                     headers={**auth, "Content-Type": "application/json"}, method="PATCH")
        self._send(req)

    def child_folder(self, parent_id: str, name: str) -> str:
        """filesChildByName_: the folder of this name under the parent, made when there is none; its id."""
        safe = name.replace("\\", "\\\\").replace("'", "\\'")
        got = self._get(API, {"q": f"'{parent_id}' in parents and trashed = false and mimeType = '{FOLDER_MIME}' and "
                                   f"name = '{safe}'", "fields": "files(id)", "pageSize": 10,
                              "includeItemsFromAllDrives": "true"})
        hit = next((str(f.get("id")) for f in got.get("files") or [] if f.get("id")), "")
        if hit:
            return hit
        auth = self._owner_write("a folder is made in Drive")
        req = urllib.request.Request(f"{API}?supportsAllDrives=true&fields=id",
                                     data=json.dumps({"name": name, "mimeType": FOLDER_MIME,
                                                      "parents": [parent_id]}).encode(),
                                     headers={**auth, "Content-Type": "application/json"}, method="POST")
        made = str(self._send(req).get("id") or "")
        if not made:
            raise ValueError("Drive named no folder for " + name)
        return made

    # -- ispDocFor_ --
    def isp_files(self, reads: Any) -> list[dict]:
        """ispDocIndex_: every file in the ISP folder, held six hours; an unreadable folder lists none."""
        held = self._isp
        if held and time.time() - held[0] < ISP_INDEX_TTL_S:
            return held[1]
        folder = reads.db.prop("ISP_DOCS_FOLDER_ID")
        try:
            files = [{"id": f["id"], "name": f["name"]} for f in self.children(folder, False, "id,name")]
        except Defer:
            raise
        except Exception:  # noqa: BLE001 - as the port: an unreadable folder means no link, never a wrong one
            return []
        self._isp = (time.time(), files)
        return files

    def isp_doc_for(self, reads: Any, client_name: str) -> dict[str, str]:
        """ispDocFor_: the one file whose folded name holds the client's, else every word of a file name in theirs."""
        key = gsjs.name_key(client_name)
        empty = {"id": "", "name": "", "url": ""}
        if not key:
            return empty
        files = self.isp_files(reads)
        hits = [f for f in files if key in gsjs.name_key(f["name"])]
        if not hits:
            own = name_words(client_name)
            for f in files:
                want = name_words(f["name"])
                if want and all(w in own for w in want):
                    hits.append(f)
        if len(hits) != 1:
            return empty
        return {"id": hits[0]["id"], "name": hits[0]["name"],
                "url": "https://drive.google.com/file/d/" + hits[0]["id"] + "/view"}

    # -- docRoomFolder_('houses') and locationsGuidebook_ --
    def houses_room(self, reads: Any) -> dict[str, Any]:
        key = "houses"
        folder_id = reads.db.prop(HOUSES_ROOM["prop"])
        if not folder_id:
            held = self._room
            if held and time.time() - held[0] < ROOM_TTL_S:
                folder_id = held[1]
            else:
                folder_id = self._sibling(reads)
                if folder_id:
                    self._room = (time.time(), folder_id)
        if not folder_id:
            return {"folder": None, "reason": f'The "{key}" folder is not configured and could not be found beside '
                                              f'the Administration folder — set the {HOUSES_ROOM["prop"]} property.'}
        try:
            got = self.file(folder_id)
        except Defer:
            raise
        except Exception:  # noqa: BLE001 - the port's own sentence
            return {"folder": None, "reason": f'The platform cannot open the "{key}" folder — check that '
                                              'asatech@asalifecare.com has access to it.'}
        if got.get("trashed"):
            return {"folder": None, "reason": "The configured folder is in the trash."}
        return {"folder": got, "id": folder_id}

    def _sibling(self, reads: Any) -> str:
        admin = reads.db.prop("ADMIN_DOCS_FOLDER_ID")
        if not admin:
            return ""
        try:
            parents = self.file(admin).get("parents") or []
            if not parents:
                return ""
            for f in self.children(parents[0], True, "id,name"):
                if gsjs.trim(str(f.get("name") or "")).lower() == HOUSES_ROOM["sibling"]:
                    return str(f["id"])
        except Defer:
            raise
        except Exception:  # noqa: BLE001 - as docRoomFamily_: no family, no sibling
            return ""
        return ""

    def guidebook(self, reads: Any, code: str) -> dict[str, Any]:
        """locationsGuidebook_: the first subfolder (three levels down at most) naming the code, and its files."""
        found = self.houses_room(reads)
        if not found.get("folder"):
            return {"guidebook": None, "why": found["reason"]}
        rx = re.compile(r"(^|[^A-Z0-9])" + re.escape(code) + r"(?![0-9])")
        queue, hit, looked = [(found["id"], 0)], None, 0
        while queue and not hit and looked < LOOK_CAP:
            cur, depth = queue.pop(0)
            for k in self.children(cur, True, "id,name"):
                if looked >= LOOK_CAP:
                    break
                looked += 1
                if rx.search(str(k.get("name") or "").upper()):
                    hit = k
                    break
                if depth < 2:
                    queue.append((k["id"], depth + 1))
        if not hit:
            return {"guidebook": None, "why": "no folder in the houses room names " + code}
        files: list[dict] = []

        def take(folder_id: str) -> None:
            for f in self.children(folder_id, False, cap=FILE_CAP - len(files)):
                if len(files) >= FILE_CAP:
                    return
                name = str(f.get("name") or "")
                files.append({"id": f["id"], "name": name, "mime": str(f.get("mimeType") or ""),
                              "modified_time": str(f.get("modifiedTime") or ""), "url": str(f.get("webViewLink") or ""),
                              "guide": bool(re.search("guide", name, re.I))})

        take(hit["id"])
        for sub in self.children(hit["id"], True, "id,name"):
            if len(files) >= FILE_CAP:
                break
            take(sub["id"])
        files.sort(key=lambda f: (0 if f["guide"] else 1, gsjs.collate_key(f["name"])))
        return {"guidebook": {"folder_id": hit["id"], "folder_name": str(hit.get("name") or ""), "files": files},
                "why": ""}


def name_words(text: Any) -> list[str]:
    """ispIntakeNameWords_: every 3+ letter word once, an extension and the word ISP dropped."""
    s = re.sub(r"\.[a-z0-9]+$", "", gsjs.or_text(text).lower())
    s = re.sub(r"\bisp'?s?\b", " ", s)
    out: list[str] = []
    for w in re.split(r"\s+", re.sub(r"[^a-z]+", " ", s)):
        if len(w) >= 3 and w not in out:
            out.append(w)
    return out
