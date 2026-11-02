-- The sheet keeper's passes since its mirror left the old platform (2026-10-27): the keeper on asa-hub-worker
-- (server/hub_sheet_sync.py) now keeps only the calendars' grids (app.sheet_grids) and the house calendars' live copy
-- (app.asa_house_calendar_live), and stamps each pass here; asa-hub-worker's /vitals reads it for /health and the
-- Guardian. One row (id 1).
-- Applied by hand as the owner (POSTGRES_USER); idempotent. The keeper writes it as asa_hub_meds (its GRID_DSN);
-- the worker's vitals read it as asa_hub_app_rw (HUB_RELAY_DB_DSN).
set role asa_hub_app_rw;

create table if not exists app.sheet_keeper_state (
    id                int primary key default 1 check (id = 1),
    last_pass_at      timestamptz not null default now(),
    last_pass_grids   int not null default 0,
    last_pass_errors  int not null default 0,
    live_read_at      timestamptz
);

grant select, insert, update on app.sheet_keeper_state to asa_hub_meds;
grant select on app.sheet_keeper_state to asa_hub_app_ro;
reset role;
