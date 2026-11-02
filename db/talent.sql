-- Recruitment's clock (app/talent_recruitment.py, app/talent_recruitment_writes.py): when the Dropbox Sign mirror was
-- last synced by itself (recruitment_sync) and the cadence an installed trigger asks for (recruitment_trigger, its
-- seconds in `said`), so the relay's clock syncs it daily, or sooner while a trigger is installed. The mirror's rows
-- themselves are the dissolved recruitment_contracts facts; a fetched PDF is kept in the project's documents folder
-- (documents/recruitment/<envelope>/).
-- Applied by hand as the owner (POSTGRES_USER); idempotent (the recruitment store makes the same table when it starts).
-- asa-hub-app writes it (asa_hub_app_rw) and reads it (asa_hub_app_ro).
set role asa_hub_app_rw;

create table if not exists app.talent_marks (
    name  text primary key,
    at    timestamptz not null default now(),
    said  text not null default ''
);

grant select on app.talent_marks to asa_hub_app_ro;
