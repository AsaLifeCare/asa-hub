// The snapshot contract — shared by the browser, the emitter and the builder.
// Reads used to be one Apps Script execution each, and the web app runs as a single Google account, so twenty…

// Older than this and a slice is not used at all.
export const SNAPSHOT_MAX_AGE_MS = 45 * 60 * 1000

// Resources that may be served as an open file.
export const OPEN_RESOURCES: readonly string[] = ['apps']

// Resources that are NOT snapshotted at all — read live, always.
export const NEVER_SNAPSHOT: readonly string[] = ['careDocs', 'medications', 'marEntries', 'medDeliveries', 'incidents', 'billingClaims',
  // formFiles (2026-09-08): the digest worker writes digest_text — the OCR'd words of whatever a person attached…
  'formFiles',
  // clientFiles (2026-09-09): the client document corpus — 4,500+ files indexed out of the source Drive, with the…
  'clientFiles',
  // Task Board Sheet's cards (2026-08-20).
  'sheetTasks',
  // PER-PERSON STORAGE CANNOT BE MIRRORED (2026-08-08).
  'tasks',
  // A TRAINING DEBT, with a staff phone and email on every row.
  'istRecords', 'istHouses',
  // A CLIENT'S MONEY.
  'financeTransactions', 'financeBalances',
  // TIME RECONCILIATION (tabs time_punches / recon_runs / recon_errors; 2026-08-10).
  'timePunches', 'reconRuns', 'reconErrors',
  // THE CORTEX DOOR (2026-08-18).
  'cortexChat', 'cortexMesh',
  // MARKETING (2026-08-21).
  'marketingIntel',
  // THE TEAM BOARD (2026-08-16) is shared on purpose and could be mirrored — it is held live for the other reason a…
  'teamTasks', 'teamProjects',
  // Operational reminders (2026-08-20) — the same live-board reason: ticking one must read as done the moment…
  'reminders',
  // A watchlist and a food diary — personal, per-person, never mirrored.
  'shopperItems', 'shopperPrices', 'mealProfile', 'mealLog',
  // My week's reminders and events — the same personal law.
  'weekItems',
  // Somebody's practice record.
  'learnAttempts',
  // THE PHARMACY'S REPORTS on House Supplies: clinical rows, narrowed per reader to the houses they manage — a…
  'houseMeds',
  // Time off rows are cut per reader (own, my houses, all) by server/time_off.py's door.
  'timeOff',
  // The certification tracker names every person's certificates and dates: the whole of it is the master's, anyone…
  'certMatrix', 'staffCerts',
  // Every client's medication-administration errors, and every report of a client's medicine running out.
  'marErrors', 'missingMedications',
  // the division's task lists (Directors › task pages, 2026-10-27): behind App Control's directors.tasks control
  'dtBritt', 'dtCassy', 'dtNat', 'dtRegina', 'dtTammy', 'dtTieara', 'dtMonthlyDocReview', 'dtNotes',
  // the house repair book (House Repair › manage pages, 2026-10-27): behind App Control's house-repair.manage control
  'repairRequests', 'repairInventory',
  // the Employee HR Tracker (Staff Issues › Manage issues, 2026-10-27): behind App Control's staffissues.manage control
  'hrTracker', 'screeningNotes', 'credentials',
  // the Voice Bot's support structure (Hotline › bot pages, 2026-10-27): behind hotline.voice-bot
  'vbCategoryKnowledge', 'vbPolicies', 'vbGeneralRules', 'vbSubProcess', 'vbCategoryMap', 'vbFollowUpsMain',
  'vbFollowUpsIncidents', 'vbHomes', 'vbClientNames', 'vbStaffNames', 'vbSchedule',
  // the Missing Medications book (Medications › missing-meds pages, 2026-10-27): behind medications.missing
  'mmFormResponses4', 'mmFormResponses1', 'mmLowRefills', 'mmMedicationControl', 'mmDrsMeds', 'mmDrContacts',
  'mmAbnormalDeliveries']

// Sliced for the people who work the shifts — NEVER for client accounts.
export const EMPLOYEE_ONLY_SLICES: readonly string[] = [
  'isps', 'clients',
  // Review 2026-08-05: the hiring app's audience is 'all', which silently granted CLIENT portal accounts (and the…
  'candidates', 'onboarding', 'phoneScreens',
  // Shifts wave: the roster is the staff's working life — names, houses, days off.
  'shifts', 'shiftCards', 'shiftMatrix', 'shiftTimeline', 'events',
  // The emergency contact list is the management team's personal mobile numbers.
  'contactLists',
  // Fleet & Mileage the app retired 2026-08-17; the resources moved under Transportation, whose manifest has no…
  'fleetVehicles', 'mileageLogs',
  // EVERY REMAINING FILE THAT NAMES A CLIENT.
  'drAppointments', 'uiIncidents', 'potentialClients',
  'mealIdeals', 'sleepProfiles', 'hydrationProfiles', 'workoutPlans',
  // The platform's contact list (2026-09-08): every employee's name, phone and e-mail with per-field provenance.
  'cortexContacts',
  // Behavior Support (2026-09-09): a reading about named people — hours, rhythm, roster strain.
  'behaviorBoard',
  // every house, its clients and who worked there; a client reads their own house through /hub-lanes/houses/mine
  'houses',
]

// Sliced for every EMPLOYEE role, refused to client portals — and nothing else.
export const NO_CLIENT_SLICES: readonly string[] = ['policies']

export type Shelf = 'open' | 'private'

export function shelfFor(resource: string): Shelf {
  return OPEN_RESOURCES.includes(resource) ? 'open' : 'private'
}

/** One resource's slice, as the builder writes it and the browser reads it. */
export type SnapshotSlice<T = unknown> = {
  resource: string
  /** when the builder produced this file (ISO) */
  built_at: string
  /** when the sheet mirror it was built from last synced (ISO) — the REAL age */
  source_at?: string
  rows: T[]
  /** set when the last build failed: the previous file is still being served */
  error?: string
}

export type SliceIndexEntry = {
  shelf: Shelf
  built_at: string
  source_at?: string
  rows: number
  error?: string
  /** roles allowed to read it — the browser checks before asking, not after */
  roles?: string[]
}

export type SnapshotManifest = {
  built_at: string
  slices: Record<string, SliceIndexEntry>
}

// Is this slice young enough to use?
export function sliceIsFresh(slice: { built_at: string; source_at?: string } | null | undefined, now = Date.now()): boolean {
  if (!slice) return false
  const stamp = Date.parse(slice.source_at || slice.built_at)
  if (Number.isNaN(stamp)) return false
  return now - stamp < SNAPSHOT_MAX_AGE_MS
}
