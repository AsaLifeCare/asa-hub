-- The matrix's conditions engine (app/hiring_engine.py, app/hiring_engine_writes.py): the Rounds ledger — "slice X
-- passed here, over these units, at this time" — that FlowEngine.gs kept in the runtime book's Rounds tab: one row per
-- pass of each engine (hiring, migration, flow, schema-feed, runtime), a skip included, kept to its two thousand newest
-- rows by engineRoundsTrimSweep. The runtime engine reads it so a window another runner walked is not walked again. The
-- engine's cursors and marks are app.hiring_marks (db/hiring_hired.sql).
-- Applied by hand as the owner (POSTGRES_USER); idempotent (the hiring store makes the same table when it starts).
-- asa-hub-app writes it (asa_hub_app_rw) and reads it (asa_hub_app_ro).
set role asa_hub_app_rw;

create table if not exists app.hiring_engine_rounds (
    id           bigserial primary key,
    round_id     text not null,
    slice        text not null,
    runner       text not null default '',
    from_n       integer,
    to_n         integer,
    of_n         integer,
    units        integer,
    wrote        integer,
    started_at   timestamptz,
    finished_at  timestamptz not null default now(),
    ms           integer not null default 0,
    notes        text not null default '',
    write_id     text not null default ''
);

create index if not exists hiring_engine_rounds_slice on app.hiring_engine_rounds (slice, id);

grant select on app.hiring_engine_rounds to asa_hub_app_ro;
