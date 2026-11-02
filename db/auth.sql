-- The sign-in's own tables (app/auth.py, app/auth_store.py, app/auth_doors.py; Auth.gs, PasswordReset.gs,
-- Invites.gs): the credential each account signs in with (salt and hash exactly as hashPassword_ makes them; the
-- users tab keeps neither any more, its must_change and last_login cells stay the account row's), the
-- sessions (the token's sha256 only, never the token), the counters the script cache held (failed sign-ins, reset
-- asks), the temporary passwords a reset hands out, the reset links already spent, and the importer's stamps.
-- Applied by hand as the owner (POSTGRES_USER); idempotent. The writer role alone reads and writes them, and it is
-- never given DELETE: a credential or a session is blanked or revoked, never removed. asa_hub_app_ro reads none.
set role asa_hub_app_rw;

create table if not exists app.auth_credentials (
    user_id        text primary key,
    salt           text not null default '',
    pass_hash      text not null default '',
    -- 'sheet' (the importer, which never overwrites any other) or 'python' (a door that set a password)
    origin         text not null default 'python',
    -- the write that set it, and what it replaced, so a write the relay voids puts the old one back
    write_id       text not null default '',
    prev_salt      text not null default '',
    prev_pass_hash text not null default '',
    prev_origin    text not null default '',
    prev_write_id  text not null default '',
    updated_at     timestamptz not null default now()
);

create table if not exists app.auth_sessions (
    token_hash   text primary key,
    user_id      text not null,
    created_at   timestamptz not null default now(),
    expires_at   timestamptz not null,
    last_seen    timestamptz not null default now(),
    revoked_at   timestamptz,
    -- 'python' (minted here) or 'sheet' (an Apps Script session the importer carried over)
    origin       text not null default 'python',
    -- the write whose `rows` book op lays the session's row on the Sessions tab, so Apps Script's doors know it too
    twin         text not null default '',
    -- a session minted from another one (the Sessions tab's acting_real_user_id and parent_token_hash): the account
    -- that started it and the session it hangs from, blank for every session an account opened for itself
    real_user_id      text not null default '',
    parent_token_hash text not null default ''
);
create index if not exists auth_sessions_user on app.auth_sessions (user_id) where revoked_at is null;
create index if not exists auth_sessions_parent on app.auth_sessions (parent_token_hash)
    where parent_token_hash <> '' and revoked_at is null;

create table if not exists app.auth_counts (
    kind         text not null,
    key_hash     text not null,
    n            integer not null default 0,
    expires_at   timestamptz not null,
    primary key (kind, key_hash)
);

create table if not exists app.auth_temp_passwords (
    id           bigserial primary key,
    user_id      text not null,
    salt         text not null,
    pass_hash    text not null,
    channel      text not null default '',
    created_at   timestamptz not null default now(),
    expires_at   timestamptz not null,
    used_at      timestamptz,
    write_id     text not null default '',
    origin       text not null default 'python'
);
create index if not exists auth_temp_passwords_user on app.auth_temp_passwords (user_id, id);

create table if not exists app.auth_reset_spent (
    token_hash   text primary key,
    user_id      text not null default '',
    used_at      timestamptz not null default now()
);

create table if not exists app.auth_state (
    key          text primary key,
    value        text not null default '',
    at           timestamptz not null default now()
);

revoke all on app.auth_credentials, app.auth_sessions, app.auth_counts, app.auth_temp_passwords,
    app.auth_reset_spent, app.auth_state from public;
revoke delete, truncate, references, trigger on app.auth_credentials, app.auth_sessions, app.auth_counts,
    app.auth_temp_passwords, app.auth_reset_spent, app.auth_state from asa_hub_app_rw;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'asa_hub_app_ro') then
    execute 'revoke all on app.auth_credentials, app.auth_sessions, app.auth_counts, app.auth_temp_passwords,'
            ' app.auth_reset_spent, app.auth_state from asa_hub_app_ro';
    execute 'revoke all on sequence app.auth_temp_passwords_id_seq from asa_hub_app_ro';
  end if;
end
$$;
