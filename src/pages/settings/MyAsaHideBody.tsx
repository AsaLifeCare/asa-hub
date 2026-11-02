// Settings → My Work → My asa.
// and Bookmarks: the switch that keeps both to the master's own session and the accounts on its seen list…
import { useCallback, useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import { gasAction } from '@/features/hiring/shared'
import { fetchAlerts, dropAlertsCache } from '@/lib/hiringAlerts'
import { toast } from '@/stores/useToastStore'
import ConfigReadFailed from './ConfigReadFailed'
import SeenPeopleBody from './SeenPeopleBody'
import { worldHideOn } from './WorldHideBody'

export const MYASA_HIDE_KEY = 'mywork_hide_myasa'
export const MYASA_SEEN_KEY = 'mywork_hide_myasa_seen'

export const MYASA_HIDE_LANDS =
  'Everyone else sees it the next time their Hub opens or reloads; nobody’s saved bookmarks are deleted'

type ConfigRow = { key: string; value: string; group: string }

export default function MyAsaHideBody() {
  const [on, setOn] = useState<boolean | null>(null)
  const [known, setKnown] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState('')

  const load = useCallback(async () => {
    try {
      const d = await (fetchAlerts() as Promise<{ rows: ConfigRow[] }>)
      const row = (d.rows ?? []).find((r) => r.key === MYASA_HIDE_KEY)
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
      await gasAction('hiringAlertsSet', { values: { [MYASA_HIDE_KEY]: next ? 'yes' : 'no' } })
      dropAlertsCache()
      toast({ type: 'success', title: 'Saved', body: MYASA_HIDE_LANDS })
    } catch (e) {
      setOn(before)
      toast({ type: 'danger', title: 'Not saved', body: e instanceof Error ? e.message : 'Try again.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-5 space-y-3 border-t border-border pt-4" data-switch-group="My asa. and Bookmarks">
      <h3 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-text-3">My asa. and Bookmarks</h3>
      {on === null ? (
        failed
          ? <ConfigReadFailed why={failed} onRetry={() => { setFailed(''); void load() }} />
          : <p className="flex items-center gap-2 text-[13px] text-text-3"><Loader2 size={14} className="animate-spin" /> Reading the config…</p>
      ) : (
        <>
          <MyAsaHideView on={on} known={known} busy={busy} onFlip={(v) => void flip(v)} />
          {known && (
            <SeenPeopleBody settingKey={MYASA_SEEN_KEY} heading="People who also see them"
              blurb="These accounts keep My asa. and their Bookmarks exactly as they are. Nobody is told the list exists."
              lands={MYASA_HIDE_LANDS} />
          )}
        </>
      )}
    </div>
  )
}

/** The switch once the config was read; nothing is offered before the backend knows the key. */
export function MyAsaHideView({ on, known, busy, onFlip }: {
  on: boolean
  known: boolean
  busy: boolean
  onFlip: (on: boolean) => void
}) {
  if (!known) {
    return (
      <p className="rounded-md border border-border px-3 py-2.5 text-[13px] leading-[20px] text-text-2" data-myasa-not-known>
        The backend does not know this switch yet — it arrives with the platform release that carries it. Until
        then every account keeps My asa. and its Bookmarks.
      </p>
    )
  }
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2.5" data-myasa-hide>
      <div className="min-w-0">
        <p className="text-[13.5px] font-semibold text-text-1">My asa. and Bookmarks — hidden from everyone else</p>
        <p className="text-[12px] text-text-3">
          Every other account is treated as one they were never offered to: no My asa. app, no Bookmarks page and no
          bookmark star anywhere; whoever opens either lands on My Work. Your own session keeps everything, and
          nobody&rsquo;s saved bookmarks are deleted — they come back the day the switch goes off.
        </p>
        <p className="text-[12px] font-medium text-text-2" data-myasa-hide-word>
          {on ? 'Hidden from everyone else' : 'Shown to everyone'}
        </p>
      </div>
      <Switch checked={on} onCheckedChange={(v) => onFlip(v)} disabled={busy}
        aria-label="Hide My asa. and Bookmarks from everyone else" />
    </div>
  )
}
