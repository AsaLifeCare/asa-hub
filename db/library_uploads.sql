-- The files an admin or a manager stored in the platform's Library Files folder (Files.gs libraryUpload) — a Kanban
-- card's attachment, a document, a picture — filed in Drive as the platform's own account by the relay and kept here
-- (app/team_board_writes.py). A write the relay voids takes its row back (write_id).
-- Applied by hand as the owner (POSTGRES_USER); idempotent. asa-hub-app writes it (asa_hub_app_rw) and reads it
-- (asa_hub_app_ro).
set role asa_hub_app_rw;

create table if not exists app.library_uploads (
    file_id     text primary key,
    file_name   text not null,
    drive_name  text not null default '',
    mime_type   text not null default '',
    size_bytes  bigint not null default 0,
    by_email    text not null default '',
    at          timestamptz not null default now(),
    write_id    text not null default ''
);
create index if not exists library_uploads_at on app.library_uploads (at desc);

grant select on app.library_uploads to asa_hub_app_ro;
reset role;
