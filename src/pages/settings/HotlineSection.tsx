// EMPLOYEE SUPPORT HOTLINE — the machine's configuration, IN SETTINGS — everything that stood on the app's page as…
// The app's page is for OPERATING — the lanes; whether the sweep runs, the words the model is told, and the…
import { useEffect, useState } from 'react'
import { Bell, Check, Loader2, PlayCircle, Settings2 } from 'lucide-react'
import Card, { CardHeader } from '@/components/shared/Card'
import { gasAction } from '@/features/hiring/shared'
import { toast } from '@/stores/useToastStore'
import { formatPhoneDisplay } from '@/lib/phoneFormat'
import { cn } from '@/lib/utils'

type HotlineConfig = {
  enabled: string
  team_phone: string
  prompt: string
  default_prompt: string
  max_per_sweep: string
  processed_total?: number
  log_tail?: { call_id: string; at: string; caller: string; items: string; kinds: string; via: string }[]
}

export default function HotlineSection() {
  const [cfg, setCfg] = useState<HotlineConfig | null>(null)
  const [prompt, setPrompt] = useState('')
  const [enabled, setEnabled] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testOut, setTestOut] = useState<string | null>(null)

  useEffect(() => {
    gasAction<HotlineConfig>('hotlineConfigGet', {})
      .then((d) => {
        setCfg(d)
        setPrompt(d.prompt)
        setEnabled(String(d.enabled).toLowerCase() === 'on')
      })
      .catch(() => {})
  }, [])

  const apply = async () => {
    setSaving(true)
    try {
      await gasAction('hotlineConfigSet', { prompt, enabled: enabled ? 'on' : 'off' })
      toast({ type: 'success', title: 'Applied', body: 'The next sweep runs with these words — that is production.' })
    } catch (e) {
      toast({ type: 'danger', title: 'Not applied', body: e instanceof Error ? e.message : 'Try again.' })
    } finally {
      setSaving(false)
    }
  }

  const rehearse = async () => {
    setTesting(true)
    setTestOut(null)
    try {
      const d = await gasAction<{ calls: number; items: unknown[] }>(
        'hotlineSweep', { simulate: true }, { timeoutMs: 300000 })
      setTestOut(d.calls
        ? JSON.stringify(d.items, null, 2)
        : 'No unprocessed call is waiting — the rehearsal had nothing to read.')
    } catch (e) {
      setTestOut(e instanceof Error ? e.message : 'The rehearsal failed.')
    } finally {
      setTesting(false)
    }
  }

  return (
    <section id="hotline" className="scroll-mt-[84px]">
      <Card padded={false} className="p-6">
        <CardHeader
          title="Support Hotline"
          sub={`The ${formatPhoneDisplay(cfg?.team_phone ?? '5558')} line's processor — the sweep, the prompt, the rehearsal.${cfg?.processed_total ? ` ${cfg.processed_total} calls processed so far.` : ''}`}
          extra={<Settings2 size={16} className="text-text-3" />}
        />

        {!cfg ? (
          <p className="flex items-center gap-2 text-[13px] text-text-3">
            <Loader2 size={14} className="animate-spin" /> Reading the configuration…
          </p>
        ) : (
          <div className="space-y-4">
            <label className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface-2 px-3 py-2.5">
              <span>
                <span className="block text-[13px] font-semibold text-text-1">Processing</span>
                <span className="text-[11.5px] text-text-3">The relay sweeps the line every 10 minutes while this is on.</span>
              </span>
              <button
                onClick={() => setEnabled((v) => !v)}
                className={cn('h-6 w-11 shrink-0 rounded-full p-0.5 transition-colors', enabled ? 'bg-primary' : 'bg-surface-3')}
              >
                <span className={cn('block h-5 w-5 rounded-full bg-white shadow transition-transform', enabled && 'translate-x-5')} />
              </button>
            </label>

            <div>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-3">
                The prompt — what the model is told before every call
              </p>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={14}
                className="w-full rounded-md border border-border bg-surface px-3 py-2 font-mono text-[11.5px] leading-4 text-text-1 outline-none focus:border-primary"
              />
              <button
                onClick={() => setPrompt(cfg.default_prompt)}
                className="mt-1 text-[11.5px] font-semibold text-text-3 hover:text-text-1"
              >
                Restore the shipped prompt
              </button>
            </div>

            <p className="flex items-start gap-2 rounded-md bg-surface-2 px-3 py-2 text-[12px] leading-5 text-text-2">
              <Bell size={12} className="mt-0.5 shrink-0" />
              <span>
                Call-off alerts ride Smart Comms as <span className="font-semibold">"Hotline — a DSP called off"</span> —
                its switch and recipients live in the Smart Comms section below. Nothing in code holds a phone number.
              </span>
            </p>

            {(cfg.log_tail?.length ?? 0) > 0 && (
              <div>
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-3">Recent calls processed</p>
                <div className="divide-y divide-border/60 rounded-md border border-border">
                  {cfg.log_tail?.map((l, i) => (
                    <div key={i} className="flex items-center gap-2 px-3 py-1.5 text-[11.5px] text-text-3">
                      <span className="tabular-nums text-text-1">{l.at.slice(0, 16).replace('T', ' ')}</span>
                      <span>{formatPhoneDisplay(l.caller)}</span>
                      <span className="ml-auto">{l.items} item(s) · {l.kinds}</span>
                      <span className="rounded bg-surface-2 px-1 text-[10px] uppercase">{l.via}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {testOut !== null && (
              <pre className="scroll-thin max-h-[240px] overflow-auto rounded-md border border-border bg-surface-2 p-3 text-[11px] leading-4 text-text-2">{testOut}</pre>
            )}

            <div className="flex items-center gap-2">
              <button
                onClick={() => void apply()}
                disabled={saving}
                className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-3.5 text-[12.5px] font-semibold text-on-primary hover:bg-primary-hover disabled:opacity-50"
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Apply
              </button>
              <button
                onClick={() => void rehearse()}
                disabled={testing}
                title="Run the newest unprocessed call through the model — writes nothing, marks nothing"
                className="flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[12.5px] font-semibold text-text-2 hover:bg-surface-2 disabled:opacity-60"
              >
                {testing ? <Loader2 size={14} className="animate-spin" /> : <PlayCircle size={14} />} Rehearse
              </button>
            </div>
          </div>
        )}
      </Card>
    </section>
  )
}
