-- What the opt-out index's inbound sweep (app/opt_outs.py, app/opt_outs_writes.py; OptOut.gs) kept in Apps Script's
-- Script Properties and script cache: HUB_INBOUND_CURSOR, the last row of the Quo workbook's Messages tab a pass
-- reached (no expiry), and inbound_sweep_ran, the automatic pass's throttle (held until expires_at). A write the relay
-- voids puts the value it replaced (prev) back, while no later write has moved it. Applied by hand as the owner
-- (POSTGRES_USER); idempotent.
set role asa_hub_app_rw;

create table if not exists app.opt_out_state (
    key         text primary key,
    value       text not null default '',
    expires_at  timestamptz,
    prev        text not null default '',
    write_id    text not null default '',
    updated_at  timestamptz not null default now()
);

grant select on app.opt_out_state to asa_hub_app_ro;
