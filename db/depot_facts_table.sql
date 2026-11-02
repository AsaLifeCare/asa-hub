-- The depot's Facts (the Essencial book's Facts tab, 95k rows: the props, the switchboard, the house pointers, the
-- dissolved hiring tabs, the config) in a table of its own (app/resource_rows.py OWN_TABLES: depotFacts →
-- app.depot_facts). It has app.resource_rows' shape, so the generic resources' readers and writers serve it, and the
-- indexes its readers' statements need (hubdb.HubDb.from_sql shapes it as the copy's table): a fact by its subject
-- (writes.into_tables lays a `cols:Subject ID|Source|Evidence` append there by the trimmed subject), by its source
-- (equal, or a prefix), by its evidence.
-- Applied by hand as the owner; idempotent. asa-hub-app writes it (asa_hub_app_rw) and reads it (asa_hub_app_ro).
set role asa_hub_app_rw;

create table if not exists app.depot_facts (like app.resource_rows including all);

create index if not exists depot_facts_subject_trim on app.depot_facts
    (resource, btrim(coalesce(cells->>'Subject ID', ''), E' \t\n\r\f'));
create index if not exists depot_facts_subject on app.depot_facts (resource, (cells->>'Subject ID'));
create index if not exists depot_facts_source on app.depot_facts (resource, (cells->>'Source') text_pattern_ops);
create index if not exists depot_facts_evidence on app.depot_facts (resource, (cells->>'Evidence'));

grant select on app.depot_facts to asa_hub_app_ro;
reset role;
