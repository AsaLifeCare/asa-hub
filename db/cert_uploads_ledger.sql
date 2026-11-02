-- The compliance papers' ledger (cert_uploads), kept in app.resource_rows as the certUploads resource: the worker's
-- paper reader (server/cert_reads.py, role asa_hub_meds) reads its rows through this view, and nothing else of
-- app.resource_rows. No row at all while the resource is not uploaded; one row with no key while it holds none.
-- Applied by hand as the owner; idempotent.
set role asa_hub_app_rw;

create or replace view app.cert_uploads_ledger as
select c.uploaded_at, r.row_key, r.position, r.cells, r.created_at
  from app.resource_columns c
  left join app.resource_rows r on r.resource = c.resource and r.removed_at is null
 where c.resource = 'certUploads' and c.uploaded_at is not null;

grant select on app.cert_uploads_ledger to asa_hub_meds;
reset role;
