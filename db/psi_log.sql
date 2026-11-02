-- PSI Log (app/psi_log.py): a person signs in to PsiAnywhere with their OWN PsiAnywhere account inside the Hub and
-- clocks in and out there. psi_log_events keeps every such step — who, which PsiAnywhere user, what was asked, what
-- PsiAnywhere answered, the entry it touched — never a password or a session token. psi_log_devices keeps the device
-- id PsiAnywhere hands back after a two-factor code, so the next sign-in from the Hub is not asked for a code again.
-- Applied by hand as the owner (POSTGRES_USER); idempotent. asa-hub-app writes it (asa_hub_app_rw) and reads it
-- (asa_hub_app_ro).
set role asa_hub_app_rw;

create table if not exists app.psi_log_events (
    id         bigserial primary key,
    at         timestamptz not null default now(),
    hub_uid    text not null default '',
    psi_user   text not null default '',
    action     text not null check (action in ('sign-in', 'code', 'sign-out', 'clock-in', 'clock-out', 'submit')),
    ok         boolean not null default false,
    word       text not null default '',
    entry_id   text not null default '',
    detail     jsonb not null default '{}'
);
create index if not exists psi_log_events_uid on app.psi_log_events (hub_uid, at desc);
create index if not exists psi_log_events_at on app.psi_log_events (at desc);

create table if not exists app.psi_log_devices (
    hub_uid     text not null,
    psi_user    text not null,
    device_guid text not null default '',
    updated_at  timestamptz not null default now(),
    primary key (hub_uid, psi_user)
);

grant select on app.psi_log_events to asa_hub_app_ro;
grant select on app.psi_log_devices to asa_hub_app_ro;
reset role;
