-- My World's own tables (app/world_store.py): every person's world is rows here, never a spreadsheet. The registry
-- (one row per world, its owner and its name), each tab a world holds (its header, in order), each row of a tab (its
-- cells by header, exactly as a door wrote them or as the workbook held them when it was imported), and every change a
-- write made, with what it replaced, so a write the relay voids is taken back. app/world_import.py copies the worlds
-- the sheets held once; app.world_imports names what it copied, and until the registry is copied no world door answers.
-- Applied by hand as the owner (POSTGRES_USER); idempotent. asa-hub-app writes them (asa_hub_app_rw) and reads them
-- (asa_hub_app_ro).
set role asa_hub_app_rw;

create table if not exists app.worlds (
    world_id         text primary key,
    owner_user_id    text not null,
    owner_email      text not null default '',
    name             text not null default '',
    -- the text the registry has always said: an ISO instant
    created_at       text not null default '',
    defaults_version text not null default '',
    -- the registry's order: an account's first world is the one it opens
    position         bigint not null,
    made_at          timestamptz not null default now(),
    updated_at       timestamptz not null default now(),
    write_id         text not null default ''
);
create index if not exists worlds_owner on app.worlds (owner_user_id, position);

create table if not exists app.world_tabs (
    world_id   text not null references app.worlds (world_id) on delete cascade,
    tab        text not null,
    header     jsonb not null default '[]'::jsonb,
    made_at    timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    write_id   text not null default '',
    primary key (world_id, tab)
);

create table if not exists app.world_rows (
    id         bigserial primary key,
    world_id   text not null,
    tab        text not null,
    position   bigint not null,
    -- each header's value: text, a number or a boolean; a blank row is {}
    cells      jsonb not null default '{}'::jsonb,
    made_at    timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    write_id   text not null default '',
    foreign key (world_id, tab) references app.world_tabs (world_id, tab) on delete cascade
);
create index if not exists world_rows_order on app.world_rows (world_id, tab, position, id);

-- every change a write made: 'world' (the registry row), 'tab' (made, or its header), 'create' / 'update' / 'delete'
-- (a row); `before` is what it replaced (null: nothing was there), so a void puts it back, newest first
create table if not exists app.world_changes (
    id        bigserial primary key,
    write_id  text not null,
    world_id  text not null,
    tab       text not null default '',
    row_id    bigint,
    kind      text not null check (kind in ('world', 'tab', 'create', 'update', 'delete')),
    before    jsonb,
    after     jsonb,
    by_email  text not null default '',
    at        timestamptz not null default now()
);
create index if not exists world_changes_write on app.world_changes (write_id);
create index if not exists world_changes_at on app.world_changes (world_id, at);

-- what the import copied: 'registry:<book>' once the registry is copied whole, and each world's workbook by its id
create table if not exists app.world_imports (
    source      text primary key,
    world_id    text not null default '',
    counts      jsonb not null default '{}'::jsonb,
    imported_at timestamptz not null default now(),
    write_id    text not null default ''
);

grant select on app.worlds, app.world_tabs, app.world_rows, app.world_changes, app.world_imports to asa_hub_app_ro;
reset role;
