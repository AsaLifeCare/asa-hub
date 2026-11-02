-- Smart Comms' test-mode record of what would have been sent (app/comm_logs.py): the mock outbox (comm_mock) and the
-- rehearsal book (comm_rehearsal), each row by its id, its cells as the outbox's header names them. Postgres is their
-- only record: they are never backed up to a sheet. One sequence numbers both, so "the rows kept since N" is one
-- query over app.comm_test_rows. Applied by hand as the owner (POSTGRES_USER); idempotent. asa-hub-app writes them
-- (asa_hub_app_rw) and reads them (asa_hub_app_ro).
set role asa_hub_app_rw;

create sequence if not exists app.comm_test_seq;

create table if not exists app.comm_mock (
    seq         bigint not null default nextval('app.comm_test_seq'),
    id          text primary key,
    cells       jsonb not null default '{}'::jsonb,
    -- the write that first kept the row ('' for a row the sheet held before)
    write_id    text not null default '',
    door        text not null default '',
    origin      text not null default 'postgres' check (origin in ('postgres', 'sheet')),
    kept_at     timestamptz not null default now(),
    changed_at  timestamptz,
    changed_by  text not null default ''
);
create unique index if not exists comm_mock_seq on app.comm_mock (seq);
create index if not exists comm_mock_write on app.comm_mock (write_id);
create index if not exists comm_mock_ledger on app.comm_mock ((cells ->> 'ledger_key') text_pattern_ops);

create table if not exists app.comm_rehearsal (
    seq         bigint not null default nextval('app.comm_test_seq'),
    id          text primary key,
    cells       jsonb not null default '{}'::jsonb,
    write_id    text not null default '',
    door        text not null default '',
    origin      text not null default 'postgres' check (origin in ('postgres', 'sheet')),
    kept_at     timestamptz not null default now(),
    changed_at  timestamptz,
    changed_by  text not null default ''
);
create unique index if not exists comm_rehearsal_seq on app.comm_rehearsal (seq);
create index if not exists comm_rehearsal_write on app.comm_rehearsal (write_id);

-- both logs in the order they were kept: `select * from app.comm_test_rows where seq > N order by seq`
create or replace view app.comm_test_rows as
    select 'comm_mock'::text as tab_name, seq, id, write_id, door, origin, kept_at, changed_at, cells
      from app.comm_mock
    union all
    select 'comm_rehearsal'::text, seq, id, write_id, door, origin, kept_at, changed_at, cells
      from app.comm_rehearsal;

grant select on app.comm_mock, app.comm_rehearsal, app.comm_test_rows to asa_hub_app_ro;
reset role;
