-- The Technology workspace (app/technology.py): every file of the Technology Drive folder kept on the server, in the
-- project's documents folder (documents/technology/drive/<file id>/), one row per Drive file with where it sits in the
-- folder's tree — a Google file kept as its Office export and a PDF to view, any other file as itself — and the two
-- tables the screen writes: a project's chosen status and the projects added by hand.
-- A write the relay voids takes its row back (app.tech_changes, write_id).
-- Applied by hand as the owner (POSTGRES_USER); idempotent. asa-hub-app writes it (asa_hub_app_rw) and reads it
-- (asa_hub_app_ro).
set role asa_hub_app_rw;

create table if not exists app.tech_docs (
    drive_id         text primary key,
    name             text not null default '',
    rel              text not null default '',
    category         text not null default '',
    case_name        text not null default '',
    trail            text not null default '',
    kind             text not null default '',
    google_mime      text not null default '',
    google_size      bigint not null default 0,
    google_modified  text not null default '',
    web_view_link    text not null default '',
    mime             text not null default '',
    size_bytes       bigint not null default 0,
    path             text not null default '',
    view_path        text not null default '',
    view_mime        text not null default '',
    kept_modified    text not null default '',
    why              text not null default '',
    listed_at        timestamptz not null default now(),
    fetched_at       timestamptz,
    gone_at          timestamptz,
    write_id         text not null default ''
);
create index if not exists tech_docs_tree on app.tech_docs (category, rel) where gone_at is null;

-- the status picked on a project's card, over its curated one
create table if not exists app.tech_project_status (
    name        text primary key,
    status      text not null,
    updated_by  text not null default '',
    updated_at  timestamptz not null default now(),
    write_id    text not null default ''
);

-- a project tracked by hand, with no folder of its own
create table if not exists app.tech_manual_projects (
    name        text primary key,
    category    text not null default '',
    status      text not null default 'Not started',
    blurb       text not null default '',
    created_by  text not null default '',
    created_at  timestamptz not null default now(),
    write_id    text not null default ''
);

-- each row as it stood before a write changed it (null: the write made it), so a void takes the write back
create table if not exists app.tech_changes (
    id        bigserial primary key,
    write_id  text not null,
    tbl       text not null,
    key       text not null,
    before    jsonb,
    at        timestamptz not null default now()
);
create index if not exists tech_changes_write on app.tech_changes (write_id);

grant select on app.tech_docs, app.tech_project_status, app.tech_manual_projects, app.tech_changes to asa_hub_app_ro;
