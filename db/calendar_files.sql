-- Calendar: the files pinned to a day of the company calendar (app/company_calendar_writes.py), each filed in Drive as
-- the platform's own account by the relay, kept in the Hub's database alone — no sheet holds a new one. Any row the
-- calendar_files tab ever holds is listed beside these. A removal keeps the row and marks it; a write the relay voids
-- takes its row back (write_id).
-- Applied by hand as the owner (POSTGRES_USER); idempotent. asa-hub-app writes it (asa_hub_app_rw) and reads it
-- (asa_hub_app_ro).
set role asa_hub_app_rw;

create table if not exists app.calendar_files (
    file_id        text primary key check (file_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
    day            text not null check (day ~ '^\d{4}-\d{2}-\d{2}$'),
    name           text not null,
    url            text not null,
    mime           text not null default '',
    by_email       text not null default '',
    at             text not null,
    drive_file_id  text not null default '',
    shared         boolean not null default true,
    write_id       text not null default '',
    removed_at     timestamptz,
    removed_by     text not null default '',
    removed_write_id text not null default ''
);
create index if not exists calendar_files_day on app.calendar_files (day) where removed_at is null;

grant select on app.calendar_files to asa_hub_app_ro;
reset role;
