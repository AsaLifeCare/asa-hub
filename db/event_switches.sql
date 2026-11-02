-- Settings › Events (app/event_switches.py): each signal a write or a clock raises beside its answer, on or off, keyed
-- kind:name ("wake:notices", "ring:*"). No signal is ever deleted from the list; one with no row here is on. The ones
-- the relay alone listened to are retired in the code and never read from here.
-- asa-hub-app reads and writes it on the writer role's shared connection.
-- Applied by hand as the owner (POSTGRES_USER); idempotent: a switch already set is never reset.
set role asa_hub_app_rw;

create table if not exists app.event_switches (
    event_key  text primary key check (event_key ~ '^[a-z_]+:'),
    enabled    boolean not null default true,
    set_by     text not null default '',
    set_at     timestamptz not null default now()
);

grant select on app.event_switches to asa_hub_app_ro;
reset role;
