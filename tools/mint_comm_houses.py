#!/usr/bin/env python3
"""Mints and declares the comm houses (tab, depot facts, Registry row, service-account share); re-runnable."""
from __future__ import annotations

import base64
import json
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

ENV_PATH = Path("/opt/docker/asa-hub/server/.tools.env")
ESSENCIAL_ID = "1Y6UMJlCS5gHur52f0YrPsLSqwYlCA792I8gAiZsxsug"
SA_JSON_PATHS = [Path("/opt/docker/asa-hub/server/.service-account.json")]
RECORDED_BY = "mint-comm"

# ── The houses ──

INTENTS = {
    "tab": "comm_intents",
    "title": "ASA Data — CommIntents",
    "prop": "HUB_HOUSE_COMM_INTENTS_ID",
    "note": "data: comm_intents (one need per person — never one per obligation)",
    "header": [
        "id", "createdAt", "updatedAt",
        "intent_key", "purpose",
        "person_key", "person_name",
        # `stopped` is only ever a recorded decision, never a timeout.
        "state", "open_count", "worst",
        "dial", "verdict", "reasons", "channel", "route_tried",
        "carried", "deferred",
        "planned_at", "last_asked_at", "attempts",
        # Test-mode sends pace these and never count against the person.
        "test_attempts", "test_last_asked_at", "test_mode",
        "escalate", "escalate_why", "reply_token", "last_error",
        "thread_id", "last_reply_at", "escalate_to", "escalate_to_confidence",
        "tenant",
    ],
}

# Append-only: nothing here is ever rewritten.
ATTEMPTS = {
    "tab": "comm_attempts",
    "title": "ASA Data — CommAttempts",
    "prop": "HUB_HOUSE_COMM_ATTEMPTS_ID",
    "note": "data: comm_attempts (append-only attempts and provider receipts)",
    "header": [
        "id", "createdAt", "intent_key", "person_key", "attempt", "channel",
        "to_masked", "receipt", "error", "redirected", "doubt", "test_mode", "at",
        # Never the body. Mirrors COMM_ATTEMPTS_HEADER in CommRecord.gs; keep the two in step.
        "words_sha", "situation", "sender_used",
    ],
}

# One row per obligation inside an intent; each binding resolves alone.
BINDINGS = {
    "tab": "comm_bindings",
    "title": "ASA Data — CommBindings",
    "prop": "HUB_HOUSE_COMM_BINDINGS_ID",
    "note": "data: comm_bindings (intent <-> obligation; each resolves alone)",
    "header": [
        "id", "createdAt", "updatedAt",
        "intent_key", "demand_id",
        # As requirement_states computed it; never recomputed here.
        "person_key", "req_id", "state", "expires", "days_left",
        "band", "binding_state",
        # One check can settle several requirements; `also` names those folded in.
        "also", "settles",
        "qualified_by", "qualified_at", "note",
    ],
}

# Undeclared, hubTabEnsure_ would resolve this tab to headquarters (COMM_ROUTES_HEADER in CommCortex.gs).
ROUTES = {
    "tab": "comm_routes",
    "title": "ASA Data — CommRoutes",
    "prop": "HUB_HOUSE_COMM_ROUTES_ID",
    "note": "data: comm_routes (the cortex's route + awake-window per person; upsert by person)",
    "header": [
        "id", "createdAt", "updatedAt",
        "person_key", "name",
        "phone", "email", "phones_known", "emails_known",
        "window_from", "window_to", "window_why",
        # A suggestion with its own confidence, never an instruction.
        "supervisor", "supervisor_key", "supervisor_confidence",
        "source_at",
    ],
}

# Append-only, Events.gs' columns indexed by intent.
OBSERVATIONS = {
    "tab": "comm_observations",
    "title": "ASA Data — CommObservations",
    "prop": "HUB_HOUSE_COMM_OBSERVATIONS_ID",
    "note": "data: comm_observations (append-only trail: sent, replied, qualified, settled, escalated…)",
    "header": [
        "event_id", "type", "actor", "subject_type", "subject_key", "subject_name",
        "intent_key", "payload", "source", "at", "tenant",
    ],
}

CONTRIBUTIONS = {
    "tab": "comm_contributions",
    "title": "ASA Data — CommContributions",
    "prop": "HUB_HOUSE_COMM_CONTRIBUTIONS_ID",
    "note": "data: comm_contributions (a reply as a typed candidate; the demand owner's verdict)",
    "header": [
        "id", "createdAt", "updatedAt",
        "intent_key", "person_key", "person_name",
        "channel", "message_id", "thread_id", "received_at", "text",
        "correlation", "kind", "claims", "why",
        "settled_now", "awaiting",
        # awaiting_owner | needs_human | settled | dismissed | stopped
        "state", "reason",
        "verdict", "verdict_by", "verdict_at", "note",
    ],
}

REPAIRS = {
    "tab": "comm_repairs",
    "title": "ASA Data — CommRepairs",
    "prop": "HUB_HOUSE_COMM_REPAIRS_ID",
    "note": "data: comm_repairs (an incident declared with the words, and each person owed one correction)",
    # CommRepair.gs COMM_REPAIRS_HEADER
    "header": [
        "id", "createdAt", "updatedAt", "kind",
        "incident_id", "situation", "window_from", "window_to", "what_was_wrong",
        "words_sha_then", "sender_then",
        "state", "priority", "audience",
        "declared_by", "declared_at", "confirmed_by", "confirmed_at", "closed_at", "note",
        "intent_key", "person_key", "person_name", "told_at", "told_channel",
        "claim_state", "claimed_at", "claim_path", "claim_host_key", "attempt_id", "receipt",
        "test_claim_state", "test_claimed_at",
        "undeliverable_why", "tenant",
    ],
}

HOUSES = [INTENTS, BINDINGS, ATTEMPTS, ROUTES, OBSERVATIONS, CONTRIBUTIONS, REPAIRS]


def env(k: str) -> str:
    for line in ENV_PATH.read_text().splitlines():
        line = line.strip()
        if line.startswith(f"{k}="):
            return line.split("=", 1)[1].strip().strip("'\"")
    sys.exit(f"{k} not found in {ENV_PATH}")


def token() -> str:
    body = urllib.parse.urlencode({
        "client_id": env("GS_GOOGLE_CLIENT_ID"),
        "client_secret": env("GS_GOOGLE_CLIENT_SECRET"),
        "refresh_token": env("GS_GOOGLE_REFRESH_TOKEN"),
        "grant_type": "refresh_token"}).encode()
    req = urllib.request.Request("https://oauth2.googleapis.com/token", data=body, method="POST")
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)["access_token"]


TOK = token()
S = "https://sheets.googleapis.com/v4/spreadsheets/"
D = "https://www.googleapis.com/drive/v3/files/"


def api(url: str, payload: dict | None = None, method: str = "GET", tries: int = 6) -> dict:
    for a in range(tries):
        req = urllib.request.Request(url, method=method)
        req.add_header("Authorization", "Bearer " + TOK)
        body = json.dumps(payload).encode() if payload is not None else None
        if body:
            req.add_header("Content-Type", "application/json")
        try:
            with urllib.request.urlopen(req, body, timeout=120) as resp:
                raw = resp.read()
                return json.loads(raw) if raw else {}
        except Exception as err:
            if getattr(err, "code", 0) in (400, 403, 404):
                raise
            if a < tries - 1:
                time.sleep(5 * (a + 1))
                continue
            raise
    return {}


def depot_state() -> dict[str, str]:
    """Facts, last row wins per Source — the depot's own reading law."""
    rows = api(S + ESSENCIAL_ID + "/values/" + urllib.parse.quote("'Facts'!A2:I999999")).get("values") or []
    state: dict[str, str] = {}
    for row in rows:
        if len(row) > 4 and row[4]:
            state[str(row[4])] = str(row[2]) if len(row) > 2 else ""
    return state


def sa_email() -> str:
    for p in SA_JSON_PATHS:
        try:
            raw = p.read_text().strip()
            info = json.loads(base64.b64decode(raw)) if not raw.startswith("{") else json.loads(raw)
            if info.get("client_email"):
                return str(info["client_email"])
        except Exception:
            continue
    return ""


def mint(house: dict, have: dict[str, str], now: str, sa: str, dry: bool) -> str:
    tab, title, prop, header = house["tab"], house["title"], house["prop"], house["header"]
    src_ptr = f"switchboard:props.{prop}"
    sid = have.get(src_ptr, "")
    if sid:
        print(f"· {tab}: pointer already in the depot ({sid[:14]}…) — reusing the house")
    if dry:
        print(f"  --dry-run: would {'reuse' if sid else 'create'} \"{title}\" "
              f"({len(header)} cols), append the three facts and the Registry row.")
        return sid or "(would create)"

    live_header = None
    if sid:
        # Never re-stamp a live house: a header PUT would relabel columns without moving values.
        got = api(S + sid + "/values/" + urllib.parse.quote(f"'{tab}'!1:1")).get("values") or []
        live_header = [str(h) for h in (got[0] if got else []) if str(h).strip()]
        if live_header:
            header = live_header
            print(f"  live header kept ({len(header)} cols); the declaration follows it")
    if not sid:
        sid = api(S, {"properties": {"title": title},
                      "sheets": [{"properties": {
                          "title": tab,
                          "gridProperties": {"rowCount": 5000,
                                             "columnCount": len(header) + 3,
                                             "frozenRowCount": 1}}}]}, "POST")["spreadsheetId"]
        print(f"  house created as asatech: {title} = {sid}")
    # Header first: a headerless tab would be resurrected at headquarters by the first writer.
    if live_header is None:
        api(S + sid + "/values/" + urllib.parse.quote(f"'{tab}'!A1") + "?valueInputOption=RAW",
            {"values": [header]}, "PUT")
        print(f"  header stamped ({len(header)} cols)")

    facts = []
    if have.get(src_ptr) != sid:
        facts.append(["config.props." + prop.lower().replace("_", ""), prop, sid, "",
                      src_ptr, "", now, RECORDED_BY, ""])
    if have.get(f"switchboard:moved.{tab}") != "on":
        facts.append([f"config.moved.{tab}", f"moved.{tab}", "on", "",
                      f"switchboard:moved.{tab}", "", now, RECORDED_BY, ""])
    schema_val = json.dumps(header, separators=(",", ":"))
    if have.get(f"schema:{tab}.header") != schema_val:
        facts.append([f"schema.{tab}.header", "__schema", schema_val, "",
                      f"schema:{tab}.header", "", now, RECORDED_BY, ""])
    if facts:
        api(S + ESSENCIAL_ID + "/values/" + urllib.parse.quote("'Facts'!A1") +
            ":append?valueInputOption=RAW&insertDataOption=INSERT_ROWS",
            {"values": facts}, "POST")
    fresh = depot_state()
    assert fresh.get(src_ptr) == sid, f"{tab}: pointer did not land"
    assert fresh.get(f"switchboard:moved.{tab}") == "on", f"{tab}: moved switch did not land"
    print(f"  declared: {prop} → {sid[:14]}… · moved.{tab}=on · schema ({len(header)} cols)")

    # Deduped by spreadsheet id; the Registry is first-row-wins per Context.
    reg = api(S + ESSENCIAL_ID + "/values/" + urllib.parse.quote("'Registry'!A2:D9999")).get("values") or []
    if any(len(r) > 0 and str(r[0]).strip().lower() == f"data.{tab}" for r in reg):
        print("  Registry row already present (context)")
    elif any(len(r) > 1 and str(r[1]).strip() == sid for r in reg):
        print("  Registry row already present (spreadsheet)")
    else:
        api(S + ESSENCIAL_ID + "/values/" + urllib.parse.quote("'Registry'!A1") +
            ":append?valueInputOption=RAW&insertDataOption=INSERT_ROWS",
            {"values": [[f"data.{tab}", sid, "on", house["note"]]]}, "POST")
        print("  Registry row appended")

    if sa:
        try:
            api(D + sid + "/permissions?sendNotificationEmail=false&supportsAllDrives=true",
                {"role": "writer", "type": "user", "emailAddress": sa}, "POST")
            print(f"  shared with {sa} (writer)")
        except Exception as exc:
            print(f"  WARNING: share failed ({str(exc)[:100]}) — only Apps Script writes today, "
                  f"so this is not fatal; share by hand before any Python writer is added")
    return sid


def main() -> None:
    dry = "--dry-run" in sys.argv
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    have = depot_state()
    sa = sa_email()
    print(f"service account for the share: {sa or 'NOT FOUND — shares will be skipped'}")
    made = {}
    for house in HOUSES:
        print(f"\n{house['title']}")
        made[house["tab"]] = mint(house, have, now, sa, dry)
    if dry:
        print("\n--dry-run: nothing was written.")
        return
    print("\nBOTH HOUSES ARE LIVE inside the 300s switchboard cache.")
    for tab, sid in made.items():
        print(f"  data.{tab} → {sid}")
    print("\nNext, in order:")
    print("  1. mint the app book (tools/mint_app_book.py behavior) — it reads the")
    print("     header LIVE from the declared house and refuses to document a guess;")
    print("  2. IN THE APPS SCRIPT EDITOR, by hand: runGatherDatabase() then")
    print("     runGatherDatabaseMove() — the two files are born in the asatech Drive")
    print("     root and only the editor can move them into ASA Hub - Source/Database.")


if __name__ == "__main__":
    main()
