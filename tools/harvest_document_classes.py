"""Copy four document_classes columns into document_catalog; additive only, never overwrites a value."""
import json, sys, time, urllib.parse, urllib.request
from pathlib import Path
ENV = Path("/opt/docker/asa-hub/server/.tools.env")
ESSENCIAL = "1Y6UMJlCS5gHur52f0YrPsLSqwYlCA792I8gAiZsxsug"
CLASSES_BOOK = "1zarOrNJl0GtpTD3MPg5JkmE_uSSQ2vbA76ePImlv49c"
CATALOG_HOUSE = "1fT__yEmfc8gjlKlqTsY3Y28SiaEXOUJi3nYSVhZoInM"
S = "https://sheets.googleapis.com/v4/spreadsheets/"
NEW = ["domain", "review_required", "approver_role", "retention_days"]
BY_CLASS = {"DCL_00001": "drivers_id", "DCL_00002": "car_insurance",
            "DCL_00003": "cpr_first_aid", "DCL_00004": "dodd_8hr",
            "DCL_00005": "med_del", "DCL_00006": "ss_birth",
            "DCL_00007": "hs_diploma"}

def env(k):
    for line in ENV.read_text().splitlines():
        line = line.strip()
        if line.startswith(k + "="): return line.split("=", 1)[1].strip().strip("'\"")
    sys.exit(k)
body = urllib.parse.urlencode({
    "client_id": env("GS_GOOGLE_CLIENT_ID"), "client_secret": env("GS_GOOGLE_CLIENT_SECRET"),
    "refresh_token": env("GS_GOOGLE_REFRESH_TOKEN"), "grant_type": "refresh_token"}).encode()
TOK = json.load(urllib.request.urlopen(urllib.request.Request(
    "https://oauth2.googleapis.com/token", data=body, method="POST"), timeout=30))["access_token"]

def api(url, payload=None, method="GET"):
    for attempt in range(5):
        r = urllib.request.Request(url, method=method)
        r.add_header("Authorization", "Bearer " + TOK)
        if payload is not None:
            r.add_header("Content-Type", "application/json"); r.data = json.dumps(payload).encode()
        try:
            with urllib.request.urlopen(r, timeout=120) as resp: return json.load(resp)
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 503) and attempt < 4: time.sleep(2 ** attempt); continue
            sys.exit(f"{e.code} {e.reason} — {e.read()[:250]!r}")
    return {}

def a1(col, row):
    out, i = "", col + 1
    while i:
        i, rem = divmod(i - 1, 26); out = chr(65 + rem) + out
    return f"{out}{row}"

# --- read the legacy classes -------------------------------------------------
meta = api(S + CLASSES_BOOK + "?fields=sheets.properties.title")
tabs = [x["properties"]["title"] for x in meta.get("sheets", [])]
tab = next((t for t in tabs if "document_classes" in t.lower()), "")
if not tab: sys.exit("document_classes is not a tab in that book")
rows = api(S + CLASSES_BOOK + "/values/" + urllib.parse.quote(f"'{tab}'!A1:Z50")).get("values") or []
head = [str(h).strip() for h in rows[0]]
at = {h: i for i, h in enumerate(head)}
legacy = {}
for r in rows[1:]:
    def c(k):
        i = at.get(k, -1)
        return str(r[i]).strip() if 0 <= i < len(r) else ""
    cid = c("class_id")
    if cid in BY_CLASS:
        legacy[BY_CLASS[cid]] = {"domain": c("domain"),
                                 "review_required": c("review_required"),
                                 "approver_role": c("approver_role"),
                                 "retention_days": c("retention_days")}
print(f"read {len(legacy)} class(es) out of MyLife OS — System Registry")

# --- append the columns to the catalog ---------------------------------------
cm = api(S + CATALOG_HOUSE + "?fields=sheets.properties.title")
ctab = [x["properties"]["title"] for x in cm.get("sheets", [])][0]
grid = api(S + CATALOG_HOUSE + "/values/" + urllib.parse.quote(f"'{ctab}'!A1:Z200")).get("values") or []
chead = [str(h).strip() for h in grid[0]]
missing = [c for c in NEW if c not in chead]
print(f"document_catalog ({ctab}): {len(chead)} columns, {len(missing)} to add — {', '.join(missing) or 'none'}")
if missing:
    api(S + CATALOG_HOUSE + "/values/" + urllib.parse.quote(f"'{ctab}'!{a1(len(chead), 1)}") +
        "?valueInputOption=RAW", {"values": [missing]}, "PUT")
    chead = chead + missing
cat = {h: i for i, h in enumerate(chead)}

data, filled = [], []
for n, r in enumerate(grid[1:], start=2):
    doc_id = str(r[cat["doc_id"]]).strip() if cat["doc_id"] < len(r) else ""
    src = legacy.get(doc_id)
    if not src: continue
    for col in NEW:
        i = cat[col]
        have = str(r[i]).strip() if i < len(r) else ""
        if have or not src[col]: continue          # never overwrite a decision
        data.append({"range": f"'{ctab}'!{a1(i, n)}", "values": [[src[col]]]})
        filled.append(f"{doc_id}.{col}={src[col]}")
if data:
    api(S + CATALOG_HOUSE + "/values:batchUpdate", {"valueInputOption": "RAW", "data": data}, "POST")
print(f"seeded {len(filled)} cell(s):")
for f in filled: print("   ", f)

# --- the declaration follows the sheet ---------------------------------------
facts = api(S + ESSENCIAL + "/values/" + urllib.parse.quote("'Facts'!A1:I99999")).get("values") or []
fh = [str(h).strip().lower() for h in facts[0]]
kcol = next((i for i, h in enumerate(fh) if h in ("key", "fact", "name")), 0)
vcol = next((i for i, h in enumerate(fh) if h in ("value", "val")), 1)
target = 0
for n, r in enumerate(facts[1:], start=2):
    if kcol < len(r) and str(r[kcol]).strip() == "schema:document_catalog.header": target = n
if target:
    api(S + ESSENCIAL + "/values/" + urllib.parse.quote(f"'Facts'!{a1(vcol, target)}") +
        "?valueInputOption=RAW", {"values": [[json.dumps(chead)]]}, "PUT")
    print(f"schema:document_catalog.header re-declared ({len(chead)} cols) at row {target}")
else:
    print("NOTE: no schema:document_catalog.header fact found — declaration untouched")

back = api(S + CATALOG_HOUSE + "/values/" + urllib.parse.quote(f"'{ctab}'!A1:Z1")).get("values")
print("read back:", len(back[0]), "columns —", ", ".join(back[0][-4:]))
