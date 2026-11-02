-- Client Finances (app/finance.py): the company's finance papers of the FIN_DRIVE_ROOT_ID folder kept on the server,
-- in the project's documents folder (documents/finance/docs/<drive id>/), one row per Drive file under its subfolder,
-- listed by finDocs from here. The ledger, the balances and the TrueLink runs live in app.resource_rows; a receipt is
-- kept in documents/finance/receipts/<transaction id>/.
-- Applied by hand as the owner (POSTGRES_USER); idempotent. asa-hub-app writes it (asa_hub_app_rw) and reads it
-- (asa_hub_app_ro).
set role asa_hub_app_rw;

create table if not exists app.finance_docs (
    drive_id         text primary key,
    subfolder        text not null default '',
    name             text not null default '',
    mime             text not null default '',
    size_bytes       bigint not null default 0,
    google_modified  text not null default '',
    link             text not null default '',
    path             text not null default '',
    why              text not null default '',
    kept_at          timestamptz not null default now(),
    write_id         text not null default ''
);

grant select on app.finance_docs to asa_hub_app_ro;
