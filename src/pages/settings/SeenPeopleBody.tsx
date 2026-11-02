// Settings → My Work: the accounts a hide leaves out — one list cell of USR_ ids (AlertsConfig.gs…
// Nobody on it is told it exists.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, Search, X } from 'lucide-react'
import Avatar from '@/components/shared/Avatar'
import { gasAction } from '@/features/hiring/shared'
import { appsCutCell, parseAppsCut } from '@/lib/appsCut'
import { fetchAlerts, dropAlertsCache } from '@/lib/hiringAlerts'
import { cachedUsers, fetchUsersIfStale, type RawHubUser } from '@/lib/usersDirectory'
import { toast } from '@/stores/useToastStore'
import ConfigReadFailed from './ConfigReadFailed'

type ConfigRow = { key: string; value: string; group: string }

export type SeenPerson = { id: string; name: string; email: string; avatar: string }

const personOf = (r: RawHubUser): SeenPerson => ({
  id: String(r.id ?? ''),
  name: String(r.display_name ?? r.name ?? r.email ?? r.id ?? ''),
  email: String(r.email ?? ''),
  avatar: String(r.avatar ?? r.avatar_url ?? ''),
})

export default function SeenPeopleBody({ settingKey, heading, blurb, lands }: {
  /** the config cell the list lives in */
  settingKey: string
  heading: string
  blurb: string
  /** the saved toast's sentence: when the others see the change */
  lands: string
}) {
  const [ids, setIds] = useState<string[] | null>(null)
  const [people, setPeople] = useState<SeenPerson[]>(() => (cachedUsers() ?? []).map(personOf).filter((p) => p.id))
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState('')

  const load = useCallback(async () => {
    try {
      const d = await (fetchAlerts() as Promise<{ rows: ConfigRow[] }>)
      setIds(parseAppsCut((d.rows ?? []).find((r) => r.key === settingKey)?.value))
    } catch (e) {
      // never painted as "nobody": a person added over a list nobody read would rewrite it
      setIds(null)
      setFailed((e instanceof Error ? e.message : String(e)) || 'the read did not come back')
    }
  }, [settingKey])
  useEffect(() => {
    void load()
    fetchUsersIfStale().then((rows) => setPeople(rows.map(personOf).filter((p) => p.id))).catch(() => {})
  }, [load])

  const save = async (next: string[]) => {
    if (!ids) return
    const before = ids
    setIds(next)
    setBusy(true)
    try {
      await gasAction('hiringAlertsSet', { values: { [settingKey]: appsCutCell(next) } })
      dropAlertsCache()
      toast({ type: 'success', title: 'Saved', body: lands })
    } catch (e) {
      setIds(before)
      toast({ type: 'danger', title: 'Not saved', body: e instanceof Error ? e.message : 'Try again.' })
    } finally {
      setBusy(false)
    }
  }

  if (ids === null) {
    return (
      <div className="space-y-3 pt-2" data-seen-people={settingKey}>
        <h4 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-text-3">{heading}</h4>
        {failed
          ? <ConfigReadFailed why={failed} onRetry={() => { setFailed(''); void load() }} />
          : <p className="flex items-center gap-2 text-[13px] text-text-3"><Loader2 size={14} className="animate-spin" /> Reading…</p>}
      </div>
    )
  }
  return (
    <SeenPeopleView settingKey={settingKey} heading={heading} blurb={blurb} ids={ids} people={people}
      query={query} busy={busy} onQuery={setQuery}
      onRemove={(id) => void save(ids.filter((x) => x !== id))}
      onAdd={(id) => { setQuery(''); void save([...ids, id]) }} />
  )
}

/** The list once read: a chip per account with its avatar and an X, and a directory search that adds one. */
export function SeenPeopleView({ settingKey, heading, blurb, ids, people, query, busy, onQuery, onRemove, onAdd }: {
  settingKey: string
  heading: string
  blurb: string
  ids: readonly string[]
  people: readonly SeenPerson[]
  query: string
  busy: boolean
  onQuery: (q: string) => void
  onRemove: (id: string) => void
  onAdd: (id: string) => void
}) {
  const byId = useMemo(() => new Map(people.map((p) => [p.id, p])), [people])
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return people
      .filter((p) => !ids.includes(p.id) && (p.name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q)))
      .slice(0, 8)
  }, [people, query, ids])

  return (
    <div className="space-y-3 pt-2" data-seen-people={settingKey}>
      <h4 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-text-3">{heading}</h4>
      <p className="text-[12px] text-text-3">{blurb}</p>
      <div className="flex flex-wrap gap-2">
        {ids.map((id) => {
          const p = byId.get(id)
          return (
            <span key={id} className="flex items-center gap-1.5 rounded-full border border-border py-1 pl-1 pr-2 text-[12.5px] text-text-1"
              data-seen-person={id}>
              <Avatar src={p?.avatar} name={p?.name || id} size="xs" />
              {p?.name || id}
              <button type="button" disabled={busy} aria-label={`Remove ${p?.name || id}`}
                className="text-text-3 hover:text-text-1 disabled:opacity-50"
                onClick={() => onRemove(id)}>
                <X size={13} />
              </button>
            </span>
          )
        })}
        {!ids.length && <p className="text-[13px] text-text-3" data-seen-none>Nobody but you.</p>}
      </div>
      <label className="flex h-9 items-center gap-2 rounded-[10px] border border-border bg-bg px-3 focus-within:border-primary">
        <Search size={14} className="text-text-3" />
        <input value={query} onChange={(e) => onQuery(e.target.value)} placeholder="Add a person"
          aria-label="Add a person" data-seen-search
          className="h-full min-w-0 flex-1 bg-transparent text-[13px] text-text-1 outline-none placeholder:text-text-3" />
      </label>
      {matches.length > 0 && (
        <div className="space-y-1">
          {matches.map((p) => (
            <button key={p.id} type="button" disabled={busy} data-seen-add={p.id}
              className="flex w-full items-center gap-2.5 rounded-md border border-border px-3 py-2 text-left hover:bg-surface-2 disabled:opacity-50"
              onClick={() => onAdd(p.id)}>
              <Avatar src={p.avatar} name={p.name} size="xs" />
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-text-1">{p.name}</span>
              <span className="truncate text-[12px] text-text-3">{p.email}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
