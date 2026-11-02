-- Hiring (app/hiring_hired.py, app/interview_flow.py): the marks Apps Script kept in Script Properties for the hiring
-- sweep's lanes — READY_PARKED_ARMED_AT (the parking clock counts only arrivals at Ready to start after it) and
-- HUB_INTERVIEW_ASK_CURSOR (the last row of the Quo workbook's Messages tab the interviewer's ear reached). A mark not
-- kept here yet reads the copy's Script Property.
-- Applied by hand as the owner (POSTGRES_USER); idempotent (the hiring store makes the same table when it starts).
-- asa-hub-app writes it (asa_hub_app_rw) and reads it (asa_hub_app_ro).
set role asa_hub_app_rw;

create table if not exists app.hiring_marks (
    key         text primary key,
    value       text not null default '',
    updated_at  timestamptz not null default now()
);

grant select on app.hiring_marks to asa_hub_app_ro;
