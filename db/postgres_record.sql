-- asa-hub-db as the record of every book Postgres writes (app/record_books.py, app/sheet_sync.py, app/sheet_check.py,
-- db/sync.py). A book enrolled here is backed up to Google by a paced queue (what it owes, the last success) and read
-- once a day — or on demand — for what someone still edits in the sheet; from its first stored check on, its copy is
-- that check's, never the mirror's. Applied by hand as the owner (POSTGRES_USER); idempotent. asa-hub-sheet-sync
-- writes it (asa_hub_app_rw), asa-hub-db-sync stores the checks it stages, asa-hub-app reads it (asa_hub_app_ro), the
-- relay's sheet keeper may read which books it holds (asa_hub_meds, HUB_SHEET_SYNC_RECORD_OUT).
set role asa_hub_app_rw;

create table if not exists app.record_books (
    sheet_id        text primary key,
    name            text not null default '',
    enrolled_at     timestamptz not null default now(),
    -- the copy is the daily check's from this moment on (asa-hub-db-sync stores the first one)
    held_since      timestamptz,
    paused          boolean not null default false,
    -- Postgres → Google: the cells owed and since when, the last success, the next try after a refusal
    owed            integer not null default 0,
    owed_since      timestamptz,
    last_backup_at  timestamptz,
    backup_try_at   timestamptz,
    backup_next_at  timestamptz,
    backup_tries    integer not null default 0,
    backup_why      text not null default '',
    -- Google → Postgres: the daily check; check_tabs names the tabs of a check asked on demand
    check_every_s   integer not null default 86400 check (check_every_s >= 300),
    check_due_at    timestamptz not null default now(),
    check_tabs      jsonb,
    last_check_at   timestamptz,
    last_pull_id    bigint,
    check_tries     integer not null default 0,
    check_why       text not null default ''
);

-- a check's read of a book: staged by asa-hub-sheet-sync, stored as the copy by asa-hub-db-sync, compacted (its
-- app.edit_compactions applied) by asa-hub-sheet-sync once it has stood a while
create table if not exists app.sheet_pulls (
    id          bigserial primary key,
    sheet_id    text not null,
    name        text not null default '',
    read_at     timestamptz not null,
    partial     boolean not null default false,
    tabs        jsonb not null default '[]'::jsonb,
    state       text not null default 'reading'
                check (state in ('reading', 'staged', 'stored', 'compacted', 'failed')),
    stored_at   timestamptz,
    why         text not null default '',
    at          timestamptz not null default now()
);
create index if not exists sheet_pulls_open on app.sheet_pulls (id) where state in ('reading', 'staged');

-- the rows read, each already through the withholding rule (server/redaction.py)
create table if not exists app.sheet_pull_rows (
    pull_id     bigint not null references app.sheet_pulls (id) on delete cascade,
    tab_name    text not null,
    row_number  integer not null,
    data        jsonb not null,
    primary key (pull_id, tab_name, row_number)
);

-- the kept edits a stored check made redundant (the copy holds them), deleted once it has stood a while
create table if not exists app.edit_compactions (
    pull_id     bigint not null references app.sheet_pulls (id) on delete cascade,
    sheet_id    text not null,
    tab_name    text not null,
    match_by    text not null,
    keyed_by    text not null,
    row_key     text not null,
    field       text not null,
    upto_id     bigint not null,
    primary key (pull_id, sheet_id, tab_name, match_by, keyed_by, row_key, field)
);

grant select on app.record_books, app.sheet_pulls, app.edit_compactions to asa_hub_app_ro;
grant select on app.record_books to asa_hub_meds;
reset role;
