-- Staff Candidates › Interviews › Candidate preferences: what a candidate said on a call, read once by the model.
-- Applied by hand as the owner (POSTGRES_USER); idempotent. The tables are the app writer's, like every app.* table.
-- asa-hub-app (its writer) owes a call when a candidate's preferences are read; the relay's lane (role asa_hub_meds,
-- server/call_prefs.py) reads the call's words from its own copy and keeps the answer. The row names the inboxes'
-- copies that may hold the words ([[book, tab], …]); it never holds them.
set role asa_hub_app_rw;

create table if not exists app.candidate_call_prefs (
    call_id      text primary key,
    candidate    text not null default '',
    sources      jsonb not null default '[]',
    state        text not null default 'pending' check (state in ('pending', 'read', 'failed')),
    prefs        jsonb,
    model        text not null default '',
    error        text not null default '',
    attempts     integer not null default 0,
    next_try_at  timestamptz not null default now(),
    found_at     timestamptz not null default now(),
    read_at      timestamptz,
    seconds      real,
    updated_at   timestamptz not null default now()
);
create index if not exists candidate_call_prefs_due on app.candidate_call_prefs (next_try_at) where state <> 'read';

grant select, update on app.candidate_call_prefs to asa_hub_meds;
grant select on app.candidate_call_prefs to asa_hub_app_ro;
reset role;
