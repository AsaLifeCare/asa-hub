"""Badge worn -> badge it also answers as, one way: the app's one table (scope.BADGE_FOLLOWS), as the relay's
badge_follows names it."""

from __future__ import annotations

from scope import BADGE_FOLLOWS, BADGE_RENAMED, role_counts  # noqa: F401 - role_counts for the lanes' readers


def with_followed(worn: set[str]) -> set[str]:
    """Everything worn plus what each word stands in for (and a word renamed since, as its new one); never returns
    less than it was given."""
    out = {str(w).strip().upper() for w in worn if str(w).strip()}
    for word in list(out):
        stands = BADGE_FOLLOWS.get(word) or BADGE_RENAMED.get(word)
        if stands:
            out.add(stands)
    return out
