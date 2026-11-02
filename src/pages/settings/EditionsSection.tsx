// Settings → Editions (the master only — MASTER_ONLY_SECTIONS, anchor #editions).
// The delicate edits each app offers, one row per edition: its key at the front (on or off), what it lets a person…
import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { KeyRound, Loader2, Search } from 'lucide-react'
import Avatar from '@/components/shared/Avatar'
import Card, { CardHeader } from '@/components/shared/Card'
import SidePanel from '@/components/shared/SidePanel'
import { Checkbox } from '@/components/ui/checkbox'
import { Switch } from '@/components/ui/switch'
import { EASE_OUT_EXPO } from '@/engine/motion'
import { gasAction, isRelayReceipt } from '@/features/hiring/shared'
import { badgeWord } from '@/components/shared/RoleBadge'
import { EDITION_BADGES, editionsByApp, editionsFrom, editionsPayload, type Edition, type EditionId } from '@/lib/editions'
import { cachedUsers, fetchUsersIfStale } from '@/lib/usersDirectory'
import { toast } from '@/stores/useToastStore'
import { cn } from '@/lib/utils'
import { acPeopleFrom, type AcPerson } from './AppControlAccessSection'

export const EDITIONS_LAND =
  'A person sees it the next time their Hub opens or reloads; the server decides every edit at once.'

/** A badge as the Editions rows read it. */
export const editionBadgeWord = (badge: string): string => (badge === 'HM' ? 'House Manager' : badgeWord(badge))

/** The list with one edition replaced. */
export const withEdition = (list: readonly Edition[], next: Edition): Edition[] =>
  list.map((e) => (e.id === next.id ? next : e))

export default function EditionsSection() {
  const [list, setList] = useState<Edition[] | null>(null)
  const [malformed, setMalformed] = useState(false)
  const [failed, setFailed] = useState('')
  const [people, setPeople] = useState<AcPerson[]>(() => acPeopleFrom(cachedUsers() ?? []))
  const [busy, setBusy] = useState(false)
  /** the side panel's draft: one edition's key and people while they are being chosen */
  const [draft, setDraft] = useState<Edition | null>(null)

  const load = useCallback(async () => {
    try {
      const d = await gasAction<{ editions?: unknown; malformed?: boolean }>('editionsGet', {})
      // an answer without the list is not an empty list: what is on screen stays
      if (isRelayReceipt(d) || !Array.isArray(d?.editions)) {
        setFailed('the read came back without the list')
        return
      }
      setFailed('')
      setList(editionsFrom(d?.editions))
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

  /** Save every edition; only what the server answered is adopted. */
  const save = async (next: Edition[]): Promise<boolean> => {
    if (!list) return false
    setBusy(true)
    try {
      const d = await gasAction<{ editions?: unknown }>('editionsSet', { editions: editionsPayload(next) })
      // a queued save answers a receipt without the list: the screen keeps what was applied and reads again
      if (isRelayReceipt(d) || !Array.isArray(d?.editions)) {
        setList(next)
        toast({ type: 'warning', title: 'Sent, not confirmed yet', body: 'The list is read again in a moment.' })
        window.setTimeout(() => { void load() }, 15_000)
        return true
      }
      setList(editionsFrom(d?.editions))
      setMalformed(false)
      toast({ type: 'success', title: 'Applied', body: EDITIONS_LAND })
      return true
    } catch (e) {
      toast({ type: 'danger', title: 'Not applied', body: e instanceof Error ? e.message : 'Try again.' })
      return false
    } finally {
      setBusy(false)
    }
  }

  const apply = async () => {
    if (!list || !draft) return
    if (await save(withEdition(list, draft))) setDraft(null)
  }

  return (
    <motion.section
      id="editions"
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-10% 0px' }}
      transition={{ duration: 0.24, ease: EASE_OUT_EXPO }}
      className="scroll-mt-20"
    >
      <Card>
        <CardHeader
          title="Editions — who else makes the delicate edits"
          sub="Each row is one edit an app offers. You make every one of them, always. Anybody else makes one only while its key is on, and they are on its list or wear the badge it is opened to (or one above it)."
        />
        {list === null ? (
          failed ? (
            <div className="rounded-md border border-danger/40 bg-danger/5 px-3 py-2.5 text-[13px] leading-[20px] text-text-1"
              data-editions-failed>
              <p>The editions could not be read — {failed}. Nothing is shown, so nothing is saved over a list nobody read.</p>
              <button type="button" onClick={() => { setFailed(''); void load() }}
                className="mt-2 inline-flex h-8 items-center rounded-md border border-border bg-surface px-3 text-[12.5px] font-semibold text-text-1 transition-colors hover:bg-surface-2">
                Try again
              </button>
            </div>
          ) : (
            <p className="flex items-center gap-2 text-[13px] text-text-3">
              <Loader2 size={14} className="animate-spin" /> Reading the editions…
            </p>
          )
        ) : (
          <EditionsView list={list} people={people} busy={busy} malformed={malformed}
            onKey={(id, on) => void save(list.map((e) => (e.id === id ? { ...e, on } : e)))}
            onChoose={(e) => setDraft({ ...e, people: [...e.people] })} />
        )}
      </Card>
      <SidePanel
        open={draft !== null}
        onClose={() => setDraft(null)}
        label="Editions"
        title={draft?.label ?? ''}
        footer={draft && (
          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={() => setDraft(null)}
              className="h-9 rounded-md border border-border bg-surface px-3 text-[13px] font-semibold text-text-1 hover:bg-surface-2">
              Cancel
            </button>
            <button type="button" disabled={busy} onClick={() => void apply()} data-editions-apply
              className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-[13px] font-semibold text-on-primary hover:bg-primary-hover disabled:opacity-50">
              {busy && <Loader2 size={14} className="animate-spin" />} Apply
            </button>
          </div>
        )}
      >
        {draft && <EditionPeoplePicker draft={draft} people={people} onChange={setDraft} />}
      </SidePanel>
    </motion.section>
  )
}

/** The editions once read, by app: the key at the front of each row, what it lets a person change, and its people. */
export function EditionsView({ list, people, busy, malformed, onKey, onChoose }: {
  list: readonly Edition[]
  people: readonly AcPerson[]
  busy: boolean
  malformed?: boolean
  onKey: (id: EditionId, on: boolean) => void
  onChoose: (e: Edition) => void
}) {
  const byId = useMemo(() => new Map(people.map((p) => [p.id, p])), [people])
  return (
    <div className="space-y-4" data-editions>
      {malformed && (
        <p className="rounded-md border border-border bg-tint-amber px-3 py-2 text-[12.5px] text-text-2" data-editions-malformed>
          The stored editions could not be read as a list, so nobody but you makes any of them. Applying here replaces it.
        </p>
      )}
      {editionsByApp(list).map((g) => (
        <div key={g.app} className="space-y-2" data-editions-app={g.app}>
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-text-3">{g.appName}</h3>
          {g.editions.map((e) => (
            <div key={e.id} className="flex items-start gap-3 rounded-md border border-border px-3 py-2.5" data-edition={e.id}>
              <label className="flex shrink-0 flex-col items-center gap-1 pt-0.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-text-3">
                <Switch checked={e.on} disabled={busy} onCheckedChange={(on) => onKey(e.id, on)}
                  aria-label={`${e.label} key`} data-edition-key={e.id} />
                <span className={cn('inline-flex items-center gap-0.5', e.on && 'text-primary')}>
                  <KeyRound size={10} /> {e.on ? 'On' : 'Off'}
                </span>
              </label>
              <div className="min-w-0 flex-1">
                <p className="text-[13.5px] font-semibold text-text-1">{e.label}</p>
                <p className="mt-0.5 text-[12px] leading-[18px] text-text-3">{e.description}</p>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {e.badge && (
                    <span className="inline-flex items-center rounded-full bg-tint-blue px-2 py-0.5 text-[11.5px] font-semibold text-text-1"
                      data-edition-badge={e.badge}>
                      Every {editionBadgeWord(e.badge)} and above
                    </span>
                  )}
                  {e.people.map((id) => {
                    const p = byId.get(id)
                    return (
                      <span key={id} className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 py-0.5 pl-0.5 pr-2 text-[11.5px] font-medium text-text-2"
                        data-edition-person={id}>
                        <Avatar src={p?.avatar} name={p?.name || id} size="xs" /> {p?.name || id}
                      </span>
                    )
                  })}
                  {!e.people.length && !e.badge && <span className="text-[12px] text-text-3" data-edition-nobody>Nobody but you.</span>}
                  <button type="button" disabled={busy} onClick={() => onChoose(e)} data-edition-choose={e.id}
                    className="text-[12px] font-semibold text-primary hover:underline disabled:opacity-50">
                    Choose people or a badge
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

/** The side panel's body: what the edition lets a person change, its key, and a checkbox per employee (never you). */
export function EditionPeoplePicker({ draft, people, onChange }: {
  draft: Edition
  people: readonly AcPerson[]
  onChange: (next: Edition) => void
}) {
  const [q, setQ] = useState('')
  const shown = useMemo(() => {
    const query = q.trim().toLowerCase()
    return people.filter((p) => !query || p.name.toLowerCase().includes(query) || p.email.toLowerCase().includes(query))
  }, [people, q])
  const toggle = (id: string, on: boolean) =>
    onChange({ ...draft, people: on ? [...draft.people.filter((x) => x !== id), id] : draft.people.filter((x) => x !== id) })

  return (
    <div className="mt-3 space-y-3" data-edition-picker={draft.id}>
      <p className="text-[12.5px] leading-[19px] text-text-2">{draft.description}</p>
      <label className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2.5">
        <span>
          <span className="block text-[13px] font-semibold text-text-1">Key</span>
          <span className="block text-[12px] text-text-3">Off: nobody but you makes this edit. On: the badge and the people below make it.</span>
        </span>
        <Switch checked={draft.on} onCheckedChange={(on) => onChange({ ...draft, on })} aria-label="Key" data-edition-picker-key />
      </label>
      <label className="grid gap-1.5 rounded-md border border-border px-3 py-2.5">
        <span className="block text-[13px] font-semibold text-text-1">Badge</span>
        <span className="block text-[12px] text-text-3">
          Every employee wearing this badge, or one above it, makes the edit while the key is on, besides the people below.
        </span>
        <select value={draft.badge} onChange={(e) => onChange({ ...draft, badge: e.target.value })} aria-label="Badge"
          data-edition-picker-badge
          className="h-9 rounded-md border border-border bg-bg px-2 text-[13px] text-text-1 outline-none focus:border-primary">
          <option value="">No badge: the people below only</option>
          {EDITION_BADGES.map((b) => <option key={b} value={b}>{editionBadgeWord(b)} and above</option>)}
        </select>
      </label>
      <p className="text-[12px] text-text-3" data-edition-picker-count>
        {draft.people.length === 0 ? 'Nobody chosen.' : `${draft.people.length} ${draft.people.length === 1 ? 'person' : 'people'} chosen.`}
      </p>
      <label className="flex h-9 items-center gap-2 rounded-[10px] border border-border bg-bg px-3 focus-within:border-primary">
        <Search size={14} className="text-text-3" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people" aria-label="Search people"
          className="h-full min-w-0 flex-1 bg-transparent text-[13px] text-text-1 outline-none placeholder:text-text-3" />
      </label>
      <div className="space-y-1.5">
        {shown.map((p) => (
          <label key={p.id} className="flex cursor-pointer items-center gap-2.5 rounded-md border border-border px-3 py-2"
            data-edition-picker-person={p.id}>
            <Checkbox checked={draft.people.includes(p.id)} onCheckedChange={(v) => toggle(p.id, v === true)}
              aria-label={`${p.name} makes this edit`} />
            <Avatar src={p.avatar} name={p.name} size="xs" />
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-text-1">{p.name}</span>
            <span className="truncate text-[12px] text-text-3">{p.role}</span>
          </label>
        ))}
        {!shown.length && <p className="text-[13px] text-text-3">No one matches.</p>}
      </div>
    </div>
  )
}
