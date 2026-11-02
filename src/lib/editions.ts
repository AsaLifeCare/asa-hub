// EDITIONS — the delicate edits an app offers, each with its key and the people who may make it (Settings →…
// The master makes every edition, always; anybody else only while its key is on and they are on its list, and the…

/** Every edition the platform has (app/editions.py CATALOGUE), in the order Settings lists them. */
export const EDITION_IDS = [
  'locations.house', 'locations.staffRemove', 'locations.incidents', 'locations.incidentsNew', 'locations.documents',
  'locations.notesAny',
  'locations.clientsAdd', 'locations.assets', 'clients.profile', 'clients.care', 'clients.family', 'clients.medication',
  'clients.transportation', 'clients.incidents', 'clients.incidentsEdit', 'clients.appointments', 'clients.doctors',
  'staff.profile', 'staff.employment', 'staff.hr', 'staff.compliance', 'staff.hrIssues',
  'staff.documentation', 'staff.driving', 'staff.mais',
  'staff.ist', 'staff.preferences', 'staff.notes', 'staff.notesEdit', 'ssa.profile', 'ssa.notes', 'ssa.documents',
  'ssa.activity', 'family.profile', 'family.notes', 'family.calls', 'family.incidents', 'family.create',
  'family.documents', 'scheduling.calendar', 'scheduling.swaps',
  'scheduling.builder',
  'scheduling.settings', 'scheduling.timeOffApprove', 'transportation.trips', 'transportation.vehicles',
  'transportation.settings',
  'emergencyContacts.directory', 'candidates.information', 'candidates.pipeline', 'candidates.notes',
  'candidates.interviews', 'candidates.documents', 'clientCandidates.information', 'clientCandidates.intake',
  'clientCandidates.pipeline', 'clientCandidates.notes', 'clientCandidates.documents', 'certDocs.review',
  'myCalendar.anyone', 'myInbox.anyone', 'myInbox.directors', 'smartComms.words', 'smartComms.switch',
  'smartComms.audience', 'smartComms.pacing', 'smartComms.ai', 'smartComms.recording', 'smartComms.replies',
  'forms.answers', 'forms.links', 'docs.library', 'support.requests', 'support.settings', 'learning.skills',
  'recon.review', 'recon.settings',
  // not an edit — it OPENS the PSI Log app to the people on its list, by name (app/editions.py "opens")
  'psiLog.clock',
] as const

export type EditionId = (typeof EDITION_IDS)[number]

/** Editions are made by employees (Editions.gs EDITION_ROLES). */
export const EDITION_ROLES = ['admin', 'manager', 'staff']

/** The badges an edition may be opened to, each with every badge above it (app/editions.py open_badges). */
export const EDITION_BADGES = [
  'PLATFORMLEAD', 'DIRECTOR', 'SUPERVISOR', 'ADMINISTRATOR', 'ADMIN', 'ENTITY', 'MANAGER', 'TEAMLEAD', 'HM',
  'INTERVIEWER', 'STAFF',
] as const

/** One edition as Settings draws it: what it lets a person change, its key, its people and the badge it is opened to. */
export type Edition = {
  id: EditionId
  app: string
  appName: string
  label: string
  description: string
  on: boolean
  people: string[]
  /** '' when no badge: only the people */
  badge: string
}

const isEdition = (v: unknown): v is EditionId => (EDITION_IDS as readonly string[]).includes(String(v))

/** The editions a session makes, as the server names them; anything it does not know is dropped. */
export function editionIdsOf(raw: unknown): EditionId[] {
  const list = Array.isArray(raw) ? raw : []
  return EDITION_IDS.filter((id) => list.some((x) => String(x) === id))
}

type RawEdition = { id?: unknown; app?: unknown; app_name?: unknown; label?: unknown; description?: unknown;
  on?: unknown; people?: unknown; badge?: unknown }

const badgeOf = (v: unknown): string => {
  const b = String(v ?? '').trim().toUpperCase()
  return (EDITION_BADGES as readonly string[]).includes(b) ? b : ''
}

/** editionsGet / editionsSet's answer as the screen keeps it: each known edition once, a key on only for true. */
export function editionsFrom(raw: unknown): Edition[] {
  const list = Array.isArray(raw) ? (raw as RawEdition[]) : []
  const out: Edition[] = []
  for (const e of list) {
    if (!e || !isEdition(e.id) || out.some((x) => x.id === e.id)) continue
    const people = Array.isArray(e.people) ? [...new Set(e.people.map((p) => String(p ?? '').trim()).filter(Boolean))] : []
    out.push({ id: e.id, app: String(e.app ?? ''), appName: String(e.app_name ?? ''), label: String(e.label ?? e.id),
      description: String(e.description ?? ''), on: e.on === true, people, badge: badgeOf(e.badge) })
  }
  return out
}

/** Every edition as the save door takes it. */
export const editionsPayload = (list: readonly Edition[]): { id: EditionId; on: boolean; people: string[]; badge: string }[] =>
  list.map((e) => ({ id: e.id, on: e.on, people: [...e.people], badge: e.badge }))

/** The editions grouped by app, in catalogue order. */
export function editionsByApp(list: readonly Edition[]): { app: string; appName: string; editions: Edition[] }[] {
  const out: { app: string; appName: string; editions: Edition[] }[] = []
  for (const e of list) {
    const g = out.find((x) => x.app === e.app)
    if (g) g.editions.push(e)
    else out.push({ app: e.app, appName: e.appName || e.app, editions: [e] })
  }
  return out
}
