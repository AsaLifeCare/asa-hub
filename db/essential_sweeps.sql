-- Every sweep of the essential sheets (app/essential_sheets.py): the books people and forms still post to, read
-- straight from Google three times a day (or when the master presses Sweep now) and carried into their tables.
-- asked_by is 'clock' or the master's uid; result holds each tab's counts or why it was not swept.
-- Applied by hand as the owner (POSTGRES_USER); idempotent. asa-hub-app writes it (asa_hub_app_rw) and reads it
-- (asa_hub_app_ro).
set role asa_hub_app_rw;

create table if not exists app.essential_sweeps (
    id           bigserial primary key,
    started_at   timestamptz not null default now(),
    finished_at  timestamptz,
    asked_by     text not null default '',
    result       jsonb not null default '{}'
);
create index if not exists essential_sweeps_started on app.essential_sweeps (started_at desc);

grant select on app.essential_sweeps to asa_hub_app_ro;
reset role;
