-- Families: the family members a director or the master registers, kept in the Hub's own tables, never in a sheet.
-- Applied by hand as the owner (POSTGRES_USER); idempotent. The tables are the app writer's, like every app.* table:
-- asa-hub-app writes them (asa_hub_app_rw) and reads them (asa_hub_app_ro).
set role asa_hub_app_rw;

-- one family member, under the key every Families read already uses (fam_ + the name folded)
create table if not exists app.families (
    family_key         text primary key check (family_key ~ '^fam_[a-z0-9]{3,120}$'),
    name               text not null,
    relationship       text not null default '',
    phone              text not null default '',
    email              text not null default '',
    address            text not null default '',
    preferred_contact  text not null default '',
    notes              text not null default '',
    drive_folder_id    text not null default '',
    created_by         text not null,
    created_by_name    text not null default '',
    created_at         timestamptz not null default now(),
    updated_by         text not null default '',
    updated_at         timestamptz not null default now(),
    removed_at         timestamptz,
    removed_by         text not null default ''
);

-- the clients a family member is family of, and how
create table if not exists app.family_clients (
    family_key    text not null references app.families (family_key),
    client_key    text not null,
    relationship  text not null default '',
    is_guardian   boolean not null default false,
    created_by    text not null,
    created_at    timestamptz not null default now(),
    removed_at    timestamptz,
    primary key (family_key, client_key)
);

-- a paper on a family member: filed in Drive by Python, or a Drive file already there
create table if not exists app.family_documents (
    id             bigserial primary key,
    family_key     text not null references app.families (family_key),
    drive_id       text not null default '',
    name           text not null,
    doc_type       text not null default '',
    mime_type      text not null default '',
    size_bytes     bigint not null default 0,
    source         text not null default 'upload' check (source in ('upload', 'drive')),
    added_by       text not null,
    added_by_name  text not null default '',
    added_at       timestamptz not null default now(),
    removed_at     timestamptz,
    removed_by     text not null default ''
);
create index if not exists family_documents_family on app.family_documents (family_key) where removed_at is null;

-- every step since the family member was registered: Activity reads it newest first
create table if not exists app.family_events (
    id          bigserial primary key,
    family_key  text not null references app.families (family_key),
    kind        text not null,
    title       text not null,
    detail      jsonb not null default '{}',
    by_account  text not null default '',
    by_name     text not null default '',
    at          timestamptz not null default now()
);
create index if not exists family_events_family on app.family_events (family_key, at desc);

grant select on app.families, app.family_clients, app.family_documents, app.family_events to asa_hub_app_ro;
reset role;
