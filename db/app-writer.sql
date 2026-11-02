-- asa-hub-app's writer role: its own schema "app" (the writes Python decided and their receipts), nothing else.
-- Applied once by hand as the owner (POSTGRES_USER); idempotent. The password is set apart and never written here.
-- The read-only role (asa_hub_app_ro) is left as it is: read-only on catalog.* and sheets.*, nothing on app.*.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'asa_hub_app_rw') then
    create role asa_hub_app_rw login nosuperuser nocreatedb nocreaterole noinherit;
  end if;
  execute format('grant connect on database %I to asa_hub_app_rw', current_database());
end
$$;

create schema if not exists app authorization asa_hub_app_rw;
alter schema app owner to asa_hub_app_rw;
-- app/ makes its tables in it at start (app/writes.py DDL); the copy's schemas stay out of its reach
revoke all on schema catalog, sheets from asa_hub_app_rw;
