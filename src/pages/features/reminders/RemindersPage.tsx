// REMINDERS — the company's operational list, Hub skin.
// the old platform's `/todo` is a mock.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Bell, Check, Loader2, Plus, Search, Trash2, X } from 'lucide-react'
import PageHeader from '@/components/shared/PageHeader'
import EmptyState from '@/components/shared/EmptyState'
import SegmentedTabs from '@/components/shared/SegmentedTabs'
import DragPerson from '@/components/shared/DragPerson'
import { Badge } from '@/components/shared/Badge'
import { api } from '@/lib/api'
import { invalidate } from '@/lib/apiCache'
import { useAuthStore } from '@/auth/useAuthStore'
import { cachedUsers, fetchUsers } from '@/lib/usersDirectory'
import { toast } from '@/stores/useToastStore'
import { askConfirm } from '@/stores/useDialogStore'
import { useDraftGuard } from '@/lib/useDraftGuard'
import { ohioDay, ohioToday } from '@/lib/ohio'
import { cn } from '@/lib/utils'
import type { TintName } from '@/engine/types'

type Priority = 'high' | 'medium' | 'low'
type Status = 'open' | 'done'

type Reminder = {
  id: string
  title?: string
  description?: string
  dueDate?: string
  priority?: Priority | string
  tags?: string
  assignee?: string
  status?: Status | string
  createdBy?: string
  createdAt?: string
  completedAt?: string
}

type Draft = {
  title: string
  description: string
  dueDate: string
  priority: Priority
  tags: string
  assignee: string
}

const emptyDraft = (): Draft => ({
  title: '', description: '', dueDate: ohioToday(), priority: 'medium', tags: '', assignee: '',
})

const PRIORITY: Record<Priority, { label: string; tint: TintName }> = {
  high: { label: 'High', tint: 'pink' },
  medium: { label: 'Medium', tint: 'amber' },
  low: { label: 'Low', tint: 'mint' },
}

const TABS = [
  { id: 'all', label: 'All' },
  { id: 'today', label: 'Today' },
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'high', label: 'High' },
  { id: 'done', label: 'Done' },
]

const REFRESH_MS = 60_000
const INPUT = 'h-9 w-full rounded-md border border-border bg-surface-2 px-3 text-[13px] text-text-1 outline-none placeholder:text-text-3 focus:border-border-strong'
const AREA = 'w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-[13px] text-text-1 outline-none placeholder:text-text-3 focus:border-border-strong'

const priorityOf = (r: Reminder): Priority => {
  const p = String(r.priority ?? 'medium').toLowerCase()
  return p === 'high' || p === 'low' ? p : 'medium'
}
const isDone = (r: Reminder) => String(r.status ?? '').toLowerCase() === 'done'
const dueDay = (r: Reminder) => String(r.dueDate ?? '').slice(0, 10)
const tagsOf = (r: Reminder) => String(r.tags ?? '').split(',').map((s) => s.trim()).filter(Boolean)

function bucketOf(r: Reminder, today: string): 'overdue' | 'today' | 'upcoming' | 'later' | 'done' {
  if (isDone(r)) return 'done'
  const d = dueDay(r)
  if (!d) return 'later'
  if (d < today) return 'overdue'
  if (d === today) return 'today'
  const soon = new Date(`${today}T12:00:00`)
  soon.setDate(soon.getDate() + 7)
  const until = `${soon.getFullYear()}-${String(soon.getMonth() + 1).padStart(2, '0')}-${String(soon.getDate()).padStart(2, '0')}`
  if (d <= until) return 'upcoming'
  return 'later'
}

export default function RemindersPage() {
  const me = useAuthStore((s) => s.user)
  const myName = String(me?.name ?? '')
  const [rows, setRows] = useState<Reminder[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('all')
  const [q, setQ] = useState('')
  const [people, setPeople] = useState<string[]>([])
  const [editing, setEditing] = useState<Reminder | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)
  const reqRef = useRef(0)

  const dirty = draft !== null && (
    editing
      ? JSON.stringify(draft) !== JSON.stringify({
          title: String(editing.title ?? ''),
          description: String(editing.description ?? ''),
          dueDate: dueDay(editing) || ohioToday(),
          priority: priorityOf(editing),
          tags: String(editing.tags ?? ''),
          assignee: String(editing.assignee ?? ''),
        })
      : [draft.title, draft.description, draft.tags, draft.assignee].some((v) => v.trim() !== '')
  )
  useDraftGuard({ id: 'reminder', label: 'An unsaved reminder', dirty })

  const load = useCallback(async () => {
    const seq = ++reqRef.current
    try {
      const list = await api.list<Reminder>('reminders')
      if (seq !== reqRef.current) return
      setRows(Array.isArray(list) ? list : [])
    } catch {
      /* the empty state answers; shouting on every blink is unusable */
    } finally {
      if (seq === reqRef.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    const seed = cachedUsers()
    const names = (list: Record<string, unknown>[]) =>
      [...new Set(list.map((r) => String(r.display_name ?? '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b))
    if (seed) setPeople(names(seed))
    else fetchUsers().then((list) => setPeople(names(list))).catch(() => {})
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load()
    }, REFRESH_MS)
    const wake = () => { if (document.visibilityState === 'visible') void load() }
    document.addEventListener('visibilitychange', wake)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', wake)
    }
  }, [load])

  const today = ohioToday()
  const query = q.trim().toLowerCase()
  const filtered = useMemo(() => {
    return rows.filter((r) => {
      const b = bucketOf(r, today)
      if (tab === 'today' && b !== 'today' && b !== 'overdue') return false
      if (tab === 'upcoming' && b !== 'upcoming') return false
      if (tab === 'high' && (isDone(r) || priorityOf(r) !== 'high')) return false
      if (tab === 'done' && b !== 'done') return false
      if (!query) return true
      return [r.title, r.description, r.assignee, r.tags]
        .some((v) => String(v ?? '').toLowerCase().includes(query))
    })
  }, [rows, tab, query, today])

  const grouped = useMemo(() => {
    const g: Record<string, Reminder[]> = { overdue: [], today: [], upcoming: [], later: [], done: [] }
    filtered.forEach((r) => { g[bucketOf(r, today)].push(r) })
    const byDue = (a: Reminder, b: Reminder) => dueDay(a).localeCompare(dueDay(b))
    g.overdue.sort(byDue)
    g.today.sort(byDue)
    g.upcoming.sort(byDue)
    g.later.sort(byDue)
    g.done.sort((a, b) => String(b.completedAt ?? b.createdAt ?? '').localeCompare(String(a.completedAt ?? a.createdAt ?? '')))
    return g
  }, [filtered, today])

  const openNew = () => {
    setEditing(null)
    setDraft({ ...emptyDraft(), assignee: myName })
  }
  const openEdit = (r: Reminder) => {
    setEditing(r)
    setDraft({
      title: String(r.title ?? ''),
      description: String(r.description ?? ''),
      dueDate: dueDay(r) || ohioToday(),
      priority: priorityOf(r),
      tags: String(r.tags ?? ''),
      assignee: String(r.assignee ?? ''),
    })
  }
  const closeForm = () => { setEditing(null); setDraft(null) }

  const save = async () => {
    if (!draft) return
    const title = draft.title.trim()
    if (title.length < 2) {
      toast({ type: 'danger', title: 'Name it first', body: 'A reminder without a title is a note nobody will find.' })
      return
    }
    setSaving(true)
    try {
      const payload = {
        title,
        description: draft.description.trim(),
        dueDate: draft.dueDate,
        priority: draft.priority,
        tags: draft.tags,
        assignee: draft.assignee,
        status: editing ? String(editing.status ?? 'open') : 'open',
        createdBy: editing ? String(editing.createdBy ?? '') : myName,
      }
      // THE SAVE'S OWN ANSWER IS THE ROW — no second read.
      const saved = editing
        ? await api.update<Reminder>('reminders', String(editing.id), payload)
        : await api.create<Reminder>('reminders', payload)
      invalidate('reminders')
      const editedId = editing ? String(editing.id) : ''
      setRows((prev) => (editedId
        ? prev.map((r) => (String(r.id) === editedId ? { ...r, ...saved } : r))
        : [saved, ...prev]))
      closeForm()
      toast({ type: 'success', title: editing ? 'Reminder saved' : 'Reminder added' })
    } catch (e) {
      toast({ type: 'danger', title: 'Not saved', body: e instanceof Error ? e.message : 'Try again.' })
    } finally {
      setSaving(false)
    }
  }

  // OPTIMISTIC, because a checkbox that waits is a checkbox people click twice.
  const toggleDone = async (r: Reminder) => {
    const next: Status = isDone(r) ? 'open' : 'done'
    const id = String(r.id)
    const before = rows
    setRows((prev) => prev.map((x) => (String(x.id) === id ? { ...x, status: next } : x)))
    try {
      const saved = await api.update<Reminder>('reminders', id, { status: next })
      invalidate('reminders')
      setRows((prev) => prev.map((x) => (String(x.id) === id ? { ...x, ...saved } : x)))
    } catch (e) {
      setRows(before)
      toast({ type: 'danger', title: 'Could not update', body: e instanceof Error ? e.message : 'Try again.' })
    }
  }

  const remove = async (r: Reminder) => {
    const ok = await askConfirm({
      title: 'Delete this reminder?',
      body: `"${String(r.title ?? 'Untitled')}" leaves the list for everyone who can see it.`,
      confirmLabel: 'Delete',
      tone: 'danger',
    })
    if (!ok) return
    try {
      await api.remove('reminders', String(r.id))
      invalidate('reminders')
      if (editing && editing.id === r.id) closeForm()
      // the row is gone; re-reading the whole list to learn that costs an execution nobody is waiting for
      setRows((prev) => prev.filter((x) => String(x.id) !== String(r.id)))
    } catch (e) {
      toast({ type: 'danger', title: 'Not deleted', body: e instanceof Error ? e.message : 'Try again.' })
    }
  }

  const counts = {
    all: rows.filter((r) => !isDone(r)).length,
    overdue: rows.filter((r) => bucketOf(r, today) === 'overdue').length,
  }

  const sections: { id: keyof typeof grouped; label: string; tint: TintName }[] = [
    { id: 'overdue', label: 'Overdue', tint: 'pink' },
    { id: 'today', label: 'Today', tint: 'mint' },
    { id: 'upcoming', label: 'Upcoming', tint: 'blue' },
    { id: 'later', label: 'Later', tint: 'lavender' },
    { id: 'done', label: 'Done', tint: 'amber' },
  ]

  return (
    <div>
      <PageHeader
        title="Reminders"
        subtitle="What the house owes today — certifications, supplies, follow-ups. One list for everyone who can open this app."
        actions={
          <button
            onClick={openNew}
            className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-3.5 text-[12.5px] font-semibold text-on-primary transition-colors hover:bg-primary-hover"
          >
            <Plus size={15} /> New reminder
          </button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <SegmentedTabs
          tabs={TABS.map((t) => ({
            id: t.id,
            label: t.id === 'all' && counts.all ? `${t.label} · ${counts.all}` : t.label,
          }))}
          value={tab}
          onChange={setTab}
        />
        <label className="relative min-w-[180px] flex-1">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-3" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search title, person, tag…"
            className="h-9 w-full rounded-md border border-border bg-surface pl-8 pr-3 text-[13px] text-text-1 outline-none placeholder:text-text-3 focus:border-border-strong"
          />
        </label>
      </div>

      {counts.overdue > 0 && tab !== 'done' && (
        <p className="mb-3 rounded-md bg-tint-pink/40 px-3 py-2 text-[12.5px] text-text-1">
          {counts.overdue} overdue — they sit at the top until somebody ticks them or moves the date.
        </p>
      )}

      {draft && (
        <div className="mb-4 rounded-lg border border-border bg-surface p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-[14px] font-semibold text-text-1">{editing ? 'Edit reminder' : 'New reminder'}</h2>
            <button onClick={closeForm} aria-label="Close" className="grid h-8 w-8 place-items-center rounded-md text-text-3 hover:bg-surface-2">
              <X size={16} />
            </button>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="md:col-span-2 text-[12px] font-medium text-text-2">
              Title
              <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} className={cn(INPUT, 'mt-1')} placeholder="Renew caregiver certification…" />
            </label>
            <label className="md:col-span-2 text-[12px] font-medium text-text-2">
              Notes
              <textarea value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} rows={3} className={cn(AREA, 'mt-1')} placeholder="What has to happen, and why." />
            </label>
            <label className="text-[12px] font-medium text-text-2">
              Due
              <input type="date" value={draft.dueDate} onChange={(e) => setDraft({ ...draft, dueDate: e.target.value })} className={cn(INPUT, 'mt-1')} />
            </label>
            <label className="text-[12px] font-medium text-text-2">
              Priority
              <select value={draft.priority} onChange={(e) => setDraft({ ...draft, priority: e.target.value as Priority })} className={cn(INPUT, 'mt-1')}>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </label>
            <label className="text-[12px] font-medium text-text-2">
              Assignee
              <select value={draft.assignee} onChange={(e) => setDraft({ ...draft, assignee: e.target.value })} className={cn(INPUT, 'mt-1')}>
                <option value="">Unassigned</option>
                {people.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <label className="text-[12px] font-medium text-text-2">
              Tags
              <input value={draft.tags} onChange={(e) => setDraft({ ...draft, tags: e.target.value })} className={cn(INPUT, 'mt-1')} placeholder="certification, supplies" />
            </label>
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <button onClick={closeForm} className="h-9 rounded-md border border-border px-3 text-[12.5px] font-semibold text-text-2 hover:bg-surface-2">Cancel</button>
            <button
              onClick={() => void save()}
              disabled={saving}
              className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-3.5 text-[12.5px] font-semibold text-on-primary hover:bg-primary-hover disabled:opacity-60"
            >
              {saving && <Loader2 size={14} className="animate-spin" />}
              {editing ? 'Save' : 'Add'}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="mt-6 flex items-center gap-2 text-[13px] text-text-3">
          <Loader2 size={14} className="animate-spin" /> Reading the list…
        </p>
      ) : filtered.length === 0 ? (
        <EmptyState
          title={rows.length === 0 ? 'Nothing on the list yet' : 'Nothing in this cut'}
          body={rows.length === 0
            ? 'Add the first reminder — a certification, a supply order, a follow-up. Everyone with access sees it.'
            : 'Try another tab, or clear the search.'}
          action={rows.length === 0 ? { label: 'New reminder', onClick: openNew } : undefined}
        />
      ) : (
        <div className="space-y-6">
          {sections.map((sec) => {
            const items = grouped[sec.id]
            if (!items.length) return null
            if (tab === 'done' && sec.id !== 'done') return null
            if (tab !== 'done' && tab !== 'all' && sec.id === 'done') return null
            return (
              <section key={sec.id}>
                <h2 className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-text-3">
                  <Badge label={`${sec.label} · ${items.length}`} tint={sec.tint} />
                </h2>
                <ul className="space-y-2">
                  {items.map((r) => {
                    const prio = priorityOf(r)
                    const day = dueDay(r)
                    const who = String(r.assignee || '').trim()
                    return (
                      <li
                        key={r.id}
                        className={cn(
                          'flex items-start gap-3 rounded-lg border border-border bg-surface px-3 py-3',
                          sec.id === 'overdue' && 'border-tint-fg-pink/40',
                          isDone(r) && 'opacity-70',
                        )}
                      >
                        <button
                          onClick={() => void toggleDone(r)}
                          aria-label={isDone(r) ? 'Reopen' : 'Mark done'}
                          className={cn(
                            'mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border',
                            isDone(r)
                              ? 'border-tint-fg-mint bg-tint-mint text-tint-fg-mint'
                              : 'border-border text-transparent hover:border-primary hover:text-primary',
                          )}
                        >
                          <Check size={13} />
                        </button>
                        <button onClick={() => openEdit(r)} className="min-w-0 flex-1 text-left">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={cn('text-[13.5px] font-semibold text-text-1', isDone(r) && 'line-through')}>
                              {String(r.title || 'Untitled')}
                            </span>
                            <Badge label={PRIORITY[prio].label} tint={PRIORITY[prio].tint} />
                            {day && (
                              <span className={cn(
                                'text-[11.5px] tabular-nums',
                                sec.id === 'overdue' ? 'font-semibold text-tint-fg-pink' : 'text-text-3',
                              )}>
                                {sec.id === 'today' ? 'Today' : ohioDay(day) || day}
                              </span>
                            )}
                          </div>
                          {r.description && (
                            <p className="mt-1 line-clamp-2 text-[12.5px] text-text-2">{r.description}</p>
                          )}
                          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[12px] text-text-3">
                            {who && (
                              <DragPerson name={who}>
                                <span>{who}</span>
                              </DragPerson>
                            )}
                            {tagsOf(r).map((t) => (
                              <span key={t} className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px]">{t}</span>
                            ))}
                          </div>
                        </button>
                        <button
                          onClick={() => void remove(r)}
                          aria-label="Delete"
                          className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-text-3 hover:bg-tint-pink/40 hover:text-tint-fg-pink"
                        >
                          <Trash2 size={14} />
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </section>
            )
          })}
        </div>
      )}

      {!loading && rows.length > 0 && (
        <p className="mt-6 flex items-center gap-1.5 text-[11.5px] text-text-3">
          <Bell size={12} /> {rows.filter((r) => !isDone(r)).length} open · {rows.filter(isDone).length} done
        </p>
      )}
    </div>
  )
}
