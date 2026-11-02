-- Time Off's records as the relay reads them (server/time_off.py): the requests and the house's settings in
-- app.resource_rows once Time Off is given to Python and uploaded (app/time_off_rows.py), nothing else of that table;
-- app.time_off_held says whether both are held (two rows) or the house still holds them.
-- Applied by hand as the owner (POSTGRES_USER); idempotent. The relay reads it as asa_hub_meds (HUB_HOUSE_MEDS_DSN).
set role asa_hub_app_rw;

create or replace view app.time_off_kept as
    select r.resource, r.cells, r.position, r.created_at, r.row_key
      from app.resource_rows r
      join app.resource_columns c on c.resource = r.resource and c.uploaded_at is not null
     where r.resource in ('timeOff', 'timeOffSettings') and r.removed_at is null;

create or replace view app.time_off_held as
    select resource, uploaded_at
      from app.resource_columns
     where resource in ('timeOff', 'timeOffSettings') and uploaded_at is not null;

grant select on app.time_off_kept, app.time_off_held to asa_hub_meds;
