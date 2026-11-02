-- Staff Candidates › Resume: the words of a résumé that is a scan (a PDF with no text layer, or a picture), read once by
-- OCR. Applied by hand as the owner (POSTGRES_USER); idempotent. The table is the app writer's, like every app.* table.
-- asa-hub-app (its writer) owes a file when a résumé reads as a scan; the relay's lane (role asa_hub_meds,
-- server/resume_texts.py) reads it with Tesseract as the platform's own account and keeps the words. A résumé filed by
-- the relay itself is kept read at once. The words are the file's at its modified time; a newer file is read again.
set role asa_hub_app_rw;

create table if not exists app.resume_texts (
    file_id        text primary key,
    modified_time  text not null default '',
    candidate      text not null default '',
    state          text not null default 'pending' check (state in ('pending', 'read', 'failed')),
    text           text not null default '',
    chars          integer not null default 0,
    pages          integer not null default 0,
    error          text not null default '',
    attempts       integer not null default 0,
    next_try_at    timestamptz not null default now(),
    found_at       timestamptz not null default now(),
    read_at        timestamptz,
    seconds        real,
    updated_at     timestamptz not null default now()
);
create index if not exists resume_texts_due on app.resume_texts (next_try_at) where state <> 'read';

grant select, insert, update on app.resume_texts to asa_hub_meds;
grant select on app.resume_texts to asa_hub_app_ro;
reset role;
