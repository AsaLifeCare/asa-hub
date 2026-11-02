-- Compliance documents: each filed certificate's reading, made by the relay's lane (server/cert_reads.py) with
-- Tesseract and the decoder's own engine, never by Apps Script. Applied by hand as the owner; idempotent.
-- The lane writes as asa_hub_meds; asa-hub-app (asa_hub_app_ro) reads it and lays the verdict over the ledger row.
set role asa_hub_app_rw;

create table if not exists app.cert_reads (
    row_id       text primary key,
    file_id      text not null,
    state        text not null default 'pending' check (state in ('pending', 'read', 'failed')),
    reading      jsonb,
    error        text not null default '',
    attempts     integer not null default 0,
    next_try_at  timestamptz not null default now(),
    read_at      timestamptz,
    seconds      real,
    updated_at   timestamptz not null default now()
);
create index if not exists cert_reads_due on app.cert_reads (next_try_at) where state <> 'read';

grant select, insert, update on app.cert_reads to asa_hub_meds;
grant select on app.cert_reads to asa_hub_app_ro;
reset role;
