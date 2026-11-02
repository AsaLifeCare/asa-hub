// Settings → My Work → My World: the switch that keeps My World to the master's own session and the accounts on its…
// Every other account is answered as one Worlds are not offered to — no place on the rail, no Settings tab, no door…
import { useCallback, useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import { gasAction } from '@/features/hiring/shared'
import { fetchAlerts, dropAlertsCache } from '@/lib/hiringAlerts'
import { toast } from '@/stores/useToastStore'
import ConfigReadFailed from './ConfigReadFailed'
import SeenPeopleBody from './SeenPeopleBody'

export const WORLD_HIDE_KEY = 'mywork_hide_world'
export const WORLD_SEEN_KEY = 'mywork_hide_world_seen'

export const WORLD_HIDE_LANDS =
  'Everyone else sees it the next time their Hub opens or reloads; nothing in anybody’s world is deleted'

/** The cell as the server reads it (AlertsConfig.gs hubCfgOn_): only a plain yes is on. */
export function worldHideOn(raw: unknown): boolean {
  const v = String(raw ?? '').trim().toLowerCase()
  return v === 'yes' || v === 'on' || v === 'true' || v === '1'
}

type ConfigRow = { key: string; value: string; group: string }

export default function WorldHideBody() {
  const [on, setOn] = useState<boolean | null>(null)
  const [known, setKnown] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState('')

  const load = useCallback(async () => {
    try {
      const d = await (fetchAlerts() as Promise<{ rows: ConfigRow[] }>)
      const row = (d.rows ?? []).find((r) => r.key === WORLD_HIDE_KEY)
      setKnown(Boolean(row))
      setOn(worldHideOn(row?.value))
    } catch (e) {
      // never painted as "shown": a switch flipped over a value nobody read would write a law
      setOn(null)
      setFailed((e instanceof Error ? e.message : String(e)) || 'the read did not come back')
    }
  }, [])
  useEffect(() => { void load() }, [load])

  const flip = async (next: boolean) => {
    if (on === null) return
    const before = on
    setOn(next)
    setBusy(true)
    try {
      await gasAction('hiringAlertsSet', { values: { [WORLD_HIDE_KEY]: next ? 'yes' : 'no' } })
      dropAlertsCache()
      toast({ type: 'success', title: 'Saved', body: WORLD_HIDE_LANDS })
    } catch (e) {
      setOn(before)
      toast({ type: 'danger', title: 'Not saved', body: e instanceof Error ? e.message : 'Try again.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-5 space-y-3 border-t border-border pt-4" data-switch-group="My World">
      <h3 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-text-3">My World</h3>
      {on === null ? (
        failed
          ? <ConfigReadFailed why={failed} onRetry={() => { setFailed(''); void load() }} />
          : <p className="flex items-center gap-2 text-[13px] text-text-3"><Loader2 size={14} className="animate-spin" /> Reading the config…</p>
      ) : (
        <>
          <WorldHideView on={on} known={known} busy={busy} onFlip={(v) => void flip(v)} />
          {known && (
            <SeenPeopleBody settingKey={WORLD_SEEN_KEY} heading="People who also see it"
              blurb="These accounts keep their world exactly as it is. Nobody is told the list exists."
              lands={WORLD_HIDE_LANDS} />
          )}
        </>
      )}
    </div>
  )
}

/** The switch once the config was read; nothing is offered before the backend knows the key. */
export function WorldHideView({ on, known, busy, onFlip }: {
  on: boolean
  known: boolean
  busy: boolean
  onFlip: (on: boolean) => void
}) {
  if (!known) {
    return (
      <p className="rounded-md border border-border px-3 py-2.5 text-[13px] leading-[20px] text-text-2" data-world-not-known>
        The backend does not know this switch yet — it arrives with the platform release that carries it. Until
        then every account keeps its world.
      </p>
    )
  }
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2.5" data-world-hide>
      <div className="min-w-0">
        <p className="text-[13.5px] font-semibold text-text-1">My World — hidden from everyone else</p>
        <p className="text-[12px] text-text-3">
          Every other account is treated as one Worlds are not offered to: no My world on the rail, no Their world,
          no My world tab in Settings. Your own session keeps everything, and nothing in anybody&rsquo;s world is
          deleted — it comes back the day the switch goes off.
        </p>
        <p className="text-[12px] font-medium text-text-2" data-world-hide-word>
          {on ? 'Hidden from everyone else' : 'Shown to everyone'}
        </p>
      </div>
      <Switch checked={on} onCheckedChange={(v) => onFlip(v)} disabled={busy}
        aria-label="Hide My World from everyone else" />
    </div>
  )
}
