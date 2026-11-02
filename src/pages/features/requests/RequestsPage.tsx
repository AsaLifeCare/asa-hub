// Support Requests Queue — the 23-type queue the legacy portal ran on.
// Requests.gs has answered requestsList / requestSubmit / requestResolve for a long time and nothing called it.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import Card from '@/components/shared/Card'
import { ohioDayYear } from '@/lib/ohio'
import { formatPhoneDisplay } from '@/lib/phoneFormat'
import PageHeader from '@/components/shared/PageHeader'
import EmptyState from '@/components/shared/EmptyState'
import Avatar from '@/components/shared/Avatar'
import SegmentedTabs from '@/components/shared/SegmentedTabs'
import DragPerson from '@/components/shared/DragPerson'
import { gasAction } from '@/features/hiring/shared'
import { readSlice } from '@/lib/snapshotClient'
import { askPrompt } from '@/stores/useDialogStore'
import { toast } from '@/stores/useToastStore'
import { cn } from '@/lib/utils'

type Request = {
  id: string
  createdAt: string
  type: string
  urgency: string
  personId: string
  personName: string
  phone: string
  email: string
  details: string
  datesText: string
  dateFrom: string
  dateTo: string
  dateDays: string
  parseNote: string
  status: string
  verdict: string
  resolvedAt: string
  resolvedBy: string
  resolutionNote: string
}
type List = {
  requests: Request[]
  counts: { open: number; needs_dates: number; resolved: number; stale: number }
  types: string[]
  staleDays: number
}

const URGENCY_TINT: Record<string, string> = {
  high: 'bg-tint-pink text-tint-fg-pink',
  mid: 'bg-tint-amber text-tint-fg-amber',
  low: 'bg-surface-2 text-text-3',
}

// `verb` is what the dialog's confirm button says; `label` is the card button.
const VERDICTS: { id: string; label: string; verb: string; danger?: boolean }[] = [
  { id: 'approved', label: 'Approve', verb: 'Approve' },
  { id: 'denied', label: 'Deny', verb: 'Deny', danger: true },
  { id: 'resolved', label: 'Resolved', verb: 'Resolve' },
]

/** The staffRequests slice rows: header-keyed text off the house tab. */
type RawRequest = Record<string, string>

const URGENCY_RANK: Record<string, number> = { high: 0, mid: 1, low: 2 }

// The server's List shape, rebuilt from raw slice rows — the same sort (unresolved first, urgent first, oldest…
function listFromRaw(rows: RawRequest[]): List {
  const requests = rows
    .filter((r) => String(r.id || '').trim())
    .map((r) => {
      const out = {} as Record<string, string>
      for (const k of Object.keys(r)) out[k] = String(r[k] ?? '')
      return out as unknown as Request
    })
  requests.sort((a, b) => {
    const ra = a.status !== 'resolved' ? 0 : 1
    const rb = b.status !== 'resolved' ? 0 : 1
    if (ra !== rb) return ra - rb
    const ua = URGENCY_RANK[String(a.urgency)] ?? 3
    const ub = URGENCY_RANK[String(b.urgency)] ?? 3
    if (ua !== ub) return ua - ub
    return String(a.createdAt) < String(b.createdAt) ? -1 : 1
  })
  const counts = { open: 0, needs_dates: 0, resolved: 0, stale: 0 }
  for (const r of requests) {
    const st = String(r.status) as keyof typeof counts
    if (st in counts) counts[st]++
  }
  return { requests, counts, types: [], staleDays: 0 }
}

export default function RequestsPage() {
  const [status, setStatus] = useState('open')
  /** Seeded from the kept copy so the queue paints before any network. */
  const [data, setData] = useState<List | null>(() => {
    try { return JSON.parse(localStorage.getItem('asa:requests:queue') || 'null') as List | null }
    catch { return null }
  })
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [acting, setActing] = useState<string | null>(null)
  const liveLandedRef = useRef(false)

  // ONE unfiltered read — the tabs filter client-side for free.
  const load = useCallback(async () => {
    setBusy(true)
    setErr('')
    try {
      const d = await gasAction<List>('requestsList', {})
      liveLandedRef.current = true
      setData(d)
      try { localStorage.setItem('asa:requests:queue', JSON.stringify(d)) } catch { /* kept copy only */ }
    } catch (e) {
      // The server says whether the tab was unreadable or genuinely empty; its sentence is better than one invented…
      setErr(e instanceof Error ? e.message : 'Could not load the request queue.')
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    void readSlice<RawRequest>('staffRequests').then((rows) => {
      if (!rows || liveLandedRef.current) return
      setData(listFromRaw(rows))
    }).catch(() => { /* the live read is the truth either way */ })
    void load()
  }, [load])

  /** The rows of the chosen tab — a filter, not a network call. */
  const shown = useMemo(
    () => (data?.requests ?? []).filter((r) => String(r.status) === status),
    [data, status],
  )

  const resolve = async (req: Request, verdict: string) => {
    const v = VERDICTS.find((x) => x.id === verdict)
    const verb = v?.verb ?? verdict
    // The note is optional; answering the question is not.
    const note = await askPrompt({
      title: req.personName
        ? `${verb} ${req.personName}’s ${req.type} request?`
        : `${verb} this ${req.type} request?`,
      body: 'Records the verdict on the request. Telling them is Smart Comms’ job, not this screen’s.',
      label: 'Note (optional)',
      placeholder: 'Anything the next person reading this should know',
      multiline: true,
      confirmLabel: verb,
      tone: v?.danger ? 'danger' : undefined,
    })
    if (note === null) return
    setActing(req.id)
    try {
      const res = await gasAction<{ already?: boolean }>('requestResolve', {
        id: req.id, verdict, note: note.trim(),
      })
      toast({
        type: 'success',
        title: res?.already ? 'Already recorded' : `${req.personName} — ${verdict}`,
        body: 'Recorded. Telling them is Smart Comms’ job, not this screen’s.',
      })
      await load()
    } catch (e) {
      // A DIFFERENT verdict on a resolved request is a 409 by design — the server calls it "a conversation, not an…
      toast({ type: 'danger', title: 'Not recorded', body: e instanceof Error ? e.message : 'Try again.' })
    } finally {
      setActing(null)
    }
  }

  const counts = data?.counts
  const byType = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of shown) m.set(r.type, (m.get(r.type) ?? 0) + 1)
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
  }, [shown])

  return (
    <div className="w-full px-5 py-6">
      <PageHeader
        title="Support Requests Queue"
        subtitle="Twenty-three types, one queue, answered by a person"
        actions={
          <button
            onClick={() => void load()}
            disabled={busy}
            className="flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[13px] font-semibold text-text-1 transition-colors hover:bg-surface-2 disabled:opacity-50"
          >
            <RefreshCw size={14} className={busy ? 'animate-spin' : undefined} /> Refresh
          </button>
        }
      />

      <div className="mt-4">
        <SegmentedTabs
          tabs={[
            { id: 'open', label: `Open${counts ? ` · ${counts.open}` : ''}` },
            { id: 'needs_dates', label: `Needs dates${counts ? ` · ${counts.needs_dates}` : ''}` },
            { id: 'resolved', label: `Resolved${counts ? ` · ${counts.resolved}` : ''}` },
          ]}
          value={status}
          onChange={setStatus}
        />
      </div>

      {err && (
        <div className="mt-4 rounded-md border border-tint-pink bg-tint-pink/40 px-3 py-2.5 text-[13px] leading-5 text-tint-fg-pink">{err}</div>
      )}

      {/* Stale is counted by the server against its own threshold — shown
          because a queue nobody works is the failure this screen exists to
          make visible. */}
      {counts && counts.stale > 0 && data && data.staleDays > 0 && status === 'open' && (
        <p className="mt-3 rounded-md border border-tint-amber bg-tint-amber/40 px-3 py-2 text-[12.5px] font-medium text-tint-fg-amber">
          {counts.stale} request(s) have been open longer than {data.staleDays} days.
        </p>
      )}

      {byType.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {byType.map(([t, n]) => (
            <span key={t} className="rounded-full bg-surface-2 px-2.5 py-1 text-[11.5px] text-text-2">{t}: {n}</span>
          ))}
        </div>
      )}

      <div className="mt-4 space-y-3">
        {!busy && data && !shown.length && (
          <EmptyState title="Nothing in this queue" body="The tab answered and there is nothing at this status." />
        )}

        {shown.map((r) => (
          <Card key={r.id}>
            <div className="flex flex-wrap items-start gap-3">
              <Avatar src="" name={r.personName || '—'} size="md" />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  {/* A blank personName drags nothing — the placeholder stays text. */}
                  <DragPerson name={r.personName || ''} id={r.personId || undefined}>
                    <span className="text-[14px] font-semibold text-text-1">{r.personName || '(no name)'}</span>
                  </DragPerson>
                  <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-bold uppercase', URGENCY_TINT[String(r.urgency).toLowerCase()] ?? 'bg-surface-2 text-text-3')}>
                    {r.urgency || 'low'}
                  </span>
                  <span className="rounded-full bg-tint-blue px-2 py-0.5 text-[10px] font-bold uppercase text-tint-fg-blue">{r.type}</span>
                </span>
                {r.details && <span className="mt-1.5 block whitespace-pre-line text-[13px] leading-5 text-text-1">{r.details}</span>}
                {/* What they wrote, and what the parser made of it — both, so a
                    wrong reading is visible instead of silently authoritative. */}
                {(r.datesText || r.dateFrom) && (
                  <span className="mt-1 block text-[12px] text-text-3">
                    {r.datesText ? `Asked: "${r.datesText}"` : ''}
                    {r.dateFrom ? ` · read as ${r.dateFrom}${r.dateTo && r.dateTo !== r.dateFrom ? ` → ${r.dateTo}` : ''}${r.dateDays ? ` (${r.dateDays}d)` : ''}` : ''}
                    {r.parseNote ? ` · ${r.parseNote}` : ''}
                  </span>
                )}
                <span className="mt-1 block text-[11.5px] text-text-3">
                  {r.createdAt ? `Opened ${ohioDayYear(r.createdAt)}` : ''}
                  {r.phone ? ` · ${formatPhoneDisplay(r.phone)}` : ''}
                  {r.email ? ` · ${r.email}` : ''}
                </span>
                {r.status === 'resolved' && (
                  <span className="mt-1 block text-[12px] font-medium text-tint-fg-mint">
                    {r.verdict}{r.resolvedBy ? ` by ${r.resolvedBy}` : ''}{r.resolutionNote ? ` — ${r.resolutionNote}` : ''}
                  </span>
                )}
              </span>
            </div>

            {r.status !== 'resolved' && (
              <div className="mt-3 flex flex-wrap gap-2 border-t border-border pt-3">
                {VERDICTS.map((v) => (
                  <button
                    key={v.id}
                    onClick={() => void resolve(r, v.id)}
                    disabled={acting === r.id}
                    className={cn(
                      'h-8 rounded-md px-3 text-[12.5px] font-semibold transition-colors disabled:opacity-50',
                      v.danger
                        ? 'border border-border bg-surface text-danger hover:bg-tint-pink'
                        : 'bg-primary text-on-primary hover:bg-primary-hover',
                    )}
                  >
                    {v.label}
                  </button>
                ))}
              </div>
            )}
          </Card>
        ))}

        {busy && !data && <p className="text-[13px] text-text-3">Loading…</p>}
      </div>
    </div>
  )
}
