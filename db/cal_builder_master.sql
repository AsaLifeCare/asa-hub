-- The Calendar Builder's master grid as its own record (app/cal_builder_master.py): the master book's New Calendar
-- tab cell by cell (A..AE as columns 0..30, rows 1..500) and its New Calendar Table row by row, seeded once from what
-- asa-hub-db held of them (app.sheet_grids kind master; the copy's Table tab). Every Builder door and slice reads and
-- writes these alone; the sheet is their copy both ways by recency (app.book_ops grid_cells and table_rows out, the
-- keeper's grid in). Applied by hand as the owner (POSTGRES_USER); idempotent.
set role asa_hub_app_rw;

create table if not exists app.cal_builder_master (
    sheet_row   integer not null check (sheet_row between 1 and 500),
    col         integer not null check (col between 0 and 30),
    text        text not null default '',
    updated_at  timestamptz not null default now(),
    updated_by  text not null default '',
    -- the last value the sheet and the record agreed on, and when
    synced      text not null default '',
    synced_at   timestamptz,
    primary key (sheet_row, col)
);

create table if not exists app.cal_builder_table (
    id          bigserial primary key,
    cells       jsonb not null,
    source      text not null check (source in ('seed', 'sheet', 'publish')),
    publish_id  bigint,
    -- on the sheet: a seeded or folded row always, a published one once carried
    synced      boolean not null default false,
    at          timestamptz not null default now()
);
create index if not exists cal_builder_table_owed on app.cal_builder_table (id) where not synced;

-- one row: when the record was seeded, and the keeper's grid and the copy's Table it last folded in
create table if not exists app.cal_builder_master_state (
    id                   integer primary key default 1 check (id = 1),
    seeded_at            timestamptz,
    seeded_from          timestamptz,
    table_seeded_at      timestamptz,
    folded_at            timestamptz,
    folded_read_at       timestamptz,
    folded_modified      timestamptz,
    table_folded_loaded  timestamptz,
    why                  text not null default ''
);

grant select on app.cal_builder_master, app.cal_builder_table, app.cal_builder_master_state to asa_hub_app_ro;

-- the Calendar Builder's queued copies (app/calendar_carry.py): a master cell by its place, the Table's rows, a house
-- tab's cells by name and day — the books they name never become record books (app/record_books.py enroll)
alter table app.book_ops drop constraint if exists book_ops_op_check;
alter table app.book_ops add constraint book_ops_op_check check (op in ('rename', 'move', 'mirror', 'cells', 'delete',
    'append', 'rows', 'grid_cells', 'table_rows', 'house_cells'));
reset role;
