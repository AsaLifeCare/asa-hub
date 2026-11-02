"""Badge worn -> badge it also answers as, one way; check-badges.mjs keeps the SPA and Profile.gs copies equal."""

from __future__ import annotations

BADGE_FOLLOWS: dict[str, str] = {"SUPERVISOR": "DIRECTOR", "PLATFORMLEAD": "DIRECTOR"}


def with_followed(worn: set[str]) -> set[str]:
    """Everything worn plus what each word stands in for; never returns less than it was given."""
    out = {str(w).strip().upper() for w in worn if str(w).strip()}
    for word in list(out):
        stands = BADGE_FOLLOWS.get(word)
        if stands:
            out.add(stands)
    return out
