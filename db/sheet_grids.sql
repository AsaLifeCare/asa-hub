-- Scheduling's seed: the house calendars' grids (the Dashboard index's links, each house book's CALENDAR as shown —
-- text, real dates, backgrounds), and the Calendar Builder's master grid (its New Calendar tab, `master`), kept by the
-- relay's sheet keeper (server/hub_sheet_sync.py keep_grids).
-- Applied by hand as the owner (POSTGRES_USER); idempotent. The keeper writes as asa_hub_meds (HUB_HOUSE_MEDS_DSN);
-- asa-hub-app reads it.
set role asa_hub_app_rw;

create table if not exists app.sheet_grids (
    sheet_id       text not null,
    tab_name       text not null,
    kind           text not null check (kind in ('calendar', 'links', 'master')),
    cells          jsonb not null,
    modified_time  timestamptz,
    read_at        timestamptz not null default now(),
    primary key (sheet_id, tab_name)
);
alter table app.sheet_grids drop constraint if exists sheet_grids_kind_check;
alter table app.sheet_grids add constraint sheet_grids_kind_check check (kind in ('calendar', 'links', 'master'));

grant select, insert, update, delete on app.sheet_grids to asa_hub_meds;
grant select on app.sheet_grids to asa_hub_app_ro;
reset role;
