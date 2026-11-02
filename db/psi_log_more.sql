-- PSI Log's further actions (app/psi_log.py): the master may reject a time entry and turn an account on or off. The
-- steps are kept in app.psi_log_events, so their actions must be allowed there too.
-- Applied by hand as the owner (POSTGRES_USER); idempotent.
set role asa_hub_app_rw;

alter table app.psi_log_events drop constraint if exists psi_log_events_action_check;
alter table app.psi_log_events add constraint psi_log_events_action_check
    check (action in ('sign-in', 'code', 'sign-out', 'clock-in', 'clock-out', 'submit', 'reset-password', 'approve',
                      'new-client', 'reject', 'account'));

reset role;
