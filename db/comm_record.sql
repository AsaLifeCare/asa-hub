-- The comms obligations sweep's own state (app/comm_record.py, app/comm_record_writes.py), the Script Properties
-- CommRecord.gs kept it in: comm_record_last_run, the six-hour window's stamp (milliseconds; '' lifts it, as
-- deleteProperty did), and comm_record_cursor, where a paused sweep resumes. A write the relay voids puts the value it
-- replaced (prev) back. Nothing is seeded: an empty table is a sweep never stamped, due at once from the first thread.
-- Applied by hand as the owner (POSTGRES_USER); idempotent.
set role asa_hub_app_rw;

create table if not exists app.comm_record_state (
    key         text primary key,
    value       text not null default '',
    prev        text not null default '',
    write_id    text not null default '',
    updated_at  timestamptz not null default now()
);

grant select on app.comm_record_state to asa_hub_app_ro;
