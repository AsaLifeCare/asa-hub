-- Time Reconciliation (app/recon.py, app/recon_writes.py): the daily auto run's mark — when reconAutoRecord last kept
-- what reconAutoSweep prepared, and what it said — so the relay's clock runs it once in 20 hours. The punches, the runs
-- and the errors live in app.resource_rows (timePunches, reconRuns, reconErrors); an uploaded report is kept in the
-- project's documents folder (documents/recon/reports/<id>/).
-- Applied by hand as the owner (POSTGRES_USER); idempotent (the recon store makes the same table when it starts).
-- asa-hub-app writes it (asa_hub_app_rw) and reads it (asa_hub_app_ro).
set role asa_hub_app_rw;

create table if not exists app.recon_auto (
    id      smallint primary key default 1 check (id = 1),
    ran_at  timestamptz not null default now(),
    said    text not null default ''
);

grant select on app.recon_auto to asa_hub_app_ro;
