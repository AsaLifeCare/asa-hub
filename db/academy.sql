-- Academy's video files kept on the server (app/academy.py): every video a lesson links in Drive brought into the
-- project's documents folder (documents/academy/<drive id>/<name>), so the player plays it from the platform. One row
-- per Drive file; a write the relay voids takes its row back (write_id).
-- Applied by hand as the owner (POSTGRES_USER); idempotent. asa-hub-app writes it (asa_hub_app_rw) and reads it
-- (asa_hub_app_ro).
set role asa_hub_app_rw;

create table if not exists app.academy_files (
    drive_id     text primary key,
    name         text not null default '',
    mime         text not null default 'video/mp4',
    size_bytes   bigint not null default 0,
    modified     text not null default '',
    path         text not null default '',
    why          text not null default '',
    fetched_at   timestamptz not null default now(),
    write_id     text not null default ''
);

grant select on app.academy_files to asa_hub_app_ro;
