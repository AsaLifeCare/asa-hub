// Client Record — everything the platform holds about one client, in the six tabs this company already reads…
// AND THE SECTIONS THE UNIQUE VIEW SHOWS, after them: Finances (with Client Finances merged in), Sleep, Hydration…
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router'
import {
  ArrowLeft,
  CalendarDays,
  CalendarPlus,
  ChevronDown,
  Check,
  Clock,
  FileText,
  History,
  MapPin,
  Search,
  ShieldAlert,
  TriangleAlert,
  User,
} from 'lucide-react'
import Card from '@/components/shared/Card'
import Avatar from '@/components/shared/Avatar'
import DragPerson from '@/components/shared/DragPerson'
import Pager from '@/components/shared/Pager'
import { PAGE_SIZE, usePager } from '@/lib/pager'
import { api } from '@/lib/api'
import { formatPhoneDisplay } from '@/lib/phoneFormat'
import {
  type ClientAppointment, type ClientRow, type IncidentRow,
  dayOf, todayIso, daysAgoIso, longBirthday, longDay, clockOf,
  useIncidents, incidentBits, houseForClient, useHouses,
} from './shared'
import { openFile } from '@/stores/useFileViewerStore'
import type { FocusType } from '@/stores/useContextStore'
import { useCan } from '@/auth/permissions'
import { useClientsPolicyStore } from '@/stores/useClientsPolicyStore'
import { useRegistryStore } from '@/stores/useRegistryStore'
import { isAllowedWith, useBadgeRulesVersion } from '@/lib/appAccess'
import { useEffectiveRole } from '@/lib/effectiveUser'
import { houseCalLink } from '@/pages/features/shifts/houseCalTypes'
import ClientsToolbar from './ClientsToolbar'
import DailySection from './daily/DailySection'
import { useDailyPlaceScope } from './daily/useDailyPlace'
import ClientSections from './unique/ClientSections'
import { FIRST_RECORD_TAB, recordTabs } from './recordTabs'
import { useClientSections } from './unique/useRecordTabs'
import { currentIn, isSharedSection } from './unique/uniqueTabs'
import { cn } from '@/lib/utils'

// ------------------------------------------------------------------ the row…



// The five care categories the plans carry.
const CARE_CATEGORIES: { key: keyof ClientRow; label: string }[] = [
  { key: 'care_communication', label: 'Communication' },
  { key: 'care_safety', label: 'Safety' },
  { key: 'care_daily_living', label: 'Daily Living' },
  { key: 'care_behavioral', label: 'Behavioral Support' },
  { key: 'care_nutrition', label: 'Nutrition' },
]

const MEDICAL_CATEGORIES: { key: keyof ClientRow; label: string }[] = [
  { key: 'allergies_text', label: 'Allergies' },
  { key: 'diagnoses_text', label: 'Core Diagnoses' },
  { key: 'medications_text', label: 'Medications' },
]

// Daily is not a plan category: it is what the DSPs said on the hotline, read from the relay.
const MEDICAL_DAILY = { key: 'daily', label: 'Daily' }

// ------------------------------------------------------------------ dates — cutting, never parsing…

// ------------------------------------------------------------------ pieces…

function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-md border border-border bg-surface-2 px-3 py-2 text-[13px] leading-5 text-text-3">
      {children}
    </p>
  )
}

/** Body prose, with the plan's own blank lines kept as paragraph breaks. */
function Prose({ value }: { value?: string }) {
  const v = String(value ?? '').trim()
  if (!v) return null
  return (
    <div className="space-y-3">
      {v.split(/\n{2,}/).map((para, i) => (
        <p key={i} className="whitespace-pre-line text-[14px] leading-6 text-text-2">{para.trim()}</p>
      ))}
    </div>
  )
}

// The dropdown the old screen used for Care and Medical: a header naming what you are reading, and a list to change…
function CategoryDropdown({
  options,
  value,
  onChange,
}: {
  options: { key: string; label: string }[]
  value: string
  onChange: (key: string) => void
}) {
  const [open, setOpen] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false)
    }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', away)
      document.removeEventListener('keydown', esc)
    }
  }, [open])

  const current = options.find((o) => o.key === value)

  return (
    <div ref={wrap} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between rounded-lg border border-border bg-surface px-4 py-3 text-left text-[14.5px] font-medium text-text-1 transition-colors hover:bg-surface-2"
      >
        {current?.label ?? 'Choose'}
        <ChevronDown size={17} className={cn('shrink-0 text-text-3 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="absolute z-20 mt-1 max-h-[320px] w-full overflow-y-auto rounded-lg border border-border bg-surface shadow-2">
          {options.map((o) => (
            <button
              key={o.key}
              onClick={() => { onChange(o.key); setOpen(false) }}
              className={cn(
                'flex w-full items-center gap-2 px-4 py-2.5 text-left text-[14px] transition-colors hover:bg-surface-2',
                o.key === value ? 'font-semibold text-text-1' : 'text-text-2',
              )}
            >
              <Check size={15} className={cn('shrink-0', o.key === value ? 'opacity-100' : 'opacity-0')} />
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// A label above its value, centred — the old Demographics card.
function Stacked({ label, value, href, person }: {
  label: string
  value?: string
  href?: string
  person?: { name?: string; type?: FocusType; id?: string; subtitle?: string }
}) {
  const v = String(value ?? '').trim()
  if (!v) return null
  const personName = String(person?.name ?? '').trim()
  return (
    <div className="py-2">
      <p className="text-[12.5px] text-text-3">{label}</p>
      {href ? (
        <a href={href} className="text-[15px] font-normal text-primary hover:underline">{v}</a>
      ) : (
        <p className="text-[15px] font-normal text-text-1">
          {personName ? (
            <DragPerson name={personName} id={person?.id} type={person?.type ?? 'client'} subtitle={person?.subtitle}>
              {v}
            </DragPerson>
          ) : (
            v
          )}
        </p>
      )}
    </div>
  )
}

// ------------------------------------------------------------------ appointments…

function ApptCard({
  title,
  icon: Icon,
  rows,
  accent,
  empty,
}: {
  title: string
  icon: typeof CalendarDays
  rows: ClientAppointment[]
  accent: string
  empty: string
}) {
  const pager = usePager(rows, PAGE_SIZE, rows.length)
  return (
    <Card className="space-y-3">
      <p className="flex items-center gap-2 text-[15px] font-semibold text-text-1">
        <Icon size={16} className="text-text-3" />
        {title}
        <span className="text-[13px] font-normal text-text-3">({rows.length})</span>
      </p>
      {!rows.length ? (
        <p className="text-[13.5px] text-text-3">{empty}</p>
      ) : (
        <div className="space-y-2">
          {pager.slice.map((a) => {
            const clock = clockOf(a.time)
            return (
              <div key={a.id} className={cn('rounded-md border-l-[3px] bg-surface-2 py-2.5 pl-3 pr-3', accent)}>
                <p className="flex items-center gap-2 text-[13.5px] text-text-2">
                  <CalendarDays size={14} className="shrink-0 text-text-3" />
                  {longDay(a.date)}{clock ? ` at ${clock}` : ''}
                </p>
                <p className="mt-1 flex items-center gap-2 text-[14px] font-semibold text-text-1">
                  <User size={14} className="shrink-0 text-text-3" />
                  {a.doctor || a.title || 'Doctor not specified'}
                </p>
                {a.location ? (
                  <p className="mt-1 flex items-center gap-2 text-[13.5px] text-text-3">
                    <MapPin size={14} className="shrink-0" />
                    {a.location}
                  </p>
                ) : null}
                {a.notes ? <p className="mt-1 whitespace-pre-line text-[13px] text-text-3">{a.notes}</p> : null}
              </div>
            )
          })}
          <Pager {...pager} onPage={pager.setPage} noun="appointments" />
        </div>
      )}
    </Card>
  )
}

// ------------------------------------------------------------------ incidents — the one tab that reaches the…

// THE JOIN IS ON THE FULL NAME, NEVER ON INITIALS.
function IncidentCounters({ rows }: { rows: IncidentRow[] }) {
  const today = todayIso()
  // BOTH ENDS BOUND.
  const count = (days: number) => {
    const floor = daysAgoIso(days)
    return rows.filter((r) => {
      const d = dayOf(r.date ?? r.occurredAt)
      return !!d && d >= floor && d <= today
    }).length
  }
  const unreadable = rows.filter((r) => !dayOf(r.date ?? r.occurredAt)).length
  const items = [
    { label: 'Last 7 Days', value: count(7) },
    { label: 'Last 30 Days', value: count(30) },
    { label: 'Last 90 Days', value: count(90) },
    { label: 'Total on Record', value: rows.length },
  ]
  return (
    <div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {items.map((s) => (
          <div key={s.label} className="rounded-lg border border-border bg-surface px-4 py-4 text-center">
            <p className="font-display text-[30px] font-bold leading-9 tabular-nums text-text-1">{s.value}</p>
            <p className="text-[12.5px] text-text-3">{s.label}</p>
          </div>
        ))}
      </div>
      {unreadable > 0 && (
        <p className="mt-2 text-[12.5px] text-text-3">
          {unreadable} {unreadable === 1 ? 'record carries' : 'records carry'} a date nothing here can read — counted
          in “Total on Record”, in no window.
        </p>
      )}
    </div>
  )
}

function IncidentFull({ r }: { r: IncidentRow }) {
  const b = incidentBits(r)
  return (
    <div className="rounded-md border-l-[3px] border-l-tint-fg-pink bg-surface-2 px-3 py-2.5">
      <div className="flex flex-wrap items-start gap-2">
        <p className="flex items-center gap-2 text-[13.5px] text-text-2">
          <CalendarDays size={14} className="shrink-0 text-text-3" />
          {longDay(r.date ?? r.occurredAt)}{b.clock ? ` at ${b.clock}` : ''}
        </p>
        <span className="ml-auto rounded-full bg-surface px-2.5 py-0.5 text-[11.5px] text-text-3">{b.category}</span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-4">
        {b.place ? (
          <span className="flex items-center gap-1.5 text-[13px] text-text-2">
            <MapPin size={14} className="text-text-3" />{b.place}
          </span>
        ) : null}
        {b.by ? (
          <span className="flex items-center gap-1.5 text-[13px] text-text-2">
            {/* the row is a flex line — its own gap-1.5 spaces the name, so no
                literal space is glued in front of the draggable span */}
            <User size={14} className="text-text-3" />Reported by:
            <DragPerson name={b.by} id={b.by} type="staff" subtitle="Reported the incident">
              {b.by}
            </DragPerson>
          </span>
        ) : null}
      </div>
      {b.text ? <p className="mt-2 whitespace-pre-line text-[13.5px] leading-6 text-text-2">{b.text}</p> : null}
    </div>
  )
}

function IncidentCompact({ r }: { r: IncidentRow }) {
  const b = incidentBits(r)
  return (
    <div className="rounded-md border border-border px-3 py-2">
      <div className="flex items-start gap-2">
        <p className="text-[13px] font-semibold text-text-1">{longDay(r.date ?? r.occurredAt)}</p>
        <span className="ml-auto text-[11.5px] text-text-3">{b.category}</span>
      </div>
      {b.text ? <p className="mt-1 whitespace-pre-line text-[13px] leading-5 text-text-3">{b.text}</p> : null}
    </div>
  )
}

// ------------------------------------------------------------------ the house — matched, never guessed…

// ------------------------------------------------------------------ the picker…

function ClientPicker({ rows, loading, error }: { rows: ClientRow[]; loading: boolean; error: string }) {
  const [q, setQ] = useState('')
  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return rows
    return rows.filter((r) => `${r.name} ${r.clientNumber ?? ''}`.toLowerCase().includes(needle))
  }, [rows, q])
  const pager = usePager(visible, PAGE_SIZE, q)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1">
          <h1 className="font-display text-[24px] font-bold leading-8 text-text-1">Record</h1>
          <p className="text-[14px] text-text-3">Choose a client to open their record.</p>
        </div>
        <ClientsToolbar rows={rows} view="Record" />
      </div>
      <div className="relative max-w-sm">
        <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-3" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search clients…"
          className="h-9 w-full rounded-md border border-border bg-surface pl-9 pr-3 text-[14px] text-text-1 outline-none placeholder:text-text-3 focus:border-primary"
        />
      </div>
      {error && <Note>{error}</Note>}
      {loading && !rows.length && <p className="text-[14px] text-text-3">Loading clients…</p>}
      {!loading && !error && !rows.length && <Note>No client is on file yet.</Note>}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {pager.slice.map((c) => (
          <Link key={c.id} to={`/app/clients/record?record=${encodeURIComponent(c.id)}`}>
            <Card hover className="flex items-center gap-3">
              <DragPerson name={c.name} id={c.id} type="client" avatar={c.avatar} subtitle={c.supervisionShort} className="shrink-0">
                <Avatar src={c.avatar ?? ''} name={c.name} size="md" eager />
              </DragPerson>
              <div className="min-w-0">
                <p className="truncate text-[14.5px] font-semibold text-text-1">
                  <DragPerson name={c.name} id={c.id} type="client" avatar={c.avatar} subtitle={c.supervisionShort} className="block truncate">
                    {c.name}
                  </DragPerson>
                </p>
                <p className="truncate text-[12.5px] text-text-3">{c.supervisionShort || c.clientNumber || '—'}</p>
              </div>
            </Card>
          </Link>
        ))}
      </div>
      <Pager {...pager} onPage={pager.setPage} noun="clients" />
    </div>
  )
}

// ------------------------------------------------------------------ the page…

export const CLIENT_RECORD_PERM = 'clients.view'

export default function ClientRecordPage() {
  const [searchParams] = useSearchParams()
  const recordId = searchParams.get('record') ?? ''
  const canView = useCan(CLIENT_RECORD_PERM)
  // the house's calendar is House Calendars, which opens to no client or guardian
  const apps = useRegistryStore((s) => s.apps)
  const role = useEffectiveRole()
  useBadgeRulesVersion()
  const opensCalendar = isAllowedWith(apps, role, 'calendarbuilder', 'house-cal')
  // the sections shared with Unique, behind their own apps' doors
  const { sections, financeAllowed } = useClientSections()
  const [tab, setTab] = useState(FIRST_RECORD_TAB)
  const [care, setCare] = useState('')
  const [med, setMed] = useState('')
  const [olderOpen, setOlderOpen] = useState(false)
  const [rows, setRows] = useState<ClientRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!canView) { setLoading(false); return }
    setLoading(true)
    setError('')
    try {
      setRows(await api.list<ClientRow>('clients'))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The client directory could not be read.')
    } finally {
      setLoading(false)
    }
  }, [canView])

  useEffect(() => { void load() }, [load])
  useEffect(() => { setTab(FIRST_RECORD_TAB); setOlderOpen(false) }, [recordId])

  const client = useMemo(
    () => (recordId ? rows.find((r) => String(r.id) === recordId) ?? null : null),
    [rows, recordId],
  )
  // a section hidden under this viewer (a matrix edit, a visit) falls back to the first tab
  const tabs = useMemo(() => recordTabs(sections), [sections])
  const current = currentIn(tabs.map((t) => t.id), tab, FIRST_RECORD_TAB)
  const incidents = useIncidents(client?.name ?? '', current === 'incidents' && !!client)
  // Daily's page and filter outlive the Medical dropdown and tab, not this chart
  useDailyPlaceScope(client?.name ?? '')
  const houses = useHouses(!!recordId)
  // every client's name, so Daily can tell a spelling close to this client from one closer to somebody else
  const clientNames = useMemo(() => rows.map((r) => String(r.name ?? '')).filter(Boolean), [rows])

  // THE MASTER'S POLICY: a view disabled in Settings does not exist — the sidebar hides it, the chooser does not…
  const masterViews = useClientsPolicyStore((s) => s.views)
  const policyFetched = useClientsPolicyStore((s) => s.fetched)
  const ensurePolicy = useClientsPolicyStore((s) => s.ensure)
  useEffect(() => { ensurePolicy() }, [ensurePolicy])
  if (policyFetched && !(masterViews as string[]).includes('record')) {
    return <Navigate to="/app/clients/directory" replace />
  }

  if (!canView) {
    return (
      <div className="mx-auto max-w-[560px] pt-10">
        <Card className="flex flex-col items-center gap-3 px-6 py-10 text-center">
          <span className="grid h-12 w-12 place-items-center rounded-full bg-tint-amber text-tint-fg-amber">
            <ShieldAlert size={22} />
          </span>
          <h2 className="font-display text-[17px] font-bold text-text-1">A client chart is not open to you</h2>
          <p className="max-w-[380px] text-[13px] leading-5 text-text-2">
            Opening a chart requires the <span className="font-mono text-[12px]">{CLIENT_RECORD_PERM}</span> permission.
            Ask an admin if you need access.
          </p>
        </Card>
      </div>
    )
  }

  if (!recordId) return <ClientPicker rows={rows} loading={loading} error={error} />
  if (loading && !client) return <p className="text-[14px] text-text-3">Loading this client…</p>

  if (error && !client) {
    return (
      <div className="space-y-3">
        <Note>{error}</Note>
        <button onClick={() => void load()} className="rounded-md border border-border px-3 py-1.5 text-[13px] font-semibold text-text-2 hover:bg-surface-2">
          Try again
        </button>
      </div>
    )
  }

  if (!client) {
    return (
      <div className="space-y-3">
        <Note>No client on file carries the id “{recordId}”.</Note>
        <Link to="/app/clients/record" className="text-[13.5px] font-semibold text-primary hover:underline">
          Choose a client
        </Link>
      </div>
    )
  }

  const careAvailable = CARE_CATEGORIES
    .filter((c) => String(client[c.key] ?? '').trim())
    .map((c) => ({ key: c.key as string, label: c.label }))
  const medPlan = MEDICAL_CATEGORIES
    .filter((c) => String(client[c.key] ?? '').trim())
    .map((c) => ({ key: c.key as string, label: c.label }))
  const medAvailable = [...medPlan, MEDICAL_DAILY]

  const careKey = careAvailable.some((c) => c.key === care) ? care : (careAvailable[0]?.key ?? '')
  // Daily reads the relay, so it is never the entry nobody chose: with no plan text to open first, the dropdown…
  const medKey = medAvailable.some((c) => c.key === med) ? med : (medPlan[0]?.key ?? '')

  const upcoming = client.appointments ?? []
  const recentAppts = client.recentAppointments ?? []
  const guardian = client.guardian_name || client.guardianName || ''

  const recent30 = incidents.mine.filter((r) => {
    const d = dayOf(r.date ?? r.occurredAt)
    return !!d && d >= daysAgoIso(30)
  })
  const older = incidents.mine.filter((r) => !recent30.includes(r))

  // THE ISP IS THE DOCUMENT, not our reading of it.
  const ispDoc = client.isp_doc_url ?? ''
  // The house's live calendar (House Calendars, a week at a time).
  const house = client.houseName || houseForClient(client, houses, rows)
  const houseHref = house ? `${houseCalLink(house)}&range=week` : ''

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Link
          to="/app/clients/directory"
          className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-text-3 hover:text-text-1"
        >
          <ArrowLeft size={14} />
          Directory
        </Link>
      </div>

      {/* the hero is the drag handle: a chart is opened FROM a name, so the
          next thing a hand reaches for is that name on the tracker */}
      <DragPerson
        name={client.name}
        id={client.id}
        type="client"
        avatar={client.avatar}
        subtitle={client.supervisionShort || client.clientNumber}
        title={`Drag ${client.name} to the top-left to focus the whole workspace on them`}
        className="block"
      >
        <Card className="flex flex-wrap items-center gap-4">
          <Avatar src={client.avatar ?? ''} name={client.name} size="lg" ring eager />
          <div className="min-w-0 flex-1">
            <h1 className="truncate font-display text-[26px] font-bold leading-8 text-text-1">{client.name}</h1>
            <p className="truncate text-[13.5px] text-text-3">
              {client.supervisionShort || 'Supervision not recorded'}
              {client.clientNumber ? ` · ${client.clientNumber}` : ''}
            </p>
          </div>
          <div className="flex shrink-0 flex-col gap-2">
            {/*
              THE HOUSE IS NOT GUESSED. `shifts` carries a house per shift and
              the plans carry a street address, but NOTHING in our data says
              which house a client lives in — and matching them by address or
              by name is exactly the join that puts one person's record on
              another's. So the button lights up when the house is KNOWN (a
              typed clients-tab row, which clientsDerived_ already merges) and
              says why when it is not. The old screen greyed its link the same
              way rather than hiding it.
            */}
            {!opensCalendar ? null : houseHref ? (
              <Link
                to={houseHref}
                className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-[13.5px] font-semibold text-on-primary hover:opacity-90"
              >
                <CalendarDays size={15} />
                Calendar
              </Link>
            ) : (
              <span
                title="No house is recorded for this client, and a house guessed from an address is how one person's calendar ends up on another's chart."
                className="inline-flex cursor-not-allowed items-center gap-2 rounded-md bg-surface-2 px-4 py-2 text-[13.5px] font-semibold text-text-3"
              >
                <CalendarDays size={15} />
                Calendar
              </span>
            )}
            {ispDoc ? (
              <button
                onClick={() =>
                  openFile({
                    title: client.isp_doc_name || `ISP — ${client.name}`,
                    subtitle: client.isp_year || 'Individual Service Plan',
                    url: ispDoc,
                    icon: 'clipboard-plus',
                  })
                }
                className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-[13.5px] font-semibold text-on-primary hover:opacity-90"
              >
                <FileText size={15} />
                ISP
              </button>
            ) : (
              <span
                title="No single plan in the ISP folder names this client — and opening the wrong person's plan is not a risk worth a button."
                className="inline-flex cursor-not-allowed items-center gap-2 rounded-md bg-surface-2 px-4 py-2 text-[13.5px] font-semibold text-text-3"
              >
                <FileText size={15} />
                ISP
              </span>
            )}
          </div>
        </Card>
      </DragPerson>

      {/* the six, then the shared sections this viewer's apps admit — the old screen's shape, this
          platform's tokens */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'rounded-lg px-3 py-3 text-[13.5px] font-semibold transition-colors',
              current === t.id
                ? 'bg-primary text-on-primary'
                : 'bg-surface-2 text-text-2 hover:bg-surface-3',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {current === 'demographics' && (
        <Card>
          <div className="mx-auto max-w-[520px] divide-y divide-border text-center">
            <Stacked label="Date of Birth" value={longBirthday(client.dob)} />
            <Stacked label="Home Address" value={client.home_address} />
            <Stacked
              label="Guardian"
              value={guardian}
              person={{ name: guardian, type: 'client', subtitle: `Guardian of ${client.name}` }}
            />
            <Stacked
              label="S.S.A."
              value={client.ssa_name}
              person={{ name: client.ssa_name, type: 'staff', subtitle: `SSA · ${client.name}` }}
            />
            <Stacked
              label="S.S.A. Phone"
              value={client.ssa_phone ? formatPhoneDisplay(client.ssa_phone) : undefined}
              href={client.ssa_phone ? `tel:${client.ssa_phone.replace(/\D/g, '')}` : undefined}
            />
            <Stacked
              label="Phone"
              value={client.client_phone ? formatPhoneDisplay(client.client_phone) : undefined}
              href={client.client_phone ? `tel:${client.client_phone.replace(/\D/g, '')}` : undefined}
            />
            <Stacked label="House" value={house} />
            <Stacked label="County" value={client.county} />
            <Stacked label="Sex" value={client.sex} />
            <Stacked label="DODD #" value={client.dodd_id} />
            <Stacked label="Funding Source" value={client.funding_source} />
            <Stacked
              label="Emergency Contact"
              value={[client.emergency_name, client.emergency_phone && formatPhoneDisplay(client.emergency_phone)].filter(Boolean).join(' · ')}
              person={{ name: client.emergency_name, type: 'client', subtitle: `Emergency contact · ${client.name}` }}
            />
            <Stacked label="ISP Period" value={client.isp_year} />
          </div>
          {!client.dob && !client.home_address && (
            <Note>
              This client&apos;s plan carries no Contact Information page, so the platform holds no date of birth or
              address for them.
            </Note>
          )}
        </Card>
      )}

      {current === 'summary' && (
        <Card>
          {client.summary ? (
            <Prose value={client.summary} />
          ) : (
            <p className="text-[13.5px] text-text-3">The service plan carries no summary for {client.name}.</p>
          )}
        </Card>
      )}

      {current === 'care' && (
        <Card className="space-y-3">
          {!careAvailable.length ? (
            <p className="text-[13.5px] text-text-3">
              The service plan carries no care instructions for {client.name}.
            </p>
          ) : (
            <>
              <CategoryDropdown options={careAvailable} value={careKey} onChange={setCare} />
              <div className="rounded-lg border border-border bg-surface-2 px-4 py-4">
                <Prose value={String(client[careKey as keyof ClientRow] ?? '')} />
              </div>
              {careAvailable.length < 5 && (
                <Note>
                  Only the categories this plan covers are shown. Routine, Community Involvement and Finances are not
                  part of a service plan and are held nowhere the platform can read.
                </Note>
              )}
            </>
          )}
        </Card>
      )}

      {current === 'medical' && (
        <Card className="space-y-3">
          {!medPlan.length && (
            <p className="text-[13.5px] text-text-3">The service plan records nothing medical for {client.name}.</p>
          )}
          <CategoryDropdown options={medAvailable} value={medKey} onChange={setMed} />
          {/* Daily mounts only while it is the chosen entry, and reads only then */}
          {medKey === MEDICAL_DAILY.key ? (
            <DailySection client={client.name} look="record" clients={clientNames} />
          ) : !medKey ? (
            <p className="text-[13.5px] text-text-3">
              Choose Daily to read what the DSPs said about {client.name} on the hotline.
            </p>
          ) : (
            <div className="rounded-lg border border-border bg-surface-2 px-4 py-4">
              <Prose value={String(client[medKey as keyof ClientRow] ?? '')} />
            </div>
          )}
        </Card>
      )}

      {current === 'appointments' && (
        <div className="space-y-3">
          {/* The old screen sent people to an unprefilled Google Form whose
              answers were joined back by a typed name. Ours opens the platform's
              own Dr Appointments screen — same door as the ISP, inside. */}
          <div className="flex justify-center">
            <Link
              to="/app/dr-appointments/upcoming"
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-[13.5px] font-semibold text-on-primary hover:opacity-90"
            >
              <CalendarPlus size={15} />
              Dr Appointments
            </Link>
          </div>
          <ApptCard
            title="Upcoming Appointments"
            icon={CalendarDays}
            rows={upcoming}
            accent="border-l-tint-fg-mint"
            empty="No upcoming appointments scheduled."
          />
          <ApptCard
            title="Recent Appointments"
            icon={History}
            rows={recentAppts}
            accent="border-l-border"
            empty="No visit in the last 60 days is on file."
          />
        </div>
      )}

      {current === 'incidents' && (
        <Card className="space-y-4">
          {incidents.err && <Note>{incidents.err}</Note>}
          {incidents.busy && <p className="text-[14px] text-text-3">Reading the incident log…</p>}
          {/* same rule as the appointments door: the platform's own screen,
              never a form somebody has to type the client's name into */}
          <div className="flex justify-center">
            <Link
              to="/app/ui-incidents/log"
              className="inline-flex items-center gap-2 rounded-md bg-tint-fg-pink px-4 py-2 text-[13.5px] font-semibold text-surface hover:opacity-90"
            >
              <TriangleAlert size={15} />
              Report New Incident
            </Link>
          </div>
          {incidents.loaded && !incidents.err && (
            <>
              <IncidentCounters rows={incidents.mine} />
              {!incidents.mine.length ? (
                incidents.initialsOnly ? (
                  <Note>
                    No incident could be matched to {client.name}. The incident log identifies people by initials, and
                    matching a chart to initials would risk putting one client’s record on another’s.
                  </Note>
                ) : (
                  <p className="text-[13.5px] text-text-3">No incident names {client.name}.</p>
                )
              ) : (
                <>
                  <div className="space-y-2">
                    <p className="text-[13px] font-semibold text-text-2">Recent Incidents (Last 30 Days)</p>
                    {recent30.length ? (
                      recent30.map((r, i) => <IncidentFull key={String(r.id ?? i)} r={r} />)
                    ) : (
                      <p className="text-[13.5px] text-text-3">No incident in the last 30 days.</p>
                    )}
                  </div>
                  {older.length > 0 && (
                    <div className="space-y-2">
                      <button
                        onClick={() => setOlderOpen((v) => !v)}
                        className="flex items-center gap-2 text-[13.5px] font-semibold text-text-2 hover:text-text-1"
                      >
                        <ChevronDown size={15} className={cn('transition-transform', olderOpen && 'rotate-180')} />
                        <Clock size={14} className="text-text-3" />
                        View Older Incidents ({older.length})
                      </button>
                      {olderOpen && <OlderIncidents rows={older} />}
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </Card>
      )}

      {/* The sections shared with the Unique view, drawn by the component that view mounts. It stays mounted
          while no section is chosen, so Finances — kept behind the others once opened — is not read again on
          the way back; nothing else reads until its own section is opened. */}
      <div hidden={!isSharedSection(current)}>
        <Card>
          <ClientSections current={current} client={client} financeAllowed={financeAllowed} />
        </Card>
      </div>
    </div>
  )
}

/** Its own component so the pager's state is not held by the whole page. */
function OlderIncidents({ rows }: { rows: IncidentRow[] }) {
  const pager = usePager(rows, PAGE_SIZE, rows.length)
  return (
    <div className="space-y-2">
      {pager.slice.map((r, i) => <IncidentCompact key={String(r.id ?? i)} r={r} />)}
      <Pager {...pager} onPage={pager.setPage} noun="incidents" />
    </div>
  )
}
