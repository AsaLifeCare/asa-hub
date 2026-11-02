-- The beats of asa-hub-app's clocks a screen reads back, kept in the Hub's own database (app/hotline_fast.py: the
-- hotline desk's sweep clock, `hub.hotline_sweep`), in the shape of the old platform's asa_loop_cadence, which the
-- platform's watchdog reads and asa-hub-app's read-only role does not. Applied by hand as the owner (POSTGRES_USER);
-- idempotent. asa-hub-app writes it (asa_hub_app_rw) and reads it (asa_hub_app_ro).
set role asa_hub_app_rw;

create table if not exists app.loop_cadence (
    loop_name            text primary key,
    expected_interval_s  integer not null,
    last_run_at          timestamptz not null,
    status               text not null default 'ok',
    source               text not null default 'asa-hub-app',
    detail               jsonb not null default '{}'::jsonb,
    updated_at           timestamptz not null default now()
);

grant select on app.loop_cadence to asa_hub_app_ro;
reset role;
