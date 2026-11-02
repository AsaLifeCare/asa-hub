-- The Quo inbox's three books in tables of their own (app/resource_rows.py OWN_TABLES): every call's transcript
-- (quoTranscripts → app.quo_calls), every text (quoMessages → app.quo_texts) and every call's summary (quoSummaries →
-- app.quo_recaps). Each has app.resource_rows' shape, so the generic resources' readers and writers serve them, and
-- the index its own lookups need: a text by its message id, a call or a summary by its call id.
-- Applied by hand as the owner; idempotent. asa-hub-app writes them (asa_hub_app_rw) and reads them (asa_hub_app_ro).
set role asa_hub_app_rw;

create table if not exists app.quo_calls (like app.resource_rows including all);
create table if not exists app.quo_texts (like app.resource_rows including all);
create table if not exists app.quo_recaps (like app.resource_rows including all);

create index if not exists quo_texts_message on app.quo_texts (resource, (cells->>'message_id'));
create index if not exists quo_calls_call on app.quo_calls (resource, (cells->>'call_id'));
create index if not exists quo_recaps_call on app.quo_recaps (resource, (cells->>'call_id'));

grant select on app.quo_calls, app.quo_texts, app.quo_recaps to asa_hub_app_ro;
reset role;
