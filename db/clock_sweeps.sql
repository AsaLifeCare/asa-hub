-- What the hiring sweep's clock riders kept in Apps Script's script cache, for the Python passes that took them
-- (app/clock_sweeps.py): lane_mirror_ran (LaneMirror.gs, 600 s), dup_scan_ran (DuplicateScan.gs, 3600 s) and
-- calloff_form_ran (CommCallOffForm.gs, 600 s), each held until expires_at. A write the relay voids puts the value it
-- replaced (prev) back, while no later write has moved it. Applied by hand as the owner (POSTGRES_USER); idempotent.
set role asa_hub_app_rw;

create table if not exists app.clock_sweeps_state (
    key         text primary key,
    value       text not null default '',
    expires_at  timestamptz,
    prev        text not null default '',
    prev_expires_at timestamptz,
    write_id    text not null default '',
    updated_at  timestamptz not null default now()
);

grant select on app.clock_sweeps_state to asa_hub_app_ro;

-- The lane mirrors' rewrite of a house (app/lane_mirror.py) is a book op asa-hub-sheet-sync carries (app/book_ops.py
-- OPS): app.book_ops takes the op `mirror` beside `rename` and `move`.
alter table app.book_ops drop constraint if exists book_ops_op_check;
alter table app.book_ops add constraint book_ops_op_check check (op in ('rename', 'move', 'mirror', 'cells', 'delete', 'append', 'rows'));
