// LOCATIONS — the shapes its Apps Script reads answer and the arithmetic the screen does on them.
// Pure: the page and the tests import the same code.
import { format } from 'date-fns'
import { ohioWall } from '@/lib/ohio'
import { formatPhoneDisplay } from '@/lib/phoneFormat'
import { splitCategories } from '@/lib/incidentCategories'
import { isOpen, isWholeEstate, toRepairRow, type RepairRow } from '@/lib/houseRepairAnalysis'
import type { OpsRow } from '@/features/ops-flows/useOpsCrud'
import type { OpsField } from '@/features/ops-flows/OpsRecordModal'
import type { SharePayload } from '@/stores/useShareStore'
import {
  clientProfileHref, codeIn, gridHouses, type HouseClient, type HousePolicy, type HouseRow,
} from '@/pages/features/houses/houseModel'
import { editRawOf, type EditField } from '@/lib/recordEdit'
import { EDITION_IDS, editionIdsOf, type EditionId } from '@/lib/editions'

/* ---------- small readers ---------- */

type Rec = Record<string, unknown>
const rec = (v: unknown): Rec => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : {})
const str = (v: unknown): string => (v == null ? '' : String(v).trim())
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}
/** The first array among the answer's likely fields, or the answer itself when it is one. */
function rowsIn(raw: unknown, ...keys: string[]): unknown[] {
  if (Array.isArray(raw)) return raw
  const o = rec(raw)
  for (const k of keys) if (Array.isArray(o[k])) return o[k] as unknown[]
  return []
}

/** A name folded the way Apps Script folds it (clientNameKey_): lower case, letters and digits only. */
export const nameKey = (v: unknown): string => str(v).toLowerCase().replace(/[^a-z0-9]+/g, '')

/* ---------- the sections and the address ---------- */

export const LOCATION_TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'staff', label: 'Staff' },
  { id: 'calendar', label: 'House Calendar' },
  { id: 'supplies', label: 'House Supplies' },
  { id: 'repairs', label: 'House Repairs' },
  { id: 'incidents', label: 'Incidents' },
  { id: 'documents', label: 'Documents' },
] as const

export type LocationTab = (typeof LOCATION_TABS)[number]['id']

export function tabOf(v: string | null | undefined): LocationTab {
  const hit = LOCATION_TABS.find((t) => t.id === v)
  return hit ? hit.id : 'overview'
}

export const tabLabel = (tab: LocationTab): string => LOCATION_TABS.find((t) => t.id === tab)?.label ?? 'Overview'

export const LOCATIONS_PATH = '/app/locations/overview'

export type SupplyKind = 'count' | 'delivery' | 'par'

/** What the one right panel holds. It rides the address as `panel=`. A document is never here: it opens centred. */
export type PanelAsk =
  | { kind: 'notes' }
  | { kind: 'incident' }
  | { kind: 'repair' }
  | { kind: 'share' }
  | { kind: 'staff'; name: string }
  | { kind: 'ist'; staff: string; client: string }
  | { kind: 'repair-row'; id: string }
  | { kind: 'incident-row'; id: string }
  | { kind: 'supply'; entry: SupplyKind; item: string }
  | { kind: 'house' }
  | { kind: 'note'; id: string }
  | { kind: 'supply-entry'; id: string }
  | { kind: 'staff-back'; name: string }
  | { kind: 'doc-link' }
  | { kind: 'doc-upload' }
  | { kind: 'doc-remove'; id: string }
  | { kind: 'clients-add' }
  | { kind: 'asset'; id: string }
  | { kind: 'asset-add' }
  | { kind: 'house-photo' }

const SEP = '~'
const SUPPLY_KINDS_IDS: SupplyKind[] = ['count', 'delivery', 'par']

export function panelParam(ask: PanelAsk | null): string {
  if (!ask) return ''
  switch (ask.kind) {
    case 'notes': case 'incident': case 'repair': case 'share': case 'house': case 'doc-link': case 'doc-upload':
    case 'clients-add': case 'asset-add': case 'house-photo': return ask.kind
    case 'note': case 'supply-entry': case 'doc-remove': case 'asset': return [ask.kind, ask.id].join(SEP)
    case 'staff': case 'staff-back': return [ask.kind, ask.name].join(SEP)
    case 'ist': return ['ist', ask.staff, ask.client].join(SEP)
    case 'repair-row': return ['repair-row', ask.id].join(SEP)
    case 'incident-row': return ['incident-row', ask.id].join(SEP)
    case 'supply': return ['supply', ask.entry, ask.item].join(SEP)
  }
}

export function panelOf(v: string | null | undefined): PanelAsk | null {
  const parts = str(v).split(SEP)
  const [kind, a = '', b = ''] = parts
  switch (kind) {
    case 'notes': case 'incident': case 'repair': case 'share': case 'house': case 'doc-link': case 'doc-upload':
    case 'clients-add': case 'asset-add': case 'house-photo': return { kind }
    case 'note': case 'supply-entry': case 'doc-remove': case 'asset': return a ? { kind, id: a } : null
    case 'staff': case 'staff-back': return a ? { kind, name: a } : null
    case 'ist': return a && b ? { kind, staff: a, client: b } : null
    case 'repair-row': return a ? { kind, id: a } : null
    case 'incident-row': return a ? { kind, id: a } : null
    case 'supply': return (SUPPLY_KINDS_IDS as string[]).includes(a) ? { kind, entry: a as SupplyKind, item: b } : null
    default: return null
  }
}

/** `?house=…&tab=…&panel=…` — the whole state of the screen. */
export function locationQuery(house: string, tab: LocationTab, panel: PanelAsk | null = null): string {
  const p = new URLSearchParams()
  if (house) p.set('house', house)
  if (tab !== 'overview') p.set('tab', tab)
  const pp = panelParam(panel)
  if (pp) p.set('panel', pp)
  const s = p.toString()
  return s ? `?${s}` : ''
}

export const locationHref = (house: string, tab: LocationTab): string => `${LOCATIONS_PATH}${locationQuery(house, tab)}`

/* ---------- the house switcher ---------- */

/** The switcher's list: the active houses by title (the Houses grid's own search), then the inactive ones when asked. */
export function switcherHouses(rows: HouseRow[], query: string, showInactive: boolean): HouseRow[] {
  const active = gridHouses(rows, query)
  if (!showInactive) return active
  const asActive = rows.filter((h) => !h.active).map((h) => ({ ...h, active: true }))
  const inactive = gridHouses(asActive, query).map((h) => ({ ...h, active: false }))
  return [...active, ...inactive]
}

/** The house the screen opens on when the address names none: the first active one by title. */
export function defaultHouse(rows: HouseRow[]): HouseRow | null {
  return gridHouses(rows)[0] ?? [...rows].sort((a, b) => a.title.localeCompare(b.title))[0] ?? null
}

/* ---------- overview ---------- */

export const NOT_ON_FILE = 'Not on file'

export type Manager = { name: string; phone: string }

export type LocationOverview = {
  /** no source holds a house type yet, so this is null and drawn "Not on file" */
  type: string | null
  /** the hotline calendar's ** rule: the anchor first, then everyone current */
  managers: Manager[]
  managersWhy: string
  /** the registry's own manager columns — shown only beside the calendar's, never in its place */
  registryManager: Manager | null
  housePhone: string
  address: string
  calendarLink: string
  registryWhy: string
  /** the house's current clients as Apps Script keys them — what a note may name */
  clients: ServerClient[]
  /** the registry row's columns as the house door witnesses them; empty when the registry has no row */
  edit: Record<string, string>
}

export type ServerClient = { client_key: string; name: string }

const serverClients = (v: unknown): ServerClient[] =>
  rowsIn(v).map((c) => ({ client_key: str(rec(c).client_key), name: str(rec(c).name) })).filter((c) => c.name)

function managerOf(v: unknown): Manager | null {
  const o = rec(v)
  const name = str(o.name)
  return name ? { name, phone: str(o.phone) } : null
}

/** locationOverview's answer: { house: {phone, address, calendar_link, type}, manager, managers, manager_why, registry_manager }. */
export function overviewOf(raw: unknown): LocationOverview {
  const o = rec(raw)
  const h = rec(o.house)
  const list: Manager[] = []
  const add = (m: Manager | null) => {
    if (m && !list.some((x) => nameKey(x.name) === nameKey(m.name))) list.push(m)
  }
  add(managerOf(o.manager))
  for (const m of rowsIn(o, 'managers')) add(managerOf(m))
  const type = str(h.type ?? o.type)
  return {
    type: type || null,
    managers: list,
    managersWhy: str(o.manager_why),
    registryManager: managerOf(o.registry_manager),
    housePhone: str(h.phone ?? o.telephone),
    address: str(h.address),
    calendarLink: str(h.calendar_link ?? o.calendar_link),
    registryWhy: str(o.registry_why),
    clients: serverClients(o.clients),
    edit: editRawOf(o.edit),
  }
}

export const mapsHref = (address: string): string =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`

export const telHref = (phone: string): string => `tel:${phone.replace(/[^\d+]/g, '')}`

/* ---------- house notes ---------- */

export type NotePriority = 'low' | 'normal' | 'high' | 'urgent'

export const NOTE_PRIORITIES: { id: NotePriority; label: string }[] = [
  { id: 'low', label: 'Low' },
  { id: 'normal', label: 'Normal' },
  { id: 'high', label: 'High' },
  { id: 'urgent', label: 'Urgent' },
]

export type HouseNote = {
  id: string
  clientKey: string
  /** the answer's own spelling of the client, when it names one */
  clientName: string
  priority: string
  details: string
  state: 'open' | 'resolved'
  by: string
  at: string
}

export function notesOf(raw: unknown): HouseNote[] {
  return rowsIn(raw, 'notes', 'rows')
    .map((r) => {
      const o = rec(r)
      return {
        id: str(o.id),
        clientKey: str(o.client_key),
        clientName: str(o.client_name),
        priority: str(o.priority).toLowerCase() || 'normal',
        details: str(o.details),
        state: str(o.state).toLowerCase() === 'resolved' ? 'resolved' as const : 'open' as const,
        by: str(o.by),
        at: str(o.at),
      }
    })
    .filter((n) => n.id)
    .sort((a, b) => b.at.localeCompare(a.at))
}

export const openNotes = (notes: HouseNote[]): HouseNote[] => notes.filter((n) => n.state === 'open')

export const priorityLabel = (p: string): string =>
  NOTE_PRIORITIES.find((x) => x.id === p)?.label ?? (p ? p[0].toUpperCase() + p.slice(1) : 'Normal')

/** The client a note is about: the answer's name, else the house's own list; '' when it names none. */
export function noteClient(note: Pick<HouseNote, 'clientKey' | 'clientName'>, clients: HouseClient[]): string {
  if (note.clientName) return note.clientName
  if (!note.clientKey) return ''
  const k = nameKey(note.clientKey)
  const hit = clients.find((c) => c.client_key === note.clientKey || c.client_id === note.clientKey || nameKey(c.name) === k)
  return hit?.name ?? note.clientKey
}

/** The key a note files a client under: the house list's own key, else the folded name. */
export const clientKeyOf = (c: HouseClient): string => c.client_key || nameKey(c.name)

/* ---------- staff ---------- */

export type ShiftSource = 'archive' | 'punches'

export const SOURCE_LABEL: Record<ShiftSource, string> = { archive: 'Calendar Archive', punches: 'PSI punches' }

export type DatedShift = { day: string; source: ShiftSource | '' }

/** One IST cell as locationStaff answers it; `id` is '' when no IST record pairs the two at this house. */
export type IstPaper = {
  staff: string
  client: string
  id: string
  status: string
  trainedAt: string
  docUrl: string
  docFileId: string
}

export type StaffMember = {
  name: string
  first: DatedShift
  last: DatedShift
  shifts: number | null
  sources: ShiftSource[]
  hm: boolean
  lead: boolean
  ist: IstPaper[]
}

/** A person taken off the house's Staff list: who did it and when; their record is untouched. */
export type RemovedStaff = { name: string; by: string; at: string }

// `clients`: the house's current clients as Apps Script lists them — one IST column each.
export type LocationStaff = {
  rows: StaffMember[]; clients: ServerClient[]; why: string; removed: RemovedStaff[]
  /** every active employee, the IST form's trainees; empty for a narrowed viewer */
  employees: string[]
}

const sourceOf = (v: unknown): ShiftSource | '' => {
  const s = str(v).toLowerCase()
  return s === 'archive' || s === 'punches' ? s : ''
}

function datedShift(o: Rec, which: 'first' | 'last', sources: ShiftSource[]): DatedShift {
  const nested = rec(o[which])
  const day = str(nested.day ?? o[`${which}_day`]).slice(0, 10)
  const named = sourceOf(nested.source ?? o[`${which}_source`])
  // a date whose source the answer did not name keeps none, unless only one source was read
  return { day, source: named || (sources.length === 1 ? sources[0] : '') }
}

function istPaperOf(v: unknown, staff: string): IstPaper {
  const o = rec(v)
  const docUrl = str(o.docUrl ?? o.doc_url)
  return {
    staff: str(o.staff) || staff,
    client: str(o.client ?? o.client_name),
    // an answer that does not carry the record's id is taken as carrying a record
    id: o.id === undefined ? 'row' : str(o.id),
    status: str(o.status).toLowerCase(),
    trainedAt: str(o.trainedAt ?? o.trained_at),
    docUrl,
    docFileId: str(o.docFileId) || driveIdOf(docUrl),
  }
}

/** The Drive id a link names; ''. */
export function driveIdOf(url: string): string {
  const m = /\/d\/([A-Za-z0-9_-]{10,})/.exec(url) ?? /[?&]id=([A-Za-z0-9_-]{10,})/.exec(url)
  return m ? m[1] : ''
}

/** locationIncidentStaff's answer: every active employee's name. */
export function incidentStaffOf(raw: unknown): string[] {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return (Array.isArray(o.employees) ? o.employees : []).map(str).filter(Boolean)
}

export function staffOf(raw: unknown): LocationStaff {
  const o = rec(raw)
  const src = rec(o.sources)
  const why = [str(rec(src.archive).why), str(rec(src.punches).why), str(o.ist_why), str(o.visible_why),
    str(o.removed_why), str(o.why)].filter(Boolean).join(' · ')
  const removed = rowsIn(o, 'removed').map((r) => ({ name: str(rec(r).name), by: str(rec(r).by), at: str(rec(r).at) }))
    .filter((r) => r.name)
  const loose = rowsIn(o, 'ist').map((r) => istPaperOf(r, ''))
  const rows = rowsIn(raw, 'staff', 'rows').map((r) => {
    const s = rec(r)
    const name = str(s.name)
    const sources = (Array.isArray(s.sources) ? s.sources : []).map(sourceOf).filter(Boolean) as ShiftSource[]
    const own = (Array.isArray(s.ist) ? s.ist : []).map((p) => istPaperOf(p, name))
    return {
      name,
      first: datedShift(s, 'first', sources),
      last: datedShift(s, 'last', sources),
      shifts: num(s.shifts),
      sources,
      hm: s.hm === true,
      lead: s.lead === true,
      ist: [...own, ...loose.filter((p) => nameKey(p.staff) === nameKey(name))],
    }
  }).filter((s) => s.name)
  rows.sort((a, b) => Number(b.hm) - Number(a.hm) || Number(b.lead) - Number(a.lead) ||
    b.last.day.localeCompare(a.last.day) || a.name.localeCompare(b.name))
  const employees = (Array.isArray(o.employees) ? o.employees : []).map(str).filter(Boolean)
  return { rows, clients: serverClients(o.clients), why, removed, employees }
}

export type IstCell =
  | { kind: 'paper'; fileId: string; at: string }
  | { kind: 'trained'; at: string }
  | { kind: 'upload' }
  /** no IST record pairs the two at this house, so there is nothing to file a paper against */
  | { kind: 'none' }

/** One IST cell: the paper when one is filed, "Trained" when trained with no paper, Upload, or none when unpaired. */
export function istCellFor(member: Pick<StaffMember, 'ist'>, client: string): IstCell {
  const k = nameKey(client)
  const papers = member.ist.filter((p) => nameKey(p.client) === k && p.id)
  const withDoc = papers.find((p) => p.docFileId)
  if (withDoc) return { kind: 'paper', fileId: withDoc.docFileId, at: withDoc.trainedAt }
  if (!papers.length) return { kind: 'none' }
  const trained = papers.find((p) => p.status === 'done' || p.trainedAt)
  if (trained) return { kind: 'trained', at: trained.trainedAt }
  return { kind: 'upload' }
}

export const IST_NONE = 'No IST record pairs them at this house.'

export const staffRole = (m: Pick<StaffMember, 'hm' | 'lead'>): string =>
  m.hm ? 'House manager' : m.lead ? 'Team lead / director' : ''

/** The IST paper door's limits: a PDF or a picture, up to 15 MB (the certificate door's own). */
export const IST_MAX_BYTES = 15 * 1024 * 1024
export const IST_ACCEPT = '.pdf,.png,.jpg,.jpeg,.gif,.webp,.heic,.heif'
const IST_TYPES: Record<string, string> = {
  pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  heic: 'image/heic', heif: 'image/heif',
}
const IST_MIMES = new Set(Object.values(IST_TYPES))

/** The paper's type as the door files it: the browser's own when it is one the door takes, else by extension; ''. */
export function istPaperType(file: { name: string; type: string }): string {
  const t = str(file.type).toLowerCase()
  if (IST_MIMES.has(t)) return t
  if (t === 'image/jpg' || t === 'image/pjpeg') return 'image/jpeg'
  const ext = /\.([a-z0-9]{1,5})$/i.exec(file.name)?.[1]?.toLowerCase() ?? ''
  return IST_TYPES[ext] ?? ''
}

/** Why a picked paper cannot be filed; '' when it can. */
export function istPaperProblem(file: { name: string; size: number; type: string }): string {
  if (!istPaperType(file)) return 'Only a PDF or a picture (PNG, JPG, GIF, WebP or HEIC) is filed.'
  if (file.size <= 0) return 'The file is empty.'
  if (file.size > IST_MAX_BYTES) return 'The file is over 15 MB.'
  return ''
}

/* ---------- days ---------- */

/** 'Sep 21, 2026' — '' for anything that is not a day. */
export function dayWords(v: string): string {
  const s = str(v)
  if (!s) return ''
  const d = ohioWall(/^\d{4}-\d{2}-\d{2}$/.test(s.slice(0, 10)) && s.length <= 10 ? s.slice(0, 10) : s)
  return d ? format(d, 'MMM dd, yyyy') : ''
}

/* ---------- house repairs ---------- */

/** `match`: how the row was tied to the house — its street exactly, the house number alone, or the whole estate. */
export type LocationRepair = RepairRow & { wholeEstate: boolean; match: string }

export function repairsOf(raw: unknown): LocationRepair[] {
  return rowsIn(raw, 'rows', 'repairs').map((r, i) => {
    const o = rec(r) as OpsRow
    const row = toRepairRow(o, i)
    return { ...row, wholeEstate: o.whole_estate === true || isWholeEstate(row.house), match: str(o.match) }
  })
}

const MIN_TIME = -8640000000000000

/** The open list; Show resolved adds Completed and Cancelled. Newest first. */
export function shownRepairs(rows: LocationRepair[], showResolved: boolean): LocationRepair[] {
  return rows
    .filter((r) => showResolved || isOpen(r))
    .sort((a, b) => (b.reported?.getTime() ?? MIN_TIME) - (a.reported?.getTime() ?? MIN_TIME))
}

export function repairCounts(rows: LocationRepair[]): { open: number; resolved: number } {
  const open = rows.filter(isOpen).length
  return { open, resolved: rows.length - open }
}

/** The house's street as the Repairs tab already spells it: the answer's own, the most used spelling, or the address. */
export function repairStreet(raw: unknown, rows: LocationRepair[], fallback: string): string {
  const said = str(rec(raw).street)
  if (said) return said
  const counts = new Map<string, number>()
  // a row tied by its street exactly spells the street; one tied by its house number alone may not
  const own = rows.filter((r) => r.house && !r.wholeEstate)
  const exact = own.filter((r) => r.match === 'exact')
  for (const r of exact.length ? exact : own) counts.set(r.house, (counts.get(r.house) ?? 0) + 1)
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]
  return top ? top[0] : fallback
}

/** The repair types these rows already use, most used first. */
export function repairTypes(rows: LocationRepair[]): string[] {
  const seen = new Map<string, { label: string; n: number }>()
  for (const r of rows) {
    if (!r.repairType) continue
    const k = r.repairType.toLowerCase()
    const hit = seen.get(k)
    if (hit) hit.n++
    else seen.set(k, { label: r.repairType, n: 1 })
  }
  return [...seen.values()].sort((a, b) => b.n - a.n || a.label.localeCompare(b.label)).map((v) => v.label)
}

/* ---------- incidents ---------- */

export type LocationIncident = {
  id: string
  yourName: string
  client: string
  /** the client's key as the read joined it ('' when the answer named none) */
  clientKey: string
  category: string
  categories: string[]
  location: string
  date: string
  time: string
  /** the whole sheet row, for the panel */
  row: Record<string, string>
}

export const INCIDENT_DETAIL_FIELDS: { key: string; label: string }[] = [
  { key: 'incident_reported_date', label: 'Reported on' },
  { key: 'incident_reported_time', label: 'Reported at' },
  { key: 'employees_involved', label: 'Employees involved' },
  { key: 'summary_of_incident', label: 'Summary of incident' },
  { key: 'immediate_action_taken', label: 'Immediate action taken' },
  { key: 'cause_and_contributing_factors', label: 'Cause and contributing factors' },
  { key: 'prevention_plan', label: 'Prevention plan' },
]

/** A typed M/D/YYYY stays as typed; an ISO stamp is read on Ohio's clock. */
function incidentDate(v: string): Date | null {
  const s = str(v)
  if (!s) return null
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec(s)
  if (m) {
    const year = Number(m[3]) < 100 ? Number(m[3]) + 2000 : Number(m[3])
    const d = new Date(year, Number(m[1]) - 1, Number(m[2]), 12)
    return Number.isNaN(d.getTime()) ? null : d
  }
  return ohioWall(s)
}

/** locationIncidents' answer: rows of the six list columns, `categories` split by Apps Script, and `row` for the panel. */
export function incidentsOf(raw: unknown): LocationIncident[] {
  return rowsIn(raw, 'rows', 'incidents').map((r, i) => {
    const top = rec(r)
    const full = { ...rec(top.row ?? top.full), ...top }
    for (const k of ['row', 'full', 'categories', 'client_key']) delete full[k]
    const row: Record<string, string> = {}
    for (const [k, v] of Object.entries(full)) row[k] = str(v)
    const category = row.incident_category ?? ''
    const split = Array.isArray(top.categories) ? top.categories.map(str).filter(Boolean) : []
    return {
      id: row.id || `ui-${i}`,
      yourName: row.your_name ?? '',
      client: row.client_name ?? '',
      clientKey: str(top.client_key),
      category,
      categories: split.length ? split : splitCategories(category),
      location: row.incident_location ?? '',
      date: row.incident_date ?? '',
      time: row.incident_time ?? '',
      row,
    }
  }).sort((a, b) => (incidentDate(b.date)?.getTime() ?? MIN_TIME) - (incidentDate(a.date)?.getTime() ?? MIN_TIME))
}

/** The two filters' choices: the clients and the categories these rows name. */
export function incidentChoices(rows: LocationIncident[]): { clients: string[]; categories: string[] } {
  const clients = new Map<string, string>()
  const cats = new Map<string, number>()
  for (const r of rows) {
    if (r.client && !clients.has(nameKey(r.client))) clients.set(nameKey(r.client), r.client)
    for (const c of r.categories) cats.set(c, (cats.get(c) ?? 0) + 1)
  }
  return {
    clients: [...clients.values()].sort((a, b) => a.localeCompare(b)),
    categories: [...cats.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([c]) => c),
  }
}

/** A medication error by its words: "Medication related error", "Medication Error", "Medication Documentation Error"… */
export const isMedErrorCategory = (category: string): boolean =>
  /\bmed(ication)?s?\b/i.test(category) && /\berrors?\b/i.test(category)

/** An incident that is a medication error and nothing else: hidden while med errors are. */
export const medErrorOnly = (r: Pick<LocationIncident, 'categories'>): boolean =>
  r.categories.length > 0 && r.categories.every(isMedErrorCategory)

/** '' is All clients / All categories. Med errors show when asked, or when the category chosen is one. */
export function filterIncidents(rows: LocationIncident[], client: string, category: string, showMedErrors = true): LocationIncident[] {
  const meds = showMedErrors || isMedErrorCategory(category)
  return rows.filter((r) => (!client || nameKey(r.client) === nameKey(client)) && (!category || r.categories.includes(category))
    && (meds || !medErrorOnly(r)))
}

export function incidentDay(v: string): string {
  const d = incidentDate(v)
  return d ? format(d, 'MMM d, yyyy') : '—'
}

/** A time-only cell once the backend formatted it; the 1899 carrier of an unformatted one is shown blank. */
export function incidentClock(v: string): string {
  const s = str(v)
  if (!s) return ''
  if (/^\d{1,2}:\d{2}/.test(s)) return s
  if (s.startsWith('1899-')) return ''
  const d = ohioWall(s)
  return d ? format(d, 'h:mm a') : s
}

/* ---------- the filing forms (New Incident, New House Repair) ---------- */

/** The incident form's own categories, as the paper form lists them. */
export const INCIDENT_CATEGORIES = [
  'Unusual Behavior (general)',
  'Minor injury or illness (rash, bruise, small cut, burn, slight cold, etc.)',
  'Medication related error',
  'Client funds missing or concerns',
  'Taken to the hospital',
  'Unapproved physical restraint',
  'Client Ran Away or Missing',
  'Other Unusual Incident (non-behavior related)',
] as const

/** Where an incident happened; Other is filled in (incident_location_other). */
export const INCIDENT_PLACES = ['Client Home', 'Community', 'Other'] as const
export const INCIDENT_PLACE_OTHER = 'Other'

/** The staff list of an incident's columns, as UI Reports asks them; the client is one of the house's. */
export const INCIDENT_FIELDS: OpsField[] = [
  { key: 'client_name', label: 'Client', kind: 'select', required: true },
  { key: 'incident_category', label: 'Category', kind: 'select', options: INCIDENT_CATEGORIES, required: true },
  { key: 'incident_location', label: 'Location', kind: 'select', options: INCIDENT_PLACES, required: true },
  { key: 'incident_date', label: 'Date of incident', kind: 'date', required: true },
  { key: 'incident_time', label: 'Time of incident', kind: 'time' },
  { key: 'incident_reported_date', label: 'Reported on', kind: 'date' },
  { key: 'incident_reported_time', label: 'Reported at', kind: 'time' },
  { key: 'employees_involved', label: 'Employees involved', placeholder: 'Names, comma-separated' },
  {
    key: 'summary_of_incident', kind: 'textarea', required: true, label: 'Summary of Incident',
    hint: 'Please describe the events before, during and directly after the incident.',
  },
  {
    key: 'immediate_action_taken', kind: 'textarea', required: true, label: 'Immediate Action Taken',
    hint: 'Please describe the actions staff took to ensure the safety of the client and/or others.',
  },
  {
    key: 'cause_and_contributing_factors', kind: 'textarea', required: true, label: 'Cause and Contributing Factors',
    hint: 'Do you have any thoughts on what led to the incident happening?',
  },
  {
    key: 'prevention_plan', kind: 'textarea', required: true, label: 'Prevention Plan',
    hint: 'Do you have any thoughts on how to prevent this from happening in the future?',
  },
]

/** The labels of the required fields left empty; an incident's Other place counts only once it is filled in. */
export function missingFields(fields: OpsField[], values: Record<string, string>): string[] {
  const out = fields.filter((f) => f.required && !str(values[f.key])).map((f) => f.label)
  if (fields.some((f) => f.key === 'incident_location') && !fields.some((f) => f.key === 'incident_location_other') &&
      str(values.incident_location) === INCIDENT_PLACE_OTHER && 'incident_location_other' in values &&
      !str(values.incident_location_other)) out.push('Location (Other)')
  return out
}

/** Only the form's own columns, trimmed, the empty ones left out. */
function formColumns(fields: OpsField[], values: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const f of fields) {
    const v = str(values[f.key])
    if (v) out[f.key] = v
  }
  return out
}

/** A new incident: the form's columns, who filed it (the session — an admin's filing is not stamped) and when. */
export function incidentPayload(values: Record<string, string>, yourName: string, at: string): Record<string, string> {
  const cols = formColumns(INCIDENT_FIELDS, values)
  // Other is filed with what was filled in beside it
  const other = str(values.incident_location_other)
  if (cols.incident_location === INCIDENT_PLACE_OTHER && other) cols.incident_location = `${INCIDENT_PLACE_OTHER}: ${other}`
  return { ...cols, your_name: yourName, timestamp: at }
}

/* ---------- an incident edited in the New Incident form ---------- */

const DAY_US = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/
const DAY_ISO = /^(\d{4})-(\d{2})-(\d{2})/
const CLOCK = /^(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp][Mm])?$/

/** A cell's day as the form's date input holds it (yyyy-MM-dd); '' when it is not a day. */
export function incidentFormDay(raw: string): string {
  const s = str(raw)
  const iso = DAY_ISO.exec(s)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  const us = DAY_US.exec(s)
  return us ? `${us[3]}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}` : ''
}

/** A cell's time as the form's time input holds it (HH:mm); '' when it is not a time. */
export function incidentFormClock(raw: string): string {
  const m = CLOCK.exec(str(raw))
  if (!m) return ''
  let h = Number(m[1])
  const pm = m[3]?.toLowerCase() === 'pm'
  if (m[3]) h = (h % 12) + (pm ? 12 : 0)
  return h > 23 ? '' : `${String(h).padStart(2, '0')}:${m[2]}`
}

/** A day back into the cell, in the cell's own spelling (M/D/YYYY stays M/D/YYYY). */
function cellDay(v: string, raw: string): string {
  const m = DAY_ISO.exec(v)
  if (!m || !DAY_US.test(str(raw))) return v
  return `${Number(m[2])}/${Number(m[3])}/${m[1]}`
}

/** A time back into the cell, in the cell's own spelling (an AM/PM time stays one). */
function cellClock(v: string, raw: string): string {
  const m = /^(\d{2}):(\d{2})$/.exec(v)
  if (!m || !/[AaPp][Mm]\s*$/.test(str(raw))) return v
  const h = Number(m[1])
  return `${h % 12 || 12}:${m[2]}:00 ${h < 12 ? 'AM' : 'PM'}`
}

const placeOf = (raw: string): { place: string; other: string } => {
  const s = str(raw)
  if (!s) return { place: '', other: '' }
  if ((INCIDENT_PLACES as readonly string[]).includes(s) && s !== INCIDENT_PLACE_OTHER) return { place: s, other: '' }
  const other = s.replace(new RegExp(`^${INCIDENT_PLACE_OTHER}\\s*:?\\s*`, 'i'), '')
  return { place: INCIDENT_PLACE_OTHER, other }
}

/** The names a cell of Employees involved carries (commas, semicolons or lines between them). */
export const incidentNames = (raw: string): string[] => str(raw).split(/[,;\n]+/).map((x) => x.trim()).filter(Boolean)

/** An incident's row as the New Incident form holds it: its days and times as the inputs read them, its place split
 * into Other and what was filled in, and Employees involved in the order of `employees` when they are ticked. */
export function incidentFormValues(row: Record<string, string>, employees: string[] = []): Record<string, string> {
  const out: Record<string, string> = {}
  for (const f of INCIDENT_FIELDS) {
    const raw = str(row[f.key])
    out[f.key] = f.kind === 'date' ? incidentFormDay(raw) : f.kind === 'time' ? incidentFormClock(raw) : raw
  }
  const { place, other } = placeOf(row.incident_location)
  out.incident_location = place
  if (place === INCIDENT_PLACE_OTHER) out.incident_location_other = other
  if (employees.length) {
    const named = new Set(incidentNames(row.employees_involved))
    out.employees_involved = employees.filter((e) => named.has(e)).join(', ')
  }
  return out
}

/** The form's value of one column as the cell would carry it. */
function cellOf(key: string, values: Record<string, string>, raw: string): string {
  const v = str(values[key])
  if (key === 'incident_location') {
    const other = str(values.incident_location_other)
    return v === INCIDENT_PLACE_OTHER && other ? `${INCIDENT_PLACE_OTHER}: ${other}` : v
  }
  const f = INCIDENT_FIELDS.find((x) => x.key === key)
  if (f?.kind === 'date') return cellDay(v, raw)
  if (f?.kind === 'time') return cellClock(v, raw)
  return v
}

/** The edit the form makes: each column whose value moved from what the form opened with, sent with the cell it
 * witnesses (the row as read), in the cell's own spelling. */
export function incidentEditChanges(row: Record<string, string>, opened: Record<string, string>,
  values: Record<string, string>): { field: string; value: string; expected: string }[] {
  return INCIDENT_FIELDS.flatMap((f) => {
    const raw = str(row[f.key])
    const now = cellOf(f.key, values, raw)
    return now === cellOf(f.key, opened, raw) ? [] : [{ field: f.key, value: now, expected: raw }]
  })
}

/** A new repair request: the form's columns and when; blank status reads as New. */
export function repairPayload(fields: OpsField[], values: Record<string, string>, at: string): Record<string, string> {
  return { ...formColumns(fields, values), timestamp: at }
}

/* ---------- documents ---------- */

export type DocKind = 'Policy' | 'Medication Delivery' | 'ISP' | 'Guidebook' | 'House document'

export type LocationDoc = {
  key: string
  title: string
  type: DocKind
  /** what the APPLIES TO column says */
  applies: string
  appliesTo: 'all' | 'client' | 'house' | 'none'
  /** the Drive file locationDocFile answers as bytes; '' when nothing is on file */
  fileId: string
  clientId?: string
  /** the client's own profile in the Clients app */
  clientHref?: string
}

export type CompanyDoc = { title: string; fileId: string }

export type IspDoc = { client: string; fileId: string; name: string; year: string }

export type HouseFile = { id: string; name: string; guide: boolean }

export type LocationDocuments = {
  policies: CompanyDoc[]
  isps: IspDoc[]
  /** the house's folder in the houses room; null when no folder names the house */
  guidebook: { folder: string; files: HouseFile[] } | null
  /** why there is no guidebook: none names the house, or the room could not be looked in */
  guidebookWhy: string
  /** the guidebook is not this viewer's (a client or a family member): no row for it at all */
  withheld: boolean
  why: string
}

export const ALL_LOCATIONS = 'All locations'

/** "Med Del" in a title is a Medication Delivery document; every other company document is a Policy. */
export const policyType = (title: string): DocKind => (/\bmed\.?\s*del\b/i.test(title) ? 'Medication Delivery' : 'Policy')

/** locationDocuments' answer: { policies, isps, guidebook: {folder_name, files} | null, policies_why }. */
export function documentsOf(raw: unknown): LocationDocuments {
  const o = rec(raw)
  const policies = rowsIn(o, 'policies').map((r) => {
    const x = rec(r)
    return { title: str(x.title), fileId: str(x.drive_id) || driveIdOf(str(x.url)) }
  }).filter((x) => x.title)
  const isps = rowsIn(o, 'isps').map((r) => {
    const x = rec(r)
    return { client: str(x.client ?? x.client_name), fileId: str(x.isp_doc_id) || driveIdOf(str(x.isp_doc_url)),
      name: str(x.isp_doc_name), year: str(x.isp_year) }
  }).filter((x) => x.client)
  const g = o.guidebook ? rec(o.guidebook) : null
  const guidebook = g ? {
    folder: str(g.folder_name),
    files: rowsIn(g, 'files').map((f) => ({ id: str(rec(f).id), name: str(rec(f).name), guide: rec(f).guide === true }))
      .filter((f) => f.id),
  } : null
  return { policies, isps, guidebook, guidebookWhy: guidebook ? '' : str(o.guidebook_why), withheld: o.guidebook_withheld === true,
    why: str(o.policies_why) }
}

// DOCUMENT | TYPE | APPLIES TO: the company documents for every location, each client's ISP, and the house's own…
export function documentRows(policies: CompanyDoc[], docs: LocationDocuments | null, houseTitle: string,
  clients: HouseClient[] = []): LocationDoc[] {
  const company = !docs ? policies : docs.policies.length ? docs.policies : policies.map((p) => ({ ...p, fileId: '' }))
  const out: LocationDoc[] = company.map((p, i) => ({
    key: `policy-${p.fileId || i}`, title: p.title, type: policyType(p.title), applies: ALL_LOCATIONS, appliesTo: 'all',
    fileId: p.fileId,
  }))
  if (!docs) return out
  docs.isps.forEach((x, i) => {
    const client = clients.find((c) => nameKey(c.name) === nameKey(x.client))
    out.push({
      key: `isp-${x.fileId || i}`,
      title: x.name || (x.fileId ? `Individual Service Plan${x.year ? ` ${x.year}` : ''}` : 'No ISP document on file'),
      type: 'ISP', applies: client?.name ?? x.client, appliesTo: 'client', fileId: x.fileId, clientId: client?.client_id,
      clientHref: client ? clientProfileHref(client) : undefined,
    })
  })
  const files = docs.guidebook?.files ?? []
  for (const f of files) {
    out.push({ key: `file-${f.id}`, title: f.name, type: f.guide ? 'Guidebook' : 'House document', applies: houseTitle,
      appliesTo: 'house', fileId: f.id })
  }
  // a house with no guidebook lists none: no placeholder row
  return out
}

/** The houses slice's company documents, as the Documents rows read them before the answer lands. */
export const slicePolicies = (policies: HousePolicy[] | undefined): CompanyDoc[] =>
  (policies ?? []).map((p) => ({ title: p.title, fileId: p.drive_id || driveIdOf(p.url) }))

/** The house's rows as the tab and the panel read them: the company documents, then what the read answered. */
export const houseDocuments = (house: Pick<HouseRow, 'policies' | 'title' | 'clients'>, docs: LocationDocuments | null): LocationDoc[] =>
  documentRows(slicePolicies(house.policies), docs, house.title, house.clients)

// One of the house's own documents (its folder in the houses room): the only kind the Documents edition removes.
export const houseOwnDoc = (d: Pick<LocationDoc, 'appliesTo' | 'fileId'>): boolean => d.appliesTo === 'house' && !!d.fileId

/** What a house document may be (Locations.gs locationsDocType_): a PDF, a picture, or a Word, Excel or PowerPoint file. */
export const HOUSE_DOC_ACCEPT = '.pdf,.png,.jpg,.jpeg,.gif,.webp,.heic,.heif,.doc,.docx,.xls,.xlsx,.ppt,.pptx'
export const HOUSE_DOC_HINT = 'PDF, picture, Word, Excel or PowerPoint · up to 15 MB.'
const HOUSE_DOC_EXT = /\.(pdf|png|jpe?g|gif|webp|heic|heif|docx?|xlsx?|pptx?)$/i

/** Why this file is not filed as a house document; '' when it may be. */
export function houseDocProblem(file: { name: string; size: number }): string {
  if (!HOUSE_DOC_EXT.test(file.name.trim())) return `Not a document the house keeps — ${HOUSE_DOC_HINT}`
  if (file.size > IST_MAX_BYTES) return 'This file is larger than 15 MB.'
  if (file.size <= 0) return 'This file is empty.'
  return ''
}

/** A Google Drive link to one file, as the Documents edition takes it; '' when the text is none. */
export function driveLinkProblem(text: string): string {
  const s = text.trim()
  if (!s) return 'Paste the document\'s Google Drive link.'
  if (/\/folders\//.test(s)) return 'That link is a folder; a document is one file.'
  if (!driveIdOf(s) && !/^[A-Za-z0-9_-]{20,}$/.test(s)) return 'That is not a Google Drive link to a document.'
  return ''
}

/* ---------- house supplies ---------- */

export const SUPPLY_KINDS: { id: SupplyKind; label: string; verb: string }[] = [
  { id: 'count', label: 'Count', verb: 'Record count' },
  { id: 'delivery', label: 'Delivery', verb: 'Record delivery' },
  { id: 'par', label: 'Par level', verb: 'Set par level' },
]

export type SupplyStatus = 'In stock' | 'Low' | 'Order now' | ''

export type Consumable = {
  item: string
  category: string
  onHand: number | null
  par: number | null
  status: SupplyStatus
  checked: string
  /** null until a delivery and a count after it are on the ledger — never 0 */
  consumption: number | null
  since: string
  daysCover: number | null
  /** the ledger's lines for the item, newest first */
  entries: SupplyEntry[]
}

export type SupplyEntry = {
  id: string; kind: string; qty: string; at: string; by: string; category: string; note: string; onHandAfter: string
}

/** `ledgerReady`: false while the ledger's house is not declared — nothing can be recorded, and the screen says so. */
export type LocationSupplies = {
  consumables: Consumable[]
  assets: Record<string, string>[]
  ledgerReady: boolean
  ledgerWhy: string
  why: string
  /** the fields an entry's correction takes, as the answering server names them */
  entryFields: string[]
  /** a mistaken entry may be removed (the answering server says so) */
  entryRemove: boolean
}

/** What an entry's correction takes when the answer names nothing (Apps Script's door). */
export const SUPPLY_ENTRY_FIELDS = ['qty', 'category', 'note']

/** The kind a removed entry keeps on the ledger; no reader lists it. */
export const SUPPLY_REMOVED = 'removed'

export const NOT_MEASURED = 'Not measured yet'

export function supplyStatusOf(v: unknown): SupplyStatus {
  const s = str(v).toLowerCase().replace(/[\s_-]+/g, ' ')
  if (s === 'in stock' || s === 'instock') return 'In stock'
  if (s === 'low') return 'Low'
  if (s === 'order now' || s === 'ordernow') return 'Order now'
  return ''
}

export function suppliesOf(raw: unknown): LocationSupplies {
  const o = rec(raw)
  const consumables = rowsIn(o, 'consumables', 'ledger', 'items').map((r) => {
    const x = rec(r)
    return {
      item: str(x.item),
      category: str(x.category),
      onHand: num(x.on_hand ?? x.in_stock ?? x.count),
      par: num(x.par ?? x.par_level),
      status: supplyStatusOf(x.status),
      checked: str(x.checked ?? x.counted_at),
      consumption: num(x.consumption),
      since: str(rec(x.last_delivery).at ?? x.since),
      daysCover: num(x.days_of_cover ?? x.days_cover),
      entries: rowsIn(x, 'entries').map((e) => {
        const y = rec(e)
        return { id: str(y.id), kind: str(y.kind), qty: str(y.qty), at: str(y.at), by: str(y.by),
          category: str(y.category), note: str(y.note), onHandAfter: str(y.on_hand_after) }
      }).filter((e) => e.id),
    }
  }).filter((c) => c.item).sort((a, b) => a.item.localeCompare(b.item))
  const assets = rowsIn(o, 'assets', 'inventory').map((r) => {
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(rec(r))) out[k] = str(v)
    return out
  })
  const named = Array.isArray(o.entry_fields) ? o.entry_fields.map(str).filter(Boolean) : []
  return {
    consumables, assets,
    ledgerReady: o.ledger_ready !== false,
    ledgerWhy: str(o.ledger_why),
    why: str(o.assets_why),
    entryFields: named.length ? named : SUPPLY_ENTRY_FIELDS,
    entryRemove: o.entry_remove === true,
  }
}

export type SupplyDraft = {
  house: string
  item: string
  category: string
  kind: SupplyKind
  qty: number
  on_hand_after?: number
  note?: string
}

export type SupplyValues = { kind: SupplyKind; item: string; category: string; qty: string; onHandAfter: string; note: string }

export const SUPPLY_QTY_LABEL: Record<SupplyKind, string> = {
  count: 'Counted on hand',
  delivery: 'Quantity delivered',
  par: 'Par level',
}

const wholeCount = (s: string): number | null => {
  const t = str(s)
  if (!/^\d+(\.\d+)?$/.test(t)) return null
  return Number(t)
}

/** The ledger row a panel entry appends, or the sentence that says why it cannot be filed. */
export function supplyDraft(house: string, v: SupplyValues): SupplyDraft | string {
  const item = str(v.item)
  if (!item) return 'Name the item.'
  const qty = wholeCount(v.qty)
  if (qty === null) return `${SUPPLY_QTY_LABEL[v.kind]}: a number, zero or more.`
  const draft: SupplyDraft = { house, item, category: str(v.category), kind: v.kind, qty }
  if (v.kind === 'delivery' && str(v.onHandAfter)) {
    const after = wholeCount(v.onHandAfter)
    if (after === null) return 'On hand after the delivery: a number, zero or more, or leave it empty.'
    draft.on_hand_after = after
  }
  if (str(v.note)) draft.note = str(v.note)
  return draft
}

export function consumptionLine(c: Pick<Consumable, 'consumption' | 'since'>): string {
  if (c.consumption === null) return NOT_MEASURED
  const since = dayWords(c.since)
  return `${c.consumption.toLocaleString('en-US')} used${since ? ` since ${since}` : ''}`
}

export const countWords = (n: number | null): string => (n === null ? '—' : n.toLocaleString('en-US'))

export function supplyTint(status: SupplyStatus): 'mint' | 'amber' | 'danger' | 'slate' {
  return status === 'In stock' ? 'mint' : status === 'Low' ? 'amber' : status === 'Order now' ? 'danger' : 'slate'
}

const ASSET_SKIP = new Set(['id', 'row', 'address', 'house', 'house_address', 'select_address_vehicle', 'timestamp', 'whole_estate'])

/** The asset columns worth a column: the item first, then up to four others the rows fill in. */
export function assetColumns(rows: Record<string, string>[]): string[] {
  const filled = new Map<string, number>()
  for (const r of rows) for (const [k, v] of Object.entries(r)) if (v && !ASSET_SKIP.has(k)) filled.set(k, (filled.get(k) ?? 0) + 1)
  const rest = [...filled.entries()].filter(([k]) => k !== 'item').sort((a, b) => b[1] - a[1]).map(([k]) => k).slice(0, 4)
  return ['item', ...rest]
}

export const columnLabel = (key: string): string => {
  const s = key.replace(/_/g, ' ').trim()
  return s ? s[0].toUpperCase() + s.slice(1) : key
}

/** The House Supplies inventory columns an asset edit or a new asset writes (Locations.gs LOCATION_ASSET_FIELDS). */
export const ASSET_FIELDS: readonly { key: string; label: string }[] = [
  { key: 'item', label: 'Item' },
  { key: 'current_condition', label: 'Condition' },
  { key: 'est_expiration_year', label: 'Replaced / expires' },
  { key: 'cost_to_replace', label: 'Cost to replace' },
  { key: 'replacement_frequency', label: 'Replace every' },
]

/** An inventory row the asset door can find: "r42". */
export const isAssetRow = (id: string): boolean => /^r\d+$/.test(id)

/** The asset's fields for its edit panel; its house (the inventory's address) is drawn locked. */
export function assetEditFields(a: Record<string, string>): EditField[] {
  return [
    { key: 'address', label: 'House', kind: 'text', raw: a.address ?? '', lockedBy: { why: 'An asset stays at its house.' } },
    ...ASSET_FIELDS.map((f): EditField => ({ key: f.key, label: f.label, kind: 'text', raw: a[f.key] ?? '' })),
  ]
}

/** A new asset's row as its door takes it, or the sentence that says why it cannot be filed. */
export function assetDraft(v: Record<string, string>): Record<string, string> | string {
  const row: Record<string, string> = {}
  for (const f of ASSET_FIELDS) {
    const s = str(v[f.key])
    if (s) row[f.key] = s.slice(0, 500)
  }
  return row.item ? row : 'Name the item.'
}

/* ---------- the house photo ---------- */

export const HOUSE_PHOTO_MAX_BYTES = 5 * 1024 * 1024
export const HOUSE_PHOTO_ACCEPT = 'image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp'
export const HOUSE_PHOTO_HINT = 'JPEG, PNG or WebP · up to 5 MB.'

/** Why a picked picture is not taken as the house photo; '' when it is (the relay reads its bytes again). */
export function housePhotoProblem(file: { name: string; size: number; type: string }): string {
  const t = str(file.type).toLowerCase()
  const named = /\.(jpe?g|png|webp)$/i.test(file.name.trim())
  if (!(['image/jpeg', 'image/png', 'image/webp'].includes(t) || (!t && named))) {
    return `Not a photo the house takes — ${HOUSE_PHOTO_HINT}`
  }
  if (file.size <= 0) return 'The picture is empty.'
  if (file.size > HOUSE_PHOTO_MAX_BYTES) return 'The picture is larger than 5 MB.'
  return ''
}

/* ---------- the panel's heading, and the Actions menu ---------- */

/** The small-caps word over the panel, and its accessible name. */
export function panelLabel(ask: PanelAsk): string {
  switch (ask.kind) {
    case 'notes': return 'House Notes'
    case 'incident': case 'incident-row': return 'Incident'
    case 'repair': case 'repair-row': return 'House Repair'
    case 'share': return 'Share'
    case 'staff': return 'Staff'
    case 'ist': return 'IST'
    case 'supply': case 'supply-entry': return 'House Supplies'
    case 'house': return 'House Details'
    case 'note': return 'House Notes'
    case 'staff-back': return 'Staff'
    case 'doc-link': case 'doc-upload': case 'doc-remove': return 'Documents'
    case 'clients-add': return 'Associated clients'
    case 'asset': case 'asset-add': return 'House assets'
    case 'house-photo': return 'House photo'
  }
}

export function panelTitle(ask: PanelAsk, house: Pick<HouseRow, 'title'>): string {
  switch (ask.kind) {
    case 'notes': return 'House Notes'
    // the panel's own label names it; the form starts at the client
    case 'incident': return ''
    // the panel's own label (House Repair) names it; the form starts at the house
    case 'repair': return ''
    case 'share': return house.title
    case 'staff': return ask.name
    case 'ist': return ask.staff && ask.client ? `${ask.staff} · ${ask.client}` : 'Record an IST training'
    // the panel's own label (House Repair) names it; the edit starts at the status
    case 'repair-row': return ''
    case 'incident-row': return 'Incident report'
    case 'supply': return SUPPLY_KINDS.find((k) => k.id === ask.entry)?.verb ?? 'House Supplies'
    case 'house': return `Edit ${house.title}`
    case 'note': return 'Edit note'
    case 'supply-entry': return 'Correct entry'
    case 'staff-back': return `Put ${ask.name} back`
    case 'doc-link': return 'Add from a Drive link'
    case 'doc-upload': return 'Upload a document'
    case 'doc-remove': return 'Remove a document'
    case 'clients-add': return 'Add clients'
    case 'asset': return 'Edit asset'
    case 'asset-add': return 'Add an asset'
    case 'house-photo': return `${house.title}'s photo`
  }
}

/** The Actions menu; each item is offered to a viewer who makes its edition (or the one it `also` comes by). */
export const ACTION_GROUPS: { label: string; items: { label: string; ask: PanelAsk; edition: EditionId; also?: EditionId }[] }[] = [
  { label: 'Overview', items: [{ label: 'House Notes', ask: { kind: 'notes' }, edition: 'locations.house' }] },
  {
    label: 'Location actions',
    items: [
      { label: 'New Incident', ask: { kind: 'incident' }, edition: 'locations.incidents', also: 'locations.incidentsNew' },
      { label: 'New House Repair', ask: { kind: 'repair' }, edition: 'locations.house' },
    ],
  },
]

/** The Actions menu as this viewer is offered it: the items of the editions it makes, and the groups left. */
export const actionGroupsFor = (can: (e: EditionId) => boolean) =>
  ACTION_GROUPS.map((g) => ({ ...g, items: g.items.filter((it) => can(it.edition) || (!!it.also && can(it.also))) }))
    .filter((g) => g.items.length > 0)

/* ---------- a read the server did not answer ---------- */

export const NOT_OPEN = 'This part is not open to you.'

/** A refusal as a sentence. "Unknown action." is the closed gate's answer: App Control's row, or the viewer's houses. */
export function readRefusal(error: string): string {
  if (/unknown action/i.test(error)) return NOT_OPEN
  return error || 'The read did not answer.'
}

/* ---------- who reads, and how far (locationScope) ---------- */

export type ScopeHouse = { code: string; title: string; address: string; photo: string; clients: ServerClient[]; clientCount: number }

// `writes`: the master's own pen.
export type LocationScope = {
  kind: string; writes: boolean; editions: EditionId[]; cut: boolean; houses: ScopeHouse[] | null; why: string
}

/** Every Locations edition: the master's. */
export const LOCATION_EDITIONS: EditionId[] = EDITION_IDS.filter((id) => id.startsWith('locations.'))

export const MASTER_SCOPE: LocationScope = {
  kind: 'master', writes: true, editions: LOCATION_EDITIONS, cut: false, houses: null, why: '',
}

/** locationScope's answer. Fails closed: a kind that does not see every house is held to the houses it names. */
export function scopeOf(raw: unknown): LocationScope {
  const o = rec(raw)
  const kind = str(o.kind) || 'none'
  const wide = kind === 'master' || kind === 'all'
  const houses = Array.isArray(o.houses)
    ? o.houses.map((h) => {
      const x = rec(h)
      const code = codeIn(str(x.code))
      return { code, title: str(x.home_name) || code, address: str(x.address), photo: str(x.thumbnail_url),
        clients: serverClients(x.clients), clientCount: num(x.client_count) ?? 0 }
    }).filter((h) => h.code)
    : null
  const cut = o.cut === true || !wide
  const writes = o.writes === true && kind === 'master'
  return {
    kind,
    writes,
    editions: cut ? [] : writes ? LOCATION_EDITIONS : editionIdsOf(o.editions).filter((id) => LOCATION_EDITIONS.includes(id)),
    cut,
    houses: wide && !houses ? null : houses ?? [],
    why: str(o.why),
  }
}

/** A scope's houses as the switcher and the header draw a house: the houses slice's shape, the rest left empty. */
export function scopeHouseRows(houses: ScopeHouse[]): HouseRow[] {
  return houses.map((h) => ({
    id: h.code, code: h.code, label: h.title, title: h.title, city: '', active: true, address: h.address,
    photo: { src: h.photo, source: h.photo ? 'registry' : '' }, managers: [], leads: [],
    clients: h.clients.map((c) => ({ name: c.name, client_key: c.client_key })), client_count: h.clientCount,
    staff: [], staff_source: '', week_notes: [], policies: [], sources: [],
  }))
}

/** The sections a viewer is shown: a cut view has no House Calendar (House Calendars is the staff's screen). */
/** The sections a viewer is shown: a cut viewer has no calendar; House Supplies is the master's while Settings › My Work hides it. */
export const tabsFor = (cut: boolean, suppliesHidden = false) =>
  LOCATION_TABS.filter((t) => (!cut || t.id !== 'calendar') && !(suppliesHidden && t.id === 'supplies'))

/* ---------- share ---------- */

export function sharePayloadFor(house: Pick<HouseRow, 'code' | 'title' | 'address' | 'clients'>, tab: LocationTab,
  overview: LocationOverview | null): SharePayload {
  const hm = overview?.managers[0]
  const lines = [
    house.address ? `Address: ${house.address}` : '',
    hm ? `House manager: ${hm.name}${hm.phone ? ` · ${formatPhoneDisplay(hm.phone)}` : ''}` : '',
    overview?.housePhone ? `House phone: ${formatPhoneDisplay(overview.housePhone)}` : '',
    `Clients: ${house.clients.length}`,
  ].filter(Boolean)
  return {
    title: house.title,
    subtitle: `Locations · ${tabLabel(tab)}`,
    appHref: locationHref(house.code, tab),
    text: lines.join('\n'),
    icon: 'house',
    filename: `${house.title} ${tabLabel(tab)}`,
  }
}

/* ---------- the edit panels (RecordEditBody) ---------- */

const FILED_AS_FILED = { why: 'When it was filed stays as filed.' }

/** The registry row's fields; the code, the photo and what other apps own are drawn locked with where they change. */
export function houseEditFields(o: LocationOverview, house: Pick<HouseRow, 'code'>): EditField[] {
  const e = o.edit
  const field = (key: string, label: string, kind: EditField['kind'], hint?: string): EditField =>
    ({ key, label, kind, raw: e[key] ?? '', ...(hint ? { hint } : {}) })
  return [
    { key: 'abbreviation', label: 'House code', kind: 'text', raw: e.abbreviation || house.code,
      lockedBy: { why: 'The house code is the key every app joins on.' } },
    field('home_name', 'Location name', 'text'),
    field('address', 'Address', 'text', 'Repairs are matched to a house by its street.'),
    field('region', 'Region', 'text'),
    field('telephone', 'House phone', 'phone'),
    field('manager_name', 'House manager on the registry', 'text'),
    field('manager_phone', 'Registry house manager phone', 'phone'),
    field('calendar_link', 'Calendar link', 'url'),
    { key: 'type', label: 'Type', kind: 'text', raw: e.type ?? o.type ?? '', hint: 'Such as House.' },
    { key: 'hotline_manager', label: 'House manager', kind: 'text', raw: o.managers.map((m) => m.name).join(', '),
      lockedBy: { why: 'Read from the hotline calendar.', door: 'Calendar Builder' } },
    { key: 'thumbnail_url', label: 'Photo', kind: 'url', raw: e.thumbnail_url ?? '', lockedBy: { why: 'Press the house photo to replace it.' } },
    { key: 'clients', label: 'Clients', kind: 'text', raw: o.clients.map((c) => c.name).join(', '),
      lockedBy: { why: 'A client\'s house is on the client\'s record.', door: 'Clients' } },
  ]
}

export function noteEditFields(n: HouseNote, choices: { key: string; name: string }[]): EditField[] {
  return [
    { key: 'details', label: 'Details', kind: 'textarea', raw: n.details },
    { key: 'priority', label: 'Priority', kind: 'select', raw: n.priority, options: NOTE_PRIORITIES.map((p) => p.id),
      optionLabels: Object.fromEntries(NOTE_PRIORITIES.map((p) => [p.id, p.label])) },
    { key: 'client_key', label: 'Associated client', kind: 'select', raw: n.clientKey, options: choices.map((c) => c.key),
      optionLabels: Object.fromEntries([...choices.map((c) => [c.key, c.name]), ...(n.clientName ? [[n.clientKey, n.clientName]] : [])]) },
    { key: 'state', label: 'State', kind: 'select', raw: n.state, options: ['open', 'resolved'],
      optionLabels: { open: 'Open', resolved: 'Resolved' } },
  ]
}

export function supplyEntryOf(s: LocationSupplies | null, id: string): (SupplyEntry & { item: string }) | null {
  for (const c of s?.consumables ?? []) {
    const e = c.entries.find((x) => x.id === id)
    if (e) return { ...e, item: c.item }
  }
  return null
}

// The entry's fields for its correction panel: the ones `open` names (the answering server's), the rest drawn locked.
export function supplyEntryFields(e: SupplyEntry & { item: string }, open: readonly string[] = SUPPLY_ENTRY_FIELDS): EditField[] {
  const kind = SUPPLY_KINDS.find((k) => k.id === e.kind)
  const field = (key: string, label: string, raw: string, hint?: string): EditField =>
    ({ key, label, kind: 'text', raw, ...(hint ? { hint } : {}),
      ...(open.includes(key) ? {} : { lockedBy: { why: 'Not corrected here.' } }) })
  return [
    { key: 'item', label: 'Item', kind: 'text', raw: e.item, lockedBy: { why: 'An entry\'s item stays as recorded.' } },
    { key: 'kind', label: 'Recorded as', kind: 'text', raw: kind?.label ?? e.kind, lockedBy: { why: 'An entry\'s kind stays as recorded.' } },
    field('qty', kind ? SUPPLY_QTY_LABEL[kind.id] : 'Quantity', e.qty),
    ...(e.kind === 'delivery' && open.includes('on_hand_after')
      ? [field('on_hand_after', 'On hand after the delivery', e.onHandAfter, 'A number, or leave it empty.')] : []),
    field('category', 'Category', e.category),
    field('note', 'Note', e.note),
  ]
}

const REPAIR_STATUSES = ['New', 'In Progress', 'On Hold', 'Completed', 'Cancelled']
const URGENCY_LEVELS = ['1', '2', '3', '4', '5']

/** The status first; the house and the filing time drawn locked with no words under them. */
export function repairEditFields(r: LocationRepair, types: string[]): EditField[] {
  const raw = (k: string) => str(r.raw[k])
  return [
    { key: 'status', label: 'Status', kind: 'select', raw: raw('status'), options: REPAIR_STATUSES },
    { key: 'select_address_vehicle', label: 'House or vehicle', kind: 'text', raw: r.house, lockedBy: {} },
    { key: 'timestamp', label: 'Reported', kind: 'text', raw: raw('timestamp'), lockedBy: {} },
    { key: 'repair_type', label: 'Repair type', kind: 'select', raw: raw('repair_type'), options: types },
    { key: 'urgency_level', label: 'Urgency', kind: 'select', raw: raw('urgency_level'), options: URGENCY_LEVELS },
    { key: 'please_describe_the_issue', label: 'The issue', kind: 'textarea', raw: raw('please_describe_the_issue') },
    { key: 'resolution_notes', label: 'Resolution notes', kind: 'textarea', raw: raw('resolution_notes') },
  ]
}

const INCIDENT_EDIT: { key: string; label: string; long?: boolean }[] = [
  { key: 'your_name', label: 'Your name' },
  { key: 'client_name', label: 'Client' },
  { key: 'incident_category', label: 'Category' },
  { key: 'incident_location', label: 'Location' },
  { key: 'incident_date', label: 'Incident date' },
  { key: 'incident_time', label: 'Incident time' },
  ...INCIDENT_DETAIL_FIELDS.map((f) => ({ ...f, long: !/date|time/.test(f.key) && f.key !== 'employees_involved' })),
]

export function incidentEditFields(r: LocationIncident): EditField[] {
  return [
    { key: 'timestamp', label: 'Filed', kind: 'text', raw: r.row.timestamp ?? '', lockedBy: FILED_AS_FILED },
    ...INCIDENT_EDIT.map((f): EditField => ({ key: f.key, label: f.label, kind: f.long ? 'textarea' : 'text', raw: r.row[f.key] ?? '' })),
  ]
}
