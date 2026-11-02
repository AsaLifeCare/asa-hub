// What the three client views share: the row's shape, the date helpers that CUT and never parse, and the incident…
// One module, three screens — Directory's engine panel aside, a fact about a client is computed once.
import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '@/lib/api'
import { ohioWall } from '@/lib/ohio'

export type ClientAppointment = {
  id: string
  date: string
  time?: string
  title: string
  doctor?: string
  location?: string
  notes?: string
  status?: string
}

// One row of the `clients` slice — the shape Clients.gs builds.
export type ClientRow = {
  id: string
  name: string
  client_key?: string
  clientNumber?: string
  avatar?: string
  status?: string
  isp_year?: string
  isp_doc_url?: string
  isp_doc_name?: string
  /** only ever from a typed clients-tab row — the ISPs do not name a house */
  houseName?: string
  supervision_level?: string
  supervisionShort?: string
  contacts?: string
  conditions?: string[]
  allergies?: string[]
  medications?: string[]
  appointments?: ClientAppointment[]
  recentAppointments?: ClientAppointment[]
  summary?: string
  source_file?: string
  allergies_text?: string
  diagnoses_text?: string
  medications_text?: string
  care_communication?: string
  care_safety?: string
  care_daily_living?: string
  care_behavioral?: string
  care_nutrition?: string
  goals_outcomes?: string
  important_to?: string
  important_for?: string
  /* demographics — off the plan's own Contact Information page */
  dob?: string
  home_address?: string
  county?: string
  client_phone?: string
  client_email?: string
  sex?: string
  marital_status?: string
  medicaid_id?: string
  dodd_id?: string
  funding_source?: string
  best_contact?: string
  guardian_name?: string
  guardianName?: string
  guardian_phone?: string
  /** surfaced from the plan's Important People table */
  guardian_email?: string
  ssa_name?: string
  ssa_phone?: string
  ssa_email?: string
  emergency_name?: string
  emergency_phone?: string
}


export type IncidentRow = Record<string, unknown>


export function dayOf(v: unknown): string {
  const s = String(v ?? '').trim()
  const iso = /^(\d{4}-\d{2}-\d{2})(?:[T\s]|$)/.exec(s)
  if (iso) return iso[1]
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s)
  if (us) return `${us[3]}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}`
  return ''
}

// Today, and the day N days back, as OHIO days — the whole platform keeps Ohio's timezone.
export function todayIso(): string {
  return ohioDayIso(0)
}

export function daysAgoIso(n: number): string {
  return ohioDayIso(-n)
}

function ohioDayIso(offset: number): string {
  const d = ohioWall(new Date()) as Date
  d.setDate(d.getDate() + offset)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December']
export const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** 'August 4th, 1961' — the birthday spelling, built from the ISO parts. */
export function longBirthday(v: unknown): string {
  const iso = dayOf(v)
  if (!iso) return String(v ?? '').trim()
  const [y, m, d] = iso.split('-')
  const n = Number(d)
  const suffix = n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'
  return `${MONTHS[Number(m) - 1]} ${n}${suffix}, ${y}`
}

// 'Tue, Sep 29, 2026' — weekday from the ISO parts via a UTC construction used ONLY to name the weekday, never to…
export function longDay(v: unknown): string {
  const iso = dayOf(v)
  if (!iso) return String(v ?? '').trim()
  const [y, m, d] = iso.split('-').map(Number)
  const wd = DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]
  return `${wd}, ${MONTHS[m - 1].slice(0, 3)} ${d}, ${y}`
}

/** '11:00 AM' out of whatever the sheet wrote, by reading its parts. */
export function clockOf(v: unknown): string {
  const s = String(v ?? '').trim()
  if (!s) return ''
  const m = /(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp][Mm])?/.exec(s)
  if (!m) return ''
  let h = Number(m[1])
  const mer = m[3]?.toUpperCase()
  if (mer === 'PM' && h < 12) h += 12
  if (mer === 'AM' && h === 12) h = 0
  const ampm = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${m[2]} ${ampm}`
}

/** letters and digits only — the key Clients.gs joins names on. */
export function nameKey(v: unknown): string {
  return String(v ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
}


export function useIncidents(clientName: string, enabled: boolean) {
  const [state, setState] = useState<{ rows: IncidentRow[] | null; err: string }>({ rows: null, err: '' })
  const started = useRef(false)
  const { rows, err } = state

  useEffect(() => {
    if (!enabled || started.current) return
    started.current = true
    let alive = true
    api
      .list<IncidentRow>('incidents')
      .then((r) => { if (alive) setState({ rows: r ?? [], err: '' }) })
      .catch((e) => {
        if (alive) setState({ rows: null, err: e instanceof Error ? e.message : 'The incident log could not be read.' })
      })
    return () => { alive = false }
  }, [enabled])

  const key = nameKey(clientName)
  const mine = useMemo(() => {
    if (!rows) return []
    return rows
      .filter((r) => !!key && nameKey(r.client ?? r.clientName ?? r.client_name ?? r.name) === key)
      .sort((a, b) => dayOf(b.date ?? b.occurredAt).localeCompare(dayOf(a.date ?? a.occurredAt)))
  }, [rows, key])

  const initialsOnly = useMemo(() => {
    if (!rows?.length || mine.length) return false
    const named = rows.map((r) => String(r.client ?? r.clientName ?? r.client_name ?? '').trim()).filter(Boolean)
    return named.length > 0 && named.every((n) => /^([A-Za-z]\.\s*){1,3}$/.test(n) || n.length <= 4)
  }, [rows, mine.length])

  return { mine, err, loaded: !!rows, busy: enabled && !rows && !err, initialsOnly }
}

export function incidentBits(r: IncidentRow) {
  return {
    day: dayOf(r.date ?? r.occurredAt),
    clock: clockOf(r.time ?? r.occurredAt ?? r.date),
    category: String(r.category ?? r.type ?? 'Unspecified'),
    place: String(r.location ?? r.house ?? ''),
    by: String(r.reportedBy ?? r.reported_by ?? ''),
    text: String(r.description ?? r.summary ?? r.narrative ?? ''),
  }
}


/** 'Barbara Mayle' -> 'BM'. Two letters, first and last name. */
export function initialsOf(name: string): string {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean)
  if (parts.length < 2) return ''
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

// Which house calendar belongs to this client.
export function houseForClient(client: ClientRow, houses: string[], everyone: ClientRow[]): string {
  const ini = initialsOf(client.name)
  if (!ini) return ''
  const sameInitials = everyone.filter((c) => initialsOf(c.name) === ini)
  if (sameInitials.length !== 1) return ''
  const matches = houses.filter((h) => {
    const bare = h.trim().toUpperCase()
    return bare === ini || new RegExp(`^${ini}\\d+$`).test(bare)
  })
  return matches.length === 1 ? matches[0] : ''
}

// The distinct houses the roster actually runs, read from the slice the Shift Board already serves — no execution…
export function useHouses(enabled: boolean) {
  const [houses, setHouses] = useState<string[]>([])
  const started = useRef(false)
  useEffect(() => {
    if (!enabled || started.current) return
    started.current = true
    let alive = true
    api
      .list<{ house?: string }>('shifts')
      .then((rows) => {
        if (!alive) return
        const seen = new Set<string>()
        for (const r of rows ?? []) {
          const h = String(r.house ?? '').trim()
          if (h) seen.add(h)
        }
        setHouses([...seen])
      })
      // A roster we cannot read means no calendar link — never a wrong one.
      .catch(() => { if (alive) setHouses([]) })
    return () => { alive = false }
  }, [enabled])
  return houses
}

