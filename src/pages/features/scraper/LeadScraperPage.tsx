// Lead Scraper — the control surface for the referral scraper (Scraper.gs).
// The old one ran as a Python job on a server, on a schedule nobody could see, and the only way to know whether it…
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { CircleCheck, CircleX, MessageSquare, Play, RotateCcw, Sparkles } from 'lucide-react'
import PageHeader from '@/components/shared/PageHeader'
import Card from '@/components/shared/Card'
import Skeleton from '@/components/shared/Skeleton'
import { gasAction } from '@/features/hiring/shared'
import { formatPhoneDisplay } from '@/lib/phoneFormat'
import { useApiConfigStore } from '@/stores/useApiConfigStore'
import { toast } from '@/stores/useToastStore'
import { useCan } from '@/auth/permissions'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

/** One phase's numbers — the same shape for collect, rate and notify. */
function PhaseResult({ title, stats }: { title: string; stats: { label: string; value: number }[] }) {
  return (
    <div>
      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-3">{title}</p>
      <div className="grid grid-cols-3 gap-3">
        {stats.map((s) => (
          <div key={s.label} className="rounded-md border border-border px-3 py-2">
            <p className="font-stat text-[20px] font-bold text-text-1">{s.value}</p>
            <p className="text-[11.5px] text-text-3">{s.label}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

type Config = Record<string, string>
type Counts = { total: number; unrated: number; high: number; open: number }
type RunResult = { pages: number; seen: number; unique: number; added: number; ran_at: string }
type ScoreResult = { considered: number; scored: number; failed: number; counts?: Counts }
type NotifyResult = { eligible: number; sent: number; failed: number; from: string; recipients: number }

// Settings grouped by the phase they belong to — the screen reads in the order the work happens: collect, rate…

export default function LeadScraperPage() {
  const [config, setConfig] = useState<Config | null>(null)
  const [passwordSet, setPasswordSet] = useState(false)
  const [running, setRunning] = useState(false)
  const [scoring, setScoring] = useState(false)
  const [notifying, setNotifying] = useState(false)
  const [counts, setCounts] = useState<Counts | null>(null)
  const [result, setResult] = useState<RunResult | null>(null)
  const [scoreResult, setScoreResult] = useState<ScoreResult | null>(null)
  const [notifyResult, setNotifyResult] = useState<NotifyResult | null>(null)
  const [scoringKeySet, setScoringKeySet] = useState(false)
  const [notifyKeySet, setNotifyKeySet] = useState(false)
  const [confirmNotify, setConfirmNotify] = useState(false)
  // what will actually be sent, defaults resolved by the backend
  const [error, setError] = useState('')
  const canManage = useCan('apps.manage')
  const live = useApiConfigStore((s) => s.driver) === 'apps-script'

  const load = useCallback(async () => {
    if (!live) {
      setError('This screen talks to the live backend. Switch the data source to the live backend.')
      return
    }
    try {
      const r = await gasAction<{
        config: Config; password_set: boolean; scoring_key_set: boolean
        notify_key_set: boolean; counts: Counts
        effective_system: string; effective_prompt: string
      }>('scraperConfig', {})
      setConfig(r.config ?? {})
      setPasswordSet(Boolean(r.password_set))
      setScoringKeySet(Boolean(r.scoring_key_set))
      setNotifyKeySet(Boolean(r.notify_key_set))
      setCounts(r.counts ?? null)
      setError('')
    } catch (err) {
      // Show the failure and NOTHING ELSE.
      setError(err instanceof Error ? err.message : 'Could not read the scraper settings.')
    }
  }, [live])

  useEffect(() => {
    void load()
  }, [load])


  const run = async () => {
    setRunning(true)
    setResult(null)
    try {
      const r = await gasAction<RunResult>('scraperRun', {})
      setResult(r)
      toast({
        type: r.added > 0 ? 'success' : 'info',
        title: r.added > 0 ? `${r.added} new referral${r.added === 1 ? '' : 's'}` : 'Nothing new',
        body: `${r.unique} on the portal, ${r.unique - r.added} already known.`,
      })
    } catch (err) {
      toast({ type: 'danger', title: 'The run failed', body: err instanceof Error ? err.message : 'Please try again.' })
    } finally {
      setRunning(false)
    }
  }

  const score = async () => {
    setScoring(true)
    setScoreResult(null)
    try {
      const r = await gasAction<ScoreResult>('scraperScore', {})
      setScoreResult(r)
      if (r.counts) setCounts(r.counts)
      toast({
        type: r.scored > 0 ? 'success' : 'info',
        title: r.scored > 0 ? `${r.scored} rated` : 'Nothing left to rate',
        body: r.failed > 0 ? `${r.failed} could not be rated and stay unrated.` : `${r.considered} considered.`,
      })
    } catch (err) {
      toast({ type: 'danger', title: 'Rating failed', body: err instanceof Error ? err.message : 'Please try again.' })
    } finally {
      setScoring(false)
    }
  }

  // Sending goes through a confirmation, always.
  const notify = async () => {
    setConfirmNotify(false)
    setNotifying(true)
    setNotifyResult(null)
    try {
      const r = await gasAction<NotifyResult>('scraperNotify', {})
      setNotifyResult(r)
      if (r.sent > 0) void load()
      toast({
        type: r.sent > 0 ? 'success' : 'info',
        title: r.sent > 0 ? `${r.sent} alert${r.sent === 1 ? '' : 's'} sent` : 'Nothing to send',
        body: `${r.eligible} above the threshold${r.failed ? `, ${r.failed} failed and can be retried` : ''}.`,
      })
    } catch (err) {
      toast({ type: 'danger', title: 'Could not send', body: err instanceof Error ? err.message : 'Please try again.' })
    } finally {
      setNotifying(false)
    }
  }

  const enabled = String(config?.enabled ?? '').toLowerCase() === 'yes'
  const notifyEnabled = String(config?.notify_enabled ?? '').toLowerCase() === 'yes'
  const ready = enabled && passwordSet && Boolean(config?.email)
  const canScore = scoringKeySet && (counts?.unrated ?? 0) > 0
  const recipientCount = String(config?.notify_recipients ?? '').split(',').filter((s) => s.trim()).length
  const canNotify = notifyEnabled && notifyKeySet && recipientCount > 0 && (counts?.high ?? 0) > 0

  return (
    <div className="w-full">
      <PageHeader
        title="Lead Scraper"
        subtitle="Open referrals from the county portal, into Potential Clients"
        actions={
          <>
            <button
              onClick={() => void load()}
              className="flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[13px] font-semibold text-text-1 transition-colors hover:bg-surface-2"
            >
              <RotateCcw size={14} /> Reload
            </button>
            <button
              onClick={run}
              disabled={!ready || running || !canManage}
              title={ready ? 'Fetch open referrals' : 'Switch it on and set the credentials first'}
              className="flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[13px] font-semibold text-text-1 transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Play size={15} /> {running ? 'Fetching…' : 'Fetch'}
            </button>
            <button
              onClick={score}
              disabled={!canScore || scoring || !canManage}
              title={
                !scoringKeySet
                  ? 'Rating needs OPENAI_API_KEY in Script Properties'
                  : (counts?.unrated ?? 0) === 0
                    ? 'Everything open is already rated'
                    : `Rate ${counts?.unrated} referral(s)`
              }
              className="flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[13px] font-semibold text-text-1 transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Sparkles size={15} /> {scoring ? 'Rating…' : `Rate${counts?.unrated ? ` ${counts.unrated}` : ''}`}
            </button>
            <button
              onClick={() => setConfirmNotify(true)}
              disabled={!canNotify || notifying || !canManage}
              title={
                !notifyEnabled
                  ? 'Text messages are switched off'
                  : !notifyKeySet
                    ? 'Sending needs OPENPHONE_API_KEY in Script Properties'
                    : recipientCount === 0
                      ? 'No recipients set'
                      : `Text ${recipientCount} number(s) about ${counts?.high} referral(s)`
              }
              className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-3.5 text-[13px] font-semibold text-on-primary transition-all hover:bg-primary-hover active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <MessageSquare size={15} /> {notifying ? 'Sending…' : 'Notify'}
            </button>
          </>
        }
      />

      {error && (
        <Card className="mb-4 border-tint-pink">
          <p className="text-[13px] font-semibold text-text-1">{error}</p>
          {!config && (
            <p className="mt-1 text-[12.5px] text-text-2">
              The settings themselves are safe in the spreadsheet — this screen just could not read
              them. Press Reload to try again.
            </p>
          )}
        </Card>
      )}

      {!config ? (
        error ? null : <Skeleton className="h-64 w-full rounded-lg" />
      ) : (
        <div className="space-y-4">
          <Card>
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="font-display text-[14px] font-semibold text-text-1">Status</p>
                <p className="mt-0.5 text-[12.5px] text-text-2">
                  It writes only referrals it has never seen — nothing already in the pipeline is touched.
                </p>
              </div>
              <label className="flex shrink-0 items-center gap-2 text-[12.5px] font-semibold text-text-1">
                <input
                  type="checkbox"
                  checked={enabled}
                  disabled={!canManage}
                  onChange={(e) => setConfig((c) => ({ ...(c ?? {}), enabled: e.target.checked ? 'yes' : 'no' }))}
                />
                Switched on
              </label>
            </div>

            {counts && (
              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  { label: 'In the pipeline', value: counts.total },
                  { label: 'Still open', value: counts.open },
                  { label: 'Not yet rated', value: counts.unrated },
                  { label: 'Worth a call', value: counts.high },
                ].map((s) => (
                  <div key={s.label} className="rounded-md border border-border px-3 py-2">
                    <p className="font-stat text-[20px] font-bold text-text-1">{s.value}</p>
                    <p className="text-[11.5px] text-text-3">{s.label}</p>
                  </div>
                ))}
              </div>
            )}

            {/* One line per phase: whether it can run, and why not when it can't. */}
            <div className="mt-3 grid gap-2">
              {[
                {
                  ok: passwordSet,
                  yes: 'Portal password is set — collecting can run',
                  no: 'Set BRITTCO_PASSWORD in Script Properties to collect',
                },
                {
                  ok: scoringKeySet,
                  yes: 'Rating key is set — referrals can be rated',
                  no: 'Set OPENAI_API_KEY in Script Properties to rate',
                },
                {
                  ok: notifyKeySet && recipientCount > 0,
                  yes: `Messaging is set — ${recipientCount} recipient(s)${notifyEnabled ? '' : ', but switched off'}`,
                  no: notifyKeySet ? 'No recipients set below' : 'Set OPENPHONE_API_KEY in Script Properties to send',
                },
              ].map((line, i) => (
                <span key={i} className="flex items-center gap-2 rounded-sm bg-surface-2 px-3 py-2 text-[12.5px]">
                  {line.ok ? (
                    <CircleCheck size={14} className="shrink-0 text-tint-fg-mint" />
                  ) : (
                    <CircleX size={14} className="shrink-0 text-tint-fg-pink" />
                  )}
                  <span className="text-text-2">{line.ok ? line.yes : line.no}</span>
                </span>
              ))}
              <Link
                to="/app/potential-clients/pipeline"
                className="flex items-center gap-2 rounded-sm bg-surface-2 px-3 py-2 text-[12.5px] font-semibold text-primary transition-colors hover:bg-surface-3"
              >
                Open the pipeline →
              </Link>
            </div>

            <label className="mt-3 flex items-center gap-2 text-[12.5px] font-semibold text-text-1">
              <input
                type="checkbox"
                checked={notifyEnabled}
                disabled={!canManage}
                onChange={(e) => setConfig((c) => ({ ...(c ?? {}), notify_enabled: e.target.checked ? 'yes' : 'no' }))}
              />
              Allow text messages
              <span className="font-normal text-text-3">— off by default; nothing sends without the button</span>
            </label>
          </Card>

          {(result || scoreResult || notifyResult) && (
            <Card>
              <p className="font-display text-[14px] font-semibold text-text-1">Last run</p>
              <div className="mt-2 space-y-3">
                {result && (
                  <PhaseResult
                    title="Collected"
                    stats={[
                      { label: 'On the portal', value: result.unique },
                      { label: 'Already known', value: result.unique - result.added },
                      { label: 'Added', value: result.added },
                    ]}
                  />
                )}
                {scoreResult && (
                  <PhaseResult
                    title="Rated"
                    stats={[
                      { label: 'Considered', value: scoreResult.considered },
                      { label: 'Rated', value: scoreResult.scored },
                      { label: 'Left unrated', value: scoreResult.failed },
                    ]}
                  />
                )}
                {notifyResult && (
                  <PhaseResult
                    title={`Texted from ${formatPhoneDisplay(notifyResult.from)}`}
                    stats={[
                      { label: 'Above threshold', value: notifyResult.eligible },
                      { label: 'Sent', value: notifyResult.sent },
                      { label: 'Failed', value: notifyResult.failed },
                    ]}
                  />
                )}
              </div>
            </Card>
          )}

          {/* THE KNOBS MOVED TO SETTINGS — configuration left loose on a
              working screen is the wrong shape for this platform.
              A screen shows the work; Settings holds the
              configuration — and uninstalling the app has to take its
              configuration with it, which a form on this page cannot do. */}
          <Card>
            <p className="font-display text-[14px] font-semibold text-text-1">Settings</p>
            <p className="mt-0.5 text-[12.5px] text-text-2">
              The portal URLs, the rating model, the threshold and the scoring prompt live in{' '}
              <a href="/settings#leadscraper" className="font-semibold text-primary hover:underline">
                Settings → Lead Scraper
              </a>
              . Still the <code className="rounded-sm bg-surface-2 px-1">scraper_config</code> tab, still no deploy.
            </p>
          </Card>
        </div>
      )}

      <AlertDialog open={confirmNotify} onOpenChange={setConfirmNotify}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Text {recipientCount} number{recipientCount === 1 ? '' : 's'}?</AlertDialogTitle>
            <AlertDialogDescription>
              {counts?.high ?? 0} referral{(counts?.high ?? 0) === 1 ? '' : 's'} rated above{' '}
              {config?.score_threshold ?? '7'} will be texted from {config?.notify_from || 'the Automations line'}.
              Each one is marked as sent, so pressing this again will not text the same lead twice. A message cannot
              be taken back.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={notify}>Send</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
