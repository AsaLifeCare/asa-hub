-- The records the Hub read from the old platform's database, taken over on 2026-10-27 because the old platform is being shut
-- down. Each table holds exactly the columns asa-hub-app's read-only role was granted there (db/intel_ro_grants.sql),
-- with the same names and types, so every reader's statement runs unchanged in schema app
-- (lanes_pg.ReadConn and mw_relay_state route them here). ops.employees and ops.identity_overrides become
-- app.ops_employees and app.ops_identity_overrides. Filled once by tools/take-lane-tables.py, which proves each table
-- against the old platform's rows; from then on nothing is read from the old platform.
-- Applied by hand as the owner (POSTGRES_USER); idempotent. asa-hub-app reads them (asa_hub_app_ro); the owner role
-- asa_hub_app_rw holds them.
create extension if not exists pg_trgm;

set role asa_hub_app_rw;

create table if not exists app.ops_employees (
    id bigint primary key,
    name_key text unique,
    display_name text,
    status text,
    profile jsonb,
    sources jsonb,
    source_coverage text[],
    sheet_row_number integer,
    first_seen_at timestamptz,
    updated_at timestamptz
);

create table if not exists app.ops_identity_overrides (
    name_key text primary key,
    canonical_key text,
    note text,
    created_at timestamptz
);

create table if not exists app.asa_alerts (
    id integer primary key,
    alert_id text unique,
    alert_type text,
    entity_name text,
    entity_type text,
    severity text,
    detection_method text,
    metric_value text,
    message text,
    details jsonb,
    acknowledged boolean,
    acknowledged_by text,
    acknowledged_at timestamptz,
    created_at timestamptz,
    feedback_outcome text,
    feedback_at timestamptz,
    auto_expired boolean
);
create index if not exists asa_alerts_active on app.asa_alerts (acknowledged, severity, created_at desc);
create index if not exists asa_alerts_created on app.asa_alerts (created_at desc);
create index if not exists asa_alerts_entity on app.asa_alerts (entity_name, created_at desc);

create table if not exists app.asa_client_financial_txns (
    id bigint primary key,
    row_key text unique,
    client_name text,
    txn_date text,
    txn_dt date,
    posted_date text,
    vendor text,
    location text,
    account_id text,
    last_four text,
    txn_type text,
    amount numeric(12,2),
    fund_type text,
    category text,
    description text,
    staff_member text,
    source text,
    receipt text,
    receipt_ai text,
    receipt_ai_note text,
    exempt_reason text,
    last_sync timestamptz,
    created_at timestamptz,
    updated_at timestamptz
);
create index if not exists asa_client_financial_txns_client on app.asa_client_financial_txns (lower(client_name));
create index if not exists asa_client_financial_txns_month on app.asa_client_financial_txns (txn_dt);

create table if not exists app.asa_client_meds (
    id bigint primary key,
    client_name text,
    name_key text,
    med_name text,
    dose text,
    freq text,
    source_doc text,
    source_date date,
    updated_at timestamptz,
    unique (name_key, med_name, dose)
);

create table if not exists app.asa_cortex_dialog_messages (
    id bigint primary key,
    session_id text,
    role text,
    content text,
    tokens integer,
    latency_ms integer,
    voice_lane text,
    tools_called jsonb,
    cortex_mood jsonb,
    created_at timestamptz,
    user_id text,
    user_group text
);
create index if not exists asa_cortex_dialog_messages_user on app.asa_cortex_dialog_messages (user_group, user_id, session_id);
create index if not exists asa_cortex_dialog_messages_session on app.asa_cortex_dialog_messages (session_id, id);

create table if not exists app.asa_entity_aliases (
    alias text,
    alias_norm text,
    canonical text,
    kind text,
    source text,
    created_at timestamptz
);
create index if not exists asa_entity_aliases_norm on app.asa_entity_aliases (alias_norm);

create table if not exists app.asa_entity_facts (
    id integer primary key,
    entity_name text,
    entity_type text,
    fact_type text,
    fact_value text,
    source text,
    ease_factor double precision,
    interval_days integer,
    next_review_at timestamptz,
    last_reviewed_at timestamptz,
    review_count integer,
    last_grade integer,
    created_at timestamptz,
    origin text,
    state text,
    sources_count integer,
    needs_resolution boolean,
    source_trust real,
    metric_key text,
    unique (entity_name, fact_type, fact_value)
);
create index if not exists asa_entity_facts_type on app.asa_entity_facts (fact_type);
create index if not exists asa_entity_facts_entity on app.asa_entity_facts (entity_name);

create table if not exists app.asa_entity_relationships (
    id integer primary key,
    entity_a text,
    relation_type text,
    entity_b text,
    weight double precision,
    confidence double precision,
    source text,
    last_seen timestamptz,
    first_seen timestamptz,
    occurrence_count integer,
    metadata jsonb,
    unique (entity_a, relation_type, entity_b)
);

create table if not exists app.asa_finance_doc (
    drive_file_id text primary key,
    subfolder text,
    name text,
    mime text,
    size_bytes bigint,
    web_view_link text,
    vendor text,
    doc_date date,
    amount numeric,
    currency text,
    category text,
    method text,
    modified_time text,
    extracted_at timestamptz
);

create table if not exists app.asa_finance_summary (
    id text primary key,
    payload jsonb,
    computed_at timestamptz
);

create table if not exists app.asa_invoice_catalog (
    file_uid text primary key,
    drive_file_id text,
    source text,
    topic text,
    name text,
    web_view_link text,
    local_path text,
    record_type text,
    kind text,
    category text,
    matched_by text,
    invoice_no text,
    amount numeric,
    amount_raw text,
    is_large boolean,
    doc_date text,
    vendor text,
    has_text boolean,
    scanned_at timestamptz,
    updated_at timestamptz
);

create table if not exists app.asa_isp_chat (
    client_key text primary key,
    client_name text,
    isp_year text,
    source_file text,
    page_count integer,
    diagnoses text,
    medications text,
    allergies text,
    diet_nutrition text,
    goals_outcomes text,
    behaviors text,
    safety_risks text,
    supervision_level text,
    communication text,
    mobility text,
    personal_care text,
    medical_summary text,
    important_to text,
    important_for text,
    contacts text,
    full_json jsonb,
    raw_text text,
    loaded_at timestamptz
);

create table if not exists app.asa_med_deliveries (
    file_id text primary key,
    house text,
    file_date date,
    period_start date,
    period_end date,
    drug_count integer,
    patient_count integer,
    meds_json jsonb,
    web_link text,
    updated_at timestamptz
);
create index if not exists asa_med_deliveries_house_date on app.asa_med_deliveries (house, file_date desc);

create table if not exists app.asa_med_pictures (
    uid text primary key,
    client text,
    med_name text,
    dosage text,
    picture_url text,
    source text,
    local_path text,
    id_client text,
    id_house text,
    updated_at timestamptz
);

create table if not exists app.asa_psi_time_entries (
    single_entry_id text primary key,
    status text,
    employee text,
    people_id text,
    date_service text,
    start_time text,
    end_time text,
    hours numeric,
    address text,
    house text,
    work_code text,
    consumers text,
    num_consumers integer,
    supervisor_id integer,
    comments text,
    submitted_user text,
    latitude text,
    longitude text,
    raw jsonb,
    synced_at timestamptz,
    has_signature boolean,
    is_documented boolean,
    evv_reasons text
);

create table if not exists app.asa_users (
    id integer primary key,
    username varchar(50) unique,
    display_name varchar(100),
    role varchar(20),
    active boolean,
    last_login timestamptz,
    created_at timestamptz,
    email varchar(100) unique,
    avatar_color varchar(9),
    entity_name text,
    tenant_id text,
    layout_pref text,
    ui_prefs jsonb,
    phone varchar(32),
    merged_into integer
);
create index if not exists asa_users_entity_name on app.asa_users (entity_name);

create table if not exists app.asa_workforce_analysis (
    id integer primary key,
    computed_at timestamptz,
    payload jsonb
);

create table if not exists app.asa_workforce_insights (
    id integer primary key,
    computed_at timestamptz,
    payload jsonb
);

grant select on app.ops_employees, app.ops_identity_overrides, app.asa_alerts, app.asa_client_financial_txns,
    app.asa_client_meds, app.asa_cortex_dialog_messages, app.asa_entity_aliases, app.asa_entity_facts,
    app.asa_entity_relationships, app.asa_finance_doc, app.asa_finance_summary, app.asa_invoice_catalog,
    app.asa_isp_chat, app.asa_med_deliveries, app.asa_med_pictures, app.asa_psi_time_entries, app.asa_users,
    app.asa_workforce_analysis, app.asa_workforce_insights
    to asa_hub_app_ro;
reset role;
