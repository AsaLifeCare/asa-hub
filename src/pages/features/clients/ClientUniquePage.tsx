// Unique — the third view of the Clients app: one client, one screen, no tabs-as-pages.
// Three columns, the shape the prototype drew ("Client Profile — Layout Prototype v3"): identity and contacts on…
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router'
import {
  ArrowLeft, CalendarDays, CalendarPlus, ChevronDown, FileText, History,
  HeartPulse, Mail, MapPin, Search, ShieldAlert, Siren, User,
} from 'lucide-react'
import Card from '@/components/shared/Card'
import Avatar from '@/components/shared/Avatar'
import DragPerson from '@/components/shared/DragPerson'
import Pager from '@/components/shared/Pager'
import ProfileGrid from '@/components/shared/ProfileGrid'
import { PAGE_SIZE, usePager } from '@/lib/pager'
import { api } from '@/lib/api'
import { openFile } from '@/stores/useFileViewerStore'
import { composeEmail } from '@/stores/useEmailComposeStore'
import { useCan } from '@/auth/permissions'
import { useClientsPolicyStore } from '@/stores/useClientsPolicyStore'
import { formatPhoneDisplay } from '@/lib/phoneFormat'
import type { TintName } from '@/engine/types'
import ClientsToolbar from './ClientsToolbar'
import DailySection from './daily/DailySection'
import { useDailyPlaceScope } from './daily/useDailyPlace'
import { cn } from '@/lib/utils'
import {
  type ClientRow, dayOf, todayIso, daysAgoIso, longBirthday, longDay, clockOf,
  useIncidents, incidentBits, houseForClient, useHouses,
} from './shared'
import { Chip, Row, SectionHead } from './unique/parts'
import { useRecordTabs } from './unique/useRecordTabs'
import TabStrip from './unique/TabStrip'
import ClientSections from './unique/ClientSections'

export const CLIENT_UNIQUE_PERM = 'clients.view'

// ------------------------------------------------------------------ small pieces…

/** Age from the ISO day, by parts — never by constructing a Date from it. */
function ageOf(dobIso: string): string {
  const iso = dayOf(dobIso)
  if (!iso) return ''
  const [y, m, d] = iso.split('-').map(Number)
  const t = todayIso().split('-').map(Number)
  let age = t[0] - y
  if (t[1] < m || (t[1] === m && t[2] < d)) age--
  return age >= 0 && age < 130 ? String(age) : ''
}

function Prose({ value }: { value?: string }) {
  const v = String(value ?? '').trim()
  if (!v) return <p className="text-[13px] text-text-3">Nothing recorded on the plan.</p>
  return (
    <div className="space-y-2.5">
      {v.split(/\n{2,}/).map((p, i) => (
        <p key={i} className="whitespace-pre-line text-[13.5px] leading-6 text-text-2">{p.trim()}</p>
      ))}
    </div>
  )
}

type AccordionItem = {
  id: string
  label: string
  /** plan text is drawn as Prose; anything else is drawn as given */
  body?: ReactNode
  /** kept even when it has no plan text — its body is read, not written */
  always?: boolean
}

/** An item earns its place with plan text, or by being one that is always offered. */
const hasBody = (i: AccordionItem) => !!i.always || (typeof i.body === 'string' && !!i.body.trim())

// The center accordion — one open at a time, the prototype's acc-item.
function Accordion({ items }: { items: AccordionItem[] }) {
  const [open, setOpen] = useState<string>(() => items.find((i) => !i.always)?.id ?? '')
  return (
    <div className="space-y-1.5">
      {items.map((it) => (
        <div key={it.id} className="overflow-hidden rounded-lg border border-border">
          <button
            onClick={() => setOpen(open === it.id ? '' : it.id)}
            className="flex w-full items-center justify-between bg-surface px-3.5 py-2.5 text-left text-[13.5px] font-semibold text-text-1 hover:bg-surface-2"
          >
            {it.label}
            <ChevronDown size={15} className={cn('text-text-3 transition-transform', open === it.id && 'rotate-180')} />
          </button>
          {open === it.id && (
            <div className="border-t border-border bg-surface-2 px-3.5 py-3">
              {it.body === undefined || it.body === null || typeof it.body === 'string'
                ? <Prose value={it.body ?? undefined} />
                : it.body}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// The Views chooser MOVED to ClientsPage.tsx: the three views are one page now, and the selector that switches…

// ------------------------------------------------------------------ the page…

export default function ClientUniquePage() {
  const [searchParams] = useSearchParams()
  const recordId = searchParams.get('record') ?? ''
  const canView = useCan(CLIENT_UNIQUE_PERM)
  const [tab, setTab] = useState('summary')
  const tabsRef = useRef<HTMLDivElement>(null)
  const { tabs, current, financeAllowed } = useRecordTabs(tab)
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
  useEffect(() => { setTab('summary') }, [recordId])

  const client = useMemo(
    () => (recordId ? rows.find((r) => String(r.id) === recordId) ?? null : null),
    [rows, recordId],
  )
  const incidents = useIncidents(client?.name ?? '', current === 'incidents' && !!client)
  // Daily's page and filter outlive the accordion, not this chart
  useDailyPlaceScope(client?.name ?? '')
  // every client's name, so Daily can tell a spelling close to this client from one closer to somebody else
  const clientNames = useMemo(() => rows.map((r) => String(r.name ?? '')).filter(Boolean), [rows])
  // The house lives in the platform's own roster: the individual homes are named by the person's initials on the…
  const houses = useHouses(!!recordId)

  // THE MASTER'S POLICY: a view disabled in Settings does not exist — the sidebar hides it, the chooser does not…
  const masterViews = useClientsPolicyStore((s) => s.views)
  const policyFetched = useClientsPolicyStore((s) => s.fetched)
  const ensurePolicy = useClientsPolicyStore((s) => s.ensure)
  useEffect(() => { ensurePolicy() }, [ensurePolicy])
  if (policyFetched && !(masterViews as string[]).includes('unique')) {
    return <Navigate to="/app/clients/directory" replace />
  }

  if (!canView) {
    return (
      <div className="mx-auto max-w-[560px] pt-10">
        <Card className="flex flex-col items-center gap-3 px-6 py-10 text-center">
          <span className="grid h-12 w-12 place-items-center rounded-full bg-tint-amber text-tint-fg-amber">
            <ShieldAlert size={22} />
          </span>
          <h2 className="font-display text-[17px] font-bold text-text-1">This view is not open to you</h2>
          <p className="max-w-[380px] text-[13px] leading-5 text-text-2">
            It requires the <span className="font-mono text-[12px]">{CLIENT_UNIQUE_PERM}</span> permission.
          </p>
        </Card>
      </div>
    )
  }

  if (!recordId) return <UniquePicker rows={rows} loading={loading} error={error} />
  if (loading && !client) return <p className="text-[14px] text-text-3">Loading this client…</p>
  if (!client) {
    return (
      <div className="space-y-3">
        <p className="rounded-md border border-border bg-surface-2 px-3 py-2 text-[13px] text-text-3">
          {error || `No client on file carries the id “${recordId}”.`}
        </p>
        <Link to="/app/clients/unique" className="text-[13.5px] font-semibold text-primary hover:underline">
          Choose a client
        </Link>
      </div>
    )
  }

  const guardian = client.guardian_name || client.guardianName || ''
  const house = client.houseName || houseForClient(client, houses, rows)
  const upcoming = client.appointments ?? []
  const recent = client.recentAppointments ?? []
  const openIsp = client.isp_doc_url
    ? () => openFile({ title: client.isp_doc_name || `ISP — ${client.name}`, subtitle: client.isp_year || 'Individual Service Plan', url: String(client.isp_doc_url), icon: 'clipboard-plus' })
    : null

  /** a rail shortcut also brings the tabs into view when they sit off-screen */
  const showTab = (id: string) => {
    setTab(id)
    const el = tabsRef.current
    if (!el) return
    const view = el.closest('main')?.getBoundingClientRect() ?? { top: 0, bottom: window.innerHeight }
    const top = el.getBoundingClientRect().top
    if (top < view.top || top > (view.top + view.bottom) / 2) el.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }

  const emailSummary = () =>
    composeEmail({
      subject: `${client.name} — client summary`,
      source: 'Unique view',
      body: [
        `${client.name} (${client.clientNumber || client.client_key || ''})`,
        client.dob ? `DOB: ${longBirthday(client.dob)}` : '',
        client.home_address ? `Address: ${client.home_address}` : '',
        guardian ? `Guardian: ${guardian}` : '',
        client.supervisionShort ? `Supervision: ${client.supervisionShort}` : '',
        '',
        String(client.summary ?? '').trim(),
      ].filter((l) => l !== '').join('\n'),
    })

  const tags = [
    client.supervisionShort,
    house,
    client.county,
    client.isp_year ? 'ISP on file' : '',
  ].filter(Boolean) as string[]
  const TAG_TINTS: TintName[] = ['mint', 'blue', 'lavender', 'peach']

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Link to="/app/clients/directory" className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-text-3 hover:text-text-1">
          <ArrowLeft size={14} />
          All Clients
        </Link>
      </div>

      <ProfileGrid
        head={
          <Card className="text-center">
            <DragPerson name={client.name} id={client.id} type="client" avatar={client.avatar} subtitle={client.clientNumber} className="block">
              <div className="flex flex-col items-center gap-2">
                <Avatar src={client.avatar ?? ''} name={client.name} size="xl" ring eager />
                <div>
                  <p className="font-display text-[17px] font-bold leading-6 text-text-1">{client.name}</p>
                  <p className="text-[12px] text-text-3">
                    {client.clientNumber || client.client_key}
                    {client.isp_year ? ` · ISP ${String(client.isp_year).slice(0, 24)}` : ''}
                  </p>
                </div>
                {client.status ? (
                  <Chip tint={String(client.status).toLowerCase() === 'active' ? 'mint' : 'pink'}>
                    {String(client.status).toUpperCase()}
                  </Chip>
                ) : null}
              </div>
            </DragPerson>
          </Card>
        }
        rail={
          <>
            <Card>
              <SectionHead>Quick Actions</SectionHead>
              <div className="grid grid-cols-1 gap-x-3 gap-y-1 sm:grid-cols-2 lg:grid-cols-1">
                {openIsp && (
                  <RailAction icon={FileText} title="View ISP Document" desc="The signed plan, in the viewer" onClick={openIsp} />
                )}
                <RailAction icon={User} title="Open Record" desc="The six-tab record view" to={`/app/clients/record?record=${encodeURIComponent(client.id)}`} />
                {/* these three switch the center tab instead of leaving the page */}
                <RailAction icon={HeartPulse} title="Care Instructions" desc="Routine, safety, behavioral" onClick={() => showTab('care')} />
                <RailAction icon={CalendarDays} title="Dr Appointments" desc="Scheduled and recent visits" onClick={() => showTab('appointments')} />
                <RailAction icon={Siren} title="Report Incident" desc="This client's incident history" onClick={() => showTab('incidents')} />
                <RailAction icon={Mail} title="Send by e-mail" desc="This summary, from asa-hub" onClick={emailSummary} />
              </div>
            </Card>

            <Card>
              <SectionHead>Known Risks</SectionHead>
              <Prose value={client.care_safety} />
            </Card>
          </>
        }
        story={
          <>
            {openIsp && (
              <Card>
                <SectionHead>Key Documents</SectionHead>
                <button
                  onClick={openIsp}
                  className="flex w-full items-center gap-3 rounded-lg border border-border px-3 py-2.5 text-left hover:bg-surface-2"
                >
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-tint-mint text-tint-fg-mint">
                    <FileText size={16} />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[13.5px] font-semibold text-text-1">ISP Document</span>
                    <span className="block truncate text-[12px] text-text-3">{client.isp_year || client.isp_doc_name}</span>
                  </span>
                </button>
              </Card>
            )}

            <Card>
              {/* underline tabs — the prototype's center strip, our tokens (unique/TabStrip) */}
              <div ref={tabsRef} className="mb-4 scroll-mt-10">
                <TabStrip
                  tabs={tabs}
                  current={current}
                  counts={{ incidents: incidents.loaded ? incidents.mine.length : 0 }}
                  onPick={setTab}
                />
              </div>

              {current === 'summary' && (
                <div className="space-y-5">
                  <div>
                    <SectionHead>Care Summary</SectionHead>
                    <Prose value={client.summary} />
                  </div>
                  <div>
                    <SectionHead>Important To {client.name.split(' ')[0]}</SectionHead>
                    <Prose value={client.important_to} />
                  </div>
                  <div>
                    <SectionHead>Important For {client.name.split(' ')[0]}</SectionHead>
                    <Prose value={client.important_for} />
                  </div>
                </div>
              )}

              {current === 'care' && (
                <div className="space-y-3">
                  {client.isp_year ? (
                    <p className="text-[12px] font-semibold text-text-3">ISP Period: {client.isp_year}</p>
                  ) : null}
                  <Accordion items={[
                    { id: 'comm', label: 'Communication', body: client.care_communication },
                    { id: 'safety', label: 'Safety', body: client.care_safety },
                    { id: 'daily', label: 'Daily Living', body: client.care_daily_living },
                    { id: 'behavior', label: 'Behavioral Support', body: client.care_behavioral },
                    { id: 'nutrition', label: 'Nutrition', body: client.care_nutrition },
                  ].filter(hasBody)} />
                  <p className="text-[12px] leading-4 text-text-3">
                    Only the categories this plan covers are shown — Routine, Community and Finances are not part of a
                    service plan.
                  </p>
                </div>
              )}

              {current === 'medical' && (
                <Accordion items={[
                  { id: 'allergies', label: 'Allergies', body: client.allergies_text },
                  { id: 'diagnoses', label: 'Core Diagnoses', body: client.diagnoses_text },
                  { id: 'meds', label: 'Medications', body: client.medications_text },
                  // what the DSPs said on the hotline — offered whatever the plan holds
                  { id: 'daily-notes', label: 'Daily', body: <DailySection client={client.name} look="unique" clients={clientNames} />, always: true },
                  { id: 'supervision', label: 'Supervision Level', body: client.supervision_level },
                  { id: 'goals', label: 'Goals & Outcomes', body: client.goals_outcomes },
                ].filter(hasBody)} />
              )}

              {current === 'appointments' && (
                <div className="space-y-4">
                  <div className="flex justify-center">
                    <Link
                      to="/app/dr-appointments/upcoming"
                      className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-[13px] font-semibold text-on-primary hover:opacity-90"
                    >
                      <CalendarPlus size={14} />
                      Dr Appointments
                    </Link>
                  </div>
                  <ApptGroup title="Scheduled" rows={upcoming} accent="border-l-tint-fg-mint" empty="No upcoming appointment is scheduled." />
                  <ApptGroup title="Recent" rows={recent} accent="border-l-border" empty="No visit in the last 60 days is on file." />
                </div>
              )}

              {current === 'incidents' && (
                <div className="space-y-3">
                  {incidents.err && (
                    <p className="rounded-md border border-border bg-surface-2 px-3 py-2 text-[13px] text-text-3">{incidents.err}</p>
                  )}
                  {incidents.busy && <p className="text-[13.5px] text-text-3">Reading the incident log…</p>}
                  {incidents.loaded && !incidents.err && (
                    incidents.mine.length ? (
                      <IncidentList rows={incidents.mine} />
                    ) : (
                      <p className="text-[13.5px] text-text-3">
                        {incidents.initialsOnly
                          ? `No incident could be matched to ${client.name} — the log identifies people by initials.`
                          : `No incident names ${client.name}.`}
                      </p>
                    )
                  )}
                </div>
              )}

              {/* Finances (Client Finances merged in) and the four wellbeing sections — the same component
                  the Record view mounts, against the same reads */}
              <ClientSections current={current} client={client} financeAllowed={financeAllowed} />
            </Card>
          </>
        }
        details={
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,15rem),1fr))] gap-3">
            <Card>
              <SectionHead>Personal Details</SectionHead>
              <Row label="Date of Birth" value={longBirthday(client.dob)} />
              <Row label="Age" value={ageOf(String(client.dob ?? ''))} />
              <Row label="House" value={house} />
              <Row label="Address" value={client.home_address} />
              <Row label="County" value={client.county} />
            </Card>

            <Card>
              <SectionHead>Guardian</SectionHead>
              <Row label="Name" value={guardian} person={{ name: guardian, type: 'client', subtitle: `Guardian of ${client.name}` }} />
              <Row
                label="Phone"
                value={client.guardian_phone ? formatPhoneDisplay(client.guardian_phone) : undefined}
                href={client.guardian_phone ? `tel:${String(client.guardian_phone).replace(/\D/g, '')}` : undefined}
              />
            </Card>

            <Card>
              <SectionHead>Care Team</SectionHead>
              <Row
                label="SSA"
                value={[client.ssa_name, client.ssa_phone && formatPhoneDisplay(client.ssa_phone)].filter(Boolean).join(' · ')}
                person={{ name: String(client.ssa_name ?? ''), type: 'staff', subtitle: `SSA · ${client.name}` }}
              />
              <Row label="SSA e-mail" value={client.ssa_email} />
              <Row
                label="Emergency"
                value={[client.emergency_name, client.emergency_phone && formatPhoneDisplay(client.emergency_phone)].filter(Boolean).join(' · ')}
                person={{ name: String(client.emergency_name ?? ''), type: 'client', subtitle: `Emergency contact · ${client.name}` }}
              />
            </Card>

            {tags.length > 0 && (
              <Card>
                <SectionHead>Tags</SectionHead>
                <div className="flex flex-wrap gap-1.5">
                  {tags.map((t, i) => <Chip key={t} tint={TAG_TINTS[i % TAG_TINTS.length]}>{t}</Chip>)}
                </div>
              </Card>
            )}
          </div>
        }
      />
    </div>
  )
}

// ------------------------------------------------------------------ satellites…

function RailAction({ icon: Icon, title, desc, to, onClick }: {
  icon: typeof FileText; title: string; desc: string; to?: string; onClick?: () => void
}) {
  const body = (
    <>
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-surface-2 text-text-2">
        <Icon size={15} />
      </span>
      <span className="min-w-0 text-left">
        <span className="block truncate text-[13px] font-semibold text-text-1">{title}</span>
        <span className="block truncate text-[11.5px] text-text-3">{desc}</span>
      </span>
    </>
  )
  const cls = 'flex w-full items-center gap-2.5 rounded-lg px-2 py-2 hover:bg-surface-2'
  return to
    ? <Link to={to} className={cls}>{body}</Link>
    : <button onClick={onClick} className={cls}>{body}</button>
}

function ApptGroup({ title, rows, accent, empty }: {
  title: string; rows: NonNullable<ClientRow['appointments']>; accent: string; empty: string
}) {
  const pager = usePager(rows, PAGE_SIZE, rows.length)
  return (
    <div>
      <SectionHead>{title} ({rows.length})</SectionHead>
      {!rows.length ? (
        <p className="text-[13px] text-text-3">{empty}</p>
      ) : (
        <div className="space-y-2">
          {pager.slice.map((a) => {
            const clock = clockOf(a.time)
            return (
              <div key={a.id} className={cn('rounded-md border-l-[3px] bg-surface-2 py-2 pl-3 pr-3', accent)}>
                <p className="flex items-center gap-2 text-[13px] text-text-2">
                  <CalendarDays size={13} className="shrink-0 text-text-3" />
                  {longDay(a.date)}{clock ? ` at ${clock}` : ''}
                </p>
                <p className="mt-0.5 flex items-center gap-2 text-[13.5px] font-semibold text-text-1">
                  <User size={13} className="shrink-0 text-text-3" />
                  {a.doctor || a.title || 'Doctor not specified'}
                </p>
                {a.location ? (
                  <p className="mt-0.5 flex items-center gap-2 text-[12.5px] text-text-3">
                    <MapPin size={13} className="shrink-0" />
                    {a.location}
                  </p>
                ) : null}
              </div>
            )
          })}
          <Pager {...pager} onPage={pager.setPage} noun="appointments" />
        </div>
      )}
    </div>
  )
}

function IncidentList({ rows }: { rows: ReturnType<typeof useIncidents>['mine'] }) {
  const today = todayIso()
  const recent = rows.filter((r) => { const d = dayOf(r.date ?? r.occurredAt); return !!d && d >= daysAgoIso(30) && d <= today })
  const older = rows.filter((r) => !recent.includes(r))
  const [showOlder, setShowOlder] = useState(false)
  const pager = usePager(showOlder ? older : [], PAGE_SIZE, showOlder)
  return (
    <div className="space-y-2">
      {recent.length ? recent.map((r, i) => {
        const b = incidentBits(r)
        return (
          <div key={String(r.id ?? i)} className="rounded-md border-l-[3px] border-l-tint-fg-pink bg-surface-2 px-3 py-2.5">
            <div className="flex flex-wrap items-start gap-2">
              <span className="text-[12px] font-semibold tabular-nums text-text-3">
                {longDay(r.date ?? r.occurredAt)}{b.clock ? ` at ${b.clock}` : ''}
              </span>
              <span className="ml-auto rounded-full bg-surface px-2 py-0.5 text-[10.5px] text-text-3">{b.category}</span>
            </div>
            {b.text ? <p className="mt-1.5 whitespace-pre-line text-[13px] leading-5 text-text-2">{b.text}</p> : null}
            {b.by ? (
              <p className="mt-1 text-[12px] text-text-3">
                Reported by:{' '}
                <DragPerson name={b.by} id={b.by} type="staff" subtitle="Reported the incident">
                  {b.by}
                </DragPerson>
              </p>
            ) : null}
          </div>
        )
      }) : <p className="text-[13px] text-text-3">No incident in the last 30 days.</p>}
      {older.length > 0 && (
        <>
          <button
            onClick={() => setShowOlder((v) => !v)}
            className="flex items-center gap-2 text-[13px] font-semibold text-text-2 hover:text-text-1"
          >
            <History size={13} className="text-text-3" />
            {showOlder ? 'Hide older incidents' : `View Older Incidents (${older.length})`}
          </button>
          {showOlder && (
            <div className="space-y-1.5">
              {pager.slice.map((r, i) => {
                const b = incidentBits(r)
                return (
                  <div key={String(r.id ?? i)} className="rounded-md border border-border px-3 py-2">
                    <div className="flex items-start gap-2">
                      <p className="text-[12.5px] font-semibold text-text-1">{longDay(r.date ?? r.occurredAt)}</p>
                      <span className="ml-auto text-[11px] text-text-3">{b.category}</span>
                    </div>
                    {b.text ? <p className="mt-0.5 text-[12.5px] leading-5 text-text-3">{b.text}</p> : null}
                  </div>
                )
              })}
              <Pager {...pager} onPage={pager.setPage} noun="incidents" />
            </div>
          )}
        </>
      )}
    </div>
  )
}

function UniquePicker({ rows, loading, error }: { rows: ClientRow[]; loading: boolean; error: string }) {
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
          <h1 className="font-display text-[24px] font-bold leading-8 text-text-1">Unique</h1>
          <p className="text-[14px] text-text-3">One client, one screen. Choose who.</p>
        </div>
        <ClientsToolbar rows={rows} view="Unique" />
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
      {error && <p className="rounded-md border border-border bg-surface-2 px-3 py-2 text-[13px] text-text-3">{error}</p>}
      {loading && !rows.length && <p className="text-[14px] text-text-3">Loading clients…</p>}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {pager.slice.map((c) => (
          <Link key={c.id} to={`/app/clients/unique?record=${encodeURIComponent(c.id)}`}>
            <Card hover className="flex items-center gap-3">
              {/* the avatar AND the name drag the PERSON to the focus tracker;
                  the card click opens the view — two gestures, one card */}
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
