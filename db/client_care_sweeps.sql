-- The clients' care sweeps' own state (app/client_care_sweeps.py), the Script Properties Apps Script kept them in: the
-- eMAR import's generation and cursor (Meds.gs MAR_IMPORT_GEN, MAR_IMPORT_CURSOR). The two values seeded are the ones
-- its last run left: generation 4 copied whole (its mar_import_complete line, the pass log's 2782 passes, rows 2-2783,
-- each one in mar_entries as emar_<row>), so the sweep is its guard. Applied by hand as the owner (POSTGRES_USER);
-- idempotent: a value already here is never overwritten.
set role asa_hub_app_rw;

create table if not exists app.client_care_sweeps (
    key         text primary key,
    value       text not null default '',
    updated_at  timestamptz not null default now()
);

insert into app.client_care_sweeps (key, value) values
    ('MAR_IMPORT_GEN', '4'),
    ('MAR_IMPORT_CURSOR', 'done')
on conflict (key) do nothing;

grant select on app.client_care_sweeps to asa_hub_app_ro;
