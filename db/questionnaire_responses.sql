-- Questionnaire responses: every questionnaire a person sends from the Questionnaires app or the onboarding flow,
-- scored by asa-hub-app (app/questionnaires.py) from the weights the questionnaires tab carries. The Hub's database
-- alone keeps them: no sheet holds a new response. The responses the questionnaireResponses tab held before stay there
-- and are listed with these. A write the relay voids takes its response back (write_id).
-- Applied by hand as the owner (POSTGRES_USER); idempotent. asa-hub-app writes it (asa_hub_app_rw) and reads it
-- (asa_hub_app_ro).
set role asa_hub_app_rw;

create table if not exists app.questionnaire_responses (
    response_id          text primary key check (response_id ~ '^QR_[0-9A-F]{16}$'),
    questionnaire_id     text not null check (questionnaire_id <> ''),
    questionnaire_title  text not null default '',
    respondent           text not null default '',
    respondent_email     text not null default '',
    respondent_uid       text not null default '',
    role                 text not null default '',
    submitted_at         timestamptz not null default now(),
    answered             integer not null default 0,
    total                integer not null default 0,
    score                numeric(3, 1),
    score_max            integer not null default 5,
    status               text not null default 'submitted',
    answers_json         text not null default '{}',
    write_id             text not null default ''
);
create index if not exists questionnaire_responses_when on app.questionnaire_responses (submitted_at desc);
create index if not exists questionnaire_responses_of on app.questionnaire_responses (questionnaire_id, respondent_uid);

grant select on app.questionnaire_responses to asa_hub_app_ro;
reset role;
