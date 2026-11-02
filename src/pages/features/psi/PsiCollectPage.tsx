// PSI Log › Collection: what the collection has read from PsiAnywhere, kind by kind, its runs and why a kind was not
// read; "Collect now" starts one with the master's PsiAnywhere session (else the platform's own sign-in). It also runs
// by itself once a day (app/psi_harvest.py). App Control's psi-log.collection row opens it.
import { useCallback, useEffect, useState } from 'react'
import { DownloadCloud, Loader2, RefreshCw } from 'lucide-react'
import PageHeader from '@/components/shared/PageHeader'
import { relayLane } from '@/lib/noticesApi'
import { toast } from '@/stores/useToastStore'
import { cn } from '@/lib/utils'
import type { PsiKind } from '@/pages/features/psi/PsiDataPage'

type Run = { id: number; startedAt: string; finishedAt: string; by: string; result: Record<string, Record<string, unknown>> }
type Collect = {
  status: { running?: boolean; kind?: string; done?: number; of?: number }
  runs: Run[]; kinds: PsiKind[]; dailyAt: string; zone: string
}
const text = (v: unknown): string => (v == null ? '' : typeof v === 'string' ? v : String(v))
function when(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}
const btn = 'flex h-9 items-center gap-1.5 rounded-md px-3 text-[13px] font-semibold disabled:opacity-50'

export default function PsiCollectPage() {
  const [view, setView] = useState<Collect | null>(null)
  const [why, setWhy] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const got = await relayLane<Collect>('/hub-lanes/psi-log/collect')
      setView({ status: got?.status ?? {}, runs: Array.isArray(got?.runs) ? got.runs : [],
        kinds: Array.isArray(got?.kinds) ? got.kinds : [], dailyAt: text(got?.dailyAt), zone: text(got?.zone) })
      setWhy('')
    } catch (e) {
      setWhy(e instanceof Error ? e.message : 'the collection could not be read')
    }
  }, [])
  useEffect(() => { void load() }, [load])
  useEffect(() => {
    if (!view?.status.running) return
    const t = window.setInterval(() => void load(), 5000)
    return () => window.clearInterval(t)
  }, [view?.status.running, load])

  const collect = async (): Promise<void> => {
    setBusy(true)
    try {
      const got = await relayLane<{ started?: boolean; how?: string; why?: string }>('/hub-lanes/psi-log/collect', { method: 'POST', body: '{}' })
      if (got?.started) toast({ type: 'success', title: 'Collecting from PsiAnywhere', body: `With ${text(got.how)}. It takes a while — this page follows it.` })
      else toast({ type: 'danger', title: 'Not started', body: text(got?.why) || 'A collection is running now.' })
      await load()
    } catch (e) {
      toast({ type: 'danger', title: 'Not started', body: e instanceof Error ? e.message : 'Try again.' })
    } finally {
      setBusy(false)
    }
  }

  const s = view?.status ?? {}
  const last = view?.runs[0]

  return (
    <div className="mx-auto w-full max-w-[900px]">
      <PageHeader title="PSI collection" subtitle={`Everything PsiAnywhere answers about staff and clients, kept in the Hub — by itself every day at ${view?.dailyAt || '04:30'} New York.`} />
      {why && <div className="mb-3 rounded-md border border-tint-amber bg-tint-amber px-3 py-2 text-[12.5px] text-text-1">{why}</div>}
      <div className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface p-4">
        <div className="min-w-0 flex-1 text-[13px] text-text-2">
          {s.running ? (
            <span className="flex items-center gap-2 text-text-1"><Loader2 size={14} className="animate-spin" />
              Collecting — {text(s.kind)} ({Number(s.done) || 0} of {Number(s.of) || 0} kinds)</span>
          ) : last ? `Last collection ${when(last.startedAt)}${last.finishedAt ? `, finished ${when(last.finishedAt)}` : ' — not finished'}.` : 'Nothing collected yet.'}
          <div className="text-[12px] text-text-3">Sign in to PsiAnywhere on the PSI Log page first to collect with your own session; otherwise the platform signs in.</div>
        </div>
        <button type="button" onClick={() => void load()} aria-label="Refresh" className={cn(btn, 'border border-border bg-surface text-text-1 hover:bg-surface-2')}><RefreshCw size={14} /></button>
        <button type="button" onClick={() => void collect()} disabled={busy || !!s.running} className={cn(btn, 'bg-primary text-on-primary hover:opacity-90')}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : <DownloadCloud size={14} />} Collect now
        </button>
      </div>

      <div className="mb-3 rounded-lg border border-border bg-surface p-4">
        <div className="mb-2 text-[13px] font-semibold text-text-1">What is kept</div>
        <ul className="divide-y divide-border text-[13px]">
          {(view?.kinds ?? []).map((k) => {
            const r = last?.result?.[k.kind]
            return (
              <li key={k.kind} className="flex flex-wrap items-center gap-2 py-1.5">
                <span className="min-w-[180px] flex-1 font-semibold text-text-1">{k.label}</span>
                <span className="text-text-3">{k.method}{k.of ? ` per ${k.of}` : ''}</span>
                <span className="w-[70px] text-right text-text-1">{k.rows}</span>
                {r && text(r.skipped) && <span className="w-full text-[12px] text-tint-fg-pink">Last run: not read — {text(r.skipped)}</span>}
                {r && Number(r.missed) > 0 && <span className="w-full text-[12px] text-tint-fg-pink">Last run: {text(r.missed)} of {text(r.items)} not read — {text(r.firstMiss)}</span>}
              </li>
            )
          })}
        </ul>
      </div>

      <div className="rounded-lg border border-border bg-surface p-4">
        <div className="mb-2 text-[13px] font-semibold text-text-1">Runs</div>
        {(view?.runs ?? []).length === 0 ? <div className="text-[13px] text-text-3">None yet.</div> : (
          <ul className="divide-y divide-border text-[13px]">
            {view?.runs.map((r) => (
              <li key={r.id} className="flex flex-wrap gap-2 py-1.5">
                <span className="w-[140px] text-text-3">{when(r.startedAt)}</span>
                <span className="flex-1 text-text-1">{r.by === 'clock' ? 'Daily' : 'By the master'}{r.finishedAt ? '' : ' · not finished'}</span>
                <span className="text-text-2">{Object.values(r.result || {}).filter((x) => x && !x.skipped).length} kinds read · {Object.values(r.result || {}).filter((x) => x && x.skipped).length} not</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
