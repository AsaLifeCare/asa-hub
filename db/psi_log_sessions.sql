-- PSI Log's PsiAnywhere sessions and refusals, kept across restarts (app/psi_log.py). The app restarts with every
-- deploy, and a session held in its memory alone signed everyone out each time while PsiAnywhere's tokens live for
-- hours; the wrong-password guard forgot the two refusals that stop PsiAnywhere's account-locking third.
-- psi_log_sessions: one row per Hub account, the session SEALED (AES-GCM under a key derived from the server's own
-- secret, the Hub account bound in) — the token is only ever inside `sealed`, never a password; expires_at is
-- obtained_at + 20 h, and a row idle 10 h is let go of. psi_log_refusals: PsiAnywhere's refusals per user name, held
-- for an hour, so the Hub never sends the third wrong password.
-- The app makes both on first use too (psi_log.ddl), so it never waits on this file. Applied by hand as the owner
-- (POSTGRES_USER); idempotent. asa-hub-app writes them (asa_hub_app_rw) and the read role may read them (asa_hub_app_ro).
set role asa_hub_app_rw;

create table if not exists app.psi_log_sessions (
    hub_uid     text primary key,
    psi_user    text not null default '',
    sealed      bytea not null,
    obtained_at timestamptz not null default now(),
    seen_at     timestamptz not null default now(),
    expires_at  timestamptz not null
);

create table if not exists app.psi_log_refusals (
    psi_user text primary key,
    count    integer not null default 0,
    at       timestamptz not null default now()
);

grant select on app.psi_log_sessions to asa_hub_app_ro;
grant select on app.psi_log_refusals to asa_hub_app_ro;
reset role;
