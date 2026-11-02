-- What the staff documents' and the clearance overlay's doors (app/staff_docs.py, app/staff_docs_writes.py;
-- StaffDocs.gs, Clearance.gs) kept in Apps Script's Script Properties: STAFF_DOCS_APPLY_CURSOR, where the next press of
-- staffDocsApplyDates starts in the form's dated entries, and CLEARANCE_OCR_CURSOR, where the next clearanceReadDates
-- starts in the documents waiting for a date. A write the relay voids puts the value it replaced (prev) back, while no
-- later write has moved it. Applied by hand as the owner (POSTGRES_USER); idempotent.
set role asa_hub_app_rw;

create table if not exists app.staff_docs_state (
    key         text primary key,
    value       text not null default '',
    prev        text not null default '',
    write_id    text not null default '',
    updated_at  timestamptz not null default now()
);

grant select on app.staff_docs_state to asa_hub_app_ro;
