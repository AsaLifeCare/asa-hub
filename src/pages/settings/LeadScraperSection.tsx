// Settings → Lead Scraper — the knobs that used to live on the app's own page.
// Configuration left loose on a working screen is the wrong shape for this platform.
import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { CircleCheck, CircleX, Loader2, MessageSquare, Play, RotateCcw, Save, Sparkles } from 'lucide-react'
import Card, { CardHeader } from '@/components/shared/Card'
import { useCan } from '@/auth/permissions'
import { gasAction } from '@/features/hiring/shared'
import { toast } from '@/stores/useToastStore'
import { EASE_OUT_EXPO } from '@/engine/motion'
import { cn } from '@/lib/utils'

type Cfg = Record<string, string>
type Counts = { total?: number; open?: number; unrated?: number; worth_a_call?: number }
type Flags = { password_set?: boolean; scoring_key_set?: boolean; notify_key_set?: boolean }

const inputCls =
  'h-9 w-full rounded-sm border border-border bg-surface px-3 text-[13px] text-text-1 outline-none transition-colors placeholder:text-text-3 focus:border-primary'

const FIELD_GROUPS: {
  title: string
  note?: string
  fields: { key: string; label: string; hint: string; multiline?: boolean; rows?: number }[]
}[] = [
  {
    title: 'Collecting',
    fields: [
      { key: 'referrals_url', label: 'Referrals page', hint: 'The open-referrals list the portal publishes.' },
      { key: 'login_url', label: 'Sign-in URL', hint: 'Where the credentials are posted.' },
      { key: 'email', label: 'Account e-mail', hint: 'The portal login. The password is never stored in a sheet.' },
      { key: 'pages', label: 'Pages per run', hint: 'How far back to walk each time.' },
    ],
  },
  {
    title: 'Rating',
    fields: [
      { key: 'home_zip', label: 'Home ZIP', hint: 'Distance is scored against this.' },
      { key: 'score_batch_size', label: 'Batch size', hint: 'How many to rate in one pass.' },
      { key: 'score_threshold', label: 'Alert threshold', hint: 'Above this rating a referral is worth telling someone.' },
      { key: 'score_model', label: 'Model', hint: 'Kept the same as the old platform so old and new ratings stay comparable.' },
    ],
  },
  {
    title: 'Telling someone',
    fields: [
      { key: 'notify_from', label: 'Sending number', hint: 'The Automations line is used when it resolves.' },
      { key: 'notify_recipients', label: 'Recipients', hint: 'Comma-separated, +1##########.' },
    ],
  },
  {
    title: 'The prompt',
    note:
      'What the model is actually asked. Leave a box empty to use the built-in default — the text below the box ' +
      'is what will be sent either way. Placeholders in {{double braces}} are filled from each referral: ' +
      'home_zip, referral_id, client_name, frequency, description, postal_code, client_gender, diagnosis, ' +
      'client_age, phone, email.',
    fields: [
      { key: 'score_system', label: 'Instruction', hint: 'Sets how the model answers. Blank = built-in.', multiline: true, rows: 3 },
      { key: 'score_prompt', label: 'Criteria', hint: 'The weighting that decides who to call first. Blank = built-in.', multiline: true, rows: 18 },
    ],
  },
]

export default function LeadScraperSection() {
  const canManage = useCan('apps.manage')
  const [config, setConfig] = useState<Cfg | null>(null)
  const [effective, setEffective] = useState<{ system: string; prompt: string }>({ system: '', prompt: '' })
  const [counts, setCounts] = useState<Counts>({})
  const [flags, setFlags] = useState<Flags>({})
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    try {
      const r = await gasAction<{ config: Cfg; effective_system?: string; effective_prompt?: string;
        counts?: Counts; password_set?: boolean; scoring_key_set?: boolean; notify_key_set?: boolean }>('scraperConfig', {})
      setConfig(r.config ?? {})
      setEffective({ system: r.effective_system ?? '', prompt: r.effective_prompt ?? '' })
      setCounts(r.counts ?? {})
      setFlags({ password_set: r.password_set, scoring_key_set: r.scoring_key_set, notify_key_set: r.notify_key_set })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the settings.')
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const save = async () => {
    if (!config) return
    setSaving(true)
    try {
      await gasAction('scraperConfigSet', { config })
      toast({ type: 'success', title: 'Lead Scraper settings saved', body: 'The next run already uses them — no deploy needed.' })
    } catch (err) {
      toast({ type: 'danger', title: 'Could not save', body: err instanceof Error ? err.message : 'Please try again.' })
    } finally {
      setSaving(false)
    }
  }

  // The four runs.
  const run = async (id: string, action: string, label: string) => {
    setBusy(id)
    try {
      const r = await gasAction<Record<string, unknown>>(action, {})
      await load()
      toast({ type: 'success', title: label,
              body: Object.entries(r || {}).filter(([, v]) => typeof v === 'number')
                .map(([k, v]) => `${k}: ${v}`).join(' · ') || 'Done.' })
    } catch (e) {
      toast({ type: 'danger', title: `${label} failed`, body: e instanceof Error ? e.message : 'Try again.' })
    } finally {
      setBusy('')
    }
  }

  const RUNS = [
    { id: 'reload', action: 'scraperConfig', label: 'Reloaded', Icon: RotateCcw, text: 'Reload' },
    { id: 'fetch', action: 'scraperRun', label: 'Collected', Icon: Play, text: 'Fetch' },
    { id: 'rate', action: 'scraperScore', label: 'Rated', Icon: Sparkles, text: 'Rate' },
    { id: 'notify', action: 'scraperNotify', label: 'Notified', Icon: MessageSquare, text: 'Notify' },
  ]

  return (
    <motion.section
      id="leadscraper"
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-10% 0px' }}
      transition={{ duration: 0.24, ease: EASE_OUT_EXPO }}
      className="scroll-mt-[84px]"
    >
      <Card padded={false} className="p-6">
        <CardHeader
          title="Lead Scraper"
          sub="Where the referrals are collected from, how they are rated, and who hears about a good one. Stored in the scraper_config tab — no deploy."
        />
        {error ? (
          <p className="rounded-md bg-tint-pink px-3 py-2 text-[12.5px] font-medium text-tint-fg-pink">{error}</p>
        ) : !config ? (
          <p className="flex items-center gap-2 py-4 text-[13px] text-text-3">
            <Loader2 size={14} className="animate-spin" /> Loading…
          </p>
        ) : (
          <div className="space-y-5">
            {/* WHAT IT HAS DONE, before what it is set to do. */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[['In the pipeline', counts.total], ['Still open', counts.open],
                ['Not yet rated', counts.unrated], ['Worth a call', counts.worth_a_call]].map(([l, v]) => (
                <div key={String(l)} className="rounded-md border border-border bg-surface px-3 py-2">
                  <p className="text-[18px] font-bold tabular-nums text-text-1">{v ?? '—'}</p>
                  <p className="text-[11px] text-text-3">{l}</p>
                </div>
              ))}
            </div>
            <div className="space-y-1">
              {[[flags.password_set, 'Portal password is set — collecting can run'],
                [flags.scoring_key_set, 'Rating key is set — referrals can be rated'],
                [flags.notify_key_set, 'Messaging is set']].map(([ok, text]) => (
                <p key={String(text)} className="flex items-center gap-1.5 rounded-sm bg-surface-2 px-2.5 py-1.5 text-[12px] text-text-2">
                  {ok ? <CircleCheck size={13} className="text-tint-fg-mint" /> : <CircleX size={13} className="text-tint-fg-pink" />}
                  {text}
                </p>
              ))}
            </div>
            <div className="flex flex-wrap gap-2 border-b border-border pb-4">
              {RUNS.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  disabled={!canManage || busy !== ''}
                  onClick={() => void run(r.id, r.action, r.label)}
                  className="flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[13px] font-semibold text-text-1 transition-colors hover:bg-surface-2 disabled:opacity-40"
                >
                  {busy === r.id ? <Loader2 size={13} className="animate-spin" /> : <r.Icon size={13} />}
                  {r.text}
                </button>
              ))}
            </div>
            {FIELD_GROUPS.map((g) => (
              <div key={g.title}>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-3">{g.title}</p>
                {g.note && <p className="mb-2 text-[11.5px] leading-4 text-text-2">{g.note}</p>}
                <div className={cn('grid gap-3', !g.fields.some((f) => f.multiline) && 'sm:grid-cols-2')}>
                  {g.fields.map((f) => (
                    <label key={f.key} className="block">
                      <span className="mb-1 block text-[12px] font-semibold text-text-2">{f.label}</span>
                      {f.multiline ? (
                        <textarea
                          className={cn(inputCls, 'h-auto resize-y py-2 font-mono text-[12px] leading-[1.5]')}
                          rows={f.rows ?? 6}
                          value={config[f.key] ?? ''}
                          disabled={!canManage}
                          placeholder="(empty — the built-in default below is used)"
                          onChange={(e) => setConfig((c) => ({ ...(c ?? {}), [f.key]: e.target.value }))}
                        />
                      ) : (
                        <input
                          className={inputCls}
                          value={config[f.key] ?? ''}
                          disabled={!canManage}
                          onChange={(e) => setConfig((c) => ({ ...(c ?? {}), [f.key]: e.target.value }))}
                        />
                      )}
                      <span className="mt-1 block text-[11px] text-text-3">{f.hint}</span>
                      {/* WHAT WILL ACTUALLY BE SENT, when the box is empty. An
                          empty field that hides a built-in is a field somebody
                          fills in unnecessarily, or worse, believes is off. */}
                      {f.multiline && !String(config[f.key] ?? '').trim() && (
                        <details className="mt-1.5 rounded-sm border border-border bg-surface-2">
                          <summary className="cursor-pointer px-3 py-1.5 text-[11px] font-semibold text-text-2">
                            Built-in default in use — show it
                          </summary>
                          <pre className="max-h-64 overflow-auto whitespace-pre-wrap px-3 pb-2 font-mono text-[11px] leading-[1.5] text-text-2">
                            {f.key === 'score_system' ? effective.system : effective.prompt}
                          </pre>
                        </details>
                      )}
                    </label>
                  ))}
                </div>
              </div>
            ))}
            <div className="flex justify-end border-t border-border pt-4">
              <button
                type="button"
                onClick={() => void save()}
                disabled={!canManage || saving}
                className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-[13px] font-semibold text-on-primary transition-colors hover:bg-primary-hover disabled:opacity-40"
              >
                {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                {saving ? 'Saving…' : 'Save settings'}
              </button>
            </div>
          </div>
        )}
      </Card>
    </motion.section>
  )
}
