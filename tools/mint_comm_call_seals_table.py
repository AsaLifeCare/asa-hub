#!/usr/bin/env python3
"""
MINT THE SEAL STORE, THE LEDGER AND THE SWITCH — the three Postgres tables.

THE RULE: the tables carry the Smart Comms name itself, the words they hold
are encrypted, and only the holder of the private key can open them.

WHY THESE THREE ARE NOT HOUSES, and the first reason is measured rather than
stylistic:

  comm_call_seals   A Google Sheets cell holds 50,000 characters. The largest
                    transcript in this corpus is 120,027 characters, and
                    sealed and base64'd it is roughly 161,000 — 3.2x over. A
                    truncated GCM blob is not partially readable; it is
                    entirely unopenable. Chunking ciphertext across cells
                    would not solve that, it would multiply the ways to lose a
                    chunk. `bytea`, raw DER, about 21 MB for the whole corpus.
  comm_call_reads   The ledger is read and written once per call, before and
                    after a model round trip. A sheet write per call would
                    spend the lane's whole budget on bookkeeping, and the
                    ledger must survive a process that was killed mid-batch —
                    which is exactly what a transactional store is for.
  comm_call_catchup The switch. It must be turnable from a psql prompt at two
                    in the morning with nothing restarted and nothing
                    published. A knob inside a spreadsheet the relay caches
                    for five minutes is not a stop button.

THE NAMES STILL BELONG TO THE comm_ FAMILY, beside
comm_intents, comm_proposals, comm_observations, comm_attempts and
comm_bindings. And the one-row `*_catchup` control table follows the shape this
platform already uses for a lane's switch (asa_auto_learn_control,
asa_handsoff_control, asa_gs_app_autopilot_control).

────────────────────────────────────────────────────────────────────────────
WHAT A SEAL ROW HOLDS, AND WHY EVERY CLEAR COLUMN IS CLEAR

A ciphertext nobody can find again is the same as a deleted one. So the
locators are deliberately in the open, and not one of them is a word anybody
said:

  seal_id, call_id, scope, item_no  WHICH CALL AND WHICH MATTER. Findable by
                                    call, by day and by kind without opening
                                    anything.
  field                             which of the two transcripts, or which
                                    item summary.
  alg                               'cms-authenveloped:rsa-oaep-sha256+
                                    aes-256-gcm' — named in the row so a
                                    reader years from now knows what opens it
                                    without reading any code.
  recipient_fpr                     the SHA-256 fingerprint of the recipient's
                                    public certificate. Key rotation is
                                    therefore answerable with a GROUP BY: rows
                                    sealed to an old key keep the old
                                    fingerprint, stay openable with the old
                                    private key, and are NEVER re-sealed.
                                    Deleting an "old" key file because a new
                                    one exists destroys the old words.
  plain_len, cipher_len             characters sealed and bytes stored, so a
                                    TRUNCATION IS DETECTABLE WITHOUT OPENING
                                    ANYTHING.
  plain_sha256                      the digest of the plaintext. It is also
                                    INSIDE the seal, so the two can be
                                    compared where the private key lives and a
                                    wrong-key open is self-evidently wrong.
  sealed_at                         when.

The ciphertext itself is CMS AuthEnvelopedData: RSA-OAEP-SHA256 key transport
plus AES-256-GCM, DER. See server/comm_seal.py for why that scheme and not the
three alternatives, and for the one paragraph nobody may delete — a hash would
make the words unreadable by EVERYBODY, key holder included, and a passphrase
would sit in the same place as the data it protects.

────────────────────────────────────────────────────────────────────────────
WHAT THE LEDGER IS FOR, AND WHY IT HOLDS FACTS

`comm_call_reads` is the cursor, and there is no other: the next batch is "the
calls with no row here", asked fresh every pass. There is no offset to lose and
no position to get wrong.

  THE CLAIM IS THE LOCK. `call_id` is the primary key and the lane inserts
  with `on conflict do nothing`, so two workers — the live tick and the
  catch-up run by hand in a terminal — may read the same pile at the same
  moment and can never pay for the same call twice.
  `facts` HOLDS THE CLEAR ROWS UNTIL THE DOOR CONFIRMS THEM. Sealing and
  reading cost money; the hand-over to Apps Script fails routinely. Without
  this column a failed hand-over would mean re-reading the call — paying
  again, producing slightly different facts, sealing the same words twice.
  It is dropped the moment the house has the rows: the house is the copy that
  matters and a second one starts to disagree.
  IT IS FACTS, NEVER WORDS. The same values that go into the two clear
  houses — so this column adds no exposure the houses do not already have.
  `state` TELLS THE SILENCES APART: reading (claimed, in flight or abandoned
  by a killed process), read, unreadable. MISSING IS NOT ZERO: `items` is NULL
  on an unreadable call and never 0.
  `attempts` IS WHY 'unreadable' IS NOT A LIFE SENTENCE. Every model failure
  is a door being down, not a call being unreadable in principle — and a
  provider that fell over for an hour would otherwise mark that hour's calls
  unread FOR EVER, since nothing is ever offered twice. So an unreadable call
  is offered again while `attempts` is below the lane's ceiling, and the words
  are already sealed, so a retry costs one model call and never a second seal.
  Past the ceiling it stops: a door that has failed three times on the same
  call is a thing a person must fix, and re-reading it on every pass is how a
  lane burns a whole quota on nothing.
  `hand_attempts`, `hand_at` AND `hand_error` ARE ABOUT THE OTHER JOURNEY, and
  they are separate columns for a reason. `attempts` counts READS; overloading
  it with hand-overs would make a shut door look like an unreadable call and
  spend the reading retries on a network problem. And only an ANSWER counts
  here: a door that could not be REACHED has said nothing about the row, so it
  does not increment — an afternoon without a network must never be able to
  quarantine facts a model was paid to produce.

────────────────────────────────────────────────────────────────────────────
NOTHING HERE RETIRES, AND NOTHING SWEEPS

No TTL, no cleanup job, no cascade. A seal row that expired would be somebody's
words destroyed on a timer; a ledger row that expired would make the lane
re-read and re-seal a call it had already paid for. The only DELETE these
tables should ever see is a person's, deliberately, one call at a time.

THE FOREIGN KEY IS DELIBERATELY ABSENT between the seals and the ledger. A
ciphertext must survive its ledger row: the call_id and the field are INSIDE
the seal, so even a lost or re-keyed ledger cannot orphan the words beyond
recovery, and a cascade could.

────────────────────────────────────────────────────────────────────────────
    python3 tools/mint_comm_call_seals_table.py            # prints the DDL
    python3 tools/mint_comm_call_seals_table.py --apply    # creates them

WITHOUT `--apply` IT WRITES NOTHING. It prints the statements so they can be
read, argued with, and run by hand against psql if that is preferred. Every
statement is IF NOT EXISTS: running it twice changes nothing.

THE SWITCH IS CREATED OFF. `enabled = false`, and that is not a placeholder —
a person starts the catch-up, not this script and not the lane.
"""
from __future__ import annotations

import os
import sys

DDL = [
    # ------------------------------------------------------------------
    # THE SEAL STORE
    # ------------------------------------------------------------------
    """
create table if not exists public.comm_call_seals (
    seal_id        text        not null,
    call_id        text        not null,
    scope          text        not null,
    item_no        text        not null default '',
    field          text        not null,
    alg            text        not null,
    recipient_fpr  text        not null,
    ciphertext     bytea       not null,
    plain_len      integer     not null,
    cipher_len     integer     not null,
    plain_sha256   text        not null,
    sealed_at      text        not null,
    stored_at      timestamptz not null default now(),
    primary key (seal_id, field)
)""",
    # BY CALL, because "show me everything sealed from this call" is the one
    # question anybody will actually ask.
    "create index if not exists comm_call_seals_call_idx on public.comm_call_seals (call_id)",
    # BY KEY, because rotation has to be answerable with a GROUP BY and never
    # with a re-seal.
    "create index if not exists comm_call_seals_fpr_idx on public.comm_call_seals (recipient_fpr)",

    # ------------------------------------------------------------------
    # THE LEDGER — the cursor, and there is no other
    # ------------------------------------------------------------------
    """
create table if not exists public.comm_call_reads (
    call_id     text        primary key,
    state       text        not null default 'reading',
    run_id      text,
    attempts    integer     not null default 1,
    claimed_at  timestamptz not null default now(),
    read_at     timestamptz,
    landed_at   timestamptz,
    model_via   text,
    items       integer,
    error       text,
    facts         jsonb,
    hand_attempts integer   not null default 0,
    hand_at       timestamptz,
    hand_error    text
)""",
    # AND THE THREE COLUMNS ADDED TO A LEDGER THAT ALREADY EXISTS. The first
    # mint of this table predates the delivery pass, and the rows in it are
    # facts somebody paid a model to read — so the shape moves forward and the
    # rows stay. `comm_calls_feed._hand_columns` runs the same ALTER on its
    # first pass, because a lane that needs somebody to run a script before
    # it can record why a hand-over failed will simply not record it.
    "alter table public.comm_call_reads "
    "  add column if not exists hand_attempts integer not null default 0, "
    "  add column if not exists hand_at timestamptz, "
    "  add column if not exists hand_error text",
    # THE ONE QUERY THE LANE RUNS EVERY PASS: what has been read and not yet
    # confirmed by the door.
    "create index if not exists comm_call_reads_pending_idx on public.comm_call_reads (landed_at) "
    "where landed_at is null",
    "create index if not exists comm_call_reads_state_idx on public.comm_call_reads (state)",

    # ------------------------------------------------------------------
    # THE SWITCH — one row, and it ships OFF
    # ------------------------------------------------------------------
    """
create table if not exists public.comm_call_catchup (
    id          integer     primary key default 1,
    enabled     boolean     not null default false,
    updated_at  timestamptz not null default now(),
    updated_by  text,
    note        text,
    constraint comm_call_catchup_one_row check (id = 1)
)""",
    # CREATED OFF, AND ONLY ONCE. `on conflict do nothing` means re-running
    # this script can never turn a running catch-up back on or off — the
    # switch is only ever set by hand, from the moment it exists.
    "insert into public.comm_call_catchup (id, enabled, updated_by, note) "
    "values (1, false, 'mint', 'ships off — a person starts the catch-up') "
    "on conflict (id) do nothing",
]


def main() -> None:
    apply = "--apply" in sys.argv
    if not apply:
        print("-- tools/mint_comm_call_seals_table.py — printed, NOT applied.")
        print("-- Run with --apply, or paste into psql. Every statement is idempotent.")
        for stmt in DDL:
            print(stmt.strip().rstrip(";") + ";")
        print("\n-- The switch is created OFF. Turning it on is a person's act, by hand:")
        print("--   update public.comm_call_catchup set enabled = true, updated_by = 'operator';")
        return

    dsn = os.getenv("HUB_SNAPSHOT_PG_DSN") or os.getenv("DATABASE_URL") or ""
    if not dsn:
        sys.exit("HUB_SNAPSHOT_PG_DSN is not set")
    import psycopg2
    conn = psycopg2.connect(dsn)
    try:
        with conn.cursor() as cur:
            for stmt in DDL:
                cur.execute(stmt)
                print("· " + " ".join(stmt.split())[:90])
        conn.commit()
    finally:
        conn.close()
    print("\nTHE THREE TABLES EXIST AND ARE EMPTY, and the switch is OFF.")
    print("Nothing may be read until the keyholder's public certificate is on this")
    print("machine: a call read before there is a key to seal with leaves the words")
    print("in the clear. server/comm_calls_feed.py refuses to start without it, by")
    print("design — a missing key is an outage, never a downgrade to plaintext.")


if __name__ == "__main__":
    main()
