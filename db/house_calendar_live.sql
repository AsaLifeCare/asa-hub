-- The house calendars' live copy: the live workbook (one tab per house), each house tab's staff × day grid with every
-- cell's text and background, kept by the sheet keeper (server/hub_sheet_sync.py keep_live) and read by Scheduling,
-- Calendar Builder, My Work, My Calendar and Time Reconciliation. grid is {cols, rows, staff, total_shifts};
-- updated_at is when the keeper last read the house.
-- Applied by hand as the owner (POSTGRES_USER); idempotent. The keeper writes as asa_hub_meds (HUB_HOUSE_MEDS_DSN);
-- asa-hub-app reads it.
set role asa_hub_app_rw;

create table if not exists app.asa_house_calendar_live (
    location    text primary key,
    gid         bigint,
    grid        jsonb not null,
    updated_at  timestamptz not null default now()
);

grant select, insert, update, delete on app.asa_house_calendar_live to asa_hub_meds;
grant select on app.asa_house_calendar_live to asa_hub_app_ro;
reset role;
