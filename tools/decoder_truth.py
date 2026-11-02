#!/usr/bin/env python3
"""Sample decoded rows into Digest Review for a human to mark, and score the marks; a machine never fills them."""
from __future__ import annotations

import json
import sys
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from pathlib import Path

ENV_PATH = Path("/opt/docker/asa-hub/server/.tools.env")
S = "https://sheets.googleapis.com/v4/spreadsheets/"
BOOK = "1Ky7FPu876WavnMTzsO6zejDXtI1I4b2xebuMdsBMMgg"   # ASA Hub — Generic Configuration
TAB = "Digest Review"
LEDGERS = [
    ("form_files", "19OvLdtyF0iENHcesFFm_6DyGjnqTfrjStAQJjiyh6Ww", "file_name"),
    ("client_files", "1o7opeC1GR3J5Oj7iGEgYo0EKLPmkW_paGBtE8uMx3LY", "title"),
]
HEAD = ["row_id", "ledger", "title", "doc_kind", "person", "issued_on", "expires_on",
        "confidence", "decoder", "verdict", "right_kind", "note"]


def env(k: str) -> str:
    for line in ENV_PATH.read_text().splitlines():
        line = line.strip()
        if line.startswith(f"{k}="):
            return line.split("=", 1)[1].strip().strip("'\"")
    sys.exit(f"{k} not found in {ENV_PATH}")


def bearer() -> str:
    body = urllib.parse.urlencode({
        "client_id": env("GS_GOOGLE_CLIENT_ID"), "client_secret": env("GS_GOOGLE_CLIENT_SECRET"),
        "refresh_token": env("GS_GOOGLE_REFRESH_TOKEN"), "grant_type": "refresh_token"}).encode()
    req = urllib.request.Request("https://oauth2.googleapis.com/token", data=body, method="POST")
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)["access_token"]


TOK = bearer()


def api(url: str, payload=None, method: str = "GET"):
    req = urllib.request.Request(url, method=method)
    req.add_header("Authorization", "Bearer " + TOK)
    if payload is not None:
        req.add_header("Content-Type", "application/json")
        req.data = json.dumps(payload).encode()
    with urllib.request.urlopen(req, timeout=300) as r:
        return json.load(r)


def col_letter(i: int) -> str:
    out, i = "", i + 1
    while i:
        i, rem = divmod(i - 1, 26)
        out = chr(65 + rem) + out
    return out


def ledger_rows() -> list[dict]:
    out = []
    for tab, house, name_col in LEDGERS:
        head = (api(S + house + "/values/" + urllib.parse.quote(f"'{tab}'!A1:BZ1")).get("values") or [[]])[0]
        head = [str(h) for h in head]
        want = ["id", name_col, "doc_kind", "person", "issued_on", "expires_on",
                "confidence", "digest_state", "digest_json"]
        have = [w for w in want if w in head]
        ranges = "&".join("ranges=" + urllib.parse.quote(
            f"'{tab}'!{col_letter(head.index(w))}1:{col_letter(head.index(w))}8000") for w in have)
        got = api(S + house + "/values:batchGet?" + ranges + "&majorDimension=COLUMNS")
        cols = {}
        for w, vr in zip(have, got.get("valueRanges") or []):
            v = vr.get("values") or [[]]
            cols[w] = v[0] if v else []

        def cell(w, i):
            v = cols.get(w) or []
            return str(v[i]) if i < len(v) else ""

        n = max((len(v) for v in cols.values()), default=1)
        for i in range(1, n):
            if not cell("id", i) or cell("digest_state", i) != "done":
                continue
            meta = {}
            try:
                meta = json.loads(cell("digest_json", i) or "{}")
            except Exception:  # noqa: BLE001
                meta = {}
            out.append({"row_id": cell("id", i), "ledger": tab, "title": cell(name_col, i),
                        "doc_kind": cell("doc_kind", i), "person": cell("person", i),
                        "issued_on": cell("issued_on", i), "expires_on": cell("expires_on", i),
                        "confidence": cell("confidence", i), "decoder": str(meta.get("v") or "")})
    return out


def pick(rows: list[dict], n: int, moved: set[str]) -> list[dict]:
    chosen, seen = [], set()

    def take(r):
        if r["row_id"] in seen or len(chosen) >= n:
            return
        seen.add(r["row_id"])
        chosen.append(r)

    for r in rows:
        if r["row_id"] in moved:
            take(r)
    for r in sorted(rows, key=lambda r: int(r["confidence"] or 0)):
        if len(chosen) >= n * 0.7:
            break
        take(r)
    per = defaultdict(int)
    for r in sorted(rows, key=lambda r: -int(r["confidence"] or 0)):
        if per[r["doc_kind"]] >= 2:
            continue
        per[r["doc_kind"]] += 1
        take(r)
    return chosen


def main() -> None:
    args = sys.argv[1:]
    n, moved_file, do_score = 60, "", "--score" in args
    for i, a in enumerate(args):
        if a == "--sample" and i + 1 < len(args):
            n = int(args[i + 1])
        if a == "--moved" and i + 1 < len(args):
            moved_file = args[i + 1]

    meta = api(S + BOOK + "?fields=sheets.properties.title")
    tabs = {s["properties"]["title"] for s in meta.get("sheets", [])}

    if do_score:
        if TAB not in tabs:
            sys.exit(f"there is no '{TAB}' tab yet — run without --score first")
        grid = api(S + BOOK + "/values/" + urllib.parse.quote(f"'{TAB}'!A1:Z2000")).get("values") or []
        if len(grid) < 2:
            sys.exit("the review tab is empty")
        head = [str(h) for h in grid[0]]
        at = {h: i for i, h in enumerate(head)}

        def c(row, k):
            i = at.get(k, -1)
            return str(row[i]).strip() if 0 <= i < len(row) else ""

        marked = [r for r in grid[1:] if c(r, "verdict")]
        ok = sum(1 for r in marked if c(r, "verdict").lower() in ("ok", "yes", "right", "certo", "sim"))
        wrong = [r for r in marked if c(r, "verdict").lower() not in
                 ("ok", "yes", "right", "certo", "sim")]
        print(f"{len(marked)} of {len(grid)-1} row(s) marked · "
              f"right {ok} · wrong {len(wrong)}"
              + (f" · {round(ok*100/len(marked))}% correct" if marked else ""))
        if not marked:
            print("nobody has marked anything yet — the `verdict` column is the whole point")
            return
        by = Counter(c(r, "doc_kind") for r in wrong)
        if by:
            print("\nwhere it is wrong:")
            for k, v in by.most_common(12):
                print(f"   {k or '(none)':<24} {v}")
            print("\nand what it should have been:")
            for r in wrong[:20]:
                print(f"   {c(r,'title')[:44]:<46} {c(r,'doc_kind') or '—':<20} → "
                      f"{c(r,'right_kind') or '?'}   {c(r,'note')[:40]}")
        return

    moved: set[str] = set()
    if moved_file:
        try:
            moved = set(json.loads(Path(moved_file).read_text()).keys())
        except Exception as exc:  # noqa: BLE001
            print(f"could not read {moved_file}: {exc}")
    rows = ledger_rows()
    print(f"{len(rows)} decoded row(s) to draw from")
    chosen = pick(rows, n, moved)

    if TAB not in tabs:
        api(S + BOOK + ":batchUpdate", {"requests": [{"addSheet": {"properties": {
            "title": TAB, "gridProperties": {"frozenRowCount": 1}}}}]}, "POST")
        print(f"created '{TAB}'")
    have = api(S + BOOK + "/values/" + urllib.parse.quote(f"'{TAB}'!A1:Z2000")).get("values") or []
    kept = {}
    if len(have) > 1:
        head = [str(h) for h in have[0]]
        at = {h: i for i, h in enumerate(head)}
        for r in have[1:]:
            rid = str(r[at["row_id"]]) if at.get("row_id", -1) < len(r) else ""
            if rid:
                kept[rid] = r
        print(f"the tab already carries {len(kept)} row(s) — marks are NEVER overwritten")
    fresh = [r for r in chosen if r["row_id"] not in kept]
    values = [HEAD]
    values += [list(v) + [""] * (len(HEAD) - len(v)) for v in kept.values()]
    values += [[r.get(h, "") for h in HEAD] for r in fresh]
    api(S + BOOK + "/values/" + urllib.parse.quote(f"'{TAB}'!A1:Z2000") + ":clear", {}, "POST")
    api(S + BOOK + "/values/" + urllib.parse.quote(f"'{TAB}'!A1") + "?valueInputOption=RAW",
        {"values": values}, "PUT")
    back = api(S + BOOK + "/values/" + urllib.parse.quote(f"'{TAB}'!A1:Z2000")).get("values") or []
    if len(back) != len(values):
        sys.exit(f"VERIFY FAILED: wrote {len(values)} row(s), the book reads {len(back)}")
    print(f"'{TAB}': {len(kept)} kept + {len(fresh)} new = {len(values)-1} row(s), read back")
    print("\nMark the `verdict` column: ok when the decoder is right, anything else when "
          "it is not — then `right_kind` and a short `note`. Nothing else in this platform "
          "may fill those three.")


if __name__ == "__main__":
    main()
