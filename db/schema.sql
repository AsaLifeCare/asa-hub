-- asa-hub-db schema: "catalog" lists every ASA book and tab, "sheets" holds one table per tab.
-- sync.py applies this file at every start, so every statement here must stay idempotent.
create schema if not exists catalog;
create schema if not exists sheets;

create table if not exists catalog.books (
    sheet_id       text primary key,
    name           text not null,
    owners         jsonb not null default '[]',
    modified_time  timestamptz,
    synced_at      timestamptz,
    status         text,
    tab_count      integer not null default 0,
    row_count      integer not null default 0,
    gone_at        timestamptz
);

-- columns: [[header, column], ...] in table order; headers past the column cap live only in _raw
create table if not exists catalog.tabs (
    sheet_id          text not null,
    tab_name          text not null,
    table_name        text not null unique,
    columns           jsonb not null default '[]',
    row_count         integer not null default 0,
    source_synced_at  timestamptz,
    loaded_at         timestamptz,
    gone_at           timestamptz,
    primary key (sheet_id, tab_name)
);

-- direct_modified: the sheet's modifiedTime when the sync last read the book straight from Google
alter table catalog.books add column if not exists direct_modified timestamptz;

-- guarded: loaded under server/redaction.py; a tab loaded before it is reloaded once
alter table catalog.tabs add column if not exists guarded boolean not null default false;

-- digest: md5 over the stored rows' keyed hashes (sheets.*._hash) in row order; keys: the mirror keys they were stored under
alter table catalog.tabs add column if not exists digest text;
alter table catalog.tabs add column if not exists keys jsonb;

-- checked_at: when the copy of the book last equalled the mirror; listed_at: the keeper's Drive listing it holds
alter table catalog.books add column if not exists checked_at timestamptz;
alter table catalog.books add column if not exists listed_at timestamptz;

-- reloads: a change of the rule that reloads the tabs it reaches, applied once by name
create table if not exists catalog.reloads (
    name        text primary key,
    applied_at  timestamptz not null default now()
);

create or replace view catalog.tab_index as
    select t.sheet_id, b.name as book, t.tab_name, 'sheets.' || t.table_name as table_ref,
           t.row_count, t.loaded_at, coalesce(t.gone_at, b.gone_at) as gone_at
      from catalog.tabs t
      left join catalog.books b using (sheet_id);
