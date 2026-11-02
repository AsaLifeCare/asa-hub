-- The letters Python writes in place of Apps Script's sweeps and its public form door (app/letters.py): each one told
-- once, by its key, and the moment from which they are Python's (only what was filed after it is told).
-- Applied by hand as the owner (POSTGRES_USER); idempotent. asa-hub-app writes it (asa_hub_app_rw) and reads it
-- (asa_hub_app_ro).
set role asa_hub_app_rw;

create table if not exists app.letters_told (
    key        text primary key,
    lane       text not null,
    ref        text not null default '',
    situation  text not null default '',
    state      text not null default '',
    why        text not null default '',
    told_at    timestamptz not null default now()
);
create index if not exists letters_told_lane on app.letters_told (lane, told_at desc);

create table if not exists app.letters_state (
    id     smallint primary key default 1 check (id = 1),
    since  timestamptz not null,
    build  text not null default '',
    at     timestamptz not null default now()
);

grant select on app.letters_told, app.letters_state to asa_hub_app_ro;
