-- The window ask's own state (app/comm_window_ask.py, app/comm_window_ask_writes.py), the Script Property
-- CommWindowAsk.gs kept it in: comm_window_ask_last_run, the nine-minute window's stamp (milliseconds), written before
-- the work. A write the relay voids puts the value it replaced (prev) back. Nothing is seeded: an empty table is a
-- sweep never stamped, due at once. Applied by hand as the owner (POSTGRES_USER); idempotent. asa-hub-app writes it
-- (asa_hub_app_rw) and reads it (asa_hub_app_ro).
set role asa_hub_app_rw;

create table if not exists app.comm_window_ask_state (
    key         text primary key,
    value       text not null default '',
    prev        text not null default '',
    write_id    text not null default '',
    updated_at  timestamptz not null default now()
);

grant select on app.comm_window_ask_state to asa_hub_app_ro;
reset role;
