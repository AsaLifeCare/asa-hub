#!/usr/bin/env python3
"""
Print the IST settings declaration as Apps Script, from server/ist_config_defaults.json.

Apps Script cannot read a JSON file, so apps-script/IstConfig.gs carries the declaration as code,
between two marker lines. This prints that block for pasting after the JSON changes; it writes
nothing. tools/test-ist-config.py evaluates the block and fails on any difference from the JSON.

    python3 tools/emit_ist_config_gs.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
JSON_PATH = ROOT / "server" / "ist_config_defaults.json"
BEGIN = "/* ── BEGIN generated from server/ist_config_defaults.json (tools/emit_ist_config_gs.py) ── */"
END = "/* ── END generated declaration ── */"
WIDTH = 100


def js_str(s: str) -> str:
    return "'" + str(s).replace("\\", "\\\\").replace("'", "\\'").replace("\n", "\\n") + "'"


def js_long(s: str, indent: str) -> str:
    """A long string as a concatenation of lines no wider than WIDTH."""
    lines: list[str] = []
    cur = ""
    for w in str(s).split(" "):
        nxt = (cur + " " + w) if cur else w
        if len(nxt) > WIDTH - len(indent) - 8 and cur:
            lines.append(cur + " ")
            cur = w
        else:
            cur = nxt
    lines.append(cur)
    return (" +\n" + indent).join(js_str(x) for x in lines)


def js_value(v, indent: str) -> str:
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return str(v)
    if isinstance(v, list):
        return "[" + ", ".join(js_value(x, indent) for x in v) + "]"
    s = str(v)
    return js_long(s, indent) if len(s) > WIDTH - len(indent) - 16 else js_str(s)


def js_object(d: dict, indent: str) -> str:
    inner = indent + "  "
    parts = [f"{inner}{k}: {js_value(v, inner + '  ')}" for k, v in d.items()]
    return "{\n" + ",\n".join(parts) + "\n" + indent + "}"


def block(decl: dict) -> str:
    return "\n".join([
        BEGIN,
        f"var IST_CONFIG_TAB = {js_str(decl.get('tab') or 'ist_config')};",
        "var IST_CONFIG_TINTS = " + js_value(decl.get("tints") or [], "") + ";",
        "var IST_CONFIG_GROUPS = [",
        ",\n".join("  " + js_object(g, "  ") for g in decl.get("groups") or []),
        "];",
        "var IST_CONFIG_DEFAULTS = [",
        ",\n".join("  " + js_object(d, "  ") for d in decl["keys"]),
        "];",
        END,
    ])


if __name__ == "__main__":
    sys.stdout.write(block(json.loads(JSON_PATH.read_text(encoding="utf-8"))) + "\n")
