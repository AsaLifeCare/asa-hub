"""Settings › Editions answered by Python alone (Editions.gs ported): the catalogue every gate reads, the master's
read and save, a person's own. scope.py derives its list from this module, so the doors import scope and writes
when they are called."""
from __future__ import annotations

import json
import logging
import re
import types
import uuid
from typing import Any

import gsjs
import hubdb

log = logging.getLogger("asa-hub-app")

APP_ID = "editions"
UNKNOWN = "Unknown action."
EDITIONS_KEY = "mywork_editions"
# editions are made by employees: the roles a list may name
EDITION_ROLES = ("admin", "manager", "staff")
# how many people one edition's list may hold
EDITION_MAX_PEOPLE = 100
CONFIG_UNREAD = "The platform config could not be read, so the editions are not shown. Try again."
TOO_LONG = "The editions list is longer than one sheet cell holds. Nothing was saved."

# what every Smart Comms edition keeps and leaves to an admin (smart_comms_writes.EDITIONS says the same)
_SMART_COMMS_WORKS = (" Works while Smart Comms runs on Python; the change is kept in the Hub's database and carried "
                      "to the situations sheet. A gate row, the sending line, the brakes (test mode, the message "
                      "pause) and a correction sent to the people who got the old words stay an admin's.")

# every edition the platform has, in the order Settings lists them
CATALOGUE: tuple[dict[str, str], ...] = (
    {"id": "locations.house", "app": "locations", "app_name": "Locations",
     "label": "House — every section",
     "description": ("Edit every section of a house: House Details (the registry row), House Notes (a new note, "
                     "resolve or reopen one), House Supplies (counts, deliveries and corrections), House Repairs (a "
                     "new request and its edits) and IST papers. It also corrects what was on hand after a supplies "
                     "delivery and removes a mistaken supplies entry (its row stays on the ledger; no list shows it). "
                     "Those two work while Locations runs on Python; the change is kept in the Hub's database, not on "
                     "a sheet.")},
    {"id": "locations.staffRemove", "app": "locations", "app_name": "Locations",
     "label": "Staff — take a person off",
     "description": ("Take a person off a house's Staff list. Their staff record, their shifts and the house's "
                     "history stay exactly as they are; the person can be put back.")},
    {"id": "locations.incidents", "app": "locations", "app_name": "Locations",
     "label": "Incidents — open and edit",
     "description": "Open a new incident for one of the house's clients, and edit an incident's report."},
    {"id": "locations.incidentsNew", "app": "locations", "app_name": "Locations",
     "label": "Incidents — New Incident",
     "description": ("Open a new incident for one of the house's clients from Locations › Incidents (the New Incident "
                     "button and Actions › New Incident). Editing a filed report is not part of it.")},
    {"id": "locations.documents", "app": "locations", "app_name": "Locations",
     "label": "Documents — add and remove",
     "description": ("Remove any of the house's own documents, add one from a Google Drive link, or upload one from "
                     "outside the platform.")},
    {"id": "locations.notesAny", "app": "locations", "app_name": "Locations",
     "label": "House Notes — anyone's note",
     "description": "Edit and save a house note written by anyone, or remove it."},
    {"id": "locations.clientsAdd", "app": "locations", "app_name": "Locations",
     "label": "Associated clients — add",
     "description": "Add more clients to a house. The house's current clients are never taken off."},
    {"id": "locations.assets", "app": "locations", "app_name": "Locations",
     "label": "House assets — add and edit",
     "description": ("Add an asset to a house, or edit one (item, condition, replaced or expires, cost to replace, "
                     "how often), on the House Supplies inventory. An asset stays at its house and is never removed "
                     "here.")},
    {"id": "clients.profile", "app": "client-profiles", "app_name": "Clients",
     "label": "Client profile — the details",
     "description": ("Edit a client's profile: the details the master edits today (contact, house, initials, ISP "
                     "signed date…). Protected fields stay locked (the SSN, the card and its codes), and the name and "
                     "the status are not part of it.")},
    {"id": "clients.care", "app": "client-profiles", "app_name": "Clients",
     "label": "Care — daily care, health, goals and home",
     "description": ("Edit, hide or add a client's care record in Care & Support (Daily care, Health & behavior, "
                     "Personal goals, Home & equipment), kept in the Hub over the plan. Care plans, the care team and "
                     "the family members are not part of it.")},
    {"id": "clients.family", "app": "client-profiles", "app_name": "Clients",
     "label": "Family members — correct, hide or add",
     "description": ("Correct a family member the plan names in Client Profile › Family members (name, relationship, "
                     "phone, e-mail), hide one from the profile, or add one the plan leaves out, kept in the Hub over "
                     "the plan's important people: the plan itself is never changed, and a family member's own record "
                     "across their clients stays with Families. Works while Clients runs on Python; the change is "
                     "kept in the Hub's database, not on a sheet.")},
    {"id": "clients.medication", "app": "client-profiles", "app_name": "Clients",
     "label": "Medication — add, change or remove a medication",
     "description": ("Add a medication to a client's eMAR chart, change one (name, dose, times, type, frequency, "
                     "discontinued) or take one off the chart, in Medication › Medications. Administration and "
                     "Refills are not part of it.")},
    {"id": "clients.transportation", "app": "client-profiles", "app_name": "Clients",
     "label": "Transportation — change or cancel a client's trip",
     "description": ("Open a client's trip from Clients › Transportation in the Transportation app's own trip panel "
                     "and change it (time, vehicle, driver, staff, type, purpose, destination, details) or cancel it. "
                     "A waiting request is still approved or declined by the directors, and the trip stays with its "
                     "client.")},
    {"id": "clients.incidents", "app": "client-profiles", "app_name": "Clients",
     "label": "Incidents — file a new one",
     "description": ("File a new incident from a client's Incidents in Locations' own New incident panel, at the "
                     "client's house: the client is the one open, and must be one of that house's current clients. "
                     "Editing a filed report and its status are not part of it.")},
    {"id": "clients.incidentsEdit", "app": "client-profiles", "app_name": "Clients",
     "label": "Incidents — edit a report",
     "description": ("Edit a filed incident's report from a client's Incidents in Locations' own edit panel, field by "
                     "field. When it was filed stays as filed, the report stays with its client, and the status is "
                     "not part of it.")},
    {"id": "clients.appointments", "app": "client-profiles", "app_name": "Clients",
     "label": "Appointments — book and edit a visit",
     "description": ("Book a doctor's visit for a client from Clients › Appointments › New Appointment (the doctor, the "
                     "day and time, the address and whether the wheelchair van is needed), and edit a booked visit "
                     "with its pencil. A visit is never deleted. Kept in the Hub's database, not on a sheet.")},
    {"id": "clients.doctors", "app": "client-profiles", "app_name": "Clients",
     "label": "Doctors — add a client's doctor",
     "description": ("Add a doctor to a client's doctors on file from Clients › Appointments › New Doctor: the name, "
                     "specialty, phone, fax, address, how often they are seen and notes. The doctor is filed Active. "
                     "Kept in the Hub's database, not on a sheet.")},
    {"id": "staff.profile", "app": "staff-profiles", "app_name": "Staff",
     "label": "Staff Details — contacts and address",
     "description": ("Edit a staff member's phone and e-mail, their account phones, contact e-mails and photo (Staff "
                     "Details), and their street address, city, state and zip (HR Admin's own panel). The name, the "
                     "status and the sign-in e-mail stay the master's; the SSN, the date of birth and the licence "
                     "number are never edited here. Works while Staff runs on Python; the change is kept in the Hub's "
                     "database, not on a sheet.")},
    {"id": "staff.employment", "app": "staff-profiles", "app_name": "Staff",
     "label": "Employment — hiring, dates and qualifications",
     "description": ("Edit Employment: the referral and whether it was paid, the job application and attestation "
                     "dates, the resume, the start and end dates, the high school diploma and Driver. Works while "
                     "Staff runs on Python; the change is kept in the Hub's database, not on a sheet.")},
    {"id": "staff.hr", "app": "staff-profiles", "app_name": "Staff",
     "label": "HR Admin — forms, work authorization and screening",
     "description": ("Edit HR Admin from its own panel: the W-4, pay authorization and HIPAA dates, the I-9 and its "
                     "documents, the licence, abstract and insurance dates, every screening line, the BCI check and "
                     "Rapback dates. The SSN, the date of birth, the licence number and the BCI receipt stay locked. "
                     "HR Admin is read from the sheet, so a change shows there once the sync carries it. Works while "
                     "Staff runs on Python; the change is kept in the Hub's database, not on a sheet.")},
    {"id": "staff.compliance", "app": "staff-profiles", "app_name": "Staff",
     "label": "Compliance — course dates, credentials and screening",
     "description": ("Edit Compliance and Performance › Training: the DODD, CPR, MANDT and money management dates, the "
                     "licence and insurance expiry, every screening line, the BCI check and Rapback dates. Med "
                     "Delivery dates stay the MAIS registry check's. Works while Staff runs on Python; the change is "
                     "kept in the Hub's database, not on a sheet.")},
    {"id": "staff.hrIssues", "app": "staff-profiles", "app_name": "Staff",
     "label": "HR & Conduct — file an HR issue",
     "description": ("File an HR issue on a staff member from Performance › HR & Conduct: the day, severity, "
                     "category, summary, details, action and next review. It is filed on the HR tracker Under "
                     "review. Works while Staff runs on Python; the change is kept in the Hub's database, not on a "
                     "sheet.")},
    {"id": "staff.documentation", "app": "staff-profiles", "app_name": "Staff",
     "label": "Documentation — mark a missing record concluded",
     "description": ("Mark a missing daily note or punch in Performance › Documentation as concluded, with why; it "
                     "then counts as complete. Works while Staff runs on Python; the change is kept in the Hub's "
                     "database, not on a sheet.")},
    {"id": "staff.driving", "app": "staff-profiles", "app_name": "Staff",
     "label": "Driver — the driving record",
     "description": ("Edit the driving record's facts (driver, points, licence and insurance expiry, the abstracts) "
                     "and the licence standing. The licence number is never edited here. Works while Staff runs on "
                     "Python; the change is kept in the Hub's database, not on a sheet.")},
    {"id": "staff.mais", "app": "staff-profiles", "app_name": "Staff",
     "label": "Med Del (MAIS) — a Cat level's line",
     "description": ("Edit the status, effective and expiry of a staff member's latest MAIS line; a newer line from "
                     "the registry check shows instead once it arrives. Works while Staff runs on Python; the change "
                     "is kept in the Hub's database, not on a sheet.")},
    {"id": "staff.ist", "app": "staff-profiles", "app_name": "Staff",
     "label": "IST — a training record",
     "description": ("Edit an IST record of a staff member: owed or trained, the due day and the trained day. Which "
                     "client and house it pairs stays as Settings › IST maps it. Works while Staff runs on Python; "
                     "the change is kept in the Hub's database, not on a sheet.")},
    {"id": "staff.preferences", "app": "staff-profiles", "app_name": "Staff",
     "label": "Preferences — shifts, days, places and allergies",
     "description": ("Save a staff member's preferences: preferred shifts, open-shift pickup, weekend work, "
                     "unavailable days and locations, allergies and the note. The imported shifts text stays as it "
                     "came. Works while Staff runs on Python; the change is kept in the Hub's database, not on a "
                     "sheet.")},
    {"id": "staff.notes", "app": "staff-profiles", "app_name": "Staff",
     "label": "Staff notes — add, resolve or reopen",
     "description": ("File a staff note on a person, and resolve or reopen any staff note. A note's text is never "
                     "rewritten. Works while Staff runs on Python; the note is kept in the Hub's database, not on a "
                     "sheet.")},
    {"id": "staff.notesEdit", "app": "staff-profiles", "app_name": "Staff",
     "label": "Staff notes — edit a note",
     "description": ("Edit any staff note's category, priority and text, from the Staff notes panel or Performance › "
                     "Notes. Who filed it and when stay as filed, and a note is never removed here (resolve it "
                     "instead). Works while Staff runs on Python; the change is kept in the Hub's database, not on a "
                     "sheet.")},
    {"id": "ssa.profile", "app": "ssa-profiles", "app_name": "SSA",
     "label": "SSA Details — contacts, agency and office address",
     "description": ("Edit an SSA's details from SSA › Overview: the phone and e-mail, on every current client record "
                     "that names the SSA, and the agency and office address, kept on the SSA's own record (a blank "
                     "agency goes back to the one the e-mail's domain names). The name and the county stay on each "
                     "client's record, in Clients. Works while SSA runs on Python; the change is kept in the Hub's "
                     "database, not on a sheet.")},
    {"id": "ssa.notes", "app": "ssa-profiles", "app_name": "SSA",
     "label": "Admin notes — add a note",
     "description": ("File an admin note about an SSA, from the Overview or the Actions menu; it shows in the SSA's "
                     "notes and Activity. A note is never edited or removed here. Works while SSA runs on Python; the "
                     "change is kept in the Hub's database, not on a sheet.")},
    {"id": "ssa.documents", "app": "ssa-profiles", "app_name": "SSA", "floor": "DIRECTOR",
     "label": "Documents — edit or remove an entry",
     "description": ("Edit the title or the date of an entry in an SSA's Documents list, or remove the entry from the "
                     "list. The file itself, its client and where it was found stay as they are; a removed entry is "
                     "listed no more and nothing is deleted. Every director, and every badge above one, makes it "
                     "whatever this list says; the list adds people. Works while SSA runs on Python; the change is "
                     "kept in the Hub's database, not on a sheet.")},
    {"id": "ssa.activity", "app": "ssa-profiles", "app_name": "SSA", "floor": "DIRECTOR",
     "label": "Activity — edit or remove an entry",
     "description": ("Edit the title or the text of an entry in an SSA's Activity, or remove the entry from it. An "
                     "admin note's text is the note's own, and a removed admin note leaves the notes too. When it "
                     "happened, its kind and who it was by stay as recorded; a removed entry is listed no more and "
                     "nothing is deleted. Every director, and every badge above one, makes it whatever this list "
                     "says; the list adds people. Works while SSA runs on Python; the change is kept in the Hub's "
                     "database, not on a sheet.")},
    {"id": "family.profile", "app": "family-profiles", "app_name": "Families & Guardians",
     "label": "Family member — the details",
     "description": ("Edit a family member's details in Families: phone, email, address and photo link, and, for each "
                     "client whose own record names them, the relationship and the guardianship papers, on every "
                     "client record that names the member and on their people-directory row. The name is not part of "
                     "it (a new name re-keys the member and moves their notes), and a sign-in is never changed here. "
                     "Works while Families runs on Python; the change is kept in the Hub's database, not on a sheet.")},
    {"id": "family.notes", "app": "family-profiles", "app_name": "Families & Guardians",
     "label": "Admin notes — add, edit or remove a note",
     "description": ("File an admin note about a family member from the Overview or the Actions menu, and change the "
                     "text of any note on file or remove it (a removed note leaves the notes and the Activity). Works "
                     "while Families runs on Python; the change is kept in the Hub's database, not on a sheet.")},
    {"id": "family.calls", "app": "family-profiles", "app_name": "Families & Guardians",
     "label": "Calls — schedule, change or cancel a call",
     "description": ("Schedule a call with a family member about one of their clients, and change a call filed from "
                     "Families (its day, priority, state and details) or cancel it, from the family member's "
                     "Activity. No message is sent; a cancelled call stays on its board in Done, labelled Cancelled, "
                     "and the Task Board shows a change once the sync carries it to its sheet (within about 10 "
                     "minutes). Works while Families runs on Python; the change is kept in the Hub's database, not on "
                     "a sheet.")},
    {"id": "family.incidents", "app": "family-profiles", "app_name": "Families & Guardians",
     "label": "Incidents — file one from Families",
     "description": ("File a new incident for one of a family member's clients from Families (Clients' own incident "
                     "form) and tie it to the family member, so it shows in their Activity. Works while Families runs "
                     "on Python; the tie is kept in the Hub's database, not on a sheet.")},
    {"id": "family.create", "app": "family-profiles", "app_name": "Families & Guardians", "floor": "DIRECTOR",
     "label": "New Family — register a family member",
     "description": ("Register a new family member in Families from Actions › New Family: their name, relationship, "
                     "phone, e-mail, address and the clients they are family of. Their Activity starts with it. Every "
                     "director, and every badge above one, makes it whatever this list says; the list adds people. "
                     "Works while Families runs on Python; kept in the Hub's database (Families' own registry), not "
                     "on a sheet.")},
    {"id": "family.documents", "app": "family-profiles", "app_name": "Families & Guardians", "floor": "DIRECTOR",
     "label": "Documents — add a paper",
     "description": ("Add a paper to a family member's Documents: a PDF or a picture filed in Drive as the platform's "
                     "own account (Families/<name>), or a file already in Drive by its link. It shows in their "
                     "Documents and Activity. Every director, and every badge above one, makes it whatever this list "
                     "says; the list adds people. Works while Families runs on Python; kept in the Hub's database, "
                     "not on a sheet.")},
    {"id": "scheduling.calendar", "app": "scheduling", "app_name": "Scheduling",
     "label": "House Calendars — shifts and people",
     "description": ("Edit any house's calendar from House Calendars and Staff Calendars: add, change or delete a "
                     "shift and its note, give an OPEN shift to somebody, put somebody on a house, and undo your own "
                     "last change there. Cancelling a request that waits on a shift, a training's hours, placing "
                     "somebody new to a house or against their Staff Preferences, a call-off and a swap stay with the "
                     "house manager, the directors and the master. Works while Scheduling runs on Python; the change "
                     "is kept in the Hub's database, not on a sheet.")},
    {"id": "scheduling.swaps", "app": "scheduling", "app_name": "Scheduling",
     "label": "Swaps — anybody's shift",
     "description": ("Ask a swap on anybody's shift from House Calendars: pick who takes it in the shift's Employee "
                     "field. Only somebody free then is offered. It goes through the swap's own approvals — the "
                     "person asked accepts in My Work, then the house manager, then a director — with the same items "
                     "and texts; nothing changes on the calendar until then. Without this list a swap is the "
                     "person's own, the master's or a Scheduling director's. Works while Scheduling runs on Python; "
                     "the request is kept in the Hub's database, and the answers that follow are taken once the "
                     "Hub's sync carries it to the sheet (within about ten minutes).")},
    {"id": "scheduling.builder", "app": "scheduling", "app_name": "Scheduling",
     "label": "Builder — draft, approve and publish",
     "description": ("Build any house's next weeks in the Builder: save the draft, approve its pattern check and "
                     "publish it into the house's calendar, with the period its last weeks need. The Builder screen "
                     "is still released in App Control. Works while Scheduling runs on Python; the change is kept in "
                     "the Hub's database, not on a sheet.")},
    {"id": "scheduling.settings", "app": "scheduling", "app_name": "Scheduling",
     "label": "Settings — notice, waits and the cycle",
     "description": ("Change the Scheduling settings: the minutes before everyone is texted after a call-off, the "
                     "days of notice for Request Off and Time off, the days in a period and the days before a period "
                     "ends. Who the directors are, the seed, the copy forward and the time off import stay the "
                     "master's, and the requests the platform answers read a new value at once; the Hub's sync carries it "
                     "to the sheet (within about ten minutes). Works while Scheduling runs on Python; the change is "
                     "kept in the Hub's database, not on a sheet.")},
    {"id": "scheduling.timeOffApprove", "app": "scheduling", "app_name": "Scheduling",
     "label": "Time off approvals — approve or decline a time off ask",
     "description": ("Approve or decline any time off ask in Scheduling › Time Off Requests, beside the directors "
                     "the Scheduling settings list and the master: the first answer decides. Approving gives up the "
                     "person's shifts in those days and opens each for cover; the texts and the outreach follow once "
                     "the Hub's sync carries the rows to the sheet. Works while Scheduling runs on Python; kept in "
                     "the Hub's database, not on a sheet.")},
    {"id": "transportation.trips", "app": "vehicle-calendar", "app_name": "Transportation",
     "label": "Trips — details, assignment and status",
     "description": ("Change any trip in Transportation's trip panel (time, vehicle, driver, staff, client, trip "
                     "type, purpose, destination, details, wheelchair and the assignment note) and set it to "
                     "Scheduled, Needs assignment or Cancelled. A request still waiting is approved or declined by "
                     "the directors, and a trip somebody asked for is cancelled by the directors, who text them. "
                     "Works while Transportation runs on Python; the change is kept in the Hub's database, not on a "
                     "sheet.")},
    {"id": "transportation.vehicles", "app": "vehicle-calendar", "app_name": "Transportation",
     "label": "Vehicles — add and edit a vehicle",
     "description": ("Add a vehicle, or edit one (name, description, seats, wheelchair accessible, availability and "
                     "its note) in Transportation › Vehicles. A vehicle sent to maintenance or out of service hands "
                     "its scheduled trips back to Needs assignment. Works while Transportation runs on Python; the "
                     "change is kept in the Hub's database, not on a sheet.")},
    {"id": "transportation.settings", "app": "vehicle-calendar", "app_name": "Transportation",
     "label": "Setup — the trip types",
     "description": ("Change the trip types a request and a trip choose from, in Transportation › Setup. Who approves "
                     "(the directors), the text numbers, the seed and the Van Calendar import stay the master's. "
                     "Works while Transportation runs on Python; the change is kept in the Hub's database, not on a "
                     "sheet.")},
    {"id": "emergencyContacts.directory", "app": "emergency-contacts", "app_name": "Emergency Contacts",
     "label": "Directory — every lane and contact",
     "description": ("Change the Emergency Contacts directory: add, edit or remove a contact (its name, phone, note, "
                     "lane and place in the lane) and add, edit or remove a lane (its label, icon, colour and place); "
                     "a lane with contacts is removed only with them. The 911 banner stays as it is. Works while "
                     "Emergency Contacts runs on Python. The directory is kept in the Hub's database.")},
    {"id": "candidates.information", "app": "staff-candidates", "app_name": "Staff Candidates",
     "label": "Information — the candidate's details",
     "description": ("Edit a candidate's details in Staff Candidates › Information (and the Overview's Edit "
                     "information): the first and last name (the full name follows), phone, e-mail, source, applied "
                     "day, city, state, street address and zip, the recruiter, and — when a resume analysis is on file "
                     "— the availability, years caregiving and experience. The position and the stage are not part of "
                     "it, the background result is filed with its paper, the preferred location and the earliest start "
                     "are the Onboarding record's, and from Onboarding on the e-mail is the new hire's sign-in "
                     "(Settings › Users). Works while Staff Candidates runs on Python; the change is kept in the Hub's "
                     "database, not on a sheet.")},
    {"id": "candidates.pipeline", "app": "staff-candidates", "app_name": "Staff Candidates",
     "label": "Pipeline — mark a step complete and move the stage",
     "description": ("Press the Hiring doors that send nothing, from Actions, the Pipeline's next step and Update "
                     "stage: the resume decision and the advance decision (Advance — an open gate moves the card to "
                     "Interview and books its visit, as the Hiring card does), the manual phone screen (Transcript, AI "
                     "report, Screen details) and the move to the next stage when the board's gate is open (New → "
                     "Phone Screen, Phone Screen → Interview, Hired → Ready to start), each with its line on the "
                     "hiring journey. Scheduling the interview, the scorecard, the New Hire packet, Manual onboarding, "
                     "the move into Onboarding, Not hiring and every upload stay the master's, because they e-mail, "
                     "move the card through Onboarding or store a paper in Drive. Works while Staff Candidates runs on "
                     "Python; the change is kept in the Hub's database, not on a sheet.")},
    {"id": "candidates.notes", "app": "staff-candidates", "app_name": "Staff Candidates",
     "label": "Notes — add, edit or remove a note",
     "description": ("File a note on a candidate's hiring journey (Add note, the Overview, a step on Actions), and "
                     "change the text of any note on file or remove it from the Activity Log. A step the platform "
                     "logged is never edited. Works while Staff Candidates runs on Python; the change is kept in the "
                     "Hub's database, not on a sheet.")},
    {"id": "candidates.interviews", "app": "staff-candidates", "app_name": "Staff Candidates",
     "label": "Interviews — the phone screen's preferences and notes",
     "description": ("Edit what the candidate told the phone screen, in Interviews › Candidate preferences, when a "
                     "phone screen is on file: the shifts, hours, weekends, male and behavioral care, driver's "
                     "license, vehicle, insurance and certificates, the day and time agreed on the call, and the "
                     "screen's notes. The advance decision, the scorecard's score and recommendation and a booked "
                     "interview (it was e-mailed to the candidate) are not part of it. Works while Staff Candidates "
                     "runs on Python; the change is kept in the Hub's database, not on a sheet.")},
    {"id": "candidates.documents", "app": "staff-candidates", "app_name": "Staff Candidates",
     "label": "Documents — file and review a document",
     "description": ("File a candidate's paper from Documents (it is stored in Drive by the path that files it as the "
                     "platform's account), and review an onboarding document filed: mark it Verified or Returned, and "
                     "correct its issued and expiry days and its notes. The background check's result is filed with "
                     "its paper. Works while Staff Candidates runs on Python; a review is kept in the Hub's database, "
                     "not on a sheet.")},
    {"id": "clientCandidates.information", "app": "client-candidates", "app_name": "Client Candidates",
     "label": "Information — the referral's details",
     "description": ("Edit a referral's details in Client Candidates › Information (and the Overview's Edit "
                     "information): the full name, phone, e-mail, source, intake coordinator, ZIP, the service "
                     "requested, frequency, funding source, diagnosis, age and gender, on the referral's own Potential "
                     "Clients row. The referral number and its window are the county portal's, the AI rating is the "
                     "scraper's, the stage moves through Pipeline, and a value holding a Social Security, Medicaid or "
                     "card number or a date of birth stays locked. Works while Client Candidates runs on Python; the "
                     "change is kept in the Hub's database, not on a sheet.")},
    {"id": "clientCandidates.intake", "app": "client-candidates", "app_name": "Client Candidates",
     "label": "Intake — the next step and the contact preferences",
     "description": ("Edit the intake's answers in Client Candidates › Intake: the next step and how the family wants "
                     "to be reached (contact method, best time, who to contact). The intake's phases move through "
                     "Pipeline and the referral's details are Information's. Works while Client Candidates runs on "
                     "Python; the change is kept in the Hub's database, not on a sheet.")},
    {"id": "clientCandidates.pipeline", "app": "client-candidates", "app_name": "Client Candidates",
     "label": "Pipeline — update the stage, mark a step complete or reopen it",
     "description": ("Move a referral through the intake from Actions, the Overview and Update stage: set any of the "
                     "six stages, mark the next step complete or reopen a completed one, with an optional note on the "
                     "step, each with its line on the referral's log. Nothing is sent to anyone. Works while Client "
                     "Candidates runs on Python; the change is kept in the Hub's database, not on a sheet.")},
    {"id": "clientCandidates.notes", "app": "client-candidates", "app_name": "Client Candidates",
     "label": "Notes — add, edit or remove a note",
     "description": ("Add a note to a referral (Add note, the Overview, a step on Actions), and change the words of "
                     "any line of the referral's notes or remove it; when it was written and by whom stay as written. "
                     "Works while Client Candidates runs on Python; the change is kept in the Hub's database, not on a "
                     "sheet.")},
    {"id": "clientCandidates.documents", "app": "client-candidates", "app_name": "Client Candidates",
     "label": "Documents — confirm the consent, take a filed paper's record off",
     "description": ("Confirm a signed consent filed in Documents or withdraw its confirmation, and take a filed "
                     "paper's record (the support assessment or the consent) off the referral; the file itself stays "
                     "in the referral's folder. Filing a paper (it is stored in Drive) stays the master's. Works while "
                     "Client Candidates runs on Python; the change is kept in the Hub's database, not on a sheet.")},
    {"id": "certDocs.review", "app": "cert-docs", "app_name": "Compliance documents",
     "label": "Review — open others' filed papers and confirm a date into the record",
     "description": ("List every certificate paper filed by anyone and open each one, see what the person's record "
                     "(the Employee Database Master) holds for it, and confirm a date read off a filed paper into "
                     "that record, the ledger row stamped as confirmed, only while the record still holds what was "
                     "shown. Med Delivery and MAIS dates stay with their registry check; filing a paper and reading "
                     "it with the decoder stay with the person and the master. Only for a person who also reads "
                     "every staff member whole in Staff. Works while Compliance documents runs on Python; the change "
                     "is kept in the Hub's database, not on a sheet.")},
    {"id": "myCalendar.anyone", "app": "my-calendar", "app_name": "My Calendar",
     "label": "Any person's calendar — open it and file their time off",
     "description": ("Choose any staff member in My Calendar, as the master does, and see their week of shifts and "
                     "their time off requests (never a request's reason). From their calendar, file a time off request "
                     "for them, and change the dates of one you filed or withdraw it, through Time Off's own doors: "
                     "Time Off still decides each one by your own reach (a house manager files for the people drawn on "
                     "the houses they manage, a director or an administrator for anybody) and asks the house manager "
                     "and the directors as every filing does. A person's own calendar stays theirs. Works while My "
                     "Calendar runs on Python, which reads the calendar from the Hub's database; the request itself is "
                     "kept where Time Off keeps every one.")},
    {"id": "myInbox.anyone", "app": "my-inbox", "app_name": "My Inbox",
     "label": "Any person's inbox — open it, read-only",
     "description": ("Choose any staff member in My Inbox, as the master does, and read the alerts that person is "
                     "shown: their requests, missed punches, Scheduling, Support Requests and Transportation alerts, "
                     "new staff, company notices and software updates, each judged by that person's own access. "
                     "Read-only: what they marked read stays theirs, nothing is marked for them, and an alert's answer "
                     "stays with them. Your own inbox stays yours. Works while My Inbox runs on Python, which reads "
                     "the alerts from the Hub's database.")},
    {"id": "myInbox.directors", "app": "my-inbox", "app_name": "My Inbox",
     "label": "The directors' alerts too — a copy in your own inbox",
     "description": ("Your own My Inbox also lists every Scheduling and Support Requests alert sent to a director's "
                     "seat, once per telling and marked \"Sent to the directors\", as the master's inbox does. A copy "
                     "to read: the person it was sent to answers it in Scheduling or Support Requests, and the copy "
                     "says who marked it or who it is waiting on. An alert you turned off in Settings › Alerts I "
                     "receive is not copied while you are on the directors' list. Works while My Inbox runs on "
                     "Python, which reads the alerts from the Hub's database.")},
    {"id": "smartComms.words", "app": "smart-comms", "app_name": "Smart Comms",
     "label": "Words — the text message and the e-mail",
     "description": ("Change a situation's words on the Smart Comms Desk: its text message, its e-mail subject and its "
                     "e-mail. The new words are what the situation says the next time it speaks."
                     + _SMART_COMMS_WORKS)},
    {"id": "smartComms.switch", "app": "smart-comms", "app_name": "Smart Comms",
     "label": "Switch — turn a situation on or off",
     "description": ("Turn a situation on or off on the Smart Comms Desk, from its card or its panel. Turned off, it "
                     "says nothing until somebody turns it on." + _SMART_COMMS_WORKS)},
    {"id": "smartComms.audience", "app": "smart-comms", "app_name": "Smart Comms",
     "label": "Audience — who it goes to and who is copied",
     "description": ("Change a situation's Goes to and Also copied: addresses written out (an e-mail with its domain, "
                     "a number with its ten digits) or a keyword the platform resolves (allstaff, housemanagers, "
                     "directors). A word that reaches nobody is refused, as it is for an admin." + _SMART_COMMS_WORKS)},
    {"id": "smartComms.pacing", "app": "smart-comms", "app_name": "Smart Comms",
     "label": "Pacing — channels, attempts, how often, the hours and the days before",
     "description": ("Change how a situation speaks: its channels (text, e-mail), how many times one person may be "
                     "told and how often, the hours of the day it may speak and how many days before a date it "
                     "starts. Hours nobody can read are refused, as they are for an admin." + _SMART_COMMS_WORKS)},
    {"id": "smartComms.ai", "app": "smart-comms", "app_name": "Smart Comms",
     "label": "AI — the model and the providers",
     "description": ("Change an AI row's model and its providers on the Smart Comms Desk. The prompt itself stays in "
                     "the code." + _SMART_COMMS_WORKS)},
    {"id": "smartComms.recording", "app": "smart-comms", "app_name": "Smart Comms",
     "label": "Recording — the sheet a situation records to",
     "description": ("Change a situation's Record to: a row with a sheet writes each message there and texts nobody; "
                     "cleared, it speaks again." + _SMART_COMMS_WORKS)},
    {"id": "smartComms.replies", "app": "smart-comms", "app_name": "Smart Comms",
     "label": "Replies — not settled or dismissed",
     "description": ("Give a reply on the Replies page its verdict: not settled (it stays open, waiting for the "
                     "item's owner) or dismissed (filed as read, closing nothing). Works while Smart Comms runs on "
                     "Python; the verdict is kept in the Hub's database and carried to the replies sheet. Settling a "
                     "reply closes the items it answers, so it stays with an admin, a director or a manager.")},
    {"id": "forms.answers", "app": "forms", "app_name": "Forms",
     "label": "Answers — read them and mark one handled",
     "description": ("See the forms and read a form's answers and the files they carried in Forms › Answers, and "
                     "mark an answer handled or put it back. Works while Forms runs on Python; the mark is kept in the "
                     "Hub's database and carried to the answers sheet.")},
    {"id": "forms.links", "app": "forms", "app_name": "Forms",
     "label": "Forms — open, close, rename, archive and restore",
     "description": ("See the forms with their links, open or close a form, change its questions and words, rename it "
                     "(its link stays the same), and archive or restore it: an archived form is closed, its link "
                     "answers 404 and its answers stay filed. Works while Forms runs on Python; the change is kept in "
                     "the Hub's database and carried to the forms sheet. An import from Google and a new link key stay "
                     "an admin's or a manager's.")},
    {"id": "docs.library", "app": "docs", "app_name": "Docs",
     "label": "Library — register and change documents",
     "description": ("Open Settings › Docs and register a document in the library (a category, a name and a link to "
                     "the PDF or Doc), or change one's name, link or category. Everyone the Docs app reaches sees what "
                     "is registered. Works while Docs runs on Python; the change is kept in the Hub's database and "
                     "carried to the documents sheet. Removing a document and importing a Drive folder stay an "
                     "admin's.")},
    {"id": "support.requests", "app": "support-desk", "app_name": "Support Requests",
     "label": "Requests — decide verdicts and ADP changes",
     "description": ("Decide any request on the Support Requests board, as the directors do: approve, deny or resolve "
                     "it, redirect it to somebody's My Work, or mark a warning aware — and approve or undo an ADP · "
                     "Update Information change, its proof checked again against the call before anything is "
                     "approved. A Scheduling request on the board is still answered by Scheduling's own door, and the "
                     "request's texts go out through Smart Comms as they do today. Works while Support Requests runs "
                     "on Python; the decision is kept in the Hub's database and carried to the house's sheet.")},
    {"id": "support.settings", "app": "support-desk", "app_name": "Support Requests",
     "label": "Settings — leads, payroll, routes and directors",
     "description": ("Change the Support Requests settings: who the leads are, who payroll requests go to, the routes "
                     "a request type takes, and the directors the requests wait on (read only while Scheduling's own "
                     "list cannot be). Works while Support Requests runs on Python; the change is kept in the Hub's "
                     "database and carried to the settings sheet.")},
    {"id": "learning.skills", "app": "learning", "app_name": "Learning",
     "label": "Competencies — add, edit and retire",
     "description": ("Open Settings › Learning and add a competency (its name, area and description), change one, or "
                     "retire it so it stops being offered; a retired competency keeps every attempt made at it. "
                     "Everyone Learning reaches practises the active ones. Works while Learning runs on Python; the "
                     "change is kept in the Hub's database and carried to the competencies sheet.")},
    {"id": "recon.review", "app": "time-recon", "app_name": "Time Reconciliation",
     "label": "Review — resolve errors and close runs",
     "description": ("Work the Time Reconciliation review queue: mark an error Excused, Covered, Verified, Flagged or "
                     "Reviewed with a note (or reopen it), and mark a run reviewed. Works while Time Reconciliation "
                     "runs on Python; the change is kept in the Hub's database and carried to the recon sheets. "
                     "Running a reconciliation, uploading or importing punches, a reminder text and an AI suggestion "
                     "stay an admin's or a manager's.")},
    {"id": "recon.settings", "app": "time-recon", "app_name": "Time Reconciliation",
     "label": "Settings — the thresholds",
     "description": ("Open Settings › Time Reconciliation and change the four thresholds (coverage gap, double "
                     "coverage, missing coverage and how far back the sweep reports) and the daily auto run. The "
                     "punches' source is never changed from the screen. Works while Time Reconciliation runs on "
                     "Python; the change is kept in the Hub's database and carried to the config sheet.")},
    # Unlike every edition above, this one does not open an edit — it OPENS THE APP. "opens" names the app the people on
    # this edition's list may use (by name, not by badge): the PSI Log clock. Leave the badge empty to keep it by user.
    {"id": "psiLog.clock", "app": "psi-log", "app_name": "PSI Log", "opens": "psi-log",
     "label": "The app — sign in and clock",
     "description": ("Open the PSI Log app and use it: sign in to PsiAnywhere with your own account and clock in and "
                     "out. This edition OPENS the app to the people on its list, by name, whatever their badge is — "
                     "leave the badge empty to keep it by user only. The master-only pages (Collection, Reset "
                     "Password, the time-entry approval, New client) are not part of it; those stay on their own App "
                     "Control rows.")},
)
# (id, app) in catalogue order: scope.EDITIONS
IDS: tuple[tuple[str, str], ...] = tuple((e["id"], e["app"]) for e in CATALOGUE)
_BY_ID: dict[str, dict[str, str]] = {e["id"]: e for e in CATALOGUE}

# The config tab is dissolved into the runtime book's Facts: a save is one more fact and the newest per key wins
# (HiringMatrix.gs hiringLegacyWrite_). Kept in app.edits as an appended fact the two-way sync carries to the sheet.
CONFIG_SOURCE = "dissolution:hiring_alerts_config.value"
CONFIG_FACT_KEY = "legacy.hiring_alerts_config.value"
RECORDED_BY = "asa-hub-app"
EVIDENCE = "asa-hub-app editionsSet "
FACT_HEADS = ("Fact Key", "Subject ID", "Value", "Source", "Evidence", "Recorded At", "Recorded By")
# the appended fact's key (a writes.COLS match): its subject, its source and the save that made it
KEY_HEADS = ("Subject ID", "Source", "Evidence")
KEY_MATCH = "cols:" + "|".join(KEY_HEADS)
# the evidence of the saves the copy holds, read again when the Facts copy is reloaded
_HELD: dict[str, Any] = {"key": None, "held": frozenset()}


def edition_of(eid: Any) -> dict[str, str] | None:
    """hubEditionOf_: the edition by its id; None for an id the platform does not have."""
    return _BY_ID.get(gsjs.trim(gsjs.or_blank(eid)))


def open_badges() -> tuple[str, ...]:
    """The badges an edition may be opened to, each with every badge above it: the employees' own, STAFF and up."""
    import scope as sc  # noqa: PLC0415 - scope reads its list from this module
    return sc.BADGE_ORDER[1:sc.BADGE_ORDER.index("STAFF") + 1]


def parse(raw: Any) -> dict[str, dict[str, Any]]:
    """hubEditionsParse_, FAIL-CLOSED: {id: {on, people, badge}}, each known edition once; a blank or malformed cell
    opens nothing, and a badge the platform does not open an edition to is none."""
    out: dict[str, dict[str, Any]] = {}
    text = gsjs.trim(gsjs.or_blank(raw))
    if not text:
        return out
    try:
        items = json.loads(text)
    except (ValueError, RecursionError):
        return out
    if not isinstance(items, list):
        return out
    for e in items:
        if not isinstance(e, dict):
            continue
        ed = edition_of(e.get("id"))
        if ed is None or ed["id"] in out:
            continue
        people: list[str] = []
        for p in e.get("people") if isinstance(e.get("people"), list) else []:
            pid = gsjs.trim(gsjs.or_blank(p))[:80]
            if pid and pid not in people and len(people) < EDITION_MAX_PEOPLE:
                people.append(pid)
        badge = gsjs.trim(gsjs.or_blank(e.get("badge"))).upper()
        out[ed["id"]] = {"on": e.get("on") is True, "people": people,
                         "badge": badge if badge in open_badges() else ""}
    return out


def view(stored: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    """hubEditionsView_: the catalogue with each edition's key, list and badge, as Settings › Editions draws it."""
    out = []
    for e in CATALOGUE:
        held = stored.get(e["id"]) or {"on": False, "people": [], "badge": ""}
        out.append({**e, "on": held["on"] is True, "people": list(held["people"]), "badge": held.get("badge") or ""})
    return out


def allows(eid: str, user: dict[str, Any] | None, config: dict[str, str] | None) -> bool:
    """hubEditionAllows_ at home: the master always; an employee wearing the edition's floor badge or one above it;
    else, while its key is on, one on the edition's list or wearing the badge it is opened to or one above it (a
    visit, a world or a place away from home is never routed to Python)."""
    import scope as sc  # noqa: PLC0415 - scope reads its list from this module
    ed = edition_of(eid)
    if ed is None:
        return False
    if sc.is_real_master(user):
        return True
    if not user or user.get("is_service") is True or user.get("visiting_member"):
        return False
    if gsjs.trim(gsjs.or_text(user.get("role"))).lower() not in EDITION_ROLES:
        return False
    # an SSA or a FAMILY holds no edition, whatever its role says (scope.role_counts)
    if not sc.role_counts(user.get("types"), user.get("role")):
        return False
    if ed.get("floor") and sc.wears_from(user, ed["floor"]):
        return True
    held = parse((config or {}).get(EDITIONS_KEY)).get(ed["id"])
    if not held or held["on"] is not True:
        return False
    if held["badge"] and sc.wears_from(user, held["badge"]):
        return True
    uid = gsjs.trim(gsjs.or_text(user.get("id")))
    return bool(uid) and uid in held["people"]


# an edition NEVER opens one of these — they stay the master's whatever a catalogue entry says (badgeAccess.ts
# MASTER_ONLY_APPS; the SPA's badgeAllowsApp returns on the same list before it ever reads editionApps)
MASTER_ONLY_APPS = frozenset({"app-control", "credentials", "mail"})


def opened_apps(user: dict[str, Any] | None, config: dict[str, str] | None) -> list[str]:
    """The apps an edition OPENS for this user — one with an "opens" field whose list (or badge) names them. For the
    app list: these apps are theirs by name, whatever their badge. The master makes every edition, so it gets them
    all, but the master already opens every app. A master-only app is never opened this way, whatever a catalogue
    entry says."""
    return sorted({e["opens"] for e in CATALOGUE
                   if e.get("opens") and e["opens"] not in MASTER_ONLY_APPS and allows(e["id"], user, config)})


# ---- the value read: the copy's config with the saves the copy does not hold yet ---------------------------------

def _held(db: hubdb.HubDb, wanted: set[str]) -> frozenset[str]:
    """The saves (their evidence) the Facts copy already holds: there, the copy's own order decides."""
    ref = db.tab(hubdb.ESSENCIAL_ID, hubdb.FACTS_TAB)
    if ref is None or not wanted:
        return frozenset()
    key = (ref.table, str(ref.loaded_at), frozenset(wanted))
    if _HELD["key"] == key:
        return _HELD["held"]
    if not re.fullmatch(r"[a-z0-9_]{1,63}", ref.table):
        raise hubdb.Unreadable("the catalog names an unusable table for the depot's Facts")
    got = db.query(f'select distinct evidence from {db.from_sql(ref)}'  # noqa: S608
                   " where source = %s and evidence = any(%s)", (CONFIG_SOURCE, sorted(wanted)))
    held = frozenset(str(r[0] or "") for r in got)
    _HELD.update(key=key, held=held)
    return held


def laid_config(db: hubdb.HubDb, cfg: dict[str, str]) -> dict[str, str]:
    """hiringAlerts_ as Python reads it: the copy's config, each value the edit store saved laid over it until the
    copy holds that save (hubdb.OWN, this request's view of app.edits)."""
    groups = (getattr(hubdb.OWN.get(), "edits", None) or {}).get((hubdb.ESSENCIAL_ID, hubdb.FACTS_TAB)) or ()
    pending: list[tuple[str, str, str]] = []
    for g in groups:
        if not g.get("appended") or g.get("match") != KEY_MATCH:
            continue
        cells = {f: v for f, (_id, v, _born) in g["cells"].items()}
        subject = gsjs.trim(gsjs.or_blank(cells.get("Subject ID")))
        if cells.get("Source") != CONFIG_SOURCE or "Value" not in cells or not subject:
            continue
        pending.append((subject, gsjs.or_blank(cells.get("Evidence")), cells["Value"]))
    if not pending:
        return cfg
    held = _held(db, {ev for _s, ev, _v in pending if ev})
    out = dict(cfg)
    # oldest first: the newest save of a key not yet in the copy is its value
    for subject, ev, value in pending:
        if not (ev and ev in held):
            out[subject] = value
    return out


def config_facts(reads: Any) -> tuple[str, hubdb.TabRef]:
    """Where a save lands: the runtime book's Facts, the same book Python reads the config from, with every column a
    fact names."""
    import scope as sc  # noqa: PLC0415 - scope reads its list from this module
    sid = reads.db.prop("HUB_APPS_RUNTIME_ID") or hubdb.ESSENCIAL_ID
    if sid != hubdb.ESSENCIAL_ID:
        raise sc.Defer("the runtime book is not the book Python reads the config from")
    ref = reads.tab_of(sid, hubdb.FACTS_TAB, "the depot's Facts")
    if ref is None:
        raise hubdb.Unreadable("the depot's Facts are not in asa-hub-db")
    have = {gsjs.trim(gsjs.js_str(h)) for h in ref.headers}
    missing = [h for h in FACT_HEADS if h not in have]
    if missing:
        raise hubdb.Unreadable("the depot's Facts have no " + ", ".join(missing) + " column")
    return sid, ref


# ---- the doors ---------------------------------------------------------------------------------------------------

def editions_mine(sess: Any, payload: dict) -> dict[str, Any]:
    """editionsMine: the editions this session makes (of one app when `app` names it), ids only."""
    import scope as sc  # noqa: PLC0415 - scope reads its list from this module
    app = gsjs.trim(gsjs.or_text(payload.get("app")))
    user = sess.user or {}
    cfg: dict[str, str] = {}
    if not sc.is_real_master(user):
        try:
            cfg = sess.reads.config()
        except Exception as exc:  # noqa: BLE001 - FAIL-CLOSED: a config that cannot be read opens nothing
            log.warning("editionsMine: the config could not be read (%s)", type(exc).__name__)
            cfg = {}
    return {"status": 200, "data": {"editions": [e["id"] for e in CATALOGUE if (not app or e["app"] == app)
                                                 and allows(e["id"], user, cfg)]}}


def editions_get(sess: Any, payload: dict) -> dict[str, Any]:
    """editionsGet: the master's own read of every edition, its key and its people; everybody else the 404."""
    import scope as sc  # noqa: PLC0415 - scope reads its list from this module
    if not sc.is_real_master(sess.user):
        return {"status": 404, "message": UNKNOWN}
    try:
        cfg = sess.reads.config()
    except Exception as exc:  # noqa: BLE001 - never answered as "nobody": a list saved over one nobody read replaces it
        log.warning("editionsGet: the config could not be read (%s)", type(exc).__name__)
        return {"status": 503, "message": CONFIG_UNREAD}
    raw = gsjs.trim(gsjs.or_blank(cfg.get(EDITIONS_KEY)))
    malformed = False
    if raw:
        try:
            malformed = not isinstance(json.loads(raw), list)
        except (ValueError, RecursionError):
            malformed = True
    return {"status": 200, "data": {"editions": view(parse(raw)), "malformed": malformed}}


def editions_set(sess: Any, payload: dict) -> Any:
    """editionsSet: the master saves every edition at once, its key and its people — kept in app.edits as the
    config's newest fact, final."""
    import scope as sc  # noqa: PLC0415 - scope reads its list from this module
    import writes as W  # noqa: PLC0415 - writes reads the scope this module feeds
    sent = payload.get("editions")
    if sent is None or sent == "":
        # hubPolicyGate_'s required parameter, decided before the door
        return W.refuse(400, "Missing required parameter: editions.")
    if not sc.is_real_master(sess.user):
        return W.Decision({"status": 404, "message": UNKNOWN})
    if not isinstance(sent, list):
        return W.refuse(400, "editions: every edition, its key and its people.")
    by_id: dict[str, dict] = {}
    for u in sess.reads.users():
        uid = gsjs.str_(u.get("userid"))
        if uid:
            by_id[uid] = u
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in sent:
        e = item if isinstance(item, dict) else {}
        ed = edition_of(e.get("id"))
        if ed is None:
            return W.refuse(400, f'No edition "{gsjs.str_(e.get("id"))[:80]}". Nothing was saved.')
        if ed["id"] in seen:
            return W.refuse(400, ed["label"] + " is named twice. Nothing was saved.")
        seen.add(ed["id"])
        people = e.get("people") if isinstance(e.get("people"), list) else []
        if len(people) > EDITION_MAX_PEOPLE:
            return W.refuse(400, f"At most {EDITION_MAX_PEOPLE} people on one edition. Nothing was saved.")
        ids: list[str] = []
        for p in people:
            pid = gsjs.str_(p)[:80]
            if not pid:
                return W.refuse(400, "Every person on " + ed["label"] + " is an account. Nothing was saved.")
            if pid in ids:
                continue
            row = by_id.get(pid)
            if row is None:
                return W.refuse(400, f'No account "{pid}". Nothing was saved.')
            name = gsjs.str_(row.get("displayname")) or gsjs.str_(row.get("email")) or pid
            if sc.is_master_email(gsjs.str_(row.get("email"))):
                return W.refuse(400, "The master account holds every edition; it is never put on a list. "
                                     "Nothing was saved.")
            role = (gsjs.str_(row.get("role")) or "staff").lower()
            if role not in EDITION_ROLES:
                return W.refuse(400, "Editions are for employees only (admin, manager or staff); " + name + " is "
                                + role + ". Nothing was saved.")
            ids.append(pid)
        badge = gsjs.str_(e.get("badge")).upper()
        if badge and badge not in open_badges():
            return W.refuse(400, f'{ed["label"]} is not opened to "{badge[:40]}": a badge from STAFF up. '
                                 "Nothing was saved.")
        out.append({"id": ed["id"], "on": e.get("on") is True, "people": ids, **({"badge": badge} if badge else {})})
    kept = [x for x in out if x["on"] or x["people"] or x.get("badge")]
    value = json.dumps(kept, separators=(",", ":"), ensure_ascii=False) if kept else ""
    if len(value) > W.EDIT_VALUE_MAX:
        return W.refuse(400, TOO_LONG)
    reads = sess.reads
    sid, ref = config_facts(reads)
    evidence = EVIDENCE + str(uuid.uuid4())
    cells = {"Fact Key": CONFIG_FACT_KEY, "Subject ID": EDITIONS_KEY, "Value": value, "Source": CONFIG_SOURCE,
             "Evidence": evidence, "Recorded At": W.now_iso(reads), "Recorded By": RECORDED_BY}
    row_key = "\x1f".join((EDITIONS_KEY, CONFIG_SOURCE, evidence))
    rec = W.kept_record(sid, ref.tab, "append", KEY_MATCH, row_key, EDITIONS_KEY, cells)
    log.info("editions_set: %d edition(s) on, %d with a list", sum(1 for x in kept if x["on"]), len(kept))
    answer = {"status": 200, "data": {"editions": view(parse(value)), "malformed": False}}
    return W.final(answer, [rec], EDITIONS_KEY)


# ---- Settings › My Work: the switches Python alone keeps -------------------------------------------------------------

# each part → its config key; a switch with no value on file hides the part (it ships hidden)
MY_WORK_HIDES = {"add_apps": "mywork_hide_add_apps", "time_off_messages": "mywork_hide_time_off_messages",
                 "sched_training_legend": "mywork_hide_sched_training_legend",
                 "ssa_documents": "mywork_hide_ssa_documents",
                 # Scheduling › Time Off Requests: every ask to a house manager and every badge above
                 "sched_time_off_all": "mywork_hide_sched_time_off_all",
                 # every test mode warning the apps draw (banners, pills, lines, an item's "Test mode")
                 "test_mode_warnings": "mywork_hide_test_mode_warnings",
                 "client_medication": "mywork_hide_client_medication",
                 "client_billing": "mywork_hide_client_billing",
                 # Clients › Care & Support's Home & equipment tab
                 "client_care_home": "mywork_hide_client_care_home",
                 # My Inbox › Alerts: new staff members and the release notes' updates (apps, security, privacy)
                 "inbox_alerts": "mywork_hide_inbox_alerts",
                 "location_supplies": "mywork_hide_location_supplies",
                 "profile_docs": "mywork_hide_profile_docs",
                 # "<source>: the copy read here was mirrored <day> — anything filed since may not show yet", on
                 # My Profile › My Requirements and under My Work's sources
                 "copy_mirrored": "mywork_hide_copy_mirrored",
                 # the screens' own furniture: My Inbox › Alerts' line under the title, the candidates' breadcrumb
                 # inside the page, the sidebar's Transportation submenu, Clients › Appointments' trips, the clients'
                 # names on Staff › Calendar, the map on a staff profile, the progress panel after an edit's Apply
                 "inbox_alerts_subtitle": "mywork_hide_inbox_alerts_subtitle",
                 "candidates_crumb": "mywork_hide_candidates_crumb",
                 "transport_submenu": "mywork_hide_transport_submenu",
                 "client_trips": "mywork_hide_client_trips",
                 "staff_calendar_clients": "mywork_hide_staff_calendar_clients",
                 # Staff › Calendar's line under the title, the count coming up, the week headers and counts, the badges
                 "staff_calendar_details": "mywork_hide_staff_calendar_details",
                 # Clients' Client details panel: its title, the Updated line, the intro and the notes under fields
                 "client_edit_notes": "mywork_hide_client_edit_notes",
                 # SSA › Activity's Coordination follow-up, and the SSA's edit panel: its title, intro and field notes
                 "ssa_coordination": "mywork_hide_ssa_coordination",
                 "ssa_edit_notes": "mywork_hide_ssa_edit_notes",
                 # every New incident panel (Locations, Clients, Families): its title, the notes under the fields and
                 # the Still needed line
                 "incident_notes": "mywork_hide_incident_notes",
                 # Clients › Transportation: the Vehicles tab, the counts and the lines under them
                 "client_transport_notes": "mywork_hide_client_transport_notes",
                 "staff_profile_map": "mywork_hide_staff_profile_map",
                 # Staff › Staff Profile: the ISTs card and Where they worked
                 "staff_profile_ists_worked": "mywork_hide_staff_profile_ists_worked",
                 # Staff's edit panels: the intro and the notes under the fields
                 "staff_edit_notes": "mywork_hide_staff_edit_notes",
                 # the whole Recruiters' Book app: its place in the apps list and every row it reads or writes
                 "recruiters_book": "mywork_hide_recruiters_book",
                 "apply_progress": "mywork_hide_apply_progress",
                 # Support Requests: the line under the title
                 "support_desk_subtitle": "mywork_hide_support_desk_subtitle",
                 # My Work's Client training (IST): the booking panel, the directors' approvals and the outcome
                 "ist_booking": "mywork_hide_ist_booking",
                 # the whole Mail app: cut from every other account's lists, the seen list included. The app is the
                 # master's alone whatever this says (app_control.MASTER_ONLY_APPS: no badge or switch opens it)
                 "mail_app": "mywork_hide_mail_app"}
# the parts a blank switch shows (they ship shown); an unread config still hides them
SHOWN_UNSET = frozenset({"sched_time_off_all"})
HIDES_EVIDENCE = "asa-hub-app myWorkHidesSet "
HIDES_UNREAD = "The platform config could not be read, so the switches are not shown. Try again."
SESSION_ROLES = ("admin", "director", "manager", "staff", "client", "onboarding", "interviewer")


def _hidden(cfg: dict[str, str], key: str, part: str = "") -> bool:
    """A part is shown only when its switch says so: yes, a blank or anything else hides it — but a blank shows a part
    that ships shown (SHOWN_UNSET)."""
    said = gsjs.trim(gsjs.or_blank(cfg.get(key))).lower()
    if not said and part in SHOWN_UNSET:
        return False
    return said not in ("no", "false", "0", "off")


def mail_hidden(cfg: dict[str, str]) -> bool:
    """Whether the Mail app's switch cuts it from every other account's lists (as it ships)."""
    return _hidden(cfg, MY_WORK_HIDES["mail_app"], "mail_app")


def my_work_hides_get(sess: Any, payload: dict) -> dict[str, Any]:
    """myWorkHidesGet: the master's own read of the switches Python keeps; everybody else the 404."""
    import scope as sc  # noqa: PLC0415 - scope reads its list from this module
    if not sc.is_real_master(sess.user):
        return {"status": 404, "message": UNKNOWN}
    try:
        cfg = sess.reads.config()
    except Exception as exc:  # noqa: BLE001 - never answered as "shown": a switch flipped over an unread value lies
        log.warning("myWorkHidesGet: the config could not be read (%s)", type(exc).__name__)
        return {"status": 503, "message": HIDES_UNREAD}
    return {"status": 200, "data": {part: _hidden(cfg, key, part) for part, key in MY_WORK_HIDES.items()}}


def hides_for(sess: Any) -> dict[str, bool]:
    """Which of those parts this session does not see. The master sees every part; any other session sees a part
    only when its switch shows it, and a config that cannot be read hides every part."""
    import scope as sc  # noqa: PLC0415 - scope reads its list from this module
    if sc.is_real_master(sess.user):
        return {part: False for part in MY_WORK_HIDES}
    try:
        cfg = sess.reads.config()
    except Exception as exc:  # noqa: BLE001 - FAIL-CLOSED: an unread config hides the part
        log.warning("my work hides: the config could not be read (%s)", type(exc).__name__)
        return {part: True for part in MY_WORK_HIDES}
    return {part: _hidden(cfg, key, part) for part, key in MY_WORK_HIDES.items()}


def my_work_hides_mine(sess: Any, payload: dict) -> dict[str, Any]:
    """myWorkHidesMine: which of those parts this session does not see (hides_for)."""
    return {"status": 200, "data": hides_for(sess)}


def my_work_hides_set(sess: Any, payload: dict) -> Any:
    """myWorkHidesSet: the master flips one switch — kept in app.edits as the config's newest fact, final."""
    import scope as sc  # noqa: PLC0415 - scope reads its list from this module
    import writes as W  # noqa: PLC0415 - writes reads the scope this module feeds
    if not sc.is_real_master(sess.user):
        return W.Decision({"status": 404, "message": UNKNOWN})
    part = gsjs.trim(gsjs.or_text(payload.get("part")))
    hide = payload.get("hidden")
    if part not in MY_WORK_HIDES:
        return W.refuse(400, "part: " + ", ".join(MY_WORK_HIDES) + ".")
    if not isinstance(hide, bool):
        return W.refuse(400, "hidden: true or false.")
    key = MY_WORK_HIDES[part]
    value = "yes" if hide else "no"
    reads = sess.reads
    sid, ref = config_facts(reads)
    evidence = HIDES_EVIDENCE + str(uuid.uuid4())
    cells = {"Fact Key": CONFIG_FACT_KEY, "Subject ID": key, "Value": value, "Source": CONFIG_SOURCE,
             "Evidence": evidence, "Recorded At": W.now_iso(reads), "Recorded By": RECORDED_BY}
    row_key = "\x1f".join((key, CONFIG_SOURCE, evidence))
    rec = W.kept_record(sid, ref.tab, "append", KEY_MATCH, row_key, key, cells)
    log.info("my_work_hides_set: %s %s", part, value)
    return W.final({"status": 200, "data": {part: hide}}, [rec], key)


ACTIONS = {"editionsGet": editions_get, "editionsMine": editions_mine, "myWorkHidesGet": my_work_hides_get,
           "myWorkHidesMine": my_work_hides_mine}
# HUB_POLICY: the roles each door is declared for, and its typed params
POLICY: dict[str, dict[str, Any]] = {"editionsGet": {"roles": ("admin",)},
                                     "editionsMine": {"roles": EDITION_ROLES, "params": {"app": "string"}},
                                     "myWorkHidesGet": {"roles": ("admin",)},
                                     "myWorkHidesMine": {"roles": SESSION_ROLES}}
# the saves, decided under the write lock and kept in app.edits (main.WRITES)
WRITE = types.SimpleNamespace(ACTIONS={"editionsSet": editions_set, "myWorkHidesSet": my_work_hides_set},
                              POLICY={"editionsSet": {"roles": ("admin",), "params": {"editions": "array"}},
                                      "myWorkHidesSet": {"roles": ("admin",),
                                                         "params": {"part": "string", "hidden": "boolean"}}})
