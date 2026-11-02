#!/usr/bin/env python3
"""Relay mail doors against a faked imaplib; only the network is faked, the MIME is real."""
import os
import subprocess
import sys

CONTAINER = os.getenv("HUB_RELAY_CONTAINER", "asa-hub-snapshot")
SOURCE = os.getenv("HUB_RELAY_SOURCE", "/srv/app/snapshot_service.py")


def _reexec() -> int:
    here = os.path.abspath(__file__)
    try:
        proc = subprocess.run(
            ["docker", "exec", "-e", "HUB_SNAPSHOT_OUT=/tmp/mail-doors-test",
             "-e", f"HUB_RELAY_SOURCE={SOURCE}", "-i", CONTAINER, "python3", "-"],
            stdin=open(here, "rb"), capture_output=True, text=True, timeout=180)
    except FileNotFoundError:
        print("docker is not available and the relay source is not here — nothing to test.")
        return 2
    sys.stdout.write(proc.stdout)
    sys.stderr.write(proc.stderr)
    return proc.returncode


def main() -> int:
    if not os.path.exists(SOURCE):
        return _reexec()

    import importlib.util
    import re
    import types
    from email.message import EmailMessage

    msg = EmailMessage()
    msg["From"] = "Denise Ops <denise@asaop.org>"
    msg["To"] = "asa-hub@asaop.org"
    msg["Subject"] = "Roster for next week"
    msg["Date"] = "Sat, 30 Aug 2026 09:00:00 -0400"
    msg["Message-ID"] = "<roster-123@asaop.org>"
    long_text = "Here is the roster.\n" + ("Line of detail.\n" * 200)
    msg.set_content(long_text)
    msg.add_alternative("<html><body><b>Here is the roster.</b><p>Rendered half.</p></body></html>",
                        subtype="html")
    pdf_bytes = b"%PDF-1.4 " + b"x" * 5000
    msg.add_attachment(pdf_bytes, maintype="application", subtype="pdf", filename="roster.pdf")
    RAW = msg.as_bytes()

    plain = EmailMessage()
    plain["From"] = "reports@asaop.org"
    plain["Subject"] = "No message id here"
    plain.set_content("bare report body")
    RAW_PLAIN = plain.as_bytes()

    # imaplib is imported inside each relay function, so this fake is seen at call time.
    calls: list[tuple] = []

    class FakeConn:
        def __init__(self, host, port, timeout=None):
            calls.append(("connect", host, port))
        def starttls(self):
            calls.append(("starttls",))
        def login(self, u, p):
            calls.append(("login", u))
        def select(self, mbox, readonly=False):
            calls.append(("select", mbox, readonly))
            return ("OK", [b"2"])
        def search(self, cs, *crit):
            calls.append(("search",) + crit)
            if "Message-ID" in crit and "roster-123" in crit[-1]:
                return ("OK", [b"7"])
            if crit and crit[0] == "SUBJECT" and "No message id" in crit[-1]:
                return ("OK", [b"9"])
            return ("OK", [b""])
        def fetch(self, uid, what):
            calls.append(("fetch", uid, what))
            raw = RAW if uid in (b"7", "7") else RAW_PLAIN
            return ("OK", [(b"7 (BODY[] {n}", raw), b")"])
        def store(self, uid, op, flags):
            calls.append(("store", uid, op, flags))
            return ("OK", [b""])
        def status(self, mbox, what):
            calls.append(("status", mbox, what))
            return ("OK", [b'"INBOX" (UNSEEN 4)'])
        def copy(self, uid, mbox):
            calls.append(("copy", uid, mbox))
            return ("OK", [b""])
        def create(self, mbox):
            calls.append(("create", mbox)); return ("OK", [b""])
        def subscribe(self, mbox):
            return ("OK", [b""])
        def expunge(self):
            calls.append(("expunge",)); return ("OK", [b""])
        def list(self, *a):
            return ("OK", [b'(\\HasNoChildren) "." "INBOX"'])
        def logout(self):
            calls.append(("logout",))

    sys.modules["imaplib"] = types.SimpleNamespace(IMAP4=FakeConn)

    spec = importlib.util.spec_from_file_location("relay", SOURCE)
    m = importlib.util.module_from_spec(spec)
    sys.modules["relay"] = m
    spec.loader.exec_module(m)

    fails = [0]
    def chk(label, cond, detail=""):
        print(("  OK    " if cond else "  FAIL  ") + label + ("" if cond else f"\n          {detail}"))
        if not cond:
            fails[0] += 1

    print("\nTHE FULL MESSAGE — what the 400-char snippet never carried")
    out = m._imap_message("u", "p", "<roster-123@asaop.org>", "INBOX", "Roster for next week")
    chk("the whole plain text comes back, not a snippet",
        out.get("found") and len(out.get("text", "")) > 2000,
        f"text len={len(out.get('text',''))}")
    chk("the HTML alternative rides beside it, never instead of it",
        "<b>Here is the roster.</b>" in out.get("html", "") and "Here is the roster." in out.get("text", ""))
    atts = out.get("attachments") or []
    chk("the attachment is LISTED — name, type, size, part ordinal",
        len(atts) == 1 and atts[0]["filename"] == "roster.pdf" and
        atts[0]["mime"] == "application/pdf" and atts[0]["size"] == len(pdf_bytes),
        str(atts))
    chk("the read was BODY.PEEK on a readonly select — reading marks nothing",
        any(c[0] == "select" and c[2] is True for c in calls) and
        any(c[0] == "fetch" and "PEEK" in str(c[2]) for c in calls))

    print("\nTHE ATTACHMENT — one part, bounded")
    got = m._imap_attachment("u", "p", "<roster-123@asaop.org>", atts[0]["part"], "INBOX", "")
    import base64
    chk("the named part answers with its own bytes, base64",
        got.get("found") and base64.b64decode(got.get("b64", "")) == pdf_bytes and
        got.get("filename") == "roster.pdf")
    got2 = m._imap_attachment("u", "p", "<roster-123@asaop.org>", 99, "INBOX", "")
    chk("a part that does not exist is not found, not invented", got2.get("found") is False)
    held = m.MAIL_ATTACHMENT_MAX
    try:
        m.MAIL_ATTACHMENT_MAX = 100
        got3 = m._imap_attachment("u", "p", "<roster-123@asaop.org>", atts[0]["part"], "INBOX", "")
        chk("past the size door it refuses AND names the size",
            got3.get("too_big") is True and got3.get("size") == len(pdf_bytes) and "b64" not in got3,
            str({k: v for k, v in got3.items() if k != "b64"}))
    finally:
        m.MAIL_ATTACHMENT_MAX = held

    print("\nTHE SEEN FLAG — a deliberate door, not a side effect")
    calls.clear()
    r = m._imap_mark("u", "p", [{"id": "<roster-123@asaop.org>", "hint": ""}], True, "INBOX")
    chk("marking seen stores +FLAGS \\Seen on the located uid",
        r.get("marked") == 1 and any(c[0] == "store" and c[2] == "+FLAGS" for c in calls))
    calls.clear()
    r = m._imap_mark("u", "p", [{"id": "<roster-123@asaop.org>", "hint": ""}], False, "INBOX")
    chk("unmarking uses -FLAGS — the same door swings both ways",
        r.get("marked") == 1 and any(c[0] == "store" and c[2] == "-FLAGS" for c in calls))
    r = m._imap_mark("u", "p", [{"id": "<gone@nowhere>", "hint": ""}], True, "INBOX")
    chk("a message that is not there marks nothing and says so", r.get("marked") == 0)

    print("\nLOCATING — three keys, in falling order of trust")
    conn = FakeConn("h", 143)
    chk("a Message-ID finds by header", m._imap_locate(conn, "<roster-123@asaop.org>", "") == [b"7"])
    chk("no Message-ID falls to the SUBJECT hint",
        m._imap_locate(conn, "<unknown@x>", "No message id here") == [b"9"])
    chk("a bare sequence number (the inbox's own fallback id) is used as-is",
        m._imap_locate(conn, "42", "") == [b"42"])
    chk("nothing matches → empty, never a guess", m._imap_locate(conn, "<zzz@x>", "zzz") == [])

    print("\nTHE UNREAD BADGE — STATUS, no fetch, no flags")
    calls.clear()
    n = m._imap_unread_count("u", "p")
    chk("UNSEEN is read from STATUS alone", n == 4 and
        any(c[0] == "status" for c in calls) and not any(c[0] == "fetch" for c in calls))

    print("\nTHE FOLDER SHAPE — driven through the REAL route, not a copy of its regex")
    # Drive the route itself: a copy of its regex would not see the route's own check break.
    import asyncio
    class FakeReq:
        def __init__(self, body): self._b = body
        async def json(self): return self._b
    def file_status(folder):
        body = {"service_secret": m.SERVICE_SECRET, "user": "u", "password": "p",
                "folder": folder, "items": [{"id": "<roster-123@asaop.org>", "hint": ""}]}
        return asyncio.run(m.mail_file(FakeReq(body)))["status"]
    if not m.SERVICE_SECRET:
        chk("route drive needs HUB_SERVICE_SECRET in this container", False,
            "cannot drive /mail/file without the secret the route compares against")
    else:
        chk("Archive and Trash pass by exact name, through the route",
            file_status("Archive") == 200 and file_status("Trash") == 200)
        chk("the watcher's own folders still pass", file_status("Staff Late Show") == 200)
        chk("junk shapes are refused BY THE ROUTE before any IMAP",
            all(file_status(f) == 400 for f in
                ("archive", "Trash ", "INBOX.Sub", "Trash; DELETE FROM x", "Drafts")),
            "a folder name is caller input on its way to an IMAP conversation")
        moved_calls = [c for c in calls if c[0] == "copy"]
        chk("a lawful move really COPIES on the wire", len(moved_calls) >= 1, str(moved_calls[:2]))

    print(f"\nmail doors: {fails[0]} failed\n")
    return 1 if fails[0] else 0


if __name__ == "__main__":
    sys.exit(main())
