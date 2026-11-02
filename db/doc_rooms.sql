-- What was stored in or trashed from a Drive reading room (app/doc_rooms.py) — the Audit Library's and the other
-- rooms' — after the relay carried it out in Drive as the platform's own account. A write the relay voids takes its row
-- back (write_id).
-- Applied by hand as the owner (POSTGRES_USER); idempotent. asa-hub-app writes it (asa_hub_app_rw) and reads it
-- (asa_hub_app_ro).
set role asa_hub_app_rw;

create table if not exists app.doc_room_events (
    id         bigserial primary key,
    room       text not null,
    action     text not null,
    file_id    text not null,
    name       text not null default '',
    mime_type  text not null default '',
    size_bytes bigint not null default 0,
    by_email   text not null default '',
    at         timestamptz not null default now(),
    write_id   text not null default ''
);
create index if not exists doc_room_events_room on app.doc_room_events (room, at desc);

grant select on app.doc_room_events to asa_hub_app_ro;
