-- Chat: person-to-person messages, kept in the Hub's own tables, never in a sheet. A thread is the messages between two
-- people, keyed by the pair. Applied by hand as the owner (POSTGRES_USER); idempotent. The tables are the app writer's,
-- like every app.* table: asa-hub-app writes them (asa_hub_app_rw) and reads them (asa_hub_app_ro).
set role asa_hub_app_rw;

-- one message; `seq` is the order it was taken in, which is the order a thread reads in
create table if not exists app.chat_messages (
    seq         bigserial unique,
    message_id  text primary key check (message_id ~ '^msg_[a-z0-9]{12,64}$'),
    thread_key  text not null default '',
    from_user   text not null,
    from_name   text not null default '',
    to_user     text not null,
    body        text not null check (length(body) between 1 and 4000),
    created_at  timestamptz not null,
    read_at     timestamptz,
    reactions   jsonb not null default '{}',
    write_id    text not null default '',
    source      text not null default 'hub' check (source in ('hub', 'sheet'))
);
create index if not exists chat_messages_from on app.chat_messages (from_user);
create index if not exists chat_messages_to on app.chat_messages (to_user);

-- when each account last had the platform open
create table if not exists app.chat_presence (
    user_id  text primary key,
    name     text not null default '',
    seen_at  timestamptz not null
);

-- a write's answer under its write id: a retry is answered again, never decided twice
create table if not exists app.chat_receipts (
    write_id  text primary key,
    action    text not null,
    account   text not null,
    answer    jsonb not null,
    at        timestamptz not null default now()
);

grant select on app.chat_messages, app.chat_presence, app.chat_receipts to asa_hub_app_ro;
reset role;

-- The messages and presence the sheets held until the chat moved here (ASA Data — ChatMessages / ChatPresence, as
-- asa-hub-db copies them): every row once, never twice, in the sheet's own order. Run again, it adds only what is new.
insert into app.chat_messages (message_id, thread_key, from_user, from_name, to_user, body, created_at, read_at,
                               reactions, source)
select m.message_id, m.thread_key, m.from_user, m.from_name, m.to_user, m.body, m.created_at::timestamptz,
       nullif(m.read_at, '')::timestamptz,
       case when coalesce(m.reactions, '') ~ '^\s*\{' then m.reactions::jsonb else '{}'::jsonb end, 'sheet'
  from sheets.t_a634557e_asa_data_chatmessages_data m
 where m.message_id ~ '^msg_[a-z0-9]{12,64}$' and length(m.body) between 1 and 4000
 order by m.row_number
on conflict (message_id) do nothing;

insert into app.chat_presence (user_id, name, seen_at)
select p.user_id, coalesce(p.name, ''), p.seen_at::timestamptz
  from sheets.t_4d6938b8_asa_data_chatpresence_data p
 where coalesce(p.user_id, '') <> '' and coalesce(p.seen_at, '') <> ''
on conflict (user_id) do update set seen_at = greatest(app.chat_presence.seen_at, excluded.seen_at),
                                    name = case when app.chat_presence.name = '' then excluded.name
                                                else app.chat_presence.name end;
