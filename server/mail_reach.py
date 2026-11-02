"""Whether a letter can reach an address, asked before it is sent.
Two facts, both already on this host: the recipient domain's MX records (RFC 5321 5.1, RFC 7505 null MX) and…"""
from __future__ import annotations

import random
import re
import socket
import struct
from datetime import datetime, timezone
from email.message import Message
from email.utils import parsedate_to_datetime
from typing import Any, Callable, Iterable

ADDRESS = re.compile(r"^[^\s@\"'<>(),;:\\]+@([A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+)$")
QTYPE_MX = 15
QCLASS_IN = 1
RCODE_NXDOMAIN = 3
# The states that answer "this domain cannot receive mail"; every other state is unknown or deliverable.
DEAD_DOMAIN = ("nxdomain", "null_mx", "no_mx")
BOUNCE_DAYS = 30


def address_domain(address: str) -> str:
    """The domain of a well-formed address, lower case; '' for anything else."""
    m = ADDRESS.match(str(address or "").strip())
    return m.group(1).lower() if m else ""


def query_packet(domain: str, qid: int, qtype: int = QTYPE_MX) -> bytes:
    """One recursive question for `domain`."""
    labels = [p for p in domain.strip(".").split(".") if p]
    if not labels or any(len(p) > 63 for p in labels):
        raise ValueError("not a domain name")
    name = b"".join(struct.pack("B", len(p)) + p.encode("ascii") for p in labels) + b"\x00"
    return struct.pack(">HHHHHH", qid, 0x0100, 1, 0, 0, 0) + name + struct.pack(">HH", qtype, QCLASS_IN)


def _skip_name(buf: bytes, at: int) -> int:
    """The offset just past a (possibly compressed) name."""
    for _ in range(128):
        if at >= len(buf):
            raise ValueError("name runs past the packet")
        n = buf[at]
        if n == 0:
            return at + 1
        if n & 0xC0 == 0xC0:
            return at + 2
        at += 1 + n
    raise ValueError("name too long")


def _read_name(buf: bytes, at: int) -> str:
    labels: list[str] = []
    for _ in range(128):
        if at >= len(buf):
            raise ValueError("name runs past the packet")
        n = buf[at]
        if n == 0:
            return ".".join(labels)
        if n & 0xC0 == 0xC0:
            at = ((n & 0x3F) << 8) | buf[at + 1]
            continue
        labels.append(buf[at + 1:at + 1 + n].decode("ascii", "replace"))
        at += 1 + n
    raise ValueError("name loops")


def parse_answer(buf: bytes, qid: int) -> dict[str, Any]:
    """{rcode, truncated, mx: [(preference, host)]} from one reply to `qid`."""
    if len(buf) < 12:
        raise ValueError("short reply")
    rid, flags, qd, an, _ns, _ar = struct.unpack(">HHHHHH", buf[:12])
    if rid != qid or not flags & 0x8000:
        raise ValueError("not the answer to this question")
    at = 12
    for _ in range(qd):
        at = _skip_name(buf, at) + 4
    mx: list[tuple[int, str]] = []
    for _ in range(an):
        at = _skip_name(buf, at)
        rtype, _rclass, _ttl, rdlen = struct.unpack(">HHIH", buf[at:at + 10])
        at += 10
        if rtype == QTYPE_MX:
            pref = struct.unpack(">H", buf[at:at + 2])[0]
            mx.append((pref, _read_name(buf, at + 2).lower()))
        at += rdlen
    return {"rcode": flags & 0x000F, "truncated": bool(flags & 0x0200), "mx": mx}


def mx_state(answer: dict[str, Any] | None) -> str:
    """mx | null_mx | no_mx | nxdomain | unknown — what one reply says about a domain."""
    if not answer:
        return "unknown"
    if answer.get("rcode") == RCODE_NXDOMAIN:
        return "nxdomain"
    if answer.get("rcode") != 0:
        return "unknown"
    hosts = answer.get("mx") or []
    if not hosts:
        return "unknown" if answer.get("truncated") else "no_mx"
    if len(hosts) == 1 and hosts[0][1] in ("", "."):
        return "null_mx"
    return "mx"


def resolvers(path: str = "/etc/resolv.conf") -> list[str]:
    try:
        with open(path, encoding="utf-8") as fh:
            found = [ln.split()[1] for ln in fh if ln.strip().startswith("nameserver") and len(ln.split()) > 1]
    except OSError:
        found = []
    return found[:3]


def mx_lookup(domain: str, timeout: float = 3.0, servers: Iterable[str] | None = None,
              ask: Callable[[str, bytes, float], bytes] | None = None) -> str:
    """The domain's state from the first resolver that answers; `unknown` when none does."""
    def _udp(server: str, packet: bytes, wait: float) -> bytes:
        family = socket.AF_INET6 if ":" in server else socket.AF_INET
        with socket.socket(family, socket.SOCK_DGRAM) as s:
            s.settimeout(wait)
            s.sendto(packet, (server, 53))
            data, _ = s.recvfrom(4096)
            return data

    ask = ask or _udp
    for server in list(servers if servers is not None else resolvers()):
        qid = random.randrange(1, 65535)
        try:
            state = mx_state(parse_answer(ask(server, query_packet(domain, qid), timeout), qid))
        except Exception:  # noqa: BLE001 — one resolver's silence is not the domain's answer
            continue
        if state != "unknown":
            return state
    return "unknown"


def _part_fields(part: Message) -> list[dict[str, str]]:
    """The per-recipient field groups of one message/delivery-status part."""
    payload = part.get_payload()
    groups: list[Message] = []
    if isinstance(payload, list):
        groups = [p for p in payload if isinstance(p, Message)]
    elif isinstance(payload, (str, bytes)):
        text = payload.decode("utf-8", "replace") if isinstance(payload, bytes) else payload
        from email import message_from_string
        groups = [message_from_string(block) for block in re.split(r"\r?\n\r?\n", text) if block.strip()]
    out: list[dict[str, str]] = []
    for g in groups:
        out.append({k.lower(): str(v) for k, v in g.items()})
    return out


def failed_recipients(msg: Message) -> list[dict[str, str]]:
    """Every recipient a delivery report says FAILED: [{recipient, status, diagnostic}]."""
    found: list[dict[str, str]] = []
    for part in msg.walk():
        if part.get_content_type() != "message/delivery-status":
            continue
        for fields in _part_fields(part):
            if fields.get("action", "").strip().lower() != "failed":
                continue
            raw = fields.get("final-recipient") or fields.get("original-recipient") or ""
            rcpt = raw.split(";", 1)[-1].strip().strip("<>").lower()
            if rcpt:
                found.append({"recipient": rcpt, "status": fields.get("status", "").strip()[:12],
                              "diagnostic": fields.get("diagnostic-code", "").strip()[:160]})
    return found


def bounce_for(msg: Message, address: str) -> dict[str, str] | None:
    """The failure this report records for `address`, with the report's date; None when it names none."""
    want = str(address or "").strip().lower()
    for hit in failed_recipients(msg):
        if hit["recipient"] == want:
            at = ""
            try:
                when = parsedate_to_datetime(str(msg.get("Date") or ""))
                if when is not None:
                    at = when.astimezone(timezone.utc).isoformat(timespec="seconds")
            except Exception:  # noqa: BLE001 — a report without a date still records the failure
                at = ""
            return {"at": at, "status": hit["status"]}
    return None


def verdict(domain_state: str, bounce: dict[str, str] | None) -> dict[str, Any]:
    """{deliverable: True | False | None, why} — None is unknown, and unknown is sent."""
    if domain_state in DEAD_DOMAIN:
        return {"deliverable": False, "why": domain_state}
    if bounce:
        return {"deliverable": False, "why": "bounced", "bounced_at": bounce.get("at", ""),
                "status": bounce.get("status", "")}
    if domain_state == "mx":
        return {"deliverable": True, "why": ""}
    return {"deliverable": None, "why": ""}


def since_date(days: int = BOUNCE_DAYS, now: datetime | None = None) -> str:
    """The IMAP SINCE word for `days` ago."""
    from datetime import timedelta
    at = (now or datetime.now(timezone.utc)) - timedelta(days=days)
    return at.strftime("%d-%b-%Y")


def withhold(text: str, secrets: Iterable[str]) -> str:
    """The words with every named secret replaced, for the copy a mailbox keeps."""
    out = str(text or "")
    for s in secrets or []:
        s = str(s or "")
        if len(s) >= 4:
            out = out.replace(s, "{withheld}")
    return out
