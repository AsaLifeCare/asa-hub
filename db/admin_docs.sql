-- The Administration workspace's documents (app/admin_docs.py): every file the workspace holds, kept on the server in
-- the project's documents folder (documents/administration) — the ones brought in from the Administration Drive folder
-- (a Google file kept as its Office export and a PDF to view) and the ones uploaded here, which never go to Drive.
-- A delete trashes the row and keeps the file; a write the relay voids takes its row back (write_id).
-- Applied by hand as the owner (POSTGRES_USER); idempotent. asa-hub-app writes it (asa_hub_app_rw) and reads it
-- (asa_hub_app_ro).
set role asa_hub_app_rw;

create table if not exists app.admin_docs (
    id               text primary key,
    name             text not null,
    mime             text not null default 'application/octet-stream',
    size_bytes       bigint not null default 0,
    modified_time    timestamptz,
    path             text not null default '',
    view_path        text not null default '',
    view_mime        text not null default '',
    source           text not null,
    google_id        text not null default '',
    google_mime      text not null default '',
    google_modified  text not null default '',
    google_link      text not null default '',
    created_by       text not null default '',
    created_at       timestamptz not null default now(),
    updated_at       timestamptz not null default now(),
    trashed_at       timestamptz,
    trashed_by       text not null default '',
    write_id         text not null default ''
);
create unique index if not exists admin_docs_google on app.admin_docs (google_id) where google_id <> '';
create index if not exists admin_docs_live on app.admin_docs (modified_time desc) where trashed_at is null;

-- each row as it stood before a write changed it (null: the write made it), so a void takes the write back
create table if not exists app.admin_doc_changes (
    id        bigserial primary key,
    write_id  text not null,
    doc_id    text not null,
    before    jsonb,
    at        timestamptz not null default now()
);
create index if not exists admin_doc_changes_write on app.admin_doc_changes (write_id);

grant select on app.admin_docs, app.admin_doc_changes to asa_hub_app_ro;
