#!/usr/bin/env python3
"""The relay's one SMTP door (/mail/send) and the question it asks before a letter that must arrive.

A letter leaves with a Message-ID (Gmail files one without it as non-compliant), with a display name only when the
caller names one, and the copy filed in Sent withholds the secrets the caller names. Asked to, the door refuses an
address that cannot receive mail (no MX, a null MX, no domain, or a delivery report that says it failed) with a 422
and sends nothing; a question it could not ask is unknown, and unknown is sent.

Pure: the relay's own source, with smtplib, imaplib and the resolver stood in for. No network, no mailbox."""
import __future__
import ast
import asyncio
import re
import struct
import sys
import time
import types
from email import message_from_bytes, policy
from email.message import EmailMessage
from pathlib import Path
from typing import Any

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parent.parent
SERVER = ROOT / "server"
SOURCE = (SERVER / "snapshot_service.py").read_text(encoding="utf-8")
TREE = ast.parse(SOURCE)
sys.path.insert(0, str(SERVER))
import mail_reach as mr  # noqa: E402

results: dict[str, Any] = {"ok": 0, "failed": []}


def check(name: str, ok: bool, detail: Any = None) -> None:
    if ok:
        results["ok"] += 1
        print(f"  ok   {name}")
    else:
        results["failed"].append(name)
        print(f"  FAIL {name}")
        if detail is not None:
            print(f"       {str(detail)[:1500]}")


def segment(name: str) -> str:
    for node in TREE.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == name:
            return ast.get_source_segment(SOURCE, node) or ""
    return ""


def load(ns: dict[str, Any], *names: str) -> None:
    for name in names:
        code = segment(name)
        check(f"the relay declares {name}", bool(code))
        exec(compile(code, f"relay:{name}", "exec",  # noqa: S102 - the relay's own source
                     flags=__future__.annotations.compiler_flag, dont_inherit=True), ns)


class Log:
    def __init__(self) -> None:
        self.lines: list[str] = []

    def warning(self, msg: str, *args: Any) -> None:
        self.lines.append(msg % args if args else msg)

    info = debug = warning


# ── the DNS answers, built byte by byte ───────────────────────────────────
def reply(qid: int, domain: str, rcode: int = 0, mx: list[tuple[int, str]] | None = None) -> bytes:
    q = mr.query_packet(domain, qid)[12:]
    body = b""
    for pref, host in mx or []:
        name = (b"".join(struct.pack("B", len(p)) + p.encode() for p in host.split(".") if p) + b"\x00"
                if host not in ("", ".") else b"\x00")
        rdata = struct.pack(">H", pref) + name
        # the owner name is a compression pointer to the question at offset 12
        body += b"\xc0\x0c" + struct.pack(">HHIH", 15, 1, 300, len(rdata)) + rdata
    head = struct.pack(">HHHHHH", qid, 0x8180 | rcode, 1, len(mx or []), 0, 0)
    return head + q + body


print("THE QUESTION AND ITS ANSWERS")
pk = mr.query_packet("gmail.com", 4242)
check("the question is one recursive MX question for the name",
      pk[:2] == struct.pack(">H", 4242) and pk[2:4] == b"\x01\x00" and b"\x05gmail\x03com\x00" in pk and
      pk.endswith(struct.pack(">HH", 15, 1)), pk)
check("a reply with two exchangers is `mx`",
      mr.mx_state(mr.parse_answer(reply(7, "gmail.com", mx=[(5, "gmail-smtp-in.l.google.com"),
                                                            (10, "alt1.gmail-smtp-in.l.google.com")]), 7)) == "mx")
check("NXDOMAIN is `nxdomain` (gmail.coml)", mr.mx_state(mr.parse_answer(reply(8, "gmail.coml", rcode=3), 8)) == "nxdomain")
check("an empty answer is `no_mx` (outloook.pt)", mr.mx_state(mr.parse_answer(reply(9, "outloook.pt"), 9)) == "no_mx")
check("a single exchanger at the root is the RFC 7505 null MX (gmail.co)",
      mr.mx_state(mr.parse_answer(reply(10, "gmail.co", mx=[(0, ".")]), 10)) == "null_mx")
check("SERVFAIL is unknown, never undeliverable", mr.mx_state(mr.parse_answer(reply(11, "x.org", rcode=2), 11)) == "unknown")
bad = False
try:
    mr.parse_answer(reply(12, "x.org"), 13)
except ValueError:
    bad = True
check("a reply to another question is refused", bad)

asked: list[str] = []


def ask(server: str, packet: bytes, _wait: float) -> bytes:
    asked.append(server)
    if server == "10.0.0.1":
        raise TimeoutError("silent")
    qid = struct.unpack(">H", packet[:2])[0]
    return reply(qid, "asalifecare.com", mx=[(1, "aspmx.l.google.com")])


check("a silent resolver is passed over for the next one",
      mr.mx_lookup("asalifecare.com", servers=["10.0.0.1", "10.0.0.2"], ask=ask) == "mx" and
      asked == ["10.0.0.1", "10.0.0.2"], asked)
check("no resolver answering is unknown",
      mr.mx_lookup("asalifecare.com", servers=["10.0.0.1"], ask=ask) == "unknown")
check("a malformed address has no domain to ask",
      mr.address_domain("ty bond@x.org") == "" and mr.address_domain('"a"@x.org') == "" and
      mr.address_domain("Ty.Bond@ABrighterDawnInc.com") == "abrighterdawninc.com")


# ── the delivery reports ──────────────────────────────────────────────────
def dsn(rcpt: str, action: str = "failed", status: str = "5.1.1", date: str = "Tue, 29 Sep 2026 21:00:00 +0000") -> Any:
    m = EmailMessage()
    m["From"] = "MAILER-DAEMON@mail.asaop.org (Mail Delivery System)"
    m["To"] = "asa-hub@asaop.org"
    m["Subject"] = "Undelivered Mail Returned to Sender"
    m["Date"] = date
    m.set_content("This is the mail system at host mail.asaop.org.\n\nI'm sorry to have to inform you...")
    ds = ("Reporting-MTA: dns; mail.asaop.org\n\n"
          f"Final-Recipient: rfc822; {rcpt}\nOriginal-Recipient: rfc822;{rcpt}\nAction: {action}\n"
          f"Status: {status}\nDiagnostic-Code: smtp; 550 5.1.1 The email account that you tried to reach does not exist\n")
    raw = m.as_bytes().decode()
    boundary = "=_report_boundary"
    report = (f"From: {m['From']}\nTo: {m['To']}\nSubject: {m['Subject']}\nDate: {date}\nMIME-Version: 1.0\n"
              f'Content-Type: multipart/report; report-type=delivery-status; boundary="{boundary}"\n\n'
              f"--{boundary}\nContent-Type: text/plain\n\nI'm sorry to have to inform you.\n\n"
              f"--{boundary}\nContent-Type: message/delivery-status\n\n{ds}\n"
              f"--{boundary}\nContent-Type: text/rfc822-headers\n\nTo: {rcpt}\nSubject: x\n\n--{boundary}--\n")
    del raw
    return message_from_bytes(report.encode(), policy=policy.default)


print("THE DELIVERY REPORTS THE MAILBOX ALREADY HOLDS")
hit = mr.bounce_for(dsn("person@gmail.com"), "Person@gmail.com")
check("a report whose Action is failed records the address, the status and when",
      hit == {"at": "2026-09-29T21:00:00+00:00", "status": "5.1.1"}, hit)
check("a delayed report is not a failure", mr.bounce_for(dsn("person@gmail.com", action="delayed", status="4.4.1"),
                                                        "person@gmail.com") is None)
check("a report about somebody else says nothing about this address",
      mr.bounce_for(dsn("other@gmail.com"), "person@gmail.com") is None)
check("verdict: a dead domain is undeliverable before any report is read",
      mr.verdict("nxdomain", None) == {"deliverable": False, "why": "nxdomain"} and
      mr.verdict("null_mx", None)["deliverable"] is False and mr.verdict("no_mx", None)["deliverable"] is False)
check("verdict: a recorded failure is undeliverable, and says when",
      mr.verdict("mx", {"at": "2026-09-29T21:00:00+00:00", "status": "5.1.1"}) ==
      {"deliverable": False, "why": "bounced", "bounced_at": "2026-09-29T21:00:00+00:00", "status": "5.1.1"})
check("verdict: exchangers and no report is deliverable; a question not answered is unknown (sent)",
      mr.verdict("mx", None)["deliverable"] is True and mr.verdict("unknown", None)["deliverable"] is None)
check("the copy a mailbox keeps withholds every named secret, and nothing shorter than four characters",
      mr.withhold("pw Xk7pQ2 and Xk7pQ2 again", ["Xk7pQ2", "ab"]) == "pw {withheld} and {withheld} again")


# ── the door itself, over stand-in transports ─────────────────────────────
sent: list[Any] = []
filed: list[Any] = []
imap_calls: list[tuple] = []
DSN_RAW = dsn("gone@gmail.com").as_bytes()


class FakeSMTP:
    def __init__(self, host: str, port: int, timeout: float = 0) -> None:
        pass

    def __enter__(self) -> "FakeSMTP":
        return self

    def __exit__(self, *a: Any) -> None:
        return None

    def starttls(self) -> None:
        pass

    def login(self, u: str, p: str) -> None:
        pass

    def send_message(self, msg: Any) -> dict:
        sent.append(msg)
        return {}


class FakeIMAP:
    def __init__(self, host: str, port: int, timeout: float = 0) -> None:
        imap_calls.append(("connect",))

    def starttls(self) -> None:
        pass

    def login(self, u: str, p: str) -> None:
        pass

    def append(self, box: str, flags: str, when: Any, raw: bytes) -> tuple:
        filed.append((box, message_from_bytes(raw, policy=policy.default)))
        return ("OK", [b""])

    def list(self, *a: Any) -> tuple:
        return ("OK", [b'(\\HasNoChildren) "." "INBOX"', b'(\\HasNoChildren) "." "Mail Bounces"'])

    def select(self, box: str, readonly: bool = False) -> tuple:
        imap_calls.append(("select", box, readonly))
        return ("OK", [b"1"])

    def uid(self, cmd: str, *args: Any) -> tuple:
        imap_calls.append(("uid", cmd) + args)
        if cmd == "search":
            return ("OK", [b"41" if '"gone@gmail.com"' in args else b""])
        return ("OK", [(b"41 (BODY[] {n}", DSN_RAW), b")"])

    def logout(self) -> None:
        pass


sys.modules["smtplib"] = types.SimpleNamespace(SMTP=FakeSMTP)  # type: ignore[assignment]
sys.modules["imaplib"] = types.SimpleNamespace(IMAP4=FakeIMAP, Time2Internaldate=lambda t: '"30-Sep-2026 12:00:00 +0000"')  # type: ignore[assignment]

log = Log()
ns: dict[str, Any] = {"Any": Any, "re": re, "time": time, "asyncio": asyncio, "log": log, "mail_reach": mr,
                      "MAIL_HOST": "mail.test", "MAIL_SMTP_PORT": 587, "MAIL_IMAP_PORT": 143,
                      "MAIL_DOMAIN": "asaop.org", "SERVICE_SECRET": "s3cret-service", "_mail_send_seen": {}}
load(ns, "_mail_compose", "_smtp_send", "_imap_folders", "_imap_bounce", "_mail_reach", "_mail_auth_ok",
     "_mail_own_creds", "mail_send")
ns["hmac"] = __import__("hmac")
ns["MAIL_CREDS_FILE"] = Path("/nonexistent/hub-mail-creds.json")

print("THE LETTER THAT LEAVES")
PW = "Xk7pQ2rTz9Ab"
receipt, mid = ns["_smtp_send"]("asa-hub@asaop.org", "p", "ty@example.org", "ASA MyLife — your temporary password",
                                f"Your temporary password is {PW}.", f"<p>Your temporary password is {PW}.</p>", "",
                                "ASA MyLife", [PW])
out = sent[-1]
check("it carries exactly one Message-ID, at the sender's domain, and the door returns it",
      len(out.get_all("Message-ID") or []) == 1 and re.fullmatch(r"<[^<>@\s]+@asaop\.org>", str(out["Message-ID"]))
      and str(out["Message-ID"]) == mid and receipt == "queued", (out["Message-ID"], mid, receipt))
check("with a name given, From is `ASA MyLife <asa-hub@asaop.org>`",
      str(out["From"]) == "ASA MyLife <asa-hub@asaop.org>", out["From"])
check("the person receives the secret, in both halves",
      PW in out.get_body(("plain",)).get_content() and PW in out.get_body(("html",)).get_content())
box, copy = filed[-1]
check("the copy filed in Sent carries {withheld} in its place, in both halves, under the same Message-ID",
      box == "Sent" and PW not in copy.as_string() and "{withheld}" in copy.get_body(("plain",)).get_content() and
      "{withheld}" in copy.get_body(("html",)).get_content() and str(copy["Message-ID"]) == mid)
ns["_smtp_send"]("mbox@asaop.org", "p", "a@example.org", "Hello", "words")
check("with no name the From stays the bare address, and a letter naming no secret is filed as sent",
      str(sent[-1]["From"]) == "mbox@asaop.org" and filed[-1][1].get_body(("plain",)).get_content().strip() == "words")


class Req:
    def __init__(self, body: dict) -> None:
        self._b = body

    async def json(self) -> dict:
        return self._b


def post(body: dict) -> dict:
    return asyncio.run(ns["mail_send"](Req(body)))


BASE = {"service_secret": "s3cret-service", "user": "asa-hub@asaop.org", "password": "p",
        "subject": "s", "body": "b"}

print("THE DOOR, ASKED TO LOOK FIRST")
reach_asked: list[str] = []
real_reach = ns["_mail_reach"]
ns["_mail_reach"] = lambda u, p, a: (reach_asked.append(a) or {"deliverable": False, "why": "bounced",
                                                              "bounced_at": "2026-09-29T21:00:00+00:00"})
n0 = len(sent)
got = post(dict(BASE, to="gone@gmail.com", check_reach=True, send_id="pm_1"))
check("an undeliverable address is refused with 422, says why, and nothing is sent",
      got["status"] == 422 and got["data"]["undeliverable"] == "bounced" and len(sent) == n0, got)
check("a refusal leaves no dedup mark — the same send id may be tried again", "pm_1" not in ns["_mail_send_seen"])
got = post(dict(BASE, to="gone@gmail.com", send_id="pm_2"))
check("not asked, the door does not look — every other caller is unchanged",
      got["status"] == 200 and reach_asked == ["gone@gmail.com"] and len(sent) == n0 + 1, (got, reach_asked))
ns["_mail_reach"] = lambda u, p, a: {"deliverable": None, "why": ""}
got = post(dict(BASE, to="who@example.org", check_reach=True, from_name='ASA "My"\r\nLife',
                withhold=["Xk7pQ2rTz9Ab"], body="pw Xk7pQ2rTz9Ab"))
check("unknown is sent, and the answer carries the Message-ID",
      got["status"] == 200 and got["data"]["message_id"].endswith("@asaop.org>"), got)
check("the name cannot break the header, and the withheld words travel to the filed copy",
      str(sent[-1]["From"]) == "ASA MyLife <asa-hub@asaop.org>" and "Xk7pQ2rTz9Ab" not in filed[-1][1].as_string(),
      sent[-1]["From"])
ns["_mail_reach"] = real_reach

print("THE QUESTION ITSELF")
mr_lookup = mr.mx_lookup
mr.mx_lookup = lambda domain, **k: "nxdomain" if domain == "gmail.coml" else "mx"
imap_calls.clear()
check("a dead domain is undeliverable and the mailbox is not even opened",
      ns["_mail_reach"]("u", "p", "someone@gmail.coml") == {"deliverable": False, "why": "nxdomain"} and not imap_calls)
v = ns["_mail_reach"]("u", "p", "Gone@Gmail.com")
check("a failure report in the mailbox makes a live domain undeliverable",
      v["deliverable"] is False and v["why"] == "bounced" and v["bounced_at"] == "2026-09-29T21:00:00+00:00", v)
check("every folder was opened read-only and read with BODY.PEEK — nothing is marked seen",
      all(c[2] is True for c in imap_calls if c[0] == "select") and
      any(c[0] == "uid" and c[1] == "fetch" and "PEEK" in str(c[3]) for c in imap_calls), imap_calls)
check("the search asks for reports from MAILER-DAEMON naming the address, not the whole mailbox",
      any(c[0] == "uid" and c[1] == "search" and '"MAILER-DAEMON"' in c and '"gone@gmail.com"' in c
          for c in imap_calls), imap_calls)
check("a clean address with exchangers is deliverable", ns["_mail_reach"]("u", "p", "fine@gmail.com")["deliverable"] is True)


def boom(*a: Any, **k: Any) -> Any:
    raise OSError("no mailbox")


keep_bounce = ns["_imap_bounce"]
ns["_imap_bounce"] = boom
v = ns["_mail_reach"]("u", "p", "fine@gmail.com")
check("a mailbox that will not answer is not a bounce", v["deliverable"] is True and any("bounce lookup failed" in l for l in log.lines), v)
ns["_imap_bounce"] = keep_bounce
mr.mx_lookup = mr_lookup
check("nothing the door logged names an address", not any("@" in line for line in log.lines), log.lines)

print(f"\nmail reach: {results['ok']} ok, {len(results['failed'])} failed")
sys.exit(1 if results["failed"] else 0)
