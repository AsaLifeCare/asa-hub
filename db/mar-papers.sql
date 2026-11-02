-- Clients › Medication › Administration: the MARS papers' OCR text, kept in the Hub's own tables.
-- Applied by hand as the owner (POSTGRES_USER); idempotent. The tables are the app writer's, like every app.* table.
-- The relay's medication lane (role asa_hub_meds, server/mar_papers.py) finds the papers in the Clients drive and
-- reads them; asa-hub-app (role asa_hub_app_ro) only reads. The text is never copied to a sheet, a slice or a pack.
set role asa_hub_app_rw;

-- a paper the drive holds and client_files does not: the sweep's own row, never a sheet's
create table if not exists app.mar_papers (
    drive_id       text primary key,
    client_folder  text not null,
    area           text not null default 'active',
    folder         text not null default '',
    title          text not null,
    mime_type      text not null default '',
    size_bytes     bigint not null default 0,
    file_date      text not null default '',
    created_time   timestamptz,
    modified_time  timestamptz,
    found_at       timestamptz not null default now(),
    seen_at        timestamptz not null default now(),
    gone_at        timestamptz
);

-- one row per paper of the list (client_files' MARS rows and the sweep's): read only when state = 'read'
create table if not exists app.mar_paper_texts (
    drive_id     text primary key,
    source       text not null check (source in ('client_files', 'drive')),
    state        text not null default 'pending' check (state in ('pending', 'read', 'failed')),
    mark         text not null default '',
    engine       text not null default '',
    text         text,
    chars        integer,
    pages        integer,
    masked       integer not null default 0,
    error        text not null default '',
    attempts     integer not null default 0,
    next_try_at  timestamptz not null default now(),
    read_at      timestamptz,
    seconds      real,
    updated_at   timestamptz not null default now()
);
create index if not exists mar_paper_texts_due on app.mar_paper_texts (next_try_at) where state <> 'read';

-- the lane's beat: when the drive was last listed and walked, and what the last pass said
create table if not exists app.mar_papers_beat (
    id          integer primary key default 1 check (id = 1),
    swept_at    timestamptz,
    walked_at   timestamptz,
    places      jsonb not null default '[]',
    found       integer not null default 0,
    read        integer not null default 0,
    failed      integer not null default 0,
    note        text not null default '',
    updated_at  timestamptz not null default now()
);

grant select, insert, update on app.mar_papers, app.mar_paper_texts, app.mar_papers_beat to asa_hub_meds;
grant select on app.mar_papers, app.mar_paper_texts, app.mar_papers_beat to asa_hub_app_ro;
reset role;
