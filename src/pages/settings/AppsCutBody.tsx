// Settings → My Work → Apps: the apps kept to the master's own session (lib/appsCut, AlertsConfig.gs…
// Read from the config before a switch is offered; every flip saves the whole list through hiringAlertsSet, which…
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, Search } from 'lucide-react'
import TintTile from '@/components/shared/TintTile'
import { Switch } from '@/components/ui/switch'
import type { AppManifest } from '@/engine/types'
import { gasAction } from '@/features/hiring/shared'
import { useAuthStore } from '@/auth/useAuthStore'
import { APPS_CUT_KEY, appsCutCell, appsCutOffered, parseAppsCut, useAppsCutStore } from '@/lib/appsCut'
import { fetchAlerts, dropAlertsCache } from '@/lib/hiringAlerts'
import { useRegistryStore } from '@/stores/useRegistryStore'
import { toast } from '@/stores/useToastStore'
import ConfigReadFailed from './ConfigReadFailed'
import SeenPeopleBody from './SeenPeopleBody'

const APPS_SEEN_KEY = 'mywork_hide_apps_seen'

export const APPS_CUT_LANDS ='Everyone else stops seeing it the next time their Hub opens or reloads'

type ConfigRow = { key: string; value: string; group: string }

export default function AppsCutBody() {
  const apps = useRegistryStore((s) => s.apps)
  const [ids, setIds] = useState<string[] | null>(null)
  const [known, setKnown] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState('')
  const [query, setQuery] = useState('')

  const load = useCallback(async () => {
    try {
      const d = await (fetchAlerts() as Promise<{ rows: ConfigRow[] }>)
      const row = (d.rows ?? []).find((r) => r.key === APPS_CUT_KEY)
      setKnown(Boolean(row))
      setIds(parseAppsCut(row?.value))
    } catch (e) {
      // never painted as "nothing kept": a switch flipped over a list nobody read would rewrite it
      setIds(null)
      setFailed((e instanceof Error ? e.message : String(e)) || 'the read did not come back')
    }
  }, [])
  useEffect(() => { void load() }, [load])

  const flip = async (id: string, on: boolean) => {
    if (!ids) return
    const before = ids
    const next = on ? [...ids.filter((x) => x !== id), id] : ids.filter((x) => x !== id)
    setIds(next)
    setBusy(true)
    try {
      await gasAction('hiringAlertsSet', { values: { [APPS_CUT_KEY]: appsCutCell(next) } })
      dropAlertsCache()
      useAppsCutStore.setState({ token: useAuthStore.getState().token ?? null, ids: next })
      toast({ type: 'success', title: 'Saved', body: APPS_CUT_LANDS })
    } catch (e) {
      setIds(before)
      toast({ type: 'danger', title: 'Not saved', body: e instanceof Error ? e.message : 'Try again.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-5 space-y-3 border-t border-border pt-4" data-switch-group="Apps">
      <h3 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-text-3">Apps — hidden from everyone else</h3>
      {ids === null ? (
        failed
          ? <ConfigReadFailed why={failed} onRetry={() => { setFailed(''); void load() }} />
          : <p className="flex items-center gap-2 text-[13px] text-text-3"><Loader2 size={14} className="animate-spin" /> Reading the apps…</p>
      ) : (
        <>
          <AppsCutView apps={apps} ids={ids} known={known} busy={busy} query={query} onQuery={setQuery}
            onFlip={(id, on) => void flip(id, on)} />
          {known && (
            <SeenPeopleBody settingKey={APPS_SEEN_KEY} heading="People who also see them"
              blurb="These accounts keep seeing the hidden apps their badges open. App Control stays yours alone. Nobody is told the list exists."
              lands={APPS_CUT_LANDS} />
          )}
        </>
      )}
    </div>
  )
}

/** The registry's apps with a switch each, once the list was read; nothing is offered before the backend knows the key. */
export function AppsCutView({ apps, ids, known, busy, query, onQuery, onFlip }: {
  apps: readonly AppManifest[]
  ids: readonly string[]
  known: boolean
  busy: boolean
  query: string
  onQuery: (q: string) => void
  onFlip: (id: string, on: boolean) => void
}) {
  const offered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return apps
      .filter((a) => appsCutOffered(a.id))
      .filter((a) => !q || a.name.toLowerCase().includes(q) || a.id.toLowerCase().includes(q))
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [apps, query])
  if (!known) {
    return (
      <p className="rounded-md border border-border px-3 py-2.5 text-[13px] leading-[20px] text-text-2" data-apps-not-known>
        The backend does not know this list yet — it arrives with the platform release that carries it. Until
        then every app shows as released.
      </p>
    )
  }
  return (
    <div className="space-y-3">
      <p className="text-[12px] text-text-3">
        Switch an app on to keep it to your own session. Every other account stops seeing it, as if it had never
        been released; your own sidebar and App Hub keep it.
      </p>
      <label className="flex h-9 items-center gap-2 rounded-[10px] border border-border bg-bg px-3 focus-within:border-primary">
        <Search size={14} className="text-text-3" />
        <input value={query} onChange={(e) => onQuery(e.target.value)} placeholder="Search apps"
          aria-label="Search apps" data-apps-search
          className="h-full min-w-0 flex-1 bg-transparent text-[13px] text-text-1 outline-none placeholder:text-text-3" />
      </label>
      <div className="space-y-2">
        {offered.map((a) => {
          const on = ids.includes(a.id)
          return (
            <div key={a.id} className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2"
              data-app-cut={a.id}>
              <div className="flex min-w-0 items-center gap-2.5">
                <TintTile icon={a.icon} tint={a.accent} size="sm" />
                <div className="min-w-0">
                  <p className="truncate text-[13.5px] font-semibold text-text-1">{a.name}</p>
                  <p className="text-[12px] font-medium text-text-2" data-app-cut-word={a.id}>
                    {on ? 'Hidden from everyone else' : 'Shown as released'}
                  </p>
                </div>
              </div>
              <Switch checked={on} onCheckedChange={(v) => onFlip(a.id, v)} disabled={busy}
                aria-label={`Hide ${a.name} from everyone else`} />
            </div>
          )
        })}
        {!offered.length && <p className="text-[13px] text-text-3" data-apps-none>No app matches.</p>}
      </div>
    </div>
  )
}
