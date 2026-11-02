-- The phone-call lane's own state (app/comm_calls_writes.py), the Script Properties Apps Script kept it in: when the
-- feed last handed calls over and how many rows the calls house held then (CommCalls.gs COMM_CALLS_FEED_AT,
-- COMM_CALLS_FEED_ROWS). Nothing is seeded: the next hand-over writes both. Applied by hand as the owner
-- (POSTGRES_USER); idempotent. Until it is applied the ingest keeps its rows and leaves the stamp unwritten.
set role asa_hub_app_rw;

create table if not exists app.comm_calls_state (
    key         text primary key,
    value       text not null default '',
    updated_at  timestamptz not null default now()
);

grant select on app.comm_calls_state to asa_hub_app_ro;
