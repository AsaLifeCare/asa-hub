// Settings → App Control access (the master only — MASTER_ONLY_SECTIONS, anchor #appcontrolaccess).
// App Control shared with a person, app by app: the master adds an account from the directory (never the master…
import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { Loader2, Search, X } from 'lucide-react'
import Avatar from '@/components/shared/Avatar'
import Card, { CardHeader } from '@/components/shared/Card'
import SidePanel from '@/components/shared/SidePanel'
import TintTile from '@/components/shared/TintTile'
import { Checkbox } from '@/components/ui/checkbox'
import { Switch } from '@/components/ui/switch'
import { EASE_OUT_EXPO } from '@/engine/motion'
import type { AppManifest } from '@/engine/types'
import { gasAction } from '@/features/hiring/shared'
import { MASTER_ONLY_APPS } from '@/lib/badgeAccess'
import { cachedUsers, fetchUsersIfStale, isMasterAccountRow, type RawHubUser } from '@/lib/usersDirectory'
import { useRegistryStore } from '@/stores/useRegistryStore'
import { toast } from '@/stores/useToastStore'

/** One account on the list, as the server keeps it. */
export type AcDelegate = { id: string; apps: string[]; mayChange: boolean }

/** A person the picker can offer. */
export type AcPerson = { id: string; name: string; email: string; avatar: string; role: string }

/** The roles App Control is shared with (AppControlDelegates.gs AC_DELEGATE_ROLES). */
export const AC_DELEGATE_ROLES = ['admin', 'manager', 'staff']

export const AC_ACCESS_LANDS =
  'They see it the next time their Hub opens or reloads; a change they make is accepted within about three minutes.'

type RawDelegate = { id?: unknown; apps?: unknown; may_change?: unknown }

/** The server's answer as the screen keeps it. */
export function delegatesFrom(raw: unknown): AcDelegate[] {
  const list = Array.isArray(raw) ? (raw as RawDelegate[]) : []
  const out: AcDelegate[] = []
  for (const d of list) {
    const id = String(d?.id ?? '').trim()
    if (!id || out.some((x) => x.id === id)) continue
    const apps = Array.isArray(d.apps) ? d.apps.map((a) => String(a ?? '').trim()).filter(Boolean) : []
    out.push({ id, apps: [...new Set(apps)], mayChange: d.may_change === true })
  }
  return out
}

/** The whole list as the save door takes it. */
export function delegatesPayload(list: readonly AcDelegate[]): { id: string; apps: string[]; may_change: boolean }[] {
  return list.map((d) => ({ id: d.id, apps: [...d.apps], may_change: d.mayChange }))
}

/** The apps a list may hold: every app App Control draws, but App Control itself. */
export function acOfferedApps(apps: readonly AppManifest[]): AppManifest[] {
  return apps.filter((a) => !MASTER_ONLY_APPS.includes(a.id)).slice().sort((a, b) => a.name.localeCompare(b.name))
}

/** The people the picker offers: active employees, never the master account. */
export function acPeopleFrom(rows: readonly RawHubUser[]): AcPerson[] {
  return rows
    .filter((r) => !isMasterAccountRow(r) && r.active !== false &&
      AC_DELEGATE_ROLES.includes(String(r.role ?? 'staff').trim().toLowerCase()))
    .map((r) => ({
      id: String(r.id ?? ''),
      name: String(r.display_name ?? r.name ?? r.email ?? r.id ?? ''),
      email: String(r.email ?? ''),
      avatar: String(r.avatar ?? r.avatar_url ?? ''),
      role: String(r.role ?? 'staff').trim().toLowerCase(),
    }))
    .filter((p) => p.id)
}

export default function AppControlAccessSection() {
  const apps = useRegistryStore((s) => s.apps)
  const [list, setList] = useState<AcDelegate[] | null>(null)
  const [malformed, setMalformed] = useState(false)
  const [failed, setFailed] = useState('')
  const [people, setPeople] = useState<AcPerson[]>(() => acPeopleFrom(cachedUsers() ?? []))
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  /** the side panel's draft: one person's list while it is being chosen */
  const [draft, setDraft] = useState<AcDelegate | null>(null)

  const load = useCallback(async () => {
    try {
      const d = await gasAction<{ delegates?: unknown; malformed?: boolean }>('appControlDelegatesGet', {})
      setList(delegatesFrom(d?.delegates))
      setMalformed(d?.malformed === true)
    } catch (e) {
      setList(null)
      setFailed((e instanceof Error ? e.message : String(e)) || 'the read did not come back')
    }
  }, [])
  useEffect(() => {
    void load()
    fetchUsersIfStale().then((rows) => setPeople(acPeopleFrom(rows))).catch(() => {})
  }, [load])

  /** Save the whole list; only what the server answered is adopted. */
  const save = async (next: AcDelegate[]): Promise<boolean> => {
    if (!list) return false
    setBusy(true)
    try {
      const d = await gasAction<{ delegates?: unknown }>('appControlDelegatesSet', { delegates: delegatesPayload(next) })
      setList(delegatesFrom(d?.delegates))
      setMalformed(false)
      toast({ type: 'success', title: 'Saved', body: AC_ACCESS_LANDS })
      return true
    } catch (e) {
      toast({ type: 'danger', title: 'Not saved', body: e instanceof Error ? e.message : 'Try again.' })
      return false
    } finally {
      setBusy(false)
    }
  }

  const saveDraft = async () => {
    if (!list || !draft || !draft.apps.length) return
    const at = list.findIndex((d) => d.id === draft.id)
    const next = at === -1 ? [...list, draft] : list.map((d) => (d.id === draft.id ? draft : d))
    if (await save(next)) setDraft(null)
  }

  return (
    <motion.section
      id="appcontrolaccess"
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-10% 0px' }}
      transition={{ duration: 0.24, ease: EASE_OUT_EXPO }}
      className="scroll-mt-20"
    >
      <Card>
        <CardHeader
          title="App Control access — who else opens App Control"
          sub="Add a person and choose the exact apps they see inside App Control. They see those apps’ rows and the controls inside them, exactly as you do, and nothing else. With May change off they only look."
        />
        {list === null ? (
          failed ? (
            <div className="rounded-md border border-danger/40 bg-danger/5 px-3 py-2.5 text-[13px] leading-[20px] text-text-1"
              data-ac-access-failed>
              <p>
                The list could not be read — {failed}. Nothing is shown, so nothing is saved over a list nobody read.
              </p>
              <button type="button" onClick={() => { setFailed(''); void load() }}
                className="mt-2 inline-flex h-8 items-center rounded-md border border-border bg-surface px-3 text-[12.5px] font-semibold text-text-1 transition-colors hover:bg-surface-2">
                Try again
              </button>
            </div>
          ) : (
            <p className="flex items-center gap-2 text-[13px] text-text-3">
              <Loader2 size={14} className="animate-spin" /> Reading the list…
            </p>
          )
        ) : (
          <AppControlAccessView
            list={list} people={people} apps={apps} query={query} busy={busy} malformed={malformed}
            onQuery={setQuery}
            onAdd={(p) => { setQuery(''); setDraft({ id: p.id, apps: [], mayChange: false }) }}
            onEdit={(d) => setDraft({ ...d, apps: [...d.apps] })}
            onRemove={(id) => void save(list.filter((d) => d.id !== id))}
            onMayChange={(id, on) => void save(list.map((d) => (d.id === id ? { ...d, mayChange: on } : d)))}
          />
        )}
      </Card>
      <SidePanel
        open={draft !== null}
        onClose={() => setDraft(null)}
        label="App Control access"
        title={draft ? (people.find((p) => p.id === draft.id)?.name || draft.id) : ''}
        footer={draft && (
          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={() => setDraft(null)}
              className="h-9 rounded-md border border-border bg-surface px-3 text-[13px] font-semibold text-text-1 hover:bg-surface-2">
              Cancel
            </button>
            <button type="button" disabled={busy || !draft.apps.length} onClick={() => void saveDraft()}
              data-ac-access-save
              className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-[13px] font-semibold text-on-primary hover:bg-primary-hover disabled:opacity-50">
              {busy && <Loader2 size={14} className="animate-spin" />} Save
            </button>
          </div>
        )}
      >
        {draft && <DelegateAppsPicker draft={draft} apps={apps} onChange={setDraft} />}
      </SidePanel>
    </motion.section>
  )
}

/** The list once read: a row per person with their apps, May change and a remove, and a directory search that adds one. */
export function AppControlAccessView({ list, people, apps, query, busy, malformed, onQuery, onAdd, onEdit, onRemove,
  onMayChange }: {
  list: readonly AcDelegate[]
  people: readonly AcPerson[]
  apps: readonly AppManifest[]
  query: string
  busy: boolean
  malformed?: boolean
  onQuery: (q: string) => void
  onAdd: (p: AcPerson) => void
  onEdit: (d: AcDelegate) => void
  onRemove: (id: string) => void
  onMayChange: (id: string, on: boolean) => void
}) {
  const byId = useMemo(() => new Map(people.map((p) => [p.id, p])), [people])
  const nameOf = useMemo(() => new Map(apps.map((a) => [a.id, a.name])), [apps])
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return people
      .filter((p) => !list.some((d) => d.id === p.id) &&
        (p.name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q)))
      .slice(0, 8)
  }, [people, query, list])

  return (
    <div className="space-y-3" data-ac-access>
      {malformed && (
        <p className="rounded-md border border-border bg-tint-amber px-3 py-2 text-[12.5px] text-text-2" data-ac-access-malformed>
          The stored list could not be read as a list, so it shares App Control with nobody. Saving here replaces it.
        </p>
      )}
      <div className="space-y-2">
        {list.map((d) => {
          const p = byId.get(d.id)
          const names = d.apps.map((a) => nameOf.get(a) ?? a)
          return (
            <div key={d.id} className="rounded-md border border-border px-3 py-2.5" data-ac-delegate={d.id}>
              <div className="flex items-center gap-2.5">
                <Avatar src={p?.avatar} name={p?.name || d.id} size="xs" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13.5px] font-semibold text-text-1">{p?.name || d.id}</p>
                  {p?.email && <p className="truncate text-[12px] text-text-3">{p.email}</p>}
                </div>
                <label className="flex shrink-0 cursor-pointer items-center gap-2 text-[12px] font-medium text-text-2">
                  <Switch checked={d.mayChange} disabled={busy} onCheckedChange={(on) => onMayChange(d.id, on)}
                    aria-label={`${p?.name || d.id} may change these apps`} data-ac-may-change={d.id} />
                  May change
                </label>
                <button type="button" disabled={busy} aria-label={`Take ${p?.name || d.id} off the list`}
                  className="grid h-7 w-7 shrink-0 place-items-center rounded-sm text-text-3 hover:bg-surface-2 hover:text-text-1 disabled:opacity-50"
                  onClick={() => onRemove(d.id)}>
                  <X size={14} />
                </button>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {names.map((n, i) => (
                  <span key={d.apps[i]} className="rounded-full bg-surface-2 px-2 py-0.5 text-[11.5px] font-medium text-text-2"
                    data-ac-delegate-app={d.apps[i]}>
                    {n}
                  </span>
                ))}
                <button type="button" disabled={busy} onClick={() => onEdit(d)}
                  className="text-[12px] font-semibold text-primary hover:underline disabled:opacity-50">
                  Choose apps
                </button>
              </div>
            </div>
          )
        })}
        {!list.length && (
          <p className="text-[13px] text-text-3" data-ac-access-none>Nobody but you opens App Control.</p>
        )}
      </div>
      <label className="flex h-9 items-center gap-2 rounded-[10px] border border-border bg-bg px-3 focus-within:border-primary">
        <Search size={14} className="text-text-3" />
        <input value={query} onChange={(e) => onQuery(e.target.value)} placeholder="Add a person"
          aria-label="Add a person" data-ac-access-search
          className="h-full min-w-0 flex-1 bg-transparent text-[13px] text-text-1 outline-none placeholder:text-text-3" />
      </label>
      {matches.length > 0 && (
        <div className="space-y-1">
          {matches.map((p) => (
            <button key={p.id} type="button" disabled={busy} data-ac-access-add={p.id}
              className="flex w-full items-center gap-2.5 rounded-md border border-border px-3 py-2 text-left hover:bg-surface-2 disabled:opacity-50"
              onClick={() => onAdd(p)}>
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

/** The side panel's body: May change, and a checkbox per app App Control draws (App Control itself never offered). */
export function DelegateAppsPicker({ draft, apps, onChange }: {
  draft: AcDelegate
  apps: readonly AppManifest[]
  onChange: (next: AcDelegate) => void
}) {
  const [q, setQ] = useState('')
  const offered = useMemo(() => {
    const query = q.trim().toLowerCase()
    return acOfferedApps(apps).filter((a) => !query || a.name.toLowerCase().includes(query) || a.id.toLowerCase().includes(query))
  }, [apps, q])
  const toggle = (id: string, on: boolean) =>
    onChange({ ...draft, apps: on ? [...draft.apps.filter((a) => a !== id), id] : draft.apps.filter((a) => a !== id) })

  return (
    <div className="mt-3 space-y-3" data-ac-picker={draft.id}>
      <label className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2.5">
        <span>
          <span className="block text-[13px] font-semibold text-text-1">May change</span>
          <span className="block text-[12px] text-text-3">
            Off: they only look. On: they change these apps’ rows, and nothing else.
          </span>
        </span>
        <Switch checked={draft.mayChange} onCheckedChange={(on) => onChange({ ...draft, mayChange: on })}
          aria-label="May change" data-ac-picker-may-change />
      </label>
      <p className="text-[12px] text-text-3" data-ac-picker-count>
        {draft.apps.length === 0 ? 'Choose at least one app.' : `${draft.apps.length} ${draft.apps.length === 1 ? 'app' : 'apps'} chosen.`}
      </p>
      <label className="flex h-9 items-center gap-2 rounded-[10px] border border-border bg-bg px-3 focus-within:border-primary">
        <Search size={14} className="text-text-3" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search apps" aria-label="Search apps"
          className="h-full min-w-0 flex-1 bg-transparent text-[13px] text-text-1 outline-none placeholder:text-text-3" />
      </label>
      <div className="space-y-1.5">
        {offered.map((a) => {
          const on = draft.apps.includes(a.id)
          return (
            <label key={a.id} className="flex cursor-pointer items-center gap-2.5 rounded-md border border-border px-3 py-2"
              data-ac-picker-app={a.id}>
              <Checkbox checked={on} onCheckedChange={(v) => toggle(a.id, v === true)} aria-label={`Share ${a.name}`} />
              <TintTile icon={a.icon} tint={a.accent} size="sm" />
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-text-1">{a.name}</span>
            </label>
          )
        })}
        {!offered.length && <p className="text-[13px] text-text-3">No app matches.</p>}
      </div>
    </div>
  )
}
