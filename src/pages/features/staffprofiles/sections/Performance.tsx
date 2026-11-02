// Performance: one staff member's last 90 days in six views — Overview (the score with its formula, what needs…
// Every figure is the server's (staffProfilePerformance) from sources the platform reads; a source it cannot read…
import { useCallback, type ReactNode } from 'react'
import {
  AlertTriangle, CalendarClock, ClipboardCheck, Clock, FileText, GraduationCap, Lock, MessageSquareText, Pencil, Plus, ShieldAlert,
  Upload, type LucideIcon,
} from 'lucide-react'
import { useAuthStore } from '@/auth/useAuthStore'
import { keep, readKept } from '@/lib/kept'
import { placeScope } from '@/lib/placeKey'
import { cn } from '@/lib/utils'
import { SectionCard } from '@/pages/features/locations/LocationParts'
import { priorityLabel } from '@/pages/features/locations/locationModel'
import {
  categoryLabel, dateWords, mayAsk, mayEditSection, notesOf, staffCan, stampWords, type PillTint, type RosterRow, type StaffAsk,
} from '../staffModel'
import {
  ATT_META, DOC_AREA_WORDS, HR_META, PERF_VIEWS, concludable, courseMeta, docMeta, pct, performanceOf, spanWords,
  type DocArea, type PerfCourse, type PerfView, type Performance,
} from '../perfModel'
import { readKey, readNotes, readPerformance, useStaffRead } from '../useStaffRead'
import { useStaffViewer } from '../staffViewer'
import { EditPencil, EmptyNote, Pill, ReadLine, WhyNote } from '../StaffParts'

const KEPT_PREFIX = 'asa:staff:perf:'
const NOT_CONNECTED = 'Not connected yet'

function ownerNow(): string {
  const uid = useAuthStore.getState().user?.id ?? ''
  return uid ? placeScope(uid) : ''
}

type KeptPerf = { owner: string; raw: unknown }

function keptRaw(staff: string): unknown {
  const owner = ownerNow()
  if (!owner) return null
  const got = readKept<KeptPerf>(`${KEPT_PREFIX}${owner}|${staff}`)
  return got && got.owner === owner ? got.raw : null
}

function keepRaw(staff: string, raw: unknown): void {
  const owner = ownerNow()
  if (owner) keep(`${KEPT_PREFIX}${owner}|${staff}`, { owner, raw } satisfies KeptPerf)
}

const day = (v: string): string => (v ? dateWords(v) : '—')

export default function PerformanceSection({ row, view, onView, onAsk }: {
  row: RosterRow
  view: PerfView
  onView: (view: string) => void
  onAsk: (ask: StaffAsk) => void
}) {
  const staff = row.key
  const load = useCallback(() => readPerformance(staff).then((raw) => { keepRaw(staff, raw); return raw }), [staff])
  const perf = useStaffRead(readKey('staffProfilePerformance', staff), load, performanceOf, () => keptRaw(staff))
  const p = perf.data
  return (
    <div className="grid min-w-0 gap-5" data-performance={view}>
      <ViewBar view={view} onView={onView} />
      {view === 'notes' ? <NotesView row={row} onAsk={onAsk} /> : (
        <>
          <ReadLine state={perf} what="the performance record" onRetry={perf.reload} />
          {p && <WhyNote why={p.why} degraded={p.degraded} />}
          {p && view === 'overview' && <OverviewView p={p} />}
          {p && view === 'attendance' && <AttendanceView p={p} />}
          {p && view === 'training' && <TrainingView p={p} row={row} onAsk={onAsk} />}
          {p && view === 'documentation' && <DocumentationView p={p} row={row} onAsk={onAsk} />}
          {p && view === 'hr' && <HrView p={p} row={row} onAsk={onAsk} />}
        </>
      )}
    </div>
  )
}

function ViewBar({ view, onView }: { view: PerfView; onView: (view: string) => void }) {
  return (
    <nav aria-label="Performance views" className="scroll-thin overflow-x-auto rounded-[16px] border border-border bg-surface p-1.5 shadow-1">
      <div className="flex w-max gap-1">
        {PERF_VIEWS.map((v) => {
          const on = v.id === view
          return (
            <button key={v.id} type="button" onClick={() => onView(v.id)} aria-current={on ? 'page' : undefined} data-perf-view={v.id}
              className={cn('whitespace-nowrap rounded-[11px] px-3.5 py-2 text-[13px] transition-colors',
                on ? 'bg-surface-2 font-semibold text-text-1' : 'text-text-2 hover:bg-surface-2/70 hover:text-text-1')}>
              {v.label}
            </button>
          )
        })}
      </div>
    </nav>
  )
}

/* ---------- shared pieces ---------- */

function Kpi({ label, value, sub, quiet = false }: { label: string; value: string; sub: string; quiet?: boolean }) {
  return (
    <div className="min-w-0 rounded-[18px] border border-border bg-surface p-4 shadow-1" data-kpi={label}>
      <p className="truncate text-[10.5px] font-semibold uppercase tracking-[0.1em] text-text-3">{label}</p>
      <p className={cn('mt-2 font-display font-bold leading-7 tabular-nums', quiet ? 'text-[15px] text-text-3' : 'text-[24px] text-text-1')}>
        {value}
      </p>
      <p className="mt-1 text-[12px] leading-4 text-text-3">{sub}</p>
    </div>
  )
}

const barTone = (v: number): string => (v >= 90 ? 'bg-[var(--success)]' : v >= 70 ? 'bg-[var(--warning)]' : 'bg-[var(--danger)]')

function Bar({ label, value }: { label: string; value: number }) {
  const w = Math.max(0, Math.min(100, value))
  return (
    <div data-bar={label}>
      <div className="flex items-baseline justify-between gap-3 text-[13px]">
        <span className="text-text-1">{label}</span>
        <span className="font-semibold tabular-nums text-text-1">{value}%</span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-2">
        <div className={cn('h-2 rounded-full', barTone(w))} style={{ width: `${w}%` }} />
      </div>
    </div>
  )
}

const TONE_RING: Record<PillTint, string> = {
  mint: 'bg-tint-mint text-tint-fg-mint',
  amber: 'bg-tint-amber text-tint-fg-amber',
  danger: 'bg-tint-danger text-tint-fg-danger',
  slate: 'bg-tint-slate text-tint-fg-slate',
  blue: 'bg-tint-blue text-tint-fg-blue',
  lavender: 'bg-tint-lavender text-tint-fg-lavender',
}

function IconDot({ icon: Icon, tone }: { icon: LucideIcon; tone: PillTint }) {
  return (
    <span className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-full', TONE_RING[tone])}>
      <Icon size={15} />
    </span>
  )
}

/** A wide table that scrolls inside its card, never the page. */
function Table({ head, rows, data }: { head: string[]; rows: ReactNode[][]; data: string }) {
  return (
    <div className="-mx-5 overflow-x-auto sm:-mx-6" data-table={data}>
      <table className="w-full min-w-[760px] border-collapse text-left text-[13px]">
        <thead>
          <tr className="border-y border-border bg-surface-2/50">
            {head.map((h) => (
              <th key={h} scope="col" className="whitespace-nowrap px-5 py-2.5 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-text-3 sm:first:pl-6">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((cells, i) => (
            <tr key={i} className="border-b border-border last:border-b-0">
              {cells.map((c, j) => <td key={j} className="px-5 py-3 align-top text-text-2 sm:first:pl-6">{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const Quiet = ({ children }: { children: ReactNode }) => <span className="text-text-3">{children}</span>

/* ---------- overview ---------- */

const NEED_ICON: Record<string, LucideIcon> = {
  'Mandatory training': GraduationCap, 'Value-add training': GraduationCap, 'Training request': GraduationCap,
  'HR & conduct': ShieldAlert, Attendance: CalendarClock, Documentation: FileText,
}

const ACTIVITY_ICON: Record<string, { icon: LucideIcon; tone: PillTint }> = {
  note: { icon: MessageSquareText, tone: 'blue' },
  attendance: { icon: CalendarClock, tone: 'amber' },
  documentation: { icon: FileText, tone: 'lavender' },
  hr: { icon: ShieldAlert, tone: 'slate' },
  training: { icon: GraduationCap, tone: 'mint' },
}

function OverviewView({ p }: { p: Performance }) {
  const a = p.attendance
  const t = p.training
  const docs = p.documentation
  const docExpected = docs.areas.filter((x) => x.connected).reduce((s, x) => s + x.expected, 0)
  const docOnTime = docs.areas.filter((x) => x.connected).reduce((s, x) => s + x.onTime, 0)
  const anyDoc = docs.areas.some((x) => x.connected)
  return (
    <div className="grid gap-5" data-perf-overview="">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 2xl:grid-cols-6">
        <Kpi label="Performance score" value={p.score.value === null ? '—' : `${p.score.value}/100`}
          sub={p.score.value === null ? 'No part has data yet' : `Computed ${dateWords(p.builtAt) || 'now'}`} quiet={p.score.value === null} />
        <Kpi label="Attendance reliability" value={pct(a.reliability)} quiet={a.reliability === null}
          sub={a.reliability === null ? (a.connected.punches ? 'No compared shift yet' : NOT_CONNECTED) : `On-time starts · last ${p.windowDays} days`} />
        <Kpi label="Mandatory current" value={t.connected ? `${t.mandatoryCurrent}/${t.mandatory.length}` : '—'} quiet={!t.connected}
          sub={t.connected ? 'Required for active work' : NOT_CONNECTED} />
        <Kpi label="Value-add current" value={t.valueAdd.length ? `${t.valueAddCurrent}/${t.valueAdd.length}` : '0'}
          sub="Current / recorded courses" />
        <Kpi label="Documentation" value={pct(docs.rate)} quiet={docs.rate === null}
          sub={anyDoc ? `${docOnTime}/${docExpected} expected records on time` : NOT_CONNECTED} />
        <Kpi label="Open HR matters" value={p.hr.connected ? String(p.hr.open) : '—'} quiet={!p.hr.connected}
          sub={p.hr.connected ? 'Open or under review' : NOT_CONNECTED} />
      </div>

      <div className="grid items-start gap-5 xl:grid-cols-2">
        <SectionCard title="Performance Summary">
          {p.score.parts.length === 0 ? <EmptyNote>No part of the score has data in the last {p.windowDays} days.</EmptyNote> : (
            <div className="grid gap-5" data-summary="">
              {p.score.parts.map((s) => <Bar key={s.id} label={`${s.label} · ${s.weight}%`} value={s.value} />)}
            </div>
          )}
          {p.score.formula && <p className="mt-5 text-[12px] leading-5 text-text-3" data-formula="">{p.score.formula}</p>}
        </SectionCard>

        <SectionCard title="Needs Attention">
          {p.needs.length === 0 ? <EmptyNote>Nothing needs attention from what the platform reads.</EmptyNote> : (
            <ul className="divide-y divide-border" data-needs="">
              {p.needs.map((n, i) => (
                <li key={`${n.title}|${i}`} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                  <IconDot icon={NEED_ICON[n.area] ?? AlertTriangle} tone={n.tone} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[13.5px] font-medium text-text-1">{n.title}</p>
                    <p className="mt-0.5 text-[12px] text-text-3">{[n.area, n.status, n.date ? dateWords(n.date) : ''].filter(Boolean).join(' · ')}</p>
                  </div>
                  <Pill meta={{ label: n.status, tint: n.tone }} />
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      <SectionCard title="Recent Performance Activity">
        {p.activity.length === 0 ? <EmptyNote>No performance activity in the last {p.windowDays} days.</EmptyNote> : (
          <ul className="divide-y divide-border" data-perf-activity="">
            {p.activity.map((e, i) => {
              const look = ACTIVITY_ICON[e.kind] ?? { icon: ClipboardCheck, tone: 'slate' as PillTint }
              return (
                <li key={`${e.at}|${i}`} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                  <IconDot icon={look.icon} tone={look.tone} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[13.5px] font-medium text-text-1">{e.title}</p>
                    {e.detail && <p className="mt-0.5 break-words text-[12px] text-text-3">{e.detail}</p>}
                  </div>
                  <span className="shrink-0 text-[12px] tabular-nums text-text-3">{dateWords(e.at)}</span>
                </li>
              )
            })}
          </ul>
        )}
      </SectionCard>
    </div>
  )
}

/* ---------- attendance ---------- */

function AttendanceView({ p }: { p: Performance }) {
  const a = p.attendance
  const c = a.counts
  const missing = [
    !a.connected.schedule && 'the Calendar Archive',
    !a.connected.scheduling && 'Scheduling',
    !a.connected.punches && 'the PSI punches',
    !a.connected.calloffs && 'the call-off book',
  ].filter(Boolean) as string[]
  const days = `Last ${p.windowDays} days`
  return (
    <div className="grid gap-5" data-perf-attendance="">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Tardy" value={String(c.tardy)} sub={`More than ${a.tardyMinutes} min late · ${days.toLowerCase()}`} />
        <Kpi label="Call-outs" value={String(c.callOuts)} sub="Notice recorded" />
        <Kpi label="No call / no show" value={String(c.ncns)} sub="Unreported absence" />
        <Kpi label="Other absences" value={String(c.other)} sub="Time off, requested off or sent home" />
      </div>
      <SectionCard title="Attendance History"
        sub={`Scheduled starts (Calendar Archive and Scheduling) are compared with PSI punches, the call-off book and Scheduling's call-offs. ${days}.`}>
        {missing.length > 0 && (
          <p className="mb-3 rounded-md bg-tint-amber px-3 py-2 text-[12px] leading-4 text-tint-fg-amber" data-not-connected="">
            {NOT_CONNECTED}: {missing.join(', ')} could not be read, so what it holds is not counted here.
          </p>
        )}
        {a.rows.length === 0 ? <EmptyNote>No scheduled shift, punch or call-off is on record in the last {p.windowDays} days.</EmptyNote> : (
          <Table data="attendance"
            head={['Date', 'Status', 'Shift', 'Scheduled', 'Actual', 'Notice', 'Excused', 'Details', 'Source']}
            rows={a.rows.map((r) => [
              <span className="whitespace-nowrap tabular-nums text-text-1">{day(r.date)}</span>,
              <Pill meta={ATT_META[r.status]} />,
              r.house || <Quiet>—</Quiet>,
              <span className="whitespace-nowrap tabular-nums">{spanWords(r.scheduledStart, r.scheduledEnd) || <Quiet>—</Quiet>}</span>,
              <span className="whitespace-nowrap tabular-nums">{spanWords(r.actualStart, r.actualEnd) || <Quiet>—</Quiet>}</span>,
              r.notice ? <span className="whitespace-nowrap">{stampWords(r.notice)}</span> : <Quiet>—</Quiet>,
              r.status === 'call_out' || r.status === 'ncns' ? <Quiet>Not recorded</Quiet> : <Quiet>—</Quiet>,
              r.details || <Quiet>—</Quiet>,
              <span className="text-text-3">{r.source}</span>,
            ])} />
        )}
      </SectionCard>
    </div>
  )
}

/* ---------- training ---------- */

// `onFile`: a course a paper answers gets Upload paper, its training document panel on that requirement
function CourseTable({ list, data, onFile }: { list: PerfCourse[]; data: string; onFile?: (reqId: string) => void }) {
  const files = !!onFile && list.some((t) => t.reqId)
  return (
    <Table data={data} head={['Training', 'Scope', 'Status', 'Completed', 'Expiration / due', 'Provider', ...(files ? [''] : [])]}
      rows={list.map((t) => [
        <div className="min-w-0"><p className="font-medium text-text-1">{t.label}</p>{t.note && <p className="mt-0.5 text-[12px] text-text-3">{t.note}</p>}</div>,
        t.scope,
        <Pill meta={courseMeta(t.state)} />,
        <span className="whitespace-nowrap tabular-nums">{day(t.completed)}</span>,
        <span className="whitespace-nowrap tabular-nums">{day(t.expires)}</span>,
        t.provider || <Quiet>Not on file</Quiet>,
        ...(files ? [t.reqId && onFile ? (
          <button type="button" onClick={() => onFile(t.reqId)} data-upload-paper={t.reqId} aria-label={`Upload a paper for ${t.label}`}
            className="inline-flex h-8 items-center gap-1 whitespace-nowrap rounded-full border border-border px-2.5 text-[12px] font-semibold text-text-1 transition-colors hover:bg-surface-2">
            <Upload size={13} /> Upload paper
          </button>
        ) : <Quiet>—</Quiet>] : []),
      ])} />
  )
}

function TrainingView({ p, row, onAsk }: { p: Performance; row: RosterRow; onAsk: (ask: StaffAsk) => void }) {
  const t = p.training
  const viewer = useStaffViewer()
  const assign = mayAsk(viewer, 'assign', row.key)
  const onFile = mayAsk(viewer, 'filedoc', row.key) ? (reqId: string) => onAsk({ kind: 'filedoc', course: reqId }) : undefined
  const pencil = mayEditSection(viewer, 'compliance') ? <EditPencil section="compliance" onAsk={onAsk} /> : undefined
  return (
    <div className="grid gap-5" data-perf-training="">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Mandatory current" value={t.connected ? `${t.mandatoryCurrent}/${t.mandatory.length}` : '—'} quiet={!t.connected}
          sub={t.connected ? 'CPR and DODD' : NOT_CONNECTED} />
        <Kpi label="Mandatory compliance" value={pct(t.mandatoryPct)} quiet={t.mandatoryPct === null}
          sub={t.mandatoryPct === null ? NOT_CONNECTED : 'Required to remain eligible'} />
        <Kpi label="Value-add current" value={`${t.valueAddCurrent}/${t.valueAdd.length}`} sub="Role and assignment development" />
        <Kpi label="Value-add areas" value={String(t.valueAddAreas)} sub="Client, house and role skills" />
      </div>
      {t.why && <WhyNote why={t.why} />}

      <SectionCard title="Assigned Training" sub="Training requested for this person and still open."
        extra={assign ? (
          <button type="button" onClick={() => onAsk({ kind: 'assign', house: '' })} data-perf-assign=""
            className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border bg-surface px-3.5 text-[12.5px] font-semibold text-text-1 transition-colors hover:bg-surface-2">
            <Plus size={14} /> Assign Training
          </button>
        ) : undefined}>
        {t.requests.length === 0 ? <EmptyNote>No open training request.</EmptyNote> : (
          <ul className="divide-y divide-border" data-perf-requests="">
            {t.requests.map((q) => (
              <li key={q.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                <IconDot icon={GraduationCap} tone="blue" />
                <div className="min-w-0 flex-1">
                  <p className="whitespace-pre-wrap break-words text-[13.5px] text-text-1">{q.details}</p>
                  <p className="mt-0.5 text-[12px] text-text-3">{[q.self ? `${q.by} · requested for themselves` : q.by, stampWords(q.at)].filter(Boolean).join(' · ')}</p>
                </div>
                <Pill meta={{ label: priorityLabel(q.priority), tint: q.priority === 'urgent' ? 'danger' : q.priority === 'high' ? 'amber' : 'slate' }} />
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard title="Mandatory Training" extra={pencil} sub={`Required organization-wide. Due or expired items appear in Needs Attention${t.windowDays ? `; Due Soon is within ${t.windowDays} days of expiry` : ''}.`}>
        {!t.connected ? <EmptyNote kind="missing">{NOT_CONNECTED}: the compliance record could not be read.</EmptyNote>
          : <CourseTable list={t.mandatory} data="mandatory" onFile={onFile} />}
      </SectionCard>

      <SectionCard title="Value-add Training" extra={pencil}
        sub="Client / IST, medication, funds management, crisis prevention and other development. These never lower the performance score when unassigned or missing.">
        {t.valueAdd.length === 0 ? <EmptyNote>No value-add course or IST is on record.</EmptyNote>
          : <CourseTable list={t.valueAdd} data="value-add" onFile={onFile} />}
      </SectionCard>
    </div>
  )
}

/* ---------- documentation ---------- */

const AREA_ICON: Record<string, LucideIcon> = { daily_notes: FileText, time_tracking: Clock, incidents: ClipboardCheck }

function AreaCard({ a, days }: { a: DocArea; days: number }) {
  const Icon = AREA_ICON[a.id] ?? FileText
  const stats: [string, number][] = [['Expected', a.expected], ['Complete', a.complete], ['Late', a.late], ['Missing', a.missing]]
  return (
    <section className="min-w-0 rounded-[20px] border border-border bg-surface p-5 shadow-1" data-doc-area={a.id}>
      <div className="flex items-start gap-3">
        <IconDot icon={Icon} tone="blue" />
        <div className="min-w-0">
          <p className="text-[14px] font-semibold text-text-1">{a.label}</p>
          <p className="text-[12px] text-text-3">{a.source} · Last {days} days</p>
        </div>
      </div>
      {!a.connected ? (
        <div className="mt-4">
          <p className="font-display text-[15px] font-bold text-text-3">{NOT_CONNECTED}</p>
          {a.why && <p className="mt-1 text-[12px] leading-4 text-text-3">{a.why}</p>}
        </div>
      ) : (
        <>
          <p className="mt-4 font-display text-[26px] font-bold leading-8 tabular-nums text-text-1">{pct(a.rate)}</p>
          <p className="text-[12px] text-text-3">{a.rate === null ? 'No record expected yet' : 'completed on time'}</p>
          <div className="mt-4 grid grid-cols-4 gap-2">
            {stats.map(([k, v]) => (
              <div key={k} className="rounded-[12px] bg-surface-2 px-2 py-2 text-center">
                <p className="text-[9.5px] font-semibold uppercase tracking-[0.08em] text-text-3">{k}</p>
                <p className="mt-1 text-[14px] font-semibold tabular-nums text-text-1">{v}</p>
              </div>
            ))}
          </div>
          {a.why && <p className="mt-3 text-[12px] leading-4 text-text-3">{a.why}</p>}
        </>
      )}
    </section>
  )
}

function DocumentationView({ p, row, onAsk }: { p: Performance; row: RosterRow; onAsk: (ask: StaffAsk) => void }) {
  const d = p.documentation
  const marks = mayAsk(useStaffViewer(), 'docmark', row.key)
  return (
    <div className="grid gap-5" data-perf-documentation="">
      <div className="grid gap-4 lg:grid-cols-3">
        {d.areas.map((a) => <AreaCard key={a.id} a={a} days={p.windowDays} />)}
      </div>
      <SectionCard title="Documentation Exceptions"
        sub="Late, missing, returned or incomplete records from the connected sources. A day with punches expects a daily note; a punch is late when submitted more than a day after the shift; an incident report is late when filed more than a day after the incident. A missing PSI record marked concluded counts as complete.">
        {d.exceptions.length === 0 ? <EmptyNote>No documentation exception in the last {p.windowDays} days.</EmptyNote> : (
          <Table data="doc-exceptions" head={['Date', 'Area', 'Status', 'Source', 'Details', ...(marks ? [''] : [])]}
            rows={d.exceptions.map((x) => [
              <span className="whitespace-nowrap tabular-nums text-text-1">{day(x.date)}</span>,
              DOC_AREA_WORDS[x.area] ?? x.area,
              <span data-doc-status={x.status}><Pill meta={docMeta(x.status)} /></span>,
              <span className="text-text-3">{x.source}</span>,
              x.status === 'concluded' ? <span className="text-tint-fg-mint" data-doc-concluded="">{x.details}</span> : x.details,
              ...(marks ? [concludable(x) ? (
                <button type="button" onClick={() => onAsk({ kind: 'docmark', date: x.date, area: x.area })}
                  data-doc-mark={`${x.date}|${x.area}`} aria-label={`Mark ${DOC_AREA_WORDS[x.area] ?? x.area} of ${day(x.date)} concluded`}
                  className="inline-flex h-8 items-center gap-1 whitespace-nowrap rounded-full border border-border px-2.5 text-[12px] font-semibold text-text-1 transition-colors hover:bg-surface-2">
                  <Pencil size={13} /> Mark concluded
                </button>
              ) : <Quiet>—</Quiet>] : []),
            ])} />
        )}
      </SectionCard>
    </div>
  )
}

/* ---------- HR & conduct ---------- */

function HrView({ p, row, onAsk }: { p: Performance; row: RosterRow; onAsk: (ask: StaffAsk) => void }) {
  const viewer = useStaffViewer()
  const h = p.hr
  return (
    <section className="rounded-[20px] border border-border bg-surface p-5 shadow-1 sm:p-6" data-perf-hr="">
      <p className="flex items-start gap-2 rounded-[12px] bg-tint-amber px-3.5 py-2.5 text-[12.5px] leading-5 text-tint-fg-amber" data-restricted="">
        <Lock size={14} className="mt-0.5 shrink-0" />
        Reported concerns stay separate from the performance score and are never scored. This record is restricted and belongs in the HR audit history.
      </p>
      <div className="mb-3 mt-5 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-[17px] font-bold leading-6 text-text-1">HR &amp; Conduct History</h2>
        {mayAsk(viewer, 'hrissue', row.key) && (
          <button type="button" onClick={() => onAsk({ kind: 'hrissue' })} data-perf-hr-new=""
            className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border bg-surface px-3.5 text-[12.5px] font-semibold text-text-1 transition-colors hover:bg-surface-2">
            <Plus size={14} /> Add HR Issue
          </button>
        )}
      </div>
      {!h.connected ? <EmptyNote kind="missing">{NOT_CONNECTED}: {h.why || 'the HR tracker could not be read.'}</EmptyNote>
        : h.rows.length === 0 ? <EmptyNote>No HR record names this person.</EmptyNote> : (
          <ul className="divide-y divide-border" data-hr-rows="">
            {h.rows.map((r, i) => (
              <li key={`${r.date}|${i}`} className="py-4 first:pt-1 last:pb-0" data-hr-status={r.status}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[14px] font-semibold text-text-1">{r.title}</p>
                    <p className="mt-0.5 text-[12px] text-text-3">{[day(r.date), r.category].filter(Boolean).join(' · ')}</p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {r.severity && <Pill meta={{ label: r.severity, tint: 'blue' }} />}
                    {r.decision && r.decision !== r.severity && <Pill meta={{ label: r.decision, tint: 'lavender' }} />}
                    <Pill meta={HR_META[r.status]} />
                  </div>
                </div>
                {r.description && <p className="mt-2 whitespace-pre-wrap break-words text-[13px] leading-5 text-text-2">{r.description}</p>}
                <dl className="mt-3 grid gap-3 rounded-[12px] bg-surface-2 px-3.5 py-3 sm:grid-cols-3">
                  {([['Action', r.action], ['Outcome', r.status === 'under_review' ? 'Under review' : r.outcome], ['Next review', r.nextReview ? day(r.nextReview) : '']] as const).map(([k, v]) => (
                    <div key={k} className="min-w-0">
                      <dt className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-text-3">{k}</dt>
                      <dd className="mt-1 whitespace-pre-wrap break-words text-[12.5px] text-text-1">{v || <Quiet>—</Quiet>}</dd>
                    </div>
                  ))}
                </dl>
                {r.termination && <p className="mt-2 text-[12px] text-text-3">Termination summary: {r.termination}</p>}
              </li>
            ))}
          </ul>
        )}
    </section>
  )
}

/* ---------- notes ---------- */

function NotesView({ row, onAsk }: { row: RosterRow; onAsk: (ask: StaffAsk) => void }) {
  const notes = useStaffRead(readKey('staffProfileNotes', row.key), () => readNotes(row.key), notesOf)
  const viewer = useStaffViewer()
  const edits = mayEditSection(viewer, 'note')
  const list = notes.data?.notes ?? []
  const earlier = notes.data?.earlier ?? []
  return (
    <SectionCard title="Performance Notes"
      extra={staffCan(viewer, 'staff.notes') ? (
        <button type="button" onClick={() => onAsk({ kind: 'note' })} data-perf-note-add=""
          className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border bg-surface px-3.5 text-[12.5px] font-semibold text-text-1 transition-colors hover:bg-surface-2">
          <Plus size={14} /> Add Note
        </button>
      ) : undefined}>
      <ReadLine state={notes} what="the staff notes" onRetry={notes.reload} />
      {notes.data?.why && <WhyNote why={notes.data.why} />}
      {notes.data && list.length === 0 && earlier.length === 0 && <EmptyNote>No note is on record for this person.</EmptyNote>}
      {list.length > 0 && (
        <ul className="mt-2 divide-y divide-border" data-perf-notes="">
          {list.map((n) => (
            <li key={n.id} className={cn('flex items-start gap-3 py-3.5', n.state === 'resolved' && 'opacity-75')} data-note={n.id}>
              <IconDot icon={MessageSquareText} tone="mint" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <p className="text-[13.5px] font-semibold text-text-1">{n.by || 'Unknown author'}</p>
                  {n.category && n.category !== 'general' && <Pill meta={{ label: categoryLabel(n.category), tint: 'slate' }} />}
                  {n.state === 'resolved' && <Pill meta={{ label: 'Resolved', tint: 'mint' }} />}
                </div>
                <p className="mt-1 whitespace-pre-wrap break-words text-[13px] leading-5 text-text-2">{n.details}</p>
              </div>
              <span className="shrink-0 text-[12px] tabular-nums text-text-3">{dateWords(n.at)}</span>
              {edits && <EditPencil section="note" id={n.id} label={categoryLabel(n.category)} onAsk={onAsk} />}
            </li>
          ))}
        </ul>
      )}
      {earlier.length > 0 && (
        <div className="mt-4 border-t border-border pt-4">
          <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-3">Earlier manager notes</h3>
          <ul className="divide-y divide-border">
            {earlier.map((n, i) => (
              <li key={`${n.at}|${i}`} className="flex items-start gap-3 py-3">
                <IconDot icon={MessageSquareText} tone="slate" />
                <div className="min-w-0 flex-1">
                  <p className="text-[13.5px] font-semibold text-text-1">{n.by || 'Unknown author'}</p>
                  <p className="mt-1 whitespace-pre-wrap break-words text-[13px] leading-5 text-text-2">{n.details}</p>
                </div>
                <span className="shrink-0 text-[12px] tabular-nums text-text-3">{dateWords(n.at)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </SectionCard>
  )
}
