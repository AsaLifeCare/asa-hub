-- The plans whose sections the intake's clock could not file (app/isp_intake.py, ClientProfiles.gs
-- ISP_SECTIONS_TRIES): how many tries, when the next one is due (epoch ms) and the last refusal's status. A filed plan's
-- row is taken out. Applied by hand as the owner (POSTGRES_USER); idempotent.
set role asa_hub_app_rw;

create table if not exists app.isp_section_tries (
    client_key  text primary key,
    n           integer not null default 0,
    next_ms     bigint not null default 0,
    status      integer not null default 0,
    updated_at  timestamptz not null default now()
);

grant select on app.isp_section_tries to asa_hub_app_ro;
