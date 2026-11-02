#!/usr/bin/env python3
"""What a client book's masked cells keep in the Hub's copy, and how the Clients modules read it: while the keeper
copies one of the four client books, an SSN or a card keeps only its last four and a DC cell only whether it is on
file, the Medicaid number stays whole; every other caller and every other book withholds them whole, a copy's own
marker is never read again as a figure, and Client Details' mask and Client Finances' card read the kept figures.
The modules run from this checkout inside asa-hub-app; no table is read or written. Prints shapes only."""
from __future__ import annotations

import base64
import hashlib
import os
import re
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "server"))
import redaction as R  # noqa: E402

CLIENT_DB = "1fTi78ztKDiK3hvYLbI2IQ1TeSrzVLceK5LyXJ4BVPe8"
MASTER_DATA = "1Yv8j2u1xN2auqjOS0udTeldk5mDJqMU9lswmkTNYTks"
HUB_DB = "1SGC3fDFJsraqLXzHgUGRARe5n_IkguyBsTD4bze36ts"
ASA_DATA_CLIENTS = "1FhcCovLFJIAiPOP2u_NgXU-Tsw1vKQ_GI-FcWFg0M6w"
HUB_APPS = "1zP_zDVlqah1eCUjAaxnFkcTacOwMcZSDH4YwPAoLyOY"
EMPLOYEE_DB = "1Gqq08-3nZgKDoCLDnIHg16qTtdzeSZt9aNQRRi5y45s"
ROW = {"Client": "Test Person", "SSN": "123-45-6789", "TL Debit Card Number": "4111 1111 1111 4321",
       "DC Exp Date": "12/27", "DC Security Code": "123", "DC PIN #": "n/a", "Medicaid #": "763080892601", "Notes": "x"}

DRIVER = r'''
import base64, importlib.abc, importlib.util, json, sys
SRC = json.loads(base64.b64decode(sys.stdin.readline()).decode())


class Checkout(importlib.abc.MetaPathFinder, importlib.abc.Loader):
    def find_spec(self, name, path, target=None):
        return importlib.util.spec_from_loader(name, self, origin="checkout:" + name) if name in SRC else None

    def create_module(self, spec):
        return None

    def exec_module(self, module):
        module.__file__ = module.__name__ + ".py"
        exec(compile(SRC[module.__name__], module.__name__ + ".py", "exec"), module.__dict__)


sys.meta_path.insert(0, Checkout())
import clients as C, client_sources as CS
out = []
def check(name, ok, detail=""):
    out.append([name, bool(ok), str(detail)[:300]])

head = ["Client", "SSN", "TL Debit Card Number", "DC Exp Date", "DC Security Code", "DC PIN #", "Medicaid #"]
kept = ["Test Person", "[withheld: identifier] kept: 6789", "[withheld: card] kept: 4321",
        "[withheld: card] kept: on file", "[withheld: card] kept: on file", "[withheld: card] kept: none", "763080892601"]
row = next(iter(C.book_index_from([head, kept])["rows"].values()))
check("the kept figures are not withheld any more", row["withheld"] == [], row["withheld"])
check("the mask draws the kept last four and on-file marks",
      row["mask"] == {"ssn_last4": "6789", "ssn_on_file": True, "tl_card_last4": "4321", "dc_exp_on_file": True,
                      "dc_security_code_on_file": True, "dc_pin_on_file": False}, row["mask"])
check("the Medicaid number is read whole", row["fields"].get("medicaid_id") == "763080892601", row["fields"])
bare = C.book_index_from([head, ["Test Person", "[withheld: identifier]", "[withheld: card]", "", "", "", ""]])
b = next(iter(bare["rows"].values()))
check("a bare marker is still withheld (Apps Script answers)", b["withheld"] == ["ssn", "tl_card"], b["withheld"])
onf = C.book_index_from([head, ["Test Person", "[withheld: identifier] kept: on file", "", "", "", "", ""]])
m = next(iter(onf["rows"].values()))["mask"]
check("an SSN on file without a drawable last four", m["ssn_last4"] is None and m["ssn_on_file"] is True, m)
check("the card's kept last four reaches Client Finances", CS.csf_last4("[withheld: card] kept: 1234") == "1234")
check("a card kept as none draws nothing", CS.csf_last4("[withheld: card] kept: none") == "")
try:
    CS.csf_last4("[withheld: card]")
    check("a bare card marker defers", False)
except Exception as exc:
    check("a bare card marker defers", type(exc).__name__ == "Defer", type(exc).__name__)

import staff as SP
heads = ["Employee", "Status", "First Name", "Last Name", "SSN (Last 4)", "SSN#"]
def staff_row(last4, ssn):
    idx = SP.master_index_from(heads, [{"Employee": "Test Person", "Status": "Active", "First Name": "Test",
                                        "Last Name": "Person", "SSN (Last 4)": last4, "SSN#": ssn}])
    return next(iter(idx["rows"].values()))
r1 = staff_row("[withheld: identifier] kept: 6789", "[withheld: identifier] kept: 6789")
check("Staff masks the SSN from the kept last four", r1["fields"].get("ssn_masked") == "•••-••-6789"
      and "ssn_masked" not in r1["withheld"], r1["fields"].get("ssn_masked"))
r2 = staff_row("[withheld: identifier] kept: none", "[withheld: identifier] kept: 4321")
check("Staff falls back to the nine-digit SSN's kept last four", r2["fields"].get("ssn_masked") == "•••-••-4321", r2)
r3 = staff_row("[withheld: identifier]", "")
check("a bare Staff SSN marker is still withheld", "ssn_masked" in r3["withheld"], r3["withheld"])
check("a kept DD ID tag is not a bare marker", SP._bare("[withheld: identifier] kept: #0123456789abcdef") is False
      and SP._bare("[withheld: identifier]") is True)
print(json.dumps(out))
'''


def main() -> int:
    out: list[tuple[str, bool, str]] = []

    def check(name: str, ok: bool, detail: object = "") -> None:
        out.append((name, bool(ok), str(detail)[:300]))

    with R.reading(CLIENT_DB):
        red, n = R.redact_row(dict(ROW))
    check("the client book keeps the SSN's last four", red["SSN"] == "[withheld: identifier] kept: 6789", red["SSN"])
    check("the client book keeps the card's last four", red["TL Debit Card Number"] == "[withheld: card] kept: 4321",
          red["TL Debit Card Number"])
    check("a DC cell keeps only that it is on file", red["DC Exp Date"] == "[withheld: card] kept: on file"
          and red["DC Security Code"] == "[withheld: card] kept: on file", red)
    check("an n/a PIN keeps none", red["DC PIN #"] == "[withheld: card] kept: none", red["DC PIN #"])
    check("the Medicaid number stays whole in the client book", red["Medicaid #"] == "763080892601", red["Medicaid #"])
    check("no figure of the secrets leaves the cell", "123-45-6789" not in json.dumps(red)
          and "4111" not in json.dumps(red) and "12/27" not in json.dumps(red), red)
    check("the other columns are untouched", red["Client"] == "Test Person" and red["Notes"] == "x" and n == 5, n)
    with R.reading(CLIENT_DB):
        again, _n = R.redact_row(dict(red))
        bare, _n = R.redact_row({"SSN": R.MARKER_IDENTIFIER, "DC PIN #": R.MARKER_CARD})
        number, _n = R.redact_row({"SSN": 123456789.0, "DC Exp Date": "", "DC Security Code": None})
    check("a copy's kept marker is kept as it is", again == red, again)
    check("a copy's bare marker is never read as none", bare == {"SSN": R.MARKER_IDENTIFIER, "DC PIN #": R.MARKER_CARD},
          bare)
    check("a number cell reads as the sheet shows it; an empty cell stays empty",
          number == {"SSN": "[withheld: identifier] kept: 6789", "DC Exp Date": "", "DC Security Code": None}, number)
    with R.reading(MASTER_DATA):
        md, _n = R.redact_row({"TL Debit Card Number": "4111111111114321", "DC PIN #": "1234"})
    check("Master Data keeps the card's last four and the PIN's mark",
          md == {"TL Debit Card Number": "[withheld: card] kept: 4321", "DC PIN #": "[withheld: card] kept: on file"}, md)
    with R.reading(ASA_DATA_CLIENTS):
        hub, _n = R.redact_row({"medicaid_id": "763080892601", "ssn": "123456789"})
    check("ASA Data — Clients keeps medicaid_id whole and nothing else",
          hub == {"medicaid_id": "763080892601", "ssn": R.MARKER_IDENTIFIER}, hub)
    with R.reading(HUB_DB):
        old, _n = R.redact_row({"medicaid_id": "763080892601"})
    check("ASA Hub — DB, which no Clients read uses, withholds it", old == {"medicaid_id": R.MARKER_IDENTIFIER}, old)
    with R.reading(HUB_APPS):
        bal, _n = R.redact_row({"debit_card": "5555 0000 1234"})
    check("finance_balances keeps the debit card's last four", bal == {"debit_card": "[withheld: card] kept: 1234"}, bal)
    plain, _n = R.redact_row(dict(ROW))
    check("outside the keeper's read every cell is withheld whole",
          plain["SSN"] == R.MARKER_IDENTIFIER and plain["Medicaid #"] == R.MARKER_IDENTIFIER
          and plain["TL Debit Card Number"] == R.MARKER_CARD and plain["DC Exp Date"] == R.MARKER_CARD, plain)
    plain2, _n = R.redact_row(dict(red))
    check("a kept marker read outside the keeper is withheld whole again",
          plain2["SSN"] == R.MARKER_IDENTIFIER and plain2["DC PIN #"] == R.MARKER_CARD, plain2)
    with R.reading(EMPLOYEE_DB):
        emp, _n = R.redact_row({"SSN#": "123-45-6789", "SSN": "123-45-6789", "SSN (Last 4)": 89})
    check("the Employee Database keeps the SSN#'s last four and the Last 4 as Staff pads it; a column it does not name "
          "keeps nothing", emp == {"SSN#": "[withheld: identifier] kept: 6789", "SSN": R.MARKER_IDENTIFIER,
                                   "SSN (Last 4)": "[withheld: identifier] kept: 0089"}, emp)
    with R.reading(EMPLOYEE_DB):
        short, _n = R.redact_row({"SSN#": "12345"})
    check("an SSN# that is not nine digits keeps only that it is on file", short == {"SSN#": "[withheld: identifier] kept: on file"}, short)
    os.environ[R.TAG_KEY_ENV] = "test-only-secret"
    with R.reading(EMPLOYEE_DB):
        a, _n = R.redact_row({"DD ID": "1234567"})
        b, _n = R.redact_row({"DD ID": " 1234567 "})
        c, _n = R.redact_row({"DD ID": "7654321"})
    tag = a["DD ID"]
    check("a DD ID keeps only a keyed tag", re.fullmatch(r"\[withheld: identifier\] kept: #[0-9a-f]{16}", tag) is not None
          and "1234567" not in tag, tag)
    check("the same DD ID carries the same tag, another a different one", a == b and a != c, (a, b, c))
    os.environ.pop(R.TAG_KEY_ENV, None)
    with R.reading(EMPLOYEE_DB):
        nokey, _n = R.redact_row({"DD ID": "1234567"})
    check("with no key a DD ID is withheld whole", nokey == {"DD ID": R.MARKER_IDENTIFIER}, nokey)
    check("the Employee Database's tag never reaches a plain digest of the id",
          hashlib.sha256(b"1234567").hexdigest()[:16] not in tag)

    app = {p.stem: p.read_text(encoding="utf-8") for p in (ROOT / "app").glob("*.py")}
    got = subprocess.run(["docker", "exec", "-i", "asa-hub-app", "python", "-c", DRIVER],
                         input=base64.b64encode(json.dumps(app).encode()) + b"\n", capture_output=True, timeout=300)
    lines = got.stdout.decode().strip().splitlines()
    if got.returncode != 0 or not lines:
        print("FAIL the Clients modules ran in asa-hub-app")
        print(got.stderr.decode()[-2500:])
        return 1
    out += [tuple(x) for x in json.loads(lines[-1])]
    failed = 0
    for name, ok, detail in out:
        print(("ok   " if ok else "FAIL ") + name + ("" if ok else f"\n       {detail}"))
        failed += 0 if ok else 1
    print(f"{len(out) - failed} ok, {failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
