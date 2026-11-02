-- IST Records' rows as the relay reads them (server/behavior_slices.py): the records in app.resource_rows once the IST
-- app is given to Python and uploaded (app/ist.py), nothing else of that table. Empty while the house's sheet holds them.
-- Applied by hand as the owner (POSTGRES_USER); idempotent. The relay reads it as asa_hub_meds (HUB_HOUSE_MEDS_DSN).
set role asa_hub_app_rw;

create or replace view app.ist_records_kept as
    select r.cells, r.position, r.created_at, r.row_key
      from app.resource_rows r
      join app.resource_columns c on c.resource = r.resource and c.uploaded_at is not null
     where r.resource = 'istRecords' and r.removed_at is null;

grant select on app.ist_records_kept to asa_hub_meds;
