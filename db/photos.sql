-- People's photos: every picture uploaded on a person's page in Clients, Staff, SSA, Families, Staff Candidates or
-- Client Candidates (app/photos.py). The picture itself is on the platform's server (server/person_photos.py); this
-- names it. Never updated, never deleted: the newest row per record is the photo every read of that app draws.
-- Applied by hand as the owner (POSTGRES_USER); idempotent. asa-hub-app writes it (asa_hub_app_rw) and reads it
-- (asa_hub_app_ro).
set role asa_hub_app_rw;

create table if not exists app.photos (
    id             bigserial primary key,
    app            text not null check (app in ('clients', 'staff', 'ssa', 'family', 'candidates', 'client-candidates')),
    record_key     text not null check (record_key ~ '^[A-Za-z0-9_][A-Za-z0-9_.\-]{0,119}$' and record_key !~ '\.\.'),
    path           text not null check (path ~ '^/hub-lanes/photos/[a-z\-]+/[A-Za-z0-9_.\-]+/\d{8}T\d{9}Z\.(jpg|png|webp)$'),
    mime_type      text not null default '',
    size_bytes     integer not null default 0,
    added_by       text not null,
    added_by_name  text not null default '',
    edition        text not null default '',
    added_at       timestamptz not null default now()
);
create index if not exists photos_record on app.photos (app, record_key, id desc);

grant select on app.photos to asa_hub_app_ro;
reset role;
