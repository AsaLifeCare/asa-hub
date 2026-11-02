// THE ONE SIMPLE PICKER.
// Your asa.
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { Check, Loader2, Plus, Search } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { api } from '@/lib/api'
import { AppIcon } from '@/lib/icons'
import { TINT_PAIR } from '@/lib/tints'
import { cn } from '@/lib/utils'
import { useRegistryStore } from '@/stores/useRegistryStore'
import { WIDGET_EXAMPLES, type WidgetExample } from '@/pages/features/widgets/examplesBank'
import type { TintName } from '@/engine/types'
import { addSpecToLayout, loadLayout, type IndicatorSpec } from './layout'

type BankRow = {
  id: string
  label?: string
  resource?: string
  field?: string
  value?: string
  icon?: string
  tint?: string
  href?: string
  chart?: string
}

// the same bank-row → spec adapter the Widgets app uses (same id prefix, so "already on your page" agrees between…
function bankSpecOf(w: BankRow): IndicatorSpec {
  return {
    id: `bank-${w.id}`,
    kind: 'indicator',
    label: String(w.label ?? 'Untitled'),
    resource: String(w.resource ?? ''),
    field: w.field || undefined,
    value: w.value || undefined,
    icon: w.icon || 'activity',
    tint: (w.tint || 'blue') as TintName,
    href: w.href || undefined,
    chart: (w.chart || 'number') as IndicatorSpec['chart'],
  }
}

// the same example → spec adapter as WidgetsPage.exampleSpec — id convention `ex-…` kept byte-identical so dedup…
function exampleSpecOf(e: WidgetExample): IndicatorSpec {
  return {
    id: `ex-${e.resource}-${e.field ?? ''}-${e.value ?? ''}-${e.chart ?? 'n'}`.replace(/[^a-z0-9-]+/gi, '-'),
    kind: 'indicator', label: e.label, resource: e.resource,
    field: e.field, value: e.value, icon: e.icon, tint: e.tint, chart: e.chart,
  }
}

// One line saying WHAT DATA the widget shows — derived from the spec, so it cannot drift from what the card draws…
function dataSentence(s: IndicatorSpec): string {
  if (s.resource === 'weather') return 'live Columbus forecast'
  switch (s.chart ?? 'number') {
    case 'table':
      return `newest rows of ${s.resource}`
    case 'progress':
      return s.field
        ? `${s.field}${s.value ? ` = ${s.value}` : ''} across ${s.resource}`
        : `counts ${s.resource}`
    case 'donut':
    case 'bars':
      return s.field ? `${s.resource} grouped by ${s.field}` : `counts ${s.resource}`
    default:
      return `counts ${s.resource}${s.field && s.value ? ` where ${s.field} = ${s.value}` : ''}`
  }
}

/** cheap search over ~90 rows — by label or by the resource it reads */
const matches = (s: IndicatorSpec, needle: string) =>
  !needle || s.label.toLowerCase().includes(needle) || s.resource.toLowerCase().includes(needle)

export default function BankPickerModal({
  open,
  onOpenChange,
  userId,
  onTaken,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  userId: string
  onTaken: () => void
}) {
  const apps = useRegistryStore((s) => s.apps)
  const [rows, setRows] = useState<BankRow[] | null>(null)
  const [onPage, setOnPage] = useState<Set<string>>(new Set())
  const [q, setQ] = useState('')

  useEffect(() => {
    if (!open) return
    let alive = true
    setQ('')
    setOnPage(new Set(loadLayout(userId).cards.map((c) => c.id)))
    api.list<BankRow>('widgets')
      .then((r) => { if (alive) setRows(Array.isArray(r) ? r : []) })
      .catch(() => { if (alive) setRows([]) })
    return () => { alive = false }
  }, [open, userId])

  // Only examples whose resource this workspace actually serves — the same computation WidgetsPage makes over the…
  const served = useMemo(() => {
    const s = new Set<string>()
    for (const app of apps) for (const p of app.pages) {
      const r = p.dataSource?.resource as string | undefined
      if (r) s.add(r)
    }
    // The estate lanes and personal tables the platform serves WITHOUT a registry dataSource of their own (bespoke…
    ;['drVisits', 'dailyNotes', 'callOffs', 'uiIncidents', 'workOrders',
      'supportQueue', 'travelTrips', 'teamTasks',
      // the sky — the relay's /weather door, not a sheet
      'weather'].forEach((r) => s.add(r))
    return s
  }, [apps])

  const needle = q.trim().toLowerCase()

  const bankSpecs = useMemo(
    () => (rows ?? []).map(bankSpecOf).filter((s) => matches(s, needle)),
    [rows, needle],
  )
  /** examples grouped by shelf, in the gallery's own order */
  const exampleGroups = useMemo(() => {
    const g = new Map<string, IndicatorSpec[]>()
    for (const e of WIDGET_EXAMPLES) {
      if (!served.has(e.resource)) continue
      const spec = exampleSpecOf(e)
      if (!matches(spec, needle)) continue
      g.set(e.group, [...(g.get(e.group) ?? []), spec])
    }
    return [...g.entries()]
  }, [served, needle])

  const take = (spec: IndicatorSpec) => {
    if (addSpecToLayout(userId, spec)) {
      setOnPage((s) => new Set([...s, spec.id]))
      onTaken()
    }
  }

  const row = (spec: IndicatorSpec) => {
    const taken = onPage.has(spec.id)
    return (
      <div key={spec.id} className="flex items-center gap-2.5 rounded-md border border-border/70 bg-surface px-2.5 py-2">
        <span className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-[8px]', TINT_PAIR((spec.tint ?? 'blue') as TintName))}>
          <AppIcon name={spec.icon ?? 'activity'} size={15} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="clamp-1 text-[13px] font-semibold text-text-1">{spec.label}</p>
          {/* the style + the DATA it shows — the one-line, no-ceremony row */}
          <p className="clamp-1 text-[11px] text-text-3">{spec.chart ?? 'number'} · {dataSentence(spec)}</p>
        </div>
        <button
          onClick={() => take(spec)}
          disabled={taken}
          className="flex h-7 shrink-0 items-center gap-1 rounded-md border border-border px-2 text-[11.5px] font-semibold text-text-1 transition-colors hover:bg-surface-2 disabled:opacity-50"
        >
          {taken ? <><Check size={12} /> On your page</> : <><Plus size={12} /> Add</>}
        </button>
      </div>
    )
  }

  const sectionLabel = (text: string) => (
    <p className="pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-text-3 first:pt-0">{text}</p>
  )

  const nothing = rows !== null && bankSpecs.length === 0 && exampleGroups.length === 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Add a widget</DialogTitle>
          <DialogDescription>
            The bank and the examples, one press each — every row says what data
            it shows. Live previews stay in the <Link to="/app/widgets/bank" className="font-semibold text-primary hover:underline">Widgets app</Link>.
          </DialogDescription>
        </DialogHeader>

        <label className="flex items-center gap-2 rounded-md border border-border bg-surface px-2.5 py-1.5">
          <Search size={14} className="shrink-0 text-text-3" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name or resource…"
            className="w-full bg-transparent text-[13px] text-text-1 outline-none placeholder:text-text-3"
          />
        </label>

        {rows === null ? (
          <p className="flex items-center gap-2 py-4 text-[13px] text-text-3">
            <Loader2 size={14} className="animate-spin" /> Opening the bank…
          </p>
        ) : nothing ? (
          <p className="py-4 text-[13px] italic text-text-3">
            {needle ? 'Nothing matches that search.' : 'Nothing to offer yet. Curators fill the bank from the Widgets app.'}
          </p>
        ) : (
          <div className="max-h-[60vh] space-y-1 overflow-y-auto pr-1">
            {bankSpecs.length > 0 && (
              <>
                {sectionLabel('From the bank')}
                {bankSpecs.map(row)}
              </>
            )}
            {exampleGroups.map(([group, specs]) => (
              <div key={group} className="space-y-1">
                {sectionLabel(`From the examples · ${group}`)}
                {specs.map(row)}
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
