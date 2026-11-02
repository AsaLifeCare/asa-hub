"""asa-hub-app: the Hub's apps answered off asa-hub-db, called by the relay alone with the session it already verified."""
from __future__ import annotations

import asyncio
import contextlib
import hmac
import json
import logging
import math
import os
import sys
import time
import types
from typing import Any, AsyncIterator

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response
from starlette.concurrency import run_in_threadpool

import call_offs
import call_offs_writes
import call_prefs
import candidate_papers
import candidate_writes
import candidates
import cert_docs
import chat
import client_app
import client_candidate_writes
import client_candidates
import client_writes
import digest_lab
import digest_lab_writes
import drive
import docs
import docs_writes
import directors
import dr_appointments
import editions
import emergency_contacts
import envelope
import family
import family_writes
import forms
import forms_import
import forms_public
import forms_public_writes
import forms_writes
import gsjs
import hotline
import hotline_queue
import hotline_writes
import house_repair
import house_repair_writes
import support_requests
import support_requests_writes
import suggestions
import suggestions_writes
import staff_issues
import staff_issues_writes
import interviews
import interviews_writes
import system_logs
import company_calendar
import config_lane
import company_calendar_writes
import team_board
import team_board_writes
import overview
import overview_writes
import widget_bank
import widget_bank_writes
import image_bank
import image_bank_writes
import employee_loans
import employee_loans_writes
import comm_broadcast
import comm_broadcast_writes
import comm_routes
import comm_routes_writes
import comm_when
import comm_when_writes
import comm_calls
import comm_calls_writes
import comm_record
import comm_record_writes
import comm_repair
import comm_repair_writes
import comm_replies
import comm_replies_writes
import comm_proposals_writes
import comm_call_off
import comm_call_off_writes
import comm_mock
import comm_mock_writes
import comm_open_shift_covered
import comm_open_shift_covered_writes
import comm_recruit
import comm_recruit_writes
import comm_window_ask
import comm_window_ask_writes
import comm_call_off_form
import comm_call_off_form_writes
import call_off_form_sweep
import call_off_form_sweep_writes
import dup_scan
import dup_scan_writes
import inbound_copy_writes
import lane_mirror
import lane_mirror_writes
import comm_bindings
import comm_bindings_writes
import quo
import quo_writes
import support_desk_vacation
import support_punch
import users_phone_fill
import compliance
import compliance_writes
import contact_guard
import performance_doors
import contacts_sync
import contacts_sync_writes
import emp360
import emp360_writes
import people_merge
import alerts_config
import alerts_config_writes
import letters
import letters_writes
import app_release
import app_release_writes
import team_alerts
import team_alerts_writes
import doc_rooms
import doc_rooms_writes
import reminders
import reminders_writes
import sheet_board
import sheet_board_writes
import sheet_tabs
import hub_rows
import shift_board
import shift_board_writes
import onboarding
import onboarding_packet
import onboarding_writes
import hiring
import audits
import audits_writes
import billing
import billing_writes
import equipment
import equipment_writes
import hiring_public
import hiring_public_writes
import hiring_accounts
import hiring_accounts_writes
import hiring_walk
import hiring_writes
import staff_alerts
import staff_alerts_writes
import scheduling_clock
import scheduling_clock_writes
import support_desk_clock
import support_desk_clock_writes
import vc_clock
import vc_clock_writes
import opsdash
import people_roster
import release_users
import admin_docs
import admin_docs_writes
import production_actions
import production_actions_writes
import academy
import academy_writes
import med_del
import med_del_writes
import ist
import ist_writes
import compliance_engine
import compliance_engine_writes
import client_care
import client_care_writes
import comms_rpc
import potential_clients
import potential_clients_writes
import houses
import isp
import isp_writes
import mail_designs
import mail_designs_writes
import my_asa
import my_asa_writes
import task_board
import task_board_writes
import time_off_rows
import time_off_writes
import travel
import travel_writes
import meals
import meals_writes
import shopper
import shopper_writes
import inventory
import inventory_writes
import studio
import studio_writes
import app_builder
import app_builder_writes
import app_control
import app_control_writes
import prefs
import prefs_writes
import prefs_doors
import prefs_doors_writes
import alert_receive
import alert_receive_writes
import palette
import account_profile
import account_profile_writes
import members
import members_writes
import tenant_ensure
import tenant_ensure_writes
import user_profiles
import users_directory
import users_writes
import users_accounts
import users_merge_apply
import users_invite
import release_user_writes
import profile_account_writes
import location_files
import location_files_writes
import staff_docs
import staff_docs_writes
import staff_visits
import my_family
import transportation_setup
import ist_config_doors
import phone_screens
import flow_cadence
import books
import books_writes
import bundles
import docs_import
import files_docs
import files_docs_writes
import form_file_store
import mar
import mar_writes
import med_deliveries
import med_deliveries_writes
import marketing
import marketing_writes
import master_overview
import expenses
import expenses_writes
import visits
import visits_writes
import technology
import leadership
import cortex
import platform_mail
import platform_mail_writes
import sleep
import policies
import policies_writes
import family_portal
import family_portal_writes
import guardian
import ai_key_stress
import render_sheet
import render_sheet_writes
import wellbeing
import medications
import medications_writes
import finance
import finance_writes
import technology_writes
import house_meds
import hubdb
import inbox_state
import learning
import learning_writes
import location_docs
import locations
import mw_relay_state
import my_calendar
import my_calendar_writes
import my_inbox
import my_inbox_writes
import my_profile
import my_profile_writes
import my_work
import my_work_writes
import performance
import photos
import questionnaires
import questionnaires_writes
import recon
import recon_writes
import resolver_doors
import resume_texts
import scheduling_app
import scheduling_import
import scheduling_writes
import scope as sc
import settings_tools
import settings_tools_writes
import line_directory
import line_directory_writes
import opt_outs
import opt_outs_writes
import smart_clock
import smart_clock_writes
import smart_comms
import smart_comms_desk
import smart_comms_doors
import smart_comms_writes
import ssa
import ssa_writes
import staff_app
import staff_views
import staff_writes
import support_desk
import support_desk_writes
import sys_log
import transportation
import transportation_flows
import transportation_writes
import ui_incidents
import ops_stragglers
import ops_stragglers_writes
import generic_rows
import generic_rows_writes
import world
import world_writes
import writes
import auth_doors
import auth_invites
import auth_invites_writes
import auth_store

log = logging.getLogger("asa-hub-app")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")


def code_stamp(folder: str) -> str:
    """The fingerprint of the code this process runs: sha256 over every top-level *.py, by name (vite.config.ts
    bakes the same into the SPA's build, so the master's versions box can say whether both are one release)."""
    import hashlib  # noqa: PLC0415
    h = hashlib.sha256()
    try:
        for name in sorted(n for n in os.listdir(folder) if n.endswith(".py")):
            h.update((name + "\n").encode())
            with open(os.path.join(folder, name), "rb") as f:
                h.update(f.read())
            h.update(b"\n")
    except OSError:
        return ""
    return h.hexdigest()[:12]


CODE_STAMP = code_stamp(os.path.dirname(os.path.abspath(__file__)))
STARTED_AT = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

TOKEN = os.getenv("HUB_APP_TOKEN", "")
DB = hubdb.shared()
DRIVE = drive.Drive()
STORE = writes.Store()
# the JSON lane's whole bundles (app.snapshot_bundles), filed and read back through the shared writer connection
bundles.bind(STORE)
CLIENT_STORE = client_writes.Store()
STAFF_STORE = staff_writes.Store()
# the audited Staff reads' lines (app.staff_views), kept through the Staff store's writer connection
staff_views.bind(STAFF_STORE)
# the platform's action log (app/sys_log.py, app.system_logs and app.log_events): every line staff_views keeps lands
# there too, and the lines kept outside a write are batched through the Locations store's writer connection
staff_views.TAPS.append(sys_log.heard)
sys_log.bind(STORE, lambda: locations.Reads(DB, DRIVE))
# a person's deep profile, kept beside the Staff store's writer (app.user_profile_store)
user_profiles.bind(STAFF_STORE)
# the visit line of a section opened on a Staff profile, under the Staff store
staff_writes.ACTIONS.update(staff_visits.ACTIONS)
staff_writes.POLICY.update(staff_visits.POLICY)
staff_writes.BUSY_OF.update(staff_visits.BUSY_OF)
# Locations' assets and documents: the Drive steps the relay asks before each write (reads), then its records (writes)
locations.ACTIONS.update(location_files.ACTIONS)
locations.POLICY.update(location_files.POLICY)
writes.ACTIONS.update(location_files_writes.ACTIONS)
writes.POLICY.update(location_files_writes.POLICY)
SSA_STORE = ssa_writes.Store()
FAMILY_STORE = family_writes.Store()
SCHEDULING_STORE = scheduling_writes.Store()
TRANSPORTATION_STORE = generic_rows_writes.TransportationStore()
# Settings › Editions: its save's receipts (app.editions_receipts); the list itself is kept in app.edits
EDITIONS_STORE = writes.Store(kind="editions", label="Settings › Editions")
# Emergency Contacts: the directory's own tables and its save's receipts, Postgres alone
EMERGENCY_CONTACTS_STORE = emergency_contacts.Store()
emergency_contacts.bind(EMERGENCY_CONTACTS_STORE)
# Staff Candidates: app.candidates_writes / app.candidates_receipts
CANDIDATES_STORE = candidate_writes.Store()
# the calls a candidate's preferences are heard on, owed to the relay's lane (app.candidate_call_prefs)
call_prefs.bind(CANDIDATES_STORE)
# the résumés that are scans, owed to the relay's OCR lane (app.resume_texts)
resume_texts.bind(CANDIDATES_STORE)
# the edit panels' read is a read, answered by the read module's door (never under the write lock)
candidates.ACTIONS.update(candidate_writes.READS)
candidates.POLICY.update(candidate_writes.READ_POLICY)
# a paper filed on a Hiring record: the relay's own plan and verdict (reads), then its records (writes)
candidates.ACTIONS.update(candidate_papers.READS)
candidates.POLICY.update(candidate_papers.READ_POLICY)
candidate_writes.ACTIONS.update(candidate_papers.ACTIONS)
candidate_writes.POLICY.update(candidate_papers.POLICY)
candidate_writes.BUSY_OF.update({a: {"status": 409, "message": writes.BUSY} for a in candidate_papers.ACTIONS})
# the phone screen's drawer and a hiring step's cadence rearmed, facts on the hiring rows under the same store
for _m in (phone_screens, flow_cadence):
    candidate_writes.ACTIONS.update(_m.ACTIONS)
    candidate_writes.POLICY.update(_m.POLICY)
    candidate_writes.BUSY_OF.update(_m.BUSY_OF)
# Client Candidates: app.client_candidates_writes / app.client_candidates_receipts
CLIENT_CANDIDATES_STORE = client_candidate_writes.Store()
client_candidates.ACTIONS.update(client_candidate_writes.READS)
client_candidates.POLICY.update(client_candidate_writes.READ_POLICY)
# My Profile: the lane's read and the caller's own address; its save in app.my_profile_* and app.edits
MY_PROFILE_STORE = my_profile_writes.Store()
my_profile.ACTIONS.update(my_profile_writes.READS)
my_profile.POLICY.update(my_profile_writes.READ_POLICY)
# Compliance documents: the ledger, a paper's bytes and its record; the confirmation in app.cert_docs_* and app.edits
CERT_DOCS_STORE = cert_docs.Store()
# My Calendar: the lane's two reads and its vacation route; no write store (its writes are Time Off's and Apps Script's)
my_calendar.ACTIONS.update(my_calendar_writes.READS)
my_calendar.POLICY.update(my_calendar_writes.READ_POLICY)
# My Inbox: the lane's read; the session's own read and cleared marks and the first sightings kept in app.inbox_reads
# and app.inbox_seen, merged with the rows the relay hands in
MY_INBOX_STORE = my_inbox_writes.Store()
inbox_state.bind(MY_INBOX_STORE)
# My Work: a Time off approval row's message, its receipt in app.my_work_receipts; the text itself Smart Comms'
MY_WORK_STORE = my_work_writes.Store()
# Smart Comms: the Desk's save receipts (app.smart_comms_writes / _receipts); the same writer keeps the outbox and drains it
SMART_COMMS_STORE = generic_rows_writes.SmartCommsStore()
smart_comms.bind(DB)
# the Replies verdict beside the Desk save, decided under the same store and receipts
smart_comms_writes.ACTIONS.update(smart_comms_doors.ACTIONS)
smart_comms_writes.POLICY.update(smart_comms_doors.POLICY)
smart_comms_writes.BUSY_OF.update(smart_comms_doors.BUSY_OF)
# the proposals' doors beside the Desk save: the counter's feed and a person's decision, under the same store
smart_comms_writes.ACTIONS.update(comm_proposals_writes.ACTIONS)
smart_comms_writes.POLICY.update(comm_proposals_writes.POLICY)
smart_comms_writes.BUSY_OF.update(comm_proposals_writes.BUSY_OF)
# Transportation's flows: a request, its answer (also from My Work and My Inbox), a withdraw — told through Smart Comms
transportation_writes.ACTIONS.update(transportation_flows.ACTIONS)
transportation_writes.POLICY.update(transportation_flows.POLICY)
transportation_writes.BUSY_OF.update(transportation_flows.BUSY_OF)
# the vehicles' calendars seeded and imported, kept in app.edits under the same store
transportation_writes.ACTIONS.update(transportation_setup.ACTIONS)
transportation_writes.POLICY.update(transportation_setup.POLICY)
transportation_writes.BUSY_OF.update(transportation_setup.BUSY_OF)
# Forms: a save, an answer handled, a form renamed or archived, an answer's file filed (app.forms_writes / _receipts);
# an import from Google (app/forms_import.py) beside them; a new key stays Apps Script's
FORMS_STORE = generic_rows_writes.FormsStore()
forms.ACTIONS.update(form_file_store.READS)
forms.POLICY.update(form_file_store.READ_POLICY)
forms_writes.ACTIONS.update(form_file_store.ACTIONS)
forms_writes.POLICY.update(form_file_store.POLICY)
forms_writes.BUSY_OF.update(form_file_store.BUSY_OF)
# the public form's doors beside them, under the same store: the page drawn, a Drive upload session, a file stored
# ahead of its answer and the answer filed — each write's Drive half its prepare read, and the claim the relay's own
forms.ACTIONS.update(forms_public.READS)
forms.POLICY.update(forms_public.READ_POLICY)
forms_writes.ACTIONS.update(forms_public_writes.ACTIONS)
forms_writes.POLICY.update(forms_public_writes.POLICY)
# an import from Google: the form read by its prepare read, then kept as a save keeps one (Python's alone)
forms.ACTIONS.update(forms_import.READS)
forms.POLICY.update(forms_import.READ_POLICY)
forms_writes.ACTIONS.update(forms_import.ACTIONS)
forms_writes.POLICY.update(forms_import.POLICY)
forms_writes.BUSY_OF.update(forms_import.BUSY_OF)
# what a caller with no account may ask, as nobody: each app's own public doors, at that app alone — the public form's,
# and the Hiring pipeline's pages opened from a link (the interview calendar, the shared candidate form, the referral)
PUBLIC_DOORS_BY_APP = {"forms": forms_public.PUBLIC | forms_public_writes.PUBLIC,
                       "hiring": hiring_public.PUBLIC | hiring_public_writes.PUBLIC}
PUBLIC_DOORS = frozenset().union(*PUBLIC_DOORS_BY_APP.values())
PUBLIC_CALLER = {"public": True, "is_service": False, "id": "", "email": "", "role": "", "display_name": "",
                 "types": [], "client_key": "", "home_tenant": "", "app_denials": [], "visiting_member": ""}
# Docs: a document registered, changed or removed in Settings › Docs, a Drive folder's import (app.docs_writes /
# _receipts; a removal app.book_ops')
DOCS_STORE = ops_stragglers_writes.DocsStore()
docs.ACTIONS.update(docs_import.READS)
docs.POLICY.update(docs_import.READ_POLICY)
docs_writes.ACTIONS.update(docs_import.ACTIONS)
docs_writes.POLICY.update(docs_import.POLICY)
docs_writes.BUSY_OF.update(docs_import.BUSY_OF)
# Books: the shelf and its stored text (app.books_writes / _receipts; rows app.resource_rows); Files: a person's
# documents filed and reviewed, the folders organised (app.files_writes / _receipts; facts app.edits)
BOOKS_STORE = books_writes.Store()
FILES_STORE = files_docs_writes.Store()
# Call Offs: a call-off reported, corrected or removed on the screen (app.call_offs_writes / _receipts; a removal
# app.book_ops')
CALL_OFFS_STORE = ops_stragglers_writes.CallOffsStore()
# the last generic verbs of their apps (app/ops_stragglers*.py): a call-off, a library document and a helpful contact
# removed, a helpful contact added, both lists of Suggestions' contacts and Settings' notifications read, a UI report
# corrected or removed, a roster row changed
call_offs_writes.ACTIONS.update(ops_stragglers_writes.CALL_OFFS_DOORS.ACTIONS)
call_offs_writes.POLICY.update(ops_stragglers_writes.CALL_OFFS_DOORS.POLICY)
call_offs_writes.BUSY_OF.update(ops_stragglers_writes.CALL_OFFS_DOORS.BUSY_OF)
docs_writes.ACTIONS.update(ops_stragglers_writes.DOCS_DOORS.ACTIONS)
docs_writes.POLICY.update(ops_stragglers_writes.DOCS_DOORS.POLICY)
docs_writes.BUSY_OF.update(ops_stragglers_writes.DOCS_DOORS.BUSY_OF)
suggestions.ACTIONS.update(ops_stragglers.SUGGESTIONS_READS)
suggestions.POLICY.update(ops_stragglers.SUGGESTIONS_POLICY)
suggestions_writes.ACTIONS.update(ops_stragglers_writes.SUGGESTIONS_DOORS.ACTIONS)
suggestions_writes.POLICY.update(ops_stragglers_writes.SUGGESTIONS_DOORS.POLICY)
suggestions_writes.BUSY_OF.update(ops_stragglers_writes.SUGGESTIONS_DOORS.BUSY_OF)
alerts_config.ACTIONS.update(ops_stragglers.CONFIG_READS)
alerts_config.POLICY.update(ops_stragglers.CONFIG_POLICY)
# UI Reports and the roster: their writes' own stores (app.ui_incidents_writes, app.people_roster_writes / _receipts;
# the cells app.edits', a column added app.book_ops')
UI_INCIDENTS_STORE = ops_stragglers_writes.UiIncidentsStore()
PEOPLE_ROSTER_STORE = ops_stragglers_writes.PeopleRosterStore()
# House Repair (and House Work Orders, on the same resource): a repair request filed, edited or cancelled through the
# generic verbs on workOrders (app.house_repair_writes / _receipts; rows app.edits, the estate's Repairs book)
HOUSE_REPAIR_STORE = generic_rows_writes.HouseRepairStore()
# Hotline: a call the Quo webhook handed over, and Python's reading of it (app.hotline_writes / _receipts)
HOTLINE_STORE = hotline_writes.Store()
# the hotline's two estate lanes (the support queue, the daily notes), read beside its own doors
hotline.ACTIONS.update(hotline_queue.ACTIONS)
hotline.POLICY.update(hotline_queue.POLICY)
# Shift Board: an event the Week page made, moved or removed (app.shiftboard_writes / _receipts; rows
# app.resource_rows)
SHIFT_BOARD_STORE = shift_board_writes.Store()
# Onboarding: the new hire's portal — the packet row, the documents and the card as the hiring rows' facts, a clearance
# receipt and a finished visit's report in app.resource_rows, each file kept on the server and filed in Drive by its
# prepare read (app.onboarding_writes / _receipts)
ONBOARDING_STORE = onboarding_writes.Store()
# a signed packet form attached: filed in Drive and kept on the server by its prepare read, recorded on the packet row
onboarding.ACTIONS.update(onboarding_packet.READS)
onboarding.POLICY.update(onboarding_packet.READ_POLICY)
onboarding_writes.ACTIONS.update(onboarding_packet.ACTIONS)
onboarding_writes.POLICY.update(onboarding_packet.POLICY)
onboarding_writes.BUSY_OF.update(onboarding_packet.BUSY_OF)
# Hiring: the hiring books' doors gathered under one app (app/hiring.py, app/hiring_writes.py) — app.hiring_writes /
# _receipts, the clocks' marks app.hiring_marks and app.talent_marks, rows the hiring facts and app.resource_rows
HIRING_STORE = hiring_accounts_writes.Store()
# the accounts the hiring sweep made (Hired.gs onboardingUserSweepMaybe_, hubHiredGraduate_): each look a read, each
# pass a write under the hiring store, whose void also takes back a password and a users cell still queued
hiring.ACTIONS.update(hiring_accounts.ACTIONS)
hiring.POLICY.update(hiring_accounts.POLICY)
hiring_writes.ACTIONS.update(hiring_accounts_writes.ACTIONS)
hiring_writes.POLICY.update(hiring_accounts_writes.POLICY)
hiring_writes.BUSY_OF.update(hiring_accounts_writes.BUSY_OF)
# the hiring walk: the relay presses each step and asks hiringWalkNext between presses; hiringWalkRun reports it
hiring.ACTIONS.update(hiring_walk.READS)
hiring.POLICY.update(hiring_walk.READ_POLICY)
hiring_writes.ACTIONS.update(hiring_walk.ACTIONS)
hiring_writes.POLICY.update(hiring_walk.POLICY)
hiring_writes.BUSY_OF.update(hiring_walk.BUSY_OF)
# Audits & Compliance, Billing & Payers, Equipment & Assets: a row made, changed or removed through the generic verbs
# (app.<app>_writes / _receipts; rows app.resource_rows)
AUDITS_STORE = audits_writes.Store()
BILLING_STORE = billing_writes.Store()
EQUIPMENT_STORE = equipment_writes.Store()
# Staff attendance: the late and no-call reports, the shift reminders and their mailbox (app.staff_alerts_writes /
# _receipts; the sweep's memory in app.resource_rows)
STAFF_ALERTS_STORE = staff_alerts_writes.Store()
# the clocks Apps Script's hiring sweep rang (schedulingClockTick_, supportDeskTick_, vcClockTick_): each look a read,
# each sweep a write under its app's store
for _reads, _clock in ((scheduling_app, scheduling_clock), (support_desk, support_desk_clock),
                       (transportation, vc_clock)):
    _reads.ACTIONS.update(_clock.ACTIONS)
    _reads.POLICY.update(_clock.POLICY)
for _writes, _clock in ((scheduling_writes, scheduling_clock_writes), (support_desk_writes, support_desk_clock_writes),
                        (transportation_writes, vc_clock_writes)):
    _writes.ACTIONS.update(_clock.ACTIONS)
    _writes.POLICY.update(_clock.POLICY)
    _writes.BUSY_OF.update(_clock.BUSY_OF)
# the AI lane test the Guardian and Smart Comms press (KeyStress.gs), answered under the Guardian
guardian.ACTIONS.update(ai_key_stress.ACTIONS)
guardian.POLICY.update(ai_key_stress.POLICY)
# Support Requests Queue: a request filed and its verdict (app.support_requests_writes / _receipts)
SUPPORT_REQUESTS_STORE = support_requests_writes.Store()
# Suggestions: a suggestion kept and its letter raised (app.suggestions_writes / _receipts; the rows app.suggestions),
# a helpful contact added or removed (its cells app.edits', a removal app.book_ops')
SUGGESTIONS_STORE = ops_stragglers_writes.SuggestionsStore()
# Staff Issues: a situation appended to the HR tracker (app.staff_issues_writes / _receipts)
STAFF_ISSUES_STORE = staff_issues_writes.Store()
# Interviews: a candidate's access window (app.interviews_writes / _receipts)
INTERVIEWS_STORE = interviews_writes.Store()
# Calendar: a day's file kept and taken off (app.calendar_writes / _receipts; the files app.calendar_files)
CALENDAR_STORE = company_calendar_writes.Store()
# Kanban: a card added or changed on the team board (app.team_board_writes / _receipts)
TEAM_BOARD_STORE = team_board_writes.Store()
# Overview: its activity sheet uploaded again (app.overview_writes / _receipts; the rows app.resource_rows)
OVERVIEW_STORE = overview_writes.Store()
# Widgets: a spec added or changed in the widget bank (app.widget_bank_writes / _receipts)
WIDGET_BANK_STORE = widget_bank_writes.Store()
# Image Bank: a picture added or changed (app.image_bank_writes / _receipts)
IMAGE_BANK_STORE = image_bank_writes.Store()
# Employee Loans: a request, its answer and a payment (app.employee_loans_writes / _receipts; rows app.resource_rows)
EMPLOYEE_LOANS_STORE = employee_loans_writes.Store()
# Staff Broadcast: a broadcast sent, continued, withdrawn or carried after the quiet window (app.broadcast_writes /
# _receipts; rows app.resource_rows)
BROADCAST_STORE = comm_broadcast_writes.Store()
# the letters Apps Script's sweeps and public form door wrote: the relay's clock's sweep (app.letters_writes /
# _receipts; what was told app.letters_told)
LETTERS_STORE = letters_writes.Store()
# an app's release announcement: the master's Announce, a save's and the clock's (app.app_release_writes / _receipts)
APP_RELEASE_STORE = app_release_writes.Store()
# the hiring team's alerts: the clock's sweep (app.team_alerts_writes / _receipts; what was told app.team_alerts_told)
TEAM_ALERTS_STORE = team_alerts_writes.Store()
# the Audit Library and the other Drive reading rooms: a file stored or trashed (app.doc_rooms_writes / _receipts;
# what happened app.doc_room_events)
DOC_ROOMS_STORE = doc_rooms_writes.Store()
# Reminders: a reminder added, changed, done or removed (app.reminders_writes / _receipts; rows app.resource_rows)
REMINDERS_STORE = reminders_writes.Store()
# Task Board Sheet: a card, or its spreadsheet's cells, rows, columns and tabs (app.sheet_board_writes / _receipts;
# cards app.resource_rows, sheets app.sheet_board_tabs)
SHEET_BOARD_STORE = sheet_board_writes.Store()
# Administration: a document uploaded or deleted, and what the relay's pass brought in from the Drive folder
# (app.admin_docs_writes / _receipts; documents app.admin_docs, files in the documents folder)
ADMIN_DOCS_STORE = admin_docs_writes.Store()
# Production Actions: a run, a mark, an undo or an edit of the runbook (app.production_actions_writes / _receipts;
# runbook and history app.resource_rows, banners on the server's copy of their books)
PRODUCTION_ACTIONS_STORE = production_actions_writes.Store()
# Academy: a lesson added, edited or removed, a thumb given, a video file brought onto the server
# (app.academy_writes / _receipts; lessons and votes app.resource_rows, files app.academy_files)
ACADEMY_STORE = academy_writes.Store()
# Med Delegation: a renewal flow started, advanced, cancelled or swept (app.med_del_writes / _receipts; flows
# app.resource_rows)
MED_DEL_STORE = med_del_writes.Store()
# IST Records: a notice asked again, the house map edited, the records rebuilt, a paper's link kept, the ist_due
# notices raised (app.ist_writes / _receipts; records and map app.resource_rows)
IST_STORE = ist_writes.Store()
# Settings › IST: the configuration read and saved beside the records, the declaration handed in by the relay
ist.ACTIONS.update(ist_config_doors.READS)
ist.POLICY.update(ist_config_doors.READ_POLICY)
ist_writes.ACTIONS.update(ist_config_doors.ACTIONS)
ist_writes.POLICY.update(ist_config_doors.POLICY)
ist_writes.BUSY_OF.update(ist_config_doors.BUSY_OF)
# the Compliance Engine: a requirement added, changed or removed, the states rebuilt (app.compliance_engine_writes /
# _receipts; catalogue and states app.resource_rows)
COMPLIANCE_ENGINE_STORE = compliance_engine_writes.Store()
# Smart Comms' sending: a message Apps Script's rpcCall_ hands over, decided here (app.comms_rpc_writes / _receipts;
# the messages smart_comms' outbox)
COMMS_RPC_STORE = comms_rpc.Store()
# Potential Clients: a referral moved down the funnel, opened, added or removed (app.potential_clients_writes /
# _receipts; the referrals app.resource_rows)
POTENTIAL_CLIENTS_STORE = potential_clients_writes.Store()
# Client Care's doors that were Apps Script's: an incident's review, an appointment's pencil, an incident reported, the
# guardians added to the roster, the directory's quick edit, the plans' contacts (app.client_care_writes / _receipts)
CLIENT_CARE_STORE = generic_rows_writes.ClientCareStore()
# Smart Comms' clock: the events, the credential reminders and the digests Apps Script's hiring sweep sent, told on the
# relay's clock (app.smart_clock_writes / _receipts; the messages smart_comms' outbox, the ledger app.edits); the
# Desk's preview of the reminders beside its other reads
SMART_CLOCK_STORE = smart_clock_writes.Store()
smart_comms_desk.ACTIONS.update(smart_clock.DESK_ACTIONS)
smart_comms_desk.POLICY.update(smart_clock.DESK_POLICY)
# the opt-out list and the inbound log: a stop set or lifted, a message seen, the inbound sweep's filing
# (app.opt_outs_writes / _receipts; rows app.resource_rows, the sweep's cursor app.opt_out_state)
OPT_OUTS_STORE = opt_outs_writes.Store()
# and the automatic inbound pass's filing while the list is still Apps Script's, kept in app.edits under the same store
opt_outs_writes.ACTIONS.update(inbound_copy_writes.ACTIONS)
opt_outs_writes.POLICY.update(inbound_copy_writes.POLICY)
opt_outs_writes.BUSY_OF.update(inbound_copy_writes.BUSY_OF)
# the cortex's routes and the window each person may be asked in: the relay's own hand-offs, upserted into their
# houses (app.comm_routes_writes, app.comm_when_writes / _receipts; rows app.resource_rows, the feed's stamp
# app.comm_when_state)
COMM_ROUTES_STORE = comm_routes_writes.Store()
COMM_WHEN_STORE = comm_when_writes.Store()
# Smart Comms' engine lanes: the phone-call lane, the obligations sweep, the repair pass and the mailbox ear, each on
# the relay's clock (app.<lane>_writes / _receipts; rows app.resource_rows or app.edits, each lane's own state table)
COMM_CALLS_STORE = comm_calls_writes.Store()
COMM_RECORD_STORE = comm_record_writes.Store()
COMM_REPAIR_STORE = comm_repair_writes.Store()
COMM_REPLIES_STORE = comm_replies_writes.Store()
# Smart Comms' relay-rung lanes: the covered-shift follow-up, the recruiters' book (its houses), the mock outbox's
# web rows, the window ask, and the call-off lane's replay (app.<lane>_writes / _receipts; rows app.edits or
# app.resource_rows, the messages the outbox's, the window ask's stamp app.comm_window_ask_state)
COMM_COVERED_STORE = comm_open_shift_covered_writes.Store()
COMM_RECRUIT_STORE = comm_recruit_writes.Store()
COMM_MOCK_STORE = comm_mock_writes.Store()
COMM_WINDOW_ASK_STORE = comm_window_ask_writes.Store()
COMM_CALL_OFF_STORE = comm_call_off_writes.Store()
# the relay's own ingests: Calendar Builder's call-offs and the Quo inbox's batches (app.<lane>_writes / _receipts;
# rows app.edits, the opt-out list app.resource_rows, the messages the outbox's)
COMM_CALL_OFF_FORM_STORE = comm_call_off_form_writes.Store()
QUO_STORE = generic_rows_writes.QuoStore()
# the hiring sweep's clock riders, rung by the relay's clock: the lane mirrors (each house rewritten by a book op), the
# pattern scan and the call-off form's crossing (app.<rider>_writes / _receipts; their throttles app.clock_sweeps_state)
LANE_MIRROR_STORE = lane_mirror_writes.Store()
DUP_SCAN_STORE = dup_scan_writes.Store()
CALL_OFF_FORM_SWEEP_STORE = call_off_form_sweep_writes.Store()
# the comm-bindings book's shipped rows, seeded on the relay's clock (app.comm_bindings_writes / _receipts; the rows
# app.edits)
COMM_BINDINGS_STORE = comm_bindings_writes.Store()
# Settings' platform configuration (AlertsConfig.gs): a save's receipts (app.alerts_config_writes / _receipts); the
# cells themselves kept in app.edits as the runtime book's newest facts
ALERTS_CONFIG_STORE = alerts_config_writes.Store()
# the Line Directory: the company's lines as the provider or the platform lists them (app.line_directory)
LINE_DIRECTORY_STORE = line_directory_writes.Store()
line_directory.bind(LINE_DIRECTORY_STORE)
# My asa.'s week, the Task Board (and its kept attachments) and the ISP Library: the generic verbs on their rows
# (app.my_asa_writes, app.task_board_writes, app.isp_writes / _receipts; rows app.resource_rows)
MY_ASA_STORE = my_asa_writes.Store()
TASK_BOARD_STORE = task_board_writes.Store()
ISP_STORE = isp_writes.Store()
# Email Designs: a design sent to the asker through Smart Comms (app.mail_designs_writes / _receipts)
MAIL_DESIGNS_STORE = mail_designs_writes.Store()
# Time Off: a request or a setting kept by the relay's rules, the house's rows uploaded (app.time_off_writes /
# _receipts; records and settings app.resource_rows)
TIME_OFF_STORE = time_off_writes.Store()
# Business Travel: a trip proposed, edited or decided (app.travel_writes / _receipts; trips app.resource_rows)
TRAVEL_STORE = travel_writes.Store()
# the Meal tracker: an entry logged or removed, the goals set (app.meals_writes / _receipts; rows app.resource_rows)
MEALS_STORE = meals_writes.Store()
# Smart Shopper: an item saved, removed or estimated, the categories set (app.shopper_writes / _receipts; rows
# app.resource_rows, the categories app.edits)
SHOPPER_STORE = shopper_writes.Store()
# the Inventory: a supply document added by hand (app.inventory_writes / _receipts; rows app.resource_rows, files
# app.inventory_files and the documents folder)
INVENTORY_STORE = inventory_writes.Store()
# App Studio: a place added or changed (app.studio_writes / _receipts; the tenants tab through app.edits)
STUDIO_STORE = studio_writes.Store()
# App Studio's App Builder, Playground and imports, and the generic `apps` resource, under the same store: the
# app_builder, apps and hub_resources tabs and a page's own tab changed by book ops (app.book_ops `rows`)
studio.ACTIONS.update(app_builder.ACTIONS)
studio.POLICY.update(app_builder.POLICY)
studio_writes.ACTIONS.update(app_builder_writes.ACTIONS)
studio_writes.POLICY.update(app_builder_writes.POLICY)
studio_writes.BUSY_OF.update(app_builder_writes.BUSY_OF)
# a read that finds a tab Apps Script made on first touch queues it through the same store, once
app_builder_writes.bind(STUDIO_STORE)
# the document collections and Alerts I receive: a collection made, a director's alerts set (app.prefs_writes,
# app.alert_receive_writes / _receipts; cells app.edits)
PREFS_STORE = prefs_writes.Store()
ALERT_RECEIVE_STORE = alert_receive_writes.Store()
# App Control's saves: the access matrices' rows and the list it is shared with (app.app_control_writes / _receipts;
# rows and the config's key app.edits)
APP_CONTROL_STORE = app_control_writes.Store()
# beside the collections, under the same switch and store: a person's own preferences (cells app.edits), the master's
# sidebar shelf and company menu (whole-tab rewrites, app.book_ops) and hubBoot (app/prefs_doors*.py)
prefs.ACTIONS.update(prefs_doors.ACTIONS)
prefs.POLICY.update(prefs_doors.POLICY)
prefs_writes.ACTIONS.update(prefs_doors_writes.ACTIONS)
prefs_writes.POLICY.update(prefs_doors_writes.POLICY)
# a collection made keeps the store's busy answer; prefsSet takes no lock in Apps Script (busy, the relay says 503)
prefs_writes.BUSY_OF = {"collectionCreate": {"status": 409, "message": writes.BUSY}, **prefs_doors_writes.BUSY_OF}
# the signed-in account's profile for a place, and the staff documents' and clearance's dates
# (app.account_profile_writes, app.staff_docs_writes / _receipts; cells app.edits, cursors app.staff_docs_state)
ACCOUNT_PROFILE_STORE = account_profile_writes.Store()
STAFF_DOCS_STORE = staff_docs_writes.Store()
# Settings › Platform users: a member row asked, answered, ended, the member's word about their world
# (app.members_writes / _receipts; cells app.edits, the letter Smart Comms' outbox)
MEMBERS_STORE = members_writes.Store()
# a place's own workbook, the master's: made in Drive by its prepare read, its pointer kept here
# (app.tenant_ensure_writes / _receipts; the tenants tab's cell app.edits)
TENANT_ENSURE_STORE = tenant_ensure_writes.Store()
# Employee 360: a Master cell edited from its sheet (app.emp360_writes / _receipts; the cell app.edits)
EMP360_STORE = emp360_writes.Store()
# the platform's contact list into the People house, the relay's hand-off and an admin's press, pass by pass
# (app.contacts_sync_writes / _receipts; cells app.edits, the list's stamp app.contacts_sync_state); the contact
# merge's and the People merge's previews read beside it — both applies mint or link accounts and stay Apps Script's
CONTACTS_SYNC_STORE = contacts_sync_writes.Store()
# MAR: a medication pass recorded, corrected or removed (app.mar_writes / _receipts; passes app.resource_rows)
MAR_STORE = mar_writes.Store()
# Med Deliveries: a delivery recorded, corrected or removed (app.med_deliveries_writes / _receipts; rows
# app.resource_rows)
MED_DELIVERIES_STORE = med_deliveries_writes.Store()
# Marketing: a competitor added (app.marketing_writes / _receipts; rows app.resource_rows)
MARKETING_STORE = marketing_writes.Store()
# Expenses: a report made, decided or removed (app.expenses_writes / _receipts; rows app.resource_rows)
EXPENSES_STORE = expenses_writes.Store()
# Visits & EVV: a visit logged, corrected or removed through the generic verbs (app.visits_writes / _receipts; rows
# app.resource_rows)
VISITS_STORE = visits_writes.Store()
# Technology: a project's status, a project added or removed by hand, and what the relay's pass brought in from the
# Drive folder (app.technology_writes / _receipts; rows app.tech_*, files in the documents folder)
TECHNOLOGY_STORE = technology_writes.Store()
# Mail: a message marked or filed on the mail server, a letter raised through Smart Comms, a mailbox wired
# (app.platform_mail_writes / _receipts; the mail stays on the mail server)
PLATFORM_MAIL_STORE = platform_mail_writes.Store()
# Policies: a read receipt filed, the import's rewrite of the policies and the contact list (app.policies_writes /
# _receipts; rows app.resource_rows, originals app.policy_files and the documents folder)
POLICIES_STORE = policies_writes.Store()
# Family Portal: a letter home made, changed or removed (app.family_portal_writes / _receipts; rows app.resource_rows)
FAMILY_PORTAL_STORE = family_portal_writes.Store()
# Render Sheet: a cell typed, a row added, a spreadsheet linked (app.render_sheet_writes / _receipts; owned rows
# app.resource_rows, a copy's cells app.edits)
RENDER_SHEET_STORE = render_sheet_writes.Store()
# Medications: a medicine added to or taken off the chart, a catalogue entry made or changed
# (app.medications_writes / _receipts; rows app.resource_rows)
MEDICATIONS_STORE = medications_writes.Store()
# Client Finances: a transaction, a receipt, a month closed, an opening, a card import, the vocabularies, a TrueLink run
# and the finance papers kept (app.finance_writes / _receipts; rows app.resource_rows, files the documents folder)
FINANCE_STORE = generic_rows_writes.FinanceStore()
# My World: a world made, its apps published, removed or furnished, its tabs' rows written (app.my_world_writes /
# _receipts; the worlds themselves app.worlds, app.world_tabs, app.world_rows, their changes app.world_changes)
WORLD_STORE = world_writes.Store()
# Questionnaires: a person's answers, scored and kept in app.questionnaire_responses (app.questionnaires_writes /
# _receipts)
QUESTIONNAIRES_STORE = questionnaires_writes.Store()
# Support Requests: a verdict, an ADP change applied or undone, an inbox answer, the settings save and My Calendar's
# vacation filing (app.support_desk_writes / _receipts)
SUPPORT_DESK_STORE = support_desk_writes.Store()
# My Calendar's vacation filing beside them, under the same store
support_desk_writes.ACTIONS.update(support_desk_vacation.ACTIONS)
support_desk_writes.POLICY.update(support_desk_vacation.POLICY)
support_desk_writes.BUSY_OF.update(support_desk_vacation.BUSY_OF)
# Support Requests' missing punches: the relay's punch board judged (app.support_punch_writes / _receipts; rows
# app.edits)
SUPPORT_PUNCH_STORE = support_punch.Store()
# Settings › Contact sync's Fill phones (app.users_phone_fill_writes / _receipts; the phone cells app.edits)
USERS_PHONE_FILL_STORE = users_phone_fill.Store()
# Users' account doors (app.users_account_writes / _receipts: a removal's read overlay; the cells app.edits, carried to
# the sheet and a row removed by app.book_ops; a password by the sign-in's store, users_writes.CREDENTIALS): the edits,
# the accounts made and armed, the invitation, the release and the two merges, under one store
USERS_WRITES_STORE = users_writes.Store()
users_writes.ACTIONS.update(users_accounts.ACTIONS)
users_writes.POLICY.update(users_accounts.POLICY)
users_writes.BUSY_OF.update(users_accounts.BUSY_OF)
users_writes.ACTIONS.update(users_merge_apply.ACTIONS)
users_writes.POLICY.update(users_merge_apply.POLICY)
users_writes.BUSY_OF.update(users_merge_apply.BUSY_OF)
users_writes.ACTIONS.update(users_invite.ACTIONS)
users_writes.POLICY.update(users_invite.POLICY)
users_writes.ACTIONS.update(release_user_writes.ACTIONS)
users_writes.POLICY.update(release_user_writes.POLICY)
# profileUpdate whole: the account's own row and its password beside a place's profile, under the Account profile store
account_profile_writes.ACTIONS.update(profile_account_writes.ACTIONS)
account_profile_writes.BUSY_OF.update(profile_account_writes.BUSY_OF)
# Compliance: the scorecard, the matrix and the review queue read off the Master; a review's verdict
# (app.compliance_writes / _receipts; verdicts app.resource_rows, the legacy stamp and the Master date app.edits)
COMPLIANCE_STORE = compliance_writes.Store()
# Learning: a person's attempt and a competency saved (app.learning_writes / _receipts)
LEARNING_STORE = generic_rows_writes.LearningStore()
# Time Reconciliation: punches, runs and errors kept in Postgres (app.resource_rows); an upload's, an import's and a
# run's rows recorded after their prepare reads, an error resolved or reminded, a run closed, the thresholds saved
# (app.recon_writes / _receipts, the auto run's mark app.recon_auto)
RECON_STORE = recon_writes.Store()
# the Decoder lab: a scan's proposals, a proposal decided, a paper taught (app.digestlab_writes / _receipts); its Try
# (a Drive file read and OCR'd) stays the relay's
DIGEST_STORE = digest_lab_writes.Store()
# House Supplies: the pharmacy's reports in the lane's own tables (app.hub_med_*); a PatID matched and the staged files
# committed here, the folder read and the workbooks opened by the relay
HOUSE_MEDS_STORE = house_meds.Store()
house_meds.bind(HOUSE_MEDS_STORE)
# Staff Performance: its writes kept in app.edits over the perf_* tabs, its receipts in app.performance_receipts
PERFORMANCE_STORE = writes.Store(kind="performance", label="Staff Performance")
# Staff Performance's metric definitions and reviews beside its board, a review kept in app.edits under its store
performance.ACTIONS.update(performance_doors.READS)
performance.POLICY.update(performance_doors.READ_POLICY)
performance.WRITE.ACTIONS.update(performance_doors.ACTIONS)
performance.WRITE.POLICY.update(performance_doors.POLICY)
# Chat: its messages, presence and receipts in its own tables (app.chat_*), nothing laid over a sheet
CHAT_STORE = chat.Store()
# Settings' last tools: Quo Enrich's cells, the legacy import's facts (app.edits), the contact clock
# (app.contact_sweep_clock) and their receipts (app.settings_tools_writes / _receipts)
SETTINGS_TOOLS_STORE = settings_tools_writes.Store()
# the outbox made: only then can a door have raised anything into it
SMART_COMMS_READY = [False]
# My Work, My Profile, My Calendar and My Inbox: the lanes' reads, asked by the relay for the scope it decided
APPS = {"locations": locations, "clients": client_app, "staff": staff_app, "ssa": ssa, "family": family,
        "scheduling": scheduling_app, "transportation": transportation, "editions": editions,
        "emergency-contacts": emergency_contacts, "candidates": candidates, "client-candidates": client_candidates,
        "my-work": my_work, "my-profile": my_profile, "cert-docs": cert_docs, "my-calendar": my_calendar,
        "my-inbox": my_inbox, "smart-comms": smart_comms_desk, "forms": forms, "docs": docs,
        "support-desk": support_desk, "learning": learning, "time-recon": recon, "digestlab": digest_lab,
        "house-supplies": house_meds, "photos": photos, "dr-appointments": dr_appointments, "performance": performance,
        "call-offs": call_offs, "ui-incidents": ui_incidents, "hotline": hotline, "questionnaires": questionnaires,
        "house-repair": house_repair,
        "shiftboard": shift_board, "onboarding": onboarding, "hiring": hiring, "staff-alerts": staff_alerts,
        "audits": audits, "billing": billing, "equipment": equipment,
        "support-requests": support_requests, "suggestions": suggestions, "staffissues": staff_issues,
        "interviews": interviews, "logs": system_logs, "calendar": company_calendar, "teamboard": team_board,
        "overview": overview, "widgets": widget_bank, "imagebank": image_bank, "employee-loans": employee_loans,
        "broadcast": comm_broadcast, "letters": letters, "app-release": app_release,
        "team-alerts": team_alerts, "audit-library": doc_rooms, "reminders": reminders,
        "med-delegation": med_del, "ist": ist, "compliance-engine": compliance_engine, "houses": houses,
        "myasa": my_asa, "taskboard": task_board, "isp": isp, "email-designs": mail_designs, "comms-send": comms_rpc,
        "potential-clients": potential_clients, "client-care": client_care, "smart-clock": smart_clock,
        "opt-outs": opt_outs, "line-directory": line_directory, "timeoff": time_off_rows, "travel": travel,
        "comm-routes": comm_routes, "comm-when": comm_when, "comm-calls": comm_calls, "comm-record": comm_record,
        "comm-repair": comm_repair, "comm-replies": comm_replies, "alerts-config": alerts_config,
        "open-shift-covered": comm_open_shift_covered, "comm-recruit": comm_recruit, "comm-mock": comm_mock,
        "comm-window-ask": comm_window_ask, "comm-call-off": comm_call_off,
        "comm-call-off-form": comm_call_off_form, "quo": quo, "support-punch": support_punch,
        "lane-mirror": lane_mirror, "dup-scan": dup_scan, "call-off-form-sweep": call_off_form_sweep,
        "comm-bindings": comm_bindings,
        "users-phone-fill": users_phone_fill, "compliance": compliance, "contact-guard": contact_guard,
        "emp360": emp360, "contacts-sync": contacts_sync, "people-merge": people_merge,
        "meals": meals, "shopper": shopper, "inventory": inventory, "studio": studio, "app-control": app_control,
        "prefs": prefs, "alert-receive": alert_receive, "palette": palette, "account-profile": account_profile,
        "members": members, "tenant-ensure": tenant_ensure,
        "user-profiles": user_profiles, "users-directory": users_directory, "users-writes": users_writes,
        "staff-docs": staff_docs,
        "my-family": my_family, "books": books,
        "files": files_docs,
        "taskboard-sheet": sheet_board, "opsdash": opsdash, "release-users": release_users,
        "people-roster": people_roster,
        "administration": admin_docs, "production-actions": production_actions, "academy": academy, "mar": mar,
        "med-deliveries": med_deliveries, "marketing": marketing, "expenses": expenses, "technology": technology,
        "visits": visits,
        "leadership": leadership, "cortex": cortex, "mail": platform_mail, "sleep": sleep, "policy-acks": policies,
        "family-portal": family_portal, "guardian": guardian, "render-sheet": render_sheet,
        "hydration": wellbeing, "workout": wellbeing, "ideal-meals": wellbeing, "medications": medications,
        "finance": finance, "sheet-tabs": sheet_tabs, "config-lane": config_lane, "master-overview": master_overview,
        "settings-tools": settings_tools}
# the JSON lane's bundles (Bundle.gs), asked by the relay's own identity and the master's own session
APPS["bundles"] = bundles
# the Directors list (Directors.gs) and Settings › Platform health (Resolver.gs, Rpc.gs rpcAbilities): Python's alone
APPS.update({"directors": directors, "resolver": resolver_doors})
# the relay's reads of asa-hub-db's copy of the sheets, where it read the old platform's mirror
APPS["hub-rows"] = hub_rows
WRITES = {"locations": writes, "clients": client_writes, "staff": staff_writes, "ssa": ssa_writes,
          "family": family_writes, "scheduling": scheduling_writes, "transportation": transportation_writes,
          "editions": editions.WRITE, "emergency-contacts": emergency_contacts.WRITE, "candidates": candidate_writes,
          "client-candidates": client_candidate_writes, "my-profile": my_profile_writes, "cert-docs": cert_docs.WRITE,
          "my-inbox": my_inbox_writes, "smart-comms": smart_comms_writes, "forms": forms_writes, "docs": docs_writes,
          "support-desk": support_desk_writes, "learning": learning_writes, "time-recon": recon_writes,
          "digestlab": digest_lab_writes, "house-supplies": house_meds.WRITE, "my-work": my_work_writes,
          "performance": performance.WRITE, "call-offs": call_offs_writes, "hotline": hotline_writes,
          "house-repair": house_repair_writes, "ui-incidents": ops_stragglers_writes.UI_INCIDENTS,
          "people-roster": ops_stragglers_writes.PEOPLE_DOORS,
          "shiftboard": shift_board_writes, "onboarding": onboarding_writes, "hiring": hiring_writes,
          "audits": audits_writes, "billing": billing_writes, "equipment": equipment_writes,
          "staff-alerts": staff_alerts_writes,
          "support-requests": support_requests_writes, "suggestions": suggestions_writes,
          "staffissues": staff_issues_writes, "interviews": interviews_writes,
          "questionnaires": questionnaires_writes, "calendar": company_calendar_writes,
          "teamboard": team_board_writes, "overview": overview_writes, "widgets": widget_bank_writes,
          "imagebank": image_bank_writes, "employee-loans": employee_loans_writes, "broadcast": comm_broadcast_writes,
          "letters": letters_writes, "app-release": app_release_writes,
          "team-alerts": team_alerts_writes, "audit-library": doc_rooms_writes, "reminders": reminders_writes,
          "med-delegation": med_del_writes, "ist": ist_writes, "compliance-engine": compliance_engine_writes,
          "myasa": my_asa_writes, "taskboard": task_board_writes, "isp": isp_writes,
          "email-designs": mail_designs_writes, "comms-send": comms_rpc, "potential-clients": potential_clients_writes,
          "client-care": client_care_writes, "smart-clock": smart_clock_writes, "opt-outs": opt_outs_writes,
          "line-directory": line_directory_writes, "timeoff": time_off_writes, "travel": travel_writes,
          "comm-routes": comm_routes_writes, "comm-when": comm_when_writes, "comm-calls": comm_calls_writes,
          "comm-record": comm_record_writes, "comm-repair": comm_repair_writes, "comm-replies": comm_replies_writes,
          "alerts-config": alerts_config_writes,
          "open-shift-covered": comm_open_shift_covered_writes, "comm-recruit": comm_recruit_writes,
          "comm-mock": comm_mock_writes, "comm-window-ask": comm_window_ask_writes,
          "comm-call-off": comm_call_off_writes,
          "comm-call-off-form": comm_call_off_form_writes, "quo": quo_writes,
          "lane-mirror": lane_mirror_writes, "dup-scan": dup_scan_writes,
          "call-off-form-sweep": call_off_form_sweep_writes, "comm-bindings": comm_bindings_writes,
          "support-punch": support_punch, "users-phone-fill": users_phone_fill, "compliance": compliance_writes,
          "emp360": emp360_writes, "contacts-sync": contacts_sync_writes,
          "meals": meals_writes, "shopper": shopper_writes, "inventory": inventory_writes, "studio": studio_writes,
          "prefs": prefs_writes, "alert-receive": alert_receive_writes, "account-profile": account_profile_writes,
          "app-control": app_control_writes,
          "members": members_writes, "tenant-ensure": tenant_ensure_writes,
          "users-writes": users_writes,
          "staff-docs": staff_docs_writes, "books": books_writes, "files": files_docs_writes,
          "taskboard-sheet": sheet_board_writes, "administration": admin_docs_writes,
          "production-actions": production_actions_writes, "academy": academy_writes, "mar": mar_writes,
          "med-deliveries": med_deliveries_writes, "marketing": marketing_writes, "expenses": expenses_writes,
          "visits": visits_writes,
          "technology": technology_writes, "mail": platform_mail_writes, "policy-acks": policies_writes,
          "family-portal": family_portal_writes, "render-sheet": render_sheet_writes,
          "medications": medications_writes, "finance": finance_writes, "settings-tools": settings_tools_writes}
# My World: each person's own world in Postgres — its registry row, its apps and, for an envelope naming it, its tabs
APPS["my-world"] = world
WRITES["my-world"] = world_writes
# the last of route()'s own resources: each answered by the app whose rows they are (app/generic_rows*.py), the Directors
# list's writes beside its reads
for _app_id, _doors in generic_rows.READS_OF.items():
    APPS[_app_id].ACTIONS.update(_doors)
    APPS[_app_id].POLICY.update(generic_rows.POLICY_OF[_app_id])
for _app_id, _safe in generic_rows.PLACE_SAFE_OF.items():
    APPS[_app_id].PLACE_SAFE = frozenset(getattr(APPS[_app_id], "PLACE_SAFE", ())) | _safe
for _app_id, _doors in generic_rows_writes.WRITES_OF.items():
    WRITES[_app_id].ACTIONS.update(_doors)
    WRITES[_app_id].POLICY.update(generic_rows_writes.POLICY_OF[_app_id])
    WRITES[_app_id].BUSY_OF.update(generic_rows_writes.BUSY_OF_OF[_app_id])
for _app_id, _safe in generic_rows_writes.PLACE_SAFE_OF.items():
    WRITES[_app_id].PLACE_SAFE = frozenset(getattr(WRITES[_app_id], "PLACE_SAFE", ())) | _safe
WRITES["directors"] = types.SimpleNamespace(ACTIONS=generic_rows_writes.DIRECTORS_ACTIONS,
                                            POLICY=generic_rows_writes.DIRECTORS_POLICY,
                                            BUSY_OF=generic_rows_writes.DIRECTORS_BUSY)
DIRECTORS_STORE = generic_rows_writes.DirectorsStore()
# the own writes an answer names for the relay; past this many it names none and the relay trusts it less
OWN_NAMED_MAX = 40
# a document's bytes, read off the server's copy: no kept edit changes them, so none is laid; the house and the
# viewer it checks are the copy's
UNLAID_READS = frozenset({"locationDocFile", "adminDocFile", "academyVideoFile", "techDocFile", "policyDocFile",
                          "taskFile", "ispPlanPdf", "finDocFile", "inventorySupplyFile"})
# a write decided later than this is not recorded (its caller has stopped waiting): inside the internal callers' 60 s
# (clocks.PACK_S) and nginx's 300 s on /gas
WRITE_BUDGET_S = float(os.getenv("HUB_APP_WRITE_BUDGET_S", "50"))
# who reads what changed after the copy an answer rests on (the relay's people_at): Python's own 503, never Apps Script's
UNSETTLED = {"status": 503, "message": "This could not be read just now. Try again in a moment."}
UNSETTLED_WRITE = {"status": 503,
                   "message": "This change could not be saved just now, and nothing was written. Try again in a moment."}


class _Unsettled(Exception):
    """A write decided on a copy older than the relay's last change of who reads what: rolled back, never kept."""


def stores() -> dict[str, writes.Store]:
    """Each app's write store, as this module holds it now."""
    return {"locations": STORE, "clients": CLIENT_STORE, "staff": STAFF_STORE, "ssa": SSA_STORE, "family": FAMILY_STORE,
            "scheduling": SCHEDULING_STORE, "transportation": TRANSPORTATION_STORE, "editions": EDITIONS_STORE,
            "emergency-contacts": EMERGENCY_CONTACTS_STORE, "candidates": CANDIDATES_STORE,
            "client-candidates": CLIENT_CANDIDATES_STORE, "my-profile": MY_PROFILE_STORE, "cert-docs": CERT_DOCS_STORE,
            "my-inbox": MY_INBOX_STORE, "smart-comms": SMART_COMMS_STORE, "forms": FORMS_STORE, "docs": DOCS_STORE,
            "support-desk": SUPPORT_DESK_STORE, "learning": LEARNING_STORE, "time-recon": RECON_STORE,
            "digestlab": DIGEST_STORE, "house-supplies": HOUSE_MEDS_STORE, "my-work": MY_WORK_STORE,
            "performance": PERFORMANCE_STORE, "call-offs": CALL_OFFS_STORE, "hotline": HOTLINE_STORE,
            "house-repair": HOUSE_REPAIR_STORE, "ui-incidents": UI_INCIDENTS_STORE,
            "people-roster": PEOPLE_ROSTER_STORE,
            "shiftboard": SHIFT_BOARD_STORE, "onboarding": ONBOARDING_STORE, "hiring": HIRING_STORE,
            "audits": AUDITS_STORE, "billing": BILLING_STORE, "equipment": EQUIPMENT_STORE,
            "staff-alerts": STAFF_ALERTS_STORE,
            "support-requests": SUPPORT_REQUESTS_STORE, "suggestions": SUGGESTIONS_STORE,
            "staffissues": STAFF_ISSUES_STORE, "interviews": INTERVIEWS_STORE,
            "questionnaires": QUESTIONNAIRES_STORE, "calendar": CALENDAR_STORE, "teamboard": TEAM_BOARD_STORE,
            "overview": OVERVIEW_STORE, "widgets": WIDGET_BANK_STORE, "imagebank": IMAGE_BANK_STORE,
            "employee-loans": EMPLOYEE_LOANS_STORE, "broadcast": BROADCAST_STORE, "letters": LETTERS_STORE,
            "app-release": APP_RELEASE_STORE, "team-alerts": TEAM_ALERTS_STORE, "audit-library": DOC_ROOMS_STORE,
            "med-delegation": MED_DEL_STORE, "ist": IST_STORE, "compliance-engine": COMPLIANCE_ENGINE_STORE,
            "myasa": MY_ASA_STORE, "taskboard": TASK_BOARD_STORE, "isp": ISP_STORE,
            "email-designs": MAIL_DESIGNS_STORE, "comms-send": COMMS_RPC_STORE,
            "potential-clients": POTENTIAL_CLIENTS_STORE, "client-care": CLIENT_CARE_STORE,
            "smart-clock": SMART_CLOCK_STORE, "opt-outs": OPT_OUTS_STORE, "line-directory": LINE_DIRECTORY_STORE,
            "comm-routes": COMM_ROUTES_STORE, "comm-when": COMM_WHEN_STORE, "comm-calls": COMM_CALLS_STORE,
            "comm-record": COMM_RECORD_STORE, "comm-repair": COMM_REPAIR_STORE, "comm-replies": COMM_REPLIES_STORE,
            "alerts-config": ALERTS_CONFIG_STORE,
            "open-shift-covered": COMM_COVERED_STORE, "comm-recruit": COMM_RECRUIT_STORE, "comm-mock": COMM_MOCK_STORE,
            "comm-window-ask": COMM_WINDOW_ASK_STORE, "comm-call-off": COMM_CALL_OFF_STORE,
            "comm-call-off-form": COMM_CALL_OFF_FORM_STORE, "quo": QUO_STORE,
            "lane-mirror": LANE_MIRROR_STORE, "dup-scan": DUP_SCAN_STORE,
            "call-off-form-sweep": CALL_OFF_FORM_SWEEP_STORE, "comm-bindings": COMM_BINDINGS_STORE,
            "support-punch": SUPPORT_PUNCH_STORE, "users-phone-fill": USERS_PHONE_FILL_STORE,
            "compliance": COMPLIANCE_STORE, "emp360": EMP360_STORE, "contacts-sync": CONTACTS_SYNC_STORE,
            "timeoff": TIME_OFF_STORE, "travel": TRAVEL_STORE, "meals": MEALS_STORE, "reminders": REMINDERS_STORE,
            "my-world": WORLD_STORE,
            "shopper": SHOPPER_STORE, "inventory": INVENTORY_STORE, "studio": STUDIO_STORE, "prefs": PREFS_STORE,
            "alert-receive": ALERT_RECEIVE_STORE, "account-profile": ACCOUNT_PROFILE_STORE,
            "app-control": APP_CONTROL_STORE,
            "members": MEMBERS_STORE, "tenant-ensure": TENANT_ENSURE_STORE,
            "users-writes": USERS_WRITES_STORE,
            "staff-docs": STAFF_DOCS_STORE, "books": BOOKS_STORE, "files": FILES_STORE,
            "taskboard-sheet": SHEET_BOARD_STORE,
            "administration": ADMIN_DOCS_STORE, "production-actions": PRODUCTION_ACTIONS_STORE,
            "academy": ACADEMY_STORE, "mar": MAR_STORE, "med-deliveries": MED_DELIVERIES_STORE,
            "marketing": MARKETING_STORE, "expenses": EXPENSES_STORE, "technology": TECHNOLOGY_STORE,
            "visits": VISITS_STORE,
            "mail": PLATFORM_MAIL_STORE, "policy-acks": POLICIES_STORE, "family-portal": FAMILY_PORTAL_STORE,
            "render-sheet": RENDER_SHEET_STORE, "medications": MEDICATIONS_STORE, "finance": FINANCE_STORE,
            "settings-tools": SETTINGS_TOOLS_STORE, "directors": DIRECTORS_STORE}


def _smart_comms_ensure() -> str:
    """The outbox and the arm made when missing; '' when ready, else why not."""
    try:
        why = smart_comms.ensure(SMART_COMMS_STORE.conn())
    except Exception as exc:  # noqa: BLE001 - said on /healthz; nothing owed can leave meanwhile
        why = f"the Smart Comms outbox is not ready ({type(exc).__name__})"
    if not why:
        try:
            seeded = smart_comms.seed(SMART_COMMS_STORE, DB)
            if seeded:
                log.info("smart comms: situations seeded — %s", ", ".join(seeded))
        except Exception as exc:  # noqa: BLE001 - asked again at the next start; a raise meanwhile says it is off
            log.warning("smart comms: the seeded situations were not kept (%s)", type(exc).__name__)
    SMART_COMMS_READY[0] = not why
    return why


async def _smart_comms_drain() -> None:
    """The outbox made (asked again each minute until it is), then drained until the app stops."""
    said = None
    while True:
        why = await run_in_threadpool(_smart_comms_ensure)
        if why != said:
            log.info("smart comms outbox: %s", why or "ready")
            said = why
        if not why:
            break
        await asyncio.sleep(60.0)
    await smart_comms.drain_forever(SMART_COMMS_STORE.conn)


def _smart_comms_status() -> dict[str, Any]:
    if not SMART_COMMS_READY[0]:
        return {"ready": False}
    try:
        return {"ready": True, **smart_comms.status(SMART_COMMS_STORE.conn())}
    except Exception as exc:  # noqa: BLE001 - said, never raised: /healthz answers for every other store
        return {"ready": True, "why": type(exc).__name__}


SCHED_SHEET_IMPORT_EVERY_S = float(os.getenv("HUB_SCHED_SHEET_IMPORT_EVERY_S", "600"))
# the mirror's stamp the houses were last laid level with: the clock's loop and the master's reload share it
SCHED_SHEET_LAST: list[Any] = [None]


def _sched_sheet_import(last: list[Any]) -> str:
    """One pass of scheduling_import as the clock's loop says it: why it could not run, what it changed, or ''."""
    got = _sched_sheet_level(last)
    return got.get("why") or got["said"]


def _sched_sheet_level(last: list[Any]) -> dict[str, Any]:
    """One pass of scheduling_import: the House Calendars mirror read, and, when it moved since the last pass, every
    house's own-calendar-less period laid level with its sheet as one final write under the platform's lock.
    {why} when it could not run; else {report, said}: no report when the mirror had not moved, said '' when every
    house already read as its sheet."""
    if not SCHEDULING_STORE.ready():
        return {"why": SCHEDULING_STORE.why or "the Scheduling write store is not ready"}
    got = mw_relay_state.rows("asa_house_calendar_live", columns=("location", "grid", "updated_at"))
    stamp = max((str(r.get("updated_at") or "") for r in got), default="")
    if not got:
        return {"why": "the House Calendars mirror holds no house"}
    if stamp == last[0]:
        return {"report": None, "said": ""}
    grids = {str(r.get("location") or ""): my_calendar.house_cal_live._as_dict(r.get("grid")) for r in got}
    write_id = f"sched-sheet-{int(time.time())}"
    with SCHEDULING_STORE.locked() as tx:
        edits = tx.edits()
        own = client_writes.Own([{**w, "store": "scheduling"} for w in tx.live()] + (_live(but="scheduling") or []),
                                book=DB.book, edits=edits, edits_at=time.time())
        token = hubdb.OWN.set(own)
        try:
            decision, report = scheduling_import.decide(locations.Reads(DB, DRIVE), grids)
            if decision is not None:
                tx.record(write_id, scheduling_import.ACTION, js_json(decision.answer), decision, scheduling_import.BY)
        finally:
            hubdb.OWN.reset(token)
    last[0] = stamp
    if decision is None:
        return {"report": report, "said": ""}
    return {"report": report, "said": f"{decision.answer['data']['said']} (houses {report['houses']}, kept "
                                      f"{report['kept_own']}, own calendars {report['periods_own']})"}


async def _sched_sheet_import_loop() -> None:
    """scheduling_import every HUB_SCHED_SHEET_IMPORT_EVERY_S (0: never), the first a minute after the stores are up."""
    last = SCHED_SHEET_LAST
    await asyncio.sleep(60.0)
    while True:
        try:
            said = await run_in_threadpool(_sched_sheet_import, last)
            if said:
                log.info("scheduling sheet import: %s", said)
        except (writes.Busy, sc.Defer, hubdb.Unreadable) as exc:
            log.info("scheduling sheet import: not now (%s)", exc or type(exc).__name__)
        except Exception:  # noqa: BLE001 - the next pass tries again; nothing was kept from this one
            log.exception("scheduling sheet import failed")
        await asyncio.sleep(SCHED_SHEET_IMPORT_EVERY_S)


# SCHEDULING › HOUSE CALENDARS' RELOAD (the operator, 2026-10-29): the clock's read of the house calendars and its
# import, run now on the master's press. The sheet newer than the copy kept is read again and laid in; a copy as new as
# the sheet is left as it stands, and so is every cell changed in Scheduling and every period the Builder published.
SCHED_SHEET_RELOAD_LANE = "/hub-lanes/scheduling-sheet-reload"
SCHED_SHEET_RELOAD_S = float(os.getenv("HUB_SCHED_SHEET_RELOAD_S", "85"))
WORKER_URL = (os.getenv("HUB_WORKER_URL") or "http://asa-hub-worker:8091").rstrip("/")
SHEET_UNREAD = {"status": 503, "message": "The house calendars could not be read just now — try again in a minute."}
SHEET_READ_NOT_LAID = {"status": 409, "message": "The sheet was read, but Scheduling is busy just now — the calendars "
                                                 "take it within ten minutes, or press reload again."}


async def _sched_sheet_reload(request: Request) -> Response:
    """The master's alone (route_switches._master_door: anyone else is told the lane does not exist): asa-hub-worker
    reads the house calendars' workbook again only when it moved past the copy kept, then the houses are laid level
    with the copy at once, as the clock's import lays them."""
    import httpx  # noqa: PLC0415
    import lane_gate as LG  # noqa: PLC0415
    import route_switches as RS  # noqa: PLC0415 - it is installed below

    _s, refused = await RS._master_door(request)  # noqa: SLF001
    if refused is not None:
        return LG.answer(refused, no_store=True)
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(SCHED_SHEET_RELOAD_S, connect=5.0)) as client:
            res = await client.post(f"{WORKER_URL}/calendars/live-now", json={}, headers={"x-hub-token": TOKEN})
        sheet = res.json() if res.status_code == 200 else None
    except Exception as exc:  # noqa: BLE001 - the type only
        log.warning("scheduling sheet reload: asa-hub-worker was not reached (%s)", type(exc).__name__)
        sheet = None
    if not isinstance(sheet, dict) or "status" not in sheet:
        return LG.answer(SHEET_UNREAD, no_store=True)
    if sheet["status"] != 200:
        return LG.answer({"status": sheet["status"], "message": str(sheet.get("message") or SHEET_UNREAD["message"])},
                         no_store=True)
    read = sheet.get("data") or {}
    try:
        level = await run_in_threadpool(_sched_sheet_level, SCHED_SHEET_LAST)
    except (writes.Busy, sc.Defer, hubdb.Unreadable) as exc:
        log.info("scheduling sheet reload: read, not laid (%s)", exc or type(exc).__name__)
        return LG.answer(SHEET_READ_NOT_LAID, no_store=True)
    if level.get("why"):
        return LG.answer({"status": 503, "message": f"The sheet was read, but not laid in: {level['why']}."},
                         no_store=True)
    report = level.get("report") or {}
    counts = {k: int(report.get(k) or 0) for k in ("added", "changed", "cleared", "rows_added")}
    log.info("scheduling sheet reload by the master: sheet ahead %s (%s house(s) read); %s", bool(read.get("ahead")),
             read.get("live_houses", 0), level.get("said") or "every house already read as its sheet")
    return LG.answer({"status": 200, "data": {
        "ahead": bool(read.get("ahead")), "sheet_at": str(read.get("sheet_at") or ""),
        "copy_at": str(read.get("copy_at") or ""), "houses_read": int(read.get("live_houses") or 0),
        "why": str(read.get("why") or ""), **counts}}, no_store=True)


LOCATION_DOCS_EVERY_S = float(os.getenv("HUB_LOCATION_DOCS_EVERY_S", "1800"))


async def _location_docs_loop() -> None:
    """location_docs every HUB_LOCATION_DOCS_EVERY_S (0: never): Locations' documents copied out of Drive onto the
    server, the first two minutes after the start."""
    await asyncio.sleep(120.0)
    while True:
        try:
            said = await run_in_threadpool(location_docs.sync, locations.Reads(DB, DRIVE))
            log.info("location docs: %s", said)
        except (sc.Defer, hubdb.Unreadable) as exc:
            log.info("location docs: not now (%s)", exc or type(exc).__name__)
        except Exception:  # noqa: BLE001 - the next pass tries again; every copy already made stays
            log.exception("location docs failed")
        await asyncio.sleep(LOCATION_DOCS_EVERY_S)


@contextlib.asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    for app_id, store in stores().items():
        if store.available:
            why = await run_in_threadpool(store.ensure)
            log.info("write store (%s): %s", app_id, why or "ready")
    drain = asyncio.create_task(_smart_comms_drain()) if SMART_COMMS_STORE.available else None
    sheets = asyncio.create_task(_sched_sheet_import_loop()) \
        if SCHEDULING_STORE.available and SCHED_SHEET_IMPORT_EVERY_S > 0 else None
    docs = asyncio.create_task(_location_docs_loop()) if LOCATION_DOCS_EVERY_S > 0 else None
    import master_grid_lanes  # noqa: PLC0415 - the master record's daily look at the sheet (app/master_grid_lanes.py)
    master = asyncio.create_task(master_grid_lanes.daily())
    # the books people and forms still post to (the followed books, the Dr Appointments book), swept straight from
    # Google into their tables three times a day (app/essential_sheets.py). The hourly follow and the Dr book's daily
    # look read the sheet copies, which nothing refreshes since the keeper left the old platform: they are not started.
    import essential_sheets  # noqa: PLC0415
    doctors = None
    followed = asyncio.create_task(essential_sheets.thrice(STAFF_STORE, lambda: locations.Reads(DB, DRIVE))) \
        if STAFF_STORE.available else None
    # PSI Log's collection: everything PsiAnywhere answers about staff and clients, once a day (app/psi_harvest.py)
    import psi_harvest  # noqa: PLC0415
    psi_daily = asyncio.create_task(psi_harvest.daily(STAFF_STORE)) if STAFF_STORE.available else None
    import clocks  # noqa: PLC0415 - the relay's clocks and the Quo pipeline (app/clocks.py)
    clocks.start()
    import attendance_loop  # noqa: PLC0415 - the relay's PSI attendance loop (app/attendance_loop.py)
    attendance_loop.start()
    try:
        yield
    finally:
        await attendance_loop.stop()
        await clocks.stop()
        smart_comms.stop()
        for task in (drain, sheets, docs, master, doctors, followed, psi_daily):
            if task is not None:
                task.cancel()
                with contextlib.suppress(asyncio.CancelledError, Exception):
                    await task


app = FastAPI(title="asa-hub-app", docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)


def js_json(v: Any) -> Any:
    """JSON.stringify's numbers: a whole float is written as an integer."""
    if isinstance(v, float):
        return int(v) if math.isfinite(v) and v == int(v) and abs(v) < 1e15 else v
    if isinstance(v, dict):
        return {k: js_json(x) for k, x in v.items()}
    if isinstance(v, list):
        return [js_json(x) for x in v]
    return v


def defer(why: str, code: int = 503) -> JSONResponse:
    """Not this service's answer: the relay asks Apps Script instead."""
    return JSONResponse({"defer": why}, status_code=code, headers={"Cache-Control": "no-store"})


def caller(said: dict[str, Any], reads: locations.Reads, action: str = "", module: Any = None) -> dict[str, Any]:
    """The session the relay verified, completed from its own users row as Apps Script's session is, standing where its
    envelope names (app/envelope.py); envelope.Refused is doPost's own answer before the door."""
    user = _caller(said, reads, action, module)
    # a session minted from the master's own, as the relay says (Apps Script's beAnotherActive_)
    if said.get("acting") is True and not user.get("is_service"):
        user = {**user, "acting": True}
    # a session whose acts leave no line in the audit history, as the relay says
    return {**user, "unlogged": True} if said.get("unlogged") is True and not user.get("is_service") else user


def _caller(said: dict[str, Any], reads: locations.Reads, action: str = "", module: Any = None) -> dict[str, Any]:
    """doPost's session (sessionUser_), then where it stands: the place, the visit and the world the relay's signed
    x-hub-user names, settled for every door as Main.gs settles them (envelope.settle)."""
    user = _session(said, reads)
    return envelope.settle(user, said, reads, action, module)


def _session(said: dict[str, Any], reads: locations.Reads) -> dict[str, Any]:
    if said.get("is_service") is True:
        return {"is_service": True, "role": "admin", "id": "", "email": ""}
    if said.get("public") is True:
        return dict(PUBLIC_CALLER)
    uid = gsjs.trim(str(said.get("uid") or ""))
    role = gsjs.trim(str(said.get("role") or "")).lower()
    if not uid or not role:
        raise sc.Defer("the relay named no account")
    row = next((u for u in reads.users() if gsjs.str_(u.get("userid")) == uid and not gsjs.str_(u.get("mergedinto"))),
               None)
    if said.get("is_master") is True:
        # the master is never built from the flag alone: without the users row the backend answers as before
        if row is None:
            raise sc.Defer("the master's users row is not in asa-hub-db")
        user = sc.user_from_row(row)
        if not sc.is_real_master(user):
            raise sc.Defer("the relay's master is not the master on the users row")
        return user
    if row is None:
        raise sc.Defer("the account's users row is not in asa-hub-db")
    user = sc.user_from_row(row)
    if user["role"].lower() != role or sc.is_real_master(user):
        raise sc.Defer("the users row and the session disagree")
    return user


def policy_gate(module: Any, action: str, payload: dict[str, Any], user: dict[str, Any]) -> dict[str, Any] | None:
    """hubPolicyGate_: the platform's own Settings doors (the master's and the Platform Lead's), the declared roles,
    then the typed params."""
    if action in sc.SETTINGS_LEAD_DOORS and not user.get("is_service") and not sc.settings_lead(user):
        return {"status": 404, "message": "Unknown action."}
    pol = module.POLICY.get(action) or {}
    roles = pol.get("roles") or ()
    if roles and not user.get("is_service") and gsjs.js_str(user.get("role")) not in roles:
        return {"status": 403, "message": "This action is for " + " or ".join(roles) + "."}
    for key, kind in (pol.get("params") or {}).items():
        val = payload.get(key)
        if val is None or val == "":
            continue
        actual = ("array" if isinstance(val, list) else "boolean" if isinstance(val, bool)
                  else "number" if isinstance(val, (int, float)) else "string" if isinstance(val, str) else "object")
        if actual != kind:
            return {"status": 400, "message": f"{key} must be {kind}, got {actual}."}
    return None


@app.get("/healthz")
def healthz() -> dict[str, Any]:
    try:
        tabs = len(DB.catalog()["tabs"])
        return {"ok": True, "code": CODE_STAMP, "started_at": STARTED_AT,
                "tabs": tabs, "drive": DRIVE.available, "writes": STORE.ready(), "writes_why": STORE.why,
                "client_writes": CLIENT_STORE.ready(), "client_writes_why": CLIENT_STORE.why,
                "staff_writes": STAFF_STORE.ready(), "staff_writes_why": STAFF_STORE.why,
                "ssa_writes": SSA_STORE.ready(), "ssa_writes_why": SSA_STORE.why,
                "family_writes": FAMILY_STORE.ready(), "family_writes_why": FAMILY_STORE.why,
                "scheduling_writes": SCHEDULING_STORE.ready(), "scheduling_writes_why": SCHEDULING_STORE.why,
                "transportation_writes": TRANSPORTATION_STORE.ready(),
                "transportation_writes_why": TRANSPORTATION_STORE.why,
                "editions_writes": EDITIONS_STORE.ready(), "editions_writes_why": EDITIONS_STORE.why,
                "emergency_contacts_writes": EMERGENCY_CONTACTS_STORE.ready(),
                "emergency_contacts_writes_why": EMERGENCY_CONTACTS_STORE.why,
                "candidate_writes": CANDIDATES_STORE.ready(), "candidate_writes_why": CANDIDATES_STORE.why,
                "client_candidate_writes": CLIENT_CANDIDATES_STORE.ready(),
                "client_candidate_writes_why": CLIENT_CANDIDATES_STORE.why,
                "my_profile_writes": MY_PROFILE_STORE.ready(), "my_profile_writes_why": MY_PROFILE_STORE.why,
                "cert_docs_writes": CERT_DOCS_STORE.ready(), "cert_docs_writes_why": CERT_DOCS_STORE.why,
                "my_inbox_writes": MY_INBOX_STORE.ready(), "my_inbox_writes_why": MY_INBOX_STORE.why,
                "smart_comms_writes": SMART_COMMS_STORE.ready(), "smart_comms_writes_why": SMART_COMMS_STORE.why,
                "smart_comms_outbox": _smart_comms_status(),
                "forms_writes": FORMS_STORE.ready(), "forms_writes_why": FORMS_STORE.why,
                "docs_writes": DOCS_STORE.ready(), "docs_writes_why": DOCS_STORE.why,
                "learning_writes": LEARNING_STORE.ready(), "learning_writes_why": LEARNING_STORE.why,
                "recon_writes": RECON_STORE.ready(), "recon_writes_why": RECON_STORE.why,
                "digestlab_writes": DIGEST_STORE.ready(), "digestlab_writes_why": DIGEST_STORE.why,
                "house_meds_writes": HOUSE_MEDS_STORE.ready(), "house_meds_writes_why": HOUSE_MEDS_STORE.why,
                "my_work_writes": MY_WORK_STORE.ready(), "my_work_writes_why": MY_WORK_STORE.why,
                "performance_writes": PERFORMANCE_STORE.ready(), "performance_writes_why": PERFORMANCE_STORE.why,
                "support_desk_writes": SUPPORT_DESK_STORE.ready(),
                "support_desk_writes_why": SUPPORT_DESK_STORE.why,
                "chat": CHAT_STORE.ready(), "chat_why": CHAT_STORE.why,
                # My Work's relay state: its read-only DSN here, else the rows the relay hands in, else it defers
                "my_work_state": mw_relay_state.source() or "relay-handed, else deferred"}
    except Exception as exc:  # noqa: BLE001 - said, never raised
        return {"ok": False, "why": type(exc).__name__, "drive": DRIVE.available}


def _authorized(request: Request) -> bool:
    return bool(TOKEN) and hmac.compare_digest(request.headers.get("x-hub-token", ""), TOKEN)


@app.post("/v1/_auth/{action}")
async def auth_door(action: str, request: Request) -> Response:
    """The sign-in's doors (app/auth_doors.py), ahead of the generic one: the relay's calls alone, the session or the
    link in the body; what Apps Script keeps answering is said 409, any other door not answering 503."""
    if not _authorized(request):
        return defer("unauthorized", 401)
    if action not in auth_doors.DOORS:
        return defer("not a sign-in door", 404)
    try:
        body = json.loads(await request.body() or b"{}")
    except ValueError:
        return defer("unreadable call", 400)
    return await run_in_threadpool(_run_auth, action, body if isinstance(body, dict) else {})


def _own_locked(tx: writes.Tx) -> writes.Own:
    """The kept edits read under the platform's write lock, every store's accepted writes laid with them."""
    return client_writes.Own(_live() or [], book=DB.book, edits=tx.edits(), edits_at=time.time())


def _run_auth(action: str, body: dict[str, Any]) -> Response:
    started = time.time()
    # the master's own switch leaves no line anywhere
    said = action not in auth_doors.SESSION
    # doPost's auth branch: its line under the identifier asked with, the door's own copy of it said once; a door whose
    # acts leave no line keeps none
    door = sys_log.enter(action, {} if said else {"acting": True}, body.get("payload"), "auth")
    try:
        env = auth_doors.run(action, body, auth_doors.Context(DB, DRIVE, AUTH_STORE, _own, _own_locked))
    except auth_doors.HandBack as exc:
        if said:
            log.info("%s handed to Apps Script: %s", action, exc)
        return defer(str(exc), 409)
    except (sc.Defer, hubdb.Unreadable) as exc:
        if said:
            log.warning("%s not answered: %s", action, exc)
        return defer(str(exc))
    except Exception as exc:  # noqa: BLE001 - said by the relay, never handed to Apps Script
        if said:
            log.exception("%s failed", action)
        return defer(f"failed ({type(exc).__name__})", 500)
    finally:
        sys_log.leave(door)
    sys_log.keep(door, env)
    if said:
        log.info("%s answered %s in %.2fs", action, env.get("status", "-"), time.time() - started)
    return JSONResponse(env, headers={"Cache-Control": "no-store"})


@app.post("/v1/chat/{action}")
async def chat_door(action: str, request: Request) -> Response:
    """The chat's doors (app/chat.py), ahead of the generic one: its own tables, so no write is laid over its reads."""
    if not _authorized(request):
        return defer("unauthorized", 401)
    if action not in chat.ACTIONS:
        return defer("not a chat door", 404)
    try:
        said = json.loads(request.headers.get("x-hub-user") or "{}")
        body = json.loads(await request.body() or b"{}")
    except ValueError:
        return defer("unreadable call", 400)
    payload = body.get("payload") if isinstance(body.get("payload"), dict) else {}
    return await run_in_threadpool(_run_chat, action, said if isinstance(said, dict) else {}, payload,
                                   str(body.get("write_id") or ""))


def _run_chat(action: str, said: dict[str, Any], payload: dict[str, Any], write_id: str) -> Response:
    started = time.time()
    door = sys_log.Door(action, said, payload)
    try:
        reads = locations.Reads(DB, DRIVE)
        door.user = caller(said, reads, action, chat)
        env = chat.answer(CHAT_STORE, reads, door.user, action, payload, write_id)
    except envelope.Refused as no:
        env = no.answer
    except (sc.Defer, hubdb.Unreadable) as exc:
        log.warning("%s not answered: %s", action, exc)
        return defer(str(exc))
    except Exception as exc:  # noqa: BLE001 - the relay says 503; nothing is handed anywhere else
        log.exception("%s failed", action)
        return defer(f"failed ({type(exc).__name__})", 500)
    sys_log.keep(door, env)
    log.info("%s answered %s in %.3fs", action, env.get("status"), time.time() - started)
    return Response(json.dumps(js_json(env), separators=(",", ":"), ensure_ascii=False),
                    media_type="application/json", headers={"Cache-Control": "no-store"})


@app.post("/v1/{app_id}/_settle")
async def settle(app_id: str, request: Request) -> Response:
    """The relay's word on a write Python decided: queued, written, refused, or void (the relay did not use it)."""
    if not _authorized(request):
        return defer("unauthorized", 401)
    store = stores().get(app_id)
    if app_id not in WRITES or store is None or not store.available:
        return defer("no write store", 404)
    try:
        body = json.loads(await request.body() or b"{}")
    except ValueError:
        return defer("unreadable call", 400)
    write_id = str(body.get("write_id") or "")
    state = str(body.get("state") or "")
    fields = body.get("fields") if isinstance(body.get("fields"), list) else None
    if not writes.WRITE_ID.fullmatch(write_id) or state not in ("queued", "written", "refused", "void"):
        return defer("not a settlement", 400)
    try:
        done = await run_in_threadpool(store.settle, write_id, state, str(body.get("why") or ""),
                                       [str(f) for f in fields] if fields is not None else None)
    except hubdb.Unreadable as exc:
        log.warning("settle %s %s: %s", write_id, state, exc)
        return defer(str(exc))
    if state == "void" and done:
        # its log lines go with it (app.system_logs, app.log_events)
        await run_in_threadpool(sys_log.void, store, write_id)
        # a text the voided write owed never leaves
        try:
            await run_in_threadpool(lambda: smart_comms.void_write(store.conn(), write_id))
        except Exception as exc:  # noqa: BLE001 - the owed row still waits out its grace, said
            log.warning("settle %s void: its owed texts not withdrawn (%s)", write_id, type(exc).__name__)
            return defer("its owed texts could not be withdrawn")
    log.info("write %s settled %s%s", write_id, state, "" if done else " (nothing to settle)")
    return JSONResponse({"ok": True, "settled": bool(done)}, headers={"Cache-Control": "no-store"})


@app.post("/v1/{app_id}/{action}")
async def act(app_id: str, action: str, request: Request) -> Response:
    if not _authorized(request):
        return defer("unauthorized", 401)
    module = APPS.get(app_id)
    deciding = WRITES.get(app_id)
    write = deciding is not None and action in deciding.ACTIONS
    if module is None or (action not in module.ACTIONS and not write):
        return defer("not ported", 404)
    try:
        said = json.loads(request.headers.get("x-hub-user") or "{}")
        body = json.loads(await request.body() or b"{}")
    except ValueError:
        return defer("unreadable call", 400)
    payload = body.get("payload") if isinstance(body.get("payload"), dict) else {}
    said = said if isinstance(said, dict) else {}
    # nobody's account reaches an app's own public doors alone (PUBLIC_DOORS, each at its own app)
    if said.get("public") is True and (said.get("is_service") is True or action not in PUBLIC_DOORS or
                                       action not in PUBLIC_DOORS_BY_APP.get(app_id, frozenset())):
        return defer("not a public door", 403)
    # while the relay settles a change of who reads what it saw land, the moment it landed
    at = body.get("people_at")
    people_at = float(at) if isinstance(at, (int, float)) and not isinstance(at, bool) and at > 0 else 0.0
    if write:
        return await run_in_threadpool(_run_write, deciding, action, said, payload, str(body.get("write_id") or ""),
                                       people_at)
    return await run_in_threadpool(_run, module, action, said, payload, people_at)


# The sign-in (db/auth.sql): its own doors at /v1/_auth, the invitations' admin doors on the generic one under `auth`,
# and the one credential store every door that sets a password writes through (users_writes CREDENTIALS)
AUTH_STORE = auth_store.Store()
AUTH_INVITES_STORE = auth_invites_writes.Store()
APPS["auth"] = auth_invites
WRITES["auth"] = auth_invites_writes
users_writes.CREDENTIALS.update(set=auth_store.credential_put, void=auth_store.credential_void)
_stores_but_auth = stores


def stores() -> dict[str, writes.Store]:  # noqa: F811 - every app's, the invitations' with them
    """Each app's write store, as this module holds it now."""
    return {**_stores_but_auth(), "auth": AUTH_INVITES_STORE}


def _unsettled(books: set[str], people_at: float) -> bool:
    """The copy of who reads what this answer rests on is older than the change the relay saw land."""
    if not people_at:
        return False
    try:
        at = DB.people_as_of(books)
    except Exception:  # noqa: BLE001 - a copy whose age cannot be told does not hold the change
        return True
    return at is not None and at < people_at


def _live(but: str = "") -> list[dict[str, Any]] | None:
    """Every store's laid writes (but one), each named by its store; None when no store is ready."""
    items: list[dict[str, Any]] | None = None
    for app_id, store in stores().items():
        if app_id == but or not store.available or not store.ready():
            continue
        items = (items or []) + [{**w, "store": app_id} for w in store.live()]
    return items


def _edits() -> tuple[list[dict[str, Any]], float] | None:
    """Every edit Python keeps (app.edits), newest per cell, and when it was read; None when no store is configured."""
    held = [s for s in stores().values() if s.available]
    if not held:
        return None
    for store in held:
        if store.ready():
            at = time.time()
            return store.edits(), at
    raise hubdb.Unreadable("the edit store is not ready, and no read answers without Python's edits")


def _own() -> writes.Own | None:
    """The writes Python accepted and the edits it keeps, laid over this request's reads; the stores not…"""
    edits = _edits()
    items = _live()
    if items is None and edits is None:
        return None
    rows, at = edits or ([], 0.0)
    return client_writes.Own(items or [], book=DB.book, edits=rows, edits_at=at)


# a read of asa-hub-db's copy made outside a door lays Python's own writes as a door's read does
hub_rows.OWN_OF = _own


def _finish(own: writes.Own) -> None:
    """Each store told which of its writes a read found held by the copy, or never queued."""
    of = {w["write_id"]: w.get("store") or "locations" for w in own.items}
    for app_id, store in stores().items():
        done = {w: s for w, s in own.done.items() if of.get(w) == app_id}
        if done:
            store.finish(done)


def _answer(env: dict[str, Any], books: set[str], own: writes.Own | None) -> Response:
    as_of = DB.as_of(books)
    headers = {"X-Hub-As-Of": f"{as_of:.3f}", "Cache-Control": "no-store"}
    if own is not None and len(own.held) <= OWN_NAMED_MAX:
        headers["X-Hub-Own"] = ",".join(sorted(own.held))
    if own is not None and own.edits_at:
        # every final write kept before this moment is in this answer, whatever the copy's age
        headers["X-Hub-Edits-At"] = f"{own.edits_at:.3f}"
    return Response(json.dumps(js_json(env), separators=(",", ":"), ensure_ascii=False), media_type="application/json",
                    headers=headers)


def _run(module: Any, action: str, said: dict[str, Any], payload: dict[str, Any], people_at: float = 0.0) -> Response:
    started = time.time()
    books: set[str] = set()
    token = hubdb.READ_BOOKS.set(books)
    own_token = None
    own = None
    door = sys_log.enter(action, said, payload)
    try:
        own = None if action in UNLAID_READS else _own()
        own_token = hubdb.OWN.set(own)
        reads = locations.Reads(DB, DRIVE)
        user = caller(said, reads, action, module)
        gate = policy_gate(module, action, payload, user)
        door.user, door.gated = user, gate is not None
        env = gate or module.ACTIONS[action](locations.Session(reads, user), payload)
    except envelope.Refused as no:
        env = no.answer
    except sc.Defer as exc:
        log.info("%s deferred: %s", action, exc)
        return defer(str(exc))
    except hubdb.Unreadable as exc:
        log.warning("%s deferred: %s", action, exc)
        return defer(str(exc))
    except Exception as exc:  # noqa: BLE001 - a fault here is Apps Script's to answer
        log.exception("%s failed", action)
        return defer(f"failed ({type(exc).__name__})", 500)
    finally:
        sys_log.leave(door)
        if own_token is not None:
            hubdb.OWN.reset(own_token)
        hubdb.READ_BOOKS.reset(token)
    if own is not None:
        _finish(own)
    if _unsettled(books, people_at):
        log.info("%s said 503: who reads what changed after the copy it rests on", action)
        env = dict(UNSETTLED)
    sys_log.keep(door, env)
    log.info("%s answered %s in %.2fs (data as of %.0fs ago)", action, env.get("status"), time.time() - started,
             time.time() - DB.as_of(books))
    return _answer(env, books, own)


def _unkept(deciding: Any, action: str, payload: dict[str, Any]) -> None:
    """What a door's prepare made outside the lock (a workbook in Drive), put back when its write was not kept; never
    raised."""
    undo = (getattr(deciding, "UNKEPT", None) or {}).get(action)
    if undo is None:
        return
    token = None
    try:
        # read with every kept edit laid: a retry of a write that kept its work leaves it standing
        token = hubdb.OWN.set(_own())
        undo(locations.Reads(DB, DRIVE), payload)
    except Exception as exc:  # noqa: BLE001 - said; the answer stands
        log.warning("%s: its prepared work was not put back (%s)", action, type(exc).__name__)
    finally:
        if token is not None:
            hubdb.OWN.reset(token)


def _run_write(deciding: Any, action: str, said: dict[str, Any], payload: dict[str, Any], write_id: str,
               people_at: float = 0.0) -> Response:
    """One write decided under the platform's write lock: its receipt kept once, its change laid over the copy."""
    started = time.time()
    app_id = next(a for a, m in WRITES.items() if m is deciding)
    store = stores()[app_id]
    if not store.ready():
        return defer(store.why or "the write store is not ready")
    if not writes.WRITE_ID.fullmatch(write_id):
        return defer("the relay named no write id", 400)
    books: set[str] = set()
    token = hubdb.READ_BOOKS.set(books)
    own_token = None
    own = None
    replay = False
    kept = False
    door = sys_log.enter(action, said, payload)
    try:
        with store.locked() as tx:
            env = tx.receipt(write_id)
            if env is not None:
                replay = True
            else:
                # the kept edits read under the lock: every final write before this one is in what it decides on
                edits_at = time.time()
                edits = tx.edits()
                if deciding is writes:
                    # the Clients' layer: the kept edits name a client's row as every read lays them
                    own = client_writes.Own(tx.live(), book=DB.book, edits=edits, edits_at=edits_at)
                else:
                    # its own store's writes read under the lock, the other stores' as they stand
                    own = client_writes.Own([{**w, "store": app_id} for w in tx.live()] + (_live(but=app_id) or []),
                                            book=DB.book, edits=edits, edits_at=edits_at)
                own_token = hubdb.OWN.set(own)
                reads = locations.Reads(DB, DRIVE)
                user = caller(said, reads, action, deciding)
                refused = policy_gate(deciding, action, payload, user)
                door.user, door.gated = user, refused is not None
                # a situation the door raises is kept in this transaction, under this write
                with smart_comms.deciding(tx, write_id, action):
                    decision = writes.Decision(refused) if refused else \
                        deciding.ACTIONS[action](locations.Session(reads, user), payload)
                if SMART_COMMS_READY[0] and (decision.engine or decision.lay):
                    # a write Apps Script carries speaks there: nothing it raised here leaves as well
                    smart_comms.void_write(tx, write_id)
                if decision.fresh and DB.stale(books if decision.fresh is True else set(decision.fresh)):
                    raise sc.Defer("the verdict rests on rows whose book changed after the copy was made")
                if _unsettled(books, people_at):
                    raise _Unsettled()
                if time.time() - started > WRITE_BUDGET_S:
                    raise sc.Defer("decided too late: its caller has stopped waiting")
                env = js_json(writes.envelope(decision, write_id, user))
                # its log lines in its own transaction, under its write id: a void takes them back with it
                sys_log.keep(door, env, reads, decision, tx.cur, write_id)
                tx.record(write_id, action, env, decision, writes.who(user))
        kept = not replay
        if not replay:
            smart_comms.kick()
    except writes.Busy:
        busy = getattr(deciding, "BUSY_OF", None)
        env = {"status": 409, "message": writes.BUSY} if busy is None else busy.get(action)
        if env is None:
            return defer("another write holds the lock, and this door takes none")
    except writes.NotKept as exc:
        # rolled back whole, receipt and cells alike: Python's answer, never Apps Script's
        log.warning("%s not kept: %s", action, exc)
        env = {"status": 503, "message": writes.NOT_KEPT}
        sys_log.keep(door, env)
    except _Unsettled:
        # rolled back whole as well: decided on who reads what as it stood before the relay's last change of it
        log.info("%s not decided: who reads what changed after the copy it rests on", action)
        env = dict(UNSETTLED_WRITE)
        sys_log.keep(door, env)
    except envelope.Refused as no:
        # where the session may not stand: nothing decided, no receipt, as doPost answers before its receipt
        env = no.answer
    except sc.Defer as exc:
        log.info("%s deferred: %s", action, exc)
        return defer(str(exc))
    except hubdb.Unreadable as exc:
        log.warning("%s deferred: %s", action, exc)
        return defer(str(exc))
    except Exception as exc:  # noqa: BLE001 - a fault here is Apps Script's to decide
        log.exception("%s failed", action)
        return defer(f"failed ({type(exc).__name__})", 500)
    finally:
        sys_log.leave(door)
        if own_token is not None:
            hubdb.OWN.reset(own_token)
        hubdb.READ_BOOKS.reset(token)
        if not kept:
            _unkept(deciding, action, payload)
    if replay and isinstance(env.get("_write"), dict):
        env = {**env, "_write": {**env["_write"], "replay": True}}
    if own is not None:
        if deciding is writes:
            STORE.finish(own.done)
        else:
            _finish(own)
    plan = env.get("_write") if isinstance(env.get("_write"), dict) else {}
    log.info("%s decided %s%s in %.2fs", action, env.get("status"),
             " (replayed)" if replay else " — kept in Postgres, final" if plan.get("final")
             else " — Apps Script writes it" if plan.get("engine")
             else " — laid and queued" if plan else "", time.time() - started)
    return _answer(env, books, own)


# the browser's own door (/gas) and nginx's slice gate (/auth), answered here with these doors (app/front_door.py)
import front_door  # noqa: E402

front_door.install(app, sys.modules[__name__])

# the relay's service doors: mail, the records, the forecast, the plan reader, the lab, the cortex's reads, the courier
import service_doors  # noqa: E402

service_doors.install(app)

# the relay's other lanes: backends, tech, versions, supplies, the My apps (app/other_lanes.py, app/my_lanes.py)
import other_lanes  # noqa: E402

other_lanes.install(app)

# the hotline desk's lanes and the staff daily notes (app/hotline_doors.py)
import hotline_doors  # noqa: E402

hotline_doors.install(app)

# the live data plane: the live stream, /notify, the finish of every answer, the slices, the bang, a place's bundle and
# /health (app/live_plane.py)
import live_plane  # noqa: E402

live_plane.install(app, sys.modules[__name__])

# the scheduling lanes the relay answered (/hub-lanes housecal, shift-*, calendar-builder houses, time-off)
import sched_lanes  # noqa: E402

sched_lanes.install(app, sys.modules[__name__])

# the shift rehearsal: its board, a rehearsed answer and the reset, played in a sealed worker over asa-hub-db's own
# sandbox schema (app/rehearsal_lanes.py)
import rehearsal_lanes  # noqa: E402

rehearsal_lanes.install(app)

# Calendar Builder's master grid off its own record: the grid, a draft cell, time off staged, the generator, the
# publish, the push into the houses, and the keeper's door to the record's sync (app/master_grid_lanes.py)
import master_grid_lanes  # noqa: E402

master_grid_lanes.install(app)

# the relay's clocks and the Quo pipeline: the 20-second beat, the staff beat's passes, the messages webhook's inbox
# (app/clocks.py)
import clocks  # noqa: E402

clocks.install(app, sys.modules[__name__])

# the relay's PSI attendance loop and the doors that read its memory: psi/health and punch-warnings/received
# (app/attendance_loop.py)
import attendance_loop  # noqa: E402

attendance_loop.install(app)

# the chat's live doors: its stream, beat and tickets, the live hub's doors, its /gas actions, the cortex chat
import chat_doors  # noqa: E402

chat_doors.install(app)

# the /gas rungs the relay answered ahead of Python's own doors: Editions and My Work's switches, Staff Performance,
# Settings' platform health, the form import and the hiring walk, the public forms and links, IST's handed doors
# (app/gas_rungs.py)
import gas_rungs  # noqa: E402

gas_rungs.install()

# the bell and My Inbox: /hub-lanes/notices(/read) and /hub-lanes/my-inbox(/read) (app/inbox_lanes.py)
import inbox_lanes  # noqa: E402

inbox_lanes.install(app)

# the company notices' clock (catch-up, frames, pushes, the mock rows' hand-off, the relay's POST /live/wake) and the
# strip's hub frame on the chat streams (app/notice_clock.py, app/hub_strip.py)
import hub_strip  # noqa: E402
import notice_clock  # noqa: E402

notice_clock.install(app)
hub_strip.install(app)

# the phone-call lane's webhook half, where the reading and the seal key are mounted (app/comm_calls_door.py)
import comm_calls_door  # noqa: E402

comm_calls_door.install(app)

# the relay's /gas rungs over Python's doors: the file doors, the papers filed in Drive, the sweeps a person presses, the
# bundles, Settings' tools, the reads it handed records or composed, and the AI lane test with its /analyze leg
# (app/door_rungs.py, app/analyze.py)
import door_rungs  # noqa: E402

door_rungs.install(app, sys.modules[__name__])

# people's photos and house photos on the server's images folder: their five /hub-lanes doors (app/photo_doors.py)
import photo_doors  # noqa: E402

photo_doors.install(app)

# Settings › Events: every signal a write or a clock raises, what answers it, on or off, the master's
# (app/event_switches.py)
import event_switches  # noqa: E402

event_switches.install(app)

# Settings › Essential sheets: the sweep of the sheets people still post to, and Sweep now, the master's
# (app/essential_sheets.py)
import essential_sheets  # noqa: E402

essential_sheets.install(app, STAFF_STORE, lambda: locations.Reads(DB, DRIVE))

# Credentials › Password resets: any account's password set to the workspace default or a typed one, changed at the
# next sign-in, the master's (app/credentials_resets.py)
import credentials_resets  # noqa: E402

credentials_resets.install(app, lambda: auth_doors.Context(DB, DRIVE, AUTH_STORE, _own, _own_locked))

# PSI Log: a person's own PsiAnywhere sign-in and time clock inside the Hub, behind App Control (app/psi_log.py)
import psi_log  # noqa: E402

psi_log.install(app, STAFF_STORE, lambda: locations.Reads(DB, DRIVE))

# Time Reconciliation's lanes: the PsiAnywhere pay periods, the review queue filtered, and Overtime in Time
# Reconciliation and Scheduling (app/recon_lanes.py, app/overtime_lanes.py)
import overtime_lanes  # noqa: E402
import recon_lanes  # noqa: E402

recon_lanes.install(app, lambda: locations.Reads(DB, DRIVE))
overtime_lanes.install(app, lambda: locations.Reads(DB, DRIVE))

# Scheduling › House calendars' reload: the house calendars read from the sheet now when it is newer, the master's
app.post(SCHED_SHEET_RELOAD_LANE, include_in_schema=False)(_sched_sheet_reload)

# Settings › Routes: every route on or off, the master's, refused before routing when off (app/route_switches.py)
import route_switches  # noqa: E402

route_switches.install(app)

# whatever no route before it answers is answered 404 here (app/relay_carrier.py); it must stay
# the last route
import relay_carrier  # noqa: E402

relay_carrier.install(app)
