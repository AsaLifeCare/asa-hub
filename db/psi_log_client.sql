-- PSI Log's new client (app/psi_log.py create_client): the master adds a client to PsiAnywhere. The step is kept in
-- app.psi_log_events, so its action must be allowed there too.
-- Applied by hand as the owner (POSTGRES_USER); idempotent.
set role asa_hub_app_rw;

alter table app.psi_log_events drop constraint if exists psi_log_events_action_check;
alter table app.psi_log_events add constraint psi_log_events_action_check
    check (action in ('sign-in', 'code', 'sign-out', 'clock-in', 'clock-out', 'submit', 'reset-password', 'approve',
                      'new-client'));

reset role;
