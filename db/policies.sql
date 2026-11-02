-- The Policies app (app/policies.py): each original document of the policies folder kept on the server, in the
-- project's documents folder (documents/policies/<drive id>/), so the screen hands the original over from the platform.
-- The sections and the read receipts live in app.resource_rows (policies, contactLists, policyAcks).
-- Applied by hand as the owner (POSTGRES_USER); idempotent. asa-hub-app writes it (asa_hub_app_rw) and reads it
-- (asa_hub_app_ro).
set role asa_hub_app_rw;

create table if not exists app.policy_files (
    doc_id       text primary key,
    drive_id     text not null default '',
    title        text not null default '',
    name         text not null default '',
    mime         text not null default '',
    size_bytes   bigint not null default 0,
    path         text not null default '',
    modified     text not null default '',
    kept_at      timestamptz not null default now(),
    write_id     text not null default ''
);

grant select on app.policy_files to asa_hub_app_ro;
