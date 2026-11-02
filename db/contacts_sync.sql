-- What the contacts sync's doors (app/contacts_sync.py, app/contacts_sync_writes.py; ContactsSync.gs) kept in Apps
-- Script's Script Properties: PEOPLE_SYNC_SOURCE_AT, the time of the platform list peopleSyncFromPlatform last took
-- whole, which usersContactMergePreview shows. A write the relay voids puts the value it replaced (prev) back, while
-- no later write has moved it. Applied by hand as the owner (POSTGRES_USER); idempotent. asa-hub-app writes it
-- (asa_hub_app_rw) and reads it (asa_hub_app_ro).
set role asa_hub_app_rw;

create table if not exists app.contacts_sync_state (
    key         text primary key,
    value       text not null default '',
    prev        text not null default '',
    write_id    text not null default '',
    updated_at  timestamptz not null default now()
);

grant select on app.contacts_sync_state to asa_hub_app_ro;
reset role;
