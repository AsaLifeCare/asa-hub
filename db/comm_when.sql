-- The window feed's own stamps (app/comm_when_writes.py), the Script Properties CommWhen.gs commWhenIngest kept them
-- in: COMM_WHEN_FEED_AT, the relay's stamp of the sweep a pass belonged to (when the calendar was read), and
-- COMM_WHEN_FEED_ROWS, how many rows the comm_when house held after it. A convenience beside the rows, which are the
-- answer (app.resource_rows, `commWhenHouse`). Applied by hand as the owner (POSTGRES_USER); idempotent. asa-hub-app
-- writes it (asa_hub_app_rw) and reads it (asa_hub_app_ro).
set role asa_hub_app_rw;

create table if not exists app.comm_when_state (
    key         text primary key,
    value       text not null default '',
    updated_at  timestamptz not null default now()
);

grant select on app.comm_when_state to asa_hub_app_ro;
reset role;
