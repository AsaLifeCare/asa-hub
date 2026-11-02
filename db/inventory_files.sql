-- The Inventory's supply documents entered by hand, their files kept on the server (app/inventory_writes.py
-- inventorySupplyAdd): one row per file under documents/inventory/supplies/<category>, never filed in Drive; the
-- entry's link names it (hubfile:inventory/<id>) and admins and managers open it through inventorySupplyFile
-- (app/inventory.py).
-- Applied by hand as the owner (POSTGRES_USER); idempotent.
set role asa_hub_app_rw;

create table if not exists app.inventory_files (
    id          text primary key,
    name        text not null,
    mime        text not null default '',
    size_bytes  bigint not null default 0,
    path        text not null,
    category    text not null default '',
    by_email    text not null,
    write_id    text not null default '',
    created_at  timestamptz not null default now()
);

grant select on app.inventory_files to asa_hub_app_ro;
