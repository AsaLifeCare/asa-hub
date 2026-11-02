#!/usr/bin/env python3
"""Trims Python comments: a module docstring to 2 lines, any other comment block or docstring to 1 line.
A file is written only when its AST (docstrings aside) is unchanged; directives and trailing comments are kept."""
from __future__ import annotations

import ast
import io
import re
import sys
import tokenize
from pathlib import Path

SKIP = {"master_json.py"}
DIRECTIVE = re.compile(r"#!|type:\s|noqa|pragma|fmt:|-\*-\s*coding|pylint:|mypy:|isort:")
WIDTH = 118


def sentences(text: str) -> list[str]:
    flat = re.sub(r"\b(e\.g|i\.e|vs|etc|cf)\.", "\\1\u2024", re.sub(r"\s+", " ", text).strip(), flags=re.I)
    found = [m.group(0).strip() for m in re.finditer(r"(?:[^.!?]|[.!?](?!\s|$))+(?:[.!?]+(?=\s|$)|$)", flat) if m.group(0).strip()]
    return [s.replace("\u2024", ".") for s in (found or ([flat] if flat else []))]


def fit(s: str, width: int) -> str:
    if len(s) <= width:
        return s
    cut = s.rfind(" ", 0, width - 1)
    return re.sub(r"[\s,;:—–-]+$", "", s[: cut if cut > width // 2 else width - 1]) + "…"


def doc_nodes(tree: ast.AST) -> list[ast.Expr]:
    out = []
    for node in ast.walk(tree):
        if isinstance(node, (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)) and node.body:
            first = node.body[0]
            if isinstance(first, ast.Expr) and isinstance(first.value, ast.Constant) and isinstance(first.value.value, str):
                out.append(first)
    return out


def fingerprint(src: str) -> str:
    tree = ast.parse(src)
    for d in doc_nodes(tree):
        d.value.value = ""
    return ast.dump(tree, include_attributes=False)


def trim(src: str) -> str:
    lines = src.split("\n")
    tree = ast.parse(src)
    first = tree.body[0] if tree.body else None
    module_doc = isinstance(first, ast.Expr) and isinstance(first.value, ast.Constant) and isinstance(first.value.value, str)
    edits: list[tuple[int, int, list[str]]] = []  # (first line idx, last line idx inclusive, replacement lines)

    for d in doc_nodes(tree):
        is_module = d is (tree.body[0] if tree.body else None)
        start, end = d.lineno - 1, d.end_lineno - 1
        if end - start + 1 <= (2 if is_module else 1) and "\n" not in d.value.value:
            continue
        indent = lines[start][: len(lines[start]) - len(lines[start].lstrip())]
        if lines[start][len(indent):len(indent) + 1] in ("r", "R", "u", "U", "b", "B", "f", "F"):
            continue
        if d.col_offset != len(indent) or lines[end].rstrip()[-3:] not in ('"""', "'''"):
            continue
        width = max(40, WIDTH - len(indent) - 6)
        parts = sentences(d.value.value)
        kept = [fit(p, width) for p in parts[: 2 if is_module else 1]]
        kept = [k.replace("\\", "\\\\").replace('"""', "'''") for k in kept]
        if kept and kept[-1].endswith('"'):
            kept[-1] += " "
        if not kept:
            continue
        if len(kept) == 1:
            new = [f'{indent}"""{kept[0]}"""']
        else:
            new = [f'{indent}"""{kept[0]}', f"{indent}{kept[1]}\"\"\""]
        edits.append((start, end, new))

    toks = list(tokenize.generate_tokens(io.StringIO(src).readline))
    own: list[tuple[int, str]] = []
    for t in toks:
        if t.type == tokenize.COMMENT and not lines[t.start[0] - 1][: t.start[1]].strip():
            own.append((t.start[0] - 1, t.string))
    blocks: list[list[tuple[int, str]]] = []
    for row, text in own:
        if blocks and blocks[-1][-1][0] == row - 1:
            blocks[-1].append((row, text))
        else:
            blocks.append([(row, text)])
    for block in blocks:
        directives = [t for _, t in block if DIRECTIVE.search(t)]
        prose = [re.sub(r"^#+\s?", "", t) for _, t in block if not DIRECTIVE.search(t)]
        header = block[0][0] == 0 or all(not l.strip() or l.startswith("#!") for l in lines[: block[0][0]])
        limit = 2 if header and not module_doc else 1
        if len(block) - len(directives) <= limit and not directives:
            continue
        if len(prose) <= limit and len(directives) == len(block) - len(prose) and not prose:
            continue
        indent = lines[block[0][0]][: len(lines[block[0][0]]) - len(lines[block[0][0]].lstrip())]
        width = max(40, WIDTH - len(indent) - 2)
        parts = sentences(" ".join(prose))
        kept = [fit(p, width) for p in parts[:limit]]
        new = [f"{indent}# {k}" for k in kept] + [f"{indent}{d}" for d in directives]
        if len(new) >= len(block):
            continue
        edits.append((block[0][0], block[-1][0], new))

    for start, end, new in sorted(edits, key=lambda e: e[0], reverse=True):
        lines[start: end + 1] = new
    return "\n".join(lines)


def main() -> None:
    write = "--dry-run" not in sys.argv
    roots = [a for a in sys.argv[1:] if not a.startswith("--")]
    changed = refused = saved = 0
    for root in roots:
        for path in sorted(Path(root).rglob("*.py")):
            if path.name in SKIP or "node_modules" in path.parts:
                continue
            src = path.read_text()
            try:
                out = trim(src)
                same = out != src and fingerprint(src) == fingerprint(out)
            except (SyntaxError, ValueError, tokenize.TokenError):
                same = False
                out = src
            if out == src:
                continue
            if not same:
                refused += 1
                print(f"REFUSED (code would change): {path}")
                continue
            changed += 1
            saved += src.count("\n") - out.count("\n")
            if write:
                path.write_text(out)
    print(f"{'trimmed' if write else 'would trim'} {changed} file(s), {saved} line(s) fewer; refused {refused}")


if __name__ == "__main__":
    main()
