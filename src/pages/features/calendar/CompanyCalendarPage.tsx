// THE COMPANY CALENDAR: one full-screen month, the whole company's time — every house's shifts, the hiring…
// A day never fits everything, so CLICKING a day opens the whole day as a list, grouped by kind.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ohioDayYear, ohioTime, ohioWall } from '@/lib/ohio'
import {
  Cake, CalendarDays, ChevronLeft, ChevronRight, ClipboardList, Clock,
  FileText, GraduationCap, Image as ImageIcon, Loader2, Mail, Paperclip,
  Kanban, PhoneOff, RefreshCw, Stethoscope, Users, Van, Wrench, X,
} from 'lucide-react'
import { api } from '@/lib/api'
import { TRACKER_OWN_ONLY, isTrackerOwnOnly } from '@/lib/certUploads'
import { fileToBase64, gasAction, humanSize, inferMime, MAX_UPLOAD_BYTES } from '@/features/hiring/shared'
import { onSliceChange } from '@/lib/snapshotClient'
import { useAuthStore } from '@/auth/useAuthStore'
import { openFile } from '@/stores/useFileViewerStore'
import { toast } from '@/stores/useToastStore'
import { TASK_ATTACH_ACCEPT } from '@/lib/taskAttachments'
import { dayForecast, keptForecast, loadForecast, type Forecast } from '@/lib/weather'
import WeatherGlyph, { weatherLabel } from '@/components/shared/WeatherGlyph'
import { TINT_BG, TINT_FG } from '@/lib/tints'
import { cn } from '@/lib/utils'

// ------------------------------------------------------------------ shapes…

type SliceEvent = { id: string; title: string; personName?: string; date: string; start?: string; durationMin?: number | string; type: string; notes?: string }
type CertRow = { id: string; personName: string; certName: string; status: string; expiresAt: string }
type ClientRow = { id: string; name: string; dob?: string }
type DrApptRow = { id: string; status?: string; client: string; dr_name?: string; specialist?: string; next_visit?: string; address?: string }
type CallOffRow = { id: string; employee_name?: string; date?: string; type?: string; how_late?: string; notes?: string }
type UiIncidentRow = { id: string; client_name?: string; incident_category?: string; incident_location?: string; incident_date?: string; incident_time?: string }
type WorkOrderRow = { id: string; status?: string; timestamp?: string; select_address_vehicle?: string; repair_type?: string; urgency_level?: string; please_describe_the_issue?: string }
type HiringEvent = { candidate_id: string; name: string; type_label: string; date: string; time: string; location?: string; with_name?: string }
type Send = { date: string; at: string; situation: string; person: string; channel: string }
type StaffBirthday = { name: string; md: string }
type ServerData = { hiring: HiringEvent[]; sends: Send[]; staff_birthdays: StaffBirthday[] }
// One file pinned to a day — the company's, listed for everyone.
type CalFile = {
  id: string; date: string; name: string; url: string; mime: string; by: string; at: string
  shared?: boolean; shared_why?: string
}

/** One normalized entry on the grid. */
type CalEntry = {
  kind: 'shift' | 'hiring' | 'training' | 'birthday' | 'message' | 'event' | 'drappt' | 'calloff' | 'uireport' | 'repair' | 'kantask' | 'transport'
  date: string           // YYYY-MM-DD
  label: string          // chip text
  detail: string         // the day drawer's fuller line
  time?: string
  danger?: boolean       // e.g. an EXPIRED training
}

type CalTask = {
  id: string; title?: string; dueDate?: string; column?: string
  priority?: string; assignee?: string; client?: string; projectId?: string
}
type RouteRow = {
  id: string; date?: string; time?: string; driver?: string
  vehicle?: string; origin?: string; destination?: string
}

const KINDS = [
  { id: 'shift', label: 'Shifts', icon: Clock, tint: 'blue' },
  { id: 'hiring', label: 'Hiring', icon: Users, tint: 'lavender' },
  { id: 'training', label: 'Trainings', icon: GraduationCap, tint: 'amber' },
  { id: 'birthday', label: 'Birthdays', icon: Cake, tint: 'pink' },
  { id: 'message', label: 'Messages', icon: Mail, tint: 'mint' },
  { id: 'event', label: 'Events', icon: CalendarDays, tint: 'peach' },
  // four more of the company's rhythms
  { id: 'drappt', label: 'Dr appts', icon: Stethoscope, tint: 'green' },
  { id: 'calloff', label: 'Call offs', icon: PhoneOff, tint: 'danger' },
  { id: 'uireport', label: 'UI reports', icon: ClipboardList, tint: 'slate' },
  { id: 'repair', label: 'Repairs', icon: Wrench, tint: 'info' },
  // the board and the routes are company rhythms too
  { id: 'kantask', label: 'Kanban', icon: Kanban, tint: 'violet' },
  { id: 'transport', label: 'Transport', icon: Van, tint: 'peach' },
] as const
type KindId = (typeof KINDS)[number]['id']
const KIND_META = Object.fromEntries(KINDS.map((k) => [k.id, k])) as Record<KindId, (typeof KINDS)[number]>

// ------------------------------------------------------------------ the kept copy — instant paint, background…

function readKept<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? ((JSON.parse(raw) as { v: T }).v ?? null) : null
  } catch { return null }
}
function keep(key: string, v: unknown) {
  try { localStorage.setItem(key, JSON.stringify({ v, at: new Date().toISOString() })) }
  catch { /* storage full — the next open just fetches */ }
}
/** The certification expiries' kept copy — only ever a whole answer, which only the master is given. */
const CERTS_KEPT = 'asa:cal:certs-all'
/** Where they were kept before the tracker had a door of its own: never read, only removed. */
const CERTS_KEPT_BEFORE = 'asa:cal:certs'

/** Local YYYY-MM-DD, never through Date parsing of foreign strings. */
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// A day out of a foreign string, judged by SHAPE — ISO prefix or US M/D/YYYY — never through the browser's Date…
function dayOf(v?: string): string {
  const s = String(v ?? '').trim()
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  const us = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/.exec(s)
  if (us) return `${us[3]}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}`
  return ''
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const DOW = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']

// The kept copy is a WINDOW, not the archive: the events slice once weighed 26MB and `keep`'s setItem quietly blew…
const CAL_KEEP_MS = 70 * 24 * 3600 * 1000
const calKeepWindow = (date: string) => {
  const t = Date.parse(date)
  return Number.isFinite(t) && Math.abs(t - Date.now()) <= CAL_KEEP_MS
}

/* ------------------------------------------------------------------ */

export default function CompanyCalendarPage() {
  const role = useAuthStore((s) => s.user?.role)
  // the company's today, and the month it opens on
  const today = ymd(ohioWall(new Date()) as Date)
  const [anchor, setAnchor] = useState(() => { const d = ohioWall(new Date()) as Date; return { y: d.getFullYear(), m: d.getMonth() } })
  const monthKey = `${anchor.y}-${String(anchor.m + 1).padStart(2, '0')}`

  // filters — per user, per browser
  const [hidden, setHidden] = useState<Set<KindId>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem('asa:calendar-filters') ?? '[]') as KindId[]) }
    catch { return new Set() }
  })
  const toggleKind = (k: KindId) => {
    setHidden((prev) => {
      const next = new Set(prev)
      if (next.has(k)) next.delete(k)
      else next.add(k)
      try { localStorage.setItem('asa:calendar-filters', JSON.stringify([...next])) } catch { /* fine */ }
      return next
    })
  }

  // ---- the slices (shifts+events, trainings, client birthdays) ----
  const [events, setEvents] = useState<SliceEvent[] | null>(() => readKept<SliceEvent[]>('asa:cal:events'))
  // every person's expiries are the master's (Certs.gs certTrackerList): only a whole answer is kept, under a key…
  const [certs, setCerts] = useState<CertRow[] | null>(() => readKept<CertRow[]>(CERTS_KEPT))
  /** why the expiries are not on the grid; '' when they are */
  const [certsWhy, setCertsWhy] = useState('')
  useEffect(() => {
    try { localStorage.removeItem(CERTS_KEPT_BEFORE) } catch { /* nothing was kept */ }
  }, [])
  const [clients, setClients] = useState<ClientRow[] | null>(() => readKept<ClientRow[]>('asa:cal:clients'))
  const [drAppts, setDrAppts] = useState<DrApptRow[] | null>(() => readKept<DrApptRow[]>('asa:cal:drappts'))
  const [callOffs, setCallOffs] = useState<CallOffRow[] | null>(() => readKept<CallOffRow[]>('asa:cal:calloffs'))
  const [uiReports, setUiReports] = useState<UiIncidentRow[] | null>(() => readKept<UiIncidentRow[]>('asa:cal:uireports'))
  const [repairs, setRepairs] = useState<WorkOrderRow[] | null>(() => readKept<WorkOrderRow[]>('asa:cal:repairs'))
  const [kanTasks, setKanTasks] = useState<CalTask[] | null>(() => readKept<CalTask[]>('asa:cal:kantasks'))
  const [routes, setRoutes] = useState<RouteRow[] | null>(() => readKept<RouteRow[]>('asa:cal:routes'))
  const loadSlices = useCallback(() => {
    api.list<SliceEvent>('events').then((r) => {
      const rows = r ?? []
      setEvents(rows)
      keep('asa:cal:events', rows.filter((e) => calKeepWindow(String((e as { date?: string }).date ?? ''))))
    }).catch(() => {})
    api.list<CertRow>('staffCerts').then((r) => { setCerts(r ?? []); setCertsWhy(''); keep(CERTS_KEPT, r ?? []) }).catch((e) => {
      // an own answer is one person's rows: no company expiries are drawn, and the grid says why
      if (!isTrackerOwnOnly(e)) return
      setCerts([])
      setCertsWhy(TRACKER_OWN_ONLY)
      keep(CERTS_KEPT, null)
    })
    api.list<ClientRow>('clients').then((r) => { setClients(r ?? []); keep('asa:cal:clients', r ?? []) }).catch(() => {})
    api.list<DrApptRow>('drAppointments').then((r) => { setDrAppts(r ?? []); keep('asa:cal:drappts', r ?? []) }).catch(() => {})
    api.list<CallOffRow>('callOffs').then((r) => { setCallOffs(r ?? []); keep('asa:cal:calloffs', r ?? []) }).catch(() => {})
    api.list<UiIncidentRow>('uiIncidents').then((r) => { setUiReports(r ?? []); keep('asa:cal:uireports', r ?? []) }).catch(() => {})
    api.list<WorkOrderRow>('workOrders').then((r) => { setRepairs(r ?? []); keep('asa:cal:repairs', r ?? []) }).catch(() => {})
    api.list<CalTask>('teamTasks').then((r) => { setKanTasks(r ?? []); keep('asa:cal:kantasks', r ?? []) }).catch(() => {})
    api.list<RouteRow>('routes').then((r) => { setRoutes(r ?? []); keep('asa:cal:routes', r ?? []) }).catch(() => {})
  }, [])

  // ---- the declared read (hiring, sends, staff birthdays) ----
  const [server, setServer] = useState<ServerData | null>(() => readKept<ServerData>(`asa:cal:server:${monthKey}`))
  const [serverAt, setServerAt] = useState(0)
  // month changed → adopt that month's kept copy DURING render (the React way; a setState inside the effect would…
  const [serverMonth, setServerMonth] = useState(monthKey)
  if (serverMonth !== monthKey) {
    setServerMonth(monthKey)
    setServer(readKept<ServerData>(`asa:cal:server:${monthKey}`))
  }
  const loadServer = useCallback(() => {
    const first = `${monthKey}-01`
    const last = ymd(new Date(anchor.y, anchor.m + 1, 0))
    gasAction<ServerData>('companyCalendar', { from: first, to: last })
      .then((d) => { setServer(d); keep(`asa:cal:server:${monthKey}`, d); setServerAt(Date.now()) })
      .catch(() => { /* the kept copy stands */ })
  }, [anchor.y, anchor.m, monthKey])

  // ---- the day files (the company's attachments, one list per month) ----
  const [dayFiles, setDayFiles] = useState<CalFile[] | null>(() => readKept<CalFile[]>(`asa:cal:files:${monthKey}`))
  const [filesMonth, setFilesMonth] = useState(monthKey)
  if (filesMonth !== monthKey) {
    setFilesMonth(monthKey)
    setDayFiles(readKept<CalFile[]>(`asa:cal:files:${monthKey}`))
  }
  const loadFiles = useCallback(() => {
    const first = `${monthKey}-01`
    const last = ymd(new Date(anchor.y, anchor.m + 1, 0))
    gasAction<{ files: CalFile[] }>('calendarDayFilesList', { from: first, to: last })
      .then((d) => { setDayFiles(d.files ?? []); keep(`asa:cal:files:${monthKey}`, d.files ?? []) })
      .catch(() => { /* the kept copy stands */ })
  }, [anchor.y, anchor.m, monthKey])
  const filesOf = useCallback(
    (d: string) => (dayFiles ?? []).filter((f) => f.date === d),
    [dayFiles],
  )

  // ---- the sky (one shared forecast, relay-cached) ----
  const [forecast, setForecast] = useState<Forecast | null>(() => keptForecast())
  useEffect(() => { loadForecast().then((f) => { if (f) setForecast(f) }) }, [])

  useEffect(() => { loadSlices() }, [loadSlices])
  useEffect(() => { loadServer() }, [loadServer])
  useEffect(() => { loadFiles() }, [loadFiles])

  // SSE-like, the house way: the slice bell re-reads slices; focus refetches the declared read when it has gone…
  useEffect(() => onSliceChange((res) => {
    if (['events', 'shifts', 'staffCerts', 'clients', 'drAppointments', 'callOffs', 'uiIncidents', 'workOrders'].includes(res)) loadSlices()
  }), [loadSlices])
  useEffect(() => {
    const wake = () => {
      if (document.visibilityState !== 'visible') return
      if (Date.now() - serverAt > 60_000) { loadServer(); loadSlices(); loadFiles() }
      loadForecast().then((f) => { if (f) setForecast(f) })
    }
    window.addEventListener('focus', wake)
    document.addEventListener('visibilitychange', wake)
    return () => { window.removeEventListener('focus', wake); document.removeEventListener('visibilitychange', wake) }
  }, [loadServer, loadSlices, loadFiles, serverAt])

  // ---- normalize everything onto the month ----
  const byDay = useMemo(() => {
    const map = new Map<string, CalEntry[]>()
    const push = (e: CalEntry) => {
      if (!e.date.startsWith(monthKey)) return
      const list = map.get(e.date) ?? []
      list.push(e)
      map.set(e.date, list)
    }
    for (const ev of events ?? []) {
      const isShift = ev.type === 'shift'
      push({
        kind: isShift ? 'shift' : 'event',
        date: String(ev.date).slice(0, 10),
        time: ev.start,
        label: isShift ? `${ev.title} · ${ev.personName ?? ''}`.trim() : ev.title,
        detail: `${ev.start ? ev.start + ' · ' : ''}${ev.title}${ev.personName ? ' — ' + ev.personName : ''}${ev.notes ? ' · ' + ev.notes : ''}`,
      })
    }
    for (const c of certs ?? []) {
      // an expiry is stored as a full stamp; cutting its first ten characters takes the UTC day and can park a…
      const cw = ohioWall(String(c.expiresAt ?? ''))
      const d = cw ? ymd(cw) : ''
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue
      push({
        kind: 'training',
        date: d,
        label: `${c.certName} · ${c.personName}`,
        detail: `${c.certName} ${d < today ? 'EXPIRED' : 'expires'} — ${c.personName}`,
        danger: d < today || c.status === 'expired',
      })
    }
    for (const cl of clients ?? []) {
      const md = String(cl.dob ?? '').slice(5, 10)
      if (!/^\d{2}-\d{2}$/.test(md)) continue
      push({ kind: 'birthday', date: `${monthKey.slice(0, 4)}-${md}`, label: `🎂 ${cl.name}`, detail: `${cl.name}'s birthday (client)` })
    }
    for (const b of server?.staff_birthdays ?? []) {
      if (!/^\d{2}-\d{2}$/.test(b.md)) continue
      push({ kind: 'birthday', date: `${monthKey.slice(0, 4)}-${b.md}`, label: `🎂 ${b.name}`, detail: `${b.name}'s birthday (staff)` })
    }
    for (const h of server?.hiring ?? []) {
      push({
        kind: 'hiring',
        date: String(h.date).slice(0, 10),
        time: h.time,
        label: `${h.type_label} · ${h.name}`,
        detail: `${h.time ? h.time + ' · ' : ''}${h.type_label} — ${h.name}${h.location ? ' · ' + h.location : ''}${h.with_name ? ' · with ' + h.with_name : ''}`,
      })
    }
    for (const s of server?.sends ?? []) {
      push({
        kind: 'message',
        date: s.date,
        time: ohioTime(s.at ?? ''),
        label: `${s.situation} → ${s.person}`,
        detail: `${ohioTime(s.at ?? '')} · ${s.situation} → ${s.person} (${s.channel})`.trim(),
      })
    }
    // the later additions — all slices, zero executions
    for (const a of drAppts ?? []) {
      if (String(a.status ?? 'Active').toLowerCase() !== 'active') continue
      const d = dayOf(a.next_visit)
      if (!d) continue
      push({
        kind: 'drappt',
        date: d,
        label: `${a.client} · ${a.dr_name || a.specialist || 'Dr'}`,
        detail: `Dr appointment — ${a.client} with ${a.dr_name ?? 'their doctor'}${a.specialist ? ` (${a.specialist})` : ''}${a.address ? ` · ${a.address}` : ''}`,
      })
    }
    for (const c of callOffs ?? []) {
      const d = dayOf(c.date)
      if (!d) continue
      push({
        kind: 'calloff',
        date: d,
        label: `${c.type || 'Call Off'} · ${(c.employee_name ?? '').trim()}`,
        detail: `${c.type || 'Call Off'} — ${(c.employee_name ?? '').trim()}${c.how_late ? ` · ${c.how_late}` : ''}${c.notes ? ` · ${c.notes}` : ''}`,
      })
    }
    for (const u of uiReports ?? []) {
      const d = dayOf(u.incident_date)
      if (!d) continue
      push({
        kind: 'uireport',
        date: d,
        time: u.incident_time,
        label: `${u.incident_category || 'Incident'} · ${u.client_name ?? ''}`.trim(),
        detail: `${u.incident_time ? u.incident_time + ' · ' : ''}UI report — ${u.incident_category || 'incident'}${u.client_name ? ` · ${u.client_name}` : ''}${u.incident_location ? ` · ${u.incident_location}` : ''}`,
      })
    }
    for (const w of repairs ?? []) {
      const d = dayOf(w.timestamp)
      if (!d) continue
      const open = String(w.status ?? '').toLowerCase() !== 'completed'
      push({
        kind: 'repair',
        date: d,
        label: `${w.repair_type || 'Repair'} · ${w.select_address_vehicle ?? ''}`.trim(),
        detail: `House repair — ${w.repair_type || 'repair'} at ${w.select_address_vehicle ?? '?'}${w.please_describe_the_issue ? ` · ${w.please_describe_the_issue}` : ''}${w.status ? ` · ${w.status}` : ''}`,
        danger: open && String(w.urgency_level ?? '') >= '4',
      })
    }
    // every board task lands on its due date, and every booked route on its day — the Kanban's tasks and…
    for (const t of kanTasks ?? []) {
      const d = dayOf(t.dueDate)
      if (!d) continue
      if (['done', 'cancelled'].includes(String(t.column ?? '').toLowerCase())) continue
      push({
        kind: 'kantask',
        date: d,
        label: `☑ ${t.title || 'Untitled'}`,
        detail: `Kanban task — ${t.title || 'untitled'}${t.projectId ? '' : ''}${t.assignee ? ` · ${t.assignee}` : ''}${t.priority ? ` · ${t.priority}` : ''}${t.client ? ` · ${t.client}` : ''}`,
        danger: String(t.priority ?? '').toLowerCase() === 'high',
      })
    }
    for (const r of routes ?? []) {
      const d = dayOf(r.date)
      if (!d) continue
      push({
        kind: 'transport',
        date: d,
        time: r.time,
        label: `🚐 ${(r.driver ?? '').trim() || 'Route'}${r.destination ? ` → ${r.destination}` : ''}`,
        detail: `Transportation — ${(r.driver ?? '').trim() || 'route'}${r.vehicle ? ` · ${r.vehicle}` : ''}${r.origin ? ` · from ${r.origin}` : ''}${r.destination ? ` · to ${r.destination}` : ''}${r.time ? ` · ${r.time}` : ''}`,
      })
    }
    for (const list of map.values()) {
      list.sort((a, b) => (a.time ?? '') < (b.time ?? '') ? -1 : 1)
    }
    return map
  }, [events, certs, clients, drAppts, callOffs, uiReports, repairs, kanTasks, routes, server, monthKey, today])

  const visibleOf = useCallback(
    (d: string) => (byDay.get(d) ?? []).filter((e) => !hidden.has(e.kind)),
    [byDay, hidden],
  )

  const [openDay, setOpenDay] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  // the 6×7 grid
  const cells = useMemo(() => {
    const firstDow = new Date(anchor.y, anchor.m, 1).getDay()
    const daysIn = new Date(anchor.y, anchor.m + 1, 0).getDate()
    const out: (string | null)[] = []
    for (let i = 0; i < firstDow; i++) out.push(null)
    for (let d = 1; d <= daysIn; d++) out.push(`${monthKey}-${String(d).padStart(2, '0')}`)
    while (out.length % 7 !== 0) out.push(null)
    while (out.length < 42) out.push(null)
    return out
  }, [anchor, monthKey])

  const loading = events === null && certs === null && server === null

  if (role !== 'admin' && role !== 'manager') {
    return <p className="py-10 text-center text-[13px] italic text-text-3">The company calendar is for admins and managers for now.</p>
  }

  return (
    // the month takes the WHOLE viewport below the chrome, using all the space under it — the shell's main scrolls…
    <div className="flex h-[calc(100dvh-150px-2.5rem-var(--hub-strip-h,0px))] min-h-[480px] flex-col">
      {/* ── header: month, nav, filters ── */}
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h1 className="text-[17px] font-bold text-text-1">{MONTHS[anchor.m]} {anchor.y}</h1>
        <div className="flex items-center gap-1">
          <button onClick={() => setAnchor(({ y, m }) => (m === 0 ? { y: y - 1, m: 11 } : { y, m: m - 1 }))} className="grid h-7 w-7 place-items-center rounded-md border border-border text-text-2 hover:bg-surface-2"><ChevronLeft size={14} /></button>
          <button onClick={() => { const d = new Date(); setAnchor({ y: d.getFullYear(), m: d.getMonth() }) }} className="rounded-md border border-border px-2.5 py-1 text-[12px] font-semibold text-text-2 hover:bg-surface-2">Today</button>
          <button onClick={() => setAnchor(({ y, m }) => (m === 11 ? { y: y + 1, m: 0 } : { y, m: m + 1 }))} className="grid h-7 w-7 place-items-center rounded-md border border-border text-text-2 hover:bg-surface-2"><ChevronRight size={14} /></button>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {KINDS.map((k) => {
            const Icon = k.icon
            const off = hidden.has(k.id)
            return (
              <button
                key={k.id}
                onClick={() => toggleKind(k.id)}
                title={off ? `Show ${k.label}` : `Hide ${k.label}`}
                className={cn(
                  'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold transition-opacity',
                  TINT_BG[k.tint], TINT_FG[k.tint], 'border-transparent',
                  off && 'opacity-30',
                )}
              >
                <Icon size={11} /> {k.label}
              </button>
            )
          })}
          <button onClick={() => { loadSlices(); loadServer() }} title="Refresh" className="grid h-7 w-7 place-items-center rounded-md border border-border text-text-2 hover:bg-surface-2">
            {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
          </button>
        </div>
      </div>

      {/* the expiries this grid could not draw are said, never read as none */}
      {certsWhy && (
        <p className="mb-2 text-[11.5px] leading-4 text-text-3">Certification expiries: — {certsWhy}</p>
      )}

      {/* ── the grid takes ALL remaining height ── */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-border bg-surface">
        <div className="grid grid-cols-7 border-b border-border text-center text-[10.5px] font-bold uppercase tracking-wide text-text-3">
          {DOW.map((d) => <div key={d} className="py-1.5">{d}</div>)}
        </div>
        <div className="grid min-h-0 flex-1 grid-cols-7 grid-rows-6">
          {cells.map((date, i) => {
            const list = date ? visibleOf(date) : []
            const shown = list.slice(0, 3)
            return (
              <div
                key={i}
                onClick={date ? () => setOpenDay(date) : undefined}
                className={cn(
                  'min-h-0 overflow-hidden border-b border-r border-border/60 p-1 [&:nth-child(7n)]:border-r-0',
                  date ? 'cursor-pointer hover:bg-surface-2/60' : 'bg-surface-2/30',
                  // TODAY wears its own colour — violet, which no kind uses so today is painted a colour of its own
                  date === today && TINT_BG.violet,
                )}
              >
                {date && (
                  <>
                    <p className="mb-0.5 flex items-center justify-between gap-0.5">
                      {/* top-left: the sky over this day — a little sun, or
                          rain, or snow — plus the paperclip
                          when the company pinned files here */}
                      <span className="flex min-w-0 items-center gap-1 pl-0.5">
                        {(() => {
                          const wx = date >= today ? dayForecast(forecast, date) : null
                          if (!wx) return null
                          return (
                            <span
                              className="flex items-center gap-0.5"
                              title={`${weatherLabel(wx.icon)} · ${wx.tmax ?? '—'}° / ${wx.tmin ?? '—'}°${wx.rain >= 20 ? ` · ${wx.rain}% rain` : ''}`}
                            >
                              <WeatherGlyph icon={wx.icon} className="h-3 w-3" />
                              <span className="text-[9px] font-semibold leading-none text-text-3">{wx.tmax ?? ''}°</span>
                            </span>
                          )
                        })()}
                        {filesOf(date).length > 0 && (
                          <span className="flex items-center gap-px text-text-3" title={`${filesOf(date).length} attached file(s)`}>
                            <Paperclip className="h-2.5 w-2.5" />
                            <span className="text-[9px] font-semibold leading-none">{filesOf(date).length}</span>
                          </span>
                        )}
                      </span>
                      <span className={cn(
                        'inline-block rounded-md px-1 text-[11px] font-semibold',
                        date === today ? cn(TINT_FG.violet, 'font-bold') : 'text-text-3',
                      )}>
                        {Number(date.slice(8, 10))}
                      </span>
                    </p>
                    {shown.map((e, j) => (
                      <p
                        key={j}
                        className={cn(
                          'mb-0.5 truncate rounded px-1 py-0.5 text-[10px] font-semibold leading-3',
                          e.danger ? 'bg-danger/10 text-danger' : cn(TINT_BG[KIND_META[e.kind].tint], TINT_FG[KIND_META[e.kind].tint]),
                        )}
                        title={e.detail}
                      >
                        {e.label}
                      </p>
                    ))}
                    {list.length > 3 && (
                      <p className="px-1 text-[10px] font-bold text-text-3">+{list.length - 3} more</p>
                    )}
                  </>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* ── THE DAY, AS A DOSSIER — a richer design, items inside bubbles
             the way hiring draws them: the candidate
             panel's grammar: fact tiles, an evidence timeline with dots,
             and the attachments as a checklist card. ── */}
      {openDay && (
        <div className="fixed inset-0 z-40 flex justify-end bg-black/30" onClick={() => setOpenDay(null)}>
          <div className="h-full w-full overflow-y-auto border-l border-border bg-surface shadow-2 sm:w-[384px]" onClick={(e) => e.stopPropagation()}>
            {/* header */}
            <div className="sticky top-0 z-10 border-b border-border bg-surface px-5 py-4">
              <p className="mb-1 text-[10.5px] font-bold uppercase tracking-[0.12em] text-text-3">The day</p>
              <div className="flex items-center gap-2">
                <h2 className="text-[17px] font-bold text-text-1">
                  {MONTHS[Number(openDay.slice(5, 7)) - 1]} {Number(openDay.slice(8, 10))}, {openDay.slice(0, 4)}
                </h2>
                {openDay === today && <span className="rounded-full bg-primary-soft px-2 py-0.5 text-[10.5px] font-bold text-primary">Today</span>}
                <button onClick={() => setOpenDay(null)} className="ml-auto text-text-3 hover:text-text-1"><X size={16} /></button>
              </div>
            </div>

            <div className="space-y-5 px-5 py-4">
              {/* ── the fact balloons ── */}
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-xl border border-border bg-surface-2/40 px-3.5 py-3">
                  <p className="text-[16px] font-bold leading-6 text-text-1">{visibleOf(openDay).length}</p>
                  <p className="text-[11px] text-text-3">On this day</p>
                </div>
                {(() => {
                  const wx = openDay >= today ? dayForecast(forecast, openDay) : null
                  return (
                    <div className="rounded-xl border border-border bg-surface-2/40 px-3.5 py-3">
                      {wx ? (
                        <>
                          <p className="flex items-center gap-1.5 text-[16px] font-bold leading-6 text-text-1">
                            <WeatherGlyph icon={wx.icon} className="h-4.5 w-4.5" /> {wx.tmax ?? '—'}° / {wx.tmin ?? '—'}°
                          </p>
                          <p className="text-[11px] text-text-3">{weatherLabel(wx.icon)}{wx.rain >= 20 ? ` · ${wx.rain}% rain` : ''}</p>
                        </>
                      ) : (
                        <>
                          <p className="text-[16px] font-bold leading-6 text-text-3">—</p>
                          <p className="text-[11px] text-text-3">No forecast</p>
                        </>
                      )}
                    </div>
                  )
                })()}
              </div>

              {/* ── the day's story — timeline with dots, the hiring way ── */}
              {visibleOf(openDay).length > 0 && (
                <div>
                  <p className="mb-2 text-[10.5px] font-bold uppercase tracking-[0.12em] text-text-3">What happens</p>
                  <div className="relative ml-1.5 space-y-3 border-l border-border pl-4">
                    {KINDS.filter((k) => !hidden.has(k.id)).flatMap((k) => {
                      const items = (byDay.get(openDay) ?? []).filter((e) => e.kind === k.id)
                      return items.map((e, i) => (
                        <div key={k.id + i} className="relative">
                          <span className={cn('absolute -left-[21.5px] top-1 h-2.5 w-2.5 rounded-full border-2 border-surface bg-current', e.danger ? 'text-danger' : TINT_FG[k.tint])} />
                          <p className="text-[12.5px] font-semibold leading-5 text-text-1">{e.label}</p>
                          <p className="text-[11.5px] leading-4 text-text-3">
                            {e.time ? `${e.time} · ` : ''}{k.label}
                          </p>
                          {e.detail !== e.label && (
                            <p className={cn('mt-1 rounded-lg px-2.5 py-1.5 text-[12px] leading-5', e.danger ? 'bg-danger/10 text-danger' : 'bg-surface-2/60 text-text-2')}>
                              {e.detail}
                            </p>
                          )}
                        </div>
                      ))
                    })}
                  </div>
                </div>
              )}
              {visibleOf(openDay).length === 0 && (
                <p className="py-4 text-center text-[13px] italic text-text-3">Nothing on this day.</p>
              )}

              {/* ── attachments — the checklist card ── */}
              <div>
                <p className="mb-2 text-[10.5px] font-bold uppercase tracking-[0.12em] text-text-3">
                  Attachments{filesOf(openDay).length > 0 ? ` · ${filesOf(openDay).length}` : ''}
                </p>
                <div className="rounded-xl border border-border">
                  {filesOf(openDay).map((f) => (
                    <div key={f.id} className="flex items-center gap-2.5 border-b border-border/60 px-3 py-2.5 last:border-0">
                      {f.mime.startsWith('image/') ? <ImageIcon size={14} className="shrink-0 text-text-3" /> : <FileText size={14} className="shrink-0 text-text-3" />}
                      <button
                        onClick={() => openFile({ url: f.url, title: f.name, icon: 'file-text' })}
                        className="min-w-0 flex-1 truncate text-left text-[12.5px] font-semibold text-text-1 hover:underline"
                        title={f.name}
                      >
                        {f.name}
                      </button>
                      <span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-semibold text-text-3">{f.by.split('@')[0]}</span>
                      <span className="shrink-0 text-[10.5px] text-text-3">{ohioDayYear(f.at)}</span>
                      <button
                        onClick={() => {
                          gasAction<{ removed: string }>('calendarDayFileRemove', { id: f.id })
                            .then(() => {
                              setDayFiles((prev) => {
                                const next = (prev ?? []).filter((x) => x.id !== f.id)
                                keep(`asa:cal:files:${monthKey}`, next)
                                return next
                              })
                            })
                            .catch((e) => toast({ type: 'danger', title: 'Could not remove it', body: e instanceof Error ? e.message : '' }))
                        }}
                        className="shrink-0 text-text-3 hover:text-danger"
                        title="Remove from this day (the link keeps working)"
                      >
                        <X size={13} />
                      </button>
                    </div>
                  ))}
                  <div className="flex items-center justify-between px-3 py-2.5">
                    <p className="text-[11.5px] italic text-text-3">
                      {filesOf(openDay).length === 0 ? 'Nothing pinned to this day yet.' : 'Everyone on the platform can open these.'}
                    </p>
                    <input
                      ref={fileInput}
                      type="file"
                      accept={TASK_ATTACH_ACCEPT}
                      className="hidden"
                      onChange={async (ev) => {
                        const f = ev.target.files?.[0]
                        ev.target.value = ''
                        if (!f || !openDay) return
                        const mime = inferMime(f)
                        if (!(mime.startsWith('image/') || mime === 'application/pdf')) {
                          toast({ type: 'warning', title: 'Images and PDFs only' })
                          return
                        }
                        if (f.size > MAX_UPLOAD_BYTES) {
                          toast({ type: 'warning', title: 'Too large', body: `${humanSize(f.size)} — up to 15MB.` })
                          return
                        }
                        setUploading(true)
                        try {
                          const base64 = await fileToBase64(f)
                          const row = await gasAction<CalFile>('calendarDayFileStore', {
                            date: openDay, base64, filename: f.name, mime,
                          })
                          setDayFiles((prev) => {
                            const next = [...(prev ?? []), row]
                            keep(`asa:cal:files:${monthKey}`, next)
                            return next
                          })
                          // "Everyone can open these" is not true of a file the backend kept private
                          if (row.shared === false) {
                            toast({ type: 'warning', title: 'Pinned, but private',
                              body: row.shared_why || 'Only its owner can open this file for now.' })
                          }
                        } catch (e) {
                          toast({ type: 'danger', title: 'Upload failed', body: e instanceof Error ? e.message : 'Try again.' })
                        } finally {
                          setUploading(false)
                        }
                      }}
                    />
                    <button
                      onClick={() => fileInput.current?.click()}
                      disabled={uploading}
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-[12px] font-semibold text-on-primary hover:bg-primary-hover disabled:opacity-50"
                    >
                      {uploading ? <Loader2 size={12} className="animate-spin" /> : <Paperclip size={12} />}
                      {uploading ? 'Uploading…' : 'Upload'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
