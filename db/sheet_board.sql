-- The Task Board Sheet's spreadsheets (app/sheet_board.py): each card's sheet kept in Postgres, one row per tab — its
-- cells as a grid of text (the header first), never a Google file.
-- Applied by hand as the owner (POSTGRES_USER); idempotent. asa-hub-app writes it (asa_hub_app_rw) and reads it
-- (asa_hub_app_ro).
set role asa_hub_app_rw;

create table if not exists app.sheet_board_tabs (
    sheet_key   text not null,
    card_id     text not null,
    owner       text not null,
    tab         text not null,
    position    integer not null default 0,
    cells       jsonb not null default '[]',
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now(),
    write_id    text not null default '',
    primary key (sheet_key, tab)
);
create index if not exists sheet_board_tabs_card on app.sheet_board_tabs (card_id);

-- each tab as it stood before a write changed it (null: the tab was made by it), so a void takes the write back
create table if not exists app.sheet_board_changes (
    id         bigserial primary key,
    write_id   text not null,
    sheet_key  text not null,
    tab        text not null,
    before     jsonb,
    at         timestamptz not null default now()
);
create index if not exists sheet_board_changes_write on app.sheet_board_changes (write_id);

grant select on app.sheet_board_tabs, app.sheet_board_changes to asa_hub_app_ro;
