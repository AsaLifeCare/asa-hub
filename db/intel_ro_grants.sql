-- What asa-hub-app's read-only role (asa_hub_ro, HUB_RELAY_RO_DSN; also asa-hub-db-sync's MIRROR_DSN) may read in
-- the old platform's database. Applied by hand as postgres on old_platform; idempotent. Each table is
-- the old platform's own record, never a sheet: sheets are read from asa-hub-db only.

-- held before the derived slices moved
grant select on public.asa_calendar_calloff_road, public.asa_client_financial_txns, public.asa_client_meds,
    public.asa_cortex_dialog_messages, public.asa_drive_sheets_meta, public.asa_drive_sheets_rows,
    public.asa_finance_doc, public.asa_house_calendar_claims, public.asa_house_calendar_live,
    public.asa_house_calendar_overrides, public.asa_house_day_published, public.asa_house_worked_days,
    public.asa_invoice_catalog, public.asa_isp_chat, public.asa_med_deliveries, public.asa_med_pictures,
    public.asa_shift_handoffs, public.asa_shift_pool, public.asa_shift_requests, public.asa_time_off_said,
    public.asa_time_off_writes, public.hub_sheet_sync_state, public.hub_sheet_sync_tabs
    to asa_hub_ro;

-- the derived slices built in asa-hub-app: financeSummary, alertsTriage, workforceForecast, cortexContacts,
-- commRoutes, psiPunches (the relay read them as postgres)
grant usage on schema ops to asa_hub_ro;
grant select on public.asa_finance_summary, public.asa_alerts, public.asa_workforce_analysis,
    public.asa_workforce_insights, ops.employees, ops.identity_overrides, public.asa_entity_facts,
    public.asa_entity_relationships, public.asa_psi_time_entries
    to asa_hub_ro;

-- the communication windows and attendance built in asa-hub-app (commWhen, commWhenMoments, commAttendance)
grant select on public.asa_entity_aliases, public.asa_openphone_lines to asa_hub_ro;
