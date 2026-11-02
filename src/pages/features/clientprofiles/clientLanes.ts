// CLIENTS FROM THE JSON AND THE SLICES — what a Clients section can compute from the slice shelf alone, shaped…
// Pure: the page and the tests import the same code.
import { houseCodeOf, incidentsFor } from '@/pages/features/locations/locationLanes'
import { clientLive, nameKey } from './clientModel'

type Rec = Record<string, unknown>
const rec = (v: unknown): Rec => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : {})
/** locationsText_: whitespace folded. */
const text = (v: unknown): string => (v == null ? '' : String(v).replace(/\s+/g, ' ').trim())

/* ---------- the last guard (cpScrub_) ---------- */

const SCRUB_KEYS = new Set(['id', 'file_id', 'isp_file_id', 'receipt_file_id', 'drive_id', 'person_id', 'ssa_person_id', 'witness'])

/** cpScrub_: a bare 9-digit or 13-19-digit run and an SSN shape never leave; ids are left alone. */
export function scrubAnswer<T>(v: T, key = ''): T {
  if (key && SCRUB_KEYS.has(key)) return v
  if (typeof v === 'string') {
    return v.replace(/(^|\D)\d{3}-\d{2}-\d{4}(?=\D|$)/g, '$1[withheld]')
      .replace(/(^|\D)(\d{9}|\d{13,19})(?=\D|$)/g, '$1[withheld]') as T
  }
  if (typeof v === 'number') {
    const len = String(Math.abs(Math.round(v))).length
    return ((len === 9 || (len >= 13 && len <= 19)) && Math.round(v) === v ? null : v) as T
  }
  if (Array.isArray(v)) return v.map((x) => scrubAnswer(x)) as T
  if (v && typeof v === 'object') {
    const out: Rec = {}
    for (const k of Object.keys(v as Rec)) out[k] = scrubAnswer((v as Rec)[k], k)
    return out as T
  }
  return v
}

/* ---------- who a client is ---------- */

/** A client as the Clients lanes may hold one from the clients slice: identity and home only — nothing clinical. */
export type ClientIdentityRow = {
  client_key: string
  client_id: string
  name: string
  status: string
  house: string
  avatar: string
  isp_year: string
}

// A clients slice row narrowed to identity; a row with no client_key answers to its folded name.
export function clientIdentityRow(row: unknown): ClientIdentityRow {
  const r = rec(row)
  const name = text(r.name)
  return {
    client_key: String(r.client_key || '').trim() || nameKey(name),
    client_id: String(r.id || r.client_id || ''),
    name,
    status: String(r.status || ''),
    house: text(r.house || r.houseName),
    avatar: String(r.avatar || ''),
    isp_year: text(r.isp_year),
  }
}

/** clientPhotoIndex_: an avatar photo only when exactly one visible avatar carries the full name. */
export function photoIndex(photos: unknown[]): Record<string, string> {
  const count: Record<string, number> = {}
  const src: Record<string, string> = {}
  for (const raw of photos) {
    const p = rec(raw)
    if (String(p.kind ?? '') !== 'avatar') continue
    if (String(p.hidden ?? '').toLowerCase() === 'true') continue
    const k = nameKey(p.title)
    if (!k || !String(p.src ?? '')) continue
    count[k] = (count[k] ?? 0) + 1
    src[k] = String(p.src)
  }
  const out: Record<string, string> = {}
  for (const k of Object.keys(src)) if (count[k] === 1) out[k] = src[k]
  return out
}

/* ---------- the roster (clientProfileRoster, current clients) ---------- */

/** cpRosterBuild_(false): identity only, the current clients once each, by name — the action's own answer. */
export function rosterFrom(rows: unknown[], photos: unknown[] = []) {
  const faces = photoIndex(photos)
  const seen = new Set<string>()
  const clients = rows.map(clientIdentityRow).map((c) => ({
    client_key: c.client_key, client_id: c.client_id, name: c.name, status: clientLive(c) ? 'active' : 'inactive',
    house: c.house, avatar: c.avatar || faces[nameKey(c.name)] || '', isp_year: c.isp_year,
  })).filter((r) => {
    if (!r.client_key || seen.has(r.client_key)) return false
    seen.add(r.client_key)
    return r.status === 'active'
  })
  clients.sort((a, b) => a.name.localeCompare(b.name))
  return scrubAnswer({ clients, inactive_why: '', degraded: false })
}

/* ---------- Incidents (clientProfileIncidents) ---------- */

export const INCIDENT_REVIEW_STATUSES = ['Reported', 'Under review', 'Closed'] as const

/** apptDay_: a day as yyyy-MM-dd from an ISO stamp, M/D/YYYY or anything Date reads; '' otherwise. */
export function apptDay(v: unknown): string {
  const s = String(v ?? '').trim()
  const iso = /^(\d{4}-\d{2}-\d{2})(?:[T\s]|$)/.exec(s)
  if (iso) return iso[1]
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s)
  if (us) return `${us[3]}-${`0${us[1]}`.slice(-2)}-${`0${us[2]}`.slice(-2)}`
  const t = Date.parse(s)
  if (t) {
    const d = new Date(t)
    return `${d.getFullYear()}-${`0${d.getMonth() + 1}`.slice(-2)}-${`0${d.getDate()}`.slice(-2)}`
  }
  return ''
}

/** cpDay_ over text: '' for a blank cell. */
const cpDay = (v: unknown): string => (String(v ?? '').trim() ? apptDay(v) : '')

/** cpList_: a cell split on commas, semicolons and lines. */
const listOf = (v: unknown): string[] => String(v ?? '').split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean)

/** locationsCode_: the trailing house code of a label ("CAN - 47TH - ABD4708" → ABD4708). */
function trailingCode(v: unknown): string {
  const m = /([A-Z]{2,4}\d{3,6})\s*$/.exec(String(v ?? '').trim().toUpperCase())
  return m ? m[1] : ''
}

export type Review = { status?: unknown; by?: unknown; at?: unknown }

// cpIncidentsBuild_: the client's UI/MUI reports from the uiIncidents rows (the Locations join), with their review…
export function incidentsFrom(rows: unknown[], client: Pick<ClientIdentityRow, 'client_key' | 'name' | 'house'>,
  reviews: Record<string, Review>) {
  const code = houseCodeOf(client.house) || trailingCode(client.house)
  const cats = new Set<string>()
  const statuses: readonly string[] = INCIDENT_REVIEW_STATUSES
  const out = incidentsFor(rows, [{ client_key: client.client_key, name: client.name }]).map((j) => {
    const full = j.row
    const ts = full.timestamp ?? ''
    const rv = reviews[`${client.client_key}|${ts}`] ?? null
    for (const c of j.categories) cats.add(c)
    return {
      id: j.id, incident_ts: ts, your_name: j.your_name, client_name: j.client_name, client_key: client.client_key,
      incident_category: j.incident_category, categories: j.categories, incident_location: j.incident_location,
      house_code: code, incident_date: cpDay(j.incident_date) || j.incident_date, incident_time: j.incident_time,
      incident_reported_date: cpDay(full.incident_reported_date) || (full.incident_reported_date ?? ''),
      incident_reported_time: full.incident_reported_time ?? '',
      employees_involved: listOf(full.employees_involved),
      summary_of_incident: full.summary_of_incident ?? '',
      immediate_action_taken: full.immediate_action_taken ?? '',
      cause_and_contributing_factors: full.cause_and_contributing_factors ?? '',
      prevention_plan: full.prevention_plan ?? '',
      status: rv && statuses.includes(String(rv.status)) ? String(rv.status) : 'Reported',
      status_by: rv ? String(rv.by ?? '') : '', status_at: rv ? String(rv.at ?? '') : '',
    }
  })
  return scrubAnswer({ rows: out, categories: [...cats].sort(), statuses: [...INCIDENT_REVIEW_STATUSES] })
}

/** The pack's reviews part, as the join reads it; null when it is not that shape. */
export function reviewsOf(part: unknown): Record<string, Review> | null {
  const r = rec(part).reviews
  return r && typeof r === 'object' && !Array.isArray(r) ? (r as Record<string, Review>) : null
}
