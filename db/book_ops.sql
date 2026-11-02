-- What a kept edit cannot carry into a book (app/book_ops.py): a header named for a client, rows no key tells apart,
-- a row moved between two tabs. Queued by the write that decided it, carried to the sheet by asa-hub-sheet-sync
-- (app/sheet_sync.py, which also creates it). Applied by hand as the owner (POSTGRES_USER); idempotent.
set role asa_hub_app_rw;

create table if not exists app.book_ops (
    id          bigserial primary key,
    write_id    text not null,
    action      text not null,
    subject     text not null default '',
    sheet_id    text not null,
    tab_name    text not null,
    op          text not null check (op in ('rename', 'move')),
    spec        jsonb not null default '{}',
    author      text not null default '',
    state       text not null default 'pending'
                check (state in ('pending', 'applying', 'done', 'refused', 'failed', 'cancelled')),
    why         text not null default '',
    tries       int not null default 0,
    at          timestamptz not null default now(),
    claimed_at  timestamptz,
    done_at     timestamptz
);
create index if not exists book_ops_open on app.book_ops (id) where state in ('pending', 'applying');
create index if not exists book_ops_subject on app.book_ops (subject, id desc);

grant select on app.book_ops to asa_hub_app_ro;

-- Smart Comms' Desk save of an id the situations tab holds on identical rows (app/smart_comms_writes.py): the cells
-- written on the last of them, as Apps Script's save did, by the op `cells`.
alter table app.book_ops drop constraint if exists book_ops_op_check;
alter table app.book_ops add constraint book_ops_op_check check (op in ('rename', 'move', 'mirror', 'cells', 'delete', 'append', 'rows', 'grid_cells', 'table_rows', 'house_cells'));
