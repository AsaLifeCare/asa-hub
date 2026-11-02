-- The hiring team's alerts Python raises in place of Apps Script's (app/team_alerts.py): each told once, by its key,
-- and the moment from which they are Python's (only what happened after it is told).
-- Applied by hand as the owner (POSTGRES_USER); idempotent. asa-hub-app writes it (asa_hub_app_rw) and reads it
-- (asa_hub_app_ro).
set role asa_hub_app_rw;

create table if not exists app.team_alerts_told (
    key      text primary key,
    kind     text not null,
    ref      text not null default '',
    state    text not null default '',
    why      text not null default '',
    told_at  timestamptz not null default now()
);
create index if not exists team_alerts_told_kind on app.team_alerts_told (kind, told_at desc);

create table if not exists app.team_alerts_state (
    id     smallint primary key default 1 check (id = 1),
    since  timestamptz not null,
    build  text not null default '',
    at     timestamptz not null default now()
);

grant select on app.team_alerts_told, app.team_alerts_state to asa_hub_app_ro;
