-- The relay's own tables (server/*.py), moved out of the old platform's database into asa-hub-db: the same names,
-- columns, keys and indexes they have there, in schema app. tools/move_relay_tables.py copies their rows; the relay
-- reads and writes them as asa_hub_app_rw once HUB_RELAY_DB_DSN is set. asa-hub-app reads the ones mw_relay_state
-- serves (asa_hub_app_ro). The Technology statuses and hand-added projects are not here: app.tech_project_status and
-- app.tech_manual_projects (db/technology.sql) already hold them.
-- Applied by hand as the owner (POSTGRES_USER); idempotent.
set role asa_hub_app_rw;

-- sessions and the back-end switch
create table if not exists app.hub_session_vouch (
    token_hash  text primary key,
    role        text not null default '',
    user_id     text not null default '',
    seen_at     timestamptz not null default now()
);

create table if not exists app.hub_backend_switch (
    app      text primary key,
    backend  text not null,
    set_by   text not null default '',
    set_at   timestamptz not null default now()
);

-- web notices, their reads, and the push devices and outbox
create table if not exists app.asa_hub_notices (
    id          bigserial primary key,
    key         text not null unique,
    kind        text not null,
    at          timestamptz not null default now(),
    location    text not null default '',
    col_iso     text not null default '',
    ref         text not null default '',
    value       text not null default '',
    facts       jsonb not null default '{}'::jsonb,
    created_at  timestamptz not null default now(),
    held_test   boolean not null default false
);
create index if not exists asa_hub_notices_created on app.asa_hub_notices (created_at desc);

create table if not exists app.asa_hub_notice_reads (
    user_id       text not null,
    notice_id     bigint not null,
    read_at       timestamptz not null default now(),
    dismissed_at  timestamptz,
    primary key (user_id, notice_id)
);

create table if not exists app.asa_hub_push_subs (
    endpoint     text primary key,
    user_id      text not null,
    p256dh       text not null,
    auth         text not null,
    role         text not null default '',
    ua           text not null default '',
    created_at   timestamptz not null default now(),
    seen_at      timestamptz not null default now(),
    last_ok_at   timestamptz,
    last_status  integer,
    fails        integer not null default 0
);
create index if not exists asa_hub_push_subs_user on app.asa_hub_push_subs (user_id);

create table if not exists app.asa_hub_push_outbox (
    notice_id   bigint not null,
    user_id     text not null,
    state       text not null,
    held_by     text not null default '',
    words       jsonb not null default '{}'::jsonb,
    devices     integer not null default 0,
    tries       integer not null default 0,
    why         text not null default '',
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now(),
    sent_at     timestamptz,
    primary key (notice_id, user_id)
);
create index if not exists asa_hub_push_outbox_state on app.asa_hub_push_outbox (state);

-- My Inbox's read marks
create table if not exists app.asa_hub_inbox_reads (
    user_id       text not null,
    alert_key     text not null,
    read_at       timestamptz not null default now(),
    dismissed_at  timestamptz,
    primary key (user_id, alert_key)
);

create table if not exists app.asa_hub_inbox_seen (
    kind        text not null,
    key         text not null,
    first_seen  timestamptz not null default now(),
    primary key (kind, key)
);

-- open shifts, requests and swaps
create table if not exists app.asa_shift_pool (
    location       text not null,
    open_row       text not null,
    col_iso        text not null,
    kind           text not null default 'open_shift',
    value          text not null default '',
    opened_at      timestamptz not null default now(),
    shift_start    timestamptz,
    shift_end      timestamptz,
    called_off_by  text not null default '',
    reason         text not null default '',
    closed_at      timestamptz,
    decided_by     text not null default '',
    filled_by      text not null default '',
    filled_how     text not null default '',
    said           jsonb not null default '{}'::jsonb,
    first_seen     timestamptz not null default now(),
    ref            text not null default '',
    primary key (location, open_row, col_iso)
);

create table if not exists app.asa_shift_requests (
    id          text primary key,
    kind        text not null,
    location    text not null default '',
    open_row    text not null default '',
    col_iso     text not null default '',
    value       text not null default '',
    person      text not null default '',
    state       text not null default 'applied',
    why         text not null default '',
    via         text not null default 'app',
    ref         text not null default '',
    decided_by  text not null default '',
    decided_at  timestamptz,
    created_at  timestamptz not null default now(),
    extra       jsonb not null default '{}'::jsonb
);
create unique index if not exists asa_shift_requests_live_kind on app.asa_shift_requests
    (kind, location, open_row, col_iso, lower(person)) where state = any (array['applied', 'needs_training_approval']);

create table if not exists app.asa_shift_handoffs (
    id                text primary key,
    location          text not null,
    col_iso           text not null,
    value             text not null default '',
    from_staff        text not null,
    to_staff          text not null,
    house_manager     text not null default '',
    staff_state       text not null default 'pending',
    staff_via         text default '',
    staff_at          timestamptz,
    manager_state     text not null default 'pending',
    manager_via       text default '',
    manager_at        timestamptz,
    manager_by        text default '',
    state             text not null default 'pending',
    why               text default '',
    created_by        text default '',
    created_at        timestamptz not null default now(),
    closed_at         timestamptz,
    said              jsonb not null default '{}'::jsonb,
    approvers         jsonb not null default '[]'::jsonb,
    approval          text not null default '',
    approval_why      text not null default '',
    manager_phone     text not null default '',
    staff_by          text not null default '',
    offered_by        text not null default '',
    shift_start       timestamptz,
    training_request  text not null default '',
    training          jsonb not null default '{}'::jsonb,
    closed_by         text not null default '',
    extra             jsonb not null default '{}'::jsonb,
    director_state    text not null default 'pending',
    director_via      text not null default '',
    director_at       timestamptz,
    director_by       text not null default '',
    directors         jsonb not null default '[]'::jsonb
);
create unique index if not exists asa_shift_handoffs_open_giver on app.asa_shift_handoffs
    (location, col_iso, regexp_replace(lower(from_staff), '[^a-z0-9]+', '', 'g')) where state = 'pending';

create table if not exists app.asa_house_day_published (
    location    text not null,
    col_iso     text not null,
    first_seen  timestamptz not null default now(),
    cells       integer not null default 0,
    primary key (location, col_iso)
);

create table if not exists app.asa_house_worked_days (
    person_key  text not null,
    location    text not null,
    day         date not null,
    seen_at     timestamptz not null default now(),
    primary key (person_key, location, day)
);

create table if not exists app.asa_open_shift_covered (
    location     text not null,
    open_row     text not null,
    col_iso      text not null,
    value        text not null default '',
    shift_start  timestamptz,
    shift_end    timestamptz,
    filled_by    text not null default '',
    filled_how   text not null default '',
    decided_by   text not null default '',
    filled_at    timestamptz,
    noted_by     text not null default '',
    noted_at     timestamptz not null default now(),
    state        text not null default '',
    why          text not null default '',
    count        text not null default '',
    offers       integer not null default 0,
    failures     integer not null default 0,
    waits        integer not null default 0,
    offered_at   timestamptz,
    said_at      timestamptz,
    primary key (location, open_row, col_iso)
);

create table if not exists app.asa_open_shift_covered_birth (
    lane  text primary key,
    born  timestamptz not null default now()
);

create table if not exists app.asa_calendar_calloff_road (
    ref          text primary key,
    location     text not null,
    employee     text not null,
    col_iso      text not null,
    value        text not null default '',
    shift_start  timestamptz,
    reason       text not null default '',
    actor        text not null default '',
    state        text not null default 'owed',
    created_at   timestamptz not null default now(),
    tried_at     timestamptz,
    told_at      timestamptz,
    tries        integer not null default 0,
    last_error   text not null default '',
    answer       jsonb not null default '{}'::jsonb
);

-- the house calendars' claims, overrides and edit trail
create table if not exists app.asa_house_calendar_claims (
    location     text not null,
    open_row     text not null,
    col_iso      text not null,
    value        text not null default '',
    claimed_by   text not null,
    claimed_via  text not null default 'app',
    claimed_at   timestamptz not null default now(),
    primary key (location, open_row, col_iso)
);

create table if not exists app.asa_house_calendar_overrides (
    location    text not null,
    employee    text not null,
    col_iso     text not null,
    value       text not null default '',
    updated_at  timestamptz not null default now(),
    primary key (location, employee, col_iso)
);

create table if not exists app.asa_house_calendar_edits (
    id         bigserial primary key,
    location   text not null,
    employee   text not null,
    col_iso    text not null,
    old_value  text not null default '',
    new_value  text not null default '',
    via        text not null default '',
    actor      text not null default '',
    at         timestamptz not null default now(),
    note       text not null default '',
    stage      text not null default '',
    act        text not null default '',
    undone_at  timestamptz
);
create index if not exists asa_house_calendar_edits_cell on app.asa_house_calendar_edits
    (location, employee, col_iso, id);
create index if not exists asa_house_calendar_edits_published on app.asa_house_calendar_edits (col_iso)
    where stage = 'published';
create index if not exists asa_house_calendar_edits_test_mode on app.asa_house_calendar_edits (location, col_iso)
    where stage = 'test_mode';

-- the Calendar Builder's drafts, periods and publish log
create table if not exists app.asa_cal_builder_draft (
    period_start  date not null,
    sheet_row     integer not null,
    date_iso      date not null,
    house         text not null,
    employee      text not null,
    value         text not null default '',
    base_value    text not null default '',
    updated_at    timestamptz not null default now(),
    updated_by    text not null default '',
    primary key (period_start, sheet_row, date_iso)
);

create table if not exists app.asa_cal_builder_house_draft (
    location     text not null,
    employee     text not null,
    col_iso      text not null,
    value        text not null default '',
    base_value   text not null default '',
    note         text not null default '',
    ist_missing  text not null default '',
    updated_at   timestamptz not null default now(),
    updated_by   text not null default '',
    primary key (location, employee, col_iso)
);

create table if not exists app.asa_cal_builder_periods (
    period_start  date primary key,
    status        text not null default 'draft',
    published_at  timestamptz,
    published_by  text not null default ''
);

create table if not exists app.asa_cal_builder_publish_log (
    id               bigserial primary key,
    period_start     date not null,
    published_at     timestamptz not null default now(),
    published_by     text not null default '',
    cells_json       jsonb not null default '[]'::jsonb,
    table_rows_json  jsonb not null default '[]'::jsonb
);

-- the punch warnings and what was said
create table if not exists app.asa_punch_warnings (
    id             text primary key,
    ref            text not null default '',
    person         text not null default '',
    person_key     text not null default '',
    house          text not null default '',
    house_name     text not null default '',
    shift_code     text not null default '',
    day            text not null default '',
    shift_at       timestamptz,
    shift_end      timestamptz,
    state          text not null default 'warned',
    why            text not null default '',
    opened_at      timestamptz not null default now(),
    told_at        timestamptz,
    tells          integer not null default 0,
    received_by    text not null default '',
    received_at    timestamptz,
    received_via   text not null default '',
    call_off_ref   text not null default '',
    call_off_why   text not null default '',
    converted_at   timestamptz,
    said           jsonb not null default '{}'::jsonb,
    attempts       integer not null default 0,
    delivered      integer not null default 0,
    phones         jsonb not null default '[]'::jsonb,
    first_said_at  timestamptz,
    last_said_at   timestamptz
);
create index if not exists asa_punch_warnings_ref on app.asa_punch_warnings (ref);

create table if not exists app.asa_punch_said (
    id          text primary key,
    shift_id    text not null default '',
    kind        text not null default '',
    person      text not null default '',
    said        jsonb not null default '{}'::jsonb,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);

-- Time Off's notices and the house writes it made
create table if not exists app.asa_time_off_said (
    id          text primary key,
    ref         text not null default '',
    kind        text not null default '',
    recipient   text not null default '',
    said        jsonb not null default '{}'::jsonb,
    updated_at  timestamptz not null default now()
);

create table if not exists app.asa_time_off_writes (
    tab         text not null,
    id          text not null,
    "row"       jsonb not null,
    row_number  integer not null default 0,
    written_at  timestamptz not null default now(),
    primary key (tab, id)
);

-- the SMS ear's replies and where it starts
create table if not exists app.asa_sms_replies (
    id          text primary key,
    line        text not null default '',
    sent_at     timestamptz not null,
    heard_at    timestamptz not null default now(),
    phone_key   text not null default '',
    phone_tail  text not null default '',
    person      text not null default '',
    sender      text not null default '',
    word        text not null default '',
    words       text not null default '',
    outcome     text not null,
    road        text not null default '',
    code        text not null default '',
    why         text not null default '',
    location    text not null default '',
    col_iso     text not null default '',
    value       text not null default '',
    ref         text not null default '',
    request_id  text not null default '',
    handoff_id  text not null default '',
    candidates  jsonb not null default '[]'::jsonb,
    ack         text not null default '',
    ack_why     text not null default '',
    said        jsonb not null default '{}'::jsonb,
    rehearsal   boolean not null default false
);
create index if not exists asa_sms_replies_sent on app.asa_sms_replies (sent_at);

create table if not exists app.asa_sms_reply_start (
    id     integer primary key,
    since  timestamptz not null default now()
);

-- the form digest's progress
create table if not exists app.hub_form_digest_items (
    row_id      text primary key,
    state       text not null default 'working',
    attempts    integer not null default 0,
    error       text not null default '',
    updated_at  timestamptz not null default now()
);

create table if not exists app.hub_form_digest_state (
    id                integer primary key default 1,
    last_pass_at      timestamptz,
    last_pass_items   integer not null default 0,
    last_pass_errors  integer not null default 0
);

-- the call-reading lane: its ledger, the sealed words and its switch
create table if not exists app.comm_call_reads (
    call_id        text primary key,
    state          text not null default 'reading',
    run_id         text,
    attempts       integer not null default 1,
    claimed_at     timestamptz not null default now(),
    read_at        timestamptz,
    landed_at      timestamptz,
    model_via      text,
    items          integer,
    error          text,
    facts          jsonb,
    hand_attempts  integer not null default 0,
    hand_at        timestamptz,
    hand_error     text
);
create index if not exists comm_call_reads_pending_idx on app.comm_call_reads (landed_at) where landed_at is null;
create index if not exists comm_call_reads_state_idx on app.comm_call_reads (state);

create table if not exists app.comm_call_seals (
    seal_id        text not null,
    call_id        text not null,
    scope          text not null,
    item_no        text not null default '',
    field          text not null,
    alg            text not null,
    recipient_fpr  text not null,
    ciphertext     bytea not null,
    plain_len      integer not null,
    cipher_len     integer not null,
    plain_sha256   text not null,
    sealed_at      text not null,
    stored_at      timestamptz not null default now(),
    primary key (seal_id, field)
);
create index if not exists comm_call_seals_call_idx on app.comm_call_seals (call_id);
create index if not exists comm_call_seals_fpr_idx on app.comm_call_seals (recipient_fpr);

create table if not exists app.comm_call_catchup (
    id          integer primary key default 1 constraint comm_call_catchup_one_row check (id = 1),
    enabled     boolean not null default false,
    updated_at  timestamptz not null default now(),
    updated_by  text,
    note        text
);

-- what asa-hub-app reads of them (app/mw_relay_state.py)
grant select on app.asa_shift_requests, app.asa_shift_handoffs, app.asa_shift_pool, app.asa_house_calendar_claims,
    app.asa_house_calendar_overrides, app.asa_house_day_published, app.asa_house_worked_days, app.asa_time_off_said,
    app.asa_time_off_writes, app.asa_calendar_calloff_road to asa_hub_app_ro;
reset role;
