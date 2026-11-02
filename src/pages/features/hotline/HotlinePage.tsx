// EMPLOYEE SUPPORT HOTLINE — the desk.
// Four lanes over the estate's own sheets, LIVE and whole-history: Call Offs — the tracker the attendance letters…
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import {
  ClipboardList, Loader2, NotebookPen, PhoneCall, Search, Settings2, ShieldAlert, Table2,
} from 'lucide-react'
import Card from '@/components/shared/Card'
import EmptyState from '@/components/shared/EmptyState'
import PageHeader from '@/components/shared/PageHeader'
import { api } from '@/lib/api'
import { gasAction } from '@/features/hiring/shared'
import { useAuthStore } from '@/auth/useAuthStore'
import { ohioDayYear } from '@/lib/ohio'
import { formatPhoneDisplay } from '@/lib/phoneFormat'
import { cn } from '@/lib/utils'
import SheetEditor from '@/components/shared/SheetEditor'

type Row = Record<string, unknown>
const s = (r: Row, k: string) => String(r[k] ?? '').trim()

// A stored day, readable — the lane was printing raw ISO stamps such as 2026-08-15T04:00:00.000Z, because the…
function day(v: string): string {
  if (!v) return ''
  if (/^\d{4}-\d{2}-\d{2}T/.test(v)) return ohioDayYear(v) || v
  return v
}

const LANES = [
  { id: 'calloffs', label: 'Call Offs', icon: PhoneCall, resource: 'callOffs' },
  { id: 'queue', label: 'Support Queue', icon: ClipboardList, resource: 'supportQueue' },
  { id: 'notes', label: 'Daily Notes', icon: NotebookPen, resource: 'dailyNotes' },
  { id: 'incidents', label: 'Incidents', icon: ShieldAlert, resource: 'uiIncidents' },
] as const
type LaneId = (typeof LANES)[number]['id']

type HotlineConfig = {
  enabled: string
  team_phone: string
  prompt: string
  default_prompt: string
  max_per_sweep: string
  processed_total?: number
  log_tail?: { call_id: string; at: string; caller: string; items: string; kinds: string; via: string }[]
}

export default function HotlinePage() {
  const isAdmin = useAuthStore((u) => u.user?.role === 'admin')
  const [lane, setLane] = useState<LaneId>('calloffs')
  const [rows, setRows] = useState<Record<LaneId, Row[] | null>>({
    calloffs: null, queue: null, notes: null, incidents: null,
  })
  const [q, setQ] = useState('')
  /** cards ⇄ spreadsheet — the same rows, the same colours */
  const [asSheet, setAsSheet] = useState(false)
  const [cfg, setCfg] = useState<HotlineConfig | null>(null)

  const loadLane = useCallback((id: LaneId) => {
    const resource = LANES.find((l) => l.id === id)?.resource ?? 'supportQueue'
    api.list<Row>(resource as never)
      .then((r) => setRows((prev) => ({ ...prev, [id]: Array.isArray(r) ? [...r].reverse() : [] })))
      .catch(() => setRows((prev) => ({ ...prev, [id]: [] })))
  }, [])

  useEffect(() => { if (rows[lane] === null) loadLane(lane) }, [lane, rows, loadLane])
  useEffect(() => {
    gasAction<HotlineConfig>('hotlineConfigGet', {}).then(setCfg).catch(() => {})
  }, [])

  const needle = q.trim().toLowerCase()
  const view = useMemo(() => {
    const list = rows[lane] ?? []
    if (!needle) return list.slice(0, 200)
    return list.filter((r) => Object.values(r).some((v) => String(v ?? '').toLowerCase().includes(needle))).slice(0, 200)
  }, [rows, lane, needle])

  return (
    <div>
      <PageHeader
        title="Employee Support Hotline"
        subtitle={`The ${formatPhoneDisplay(cfg?.team_phone ?? '5558')} line — every call read, filed and paged. ${cfg?.processed_total ? `${cfg.processed_total} calls processed.` : ''}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2 rounded-md border border-border bg-surface px-2.5">
              <Search size={14} className="shrink-0 text-text-3" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search this lane…"
                className="h-9 w-[190px] bg-transparent text-[13px] text-text-1 outline-none placeholder:text-text-3"
              />
            </div>
            {/* The machine's knobs live in SETTINGS — everything that is
                "the machine" is configuration. This is
                a door there, wearing only the on/off light. */}
            {isAdmin && (
              <Link
                to="/settings#hotline"
                className="flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[12.5px] font-semibold text-text-2 hover:bg-surface-2"
                title="Configure the sweep and the prompt in Settings"
              >
                <Settings2 size={14} /> Settings
                <span className={cn('h-2 w-2 rounded-full',
                  String(cfg?.enabled).toLowerCase() === 'on' ? 'bg-tint-fg-mint' : 'bg-tint-fg-pink')} />
              </Link>
            )}
          </div>
        }
      />

      <div className="mt-4 flex flex-wrap gap-1.5">
        {LANES.map((l) => {
          const Icon = l.icon
          const count = rows[l.id]?.length
          return (
            <button
              key={l.id}
              onClick={() => setLane(l.id)}
              className={cn(
                'flex h-9 items-center gap-1.5 rounded-md border px-3 text-[12.5px] font-semibold transition-colors',
                lane === l.id
                  ? 'border-primary bg-primary-soft text-primary-strong'
                  : 'border-border bg-surface text-text-2 hover:bg-surface-2',
              )}
            >
              <Icon size={14} /> {l.label}
              {count !== undefined && <span className="rounded-full bg-surface-2 px-1.5 text-[11px] tabular-nums">{count}</span>}
            </button>
          )
        })}
        {/* CARDS ⇄ SPREADSHEET, on the lane tabs' own row.
            The rows are the same either way; the grid is for
            reading a lane whole and the cards for reading one call. */}
        <button
          onClick={() => setAsSheet((v) => !v)}
          title={asSheet ? 'Back to the cards' : 'Open this lane as a spreadsheet'}
          className={cn(
            'ml-auto flex h-9 items-center gap-1.5 rounded-md border px-3 text-[12.5px] font-semibold transition-colors',
            asSheet
              ? 'border-primary bg-primary-soft text-primary-strong'
              : 'border-border bg-surface text-text-2 hover:bg-surface-2',
          )}
        >
          <Table2 size={14} /> {asSheet ? 'Cards' : 'Spreadsheet'}
        </button>
      </div>

      <Card padded={false} className="mt-4 overflow-hidden">
        {rows[lane] === null ? (
          <p className="flex items-center gap-2 px-4 py-6 text-[13px] text-text-3">
            <Loader2 size={14} className="animate-spin" /> Reading the sheet…
          </p>
        ) : view.length === 0 ? (
          <EmptyState title="Nothing here" body="Rows the hotline files land on the estate's own sheet and read here live." />
        ) : (
          asSheet ? (
            (() => {
              const cols = laneColumns(view as Record<string, unknown>[])
              const back = view.map((r) => cols.map((c) => TINT_BACK[laneTint(lane, c.key, s(r, c.key))] ?? ''))
              const fore = view.map((r) => cols.map((c) => TINT_FORE[laneTint(lane, c.key, s(r, c.key))] ?? ''))
              return (
                <SheetEditor
                  toolbar
                  title={`${LANES.find((l) => l.id === lane)?.label ?? 'Hotline'} — spreadsheet view`}
                  columns={cols}
                  rows={view as Record<string, unknown>[]}
                  colors={{ back, fore }}
                />
              )
            })()
          ) : (
          <div className="divide-y divide-border/60">
            {view.map((r, i) => <LaneRow key={s(r, 'id') || i} lane={lane} r={r} />)}
          </div>
          )
        )}
      </Card>

    </div>
  )
}


// THE SHEET VIEW, AND THE CELLS KEEP THE COLOUR — a spreadsheet view with the spreadsheet tools beside it, and…
const TINT_BACK: Record<string, string> = {
  pink: 'var(--tint-pink)', amber: 'var(--tint-amber)', blue: 'var(--tint-blue)',
}
const TINT_FORE: Record<string, string> = {
  pink: 'var(--tint-fg-pink)', amber: 'var(--tint-fg-amber)', blue: 'var(--tint-fg-blue)',
}

/** Which tint a cell wears, by lane and column — the card's own rules, once. */
function laneTint(lane: LaneId, col: string, value: string): string {
  if (lane === 'queue' && col === 'urgency') {
    return value === 'High' ? 'pink' : value === 'Medium' ? 'amber' : ''
  }
  if (lane === 'queue' && col === 'type_of_request') return value ? 'blue' : ''
  if (lane === 'calloffs' && col === 'type') return 'amber'
  if (lane === 'notes' && col === 'client_name') return value ? 'pink' : ''
  return ''
}

// Columns for a lane: whatever the rows actually carry, in first-seen order — the sheet's own shape, not a list…
function laneColumns(rows: Record<string, unknown>[]): { key: string; label: string }[] {
  const seen: string[] = []
  for (const r of rows) for (const k of Object.keys(r)) if (!seen.includes(k)) seen.push(k)
  return seen.map((k) => ({ key: k, label: k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) }))
}

function LaneRow({ lane, r }: { lane: LaneId; r: Row }) {
  if (lane === 'calloffs') {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
        <span className="w-[92px] shrink-0 text-[12px] font-semibold tabular-nums text-text-1">{day(s(r, 'date')) || '—'}</span>
        <span className="min-w-[140px] text-[13px] font-semibold text-text-1">{s(r, 'employee_name') || '—'}</span>
        <span className="shrink-0 rounded-full bg-tint-amber px-1.5 py-px text-[10.5px] font-semibold text-tint-fg-amber">{s(r, 'type') || 'Call Off'}</span>
        <span className="min-w-0 flex-1 text-[12px] text-text-3">{s(r, 'notes')}</span>
        <span className="text-[10.5px] text-text-3">{s(r, 'your_name')}</span>
      </div>
    )
  }
  if (lane === 'queue') {
    const urgency = s(r, 'urgency')
    return (
      <div className="px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[12px] font-semibold tabular-nums text-text-1">{day(s(r, 'date_received')) || '—'}</span>
          <span className={cn('rounded-full px-1.5 py-px text-[10.5px] font-semibold',
            urgency === 'High' ? 'bg-tint-pink text-tint-fg-pink'
              : urgency === 'Medium' ? 'bg-tint-amber text-tint-fg-amber' : 'bg-surface-2 text-text-3')}>
            {urgency || 'Low'}
          </span>
          <span className="rounded-full bg-tint-blue px-1.5 py-px text-[10.5px] font-semibold text-tint-fg-blue">{s(r, 'type_of_request') || 'Request'}</span>
          <span className="text-[12.5px] font-semibold text-text-1">{s(r, 'requestor')}</span>
          <span className="ml-auto text-[10.5px] uppercase tracking-wide text-text-3">{s(r, 'status') || 'New'}</span>
        </div>
        <p className="mt-1 text-[12.5px] leading-5 text-text-2">{s(r, 'description_of_request')}</p>
      </div>
    )
  }
  if (lane === 'notes') {
    return (
      <div className="px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-2 text-[11.5px] text-text-3">
          <span className="font-semibold tabular-nums text-text-1">{day(s(r, 'reporting_date')) || '—'}</span>
          <span className="font-semibold text-text-1">{s(r, 'dsp_name')}</span>
          {s(r, 'client_name') && <span className="rounded-full bg-tint-pink px-1.5 py-px text-[10.5px] font-semibold text-tint-fg-pink">{s(r, 'client_name')}</span>}
          {s(r, 'category') && <span className="rounded bg-surface-2 px-1.5 text-[10.5px] font-semibold uppercase">{s(r, 'category')}</span>}
        </div>
        <p className="mt-1 text-[12.5px] leading-5 text-text-2">{s(r, 'response')}</p>
      </div>
    )
  }
  return (
    <div className="px-4 py-2.5">
      <div className="flex flex-wrap items-center gap-2 text-[11.5px] text-text-3">
        <span className="font-semibold tabular-nums text-text-1">{day(s(r, 'incident_date')) || day(s(r, 'timestamp')) || '—'}</span>
        {s(r, 'client_name') && <span className="rounded-full bg-tint-pink px-1.5 py-px text-[10.5px] font-semibold text-tint-fg-pink">{s(r, 'client_name')}</span>}
        {s(r, 'incident_category') && <span className="rounded bg-surface-2 px-1.5 text-[10.5px] font-semibold uppercase">{s(r, 'incident_category')}</span>}
        <span>{s(r, 'incident_location')}</span>
        <span className="ml-auto">by {s(r, 'your_name')}</span>
      </div>
      <p className="mt-1 text-[12.5px] leading-5 text-text-2">{s(r, 'summary_of_incident')}</p>
    </div>
  )
}
