-- The shift rehearsal's sandbox (app/rehearsal_sandbox.py): a schema of its own in asa-hub-db, never the old platform.
-- Its sealed worker connects as asa-hub-app's writer role on a search path that opens here, makes the lanes' tables
-- inside it with their own DDL on its first board, fills them with a copy of the estate read from schema app, and
-- writes nothing outside it: every statement is vetted, and a commit that wrote anywhere else is rolled back. The
-- worker never makes the schema; this file does. Nothing in it is a real row.
-- Applied by hand as the owner (POSTGRES_USER); idempotent.
create schema if not exists asa_rehearsal authorization asa_hub_app_rw;
alter schema asa_rehearsal owner to asa_hub_app_rw;
-- the sandbox holds real staff numbers in its copy: only its owner reads it
revoke all on schema asa_rehearsal from public;
