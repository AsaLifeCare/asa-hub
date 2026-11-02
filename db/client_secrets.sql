-- A client's SSN, TL debit card number, DC expiry date, DC security code and DC PIN as the Hub saves them
-- (app/client_secrets.py): every save a
-- row, the whole value sealed to the platform's public key (RSA-OAEP, app/client_secrets.pub) so the app that writes it
-- can never open it again — the private key stays off every container — and its last four kept beside it for the mask.
-- The same value goes to the client's row of the Asa Client Database Master as it is saved. Never shown in the Hub.
-- Applied by hand as the owner (POSTGRES_USER); idempotent. asa-hub-app writes it (asa_hub_app_rw); the read role
-- reads the masks alone, never the sealed column.
set role asa_hub_app_rw;

create table if not exists app.client_secrets (
    id              bigserial primary key,
    client_key      text not null,
    field           text not null,
    sealed          bytea not null,
    last4           text not null default '',
    by_email        text not null default '',
    at              timestamptz not null default now(),
    -- the client's Master row: written as it was saved, or why not
    sheet_written   boolean not null default false,
    sheet_why       text not null default '',
    write_id        text not null default ''
);
create index if not exists client_secrets_latest on app.client_secrets (client_key, field, at desc);
-- the fields a save names (the first cut held the SSN, the card and the expiry alone)
alter table app.client_secrets drop constraint if exists client_secrets_field_check;
alter table app.client_secrets add constraint client_secrets_field_check
    check (field in ('ssn', 'tl_card', 'dc_exp', 'dc_security_code', 'dc_pin'));

grant select (id, client_key, field, last4, at) on app.client_secrets to asa_hub_app_ro;
reset role;
