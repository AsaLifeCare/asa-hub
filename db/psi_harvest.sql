-- PSI Log's collection (app/psi_harvest.py): every row PsiAnywhere answers about staff, clients, their places and
-- codes, one row per (kind, key) — the kind is the read (staff.active, clients.demographics…), item the employee or
-- consumer a per-item read was about. cells passed the platform's withholding rule (server/redaction.py) before they
-- were written: a secret is kept as its marker, never its value. Rows are refreshed by each run and never taken out;
-- seen_at says when PsiAnywhere last answered them. psi_harvest_runs keeps each run and what every kind answered.
-- Applied by hand as the owner (POSTGRES_USER); idempotent. asa-hub-app writes it (asa_hub_app_rw) and reads it
-- (asa_hub_app_ro).
set role asa_hub_app_rw;

create table if not exists app.psi_harvest_runs (
    id           bigserial primary key,
    started_at   timestamptz not null default now(),
    finished_at  timestamptz,
    asked_by     text not null default '',
    result       jsonb not null default '{}'
);
create index if not exists psi_harvest_runs_started on app.psi_harvest_runs (started_at desc);

create table if not exists app.psi_harvest (
    kind        text not null,
    key         text not null,
    item        text not null default '',
    cells       jsonb not null default '{}',
    first_seen  timestamptz not null default now(),
    seen_at     timestamptz not null default now(),
    run_id      bigint not null default 0,
    primary key (kind, key)
);
create index if not exists psi_harvest_item on app.psi_harvest (kind, item);

grant select on app.psi_harvest_runs to asa_hub_app_ro;
grant select on app.psi_harvest to asa_hub_app_ro;
reset role;
