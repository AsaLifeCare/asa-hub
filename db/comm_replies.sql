-- What the mailbox ear (app/comm_replies.py, app/comm_replies_writes.py; CommInbound.gs commRepliesSweep) kept in
-- Apps Script's Script Properties: comm_mail_last_run, the fifteen-minute window of the mailbox pass, and
-- comm_close_last_run, the six-hour window of the close — each the epoch milliseconds of the pass that stamped it,
-- before its work. A write the relay voids puts the value it replaced (prev) back, while no later write has moved it.
-- Nothing is seeded: the first pass on Python finds both windows open, reads the mailbox and runs the close once.
-- Applied by hand as the owner (POSTGRES_USER); idempotent.
set role asa_hub_app_rw;

create table if not exists app.comm_replies_state (
    key         text primary key,
    value       text not null default '',
    prev        text not null default '',
    write_id    text not null default '',
    updated_at  timestamptz not null default now()
);

grant select on app.comm_replies_state to asa_hub_app_ro;
