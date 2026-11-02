// Settings → My Work → Support Requests: the automations' switches, read from the config before any is offered and…
// A key the backend does not list yet is not offered; it does not run.
import { useCallback, useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import { gasAction } from '@/features/hiring/shared'
import { toast } from '@/stores/useToastStore'
import { fetchAlerts, dropAlertsCache } from '@/lib/hiringAlerts'
import ConfigReadFailed from './ConfigReadFailed'
import {
  AUTO_LANDS, AUTO_NOT_KNOWN, AUTOS_FOOTNOTE, AUTOS_OFF, SUPPORT_AUTOMATIONS, autoWord, type AutoPart, type AutoValues,
} from './supportAutomations'

type ConfigRow = { key: string; value: string; group: string }

export default function SupportAutomationsBody() {
  const [values, setValues] = useState<AutoValues | null>(null)
  const [known, setKnown] = useState<AutoPart[]>([])
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState('')

  const load = useCallback(async () => {
    try {
      const d = await (fetchAlerts() as Promise<{ rows: ConfigRow[] }>)
      const byKey = new Map((d.rows ?? []).filter((r) => r.group === 'mywork').map((r) => [r.key, r.value]))
      setKnown(SUPPORT_AUTOMATIONS.filter((s) => byKey.has(s.key)).map((s) => s.part))
      const next: AutoValues = { ...AUTOS_OFF }
      for (const s of SUPPORT_AUTOMATIONS) next[s.part] = autoWord(byKey.get(s.key))
      setValues(next)
    } catch (e) {
      // never painted as "off": a switch flipped over a value nobody read would write a law
      setValues(null)
      setFailed((e instanceof Error ? e.message : String(e)) || 'the read did not come back')
    }
  }, [])
  useEffect(() => { void load() }, [load])

  const flip = async (part: AutoPart, on: boolean) => {
    if (!values) return
    const sw = SUPPORT_AUTOMATIONS.find((s) => s.part === part)
    if (!sw) return
    const before = values
    setValues({ ...values, [part]: on })
    setBusy(true)
    try {
      await gasAction('hiringAlertsSet', { values: { [sw.key]: on ? 'yes' : 'no' } })
      dropAlertsCache()
      toast({ type: 'success', title: 'Saved', body: AUTO_LANDS })
    } catch (e) {
      setValues(before)
      toast({ type: 'danger', title: 'Not saved', body: e instanceof Error ? e.message : 'Try again.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-5 space-y-3 border-t border-border pt-4" data-switch-group="Support Requests">
      <h3 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-text-3">Support Requests</h3>
      {values === null ? (
        failed
          ? <ConfigReadFailed why={failed} onRetry={() => { setFailed(''); void load() }} />
          : <p className="flex items-center gap-2 text-[13px] text-text-3"><Loader2 size={14} className="animate-spin" /> Reading the automations…</p>
      ) : (
        <SupportAutomationsView values={values} known={known} busy={busy} onFlip={(p, on) => void flip(p, on)} />
      )}
    </div>
  )
}

/** The switches once the config was read. */
export function SupportAutomationsView({ values, known, busy, onFlip }: {
  values: AutoValues
  known: readonly AutoPart[]
  busy: boolean
  onFlip: (part: AutoPart, on: boolean) => void
}) {
  return (
    <div className="space-y-3">
      {SUPPORT_AUTOMATIONS.map((s) => (
        <div key={s.part} className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2.5" data-auto={s.part}>
          <div className="min-w-0">
            <p className="text-[13.5px] font-semibold text-text-1">{s.label}</p>
            <p className="text-[12px] text-text-3">{s.desc}</p>
            {known.includes(s.part) ? (
              <p className="text-[12px] font-medium text-text-2" data-auto-word={s.part}>{values[s.part] ? 'On — runs' : 'Off — does not run'}</p>
            ) : (
              <p className="text-[12px] font-medium text-text-2" data-auto-not-known={s.part}>{AUTO_NOT_KNOWN}</p>
            )}
          </div>
          {known.includes(s.part) && (
            <Switch checked={values[s.part]} onCheckedChange={(on) => onFlip(s.part, on)} disabled={busy}
              aria-label={`Run ${s.label}`} />
          )}
        </div>
      ))}
      <p className="text-[12px] leading-4 text-text-3" data-auto-footnote="">{AUTOS_FOOTNOTE}</p>
    </div>
  )
}
