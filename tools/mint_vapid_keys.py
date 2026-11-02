#!/usr/bin/env python3
"""
Mint the platform's VAPID pair once (server/web_push.py signs with it). A usable file is kept, since a new pair
orphans every subscribed device; an unusable one is replaced only with --replace. The private key is never printed.

    python3 tools/mint_vapid_keys.py --dry-run
    python3 tools/mint_vapid_keys.py
    python3 tools/mint_vapid_keys.py --subject mailto:someone@example.org
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

DEFAULT_PATH = Path("/opt/docker/secrets/seal/webpush-vapid.json")
DEFAULT_SUBJECT = "https://asamylife.asalifecare.com"


def b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def b64url_decode(text: str) -> bytes:
    raw = str(text or "").strip()
    return base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4))


def mint(subject: str) -> dict[str, str]:
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import ec

    key = ec.generate_private_key(ec.SECP256R1())
    scalar = key.private_numbers().private_value.to_bytes(32, "big")
    point = key.public_key().public_bytes(serialization.Encoding.X962,
                                          serialization.PublicFormat.UncompressedPoint)
    return {"public_key": b64url(point), "private_key": b64url(scalar), "subject": subject,
            "created_at": datetime.now(timezone.utc).isoformat(), "format": "vapid/p256"}


def usable(body: object) -> str:
    """'' when the relay can sign with this pair (the private key derives the public one), else why not."""
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import ec

    if not isinstance(body, dict):
        return "it is not a JSON object"
    try:
        point = b64url_decode(str(body["public_key"]))
        scalar = b64url_decode(str(body["private_key"]))
    except Exception as exc:  # noqa: BLE001
        return f"a key is missing or not base64url ({type(exc).__name__})"
    if len(point) != 65 or point[0] != 4:
        return "the public key is not an uncompressed P-256 point"
    if len(scalar) != 32:
        return "the private key is not a 32-byte P-256 scalar"
    subject = str(body.get("subject") or "")
    if not (subject.startswith("mailto:") or subject.startswith("https://")):
        return "the subject is not a mailto: or https:// address"
    try:
        derived = ec.derive_private_key(int.from_bytes(scalar, "big"), ec.SECP256R1()).public_key()
        again = derived.public_bytes(serialization.Encoding.X962,
                                     serialization.PublicFormat.UncompressedPoint)
    except Exception as exc:  # noqa: BLE001
        return f"the private key is not a P-256 key ({type(exc).__name__})"
    if again != point:
        return "the private key does not belong to the public key beside it"
    return ""


def write(path: Path, body: dict[str, str]) -> None:
    """Whole or not at all, 0600 from the first byte, never through a link."""
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.is_symlink():
        raise SystemExit(f"refusing: {path} is a symbolic link")
    fd, tmp = tempfile.mkstemp(prefix=".webpush-vapid.", suffix=".tmp", dir=str(path.parent))
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(body, fh, indent=2)
            fh.write("\n")
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise
    os.chmod(path, 0o600)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Mint the platform's VAPID pair, once.")
    ap.add_argument("--path", type=Path, default=DEFAULT_PATH)
    ap.add_argument("--subject", default=DEFAULT_SUBJECT,
                    help="a mailto: or https:// address the push services may write to")
    ap.add_argument("--dry-run", action="store_true", help="say what would happen, write nothing")
    ap.add_argument("--replace", action="store_true",
                    help="write a new pair over a file that is NOT usable (a usable pair is always kept)")
    args = ap.parse_args(argv)

    if not (args.subject.startswith("mailto:") or args.subject.startswith("https://")):
        print("refusing: --subject must be a mailto: or https:// address", file=sys.stderr)
        return 2
    try:
        import cryptography  # noqa: F401
    except ImportError:
        print("refusing: the `cryptography` package is not importable here", file=sys.stderr)
        return 2

    path: Path = args.path
    if path.exists():
        try:
            body = json.loads(path.read_text(encoding="utf-8"))
        except Exception as exc:  # noqa: BLE001
            body, why = None, f"it is not JSON ({type(exc).__name__})"
        else:
            why = usable(body)
        if not why:
            mode = path.stat().st_mode & 0o777
            if mode != 0o600 and not args.dry_run:
                os.chmod(path, 0o600)
                print(f"kept: {path} (its mode was {oct(mode)}, now 0600)")
            else:
                print(f"kept: {path} already holds a usable pair — nothing was written")
            print(f"public key: {body['public_key']}")
            print(f"subject:    {body.get('subject')}")
            return 0
        if not args.replace:
            print(f"refusing: {path} exists and is not a usable pair ({why}). Look at it first; "
                  "--replace writes a new pair over it, and every device subscribed with the old "
                  "one must subscribe again.", file=sys.stderr)
            return 2
        print(f"replacing: {path} is not a usable pair ({why})")

    if args.dry_run:
        print(f"dry run: would write a new P-256 pair to {path} (0600), subject {args.subject}")
        return 0
    body = mint(args.subject)
    write(path, body)
    again = json.loads(path.read_text(encoding="utf-8"))
    why = usable(again)
    if why:
        print(f"FAILED: the file written to {path} does not read back as a usable pair ({why})",
              file=sys.stderr)
        return 1
    print(f"written: {path} (0600)")
    print(f"public key: {again['public_key']}")
    print(f"subject:    {again['subject']}")
    print("the relay reads it as /srv/secrets/webpush-vapid.json on its next push")
    return 0


if __name__ == "__main__":
    sys.exit(main())
