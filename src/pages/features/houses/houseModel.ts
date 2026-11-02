// The Houses page's shapes (server/house_slices.py) and the arithmetic the screen does on them.
// Pure — the page and the tests import the same code.
import { addDays, format } from 'date-fns'
import { ohioWall } from '@/lib/ohio'
import { thumbFor } from '@/lib/thumbs'
import { clientHref, nameKey as clientNameKey } from '@/pages/features/clientprofiles/clientModel'

/** A house's client opened in the Clients app's own profile: by its key, else its folded name. */
export const clientProfileHref = (c: Pick<HouseClient, 'name' | 'client_key'>): string =>
  clientHref(c.client_key || clientNameKey(c.name))

export type HousePhoto = { src: string; source: string }
export type HouseManager = { name: string; phone: string; avatar?: string; phone_known?: boolean; phone_why?: string; last_day: string }
export type HouseLead = { name: string; last_day: string }
export type HouseClient = { name: string; client_id?: string; client_key?: string; avatar?: string }
export type HouseStaff = { name: string; shifts: number; last_day: string; avatar?: string; hm?: boolean; lead?: boolean }
export type HousePolicy = { title: string; url: string; drive_id?: string; in_app_doc?: string; audience: string }
export type HouseSource = {
  key: string
  label: string
  book?: string
  tab?: string
  rows?: number
  read_at?: string
  state: 'fresh' | 'stale' | 'unreadable'
  why?: string
}
export type Span = { from: string; to: string }

export type HouseRow = {
  id: string
  code: string
  label: string
  title: string
  city: string
  short?: string
  calendar_location?: string
  active: boolean
  active_why?: string
  address: string
  address_why?: string
  photo: HousePhoto
  managers: HouseManager[]
  managers_why?: string
  leads: HouseLead[]
  clients: HouseClient[]
  client_count: number
  staff: HouseStaff[]
  staff_source: '' | 'psi' | 'calendar'
  staff_label?: string
  staff_why?: string
  staff_window?: Span
  staff_gaps?: Span[]
  week_notes: string[]
  policies: HousePolicy[]
  sources: HouseSource[]
}

/** What /hub-lanes/houses/mine hands a client or guardian. */
export type ClientHouse = {
  code: string
  title: string
  label: string
  city: string
  address: string
  photo: HousePhoto
  managers: HouseManager[]
  managers_why?: string
  you: HouseClient[]
  resident_count: number
  policies: HousePolicy[]
  sources: HouseSource[]
}

export type ShiftRow = {
  staff: string
  house: string
  date: string
  start: string
  end: string
  status: string
  houseCode: string
}

export type Clock = { today: string; weekEnd: string; now: number }

const CODE = /([A-Z]{2,4}\d{3,6})\s*$/

/** 'CAN - NW - NW4045' or 'nw4045' → 'NW4045'; '' when nothing ends in a code. */
export function codeIn(text: string): string {
  const m = CODE.exec(String(text ?? '').trim().toUpperCase())
  return m ? m[1] : ''
}

/** The row a `?house=` names — by its exact code, never by a street number. */
export function resolveHouse<T extends { code: string }>(param: string, rows: T[]): T | null {
  const code = codeIn(param)
  if (!code) return null
  return rows.find((r) => String(r.code).toUpperCase() === code) ?? null
}

/** The grid: active houses only, by title, narrowed by a search over what a card shows. */
export function gridHouses(rows: HouseRow[], query = ''): HouseRow[] {
  const q = query.trim().toLowerCase()
  return rows
    .filter((h) => h.active)
    .filter((h) => !q || [h.title, h.address, ...h.managers.map((m) => m.name), ...h.clients.map((c) => c.name)]
      .some((v) => String(v ?? '').toLowerCase().includes(q)))
    .sort((a, b) => a.title.localeCompare(b.title))
}

/** The sources' health (a book stale, the slice's build failed) is shown to the master and the platform lead only. */
export function seesSourceHealth(viewer: { isMaster: boolean; types: readonly string[] } | null): boolean {
  return !!viewer && (viewer.isMaster || viewer.types.some((t) => String(t).trim().toUpperCase() === 'PLATFORMLEAD'))
}

/** Sources that are not fresh, once each (every row carries the same list). */
export function staleSources(sources: HouseSource[] | undefined): HouseSource[] {
  const seen = new Set<string>()
  return (sources ?? []).filter((s) => {
    if (s.state === 'fresh' || seen.has(s.key)) return false
    seen.add(s.key)
    return true
  })
}

/** Every row with the slice's own failed build named as a stale source — the file served is the last good one. */
export function withBuildError(rows: HouseRow[], error: string): HouseRow[] {
  if (!error) return rows
  const build: HouseSource = {
    key: 'build', label: 'The houses slice', state: 'stale',
    why: `its last build failed (${error}), so this is the copy built before it`,
  }
  return rows.map((h) => ({ ...h, sources: [...(h.sources ?? []), build] }))
}

/** A client's line on what may be behind — the parts, never a book or a reason. */
export function clientStaleLine(sources: HouseSource[] | undefined): string {
  const stale = staleSources(sources)
  if (stale.some((s) => s.key === 'build')) return 'This page may be out of date.'
  return stale.length ? `Some of this may be out of date: ${stale.map((s) => s.label).join(', ')}.` : ''
}

export function clockFor(today: string, now: Date = new Date()): Clock {
  const wall = ohioWall(now)
  const day = ohioWall(today)
  return {
    today,
    weekEnd: day ? format(addDays(day, 6), 'yyyy-MM-dd') : today,
    now: wall ? wall.getHours() * 60 + wall.getMinutes() : 0,
  }
}

function hhmm(v: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(v ?? '').trim())
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}

export type HouseDay = {
  today: number
  onDuty: string[]
  covered: number
  roster: { staff: string; when: string; status: string }[]
}

/** Today, who is on duty now, the days covered this week and the next ten shifts — from the shifts slice; null when it was not read. */
export function houseDay(code: string, shifts: ShiftRow[] | null, clock: Clock): HouseDay | null {
  if (!shifts) return null
  const mine = shifts.filter((s) => String(s.houseCode ?? '').trim() === code)
  const todays = mine.filter((s) => s.date === clock.today)
  const onDuty = [...new Set(todays.filter((s) => {
    const st = hhmm(s.start)
    const et = hhmm(s.end)
    if (st === null || et === null) return false
    return (st <= clock.now && clock.now < et) || (et < st && (clock.now >= st || clock.now < et))
  }).map((s) => s.staff).filter(Boolean))].sort()
  const week = mine.filter((s) => s.date >= clock.today && s.date <= clock.weekEnd)
  const roster = mine
    .filter((s) => s.date >= clock.today)
    .sort((a, b) => a.date.localeCompare(b.date) || (hhmm(a.start) ?? 1440) - (hhmm(b.start) ?? 1440))
    .slice(0, 10)
    .map((s) => {
      const d = ohioWall(s.date)
      return {
        staff: s.staff || '—',
        when: [d ? format(d, 'EEE, MMM d') : s.date, [s.start, s.end].filter(Boolean).join('–')].filter(Boolean).join(' '),
        status: String(s.status ?? '').trim(),
      }
    })
  return { today: todays.length, onDuty, covered: new Set(week.map((s) => s.date)).size, roster }
}

export type Band = { houses: number; clients: number; staffWeek: number | null; stale: HouseSource[] }

/** The summary band: active houses, their clients, the staff on their roster this week (null when the roster was not read), what is stale. */
export function band(rows: HouseRow[], shifts: ShiftRow[] | null, clock: Clock): Band {
  const active = rows.filter((h) => h.active)
  const codes = new Set(active.map((h) => h.code))
  const staff = shifts && new Set(shifts
    .filter((s) => codes.has(String(s.houseCode ?? '').trim()) && s.date >= clock.today && s.date <= clock.weekEnd)
    .map((s) => String(s.staff ?? '').trim().toLowerCase())
    .filter(Boolean))
  return {
    houses: active.length,
    clients: active.reduce((n, h) => n + (h.client_count || 0), 0),
    staffWeek: staff ? staff.size : null,
    stale: staleSources(rows[0]?.sources),
  }
}

/** One shape for the house page, whoever reads it. A client's view has no staff and names only themselves. */
export type DetailView = {
  code: string
  title: string
  city: string
  address: string
  addressWhy: string
  photo: HousePhoto
  managers: HouseManager[]
  managersWhy: string
  leads: HouseLead[]
  people: HouseClient[]
  peopleNote: string
  policies: HousePolicy[]
  staff: Pick<HouseRow, 'staff' | 'staff_source' | 'staff_label' | 'staff_why' | 'staff_window' | 'staff_gaps'> | null
  weekNotes: string[]
  calendarLocation: string
  sources: HouseSource[]
}

export function fromRow(h: HouseRow): DetailView {
  return {
    code: h.code, title: h.title, city: h.city,
    address: h.address, addressWhy: h.address_why ?? '',
    photo: h.photo, managers: h.managers, managersWhy: h.managers_why ?? '', leads: h.leads ?? [],
    people: h.clients, peopleNote: h.clients.length ? '' : 'No active client in the Asa Client Database.',
    policies: h.policies,
    staff: { staff: h.staff, staff_source: h.staff_source, staff_label: h.staff_label, staff_why: h.staff_why,
             staff_window: h.staff_window, staff_gaps: h.staff_gaps },
    weekNotes: h.week_notes ?? [], calendarLocation: h.calendar_location ?? '', sources: h.sources ?? [],
  }
}

export function fromClient(c: ClientHouse): DetailView {
  const others = Math.max(0, (c.resident_count || 0) - c.you.length)
  return {
    code: c.code, title: c.title, city: c.city,
    address: c.address, addressWhy: '',
    photo: c.photo, managers: c.managers, managersWhy: c.managers_why ?? '', leads: [],
    people: c.you,
    peopleNote: others ? `and ${others} other resident${others === 1 ? '' : 's'}` : '',
    policies: c.policies.filter((p) => p.audience === 'all'),
    staff: null, weekNotes: [], calendarLocation: '', sources: c.sources ?? [],
  }
}

/** A small copy for a card: the Image Bank's webp thumb, or a registry photo asked for at a width. */
export function photoThumb(src: string, width = 640): string {
  if (/^https:\/\/lh3\.googleusercontent\.com\/d\/[^=/?#]+$/.test(src)) return `${src}=w${width}`
  return thumbFor(src)
}

/** An ISO day → 'MMM d'. */
export function shortDay(iso: string): string {
  const d = ohioWall(iso)
  return d ? format(d, 'MMM d') : iso
}

/** The line under the staff list: which record it came from, over which days, and its holes. */
export function staffCaption(h: Pick<HouseRow, 'staff_source' | 'staff_label' | 'staff_why' | 'staff_window' | 'staff_gaps'>): string {
  const span = h.staff_window ? `${shortDay(h.staff_window.from)} → ${shortDay(h.staff_window.to)}` : ''
  const parts: string[] = []
  if (h.staff_source) parts.push([h.staff_label, span].filter(Boolean).join(', '))
  if (h.staff_why) parts.push(h.staff_source === 'calendar' ? `Not from the punches: ${h.staff_why}` : h.staff_why)
  for (const g of h.staff_gaps ?? []) parts.push(`No punches on record ${shortDay(g.from)} → ${shortDay(g.to)}`)
  return parts.join(' · ')
}
