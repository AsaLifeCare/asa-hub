#!/usr/bin/env python3
"""
Write app/relay_routes.json from the relay's sources: every HTTP route asa-hub-snapshot answers, method and path
template, in the order the relay registers them (its first match wins, as asa-hub-app's carrier hands it every path
the app does not answer). Read off the `@app.<method>(...)` decorators of server/snapshot_service.py, and of the
server modules it mounts on its app (`<module>.mount(app, …)` / `<module>.install(app, …)`) at the place it mounts
them. Settings › Routes lists them beside the app's own (app/route_switches.py). Nothing of the relay is imported or
run: the sources are parsed.

    python3 tools/emit-relay-routes.py            # writes the file
    python3 tools/emit-relay-routes.py --check    # exit 1 when the file differs from the relay
"""
from __future__ import annotations

import ast
import json
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
SERVER = ROOT / "server"
RELAY = SERVER / "snapshot_service.py"
OUT = ROOT / "app" / "relay_routes.json"
VERBS = {"get", "post", "put", "patch", "delete", "head", "options"}
HOOKS = {"mount", "install"}


def _constants(tree: ast.Module) -> dict[str, str]:
    """The module's top-level string names (PREFIX, FINISH_PATH…), for the decorators that name a path by one."""
    out: dict[str, str] = {}
    for node in tree.body:
        if isinstance(node, ast.Assign) and isinstance(node.value, ast.Constant) and isinstance(node.value.value, str):
            for target in node.targets:
                if isinstance(target, ast.Name):
                    out[target.id] = node.value.value
    return out


def _text(node: ast.AST, names: dict[str, str], where: str) -> str:
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    if isinstance(node, ast.Name) and node.id in names:
        return names[node.id]
    if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Add):
        return _text(node.left, names, where) + _text(node.right, names, where)
    raise SystemExit(f"{where}: a route path this emitter cannot read ({ast.dump(node)[:120]})")


def _methods(call: ast.Call, verb: str, names: dict[str, str], where: str) -> list[str]:
    if verb != "api_route":
        return [verb.upper()]
    for kw in call.keywords:
        if kw.arg == "methods" and isinstance(kw.value, (ast.List, ast.Tuple, ast.Set)):
            return sorted({_text(e, names, where).upper() for e in kw.value.elts})
    return ["GET"]


def _route_of(dec: ast.expr) -> tuple[ast.Call, str] | None:
    """`@app.<verb>(path, …)` → (the call, the verb)."""
    if not isinstance(dec, ast.Call) or not isinstance(dec.func, ast.Attribute):
        return None
    f = dec.func
    if not (isinstance(f.value, ast.Name) and f.value.id == "app") or (f.attr not in VERBS and f.attr != "api_route"):
        return None
    return (dec, f.attr) if dec.args else None


def _hook_of(stmt: ast.stmt) -> str | None:
    """`<module>.mount(app, …)` or `<module>.install(app, …)` for a module beside the relay → that module's name."""
    if not isinstance(stmt, ast.Expr) or not isinstance(stmt.value, ast.Call):
        return None
    call = stmt.value
    f = call.func
    if not (isinstance(f, ast.Attribute) and isinstance(f.value, ast.Name) and f.attr in HOOKS):
        return None
    if not (call.args and isinstance(call.args[0], ast.Name) and call.args[0].id == "app"):
        return None
    return f.value.id if (SERVER / f"{f.value.id}.py").is_file() else None


def _children(stmt: ast.stmt) -> list[list[ast.stmt]]:
    kids: list[list[ast.stmt]] = []
    for field in ("body", "orelse", "finalbody"):
        block = getattr(stmt, field, None)
        if isinstance(block, list) and block and isinstance(block[0], ast.stmt):
            kids.append(block)
    for handler in getattr(stmt, "handlers", None) or []:
        kids.append(handler.body)
    for case in getattr(stmt, "cases", None) or []:
        kids.append(case.body)
    return kids


def routes_of(module: str, seen: tuple[str, ...] = ()) -> list[dict[str, Any]]:
    """The routes a server module registers on the relay's app, in source order, its mounted modules spliced in."""
    if module in seen:
        return []
    path = SERVER / f"{module}.py"
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    names = _constants(tree)
    out: list[dict[str, Any]] = []

    def walk(block: list[ast.stmt]) -> None:
        for stmt in block:
            if isinstance(stmt, (ast.FunctionDef, ast.AsyncFunctionDef)):
                for dec in stmt.decorator_list:
                    got = _route_of(dec)
                    if got is None:
                        continue
                    call, verb = got
                    where = f"server/{module}.py:{stmt.lineno}"
                    route_path = _text(call.args[0], names, where)
                    for method in _methods(call, verb, names, where):
                        out.append({"method": method, "path": route_path, "handler": stmt.name, "module": module})
            hooked = _hook_of(stmt)
            if hooked is not None:
                out.extend(routes_of(hooked, (*seen, module)))
            for kid in _children(stmt):
                walk(kid)

    walk(tree.body)
    return out


def build() -> dict[str, Any]:
    routes = routes_of("snapshot_service")
    seen: set[tuple[str, str]] = set()
    for r in routes:
        key = (r["method"], r["path"])
        if key in seen:
            raise SystemExit(f"the relay registers {r['method']} {r['path']} twice")
        seen.add(key)
    return {"_": "Generated by tools/emit-relay-routes.py from server/snapshot_service.py and the modules it mounts; "
                 "never edited by hand.", "routes": routes}


def dump(table: dict[str, Any]) -> str:
    rows = ",\n".join("  " + json.dumps(r, ensure_ascii=False) for r in table["routes"])
    return "{\n " + json.dumps("_") + ": " + json.dumps(table["_"], ensure_ascii=False) + ",\n " + \
        json.dumps("routes") + ": [\n" + rows + "\n ]\n}\n"


def main(argv: list[str]) -> int:
    table = build()
    text = dump(table)
    if json.loads(text) != table:
        raise SystemExit("the written table does not read back as built")
    if "--check" in argv:
        same = OUT.exists() and OUT.read_text(encoding="utf-8") == text
        print("app/relay_routes.json " + ("matches the relay" if same else "DIFFERS from the relay"))
        return 0 if same else 1
    OUT.write_text(text, encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)}: {len(table['routes'])} relay routes")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
