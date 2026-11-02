// Ops Dashboard — "Today's operation at a glance", on REAL data only.
// MODULAR — the Dashboard has to be thoroughly modular: items can be removed and others put in their place.
import { useEffect, useMemo, useState } from 'react'
import { differenceInDays, format } from 'date-fns'
import DashboardTemplate from '@/engine/templates/dashboard'
import DragPerson from '@/components/shared/DragPerson'
import { api } from '@/lib/api'
import { TRACKER_OWN_ONLY, isTrackerOwnOnly } from '@/lib/certUploads'
import { asList } from '@/lib/asList'
import { ohioDayYear, ohioWall } from '@/lib/ohio'
import { readSlice, readSliceFloor } from '@/lib/snapshotClient'
import { useApiConfigStore } from '@/stores/useApiConfigStore'
import { houseById, rosterDayISO, type ShiftMatrixCell } from '@/lib/seed-shifts2'
import type { PageSchema, TintName } from '@/engine/types'

type Row = Record<string, any>
const FEED_NAMES = ['people', 'candidates', 'clients', 'callOffs', 'uiIncidents', 'drAppointments', 'workOrders', 'staffCerts'] as const
type FeedName = (typeof FEED_NAMES)[number]
type Feeds = Record<FeedName, Row[] | null>
type MatrixState = { rows: (ShiftMatrixCell & { date?: string; houseName?: string })[]; ready: boolean; failed: boolean }

// Roster cells are a slice, never a live tab — an empty Hub tab would lie "nobody is scheduled".
async function readRosterMatrix(live: boolean): Promise<(ShiftMatrixCell & { date?: string })[]> {
  if (!live) return (await api.list<ShiftMatrixCell>('shiftMatrix' as never)) as ShiftMatrixCell[]
  const fresh = await readSlice<ShiftMatrixCell & { date?: string }>('shiftMatrix')
  if (fresh) return fresh
  const floor = await readSliceFloor<ShiftMatrixCell & { date?: string }>('shiftMatrix')
  if (floor) return floor.rows
  throw new Error('roster slice missing')
}

function cellDate(c: ShiftMatrixCell & { date?: string }): string {
  return String(c.date || (typeof c.dayIndex === 'number' ? rosterDayISO(c.dayIndex) : ''))
}

function isWorkingKind(kind: string): boolean {
  const k = kind.toLowerCase()
  return k !== '' && k !== 'off' && k !== 'ro' && k !== 'alias'
}

// Tolerant date parse over the mirrors' mixed formats (ISO / M/D/YYYY), landing on OHIO's clock — the whole…
function toDate(v: unknown): Date | null {
  return ohioWall(String(v ?? '').trim())
}

const URGENCY_TINT: Record<string, TintName> = { '5': 'pink', '4': 'peach', '3': 'amber', '2': 'blue', '1': 'blue' }

export default function OpsDashPage() {
  const live = useApiConfigStore((s) => s.driver) === 'apps-script'
  const [feeds, setFeeds] = useState<Feeds>({
    people: null, candidates: null, clients: null, callOffs: null,
    uiIncidents: null, drAppointments: null, workOrders: null, staffCerts: null,
  })
  const [failed, setFailed] = useState<string[]>([])
  /** the tracker answered only this account's own certifications (Certs.gs certTrackerList): nothing here counts them */
  const [certsOwnOnly, setCertsOwnOnly] = useState(false)
  const [matrix, setMatrix] = useState<MatrixState>({ rows: [], ready: false, failed: false })

  useEffect(() => {
    let alive = true
    FEED_NAMES.forEach((name) => {
      api.list<Row>(name as never)
        .then((rows) => alive && setFeeds((f) => ({ ...f, [name]: Array.isArray(rows) ? rows : [] })))
        .catch((e) => {
          if (!alive) return
          if (isTrackerOwnOnly(e)) setCertsOwnOnly(true)
          setFailed((xs) => (xs.includes(name) ? xs : [...xs, name]))
        })
    })
    readRosterMatrix(live)
      .then((rows) => alive && setMatrix({ rows: Array.isArray(rows) ? rows : [], ready: true, failed: false }))
      .catch(() => alive && setMatrix({ rows: [], ready: true, failed: true }))
    return () => {
      alive = false
    }
  }, [live])

  const board = useMemo(() => {
    // "Now" is Ohio's now, on the same carrier toDate() returns.
    const now = ohioWall(new Date()) as Date
    const days30 = (v: unknown) => {
      const dt = toDate(v)
      return dt !== null && differenceInDays(now, dt) <= 30 && differenceInDays(now, dt) >= 0
    }
    const f = (name: FeedName) => feeds[name] ?? []
    const loading = (name: FeedName) => feeds[name] === null && !failed.includes(name)
    const broken = (name: FeedName) => failed.includes(name)
    // A number nobody can trust yet stays BLANK — never a confident 0 (which would be a lie about a feed still in…
    const num = (name: FeedName, v: number) => (broken(name) ? '—' : loading(name) ? '' : v)

    const people = f('people'), candidates = f('candidates'), clients = f('clients')
    const callOffs = f('callOffs'), uiIncidents = f('uiIncidents')
    const drAppointments = f('drAppointments'), workOrders = f('workOrders')
    const staffCerts = f('staffCerts')

    const todayISO = format(now, 'yyyy-MM-dd')
    const todayCells = matrix.rows.filter((c) => cellDate(c) === todayISO)
    const working = todayCells.filter((c) => isWorkingKind(String(c.kind || '')))
    const houseIds = new Set(matrix.rows.map((c) => String(c.houseId || '')).filter(Boolean))
    const coveredIds = new Set(working.map((c) => String(c.houseId || '')).filter(Boolean))
    const gapIds = [...houseIds].filter((id) => !coveredIds.has(id))
    const onDutyNow = new Set(working.map((c) => String(c.staffName || '').trim()).filter(Boolean)).size
    const houseLabel = (id: string) => {
      const named = matrix.rows.find((c) => String(c.houseId || '') === id && String(c.houseName || '').trim())
      return String(named?.houseName || '').trim() || houseById(id)?.name || houseById(id)?.code || id
    }
    const covNum = (v: number) => (matrix.failed ? '—' : matrix.ready ? v : '')

    const certExpired = staffCerts.filter((c) => String(c.status).toLowerCase() === 'expired').length
    const certExpiring = staffCerts.filter((c) => String(c.status).toLowerCase() === 'expiring').length
    const certMissing = staffCerts.filter((c) => String(c.status).toLowerCase() === 'missing').length

    const activeCaregivers = people.filter((p) => String(p.status).toLowerCase() === 'active').length
    const hires30d = people.filter((p) => days30(p.start_date)).length
    const pendingCandidates = candidates.filter((c) => !['hired', 'not_hiring'].includes(String(c.stage))).length

    const offs30 = callOffs.filter((c) => days30(c.date))
    const offsToday = callOffs.filter((c) => {
      const dt = toDate(c.date)
      return dt !== null && format(dt, 'yyyy-MM-dd') === todayISO
    })

    // incident_category holds MULTIPLE comma-separated categories — counting the raw cell invented compound…
    const inc30 = uiIncidents.filter((i) => days30(i.incident_date))
    const mix = new Map<string, number>()
    inc30.forEach((i) => {
      const cats = asList(i.incident_category)
      for (const c of cats.length ? cats : ['Uncategorised']) mix.set(c, (mix.get(c) ?? 0) + 1)
    })
    const incidentBars = [...mix.entries()]
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8)

    const recentIncidents = [...uiIncidents]
      .map((i) => ({ ...i, _d: toDate(i.incident_date) }) as Row & { _d: Date | null })
      .filter((i) => i._d !== null)
      .sort((a, b) => (b._d as Date).getTime() - (a._d as Date).getTime())
      .slice(0, 6)

    const upcomingDr = drAppointments
      .map((a) => ({ ...a, _d: toDate(a.next_visit) }) as Row & { _d: Date | null })
      .filter((a) => a._d !== null && differenceInDays(a._d as Date, now) >= 0 && differenceInDays(a._d as Date, now) <= 14)
      .filter((a) => String(a.active_or_discontinued || '').toLowerCase() !== 'discontinued')
      .sort((a, b) => (a._d as Date).getTime() - (b._d as Date).getTime())
      .slice(0, 8)

    const openRepairs = workOrders
      .filter((w) => !['completed', 'done'].includes(String(w.status || '').toLowerCase()))
      .sort((a, b) => Number(b.urgency_level || 0) - Number(a.urgency_level || 0))
      .slice(0, 8)

    // Stable ids: the persisted layout keys on them, so renaming a widget's title never loses somebody's…
    const widgets = [
      { id: 'stat-clients', kind: 'stat', label: 'Active clients', description: 'Count of the client directory.', value: num('clients', clients.length), tint: 'pink', href: '/app/clients/directory' },
      { id: 'stat-caregivers', kind: 'stat', label: 'Active caregivers', description: 'Active people in the staff directory, with hires of the last 30 days.', value: num('people', activeCaregivers), deltaLabel: `${hires30d} hired ≤30d`, tint: 'blue', href: '/app/people/directory' },
      { id: 'stat-candidates', kind: 'stat', label: 'Candidates in play', description: 'Candidates not yet hired or closed, from the hiring pipeline.', value: num('candidates', pendingCandidates), tint: 'lavender', href: '/app/hiring/pipeline' },
      { id: 'stat-accounts', kind: 'stat', label: 'Accounts total', description: 'Clients + staff + candidates — every account the platform holds.', value: num('people', clients.length + people.length + candidates.length), tint: 'mint', href: '/app/users/accounts' },
      { id: 'stat-houses-covered', kind: 'stat', label: 'Houses covered today', description: 'Houses with at least one working shift on the Ohio roster today.', value: houseIds.size ? covNum(coveredIds.size) : covNum(0), deltaLabel: houseIds.size ? `${coveredIds.size}/${houseIds.size}` : undefined, tint: gapIds.length ? 'amber' : 'mint', href: '/app/calendarbuilder/cards' },
      { id: 'stat-shifts-today', kind: 'stat', label: 'Shifts today', description: 'Working roster cells for today (off / R/O / alias do not count).', value: covNum(working.length), tint: 'blue', href: '/app/calendarbuilder/timeline' },
      { id: 'stat-on-duty', kind: 'stat', label: 'On duty today', description: 'Distinct staff names on a working shift today.', value: covNum(onDutyNow), tint: 'lavender', href: '/app/calendarbuilder/cards' },
      { id: 'stat-coverage-gaps', kind: 'stat', label: 'Coverage gaps', description: 'Houses with nobody rostered to work today.', value: covNum(gapIds.length), tint: gapIds.length ? 'pink' : 'mint', href: '/app/calendarbuilder/house-cal?range=week' },
      {
        id: 'coverage-gaps-list', kind: 'list', title: 'Coverage pulse — gaps', span: 2,
        description: 'Houses with no working shift today, named the way the roster names them.',
        empty: !matrix.ready ? 'Loading…' : matrix.failed ? 'The roster slice did not answer.' : 'Every house has coverage today.',
        items: gapIds.slice(0, 12).map((id) => ({
          title: houseLabel(id),
          meta: id,
          icon: 'house', tint: 'pink' as TintName,
        })),
        viewAllHref: '/app/calendarbuilder/house-cal?range=week', viewAllLabel: 'Calendar Builder',
      },
      {
        id: 'triaged-alerts', kind: 'list', title: 'Active alerts (triaged)', span: 1,
        description: 'The Command Deck’s triage — certifications, incidents and call-offs counted from the platform’s own records, not from a second brain.',
        empty: loading('staffCerts') && loading('uiIncidents') ? 'Loading…' : 'Nothing to triage.',
        items: [
          // an own answer is one person's rows: one line says so, never three counts of the caller as the company
          ...(certsOwnOnly
            ? [{ title: 'certifications', meta: `— ${TRACKER_OWN_ONLY}`, icon: 'badge-alert', tint: 'blue' as TintName }]
            : [
                { title: 'cert expired', meta: String(num('staffCerts', certExpired)), icon: 'badge-alert', tint: 'pink' as TintName, href: '/app/employee-tracker/certifications' },
                { title: 'cert expiring', meta: String(num('staffCerts', certExpiring)), icon: 'clock', tint: 'amber' as TintName, href: '/app/employee-tracker/certifications' },
                { title: 'cert missing', meta: String(num('staffCerts', certMissing)), icon: 'circle-off', tint: 'peach' as TintName, href: '/app/employee-tracker/certifications' },
              ]),
          { title: 'UI/MUI · 30 days', meta: String(num('uiIncidents', inc30.length)), icon: 'triangle-alert', tint: 'pink' as TintName, href: '/app/ui-incidents/log' },
          { title: 'call-offs · 30 days', meta: String(num('callOffs', offs30.length)), icon: 'phone-off', tint: 'amber' as TintName, href: '/app/call-offs/log' },
        ],
      },
      {
        id: 'calloffs-today', kind: 'list', title: `Call offs today · ${offs30.length} in 30d`, span: 1,
        description: 'Today’s call-offs from the call-off log, with the 30-day total.',
        empty: loading('callOffs') ? 'Loading…' : 'No call-offs today.',
        // A list item's `title` is rendered as-is, so the name rides in already wrapped and every person on this…
        items: offsToday.slice(0, 6).map((c) => {
          const who = String(c.employee_name || '').trim()
          return {
            title: <DragPerson name={who}>{who || '—'}</DragPerson>,
            meta: [String(c.type || 'Call Off'), String(c.how_late || '').trim()].filter(Boolean).join(' · '),
            icon: 'user-minus', tint: 'amber' as TintName,
          }
        }),
        viewAllHref: '/app/call-offs/log',
      },
      {
        id: 'incident-mix', kind: 'bars', title: 'Incident mix — last 30 days', span: 1,
        description: 'UI/MUI reports of the last 30 days grouped by category, biggest first.',
        bars: incidentBars,
        empty: loading('uiIncidents') ? 'Loading…' : 'No incidents reported in the last 30 days.',
        viewAllHref: '/app/ui-incidents/log', viewAllLabel: 'All UI reports',
      },
      {
        id: 'incidents-recent', kind: 'list', title: 'Latest incident reports', span: 1,
        description: 'The newest UI/MUI reports, the client each one names first.',
        empty: loading('uiIncidents') ? 'Loading…' : 'No incident reports yet.',
        items: recentIncidents.map((i) => {
          const who = String(i.client_name || '').trim()
          return {
            // type client: the row names the consumer the report is about, not its reporter
            title: <DragPerson name={who} type="client">{who || '—'}</DragPerson>,
            meta: [asList(i.incident_category)[0] || 'Incident', i._d ? format(i._d as Date, 'MMM d') : '', String(i.incident_location || '')].filter(Boolean).join(' · '),
            icon: 'triangle-alert', tint: 'pink' as TintName,
          }
        }),
        viewAllHref: '/app/ui-incidents/log',
      },
      {
        id: 'dr-upcoming', kind: 'list', title: 'Dr appointments — next 14 days', span: 1,
        description: 'Doctor appointments scheduled inside the next two weeks.',
        empty: loading('drAppointments') ? 'Loading…' : 'Nothing scheduled in the next two weeks.',
        items: upcomingDr.map((a) => {
          const who = String(a.client || '').trim()
          return {
            // type client: the appointment belongs to the consumer, not to the doctor in the meta
            title: <DragPerson name={who} type="client">{who || '—'}</DragPerson>,
            meta: [String(a.specialist || a.dr_name || ''), a._d ? format(a._d as Date, 'MMM d') : ''].filter(Boolean).join(' · '),
            icon: 'stethoscope', tint: 'blue' as TintName,
          }
        }),
        viewAllHref: '/app/dr-appointments/upcoming',
      },
      {
        id: 'repairs-open', kind: 'list', title: `House repairs — ${openRepairs.length} open, most urgent first`, span: 2,
        description: 'Open house-repair work orders, most urgent first.',
        empty: loading('workOrders') ? 'Loading…' : 'Nothing open — every work order is completed.',
        items: openRepairs.map((w) => ({
          title: String(w.select_address_vehicle || '—'),
          meta: [String(w.repair_type || ''), `urgency ${String(w.urgency_level || '—')}`, String(w.status || 'New')].filter(Boolean).join(' · '),
          icon: 'wrench', tint: URGENCY_TINT[String(w.urgency_level)] ?? 'blue',
        })),
        viewAllHref: '/app/house-repair/orders',
      },
    ]

    // ── THE SUGGESTION CATALOG — widgets can be added and removed, and the app makes the suggestions itself from a…

    const stageMix = new Map<string, number>()
    candidates.forEach((c) => {
      const s = String(c.stage || 'unsorted')
      stageMix.set(s, (stageMix.get(s) ?? 0) + 1)
    })
    const stageTints: TintName[] = ['blue', 'mint', 'lavender', 'peach', 'amber', 'pink']
    const stageSlices = [...stageMix.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([label, value], i) => ({ label, value, tint: stageTints[i % stageTints.length] }))

    const newHires = people
      .filter((p) => days30(p.start_date))
      .sort((a, b) => String(b.start_date || '').localeCompare(String(a.start_date || '')))
      .slice(0, 8)

    const offTypeMix = new Map<string, number>()
    offs30.forEach((c) => {
      const t = String(c.type || 'Call Off')
      offTypeMix.set(t, (offTypeMix.get(t) ?? 0) + 1)
    })
    const offTypeBars = [...offTypeMix.entries()]
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8)

    const recentOffs = [...offs30]
      .map((c) => ({ ...c, _d: toDate(c.date) }) as Row & { _d: Date | null })
      .filter((c) => c._d !== null)
      .sort((a, b) => (b._d as Date).getTime() - (a._d as Date).getTime())
      .slice(0, 6)

    const openRepairCount = workOrders.filter((w) => !['completed', 'done'].includes(String(w.status || '').toLowerCase())).length

    const catalog = [
      {
        id: 'cat-donut-stages', kind: 'donut', title: 'Candidates by stage',
        description: 'The hiring pipeline sliced by stage — where every candidate sits.',
        slices: stageSlices, centerLabel: 'candidates',
      },
      {
        id: 'cat-new-hires', kind: 'list', title: 'New hires — last 30 days',
        description: 'People whose start date falls inside the last 30 days.',
        empty: loading('people') ? 'Loading…' : 'Nobody started in the last 30 days.',
        items: newHires.map((p) => {
          const who = String(p.name || p.display_name || '').trim()
          return {
            title: <DragPerson name={who}>{who || '—'}</DragPerson>,
            meta: [String(p.role || p.title || ''), ohioDayYear(String(p.start_date || ''))].filter(Boolean).join(' · '),
            icon: 'user-plus', tint: 'mint' as TintName,
          }
        }),
        viewAllHref: '/app/people/directory',
      },
      {
        id: 'cat-calloff-types', kind: 'bars', title: 'Call-offs by type — 30 days',
        description: 'The last 30 days of call-offs grouped by their filed type.',
        bars: offTypeBars,
        empty: loading('callOffs') ? 'Loading…' : 'No call-offs in the last 30 days.',
        viewAllHref: '/app/call-offs/log',
      },
      {
        id: 'cat-calloffs-recent', kind: 'list', title: 'Latest call-offs',
        description: 'The most recent call-off filings, newest first.',
        empty: loading('callOffs') ? 'Loading…' : 'No call-offs in the last 30 days.',
        items: recentOffs.map((c) => {
          const who = String(c.employee_name || '').trim()
          return {
            title: <DragPerson name={who}>{who || '—'}</DragPerson>,
            meta: [String(c.type || 'Call Off'), c._d ? ohioDayYear(c._d as Date) : ''].filter(Boolean).join(' · '),
            icon: 'user-minus', tint: 'amber' as TintName,
          }
        }),
        viewAllHref: '/app/call-offs/log',
      },
      {
        id: 'cat-stat-repairs', kind: 'stat', label: 'Open work orders',
        description: 'House-repair work orders not yet completed.',
        value: num('workOrders', openRepairCount), tint: 'peach', href: '/app/house-repair/orders',
      },
      {
        id: 'cat-stat-dr', kind: 'stat', label: 'Dr appointments ≤14d',
        description: 'Doctor appointments scheduled inside the next two weeks.',
        value: num('drAppointments', upcomingDr.length), tint: 'blue', href: '/app/dr-appointments/upcoming',
      },
      {
        id: 'cat-donut-incidents', kind: 'donut', title: 'Incident mix — share of total',
        description: 'The 30-day incident mix drawn as share-of-total slices.',
        slices: incidentBars.slice(0, 6).map((b, i) => ({ label: b.label, value: b.value, tint: stageTints[i % stageTints.length] })),
        centerLabel: 'reports',
      },
    ]

    catalog.push(
      {
        id: 'cat-stat-hires30', kind: 'stat', label: 'Hires — last 30 days',
        description: 'People whose start date falls inside the last 30 days.',
        value: num('people', hires30d), tint: 'mint', href: '/app/people/directory',
      },
      {
        id: 'cat-bars-people-status', kind: 'bars', title: 'Staff by status',
        description: 'The whole staff directory grouped by current status.',
        bars: (() => {
          const mixS = new Map<string, number>()
          people.forEach((p) => {
            const st = String(p.status || 'Unset')
            mixS.set(st, (mixS.get(st) ?? 0) + 1)
          })
          return [...mixS.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value).slice(0, 8)
        })(),
        empty: loading('people') ? 'Loading…' : 'The directory is empty.',
        viewAllHref: '/app/people/directory',
      },
    )

    // READY-MADE BOARDS: one press arranges the company's widgets into a known-good story.
    const presets = [
      { id: 'full-pulse', title: 'The full pulse', blurb: 'Everything this app can draw, all at once',
        on: [...widgets.map((w) => w.id), ...catalog.map((c) => c.id)] },
      { id: 'people-day', title: 'People day', blurb: 'Staff, hires, candidates and who called off',
        on: ['stat-caregivers', 'stat-candidates', 'cat-stat-hires30', 'cat-new-hires', 'cat-donut-stages', 'calloffs-today', 'cat-calloffs-recent'] },
      { id: 'clients-care', title: 'Clients & care', blurb: 'Clients, appointments and incident watch',
        on: ['stat-clients', 'dr-upcoming', 'cat-stat-dr', 'incidents-recent', 'incident-mix', 'cat-donut-incidents'] },
      { id: 'the-house', title: 'The houses', blurb: 'Repairs and coverage, most urgent first',
        on: ['stat-houses-covered', 'stat-coverage-gaps', 'coverage-gaps-list', 'repairs-open', 'cat-stat-repairs'] },
      { id: 'command-deck', title: 'Command Deck', blurb: 'The daily glance: headcount, coverage pulse, and triaged alerts',
        on: ['stat-clients', 'stat-caregivers', 'stat-candidates', 'stat-accounts', 'stat-houses-covered', 'stat-shifts-today', 'stat-on-duty', 'stat-coverage-gaps', 'coverage-gaps-list', 'triaged-alerts'] },
      { id: 'minimal', title: 'Just the numbers', blurb: 'The four headline stats, nothing else',
        on: ['stat-clients', 'stat-caregivers', 'stat-candidates', 'stat-accounts'] },
    ]

    return { widgets, catalog, presets }
  }, [feeds, failed, matrix, certsOwnOnly])

  const schema = useMemo<PageSchema>(
    () => ({
      id: 'today', type: 'dashboard', title: 'Dashboard', icon: 'gauge',
      dataSource: { resource: 'activity' },
      config: {},
    }),
    [],
  )

  return (
    <div>
      {failed.length > 0 && (
        <p className="mb-3 rounded-md bg-tint-pink/40 px-3 py-2 text-[12.5px] text-text-1">
          Could not load: {failed.join(', ')} — those widgets show “!” until the connection recovers.
        </p>
      )}
      <DashboardTemplate
        config={{ title: "Today's operation, at a glance", widgets: board.widgets, catalog: board.catalog, presets: board.presets }}
        data={[]}
        schema={schema}
      />
    </div>
  )
}
