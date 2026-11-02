"""The decoder's verdict on one file's words, for the ledger lane (form_digest) and the decoder lab: read by the
decoder's Python translation (digest_engine.verdict), the same columns and meta Digest.gs gave when this lane ran it
in Node, so there is still one decoder; it never settles obligations (single writer)."""
from __future__ import annotations

import logging
from typing import Any, Optional

log = logging.getLogger("hub.engine")


def engine_ready() -> bool:
    """The decoder reads here: its Python translation loads."""
    try:
        import digest_engine  # noqa: F401, PLC0415 — the decoder, loaded with the lane
    except Exception:  # noqa: BLE001
        return False
    return True


def verdict(name: str, text: str, roster: Optional[dict] = None,
            vocab: Optional[dict] = None) -> Optional[dict[str, Any]]:
    """The engine's own verdict for one file's text, or None when it cannot read."""
    try:
        import digest_engine as DE  # noqa: PLC0415 — the decoder, loaded with the lane
        return DE.verdict(name, text, roster or {}, vocab or None)
    except Exception as exc:  # noqa: BLE001 — the caller stands down; the type only, a message may carry words
        log.warning("engine verdict failed (%s)", type(exc).__name__)
        return None
