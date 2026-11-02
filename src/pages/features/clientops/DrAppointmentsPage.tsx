// Dr Appointments — the client ⇄ doctor roster from the estate spreadsheet.
// READ-ONLY: the old world's form is the single writer for this sheet, so the "+ Schedule appointment" action stays…
import { useCallback, useEffect, useMemo, useState } from 'react'
import { format } from 'date-fns'
import { AnimatePresence, motion } from 'framer-motion'
import { CalendarDays, ChevronDown, ExternalLink, MapPin, Plus, RefreshCw, Stethoscope } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { api } from '@/lib/api'
import { ohioToday, ohioWall } from '@/lib/ohio'
import { recordMatchesFocus } from '@/lib/focus'
import { formatPhoneDisplay } from '@/lib/phoneFormat'
import { useContextStore } from '@/stores/useContextStore'
import { toast } from '@/stores/useToastStore'
import Card from '@/components/shared/Card'
import DragPerson from '@/components/shared/DragPerson'
import EmptyState from '@/components/shared/EmptyState'
import Skeleton from '@/components/shared/Skeleton'
import OpsPageShell, {
  ChipPicker,
  Field,
  OrderingSelect,
  TintChip,
  inputCls,
  outlineBtnCls,
  primaryBtnCls,
} from './OpsPageShell'
import DrAppointmentsHero, { type DrApptFigures, type DrVisitFigures } from './DrAppointmentsHero'
import { EASE_OUT_EXPO } from '@/engine/motion'
import { cn } from '@/lib/utils'

const READ_ONLY_TITLE = "The old world's form is the single writer — cutover pending"

/* ---------- view model (sheet cells are strings; nothing is assumed present) ---------- */

type DrApptRow = {
  id: string
  status: string
  client: string
  drName: string
  specialist: string
  address: string
  phone: string
  fax: string
  standardFreq: string
  lastVisit: string
  nextVisit: string
  notes: string
  discontinued: boolean
  nextDate: Date | null
  lastDate: Date | null
}

const str = (r: Record<string, unknown>, k: string) => (r[k] == null ? '' : String(r[k]).trim())

/** Tolerant date parse: ISO (yyyy-mm-dd) or M/D/YYYY; null when unparseable. */
function toDate(raw: string): Date | null {
  const s = raw.trim()
  if (!s) return null
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s)
  if (iso) {
    const d = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]))
    return Number.isNaN(d.getTime()) ? null : d
  }
  const mdy = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec(s)
  if (mdy) {
    let y = Number(mdy[3])
    if (y < 100) y += 2000
    const d = new Date(y, Number(mdy[1]) - 1, Number(mdy[2]))
    return Number.isNaN(d.getTime()) ? null : d
  }
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d
}

function toRow(r: Record<string, unknown>, i: number): DrApptRow {
  const nextVisit = str(r, 'next_visit')
  const lastVisit = str(r, 'last_visit')
  return {
    id: str(r, 'id') || `dra-row-${i}`,
    status: str(r, 'status'),
    client: str(r, 'client'),
    drName: str(r, 'dr_name'),
    specialist: str(r, 'specialist'),
    address: str(r, 'address'),
    phone: str(r, 'phone'),
    fax: str(r, 'fax'),
    standardFreq: str(r, 'standard_freq'),
    lastVisit,
    nextVisit,
    notes: str(r, 'notes'),
    discontinued: /discon/i.test(str(r, 'active_or_discontinued')),
    nextDate: toDate(nextVisit),
    lastDate: toDate(lastVisit),
  }
}

// A BOOKED VISIT — the clients' appointments were not being collected.
type VisitRow = {
  id: string
  client: string
  drName: string
  address: string
  time: string
  van: boolean
  manager: string
  managerPhone: string
  when: Date | null
}

function toVisit(r: Record<string, unknown>, i: number): VisitRow {
  return {
    id: str(r, 'id') || `drv-row-${i}`,
    client: str(r, 'client_name'),
    drName: str(r, 'dr_name'),
    address: str(r, 'appointment_address'),
    time: str(r, 'appointment_start_time'),
    van: /^y/i.test(str(r, 'wheelchair_van_required')),
    manager: str(r, 'manager'),
    managerPhone: str(r, 'manager_phone'),
    when: toDate(str(r, 'appointment_date')),
  }
}

const DAY_MS = 86_400_000
// Midnight of OHIO's today, on the same naive carrier toDate() builds.
const startOfTodayMs = () => {
  const d = (ohioWall(new Date()) as Date)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}
const fmtDate = (d: Date | null) => (d ? format(d, 'MMM d, yyyy') : '—')
const nextMs = (r: DrApptRow) => (r.nextDate ? r.nextDate.getTime() : Number.MAX_SAFE_INTEGER)
const isOverdue = (r: DrApptRow) => !r.discontinued && r.nextDate !== null && r.nextDate.getTime() < startOfTodayMs()

const mapsHref = (address: string) => `https://maps.google.com/?q=${encodeURIComponent(address)}`

const LANES = ['All', 'Active', 'Discontinued'] as const
type Lane = (typeof LANES)[number]

/* ---------- schedule appointment modal (kept for cutover; never opened — read-only screen) ---------- */

function ScheduleAppointmentModal({ onClose, onCreated }: { onClose: () => void; onCreated: (r: DrApptRow) => void }) {
  const [client, setClient] = useState('')
  const [drName, setDrName] = useState('')
  const [specialist, setSpecialist] = useState('')
  const [address, setAddress] = useState('')
  const [phone, setPhone] = useState('')
  const [fax, setFax] = useState('')
  const [standardFreq, setStandardFreq] = useState('')
  const [nextVisit, setNextVisit] = useState(ohioToday())
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  const valid = client.trim() && drName.trim()

  const submit = async () => {
    if (!valid) {
      toast({ type: 'warning', title: 'Missing details', body: 'Client and doctor are required.' })
      return
    }
    setSaving(true)
    try {
      const created = await api.create<Record<string, unknown>>('drAppointments', {
        status: 'Scheduled',
        client: client.trim(),
        dr_name: drName.trim(),
        specialist: specialist.trim(),
        address: address.trim(),
        phone: phone.trim(),
        fax: fax.trim(),
        standard_freq: standardFreq.trim(),
        next_visit: nextVisit,
        notes: notes.trim(),
        active_or_discontinued: 'Active',
      })
      onCreated(toRow(created, 0))
      toast({ type: 'success', title: 'Appointment scheduled', body: `${client.trim()} · ${drName.trim()}` })
      onClose()
    } catch {
      toast({ type: 'danger', title: 'Not saved', body: READ_ONLY_TITLE })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[calc(100dvh-3rem)] overflow-y-auto bg-surface sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-display text-[17px] font-bold text-text-1">
            <span className="grid h-8 w-8 place-items-center rounded-[10px] bg-tint-blue">
              <Stethoscope size={15} className="text-tint-fg-blue" />
            </span>
            Schedule appointment
          </DialogTitle>
          <DialogDescription className="text-[13px] text-text-2">
            Book the doctor visit. The address powers the Maps directions link.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Client" required>
              <input value={client} onChange={(e) => setClient(e.target.value)} placeholder="Client name" className={inputCls} />
            </Field>
            <Field label="Doctor" required>
              <input value={drName} onChange={(e) => setDrName(e.target.value)} placeholder="Dr. …" className={inputCls} />
            </Field>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Specialist">
              <input value={specialist} onChange={(e) => setSpecialist(e.target.value)} placeholder="Primary care, Dental…" className={inputCls} />
            </Field>
            <Field label="Next visit">
              <input type="date" value={nextVisit} onChange={(e) => setNextVisit(e.target.value)} className={inputCls} />
            </Field>
          </div>
          <Field label="Clinic address">
            <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="1220 Market Ave N, Canton, OH 44702" className={inputCls} />
          </Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Phone">
              <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(330) …" className={inputCls} />
            </Field>
            <Field label="Fax">
              <input value={fax} onChange={(e) => setFax(e.target.value)} placeholder="(330) …" className={inputCls} />
            </Field>
            <Field label="Standard frequency">
              <input value={standardFreq} onChange={(e) => setStandardFreq(e.target.value)} placeholder="Every 3 months" className={inputCls} />
            </Field>
          </div>
          <Field label="Notes">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Med list, fasting labs, guardian meet-up…"
              className={cn(inputCls, 'h-auto py-2')}
            />
          </Field>
        </div>
        <DialogFooter>
          <button onClick={onClose} className={outlineBtnCls}>Cancel</button>
          <button onClick={submit} disabled={saving || !valid} className={primaryBtnCls}>
            <Stethoscope size={15} /> {saving ? 'Scheduling…' : 'Schedule appointment'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ---------- appointment row ---------- */

function AppointmentRow({
  row,
  index,
  expanded,
  onToggle,
}: {
  row: DrApptRow
  index: number
  expanded: boolean
  onToggle: () => void
}) {
  const overdue = isOverdue(row)
  return (
    <motion.div
      initial={index < 10 ? { opacity: 0, y: 8 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index, 10) * 0.025, duration: 0.2, ease: EASE_OUT_EXPO }}
      onClick={onToggle}
      className="flex cursor-pointer flex-wrap items-start gap-4 border-b border-border px-4 py-3.5 transition-colors last:border-0 hover:bg-surface-2"
    >
      {/* next-visit date badge */}
      <div
        className={cn(
          'grid h-12 w-12 shrink-0 place-items-center rounded-[10px] text-center',
          row.nextDate ? 'bg-tint-blue' : 'bg-surface-3',
        )}
      >
        {row.nextDate ? (
          <div>
            <div className="font-stat text-[17px] font-bold leading-4 text-tint-fg-blue">{format(row.nextDate, 'd')}</div>
            <div className="text-[10px] font-semibold uppercase leading-4 text-tint-fg-blue">{format(row.nextDate, 'MMM')}</div>
          </div>
        ) : (
          <span className="font-stat text-[15px] font-bold text-text-3">—</span>
        )}
      </div>

      <div className="min-w-[200px] flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {/* the wrap goes around the NAME only — the row's motion.div owns the
              expand click, and a drag handle over the whole row would fight it */}
          <DragPerson name={row.client} id={row.client} type="client" subtitle={row.specialist || row.drName}>
            <span className="text-[13px] font-semibold text-text-1">{row.client || 'Unknown client'}</span>
          </DragPerson>
          <TintChip
            label={row.discontinued ? 'Discontinued' : 'Active'}
            tint={row.discontinued ? 'danger' : 'primary'}
          />
          {overdue && <TintChip label="Overdue" tint="danger" />}
          {!row.nextDate && !row.discontinued && <TintChip label="To schedule" tint="warning" />}
          {row.status && <TintChip label={row.status} tint="info" />}
        </div>
        <div className="mt-0.5 text-[13px] text-text-1">
          {row.specialist || 'Specialist —'} · <span className="text-text-2">{row.drName || 'Doctor —'}</span>
        </div>
        {row.address && (
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-text-3">
            <span className="flex min-w-0 items-center gap-1">
              <MapPin size={12} className="shrink-0" />
              <span className="clamp-1">{row.address}</span>
            </span>
            <a
              href={mapsHref(row.address)}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="flex shrink-0 items-center gap-1 font-semibold text-primary hover:text-primary-hover"
            >
              <ExternalLink size={11} /> Open in Maps
            </a>
          </div>
        )}
        {row.notes && !expanded && <div className="mt-1 clamp-1 text-[11px] text-text-3">{row.notes}</div>}
      </div>

      <div className="flex shrink-0 items-start gap-2">
        <div className="flex flex-col items-end gap-1">
          <span className="font-stat text-[14px] font-semibold text-text-1">
            {row.nextDate ? fmtDate(row.nextDate) : 'To schedule'}
          </span>
          {row.standardFreq && (
            <span className="rounded-full bg-surface-3 px-2.5 py-0.5 text-[11px] font-medium text-text-2">
              {row.standardFreq}
            </span>
          )}
        </div>
        <ChevronDown
          size={16}
          className={cn('mt-0.5 text-text-3 transition-transform duration-150', expanded && 'rotate-180')}
        />
      </div>

      {expanded && (
        <div className="grid w-full grid-cols-1 gap-x-6 gap-y-2 rounded-[10px] bg-surface-2 px-4 py-3 sm:grid-cols-2">
          {(
            [
              ['Address', row.address || '—'],
              ['Phone', row.phone ? formatPhoneDisplay(row.phone) : '—'],
              ['Fax', row.fax ? formatPhoneDisplay(row.fax) : '—'],
              ['Standard frequency', row.standardFreq || '—'],
              ['Last visit', row.lastDate ? fmtDate(row.lastDate) : row.lastVisit || '—'],
              ['Next visit', row.nextDate ? fmtDate(row.nextDate) : row.nextVisit || '—'],
            ] as const
          ).map(([label, value]) => (
            <div key={label}>
              <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-text-3">{label}</div>
              <div className="text-[13px] text-text-1">{value}</div>
            </div>
          ))}
          <div className="sm:col-span-2">
            <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-text-3">Notes</div>
            <div className="whitespace-pre-wrap text-[13px] text-text-1">{row.notes || '—'}</div>
          </div>
        </div>
      )}
    </motion.div>
  )
}

// One booked visit, one line — date · time · client · doctor · address · the van flag and the manager who filed it.
function VisitLine({ v, past }: { v: VisitRow; past?: boolean }) {
  return (
    <div className={cn('flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border/60 px-3.5 py-2.5 last:border-b-0', past && 'opacity-70')}>
      <span className="w-[92px] shrink-0 text-[12.5px] font-semibold tabular-nums text-text-1">{fmtDate(v.when)}</span>
      <span className="w-[74px] shrink-0 text-[12px] tabular-nums text-text-3">{v.time || '—'}</span>
      <DragPerson name={v.client} id={v.client} type="client" subtitle={v.drName || fmtDate(v.when)}>
        <span className="min-w-[120px] text-[13px] font-semibold text-text-1">{v.client || '—'}</span>
      </DragPerson>
      <span className="min-w-0 flex-1 text-[12.5px] text-text-2">{v.drName}</span>
      {v.van && (
        <span className="rounded-full bg-tint-amber px-1.5 py-px text-[10.5px] font-semibold text-tint-fg-amber">Van</span>
      )}
      {v.address && (
        <a href={mapsHref(v.address)} target="_blank" rel="noreferrer" className="clamp-1 max-w-[260px] text-[11.5px] text-primary hover:underline">
          {v.address}
        </a>
      )}
      {v.manager && (
        // the phone tooltip stays the title: it is the reason anyone hovers this chip, and DragPerson would…
        <DragPerson
          name={v.manager}
          id={v.manager}
          type="staff"
          subtitle="Manager"
          title={v.managerPhone ? formatPhoneDisplay(v.managerPhone) : undefined}
        >
          <span className="text-[11px] text-text-3">{v.manager}</span>
        </DragPerson>
      )}
    </div>
  )
}

/* ---------- the two reads ---------- */

/** The two doors this screen reads, each carrying its own verdict. */
export type DrReads = {
  /** the roster; null until it lands */
  rows: DrApptRow[] | null
  error: string | null
  /** the booked visits; null until they land, and null when the door failed */
  visits: VisitRow[] | null
  visitsFailed: boolean
  reload: () => void
  prependRow: (r: DrApptRow) => void
}

// A DOOR THAT DID NOT ANSWER IS NOT AN EMPTY BOOK.
export function useDrAppointmentsReads(): DrReads {
  const [rows, setRows] = useState<DrApptRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [visits, setVisits] = useState<VisitRow[] | null>(null)
  const [visitsFailed, setVisitsFailed] = useState(false)

  useEffect(() => {
    let alive = true
    setRows(null)
    setVisits(null)
    setVisitsFailed(false)
    setError(null)
    api
      .list<Record<string, unknown>>('drAppointments')
      .then((r) => alive && setRows(r.map(toRow)))
      .catch(() => alive && setError('Could not load Dr Appointments from the live sheet.'))
    // The visits ride separately and fail on their own: the roster still shows, and every visits figure says it is…
    api
      .list<Record<string, unknown>>('drVisits')
      .then((r) => alive && setVisits(r.map(toVisit)))
      .catch(() => { if (alive) setVisitsFailed(true) })
    return () => {
      alive = false
    }
  }, [reloadKey])

  const reload = useCallback(() => setReloadKey((k) => k + 1), [])
  const prependRow = useCallback((r: DrApptRow) => setRows((rs) => [r, ...(rs ?? [])]), [])
  return { rows, error, visits, visitsFailed, reload, prependRow }
}

/* ---------- page ---------- */

export default function DrAppointmentsPage() {
  return <DrAppointmentsScreen reads={useDrAppointmentsReads()} />
}

/** The screen over the two reads — drawn whole from what the hook holds. */
export function DrAppointmentsScreen({ reads }: { reads: DrReads }) {
  const { rows, error, visits, visitsFailed, reload } = reads
  const [order, setOrder] = useState('next')
  const [lane, setLane] = useState<Lane>('All')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [showSchedule, setShowSchedule] = useState(false)
  const focus = useContextStore((s) => s.focus)
  /** the booked count exists only once the visits door answered */
  const visitsLanded = visits !== null && !visitsFailed

  const clientFocus = focus?.type === 'client' ? focus : null
  const scoped = useMemo(() => {
    const all = rows ?? []
    if (!clientFocus) return all
    const matched = all.filter((r) => recordMatchesFocus(r.client, clientFocus))
    return matched.length ? matched : all
  }, [rows, clientFocus])
  const focusFiltered = !!clientFocus && (rows ?? []).some((r) => recordMatchesFocus(r.client, clientFocus))

  const laneRows = useMemo(() => {
    if (lane === 'Active') return scoped.filter((r) => !r.discontinued)
    if (lane === 'Discontinued') return scoped.filter((r) => r.discontinued)
    return scoped
  }, [scoped, lane])

  const sorter = useMemo(() => {
    if (order === 'client')
      return (a: DrApptRow, b: DrApptRow) => a.client.localeCompare(b.client) || nextMs(a) - nextMs(b)
    if (order === 'doctor')
      return (a: DrApptRow, b: DrApptRow) => a.drName.localeCompare(b.drName) || a.client.localeCompare(b.client)
    return (a: DrApptRow, b: DrApptRow) => nextMs(a) - nextMs(b) || a.client.localeCompare(b.client)
  }, [order])

  const upcoming = useMemo(() => laneRows.filter((r) => r.nextDate !== null).sort(sorter), [laneRows, sorter])
  const toSchedule = useMemo(() => laneRows.filter((r) => r.nextDate === null).sort(sorter), [laneRows, sorter])

  /** The booked visits, scoped by the same client focus. */
  const scopedVisits = useMemo(() => {
    const all = visits ?? []
    if (!clientFocus) return all
    const matched = all.filter((v) => recordMatchesFocus(v.client, clientFocus))
    return matched.length ? matched : all
  }, [visits, clientFocus])
  const bookedUpcoming = useMemo(() => {
    const t0 = startOfTodayMs()
    return scopedVisits
      .filter((v) => v.when !== null && v.when.getTime() >= t0)
      .sort((a, b) => (a.when as Date).getTime() - (b.when as Date).getTime() || a.time.localeCompare(b.time))
  }, [scopedVisits])
  const bookedRecent = useMemo(() => {
    const t0 = startOfTodayMs()
    return scopedVisits
      .filter((v) => v.when !== null && v.when.getTime() < t0 && v.when.getTime() >= t0 - 30 * DAY_MS)
      .sort((a, b) => (b.when as Date).getTime() - (a.when as Date).getTime())
      .slice(0, 20)
  }, [scopedVisits])

  // THE HEADER IS THE ONLY STRIP OF FIGURES.
  const heroFigures = useMemo<DrApptFigures | null>(() => {
    if (!rows) return null
    const active = scoped.filter((r) => !r.discontinued)
    const dated = active.filter((r) => r.nextDate !== null)
    const t0 = startOfTodayMs()
    const ahead = dated
      .filter((r) => (r.nextDate as Date).getTime() >= t0)
      .sort((a, b) => (a.nextDate as Date).getTime() - (b.nextDate as Date).getTime())[0]
    const days = ahead ? Math.round(((ahead.nextDate as Date).getTime() - t0) / DAY_MS) : 0
    return {
      total: scoped.length,
      active: active.length,
      clients: new Set(active.filter((r) => r.client).map((r) => r.client.toLowerCase())).size,
      dated: dated.length,
      overdue: dated.filter((r) => (r.nextDate as Date).getTime() < t0).length,
      next: ahead ? fmtDate(ahead.nextDate) : '',
      nextWhen: ahead
        ? `${ahead.client || 'Unknown client'} · ${days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`}`
        : '',
    }
  }, [rows, scoped])

  const heroVisits = useMemo<DrVisitFigures | null>(() => {
    if (!visitsLanded) return null
    const t0 = startOfTodayMs()
    const t14 = t0 + 14 * DAY_MS
    return {
      soon: scopedVisits.filter((v) => v.when && v.when.getTime() >= t0 && v.when.getTime() < t14).length,
      undated: scopedVisits.filter((v) => v.when === null).length,
    }
  }, [visitsLanded, scopedVisits])

  const hero = (
    <DrAppointmentsHero
      read={error ? { state: 'failed' } : rows === null ? { state: 'loading' } : { state: 'ready' }}
      figures={heroFigures}
      visitsRead={visitsFailed ? { state: 'failed' } : visits === null ? { state: 'loading' } : { state: 'ready' }}
      visits={heroVisits}
      scope={focusFiltered && clientFocus ? clientFocus.name : ''}
      onRetry={reload}
    />
  )

  if (error) {
    return (
      <div className="w-full">
        {hero}
        <Card className="flex flex-col items-center gap-3 py-12 text-center">
          <div className="text-[14px] font-semibold text-text-1">Couldn’t load Dr Appointments</div>
          <div className="max-w-[380px] text-[13px] text-text-2">{error}</div>
          <button onClick={reload} className={outlineBtnCls}>
            <RefreshCw size={14} /> Retry
          </button>
        </Card>
      </div>
    )
  }

  if (rows === null) {
    return (
      <div className="w-full space-y-2">
        {hero}
        <Skeleton className="h-9 w-64" />
        <Card padded={false} className="p-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="mb-2 h-16 w-full" />
          ))}
        </Card>
      </div>
    )
  }

  return (
    <OpsPageShell
      title="Dr Appointments"
      subtitle="Doctor roster and visit cadence per client — live from the estate sheet"
      hero={hero}
      focusType="client"
      filtered={focusFiltered}
      actions={
        <>
          <button
            onClick={() => setShowSchedule(true)}
            disabled
            title={READ_ONLY_TITLE}
            className={primaryBtnCls}
          >
            <Plus size={15} /> Schedule appointment
          </button>
          <button
            onClick={() => toast({ type: 'info', title: 'Transport calendar', body: 'A week-view transport calendar ships with the Transportation app integration — coming soon.' })}
            className={outlineBtnCls}
          >
            <CalendarDays size={15} /> Transport calendar
          </button>
        </>
      }
      toolbar={
        <>
          <ChipPicker options={LANES} value={lane} onChange={setLane} tint="blue" />
          <OrderingSelect
            value={order}
            onChange={setOrder}
            options={[
              { id: 'next', label: 'Next visit' },
              { id: 'client', label: 'Client A→Z' },
              { id: 'doctor', label: 'Doctor A→Z' },
            ]}
          />
        </>
      }
    >
      {/* THE CONSULTAS THEMSELVES — the form's booked visits, upcoming first */}
      <section className="mb-6">
        <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-3">
          {/* an unread door has no count to print */}
          Booked appointments · {visitsLanded ? bookedUpcoming.length : '—'}
        </h2>
        <Card padded={false} className="overflow-hidden">
          {visitsFailed ? (
            <EmptyState
              title="The booked visits could not be read"
              body="This is not an empty book — the visits door did not answer."
              action={{ label: 'Try again', onClick: reload }}
            />
          ) : visits === null ? (
            <div className="p-3"><Skeleton className="h-14 w-full" /></div>
          ) : bookedUpcoming.length === 0 ? (
            <EmptyState
              title="Nothing on the books"
              body="Visits submitted through the appointment form land here, soonest first."
            />
          ) : (
            bookedUpcoming.map((v) => <VisitLine key={v.id} v={v} />)
          )}
        </Card>
      </section>

      {bookedRecent.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-3">
            Past 30 days · {bookedRecent.length}
          </h2>
          <Card padded={false} className="overflow-hidden">
            {bookedRecent.map((v) => <VisitLine key={v.id} v={v} past />)}
          </Card>
        </section>
      )}

      <section className="mb-6">
        <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-3">
          Doctor roster — next visit on file · {upcoming.length}
        </h2>
        <Card padded={false} className="overflow-hidden">
          {upcoming.length === 0 ? (
            <EmptyState
              title="No dated visits"
              body={
                rows.length === 0
                  ? 'The sheet has no appointment rows yet.'
                  : 'No rows in this view carry a parseable next-visit date.'
              }
            />
          ) : (
            upcoming.map((r, i) => (
              <AppointmentRow
                key={r.id}
                row={r}
                index={i}
                expanded={expandedId === r.id}
                onToggle={() => setExpandedId((id) => (id === r.id ? null : r.id))}
              />
            ))
          )}
        </Card>
      </section>

      <section>
        <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-3">
          Roster — no visit on file · {toSchedule.length}
        </h2>
        <Card padded={false} className="overflow-hidden">
          {toSchedule.length === 0 ? (
            <EmptyState title="Nothing waiting" body="Every row in this view has a next visit on the books." />
          ) : (
            toSchedule.map((r, i) => (
              <AppointmentRow
                key={r.id}
                row={r}
                index={i}
                expanded={expandedId === r.id}
                onToggle={() => setExpandedId((id) => (id === r.id ? null : r.id))}
              />
            ))
          )}
        </Card>
      </section>

      <AnimatePresence>
        {showSchedule && (
          <ScheduleAppointmentModal
            onClose={() => setShowSchedule(false)}
            onCreated={reads.prependRow}
          />
        )}
      </AnimatePresence>
    </OpsPageShell>
  )
}
