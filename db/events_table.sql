-- The events trail (the house `events`, 300k rows and growing) in a table of its own (app/resource_rows.py OWN_TABLES:
-- eventTrail → app.trail_events). It has app.resource_rows' shape, so the generic resources' readers and writers serve
-- it, and the indexes its own lookups need: a row by its event id (writes.into_tables lays a `cols:event_id` append
-- there by equality on the trimmed cell), by its id (the onboarding calendar's note), and a subject's newest rows
-- (a staff profile's activity).
-- Applied by hand as the owner; idempotent. asa-hub-app writes it (asa_hub_app_rw) and reads it (asa_hub_app_ro).
set role asa_hub_app_rw;

create table if not exists app.trail_events (like app.resource_rows including all);

create index if not exists trail_events_event on app.trail_events
    (resource, btrim(coalesce(cells->>'event_id', ''), E' \t\n\r\f'));
create index if not exists trail_events_id on app.trail_events
    (resource, btrim(coalesce(cells->>'id', ''), E' \t\n\r\f'));
create index if not exists trail_events_subject on app.trail_events (resource, (cells->>'subject_key'), position);

grant select on app.trail_events to asa_hub_app_ro;
reset role;
