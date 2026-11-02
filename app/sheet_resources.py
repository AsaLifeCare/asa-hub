"""The generic verbs (Main.gs route: listRows_, requireRow_, createRow_, updateRowById_, deleteRowById_) on the
resources the Hub's own apps run in Postgres (app/resource_rows.py): read and written there alone — a row made,
changed, removed, a column a write names added — with route()'s own gates and words."""
from __future__ import annotations

import json
import re
from typing import Any, Callable

import call_offs_writes as COW
import candidates as CND
import gsjs
import hubdb
import locations as L
import resource_rows as RR
import scope as sc
import writes as W
from scope import Defer
from writes import Decision

# the Asa Employee Database's tabs, each kept in Postgres (empMaster, empArchiveOldEmployees, ...)
EMPLOYEE_BOOK_TABS = ("Master", "Archive - Old Employees", "Med Del Certs (MAIS)", "Trainings Status",
                      "employee driver", "Driver Compliance", "Roles", "Notifications", "Sheet56", "Sheet57")
# the columns its copy withholds (server/redaction.py, or a name that reads as a secret): kept as their markers, so
# every reader answers as it did; never read from Google
EMPLOYEE_BOOK_WITHHELD = ("SSN#", "SSN (Last 4)", "Password", "Login", "DL #", "DD ID")
# the recruiters' book (RECRUIT_BOOK_ID): its tabs beside the two houses the book's pass keeps (Talent Pipeline,
# Onboarding Checklist), all edited in the Recruiters' Book app — the master's alone until App Control releases it
RECRUITERS_APP = "app_recruiters_book"
# a whole app Settings › My Work keeps to the master: its switch hides it from everyone else, released or not
HIDDEN_APPS = {RECRUITERS_APP: "recruiters_book"}
RECRUIT_BOOK_TABS = ("Archive of Onboarding Checklist", "Resume Analysis", "Phone Screen Analysis",
                     "Phone Interview Script", "Text Messages", "Dashboard", "Documents Uploaded")
# the division's task lists (DIVISION_TASKS_ID), one tab a person, shown and edited in the Directors app's task pages:
# App Control's directors.tasks control opens them (src/lib/featureAccess.ts), the master's alone until released
DIVISION_TASKS_FEATURE = "directors.tasks"
DIVISION_TASKS_TABS = ("Britt", "Cassy", "Nat", "Regina", "Tammy", "Tieara", "Monthly Doc-Review", "Notes")
# the house repair book (ESTATE_REPAIRS_ID: the form's Repairs and the House Inventory List), kept here and followed
# hourly; House Repair's manage pages edit it behind App Control's house-repair.manage control (the estate mirrors
# workOrders and houseInventory read the same tables)
HOUSE_REPAIR_FEATURE = "house-repair.manage"
# the staff documents forms' responses (the Staff Documentation Portal, STAFF_DOCS_SHEET_ID, read by Staff Docs, Staff
# Comms and Onboarding; Upload Documents, UPLOAD_DOCS_ID), kept here and followed hourly as the forms keep filing
STAFF_DOCS_WITHHELD = ("Drivers License #",)
# the Employee HR Tracker (ESTATE_HR_ID, Master), kept here and followed hourly: Staff Issues and Performance read it,
# Staff Issues' manage page edits it behind App Control's staffissues.manage control
STAFF_ISSUES_FEATURE = "staffissues.manage"
# the Missing Medications book (HUB_MISSING_MEDS_SHEET_ID), every tab, kept here and followed hourly as its forms file:
# client_meds and client_rename read it; Medications' missing-meds pages edit it behind medications.missing
MISSING_MEDS_FEATURE = "medications.missing"
MISSING_MEDS_TABS = ("Form Responses 4", "Form Responses 1", "Low Refills", "Medication Control", "Drs & Meds",
                     "Dr Contacts", "Abnormal Deliveries")
# the In-Person Screening Notes form (SCREENING_NOTES_ID): the interviewers' scorecards, kept here and swept; worked in the
# Interviews app's screening notes page behind interviews.screening-notes
SCREENING_NOTES_FEATURE = "interviews.screening-notes"
# the Voice Bot's employee support structure (VOICE_BOT_ID): its knowledge, rules, follow-ups and directories, kept here
# and swept; worked in the Hotline app's voice bot pages behind hotline.voice-bot
VOICE_BOT_FEATURE = "hotline.voice-bot"
# the company's credentials list (CREDENTIALS_BOOK_ID, "Change of Address"): the master's Credentials app alone — no badge
# and no App Control row opens it (sheet_resources.gate's master_only); its usernames, passwords and password manager
# keep the copy's markers, never read from Google
CREDENTIALS_APP = "credentials"
CREDENTIALS_WITHHELD = ("Username", "Password", "Password Mgr.")
# the books living-brain wrote to Google until 10-27, now the platform's alone and never swept (the operator: "precisam
# estar só na plataforma"): their Google history kept in houses of their own with every other copied book
# (tools/upload-copied-books.py named them); Python collects each into Postgres — the test messages into
# app.comm_mock / app.comm_rehearsal (comm_logs), the full punches into this house (psi_punches_writes), the
# collector's records into app.psi_store
LIVING_BRAIN_BOOKS = {"COMM_REHEARSAL_BOOK_ID": ("bk172eYxCommRehearsal", "comm_rehearsal"),
                      "COMM_MOCK_BOOK_ID": ("bk1M9nxXCommMock", "comm_mock"),
                      "PSI_PUNCHES_FULL_BOOK_ID": ("bk1ttZRJPsiPunchesFull", "psi_punches_full")}
# the last books people still touched in Google (10-27), kept here and swept, read by their readers alone (no page:
# one or two edits a month, their forms still filing): the crisis training quiz's and the outings' RSVP responses, the
# old intranet's common data (the house registry's policies read from it), the old talent app's data, the MyLife OS
# system registry and a daily schedule — by the prop that names each book, its houses' prefix and its tabs
SWEPT_BOOKS: dict[str, tuple[str, tuple[str, ...]]] = {
    "ABD_CRISIS_TRAINING_ID": ("abdTraining", ("Form Responses 1",)),
    "RSVP_FORM_ID": ("rsvp", ("Bowling 10/25", "Movie Night 10/18")),
    "DAILY_SCHEDULE_ID": ("dailySchedule", ("Daily schedule",)),
    "HUB_COMMON_DATA_SHEET_ID": ("intranet", (
        "ABD Emergency Contact", "AccessRequests", "Announcements", "Clients", "Company Policies", "Employee",
        "Employee Calendars", "EmployeePhotos", "Events", "Homes", "Homes Calendars", "HR Tracker", "Login", "News",
        "Reference Links", "Suggestions")),
    "TALENT_APP_DATA_ID": ("talentApp", (
        "ActivityLog", "Candidates", "CJIS Exclusions", "InPerson", "InterviewSlots", "Onboarding", "Outreach",
        "PhoneScreen", "PhoneScreenAgents", "PhoneScreenPrompt", "ResumeAnalysis", "SmsLog", "StageConfig",
        "StatusHistory", "_TriggerAudit", "Users")),
    "MYLIFE_OS_REGISTRY_ID": ("mlos", (
        "AbilityRegistry", "AccessScopes", "ActionExecutionBindings", "ActionRegistry", "ActionResourceBindings",
        "AuthPolicies", "case_types", "change_queue", "channel_registry", "config_allowed_users",
        "config_bot_credentials", "config_comm_policies", "config_domains", "config_engine_settings",
        "config_permissions", "config_profiles", "config_prompts", "document_classes", "domain_registry",
        "EndpointResources", "entity_ownership", "event_catalog", "fact_types", "FieldSchemaRegistry",
        "governance_decisions", "governance_write_policy", "IntentRegistry", "journey_definitions", "LaunchContracts",
        "ModuleRegistry", "PromptLibrary", "registry_routing", "relationship_policies", "RendererRegistrations",
        "TriggerRegistry", "workflow_definitions")),
}
# the Asa Client Database: its four tabs, uploaded with the copied books (tools/upload-copied-books.py) into houses only
# its readers reach (HubDb.tab: clients, client_sources, client_writes, ssa), never served as a resource; swept three
# times a day for the clients still added there (the operator, 2026-10-28) — the book its prop names, else the one its
# readers fall back to
CLIENT_DB_PROP, CLIENT_DB_FALLBACK = "HUB_CLIENT_DB_SHEET_ID", "1fTi78ztKDiK3hvYLbI2IQ1TeSrzVLceK5LyXJ4BVPe8"
CLIENT_DB_HOUSES = {"bk1fTi78Master": "Master", "bk1fTi78ArchiveOldClients": "Archive - Old Clients",
                    "bk1fTi78FinancialInfo": "Financial Info", "bk1fTi78Sheet6": "Sheet6"}
VOICE_BOT_TABS = ("Category Knowledge", "Policies", "General Rules", "Sub -Process", "Category Map",
                  "Follow Ups - Main", "Follow Ups - Incidents", "Homes", "Client Names", "Staff Names", "Schedule")

# RESOURCES (Main.gs) for the resources served here: the tab they were uploaded from, whether a client reads them
# whole (clientOpen) or their own rows (clientScoped), the board's employees-only line, the widget bank's curators, and
# the declared completion stamps (stampWhen: field, value, stamp, clearOnLeave)
SPECS: dict[str, dict[str, Any]] = {
    "teamTasks": {"tab": "team_tasks", "employees": True,
                  "stamps": (("column", "done", "completedAt", True), ("column", "cancelled", "cancelledAt", True))},
    "projectWorkItems": {"tab": "project_work_items"},
    "activity": {"tab": "activity", "client_open": True},
    "widgets": {"tab": "widgets", "client_open": True, "curated": True},
    "photos": {"tab": "photos", "client_scoped": True},
    "reminders": {"tab": "reminders", "employees": "Reminders are for employees.",
                  "stamps": (("status", "done", "completedAt", True),)},
    # a personal board: every row its owner's alone (ownedBy, then ownerFallback), whatever the role
    "sheetTasks": {"tab": "sheet_tasks", "owned": ("ownerId", "assigneeId"), "client_open": True,
                   "stamps": (("column", "done", "completedAt", True),)},
    # Academy's lessons
    "videos": {"tab": "videos"},
    # MAR: the medication passes — a clinical tab (HUB_CLINICAL_TABS), a client reading only the rows that name them
    "marEntries": {"tab": "mar_entries", "client_scoped": True, "clinical": True},
    # Med Deliveries: the deliveries record, the same clinical rule (its tab may not exist yet: it starts empty)
    "medDeliveries": {"tab": "med_deliveries", "client_scoped": True, "clinical": True},
    # Expenses: the expense reports (its tab may not exist yet: it starts empty)
    "expenseReports": {"tab": "expenseReports"},
    # Audits & Compliance, Equipment & Assets (the apps workbook) and Billing & Payers' claims (the care workbook, a
    # client reading the claims that name them); each tab may not exist yet, so each can start empty
    "audits": {"tab": "audits"},
    "equipment": {"tab": "equipment"},
    "billingClaims": {"tab": "billing_claims", "client_scoped": True},
    # the client ledger, read by the Leadership Dashboard off the copy (app/leadership.py; Finance writes it)
    "financeTransactions": {"tab": "finance_transactions", "client_scoped": True},
    # Policies (app/policies.py): the policies' sections and the contact list, written by the import alone, and the
    # read receipts every document's Reader files
    "policies": {"tab": "policies", "no_client": "The policies are internal to the company."},
    "contactLists": {"tab": "contactLists", "employees": "The contact list is for employees."},
    "policyAcks": {"tab": "policyAcks"},
    # the Family Portal's letters home (a clinical tab): a client reads the letters that name them, a trainee none
    "careDocs": {"tab": "care_docs", "client_scoped": True, "clinical": True},
    # the Medications app: the eMAR medication list (a clinical tab) and the medicine catalogue
    "medications": {"tab": "medications", "client_scoped": True, "clinical": True},
    "medCatalog": {"tab": "med_catalog"},
    # Client Finances (app/finance.py): the month balances its close writes (their own resource: finance_balances holds
    # the older on-file balances Clients reads, a card cell withheld), and the TrueLink sync's runs
    "financeMonthBalances": {"tab": "finance_month_balances", "client_scoped": True},
    "truelinkRuns": {"tab": "truelink_runs"},
    # Med Delegation's flows: read-only to the generic verbs (readOnly), its own doors write them
    "medDelFlows": {"tab": "meddel_flows", "read_only": True},
    # IST Records: the training owed (its date stamped as it is done, cleared as it goes back) and the house map,
    # admins' and managers' alone whatever screen asks
    "istRecords": {"tab": "ist_records", "client_scoped": True, "admins": "The IST records are for admins and managers.",
                   "stamps": (("status", "done", "trainedAt", True),)},
    "istHouses": {"tab": "ist_houses", "client_scoped": True, "admins": "The IST records are for admins and managers."},
    # My asa.'s week: every item its owner's alone
    "weekItems": {"tab": "week_items", "owned": ("ownerId", ""), "client_open": True},
    # the ISP Library: every client's plan for staff and above, a client their own; each plan's sections, cut by the
    # intake (isp_intake) and read by Clients
    "isps": {"tab": "isps", "client_scoped": True},
    "ispSections": {"tab": "isp_sections", "client_scoped": True},
    # the guardians the plans name, read by the model (app/client_care_sweeps.py): written by its sweep alone
    "ispContacts": {"tab": "isp_contacts", "read_only": True},
    # the opt-out list and the inbound log (app/opt_outs*.py): written by their own doors, never the generic verbs
    "entityOptOuts": {"tab": "entity_opt_outs", "read_only": True,
                      "admins": "The opt-out list is for admins and managers."},
    "entityInboundMessages": {"tab": "entity_inbound_messages", "read_only": True,
                              "admins": "The inbound messages are for admins and managers."},
    # Business Travel's trips (app/travel*.py): its own doors gate their screen; route() gates no role on the rows
    "travelTrips": {"tab": "travel_trips"},
    # the Meal tracker's log and goals (app/meals*.py), each person's own
    "mealLog": {"tab": "meal_log", "owned": ("ownerId", ""), "client_open": True},
    "mealProfile": {"tab": "meal_profile", "owned": ("ownerId", ""), "client_open": True},
    # Smart Shopper's watch list and its prices (app/shopper*.py), each person's own
    "shopperItems": {"tab": "shopper_items", "owned": ("ownerId", ""), "client_open": True},
    "shopperPrices": {"tab": "shopper_prices", "owned": ("ownerId", ""), "client_open": True},
    # the Inventory's supply documents added by hand (app/inventory*.py)
    "inventorySuppliesManual": {"tab": "inventory_supplies_manual"},
    # Books: the shelf (the generic verbs) and each book's stored text, written by its own doors alone (app/books*.py)
    "books": {"tab": "books"},
    # the Docs library (app/docs.py, app/docs_writes.py, app/docs_import.py): its own doors gate the writes
    "documents": {"tab": "documents"},
    # Forms (app/forms*.py, app/form_file_store.py): the forms, their submissions and answers, the files' ledger the
    # decoder reads (digest_lab), and the uploads' asset trail
    "forms": {"tab": "forms", "admins": "These are for admins and managers."},
    "formSubmissions": {"tab": "form_submissions", "admins": "These are for admins and managers."},
    "formAnswers": {"tab": "form_answers"},
    "formFiles": {"tab": "form_files", "admins": "These are for admins and managers."},
    "assetEvents": {"tab": "asset_events", "read_only": True},
    # the onboarding documents' catalog Files and Hiring read (candidates.doc_catalog_rows)
    "documentCatalog": {"tab": "document_catalog", "read_only": True},
    # Scheduling's settings (a row per key), its change log and the Builder's drafts (house_tables: read and written
    # there by scheduling, scheduling_builder, scheduling_flows and staff_perf)
    "schedSettings": {"tab": "sched_settings", "read_only": True},
    "schedLog": {"tab": "sched_log", "read_only": True},
    "schedDrafts": {"tab": "sched_drafts", "read_only": True},
    # the board itself: its cells, its rows, its flows and its inbox (the same readers and the board's Plan; My Work
    # and My Inbox read the inbox through my_work.HubBooks)
    "schedCells": {"tab": "sched_cells", "read_only": True},
    "schedRows": {"tab": "sched_rows", "read_only": True},
    "schedFlows": {"tab": "sched_flows", "read_only": True},
    "schedInbox": {"tab": "sched_inbox", "read_only": True},
    # Transportation's vehicles, trips, inbox, log and settings (house_tables: transportation_writes, _flows, _setup)
    "vcVehicles": {"tab": "vc_vehicles", "read_only": True},
    "vcTrips": {"tab": "vc_trips", "read_only": True},
    "vcInbox": {"tab": "vc_inbox", "read_only": True},
    "vcLog": {"tab": "vc_log", "read_only": True},
    "vcSettings": {"tab": "vc_settings", "read_only": True},
    # the hotline sweep's orders, key/value (hotline.config, hotline_calls._read_config, hotlineConfigSet)
    "hotlineConfig": {"tab": "hotline_config", "read_only": True},
    # the Smart Comms ledger, Sendings: every line written by smart_comms (_note_ledger, record_ledger), read by the
    # trail, the clock, Comm Repair, Flow Control and the calendar
    "smartCommsActivity": {"tab": "smart_comms_sent", "read_only": True},
    # Kinds: each person's type and the People folds signed on it (staff._merge_map, people_merge.pending,
    # users_merge_apply.Types)
    "peopleTypes": {"tab": "people_types", "read_only": True},
    # the Directory's directors (directors.normalized; directorsCreate/Update/Delete in generic_rows_writes)
    "directors": {"tab": "directors", "read_only": True},
    # the compliance papers' ledger (staff.uploads, staff_comms._uploads, cert_docs; the worker's paper reader reads it
    # through app.cert_uploads_ledger)
    "certUploads": {"tab": "cert_uploads", "read_only": True},
    # the configuration catalogue, AlertsCatalog: which keys exist and what each means (alerts_config and the hide
    # defaults of config_lane, my_work, ssa, support_desk, scheduling, my_calendar_writes)
    "hiringAlertsCatalog": {"tab": "hiring_alerts_catalog", "read_only": True},
    # every candidate's stage moves, LogStatusHistory (candidates.status_rows and read_tab, screening; written by
    # candidate_writes.status_record; My Inbox through my_work.HubBooks)
    "logStatusHistory": {"tab": "log_status_history", "read_only": True},
    # who was told of an app's release before Python told anyone (app_release.told, beside app.app_release_told)
    "appReleaseLog": {"tab": "app_release_log", "read_only": True},
    # Learning's competencies and each person's attempts (learning.rows; learnAttempt, learnSkillSave)
    "learnSkills": {"tab": "learn_skills"},
    "learnAttempts": {"tab": "learn_attempts", "owned": ("ownerId", "")},
    # the shared finance settings Finance, Recon, Learning and Med Delegation read (finSettingsSet, Recon's settings)
    "financeConfig": {"tab": "finance_config"},
    # Smart Comms' situations, the Desk's catalogue (smart_comms.read_situations and seed, the Desk's reads,
    # smartCommsSet, the gates)
    "smartCommsDesk": {"tab": "smart_comms", "read_only": True},
    # the Smart Comms lane's record: each thread, the items it carries, the trail, the replies (read through
    # smart_comms_desk.house_where and house_rows; every writer's kept records laid on the table by writes.into_tables)
    "commIntents": {"tab": "comm_intents", "read_only": True, "admins": "These are for admins and managers."},
    "commBindings": {"tab": "comm_bindings", "read_only": True, "admins": "These are for admins and managers."},
    "commObservations": {"tab": "comm_observations", "read_only": True,
                         "admins": "These are for admins and managers."},
    "commContributions": {"tab": "comm_contributions", "read_only": True,
                          "admins": "These are for admins and managers."},
    # Support Requests' events, verdicts and items (support_desk.read_house, support_desk_writes.tab_rows; every
    # writer's kept records laid on the table by writes.into_tables; My Work and My Inbox read the items through
    # my_work.HubBooks)
    "supportEvents": {"tab": "support_events", "read_only": True, "admins": "These are for admins and managers."},
    "supportDecisions": {"tab": "support_decisions", "read_only": True,
                         "admins": "These are for admins and managers."},
    "supportInbox": {"tab": "support_inbox", "read_only": True, "admins": "These are for admins and managers."},
    # the hotline's processing log and its call-off queue (hotline, hotline_file, hotline_calls through the tab door,
    # smart_clock through candidates.read_tab; the filing pass's kept records laid on the table by writes.into_tables)
    "hotlineLog": {"tab": "hotline_log", "read_only": True, "admins": "These are for admins and managers."},
    "hotlineCalloffQueue": {"tab": "hotline_calloff_queue", "read_only": True,
                            "admins": "These are for admins and managers."},
    # the sidebar's sections and placement, and each person's preferences (app_control.tab_rows, prefs_doors; the
    # shelf's save rewrites its two tables whole, prefsSet and the release stamp change a person's last row)
    "appSections": {"tab": "app_sections", "read_only": True},
    "appPlacement": {"tab": "app_placement", "read_only": True},
    "userPrefs": {"tab": "user_prefs", "read_only": True, "owned": ("user_id", "")},
    # the Call Offs house (call_offs.rows, the screen's and the hotline's writers' kept records; My Work's lane through
    # my_work.HubBooks), the appraisals Staff › Performance keeps (staff_perf._perf_rows; performance.ai_keep)
    "callOffsHouse": {"tab": "callOffs", "read_only": True, "admins": "These are for admins and managers."},
    "perfAi": {"tab": "perf_ai", "read_only": True, "admins": "These are for admins and managers."},
    # the lane mirrors' houses, each the newest rows of its estate book (lane_mirror rewrites each one whole there;
    # My Work's lanes through my_work.HubBooks, the call-off form sweep through smart_comms_desk.house_where)
    "laneUiIncidents": {"tab": "uiIncidents", "read_only": True, "admins": "These are for admins and managers."},
    "laneSupportQueue": {"tab": "supportQueue", "read_only": True, "admins": "These are for admins and managers."},
    "laneDailyNotes": {"tab": "dailyNotes", "read_only": True, "admins": "These are for admins and managers."},
    "laneCloneCallOffs": {"tab": "cloneCallOffs", "read_only": True,
                          "admins": "These are for admins and managers."},
    # the People house (reads.hub_rows and staff._people; Houses, the guardians' roster, the contacts sync and
    # peopleUpdate read its table; their kept records laid there by writes.into_tables)
    "peopleHouse": {"tab": "people", "read_only": True, "admins": "These are for admins and managers."},
    # the suggestion box's helpful contacts (ops_stragglers; made and taken out there), the mail ledger (mail_log,
    # the SSA's mail through staff_comms._tab) and the staff profile's visits (staff.own_rows; the rename rekeys them)
    "helpfulContactsHouse": {"tab": "helpful_contacts", "read_only": True,
                             "admins": "These are for admins and managers."},
    # every platform mailbox's envelopes and previews: the master's alone, as the mail itself is
    "mailLog": {"tab": "mail", "read_only": True, "master_only": True},
    "staffProfileVisits": {"tab": "staff_profile_visits", "read_only": True,
                           "admins": "These are for admins and managers."},
    # the comms mirror's calls retired by hand, its summaries and its transcripts (screening, phone_screens,
    # user_profiles, hiring_sim_writes and line_directory through house_tables.tab_of; screening_writes' mirror and the
    # retirements kept records laid there by writes.into_tables)
    "commsIgnoredCalls": {"tab": "ignored_calls", "read_only": True, "admins": "These are for admins and managers."},
    "commsSummaries": {"tab": "summaries", "read_only": True, "admins": "These are for admins and managers."},
    "commsTranscripts": {"tab": "transcripts", "read_only": True, "admins": "These are for admins and managers."},
    # the events trail, in a table of its own (resource_rows.OWN_TABLES, db/events_table.sql): the events page's newest
    # window, a profile's activity by its subject, the onboarding calendar's notes; compliance's events laid there by
    # writes.into_tables
    "eventTrail": {"tab": "events", "read_only": True, "admins": "These are for admins and managers."},
    # the generic configuration book, every tab (its words, steps, prompts, digest vocabulary, bindings, request types
    # and the rest): named with its book, since other books share these tab names (house_tables.tab_of and book_tab
    # read them there; its writers' kept records laid there by writes.into_tables)
    **{"gc" + "".join(w[:1].upper() + w[1:] for w in tab.split()): {
        "tab": tab, "book": "HUB_GENERIC_CONFIG_ID", "read_only": True, "admins": "These are for admins and managers."}
       for tab in ("CommRequestTypes", "Condition Posts", "Conditions", "Contacts Institutional", "Contacts Roles",
                   "Contacts Statuses", "Decision Posts", "Digest Answer Facts", "Digest Categories",
                   "Digest Credentials", "Digest Drawers", "Digest Expects", "Digest Issuers", "Digest Kinds",
                   "Digest Labels", "Digest Proposals", "Digest Review", "Digest Settings", "Digest Zip", "Event Posts",
                   "Facts", "Flow Bindings", "Form File Types", "Message Posts", "Prompts", "Smart AI Requests",
                   "Smart Comms", "Smart Header", "Smart Letters", "Smart Mailbox Events", "Smart Situations", "Steps",
                   "Strings", "Subjects")},
    # App Control's access matrices (Reads.app_rules, the lane gate, the board, the release, the hotline gate, the
    # bang's access and My Inbox; App Control's save lays its kept records there, a whole rewrite there too) and the
    # App Builder's registries (app_builder.view; its row ops laid on the tables at once)
    "appBadgeAccess": {"tab": "app_badge_access", "read_only": True, "admins": "These are for admins and managers."},
    "appTenantAccess": {"tab": "app_tenant_access", "read_only": True,
                        "admins": "These are for admins and managers."},
    "configBadgeAccess": {"tab": "config_badge_access", "read_only": True,
                          "admins": "These are for admins and managers."},
    "hubApps": {"tab": "apps", "read_only": True, "admins": "These are for admins and managers."},
    "hubAppBuilder": {"tab": "app_builder", "read_only": True, "admins": "These are for admins and managers."},
    "hubResources": {"tab": "hub_resources", "read_only": True, "admins": "These are for admins and managers."},
    # the accounts (Reads.users and every reader on it, My Work's and My Profile's account reads, the lanes' and the
    # tab door's by id; the sign-in's cells, the invitation's register, the users doors' edits and removal there)
    "usersHouse": {"tab": "users", "read_only": True, "admins": "These are for admins and managers."},
    # the places — one, headquarters (the envelope's, the studio's and the door gate's reads; the studio's upsert and
    # the tenant workbook's pointer laid there)
    "tenants": {"tab": "tenants", "read_only": True, "admins": "These are for admins and managers."},
    # the depot's Facts (the props, the switchboard, the house pointers, the dissolved hiring tabs, the config), in a
    # table of its own (db/depot_facts_table.sql): hubdb reads it for facts(), tab(), rows() and from_sql(), which
    # shapes it as the copy's table for every statement written against that
    "depotFacts": {"tab": "Facts", "book": "ESSENCIAL", "read_only": True,
                   "admins": "These are for admins and managers."},
    # the depot's own tabs but its Facts (the Registry candidates' and the flow's book reader reads, the Condition
    # Instances the engine snapshots, the Events the journey dual-writes; the rest no reader opens): named with the
    # depot, as other books share these names
    **{"ess" + "".join(w[:1].upper() + w[1:] for w in tab.split()): {
        "tab": tab, "book": "ESSENCIAL", "read_only": True, "admins": "These are for admins and managers."}
       for tab in ("Action Attempts", "Condition Instances", "Documents", "Events", "Flow Instances", "Registry",
                   "Rounds", "Subjects")},
    # the client entities book, every tab (the house registry Reads.homes, house_save, Houses, the roster's house
    # directory and the fill tool read; the others no reader opens): named with its book, as other books share names
    **{"ent" + "".join(w[:1].upper() + w[1:] for w in tab.split("_")[1:]): {
        "tab": tab, "book": "HUB_CLIENT_ENTITIES_SHEET_ID", "read_only": True,
        "admins": "These are for admins and managers."}
       for tab in ("entity_appointments", "entity_clients", "entity_daily_notes", "entity_homes", "entity_incidents",
                   "entity_isp", "entity_physicians", "entity_referrals")},
    # the Asa Employee Database (CERT_SOURCE_ID), every tab: the Master (Staff, Emp360, Compliance, the certificate
    # papers, the hiring fill, My Profile's address), the drivers' tabs (Transportation), the MAIS and trainings
    # certificates (IST, Med Del), the old employees; named with its book, as other books share these names
    **{"emp" + "".join(w[:1].upper() + w[1:] for w in re.split(r"[^A-Za-z0-9]+", tab) if w): {
        "tab": tab, "book": "CERT_SOURCE_ID", "read_only": True, "admins": "These are for admins and managers."}
       for tab in EMPLOYEE_BOOK_TABS},
    # every paper in the clients' Drive folders (clients.client_files, client_meds, the Funds folder, the decoder
    # ledger; the worker's digest and MARS lanes through the tab door)
    "clientFiles": {"tab": "client_files", "client_scoped": True, "clinical": True},
    # the Quo inbox's books, each in a table of its own (resource_rows.OWN_TABLES): every call's transcript, every text,
    # every call's summary (quo_writes.Filer; staff_comms, SSA, Family and Candidates through staff_comms._project)
    "quoTranscripts": {"tab": "quo_transcripts", "admins": "These are for admins and managers."},
    "quoMessages": {"tab": "quo_messages", "admins": "These are for admins and managers."},
    "quoSummaries": {"tab": "quo_summaries", "admins": "These are for admins and managers."},
    # the on-file balances Clients' Funds reads; a card is kept by the last four the copy kept of it (DERIVE)
    "financeBalances": {"tab": "finance_balances", "client_scoped": True},
    "booksText": {"tab": "books_text", "read_only": True},
    # the cortex's routes and the window each person may be asked in (app/comm_routes*.py, app/comm_when*.py):
    # written by the relay's hand-offs alone, never the generic verbs
    "commRoutesHouse": {"tab": "comm_routes", "read_only": True},
    # route() names it commWhen (said)
    "commWhenHouse": {"tab": "comm_when", "read_only": True, "said": "commWhen"},
    # the recruiters' book's two houses (app/comm_recruit*.py), edited in the Recruiters' Book app: the book's pass
    # follows the sheet for every row nobody changed in the Hub (comm_recruit_writes._rewrite)
    "recruitPipeline": {"tab": "recruit_pipeline", "app": RECRUITERS_APP},
    "recruitOnboarding": {"tab": "recruit_onboarding", "app": RECRUITERS_APP},
    # the recruiters' book's other tabs, kept here and followed hourly (app/followed_books.py), edited in the same
    # app: named with its book, as other books share these names
    **{"rb" + "".join(w[:1].upper() + w[1:] for w in re.split(r"[^A-Za-z0-9]+", tab) if w): {
        "tab": tab, "book": "RECRUIT_BOOK_ID", "app": RECRUITERS_APP} for tab in RECRUIT_BOOK_TABS},
    # the division's task lists, every tab, followed hourly and edited in the Directors app's task pages
    **{"dt" + "".join(w[:1].upper() + w[1:] for w in re.split(r"[^A-Za-z0-9]+", tab) if w): {
        "tab": tab, "book": "DIVISION_TASKS_ID", "app": DIVISION_TASKS_FEATURE} for tab in DIVISION_TASKS_TABS},
    "repairRequests": {"tab": "Repairs", "book": "ESTATE_REPAIRS_ID", "app": HOUSE_REPAIR_FEATURE},
    "repairInventory": {"tab": "House Inventory List", "book": "ESTATE_REPAIRS_ID", "app": HOUSE_REPAIR_FEATURE},
    "staffDocsForm": {"tab": "Responses", "book": "STAFF_DOCS_SHEET_ID", "read_only": True,
                      "admins": "These are for admins and managers."},
    "hrTracker": {"tab": "Master", "book": "ESTATE_HR_ID", "app": STAFF_ISSUES_FEATURE},
    "screeningNotes": {"tab": "Form Responses 1", "book": "SCREENING_NOTES_ID", "app": SCREENING_NOTES_FEATURE},
    **{res: {"tab": tab, "book": prop, "read_only": True, "admins": "These are for admins and managers."}
       for prop, (res, tab) in LIVING_BRAIN_BOOKS.items()},
    "credentials": {"tab": "Change of Address", "book": "CREDENTIALS_BOOK_ID", "app": CREDENTIALS_APP,
                    "master_only": True},
    **{"vb" + "".join(w[:1].upper() + w[1:] for w in re.split(r"[^A-Za-z0-9]+", tab) if w): {
        "tab": tab, "book": "VOICE_BOT_ID", "app": VOICE_BOT_FEATURE} for tab in VOICE_BOT_TABS},
    **{pre + "".join(w[:1].upper() + w[1:] for w in re.split(r"[^A-Za-z0-9]+", tab) if w): {
        "tab": tab, "book": prop, "read_only": True, "admins": "These are for admins and managers."}
       for prop, (pre, tabs) in SWEPT_BOOKS.items() for tab in tabs},
    **{"mm" + "".join(w[:1].upper() + w[1:] for w in re.split(r"[^A-Za-z0-9]+", tab) if w): {
        "tab": tab, "book": "HUB_MISSING_MEDS_SHEET_ID", "app": MISSING_MEDS_FEATURE} for tab in MISSING_MEDS_TABS},
    "uploadDocsForm": {"tab": "Form Responses 1", "book": "UPLOAD_DOCS_ID", "read_only": True,
                       "admins": "These are for admins and managers."},
    # the phone-call lane's calls and the matters they raised (app/comm_calls*.py): its own doors' alone
    "commCalls": {"tab": "comm_calls", "read_only": True},
    "commWorkItems": {"tab": "comm_work_items", "read_only": True},
    # Compliance's review verdicts (app/compliance*.py): its own door's alone
    "complianceReviews": {"tab": "compliance_reviews", "read_only": True,
                          "admins": "The compliance reviews are for admins and managers."},
    # Potential Clients: the referrals pipeline, read through its own doors (app/potential_clients.py) by whoever App
    # Control's Client Candidates row opens it to
    "potentialClients": {"tab": "potentialClients"},
    # Shift Board: the Week page's own events (Main.gs RESOURCES.events wrote the engine's trail tab, which carries no
    # date: the resource starts empty)
    "scheduleEvents": {"tab": "schedule_events"},
    # Time Reconciliation: the punches imported, the runs and each run's errors (route() names them by their tabs) —
    # behind its own gate whatever door asks ("recon": app/recon.py generic_refused), since they name staff and clients
    "timePunches": {"tab": "time_punches", "said": "time_punches", "recon": True},
    "reconRuns": {"tab": "recon_runs", "said": "recon_runs", "recon": True},
    "reconErrors": {"tab": "recon_errors", "said": "recon_errors", "recon": True},
    # Visits & EVV: the visit log (the care workbook), a client reading the visits that name them; its tab may not
    # exist yet, so it can start empty
    "visits": {"tab": "visits", "client_scoped": True},
    # Onboarding: the DODD and CPR papers a new hire uploads, as Staff reads them, and each finished visit's report
    # (its tab never existed in the book: it starts empty)
    "staffClearance": {"tab": "staff_clearance"},
    "onboardingReports": {"tab": "onboarding_reports"},
    # Talent Pipeline's authorization asks and the replies already judged, and the Lead Scraper's settings: written by
    # their own doors alone (app/talent_pipeline_writes.py, app/talent_scraper_writes.py)
    "tpAuthorizations": {"tab": "tp_authorizations", "read_only": True,
                         "admins": "The authorization asks are for admins and managers."},
    "tpAuthAi": {"tab": "tp_auth_ai", "read_only": True, "admins": "The authorization replies are for admins and managers."},
    "scraperConfig": {"tab": "scraper_config", "read_only": True,
                      "admins": "The scraper's settings are for admins and managers."},
    # Behavior's signals and readings, and the PSI punches the relay hands in: written by their own doors alone
    # (app/behavior_writes.py, app/psi_punches_writes.py), never through the generic verbs
    "behaviorSignals": {"tab": "behavior_signals", "read_only": True},
    "behaviorReadings": {"tab": "behavior_readings", "read_only": True},
    "psiPunches": {"tab": "psi_punches", "read_only": True},
    # the Task Board: a personal board, every card its owner's alone (ownedBy, then ownerFallback)
    "tasks": {"tab": "tasks", "owned": ("ownerId", "assigneeId"), "client_open": True,
              "stamps": (("column", "done", "completedAt", True),)},
    # the last of route()'s own tabs, nobody's in Python but these verbs': each uploaded from its tab (one the book does
    # not hold starts empty)
    "diseases": {"tab": "diseases"},
    "projects": {"tab": "projects"},
    "teamProjects": {"tab": "team_projects", "employees": True},
    "leads": {"tab": "leads"},
    "inventoryItems": {"tab": "inventoryItems"},
    "fleetVehicles": {"tab": "fleetVehicles"},
    "mileageLogs": {"tab": "mileageLogs"},
    "routes": {"tab": "routes"},
    "mealPlans": {"tab": "mealPlans", "client_scoped": True},
    "clientNotes": {"tab": "client_notes", "client_scoped": True},
    "marErrors": {"tab": "mar_errors", "client_scoped": True},
    "missingMedications": {"tab": "missing_medications", "client_scoped": True},
    "incidents": {"tab": "incidents", "client_scoped": True, "clinical": True},
    # the roster's Hub tabs (their slices are the relay's own, shaped from the calendars): a client reads the rows
    # whose house code carries their street number (clientByHouse)
    "shifts": {"tab": "shifts", "client_scoped": True, "by_house": ("houseCode", "house", "houseId", "houseName")},
    "shiftCards": {"tab": "shiftCards"},
    "shiftMatrix": {"tab": "shiftMatrix", "client_scoped": True,
                    "by_house": ("houseId", "houseName", "house", "houseCode")},
    "shiftTimeline": {"tab": "shiftTimeline", "client_scoped": True,
                      "by_house": ("houseCode", "houseId", "houseName", "house")},
}
# RESOURCES (Main.gs) whose record is their sheet's copy with Python's kept edits laid (their own apps' writers keep
# app.edits there, never these tables): the same gates, the rows read and written by app/generic_rows*.py
COPY: dict[str, dict[str, Any]] = {}

_KEPT_LAST4 = re.compile(r"\s*\[withheld: [a-z]+\] kept: (\d{4}|on file|none)\s*")


def kept_last4(cells: dict) -> str:
    """A card cell the copy withholds, as the upload keeps it: the last four the copy kept of it, in words so no read
    takes them for a number (a leading zero kept), else nothing. The whole number is never the Hub's."""
    m = _KEPT_LAST4.fullmatch(cells.get("debit_card") or "")
    return "ending " + m.group(1) if m and m.group(1).isdigit() else ""


def left_behind(_cells: dict) -> str:
    """A card cell the copy withholds whole (no last four kept of it): left out of the table. The number is never the
    Hub's."""
    return ""


def cell_token(cells: dict) -> str:
    """A Scheduling cell's token the copy withholds (its column is named like a secret): the code its text
    classifies to, as every writer of a cell makes it."""
    import scheduling as SCH  # noqa: PLC0415 - it imports this module
    c = SCH.classify(cells.get("text"))
    return c.token if c and c.token else ""


def intent_reply_token(cells: dict) -> str:
    """A Smart Comms thread's reply token the copy withholds (its column is named like a secret): the proof a reply
    quotes, made from the thread's intent key as every writer of a thread makes it."""
    import comm_record as CR  # noqa: PLC0415 - it imports this module
    key = gsjs.or_blank(cells.get("intent_key"))
    return CR.reply_token(key) if gsjs.trim(key) else ""


def kept_withheld(column: str) -> Callable[[dict], str]:
    """A cell the copy withholds because its row's key names a secret (a words book's line about a password or a
    key): kept as the copy shows it, its marker, so every reader answers as it did; the words are never read here."""
    return lambda cells: gsjs.or_blank(cells.get(column))


# the cells an upload works out again where the copy withholds them (resource_rows.upload's `derive`), by resource
DERIVE: dict[str, dict[str, Callable[[dict], str]]] = {"financeBalances": {"debit_card": kept_last4},
                                                       "schedCells": {"token": cell_token},
                                                       "commIntents": {"reply_token": intent_reply_token},
                                                       "gcStrings": {"value": kept_withheld("value")},
                                                       "entClients": {"tl_debit_card_number": left_behind,
                                                                      "dc_pin": left_behind},
                                                       # an account's old sheet password: its marker, so "armed" reads
                                                       # as it did; the sign-in's own is app.auth_credentials
                                                       "usersHouse": {"salt": kept_withheld("salt"),
                                                                      "pass_hash": kept_withheld("pass_hash")},
                                                       **{r: {c: kept_withheld(c) for c in EMPLOYEE_BOOK_WITHHELD}
                                                          for r, s in SPECS.items()
                                                          if s.get("book") == "CERT_SOURCE_ID"},
                                                       "staffDocsForm": {c: kept_withheld(c)
                                                                         for c in STAFF_DOCS_WITHHELD},
                                                       "intranetLogin": {c: kept_withheld(c)
                                                                         for c in ("PasswordSalt", "PasswordHash")},
                                                       "mlosModuleRegistry": {"BotSecret": kept_withheld("BotSecret")},
                                                       "credentials": {c: kept_withheld(c) for c in CREDENTIALS_WITHHELD}}
CLINICAL = {"status": 403, "message": "These records are for employees on shift."}
DENIED = {"status": 403, "message": "Requires an admin or manager account"}
EMPLOYEES_ONLY = {"status": 403, "message": "The team board is for employees."}
CURATED = {"status": 403, "message": "The widget bank is curated by admins and managers."}
NO_ID = 'Missing required "id" in payload.'

s_ = gsjs.str_


def spec_of(resource: str) -> dict[str, Any]:
    """The resource's RESOURCES entry, kept in Postgres or read off its copy."""
    return SPECS.get(resource) or COPY[resource]


def said(resource: str) -> str:
    """The name route() says the resource by."""
    return spec_of(resource).get("said", resource)


def rows(reads: L.Reads, resource: str) -> list[dict]:
    """listRows_' rows, from Postgres."""
    return [dict(r) for r in reads.once("sheetres:" + resource, lambda: RR.read_all(reads, resource))]


# the Hub tab each resource was uploaded from, for the apps that read the tab by name
# a house named by its tab alone; one whose tab name other books share names its book too ("book": the prop that
# names it, or ESSENCIAL for the depot) and is found by the book and the tab together (house_tables.resource_in)
TAB_OF = {spec["tab"]: r for r, spec in SPECS.items() if not spec.get("book")}
BOOKED = {r: spec for r, spec in SPECS.items() if spec.get("book")}


def book_of(db: hubdb.HubDb, resource: str) -> str:
    """The book a resource that names its book lives in: the depot, a prop's book, or the book's own id."""
    book = gsjs.or_blank(SPECS[resource].get("book"))
    if book == "ESSENCIAL":
        return hubdb.ESSENCIAL_ID
    return book if re.fullmatch(r"1[A-Za-z0-9_-]{40,}", book) else gsjs.trim(db.prop(book))


def copy_of(db: hubdb.HubDb, resource: str) -> hubdb.Resolved:
    """Where a resource's copy is read: its own book's tab when it names one, else where the router opens its tab —
    the copy itself (hubdb.COPY), never the table it is kept in."""
    spec = SPECS[resource]
    token = hubdb.COPY.set(True)
    try:
        if not spec.get("book"):
            return db.resolve(spec["tab"])
        sid = book_of(db, resource)
        return hubdb.Resolved(sid, (spec["tab"],), db.tab(sid, spec["tab"]) if sid else None, False,
                              bool(sid) and db.book(sid) is not None)
    finally:
        hubdb.COPY.reset(token)


def kept_rows(reads: L.Reads, tab: str) -> list[dict] | None:
    """A Hub tab an app now keeps in Postgres, as readAll_ hands it (the copy's shape) once uploaded; None while the
    sheet's copy holds it."""
    resource = TAB_OF.get(tab)
    if not resource or not reads.once("sheetres_up:" + resource, lambda: RR.uploaded(reads.db, resource)):
        return None
    return rows(reads, resource)


def _client(user: dict) -> bool:
    """A client, or an SSA or a FAMILY whatever its role says (scope.role_counts): its own client's rows alone."""
    return not user.get("is_service") and (s_(user.get("role")) == "client"
                                           or not sc.role_counts(user.get("types"), user.get("role")))


def hidden_app(sess: L.Session, app_id: str) -> bool:
    """Whether Settings › My Work keeps this app to the master: never for the master, and for anyone else while its
    switch hides it (an unread config hides it)."""
    part = HIDDEN_APPS.get(app_id)
    if not part or sc.is_real_master(sess.user):
        return False
    import editions  # noqa: PLC0415 - it reads this module's catalogue
    return editions.hides_for(sess).get(part, True)


def gate(sess: L.Session, resource: str, verb: str) -> dict[str, Any] | None:
    """route()'s gates before the verb: the widget bank is written by its curators, the board is for employees; an
    account homed in a place reads its place's rows, Apps Script's tenant lane."""
    user = sess.user or {}
    spec = spec_of(resource)
    # the master's own app (the credentials list): nobody else, whatever App Control says
    if spec.get("master_only") and not user.get("is_service") and not sc.is_real_master(user):
        return {"status": 403, "message": "This is the master's alone."}
    # one app's own data, or one App Control control's (an app id, or <app>.<control>): its row opens it, the
    # master's alone until then
    # a slice App Control decides by its own rows (slice_gate.OWNERS_ALONE): the generic verbs give the same verdict
    import slice_gate  # noqa: PLC0415 - the front door imports it
    if not user.get("is_service") and said(resource) in slice_gate.OWNERS_ALONE \
            and not slice_gate.opens(sess, said(resource)):
        return {"status": 403, "message": "This is not released to this account in App Control."}
    app_id = spec.get("app")
    if app_id and not user.get("is_service") and not sc.profile_app_gate(
            app_id, user, sess.reads.scope_sources()).get("open"):
        return {"status": 403, "message": "This is not released to this account in App Control."}
    if app_id and not user.get("is_service") and hidden_app(sess, app_id):
        return {"status": 403, "message": "This is not released to this account."}
    # a resource for admins and managers alone (the IST tables): the data's own gate, whatever screen asks
    admins = spec.get("admins")
    if admins and not user.get("is_service") and s_(user.get("role")) not in ("admin", "manager"):
        return {"status": 403, "message": admins}
    # Time Reconciliation's tables: the gate its own doors keep (its readers list and get, its writers write), so the
    # generic verbs are no way around it
    if spec.get("recon") and not user.get("is_service"):
        import recon as R  # noqa: PLC0415 - it imports this module
        refused = R.generic_refused(sess, verb)
        if refused:
            return refused
    # readOnly: no row made or removed by the generic verbs, a row changed only by an admin
    if spec.get("read_only") and verb in ("create", "delete"):
        return {"status": 405, "message": f'Action "{verb}" is not allowed on resource "{said(resource)}" '
                                          "(read/update-only)."}
    if spec.get("read_only") and verb == "update" and s_(user.get("role")) != "admin":
        return DENIED
    # the clinical tabs: a trainee reads none, a client only a resource that is narrowed to their own rows
    if spec.get("clinical") and not user.get("is_service") and (
            s_(user.get("role")) == "onboarding" or (_client(user) and not spec.get("client_scoped"))):
        return CLINICAL
    if spec.get("curated") and not user.get("is_service") and verb not in ("list", "get") and \
            s_(user.get("role")) not in ("admin", "manager"):
        return CURATED
    employees = spec.get("employees")
    if employees and not user.get("is_service") and (_client(user) or s_(user.get("role")) == "onboarding"):
        return {"status": 403, "message": employees} if isinstance(employees, str) else EMPLOYEES_ONLY
    # a resource a trainee reads on day one and a client portal never does
    no_client = spec.get("no_client")
    if no_client and _client(user):
        return {"status": 403, "message": no_client}
    if not user.get("is_service") and not sc.is_real_master(user) and s_(user.get("home_tenant")):
        raise Defer("an account homed away from headquarters reads its place's rows")
    return None


def owner_of(resource: str, row: dict) -> str:
    """hubOwnerOf_: the row's ownedBy cell, else its ownerFallback."""
    owned_by, fallback = spec_of(resource)["owned"]
    return s_(row.get(owned_by)) or (s_(row.get(fallback)) if fallback else "")


def me_of(user: dict) -> str:
    """Whose rows a personal resource shows: the person's own; a service's none."""
    return "" if user.get("is_service") else s_(user.get("id"))


def _owned(sess: L.Session, resource: str, verb: str, payload: dict,
           find: Callable[[str], dict | None] | None = None) -> dict[str, Any] | None:
    """hubOwnedGate_: a create is stamped with its maker, and a row not the caller's is not here — an update may neither
    hand a row on nor take one. `find`: the row an id names, where the rows are not these tables'."""
    if not spec_of(resource).get("owned"):
        return None
    me = me_of(sess.user or {})
    owned_by = spec_of(resource)["owned"][0]
    if not me:
        return None if verb == "list" else {"status": 404, "message": f'No "{said(resource)}" record with id '
                                                                       f'"{s_(payload.get("id"))}".'}
    if verb == "create":
        payload[owned_by] = me
        return None
    if verb in ("get", "update", "delete"):
        rid = s_(payload.get("id"))
        if not rid:
            return None
        if find is not None:
            row = find(rid)
        else:
            hit = _found(sess.reads, resource, rid)
            row = hit[2] if hit is not None else None
        if row is None or owner_of(resource, row) != me:
            return {"status": 404, "message": f'No "{said(resource)}" record with id "{rid}".'}
        if verb == "update":
            payload[owned_by] = me
    return None


def _client_key(user: dict) -> str:
    """hubClientKeyOf_."""
    return s_(user.get("client_key")) if _client(user) else ""


def own_keys(sess: L.Session) -> list[str]:
    """The client keys a client-side reader's rows are cut to: a client its own; an SSA or a FAMILY, whatever its role
    says, the clients its Clients scope holds (the operator's FIX BADGES sheet: only their client)."""
    user = sess.user or {}
    if not _client(user):
        return []
    if sc.role_counts(user.get("types"), user.get("role")):
        key = _client_key(user)
        return [key] if key else []
    import clients as C  # noqa: PLC0415 - the Clients reader, read only for this narrowing
    return sorted(k for k in ((C.reader(sess) or {}).get("keys") or {}) if k)


def _client_names(reads: L.Reads, key: str) -> set[str]:
    """hubClientIdentity_'s names: the key itself and the name the clients' merge spells for it, folded."""
    import clients as C  # noqa: PLC0415 - the merge, read only for a client's own narrowing
    def read() -> set[str]:
        names = {key}
        for c in C.derived(reads):
            if gsjs.trim(gsjs.or_text(c.get("client_key"))) == key:
                n = gsjs.name_key(c.get("name"))
                if n:
                    names.add(n)
        return names
    return reads.once("sheetres:client:" + key, read)


def _their_house(reads: L.Reads, row: dict, key: str, columns: tuple) -> bool:
    """hubRowIsClients_ under clientByHouse: the first of the declared columns that holds a code carries the street
    number of the client's house (hubClientIdentity_'s houses), never matched anywhere else."""
    import my_family as MF  # noqa: PLC0415 - the client's identity, read only for a client's own narrowing
    houses = reads.once("sheetres:houses:" + key, lambda: list(MF.identity(reads, key)["houses"]))
    for col in columns:
        hv = s_(row.get(col))
        if not hv:
            continue
        if any(re.search(r"(^|\D)" + re.escape(nk) + r"(\D|$)", hv) for nk in houses):
            return True
    return False


def _theirs(reads: L.Reads, row: dict, key: str, resource: str = "") -> bool:
    """hubRowIsClients_'s generic reading: a field whose name speaks of a client names this one, or the row is theirs
    by the id the client resources mint (CLI_<key>); a resource declaring its house columns reads those alone."""
    by_house = spec_of(resource).get("by_house") if resource else None
    if by_house:
        return _their_house(reads, row, key, by_house)
    names = _client_names(reads, key)
    for k, v in row.items():
        if "client" not in str(k).lower():
            continue
        val = s_(v)
        if val and (val in (key, "CLI_" + key) or gsjs.name_key(val) in names):
            return True
    return s_(row.get("id")) == "CLI_" + key


def _client_rows(sess: L.Session, resource: str, got: list[dict]) -> list[dict]:
    """hubClientNarrowList_: open, the rows whole; declared theirs, their own; else nothing."""
    spec = spec_of(resource)
    if spec.get("client_open"):
        return got
    keys = own_keys(sess)
    if not spec.get("client_scoped") or not keys:
        return []
    return [r for r in got if any(_theirs(sess.reads, r, key, resource) for key in keys)]


def _client_row_refused(sess: L.Session, resource: str, row: dict) -> bool:
    """hubClientRowGate_: whether a client is told the row is not here."""
    spec = spec_of(resource)
    if spec.get("client_open"):
        return False
    keys = own_keys(sess)
    return not spec.get("client_scoped") or not any(_theirs(sess.reads, row, key, resource) for key in keys)


def _int(v: Any) -> int | None:
    """parseInt(v, 10); None for NaN."""
    n = CND.js_parse_int(v)
    return None if n != n else int(n)


def _found(reads: L.Reads, resource: str, rid: str) -> tuple[str, dict, dict] | None:
    """requireRow_: the first row with this id — its key, its stored cells and the row as readAll_ shows it."""
    hit = RR.find(reads, resource, rid)
    if hit is None:
        return None
    key, cells = hit
    return key, cells, RR.shown(RR.columns(reads, resource), cells) or {}


def _q_text(v: Any) -> str | None:
    """What listRows_' q is matched against: JSON for an object, the text of anything else, nothing for null."""
    if v is None:
        return None
    if isinstance(v, (dict, list)):
        return json.dumps(v, separators=(",", ":"), ensure_ascii=False)
    return gsjs.js_str(v)


def paged(got: list[dict], p: dict) -> list[dict]:
    """listRows_' own narrowing: q across every cell (case folded), then its offset and limit."""
    q = gsjs.trim("" if p.get("q") is None else gsjs.js_str(p.get("q"))).lower()
    if q:
        got = [r for r in got if any(q in (_q_text(v) or "").lower() for v in r.values() if v is not None)]
    offset = _int(p.get("offset"))
    offset = 0 if offset is None or offset < 0 else offset
    limit = _int(p.get("limit"))
    return got[offset:] if limit is None or limit < 0 else got[offset:offset + limit]


def list_rows(sess: L.Session, resource: str, payload: dict) -> dict[str, Any]:
    """route(resource, 'list'): listRows_ (its q, offset and limit), then a client's narrowing."""
    refused = gate(sess, resource, "list")
    if refused:
        return refused
    p = payload if isinstance(payload, dict) else {}
    got = paged(rows(sess.reads, resource), p)
    if SPECS[resource].get("owned"):
        # your rows, and only ever yours: no role widens this
        me = me_of(sess.user or {})
        got = [r for r in got if me and owner_of(resource, r) == me]
    if _client(sess.user or {}):
        got = _client_rows(sess, resource, got)
    return {"status": 200, "data": got}


def get_row(sess: L.Session, resource: str, payload: dict) -> dict[str, Any]:
    """route(resource, 'get'): requireRow_, then "not yours" reads as "not here" for a client."""
    refused = gate(sess, resource, "get")
    if refused:
        return refused
    p = payload if isinstance(payload, dict) else {}
    owned = _owned(sess, resource, "get", dict(p))
    if owned:
        return owned
    rid = p.get("id")
    if rid is None or rid == "":
        return {"status": 400, "message": NO_ID}
    want = gsjs.js_str(rid)
    hit = _found(sess.reads, resource, want)
    if hit is None:
        return {"status": 404, "message": f'No "{said(resource)}" record with id "{want}".'}
    if _client(sess.user or {}) and _client_row_refused(sess, resource, hit[2]):
        return {"status": 404, "message": f'No row "{want}" in {said(resource)}.'}
    return {"status": 200, "data": hit[2]}


def _client_write_refused(sess: L.Session, resource: str, payload: dict,
                          find: Callable[[str], dict | None] | None = None) -> Decision | None:
    """route()'s line before update and delete: a client may not write somebody else's row — "not yours" reads as
    "not here". `find`: the row an id names, where the rows are not these tables'."""
    if not _client(sess.user or {}) or spec_of(resource).get("client_open"):
        return None
    cid = s_(payload.get("id"))
    if not cid:
        return W.refuse(400, NO_ID)
    if find is not None:
        mine = find(cid)
    else:
        hit = _found(sess.reads, resource, cid)
        mine = hit[2] if hit is not None else None
    if mine is None:
        return W.refuse(404, f'No "{said(resource)}" record with id "{cid}".')
    if _client_row_refused(sess, resource, mine):
        return W.refuse(404, f'No "{said(resource)}" record here.')
    return None


def create_row(sess: L.Session, resource: str, payload: dict) -> Decision:
    """route(resource, 'create'): createRow_ — the payload's fields, an id, createdAt and updatedAt."""
    refused = gate(sess, resource, "create")
    if refused:
        return Decision(refused)
    reads = sess.reads
    record = dict(payload) if isinstance(payload, dict) else {}
    owned = _owned(sess, resource, "create", record)
    if owned:
        return Decision(owned)
    # hubPlaceGate_: the place is never the caller's to say
    record.pop("tenant", None)
    now = W.now_iso(reads)
    if gsjs.falsy(record.get("id")):
        record["id"] = W.mint()
    if gsjs.falsy(record.get("createdAt")):
        record["createdAt"] = now
    record["updatedAt"] = now
    RR.create(reads, resource, {k: COW.serialize(v) for k, v in record.items()}, s_((sess.user or {}).get("email")))
    return Decision({"status": 200, "data": record}, subject=gsjs.js_str(record["id"]), own=True)


def _stamp(resource: str, row: dict, patch: dict, now: str) -> None:
    """hubStampWhen_: a patch that moves the watched field onto the value stamps the moment, off it clears it."""
    for field, value, stamp, clear in spec_of(resource).get("stamps") or ():
        if field not in patch:
            continue
        was, to = s_(row.get(field)), s_(patch[field])
        if was == to:
            continue
        if to == value:
            patch[stamp] = now
        elif clear and was == value:
            patch[stamp] = ""


def update_row(sess: L.Session, resource: str, payload: dict) -> Decision:
    """route(resource, 'update'): the declared stamps, then updateRowById_ — the row merged with the patch, createdAt
    immutable, updatedAt refreshed."""
    refused = gate(sess, resource, "update")
    if refused:
        return Decision(refused)
    reads = sess.reads
    patch = dict(payload) if isinstance(payload, dict) else {}
    owned = _owned(sess, resource, "update", patch)
    if owned:
        return Decision(owned)
    patch.pop("tenant", None)
    mine = _client_write_refused(sess, resource, patch)
    if mine is not None:
        return mine
    now = W.now_iso(reads)
    # undefined or '' is no id; null is String(null), an id no row holds
    named = "id" in patch and patch["id"] != ""
    want = gsjs.js_str(patch["id"]) if named else ""
    hit = _found(reads, resource, want) if named else None
    if hit is not None:
        _stamp(resource, hit[2], patch, now)
    if not named:
        return W.refuse(400, NO_ID)
    if hit is None:
        return W.refuse(404, f'No "{said(resource)}" record with id "{want}".')
    key, cells, row = hit
    merged = dict(row)
    changed: dict[str, Any] = {}
    for k, v in patch.items():
        if k == "createdAt":
            continue
        merged[k] = changed[k] = v
    merged["updatedAt"] = changed["updatedAt"] = now
    RR.update(reads, resource, key, cells, {k: COW.serialize(v) for k, v in changed.items()},
              s_((sess.user or {}).get("email")))
    return Decision({"status": 200, "data": merged}, subject=want, own=True)


def delete_row(sess: L.Session, resource: str, payload: dict) -> Decision:
    """route(resource, 'delete'): deleteRowById_ — the row removed (kept marked in Postgres)."""
    refused = gate(sess, resource, "delete")
    if refused:
        return Decision(refused)
    reads = sess.reads
    p = dict(payload) if isinstance(payload, dict) else {}
    owned = _owned(sess, resource, "delete", p)
    if owned:
        return Decision(owned)
    mine = _client_write_refused(sess, resource, p)
    if mine is not None:
        return mine
    rid = p.get("id")
    if rid is None or rid == "":
        return W.refuse(400, NO_ID)
    want = gsjs.js_str(rid)
    hit = _found(reads, resource, want)
    if hit is None:
        return W.refuse(404, f'No "{said(resource)}" record with id "{want}".')
    RR.remove(reads, resource, hit[0], hit[1], s_((sess.user or {}).get("email")))
    return Decision({"status": 200, "data": {"id": rid, "deleted": True}}, subject=want, own=True)
