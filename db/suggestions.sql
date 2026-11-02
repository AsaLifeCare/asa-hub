-- Suggestions: what a person says through the Suggestions app (app/suggestions_writes.py), kept in the Hub's database
-- alone — no sheet holds a new one. Any row the entity_suggestions tab ever holds is listed beside these. A write the
-- relay voids takes its suggestion back (write_id).
-- Applied by hand as the owner (POSTGRES_USER); idempotent. asa-hub-app writes it (asa_hub_app_rw) and reads it
-- (asa_hub_app_ro).
set role asa_hub_app_rw;

create table if not exists app.suggestions (
    suggestion_id  text primary key check (suggestion_id ~ '^SUG_[0-9A-F]{10}$'),
    created_at     timestamptz not null default now(),
    by_email       text not null default '',
    by_name        text not null default '',
    role           text not null default '',
    text           text not null check (length(text) between 3 and 4000),
    write_id       text not null default ''
);
create index if not exists suggestions_when on app.suggestions (created_at desc);

grant select on app.suggestions to asa_hub_app_ro;
reset role;
