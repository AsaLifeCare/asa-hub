// Settings → Essential sheets (the master only — MASTER_ONLY_SECTIONS, anchor #essentialsheets): the books people and
// forms still post to in Google, swept into the Hub's tables three times a day until everyone uses only the Hub, and
// a Sweep now that runs the same sweep at once. Every screen reads the Hub's own tables; this is the one place a sheet
// is read (app/essential_sheets.py).
import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Loader2, RefreshCw } from 'lucide-react'
import Card, { CardHeader } from '@/components/shared/Card'
import { EASE_OUT_EXPO } from '@/engine/motion'
import { keepLane, keptLane, laneGeneration } from '@/lib/laneKeep'
import { relayLane } from '@/lib/noticesApi'
import { toast } from '@/stores/useToastStore'
import { cn } from '@/lib/utils'

export const ESSENTIAL_PATH = '/hub-lanes/essential-sheets'

export type TabCounts = { added: number; refreshed: number; rows: number; skipped: string }
export type Sweep = { id: number; startedAt: string; by: string; result: Record<string, TabCounts> }
/** One essential tab and its own last sweep: when, by the clock or the master, what came in, or why not. */
export type EssentialTab = {
  resource: string
  tab: string
  last: (TabCounts & { at: string; by: string }) | null
}
export type EssentialView = {
  tabs: EssentialTab[]
  times: string[]
  nextAt: string
  running: boolean
  sweeps: Sweep[]
}

const text = (v: unknown): string => (typeof v === 'string' ? v : '')
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

function countsFrom(raw: unknown): Record<string, TabCounts> {
  const out: Record<string, TabCounts> = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const c = v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
    out[k] = { added: num(c.added), refreshed: num(c.refreshed), rows: num(c.rows), skipped: text(c.skipped) }
  }
  return out
}

/** The lane's answer as this screen draws it; null when it is not the list. */
export function essentialViewFrom(raw: unknown): EssentialView | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const d = raw as Record<string, unknown>
  if (!Array.isArray(d.tabs) || !Array.isArray(d.sweeps)) return null
  return {
    tabs: d.tabs.map((t) => {
      const r = (t ?? {}) as Record<string, unknown>
      const l = r.last && typeof r.last === 'object' ? (r.last as Record<string, unknown>) : null
      return {
        resource: text(r.resource),
        tab: text(r.tab),
        last: l ? { added: num(l.added), refreshed: num(l.refreshed), rows: num(l.rows), skipped: text(l.skipped),
          at: text(l.at), by: text(l.by) } : null,
      }
    }).filter((t) => t.resource),
    times: Array.isArray(d.times) ? d.times.map(text).filter(Boolean) : [],
    nextAt: text(d.next_at),
    running: d.running === true,
    sweeps: d.sweeps.map((s) => {
      const r = (s ?? {}) as Record<string, unknown>
      return { id: num(r.id), startedAt: text(r.started_at), by: text(r.by), result: countsFrom(r.result) }
    }).filter((s) => s.id > 0),
  }
}

const when = (iso: string): string => {
  const at = new Date(iso)
  return Number.isNaN(at.getTime()) ? iso : at.toLocaleString()
}

/** One sweep in a line: what came in, what changed, what was not swept. */
export function sweepWords(s: Sweep): string {
  const all = Object.values(s.result)
  const added = all.reduce((n, c) => n + c.added, 0)
  const refreshed = all.reduce((n, c) => n + c.refreshed, 0)
  const skipped = all.filter((c) => c.skipped).length
  const parts = [`${added} new row${added === 1 ? '' : 's'}`, `${refreshed} changed`]
  if (skipped) parts.push(`${skipped} tab${skipped === 1 ? '' : 's'} not swept`)
  return parts.join(' · ')
}

export default function EssentialSheetsSection() {
  const [view, setView] = useState<EssentialView | null>(() => essentialViewFrom(keptLane<unknown>(ESSENTIAL_PATH)))
  const [failed, setFailed] = useState('')
  const [sweeping, setSweeping] = useState(false)

  const load = useCallback(async () => {
    const generation = laneGeneration()
    try {
      const raw = await relayLane<unknown>(ESSENTIAL_PATH)
      const got = essentialViewFrom(raw)
      if (!got) {
        setFailed('the read came back without the list')
        return
      }
      keepLane(ESSENTIAL_PATH, raw, generation)
      setFailed('')
      setView(got)
    } catch (e) {
      setFailed((e instanceof Error ? e.message : String(e)) || 'the read did not come back')
    }
  }, [])
  useEffect(() => { void load() }, [load])

  /** The sweep, now; only what the lane answered is adopted. */
  const sweepNow = async () => {
    setSweeping(true)
    const generation = laneGeneration()
    try {
      const raw = await relayLane<unknown>(ESSENTIAL_PATH, { method: 'POST', body: '{}' })
      const got = essentialViewFrom(raw)
      if (got) {
        keepLane(ESSENTIAL_PATH, raw, generation)
        setView(got)
      }
      const last = got?.sweeps[0]
      toast({ type: 'success', title: 'Essential sheets swept', body: last ? sweepWords(last) : 'Done.' })
    } catch (e) {
      toast({ type: 'danger', title: 'Not swept', body: e instanceof Error ? e.message : 'Try again.' })
    } finally {
      setSweeping(false)
    }
  }

  const last = view?.sweeps[0]
  const notSwept = last ? Object.entries(last.result).filter(([, c]) => c.skipped) : []
  return (
    <motion.section
      id="essentialsheets"
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-10% 0px' }}
      transition={{ duration: 0.24, ease: EASE_OUT_EXPO }}
      className="scroll-mt-20"
    >
      <Card>
        <CardHeader
          title="Essential sheets — swept into the Hub three times a day"
          sub="The books people and forms still post to in Google. Every screen reads the Hub's own tables; these sheets are read only here, until everyone uses only the Hub. A row posted there is added here, a row nobody changed in the Hub takes the sheet's cells, and nothing is ever taken out."
        />
        {view === null ? (
          failed ? (
            <div className="rounded-md border border-danger/40 bg-danger/5 px-3 py-2.5 text-[13px] leading-[20px] text-text-1"
              data-essential-failed>
              <p>The essential sheets could not be read — {failed}.</p>
              <button type="button" onClick={() => { setFailed(''); void load() }}
                className="mt-2 inline-flex h-8 items-center rounded-md border border-border bg-surface px-3 text-[12.5px] font-semibold text-text-1 transition-colors hover:bg-surface-2">
                Try again
              </button>
            </div>
          ) : (
            <p className="flex items-center gap-2 text-[13px] text-text-3">
              <Loader2 size={14} className="animate-spin" /> Reading the essential sheets…
            </p>
          )
        ) : (
          <div className="space-y-3" data-essential>
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" onClick={() => void sweepNow()} disabled={sweeping || view.running}
                data-essential-sweep
                className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-[13px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60">
                {sweeping || view.running ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                {sweeping || view.running ? 'Sweeping…' : 'Sweep now'}
              </button>
              <p className="text-[12px] text-text-3" data-essential-times>
                {view.tabs.length} tabs · daily at {view.times.join(', ')} (New York) · next {when(view.nextAt)}
              </p>
            </div>
            {failed && (
              <p className="rounded-md border border-border bg-tint-amber px-3 py-2 text-[12.5px] text-text-2">
                The last read did not come back ({failed}); this is the list as it was last read.
              </p>
            )}
            {notSwept.length > 0 && (
              <div className="rounded-md border border-border bg-tint-amber px-3 py-2 text-[12.5px] text-text-2"
                data-essential-skipped>
                {notSwept.map(([r, c]) => <p key={r}><span className="font-mono">{r}</span>: {c.skipped}</p>)}
              </div>
            )}
            <div className="divide-y divide-border rounded-md border border-border" data-essential-tabs>
              {view.tabs.map((t) => (
                <div key={t.resource} className="flex items-start gap-3 px-3 py-2" data-essential-tab={t.resource}>
                  <div className="min-w-0 flex-1">
                    <p className="text-[12.5px] font-semibold text-text-1">{t.tab}</p>
                    <p className="font-mono text-[11px] text-text-3">{t.resource}</p>
                  </div>
                  <p className={cn('max-w-[60%] shrink-0 text-right text-[12px]',
                    t.last?.skipped ? 'text-danger' : 'text-text-2')}>
                    {!t.last ? 'Not swept yet.'
                      : t.last.skipped ? `Not swept ${when(t.last.at)} (${t.last.by === 'clock' ? 'daily' : 'now'}): ${t.last.skipped}.`
                        : `${when(t.last.at)} (${t.last.by === 'clock' ? 'daily' : 'now'}): ${t.last.added} new, ${t.last.refreshed} changed.`}
                  </p>
                </div>
              ))}
            </div>
            <div className="divide-y divide-border rounded-md border border-border" data-essential-sweeps>
              {view.sweeps.length === 0 && <p className="px-3 py-2 text-[12.5px] text-text-3">No sweep yet.</p>}
              {view.sweeps.map((s) => (
                <div key={s.id} className="flex items-center gap-3 px-3 py-2">
                  <span className="w-16 shrink-0 font-mono text-[11px] font-semibold text-text-3">
                    {s.by === 'clock' ? 'daily' : 'now'}
                  </span>
                  <span className="min-w-0 flex-1 text-[12.5px] text-text-1">{when(s.startedAt)}</span>
                  <span className="shrink-0 text-[12px] text-text-2">{sweepWords(s)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>
    </motion.section>
  )
}
