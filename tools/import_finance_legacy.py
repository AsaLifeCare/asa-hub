#!/usr/bin/env python3
"""ONE-TIME import of the old financial portal's history into the Hub DB.

Why this exists: the history is small, and bringing it in makes the app
self-contained — nobody else is depended on and the app has a beginning.

That corrects an earlier stance: what
breaks self-containment is READING their spreadsheet at runtime. A one-time
copy is the opposite — it is what ENDS the dependency. Same pattern as
syncFromLegacy() and the other tools/import_*.py: copy once, never look back.

Measured before writing: 2,529 transactions, 18 cardholders, and the old
Balances tab has ZERO rows — no month was ever closed over there. So the
history is the statement lines and nothing else.

Rules, each one deliberate:

  * SINGLE-SHOT. If finance_transactions already holds data, this refuses.
    An import that can run twice is an import that will run twice.
  * Names matching one of OUR clients (isps.client_name, case-insensitive)
    take OUR spelling, so the screen's client picker finds their history.
  * The three names with no match (Amanda Merry, Barbara Berry, Jennifer
    Glass — likely former clients) enter VERBATIM and are reported. History
    is truth; renaming it to the nearest current client would be attributing
    money to the wrong person and being sure about it.
  * Their RowKey is kept in `legacyRowKey`, so any row here can be traced
    back to the row it came from.
  * Receipt verdicts carry verbatim (MATCH / MISMATCH / UPLOADED / SHARED …)
    — the screen already renders unknown verdicts as plain "on file".
  * The receipt IMAGE FILES stay in the old Drive folder. Only names travel.
    Copying ~2,500 images is a separate decision, not a side effect.
"""
import json
import re
import sys
import time
import urllib.request
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from push_apps_script import access_token  # noqa: E402

OLD_SS = "10h-fABAw9yiRn_-jWVBXc3LTOs6sBFPWUJFKKfavBuQ"   # theirs — read ONCE, here only
HUB_SS = "1SGC3fDFJsraqLXzHgUGRARe5n_IkguyBsTD4bze36ts"   # ours
TAB = "finance_transactions"

HEADER = ["id", "createdAt", "updatedAt", "client", "date", "month", "type",
          "fundType", "amount", "vendor", "category", "description",
          "staffMember", "receiptFileId", "receiptName", "receiptVerdict",
          "receiptNote", "source", "enteredBy", "postedDate", "location",
          "accountId", "accountLast4", "legacyRowKey"]

FUNDS = ["Debit Card", "Cash", "Food Stamps"]
TYPES = ["Spending", "Deposit", "Withdraw"]


def api(tok: str, url: str, method: str = "GET", payload: dict | None = None) -> dict:
    req = urllib.request.Request(url, method=method,
                                 data=json.dumps(payload).encode() if payload else None)
    req.add_header("Authorization", f"Bearer {tok}")
    req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.load(r)


def get_values(tok: str, ss: str, rng: str) -> list[list[str]]:
    return api(tok, f"https://sheets.googleapis.com/v4/spreadsheets/{ss}/values/{rng}").get("values", [])


def norm_date(v: str) -> str:
    s = (v or "").strip()
    if re.match(r"^\d{4}-\d{2}-\d{2}$", s):
        return s
    # Manual rows write MM/DD/YY(YY); the TrueLink feed writes MM-DD-YYYY with
    # dashes. Found the hard way: the first run left every card row — exactly
    # 259 of them, 10% of the history — with a blank month, which is money
    # invisible in every month view.
    m = re.match(r"^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$", s)
    if m:
        y = ("20" + m.group(3)) if len(m.group(3)) == 2 else m.group(3)
        return f"{y}-{int(m.group(1)):02d}-{int(m.group(2)):02d}"
    return ""


def norm_amount(v: str) -> float | None:
    s = (v or "").strip().replace("$", "").replace(",", "")
    neg = s.startswith("(") and s.endswith(")")
    if neg:
        s = s[1:-1]
    try:
        n = float(s)
    except ValueError:
        return None
    return -n if neg else n


def main() -> None:
    tok = access_token()

    # ---- refuse to run twice -------------------------------------------------
    meta = api(tok, f"https://sheets.googleapis.com/v4/spreadsheets/{HUB_SS}?fields=sheets.properties.title")
    titles = [s["properties"]["title"] for s in meta["sheets"]]
    if TAB in titles:
        existing = get_values(tok, HUB_SS, f"{TAB}!A1:A3")
        if len(existing) > 1:
            sys.exit(f"REFUSING: {TAB} already holds data. This import is single-shot — "
                     "if you truly mean to redo it, delete the tab first, by hand.")

    # ---- our client spellings ------------------------------------------------
    isps = get_values(tok, HUB_SS, "isps!A1:Z1")
    col = [h.lower() for h in isps[0]].index("client_name")
    ours = {}
    for r in get_values(tok, HUB_SS, "isps!A2:Z500"):
        if len(r) > col and r[col].strip():
            ours[r[col].strip().lower()] = r[col].strip()

    # ---- their statement, read once ------------------------------------------
    rows = get_values(tok, OLD_SS, "Transactions!A1:T5000")
    hdr = {h.strip(): i for i, h in enumerate(rows[0])}

    def cell(r: list[str], name: str) -> str:
        i = hdr.get(name)
        return r[i].strip() if i is not None and len(r) > i else ""

    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    out, seen_keys = [], set()
    unmatched, no_date, no_amount, retyped, dup = {}, 0, 0, 0, 0

    for r in rows[1:]:
        name = cell(r, "Cardholder name")
        if not name:
            continue
        client = ours.get(name.lower())
        if not client:
            client = name                        # verbatim — see the header note
            unmatched[name] = unmatched.get(name, 0) + 1

        date = norm_date(cell(r, "Transaction Date"))
        if not date:
            no_date += 1                          # imported anyway: money is money
        amount = norm_amount(cell(r, "Amount"))
        if amount is None:
            no_amount += 1
            continue                              # a row with no amount is not a transaction

        typ = cell(r, "Type")
        category = cell(r, "Category")
        if typ not in TYPES:
            # On TrueLink rows their Type column is not a transaction type at
            # all — it is the card network's MERCHANT CATEGORY ("Discount &
            # Variety Stores"). The transaction type is derived from the sign,
            # and the merchant category is kept rather than thrown away: it is
            # the only classification those rows have.
            if typ and not category:
                category = typ
            typ = "Spending" if amount < 0 else "Deposit"
            retyped += 1

        fund = cell(r, "Fund Type") or "Debit Card"
        if fund not in FUNDS:
            fund = "Debit Card"

        key = cell(r, "RowKey") or f"{client}|{date}|{cell(r, 'Vendor')}|{amount:.2f}"
        if key in seen_keys:
            dup += 1
            continue
        seen_keys.add(key)

        receipt = cell(r, "Receipt")
        verdict = cell(r, "Receipt AI") or ("NONE" if not receipt else "UPLOADED")

        out.append([
            str(uuid.uuid4()), now, now, client, date, date[:7], typ, fund, amount,
            cell(r, "Vendor"), category, cell(r, "Description"),
            cell(r, "Staff Member"), "", receipt, verdict, cell(r, "Receipt AI Note"),
            (cell(r, "Source") or "manual").lower(), "legacy-import",
            norm_date(cell(r, "Posted Date")), cell(r, "Location"),
            cell(r, "Account ID"), cell(r, "Account (Last 4)"), key,
        ])

    # ---- write, one batch ----------------------------------------------------
    if TAB not in titles:
        api(tok, f"https://sheets.googleapis.com/v4/spreadsheets/{HUB_SS}:batchUpdate",
            "POST", {"requests": [{"addSheet": {"properties": {"title": TAB}}}]})
    api(tok,
        f"https://sheets.googleapis.com/v4/spreadsheets/{HUB_SS}/values/{TAB}!A1"
        "?valueInputOption=RAW", "PUT",
        {"values": [HEADER] + out})

    print(f"imported : {len(out)} rows into {TAB}")
    print(f"skipped  : {dup} duplicate RowKeys · {no_amount} with no amount")
    if no_date:
        print(f"warning  : {no_date} rows carry an unparseable date (imported, month blank)")
    if retyped:
        print(f"note     : {retyped} rows had a type outside {TYPES} — derived from the sign")
    if unmatched:
        print("kept VERBATIM (no matching client here — likely former clients):")
        for k, v in sorted(unmatched.items()):
            print(f"   {k}  ({v} rows)")


if __name__ == "__main__":
    main()
