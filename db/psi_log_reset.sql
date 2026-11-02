-- PSI Log's password resets (app/psi_log.py reset_password): the master resets an employee's PsiAnywhere password to a
-- standard one. The step is kept in app.psi_log_events like every other, so its action must be allowed there too.
-- Applied by hand as the owner (POSTGRES_USER); idempotent.
set role asa_hub_app_rw;

alter table app.psi_log_events drop constraint if exists psi_log_events_action_check;
alter table app.psi_log_events add constraint psi_log_events_action_check
    check (action in ('sign-in', 'code', 'sign-out', 'clock-in', 'clock-out', 'submit', 'reset-password'));

reset role;
