// LOCATIONS FROM THE JSON AND THE SLICES — the sections whose every input is already on the slice shelf (houses…
// Each builder answers exactly the action's own answer, and the section's reader (repairsOf, incidentsOf…
import { isOpen, toRepairRow } from '@/lib/houseRepairAnalysis'
import { splitCategories } from '@/lib/incidentCategories'
import type { OpsRow } from '@/features/ops-flows/useOpsCrud'
import type { HouseRow } from '@/pages/features/houses/houseModel'
import { driveIdOf, nameKey } from './locationModel'

type Rec = Record<string, unknown>
const rec = (v: unknown): Rec => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : {})
/** locationsCell_: the cell as text, trimmed. */
const cell = (v: unknown): string => (v == null ? '' : String(v).trim())
/** locationsText_: whitespace folded. */
const text = (v: unknown): string => (v == null ? '' : String(v).replace(/\s+/g, ' ').trim())
const when = (v: unknown): number => {
  const t = Date.parse(cell(v))
  return Number.isNaN(t) ? 0 : t
}

/** A cell that is exactly a house code; '' otherwise (locationsHouseCode_). */
export function houseCodeOf(v: unknown): string {
  const s = cell(v).toUpperCase()
  return /^[A-Z]{2,4}\d{3,6}$/.test(s) ? s : ''
}

/* ---------- the addresses ---------- */

export type Addr = { key: string; unit: string; num: string }

/** hubAddrKey_: the part before the first comma, letters and digits only. */
const addrKey = (v: string): string => v.split(',')[0].toLowerCase().replace(/[^a-z0-9]+/g, '')

/** Street key, unit and house number: "4060 Orchard Dale Dr NW, Apt B, Canton" → {4060orcharddaledrnw, b, 4060}. */
export function addrOf(v: unknown): Addr {
  const s = (v == null ? '' : String(v)).toLowerCase()
  const m = /(?:^|[\s,(])(?:apt|apartment|unit|suite|ste)\b\.?\s*#?\s*([a-z0-9]+)\b/.exec(s) ?? /#\s*([a-z0-9]+)\b/.exec(s)
  let street = s.replace(/\([^)]*\)/g, ' ')
  const cut = street.search(/(?:^|[\s,])(?:apt|apartment|unit|suite|ste)\b|#/)
  if (cut > 0) street = street.slice(0, cut)
  const num = /^\s*(\d{2,6})\b/.exec(street)
  return { key: addrKey(street), unit: m ? m[1] : '', num: num ? num[1] : '' }
}

export type AddrIndex = Record<string, Addr[]>

/** Every address each house answers to: the registry's, and its clients' own (locationsAddrIndex_). */
export function addrIndex(homes: { code: string; address?: string }[], clients: { house?: string; home_address?: string }[]): AddrIndex {
  const by: AddrIndex = {}
  const add = (code: string, value: unknown) => {
    if (!code || !cell(value)) return
    const a = addrOf(value)
    if (a.key || a.num) by[code].push(a)
  }
  for (const h of homes) {
    if (!h?.code) continue
    by[h.code] = by[h.code] ?? []
    add(h.code, h.address)
  }
  for (const c of clients) {
    const code = houseCodeOf(c?.house)
    if (!code) continue
    by[code] = by[code] ?? []
    add(code, c.home_address)
  }
  return by
}

/** The one house an address names: street and unit exactly, else a house number (and unit) no other house shares. */
export function addrOwner(index: AddrIndex, value: unknown): { code: string; how: '' | 'exact' | 'street_number' } {
  const a = addrOf(value)
  const codes = Object.keys(index)
  const exact = codes.filter((c) => index[c].some((x) => !!a.key && x.key === a.key && x.unit === a.unit))
  if (exact.length === 1) return { code: exact[0], how: 'exact' }
  if (exact.length > 1 || !a.num) return { code: '', how: '' }
  const near = codes.filter((c) => index[c].some((x) => x.num === a.num && (!a.unit || x.unit === a.unit)))
  return near.length === 1 ? { code: near[0], how: 'street_number' } : { code: '', how: '' }
}

/* ---------- the clients ---------- */

/** A client as Locations may hold one: who they are and where they live — never a clinical or contact field. */
export type ClientIdentity = {
  client_key: string
  name: string
  house: string
  home_address: string
  status: string
  isp_year: string
  isp_doc_url: string
  isp_doc_name: string
}

/** locationsClientRows_: a clients slice row narrowed to identity; no client_key keys by the folded name. */
export function clientIdentity(row: unknown): ClientIdentity {
  const r = rec(row)
  return {
    client_key: cell(r.client_key) || nameKey(r.name), name: text(r.name), house: text(r.house),
    home_address: text(r.home_address), status: text(r.status), isp_year: text(r.isp_year),
    isp_doc_url: cell(r.isp_doc_url), isp_doc_name: text(r.isp_doc_name),
  }
}

const current = (c: ClientIdentity): boolean => {
  const s = c.status.toLowerCase()
  return !s || s === 'active'
}

/** The house's current clients: its code on the client, else the registry street and unit exactly (locationsClientsAt_). */
export function clientsAt(code: string, homeAddress: string, clients: ClientIdentity[]): ClientIdentity[] {
  const home = homeAddress ? addrOf(homeAddress) : null
  return clients.filter((c) => {
    if (!current(c)) return false
    const hc = houseCodeOf(c.house)
    if (hc) return hc === code
    if (!home?.key) return false
    const a = addrOf(c.home_address)
    return a.key === home.key && a.unit === home.unit
  })
}

// The clients the Associated clients edition may add to a house: current, and placed in no house now — no house…
export function addableClients(clients: ClientIdentity[], homes: { code: string; address?: string }[]): ClientIdentity[] {
  const streets = homes.map((h) => addrOf(h.address ?? '')).filter((a) => a.key)
  return clients.filter((c) => {
    if (!current(c)) return false
    if (houseCodeOf(c.house) || /[A-Z]{2,4}\d{3,6}\s*$/.test(c.house.trim().toUpperCase())) return false
    const a = addrOf(c.home_address)
    return !a.key || !streets.some((s) => s.key === a.key && s.unit === a.unit)
  }).sort((a, b) => a.name.localeCompare(b.name))
}

/** locationsClientList_: {client_key, name}, by name. */
export const clientList = (clients: ClientIdentity[]): { client_key: string; name: string }[] =>
  clients.map((c) => ({ client_key: c.client_key, name: c.name })).sort((a, b) => a.name.localeCompare(b.name))

/* ---------- House Repairs (locationRepairs) ---------- */

export type RepairAnswerRow = {
  id: string
  timestamp: string
  select_address_vehicle: string
  repair_type: string
  urgency_level: string
  please_describe_the_issue: string
  status: string
  resolution_notes: string
  whole_estate: boolean
  match: string
  resolved: boolean
}

/** The house's requests: its own street, the unique street-number fallback, and every ALL row; newest first. */
export function repairsFor(rows: unknown[], code: string, index: AddrIndex): RepairAnswerRow[] {
  const out: RepairAnswerRow[] = []
  rows.forEach((raw, i) => {
    const r = rec(raw)
    const addr = cell(r.select_address_vehicle)
    const whole = /^all$/i.test(addr)
    let how = 'all'
    if (!whole) {
      const owner = addrOwner(index, addr)
      if (owner.code !== code) return
      how = owner.how
    }
    out.push({
      id: cell(r.id), timestamp: cell(r.timestamp), select_address_vehicle: addr, repair_type: cell(r.repair_type),
      urgency_level: cell(r.urgency_level), please_describe_the_issue: cell(r.please_describe_the_issue),
      status: cell(r.status), resolution_notes: cell(r.resolution_notes), whole_estate: whole, match: how,
      resolved: !isOpen(toRepairRow(r as OpsRow, i)),
    })
  })
  return out.sort((a, b) => when(b.timestamp) - when(a.timestamp))
}

/** locationRepairs' answer: the open ones, or every one with `resolved`, and both counts. */
export function repairsAnswer(code: string, all: RepairAnswerRow[], resolved: boolean) {
  const open = all.filter((r) => !r.resolved).length
  return { house: code, resolved, rows: all.filter((r) => resolved || !r.resolved), open_count: open,
    resolved_count: all.length - open }
}

/* ---------- Incidents (locationIncidents) ---------- */

export const INCIDENT_COLUMNS = ['timestamp', 'your_name', 'client_name', 'incident_category', 'incident_location',
  'incident_date', 'incident_time', 'incident_reported_date', 'incident_reported_time', 'employees_involved',
  'summary_of_incident', 'immediate_action_taken', 'cause_and_contributing_factors', 'prevention_plan'] as const

/** The incidents of the house's current clients, joined by the folded name; the full row whitelisted; newest first. */
export function incidentsFor(rows: unknown[], clients: { client_key: string; name: string }[]) {
  const byKey = new Map(clients.map((c) => [nameKey(c.name), c]))
  const out: {
    id: string; your_name: string; client_name: string; client_key: string; incident_category: string
    categories: string[]; incident_location: string; incident_date: string; incident_time: string; row: Record<string, string>
  }[] = []
  for (const raw of rows) {
    const r = rec(raw)
    const c = byKey.get(nameKey(r.client_name))
    if (!c) continue
    const full: Record<string, string> = { id: cell(r.id) }
    for (const k of INCIDENT_COLUMNS) full[k] = cell(r[k])
    out.push({
      id: full.id, your_name: full.your_name, client_name: full.client_name, client_key: c.client_key,
      incident_category: full.incident_category, categories: splitCategories(r.incident_category),
      incident_location: full.incident_location, incident_date: full.incident_date, incident_time: full.incident_time,
      row: full,
    })
  }
  return out.sort((a, b) => (when(b.incident_date) - when(a.incident_date)) || (when(b.row.timestamp) - when(a.row.timestamp)))
}

export function incidentsAnswer(code: string, clients: { client_key: string; name: string }[], rows: unknown[]) {
  const list = incidentsFor(rows, clients)
  const cats = new Set<string>()
  for (const r of list) for (const c of r.categories) cats.add(c)
  return { house: code, clients, categories: [...cats].sort(), rows: list }
}

/* ---------- Documents (locationDocuments), all but the guidebook ---------- */

/** Each current client's ISP, as the clients slice carries it (the same ispDocFor_ fills it). */
export function ispsFrom(clients: ClientIdentity[]) {
  return clients.map((c) => ({
    client: c.name, client_key: c.client_key, isp_doc_url: c.isp_doc_url, isp_doc_name: c.isp_doc_name,
    isp_doc_id: driveIdOf(c.isp_doc_url), isp_year: c.isp_year,
  })).sort((a, b) => a.client.localeCompare(b.client))
}

/** The company policies as the houses slice carries them. */
export const policiesFrom = (house: Pick<HouseRow, 'policies'>) =>
  (house.policies ?? []).filter((p) => p.title && p.url)
    .map((p) => ({ title: p.title, url: p.url, drive_id: p.drive_id || driveIdOf(p.url) }))

/** Why the company policies are missing when the houses slice could not read their tab; '' when it could. */
export function policiesWhy(sources: HouseRow['sources'] | undefined): string {
  const src = (sources ?? []).find((s) => s.key === 'policies' && s.state === 'unreadable')
  if (!src) return ''
  const why = cell(src.why).slice(0, 120)
  if (why.startsWith('could not be read')) return `the company policies ${why}`
  return `the company policies could not be read${why ? ` (${why})` : ''}`
}

/** locationDocuments' answer, the guidebook taken from the pack's own walk of the houses room. */
export function documentsAnswer(house: Pick<HouseRow, 'code' | 'policies'> & { sources?: HouseRow['sources'] },
  clients: ClientIdentity[], guide: { guidebook?: unknown; guidebook_why?: unknown; degraded?: unknown }) {
  const why = policiesWhy(house.sources)
  return {
    house: house.code, isps: ispsFrom(clients), guidebook: guide.guidebook ?? null, guidebook_why: cell(guide.guidebook_why),
    policies: policiesFrom(house), policies_why: why, degraded: guide.degraded === true || !!why,
  }
}

/* ---------- the age line ---------- */

/** "just now", "4 min ago", "3 h ago", or the day; '' for no stamp. */
export function updatedWords(iso: string, now: number = Date.now()): string {
  const t = Date.parse(iso)
  if (!iso || Number.isNaN(t)) return ''
  const s = Math.max(0, Math.round((now - t) / 1000))
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`
  return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
