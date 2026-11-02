-- The comms repair pass's own state (app/comm_repair.py), the Script Properties CommRepair.gs kept it in: the people
-- still owed a correction (comm_repair_owed, commRepairStamp_) and the moment a pending continuation fires
-- (comm_repair_wake_at, milliseconds; the relay's look fires it in place of Apps Script's one-shot trigger). Nothing is
-- seeded: the house holds no incident, so nobody is owed and nothing is pending.
-- Applied by hand as the owner (POSTGRES_USER); idempotent. asa-hub-app writes it (asa_hub_app_rw) and reads it
-- (asa_hub_app_ro).
set role asa_hub_app_rw;

create table if not exists app.comm_repair_state (
    key         text primary key,
    value       text not null default '',
    updated_at  timestamptz not null default now()
);

grant select on app.comm_repair_state to asa_hub_app_ro;
