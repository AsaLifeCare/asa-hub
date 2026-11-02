-- The PsiAnywhere collector's own records (app/psi_store.py), JSON files on the app's disk until 2026-10-27: the
-- staff-hours history (psi-entries: current.json and each day's rounds) and the full punches' live reads, feed and
-- clients present (psi-full: live.json, feed.json, consumers.json). One row per file, named by the path it had;
-- carried_from says which file a row was taken in from, once. Client data rides psi-full's rows, as it rode the 0600
-- files: no reader role is granted it.
-- Applied by hand as the owner (POSTGRES_USER); idempotent. asa-hub-app reads and writes it (asa_hub_app_rw).
set role asa_hub_app_rw;

create table if not exists app.psi_store (
    name          text primary key,
    body          jsonb not null default '{}',
    updated_at    timestamptz not null default now(),
    carried_from  text not null default ''
);

reset role;
