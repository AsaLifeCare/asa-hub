#!/usr/bin/env python3
"""Build IST records from the Postgres roster by the ist_config rules: append and mark, never replace or delete."""
from __future__ import annotations

import json
import re
import subprocess
import sys
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "server"))
import ist_config as istcfg  # noqa: E402 — the one declaration, shared with the relay

ENV_PATH = Path("/opt/docker/asa-hub/server/.tools.env")
# house ids resolve through the depot's switchboard pointers; only the Essencial id is typed here
ESSENCIAL_ID = "1Y6UMJlCS5gHur52f0YrPsLSqwYlCA792I8gAiZsxsug"
PEOPLE_SLICE = Path("/opt/docker/asa-hub/web/"
                    "snapshot/people.json")
TAB = "ist_records"
HEADER = ["id", "createdAt", "updatedAt", "staffName", "staffEmail", "staffPhone", "avatar",
          "clientName", "house", "dueDate", "status", "certNote",
          "trainedAt", "trainedBy", "notifiedAt", "notifyCount", "remindRequested", "houseStatus"]

IST_CONFIG_TAB = istcfg.TAB
# the floor when ist_config is missing or empty: every declared key, from server/ist_config_defaults.json
IST_CONFIG_SHIPPED = dict(istcfg.SHIPPED)

CLIENT_SQL = """
select client_name, coalesce(start_date::text, '')
  from mylife_os_client_entities.entity_clients
"""


def _values(cfg: dict[str, str]) -> dict[str, str]:
    """A config map with every declared key resolved: a blank or refused cell is the shipped value."""
    return istcfg.resolve(cfg)[0]


def cfg_list(cfg: dict[str, str], key: str) -> list[str]:
    return istcfg.list_of(_values(cfg), key)


def cfg_text(cfg: dict[str, str], key: str) -> str:
    """A blank or refused cell is the shipped value: an empty certNote would read as "certificate is fine"."""
    return istcfg.text(_values(cfg), key)


def cfg_pairs(cfg: dict[str, str], key: str) -> dict[str, str]:
    return istcfg.pairs(_values(cfg), key)[1]


def cfg_int(cfg: dict[str, str], key: str) -> int:
    return istcfg.int_of(_values(cfg), key)


def cfg_yes(cfg: dict[str, str], key: str) -> bool:
    return istcfg.yes(_values(cfg), key)


def no_certification_note(cfg: dict[str, str]) -> str:
    """The same two cells istCertNote_ reads in Apps Script."""
    return cfg_text(cfg, "ist_note_no_certification").replace(
        "{cert}", cfg_text(cfg, "ist_gate_certification_label"))


def sql_text(v: str) -> str:
    """Doubling the quote suffices: the split already removed newlines and semicolons."""
    return "'" + str(v).replace("'", "''") + "'"


def not_a_person_sql(cfg: dict[str, str]) -> str:
    names = [n.upper() for n in cfg_list(cfg, "ist_non_person_names")]
    parts = []
    if names:
        parts.append("   and upper(staff_name) not in (" + ", ".join(sql_text(n) for n in names) + ")")
    for word in cfg_list(cfg, "ist_non_person_contains"):
        parts.append("   and staff_name not ilike " + sql_text("%" + word + "%"))
    return "\n".join(parts)


def lookback_sql(cfg: dict[str, str]) -> str:
    """`ist_roster_lookback_days`: '' for 0 (all history), else the floor on shift_date."""
    days = cfg_int(cfg, "ist_roster_lookback_days")
    return f"\n   and shift_date >= current_date - {int(days)}" if days > 0 else ""


def roster_sql(cfg: dict[str, str]) -> str:
    return f"""
select house, staff_name, min(shift_date)::text as first_shift
  from app.asa_schedules
 where staff_name is not null and staff_name <> ''
{not_a_person_sql(cfg)}{lookback_sql(cfg)}
 group by house, staff_name
"""


def shift_days_sql(cfg: dict[str, str]) -> str:
    return f"""
select house, staff_name, shift_date::text
  from app.asa_schedules
 where staff_name is not null and staff_name <> ''
{not_a_person_sql(cfg)}{lookback_sql(cfg)}
"""


def key(name: str) -> str:
    """Must match clientNameKey_."""
    return re.sub(r"[^a-z0-9]+", "_", str(name or "").lower()).strip("_")


def estate_key(header: str) -> str:
    """A header as Certs.gs names it (estateKey_): parentheses dropped, lowercase, punctuation → _."""
    s = re.sub(r"\([^)]*\)", " ", str(header or "")).lower()
    return re.sub(r"[^a-z0-9]+", "_", s).strip("_")


def field_of(row: dict[str, str], spec: str) -> str:
    """A row's value for a column spec (`ist_cert_source_fields`): `|` alternatives, `+` joins."""
    for alt in str(spec or "").split("|"):
        joined = " ".join(p for p in (str(row.get(c.strip(), "") or "").strip()
                                      for c in alt.split("+")) if p)
        if joined:
            return joined
    return ""


def source_field(cfg: dict[str, str], fact: str) -> str:
    return cfg_pairs(cfg, "ist_cert_source_fields").get(fact) \
        or (istcfg.pairs_of(IST_CONFIG_SHIPPED["ist_cert_source_fields"]) or ([], {}))[1].get(fact, "")


def state_of(cfg: dict[str, str], cell: str, word: str, fallback: str) -> str:
    """A status word through a pairs cell: exact words and `word*` prefixes in order, `*` for the rest."""
    order, m = istcfg.pairs(_values(cfg), cell)
    w = str(word or "").strip().lower()
    star = ""
    for k in order:
        kl, v = k.strip().lower(), str(m[k]).strip().lower()
        if kl == "*":
            star = star or v
        elif kl.endswith("*"):
            if w.startswith(kl[:-1]):
                return v
        elif kl == w:
            return v
    return star or fallback


def date_of(v: str) -> date | None:
    """A certificate date as the estate writes it (1/13/2027, 2027-01-13, Jan 13, 2027), or None."""
    s = str(v or "").strip()
    if not s:
        return None
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})", s)
    if m:
        try:
            return date(int(m[1]), int(m[2]), int(m[3]))
        except ValueError:
            return None
    for fmt in ("%m/%d/%Y", "%m/%d/%y", "%b %d, %Y", "%B %d, %Y", "%d-%b-%Y"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    return None


def cert_note(cfg: dict[str, str], expires: str | None, today: date) -> str:
    """The Certification cell — istCertNote_'s rule: none on file, unreadable, expired, or ''."""
    label = cfg_text(cfg, "ist_gate_certification_label")
    if not str(expires or "").strip():
        return no_certification_note(cfg)
    got = date_of(str(expires))
    if got is None:
        return (cfg_text(cfg, "ist_note_unreadable").replace("{cert}", label)
                .replace("{value}", str(expires).strip()))
    if got < today:
        return (cfg_text(cfg, "ist_note_expired").replace("{cert}", label)
                .replace("{date}", got.isoformat()))
    return ""


def gate_picture(cfg: dict[str, str], tabs: dict[str, tuple[list[str], list[dict]]]) -> dict[str, str]:
    """{name key: gate expiry as written} from the raw reads by role, re-keyed by estate_key as Certs.gs names them."""
    gate = cfg_text(cfg, "ist_gate_certification")
    out: dict[str, str] = {}

    def rows(which: str) -> list[dict[str, str]]:
        return [{estate_key(k): v for k, v in r.items()} for r in (tabs.get(which) or ([], []))[1]]

    if gate == "mais":
        latest: dict[str, tuple[date, str]] = {}
        for r in rows("mais"):
            if state_of(cfg, "ist_cert_mais_statuses", field_of(r, source_field(cfg, "mais.status")),
                        "expired") == "skip":
                continue
            who = key(field_of(r, source_field(cfg, "mais.name")))
            if not who:
                continue
            exp = field_of(r, source_field(cfg, "mais.expires"))
            when = date_of(exp) or date.min
            if who not in latest or when > latest[who][0]:
                latest[who] = (when, exp)
        return {k: v[1] for k, v in latest.items()}

    columns = [c for c, course in cfg_pairs(cfg, "ist_cert_master_columns").items() if course == gate]
    for r in rows("master"):
        who = key(field_of(r, source_field(cfg, "master.name")))
        if not who:
            continue
        for c in columns:
            if str(r.get(c, "") or "").strip():
                out[who] = str(r[c]).strip()
                break
    # the exceptions tracker outranks a date that merely looks fine, as in certPicture_
    labels = {k.lower().strip(): v for k, v in cfg_pairs(cfg, "ist_cert_training_keys").items()}
    for r in rows("trainings"):
        if labels.get(field_of(r, source_field(cfg, "trainings.course")).lower().strip()) != gate:
            continue
        who = key(field_of(r, source_field(cfg, "trainings.name")))
        exp = field_of(r, source_field(cfg, "trainings.expires"))
        # an undated tracker row keeps the Master date rather than claiming none on file
        if who and exp:
            out[who] = exp
    return out


def new_rows(cfg: dict[str, str], *, first_at: dict[tuple[str, str], str],
             days: dict[tuple[str, str], list[str]], by_house: dict[str, list[str]],
             client_start: dict[str, str], existing: set[tuple[str, str]],
             people: dict[str, dict], certs: dict[str, str], certs_read: bool,
             now: str, today: date) -> tuple[list[list[str]], int, set[str]]:
    """(new rows, pairs skipped for never overlapping the client, rostered names without a contact)."""
    fresh: list[list[str]] = []
    skipped, unknown = 0, set()
    need_overlap = cfg_yes(cfg, "ist_pair_requires_overlap")
    for (house, staff), first_shift in sorted(first_at.items()):
        clients = by_house.get(house, [])
        if not clients:
            continue
        worked = sorted(days.get((house, staff), []))
        person = people.get(key(staff))
        if not person:
            unknown.add(staff)
        for client in clients:
            ck = key(client)
            if (key(staff), ck) in existing:
                continue
            start = client_start.get(ck, "")
            if start:
                # did they ever work here on or after the client arrived?
                if need_overlap and not any(d >= start[:10] for d in worked):
                    skipped += 1
                    continue
                due = max(first_shift[:10], start[:10])
            else:
                due = first_shift[:10]
            note = cert_note(cfg, certs.get(key(staff)), today) if certs_read else ""
            fresh.append([
                f"IST_{house}_{key(staff)}_{ck}", now, now,
                staff,
                (person or {}).get("email", ""), (person or {}).get("phone", ""),
                (person or {}).get("avatar", ""),
                client, house, due, istcfg.IST_STATUS_OWED, note,
                "", "", "", "0", "", "",
            ])
    return fresh, skipped, unknown


def stale_marks(existing_rows: list[dict], by_house: dict[str, list[str]],
                marker: str) -> list[tuple[int, str]]:
    """(row index, new houseStatus); only this mark writes houseStatus, so any word there is a mark."""
    out = []
    for i, r in enumerate(existing_rows):
        if not any(str(v or "").strip() for v in r.values()):
            continue
        house = str(r.get("house", "") or "").strip()
        known = bool(house) and house in by_house
        mark = str(r.get("houseStatus", "") or "").strip()
        if not known and mark != marker:
            out.append((i, marker))
        elif known and mark:
            out.append((i, ""))
    return out


def note_counts(fresh: list[list[str]], cfg: dict[str, str]) -> str:
    """What the Certification cell of the new rows will say, counted — printed before any write."""
    none = no_certification_note(cfg)
    notes = [row[11] for row in fresh]
    clear = sum(1 for n in notes if not n)
    missing = sum(1 for n in notes if n == none)
    return (f"{clear} clear · {missing} \"{none}\" · "
            f"{len(notes) - clear - missing} expired or unreadable")


def env(k: str) -> str:
    for line in ENV_PATH.read_text().splitlines():
        line = line.strip()
        if line.startswith(f"{k}="):
            return line.split("=", 1)[1].strip().strip("'\"")
    sys.exit(f"{k} not found in {ENV_PATH}")


def psql(sql: str) -> list[list[str]]:
    out = subprocess.run(
        ["docker", "exec", "asa-hub-db", "psql", "-U", "asa_hub", "-d", "asa_hub",
         "-tAF", "\x1f", "-c", sql],
        capture_output=True, text=True, timeout=120,
    )
    if out.returncode != 0:
        sys.exit(f"postgres refused: {out.stderr.strip()[:300]}")
    return [ln.split("\x1f") for ln in out.stdout.splitlines() if ln.strip()]


def token() -> str:
    body = urllib.parse.urlencode({
        "client_id": env("GS_GOOGLE_CLIENT_ID"),
        "client_secret": env("GS_GOOGLE_CLIENT_SECRET"),
        "refresh_token": env("GS_GOOGLE_REFRESH_TOKEN"),
        "grant_type": "refresh_token",
    }).encode()
    req = urllib.request.Request("https://oauth2.googleapis.com/token", data=body, method="POST")
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)["access_token"]


def sheet_api(tok: str, sheet_id: str, path: str, method: str = "GET", payload: dict | None = None) -> dict:
    url = f"https://sheets.googleapis.com/v4/spreadsheets/{sheet_id}{path}"
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", f"Bearer {tok}")
    req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, timeout=120) as r:
        raw = r.read()
        return json.loads(raw) if raw else {}


def read_tab(tok: str, sheet_id: str, tab: str, rng: str = "A1:AZ5000") -> tuple[list[str], list[dict]]:
    got = sheet_api(tok, sheet_id, f"/values/{urllib.parse.quote(tab + '!' + rng)}")
    rows = got.get("values", [])
    if not rows:
        return [], []
    head = [str(h).strip() for h in rows[0]]
    out = []
    for r in rows[1:]:
        out.append({head[i]: (r[i] if i < len(r) else "") for i in range(len(head))})
    return head, out


def depot_state(tok: str) -> dict[str, str]:
    got = sheet_api(tok, ESSENCIAL_ID,
                    f"/values/{urllib.parse.quote(chr(39) + 'Facts' + chr(39) + '!A2:I999999')}")
    state: dict[str, str] = {}
    for row in got.get("values", []) or []:
        if len(row) > 4 and row[4]:
            state[str(row[4])] = str(row[2]) if len(row) > 2 else ""
    return state


def house_id(tok: str, tab: str, depot: dict[str, str]) -> str:
    sid = depot.get(f"switchboard:props.HUB_HOUSE_{tab.upper()}_ID", "").strip()
    if not sid:
        sys.exit(f"the depot carries no house pointer for '{tab}' "
                 f"(switchboard:props.HUB_HOUSE_{tab.upper()}_ID) — declare it first.")
    return sid


def cert_source_id(depot: dict[str, str]) -> str:
    """The estate's employee database, as Apps Script's hubId_('CERT_SOURCE_ID') finds it in the depot."""
    return depot.get("switchboard:props.CERT_SOURCE_ID", "").strip()


def read_house(tok: str, sid: str, tab: str) -> tuple[list[str], list[dict]]:
    head, rows, _tab = read_house_tab(tok, sid, tab)
    return head, rows


def read_house_tab(tok: str, sid: str, tab: str) -> tuple[list[str], list[dict], str]:
    """Also names the tab that answered, so writes go back to that one."""
    try:
        head, rows = read_tab(tok, sid, tab)
        if head:
            return head, rows, tab
    except Exception:
        pass
    head, rows = read_tab(tok, sid, "Data")
    return head, rows, "Data"


def ist_config_read(tok: str, depot: dict[str, str]) -> tuple[dict[str, str], str]:
    """Never exits: a missing settings house falls to the shipped floor and says so."""
    sid = depot.get(f"switchboard:props.HUB_HOUSE_{IST_CONFIG_TAB.upper()}_ID", "").strip()
    if not sid:
        return {}, "shipped (no house declared — run tools/mint_ist_config_house.py)"
    try:
        _, rows = read_house(tok, sid, IST_CONFIG_TAB)
    except Exception as exc:
        return {}, f"shipped (the house did not answer: {str(exc)[:80]})"
    got = {}
    for r in rows:
        k = str(r.get("key", "")).strip()
        if k and str(r.get("value", "")).strip():
            got[k] = str(r.get("value", ""))
    if not got:
        return {}, "shipped (the tab is empty)"
    return got, "sheet"


def ist_config_problems(tok: str, depot: dict[str, str]) -> dict[str, str]:
    """{key: why} for every cell the declaration refuses — each answers its shipped value."""
    raw, _src = ist_config_read(tok, depot)
    return istcfg.resolve(raw)[1]


def ist_config(tok: str, depot: dict[str, str]) -> tuple[dict[str, str], str]:
    """Every declared key resolved, plus any sheet-only row, and where it came from."""
    raw, src = ist_config_read(tok, depot)
    if not raw:
        return dict(IST_CONFIG_SHIPPED), src
    values, _problems = istcfg.resolve(raw)
    out = dict(values)
    for k, v in raw.items():
        if k not in out:
            out[k] = v
    return out, src


def col_letter(i: int) -> str:
    """0 → A, 25 → Z, 26 → AA."""
    s = ""
    i += 1
    while i:
        i, r = divmod(i - 1, 26)
        s = chr(65 + r) + s
    return s


def main() -> None:
    dry = "--dry-run" in sys.argv
    tok = token()
    depot = depot_state(tok)
    records_house = house_id(tok, TAB, depot)
    houses_house = house_id(tok, "ist_houses", depot)
    cfg, cfg_from = ist_config(tok, depot)
    print(f"IST settings: {cfg_from}")
    for k, why in sorted(ist_config_problems(tok, depot).items()):
        print(f"   refused, the shipped value answers — {k}: {why}")

    _, house_rows = read_house(tok, houses_house, "ist_houses")
    by_house: dict[str, list[str]] = {}
    for r in house_rows:
        if str(r.get("active", "yes")).lower() == "no":
            continue
        h, c = str(r.get("house", "")).strip(), str(r.get("clientName", "")).strip()
        if h and c:
            by_house.setdefault(h, []).append(c)
    if not by_house:
        sys.exit("The house → client map is empty. Fill it first (Settings → IST).")

    first_at: dict[tuple[str, str], str] = {}
    for house, staff, first in psql(roster_sql(cfg)):
        first_at[(house, staff)] = first
    days: dict[tuple[str, str], list[str]] = {}
    for house, staff, day in psql(shift_days_sql(cfg)):
        days.setdefault((house, staff), []).append(day)

    if not first_at:
        sys.exit("The roster came back empty. Refusing: that is a broken read, not an empty week.")

    client_start = {key(n): s for n, s in psql(CLIENT_SQL)}
    try:
        people_rows = json.loads(PEOPLE_SLICE.read_text())
        if isinstance(people_rows, dict):
            people_rows = people_rows.get("rows", [])
    except Exception:
        people_rows = []
        print("note: people slice unreadable — rows carry no contact details.")
    people = {key(p.get("name", "")): p for p in people_rows if p.get("name")}

    gate = cfg_text(cfg, "ist_gate_certification")
    certs: dict[str, str] = {}
    certs_read = True
    estate_id = cert_source_id(depot)
    tab_names = cfg_pairs(cfg, "ist_cert_source_tabs")
    if not estate_id:
        certs_read = False
        print("note: CERT_SOURCE_ID is not in the depot (switchboard:props.CERT_SOURCE_ID) — "
              "certNote is left BLANK rather than claiming nobody is certified.")
    else:
        try:
            wanted = ["mais"] if gate == "mais" else ["master", "trainings"]
            tabs = {w: read_tab(tok, estate_id, tab_names.get(w) or istcfg.pairs(
                istcfg.SHIPPED, "ist_cert_source_tabs")[1][w]) for w in wanted}
            certs = gate_picture(cfg, tabs)
        except Exception as e:
            certs_read = False
            print(f"note: could not read the {gate} certifications ({str(e)[:80]}) — "
                  f"certNote is left BLANK rather than claiming nobody is certified.")

    head, existing_rows, records_tab = read_house_tab(tok, records_house, TAB)
    existing = {(key(r.get("staffName", "")), key(r.get("clientName", ""))) for r in existing_rows}

    print(f"certification        : {gate} ({cfg_text(cfg, 'ist_gate_certification_label')}) — "
          f"none on file reads \"{no_certification_note(cfg)}\"")
    fresh, skipped_no_overlap, unknown_staff = new_rows(
        cfg, first_at=first_at, days=days, by_house=by_house, client_start=client_start,
        existing=existing, people=people, certs=certs, certs_read=certs_read,
        now=datetime.now(timezone.utc).isoformat(), today=datetime.now(timezone.utc).date())

    marker = cfg_text(cfg, "ist_stale_marker")
    marks = stale_marks(existing_rows, by_house, marker) if "houseStatus" in head else []
    if "houseStatus" not in head and existing_rows:
        print("note: the table has no houseStatus column — no row was marked or cleared.")

    print(f"houses mapped        : {len(by_house)}")
    print(f"house×staff rostered : {len(first_at)}")
    print(f"already on file      : {len(existing)}")
    print(f"skipped (never overlapped the client): {skipped_no_overlap}")
    print(f"NEW rows             : {len(fresh)}")
    if fresh and certs_read:
        print(f"certNote on new rows : {note_counts(fresh, cfg)}")
    print(f"marked \"{marker}\"    : {sum(1 for _, v in marks if v)}; cleared: "
          f"{sum(1 for _, v in marks if not v)}")
    if unknown_staff:
        print(f"\nrostered but NOT in the Hub's people list ({len(unknown_staff)}) — "
              f"their rows carry no contact details:")
        for n in sorted(unknown_staff):
            print(f"   {n}")

    if dry:
        print("\n--dry-run: nothing written.")
        return

    if marks:
        col = col_letter(head.index("houseStatus"))
        data = [{"range": f"{records_tab}!{col}{i + 2}", "values": [[v]]} for i, v in marks]
        for i in range(0, len(data), 500):
            sheet_api(tok, records_house, "/values:batchUpdate", "POST",
                      {"valueInputOption": "RAW", "data": data[i:i + 500]})
        print(f"   houseStatus written on {len(marks)} row(s)")

    if not fresh:
        print("\nNothing new to add.")
        return

    # listRows_ maps by header name: a column missing from the header makes its values invisible
    if head[: len(HEADER)] != HEADER:
        sheet_api(tok, records_house, f"/values/{urllib.parse.quote(TAB + '!A1:R1')}?valueInputOption=RAW",
                  "PUT", {"values": [HEADER]})

    for i in range(0, len(fresh), 500):
        chunk = fresh[i:i + 500]
        sheet_api(tok, records_house,
                  f"/values/{urllib.parse.quote(TAB + '!A:R')}:append"
                  "?valueInputOption=RAW&insertDataOption=INSERT_ROWS",
                  "POST", {"values": chunk})
        print(f"   wrote {i + len(chunk)}/{len(fresh)}")

    print(f"\nwrote {len(fresh)} IST record(s) into {TAB}.")


if __name__ == "__main__":
    main()
