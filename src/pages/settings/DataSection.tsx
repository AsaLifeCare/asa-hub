// Settings → Data (admins only, anchor #data).
// "Legacy import" card: one button → backend `syncFromLegacy`, a one-way upsert import from the previous talent…
import { useState } from 'react'
import { motion } from 'framer-motion'
import { DatabaseZap, Loader2, PhoneCall, Shield, ShieldCheck } from 'lucide-react'
import Card, { CardHeader } from '@/components/shared/Card'
import EmptyState from '@/components/shared/EmptyState'
import { gasAction } from '@/features/hiring/shared'
import { toast } from '@/stores/useToastStore'
import { EASE_OUT_EXPO } from '@/engine/motion'
import { ohioDateTime } from '@/lib/ohio'

const LAST_RUN_KEY = 'asa-last-legacy-sync'

type SyncSummary = Record<string, { updated?: number; inserted?: number }>

function fmtLastRun(iso: string | null): string | null {
  if (!iso) return null
  // last-run stamp in Ohio wall-clock, whoever is looking
  return ohioDateTime(iso) || null
}

export default function DataSection() {
  const [busy, setBusy] = useState(false)
  const [summary, setSummary] = useState<SyncSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [lastRun, setLastRun] = useState<string | null>(() => localStorage.getItem(LAST_RUN_KEY))

  const run = async () => {
    setBusy(true)
    setError(null)
    try {
      const result = await gasAction<SyncSummary>('syncFromLegacy', {})
      const now = new Date().toISOString()
      localStorage.setItem(LAST_RUN_KEY, now)
      setLastRun(now)
      setSummary(result ?? {})
      const tabs = Object.keys(result ?? {}).length
      toast({ type: 'success', title: 'Legacy sync complete', body: `${tabs} tab${tabs === 1 ? '' : 's'} reconciled from the previous talent sheet.` })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Legacy sync failed.'
      setError(msg)
      toast({ type: 'danger', title: 'Legacy sync failed', body: msg })
    } finally {
      setBusy(false)
    }
  }

  const lastRunLabel = fmtLastRun(lastRun)

  return (
    <motion.section
      id="data"
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-10% 0px' }}
      transition={{ duration: 0.24, ease: EASE_OUT_EXPO }}
      className="scroll-mt-[84px]"
    >
      <Card padded={false} className="p-6">
        <CardHeader
          title="Data"
          sub="Imports and data maintenance for the Hub spreadsheet."
          extra={
            <span className="inline-flex items-center gap-1.5 rounded-full bg-primary-soft px-2.5 py-1 text-[11px] font-semibold text-primary-strong">
              <ShieldCheck size={12} /> Admins only
            </span>
          }
        />

        <div className="rounded-md border border-border bg-surface-2 p-4">
          <div className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-[10px] bg-tint-mint text-tint-fg-mint">
              <DatabaseZap size={15} />
            </span>
            <div>
              <h3 className="text-[13.5px] font-semibold text-text-1">Legacy import</h3>
              <p className="text-[12px] text-text-3">One-way upsert from the previous talent sheet.</p>
            </div>
          </div>

          <p className="mt-3 text-[13px] leading-5 text-text-2">
            Pulls the previous talent sheet into the Hub tabs as a one-way upsert — legacy rows are inserted or
            updated in place, and rows created in the Hub always survive untouched. Safe to run repeatedly.
          </p>

          <div className="mt-3.5 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void run()}
              disabled={busy}
              className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-[13px] font-semibold text-on-primary transition-colors hover:bg-primary-hover active:scale-[0.98] disabled:opacity-40"
            >
              {busy ? <Loader2 size={13} className="animate-spin" /> : <DatabaseZap size={13} />}
              {busy ? 'Syncing…' : 'Sync from legacy'}
            </button>
            {lastRunLabel && <span className="text-[12px] text-text-3">Last run: {lastRunLabel}</span>}
          </div>

          {error && (
            <p className="mt-3 rounded-md bg-tint-danger px-3 py-2 text-[12px] font-medium leading-5 text-tint-fg-danger">{error}</p>
          )}

          {summary && (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
              className="mt-3.5 rounded-md border border-border bg-surface p-3"
            >
              <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-text-3">Per-tab summary</p>
              {Object.keys(summary).length === 0 ? (
                <p className="mt-2 text-[12.5px] text-text-3">Nothing to import — everything is already up to date.</p>
              ) : (
                <ul className="mt-1.5 divide-y divide-border">
                  {Object.entries(summary).map(([tab, counts]) => (
                    <li key={tab} className="flex items-center justify-between gap-3 py-1.5 text-[12.5px]">
                      <span className="font-mono text-[12px] font-medium text-text-1">{tab}</span>
                      <span className="shrink-0 tabular-nums text-text-2">
                        {counts?.updated ?? 0} updated · {counts?.inserted ?? 0} inserted
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </motion.div>
          )}
        </div>

        <CommsSyncCard />
        <PoliciesImportCard />
      </Card>
    </motion.section>
  )
}

type CommsResult = {
  transcripts: number
  messages: number
  summarized: number
  summaries_pending: number
  window_days: number
  note?: string
}

const COMMS_LAST_RUN_KEY = 'asa-last-comms-sync'

// "Comms sync" — rebuilds the Hub's own 7-day phone-system window (transcripts + messages) and derives AI call…
function CommsSyncCard() {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<CommsResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [lastRun, setLastRun] = useState<string | null>(() => localStorage.getItem(COMMS_LAST_RUN_KEY))

  const run = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await gasAction<CommsResult>('commsSync', {}, { timeoutMs: 240000 })
      const now = new Date().toISOString()
      localStorage.setItem(COMMS_LAST_RUN_KEY, now)
      setLastRun(now)
      setResult(res)
      toast({
        type: 'success',
        title: 'Comms window synced',
        body: `${res.transcripts} calls · ${res.messages} messages · ${res.summarized} new summaries.`,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Comms sync failed.'
      setError(msg)
      toast({ type: 'danger', title: 'Comms sync failed', body: msg })
    } finally {
      setBusy(false)
    }
  }

  const lastRunLabel = fmtLastRun(lastRun)

  return (
    <div className="mt-4 rounded-md border border-border bg-surface-2 p-4">
      <div className="flex items-center gap-2">
        <span className="grid h-8 w-8 place-items-center rounded-[10px] bg-tint-blue text-tint-fg-blue">
          <PhoneCall size={15} />
        </span>
        <div>
          <h3 className="text-[13.5px] font-semibold text-text-1">Comms sync</h3>
          <p className="text-[12px] text-text-3">Last 7 days of calls & messages into the Hub&apos;s own Comms sheet.</p>
        </div>
      </div>

      <p className="mt-3 text-[13px] leading-5 text-text-2">
        Rebuilds the rolling window from the phone-system mirror (read-only) and derives AI call summaries
        incrementally — a few new summaries per run, so repeat until none are pending. The Comms app and the
        pipeline&apos;s &quot;Pull call&quot; button read this sheet.
      </p>

      <div className="mt-3.5 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void run()}
          disabled={busy}
          className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-[13px] font-semibold text-on-primary transition-colors hover:bg-primary-hover active:scale-[0.98] disabled:opacity-40"
        >
          {busy ? <Loader2 size={13} className="animate-spin" /> : <PhoneCall size={13} />}
          {busy ? 'Syncing…' : 'Sync comms (7 days)'}
        </button>
        {lastRunLabel && <span className="text-[12px] text-text-3">Last run: {lastRunLabel}</span>}
      </div>

      {error && (
        <p className="mt-3 rounded-md bg-tint-danger px-3 py-2 text-[12px] font-medium leading-5 text-tint-fg-danger">{error}</p>
      )}

      {result && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="mt-3.5 rounded-md border border-border bg-surface p-3"
        >
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-text-3">Window summary</p>
          <ul className="mt-1.5 divide-y divide-border text-[12.5px]">
            <li className="flex justify-between py-1.5"><span className="text-text-1">Call transcripts</span><span className="tabular-nums text-text-2">{result.transcripts}</span></li>
            <li className="flex justify-between py-1.5"><span className="text-text-1">Messages</span><span className="tabular-nums text-text-2">{result.messages}</span></li>
            <li className="flex justify-between py-1.5"><span className="text-text-1">Summaries derived this run</span><span className="tabular-nums text-text-2">{result.summarized}</span></li>
            <li className="flex justify-between py-1.5"><span className="text-text-1">Summaries still pending</span><span className="tabular-nums text-text-2">{result.summaries_pending}</span></li>
          </ul>
          {result.note && <p className="mt-2 text-[12px] leading-5 text-text-3">{result.note}</p>}
        </motion.div>
      )}
    </div>
  )
}

const POLICIES_LAST_RUN_KEY = 'asa-last-policies-import'

type PolicyImportResult = { imported: number; titles: string[]; skipped: string[] }

// "Import policies" — pulls the company's policy documents out of the Drive folder into the Hub's own `policies`…
function PoliciesImportCard() {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<PolicyImportResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [lastRun, setLastRun] = useState<string | null>(() => localStorage.getItem(POLICIES_LAST_RUN_KEY))

  const run = async () => {
    setBusy(true)
    setError(null)
    try {
      const raw = await gasAction<Partial<PolicyImportResult>>('policiesImport', {}, { timeoutMs: 240000 })
      // The backend may answer with a RECEIPT rather than the report (the write ledger accepts a long job and…
      const res: PolicyImportResult = {
        imported: Number(raw?.imported ?? 0),
        titles: Array.isArray(raw?.titles) ? raw.titles : [],
        skipped: Array.isArray(raw?.skipped) ? raw.skipped : [],
      }
      const now = new Date().toISOString()
      localStorage.setItem(POLICIES_LAST_RUN_KEY, now)
      setLastRun(now)
      setResult(res)
      toast(res.titles.length
        ? { type: 'success', title: `${res.imported} documents imported`, body: res.titles.join(' · ') }
        : { type: 'info', title: 'Import accepted', body: 'It is running — reopen Policies in a moment.' })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Policy import failed.'
      setError(msg)
      toast({ type: 'danger', title: 'Policy import failed', body: msg })
    } finally {
      setBusy(false)
    }
  }

  const lastRunLabel = fmtLastRun(lastRun)

  return (
    <div className="mt-4 rounded-md border border-border bg-surface-2 p-4">
      <div className="flex items-center gap-2">
        <span className="grid h-8 w-8 place-items-center rounded-[10px] bg-tint-peach text-tint-fg-peach">
          <Shield size={15} />
        </span>
        <div>
          <h3 className="text-[13.5px] font-semibold text-text-1">Policies</h3>
          <p className="text-[12px] text-text-3">The Drive policy folder into the Hub&apos;s own tab.</p>
        </div>
      </div>

      <p className="mt-3 text-[13px] leading-5 text-text-2">
        Reads every document in the policy folder — Google Docs directly, PDFs and Word files through Drive&apos;s
        own conversion — and rewrites the <span className="font-mono text-[12px]">policies</span> tab. Knowledge →
        Policies reads that tab. Run it after a policy is revised; the documents themselves stay in Drive.
      </p>

      <div className="mt-3.5 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void run()}
          disabled={busy}
          className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-[13px] font-semibold text-on-primary transition-colors hover:bg-primary-hover active:scale-[0.98] disabled:opacity-40"
        >
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Shield size={13} />}
          {busy ? 'Importing…' : 'Import policies'}
        </button>
        {lastRunLabel && <span className="text-[12px] text-text-3">Last run: {lastRunLabel}</span>}
      </div>

      {error && (
        <p className="mt-3 rounded-md bg-tint-danger px-3 py-2 text-[12px] font-medium leading-5 text-tint-fg-danger">{error}</p>
      )}

      {result && result.titles.length > 0 && (
        <div className="mt-3.5 rounded-md border border-border bg-surface p-3">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-text-3">Imported</p>
          <ul className="mt-1.5 divide-y divide-border text-[12.5px]">
            {result.titles.map((t) => (
              <li key={t} className="py-1.5 text-text-1">{t}</li>
            ))}
          </ul>
          {result.skipped.length > 0 && (
            <p className="mt-2 text-[12px] leading-5 text-text-3">
              Could not read: {result.skipped.join(', ')}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

/** Non-admin placeholder for #data — keeps the anchor alive but gated. */
export function RestrictedDataSection() {
  return (
    <motion.section
      id="data"
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-10% 0px' }}
      transition={{ duration: 0.24, ease: EASE_OUT_EXPO }}
      className="scroll-mt-[84px]"
    >
      <Card padded={false} className="p-6">
        <CardHeader title="Data" sub="Imports and data maintenance for the Hub spreadsheet." />
        <EmptyState
          title="Restricted — admins only"
          body="Data imports touch every workspace tab. Ask an admin if something needs a re-sync."
        />
      </Card>
    </motion.section>
  )
}
