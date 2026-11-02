-- The Employee Support Hotline's calls, kept in the Hub's own tables as the relay's Quo webhook hands them over
-- (app/hotline_writes.py): one row per call, its turns as the transcript event carried them. Filing reads from here.
-- Applied by hand as the owner (POSTGRES_USER); idempotent. asa-hub-app writes it (asa_hub_app_rw) and reads it
-- (asa_hub_app_ro).
set role asa_hub_app_rw;

create table if not exists app.hotline_calls (
    call_id        text primary key check (call_id ~ '^AC[0-9A-Za-z]{32}$'),
    event_at       text not null default '',
    created        text not null default '',
    duration       numeric,
    caller_phones  text[] not null default '{}',
    team           text[] not null default '{}',
    dialogue       jsonb not null,
    received_at    timestamptz not null default now(),
    -- Python's own reading of the call, kept beside Apps Script's filing until Python files it alone
    shadow         jsonb,
    shadow_at      timestamptz
);
create index if not exists hotline_calls_received on app.hotline_calls (received_at desc);

-- Python's filing of the call (app/hotline_file.py): when, and what it kept; a filed call is never filed again
alter table app.hotline_calls add column if not exists filed_at timestamptz;
alter table app.hotline_calls add column if not exists filing jsonb;

grant select on app.hotline_calls to asa_hub_app_ro;
reset role;
