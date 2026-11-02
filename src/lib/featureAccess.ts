// A feature with no row is OPEN to whoever reached the page — the opposite of apps, which default to the master alone.
import { badgeRuleAllows, useBadgeAccessStore } from '@/lib/badgeAccess'
import { effectiveUser } from '@/lib/effectiveUser'

export type AppFeature = {
  /** the row id in the badge matrix — `<appId>.<feature>`, and it is a key */
  id: string
  label: string
  /** what a person loses when their badge is not on the row */
  hint: string
  // An app's polarity instead of a control's: with no row it is the master's alone, not everyone's.
  masterUntilReleased?: boolean
  /** who the control reaches while its row names no badge, when the server answers for it ("Admin and above") */
  whenEmpty?: string
}

// Every gateable control, by app.
export const APP_FEATURES: Record<string, AppFeature[]> = {
  schedule: [
    {
      id: 'schedule.messageStaff',
      label: 'Message staff',
      hint: 'The button that writes to everybody on the schedule at once.',
    },
    {
      id: 'schedule.eventTypeFilters',
      label: 'Event type legend',
      hint: 'The Shift / Appointment / Training rows in the aside, and whether pressing one folds it away.',
    },
  ],
  'taskboard-sheet': [
    {
      id: 'taskboard-sheet.multipleSheets',
      label: 'More than one spreadsheet per card',
      hint:
        'A card keeps ONE spreadsheet by default — that is what makes the button mean something. ' +
        'Badges named here also get an "Another sheet" button on a card that already has one. ' +
        'The server refuses the second file to anybody this row does not name, whatever the screen draws.',
    },
  ],
  calendar: [
    {
      id: 'calendar.eventTypeFilters',
      label: 'Event type filters',
      hint: 'The Shifts / Appointments / Training toggles that decide what the calendar draws.',
    },
  ],
  // the server asks the same ids (apps-script/SchedulingViews.gs): no row answers 404 to all but the master
  // the server asks the same ids (app/psi_log.py COLLECTION, RESET_FEATURE): no row answers to the master alone
  'psi-log': [
    {
      id: 'psi-log.collection',
      label: 'PSI collection',
      hint: 'The Staff, Clients, Time entries, Places & codes and Collection pages: everything PsiAnywhere holds about ' +
        'every employee and client, and every punch. Opening PSI Log for the clock does not open these.',
      masterUntilReleased: true,
    },
    {
      id: 'psi-log.passwordReset',
      label: 'Reset Password',
      hint: 'The page that gives an employee a new PsiAnywhere password. Whoever is named here must be signed in to ' +
        'PsiAnywhere with an administrator account for a reset to go through.',
      masterUntilReleased: true,
    },
    {
      id: 'psi-log.approve',
      label: 'Approve or reject time entries',
      hint: 'The Approve and Reject buttons on PSI time entries: hours awaiting approval become Submitted, or go back ' +
        'with a reason. Whoever is named here must be signed in to PsiAnywhere with an administrator account.',
      masterUntilReleased: true,
    },
    {
      id: 'psi-log.accounts',
      label: 'Turn accounts on or off',
      hint: 'The Active / Inactive switch on Reset Password: it activates or deactivates a PsiAnywhere account. ' +
        'Whoever is named here must be signed in to PsiAnywhere with an administrator account.',
      masterUntilReleased: true,
    },
    {
      id: 'psi-log.newClient',
      label: 'New client',
      hint: 'The New client page: it adds a client to PsiAnywhere (insertNewIndividual). Whoever is named here must ' +
        'be signed in to PsiAnywhere with an administrator account.',
      masterUntilReleased: true,
    },
  ],
  scheduling: [
    {
      id: 'scheduling.staffCalendars',
      label: 'Staff Calendars',
      hint: 'The Staff Calendars screen: one person’s shifts across every house, and every open shift. ' +
        'Nobody it does not name sees the screen switch.',
      masterUntilReleased: true,
    },
    {
      id: 'scheduling.timeOffRequests',
      label: 'Time Off Requests',
      hint: 'The Time Off Requests screen: the time off and Request Off asks, new and approved, decided by the directors.',
      masterUntilReleased: true,
    },
    {
      id: 'scheduling.builder',
      label: 'Builder',
      hint: 'The Builder screen: an A/B pattern for a house, checked, balanced day by day and published into its calendar. ' +
        'Only the house manager, the directors and the master build a house, and only once named here.',
      masterUntilReleased: true,
    },
    {
      // only the screen: its reads and decisions are the Time Reconciliation app's (recon*), refused by that app's rule
      id: 'scheduling.timeReconciliation',
      label: 'Time Reconciliation',
      hint: 'The Time Reconciliation screen inside Scheduling: that app’s own review queue, by PsiAnywhere pay ' +
        'period — the anomalies house by house — and the runs over the period. It shows to whoever is named ' +
        'here, whatever the Time Reconciliation app’s own release or hiding says; every decision (resolve, ' +
        'remind, run, close) stays with admin and manager, as in that app.',
      masterUntilReleased: true,
    },
    {
      // the server asks the same id (app/scheduling_drag.py FEATURE) and says the houses as the board's viewer.drag_move
      id: 'scheduling.dragMove',
      label: 'Drag and drop (moves at once)',
      hint: 'On House Calendars a shift dragged onto another cell of the same house moves there at once, auto-approved, ' +
        'after a side panel lists what that drop does. House Manager and Team Lead move at the houses they manage; ' +
        'Supervisor, Admin, Administrator, Director and Platform Lead at every house. Anyone not named here keeps the ' +
        'drag that opens Swap shifts and the OPEN shift panels, with their approvals.',
      masterUntilReleased: true,
    },
    {
      // the server asks the same id (app/overtime_lanes.py, /hub-lanes/scheduling/overtime) after Scheduling's own row
      id: 'scheduling.overtime',
      label: 'Overtime screen',
      hint: 'Scheduling’s Overtime screen: the hours each employee was planned against the hours PsiAnywhere says ' +
        'they worked, per Sunday–Saturday week, over 40 h highlighted. The master’s alone until badges are named here.',
      masterUntilReleased: true,
    },
  ],
  // the server asks the same id (app/overtime_lanes.py, /hub-lanes/time-recon/overtime…) after the readers' gate
  'time-recon': [
    {
      id: 'time-recon.overtime',
      label: 'Overtime',
      hint: 'The Overtime tab of Time Reconciliation: each employee’s worked hours per Sunday–Saturday week from ' +
        'PsiAnywhere, summed across every house, over 40 h highlighted, and the entries behind them. The master’s ' +
        'alone until badges are named here.',
      masterUntilReleased: true,
    },
  ],
  // the server asks the same id (app/my_work_writes.py FEATURE) before Smart Comms is handed the message
  'my-work': [
    {
      id: 'my-work.timeOffMessages',
      label: 'Time off messages',
      hint: 'The Send Message Approved / Send Message Not Approved buttons on a Time off approval row: Smart Comms ' +
        'tells the person the outcome and to ask their director for details. With no row, whoever the request ' +
        'waits on (its house manager or a director) and the master; badges named here narrow it to them.',
    },
  ],
  // the server asks the same id (app/sheet_resources.py VOICE_BOT_FEATURE) for the voice bot's support structure
  hotline: [
    {
      id: 'hotline.voice-bot',
      label: 'Voice bot structure',
      hint: 'The bot pages: what the line’s voice bot knows and follows — its knowledge, policies, rules, follow-ups, ' +
        'homes, clients, staff and schedule — read, edited, added and removed. The master’s alone until badges are ' +
        'named here.',
      masterUntilReleased: true,
    },
  ],
  // the server asks the same id (app/sheet_resources.py SCREENING_NOTES_FEATURE) for the screening form's rows
  interviews: [
    {
      id: 'interviews.screening-notes',
      label: 'In-person screening notes',
      hint: 'The In-person screening notes page: every interviewer’s scorecard from the screening form, read, edited, ' +
        'added and removed. The master’s alone until badges are named here.',
      masterUntilReleased: true,
    },
  ],
  // the server asks the same id (app/sheet_resources.py MISSING_MEDS_FEATURE) for the Missing Medications book's rows
  medications: [
    {
      id: 'medications.missing',
      label: 'Missing medications',
      hint: 'The missing-meds pages: the forms’ requests, low refills, medication control, the doctors and the ' +
        'abnormal deliveries, worked (status, notes), added and removed. The master’s alone until badges are named ' +
        'here.',
      masterUntilReleased: true,
    },
  ],
  // the server asks the same id (app/sheet_resources.py STAFF_ISSUES_FEATURE) for the HR tracker's rows
  staffissues: [
    {
      id: 'staffissues.manage',
      label: 'Manage issues',
      hint: 'The Manage issues page: every HR tracker row edited (follow up, disciplinary action, result, termination ' +
        'summary), added and removed. The Staff Issues list stays as App Control has it. The master’s alone until ' +
        'badges are named here.',
      masterUntilReleased: true,
    },
  ],
  // the server asks the same id (app/sheet_resources.py HOUSE_REPAIR_FEATURE) for the repairs' and inventory's rows
  'house-repair': [
    {
      id: 'house-repair.manage',
      label: 'Manage repairs',
      hint: 'The Manage repairs and House inventory pages: repair requests answered (status, resolution notes), added ' +
        'and removed, and the houses’ inventory kept. The read-only House Repair page stays as App Control has it. ' +
        'The master’s alone until badges are named here.',
      masterUntilReleased: true,
    },
  ],
  // the server asks the same id (app/sheet_resources.py DIVISION_TASKS_FEATURE) for every task list's rows
  directors: [
    {
      id: 'directors.tasks',
      label: 'Division tasks',
      hint: 'The task pages: each director’s task list (Britt, Cassy, Nat, Regina, Tammy, Tieara), the monthly doc ' +
        'review and the division notes — read, added, edited and removed there. The master’s alone until badges are ' +
        'named here.',
      masterUntilReleased: true,
    },
  ],
  // the server asks the same id (app/family.py NOTES_FEATURE) for the tab, the Activity's note lines and both packs
  'family-profiles': [
    {
      id: 'family-profiles.notes',
      label: 'Notes',
      hint: 'The Notes tab: a family member’s admin notes, and their lines in the Activity. With no badges, Admin and ' +
        'every badge above it (Supervisor, Director…) and the master; badges named here decide instead. Filing a ' +
        'note still needs the notes edition.',
      whenEmpty: 'Admin and above',
    },
  ],
  // the server asks the same id (app/ssa.py NOTES_FEATURE) for the tab, the Activity's note lines and the SSA pack
  'ssa-profiles': [
    {
      id: 'ssa-profiles.notes',
      label: 'Notes',
      hint: 'The Notes tab: an SSA’s admin notes, and their lines in the Activity. With no badges, Admin and every ' +
        'badge above it (Supervisor, Director…) and the master; badges named here decide instead. Filing a note ' +
        'still needs the notes edition.',
      whenEmpty: 'Admin and above',
    },
  ],
  'my-inbox': [
    {
      // the relay's ticket door asks this same id (server/chat_live.py APP_ID)
      id: 'my-inbox.liveChat',
      label: 'Live chat',
      hint: 'My Inbox → Chat carried live: messages, read marks and presence arrive as they happen. ' +
        'Everyone not named here keeps the chat as it was.',
      masterUntilReleased: true,
    },
  ],
  'support-desk': [
    {
      id: 'support-desk.incidents',
      label: 'Incidents',
      hint: 'The Incidents page: every report on the Incident Log (the UIs and MUIs book) in Support Requests’ table, ' +
        'opened in the Incident Log’s own side panel. The master’s alone until badges are named here.',
      masterUntilReleased: true,
    },
    {
      // the server asks the same id (app/writes.py support_incident_door), together with the page's own row
      id: 'support-desk.incidentsEdit',
      label: 'Edit an incident',
      hint: 'The pencil in an incident’s side panel on the Incidents page: the report’s fields, saved to the ' +
        'Incident Log (the UIs and MUIs book); the report stays its own client’s (a client is changed in Locations or ' +
        'the client’s Incidents). Needs Support Requests and the Incidents page too. The master’s alone until badges ' +
        'are named here.',
      masterUntilReleased: true,
    },
  ],
  // the operator's access sheet (2026-10-29): each split below is asked by the server under the same id
  'my-profile': [
    {
      id: 'my-profile.requirements',
      label: 'My Requirements',
      hint: 'The My Requirements page: the person’s own compliance requirements and their uploads. My Details stays as ' +
        'App Control has My Profile. The master’s alone until badges are named here.',
      masterUntilReleased: true,
    },
  ],
  'client-profiles': [
    {
      id: 'client-profiles.transportation',
      label: 'Transportation',
      hint: 'Clients › Transportation (Calendar and History): the client’s trips. The rest of Clients stays as App ' +
        'Control has it. The master’s alone until badges are named here.',
      masterUntilReleased: true,
    },
  ],
  'staff-profiles': [
    {
      id: 'staff-profiles.team',
      label: 'Whole team',
      hint: 'Every staff member’s profile. A badge not named here opens Staff to its own profile only (Their Data). The ' +
        'master’s alone until badges are named here.',
      masterUntilReleased: true,
    },
    {
      id: 'staff-profiles.performance',
      label: 'Performance',
      hint: 'The Performance tab of a staff profile. The master’s alone until badges are named here.',
      masterUntilReleased: true,
    },
    {
      id: 'staff-profiles.hrAdmin',
      label: 'HR Admin',
      hint: 'The HR Admin tab of a staff profile. The master’s alone until badges are named here.',
      masterUntilReleased: true,
    },
    {
      id: 'staff-profiles.employeePay',
      label: 'Employee Pay',
      hint: 'The Employee Pay tab of a staff profile: loans and payments. The master’s alone until badges are named here.',
      masterUntilReleased: true,
    },
    {
      id: 'staff-profiles.activity',
      label: 'Activity',
      hint: 'The Activity tab of a staff profile: Timeline, Visits, Shifts, Texts and Transcripts. The master’s alone ' +
        'until badges are named here.',
      masterUntilReleased: true,
    },
  ],
}

export function featureOf(featureId: string): AppFeature | undefined {
  for (const list of Object.values(APP_FEATURES)) {
    const found = list.find((f) => f.id === featureId)
    if (found) return found
  }
  return undefined
}

/** The app a control belongs to (the key in APP_FEATURES), or undefined. */
export function featureAppOf(featureId: string): string | undefined {
  for (const [appId, list] of Object.entries(APP_FEATURES)) {
    if (list.some((f) => f.id === featureId)) return appId
  }
  return undefined
}

/** Is this feature gated at all? (No row = open to whoever reached the page, unless it is the master's until released.) */
export function featureIsGated(featureId: string, rules: Record<string, string[]>): boolean {
  const rule = rules[featureId]
  return Boolean(rule && rule.length) || Boolean(featureOf(featureId)?.masterUntilReleased)
}

// Pure: may this person use this control?
export function featureAllowsWith(
  featureId: string,
  user: { isMaster?: boolean; types?: string[]; role?: string; editionApps?: string[] } | null | undefined,
  rules: Record<string, string[]>,
): boolean {
  // an edition that OPENS the app opens all of it — every control included — to the people it names
  const app = featureAppOf(featureId)
  if (app && user?.editionApps?.includes(app)) return true
  const rule = rules[featureId]
  if (!rule || rule.length === 0) return featureOf(featureId)?.masterUntilReleased ? user?.isMaster === true : true
  return badgeRuleAllows(rule, user)
}

// The hook every screen uses.
export function useFeatureAllowed(featureId: string): boolean {
  const rules = useBadgeAccessStore((s) => s.rules)
  return featureAllowsWith(featureId, effectiveUser(), rules)
}

// Pure: may this person open this SCREEN (a page inside an app)? A page ships for the master alone until he releases
// it, so a screen whose id is not declared above yet, and has no row naming a badge, is the master's — never the
// everyone a control's missing row means. Declared, it answers exactly as featureAllowsWith.
export function screenAllowsWith(
  featureId: string,
  user: { isMaster?: boolean; types?: string[]; role?: string; editionApps?: string[] } | null | undefined,
  rules: Record<string, string[]>,
): boolean {
  if (featureOf(featureId) || rules[featureId]?.length) return featureAllowsWith(featureId, user, rules)
  return user?.isMaster === true
}

// The hook a screen switch uses.
export function useScreenAllowed(featureId: string): boolean {
  const rules = useBadgeAccessStore((s) => s.rules)
  return screenAllowsWith(featureId, effectiveUser(), rules)
}
