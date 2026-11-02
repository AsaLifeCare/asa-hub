-- The Task Board's attachments kept on the server (app/task_board_writes.py taskFileStore): one row per file under
-- documents/tasks, its uploader the only one who opens it (app/task_board.py taskFile). Applied by hand as the owner
-- (POSTGRES_USER); idempotent.
set role asa_hub_app_rw;

create table if not exists app.task_files (
    id          text primary key,
    name        text not null,
    mime        text not null default '',
    size_bytes  bigint not null default 0,
    path        text not null,
    by_email    text not null,
    write_id    text not null default '',
    created_at  timestamptz not null default now()
);
create index if not exists task_files_by_email on app.task_files (by_email);

grant select on app.task_files to asa_hub_app_ro;
