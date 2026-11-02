-- The Line Directory's kept state (app/line_directory.py): one row per key. HUB_LINE_DIRECTORY holds the last good
-- directory of the company's phone lines, as the provider listed it or as the relay handed it over from the
-- platform's copy (lineDirectorySync); hub_line_directory_shut_v1 holds a refusal of the provider, remembered for
-- fifteen minutes from updated_at. write_id names the write that put a row there ('' for a read that stored it).
-- Applied by hand as the owner (POSTGRES_USER); idempotent. asa-hub-app writes it (asa_hub_app_rw) and reads it
-- (asa_hub_app_ro).
set role asa_hub_app_rw;

create table if not exists app.line_directory (
    key         text primary key check (key <> ''),
    directory   jsonb not null,
    write_id    text not null default '',
    updated_at  timestamptz not null default now()
);

grant select on app.line_directory to asa_hub_app_ro;
