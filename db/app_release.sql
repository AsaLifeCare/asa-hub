-- An app's release announcement on Python (app/app_release.py): who was told about which app, the badges each app
-- opened as last seen (what a save adds to), the announcements owed for later (the morning list, kept here), and when
-- each app's announcement reached everybody it could.
-- Applied by hand as the owner (POSTGRES_USER); idempotent. asa-hub-app writes it (asa_hub_app_rw) and reads it
-- (asa_hub_app_ro).
set role asa_hub_app_rw;

create table if not exists app.app_release_told (
    id       bigserial primary key,
    app_id   text not null,
    title    text not null default '',
    user_id  text not null default '',
    email    text not null default '',
    mode     text not null default '',
    sent     boolean not null default false,
    at       timestamptz not null default now()
);
create index if not exists app_release_told_app on app.app_release_told (app_id, user_id);

create table if not exists app.app_release_access (
    app_id  text primary key,
    badges  text not null default '',
    at      timestamptz not null default now()
);

create table if not exists app.app_release_pending (
    app_id   text primary key,
    badges   text not null default '',
    name     text not null default '',
    tagline  text not null default '',
    whole    boolean not null default false,
    since    timestamptz not null default now()
);

create table if not exists app.app_release_stamp (
    app_id  text primary key,
    at      timestamptz not null default now()
);

grant select on app.app_release_told, app.app_release_access, app.app_release_pending, app.app_release_stamp
    to asa_hub_app_ro;
