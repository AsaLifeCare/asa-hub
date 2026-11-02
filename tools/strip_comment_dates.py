#!/usr/bin/env python3
"""
TAKE THE DATES OUT OF THE COMMENTS — and out of nothing else.

THE RULE: no dates in comments and no dates in headers. A date in
a comment reads as a fact about the code and is almost always a fact about the
DAY somebody worked: it ages badly, it invites a reader to trust a stale note,
and it says nothing the git history does not say better.

WHAT IT WILL NOT TOUCH, and this is most of the file:

  · CODE. A date in a string, a default, a fixture, a schema value or a stamp
    is data — `HUB_CODE_BUILD` is the one date this platform keeps on purpose,
    and it lives in code. Only lines the language reads as a COMMENT are
    rewritten: `//`, `#`, a `*` continuation inside a block, and a `/* … */`
    that opens and closes on one line.
  · A DOCSTRING'S CODE. Python docstrings are treated as comments only when
    the line is inside a triple-quoted block that started on its own line —
    the shape every module header in this repo uses.
  · A DATE THAT IS THE POINT. A line naming a migration window, a legal
    retention period or a version somebody must be able to find again keeps
    its date when it carries one of the KEEP words.

WHAT IT DOES: rewrites the common shapes so the sentence still reads —
"(review, 2026-08-20: …" becomes "(review: …", "(2026-09-07)" disappears,
"on 2026-08-16" disappears — then tidies the double spaces, the orphan commas
and the empty brackets it leaves behind.

    python3 strip_comment_dates.py --dry-run apps-script
    python3 strip_comment_dates.py apps-script src server
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path("/opt/docker/asa-hub")

SUFFIXES = {".gs", ".ts", ".tsx", ".js", ".mjs", ".py"}

# A line whose date is the point of the line, not a note about when somebody
# typed it. Matched case-insensitively against the whole line.
KEEP = (
    "hub_code_build", "retention", "retain", "legal", "statute", "contract",
    "migration window", "cutover", "valid from", "valid until", "expires on",
    "effective date", "@since", "copyright",
)

DATE = r"20[0-9]{2}-[0-9]{2}-[0-9]{2}"

# Order matters: the longest, most specific shapes first.
RULES: list[tuple[str, str]] = [
    # (review, 2026-08-20: "…"     →   (review: "…"
    (rf"\(([A-Za-z][A-Za-z ]*?),\s*{DATE}\s*:", r"(\1:"),
    # (review, 2026-08-20)         →   (review)
    (rf"\(([A-Za-z][A-Za-z ]*?),\s*{DATE}\)", r"(\1)"),
    # (2026-08-20, sixth round)    →   (sixth round)
    (rf"\(\s*{DATE}\s*,\s*", "("),
    # , 2026-08-20 — the …         →   , the …   /   … — 2026-08-20 — …
    (rf",\s*{DATE}\s*(?=[—–-])", " "),
    # (2026-08-20)  ·  [2026-08-20]
    (rf"\s*\(\s*{DATE}\s*\)", ""),
    (rf"\s*\[\s*{DATE}\s*\]", ""),
    # on 2026-08-20 · since 2026-08-20 · until 2026-08-20 · by 2026-08-20
    (rf"\s+(?:on|since|until|by|from|of|at|in)\s+{DATE}\b", ""),
    # 2026-08-20: the sentence     →   the sentence
    (rf"\b{DATE}\s*:\s*", ""),
    # 2026-08-20T13:04:05Z or a bare date left anywhere else
    (rf"\b{DATE}T[0-9:.]+Z?", ""),
    (rf"\b{DATE}\b", ""),
]

TIDY: list[tuple[str, str]] = [
    (r"\(\s*,\s*", "("),
    (r"\s+,", ","),
    (r",\s*\)", ")"),
    (r"\(\s*\)", ""),
    (r"\s*\(\s*—\s*", " ("),
    (r"[ \t]{2,}(?=\S)", " "),
    (r"\s+([.;,])", r"\1"),
    # A DATE THAT WAS THE OBJECT OF ITS SENTENCE leaves the words that pointed
    # at it hanging — "the kill list of the" reads worse than no note at all.
    # Only at the end of the line, and only the handful of words that can only
    # have been pointing at the date.
    (r"\s+(?:of|on|in|from|at|since|by|until)(?:\s+the)?\s*$", ""),
    (r"\s+the\s*$", ""),
    (r"\s+$", ""),
]


def is_comment_line(line: str, suffix: str, in_block: bool) -> bool:
    s = line.strip()
    if suffix == ".py":
        return in_block or s.startswith("#")
    if in_block:
        return True
    if s.startswith("//") or s.startswith("*"):
        return True
    return s.startswith("/*") and "*/" in s


def block_state(line: str, suffix: str, in_block: bool) -> bool:
    """Whether the NEXT line is inside a comment block."""
    s = line.strip()
    if suffix == ".py":
        # a docstring that opens on its own line, the shape every header uses
        if in_block:
            return s.count('"""') % 2 == 0 and not s.endswith('"""') if '"""' in s else True
        return s.startswith('"""') and s.count('"""') == 1
    if in_block:
        return "*/" not in line
    return "/*" in line and "*/" not in line


def strip_line(line: str) -> str:
    low = line.lower()
    if any(word in low for word in KEEP):
        return line
    out = line
    for pattern, repl in RULES:
        out = re.sub(pattern, repl, out)
    if out == line:
        return line
    for pattern, repl in TIDY:
        out = re.sub(pattern, repl, out)
    # A comment left with nothing but its marker says less than nothing.
    if re.fullmatch(r"\s*(?://|\*|#)\s*", out):
        return out.rstrip() + ""
    return out


def walk(target: Path) -> list[Path]:
    if target.is_file():
        return [target] if target.suffix in SUFFIXES else []
    out: list[Path] = []
    for p in sorted(target.rglob("*")):
        if p.is_file() and p.suffix in SUFFIXES and "node_modules" not in p.parts:
            out.append(p)
    return out


def main() -> None:
    args = [a for a in sys.argv[1:] if a != "--dry-run"]
    dry = "--dry-run" in sys.argv
    if not args:
        sys.exit(__doc__)
    touched = changed_lines = kept = 0
    samples: list[str] = []
    for name in args:
        for path in walk(ROOT / name):
            text = path.read_text(encoding="utf-8")
            lines = text.split("\n")
            in_block = False
            out_lines = []
            hit = False
            for line in lines:
                comment = is_comment_line(line, path.suffix, in_block)
                new = strip_line(line) if comment else line
                if comment and re.search(DATE, line) and new == line:
                    kept += 1
                if new != line:
                    hit = True
                    changed_lines += 1
                    if len(samples) < 12:
                        samples.append(f"{path.name}\n  - {line.strip()[:110]}\n  + {new.strip()[:110]}")
                out_lines.append(new)
                in_block = block_state(line, path.suffix, in_block)
            if hit:
                touched += 1
                if not dry:
                    path.write_text("\n".join(out_lines), encoding="utf-8")
    print(f"{'would change' if dry else 'changed'}: {changed_lines} comment line(s) in {touched} file(s)")
    print(f"left alone (a KEEP word on the line): {kept}")
    for s in samples:
        print("\n" + s)


if __name__ == "__main__":
    main()
