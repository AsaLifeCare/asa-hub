-- The rows of the generic resources the Hub's own apps run in Postgres (app/resource_rows.py): the Kanban's teamTasks
-- and projectWorkItems, the Overview's activity, the Widgets' widgets, the Image Bank's photos. Each was uploaded whole
-- from its sheet's copy, and from then on Postgres is the record: the apps read and write here alone, and any sync with
-- the sheets follows what these tables hold. A row is kept as its sheet held it (each header's cell text); a removal
-- marks it, never forgets it, so no later upload brings it back.
-- Applied by hand as the owner (POSTGRES_USER); idempotent. asa-hub-app writes them (asa_hub_app_rw) and reads them
-- (asa_hub_app_ro).
set role asa_hub_app_rw;

-- each resource's columns, in the sheet's order, and the ones written here after it
create table if not exists app.resource_columns (
    resource    text primary key,
    columns     jsonb not null default '[]'::jsonb,
    sheet_id    text not null default '',
    tab_name    text not null default '',
    uploaded_at timestamptz,
    updated_at  timestamptz not null default now()
);

create table if not exists app.resource_rows (
    resource    text not null,
    row_key     text not null,
    row_id      text not null default '',
    position    bigint not null,
    cells       jsonb not null default '{}'::jsonb,
    -- 'sheet': uploaded and never written here; 'postgres': made or changed here, and the sheet never wins it back
    origin      text not null default 'sheet' check (origin in ('sheet', 'postgres')),
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now(),
    removed_at  timestamptz,
    removed_by  text not null default '',
    write_id    text not null default '',
    primary key (resource, row_key)
);
create index if not exists resource_rows_order on app.resource_rows (resource, position, created_at);
create index if not exists resource_rows_id on app.resource_rows (resource, row_id);

-- every write made here, with the row before and after: a void takes it back, a sync reads what Postgres changed
create table if not exists app.resource_changes (
    id          bigserial primary key,
    write_id    text not null,
    resource    text not null,
    row_key     text not null,
    kind        text not null check (kind in ('create', 'update', 'delete')),
    before      jsonb,
    after       jsonb,
    by_email    text not null default '',
    at          timestamptz not null default now()
);
create index if not exists resource_changes_write on app.resource_changes (write_id);
create index if not exists resource_changes_at on app.resource_changes (resource, at);

grant select on app.resource_columns, app.resource_rows, app.resource_changes to asa_hub_app_ro;
reset role;
