/**
 * Derive the snapshot's slice list from the app registry.
 *
 * The previous attempt at a platform-wide cache was written BY HAND, one
 * screen at a time — which meant every new screen was born without a cache and
 * somebody had to remember. That does not scale and it silently rots.
 *
 * It does not have to be written at all. Every app already declares the
 * resource it reads (`dataSource: { resource: 'people' }`) because that is how
 * its page fetches data — 80-odd apps, all of them, across every registry
 * file. So the list of slices IS the registry, read rather than restated.
 *
 * Emits `snapshot-manifest.json`:
 *   { resources: [{ resource, shelf, apps: [...] }], emitted_at }
 *
 * The Python builder reads it and builds exactly those slices — nothing more
 * (a slice nobody reads is waste) and nothing less (a resource with no slice
 * silently keeps hitting Apps Script).
 *
 * Run:  node tools/emit-snapshot-manifest.mjs [outfile]
 */
import { build } from 'esbuild'
import { readdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const out = resolve(root, process.argv[2] || 'public/snapshot-manifest.json')
const tmp = resolve(root, 'node_modules/.cache/snapshot-registry.mjs')

/**
 * The registry is TypeScript and imports across the whole source tree, so it
 * is bundled first rather than parsed. Parsing would be guessing; bundling
 * asks the same toolchain the app itself is built with.
 */
/**
 * Three registries do NOT live in appManifests: they self-register into the
 * store when imported (App.tsx pulls them in before the shell renders), which
 * is a perfectly good pattern and completely invisible to anything reading the
 * static array. Their apps were real, on screen, and had no slices — the kind
 * of gap that never announces itself, because the fallback works.
 *
 * A tiny entry file re-exports the lot, so the emitter sees what the SHELL
 * sees rather than what one file happens to list.
 */
// every self-registering registry module, or its apps' resources fall off the manifest
const SELF_REGISTERING = ['apps-ops3', 'apps-opsdash', 'apps-potclients',
  'apps-engine', 'apps-finance', 'apps-forms', 'apps-guardian', 'apps-ist',
  'apps-leadership', 'apps-personal', 'apps-houses', 'apps-timeoff']
const entry = resolve(root, 'node_modules/.cache/snapshot-entry.mjs')
writeFileSync(entry,
  `export { appManifests } from ${JSON.stringify(resolve(root, 'src/registry/apps.ts'))}\n` +
  `export { isManifestVisible } from ${JSON.stringify(resolve(root, 'src/lib/audience.ts'))}\n` +
  `export { pageGateReachesRole } from ${JSON.stringify(resolve(root, 'src/lib/pageGate.ts'))}\n` +
  SELF_REGISTERING.map((m, i) =>
    `export * as extra${i} from ${JSON.stringify(resolve(root, 'src/registry/' + m + '.ts'))}`).join('\n') + '\n')

await build({
  entryPoints: [entry],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: tmp,
  logLevel: 'error',
  alias: { '@': resolve(root, 'src') },
  // Vite's own `import.meta.env` does not exist under node, and a module that
  // reads it at load time (the api config store asks whether the seeded dev
  // driver may exist at all) would throw before exporting anything. FALSE is
  // also the truthful answer here: this emitter describes the build that
  // ships, and that build has no dev driver.
  define: { 'import.meta.env.DEV': 'false' },
  // the registry pulls in UI modules on the way; none of them run here
  loader: { '.css': 'empty', '.svg': 'empty', '.png': 'empty', '.jpg': 'empty' },
  external: ['react', 'react-dom', 'react-router', 'framer-motion', 'lucide-react', 'zustand', 'recharts'],
})

/**
 * The registry drags in modules that read browser globals AT IMPORT TIME (a
 * store reading its persisted driver, for one). Nothing here needs them to do
 * anything — only to exist, so the module body can finish and export its data.
 * The alternative is asking every store never to touch a global at load, which
 * is a rule that would be broken within a month by someone who never heard it.
 */
const noStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {}, key: () => null, length: 0 }
globalThis.localStorage ??= noStorage
globalThis.sessionStorage ??= noStorage
globalThis.window ??= globalThis
globalThis.matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {} })

const loaded = await import(pathToFileURL(tmp).href)
/** every AppManifest[] the shell ends up with, whatever route it took to get there */
const appManifests = [
  ...loaded.appManifests,
  ...Object.entries(loaded)
    .filter(([k]) => k.startsWith('extra'))
    .flatMap(([, mod]) => Object.values(mod).filter((v) => Array.isArray(v) && v[0]?.pages)),
].flat()

/** The shelf rule lives with the contract, not here — read, do not restate. */
const contract = readFileSync(resolve(root, 'src/lib/snapshot.ts'), 'utf8')
const listFrom = (name) => {
  // Anchored to the DECLARATION — a prose mention of the const's name in a
  // doc comment above another list must never capture that other list
  // (it did once, and handed the isps slice to the client role).
  const raw = (contract.match(new RegExp(`export const ${name}[^=]*=\\s*\\[([^\\]]*)\\]`)) || [, ''])[1]
  // comments dropped first: a comma or apostrophe in prose would split or open an entry
  const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
  return [...code.matchAll(/['"]([^'"\n]+)['"]/g)].map((m) => m[1].trim()).filter(Boolean)
}
const OPEN = listFrom('OPEN_RESOURCES')
/** Held on the live path on purpose — see NEVER_SNAPSHOT in src/lib/snapshot.ts. */
const LIVE_ONLY = listFrom('NEVER_SNAPSHOT')
/** Sliced for employees only — client/onboarding sessions keep the live path. */
const EMPLOYEE_ONLY = listFrom('EMPLOYEE_ONLY_SLICES')
/** Refused to client portals only — the onboarding seat keeps its access. */
const NO_CLIENT = listFrom('NO_CLIENT_SLICES')

/**
 * Walk everything an app can point at: the page's own source, the focus-scope
 * lookup, and the resources named inside panels (tags editors and the like).
 * A resource reachable from a screen is a resource that screen waits on.
 */
const found = new Map()
const note = (resource, appId) => {
  if (!resource || typeof resource !== 'string') return
  if (!found.has(resource)) found.set(resource, new Set())
  found.get(resource).add(appId)
}

/**
 * WHICH ROLES MAY READ WHICH RESOURCE.
 *
 * Without this a slice is keyed on "is this token real", and that flattens the
 * whole access model: an account allowed to open one app could fetch the file
 * behind every other one. It is the reason clinical resources were held off the
 * snapshot entirely.
 *
 * The answer is not written here — it is ASKED of the same function the shell
 * asks (`isManifestVisible`, lib/audience). A second implementation of a
 * visibility rule is a second implementation that drifts, and the drift shows
 * up as somebody reading what they should not.
 */
const ROLES = ['admin', 'manager', 'staff', 'client', 'director', 'interviewer', 'onboarding']
const rolesFor = new Map()
const noteRole = (resource, role) => {
  if (!rolesFor.has(resource)) rolesFor.set(resource, new Set())
  rolesFor.get(resource).add(role)
}
const walk = (node, appId) => {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) return node.forEach((n) => walk(n, appId))
  if (typeof node.resource === 'string') note(node.resource, appId)
  for (const v of Object.values(node)) walk(v, appId)
}

for (const app of appManifests) walk(app.pages, app.id)

/** Every resource one page reaches — its source, its declared reads, its panels. */
const reachedBy = (page) => {
  const reached = new Set()
  const collect = (node) => {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) return node.forEach(collect)
    if (typeof node.resource === 'string') reached.add(node.resource)
    for (const v of Object.values(node)) collect(v)
  }
  collect(page)
  return reached
}

/**
 * Page gates (PageSchema.gate): a gated page counts only for roles that can pass it, and `gates` tells the
 * relay which apps read a resource only through gated pages (snapshot_service._app_feeds).
 */
const gatedBy = new Map()     // resource -> Map(appId -> Set(gate))
const openBy = new Map()      // resource -> Set(appId) — read by at least one ungated page
for (const app of appManifests) {
  for (const page of app.pages ?? []) {
    for (const resource of reachedBy(page)) {
      if (page.gate) {
        if (!gatedBy.has(resource)) gatedBy.set(resource, new Map())
        const byApp = gatedBy.get(resource)
        if (!byApp.has(app.id)) byApp.set(app.id, new Set())
        byApp.get(app.id).add(page.gate)
      } else {
        if (!openBy.has(resource)) openBy.set(resource, new Set())
        openBy.get(resource).add(app.id)
      }
    }
  }
}
// always an object: the key's presence tells the relay this manifest knows page gates
const gatesOf = (resource) => {
  const out = {}
  for (const [appId, gates] of gatedBy.get(resource) ?? []) {
    if (!(openBy.get(resource) ?? new Set()).has(appId)) out[appId] = [...gates].sort()
  }
  return out
}

for (const role of ROLES) {
  for (const app of appManifests) {
    if (!loaded.isManifestVisible(app, { focus: null, role })) continue
    for (const page of app.pages ?? []) {
      if (page.gate && !loaded.pageGateReachesRole(page.gate, role)) continue
      for (const resource of reachedBy(page)) noteRole(resource, role)
    }
  }
}

// Employee-only slices: the app may be visible to a client, but the FILE is
// not — a client fetching one flat file would read every client's plan. The
// slice is refused (403) and that session reads live, as restricted as ever.
for (const resource of EMPLOYEE_ONLY) {
  const roles = rolesFor.get(resource)
  if (roles) { roles.delete('client'); roles.delete('onboarding') }
}
// The lighter lock: internal procedure is not client-portal reading, but a
// trainee has every reason to open it.
for (const resource of NO_CLIENT) {
  const roles = rolesFor.get(resource)
  if (roles) roles.delete('client')
}

/**
 * Where each resource's rows actually live, read from the same GAS table the
 * backend routes on. Two answers, and the difference decides how a slice is
 * built:
 *
 *   sheet   — a plain tab. The Postgres mirror already holds it, so the slice
 *             is built without asking Google anything at all.
 *   adapter — the rows are SHAPED by server code (the talent pipeline joins
 *             four tabs and derives a stage). Rebuilding that shape in Python
 *             would be a second implementation of the same rules, and the two
 *             would drift. The builder asks the backend once per rebuild
 *             instead — one execution every few minutes rather than one per
 *             person per screen.
 */
const gas = readFileSync(resolve(root, 'apps-script/Main.gs'), 'utf8')
const block = gas.slice(gas.indexOf('var RESOURCES = {'))
const tabs = {}
for (const m of block.slice(0, block.indexOf('\n};')).matchAll(/^\s*([A-Za-z0-9_]+):\s*\{\s*sheet:\s*'([^']+)'/gm)) {
  tabs[m[1]] = m[2]
}
// candidates is declared in RESOURCES for discovery but every read is
// intercepted by the talent adapter — the tab is empty and always was.
// The four estate data apps are likewise intercepted (Estate.gs): their rows
// live in the estate's own spreadsheets, so the slice must ask the backend.
const ADAPTER_ONLY = new Set([
  // people: the raw tab has no merge lens and no clients guard; the backend's list is the folded truth
  'people',
  'candidates',
  // talentPool: no tab of that name; talentPoolRoute_ joins the roster to its scores
  'talentPool',
  // recruitment: the tab DOES exist (recruitment_contracts) and that is
  // exactly why this line matters. Sheet mode would serve the raw tab — and
  // the raw tab carries `fields_json`, every answer typed into the
  // application form. recruitmentRoute_ (Recruitment.gs) serves the envelope
  // WITHOUT the answers, and only adapter mode asks it.
  'recruitment',
  // hiringCadences: no tab of that name exists at all — it is the config cells
  // crossed with the ask book, and the cross is the point (what the machines
  // are running on versus what somebody typed).
  'hiringCadences',
  // callOffs is not here: its data house is served by the generic sheet lane
  'drAppointments', 'workOrders', 'uiIncidents',
  // houseInventory: the repairs workbook's second tab, estate-intercepted like its siblings
  'houseInventory',
  // DERIVED resources: the tab (when it exists at all) is not the truth —
  // the backend composes the rows at read time (Clients.gs from the ISPs;
  // Certs.gs from the estate's employee database). A sheet-mode slice would
  // serve the empty tab as "fresh" and hide the real answer.
  'clients', 'certMatrix', 'staffCerts',
  'mealIdeals', 'workoutPlans', 'sleepProfiles', 'hydrationProfiles',
])

// DERIVED: shaped in Python by the snapshot service; their Hub tabs are empty, so sheet mode would serve emptiness as fresh.
// `events` must stay out: only sheet mode re-reads the tab the Schedule's own write rebuilds.
const DERIVED = new Set(['commRoutes', 'resumeCoverage', 'shifts', 'shiftCards', 'shiftMatrix', 'shiftTimeline', 'invoices', 'finances', 'financeSummary', 'techDocs', 'techProjects', 'techEngineering', 'hiringAnalysis',
  // houses: read from the master JSON (server/house_slices.py); today's shift
  // counts come from the `shifts` slice on the page.
  'houses',
  // staffIssues: the live HR tracker ('Employee HR Tracker' sheet) from
  // the old platform's curated mirror, server/hr_slices.py — read-only; the estate's
  // sheet is the writer.
  'staffIssues',
  // medCorrelation: the Med Errors (MARS) × Missing Meds study, derived
  // from the mar_errors and missing_medications rows handed to it in memory
  // (both sources are held live: no file)
  // (server/medcorr_slices.py, the hiringAnalysis precedent — built late,
  // after the gather) — read-only; Apps Script owns
  // every write to both Hub tabs.
  'medCorrelation',
  // alertsTriage + workforceForecast: the Command Deck's two tiles — the
  // unacked-alert aggregate (counts only, PII-free) and the latest cached
  // workforce analysis/insights payloads, server/alert_slices.py.
  'alertsTriage', 'workforceForecast',
  // cortexContacts: the platform's merged people (ops.employees) exactly as
  // the relay hands them to Apps Script every hour (server/contacts_slices.py
  // → peopleSyncFromPlatform, ContactsSync.gs) — read-only here; the People
  // house is written by Apps Script alone.
  'cortexContacts',
  // behaviorBoard: how each person uses the platform, measured from the LOGS
  // mirror (server/behavior_slices.py). The board is arithmetic and verdicts
  // only — the paragraph a model wrote lives in the behaviour house and is
  // read through behaviorReadings, never served as a flat file.
  'behaviorBoard',
  // the Calendar Builder's seven (server/calendar_builder_slices.py); the grid is read positionally,
  // since the header-keyed mirror folds 28 day-columns into 7 weekday keys
  'calendarGrid', 'calendarShifts', 'calendarConflicts', 'calendarHours',
  'calendarRequests', 'calendarStaff', 'calendarHouses',
  // commAttendance: PsiAnywhere's punch record and the LIVING call-off
  // tracker, one row per person, with which of the two books knew them at all
  // as the first field (server/attendance_slices.py → the sibling project's
  // app/analytics/comm_attendance.py). Both sources are Postgres tables and
  // the whole reading is 197 rows, so there is no Hub tab behind it and none
  // is wanted: a house would be a third, ageing copy of a frozen record.
  // Read-only and write-nothing — it creates no alias and merges no person.
  'commAttendance',
  // commPunchBoard: who clocked in on PsiAnywhere and who did not — every
  // houred roster shift of yesterday and today with its verdict, beside the
  // clock's own state. The attendance lane writes it to the relay's own disk
  // first (/srv/snapshot/.psi-punch-board.json, server/psi_attendance.py) and
  // server/punch_board_slices.py projects it through an allow-list. There is
  // no Hub tab behind it and none is wanted: JSON first, and nothing writes it
  // but the lane.
  'commPunchBoard',
  // recruitBook: relay-written JSON (server/recruit_book.py), projected through an allow-list
  'recruitBook',
  // commCalls + commWorkItems: the sealed phone-call lane's CLEAR half — one
  // row per call, one per matter, from the mirror of the two houses the feed
  // lands (server/comm_calls_slices.py). The words stay under the lane's
  // seal; what travels is the type, the closed category, the urgency and who
  // the NUMBER established. Read-only — the houses are written by the
  // commCallsIngest door alone.
  'commCalls', 'commWorkItems',
  // rosterProfile + coverageSuggestions: one row per person on the roster,
  // and one row per shift that needs somebody with the people who could take
  // it (server/coverage_slices.py → the sibling project's
  // app/analytics/roster_profile.py). Derived from this builder's OWN slices —
  // calendarGrid, calendarStaff, calendarRequests, callOffs, behaviorBoard,
  // commRoutes, commAttendance — so they are built LATE, after the pass that
  // writes those files, on the hiringAnalysis precedent. Read-only: they
  // propose a name into an empty cell and assign nobody; the draft door and
  // the fail-closed publish already own every write to the workbook.
  'rosterProfile', 'coverageSuggestions'])

/**
 * WHO ACTUALLY SERVES AN ADAPTER RESOURCE — read from the router, not assumed.
 *
 * `adapter` was the FALLBACK of this classifier: anything with no tab, not
 * derived and not explicitly live became "adapter" by omission, and the relay
 * then asked the backend for it forever. Four page dataSource names — screens
 * whose rows actually come from ACTIONS — were nothing anybody routes, so the
 * builder spent an execution on each of them, every cycle, to be told no.
 *
 * A resource is an adapter only if `route()` names it or the estate lists it.
 * Anything else is held on the live path, which is what it already was in
 * practice — the difference is that the relay stops asking.
 */
const gsAll = readdirSync(resolve(root, 'apps-script'))
  .filter((f) => f.endsWith('.gs'))
  .map((f) => readFileSync(resolve(root, 'apps-script', f), 'utf8'))
  .join('\n')
const ADAPTERS = new Set([
  // `if (resource === 'x') return xRoute_(…)` — the router's own branches
  ...[...gsAll.matchAll(/resource === '(\w+)'/g)].map((m) => m[1]),
  // ESTATE_SOURCES keys — the read-only estate mirrors
  ...[...(gsAll.match(/ESTATE_SOURCES\s*=\s*\{([\s\S]*?)\n\}/)?.[1] ?? '')
      .matchAll(/^\s*(\w+)\s*:/gm)].map((m) => m[1]),
])

const unserved = []
const modeOf = (resource) => {
  if (LIVE_ONLY.includes(resource)) return 'live'
  if (DERIVED.has(resource)) return 'derived'
  if (tabs[resource] && !ADAPTER_ONLY.has(resource)) return 'sheet'
  if (ADAPTERS.has(resource)) return 'adapter'
  // no tab, no adapter, nothing derived: the page reads it some other way
  unserved.push(resource)
  return 'live'
}

/**
 * WHY A RESOURCE IS ON THE LIVE PATH, WRITTEN DOWN — the two reasons are not
 * one reason, and `mode: 'live'` alone cannot tell them apart.
 *
 *   by-design  NEVER_SNAPSHOT put it there. Per-person rows, clinical records,
 *              a board that must read as it was dropped. It will never be a
 *              slice, and asking again is asking a settled question.
 *   unrouted   nothing routes it YET: no tab, no route branch, no derivation.
 *              A route published tomorrow turns it back into a slice, and the
 *              next build reclassifies it with nobody remembering to.
 *
 * Held identically, a gap that can heal looks exactly like a refusal that
 * never will — which is the difference between a lane somebody goes and fixes
 * and a lane that is quietly gone for six months. The reader (load_manifest in
 * server/snapshot_service.py) drops both, spends no execution on either, and
 * now says which is which instead of going silent about all of them.
 */
const heldFor = (resource, mode) =>
  (mode !== 'live' ? undefined : LIVE_ONLY.includes(resource) ? 'by-design' : 'unrouted')

const resources = [...found.entries()]
  .map(([resource, apps]) => {
    const mode = modeOf(resource)
    return {
      resource,
      shelf: OPEN.includes(resource) ? 'open' : 'private',
      mode,
      held: heldFor(resource, mode),
      // The sheet rides whenever a tab owns the name, derived mode included —
      // the fingerprint-poison guard in the relay maps tab → resource through
      // this field, and a derived entry without it was unnameable there
      // (measured: commCalls/commWorkItems carried 0 rows beside a rev
      // vouching 871 and the guard could not see them).
      sheet: tabs[resource] ?? undefined,
      apps: [...apps].sort(),
      roles: [...(rolesFor.get(resource) ?? [])].sort(),
      gates: gatesOf(resource),
    }
  })
  .sort((a, b) => a.resource.localeCompare(b.resource))

// SLICE-ONLY RESOURCES: raw Hub tabs, absent from Main.gs RESOURCES (the live router has no per-role
// ACL); roles are explicit so PII never inherits an audience.
for (const extra of [
  // admin+manager only: full call transcripts and every screening answer
  { resource: 'phoneScreens', sheet: 'entity_phone_screens' },
]) {
  resources.push({
    // ADMIN AND MANAGER, and it stays that way: phone screens are used by
    // other apps and they are used in HIRING. A rule about the COMMS app was
    // once applied to this tab and narrowed it to admin for a few minutes;
    // a recruiter working the hiring board reads these rows, and taking them
    // away would have broken the app that exists to use them.
    resource: extra.resource, shelf: 'private', mode: 'sheet', sheet: extra.sheet,
    apps: ['hiring'], roles: ['admin', 'manager'],
  })
}

// HELPFUL CONTACTS: no page declares it, so it is listed here; roles mirror suggestionsList's audience.
// COMM ROUTES: which phone or e-mail the cortex holds for a
// person, and the hours their own shifts say they are awake. Derived in
// Python because Apps Script cannot read Postgres and the graph lives there.
// Two filters, and the second is the one nobody would think of: only
// `contact` and `schedule_entry` fact types cross, AND any fact whose source
// is marked synthetic is dropped — 533 of 2,235 contact facts were injected
// to teach the graph, and a synthetic phone number looks exactly like a real
// one. Roles are the HR crowd: a person's contact points are not a fact a DSP
// or a client has business reading.
resources.push({
  resource: 'commRoutes', shelf: 'private', mode: 'derived',
  sheet: '', apps: ['people', 'smartcomms'],
  roles: ['admin', 'director', 'manager'],
})

// COMM WORK ITEMS: what each call was ABOUT — one row per matter, from the
// mirror of the house the feed lands (server/comm_calls_slices.py). The
// Hotline screen reads it beside commCalls, but a page declares only one
// dataSource, so the discovery pass never sees this name — pushed explicitly,
// the same reason commRoutes is above. The words stay under the lane's
// seal; roles are the smartcomms audience the screen already gates.
resources.push({
  resource: 'commWorkItems', shelf: 'private', mode: 'derived',
  sheet: 'comm_work_items', apps: ['smartcomms'],
  roles: ['admin', 'director', 'manager', 'staff'],
})

// COMM WHEN MOMENTS: the week of windows behind the When page — one row per
// person AND shift, where `commWhen` is one row per person. The same module
// builds both (server/comm_when_slices.py) and the relay's dispatch already
// answers for both, but the page declares one dataSource and asks for the
// second by name, so the discovery pass never saw it — the same gap
// commWorkItems is pushed for, two resources above.
//
// WHAT THE GAP COST, measured before this line existed: the computation
// answered 347 rows on demand while the file on the relay's disk was FIVE
// DAYS old and absent from the slice index, so nothing ever rebuilt it. The
// page drew a five-day-old week, and the only warning was the amber "Serving
// last snapshot" chip — which, with a resource nobody declares, stops being
// an exception and becomes the resting state of every screen on the platform.
resources.push({
  resource: 'commWhenMoments', shelf: 'private', mode: 'derived',
  sheet: '', apps: ['smartcomms'],
  roles: ['admin', 'director', 'manager', 'staff'],
})

// RESUME COVERAGE: who has a CV on file, so a screen can mark
// the ACTIVE people who do not. Derived in Python from the mirror
// (server/resume_slices.py) because the answer is a union of three stores and
// no tab holds it. It says who HAS one on purpose — a screen badges on
// absence, so a failed read draws nothing rather than accusing everybody.
// Roles are the HR crowd: a gap in somebody's personnel file is not a fact a
// DSP or a client has any business reading.
resources.push({
  resource: 'resumeCoverage', shelf: 'private', mode: 'derived',
  sheet: '', apps: ['people', 'staff-performance', 'behavior'],
  roles: ['admin', 'director', 'manager'],
})

resources.push({
  resource: 'helpfulContacts', shelf: 'private', mode: 'sheet',
  sheet: 'helpful_contacts', apps: ['suggestions'],
  roles: ['admin', 'client', 'director', 'interviewer', 'manager', 'onboarding', 'staff'],
})

// MED DELEGATION RAW: the meddel_flows tab for the first paint; roles are the medDelFlows action's own.
resources.push({
  resource: 'medDelFlowsRaw', shelf: 'private', mode: 'sheet',
  sheet: 'meddel_flows', apps: ['med-delegation'], roles: ['admin', 'manager'],
})

// MAR ERRORS + MISSING MEDICATIONS: the Med Correlation study's inputs (server/medcorr_slices.py);
// no page declares them, and clinical rows go to admin, director and manager only.
// The mode is modeOf's: both are NEVER_SNAPSHOT, so they are held live and no file is built.
for (const extra of [
  { resource: 'marErrors', sheet: 'mar_errors' },
  { resource: 'missingMedications', sheet: 'missing_medications' },
]) {
  const mode = modeOf(extra.resource)
  resources.push({
    resource: extra.resource, shelf: 'private', mode, held: heldFor(extra.resource, mode), sheet: extra.sheet,
    apps: ['medications'], roles: ['admin', 'director', 'manager'],
  })
}

// STAFF PERFORMANCE BOARD: Python builds it at every read off the copy (app/performance.py), so it is never a slice;
// it stays on the live path by design because the writes' invalidations still name it.
resources.push({
  resource: 'staffPerfBoard', shelf: 'private', mode: 'live', held: 'by-design',
  apps: ['employee-tracker'], roles: ['admin', 'manager'],
})

// STAFF REQUESTS: the StaffRequests house tab, sliced like meddel_flows (an override of the discovered
// entry); roles are requestsList's own, the rows carry phone numbers.

const staffRequestsEntry = resources.find((r) => r.resource === 'staffRequests')
if (staffRequestsEntry) {
  staffRequestsEntry.mode = 'sheet'
  staffRequestsEntry.sheet = 'staff_requests'
  staffRequestsEntry.roles = ['admin', 'manager']
  staffRequestsEntry.held = undefined   // no longer held: the override routes it
  const heldAt = unserved.indexOf('staffRequests')
  if (heldAt !== -1) unserved.splice(heldAt, 1)   // routed now — the report stays honest
}

// INVOICES: admin+manager ONLY, narrowed here on purpose. The audience rule
// (isManifestVisible) opens every employee app to staff and directors since
// the role gate was retired, so the derived role set for `invoices` came out
// four wide — but the rows are the company's purchase map straight off
// the old platform's admin-namespaced endpoint (/v1/admin/invoices/catalog), and the app's
// own registry audience says ['admin', 'manager']. Money does not inherit an
// audience by accident, so this slice is refused to staff and directors even
// while the badge matrix still decides which SCREENS they see.
const invoicesEntry = resources.find((r) => r.resource === 'invoices')
if (invoicesEntry) invoicesEntry.roles = ['admin', 'manager']

// FINANCES: admin+manager ONLY, for the same reason as invoices — the rows
// are the company's finance doc-hub (vendor · date · amount per document,
// straight off the old platform's admin-namespaced /v1/admin/finances endpoints), and
// the app's own registry audience says ['admin', 'manager']. Money does not
// inherit an audience by accident.
const financesEntry = resources.find((r) => r.resource === 'finances')
if (financesEntry) financesEntry.roles = ['admin', 'manager']

// FINANCE SUMMARY: admin+manager ONLY, same rule as finances — the row is the
// company's payroll/KPI overview straight off the old platform's admin-namespaced
// /v1/admin/finances/payroll computation (cached in asa_finance_summary).
const financeSummaryEntry = resources.find((r) => r.resource === 'financeSummary')
if (financeSummaryEntry) financeSummaryEntry.roles = ['admin', 'manager']

// TECHNOLOGY: admin+manager only, as the app's own audience says; the platform's internals.
for (const name of ['techDocs', 'techProjects', 'techEngineering']) {
  const entry = resources.find((r) => r.resource === name)
  if (entry) entry.roles = ['admin', 'manager']
}

// THE CROSSED ANALYSIS IS NARROWER THAN THE PAGE THAT DRAWS IT. It inherits
// the Talent Pipeline app's slice roles — admin, director, manager, staff —
// and that is too wide for what it now carries: the names, phones and
// addresses of people who never finished applying, plus every document the
// whole board still owes. The hiring team, same as the book it reads.
{
  const entry = resources.find((r) => r.resource === 'hiringAnalysis')
  if (entry) entry.roles = ['admin', 'manager']
}

// candidate data: the same two roles as the analysis above
{
  const entry = resources.find((r) => r.resource === 'recruitBook')
  if (entry) entry.roles = ['admin', 'manager']
}

// ALERTS TRIAGE + WORKFORCE FORECAST: admin+manager ONLY, same rule as
// invoices. The triage rows are PII-free counts, but the forecast's
// flight_risk payload NAMES staff alongside a retention-risk score and its
// drivers — a reading about a person, taken off the old platform's admin-gated
// /v1/alerts/triage and the workforce recompute's cache. The Leadership
// app's own registry audience says ['admin', 'manager']; the audience rule
// opens it to staff and directors since the role gate was retired, so the
// narrowing has to be said here. A name on a risk list does not inherit an
// audience by accident.
for (const name of ['alertsTriage', 'workforceForecast']) {
  const entry = resources.find((r) => r.resource === name)
  if (entry) entry.roles = ['admin', 'manager']
}

// MED CORRELATION: admin+manager+director ONLY. The study is clinical data —
// med errors and missing meds tied to resident initials and controlled
// substances, the port of the old platform's admin-namespaced
// /v1/admin/med-correlation over the Hub's own care-book slices — and the
// Medications app's own audience is four wide (admin, manager, staff,
// client), so the derived role set came out wider than any chart
// reading may go. The audience rule opens employee apps to staff and
// directors since the role gate was retired; the director seat is the
// clinical oversight one, so it stays. Clinical data does not inherit an
// audience by accident.
{
  const entry = resources.find((r) => r.resource === 'medCorrelation')
  if (entry) entry.roles = ['admin', 'director', 'manager']
}

// The resolver's own traffic. Written by the snapshot service itself
// (_traffic_write_slice) rather than read from a tab, so it has no `sheet`
// and no backend call behind it — which is why `mode` is 'derived'.
//
// It is here so `exec_share` — the one number that says how much of a
// person's work still costs a Google execution — can be READ. It lived only
// in the service's own /health, which nginx does not route and no screen can
// reach; a number nobody can see is a number nobody tracks. Listing it here
// means the existing slice gate serves it, admin-only, with no new endpoint.
resources.push({
  resource: 'resolverHealth', shelf: 'private', mode: 'derived',
  apps: ['settings'], roles: ['admin'],
})

// THE PLATFORM'S CONTACT LIST (server/contacts_slices.py): no page declares it; admin only,
// the rows are every employee's name, phone and e-mail.
resources.push({
  resource: 'cortexContacts', shelf: 'private', mode: 'derived',
  apps: ['users', 'settings'], roles: ['admin'],
})

// THE COVERAGE SUGGESTIONS: THE SCHEDULING DESK, AND NOT THE WHOLE BUILDING.
//
// The audience rule derives a slice's roles from the app's, and since the role
// gate was retired that opens an employee app to staff and directors — which
// came out as four roles here, measured on this build. The Calendar Builder's
// own audience is admin and manager, and this file is one static document
// nginx serves to whoever holds a session: it names colleagues, ranks them for
// a shift, and carries the cautions beside each name. A caregiver reading a
// list of who else could have taken their shift is not a feature anybody asked
// for. Narrowed here, the way behaviorBoard is, rather than inherited.
{
  const entry = resources.find((r) => r.resource === 'coverageSuggestions')
  if (entry) entry.roles = ['admin', 'manager']
}

// THE ROSTER PROFILE: ADMIN ONLY, and for behaviorBoard's exact reason.
//
// No page declares it — the Calendar Builder's Smart Comms screen reads it
// beside `coverageSuggestions`, which the page schema does declare — so it is
// listed here rather than discovered from a dataSource. The narrowing is the
// point: one row per person saying how much they work, what they said about
// their own week, what is expired against their name and which books have ever
// recorded an absence. That is a reading about NAMED PEOPLE, and the file is
// one static document nginx serves to whoever holds a session. A House Manager
// reaches the SUGGESTIONS, which are about shifts; the dossier is not something
// a screen's audience should inherit by accident.
resources.push({
  resource: 'rosterProfile', shelf: 'private', mode: 'derived',
  apps: ['calendarbuilder'], roles: ['admin'],
})

// BEHAVIOR SUPPORT: admin only, and apps pinned to `behavior`: the file reads about named people,
// and one app with no badge row in the derived apps line would open it to everybody.
{
  const entry = resources.find((r) => r.resource === 'behaviorBoard')
  if (entry) {
    entry.roles = ['admin']
    entry.apps = ['behavior']
  }
}

// THE ENVELOPE BOOK: read only by hiringAnalysis (server/hiring_slices.py), so listed here;
// hiring team only.
resources.push({
  resource: 'recruitment', shelf: 'private', mode: 'adapter',
  apps: ['hiring'], roles: ['admin', 'manager'],
})

// THE ASKING RHYTHM: the config cells joined to the ask book, not a mirror of a tab.
resources.push({
  resource: 'hiringCadences', shelf: 'private', mode: 'adapter',
  apps: ['hiring'], roles: ['admin', 'manager'],
})

resources.sort((a, b) => a.resource.localeCompare(b.resource))

writeFileSync(out, JSON.stringify({ emitted_at: new Date().toISOString(), resources }, null, 2) + '\n')
try { unlinkSync(tmp); unlinkSync(entry) } catch { /* cache dir may be cleaned already */ }

/**
 * WHAT THE SCREENS ASK FOR AS A FLAT FILE.
 *
 * A page calling `readSlice('x')` has already decided that `x` arrives as a
 * slice. If the manifest holds `x` on the live path — or never names it at all
 * — that call cannot be answered by anybody: no lane writes the file, the
 * reader falls back or draws nothing, and every count in this build still adds
 * up. Nothing asks; nothing is refused; nothing is said. That is the exact
 * shape a lane goes missing in, so it is read out of the source and named.
 *
 * Literal names, plus one hop through a const in the same file (the pages that
 * keep the spelling in one place). An argument that is a parameter belongs to a
 * generic helper and names no resource, so it is skipped rather than guessed.
 *
 * It WARNS and never fails the build: the answer is a lane to go and build,
 * not a typo to fix, and a gate that fails on the day it lands is a gate
 * somebody deletes on the day after.
 */
const sliceReaders = new Map()
const scanForSliceReads = (dir) => {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const path = resolve(dir, ent.name)
    if (ent.isDirectory()) { scanForSliceReads(path); continue }
    if (!/\.tsx?$/.test(ent.name)) continue
    const text = readFileSync(path, 'utf8')
    const consts = new Map([...text.matchAll(/const\s+([A-Za-z_$][\w$]*)\s*=\s*'([A-Za-z0-9_]+)'/g)]
      .map((m) => [m[1], m[2]]))
    for (const m of text.matchAll(/readSlice\s*(?:<[^>]*>)?\(\s*(?:'([A-Za-z0-9_]+)'|([A-Za-z_$][\w$]*))/g)) {
      const name = m[1] || consts.get(m[2])
      if (!name) continue
      if (!sliceReaders.has(name)) sliceReaders.set(name, new Set())
      sliceReaders.get(name).add(path.slice(root.length + 1))
    }
  }
}
try { scanForSliceReads(resolve(root, 'src')) } catch { /* no source tree, nothing to read */ }

const sliced = new Set(resources.filter((r) => r.mode !== 'live').map((r) => r.resource))
const heldNames = new Map(resources.map((r) => [r.resource, r.held]))
const unanswered = [...sliceReaders.keys()].filter((n) => !sliced.has(n)).sort()

if (unserved.length) {
  console.log(`  held live because NOTHING routes them (${unserved.length}): ${unserved.sort().join(', ')}`)
  console.log('  no tab, no route branch, no derivation — and NOT an execution a cycle: the builder')
  console.log('  never asks for a live resource at all (load_manifest, server/snapshot_service.py,')
  console.log('  drops every one as it reads this file). What they cost is the fast path — which is')
  console.log('  right for a screen that reads through its own action, and wrong for one that waits')
  console.log('  on a file. They are marked `held: "unrouted"`, apart from the by-design refusals,')
  console.log('  because a route published later makes a slice of one of these and the next build')
  console.log('  will say so; a gap that can heal must not be filed beside one that never will.')
}

if (unanswered.length) {
  console.log(`  ASKED FOR AS A SLICE AND NEVER BUILT (${unanswered.length}):`)
  for (const name of unanswered) {
    const why = heldNames.has(name)
      ? `held live (${heldNames.get(name) || 'reason not marked'})`
      : 'not in the manifest at all — no page declares it'
    console.log(`    ${name} — ${why}; read by ${[...sliceReaders.get(name)].sort().join(', ')}`)
  }
  console.log('  each of these screens calls readSlice() and no lane writes the file, so the read')
  console.log('  cannot be answered by anybody. Said here rather than discovered on the screen.')
}

const count = (m) => resources.filter((r) => r.mode === m).length
// "on purpose" is only half of the live path, and the half that is not on
// purpose is the half worth reading — so the line counts them apart.
const byDesign = resources.filter((r) => r.held === 'by-design').length
console.log(`snapshot manifest: ${resources.length} resources from ${appManifests.length} apps → ` +
            `${count('sheet')} from the mirror, ${count('adapter')} via the backend, ` +
            `${count('live')} on the live path (${byDesign} by design, ` +
            `${count('live') - byDesign} because nothing routes them) ` +
            `→ ${out.replace(root + '/', '')}`)
