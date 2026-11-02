-- The company's own phone lines as the provider lists them (GET /v1/phone-numbers): each line's name, number, the
-- people assigned to it and where it forwards. Kept by asa-hub-app's clock (app/company_lines.py) and read by the
-- Hotline, the Line Directory, the call reading, Smart Comms' When and the SMS contacts.
-- Applied by hand as the owner (POSTGRES_USER); idempotent. asa-hub-app writes it (asa_hub_app_rw) and reads it
-- (asa_hub_app_ro).
set role asa_hub_app_rw;

create table if not exists app.asa_openphone_lines (
    id                text primary key,
    name              text,
    number            text not null,
    formatted_number  text,
    assigned_users    jsonb not null default '[]',
    forward_to        text,
    synced_at         timestamptz not null default now()
);

grant select on app.asa_openphone_lines to asa_hub_app_ro;
reset role;
