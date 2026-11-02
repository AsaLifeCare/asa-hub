-- Settings › Routes (app/route_switches.py): each HTTP route asa-hub-app answers or carries to the relay, on or off,
-- keyed METHOD + path template ("POST /shift/of"). No route is ever deleted from the list; one with no row here is on,
-- but for the three seeded off below. asa-hub-app reads and writes it on the writer role's shared connection.
-- Applied by hand as the owner (POSTGRES_USER); idempotent: a switch already set is never reset.
set role asa_hub_app_rw;

create table if not exists app.route_switches (
    route_key  text primary key check (route_key ~ '^[A-Z]+ /'),
    enabled    boolean not null default true,
    set_by     text not null default '',
    set_at     timestamptz not null default now()
);

-- no caller left: kept, and off until the master turns them on
insert into app.route_switches (route_key, enabled, set_by) values
    ('POST /media-probe', false, 'default'),
    ('POST /shift/of', false, 'default'),
    ('POST /smart-comms/rpc', false, 'default')
on conflict (route_key) do nothing;

grant select on app.route_switches to asa_hub_app_ro;
reset role;
