"""Seal words with CMS AuthEnvelopedData (RSA-OAEP + AES-256-GCM) to a public key; this machine can never open them."""
from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
from datetime import datetime, timezone

# public certificate only: a private key or a passphrase must never live on this machine
PUBLIC_PATHS = [
    os.getenv("COMM_SEAL_PUBLIC") or "",
    "/srv/secrets/asa-seal-public.pem",
    "/opt/docker/secrets/asa-seal-public.pem",
]

ALG = "cms-authenveloped:rsa-oaep-sha256+aes-256-gcm"

TIMEOUT_S = float(os.getenv("COMM_SEAL_TIMEOUT", "30"))

_KEY: dict | None = None


class SealUnavailable(RuntimeError):
    """No key to seal to: fail closed, never store the words in the clear."""


# not the cryptography library: its PKCS7 builder is unauthenticated CBC and opens wrong keys silently
def _openssl(args: list[str], stdin: bytes) -> bytes:
    try:
        done = subprocess.run(["openssl", *args], input=stdin,
                              stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                              timeout=TIMEOUT_S, check=False)
    except FileNotFoundError as exc:
        raise SealUnavailable("openssl is not on PATH — nothing can be sealed") from exc
    except subprocess.TimeoutExpired as exc:
        raise SealUnavailable(f"openssl did not answer in {TIMEOUT_S}s") from exc
    if done.returncode != 0:
        # stderr only: on failure stdout may hold partial plaintext
        why = done.stderr.decode("utf-8", "replace").strip().splitlines()
        raise SealUnavailable("openssl refused: " + (why[-1] if why else f"rc={done.returncode}"))
    return done.stdout


def key() -> dict:
    """Parsed as a certificate before any call is read, so a bad key fails before words move."""
    global _KEY
    if _KEY is not None:
        return _KEY
    tried = []
    for path in PUBLIC_PATHS:
        if not path:
            continue
        tried.append(path)
        if not os.path.exists(path):
            continue
        raw = open(path, "rb").read()
        if b"PRIVATE KEY" in raw:
            raise SealUnavailable(
                f"{path} contains a PRIVATE KEY. The private half must never be on this "
                "machine — shred it here and send only the public certificate")
        out = _openssl(["x509", "-noout", "-fingerprint", "-sha256", "-in", path], b"")
        fpr = re.sub(r"^.*Fingerprint\s*=\s*", "", out.decode("utf-8", "replace").strip())
        fpr = fpr.replace(":", "").lower()
        if len(fpr) != 64:
            raise SealUnavailable(f"{path} did not yield a certificate fingerprint")
        _KEY = {"path": path, "fingerprint": fpr}
        return _KEY
    raise SealUnavailable(
        "the keyholder's public certificate is not on this machine (looked in: "
        + ", ".join(tried) + ") — nothing may be read until it is, because a call read "
        "before there is a key to seal with leaves the words in the clear")


def available() -> bool:
    """Never raises."""
    try:
        key()
        return True
    except SealUnavailable:
        return False


def fingerprint() -> str:
    """Rows sealed to an old key keep its fingerprint: deleting an old private key destroys those words."""
    return key()["fingerprint"]


def envelope(text: str, call_id: str, field: str, item_no: str = "") -> dict:
    """call_id inside the seal binds it to its call; sha256 makes a wrong-key open evident."""
    body = text if isinstance(text, str) else str(text)
    return {
        "call_id": str(call_id or ""),
        "field": str(field or ""),
        "item_no": str(item_no or ""),
        "sealed_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "sha256": hashlib.sha256(body.encode("utf-8")).hexdigest(),
        "text": body,
    }


def seal(text: str, call_id: str, field: str, item_no: str = "") -> dict:
    """The only way words leave this process; store the DER as bytea, never in a Sheets cell (too long)."""
    body = text if isinstance(text, str) else str(text)
    if not body:
        raise ValueError("nothing to seal — an empty field is unread, never sealed as empty")
    env = envelope(body, call_id, field, item_no)
    fpr = fingerprint()
    der = _openssl([
        "cms", "-encrypt", "-aes-256-gcm", "-recip", key()["path"],
        "-keyopt", "rsa_padding_mode:oaep", "-keyopt", "rsa_oaep_md:sha256",
        "-binary", "-outform", "DER",
    ], json.dumps(env, ensure_ascii=False).encode("utf-8"))
    if not der:
        raise SealUnavailable("openssl produced no ciphertext")
    return {
        "ciphertext": der,
        "alg": ALG,
        "key_fp": fpr,
        "sealed_at": env["sealed_at"],
        "sha256": env["sha256"],
        "plain_len": len(body),
        "cipher_len": len(der),
    }


def open_command(der_path: str = "<sealed.der>",
                 private_path: str = "~/asa-seal/asa-seal-private.pem") -> str:
    """Documentation only: this module must never gain a decrypt function."""
    return (f"openssl cms -decrypt -inform DER -in {der_path} -inkey {private_path} "
            "; echo rc=$?   # rc MUST be 0 — openssl prints the bytes before it checks "
            "the GCM tag, so a non-zero rc means what you just read is not trustworthy")


if __name__ == "__main__":
    import sys
    try:
        info = key()
    except SealUnavailable as exc:
        sys.exit(str(exc))
    print(json.dumps({"public_certificate": info["path"],
                      "fingerprint_sha256": info["fingerprint"],
                      "alg": ALG,
                      "opens_with": open_command()}, indent=2))
